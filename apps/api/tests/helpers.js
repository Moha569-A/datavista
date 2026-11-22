import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * Test harness.
 *
 * Each test file gets an isolated data directory (embedded PGlite + file
 * storage) so suites can run in parallel without sharing state. The Express app
 * is exercised through real HTTP requests via supertest, with cookies carried
 * manually to mimic a browser.
 */
export async function createTestContext(prefix = 'dv-test') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  process.env.DB_DRIVER = 'pglite';
  process.env.PGLITE_DIR = path.join(dir, 'pglite');
  process.env.STORAGE_DIR = path.join(dir, 'storage');
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-secret-not-for-production';
  process.env.AUTO_SEED = 'false';

  const { config } = await import('../src/config.js');
  config.dbDriver = 'pglite';
  config.pgliteDir = process.env.PGLITE_DIR;
  config.storageDir = process.env.STORAGE_DIR;
  config.jwtSecret = process.env.JWT_SECRET;
  config.env = 'test';

  const { migrate, closeDb } = await import('../src/db/index.js');
  const { createApp } = await import('../src/app.js');
  await migrate();
  const app = createApp();

  // The analytics service runs as its own process in development. Tests skip
  // cleanly (with a visible notice) instead of reporting false failures when
  // it is not running — see `npm run test:all` at the repo root.
  const { analytics } = await import('../src/lib/analytics.js');
  const analyticsUp = await analytics.health();
  if (!analyticsUp) {
    console.warn(
      '\n[test] Analytics service unreachable at ' + config.analyticsUrl +
      '. Analytics-dependent assertions will be skipped.\n' +
      '       Start it with:  cd services/analytics && uvicorn app.main:app --port 8788\n',
    );
  }

  return {
    app,
    analyticsUp,
    dir,
    async cleanup() {
      await closeDb();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Minimal cookie-aware agent so CSRF + session semantics are real. */
export function client(request, app) {
  const jar = new Map();
  const api = request(app);

  const attach = (req) => {
    if (jar.size) {
      req.set('Cookie', [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; '));
    }
    const csrf = jar.get('dv_csrf');
    if (csrf) req.set('x-csrf-token', csrf);
    return req;
  };

  const capture = (res) => {
    const cookies = res.headers['set-cookie'] || [];
    for (const cookie of cookies) {
      const [pair] = cookie.split(';');
      const idx = pair.indexOf('=');
      const name = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      if (value === '' ) jar.delete(name);
      else jar.set(name, value);
    }
    return res;
  };

  return {
    jar,
    get: (url) => attach(api.get(url)).then(capture),
    post: (url, body) => attach(api.post(url)).send(body).then(capture),
    patch: (url, body) => attach(api.patch(url)).send(body).then(capture),
    put: (url, body) => attach(api.put(url)).send(body).then(capture),
    delete: (url) => attach(api.delete(url)).then(capture),
    upload: (url, buffer, filename) =>
      attach(api.post(url)).attach('file', buffer, filename).then(capture),
    raw: api,
  };
}

export async function registerUser(api, { name, email, password = 'TestPassword123' }) {
  const res = await api.post('/api/auth/register', { name, email, password });
  return res;
}

export async function login(api, email, password = 'TestPassword123') {
  return api.post('/api/auth/login', { email, password });
}

export function makeCsv(rows) {
  return Buffer.from(rows.map((r) => r.join(',')).join('\n'), 'utf8');
}

export const sampleCsv = () =>
  makeCsv([
    ['region', 'category', 'revenue', 'units'],
    ['North', 'Software', '1200', '10'],
    ['South', 'Software', '800', '7'],
    ['North', 'Hardware', '450', '3'],
    ['East', 'Services', '900', '5'],
    ['West', 'Hardware', '1500', '12'],
  ]);

export function uniqueEmail(label = 'user') {
  return `${label}-${crypto.randomUUID().slice(0, 8)}@example.test`;
}

/** Poll a dataset until it leaves pending/processing (import is async). */
export async function waitForDataset(api, id, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await api.get(`/api/datasets/${id}`);
    if (res.status === 200 && ['ready', 'failed'].includes(res.body.status)) return res.body;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Dataset ${id} did not finish importing within ${timeoutMs}ms`);
}
