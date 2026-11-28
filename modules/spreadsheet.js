const spreadsheet = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const packageRelations = 'http://schemas.openxmlformats.org/package/2006/relationships';
const officeRelations = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const contentTypes = 'http://schemas.openxmlformats.org/package/2006/content-types';
const prolog = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

function xml(value) {
  return String(value)
    .replace(/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, '')
    .replace(/[&<>"']/gu, symbol => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
    })[symbol]);
}

export function workbookParts(rows) {
  if (rows.length > 1048576 || rows.some(row => row.length > 16384)) {
    throw new Error('Рядки або стовпці перевищують ліміт Excel.');
  }
  const data = rows.map((row, index) => {
    const cells = row.map((value, col) => {
      let column = '';
      for (let n = col + 1; n > 0; n = Math.floor((n - 1) / 26)) {
        column = String.fromCharCode(65 + (n - 1) % 26) + column;
      }
      const position = ' r="' + column + (index + 1) + '"';
      if (typeof value === 'number' && Number.isFinite(value)) return '<c' + position + '><v>' + value + '</v></c>';
      if (value == null || value === '') return '<c' + position + '/>';
      return '<c' + position + ' t="inlineStr"><is><t xml:space="preserve">' + xml(value) + '</t></is></c>';
    }).join('');
    return '<row r="' + (index + 1) + '">' + cells + '</row>';
  }).join('');
  return {
    '[Content_Types].xml': prolog + '<Types xmlns="' + contentTypes + '">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels': prolog + '<Relationships xmlns="' + packageRelations + '">' +
      '<Relationship Id="rId1" Type="' + officeRelations + '/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': prolog + '<workbook xmlns="' + spreadsheet + '" xmlns:r="' + officeRelations + '">' +
      '<sheets><sheet name="S-BUILD" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': prolog + '<Relationships xmlns="' + packageRelations + '">' +
      '<Relationship Id="rId1" Type="' + officeRelations + '/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': prolog + '<worksheet xmlns="' + spreadsheet + '"><sheetData>' + data + '</sheetData></worksheet>'
  };
}

export async function spreadsheetBlob(rows) {
  const { zipSync } = await import('https://esm.sh/fflate@0.8.2');
  const encoder = new TextEncoder();
  const files = Object.fromEntries(Object.entries(workbookParts(rows)).map(([path, content]) => [path, encoder.encode(content)]));
  return new Blob([zipSync(files)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export function downloadSpreadsheet(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name + '.xlsx';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
