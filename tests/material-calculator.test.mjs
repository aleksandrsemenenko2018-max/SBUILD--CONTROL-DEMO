import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateMaterial } from '../modules/material-calculator.js';

test('calculates plaster and putty from the manufacturer rate, reserve and bag size', () => {
  const inputs = { area: '20', thickness: '2', rate: '1.25', packageSize: '10', reserve: '10' };
  for (const kind of ['plaster', 'putty']) {
    const result = calculateMaterial(kind, inputs);
    assert.ok(Math.abs(result.quantity - 55) < 1e-10);
    assert.equal(result.unit, 'кг');
    assert.equal(result.packageCount, 6);
  }
});

test('rounds profiles up to whole pieces', () => {
  const result = calculateMaterial('profiles', { area: 6, rate: 2.1, packageSize: 3 });
  assert.ok(Math.abs(result.quantity - 12.6) < 1e-10);
  assert.equal(result.packageCount, 5);
});

test('rounds fastener quantities and packages to whole units', () => {
  assert.deepEqual(calculateMaterial('fasteners', { area: 10.1, rate: 3, packageSize: 20 }), {
    quantity: 31, unit: 'шт.', packageCount: 2, packageUnit: 'пак.'
  });
});

test('calculates cable length over multiple runs with reserve', () => {
  const result = calculateMaterial('cable', { length: 12.5, runs: 4, reserve: 20 });
  assert.deepEqual(result, { quantity: 60, unit: 'м', packageCount: null, packageUnit: null });
});

test('avoids counting an extra package when a product differs by floating-point noise', () => {
  const result = calculateMaterial('plaster', { area: 10, thickness: 1, rate: 0.1, packageSize: 0.1, reserve: 10 });
  assert.equal(result.packageCount, 11);
});

test('rejects invalid rates, ranges, package sizes, and non-integer cable runs', () => {
  assert.throws(() => calculateMaterial('toString', {}), /Виберіть матеріал/);
  assert.throws(() => calculateMaterial('cable', { length: ' ', runs: 4 }), /Довжина траси/);
  assert.throws(() => calculateMaterial('cable', { length: 10, runs: 0.5 }), /Кількість кабелів/);
  assert.throws(() => calculateMaterial('cable', { length: 10, runs: 1, reserve: -1 }), /відсоток запасу/);
  assert.throws(() => calculateMaterial('cable', { length: Number.MAX_VALUE, runs: 2 }), /діапазон/);
  assert.throws(() => calculateMaterial('plaster', { area: 1, thickness: 1, rate: 0, packageSize: 1 }), /Витрата/);
  assert.throws(() => calculateMaterial('fasteners', { area: 1, rate: 1, packageSize: 0 }), /Кількість у пакованні/);
});
