import { q } from '../db/index.js';
import { uuid } from './auth.js';

/**
 * Audit trail. Administrative and security-relevant actions are appended here
 * and never updated or deleted by ordinary users (PRD FR-01 / schema §9).
 * Failures to write an audit record must not break the request, but they are
 * surfaced in logs so the gap is visible.
 */
export async function audit(req, action, details = {}) {
  try {
    await q(
      `INSERT INTO activity_logs (id, user_id, action, details, created_at)
       VALUES ($1, $2, $3, $4::jsonb, NOW())`,
      [uuid(), req.user?.id ?? null, action, JSON.stringify(clean(details))],
    );
  } catch (err) {
    console.error('[audit] failed to record action', action, err.message);
  }
}

function clean(obj) {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && String(v).length < 500),
  );
}

export async function notify(userId, { type, title, message, link = null }) {
  try {
    const id = uuid();
    await q(
      `INSERT INTO notifications (id, user_id, type, title, message, link, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [id, userId, type, title, message, link],
    );
    return id;
  } catch (err) {
    console.error('[notify] failed', err.message);
    return null;
  }
}
