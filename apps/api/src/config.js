import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// src/config.js -> api -> apps -> repository root (three levels up).
const root = path.resolve(here, '../../..');

/**
 * Central configuration. Every value can be overridden by an environment
 * variable; .env.example documents the full surface. Secrets are never
 * defaulted in production (see assertProductionSafety).
 */
export const config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 8787),
  apiPrefix: '/api',
  clientOrigin: process.env.CLIENT_ORIGIN || '*',

  // --- database -----------------------------------------------------------
  // dev  -> embedded PGlite (no server required)
  // prod -> PostgreSQL via DATABASE_URL
  dbDriver: process.env.DB_DRIVER || 'pglite',
  databaseUrl: process.env.DATABASE_URL || '',
  pgliteDir: process.env.PGLITE_DIR || path.join(root, 'apps/api/.data/pglite'),

  // --- auth ---------------------------------------------------------------
  jwtSecret: process.env.JWT_SECRET || 'dev-insecure-jwt-secret-change-me',
  sessionCookie: process.env.SESSION_COOKIE || 'dv_session',
  csrfCookie: 'dv_csrf',
  sessionTtlHours: Number(process.env.SESSION_TTL_HOURS || 8),

  // --- storage ------------------------------------------------------------
  storageDir: process.env.STORAGE_DIR || path.join(root, 'apps/api/.data/storage'),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB || 20) * 1024 * 1024,
  maxRows: Number(process.env.MAX_ROWS || 50000),
  signedUrlTtlSeconds: Number(process.env.SIGNED_URL_TTL || 300),

  // --- analytics service --------------------------------------------------
  analyticsUrl: process.env.ANALYTICS_URL || 'http://127.0.0.1:8788',
  analyticsToken: process.env.ANALYTICS_SERVICE_TOKEN || 'dev-analytics-token',

  // --- limits -------------------------------------------------------------
  // Strict in production (20 auth attempts / 10 min). Development and test run
  // relaxed so iterative UI work and the E2E suite are not locked out; the
  // production value is enforced whenever NODE_ENV === 'production'.
  authRateLimit: Number(
    process.env.AUTH_RATE_LIMIT || (process.env.NODE_ENV === 'production' ? 20 : 500),
  ),
  apiRateLimit: Number(process.env.API_RATE_LIMIT || 600),
  previewMaxPageSize: 200,
};

export function assertProductionSafety(logger = console) {
  if (config.env !== 'production') return;
  if (config.jwtSecret.includes('dev-insecure')) {
    throw new Error('JWT_SECRET must be set in production.');
  }
  if (config.dbDriver === 'pg' && !config.databaseUrl) {
    throw new Error('DATABASE_URL is required when DB_DRIVER=pg.');
  }
  if (!process.env.ANALYTICS_SERVICE_TOKEN) {
    logger.warn('[config] ANALYTICS_SERVICE_TOKEN not set; using dev default. Rotate before release.');
  }
}

export function ensureDirs() {
  fs.mkdirSync(config.storageDir, { recursive: true });
  fs.mkdirSync(path.join(config.storageDir, 'datasets'), { recursive: true });
  fs.mkdirSync(config.pgliteDir, { recursive: true });
}

export { root };
