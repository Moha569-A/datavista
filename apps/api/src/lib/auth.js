import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { q } from '../db/index.js';
import { errors } from './errors.js';

export const ROLES = ['super_admin', 'admin', 'analyst', 'viewer'];

export const ROLE_RANK = { viewer: 1, analyst: 2, admin: 3, super_admin: 4 };

const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS || 11);

export const uuid = () => crypto.randomUUID();

export async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export function signSession(user) {
  // tokenVersion lets an administrator revoke sessions by bumping the counter.
  return jwt.sign(
    { sub: user.id, role: user.role, tv: user.token_version },
    config.jwtSecret,
    { expiresIn: `${config.sessionTtlHours}h`, issuer: 'datavista' },
  );
}

export function verifySession(token) {
  try {
    return jwt.verify(token, config.jwtSecret, { issuer: 'datavista' });
  } catch {
    return null;
  }
}

export function setSessionCookies(res, token) {
  const secure = config.env === 'production';
  res.cookie(config.sessionCookie, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: config.sessionTtlHours * 3600 * 1000,
    path: '/',
  });
  // Double-submit CSRF token: readable by JS, echoed in the X-CSRF-Token header.
  const csrf = crypto.randomBytes(24).toString('hex');
  res.cookie(config.csrfCookie, csrf, {
    httpOnly: false,
    sameSite: 'lax',
    secure,
    maxAge: config.sessionTtlHours * 3600 * 1000,
    path: '/',
  });
}

export function clearSessionCookies(res) {
  res.clearCookie(config.sessionCookie, { path: '/' });
  res.clearCookie(config.csrfCookie, { path: '/' });
}

const userColumns = `id, name, email, role, is_active, token_version, last_login_at, created_at`;

/**
 * Loads the authenticated user for each request. The database is the source of
 * truth for role and active state, so suspending an account takes effect on the
 * very next request (PRD acceptance criterion) rather than after token expiry.
 */
export async function loadUserFromCookie(req, _res, next) {
  try {
    const token = req.cookies?.[config.sessionCookie];
    if (!token) return next();
    const payload = verifySession(token);
    if (!payload) return next();

    const { rows } = await q(`SELECT ${userColumns} FROM users WHERE id = $1`, [payload.sub]);
    const user = rows[0];
    if (!user || !user.is_active || user.token_version !== payload.tv) return next();

    req.user = user;
    req.sessionToken = token;
    next();
  } catch (err) {
    next(err);
  }
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(errors.unauthorized('Your session has expired. Please sign in again.'));
  next();
}

/** Role gate — enforced server-side on every protected route (PRD FR-01). */
export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(errors.unauthorized());
    if (!roles.includes(req.user.role)) {
      return next(errors.forbidden('Your role does not grant access to this resource.'));
    }
    next();
  };
}

export function hasRoleAtLeast(user, role) {
  return (ROLE_RANK[user?.role] || 0) >= (ROLE_RANK[role] || 99);
}

/** CSRF: cookie auth requires the double-submit token on state changes. */
export function csrfProtection(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const cookieToken = req.cookies?.[config.csrfCookie];
  const headerToken = req.get('x-csrf-token');
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return next(errors.forbidden('Invalid or missing CSRF token. Refresh the page and try again.'));
  }
  next();
}

export function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.is_active,
    lastLoginAt: user.last_login_at,
    createdAt: user.created_at,
  };
}

export function permissionsFor(role) {
  return {
    canManageUsers: role === 'admin' || role === 'super_admin',
    canSuperAdmin: role === 'super_admin',
    canUploadDatasets: role !== 'viewer',
    canBuildCharts: role !== 'viewer',
    canRunForecasts: role !== 'viewer',
    canViewAdminMetrics: role === 'admin' || role === 'super_admin',
  };
}
