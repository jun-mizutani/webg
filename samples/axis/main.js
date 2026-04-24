// -------------------------------------------------
// axis sample
//   main.js       2026/04/12
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// -------------------------------------------------

import WebgApp from "../../webg/WebgApp.js";
import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";
import FullscreenPass from "../../webg/FullscreenPass.js";
import Diagnostics from "../../webg/Diagnostics.js";
import DofPass from "../../webg/DofPass.js";

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
  focusRange: 8.0,
  maxBlurMix: 0.92,
  sharpnessWidth: 0.2,
  sharpnessPower: 8.0,
  blurScale: 0.55,
  blurIterations: 2,
  blurRadius: 4.0
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
const HUD_ROW_OPTIONS = {
  anchor: "top-left",
  x: 0,
  y: 0,
  color: [0.05, 0.05, 0.06],
  minScale: 0.80
};

let app = null;
let orbit = null;
let dof = null;
let debugPass = null;

const HELP_LINES = [
  "red = X   green = Y   blue = Z",
  "small sphere marks the world center",
  "bright pyramids express depth and perspective",
  "white background and fog make depth easier to read",
  "drag or arrow keys: orbit camera",
  "wheel / [ / ]: camera distance",
  "[-] / [=]: fov",
  "[f] fog on/off",
  "[d] dof on/off",
  "[5] / [6] focus range -/+",
  "[1] / [2] sharpness width -/+",
  "[3] / [4] sharpness power -/+",
  "[v] dof debug view",
  "[r] reset camera / fov / fog / dof"
];

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

const buildControlRows = () => {
  app.eye?.setWorldMatrix?.();
  const camera = orbit?.orbit ?? {};
  const eyePos = app.eye?.getWorldPosition?.() ?? [0.0, 0.0, 0.0];
  const focusDistance = Math.hypot(eyePos[0], eyePos[1], eyePos[2]);
  return [
    { label: "Camera", value: "orbit", note: "drag / wheel / arrows" },
    {
      label: "FOV",
      value: `${state.viewAngle.toFixed(1)} deg`,
      decKey: "-",
      decAction: "-1",
      incKey: "=",
      incAction: "+1"
    },
    {
      label: "Camera World",
      value: `${eyePos[0].toFixed(1)}, ${eyePos[1].toFixed(1)}, ${eyePos[2].toFixed(1)}`
    },
    {
      label: "Fog",
      value: state.fogEnabled ? "on" : "off",
      keys: [{ key: "F" }]
    },
    {
      label: "DOF",
      value: state.dofEnabled ? "on" : "off",
      keys: [{ key: "D" }]
    },
    {
      label: "Sharp W",
      value: state.sharpnessWidth.toFixed(2),
      decKey: "1",
      incKey: "2",
      note: "focus curve width"
    },
    {
      label: "Sharp P",
      value: state.sharpnessPower.toFixed(1),
      decKey: "3",
      incKey: "4",
      note: "focus curve power"
    },
    {
      label: "View",
      value: state.dofView,
      keys: [{ key: "V" }]
    },
    {
      label: "Focus",
      value: `${focusDistance.toFixed(1)} / ${state.focusRange.toFixed(1)}`,
      decKey: "5",
      incKey: "6",
      note: "origin / range"
    },
    {
      label: "Zoom",
      value: Number.isFinite(camera.distance) ? camera.distance.toFixed(1) : "-",
      note: "[ / ] / wheel"
    },
    {
      label: "Orbit",
      value: `yaw ${Number.isFinite(camera.yaw) ? camera.yaw.toFixed(1) : "0.0"} pitch ${Number.isFinite(camera.pitch) ? camera.pitch.toFixed(1) : "0.0"}`
    },
    {
      label: "Projection",
      value: "perspective",
      note: "WebgApp.updateProjection()"
    },
    {
      label: "Reset",
      value: "ready",
      key: "R",
      action: "reset all"
    }
  ];
};

const applyViewAngle = (nextViewAngle) => {
  state.viewAngle = clamp(nextViewAngle, MIN_VIEW_ANGLE, MAX_VIEW_ANGLE);
  app.viewAngle = state.viewAngle;
  app.updateProjection(state.viewAngle);
};

const applyFog = () => {
  app.setFog({
    color: FOG_SETTINGS.color,
    near: FOG_SETTINGS.near,
    far: FOG_SETTINGS.far,
    density: FOG_SETTINGS.density,
    mode: state.fogEnabled ? FOG_SETTINGS.mode : 0.0
  });
};

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
  dof.setBlurIterations(DOF_SETTINGS.blurIterations);
  dof.setBlurRadius(DOF_SETTINGS.blurRadius);
  dof.setProjectionRange(app.projectionNear, app.projectionFar);
};

const nextDofView = () => {
  const order = ["composite", "scene", "depth", "focusMask", "blurA", "blurB"];
  const current = order.indexOf(state.dofView);
  state.dofView = order[(current + 1) % order.length];
};

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

const buildScene = () => {
  const gl = app.getGL();

  createAxisNode(app.space, gl, AXIS_LENGTH);

  const originNode = app.space.addNode(null, "origin");
  originNode.addShape(createOriginShape(gl));
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
      node.addShape(createPyramidShape(gl, makePyramidColor(rowIndex, colIndex)));
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
    app?.showErrorPanel?.(err, {
      title: "axis failed",
      id: "start-error",
      background: "rgba(26, 38, 26, 0.92)"
    });
  });
});

const start = async () => {
  // WebgApp に初期化を寄せ、camera / Message / HUD の共通形をそのまま使う
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
      mode: "debug",
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
  app.createHelpPanel({
    id: "axisHelpOverlay",
    lines: HELP_LINES
  });

  orbit = app.createOrbitEyeRig({
    target: ORBIT_DEFAULT.target,
    distance: ORBIT_DEFAULT.distance,
    head: ORBIT_DEFAULT.yaw,
    pitch: ORBIT_DEFAULT.pitch,
    minDistance: ORBIT_DEFAULT.minDistance,
    maxDistance: ORBIT_DEFAULT.maxDistance,
    wheelZoomStep: ORBIT_DEFAULT.wheelZoomStep
  });
  dof = new DofPass(app.getGL(), {
    width: app.screen.getWidth(),
    height: app.screen.getHeight(),
    projectionNear: app.projectionNear,
    projectionFar: app.projectionFar,
    focusDistance: DOF_SETTINGS.focusDistance,
    focusRange: DOF_SETTINGS.focusRange,
    maxBlurMix: DOF_SETTINGS.maxBlurMix,
    blurScale: DOF_SETTINGS.blurScale,
    blurIterations: DOF_SETTINGS.blurIterations,
    blurRadius: DOF_SETTINGS.blurRadius
  });
  await dof.ready;
  debugPass = new FullscreenPass(app.getGL(), {
    targetFormat: app.getGL().format
  });
  await debugPass.init();
  applyDof();

  buildScene();
  resetView();

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
    onUpdate: ({ deltaSec, screen }) => {
      orbit.update(deltaSec);
      applyDof();
      dof?.resizeToScreen(screen);
      app.setControlRows(buildControlRows(), HUD_ROW_OPTIONS);
    },
    onBeforeDraw: () => {
      dof?.beginScene(app.screen, app.clearColor);
      app.space.draw(app.eye);
    },
    onAfterDraw3d: () => {
      dof?.render(app.screen, {
        clearColor: app.clearColor
      });

      if (state.dofView !== "composite") {
        const debugSource = state.dofView === "scene"
          ? dof.getSceneTarget()
          : state.dofView === "depth"
            ? dof.getDepthDebugTarget()
            : state.dofView === "focusMask"
              ? dof.getFocusDebugTarget()
              : state.dofView === "blurA"
                ? dof.getBlurTargetA()
                : dof.getBlurTargetB();
        app.screen.beginPass({
          clearColor: app.clearColor,
          colorLoadOp: "clear",
          depthView: null
        });
        debugPass.draw(debugSource);
      }

      app.screen.clearDepthBuffer();
    }
  });
};
