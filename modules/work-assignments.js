const statusLabels = {
  assigned: 'Призначено',
  in_progress: 'У роботі',
  submitted: 'Звіт подано',
  foreman_approved: 'Погоджено виконробом',
  owner_approved: 'Затверджено директором',
  returned: 'Повернуто на доопрацювання',
  cancelled: 'Скасовано',
};

const table = 'sbuild_work_assignments';
const reportTable = 'sbuild_work_reports';

function fill(select, rows, placeholder) {
  const previous = select.value;
  select.replaceChildren(...(placeholder ? [new Option(placeholder, '')] : []),
    ...rows.map(row => new Option(row.name, row.id)));
  if ([...select.options].some(option => option.value === previous)) select.value = previous;
}

function button(label, onClick) {
  const control = document.createElement('button');
  control.type = 'button';
  control.textContent = label;
  control.addEventListener('click', onClick);
  return control;
}

function zoneLabels(zones) {
  const byId = new Map(zones.map(zone => [zone.id, zone]));
  return zones.map(zone => {
    const path = [zone.name];
    const visited = new Set([zone.id]);
    let parent = byId.get(zone.parent_id);
    while (parent && !visited.has(parent.id)) {
      visited.add(parent.id);
      path.unshift(parent.name);
      parent = byId.get(parent.parent_id);
    }
    return { id: zone.id, name: path.join(' / ') };
  });
}

export function mountWorkAssignments({ sb, panel, getState, prepareReport }) {
  const project = panel.querySelector('#assignmentProject');
  const form = panel.querySelector('#assignmentForm');
  const list = panel.querySelector('#assignmentList');
  const feedback = panel.querySelector('#assignmentStatus');
  let generation = 0;

  function reset() {
    generation += 1;
    panel.open = false;
    form.reset();
    form.classList.add('hidden');
    form.elements.zone_id.replaceChildren();
    form.elements.assigned_to.replaceChildren();
    project.replaceChildren();
    list.replaceChildren();
    feedback.textContent = '';
  }

  async function changeStatus(task, status, reportId) {
    const id = project.value;
    const { user } = getState();
    const { data, error } = await sb.from(table)
      .update({ status, report_id: reportId })
      .eq('project_id', id)
      .eq('id', task.id)
      .eq('status', task.status)
      .select('id');
    if (id !== project.value || user?.id !== getState().user?.id) return;
    if (error || !data?.length) {
      feedback.textContent = error?.message || 'Завдання змінилося. Оновіть список.';
      return;
    }
    await reload();
  }

  function action(row, label, run) {
    const control = button(label, async () => {
      control.disabled = true;
      try {
        await run();
      } catch {
        feedback.textContent = 'Не вдалося виконати дію. Спробуйте ще раз.';
      } finally {
        control.disabled = false;
      }
    });
    row.append(control);
    return control;
  }

  function showHistory(row, task) {
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'Історія завдання';
    const history = document.createElement('ol');
    details.append(summary, history);
    row.append(details);
    details.addEventListener('toggle', async () => {
      if (!details.open) return;
      history.textContent = 'Завантаження…';
      try {
        const { data, error } = await sb.from('sbuild_work_assignment_events')
          .select('id,old_status,new_status,changed_at')
          .eq('assignment_id', task.id)
          .order('id')
          .limit(100);
        if (error) {
          history.textContent = error.message;
          return;
        }
        const rows = (data || []).map(event => {
          const item = document.createElement('li');
          const date = new Date(event.changed_at).toLocaleString('uk-UA');
          const before = event.old_status ? statusLabels[event.old_status] + ' → ' : '';
          item.textContent = date + ' · ' + before + statusLabels[event.new_status];
          return item;
        });
        history.replaceChildren(...rows);
      } catch {
        history.textContent = 'Не вдалося завантажити історію.';
      }
    });
  }

  function renderTask(task, user, manager, roster, zones, reports) {
    const row = document.createElement('article');
    row.className = 'item';
    const title = document.createElement('strong');
    title.textContent = task.title;
    const description = document.createElement('p');
    const status = task.report?.status || task.status;
    const zone = zones.get(task.zone_id) || 'Зона недоступна';
    const worker = roster.get(task.assigned_to);
    description.textContent = [zone, statusLabels[status], worker, task.due_on].filter(Boolean).join(' · ');
    row.append(title, description);
    if (task.instruction_text) {
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = 'Технологія виконання';
      const instruction = document.createElement('p');
      instruction.style.whiteSpace = 'pre-wrap';
      instruction.textContent = task.instruction_text;
      details.append(summary, instruction);
      if (task.acknowledgement) {
        const signed = document.createElement('p');
        signed.textContent = 'Ознайомлення підтверджено · ' +
          new Date(task.acknowledgement.acknowledged_at).toLocaleString('uk-UA');
        details.append(signed);
      } else if (task.assigned_to === user.id && task.status === 'assigned') {
        action(details, 'Підтвердити ознайомлення', async () => {
          const projectId = project.value;
          const { error } = await sb.from('sbuild_work_assignment_acknowledgements')
            .insert({ assignment_id: task.id });
          if (project.value !== projectId || getState().user?.id !== user.id) return;
          if (error && error.code !== '23505') {
            feedback.textContent = error.message;
            return;
          }
          await reload();
        });
      }
      row.append(details);
    }

    if (task.assigned_to === user.id) {
      const readyToStart = task.status === 'assigned' && (!task.instruction_text || task.acknowledgement);
      if (readyToStart || status === 'returned') {
        action(row, status === 'returned' ? 'Повернути в роботу' : 'Почати роботу',
          () => changeStatus(task, 'in_progress', null));
      }
      if (task.status === 'in_progress') {
        action(row, 'Створити звіт', () => prepareReport(task));
        const candidates = reports.filter(report => report.zone_id === task.zone_id);
        if (candidates.length) {
          const label = document.createElement('label');
          label.textContent = 'Поданий звіт';
          const select = document.createElement('select');
          fill(select, candidates.map(report => ({
            id: report.id,
            name: report.work_date + ' · ' + report.description,
          })));
          label.append(select);
          row.append(label);
          action(row, 'Додати звіт до завдання', () => changeStatus(task, 'submitted', select.value));
        }
      }
    }
    if (manager && ['assigned', 'in_progress'].includes(task.status)) {
      action(row, 'Скасувати завдання', () => changeStatus(task, 'cancelled', null));
    }
    showHistory(row, task);
    return row;
  }

  async function reload() {
    const request = ++generation;
    const { user, profile, projects } = getState();
    feedback.textContent = '';
    form.classList.add('hidden');
    list.replaceChildren();
    if (!user || !profile?.active || !projects.length) {
      feedback.textContent = 'Немає доступних об’єктів.';
      project.replaceChildren();
      return;
    }

    const manager = ['owner', 'foreman'].includes(profile.role);
    fill(project, projects);
    const projectId = project.value;
    feedback.textContent = 'Завантаження…';
    const [tasks, zoneRows, rosterRows, reports] = await Promise.all([
      sb.from(table)
        .select('id,project_id,zone_id,assigned_to,title,due_on,status,report_id,instruction_text,' +
          'report:sbuild_work_reports!sbuild_work_assignments_report_id_fkey(status),' +
          'acknowledgement:sbuild_work_assignment_acknowledgements(acknowledged_at)')
        .eq('project_id', projectId).order('created_at', { ascending: false }).limit(100),
      sb.from('sbuild_zones').select('id,name,parent_id').eq('project_id', projectId).order('name'),
      manager ? sb.rpc('sbuild_work_assignment_roster', { p_project_id: projectId }) : { data: [] },
      sb.from(reportTable).select('id,zone_id,description,work_date').eq('project_id', projectId)
        .eq('worker_id', user.id).eq('status', 'submitted').order('work_date', { ascending: false }).limit(100),
    ]);
    if (request !== generation) return;
    const error = tasks.error || zoneRows.error || rosterRows.error || reports.error;
    if (error) {
      feedback.textContent = 'Завдання недоступні: ' + error.message;
      return;
    }

    const zones = zoneLabels(zoneRows.data || []);
    const roster = new Map((rosterRows.data || []).map(row => [row.user_id, row.full_name || 'Працівник']));
    form.classList.toggle('hidden', !manager);
    if (manager) {
      fill(form.elements.zone_id, zones, 'Оберіть зону');
      fill(form.elements.assigned_to, [...roster].map(([id, name]) => ({ id, name })), 'Оберіть працівника');
    }
    const availableReports = (reports.data || []).filter(report => !(tasks.data || [])
      .some(task => task.report_id === report.id));
    const zoneNames = new Map(zones.map(zone => [zone.id, zone.name]));
    const rows = (tasks.data || []).map(task => renderTask(task, user, manager, roster, zoneNames, availableReports));
    list.replaceChildren(...rows);
    feedback.textContent = rows.length ? '' : 'Завдань для цього об’єкта немає.';
  }

  const load = () => reload().catch(() => {
    feedback.textContent = 'Не вдалося завантажити завдання. Спробуйте ще раз.';
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    const { user } = getState();
    const values = Object.fromEntries(new FormData(form));
    const projectId = project.value;
    try {
      const { error } = await sb.from(table).insert({
        ...values, project_id: projectId, title: values.title.trim(),
        instruction_text: values.instruction_text.trim(), due_on: values.due_on || null,
      });
      if (projectId !== project.value || user?.id !== getState().user?.id) return;
      if (error) feedback.textContent = error.message;
      else {
        form.reset();
        await load();
        feedback.textContent = 'Завдання створено.';
      }
    } catch {
      feedback.textContent = 'Не вдалося створити завдання. Спробуйте ще раз.';
    } finally {
      submit.disabled = false;
    }
  });
  panel.addEventListener('toggle', () => { if (panel.open) load(); });
  panel.querySelector('#assignmentReload').addEventListener('click', load);
  project.addEventListener('change', load);
  return { reset };
}
