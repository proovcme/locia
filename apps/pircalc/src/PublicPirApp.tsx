import { useCallback, useEffect, useMemo, useState } from "react";
import { Calculator, FileSpreadsheet, Plane, Users } from "lucide-react";
import { FgisPirCalculator } from "./components/FgisPirCalculator";
import { PirLaborCalculator, PirPassportFields, PirSummary, PirTravelCalculator } from "./components/PirForms707";
import { calculateSbcResult } from "./domain/calculation";
import {
  DEFAULT_PIR_LABOR_INPUT,
  DEFAULT_PIR_PASSPORT,
  DEFAULT_PIR_TRAVEL_INPUT,
  type PirEstimatePassport,
  type PirLaborInput,
  type PirSummaryExtra,
  type PirTravelInput,
} from "./domain/pirForms";
import type { EstimateTotals, ProjectInput } from "./domain/types";

const publicProjectDefaults: ProjectInput = {
  area: 0,
  vatRate: 0.22,
  commercialCoefficient: 1,
  overheadRate: 0,
  bufferRate: 0,
  advanceRate: 0,
  workStartMonth: "",
  workEndMonth: "",
  bankGuaranteeAnnualRate: 0,
  sbcMethod: "natural",
  sbcCollectionName: "",
  sbcBaseYear: "",
  sbcNaturalIndicator: 0,
  sbcConstantA: 0,
  sbcConstantB: 0,
  sbcConstructionCost: 0,
  sbcDesignPercent: 0.04,
  sbcIndexToCurrent: 1,
  sbcComplexityCoefficient: 1,
  sbcAdjustmentCoefficient: 1,
  sbcPdShare: 0.4,
  sbcRdShare: 0.6,
  sbcBaseDurationDays: 0,
  sbcDurationCoefficient: 1,
  sbcFgisKind: "design",
  sbcFgisNormGuid: "",
  sbcFgisPeriodId: 426,
  sbcFgisPeriodLabel: "2 квартал 2026 г.",
  sbcFgisApprovingAct: "",
  sbcFgisSourceUrl: "",
  sbcFgisCatalogSha256: "",
  sbcCalculationDate: new Date().toISOString().slice(0, 10),
  rateMultiplier: 0,
  roleStepRate: 0,
  useGlobalCoefficient: false,
  globalCoefficient: 1,
  useGlobalDuration: false,
  globalDurationDays: 0,
  computerCost: 0,
  computerSalvageValue: 0,
  computerUsefulLifeYears: 0,
  insuranceContributionRate: 0,
  includeCommon: false,
  presetPdOks: false,
  presetPdLinear: false,
  presetRdFull: false,
  presetRdCore: false,
  presetRdFrequent: false,
};

const emptyTotals: EstimateTotals = {
  directWorks: 0,
  bufferAmount: 0,
  totalWithBuffer: 0,
  overheadAmount: 0,
  totalWithOverhead: 0,
  commercialMarkup: 0,
  totalWithoutVat: 0,
  vatAmount: 0,
  totalWithVat: 0,
  costWithoutVatPerSquareMeter: 0,
  costWithVatPerSquareMeter: 0,
  activeRows: 0,
  warningCount: 0,
  personDays: 0,
};

type PirPublicMode = "normative" | "3p" | "4p" | "2p";

interface PublicPirWorkspace {
  project: ProjectInput;
  passport: PirEstimatePassport;
  labor: PirLaborInput;
  travel: PirTravelInput;
  summaryExtras: PirSummaryExtra[];
  summaryIncludedIds: string[];
}

const publicWorkspaceKey = "ovc-pir-forms-v1";

function priceLevelFromFgis(project: ProjectInput) {
  const match = project.sbcFgisPeriodLabel.match(/([1-4])\s+квартал\s+(\d{4})/i);
  if (!match) return null;
  return { quarter: Number(match[1]), year: Number(match[2]) };
}

function loadPublicWorkspace(): PublicPirWorkspace {
  try {
    const stored = JSON.parse(localStorage.getItem(publicWorkspaceKey) ?? "null") as Partial<PublicPirWorkspace> | null;
    const project = { ...publicProjectDefaults, ...(stored?.project ?? {}) };
    const fgisPriceLevel = priceLevelFromFgis(project);
    return {
      project,
      passport: {
        ...DEFAULT_PIR_PASSPORT,
        priceLevelQuarter: stored?.passport?.priceLevelQuarter ?? fgisPriceLevel?.quarter ?? DEFAULT_PIR_PASSPORT.priceLevelQuarter,
        priceLevelYear: stored?.passport?.priceLevelYear ?? fgisPriceLevel?.year ?? DEFAULT_PIR_PASSPORT.priceLevelYear,
        ...(stored?.passport ?? {}),
      },
      labor: {
        ...DEFAULT_PIR_LABOR_INPUT,
        ...(stored?.labor ?? {}),
        works: stored?.labor?.works?.length ? stored.labor.works : DEFAULT_PIR_LABOR_INPUT.works,
      },
      travel: {
        ...DEFAULT_PIR_TRAVEL_INPUT,
        ...(stored?.travel ?? {}),
        trips: stored?.travel?.trips?.length ? stored.travel.trips : DEFAULT_PIR_TRAVEL_INPUT.trips,
      },
      summaryExtras: stored?.summaryExtras ?? [],
      summaryIncludedIds: stored?.summaryIncludedIds ?? [],
    };
  } catch {
    return { project: publicProjectDefaults, passport: DEFAULT_PIR_PASSPORT, labor: DEFAULT_PIR_LABOR_INPUT, travel: DEFAULT_PIR_TRAVEL_INPUT, summaryExtras: [], summaryIncludedIds: [] };
  }
}

export function PublicPirApp() {
  const initial = useMemo(loadPublicWorkspace, []);
  const [mode, setMode] = useState<PirPublicMode>("normative");
  const [project, setProject] = useState<ProjectInput>(initial.project);
  const [passport, setPassport] = useState<PirEstimatePassport>(initial.passport);
  const [labor, setLabor] = useState<PirLaborInput>(initial.labor);
  const [travel, setTravel] = useState<PirTravelInput>(initial.travel);
  const [summaryExtras, setSummaryExtras] = useState<PirSummaryExtra[]>(initial.summaryExtras);
  const [summaryIncludedIds, setSummaryIncludedIds] = useState<string[]>(initial.summaryIncludedIds);
  const [exporting, setExporting] = useState(false);
  const patchProject = useCallback((patch: Partial<ProjectInput>) => {
    setProject((current) => ({ ...current, ...patch }));
  }, []);
  const result = useMemo(() => calculateSbcResult(project, emptyTotals), [project]);
  const draftResult = useMemo(
    () => calculateSbcResult({ ...project, sbcComplexComponents: undefined }, emptyTotals),
    [project],
  );
  useEffect(() => {
    localStorage.setItem(publicWorkspaceKey, JSON.stringify({ project, passport, labor, travel, summaryExtras, summaryIncludedIds } satisfies PublicPirWorkspace));
  }, [project, passport, labor, travel, summaryExtras, summaryIncludedIds]);

  const patchPassport = useCallback((patch: Partial<PirEstimatePassport>) => {
    setPassport((current) => ({ ...current, ...patch }));
  }, []);

  const exportNormativeCalculation = useCallback(async () => {
    setExporting(true);
    try {
      const { downloadPublicPirWorkbook } = await import("./services/publicPirExcel");
      await downloadPublicPirWorkbook(project, result, passport);
    } finally {
      setExporting(false);
    }
  }, [passport, project, result]);

  const export2p = useCallback(async () => {
    setExporting(true);
    try {
      const { downloadPirSummaryWorkbook } = await import("./services/pirFormsExcel");
      await downloadPirSummaryWorkbook(
        passport,
        result,
        result.officialBreakdown?.objectName ?? project.sbcFgisObjectName ?? "Нормативный расчёт",
        labor,
        travel,
        summaryExtras,
        summaryIncludedIds,
        true,
      );
    } finally {
      setExporting(false);
    }
  }, [labor, passport, project.sbcFgisObjectName, result, summaryExtras, summaryIncludedIds, travel]);

  const export3p = useCallback(async () => {
    setExporting(true);
    try {
      const { downloadPirLaborWorkbook } = await import("./services/pirFormsExcel");
      await downloadPirLaborWorkbook(passport, labor);
    } finally {
      setExporting(false);
    }
  }, [labor, passport]);

  const export4p = useCallback(async () => {
    setExporting(true);
    try {
      const { downloadPirTravelWorkbook } = await import("./services/pirFormsExcel");
      await downloadPirTravelWorkbook(passport, travel);
    } finally {
      setExporting(false);
    }
  }, [passport, travel]);

  return (
    <div className="public-pir-shell">
      <header className="public-pir-header">
        <a className="public-pir-brand" href="https://les.ovc.me/">
          <strong>Л.Е.С.</strong>
          <span>Расчёт стоимости проектных работ</span>
        </a>
        <nav aria-label="Источники">
          <a href="https://fgiscs.minstroyrf.ru/frsn/pir/methods" target="_blank" rel="noreferrer">ФГИС ЦС</a>
          <a href="https://gge.ru/press-center/news/vse-piry-vo-fgis-tss/" target="_blank" rel="noreferrer">Главгосэкспертиза</a>
        </nav>
      </header>

      <main className="public-pir-main">
        <section className="pir-document-switcher" aria-label="Сметные формы">
          <div>
            <span className="fgis-kicker">РАСЧЁТ СТОИМОСТИ ПРОЕКТНЫХ РАБОТ</span>
            <h1>Формы 2П, 3П и 4П</h1>
            <p>Сначала рассчитайте стоимость нормативом или по трудозатратам, затем включите нужные строки в смету 2П.</p>
          </div>
          <div className="pir-document-tabs" role="tablist">
            <button className={mode === "normative" ? "active" : ""} onClick={() => setMode("normative")}><Calculator size={18} /><span><b>Норматив</b><small>Расчёт по ФГИС</small></span></button>
            <button className={mode === "3p" ? "active" : ""} onClick={() => setMode("3p")}><Users size={18} /><span><b>3П</b><small>По трудозатратам</small></span></button>
            <button className={mode === "4p" ? "active" : ""} onClick={() => setMode("4p")}><Plane size={18} /><span><b>4П</b><small>Командировки</small></span></button>
            <button className={mode === "2p" ? "active" : ""} onClick={() => setMode("2p")}><FileSpreadsheet size={18} /><span><b>2П</b><small>Итоговая смета</small></span></button>
          </div>
        </section>

        <PirPassportFields value={passport} onChange={patchPassport} />

        {mode === "normative" ? (
          <div className="pir-form-panel">
            <div className="pir-current-form"><span>Источник строки 2П</span><b>Нормативный расчёт по данным ФГИС ЦС</b></div>
            <FgisPirCalculator project={project} result={result} draftResult={draftResult} onChange={patchProject} onExport={exportNormativeCalculation} exporting={exporting} fixedNormGuid="b90117ab-5223-4a7a-89ae-a8bcbb88f689" />
          </div>
        ) : null}
        {mode === "3p" ? <PirLaborCalculator input={labor} onChange={setLabor} exporting={exporting} onExport={export3p} /> : null}
        {mode === "4p" ? <PirTravelCalculator input={travel} onChange={setTravel} exporting={exporting} onExport={export4p} /> : null}
        {mode === "2p" ? <PirSummary passport={passport} form2pResult={result} form2pName={result.officialBreakdown?.objectName ?? project.sbcFgisObjectName ?? ""} laborInput={labor} travelInput={travel} extras={summaryExtras} onExtrasChange={setSummaryExtras} includedRowIds={summaryIncludedIds} onIncludedRowIdsChange={setSummaryIncludedIds} exporting={exporting} onExport={export2p} official /> : null}
      </main>

      <footer className="public-pir-footer">
        Расчёты предназначены для обоснования стоимости проектных работ. Перед применением проверьте исходные данные и основания по официальным документам. Контакты: OVC.me.
      </footer>
    </div>
  );
}
