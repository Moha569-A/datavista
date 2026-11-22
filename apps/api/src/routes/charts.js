import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, errors } from '../lib/errors.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { validate } from '../lib/validate.js';
import { analytics } from '../lib/analytics.js';
import { loadDatasetRows, resolveDatasetAccess } from '../services/datasets.js';
import { createChart, deleteChart, listCharts, updateChart, CHART_TYPES, AGGREGATIONS } from '../services/dashboards.js';

const router = Router();
router.use(requireAuth);

const filterSchema = z.object({
  field: z.string().min(1).max(255),
  operator: z.enum(['eq', 'neq', 'contains', 'gt', 'gte', 'lt', 'lte']).default('eq'),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
});

const querySchema = z
  .object({
    datasetId: z.string().min(1),
    chartType: z.enum(CHART_TYPES),
    xField: z.string().max(255).nullish(),
    yField: z.string().max(255).nullish(),
    aggregation: z.enum(AGGREGATIONS).default('sum'),
    filters: z.array(filterSchema).max(10).default([]),
    limit: z.coerce.number().int().min(1).max(200).default(100),
    sort: z.enum(['asc', 'desc']).default('desc'),
  })
  .refine((v) => v.chartType === 'histogram' || Boolean(v.xField), {
    message: 'Choose an x-axis field.',
    path: ['xField'],
  });

/**
 * Chart data. The API is the authorization boundary: it verifies dataset
 * access, validates every requested column against the stored schema, then
 * delegates computation to the analytics service (TRD §4.3).
 */
router.post(
  '/query',
  validate(querySchema),
  asyncHandler(async (req, res) => {
    const { rows, dataset } = await loadDatasetRows(req.user, req.body.datasetId);
    const columnNames = new Set((dataset.columns || []).map((c) => c.name));

    for (const field of [req.body.xField, req.body.yField]) {
      if (field && !columnNames.has(field)) {
        throw errors.validation(`Column "${field}" is not part of this dataset.`, {
          field,
          availableColumns: [...columnNames].slice(0, 25),
        });
      }
    }
    for (const filter of req.body.filters) {
      if (!columnNames.has(filter.field)) {
        throw errors.validation(`Filter column "${filter.field}" is not part of this dataset.`, {
          field: filter.field,
        });
      }
    }

    const result = await analytics.query({
      rows,
      columns: (dataset.columns || []).map((c) => ({ name: c.name, type: c.type })),
      chartType: req.body.chartType,
      xField: req.body.xField ?? null,
      yField: req.body.yField ?? null,
      aggregation: req.body.aggregation,
      filters: req.body.filters,
      limit: req.body.limit,
      sort: req.body.sort,
    });

    res.json({
      ...result,
      meta: { ...result.meta, datasetId: dataset.id, computedAt: new Date().toISOString() },
    });
  }),
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ data: await listCharts(req.user, { datasetId: req.query.datasetId }) });
  }),
);

const saveSchema = z.object({
  datasetId: z.string().min(1),
  title: z.string().trim().min(1, 'Give the chart a title.').max(200),
  chartType: z.enum(CHART_TYPES),
  configuration: z.record(z.any()),
});

router.post(
  '/',
  requireRole('analyst', 'admin', 'super_admin'),
  validate(saveSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(await createChart(req.user, req.body));
  }),
);

router.post(
  '/validate',
  requireRole('analyst', 'admin', 'super_admin'),
  asyncHandler(async (req, res) => {
    const { datasetId, chartType, xField, yField, aggregation } = req.body || {};
    const access = await resolveDatasetAccess(req.user, datasetId);
    if (!access) throw errors.notFound('Dataset not found.');
    const columns = access.dataset.columns || [];
    const byName = Object.fromEntries(columns.map((c) => [c.name, c]));
    const problems = [];

    if (xField && !byName[xField]) problems.push(`"${xField}" is not a column in this dataset.`);
    if (yField && !byName[yField]) problems.push(`"${yField}" is not a column in this dataset.`);
    if (['sum', 'avg', 'median'].includes(aggregation) && yField && byName[yField]?.type !== 'number') {
      problems.push(`"${yField}" is text, so "${aggregation}" cannot be applied. Use count or a numeric field.`);
    }
    if (chartType === 'histogram' && yField && byName[yField]?.type !== 'number') {
      problems.push('Histograms require a numeric field.');
    }
    res.json({ compatible: problems.length === 0, problems });
  }),
);

router.patch(
  '/:id',
  validate(
    z.object({
      title: z.string().trim().min(1).max(200).optional(),
      configuration: z.record(z.any()).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    res.json(await updateChart(req.user, req.params.id, req.body));
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json(await deleteChart(req.user, req.params.id));
  }),
);

export default router;
