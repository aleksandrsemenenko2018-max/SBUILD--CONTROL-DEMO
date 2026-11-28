import { chargeLines, clientChargeLabels } from './client-report-charges.js';

const amount = new Intl.NumberFormat('uk-UA', {
  style: 'currency',
  currency: 'UAH'
});

function dateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

export function reportWeek(start) {
  const date = dateOnly(start);
  if (!date) throw new Error('Вкажіть коректну дату початку тижня.');
  date.setUTCDate(date.getUTCDate() + 6);
  const end = date.toISOString().slice(0, 10);
  if (!dateOnly(end)) throw new Error('Вкажіть коректну дату початку тижня.');
  return { start, end };
}

function zonePath(id, zones) {
  const path = [];
  const visited = new Set();
  while (zones.has(id) && !visited.has(id)) {
    visited.add(id);
    const zone = zones.get(id);
    path.unshift(zone.name);
    id = zone.parent_id;
  }
  return path.join(' / ') || 'Без зони';
}

function lineAmount(quantity, rate) {
  if (quantity === null || quantity === undefined || quantity === '' ||
      rate === null || rate === undefined || rate === '') return null;
  const units = Number(quantity);
  const clientRate = Number(rate);
  if (units < 0 || clientRate < 0) return null;
  const price = units * clientRate;
  if (!Number.isFinite(price)) return null;
  const cents = Math.round((price + Number.EPSILON * price) * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

export function buildClientReport(project, period, work, zones, charges = []) {
  const zoneIndex = new Map(zones.map(zone => [zone.id, zone]));
  const groups = new Map();
  let knownTotal = 0;
  let unpricedCount = 0;
  for (const row of work) {
    if (row.status !== 'owner_approved' || !dateOnly(row.work_date) ||
        row.work_date < period.start || row.work_date > period.end) continue;
    const zone = zonePath(row.zone_id, zoneIndex);
    const subtotal = lineAmount(row.quantity, row.client_rate);
    if (subtotal === null) unpricedCount++;
    else {
      knownTotal += subtotal;
      if (!Number.isSafeInteger(knownTotal)) throw new Error('Сума робіт перевищує допустимий діапазон.');
    }
    if (!groups.has(zone)) groups.set(zone, []);
    groups.get(zone).push({
      id: row.id,
      date: row.work_date,
      description: String(row.description ?? ''),
      quantity: String(row.quantity ?? ''),
      unit: String(row.unit ?? ''),
      subtotal
    });
  }
  return { project: String(project), period, groups: [...groups], knownTotal, unpricedCount,
    ...(charges.length ? chargeLines(charges, period) : {}) };
}

export function readClientReportSnapshot(report, requestedStart) {
  const period = reportWeek(requestedStart);
  if (!report || typeof report.project !== 'string' ||
      report.period?.start !== period.start || report.period?.end !== period.end ||
      !Array.isArray(report.groups)) throw new Error('Некоректний збережений звіт.');
  let knownTotal = 0;
  let unpricedCount = 0;
  const groups = report.groups.map(group => {
    if (!Array.isArray(group) || typeof group[0] !== 'string' || !Array.isArray(group[1])) {
      throw new Error('Некоректний збережений звіт.');
    }
    return [group[0], group[1].map(row => {
      const { date, description, quantity, unit, subtotal } = row ?? {};
      if (!dateOnly(date) || date < period.start || date > period.end ||
          [description, quantity, unit].some(value => typeof value !== 'string') ||
          (subtotal !== null && (!Number.isSafeInteger(subtotal) || subtotal < 0))) {
        throw new Error('Некоректний рядок збереженого звіту.');
      }
      if (subtotal === null) unpricedCount++;
      else knownTotal += subtotal;
      return { date, description, quantity, unit, subtotal };
    })];
  });
  if (!Number.isSafeInteger(knownTotal) || report.knownTotal !== knownTotal || report.unpricedCount !== unpricedCount) {
    throw new Error('Підсумок збереженого звіту не збігається з рядками.');
  }
  return { project: report.project, period, groups, knownTotal, unpricedCount,
    ...(report.charges === undefined ? {} : chargeLines(report.charges, period)) };
}

const photoCaptions = new Map([
  ['before', 'До початку'],
  ['after', 'Після завершення'],
  ['hidden_before_close', 'Прихована робота перед закриттям'],
  ['hidden_recheck', 'Повторна перевірка перед закриттям']
]);

export function clientPhotoCaption(stage) {
  return photoCaptions.get(stage);
}

export function canAttachClientPhoto(projectId, photo) {
  if (!clientPhotoCaption(photo.stage) || typeof photo.storage_path !== 'string') return false;
  const prefix = projectId + '/' + photo.report_id + '/';
  return photo.storage_path.startsWith(prefix) &&
    /^[a-z0-9_-]+\.(jpg|jpeg|png|webp)$/i.test(photo.storage_path.slice(prefix.length));
}

export function renderClientReport(doc, report, selectedPhotos = new Map()) {
  const make = (tag, text) => {
    const node = doc.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const fragment = doc.createDocumentFragment();
  fragment.append(
    make('h1', 'Тижневий звіт замовнику'),
    make('p', report.project),
    make('p', report.period.start + ' — ' + report.period.end)
  );
  if (!report.groups.length) fragment.append(make('p', 'За цей тиждень затверджених робіт немає.'));
  for (const [zone, rows] of report.groups) {
    const section = make('section');
    section.append(make('h2', zone));
    for (const row of rows) {
      const work = make('article');
      work.append(
        make('h3', row.description),
        make('p', [row.date, row.quantity + ' ' + row.unit,
          row.subtotal === null ? 'Ціну не вказано' : amount.format(row.subtotal / 100)].join(' · '))
      );
      for (const { src, caption } of selectedPhotos.get(row.id) ?? []) {
        const figure = make('figure');
        const image = make('img');
        image.src = src;
        image.alt = caption;
        figure.append(image, make('figcaption', caption));
        work.append(figure);
      }
      section.append(work);
    }
    fragment.append(section);
  }
  if (report.groups.length) {
    const label = report.unpricedCount ? 'Сума робіт із зазначеною ціною' : 'Разом роботи';
    fragment.append(make('strong', label + ' · ' + amount.format(report.knownTotal / 100)));
    if (report.unpricedCount) fragment.append(make('p', 'Робіт без ціни: ' + report.unpricedCount));
  }
  if (report.charges?.length) {
    const section = make('section');
    section.append(make('h2', 'Погоджені додаткові позиції'));
    for (const row of report.charges) {
      section.append(make('p', [row.date, clientChargeLabels.get(row.kind),
        row.description, amount.format(row.subtotal / 100)].join(' · ')));
    }
    section.append(make('strong', 'Разом додаткові позиції · ' + amount.format(report.chargeTotal / 100)));
    fragment.append(section);
  }
  return fragment;
}

function csvCell(value) {
  const text = String(value);
  const safe = /^[\t\r\n]|^[\s\uFEFF]*[=+@-]/.test(text) ? "'" + text : text;
  return '"' + safe.replaceAll('"', '""') + '"';
}

export function clientReportRows(report) {
  const rows = [['Об’єкт', 'Початок тижня', 'Кінець тижня', 'Зона', 'Дата роботи',
    'Опис роботи', 'Кількість', 'Одиниця', 'Вартість, UAH']];
  for (const [zone, work] of report.groups) {
    for (const row of work) {
      rows.push([report.project, report.period.start, report.period.end, zone, row.date,
        row.description, row.quantity, row.unit, row.subtotal === null ? '' : row.subtotal / 100]);
    }
  }
  for (const row of report.charges ?? []) {
    rows.push([report.project, report.period.start, report.period.end, '', row.date,
      clientChargeLabels.get(row.kind) + ' · ' + row.description, '', '', row.subtotal / 100]);
  }
  return rows;
}

export function clientReportCsv(report) {
  return '\uFEFF' + clientReportRows(report).map((row, index) => row.map((value, col) =>
    csvCell(index && col === 8 && typeof value === 'number' ? value.toFixed(2) : value)
  ).join(',')).join('\r\n') + '\r\n';
}
