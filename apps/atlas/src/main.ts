import "./style.css";
import { cacheClear } from "./ifc-cache";
import { CadBimViewer } from "./viewer-core";
import type { CameraSnapshot, ClipAxis, ClipDirection, MeasureReadout, StandardView } from "./viewer-core";
import type {
  CadBimElement,
  CadBimGraph,
  CadBimSourceResponse,
  IfcModelSource,
  IfcRenderResult,
  IfcSelection,
  ViewerModelRecord,
  ViewerStats,
} from "./types";

type LayerRow = { name: string; count: number; visible: boolean };
type QuickSource = { id: string; label: string; source: string; ifc?: never } | { id: string; label: string; ifc: string; source?: never };
type StructureModel = { id: string; label: string; elements: CadBimElement[] };
type AtlasUiMode = "viewer" | "modeler";
type DefaultModelResponse = {
  found?: boolean;
  name?: string;
  kind?: "json" | "ifc" | "ifczip" | "frag";
  url?: string;
  models?: IfcModelSource[];
  message?: string;
};
type PublicAtlasCatalogModel = {
  id: string;
  label: string;
  group: string;
  url: string;
  default: boolean;
};
type PublicAtlasCatalog = {
  repository: string;
  commit: string;
  license: string;
  models: PublicAtlasCatalogModel[];
};

const isStandaloneViewer = location.pathname.startsWith("/atlas") || location.pathname.includes("/locia-atlas");
const isPublicAtlasBuild = import.meta.env.VITE_PUBLIC_ATLAS === "1";
const modelerSearchParams = new URLSearchParams(window.location.search);
const isLocalViewerHost = location.hostname === "localhost" || location.hostname === "127.0.0.1" || location.hostname === "";
const isModelerSandbox = location.pathname === "/vv" || location.pathname.startsWith("/vv/") || (isLocalViewerHost && modelerSearchParams.get("modeler") === "1");
const standaloneDefaultSource = viewerAssetUrl("models/demo.cad_bim_graph.json");
let publicAtlasCatalog: PublicAtlasCatalog | null = null;

const BUILDINGSMART_DEMO_MODELS: IfcModelSource[] = isPublicAtlasBuild ? [] : [
  {
    id: "Building-Hvac",
    label: "Здание ОВ",
    url: viewerAssetUrl("ifc-sample/Building-Hvac.ifc"),
    jsonSourcePath: "JSON/Building-Hvac.cad_bim_graph.json",
  },
  {
    id: "Building-Architecture",
    label: "Здание архитектура",
    url: viewerAssetUrl("ifc-sample/Building-Architecture.ifc"),
    jsonSourcePath: "JSON/Building-Architecture.cad_bim_graph.json",
  },
  {
    id: "Building-Structural",
    label: "Здание конструкции",
    url: viewerAssetUrl("ifc-sample/Building-Structural.ifc"),
    jsonSourcePath: "JSON/Building-Structural.cad_bim_graph.json",
  },
  {
    id: "Building-Landscaping",
    label: "Здание благоустройство",
    url: viewerAssetUrl("ifc-sample/Building-Landscaping.ifc"),
    jsonSourcePath: "JSON/Building-Landscaping.cad_bim_graph.json",
  },
  {
    id: "Infra-Bridge",
    label: "Инфра мост",
    url: viewerAssetUrl("ifc-sample/Infra-Bridge.ifc"),
  },
  {
    id: "Infra-Plumbing",
    label: "Инфра сети",
    url: viewerAssetUrl("ifc-sample/Infra-Plumbing.ifc"),
  },
  {
    id: "Infra-Rail",
    label: "Инфра рельсы",
    url: viewerAssetUrl("ifc-sample/Infra-Rail.ifc"),
  },
  {
    id: "Infra-Road",
    label: "Инфра дорога",
    url: viewerAssetUrl("ifc-sample/Infra-Road.ifc"),
  },
];

// The public viewer loads only the attributed buildingSMART catalogue.
const LOCIA_SAMPLE_MODELS: IfcModelSource[] = [];

const QUICK_SOURCES: QuickSource[] = isPublicAtlasBuild
  ? []
  : isStandaloneViewer
  ? [
      { id: "default", label: "Модели", ifc: "default" },
    ]
  : [
      { id: "latest", label: "Последний", source: "" },
      { id: "demo-ifc", label: "Демо", ifc: "demo" },
    ];

const app = document.getElementById("app");
if (!app) throw new Error("Missing #app");

// Global safety net: any error outside the explicitly try/catch-wrapped load paths
// (viewer construction, @thatopen/ui internals, stray async handlers) would otherwise
// leave a blank or half-rendered screen. Show a friendly overlay instead — the viewer
// must never present an empty page.
let fatalOverlayShown = false;
function showFatalOverlay(detail: string): void {
  if (fatalOverlayShown) return;
  fatalOverlayShown = true;
  const overlay = document.createElement("div");
  overlay.className = "fatal-overlay";
  overlay.setAttribute("role", "alert");
  overlay.innerHTML = `
    <div class="fatal-overlay__card">
      <strong>Атлас не смог отобразить сцену</strong>
      <p>Произошла непредвиденная ошибка. Попробуйте перезагрузить страницу.</p>
      <pre class="fatal-overlay__detail"></pre>
      <div class="fatal-overlay__actions">
        <button type="button" id="fatal-reload">Перезагрузить</button>
        <button type="button" id="fatal-dismiss">Скрыть</button>
      </div>
    </div>
  `;
  const detailNode = overlay.querySelector(".fatal-overlay__detail");
  if (detailNode) detailNode.textContent = detail.slice(0, 600);
  document.body.appendChild(overlay);
  overlay.querySelector<HTMLButtonElement>("#fatal-reload")?.addEventListener("click", () => window.location.reload());
  overlay.querySelector<HTMLButtonElement>("#fatal-dismiss")?.addEventListener("click", () => {
    overlay.remove();
    fatalOverlayShown = false;
  });
}
window.addEventListener("error", (event) => {
  showFatalOverlay(event.error instanceof Error ? `${event.error.message}\n${event.error.stack || ""}` : String(event.message || "Ошибка скрипта"));
});
window.addEventListener("unhandledrejection", (event) => {
  const reason = (event as PromiseRejectionEvent).reason;
  showFatalOverlay(reason instanceof Error ? `${reason.message}\n${reason.stack || ""}` : String(reason));
});

// Theme: light is the native default (see style.css). Allow switching to dark via
// ?theme=dark or a remembered choice. Applied before render to avoid a flash.
const THEME_STORAGE_KEY = "locia-atlas-theme";
const UI_MODE_STORAGE_KEY = "locia-atlas-ui-mode";
function readStoredTheme(): string | null {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    return null;
  }
}
function readStoredUiMode(): AtlasUiMode {
  if (!isModelerSandbox) return "viewer";
  try {
    return localStorage.getItem(UI_MODE_STORAGE_KEY) === "modeler" ? "modeler" : "viewer";
  } catch {
    return "viewer";
  }
}
const themeParam = new URLSearchParams(window.location.search).get("theme");
const initialTheme = themeParam === "dark" || themeParam === "light" ? themeParam : readStoredTheme();
const modeParam = modelerSearchParams.get("mode");
const initialUiMode: AtlasUiMode = isModelerSandbox && (modeParam === "modeler" || readStoredUiMode() === "modeler") ? "modeler" : "viewer";
if (initialTheme === "dark") {
  document.documentElement.dataset.theme = "dark";
} else if (initialTheme === "light") {
  delete document.documentElement.dataset.theme;
}
if (themeParam === "dark" || themeParam === "light") {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, themeParam);
  } catch {
    /* storage unavailable — theme still applies for this session */
  }
}

app.innerHTML = `
  <main class="shell" data-tab="inspect" data-mode="${initialUiMode}">
    <header class="topbar">
      <div class="brand">
        <strong>${isPublicAtlasBuild ? "АТЛАС" : "ЛОЦИЯ АТЛАС"}</strong>
        ${
          isPublicAtlasBuild
            ? `<span>IFC · <a href="https://github.com/buildingSMART/Sample-Test-Files" target="_blank" rel="noreferrer">buildingSMART · CC BY 4.0</a></span>`
            : `<span>IFC / JSON / FRAG</span>`
        }
      </div>
      <form class="toolbar" id="load-form">
        <!-- Поле ручного ввода пути скрыто: обычные пользователи открывают модели
             по ссылке из проекта, а ad-hoc файл проще добавить кнопкой «Добавить».
             Элемент оставлен в DOM (скрыт), т.к. на него ссылается логика загрузки. -->
        <input id="source-path" placeholder="Путь к источнику" autocomplete="off" hidden />
        <input id="add-file-input" type="file" accept=".json,.ifc,.ifczip,application/json" multiple hidden />
      </form>
      <nav class="quickbar" aria-label="Быстрые источники">
        ${QUICK_SOURCES.map((item) => `<button type="button" data-source-id="${item.id}">${escapeHtml(item.label)}</button>`).join("")}
      </nav>
      ${
        isPublicAtlasBuild
          ? `<form class="public-model-picker" id="public-model-form">
               <label for="public-model-select">Демо-модель</label>
               <select id="public-model-select" aria-label="Публичная модель buildingSMART"><option>Загрузка каталога…</option></select>
               <button type="submit">Открыть</button>
             </form>`
          : ""
      }
      <div class="toolstrip" role="toolbar" aria-label="Управление сценой">
        ${isStandaloneViewer ? "" : `<button type="button" id="load-default-model" class="default-model-btn" title="Загрузить модель по умолчанию из папки models">Модель</button>`}
        ${isModelerSandbox ? `<button type="button" id="modeler-toggle-btn" class="modeler-toggle" aria-pressed="${initialUiMode === "modeler" ? "true" : "false"}" title="Переключить режим рисования">${initialUiMode === "modeler" ? "Выйти из Замодельки" : "Замоделька!"}</button>` : ""}
        <button type="button" id="top-add-file-btn" title="Загрузить IFC, IFCZIP, FRAG или JSON с компьютера">Загрузить</button>
        <button type="button" id="fit-btn" title="Вписать сцену">Вписать</button>
        <div class="view-switch" role="group" aria-label="Стандартные виды">
          <button type="button" class="active" data-standard-view="3d" title="Перспективный 3D-вид">3D</button>
          <button type="button" data-standard-view="top" title="План сверху с автоматическим сечением">План</button>
          <button type="button" data-standard-view="front" title="Фасад спереди с автоматическим сечением">Фасад</button>
          <button type="button" data-standard-view="right" title="Вид справа с автоматическим сечением">Справа</button>
        </div>
        <details class="header-popover" id="clip-menu">
          <summary title="Плоскость и кубическое сечение">Сечение <span id="clip-badge">0</span></summary>
          <div class="header-popover__panel">
            <div class="header-popover__title">Плоскость</div>
            <label class="control-row compact">
              <span>Включено</span>
              <input id="clip-enabled" type="checkbox" />
            </label>
            <label class="control-row compact">
              <span>Плоскость</span>
              <select id="clip-axis">
                <option value="y">Горизонтальная Y</option>
                <option value="x">Вертикальная X</option>
                <option value="z">Вертикальная Z</option>
              </select>
            </label>
            <label class="control-row compact">
              <span>Сторона</span>
              <select id="clip-direction">
                <option value="1">+Y вверх</option>
                <option value="-1">-Y вниз</option>
              </select>
            </label>
            <label class="control-row compact range-row">
              <span>Позиция</span>
              <input id="clip-offset" type="range" min="0" max="100" value="50" />
            </label>
            <div class="popover-actions">
              <button type="button" id="clip-mid">По центру</button>
            </div>
            <div class="header-popover__title header-popover__title--box">Куб сечения</div>
            <label class="control-row compact">
              <span>Включён</span>
              <input id="clip-box-enabled" type="checkbox" />
            </label>
            <label class="control-row compact range-row">
              <span>Размер</span>
              <input id="clip-box-size" type="range" min="5" max="100" value="100" />
            </label>
            <div class="popover-actions popover-actions--two">
              <button type="button" id="clip-box-scene">По модели</button>
              <button type="button" id="clip-box-selected">По выбранному</button>
            </div>
            <button type="button" id="clip-clear" class="popover-clear">Убрать всё</button>
            <div class="tool-info" id="clip-info">Сечение выключено</div>
          </div>
        </details>
        <button type="button" id="reload-btn" title="Заново загрузить текущую модель: сбрасывает скрытия/изоляцию, замеры, сечения и подсветку, подтягивает обновлённый файл с сервера">Обновить</button>
        <button type="button" id="copy-link-btn" title="Скопировать ссылку на эту модель для пересылки по почте" hidden>Ссылка</button>
        ${isPublicAtlasBuild ? "" : `<button type="button" id="atlas-task-btn" title="Создать задачу в Лоции из текущей пометки. Если проект не передан ссылкой, его можно выбрать в форме задачи." hidden>Задача</button>`}
      </div>
      <div class="status" id="status">запуск...</div>
    </header>

    <section class="viewport-wrap">
      <div id="viewer"></div>
      <div class="hud" id="hud"></div>
      <div class="nav-cube-stage" aria-label="Навигационный куб">
        <div class="nav-cube">
          <button class="nav-cube__face nav-cube__face--top" type="button" data-standard-view="top" aria-label="Вид сверху">Верх</button>
          <button class="nav-cube__face nav-cube__face--front" type="button" data-standard-view="front" aria-label="Вид спереди">Фронт</button>
          <button class="nav-cube__face nav-cube__face--right" type="button" data-standard-view="right" aria-label="Вид справа">Право</button>
        </div>
        <button class="nav-cube__home active" type="button" data-standard-view="3d" aria-label="Изометрический 3D-вид" title="Изометрия">◆</button>
      </div>
      ${isPublicAtlasBuild ? "" : `<div class="walk-hint" id="walk-hint" hidden>
        <strong>WASD</strong>
        <span id="walk-hint-text">Кликни по окну для обзора мышью</span>
        <small>WASD · Q/E высота · Shift ускорение · Esc курсор</small>
      </div>`}
      ${isModelerSandbox ? `
      <div class="modeler-palette" aria-label="Инструменты Замодельки">
        <button type="button" class="active" data-modeler-tool="select" title="Выбор">Выбор</button>
        <button type="button" data-modeler-tool="wall" title="Стена">Стена</button>
        <button type="button" data-modeler-tool="duct" title="Воздуховод">Воздуховод</button>
        <button type="button" data-modeler-tool="tray" title="Лоток">Лоток</button>
        <button type="button" data-modeler-tool="pipe" title="Труба">Труба</button>
      </div>` : ""}
    </section>

    <aside class="side">
      ${isModelerSandbox ? `
      <section class="panel modeler-panel" id="modeler-panel">
        <div class="panel-title">
          <h2>Замоделька</h2>
          <span class="pill tiny">local</span>
        </div>
        <div class="modeler-actions">
          <button type="button" class="active" data-modeler-tool="select">Выбор</button>
          <button type="button" data-modeler-tool="wall">Стена</button>
          <button type="button" data-modeler-tool="duct">Воздуховод</button>
          <button type="button" data-modeler-tool="tray">Лоток</button>
        </div>
        <div class="modeler-fields">
          <label class="control-row">
            <span>Отметка</span>
            <input type="number" value="0" step="100" disabled />
          </label>
          <label class="control-row">
            <span>Шаг угла</span>
            <select disabled>
              <option>5°</option>
            </select>
          </label>
        </div>
        <div class="tool-info">Локальный режим. Сохранение в Лоцию отключено.</div>
      </section>` : ""}
      <section class="panel panel-hero">
        <div class="panel-title">
          <h2>Граф</h2>
          <span id="mode-pill" class="pill">JSON</span>
        </div>
        <div class="stats" id="stats"></div>
        <div class="source-meta" id="source-meta"></div>
      </section>

      <div class="tabs" role="tablist" aria-label="Панели">
        <button type="button" role="tab" aria-selected="true" class="active" data-tab="inspect">Инфо</button>
        <button type="button" role="tab" aria-selected="false" data-tab="tools">Инструменты</button>
        <button type="button" role="tab" aria-selected="false" data-tab="models">Модели</button>
        <button type="button" role="tab" aria-selected="false" data-tab="structure">Структура</button>
        <button type="button" role="tab" aria-selected="false" data-tab="layers">Слои</button>
        ${isStandaloneViewer ? "" : `<button type="button" role="tab" aria-selected="false" data-tab="source">Источник</button>`}
      </div>

      <section class="panel tab-panel" data-panel="inspect">
        <h2>Выбрано</h2>
        <div id="selected" class="empty">Ничего не выбрано</div>
      </section>

      <section class="panel tab-panel" data-panel="tools">
        <h2>Инструменты</h2>
        <div class="tool-card">
          <div class="tool-title">Выбор</div>
          <div class="tool-grid">
            <button type="button" id="tool-fit-selected">Вписать</button>
            <button type="button" id="tool-isolate">Изолировать</button>
            <button type="button" id="tool-hide">Скрыть</button>
            <button type="button" id="tool-show-all">Показать все</button>
          </div>
          <div class="tool-info" id="tool-selection-info">Ничего не выбрано</div>
        </div>
        <div class="tool-card">
          <div class="tool-title">Замеры</div>
          <div class="tool-grid">
            <button type="button" id="measure-distance" title="Замер по точкам: кликни две точки на геометрии">Расстояние</button>
            <button type="button" id="measure-gap" title="Зазор между двумя элементами: выбери первый и нажми, затем второй и нажми ещё раз">Зазор элем.</button>
            <button type="button" id="measure-clear">Очистить</button>
          </div>
          <div class="measure-axis" id="measure-axis" role="group" aria-label="Фиксация оси замера">
            <span class="measure-axis__label">Ось:</span>
            <button type="button" data-axis="free" class="active" title="Свободный замер по двум точкам">Свободно</button>
            <button type="button" data-axis="y" title="Замер строго по вертикали (высота)">↕ Высота</button>
            <button type="button" data-axis="x" title="Замер строго вдоль горизонтальной оси X (в плане)">X план</button>
            <button type="button" data-axis="z" title="Замер строго вдоль горизонтальной оси Z (в плане)">Z план</button>
          </div>
          <div class="measure-readout" id="measure-readout">
            <div class="tool-info" id="measure-info">Замер выключен. Координаты точки, ΔX/ΔY/ΔZ и прямое — в этой панели; фиксация оси даёт орто-замер.</div>
          </div>
        </div>
      </section>

      <section class="panel tab-panel" data-panel="models">
        <div class="panel-title">
          <h2>Модели</h2>
          <span class="muted" id="model-count">0</span>
        </div>
        <div class="tool-grid model-actions">
          <button type="button" id="models-show-all">Показать все</button>
          <button type="button" id="models-fit-all">Вписать все</button>
          <button type="button" id="add-file-btn" title="Открыть локальный файл модели (JSON / IFC) с этого компьютера. Для пересылки коллегам модель регистрируется в проекте.">Добавить файл</button>
        </div>
        <div class="list" id="models"></div>
      </section>

      <section class="panel tab-panel" data-panel="structure">
        <div class="panel-title">
          <h2>Структура</h2>
          <span class="muted" id="structure-count">0</span>
        </div>
        <div class="layer-tools">
          <input id="structure-filter" type="search" placeholder="Имя, тип, уровень или ID" autocomplete="off" aria-label="Поиск элементов в моделях" />
        </div>
        <div class="list structure-list" id="structure"></div>
      </section>

      <section class="panel tab-panel" data-panel="layers">
        <div class="panel-title">
          <h2>Слои</h2>
          <span class="muted" id="layer-count">0</span>
        </div>
        <div class="layer-tools">
          <input id="layer-filter" placeholder="Фильтр" autocomplete="off" />
          <button type="button" id="layers-all">Все</button>
          <button type="button" id="layers-none">Ничего</button>
        </div>
        <div class="chips-row" id="layer-solos"></div>
        <div class="list" id="layers"></div>
      </section>

      ${isStandaloneViewer ? "" : `
      <section class="panel tab-panel" data-panel="source">
        <h2>Источник</h2>
        <div class="source-card" id="source-card"></div>
      </section>`}
    </aside>
  </main>
`;

const viewerNode = document.getElementById("viewer")!;
const statusNode = document.getElementById("status")!;
const sourceInput = document.getElementById("source-path") as HTMLInputElement;
const addFileInput = document.getElementById("add-file-input") as HTMLInputElement;
const statsNode = document.getElementById("stats")!;
const layersNode = document.getElementById("layers")!;
const modelsNode = document.getElementById("models")!;
const modelCountNode = document.getElementById("model-count")!;
const structureNode = document.getElementById("structure")!;
const structureFilterInput = document.getElementById("structure-filter") as HTMLInputElement;
const structureCountNode = document.getElementById("structure-count")!;
const selectedNode = document.getElementById("selected")!;
const hudNode = document.getElementById("hud")!;
const form = document.getElementById("load-form") as HTMLFormElement;
const sourceMetaNode = document.getElementById("source-meta")!;
// В standalone вкладка «Источник» скрыта — узла может не быть.
const sourceCardNode = document.getElementById("source-card");
const shellNode = document.querySelector(".shell") as HTMLElement;
const modelerToggleBtn = document.getElementById("modeler-toggle-btn") as HTMLButtonElement | null;
const modePillNode = document.getElementById("mode-pill")!;
const layerFilterInput = document.getElementById("layer-filter") as HTMLInputElement;
const layerCountNode = document.getElementById("layer-count")!;
const layerSolosNode = document.getElementById("layer-solos")!;
const toolSelectionInfoNode = document.getElementById("tool-selection-info")!;
const clipEnabledInput = document.getElementById("clip-enabled") as HTMLInputElement;
const clipAxisInput = document.getElementById("clip-axis") as HTMLSelectElement;
const clipDirectionInput = document.getElementById("clip-direction") as HTMLSelectElement;
const clipOffsetInput = document.getElementById("clip-offset") as HTMLInputElement;
const clipInfoNode = document.getElementById("clip-info")!;
const clipBadgeNode = document.getElementById("clip-badge")!;
const clipBoxEnabledInput = document.getElementById("clip-box-enabled") as HTMLInputElement;
const clipBoxSizeInput = document.getElementById("clip-box-size") as HTMLInputElement;
const walkHintNode = document.getElementById("walk-hint") as HTMLElement | null;
const walkHintTextNode = document.getElementById("walk-hint-text");
const publicModelForm = document.getElementById("public-model-form") as HTMLFormElement | null;
const publicModelSelect = document.getElementById("public-model-select") as HTMLSelectElement | null;
const clipMenuNode = document.getElementById("clip-menu") as HTMLDetailsElement;
const clipPanelNode = clipMenuNode.querySelector(".header-popover__panel") as HTMLElement;
function positionClipPanel(): void {
  if (!clipMenuNode.open || clipPanelNode.parentElement !== document.body) return;
  const anchor = clipMenuNode.getBoundingClientRect();
  const mobile = window.matchMedia("(max-width: 860px)").matches;
  const viewportGap = 8;
  const top = Math.max(viewportGap, anchor.bottom + viewportGap);
  clipPanelNode.classList.add("header-popover__panel--portal");
  clipPanelNode.style.top = `${top}px`;
  clipPanelNode.style.maxHeight = `${Math.max(120, window.innerHeight - top - viewportGap)}px`;
  if (mobile) {
    clipPanelNode.style.left = `${viewportGap}px`;
    clipPanelNode.style.right = `${viewportGap}px`;
    clipPanelNode.style.width = "auto";
    return;
  }
  const width = Math.min(330, window.innerWidth - viewportGap * 2);
  const left = Math.max(viewportGap, Math.min(anchor.right - width, window.innerWidth - width - viewportGap));
  clipPanelNode.style.left = `${left}px`;
  clipPanelNode.style.right = "auto";
  clipPanelNode.style.width = `${width}px`;
}

function restoreClipPanel(): void {
  clipPanelNode.classList.remove("header-popover__panel--portal");
  clipPanelNode.removeAttribute("style");
  clipMenuNode.append(clipPanelNode);
}

clipMenuNode.addEventListener("toggle", () => {
  if (clipMenuNode.open) {
    document.body.append(clipPanelNode);
    positionClipPanel();
  } else {
    restoreClipPanel();
  }
});
window.addEventListener("resize", positionClipPanel);
window.addEventListener("scroll", positionClipPanel, true);
const measureReadoutNode = document.getElementById("measure-readout")!;

const params = new URLSearchParams(window.location.search);
const initialSource = params.get("source_path") || params.get("source") || "";
const initialIfc = params.get("ifc") || params.get("ifc_path") || "";
const initialFrag = params.get("frag") || "";
const initialLinkedModels = linkedIfcModelsFromParams(params.get("models") || "");
const highlightIds = new Set(
  (params.get("highlight") || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
);
sourceInput.value = initialSource;

let viewer: CadBimViewer;
let latestSource = initialSource;
let currentIfcSelection = "default";
let currentIfcFrag = initialFrag;
let currentMode: "json" | "ifc" = "json";
let currentLayers: LayerRow[] = [];
let currentSource: CadBimSourceResponse | null = null;
let currentStats: ViewerStats | null = null;
let selectedElement: CadBimElement | null = null;
let selectedIfc: IfcSelection | null = null;
let currentModels: ViewerModelRecord[] = [];
let measureEnabled = false;
const semanticByGlobalId = new Map<string, CadBimElement>();
const structureModels = new Map<string, StructureModel>();
let uiMode: AtlasUiMode = initialUiMode;

function setUiMode(mode: AtlasUiMode, announce = false): void {
  uiMode = mode;
  shellNode.dataset.mode = mode;
  if (modelerToggleBtn) {
    modelerToggleBtn.textContent = mode === "modeler" ? "Выйти из Замодельки" : "Замоделька!";
    modelerToggleBtn.setAttribute("aria-pressed", mode === "modeler" ? "true" : "false");
  }
  if (isModelerSandbox) {
    try {
      localStorage.setItem(UI_MODE_STORAGE_KEY, mode);
    } catch {
      /* storage unavailable — the visual mode still switches */
    }
  }
  if (announce) {
    setStatus(mode === "modeler" ? "режим рисования включён" : "режим просмотра включён");
  }
}

async function boot(): Promise<void> {
  if (isPublicAtlasBuild) await loadPublicAtlasCatalog();
  viewer = await CadBimViewer.create(viewerNode);
  (window as unknown as { __lociaAtlasViewer?: CadBimViewer }).__lociaAtlasViewer = viewer;
  viewer.onSelect = renderSelected;
  viewer.onIfcSelect = renderIfcSelected;
  viewer.onModelsChange = renderModels;
  viewer.onMeasureReadout = renderMeasureReadout;
  viewer.onNavigationChange = (mode, captured) => {
    const walking = mode === "walk";
    if (walkHintNode) walkHintNode.hidden = !walking;
    if (walkHintTextNode) walkHintTextNode.textContent = captured ? "Мышь управляет взглядом" : "Кликни по окну для обзора мышью";
  };
  if (initialLinkedModels.length) {
    currentIfcSelection = "linked";
    await loadIfcModels(initialLinkedModels);
  } else if (initialIfc) {
    await loadIfcSelection(initialIfc);
  } else if (initialFrag) {
    // Прямая ссылка на готовые фрагменты (.frag) — тяжёлая модель, заранее
    // сконвертированная и зарегистрированная как модель проекта. web-ifc не нужен.
    await loadFragOnly(initialFrag);
  } else if (isStandaloneViewer && !initialSource) {
    await loadDefaultModel();
  } else {
    await loadGraph(initialSource);
  }
  await applyInitialAtlasView();
  if (!isPublicAtlasBuild && !window.matchMedia("(pointer: coarse)").matches) {
    await viewer.setWalkMode(true);
  }
}

function jsonParam(name: string): unknown {
  const raw = params.get(name) || "";
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function applyInitialAtlasView(): Promise<void> {
  const viewpoint = jsonParam("viewpoint") as CameraSnapshot | null;
  if (viewpoint) {
    viewer.applyCameraSnapshot(viewpoint);
  }

  const overlay = jsonParam("atlas_overlay") as Record<string, unknown> | null;
  const localId = Number(overlay?.local_id ?? params.get("local_id") ?? NaN);
  const modelId = String(overlay?.model_id ?? params.get("model_id") ?? "");
  const globalId = String(overlay?.global_id ?? params.get("global_id") ?? "");

  if (currentMode === "ifc") {
    if (modelId && Number.isFinite(localId)) {
      await viewer.ifcSelectByLocalId(modelId, localId);
      return;
    }
    if (globalId) {
      await viewer.highlightIfcGlobalIds([globalId]);
    }
  }
}

async function loadFragOnly(fragUrl: string): Promise<void> {
  currentIfcSelection = "";
  const label = (fragUrl.split("/").pop() || "Модель").replace(/\.(frag|fragments)$/i, "") || "Модель";
  // url оставляем пустым: грузим строго предсобранные фрагменты (fragUrl), без IFC-парсинга.
  await loadIfcModels([{ id: "project-frag", label, url: "", fragUrl }]);
}

async function loadGraph(sourcePath: string): Promise<void> {
  currentMode = "json";
  setStatus("загрузка...");
  try {
    latestSource = sourcePath;
    const data = await requestCadBimSource(sourcePath);
    structureModels.clear();
    jsonStructureItemState.clear();
    const result = viewer.render(data.payload, highlightIds, {
      source: data.source || sourcePath || "последний",
      label: sourceLabel(data.payload, data.source || sourcePath || "последний"),
    });
    registerStructureModel(result.modelId, sourceLabel(data.payload, data.source || sourcePath || "последний"), result.elements);
    currentSource = data;
    currentStats = result.stats;
    renderStats(result.stats);
    renderLayers(result.stats);
    renderStructure();
    renderSelected(null);
    renderHud(data, result.stats);
    renderSource(data, result.stats);
    setStatus(`${data.source || "последний"} | элементов: ${formatNumber(data.element_count || result.stats.elements)}`);
    const focusId = params.get("focus") || [...highlightIds][0] || "";
    if (focusId) viewer.focusElement(focusId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(message, true);
    selectedNode.innerHTML = `<div class="empty error">${escapeHtml(message)}</div>`;
    renderStandaloneEmpty();
  }
}

async function loadIfcSelection(selection: string): Promise<void> {
  if (isPublicAtlasBuild) {
    const models = publicModelsForSelection(selection);
    if (!models.length) throw new Error("Публичная модель не найдена в каталоге buildingSMART");
    currentIfcSelection = selection || "default";
    await loadIfcModels(models);
    return;
  }
  if (selection.trim() === "default") {
    await loadDefaultModel();
    return;
  }
  currentIfcSelection = selection;
  const models = ifcModelsFromSelection(selection);
  // Для одиночной модели проекта подключаем серверный кеш фрагментов (?frag=…):
  // сначала пробуем готовые фрагменты, после первого разбора IFC отправляем их туда.
  if (currentIfcFrag && models.length === 1) {
    models[0] = { ...models[0], fragUrl: currentIfcFrag, fragCacheUrl: currentIfcFrag };
  }
  await loadIfcModels(models);
}

async function loadIfcModels(models: IfcModelSource[]): Promise<void> {
  currentMode = "ifc";
  modePillNode.textContent = "IFC";
  setStatus("загрузка IFC...");
  try {
    renderSelected(null);
    currentSource = null;
    currentStats = null;
    currentLayers = [];
    structureModels.clear();
    resetIfcPanels();
    structureNode.innerHTML = `<div class="empty">Структура строится при открытии вкладки «Структура»</div>`;
    layersNode.innerHTML = `<div class="empty">Слои строятся при открытии вкладки «Слои»</div>`;
    layerSolosNode.innerHTML = "";
    layerCountNode.textContent = "0";
    await loadSemanticModels(models);
    const result = await viewer.renderIfcModels(models, setStatus);
    renderIfcStats(result);
    renderIfcHud(result);
    renderIfcSource(result);
    setStatus(`IFC-сцена | загружено моделей: ${result.loaded}/${result.models.length}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(message, true);
    selectedNode.innerHTML = `<div class="empty error">${escapeHtml(message)}</div>`;
  }
}

async function loadPublicAtlasCatalog(): Promise<void> {
  const response = await fetch(viewerAssetUrl("models/buildingsmart/catalog.json"), {
    headers: { Accept: "application/json" },
  });
  const data = (await response.json().catch(() => null)) as PublicAtlasCatalog | null;
  if (!response.ok || !data || !Array.isArray(data.models)) {
    throw new Error(`Каталог buildingSMART недоступен (${response.status})`);
  }
  const models = data.models.filter(
    (model) =>
      model &&
      typeof model.id === "string" &&
      typeof model.label === "string" &&
      typeof model.group === "string" &&
      typeof model.url === "string" &&
      /^models\/buildingsmart\/(?:ifc4|ifc4x3)\/.+\.ifc$/i.test(model.url),
  );
  if (!models.length || !models.some((model) => model.default)) {
    throw new Error("Каталог buildingSMART пуст или не содержит стартовой сцены");
  }
  publicAtlasCatalog = { ...data, models };
  renderPublicAtlasCatalog();
}

function renderPublicAtlasCatalog(): void {
  if (!publicModelSelect || !publicAtlasCatalog) return;
  const groups = new Map<string, PublicAtlasCatalogModel[]>();
  for (const model of publicAtlasCatalog.models) {
    const rows = groups.get(model.group) || [];
    rows.push(model);
    groups.set(model.group, rows);
  }
  const defaultCount = publicAtlasCatalog.models.filter((model) => model.default).length;
  publicModelSelect.innerHTML = `<option value="default">Здание IFC4 · комплект (${defaultCount})</option>${[...groups.entries()]
    .map(
      ([group, models]) =>
        `<optgroup label="${escapeHtml(group)}"><option value="group:${escapeHtml(group)}">Весь набор (${models.length})</option>${models
          .map((model) => `<option value="${escapeHtml(model.id)}">${escapeHtml(model.label)}</option>`)
          .join("")}</optgroup>`,
    )
    .join("")}`;
  publicModelSelect.value = "default";
}

function publicModelsForSelection(selection: string): IfcModelSource[] {
  if (!publicAtlasCatalog) return [];
  const normalized = selection.trim() || "default";
  const selected = normalized === "default"
    ? publicAtlasCatalog.models.filter((model) => model.default)
    : normalized.startsWith("group:")
      ? publicAtlasCatalog.models.filter((model) => model.group === normalized.slice(6))
      : publicAtlasCatalog.models.filter((model) => model.id === normalized);
  return selected.map((model) => ({
    id: model.id,
    label: model.label,
    url: viewerAssetUrl(model.url),
  }));
}

async function loadDefaultModel(): Promise<void> {
  if (isPublicAtlasBuild) {
    currentIfcSelection = "default";
    await loadIfcModels(publicModelsForSelection("default"));
    return;
  }
  setStatus("поиск модели по умолчанию...");
  try {
    const response = await fetch(viewerAssetUrl("api/default-model"), {
      headers: { Accept: "application/json" },
    });
    const data = (await response.json().catch(() => null)) as DefaultModelResponse | null;
    if (!response.ok || !data?.found || !data.url || !data.kind) {
      throw new Error(data?.message || `Модель по умолчанию не найдена (${response.status})`);
    }

    const label = data.name || "Модель по умолчанию";
    sourceInput.value = data.url || "";
    const models = Array.isArray(data.models)
      ? data.models
          .slice(0, 50)
          .map((model, index): IfcModelSource | null => {
            if (!model || typeof model !== "object") return null;
            const url = typeof model.url === "string" ? model.url.trim() : "";
            const fragUrl = typeof model.fragUrl === "string" ? model.fragUrl.trim() : "";
            const fragCacheUrl = typeof model.fragCacheUrl === "string" ? model.fragCacheUrl.trim() : "";
            if (!url && !fragUrl) return null;
            return {
              id: typeof model.id === "string" && model.id.trim() ? model.id.trim() : uniqueModelId(model.label || `Модель ${index + 1}`),
              label: typeof model.label === "string" && model.label.trim() ? model.label.trim() : `Модель ${index + 1}`,
              url: url ? directIfcUrl(url) : "",
              ...(fragUrl ? { fragUrl: directIfcUrl(fragUrl) } : {}),
              ...(fragCacheUrl ? { fragCacheUrl: directIfcUrl(fragCacheUrl) } : {}),
            };
          })
          .filter((model): model is IfcModelSource => model !== null)
      : [];
    if (models.length) {
      currentIfcSelection = "default";
      await loadIfcModels(models);
      return;
    }

    const sourceUrl = viewerAssetUrl(data.url);
    if (data.kind === "json") {
      await loadGraph(sourceUrl);
      return;
    }
    if (data.kind === "frag") {
      await loadFragOnly(sourceUrl);
      return;
    }

    await loadIfcModels([
      {
        id: uniqueModelId(label),
        label,
        url: sourceUrl,
      },
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(message, true);
    selectedNode.innerHTML = `<div class="empty error">${escapeHtml(message)}</div>`;
  }
}

async function addLocalFiles(files: FileList | File[]): Promise<void> {
  const items = Array.from(files);
  if (!items.length) return;
  setStatus(`добавление файлов: ${items.length}...`);
  for (const file of items) {
    const extension = file.name.split(".").pop()?.toLowerCase() || "";
    if (extension === "json") {
      await addLocalJson(file);
      continue;
    }
    if (extension === "ifc" || extension === "ifczip") {
      await addLocalIfc(file);
      continue;
    }
    setStatus(`неподдерживаемый файл: ${file.name}`, true);
  }
}

async function addLocalJson(file: File): Promise<void> {
  const payload = JSON.parse(await file.text()) as CadBimGraph | CadBimElement[];
  const modelId = uniqueModelId(file.name);
  const result = viewer.addJsonModel(payload, highlightIds, {
    id: modelId,
    label: file.name,
    source: `локально:${file.name}`,
    replace: false,
  });
  registerStructureModel(result.modelId, file.name, result.elements);
  currentMode = "json";
  currentStats = result.stats;
  currentSource = null;
  renderStats(result.stats);
  renderLayers(result.stats);
  renderStructure();
  renderFederatedHud();
  renderStandaloneSource();
  setStatus(`добавлено: ${file.name} | элементов: ${formatNumber(result.elements.length)}`);
}

async function addLocalIfc(file: File): Promise<void> {
  const url = URL.createObjectURL(file);
  const model: IfcModelSource = {
    id: uniqueModelId(file.name),
    label: file.name,
    url,
  };
  currentMode = "ifc";
  modePillNode.textContent = "FED";
  const result = await viewer.addIfcModels([model], setStatus);
  renderIfcStats(result);
  renderFederatedHud();
  renderStandaloneSource();
  setStatus(`добавлен IFC: ${file.name}`);
}

async function loadSemanticModels(models: IfcModelSource[]): Promise<void> {
  semanticByGlobalId.clear();
  for (const model of models) {
    if (!model.jsonSourcePath) continue;
    setStatus(`загрузка JSON: ${model.label}...`);
    const data = await requestCadBimSource(model.jsonSourcePath);
    const payload = data.payload && !Array.isArray(data.payload) ? data.payload : undefined;
    for (const element of payload?.elements || []) {
      const globalId = String(element.id || element.properties?.global_id || "");
      if (globalId) semanticByGlobalId.set(globalId, element);
    }
  }
}

async function requestCadBimSource(sourcePath: string): Promise<CadBimSourceResponse> {
  if (!sourcePath.trim() && isStandaloneViewer) {
    return requestDirectJsonSource(standaloneDefaultSource);
  }

  if (isDirectJsonSource(sourcePath)) {
    return requestDirectJsonSource(sourcePath);
  }

  const query = new URLSearchParams({ max_elements: "50000" });
  if (sourcePath.trim()) query.set("source_path", sourcePath.trim());
  try {
    const response = await fetch(`/lite-api/cad-bim/source?${query.toString()}`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Источник CAD/BIM ${response.status}: ${text.slice(0, 240)}`);
    }
    return (await response.json()) as CadBimSourceResponse;
  } catch (error) {
    if (sourcePath.trim()) {
      return requestDirectJsonSource(sourcePath.trim());
    }
    throw new Error("Источник недоступен. Добавь локальный JSON/IFC через кнопку «Загрузить».");
  }
}

async function requestDirectJsonSource(sourcePath: string): Promise<CadBimSourceResponse> {
  const response = await fetch(sourcePath, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`JSON ${response.status}: ${text.slice(0, 240)}`);
  }
  const payload = (await response.json()) as CadBimGraph | CadBimElement[];
  return {
    source: sourcePath,
    payload,
    element_count: Array.isArray(payload) ? payload.length : payload.elements?.length || 0,
    truncated: false,
  };
}

function renderStats(stats: ViewerStats): void {
  statsNode.innerHTML = [
    statCard("Элементы", stats.elements),
    statCard("В сцене", stats.drawable),
    statCard("Связи", stats.relations),
  ].join("");
}

function renderIfcStats(result: IfcRenderResult): void {
  statsNode.innerHTML = [
    statCard("Модели", result.loaded),
    statCard("В наборе", result.models.length),
    statCard("Связи", 0),
  ].join("");
  layersNode.innerHTML = result.models
    .map(
      (model) => `
        <div class="layer-row" title="${escapeHtml(model.id)}">
          <span></span>
          <span class="name">${escapeHtml(model.label)}</span>
          <span class="count">IFC</span>
        </div>
      `,
    )
    .join("");
}

function renderLayers(stats: ViewerStats): void {
  currentLayers = [...stats.layers.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count, visible: true }));
  renderLayerRows();
}

function renderLayerRows(): void {
  const filter = layerFilterInput.value.trim().toLocaleLowerCase("ru-RU");
  const rows = currentLayers.filter((row) => row.name.toLocaleLowerCase("ru-RU").includes(filter));
  layerCountNode.textContent = formatNumber(currentLayers.length);
  layerSolosNode.innerHTML = currentLayers
    .slice(0, 6)
    .map((row) => `<button type="button" data-layer-solo="${escapeHtml(row.name)}">${escapeHtml(shortLabel(row.name))}</button>`)
    .join("");
  if (!rows.length) {
    layersNode.innerHTML = `<div class="empty">Слоёв нет</div>`;
    return;
  }
  layersNode.innerHTML = rows
    .map(
      (row) => `
        <label class="layer-row" title="${escapeHtml(row.name)}">
          <input type="checkbox" data-layer="${escapeHtml(row.name)}" ${row.visible ? "checked" : ""} />
          <span class="swatch" style="--swatch:${layerColor(row.name)}"></span>
          <span class="name">${escapeHtml(row.name)}</span>
          <span class="count">${formatNumber(row.count)}</span>
        </label>
      `,
    )
    .join("");
  layersNode.querySelectorAll<HTMLInputElement>("input[data-layer]").forEach((input) => {
    input.addEventListener("change", () => {
      const layer = input.dataset.layer || "";
      const row = currentLayers.find((item) => item.name === layer);
      if (row) row.visible = input.checked;
      viewer.setLayerVisible(layer, input.checked);
    });
  });
  layerSolosNode.querySelectorAll<HTMLButtonElement>("button[data-layer-solo]").forEach((button) => {
    button.addEventListener("click", () => {
      const layer = button.dataset.layerSolo || "";
      currentLayers.forEach((row) => {
        row.visible = row.name === layer;
        viewer.setLayerVisible(row.name, row.visible);
      });
      renderLayerRows();
    });
  });
}

function renderModels(models: ViewerModelRecord[]): void {
  currentModels = models;
  modelCountNode.textContent = formatNumber(models.length);
  if (!models.length) {
    modelsNode.innerHTML = `<div class="empty">Модели не загружены</div>`;
    return;
  }
  modelsNode.innerHTML = models
    .map(
      (model) => `
        <article class="model-row" data-model-id="${escapeHtml(model.id)}">
          <label class="model-head">
            <input type="checkbox" data-model-visible="${escapeHtml(model.id)}" ${model.visible ? "checked" : ""} />
            <span class="swatch" style="--swatch:${model.kind === "ifc" ? "#a78bfa" : layerColor(model.label)}"></span>
            <span class="name">${escapeHtml(model.label)}</span>
            <span class="pill tiny">${escapeHtml(model.kind.toUpperCase())}</span>
          </label>
          <div class="model-meta">
            <span>элементов: ${formatNumber(model.elements)}</span>
            <span>в сцене: ${formatNumber(model.drawable)}</span>
          </div>
          <div class="model-buttons">
            <button type="button" data-model-fit="${escapeHtml(model.id)}">Вписать</button>
            <button type="button" data-model-solo="${escapeHtml(model.id)}">Соло</button>
            <button type="button" data-model-unload="${escapeHtml(model.id)}">Выгрузить</button>
          </div>
        </article>
      `,
    )
    .join("");
  modelsNode.querySelectorAll<HTMLInputElement>("input[data-model-visible]").forEach((input) => {
    input.addEventListener("change", () => {
      viewer.setModelVisible(input.dataset.modelVisible || "", input.checked);
    });
  });
  modelsNode.querySelectorAll<HTMLButtonElement>("button[data-model-fit]").forEach((button) => {
    button.addEventListener("click", () => viewer.fitModel(button.dataset.modelFit || ""));
  });
  modelsNode.querySelectorAll<HTMLButtonElement>("button[data-model-solo]").forEach((button) => {
    button.addEventListener("click", () => viewer.isolateModel(button.dataset.modelSolo || ""));
  });
  modelsNode.querySelectorAll<HTMLButtonElement>("button[data-model-unload]").forEach((button) => {
    button.addEventListener("click", () => {
      const modelId = button.dataset.modelUnload || "";
      viewer.removeModel(modelId);
      structureModels.delete(modelId);
      renderStructure();
      renderFederatedHud();
    });
  });
}

function registerStructureModel(id: string, label: string, elements: CadBimElement[]): void {
  structureModels.set(id, { id, label, elements: elements.filter((element) => element.category !== "Model") });
}

// ===== Слои и структура для IFC/.frag =====
// Строятся ЛЕНИВО при первом открытии вкладки (на тяжёлых моделях сбор категорий
// и пространственного дерева занимает время) и кэшируются до перезагрузки моделей.

type IfcLayerRow = { modelId: string; modelLabel: string; category: string; label: string; ids: number[]; visible: boolean };
let ifcLayerRows: IfcLayerRow[] = [];
let ifcLayersBuilt = false;
let ifcLayersBuilding = false;
let ifcStructureBuilt = false;
let ifcStructureBuilding = false;
// Группы видимости дерева структуры: ключ → набор элементов (id в data-атрибут не влезут).
const ifcStructureGroups = new Map<string, { modelId: string; ids: number[] }>();
const jsonStructureGroups = new Map<string, string[]>();
const ifcStructureItemState = new Map<string, { visible: boolean; transparent: boolean }>();
const jsonStructureItemState = new Map<string, { visible: boolean; transparent: boolean }>();

const IFC_CATEGORY_LABELS: Record<string, string> = {
  IFCWALL: "Стены", IFCWALLSTANDARDCASE: "Стены", IFCSLAB: "Перекрытия", IFCBEAM: "Балки",
  IFCCOLUMN: "Колонны", IFCDOOR: "Двери", IFCWINDOW: "Окна", IFCROOF: "Кровля",
  IFCSTAIR: "Лестницы", IFCSTAIRFLIGHT: "Лестничные марши", IFCRAILING: "Ограждения",
  IFCCOVERING: "Отделка", IFCCURTAINWALL: "Витражи", IFCPLATE: "Пластины", IFCMEMBER: "Элементы каркаса",
  IFCFURNISHINGELEMENT: "Мебель", IFCSPACE: "Помещения", IFCSITE: "Площадка", IFCBUILDINGELEMENTPROXY: "Прочие элементы",
  IFCFLOWSEGMENT: "Сегменты сетей", IFCDUCTSEGMENT: "Воздуховоды", IFCPIPESEGMENT: "Трубы",
  IFCCABLECARRIERSEGMENT: "Кабельные лотки", IFCFLOWFITTING: "Фасонные части", IFCDUCTFITTING: "Фасонные (вент.)",
  IFCPIPEFITTING: "Фасонные (трубы)", IFCFLOWTERMINAL: "Приборы/решётки", IFCAIRTERMINAL: "Возд. решётки",
  IFCFLOWCONTROLLER: "Арматура/клапаны", IFCVALVE: "Клапаны", IFCPUMP: "Насосы", IFCFAN: "Вентиляторы",
  IFCDISTRIBUTIONELEMENT: "Элементы сетей", IFCLIGHTFIXTURE: "Светильники", IFCSANITARYTERMINAL: "Сантехприборы",
};

function ifcCategoryLabel(category: string): string {
  const key = category.toUpperCase();
  return IFC_CATEGORY_LABELS[key] ?? key.replace(/^IFC/, "");
}

function resetIfcPanels(): void {
  ifcLayerRows = [];
  ifcLayersBuilt = false;
  ifcLayersBuilding = false;
  ifcStructureBuilt = false;
  ifcStructureBuilding = false;
  ifcStructureGroups.clear();
  ifcStructureItemState.clear();
}

async function buildIfcLayers(): Promise<void> {
  if (ifcLayersBuilding) return;
  ifcLayersBuilding = true;
  layersNode.innerHTML = `<div class="empty">Собираю категории модели…</div>`;
  try {
    const records = viewer.sceneModels().filter((m) => m.kind === "ifc");
    const rows: IfcLayerRow[] = [];
    for (const rec of records) {
      const cats = await viewer.ifcCategories(rec.id);
      for (const [category, ids] of cats) {
        rows.push({ modelId: rec.id, modelLabel: rec.label, category, label: ifcCategoryLabel(category), ids, visible: true });
      }
    }
    rows.sort((a, b) => a.label.localeCompare(b.label, "ru"));
    ifcLayerRows = rows;
    ifcLayersBuilt = true;
    renderIfcLayerRows();
  } catch (error) {
    layersNode.innerHTML = `<div class="empty error">Слои недоступны: ${escapeHtml(error instanceof Error ? error.message : String(error))}</div>`;
  } finally {
    ifcLayersBuilding = false;
  }
}

function renderIfcLayerRows(): void {
  const filter = layerFilterInput.value.trim().toLocaleLowerCase("ru-RU");
  const multiModel = new Set(ifcLayerRows.map((r) => r.modelId)).size > 1;
  const rows = ifcLayerRows.filter((r) => !filter || `${r.label} ${r.category}`.toLocaleLowerCase("ru-RU").includes(filter));
  layerCountNode.textContent = formatNumber(rows.length);
  if (!rows.length) {
    layersNode.innerHTML = `<div class="empty">${ifcLayerRows.length ? "Совпадений нет" : "Категории не найдены"}</div>`;
    return;
  }
  layersNode.innerHTML = rows
    .map((row, index) => `
      <label class="prop-row layer-row" title="${escapeHtml(row.category)}">
        <input type="checkbox" data-ifc-layer="${ifcLayerRows.indexOf(row)}" ${row.visible ? "checked" : ""} />
        <span class="swatch"></span>
        <span class="name">${escapeHtml(row.label)}${multiModel ? ` <small>· ${escapeHtml(row.modelLabel)}</small>` : ""}</span>
        <span class="count">${formatNumber(row.ids.length)}</span>
      </label>
    `)
    .join("");
  layersNode.querySelectorAll<HTMLInputElement>("input[data-ifc-layer]").forEach((input) => {
    input.addEventListener("change", () => {
      const row = ifcLayerRows[Number(input.dataset.ifcLayer)];
      if (!row) return;
      row.visible = input.checked;
      void viewer.ifcSetItemsVisible(row.modelId, row.ids, input.checked);
    });
  });
}

function setAllIfcLayers(visible: boolean): void {
  for (const row of ifcLayerRows) {
    if (row.visible === visible) continue;
    row.visible = visible;
    void viewer.ifcSetItemsVisible(row.modelId, row.ids, visible);
  }
  renderIfcLayerRows();
}

// Пространственное дерево IFC: Проект → Здание → Этаж → элементы.
function collectSubtreeIds(node: any, acc: number[] = []): number[] {
  if (node?.localId != null) acc.push(node.localId);
  for (const child of node?.children ?? []) collectSubtreeIds(child, acc);
  return acc;
}

async function buildIfcStructure(): Promise<void> {
  if (ifcStructureBuilding) return;
  ifcStructureBuilding = true;
  structureNode.innerHTML = `<div class="empty">Строю пространственную структуру…</div>`;
  try {
    ifcStructureGroups.clear();
    const records = viewer.sceneModels().filter((m) => m.kind === "ifc");
    const blocks: string[] = [];
    let containerCount = 0;
    for (const rec of records) {
      const tree = await viewer.ifcSpatialStructure(rec.id);
      if (!tree) {
        blocks.push(`<details class="structure-model" open><summary>${escapeHtml(rec.label)}</summary><div class="empty">Пространственная структура недоступна</div></details>`);
        continue;
      }
      // Имена контейнеров и элементов загружаем батчем. Ограничение сохраняет
      // отзывчивость на мобильных при очень больших IFC; остальным остаётся ID/категория.
      const itemIds: number[] = [];
      const walkItems = (node: any): void => {
        if (node?.localId != null) itemIds.push(node.localId);
        for (const child of node?.children ?? []) walkItems(child);
      };
      walkItems(tree);
      containerCount += itemIds.length;
      const names = await viewer.ifcNamesFor(rec.id, itemIds.slice(0, 5000));
      const renderNode = (node: any, depth: number): string => {
        const children: any[] = node?.children ?? [];
        const category = String(node?.category ?? "");
        const name = (node?.localId != null && names.get(node.localId)) || ifcCategoryLabel(category) || "Узел";
        if (!children.length) {
          if (node?.localId == null) return "";
          const key = `${rec.id}:${node.localId}`;
          const state = ifcStructureItemState.get(key) || { visible: true, transparent: false };
          ifcStructureItemState.set(key, state);
          const search = `${rec.label} ${name} ${category} ${node.localId}`.toLocaleLowerCase("ru-RU");
          return `
            <div class="structure-leaf-row${state.visible ? "" : " is-hidden"}${state.transparent ? " is-transparent" : ""}" data-search="${escapeHtml(search)}">
              <button type="button" class="structure-leaf" data-leaf-model="${escapeHtml(rec.id)}" data-leaf-id="${node.localId}" title="Выбрать и приблизить">${escapeHtml(name)} <span class="count">#${node.localId}</span></button>
              <button type="button" class="structure-action" data-leaf-visible="${escapeHtml(key)}" title="${state.visible ? "Скрыть элемент" : "Показать элемент"}" aria-label="${state.visible ? "Скрыть элемент" : "Показать элемент"}">${state.visible ? "Скр." : "Пок."}</button>
              <button type="button" class="structure-action" data-leaf-opacity="${escapeHtml(key)}" title="${state.transparent ? "Вернуть непрозрачность" : "Сделать полупрозрачным"}">${state.transparent ? "100%" : "50%"}</button>
            </div>`;
        }
        const ids = collectSubtreeIds(node);
        const groupKey = `${rec.id}:${node?.localId ?? `d${depth}-${ifcStructureGroups.size}`}`;
        ifcStructureGroups.set(groupKey, { modelId: rec.id, ids });
        const leafLimit = 300;
        const renderedChildren = children.slice(0, leafLimit).map((child) => renderNode(child, depth + 1)).join("");
        const more = children.length > leafLimit ? `<div class="empty">… ещё ${formatNumber(children.length - leafLimit)} элементов (используйте фильтр)</div>` : "";
        return `
          <details class="structure-model" ${depth < 2 ? "open" : ""}>
            <summary><input type="checkbox" data-ifc-group="${escapeHtml(groupKey)}" checked title="Показать/скрыть ветку" /><button type="button" class="structure-group-focus" data-ifc-highlight="${escapeHtml(groupKey)}" title="Подсветить и вписать всю группу">${escapeHtml(name)}</button><span class="count">${formatNumber(ids.length)}</span></summary>
            <div class="structure-children">${renderedChildren}${more}</div>
          </details>
        `;
      };
      blocks.push(`
        <details class="structure-model" open>
          <summary>${escapeHtml(rec.label)}</summary>
          ${renderNode(tree, 1)}
        </details>
      `);
    }
    structureCountNode.textContent = formatNumber(containerCount);
    structureNode.innerHTML = blocks.join("") || `<div class="empty">Нет загруженных моделей</div>`;
    bindIfcStructureEvents();
    ifcStructureBuilt = true;
    if (structureFilterInput.value.trim()) filterIfcStructure();
  } catch (error) {
    structureNode.innerHTML = `<div class="empty error">Структура недоступна: ${escapeHtml(error instanceof Error ? error.message : String(error))}</div>`;
  } finally {
    ifcStructureBuilding = false;
  }
}

function bindIfcStructureEvents(): void {
  structureNode.querySelectorAll<HTMLInputElement>("input[data-ifc-group]").forEach((input) => {
    input.addEventListener("click", (event) => event.stopPropagation());
    input.addEventListener("change", () => {
      const group = ifcStructureGroups.get(input.dataset.ifcGroup || "");
      if (group) void viewer.ifcSetItemsVisible(group.modelId, group.ids, input.checked);
    });
  });
  structureNode.querySelectorAll<HTMLButtonElement>("button[data-ifc-highlight]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const group = ifcStructureGroups.get(button.dataset.ifcHighlight || "");
      if (!group) return;
      void viewer.ifcHighlightItems(group.modelId, group.ids);
      setStatus(`подсвечена группа: ${formatNumber(group.ids.length)} элементов`);
    });
  });
  structureNode.querySelectorAll<HTMLButtonElement>("button[data-leaf-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const modelId = button.dataset.leafModel || "";
      const localId = Number(button.dataset.leafId);
      if (modelId && Number.isFinite(localId)) void viewer.ifcSelectByLocalId(modelId, localId);
    });
  });
  structureNode.querySelectorAll<HTMLButtonElement>("button[data-leaf-visible]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.leafVisible || "";
      const split = key.lastIndexOf(":");
      if (split < 0) return;
      const modelId = key.slice(0, split);
      const localId = Number(key.slice(split + 1));
      const state = ifcStructureItemState.get(key) || { visible: true, transparent: false };
      state.visible = !state.visible;
      ifcStructureItemState.set(key, state);
      void viewer.ifcSetItemsVisible(modelId, [localId], state.visible);
      button.closest(".structure-leaf-row")?.classList.toggle("is-hidden", !state.visible);
      button.textContent = state.visible ? "Скр." : "Пок.";
      button.title = state.visible ? "Скрыть элемент" : "Показать элемент";
    });
  });
  structureNode.querySelectorAll<HTMLButtonElement>("button[data-leaf-opacity]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.leafOpacity || "";
      const split = key.lastIndexOf(":");
      if (split < 0) return;
      const modelId = key.slice(0, split);
      const localId = Number(key.slice(split + 1));
      const state = ifcStructureItemState.get(key) || { visible: true, transparent: false };
      state.transparent = !state.transparent;
      ifcStructureItemState.set(key, state);
      void viewer.ifcSetItemsOpacity(modelId, [localId], state.transparent ? 0.35 : 1);
      button.closest(".structure-leaf-row")?.classList.toggle("is-transparent", state.transparent);
      button.textContent = state.transparent ? "100%" : "50%";
      button.title = state.transparent ? "Вернуть непрозрачность" : "Сделать полупрозрачным";
    });
  });
}

function filterIfcStructure(): void {
  const filter = structureFilterInput.value.trim().toLocaleLowerCase("ru-RU");
  structureNode.querySelectorAll<HTMLElement>(".structure-leaf-row").forEach((row) => {
    row.hidden = !!filter && !(row.dataset.search || "").includes(filter);
  });
  const branches = [...structureNode.querySelectorAll<HTMLDetailsElement>("details.structure-model")].reverse();
  for (const branch of branches) {
    const summaryMatch = (branch.querySelector(":scope > summary")?.textContent || "").toLocaleLowerCase("ru-RU").includes(filter);
    const hasMatch = !!branch.querySelector(".structure-leaf-row:not([hidden])");
    branch.hidden = !!filter && !summaryMatch && !hasMatch;
    if (filter && !branch.hidden) branch.open = true;
  }
}

function renderStructure(): void {
  const filter = structureFilterInput.value.trim().toLocaleLowerCase("ru-RU");
  const rows: string[] = [];
  let elementCount = 0;
  jsonStructureGroups.clear();
  for (const model of structureModels.values()) {
    const modelMatches = model.label.toLocaleLowerCase("ru-RU").includes(filter);
    const grouped = new Map<string, Map<string, CadBimElement[]>>();
    for (const element of model.elements) {
      const level = element.level || "Без уровня";
      const category = element.category || element.type || element.object_type || "Элементы";
      const categories = grouped.get(level) || new Map<string, CadBimElement[]>();
      const elements = categories.get(category) || [];
      elements.push(element);
      categories.set(category, elements);
      grouped.set(level, categories);
    }
    const body = [...grouped.entries()].map(([level, categories]) => {
      const categoryBody = [...categories.entries()].map(([category, elements], categoryIndex) => {
        const leaves = elements.map((element) => {
          const id = String(element.id || "");
          const label = element.name || element.family || element.type || element.object_type || id || "Элемент";
          const search = `${model.label} ${level} ${category} ${label} ${id}`.toLocaleLowerCase("ru-RU");
          if (filter && !modelMatches && !search.includes(filter)) return "";
          elementCount += 1;
          const state = jsonStructureItemState.get(id) || { visible: true, transparent: false };
          jsonStructureItemState.set(id, state);
          return `
            <div class="structure-leaf-row${state.visible ? "" : " is-hidden"}${state.transparent ? " is-transparent" : ""}" data-search="${escapeHtml(search)}">
              <button type="button" class="structure-leaf" data-json-element="${escapeHtml(id)}" title="Выбрать и приблизить">${escapeHtml(label)} <span class="count">${escapeHtml(id)}</span></button>
              <button type="button" class="structure-action" data-json-visible="${escapeHtml(id)}" title="${state.visible ? "Скрыть элемент" : "Показать элемент"}" aria-label="${state.visible ? "Скрыть элемент" : "Показать элемент"}">${state.visible ? "Скр." : "Пок."}</button>
              <button type="button" class="structure-action" data-json-opacity="${escapeHtml(id)}">${state.transparent ? "100%" : "50%"}</button>
            </div>`;
        }).join("");
        if (!leaves) return "";
        const groupKey = `${model.id}:${level}:${categoryIndex}`;
        jsonStructureGroups.set(groupKey, elements.map((element) => String(element.id || "")).filter(Boolean));
        return `<details class="structure-model" open><summary><button type="button" class="structure-group-focus" data-json-highlight="${escapeHtml(groupKey)}" title="Подсветить и вписать всю категорию">${escapeHtml(category)}</button><span>${formatNumber(elements.length)}</span></summary><div class="structure-children">${leaves}</div></details>`;
      }).join("");
      if (!categoryBody) return "";
      return `<details class="structure-model" open><summary>${escapeHtml(level)}</summary><div class="structure-children">${categoryBody}</div></details>`;
    }).join("");
    if (!body && filter && !modelMatches) continue;
    rows.push(`
      <details class="structure-model" open>
        <summary>${escapeHtml(model.label)} <span>${formatNumber(model.elements.length)}</span></summary>
        ${body || `<div class="empty">Совпадений нет</div>`}
      </details>
    `);
  }
  structureCountNode.textContent = formatNumber(elementCount);
  structureNode.innerHTML = rows.length
    ? rows.join("")
    : `<div class="empty">${filter ? "Совпадений нет" : "Структура JSON не загружена"}</div>`;
  structureNode.querySelectorAll<HTMLButtonElement>("button[data-json-element]").forEach((button) => {
    button.addEventListener("click", () => viewer.focusElement(button.dataset.jsonElement || ""));
  });
  structureNode.querySelectorAll<HTMLButtonElement>("button[data-json-highlight]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const ids = jsonStructureGroups.get(button.dataset.jsonHighlight || "") || [];
      const count = viewer.highlightElements(ids);
      setStatus(`подсвечена категория: ${formatNumber(count)} элементов`);
    });
  });
  structureNode.querySelectorAll<HTMLButtonElement>("button[data-json-visible]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.jsonVisible || "";
      const state = jsonStructureItemState.get(id) || { visible: true, transparent: false };
      state.visible = !state.visible;
      jsonStructureItemState.set(id, state);
      viewer.setElementVisible(id, state.visible);
      renderStructure();
    });
  });
  structureNode.querySelectorAll<HTMLButtonElement>("button[data-json-opacity]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.jsonOpacity || "";
      const state = jsonStructureItemState.get(id) || { visible: true, transparent: false };
      state.transparent = !state.transparent;
      jsonStructureItemState.set(id, state);
      viewer.setElementOpacity(id, state.transparent ? 0.35 : 1);
      renderStructure();
    });
  });
}

function renderSelected(element: CadBimElement | null): void {
  selectedElement = element;
  selectedIfc = null;
  renderToolSelectionInfo(element);
  if (!element) {
    selectedNode.innerHTML = `<div class="empty">Ничего не выбрано</div>`;
    return;
  }
  const props = flattenProperties(element.properties || {});
  const meshStats = flattenProperties(element.geometry?.stats || {}, "mesh").slice(0, 4);
  const baseRows: [string, unknown][] = [
    ["id", element.id || ""],
    ["type", element.type || element.object_type || ""],
    ["name", element.name || ""],
    ["layer", element.layer || ""],
    ["category", element.category || ""],
    ["family", element.family || ""],
    ["level", element.level || ""],
    ["material", element.material || ""],
  ];
  const rows = baseRows.concat(meshStats).concat(props.slice(0, 30)).filter(([, value]) => value !== "");

  selectedNode.innerHTML = `
    <article class="selection-card">
      <div class="selection-head">
        <span class="swatch large" style="--swatch:${layerColor(element.layer || element.category || "")}"></span>
        <div>
          <strong>${escapeHtml(element.name || element.type || "Элемент")}</strong>
          <span>${escapeHtml([element.category, element.family, element.level].filter(Boolean).join(" / "))}</span>
        </div>
      </div>
    </article>
    <div class="list props-list">
      ${rows
        .map(
          ([key, value]) => `
          <div class="prop-row">
            <span class="key">${escapeHtml(key)}</span>
            <span class="value">${escapeHtml(formatValue(value))}</span>
          </div>
        `,
        )
        .join("")}
    </div>
  `;
}

function renderIfcSelected(selection: IfcSelection | null): void {
  selectedElement = null;
  selectedIfc = selection;
  toolSelectionInfoNode.textContent = selection ? `${selection.globalId || selection.modelId}:${selection.localId}` : "IFC-элемент не выбран";
  if (!selection) {
    selectedNode.innerHTML = `<div class="empty">IFC-элемент не выбран</div>`;
    return;
  }
  // Лоция Атлас: в автономном режиме показываем только реальные свойства IFC.
  if (isStandaloneViewer) {
    const props = selection.rows.filter(([, value]) => value !== "" && value != null) as [string, unknown][];
    const list = props.length
      ? props
      : ([["GlobalId", selection.globalId], ["local_id", selection.localId]] as [string, unknown][]);
    // Группировка атрибутов по смыслам: идентификация → геометрия → свойства
    // (Pset) → материал → прочее. Внутри группы порядок сохраняется как пришёл.
    const groups: { title: string; rows: [string, unknown][] }[] = [
      { title: "Идентификация", rows: [] },
      { title: "Геометрия", rows: [] },
      { title: "Свойства (Pset)", rows: [] },
      { title: "Материал", rows: [] },
      { title: "Прочее", rows: [] },
    ];
    const classify = (key: string): number => {
      const k = key.toLowerCase();
      if (k.startsWith("материал")) return 3;
      if (key.includes(" · ") || k.startsWith("pset")) return 2;
      if (/^(отметк|длина|габарит|центр|объ[её]м|площад|высот|ширин)/.test(k)) return 1;
      if (/^(категори|имя|тип|метк|global|guid|local|model|id)/.test(k)) return 0;
      return 4;
    };
    for (const row of list) groups[classify(String(row[0]))].rows.push(row);
    const body = groups
      .filter((g) => g.rows.length)
      .map(
        (g) => `
        <div class="prop-group">
          <div class="prop-group__title">${escapeHtml(g.title)}</div>
          ${g.rows
            .map(
              ([key, value]) => `
            <div class="prop-row">
              <span class="key">${escapeHtml(String(key))}</span>
              <span class="value">${escapeHtml(formatValue(value))}</span>
            </div>`,
            )
            .join("")}
        </div>`,
      )
      .join("");
    selectedNode.innerHTML = `<div class="prop-list">${body}</div>`;
    return;
  }
  const baseRows: [string, unknown][] = [
    ["model_id", selection.modelId],
    ["local_id", selection.localId],
    ["global_id", selection.globalId],
  ];
  const semantic = semanticByGlobalId.get(selection.globalId);
  const semanticBaseRows: [string, unknown][] = semantic
    ? ([
        ["json.type", semantic.type || semantic.object_type || ""],
        ["json.name", semantic.name || ""],
        ["json.category", semantic.category || ""],
        ["json.family", semantic.family || ""],
        ["json.material", semantic.material || ""],
      ] as [string, unknown][])
    : [["json", "не найдено по GlobalId"]];
  const semanticRows = semanticBaseRows.concat(
    semantic
      ? flattenProperties((semantic as CadBimElement & { propertySets?: Record<string, unknown> }).propertySets || {}, "json.pset").slice(0, 18)
      : [],
  );
  const rows = baseRows
    .concat(semanticRows)
    .concat(selection.rows.filter(([, value]) => value !== "" && value != null).slice(0, 20));
  selectedNode.innerHTML = `
    <div class="list">
      ${rows
        .map(
          ([key, value]) => `
          <div class="prop-row">
            <span class="key">${escapeHtml(key)}</span>
            <span class="value">${escapeHtml(formatValue(value))}</span>
          </div>
        `,
        )
        .join("")}
    </div>
  `;
}

function selectionSourceId(element: CadBimElement): string {
  const props = element.properties || {};
  const parameters = props.parameters as Record<string, unknown> | undefined;
  return String(
    element.id ||
      props.global_id ||
      props.GlobalId ||
      props.IfcGUID ||
      parameters?.IfcGUID ||
      parameters?.GlobalId ||
      "",
  );
}

// Копирование в буфер с фоллбэком: navigator.clipboard есть только в защищённом
// контексте (https или localhost). На офлайн-проде доступ по http://<ip>/ —
// там clipboard отсутствует, поэтому падаем на execCommand("copy") через скрытый
// textarea, и лишь в самом конце — на window.prompt.
async function copyToClipboard(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    /* провалимся на execCommand ниже */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = value;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    if (ok) return true;
  } catch {
    /* провалимся на prompt ниже */
  }
  return false;
}

// URL для пересылки коллеге: если Лоция передала канонический адрес сервера в
// ?base=, подменяем им протокол+хост текущего адреса. Без этого тот, кто открыл
// вьювер по http://localhost/ (например, сидя на самом сервере), скопировал бы
// ссылку на localhost — мёртвую для всех остальных в сети.
function shareableUrl(): string {
  const base = new URLSearchParams(window.location.search).get("base") || "";
  if (!base) return window.location.href;
  try {
    const here = new URL(window.location.href);
    const canon = new URL(base);
    here.protocol = canon.protocol;
    here.host = canon.host; // host включает порт
    return here.href;
  } catch {
    return window.location.href;
  }
}

function compactAtlasUrl(maxLength = 1600): string {
  const raw = shareableUrl();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw.slice(0, maxLength);
  }

  ["viewpoint", "atlas_overlay", "local_id", "global_id", "model_id", "highlight"].forEach((name) => url.searchParams.delete(name));
  if (url.href.length <= maxLength) return url.href;

  ["base", "locia_return", "return", "theme", "prepare"].forEach((name) => url.searchParams.delete(name));
  if (url.href.length <= maxLength) return url.href;

  const compact = new URL(url.origin + url.pathname);
  ["project_id", "ifc", "ifc_path", "frag", "source", "source_path"].forEach((name) => {
    const value = url.searchParams.get(name);
    if (value) compact.searchParams.set(name, value);
  });
  if (compact.href.length <= maxLength) return compact.href;

  ["frag", "source", "source_path", "ifc", "ifc_path"].forEach((name) => {
    if (compact.href.length > maxLength) compact.searchParams.delete(name);
  });
  return compact.href.length <= maxLength ? compact.href : (url.origin + url.pathname);
}

function safeJsonParam(value: unknown, maxLength = 1400): string {
  try {
    const json = JSON.stringify(value);
    return json.length <= maxLength ? json : "";
  } catch {
    return "";
  }
}

function atlasViewpoint(): CameraSnapshot {
  return viewer.cameraSnapshot();
}

function atlasOverlay(): Record<string, unknown> {
  if (selectedElement) {
    const elementId = selectionSourceId(selectedElement) || String(selectedElement.id || "");
    return {
      kind: "json",
      element_id: elementId,
      element_name: selectedElement.name || selectedElement.type || selectedElement.category || "Элемент",
      element_type: selectedElement.type || selectedElement.category || "",
    };
  }
  if (selectedIfc) {
    return {
      kind: "ifc",
      model_id: selectedIfc.modelId,
      local_id: selectedIfc.localId,
      global_id: selectedIfc.globalId || "",
      element_name: selectedIfcName(selectedIfc),
    };
  }

  return { kind: currentMode };
}

function atlasUrlWithViewpoint(): string {
  const url = new URL(compactAtlasUrl());
  const viewpoint = atlasViewpoint();
  const overlay = atlasOverlay();
  const viewpointJson = safeJsonParam(viewpoint);
  const overlayJson = safeJsonParam(overlay, 900);
  if (viewpointJson) url.searchParams.set("viewpoint", viewpointJson);
  if (overlayJson) url.searchParams.set("atlas_overlay", overlayJson);
  if (selectedElement) {
    const elementId = selectionSourceId(selectedElement) || String(selectedElement.id || "");
    if (elementId) url.searchParams.set("highlight", elementId);
  }
  if (selectedIfc?.globalId) {
    url.searchParams.set("global_id", selectedIfc.globalId);
  }
  if (selectedIfc?.modelId && Number.isFinite(selectedIfc.localId)) {
    url.searchParams.set("model_id", selectedIfc.modelId);
    url.searchParams.set("local_id", String(selectedIfc.localId));
  }

  return url.href;
}

function projectIdFromUrl(): string {
  const search = new URLSearchParams(window.location.search);
  const direct = search.get("project_id") || "";
  if (direct) return direct;
  const lociaReturn = search.get("locia_return") || "";
  const match = lociaReturn.match(/\/projects\/(\d+)/);
  return match ? match[1] : "";
}

function selectedIfcName(selection: IfcSelection): string {
  const row = selection.rows.find(([key, value]) => /^(name|имя|наименование)$/i.test(String(key)) && String(value || "").trim() !== "");
  return row ? String(row[1]) : selection.globalId || `IFC #${selection.localId}`;
}

function atlasTaskUrl(): string {
  if (isPublicAtlasBuild) return "";
  const projectId = projectIdFromUrl();
  const viewpoint = atlasViewpoint();
  const overlay = atlasOverlay();
  const viewpointJson = safeJsonParam(viewpoint);
  const overlayJson = safeJsonParam(overlay, 900);
  const compactSourceUrl = compactAtlasUrl(900);
  const params = new URLSearchParams({
    task_intent: "work",
    atlas_url: compactSourceUrl,
    when_due: localIsoDate(),
    planned_hours: "1",
  });
  if (projectId) {
    params.set("project_id", projectId);
  }
  const modelLabel = currentModels.map((model) => model.label).filter(Boolean).join(", ");
  const context: Record<string, unknown> = {
    mode: currentMode,
    source: latestSource || initialIfc || initialFrag || (initialLinkedModels.length ? "models" : ""),
    url: compactSourceUrl,
    viewpoint,
    overlay,
  };
  if (modelLabel) {
    params.set("atlas_model_label", modelLabel);
    context.model_label = modelLabel;
  }

  if (selectedElement) {
    const elementId = selectionSourceId(selectedElement) || String(selectedElement.id || "");
    const elementName = selectedElement.name || selectedElement.type || selectedElement.category || "Элемент";
    params.set("title", `Проверить элемент: ${elementName}`.slice(0, 180));
    params.set("what", `Проверить пометку в Атласе по элементу ${elementName}.`);
      params.set("why", `Источник: ${compactSourceUrl}`);
      params.set("atlas_element_id", elementId);
      params.set("atlas_element_name", elementName);
      if (viewpointJson) params.set("atlas_viewpoint", viewpointJson);
      if (overlayJson) params.set("atlas_overlay", overlayJson);
      if (selectedElement.type || selectedElement.category) context.element_type = selectedElement.type || selectedElement.category;
  } else if (selectedIfc) {
    const elementName = selectedIfcName(selectedIfc);
    params.set("title", `Проверить IFC-элемент: ${elementName}`.slice(0, 180));
    params.set("what", `Проверить пометку в Атласе по IFC-элементу ${elementName}.`);
    params.set("why", `Источник: ${compactSourceUrl}`);
    params.set("atlas_model_id", selectedIfc.modelId);
    params.set("atlas_element_id", selectedIfc.globalId || String(selectedIfc.localId));
    params.set("atlas_element_name", elementName);
    if (viewpointJson) params.set("atlas_viewpoint", viewpointJson);
    if (overlayJson) params.set("atlas_overlay", overlayJson);
    context.model_id = selectedIfc.modelId;
    context.local_id = selectedIfc.localId;
    context.global_id = selectedIfc.globalId;
  } else {
    params.set("title", "Пометка по модели Атласа");
    params.set("what", "Проверить пометку в Атласе по открытой модели.");
    params.set("why", `Источник: ${compactSourceUrl}`);
    if (viewpointJson) params.set("atlas_viewpoint", viewpointJson);
    if (overlayJson) params.set("atlas_overlay", overlayJson);
  }
  const contextJson = safeJsonParam(context, 1800);
  if (contextJson) params.set("atlas_context", contextJson);

  const buildUrl = () => `/tasks/new?${params.toString()}`;
  if (buildUrl().length > 6000) params.delete("atlas_context");
  if (buildUrl().length > 6000) params.delete("atlas_overlay");
  if (buildUrl().length > 6000) params.delete("atlas_viewpoint");
  if (buildUrl().length > 6000) params.set("atlas_url", compactAtlasUrl(900));
  return buildUrl();
}

function renderHud(data: CadBimSourceResponse, stats: ViewerStats): void {
  const payload = data.payload && !Array.isArray(data.payload) ? data.payload : undefined;
  const chips = [
    payload?.name || "CAD/BIM JSON",
    payload?.source_format || "json",
    `в сцене: ${formatNumber(stats.drawable)}`,
    data.truncated ? "обрезано" : "полностью",
  ];
  hudNode.innerHTML = chips.map((chip) => `<span class="chip">${escapeHtml(chip)}</span>`).join("");
  modePillNode.textContent = String(payload?.source_format || "JSON").toUpperCase();
}

function renderIfcHud(result: IfcRenderResult): void {
  const chips = ["IFC-фрагменты", "модели buildingSMART", `загружено: ${result.loaded}`, "мост GlobalId"];
  if (semanticByGlobalId.size) chips.push(`JSON-элементов: ${formatNumber(semanticByGlobalId.size)}`);
  hudNode.innerHTML = chips.map((chip) => `<span class="chip">${escapeHtml(chip)}</span>`).join("");
}

function renderFederatedHud(): void {
  const jsonCount = currentModels.filter((model) => model.kind === "json").length;
  const ifcCount = currentModels.filter((model) => model.kind === "ifc").length;
  const chips = ["Федеративная сцена", `моделей: ${formatNumber(currentModels.length)}`];
  if (jsonCount) chips.push(`${formatNumber(jsonCount)} JSON`);
  if (ifcCount) chips.push(`${formatNumber(ifcCount)} IFC`);
  hudNode.innerHTML = chips.map((chip) => `<span class="chip">${escapeHtml(chip)}</span>`).join("");
  modePillNode.textContent = currentModels.length > 1 ? "FED" : currentMode.toUpperCase();
}

function renderSource(data: CadBimSourceResponse, stats: ViewerStats): void {
  const payload = data.payload && !Array.isArray(data.payload) ? data.payload : undefined;
  const meshCount = payload?.elements?.filter((element) => element.geometry?.type === "mesh").length || 0;
  sourceMetaNode.innerHTML = `
    <span>${escapeHtml(payload?.name || "CAD/BIM JSON")}</span>
    <span>mesh: ${formatNumber(meshCount)}</span>
  `;
  if (sourceCardNode) sourceCardNode.innerHTML = `
    ${propLine("источник", data.source || "последний")}
    ${propLine("модель", payload?.name || "")}
    ${propLine("формат", payload?.source_format || "json")}
    ${propLine("элементы", formatNumber(stats.elements))}
    ${propLine("в сцене", formatNumber(stats.drawable))}
    ${propLine("mesh", formatNumber(meshCount))}
    ${propLine("связи", formatNumber(stats.relations))}
  `;
}

function renderIfcSource(result: IfcRenderResult): void {
  sourceMetaNode.innerHTML = `<span>IFC-фрагменты</span><span>загружено: ${formatNumber(result.loaded)}</span>`;
  if (sourceCardNode) sourceCardNode.innerHTML = result.models.map((model) => propLine(model.id, model.url)).join("");
}

function renderStandaloneSource(): void {
  const models = currentModels.length ? currentModels : viewer.sceneModels();
  sourceMetaNode.innerHTML = `<span>Сцена готова к standalone</span><span>моделей: ${formatNumber(models.length)}</span>`;
  if (sourceCardNode) sourceCardNode.innerHTML = models
    .map((model) => propLine(`${model.kind}:${model.label}`, model.source || model.id))
    .join("");
}

function renderStandaloneEmpty(): void {
  statsNode.innerHTML = [statCard("Элементы", 0), statCard("В сцене", 0), statCard("Связи", 0)].join("");
  sourceMetaNode.innerHTML = `<span>Standalone</span><span>локальные файлы</span>`;
  if (sourceCardNode) sourceCardNode.innerHTML = propLine("режим", "Добавь JSON/IFC файлы локально или укажи прямой JSON URL");
  hudNode.innerHTML = [`<span class="chip">Standalone</span>`, `<span class="chip">JSON / IFC</span>`].join("");
  renderModels(viewer?.sceneModels?.() || []);
  renderStructure();
}

function renderToolSelectionInfo(element: CadBimElement | null): void {
  if (!element) {
    toolSelectionInfoNode.textContent = "Ничего не выбрано";
    return;
  }
  const props = element.properties || {};
  const ifcGuid = String((props.parameters as Record<string, unknown> | undefined)?.IfcGUID || props.IfcGUID || "");
  const chunks = [
    element.type || element.object_type || "Элемент",
    element.category || "",
    element.level || "",
    ifcGuid ? `IfcGUID ${ifcGuid}` : "",
  ].filter(Boolean);
  toolSelectionInfoNode.textContent = chunks.join(" / ");
}

function applyClip(): void {
  const axis = clipAxisInput.value as ClipAxis;
  const direction = Number(clipDirectionInput.value) === -1 ? -1 : 1;
  const offset = Number(clipOffsetInput.value) / 100;
  viewer.setClipPlane(axis, clipEnabledInput.checked, offset, direction as ClipDirection);
  renderClipInfo();
}

function renderClipInfo(): void {
  const state = viewer.clipState();
  const active = (Object.entries(state) as [ClipAxis, { enabled: boolean; offset: number; direction: ClipDirection }][])
    .filter(([, value]) => value.enabled)
    .map(([axis, value]) => `${axis.toUpperCase()}${value.direction > 0 ? "+" : "-"} ${Math.round(value.offset * 100)}%`);
  const box = viewer.clipBoxState();
  if (box.enabled) active.push(`Куб ${Math.round(box.scale * 100)}%`);
  clipInfoNode.textContent = active.length ? active.join(" / ") : "Сечение выключено";
  clipBadgeNode.textContent = String(active.length);
  document.getElementById("clip-menu")?.classList.toggle("active", active.length > 0);
}

function syncClipControls(preferredAxis?: ClipAxis): void {
  const state = viewer.clipState();
  const axis = preferredAxis || (Object.entries(state).find(([, value]) => value.enabled)?.[0] as ClipAxis | undefined) || "y";
  const setting = state[axis];
  clipAxisInput.value = axis;
  updateClipDirectionOptions();
  clipDirectionInput.value = String(setting.direction);
  clipOffsetInput.value = String(Math.round(setting.offset * 100));
  clipEnabledInput.checked = setting.enabled;
  const box = viewer.clipBoxState();
  clipBoxEnabledInput.checked = box.enabled;
  clipBoxSizeInput.value = String(Math.round(box.scale * 100));
  renderClipInfo();
}

function updateClipDirectionOptions(): void {
  const axis = clipAxisInput.value as ClipAxis;
  const labels: Record<ClipAxis, [string, string]> = {
    x: ["+X вправо", "-X влево"],
    y: ["+Y вверх", "-Y вниз"],
    z: ["+Z вперёд", "-Z назад"],
  };
  const current = clipDirectionInput.value === "-1" ? "-1" : "1";
  clipDirectionInput.innerHTML = `
    <option value="1">${labels[axis][0]}</option>
    <option value="-1">${labels[axis][1]}</option>
  `;
  clipDirectionInput.value = current;
}

function statCard(label: string, value: number): string {
  return `<div class="stat"><span>${label}</span><strong>${formatNumber(value)}</strong></div>`;
}

function propLine(key: string, value: unknown): string {
  return `
    <div class="prop-row">
      <span class="key">${escapeHtml(key)}</span>
      <span class="value">${escapeHtml(formatValue(value))}</span>
    </div>
  `;
}

function flattenProperties(value: Record<string, unknown>, prefix = ""): [string, unknown][] {
  const out: [string, unknown][] = [];
  for (const [key, item] of Object.entries(value)) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const nested = flattenProperties(item as Record<string, unknown>, name);
      if (nested.length) {
        out.push(...nested);
      } else {
        out.push([name, item]);
      }
    } else {
      out.push([name, item]);
    }
  }
  return out;
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(formatValue).join(", ")}]`;
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value ?? "");
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(value);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const replacements: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return replacements[char] || char;
  });
}

function shortLabel(value: string): string {
  return value.length > 18 ? `${value.slice(0, 17)}…` : value;
}

function layerColor(layer: string): string {
  const palette = ["#38bdf8", "#22c55e", "#f59e0b", "#ef4444", "#a78bfa", "#14b8a6", "#f97316", "#e879f9", "#84cc16"];
  let hash = 0;
  for (let index = 0; index < layer.length; index++) {
    hash = ((hash << 5) - hash + layer.charCodeAt(index)) | 0;
  }
  return palette[Math.abs(hash) % palette.length];
}

function sourceLabel(payload: CadBimSourceResponse["payload"], fallback: string): string {
  if (payload && !Array.isArray(payload)) {
    return payload.name || payload.id || fallback.split("/").pop() || fallback;
  }
  return fallback.split("/").pop() || "CAD/BIM JSON";
}

function uniqueModelId(label: string): string {
  const base = label
    .replace(/\.[^.]+$/g, "")
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .toLowerCase() || "model";
  let candidate = base;
  let index = 2;
  const existing = new Set(currentModels.map((model) => model.id));
  while (existing.has(candidate)) {
    candidate = `${base}-${index++}`;
  }
  return candidate;
}

function buildStructure(elements: CadBimElement[]): Map<string, Map<string, number>> {
  const levels = new Map<string, Map<string, number>>();
  for (const element of elements) {
    const level = String(element.level || "Без уровня");
    const category = String(element.category || element.family || element.type || element.object_type || "Элемент");
    const categories = levels.get(level) || new Map<string, number>();
    categories.set(category, (categories.get(category) || 0) + 1);
    levels.set(level, categories);
  }
  return new Map(
    [...levels.entries()]
      .sort(([a], [b]) => a.localeCompare(b, "ru"))
      .map(([level, categories]) => [
        level,
        new Map([...categories.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ru"))),
      ]),
  );
}

function ifcModelsFromSelection(selection: string): IfcModelSource[] {
  const normalized = selection.trim();
  if (normalized === "samples") return LOCIA_SAMPLE_MODELS;
  if (!normalized || normalized === "demo" || normalized === "building") return BUILDINGSMART_DEMO_MODELS;
  if (normalized === "hvac") return BUILDINGSMART_DEMO_MODELS.filter((model) => model.id === "Building-Hvac");
  const byId = BUILDINGSMART_DEMO_MODELS.find((model) => model.id === normalized || `${model.id}.ifc` === normalized);
  if (byId) return [byId];
  const label = normalized.split("/").pop() || normalized;
  return [{ id: label.replace(/\.ifc$/i, ""), label, url: directIfcUrl(normalized) }];
}

function linkedIfcModelsFromParams(raw: string): IfcModelSource[] {
  if (!raw.trim()) return [];
  try {
    const decoded = JSON.parse(raw) as unknown;
    if (!Array.isArray(decoded)) return [];
    return decoded
      .slice(0, 50)
      .map((item, index): IfcModelSource | null => {
        if (!item || typeof item !== "object") return null;
        const row = item as Record<string, unknown>;
        const url = typeof row.url === "string" ? row.url.trim() : "";
        const fragUrl = typeof row.fragUrl === "string" ? row.fragUrl.trim() : "";
        const fragCacheUrl = typeof row.fragCacheUrl === "string" ? row.fragCacheUrl.trim() : "";
        if (!url && !fragUrl) return null;
        const label = (typeof row.label === "string" && row.label.trim()) || (url || fragUrl).split("/").pop() || `Модель ${index + 1}`;
        const id = (typeof row.id === "string" && row.id.trim()) || uniqueModelId(label);
        return {
          id,
          label,
          url: url ? directIfcUrl(url) : "",
          ...(fragUrl ? { fragUrl: directIfcUrl(fragUrl) } : {}),
          ...(fragCacheUrl ? { fragCacheUrl: directIfcUrl(fragCacheUrl) } : {}),
        };
      })
      .filter((item): item is IfcModelSource => item !== null);
  } catch {
    return [];
  }
}

function directIfcUrl(path: string): string {
  const normalized = path.trim();
  if (
    /^https?:\/\//i.test(normalized) ||
    normalized.startsWith("blob:") ||
    normalized.startsWith("/") ||
    normalized.startsWith("./") ||
    normalized.startsWith("../")
  ) {
    return normalized;
  }
  return viewerAssetUrl(normalized);
}

function localIsoDate(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function viewerAssetUrl(path: string): string {
  const meta = import.meta as unknown as { env?: { BASE_URL?: string } };
  const base = meta.env?.BASE_URL || viewerRuntimeBase();
  return `${base.endsWith("/") ? base : `${base}/`}${path}`;
}

function viewerRuntimeBase(): string {
  const script = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"], script[type="module"][src*="assets/"]');
  if (!script?.src) return `${window.location.origin}/les/cad-bim-viewer/`;
  const url = new URL(script.src, window.location.href);
  url.pathname = url.pathname.replace(/assets\/[^/]+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString();
}

function isDirectJsonSource(sourcePath: string): boolean {
  const value = sourcePath.trim();
  if (!value) return false;
  return (
    /^https?:\/\//i.test(value) ||
    value.startsWith("./") ||
    value.startsWith("../") ||
    value.startsWith("/") ||
    value.startsWith("models/") ||
    value.endsWith(".json")
  );
}

function setStatus(message: string, error = false): void {
  statusNode.textContent = message;
  statusNode.classList.toggle("error", error);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await loadGraph(sourceInput.value.trim());
});

modelerToggleBtn?.addEventListener("click", () => {
  setUiMode(uiMode === "modeler" ? "viewer" : "modeler", true);
});

document.querySelectorAll<HTMLButtonElement>("[data-modeler-tool]").forEach((button) => {
  button.addEventListener("click", () => {
    const tool = button.dataset.modelerTool || "select";
    document.querySelectorAll<HTMLButtonElement>("[data-modeler-tool]").forEach((item) => {
      item.classList.toggle("active", item.dataset.modelerTool === tool);
    });
    if (uiMode !== "modeler") setUiMode("modeler", true);
    setStatus(tool === "select" ? "режим выбора" : `инструмент: ${button.textContent?.trim() || tool}`);
  });
});

document.getElementById("load-default-model")?.addEventListener("click", () => {
  void loadDefaultModel();
});
document.getElementById("fit-btn")?.addEventListener("click", () => viewer.fit());
publicModelForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!publicModelSelect) return;
  void loadIfcSelection(publicModelSelect.value);
});
document.querySelectorAll<HTMLButtonElement>("button[data-standard-view]").forEach((button) => {
  button.addEventListener("click", () => {
    const view = button.dataset.standardView || "3d";
    void (async () => {
      if (view === "3d") {
        await viewer.set3dView();
        if (!isPublicAtlasBuild && !window.matchMedia("(pointer: coarse)").matches) {
          await viewer.setWalkMode(true);
        }
        syncClipControls();
        setStatus("3D-вид");
      } else {
        await viewer.setStandardView(view as StandardView, true);
        const axis: ClipAxis = view === "top" ? "y" : view === "front" ? "z" : "x";
        syncClipControls(axis);
        setStatus(`${button.textContent?.trim() || "2D"}: ортографический вид и автосечение`);
      }
      document.querySelectorAll<HTMLButtonElement>("button[data-standard-view]").forEach((item) => {
        item.classList.toggle("active", item.dataset.standardView === view);
      });
    })();
  });
});
document.getElementById("reload-btn")?.addEventListener("click", () => {
  if (currentMode === "ifc") {
    // «Обновить»: подтянуть НОВУЮ версию из серверной папки. Сбрасываем браузерный
    // кеш разобранных фрагментов (IndexedDB) и обходим HTTP-кеш .frag, иначе
    // обновлённый на сервере файл не загрузится. Текущий источник (?frag/?ifc или
    // самплы) перечитывается заново.
    void (async () => {
      await cacheClear();
      viewer.setIfcFreshFetch(true);
      try {
        if (initialLinkedModels.length) await loadIfcModels(initialLinkedModels);
        else if (initialFrag) await loadFragOnly(initialFrag);
        else if (isStandaloneViewer && currentIfcSelection === "default") await loadDefaultModel();
        else await loadIfcSelection(currentIfcSelection || (isStandaloneViewer ? "default" : "demo"));
      } finally {
        viewer.setIfcFreshFetch(false);
      }
    })();
  } else {
    void loadGraph(latestSource);
  }
});
// «Ссылка»: копирует текущий URL вьювера (с ?ifc=…&frag=…) для пересылки.
// Показываем только когда открыта конкретная модель по ссылке — иначе копировать
// нечего (пустой вьювер/самплы шарить бессмысленно).
{
  const copyLinkBtn = document.getElementById("copy-link-btn") as HTMLButtonElement | null;
  if (copyLinkBtn && (initialIfc || initialFrag || initialSource || initialLinkedModels.length)) {
    copyLinkBtn.hidden = false;
    copyLinkBtn.addEventListener("click", async () => {
      const url = shareableUrl();
      if (await copyToClipboard(url)) {
        const prev = copyLinkBtn.textContent;
        copyLinkBtn.textContent = "Скопировано";
        window.setTimeout(() => {
          copyLinkBtn.textContent = prev;
        }, 1400);
      } else {
        window.prompt("Скопируйте ссылку на модель", url);
      }
    });
  }
}
{
  const atlasTaskBtn = document.getElementById("atlas-task-btn") as HTMLButtonElement | null;
  if (atlasTaskBtn) {
    atlasTaskBtn.hidden = false;
    atlasTaskBtn.addEventListener("click", () => {
      window.open(atlasTaskUrl(), "_blank", "noopener,noreferrer");
    });
  }
}
document.getElementById("top-add-file-btn")?.addEventListener("click", () => addFileInput.click());
document.getElementById("add-file-btn")?.addEventListener("click", () => addFileInput.click());
addFileInput.addEventListener("change", async () => {
  await addLocalFiles(addFileInput.files || []);
  addFileInput.value = "";
});
document.getElementById("tool-fit-selected")?.addEventListener("click", () => {
  if (!viewer.focusSelected() && selectedElement?.id) viewer.focusElement(selectedElement.id);
});
document.getElementById("tool-hide")?.addEventListener("click", () => {
  if (!viewer.hideSelected()) setStatus("сначала выбери элемент", true);
});
document.getElementById("tool-isolate")?.addEventListener("click", () => {
  if (!viewer.isolateSelected()) setStatus("сначала выбери элемент", true);
});
document.getElementById("tool-show-all")?.addEventListener("click", () => {
  viewer.showAll();
  currentLayers.forEach((row) => (row.visible = true));
  renderLayerRows();
});
// XYZ-панель замера (как readout в Navisworks): координаты старта/конца, ΔX/ΔY/ΔZ
// и прямое расстояние видны постоянно. Фиксация оси даёт орто-замер вдоль X/Y/Z.
function renderMeasureReadout(r: MeasureReadout | null): void {
  if (!r) {
    measureReadoutNode.innerHTML = `<div class="tool-info">Замер выключен. Координаты точки, ΔX/ΔY/ΔZ и прямое появятся здесь.</div>`;
    return;
  }
  const f = (v: number): string => v.toFixed(3);
  const lock = r.axisLock ? ` · ось ${r.axisLock.toUpperCase()}` : "";
  let rows = "";
  if (r.start) rows += `<div class="measure-row"><span>Старт</span><b>X ${f(r.start.x)} · Y ${f(r.start.y)} · Z ${f(r.start.z)}</b></div>`;
  if (r.end) rows += `<div class="measure-row"><span>Конец</span><b>X ${f(r.end.x)} · Y ${f(r.end.y)} · Z ${f(r.end.z)}</b></div>`;
  if (r.delta) rows += `<div class="measure-row"><span>ΔX / ΔY / ΔZ</span><b>${f(r.delta.x)} / ${f(r.delta.y)} / ${f(r.delta.z)}</b></div>`;
  if (r.distance != null) rows += `<div class="measure-row measure-row--total"><span>Прямое</span><b>${f(r.distance)} м</b></div>`;
  measureReadoutNode.innerHTML = `<div class="tool-info">${escapeHtml(r.hint)}${lock}</div>${rows ? `<div class="measure-table">${rows}</div>` : ""}`;
}
document.getElementById("measure-distance")?.addEventListener("click", () => {
  measureEnabled = !measureEnabled;
  viewer.setMeasureMode(measureEnabled);
  document.getElementById("measure-distance")?.classList.toggle("active", measureEnabled);
});
document.querySelectorAll<HTMLButtonElement>("#measure-axis button[data-axis]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const axis = btn.dataset.axis === "free" ? null : (btn.dataset.axis as "x" | "y" | "z");
    viewer.setMeasureAxisLock(axis);
    document.querySelectorAll("#measure-axis button[data-axis]").forEach((b) => b.classList.toggle("active", b === btn));
  });
});
document.getElementById("measure-gap")?.addEventListener("click", () => {
  void viewer.measureGapStep().then((msg) => renderMeasureReadout({ hint: msg }));
});
document.getElementById("measure-clear")?.addEventListener("click", () => viewer.clearMeasurements());
clipEnabledInput.addEventListener("change", applyClip);
clipAxisInput.addEventListener("change", () => {
  updateClipDirectionOptions();
  applyClip();
});
clipDirectionInput.addEventListener("change", applyClip);
clipOffsetInput.addEventListener("input", applyClip);
clipBoxEnabledInput.addEventListener("change", () => {
  void (async () => {
    const enabled = clipBoxEnabledInput.checked;
    const ok = await viewer.setClipBox(enabled, Number(clipBoxSizeInput.value) / 100, "scene");
    if (!ok) {
      clipBoxEnabledInput.checked = false;
      setStatus("для куба сначала загрузи модель", true);
    }
    renderClipInfo();
  })();
});
clipBoxSizeInput.addEventListener("input", () => {
  viewer.setClipBoxScale(Number(clipBoxSizeInput.value) / 100);
  renderClipInfo();
});
document.getElementById("clip-box-scene")?.addEventListener("click", () => {
  void viewer.setClipBox(true, Number(clipBoxSizeInput.value) / 100, "scene").then((ok) => {
    clipBoxEnabledInput.checked = ok;
    if (!ok) setStatus("для куба сначала загрузи модель", true);
    renderClipInfo();
  });
});
document.getElementById("clip-box-selected")?.addEventListener("click", () => {
  void viewer.setClipBox(true, Number(clipBoxSizeInput.value) / 100, "selected").then((ok) => {
    clipBoxEnabledInput.checked = ok || viewer.clipBoxState().enabled;
    if (!ok) setStatus("для куба сначала выбери элемент", true);
    else setStatus("куб сечения построен по выбранному элементу");
    renderClipInfo();
  });
});
document.getElementById("clip-clear")?.addEventListener("click", () => {
  clipEnabledInput.checked = false;
  viewer.clearClipPlanes();
  viewer.clearClipBox();
  syncClipControls();
});
document.getElementById("clip-mid")?.addEventListener("click", () => {
  clipOffsetInput.value = "50";
  applyClip();
});
document.querySelectorAll<HTMLButtonElement>("button[data-source-id]").forEach((button) => {
  button.addEventListener("click", async () => {
    const item = QUICK_SOURCES.find((source) => source.id === button.dataset.sourceId);
    if (!item) return;
    const source = item.source;
    if (source != null) {
      sourceInput.value = source;
      await loadGraph(source);
    } else if (item.ifc === "default") {
      await loadDefaultModel();
    } else {
      await loadIfcSelection(item.ifc);
    }
  });
});
document.querySelectorAll<HTMLButtonElement>(".tabs button[data-tab]").forEach((button) => {
  button.addEventListener("click", () => {
    const tab = button.dataset.tab || "inspect";
    document.querySelectorAll<HTMLButtonElement>(".tabs button[data-tab]").forEach((item) => {
      const active = item === button;
      item.classList.toggle("active", active);
      item.setAttribute("aria-selected", active ? "true" : "false");
    });
    document.querySelector(".shell")?.setAttribute("data-tab", tab);
    // IFC: слои и структура строятся лениво при первом открытии вкладки.
    if (viewer.isIfcMode()) {
      if (tab === "layers" && !ifcLayersBuilt) void buildIfcLayers();
      if (tab === "structure" && !ifcStructureBuilt) void buildIfcStructure();
    }
  });
});
layerFilterInput.addEventListener("input", () => {
  if (viewer.isIfcMode()) {
    renderIfcLayerRows();
  } else {
    renderLayerRows();
  }
});
document.getElementById("layers-all")?.addEventListener("click", () => {
  if (viewer.isIfcMode()) {
    setAllIfcLayers(true);
    return;
  }
  currentLayers.forEach((row) => {
    row.visible = true;
    viewer.setLayerVisible(row.name, true);
  });
  renderLayerRows();
});
document.getElementById("layers-none")?.addEventListener("click", () => {
  if (viewer.isIfcMode()) {
    setAllIfcLayers(false);
    return;
  }
  currentLayers.forEach((row) => {
    row.visible = false;
    viewer.setLayerVisible(row.name, false);
  });
  renderLayerRows();
});
document.getElementById("models-show-all")?.addEventListener("click", () => {
  viewer.showAll();
  currentLayers.forEach((row) => (row.visible = true));
  renderLayerRows();
});
document.getElementById("models-fit-all")?.addEventListener("click", () => viewer.fit());
structureFilterInput.addEventListener("input", () => {
  if (viewer.isIfcMode()) {
    filterIfcStructure();
  } else {
    renderStructure();
  }
});

updateClipDirectionOptions();
boot().catch((error) => {
  setStatus(error instanceof Error ? error.message : String(error), true);
});
