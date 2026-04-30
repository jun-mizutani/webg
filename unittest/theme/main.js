// ---------------------------------------------
// unittest/theme/main.js  2026/04/10
//   theme unittest
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import WebgApp from "../../webg/WebgApp.js";
import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";
import Diagnostics from "../../webg/Diagnostics.js";
import {
  DEFAULT_UI_THEME,
  DEFAULT_UI_LIGHT_THEME,
  DEFAULT_UI_SUNSET_THEME,
  DEFAULT_UI_FOREST_THEME
} from "../../webg/WebgUiTheme.js";

const FIXED_PANEL_ID = "theme-preview";

// unittest/theme の確認対象:
// - WebgApp.setUiTheme() で debugDock / OverlayPanel / error panel をまとめて差し替えられるか
// - preset ごとに透明度、accent、文字色が破綻せず読めるか
// - runtime 中の theme 切替で debug key, diagnostics, FixedFormatPanel が崩れないか
const THEME_PRESETS = [
  {
    id: "dark",
    keyLabel: "1",
    label: "Dark",
    note: "既定の dark preset",
    lead: "既定の dark preset を基準に、dock と overlay の可読性を確認する",
    uiTheme: DEFAULT_UI_THEME,
    clearColor: [0.06, 0.08, 0.11, 1.0],
    mainColor: [0.76, 0.50, 0.30, 1.0],
    accentColor: [0.96, 0.84, 0.54, 1.0]
  },
  {
    id: "light",
    keyLabel: "2",
    label: "Light",
    note: "明るい editor 向け",
    lead: "light preset で panel の境界線と薄い背景でも文字が読めるかを確認する",
    uiTheme: DEFAULT_UI_LIGHT_THEME,
    clearColor: [0.86, 0.91, 0.98, 1.0],
    mainColor: [0.36, 0.52, 0.80, 1.0],
    accentColor: [0.92, 0.70, 0.34, 1.0]
  },
  {
    id: "sunset",
    keyLabel: "3",
    label: "Sunset",
    note: "warm dark accent",
    lead: "warm accent を強めた dark preset で、alert や tool panel に暖色を使う場合を想定する",
    uiTheme: DEFAULT_UI_SUNSET_THEME,
    clearColor: [0.18, 0.08, 0.06, 1.0],
    mainColor: [0.96, 0.54, 0.34, 1.0],
    accentColor: [1.0, 0.86, 0.50, 1.0]
  },
  {
    id: "forest",
    keyLabel: "4",
    label: "Forest",
    note: "green / cyan accent",
    lead: "cool green preset で dark base のまま別系統の雰囲気へ切り替わるかを確認する",
    uiTheme: DEFAULT_UI_FOREST_THEME,
    clearColor: [0.04, 0.12, 0.11, 1.0],
    mainColor: [0.34, 0.84, 0.72, 1.0],
    accentColor: [0.84, 0.95, 0.56, 1.0]
  }
];

let app = null;
let orbit = null;
let mainShape = null;
let accentShape = null;
let mainNode = null;
let accentNode = null;
let ui = null;
let currentThemeIndex = 0;
let previewPanelVisible = true;
let paused = false;

document.addEventListener("DOMContentLoaded", () => {
  start().catch((err) => {
    app?.setDiagnosticsReport?.(Diagnostics.createErrorReport(err, {
      system: "theme",
      source: "unittest/theme/main.js",
      stage: app?.getDiagnosticsReport?.()?.stage ?? "start"
    }));
    console.error("theme unittest failed:", err);
    app?.showErrorPanel?.(err, {
      title: "theme unittest failed",
      id: "start-error"
    });
  });
}, false);

function buildThemeOverlay() {
  app.showOverlayPanel({
    id: "theme-controls",
    title: "UI Theme Switch Test",
    lines: ["initializing..."],
    anchor: "top-left",
    width: "min(470px, calc(100vw - 32px))",
    buttons: [
      { id: "next", label: "Next Theme", kind: "primary" },
      { id: "togglePreview", label: "Preview Panel", kind: "secondary" },
      { id: "resetCamera", label: "Reset Camera", kind: "secondary" }
    ],
    choices: THEME_PRESETS.map((preset) => ({
      id: preset.id,
      label: `[${preset.keyLabel}] ${preset.label}`
    })),
    onAction: ({ actionId }) => {
      if (actionId === "next") {
        applyThemePreset(currentThemeIndex + 1);
        return;
      }
      if (actionId === "togglePreview") {
        setPreviewPanelVisible(!previewPanelVisible);
        return;
      }
      if (actionId === "resetCamera") {
        resetCamera();
        return;
      }
      const presetIndex = THEME_PRESETS.findIndex((preset) => preset.id === actionId);
      if (presetIndex >= 0) {
        applyThemePreset(presetIndex);
      }
    }
  });
  app.showOverlayPanel({
    id: "theme-info",
    title: "Theme Overview",
    lines: ["loading..."],
    anchor: "top-right",
    width: "min(420px, calc(100vw - 32px))"
  });
  return {
    controlsId: "theme-controls",
    infoId: "theme-info"
  };
}

function updateShapeColors(preset) {
  // theme 切替に連動して 3D 側の見え方も少し変え、
  // 半透明 panel 越しに scene を見たときの印象差も一度に確認できるようにする
  mainShape.setMaterial("smooth-shader", {
    has_bone: 0,
    use_texture: 0,
    color: preset.mainColor,
    ambient: 0.26,
    specular: 0.86,
    power: 44.0
  });
  accentShape.setMaterial("smooth-shader", {
    has_bone: 0,
    use_texture: 0,
    color: preset.accentColor,
    ambient: 0.20,
    specular: 0.76,
    power: 34.0
  });
  app.clearColor = [...preset.clearColor];
  app.screen.setClearColor(app.clearColor);
}

function buildOverviewText(preset) {
  return [
    `preset=${preset.id}`,
    `lead=${preset.lead}`,
    `previewPanel=${previewPanelVisible ? "ON" : "OFF"} paused=${paused ? "ON" : "OFF"}`,
    `clear=${preset.clearColor.map((value) => value.toFixed(2)).join(", ")}`,
    `dockBg=${app.uiTheme.debugDock.rootBackground}`,
    `overlayBg=${app.uiTheme.uiPanel.panelBackground}`,
    `errorBg=${app.uiTheme.fixedFormatPanel.errorBackground}`
  ].join("\n");
}

function buildBindingText() {
  const prefix = app?.getDebugKeyPrefixLabel?.() ?? "F9";
  return [
    `[1]-[4] select preset`,
    `[n] next preset  [p] preview panel`,
    `[space] pause rotation  [r] reset camera`,
    `Drag / Arrow orbit camera  [ / ] / wheel zoom`,
    `[${prefix}] diagnostics / debug mode`
  ].join("\n");
}

function buildPreviewPanelText(preset) {
  return [
    "Theme Preview Panel",
    `preset=${preset.label} (${preset.id})`,
    `debugDock.rootBackground=${app.uiTheme.debugDock.rootBackground}`,
    `uiPanel.panelBackground=${app.uiTheme.uiPanel.panelBackground}`,
    `fixedFormatPanel.errorBackground=${app.uiTheme.fixedFormatPanel.errorBackground}`,
    "Toggle with [p] or the Preview Panel button"
  ].join("\n");
}

function syncPreviewPanel() {
  if (!previewPanelVisible) {
    app.clearFixedFormatPanel(FIXED_PANEL_ID);
    return;
  }
  const preset = THEME_PRESETS[currentThemeIndex];
  app.showFixedFormatPanel(buildPreviewPanelText(preset), {
    id: FIXED_PANEL_ID,
    top: 252,
    left: 16,
    right: app.isDebugDockActive()
      ? app.debugDock.reserveWidth + app.debugDock.gap + 16
      : undefined,
    maxHeight: "28vh",
    padding: 10,
    borderRadius: "12px",
    border: `1px solid ${app.uiTheme.uiPanel.panelBorder}`
  });
}

function setPreviewPanelVisible(visible) {
  previewPanelVisible = visible === true;
  syncPreviewPanel();
  renderUi();
}

function applyThemePreset(nextIndex) {
  currentThemeIndex = (nextIndex + THEME_PRESETS.length) % THEME_PRESETS.length;
  const preset = THEME_PRESETS[currentThemeIndex];

  app.setUiTheme(preset.uiTheme);
  updateShapeColors(preset);
  setPreviewPanelVisible(previewPanelVisible);
  renderUi();
}

function renderUi() {
  if (!ui || !app) return;
  const preset = THEME_PRESETS[currentThemeIndex];
  syncPreviewPanel();
  app.updateOverlayPanel(ui.controlsId, {
    title: `UI Theme Switch Test / ${preset.label}`,
    lines: [
      preset.lead,
      "",
      buildBindingText(),
      "",
      `previewPanel=${previewPanelVisible ? "ON" : "OFF"} paused=${paused ? "ON" : "OFF"}`
    ],
    buttons: [
      { id: "next", label: "Next Theme", kind: "primary" },
      { id: "togglePreview", label: previewPanelVisible ? "Hide Preview Panel" : "Show Preview Panel", kind: "secondary" },
      { id: "resetCamera", label: "Reset Camera", kind: "secondary" }
    ]
  });
  app.updateOverlayPanel(ui.infoId, {
    title: `${preset.label} theme`,
    lines: [
      buildOverviewText(preset),
      "",
      "Bindings",
      buildBindingText()
    ]
  });
}

function buildDockRows(preset, envReport, frameCount) {
  const lines = [
    "theme unittest",
    `preset=${preset.label} (${preset.id})`,
    `frame=${frameCount} paused=${paused ? "ON" : "OFF"} panel=${previewPanelVisible ? "ON" : "OFF"}`,
    `yaw=${orbit.orbit.yaw.toFixed(1)} pitch=${orbit.orbit.pitch.toFixed(1)} dist=${orbit.orbit.distance.toFixed(1)}`,
    `dockBg=${app.uiTheme.debugDock.rootBackground}`,
    `overlayBg=${app.uiTheme.uiPanel.panelBackground}`,
    `errorBg=${app.uiTheme.fixedFormatPanel.errorBackground}`,
    `env=${envReport.ok ? "OK" : "WARN"} ${envReport.warnings?.[0] ?? ""}`.trim(),
    app.getDiagnosticsStatusLine(),
    app.getProbeStatusLine()
  ].filter(Boolean);
  return app.makeTextControlRows(lines);
}

function refreshDiagnostics(frameCount) {
  const preset = THEME_PRESETS[currentThemeIndex];
  const envReport = app.checkEnvironment({
    stage: "runtime-check",
    shapes: [mainShape, accentShape]
  });
  app.mergeDiagnosticsStats({
    frameCount,
    themeId: preset.id,
    themeLabel: preset.label,
    paused: paused ? "yes" : "no",
    previewPanel: previewPanelVisible ? "yes" : "no",
    orbitYaw: orbit.orbit.yaw.toFixed(2),
    orbitPitch: orbit.orbit.pitch.toFixed(2),
    orbitDistance: orbit.orbit.distance.toFixed(2),
    envOk: envReport.ok ? "yes" : "no",
    envWarning: envReport.warnings?.[0] ?? "-"
  });
  return envReport;
}

function makeProbeReport(frameCount) {
  const preset = THEME_PRESETS[currentThemeIndex];
  const envReport = app.checkEnvironment({
    stage: "runtime-probe",
    shapes: [mainShape, accentShape]
  });
  const report = app.createProbeReport("runtime-probe");
  Diagnostics.addDetail(report, `theme=${preset.id}`);
  Diagnostics.addDetail(report, `previewPanel=${previewPanelVisible ? "yes" : "no"}`);
  Diagnostics.addDetail(report, `paused=${paused ? "yes" : "no"}`);
  Diagnostics.addDetail(report, `dockBg=${app.uiTheme.debugDock.rootBackground}`);
  Diagnostics.addDetail(report, `overlayBg=${app.uiTheme.uiPanel.panelBackground}`);
  Diagnostics.addDetail(report, `fixedBg=${app.uiTheme.fixedFormatPanel.errorBackground}`);
  if (envReport.warnings?.length) {
    Diagnostics.addDetail(report, `envWarning=${envReport.warnings[0]}`);
  }
  Diagnostics.mergeStats(report, {
    frameCount,
    themeId: preset.id,
    envOk: envReport.ok ? "yes" : "no"
  });
  return report;
}

function resetCamera() {
  orbit.setAngles(28.0, -14.0);
  orbit.setDistance(30.0);
}

function bindUiEvents() {
}

async function start() {
  app = new WebgApp({
    document,
    clearColor: [...THEME_PRESETS[0].clearColor],
    lightPosition: [180.0, 210.0, 240.0, 1.0],
    viewAngle: 53.0,
    messageFontTexture: "../../webg/font512.png",
    uiTheme: DEFAULT_UI_THEME,
    debugOverlay: {
      title: "theme unittest",
      y: 18
    },
    debugTools: {
      mode: "release",
      system: "theme",
      source: "unittest/theme/main.js",
      probeDefaultAfterFrames: 1
    },
    camera: {
      target: [0.0, 0.0, 0.0],
      distance: 30.0,
      yaw: 28.0,
      pitch: -14.0
    }
  });
  await app.init();
  ui = buildThemeOverlay();
  app.setDiagnosticsStage("runtime");
  app.clearHudRows();

  orbit = app.createOrbitEyeRig({
    target: [0.0, 0.0, 0.0],
    distance: 30.0,
    yaw: 28.0,
    pitch: -14.0,
    minDistance: 14.0,
    maxDistance: 70.0,
    wheelZoomStep: 1.4
  });

  // 3D 側は cube 2 個だけに絞り、
  // theme 切替で UI が変わる様子と scene が透けて見える様子を最短で見比べられる構成にする
  mainShape = new Shape(app.getGL());
  mainShape.applyPrimitiveAsset(Primitive.cube(11.0, mainShape.getPrimitiveOptions()));
  mainShape.endShape();

  accentShape = new Shape(app.getGL());
  accentShape.applyPrimitiveAsset(Primitive.cube(5.0, accentShape.getPrimitiveOptions()));
  accentShape.endShape();

  mainNode = app.space.addNode(null, "theme_main_cube");
  mainNode.addShape(mainShape);

  accentNode = app.space.addNode(null, "theme_accent_cube");
  accentNode.addShape(accentShape);
  accentNode.setPosition(10.0, 8.0, -6.0);

  app.configureDiagnosticsCapture({
    labelPrefix: "theme",
    collect: () => makeProbeReport(app.screen.getFrameCount()),
    onCaptured: () => renderUi()
  });
  app.configureDebugKeyInput();

  app.attachInput({
    onKeyDown: (key, ev) => {
      if (ev.repeat) return;
      const lowerKey = String(key ?? ev?.key ?? "").toLowerCase();
      if (lowerKey === "1" || lowerKey === "2" || lowerKey === "3" || lowerKey === "4") {
        applyThemePreset(Number(lowerKey) - 1);
      } else if (lowerKey === "n") {
        applyThemePreset(currentThemeIndex + 1);
      } else if (lowerKey === "p") {
        setPreviewPanelVisible(!previewPanelVisible);
      } else if (lowerKey === "r") {
        resetCamera();
      } else if (lowerKey === " ") {
        paused = !paused;
        renderUi();
      }
    }
  });

  applyThemePreset(0);

  app.start({
    onUpdate: ({ deltaSec, screen }) => {
      const preset = THEME_PRESETS[currentThemeIndex];
      orbit.update(deltaSec);

      if (!paused) {
        mainNode.rotateX(14.0 * deltaSec);
        mainNode.rotateY(26.0 * deltaSec);
        accentNode.rotateY(-48.0 * deltaSec);
        accentNode.rotateZ(22.0 * deltaSec);
      }

      const envReport = refreshDiagnostics(screen.getFrameCount());
      app.updateDebugProbe();
      app.setDebugDockRows(buildDockRows(preset, envReport, screen.getFrameCount()));
      renderUi();
    }
  });
}
