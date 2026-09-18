import type { SbcComplexRole } from "./types";

export interface BimCoefficientRow {
  id: number;
  name: string;
  pd: number;
  rd: number;
}

export interface BimOptionResolution {
  options: BimCoefficientRow[];
  recommendedId?: number;
  exact: boolean;
  note: string;
}

export interface NormCondition {
  id: string;
  label: string;
  coefficient: number;
  source: string;
}

export const fgisPir848BimCoefficients: BimCoefficientRow[] = [
  { id: 1, name: "Кирпичный многоквартирный дом", pd: 1.12, rd: 1.14 },
  { id: 2, name: "Крупнопанельный, монолитный или сборно-монолитный многоквартирный дом", pd: 1.15, rd: 1.18 },
  { id: 3, name: "Малоэтажный многоквартирный или индивидуальный жилой дом", pd: 1.16, rd: 1.18 },
  { id: 4, name: "Общежитие", pd: 1.12, rd: 1.13 },
  { id: 5, name: "Детский дом", pd: 1.14, rd: 1.16 },
  { id: 6, name: "Дом социального обслуживания, временного поселения или психоневрологический интернат", pd: 1.16, rd: 1.18 },
  { id: 7, name: "Гостиница, комплекс апартаментов или апарт-отель", pd: 1.12, rd: 1.13 },
  { id: 8, name: "Больница общего, клинического, детского или гинекологического профиля", pd: 1.15, rd: 1.17 },
  { id: 9, name: "Специализированный или многопрофильный медицинский центр", pd: 1.15, rd: 1.17 },
  { id: 10, name: "Психоневрологический, онкологический, туберкулёзный, кожный или наркологический диспансер", pd: 1.16, rd: 1.18 },
  { id: 11, name: "Психоневрологическая, психиатрическая или кардиологическая больница", pd: 1.16, rd: 1.18 },
  { id: 12, name: "Амбулатория, ФАП, скорая помощь, станция крови и аналогичные объекты", pd: 1.17, rd: 1.19 },
  { id: 13, name: "Экстренная, онкологическая, паллиативная, хирургическая, реабилитационная или лабораторная медицина", pd: 1.17, rd: 1.19 },
  { id: 14, name: "Перинатальный центр, родильный дом или дом ребёнка", pd: 1.17, rd: 1.19 },
  { id: 15, name: "Инфекционная, наркологическая, туберкулёзная или высокотехнологичная медицина", pd: 1.18, rd: 1.2 },
  { id: 16, name: "Центр гигиены, эпидемиологии или дезинфекции", pd: 1.17, rd: 1.19 },
  { id: 17, name: "Бюро специальной экспертизы", pd: 1.16, rd: 1.17 },
  { id: 18, name: "Иной объект медицинского назначения", pd: 1.15, rd: 1.17 },
  { id: 19, name: "Санаторий, профилакторий или детский лагерь", pd: 1.14, rd: 1.16 },
  { id: 20, name: "Дом отдыха или туристическая база", pd: 1.14, rd: 1.16 },
  { id: 21, name: "Объект ветеринарии", pd: 1.14, rd: 1.16 },
  { id: 22, name: "Спортивное поле, арена или площадка", pd: 1.05, rd: 1.06 },
  { id: 23, name: "Каток, бобслей, конькобежный, биатлонный или лыжный объект", pd: 1.11, rd: 1.12 },
  { id: 24, name: "Велотрек, конный или стрелковый объект", pd: 1.11, rd: 1.12 },
  { id: 25, name: "Скалодром или объект экстремального спорта", pd: 1.11, rd: 1.13 },
  { id: 26, name: "Крытый бассейн", pd: 1.11, rd: 1.12 },
  { id: 27, name: "Спортивный зал, манеж, футбольный, теннисный объект или единоборства", pd: 1.12, rd: 1.13 },
  { id: 28, name: "Гребной, парусный, игровой клуб, производственный или складской объект спорта", pd: 1.12, rd: 1.13 },
  { id: 29, name: "ФОК, стадион, многофункциональный комплекс или центр спорта", pd: 1.14, rd: 1.16 },
  { id: 30, name: "Спортивная, театральная, художественная или музыкальная школа", pd: 1.13, rd: 1.14 },
  { id: 31, name: "Профессиональное училище, институт, учебный или лабораторный корпус", pd: 1.13, rd: 1.15 },
  { id: 32, name: "Детский сад", pd: 1.14, rd: 1.16 },
  { id: 33, name: "Средняя, специализированная школа или школа-интернат", pd: 1.15, rd: 1.17 },
  { id: 34, name: "Начальная школа", pd: 1.19, rd: 1.21 },
  { id: 35, name: "Концертный зал", pd: 1.13, rd: 1.14 },
  { id: 36, name: "Театр, дом музыки или цирк", pd: 1.14, rd: 1.15 },
  { id: 37, name: "Музей", pd: 1.14, rd: 1.16 },
  { id: 38, name: "Выставочный или музейно-выставочный объект", pd: 1.15, rd: 1.17 },
  { id: 39, name: "Библиотека или архив", pd: 1.16, rd: 1.18 },
  { id: 40, name: "Дом культуры, творчества, центр искусств или клуб", pd: 1.2, rd: 1.23 },
  { id: 41, name: "Церковь, мечеть, собор или иной храм", pd: 1.2, rd: 1.23 },
  { id: 42, name: "Дом причта, монастырский, административный, учебный или трапезный корпус", pd: 1.2, rd: 1.23 },
  { id: 43, name: "Научно-исследовательский институт, центр или лаборатория", pd: 1.14, rd: 1.16 },
  { id: 44, name: "Универсальный магазин", pd: 1.19, rd: 1.21 },
  { id: 45, name: "Столовая или ресторан", pd: 1.2, rd: 1.22 },
  { id: 46, name: "Кафе или бар", pd: 1.21, rd: 1.23 },
  { id: 47, name: "Офис, деловой центр, налоговый или таможенный орган", pd: 1.13, rd: 1.14 },
  { id: 48, name: "Орган власти, фонд или государственное/муниципальное учреждение", pd: 1.14, rd: 1.16 },
  { id: 49, name: "Банк", pd: 1.19, rd: 1.21 },
  { id: 50, name: "Суд, прокуратура, адвокатура, приставы или орган безопасности", pd: 1.14, rd: 1.16 },
  { id: 51, name: "Пожарная часть, депо или горноспасательная часть", pd: 1.15, rd: 1.16 },
  { id: 52, name: "Баня или общественная уборная", pd: 1.15, rd: 1.16 },
];

const bimIdsByPriceTable: Record<string, number[]> = {
  "3.1": [1, 2, 3],
  "3.2": [4, 5, 6],
  "3.3": [7],
  "3.4": [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18],
  "3.5": [19, 20],
  "3.6": [21],
  "3.7": [22, 23, 24, 25, 26, 27, 28, 29],
  "3.8": [30, 31, 32, 33, 34],
  "3.9": [35, 36, 37, 38, 39, 40],
  "3.10": [41, 42],
  "3.11": [43],
  "3.12": [44],
  "3.13": [45, 46],
  "3.14": [47, 48, 49],
  "3.15": [50],
  "3.16": [51],
  "3.17": [52],
};

const ignoredBimWords = new Set([
  "здание", "здания", "сооружение", "сооружения", "объект", "объекты", "капитального",
  "строительства", "для", "или", "иные", "иной", "числе", "крытого", "крытая", "крытый",
]);

function normalizedBimRoots(value: string): Set<string> {
  return new Set(
    value
      .toLocaleLowerCase("ru-RU")
      .replace(/ё/g, "е")
      .split(/[^а-я0-9]+/)
      .filter((word) => word.length >= 5 && !ignoredBimWords.has(word))
      .map((word) => word.slice(0, 7)),
  );
}

function bimSimilarity(objectName: string, row: BimCoefficientRow): number {
  const objectRoots = normalizedBimRoots(objectName);
  const rowRoots = normalizedBimRoots(row.name);
  if (!objectRoots.size || !rowRoots.size) return 0;
  let matches = 0;
  objectRoots.forEach((root) => { if (rowRoots.has(root)) matches += 1; });
  return matches / Math.min(objectRoots.size, rowRoots.size);
}

export function resolve848BimOptions(tableCode?: string, objectName?: string): BimOptionResolution {
  if (!tableCode || tableCode === "3.18") {
    return {
      options: fgisPir848BimCoefficients,
      exact: false,
      note: "Для таблицы 3.18 выберите сопоставимый объект по функциональным, объёмно-планировочным или конструктивным характеристикам и зафиксируйте обоснование.",
    };
  }

  const allowedIds = bimIdsByPriceTable[tableCode] ?? [];
  const options = fgisPir848BimCoefficients.filter((row) => allowedIds.includes(row.id));
  if (!options.length) {
    return {
      options: [],
      exact: false,
      note: "Для выбранной нормативной таблицы в приложении № 2 нет подходящей строки.",
    };
  }

  const ranked = options
    .map((row) => ({ row, score: bimSimilarity(objectName ?? "", row) }))
    .sort((left, right) => right.score - left.score || left.row.id - right.row.id);
  const best = ranked[0];
  const second = ranked[1];
  const exact = Boolean(best && best.score >= 0.5 && (!second || best.score - second.score >= 0.2));
  const recommendedId = exact ? best.row.id : options.length === 1 && best.score > 0 ? best.row.id : undefined;

  return {
    options,
    recommendedId,
    exact,
    note: recommendedId
      ? "Строка приложения № 2 сопоставлена с выбранным объектом автоматически."
      : options.length === 1
        ? "В этой категории есть одна строка приложения № 2, но для объекта требуется подтвердить сопоставимость."
        : "Выберите только из вариантов той же нормативной категории; при отсутствии точного наименования подтвердите сопоставимость объекта.",
  };
}

const conditionsByTable: Record<string, NormCondition[]> = {
  "3.3": [
    { id: "hotel-4", label: "Гостиница 4 звезды", coefficient: 1.2, source: "таблица 3.3.1, строка 1" },
    { id: "hotel-5", label: "Гостиница 5 звёзд", coefficient: 1.3, source: "таблица 3.3.1, строка 2" },
  ],
  "3.5": [
    { id: "summer", label: "Здание или комплекс только летнего функционирования", coefficient: 0.5, source: "таблица 3.5.1" },
  ],
  "3.7": [
    { id: "sport-embedded", label: "Спортзал или ванна бассейна встроены в жилое/общественное здание", coefficient: 0.5, source: "таблица 3.7.1, строка 1" },
    { id: "rink-open", label: "Открытый каток с искусственным льдом", coefficient: 0.7, source: "таблица 3.7.1, строка 2" },
    { id: "pool-open", label: "Открытый бассейн", coefficient: 0.8, source: "таблица 3.7.1, строка 3" },
    { id: "site-0-30-small", label: "Генплан спорткомплекса: застройка до 30%, участок 0,5–3 га", coefficient: 1.25, source: "таблица 3.7.1, строка 4.1.1" },
    { id: "site-0-30-medium", label: "Генплан спорткомплекса: застройка до 30%, участок 3–10 га", coefficient: 1.2, source: "таблица 3.7.1, строка 4.1.2" },
    { id: "site-0-30-large", label: "Генплан спорткомплекса: застройка до 30%, участок более 10 га", coefficient: 1.15, source: "таблица 3.7.1, строка 4.1.3" },
    { id: "site-30-small", label: "Генплан спорткомплекса: застройка свыше 30%, участок 0,5–3 га", coefficient: 1.2, source: "таблица 3.7.1, строка 4.2.1" },
    { id: "site-30-medium", label: "Генплан спорткомплекса: застройка свыше 30%, участок 3–10 га", coefficient: 1.15, source: "таблица 3.7.1, строка 4.2.2" },
    { id: "site-30-large", label: "Генплан спорткомплекса: застройка свыше 30%, участок более 10 га", coefficient: 1.1, source: "таблица 3.7.1, строка 4.2.3" },
  ],
  "3.11": [
    { id: "science-special", label: "Специальный высокосложный научный объект из строки 1 таблицы 3.11.1", coefficient: 1.8, source: "таблица 3.11.1, строка 1" },
    { id: "science-humanities", label: "Научно-исследовательское учреждение гуманитарного назначения", coefficient: 0.7, source: "таблица 3.11.1, строка 2" },
  ],
  "3.17": [
    { id: "bath-softener", label: "Водоумягчительная установка для городской бани", coefficient: 1.02, source: "таблица 3.17.1, строка 1" },
    { id: "bath-sauna", label: "Банно-саунный или банно-оздоровительный комплекс", coefficient: 1.3, source: "таблица 3.17.1, строка 2" },
  ],
};

export function get848NormConditions(tableCode?: string): NormCondition[] {
  return tableCode ? conditionsByTable[tableCode] ?? [] : [];
}

export function get848NormCondition(tableCode?: string, conditionId?: string): NormCondition | undefined {
  return get848NormConditions(tableCode).find((item) => item.id === conditionId);
}

export function get848BimCoefficient(id?: number): BimCoefficientRow | undefined {
  return fgisPir848BimCoefficients.find((item) => item.id === id);
}

export function complexRoleLimit(role: SbcComplexRole): { defaultValue: number; max: number; source: string } {
  if (role === "embedded") return { defaultValue: 0.5, max: 0.5, source: "п. 170б Методики № 707/пр" };
  if (role === "blocked") return { defaultValue: 0.8, max: 0.8, source: "п. 170в Методики № 707/пр" };
  if (role === "repeated") return { defaultValue: 0.8, max: 0.8, source: "п. 20 НЗ № 848/пр и п. 152 Методики № 707/пр" };
  return { defaultValue: 1, max: 1, source: "пп. 18–19 НЗ № 848/пр" };
}
