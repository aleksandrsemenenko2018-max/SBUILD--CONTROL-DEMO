const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const { inflateRawSync } = require('node:zlib');

async function sheetXml(download) {
  const zip = await readFile(await download.path());
  const entries = new Map();
  let offset = 0;
  while (zip.readUInt32LE(offset) === 0x04034b50) {
    const method = zip.readUInt16LE(offset + 8);
    const length = zip.readUInt32LE(offset + 18);
    const nameLength = zip.readUInt16LE(offset + 26);
    const extraLength = zip.readUInt16LE(offset + 28);
    const name = zip.toString('utf8', offset + 30, offset + 30 + nameLength);
    const start = offset + 30 + nameLength + extraLength;
    const bytes = zip.subarray(start, start + length);
    entries.set(name, (method === 8 ? inflateRawSync(bytes) : bytes).toString('utf8'));
    offset = start + length;
  }
  assert.match(entries.get('[Content_Types].xml'), /spreadsheetml.sheet.main\+xml/);
  assert.match(entries.get('xl/workbook.xml'), /<sheet name="S-BUILD"/);
  return entries.get('xl/worksheets/sheet1.xml');
}

module.exports = { sheetXml };
