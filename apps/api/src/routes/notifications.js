import { Router } from 'express';
import { q } from '../db/index.js';
import { asyncHandler, errors } from '../lib/errors.js';
import { requireAuth } from '../lib/auth.js';

const router = Router();
router.use(requireAuth);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { rows } = await q(
      `SELECT id, type, title, message, link, is_read, created_at
         FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 40`,
      [req.user.id],
    );
    const unread = await q('SELECT COUNT(*)::int AS count FROM notifications WHERE user_id=$1 AND is_read=FALSE', [
      req.user.id,
    ]);
    res.json({ data: rows, unreadCount: unread.rows[0].count });
  }),
);

router.post(
  '/read-all',
  asyncHandler(async (req, res) => {
    await q('UPDATE notifications SET is_read=TRUE WHERE user_id=$1 AND is_read=FALSE', [req.user.id]);
    res.json({ ok: true });
  }),
);

router.post(
  '/:id/read',
  asyncHandler(async (req, res) => {
    const { rowCount } = await q('UPDATE notifications SET is_read=TRUE WHERE id=$1 AND user_id=$2', [
      req.params.id,
      req.user.id,
    ]);
    if (!rowCount) throw errors.notFound('Notification not found.');
    res.json({ ok: true });
  }),
);

export default router;
