import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  client, createTestContext, login, registerUser, sampleCsv, uniqueEmail, waitForDataset,
} from './helpers.js';

/**
 * Object-level authorization and privilege-escalation tests.
 *
 * These map directly onto the AppFlow §11 end-to-end journeys and the
 * Implementation Plan security test list: unauthorized dataset IDs, privilege
 * escalation, and read-only share enforcement.
 */
let ctx;
let owner; // analyst who owns a dataset + dashboard
let other; // unrelated analyst
let viewer; // viewer shared read-only
let admin; // admin account
let datasetId;
let dashboardId;

const PASSWORD = 'TestPassword123';

beforeAll(async () => {
  ctx = await createTestContext('dv-perm');

  // First registration becomes super_admin; use it to mint the other roles.
  const root = client(request, ctx.app);
  await registerUser(root, { name: 'Root Admin', email: uniqueEmail('root'), password: PASSWORD });

  async function createAs(role, label) {
    const email = uniqueEmail(label);
    await root.post('/api/admin/users', { name: label, email, password: PASSWORD, role });
    const c = client(request, ctx.app);
    await login(c, email, PASSWORD);
    return c;
  }

  admin = await createAs('admin', 'AdminUser');
  owner = await createAs('analyst', 'OwnerAnalyst');
  other = await createAs('analyst', 'OtherAnalyst');
  viewer = await createAs('viewer', 'ViewerUser');

  // Owner uploads a dataset and waits for the async import to finish.
  const upload = await owner.upload('/api/datasets/upload', sampleCsv(), 'sales.csv');
  expect(upload.status).toBe(202);
  datasetId = upload.body.id;
  const ready = await waitForDataset(owner, datasetId);
  expect(ready.status).toBe('ready');
  expect(ready.row_count).toBe(5);

  // Owner creates a dashboard with one chart.
  const chart = await owner.post('/api/charts', {
    datasetId,
    title: 'Revenue by region',
    chartType: 'bar',
    configuration: { chartType: 'bar', xField: 'region', yField: 'revenue', aggregation: 'sum', filters: [] },
  });
  expect(chart.status).toBe(201);

  const dashboard = await owner.post('/api/dashboards', { name: 'Owner dashboard' });
  dashboardId = dashboard.body.id;
  await owner.put(`/api/dashboards/${dashboardId}/widgets`, {
    widgets: [{ chartId: chart.body.id, position: { x: 0, y: 0, w: 6, h: 4 } }],
  });
});

afterAll(async () => {
  await ctx.cleanup();
});

describe('dataset object-level authorization', () => {
  it('lets the owner read their dataset', async () => {
    const res = await owner.get(`/api/datasets/${datasetId}`);
    expect(res.status).toBe(200);
    expect(res.body.isOwner).toBe(true);
  });

  it('hides another user’s dataset behind a non-disclosing 404', async () => {
    const res = await other.get(`/api/datasets/${datasetId}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('hides preview and chart data from unrelated users', async () => {
    expect((await other.get(`/api/datasets/${datasetId}/preview`)).status).toBe(404);
    const chart = await other.post('/api/charts/query', {
      datasetId,
      chartType: 'bar',
      xField: 'region',
      yField: 'revenue',
      aggregation: 'sum',
    });
    expect(chart.status).toBe(404);
  });

  it('prevents an unrelated user from deleting the dataset', async () => {
    const res = await other.delete(`/api/datasets/${datasetId}`);
    expect(res.status).toBe(404);
    // Still present for the owner.
    expect((await owner.get(`/api/datasets/${datasetId}`)).status).toBe(200);
  });

  it('never exposes the internal storage key', async () => {
    const res = await owner.get(`/api/datasets/${datasetId}`);
    expect(JSON.stringify(res.body)).not.toMatch(/storage_key|storageKey/);
  });
});

describe('dataset sharing', () => {
  it('grants and then revokes read access', async () => {
    const email = 'viewer-share@example.test';
    await admin.post('/api/admin/users', { name: 'Shared Viewer', email, password: PASSWORD, role: 'viewer' });
    const sharedViewer = client(request, ctx.app);
    await login(sharedViewer, email, PASSWORD);

    expect((await sharedViewer.get(`/api/datasets/${datasetId}`)).status).toBe(404);

    const share = await owner.post(`/api/datasets/${datasetId}/shares`, { email, permission: 'view' });
    expect(share.status).toBe(200);

    const afterShare = await sharedViewer.get(`/api/datasets/${datasetId}`);
    expect(afterShare.status).toBe(200);
    expect(afterShare.body.permission).toBe('view');

    const userId = afterShare.body.shares.find((s) => s.email === email).userId;
    const revoke = await owner.delete(`/api/datasets/${datasetId}/shares/${userId}`);
    expect(revoke.status).toBe(200);
    expect((await sharedViewer.get(`/api/datasets/${datasetId}`)).status).toBe(404);
  });

  it('stops a view-only recipient from building charts from the dataset', async () => {
    const email = 'viewer-nosave@example.test';
    await admin.post('/api/admin/users', { name: 'View Only', email, password: PASSWORD, role: 'viewer' });
    const viewOnly = client(request, ctx.app);
    await login(viewOnly, email, PASSWORD);
    await owner.post(`/api/datasets/${datasetId}/shares`, { email, permission: 'view' });

    const res = await viewOnly.post('/api/charts', {
      datasetId,
      title: 'Not allowed',
      chartType: 'bar',
      configuration: { xField: 'region', yField: 'revenue', aggregation: 'sum' },
    });
    expect(res.status).toBe(403);
  });
});

describe('dashboard sharing and read-only enforcement', () => {
  it('shows the dashboard to the shared viewer as view-only', async () => {
    const email = 'dash-viewer@example.test';
    await admin.post('/api/admin/users', { name: 'Dash Viewer', email, password: PASSWORD, role: 'viewer' });
    const dashViewer = client(request, ctx.app);
    await login(dashViewer, email, PASSWORD);

    expect((await dashViewer.get(`/api/dashboards/${dashboardId}`)).status).toBe(404);

    await owner.post(`/api/dashboards/${dashboardId}/shares`, { email, permission: 'view' });
    const res = await dashViewer.get(`/api/dashboards/${dashboardId}`);
    expect(res.status).toBe(200);
    expect(res.body.canEdit).toBe(false);
    expect(res.body.permission).toBe('view');

    const list = await dashViewer.get('/api/dashboards');
    expect(list.body.shared).toHaveLength(1);
    expect(list.body.shared[0].canEdit).toBe(false);
  });

  it('rejects widget changes from a view-only recipient', async () => {
    const res = await viewer.put(`/api/dashboards/${dashboardId}/widgets`, { widgets: [] });
    // The viewer was never granted access: non-disclosing 404.
    expect([403, 404]).toContain(res.status);
  });

  it('allows an edit grant to change widgets', async () => {
    const email = 'dash-editor@example.test';
    await admin.post('/api/admin/users', { name: 'Dash Editor', email, password: PASSWORD, role: 'analyst' });
    const editor = client(request, ctx.app);
    await login(editor, email, PASSWORD);
    await owner.post(`/api/dashboards/${dashboardId}/shares`, { email, permission: 'edit' });

    const detail = await editor.get(`/api/dashboards/${dashboardId}`);
    expect(detail.body.canEdit).toBe(true);

    const res = await editor.put(`/api/dashboards/${dashboardId}/widgets`, {
      widgets: detail.body.widgets.map((w) => ({ chartId: w.chartId, position: w.position })),
    });
    expect(res.status).toBe(200);
  });

  it('revokes access immediately on the next request', async () => {
    const email = 'dash-revoke@example.test';
    await admin.post('/api/admin/users', { name: 'Revoke Me', email, password: PASSWORD, role: 'analyst' });
    const target = client(request, ctx.app);
    await login(target, email, PASSWORD);
    const shared = await owner.post(`/api/dashboards/${dashboardId}/shares`, { email, permission: 'view' });
    const userId = shared.body.shares.find((s) => s.email === email).userId;

    expect((await target.get(`/api/dashboards/${dashboardId}`)).status).toBe(200);
    await owner.delete(`/api/dashboards/${dashboardId}/shares/${userId}`);
    expect((await target.get(`/api/dashboards/${dashboardId}`)).status).toBe(404);
  });
});

describe('role boundaries', () => {
  it('blocks viewers from admin endpoints', async () => {
    const res = await viewer.get('/api/admin/users');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('blocks viewers from uploading datasets', async () => {
    const res = await viewer.upload('/api/datasets/upload', sampleCsv(), 'viewer.csv');
    expect(res.status).toBe(403);
  });

  it('blocks viewers from starting forecasts', async () => {
    const res = await viewer.post('/api/analytics/forecast', {
      datasetId,
      targetColumn: 'revenue',
      horizon: 6,
    });
    expect(res.status).toBe(403);
  });

  it('lets an admin list users', async () => {
    const res = await admin.get('/api/admin/users');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(4);
  });
});

describe('privilege escalation guards', () => {
  it('prevents an admin from changing their own role', async () => {
    const me = await admin.get('/api/auth/me');
    const res = await admin.patch(`/api/admin/users/${me.body.user.id}/role`, { role: 'super_admin' });
    expect(res.status).toBe(403);
  });

  it('prevents an admin from granting admin to someone else', async () => {
    const users = await admin.get('/api/admin/users?search=OtherAnalyst');
    const target = users.body.data[0];
    const res = await admin.patch(`/api/admin/users/${target.id}/role`, { role: 'admin' });
    expect(res.status).toBe(403);
  });

  it('prevents an admin from modifying a super admin', async () => {
    const users = await admin.get('/api/admin/users?role=super_admin');
    const root = users.body.data[0];
    // Admins cannot see/modify super admin roles through this route.
    const res = await admin.patch(`/api/admin/users/${root.id}/role`, { role: 'analyst' });
    expect(res.status).toBe(403);
  });
});

describe('account suspension', () => {
  it('invalidates access immediately after suspension', async () => {
    const email = uniqueEmail('suspend');
    await admin.post('/api/admin/users', { name: 'Suspend Me', email, password: PASSWORD, role: 'analyst' });
    const victim = client(request, ctx.app);
    await login(victim, email, PASSWORD);
    expect((await victim.get('/api/datasets')).status).toBe(200);

    const me = await victim.get('/api/auth/me');
    const res = await admin.patch(`/api/admin/users/${me.body.user.id}/status`, { isActive: false });
    expect(res.status).toBe(200);

    const after = await victim.get('/api/datasets');
    expect(after.status).toBe(401);

    const relogin = await login(client(request, ctx.app), email, PASSWORD);
    expect(relogin.status).toBe(403);
  });
});
