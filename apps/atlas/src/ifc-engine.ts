import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
import type { IfcModelSource, IfcRenderResult, IfcSelection } from "./types";
import { cacheGet, cachePut } from "./ifc-cache";

type StoreyInfo = { name: string; elevation: number | null; baseZ: number | null };

export interface IfcEngineOptions {
  components: OBC.Components;
  world: OBC.World;
  root: THREE.Group;
  requestRender: () => void;
  onSelect: (selection: IfcSelection | null) => void;
}

export class IfcEngine {
  readonly components: OBC.Components;

  readonly world: OBC.World;

  readonly root: THREE.Group;

  fragments: any = null;

  private ifcLoader: any = null;

  private highlighter: any = null;

  private ready = false;

  // Текущий выбор (модель+localId): единый источник для инструментов
  // «Скрыть/Изолировать/Вписать» — они должны работать для IFC/.frag так же,
  // как для JSON, независимо от формата данных.
  private selected: { modelId: string; localId: number } | null = null;

  // Принудительно обходить браузерный HTTP-кеш при загрузке (кнопка «Обновить»):
  // сервер отдаёт .frag с max-age=3600, иначе новая версия не подтянется.
  private freshFetch = false;

  setFreshFetch(value: boolean): void {
    this.freshFetch = value;
  }

  private readonly requestRender: () => void;

  private readonly emitSelect: (selection: IfcSelection | null) => void;

  constructor(options: IfcEngineOptions) {
    this.components = options.components;
    this.world = options.world;
    this.root = options.root;
    this.requestRender = options.requestRender;
    this.emitSelect = options.onSelect;
  }

  async loadModels(models: IfcModelSource[], onProgress?: (message: string) => void, replace = true): Promise<IfcRenderResult> {
    try {
      onProgress?.("подготовка IFC runtime...");
      await this.ensureReady();
    } catch (error) {
      throw new Error(`IFC runtime: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (replace) {
      this.clear();
      // Выгружаем ранее загруженные модели из FragmentsManager, иначе повторная
      // загрузка тех же id (например по кнопке «Самплы») молча срывается и сцена пустеет.
      await this.disposeAllFragments();
    }
    let loaded = 0;
    for (const model of models) {
      onProgress?.(`загрузка ${model.label}...`);
      await this.loadOneModel(model, onProgress);
      loaded += 1;
      onProgress?.(`загружено ${loaded}/${models.length}: ${model.label}`);
    }
    await this.fragments?.core?.update?.(true);
    this.requestRender();
    return { models, loaded };
  }

  async highlightByGuids(globalIds: string[]): Promise<number> {
    await this.ensureReady();
    const map: Record<string, Set<number>> = {};
    let count = 0;
    for (const [modelId, model] of this.fragments.list) {
      const localIds = await model.getLocalIdsByGuids(globalIds);
      const hits = localIds.filter((id: number | null): id is number => id !== null);
      if (!hits.length) continue;
      map[modelId] = new Set(hits);
      count += hits.length;
    }
    if (!count) return 0;
    await this.highlighter.highlightByID("select", map, false, false);
    return count;
  }

  // Выбор элемента по клику. mouse — КЛИЕНТСКИЕ координаты (event.clientX/Y):
  // model.raycast сам вычитает rect.left/top по dom (см. screenToCast в движке).
  // Рейкастим все модели, берём ближайшее попадание, подсвечиваем и отдаём свойства.
  async pick(mouse: THREE.Vector2, dom: HTMLCanvasElement): Promise<void> {
    if (!this.fragments?.list?.size) return;
    const camera = (this.world.camera as any).three;
    let best: any = null;
    let bestId: string | null = null;
    for (const [modelId, model] of this.fragments.list) {
      let res: any = null;
      try {
        res = await model.raycast({ camera, mouse, dom });
      } catch {
        res = null;
      }
      if (res && (best === null || res.distance < best.distance)) {
        best = res;
        bestId = modelId;
      }
    }
    if (!best || bestId === null) {
      try { await this.highlighter?.clear?.("select"); } catch { /* ignore */ }
      this.selected = null;
      this.emitSelect(null);
      this.requestRender();
      return;
    }
    const map: Record<string, Set<number>> = { [bestId]: new Set([best.localId]) };
    try {
      await this.highlighter?.highlightByID?.("select", map, true, false);
    } catch {
      /* подсветка вторична — свойства покажем в любом случае */
    }
    await this.handleSelection(map);
    await this.orbitAround(bestId, best);
    this.requestRender();
  }

  // Делает выбранный элемент центром вращения камеры: ставит точку орбиты на
  // центр его габаритов (без рывка вида — setOrbitPoint сохраняет кадр).
  private async orbitAround(modelId: string, hit: any): Promise<void> {
    let px: number | undefined;
    let py: number | undefined;
    let pz: number | undefined;
    try {
      const model = this.fragments?.list?.get?.(modelId);
      const boxes = await model?.getBoxes?.([hit.localId]);
      const box = boxes?.[0];
      if (box?.min && box?.max) {
        px = (box.min.x + box.max.x) / 2;
        py = (box.min.y + box.max.y) / 2;
        pz = (box.min.z + box.max.z) / 2;
      }
    } catch {
      /* габариты недоступны — используем точку клика */
    }
    if (px === undefined && hit?.point) {
      px = hit.point.x;
      py = hit.point.y;
      pz = hit.point.z;
    }
    if (px === undefined) return;
    const controls = (this.world.camera as any)?.controls;
    try {
      if (controls?.setOrbitPoint) {
        controls.setOrbitPoint(px, py, pz);
      } else if (controls?.setTarget) {
        controls.setTarget(px, py, pz, true);
      }
    } catch {
      /* управление камерой недоступно — не критично */
    }
  }

  clear(): void {
    this.highlighter?.clear?.("select");
    this.selected = null;
    this.emitSelect(null);
    for (const child of [...this.root.children]) {
      this.root.remove(child);
    }
  }

  private async disposeAllFragments(): Promise<void> {
    this.storeyCache.clear();
    this.categoryCache.clear();
    this.spatialCache.clear();
    this.selected = null;
    const list = this.fragments?.list;
    if (!list) return;
    for (const modelId of [...list.keys()]) {
      try {
        await this.fragments.core?.disposeModel?.(modelId);
      } catch {
        /* модель уже выгружена или недоступна — не критично */
      }
    }
  }

  modelObject(modelId: string): THREE.Object3D | null {
    const model = this.fragments?.list?.get?.(modelId);
    return model?.object || null;
  }

  setModelVisible(modelId: string, visible: boolean): boolean {
    const object = this.modelObject(modelId);
    if (!object) return false;
    object.visible = visible;
    this.requestRender();
    return true;
  }

  removeModel(modelId: string): boolean {
    const object = this.modelObject(modelId);
    if (!object) return false;
    this.root.remove(object);
    this.fragments?.list?.delete?.(modelId);
    this.storeyCache.delete(modelId);
    this.categoryCache.delete(modelId);
    this.spatialCache.delete(modelId);
    if (this.selected?.modelId === modelId) this.selected = null;
    this.highlighter?.clear?.("select");
    this.emitSelect(null);
    this.requestRender();
    return true;
  }

  async handleSelection(modelIdMap: Record<string, Set<number>>): Promise<void> {
    for (const [modelId, localIdSet] of Object.entries(modelIdMap)) {
      const localIds = [...localIdSet];
      if (!localIds.length) continue;
      const model = this.fragments?.list?.get(modelId);
      if (!model) continue;
      const localId = localIds[0];
      const guids = await model.getGuidsByLocalIds?.([localId]);
      const globalId = String(guids?.[0] || "");
      const rows = await this.itemRows(model, localId, modelId);
      this.selected = { modelId, localId };
      this.emitSelect({ modelId, localId, globalId, rows });
      return;
    }
    this.selected = null;
    this.emitSelect(null);
  }

  hasSelection(): boolean {
    return this.selected !== null;
  }

  // Программный выбор по localId (клик в дереве «Структуры»): подсветка,
  // свойства и автозум — как при выборе кликом по геометрии.
  async selectByLocalId(modelId: string, localId: number): Promise<void> {
    const model = this.fragments?.list?.get?.(modelId);
    if (!model) return;
    const map: Record<string, Set<number>> = { [modelId]: new Set([localId]) };
    try {
      await this.highlighter?.highlightByID?.("select", map, true, false);
    } catch { /* подсветка вторична */ }
    await this.handleSelection(map);
    try {
      const boxes = await model.getBoxes?.([localId]);
      const box = boxes?.[0];
      if (box?.min && box?.max) {
        const controls = (this.world.camera as any)?.controls;
        const bounds = new THREE.Box3(
          new THREE.Vector3(box.min.x, box.min.y, box.min.z),
          new THREE.Vector3(box.max.x, box.max.y, box.max.z),
        );
        const sphere = bounds.getBoundingSphere(new THREE.Sphere());
        sphere.radius = Math.max(0.18, sphere.radius * 1.45);
        if (controls?.fitToSphere) await controls.fitToSphere(sphere, true);
        else controls?.setOrbitPoint?.(sphere.center.x, sphere.center.y, sphere.center.z);
      }
    } catch { /* орбита вторична */ }
    this.requestRender();
  }

  // ---- Видимость элементов (инструменты «Скрыть/Изолировать/Показать все») ----

  // Перерисовка фрагментов после изменения видимости: без core.update(true)
  // движок откладывает применение до следующего «rest» камеры.
  private async refreshView(): Promise<void> {
    try { await this.fragments?.core?.update?.(true); } catch { /* не критично */ }
    this.requestRender();
  }

  async hideSelected(): Promise<boolean> {
    const sel = this.selected;
    if (!sel) return false;
    const model = this.fragments?.list?.get?.(sel.modelId);
    if (!model?.setVisible) return false;
    try {
      await model.setVisible([sel.localId], false);
      try { await this.highlighter?.clear?.("select"); } catch { /* ignore */ }
      this.selected = null;
      this.emitSelect(null);
      await this.refreshView();
      return true;
    } catch {
      return false;
    }
  }

  async isolateSelected(): Promise<boolean> {
    const sel = this.selected;
    if (!sel) return false;
    try {
      for (const [modelId, model] of this.fragments?.list ?? []) {
        if (!model?.setVisible) continue;
        // Прячем всё видимое; основной путь — точный список видимых id,
        // запасной — setVisible(undefined) (вся модель), если метод недоступен.
        try {
          const visible: number[] = (await model.getItemsByVisibility?.(true)) ?? [];
          if (visible.length) {
            await model.setVisible(visible, false);
          } else {
            await model.setVisible(undefined, false);
          }
        } catch {
          await model.setVisible(undefined, false);
        }
        if (modelId === sel.modelId) {
          await model.setVisible([sel.localId], true);
        }
      }
      await this.refreshView();
      return true;
    } catch {
      return false;
    }
  }

  async showAllItems(): Promise<void> {
    try {
      for (const [, model] of this.fragments?.list ?? []) {
        try {
          if (model?.resetVisible) {
            await model.resetVisible();
          } else if (model?.setVisible) {
            await model.setVisible(undefined, true);
          }
        } catch { /* модель без поддержки видимости — пропускаем */ }
      }
      await this.refreshView();
    } catch { /* не критично */ }
  }

  // Габариты выбранного элемента — для «Вписать» (камера по box).
  async selectedBox(): Promise<THREE.Box3 | null> {
    const sel = this.selected;
    if (!sel) return null;
    try {
      const model = this.fragments?.list?.get?.(sel.modelId);
      const boxes = await model?.getBoxes?.([sel.localId]);
      const box = boxes?.[0];
      if (box?.min && box?.max) {
        return new THREE.Box3(
          new THREE.Vector3(box.min.x, box.min.y, box.min.z),
          new THREE.Vector3(box.max.x, box.max.y, box.max.z),
        );
      }
    } catch { /* габариты недоступны */ }
    return null;
  }

  // Точка на геометрии под курсором (для инструмента «Размеры»): тот же
  // рейкаст фрагментов, что и при выборе, но без подсветки/свойств.
  async raycastPoint(mouse: THREE.Vector2, dom: HTMLCanvasElement): Promise<THREE.Vector3 | null> {
    if (!this.fragments?.list?.size) return null;
    const camera = (this.world.camera as any).three;
    let best: any = null;
    for (const [, model] of this.fragments.list) {
      try {
        const res = await model.raycast({ camera, mouse, dom });
        if (res && (best === null || res.distance < best.distance)) best = res;
      } catch { /* модель без геометрии — пропускаем */ }
    }
    const p = best?.point;
    return p ? new THREE.Vector3(p.x, p.y, p.z) : null;
  }

  // ---- Слои: категории IFC → списки localId (кэш на модель) ----

  private categoryCache = new Map<string, Map<string, number[]>>();

  async categoriesMap(modelId: string): Promise<Map<string, number[]>> {
    const cached = this.categoryCache.get(modelId);
    if (cached) return cached;
    const out = new Map<string, number[]>();
    try {
      const model = this.fragments?.list?.get?.(modelId);
      const cats: string[] = (await model?.getCategories?.()) ?? [];
      if (cats.length && model?.getItemsOfCategories) {
        const escaped = cats.map((c) => new RegExp(`^${c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
        const grouped: Record<string, number[]> = (await model.getItemsOfCategories(escaped)) ?? {};
        for (const [cat, ids] of Object.entries(grouped)) {
          if (Array.isArray(ids) && ids.length) out.set(cat, ids);
        }
      }
    } catch { /* категории недоступны — вернём пустую карту */ }
    this.categoryCache.set(modelId, out);
    return out;
  }

  async setItemsVisible(modelId: string, localIds: number[], visible: boolean): Promise<void> {
    if (!localIds.length) return;
    try {
      const model = this.fragments?.list?.get?.(modelId);
      await model?.setVisible?.(localIds, visible);
      await this.refreshView();
    } catch { /* не критично */ }
  }

  async setItemsOpacity(modelId: string, localIds: number[], opacity: number): Promise<void> {
    if (!localIds.length) return;
    try {
      const model = this.fragments?.list?.get?.(modelId);
      const value = Math.max(0.08, Math.min(1, opacity));
      if (value >= 0.999 && model?.resetOpacity) await model.resetOpacity(localIds);
      else await model?.setOpacity?.(localIds, value);
      await this.refreshView();
    } catch { /* не критично */ }
  }

  async highlightItems(modelId: string, localIds: number[]): Promise<void> {
    if (!localIds.length) return;
    await this.ensureReady();
    try {
      const map: Record<string, Set<number>> = { [modelId]: new Set(localIds) };
      await this.highlighter?.highlightByID?.("group", map, true, true);
      await this.refreshView();
    } catch { /* подсветка группы вторична */ }
  }

  // ---- Структура: пространственное дерево IFC (кэш на модель) ----

  private spatialCache = new Map<string, any>();

  async spatialStructure(modelId: string): Promise<any | null> {
    if (this.spatialCache.has(modelId)) return this.spatialCache.get(modelId);
    let tree: any = null;
    try {
      const model = this.fragments?.list?.get?.(modelId);
      tree = (await model?.getSpatialStructure?.()) ?? null;
    } catch { /* структура недоступна */ }
    this.spatialCache.set(modelId, tree);
    return tree;
  }

  // Имена узлов батчем (Name/LongName) — для подписей дерева структуры.
  async namesFor(modelId: string, localIds: number[]): Promise<Map<number, string>> {
    const out = new Map<number, string>();
    if (!localIds.length) return out;
    try {
      const model = this.fragments?.list?.get?.(modelId);
      const data = (await model?.getItemsData?.(localIds, { attributesDefault: true })) ?? [];
      const unwrap = (v: any): string => {
        const x = v && typeof v === "object" && "value" in v ? v.value : v;
        return typeof x === "string" ? x : "";
      };
      localIds.forEach((id, i) => {
        const d: any = data[i] ?? {};
        const name = unwrap(d.Name) || unwrap(d.LongName) || unwrap(d.ObjectType);
        if (name) out.set(id, name);
      });
    } catch { /* имена вторичны — дерево покажем по категориям */ }
    return out;
  }

  async ensureReady(): Promise<void> {
    if (this.ready) return;
    this.fragments = this.components.get((OBC as any).FragmentsManager);
    this.fragments.init(viewerAssetUrl("fragments/worker.mjs"));
    (this.world.camera as any).controls.addEventListener("rest", () => this.fragments?.core?.update?.(true));
    (this.world.camera as any).projection.onChanged.add(() => {
      for (const [, model] of this.fragments.list) model.useCamera(this.world.camera.three);
    });
    this.fragments.list.onItemSet.add(async ({ value: model }: { key: string; value: any }) => {
      model.useCamera(this.world.camera.three);
      model.getClippingPlanesEvent = () => Array.from(this.world.renderer?.three.clippingPlanes || []);
      this.root.add(model.object);
      await this.fragments.core.update(true);
      this.requestRender();
    });

    this.ifcLoader = this.components.get((OBC as any).IfcLoader);
    await this.ifcLoader.setup({
      autoSetWasm: false,
      wasm: { absolute: true, path: viewerAssetUrl("web-ifc/") },
    });

    this.highlighter = this.components.get(OBF.Highlighter);
    this.highlighter.setup({
      world: this.world,
      // Выбор по клику ведём сами через рейкаст фрагментов (pick()): встроенный
      // autoHighlightOnClick хайлайтера в этом окружении не получал события клика.
      // Хайлайтер используем для подсветки выбранного (highlightByID работает).
      selectEnabled: true,
      autoHighlightOnClick: false,
      selectMaterialDefinition: {
        color: new THREE.Color("#facc15"),
        renderedFaces: 0,
        opacity: 1,
        transparent: false,
      },
    });
    this.highlighter.styles.set("group", {
      color: new THREE.Color("#38bdf8"),
      renderedFaces: 0,
      opacity: 0.72,
      transparent: true,
    });
    this.highlighter.enabled = true;
    this.highlighter.events.select.onHighlight.add((modelIdMap: Record<string, Set<number>>) => {
      void this.handleSelection(modelIdMap);
    });
    this.highlighter.events.select.onClear.add(() => this.emitSelect(null));
    this.ready = true;
  }

  private async fetchBytes(url: string): Promise<Uint8Array> {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Accept: "application/octet-stream" },
        cache: this.freshFetch ? "reload" : "default",
      });
    } catch (error) {
      throw new Error(`IFC fetch ${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`IFC fetch ${url} ${response.status}: ${text.slice(0, 180)}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  private async loadOneModel(model: IfcModelSource, onProgress?: (message: string) => void): Promise<void> {
    // 1) Предсобранные фрагменты — самый быстрый путь (web-ifc не дёргается).
    if (model.fragUrl) {
      try {
        const fb = await this.fetchBytes(model.fragUrl);
        await this.loadFragmentBuffer(fb, model.id);
        return;
      } catch (error) {
        if (!model.url) {
          throw new Error(`Фрагменты недоступны: ${model.label} (${error instanceof Error ? error.message : String(error)})`);
        }
        onProgress?.(`фрагменты недоступны, разбираю IFC: ${model.label}...`);
      }
    }
    // 2) IFC: пробуем кеш разобранной модели в браузере.
    const cacheKey = `${model.url}::${await this.versionTag(model.url)}`;
    try {
      const cached = await cacheGet(cacheKey);
      if (cached) {
        await this.loadFragmentBuffer(cached, model.id);
        return;
      }
    } catch {
      /* кеш недоступен — продолжаем обычным путём */
    }
    // 3) Первый разбор IFC через web-ifc + сохранение результата в кеш.
    const bytes = await this.fetchBytes(model.url);
    const mb = Math.round(bytes.length / (1024 * 1024));
    if (mb >= 40) {
      onProgress?.(`разбор большого IFC (${mb} МБ), это может занять до нескольких минут: ${model.label}...`);
    }
    await this.loadIfcBytes(bytes, model.id);
    try {
      const parsed = this.fragments?.list?.get?.(model.id);
      const buffer = await parsed?.getBuffer?.(false);
      if (buffer) {
        await cachePut(cacheKey, buffer as ArrayBuffer);
        // Прозрачный серверный кеш: отдаём построенные фрагменты на сервер, чтобы
        // следующим открывающим (на любом АРМ) модель грузилась мгновенно.
        if (model.fragCacheUrl) {
          void this.uploadFragments(model.fragCacheUrl, buffer as ArrayBuffer);
        }
      }
    } catch {
      /* кеширование не критично для отображения */
    }
  }

  private async uploadFragments(url: string, buffer: ArrayBuffer): Promise<void> {
    try {
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: buffer,
      });
    } catch {
      /* серверный кеш не критичен — у пользователя модель уже отображена */
    }
  }

  private async loadFragmentBuffer(buffer: Uint8Array | ArrayBuffer, modelId: string): Promise<void> {
    await this.fragments.core.load(buffer, {
      modelId,
      camera: (this.world.camera as any).three,
    });
  }

  private async versionTag(url: string): Promise<string> {
    try {
      const head = await fetch(url, { method: "HEAD" });
      return head.headers.get("etag") || head.headers.get("last-modified") || head.headers.get("content-length") || "";
    } catch {
      return "";
    }
  }

  private async loadIfcBytes(bytes: Uint8Array, modelId: string): Promise<void> {
    const load = this.ifcLoader.load(bytes, true, modelId);
    // Таймаут масштабируем по размеру: web-ifc в браузере парсит ~секунды на
    // десятки МБ, но сотни МБ требуют минут. Флатовые 30 с рвали крупные модели
    // (AR на 200 МБ → «IFC parse timeout»). База 60 с + ~6 с/МБ, потолок 10 мин.
    // ВАЖНО: для тяжёлых моделей правильный путь — предсобранный .frag (Node-CLI
    // viewer/scripts/convert-ifc-to-frag.mjs), а не парсинг во вкладке: 200+ МБ —
    // это уже край памяти браузера. См. docs/ATLAS_ENGINE_NOTES.md.
    const mb = bytes.length / (1024 * 1024);
    const timeoutMs = Math.min(600000, Math.max(60000, Math.round(mb * 6000)));
    const timeout = new Promise((_, reject) =>
      window.setTimeout(
        () =>
          reject(
            new Error(
              `IFC parse timeout (${Math.round(mb)} МБ за ${Math.round(timeoutMs / 1000)} с): ${modelId}. ` +
                `Тяжёлую модель лучше предварительно сконвертировать в .frag и подключить как fragUrl.`,
            ),
          ),
        timeoutMs,
      ),
    );
    await Promise.race([load, timeout]);
  }

  // Кеш «этаж по элементу» на модель: строится один раз из пространственной структуры.
  // baseZ — модельная отметка «пола» этажа (минимум Z среди его элементов), нужна
  // для пересчёта модельной Z элемента в проектную отметку от ±0.000.
  private storeyCache = new Map<string, Map<number, StoreyInfo>>();

  private async storeyForElement(model: any, modelId: string, localId: number): Promise<StoreyInfo | null> {
    let map = this.storeyCache.get(modelId);
    if (!map) {
      map = await this.buildStoreyIndex(model);
      this.storeyCache.set(modelId, map);
    }
    return map.get(localId) ?? null;
  }

  // Строит карту localId элемента → {имя этажа, отметка уровня, baseZ}. Этаж — из
  // дерева IfcBuildingStorey (авторитетно). elevation — атрибут Elevation (проектная
  // отметка уровня). baseZ — минимум модельной Z по выборке элементов этажа (≈ пол).
  private async buildStoreyIndex(model: any): Promise<Map<number, StoreyInfo>> {
    const out = new Map<number, StoreyInfo>();
    try {
      const tree = await model.getSpatialStructure?.();
      if (!tree) return out;
      const isStorey = (c: string | null | undefined): boolean => !!c && /BUILDING_?STOREY/i.test(c);
      const storeyLeaves = new Map<number, number[]>();
      const collect = (node: any, acc: number[]): void => {
        if (node?.localId != null) acc.push(node.localId);
        for (const ch of node?.children ?? []) collect(ch, acc);
      };
      const walk = (node: any): void => {
        if (isStorey(node?.category) && node?.localId != null) {
          const leaves: number[] = [];
          for (const ch of node?.children ?? []) collect(ch, leaves);
          storeyLeaves.set(node.localId, leaves);
        } else {
          for (const ch of node?.children ?? []) walk(ch);
        }
      };
      walk(tree);
      if (!storeyLeaves.size) return out;

      const storeyIds = [...storeyLeaves.keys()];
      const data = (await model.getItemsData?.(storeyIds, { attributesDefault: true })) ?? [];
      const unwrapName = (v: any): string => {
        const x = v && typeof v === "object" && "value" in v ? v.value : v;
        return typeof x === "string" ? x : "";
      };
      const unwrapNum = (v: any): number | null => {
        const x = v && typeof v === "object" && "value" in v ? v.value : v;
        return typeof x === "number" ? x : null;
      };
      const info = new Map<number, StoreyInfo>();
      storeyIds.forEach((sid, i) => {
        const d: any = data[i] ?? {};
        info.set(sid, { name: unwrapName(d.Name) || unwrapName(d.LongName), elevation: unwrapNum(d.Elevation), baseZ: null });
      });

      // baseZ: минимальная отметка низа по выборке элементов этажа (≈ уровень пола).
      for (const [sid, leaves] of storeyLeaves) {
        const inf = info.get(sid);
        if (!inf) continue;
        try {
          const sample = leaves.slice(0, 200);
          if (sample.length) {
            const boxes = (await model.getBoxes?.(sample)) ?? [];
            let minY: number | null = null;
            for (const b of boxes) {
              const y = b?.min?.y; // вертикаль = Y (Y-up); пол этажа = минимальная Y
              if (typeof y === "number" && (minY === null || y < minY)) minY = y;
            }
            inf.baseZ = minY;
          }
        } catch {
          /* boxes недоступны — оставим baseZ=null, абсолютную отметку просто не покажем */
        }
      }

      for (const [sid, leaves] of storeyLeaves) {
        const inf = info.get(sid) ?? { name: "", elevation: null, baseZ: null };
        for (const leaf of leaves) out.set(leaf, inf);
      }
    } catch {
      /* структура недоступна — вернём пустую карту, свойства покажем без этажа */
    }
    return out;
  }

  private async itemRows(model: any, localId: number, modelId = ""): Promise<[string, unknown][]> {
    try {
      const data = await model.getItemsData([localId], {
        attributesDefault: true,
        relations: {
          IsDefinedBy: { attributes: true, relations: true },
          IsTypedBy: { attributes: true, relations: true },
          HasAssociations: { attributes: true, relations: true },
        },
        relationsDefault: { attributes: false, relations: false },
      });
      const item: any = data?.[0] ?? {};
      const unwrap = (v: any): unknown =>
        v && typeof v === "object" && "value" in v ? v.value : (typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? v : undefined);

      const rows: [string, unknown][] = [];
      const seen = new Set<string>();
      const push = (label: string, val: unknown): void => {
        if (val === undefined || val === null || val === "") return;
        let text: string;
        if (typeof val === "object") {
          try { text = JSON.stringify(val); } catch { return; /* циклическая структура */ }
        } else {
          text = String(val);
        }
        if (text === "" || text === "[object Object]") return;
        const key = label + "\u0000" + text;
        if (seen.has(key)) return;
        seen.add(key);
        rows.push([label, val]);
      };

      push("Категория", unwrap(item._category) ?? item._category);
      const attrLabels: Record<string, string> = {
        Name: "Имя",
        ObjectType: "Тип объекта",
        PredefinedType: "Предопределённый тип",
        Tag: "Метка",
        Description: "Описание",
        GlobalId: "GlobalId",
      };
      for (const key of Object.keys(attrLabels)) push(attrLabels[key], unwrap(item[key]));

      // Геометрические «отметки» и габариты из bounding box. У труб/лотков IFC-Pset
      // обычно бедные, а инженеру нужны отметка и длина. Берём из getBoxes.
      // ВАЖНО: фрагменты/three.js используют Y-UP (IFC Z-up конвертируется), поэтому
      // ВЕРТИКАЛЬ (отметка) — это ось Y, а X/Z — горизонтальная плоскость. Раньше
      // ошибочно бралась Z → показывалась длина прогона вместо высоты.
      let elementBottomZ: number | null = null;
      try {
        const boxes = await model.getBoxes?.([localId]);
        const box = boxes?.[0];
        if (box?.min && box?.max) {
          const r = (n: number): number => Math.round(n * 1000) / 1000;
          const width = box.max.x - box.min.x;   // X — горизонталь
          const depth = box.max.z - box.min.z;   // Z — горизонталь
          const height = box.max.y - box.min.y;  // Y — вертикаль (высота)
          elementBottomZ = box.min.y;            // отметка низа = по вертикали Y
          push("Отметка низа", r(box.min.y));
          push("Отметка верха", r(box.max.y));
          const planLen = Math.max(width, depth);
          const planW = Math.min(width, depth);
          if (planLen > 0) push("Длина (габарит)", r(planLen));
          push("Габариты Д×Ш×В", `${r(planLen)} × ${r(planW)} × ${r(height)}`);
          push("Центр (план X/Z)", `${r((box.min.x + box.max.x) / 2)} / ${r((box.min.z + box.max.z) / 2)}`);
        }
      } catch {
        /* геометрия недоступна — не критично, свойства покажем без отметок */
      }

      // Этаж и ПРОЕКТНАЯ отметка (от ±0.000). Берём из пространственной структуры
      // IFC: к какому IfcBuildingStorey относится элемент, и его атрибут Elevation —
      // это и есть отметка уровня от нуля здания (в отличие от модельной Z выше).
      try {
        const storey = await this.storeyForElement(model, modelId, localId);
        if (storey) {
          if (storey.name) push("Этаж", storey.name);
          if (storey.elevation != null) push("Отметка этажа (от 0.000)", Math.round(storey.elevation * 1000) / 1000);
          // Абсолютная отметка элемента = отметка этажа + превышение над полом этажа.
          if (storey.elevation != null && storey.baseZ != null && elementBottomZ != null) {
            const projectZ = storey.elevation + (elementBottomZ - storey.baseZ);
            push("Отметка элемента (от 0.000)", Math.round(projectZ * 1000) / 1000);
          }
        }
      } catch {
        /* структура недоступна — не критично */
      }

      // Значение свойства/количества: разные IFC-сущности кладут его в разные поля.
      const valueOf = (p: any): unknown =>
        unwrap(p?.NominalValue) ?? unwrap(p?.Value) ?? unwrap(p?.LengthValue) ?? unwrap(p?.AreaValue)
        ?? unwrap(p?.VolumeValue) ?? unwrap(p?.CountValue) ?? unwrap(p?.WeightValue) ?? unwrap(p?.TimeValue);

      // Рекурсивно собираем наборы свойств и количеств (экземпляра и типа).
      // ВАЖНО: граф связей IFC циклический (наборы ссылаются обратно на элемент),
      // поэтому ограничиваем глубину и помним посещённые объекты — иначе stack overflow.
      const collectSeen = new WeakSet<object>();
      const collectSets = (sets: any, prefix: string, depth = 0): void => {
        if (!Array.isArray(sets) || depth > 5) return;
        for (const set of sets) {
          if (set && typeof set === "object") {
            if (collectSeen.has(set)) continue;
            collectSeen.add(set);
          }
          const setName = String(unwrap(set?.Name) ?? "Свойства");
          const list = ([] as any[])
            .concat(Array.isArray(set?.HasProperties) ? set.HasProperties : [])
            .concat(Array.isArray(set?.Quantities) ? set.Quantities : []);
          for (const p of list) {
            const pname = unwrap(p?.Name);
            const pval = valueOf(p);
            if (pname != null && pval != null && pval !== "") push(`${prefix}${setName} · ${pname}`, pval);
          }
          if (Array.isArray(set?.HasPropertySets)) collectSets(set.HasPropertySets, prefix, depth + 1);
        }
      };
      collectSets(item.IsDefinedBy, "");
      if (Array.isArray(item.IsTypedBy)) {
        for (const t of item.IsTypedBy) {
          collectSets(Array.isArray(t?.HasPropertySets) ? t.HasPropertySets : [t], "Тип · ");
        }
      }
      // Материал.
      if (Array.isArray(item.HasAssociations)) {
        for (const a of item.HasAssociations) {
          const mat = unwrap(a?.RelatingMaterial?.Name) ?? unwrap(a?.Name);
          if (mat != null && mat !== "") push("Материал", mat);
        }
      }

      // Если структурных свойств мало — добавляем плоский разбор связей, чтобы
      // не оставлять пользователя с двумя строками (лучше «шумно», чем пусто).
      if (rows.length < 8) {
        for (const [k, v] of flattenIfcData({ IsDefinedBy: item.IsDefinedBy, IsTypedBy: item.IsTypedBy })) {
          push(k.replace(/^IsDefinedBy\.\d+\./, "").replace(/^IsTypedBy\.\d+\./, "Тип · "), v);
          if (rows.length >= 60) break;
        }
      }

      return rows.slice(0, 120);
    } catch (error) {
      return [["properties_error", error instanceof Error ? error.message : String(error)]];
    }
  }
}

function viewerBase(): string {
  const meta = import.meta as unknown as { env?: { BASE_URL?: string } };
  const base = meta.env?.BASE_URL || viewerRuntimeBase();
  return base.endsWith("/") ? base : `${base}/`;
}

function viewerAssetUrl(path: string): string {
  return new URL(path, new URL(viewerBase(), window.location.href)).toString();
}

function viewerRuntimeBase(): string {
  const script = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"], script[type="module"][src*="assets/"]');
  if (!script?.src) return `${window.location.origin}/atlas/`;
  const url = new URL(script.src, window.location.href);
  url.pathname = url.pathname.replace(/assets\/[^/]+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString();
}

// Плоский разбор графа IFC-данных. Граф ЦИКЛИЧЕСКИЙ (связи ссылаются обратно на
// элемент), поэтому обязателен лимит глубины + WeakSet посещённых объектов —
// без них на реальной модели получаем «Maximum call stack size exceeded».
function flattenIfcData(
  value: unknown,
  prefix = "",
  depth = 0,
  seen: WeakSet<object> = new WeakSet(),
): [string, unknown][] {
  if (!value || typeof value !== "object") return [];
  if (depth > 6) return [];
  if (seen.has(value as object)) return [];
  seen.add(value as object);
  const out: [string, unknown][] = [];
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (Array.isArray(item)) {
      for (let index = 0; index < Math.min(item.length, 6); index++) {
        out.push(...flattenIfcData(item[index], `${name}.${index}`, depth + 1, seen));
        if (out.length >= 200) return out;
      }
      continue;
    }
    if (item && typeof item === "object" && "value" in item) {
      out.push([name, (item as { value: unknown }).value]);
      continue;
    }
    if (item && typeof item === "object") {
      out.push(...flattenIfcData(item, name, depth + 1, seen));
      if (out.length >= 200) return out;
    }
  }
  return out;
}
