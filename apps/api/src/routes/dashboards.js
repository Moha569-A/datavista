import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/errors.js';
import { requireAuth } from '../lib/auth.js';
import { validate } from '../lib/validate.js';
import * as dashboards from '../services/dashboards.js';

const router = Router();
router.use(requireAuth);

const positionSchema = z.object({
  x: z.number().int().min(0).max(12),
  y: z.number().int().min(0).max(1000),
  w: z.number().int().min(3).max(12),
  h: z.number().int().min(2).max(12),
});

router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await dashboards.listDashboards(req.user));
  }),
);

router.post(
  '/',
  validate(
    z.object({
      name: z.string().trim().min(1, 'Give the dashboard a name.').max(200),
      description: z.string().trim().max(1000).nullish(),
    }),
  ),
  asyncHandler(async (req, res) => {
    res.status(201).json(await dashboards.createDashboard(req.user, req.body));
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json(await dashboards.getDashboard(req.user, req.params.id));
  }),
);

router.patch(
  '/:id',
  validate(
    z.object({
      name: z.string().trim().min(1).max(200).optional(),
      description: z.string().trim().max(1000).nullable().optional(),
      isDefault: z.boolean().optional(),
      layout: z.record(z.any()).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    res.json(await dashboards.updateDashboard(req.user, req.params.id, req.body));
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json(await dashboards.deleteDashboard(req.user, req.params.id));
  }),
);

router.post(
  '/:id/duplicate',
  asyncHandler(async (req, res) => {
    res.status(201).json(await dashboards.duplicateDashboard(req.user, req.params.id));
  }),
);

router.put(
  '/:id/widgets',
  validate(
    z.object({
      widgets: z
        .array(z.object({ chartId: z.string().min(1), position: positionSchema }))
        .max(60),
    }),
  ),
  asyncHandler(async (req, res) => {
    res.json(await dashboards.setWidgets(req.user, req.params.id, req.body.widgets));
  }),
);

router.post(
  '/:id/shares',
  validate(
    z.object({
      email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
      permission: z.enum(['view', 'edit']).default('view'),
    }),
  ),
  asyncHandler(async (req, res) => {
    res.json(await dashboards.shareDashboard(req.user, req.params.id, req.body));
  }),
);

router.delete(
  '/:id/shares/:userId',
  asyncHandler(async (req, res) => {
    res.json(await dashboards.revokeShare(req.user, req.params.id, req.params.userId));
  }),
);

export default router;
