import { expect, test } from '@playwright/test';

/**
 * The end-to-end journey from AppFlow §11 and the Implementation Plan:
 * login → upload → preview → chart → dashboard → reload → share.
 */
const ANALYST = { email: 'analyst@datavista.dev', password: 'DataVista123' };
const VIEWER = { email: 'viewer@datavista.dev', password: 'DataVista123' };

async function signIn(page, { email, password }) {
  await page.goto('/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.locator('button[type=submit]').click();
  await expect(page.getByRole('heading', { name: /good (morning|afternoon|evening)/i })).toBeVisible();
}

test.beforeEach(async ({ context }) => {
  await context.clearCookies();
});

test('analyst uploads a dataset, builds a chart and saves a dashboard', async ({ page }) => {
  await signIn(page, ANALYST);

  // Unique name per run so repeated runs cannot collide with earlier fixtures.
  const runId = Date.now().toString(36).slice(-5);
  const datasetName = `e2e_sales_${runId}`;
  const chartTitle = `E2E revenue by region ${runId}`;
  const dashboardName = `E2E dashboard ${runId}`;

  // --- upload
  await page.getByRole('link', { name: 'Datasets' }).first().click();
  await page.getByRole('button', { name: /Upload dataset/i }).click();
  await page.locator('#dataset-file-input').setInputFiles({
    name: `${datasetName}.csv`,
    mimeType: 'text/csv',
    buffer: Buffer.from('region,category,revenue\nNorth,Software,1200\nSouth,Hardware,800\nEast,Services,1500\n'),
  });
  await page.getByRole('button', { name: /Upload & process/i }).click();

  // Live status event flips the row to READY without a reload.
  const row = page.getByRole('row', { name: new RegExp(datasetName) });
  await expect(row).toBeVisible();
  await expect(row.getByText('Ready', { exact: true })).toBeVisible({ timeout: 25_000 });

  // --- preview
  await page.getByRole('link', { name: new RegExp(datasetName) }).first().click();
  const profile = page.getByLabel('Column profile');
  await expect(profile).toBeVisible();
  await expect(profile.getByRole('cell', { name: 'revenue' })).toBeVisible();
  await expect(profile.getByRole('cell', { name: 'number' })).toBeVisible();

  // --- chart
  await page.getByRole('link', { name: /New chart/i }).click();
  await expect(page.getByText('Chart builder')).toBeVisible();
  await page.getByRole('button', { name: 'Suggest fields' }).click();
  await expect(page.locator('.recharts-bar-rectangle').first()).toBeVisible({ timeout: 20_000 });
  await page.locator('#chart-title').fill(chartTitle);
  await page.getByRole('button', { name: /^Save chart$/ }).click();
  await page.getByRole('button', { name: /Save chart/i }).last().click();
  await expect(page.getByText('Chart saved')).toBeVisible();

  // --- dashboard
  await page.getByRole('link', { name: 'My Dashboards' }).first().click();
  await page.getByRole('button', { name: /New dashboard/i }).click();
  await page.locator('#dash-name').fill(dashboardName);
  await page.getByRole('button', { name: /Create dashboard/i }).click();
  await expect(page.getByRole('heading', { name: dashboardName })).toBeVisible();

  await page.getByRole('button', { name: /Add a chart/i }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).first().click();
  await page.getByRole('button', { name: /Save layout/i }).click();
  await expect(page.getByText('Layout saved')).toBeVisible();

  // --- persistence across a reload
  await page.reload();
  await expect(page.getByRole('heading', { name: dashboardName })).toBeVisible();
  await expect(page.locator('.recharts-bar-rectangle').first()).toBeVisible({ timeout: 20_000 });
});

test('invalid upload is rejected with an actionable message', async ({ page }) => {
  await signIn(page, ANALYST);
  await page.getByRole('link', { name: 'Datasets' }).first().click();
  await page.getByRole('button', { name: /Upload dataset/i }).click();
  await page.locator('#dataset-file-input').setInputFiles({
    name: 'notes.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 not a spreadsheet'),
  });
  await expect(page.getByText(/Only \.csv and \.xlsx files are supported/i)).toBeVisible();
});

test('viewer sees only shared dashboards and cannot edit them', async ({ page }) => {
  await signIn(page, VIEWER);

  const nav = page.getByRole('navigation');
  await expect(nav.getByRole('link', { name: 'Datasets' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'User Management' })).toHaveCount(0);

  // Direct navigation to a protected route is redirected.
  await page.goto('/admin/users');
  await expect(page).toHaveURL(/\/overview$/);

  await page.getByRole('link', { name: 'My Dashboards' }).first().click();
  await page.getByText('Revenue overview').first().click();
  await expect(page.getByText(/view only/i).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Add chart/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Save layout/i })).toHaveCount(0);
});
