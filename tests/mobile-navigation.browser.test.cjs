const assert = require('node:assert/strict');
const { test } = require('node:test');
const { devices } = require('playwright');
const { launchBrowser, openPage, siteOrigin } = require('./browser-fixture.cjs');

const email = 'mobile-navigation@example.invalid';
const password = 'mock-navigation-password';
const user = {
  id: '00000000-0000-4000-8000-000000000002',
  email,
  aud: 'authenticated',
  role: 'authenticated',
  app_metadata: {},
  user_metadata: {},
  created_at: '2026-11-26T00:00:00Z',
};
const projects = Array.from({ length: 15 }, (_, index) => ({
  id: String(index + 1),
  name: `Тестовий об’єкт ${index + 1}`,
  address: `Тестова адреса ${index + 1}`,
  status: 'active',
}));
const contacts = projects.map(project => ({
  id: `contact-${project.id}`,
  project_id: project.id,
  role: 'designer',
  name: `Дизайнер об’єкта ${project.id}`,
  telegram_connected: true,
}));
const questions = projects.map(project => ({
  id: `question-${project.id}`,
  project_id: project.id,
  recipient_contact_id: `contact-${project.id}`,
  recipient_role: 'designer',
  description: `Питання об’єкта ${project.id}`,
  status: 'sent',
}));

function mockSupabase({ method, pathname, searchParams, body }) {
  if (method === 'POST' && pathname === '/auth/v1/token' &&
      searchParams.get('grant_type') === 'password' &&
      body?.email === email && body?.password === password) {
    return {
      json: {
        access_token: 'mock-mobile-access',
        refresh_token: 'mock-mobile-refresh',
        expires_in: 3600,
        token_type: 'bearer',
        user,
      },
    };
  }
  if (method !== 'GET') return;
  switch (pathname) {
    case '/auth/v1/user':
      return { json: user };
    case '/rest/v1/sbuild_profiles':
      return { json: [{ user_id: user.id, full_name: 'Тестовий власник', role: 'owner', active: true }] };
    case '/rest/v1/sbuild_projects':
      return { json: projects };
    case '/rest/v1/rpc/sbuild_list_project_contacts':
      return { json: contacts };
    case '/rest/v1/sbuild_questions':
      return { json: questions };
    default:
      if (pathname.startsWith('/rest/v1/')) return { json: [] };
  }
}

async function openProjects(page) {
  await page.goto(`${siteOrigin}/app.html`);
  await page.waitForFunction(() => typeof document.getElementById('login').onsubmit === 'function');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.locator('#login button').first().click();
  await page.locator('[data-tab="projects"]:visible').first().click();
}

for (const device of ['Pixel 7', 'iPhone 13']) {
test(`${device} project navigation isolates contacts and questions across 15 projects`, async () => {
  const browser = await launchBrowser(device === 'iPhone 13' && process.env.BROWSER_TEST_WEBKIT === '1' ? 'webkit' : 'chromium');
  try {
    const { context, page, assertClean } = await openPage(browser, mockSupabase, devices[device]);
    try {
      await openProjects(page);

      const nav = page.locator('#sbuildObjectNav');
      const panel = page.locator('#sbuildObjectPanel');
      const tiles = nav.locator('.sbuild-object-tile');
      await tiles.last().waitFor({ state: 'visible' });
      assert.equal(await tiles.count(), projects.length);
      const [scrollWidth, viewportWidth] = await nav.evaluate(element => [
        element.getBoundingClientRect().right,
        window.innerWidth,
      ]);
      assert.ok(scrollWidth <= viewportWidth, 'project navigation fits the mobile viewport');

      const directDisclosure = title => panel.locator(':scope > details').filter({
        has: page.locator('summary').getByText(title, { exact: true }),
      });
      const questionSection = directDisclosure('Питання та погодження');
      const contactSection = directDisclosure('Контакти та спеціалісти');
      const selectProject = index => tiles.nth(index).tap();
      const activeQuestion = index => page.locator('#sbuildQuestionList').getByText(
        `Питання об’єкта ${index + 1}`, { exact: true },
      );

      await selectProject(0);
      await questionSection.locator(':scope > summary').tap();
      await activeQuestion(0).waitFor({ state: 'visible' });
      assert.equal(await activeQuestion(14).count(), 0);
      await questionSection.getByText('＋ Нове звернення', { exact: true }).tap();
      await page.locator('#sbuildQuestionForm').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#sbuildQuestionProject').inputValue(), projects[0].id);

      await contactSection.locator(':scope > summary').tap();
      await page.locator('#sbuildContactList').getByText(/Дизайнер об’єкта 1 ✓/).waitFor({ state: 'visible' });
      await page.locator('#sbuildQuestionForm').waitFor({ state: 'hidden' });
      assert.equal(await questionSection.getAttribute('open'), null);

      await selectProject(14);
      assert.equal(await contactSection.getAttribute('open'), null);
      await questionSection.locator(':scope > summary').tap();
      await activeQuestion(14).waitFor({ state: 'visible' });
      assert.equal(await activeQuestion(0).count(), 0);
      assert.equal(await page.locator('#sbuildQuestionProject').inputValue(), projects[14].id);

      await page.locator('[data-tab="reports"]:visible').first().tap();
      await page.locator('[data-tab="projects"]:visible').first().tap();
      await panel.waitFor({ state: 'hidden' });
      assert.equal(await nav.locator('.sbuild-object-tile.selected').count(), 0);
      assert.equal(await panel.locator('details[open]').count(), 0);
      assert.equal(await page.locator('#sbuildComms > details.sbuild-comms-fold').count(), 1);
      assertClean();
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
});

}

test('mock Telegram reply moves a sent question into the archive without a resend action', async () => {
  const question = { ...questions[0], status: 'draft' };
  const reply = {
    id: 'mock-reply',
    question_id: question.id,
    author_contact_id: question.recipient_contact_id,
    body: 'Тестова відповідь на звернення',
    created_at: '2026-11-26T00:01:00Z',
  };
  let sendCount = 0;
  let replyChecks = 0;
  let received = false;
  const browser = await launchBrowser();
  try {
    const { context, page, assertClean } = await openPage(browser, request => {
      const { method, pathname, searchParams, body } = request;
      if (method === 'POST' && pathname === '/functions/v1/sbuild-telegram' &&
          searchParams.get('action') === 'send' && body?.question_id === question.id) {
        sendCount += 1;
        question.status = 'sent';
        return { json: { ok: true } };
      }
      if (method === 'GET' && pathname === '/rest/v1/sbuild_questions') {
        return { json: [question] };
      }
      if (method === 'GET' && pathname === '/rest/v1/sbuild_question_messages') {
        if (searchParams.has('author_contact_id')) replyChecks += 1;
        return { json: received ? [reply] : [] };
      }
      return mockSupabase(request);
    });
    try {
      await page.clock.install();
      await openProjects(page);
      await page.locator('#sbuildObjectNav .sbuild-object-tile').first().click();
      const panel = page.locator('#sbuildObjectPanel');
      await panel.getByText('Питання та погодження', { exact: true }).click();
      const list = page.locator('#sbuildQuestionList');
      const send = list.getByRole('button', { name: 'Надіслати в Telegram' });
      await send.click();
      await list.getByText('Очікує відповіді').waitFor({ state: 'visible' });
      assert.equal(await send.count(), 0);

      const waitForReplyPoll = () => page.waitForResponse(response => {
        const url = new URL(response.url());
        return url.pathname === '/rest/v1/sbuild_question_messages' &&
          url.searchParams.has('author_contact_id');
      });
      await Promise.all([waitForReplyPoll(), page.clock.runFor(30_000)]);
      assert.equal(replyChecks, 1);
      received = true;
      question.status = 'answered';
      await Promise.all([waitForReplyPoll(), page.clock.runFor(30_000)]);

      await page.locator('#status').getByText(/Отримано 1 відповідь/).waitFor({ state: 'visible' });
      await list.getByText('✓ Відповіді на питання · 1', { exact: true }).click();
      await list.locator('.sbuild-archive-project > summary').click();
      await list.locator('.sbuild-archive-question > summary').click();
      await list.getByText('Telegram · ' + reply.body, { exact: true }).waitFor({ state: 'visible' });
      assert.equal(await send.count(), 0);
      assert.equal(sendCount, 1);
      assertClean();
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
});

test('Telegram retry distinguishes a refused request from ambiguous network delivery', async () => {
  const question = { ...questions[0], status: 'draft' };
  let sendCount = 0;
  let statusChecks = 0;
  let loadCount = 0;
  let loadedInitialQuestions = false;
  const browser = await launchBrowser();
  try {
    const { context, page, assertClean } = await openPage(browser, request => {
      const { method, pathname, searchParams, body } = request;
      if (method === 'POST' && pathname === '/functions/v1/sbuild-telegram' &&
          searchParams.get('action') === 'send' && body?.question_id === question.id) {
        sendCount += 1;
        if (sendCount === 1) return { status: 403, json: { error: 'Owner authorization required' } };
        return { abort: 'connectionreset' };
      }
      if (method === 'GET' && pathname === '/rest/v1/sbuild_questions') {
        if (searchParams.get('id') === `eq.${question.id}`) {
          statusChecks += 1;
          if (statusChecks === 1) return { status: 400, json: { message: 'Unavailable' } };
          return { json: [{ id: question.id, status: question.status }] };
        }
        loadCount += 1;
        if (!loadedInitialQuestions) return { status: 400, json: { message: 'Unavailable' } };
        return { json: [question] };
      }
      return mockSupabase(request);
    });
    try {
      await openProjects(page);
      const retryList = page.getByRole('button', { name: 'Оновити контакти та звернення' });
      await retryList.waitFor();
      assert.equal(loadCount, 1);
      loadedInitialQuestions = true;
      await retryList.click();
      await retryList.waitFor({ state: 'hidden' });
      assert.equal(loadCount, 2);

      await page.locator('#sbuildObjectNav .sbuild-object-tile').first().click();
      await page.locator('#sbuildObjectPanel').getByText('Питання та погодження', { exact: true }).click();
      const list = page.locator('#sbuildQuestionList');
      await list.getByRole('button', { name: 'Надіслати в Telegram' }).click();
      const sendAgain = list.getByRole('button', { name: 'Повторити відправлення' });
      await sendAgain.click();
      const check = list.getByRole('button', { name: 'Перевірити стан відправлення' });
      await check.click();
      await list.getByText('Не вдалося перевірити стан.', { exact: false }).waitFor();
      await check.click();
      await list.getByText('Доставку поки не підтверджено.', { exact: false }).waitFor();
      assert.equal(await sendAgain.count(), 0);

      question.status = 'sent';
      await check.click();
      await list.getByText('Очікує відповіді', { exact: true }).waitFor();
      assert.equal(await check.count(), 0);
      assert.equal(sendCount, 2);
      assert.equal(statusChecks, 3);
      assertClean();
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
});

test('mobile attachments resume failed uploads without duplicating a draft or photo', async () => {
  const browser = await launchBrowser();
  const savedDrafts = new Map();
  const savedMessages = new Map();
  const uploadedObjects = new Set();
  const uploads = [];
  let draftWrites = 0;
  let failedPdf = false;

  try {
    const { context, page, assertClean } = await openPage(browser, request => {
      const { method, pathname, searchParams, body, rawBody } = request;
      if (pathname === '/rest/v1/sbuild_questions') {
        if (method === 'GET') return { json: [...savedDrafts.values()] };
        if (method === 'POST' && searchParams.get('on_conflict') === 'id') {
          draftWrites += 1;
          savedDrafts.set(body.id, body);
          if (draftWrites === 1) return { abort: 'connectionreset' };
          return { status: 201, json: [] };
        }
      }
      if (pathname === '/rest/v1/sbuild_question_messages') {
        if (method === 'GET') return { json: [...savedMessages.values()] };
        if (method === 'POST' && searchParams.get('on_conflict') === 'id') {
          assert.ok(savedDrafts.has(body.question_id));
          assert.ok(uploadedObjects.has('/storage/v1/object/sbuild-question-media/' + body.media_path));
          savedMessages.set(body.id, body);
          return { status: 201, json: [] };
        }
      }
      if (method === 'GET' && pathname.startsWith('/storage/v1/object/info/sbuild-question-media/')) {
        const objectPath = pathname.replace('/object/info/', '/object/');
        return { status: uploadedObjects.has(objectPath) ? 200 : 404, json: {} };
      }
      if (pathname.startsWith('/storage/v1/object/sbuild-question-media/')) {
        if (method === 'POST' && rawBody?.length > 0) {
          uploads.push(pathname);
          if (pathname.endsWith('plan.pdf') && !failedPdf) {
            failedPdf = true;
            return { status: 400, json: { error: 'Unavailable' } };
          }
          uploadedObjects.add(pathname);
          return { json: { Key: pathname } };
        }
      }
      if (method === 'POST' && pathname.startsWith('/storage/v1/object/sign/sbuild-question-media/')) {
        return { json: { signedURL: '/object/sign/sbuild-question-media/mock/?token=mock' } };
      }
      return mockSupabase(request);
    }, devices['Pixel 7']);

    try {
      await openProjects(page);
      await page.locator('#sbuildObjectNav .sbuild-object-tile').first().tap();
      const panel = page.locator('#sbuildObjectPanel');
      await panel.getByText('Питання та погодження', { exact: true }).tap();
      await panel.getByText('＋ Нове звернення', { exact: true }).tap();
      const form = page.locator('#sbuildQuestionForm');
      const description = 'Відновлення завантаження креслення';
      await form.locator('textarea').fill(description);
      const media = form.locator('input[type=file]');
      await media.setInputFiles({ name: 'wrong.txt', mimeType: 'text/plain', buffer: Buffer.from('invalid') });
      await form.getByRole('button', { name: 'Зберегти звернення' }).tap();
      await page.locator('#status').getByText(/Вкладення має бути фото/).waitFor();
      assert.equal(savedDrafts.size, 0);

      await media.setInputFiles([
        { name: 'photo.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([255, 216, 255, 217]) },
        { name: 'plan.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF') },
      ]);
      await form.getByRole('button', { name: 'Зберегти звернення' }).tap();
      await page.locator('#status').getByText(/Не вдалося підтвердити збереження/).waitFor();
      assert.equal(savedDrafts.size, 1);
      assert.equal(uploads.length, 0);

      const retry = form.getByRole('button', { name: 'Повторити збереження звернення' });
      await retry.tap();
      await page.locator('#status').getByText(/Не всі вкладення додано/).waitFor();
      assert.equal(savedMessages.size, 1);
      await retry.tap();
      await page.locator('#status').getByText(/Звернення створено/).waitFor();

      const list = page.locator('#sbuildQuestionList');
      await list.getByText(description, { exact: true }).waitFor();
      await list.getByText('Деталі та вкладення', { exact: true }).tap();
      await list.getByText(/photo\.jpg/).waitFor();
      await list.getByText(/plan\.pdf/).waitFor();
      assert.equal(draftWrites, 2);
      assert.equal(savedDrafts.size, 1);
      assert.equal(savedMessages.size, 2);
      assert.equal(uploads.filter(upload => upload.endsWith('photo.jpg')).length, 1);
      const pdfAttempts = uploads.filter(upload => upload.endsWith('plan.pdf'));
      assert.equal(pdfAttempts.length, 2);
      assert.equal(pdfAttempts[0], pdfAttempts[1]);
      assertClean();
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
});

for (const device of ['Pixel 7', 'iPhone 13']) {
  test(`${device} authentication controls fit all supported pages`, async t => {
    const browser = await launchBrowser(device === 'iPhone 13' && process.env.BROWSER_TEST_WEBKIT === '1' ? 'webkit' : 'chromium');
    t.after(() => browser.close());
    const { context, page, assertClean } = await openPage(browser, mockSupabase, devices[device]);
    t.after(() => context.close());
    const checkFit = async field => {
      const bounds = await field.boundingBox();
      assert.ok(bounds, 'the control is visible');
      assert.ok(bounds.width > 0 && bounds.x >= 0 && bounds.x + bounds.width <= page.viewportSize().width + 1,
        'the control fits the touch viewport');
    };

    for (const file of ['index.html', 'app.html', 'premium-dashboard.html', 'director.html']) {
      await page.goto(`${siteOrigin}/${file}`);
      await page.waitForFunction(() => typeof document.getElementById('login').onsubmit === 'function');
      await page.locator('#email').tap();
      await checkFit(page.locator('#login'));
      await checkFit(page.getByRole('button', { name: 'Увійти', exact: true }));
      if (file === 'director.html') {
        await checkFit(page.locator('#signup'));
        continue;
      }
      await page.locator('#showSignup').tap();
      await page.locator('#signupMethod').selectOption('phone');
      const number = page.locator('#signupPhone');
      await number.tap();
      await number.fill('+380000000000');
      await checkFit(number);
      await checkFit(page.locator('#signupSubmit'));
    }

    assertClean();
  });
}
