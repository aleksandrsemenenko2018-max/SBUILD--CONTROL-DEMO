const assert = require('node:assert/strict');
const { test } = require('node:test');
const { launchBrowser, openPage, siteOrigin } = require('./browser-fixture.cjs');

const user = { id: '00000000-0000-4000-8000-000000000101', aud: 'authenticated' };
const project = { id: '00000000-0000-4000-8000-000000000102', name: 'Об’єкт А', status: 'active' };

async function signIn(page) {
  await page.goto(siteOrigin + '/app.html');
  await page.waitForFunction(() => typeof document.querySelector('#login').onsubmit === 'function');
  await page.locator('#email').fill('qa@example.invalid');
  await page.locator('#password').fill('mock-password');
  await page.locator('#login button').first().click();
  await page.waitForFunction(() => Boolean(document.querySelector('#identity').textContent));
}

function backend(profile, getSummary = () => undefined) {
  return ({ method, pathname, searchParams }) => {
    if (method === 'POST' && pathname === '/auth/v1/token') {
      return { json: { access_token: 'mock-access', refresh_token: 'mock-refresh', expires_in: 3600, user } };
    }
    if (method === 'GET' && pathname === '/auth/v1/user') return { json: user };
    if (method !== 'GET' || !pathname.startsWith('/rest/v1/')) return;
    if (pathname.endsWith('/sbuild_profiles')) return { json: [profile] };
    if (pathname.endsWith('/sbuild_projects')) return { json: [project] };
    if (pathname.endsWith('/rpc/sbuild_owner_daily_summary')) return getSummary(searchParams);
    return { json: [] };
  };
}

test('loads the owner daily summary on demand and retries after a rejected request', async () => {
  const browser = await launchBrowser();
  let requests = 0;
  const flow = await openPage(browser, backend({ full_name: 'QA Owner', role: 'owner', active: true }, params => {
    assert.equal(params.size, 0);
    if (++requests === 1) return { status: 400, json: { message: 'query failed' } };
    return { json: [{
      summary_day: '2026-11-28', project_name: project.name, open_tasks: 7, tasks_due_today: 3,
      overdue_tasks: 2, reports_waiting_foreman: 5, reports_waiting_owner: 6, issue_drafts: 4, issues_waiting_reply: 1,
    }] };
  }), { viewport: { width: 390, height: 844 } });
  try {
    await signIn(flow.page);
    assert.equal(requests, 0);
    const panel = flow.page.locator('#ownerDailySummary');
    await panel.locator('summary').click();
    await panel.getByRole('status').filter({ hasText: 'Спробуйте оновити.' }).waitFor();
    await panel.getByRole('button', { name: 'Оновити зведення' }).click();
    await panel.getByRole('status').filter({ hasText: '28.11.2026 · За київським часом' }).waitFor();
    for (const text of [project.name, 'Відкриті завдання: 7', 'Звіти на погодженні у директора: 6', 'Звернення очікують відповіді: 1']) {
      await panel.getByText(text, { exact: true }).waitFor();
    }
    assert.equal(requests, 2);
    flow.assertClean();
  } finally {
    await flow.context.close();
    await browser.close();
  }
});

test('workers and inactive owners cannot open the summary or send requests', async () => {
  const browser = await launchBrowser();
  let requests = 0;
  try {
    for (const [role, active] of [['worker', true], ['owner', false]]) {
      const flow = await openPage(browser, backend({ full_name: 'QA Account', role, active }, () => {
        requests++;
        return { json: [] };
      }));
      try {
        await signIn(flow.page);
        const panel = flow.page.locator('#ownerDailySummary');
        assert.equal(await panel.isVisible(), false);
        assert.equal(await panel.getAttribute('hidden'), '');
        flow.assertClean();
      } finally {
        await flow.context.close();
      }
    }
    assert.equal(requests, 0);
  } finally {
    await browser.close();
  }
});
