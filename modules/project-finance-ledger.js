import { mountProjectFinanceChart } from "./project-finance-chart.js";

const kindLabels = new Map([
  ['customer_charge', 'Нараховано замовнику'],
  ['customer_payment', 'Оплата від замовника'],
  ['customer_advance', 'Аванс від замовника'],
  ['customer_refund', 'Повернення замовнику'],
  ['transport_expense', 'Транспортні витрати'],
  ['reversal', 'Сторнування']
]);
const currency = new Intl.NumberFormat('uk-UA', { style: 'currency', currency: 'UAH' });

export function parseLedgerAmount(value) {
  const match = /^(\d{1,13})(?:[.,](\d{1,2}))?$/.exec(value.trim());
  if (!match) throw new Error('Вкажіть суму в гривнях, до двох знаків після коми.');
  const cents = BigInt(match[1]) * 100n + BigInt((match[2] || '').padEnd(2, '0'));
  if (cents <= 0n || cents > 100000000000000n) throw new Error('Сума поза допустимим діапазоном.');
  return Number(cents);
}

export function ledgerTotals(row) {
  const cents = field => BigInt(row?.[field] ?? 0);
  const charges = cents('charged_cents');
  const payments = cents('paid_cents');
  const advances = cents('advance_cents');
  const refunds = cents('refunded_cents');
  const transport = cents('transport_cents');
  const balance = charges + refunds - payments - advances;
  return { charges, payments, advances, refunds, transport, balance };
}

function formatCents(cents) {
  const fraction = String(cents % 100n).padStart(2, '0');
  return currency.formatToParts(cents / 100n)
    .map(part => part.type === 'fraction' ? fraction : part.value).join('');
}

function today() {
  const date = new Date();
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')].join('-');
}

export function mountProjectLedger(supabase, hasOwnerAccess, getProjectId) {
  const panel = document.getElementById('projectLedger');
  const form = document.getElementById('projectLedgerForm');
  const summary = document.getElementById('projectLedgerSummary');
  const history = document.getElementById('projectLedgerHistory');
  const status = document.getElementById('projectLedgerStatus');
  const more = document.getElementById('projectLedgerMore');
  const reload = document.getElementById('projectLedgerReload');
  const fieldset = form.querySelector('fieldset');
  const charts = mountProjectFinanceChart({ supabase, hasOwnerAccess, getProjectId, formatCents });
  const pageSize = 50;
  let revision = 0;
  let nextPage = 0;
  let currentProject = null;
  const pending = new Map();
  const saving = new Set();

  form.elements.occurredOn.value = today();
  for (const [kind, label] of kindLabels) {
    if (kind !== 'reversal') form.elements.kind.add(new Option(label, kind));
  }

  function reset() {
    revision++;
    currentProject = null;
    nextPage = 0;
    fieldset.disabled = true;
    summary.replaceChildren();
    history.replaceChildren();
    more.hidden = true;
    more.disabled = false;
    status.textContent = '';
  }

  function renderSummary(row) {
    const { charges, payments, advances, refunds, transport, balance } = ledgerTotals(row);
    const items = [
      ['Нараховано', charges], ['Оплати', payments], ['Аванси', advances],
      ['Повернення', refunds], ['Транспортні витрати за журналом', transport],
      [balance < 0n ? 'Кредит замовника' : 'Заборгованість замовника', balance < 0n ? -balance : balance]
    ];
    for (const [label, amount] of items) {
      const line = document.createElement('li');
      line.textContent = label + ' · ' + formatCents(amount);
      summary.append(line);
    }
  }

  async function save(input) {
    if (!hasOwnerAccess() || input.p_project_id !== currentProject) return;
    const signature = JSON.stringify(input);
    if (saving.has(signature)) return;
    const operation = pending.get(signature) ?? crypto.randomUUID();
    pending.set(signature, operation);
    saving.add(signature);
    const version = revision;
    fieldset.disabled = true;
    status.textContent = 'Збереження…';
    try {
      const { error } = await supabase.rpc('sbuild_record_project_finance_entry', { p_id: operation, ...input });
      if (error) throw error;
      pending.delete(signature);
      if (version !== revision) return;
      if (input.p_kind !== 'reversal') {
        form.elements.amount.value = '';
        form.elements.description.value = '';
      }
      await load();
    } catch (error) {
      if (version !== revision) return;
      status.textContent = 'Не вдалося підтвердити запис. Оновіть журнал або повторіть ті самі дані. ' +
        (error.message || '');
      fieldset.disabled = false;
    } finally {
      saving.delete(signature);
    }
  }

  function renderRow(entry) {
    const item = document.createElement('li');
    const line = document.createElement('span');
    line.textContent = [entry.occurred_on, kindLabels.get(entry.kind), formatCents(BigInt(entry.amount_cents)), entry.description]
      .join(' · ');
    item.append(line);
    if (entry.reversed) {
      item.append(' · Сторновано');
    } else if (entry.kind !== 'reversal') {
      const reverse = document.createElement('button');
      reverse.type = 'button';
      reverse.textContent = 'Сторнувати';
      reverse.onclick = async () => {
        if (fieldset.disabled) return;
        const reason = window.prompt('Вкажіть причину сторнування.');
        if (!reason?.trim()) return;
        if (reason.trim().length > 240) { status.textContent = 'Причина має містити не більше 240 символів.'; return; }
        await save({
          p_project_id: currentProject, p_kind: 'reversal', p_amount_cents: null,
          p_occurred_on: today(), p_description: reason.trim(), p_reverses_entry_id: entry.id
        });
      };
      item.append(' ', reverse);
    }
    history.append(item);
  }

  async function loadHistory(pid, offset) {
    const { data, error } = await supabase.from('sbuild_project_finance_history')
      .select('id,kind,amount_cents,occurred_on,description,reversed')
      .eq('project_id', pid).order('occurred_on', { ascending: false })
      .order('recorded_at', { ascending: false }).order('id', { ascending: false })
      .range(offset, offset + pageSize);
    if (error) throw error;
    return data || [];
  }

  function addHistory(rows) {
    if (!nextPage && !rows.length) {
      const empty = document.createElement('li');
      empty.textContent = 'Записів ще немає.';
      history.append(empty);
    }
    rows.slice(0, pageSize).forEach(renderRow);
    nextPage += pageSize;
    more.hidden = rows.length <= pageSize;
  }

  async function load() {
    reset();
    if (!panel.open || !hasOwnerAccess()) { charts.clear(); return; }
    charts.refresh();
    const pid = getProjectId();
    if (!pid) return;
    currentProject = pid;
    const version = revision;
    status.textContent = 'Завантаження…';
    try {
      const [aggregate, rows] = await Promise.all([
        supabase.from('sbuild_project_finance_balances')
          .select('charged_cents,paid_cents,advance_cents,refunded_cents,transport_cents').eq('project_id', pid).maybeSingle(),
        loadHistory(pid, 0)
      ]);
      if (version !== revision || !hasOwnerAccess()) return;
      if (aggregate.error) throw aggregate.error;
      renderSummary(aggregate.data);
      addHistory(rows);
      status.textContent = '';
      fieldset.disabled = false;
    } catch {
      if (version === revision) status.textContent = 'Фінансовий журнал недоступний на цьому сервері.';
    }
  }

  more.onclick = async () => {
    const version = revision;
    more.disabled = true;
    try {
      const rows = await loadHistory(currentProject, nextPage);
      if (version === revision) addHistory(rows);
    } catch {
      if (version === revision) status.textContent = 'Не вдалося завантажити решту записів.';
    } finally {
      if (version === revision) more.disabled = false;
    }
  };

  form.onsubmit = event => {
    event.preventDefault();
    if (fieldset.disabled) return;
    try {
      const data = new FormData(form);
      const kind = data.get('kind');
      const description = data.get('description').trim();
      if (!kindLabels.has(kind) || kind === 'reversal') throw new Error('Оберіть тип операції.');
      if (!description) throw new Error('Додайте опис операції.');
      void save({
        p_project_id: currentProject, p_kind: kind, p_amount_cents: parseLedgerAmount(data.get('amount')),
        p_occurred_on: data.get('occurredOn'), p_description: description, p_reverses_entry_id: null
      });
    } catch (error) {
      status.textContent = error.message;
    }
  };
  reload.onclick = load;
  panel.addEventListener('toggle', load);
  return { load, clear: () => { pending.clear(); charts.clear(); reset(); } };
}
