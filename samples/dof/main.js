// -------------------------------------------------
// dof sample
//   main.js       2026/04/12
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// -------------------------------------------------

import WebgApp from "../../webg/WebgApp.js";
import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";
import DofPass from "../../webg/DofPass.js";
import FullscreenPass from "../../webg/FullscreenPass.js";
import Diagnostics from "../../webg/Diagnostics.js";
import DebugConfig from "../../webg/DebugConfig.js";

// この sample の役割:
// - scene color と depth を使って、focus 面だけ sharp に残す最小の被写界深度を示す
// - `SeparableBlurPass` を bloom 以外でも再利用できることを確認する
// - controls row と diagnostics を使い、focusDistance / focusRange / blur の関係を追いやすくする

const GUIDE_LINES = [
  "Drag or Arrow keys: orbit camera",
  "[ / ] or wheel: zoom",
  "[b] dof on/off",
  "[1]/[2] focus dist -/+",
  "[3]/[4] focus range -/+",
  "[5]/[6] blur radius -/+",
  "[7]/[8] max blur -/+",
  "[q]/[w] blur iter -/+",
  "[u] quality full/half",
  "[v] view composite/scene/depth/focusMask/blurA/blurB",
  "[r] reset dof params"
];

const DOF_DEFAULT = {
  focusDistance: 36.0,
  focusRange: 7.0,
  maxBlurMix: 0.92,
  blurScale: 0.5,
  blurIterations: 2,
  blurRadius: 2.8
};

const HUD_ROW_OPTIONS = {
  anchor: "top-left",
  x: 0,
  y: 0,
  color: [0.90, 0.96, 1.0],
  minScale: 0.80
};


let app = null;

document.addEventListener("DOMContentLoaded", () => {
  start().catch((err) => {
    app?.setDiagnosticsReport?.(Diagnostics.createErrorReport(err, {
      system: "dof",
      source: "samples/dof/main.js",
      stage: app?.getDiagnosticsReport?.()?.stage ?? "start"
    }));
    if (app?.isConsoleEnabled?.()) {
      console.error("dof sample failed:", err);
    }
    app?.showErrorPanel?.(err, {
      title: "dof sample failed",
      id: "start-error",
      background: "rgba(24, 34, 24, 0.92)"
    });
  });
});

function makeMaterial(color, ambient, specular, power) {
  return {
    use_texture: 0,
    color,
    ambient,
    specular,
    power
  };
}

function getBlurQualityLabel(scale) {
  return scale < 0.75 ? "half" : "full";
}

function normalize3(vector) {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (length < 0.000001) {
    return [0.0, 0.0, -1.0];
  }
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

function addScaled3(base, vector, scale) {
  return [
    base[0] + vector[0] * scale,
    base[1] + vector[1] * scale,
    base[2] + vector[2] * scale
  ];
}

function setNodePosition(node, position) {
  node.setPosition(position[0], position[1], position[2]);
}

function makeControlRows(dof, state) {
  return [
    { label: "Camera", value: "orbit", note: "drag / arrow" },
    { label: "Zoom", value: "camera", note: "[ / ] / wheel" },
    { label: "DOF", toggleKey: "B", value: dof.enabled ? "ON" : "OFF" },
    { label: "Focus Dist", decKey: "1", incKey: "2", value: dof.focusDistance.toFixed(1) },
    { label: "Focus Range", decKey: "3", incKey: "4", value: dof.focusRange.toFixed(1) },
    { label: "Blur Radius", decKey: "5", incKey: "6", value: dof.blurRadius.toFixed(2) },
    { label: "Max Blur", decKey: "7", incKey: "8", value: dof.maxBlurMix.toFixed(2) },
    { label: "Blur Iter", decKey: "Q", incKey: "W", value: String(dof.blurIterations) },
    { label: "Quality", cycleKey: "U", value: getBlurQualityLabel(dof.getBlurScale()) },
    { label: "View", cycleKey: "V", value: state.dofView },
    { label: "Reset", key: "R", action: "reset", value: "ready" },
    { label: "Debug", value: DebugConfig.mode, keys: [{ key: "F9" }, { key: "M", action: "mode" }] }
  ];
}

function createSharedSphereSource(app) {
  // dof sample の球は半径だけが違い、segment 数と shader は同じなので、
  // geometry は unit sphere を 1 回だけ作って shared resource として再利用する
  const shape = new Shape(app.getGL());
  shape.applyPrimitiveAsset(Primitive.sphere(1.0, 28, 20, shape.getPrimitiveOptions()));
  shape.endShape();
  return shape;
}

function createDepthSphere(app, sourceShape, name, options) {
  // 色は instance ごとに変えたいが、頂点バッファまでは増やしたくないため、
  // shared sphere resource を参照する instance に材質だけ個別設定する
  const shape = sourceShape.createInstance();
  shape.setMaterial("smooth-shader", {
    has_bone: 0,
    ...makeMaterial(options.color, 0.70, 1.10, 58.0)
  });

  const node = app.space.addNode(null, name);
  node.setPosition(options.x, options.y, options.z);
  node.setScale(options.radius);
  node.addShape(shape);
  return node;
}

function createDepthBand(app, sourceShape, prefix, entries) {
  const nodes = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    nodes.push(createDepthSphere(app, sourceShape, `${prefix}_${i}`, entry));
  }
  return nodes;
}

function createDepthMarker(app, name, options) {
  const shape = new Shape(app.getGL());
  // Primitive には cylinder がまだ無いため、ここでは細い cuboid を marker として使う
  // 役割は「その深度帯に縦の目印を置くこと」なので、形状は単純でも十分に目的を果たせる
  shape.applyPrimitiveAsset(Primitive.cuboid(
    options.radius * 2.0,
    options.height,
    options.radius * 2.0,
    shape.getPrimitiveOptions()
  ));
  shape.endShape();
  shape.setMaterial("smooth-shader", {
    has_bone: 0,
    ...makeMaterial(options.color, 0.30, 0.35, 18.0)
  });

  const node = app.space.addNode(null, name);
  node.setPosition(options.x, options.y, options.z);
  node.addShape(shape);
  return node;
}

function createFocusGuide(app, sourceShape) {
  // focus 面は screen 上の UI だけでなく 3D scene 内にも置き、
  // orbit 中でも「いま sharp にしたい距離」を直感的に見失いにくくする
  return {
    center: createDepthSphere(app, sourceShape, "focusGuideCenter", {
      x: 0.0, y: 0.0, z: 0.0, radius: 0.38, color: [1.0, 0.98, 0.84, 1.0]
    }),
    left: createDepthSphere(app, sourceShape, "focusGuideLeft", {
      x: 0.0, y: 0.0, z: 0.0, radius: 0.18, color: [1.0, 0.62, 0.40, 1.0]
    }),
    right: createDepthSphere(app, sourceShape, "focusGuideRight", {
      x: 0.0, y: 0.0, z: 0.0, radius: 0.18, color: [1.0, 0.62, 0.40, 1.0]
    }),
    up: createDepthSphere(app, sourceShape, "focusGuideUp", {
      x: 0.0, y: 0.0, z: 0.0, radius: 0.18, color: [0.44, 0.88, 1.0, 1.0]
    }),
    down: createDepthSphere(app, sourceShape, "focusGuideDown", {
      x: 0.0, y: 0.0, z: 0.0, radius: 0.18, color: [0.44, 0.88, 1.0, 1.0]
    })
  };
}

function updateFocusGuide(guide, eyePosition, focusTarget, focusDistance, focusRange) {
  // eye から target 方向へ focusDistance だけ進めた位置を中心に置く
  // さらに camera に直交する right / up を作り、十字状の小球で面の位置を見せる
  const forward = normalize3([
    focusTarget[0] - eyePosition[0],
    focusTarget[1] - eyePosition[1],
    focusTarget[2] - eyePosition[2]
  ]);

  let right = cross3([0.0, 1.0, 0.0], forward);
  if (Math.hypot(right[0], right[1], right[2]) < 0.000001) {
    right = cross3([0.0, 0.0, 1.0], forward);
  }
  right = normalize3(right);
  const up = normalize3(cross3(forward, right));

  const center = addScaled3(eyePosition, forward, focusDistance);
  const span = Math.max(0.95, Math.min(2.2, 0.80 + focusRange * 0.10));

  setNodePosition(guide.center, center);
  setNodePosition(guide.left, addScaled3(center, right, -span));
  setNodePosition(guide.right, addScaled3(center, right, span));
  setNodePosition(guide.up, addScaled3(center, up, span));
  setNodePosition(guide.down, addScaled3(center, up, -span));
}

async function start() {
  app = new WebgApp({
    document,
    autoDrawScene: false,
    clearColor: [0.025, 0.035, 0.055, 1.0],
    viewAngle: 52.0,
    projectionFar: 160.0,
    messageFontTexture: "../../webg/font512.png",
    camera: {
      target: [0.0, 0.0, 0.0],
      distance: 36.0,
      yaw: 18.0,
      pitch: -10.0
    },
    light: {
      mode: "world-node",
      nodeName: "worldLight",
      position: [90.0, 140.0, 120.0],
      attitude: [0.0, 0.0, 0.0],
      type: 1.0
    },
    debugTools: {
      mode: "debug",
      system: "dof",
      source: "samples/dof/main.js",
      probeDefaultAfterFrames: 1
    }
  });
  await app.init();
  // dof sample でも bloom と同じ help panel を使い、
  // 操作説明は左上 panel、current value は HUD と diagnostics に分けて読む
  app.createHelpPanel({
    id: "dofHelpOverlay",
    lines: GUIDE_LINES
  });

  const orbit = app.createOrbitEyeRig({
    target: [0.0, 0.0, 0.0],
    distance: 36.0,
    yaw: 18.0,
    pitch: -10.0,
    minDistance: 16.0,
    maxDistance: 88.0,
    wheelZoomStep: 1.3
  });

  const dof = new DofPass(app.getGL(), {
    width: app.screen.getWidth(),
    height: app.screen.getHeight(),
    projectionNear: app.projectionNear,
    projectionFar: app.projectionFar,
    focusDistance: DOF_DEFAULT.focusDistance,
    focusRange: DOF_DEFAULT.focusRange,
    maxBlurMix: DOF_DEFAULT.maxBlurMix,
    blurScale: DOF_DEFAULT.blurScale,
    blurIterations: DOF_DEFAULT.blurIterations,
    blurRadius: DOF_DEFAULT.blurRadius
  });
  await dof.ready;

  const debugPass = new FullscreenPass(app.getGL(), {
    targetFormat: app.getGL().format
  });
  await debugPass.init();

  app.setDiagnosticsStage("runtime");
  const sharedSphereShape = createSharedSphereSource(app);

  createDepthMarker(app, "markerNear", { x: -13.0, y: 0.0, z: 16.0, radius: 0.45, height: 7.5, color: [0.90, 0.36, 0.28, 1.0] });
  createDepthMarker(app, "markerMid", { x: 0.0, y: 0.0, z: 0.0, radius: 0.45, height: 8.5, color: [0.92, 0.84, 0.36, 1.0] });
  createDepthMarker(app, "markerFar", { x: 13.0, y: 0.0, z: -16.0, radius: 0.45, height: 9.5, color: [0.36, 0.82, 1.0, 1.0] });

  const spheres = [
    ...createDepthBand(app, sharedSphereShape, "near", [
      { x: -14.5, y: -1.2, z: 19.0, radius: 1.55, color: [1.0, 0.40, 0.32, 1.0] },
      { x: -8.2, y: 2.3, z: 16.5, radius: 1.25, color: [1.0, 0.58, 0.34, 1.0] },
      { x: -2.0, y: -0.7, z: 13.5, radius: 1.45, color: [1.0, 0.72, 0.38, 1.0] },
      { x: 5.8, y: 1.7, z: 11.0, radius: 1.20, color: [0.96, 0.82, 0.42, 1.0] },
      { x: 12.8, y: -2.0, z: 8.5, radius: 1.60, color: [0.98, 0.66, 0.46, 1.0] }
    ]),
    ...createDepthBand(app, sharedSphereShape, "focus", [
      { x: -12.0, y: 1.2, z: 4.0, radius: 1.35, color: [0.96, 0.92, 0.74, 1.0] },
      { x: -5.0, y: -2.2, z: 1.0, radius: 1.70, color: [0.92, 1.0, 0.72, 1.0] },
      { x: 1.0, y: 0.8, z: -1.5, radius: 1.50, color: [0.78, 1.0, 0.70, 1.0] },
      { x: 7.2, y: 2.0, z: -4.8, radius: 1.25, color: [0.56, 1.0, 0.78, 1.0] },
      { x: 13.0, y: -1.0, z: -7.5, radius: 1.55, color: [0.42, 0.96, 0.82, 1.0] }
    ]),
    ...createDepthBand(app, sharedSphereShape, "far", [
      { x: -13.5, y: -0.8, z: -12.0, radius: 1.35, color: [0.38, 0.84, 1.0, 1.0] },
      { x: -7.0, y: 2.4, z: -15.5, radius: 1.15, color: [0.40, 0.72, 1.0, 1.0] },
      { x: -1.0, y: -1.8, z: -19.0, radius: 1.55, color: [0.52, 0.62, 1.0, 1.0] },
      { x: 6.5, y: 1.2, z: -22.5, radius: 1.30, color: [0.70, 0.54, 1.0, 1.0] },
      { x: 14.0, y: -2.4, z: -26.0, radius: 1.60, color: [0.86, 0.48, 1.0, 1.0] }
    ])
  ];

  const focusGuide = createFocusGuide(app, sharedSphereShape);

  const state = {
    dofView: "composite"
  };

  function getFocusGuideText() {
    const pos = focusGuide.center.getPosition();
    return `(${pos[0].toFixed(1)}, ${pos[1].toFixed(1)}, ${pos[2].toFixed(1)})`;
  }

  function refreshDiagnosticsStats() {
    app.mergeDiagnosticsStats({
      dofEnabled: dof.enabled ? "yes" : "no",
      dofView: state.dofView,
      focusDistance: dof.focusDistance.toFixed(1),
      focusRange: dof.focusRange.toFixed(1),
      maxBlurMix: dof.maxBlurMix.toFixed(2),
      blurScale: dof.getBlurScale().toFixed(2),
      blurQuality: getBlurQualityLabel(dof.getBlurScale()),
      blurIterations: dof.blurIterations,
      blurRadius: dof.blurRadius.toFixed(2),
      focusGuide: getFocusGuideText(),
      sceneTargetWidth: dof.getSceneTarget().getWidth(),
      sceneTargetHeight: dof.getSceneTarget().getHeight(),
      blurTargetWidth: dof.getBlurTargetA()?.getWidth?.() ?? 0,
      blurTargetHeight: dof.getBlurTargetA()?.getHeight?.() ?? 0
    });
  }

  function refreshHudRows() {
    const rows = makeControlRows(dof, state);
    app.setHudRows(app.isDebugUiEnabled() ? rows : [], HUD_ROW_OPTIONS);
  }

  function makeProbeReport(frameCount) {
    const report = app.createProbeReport("runtime-probe");
    Diagnostics.addDetail(report, `view=${state.dofView}`);
    Diagnostics.addDetail(report, `dof=${dof.enabled ? "ON" : "OFF"}`);
    Diagnostics.mergeStats(report, {
      frameCount,
      focusDistance: dof.focusDistance.toFixed(1),
      focusRange: dof.focusRange.toFixed(1),
      maxBlurMix: dof.maxBlurMix.toFixed(2),
      blurScale: dof.getBlurScale().toFixed(2),
      blurQuality: getBlurQualityLabel(dof.getBlurScale()),
      blurIterations: dof.blurIterations,
      blurRadius: dof.blurRadius.toFixed(2),
      focusGuide: getFocusGuideText(),
      sceneTargetWidth: dof.getSceneTarget().getWidth(),
      sceneTargetHeight: dof.getSceneTarget().getHeight(),
      blurTargetWidth: dof.getBlurTargetA()?.getWidth?.() ?? 0,
      blurTargetHeight: dof.getBlurTargetA()?.getHeight?.() ?? 0
    });
    return report;
  }

  const resetDof = () => {
    dof.setEnabled(true);
    dof.setFocusDistance(DOF_DEFAULT.focusDistance);
    dof.setFocusRange(DOF_DEFAULT.focusRange);
    dof.setMaxBlurMix(DOF_DEFAULT.maxBlurMix);
    dof.setBlurScale(DOF_DEFAULT.blurScale);
    dof.setBlurIterations(DOF_DEFAULT.blurIterations);
    dof.setBlurRadius(DOF_DEFAULT.blurRadius);
  };

  app.configureDiagnosticsCapture({
    labelPrefix: "dof",
    collect: () => makeProbeReport(app.screen.getFrameCount())
  });
  app.configureDebugKeyInput();

  app.attachInput({
    onKeyDown: async (key, ev) => {
      if (ev.repeat) return;
      if (key === "b") {
        dof.setEnabled(!dof.enabled);
      } else if (key === "1") {
        dof.setFocusDistance(Math.max(4.0, dof.focusDistance - 1.5));
      } else if (key === "2") {
        dof.setFocusDistance(Math.min(90.0, dof.focusDistance + 1.5));
      } else if (key === "3") {
        dof.setFocusRange(Math.max(1.0, dof.focusRange - 0.8));
      } else if (key === "4") {
        dof.setFocusRange(Math.min(30.0, dof.focusRange + 0.8));
      } else if (key === "5") {
        dof.setBlurRadius(Math.max(0.3, dof.blurRadius - 0.35));
      } else if (key === "6") {
        dof.setBlurRadius(Math.min(5.5, dof.blurRadius + 0.35));
      } else if (key === "7") {
        dof.setMaxBlurMix(Math.max(0.0, dof.maxBlurMix - 0.08));
      } else if (key === "8") {
        dof.setMaxBlurMix(Math.min(1.0, dof.maxBlurMix + 0.08));
      } else if (key === "q") {
        dof.setBlurIterations(Math.max(1, dof.blurIterations - 1));
      } else if (key === "w") {
        dof.setBlurIterations(Math.min(6, dof.blurIterations + 1));
      } else if (key === "u") {
        dof.setBlurScale(dof.getBlurScale() < 0.75 ? 1.0 : 0.5);
      } else if (key === "v") {
        const order = ["composite", "scene", "depth", "focusMask", "blurA", "blurB"];
        const current = order.indexOf(state.dofView);
        state.dofView = order[(current + 1) % order.length];
      } else if (key === "r") {
        resetDof();
      }
    }
  });

  app.start({
    onUpdate: ({ deltaSec, screen }) => {
      orbit.update(deltaSec);
      dof.resizeToScreen(screen);

      // 完全静止だと前後関係が読み取りづらいので、球だけ少しだけ回して
      // specular と輪郭の変化を見やすくする
      for (let i = 0; i < spheres.length; i++) {
        spheres[i].rotateY((5.0 + i) * deltaSec);
      }

      // orbit target と eye の現在位置から focus 面のガイド位置を更新する
      // debug view を見なくても、scene 上で sharp にしたい距離を追いやすくする
      updateFocusGuide(
        focusGuide,
        app.eye.getWorldPosition(),
        orbit.orbit.target,
        dof.focusDistance,
        dof.focusRange
      );

      refreshDiagnosticsStats();
      refreshHudRows();
      app.updateDebugProbe();
    },
    onBeforeDraw: () => {
      dof.beginScene(app.screen, app.clearColor);
      app.space.draw(app.eye);
    },
    onAfterDraw3d: () => {
      dof.render(app.screen, {
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
}
