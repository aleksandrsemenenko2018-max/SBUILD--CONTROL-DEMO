import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ledgerTotals, parseLedgerAmount } from '../modules/project-finance-ledger.js';

test('parses exact hryvnia and kopiyka input without floating point rounding', () => {
  assert.equal(parseLedgerAmount('100,23'), 10023);
  assert.equal(parseLedgerAmount(' 0.01 '), 1);
  assert.equal(parseLedgerAmount('100.2'), 10020);
  assert.equal(parseLedgerAmount('1000000000000'), 100000000000000);
  for (const value of ['0', '-5', '5.211', '1e8', '5.', '1000000000000.01']) {
    assert.throws(() => parseLedgerAmount(value), /сума|суму/i, value);
  }
});

test('applies advances once, accounts for refunds and keeps transport separate from receivables', () => {
  assert.deepEqual(ledgerTotals({
    charged_cents: '10000', paid_cents: '500', advance_cents: '2000',
    refunded_cents: '100', transport_cents: '250'
  }), {
    charges: 10000n, payments: 500n, advances: 2000n, refunds: 100n,
    transport: 250n, balance: 7600n
  });
  assert.equal(ledgerTotals({ advance_cents: '3000' }).balance, -3000n);
  assert.equal(ledgerTotals({ charged_cents: '90071992547409930', paid_cents: '1' }).balance, 90071992547409929n);
});
