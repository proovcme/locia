import type {
  CalculatedLine,
  CashFlowRow,
  Catalog,
  EstimateLine,
  EstimateResult,
  EstimateTotals,
  FinanceSummary,
  ProjectInput,
  RateGroup,
  SbcResult,
} from "./types";
import {
  fgisPirBreakdownCatalog,
  getFgisBreakdownDocument,
  getFgisBreakdownTable,
  getFgisTableDocument,
  interpolateFgisPercent,
  recommendFgisBreakdownObject,
  resolveFgisNaturalPriceForProject,
  smrShareCoefficient,
} from "./fgisPir";
import {
  complexRoleLimit,
  get848BimCoefficient,
  get848NormCondition,
  resolve848BimOptions,
} from "./fgisPir848Rules";

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const positionCountLabel = (count: number) => {
  const modulo100 = count % 100;
  const modulo10 = count % 10;
  const noun = modulo100 >= 11 && modulo100 <= 14
    ? "позиций"
    : modulo10 === 1 ? "позиция" : modulo10 >= 2 && modulo10 <= 4 ? "позиции" : "позиций";
  return `${count} ${noun}`;
};

export const rateDisciplineDefinitions = [
  { code: "ЭОМ", title: "ЭОМ", description: "Вся электрика", codes: ["ЭОМ", "ЭО", "ЭМ", "ЭФ", "ЭН", "ЭС", "ЭГ", "ЗМ", "ЭЗС"] },
  { code: "АСУ", title: "АСУ", description: "Вся автоматика", codes: ["АСУЗ", "ДИСП", "BMS", "АК", "АОВ", "АИТП", "АХС", "АВК", "АСКУЭ", "АСКУВ", "АСКУТ", "АГСВ", "АПТ", "АДУ", "ЛФ"] },
  { code: "СПЗ", title: "СПЗ", description: "Пожарная безопасность", codes: ["СПЗ", "ПС", "СОУЭ", "ПБ"] },
  { code: "ГИП", title: "ГИП", description: "Управление проектом", codes: ["ГИП"] },
  { code: "ТИМ", title: "ТИМ", description: "BIM / информационное моделирование", codes: ["ТИМ", "BIM"] },
  { code: "СМ", title: "СМ", description: "Сметчики", codes: ["СМ"] },
  { code: "ОВ", title: "ОВ", description: "Климат, противодымная вентиляция и тепловые сети", codes: ["ОВ", "ОВ.ДУ", "ХС", "ИТП", "ТМ", "ТИ", "ТС"] },
  { code: "СКС", title: "СКС", description: "Слаботочные сети", codes: ["СКС", "СС", "ЛВС", "Wi-Fi", "ТФ", "ТВ", "РТ", "ЧФ", "НСС"] },
  { code: "КСБ", title: "КСБ", description: "Комплексные системы безопасности", codes: ["КСБ", "СОТ", "СВН", "СКУД", "ОС", "ПРК"] },
  { code: "ВК", title: "ВК", description: "Водоснабжение, водоотведение и очистные сооружения", codes: ["ВК", "НВ", "НК", "НКЛ", "ДР", "ЛОС", "ВП"] },
  { code: "ВПВ", title: "ВПВ", description: "Пожаротушение", codes: ["ВПВ", "ПТ", "АУПТ", "АГПТ", "АППТ", "АВПТ"] },
  { code: "АР", title: "АР", description: "Архитектура", codes: ["АР"] },
  { code: "КР", title: "КР", description: "Конструктив", codes: ["КР"] },
  { code: "ГП", title: "ГП", description: "Генеральный план", codes: ["ГП"] },
  { code: "ПОС", title: "ПОС", description: "Организация строительства", codes: ["ПОС"] },
  { code: "ООС", title: "ООС", description: "Охрана окружающей среды", codes: ["ООС"] },
  { code: "АК", title: "АК", description: "Архитектурная акустика и защита от шума", codes: ["АК"] },
  { code: "ОБС", title: "ОБС", description: "Обследование конструкций и инженерных систем", codes: ["ОБС"] },
  { code: "СКАН", title: "СКАН", description: "Лазерное сканирование и обмерные работы", codes: ["СКАН"] },
  { code: "ГЕО", title: "ГЕО", description: "Инженерно-геодезические работы", codes: ["ГЕО"] },
  { code: "ТХ", title: "ТХ", description: "Технология", codes: ["ТХ"] },
  { code: "СБЭ", title: "СБЭ", description: "Безопасная эксплуатация", codes: ["СБЭ"] },
];

const activeByPreset = (line: EstimateLine, project: ProjectInput) =>
  (line.presetPdOks && project.presetPdOks) ||
  (line.presetPdLinear && project.presetPdLinear) ||
  (line.presetRdFull && project.presetRdFull) ||
  (line.presetRdCore && project.presetRdCore) ||
  (line.presetRdFrequent && project.presetRdFrequent) ||
  (line.common && project.includeCommon);

const buildRateMap = (rates: RateGroup[]) =>
  new Map(rates.map((rate) => [rate.code, rate.monthlySalaryMedian]));

export const getRateGroupCode = (code: string | null | undefined) => {
  if (!code) return null;
  const definition = rateDisciplineDefinitions.find((item) => item.code === code || item.codes.includes(code));
  return definition?.code ?? code;
};

export const getRateByGroupOrCode = (code: string | null, rates: RateGroup[]) => {
  if (!code) return 0;
  const rateMap = buildRateMap(rates);
  const directRate = rateMap.get(code);
  if (directRate && directRate > 0) return directRate;
  const definition = rateDisciplineDefinitions.find((item) => item.code === code);
  if (definition) {
    const values = definition.codes
      .map((itemCode) => rateMap.get(itemCode) ?? 0)
      .filter((value) => value > 0);
    if (values.length) return values.reduce((sum, value) => sum + value, 0) / values.length;
  }
  return 0;
};

export const normalizeCalculationType = (type: string | null | undefined) => {
  const value = String(type ?? "").trim();
  if (value === "ФО1") return "ФОТ";
  if (value === "Ручная сумма") return "Ручной";
  return value;
};

export const normalizeStaffRole = (role: string | null | undefined) => {
  const value = String(role ?? "").trim().toLowerCase();
  if (value === "главспец" || value === "главный специалист") return "Главспец";
  if (value === "инженер") return "Инженер";
  return "Ведущий";
};

export const getStaffRoleMultiplier = (role: string | null | undefined, roleStepRate = 0.15) => {
  const normalized = normalizeStaffRole(role);
  if (normalized === "Главспец") return 1 + roleStepRate;
  if (normalized === "Инженер") return Math.max(0, 1 - roleStepRate);
  return 1;
};

export const getLineStaffing = (line: EstimateLine) => {
  const hasExplicitStaffing =
    line.chiefUnits !== undefined ||
    line.leadUnits !== undefined ||
    line.engineerUnits !== undefined;
  if (hasExplicitStaffing) {
    return {
      chief: line.chiefUnits ?? 0,
      lead: line.leadUnits ?? 0,
      engineer: line.engineerUnits ?? 0,
    };
  }

  const role = normalizeStaffRole(line.staffRole);
  return {
    chief: role === "Главспец" ? line.workUnits : 0,
    lead: role === "Ведущий" ? line.workUnits : 0,
    engineer: role === "Инженер" ? line.workUnits : 0,
  };
};

const isFotType = (type: string | null | undefined) => normalizeCalculationType(type) === "ФОТ";
const isHeadingType = (type: string | null | undefined) => normalizeCalculationType(type) === "Заголовок";
const isManualType = (type: string | null | undefined) => {
  const normalized = normalizeCalculationType(type);
  return normalized === "Ручной" || normalized === "Подряд";
};
const isPercentType = (type: string | null | undefined) => normalizeCalculationType(type) === "% от общего";

export function resolveCostGroup(line: EstimateLine) {
  if (line.costGroup) return line.costGroup;
  if (line.common || line.source === "Общие") return "Общие";
  if (line.source === "ПП87" || String(line.category ?? "").startsWith("ПД")) return "ПД";
  if (line.source === "РД" || line.category === "РД") return "РД";
  return line.category ?? line.source ?? "Прочее";
}

export function calculateMonthlyDepreciation(project: ProjectInput) {
  const usefulLifeYears = project.computerUsefulLifeYears ?? 3;
  const computerCost = project.computerCost ?? 150000;
  const salvageValue = project.computerSalvageValue ?? 0;
  if (usefulLifeYears <= 0) return 0;
  return Math.max(0, computerCost - salvageValue) / usefulLifeYears / 12;
}

const parseProjectMonth = (value: string | null | undefined) => {
  const match = String(value ?? "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
  return { year, month };
};

export function buildProjectMonths(startValue: string | null | undefined, endValue: string | null | undefined) {
  const start = parseProjectMonth(startValue);
  const end = parseProjectMonth(endValue);
  if (!start || !end) return [];
  const startIndex = start.year * 12 + start.month - 1;
  const endIndex = end.year * 12 + end.month - 1;
  if (endIndex < startIndex) return [];

  return Array.from({ length: endIndex - startIndex + 1 }, (_, index) => {
    const absoluteMonth = startIndex + index;
    const year = Math.floor(absoluteMonth / 12);
    const month = (absoluteMonth % 12) + 1;
    return `${year}-${String(month).padStart(2, "0")}`;
  });
}

export function calculateFinanceSummary(
  project: ProjectInput,
  totals: EstimateTotals,
  groupBreakdown: EstimateResult["groupBreakdown"],
): FinanceSummary {
  const months = buildProjectMonths(project.workStartMonth, project.workEndMonth);
  const workMonths = Math.max(1, months.length);
  const displayMonths = months.length ? months : [project.workStartMonth || "Месяц 1"];
  const advanceAmount = roundMoney(totals.totalWithVat * (project.advanceRate ?? 0));
  const remainingAmount = roundMoney(Math.max(0, totals.totalWithVat - advanceAmount));
  const bankGuaranteeAmount = advanceAmount;
  const bankGuaranteeCost = roundMoney(bankGuaranteeAmount * (project.bankGuaranteeAnnualRate ?? 0.03) * (workMonths / 12));
  const monthlyCost = totals.totalWithOverhead / workMonths;
  const pdStage = groupBreakdown.find((group) => group.group === "ПД");
  const rdStage = groupBreakdown.find((group) => group.group === "РД");
  const hasPdAndRd = Boolean(pdStage && rdStage);
  const pdPaymentIndex = Math.max(0, Math.min(workMonths - 1, Math.ceil(workMonths / 2) - 1));
  const finalPaymentIndex = workMonths - 1;
  const stagedRevenue = new Map<number, number>();

  if (hasPdAndRd && pdStage && rdStage) {
    const pdAndRdTotal = pdStage.totalWithoutVat + rdStage.totalWithoutVat;
    const pdShare = pdAndRdTotal > 0 ? pdStage.totalWithoutVat / pdAndRdTotal : 0.5;
    const pdPayment = roundMoney(remainingAmount * pdShare);
    stagedRevenue.set(pdPaymentIndex, (stagedRevenue.get(pdPaymentIndex) ?? 0) + pdPayment);
    stagedRevenue.set(finalPaymentIndex, (stagedRevenue.get(finalPaymentIndex) ?? 0) + roundMoney(remainingAmount - pdPayment));
  } else {
    stagedRevenue.set(finalPaymentIndex, remainingAmount);
  }

  let cumulativeCashFlow = 0;
  const cashFlow: CashFlowRow[] = displayMonths.map((month, index) => {
    const revenue = roundMoney((stagedRevenue.get(index) ?? 0) + (index === 0 ? advanceAmount : 0));
    const cost = roundMoney(monthlyCost);
    const rowGuaranteeCost = index === 0 ? bankGuaranteeCost : 0;
    const netCashFlow = roundMoney(revenue - cost - rowGuaranteeCost);
    cumulativeCashFlow = roundMoney(cumulativeCashFlow + netCashFlow);
    return {
      month,
      revenue,
      cost,
      bankGuaranteeCost: rowGuaranteeCost,
      netCashFlow,
      cumulativeCashFlow,
    };
  });

  return {
    advanceAmount,
    remainingAmount,
    bankGuaranteeAmount: roundMoney(bankGuaranteeAmount),
    bankGuaranteeCost,
    workMonths,
    cashFlow,
  };
}

function calculateSingleSbcResult(project: ProjectInput, totals: EstimateTotals): SbcResult {
  const method = project.sbcMethod ?? "natural";
  const naturalIndicator = project.sbcNaturalIndicator ?? project.area ?? 0;
  const breakdownDocument = getFgisBreakdownDocument(project.sbcFgisNormGuid);
  const tableDocument = getFgisTableDocument(project.sbcFgisNormGuid);
  const isStructuredNorm = Boolean(breakdownDocument && tableDocument);
  const blockers: string[] = [];
  const traceWarnings: string[] = [];
  let ruleCode = method === "natural" ? "8.1" : "8.9-8.11";
  let ruleTitle = method === "natural" ? "Цена по натуральному показателю" : "Процент от стоимости строительства";
  let formula = "";
  let source = method === "natural"
    ? "п. 130, формула 8.1 Методики № 707/пр"
    : "пп. 135-139, формулы 8.9-8.11 Методики № 707/пр";
  let sourcePage: number | undefined = method === "natural" ? 54 : 58;
  let basePrice = 0;
  let baseConstructionCost: number | undefined;

  if (project.sbcFgisKind === "survey") {
    blockers.push("Для инженерных изысканий требуется расчёт состава работ по таблицам показателей затрат выбранного сборника.");
    ruleCode = "не рассчитывается";
    ruleTitle = "Каталог нормативов инженерных изысканий";
    formula = "Σ стоимость отдельных изыскательских работ";
    source = "Выбранный норматив инженерных изысканий";
    sourcePage = undefined;
  } else if (isStructuredNorm && method === "natural") {
    const resolution = resolveFgisNaturalPriceForProject(project);
    if (!resolution?.valid) blockers.push(resolution?.blocker ?? "Не удалось сопоставить показатель со структурированной таблицей ФГИС.");
    basePrice = resolution?.valid ? resolution.priceRub : 0;
    ruleCode = resolution?.ruleCode ?? "не определено";
    ruleTitle = resolution?.explanation ?? "Правило расчёта не определено";
    formula = resolution?.formula ?? "Расчёт не выполнен";
    source = resolution?.sourceParagraph ?? source;
    sourcePage = resolution?.sourcePage ?? sourcePage;
  } else if (isStructuredNorm && method === "constructionPercent") {
    const rebaseCoefficient = project.sbcConstructionRebaseCoefficient ?? 1;
    baseConstructionCost = (project.sbcConstructionCost ?? 0) * rebaseCoefficient;
    const percentTable = tableDocument?.percentTables.find((table) => table.code === project.sbcFgisTableCode);
    if (!percentTable) blockers.push("Не найдена выбранная таблица процента от стоимости строительства.");
    if (!(project.sbcConstructionCost > 0)) blockers.push("Введите положительную стоимость строительства.");
    if (!(rebaseCoefficient > 0)) blockers.push("Введите коэффициент приведения стоимости строительства к уровню цен норматива.");
    const interpolated = percentTable && baseConstructionCost > 0
      ? interpolateFgisPercent(percentTable, baseConstructionCost)
      : undefined;
    basePrice = interpolated ? baseConstructionCost * interpolated.percent / 100 : 0;
    formula = interpolated
      ? `${roundMoney(project.sbcConstructionCost)} × ${rebaseCoefficient} × ${roundMoney(interpolated.percent)}%`
      : "Расчёт не выполнен";
    ruleTitle = interpolated?.clamped
      ? `Процент принят по ${interpolated.clamped === "min" ? "минимальной" : "максимальной"} строке таблицы 3.18`
      : "Процент определён линейной интерполяцией таблицы 3.18";
    sourcePage = interpolated?.lower.page ?? sourcePage;
  } else {
    basePrice = method === "constructionPercent"
      ? (project.sbcConstructionCost ?? 0) * (project.sbcDesignPercent ?? 0)
      : (project.sbcConstantA ?? 0) + (project.sbcConstantB ?? 0) * naturalIndicator;
    formula = method === "constructionPercent"
      ? `${project.sbcConstructionCost ?? 0} × ${project.sbcDesignPercent ?? 0}`
      : `${project.sbcConstantA ?? 0} + ${project.sbcConstantB ?? 0} × ${naturalIndicator}`;
    traceWarnings.push("Параметры неструктурированного документа введены вручную и должны быть проверены по официальному PDF.");
  }

  const constrainedFactors = new Set(project.sbcConstrainedSiteFactors ?? []).size;
  const normSpecificCoefficient = isStructuredNorm && (constrainedFactors >= 3 || project.sbcHeritageProtectionZone) ? 1.1 : 1;
  const selectedNormCondition = isStructuredNorm
    ? get848NormCondition(project.sbcFgisTableCode, project.sbcNormConditionId)
    : undefined;
  const normTableCoefficient = selectedNormCondition?.coefficient ?? 1;
  if (project.sbcNormConditionId && !selectedNormCondition) {
    traceWarnings.push("Условие из специальной таблицы сброшено: оно не относится к выбранному объекту.");
  }

  const complexRole = project.sbcComplexObject ? (project.sbcComplexRole ?? "main") : "single";
  const complexLimit = complexRoleLimit(complexRole);
  const requestedComplexCoefficient = project.sbcComplexRoleCoefficient ?? complexLimit.defaultValue;
  if (project.sbcComplexObject && (!(requestedComplexCoefficient > 0) || requestedComplexCoefficient > complexLimit.max)) {
    blockers.push(`Коэффициент позиции «${complexRole}» должен быть больше 0 и не превышать ${complexLimit.max}.`);
  }
  if (complexRole === "repeated" && requestedComplexCoefficient < 0.2) {
    blockers.push("Для повторно применяемой документации коэффициент должен находиться в нормативном диапазоне от 0,2 до 0,8.");
  }
  const complexRoleCoefficient = project.sbcComplexObject ? requestedComplexCoefficient : 1;

  const specialRequested = Boolean(project.sbcSpecialDefenseStatus && project.sbcParallelDesignConstruction);
  const calculationDate = project.sbcCalculationDate || new Date().toISOString().slice(0, 10);
  const specialPeriodEligible = calculationDate >= "2026-05-17" && calculationDate <= "2026-12-31";
  const specialStatusCoefficient = isStructuredNorm && specialRequested && specialPeriodEligible ? 1.3 : 1;
  if (specialRequested && !specialPeriodEligible) {
    traceWarnings.push("Коэффициент 1,3 не применён: проверьте дату расчёта и действие временной нормы приказа № 180/пр.");
  } else if (specialStatusCoefficient === 1.3) {
    traceWarnings.push(`Коэффициент 1,3 применён по п. 169(1) Методики № 707/пр на дату ${calculationDate}; основание — включение объекта в специальный перечень и параллельное выполнение работ.`);
  }
  const smrSharePercent = project.sbcSmrSharePercent ?? 60;
  if (method === "constructionPercent" && (smrSharePercent < 0 || smrSharePercent > 100)) {
    blockers.push("Доля СМР должна быть от 0 до 100%.");
  }
  const appliedSmrCoefficient = isStructuredNorm && method === "constructionPercent"
    ? smrShareCoefficient(smrSharePercent)
    : 1;
  const legacyCoefficient = isStructuredNorm
    ? 1
    : (project.sbcComplexityCoefficient ?? 1) * (project.sbcAdjustmentCoefficient ?? 1);
  const ordinaryCoefficient = normSpecificCoefficient
    * normTableCoefficient
    * complexRoleCoefficient
    * specialStatusCoefficient
    * appliedSmrCoefficient
    * legacyCoefficient;

  const airBreakdownTable = project.sbcFgisTableCode === "3.18"
    ? breakdownDocument?.tables.find((table) => table.code === project.sbcFgisBreakdownTableCode)
    : getFgisBreakdownTable(breakdownDocument, project.sbcFgisTableCode);
  const airBreakdownObject = airBreakdownTable
    ? (
        airBreakdownTable.objects.find((item) => item.id === project.sbcFgisBreakdownObjectId)
        ?? recommendFgisBreakdownObject(airBreakdownTable, project.sbcFgisObjectName ?? "")
      )
    : undefined;
  const conditioningAlreadyIncluded = Boolean((airBreakdownObject?.stages.combined.КОН ?? 0) > 0);
  let airConditioningDesignBasePrice = 0;
  let airConditioningBaseExplanation = "";
  if (isStructuredNorm && !conditioningAlreadyIncluded && method === "natural" && (project.sbcAirConditionedIndicator ?? 0) > 0) {
    const airResolution = resolveFgisNaturalPriceForProject({
      ...project,
      sbcNaturalIndicator: project.sbcAirConditionedIndicator ?? 0,
    });
    if (airResolution?.valid) {
      airConditioningDesignBasePrice = airResolution.priceRub;
      airConditioningBaseExplanation = `по натуральному показателю кондиционируемой части ${project.sbcAirConditionedIndicator}`;
    } else {
      traceWarnings.push(`Дополнение КОН не рассчитано: ${airResolution?.blocker ?? "не удалось определить базовую цену кондиционируемой части"}.`);
    }
  } else if (isStructuredNorm && !conditioningAlreadyIncluded && method === "constructionPercent" && (project.sbcAirConditionedConstructionCost ?? 0) > 0) {
    const rebaseCoefficient = project.sbcConstructionRebaseCoefficient ?? 1;
    const airBaseConstructionCost = (project.sbcAirConditionedConstructionCost ?? 0) * rebaseCoefficient;
    const percentTable = tableDocument?.percentTables.find((table) => table.code === project.sbcFgisTableCode);
    const airInterpolated = percentTable ? interpolateFgisPercent(percentTable, airBaseConstructionCost) : undefined;
    if (airInterpolated) {
      airConditioningDesignBasePrice = airBaseConstructionCost * airInterpolated.percent / 100;
      airConditioningBaseExplanation = `по стоимости строительства кондиционируемой части и нормативу ${roundMoney(airInterpolated.percent)}%`;
    }
  } else if (isStructuredNorm && !conditioningAlreadyIncluded) {
    airConditioningDesignBasePrice = Math.max(0, project.sbcAirConditioningDesignCost ?? 0);
    if (airConditioningDesignBasePrice > 0) airConditioningBaseExplanation = "по сохранённому ручному значению старого расчёта";
  }
  const airConditioningAdditionalBasePrice = airConditioningDesignBasePrice * 0.031;
  if (airConditioningAdditionalBasePrice > 0) {
    traceWarnings.push(`Стоимость раздела «КОН — Кондиционирование воздуха» добавлена в размере 3,1% для ПД + РД по п. 25 НЗ № 848/пр; база определена ${airConditioningBaseExplanation}.`);
  }
  const coreBasePrice = basePrice;
  basePrice = coreBasePrice + airConditioningAdditionalBasePrice;

  const bimCoefficient = project.sbcInformationModel
    ? get848BimCoefficient(project.sbcBimObjectGroupId)
    : undefined;
  const bimOptions = resolve848BimOptions(project.sbcFgisTableCode, project.sbcFgisObjectName);
  if (isStructuredNorm && project.sbcInformationModel && !bimCoefficient) {
    blockers.push("Выберите вид объекта для коэффициентов информационной модели из приложения № 2.");
  } else if (
    isStructuredNorm
    && project.sbcInformationModel
    && project.sbcFgisTableCode !== "3.18"
    && bimCoefficient
    && (
      !bimOptions.options.some((row) => row.id === bimCoefficient.id)
      || (bimOptions.exact && bimOptions.recommendedId !== bimCoefficient.id)
    )
  ) {
    blockers.push("Выбранный вид объекта для информационной модели не соответствует нормативной категории рассчитываемого объекта.");
  }
  const bimPdCoefficient = bimCoefficient?.pd ?? 1;
  const bimRdCoefficient = bimCoefficient?.rd ?? 1;
  const valid = blockers.length === 0;
  if (!valid) basePrice = 0;
  const effectiveCoreBasePrice = valid ? coreBasePrice : 0;
  const conditionedBasePrice = basePrice * ordinaryCoefficient;
  const conditionedCoreBasePrice = effectiveCoreBasePrice * ordinaryCoefficient;
  const rawStandardPdShare = breakdownDocument ? breakdownDocument.stageShares.pd / 100 : Math.max(0, project.sbcPdShare ?? 0);
  const rawStandardRdShare = breakdownDocument ? breakdownDocument.stageShares.rd / 100 : Math.max(0, project.sbcRdShare ?? 0);
  const standardStageDenominator = rawStandardPdShare + rawStandardRdShare > 1
    ? rawStandardPdShare + rawStandardRdShare
    : 1;
  const standardPdShare = rawStandardPdShare / standardStageDenominator;
  const standardRdShare = rawStandardRdShare / standardStageDenominator;
  const bimRdOnly = Boolean(project.sbcInformationModel && project.sbcBimRdFromNonBimPd);
  const pdBasePrice = project.sbcInformationModel && bimCoefficient
    ? (bimRdOnly ? 0 : conditionedBasePrice * 0.6 * bimPdCoefficient)
    : conditionedBasePrice * standardPdShare;
  const rdBasePrice = project.sbcInformationModel && bimCoefficient
    ? conditionedBasePrice * (bimRdOnly ? 0.6 : 0.4) * bimRdCoefficient
    : conditionedBasePrice * standardRdShare;
  const otherBasePrice = project.sbcInformationModel
    ? 0
    : Math.max(0, conditionedBasePrice - pdBasePrice - rdBasePrice);
  const adjustedBasePrice = pdBasePrice + rdBasePrice + otherBasePrice;
  const totalCoefficient = basePrice > 0 ? adjustedBasePrice / basePrice : ordinaryCoefficient;
  const currentIndex = project.sbcIndexToCurrent ?? 1;
  const currentPriceWithoutVat = adjustedBasePrice * currentIndex;
  const currentPriceWithVat = currentPriceWithoutVat * (1 + (project.vatRate ?? 0));
  const pdShare = project.sbcInformationModel ? (bimRdOnly ? 0 : 0.6) : standardPdShare;
  const rdShare = project.sbcInformationModel ? (bimRdOnly ? 0.6 : 0.4) : standardRdShare;
  const pdPriceWithoutVat = pdBasePrice * currentIndex;
  const rdPriceWithoutVat = rdBasePrice * currentIndex;
  const otherPriceWithoutVat = otherBasePrice * currentIndex;
  const bimPdAdditionalWithoutVat = project.sbcInformationModel && bimCoefficient && !bimRdOnly
    ? conditionedBasePrice * 0.6 * Math.max(0, bimPdCoefficient - 1) * currentIndex
    : 0;
  const bimRdAdditionalWithoutVat = project.sbcInformationModel && bimCoefficient
    ? conditionedBasePrice * (bimRdOnly ? 0.6 : 0.4) * Math.max(0, bimRdCoefficient - 1) * currentIndex
    : 0;
  const pdCorePriceWithoutVat = (
    project.sbcInformationModel && bimCoefficient
      ? (bimRdOnly ? 0 : conditionedCoreBasePrice * 0.6 * bimPdCoefficient)
      : conditionedCoreBasePrice * standardPdShare
  ) * currentIndex;
  const rdCorePriceWithoutVat = (
    project.sbcInformationModel && bimCoefficient
      ? conditionedCoreBasePrice * (bimRdOnly ? 0.6 : 0.4) * bimRdCoefficient
      : conditionedCoreBasePrice * standardRdShare
  ) * currentIndex;
  const pdAirPriceWithoutVat = Math.max(0, pdPriceWithoutVat - pdCorePriceWithoutVat);
  const rdAirPriceWithoutVat = Math.max(0, rdPriceWithoutVat - rdCorePriceWithoutVat);
  const normativeDurationDays = (project.sbcBaseDurationDays ?? 0) * (project.sbcDurationCoefficient ?? 1);
  const differenceWithoutVat = totals.totalWithoutVat - currentPriceWithoutVat;
  const differenceWithVat = totals.totalWithVat - currentPriceWithVat;
  const notes = [
    `${ruleCode}: ${ruleTitle}.`,
    `Применённый общий коэффициент: ${roundMoney(totalCoefficient)}; цена с условиями: ${roundMoney(adjustedBasePrice)} ₽.`,
    `Текущий уровень цен: Cтек = Cусл × I = ${roundMoney(currentPriceWithoutVat)} ₽ без НДС.`,
    pdShare + rdShare > 1
      ? "Сумма долей ПД и РД больше 100%; доли нормализованы пропорционально."
      : "Не распределённый между ПД и РД остаток отражается как прочие работы.",
    `Нормативный срок: T = Tбаз × Kсрок = ${roundMoney(normativeDurationDays)} дн.`,
    ...blockers.map((item) => `Расчёт остановлен: ${item}`),
    ...traceWarnings,
  ];

  const breakdownTable = breakdownDocument
    ? (
        project.sbcFgisTableCode === "3.18"
          ? breakdownDocument.tables.find((table) => table.code === project.sbcFgisBreakdownTableCode)
          : getFgisBreakdownTable(breakdownDocument, project.sbcFgisTableCode)
      )
    : undefined;
  const breakdownObject = breakdownTable
    ? (
        breakdownTable.objects.find((item) => item.id === project.sbcFgisBreakdownObjectId) ??
        recommendFgisBreakdownObject(breakdownTable, project.sbcFgisObjectName ?? "")
      )
    : undefined;
  const officialBreakdown = breakdownDocument && breakdownTable && breakdownObject
    ? {
        tableCode: breakdownTable.code,
        objectId: breakdownObject.id,
        objectName: breakdownObject.name,
        page: breakdownObject.page,
        stageSourcePage: breakdownDocument.stageSourcePage,
        pdSharePercent: pdShare * 100,
        rdSharePercent: rdShare * 100,
        pdPublishedTotalPercent: breakdownObject.totals.pd,
        rdPublishedTotalPercent: breakdownObject.totals.rd,
        sections: fgisPirBreakdownCatalog.sections.map((section) => {
          const pdSectionShare = breakdownObject.stages.pd[section.code] ?? 0;
          const rdSectionShare = breakdownObject.stages.rd[section.code] ?? 0;
          const pdSectionPrice = pdCorePriceWithoutVat * pdSectionShare / 100
            + (section.code === "КОН" ? pdAirPriceWithoutVat : 0);
          const rdSectionPrice = rdCorePriceWithoutVat * rdSectionShare / 100
            + (section.code === "КОН" ? rdAirPriceWithoutVat : 0);
          return {
            code: section.code,
            name: section.name,
            pdSharePercent: pdSectionShare,
            rdSharePercent: rdSectionShare,
            combinedSharePercent: breakdownObject.stages.combined[section.code] ?? 0,
            pdPriceWithoutVat: roundMoney(pdSectionPrice),
            rdPriceWithoutVat: roundMoney(rdSectionPrice),
            totalPriceWithoutVat: roundMoney(pdSectionPrice + rdSectionPrice),
          };
        }),
        pdUnallocatedWithoutVat: roundMoney(
          pdCorePriceWithoutVat * Math.max(0, 100 - breakdownObject.totals.pd) / 100,
        ),
        rdUnallocatedWithoutVat: roundMoney(
          rdCorePriceWithoutVat * Math.max(0, 100 - breakdownObject.totals.rd) / 100,
        ),
      }
    : undefined;

  return {
    method,
    collectionName: project.sbcCollectionName ?? "СБЦ",
    baseYear: project.sbcBaseYear ?? "",
    basePrice: roundMoney(basePrice),
    adjustedBasePrice: roundMoney(adjustedBasePrice),
    currentPriceWithoutVat: roundMoney(currentPriceWithoutVat),
    currentPriceWithVat: roundMoney(currentPriceWithVat),
    pdPriceWithoutVat: roundMoney(pdPriceWithoutVat),
    rdPriceWithoutVat: roundMoney(rdPriceWithoutVat),
    otherPriceWithoutVat: roundMoney(otherPriceWithoutVat),
    normativeDurationDays: roundMoney(normativeDurationDays),
    differenceWithoutVat: roundMoney(differenceWithoutVat),
    differenceWithVat: roundMoney(differenceWithVat),
    ratioToSbc: roundMoney(currentPriceWithoutVat > 0 ? totals.totalWithoutVat / currentPriceWithoutVat - 1 : 0),
    notes,
    normativeTrace: {
      valid,
      ruleCode,
      ruleTitle,
      formula,
      source,
      sourcePage,
      baseConstructionCost: baseConstructionCost === undefined ? undefined : roundMoney(baseConstructionCost),
      constructionRebaseCoefficient: project.sbcConstructionRebaseCoefficient ?? 1,
      smrSharePercent,
      smrShareCoefficient: appliedSmrCoefficient,
      normSpecificCoefficient,
      normTableCoefficient,
      complexRoleCoefficient,
      specialStatusCoefficient,
      bimPdCoefficient,
      bimRdCoefficient,
      bimPdAdditionalWithoutVat: roundMoney(bimPdAdditionalWithoutVat),
      bimRdAdditionalWithoutVat: roundMoney(bimRdAdditionalWithoutVat),
      airConditioningDesignBasePrice: roundMoney(airConditioningDesignBasePrice),
      airConditioningAdditionalBasePrice: roundMoney(airConditioningAdditionalBasePrice),
      totalCoefficient: roundMoney(totalCoefficient),
      blockers,
      warnings: traceWarnings,
    },
    officialBreakdown,
  };
}

function applyPzuCoefficient(
  result: SbcResult,
  coefficient: number,
  project: ProjectInput,
  totals: EstimateTotals,
): { result: SbcResult; reductionWithoutVat: number } {
  if (coefficient < 0 || coefficient > 1) {
    const blocker = "Коэффициент ПЗУ должен находиться в диапазоне от 0 до 1.";
    return {
      reductionWithoutVat: 0,
      result: {
        ...result,
        basePrice: 0,
        adjustedBasePrice: 0,
        currentPriceWithoutVat: 0,
        currentPriceWithVat: 0,
        pdPriceWithoutVat: 0,
        rdPriceWithoutVat: 0,
        otherPriceWithoutVat: 0,
        normativeTrace: {
          ...result.normativeTrace,
          valid: false,
          blockers: [...result.normativeTrace.blockers, blocker],
        },
      },
    };
  }
  if (!result.officialBreakdown || coefficient === 1) return { result, reductionWithoutVat: 0 };
  const pzu = result.officialBreakdown.sections.find((section) => section.code === "ПЗУ");
  if (!pzu) return { result, reductionWithoutVat: 0 };

  const pdReduction = pzu.pdPriceWithoutVat * (1 - coefficient);
  const rdReduction = pzu.rdPriceWithoutVat * (1 - coefficient);
  const pdBimReduction = result.normativeTrace.bimPdCoefficient > 1
    ? pzu.pdPriceWithoutVat * (1 - 1 / result.normativeTrace.bimPdCoefficient) * (1 - coefficient)
    : 0;
  const rdBimReduction = result.normativeTrace.bimRdCoefficient > 1
    ? pzu.rdPriceWithoutVat * (1 - 1 / result.normativeTrace.bimRdCoefficient) * (1 - coefficient)
    : 0;
  const reductionWithoutVat = pdReduction + rdReduction;
  const currentPriceWithoutVat = Math.max(0, result.currentPriceWithoutVat - reductionWithoutVat);
  const currentIndex = project.sbcIndexToCurrent ?? 1;
  const adjustedBasePrice = currentIndex > 0
    ? Math.max(0, result.adjustedBasePrice - reductionWithoutVat / currentIndex)
    : result.adjustedBasePrice;
  const basePrice = result.normativeTrace.totalCoefficient > 0
    ? adjustedBasePrice / result.normativeTrace.totalCoefficient
    : result.basePrice;
  const currentPriceWithVat = currentPriceWithoutVat * (1 + (project.vatRate ?? 0));
  return {
    reductionWithoutVat: roundMoney(reductionWithoutVat),
    result: {
      ...result,
      basePrice: roundMoney(basePrice),
      adjustedBasePrice: roundMoney(adjustedBasePrice),
      currentPriceWithoutVat: roundMoney(currentPriceWithoutVat),
      currentPriceWithVat: roundMoney(currentPriceWithVat),
      pdPriceWithoutVat: roundMoney(Math.max(0, result.pdPriceWithoutVat - pdReduction)),
      rdPriceWithoutVat: roundMoney(Math.max(0, result.rdPriceWithoutVat - rdReduction)),
      differenceWithoutVat: roundMoney(totals.totalWithoutVat - currentPriceWithoutVat),
      differenceWithVat: roundMoney(totals.totalWithVat - currentPriceWithVat),
      normativeTrace: {
        ...result.normativeTrace,
        bimPdAdditionalWithoutVat: roundMoney(Math.max(0, result.normativeTrace.bimPdAdditionalWithoutVat - pdBimReduction)),
        bimRdAdditionalWithoutVat: roundMoney(Math.max(0, result.normativeTrace.bimRdAdditionalWithoutVat - rdBimReduction)),
      },
      officialBreakdown: {
        ...result.officialBreakdown,
        sections: result.officialBreakdown.sections.map((section) => section.code === "ПЗУ"
          ? {
              ...section,
              pdSharePercent: section.pdSharePercent * coefficient,
              rdSharePercent: section.rdSharePercent * coefficient,
              combinedSharePercent: section.combinedSharePercent * coefficient,
              pdPriceWithoutVat: roundMoney(section.pdPriceWithoutVat * coefficient),
              rdPriceWithoutVat: roundMoney(section.rdPriceWithoutVat * coefficient),
              totalPriceWithoutVat: roundMoney(section.totalPriceWithoutVat * coefficient),
            }
          : section),
      },
      notes: [
        ...result.notes,
        `К разделу ПЗУ применён согласованный коэффициент ${coefficient}; уменьшение ${roundMoney(reductionWithoutVat)} ₽ без НДС.`,
      ],
    },
  };
}

export function calculateSbcResult(project: ProjectInput, totals: EstimateTotals): SbcResult {
  const components = project.sbcComplexComponents ?? [];
  if (!components.length) return calculateSingleSbcResult(project, totals);

  const calculated = components.map((component) => {
    const componentProject: ProjectInput = {
      ...project,
      ...component.input,
      sbcComplexComponents: undefined,
      sbcComplexObject: true,
    };
    const single = calculateSingleSbcResult(componentProject, totals);
    const adjusted = applyPzuCoefficient(single, component.pzuCoefficient, componentProject, totals);
    return { component, project: componentProject, result: adjusted.result, pzuReductionWithoutVat: adjusted.reductionWithoutVat };
  });
  const allValid = calculated.every((item) => item.result.normativeTrace.valid);
  const sum = (selector: (result: SbcResult) => number) => allValid
    ? calculated.reduce((total, item) => total + selector(item.result), 0)
    : 0;
  const basePrice = sum((item) => item.basePrice);
  const adjustedBasePrice = sum((item) => item.adjustedBasePrice);
  const currentPriceWithoutVat = sum((item) => item.currentPriceWithoutVat);
  const currentPriceWithVat = sum((item) => item.currentPriceWithVat);
  const pdPriceWithoutVat = sum((item) => item.pdPriceWithoutVat);
  const rdPriceWithoutVat = sum((item) => item.rdPriceWithoutVat);
  const otherPriceWithoutVat = sum((item) => item.otherPriceWithoutVat);
  const blockers = calculated.flatMap((item) => item.result.normativeTrace.blockers.map((blocker) => `${item.component.name}: ${blocker}`));
  const warnings = calculated.flatMap((item) => item.result.normativeTrace.warnings.map((warning) => `${item.component.name}: ${warning}`));
  const sectionTotals = fgisPirBreakdownCatalog.sections.map((section) => {
    const pd = sum((item) => item.officialBreakdown?.sections.find((row) => row.code === section.code)?.pdPriceWithoutVat ?? 0);
    const rd = sum((item) => item.officialBreakdown?.sections.find((row) => row.code === section.code)?.rdPriceWithoutVat ?? 0);
    return { section, pd, rd, total: pd + rd };
  });
  const pdSharePercent = currentPriceWithoutVat > 0 ? pdPriceWithoutVat / currentPriceWithoutVat * 100 : 0;
  const rdSharePercent = currentPriceWithoutVat > 0 ? rdPriceWithoutVat / currentPriceWithoutVat * 100 : 0;
  const totalCoefficient = basePrice > 0 ? adjustedBasePrice / basePrice : 1;
  const firstValidBreakdown = calculated.find((item) => item.result.normativeTrace.valid && item.result.officialBreakdown)?.result.officialBreakdown;

  return {
    method: "natural",
    collectionName: "Комплекс объектов по НЗ № 848/пр",
    baseYear: calculated[0]?.result.baseYear ?? project.sbcBaseYear ?? "",
    basePrice: roundMoney(basePrice),
    adjustedBasePrice: roundMoney(adjustedBasePrice),
    currentPriceWithoutVat: roundMoney(currentPriceWithoutVat),
    currentPriceWithVat: roundMoney(currentPriceWithVat),
    pdPriceWithoutVat: roundMoney(pdPriceWithoutVat),
    rdPriceWithoutVat: roundMoney(rdPriceWithoutVat),
    otherPriceWithoutVat: roundMoney(otherPriceWithoutVat),
    normativeDurationDays: allValid ? Math.max(...calculated.map((item) => item.result.normativeDurationDays), 0) : 0,
    differenceWithoutVat: roundMoney(totals.totalWithoutVat - currentPriceWithoutVat),
    differenceWithVat: roundMoney(totals.totalWithVat - currentPriceWithVat),
    ratioToSbc: roundMoney(currentPriceWithoutVat > 0 ? totals.totalWithoutVat / currentPriceWithoutVat - 1 : 0),
    notes: [
      `Стоимость комплекса определена суммированием ${positionCountLabel(components.length)} по пп. 18–20 НЗ № 848/пр.`,
      "Коэффициент ПЗУ применяется только к стоимости раздела ПЗУ соответствующей позиции.",
      ...blockers.map((item) => `Расчёт остановлен: ${item}`),
      ...warnings,
    ],
    normativeTrace: {
      valid: allValid,
      ruleCode: "Σ 18–20",
      ruleTitle: "Суммирование отдельно рассчитанных зданий, сооружений и помещений комплекса",
      formula: `Σ Cпозиций (${components.length})`,
      source: "пп. 18–20 НЗ № 848/пр; пп. 152, 170 Методики № 707/пр",
      sourcePage: 5,
      constructionRebaseCoefficient: 1,
      smrSharePercent: 60,
      smrShareCoefficient: 1,
      normSpecificCoefficient: 1,
      normTableCoefficient: 1,
      complexRoleCoefficient: 1,
      specialStatusCoefficient: 1,
      bimPdCoefficient: 1,
      bimRdCoefficient: 1,
      bimPdAdditionalWithoutVat: roundMoney(sum((item) => item.normativeTrace.bimPdAdditionalWithoutVat)),
      bimRdAdditionalWithoutVat: roundMoney(sum((item) => item.normativeTrace.bimRdAdditionalWithoutVat)),
      airConditioningDesignBasePrice: roundMoney(sum((item) => item.normativeTrace.airConditioningDesignBasePrice)),
      airConditioningAdditionalBasePrice: roundMoney(sum((item) => item.normativeTrace.airConditioningAdditionalBasePrice)),
      totalCoefficient: roundMoney(totalCoefficient),
      blockers,
      warnings,
    },
    officialBreakdown: firstValidBreakdown
      ? {
          tableCode: "Σ",
          objectId: "complex",
          objectName: `Комплекс: ${positionCountLabel(components.length)}`,
          page: 5,
          stageSourcePage: firstValidBreakdown.stageSourcePage,
          pdSharePercent: roundMoney(pdSharePercent),
          rdSharePercent: roundMoney(rdSharePercent),
          pdPublishedTotalPercent: 100,
          rdPublishedTotalPercent: 100,
          sections: sectionTotals.map(({ section, pd, rd, total }) => ({
            code: section.code,
            name: section.name,
            pdSharePercent: pdPriceWithoutVat > 0 ? roundMoney(pd / pdPriceWithoutVat * 100) : 0,
            rdSharePercent: rdPriceWithoutVat > 0 ? roundMoney(rd / rdPriceWithoutVat * 100) : 0,
            combinedSharePercent: currentPriceWithoutVat > 0 ? roundMoney(total / currentPriceWithoutVat * 100) : 0,
            pdPriceWithoutVat: roundMoney(pd),
            rdPriceWithoutVat: roundMoney(rd),
            totalPriceWithoutVat: roundMoney(total),
          })),
          pdUnallocatedWithoutVat: sum((item) => item.officialBreakdown?.pdUnallocatedWithoutVat ?? 0),
          rdUnallocatedWithoutVat: sum((item) => item.officialBreakdown?.rdUnallocatedWithoutVat ?? 0),
        }
      : undefined,
    complexBreakdown: {
      componentCount: components.length,
      components: calculated.map(({ component, project: componentProject, result, pzuReductionWithoutVat }) => ({
        id: component.id,
        name: component.name,
        tableCode: componentProject.sbcFgisTableCode ?? "",
        objectName: componentProject.sbcFgisObjectName ?? "",
        indicator: componentProject.sbcMethod === "constructionPercent"
          ? componentProject.sbcConstructionCost ?? 0
          : componentProject.sbcNaturalIndicator ?? 0,
        indicatorUnit: componentProject.sbcFgisIndicatorUnit ?? (componentProject.sbcMethod === "constructionPercent" ? "₽" : "ед."),
        role: componentProject.sbcComplexRole ?? "main",
        roleCoefficient: result.normativeTrace.complexRoleCoefficient,
        pzuCoefficient: component.pzuCoefficient,
        pzuReductionWithoutVat,
        basePrice: result.basePrice,
        currentPriceWithoutVat: result.currentPriceWithoutVat,
        pdPriceWithoutVat: result.pdPriceWithoutVat,
        rdPriceWithoutVat: result.rdPriceWithoutVat,
        valid: result.normativeTrace.valid,
        blockers: result.normativeTrace.blockers,
      })),
    },
  };
}

export function calculateLine(
  line: EstimateLine,
  project: ProjectInput,
  rates: RateGroup[],
  index: number,
): CalculatedLine {
  const calculationType = normalizeCalculationType(line.calculationType);
  const staffRole = normalizeStaffRole(line.staffRole);
  const staffing = getLineStaffing(line);
  const totalWorkUnits = staffing.chief + staffing.lead + staffing.engineer;
  const roleMultiplier = totalWorkUnits > 0
    ? (
      staffing.chief * getStaffRoleMultiplier("Главспец", project.roleStepRate ?? 0.15) +
      staffing.lead +
      staffing.engineer * getStaffRoleMultiplier("Инженер", project.roleStepRate ?? 0.15)
    ) / totalWorkUnits
    : getStaffRoleMultiplier(staffRole, project.roleStepRate ?? 0.15);
  const selectedByPreset = activeByPreset(line, project);
  const active =
    !isHeadingType(calculationType) && !line.excluded && (selectedByPreset || line.manualInclude);
  const baseMonthlyRate = getRateByGroupOrCode(line.departmentCode, rates) * (project.rateMultiplier ?? 1);
  const monthlySalaryMedian = baseMonthlyRate * roleMultiplier;
  const monthlyInsuranceContribution = isFotType(calculationType)
    ? monthlySalaryMedian * (project.insuranceContributionRate ?? 0.302)
    : 0;
  const monthlyDepreciation = isFotType(calculationType) ? calculateMonthlyDepreciation(project) : 0;
  const monthlyCostBase =
    staffing.chief * (baseMonthlyRate * getStaffRoleMultiplier("Главспец", project.roleStepRate ?? 0.15) + monthlyDepreciation) +
    staffing.lead * (baseMonthlyRate + monthlyDepreciation) +
    staffing.engineer * (baseMonthlyRate * getStaffRoleMultiplier("Инженер", project.roleStepRate ?? 0.15) + monthlyDepreciation);
  const costGroup = resolveCostGroup(line);
  const durationDays = project.useGlobalDuration
    ? (project.globalDurationDays ?? line.durationDays)
    : line.durationDays;
  const coefficient = project.useGlobalCoefficient ? (project.globalCoefficient ?? line.coefficient) : line.coefficient;
  const fotEstimate = active
    ? (durationDays * monthlyCostBase) / 30
    : 0;
  const workCost = active ? (isManualType(line.calculationType) ? line.manualAmount : fotEstimate * coefficient) : 0;
  const withBuffer = active ? workCost * (1 + project.bufferRate) : 0;
  const withCommercialCoefficient = active ? withBuffer * project.commercialCoefficient : 0;
  const costPerSquareMeter = project.area > 0 ? withCommercialCoefficient / project.area : 0;
  const warning =
    active && isFotType(calculationType) && monthlySalaryMedian <= 0
      ? `Нет ставки для группы ${line.departmentCode ?? "без группы"}`
      : null;

  return {
    ...line,
    calculationType,
    staffRole,
    costGroup,
    selectedByPreset,
    active,
    workUnits: totalWorkUnits,
    chiefUnits: staffing.chief,
    leadUnits: staffing.lead,
    engineerUnits: staffing.engineer,
    monthlySalaryMedian: roundMoney(monthlySalaryMedian),
    roleMultiplier,
    monthlyInsuranceContribution: roundMoney(monthlyInsuranceContribution),
    monthlyDepreciation: roundMoney(monthlyDepreciation),
    durationDays,
    coefficient,
    fotEstimate: roundMoney(fotEstimate),
    workCost: roundMoney(workCost),
    withBuffer: roundMoney(withBuffer),
    withCommercialCoefficient: roundMoney(withCommercialCoefficient),
    costPerSquareMeter: roundMoney(costPerSquareMeter),
    warning,
    order: active ? index + 1 : null,
  };
}

export function calculateEstimate(project: ProjectInput, catalog: Catalog): EstimateResult {
  let order = 0;
  let lines = catalog.lines.map((line) => {
    const calculated = calculateLine(line, project, catalog.rates, order);
    if (calculated.active) order += 1;
    return { ...calculated, order: calculated.active ? order : null };
  });

  const baseDirectWorks = lines
    .filter((line) => line.active && !isPercentType(line.calculationType))
    .reduce((sum, line) => sum + line.workCost, 0);

  lines = lines.map((line) => {
    if (!line.active || !isPercentType(line.calculationType)) return line;
    const workCost = roundMoney(baseDirectWorks * (line.manualAmount / 100));
    const withBuffer = roundMoney(workCost * (1 + project.bufferRate));
    const withCommercialCoefficient = roundMoney(withBuffer * project.commercialCoefficient);
    return {
      ...line,
      workCost,
      fotEstimate: 0,
      withBuffer,
      withCommercialCoefficient,
      costPerSquareMeter: roundMoney(project.area > 0 ? withCommercialCoefficient / project.area : 0),
    };
  });

  const activeLines = lines.filter((line) => line.active);
  const directWorks = activeLines.reduce((sum, line) => sum + line.workCost, 0);
  const personDays = activeLines.reduce((sum, line) => (
    isFotType(line.calculationType) ? sum + line.workUnits * line.durationDays : sum
  ), 0);
  const bufferAmount = directWorks * project.bufferRate;
  const totalWithBuffer = directWorks + bufferAmount;
  const overheadAmount = totalWithBuffer * (project.overheadRate ?? 0.15);
  const totalWithOverhead = totalWithBuffer + overheadAmount;
  const totalWithoutVat = totalWithBuffer * project.commercialCoefficient;
  const commercialMarkup = totalWithoutVat - totalWithOverhead;
  const vatAmount = totalWithoutVat * project.vatRate;
  const totalWithVat = totalWithoutVat + vatAmount;
  const warningLines = lines.filter((line) => line.warning);
  const bySource = activeLines.reduce<Record<string, number>>((acc, line) => {
    const source = line.source ?? "Без источника";
    acc[source] = roundMoney((acc[source] ?? 0) + line.workCost);
    return acc;
  }, {});
  const byGroup = activeLines.reduce<Record<string, number>>((acc, line) => {
    const group = resolveCostGroup(line);
    acc[group] = roundMoney((acc[group] ?? 0) + line.workCost);
    return acc;
  }, {});
  const groupBreakdown = Object.entries(byGroup).map(([group, amount]) => {
    const share = directWorks > 0 ? amount / directWorks : 0;
    const groupTotalWithoutVat = totalWithoutVat * share;
    return {
      group,
      directWorks: roundMoney(amount),
      totalWithoutVat: roundMoney(groupTotalWithoutVat),
      costPerSquareMeter: roundMoney(project.area > 0 ? groupTotalWithoutVat / project.area : 0),
      share: roundMoney(share),
      profit: roundMoney(commercialMarkup * share),
      profitRate: roundMoney(amount > 0 ? (commercialMarkup * share) / amount : 0),
    };
  });

  const totals = {
    activeRows: activeLines.length,
    directWorks: roundMoney(directWorks),
    bufferAmount: roundMoney(bufferAmount),
    totalWithBuffer: roundMoney(totalWithBuffer),
    overheadAmount: roundMoney(overheadAmount),
    totalWithOverhead: roundMoney(totalWithOverhead),
    commercialMarkup: roundMoney(commercialMarkup),
    totalWithoutVat: roundMoney(totalWithoutVat),
    vatAmount: roundMoney(vatAmount),
    totalWithVat: roundMoney(totalWithVat),
    costWithoutVatPerSquareMeter: roundMoney(project.area > 0 ? totalWithoutVat / project.area : 0),
    costWithVatPerSquareMeter: roundMoney(project.area > 0 ? totalWithVat / project.area : 0),
    warningCount: warningLines.length,
    personDays: roundMoney(personDays),
  };

  return {
    project,
    catalogVersion: catalog.version,
    lines,
    activeLines,
    totals,
    finance: calculateFinanceSummary(project, totals, groupBreakdown),
    sbc: calculateSbcResult(project, totals),
    bySource,
    byGroup,
    groupBreakdown,
    warnings: warningLines.map((line) => `${line.id}: ${line.warning}`),
  };
}

export function seedToCatalog(seed: {
  version: number;
  sourceWorkbook: string;
  lines: EstimateLine[];
  rates: RateGroup[];
  rdReference: Catalog["rdReference"];
  pp87Reference: Catalog["pp87Reference"];
  presetSets: Catalog["presetSets"];
}): Catalog {
  return {
    version: seed.version,
    sourceWorkbook: seed.sourceWorkbook,
    lines: seed.lines,
    rates: seed.rates,
    rdReference: seed.rdReference,
    pp87Reference: seed.pp87Reference,
    presetSets: seed.presetSets,
  };
}
