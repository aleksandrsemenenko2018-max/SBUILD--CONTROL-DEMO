export const materialReference = [
  {
    id: 'rotband', name: 'Knauf Rotband', type: 'Гіпсова штукатурка',
    source: 'https://knauf.com/uk-UA/p/produkt/shtukaturka-rotband-10001_0150',
    technicalSheet: 'https://knauf.com/api/download-center/v1/assets/1c201f80-1106-4ca3-908e-6e5ab0e7d3b0?country=ua&download=true',
    consumption: { quantity: 8.5, unit: 'кг/м²', thicknessMm: 10 },
    note: 'Витрата наведена для шару 10 мм. Для іншої основи чи товщини перевірте технічний лист.'
  },
  {
    id: 'rotband-finish', name: 'Knauf Rotband Finish', type: 'Фінішна шпаклівка',
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
  const selects = [...root.querySelectorAll('select')];
  const result = root.querySelector('[role="status"]');
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
