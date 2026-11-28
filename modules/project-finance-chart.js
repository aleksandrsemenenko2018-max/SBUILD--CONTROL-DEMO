const kinds = ['customer_charge', 'customer_payment', 'customer_advance', 'customer_refund', 'transport_expense'];
const monthLabel = new Intl.DateTimeFormat('uk-UA', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const modes = new Map([
  ['customer', [
    { label: 'Нараховано замовнику', value: month => month.customer_charge },
    { label: 'Отримано оплат і авансів', value: month => month.customer_payment + month.customer_advance }
  ]],
  ['cash', [
    { label: 'Оплати', value: month => month.customer_payment },
    { label: 'Аванси', value: month => month.customer_advance },
    { label: 'Повернення', value: month => month.customer_refund }
  ]],
  ['transport', [{ label: 'Транспортні витрати', value: month => month.transport_expense }]]
]);

function dateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

export function reportMonthRange(from, to) {
  const start = dateOnly(from);
  const end = dateOnly(to);
  if (!start || !end || start > end) throw new Error('Вкажіть коректний період.');
  const count = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    end.getUTCMonth() - start.getUTCMonth() + 1;
  if (count > 12) throw new Error('Оберіть період у межах 12 календарних місяців.');

  const month = new Date(start.getTime());
  month.setUTCDate(1);
  const keys = [];
  for (let index = 0; index < count; index++) {
    keys.push(month.toISOString().slice(0, 7));
    month.setUTCMonth(month.getUTCMonth() + 1);
  }
  return { from, to, keys };
}

export function groupRecordedFinance(range, entries) {
  const months = new Map(range.keys.map(key => [key, {
    key, ...Object.fromEntries(kinds.map(kind => [kind, 0n]))
  }]));
  let included = 0;
  for (const entry of entries) {
    if (entry.reversed || !kinds.includes(entry.kind) || !dateOnly(entry.occurred_on) ||
      entry.occurred_on < range.from || entry.occurred_on > range.to) continue;
    const month = months.get(entry.occurred_on.slice(0, 7));
    if (!month) continue;
    month[entry.kind] += BigInt(entry.amount_cents);
    included++;
  }
  return { months: [...months.values()], included };
}

function formatLocalDate(date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')].join('-');
}

export function mountProjectFinanceChart({ supabase, hasOwnerAccess, getProjectId, formatCents }) {
  const panel = document.getElementById('projectLedgerChart');
  const form = document.getElementById('financeChartForm');
  const status = document.getElementById('financeChartStatus');
  const chart = document.getElementById('financeChartResult');
  const mode = form.elements.mode;
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth() - 5, 1);
  form.elements.from.value = formatLocalDate(start);
  form.elements.to.value = formatLocalDate(today);
  let revision = 0;
  let result = null;

  const make = (tag, text) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const colour = (element, index) => { element.classList.add('finance-chart-series-' + index); };
  const monthName = key => monthLabel.format(new Date(key + '-01T00:00:00Z'));

  function render() {
    if (!result || !hasOwnerAccess()) return;
    const series = modes.get(mode.value);
    const showTable = Boolean(chart.querySelector('details')?.open);
    const { range, months, included } = result;
    chart.replaceChildren(make('p', range.from + ' — ' + range.to + ' · За датою операції'));
    if (!included) {
      chart.append(make('p', 'Вибраний період не містить проведених операцій.'));
      return;
    }

    const rows = months.map(month => ({ label: monthName(month.key), values: series.map(item => item.value(month)) }));
    const maximum = rows.flatMap(row => row.values).reduce((max, value) => value > max ? value : max, 0n);
    if (!maximum) {
      chart.append(make('p', 'За вибраним показником проведених операцій немає.'));
      return;
    }
    const graphic = make('div');
    graphic.className = 'finance-chart-graphic';
    graphic.setAttribute('aria-hidden', 'true');

    const legend = make('ul');
    legend.className = 'finance-chart-legend';
    series.forEach(({ label }, index) => {
      const item = make('li', label);
      colour(item, index);
      legend.append(item);
    });
    const axis = make('div');
    axis.className = 'finance-chart-axis';
    axis.append(make('span', '0 грн'), make('span', formatCents(maximum)));
    graphic.append(legend, axis);

    const table = make('table');
    const header = make('tr');
    for (const label of ['Місяць', ...series.map(item => item.label)]) {
      const th = make('th', label);
      th.scope = 'col';
      header.append(th);
    }
    const head = make('thead');
    head.append(header);
    const body = make('tbody');
    table.append(head, body);

    for (const { label, values } of rows) {
      const group = make('div');
      group.className = 'finance-chart-month';
      group.append(make('div', label));
      const bars = make('div');
      bars.className = 'finance-chart-bars';
      values.forEach((value, index) => {
        const bar = make('div');
        colour(bar, index);
        bar.style.width = Number(value * 10000n / maximum) / 100 + '%';
        if (value > 0n) bar.style.minWidth = '2px';
        bar.title = series[index].label + ' · ' + formatCents(value);
        bars.append(bar);
      });
      group.append(bars);
      graphic.append(group);

      const row = make('tr');
      const month = make('th', label);
      month.scope = 'row';
      row.append(month, ...values.map(value => make('td', formatCents(value))));
      body.append(row);
    }
    const details = make('details');
    details.open = showTable;
    const scroll = make('div');
    scroll.className = 'finance-chart-table';
    scroll.append(table);
    details.append(make('summary', 'Таблиця даних'), scroll);
    chart.append(graphic, details);
  }

  async function load() {
    const version = ++revision;
    result = null;
    chart.replaceChildren();
    status.textContent = '';
    const pid = getProjectId();
    if (!panel.open || !hasOwnerAccess() || !pid) return;

    let range;
    try {
      range = reportMonthRange(form.elements.from.value, form.elements.to.value);
    } catch (error) {
      status.textContent = error.message;
      return;
    }

    status.textContent = 'Завантаження даних…';
    const entries = [];
    const size = 200;
    try {
      for (let offset = 0;; offset += size) {
        const { data, error } = await supabase.from('sbuild_project_finance_history')
          .select('kind,amount_cents,occurred_on,reversed').eq('project_id', pid)
          .eq('reversed', false).neq('kind', 'reversal').gte('occurred_on', range.from).lte('occurred_on', range.to)
          .order('id').range(offset, offset + size - 1);
        if (version !== revision || !hasOwnerAccess()) return;
        if (error) throw error;
        entries.push(...(data || []));
        if (!data || data.length < size) break;
      }
      result = { range, ...groupRecordedFinance(range, entries) };
      status.textContent = '';
      render();
    } catch {
      if (version === revision) status.textContent = 'Графік недоступний. Перевірте доступ до фінансового журналу.';
    }
  }

  form.addEventListener('submit', event => { event.preventDefault(); void load(); });
  mode.addEventListener('change', render);
  panel.addEventListener('toggle', load);

  return {
    refresh: () => { if (panel.open) void load(); },
    clear: () => { revision++; result = null; chart.replaceChildren(); status.textContent = ''; }
  };
}
