import { open, save, invoke } from "./web-runtime.js";
import { DESKTOP_DOWNLOAD_URL, buildDiagnosticReport, displayFileName } from "./diagnostics.js";
import profile from "../profiles/spds_stamp_mvp.json";
import "./styles.css";

const clone = (value) => JSON.parse(JSON.stringify(value));
const primaryRuleOrder = ["document-text", "document-logo", "stamp-surnames", "stamp-organization", "note-tch", "note-gch"];
const initialRules = clone(profile.rules).sort((left, right) => primaryRuleOrder.indexOf(left.id) - primaryRuleOrder.indexOf(right.id));
const state = {
  input: "",
  inputs: [],
  sourceFolder: "",
  output: "",
  outputDir: "",
  makePreviews: true,
  rules: initialRules,
  pageOperations: [],
  selected: Math.max(0, initialRules.findIndex((rule) => rule.id === "document-text")),
  screen: "task",
  task: {
    roleEnabled: true, role: "ГИП", oldRoleName: "", newRoleName: "",
    organizationEnabled: true, oldOrganization: "", newOrganization: "",
    textEnabled: false, oldText: "", newText: "",
    clearStampEnabled: false, extractPages: "", extractSuffix: "выбранные-листы",
  },
  pageInspection: null,
  pageInspecting: false,
  directPage: 1,
  directSelectedSpan: null,
  directReplacement: "",
  directAction: "replace",
  inspection: null,
  contentInspection: null,
  inspecting: false,
  inspectingContent: false,
  running: false,
  progress: null,
  previewPages: [],
  previewModalOpen: false,
  selectedPreviewPage: 1,
  message: "Выберите один PDF или комплект документов. Файлы обрабатываются во временном каталоге и не сохраняются на сервере.",
  messageType: "info",
};

const app = document.querySelector("#app");
const ruleById = (id) => state.rules.find((rule) => rule.id === id);
const selectedRule = () => state.rules[state.selected];
const esc = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");

function input(bind, value, type = "text", extra = "") {
  return `<input data-bind="${bind}" type="${type}" value="${esc(value)}" ${extra}>`;
}

function select(bind, value, options) {
  return `<select data-bind="${bind}">${options.map(([key, label]) => `<option value="${key}" ${String(key) === String(value) ? "selected" : ""}>${label}</option>`).join("")}</select>`;
}

function field(label, control, hint = "") {
  return `<label class="field"><span>${label}</span><div class="field-body">${control}${hint ? `<small>${hint}</small>` : ""}</div></label>`;
}

function render() {
  app.innerHTML = `
    <header class="topbar">
      <div class="brand">
        <div class="brand-mark">PDF</div>
        <div>
          <h1>Редактор содержания PDF</h1>
          <p>Поиск и корректировка проектной документации</p>
        </div>
      </div>
      <nav class="tabs">
        <button data-screen="task" class="${state.screen === "task" ? "active" : ""}">Задание</button>
        <button data-screen="direct" class="${state.screen === "direct" ? "active" : ""}">Прямой редактор</button>
        <button data-screen="content" class="${state.screen === "content" ? "active" : ""}">Правила</button>
        <button data-screen="stamp" class="${state.screen === "stamp" ? "active" : ""}">Штамп (профиль)</button>
        <button data-screen="pages" class="${state.screen === "pages" ? "active" : ""}">Страницы (доп.)</button>
      </nav>
      <div class="profile-menu">
        <button id="apply-preset-tz" class="preset-btn" title="Загрузить синтетический пример параметров">Демо-профиль</button>
        <button id="import-profile">Открыть профиль</button>
        <button id="export-profile">Сохранить профиль</button>
        <a class="source-link" href="https://github.com/proovcme/locia/tree/main/apps/pdf-editor" target="_blank" rel="noreferrer">Исходный код</a>
      </div>
    </header>

    <main>
      ${renderFiles()}
      ${state.screen === "task" ? renderTask() : state.screen === "direct" ? renderDirectEditor() : state.screen === "stamp" ? renderQuick() : state.screen === "pages" ? renderPages() : renderRules()}
      ${renderFooter()}
    </main>
    ${renderPreviewModal()}`;
  bindEvents();
}

function renderTask() {
  const task = state.task;
  return `
    <section class="step-card">
      <div class="step-heading"><span class="step-num">2</span><div><h2>Задание на комплект</h2><p>Типовые изменения применяются ко всем выбранным PDF. Исходные файлы не перезаписываются.</p></div></div>
      <div class="task-grid task-main-grid">
        ${taskFormCard("roleEnabled", "Ответственный в штампе", "Найти строку по роли и заменить фамилию", `
          ${field("Роль", select("task.role", task.role, [["ГИП", "ГИП"], ["ГАП", "ГАП"], ["Разработал", "Разработал"], ["Проверил", "Проверил"], ["Н. контр.", "Н. контр."]]))}
          ${field("Кого меняем", input("task.oldRoleName", task.oldRoleName), "Пусто — любой человек в выбранной роли")}
          ${field("Новое значение", input("task.newRoleName", task.newRoleName, "text", 'placeholder="Например: Проектировщик"'))}`)}
        ${taskFormCard("organizationEnabled", "Организация", "Заменить компанию в основной надписи", `
          ${field("Старая", input("task.oldOrganization", task.oldOrganization), "Можно не указывать для стандартного штампа")}
          ${field("Новая", `<textarea data-bind="task.newOrganization" rows="2" placeholder="ООО «Проектная мастерская»">${esc(task.newOrganization)}</textarea>`)}`)}
        ${taskFormCard("textEnabled", "Другой текст", "Пакетная замена по содержанию документа", `
          ${field("Найти", `<textarea data-bind="task.oldText" rows="2">${esc(task.oldText)}</textarea>`)}
          ${field("Заменить", `<textarea data-bind="task.newText" rows="2">${esc(task.newText)}</textarea>`)}`)}
        ${taskFormCard("clearStampEnabled", "Обнулить штампы и выгрузить листы", "Очистить значения штампа, сохранить линии и извлечь нужные страницы", `
          ${field("Листы", input("task.extractPages", task.extractPages), "Например: 2, 5-12")}
          ${field("Имя выборки", input("task.extractSuffix", task.extractSuffix))}
          <small class="danger-note">Очищаются значения полей основной надписи, но не рамка и не сетка таблицы.</small>`)}
      </div>
      <div class="task-hint"><strong>Нестандартный лист?</strong> Выберите надпись в «Прямом редакторе» либо проверьте совпадения в «Правилах».</div>
    </section>`;
}

function taskFormCard(key, title, description, body) {
  const enabled = Boolean(state.task[key]);
  return `<article class="task-card ${enabled ? "enabled" : ""}"><label class="task-switch"><input data-task-toggle="${key}" type="checkbox" ${enabled ? "checked" : ""}><i></i><span><strong>${title}</strong><small>${description}</small></span></label><div class="task-body">${body}</div></article>`;
}

function renderDirectEditor() {
  if (!state.input) return `<section class="step-card"><div class="stamp-empty"><strong>Сначала выберите PDF или папку проекта</strong><span>После этого можно нажать на любую текстовую надпись на листе.</span></div></section>`;
  if (state.pageInspecting) return `<section class="step-card"><div class="stamp-empty"><strong>Открываю страницу ${state.directPage}…</strong><span>Извлекаю текстовые блоки и координаты.</span></div></section>`;
  const page = state.pageInspection;
  if (!page) return `<section class="step-card"><div class="stamp-empty error-box"><strong>Страница ещё не открыта</strong><span>Перейдите на другую вкладку и вернитесь либо выберите PDF заново.</span></div></section>`;
  const selected = state.directSelectedSpan;
  return `<section class="direct-layout">
    <div class="step-card direct-canvas-card">
      <div class="direct-toolbar"><strong>Лист ${page.page} из ${page.page_count}</strong><div><button id="direct-prev" class="secondary-btn" ${page.page <= 1 ? "disabled" : ""}>←</button><input id="direct-page-number" type="number" min="1" max="${page.page_count}" value="${page.page}"><button id="direct-next" class="secondary-btn" ${page.page >= page.page_count ? "disabled" : ""}>→</button></div></div>
      <div class="direct-canvas"><img src="data:image/png;base64,${page.image}" alt="Страница ${page.page}">${page.spans.map((span, index) => `<button class="direct-span ${selected === index ? "selected" : ""}" data-direct-span="${index}" title="${esc(span.text)}" style="left:${span.x}%;top:${span.y}%;width:${Math.max(span.width, 0.5)}%;height:${Math.max(span.height, 0.5)}%"></button>`).join("")}</div>
    </div>
    <aside class="step-card direct-panel"><h2>Текстовый блок</h2>${selected === null ? `<p class="muted">Нажмите на нужную надпись на листе.</p>` : `
      ${field("Сейчас", `<textarea readonly rows="3">${esc(page.spans[selected].text)}</textarea>`)}
      ${field("Действие", select("direct.action", state.directAction, [["replace", "Заменить"], ["redact", "Удалить"]]))}
      ${state.directAction === "replace" ? field("Новый текст", `<textarea data-bind="direct.replacement" rows="4">${esc(state.directReplacement)}</textarea>`) : ""}
      <label class="plain-check"><input id="direct-all-files" type="checkbox"> Применить ко всему комплекту</label>
      <button id="add-direct-rule" class="primary">Добавить в задание</button><small class="direct-note">Шрифт, кегль и цвет будут сохранены.</small>`}</aside>
  </section>`;
}

function renderPages() {
  return `
    <section class="step-card">
      <div class="step-heading">
        <span class="step-num">2</span>
        <div>
          <h2>Операции со страницами</h2>
          <p>Операции выполняются сверху вниз. Номера относятся к состоянию документа на текущем шаге.</p>
        </div>
        <button id="add-page-operation" class="secondary-btn heading-action">+ Добавить операцию</button>
      </div>
      <div class="operation-list">
        ${state.pageOperations.length ? state.pageOperations.map((operation, index) => renderPageOperation(operation, index)).join("") : `
          <div class="empty-operations">
            <strong>Список операций пока пуст</strong>
            <span>Можно удалить, извлечь, повернуть, оставить, дублировать или добавить страницы из другого PDF.</span>
          </div>`}
      </div>
    </section>`;
}

function renderPageOperation(operation, index) {
  const needsPages = operation.type !== "insert_pdf";
  return `
    <article class="page-operation">
      <span class="operation-order">${index + 1}</span>
      <div class="operation-fields">
        ${field("Действие", select(`pageop.${index}.type`, operation.type, [
          ["delete", "Удалить страницы"],
          ["extract", "Извлечь в отдельный PDF"],
          ["rotate", "Повернуть страницы"],
          ["keep", "Оставить только выбранные"],
          ["duplicate", "Дублировать страницы в конец"],
          ["insert_pdf", "Добавить страницы из другого PDF"],
        ]))}
        ${needsPages ? field("Страницы", input(`pageop.${index}.pages`, operation.pages || ""), "Например: 1, 3-7, 12") : ""}
        ${operation.type === "rotate" ? field("Поворот", select(`pageop.${index}.angle`, operation.angle || 90, [[90, "90° по часовой"], [180, "180°"], [270, "90° против часовой"]])) : ""}
        ${operation.type === "extract" ? field("Имя результата", input(`pageop.${index}.suffix`, operation.suffix || "извлечено"), "Будет создан отдельный PDF рядом с результатом") : ""}
        ${operation.type === "insert_pdf" ? `
          ${field("Другой PDF", `<div class="font-file"><input value="${esc(operation.source_pdf || "Не выбран")}" readonly><button data-pick-insert="${index}">Выбрать…</button></div>`)}
          ${field("Страницы из него", input(`pageop.${index}.pages`, operation.pages || "all"), "all или, например, 2-5")}
          ${field("Куда вставить", input(`pageop.${index}.position`, operation.position || "end"), "end или номер позиции")}
        ` : ""}
      </div>
      <button class="remove-operation" data-remove-page-operation="${index}" title="Удалить операцию">×</button>
    </article>`;
}

function renderFiles() {
  const packageLabel = state.sourceFolder ? `${state.inputs.length} PDF из ${shortPath(state.sourceFolder)}` : state.inputs.length > 1 ? `${state.inputs.length} PDF файлов в пакете` : state.input ? shortPath(state.input) : "Выберите PDF или папку проекта…";
  const outputLabel = state.inputs.length > 1 ? (state.outputDir ? shortPath(state.outputDir) : "Выберите папку для сохранения…") : (state.output ? shortPath(state.output) : "Куда сохранить изменённый PDF…");
  return `
    <section class="step-card files-card">
      <div class="step-heading">
        <span class="step-num">1</span>
        <div>
          <h2>Комплект документации</h2>
          <p>Исходные файлы остаются без изменений. Результат создаётся в новом файле.</p>
        </div>
      </div>
      <div class="file-pickers">
        <div class="file-picker source-picker ${state.input ? "chosen" : ""}">
          <span class="picker-label">Исходный файл / пакет</span>
          <strong>${packageLabel}</strong>
          <div class="source-actions"><button id="pick-input">PDF-файлы…</button><button id="pick-folder">Папка проекта…</button></div>
        </div>
        <span class="arrow">→</span>
        <button id="pick-output" class="file-picker ${(state.output || state.outputDir) ? "chosen" : ""}">
          <span class="picker-label">${state.inputs.length > 1 ? "Папка результатов" : "Выходной PDF"}</span>
          <strong>${outputLabel}</strong>
        </button>
      </div>
      <div class="upload-limit-notice">
        <div>
          <strong>Ограничение web-версии: 24 МБ</strong>
          <span>Суммарно за одну обработку, не более 20 PDF. Для больших файлов и целых папок используйте настольное приложение.</span>
        </div>
        <a href="${DESKTOP_DOWNLOAD_URL}" download>Скачать настольную версию для Windows</a>
      </div>
    </section>`;
}

function renderQuick() {
  const surnames = ruleById("stamp-surnames") || state.rules[0];
  const organization = ruleById("stamp-organization") || state.rules[1];
  const noteTch = ruleById("note-tch") || state.rules[2];
  const documentText = ruleById("document-text") || state.rules[4];
  const logo = ruleById("document-logo") || state.rules[5];
  const logoKind = logo?.action?.content_kind || "image";
  const style = surnames?.action?.style || {};
  const yearsList = (surnames.match?.years || [2025, 2026]).join(", ");
  const isAllSurnames = !surnames.match?.text;

  return `
    <section class="step-card">
      <div class="step-heading">
        <span class="step-num">2</span>
        <div>
          <h2>Распознанный штамп и структура документа</h2>
          <p>Автоматическое определение основных надписей форм 3–6. Нажмите на строку для быстрой привязки.</p>
        </div>
      </div>
      ${renderStampPreview()}
    </section>

    <section class="step-card">
      <div class="step-heading">
        <span class="step-num">3</span>
        <div>
          <h2>Параметры переоформления</h2>
          <p>Настройки базового задания: замена фамилий, организации и добавление красной пометки.</p>
        </div>
      </div>
      <div class="task-grid">
        ${quickTask("stamp-surnames", "Ответственные в штампе", "Заменит значения в строках с датами указанных годов", `
          ${field("Режим", select("quick.surnameMode", isAllSurnames ? "all" : "specific", [["all", "Все фамилии за указанные годы"], ["specific", "Только конкретную фамилию"]]))}
          ${!isAllSurnames ? field("Старая фамилия", input("quick.oldSurname", surnames.match.text || "")) : ""}
          ${field("Новое значение", input("quick.surname", surnames.action.text || "Проектировщик"))}
          ${field("Годы дат", input("quick.years", yearsList), "2025, 2026")}
          ${field("Страницы", input("quick.pages", surnames.selector.pages || "all"), "all или 3, 7-10")}`)}

        ${quickTask("stamp-organization", "Организация в штампе", "Заменит название в ячейке основной надписи", `
          ${field("Найти", input("quick.oldOrg", organization.match.text || "Проектная организация"))}
          ${field("Заменить на", `<textarea data-bind="quick.newOrg" rows="2">${organization.action.text || 'ООО "Проектная мастерская"'}</textarea>`)}`)}

        ${quickTask("note-tch", "Красная пометка СПДС", "В левом нижнем углу над штампом (ТЧ) и над рамкой (ГЧ)", `
          ${field("Текст пометки", `<textarea data-bind="quick.note" rows="2">${noteTch.action.text || "*В текущий лист изменения не вносились"}</textarea>`)}`)}

        ${quickTask("document-text", "Текст в документе", "Замена произвольного текста на листах с сохранением стиля", `
          ${field("Найти", input("quick.oldText", documentText.match.text || ""))}
          ${field("Заменить на", `<textarea data-bind="quick.newText" rows="2">${documentText.action.text || ""}</textarea>`)}
          ${field("Страницы", input("quick.textPages", documentText.selector.pages || "all"), "all, 1 или 1-5")}
          <label class="plain-check"><input data-bind="quick.preserveStyle" type="checkbox" ${documentText.action.style.preserve_source_style ? "checked" : ""}> Сохранять исходный шрифт и кегль</label>`)}

        ${quickTask("document-logo", "Логотип / изображение", "Замена или добавление логотипа организации", `
          ${field("Тип", select("quick.logoKind", logoKind, [["text", "Текстовый логотип"], ["image", "Графика (PNG/JPG)"]]))}
          ${logoKind === "text" ? `
            ${field("Старый текст", input("quick.oldLogoText", logo.match.text || ""))}
            ${field("Новый текст", `<textarea data-bind="quick.newLogoText" rows="2">${logo.action.text || ""}</textarea>`)}
          ` : `
            ${field("Файл логотипа", `<div class="font-file"><input value="${esc(logo.action.image_path || "Не выбран")}" readonly><button id="pick-logo">Выбрать…</button></div>`)}
            <div class="coords">${field("X, мм", input("quick.logoX", logo.selector.region.x_mm, "number", 'step="0.1"'))}${field("Y, мм", input("quick.logoY", logo.selector.region.y_mm, "number", 'step="0.1"'))}${field("Ширина", input("quick.logoW", logo.selector.region.width_mm, "number", 'step="0.1"'))}${field("Высота", input("quick.logoH", logo.selector.region.height_mm, "number", 'step="0.1"'))}</div>`}
          ${field("Страницы", input("quick.logoPages", logo.selector.pages || "all"))}`)}
      </div>
    </section>

    <section class="step-card">
      <div class="step-heading">
        <span class="step-num">4</span>
        <div>
          <h2>Типографика новой фамилии</h2>
          <p>Автоматическое масштабирование предотвращает пересечение текста с линиями таблицы.</p>
        </div>
      </div>
      <div class="style-row">
        ${field("Шрифт", select("quick.fontFamily", style.font_family || "Arial", [["Arial", "Arial"], ["Calibri", "Calibri"], ["Times New Roman", "Times New Roman"]]))}
        ${field("Файл шрифта", `<div class="font-file"><input value="${esc(style.font_file || "Системный шрифт")}" readonly><button id="pick-font">TTF/OTF…</button></div>`)}
        ${field("Кегль", input("quick.fontSize", style.font_size_pt || 9, "number", 'min="1" step="0.5"'))}
        ${field("Мин. кегль", input("quick.minFontSize", style.min_font_size_pt || 5.5, "number", 'min="1" step="0.5"'), "Порог предупреждения")}
        ${field("Цвет текста", `<div class="color-choice">${input("quick.color", style.color || "#000000", "color")}<span>${style.color || "#000000"}</span></div>`)}
        ${field("Выравнивание", select("quick.align", style.align || "left", [["left", "По левому краю"], ["center", "По центру"], ["right", "По правому краю"]]))}
      </div>
      <label class="plain-check" style="margin-top:12px"><input data-bind="quick.autoFit" type="checkbox" ${style.auto_fit ? "checked" : ""}> Автоматически уменьшать кегль при нехватке ширины ячейки</label>
    </section>`;
}

function renderStampPreview() {
  if (state.inspecting) return `<div class="stamp-empty"><strong>Распознавание штампа…</strong><span>Анализ структуры страниц, штампов и дат…</span></div>`;
  if (!state.input) return `<div class="stamp-empty"><strong>Выберите исходный PDF комплект</strong><span>После выбора здесь отобразится найденный штамп и поля.</span></div>`;
  const sample = state.inspection?.sample;
  if (!sample) return `<div class="stamp-empty error-box"><strong>Штамп СПДС не обнаружен автоматически</strong><span>Вы можете настроить области вручную во вкладке «Конструктор правил».</span></div>`;
  const detected = state.inspection.values || [];
  return `
    <div class="stamp-workspace">
      <div class="stamp-preview">
        <img src="data:image/png;base64,${sample.image}" alt="Штамп на странице ${sample.page}">
        ${sample.fields.map((item) => `<button class="stamp-hotspot" data-detected-name="${esc(item.text)}" data-detected-role="${esc(item.role)}" data-detected-pages="${sample.page}" title="${esc(item.role)}: ${esc(item.text)} (стр. ${sample.page})" style="left:${item.x}%;top:${item.y}%;width:${Math.max(item.width, 4)}%;height:${Math.max(item.height, 5)}%"></button>`).join("")}
      </div>
      <aside class="detected-panel">
        <strong>Структура комплекта</strong>
        <p>${state.inspection.page_count} стр. · со штампом: ${state.inspection.detected_stamp_pages.length} · титульные: ${(state.inspection.structure?.title_pages || []).join(", ") || "нет"}</p>
        <p class="format-chips">${Object.entries(state.inspection.structure?.formats || {}).map(([name, count]) => `<span class="chip">${name}: ${count}</span>`).join(" ")}</p>
        <strong>Найденные фамилии</strong>
        <div class="detected-list">
          ${detected.length ? detected.map((item) => `
            <div class="detected-item">
              <span class="role-tag">${esc(item.role)}</span>
              <b>${esc(item.text)}</b>
              <small>стр. ${item.pages.join(", ")}</small>
              <div class="item-btns">
                <button data-detected-name="${esc(item.text)}" data-detected-role="${esc(item.role)}" data-detected-pages="all">По комплекту</button>
                <button data-detected-name="${esc(item.text)}" data-detected-role="${esc(item.role)}" data-detected-pages="${item.pages[0]}">Стр. ${item.pages[0]}</button>
              </div>
            </div>`).join("") : `<span class="muted">Фамилии не распознаны.</span>`}
        </div>
      </aside>
    </div>`;
}

function quickTask(id, title, description, body) {
  const rule = ruleById(id);
  const linked = id === "note-tch" ? ruleById("note-gch") : null;
  const enabled = rule ? rule.enabled && (!linked || linked.enabled) : false;
  return `
    <article class="task-card ${enabled ? "enabled" : ""}">
      <label class="task-switch">
        <input data-quick-toggle="${id}" type="checkbox" ${enabled ? "checked" : ""}>
        <i></i>
        <span>
          <strong>${title}</strong>
          <small>${description}</small>
        </span>
      </label>
      <div class="task-body">${body}</div>
    </article>`;
}

function renderRules() {
  const rule = selectedRule();
  return `
    <section class="step-card content-intro">
      <div class="step-heading">
        <span class="step-num">2</span>
        <div>
          <h2>Что нужно изменить в содержании</h2>
          <p>Найдите текст или объект, проверьте совпадения на листах и выберите действие: заменить, удалить или добавить.</p>
        </div>
        <button id="add-rule-top" class="primary compact-primary">+ Новая операция</button>
      </div>
    </section>
    <section class="rules-workspace">
      <aside class="rules-list step-card">
        <div class="rules-title">
          <div>
            <h2>Операции с содержимым</h2>
            <p>Что найти, где и как изменить</p>
          </div>
          <button id="add-rule" class="secondary-btn">+ Добавить</button>
        </div>
        <div class="rules-scroll">
          ${state.rules.map((item, index) => `
            <button class="rule-row ${index === state.selected ? "active" : ""}" data-rule="${index}">
              <i class="${item.enabled ? "on" : ""}"></i>
              <span>
                <strong>${item.name}</strong>
                <small>${humanSummary(item)}</small>
              </span>
            </button>`).join("")}
        </div>
        <div class="list-actions">
          <button id="duplicate-rule">Дублировать</button>
          <button id="delete-rule" class="danger">Удалить</button>
        </div>
      </aside>
      <section class="rule-editor step-card">${rule ? renderEditor(rule) : "<p>Выберите или добавьте правило.</p>"}</section>
    </section>`;
}

function renderEditor(rule) {
  const { selector, match, action } = rule;
  const region = selector.region || {};
  const style = action.style || {};
  return `
    <div class="editor-title">
      <div>
        ${input("name", rule.name, "text", 'class="rule-name"')}
        <p>${humanSummary(rule)}</p>
      </div>
      <div class="editor-actions">
        <button id="inspect-rule" class="secondary-btn" ${!state.input || state.inspectingContent ? "disabled" : ""}>${state.inspectingContent ? "Поиск…" : "Найти в документе"}</button>
        <label class="plain-check"><input data-bind="enabled" type="checkbox" ${rule.enabled ? "checked" : ""}> Включено</label>
      </div>
    </div>
    <div class="plain-language">
      <section>
        <h3><span class="num-badge">1</span> Где искать</h3>
        ${field("Страницы", input("selector.pages", selector.pages || "all"), "all или 1-5, 8")}
        ${field("Ориентация", select("selector.orientation", selector.orientation, [["any", "Любая"], ["portrait", "Книжные"], ["landscape", "Альбомные"]]))}
        ${field("Тип листа", select("selector.document_kind", selector.document_kind, [["any", "Любой"], ["ТЧ", "Текстовая часть (ТЧ)"], ["ГЧ", "Графическая часть (ГЧ)"]]))}
      </section>
      <section>
        <h3><span class="num-badge">2</span> Что найти</h3>
        ${field("Тип поиска", select("match.type", match.type, [["none", "Без поиска — вставка"], ["exact_text", "Точный текст"], ["regex_word", "Регулярное выражение"], ["date_linked_name", "Ответственный в штампе"], ["region_content", "Содержимое выбранной области"], ["stamp_values", "Заполненные значения штампа"]]))}
        ${match.type === "date_linked_name" ? `
          ${field("Фамилия", input("match.text", match.text || ""), "Оставьте пустым для всех фамилий")}
          ${field("Годы дат", input("match.years", (match.years || [2025, 2026]).join(", ")))}
        ` : match.type !== "none" ? field("Текст", input("match.text", match.text || "")) : ""}
      </section>
      <section>
        <h3><span class="num-badge">3</span> Действие</h3>
        ${field("Действие", select("action.type", action.type, [["replace", "Заменить текст"], ["add", "Добавить текст"], ["redact", "Удалить (закрасить)"], ["add_image", "Вставить картинку"], ["replace_image", "Заменить область картинкой"]]))}
        ${["add_image", "replace_image"].includes(action.type) ? `
          ${field("Картинка", `<div class="font-file"><input value="${esc(action.image_path || "Не выбрано")}" readonly><button id="pick-rule-image">PNG/JPG…</button></div>`)}
        ` : action.type !== "redact" ? `
          ${field("Новый текст", `<textarea data-bind="action.text" rows="3">${action.text || ""}</textarea>`)}
        ` : ""}
      </section>
    </div>
    <details class="advanced">
      <summary>Точные координаты области и стиль (мм)</summary>
      <div class="advanced-grid">
        <fieldset>
          <legend>Область (в миллиметрах)</legend>
          ${field("Привязка к", select("selector.region.anchor", region.anchor, [["page", "Левый верх листа"], ["spds_title_block", "Штамп СПДС (185×55)"], ["detected_title_block_top", "Верх фактического штампа"], ["bottom_left", "Левый нижний угол"]]))}
          <div class="coords">
            ${field("X", input("selector.region.x_mm", region.x_mm || 0, "number", 'step="0.1"'))}
            ${field("Y", input("selector.region.y_mm", region.y_mm || 0, "number", 'step="0.1"'))}
            ${field("Ширина", input("selector.region.width_mm", region.width_mm || 50, "number", 'step="0.1"'))}
            ${field("Высота", input("selector.region.height_mm", region.height_mm || 15, "number", 'step="0.1"'))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Оформление текста</legend>
          ${field("Гарнитура", select("action.style.font_family", style.font_family || "Arial", [["Arial", "Arial"], ["Calibri", "Calibri"], ["Times New Roman", "Times New Roman"]]))}
          ${field("Кегль", input("action.style.font_size_pt", style.font_size_pt || 9, "number", 'step="0.5"'))}
          ${field("Минимум", input("action.style.min_font_size_pt", style.min_font_size_pt || 5, "number", 'step="0.5"'))}
          ${field("Цвет", input("action.style.color", style.color || "#000000", "color"))}
          ${field("Выравнивание", select("action.style.align", style.align || "left", [["left", "Слева"], ["center", "По центру"], ["right", "Справа"]]))}
          <label class="plain-check"><input data-bind="action.style.auto_fit" type="checkbox" ${style.auto_fit ? "checked" : ""}> Автоподбор кегля</label>
        </fieldset>
      </div>
    </details>
    ${renderContentInspection()}`;
}

function renderContentInspection() {
  const result = state.contentInspection;
  if (!result) return `<div class="match-placeholder">Настройте правило и нажмите «Найти в документе», чтобы проверить совпадения до обработки.</div>`;
  if (!result.count) return `<div class="match-placeholder warning-box"><strong>Совпадений не найдено</strong><span>Проверьте текст, диапазон страниц и область поиска.</span></div>`;
  const sample = result.sample;
  return `
    <section class="match-results">
      <div class="match-summary">
        <strong>Найдено: ${result.count}${result.truncated ? "+" : ""}</strong>
        <span>Страницы: ${result.pages.slice(0, 30).join(", ")}${result.pages.length > 30 ? "…" : ""}</span>
      </div>
      ${sample ? `<div class="match-preview">
        <img src="data:image/png;base64,${sample.image}" alt="Совпадения на странице ${sample.page}">
        ${sample.markers.map((marker) => `<i style="left:${marker.x}%;top:${marker.y}%;width:${Math.max(marker.width, 0.8)}%;height:${Math.max(marker.height, 0.8)}%"></i>`).join("")}
        <b>Страница ${sample.page}</b>
      </div>` : ""}
    </section>`;
}

function renderFooter() {
  const progress = state.progress;
  const percent = progress ? Math.round((progress.completed + progress.failed) / Math.max(1, progress.total) * 100) : 0;
  return `
    <section class="action-bar ${state.messageType}" aria-live="polite">
      <div class="status-info">
        <strong>${state.running ? `Обработка комплекта: ${percent}%` : state.messageType === "success" ? "Готово" : state.messageType === "error" ? "Завершено с ошибкой" : state.messageType === "warning" ? "Предупреждение" : "Информация"}</strong>
        <p>${state.message}</p>
        ${progress ? `<div class="progress-track"><i style="width:${percent}%"></i></div><small class="progress-caption">Готово: ${progress.completed} · Ошибок: ${progress.failed} · Всего: ${progress.total}</small>` : ""}
        ${renderRunLog(progress)}
      </div>
      <div class="footer-actions">
        <label class="plain-check"><input id="previews" type="checkbox" ${state.makePreviews ? "checked" : ""}> Создать PNG-превью</label>
        ${state.previewPages.length > 0 ? `<button id="open-previews-btn" class="secondary-btn">🔍 Просмотр страниц (${state.previewPages.length})</button>` : ""}
        <button id="run" class="primary" ${state.running ? "disabled" : ""}>${state.running ? "Обработка…" : "Выполнить и скачать"}</button>
      </div>
    </section>`;
}

function renderRunLog(progress) {
  if (!progress?.results?.length) return "";
  const hasErrors = progress.failed > 0;
  return `<details class="run-log" ${hasErrors ? "open" : ""}>
    <summary>Журнал обработки · ${progress.completed} успешно · ${progress.failed} с ошибкой</summary>
    <div class="run-log-list">
      ${progress.results.map((item) => `<article class="run-log-item ${item.ok ? "success" : "error"}">
        <div class="run-log-head">
          <strong>${item.ok ? "Готово" : "Ошибка"}: ${esc(displayFileName(item.input))}</strong>
          <span>${Number.isFinite(item.durationMs) ? `${(item.durationMs / 1000).toFixed(1)} с` : ""}</span>
        </div>
        ${item.ok
          ? `<p>${Number(item.operationCount || 0)} изменений · результат скачан</p>`
          : `<p class="run-log-message">${esc(item.error || "Неизвестная ошибка")}</p>
             ${item.hint ? `<p class="run-log-hint"><strong>Что делать:</strong> ${esc(item.hint)}</p>` : ""}`}
        <small>${item.stage ? `Этап: ${esc(item.stage)} · ` : ""}${item.code ? `Код: ${esc(item.code)} · ` : ""}ID: <code>${esc(item.requestId || "нет")}</code></small>
      </article>`).join("")}
      <button id="copy-run-log" class="secondary-btn copy-log-btn" type="button">Копировать журнал</button>
    </div>
  </details>`;
}

function renderPreviewModal() {
  if (!state.previewModalOpen || !state.previewPages.length) return "";
  const currentPage = state.previewPages.find((p) => p.page === state.selectedPreviewPage) || state.previewPages[0];
  return `
    <div class="modal-overlay">
      <div class="modal-card">
        <div class="modal-header">
          <h3>Просмотр результата (лист ${currentPage.page} из ${state.previewPages.length})</h3>
          <button id="close-modal-btn" class="close-btn">✕</button>
        </div>
        <div class="modal-body">
          <div class="preview-stage">
            <img src="${currentPage.src}" alt="Лист ${currentPage.page}">
          </div>
          <div class="thumbnails-bar">
            ${state.previewPages.map((p) => `<button class="thumb-btn ${p.page === state.selectedPreviewPage ? "active" : ""}" data-page="${p.page}"><span>Лист ${p.page}</span></button>`).join("")}
          </div>
        </div>
      </div>
    </div>`;
}

function shortPath(path) {
  const parts = path.split(/[\\/]/);
  return parts.length > 2 ? `…\\${parts.slice(-2).join("\\")}` : path;
}

function humanSummary(rule) {
  const match = { none: "вставка", exact_text: "точный текст", regex_word: "шаблон", date_linked_name: "ответственный в штампе", region_content: "содержимое области", stamp_values: "заполнение штампа" }[rule.match.type] || rule.match.type;
  const action = { add: "добавить", replace: "заменить", redact: "стереть", add_image: "вставить картинку", replace_image: "заменить картинкой" }[rule.action.type] || rule.action.type;
  return `${match} → ${action}`;
}

function setPath(target, path, value) {
  const parts = path.split(".");
  let cursor = target;
  for (const part of parts.slice(0, -1)) cursor = cursor[part];
  cursor[parts.at(-1)] = value;
}

function applyPresetTZ() {
  const surnameRule = ruleById("stamp-surnames");
  if (surnameRule) {
    surnameRule.enabled = true;
    surnameRule.match.text = "";
    surnameRule.match.role = "";
    surnameRule.match.years = [2025, 2026];
    surnameRule.action.text = "Проектировщик";
  }
  const orgRule = ruleById("stamp-organization");
  if (orgRule) {
    orgRule.enabled = true;
    orgRule.match.text = "Проектная организация";
    orgRule.action.text = 'ООО "Проектная мастерская"';
  }
  const noteTch = ruleById("note-tch");
  if (noteTch) {
    noteTch.enabled = true;
    noteTch.action.text = "*В текущий лист изменения не вносились";
  }
  const noteGch = ruleById("note-gch");
  if (noteGch) {
    noteGch.enabled = true;
    noteGch.action.text = "*В текущий лист изменения не вносились";
  }
  state.message = "Загружен синтетический демо-профиль: ответственный, организация и примечание.";
  state.messageType = "success";
  render();
}

function bindEvents() {
  document.querySelectorAll("[data-screen]").forEach((button) => button.onclick = async () => {
    state.screen = button.dataset.screen;
    render();
    if (state.screen === "direct" && state.input && !state.pageInspection) await inspectDirectPage();
  });
  document.querySelectorAll("[data-rule]").forEach((button) => button.onclick = () => { state.selected = Number(button.dataset.rule); state.contentInspection = null; render(); });
  document.querySelector("#apply-preset-tz")?.addEventListener("click", applyPresetTZ);
  document.querySelectorAll("[data-detected-name]").forEach((button) => button.onclick = () => {
    const rule = ruleById("stamp-surnames");
    rule.match.text = button.dataset.detectedName;
    rule.match.role = button.dataset.detectedRole;
    rule.selector.pages = button.dataset.detectedPages || "all";
    state.message = `Выбрано: ${button.dataset.detectedRole} — ${button.dataset.detectedName} (стр. ${rule.selector.pages}).`;
    state.messageType = "info";
    render();
  });
  document.querySelectorAll("[data-bind]").forEach((element) => {
    const event = element.tagName === "SELECT" || element.type === "checkbox" || element.type === "color" ? "change" : "input";
    element.addEventListener(event, () => updateBinding(element));
  });
  document.querySelectorAll("[data-quick-toggle]").forEach((element) => element.onchange = () => {
    const id = element.dataset.quickToggle;
    ruleById(id).enabled = element.checked;
    if (id === "note-tch" && ruleById("note-gch")) ruleById("note-gch").enabled = element.checked;
    render();
  });
  document.querySelectorAll("[data-task-toggle]").forEach((element) => element.onchange = () => { state.task[element.dataset.taskToggle] = element.checked; syncTaskRules(); render(); });
  document.querySelector("#pick-input")?.addEventListener("click", chooseInput);
  document.querySelector("#pick-folder")?.addEventListener("click", chooseFolder);
  document.querySelector("#pick-output")?.addEventListener("click", chooseOutput);
  document.querySelector("#pick-font")?.addEventListener("click", chooseFont);
  document.querySelector("#pick-logo")?.addEventListener("click", () => chooseImage(ruleById("document-logo")));
  document.querySelector("#pick-rule-image")?.addEventListener("click", () => chooseImage(selectedRule()));
  document.querySelector("#previews")?.addEventListener("change", (event) => state.makePreviews = event.target.checked);
  document.querySelector("#run")?.addEventListener("click", runEngine);
  document.querySelector("#copy-run-log")?.addEventListener("click", copyRunLog);
  document.querySelector("#inspect-rule")?.addEventListener("click", inspectSelectedRule);
  document.querySelector("#import-profile")?.addEventListener("click", importProfile);
  document.querySelector("#export-profile")?.addEventListener("click", exportProfile);
  document.querySelector("#add-rule")?.addEventListener("click", addRule);
  document.querySelector("#add-rule-top")?.addEventListener("click", addRule);
  document.querySelector("#duplicate-rule")?.addEventListener("click", duplicateRule);
  document.querySelector("#delete-rule")?.addEventListener("click", deleteRule);
  document.querySelector("#add-page-operation")?.addEventListener("click", addPageOperation);
  document.querySelectorAll("[data-remove-page-operation]").forEach((button) => button.onclick = () => {
    state.pageOperations.splice(Number(button.dataset.removePageOperation), 1);
    render();
  });
  document.querySelectorAll("[data-pick-insert]").forEach((button) => button.onclick = () => chooseInsertPdf(Number(button.dataset.pickInsert)));
  document.querySelector("#open-previews-btn")?.addEventListener("click", () => { state.previewModalOpen = true; render(); });
  document.querySelector("#close-modal-btn")?.addEventListener("click", () => { state.previewModalOpen = false; render(); });
  document.querySelectorAll("[data-page]").forEach((btn) => btn.onclick = () => { state.selectedPreviewPage = Number(btn.dataset.page); render(); });
  document.querySelectorAll("[data-direct-span]").forEach((button) => button.onclick = () => {
    state.directSelectedSpan = Number(button.dataset.directSpan);
    state.directReplacement = state.pageInspection.spans[state.directSelectedSpan].text;
    state.directAction = "replace";
    render();
  });
  document.querySelector("#direct-prev")?.addEventListener("click", () => changeDirectPage(state.directPage - 1));
  document.querySelector("#direct-next")?.addEventListener("click", () => changeDirectPage(state.directPage + 1));
  document.querySelector("#direct-page-number")?.addEventListener("change", (event) => changeDirectPage(Number(event.target.value)));
  document.querySelector("#add-direct-rule")?.addEventListener("click", addDirectRule);
}

async function copyRunLog() {
  if (!state.progress) return;
  const report = buildDiagnosticReport(state.progress);
  try {
    await navigator.clipboard.writeText(report);
    state.message = "Журнал обработки скопирован в буфер обмена.";
    state.messageType = state.progress.failed ? "error" : "success";
  } catch {
    state.message = "Не удалось скопировать журнал автоматически. Раскройте журнал и скопируйте данные вручную.";
    state.messageType = "error";
  }
  render();
}

function updateBinding(element) {
  let value = element.type === "checkbox" ? element.checked : element.value;
  if (element.type === "number") value = Number(value);
  const bind = element.dataset.bind;
  if (bind?.startsWith("task.")) {
    state.task[bind.slice(5)] = value;
    syncTaskRules();
    return;
  }
  if (bind === "direct.action") {
    state.directAction = value;
    render();
    return;
  }
  if (bind === "direct.replacement") {
    state.directReplacement = value;
    return;
  }
  if (bind?.startsWith("pageop.")) {
    const [, indexText, property] = bind.split(".");
    state.pageOperations[Number(indexText)][property] = value;
    if (property === "type") render();
    return;
  }
  if (bind === "quick.surnameMode") {
    const surnameRule = ruleById("stamp-surnames");
    if (value === "all") surnameRule.match.text = "";
    render();
    return;
  }
  const quickMap = {
    "quick.role": ["stamp-surnames", "match.role"],
    "quick.pages": ["stamp-surnames", "selector.pages"],
    "quick.oldSurname": ["stamp-surnames", "match.text"],
    "quick.surname": ["stamp-surnames", "action.text"],
    "quick.oldOrg": ["stamp-organization", "match.text"],
    "quick.newOrg": ["stamp-organization", "action.text"],
    "quick.note": ["note-tch", "action.text"],
    "quick.oldText": ["document-text", "match.text"],
    "quick.newText": ["document-text", "action.text"],
    "quick.textPages": ["document-text", "selector.pages"],
    "quick.preserveStyle": ["document-text", "action.style.preserve_source_style"],
    "quick.logoMode": ["document-logo", "action.type"],
    "quick.oldLogoText": ["document-logo", "match.text"],
    "quick.newLogoText": ["document-logo", "action.text"],
    "quick.logoPages": ["document-logo", "selector.pages"],
    "quick.logoX": ["document-logo", "selector.region.x_mm"],
    "quick.logoY": ["document-logo", "selector.region.y_mm"],
    "quick.logoW": ["document-logo", "selector.region.width_mm"],
    "quick.logoH": ["document-logo", "selector.region.height_mm"],
  };
  if (bind === "quick.logoKind") {
    const logoRule = ruleById("document-logo");
    logoRule.action.content_kind = value;
    logoRule.match.type = value === "text" ? "exact_text" : "none";
    logoRule.action.type = value === "text" ? "replace" : "add_image";
    render();
  } else if (bind === "quick.years") {
    ruleById("stamp-surnames").match.years = String(value).split(",").map((item) => Number(item.trim())).filter(Boolean);
  } else if (quickMap[bind]) {
    const [id, path] = quickMap[bind]; setPath(ruleById(id), path, value);
    if (bind === "quick.note" && ruleById("note-gch")) ruleById("note-gch").action.text = value;
  } else if (bind?.startsWith("quick.")) {
    const style = ruleById("stamp-surnames").action.style;
    const names = { fontFamily: "font_family", fontSize: "font_size_pt", minFontSize: "min_font_size_pt", color: "color", align: "align", autoFit: "auto_fit" };
    style[names[bind.slice(6)]] = value;
    if (element.type === "color") render();
  } else if (bind) {
    if (bind === "match.years") value = String(value).split(",").map((item) => Number(item.trim())).filter(Boolean);
    setPath(selectedRule(), bind, value);
    state.contentInspection = null;
    if (element.tagName === "SELECT" && ["match.type", "action.type"].includes(bind)) render();
  }
}

async function inspectSelectedRule() {
  if (!state.input || !selectedRule()) return;
  state.inspectingContent = true;
  state.contentInspection = null;
  state.message = "Ищу совпадения без изменения документа…";
  state.messageType = "info";
  render();
  try {
    const request = { input_pdf: state.input, rule: selectedRule() };
    const output = await invoke("run_engine", { args: ["--inspect-rule-json", JSON.stringify(request)] });
    const result = JSON.parse(output.stdout.trim().split(/\r?\n/).at(-1) || output.stderr);
    if (!result.ok) throw new Error(result.error || "Не удалось выполнить поиск");
    state.contentInspection = result;
    state.message = result.count ? `Найдено совпадений: ${result.count}. Проверьте выделение и включите правило.` : "Совпадений не найдено. Измените условия поиска.";
    state.messageType = result.count ? "success" : "warning";
  } catch (error) {
    state.message = `Ошибка поиска: ${error.message || error}`;
    state.messageType = "error";
  } finally {
    state.inspectingContent = false;
    render();
  }
}

function syncTaskRules() {
  const task = state.task;
  const roleRule = ruleById("stamp-surnames");
  if (roleRule) {
    roleRule.enabled = task.roleEnabled && Boolean(task.newRoleName.trim());
    roleRule.match.type = "date_linked_name";
    roleRule.match.role = task.role;
    roleRule.match.text = task.oldRoleName.trim();
    roleRule.selector.pages = "all";
    roleRule.action.text = task.newRoleName.trim();
  }
  const organizationRule = ruleById("stamp-organization");
  if (organizationRule) {
    organizationRule.enabled = task.organizationEnabled && Boolean(task.newOrganization.trim());
    organizationRule.match.type = task.oldOrganization.trim() ? "exact_text" : "region_content";
    organizationRule.match.text = task.oldOrganization.trim();
    organizationRule.action.text = task.newOrganization.trim();
  }
  const textRule = ruleById("document-text");
  if (textRule) {
    textRule.enabled = task.textEnabled && Boolean(task.oldText.trim());
    textRule.match.type = "exact_text";
    textRule.match.text = task.oldText.trim();
    textRule.action.type = "replace";
    textRule.action.text = task.newText;
  }
  let clearRule = ruleById("task-clear-stamp");
  if (!clearRule) {
    clearRule = {
      id: "task-clear-stamp", name: "Обнулить заполнение штампа", enabled: false,
      selector: { pages: "all", orientation: "any", document_kind: "any", region: { anchor: "spds_title_block", x_mm: 0, y_mm: 0, width_mm: 185, height_mm: 55 } },
      match: { type: "stamp_values" },
      action: { type: "redact", style: { background: "#FFFFFF" } },
    };
    state.rules.push(clearRule);
  }
  clearRule.enabled = task.clearStampEnabled;
  clearRule.selector.pages = task.extractPages.trim() || "all";
  const extractionId = "task-extract-pages";
  const extractionIndex = state.pageOperations.findIndex((operation) => operation.id === extractionId);
  if (task.clearStampEnabled && task.extractPages.trim()) {
    const extraction = { id: extractionId, type: "extract", pages: task.extractPages.trim(), suffix: task.extractSuffix.trim() || "выбранные-листы", angle: 90, source_pdf: "", position: "end" };
    if (extractionIndex >= 0) state.pageOperations[extractionIndex] = extraction;
    else state.pageOperations.push(extraction);
  } else if (extractionIndex >= 0) {
    state.pageOperations.splice(extractionIndex, 1);
  }
}

async function inspectDirectPage() {
  if (!state.input) return;
  state.pageInspecting = true;
  state.directSelectedSpan = null;
  render();
  try {
    const output = await invoke("run_engine", { args: ["--inspect-page-json", JSON.stringify({ input_pdf: state.input, page: state.directPage })] });
    const result = JSON.parse(output.stdout.trim().split(/\r?\n/).at(-1) || output.stderr);
    if (!result.ok) throw new Error(result.error || "Не удалось открыть страницу");
    state.pageInspection = result;
    state.directPage = result.page;
  } catch (error) {
    state.pageInspection = null;
    state.message = `Ошибка прямого редактора: ${error.message || error}`;
    state.messageType = "error";
  } finally {
    state.pageInspecting = false;
    render();
  }
}

async function changeDirectPage(pageNumber) {
  const maximum = state.pageInspection?.page_count || 1;
  state.directPage = Math.max(1, Math.min(maximum, Number(pageNumber) || 1));
  await inspectDirectPage();
}

function addDirectRule() {
  const span = state.pageInspection?.spans[state.directSelectedSpan];
  if (!span) return;
  const pointsToMm = 25.4 / 72;
  const allFiles = document.querySelector("#direct-all-files")?.checked;
  const template = profile.rules.find((rule) => rule.id === "document-text") || profile.rules[0];
  const rule = clone(template);
  rule.id = `direct-${Date.now()}`;
  rule.name = `${state.directAction === "redact" ? "Удалить" : "Заменить"}: ${span.text.slice(0, 40)}`;
  rule.enabled = true;
  rule.selector.pages = allFiles ? "all" : String(state.directPage);
  rule.selector.orientation = "any";
  rule.selector.document_kind = "any";
  rule.selector.region = {
    anchor: "page",
    x_mm: Math.max(0, span.rect[0] * pointsToMm - 1),
    y_mm: Math.max(0, span.rect[1] * pointsToMm - 1),
    width_mm: (span.rect[2] - span.rect[0]) * pointsToMm + 2,
    height_mm: (span.rect[3] - span.rect[1]) * pointsToMm + 2,
  };
  rule.match = { type: "exact_text", text: span.text };
  rule.action.type = state.directAction;
  rule.action.text = state.directAction === "replace" ? state.directReplacement : "";
  rule.action.style.preserve_source_style = true;
  state.rules.push(rule);
  state.selected = state.rules.length - 1;
  state.message = `Операция добавлена: ${rule.name}.`;
  state.messageType = "success";
  state.screen = "content";
  render();
}

async function chooseInput() {
  const selected = await open({ multiple: true, filters: [{ name: "PDF", extensions: ["pdf"] }] });
  if (selected) {
    state.inputs = Array.isArray(selected) ? selected : [selected];
    state.sourceFolder = "";
    state.input = state.inputs[0];
    state.output = state.input.replace(/\.pdf$/i, "_изменён.pdf");
    state.outputDir = state.inputs.length > 1 ? parentPath(state.input) : "";
    state.pageInspection = null;
    state.directPage = 1;
    state.screen = "task";
    await inspectInput();
  }
}

async function chooseFolder() {
  const folder = await open({ directory: true, multiple: false });
  if (!folder) return;
  try {
    const files = await invoke("list_pdf_files", { folder });
    if (!files.length) throw new Error("В выбранной папке и подпапках нет PDF");
    state.sourceFolder = folder;
    state.inputs = files;
    state.input = files[0];
    state.output = "";
    state.outputDir = joinPath(folder, "Результат");
    state.pageInspection = null;
    state.directPage = 1;
    state.screen = "task";
    await inspectInput();
  } catch (error) {
    state.message = `Не удалось открыть папку: ${error.message || error}`;
    state.messageType = "error";
    render();
  }
}

function addPageOperation() {
  state.pageOperations.push({ id: `page-operation-${Date.now()}`, type: "delete", pages: "", angle: 90, suffix: "извлечено", source_pdf: "", position: "end" });
  render();
}

async function chooseInsertPdf(index) {
  const path = await open({ multiple: false, filters: [{ name: "PDF", extensions: ["pdf"] }] });
  if (path) {
    state.pageOperations[index].source_pdf = path;
    render();
  }
}

async function inspectInput() {
  state.inspecting = true;
  state.inspection = null;
  state.message = "Анализ структуры документа…";
  state.messageType = "info";
  render();
  try {
    const output = await invoke("run_engine", { args: ["--inspect-json", JSON.stringify({ input_pdf: state.input })] });
    const result = JSON.parse(output.stdout.trim().split(/\r?\n/).at(-1) || output.stderr);
    if (!result.ok) throw new Error(result.error || "Не удалось проанализировать документ");
    state.inspection = result;
    state.message = `Проанализировано ${result.page_count} страниц; штамп найден на ${result.detected_stamp_pages.length}. Выберите операции.`;
    state.messageType = result.sample ? "success" : "warning";
  } catch (error) {
    state.message = `Ошибка анализа: ${error.message || error}`;
    state.messageType = "error";
  } finally {
    state.inspecting = false;
    render();
  }
}

async function chooseOutput() {
  if (state.inputs.length > 1) {
    const path = await open({ directory: true, multiple: false });
    if (path) { state.outputDir = path; render(); }
  } else {
    const path = await save({ defaultPath: state.output || "результат.pdf", filters: [{ name: "PDF", extensions: ["pdf"] }] });
    if (path) { state.output = path; render(); }
  }
}

async function chooseFont() {
  const path = await open({ multiple: false, filters: [{ name: "Шрифты", extensions: ["ttf", "otf", "ttc"] }] });
  if (path) { ruleById("stamp-surnames").action.style.font_file = path; render(); }
}

async function chooseImage(rule) {
  const path = await open({ multiple: false, filters: [{ name: "Изображения", extensions: ["png", "jpg", "jpeg"] }] });
  if (path) { rule.action.image_path = path; render(); }
}

function addRule() {
  const template = ruleById("document-text") || profile.rules.find((rule) => rule.id === "document-text") || profile.rules[0];
  const fresh = clone(template);
  fresh.id = `rule-${Date.now()}`;
  fresh.name = "Новая операция с содержанием";
  fresh.enabled = true;
  fresh.selector.pages = "all";
  fresh.selector.orientation = "any";
  fresh.selector.document_kind = "any";
  fresh.selector.region = { anchor: "page", x_mm: 0, y_mm: 0, width_mm: 1000, height_mm: 1000 };
  fresh.match = { type: "exact_text", text: "" };
  fresh.action.text = "";
  state.rules.push(fresh);
  state.selected = state.rules.length - 1;
  render();
}

function duplicateRule() {
  const copy = clone(selectedRule());
  copy.id = `rule-${Date.now()}`;
  copy.name += " (копия)";
  state.rules.splice(state.selected + 1, 0, copy);
  state.selected++;
  render();
}

function deleteRule() {
  state.rules.splice(state.selected, 1);
  state.selected = Math.max(0, Math.min(state.selected, state.rules.length - 1));
  render();
}

async function exportProfile() {
  const path = await save({ defaultPath: "профиль-обработки.json", filters: [{ name: "JSON", extensions: ["json"] }] });
  if (!path) return;
  await invoke("write_text_file", { path, contents: JSON.stringify({ name: "Профиль обработки PDF", version: "0.0.1", rules: state.rules, page_operations: state.pageOperations }, null, 2) });
  state.message = `Профиль сохранён: ${path}`;
  state.messageType = "success";
  render();
}

async function importProfile() {
  const path = await open({ multiple: false, filters: [{ name: "JSON", extensions: ["json"] }] });
  if (!path) return;
  try {
    const data = JSON.parse(await invoke("read_text_file", { path }));
    if (!Array.isArray(data.rules)) throw new Error("В файле отсутствует список rules");
    state.rules = data.rules;
    state.pageOperations = Array.isArray(data.page_operations) ? data.page_operations : [];
    for (const builtin of profile.rules) {
      if (!state.rules.some((rule) => rule.id === builtin.id)) state.rules.push(clone(builtin));
    }
    state.selected = 0;
    state.message = "Профиль успешно загружен.";
    state.messageType = "success";
  } catch (error) {
    state.message = `Не удалось открыть профиль: ${error.message || error}`;
    state.messageType = "error";
  }
  render();
}

async function runEngine() {
  if (!state.inputs.length || (state.inputs.length === 1 ? !state.output : !state.outputDir)) {
    state.message = "Сначала выберите исходный PDF и путь сохранения.";
    state.messageType = "error";
    render();
    return;
  }
  if (!state.rules.some((rule) => rule.enabled) && !state.pageOperations.length) {
    state.message = "Добавьте хотя бы одну операцию с содержимым или страницами.";
    state.messageType = "error";
    render();
    return;
  }
  state.running = true;
  state.progress = { total: state.inputs.length, completed: 0, failed: 0, results: [] };
  state.previewPages = [];
  state.messageType = "info";
  render();

  for (let index = 0; index < state.inputs.length; index++) {
    const inputPdf = state.inputs[index];
    const outputPdf = state.inputs.length === 1 ? state.output : joinPath(state.outputDir, `${baseName(inputPdf)}_изменён.pdf`);
    state.message = `Обработка ${index + 1} из ${state.inputs.length}: ${shortPath(inputPdf)}`;
    render();
    const startedAt = performance.now();
    try {
      const job = { input_pdf: inputPdf, output_pdf: outputPdf, make_previews: state.makePreviews, rules: state.rules, page_operations: state.pageOperations };
      const output = await invoke("run_engine", { args: ["--job-json", JSON.stringify(job)] });
      const result = JSON.parse(output.stdout.trim().split(/\r?\n/).at(-1) || output.stderr);
      if (!result.ok) throw new Error(result.error || "Ошибка при выполнении движка");
      state.previewPages = Array.isArray(result.preview_pages) ? result.preview_pages : [];
      state.selectedPreviewPage = state.previewPages[0]?.page || 1;
      state.progress.completed++;
      state.progress.results.push({
        input: inputPdf,
        ok: true,
        operationCount: result.operation_count,
        requestId: result.request_id,
        durationMs: performance.now() - startedAt,
      });
    } catch (error) {
      state.progress.failed++;
      state.progress.results.push({
        input: inputPdf,
        ok: false,
        error: String(error.message || error),
        hint: error.hint || "Проверьте параметры операции и повторите попытку.",
        code: error.code || "UNEXPECTED_ERROR",
        stage: error.stage || "PDF-движок",
        status: error.status || null,
        requestId: error.requestId || "нет",
        durationMs: performance.now() - startedAt,
      });
    }
    render();
  }
  state.running = false;
  const firstError = state.progress.results.find((item) => !item.ok);
  state.message = firstError
    ? `${displayFileName(firstError.input)}: ${firstError.error} ${firstError.hint}`
    : `Готово! Обработано и скачано файлов: ${state.progress.completed}.`;
  state.messageType = state.progress.failed ? "error" : "success";
  render();
}

function parentPath(path) { return path.replace(/[\\/][^\\/]+$/, ""); }
function baseName(path) { return path.split(/[\\/]/).pop().replace(/\.pdf$/i, ""); }
function joinPath(folder, name) { return `${folder.replace(/[\\/]$/, "")}\\${name}`; }

render();
