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
const instruction = 'Використати схвалену технологічну карту об’єкта. Перевірити основу перед початком.';
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
        instruction_text: instruction,
      });
      task = { ...assignment, due_on: null, instruction_text: instruction };
      return { status: 201, json: null };
    }
  }, async panel => {
    const form = panel.locator('form');
    await form.getByLabel('Назва роботи').fill(title);
    await form.getByLabel('Технологія виконання роботи').fill(instruction);
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

test('assignee must acknowledge the issued instruction before starting work', async () => {
  let task = { ...assignment, instruction_text: instruction };
  let acknowledgementCount = 0;
  let starts = 0;
  await openRolePanel('worker', ({ method, pathname, body }) => {
    if (method === 'POST' && pathname === '/rest/v1/sbuild_work_assignment_acknowledgements') {
      assert.deepEqual(body, { assignment_id: assignmentId });
      acknowledgementCount += 1;
      task = { ...task, acknowledgement: { acknowledged_at: '2026-11-28T00:04:00Z' } };
      return { status: 201, json: null };
    }
    if (pathname !== assignmentPath) return;
    if (method === 'GET') return { json: [task] };
    if (method === 'PATCH') {
      assert.equal(acknowledgementCount, 1);
      assert.deepEqual(body, { status: 'in_progress', report_id: null });
      starts += 1;
      task = { ...task, ...body };
      return { json: [{ id: assignmentId }] };
    }
  }, async panel => {
    const technology = panel.getByText('Технологія виконання', { exact: true });
    await technology.click();
    await panel.getByText(instruction, { exact: true }).waitFor();
    const start = panel.getByRole('button', { name: 'Почати роботу' });
    assert.equal(await start.count(), 0);
    await panel.getByRole('button', { name: 'Підтвердити ознайомлення' }).click();
    await start.waitFor();
    await technology.click();
    await panel.getByText(/Ознайомлення підтверджено/).waitFor();
    await start.click();
    await panel.getByRole('button', { name: 'Створити звіт' }).waitFor();
    assert.equal(starts, 1);
    assert.equal(acknowledgementCount, 1);
  });
});

const photoPanel = { panelSelector: '#sbuildPhotos' };
const photoRulesPath = '/rest/v1/sbuild_work_photo_requirements';
const photoRpcPath = '/rest/v1/rpc/sbuild_set_work_photo_requirements';
const defaultPhotoRules = { required_before: true, required_after: true, hidden_work: false, requires_recheck: false };

function photoReportMock({ method, pathname, searchParams }) {
  if (method === 'GET' && pathname === '/rest/v1/sbuild_work_reports' &&
      searchParams.get('select')?.startsWith('id,zone_id,description,work_date,status')) {
    assert.equal(searchParams.get('project_id'), 'eq.' + projectId);
    return { json: [{ ...report, status: 'submitted' }] };
  }
}

test('foreman updates the default photo requirements through the scoped RPC', async () => {
  let rules = { ...defaultPhotoRules };
  let changed = 0;
  await openRolePanel('foreman', request => {
    const { method, pathname, searchParams, body } = request;
    if (method === 'GET' && pathname === photoRulesPath) {
      assert.equal(searchParams.get('report_id'), 'eq.' + reportId);
      return { json: [rules] };
    }
    if (method === 'POST' && pathname === photoRpcPath) {
      assert.deepEqual(body, {
        p_report_id: reportId, p_required_before: true, p_required_after: true,
        p_hidden_work: true, p_requires_recheck: true,
      });
      rules = { ...rules, hidden_work: true, requires_recheck: true };
      changed += 1;
      return { json: null };
    }
    return photoReportMock(request);
  }, async panel => {
    await panel.locator('#photoReport').selectOption(reportId);
    const form = panel.locator('#photoRulesForm');
    await form.waitFor({ state: 'visible' });
    const recheck = form.getByRole('checkbox', { name: 'Повторне фото наступного спеціаліста' });
    assert.equal(await recheck.isDisabled(), true);
    await form.getByRole('checkbox', { name: /Приховані роботи/ }).check();
    await recheck.check();
    await form.getByRole('button', { name: 'Зберегти вимоги' }).click();
    await panel.getByText(/Вимоги збережено/).waitFor();
    assert.equal(changed, 1);
    assert.equal(await recheck.isChecked(), true);
  }, photoPanel);
});

test('worker can view report photos and cannot change their approval requirements', async () => {
  await openRolePanel('worker', request => {
    if (request.method === 'GET' && request.pathname === photoRulesPath) {
      return { json: [defaultPhotoRules] };
    }
    return photoReportMock(request);
  }, async panel => {
    await panel.locator('#photoReport').selectOption(reportId);
    await panel.getByText(/Фото: 0/).waitFor();
    assert.equal(await panel.getByRole('button', { name: 'Зберегти вимоги' }).count(), 0);
    await panel.locator('#photoUploadForm').waitFor({ state: 'visible' });
  }, photoPanel);
});

test('worker uploads an allowed photo once and retries its report registration', async () => {
  const registerPath = '/rest/v1/rpc/sbuild_register_work_photo';
  const objectPrefix = '/storage/v1/object/sbuild-work-photos/';
  const picture = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2VcAAAAASUVORK5CYII=',
    'base64',
  );
  let uploads = 0;
  const registrations = [];
  let photo;
  await openRolePanel('worker', request => {
    const { method, pathname, body, contentType, rawBody } = request;
    if (method === 'POST' && pathname.startsWith(objectPrefix)) {
      uploads += 1;
      const path = pathname.slice(objectPrefix.length);
      assert.match(path, new RegExp('^' + projectId + '/' + reportId + '/[0-9a-f-]{36}\\.png$'));
      assert.match(contentType, /^multipart\/form-data/);
      assert.ok(rawBody.includes(picture));
      return { json: { Key: 'sbuild-work-photos/' + path, Id: 'mock-photo-id' } };
    }
    if (method === 'POST' && pathname === registerPath) {
      registrations.push(body);
      assert.equal(body.p_report_id, reportId);
      assert.equal(body.p_stage, 'hidden_before_close');
      assert.equal(body.p_note, '');
      if (registrations.length === 1) return { status: 503, json: { message: 'Повторіть збереження' } };
      photo = { id: 'mock-photo-id', stage: body.p_stage, storage_path: body.p_storage_path };
      return { json: photo.id };
    }
    if (method === 'GET' && pathname === '/rest/v1/sbuild_work_photos') {
      return { json: photo ? [photo] : [] };
    }
    return photoReportMock(request);
  }, async panel => {
    await panel.locator('#photoReport').selectOption(reportId);
    const form = panel.locator('#photoUploadForm');
    const file = form.locator('input[type="file"]');
    const save = form.locator('button');
    await file.setInputFiles({ name: 'test.html', mimeType: 'text/html', buffer: Buffer.from('<html/>') });
    await save.click();
    await panel.getByText('Фото JPG, PNG або WebP до 15 МБ', { exact: true }).waitFor();
    assert.equal(uploads, 0);

    await file.setInputFiles({ name: 'proof.png', mimeType: 'image/png', buffer: picture });
    await form.locator('select[name="stage"]').selectOption('hidden_before_close');
    await save.click();
    await panel.getByText(/Фото завантажено. Спробуйте ще раз зберегти запис/).waitFor();
    await save.click();
    await panel.getByText(/Фото збережено/).waitFor();
    await panel.locator('#photoGallery').getByText(/hidden_before_close/).waitFor();
    assert.equal(uploads, 1);
    assert.equal(registrations.length, 2);
    assert.deepEqual(registrations[0], registrations[1]);
  }, photoPanel);
});

const attendancePanel = { panelSelector: '#sbuildAttendance' };
const payrollPanel = { panelSelector: '#sbuildWeeklyFinance' };
const closedWeek = '2025-06-09';
const attendanceDay = '2025-06-10';

test('foreman records canonical project attendance and sees weekly person-days', async () => {
  let attendance;
  await openRolePanel('foreman', ({ method, pathname, body, searchParams }) => {
    if (method === 'POST' && pathname === '/rest/v1/rpc/sbuild_work_assignment_roster') {
      assert.equal(body.p_project_id, projectId);
      return { json: [{ user_id: workerId, full_name: 'Тестовий виконавець' }] };
    }
    if (method === 'POST' && pathname === '/rest/v1/rpc/sbuild_record_daily_attendance') {
      assert.deepEqual(body, {
        p_project_id: projectId, p_worker_id: workerId, p_date: attendanceDay,
        p_present: true, p_note: 'Ранкова зміна',
      });
      attendance = { worker_id: workerId, work_date: attendanceDay, present: true, notes: body.p_note };
      return { json: null };
    }
    if (method === 'GET' && pathname === '/rest/v1/sbuild_attendance_daily') {
      assert.equal(searchParams.get('project_id'), 'eq.' + projectId);
      if (attendance) assert.deepEqual(searchParams.getAll('work_date'), ['gte.' + closedWeek, 'lt.2025-06-16']);
      return { json: attendance ? [attendance] : [] };
    }
  }, async panel => {
    const form = panel.locator('#sbuildAttendanceForm');
    await form.locator('#attendanceWorker').selectOption(workerId);
    await form.locator('#attendanceDate').fill(attendanceDay);
    await form.locator('#attendanceNotes').fill(' Ранкова зміна ');
    await form.getByRole('button', { name: 'Зберегти день' }).click();
    await panel.getByText('День збережено.', { exact: true }).waitFor();
    const summary = panel.locator('#attendanceSummary');
    await summary.getByRole('cell', { name: 'Ранкова зміна' }).waitFor();
    assert.equal(await summary.getByRole('cell', { name: '1', exact: true }).count(), 1);
  }, attendancePanel);
});

test('worker reads their attendance but cannot edit it', async () => {
  await openRolePanel('worker', ({ method, pathname }) => {
    if (method === 'GET' && pathname === '/rest/v1/sbuild_attendance_daily') {
      return { json: [{ worker_id: workerId, work_date: attendanceDay, present: false, notes: 'Лікарняний' }] };
    }
  }, async panel => {
    await panel.getByRole('cell', { name: 'Лікарняний' }).waitFor();
    assert.equal(await panel.getByRole('button', { name: 'Зберегти день' }).count(), 0);
    assert.equal(await panel.locator('#attendanceProject').inputValue(), projectId);
  }, attendancePanel);
});

test('owner records approved payout without trusting a client amount and sees late balance', async () => {
  let paid = false;
  let saves = 0;
  await openRolePanel('owner', ({ method, pathname, body }) => {
    if (method === 'POST' && pathname === '/rest/v1/rpc/sbuild_weekly_payout_summary') {
      assert.equal(body.p_project_id, projectId);
      if (body.p_week_start !== closedWeek) return { json: [] };
      return { json: [
        { worker_id: workerId, full_name: 'Тестовий виконавець', report_count: paid ? 3 : 2,
          missing_rate_count: 0, earned_amount: paid ? 350 : 300,
          paid_amount: paid ? 300 : null, paid_on: paid ? '2025-06-18' : null },
        { worker_id: 'incomplete-payroll', full_name: 'Тестова неповна відомість', report_count: 1,
          missing_rate_count: 1, earned_amount: 0, paid_amount: null, paid_on: null },
      ] };
    }
    if (method === 'POST' && pathname === '/rest/v1/rpc/sbuild_record_weekly_payout') {
      assert.deepEqual(body, { p_project_id: projectId, p_worker_id: workerId, p_week_start: closedWeek });
      saves += 1;
      paid = true;
      return { json: 'test-payout-id' };
    }
  }, async panel => {
    await panel.locator('#weeklyFinanceDate').fill(closedWeek);
    await panel.getByText('Є роботи без погодженої розцінки').waitFor();
    const pay = panel.getByRole('button', { name: 'Позначити фактичну виплату' });
    assert.equal(await pay.count(), 1);
    await pay.click();
    await panel.getByText(/Доплата.*50/).waitFor();
    assert.equal(await pay.count(), 0);
    assert.equal(saves, 1);
  }, payrollPanel);
});

test('worker payroll shows own earnings and no management or customer prices', async () => {
  await openRolePanel('worker', ({ method, pathname, body }) => {
    if (method === 'POST' && pathname === '/rest/v1/rpc/sbuild_weekly_payout_summary') {
      assert.equal(body.p_project_id, projectId);
      return { json: [{
        worker_id: workerId, full_name: 'Тестовий користувач', report_count: 1,
        missing_rate_count: 0, earned_amount: 200, paid_amount: null, paid_on: null,
      }] };
    }
  }, async panel => {
    await panel.getByRole('cell', { name: 'Не виплачено' }).waitFor();
    assert.equal(await panel.getByRole('columnheader', { name: /замовнику|дія/i }).count(), 0);
    assert.equal(await panel.getByRole('button', { name: 'Позначити фактичну виплату' }).count(), 0);
  }, payrollPanel);
});
