import assert from 'node:assert/strict';
import { test } from 'node:test';
import { groupRecordedFinance, reportMonthRange } from '../modules/project-finance-chart.js';

test('includes both partial endpoint months with UTC calendar boundaries', () => {
  assert.deepEqual(reportMonthRange('2026-12-30', '2027-02-03').keys, ['2026-12', '2027-01', '2027-02']);
  assert.deepEqual(reportMonthRange('2024-02-29', '2024-02-29').keys, ['2024-02']);
  assert.throws(() => reportMonthRange('2023-02-29', '2023-02-29'), /коректний/);
  assert.throws(() => reportMonthRange('2026-01-21', '2026-01-19'), /коректний/);
  assert.throws(() => reportMonthRange('2025-01-31', '2026-01-01'), /12 календарних/);
});

test('keeps actual entries in separate metrics and excludes reversals and out-of-range dates', () => {
  const range = reportMonthRange('2026-01-31', '2026-03-01');
  const row = (kind, amount_cents, occurred_on, reversed = false) => ({ kind, amount_cents, occurred_on, reversed });
  const result = groupRecordedFinance(range, [
    row('customer_charge', '90071992547409930', '2026-01-31'),
    row('customer_charge', 7, '2026-01-31'),
    row('customer_charge', 5, '2026-01-30'),
    row('customer_payment', 400, '2026-03-01'),
    row('customer_advance', 500, '2026-03-01'),
    row('customer_refund', 300, '2026-03-01'),
    row('transport_expense', 100, '2026-03-01'),
    row('reversal', 50, '2026-02-10'),
    row('customer_payment', 50, '2026-02-15', true),
    row('customer_payment', 200, '2026-03-02')
  ]);
  assert.equal(result.included, 6);
  assert.equal(result.months[0].customer_charge, 90071992547409937n);
  assert.equal(result.months[1].customer_payment, 0n);
  assert.deepEqual(result.months[2], {
    key: '2026-03', customer_charge: 0n, customer_payment: 400n, customer_advance: 500n,
    customer_refund: 300n, transport_expense: 100n
  });
});
