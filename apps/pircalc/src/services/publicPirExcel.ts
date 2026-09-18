import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import type { ProjectInput, SbcComplexRole, SbcResult } from "../domain/types";
import type { PirEstimatePassport } from "../domain/pirForms";

const rub = '#,##0" ₽"';
const percent = "0.0%";
const formula = (formulaText: string, result: number) => ({ formula: formulaText, result });
const complexRoleLabel = (role: SbcComplexRole) => ({
  single: "Отдельный объект",
  main: "Основная позиция",
  embedded: "Встроенная часть",
  blocked: "Сблокированное здание",
  repeated: "Повторная позиция",
})[role];

function header(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFA72525" } };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
}

function widths(sheet: ExcelJS.Worksheet, values: number[]) {
  values.forEach((value, index) => { sheet.getColumn(index + 1).width = value; });
}

export async function buildPublicPirWorkbook(project: ProjectInput, result: SbcResult, passport?: PirEstimatePassport): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "OVC.me";
  workbook.created = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;

  const isComplex = Boolean(result.complexBreakdown);
  const calculationName = passport ? "Форма 2П" : "Расчёт";
  const calculation = workbook.addWorksheet(calculationName, { views: [{ showGridLines: false }] });
  calculation.getCell("A1").value = passport
    ? `Смета № ${passport.estimate2pNumber || "—"} на проектные работы (форма 2П)`
    : isComplex
    ? "Нормативный расчёт стоимости комплекса объектов"
    : "Нормативный расчёт стоимости проектных работ";
  calculation.getCell("A1").font = { bold: true, size: 16, color: { argb: "FF172033" } };
  calculation.mergeCells("A1:C1");
  calculation.getCell("A2").value = passport?.constructionName
    ? `Стройка: ${passport.constructionName}. Расчёт по данным ФГИС ЦС.`
    : "По данным ФГИС ЦС. Это не локальная или объектная смета строительства и не калькуляция команды по зарплатным ставкам.";
  calculation.mergeCells("A2:C2");
  if (passport) {
    calculation.getCell("E1").value = "Заказчик";
    calculation.getCell("F1").value = passport.customer;
    calculation.getCell("E2").value = "Проектная организация";
    calculation.getCell("F2").value = passport.designOrganization;
    calculation.getCell("E3").value = "Генеральный проектировщик";
    calculation.getCell("F3").value = passport.generalDesigner;
    calculation.getCell("E4").value = "Уровень цен";
    calculation.getCell("F4").value = passport.priceLevelYear;
    calculation.getColumn("E").width = 26;
    calculation.getColumn("F").width = 40;
    ["E1", "E2", "E3", "E4"].forEach((address) => { calculation.getCell(address).font = { bold: true, color: { argb: "FF7F1D1D" } }; });
  }
  calculation.getRow(4).values = ["Показатель", "Значение", "Как используется"];
  header(calculation.getRow(4));

  const structured = Boolean(result.officialBreakdown);
  const basePriceFormula = isComplex
    ? `ROUND(${result.basePrice},2)`
    : result.normativeTrace.ruleCode === "8.1"
    ? `B9+B10*B11+${result.normativeTrace.airConditioningAdditionalBasePrice}`
    : `ROUND(${result.basePrice},2)`;
  const firstConditionCoefficient = isComplex
    ? result.normativeTrace.totalCoefficient
    : structured
    ? result.normativeTrace.normSpecificCoefficient
    : project.sbcComplexityCoefficient;
  const secondConditionCoefficient = isComplex
    ? 1
    : structured
    ? result.normativeTrace.normTableCoefficient
      * result.normativeTrace.complexRoleCoefficient
      * result.normativeTrace.specialStatusCoefficient
      * result.normativeTrace.smrShareCoefficient
    : project.sbcAdjustmentCoefficient;
  const isBim = Boolean(project.sbcInformationModel);
  const pdShare = result.officialBreakdown ? result.officialBreakdown.pdSharePercent / 100 : project.sbcPdShare;
  const rdShare = result.officialBreakdown ? result.officialBreakdown.rdSharePercent / 100 : project.sbcRdShare;
  const adjustedFormula = isComplex
    ? `ROUND(${result.adjustedBasePrice},2)`
    : isBim
    ? `B14*B15*B16*(B20*${result.normativeTrace.bimPdCoefficient}+B22*${result.normativeTrace.bimRdCoefficient})`
    : "B14*B15*B16";
  const pdFormula = isComplex
    ? `ROUND(${result.pdPriceWithoutVat},2)`
    : isBim
    ? `B14*B15*B16*B20*${result.normativeTrace.bimPdCoefficient}*B18`
    : "B19*B20";
  const rdFormula = isComplex
    ? `ROUND(${result.rdPriceWithoutVat},2)`
    : isBim
    ? `B14*B15*B16*B22*${result.normativeTrace.bimRdCoefficient}*B18`
    : "B19*B22";
  const rows: Array<[string, ExcelJS.CellValue, string]> = [
    ["Норматив", isComplex ? result.collectionName : project.sbcCollectionName, "Официальный документ, по которому выполнен расчёт."],
    ["Период", project.sbcFgisPeriodLabel, "Текущий квартал для пересчёта цены."],
    ["Таблица", isComplex ? "Σ" : project.sbcFgisTableCode ?? "", isComplex ? "Каждая позиция комплекса содержит собственную нормативную таблицу." : "Таблица выбранного объекта или таблица 3.18."],
    ["Объект", isComplex ? `Комплекс, количество позиций: ${result.complexBreakdown?.componentCount ?? 0}` : project.sbcFgisObjectName ?? "", "Тип проектируемого объекта."],
    ["Постоянная a", project.sbcConstantA, "Фиксированная часть базовой цены, ₽."],
    ["Показатель b", project.sbcConstantB, `Цена единицы показателя, ₽/${project.sbcFgisIndicatorUnit || "ед."}.`],
    ["Натуральный показатель", project.sbcNaturalIndicator, `Введённое значение, ${project.sbcFgisIndicatorUnit || "ед."}.`],
    ["Стоимость строительства", project.sbcConstructionCost, "Используется только для таблицы 3.18."],
    ["Норматив от стоимости", project.sbcDesignPercent, "Используется только для таблицы 3.18."],
    ["Базовая цена", formula(basePriceFormula, result.basePrice), `Результат правила ${result.normativeTrace.ruleCode}.`],
    ["Коэффициент условий норматива", firstConditionCoefficient, "Для НЗ № 848/пр определяется выбранными условиями, а не свободным вводом."],
    ["Остальные нормативные коэффициенты", secondConditionCoefficient, "Условие специальной таблицы, роль позиции, специальный статус и коэффициент доли СМР."],
    ["Цена с коэффициентами", formula(adjustedFormula, result.adjustedBasePrice), isBim ? "Базовая цена × общие условия × доли стадий × отдельные коэффициенты информационной модели." : "Базовая цена × коэффициенты."],
    ["Индекс текущего периода", project.sbcIndexToCurrent, "Перевод базовой цены в выбранный квартал."],
    ["Текущая стоимость без НДС", formula(isComplex ? `ROUND(${result.currentPriceWithoutVat},2)` : "B17*B18", result.currentPriceWithoutVat), "Нормативная стоимость ПД + РД."],
    ["Доля ПД", pdShare, isBim ? "Для документации с информационной моделью — 60% по п. 23 НЗ № 848/пр." : "Доля проектной документации."],
    ["ПД без НДС", formula(pdFormula, result.pdPriceWithoutVat), "Стоимость проектной документации."],
    ["Доля РД", rdShare, isBim ? "Для документации с информационной моделью — 40%; для РД по обычной ПД — 60% по п. 24." : "Доля рабочей документации."],
    ["РД без НДС", formula(rdFormula, result.rdPriceWithoutVat), "Стоимость рабочей документации."],
    ["НДС", project.vatRate, "Действующая ставка в расчёте."],
    ["Итого с НДС", formula(isComplex ? `ROUND(${result.currentPriceWithVat},2)` : "B19*(1+B24)", result.currentPriceWithVat), "Стоимость проектных работ с НДС."],
    ["Источник", project.sbcFgisSourceUrl, "Прямая ссылка на официальный документ ФГИС ЦС."],
    ["Контакты", "OVC.me", "Вопросы по применению калькулятора."],
    ["Расчёт допустим", result.normativeTrace.valid ? "Да" : "Нет", "При наличии блокирующего условия итоговая цена не выдаётся."],
    ["Применённое правило", result.normativeTrace.ruleCode, result.normativeTrace.ruleTitle],
    ["Формула", result.normativeTrace.formula, "Подробная формула применённого нормативного правила."],
    ["Нормативное основание", result.normativeTrace.source, result.normativeTrace.sourcePage ? `Страница ${result.normativeTrace.sourcePage}.` : ""],
    ["Коэффициент приведения стоимости", result.normativeTrace.constructionRebaseCoefficient, "Приведение исходной стоимости строительства к уровню цен норматива."],
    ["Стоимость строительства в уровне норматива", result.normativeTrace.baseConstructionCost ?? 0, "Исходная стоимость × коэффициент приведения."],
    ["Доля СМР", result.normativeTrace.smrSharePercent / 100, "Доля строительно-монтажных работ в стоимости строительства."],
    ["Коэффициент доли СМР", result.normativeTrace.smrShareCoefficient, "Коэффициент по п. 140 Методики № 707/пр."],
    ["Коэффициент условий № 848/пр", result.normativeTrace.normSpecificCoefficient, "1,1 при зоне охраны либо не менее трёх факторов стеснённости."],
    ["Коэффициент специальной таблицы № 848/пр", result.normativeTrace.normTableCoefficient, "Таблицы 3.3.1, 3.5.1, 3.7.1, 3.11.1 или 3.17.1."],
    ["Коэффициент роли позиции", result.normativeTrace.complexRoleCoefficient, "Основной, встроенный, сблокированный или повторно применяемый объект."],
    ["Коэффициент специального статуса", result.normativeTrace.specialStatusCoefficient, "1,3 при одновременном выполнении установленных условий и в период действия нормы."],
    ["Коэффициент BIM для П", result.normativeTrace.bimPdCoefficient, "Таблица 1 приложения № 2 НЗ № 848/пр."],
    ["Коэффициент BIM для Р", result.normativeTrace.bimRdCoefficient, "Таблица 1 приложения № 2 НЗ № 848/пр."],
    ["База проектирования кондиционируемой части", result.normativeTrace.airConditioningDesignBasePrice, "Определена калькулятором по показателю кондиционируемой части и той же нормативной таблице."],
    ["Дополнение КОН — кондиционирование воздуха", result.normativeTrace.airConditioningAdditionalBasePrice, "3,1% для П + Р по п. 25, если раздел отсутствует в таблице распределения."],
    ["Увеличение ПД из-за информационной модели", result.normativeTrace.bimPdAdditionalWithoutVat, "Справочно: уже включено в стоимость ПД и не прибавляется повторно."],
    ["Увеличение РД из-за информационной модели", result.normativeTrace.bimRdAdditionalWithoutVat, "Справочно: уже включено в стоимость РД и не прибавляется повторно."],
    ["Увеличение стоимости из-за информационной модели", result.normativeTrace.bimPdAdditionalWithoutVat + result.normativeTrace.bimRdAdditionalWithoutVat, "Справочный итог влияния информационной модели; это не отдельный раздел документации."],
    ["Общий коэффициент", result.normativeTrace.totalCoefficient, "Произведение всех применённых нормативных коэффициентов."],
    ["Блокирующие условия", result.normativeTrace.blockers.join("; "), "Причины, по которым итоговый расчёт остановлен."],
    ["Предупреждения", result.normativeTrace.warnings.join("; "), "Условия, которые нужно подтвердить документами."],
  ];
  calculation.addRows(rows);
  widths(calculation, [34, 52, 72]);
  [9, 10, 12, 14, 17, 19, 21, 23, 25].forEach((row) => { calculation.getCell(`B${row}`).numFmt = rub; });
  [13, 20, 22, 24, 34].forEach((row) => { calculation.getCell(`B${row}`).numFmt = percent; });
  calculation.getCell("B26").value = { text: project.sbcFgisSourceUrl, hyperlink: project.sbcFgisSourceUrl };
  rows.forEach(([label], index) => {
    if (String(label).includes("кондиционируем") || String(label).includes("информационной модели")) {
      calculation.getCell(`B${index + 5}`).numFmt = rub;
    }
  });

  if (result.complexBreakdown) {
    const complex = workbook.addWorksheet("Состав комплекса", { views: [{ showGridLines: false, state: "frozen", ySplit: 4 }] });
    complex.getCell("A1").value = "Ведомость нормативных позиций комплекса";
    complex.getCell("A1").font = { bold: true, size: 16, color: { argb: "FF172033" } };
    complex.mergeCells("A1:O1");
    complex.getCell("A2").value = "Каждая позиция рассчитана отдельно; итог определён суммированием по пп. 18–20 НЗ № 848/пр.";
    complex.mergeCells("A2:O2");
    complex.getCell("A3").value = "Коэффициент ПЗУ применяется только к стоимости раздела ПЗУ соответствующей позиции. Суммы без НДС.";
    complex.mergeCells("A3:O3");
    complex.getRow(4).values = ["№", "Позиция", "Таблица", "Объект", "Показатель", "Ед.", "Роль", "K роли", "K ПЗУ", "Уменьшение ПЗУ", "Базовая цена", "ПД", "РД", "Всего", "Контроль"];
    header(complex.getRow(4));
    result.complexBreakdown.components.forEach((component, index) => {
      const row = index + 5;
      complex.getRow(row).values = [
        index + 1,
        component.name,
        component.tableCode,
        component.objectName,
        component.indicator,
        component.indicatorUnit,
        complexRoleLabel(component.role),
        component.roleCoefficient,
        component.pzuCoefficient,
        component.pzuReductionWithoutVat,
        component.basePrice,
        component.pdPriceWithoutVat,
        component.rdPriceWithoutVat,
        component.currentPriceWithoutVat,
        component.valid ? "Рассчитано" : component.blockers.join("; "),
      ];
      ["J", "K", "L", "M", "N"].forEach((column) => { complex.getCell(`${column}${row}`).numFmt = rub; });
    });
    const totalRow = result.complexBreakdown.components.length + 5;
    const firstRow = 5;
    const lastRow = totalRow - 1;
    complex.getRow(totalRow).values = [
      "",
      "ИТОГО ПО КОМПЛЕКСУ",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      formula(`SUM(J${firstRow}:J${lastRow})`, result.complexBreakdown.components.reduce((sum, item) => sum + item.pzuReductionWithoutVat, 0)),
      formula(`SUM(K${firstRow}:K${lastRow})`, result.basePrice),
      formula(`SUM(L${firstRow}:L${lastRow})`, result.pdPriceWithoutVat),
      formula(`SUM(M${firstRow}:M${lastRow})`, result.rdPriceWithoutVat),
      formula(`SUM(N${firstRow}:N${lastRow})`, result.currentPriceWithoutVat),
      result.normativeTrace.valid ? "Расчёт допустим" : "Расчёт остановлен",
    ];
    complex.getRow(totalRow).font = { bold: true };
    ["J", "K", "L", "M", "N"].forEach((column) => { complex.getCell(`${column}${totalRow}`).numFmt = rub; });
    widths(complex, [7, 34, 12, 42, 14, 10, 18, 10, 10, 20, 20, 20, 20, 22, 38]);
  }

  const breakdown = workbook.addWorksheet("Разделы", { views: [{ showGridLines: false, state: "frozen", ySplit: 4 }] });
  breakdown.getCell("A1").value = "Стоимость по стадиям и разделам";
  breakdown.getCell("A1").font = { bold: true, size: 16, color: { argb: "FF172033" } };
  breakdown.mergeCells("A1:G1");
  breakdown.getCell("A2").value = result.officialBreakdown
    ? `Таблица ${result.officialBreakdown.tableCode}, стр. ${result.officialBreakdown.page}: ${result.officialBreakdown.objectName}`
    : "Официальное распределение для выбранного документа отсутствует";
  breakdown.mergeCells("A2:G2");
  breakdown.getCell("A3").value = "Доли и суммы приведены без НДС. Контакты: OVC.me";
  breakdown.mergeCells("A3:G3");
  breakdown.getRow(4).values = ["Раздел", "Наименование", "Доля ПД", "ПД без НДС", "Доля РД", "РД без НДС", "Всего без НДС"];
  header(breakdown.getRow(4));

  if (result.officialBreakdown) {
    result.officialBreakdown.sections.forEach((section, index) => {
      const row = index + 5;
      breakdown.getRow(row).values = [
        section.code,
        section.name,
        section.pdSharePercent / 100,
        result.normativeTrace.airConditioningAdditionalBasePrice > 0 ? section.pdPriceWithoutVat : formula(`'${calculationName}'!$B$21*C${row}`, section.pdPriceWithoutVat),
        section.rdSharePercent / 100,
        result.normativeTrace.airConditioningAdditionalBasePrice > 0 ? section.rdPriceWithoutVat : formula(`'${calculationName}'!$B$23*E${row}`, section.rdPriceWithoutVat),
        formula(`D${row}+F${row}`, section.totalPriceWithoutVat),
      ];
    });
    const first = 5;
    let last = first + result.officialBreakdown.sections.length - 1;
    if (result.officialBreakdown.pdUnallocatedWithoutVat || result.officialBreakdown.rdUnallocatedWithoutVat) {
      last += 1;
      breakdown.getRow(last).values = [
        "Остаток",
        "Не распределён опубликованной строкой ФГИС",
        Math.max(0, 100 - result.officialBreakdown.pdPublishedTotalPercent) / 100,
        result.officialBreakdown.pdUnallocatedWithoutVat,
        Math.max(0, 100 - result.officialBreakdown.rdPublishedTotalPercent) / 100,
        result.officialBreakdown.rdUnallocatedWithoutVat,
        formula(`D${last}+F${last}`, result.officialBreakdown.pdUnallocatedWithoutVat + result.officialBreakdown.rdUnallocatedWithoutVat),
      ];
      breakdown.getRow(last).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFAE8" } };
    }
    const total = last + 1;
    breakdown.getRow(total).values = [
      "ИТОГО",
      "ПД + РД",
      result.officialBreakdown.pdSharePercent / 100,
      formula(`SUM(D${first}:D${last})`, result.pdPriceWithoutVat),
      result.officialBreakdown.rdSharePercent / 100,
      formula(`SUM(F${first}:F${last})`, result.rdPriceWithoutVat),
      formula(`D${total}+F${total}`, result.currentPriceWithoutVat),
    ];
    breakdown.getRow(total).font = { bold: true };
    for (let row = first; row <= total; row += 1) {
      breakdown.getCell(`C${row}`).numFmt = percent;
      breakdown.getCell(`E${row}`).numFmt = percent;
      ["D", "F", "G"].forEach((column) => { breakdown.getCell(`${column}${row}`).numFmt = rub; });
    }
  }
  widths(breakdown, [14, 58, 14, 22, 14, 22, 24]);

  workbook.eachSheet((sheet) => {
    sheet.eachRow((row) => row.eachCell((cell) => {
      cell.alignment = { vertical: "middle", wrapText: true };
    }));
  });

  const data = await workbook.xlsx.writeBuffer();
  return data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data);
}

export async function downloadPublicPirWorkbook(project: ProjectInput, result: SbcResult, passport?: PirEstimatePassport) {
  const bytes = await buildPublicPirWorkbook(project, result, passport);
  const blobData = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  saveAs(
    new Blob([blobData as ArrayBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `${passport ? "Форма_2П" : "Расчёт_стоимости_проектных_работ"}_${new Date().toISOString().slice(0, 10)}.xlsx`,
  );
}
