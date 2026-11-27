import { plasterConsumption } from './estimate-finance.js';

const area = { name: 'area', label: 'Площа, м²' };
const thickness = { name: 'thickness', label: 'Товщина шару, мм' };
const consumption = { name: 'rate', label: 'Витрата за даними виробника, кг/м² на 1 мм' };
const bagWeight = { name: 'packageSize', label: 'Маса мішка, кг' };
const routeLength = { name: 'length', label: 'Довжина траси, м' };

const coating = {
  fields: [area, thickness, consumption, bagWeight],
  unit: 'кг',
  packageUnit: 'міш.',
  measure: ({ area, thickness, rate, packageSize, reserve }) =>
    plasterConsumption(area, thickness, rate, packageSize, reserve).kg
};

export const materialCalculators = {
  plaster: { ...coating, label: 'Штукатурка' },
  putty: { ...coating, label: 'Шпаклівка' },
  profiles: {
    label: 'Профілі',
    fields: [
      area,
      { name: 'rate', label: 'Довжина профілю за схемою монтажу, м/м²' },
      { name: 'packageSize', label: 'Довжина одного профілю, м' }
    ],
    unit: 'м',
    packageUnit: 'шт.',
    measure: ({ area, rate, multiplier }) => area * rate * multiplier
  },
  fasteners: {
    label: 'Кріплення',
    fields: [
      area,
      { name: 'rate', label: 'Кількість кріплень за схемою монтажу, шт./м²' },
      { name: 'packageSize', label: 'Кількість у пакованні, шт.', whole: true }
    ],
    unit: 'шт.',
    packageUnit: 'пак.',
    whole: true,
    measure: ({ area, rate, multiplier }) => area * rate * multiplier
  },
  cable: {
    label: 'Кабель',
    fields: [routeLength, { name: 'runs', label: 'Кількість кабелів на трасі', whole: true }],
    unit: 'м',
    measure: ({ length, runs, multiplier }) => length * runs * multiplier
  }
};

function roundUp(quantity) {
  const nearest = Math.round(quantity);
  const tolerance = Number.EPSILON * Math.max(1, quantity) * 2;
  return nearest > 0 && Math.abs(quantity - nearest) <= tolerance ? nearest : Math.ceil(quantity);
}

export function calculateMaterial(kind, values) {
  if (!Object.hasOwn(materialCalculators, kind)) {
    throw new Error('Виберіть матеріал.');
  }

  const calculator = materialCalculators[kind];
  const inputs = {};
  for (const field of calculator.fields) {
    const value = values[field.name];
    const numeric = typeof value === 'string' && value.trim() ? Number(value) : value;
    if (!Number.isFinite(numeric) || numeric <= 0 || (field.whole && !Number.isSafeInteger(numeric))) {
      throw new Error('Перевірте значення поля «' + field.label + '».');
    }
    inputs[field.name] = numeric;
  }

  const reserveValue = values.reserve ?? 0;
  const reserve = typeof reserveValue === 'string' && reserveValue.trim() ? Number(reserveValue) : reserveValue;
  if (!Number.isFinite(reserve) || reserve < 0) {
    throw new Error('Вкажіть невід’ємний відсоток запасу.');
  }
  inputs.reserve = reserve;
  inputs.multiplier = 1 + reserve / 100;

  const measured = calculator.measure(inputs);
  const quantity = calculator.whole ? roundUp(measured) : measured;
  const packageCount = calculator.packageUnit ? roundUp(quantity / inputs.packageSize) : null;
  if (!Number.isFinite(quantity) || quantity <= 0 || (calculator.whole && !Number.isSafeInteger(quantity)) ||
      (packageCount !== null && (!Number.isSafeInteger(packageCount) || packageCount <= 0))) {
    throw new Error('Перевірте діапазон введених значень.');
  }

  return { quantity, unit: calculator.unit, packageCount, packageUnit: calculator.packageUnit ?? null };
}
