import { q, withTransaction } from '../db/index.js';
import { errors } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { hasRoleAtLeast, uuid } from '../lib/auth.js';
import { analytics } from '../lib/analytics.js';
import * as storage from '../lib/storage.js';
import { emitToUser, emitDashboardRefresh } from '../lib/realtime-events.js';

/**
 * Dataset access resolution.
 *
 * Returns null when the caller may not even know the dataset exists, so routes
 * can answer 404 without disclosing it (AppFlow §10). Administrators get
 * read-only oversight access; only the owner (or an explicit `edit` grant) may
 * mutate.
 */
export async function resolveDatasetAccess(user, datasetId) {
  const { rows } = await q(
    `SELECT d.*, u.name AS owner_name
       FROM datasets d JOIN users u ON u.id = d.user_id
      WHERE d.id = $1`,
    [datasetId],
  );
  const dataset = rows[0];
  if (!dataset) return null;

  if (dataset.user_id === user.id) return { dataset, permission: 'owner' };

  const share = await q(
    'SELECT permission FROM dataset_permissions WHERE dataset_id = $1 AND user_id = $2',
    [datasetId, user.id],
  );
  if (share.rows[0]) return { dataset, permission: share.rows[0].permission };

  if (hasRoleAtLeast(user, 'admin')) return { dataset, permission: 'view' };
  return null;
}

export async function listDatasets(user, { page = 1, pageSize = 20, search = '', status = '' }) {
  const offset = (page - 1) * pageSize;
  const params = [];
  const where = [];

  // Owners see their own; shared users see grants; admins see everything.
  if (hasRoleAtLeast(user, 'admin')) {
    params.push();
  } else {
    params.push(user.id);
    where.push(`(d.user_id = $${params.length} OR d.id IN (
      SELECT dataset_id FROM dataset_permissions WHERE user_id = $${params.length}))`);
  }
  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    where.push(`LOWER(d.name) LIKE $${params.length}`);
  }
  if (status) {
    params.push(status);
    where.push(`d.status = $${params.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const countRes = await q(`SELECT COUNT(*)::int AS total FROM datasets d ${whereSql}`, params);
  const listRes = await q(
    `SELECT d.id, d.name, d.original_name, d.file_type, d.file_size, d.row_count, d.column_count,
            d.status, d.error_code, d.error_message, d.created_at, d.updated_at,
            d.user_id, u.name AS owner_name,
            COALESCE((SELECT jsonb_agg(jsonb_build_object('userId', s.user_id, 'permission', s.permission))
                        FROM dataset_permissions s WHERE s.dataset_id = d.id), '[]'::jsonb) AS shares
       FROM datasets d JOIN users u ON u.id = d.user_id
       ${whereSql}
      ORDER BY d.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pageSize, offset],
  );

  return {
    data: listRes.rows.map((row) => ({ ...row, isOwner: row.user_id === user.id })),
    pagination: { page, pageSize, total: countRes.rows[0].total },
  };
}

export async function createUpload(user, file) {
  const extension = file.originalname.toLowerCase().endsWith('.csv') ? 'csv' : 'xlsx';
  const storageKey = storage.newStorageKey(extension);
  await storage.put(storageKey, file.buffer);

  const datasetId = uuid();
  const baseName = file.originalname.replace(/\.(csv|xlsx)$/i, '').slice(0, 200) || 'Untitled dataset';

  await withTransaction(async (tx) => {
    await tx(
      `INSERT INTO datasets (id, user_id, name, original_name, storage_key, file_type, file_size, status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',NOW(),NOW())`,
      [datasetId, user.id, baseName, file.originalname, storageKey, extension, file.size],
    );
    await tx(
      `INSERT INTO dataset_import_jobs (id, dataset_id, status, created_at)
       VALUES ($1,$2,'pending',NOW())`,
      [uuid(), datasetId],
    );
  });

  // Asynchronous processing: the upload request returns immediately with a
  // status handle, per AppFlow §4.
  setImmediate(() => processImport(datasetId, user.id).catch(() => {}));
  await audit({ user }, 'dataset.upload', { datasetId, fileName: file.originalname });
  return { id: datasetId, name: baseName, status: 'pending' };
}

/**
 * Import job. Explicit states, retry-safe (rows for the dataset are replaced
 * rather than appended, so a retry cannot duplicate an import).
 */
export async function processImport(datasetId, actorId) {
  const jobRow = await q(
    'SELECT id, attempts FROM dataset_import_jobs WHERE dataset_id = $1 ORDER BY created_at DESC LIMIT 1',
    [datasetId],
  );
  const job = jobRow.rows[0];
  const jobId = job?.id || uuid();

  const fail = async (errorCode, errorMessage) => {
    await q(
      `UPDATE datasets SET status='failed', error_code=$2, error_message=$3, updated_at=NOW() WHERE id=$1`,
      [datasetId, errorCode, errorMessage],
    );
    await q(
      `UPDATE dataset_import_jobs SET status='failed', error_code=$2, error_message=$3, finished_at=NOW()
        WHERE id=$1`,
      [jobId, errorCode, errorMessage],
    );
    emitToUser(actorId, 'dataset:failed', {
      datasetId,
      jobId,
      errorCode,
      message: errorMessage,
      link: `/datasets/${datasetId}`,
    });
  };

  try {
    await q(`UPDATE datasets SET status='processing', error_code=NULL, error_message=NULL, updated_at=NOW() WHERE id=$1`, [
      datasetId,
    ]);
    await q(
      `UPDATE dataset_import_jobs SET status='processing', attempts=COALESCE(attempts,0)+1, progress=10, started_at=NOW()
        WHERE id=$1`,
      [jobId],
    );
    emitToUser(actorId, 'dataset:processing', {
      datasetId,
      jobId,
      status: 'processing',
      message: 'Parsing and profiling your file.',
      link: `/datasets/${datasetId}`,
    }, false);

    const { rows } = await q('SELECT storage_key, original_name FROM datasets WHERE id=$1', [datasetId]);
    if (!rows[0]) return;
    const buffer = await storage.get(rows[0].storage_key);

    const profile = await analytics.profile(rows[0].original_name, buffer);

    await q(`UPDATE dataset_import_jobs SET progress=70 WHERE id=$1`, [jobId]);

    await withTransaction(async (tx) => {
      await tx('DELETE FROM dataset_rows WHERE dataset_id=$1', [datasetId]);
      await tx('DELETE FROM dataset_value_counts WHERE dataset_id=$1', [datasetId]);

      const rows = profile.rows || [];
      const CHUNK = 500;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        const values = [];
        const params = [];
        chunk.forEach((row, idx) => {
          const base = idx * 3;
          params.push(datasetId, i + idx, JSON.stringify(row));
          values.push(`($${base + 1}, $${base + 2}, $${base + 3}::jsonb)`);
        });
        if (values.length) {
          await tx(
            `INSERT INTO dataset_rows (dataset_id, row_index, data) VALUES ${values.join(',')}`,
            params,
          );
        }
      }

      for (const [column, values] of Object.entries(profile.valueCounts || {})) {
        await tx(
          `INSERT INTO dataset_value_counts (dataset_id, column_name, values) VALUES ($1,$2,$3::jsonb)`,
          [datasetId, column, JSON.stringify(values)],
        );
      }

      const hasErrors = (profile.warnings || []).some((w) => w.severity === 'error');
      await tx(
        `UPDATE datasets
            SET row_count=$2, column_count=$3, columns=$4::jsonb, warnings=$5::jsonb,
                duplicate_rows=$6, status=$7, error_code=NULL, error_message=NULL, updated_at=NOW()
          WHERE id=$1`,
        [
          datasetId,
          profile.rowCount,
          profile.columnCount,
          JSON.stringify(profile.columns),
          JSON.stringify(profile.warnings || []),
          profile.duplicateRowCount || 0,
          hasErrors ? 'ready' : 'ready',
        ],
      );
      await tx(
        `UPDATE dataset_import_jobs SET status='ready', progress=100, finished_at=NOW() WHERE id=$1`,
        [jobId],
      );
    });

    emitToUser(actorId, 'dataset:ready', {
      datasetId,
      jobId,
      rowCount: profile.rowCount,
      updatedAt: new Date().toISOString(),
      message: `${profile.rowCount.toLocaleString()} rows imported successfully.`,
      link: `/datasets/${datasetId}`,
    });

    // Refresh any dashboard that already shows a chart from this dataset.
    const dash = await q(
      `SELECT DISTINCT w.dashboard_id, d.user_id
         FROM charts c
         JOIN dashboard_widgets w ON w.chart_id = c.id
         JOIN dashboards d ON d.id = w.dashboard_id
        WHERE c.dataset_id = $1`,
      [datasetId],
    );
    if (dash.rows.length) {
      for (const row of dash.rows) {
        emitDashboardRefresh(row.dashboard_id, [row.user_id, actorId], 'dataset_imported');
      }
    }
  } catch (err) {
    // Validation failures carry their own code/message (e.g. NO_ROWS,
    // PARSE_ERROR, TOO_MANY_COLUMNS); infrastructure failures stay generic.
    const isValidation = Boolean(err.expose) && err.code !== 'UPSTREAM_UNAVAILABLE';
    const code = isValidation ? err.code : 'IMPORT_FAILED';
    const message =
      err.expose && err.message
        ? err.message
        : 'The file could not be processed. Check the format and try again.';
    console.error('[import] failed', datasetId, err.message);
    await fail(code, message);
  }
}

export async function getDataset(user, datasetId, { includePreview = false } = {}) {
  const access = await resolveDatasetAccess(user, datasetId);
  if (!access) throw errors.notFound('Dataset not found.');

  const { rows } = await q(
    `SELECT d.*, u.name AS owner_name,
            (SELECT jsonb_agg(jsonb_build_object('userId', s.user_id, 'name', su.name,
                              'email', su.email, 'permission', s.permission))
               FROM dataset_permissions s JOIN users su ON su.id = s.user_id
              WHERE s.dataset_id = d.id) AS shares,
            (SELECT row_to_json(j) FROM (
                SELECT id, status, attempts, progress, error_code, started_at, finished_at, created_at
                  FROM dataset_import_jobs WHERE dataset_id = d.id ORDER BY created_at DESC LIMIT 1
             ) j) AS latest_job
       FROM datasets d JOIN users u ON u.id = d.user_id
      WHERE d.id = $1`,
    [datasetId],
  );
  const dataset = rows[0];
  delete dataset.storage_key; // never expose internal storage keys (schema §8)

  const response = {
    ...dataset,
    shares: dataset.shares || [],
    columns: dataset.columns || [],
    warnings: dataset.warnings || [],
    permission: access.permission,
    isOwner: access.permission === 'owner',
    canEdit: ['owner', 'edit'].includes(access.permission),
  };

  if (includePreview) {
    const counts = await q(
      'SELECT column_name, values FROM dataset_value_counts WHERE dataset_id=$1',
      [datasetId],
    );
    response.valueCounts = Object.fromEntries(counts.rows.map((r) => [r.column_name, r.values]));
  }
  return response;
}

export async function previewDataset(user, datasetId, { page = 1, pageSize = 50 }) {
  const access = await resolveDatasetAccess(user, datasetId);
  if (!access) throw errors.notFound('Dataset not found.');

  const safeSize = Math.min(Math.max(pageSize, 1), 200);
  const offset = (Math.max(page, 1) - 1) * safeSize;
  const { rows } = await q(
    `SELECT row_index, data FROM dataset_rows WHERE dataset_id=$1 ORDER BY row_index LIMIT $2 OFFSET $3`,
    [datasetId, safeSize, offset],
  );
  return {
    rows: rows.map((r) => ({ __row: r.row_index, ...r.data })),
    columns: access.dataset.columns || [],
    pagination: {
      page: Math.max(page, 1),
      pageSize: safeSize,
      total: access.dataset.row_count,
      totalPages: Math.max(1, Math.ceil(access.dataset.row_count / safeSize)),
    },
  };
}

/** Full row set for chart/forecast computation; bounded by the import cap. */
export async function loadDatasetRows(user, datasetId) {
  const access = await resolveDatasetAccess(user, datasetId);
  if (!access) throw errors.notFound('Dataset not found.');
  if (access.dataset.status !== 'ready') {
    throw errors.conflict('This dataset is not ready yet. Try again once processing completes.');
  }
  const { rows } = await q(
    'SELECT data FROM dataset_rows WHERE dataset_id=$1 ORDER BY row_index',
    [datasetId],
  );
  return { dataset: access.dataset, rows: rows.map((r) => r.data) };
}

export async function renameDataset(user, datasetId, name) {
  const access = await resolveDatasetAccess(user, datasetId);
  if (!access) throw errors.notFound('Dataset not found.');
  if (!['owner', 'edit'].includes(access.permission)) throw errors.forbidden();
  await q('UPDATE datasets SET name=$2, updated_at=NOW() WHERE id=$1', [datasetId, name]);
  await audit({ user }, 'dataset.rename', { datasetId, name });
  return getDataset(user, datasetId);
}

export async function deleteDataset(user, datasetId) {
  const access = await resolveDatasetAccess(user, datasetId);
  if (!access) throw errors.notFound('Dataset not found.');
  // Only the owner or an administrator may delete, mirroring PRD FR-02.
  const allowed = access.permission === 'owner' || hasRoleAtLeast(user, 'admin');
  if (!allowed) throw errors.forbidden('Only the owner or an administrator can delete a dataset.');

  await q('DELETE FROM datasets WHERE id=$1', [datasetId]);
  await storage.remove(access.dataset.storage_key);
  await audit({ user }, 'dataset.delete', { datasetId, name: access.dataset.name });
  return { deleted: true };
}

export async function retryImport(user, datasetId) {
  const access = await resolveDatasetAccess(user, datasetId);
  if (!access) throw errors.notFound('Dataset not found.');
  if (!['owner', 'edit'].includes(access.permission)) throw errors.forbidden();
  if (access.dataset.status === 'processing') {
    throw errors.conflict('This import is already running.');
  }
  const jobId = uuid();
  await q(
    `INSERT INTO dataset_import_jobs (id, dataset_id, status, created_at) VALUES ($1,$2,'pending',NOW())`,
    [jobId, datasetId],
  );
  await q(`UPDATE datasets SET status='pending', updated_at=NOW() WHERE id=$1`, [datasetId]);
  setImmediate(() => processImport(datasetId, access.dataset.user_id).catch(() => {}));
  await audit({ user }, 'dataset.retry_import', { datasetId, jobId });
  return { id: datasetId, jobId, status: 'pending' };
}

export async function shareDataset(user, datasetId, { email, permission }) {
  const access = await resolveDatasetAccess(user, datasetId);
  if (!access) throw errors.notFound('Dataset not found.');
  if (access.permission !== 'owner') throw errors.forbidden('Only the owner can share a dataset.');

  const { rows } = await q('SELECT id, name, email FROM users WHERE LOWER(email)=LOWER($1) AND is_active', [email]);
  const recipient = rows[0];
  if (!recipient) throw errors.notFound('No active account matches that email address.');
  if (recipient.id === user.id) throw errors.badRequest('You already own this dataset.');

  await q(
    `INSERT INTO dataset_permissions (id, dataset_id, user_id, permission, created_at)
     VALUES ($1,$2,$3,$4,NOW())
     ON CONFLICT (dataset_id, user_id) DO UPDATE SET permission = EXCLUDED.permission`,
    [uuid(), datasetId, recipient.id, permission],
  );
  await audit({ user }, 'dataset.share', { datasetId, recipient: recipient.email, permission });
  return getDataset(user, datasetId);
}

export async function revokeDatasetShare(user, datasetId, targetUserId) {
  const access = await resolveDatasetAccess(user, datasetId);
  if (!access || access.permission !== 'owner') throw errors.notFound('Dataset not found.');
  await q('DELETE FROM dataset_permissions WHERE dataset_id=$1 AND user_id=$2', [datasetId, targetUserId]);
  await audit({ user }, 'dataset.revoke_share', { datasetId, targetUserId });
  return getDataset(user, datasetId);
}

export async function downloadInfo(user, datasetId) {
  const access = await resolveDatasetAccess(user, datasetId);
  if (!access) throw errors.notFound('Dataset not found.');
  if (access.permission === 'view' && access.dataset.user_id !== user.id && !hasRoleAtLeast(user, 'admin')) {
    throw errors.forbidden('Your access level does not allow downloads.');
  }
  return {
    url: `/api/datasets/${datasetId}/download?token=${storage.signDownloadToken(datasetId, user.id)}`,
    expiresInSeconds: 300,
  };
}
