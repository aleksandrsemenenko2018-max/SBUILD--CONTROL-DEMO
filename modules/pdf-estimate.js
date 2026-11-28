const number = '[0-9]+(?:[.,][0-9]+)?';
const unit = '(?:м²|м³|м2|м3|м|m²|m³|m2|m3|m|шт\\.?|pcs|кг|kg|т|л|l)';
const quantityRow = new RegExp('^(.+?)\\s+(?:[|;]\\s*)?(' + number + ')\\s*(' + unit + ')$', 'iu');
const rectangleRow = new RegExp('^(.+?)\\s*[|;]\\s*(' + number + ')\\s*(м|m|см|cm|мм|mm)\\s*[×xх]\\s*(' + number + ')\\s*(м|m|см|cm|мм|mm)$', 'iu');
const dimension = new RegExp('(?:^|\\s)' + number + '\\s*(?:мм|mm|см|cm|м|m)(?=\\s|$|[×xх])', 'iu');

const decimal = value => Number(value.replace(',', '.'));
const meters = (value, unit) => decimal(value) / ({ мм: 1000, mm: 1000, см: 100, cm: 100 }[unit.toLowerCase()] ?? 1);
const finitePositive = value => Number.isFinite(value) && value > 0;

export function positionedLines(items) {
  const rows = [];
  for (const item of items) {
    const text = item.str?.trim();
    if (!text || !item.transform) continue;
    const [, , , , x, y] = item.transform;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    let row = rows.find(candidate => Math.abs(candidate.y - y) < 2);
    if (!row) {
      row = { y, blocks: [] };
      rows.push(row);
    }
    row.blocks.push({ x, text, end: x + (item.width ?? 0) });
  }
  return rows.sort((a, b) => b.y - a.y).map(row => {
    const blocks = row.blocks.sort((a, b) => a.x - b.x);
    return blocks.map((block, index) => (
      index > 0 ? (block.x - blocks[index - 1].end > 18 ? ' | ' : ' ') + block.text : block.text
    )).join('');
  });
}

export function estimateCandidates(pages) {
  const candidates = [];
  const references = [];
  for (const { page, lines } of pages) {
    for (const source of lines) {
      const line = source.trim().replace(/\s+/g, ' ');
      const rect = rectangleRow.exec(line);
      const match = quantityRow.exec(line.replace(/\s*\|\s*/g, ' '));
      const rectangle = rect && /^(площа|area)(?=\s|:)/iu.test(rect[1]);
      const label = (rectangle ? rect[1] : match?.[1])?.trim();
      const quantity = rectangle
        ? meters(rect[2], rect[3]) * meters(rect[4], rect[5])
        : match ? decimal(match[2]) : null;
      if (label && finitePositive(quantity) && /\p{L}/u.test(label) &&
          (rectangle || !dimension.test(label))) {
        const candidateUnit = rectangle ? 'м²' : match[3].toLowerCase().replace(/[mм]2/gu, 'м²').replace(/[mм]3/gu, 'м³');
        candidates.push({ page, source, label, quantity, unit: candidateUnit, kind: /^(матеріал|material)\s*:/iu.test(label) ? 'material' : 'work' });
      } else if (dimension.test(line) || /(?:[×xх]\s*\d|(?:специфікація|specification|поз\.))/iu.test(line)) {
        references.push({ page, source });
      }
    }
  }
  return { candidates, references };
}

export function buildReviewedEstimate(candidates, audience) {
  if (!['worker', 'customer'].includes(audience)) throw new Error('Невідомий тип кошторису.');
  const rateName = audience === 'worker' ? 'workerRate' : 'customerRate';
  return candidates.filter(row => row.approved && (audience === 'customer' || row.kind !== 'material')).map(row => {
    const label = row.label.trim();
    const unit = row.unit.trim();
    const quantity = Number(row.quantity);
    const enteredRate = row[rateName];
    const rate = enteredRate === '' || enteredRate == null ? null : Number(enteredRate);
    if (!label || !unit || !finitePositive(quantity) || (rate !== null && (!Number.isFinite(rate) || rate < 0))) {
      throw new Error('Перевірте назву, обсяг, одиницю та розцінку погодженого рядка.');
    }
    const amount = rate === null ? null : Math.round(quantity * rate * 100) / 100;
    if (amount !== null && !Number.isFinite(amount)) throw new Error('Сума поза допустимим діапазоном.');
    return { label, unit, quantity, rate, amount, page: row.page, kind: row.kind };
  });
}

export function estimateCsv(rows) {
  const cell = value => {
    const raw = value == null ? '' : String(value);
    const text = typeof value === 'string' && /^[\s\uFEFF]*[=+\-@\t\r\n]/u.test(raw) ? "'" + raw : raw;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  const header = ['Позиція', 'Одиниця', 'Обсяг', 'Розцінка', 'Сума', 'Сторінка'];
  return '\ufeff' + [header, ...rows.map(row => [row.label, row.unit, row.quantity, row.rate, row.amount, row.page])]
    .map(row => row.map(cell).join(';')).join('\r\n');
}
