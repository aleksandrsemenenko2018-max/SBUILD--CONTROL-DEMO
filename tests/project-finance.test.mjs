import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeProjectFinance } from '../modules/estimate-finance.js';

const approved = { status: 'owner_approved', quantity: 4, client_rate: '250.00', worker_rate: '120.00' };

test('summarizes approved work, booked expenses and separately recorded payout states', () => {
  const result = summarizeProjectFinance(
    [approved, { ...approved, status: 'submitted' }],
    '110.15',
    [
      { amount: '150', status: 'planned' },
      { amount: '10.25', status: 'paid' },
      { amount: 200, status: 'cancelled' }
    ]
  );
  assert.deepEqual(result, {
    revenue: 1000, laborCost: 480, expenseCost: 110.15, totalCost: 590.15, margin: 409.85,
    marginRate: 409.85 / 1000, costReturn: 409.85 / 590.15,
    paid: 10.25, planned: 150
  });
});

test('does not assume zero cost or a complete margin when a source is incomplete', () => {
  const result = summarizeProjectFinance([{ ...approved, worker_rate: null }], null, null);
  assert.deepEqual(result, {
    revenue: 1000, laborCost: null, expenseCost: null, totalCost: null, margin: null, marginRate: null, costReturn: null, paid: null, planned: null
  });
  const empty = summarizeProjectFinance([], 0, []);
  assert.equal(empty.margin, 0);
  assert.equal(empty.marginRate, null);
  assert.equal(empty.costReturn, null);
  const loss = summarizeProjectFinance([{ ...approved, client_rate: 20 }], 0, []);
  assert.equal(loss.margin, -400);
  assert.equal(loss.marginRate, -5);
  assert.equal(loss.costReturn, -400 / 480);
});
