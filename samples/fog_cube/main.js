// -------------------------------------------------
// fog_cube sample
//   main.js       2026/04/12
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// -------------------------------------------------

import WebgApp from "../../webg/WebgApp.js";
import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";
import Diagnostics from "../../webg/Diagnostics.js";

// fog_cube の役割:
// - shader 側 fog の mode / near / far / density / color を 1 つの sample で確認する
// - `WebgApp` の起動補助、HUD、入力、camera rig を組み合わせた fog 調整例として使う
// - 近距離から遠距離へ並ぶ複数 object に同じ fog を掛け、減衰の変化を見やすくする

const GUIDE_LINES = [
  "Drag or Arrow keys: orbit camera",
  "[ / ] or wheel: zoom",
  "[1] off  [2] linear  [3] exp fog",
  "[q]/[w] near -/+  [a]/[s] far -/+",
  "[z]/[x] density -/+  [c] fog color",
  "[space] pause motion  [r] reset view and fog"
];

const FOG_PRESETS = [
  { label: "night-blue", color: [0.06, 0.09, 0.15, 1.0], clearColor: [0.06, 0.09, 0.15, 1.0] },
  { label: "mist-white", color: [0.86, 0.88, 0.92, 1.0], clearColor: [0.86, 0.88, 0.92, 1.0] },
  { label: "warm-gray", color: [0.18, 0.16, 0.14, 1.0], clearColor: [0.18, 0.16, 0.14, 1.0] },
  { label: "mint", color: [0.08, 0.16, 0.14, 1.0], clearColor: [0.08, 0.16, 0.14, 1.0] },
  { label: "sunset", color: [0.22, 0.13, 0.12, 1.0], clearColor: [0.22, 0.13, 0.12, 1.0] }
];

const DEFAULT_CAMERA = {
  target: [0.0, 10.0, -72.0],
  distance: 120.0,
  yaw: 14.0,
  pitch: -10.0
};

const DEFAULT_FOG = {
  mode: 1.0,
  near: 28.0,
  far: 132.0,
  density: 0.018,
  presetIndex: 0
};

let app = null;

document.addEventListener("DOMContentLoaded", () => {
  start().catch((err) => {
    app?.setDiagnosticsReport?.(Diagnostics.createErrorReport(err, {
      system: "fog_cube",
      source: "samples/fog_cube/main.js",
      stage: app?.getDiagnosticsReport?.()?.stage ?? "start"
    }));
    if (app?.isConsoleEnabled?.()) {
      console.error("fog_cube failed:", err);
    }
    app?.showErrorPanel?.(err, {
      title: "fog_cube failed",
      id: "start-error",
      background: "rgba(30, 42, 28, 0.92)"
    });
  });
});

function createMaterial(color, ambient, specular, power) {
  return {
    use_texture: 0,
    color,
    ambient,
    specular,
    power,
    emissive: 0.0
  };
}

function createPrimitiveNode(app, name, asset, material, position, attitude = [0.0, 0.0, 0.0]) {
  // Primitive が返す ModelAsset を Shape に流し込み、1 node へまとめる
  const shape = new Shape(app.getGL());
  shape.applyPrimitiveAsset(asset);
  shape.endShape();
  shape.setMaterial("smooth-shader", {
    has_bone: 0,
    ...material
  });

  const node = app.space.addNode(null, name);
  node.setPosition(position[0], position[1], position[2]);
  node.setAttitude(attitude[0], attitude[1], attitude[2]);
  node.addShape(shape);
  return node;
}

function createScene(app) {
  // 遠近方向へ object を並べ、fog の減衰を比較しやすい scene を作る
  createPrimitiveNode(
    app,
    "floor",
    Primitive.cuboid(120.0, 2.0, 220.0),
    createMaterial([0.18, 0.20, 0.24, 1.0], 0.20, 0.15, 8.0),
    [0.0, -6.0, -72.0]
  );

  createPrimitiveNode(
    app,
    "backWall",
    Primitive.cuboid(120.0, 34.0, 2.0),
    createMaterial([0.22, 0.24, 0.28, 1.0], 0.18, 0.10, 8.0),
    [0.0, 11.0, -170.0]
  );

  const cubes = [];
  const cubeColors = [
    [1.00, 0.34, 0.32, 1.0],
    [1.00, 0.72, 0.28, 1.0],
    [0.94, 0.92, 0.36, 1.0],
    [0.40, 0.96, 0.48, 1.0],
    [0.38, 0.76, 1.00, 1.0],
    [0.78, 0.44, 1.00, 1.0]
  ];

  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 6; i++) {
      const z = -12.0 - i * 26.0;
      const x = (row - 1) * 18.0 + (i % 2 === 0 ? -2.0 : 2.0);
      const y = 2.0 + row * 9.5;
      const size = 8.0 - row * 1.2;
      const color = cubeColors[(row * 2 + i) % cubeColors.length];
      const node = createPrimitiveNode(
        app,
        `cube_${row}_${i}`,
        Primitive.cube(size),
        createMaterial(color, 0.24, 0.85, 36.0),
        [x, y, z],
        [0.0, i * 18.0, 0.0]
      );
      cubes.push({
        node,
        baseY: y,
        spinX: 8.0 + row * 3.0 + i * 1.1,
        spinY: 16.0 + row * 4.0 + i * 1.7,
        bobPhase: i * 0.7 + row * 0.9
      });
    }
  }

  const pillars = [];
  for (let i = 0; i < 5; i++) {
    const z = -20.0 - i * 36.0;
    pillars.push(createPrimitiveNode(
      app,
      `pillar_left_${i}`,
      Primitive.cuboid(3.2, 20.0 + i * 2.0, 3.2),
      createMaterial([0.28, 0.34, 0.42, 1.0], 0.20, 0.18, 10.0),
      [-30.0, 4.0 + i, z]
    ));
    pillars.push(createPrimitiveNode(
      app,
      `pillar_right_${i}`,
      Primitive.cuboid(3.2, 20.0 + i * 2.0, 3.2),
      createMaterial([0.28, 0.34, 0.42, 1.0], 0.20, 0.18, 10.0),
      [30.0, 4.0 + i, z]
    ));
  }

  return { cubes, pillars };
}

function clampFogState(state) {
  state.near = Math.max(0.0, Math.min(state.near, 240.0));
  state.far = Math.max(state.near + 1.0, Math.min(state.far, 260.0));
  state.density = Math.max(0.0, Math.min(state.density, 0.20));
}

function modeLabel(mode) {
  if (mode < 0.5) return "off";
  if (mode < 1.5) return "linear";
  return "exp";
}

async function start() {
  const initialPreset = FOG_PRESETS[DEFAULT_FOG.presetIndex];
  app = new WebgApp({
    document,
    clearColor: [...initialPreset.clearColor],
    viewAngle: 50.0,
    messageFontTexture: "../../webg/font512.png",
    camera: {
      target: [...DEFAULT_CAMERA.target],
      distance: DEFAULT_CAMERA.distance,
      yaw: DEFAULT_CAMERA.yaw,
      pitch: DEFAULT_CAMERA.pitch
    },
    light: {
      mode: "world-node",
      nodeName: "fogLight",
      position: [90.0, 160.0, 60.0],
      attitude: [0.0, 0.0, 0.0],
      type: 1.0
    },
    fog: {
      color: [...initialPreset.color],
      near: DEFAULT_FOG.near,
      far: DEFAULT_FOG.far,
      density: DEFAULT_FOG.density,
      mode: DEFAULT_FOG.mode
    },
    debugTools: {
      mode: "debug",
      system: "fog_cube",
      source: "samples/fog_cube/main.js",
      guideLines: GUIDE_LINES,
      guideOptions: {
        anchor: "top-left",
        x: 0,
        y: 0,
        width: 40,
        wrap: true
      }
    }
  });
  await app.init();

  const orbit = app.createOrbitEyeRig({
    target: [...DEFAULT_CAMERA.target],
    distance: DEFAULT_CAMERA.distance,
    head: DEFAULT_CAMERA.yaw,
    pitch: DEFAULT_CAMERA.pitch,
    minDistance: 36.0,
    maxDistance: 220.0,
    wheelZoomStep: 2.8
  });
  app.setDiagnosticsStage("runtime");

  const scene = createScene(app);
  const state = {
    paused: false,
    mode: DEFAULT_FOG.mode,
    near: DEFAULT_FOG.near,
    far: DEFAULT_FOG.far,
    density: DEFAULT_FOG.density,
    presetIndex: DEFAULT_FOG.presetIndex
  };

  const applyFog = () => {
    clampFogState(state);
    const preset = FOG_PRESETS[state.presetIndex];
    app.screen.setClearColor(preset.clearColor);
    app.setFog({
      color: preset.color,
      near: state.near,
      far: state.far,
      density: state.density,
      mode: state.mode
    });
  };
  const getSceneShapes = () => {
    const shapes = [];
    const nodes = app?.space?.nodes ?? [];
    for (let i = 0; i < nodes.length; i++) {
      const list = nodes[i]?.shapes ?? [];
      for (let j = 0; j < list.length; j++) {
        shapes.push(list[j]);
      }
    }
    return shapes;
  };
  const refreshDiagnosticsStats = (frameCount = app.screen.getFrameCount()) => {
    const envReport = app.checkEnvironment({
      stage: "runtime-check",
      shapes: getSceneShapes()
    });
    const preset = FOG_PRESETS[state.presetIndex];
    app.mergeDiagnosticsStats({
      frameCount,
      fogMode: modeLabel(state.mode),
      fogNear: state.near.toFixed(2),
      fogFar: state.far.toFixed(2),
      fogDensity: state.density.toFixed(4),
      fogColor: preset.label,
      paused: state.paused ? "yes" : "no",
      cubeCount: scene.cubes.length,
      pillarCount: scene.pillars.length,
      envOk: envReport.ok ? "yes" : "no",
      envWarning: envReport.warnings?.[0] ?? "-"
    });
    return envReport;
  };
  const makeProbeReport = (frameCount) => {
    const envReport = app.checkEnvironment({
      stage: "runtime-probe",
      shapes: getSceneShapes()
    });
    const preset = FOG_PRESETS[state.presetIndex];
    const report = app.createProbeReport("runtime-probe");
    Diagnostics.addDetail(report, `fogMode=${modeLabel(state.mode)}`);
    Diagnostics.addDetail(report, `fogNear=${state.near.toFixed(2)} fogFar=${state.far.toFixed(2)} density=${state.density.toFixed(4)}`);
    Diagnostics.addDetail(report, `fogColor=${preset.label}`);
    if (envReport.warnings?.length) {
      Diagnostics.addDetail(report, `envWarning=${envReport.warnings[0]}`);
    }
    Diagnostics.mergeStats(report, {
      frameCount,
      fogMode: modeLabel(state.mode),
      paused: state.paused ? "yes" : "no",
      cubeCount: scene.cubes.length,
      pillarCount: scene.pillars.length,
      envOk: envReport.ok ? "yes" : "no"
    });
    return report;
  };
  const resetViewAndFog = () => {
    state.paused = false;
    state.mode = DEFAULT_FOG.mode;
    state.near = DEFAULT_FOG.near;
    state.far = DEFAULT_FOG.far;
    state.density = DEFAULT_FOG.density;
    state.presetIndex = DEFAULT_FOG.presetIndex;
    orbit.setTarget(...DEFAULT_CAMERA.target);
    orbit.setAngles(DEFAULT_CAMERA.yaw, DEFAULT_CAMERA.pitch);
    orbit.setDistance(DEFAULT_CAMERA.distance);
    applyFog();
  };

  applyFog();
  app.configureDiagnosticsCapture({
    labelPrefix: "fog_cube",
    collect: () => makeProbeReport(app.screen.getFrameCount())
  });
  app.configureDebugKeyInput();

  app.attachInput({
    onKeyDown: (key, ev) => {
      if (ev.repeat) return;
      if (key === "1") {
        state.mode = 0.0;
      } else if (key === "2") {
        state.mode = 1.0;
      } else if (key === "3") {
        state.mode = 2.0;
      } else if (key === "q") {
        state.near -= 4.0;
      } else if (key === "w") {
        state.near += 4.0;
      } else if (key === "a") {
        state.far -= 6.0;
      } else if (key === "s") {
        state.far += 6.0;
      } else if (key === "z") {
        state.density -= 0.004;
      } else if (key === "x") {
        state.density += 0.004;
      } else if (key === "c") {
        state.presetIndex = (state.presetIndex + 1) % FOG_PRESETS.length;
      } else if (key === " ") {
        state.paused = !state.paused;
      } else if (key === "r") {
        resetViewAndFog();
        return;
      } else {
        return;
      }
      applyFog();
    }
  });

  app.start({
    onUpdate: ({ timeSec, deltaSec, screen }) => {
      orbit.update(deltaSec);

      if (!state.paused) {
        for (let i = 0; i < scene.cubes.length; i++) {
          const cube = scene.cubes[i];
          cube.node.rotateX(cube.spinX * deltaSec);
          cube.node.rotateY(cube.spinY * deltaSec);
          const bob = Math.sin(timeSec * 1.4 + cube.bobPhase) * 1.6;
          cube.node.setPosition(cube.node.position[0], cube.baseY + bob, cube.node.position[2]);
        }
      }

      const preset = FOG_PRESETS[state.presetIndex];
      const envReport = refreshDiagnosticsStats(screen.getFrameCount());
      app.updateDebugProbe();
      const statusLines = [
        `frame=${screen.getFrameCount()}`,
        `mode=${modeLabel(state.mode)} paused=${state.paused ? "yes" : "no"}`,
        `near=${state.near.toFixed(1)} far=${state.far.toFixed(1)}`,
        `density=${state.density.toFixed(3)} color=${preset.label}`,
        `yaw=${orbit.orbit.yaw.toFixed(1)} pitch=${orbit.orbit.pitch.toFixed(1)} dist=${orbit.orbit.distance.toFixed(1)}`,
        `env=${envReport.ok ? "OK" : "WARN"}`,
        app.getDiagnosticsStatusLine(),
        app.isDebugUiEnabled() ? app.getProbeStatusLine() : ""
      ];
      const controlLines = [...GUIDE_LINES, ...app.getDebugKeyGuideLines(), ...statusLines.filter(Boolean)];
      app.setControlRows(app.isDebugUiEnabled() ? app.makeTextControlRows(controlLines) : []);
    }
  });
}
