import { q, withTransaction } from '../db/index.js';
import { errors } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { hasRoleAtLeast, uuid } from '../lib/auth.js';
import { emitDashboardRefresh } from '../lib/realtime-events.js';
import { resolveDatasetAccess } from './datasets.js';

export const DEFAULT_LAYOUT = { columns: 12, widgets: [] };

export const CHART_TYPES = ['bar', 'pie', 'line', 'area', 'scatter', 'histogram'];
export const AGGREGATIONS = ['sum', 'avg', 'count', 'count_distinct', 'min', 'max', 'median', 'none'];

/**
 * Dashboard access. Owners get edit; shares grant view or edit; administrators
 * get read-only oversight. Returns null when the caller may not know the
 * dashboard exists.
 */
export async function resolveDashboardAccess(user, dashboardId) {
  const { rows } = await q(
    `SELECT d.*, u.name AS owner_name FROM dashboards d JOIN users u ON u.id = d.user_id WHERE d.id = $1`,
    [dashboardId],
  );
  const dashboard = rows[0];
  if (!dashboard) return null;

  if (dashboard.user_id === user.id) return { dashboard, permission: 'owner' };

  const share = await q(
    'SELECT permission FROM dashboard_shares WHERE dashboard_id=$1 AND user_id=$2',
    [dashboardId, user.id],
  );
  if (share.rows[0]) return { dashboard, permission: share.rows[0].permission };

  if (hasRoleAtLeast(user, 'admin')) return { dashboard, permission: 'view' };
  return null;
}

export async function listDashboards(user) {
  const owned = await q(
    `SELECT d.*, 'owner' AS permission, u.name AS owner_name,
            (SELECT COUNT(*)::int FROM dashboard_widgets w WHERE w.dashboard_id = d.id) AS widget_count
       FROM dashboards d JOIN users u ON u.id = d.user_id
      WHERE d.user_id = $1 ORDER BY d.created_at DESC`,
    [user.id],
  );
  const shared = await q(
    `SELECT d.*, s.permission, u.name AS owner_name,
            (SELECT COUNT(*)::int FROM dashboard_widgets w WHERE w.dashboard_id = d.id) AS widget_count
       FROM dashboard_shares s
       JOIN dashboards d ON d.id = s.dashboard_id
       JOIN users u ON u.id = d.user_id
      WHERE s.user_id = $1 ORDER BY d.updated_at DESC`,
    [user.id],
  );

  const map = (row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    isDefault: row.is_default,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ownerName: row.owner_name,
    permission: row.permission,
    widgetCount: row.widget_count,
    canEdit: ['owner', 'edit'].includes(row.permission),
    isShared: row.permission !== 'owner',
  });

  return { owned: owned.rows.map(map), shared: shared.rows.map(map) };
}

export async function createDashboard(user, { name, description = null }) {
  const id = uuid();
  await q(
    `INSERT INTO dashboards (id, user_id, name, description, layout, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5::jsonb,NOW(),NOW())`,
    [id, user.id, name, description, JSON.stringify(DEFAULT_LAYOUT)],
  );
  await audit({ user }, 'dashboard.create', { dashboardId: id, name });
  return getDashboard(user, id);
}

async function loadWidgets(dashboardId) {
  const { rows } = await q(
    `SELECT w.id AS widget_id, w.position, w.chart_id,
            c.title, c.chart_type, c.configuration, c.dataset_id,
            d.name AS dataset_name
       FROM dashboard_widgets w
       JOIN charts c ON c.id = w.chart_id
       JOIN datasets d ON d.id = c.dataset_id
      WHERE w.dashboard_id = $1
      ORDER BY w.created_at`,
    [dashboardId],
  );
  return rows.map((r) => ({
    id: r.widget_id,
    chartId: r.chart_id,
    datasetId: r.dataset_id,
    datasetName: r.dataset_name,
    title: r.title,
    chartType: r.chart_type,
    configuration: r.configuration,
    position: r.position,
  }));
}

export async function getDashboard(user, dashboardId) {
  const access = await resolveDashboardAccess(user, dashboardId);
  if (!access) throw errors.notFound('Dashboard not found.');

  const widgets = await loadWidgets(dashboardId);
  const shares = await q(
    `SELECT s.user_id, s.permission, u.name, u.email
       FROM dashboard_shares s JOIN users u ON u.id = s.user_id
      WHERE s.dashboard_id = $1`,
    [dashboardId],
  );

  return {
    id: access.dashboard.id,
    name: access.dashboard.name,
    description: access.dashboard.description,
    layout: { ...DEFAULT_LAYOUT, ...(access.dashboard.layout || {}), widgets: widgets.map((w) => w.position) },
    widgets,
    shares: shares.rows.map((s) => ({
      userId: s.user_id,
      name: s.name,
      email: s.email,
      permission: s.permission,
    })),
    ownerName: access.dashboard.owner_name,
    permission: access.permission,
    canEdit: ['owner', 'edit'].includes(access.permission),
    isOwner: access.permission === 'owner',
    isShared: access.permission !== 'owner',
    createdAt: access.dashboard.created_at,
    updatedAt: access.dashboard.updated_at,
  };
}

export async function updateDashboard(user, dashboardId, patch) {
  const access = await resolveDashboardAccess(user, dashboardId);
  if (!access) throw errors.notFound('Dashboard not found.');
  if (!['owner', 'edit'].includes(access.permission)) {
    throw errors.forbidden('You have view-only access to this dashboard.');
  }

  const sets = [];
  const params = [dashboardId];
  if (patch.name !== undefined) {
    params.push(patch.name);
    sets.push(`name=$${params.length}`);
  }
  if (patch.description !== undefined) {
    params.push(patch.description);
    sets.push(`description=$${params.length}`);
  }
  if (patch.isDefault !== undefined) {
    if (access.permission !== 'owner') throw errors.forbidden('Only the owner can change the default dashboard.');
    if (patch.isDefault) {
      await q('UPDATE dashboards SET is_default=FALSE WHERE user_id=$1', [access.dashboard.user_id]);
    }
    params.push(patch.isDefault);
    sets.push(`is_default=$${params.length}`);
  }
  if (patch.layout !== undefined) {
    params.push(JSON.stringify(patch.layout));
    sets.push(`layout=$${params.length}::jsonb`);
  }

  if (sets.length) {
    await q(`UPDATE dashboards SET ${sets.join(', ')}, updated_at=NOW() WHERE id=$1`, params);
    await audit({ user }, 'dashboard.update', { dashboardId });
  }
  return getDashboard(user, dashboardId);
}

export async function deleteDashboard(user, dashboardId) {
  const access = await resolveDashboardAccess(user, dashboardId);
  if (!access) throw errors.notFound('Dashboard not found.');
  if (access.permission !== 'owner' && !hasRoleAtLeast(user, 'admin')) {
    throw errors.forbidden('Only the owner can delete this dashboard.');
  }
  await q('DELETE FROM dashboards WHERE id=$1', [dashboardId]);
  await audit({ user }, 'dashboard.delete', { dashboardId, name: access.dashboard.name });
  return { deleted: true };
}

export async function duplicateDashboard(user, dashboardId) {
  const access = await resolveDashboardAccess(user, dashboardId);
  if (!access) throw errors.notFound('Dashboard not found.');
  if (!['owner', 'edit'].includes(access.permission)) throw errors.forbidden();

  const newId = uuid();
  const widgets = await loadWidgets(dashboardId);

  await withTransaction(async (tx) => {
    await tx(
      `INSERT INTO dashboards (id, user_id, name, description, layout, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,NOW(),NOW())`,
      [
        newId,
        user.id,
        `${access.dashboard.name} (copy)`,
        access.dashboard.description,
        JSON.stringify({ ...DEFAULT_LAYOUT, ...(access.dashboard.layout || {}) }),
      ],
    );
    for (const widget of widgets) {
      await tx(
        `INSERT INTO dashboard_widgets (id, dashboard_id, chart_id, position, created_at)
         VALUES ($1,$2,$3,$4::jsonb,NOW())`,
        [uuid(), newId, widget.chartId, JSON.stringify(widget.position)],
      );
    }
  });

  await audit({ user }, 'dashboard.duplicate', { sourceDashboardId: dashboardId, dashboardId: newId });
  return getDashboard(user, newId);
}

/** Widgets: add/remove/reorder, validated against chart visibility. */
export async function setWidgets(user, dashboardId, widgets) {
  const access = await resolveDashboardAccess(user, dashboardId);
  if (!access) throw errors.notFound('Dashboard not found.');
  if (!['owner', 'edit'].includes(access.permission)) {
    throw errors.forbidden('You have view-only access to this dashboard.');
  }

  // Validate every referenced chart is visible to the dashboard owner.
  const ownerId = access.dashboard.user_id;
  const { rows: ownerRows } = await q('SELECT * FROM users WHERE id=$1', [ownerId]);
  const owner = ownerRows[0];

  const prepared = [];
  for (const widget of widgets) {
    const chart = await resolveChartAccess(owner, widget.chartId);
    if (!chart) {
      throw errors.validation('A chart on this dashboard is not accessible to its owner.', {
        chartId: widget.chartId,
      });
    }
    prepared.push({ chartId: widget.chartId, position: normalizePosition(widget.position) });
  }

  await withTransaction(async (tx) => {
    await tx('DELETE FROM dashboard_widgets WHERE dashboard_id=$1', [dashboardId]);
    for (const widget of prepared) {
      await tx(
        `INSERT INTO dashboard_widgets (id, dashboard_id, chart_id, position, created_at)
         VALUES ($1,$2,$3,$4::jsonb,NOW())`,
        [uuid(), dashboardId, widget.chartId, JSON.stringify(widget.position)],
      );
    }
    const layout = { columns: 12, widgets: prepared.map((w) => ({ chartId: w.chartId, ...w.position })) };
    await tx('UPDATE dashboards SET layout=$2::jsonb, updated_at=NOW() WHERE id=$1', [
      dashboardId,
      JSON.stringify(layout),
    ]);
  });

  await audit({ user }, 'dashboard.update_widgets', { dashboardId, widgetCount: prepared.length });
  const shares = await q('SELECT user_id FROM dashboard_shares WHERE dashboard_id=$1', [dashboardId]);
  emitDashboardRefresh(
    dashboardId,
    [ownerId, ...shares.rows.map((s) => s.user_id)],
    'widgets_updated',
  );
  return getDashboard(user, dashboardId);
}

function normalizePosition(pos = {}) {
  const clamp = (v, min, max, fallback) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(Math.max(Math.round(n), min), max) : fallback;
  };
  return {
    x: clamp(pos.x, 0, 12, 0),
    y: clamp(pos.y, 0, 1000, 0),
    w: clamp(pos.w, 3, 12, 6),
    h: clamp(pos.h, 2, 12, 4),
  };
}

export async function shareDashboard(user, dashboardId, { email, permission }) {
  const access = await resolveDashboardAccess(user, dashboardId);
  if (!access) throw errors.notFound('Dashboard not found.');
  if (access.permission !== 'owner') throw errors.forbidden('Only the owner can share this dashboard.');

  const { rows } = await q('SELECT id, name, email FROM users WHERE LOWER(email)=LOWER($1) AND is_active', [email]);
  const recipient = rows[0];
  if (!recipient) throw errors.notFound('No active account matches that email address.');
  if (recipient.id === user.id) throw errors.badRequest('You already own this dashboard.');

  await q(
    `INSERT INTO dashboard_shares (id, dashboard_id, user_id, permission, created_at)
     VALUES ($1,$2,$3,$4,NOW())
     ON CONFLICT (dashboard_id, user_id) DO UPDATE SET permission=EXCLUDED.permission`,
    [uuid(), dashboardId, recipient.id, permission],
  );
  await audit({ user }, 'dashboard.share', { dashboardId, recipient: recipient.email, permission });
  return getDashboard(user, dashboardId);
}

export async function revokeShare(user, dashboardId, targetUserId) {
  const access = await resolveDashboardAccess(user, dashboardId);
  if (!access || access.permission !== 'owner') throw errors.notFound('Dashboard not found.');
  await q('DELETE FROM dashboard_shares WHERE dashboard_id=$1 AND user_id=$2', [dashboardId, targetUserId]);
  await audit({ user }, 'dashboard.revoke_share', { dashboardId, targetUserId });
  return getDashboard(user, dashboardId);
}

// --- charts --------------------------------------------------------------

export async function resolveChartAccess(user, chartId) {
  const { rows } = await q('SELECT * FROM charts WHERE id=$1', [chartId]);
  const chart = rows[0];
  if (!chart) return null;
  if (chart.user_id === user.id) return { chart, permission: 'owner' };
  const dataset = await resolveDatasetAccess(user, chart.dataset_id);
  if (dataset) return { chart, permission: 'view' };
  if (hasRoleAtLeast(user, 'admin')) return { chart, permission: 'view' };
  return null;
}

export async function listCharts(user, { datasetId } = {}) {
  const params = [];
  let where = 'c.user_id = $1';
  params.push(user.id);
  if (datasetId) {
    params.push(datasetId);
    where += ` AND c.dataset_id = $${params.length}`;
  }
  const { rows } = await q(
    `SELECT c.*, d.name AS dataset_name
       FROM charts c JOIN datasets d ON d.id = c.dataset_id
      WHERE ${where} ORDER BY c.created_at DESC LIMIT 200`,
    params,
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    chartType: r.chart_type,
    datasetId: r.dataset_id,
    datasetName: r.dataset_name,
    configuration: r.configuration,
    createdAt: r.created_at,
  }));
}

export async function createChart(user, { datasetId, title, chartType, configuration }) {
  const access = await resolveDatasetAccess(user, datasetId);
  if (!access) throw errors.notFound('Dataset not found.');
  if (!['owner', 'edit'].includes(access.permission)) {
    throw errors.forbidden('You have view-only access to this dataset, so you cannot save charts from it.');
  }
  const id = uuid();
  await q(
    `INSERT INTO charts (id, dataset_id, user_id, title, chart_type, configuration, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,NOW(),NOW())`,
    [id, datasetId, user.id, title, chartType, JSON.stringify(configuration)],
  );
  await audit({ user }, 'chart.create', { chartId: id, datasetId, chartType });
  return { id, title, chartType, datasetId, configuration };
}

export async function updateChart(user, chartId, patch) {
  const access = await resolveChartAccess(user, chartId);
  if (!access) throw errors.notFound('Chart not found.');
  if (access.permission !== 'owner') throw errors.forbidden('Only the chart owner can edit it.');

  const sets = [];
  const params = [chartId];
  if (patch.title !== undefined) {
    params.push(patch.title);
    sets.push(`title=$${params.length}`);
  }
  if (patch.configuration !== undefined) {
    params.push(JSON.stringify(patch.configuration));
    sets.push(`configuration=$${params.length}::jsonb`);
  }
  if (sets.length) {
    await q(`UPDATE charts SET ${sets.join(', ')}, updated_at=NOW() WHERE id=$1`, params);
  }
  return { id: chartId, ...patch };
}

export async function deleteChart(user, chartId) {
  const access = await resolveChartAccess(user, chartId);
  if (!access) throw errors.notFound('Chart not found.');
  if (access.permission !== 'owner') throw errors.forbidden('Only the chart owner can delete it.');
  const widgets = await q('SELECT dashboard_id FROM dashboard_widgets WHERE chart_id=$1', [chartId]);
  await q('DELETE FROM charts WHERE id=$1', [chartId]);
  await audit({ user }, 'chart.delete', { chartId });
  const affected = [...new Set(widgets.rows.map((w) => w.dashboard_id))];
  for (const id of affected) emitDashboardRefresh(id, [user.id], 'chart_deleted');
  return { deleted: true, affectedDashboards: affected };
}
