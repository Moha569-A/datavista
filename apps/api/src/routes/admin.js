import { Router } from 'express';
import { z } from 'zod';
import { q } from '../db/index.js';
import { asyncHandler, errors } from '../lib/errors.js';
import { requireAuth, requireRole, hasRoleAtLeast, publicUser } from '../lib/auth.js';
import { validate } from '../lib/validate.js';
import { audit } from '../lib/audit.js';

const router = Router();
router.use(requireAuth, requireRole('admin', 'super_admin'));

/**
 * Privilege-escalation guard.
 *
 * Rules (PRD FR-07):
 *  - nobody may change their own role or deactivate their own account;
 *  - an admin may only act on analysts/viewers, never on other admins or the
 *    super admin;
 *  - only a super admin may grant the admin/super_admin roles;
 *  - the last active super admin cannot be demoted or suspended.
 */
function assertCanManage(actor, target) {
  if (actor.id === target.id) {
    throw errors.forbidden('You cannot change your own role or account status. Ask another administrator.');
  }
  if (!hasRoleAtLeast(actor, 'super_admin') && hasRoleAtLeast(target, 'admin')) {
    throw errors.forbidden('Administrators cannot modify other administrators.');
  }
  if (target.role === 'super_admin' && !hasRoleAtLeast(actor, 'super_admin')) {
    throw errors.forbidden('Only a super admin can modify a super admin account.');
  }
}

export async function assertNotLastSuperAdmin(targetUserId) {
  const { rows } = await q(
    `SELECT COUNT(*)::int AS count FROM users WHERE role='super_admin' AND is_active AND id <> $1`,
    [targetUserId],
  );
  if (rows[0].count === 0) {
    throw errors.conflict('This is the last active super admin. Promote another account first.');
  }
}

router.get(
  '/users',
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
    const search = String(req.query.search || '').trim();
    const role = String(req.query.role || '');
    const status = String(req.query.status || '');

    const params = [];
    const where = [];
    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      where.push(`(LOWER(u.name) LIKE $${params.length} OR LOWER(u.email) LIKE $${params.length})`);
    }
    if (['super_admin', 'admin', 'analyst', 'viewer'].includes(role)) {
      params.push(role);
      where.push(`u.role = $${params.length}`);
    }
    if (status === 'active') where.push('u.is_active = TRUE');
    if (status === 'suspended') where.push('u.is_active = FALSE');
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const total = await q(`SELECT COUNT(*)::int AS count FROM users u ${whereSql}`, params);
    const { rows } = await q(
      `SELECT u.id, u.name, u.email, u.role, u.is_active, u.last_login_at, u.created_at,
              (SELECT COUNT(*)::int FROM datasets d WHERE d.user_id = u.id) AS dataset_count,
              (SELECT COUNT(*)::int FROM dashboards d WHERE d.user_id = u.id) AS dashboard_count
         FROM users u ${whereSql}
        ORDER BY u.created_at DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, (page - 1) * pageSize],
    );

    res.json({
      data: rows.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        isActive: u.is_active,
        lastLoginAt: u.last_login_at,
        createdAt: u.created_at,
        datasetCount: u.dataset_count,
        dashboardCount: u.dashboard_count,
      })),
      pagination: { page, pageSize, total: total.rows[0].count },
    });
  }),
);

router.post(
  '/users',
  validate(
    z.object({
      name: z.string().trim().min(2).max(150),
      email: z.string().trim().toLowerCase().email(),
      password: z.string().min(10, 'Password must be at least 10 characters.'),
      role: z.enum(['super_admin', 'admin', 'analyst', 'viewer']),
    }),
  ),
  asyncHandler(async (req, res) => {
    const { name, email, password, role } = req.body;
    if (!hasRoleAtLeast(req.user, 'super_admin') && ['admin', 'super_admin'].includes(role)) {
      throw errors.forbidden('Only a super admin can create administrator accounts.');
    }
    const existing = await q('SELECT id FROM users WHERE LOWER(email)=LOWER($1)', [email]);
    if (existing.rows[0]) throw errors.conflict('An account with that email address already exists.');

    const { hashPassword, uuid } = await import('../lib/auth.js');
    const id = uuid();
    await q(
      `INSERT INTO users (id, name, email, password_hash, role, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,NOW(),NOW())`,
      [id, name, email, await hashPassword(password), role],
    );
    await audit(req, 'admin.user_created', { targetUserId: id, email, role });
    const { rows } = await q('SELECT id, name, email, role, is_active, created_at FROM users WHERE id=$1', [id]);
    res.status(201).json(publicUser(rows[0]));
  }),
);

router.patch(
  '/users/:id/role',
  validate(z.object({ role: z.enum(['super_admin', 'admin', 'analyst', 'viewer']) })),
  asyncHandler(async (req, res) => {
    const { rows } = await q('SELECT id, name, email, role, is_active FROM users WHERE id=$1', [req.params.id]);
    const target = rows[0];
    if (!target) throw errors.notFound('User not found.');

    assertCanManage(req.user, target);
    if (['admin', 'super_admin'].includes(req.body.role) && !hasRoleAtLeast(req.user, 'super_admin')) {
      throw errors.forbidden('Only a super admin can grant administrator roles.');
    }
    if (target.role === 'super_admin' && req.body.role !== 'super_admin') {
      await assertNotLastSuperAdmin(target.id);
    }

    // Bump token_version so any live session picks up the new role immediately.
    await q('UPDATE users SET role=$2, token_version=token_version+1, updated_at=NOW() WHERE id=$1', [
      target.id,
      req.body.role,
    ]);
    await audit(req, 'admin.role_changed', { targetUserId: target.id, from: target.role, to: req.body.role });
    res.json({ id: target.id, role: req.body.role, message: `Role updated to ${req.body.role}.` });
  }),
);

router.patch(
  '/users/:id/status',
  validate(z.object({ isActive: z.boolean() })),
  asyncHandler(async (req, res) => {
    const { rows } = await q('SELECT id, name, email, role, is_active FROM users WHERE id=$1', [req.params.id]);
    const target = rows[0];
    if (!target) throw errors.notFound('User not found.');

    assertCanManage(req.user, target);
    if (!req.body.isActive && target.role === 'super_admin') {
      await assertNotLastSuperAdmin(target.id);
    }

    await q('UPDATE users SET is_active=$2, token_version=token_version+1, updated_at=NOW() WHERE id=$1', [
      target.id,
      req.body.isActive,
    ]);
    await audit(req, req.body.isActive ? 'admin.user_activated' : 'admin.user_suspended', {
      targetUserId: target.id,
      email: target.email,
    });
    res.json({
      id: target.id,
      isActive: req.body.isActive,
      message: req.body.isActive
        ? 'Account reactivated. The user can sign in again.'
        : 'Account suspended. Existing sessions are invalidated immediately.',
    });
  }),
);

router.get(
  '/metrics',
  asyncHandler(async (_req, res) => {
    const [users, datasets, dashboards, charts, forecasts, jobs, failed, recent] = await Promise.all([
      q('SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE is_active)::int AS active FROM users'),
      q('SELECT COUNT(*)::int AS total, COALESCE(SUM(row_count),0)::int AS rows FROM datasets'),
      q('SELECT COUNT(*)::int AS total FROM dashboards'),
      q('SELECT COUNT(*)::int AS total FROM charts'),
      q('SELECT COUNT(*)::int AS total FROM forecast_runs'),
      q(`SELECT status, COUNT(*)::int AS count FROM datasets GROUP BY status`),
      q(`SELECT error_code, COUNT(*)::int AS count FROM datasets WHERE status='failed' GROUP BY error_code`),
      q(`SELECT COUNT(*)::int AS total FROM activity_logs WHERE created_at > NOW() - INTERVAL '24 hours'`),
    ]);

    const statusCounts = Object.fromEntries(jobs.rows.map((r) => [r.status, r.count]));
    const totalImports = Object.values(statusCounts).reduce((a, b) => a + b, 0);

    res.json({
      users: { total: users.rows[0].total, active: users.rows[0].active },
      datasets: {
        total: datasets.rows[0].total,
        rows: datasets.rows[0].rows,
        byStatus: {
          pending: statusCounts.pending || 0,
          processing: statusCounts.processing || 0,
          ready: statusCounts.ready || 0,
          failed: statusCounts.failed || 0,
        },
        successRate: totalImports ? Math.round(((statusCounts.ready || 0) / totalImports) * 1000) / 10 : 0,
      },
      dashboards: dashboards.rows[0].total,
      charts: charts.rows[0].total,
      forecasts: forecasts.rows[0].total,
      failures: failed.rows,
      actionsLast24h: recent.rows[0].total,
      generatedAt: new Date().toISOString(),
    });
  }),
);

router.get(
  '/activity',
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 25));
    const total = await q('SELECT COUNT(*)::int AS count FROM activity_logs');
    const { rows } = await q(
      `SELECT a.id, a.action, a.details, a.created_at, a.user_id, u.name AS user_name, u.email AS user_email
         FROM activity_logs a LEFT JOIN users u ON u.id = a.user_id
        ORDER BY a.created_at DESC LIMIT $1 OFFSET $2`,
      [pageSize, (page - 1) * pageSize],
    );
    res.json({ data: rows, pagination: { page, pageSize, total: total.rows[0].count } });
  }),
);

router.get(
  '/overview',
  asyncHandler(async (_req, res) => {
    const totals = await q(`
      SELECT
        (SELECT COUNT(*)::int FROM datasets) AS datasets,
        (SELECT COUNT(*)::int FROM users WHERE is_active) AS users,
        (SELECT COUNT(*)::int FROM charts) AS charts,
        (SELECT COUNT(*)::int FROM datasets WHERE status IN ('pending','processing')) AS processing,
        (SELECT COUNT(*)::int FROM datasets WHERE status='failed') AS failed,
        (SELECT COUNT(*)::int FROM dashboards) AS dashboards`);

    const byType = await q(
      `SELECT d.name, COUNT(c.id)::int AS chart_count FROM datasets d
         LEFT JOIN charts c ON c.dataset_id = d.id
        GROUP BY d.id, d.name ORDER BY chart_count DESC LIMIT 6`,
    );

    const trend = await q(
      `SELECT TO_CHAR(DATE_TRUNC('day', created_at), 'YYYY-MM-DD') AS day, COUNT(*)::int AS count
         FROM datasets
        WHERE created_at > NOW() - INTERVAL '14 days'
        GROUP BY 1 ORDER BY 1`,
    );

    res.json({
      kpis: totals.rows[0],
      datasetsByCharts: byType.rows,
      importTrend: trend.rows,
      generatedAt: new Date().toISOString(),
    });
  }),
);

export default router;
