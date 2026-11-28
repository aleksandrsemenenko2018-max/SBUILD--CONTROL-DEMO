import assert from 'node:assert/strict';
import { test } from 'node:test';
import { workbookParts } from '../modules/spreadsheet.js';

test('writes numeric values, empty cells and literal XML-safe text for Excel', () => {
  const sheet = workbookParts([['<note>', 4.5, null, '=EXAMPLE()', 'plan\0text']])['xl/worksheets/sheet1.xml'];
  assert.match(sheet, /<c r="A1" t="inlineStr"><is><t xml:space="preserve">&lt;note&gt;<\/t>/);
  assert.match(sheet, /<c r="B1"><v>4\.5<\/v><\/c><c r="C1"\/>/);
  assert.match(sheet, /<c r="D1" t="inlineStr">.*=EXAMPLE\(\)/);
  assert.match(sheet, /plantext/);
  assert.doesNotMatch(sheet, /<f>|\0/);
});
