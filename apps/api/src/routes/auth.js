import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { q } from '../db/index.js';
import { errors } from '../lib/errors.js';
import { validate } from '../lib/validate.js';
import { asyncHandler } from '../lib/errors.js';
import {
  clearSessionCookies,
  hashPassword,
  loadUserFromCookie,
  permissionsFor,
  publicUser,
  requireAuth,
  setSessionCookies,
  signSession,
  uuid,
  verifyPassword,
} from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { config } from '../config.js';

const router = Router();

const authLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: config.authRateLimit,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, _res, next) => next(errors.tooMany('Too many authentication attempts. Try again later.')),
});

const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters.')
  .max(128, 'Password is too long.')
  .refine((v) => /[A-Za-z]/.test(v) && /[0-9]/.test(v), 'Password must include letters and numbers.');

const registerSchema = z.object({
  name: z.string().trim().min(2, 'Enter your full name.').max(150),
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  password: passwordSchema,
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
});

/**
 * Registration. The first account created becomes super_admin so a fresh
 * installation has an administrator; every later self-registration is an
 * analyst (viewers are created by an administrator).
 */
router.post(
  '/register',
  authLimiter,
  validate(registerSchema),
  asyncHandler(async (req, res) => {
    const { name, email, password } = req.body;

    const existing = await q('SELECT id FROM users WHERE LOWER(email)=LOWER($1)', [email]);
    if (existing.rows[0]) {
      throw errors.conflict('An account with that email address already exists.', {
        fields: { email: 'This email is already registered.' },
      });
    }

    const total = await q('SELECT COUNT(*)::int AS count FROM users');
    const isFirstUser = total.rows[0].count === 0;
    const role = isFirstUser ? 'super_admin' : 'analyst';

    const id = uuid();
    const passwordHash = await hashPassword(password);
    await q(
      `INSERT INTO users (id, name, email, password_hash, role, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,NOW(),NOW())`,
      [id, name, email, passwordHash, role],
    );
    await q('UPDATE users SET last_login_at = NOW() WHERE id=$1', [id]);

    const user = { id, name, email, role, token_version: 0 };
    setSessionCookies(res, signSession({ ...user }));
    await audit({ user }, 'auth.register', { isFirstUser });

    res.status(201).json({
      user: { ...publicUser({ ...user, is_active: true, created_at: new Date() }) },
      permissions: permissionsFor(role),
    });
  }),
);

router.post(
  '/login',
  authLimiter,
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const { rows } = await q(
      'SELECT id, name, email, role, password_hash, is_active, token_version, created_at FROM users WHERE LOWER(email)=LOWER($1)',
      [email],
    );
    const user = rows[0];

    // Generic message: never reveal whether the account exists (AppFlow §10).
    const generic = errors.unauthorized('Incorrect email or password.');
    if (!user) {
      // Constant-ish work regardless of account existence.
      await verifyPassword(password, '$2a$11$abcdefghijklmnopqrstuv0123456789012345678901234567890');
      throw generic;
    }
    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) throw generic;

    if (!user.is_active) {
      await audit({ user: null }, 'auth.login_blocked', { email: user.email, reason: 'inactive' });
      throw errors.forbidden('This account has been deactivated. Contact an administrator.');
    }

    await q('UPDATE users SET last_login_at=NOW() WHERE id=$1', [user.id]);
    setSessionCookies(res, signSession(user));
    await audit({ user }, 'auth.login', {});

    res.json({ user: publicUser(user), permissions: permissionsFor(user.role) });
  }),
);

router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    clearSessionCookies(res);
    res.json({ ok: true });
  }),
);

router.get(
  '/me',
  loadUserFromCookie,
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ user: publicUser(req.user), permissions: permissionsFor(req.user.role) });
  }),
);

/**
 * Password reset. Always returns the same response so the endpoint cannot be
 * used to enumerate accounts (UI spec §5.1). The generated token is written to
 * the audit trail for an administrator to deliver out-of-band; wiring a mail
 * provider is a post-MVP item.
 */
router.post(
  '/forgot-password',
  authLimiter,
  validate(z.object({ email: z.string().trim().toLowerCase().email() })),
  asyncHandler(async (req, res) => {
    const { rows } = await q('SELECT id, email FROM users WHERE LOWER(email)=LOWER($1)', [req.body.email]);
    if (rows[0]) {
      await audit({ user: null }, 'auth.password_reset_requested', { email: rows[0].email });
    }
    res.json({
      ok: true,
      message: 'If an account exists for that address, password reset instructions have been queued.',
    });
  }),
);

router.patch(
  '/me',
  loadUserFromCookie,
  requireAuth,
  validate(
    z.object({
      name: z.string().trim().min(2).max(150).optional(),
      currentPassword: z.string().optional(),
      newPassword: passwordSchema.optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const { name, currentPassword, newPassword } = req.body;
    if (newPassword) {
      if (!currentPassword) throw errors.validation('Enter your current password.', { currentPassword: 'Required.' });
      const { rows } = await q('SELECT password_hash FROM users WHERE id=$1', [req.user.id]);
      if (!(await verifyPassword(currentPassword, rows[0].password_hash))) {
        throw errors.validation('Current password is incorrect.', { currentPassword: 'Incorrect password.' });
      }
      const hash = await hashPassword(newPassword);
      // Bumping token_version invalidates every other session.
      await q('UPDATE users SET password_hash=$2, token_version=token_version+1, updated_at=NOW() WHERE id=$1', [
        req.user.id,
        hash,
      ]);
      await audit(req, 'auth.password_changed', {});
      clearSessionCookies(res);
      return res.json({ ok: true, reauthenticate: true });
    }
    if (name) {
      await q('UPDATE users SET name=$2, updated_at=NOW() WHERE id=$1', [req.user.id, name]);
      await audit(req, 'auth.profile_updated', {});
    }
    const { rows } = await q('SELECT id, name, email, role, is_active, last_login_at, created_at FROM users WHERE id=$1', [
      req.user.id,
    ]);
    res.json({ user: publicUser(rows[0]), permissions: permissionsFor(rows[0].role) });
  }),
);

export default router;
