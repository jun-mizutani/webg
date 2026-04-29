// ---------------------------------------------
// samples/scene/main.js  2026/04/12
//   scene sample
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import WebgApp from "../../webg/WebgApp.js";
import SmoothShader from "../../webg/SmoothShader.js";
import SceneAsset from "../../webg/SceneAsset.js";
import Diagnostics from "../../webg/Diagnostics.js";
import UIPanel from "../../webg/UIPanel.js";

const SCENE_FILE = "./scene.json";
const DOWNLOAD_FILE = "scene_copy.json";
const DEBUG_MODE = "release";
const GUIDE_LINES = [
  "Drag or Arrow: orbit",
  "[ / ] or wheel: zoom",
  "[p]: pause scene  [1]: replay model  [2]: floor wireframe",
  "[r]: reset camera  [d]: scene JSON"
];

let app = null;
let orbit = null;
let sceneAsset = null;
let sceneRuntime = null;
let sceneValidation = null;
let ui = null;
let paused = false;
let floorWireframe = false;
let modelEntry = null;
let floorEntry = null;
let totalTriangles = 0;
let uiStatusText = "loading scene sample";
let actionHandlers = null;
let uiPanels = null;
let overlayLayout = null;

// scene sample 固有の文面や button 配置だけをここで組み、
// panel の CSS / blur / radius / theme 反映は UIPanel 側へ集約する
function buildSceneOverlay() {
  uiPanels = new UIPanel({
    document,
    theme: app?.uiTheme?.uiPanel
  });
  overlayLayout = uiPanels.createLayout({
    id: "sceneOverlay",
    leftWidth: "minmax(0, 340px)",
    rightWidth: "minmax(0, 300px)",
    gap: 12,
    scrollColumns: true,
    collapseWidth: 920,
    compactWidth: 720
  });

  const refs = {};
  const introPanel = uiPanels.createPanel(overlayLayout.left);
  uiPanels.createEyebrow(introPanel, "Scene JSON Sample");
  uiPanels.createTitle(introPanel, "Scene Loader Playground");
  uiPanels.createCopy(
    introPanel,
    "`scene.json` の camera / primitives / model / input mapping をまとめて読み込み、JavaScript 側では action handler と diagnostics だけを足す構成を確認できます。"
  );
  const actionGrid = uiPanels.createButtonGrid(introPanel, { columns: 2 });
  refs.btnTogglePause = uiPanels.createButton(actionGrid, { id: "btnTogglePause", text: "Pause Scene", disabled: true });
  refs.btnReplayModel = uiPanels.createButton(actionGrid, { id: "btnReplayModel", text: "Replay Model", disabled: true });
  refs.btnToggleFloorWire = uiPanels.createButton(actionGrid, { id: "btnToggleFloorWire", text: "Floor Wire", disabled: true });
  refs.btnResetCamera = uiPanels.createButton(actionGrid, { id: "btnResetCamera", text: "Reset Camera", disabled: true });
  refs.btnDownloadScene = uiPanels.createButton(actionGrid, { id: "btnDownloadScene", text: "Download Scene JSON", disabled: true });
  uiPanels.createHint(
    introPanel,
    "Keyboard でも同じ処理を触れます。ドラッグ / 矢印キーで orbit、ホイール / `[` / `]` で zoom です。"
  );

  const diagnosticsPanel = uiPanels.createPanel(overlayLayout.left);
  uiPanels.createTitle(diagnosticsPanel, "Diagnostics", 2);
  const diagnosticsGrid = uiPanels.createButtonGrid(diagnosticsPanel, { columns: 2 });
  refs.btnCopySummary = uiPanels.createButton(diagnosticsGrid, { id: "btnCopySummary", text: "Copy Summary", disabled: true });
  refs.btnCopyJson = uiPanels.createButton(diagnosticsGrid, { id: "btnCopyJson", text: "Copy JSON", disabled: true });

  const overviewPanel = uiPanels.createPanel(overlayLayout.right, { stack: true });
  const overviewGroup = uiPanels.createGroup(overviewPanel);
  uiPanels.createTitle(overviewGroup, "Overview", 2);
  refs.sceneOverview = uiPanels.createTextBlock(overviewGroup, { id: "sceneOverview", text: "loading...", code: true });
  const bindingsGroup = uiPanels.createGroup(overviewPanel);
  uiPanels.createTitle(bindingsGroup, "Bindings", 2);
  refs.sceneBindings = uiPanels.createTextBlock(bindingsGroup, { id: "sceneBindings", text: "loading...", code: true });

  const statusPanel = uiPanels.createPanel(overlayLayout.right);
  uiPanels.createTitle(statusPanel, "Status", 2);
  refs.sceneStatus = uiPanels.createTextBlock(statusPanel, { id: "sceneStatus", text: "loading...", code: true });
  uiPanels.applyThemeToLayout(overlayLayout);
  return refs;
}

function countSceneEntryTypes(entries = []) {
  let primitiveCount = 0;
  let modelCount = 0;
  for (let i = 0; i < entries.length; i++) {
    const type = entries[i]?.type ?? "model";
    if (type === "primitive") primitiveCount += 1;
    else modelCount += 1;
  }
  return { primitiveCount, modelCount };
}

function getAllShapes(entries) {
  const shapes = [];
  for (let i = 0; i < entries.length; i++) {
    const list = entries[i]?.runtime?.shapes ?? [];
    for (let j = 0; j < list.length; j++) {
      shapes.push(list[j]);
    }
  }
  return shapes;
}

function applyExplicitTextureFlagsToShapes(shapes = []) {
  for (let i = 0; i < shapes.length; i++) {
    const shape = shapes[i];
    if (!shape?.updateMaterial) continue;
    const material = shape.getMaterial?.() ?? { params: shape.materialParams ?? {} };
    const params = material?.params ?? {};
    const hasTexture = !!(params.texture ?? shape.texture);
    // Scene sample は primitive entry と model entry が同じ SmoothShader app に混在するため、
    // 各 shape の use_texture を sample 側で完成形へ固定して draw 順依存を避ける
    shape.updateMaterial({
      use_texture: hasTexture ? 1 : 0
    });
  }
}

function countTriangles(entries) {
  let total = 0;
  for (let i = 0; i < entries.length; i++) {
    const shapes = entries[i]?.runtime?.shapes ?? [];
    for (let j = 0; j < shapes.length; j++) {
      total += shapes[j].getTriangleCount();
    }
  }
  return total;
}

function getSceneActionList() {
  return [...(sceneRuntime?.inputMap?.values?.() ?? [])]
    .map((item) => item.action)
    .join(",") || "-";
}

function getBindingDefinitions() {
  return sceneRuntime?.scene?.input?.bindings
    ?? sceneAsset?.getData?.()?.input?.bindings
    ?? [];
}

function setUiEnabled(enabled) {
  if (!ui) return;
  const controls = [
    ui.btnTogglePause,
    ui.btnReplayModel,
    ui.btnToggleFloorWire,
    ui.btnResetCamera,
    ui.btnDownloadScene,
    ui.btnCopySummary,
    ui.btnCopyJson
  ];
  for (let i = 0; i < controls.length; i++) {
    if (controls[i]) controls[i].disabled = !enabled;
  }
}

function updateUiDockOffset() {
  const dockOffset = app?.isDebugDockActive?.()
    ? (app.debugDock.reserveWidth + app.debugDock.gap)
    : 0;
  uiPanels?.setDockOffset(overlayLayout, dockOffset);
}

function applyOverlayTheme(theme = {}) {
  uiPanels?.setTheme(theme);
}

function setUiStatus(text) {
  uiStatusText = String(text ?? "");
  renderUiPanels();
}

function buildOverviewLines() {
  if (!sceneRuntime) {
    return [
      `scene=${SCENE_FILE}`,
      `status=${uiStatusText}`,
      "entries=loading...",
      "actions=loading..."
    ];
  }

  const counts = countSceneEntryTypes(sceneRuntime.entries);
  const clipNames = modelEntry?.runtime?.getAnimationNames?.() ?? [];
  return [
    `scene=${SCENE_FILE}`,
    `entries=${sceneRuntime.entries.length} primitives=${counts.primitiveCount} models=${counts.modelCount}`,
    `triangles=${totalTriangles} warnings=${sceneValidation?.warnings?.length ?? 0}`,
    `animations=${clipNames.join(",") || "-"} pause=${paused ? "ON" : "OFF"} floorWire=${floorWireframe ? "ON" : "OFF"}`,
    `actions=${getSceneActionList()}`,
    `download=${DOWNLOAD_FILE} debugMode=${app?.getDebugMode?.()?.toUpperCase?.() ?? "-"}`
  ];
}

function buildBindingLines() {
  const lines = [
    "Drag / Arrow  orbit camera",
    "[ / ] / wheel  zoom camera"
  ];
  const bindings = getBindingDefinitions();
  for (let i = 0; i < bindings.length; i++) {
    const binding = bindings[i];
    lines.push(
      `[${String(binding.key ?? "").toUpperCase()}] ${binding.action ?? "-"} - ${binding.description ?? "-"}`
    );
  }
  const prefix = app?.getDebugKeyPrefixLabel?.() ?? "F9";
  lines.push(`[${prefix}] diagnostics copy / panel / debug mode`);
  return lines;
}

function buildUiStatusLines() {
  if (!app) {
    return [
      `status=${uiStatusText}`,
      "diagnostics=waiting for app init"
    ];
  }

  const envReport = app.checkEnvironment({
    stage: "runtime-check",
    shapes: sceneRuntime?.entries ? getAllShapes(sceneRuntime.entries) : []
  });

  return [
    `status=${uiStatusText}`,
    app.getDiagnosticsStatusLine(),
    `env=${envReport.ok ? "OK" : "WARN"} firstWarning=${envReport.warnings?.[0] ?? "-"}`,
    `debugUi=${app.isDebugUiEnabled() ? "ON" : "OFF"} dock=${app.isDebugDockActive() ? "ON" : "OFF"}`
  ];
}

function updateActionButtonLabels() {
  if (!ui) return;
  ui.btnTogglePause.textContent = paused ? "Resume Scene" : "Pause Scene";
  ui.btnToggleFloorWire.textContent = floorWireframe ? "Floor Wire: ON" : "Floor Wire: OFF";
}

function renderUiPanels() {
  if (!ui) return;
  updateUiDockOffset();
  updateActionButtonLabels();
  ui.sceneOverview.textContent = buildOverviewLines().join("\n");
  ui.sceneBindings.textContent = buildBindingLines().join("\n");
  ui.sceneStatus.textContent = buildUiStatusLines().join("\n");
}

function bindUiEvents() {
  if (!ui) return;

  // sample 固有 action は keyboard / button の両方から同じ handler を通す
  // button 側だけ別処理にすると説明と実挙動がずれやすいため、
  // ここでは action 名を共通入口として再利用する
  ui.btnTogglePause.addEventListener("click", () => runSceneAction("toggle-pause"));
  ui.btnReplayModel.addEventListener("click", () => runSceneAction("replay-model"));
  ui.btnToggleFloorWire.addEventListener("click", () => runSceneAction("toggle-floor-wireframe"));
  ui.btnResetCamera.addEventListener("click", () => runSceneAction("reset-camera"));
  ui.btnDownloadScene.addEventListener("click", () => runSceneAction("download-scene"));

  // diagnostics 系 button も Current State と同じ現在 report を使い、
  // HTML overlay と dock のどちらから見ても内容がずれないようにする
  ui.btnCopySummary.addEventListener("click", async () => {
    const copied = await app.copyDiagnosticsSummary();
    setUiStatus(copied ? "diagnostics summary copied" : "diagnostics summary copy failed");
  });
  ui.btnCopyJson.addEventListener("click", async () => {
    const copied = await app.copyDiagnosticsReportJSON();
    setUiStatus(copied ? "diagnostics json copied" : "diagnostics json copy failed");
  });
}

function refreshDiagnosticsStats() {
  const shapeList = sceneRuntime?.entries ? getAllShapes(sceneRuntime.entries) : [];
  const counts = countSceneEntryTypes(sceneRuntime?.entries ?? []);
  const envReport = app.checkEnvironment({
    stage: "runtime-check",
    shapes: shapeList
  });
  app.mergeDiagnosticsStats({
    entryCount: sceneRuntime?.entries?.length ?? 0,
    primitiveCount: counts.primitiveCount,
    modelCount: counts.modelCount,
    triangleCount: totalTriangles,
    sceneWarnings: sceneValidation?.warnings?.length ?? 0,
    paused: paused ? "yes" : "no",
    floorWireframe: floorWireframe ? "yes" : "no",
    actions: getSceneActionList(),
    envOk: envReport.ok ? "yes" : "no",
    envWarning: envReport.warnings?.[0] ?? "-"
  });
}

function makeProbeReport(frameCount) {
  const shapeList = sceneRuntime?.entries ? getAllShapes(sceneRuntime.entries) : [];
  const counts = countSceneEntryTypes(sceneRuntime?.entries ?? []);
  const envReport = app.checkEnvironment({
    stage: "runtime-probe",
    shapes: shapeList
  });
  const report = app.createProbeReport("runtime-probe");
  Diagnostics.addDetail(report, `sceneFile=${SCENE_FILE}`);
  Diagnostics.addDetail(report, `actions=${getSceneActionList()}`);
  if (envReport.warnings?.length) {
    Diagnostics.addDetail(report, `envWarning=${envReport.warnings[0]}`);
  }
  Diagnostics.mergeStats(report, {
    frameCount,
    entryCount: sceneRuntime?.entries?.length ?? 0,
    primitiveCount: counts.primitiveCount,
    modelCount: counts.modelCount,
    triangleCount: totalTriangles,
    sceneWarnings: sceneValidation?.warnings?.length ?? 0,
    paused: paused ? "yes" : "no",
    floorWireframe: floorWireframe ? "yes" : "no",
    envOk: envReport.ok ? "yes" : "no"
  });
  return report;
}

// scene sample の役割:
// - `SceneAsset.load()` と `WebgApp.loadScene()` を使い、Scene JSON の最小経路を示す
// - scene 側では camera / primitives / model / hud / input mapping を宣言し、
//   JavaScript 側では action handler だけを書く責務分担を示す
// - さらに、この sample では HTML overlay から同じ action handler を呼べるようにし、
//   Scene JSON の入力定義と実際の処理フローを見比べやすくする
// - `ModelAsset` の既存 build 経路を scene から再利用できることを確認する

document.addEventListener("DOMContentLoaded", () => {
  start().catch((err) => {
    ui ??= buildSceneOverlay();
    setUiStatus(`scene sample failed (${err?.message ?? err})`);
    app?.setDiagnosticsReport(Diagnostics.createErrorReport(err, {
      system: "scene",
      source: SCENE_FILE,
      stage: app?.getDiagnosticsReport?.()?.stage ?? "start"
    }));
    if (app?.isConsoleEnabled?.()) {
      console.error("scene sample failed:", err);
    }
    app?.showErrorPanel?.(err, {
      title: "scene sample failed",
      id: "start-error",
      background: "rgba(26, 38, 26, 0.92)"
    });
  });
});

function configureOrbitFromScene(entries) {
  // scene 全体の bbox を集め、primitive と model を一度に見渡せる距離を決める
  const shapes = getAllShapes(entries);
  const size = app.getShapeSize(shapes);
  const target = [size.centerx, size.centery, size.centerz];
  const distance = Math.max(8.0, size.max * 2.2);

  orbit.orbit.minDistance = Math.max(2.0, size.max * 0.20);
  orbit.orbit.maxDistance = Math.max(12.0, size.max * 10.0);
  orbit.orbit.wheelZoomStep = Math.max(0.25, size.max * 0.05);
  orbit.setTarget(...target);
  orbit.setAngles(24.0, -14.0);
  orbit.setDistance(distance);
}

function replayModelAnimations() {
  if (!modelEntry?.runtime) {
    return false;
  }
  modelEntry.runtime.restartAllAnimations();
  paused = false;
  modelEntry.runtime.setAnimationsPaused(false);
  return true;
}

function toggleFloorWireframe() {
  if (!floorEntry?.runtime?.shapes?.length) {
    return false;
  }
  floorWireframe = !floorWireframe;
  const shapes = floorEntry.runtime.shapes;
  for (let i = 0; i < shapes.length; i++) {
    shapes[i].setWireframe(floorWireframe);
  }
  return true;
}

function toggleScenePause() {
  if (!modelEntry?.runtime) {
    return false;
  }
  paused = !paused;
  modelEntry.runtime.setAnimationsPaused(paused);
  return true;
}

function resetCamera() {
  if (!sceneRuntime?.entries?.length) {
    return false;
  }
  orbit.setAngles(24.0, -14.0);
  configureOrbitFromScene(sceneRuntime.entries);
  return true;
}

function buildActionHandlers() {
  // Scene JSON の input は action 名までしか持たないため、
  // 実際の操作意味は sample 側でこの map に割り当てる
  // HTML button もここを通すことで、キー操作と button 操作の差をなくす
  return {
    "toggle-pause": () => {
      if (!toggleScenePause()) {
        setUiStatus("toggle-pause skipped because model runtime is not ready");
        return false;
      }
      setUiStatus(paused ? "scene animation paused" : "scene animation resumed");
      return true;
    },
    "replay-model": () => {
      if (!replayModelAnimations()) {
        setUiStatus("replay-model skipped because model runtime is not ready");
        return false;
      }
      setUiStatus("model animation restarted");
      return true;
    },
    "toggle-floor-wireframe": () => {
      if (!toggleFloorWireframe()) {
        setUiStatus("toggle-floor-wireframe skipped because floor runtime is not ready");
        return false;
      }
      setUiStatus(floorWireframe ? "floor wireframe enabled" : "floor wireframe disabled");
      return true;
    },
    "reset-camera": () => {
      if (!resetCamera()) {
        setUiStatus("reset-camera skipped because scene runtime is not ready");
        return false;
      }
      setUiStatus("camera reset to scene framing");
      return true;
    },
    "download-scene": () => {
      sceneAsset?.downloadJSON(DOWNLOAD_FILE);
      setUiStatus(`scene json downloaded as ${DOWNLOAD_FILE}`);
      return true;
    }
  };
}

function runSceneAction(actionName) {
  const handler = actionHandlers?.[actionName];
  if (typeof handler !== "function") {
    setUiStatus(`action handler is missing for ${actionName}`);
    return false;
  }
  return handler({ action: actionName });
}

async function start() {
  ui = buildSceneOverlay();
  bindUiEvents();
  setUiEnabled(false);
  renderUiPanels();

  // Scene JSON の結果を 3D 上へ出すため、スキニング付き model も扱える SmoothShader を使う
  app = new WebgApp({
    document,
    shaderClass: SmoothShader,
    clearColor: [0.10, 0.13, 0.18, 1.0],
    lightPosition: [0.0, 120.0, 900.0, 1.0],
    viewAngle: 53.0,
    messageFontTexture: "../../webg/font512.png",
    camera: {
      target: [0.0, 4.5, 0.0],
      distance: 38.0,
      yaw: 24.0,
      pitch: -14.0
    },
    debugTools: {
      mode: DEBUG_MODE,
      system: "scene",
      source: SCENE_FILE,
      guideLines: GUIDE_LINES,
      guideOptions: {
        anchor: "top-left",
        x: 0,
        y: 0,
        width: 44,
        wrap: true
      },
      probeDefaultAfterFrames: 1
    }
  });
  await app.init();
  applyOverlayTheme(app.uiTheme.uiPanel);
  renderUiPanels();

  // Scene JSON が camera を持つ場合でも、実運用では orbit で周囲を確認したくなるため、
  // sample では scene 読み込み後に bbox 基準の距離へ合わせている
  orbit = app.createOrbitEyeRig({
    target: [0.0, 4.5, 0.0],
    distance: 38.0,
    yaw: 24.0,
    pitch: -14.0
  });

  app.setDiagnosticsStage("fetch");
  setUiStatus("fetching scene json");
  sceneAsset = await SceneAsset.load(SCENE_FILE);

  app.setDiagnosticsStage("validate");
  setUiStatus("validating scene json");
  sceneValidation = app.validateScene(sceneAsset.getData());
  if (!sceneValidation.ok) {
    const lines = sceneValidation.errors.map((item) => `${item.path}: ${item.message}`);
    throw new Error(`Scene validation failed\n${lines.join("\n")}`);
  }
  app.mergeDiagnosticsStats({
    sceneWarnings: sceneValidation.warnings.length
  });

  app.setDiagnosticsStage("build");
  setUiStatus("building scene runtime");
  sceneRuntime = await app.loadScene(sceneAsset.getData());
  applyExplicitTextureFlagsToShapes(getAllShapes(sceneRuntime.entries));
  modelEntry = sceneRuntime.getEntry("hero");
  floorEntry = sceneRuntime.getEntry("floor");
  totalTriangles = countTriangles(sceneRuntime.entries);
  configureOrbitFromScene(sceneRuntime.entries);

  app.setDiagnosticsStage("runtime");
  app.configureDiagnosticsCapture({
    labelPrefix: "scene",
    collect: () => makeProbeReport(app.screen.getFrameCount()),
    onCaptured: (result) => setUiStatus(`snapshot ${result.format} ready`)
  });
  app.configureDebugKeyInput();

  // Scene JSON の input mapping を action handler へ接続し、
  // event.key.toLowerCase() の規約は WebgApp.attachInput 側に任せる
  actionHandlers = buildActionHandlers();
  const sceneInputHandler = sceneRuntime.createInputHandler(actionHandlers);
  app.attachInput({
    onKeyDown: (key, ev) => {
      if (ev.repeat) return;
      sceneInputHandler.onKeyDown(key, ev);
    }
  });

  setUiEnabled(true);
  setUiStatus("scene ready");

  app.start({
    onUpdate: ({ deltaSec }) => {
      orbit.update(deltaSec);

      if (!paused) {
        sceneRuntime.update();
      }

      refreshDiagnosticsStats();
      app.updateDebugProbe();
      renderUiPanels();
      // UIPanel で情報を読む構成へ寄せたため、
      // 操作説明は debug dock へ出さず scene 側 panel に集約する
      app.clearDebugDockRows();
      app.clearHudRows();
    }
  });
}
