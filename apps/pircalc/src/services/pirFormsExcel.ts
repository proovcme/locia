import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import {
  buildPirSummaryRows,
  calculatePirLabor,
  calculatePirTravel,
  qualificationSourceLabel,
  workKindLabel,
  type PirEstimatePassport,
  type PirLaborInput,
  type PirSummaryExtra,
  type PirSummaryRow,
  type PirTravelInput,
} from "../domain/pirForms";
import type { SbcResult } from "../domain/types";

const rub = '#,##0.00" ₽"';
const percent = "0.00%";

function styleTitle(cell: ExcelJS.Cell) {
  cell.font = { bold: true, size: 16, color: { argb: "FF172033" } };
}

function styleHeader(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFA72525" } };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
}

function setWidths(sheet: ExcelJS.Worksheet, widths: number[]) {
  widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
}

function addPassport(sheet: ExcelJS.Worksheet, passport: PirEstimatePassport, formLabel: string, lastColumn: string) {
  const rows: Array<[string, string | number]> = [
    ["Форма", formLabel],
    ["Наименование стройки", passport.constructionName],
    ["Заказчик", passport.customer],
    ["Проектная организация", passport.designOrganization],
    ["Генеральный проектировщик", passport.generalDesigner],
    ["Уровень цен", `${passport.priceLevelQuarter} квартал ${passport.priceLevelYear} г.`],
  ];
  rows.forEach(([label, value], index) => {
    const row = index + 3;
    sheet.mergeCells(`A${row}:B${row}`);
    sheet.mergeCells(`C${row}:${lastColumn}${row}`);
    sheet.getCell(`A${row}`).value = label;
    sheet.getCell(`C${row}`).value = value;
    sheet.getCell(`A${row}`).font = { bold: true, color: { argb: "FF7F1D1D" } };
  });
}

function finishWorkbook(workbook: ExcelJS.Workbook) {
  workbook.eachSheet((sheet) => {
    sheet.eachRow((row) => row.eachCell((cell) => {
      cell.alignment = { vertical: "middle", wrapText: true };
    }));
    sheet.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  });
}

function addSourceSheet(workbook: ExcelJS.Workbook, laborInput: PirLaborInput) {
  const source = workbook.addWorksheet("Источники", { views: [{ showGridLines: false }] });
  source.getCell("A1").value = "Основания расчёта по форме 3П";
  styleTitle(source.getCell("A1"));
  source.mergeCells("A1:C1");
  source.getRow(3).values = ["Показатель", "Значение", "Как применяется"];
  styleHeader(source.getRow(3));
  source.addRows([
    ["Методика", "Приказ Минстроя России от 01.10.2021 № 707/пр", "Пункты 143 и 145, приложение № 2, рекомендуемый образец формы 3П в приложении № 7."],
    ["Год данных о зарплате", laborInput.sourceYear, "Год, предшествующий году составления сметы."],
    ["Средняя зарплата по ОКВЭД 71.11", laborInput.ordinaryMonthlySalary, "Для обычной проектной документации."],
    ["Средняя зарплата по ОКВЭД 71.12", laborInput.specialMonthlySalary, "Для особо опасных, технически сложных и уникальных объектов, а также информационной модели."],
    ["Рабочих дней в месяце", laborInput.averageWorkingDaysPerMonth, "Среднее за год по производственному календарю."],
    ["Источник зарплаты", laborInput.salarySource, "Ссылка или реквизиты официальной публикации Росстата."],
    ["Индекс пересчёта", laborInput.priceIndex, "Перевод результата калькуляции в целевой квартал сметы."],
    ["Источник индекса", laborInput.priceIndexSource, "Письмо Минстроя России об индексах изменения сметной стоимости проектных работ."],
    ["Доля зарплаты в себестоимости Кз", laborInput.salaryShareInCost, "Норматив 0,4 по пункту 145 Методики."],
    ["Рентабельность Р", laborInput.profitabilityRate, "10% по таблице 1.2 приложения № 2."],
    ["Контакты", "OVC.me", "Вопросы по применению калькулятора."],
  ]);
  source.getCell("B6").numFmt = rub;
  source.getCell("B7").numFmt = rub;
  source.getCell("B12").numFmt = percent;
  source.getCell("B13").numFmt = percent;
  setWidths(source, [38, 54, 82]);
}

export async function buildPirLaborWorkbook(passport: PirEstimatePassport, input: PirLaborInput): Promise<Uint8Array> {
  const result = calculatePirLabor(input);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "OVC.me";
  workbook.created = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;

  const form = workbook.addWorksheet("Форма 3П", { views: [{ showGridLines: false }] });
  form.getCell("A1").value = `Смета № ${passport.estimate3pNumber || "—"} на проектные работы по калькуляции затрат (форма 3П)`;
  styleTitle(form.getCell("A1"));
  form.mergeCells("A1:J1");
  addPassport(form, passport, "3П", "J");
  let row = 11;
  const laborCostRows: number[] = [];
  result.works.forEach((workResult, index) => {
    form.getCell(`A${row}`).value = `Калькуляция ${passport.estimate3pNumber || "—"}.${index + 1}: ${workResult.work.name || "Наименование не указано"}`;
    form.getCell(`A${row}`).font = { bold: true, size: 13, color: { argb: "FF7F1D1D" } };
    form.mergeCells(`A${row}:J${row}`);
    row += 1;
    form.getCell(`A${row}`).value = `${workResult.work.stage} · ${workKindLabel(workResult.work.kind)} · основание: ${workResult.work.basis || "не указано"}`;
    form.mergeCells(`A${row}:J${row}`);
    row += 2;
    form.getRow(row).values = ["№ п/п", "Наименование должностей исполнителей", "Фактическое время участия Тф, дни", "Плановая продолжительность Тп, дни", "Численность исполнителей одной квалификации, чел.", "Индекс уровня квалификации", "Коэффициент квалификации (участия)"];
    styleHeader(form.getRow(row));
    const participantStart = row + 1;
    workResult.participants.forEach((participant, participantIndex) => {
      const current = participantStart + participantIndex;
      const contribution = participant.qualificationContribution;
      form.getRow(current).values = [
        participantIndex + 1,
        qualificationSourceLabel(participant.qualification),
        participant.actualDays,
        workResult.work.plannedDurationDays,
        participant.headcount,
        participant.qualification.index,
        contribution,
      ];
      form.getCell(`G${current}`).value = {
        formula: `IFERROR(ROUND(C${current}/D${current}*E${current}*F${current},2),0)`,
        result: contribution,
      };
      form.getCell(`G${current}`).numFmt = "0.000";
      form.getCell(`H${current}`).numFmt = "0.000";
    });
    row = participantStart + Math.max(1, workResult.participants.length);
    form.getRow(row).values = ["", "ИТОГО", "", workResult.work.plannedDurationDays, workResult.totalHeadcount, "", workResult.qualificationParticipationCoefficient];
    if (workResult.participants.length) {
      const participantEnd = participantStart + workResult.participants.length - 1;
      form.getCell(`E${row}`).value = { formula: `SUM(E${participantStart}:E${participantEnd})`, result: workResult.totalHeadcount };
      form.getCell(`G${row}`).value = { formula: `IFERROR(ROUND(SUM(G${participantStart}:G${participantEnd})/E${row},3),0)`, result: workResult.qualificationParticipationCoefficient };
    }
    form.getRow(row).font = { bold: true };
    form.getCell(`G${row}`).numFmt = "0.000";
    form.getCell(`H${row}`).numFmt = "0.000";
    row += 2;
    form.getRow(row).values = ["Средняя зарплата, ₽/мес.", "Рабочих дней/мес.", "Средняя дневная зарплата", "Кз", "Рентабельность", "Средняя дневная выработка", "Тп", "Численность", "Ккв-уч", "Стоимость без НДС"];
    styleHeader(form.getRow(row));
    row += 1;
    form.getRow(row).values = [
      workResult.monthlySalary,
      input.averageWorkingDaysPerMonth,
      workResult.averageDailySalary,
      input.salaryShareInCost,
      input.profitabilityRate,
      workResult.averageDailyOutput,
      workResult.work.plannedDurationDays,
      workResult.totalHeadcount,
      workResult.qualificationParticipationCoefficient,
      workResult.baseCostWithoutVat,
    ];
    form.getCell(`C${row}`).value = { formula: `IFERROR(ROUND(A${row}/B${row},2),0)`, result: workResult.averageDailySalary };
    form.getCell(`F${row}`).value = { formula: `IFERROR(ROUND(C${row}*(1+D${row})/E${row},2),0)`, result: workResult.averageDailyOutput };
    form.getCell(`J${row}`).value = { formula: `ROUND(F${row}*G${row}*H${row}*I${row},2)`, result: workResult.baseCostWithoutVat };
    laborCostRows.push(row);
    ["A", "C", "F", "J"].forEach((column) => { form.getCell(`${column}${row}`).numFmt = rub; });
    form.getCell(`D${row}`).numFmt = percent;
    form.getCell(`E${row}`).numFmt = percent;
    form.getCell(`I${row}`).numFmt = "0.000";
    row += 3;
  });
  form.getCell(`H${row}`).value = "Итого по калькуляциям";
  form.getCell(`J${row}`).value = laborCostRows.length
    ? { formula: laborCostRows.map((current) => `J${current}`).join("+"), result: result.baseTotalWithoutVat }
    : result.baseTotalWithoutVat;
  [row].forEach((current) => {
    form.getCell(`H${current}`).font = { bold: true };
    form.getCell(`J${current}`).font = { bold: true };
    form.getCell(`J${current}`).numFmt = rub;
  });
  form.mergeCells(`A${row + 5}:D${row + 5}`);
  form.mergeCells(`A${row + 6}:D${row + 6}`);
  form.mergeCells(`F${row + 5}:J${row + 5}`);
  form.mergeCells(`F${row + 6}:J${row + 6}`);
  form.getCell(`A${row + 5}`).value = "Руководитель проектной организации ____________________";
  form.getCell(`A${row + 6}`).value = "Главный инженер проекта ______________________________";
  form.getCell(`F${row + 5}`).value = "Начальник отдела _____________________________________";
  form.getCell(`F${row + 6}`).value = "Заказчик _____________________________________________";
  setWidths(form, [18, 60, 14, 14, 16, 12, 18, 20, 14, 38]);

  const rebase = workbook.addWorksheet("Пересчёт в 2П", { views: [{ showGridLines: false }] });
  rebase.getCell("A1").value = "Пересчёт результатов калькуляций 3П для включения в форму 2П";
  styleTitle(rebase.getCell("A1"));
  rebase.mergeCells("A1:E1");
  rebase.getRow(3).values = ["Калькуляция", "Стоимость 3П в исходном уровне цен", "Индекс пересчёта", "Стоимость в целевом квартале", "Источник индекса"];
  styleHeader(rebase.getRow(3));
  result.works.forEach((workResult, index) => {
    const current = index + 4;
    rebase.getRow(current).values = [`${passport.estimate3pNumber || "—"}.${index + 1} · ${workResult.work.name}`, workResult.baseCostWithoutVat, input.priceIndex, workResult.costWithoutVat, input.priceIndexSource];
    rebase.getCell(`D${current}`).value = { formula: `ROUND(B${current}*C${current},2)`, result: workResult.costWithoutVat };
    rebase.getCell(`B${current}`).numFmt = rub;
    rebase.getCell(`C${current}`).numFmt = "0.000";
    rebase.getCell(`D${current}`).numFmt = rub;
  });
  setWidths(rebase, [42, 26, 18, 26, 68]);

  const detail = workbook.addWorksheet("Трудозатраты", { views: [{ showGridLines: false, state: "frozen", ySplit: 4 }] });
  detail.getCell("A1").value = "Подробная ведомость трудозатрат";
  styleTitle(detail.getCell("A1"));
  detail.mergeCells("A1:M1");
  detail.getCell("A2").value = "Формулы 8.12–8.14 Методики № 707/пр. Каждая строка сохраняет исходные данные и расчётный вклад.";
  detail.mergeCells("A2:M2");
  detail.getRow(4).values = ["Калькуляция", "Работа", "Стадия", "Характер", "Должность", "Тф", "Тп", "Численность", "Индекс", "Взвешенные чел.-дни", "Средняя дневная выработка", "Стоимость", "Основание"];
  styleHeader(detail.getRow(4));
  let detailRow = 5;
  result.works.forEach((workResult, workIndex) => workResult.participants.forEach((participant) => {
    detail.getRow(detailRow).values = [
      `${passport.estimate3pNumber || "—"}.${workIndex + 1}`,
      workResult.work.name,
      workResult.work.stage,
      workKindLabel(workResult.work.kind),
      qualificationSourceLabel(participant.qualification),
      participant.actualDays,
      workResult.work.plannedDurationDays,
      participant.headcount,
      participant.qualification.index,
      participant.weightedPersonDays,
      workResult.averageDailyOutput,
      participant.weightedPersonDays * workResult.averageDailyOutput,
      workResult.work.basis,
    ];
    detail.getCell(`K${detailRow}`).numFmt = rub;
    detail.getCell(`L${detailRow}`).numFmt = rub;
    detailRow += 1;
  }));
  setWidths(detail, [16, 38, 16, 32, 58, 10, 10, 14, 10, 20, 24, 22, 48]);
  addSourceSheet(workbook, input);
  finishWorkbook(workbook);
  const data = await workbook.xlsx.writeBuffer();
  return data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data);
}

export async function buildPirTravelWorkbook(passport: PirEstimatePassport, input: PirTravelInput): Promise<Uint8Array> {
  const result = calculatePirTravel(input);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "OVC.me";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Форма 4П", { views: [{ showGridLines: false }] });
  sheet.getCell("A1").value = `Сметный расчёт № ${passport.estimate4pNumber || "—"} на командировочные расходы (форма 4П)`;
  styleTitle(sheet.getCell("A1"));
  sheet.mergeCells("A1:I1");
  addPassport(sheet, passport, "4П", "I");
  sheet.getRow(11).values = ["№ п/п", "Пункт назначения", "Количество специалистов", "Проезд к месту командировки (туда и обратно)", "Проживание в номере гостиницы класса «3 звезды», 1 чел./сутки", "Суточные, 1 сутки/руб.", "Продолжительность командировки, сутки", "Продолжительность проживания в гостинице, сутки", "Итого затрат, рубли"];
  styleHeader(sheet.getRow(11));
  result.trips.forEach((tripResult, index) => {
    const row = index + 12;
    const trip = tripResult.trip;
    sheet.getRow(row).values = [index + 1, trip.destination, trip.specialists, trip.roundTripFarePerPerson, trip.hotelPerPersonNight, trip.perDiemPerPersonDay, trip.tripDays, trip.hotelNights, tripResult.total];
    sheet.getCell(`I${row}`).value = { formula: `C${row}*(D${row}+E${row}*H${row}+F${row}*G${row})`, result: tripResult.total };
    ["D", "E", "F", "I"].forEach((column) => { sheet.getCell(`${column}${row}`).numFmt = rub; });
  });
  const totalRow = result.trips.length + 12;
  sheet.getRow(totalRow).values = ["", "ИТОГО ПО СМЕТНОМУ РАСЧЁТУ", "", "", "", "", "", "", result.total];
  if (result.trips.length) sheet.getCell(`I${totalRow}`).value = { formula: `SUM(I12:I${totalRow - 1})`, result: result.total };
  sheet.getRow(totalRow).font = { bold: true };
  sheet.getCell(`I${totalRow}`).numFmt = rub;
  sheet.getCell(`A${totalRow + 2}`).value = "Расходы определяются на момент составления расчёта. Понесённые расходы подтверждаются заверенными копиями финансовых документов.";
  sheet.mergeCells(`A${totalRow + 2}:I${totalRow + 2}`);
  sheet.mergeCells(`A${totalRow + 4}:D${totalRow + 4}`);
  sheet.mergeCells(`A${totalRow + 5}:D${totalRow + 5}`);
  sheet.mergeCells(`F${totalRow + 4}:I${totalRow + 4}`);
  sheet.mergeCells(`F${totalRow + 5}:I${totalRow + 5}`);
  sheet.getCell(`A${totalRow + 4}`).value = "Руководитель проектной организации ____________________";
  sheet.getCell(`A${totalRow + 5}`).value = "Главный инженер проекта ______________________________";
  sheet.getCell(`F${totalRow + 4}`).value = "Начальник отдела _____________________________________";
  sheet.getCell(`F${totalRow + 5}`).value = "Заказчик _____________________________________________";
  setWidths(sheet, [8, 28, 14, 22, 25, 20, 18, 18, 20]);

  const source = workbook.addWorksheet("Основания", { views: [{ showGridLines: false }] });
  source.getCell("A1").value = "Основания расчёта по форме 4П";
  styleTitle(source.getCell("A1"));
  source.mergeCells("A1:C1");
  source.getRow(3).values = ["Документ", "Положение", "Как применяется"];
  styleHeader(source.getRow(3));
  source.addRows([
    ["Методика № 707/пр", "Пункты 146–149, приложение № 7", "Командировочные расходы рассчитываются отдельно от стоимости проектных работ."],
    ["Трудовой кодекс РФ", "Статья 168", "Определяет возмещаемые расходы при служебной командировке."],
    ["Постановление Правительства РФ № 749", "Действующая редакция", "Расходы на проезд и проживание принимаются на момент составления расчёта."],
    ["Подтверждающие документы", "Счета, билеты, счета-фактуры, чеки", "Копии заверяются уполномоченными лицами проектной организации."],
    ...input.trips.map((trip, index) => [`Основание поездки ${index + 1}`, trip.basis, trip.destination]),
    ["Контакты", "OVC.me", "Вопросы по применению калькулятора."],
  ]);
  setWidths(source, [38, 42, 82]);
  finishWorkbook(workbook);
  const data = await workbook.xlsx.writeBuffer();
  return data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data);
}

function addSummaryRows(sheet: ExcelJS.Worksheet, rows: PirSummaryRow[], official: boolean) {
  sheet.getRow(11).values = ["№ п/п", "Наименование объекта проектирования или вида проектных работ", "Наименование, номера глав, таблиц, параграфов и пунктов НЗ на проектные работы", "Расчёт стоимости", "Сметная стоимость, руб."];
  styleHeader(sheet.getRow(11));
  rows.forEach((row, index) => {
    const current = index + 12;
    sheet.getRow(current).values = [index + 1, row.name, row.characteristic, row.reference, row.costWithoutVat];
    sheet.getCell(`E${current}`).numFmt = rub;
  });
  const total = rows.length + 12;
  const summaryTotal = rows.reduce((sum, item) => sum + item.costWithoutVat, 0);
  sheet.getRow(total).values = ["", official ? "ИТОГО БЕЗ УЧЁТА НДС" : "ИТОГО ПО СВОДУ ПРОЕКТА БЕЗ НДС", "", "", summaryTotal];
  if (rows.length) sheet.getCell(`E${total}`).value = { formula: `SUM(E12:E${total - 1})`, result: summaryTotal };
  sheet.getRow(total).font = { bold: true };
  sheet.getCell(`E${total}`).numFmt = rub;
  sheet.getCell(`A${total + 2}`).value = official
    ? "Рекомендуемый образец формы 2П по приложению № 7 к Методике № 707/пр. Итог приведён без учёта НДС. Контакты: OVC.me"
    : "Пользовательский свод не является отдельной нормативной формой приложения № 7. Контакты: OVC.me";
  sheet.mergeCells(`A${total + 2}:E${total + 2}`);
  sheet.mergeCells(`A${total + 4}:C${total + 4}`);
  sheet.mergeCells(`A${total + 5}:C${total + 5}`);
  sheet.mergeCells(`D${total + 4}:E${total + 4}`);
  sheet.getCell(`A${total + 4}`).value = "Руководитель организации ______________________________";
  sheet.getCell(`A${total + 5}`).value = "Составил ______________________________________________";
  sheet.getCell(`D${total + 4}`).value = "Проверил ______________________________________________";
}

function addNormativeCalculationSheets(workbook: ExcelJS.Workbook, result: SbcResult) {
  const calculation = workbook.addWorksheet("Расчёт по нормативу", { views: [{ showGridLines: false }] });
  calculation.getCell("A1").value = "Расшифровка нормативного расчёта строки формы 2П";
  styleTitle(calculation.getCell("A1"));
  calculation.mergeCells("A1:C1");
  calculation.getRow(3).values = ["Показатель", "Значение", "Основание или применение"];
  styleHeader(calculation.getRow(3));
  calculation.addRows([
    ["Норматив", result.collectionName, result.normativeTrace.source],
    ["Правило", result.normativeTrace.ruleCode, result.normativeTrace.ruleTitle],
    ["Формула", result.normativeTrace.formula, "Расчёт по выбранной таблице и натуральному показателю"],
    ["Базовая цена", result.basePrice, "До пересчёта в текущий уровень цен"],
    ["Общий коэффициент", result.normativeTrace.totalCoefficient, "Произведение применимых нормативных коэффициентов"],
    ["Цена с коэффициентами", result.adjustedBasePrice, "Базовая цена с условиями проектирования"],
    ["Текущая стоимость без НДС", result.currentPriceWithoutVat, "Сумма для включения в форму 2П"],
    ["ПД без НДС", result.pdPriceWithoutVat, "Проектная документация"],
    ["РД без НДС", result.rdPriceWithoutVat, "Рабочая документация"],
    ["Контроль", result.normativeTrace.valid ? "Расчёт допустим" : "Расчёт остановлен", result.normativeTrace.blockers.join("; ")],
    ["Предупреждения", result.normativeTrace.warnings.join("; "), "Условия, требующие подтверждения"],
  ]);
  [7, 9, 10, 11, 12].forEach((row) => { calculation.getCell(`B${row}`).numFmt = rub; });
  setWidths(calculation, [34, 58, 82]);

  if (!result.officialBreakdown) return;
  const sections = workbook.addWorksheet("Разделы", { views: [{ showGridLines: false, state: "frozen", ySplit: 4 }] });
  sections.getCell("A1").value = "Стоимость по стадиям и разделам";
  styleTitle(sections.getCell("A1"));
  sections.mergeCells("A1:G1");
  sections.getCell("A2").value = `Таблица ${result.officialBreakdown.tableCode}, стр. ${result.officialBreakdown.page}: ${result.officialBreakdown.objectName}`;
  sections.mergeCells("A2:G2");
  sections.getRow(4).values = ["Раздел", "Наименование", "Доля ПД", "ПД без НДС", "Доля РД", "РД без НДС", "Всего без НДС"];
  styleHeader(sections.getRow(4));
  result.officialBreakdown.sections.forEach((section, index) => {
    const row = index + 5;
    sections.getRow(row).values = [section.code, section.name, section.pdSharePercent / 100, section.pdPriceWithoutVat, section.rdSharePercent / 100, section.rdPriceWithoutVat, section.totalPriceWithoutVat];
    sections.getCell(`C${row}`).numFmt = percent;
    sections.getCell(`E${row}`).numFmt = percent;
    ["D", "F", "G"].forEach((column) => { sections.getCell(`${column}${row}`).numFmt = rub; });
  });
  setWidths(sections, [14, 58, 14, 22, 14, 22, 24]);
}

export async function buildPirSummaryWorkbook(
  passport: PirEstimatePassport,
  form2pResult: SbcResult,
  form2pName: string,
  laborInput: PirLaborInput,
  travelInput: PirTravelInput,
  extras: PirSummaryExtra[],
  includedRowIds?: string[],
  official = false,
): Promise<Uint8Array> {
  const laborResult = calculatePirLabor(laborInput);
  const travelResult = calculatePirTravel(travelInput);
  const allRows = buildPirSummaryRows(
    passport,
    form2pName,
    form2pResult.currentPriceWithoutVat,
    laborResult,
    travelResult,
    extras,
    laborInput.vatRate,
    {
      basis: `${form2pResult.collectionName}; ${form2pResult.normativeTrace.source}`,
      calculation: `${form2pResult.normativeTrace.formula}; итог ${form2pResult.currentPriceWithoutVat.toFixed(2)} руб.`,
    },
  );
  const rows = (includedRowIds ? allRows.filter((row) => includedRowIds.includes(row.id)) : allRows)
    .filter((row) => !official || row.source !== "4p");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "OVC.me";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(official ? "Форма 2П" : "Свод проекта", { views: [{ showGridLines: false }] });
  sheet.getCell("A1").value = official
    ? `Смета № ${passport.estimate2pNumber || "—"} на проектные работы (форма 2П)`
    : "Сводный расчёт стоимости проектных работ";
  styleTitle(sheet.getCell("A1"));
  sheet.mergeCells("A1:E1");
  addPassport(sheet, passport, official ? "2П" : "Пользовательский свод проекта", "E");
  addSummaryRows(sheet, rows, official);
  setWidths(sheet, [8, 44, 64, 60, 24]);
  if (official) addNormativeCalculationSheets(workbook, form2pResult);
  addSourceSheet(workbook, laborInput);
  finishWorkbook(workbook);
  const data = await workbook.xlsx.writeBuffer();
  return data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data);
}

async function download(bytes: Uint8Array, fileName: string) {
  const blobData = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  saveAs(new Blob([blobData as ArrayBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), fileName);
}

export async function downloadPirLaborWorkbook(passport: PirEstimatePassport, input: PirLaborInput) {
  await download(await buildPirLaborWorkbook(passport, input), `Форма_3П_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export async function downloadPirTravelWorkbook(passport: PirEstimatePassport, input: PirTravelInput) {
  await download(await buildPirTravelWorkbook(passport, input), `Форма_4П_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export async function downloadPirSummaryWorkbook(
  passport: PirEstimatePassport,
  form2pResult: SbcResult,
  form2pName: string,
  laborInput: PirLaborInput,
  travelInput: PirTravelInput,
  extras: PirSummaryExtra[],
  includedRowIds: string[],
  official = false,
) {
  await download(
    await buildPirSummaryWorkbook(passport, form2pResult, form2pName, laborInput, travelInput, extras, includedRowIds, official),
    `${official ? "Форма_2П" : "Свод_проекта"}_${new Date().toISOString().slice(0, 10)}.xlsx`,
  );
}
