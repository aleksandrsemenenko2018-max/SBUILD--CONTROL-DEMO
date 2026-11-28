import { buildReviewedEstimate, estimateCandidates, estimateCsv, positionedLines } from './pdf-estimate.js';

const endpoint = 'https://esm.sh/pdfjs-dist@4.10.38/legacy/build/';
const pdfInput = document.getElementById('pdf');
const analyse = document.getElementById('analysePdf');
const output = document.getElementById('pdfEstimateRows');
const status = document.getElementById('pdfEstimateStatus');
const references = document.getElementById('pdfEstimateReferences');
const rows = [];
let selection = 0;

function field(type, value, label, update) {
  const input = document.createElement('input');
  input.type = type;
  input.setAttribute('aria-label', label);
  if (type === 'checkbox') input.checked = value;
  else input.value = value;
  if (type === 'number') {
    input.min = '0';
    input.step = 'any';
    input.inputMode = 'decimal';
  }
  input.addEventListener('input', () => update(type === 'checkbox' ? input.checked : input.value));
  return input;
}

function drawRows() {
  output.replaceChildren();
  for (const [index, row] of rows.entries()) {
    const item = document.createElement('tr');
    const addField = (key, label, type) => {
      const cell = item.insertCell();
      cell.append(field(type, row[key], label + ' · ' + (index + 1), value => { row[key] = value; }));
    };
    for (const [key, label, type] of [
      ['approved', 'Погодити позицію', 'checkbox'], ['label', 'Назва', 'text'],
      ['quantity', 'Обсяг', 'number'], ['unit', 'Одиниця', 'text'],
      ['workerRate', 'Розцінка виконавця', 'number'], ['customerRate', 'Розцінка замовника', 'number']
    ]) addField(key, label, type);
    item.insertCell().textContent = row.page ? 'С. ' + row.page + ' · ' + row.source : 'Введено вручну';
    output.append(item);
  }
}

pdfInput.addEventListener('change', () => {
  selection++;
  rows.length = 0;
  drawRows();
  references.replaceChildren();
  status.textContent = '';
});

analyse.addEventListener('click', async () => {
  const file = pdfInput.files[0];
  if (!file || file.size > 20 * 1024 * 1024) {
    status.textContent = 'Оберіть PDF до 20 МБ.';
    return;
  }
  const current = ++selection;
  analyse.disabled = true;
  status.textContent = 'Читаємо текст PDF…';
  let loading;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') throw new Error('Невірний формат PDF.');
    const pdfjs = await import(endpoint + 'pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = endpoint + 'pdf.worker.mjs';
    loading = pdfjs.getDocument({ data: bytes, isEvalSupported: false, disableFontFace: true, useSystemFonts: false });
    const document = await loading.promise;
    if (document.numPages > 60) throw new Error('Для аналізу оберіть PDF до 60 сторінок.');
    const pages = [];
    for (let page = 1; page <= document.numPages && current === selection; page++) {
      const content = await (await document.getPage(page)).getTextContent();
      pages.push({ page, lines: positionedLines(content.items) });
    }
    if (current !== selection) return;
    const result = estimateCandidates(pages);
    rows.splice(0, rows.length, ...result.candidates.map(row => ({ ...row, approved: false, workerRate: '', customerRate: '' })));
    drawRows();
    references.textContent = result.references.map(row => 'С. ' + row.page + ' · ' + row.source).join('\n');
    status.textContent = rows.length
      ? 'Знайдено позицій: ' + rows.length + '. Перевірте джерела та позначте погоджені рядки.'
      : pages.some(page => page.lines.length)
        ? 'Однозначних обсягів не знайдено. Додайте підтверджені позиції вручну.'
        : 'У PDF немає текстового шару. Введіть підтверджені обсяги вручну.';
  } catch (error) {
    if (current === selection) status.textContent = 'Не вдалося прочитати PDF. ' + error.message;
  } finally {
    try {
      await loading?.destroy();
    } finally {
      analyse.disabled = false;
    }
  }
});

document.getElementById('addPdfEstimateRow').addEventListener('click', () => {
  rows.push({ label: '', unit: '', quantity: '', page: null, approved: false, kind: 'work', workerRate: '', customerRate: '' });
  drawRows();
});

for (const [id, audience] of [['exportPdfWorkerEstimate', 'worker'], ['exportPdfCustomerEstimate', 'customer']]) {
  document.getElementById(id).addEventListener('click', () => {
    try {
      const estimate = buildReviewedEstimate(rows, audience);
      if (!estimate.length) throw new Error('Позначте погоджені позиції.');
      const url = URL.createObjectURL(new Blob([estimateCsv(estimate)], { type: 'text/csv;charset=utf-8' }));
      const download = document.createElement('a');
      download.href = url;
      download.download = 'sbuild-estimate-' + audience + '.csv';
      download.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      status.textContent = 'Експортовано погоджених позицій: ' + estimate.length;
    } catch (error) {
      status.textContent = error.message;
    }
  });
}
