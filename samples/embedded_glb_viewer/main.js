// ---------------------------------------------
// samples/embedded_glb_viewer/main.js  2026/07/25
//   embedded_glb_viewer sample
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import WebgApp from "../../webg/WebgApp.js";
import SmoothShader from "../../webg/SmoothShader.js";
import Shape from "../../webg/Shape.js";
import Primitive from "../../webg/Primitive.js";
import Diagnostics from "../../webg/Diagnostics.js";
import { buildErrorPanelOptions, buildHelpPanelOptions } from "../../webg/OverlayPanelPresets.js";
import CommandPalette, {
  getDefaultCommandPaletteCss
} from "../../webg/CommandPalette.js";

const BUNDLED_SAMPLE = new URL("../gltf_loader/hand.glb", import.meta.url).href;
const DEFAULT_ORBIT = {
  yaw: 28.0,
  pitch: -14.0,
  distance: 18.0,
  target: [0.0, 0.0, 0.0]
};
const PLACEHOLDER_SIZE = {
  minx: -2.4,
  maxx: 2.4,
  miny: -1.4,
  maxy: 3.0,
  minz: -2.4,
  maxz: 2.4,
  centerx: 0.0,
  centery: 0.8,
  centerz: 0.0,
  sizex: 4.8,
  sizey: 4.4,
  sizez: 4.8,
  max: 4.8
};
const ORBIT_BUTTON_STEP = {
  yaw: 7.5,
  pitch: 6.0,
  zoomMultiplier: 1.15
};
const TOUCH_GROUPS = [
  {
    id: "orbit-h",
    buttons: [
      { key: "orbit-left", label: "\u2190", kind: "action", ariaLabel: "orbit left" },
      { key: "orbit-right", label: "\u2192", kind: "action", ariaLabel: "orbit right" }
    ]
  },
  {
    id: "orbit-v",
    buttons: [
      { key: "orbit-up", label: "\u2191", kind: "action", ariaLabel: "orbit up" },
      { key: "orbit-down", label: "\u2193", kind: "action", ariaLabel: "orbit down" }
    ]
  },
  {
    id: "zoom",
    buttons: [
      { key: "orbit-zoom-in", label: "+", kind: "action", ariaLabel: "zoom in" },
      { key: "orbit-zoom-out", label: "-", kind: "action", ariaLabel: "zoom out" }
    ]
  },
  {
    id: "actions",
    buttons: [
      { key: "reset-view", label: "R", kind: "action", ariaLabel: "reset camera" },
      { key: "toggle-pause", label: "||", kind: "action", ariaLabel: "toggle animation pause" },
      { key: "toggle-wireframe", label: "W", kind: "action", ariaLabel: "toggle wireframe" },
      { key: "capture-shot", label: "S", kind: "action", ariaLabel: "save screenshot" }
    ]
  }
];

const ui = {
  fileInput: null,
  loadSampleButton: null,
  resetButton: null,
  clearButton: null,
  screenshotButton: null,
  wireframeButton: null,
  headline: null,
  status: null
};

let app = null;
let orbit = null;
let placeholderRoot = null;
let placeholderSpinNode = null;
let detachArrowKeyBridge = null;
let palette = null;
let lastHelpText = "";

const state = {
  activeModelRoot: null,
  runtime: null,
  instantiated: null,
  fileLabel: "(none)",
  sourceLabel: "placeholder",
  loadStage: "ready",
  loading: false,
  lastError: "",
  loadStartedAtMs: 0,
  loadElapsedMs: 0,
  triangleCount: 0,
  nodeCount: 0,
  clipCount: 0,
  paused: false,
  hasActiveModel: false,
  screenshotName: "",
  modelSize: { ...PLACEHOLDER_SIZE },
  wireframe: false,
  animationRunning: false,
  animationLoopCount: 0,
  orbitChangedThisFrame: false,
  eyeChangedThisFrame: false,
  lastCtxDeltaSec: Number.NaN,
  previousOrbitYaw: DEFAULT_ORBIT.yaw,
  previousOrbitPitch: DEFAULT_ORBIT.pitch,
  previousTarget: [...DEFAULT_ORBIT.target],
  previousEyeAttitude: [DEFAULT_ORBIT.yaw, DEFAULT_ORBIT.pitch, 0.0]
};

document.addEventListener("DOMContentLoaded", () => {
  start().catch((err) => {
    console.error("embedded_glb_viewer failed:", err);
  });
});

// `cacheUi`は必要な画面要素を準備し、表示状態を更新する
function cacheUi() {
  ui.fileInput = document.getElementById("glbFile");
  ui.loadSampleButton = document.getElementById("loadBundledSample");
  ui.resetButton = document.getElementById("resetView");
  ui.clearButton = document.getElementById("clearModel");
  ui.screenshotButton = document.getElementById("saveShot");
  ui.wireframeButton = document.getElementById("toggleWireframe");
  ui.headline = document.getElementById("viewerHeadline");
  ui.status = document.getElementById("status");
}

// `focusViewerCanvas`は必要な画面要素を準備し、表示状態を更新する
function focusViewerCanvas() {
  const canvas = app?.screen?.canvas ?? null;
  if (!canvas) {
    return;
  }
  // embedded viewer は file input や DOM button が多く、
  // それらへ focus が移ると Arrow / Shift の継続入力が不安定に見えやすい
  // canvas 自体を focus 可能にして、viewer 操作のたびに戻せるようにする
  if (canvas.tabIndex < 0 || !Number.isFinite(canvas.tabIndex)) {
    canvas.tabIndex = 0;
  }
  if (typeof canvas.focus === "function") {
    canvas.focus({
      preventScroll: true
    });
  }
}

// `viewer`の`arrow`のキーを検証し、後続処理が扱える共通形式へ整える
function normalizeViewerArrowKey(ev) {
  const normalizedKey = app?.input?.normalizeKey(ev?.key ?? "") ?? "";
  const normalizedCode = String(ev?.code ?? "").toLowerCase();
  if (normalizedKey === "shift" || normalizedCode === "shiftleft" || normalizedCode === "shiftright") {
    return "shift";
  }
  if (normalizedKey === "arrowleft" || normalizedKey === "left" || normalizedCode === "arrowleft") {
    return "arrowleft";
  }
  if (normalizedKey === "arrowright" || normalizedKey === "right" || normalizedCode === "arrowright") {
    return "arrowright";
  }
  if (normalizedKey === "arrowup" || normalizedKey === "up" || normalizedCode === "arrowup") {
    return "arrowup";
  }
  if (normalizedKey === "arrowdown" || normalizedKey === "down" || normalizedCode === "arrowdown") {
    return "arrowdown";
  }
  return normalizedKey;
}

// `arrow`のキーの`bridge`の初期化段階で、必要な状態と資源を準備して処理を開始する
function installArrowKeyBridge() {
  if (typeof window === "undefined" || !app?.input) {
    return () => {};
  }
  const bridgedKeys = new Set([
    "arrowleft",
    "arrowright",
    "arrowup",
    "arrowdown",
    "shift"
  ]);
  // キーの`down`を受け取った段階で、対応する状態更新と処理を実行する
  const onKeyDown = (ev) => {
    const key = normalizeViewerArrowKey(ev);
    if (!bridgedKeys.has(key)) {
      return;
    }
    // embedded viewer は本文や DOM button を含むため、
    // Arrow 系だけ browser 側の focus 移動や page scroll の扱いへ流れやすい
    // capture 段階で InputController へ直接反映して、EyeRig 標準 keyboard 操作を確実に通す
    ev.preventDefault();
    app.input.press(key);
  };
  // キーの`up`を受け取った段階で、対応する状態更新と処理を実行する
  const onKeyUp = (ev) => {
    const key = normalizeViewerArrowKey(ev);
    if (!bridgedKeys.has(key)) {
      return;
    }
    ev.preventDefault();
    app.input.release(key);
  };
  // `blur`を受け取った段階で、対応する状態更新と処理を実行する
  const onBlur = () => {
    for (const key of bridgedKeys) {
      app.input.release(key);
    }
  };
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("keyup", onKeyUp, true);
  window.addEventListener("blur", onBlur);
  return () => {
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("keyup", onKeyUp, true);
    window.removeEventListener("blur", onBlur);
  };
}

// 材質の形状を生成し、後続処理で利用できる状態にする
function createMaterialShape(gpu, primitiveAsset, params) {
  const shape = new Shape(gpu);
  shape.applyPrimitiveAsset(primitiveAsset);
  shape.endShape();
  shape.setMaterial("smooth-shader", params);
  return shape;
}

// `placeholder`の`primitive`を対象へ追加し、後続処理から参照できるようにする
function addPlaceholderPrimitive(parentNode, nodeName, primitiveAsset, materialParams, position) {
  const node = app.space.addNode(parentNode, nodeName);
  const shape = createMaterialShape(
    app.getGPU(),
    primitiveAsset,
    materialParams
  );
  node.addShape(shape);
  node.setPosition(position[0], position[1], position[2]);
  return node;
}

// デバッグの`number`を現在の入力と状態から求め、呼び出し元へ返す
function formatDebugNumber(value, digits = 6) {
  if (Number.isFinite(value)) {
    return Number(value).toFixed(digits);
  }
  return String(value);
}

// `placeholder`のシーンを生成し、後続処理で利用できる状態にする
function createPlaceholderScene() {
  placeholderRoot = app.space.addNode(null, "uploadPlaceholderRoot");
  placeholderRoot.setPosition(0.0, -PLACEHOLDER_SIZE.centery, 0.0);
  // 読み込み前でも viewer の陰影と orbit 操作が分かるように、
  // pedestal の上へ立方体と球を置いた簡単な見本 scene を常設する
  addPlaceholderPrimitive(
    placeholderRoot,
    "uploadPedestal",
    Primitive.cube(3.2),
    {
      has_bone: 0,
      use_texture: 0,
      color: [0.28, 0.42, 0.56, 1.0],
      ambient: 0.35,
      specular: 0.45,
      power: 24.0
    },
    [0.0, -1.0, 0.0]
  );

  placeholderSpinNode = app.space.addNode(placeholderRoot, "uploadPlaceholderSpin");
  addPlaceholderPrimitive(
    placeholderSpinNode,
    "uploadCube",
    Primitive.cube(1.8),
    {
      has_bone: 0,
      use_texture: 0,
      color: [0.88, 0.70, 0.34, 1.0],
      ambient: 0.28,
      specular: 0.86,
      power: 54.0
    },
    [0.0, 0.8, 0.0]
  );

  addPlaceholderPrimitive(
    placeholderSpinNode,
    "uploadSphere",
    Primitive.sphere(0.85, 16, 24),
    {
      has_bone: 0,
      use_texture: 0,
      color: [0.30, 0.78, 0.98, 1.0],
      ambient: 0.24,
      specular: 0.92,
      power: 62.0,
      emissive: 0.06
    },
    [0.0, 2.2, 0.0]
  );
}

// ノードの`tree`の`hidden`を受け取り、現在の設定と後続処理へ反映する
function setNodeTreeHidden(node, hidden) {
  if (!node) return;
  if (typeof node.hide === "function") {
    node.hide(hidden);
  }
  const children = Array.isArray(node.children) ? node.children : [];
  for (let i = 0; i < children.length; i++) {
    setNodeTreeHidden(children[i], hidden);
  }
}

// `placeholder`の`visible`を受け取り、現在の設定と後続処理へ反映する
function setPlaceholderVisible(visible) {
  if (!placeholderRoot) return;
  setNodeTreeHidden(placeholderRoot, !visible);
}

// `placeholder`の`shapes`を現在の入力と状態から求め、呼び出し元へ返す
function collectPlaceholderShapes() {
  const shapes = [];
  // `walk`は受け取った値を処理し、後続処理で利用する状態または結果を生成する
  const walk = (node) => {
    if (!node) return;
    if (Array.isArray(node.shapes)) {
      for (let i = 0; i < node.shapes.length; i++) {
        if (node.shapes[i]) shapes.push(node.shapes[i]);
      }
    }
    const children = Array.isArray(node.children) ? node.children : [];
    for (let i = 0; i < children.length; i++) {
      walk(children[i]);
    }
  };
  walk(placeholderRoot);
  return shapes;
}

// `viewer`の`shapes`を現在の入力と状態から求め、呼び出し元へ返す
function getViewerShapes() {
  if (state.hasActiveModel && Array.isArray(state.instantiated?.shapes)) {
    return state.instantiated.shapes;
  }
  return collectPlaceholderShapes();
}

// ワイヤーフレームの状態を対象の状態または描画設定へ反映する
function applyWireframeState() {
  const shapes = getViewerShapes();
  for (let i = 0; i < shapes.length; i++) {
    shapes[i]?.setWireframe?.(state.wireframe);
  }
}

// 周回視点を初期状態へ戻し、前回の状態を残さない
function resetOrbit(size = state.modelSize, options = {}) {
  const maxSize = Math.max(2.4, Number(size?.max) || PLACEHOLDER_SIZE.max);
  const target = Array.isArray(options.target) && options.target.length >= 3
    ? options.target
    : DEFAULT_ORBIT.target;
  orbit.orbit.minDistance = Math.max(2.5, maxSize * 0.35);
  orbit.orbit.maxDistance = Math.max(18.0, maxSize * 9.0);
  orbit.orbit.wheelZoomStep = Math.max(0.35, maxSize * 0.06);
  orbit.setTarget(target[0], target[1], target[2]);
  orbit.setAngles(DEFAULT_ORBIT.yaw, DEFAULT_ORBIT.pitch);
  orbit.setDistance(Math.max(7.0, maxSize * 2.2));
  syncOrbitStateToAppCamera();
}

// 周回視点の状態をアプリケーションのカメラへ同期する
function syncOrbitStateToAppCamera() {
  if (!app?.camera || !orbit?.orbit) {
    return;
  }
  app.camera.target[0] = orbit.orbit.target[0];
  app.camera.target[1] = orbit.orbit.target[1];
  app.camera.target[2] = orbit.orbit.target[2];
  app.camera.distance = orbit.orbit.distance;
  app.camera.yaw = orbit.orbit.yaw;
  app.camera.pitch = orbit.orbit.pitch;
}

// `stepOrbitByButtons`は受け取った値を処理し、後続処理で利用する状態または結果を生成する
function stepOrbitByButtons({ yaw = 0.0, pitch = 0.0, zoom = 1.0 } = {}) {
  if (!orbit?.orbit) {
    return;
  }
  const nextPitch = orbit.clamp(
    orbit.orbit.pitch + pitch,
    orbit.orbit.pitchMin,
    orbit.orbit.pitchMax
  );
  const nextDistance = orbit.clamp(
    orbit.orbit.distance * zoom,
    orbit.orbit.minDistance,
    orbit.orbit.maxDistance
  );
  orbit.setAngles(orbit.orbit.yaw + yaw, nextPitch);
  orbit.setDistance(nextDistance);
  syncOrbitStateToAppCamera();
}

// `load`のパネルを現在の入力と実行状態に合わせて更新する
function updateLoadPanel() {
  const lines = [
    "embedded_glb_viewer",
    `stage=${state.loadStage}`,
    `file=${state.fileLabel}`,
    `elapsedMs=${Math.round(state.loadElapsedMs)}`
  ];
  if (state.loading) {
    app.showOverlayPanel({
      id: "embeddedViewerLoad",
      title: "Load Progress",
      text: lines.join("\n"),
      anchor: "top-left",
      offsetX: 14,
      offsetY: 14,
      format: "pre",
      scrollY: false,
      maxHeight: "none",
      color: "#fff2d7",
      background: "rgba(22, 32, 26, 0.92)"
    });
  } else {
    app.removeOverlayPanel("embeddedViewerLoad");
  }
}

// `load`のステージを受け取り、現在の設定と後続処理へ反映する
function setLoadStage(stage) {
  state.loadStage = String(stage ?? "");
  state.loadElapsedMs = Math.max(0, performance.now() - state.loadStartedAtMs);
  app.setDiagnosticsStage(stage);
  app.mergeDiagnosticsStats({
    loadStage: state.loadStage,
    loadElapsedMs: Math.round(state.loadElapsedMs),
    file: state.fileLabel
  });
  updateLoadPanel();
}

// `screenshot`の名前を生成し、後続処理で利用できる状態にする
function makeScreenshotName() {
  const base = state.fileLabel && state.fileLabel !== "(none)"
    ? state.fileLabel.replace(/\.[^.]+$/, "")
    : "embedded_glb_viewer";
  return base
    .replace(/[^a-z0-9_-]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    || "embedded_glb_viewer";
}

// `takeViewerScreenshot`は現在のキャンバス画像を取得し、指定形式で保存する
function takeViewerScreenshot() {
  const file = app.takeScreenshot({
    prefix: `${makeScreenshotName()}_view`
  });
  state.screenshotName = file;
  focusViewerCanvas();
  app.pushToast(`saved ${file}`, {
    durationMs: 1400
  });
}

// エラーの状態を初期状態へ戻し、前回の状態を残さない
function clearErrorState() {
  state.lastError = "";
  app.removeOverlayPanel("embeddedViewerError");
}

// `showErrorState`は必要な画面要素を準備し、表示状態を更新する
function showErrorState(err) {
  const report = Diagnostics.createErrorReport(err, {
    system: "embedded-glb-viewer",
    source: "samples/embedded_glb_viewer/main.js",
    stage: state.loadStage
  });
  state.lastError = err?.message ?? String(err);
  app.setDiagnosticsReport(report);
  app.showOverlayPanel(buildErrorPanelOptions(err, {
    id: "embeddedViewerError",
    title: "glb load failed",
    background: "rgba(42, 18, 22, 0.94)"
  }));
}

// 読み込んだモデルを現在の表示対象として設定する
function setCurrentModel(rootNode, runtime, instantiated, size) {
  disposeCurrentModel();
  state.activeModelRoot = rootNode;
  state.runtime = runtime;
  state.instantiated = instantiated;
  state.modelSize = { ...size };
  state.hasActiveModel = true;
  state.paused = false;
  state.animationRunning = false;
  state.animationLoopCount = 0;
  setPlaceholderVisible(false);
}

// 現在のモデルが保持する実体と資源を安全に解放する
function disposeCurrentModel() {
  if (state.instantiated) {
    state.instantiated.setAnimationsPaused?.(true);
    state.instantiated.destroy?.();
  }
  if (state.activeModelRoot && app?.space?.removeNodeTree) {
    app.space.removeNodeTree(state.activeModelRoot, {
      destroyShapes: true
    });
  }
  if (state.runtime) {
    state.runtime.destroy?.();
  }
  state.activeModelRoot = null;
  state.runtime = null;
  state.instantiated = null;
  state.hasActiveModel = false;
  state.paused = false;
}

// 現在のモデルを表示から外して初期状態へ戻す
function clearCurrentModel(options = {}) {
  disposeCurrentModel();
  state.fileLabel = "(none)";
  state.sourceLabel = "placeholder";
  state.triangleCount = 0;
  state.nodeCount = 0;
  state.clipCount = 0;
  state.modelSize = { ...PLACEHOLDER_SIZE };
  clearErrorState();
  setPlaceholderVisible(true);
  applyWireframeState();
  resetOrbit(PLACEHOLDER_SIZE);
  if (options.toast === true) {
    app.pushToast("model cleared", {
      durationMs: 1100
    });
  }
}

// 複製したルートノードを対象へ追加し、後続処理から参照できるようにする
function attachInstantiatedRoots(runtime, instantiated, mountNode) {
  const roots = runtime.nodes.filter((nodeInfo) => nodeInfo.parent === null);
  for (let i = 0; i < roots.length; i++) {
    const createdNode = instantiated.nodeMap.get(roots[i].id);
    if (createdNode) {
      createdNode.attach(mountNode);
    }
  }
}

// `triangle`の`count`を入力値から計算し、後続処理で使える結果を返す
function computeTriangleCount(shapes) {
  let total = 0;
  for (let i = 0; i < shapes.length; i++) {
    total += Number(shapes[i]?.getTriangleCount?.() ?? 0);
  }
  return total;
}

// `viewer`のサイズを入力値から計算し、後続処理で使える結果を返す
function computeViewerSize(shapes) {
  const size = app.getShapeSize(shapes);
  if (!Number.isFinite(size.max) || size.max <= 0.0) {
    return { ...PLACEHOLDER_SIZE };
  }
  return size;
}

// `placeModelRoot`は現在の進行状態に必要な要素を生成または配置する
function placeModelRoot(rootNode, size) {
  rootNode.setPosition(
    -Number(size.centerx ?? 0.0),
    -Number(size.centery ?? 0.0),
    -Number(size.centerz ?? 0.0)
  );
}

// アニメーションの`pause`の有効状態を切り替え、表示と処理へ反映する
function toggleAnimationPause() {
  if (!state.runtime || state.clipCount <= 0) {
    app.pushToast("no animation clip", {
      durationMs: 900
    });
    return;
  }
  state.paused = !state.paused;
  state.runtime.setAnimationsPaused?.(state.paused);
  focusViewerCanvas();
  app.pushToast(state.paused ? "animation paused" : "animation resumed", {
    durationMs: 900
  });
}

// `viewer`の`animations`を現在の入力と状態から求め、呼び出し元へ返す
function getViewerAnimations() {
  const animationMap = state.instantiated?.animationMap;
  if (!(animationMap instanceof Map)) {
    if (state.clipCount > 0) {
      throw new Error("embedded_glb_viewer requires instantiated animationMap when clips are present");
    }
    return [];
  }
  return [...animationMap.values()];
}

// `advanceViewerAnimations`はゲームまたは計測の進行段階を次の状態へ更新する
function advanceViewerAnimations() {
  if (!state.runtime || state.clipCount <= 0 || state.paused) {
    state.animationRunning = false;
    return;
  }

  const animations = getViewerAnimations();
  if (animations.length === 0) {
    throw new Error("embedded_glb_viewer clipCount is non-zero but no runtime animations were instantiated");
  }

  // startAllAnimations() は各 clip の schedule を先頭へ戻すだけなので、
  // 実際の時間進行は毎 frame playAllAnimations() で明示的に進める
  // すべての schedule が終端に到達した場合は、viewer 用に先頭から再開し、
  // human2.glb のように末尾が初期姿勢へ戻る clip でも継続して動きを確認できるようにする
  state.runtime.playAllAnimations();
  state.animationRunning = animations.some((animation) => animation?.schedule && !animation.schedule.stopped);
  if (!state.animationRunning) {
    state.runtime.startAllAnimations();
    state.animationLoopCount++;
    state.animationRunning = true;
  }
}

// ワイヤーフレームの有効状態を切り替え、表示と処理へ反映する
function toggleWireframe() {
  state.wireframe = !state.wireframe;
  applyWireframeState();
  focusViewerCanvas();
  app.pushToast(state.wireframe ? "wireframe on" : "wireframe off", {
    durationMs: 900
  });
}

// `pressed`の`actions`を受け取った段階で、対応する状態更新と処理を実行する
function handlePressedActions() {
  if (app.input.wasActionPressed("orbit-left")) {
    stepOrbitByButtons({
      yaw: -ORBIT_BUTTON_STEP.yaw
    });
  }
  if (app.input.wasActionPressed("orbit-right")) {
    stepOrbitByButtons({
      yaw: ORBIT_BUTTON_STEP.yaw
    });
  }
  if (app.input.wasActionPressed("orbit-up")) {
    stepOrbitByButtons({
      pitch: ORBIT_BUTTON_STEP.pitch
    });
  }
  if (app.input.wasActionPressed("orbit-down")) {
    stepOrbitByButtons({
      pitch: -ORBIT_BUTTON_STEP.pitch
    });
  }
  if (app.input.wasActionPressed("orbit-zoom-in")) {
    stepOrbitByButtons({
      zoom: 1.0 / ORBIT_BUTTON_STEP.zoomMultiplier
    });
  }
  if (app.input.wasActionPressed("orbit-zoom-out")) {
    stepOrbitByButtons({
      zoom: ORBIT_BUTTON_STEP.zoomMultiplier
    });
  }
  if (app.input.wasActionPressed("reset-view")) {
    resetOrbit(state.modelSize);
    app.pushToast("camera reset", {
      durationMs: 900
    });
  }
  if (app.input.wasActionPressed("toggle-pause")) {
    toggleAnimationPause();
  }
  if (app.input.wasActionPressed("capture-shot")) {
    takeViewerScreenshot();
  }
  if (app.input.wasActionPressed("toggle-wireframe")) {
    toggleWireframe();
  }
}

// 指定したデータ源からモデルを読み込む
async function loadModelFromSource(source, {
  fileLabel,
  sourceLabel
} = {}) {
  const previousLabels = {
    fileLabel: state.fileLabel,
    sourceLabel: state.sourceLabel
  };
  clearErrorState();
  state.loading = true;
  state.fileLabel = fileLabel ?? "(unknown)";
  state.sourceLabel = sourceLabel ?? state.fileLabel;
  state.loadStartedAtMs = performance.now();
  setLoadStage("fetch");
  let mountNode = null;
  let modelResult = null;
  let instantiated = null;

  try {
    modelResult = await app.loadModel(source, {
      format: "gltf",
      instantiate: false,
      startAnimations: false,
      onStage: (stage) => {
        setLoadStage(stage);
      }
    });

    mountNode = app.space.addNode(null, `viewerModelRoot_${Date.now()}`);
    instantiated = modelResult.instantiate(app.space, {
      bindAnimations: true
    });
    attachInstantiatedRoots(modelResult.runtime, instantiated, mountNode);

    const size = computeViewerSize(instantiated.shapes);
    placeModelRoot(mountNode, size);
    setCurrentModel(mountNode, modelResult.runtime, instantiated, size);

    state.triangleCount = computeTriangleCount(instantiated.shapes);
    state.nodeCount = modelResult.runtime.nodes.length;
    state.clipCount = modelResult.getClipNames().length;
    applyWireframeState();
    resetOrbit(size);

    modelResult.runtime.startAllAnimations?.();
    setLoadStage("ready");
    app.pushToast(`loaded ${state.fileLabel}`, {
      durationMs: 1400
    });
  } catch (err) {
    instantiated?.destroy?.();
    if (mountNode && app?.space?.removeNodeTree) {
      app.space.removeNodeTree(mountNode, {
        destroyShapes: true
      });
    }
    modelResult?.runtime?.destroy?.();
    if (state.hasActiveModel) {
      state.fileLabel = previousLabels.fileLabel;
      state.sourceLabel = previousLabels.sourceLabel;
    }
    setLoadStage("error");
    showErrorState(err);
  } finally {
    state.loading = false;
    updateLoadPanel();
    if (ui.fileInput) {
      ui.fileInput.value = "";
    }
  }
}

// `bundled`の`sample`を読み込み、検証済みのデータとして後続処理へ渡す
async function loadBundledSample() {
  await loadModelFromSource(BUNDLED_SAMPLE, {
    fileLabel: "hand.glb",
    sourceLabel: "bundled sample"
  });
}

// ファイルの選択状態を受け取った段階で、対応する状態更新と処理を実行する
async function handleFileSelection(file) {
  if (!file) {
    return;
  }
  const name = String(file.name ?? "");
  if (!name.toLowerCase().endsWith(".glb")) {
    showErrorState(new Error(`Only .glb files are supported: ${name || "(unknown file)"}`));
    return;
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    await loadModelFromSource(objectUrl, {
      fileLabel: name,
      sourceLabel: "local upload"
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

// `dom`の`handlers`の初期化段階で、必要な状態と資源を準備して処理を開始する
function installDomHandlers() {
  ui.fileInput?.addEventListener("change", (event) => {
    const file = event.target.files?.[0] ?? null;
    focusViewerCanvas();
    handleFileSelection(file).catch((err) => {
      showErrorState(err);
    });
  });
  ui.loadSampleButton?.addEventListener("click", () => {
    focusViewerCanvas();
    loadBundledSample().catch((err) => {
      showErrorState(err);
    });
  });
  ui.resetButton?.addEventListener("click", () => {
    resetOrbit(state.modelSize);
    focusViewerCanvas();
    app.pushToast("camera reset", {
      durationMs: 900
    });
  });
  ui.clearButton?.addEventListener("click", () => {
    clearCurrentModel({
      toast: true
    });
    focusViewerCanvas();
  });
  ui.screenshotButton?.addEventListener("click", () => {
    takeViewerScreenshot();
  });
  ui.wireframeButton?.addEventListener("click", () => {
    toggleWireframe();
  });
}

// `viewer`のヘルプの行を生成し、後続処理で利用できる状態にする
function buildViewerHelpLines() {
  return [
    "embedded_glb_viewer",
    "CommandPalette: double tap canvas or press /",
    "Drag/Arrow: orbit  Shift+Drag/Arrow or two-finger drag: pan  wheel/pinch: zoom",
    "Use the page controls to select a GLB file or load the bundled sample",
    "",
    `File: ${state.fileLabel}  source=${state.sourceLabel}`,
    `Stage: ${state.loading ? state.loadStage : "idle"}  elapsed=${Math.round(state.loadElapsedMs)}ms`,
    `Model: ${state.hasActiveModel ? "loaded" : "placeholder"}  tris=${state.triangleCount} nodes=${state.nodeCount} clips=${state.clipCount}`,
    `Orbit: yaw=${orbit.orbit.yaw.toFixed(1)} pitch=${orbit.orbit.pitch.toFixed(1)} dist=${orbit.orbit.distance.toFixed(1)}`,
    `Target: ${orbit.orbit.target[0].toFixed(2)}, ${orbit.orbit.target[1].toFixed(2)}, ${orbit.orbit.target[2].toFixed(2)}`,
    `Animation: ${state.clipCount > 0 ? (state.paused ? "paused" : "playing") : "none"}  wireframe=${state.wireframe ? "on" : "off"}`,
    `Screenshot: ${state.screenshotName || "-"}`,
    state.lastError ? `Error: ${state.lastError}` : "Status: pick a .glb file or load the bundled sample"
  ];
}

// ヘルプのパネルを現在の入力と実行状態に合わせて更新する
function updateHelpPanel() {
  const panel = app?.getOverlayPanel?.("embeddedGlbViewerHelp");
  if (!panel || !orbit?.orbit) {
    return;
  }
  const lines = buildViewerHelpLines();
  const nextText = lines.join("\n");
  if (nextText === lastHelpText) {
    return;
  }
  app.updateOverlayPanel("embeddedGlbViewerHelp", { lines });
  lastHelpText = nextText;
}

// `viewer`の`controls`を現在の入力と実行状態に合わせて更新する
function refreshViewerControls() {
  palette?.render();
  updateHelpPanel();
  app.requestRender();
}

// コマンドの操作パレットの初期化段階で、必要な状態と資源を準備して処理を開始する
function installCommandPalette() {
  palette = new CommandPalette({
    document,
    container: document.body,
    viewport: app.screen.canvas,
    title: "GLB Viewer",
    pageRows: 5,
    pageRowsByPage: [5],
    closeOnCommand: false,
    onChange: (id, value) => {
      if (id === "pause") {
        state.paused = value;
      } else if (id === "wireframe") {
        state.wireframe = value;
        applyWireframeState();
      }
      refreshViewerControls();
    },
    onCommand: (id) => {
      if (id === "load-sample") {
        loadBundledSample().catch((err) => {
          showErrorState(err);
        });
      } else if (id === "clear") {
        clearCurrentModel({ toast: true });
      } else if (id === "reset-view") {
        resetOrbit(state.modelSize);
        app.pushToast("camera reset", { durationMs: 900 });
      } else if (id === "screenshot") {
        takeViewerScreenshot();
      }
      focusViewerCanvas();
      refreshViewerControls();
    },
    commands: [
      // 1ページ目
      { id: "load-sample", label: "Load", detail: "sample" },
      { id: "clear", label: "Clear", detail: "model" },
      { id: "reset-view", label: "Reset", detail: "view" },
      { id: "palette-next", label: "Next", detail: "page", pageSwitch: true },
      { id: "screenshot", label: "Shot", detail: "png" },
      { type: "toggle", id: "pause", label: "Pause", detail: "anim", value: () => state.paused },
      { type: "toggle", id: "wireframe", label: "Wire", detail: "mesh", value: () => state.wireframe },
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ]
  });
  palette.attachToCanvas(app.screen.canvas, { key: "/" });
  palette.setStyle(getDefaultCommandPaletteCss());
}

// `viewer`の診断情報の統計情報を現在の入力と実行状態に合わせて更新する
function updateViewerDiagnosticsStats() {
  const rodAttitude = typeof app.cameraRod?.getWorldAttitude === "function"
    ? app.cameraRod.getWorldAttitude()
    : [NaN, NaN, NaN];
  const eyePosition = typeof app.eye?.getPosition === "function"
    ? app.eye.getPosition()
    : [NaN, NaN, NaN];
  const eyeAttitude = typeof app.eye?.getWorldAttitude === "function"
    ? app.eye.getWorldAttitude()
    : [NaN, NaN, NaN];
  app.mergeDiagnosticsStats({
    viewerFile: state.fileLabel,
    viewerSource: state.sourceLabel,
    viewerStage: state.loading ? state.loadStage : "idle",
    viewerLoaded: state.hasActiveModel ? "yes" : "no",
    viewerTriangles: state.triangleCount,
    viewerNodeCount: state.nodeCount,
    viewerClipCount: state.clipCount,
    viewerPaused: state.paused ? "yes" : "no",
    viewerAnimationRunning: state.animationRunning ? "yes" : "no",
    viewerAnimationLoopCount: state.animationLoopCount,
    viewerWireframe: state.wireframe ? "yes" : "no",
    viewerKeyState: `L=${app.input.has("arrowleft") ? 1 : 0} R=${app.input.has("arrowright") ? 1 : 0} U=${app.input.has("arrowup") ? 1 : 0} D=${app.input.has("arrowdown") ? 1 : 0} Sh=${app.input.has("shift") ? 1 : 0}`,
    viewerArrowActive: app.input.has("arrowleft") || app.input.has("arrowright") || app.input.has("arrowup") || app.input.has("arrowdown")
      ? "yes"
      : "no",
    viewerShiftPanActive: app.input.has("shift")
      && (app.input.has("arrowleft") || app.input.has("arrowright") || app.input.has("arrowup") || app.input.has("arrowdown"))
      ? "yes"
      : "no",
    viewerOrbitInputSame: orbit.input === app.input ? "yes" : "no",
    viewerOrbitKeyMap: `${orbit.orbit.keyMap.left}/${orbit.orbit.keyMap.right}/${orbit.orbit.keyMap.up}/${orbit.orbit.keyMap.down}`,
    viewerCtxDeltaSec: formatDebugNumber(state.lastCtxDeltaSec, 6),
    viewerTarget: `${orbit.orbit.target[0].toFixed(3)}, ${orbit.orbit.target[1].toFixed(3)}, ${orbit.orbit.target[2].toFixed(3)}`,
    viewerOrbitYaw: orbit.orbit.yaw.toFixed(2),
    viewerOrbitPitch: orbit.orbit.pitch.toFixed(2),
    viewerOrbitDistance: orbit.orbit.distance.toFixed(2),
    viewerOrbitChangedThisFrame: state.orbitChangedThisFrame ? "yes" : "no",
    viewerEyeChangedThisFrame: state.eyeChangedThisFrame ? "yes" : "no",
    viewerRodYawPitch: `${Number(rodAttitude[0]).toFixed(2)}, ${Number(rodAttitude[1]).toFixed(2)}`,
    viewerEyeYawPitch: `${Number(eyeAttitude[0]).toFixed(2)}, ${Number(eyeAttitude[1]).toFixed(2)}`,
    viewerEyeZ: Number(eyePosition[2]).toFixed(3),
    viewerError: state.lastError || "(none)"
  });
}

// 状態表示のパネルを現在の入力と実行状態に合わせて更新する
function updateStatusPanel() {
  if (!ui.status) {
    return;
  }
  const rodAttitude = typeof app.cameraRod?.getAttitude === "function"
    ? app.cameraRod.getAttitude()
    : [NaN, NaN, NaN];
  const eyePosition = typeof app.eye?.getPosition === "function"
    ? app.eye.getPosition()
    : [NaN, NaN, NaN];
  ui.headline.textContent = state.hasActiveModel
    ? `Viewing ${state.fileLabel}`
    : "Upload a GLB file";
  ui.status.textContent = [
    "samples/embedded_glb_viewer",
    `file: ${state.fileLabel}`,
    `source: ${state.sourceLabel}`,
    `stage: ${state.loading ? state.loadStage : "idle"}`,
    `elapsedMs: ${Math.round(state.loadElapsedMs)}`,
    `loaded: ${state.hasActiveModel ? "yes" : "no"}`,
    `triangles: ${state.triangleCount}`,
    `nodeCount: ${state.nodeCount}`,
    `clipCount: ${state.clipCount}`,
    `paused: ${state.paused ? "yes" : "no"}`,
    `wireframe: ${state.wireframe ? "yes" : "no"}`,
    `keyState: L=${app.input.has("arrowleft") ? 1 : 0} R=${app.input.has("arrowright") ? 1 : 0} U=${app.input.has("arrowup") ? 1 : 0} D=${app.input.has("arrowdown") ? 1 : 0} Sh=${app.input.has("shift") ? 1 : 0}`,
    `arrowActive: ${(app.input.has("arrowleft") || app.input.has("arrowright") || app.input.has("arrowup") || app.input.has("arrowdown")) ? "yes" : "no"} shiftPan: ${(app.input.has("shift") && (app.input.has("arrowleft") || app.input.has("arrowright") || app.input.has("arrowup") || app.input.has("arrowdown"))) ? "yes" : "no"}`,
    `orbitInputSame: ${orbit.input === app.input ? "yes" : "no"}`,
    `orbitKeyMap: ${orbit.orbit.keyMap.left}/${orbit.orbit.keyMap.right}/${orbit.orbit.keyMap.up}/${orbit.orbit.keyMap.down}`,
    `ctxDeltaSec: ${formatDebugNumber(state.lastCtxDeltaSec, 6)}`,
    `targetX: ${orbit.orbit.target[0].toFixed(3)}`,
    `targetY: ${orbit.orbit.target[1].toFixed(3)}`,
    `targetZ: ${orbit.orbit.target[2].toFixed(3)}`,
    `orbitYaw: ${orbit.orbit.yaw.toFixed(2)}`,
    `orbitPitch: ${orbit.orbit.pitch.toFixed(2)}`,
    `orbitDistance: ${orbit.orbit.distance.toFixed(2)}`,
    `orbitChanged/eyeChanged: ${state.orbitChangedThisFrame ? "yes" : "no"} / ${state.eyeChangedThisFrame ? "yes" : "no"}`,
    `rodYawPitch: ${Number(rodAttitude[0]).toFixed(2)}, ${Number(rodAttitude[1]).toFixed(2)}`,
    `eyeYawPitch: ${Number((typeof app.eye?.getWorldAttitude === "function" ? app.eye.getWorldAttitude() : [NaN, NaN, NaN])[0]).toFixed(2)}, ${Number((typeof app.eye?.getWorldAttitude === "function" ? app.eye.getWorldAttitude() : [NaN, NaN, NaN])[1]).toFixed(2)}`,
    `eyeZ: ${Number(eyePosition[2]).toFixed(3)}`,
    state.lastError ? `error: ${state.lastError}` : "error: (none)"
  ].join("\n");
}

// このインスタンスの初期化段階で、必要な状態と資源を準備して処理を開始する
async function start() {
  cacheUi();
  detachArrowKeyBridge?.();
  detachArrowKeyBridge = null;

  app = new WebgApp({
    document,
    shaderClass: SmoothShader,
    layoutMode: "embedded",
    fixedCanvasSize: {
      width: 820,
      height: 560,
      useDevicePixelRatio: false
    },
    clearColor: [0.10, 0.15, 0.10, 1.0],
    messageFontTexture: "../../webg/font512.png",
    viewAngle: 50.0,
    light: {
      mode: "world-node",
      nodeName: "viewerLight",
      position: [130.0, 180.0, 150.0],
      attitude: [0.0, 0.0, 0.0],
      type: 1.0
    },
    debugTools: {
      mode: "release",
      system: "embedded-glb-viewer",
      source: "samples/embedded_glb_viewer/main.js",
      probeDefaultAfterFrames: 1
    },
    camera: {
      target: [...DEFAULT_ORBIT.target],
      distance: DEFAULT_ORBIT.distance,
      yaw: DEFAULT_ORBIT.yaw,
      pitch: DEFAULT_ORBIT.pitch
    }
  });
  await app.init();

  orbit = app.createOrbitEyeRig({
    target: [...DEFAULT_ORBIT.target],
    distance: DEFAULT_ORBIT.distance,
    yaw: DEFAULT_ORBIT.yaw,
    pitch: DEFAULT_ORBIT.pitch,
    minDistance: 4.0,
    maxDistance: 56.0,
    wheelZoomStep: 1.2
  });
  app.input.registerActionMap({
    "reset-view": ["r"],
    "toggle-pause": ["space"],
    "capture-shot": ["s"],
    "toggle-wireframe": ["w"]
  });
  // WebgApp の自動 attach だけでも keyboard は受けるが、embedded viewer では
  // sample 側で attachInput() を明示して経路を固定し、Arrow / Shift を含む継続押下を
  // EyeRig.update() が安定して読める前提を保つ
  app.attachInput();
  app.input.installTouchControls({
    touchDeviceOnly: false,
    groups: TOUCH_GROUPS
  });
  detachArrowKeyBridge = installArrowKeyBridge();
  app.screen.canvas?.addEventListener("pointerdown", () => {
    focusViewerCanvas();
  });

  createPlaceholderScene();
  applyWireframeState();
  resetOrbit(PLACEHOLDER_SIZE);
  installDomHandlers();
  app.showOverlayPanel(buildHelpPanelOptions({
    id: "embeddedGlbViewerHelp",
    collapsed: true,
    lines: buildViewerHelpLines()
  }));
  lastHelpText = buildViewerHelpLines().join("\n");
  installCommandPalette();
  focusViewerCanvas();
  refreshViewerControls();
  updateViewerDiagnosticsStats();
  updateStatusPanel();

  app.start({
    onUpdate(ctx) {
      state.lastCtxDeltaSec = ctx.deltaSec;
      const previousEyeAttitude = state.previousEyeAttitude;
      const nextEyeAttitude = typeof app.eye?.getWorldAttitude === "function"
        ? app.eye.getWorldAttitude()
        : [NaN, NaN, NaN];
      state.orbitChangedThisFrame =
        orbit.orbit.yaw !== state.previousOrbitYaw
        || orbit.orbit.pitch !== state.previousOrbitPitch
        || orbit.orbit.target[0] !== state.previousTarget[0]
        || orbit.orbit.target[1] !== state.previousTarget[1]
        || orbit.orbit.target[2] !== state.previousTarget[2];
      state.eyeChangedThisFrame =
        nextEyeAttitude[0] !== previousEyeAttitude[0]
        || nextEyeAttitude[1] !== previousEyeAttitude[1]
        || nextEyeAttitude[2] !== previousEyeAttitude[2];
      state.previousOrbitYaw = orbit.orbit.yaw;
      state.previousOrbitPitch = orbit.orbit.pitch;
      state.previousTarget = [...orbit.orbit.target];
      state.previousEyeAttitude = [...nextEyeAttitude];
      handlePressedActions();
      state.loadElapsedMs = state.loading
        ? Math.max(0, performance.now() - state.loadStartedAtMs)
        : state.loadElapsedMs;

      advanceViewerAnimations();

      if (!state.hasActiveModel && placeholderSpinNode) {
        placeholderSpinNode.rotateY(22.0 * ctx.deltaSec);
        placeholderSpinNode.rotateX(8.0 * ctx.deltaSec);
      }

      updateHelpPanel();
      updateViewerDiagnosticsStats();
      updateStatusPanel();
    }
  });
}
