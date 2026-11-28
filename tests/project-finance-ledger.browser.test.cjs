const assert = require('node:assert/strict');
const { test } = require('node:test');
const { launchBrowser, openPage, siteOrigin } = require('./browser-fixture.cjs');

const user = { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated' };
const project = { id: '00000000-0000-4000-8000-000000000011', name: 'Об’єкт QA', status: 'active' };
const recordEndpoint = '/rest/v1/rpc/sbuild_record_project_finance_entry';

test('records an advance once after an interrupted response and reverses it with a reason', async () => {
  const browser = await launchBrowser();
  const entries = new Map();
  const calls = [];
  function mock({ method, pathname, body }) {
    if (method === 'POST' && pathname === '/auth/v1/token') {
      return { json: { access_token: 'mock-access', refresh_token: 'mock-refresh', expires_in: 3600, user } };
    }
    if (method === 'GET' && pathname === '/auth/v1/user') return { json: user };
    if (method === 'POST' && pathname === recordEndpoint) {
      calls.push(body);
      if (!entries.has(body.p_id)) {
        const original = entries.get(body.p_reverses_entry_id);
        if (original) original.reversed = true;
        entries.set(body.p_id, {
          id: body.p_id, kind: body.p_kind, amount_cents: original?.amount_cents ?? body.p_amount_cents,
          occurred_on: body.p_occurred_on, description: body.p_description, reversed: false
        });
      }
      return calls.length === 1 ? { abort: 'failed' } : { json: body.p_id };
    }
    if (method === 'GET' && pathname.startsWith('/rest/v1/')) {
      if (pathname.endsWith('/sbuild_profiles')) return { json: [{ full_name: 'QA Owner', role: 'owner', active: true }] };
      if (pathname.endsWith('/sbuild_projects')) return { json: [project] };
      if (pathname.endsWith('/sbuild_project_finance_history')) return { json: [...entries.values()] };
      if (pathname.endsWith('/sbuild_project_finance_balances')) {
        const advance = [...entries.values()].filter(entry => entry.kind === 'customer_advance' && !entry.reversed)
          .reduce((sum, entry) => sum + entry.amount_cents, 0);
        return { json: [{ charged_cents: '20000', advance_cents: String(advance) }] };
      }
      return { json: [] };
    }
  }

  const flow = await openPage(browser, mock);
  try {
    const { page } = flow;
    await page.goto(siteOrigin + '/app.html');
    await page.waitForFunction(() => typeof document.querySelector('#login').onsubmit === 'function');
    await page.locator('#email').fill('finance@example.invalid');
    await page.locator('#password').fill('mock-password');
    await page.locator('#login button').first().click();
    await page.locator('[data-open="finance"]').click();
    await page.locator('#projectLedger > summary').click();
    const form = page.locator('#projectLedgerForm');
    const submit = form.getByRole('button', { name: 'Записати операцію' });
    await form.locator('[name="kind"]').selectOption('customer_advance');
    await form.locator('[name="amount"]').fill('42,37');
    await form.locator('[name="description"]').fill('Аванс за роботу');
    await submit.click();
    await page.locator('#projectLedgerStatus').filter({ hasText: 'Не вдалося підтвердити запис.' }).waitFor();
    await submit.click();
    await page.locator('#projectLedgerHistory li').filter({ hasText: 'Аванс за роботу' }).waitFor();
    assert.equal(entries.size, 1);
    assert.deepEqual(calls[0], calls[1]);
    assert.equal(calls[0].p_project_id, project.id);
    assert.equal(calls[0].p_amount_cents, 4237);
    await page.locator('#projectLedgerSummary li').filter({ hasText: /Заборгованість замовника · 157,63/ }).waitFor();

    page.once('dialog', dialog => dialog.accept('Помилково записана операція'));
    await page.getByRole('button', { name: 'Сторнувати' }).click();
    await page.locator('#projectLedgerHistory li').filter({ hasText: 'Сторновано' }).waitFor();
    await page.locator('#projectLedgerSummary li').filter({ hasText: /Заборгованість замовника · 200,00/ }).waitFor();
    assert.equal(calls[2].p_reverses_entry_id, calls[0].p_id);
    assert.equal(calls[2].p_amount_cents, null);
    flow.assertClean();
  } finally {
    await flow.context.close();
    await browser.close();
  }
});
