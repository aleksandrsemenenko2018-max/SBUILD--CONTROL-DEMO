import { parseLedgerAmount } from './project-finance-ledger.js';

export const clientChargeLabels = new Map([
  ['material', 'Матеріали'],
  ['other', 'Додаткові послуги та витрати']
]);

export function chargeLines(charges, period) {
  if (!Array.isArray(charges)) throw new Error('Некоректні додаткові позиції звіту.');
  let total = 0;
  const lines = charges.map(row => {
    const { date, kind, description, subtotal } = row ?? {};
    const instant = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
      ? new Date(date + 'T00:00:00Z') : null;
    if (!instant || Number.isNaN(instant.getTime()) || instant.toISOString().slice(0, 10) !== date ||
        date < period.start || date > period.end || !clientChargeLabels.has(kind) ||
        typeof description !== 'string' || !description.trim() || [...description].length > 200 ||
        !Number.isSafeInteger(subtotal) || subtotal < 1 || subtotal > 100000000000000) {
      throw new Error('Некоректна додаткова позиція звіту.');
    }
    total += subtotal;
    return { date, kind, description, subtotal };
  });
  if (!Number.isSafeInteger(total)) throw new Error('Сума додаткових позицій перевищує допустимий діапазон.');
  return { charges: lines, chargeTotal: total };
}

export function reportChargeInput(form, projectId, period) {
  const charge = chargeLines([{
    date: form.get('date'), kind: form.get('kind'),
    description: form.get('description').trim(), subtotal: parseLedgerAmount(form.get('amount'))
  }], period).charges[0];
  if (!form.has('approved')) throw new Error('Підтвердьте, що позиція погоджена для звіту замовнику.');
  return { project_id: projectId, charge_date: charge.date, kind: charge.kind,
    description: charge.description, amount_cents: charge.subtotal };
}
