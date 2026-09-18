import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as BUI from "@thatopen/ui";
import {
  buildStats,
  createDrawables,
  elementLayer,
  graphElements,
  graphRelations,
  relationEndpointId,
} from "./cad-bim-adapter";
import { IfcEngine } from "./ifc-engine";
import type {
  CadBimElement,
  CadBimGraph,
  IfcModelSource,
  IfcRenderResult,
  IfcSelection,
  ViewerModelRecord,
  ViewerStats,
} from "./types";

export interface RenderResult {
  elements: CadBimElement[];
  selected: CadBimElement | null;
  stats: ViewerStats;
  modelId: string;
}

export type ClipAxis = "x" | "y" | "z";
export type ClipDirection = 1 | -1;
export type StandardView = "top" | "front" | "right";
export type ClipBoxTarget = "scene" | "selected";

export type CameraSnapshot = {
  controls?: unknown;
  position?: [number, number, number];
  target?: [number, number, number];
  zoom?: number;
};

// Данные замера для XYZ-панели (как readout в Navisworks): старт, конец, ΔX/ΔY/ΔZ,
// прямое расстояние и фиксированная ось. Любое поле может отсутствовать (одна точка).
export interface MeasureReadout {
  hint: string;
  start?: { x: number; y: number; z: number };
  end?: { x: number; y: number; z: number };
  delta?: { x: number; y: number; z: number };
  distance?: number;
  axisLock?: "x" | "y" | "z" | null;
}

export interface RenderOptions {
  id?: string;
  label?: string;
  source?: string;
  replace?: boolean;
}

interface JsonSceneModel {
  id: string;
  label: string;
  source?: string;
  root: THREE.Group;
  elements: CadBimElement[];
  relations: ReturnType<typeof graphRelations>;
  stats: ViewerStats;
  visible: boolean;
}

export class CadBimViewer {
  readonly components: OBC.Components;

  readonly world: OBC.World;

  private readonly container: HTMLElement;

  private readonly viewport: BUI.Viewport;

  private readonly root = new THREE.Group();

  private readonly ifcRoot = new THREE.Group();

  private readonly layerGroups = new Map<string, Set<THREE.Group>>();

  private readonly jsonModels = new Map<string, JsonSceneModel>();

  private readonly ifcModels = new Map<string, ViewerModelRecord>();

  private readonly measurementRoot = new THREE.Group();

  private clipBoxBase: THREE.Box3 | null = null;

  private clipBoxCurrent: THREE.Box3 | null = null;

  private clipBoxHelper: THREE.Box3Helper | null = null;

  private clipBoxEnabled = false;

  private clipBoxScale = 1;

  private clipBoxTarget: ClipBoxTarget = "scene";

  private walkMode = false;

  private walkYaw = 0;

  private walkPitch = 0;

  private walkFrame = 0;

  private walkLastTime = 0;

  private readonly walkKeys = new Set<string>();

  private readonly raycaster = new THREE.Raycaster();

  private readonly pointer = new THREE.Vector2();

  private selectedObject: THREE.Object3D | null = null;

  private selectedElement: CadBimElement | null = null;

  // Orbit pivot has exactly two valid states: the geometric centre of the
  // whole visible scene or the centre of the currently selected element.
  private selectedOrbitPivot: THREE.Vector3 | null = null;

  private orbitSelectionRevision = 0;

  private selectedMaterial = new THREE.MeshBasicMaterial({ color: 0xfacc15, depthTest: false });

  private lineHighlightMaterial = new THREE.LineBasicMaterial({ color: 0xfacc15, linewidth: 3, depthTest: false });

  private groupHighlightMaterial = new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.72, depthTest: false });

  private groupLineHighlightMaterial = new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.82, depthTest: false });

  private readonly groupHighlightOriginals = new Map<THREE.Object3D, THREE.Material | THREE.Material[]>();

  private readonly clipSettings = new Map<ClipAxis, { enabled: boolean; offset: number; direction: ClipDirection }>([
    ["x", { enabled: false, offset: 0.5, direction: 1 }],
    ["y", { enabled: false, offset: 0.5, direction: 1 }],
    ["z", { enabled: false, offset: 0.5, direction: 1 }],
  ]);

  private readonly ifcEngine: IfcEngine;

  private renderMode: "json" | "ifc" = "json";

  private modelCounter = 0;

  private measureMode = false;

  // Фиксация оси (Lock to Axis, как в Navisworks): при заданной оси вторая точка
  // проецируется на неё от первой — замер идёт строго вдоль X/Y/Z. null = свободно.
  private measureAxisLock: "x" | "y" | "z" | null = null;

  private measurePoints: THREE.Vector3[] = [];

  // Якорь для «зазора между двумя элементами»: габариты первого выбранного.
  private gapAnchor: THREE.Box3 | null = null;

  onSelect: (element: CadBimElement | null) => void = () => {};

  onIfcSelect: (selection: IfcSelection | null) => void = () => {};

  onModelsChange: (models: ViewerModelRecord[]) => void = () => {};

  onMeasure: (message: string) => void = () => {};

  // Структурированные данные замера для постоянной XYZ-панели (M1):
  // координаты старта/конца, раскладка ΔX/ΔY/ΔZ и прямое расстояние.
  onMeasureReadout: (readout: MeasureReadout | null) => void = () => {};

  onNavigationChange: (mode: "orbit" | "walk", captured: boolean) => void = () => {};

  private constructor(container: HTMLElement, viewport: BUI.Viewport, components: OBC.Components, world: OBC.World) {
    this.container = container;
    this.viewport = viewport;
    this.components = components;
    this.world = world;
    this.root.name = "LOCIA ATLAS JSON";
    this.ifcRoot.name = "LOCIA IFC fragments";
    this.measurementRoot.name = "LOCIA ATLAS measurements";
    this.world.scene.three.add(this.root);
    this.world.scene.three.add(this.ifcRoot);
    this.world.scene.three.add(this.measurementRoot);
    this.ifcEngine = new IfcEngine({
      components,
      world,
      root: this.ifcRoot,
      requestRender: () => this.requestRender(),
      onSelect: (selection) => {
        const revision = ++this.orbitSelectionRevision;
        this.onIfcSelect(selection);
        if (!selection) {
          this.selectedOrbitPivot = null;
          this.applyOrbitPivot();
          return;
        }
        void this.ifcEngine.selectedBox().then((box) => {
          if (revision !== this.orbitSelectionRevision || !box || box.isEmpty()) return;
          this.selectedOrbitPivot = box.getCenter(new THREE.Vector3());
          this.applyOrbitPivot();
        });
      },
    });
    this.container.addEventListener("pointerdown", this.onPointerDown);
    this.container.addEventListener("pointerdown", this.enforceOrbitPivotOnPointerDown, true);
    this.viewport.addEventListener("resize", this.resize);
    window.addEventListener("resize", this.resize);
    window.addEventListener("keydown", this.onWalkKeyDown);
    window.addEventListener("keyup", this.onWalkKeyUp);
    document.addEventListener("mousemove", this.onWalkMouseMove);
    document.addEventListener("pointerlockchange", this.onPointerLockChange);
  }

  static async create(container: HTMLElement): Promise<CadBimViewer> {
    BUI.Manager.init();

    const components = new OBC.Components();
    const worlds = components.get(OBC.Worlds);
    const world = worlds.create<OBC.SimpleScene, OBC.OrthoPerspectiveCamera, OBC.SimpleRenderer>();
    world.name = "Просмотр ТИМ";
    // The viewport clear colour and grid follow the document theme (light is the Лоция
    // default; ?theme=dark / <html data-theme="dark"> restores the engine's dark look).
    // This is the one theme surface the HTML/CSS layer cannot reach.
    const darkTheme = document.documentElement.dataset.theme === "dark";
    const sceneBg = darkTheme ? 0x07090c : 0xeef1f6;
    const gridColor = darkTheme ? 0x263748 : 0xc2cad6;
    world.scene = new OBC.SimpleScene(components);
    world.scene.setup();
    world.scene.three.background = new THREE.Color(sceneBg);
    world.scene.three.add(new THREE.AmbientLight(0xffffff, 0.62));
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.35);
    keyLight.position.set(4, 7, 5);
    world.scene.three.add(keyLight);

    const viewport = BUI.Component.create<BUI.Viewport>(() => BUI.html`
      <bim-viewport style="width: 100%; height: 100%; display: block;"></bim-viewport>
    `);
    container.append(viewport);

    world.renderer = new OBC.SimpleRenderer(components, viewport);
    // Product identity is provided by the viewer header.
    (world.renderer as unknown as { showLogo?: boolean }).showLogo = false;
    (world.renderer.three as THREE.WebGLRenderer).localClippingEnabled = true;
    world.camera = new OBC.OrthoPerspectiveCamera(components);
    world.camera.threePersp.near = 0.01;
    world.camera.threePersp.updateProjectionMatrix();
    world.camera.controls.restThreshold = 0.05;
    world.camera.controls.dollySpeed = 0.65;
    world.camera.controls.truckSpeed = 0.65;
    world.camera.controls.azimuthRotateSpeed = 0.35;
    world.camera.controls.polarRotateSpeed = 0.35;

    const grid = components.get(OBC.Grids).create(world);
    grid.material.uniforms.uColor.value = new THREE.Color(gridColor);
    grid.material.uniforms.uSize1.value = 0.1;
    grid.material.uniforms.uSize2.value = 1.0;

    components.init();
    world.scene.setup();
    // SimpleScene.setup() resets the background, so re-apply it after the final setup()
    // call — otherwise it reverts to the engine's dark default.
    world.scene.three.background = new THREE.Color(sceneBg);
    if (new URLSearchParams(window.location.search).has("debug_scene")) {
      world.scene.three.add(
        new THREE.Mesh(
          new THREE.BoxGeometry(1, 1, 1),
          new THREE.MeshBasicMaterial({ color: 0xff0000 }),
        ),
      );
    }
    world.camera.controls.setLookAt(0.5, 0.7, 0.5, 0, 0, 0, false);

    const viewer = new CadBimViewer(container, viewport, components, world);
    viewer.resize();
    return viewer;
  }

  render(payload: CadBimGraph | CadBimElement[] | undefined, highlightIds: Set<string>, options: RenderOptions = {}): RenderResult {
    this.renderMode = "json";
    if (options.replace !== false) {
      this.clearIfcModels();
      this.clear();
    }
    return this.addJsonModel(payload, highlightIds, options);
  }

  addJsonModel(payload: CadBimGraph | CadBimElement[] | undefined, highlightIds: Set<string>, options: RenderOptions = {}): RenderResult {
    this.renderMode = "json";
    const graph = payload && !Array.isArray(payload) ? payload : undefined;
    const modelId = options.id || graph?.id || `json-${++this.modelCounter}`;
    if (this.jsonModels.has(modelId)) this.removeModel(modelId);

    const modelRoot = new THREE.Group();
    modelRoot.name = options.label || graph?.name || modelId;
    modelRoot.userData.modelId = modelId;
    this.root.add(modelRoot);

    const elements = graphElements(payload);
    const relations = graphRelations(payload);
    const drawables = createDrawables(elements, highlightIds);
    const localLayerGroups = new Map<string, THREE.Group>();

    for (const drawable of drawables) {
      const layer = drawable.layer;
      let group = localLayerGroups.get(layer);
      if (!group) {
        group = new THREE.Group();
        group.name = layer;
        group.userData.layer = layer;
        group.userData.modelId = modelId;
        localLayerGroups.set(layer, group);
        this.registerLayerGroup(layer, group);
        modelRoot.add(group);
      }
      drawable.object.userData.modelId = modelId;
      group.add(drawable.object);
    }

    if (drawables.length === 0) {
      this.renderRelationGraph(modelRoot, elements, relations, highlightIds, modelId);
    }

    const stats = buildStats(elements, drawables.length, relations);
    this.jsonModels.set(modelId, {
      id: modelId,
      label: modelRoot.name,
      source: options.source || graph?.source_path,
      root: modelRoot,
      elements,
      relations,
      stats,
      visible: true,
    });
    this.emitModelsChange();
    this.fit();
    this.requestRender();
    return { elements, selected: null, stats: this.aggregateStats(), modelId };
  }

  async renderIfcModels(models: IfcModelSource[], onProgress?: (message: string) => void): Promise<IfcRenderResult> {
    this.renderMode = "ifc";
    this.clear();
    this.ifcModels.clear();
    const result = await this.ifcEngine.loadModels(models, onProgress);
    for (const model of result.models) {
      this.ifcModels.set(model.id, {
        id: model.id,
        label: model.label,
        kind: "ifc",
        source: model.url,
        visible: true,
        elements: 0,
        drawable: 1,
        relations: 0,
      });
    }
    this.emitModelsChange();
    this.fit();
    this.requestRender();
    return result;
  }

  async addIfcModels(models: IfcModelSource[], onProgress?: (message: string) => void): Promise<IfcRenderResult> {
    this.renderMode = "ifc";
    const result = await this.ifcEngine.loadModels(models, onProgress, false);
    for (const model of result.models) {
      this.ifcModels.set(model.id, {
        id: model.id,
        label: model.label,
        kind: "ifc",
        source: model.url,
        visible: true,
        elements: 0,
        drawable: 1,
        relations: 0,
      });
    }
    this.emitModelsChange();
    this.fit();
    this.requestRender();
    return result;
  }

  async highlightIfcGlobalIds(globalIds: string[]): Promise<number> {
    return this.ifcEngine.highlightByGuids(globalIds);
  }

  cameraSnapshot(): CameraSnapshot {
    const camera = this.world.camera.three as THREE.Camera & { zoom?: number; updateProjectionMatrix?: () => void };
    const controls = (this.world.camera as any)?.controls;
    let controlsJson: unknown = null;
    try {
      controlsJson = typeof controls?.toJSON === "function" ? controls.toJSON() : null;
    } catch {
      controlsJson = null;
    }

    const target = new THREE.Vector3();
    try {
      if (typeof controls?.getTarget === "function") {
        controls.getTarget(target);
      }
    } catch {
      target.set(0, 0, 0);
    }

    return {
      ...(controlsJson ? { controls: controlsJson } : {}),
      position: [camera.position.x, camera.position.y, camera.position.z],
      target: [target.x, target.y, target.z],
      zoom: typeof camera.zoom === "number" ? camera.zoom : undefined,
    };
  }

  applyCameraSnapshot(snapshot: CameraSnapshot): void {
    if (!snapshot || typeof snapshot !== "object") return;

    const controls = (this.world.camera as any)?.controls;
    try {
      if (snapshot.controls && typeof controls?.fromJSON === "function") {
        controls.fromJSON(snapshot.controls, false);
      } else if (Array.isArray(snapshot.position) && Array.isArray(snapshot.target) && typeof controls?.setLookAt === "function") {
        controls.setLookAt(
          Number(snapshot.position[0]),
          Number(snapshot.position[1]),
          Number(snapshot.position[2]),
          Number(snapshot.target[0]),
          Number(snapshot.target[1]),
          Number(snapshot.target[2]),
          false,
        );
      }
      if (typeof snapshot.zoom === "number" && Number.isFinite(snapshot.zoom)) {
        const camera = this.world.camera.three as THREE.Camera & { zoom?: number; updateProjectionMatrix?: () => void };
        camera.zoom = snapshot.zoom;
        camera.updateProjectionMatrix?.();
      }
    } catch {
      return;
    }
    this.requestRender();
  }

  setLayerVisible(layer: string, visible: boolean): void {
    const groups = this.layerGroups.get(layer);
    groups?.forEach((group) => {
      group.visible = visible;
    });
    this.requestRender();
  }

  sceneModels(): ViewerModelRecord[] {
    const jsonRecords: ViewerModelRecord[] = [...this.jsonModels.values()].map((model) => ({
        id: model.id,
        label: model.label,
        kind: "json",
        source: model.source,
        visible: model.visible,
        elements: model.stats.elements,
        drawable: model.stats.drawable,
        relations: model.stats.relations,
      }));
    return jsonRecords.concat([...this.ifcModels.values()]);
  }

  setModelVisible(modelId: string, visible: boolean): boolean {
    const json = this.jsonModels.get(modelId);
    if (json) {
      json.visible = visible;
      json.root.visible = visible;
      this.emitModelsChange();
      this.requestRender();
      return true;
    }
    const ifc = this.ifcModels.get(modelId);
    if (ifc) {
      ifc.visible = visible;
      this.ifcEngine.setModelVisible(modelId, visible);
      this.emitModelsChange();
      this.requestRender();
      return true;
    }
    return false;
  }

  isolateModel(modelId: string): boolean {
    if (!this.jsonModels.has(modelId) && !this.ifcModels.has(modelId)) return false;
    for (const model of this.sceneModels()) {
      this.setModelVisible(model.id, model.id === modelId);
    }
    return true;
  }

  removeModel(modelId: string): boolean {
    const json = this.jsonModels.get(modelId);
    if (json) {
      this.unregisterModelLayers(json.root);
      this.disposeObject(json.root);
      this.root.remove(json.root);
      this.jsonModels.delete(modelId);
      this.selectObject(null);
      this.emitModelsChange();
      this.requestRender();
      return true;
    }
    if (this.ifcModels.has(modelId)) {
      this.ifcEngine.removeModel(modelId);
      this.ifcModels.delete(modelId);
      this.emitModelsChange();
      this.requestRender();
      return true;
    }
    return false;
  }

  fitModel(modelId: string): boolean {
    const object = this.modelObject(modelId);
    if (!object) return false;
    this.fitObject(object);
    return true;
  }

  focusElement(id: string): void {
    const object = this.findObjectByElementId(id);
    if (!object) return;
    this.selectObject(object);
    this.fitObject(object);
  }

  setElementVisible(id: string, visible: boolean): boolean {
    const object = this.findObjectByElementId(id);
    if (!object) return false;
    const target = this.drawableRoot(object);
    target.visible = visible;
    this.requestRender();
    return true;
  }

  setElementOpacity(id: string, opacity: number): boolean {
    const object = this.findObjectByElementId(id);
    if (!object) return false;
    const target = this.drawableRoot(object);
    const value = Math.max(0.08, Math.min(1, opacity));
    target.traverse((child) => {
      if (!("material" in child)) return;
      const mesh = child as THREE.Mesh;
      const original = child.userData.originalMaterial as THREE.Material | THREE.Material[] | undefined;
      const groupOriginal = this.groupHighlightOriginals.get(child);
      const source = original || groupOriginal || mesh.material;
      const update = (material: THREE.Material): THREE.Material => {
        const owned = material.userData?.atlasOpacityOwned ? material : material.clone();
        owned.userData = { ...owned.userData, atlasOpacityOwned: true };
        owned.opacity = value;
        owned.transparent = value < 0.999;
        owned.depthWrite = value >= 0.999;
        owned.needsUpdate = true;
        return owned;
      };
      const updated = Array.isArray(source) ? source.map(update) : update(source);
      if (original) child.userData.originalMaterial = updated;
      else if (groupOriginal) this.groupHighlightOriginals.set(child, updated);
      else mesh.material = updated;
    });
    this.requestRender();
    return true;
  }

  highlightElements(ids: string[]): number {
    this.clearGroupHighlight();
    this.selectObject(null);
    const wanted = new Set(ids.map(String).filter(Boolean));
    const roots = new Set<THREE.Object3D>();
    this.root.traverse((child) => {
      if (wanted.has(String(child.userData.elementId || ""))) roots.add(this.drawableRoot(child));
    });
    const box = new THREE.Box3();
    for (const root of roots) {
      box.union(new THREE.Box3().setFromObject(root));
      root.traverse((child) => {
        if (!("material" in child) || this.groupHighlightOriginals.has(child)) return;
        const item = child as THREE.Mesh;
        this.groupHighlightOriginals.set(child, item.material);
        item.material = (child as THREE.Line).isLine || (child as THREE.LineSegments).isLineSegments
          ? this.groupLineHighlightMaterial
          : this.groupHighlightMaterial;
      });
    }
    if (!box.isEmpty()) this.fitBox3(box);
    this.requestRender();
    return roots.size;
  }

  // Инструменты работают НЕЗАВИСИМО от формата данных: в JSON-режиме — через
  // three.js-объекты, в IFC/.frag — через видимость элементов движка фрагментов.
  // boolean возвращаем синхронно (есть ли выбор), сами операции — fire-and-forget.

  focusSelected(): boolean {
    if (this.renderMode === "ifc") {
      if (!this.ifcEngine.hasSelection()) return false;
      void this.ifcEngine.selectedBox().then((box) => {
        if (box) this.fitBox3(box);
      });
      return true;
    }
    const target = this.selectedDrawableRoot();
    if (!target) return false;
    this.fitObject(target);
    return true;
  }

  hideSelected(): boolean {
    if (this.renderMode === "ifc") {
      if (!this.ifcEngine.hasSelection()) return false;
      void this.ifcEngine.hideSelected();
      return true;
    }
    const target = this.selectedDrawableRoot();
    if (!target) return false;
    target.visible = false;
    this.selectObject(null);
    this.requestRender();
    return true;
  }

  isolateSelected(): boolean {
    if (this.renderMode === "ifc") {
      if (!this.ifcEngine.hasSelection()) return false;
      void this.ifcEngine.isolateSelected();
      return true;
    }
    const target = this.selectedDrawableRoot();
    if (!target) return false;
    for (const layerGroups of this.layerGroups.values()) {
      for (const layerGroup of layerGroups) {
        for (const child of layerGroup.children) {
          child.visible = child === target;
        }
        layerGroup.visible = true;
      }
    }
    target.visible = true;
    this.requestRender();
    return true;
  }

  showAll(): void {
    this.root.traverse((child) => {
      child.visible = true;
    });
    this.ifcRoot.traverse((child) => {
      child.visible = true;
    });
    for (const model of this.jsonModels.values()) model.visible = true;
    for (const model of this.ifcModels.values()) model.visible = true;
    // IFC/.frag: вернуть видимость скрытых/изолированных ЭЛЕМЕНТОВ внутри моделей.
    void this.ifcEngine.showAllItems();
    this.emitModelsChange();
    this.requestRender();
  }

  private fitBox3(box: THREE.Box3): void {
    const sphere = new THREE.Sphere();
    box.getBoundingSphere(sphere);
    if (Number.isFinite(sphere.radius) && sphere.radius > 0) {
      const result = (this.world.camera as any)?.controls?.fitToSphere(sphere, true);
      void Promise.resolve(result).finally(() => this.applyOrbitPivot());
      this.requestRender();
    }
  }

  // ---- Прокси к движку фрагментов для слоёв/структуры (используется в main.ts) ----

  ifcCategories(modelId: string): Promise<Map<string, number[]>> {
    return this.ifcEngine.categoriesMap(modelId);
  }

  ifcSetItemsVisible(modelId: string, localIds: number[], visible: boolean): Promise<void> {
    return this.ifcEngine.setItemsVisible(modelId, localIds, visible);
  }

  ifcSetItemsOpacity(modelId: string, localIds: number[], opacity: number): Promise<void> {
    return this.ifcEngine.setItemsOpacity(modelId, localIds, opacity);
  }

  ifcHighlightItems(modelId: string, localIds: number[]): Promise<void> {
    return this.ifcEngine.highlightItems(modelId, localIds);
  }

  ifcSpatialStructure(modelId: string): Promise<any | null> {
    return this.ifcEngine.spatialStructure(modelId);
  }

  ifcNamesFor(modelId: string, localIds: number[]): Promise<Map<number, string>> {
    return this.ifcEngine.namesFor(modelId, localIds);
  }

  ifcSelectByLocalId(modelId: string, localId: number): Promise<void> {
    return this.ifcEngine.selectByLocalId(modelId, localId);
  }

  ifcModelIds(): string[] {
    return [...this.ifcModels.keys()];
  }

  isIfcMode(): boolean {
    return this.renderMode === "ifc";
  }

  // «Обновить»: следующая IFC/.frag-загрузка обходит браузерный HTTP-кеш.
  setIfcFreshFetch(value: boolean): void {
    this.ifcEngine.setFreshFetch(value);
  }

  setMeasureMode(enabled: boolean): void {
    this.measureMode = enabled;
    this.measurePoints = [];
    const hint = enabled ? "Укажи первую точку на геометрии" : "Замер выключен";
    this.onMeasure(hint);
    this.onMeasureReadout(enabled ? { hint, axisLock: this.measureAxisLock } : null);
  }

  // Фиксация оси замера (Lock to Axis). null = свободный замер.
  setMeasureAxisLock(axis: "x" | "y" | "z" | null): void {
    this.measureAxisLock = axis;
    if (this.measureMode) {
      const hint = axis ? `Замер вдоль оси ${axis.toUpperCase()} — укажи точки` : "Свободный замер — укажи точки";
      this.onMeasure(hint);
      this.onMeasureReadout({ hint, axisLock: axis });
    }
  }

  clearMeasurements(): void {
    this.measurePoints = [];
    this.gapAnchor = null;
    for (const child of [...this.measurementRoot.children]) {
      this.disposeObject(child);
      this.measurementRoot.remove(child);
    }
    const hint = this.measureMode ? "Укажи первую точку на геометрии" : "Замеры очищены";
    this.onMeasure(hint);
    this.onMeasureReadout(this.measureMode ? { hint, axisLock: this.measureAxisLock } : null);
    this.requestRender();
  }

  // Габариты текущего выбора независимо от формата (IFC/.frag → движок, JSON → граф).
  private async currentSelectionBox(): Promise<THREE.Box3 | null> {
    if (this.renderMode === "ifc") return this.ifcEngine.selectedBox();
    const target = this.selectedDrawableRoot();
    if (!target) return null;
    const box = new THREE.Box3().setFromObject(target);
    return box.isEmpty() ? null : box;
  }

  // «Зазор между двумя элементами»: первое нажатие фиксирует выбранный элемент,
  // второе — считает кратчайшее расстояние между габаритами (AABB) по осям.
  async measureGapStep(): Promise<string> {
    const box = await this.currentSelectionBox();
    if (!box) return "Сначала выбери элемент";
    if (!this.gapAnchor) {
      this.gapAnchor = box.clone();
      return "Первый элемент зафиксирован — выбери второй и нажми ещё раз";
    }
    const a = this.gapAnchor;
    const b = box;
    const gx = Math.max(0, a.min.x - b.max.x, b.min.x - a.max.x);
    const gy = Math.max(0, a.min.y - b.max.y, b.min.y - a.max.y);
    const gz = Math.max(0, a.min.z - b.max.z, b.min.z - a.max.z);
    const dist = Math.sqrt(gx * gx + gy * gy + gz * gz);
    this.gapAnchor = null;
    const pa = a.clampPoint(b.getCenter(new THREE.Vector3()), new THREE.Vector3());
    const pb = b.clampPoint(a.getCenter(new THREE.Vector3()), new THREE.Vector3());
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([pa, pb]),
      new THREE.LineBasicMaterial({ color: 0x38bdf8, depthTest: false }),
    );
    this.measurementRoot.add(line);
    this.measurementRoot.add(this.createMeasureLabel(`зазор ${dist.toFixed(2)} m`, pa.clone().lerp(pb, 0.5)));
    this.requestRender();
    return `Зазор ${dist.toFixed(2)} м (ΔX ${gx.toFixed(2)} ΔY ${gy.toFixed(2)} ΔZ ${gz.toFixed(2)})`;
  }

  setClipPlane(axis: ClipAxis, enabled: boolean, offset: number, direction: ClipDirection): void {
    this.clipSettings.set(axis, {
      enabled,
      offset: Math.max(0, Math.min(1, offset)),
      direction,
    });
    this.updateClippingPlanes();
    this.requestRender();
  }

  clearClipPlanes(): void {
    for (const [axis, setting] of this.clipSettings) {
      this.clipSettings.set(axis, { ...setting, enabled: false });
    }
    this.updateClippingPlanes();
    this.applyOrbitPivot();
    this.requestRender();
  }

  clipState(): Record<ClipAxis, { enabled: boolean; offset: number; direction: ClipDirection }> {
    return {
      x: { ...(this.clipSettings.get("x") || { enabled: false, offset: 0.5, direction: 1 as ClipDirection }) },
      y: { ...(this.clipSettings.get("y") || { enabled: false, offset: 0.5, direction: 1 as ClipDirection }) },
      z: { ...(this.clipSettings.get("z") || { enabled: false, offset: 0.5, direction: 1 as ClipDirection }) },
    };
  }

  async setClipBox(enabled: boolean, scale = 1, target: ClipBoxTarget = "scene"): Promise<boolean> {
    if (!enabled) {
      this.clearClipBox();
      return true;
    }
    const source = target === "selected" ? await this.currentSelectionBox() : this.sceneBox();
    if (!source || source.isEmpty()) return false;
    const size = source.getSize(new THREE.Vector3());
    const padding = Math.max(0.02, size.length() * 0.015);
    this.clipBoxBase = source.clone().expandByScalar(padding);
    this.clipBoxEnabled = true;
    this.clipBoxTarget = target;
    this.setClipBoxScale(scale);
    return true;
  }

  setClipBoxScale(scale: number): void {
    if (!this.clipBoxBase || !this.clipBoxEnabled) return;
    this.clipBoxScale = Math.max(0.05, Math.min(1, scale));
    const center = this.clipBoxBase.getCenter(new THREE.Vector3());
    const halfSize = this.clipBoxBase.getSize(new THREE.Vector3()).multiplyScalar(this.clipBoxScale * 0.5);
    this.clipBoxCurrent = new THREE.Box3(center.clone().sub(halfSize), center.clone().add(halfSize));
    this.updateClipBoxHelper();
    this.updateClippingPlanes();
    this.requestRender();
  }

  clearClipBox(): void {
    this.clipBoxEnabled = false;
    this.clipBoxBase = null;
    this.clipBoxCurrent = null;
    if (this.clipBoxHelper) {
      this.world.scene.three.remove(this.clipBoxHelper);
      this.clipBoxHelper.geometry.dispose();
      (this.clipBoxHelper.material as THREE.Material).dispose();
      this.clipBoxHelper = null;
    }
    this.updateClippingPlanes();
    this.requestRender();
  }

  clipBoxState(): { enabled: boolean; scale: number; target: ClipBoxTarget } {
    return { enabled: this.clipBoxEnabled, scale: this.clipBoxScale, target: this.clipBoxTarget };
  }

  async setStandardView(view: StandardView, autoClip = true): Promise<void> {
    await this.setWalkMode(false);
    const box = this.sceneBox();
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const distance = Math.max(1, size.length() * 1.8);
    const camera = this.world.camera as OBC.OrthoPerspectiveCamera;
    camera.set("Orbit");
    const positions: Record<StandardView, THREE.Vector3> = {
      top: new THREE.Vector3(center.x, center.y + distance, center.z),
      front: new THREE.Vector3(center.x, center.y, center.z + distance),
      right: new THREE.Vector3(center.x + distance, center.y, center.z),
    };
    const controls = camera.controls as any;
    await controls.setLookAt?.(
      positions[view].x,
      positions[view].y,
      positions[view].z,
      center.x,
      center.y,
      center.z,
      false,
    );
    await camera.projection.set("Orthographic");
    camera.set("Plan");
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    sphere.radius = Math.max(0.25, sphere.radius * 1.08);
    await controls.fitToSphere?.(sphere, true);
    this.applyOrbitPivot();

    if (autoClip) {
      const axis: ClipAxis = view === "top" ? "y" : view === "front" ? "z" : "x";
      const selected = await this.currentSelectionBox();
      const cutPoint = selected?.getCenter(new THREE.Vector3()) || center;
      const min = box.min[axis];
      const max = box.max[axis];
      const fallback = axis === "y" ? 0.6 : 0.5;
      const offset = max > min ? (cutPoint[axis] - min) / (max - min) : fallback;
      this.clearClipPlanes();
      this.setClipPlane(axis, true, Number.isFinite(offset) ? offset : fallback, -1);
    }
    this.requestRender();
  }

  async set3dView(): Promise<void> {
    await this.setWalkMode(false);
    const camera = this.world.camera as OBC.OrthoPerspectiveCamera;
    camera.set("Orbit");
    await camera.projection.set("Perspective");
    this.clearClipPlanes();
    const box = this.sceneBox();
    if (!box.isEmpty()) {
      const center = box.getCenter(new THREE.Vector3());
      const distance = Math.max(1, box.getSize(new THREE.Vector3()).length() * 1.2);
      await (camera.controls as any).setLookAt?.(
        center.x + distance,
        center.y + distance * 0.72,
        center.z + distance,
        center.x,
        center.y,
        center.z,
        false,
      );
    }
    this.fit();
  }

  async setWalkMode(enabled: boolean): Promise<void> {
    if (this.walkMode === enabled) return;
    this.walkMode = enabled;
    const camera = this.world.camera as OBC.OrthoPerspectiveCamera;
    if (enabled) {
      await camera.projection.set("Perspective");
      camera.set("FirstPerson");
      const direction = camera.three.getWorldDirection(new THREE.Vector3());
      this.walkYaw = Math.atan2(direction.x, -direction.z);
      this.walkPitch = Math.asin(THREE.MathUtils.clamp(direction.y, -1, 1));
      this.walkLastTime = performance.now();
      this.walkFrame = requestAnimationFrame(this.walkTick);
    } else {
      this.walkKeys.clear();
      if (this.walkFrame) cancelAnimationFrame(this.walkFrame);
      this.walkFrame = 0;
      if (document.pointerLockElement === this.container) document.exitPointerLock();
      camera.set("Orbit");
    }
    this.onNavigationChange(enabled ? "walk" : "orbit", document.pointerLockElement === this.container);
    this.requestRender();
  }

  isWalkMode(): boolean {
    return this.walkMode;
  }

  fit(): void {
    const box = this.sceneBox();
    if (box.isEmpty()) {
      (this.world.camera as any)?.controls?.setLookAt(0.5, 0.7, 0.5, 0, 0, 0, false);
      return;
    }
    const sphere = new THREE.Sphere();
    box.getBoundingSphere(sphere);
    if (!Number.isFinite(sphere.radius) || sphere.radius <= 0) return;
    sphere.radius = Math.max(0.25, sphere.radius * 1.15);
    const result = (this.world.camera as any)?.controls?.fitToSphere?.(sphere, true);
    void Promise.resolve(result).finally(() => this.applyOrbitPivot());
    this.requestRender();
  }

  dispose(): void {
    void this.setWalkMode(false);
    this.clear();
    this.container.removeEventListener("pointerdown", this.onPointerDown);
    this.container.removeEventListener("pointerdown", this.enforceOrbitPivotOnPointerDown, true);
    this.viewport.removeEventListener("resize", this.resize);
    window.removeEventListener("resize", this.resize);
    window.removeEventListener("keydown", this.onWalkKeyDown);
    window.removeEventListener("keyup", this.onWalkKeyUp);
    document.removeEventListener("mousemove", this.onWalkMouseMove);
    document.removeEventListener("pointerlockchange", this.onPointerLockChange);
    this.clearClipBox();
    this.components.dispose();
  }

  debugState(): unknown {
    const target = this.ifcRoot.children.length ? this.ifcRoot : this.root;
    const box = new THREE.Box3().setFromObject(target);
    return {
      rootChildren: this.root.children.length,
      ifcChildren: this.ifcRoot.children.length,
      rootVisible: this.root.visible,
      layerGroups: [...this.layerGroups.keys()],
      models: this.sceneModels(),
      boxMin: box.min.toArray(),
      boxMax: box.max.toArray(),
      cameraPosition: this.world.camera?.three.position.toArray(),
      cameraQuaternion: this.world.camera?.three.quaternion.toArray(),
      sceneChildren: this.world.scene.three.children.map((child) => ({
        name: child.name,
        type: child.type,
        visible: child.visible,
        children: child.children.length,
      })),
    };
  }

  private clear(): void {
    this.selectedObject = null;
    this.selectedElement = null;
    this.selectedOrbitPivot = null;
    this.orbitSelectionRevision += 1;
    this.clearMeasurements();
    this.clearClipPlanes();
    this.clearClipBox();
    for (const child of [...this.root.children]) {
      this.disposeObject(child);
      this.root.remove(child);
    }
    this.layerGroups.clear();
    this.jsonModels.clear();
    this.emitModelsChange();
  }

  private clearIfcModels(): void {
    this.ifcEngine.clear();
    this.ifcModels.clear();
    this.emitModelsChange();
  }

  private renderRelationGraph(
    parent: THREE.Group,
    elements: CadBimElement[],
    relations: ReturnType<typeof graphRelations>,
    highlightIds: Set<string>,
    modelId: string,
  ): void {
    const visible = elements.slice(0, 220);
    const ids = new Map<string, number>();
    visible.forEach((element, index) => ids.set(String(element.id || index), index));
    const radius = Math.max(160, visible.length * 4);
    const positions = visible.map((element, index) => {
      if (index === 0) return new THREE.Vector3(0, 0, 0);
      const angle = ((index - 1) / Math.max(1, visible.length - 1)) * Math.PI * 2;
      return new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
    });

    const relationMaterial = new THREE.LineBasicMaterial({ color: 0x64748b, transparent: true, opacity: 0.36 });
    const relationPoints: THREE.Vector3[] = [];
    for (const relation of relations.slice(0, 600)) {
      const source = ids.get(relationEndpointId(relation, "source"));
      const target = ids.get(relationEndpointId(relation, "target"));
      if (source == null || target == null) continue;
      relationPoints.push(positions[source], positions[target]);
    }
    if (relationPoints.length) {
      parent.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(relationPoints), relationMaterial));
    }

    for (let index = 0; index < visible.length; index++) {
      const element = visible[index];
      const highlighted = highlightIds.has(String(element.id || ""));
      const color = highlighted ? 0xfacc15 : 0x38bdf8;
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(index === 0 ? 8 : 5, 18, 12),
        new THREE.MeshBasicMaterial({ color, depthTest: false }),
      );
      mesh.position.copy(positions[index]);
      mesh.userData.element = element;
      mesh.userData.elementId = element.id || "";
      mesh.userData.layer = elementLayer(element);
      mesh.userData.modelId = modelId;
      parent.add(mesh);
    }
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (this.walkMode) {
      if (event.button === 0 && document.pointerLockElement !== this.container) {
        void this.container.requestPointerLock();
      }
      return;
    }
    // В IFC-режиме выбор делаем сами рейкастом фрагментов: встроенный клик-выбор
    // движка в этом окружении событий не получал. mouse — КЛИЕНТСКИЕ координаты
    // (event.clientX/Y); model.raycast сам вычитает rect.left/top по dom.
    if (this.renderMode === "ifc") {
      const canvas = (this.world.renderer as unknown as { three?: THREE.WebGLRenderer })?.three?.domElement;
      if (!canvas) return;
      const mouse = new THREE.Vector2(event.clientX, event.clientY);
      if (this.measureMode) {
        // Замер в IFC/.frag: точка — тем же рейкастом фрагментов, что и выбор.
        void this.ifcEngine.raycastPoint(mouse, canvas).then((point) => {
          if (point) {
            this.addMeasurePoint(point);
          } else {
            this.onMeasure("Кликни по видимой геометрии");
          }
        });
      } else {
        void this.ifcEngine.pick(mouse, canvas);
      }
      return;
    }
    const rect = this.container.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
    this.raycaster.setFromCamera(this.pointer, this.world.camera.three);
    const hits = this.raycaster.intersectObjects(this.root.children, true);
    const hit = hits.find((item) => item.object.userData.element);
    if (this.measureMode) {
      if (hit) {
        this.addMeasurePoint(hit.point);
      } else {
        this.onMeasure("Кликни по видимой геометрии");
      }
      return;
    }
    if (!hit) {
      this.selectObject(null);
      return;
    }
    this.selectObject(hit.object);
  };

  private selectObject(object: THREE.Object3D | null): void {
    this.clearGroupHighlight();
    this.restoreSelection();
    this.selectedObject = object;
    const element = object?.userData.element || null;
    this.selectedElement = element;
    this.orbitSelectionRevision += 1;
    if (object) {
      const selectionBox = new THREE.Box3().setFromObject(this.drawableRoot(object));
      this.selectedOrbitPivot = selectionBox.isEmpty() ? null : selectionBox.getCenter(new THREE.Vector3());
    } else {
      this.selectedOrbitPivot = null;
    }
    if (object) {
      object.traverse((child) => {
        const mesh = child as THREE.Mesh;
        const line = child as THREE.Line;
        if ("material" in child) {
          child.userData.originalMaterial = mesh.material;
          if (line.isLine || (child as THREE.LineSegments).isLineSegments) {
            line.material = this.lineHighlightMaterial;
          } else {
            mesh.material = this.selectedMaterial;
          }
        }
      });
    }
    this.onSelect(element);
    this.applyOrbitPivot();
  }

  private restoreSelection(): void {
    if (!this.selectedObject) return;
    this.selectedObject.traverse((child) => {
      if ("material" in child && child.userData.originalMaterial) {
        (child as THREE.Mesh).material = child.userData.originalMaterial;
        delete child.userData.originalMaterial;
      }
    });
  }

  private clearGroupHighlight(): void {
    for (const [child, material] of this.groupHighlightOriginals) {
      if ("material" in child) (child as THREE.Mesh).material = material;
    }
    this.groupHighlightOriginals.clear();
  }

  private findObjectByElementId(id: string): THREE.Object3D | null {
    let found: THREE.Object3D | null = null;
    this.root.traverse((child) => {
      if (!found && String(child.userData.elementId || "") === id) {
        found = child;
      }
    });
    return found;
  }

  private selectedDrawableRoot(): THREE.Object3D | null {
    if (!this.selectedObject) return null;
    return this.drawableRoot(this.selectedObject);
  }

  private drawableRoot(object: THREE.Object3D): THREE.Object3D {
    let node: THREE.Object3D = object;
    while (node.parent && node.parent !== this.root && !this.isLayerGroup(node.parent)) {
      node = node.parent;
    }
    return node;
  }

  private isLayerGroup(object: THREE.Object3D): boolean {
    return [...this.layerGroups.values()].some((groups) => groups.has(object as THREE.Group));
  }

  private registerLayerGroup(layer: string, group: THREE.Group): void {
    const groups = this.layerGroups.get(layer) || new Set<THREE.Group>();
    groups.add(group);
    this.layerGroups.set(layer, groups);
  }

  private unregisterModelLayers(root: THREE.Group): void {
    root.traverse((child) => {
      const layer = String(child.userData.layer || "");
      if (!layer) return;
      const groups = this.layerGroups.get(layer);
      groups?.delete(child as THREE.Group);
      if (groups && groups.size === 0) this.layerGroups.delete(layer);
    });
  }

  private modelObject(modelId: string): THREE.Object3D | null {
    return this.jsonModels.get(modelId)?.root || this.ifcEngine.modelObject(modelId);
  }

  private aggregateStats(): ViewerStats {
    const layers = new Map<string, number>();
    const types = new Map<string, number>();
    let elements = 0;
    let drawable = 0;
    let relations = 0;
    for (const model of this.jsonModels.values()) {
      elements += model.stats.elements;
      drawable += model.stats.drawable;
      relations += model.stats.relations;
      mergeCounts(layers, model.stats.layers);
      mergeCounts(types, model.stats.types);
    }
    return { elements, drawable, relations, layers, types };
  }

  private emitModelsChange(): void {
    this.onModelsChange(this.sceneModels());
  }

  private addMeasurePoint(raw: THREE.Vector3): void {
    // Lock to Axis (M2): вторую точку проецируем на ось от первой — замер строго
    // вдоль X/Y/Z. Для первой точки фиксация не действует.
    let point = raw.clone();
    if (this.measureAxisLock && this.measurePoints.length >= 1) {
      const start = this.measurePoints[this.measurePoints.length - 1];
      point = start.clone();
      point[this.measureAxisLock] = raw[this.measureAxisLock];
    }
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.035, 18, 12),
      new THREE.MeshBasicMaterial({ color: 0xfacc15, depthTest: false }),
    );
    marker.position.copy(point);
    this.measurementRoot.add(marker);
    this.measurePoints.push(point.clone());
    if (this.measurePoints.length === 1) {
      const hint = "Укажи вторую точку";
      this.onMeasure(`Точка  X ${point.x.toFixed(2)}  Y ${point.y.toFixed(2)}  Z ${point.z.toFixed(2)} · укажи вторую`);
      this.onMeasureReadout({
        hint,
        start: { x: point.x, y: point.y, z: point.z },
        axisLock: this.measureAxisLock,
      });
      this.requestRender();
      return;
    }
    const [start, end] = this.measurePoints.slice(-2);
    const distance = start.distanceTo(end);
    const dx = Math.abs(end.x - start.x);
    const dy = Math.abs(end.y - start.y);
    const dz = Math.abs(end.z - start.z);
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([start, end]),
      new THREE.LineBasicMaterial({ color: 0xfacc15, depthTest: false }),
    );
    this.measurementRoot.add(line);
    this.measurementRoot.add(this.createMeasureLabel(`${distance.toFixed(2)} m`, start.clone().lerp(end, 0.5)));
    // Каждая пара кликов — ОТДЕЛЬНЫЙ замер. Раньше точки шли цепочкой (новая первая
    // точка = прошлый конец), и при фиксации оси каждый следующий клик проецировался
    // на ось от старого конца — «всё ложилось на одну ось».
    this.measurePoints = [];
    const hint = this.measureAxisLock ? `Замер вдоль оси ${this.measureAxisLock.toUpperCase()}` : "Замер готов — укажи следующую пару";
    this.onMeasure(`Расстояние ${distance.toFixed(2)} м · Δ ${dx.toFixed(2)}/${dy.toFixed(2)}/${dz.toFixed(2)}`);
    this.onMeasureReadout({
      hint,
      start: { x: start.x, y: start.y, z: start.z },
      end: { x: end.x, y: end.y, z: end.z },
      delta: { x: dx, y: dy, z: dz },
      distance,
      axisLock: this.measureAxisLock,
    });
    this.requestRender();
  }

  private createMeasureLabel(text: string, position: THREE.Vector3): THREE.Sprite {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d")!;
    context.font = "34px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    const width = Math.ceil(context.measureText(text).width + 34);
    canvas.width = Math.max(128, width);
    canvas.height = 58;
    context.font = "34px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    context.fillStyle = "rgba(7, 10, 14, 0.86)";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "#facc15";
    context.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);
    context.fillStyle = "#facc15";
    context.fillText(text, 16, 40);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthTest: false }));
    sprite.position.copy(position);
    sprite.position.y += 0.12;
    sprite.scale.set(canvas.width * 0.002, canvas.height * 0.002, 1);
    return sprite;
  }

  private fitObject(object: THREE.Object3D): void {
    const sphere = new THREE.Sphere();
    new THREE.Box3().setFromObject(object).getBoundingSphere(sphere);
    if (Number.isFinite(sphere.radius) && sphere.radius > 0) {
      const result = (this.world.camera as any)?.controls?.fitToSphere(sphere, true);
      void Promise.resolve(result).finally(() => this.applyOrbitPivot());
      this.requestRender();
    }
  }

  private enforceOrbitPivotOnPointerDown = (): void => {
    if (!this.walkMode) this.applyOrbitPivot();
  };

  private applyOrbitPivot(): void {
    let pivot = this.selectedOrbitPivot?.clone() || null;
    if (!pivot) {
      const scene = this.sceneBox();
      if (scene.isEmpty()) return;
      pivot = scene.getCenter(new THREE.Vector3());
    }
    const controls = (this.world.camera as any)?.controls;
    try {
      if (typeof controls?.setOrbitPoint === "function") {
        controls.setOrbitPoint(pivot.x, pivot.y, pivot.z);
      } else if (typeof controls?.setTarget === "function") {
        controls.setTarget(pivot.x, pivot.y, pivot.z, false);
      }
    } catch {
      /* Camera controls can be disposing while a model is reloaded. */
    }
  }

  private updateClippingPlanes(): void {
    const box = this.sceneBox();
    if (!this.world.renderer?.three) return;
    if (box.isEmpty()) {
      this.world.renderer.three.clippingPlanes = [];
      return;
    }

    const axes: Record<ClipAxis, { normal: THREE.Vector3; min: number; max: number }> = {
      x: { normal: new THREE.Vector3(1, 0, 0), min: box.min.x, max: box.max.x },
      y: { normal: new THREE.Vector3(0, 1, 0), min: box.min.y, max: box.max.y },
      z: { normal: new THREE.Vector3(0, 0, 1), min: box.min.z, max: box.max.z },
    };
    const planes: THREE.Plane[] = [];
    for (const [axis, setting] of this.clipSettings) {
      if (!setting.enabled) continue;
      const range = axes[axis];
      const value = range.min + (range.max - range.min) * setting.offset;
      const normal = range.normal.clone().multiplyScalar(setting.direction);
      planes.push(new THREE.Plane(normal, -value * setting.direction));
    }
    if (this.clipBoxEnabled && this.clipBoxCurrent) {
      const clip = this.clipBoxCurrent;
      planes.push(
        new THREE.Plane(new THREE.Vector3(1, 0, 0), -clip.min.x),
        new THREE.Plane(new THREE.Vector3(-1, 0, 0), clip.max.x),
        new THREE.Plane(new THREE.Vector3(0, 1, 0), -clip.min.y),
        new THREE.Plane(new THREE.Vector3(0, -1, 0), clip.max.y),
        new THREE.Plane(new THREE.Vector3(0, 0, 1), -clip.min.z),
        new THREE.Plane(new THREE.Vector3(0, 0, -1), clip.max.z),
      );
    }
    this.world.renderer.three.clippingPlanes = planes;
    (this.world.renderer.three as THREE.WebGLRenderer).localClippingEnabled = true;
  }

  private resize = (): void => {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.world.renderer?.resize(new THREE.Vector2(width, height));
    (this.world.camera as any)?.updateAspect?.();
    this.requestRender();
  };

  private requestRender(): void {
    if (!this.world.renderer) return;
    (this.world.renderer as any).needsUpdate = true;
    this.world.renderer.update();
  }

  private sceneBox(): THREE.Box3 {
    const box = new THREE.Box3();
    if (this.root.children.length) box.union(new THREE.Box3().setFromObject(this.root));
    if (this.ifcRoot.children.length) box.union(new THREE.Box3().setFromObject(this.ifcRoot));
    return box;
  }

  private updateClipBoxHelper(): void {
    if (!this.clipBoxCurrent) return;
    if (!this.clipBoxHelper) {
      this.clipBoxHelper = new THREE.Box3Helper(this.clipBoxCurrent, 0xfacc15);
      this.clipBoxHelper.name = "ATLAS section box";
      const material = this.clipBoxHelper.material as THREE.LineBasicMaterial;
      material.depthTest = false;
      material.transparent = true;
      material.opacity = 0.92;
      this.clipBoxHelper.renderOrder = 1000;
      this.world.scene.three.add(this.clipBoxHelper);
    } else {
      this.clipBoxHelper.box.copy(this.clipBoxCurrent);
    }
  }

  private onWalkKeyDown = (event: KeyboardEvent): void => {
    if (!this.walkMode || this.isTypingTarget(event.target)) return;
    const key = event.key.toLowerCase();
    if (["w", "a", "s", "d", "q", "e", " ", "shift", "control", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) {
      event.preventDefault();
      this.walkKeys.add(key);
    }
  };

  private onWalkKeyUp = (event: KeyboardEvent): void => {
    this.walkKeys.delete(event.key.toLowerCase());
  };

  private onWalkMouseMove = (event: MouseEvent): void => {
    if (!this.walkMode || document.pointerLockElement !== this.container) return;
    this.walkYaw -= event.movementX * 0.0022;
    this.walkPitch = THREE.MathUtils.clamp(this.walkPitch - event.movementY * 0.0022, -1.52, 1.52);
    this.syncWalkCamera();
  };

  private onPointerLockChange = (): void => {
    if (!this.walkMode) return;
    this.onNavigationChange("walk", document.pointerLockElement === this.container);
  };

  private walkTick = (time: number): void => {
    if (!this.walkMode) return;
    const delta = Math.min(0.05, Math.max(0, (time - this.walkLastTime) / 1000));
    this.walkLastTime = time;
    const position = new THREE.Vector3();
    (this.world.camera.controls as any).getPosition(position);
    const forward = new THREE.Vector3(Math.sin(this.walkYaw), 0, -Math.cos(this.walkYaw)).normalize();
    const right = forward.clone().cross(new THREE.Vector3(0, 1, 0)).normalize();
    const move = new THREE.Vector3();
    if (this.walkKeys.has("w") || this.walkKeys.has("arrowup")) move.add(forward);
    if (this.walkKeys.has("s") || this.walkKeys.has("arrowdown")) move.sub(forward);
    if (this.walkKeys.has("d") || this.walkKeys.has("arrowright")) move.add(right);
    if (this.walkKeys.has("a") || this.walkKeys.has("arrowleft")) move.sub(right);
    if (this.walkKeys.has("e") || this.walkKeys.has(" ")) move.y += 1;
    if (this.walkKeys.has("q") || this.walkKeys.has("control")) move.y -= 1;
    if (move.lengthSq() > 0) {
      const sceneSize = this.sceneBox().getSize(new THREE.Vector3()).length();
      const baseSpeed = THREE.MathUtils.clamp(sceneSize * 0.12, 0.8, 24);
      const boost = this.walkKeys.has("shift") ? 3 : 1;
      position.add(move.normalize().multiplyScalar(baseSpeed * boost * delta));
      this.syncWalkCamera(position);
    }
    this.walkFrame = requestAnimationFrame(this.walkTick);
  };

  private syncWalkCamera(position?: THREE.Vector3): void {
    const controls = this.world.camera.controls as any;
    const cameraPosition = position || controls.getPosition(new THREE.Vector3());
    const direction = new THREE.Vector3(
      Math.sin(this.walkYaw) * Math.cos(this.walkPitch),
      Math.sin(this.walkPitch),
      -Math.cos(this.walkYaw) * Math.cos(this.walkPitch),
    );
    const target = cameraPosition.clone().add(direction);
    void controls.setLookAt(cameraPosition.x, cameraPosition.y, cameraPosition.z, target.x, target.y, target.z, false);
    this.requestRender();
  }

  private isTypingTarget(target: EventTarget | null): boolean {
    return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
  }

  private disposeObject(object: THREE.Object3D): void {
    object.traverse((child) => {
      const maybeMesh = child as THREE.Mesh;
      maybeMesh.geometry?.dispose();
      const material = maybeMesh.material;
      if (Array.isArray(material)) {
        material.forEach((item) => item.dispose());
      } else {
        material?.dispose();
      }
    });
  }
}

function mergeCounts(target: Map<string, number>, source: Map<string, number>): void {
  for (const [key, value] of source) {
    target.set(key, (target.get(key) || 0) + value);
  }
}
