import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { client, createTestContext, makeCsv, registerUser, uniqueEmail, waitForDataset } from './helpers.js';

let ctx;
let api;
let datasetId;
let analyticsUp = true;

const CSV = makeCsv([
  ['region', 'category', 'revenue', 'units', 'date'],
  ['North', 'Software', '1000', '10', '2026-01-01'],
  ['South', 'Software', '500', '5', '2026-01-02'],
  ['North', 'Hardware', '1500', '15', '2026-01-03'],
  ['East', 'Services', '250', '2', '2026-01-04'],
  ['West', 'Hardware', '750', '7', '2026-01-05'],
]);

beforeAll(async () => {
  ctx = await createTestContext('dv-charts');
  analyticsUp = ctx.analyticsUp;
  api = client(request, ctx.app);
  await registerUser(api, { name: 'Chart Owner', email: uniqueEmail('chart-owner') });
  const up = await api.upload('/api/datasets/upload', CSV, 'chart-data.csv');
  await waitForDataset(api, up.body.id);
  datasetId = up.body.id;
});

afterAll(async () => {
  await ctx.cleanup();
});

describe('chart queries match the underlying data', () => {
  it('sums revenue by region correctly', async () => {
    const res = await api.post('/api/charts/query', {
      datasetId, chartType: 'bar', xField: 'region', yField: 'revenue', aggregation: 'sum',
    });
    expect(res.status).toBe(200);
    const map = Object.fromEntries(res.body.data.map((d) => [d.label, d.value]));
    expect(map.North).toBe(2500);
    expect(map.South).toBe(500);
    expect(map.East).toBe(250);
    expect(map.West).toBe(750);
    expect(res.body.meta.filteredRowCount).toBe(5);
  });

  it('computes averages, counts and distinct counts', async () => {
    const avg = await api.post('/api/charts/query', {
      datasetId, chartType: 'bar', xField: 'category', yField: 'revenue', aggregation: 'avg',
    });
    const avgMap = Object.fromEntries(avg.body.data.map((d) => [d.label, d.value]));
    expect(avgMap.Software).toBe(750); // (1000+500)/2
    expect(avgMap.Hardware).toBe(1125); // (1500+750)/2

    const count = await api.post('/api/charts/query', {
      datasetId, chartType: 'bar', xField: 'region', yField: 'revenue', aggregation: 'count',
    });
    const countMap = Object.fromEntries(count.body.data.map((d) => [d.label, d.value]));
    expect(countMap.North).toBe(2);

    const distinct = await api.post('/api/charts/query', {
      datasetId, chartType: 'bar', xField: 'region', yField: 'category', aggregation: 'count_distinct',
    });
    const distinctMap = Object.fromEntries(distinct.body.data.map((d) => [d.label, d.value]));
    expect(distinctMap.North).toBe(2); // Software + Hardware
  });

  it('applies filters before aggregating', async () => {
    const res = await api.post('/api/charts/query', {
      datasetId, chartType: 'bar', xField: 'region', yField: 'revenue', aggregation: 'sum',
      filters: [{ field: 'category', operator: 'eq', value: 'Hardware' }],
    });
    const map = Object.fromEntries(res.body.data.map((d) => [d.label, d.value]));
    expect(map.North).toBe(1500);
    expect(map.West).toBe(750);
    expect(map.Software).toBeUndefined();
    expect(res.body.meta.filteredRowCount).toBe(2);
  });

  it('supports numeric comparison filters', async () => {
    const res = await api.post('/api/charts/query', {
      datasetId, chartType: 'bar', xField: 'region', yField: 'revenue', aggregation: 'sum',
      filters: [{ field: 'revenue', operator: 'gte', value: 700 }],
    });
    const map = Object.fromEntries(res.body.data.map((d) => [d.label, d.value]));
    expect(map.East).toBeUndefined();
    expect(map.South).toBeUndefined();
    expect(map.North).toBe(2500);
  });

  it('orders line-chart labels chronologically', async () => {
    const res = await api.post('/api/charts/query', {
      datasetId, chartType: 'line', xField: 'date', yField: 'revenue', aggregation: 'sum', sort: 'desc',
    });
    const labels = res.body.data.map((d) => d.label);
    expect(labels).toEqual([...labels].sort());
  });

  it('builds a histogram from a numeric field', async () => {
    const res = await api.post('/api/charts/query', {
      datasetId, chartType: 'histogram', yField: 'revenue',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data.every((d) => typeof d.value === 'number')).toBe(true);
  });

  it('serves pie data as label/value pairs', async () => {
    const res = await api.post('/api/charts/query', {
      datasetId, chartType: 'pie', xField: 'category', yField: 'revenue', aggregation: 'sum',
    });
    expect(res.body.data.every((d) => 'label' in d && 'value' in d)).toBe(true);
  });
});

describe('chart query validation', () => {
  it('rejects unknown columns', async () => {
    const res = await api.post('/api/charts/query', {
      datasetId, chartType: 'bar', xField: 'not_a_column', yField: 'revenue', aggregation: 'sum',
    });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/not part of this dataset/i);
  });

  it('rejects an unsupported chart type', async () => {
    const res = await api.post('/api/charts/query', {
      datasetId, chartType: 'sunburst', xField: 'region', yField: 'revenue',
    });
    expect(res.status).toBe(422);
  });

  it.skipIf(!analyticsUp)('rejects sum over a text column with an explanation', async () => {
    const res = await api.post('/api/charts/query', {
      datasetId, chartType: 'bar', xField: 'region', yField: 'category', aggregation: 'sum',
    });
    expect([422, 502]).toContain(res.status);
    const message = JSON.stringify(res.body);
    expect(message).toMatch(/numeric|incompatible/i);
  });

  it('requires an x-axis field for bar charts', async () => {
    const res = await api.post('/api/charts/query', {
      datasetId, chartType: 'bar', yField: 'revenue', aggregation: 'sum',
    });
    expect(res.status).toBe(422);
  });

  it('caps the requested result limit', async () => {
    const res = await api.post('/api/charts/query', {
      datasetId, chartType: 'bar', xField: 'region', yField: 'revenue', aggregation: 'sum', limit: 5000,
    });
    expect(res.status).toBe(422);
  });

  it('explains incompatibilities through the validate endpoint', async () => {
    const bad = await api.post('/api/charts/validate', {
      datasetId, chartType: 'bar', xField: 'region', yField: 'category', aggregation: 'avg',
    });
    expect(bad.body.compatible).toBe(false);
    expect(bad.body.problems.length).toBeGreaterThan(0);

    const good = await api.post('/api/charts/validate', {
      datasetId, chartType: 'bar', xField: 'region', yField: 'revenue', aggregation: 'avg',
    });
    expect(good.body.compatible).toBe(true);
  });
});

describe('saved charts', () => {
  it('persists and returns the configuration', async () => {
    const configuration = {
      chartType: 'line', xField: 'date', yField: 'revenue', aggregation: 'sum', filters: [], title: 'Revenue trend',
    };
    const created = await api.post('/api/charts', {
      datasetId, title: 'Revenue trend', chartType: 'line', configuration,
    });
    expect(created.status).toBe(201);
    expect(created.body.configuration.xField).toBe('date');

    const list = await api.get(`/api/charts?datasetId=${datasetId}`);
    const found = list.body.data.find((c) => c.id === created.body.id);
    expect(found.title).toBe('Revenue trend');
    expect(found.configuration.aggregation).toBe('sum');
  });

  it('deletes a chart', async () => {
    const created = await api.post('/api/charts', {
      datasetId, title: 'Temp chart', chartType: 'bar', configuration: { xField: 'region', yField: 'revenue' },
    });
    const res = await api.delete(`/api/charts/${created.body.id}`);
    expect(res.status).toBe(200);
    const list = await api.get(`/api/charts?datasetId=${datasetId}`);
    expect(list.body.data.some((c) => c.id === created.body.id)).toBe(false);
  });
});
