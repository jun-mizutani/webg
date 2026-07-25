// ---------------------------------------------
// samples/axis/main.js  2026/07/25
//   axis sample
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import WebgApp from "../../webg/WebgApp.js";
import { buildErrorPanelOptions, buildHelpPanelOptions } from "../../webg/OverlayPanelPresets.js";
import CommandPalette, {
  getDefaultCommandPaletteCss
} from "../../webg/CommandPalette.js";
import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";
import FullscreenPass from "../../webg/FullscreenPass.js";
import Diagnostics from "../../webg/Diagnostics.js";
import DofPass from "../../webg/DofPass.js?v=20260702_stage_width";

// webgクラスの役割:
// WebgApp   : Screen / Shader / Space / Input / Message / debug dock の初期化をまとめる
// EyeRig    : orbit camera と keyboard / pointer 入力をまとめる
// Primitive : 軸の矢印や基準物体の形状を作る
// Shape     : メッシュと材質設定を保持する

const FONT_FILE = "../../webg/font512.png";
const DEFAULT_VIEW_ANGLE = 45.0;
const MIN_VIEW_ANGLE = 25.0;
const MAX_VIEW_ANGLE = 80.0;
const VIEW_ANGLE_STEP = 1.0;
const AXIS_LENGTH = 10.0;
const FOG_SETTINGS = {
  color: [0.95, 0.955, 0.96, 1.0],
  near: 30.0,
  far: 88.0,
  density: 0.014,
  mode: 1.0
};
const DOF_SETTINGS = {
  focusDistance: 31.0,
  // focusRange は最大blurまでの距離ではなく、scene -> small など 1 stage 分の距離幅
  focusRange: 7.0,
  maxBlurMix: 0.92,
  sharpnessWidth: 0.35,
  sharpnessPower: 1.0,
  blurScale: 1.0,
  stageBlurIterations: {
    small: 1,
    medium: 2,
    large: 4
  },
  blurRadius: 2.0,
  stagedStageCount: 3
};
const ORBIT_DEFAULT = {
  target: [0.0, 0.0, 0.0],
  distance: 30.0,
  yaw: 28.0,
  pitch: -18.0,
  minDistance: 12.0,
  maxDistance: 80.0,
  wheelZoomStep: 1.4
};
let app = null;
let orbit = null;
let dof = null;
let debugPass = null;
let palette = null;
let lastHelpText = "";

const HELP_LINES = [
  "red = X   green = Y   blue = Z",
  "small sphere marks the world center",
  "bright pyramids express depth and perspective",
  "white background and fog make depth easier to read",
  "CommandPalette: double tap canvas or press /",
  "drag or arrow keys: orbit camera",
  "wheel / [ / ]: camera distance",
  "Use palette controls to inspect fog and DOF"
];

const AXIS_PANEL_STYLE = {
  color: "#f5f8fb",
  background: "rgba(11, 16, 24, 0.90)",
  border: "1px solid rgba(12, 20, 30, 0.72)",
  boxShadow: "0 18px 34px rgba(0, 0, 0, 0.24)",
  bodyBackground: "transparent",
  bodyPadding: "10px 12px",
  bodyBorderRadius: "8px"
};

const AXIS_PALETTE_THEME = {
  line: "rgba(248, 250, 252, 0.30)",
  ink: "#f7fafc",
  sub: "rgba(215, 226, 236, 0.92)",
  panel: "rgba(9, 14, 21, 0.94)",
  button: "rgba(24, 34, 45, 0.92)",
  buttonActive: "rgba(16, 96, 72, 0.96)",
  accent: "#ffd166"
};

const AXIS_PALETTE_CSS = `${getDefaultCommandPaletteCss()}
.command-palette.surface {
  border-color: rgba(248, 250, 252, 0.34);
  background: var(--command-palette-panel);
  box-shadow: 0 22px 42px rgba(0, 0, 0, 0.34);
}
.palette-button,
.palette-control-button,
.palette-select-button {
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.55);
}
.palette-row-input {
  background: rgba(2, 6, 12, 0.90);
}
`;

const state = {
  viewAngle: DEFAULT_VIEW_ANGLE,
  fogEnabled: true,
  dofEnabled: false,
  dofView: "composite",
  focusRange: DOF_SETTINGS.focusRange,
  sharpnessWidth: DOF_SETTINGS.sharpnessWidth,
  sharpnessPower: DOF_SETTINGS.sharpnessPower
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// `arrow`の形状を生成し、後続処理で利用できる状態にする
const createArrowShape = (gpu, length, color) => {
  // 軸表示で見分けやすいよう、細長い矢印プリミティブを色付きで作る
  const shape = new Shape(gpu);
  shape.applyPrimitiveAsset(Primitive.arrow(length, length / 8.0, length / 45.0, 12, shape.getPrimitiveOptions()));
  shape.endShape();
  shape.setMaterial("smooth-shader", {
    has_bone: 0,
    color,
    ambient: 0.65,
    specular: 0.16,
    power: 18.0
  });
  return shape;
};

// `origin`の形状を生成し、後続処理で利用できる状態にする
const createOriginShape = (gpu) => {
  // 原点の位置だけを読むための小さな球を置く
  const shape = new Shape(gpu);
  shape.applyPrimitiveAsset(Primitive.sphere(0.85, 16, 16, shape.getPrimitiveOptions()));
  shape.endShape();
  shape.setMaterial("smooth-shader", {
    has_bone: 0,
    use_texture: 0,
    color: [0.92, 0.92, 0.96, 1.0],
    ambient: 0.30,
    specular: 1.00,
    power: 52.0
  });
  return shape;
};

// `pyramid`の形状を生成し、後続処理で利用できる状態にする
const createPyramidShape = (gpu, color) => {
  // 床の代わりに置く小さな四角錐を作り、遠近感の見え方を強める
  // はっきりした色を付けて、fog / DOF が掛かったときの差も見えやすくする
  const shape = new Shape(gpu);
  shape.applyPrimitiveAsset(Primitive.cone(2.4, 1.2, 4, shape.getPrimitiveOptions()));
  shape.endShape();
  shape.setMaterial("smooth-shader", {
    has_bone: 0,
    use_texture: 0,
    color,
    ambient: 0.40,
    specular: 0.26,
    power: 26.0
  });
  return shape;
};

// `pyramid`の色を生成し、後続処理で利用できる状態にする
const makePyramidColor = (rowIndex, colIndex) => {
  const palette = [
    [1.00, 0.30, 0.34, 1.0],
    [1.00, 0.58, 0.20, 1.0],
    [0.98, 0.86, 0.22, 1.0],
    [0.30, 0.96, 0.48, 1.0],
    [0.28, 0.78, 1.00, 1.0],
    [0.62, 0.48, 1.00, 1.0]
  ];
  const base = palette[rowIndex % palette.length];
  const lift = (colIndex - 3) * 0.028;
  return [
    clamp(base[0] + lift, 0.0, 1.0),
    clamp(base[1] + lift * 0.55, 0.0, 1.0),
    clamp(base[2] - lift * 0.30, 0.0, 1.0),
    1.0
  ];
};

// `axis`のノードを生成し、後続処理で利用できる状態にする
const createAxisNode = (space, gpu, length) => {
  // X / Y / Z の 3 本を同じ原点から出すことで座標系を見比べやすくする
  const base = space.addNode(null, "axis-base");
  const nodeX = space.addNode(base, "X");
  const nodeY = space.addNode(base, "Y");
  const nodeZ = space.addNode(base, "Z");

  nodeX.addShape(createArrowShape(gpu, length, [1.0, 0.0, 0.0, 1.0]));
  nodeY.addShape(createArrowShape(gpu, length, [0.0, 0.80, 0.0, 1.0]));
  nodeZ.addShape(createArrowShape(gpu, length, [0.0, 0.0, 1.0, 1.0]));

  nodeX.setAttitude(0.0, 0.0, -90.0);
  nodeZ.setAttitude(0.0, 90.0, 0.0);
  return base;
};

// ヘルプの行を生成し、後続処理で利用できる状態にする
const buildHelpLines = () => {
  app.eye?.setWorldMatrix?.();
  const camera = orbit?.orbit ?? {};
  const eyePos = app.eye?.getWorldPosition?.() ?? [0.0, 0.0, 0.0];
  const focusDistance = Math.hypot(eyePos[0], eyePos[1], eyePos[2]);
  return [
    ...HELP_LINES,
    "",
    `FOV: ${state.viewAngle.toFixed(1)} deg / fog: ${state.fogEnabled ? "ON" : "OFF"} / DOF: ${state.dofEnabled ? "ON" : "OFF"}`,
    `DOF view: ${state.dofView} / focus ${focusDistance.toFixed(1)} / range ${state.focusRange.toFixed(1)}`,
    `Sharpness: width ${state.sharpnessWidth.toFixed(2)} / power ${state.sharpnessPower.toFixed(1)} / stages ${dof?.getStagedStageCount?.() ?? "--"}`,
    `Camera: ${eyePos[0].toFixed(1)}, ${eyePos[1].toFixed(1)}, ${eyePos[2].toFixed(1)}`,
    `Orbit: yaw ${Number.isFinite(camera.yaw) ? camera.yaw.toFixed(1) : "0.0"} / pitch ${Number.isFinite(camera.pitch) ? camera.pitch.toFixed(1) : "0.0"}`
  ];
};

// ヘルプのパネルを現在の入力と実行状態に合わせて更新する
const updateHelpPanel = () => {
  const panel = app?.getOverlayPanel?.("axisHelpOverlay");
  if (!panel) return;
  const lines = buildHelpLines();
  const text = lines.join("\n");
  if (text === lastHelpText) return;
  app.updateOverlayPanel("axisHelpOverlay", { lines });
  lastHelpText = text;
};

// 表示の`angle`を対象の状態または描画設定へ反映する
const applyViewAngle = (nextViewAngle) => {
  state.viewAngle = clamp(nextViewAngle, MIN_VIEW_ANGLE, MAX_VIEW_ANGLE);
  app.viewAngle = state.viewAngle;
  app.updateProjection(state.viewAngle);
};

// フォグを対象の状態または描画設定へ反映する
const applyFog = () => {
  app.setFog({
    color: FOG_SETTINGS.color,
    near: FOG_SETTINGS.near,
    far: FOG_SETTINGS.far,
    density: FOG_SETTINGS.density,
    mode: state.fogEnabled ? FOG_SETTINGS.mode : 0.0
  });
};

// 被写界深度を対象の状態または描画設定へ反映する
const applyDof = () => {
  if (!dof) return;
  app.eye?.setWorldMatrix?.();
  const eyePos = app.eye?.getWorldPosition?.() ?? [0.0, 0.0, 0.0];
  const focusDistance = Math.hypot(eyePos[0], eyePos[1], eyePos[2]);
  dof.setEnabled(state.dofEnabled);
  dof.setFocusDistance(focusDistance);
  dof.setFocusRange(state.focusRange);
  dof.setMaxBlurMix(DOF_SETTINGS.maxBlurMix);
  dof.setSharpnessWidth(state.sharpnessWidth);
  dof.setSharpnessPower(state.sharpnessPower);
  dof.setBlurScale(DOF_SETTINGS.blurScale);
  dof.setStageBlurIterations(DOF_SETTINGS.stageBlurIterations);
  dof.setBlurRadius(DOF_SETTINGS.blurRadius);
  dof.setStagedStageCount(DOF_SETTINGS.stagedStageCount);
};

// `nextDofView`は現在状態から対象を選択し、結果を返すまたは選択を切り替える
const nextDofView = () => {
  const order = ["composite", "scene", "depth", "focusMask", "stage", "smallBlur", "mediumBlur", "largeBlur"];
  const current = order.indexOf(state.dofView);
  state.dofView = order[(current + 1) % order.length];
};

// 表示を初期状態へ戻し、前回の状態を残さない
const resetView = () => {
  applyViewAngle(DEFAULT_VIEW_ANGLE);
  state.fogEnabled = true;
  state.dofEnabled = false;
  state.focusRange = DOF_SETTINGS.focusRange;
  state.sharpnessWidth = DOF_SETTINGS.sharpnessWidth;
  state.sharpnessPower = DOF_SETTINGS.sharpnessPower;
  orbit?.setAngles(ORBIT_DEFAULT.yaw, ORBIT_DEFAULT.pitch);
  orbit?.setDistance(ORBIT_DEFAULT.distance);
  applyFog();
  applyDof();
};

// シーンを生成し、後続処理で利用できる状態にする
const buildScene = () => {
  const gpu = app.getGPU();

  createAxisNode(app.space, gpu, AXIS_LENGTH);

  const originNode = app.space.addNode(null, "origin");
  originNode.addShape(createOriginShape(gpu));
  originNode.setPosition(0.0, 0.0, 0.0);

  const pyramidRows = [
    { z: 60.0 },
    { z: 50.0 },
    { z: 40.0 },
    { z: 30.0 },
    { z: 20.0 },
    { z: 10.0 },
    { z: -10.0 },
    { z: -20.0 },
    { z: -30.0 },
    { z: -40.0 },
    { z: -50.0 },
    { z: -60.0 }
  ];
  const pyramidXs = [-27.0, -18.0, -9.0, 0.0, 9.0, 18.0, 27.0];
  for (let rowIndex = 0; rowIndex < pyramidRows.length; rowIndex++) {
    const row = pyramidRows[rowIndex];
    for (let colIndex = 0; colIndex < pyramidXs.length; colIndex++) {
      const node = app.space.addNode(null, `pyramid-${rowIndex}-${colIndex}`);
      node.addShape(createPyramidShape(gpu, makePyramidColor(rowIndex, colIndex)));
      node.setPosition(pyramidXs[colIndex], -3.0, row.z);
    }
  }
};

document.addEventListener("DOMContentLoaded", () => {
  start().catch((err) => {
    app?.setDiagnosticsReport?.(Diagnostics.createErrorReport(err, {
      system: "axis",
      source: "samples/axis/main.js",
      stage: app?.getDiagnosticsReport?.()?.stage ?? "start"
    }));
    if (app?.isConsoleEnabled?.()) {
      console.error("axis failed:", err);
    }
    app?.showOverlayPanel?.(buildErrorPanelOptions(err, {
      title: "axis failed",
      id: "start-error",
      background: "rgba(26, 38, 26, 0.92)"
    }));
  });
});

// このインスタンスの初期化段階で、必要な状態と資源を準備して処理を開始する
const start = async () => {
  // WebgApp に初期化を寄せ、camera / Message / OverlayPanel の共通形をそのまま使う
  app = new WebgApp({
    document,
    autoDrawScene: false,
    clearColor: [0.95, 0.955, 0.96, 1.0],
    messageScale: 0.80,
    projectionFar: 160.0,
    lightPosition: [150.0, 200.0, 220.0, 1.0],
    viewAngle: state.viewAngle,
    messageFontTexture: FONT_FILE,
    debugTools: {
      mode: "release",
      system: "axis",
      source: "samples/axis/main.js",
      probeDefaultAfterFrames: 1
    },
    camera: {
      target: ORBIT_DEFAULT.target,
      distance: ORBIT_DEFAULT.distance,
      yaw: ORBIT_DEFAULT.yaw,
      pitch: ORBIT_DEFAULT.pitch
    }
  });
  await app.init();
  app.setDiagnosticsStage("runtime");
  app.setFog({
    color: FOG_SETTINGS.color,
    near: FOG_SETTINGS.near,
    far: FOG_SETTINGS.far,
    density: FOG_SETTINGS.density,
    mode: FOG_SETTINGS.mode
  });
  // axis sample でも通常 sample の標準形に合わせ、
  // 操作説明と教育用の補足は左上 help panel へまとめる
  app.showOverlayPanel({
    ...buildHelpPanelOptions({
      id: "axisHelpOverlay",
      collapsed: true,
      lines: HELP_LINES,
      ...AXIS_PANEL_STYLE
    }),
    color: AXIS_PANEL_STYLE.color
  });

  orbit = app.createOrbitEyeRig({
    target: ORBIT_DEFAULT.target,
    distance: ORBIT_DEFAULT.distance,
    yaw: ORBIT_DEFAULT.yaw,
    pitch: ORBIT_DEFAULT.pitch,
    minDistance: ORBIT_DEFAULT.minDistance,
    maxDistance: ORBIT_DEFAULT.maxDistance,
    wheelZoomStep: ORBIT_DEFAULT.wheelZoomStep
  });
  dof = new DofPass(app.getGPU(), {
    width: app.screen.getWidth(),
    height: app.screen.getHeight(),
    focusDistance: DOF_SETTINGS.focusDistance,
    focusRange: DOF_SETTINGS.focusRange,
    maxBlurMix: DOF_SETTINGS.maxBlurMix,
    sharpnessWidth: DOF_SETTINGS.sharpnessWidth,
    sharpnessPower: DOF_SETTINGS.sharpnessPower,
    blurScale: DOF_SETTINGS.blurScale,
    stageBlurIterations: DOF_SETTINGS.stageBlurIterations,
    blurRadius: DOF_SETTINGS.blurRadius,
    stagedStageCount: DOF_SETTINGS.stagedStageCount
  });
  await dof.ready;
  debugPass = new FullscreenPass(app.getGPU(), {
    targetFormat: app.getGPU().format
  });
  await debugPass.init();
  applyDof();

  buildScene();
  resetView();

  // 操作変更後の表示と状態を現在の入力と実行状態に合わせて更新する
  const refreshAfterControlChange = () => {
    palette?.render();
    updateHelpPanel();
    app.requestRender();
  };

  // 操作パレットを生成し、後続処理で利用できる状態にする
  const createPalette = () => {
    palette = new CommandPalette({
      document,
      container: document.body,
      viewport: app.screen.canvas,
      title: "Axis DOF",
      className: "command-palette surface",
      pageRows: 5,
      pageRowsByPage: [5, 5],
      closeOnCommand: false,
      onChange: (id, value) => {
        if (id === "fog") {
          state.fogEnabled = value;
          applyFog();
        } else if (id === "dof") {
          state.dofEnabled = value;
          applyDof();
        } else if (id === "view") {
          state.dofView = value;
        } else if (id === "fov") {
          applyViewAngle(value);
        } else if (id === "focus-range") {
          state.focusRange = value;
          applyDof();
        } else if (id === "sharp-width") {
          state.sharpnessWidth = value;
          applyDof();
        } else if (id === "sharp-power") {
          state.sharpnessPower = value;
          applyDof();
        }
        refreshAfterControlChange();
      },
      onCommand: (id) => {
        if (id === "reset") resetView();
        refreshAfterControlChange();
      },
      commands: [
        // 1ページ目
        { type: "toggle", id: "fog", label: "Fog", detail: "on/off", value: () => state.fogEnabled },
        { type: "toggle", id: "dof", label: "DOF", detail: "on/off", value: () => state.dofEnabled },
        null,
        { id: "palette-next", label: "Next", detail: "page", pageSwitch: true },
        { type: "select", id: "view", label: "DOF View", value: () => state.dofView, options: [
          { value: "composite", label: "composite" },
          { value: "scene", label: "scene" },
          { value: "depth", label: "depth" },
          { value: "focusMask", label: "focusMask" },
          { value: "stage", label: "stage" },
          { value: "smallBlur", label: "smallBlur" },
          { value: "mediumBlur", label: "mediumBlur" },
          { value: "largeBlur", label: "largeBlur" }
        ] },
        { type: "stepper", id: "fov", label: "FOV", value: () => state.viewAngle, min: MIN_VIEW_ANGLE, max: MAX_VIEW_ANGLE, step: VIEW_ANGLE_STEP, decimals: 1, input: true },
        { type: "stepper", id: "focus-range", label: "Focus Range", value: () => state.focusRange, min: 0.5, max: 64.0, step: 0.5, decimals: 1, input: true },
        { type: "stepper", id: "sharp-width", label: "Sharp W", value: () => state.sharpnessWidth, min: 0.02, max: 2.0, step: 0.02, decimals: 2, input: true },
        // 2ページ目
        null,
        null,
        null,
        { id: "palette-next", label: "Next", detail: "page", pageSwitch: true },
        { type: "stepper", id: "sharp-power", label: "Sharp P", value: () => state.sharpnessPower, min: 0.5, max: 32.0, step: 0.5, decimals: 1, input: true },
        { id: "reset", label: "Reset", detail: "view" },
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
    palette.setStyle(AXIS_PALETTE_CSS);
    palette.setTheme(AXIS_PALETTE_THEME);
  };

  createPalette();
  refreshAfterControlChange();

  app.attachInput({
    onKeyDown: (key, ev) => {
      if (ev.repeat) return;
      if (key === "r") {
        resetView();
      } else if (key === "-") {
        applyViewAngle(state.viewAngle - VIEW_ANGLE_STEP);
      } else if (key === "=") {
        applyViewAngle(state.viewAngle + VIEW_ANGLE_STEP);
      } else if (key === "f") {
        state.fogEnabled = !state.fogEnabled;
        applyFog();
      } else if (key === "d") {
        state.dofEnabled = !state.dofEnabled;
        applyDof();
      } else if (key === "5") {
        state.focusRange = clamp(state.focusRange - 0.5, 0.5, 64.0);
        applyDof();
      } else if (key === "6") {
        state.focusRange = clamp(state.focusRange + 0.5, 0.5, 64.0);
        applyDof();
      } else if (key === "1") {
        state.sharpnessWidth = clamp(state.sharpnessWidth - 0.02, 0.02, 2.0);
        applyDof();
      } else if (key === "2") {
        state.sharpnessWidth = clamp(state.sharpnessWidth + 0.02, 0.02, 2.0);
        applyDof();
      } else if (key === "3") {
        state.sharpnessPower = clamp(state.sharpnessPower - 0.5, 0.5, 32.0);
        applyDof();
      } else if (key === "4") {
        state.sharpnessPower = clamp(state.sharpnessPower + 0.5, 0.5, 32.0);
        applyDof();
      } else if (key === "v") {
        nextDofView();
      }
    }
  });

  app.start({
    onUpdate: ({ screen }) => {
      applyDof();
      updateHelpPanel();
    },
    onBeforeDraw: ({ renderFrameToken }) => {
      // beginScene() はコア側で寸法変化を判定し、必要な場合だけtargetを再生成する
      // tokenはWebgAppが所有し、sampleはCameraFrameやdepth方式を直接扱わない
      dof?.beginScene(app.screen, app.clearColor, { renderFrameToken });
      // offscreen sceneも同じtokenで描き、DoF depth復元とのcamera snapshot混在を防ぐ
      app.space.draw(renderFrameToken);
    },
    onAfterDraw3d: ({ renderFrameToken }) => {
      dof?.render(app.screen, {
        renderFrameToken,
        clearColor: app.clearColor
      });

      if (state.dofView !== "composite") {
        const debugSource = state.dofView === "scene"
          ? dof.getSceneTarget()
          : state.dofView === "depth"
            ? dof.getDepthDebugTarget()
            : state.dofView === "focusMask"
              ? dof.getFocusDebugTarget()
              : state.dofView === "stage"
                ? dof.getStageDebugTarget()
                : state.dofView === "smallBlur"
                  ? dof.getSmallBlurTarget()
                  : state.dofView === "mediumBlur"
                    ? dof.getMediumBlurTarget()
                    : dof.getLargeBlurTarget();
        app.screen.beginPresentPass({
          clearColor: app.clearColor,
          colorLoadOp: "clear"
        });
        debugPass.draw(debugSource);
      }

      app.screen.clearDepthBuffer();
    }
  });
};
