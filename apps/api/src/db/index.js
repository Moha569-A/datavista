import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

/**
 * Database adapter.
 *
 * The application speaks one dialect: parameterized SQL with `$n` placeholders.
 * Two drivers implement it:
 *   - `pg`     -> managed PostgreSQL (production)
 *   - `pglite` -> embedded PostgreSQL engine (local dev, CI, preview sandbox)
 *
 * Choosing PGlite for development keeps the schema, constraints and queries
 * identical to production without requiring a database server to boot the app.
 */
let impl = null;

async function initPglite() {
  const { PGlite } = await import('@electric-sql/pglite');
  fs.mkdirSync(config.pgliteDir, { recursive: true });
  const db = await PGlite.create({ dataDir: config.pgliteDir });
  return {
    driver: 'pglite',
    async query(sql, params = []) {
      const result = await db.query(sql, params);
      return { rows: result.rows ?? [], rowCount: result.affectedRows ?? result.rows?.length ?? 0 };
    },
    async exec(sql) {
      await db.exec(sql);
    },
    async transaction(fn) {
      return db.transaction(async (tx) => {
        const wrapped = async (sql, params = []) => {
          const result = await tx.query(sql, params);
          return { rows: result.rows ?? [], rowCount: result.affectedRows ?? result.rows?.length ?? 0 };
        };
        return fn(wrapped);
      });
    },
    async close() {
      await db.close();
    },
  };
}

async function initPg() {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    max: Number(process.env.PG_POOL_MAX || 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  return {
    driver: 'pg',
    async query(sql, params = []) {
      const result = await pool.query(sql, params);
      return { rows: result.rows, rowCount: result.rowCount ?? 0 };
    },
    async exec(sql) {
      await pool.query(sql);
    },
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const wrapped = async (sql, params = []) => {
          const result = await client.query(sql, params);
          return { rows: result.rows, rowCount: result.rowCount ?? 0 };
        };
        const out = await fn(wrapped);
        await client.query('COMMIT');
        return out;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}

export async function getDb() {
  if (impl) return impl;
  impl = config.dbDriver === 'pg' ? await initPg() : await initPglite();
  return impl;
}

export async function q(sql, params = []) {
  const db = await getDb();
  return db.query(sql, params);
}

export async function withTransaction(fn) {
  const db = await getDb();
  return db.transaction(fn);
}

export async function migrate() {
  const db = await getDb();
  const schemaPath = path.join(path.dirname(new URL(import.meta.url).pathname), 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  await db.exec(sql);
  return { applied: true, driver: db.driver };
}

export async function closeDb() {
  if (impl) {
    await impl.close();
    impl = null;
  }
}
