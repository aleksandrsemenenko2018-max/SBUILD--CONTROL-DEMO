import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildReviewedEstimate, estimateCandidates, estimateCsv, positionedLines } from '../modules/pdf-estimate.js';

test('groups PDF text into positional table rows', () => {
  const at = (str, x, y, width) => ({ str, transform: [1, 0, 0, 1, x, y], width });
  assert.deepEqual(positionedLines([
    at('Spec', 20, 100, 30), at('12', 180, 80, 20), at('m²', 205, 80, 20),
    at('Painting', 20, 81, 50), { type: 'markedContent' }
  ]), ['Spec', 'Painting | 12 m²']);
});

test('extracts explicit quantities and labelled rectangles with evidence', () => {
  const { candidates, references } = estimateCandidates([{ page: 4, lines: [
    'Фарбування | 12,5 | м²', 'Матеріал: фарба 5 л', 'Площа стіни | 200 см × 3 м',
    'Переріз 450 мм × 200 мм', 'Специфікація 07', 'Фарбування без розмірів'
  ] }]);
  assert.deepEqual(candidates.map(x => [x.page, x.label, x.quantity, x.unit, x.kind]), [
    [4, 'Фарбування', 12.5, 'м²', 'work'], [4, 'Матеріал: фарба', 5, 'л', 'material'],
    [4, 'Площа стіни', 6, 'м²', 'work']
  ]);
  assert.deepEqual(references.map(x => x.source), ['Переріз 450 мм × 200 мм', 'Специфікація 07']);
});

test('requires review, separates rates, never fills missing values, and escapes CSV formulas', () => {
  const work = { approved: true, page: 1, label: '=test', quantity: 2, unit: 'м²', workerRate: '5', customerRate: '', kind: 'work' };
  const material = { ...work, label: 'Матеріал', kind: 'material', customerRate: '20' };
  const rows = [work, material, { ...work, approved: false }];
  const staff = buildReviewedEstimate(rows, 'worker');
  const customer = buildReviewedEstimate(rows, 'customer');
  assert.deepEqual(staff.map(row => row.amount), [10]);
  assert.deepEqual(customer.map(row => row.amount), [null, 40]);
  assert.ok(!('workerRate' in customer[0]));
  assert.match(estimateCsv(customer), /"'=test";"м²";"2";"";"";"1"/);
  assert.throws(() => buildReviewedEstimate([{ ...work, quantity: 0 }], 'worker'));
});
