const { sheetXml } = require('./spreadsheet-fixture.cjs');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const { test } = require('node:test');
const { launchBrowser, openPage, siteOrigin } = require('./browser-fixture.cjs');

const projectId = '00000000-0000-4000-8000-000000000001';
const approvedId = '00000000-0000-4000-8000-000000000010';
const draftId = '00000000-0000-4000-8000-000000000011';
const user = { id: projectId, email: 'owner@example.invalid', aud: 'authenticated', role: 'authenticated' };
const approved = {
  id: approvedId,
  zone_id: 'zone',
  status: 'owner_approved',
  description: '<strong>Оздоблення</strong>',
  client_rate: 125,
  worker_rate: 9999,
  quantity: 2,
  unit: 'м²',
  work_date: '2026-11-27'
};
const previewPath = projectId + '/' + approvedId + '/before.png';
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64');

function mock({ method, pathname, searchParams }, role = "owner") {
  if (method === 'POST' && pathname === '/auth/v1/token') {
    return { json: { access_token: 'test-token', refresh_token: 'test-refresh', expires_in: 3600, user } };
  }
  if (method !== 'GET') return;
  if (pathname === '/auth/v1/user') return { json: user };
  if (pathname === '/rest/v1/sbuild_profiles') {
    return { json: [{ full_name: 'Test User', role, active: true }] };
  }
  if (pathname === '/rest/v1/sbuild_projects') return { json: [{ id: projectId, name: 'Тестовий об’єкт' }] };
  if (pathname === '/rest/v1/sbuild_client_report_snapshots') return { json: [{ report: {
    project: 'Тестовий об’єкт', period: { start: '2026-11-23', end: '2026-11-29' },
    groups: [['Поверх 2', [{ date: '2026-11-27', description: 'Збережений монтаж', quantity: '2', unit: 'м²', subtotal: 25000, worker_rate: 9999 }]]],
    knownTotal: 25000, unpricedCount: 0
  } }] };
  if (pathname === '/rest/v1/sbuild_work_reports') {
    if (searchParams.has('work_date')) {
      return { json: [approved, { ...approved, id: draftId, status: 'submitted', description: 'PRIVATE DRAFT' }] };
    }
    return { json: searchParams.has('status') ? [{ ...approved, worker_rate: 50 }] : [] };
  }
  if (pathname === '/rest/v1/sbuild_zones') return { json: [{ id: 'zone', name: 'Поверх 2', parent_id: null }] };
  if (pathname === '/rest/v1/sbuild_work_photos') {
    return { json: [
      { report_id: approvedId, stage: 'before', storage_path: previewPath, note: 'PRIVATE PHOTO NOTE' },
      { report_id: approvedId, stage: 'after', storage_path: projectId + '/' + approvedId + '/after.png' },
      { report_id: draftId, stage: 'before', storage_path: projectId + '/' + draftId + '/draft.png' },
      { report_id: approvedId, stage: 'after', storage_path: 'https://example.invalid/private.png' }
    ] };
  }
  if (pathname === '/storage/v1/object/sbuild-work-photos/' + previewPath) {
    return { contentType: 'image/png', body: image };
  }
  if (pathname === '/rest/v1/sbuild_project_expense_totals') return { json: [{ amount: 25 }] };
  if (pathname === '/rest/v1/sbuild_weekly_payouts') return { json: [{ amount: 25, status: 'planned' }, { amount: 75, status: 'paid' }] };
  if (pathname === '/rest/v1/sbuild_expenses') return { json: [{ description: 'PRIVATE EXPENSE', amount: 9999 }] };
  if (pathname.startsWith('/rest/v1/')) return { json: [] };
}

async function signIn(page) {
  await page.goto(siteOrigin + '/app.html');
  await page.waitForFunction(() => typeof document.querySelector('#login').onsubmit === 'function');
  await page.locator('#email').fill(user.email);
  await page.locator('#password').fill('fake-password');
  await page.locator('#login button').first().click();
  await page.locator('#identity').filter({ hasText: 'Test User' }).waitFor({ state: 'attached' });
}

test('prints only approved client work and explicitly selected photos', async () => {
  const browser = await launchBrowser();
  try {
    const { page, seen, assertClean } = await openPage(browser, mock);
    await signIn(page);

    await page.locator('[data-tab="reports"]').click();
    await page.locator('#sbuildPhotos > summary').click();
    await page.locator('#photoProject option').filter({ hasText: 'Тестовий об’єкт' }).waitFor({ state: 'attached' });
    await page.locator('#clientWeek').fill('2026-11-23');
    await page.locator('#clientReportBuild').click();
    await page.locator('#clientReportPhotos button').filter({ hasText: 'До початку' }).click();
    const toggle = page.getByRole('checkbox', { name: /Додати фото до звіту.*До початку/ });
    await toggle.waitFor();
    assert.equal(await page.locator('#clientReportResult img').count(), 0);
    await toggle.check();

    const newPage = page.waitForEvent('popup');
    await page.locator('#clientReportPrint').click();
    const preview = await newPage;
    await preview.locator("img").waitFor({ timeout: 5000 });
    const report = await preview.locator('body').innerText();
    assert.match(report, /Поверх 2/);
    assert.match(report, /<strong>Оздоблення<\/strong>/);
    assert.match(report, /250/);
    assert.doesNotMatch(report, /PRIVATE|9999|Налаштування Telegram/);
    assert.equal(await preview.locator('strong strong').count(), 0);
    assert.equal(await preview.locator('img').count(), 1);
    await preview.waitForFunction(() => document.images[0].naturalWidth === 1);
    assert.equal((await preview.pdf({ format: 'A4' })).subarray(0, 4).toString(), '%PDF');
    await preview.close();
    const download = page.waitForEvent('download');
    await page.locator('#clientReportCsv').click();
    const csv = await download;
    assert.equal(csv.suggestedFilename(), 'sbuild-zvit-2026-11-23.csv');
    const contents = await readFile(await csv.path(), 'utf8');
    assert.match(contents, /<strong>Оздоблення<\/strong>.*250\.00/);
    assert.doesNotMatch(contents, /PRIVATE|9999|before\.png/);
    const excel = page.waitForEvent('download');
    await page.locator('#clientReportXlsx').click();
    const workbook = await excel;
    assert.equal(workbook.suggestedFilename(), 'sbuild-zvit-2026-11-23.xlsx');
    const sheet = await sheetXml(workbook);
    assert.match(sheet, /&lt;strong&gt;Оздоблення&lt;\/strong&gt;/);
    assert.match(sheet, /<v>250<\/v>/);
    assert.doesNotMatch(sheet, /PRIVATE|9999|before\.png/);

    assert.ok(!seen.some(item => item.pathname === '/rest/v1/sbuild_expenses'));
    assert.equal(seen.filter(item => item.pathname.startsWith('/storage/v1/')).length, 1);
    await page.locator('#clientWeek').fill('2026-11-24');
    assert.ok(await page.locator('#clientReportPrint').isDisabled());
    assert.equal(await page.locator('#clientReportResult h1').count(), 0);
    await page.locator('#clientReportSnapshot').click();
    assert.match(await page.locator('#clientReportStatus').innerText(), /понеділок/);
    assert.ok(!seen.some(item => item.pathname.endsWith('/sbuild_client_report_snapshots')));
    await page.locator('#clientWeek').fill('2026-11-23');
    await page.locator('#clientReportSnapshot').click();
    await page.locator('#clientReportResult').filter({ hasText: 'Збережений монтаж' }).waitFor();
    assert.doesNotMatch(await page.locator('#clientReportResult').innerText(), /9999/);
    assert.equal(await page.locator('#clientReportResult img').count(), 0);

    assertClean();
  } finally {
    await browser.close();
  }
});

test('shows private finance summary only for an active owner', async () => {
  const browser = await launchBrowser();
  try {
    const owner = await openPage(browser, mock);
    await signIn(owner.page);
    await owner.page.locator('[data-open="finance"]').click();
    const finance = owner.page.locator('#controlFinance');
    await finance.filter({ hasText: /Попередня маржа: 125,00/ }).waitFor();
    assert.match(await finance.innerText(), /Заплановані виплати: 25,00/);
    assert.match(await finance.innerText(), /Позначено виплаченим: 75,00/);
    owner.assertClean();

    const worker = await openPage(browser, args => mock(args, 'worker'));
    await signIn(worker.page);
    await worker.page.locator('[data-tab="reports"]').click();
    await worker.page.locator('#sbuildControlAnalytics > summary').click();
    await worker.page.locator('#controlMaterial').filter({ hasText: 'Ліміти матеріалів не встановлено.' }).waitFor();
    assert.ok(await worker.page.locator('#controlFinanceSection').isHidden());
    assert.ok(!worker.seen.some(({ pathname }) =>
      pathname === '/rest/v1/sbuild_weekly_payouts' || pathname === '/rest/v1/sbuild_project_expense_totals'));
    worker.assertClean();
  } finally {
    await browser.close();
  }
});

test('requires an explicit approval and exports a charges-only weekly report', async () => {
  const browser = await launchBrowser();
  const approvedCharges = [];
  try {
    const { page, seen, assertClean } = await openPage(browser, request => {
      const { method, pathname, body, searchParams } = request;
      if (pathname === '/rest/v1/sbuild_client_report_charges') {
        if (method === 'POST') {
          approvedCharges.push({ ...body, purchase_price: 9999 });
          return { status: 204 };
        }
        if (method === 'GET') return { json: approvedCharges };
      }
      if (pathname === '/rest/v1/rpc/sbuild_revoke_client_report_charge' && method === 'POST') {
        const index = approvedCharges.findIndex(item => item.id === body.p_id);
        assert.notEqual(index, -1);
        approvedCharges.splice(index, 1);
        return { status: 204 };
      }
      if (pathname === '/rest/v1/sbuild_work_reports' && searchParams.has('work_date')) return { json: [] };
      return mock(request);
    });
    await signIn(page);
    await page.locator('[data-tab="reports"]').click();
    await page.locator('#sbuildPhotos > summary').click();
    await page.locator('#photoProject option').filter({ hasText: 'Тестовий об’єкт' }).waitFor({ state: 'attached' });
    await page.locator('#clientWeek').fill('2026-11-23');
    await page.locator('#clientReportCharges > summary').click();
    const form = page.locator('#clientReportChargeForm');
    await form.locator('[name="description"]').fill('Погоджена фарба');
    await form.locator('[name="amount"]').fill('42,37');
    const submit = form.getByRole('button');
    await submit.click();
    assert.equal(approvedCharges.length, 0);
    await form.getByRole('checkbox').check();
    await submit.click();
    const report = page.locator('#clientReportResult').filter({ hasText: 'Погоджена фарба' });
    await report.waitFor();
    assert.match(await report.innerText(), /Матеріали.*42,37/);
    assert.equal(approvedCharges[0].amount_cents, 4237);
    assert.equal(approvedCharges[0].charge_date, '2026-11-23');
    const download = page.waitForEvent('download');
    await page.locator('#clientReportCsv').click();
    const csv = await download;
    const contents = await readFile(await csv.path(), 'utf8');
    assert.match(contents, /Погоджена фарба.*42\.37/);
    assert.doesNotMatch(contents, /9999|purchase_price/);
    assert.ok(!seen.some(({ pathname }) => pathname.includes('sbuild_expenses') || pathname.includes('inventory')));
    assert.equal(seen.find(({ pathname, method }) =>
      pathname === '/rest/v1/sbuild_client_report_charges' && method === 'POST').body.description, 'Погоджена фарба');

    const popup = page.waitForEvent('popup');
    await page.locator('#clientReportPrint').click();
    const preview = await popup;
    await preview.getByText(/Матеріали · Погоджена фарба · 42,37/).waitFor();
    assert.doesNotMatch(await preview.locator('body').innerText(), /9999|purchase_price/);
    await preview.close();

    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Скасувати погодження' }).click();
    await report.waitFor({ state: 'hidden' });
    assert.equal(approvedCharges.length, 0);
    await page.waitForFunction(() => document.getElementById('clientReportCsv').disabled);
    assertClean();
  } finally {
    await browser.close();
  }
});
