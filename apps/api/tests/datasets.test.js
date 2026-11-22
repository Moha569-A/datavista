import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  client, createTestContext, makeCsv, registerUser, sampleCsv, uniqueEmail, waitForDataset,
} from './helpers.js';

let ctx;
let api;
let analyticsUp = true;

beforeAll(async () => {
  ctx = await createTestContext('dv-datasets');
  analyticsUp = ctx.analyticsUp;
  api = client(request, ctx.app);
  await registerUser(api, { name: 'Dataset Owner', email: uniqueEmail('ds-owner') });
});

afterAll(async () => {
  await ctx.cleanup();
});

describe('upload validation', () => {
  it('accepts a valid CSV and imports it asynchronously', async () => {
    const res = await api.upload('/api/datasets/upload', sampleCsv(), 'sales.csv');
    expect(res.status).toBe(202);
    expect(res.body.status).toBe('pending');

    const ready = await waitForDataset(api, res.body.id);
    expect(ready.status).toBe('ready');
    expect(ready.row_count).toBe(5);
    expect(ready.column_count).toBe(4);

    const revenue = ready.columns.find((c) => c.name === 'revenue');
    expect(revenue.type).toBe('number');
    const region = ready.columns.find((c) => c.name === 'region');
    expect(['category', 'text']).toContain(region.type);
  });

  it('rejects unsupported extensions with an actionable message', async () => {
    const res = await api.upload('/api/datasets/upload', Buffer.from('hello'), 'notes.txt');
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/csv or \.xlsx/i);
  });

  it('rejects empty files', async () => {
    const res = await api.upload('/api/datasets/upload', Buffer.alloc(0), 'empty.csv');
    expect([400, 422]).toContain(res.status);
  });

  it.skipIf(!analyticsUp)('rejects a header-only file', async () => {
    const res = await api.upload('/api/datasets/upload', makeCsv([['a', 'b', 'c']]), 'header-only.csv');
    expect(res.status).toBe(202);
    const ready = await waitForDataset(api, res.body.id);
    expect(ready.status).toBe('failed');
    expect(ready.error_code).toBe('NO_ROWS');
    expect(ready.error_message).toMatch(/no data rows/i);
  });

  it('marks a malformed spreadsheet as failed rather than ready', async () => {
    const res = await api.upload(
      '/api/datasets/upload',
      Buffer.from('not,a,real,xlsx\nbinary,garbage'),
      'fake.xlsx',
    );
    expect(res.status).toBe(202);
    const done = await waitForDataset(api, res.body.id);
    expect(done.status).toBe('failed');
    expect(done.error_code).toBeTruthy();
  });

  it('requires a file in the request', async () => {
    const res = await api.post('/api/datasets/upload', {});
    expect(res.status).toBe(400);
  });
});

describe('schema profiling and quality warnings', () => {
  it('reports missing values, duplicates and inconsistencies', async () => {
    const csv = makeCsv([
      ['id', 'amount', 'region'],
      ['1', '100', 'North'],
      ['2', 'unknown', 'South'],
      ['2', 'unknown', 'South'],
      ['2', 'unknown', 'South'],
      ['four', '', ''],
      ['5', '250', 'East'],
    ]);
    const res = await api.upload('/api/datasets/upload', csv, 'messy.csv');
    const done = await waitForDataset(api, res.body.id);

    expect(done.status).toBe('ready');
    expect(done.duplicate_rows).toBeGreaterThanOrEqual(1);
    const codes = done.warnings.map((w) => w.code);
    expect(codes).toContain('DUPLICATE_ROWS');
    expect(codes).toContain('MISSING_VALUES');
    expect(codes).toContain('TYPE_INCONSISTENCY');
  });

  it('paginates previews and enforces the page size cap', async () => {
    const rows = [['n', 'v']];
    for (let i = 0; i < 120; i += 1) rows.push([String(i), String(i * 2)]);
    const res = await api.upload('/api/datasets/upload', makeCsv(rows), 'many.csv');
    const done = await waitForDataset(api, res.body.id);

    const page1 = await api.get(`/api/datasets/${done.id}/preview?page=1&pageSize=50`);
    expect(page1.status).toBe(200);
    expect(page1.body.rows).toHaveLength(50);
    expect(page1.body.pagination.totalPages).toBe(3);

    const page3 = await api.get(`/api/datasets/${done.id}/preview?page=3&pageSize=50`);
    expect(page3.body.rows).toHaveLength(20);

    // Oversized pageSize is clamped server-side, never trusted.
    const huge = await api.get(`/api/datasets/${done.id}/preview?pageSize=100000`);
    expect(huge.body.rows.length).toBeLessThanOrEqual(200);
  });
});

describe('dataset lifecycle', () => {
  it('renames, lists and deletes a dataset', async () => {
    const res = await api.upload('/api/datasets/upload', sampleCsv(), 'lifecycle.csv');
    const done = await waitForDataset(api, res.body.id);

    const renamed = await api.patch(`/api/datasets/${done.id}`, { name: 'Renamed dataset' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe('Renamed dataset');

    const list = await api.get('/api/datasets?search=renamed');
    expect(list.body.data.some((d) => d.id === done.id)).toBe(true);

    const deleted = await api.delete(`/api/datasets/${done.id}`);
    expect(deleted.status).toBe(200);
    expect((await api.get(`/api/datasets/${done.id}`)).status).toBe(404);
  });

  it('rejects an invalid name', async () => {
    const res = await api.upload('/api/datasets/upload', sampleCsv(), 'named.csv');
    const done = await waitForDataset(api, res.body.id);
    const bad = await api.patch(`/api/datasets/${done.id}`, { name: '   ' });
    expect(bad.status).toBe(422);
  });

  it('returns a short-lived signed download link', async () => {
    const res = await api.upload('/api/datasets/upload', sampleCsv(), 'download.csv');
    const done = await waitForDataset(api, res.body.id);
    const link = await api.get(`/api/datasets/${done.id}/download-link`);
    expect(link.status).toBe(200);
    expect(link.body.url).toMatch(/token=/);
    expect(link.body.expiresInSeconds).toBeLessThanOrEqual(300);
  });
});

describe('error contract', () => {
  it('returns code, message and requestId for unknown routes', async () => {
    const res = await api.get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.requestId).toBeTruthy();
  });

  it('returns validation details for bad query parameters', async () => {
    const res = await api.get('/api/datasets?page=0&pageSize=9999');
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.fields).toBeTruthy();
  });
});
