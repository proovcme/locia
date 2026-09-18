import snapshotJson from "../data/fgisPirSnapshot.json";
import tablesJson from "../data/fgisPirTables.json";
import breakdownJson from "../data/fgisPirBreakdown.json";
import type { FgisPirKind, ProjectInput } from "./types";

export interface FgisPirDocument {
  guid: string;
  categoryGuid: string | null;
  category: string;
  name: string;
  approvingAct: string | null;
  priceLevel: string | null;
  index: number | null;
  filePath: string | null;
  kind: string;
  portalUrl: string;
  downloadUrl: string;
}

export interface FgisPirTree {
  hierarchy: Array<{
    guid: string;
    name: string;
    code: string;
    treePath: string;
    parentGuid: string | null;
  }>;
  documents: FgisPirDocument[];
}

export interface FgisPirPeriod {
  id: number;
  label: string;
  survey: FgisPirTree;
  design: FgisPirTree;
  indexes: FgisPirTree;
}

export interface FgisPirSnapshot {
  schemaVersion: number;
  fetchedAt: string;
  transport: string;
  source: {
    portalUrl: string;
    newsUrl: string;
    apiBase: string;
  };
  activePeriodId: number;
  periods: FgisPirPeriod[];
  methods: FgisPirTree;
  examples: FgisPirTree;
  archive: { methods: FgisPirTree; norms: FgisPirTree };
  counts: Record<string, number>;
  download: {
    documentCount: number;
    totalBytes: number;
    manifestSha256: string;
  };
  catalogSha256: string;
}

export interface FgisPirTableRow {
  id: string;
  number: string;
  objectName: string;
  rangeLabel: string;
  min: number | null;
  max: number | null;
  minInclusive: boolean;
  maxInclusive: boolean;
  unit: string;
  aThousandRub: number;
  bThousandRubPerUnit: number;
  page: number;
}

export interface FgisPirTable {
  code: string;
  title: string;
  page: number;
  rows: FgisPirTableRow[];
}

export interface FgisPirTableDocument {
  guid: string;
  sourcePdfSha256: string;
  tableCount: number;
  rowCount: number;
  tables: FgisPirTable[];
  percentTables: FgisPirPercentTable[];
}

export interface FgisPirPercentPoint {
  id: string;
  constructionCostMillionRub: number;
  designPercent: number;
  sourceLabel: string;
  page: number;
}

export interface FgisPirPercentTable {
  code: string;
  title: string;
  page: number;
  points: FgisPirPercentPoint[];
}

export interface FgisPirTableCatalog {
  schemaVersion: number;
  snapshotPeriod: string;
  extraction: string;
  documents: FgisPirTableDocument[];
}

export interface FgisPirBreakdownObject {
  id: string;
  name: string;
  page: number;
  stages: {
    pd: Record<string, number>;
    rd: Record<string, number>;
    combined: Record<string, number>;
  };
  totals: { pd: number; rd: number; combined: number };
}

export interface FgisPirBreakdownTable {
  code: string;
  priceTableCode: string;
  title: string;
  page: number;
  objects: FgisPirBreakdownObject[];
}

export interface FgisPirBreakdownDocument {
  guid: string;
  sourcePdfSha256: string;
  stageShares: { pd: number; rd: number; combined: number };
  stageSourcePage: number;
  tableCount: number;
  objectCount: number;
  tables: FgisPirBreakdownTable[];
}

export interface FgisPirBreakdownCatalog {
  schemaVersion: number;
  snapshotPeriod: string;
  extraction: string;
  sections: Array<{ code: string; name: string }>;
  documents: FgisPirBreakdownDocument[];
}

export interface FgisPirInterpolatedPercent {
  percent: number;
  lower: FgisPirPercentPoint;
  upper: FgisPirPercentPoint;
  clamped: "min" | "max" | null;
}

export interface FgisIndicatorExplanation {
  label: string;
  description: string;
  sourceHint: string;
}

export type FgisNaturalRuleCode = "8.1" | "8.2" | "8.3" | "8.4-8.5" | "8.6" | "8.7" | "8.8" | "unsupported";

export interface FgisNaturalPriceResolution {
  valid: boolean;
  ruleCode: FgisNaturalRuleCode;
  priceRub: number;
  formula: string;
  explanation: string;
  sourceParagraph: string;
  sourcePage: number;
  sourceRow?: FgisPirTableRow;
  extrapolationCoefficient?: number;
  blocker?: string;
}

export const fgisPirSnapshot = snapshotJson as FgisPirSnapshot;
export const fgisPirTableCatalog = tablesJson as FgisPirTableCatalog;
export const fgisPirBreakdownCatalog = breakdownJson as FgisPirBreakdownCatalog;

export function getFgisPeriod(periodId: number): FgisPirPeriod {
  return (
    fgisPirSnapshot.periods.find((period) => period.id === periodId) ??
    fgisPirSnapshot.periods.find((period) => period.id === fgisPirSnapshot.activePeriodId) ??
    fgisPirSnapshot.periods[0]
  );
}

export function getFgisDocuments(period: FgisPirPeriod, kind: FgisPirKind): FgisPirDocument[] {
  return period[kind].documents;
}

export function getFgisCategories(documents: FgisPirDocument[]): string[] {
  return Array.from(new Set(documents.map((document) => document.category))).sort((left, right) =>
    left.localeCompare(right, "ru", { numeric: true, sensitivity: "base" }),
  );
}

export function getFgisTableDocument(guid: string): FgisPirTableDocument | undefined {
  return fgisPirTableCatalog.documents.find((document) => document.guid === guid);
}

export function getFgisBreakdownDocument(guid: string): FgisPirBreakdownDocument | undefined {
  return fgisPirBreakdownCatalog.documents.find((document) => document.guid === guid);
}

export function getFgisBreakdownTable(
  document: FgisPirBreakdownDocument | undefined,
  priceTableCode: string | undefined,
): FgisPirBreakdownTable | undefined {
  if (!document || !priceTableCode || priceTableCode === "3.18") return undefined;
  return document.tables.find((table) => table.priceTableCode === priceTableCode);
}

const normalizedWords = (value: string) =>
  new Set(
    value
      .toLocaleLowerCase("ru-RU")
      .replace(/ё/g, "е")
      .replace(/[^а-яa-z0-9]+/gi, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2 && !["здание", "сооружение", "объект"].includes(word)),
  );

export function recommendFgisBreakdownObject(
  table: FgisPirBreakdownTable | undefined,
  objectName: string,
): FgisPirBreakdownObject | undefined {
  if (!table?.objects.length) return undefined;
  const sourceWords = normalizedWords(objectName);
  let best = table.objects[0];
  let bestScore = -1;
  for (const candidate of table.objects) {
    const candidateWords = normalizedWords(candidate.name);
    const common = [...sourceWords].filter((word) => candidateWords.has(word)).length;
    const score = common / Math.max(1, Math.min(sourceWords.size, candidateWords.size));
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

export function interpolateFgisPercent(
  table: FgisPirPercentTable,
  constructionCostRub: number,
): FgisPirInterpolatedPercent {
  const points = [...table.points].sort(
    (left, right) => left.constructionCostMillionRub - right.constructionCostMillionRub,
  );
  const costMillionRub = Math.max(0, constructionCostRub) / 1_000_000;
  const first = points[0];
  const last = points[points.length - 1];
  if (costMillionRub <= first.constructionCostMillionRub) {
    return { percent: first.designPercent, lower: first, upper: first, clamped: "min" };
  }
  if (costMillionRub >= last.constructionCostMillionRub) {
    return { percent: last.designPercent, lower: last, upper: last, clamped: "max" };
  }
  const upperIndex = points.findIndex((point) => point.constructionCostMillionRub >= costMillionRub);
  const upper = points[upperIndex];
  const lower = points[upperIndex - 1];
  const position =
    (costMillionRub - lower.constructionCostMillionRub) /
    (upper.constructionCostMillionRub - lower.constructionCostMillionRub);
  return {
    percent: lower.designPercent + (upper.designPercent - lower.designPercent) * position,
    lower,
    upper,
    clamped: null,
  };
}

export function getFgisTableObjects(table: FgisPirTable): string[] {
  return Array.from(
    new Set(
      table.rows
        .filter((row) => row.min !== null || row.max !== null)
        .map((row) => row.objectName),
    ),
  );
}

export function findFgisTableRow(
  table: FgisPirTable,
  objectName: string,
  indicator: number,
): FgisPirTableRow | undefined {
  return table.rows.find((row) => {
    if (row.objectName !== objectName) return false;
    const aboveMinimum =
      row.min === null || (row.minInclusive ? indicator >= row.min : indicator > row.min);
    const belowMaximum =
      row.max === null || (row.maxInclusive ? indicator <= row.max : indicator < row.max);
    return aboveMinimum && belowMaximum;
  });
}

const rowAnchor = (row: FgisPirTableRow) => row.min ?? row.max;
const rowPriceRub = (row: FgisPirTableRow, indicator: number) =>
  (row.aThousandRub + row.bThousandRubPerUnit * indicator) * 1000;

/**
 * Правила пп. 131-134 Методики № 707/пр. Возвращает не только цену, но и
 * проверяемый нормативный след. Неприменимые случаи не подменяются нулевыми a/b.
 */
export function resolveFgisNaturalPrice(
  table: FgisPirTable,
  objectName: string,
  indicator: number,
): FgisNaturalPriceResolution {
  const rows = table.rows
    .filter((row) => row.objectName === objectName && rowAnchor(row) !== null)
    .sort((left, right) => (rowAnchor(left) ?? 0) - (rowAnchor(right) ?? 0));
  if (!Number.isFinite(indicator) || indicator <= 0 || !rows.length) {
    return {
      valid: false,
      ruleCode: "unsupported",
      priceRub: 0,
      formula: "Расчёт не выполнен",
      explanation: "Для расчёта нужен положительный натуральный показатель и опубликованные строки выбранного объекта.",
      sourceParagraph: "пп. 131-134 Методики № 707/пр",
      sourcePage: 55,
      blocker: "Не задан допустимый натуральный показатель или отсутствуют строки объекта.",
    };
  }

  const directRow = findFgisTableRow(table, objectName, indicator);
  if (directRow) {
    return {
      valid: true,
      ruleCode: "8.1",
      priceRub: rowPriceRub(directRow, indicator),
      formula: `(${directRow.aThousandRub} + ${directRow.bThousandRubPerUnit} × ${indicator}) × 1000`,
      explanation: "Показатель находится внутри опубликованного диапазона; применена формула a + b × X.",
      sourceParagraph: "п. 130, формула 8.1 Методики № 707/пр",
      sourcePage: 54,
      sourceRow: directRow,
    };
  }

  const aOnly = rows.every((row) => row.bThousandRubPerUnit === 0) && rows.length >= 2;
  if (aOnly) {
    const points = rows
      .map((row) => ({ row, x: rowAnchor(row)! }))
      .filter((point, index, all) => index === 0 || point.x !== all[index - 1].x);
    const first = points[0];
    const last = points[points.length - 1];
    let lower = first;
    let upper = points[1];
    let ruleCode: FgisNaturalRuleCode = "8.7";
    let factor = 0.6;
    if (indicator > last.x) {
      lower = points[points.length - 2];
      upper = last;
      ruleCode = "8.8";
    } else if (indicator >= first.x) {
      const upperIndex = points.findIndex((point) => point.x >= indicator);
      upper = points[upperIndex];
      lower = points[Math.max(0, upperIndex - 1)];
      ruleCode = "8.6";
      factor = 1;
    }
    const slope = (upper.row.aThousandRub - lower.row.aThousandRub) / (upper.x - lower.x);
    const priceThousand = ruleCode === "8.7"
      ? first.row.aThousandRub - slope * (first.x - indicator) * factor
      : lower.row.aThousandRub + slope * (indicator - lower.x) * factor;
    return {
      valid: Number.isFinite(priceThousand) && priceThousand >= 0,
      ruleCode,
      priceRub: Math.max(0, priceThousand * 1000),
      formula: `${priceThousand.toFixed(3)} × 1000`,
      explanation: ruleCode === "8.6"
        ? "Цена определена линейной интерполяцией между соседними табличными значениями a."
        : "Цена определена экстраполяцией с нормативным коэффициентом 0,6.",
      sourceParagraph: `п. 133, формула ${ruleCode} Методики № 707/пр`,
      sourcePage: ruleCode === "8.6" ? 56 : 57,
      sourceRow: ruleCode === "8.7" ? first.row : upper.row,
    };
  }

  const minimumRow = rows.reduce((best, row) => (row.min ?? Infinity) < (best.min ?? Infinity) ? row : best);
  const maximumRow = rows.reduce((best, row) => (row.max ?? -Infinity) > (best.max ?? -Infinity) ? row : best);
  const minimum = minimumRow.min;
  const maximum = maximumRow.max;
  const unitIsObject = rows.some((row) => row.unit.toLocaleLowerCase("ru-RU").includes("объект"));
  if (unitIsObject) {
    return {
      valid: false,
      ruleCode: "unsupported",
      priceRub: 0,
      formula: "Экстраполяция не применяется",
      explanation: "Для единицы измерения «объект» формулы 8.2-8.8 не применяются.",
      sourceParagraph: "п. 134 Методики № 707/пр",
      sourcePage: 57,
      blocker: "Показатель вне опубликованного диапазона для единицы «объект».",
    };
  }
  if (minimum !== null && indicator < minimum) {
    const halfMinimum = minimum * 0.5;
    if (indicator >= halfMinimum) {
      const effective = 0.4 * minimum + 0.6 * indicator;
      return {
        valid: true,
        ruleCode: "8.2",
        priceRub: rowPriceRub(minimumRow, effective),
        formula: `(${minimumRow.aThousandRub} + ${minimumRow.bThousandRubPerUnit} × (0,4 × ${minimum} + 0,6 × ${indicator})) × 1000`,
        explanation: "Показатель ниже минимального, но не меньше его половины; применена нормативная формула 8.2.",
        sourceParagraph: "п. 131, формула 8.2 Методики № 707/пр",
        sourcePage: 55,
        sourceRow: minimumRow,
      };
    }
    const ratio = indicator / halfMinimum;
    if (ratio <= 0.1) {
      return {
        valid: false,
        ruleCode: "unsupported",
        priceRub: 0,
        formula: `Kэкс = ${indicator} / ${halfMinimum} = ${ratio.toFixed(3)}`,
        explanation: "Коэффициент экстраполяции не превышает допустимое значение 0,1.",
        sourceParagraph: "п. 131, формулы 8.4-8.5 Методики № 707/пр",
        sourcePage: 56,
        sourceRow: minimumRow,
        extrapolationCoefficient: ratio,
        blocker: "Натуральный показатель слишком мал для нормативной экстраполяции.",
      };
    }
    const effectiveHalf = 0.4 * minimum + 0.6 * halfMinimum;
    return {
      valid: true,
      ruleCode: "8.4-8.5",
      priceRub: rowPriceRub(minimumRow, effectiveHalf) * ratio,
      formula: `(${minimumRow.aThousandRub} + ${minimumRow.bThousandRubPerUnit} × (0,4 × ${minimum} + 0,6 × ${halfMinimum})) × ${ratio.toFixed(4)} × 1000`,
      explanation: "Показатель меньше половины минимального; применены формулы 8.4 и 8.5.",
      sourceParagraph: "п. 131, формулы 8.4-8.5 Методики № 707/пр",
      sourcePage: 56,
      sourceRow: minimumRow,
      extrapolationCoefficient: ratio,
    };
  }
  if (maximum !== null && indicator > maximum) {
    const effective = 0.4 * maximum + 0.6 * indicator;
    return {
      valid: true,
      ruleCode: "8.3",
      priceRub: rowPriceRub(maximumRow, effective),
      formula: `(${maximumRow.aThousandRub} + ${maximumRow.bThousandRubPerUnit} × (0,4 × ${maximum} + 0,6 × ${indicator})) × 1000`,
      explanation: "Показатель выше максимального; применена нормативная формула 8.3.",
      sourceParagraph: "п. 131, формула 8.3 Методики № 707/пр",
      sourcePage: 55,
      sourceRow: maximumRow,
    };
  }
  return {
    valid: false,
    ruleCode: "unsupported",
    priceRub: 0,
    formula: "Расчёт не выполнен",
    explanation: "Значение попало в разрыв опубликованных диапазонов.",
    sourceParagraph: "пп. 131-134 Методики № 707/пр",
    sourcePage: 55,
    blocker: "Для показателя нет применимой строки или нормативного правила.",
  };
}

export function resolveFgisNaturalPriceForProject(project: ProjectInput): FgisNaturalPriceResolution | undefined {
  const document = getFgisTableDocument(project.sbcFgisNormGuid);
  const table = document?.tables.find((item) => item.code === project.sbcFgisTableCode);
  if (!table || !project.sbcFgisObjectName) return undefined;
  return resolveFgisNaturalPrice(table, project.sbcFgisObjectName, project.sbcNaturalIndicator);
}

export function smrShareCoefficient(sharePercent: number): number {
  if (sharePercent >= 60) return 1;
  if (sharePercent >= 50) return 0.95;
  if (sharePercent >= 40) return 0.9;
  if (sharePercent >= 30) return 0.8;
  return 0.7;
}

export function explainFgisIndicator(
  unit: string,
  objectName = "",
): FgisIndicatorExplanation {
  const normalized = unit.toLocaleLowerCase("ru-RU");
  const normalizedObject = objectName.toLocaleLowerCase("ru-RU");
  const sourceHint = "Берите значение из задания на проектирование или утверждённых ТЭП и сверяйте определение показателя с выбранной таблицей норматива.";

  if (normalized.includes("куб")) {
    return {
      label: "Строительный объём объекта",
      description: "Введите строительный объём здания в кубических метрах.",
      sourceHint,
    };
  }
  if (normalized.includes("посад")) {
    return {
      label: "Количество посадочных мест",
      description: "Введите проектную вместимость объекта общественного питания в посадочных местах.",
      sourceHint,
    };
  }
  if (normalized.includes("зрител")) {
    return {
      label: "Вместимость трибун",
      description: "Введите количество зрителей, на которое рассчитаны трибуны.",
      sourceHint,
    };
  }
  if (normalized.includes("шт") && normalizedObject.includes("огнев")) {
    return {
      label: "Количество огневых позиций",
      description: "Введите число оборудованных огневых позиций стрелкового объекта.",
      sourceHint,
    };
  }
  if (normalized === "га") {
    return {
      label: "Площадь территории",
      description: "Введите площадь территории открытого объекта в гектарах.",
      sourceHint,
    };
  }
  if (normalized === "м" && normalizedObject.includes("горнолыж")) {
    return {
      label: "Протяжённость трассы",
      description: "Введите проектную длину горнолыжной трассы в метрах.",
      sourceHint,
    };
  }
  if (normalized === "м" && normalizedObject.includes("канатн")) {
    return {
      label: "Протяжённость канатной дороги",
      description: "Введите проектную длину линии канатной дороги в метрах.",
      sourceHint,
    };
  }
  if (normalized.includes("кв")) {
    return {
      label: "Общая площадь объекта",
      description: "Введите площадь проектируемого объекта в квадратных метрах, принятую для выбранного типа объекта.",
      sourceHint,
    };
  }
  if (normalized.includes("чел")) {
    return {
      label: "Численность населения",
      description: "Введите расчётную численность населения в человеках.",
      sourceHint,
    };
  }
  if (normalized.includes("мест")) {
    return {
      label: "Вместимость объекта",
      description: "Введите проектную вместимость объекта в единицах, указанных в нормативной таблице.",
      sourceHint,
    };
  }
  if (normalized === "км" || normalized === "м") {
    return {
      label: "Протяжённость объекта",
      description: `Введите проектную протяжённость объекта в ${normalized === "км" ? "километрах" : "метрах"}.`,
      sourceHint,
    };
  }
  if (normalized.includes("шт") || normalized.includes("объект")) {
    return {
      label: "Количество объектов",
      description: "Введите количество однотипных проектируемых объектов.",
      sourceHint,
    };
  }
  return {
    label: "Натуральный показатель X",
    description: `Введите физический объём объекта в единицах «${unit || "ед."}».`,
    sourceHint,
  };
}

export function indicatorLabelForUnit(unit: string): string {
  return explainFgisIndicator(unit).label;
}

export function projectPatchForFgisRow(
  table: FgisPirTable,
  row: FgisPirTableRow,
  indicator: number,
): Partial<ProjectInput> {
  const breakdownDocument = getFgisBreakdownDocument(
    fgisPirBreakdownCatalog.documents.find((document) =>
      document.tables.some((candidate) => candidate.priceTableCode === table.code),
    )?.guid ?? "",
  );
  const breakdownTable = getFgisBreakdownTable(breakdownDocument, table.code);
  const breakdownObject = recommendFgisBreakdownObject(breakdownTable, row.objectName);
  return {
    sbcMethod: "natural",
    sbcNaturalIndicator: indicator,
    sbcConstantA: row.aThousandRub * 1000,
    sbcConstantB: row.bThousandRubPerUnit * 1000,
    sbcFgisTableCode: table.code,
    sbcFgisTableTitle: table.title,
    sbcFgisObjectName: row.objectName,
    sbcFgisIndicatorUnit: row.unit,
    sbcFgisIndicatorRange: row.rangeLabel,
    sbcFgisTablePage: row.page,
    sbcFgisBreakdownTableCode: breakdownTable?.code,
    sbcFgisBreakdownObjectId: breakdownObject?.id,
  };
}

export function projectPatchForFgisPercentTable(
  table: FgisPirPercentTable,
  constructionCostRub: number,
  rebaseCoefficient = 1,
): Partial<ProjectInput> {
  const baseConstructionCost = constructionCostRub * rebaseCoefficient;
  const interpolated = interpolateFgisPercent(table, baseConstructionCost);
  const interval = interpolated.lower === interpolated.upper
    ? `${interpolated.lower.constructionCostMillionRub} млн ₽`
    : `${interpolated.lower.constructionCostMillionRub}–${interpolated.upper.constructionCostMillionRub} млн ₽`;
  return {
    sbcMethod: "constructionPercent",
    sbcConstructionCost: constructionCostRub,
    sbcConstructionRebaseCoefficient: rebaseCoefficient,
    sbcDesignPercent: interpolated.percent / 100,
    sbcConstantA: 0,
    sbcConstantB: 0,
    sbcFgisTableCode: table.code,
    sbcFgisTableTitle: table.title,
    sbcFgisObjectName: "Объект, отсутствующий в таблицах 3.1–3.17",
    sbcFgisIndicatorUnit: "млн ₽",
    sbcFgisIndicatorRange: interval,
    sbcFgisTablePage: interpolated.lower.page,
  };
}

export function projectPatchForFgisDocument(
  project: ProjectInput,
  period: FgisPirPeriod,
  kind: FgisPirKind,
  document: FgisPirDocument,
): Partial<ProjectInput> {
  const breakdownDocument = getFgisBreakdownDocument(document.guid);
  return {
    sbcFgisKind: kind,
    sbcFgisNormGuid: document.guid,
    sbcFgisPeriodId: period.id,
    sbcFgisPeriodLabel: period.label,
    sbcFgisApprovingAct: document.approvingAct ?? "",
    sbcFgisSourceUrl: document.downloadUrl,
    sbcFgisCatalogSha256: fgisPirSnapshot.catalogSha256,
    sbcCollectionName: document.name,
    sbcBaseYear: document.priceLevel ?? project.sbcBaseYear,
    sbcIndexToCurrent: document.index ?? project.sbcIndexToCurrent,
    ...(breakdownDocument
      ? {
          sbcPdShare: breakdownDocument.stageShares.pd / 100,
          sbcRdShare: breakdownDocument.stageShares.rd / 100,
        }
      : {}),
  };
}

export function fgisSelectionIsCurrent(project: ProjectInput): boolean {
  return (
    project.sbcFgisPeriodId === fgisPirSnapshot.activePeriodId &&
    project.sbcFgisCatalogSha256 === fgisPirSnapshot.catalogSha256
  );
}
