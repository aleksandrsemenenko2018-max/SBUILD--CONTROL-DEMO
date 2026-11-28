export const materialReference = [
  {
    id: 'rotband', name: 'Knauf Rotband', type: 'Гіпсова штукатурка',
    packageCodes: { '4820113531378': '30 кг' },
    source: 'https://knauf.com/uk-UA/p/produkt/shtukaturka-rotband-10001_0150',
    technicalSheet: 'https://knauf.com/api/download-center/v1/assets/1c201f80-1106-4ca3-908e-6e5ab0e7d3b0?country=ua&download=true',
    consumption: { quantity: 8.5, unit: 'кг/м²', thicknessMm: 10 },
    note: 'Витрата наведена для шару 10 мм. Для іншої основи чи товщини перевірте технічний лист.'
  },
  {
    id: 'rotband-finish', name: 'Knauf Rotband Finish', type: 'Фінішна шпаклівка',
    packageCodes: { '5901793357355': '8 кг' },
    source: 'https://knauf.com/uk-UA/p/produkt/shpaklivka-rotband-finish-20928_0150',
    note: 'Перед розрахунком звірте тип суміші та фасування з технічною документацією.'
  },
  {
    id: 'ct17', name: 'Ceresit CT 17', type: 'Ґрунтівка',
    source: 'https://www.ceresit.ua/catalog/vnutrisne-ozdoblennja/gruntivky/produkti.html/ceresit-ct-17/SAP_0201JAC014F1.html',
    technicalSheet: 'https://datasheets.tdx.henkel.com/CERESIT-CT-17-uk_UA.pdf',
    note: 'Призначена для підготовки мінеральних поверхонь. Перевірте стан та поглинання основи.'
  },
  {
    id: 'cl51', name: 'Ceresit CL 51 Express', type: 'Полімерна гідроізоляція',
    source: 'https://www.ceresit.ua/catalog/oblicjuvannja/polimerna-hidroizoljacija/produkti.html/ceresit-cl-51/SAP_0201SKC013R0.html',
    note: 'Під облицювання у вологих приміщеннях. Басейни виключені з опису виробника.'
  }
];

export function checkMaterialPair(first, second) {
  if (!first || !second || first === second) return { state: 'incomplete', text: 'Оберіть два різні матеріали.' };
  if ([first, second].includes('ct17') && [first, second].includes('cl51')) {
    return {
      state: 'documented',
      text: 'Ceresit вказує CT 17 для підготовки основи перед нанесенням CL 51. Звірте основу й умови застосування з технічним описом CL 51.',
      source: materialReference.find(item => item.id === 'cl51').source
    };
  }
  return { state: 'unknown', text: 'Для цієї пари підтвердження в довіднику немає. Перевірте технічні листи обох виробників.' };
}

export function findMaterialByBarcode(value) {
  if (typeof value !== 'string' || !/^\d{13}$/.test(value.trim())) return null;
  const code = value.trim();
  for (const product of materialReference) {
    if (Object.hasOwn(product.packageCodes ?? {}, code)) {
      return { product, packageSize: product.packageCodes[code] };
    }
  }
  return null;
}

export async function readMaterialPhoto(file, Detector = globalThis.BarcodeDetector, decode = globalThis.createImageBitmap) {
  if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 12 * 1024 * 1024) {
    throw new Error('Оберіть фото JPG, PNG або WebP до 12 МБ.');
  }
  if (!Detector || !decode || !(await Detector.getSupportedFormats()).includes('ean_13')) {
    throw new Error('Цей браузер не читає штрихкоди з фото. Введіть цифри зі штрихкоду вручну.');
  }
  const bitmap = await decode(file);
  try {
    const detector = new Detector({ formats: ['ean_13'] });
    const detected = await detector.detect(bitmap);
    const codes = [...new Set(detected.map(item => item.rawValue).filter(value => /^\d{13}$/.test(value)))];
    if (!codes.length) throw new Error('Штрихкод на фото не прочитано.');
    if (codes.length > 1) throw new Error('На фото кілька штрихкодів. Зніміть одну упаковку.');
    return findMaterialByBarcode(codes[0]);
  } finally {
    bitmap.close();
  }
}

export function renderMaterialReference(root) {
  const doc = root.ownerDocument;
  const add = (parent, tag, text) => {
    const node = doc.createElement(tag);
    node.textContent = text;
    parent.append(node);
    return node;
  };
  const link = (parent, text, href) => {
    const node = add(parent, 'a', text);
    node.href = href;
    node.target = '_blank';
    node.rel = 'noopener noreferrer';
  };
  const list = root.querySelector('[data-reference-products]');
  for (const product of materialReference) {
    const section = add(list, 'div', '');
    add(section, 'h3', product.name + ' · ' + product.type);
    add(section, 'p', product.note);
    if (product.consumption) {
      const { quantity, unit, thicknessMm } = product.consumption;
      add(section, 'p', 'Орієнтовна витрата: ' + quantity.toLocaleString('uk-UA') + ' ' + unit + ' при ' + thicknessMm + ' мм.');
    }
    link(section, 'Сторінка виробника', product.source);
    if (product.technicalSheet) {
      section.append(' · ');
      link(section, 'Технічний лист', product.technicalSheet);
    }
  }
  const scan = root.querySelector('[data-reference-scan]');
  const status = scan.querySelector('[role="status"]');
  const setMatch = match => {
    status.textContent = match ? match.product.name + ' · ' + match.packageSize : 'Штрихкод відсутній у довіднику.';
    if (match) {
      status.append(' · ');
      link(status, 'Сторінка виробника', match.product.source);
    }
  };
  const codeForm = scan.querySelector('form');
  const photo = scan.querySelector('input[type="file"]');
  let scanVersion = 0;
  codeForm.addEventListener('submit', event => {
    event.preventDefault();
    scanVersion++;
    setMatch(findMaterialByBarcode(codeForm.elements.code.value));
  });
  photo.addEventListener('change', async () => {
    if (!photo.files[0]) return;
    const current = ++scanVersion;
    status.textContent = 'Читаємо штрихкод…';
    try {
      const match = await readMaterialPhoto(photo.files[0]);
      if (scanVersion === current) setMatch(match);
    } catch (error) {
      if (scanVersion === current) status.textContent = error.message;
    }
  });
  const selects = [...root.querySelectorAll('select')];
  const result = root.querySelector('[data-reference-result]');
  for (const select of selects) {
    for (const product of materialReference) {
      add(select, 'option', product.name).value = product.id;
    }
    select.addEventListener('change', () => {
      const answer = checkMaterialPair(...selects.map(input => input.value));
      result.textContent = answer.text;
      if (answer.source) {
        result.append(' ');
        link(result, 'Застосування за даними виробника', answer.source);
      }
    });
  }
}
