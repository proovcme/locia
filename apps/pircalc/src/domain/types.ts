export type CalculationType = "ФОТ" | "Ручной" | "Подряд" | "% от общего" | "Заголовок" | string;
export type SbcCalculationMethod = "natural" | "constructionPercent";
export type FgisPirKind = "design" | "survey";
export type SbcComplexRole = "single" | "main" | "embedded" | "blocked" | "repeated";

export interface SbcComplexComponent {
  id: string;
  name: string;
  /** Коэффициент к стоимости раздела ПЗУ по согласованию с заказчиком, п. 18 НЗ № 848/пр. */
  pzuCoefficient: number;
  /** Снимок нормативных исходных данных позиции без вложенной корзины комплекса. */
  input: Partial<ProjectInput>;
}

export interface ProjectInput {
  projectType?: string;
  address?: string;
  customer?: string;
  area: number;
  vatRate: number;
  commercialCoefficient: number;
  overheadRate: number;
  bufferRate: number;
  advanceRate: number;
  workStartMonth: string;
  workEndMonth: string;
  bankGuaranteeAnnualRate: number;
  sbcMethod: SbcCalculationMethod;
  sbcCollectionName: string;
  sbcBaseYear: string;
  sbcNaturalIndicator: number;
  sbcConstantA: number;
  sbcConstantB: number;
  sbcConstructionCost: number;
  /** Коэффициент приведения исходной стоимости строительства к уровню цен норматива. */
  sbcConstructionRebaseCoefficient?: number;
  /** Доля строительно-монтажных работ в стоимости строительства, %. */
  sbcSmrSharePercent?: number;
  sbcDesignPercent: number;
  sbcIndexToCurrent: number;
  sbcComplexityCoefficient: number;
  sbcAdjustmentCoefficient: number;
  sbcPdShare: number;
  sbcRdShare: number;
  sbcBaseDurationDays: number;
  sbcDurationCoefficient: number;
  sbcFgisKind: FgisPirKind;
  sbcFgisNormGuid: string;
  sbcFgisPeriodId: number;
  sbcFgisPeriodLabel: string;
  sbcFgisApprovingAct: string;
  sbcFgisSourceUrl: string;
  sbcFgisCatalogSha256: string;
  sbcFgisTableCode?: string;
  sbcFgisTableTitle?: string;
  sbcFgisObjectName?: string;
  sbcFgisIndicatorUnit?: string;
  sbcFgisIndicatorRange?: string;
  sbcFgisTablePage?: number;
  sbcFgisBreakdownTableCode?: string;
  sbcFgisBreakdownObjectId?: string;
  /** Факторы стеснённости площадки по п. 17 НЗ № 848/пр. */
  sbcConstrainedSiteFactors?: string[];
  sbcHeritageProtectionZone?: boolean;
  sbcSpecialDefenseStatus?: boolean;
  sbcParallelDesignConstruction?: boolean;
  /** Дата составления расчёта для проверки действия нормативных условий. */
  sbcCalculationDate?: string;
  sbcInformationModel?: boolean;
  /** Строка таблицы 1 приложения № 2 НЗ № 848/пр. */
  sbcBimObjectGroupId?: number;
  /** РД в форме информационной модели выполняется по ранее утверждённой обычной ПД (п. 24). */
  sbcBimRdFromNonBimPd?: boolean;
  /** Контекстный коэффициент из таблиц 3.3.1, 3.5.1, 3.7.1, 3.11.1 или 3.17.1. */
  sbcNormConditionId?: string;
  /** Натуральный показатель только кондиционируемой части объекта. */
  sbcAirConditionedIndicator?: number;
  /** Стоимость строительства только кондиционируемой части объекта, руб. */
  sbcAirConditionedConstructionCost?: number;
  /** @deprecated Ручной ввод готовой базовой цены, оставлен для совместимости старых расчётов. */
  sbcAirConditioningDesignCost?: number;
  sbcComplexObject?: boolean;
  /** Роль текущей позиции в составе объединённого, встроенного или повторного объекта. */
  sbcComplexRole?: SbcComplexRole;
  /** Согласованный коэффициент сокращённого объёма работ по пп. 152, 170 Методики № 707/пр. */
  sbcComplexRoleCoefficient?: number;
  /** Позиции комплекса, каждая из которых рассчитывается отдельно и затем суммируется. */
  sbcComplexComponents?: SbcComplexComponent[];
  rateMultiplier: number;
  roleStepRate: number;
  useGlobalCoefficient: boolean;
  globalCoefficient: number;
  useGlobalDuration: boolean;
  globalDurationDays: number;
  stageDurations?: Record<string, number>;
  computerCost: number;
  computerSalvageValue: number;
  computerUsefulLifeYears: number;
  insuranceContributionRate: number;
  includeCommon: boolean;
  presetPdOks: boolean;
  presetPdLinear: boolean;
  presetRdFull: boolean;
  presetRdCore: boolean;
  presetRdFrequent: boolean;
}

export interface EstimateLine {
  id: string;
  source: string | null;
  costGroup?: string | null;
  category: string | null;
  section: string | null;
  name: string | null;
  performer: string | null;
  staffRole?: string | null;
  departmentCode: string | null;
  calculationType: CalculationType | null;
  presetPdOks: boolean;
  presetPdLinear: boolean;
  presetRdFull: boolean;
  presetRdCore: boolean;
  presetRdFrequent: boolean;
  common: boolean;
  manualInclude: boolean;
  excluded: boolean;
  workUnits: number;
  chiefUnits?: number;
  leadUnits?: number;
  engineerUnits?: number;
  durationDays: number;
  manualAmount: number;
  coefficient: number;
  comment: string | null;
}

export interface RateGroup {
  code: string;
  group: string | null;
  monthlySalaryMedian: number;
  comment: string | null;
}

export interface PresetSet {
  name: string;
  controlCell: string | null;
  description: string | null;
  exclusionHint: string | null;
  lineIds?: string[];
}

export interface RdReferenceItem {
  number: number | string | null;
  mark: string;
  name: string | null;
  departmentCode: string | null;
  isCore: boolean;
  isFrequentPublicBuilding: boolean;
}

export interface Pp87ReferenceItem {
  type: string;
  number: number | string | null;
  mark: string | null;
  name: string;
  departmentCode: string | null;
  note: string | null;
}

export interface SeedCatalog {
  version: number;
  sourceWorkbook: string;
  projectInput: ProjectInput;
  lines: EstimateLine[];
  rates: RateGroup[];
  rdReference: RdReferenceItem[];
  pp87Reference: Pp87ReferenceItem[];
  presetSets: PresetSet[];
}

export interface Catalog {
  version: number;
  sourceWorkbook: string;
  lines: EstimateLine[];
  rates: RateGroup[];
  rdReference: RdReferenceItem[];
  pp87Reference: Pp87ReferenceItem[];
  presetSets: PresetSet[];
}

export interface CalculatedLine extends EstimateLine {
  selectedByPreset: boolean;
  active: boolean;
  monthlySalaryMedian: number;
  roleMultiplier: number;
  monthlyInsuranceContribution: number;
  monthlyDepreciation: number;
  fotEstimate: number;
  workCost: number;
  withBuffer: number;
  withCommercialCoefficient: number;
  costPerSquareMeter: number;
  warning: string | null;
  order: number | null;
}

export interface EstimateTotals {
  activeRows: number;
  directWorks: number;
  bufferAmount: number;
  totalWithBuffer: number;
  overheadAmount: number;
  totalWithOverhead: number;
  commercialMarkup: number;
  totalWithoutVat: number;
  vatAmount: number;
  totalWithVat: number;
  costWithoutVatPerSquareMeter: number;
  costWithVatPerSquareMeter: number;
  warningCount: number;
  personDays: number;
}

export interface CashFlowRow {
  month: string;
  revenue: number;
  cost: number;
  bankGuaranteeCost: number;
  netCashFlow: number;
  cumulativeCashFlow: number;
}

export interface FinanceSummary {
  advanceAmount: number;
  remainingAmount: number;
  bankGuaranteeAmount: number;
  bankGuaranteeCost: number;
  workMonths: number;
  cashFlow: CashFlowRow[];
}

export interface SbcResult {
  method: SbcCalculationMethod;
  collectionName: string;
  baseYear: string;
  basePrice: number;
  adjustedBasePrice: number;
  currentPriceWithoutVat: number;
  currentPriceWithVat: number;
  pdPriceWithoutVat: number;
  rdPriceWithoutVat: number;
  otherPriceWithoutVat: number;
  normativeDurationDays: number;
  differenceWithoutVat: number;
  differenceWithVat: number;
  ratioToSbc: number;
  notes: string[];
  normativeTrace: {
    valid: boolean;
    ruleCode: string;
    ruleTitle: string;
    formula: string;
    source: string;
    sourcePage?: number;
    baseConstructionCost?: number;
    constructionRebaseCoefficient: number;
    smrSharePercent: number;
    smrShareCoefficient: number;
    normSpecificCoefficient: number;
    normTableCoefficient: number;
    complexRoleCoefficient: number;
    specialStatusCoefficient: number;
    bimPdCoefficient: number;
    bimRdCoefficient: number;
    bimPdAdditionalWithoutVat: number;
    bimRdAdditionalWithoutVat: number;
    airConditioningDesignBasePrice: number;
    airConditioningAdditionalBasePrice: number;
    totalCoefficient: number;
    blockers: string[];
    warnings: string[];
  };
  officialBreakdown?: {
    tableCode: string;
    objectId: string;
    objectName: string;
    page: number;
    stageSourcePage: number;
    pdSharePercent: number;
    rdSharePercent: number;
    pdPublishedTotalPercent: number;
    rdPublishedTotalPercent: number;
    sections: Array<{
      code: string;
      name: string;
      pdSharePercent: number;
      rdSharePercent: number;
      combinedSharePercent: number;
      pdPriceWithoutVat: number;
      rdPriceWithoutVat: number;
      totalPriceWithoutVat: number;
    }>;
    pdUnallocatedWithoutVat: number;
    rdUnallocatedWithoutVat: number;
  };
  complexBreakdown?: {
    componentCount: number;
    components: Array<{
      id: string;
      name: string;
      tableCode: string;
      objectName: string;
      indicator: number;
      indicatorUnit: string;
      role: SbcComplexRole;
      roleCoefficient: number;
      pzuCoefficient: number;
      pzuReductionWithoutVat: number;
      basePrice: number;
      currentPriceWithoutVat: number;
      pdPriceWithoutVat: number;
      rdPriceWithoutVat: number;
      valid: boolean;
      blockers: string[];
    }>;
  };
}

export interface EstimateResult {
  project: ProjectInput;
  catalogVersion: number;
  lines: CalculatedLine[];
  activeLines: CalculatedLine[];
  totals: EstimateTotals;
  finance: FinanceSummary;
  sbc: SbcResult;
  bySource: Record<string, number>;
  byGroup: Record<string, number>;
  groupBreakdown: Array<{
    group: string;
    directWorks: number;
    totalWithoutVat: number;
    costPerSquareMeter: number;
    share: number;
    profit: number;
    profitRate: number;
  }>;
  warnings: string[];
}

export interface EstimateTemplate {
  id: string;
  name: string;
  description?: string;
  catalogVersion?: number;
  project: ProjectInput;
  lines: EstimateLine[];
  rates: RateGroup[];
  createdAt: string;
  updatedAt: string;
}

export interface CalculationSnapshot {
  id: string;
  name: string;
  project: ProjectInput;
  catalog: Catalog;
  result: EstimateResult;
  createdAt: string;
  exportedPath?: string;
}

export interface ExportOptions {
  fileName: string;
  includeAuditSheets: boolean;
}
