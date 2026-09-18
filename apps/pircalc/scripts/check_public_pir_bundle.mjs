import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const assetDirectory = "dist-public/assets";
const assetNames = await readdir(assetDirectory);
const javascript = (
  await Promise.all(
    assetNames
      .filter((name) => name.endsWith(".js"))
      .map((name) => readFile(join(assetDirectory, name), "utf8")),
  )
).join("\n");
const html = await readFile("dist-public/index.html", "utf8");

const required = [
  "ФГИС ЦС · ПРОЕКТНЫЕ РАБОТЫ",
  "Скачать документ ФГИС",
  "2 квартал 2026 г.",
  "Методика расчёта и расшифровки",
  "Общая площадь объекта",
  "Формы 2П, 3П и 4П",
  "Расчёт стоимости по трудозатратам",
  "Командировочные расходы",
  "ПОЛЬЗОВАТЕЛЬСКИЙ СВОД ПРОЕКТА",
];
const forbidden = [
  "ПП87.ОКС.13",
  "monthlySalaryMedian",
  "/calculator/api/",
  "ОБЩ.СКАНИРОВАНИЕ",
  "Подряд",
  "Сохранить шаблон",
  "Директорский портфель",
  "ФОРМА 1П",
  "Форма 1П",
];

for (const marker of required) {
  if (!javascript.includes(marker)) throw new Error(`Public PIR bundle is missing: ${marker}`);
}
for (const marker of forbidden) {
  if (javascript.includes(marker)) throw new Error(`Private marker leaked into public PIR bundle: ${marker}`);
  if (html.includes(marker)) throw new Error(`Forbidden marker leaked into public PIR HTML: ${marker}`);
}
if (!html.includes('/pircalc/assets/')) throw new Error("Public PIR base path is not /pircalc/");

console.log(`Public PIR bundle audit passed: ${assetNames.length} assets, ${javascript.length} JS bytes`);
