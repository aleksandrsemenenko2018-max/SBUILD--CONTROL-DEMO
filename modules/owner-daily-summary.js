const groups = [
  ['Відкриті завдання', 'open_tasks'],
  ['До виконання сьогодні', 'tasks_due_today'],
  ['Прострочені', 'overdue_tasks'],
  ['Звіти на погодженні у виконроба', 'reports_waiting_foreman'],
  ['Звіти на погодженні у директора', 'reports_waiting_owner'],
  ['Чернетки звернень', 'issue_drafts'],
  ['Звернення очікують відповіді', 'issues_waiting_reply'],
];

export function mountOwnerDailySummary(supabase) {
  const panel = document.getElementById('ownerDailySummary');
  const refresh = document.getElementById('ownerDailySummaryRefresh');
  const status = document.getElementById('ownerDailySummaryStatus');
  const list = document.getElementById('ownerDailySummaryProjects');
  let allowed = false;
  let revision = 0;

  function setAccess(value) {
    allowed = value;
    panel.hidden = !value;
    if (!allowed) {
      revision++;
      panel.open = false;
      list.replaceChildren();
      status.textContent = '';
      refresh.disabled = false;
    }
  }

  async function reload() {
    if (!allowed || refresh.disabled) return;
    const activeRevision = revision;
    refresh.disabled = true;
    list.replaceChildren();
    status.textContent = 'Завантажуємо зведення…';
    try {
      const { data, error } = await supabase.rpc('sbuild_owner_daily_summary', {}, { get: true });
      if (activeRevision !== revision || !allowed) return;
      if (error) throw error;
      if (!data?.length) {
        status.textContent = 'Немає доступних об’єктів.';
        return;
      }
      const [year, month, day] = data[0].summary_day.split('-');
      status.textContent = `${day}.${month}.${year} · За київським часом`;
      for (const row of data) {
        const item = document.createElement('li');
        const title = document.createElement('strong');
        title.textContent = row.project_name;
        const counts = document.createElement('ul');
        for (const [label, field] of groups) {
          const count = document.createElement('li');
          count.textContent = `${label}: ${row[field]}`;
          counts.append(count);
        }
        item.append(title, counts);
        list.append(item);
      }
    } catch (error) {
      if (activeRevision !== revision || !allowed) return;
      status.textContent = error.code === 'PGRST202'
        ? 'Зведення стане доступним після оновлення сервера.'
        : 'Не вдалося завантажити зведення. Спробуйте оновити.';
    } finally {
      if (activeRevision === revision) refresh.disabled = false;
    }
  }

  panel.addEventListener('toggle', () => {
    if (panel.open) reload();
  });
  refresh.addEventListener('click', reload);
  return { setAccess };
}
