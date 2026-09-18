export type PirWorkKind = "ordinary" | "special" | "bim";

export interface PirEstimatePassport {
  constructionName: string;
  customer: string;
  designOrganization: string;
  generalDesigner: string;
  priceLevelQuarter: number;
  priceLevelYear: number;
  estimate2pNumber: string;
  estimate3pNumber: string;
  estimate4pNumber: string;
}

export interface PirQualification {
  id: string;
  title: string;
  equivalentTitle?: string;
  index: number;
  table: "1.3" | "1.4";
}

export interface PirLaborParticipant {
  id: string;
  qualificationId: string;
  actualDays: number;
  headcount: number;
}

export interface PirLaborWork {
  id: string;
  name: string;
  stage: string;
  kind: PirWorkKind;
  plannedDurationDays: number;
  basis: string;
  participants: PirLaborParticipant[];
}

export interface PirLaborInput {
  sourceYear: number;
  averageWorkingDaysPerMonth: number;
  ordinaryMonthlySalary: number;
  specialMonthlySalary: number;
  salarySource: string;
  priceIndex: number;
  priceIndexSource: string;
  profitabilityRate: number;
  salaryShareInCost: number;
  vatRate: number;
  works: PirLaborWork[];
}

export interface PirLaborParticipantResult extends PirLaborParticipant {
  qualification: PirQualification;
  weightedPersonDays: number;
  qualificationContribution: number;
}

export interface PirLaborWorkResult {
  work: PirLaborWork;
  participants: PirLaborParticipantResult[];
  monthlySalary: number;
  averageDailySalary: number;
  averageDailyOutput: number;
  totalHeadcount: number;
  qualificationParticipationCoefficient: number;
  weightedPersonDays: number;
  baseCostWithoutVat: number;
  costWithoutVat: number;
  vatAmount: number;
  costWithVat: number;
  warnings: string[];
  valid: boolean;
}

export interface PirLaborResult {
  works: PirLaborWorkResult[];
  priceIndex: number;
  baseTotalWithoutVat: number;
  totalWithoutVat: number;
  vatAmount: number;
  totalWithVat: number;
  totalWeightedPersonDays: number;
  warningCount: number;
  warnings: string[];
}

export interface PirSummaryExtra {
  id: string;
  name: string;
  characteristic: string;
  reference: string;
  costWithoutVat: number;
}

export interface PirSummaryRow {
  id: string;
  name: string;
  characteristic: string;
  reference: string;
  costWithoutVat: number;
  valid: boolean;
  warnings: string[];
  source: "2p" | "3p" | "4p" | "manual";
}

export interface PirTravelTrip {
  id: string;
  destination: string;
  specialists: number;
  roundTripFarePerPerson: number;
  hotelPerPersonNight: number;
  perDiemPerPersonDay: number;
  tripDays: number;
  hotelNights: number;
  basis: string;
}

export interface PirTravelInput {
  trips: PirTravelTrip[];
}

export interface PirTravelTripResult {
  trip: PirTravelTrip;
  fareTotal: number;
  hotelTotal: number;
  perDiemTotal: number;
  total: number;
  warnings: string[];
}

export interface PirTravelResult {
  trips: PirTravelTripResult[];
  total: number;
  warningCount: number;
}

export const TEXT_QUALIFICATIONS: PirQualification[] = [
  { id: "text-1", title: "Начальник мастерской, отделения, отдела или лаборатории", index: 2.25, table: "1.3" },
  { id: "text-2", title: "Комплексный ГАП, комплексный ГИП или руководитель проекта", equivalentTitle: "главный научный сотрудник", index: 2, table: "1.3" },
  { id: "text-3", title: "Заместитель начальника мастерской, отделения, отдела или лаборатории", index: 1.8, table: "1.3" },
  { id: "text-4", title: "ГАП, ГИП или заведующий сектором", equivalentTitle: "ведущий научный сотрудник", index: 1.6, table: "1.3" },
  { id: "text-5", title: "Главный специалист", equivalentTitle: "старший научный сотрудник", index: 1.32, table: "1.3" },
  { id: "text-6", title: "Руководитель группы, заведующий группой", index: 1.3, table: "1.3" },
  { id: "text-7", title: "Ведущий архитектор, инженер, экономист или специалист", equivalentTitle: "научный сотрудник", index: 1, table: "1.3" },
  { id: "text-8", title: "Архитектор, инженер, экономист или специалист I категории", equivalentTitle: "младший научный сотрудник", index: 0.9, table: "1.3" },
  { id: "text-9", title: "Архитектор, инженер, экономист или специалист II категории", index: 0.75, table: "1.3" },
  { id: "text-10", title: "Архитектор, инженер, экономист или специалист III категории", index: 0.65, table: "1.3" },
  { id: "text-11", title: "Архитектор, инженер, экономист или специалист без категории", index: 0.6, table: "1.3" },
  { id: "text-12", title: "Техник", index: 0.45, table: "1.3" },
];

export const BIM_QUALIFICATIONS: PirQualification[] = [
  { id: "bim-1", title: "ТИМ-эксперт, руководитель отдела ТИМ, ТИМ-директор, ТИМ-консультант", index: 2.5, table: "1.4" },
  { id: "bim-2", title: "ТИМ-менеджер, ведущий или главный специалист отдела ТИМ, менеджер проекта ИМ", index: 2.25, table: "1.4" },
  { id: "bim-3", title: "ТИМ-координатор, специалист отдела ТИМ", index: 1.84, table: "1.4" },
  { id: "bim-4", title: "ТИМ-исполнитель, разработчик или оператор информационной модели, ТИМ-проектировщик", index: 1.75, table: "1.4" },
  { id: "bim-5", title: "ТИМ-мастер, технический специалист, ТИМ-техник", index: 1.42, table: "1.4" },
];

export const DEFAULT_PIR_PASSPORT: PirEstimatePassport = {
  constructionName: "",
  customer: "",
  designOrganization: "",
  generalDesigner: "",
  priceLevelQuarter: Math.floor(new Date().getMonth() / 3) + 1,
  priceLevelYear: new Date().getFullYear(),
  estimate2pNumber: "1",
  estimate3pNumber: "2",
  estimate4pNumber: "3",
};

export function createPirTravelTrip(): PirTravelTrip {
  return {
    id: crypto.randomUUID(),
    destination: "",
    specialists: 1,
    roundTripFarePerPerson: 0,
    hotelPerPersonNight: 0,
    perDiemPerPersonDay: 0,
    tripDays: 0,
    hotelNights: 0,
    basis: "",
  };
}

export const DEFAULT_PIR_TRAVEL_INPUT: PirTravelInput = {
  trips: [createPirTravelTrip()],
};

export function createPirLaborParticipant(kind: PirWorkKind = "ordinary"): PirLaborParticipant {
  return {
    id: crypto.randomUUID(),
    qualificationId: kind === "bim" ? BIM_QUALIFICATIONS[3].id : TEXT_QUALIFICATIONS[7].id,
    actualDays: 0,
    headcount: 1,
  };
}

export function createPirLaborWork(): PirLaborWork {
  return {
    id: crypto.randomUUID(),
    name: "",
    stage: "П",
    kind: "ordinary",
    plannedDurationDays: 0,
    basis: "",
    participants: [createPirLaborParticipant()],
  };
}

export const DEFAULT_PIR_LABOR_INPUT: PirLaborInput = {
  sourceYear: new Date().getFullYear() - 1,
  averageWorkingDaysPerMonth: 0,
  ordinaryMonthlySalary: 0,
  specialMonthlySalary: 0,
  salarySource: "",
  priceIndex: 1,
  priceIndexSource: "",
  profitabilityRate: 0.1,
  salaryShareInCost: 0.4,
  vatRate: 0.22,
  works: [createPirLaborWork()],
};

export function qualificationsForWork(kind: PirWorkKind) {
  return kind === "bim" ? BIM_QUALIFICATIONS : TEXT_QUALIFICATIONS;
}

export function qualificationSourceLabel(qualification: PirQualification) {
  return qualification.equivalentTitle
    ? `${qualification.title}; эквивалентная должность по таблице ${qualification.table}: ${qualification.equivalentTitle}`
    : qualification.title;
}

function russianTripCount(count: number) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  const word = mod10 === 1 && mod100 !== 11
    ? "поездка"
    : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
      ? "поездки"
      : "поездок";
  return `${count} ${word}`;
}

export function workKindLabel(kind: PirWorkKind) {
  if (kind === "bim") return "Информационная модель";
  if (kind === "special") return "Особо опасный, технически сложный или уникальный объект";
  return "Обычная проектная документация";
}

function roundTo(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function calculatePirLabor(input: PirLaborInput): PirLaborResult {
  const workingDays = Math.max(0, input.averageWorkingDaysPerMonth);
  const profitabilityRate = Math.max(0, input.profitabilityRate);
  const salaryShare = Math.max(0, input.salaryShareInCost);
  const vatRate = Math.max(0, input.vatRate);
  const priceIndex = Math.max(0, input.priceIndex ?? 1);

  const works = input.works.map((work): PirLaborWorkResult => {
    const qualifications = qualificationsForWork(work.kind);
    const plannedDuration = Math.max(0, work.plannedDurationDays);
    const participants = work.participants.map((participant) => {
      const qualification = qualifications.find((item) => item.id === participant.qualificationId)
        ?? qualifications[0];
      const actualDays = Math.max(0, participant.actualDays);
      const headcount = Math.max(0, participant.headcount);
      return {
        ...participant,
        actualDays,
        headcount,
        qualification,
        weightedPersonDays: actualDays * headcount * qualification.index,
        qualificationContribution: plannedDuration > 0
          ? roundTo((actualDays / plannedDuration) * headcount * qualification.index, 2)
          : 0,
      };
    });
    const monthlySalary = work.kind === "ordinary"
      ? Math.max(0, input.ordinaryMonthlySalary)
      : Math.max(0, input.specialMonthlySalary);
    const averageDailySalary = workingDays > 0 ? roundTo(monthlySalary / workingDays, 2) : 0;
    const averageDailyOutput = salaryShare > 0
      ? roundTo(averageDailySalary * (1 + profitabilityRate) / salaryShare, 2)
      : 0;
    const totalHeadcount = participants.reduce((sum, item) => sum + item.headcount, 0);
    const weightedPersonDays = participants.reduce((sum, item) => sum + item.weightedPersonDays, 0);
    const qualificationContributionTotal = roundTo(
      participants.reduce((sum, item) => sum + item.qualificationContribution, 0),
      2,
    );
    const qualificationParticipationCoefficient = plannedDuration > 0 && totalHeadcount > 0
      ? roundTo(qualificationContributionTotal / totalHeadcount, 3)
      : 0;
    const baseCostWithoutVat = roundTo(
      averageDailyOutput * plannedDuration * totalHeadcount * qualificationParticipationCoefficient,
      2,
    );
    const costWithoutVat = roundTo(baseCostWithoutVat * priceIndex, 2);
    const vatAmount = costWithoutVat * vatRate;
    const warnings: string[] = [];
    if (!work.name.trim()) warnings.push("Укажите наименование работы.");
    if (!work.basis.trim()) warnings.push("Укажите основание трудозатрат.");
    if (monthlySalary <= 0) warnings.push(`Укажите среднюю зарплату по ОКВЭД ${work.kind === "ordinary" ? "71.11" : "71.12"}.`);
    if (workingDays <= 0) warnings.push("Укажите среднее число рабочих дней в месяце.");
    if (plannedDuration <= 0) warnings.push("Укажите плановую продолжительность.");
    if (participants.length === 0 || weightedPersonDays <= 0) warnings.push("Добавьте исполнителей и дни участия.");
    if (plannedDuration > 0 && participants.some((item) => item.actualDays > plannedDuration)) {
      warnings.push("Время участия исполнителя не может превышать плановую продолжительность работы.");
    }

    return {
      work,
      participants,
      monthlySalary,
      averageDailySalary,
      averageDailyOutput,
      totalHeadcount,
      qualificationParticipationCoefficient,
      weightedPersonDays,
      baseCostWithoutVat,
      costWithoutVat,
      vatAmount,
      costWithVat: costWithoutVat + vatAmount,
      warnings,
      valid: warnings.length === 0,
    };
  });

  const baseTotalWithoutVat = roundTo(works.reduce((sum, item) => sum + item.baseCostWithoutVat, 0), 2);
  const totalWithoutVat = roundTo(works.reduce((sum, item) => sum + item.costWithoutVat, 0), 2);
  const vatAmount = totalWithoutVat * vatRate;
  const warnings: string[] = [];
  if (!input.salarySource.trim()) warnings.push("Укажите источник данных Росстата о средней зарплате.");
  if (input.sourceYear <= 0) warnings.push("Укажите год данных о средней зарплате.");
  if (priceIndex <= 0) warnings.push("Укажите индекс пересчёта стоимости проектных работ.");
  if (!(input.priceIndexSource ?? "").trim()) warnings.push("Укажите источник индекса пересчёта.");
  return {
    works,
    priceIndex,
    baseTotalWithoutVat,
    totalWithoutVat,
    vatAmount,
    totalWithVat: totalWithoutVat + vatAmount,
    totalWeightedPersonDays: works.reduce((sum, item) => sum + item.weightedPersonDays, 0),
    warningCount: warnings.length + works.reduce((sum, item) => sum + item.warnings.length, 0),
    warnings,
  };
}

export function calculatePirTravel(input: PirTravelInput): PirTravelResult {
  const trips = input.trips.map((trip): PirTravelTripResult => {
    const specialists = Math.max(0, trip.specialists);
    const fareTotal = specialists * Math.max(0, trip.roundTripFarePerPerson);
    const hotelTotal = specialists * Math.max(0, trip.hotelPerPersonNight) * Math.max(0, trip.hotelNights);
    const perDiemTotal = specialists * Math.max(0, trip.perDiemPerPersonDay) * Math.max(0, trip.tripDays);
    const warnings: string[] = [];
    if (!trip.destination.trim()) warnings.push("Укажите пункт назначения.");
    if (specialists <= 0) warnings.push("Укажите количество специалистов.");
    if (trip.tripDays <= 0) warnings.push("Укажите продолжительность командировки.");
    if (!trip.basis.trim()) warnings.push("Укажите основание стоимости расходов.");
    if (fareTotal + hotelTotal + perDiemTotal <= 0) warnings.push("Укажите расходы на поездку.");
    return { trip, fareTotal, hotelTotal, perDiemTotal, total: fareTotal + hotelTotal + perDiemTotal, warnings };
  });
  return {
    trips,
    total: trips.reduce((sum, item) => sum + item.total, 0),
    warningCount: trips.reduce((sum, item) => sum + item.warnings.length, 0),
  };
}

export function buildPirSummaryRows(
  passport: PirEstimatePassport,
  form2pName: string,
  form2pCostWithoutVat: number,
  laborResult: PirLaborResult,
  travelResult: PirTravelResult | undefined,
  extras: PirSummaryExtra[],
  vatRate: number,
  form2pDetails?: { basis?: string; calculation?: string },
): PirSummaryRow[] {
  const rows: PirSummaryRow[] = [];
  void vatRate;
  if (form2pCostWithoutVat > 0) {
    rows.push({
      id: "form-2p",
      name: form2pName || passport.constructionName || "Проектные работы по нормативу",
      characteristic: form2pDetails?.basis || "НЗ № 848/пр, выбранные таблица и пункт по данным ФГИС ЦС",
      reference: form2pDetails?.calculation || "Расчёт по выбранному нормативу и индексу текущего периода",
      costWithoutVat: form2pCostWithoutVat,
      valid: true,
      warnings: [],
      source: "2p",
    });
  }
  laborResult.works.forEach((item, index) => {
    if (item.costWithoutVat <= 0) return;
    rows.push({
      id: `form-3p-${item.work.id}`,
      name: item.work.name || `Работа ${index + 1}`,
      characteristic: `Пункт 143 «б», пункт 145 Методики № 707/пр; калькуляция № ${passport.estimate3pNumber || "—"}.${index + 1} по форме 3П`,
      reference: `${item.baseCostWithoutVat.toFixed(2)} × ${laborResult.priceIndex.toFixed(3)} = ${item.costWithoutVat.toFixed(2)} руб.; ${item.work.stage}, ${workKindLabel(item.work.kind)}`,
      costWithoutVat: item.costWithoutVat,
      valid: item.valid && laborResult.warnings.length === 0,
      warnings: [...laborResult.warnings, ...item.warnings],
      source: "3p",
    });
  });
  if (travelResult && travelResult.total > 0) {
    rows.push({
      id: "form-4p",
      name: "Командировочные расходы",
      characteristic: russianTripCount(travelResult.trips.filter((item) => item.total > 0).length),
      reference: `Пункты 146–149 Методики № 707/пр; сметный расчёт № ${passport.estimate4pNumber || "—"} по форме 4П`,
      costWithoutVat: travelResult.total,
      valid: travelResult.warningCount === 0,
      warnings: travelResult.trips.flatMap((item) => item.warnings),
      source: "4p",
    });
  }
  extras.forEach((item) => {
    const costWithoutVat = Math.max(0, item.costWithoutVat);
    rows.push({
      ...item,
      costWithoutVat,
      valid: Boolean(item.name.trim() && item.characteristic.trim() && item.reference.trim() && costWithoutVat > 0),
      warnings: [],
      source: "manual",
    });
  });
  return rows;
}
