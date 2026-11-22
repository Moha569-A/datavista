import { Router } from 'express';
import { z } from 'zod';
import { q } from '../db/index.js';
import { analytics as analyticsClient } from '../lib/analytics.js';
import { asyncHandler, errors } from '../lib/errors.js';
import { requireAuth, requireRole, uuid } from '../lib/auth.js';
import { validate } from '../lib/validate.js';
import { audit } from '../lib/audit.js';
import { loadDatasetRows } from '../services/datasets.js';
import { emitToUser } from '../lib/realtime-events.js';

const router = Router();
router.use(requireAuth, requireRole('analyst', 'admin', 'super_admin'));

/**
 * Forecast runs execute asynchronously: the request creates a job record and
 * returns immediately, results arrive over Socket.IO and via the run history
 * endpoint (AppFlow §7).
 */
router.post(
  '/forecast',
  validate(
    z.object({
      datasetId: z.string().min(1),
      targetColumn: z.string().min(1).max(255),
      timeField: z.string().max(255).nullish(),
      horizon: z.coerce.number().int().min(1).max(90).default(12),
      modelType: z.enum(['auto', 'linear', 'seasonal_naive', 'baseline']).default('auto'),
    }),
  ),
  asyncHandler(async (req, res) => {
    const { rows, dataset } = await loadDatasetRows(req.user, req.body.datasetId);
    const columnNames = new Set((dataset.columns || []).map((c) => c.name));
    if (!columnNames.has(req.body.targetColumn)) {
      throw errors.validation('Target column is not part of this dataset.', { targetColumn: 'Unknown column.' });
    }
    if (req.body.timeField && !columnNames.has(req.body.timeField)) {
      throw errors.validation('Time field is not part of this dataset.', { timeField: 'Unknown column.' });
    }

    const runId = uuid();
    await q(
      `INSERT INTO forecast_runs (id, dataset_id, user_id, target_column, time_field, horizon, model_type, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'processing')`,
      [runId, req.body.datasetId, req.user.id, req.body.targetColumn, req.body.timeField || null, req.body.horizon, req.body.modelType],
    );
    await audit(req, 'forecast.start', { runId, datasetId: req.body.datasetId, ...req.body });

    const userId = req.user.id;
    setImmediate(async () => {
      try {
        const result = await analyticsClient.forecast({
          rows,
          targetColumn: req.body.targetColumn,
          timeField: req.body.timeField || null,
          horizon: req.body.horizon,
          modelType: req.body.modelType,
        });
        await q(
          `UPDATE forecast_runs SET status='ready', model_type=$2, metrics=$3::jsonb, results=$4::jsonb WHERE id=$1`,
          [runId, result.modelType, JSON.stringify(result.metrics), JSON.stringify(result)],
        );
        emitToUser(userId, 'forecast:ready', {
          runId,
          datasetId: req.body.datasetId,
          message: `Forecast for "${req.body.targetColumn}" is ready.`,
          link: `/predictive?run=${runId}`,
        });
      } catch (err) {
        const message =
          err?.details?.details?.message || err?.message || 'The forecast could not be completed.';
        const code = err?.details?.code || 'FORECAST_FAILED';
        await q(
          `UPDATE forecast_runs SET status='failed', error_message=$2 WHERE id=$1`,
          [runId, message],
        );
        emitToUser(userId, 'forecast:failed', {
          runId,
          datasetId: req.body.datasetId,
          errorCode: code,
          message,
          link: `/predictive?run=${runId}`,
        });
      }
    });

    res.status(202).json({ id: runId, status: 'processing', message: 'Forecast started.' });
  }),
);

router.get(
  '/forecast',
  asyncHandler(async (req, res) => {
    const { rows } = await q(
      `SELECT f.id, f.dataset_id, f.target_column, f.time_field, f.horizon, f.model_type,
              f.status, f.metrics, f.error_message, f.created_at, d.name AS dataset_name
         FROM forecast_runs f JOIN datasets d ON d.id = f.dataset_id
        WHERE f.user_id = $1 ORDER BY f.created_at DESC LIMIT 50`,
      [req.user.id],
    );
    res.json({ data: rows });
  }),
);

router.get(
  '/forecast/:id',
  asyncHandler(async (req, res) => {
    const { rows } = await q(
      `SELECT f.*, d.name AS dataset_name FROM forecast_runs f
         JOIN datasets d ON d.id = f.dataset_id
        WHERE f.id = $1 AND f.user_id = $2`,
      [req.params.id, req.user.id],
    );
    if (!rows[0]) throw errors.notFound('Forecast run not found.');
    res.json(rows[0]);
  }),
);

/**
 * Suitability pre-flight so the UI can explain why a dataset cannot be
 * forecast before a job is created (UI spec §5.7).
 */
router.post(
  '/forecast/check',
  validate(
    z.object({
      datasetId: z.string().min(1),
      targetColumn: z.string().min(1),
      timeField: z.string().max(255).nullish(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const { rows, dataset } = await loadDatasetRows(req.user, req.body.datasetId);
    const columns = dataset.columns || [];
    const target = columns.find((c) => c.name === req.body.targetColumn);
    const problems = [];
    const notes = [];

    if (!target) problems.push('The selected target column is not part of this dataset.');
    else if (target.type !== 'number') {
      problems.push(`"${target.name}" is detected as ${target.type}. Forecasting needs a numeric target.`);
    }
    if (target && target.nullRatio > 0.2) {
      notes.push(`${Math.round(target.nullRatio * 100)}% of "${target.name}" is missing; the series will be smoothed.`);
    }
    if (rows.length < 12) problems.push(`Only ${rows.length} rows are available; at least 12 observations are needed.`);
    if (!req.body.timeField) {
      notes.push('No time field selected: rows will be treated as evenly spaced periods in their stored order.');
    } else {
      const timeCol = columns.find((c) => c.name === req.body.timeField);
      if (!timeCol) problems.push('The selected time field is not part of this dataset.');
      else if (!['date', 'number'].includes(timeCol.type)) {
        problems.push(`"${timeCol.name}" is detected as ${timeCol.type}; choose a date or numeric period field.`);
      }
    }

    res.json({
      suitable: problems.length === 0,
      problems,
      notes,
      observations: rows.length,
      targetType: target?.type ?? null,
    });
  }),
);

export default router;
