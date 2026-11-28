import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkMaterialPair, findMaterialByBarcode, materialReference, readMaterialPhoto } from '../modules/material-reference.js';

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

test('detects a catalog package without uploading the photo and rejects unclear results', async () => {
  const pixels = { close() { closed++; } };
  const file = { type: 'image/png', size: 100 };
  let closed = 0;
  class Detector {
    static async getSupportedFormats() { return ['ean_13']; }
    async detect() { return [{ rawValue: '4820113531378' }]; }
  }
  const found = await readMaterialPhoto(file, Detector, async () => pixels);
  assert.equal(found.product.id, 'rotband');
  assert.equal(found.packageSize, '30 кг');
  assert.equal(closed, 1);
  assert.equal(findMaterialByBarcode('1234567890123'), null);
  await assert.rejects(readMaterialPhoto(file, null), /вручну/);
  class MoreThanOne extends Detector {
    async detect() { return [{ rawValue: '4820113531378' }, { rawValue: '5901793357355' }]; }
  }
  await assert.rejects(readMaterialPhoto(file, MoreThanOne, async () => pixels), /кілька/);
  assert.equal(closed, 2);
});
