import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { config } from '../config.js';
import { asyncHandler, errors } from '../lib/errors.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { validate } from '../lib/validate.js';
import * as datasets from '../services/datasets.js';
import * as storage from '../lib/storage.js';
import { audit } from '../lib/audit.js';

const router = Router();
router.use(requireAuth);

const ALLOWED_EXT = ['.csv', '.xlsx'];
const ALLOWED_MIME = [
  'text/csv',
  'application/csv',
  'text/plain',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
];

/** Multer keeps files in memory: nothing touches disk before validation. */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf('.'));
    if (!ALLOWED_EXT.includes(ext)) {
      return cb(errors.badRequest(`Unsupported file type "${ext || 'unknown'}". Upload a .csv or .xlsx file.`));
    }
    if (file.mimetype && !ALLOWED_MIME.includes(file.mimetype)) {
      return cb(errors.badRequest(`Unsupported content type "${file.mimetype}". Upload a .csv or .xlsx file.`));
    }
    cb(null, true);
  },
}).single('file');

function handleUpload(req, res, next) {
  upload(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return next(
        errors.badRequest(`File is larger than the ${config.maxUploadBytes / (1024 * 1024)} MB limit.`, {
          maxMb: config.maxUploadBytes / (1024 * 1024),
        }),
      );
    }
    next(err);
  });
}

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(120).default(''),
  status: z.enum(['', 'pending', 'processing', 'ready', 'failed']).default(''),
});

router.get(
  '/',
  validate(listQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    res.json(await datasets.listDatasets(req.user, req.query));
  }),
);

router.post(
  '/upload',
  requireRole('analyst', 'admin', 'super_admin'),
  handleUpload,
  asyncHandler(async (req, res) => {
    if (!req.file) throw errors.badRequest('Select a .csv or .xlsx file to upload.', { file: 'Required.' });
    if (!req.file.size) throw errors.badRequest('That file is empty.', { file: 'The file has no content.' });
    const result = await datasets.createUpload(req.user, req.file);
    res.status(202).json({ ...result, message: 'Upload accepted. Processing has started.' });
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json(await datasets.getDataset(req.user, req.params.id, { includePreview: true }));
  }),
);

router.get(
  '/:id/preview',
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(config.previewMaxPageSize, Math.max(1, Number(req.query.pageSize) || 50));
    res.json(await datasets.previewDataset(req.user, req.params.id, { page, pageSize }));
  }),
);

router.patch(
  '/:id',
  validate(z.object({ name: z.string().trim().min(1, 'Enter a dataset name.').max(200) })),
  asyncHandler(async (req, res) => {
    res.json(await datasets.renameDataset(req.user, req.params.id, req.body.name));
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json(await datasets.deleteDataset(req.user, req.params.id));
  }),
);

router.post(
  '/:id/retry',
  asyncHandler(async (req, res) => {
    res.status(202).json(await datasets.retryImport(req.user, req.params.id));
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
    res.json(await datasets.shareDataset(req.user, req.params.id, req.body));
  }),
);

router.delete(
  '/:id/shares/:userId',
  asyncHandler(async (req, res) => {
    res.json(await datasets.revokeDatasetShare(req.user, req.params.id, req.params.userId));
  }),
);

router.get(
  '/:id/download-link',
  asyncHandler(async (req, res) => {
    res.json(await datasets.downloadInfo(req.user, req.params.id));
  }),
);

/**
 * Signed download. Authorization is re-checked against the token's subject, so
 * a leaked link cannot be replayed by a different account (TRD §8).
 */
router.get(
  '/:id/download',
  asyncHandler(async (req, res) => {
    const token = String(req.query.token || '');
    const payload = storage.verifyDownloadToken(token);
    if (payload.ds !== req.params.id) throw errors.forbidden('This download link is not valid for this dataset.');
    const access = await datasets.resolveDatasetAccess(req.user, req.params.id);
    if (!access) throw errors.notFound('Dataset not found.');
    const buffer = await storage.get(access.dataset.storage_key);
    await audit(req, 'dataset.download', { datasetId: req.params.id });
    res.setHeader('content-type', 'application/octet-stream');
    res.setHeader(
      'content-disposition',
      `attachment; filename="${access.dataset.original_name.replace(/[^\w.\-]/g, '_')}"`,
    );
    res.setHeader('x-content-type-options', 'nosniff');
    res.send(buffer);
  }),
);

export default router;
