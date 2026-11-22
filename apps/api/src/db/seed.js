import { q, getDb } from './index.js';
import { hashPassword, uuid } from '../lib/auth.js';

/**
 * Demo seed.
 *
 * Creates one account per role plus a realistic dataset, chart and dashboard so
 * the application is explorable immediately. Seed rows are clearly labelled in
 * the README as demonstration data; nothing here is presented as live metrics.
 */
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'DataVista123';

const DEMO_USERS = [
  { name: 'Ada Okonkwo', email: 'super@datavista.dev', role: 'super_admin' },
  { name: 'Bello Musa', email: 'admin@datavista.dev', role: 'admin' },
  { name: 'Chika Eze', email: 'analyst@datavista.dev', role: 'analyst' },
  { name: 'Dayo Adamu', email: 'viewer@datavista.dev', role: 'viewer' },
];

/** Deterministic pseudo-random generator so demo data is reproducible. */
function makeRng(seed = 42) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function buildSalesRows() {
  const rng = makeRng(7);
  const regions = ['North', 'South', 'East', 'West', 'Central'];
  const categories = ['Software', 'Hardware', 'Services', 'Training', 'Support'];
  const channels = ['Online', 'Direct', 'Partner'];
  const rows = [];

  const start = new Date('2026-01-01T00:00:00Z');
  for (let day = 0; day < 300; day += 1) {
    const date = new Date(start.getTime() + day * 86400000);
    const trend = 1 + day * 0.004;
    const season = 1 + 0.18 * Math.sin((day / 30.4) * 2 * Math.PI);
    const weekday = date.getUTCDay();
    const weekendDip = weekday === 0 || weekday === 6 ? 0.72 : 1;

    const entries = 3 + Math.floor(rng() * 3);
    for (let i = 0; i < entries; i += 1) {
      const units = 2 + Math.floor(rng() * 40);
      const unitPrice = 90 + Math.round(rng() * 420);
      const revenue = Math.round(units * unitPrice * trend * season * weekendDip * (0.9 + rng() * 0.2));
      rows.push({
        date: date.toISOString().slice(0, 10),
        region: regions[Math.floor(rng() * regions.length)],
        category: categories[Math.floor(rng() * categories.length)],
        channel: channels[Math.floor(rng() * channels.length)],
        units,
        unit_price: unitPrice,
        revenue,
        satisfaction: Math.round((3.2 + rng() * 1.8) * 10) / 10,
      });
    }
  }
  return rows;
}

function buildWebsiteRows() {
  const rng = makeRng(21);
  const sources = ['Organic', 'Paid', 'Referral', 'Email', 'Social'];
  const devices = ['Desktop', 'Mobile', 'Tablet'];
  const rows = [];
  const start = new Date('2026-09-01T00:00:00Z');
  for (let day = 0; day < 60; day += 1) {
    const date = new Date(start.getTime() + day * 86400000);
    const base = 1800 + Math.round(rng() * 900) + day * 12;
    for (const source of sources) {
      rows.push({
        date: date.toISOString().slice(0, 10),
        source,
        device: devices[Math.floor(rng() * devices.length)],
        sessions: Math.round(base * (0.12 + rng() * 0.3)),
        conversions: Math.round(base * (0.004 + rng() * 0.02)),
      });
    }
  }
  return rows;
}

function profile(rows) {
  const names = Object.keys(rows[0]);
  const columns = names.map((name) => {
    const values = rows.map((r) => r[name]);
    const nonNull = values.filter((v) => v !== null && v !== undefined && v !== '');
    const numeric = nonNull.every((v) => typeof v === 'number');
    const isDate = typeof nonNull[0] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(nonNull[0]);
    const distinct = new Set(nonNull.map(String));
    const type = numeric ? 'number' : isDate ? 'date' : distinct.size < 30 ? 'category' : 'text';
    const column = {
      name,
      type,
      nullCount: values.length - nonNull.length,
      nullRatio: Number(((values.length - nonNull.length) / values.length).toFixed(4)),
      distinctCount: distinct.size,
    };
    if (numeric) {
      column.min = Math.min(...nonNull);
      column.max = Math.max(...nonNull);
      column.mean = Number((nonNull.reduce((a, b) => a + b, 0) / nonNull.length).toFixed(2));
    } else if (type === 'category') {
      const counts = {};
      for (const v of nonNull) counts[v] = (counts[v] || 0) + 1;
      column.topValues = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([value, count]) => ({ value, count }));
    }
    return column;
  });

  const valueCounts = {};
  for (const col of columns) {
    if (col.type === 'category') {
      const counts = {};
      for (const row of rows) counts[row[col.name]] = (counts[row[col.name]] || 0) + 1;
      valueCounts[col.name] = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 100)
        .map(([value, count]) => ({ value, count }));
    }
  }
  return { columns, valueCounts };
}

async function insertDataset({ ownerId, name, originalName, fileType, rows }) {
  const datasetId = uuid();
  const { columns, valueCounts } = profile(rows);
  await q(
    `INSERT INTO datasets (id, user_id, name, original_name, storage_key, file_type, file_size,
                           row_count, column_count, columns, warnings, status, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,'ready',NOW() - INTERVAL '2 days',NOW() - INTERVAL '2 days')`,
    [
      datasetId,
      ownerId,
      name,
      originalName,
      `seed-${datasetId}.${fileType}`,
      fileType,
      JSON.stringify(rows).length,
      rows.length,
      columns.length,
      JSON.stringify(columns),
      JSON.stringify([]),
    ],
  );

  const CHUNK = 400;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values = [];
    const params = [];
    chunk.forEach((row, idx) => {
      const base = idx * 3;
      params.push(datasetId, i + idx, JSON.stringify(row));
      values.push(`($${base + 1}, $${base + 2}, $${base + 3}::jsonb)`);
    });
    await q(`INSERT INTO dataset_rows (dataset_id, row_index, data) VALUES ${values.join(',')}`, params);
  }

  for (const [column, values] of Object.entries(valueCounts)) {
    await q(
      `INSERT INTO dataset_value_counts (dataset_id, column_name, values) VALUES ($1,$2,$3::jsonb)`,
      [datasetId, column, JSON.stringify(values)],
    );
  }

  await q(
    `INSERT INTO dataset_import_jobs (id, dataset_id, status, attempts, progress, started_at, finished_at, created_at)
     VALUES ($1,$2,'ready',1,100,NOW() - INTERVAL '2 days',NOW() - INTERVAL '2 days',NOW() - INTERVAL '2 days')`,
    [uuid(), datasetId],
  );

  return { datasetId, columns };
}

export async function seedIfEmpty({ force = false } = {}) {
  const db = await getDb();
  const existing = await q('SELECT COUNT(*)::int AS count FROM users');
  if (existing.rows[0].count > 0 && !force) {
    return { seeded: false };
  }

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const ids = {};

  for (const user of DEMO_USERS) {
    const id = uuid();
    ids[user.email] = id;
    await q(
      `INSERT INTO users (id, name, email, password_hash, role, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,NOW() - INTERVAL '20 days',NOW())`,
      [id, user.name, user.email, passwordHash, user.role],
    );
  }

  const analystId = ids['analyst@datavista.dev'];
  const adminId = ids['admin@datavista.dev'];
  const viewerId = ids['viewer@datavista.dev'];

  const sales = await insertDataset({
    ownerId: analystId,
    name: 'Quarterly sales performance',
    originalName: 'quarterly_sales_2026.csv',
    fileType: 'csv',
    rows: buildSalesRows(),
  });

  const web = await insertDataset({
    ownerId: adminId,
    name: 'Website traffic by source',
    originalName: 'website_traffic.xlsx',
    fileType: 'xlsx',
    rows: buildWebsiteRows(),
  });

  const revenueByRegion = {
    chartType: 'bar',
    xField: 'region',
    yField: 'revenue',
    aggregation: 'sum',
    filters: [],
    title: 'Revenue by region',
  };
  const revenueTrend = {
    chartType: 'line',
    xField: 'date',
    yField: 'revenue',
    aggregation: 'sum',
    filters: [],
    title: 'Revenue over time',
  };
  const categorySplit = {
    chartType: 'pie',
    xField: 'category',
    yField: 'revenue',
    aggregation: 'sum',
    filters: [],
    title: 'Revenue share by category',
  };
  const sessionsBySource = {
    chartType: 'bar',
    xField: 'source',
    yField: 'sessions',
    aggregation: 'sum',
    filters: [],
    title: 'Sessions by acquisition source',
  };

  const chartIds = [];
  for (const cfg of [revenueByRegion, revenueTrend, categorySplit]) {
    const id = uuid();
    chartIds.push(id);
    await q(
      `INSERT INTO charts (id, dataset_id, user_id, title, chart_type, configuration, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,NOW() - INTERVAL '1 day',NOW())`,
      [id, sales.datasetId, analystId, cfg.title, cfg.chartType, JSON.stringify(cfg)],
    );
  }
  const webChartId = uuid();
  await q(
    `INSERT INTO charts (id, dataset_id, user_id, title, chart_type, configuration, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,NOW() - INTERVAL '1 day',NOW())`,
    [webChartId, web.datasetId, adminId, sessionsBySource.title, sessionsBySource.chartType, JSON.stringify(sessionsBySource)],
  );

  const dashboardId = uuid();
  const positions = [
    { x: 0, y: 0, w: 6, h: 4 },
    { x: 6, y: 0, w: 6, h: 4 },
    { x: 0, y: 4, w: 6, h: 4 },
  ];
  await q(
    `INSERT INTO dashboards (id, user_id, name, description, layout, is_default, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5::jsonb,TRUE,NOW() - INTERVAL '1 day',NOW())`,
    [
      dashboardId,
      analystId,
      'Revenue overview',
      'Company-wide revenue performance across regions, time and product category.',
      JSON.stringify({
        columns: 12,
        widgets: chartIds.map((chartId, i) => ({ chartId, ...positions[i] })),
      }),
    ],
  );
  for (let i = 0; i < chartIds.length; i += 1) {
    await q(
      `INSERT INTO dashboard_widgets (id, dashboard_id, chart_id, position, created_at)
       VALUES ($1,$2,$3,$4::jsonb,NOW())`,
      [uuid(), dashboardId, chartIds[i], JSON.stringify(positions[i])],
    );
  }

  const adminDashboardId = uuid();
  await q(
    `INSERT INTO dashboards (id, user_id, name, description, layout, is_default, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5::jsonb,FALSE,NOW() - INTERVAL '1 day',NOW())`,
    [
      adminDashboardId,
      adminId,
      'Acquisition funnel',
      'Traffic and conversion performance by source.',
      JSON.stringify({ columns: 12, widgets: [{ chartId: webChartId, x: 0, y: 0, w: 12, h: 4 }] }),
    ],
  );
  await q(
    `INSERT INTO dashboard_widgets (id, dashboard_id, chart_id, position, created_at)
     VALUES ($1,$2,$3,$4::jsonb,NOW())`,
    [uuid(), adminDashboardId, webChartId, JSON.stringify({ x: 0, y: 0, w: 12, h: 4 })],
  );

  // The viewer can open the analyst's dashboard but cannot edit it.
  await q(
    `INSERT INTO dashboard_shares (id, dashboard_id, user_id, permission, created_at)
     VALUES ($1,$2,$3,'view',NOW())`,
    [uuid(), dashboardId, viewerId],
  );
  await q(
    `INSERT INTO dataset_permissions (id, dataset_id, user_id, permission, created_at)
     VALUES ($1,$2,$3,'view',NOW())`,
    [uuid(), sales.datasetId, viewerId],
  );

  // A stored forecast run so the Predictive Analytics screen has history.
  const forecastId = uuid();
  await q(
    `INSERT INTO forecast_runs (id, dataset_id, user_id, target_column, time_field, horizon, model_type,
                                metrics, results, status, created_at)
     VALUES ($1,$2,$3,'revenue','date',14,'linear',$4::jsonb,$5::jsonb,'ready',NOW() - INTERVAL '6 hours')`,
    [forecastId, sales.datasetId, analystId, JSON.stringify({ mae: 12450.2, rmse: 18320.7, mape: 6.4, r2: 0.71, n: 12 }), JSON.stringify({ seeded: true })],
  );

  await q(
    `INSERT INTO notifications (id, user_id, type, title, message, link, is_read, created_at)
     VALUES ($1,$2,'success','Dataset ready','Quarterly sales performance finished importing.','/datasets/' || $3, FALSE, NOW() - INTERVAL '2 days')`,
    [uuid(), analystId, sales.datasetId],
  );

  await q(
    `INSERT INTO activity_logs (id, user_id, action, details, created_at)
     VALUES ($1,$2,'dataset.upload',$3::jsonb,NOW() - INTERVAL '2 days')`,
    [uuid(), analystId, JSON.stringify({ datasetId: sales.datasetId, seeded: true })],
  );

  return {
    seeded: true,
    users: DEMO_USERS.map((u) => ({ email: u.email, role: u.role })),
    password: DEMO_PASSWORD,
  };
}

// Allow `npm run seed` as a standalone command.
if (process.argv[1] && process.argv[1].endsWith('seed.js')) {
  seedIfEmpty({ force: process.argv.includes('--force') })
    .then(async (res) => {
      console.log('[seed]', res);
      const { closeDb } = await import('./index.js');
      await closeDb();
    })
    .catch((err) => {
      console.error('[seed] failed', err);
      process.exit(1);
    });
}
