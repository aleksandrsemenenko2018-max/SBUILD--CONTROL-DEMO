import assert from 'node:assert/strict';
import test from 'node:test';
import { buildClientReport, canAttachClientPhoto, clientPhotoCaption, clientReportCsv, reportWeek } from '../modules/client-report.js';

const period = reportWeek('2024-02-27');

test('uses seven calendar days across month boundaries and validates dates', () => {
  assert.deepEqual(period, { start: '2024-02-27', end: '2024-03-04' });
  assert.throws(() => reportWeek('2024-02-30'), /коректну дату/);
  assert.throws(() => reportWeek(''), /коректну дату/);
});

test('exports only approved work in the period with client rates and hierarchical zone names', () => {
  const approved = {
    id: 'approved', status: 'owner_approved', work_date: '2024-02-29',
    zone_id: 'segment', description: 'Підготовка стін', quantity: 3,
    unit: 'м²', client_rate: 0.335, worker_rate: 500, worker_id: 'private-worker',
    receipt_path: 'private-receipt'
  };
  const report = buildClientReport('Київ', period, [
    approved,
    { ...approved, id: 'unpriced', client_rate: null },
    { ...approved, id: 'draft', status: 'submitted' },
    { ...approved, id: 'outside', work_date: '2024-03-05' }
  ], [
    { id: 'segment', name: 'Сегмент A', parent_id: 'room' },
    { id: 'room', name: 'Кімната 2', parent_id: 'floor' },
    { id: 'floor', name: 'Поверх 1', parent_id: null }
  ]);
  assert.deepEqual(report.groups, [['Поверх 1 / Кімната 2 / Сегмент A', [
    { id: 'approved', date: '2024-02-29', description: 'Підготовка стін', quantity: '3', unit: 'м²', subtotal: 101 },
    { id: 'unpriced', date: '2024-02-29', description: 'Підготовка стін', quantity: '3', unit: 'м²', subtotal: null }
  ]]]);
  assert.equal(report.knownTotal, 101);
  assert.equal(report.unpricedCount, 1);
  assert.doesNotMatch(JSON.stringify(report), /private|500/);
});

test('handles finished work with no zone or a cyclic hierarchy', () => {
  const work = { id: 'approved', status: 'owner_approved', work_date: period.start, quantity: 3, client_rate: 0 };
  const report = buildClientReport('Об’єкт', period, [work, { ...work, id: 'cyclic', zone_id: 'a' }], [
    { id: 'a', name: 'Зона A', parent_id: 'b' },
    { id: 'b', name: 'Зона B', parent_id: 'a' }
  ]);
  assert.deepEqual(report.groups.map(([zone]) => zone), ['Без зони', 'Зона B / Зона A']);
  assert.equal(report.unpricedCount, 0);
});

test('only offers the relevant photo stages and fixed customer captions', () => {
  assert.equal(clientPhotoCaption('before'), 'До початку');
  assert.equal(clientPhotoCaption('after'), 'Після завершення');
  assert.equal(clientPhotoCaption('hidden_before_close'), 'Прихована робота перед закриттям');
  assert.equal(clientPhotoCaption('hidden_recheck'), 'Повторна перевірка перед закриттям');
  assert.equal(clientPhotoCaption('during'), undefined);
});

test('rejects foreign and traversing photo storage paths', () => {
  const data = { report_id: 'report', stage: 'before' };
  assert.ok(canAttachClientPhoto('project', { ...data, storage_path: 'project/report/image.png' }));
  for (const path of ['elsewhere/report/image.png', 'project/report/../image.png', 'project/report/%2E%2E/image.png', 'project/report/image.svg']) {
    assert.ok(!canAttachClientPhoto('project', { ...data, storage_path: path }));
  }
});

test('quotes CSV cells and neutralizes formula-like values from project data', () => {
  const report = buildClientReport('=1+1', period, [{
    id: 'work', status: 'owner_approved', work_date: period.start,
    description: '  +HYPERLINK("https://example.invalid")', quantity: '3', unit: 'м²', client_rate: 15.5
  }], []);
  const csv = clientReportCsv(report);
  assert.equal(csv.charCodeAt(0), 0xFEFF);
  assert.ok(csv.includes(`"'=1+1","2024-02-27","2024-03-04"`));
  assert.ok(csv.includes(`"'  +HYPERLINK(""https://example.invalid"")","3","м²","46.50"\r\n`));
});
