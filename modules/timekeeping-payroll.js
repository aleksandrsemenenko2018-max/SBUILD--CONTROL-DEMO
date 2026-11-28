const kyivDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit',
});
const money = new Intl.NumberFormat('uk-UA', { style: 'currency', currency: 'UAH' });

export function todayInKyiv() {
  const parts = Object.fromEntries(kyivDate.formatToParts().map(part => [part.type, part.value]));
  return parts.year + '-' + parts.month + '-' + parts.day;
}

function addDays(date, days) {
  const value = new Date(date + 'T12:00:00Z');
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function mondayOf(date) {
  const day = new Date(date + 'T12:00:00Z').getUTCDay();
  return addDays(date, -(day + 6) % 7);
}

function isMonday(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && new Date(date + 'T12:00:00Z').getUTCDay() === 1;
}

function fill(select, items, emptyLabel = '') {
  const previous = select.value;
  select.replaceChildren(...(emptyLabel ? [new Option(emptyLabel, '')] : []),
    ...items.map(item => new Option(item.name, item.id)));
  if ([...select.options].some(option => option.value === previous)) select.value = previous;
}

function table(columns, rows) {
  const output = document.createElement('table');
  const header = output.createTHead().insertRow();
  for (const label of columns) {
    const heading = document.createElement('th');
    heading.scope = 'col';
    heading.textContent = label;
    header.append(heading);
  }
  const body = output.createTBody();
  for (const values of rows) {
    const row = body.insertRow();
    for (const value of values) {
      const cell = row.insertCell();
      if (value instanceof Node) cell.append(value);
      else cell.textContent = value;
    }
  }
  return output;
}

export function mountAttendance({ sb, panel, getState }) {
  const project = panel.querySelector('#attendanceProject');
  const week = panel.querySelector('#attendanceWeek');
  const form = panel.querySelector('#sbuildAttendanceForm');
  const date = form.querySelector('#attendanceDate');
  const worker = form.querySelector('#attendanceWorker');
  const message = panel.querySelector('#attendanceFeedback');
  const output = panel.querySelector('#attendanceSummary');
  const save = form.querySelector('button[type="submit"]');
  let generation = 0;

  function reset() {
    generation += 1;
    panel.open = false;
    form.reset();
    form.classList.add('hidden');
    project.replaceChildren();
    worker.replaceChildren();
    output.replaceChildren();
    message.textContent = '';
    date.max = todayInKyiv();
    date.value = date.max;
    week.value = mondayOf(date.max);
  }

  async function load() {
    const request = ++generation;
    const { user, profile, projects } = getState();
    form.classList.add('hidden');
    output.replaceChildren();
    if (!user || !profile?.active || !projects.length) {
      message.textContent = 'Немає доступних об’єктів.';
      return;
    }
    fill(project, projects);
    date.max = todayInKyiv();
    const manager = ['owner', 'foreman'].includes(profile.role);
    const projectId = project.value;
    const start = week.value;
    if (!isMonday(start)) {
      message.textContent = 'Оберіть понеділок як початок тижня.';
      return;
    }
    message.textContent = 'Завантаження…';
    try {
      const [attendance, roster] = await Promise.all([
        sb.from('sbuild_attendance_daily').select('worker_id,work_date,present,notes')
          .eq('project_id', projectId).gte('work_date', start).lt('work_date', addDays(start, 7)).order('work_date'),
        manager ? sb.rpc('sbuild_work_assignment_roster', { p_project_id: projectId }) : { data: [] },
      ]);
      if (request !== generation || user.id !== getState().user?.id) return;
      const error = attendance.error || roster.error;
      if (error) {
        message.textContent = error.message;
        return;
      }
      const people = new Map((roster.data || []).map(person => [person.user_id, person.full_name || 'Працівник']));
      people.set(user.id, profile.full_name || 'Я');
      if (manager) fill(worker, (roster.data || []).map(person => ({
        id: person.user_id, name: people.get(person.user_id),
      })), 'Оберіть працівника');
      form.classList.toggle('hidden', !manager);
      const totals = new Map();
      const days = [];
      for (const row of attendance.data || []) {
        const counts = totals.get(row.worker_id) || { present: 0, absent: 0 };
        counts[row.present ? 'present' : 'absent'] += 1;
        totals.set(row.worker_id, counts);
        days.push([row.work_date, people.get(row.worker_id) || 'Працівник',
          row.present ? 'Присутній' : 'Відсутній', row.notes || '']);
      }
      if (days.length) {
        output.append(table(['Працівник', 'Людино-дні', 'Дні відсутності'],
          [...totals].map(([id, counts]) => [people.get(id) || 'Працівник', counts.present, counts.absent])));
        output.append(table(['Дата', 'Працівник', 'Присутність', 'Примітка'], days));
      }
      message.textContent = days.length ? '' : 'За цей тиждень записів немає.';
    } catch {
      if (request === generation) message.textContent = 'Не вдалося завантажити відвідуваність.';
    }
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const { user, profile } = getState();
    const projectId = project.value;
    const workDate = date.value;
    if (!user || !profile?.active || !['owner', 'foreman'].includes(profile.role) || !worker.value) return;
    if (!workDate || workDate > todayInKyiv()) {
      message.textContent = 'Оберіть сьогоднішню або минулу дату.';
      return;
    }
    save.disabled = true;
    try {
      const { error } = await sb.rpc('sbuild_record_daily_attendance', {
        p_project_id: projectId, p_worker_id: worker.value, p_date: workDate,
        p_present: form.querySelector('#attendancePresent').value === 'true',
        p_note: form.querySelector('#attendanceNotes').value.trim(),
      });
      if (user.id !== getState().user?.id || projectId !== project.value) return;
      if (error) {
        message.textContent = error.message;
        return;
      }
      week.value = mondayOf(workDate);
      await load();
      if (!message.textContent) message.textContent = 'День збережено.';
    } catch {
      if (user.id === getState().user?.id) message.textContent = 'Не вдалося зберегти відвідуваність.';
    } finally {
      save.disabled = false;
    }
  });
  panel.addEventListener('toggle', () => { if (panel.open) load(); });
  panel.querySelector('#attendanceReload').addEventListener('click', load);
  project.addEventListener('change', load);
  week.addEventListener('change', load);
  reset();
  return { reset, open(projectId) {
    fill(project, getState().projects);
    if (projectId) project.value = projectId;
    if (panel.open) load();
    else panel.open = true;
    panel.querySelector('summary').focus();
  } };
}

export function mountWeeklyPayroll({ sb, panel, getState }) {
  const project = panel.querySelector('#weeklyFinanceProject');
  const week = panel.querySelector('#weeklyFinanceDate');
  const message = panel.querySelector('#weeklyFinanceMessage');
  const output = panel.querySelector('#weeklyFinanceTable');
  let generation = 0;

  function reset() {
    generation += 1;
    panel.open = false;
    project.replaceChildren();
    output.replaceChildren();
    message.textContent = '';
    week.value = mondayOf(todayInKyiv());
  }

  async function load() {
    const request = ++generation;
    const { user, profile, projects } = getState();
    output.replaceChildren();
    if (!user || !profile?.active || !projects.length) {
      message.textContent = 'Немає доступних об’єктів.';
      return;
    }
    fill(project, projects);
    const projectId = project.value;
    const start = week.value;
    if (!isMonday(start)) {
      message.textContent = 'Оберіть понеділок як початок тижня.';
      return;
    }
    message.textContent = 'Завантаження…';
    const selected = () => request === generation && user.id === getState().user?.id;
    try {
      const { data, error } = await sb.rpc('sbuild_weekly_payout_summary', {
        p_project_id: projectId, p_week_start: start,
      });
      if (!selected()) return;
      if (error) {
        message.textContent = error.message;
        return;
      }
      const owner = profile.role === 'owner';
      const weekClosed = addDays(start, 7) <= todayInKyiv();
      const rows = (data || []).map(worker => {
        const earned = Number(worker.earned_amount);
        const paid = worker.paid_amount === null ? null : Number(worker.paid_amount);
        const ready = Number(worker.missing_rate_count) === 0;
        const status = worker.paid_on
          ? 'Виплачено ' + worker.paid_on + (ready && earned > paid ? ' · Доплата ' + money.format(earned - paid) : '')
          : ready ? 'Не виплачено' : 'Є роботи без погодженої розцінки';
        const values = [worker.full_name || 'Працівник', worker.report_count, money.format(earned),
          paid === null ? '—' : money.format(paid), status];
        if (!owner) return values;
        const canPay = weekClosed && ready && earned > 0 && paid === null;
        if (!canPay) return [...values, '—'];
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = 'Позначити фактичну виплату';
        button.addEventListener('click', async () => {
          button.disabled = true;
          try {
            const { error: saveError } = await sb.rpc('sbuild_record_weekly_payout', {
              p_project_id: projectId, p_worker_id: worker.worker_id, p_week_start: start,
            });
            if (!selected()) return;
            if (saveError) {
              message.textContent = saveError.message;
              return;
            }
            await load();
            if (!message.textContent) message.textContent = 'Виплату зафіксовано.';
          } catch {
            if (selected()) message.textContent = 'Не вдалося зафіксувати виплату.';
          } finally {
            button.disabled = false;
          }
        });
        return [...values, button];
      });
      const columns = ['Працівник', 'Затверджені роботи', 'Нараховано', 'Виплачено', 'Стан'];
      if (owner) columns.push('Дія');
      if (rows.length) output.append(table(columns, rows));
      message.textContent = rows.length ? '' : 'За цей тиждень нарахувань немає.';
    } catch {
      if (selected()) message.textContent = 'Не вдалося завантажити нарахування.';
    }
  }

  panel.addEventListener('toggle', () => { if (panel.open) load(); });
  panel.querySelector('#weeklyFinanceRefresh').addEventListener('click', load);
  project.addEventListener('change', load);
  week.addEventListener('change', load);
  reset();
  return { reset };
}
