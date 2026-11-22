import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { client, createTestContext, makeCsv, registerUser, uniqueEmail, waitForDataset } from './helpers.js';

let ctx;
let api;
let seriesId;
let analyticsUp = true;
let textOnlyId;

function seriesCsv() {
  const rows = [['date', 'revenue']];
  // A clear upward trend with mild noise: suitable for a linear model.
  for (let i = 0; i < 60; i += 1) {
    const day = new Date(Date.UTC(2026, 0, 1 + i));
    rows.push([day.toISOString().slice(0, 10), String(1000 + i * 25 + (i % 4) * 10)]);
  }
  return makeCsv(rows);
}

beforeAll(async () => {
  ctx = await createTestContext('dv-forecast');
  analyticsUp = ctx.analyticsUp;
  api = client(request, ctx.app);
  await registerUser(api, { name: 'Forecaster', email: uniqueEmail('forecaster') });

  const a = await api.upload('/api/datasets/upload', seriesCsv(), 'series.csv');
  await waitForDataset(api, a.body.id);
  seriesId = a.body.id;

  const b = await api.upload(
    '/api/datasets/upload',
    makeCsv([['name', 'note'], ['a', 'x'], ['b', 'y'], ['c', 'z']]),
    'text-only.csv',
  );
  await waitForDataset(api, b.body.id);
  textOnlyId = b.body.id;
});

afterAll(async () => {
  await ctx.cleanup();
});

describe('suitability checks', () => {
  it('approves a numeric time series', async () => {
    const res = await api.post('/api/analytics/forecast/check', {
      datasetId: seriesId, targetColumn: 'revenue', timeField: 'date',
    });
    expect(res.status).toBe(200);
    expect(res.body.suitable).toBe(true);
    expect(res.body.observations).toBe(60);
  });

  it('rejects a non-numeric target with an explanation', async () => {
    const res = await api.post('/api/analytics/forecast/check', {
      datasetId: textOnlyId, targetColumn: 'name',
    });
    expect(res.body.suitable).toBe(false);
    expect(res.body.problems.join(' ')).toMatch(/numeric/i);
  });

  it('rejects an unknown target column', async () => {
    const res = await api.post('/api/analytics/forecast/check', {
      datasetId: seriesId, targetColumn: 'does_not_exist',
    });
    expect(res.body.suitable).toBe(false);
  });

  it('notes when no time field is supplied', async () => {
    const res = await api.post('/api/analytics/forecast/check', {
      datasetId: seriesId, targetColumn: 'revenue',
    });
    expect(res.body.suitable).toBe(true);
    expect(res.body.notes.join(' ')).toMatch(/evenly spaced/i);
  });
});

describe('forecast runs', () => {
  async function runAndWait(payload) {
    const start = await api.post('/api/analytics/forecast', payload);
    expect(start.status).toBe(202);
    const id = start.body.id;
    const began = Date.now();
    while (Date.now() - began < 30000) {
      const res = await api.get(`/api/analytics/forecast/${id}`);
      if (res.body.status !== 'processing' && res.body.status !== 'pending') return res.body;
      await new Promise((r) => setTimeout(r, 400));
    }
    throw new Error('forecast did not complete');
  }

  it('produces predictions, metrics and a baseline comparison', async () => {
    const run = await runAndWait({
      datasetId: seriesId, targetColumn: 'revenue', timeField: 'date', horizon: 10, modelType: 'auto',
    });

    expect(run.status).toBe('ready');
    const results = run.results;
    expect(results.forecast).toHaveLength(10);
    expect(results.history.length).toBe(60);
    expect(results.metrics).toHaveProperty('rmse');
    expect(results.metrics).toHaveProperty('mae');
    expect(results.baselineMetrics).toHaveProperty('rmse');
    expect(Array.isArray(results.modelComparison)).toBe(true);
    expect(results.modelComparison.some((m) => m.modelType === 'baseline_naive')).toBe(true);
    expect(results.modelComparison.filter((m) => m.selected)).toHaveLength(1);
    expect(results.disclaimer).toMatch(/not guarantees/i);

    // Prediction intervals must bracket the point forecast.
    for (const point of results.forecast) {
      expect(point.lower).toBeLessThanOrEqual(point.predicted);
      expect(point.upper).toBeGreaterThanOrEqual(point.predicted);
    }
  });

  it('honours an explicit baseline model request', async () => {
    const run = await runAndWait({
      datasetId: seriesId, targetColumn: 'revenue', timeField: 'date', horizon: 5, modelType: 'baseline',
    });
    expect(run.model_type).toBe('baseline_naive');
  });

  it('stores run history for later review', async () => {
    const history = await api.get('/api/analytics/forecast');
    expect(history.status).toBe(200);
    expect(history.body.data.length).toBeGreaterThanOrEqual(2);
    const item = history.body.data[0];
    expect(item).toHaveProperty('target_column');
    expect(item).toHaveProperty('model_type');
  });

  it('fails cleanly on an unsuitable dataset', async () => {
    const start = await api.post('/api/analytics/forecast', {
      datasetId: textOnlyId, targetColumn: 'note', horizon: 6,
    });
    // Validation refuses the column before a run is created.
    expect([422, 202]).toContain(start.status);
    if (start.status === 202) {
      const began = Date.now();
      let run;
      while (Date.now() - began < 20000) {
        run = (await api.get(`/api/analytics/forecast/${start.body.id}`)).body;
        if (run.status === 'failed') break;
        await new Promise((r) => setTimeout(r, 300));
      }
      expect(run.status).toBe('failed');
      expect(run.error_message).toBeTruthy();
    }
  });

  it('rejects an out-of-range horizon', async () => {
    const res = await api.post('/api/analytics/forecast', {
      datasetId: seriesId, targetColumn: 'revenue', horizon: 500,
    });
    expect(res.status).toBe(422);
  });
});
