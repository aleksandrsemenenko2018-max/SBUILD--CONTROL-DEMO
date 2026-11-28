import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkMaterialPair, materialReference } from '../modules/material-reference.js';

test('accepts only a documented manufacturer system and keeps unknown pairs unresolved', () => {
  for (const pair of [['ct17', 'cl51'], ['cl51', 'ct17']]) {
    const known = checkMaterialPair(...pair);
    assert.equal(known.state, 'documented');
    assert.equal(known.source, materialReference.find(product => product.id === 'cl51').source);
  }
  assert.deepEqual(checkMaterialPair('rotband', 'cl51').state, 'unknown');
  assert.deepEqual(checkMaterialPair('', 'cl51').state, 'incomplete');
  assert.deepEqual(checkMaterialPair('ct17', 'ct17').state, 'incomplete');
});

test('catalog cites only official sites and leaves unverifiable rates blank', () => {
  const hosts = new Set(['knauf.com', 'www.ceresit.ua', 'datasheets.tdx.henkel.com']);
  for (const product of materialReference) {
    for (const url of [product.source, product.technicalSheet].filter(Boolean)) {
      const source = new URL(url);
      assert.equal(source.protocol, 'https:');
      assert.ok(hosts.has(source.hostname));
    }
  }
  assert.deepEqual(materialReference.find(product => product.id === 'rotband').consumption, {
    quantity: 8.5, unit: 'кг/м²', thicknessMm: 10
  });
  assert.equal(materialReference.find(product => product.id === 'rotband-finish').consumption, undefined);
});
