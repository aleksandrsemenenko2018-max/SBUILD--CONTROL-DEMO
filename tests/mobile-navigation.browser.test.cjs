const assert = require('node:assert/strict');
const { test } = require('node:test');
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
  telegram_chat_id: `mock-chat-${project.id}`,
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
    case '/rest/v1/sbuild_project_contacts':
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

test('mobile project navigation isolates contacts and questions across 15 projects', async () => {
  const browser = await launchBrowser();
  try {
    const { context, page, assertClean } = await openPage(browser, mockSupabase, {
      viewport: { width: 390, height: 844 },
      screen: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
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
