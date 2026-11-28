const assert = require('node:assert/strict');
const { test } = require('node:test');
const { launchBrowser, openPage, siteOrigin } = require('./browser-fixture.cjs');

function fixture() {
  const commands = 'BT /F1 12 Tf 40 150 Td (Painting 12 m2) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Length ' + Buffer.byteLength(commands) + ' >>\nstream\n' + commands + '\nendstream'
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((body, index) => {
    const offset = Buffer.byteLength(pdf);
    pdf += (index + 1) + ' 0 obj\n' + body + '\nendobj\n';
    return offset;
  });
  const cross = Buffer.byteLength(pdf);
  pdf += 'xref\n0 6\n0000000000 65535 f \n' + offsets.map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('');
  pdf += 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + cross + '\n%%EOF\n';
  return Buffer.from(pdf);
}

test('extracts text from a real PDF and exports only reviewed customer rates', async () => {
  const browser = await launchBrowser();
  try {
    const flow = await openPage(browser, ({ method, pathname }) => {
      if (method === 'POST' && pathname === '/auth/v1/token') {
        const user = { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated' };
        return { json: { access_token: 'mock-access', refresh_token: 'mock-refresh', token_type: 'bearer', expires_in: 3600, user } };
      }
      if (method === 'GET' && pathname === '/auth/v1/user') return { json: { id: '00000000-0000-4000-8000-000000000001' } };
      if (method === 'GET' && pathname.startsWith('/rest/v1/')) return {
        json: pathname === '/rest/v1/sbuild_profiles' ? [{ full_name: 'QA', role: 'worker', active: true }] : []
      };
    });
    try {
      const { page } = flow;
      await page.goto(siteOrigin + '/app.html');
      await page.waitForFunction(() => typeof document.querySelector('#login').onsubmit === 'function');
      await page.locator('#email').fill('pdf@example.invalid');
      await page.locator('#password').fill('mock-password');
      await page.locator('#login button').first().click();
      await page.locator('#workspace:not(.hidden)').waitFor({ state: 'attached' });
      await page.locator("#navMenu").click();
      await page.locator('[data-tab="drawings"]:visible').first().click();
      await page.getByText('Попередній кошторис із PDF').click();
      await page.locator('#pdf').setInputFiles({ name: 'plan.pdf', mimeType: 'application/pdf', buffer: fixture() });
      await page.locator('#analysePdf').click();
      await page.locator('#pdfEstimateStatus').filter({ hasText: 'Знайдено позицій: 1' }).waitFor({ timeout: 20000 });
      assert.equal(await page.getByLabel('Назва · 1').inputValue(), 'Painting');
      assert.equal(await page.getByLabel('Обсяг · 1').inputValue(), '12');
      await page.getByLabel('Розцінка виконавця · 1').fill('3');
      await page.getByLabel('Розцінка замовника · 1').fill('15');
      await page.getByLabel('Погодити позицію · 1').check();
      const [download] = await Promise.all([
        page.waitForEvent('download'), page.locator('#exportPdfCustomerEstimate').click()
      ]);
      const stream = await download.createReadStream();
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      assert.match(Buffer.concat(chunks).toString('utf8'), /"Painting";"м²";"12";"15";"180";"1"/);
      flow.assertClean();
    } finally {
      await flow.context.close();
    }
  } finally {
    await browser.close();
  }
});
