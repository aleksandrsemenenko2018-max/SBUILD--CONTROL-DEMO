const assert = require('node:assert/strict');
const { test } = require('node:test');
const { launchBrowser, openPage, siteOrigin } = require('./browser-fixture.cjs');

test('records stock without duplicating its operation key after a network interruption', async () => {
  const browser = await launchBrowser();
  const transfers = [];
  const user = { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated' };
  const project = { id: '00000000-0000-4000-8000-000000000010', name: 'Склад QA', status: 'active' };
  const mock = ({ method, pathname, body }) => {
    if (method === 'POST' && pathname === '/auth/v1/token') {
      return { json: { access_token: 'mock-access', refresh_token: 'mock-refresh', token_type: 'bearer', expires_in: 3600, user } };
    }
    if (method === 'GET' && pathname === '/auth/v1/user') return { json: user };
    if (method === 'POST' && pathname === '/rest/v1/rpc/sbuild_record_inventory_once') {
      transfers.push(body);
      return transfers.length === 1 ? { abort: 'failed' } : { json: '00000000-0000-4000-8000-000000000088' };
    }
    if (method === 'GET' && pathname.startsWith('/rest/v1/')) {
      if (pathname.endsWith('/sbuild_profiles')) return { json: [{ full_name: 'QA Owner', role: 'owner', active: true }] };
      if (pathname.endsWith('/sbuild_projects')) return { json: [project] };
      return { json: [] };
    }
  };
  const flow = await openPage(browser, mock);
  try {
    const { page } = flow;
    await page.goto(siteOrigin + '/app.html');
    await page.waitForFunction(() => typeof document.querySelector('#login').onsubmit === 'function');
    await page.locator('#email').fill('warehouse@example.invalid');
    await page.locator('#password').fill('mock-password');
    await page.locator('#login button').first().click();
    await page.locator('.dash-tile[data-open="materials"]').click();
    await page.locator('#matProject option').filter({ hasText: project.name }).waitFor({ state: 'attached' });
    const form = page.locator('#matMoveForm');
    const button = form.locator('button');
    await form.locator('[name="material"]').fill('Штукатурка');
    await form.locator('[name="unit"]').fill('кг');
    await form.locator('[name="qty"]').fill('3');
    await form.locator('[name="cost"]').fill('14.30');
    await button.click();
    await page.locator('#matStatus').filter({ hasText: /fetch|network/i }).waitFor();
    await button.click();
    await page.locator('#matStatus').filter({ hasText: 'Рух збережено' }).waitFor();
    assert.equal(transfers.length, 2);
    assert.deepEqual(transfers[0], transfers[1]);
    assert.equal(transfers[0].p_project_id, project.id);
    assert.equal(transfers[0].p_quantity, 3);
    assert.equal(transfers[0].p_purchase_price, 14.3);
    assert.match(transfers[0].p_operation_id, /^[0-9a-f-]{36}$/i);
    flow.assertClean();
  } finally {
    await flow.context.close();
    await browser.close();
  }
});
