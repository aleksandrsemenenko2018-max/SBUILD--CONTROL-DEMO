const assert = require('node:assert/strict');
const { test } = require('node:test');
const { launchBrowser, openPage, siteOrigin } = require('./browser-fixture.cjs');

const user = { id: '00000000-0000-4000-8000-000000000101', aud: 'authenticated' };
const first = { id: '00000000-0000-4000-8000-000000000102', name: 'Об’єкт А', status: 'active' };
const second = { id: '00000000-0000-4000-8000-000000000103', name: 'Об’єкт Б', status: 'active' };
const start = '2024-01-31';
const end = '2024-02-29';
const entries = [
  { kind: 'customer_charge', amount_cents: '90000', occurred_on: '2024-01-31' },
  { kind: 'customer_payment', amount_cents: '35000', occurred_on: '2024-02-13' },
  { kind: 'customer_advance', amount_cents: '25000', occurred_on: '2024-02-29' },
  { kind: 'customer_refund', amount_cents: '5000', occurred_on: '2024-02-29' },
  { kind: 'transport_expense', amount_cents: '7543', occurred_on: '2024-01-31' },
  { kind: 'customer_charge', amount_cents: '77700', occurred_on: '2024-01-31', reversed: true },
  { kind: 'customer_charge', amount_cents: '44400', occurred_on: '2023-12-31' }
];

test('charts only the selected project and inclusive period and switches comparable metrics from loaded data', async () => {
  const browser = await launchBrowser();
  const filters = [];
  const flow = await openPage(browser, async ({ method, pathname, searchParams }) => {
    if (method === 'POST' && pathname === '/auth/v1/token') {
      return { json: { access_token: 'mock-access', refresh_token: 'mock-refresh', expires_in: 3600, user } };
    }
    if (method === 'GET' && pathname === '/auth/v1/user') return { json: user };
    if (method !== 'GET' || !pathname.startsWith('/rest/v1/')) return;
    if (pathname.endsWith('/sbuild_profiles')) return { json: [{ full_name: 'QA Owner', role: 'owner', active: true }] };
    if (pathname.endsWith('/sbuild_projects')) {
      await new Promise(resolve => setTimeout(resolve, 400));
      return { json: [first, second] };
    }
    if (pathname.endsWith('/sbuild_project_finance_history') && searchParams.has('occurred_on')) {
      const project = searchParams.get('project_id');
      const dates = searchParams.getAll('occurred_on');
      filters.push({ dates, project, reversed: searchParams.get('reversed'), kind: searchParams.get('kind') });
      return {
        json: project === 'eq.' + first.id && dates.includes('gte.' + start) && dates.includes('lte.' + end)
          ? entries : []
      };
    }
    return { json: [] };
  }, { viewport: { width: 390, height: 844 } });
  try {
    const { page } = flow;
    await page.goto(siteOrigin + '/app.html');
    await page.waitForFunction(() => typeof document.querySelector('#login').onsubmit === 'function');
    await page.locator('#email').fill('finance@example.invalid');
    await page.locator('#password').fill('mock-password');
    await page.locator('#login button').first().click();
    await page.locator('[data-open="finance"]').click();
    const project = page.locator('#controlProject');
    await project.locator('option').filter({ hasText: first.name }).waitFor({ state: 'attached' });
    await page.locator('#projectLedger > summary').click();
    await page.locator('#projectLedgerChart > summary').click();

    const form = page.locator('#financeChartForm');
    await form.locator('[name="from"]').fill(start);
    await form.locator('[name="to"]').fill(end);
    await form.getByRole('button', { name: 'Показати період' }).click();
    await page.getByText(start + ' — ' + end + ' · За датою операції').waitFor();

    const result = page.locator('#financeChartResult');
    const axis = result.locator('.finance-chart-axis');
    assert.match(await axis.innerText(), /900,00/);
    await result.getByText('Таблиця даних').click();
    const table = result.getByRole('table');
    assert.equal(await table.locator('tbody tr').count(), 2);
    assert.match(await table.locator('tbody tr').nth(1).innerText(), /600,00/);
    assert.deepEqual(filters.at(-1), {
      dates: ['gte.' + start, 'lte.' + end], project: 'eq.' + first.id,
      reversed: 'eq.false', kind: 'neq.reversal'
    });

    const count = filters.length;
    await form.locator('[name="mode"]').selectOption('cash');
    await table.waitFor();
    const cash = await table.locator('tbody tr').nth(1).innerText();
    assert.match(cash, /350,00.*250,00.*50,00/s);
    assert.equal(filters.length, count);
    await form.locator('[name="mode"]').selectOption('transport');
    assert.match(await axis.innerText(), /75,43/);

    await project.selectOption(second.id);
    await result.getByText('Вибраний період не містить проведених операцій.').waitFor();
    assert.equal(filters.at(-1).project, 'eq.' + second.id);
    assert.equal(await result.locator('table').count(), 0);
    flow.assertClean();
  } finally {
    await flow.context.close();
    await browser.close();
  }
});
