import assert from 'node:assert/strict';
import test from 'node:test';
import { buildClientReport, canAttachClientPhoto, clientPhotoCaption, clientReportCsv, readClientReportSnapshot, reportWeek } from '../modules/client-report.js';

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

test('loads a stored report with exact totals and ignores private snapshot keys', async () => {
  const snapshot = {
    project: 'Об’єкт', period: { start: '2026-11-23', end: '2026-11-29' },
    groups: [['Зона', [{ date: '2026-11-24', description: 'Монтаж', quantity: '2', unit: 'м²', subtotal: 12300, worker_rate: 991 }]]],
    knownTotal: 12300, unpricedCount: 0
  };
  const report = readClientReportSnapshot(snapshot, '2026-11-23');
  assert.doesNotMatch(JSON.stringify(report), /worker_rate|991/);
  assert.equal(report.groups[0][1][0].subtotal, 12300);
  assert.throws(() => readClientReportSnapshot({ ...snapshot, knownTotal: 151 }, '2026-11-23'), /Підсумок/);
  assert.throws(() => readClientReportSnapshot(snapshot, '2026-11-30'), /Некоректний/);
});

test('exports separate customer-approved material and service lines and ignores private fields', () => {
  const charge = {
    date: period.start, kind: 'material', description: '+Штукатурка', subtotal: 1234,
    private_cost: 999999, approved_by: 'private-user'
  };
  const report = buildClientReport('Об’єкт', period, [], [], [charge]);
  assert.equal(report.chargeTotal, 1234);
  assert.equal(report.knownTotal, 0);
  const csv = clientReportCsv(report);
  assert.match(csv, /Матеріали · \+Штукатурка.*12\.34/);
  assert.doesNotMatch(csv, /999999|private-user/);
  assert.deepEqual(readClientReportSnapshot(report, period.start).charges, [
    { date: period.start, kind: 'material', description: '+Штукатурка', subtotal: 1234 }
  ]);
  assert.throws(() => buildClientReport('Об’єкт', period, [], [], [
    { ...charge, date: '2024-02-30' }
  ]), /додаткова позиція/);
});
