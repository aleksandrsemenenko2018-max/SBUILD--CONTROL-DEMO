import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createInventoryOperation } from '../modules/inventory-operation.js';

test('retries ambiguous inventory calls using one operation and one receipt', async () => {
  const sent = [];
  let uploads = 0;
  let ids = 0;
  const record = createInventoryOperation(async body => {
    sent.push(body);
    if (sent.length === 1) throw new Error('connection lost');
    return { data: 'movement' };
  }, () => 'attempt-' + ++ids);
  const input = { payload: { p_kind: 'receipt', p_quantity: 3 }, file: 'first attachment' };
  const upload = () => 'receipt-' + ++uploads;
  await assert.rejects(record(input, upload), /connection lost/);
  assert.deepEqual(await record(input, upload), { data: 'movement' });
  assert.deepEqual(sent[0], sent[1]);
  assert.equal(uploads, 1);
  await record(input, upload);
  assert.notEqual(sent[2].p_operation_id, sent[1].p_operation_id);
});

test('blocks overlapping submissions and uses a new key for changed input', async () => {
  let settle;
  let ids = 0;
  const sent = [];
  const record = createInventoryOperation(body => {
    sent.push(body);
    if (sent.length === 1) return new Promise(resolve => { settle = resolve; });
    return { data: 'movement' };
  }, () => ++ids);
  const first = record({ payload: { p_quantity: 1 } }, () => null);
  assert.deepEqual(await record({ payload: { p_quantity: 1 } }, () => null), { busy: true });
  settle({ error: { message: 'cannot confirm' } });
  await first;
  await record({ payload: { p_quantity: 2 } }, () => null);
  assert.deepEqual(sent.map(body => body.p_operation_id), [1, 2]);
});
