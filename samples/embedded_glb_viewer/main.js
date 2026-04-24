// -------------------------------------------------
// embedded_glb_viewer sample
//   main.js       2026/04/23
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// -------------------------------------------------

import WebgApp from "../../webg/WebgApp.js";
import SmoothShader from "../../webg/SmoothShader.js";
import Shape from "../../webg/Shape.js";
import Primitive from "../../webg/Primitive.js";
import Diagnostics from "../../webg/Diagnostics.js";

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
  const onKeyUp = (ev) => {
    const key = normalizeViewerArrowKey(ev);
    if (!bridgedKeys.has(key)) {
      return;
    }
    ev.preventDefault();
    app.input.release(key);
  };
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

function createMaterialShape(gpu, primitiveAsset, params) {
  const shape = new Shape(gpu);
  shape.applyPrimitiveAsset(primitiveAsset);
  shape.endShape();
  shape.setMaterial("smooth-shader", params);
  return shape;
}

function addPlaceholderPrimitive(parentNode, nodeName, primitiveAsset, materialParams, position) {
  const node = app.space.addNode(parentNode, nodeName);
  const shape = createMaterialShape(
    app.getGL(),
    primitiveAsset,
    materialParams
  );
  node.addShape(shape);
  node.setPosition(position[0], position[1], position[2]);
  return node;
}

function formatDebugNumber(value, digits = 6) {
  if (Number.isFinite(value)) {
    return Number(value).toFixed(digits);
  }
  return String(value);
}

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

function setPlaceholderVisible(visible) {
  if (!placeholderRoot) return;
  setNodeTreeHidden(placeholderRoot, !visible);
}

function collectPlaceholderShapes() {
  const shapes = [];
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

function getViewerShapes() {
  if (state.hasActiveModel && Array.isArray(state.instantiated?.shapes)) {
    return state.instantiated.shapes;
  }
  return collectPlaceholderShapes();
}

function applyWireframeState() {
  const shapes = getViewerShapes();
  for (let i = 0; i < shapes.length; i++) {
    shapes[i]?.setWireframe?.(state.wireframe);
  }
}

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

function updateLoadPanel() {
  const lines = [
    "embedded_glb_viewer",
    `stage=${state.loadStage}`,
    `file=${state.fileLabel}`,
    `elapsedMs=${Math.round(state.loadElapsedMs)}`
  ];
  if (state.loading) {
    app.showFixedFormatPanel(lines.join("\n"), {
      id: "embeddedViewerLoad",
      left: 14,
      top: 14,
      maxHeight: "none",
      color: "#fff2d7",
      background: "rgba(22, 32, 26, 0.92)"
    });
  } else {
    app.clearFixedFormatPanel("embeddedViewerLoad");
  }
}

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

function makeScreenshotName() {
  const base = state.fileLabel && state.fileLabel !== "(none)"
    ? state.fileLabel.replace(/\.[^.]+$/, "")
    : "embedded_glb_viewer";
  return base
    .replace(/[^a-z0-9_-]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    || "embedded_glb_viewer";
}

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

function clearErrorState() {
  state.lastError = "";
  app.clearFixedFormatPanel("embeddedViewerError");
}

function showErrorState(err) {
  const report = Diagnostics.createErrorReport(err, {
    system: "embedded-glb-viewer",
    source: "samples/embedded_glb_viewer/main.js",
    stage: state.loadStage
  });
  state.lastError = err?.message ?? String(err);
  app.setDiagnosticsReport(report);
  app.showErrorPanel(err, {
    id: "embeddedViewerError",
    title: "glb load failed",
    background: "rgba(42, 18, 22, 0.94)"
  });
}

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

function attachInstantiatedRoots(runtime, instantiated, mountNode) {
  const roots = runtime.nodes.filter((nodeInfo) => nodeInfo.parent === null);
  for (let i = 0; i < roots.length; i++) {
    const createdNode = instantiated.nodeMap.get(roots[i].id);
    if (createdNode) {
      createdNode.attach(mountNode);
    }
  }
}

function computeTriangleCount(shapes) {
  let total = 0;
  for (let i = 0; i < shapes.length; i++) {
    total += Number(shapes[i]?.getTriangleCount?.() ?? 0);
  }
  return total;
}

function computeViewerSize(shapes) {
  const size = app.getShapeSize(shapes);
  if (!Number.isFinite(size.max) || size.max <= 0.0) {
    return { ...PLACEHOLDER_SIZE };
  }
  return size;
}

function placeModelRoot(rootNode, size) {
  rootNode.setPosition(
    -Number(size.centerx ?? 0.0),
    -Number(size.centery ?? 0.0),
    -Number(size.centerz ?? 0.0)
  );
}

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

function toggleWireframe() {
  state.wireframe = !state.wireframe;
  applyWireframeState();
  focusViewerCanvas();
  app.pushToast(state.wireframe ? "wireframe on" : "wireframe off", {
    durationMs: 900
  });
}

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

async function loadBundledSample() {
  await loadModelFromSource(BUNDLED_SAMPLE, {
    fileLabel: "hand.glb",
    sourceLabel: "bundled sample"
  });
}

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

function updateHudRows() {
  app.setHudRows([
    { line: "embedded glb viewer" },
    {
      label: "File",
      value: state.fileLabel,
      note: state.sourceLabel
    },
    {
      label: "Stage",
      value: state.loading ? state.loadStage : "idle",
      note: `${Math.round(state.loadElapsedMs)} ms`
    },
    {
      label: "Model",
      value: state.hasActiveModel ? "loaded" : "placeholder",
      note: `tris=${state.triangleCount} clips=${state.clipCount}`
    },
    {
      label: "Orbit",
      value: `yaw=${orbit.orbit.yaw.toFixed(1)} pitch=${orbit.orbit.pitch.toFixed(1)}`,
      note: `dist=${orbit.orbit.distance.toFixed(1)}`
    },
    {
      label: "Target",
      value: `${orbit.orbit.target[0].toFixed(2)}, ${orbit.orbit.target[1].toFixed(2)}, ${orbit.orbit.target[2].toFixed(2)}`,
      note: "Shift+Drag / Shift+Arrow / 2finger"
    },
    {
      label: "Anim",
      value: state.clipCount > 0 ? (state.paused ? "paused" : "playing") : "none",
      note: "Space / touch ||"
    },
    {
      label: "Wire",
      value: state.wireframe ? "on" : "off",
      note: "W / button / touch"
    },
    {
      label: "Shot",
      value: state.screenshotName || "-",
      note: "S / touch Shot"
    },
    {
      line: state.lastError
        ? `error: ${state.lastError}`
        : "pick a .glb file or load the bundled sample"
    }
  ], {
    anchor: "top-left",
    x: 0,
    y: 0,
    color: [0.92, 0.96, 1.0],
    minScale: 0.82
  });
}

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
    head: DEFAULT_ORBIT.yaw,
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
  focusViewerCanvas();
  updateHudRows();
  updateViewerDiagnosticsStats();
  updateStatusPanel();

  app.start({
    onUpdate(ctx) {
      state.lastCtxDeltaSec = ctx.deltaSec;
      const previousOrbitYaw = orbit.orbit.yaw;
      const previousOrbitPitch = orbit.orbit.pitch;
      const previousTargetX = orbit.orbit.target[0];
      const previousTargetY = orbit.orbit.target[1];
      const previousTargetZ = orbit.orbit.target[2];
      const previousEyeAttitude = typeof app.eye?.getWorldAttitude === "function"
        ? app.eye.getWorldAttitude()
        : [NaN, NaN, NaN];
      orbit.update(ctx.deltaSec);
      syncOrbitStateToAppCamera();
      state.orbitChangedThisFrame =
        orbit.orbit.yaw !== previousOrbitYaw
        || orbit.orbit.pitch !== previousOrbitPitch
        || orbit.orbit.target[0] !== previousTargetX
        || orbit.orbit.target[1] !== previousTargetY
        || orbit.orbit.target[2] !== previousTargetZ;
      const nextEyeAttitude = typeof app.eye?.getWorldAttitude === "function"
        ? app.eye.getWorldAttitude()
        : [NaN, NaN, NaN];
      state.eyeChangedThisFrame =
        nextEyeAttitude[0] !== previousEyeAttitude[0]
        || nextEyeAttitude[1] !== previousEyeAttitude[1]
        || nextEyeAttitude[2] !== previousEyeAttitude[2];
      handlePressedActions();
      state.loadElapsedMs = state.loading
        ? Math.max(0, performance.now() - state.loadStartedAtMs)
        : state.loadElapsedMs;

      advanceViewerAnimations();

      if (!state.hasActiveModel && placeholderSpinNode) {
        placeholderSpinNode.rotateY(22.0 * ctx.deltaSec);
        placeholderSpinNode.rotateX(8.0 * ctx.deltaSec);
      }

      updateHudRows();
      updateViewerDiagnosticsStats();
      updateStatusPanel();
    }
  });
}
