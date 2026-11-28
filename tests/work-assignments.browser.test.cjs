const assert = require('node:assert/strict');
const { test } = require('node:test');
const { launchBrowser, openPage, siteOrigin } = require('./browser-fixture.cjs');

const projectId = '00000000-0000-4000-8000-000000000100';
const buildingZone = '00000000-0000-4000-8000-000000000200';
const roomZone = '00000000-0000-4000-8000-000000000201';
const workerId = '00000000-0000-4000-8000-000000000301';
const managerId = '00000000-0000-4000-8000-000000000302';
const assignmentId = '00000000-0000-4000-8000-000000000401';
const reportId = '00000000-0000-4000-8000-000000000501';
const assignmentPath = '/rest/v1/sbuild_work_assignments';
const zones = [
  { id: buildingZone, name: 'Поверх 2', parent_id: null },
  { id: roomZone, name: 'Кімната 5', parent_id: buildingZone },
];
const report = { id: reportId, zone_id: roomZone, description: 'Повторне шпаклювання', work_date: '2026-11-26' };
const title = 'Шпаклювання стіни';
const assignment = {
  id: assignmentId, title, status: 'assigned', project_id: projectId, zone_id: roomZone,
  assigned_to: workerId, due_on: '2026-11-30', report_id: null,
};

async function openRolePanel(role, requests, check, {
  tab = 'reports', panelSelector = '#sbuildAssignments',
} = {}) {
  const browser = await launchBrowser();
  const worker = role === 'worker';
  const user = {
    id: worker ? workerId : managerId,
    email: 'assignment-test@example.invalid',
    aud: 'authenticated',
    role: 'authenticated',
    app_metadata: {},
    user_metadata: {},
    created_at: '2026-11-26T00:00:00Z',
  };
  const profile = { user_id: user.id, full_name: 'Тестовий користувач', role, active: true };
  try {
    const { page, context, assertClean } = await openPage(browser, request => {
      const { method, pathname, searchParams } = request;
      const response = requests(request);
      if (response) return response;
      if (method === 'POST' && pathname === '/auth/v1/token') {
        return { json: { user, access_token: 'assignment-token', refresh_token: 'assignment-refresh',
          expires_in: 3600, token_type: 'bearer' } };
      }
      if (method !== 'GET') return;
      switch (pathname) {
        case '/auth/v1/user': return { json: user };
        case '/rest/v1/sbuild_projects': return { json: [{ id: projectId, name: 'Тестовий об’єкт' }] };
        case '/rest/v1/sbuild_zones': return { json: zones };
        case '/rest/v1/sbuild_profiles': return { json: [profile] };
        case '/rest/v1/sbuild_work_reports': return { json: searchParams.has('worker_id') ? [report] : [] };
        default: if (pathname.startsWith('/rest/v1/')) return { json: [] };
      }
    });
    try {
      await page.goto(`${siteOrigin}/app.html`);
      await page.waitForFunction(() => typeof document.getElementById('login').onsubmit === 'function');
      await page.locator('#email').fill(user.email);
      await page.locator('#password').fill('mock-assignment-password');
      await page.locator('#login button').first().click();
      await page.locator('#identity').filter({ hasText: 'Тестовий користувач' }).waitFor({ state: 'attached' });
      await page.locator(`nav button[data-tab="${tab}"]`).click();
      const panel = page.locator(panelSelector);
      await panel.locator('summary').first().click();
      await check(panel, page);
      assertClean();
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

test('foreman creates an assignment using the project roster and full zone path', async () => {
  let task;
  await openRolePanel('foreman', ({ method, pathname, body, searchParams }) => {
    if (method === 'POST' && pathname === '/rest/v1/rpc/sbuild_work_assignment_roster') {
      assert.equal(body.p_project_id, projectId);
      return { json: [{ user_id: workerId, full_name: 'Тестовий виконавець' }] };
    }
    if (pathname !== assignmentPath) return;
    if (method === 'GET') {
      assert.equal(searchParams.get('project_id'), 'eq.' + projectId);
      return { json: task ? [task] : [] };
    }
    if (method === 'POST') {
      assert.deepEqual(body, {
        assigned_to: workerId, due_on: null, project_id: projectId, title, zone_id: roomZone,
      });
      task = { ...assignment, due_on: null };
      return { status: 201, json: null };
    }
  }, async panel => {
    const form = panel.locator('form');
    await form.getByLabel('Назва роботи').fill(title);
    await form.getByLabel('Зона').selectOption({ label: 'Поверх 2 / Кімната 5' });
    await form.getByLabel('Виконавець').selectOption({ label: 'Тестовий виконавець' });
    await form.getByRole('button', { name: 'Призначити роботу' }).click();
    await panel.locator('#assignmentList').getByText(title, { exact: true }).waitFor();
    await panel.getByText('Завдання створено.', { exact: true }).waitFor();
  });
});

test('worker starts an assignment and attaches their submitted report', async () => {
  let task = { ...assignment };
  const updates = [];
  await openRolePanel('worker', ({ method, pathname, body, searchParams }) => {
    if (pathname !== assignmentPath) return;
    if (method === 'GET') return { json: [task] };
    if (method === 'PATCH') {
      assert.equal(searchParams.get('id'), 'eq.' + assignmentId);
      assert.equal(searchParams.get('project_id'), 'eq.' + projectId);
      assert.equal(searchParams.get('status'), 'eq.' + task.status);
      updates.push(body);
      task = { ...task, ...body };
      return { json: [{ id: assignmentId }] };
    }
  }, async (panel, page) => {
    await panel.getByRole('button', { name: 'Почати роботу' }).click();
    assert.equal(await panel.locator('form').isVisible(), false);
    assert.equal(await panel.getByRole('button', { name: 'Скасувати завдання' }).count(), 0);
    await panel.getByRole('button', { name: 'Створити звіт' }).click();
    const reportForm = page.locator('#reportForm');
    await reportForm.waitFor({ state: 'visible' });
    assert.equal(await reportForm.locator('#reportProject').inputValue(), projectId);
    assert.equal(await reportForm.locator('#reportZone').inputValue(), roomZone);
    assert.equal(await reportForm.locator('[name="description"]').inputValue(), title);
    await panel.locator('summary').first().click();
    await panel.getByRole('button', { name: 'Додати звіт до завдання' }).click();
    await panel.getByText(/Звіт подано/).waitFor();
    assert.deepEqual(updates, [
      { status: 'in_progress', report_id: null },
      { status: 'submitted', report_id: reportId },
    ]);

    assert.equal(await page.locator('#assignmentProject').inputValue(), projectId);
  });
});

test('manager reads report approval status and assignment history', async () => {
  await openRolePanel('owner', ({ method, pathname, searchParams }) => {
    if (method === 'POST' && pathname === '/rest/v1/rpc/sbuild_work_assignment_roster') {
      return { json: [{ user_id: workerId, full_name: 'Тестовий виконавець' }] };
    }
    if (method === 'GET' && pathname === assignmentPath) {
      return { json: [{ ...assignment, status: 'submitted', report_id: reportId, report: { status: 'foreman_approved' } }] };
    }
    if (method === 'GET' && pathname === '/rest/v1/sbuild_work_assignment_events') {
      assert.equal(searchParams.get('assignment_id'), 'eq.' + assignmentId);
      return { json: [{ id: 1, old_status: 'in_progress', new_status: 'submitted', changed_at: '2026-11-26T01:00:00Z' }] };
    }
  }, async panel => {
    await panel.getByText(/Погоджено виконробом/).waitFor();
    await panel.getByText('Історія завдання', { exact: true }).click();
    await panel.getByText(/У роботі → Звіт подано/).waitFor();
    assert.equal(await panel.getByRole('button', { name: 'Скасувати завдання' }).count(), 0);
  });
});

const hierarchyPanel = { tab: 'projects', panelSelector: '#sbuildZoneHierarchy' };
const zonesPath = '/rest/v1/sbuild_zones';

test('foreman creates a floor, room and segment and renames the room in place', async () => {
  const tree = [{ id: 'legacy', name: 'Стара зона', parent_id: null, kind: null }];
  const writes = [];
  await openRolePanel('foreman', ({ method, pathname, searchParams, body }) => {
    if (pathname !== zonesPath) return;
    if (method === 'GET' && searchParams.get('select')?.includes('kind')) {
      assert.equal(searchParams.get('project_id'), 'eq.' + projectId);
      return { json: tree };
    }
    if (method === 'POST') {
      writes.push(body);
      const zone = { ...body, id: 'typed-' + tree.length };
      tree.push(zone);
      return { status: 201, json: [{ id: zone.id }] };
    }
    if (method === 'PATCH') {
      writes.push(body);
      assert.equal(searchParams.get('id'), 'eq.typed-2');
      assert.equal(searchParams.get('project_id'), 'eq.' + projectId);
      tree.find(zone => zone.id === 'typed-2').name = body.name;
      return { json: [{ id: 'typed-2' }] };
    }
  }, async panel => {
    const form = panel.locator('form');
    await form.getByLabel('Назва', { exact: true }).fill('Поверх 1');
    await form.getByRole('button', { name: 'Додати зону' }).click();
    await panel.getByText('Поверх · Поверх 1', { exact: true }).waitFor();

    await form.getByLabel('Рівень').selectOption('room');
    await form.getByLabel('Батьківська зона').selectOption({ label: 'Поверх 1' });
    await form.getByLabel('Назва', { exact: true }).fill('Кімната 10');
    await form.getByRole('button', { name: 'Додати зону' }).click();
    await panel.getByText('Приміщення · Кімната 10', { exact: true }).waitFor();

    await form.getByLabel('Рівень').selectOption('segment');
    await form.getByLabel('Батьківська зона').selectOption({ label: 'Поверх 1 / Кімната 10' });
    await form.getByLabel('Сегмент', { exact: true }).selectOption('A');
    await form.getByRole('button', { name: 'Додати зону' }).click();
    await panel.getByText('Сегмент · A', { exact: true }).waitFor();

    await panel.getByRole('button', { name: 'Перейменувати Кімната 10' }).click();
    assert.equal(await form.getByLabel('Батьківська зона').isDisabled(), true);
    await form.getByLabel('Назва', { exact: true }).fill('Кімната 11');
    await form.getByRole('button', { name: 'Зберегти назву' }).click();
    const roomName = panel.getByText('Приміщення · Кімната 11', { exact: true });
    await roomName.locator('..').getByText('Сегмент · A', { exact: true }).waitFor();
    await panel.getByText('Існуючі зони без типу', { exact: true }).click();
    await panel.getByText('Стара зона', { exact: true }).waitFor();
    assert.deepEqual(writes, [
      { project_id: projectId, parent_id: null, name: 'Поверх 1', kind: 'floor' },
      { project_id: projectId, parent_id: 'typed-1', name: 'Кімната 10', kind: 'room' },
      { project_id: projectId, parent_id: 'typed-2', name: 'A', kind: 'segment' },
      { name: 'Кімната 11' },
    ]);
  }, hierarchyPanel);
});

test('worker can browse the project hierarchy with no change controls', async () => {
  await openRolePanel('worker', ({ method, pathname, searchParams }) => {
    if (method === 'GET' && pathname === zonesPath && searchParams.get('select')?.includes('kind')) {
      return { json: [
        { id: buildingZone, name: 'Поверх 2', parent_id: null, kind: 'floor' },
        { id: roomZone, name: 'Кімната 5', parent_id: buildingZone, kind: 'room' },
      ] };
    }
  }, async panel => {
    await panel.getByText('Приміщення · Кімната 5', { exact: true }).waitFor();
    assert.equal(await panel.locator('form').isVisible(), false);
    assert.equal(await panel.getByRole('button', { name: /^Перейменувати/ }).count(), 0);
  }, hierarchyPanel);
});

test('worker links a specialty checklist to their report and inherits its zone', async () => {
  const qualityPath = '/rest/v1/sbuild_quality_checklists';
  const finalReportId = '00000000-0000-4000-8000-000000000502';
  const checklistTitle = 'Контроль бетонування';
  let saved;
  await openRolePanel('worker', ({ method, pathname, searchParams, body }) => {
    if (pathname === '/rest/v1/sbuild_work_reports' &&
        method === 'GET' && searchParams.get('select') === 'id,description,zone_id,status,work_date') {
      assert.equal(searchParams.get('project_id'), 'eq.' + projectId);
      return { json: [
        { ...report, status: 'submitted' },
        { ...report, id: finalReportId, status: 'owner_approved', description: 'Закритий звіт' },
      ] };
    }
    if (pathname !== qualityPath) return;
    if (method === 'GET') return { json: saved ? [{ ...saved, id: 'checklist' }] : [] };
    if (method === 'POST') {
      saved = body;
      return { status: 201, json: null };
    }
  }, async panel => {
    const form = panel.locator('#controlQualityForm');
    const workReport = form.locator('#qualityReport');
    await workReport.selectOption(reportId);
    assert.equal(await workReport.locator('option').count(), 2);
    assert.equal(await form.locator('#qualityZone').inputValue(), roomZone);
    assert.equal(await form.locator('#qualityZone').isDisabled(), true);
    await form.getByLabel('Спеціальність').selectOption('concrete');
    await form.getByLabel('Назва перевірки').fill(checklistTitle);
    await form.getByRole('button', { name: 'Створити чекліст' }).click();
    const result = panel.locator('#controlQuality');
    await result.getByText('Звіт: ' + report.description, { exact: true }).waitFor();
    assert.equal(saved.project_id, projectId);
    assert.equal(saved.zone_id, roomZone);
    assert.equal(saved.report_id, reportId);
    assert.equal(saved.title, checklistTitle);
    assert.equal(saved.specialty, 'concrete');
    assert.equal(saved.created_by, workerId);
    assert.ok(saved.items.length > 0 && saved.items.every(item => !item.done));
    assert.equal(await result.getByRole('button', { name: 'Погодити якість' }).count(), 0);
  }, { panelSelector: '#sbuildControlAnalytics' });
});
