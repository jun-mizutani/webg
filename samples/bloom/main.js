// -------------------------------------------------
// bloom sample
//   main.js       2026/04/21
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// -------------------------------------------------

import WebgApp from "../../webg/WebgApp.js";
import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";
import BloomPass from "../../webg/BloomPass.js";
import FullscreenPass from "../../webg/FullscreenPass.js";
import Diagnostics from "../../webg/Diagnostics.js";
import DebugConfig from "../../webg/DebugConfig.js";

// bloom sample の役割:
// - offscreen `RenderTarget` に 3D scene を描き、その結果へ `BloomPass` を掛けてから
//   canvas へ戻す最小経路を示す
// - PBR や shadow と独立に、postprocess を別レイヤとして追加できることを確認する
// - `WebgApp` の起動補助を使いつつ、描画本体だけを custom pass へ差し替える例にする

const GUIDE_LINES = [
  "Drag or Arrow keys: orbit camera",
  "[ / ] or wheel: zoom",
  "[b] bloom on/off",
  "[1]/[2] threshold -/+",
  "[3]/[4] strength -/+",
  "[5]/[6] blur iter -/+",
  "[7]/[8] blur radius -/+",
  "[q]/[w] soft knee -/+",
  "[a]/[s] extract -/+",
  "[t]/[y] exposure -/+",
  "[g] tone map off/reinhard/aces",
  "[u] quality full/half",
  "[v] view composite/scene/extract/extractHeat/blurA/blurB",
  "[space] pause",
  "[r] reset bloom params"
];

const BLOOM_DEFAULT = {
  threshold: 0.58,
  extractIntensity: 1.35,
  softKnee: 0.42,
  bloomStrength: 1.80,
  exposure: 1.18,
  toneMapMode: 0,
  blurScale: 1.0,
  blurIterations: 3,
  blurRadius: 2.20
};

const HUD_ROW_OPTIONS = {
  anchor: "top-left",
  x: 0,
  y: 0,
  color: [0.90, 0.95, 1.0],
  minScale: 0.80
};

let app = null;

document.addEventListener("DOMContentLoaded", () => {
  start().catch((err) => {
    app?.setDiagnosticsReport?.(Diagnostics.createErrorReport(err, {
      system: "bloom",
      source: "samples/bloom/main.js",
      stage: app?.getDiagnosticsReport?.()?.stage ?? "start"
    }));
    if (app?.isConsoleEnabled?.()) {
      console.error("bloom sample failed:", err);
    }
    app?.showErrorPanel?.(err, {
      title: "bloom sample failed",
      id: "start-error",
      background: "rgba(26, 38, 26, 0.92)"
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

function getToneMapLabel(mode) {
  if (mode < 0.5) return "off";
  if (mode < 1.5) return "reinhard";
  return "aces";
}

function getBlurQualityLabel(scale) {
  return scale < 0.75 ? "half" : "full";
}

function getBloomDebugPreview(state, bloom) {
  if (state.bloomView === "scene") {
    return {
      source: bloom.getSceneTarget(),
      colorScale: [1.0, 1.0, 1.0, 1.0]
    };
  }
  if (state.bloomView === "extract") {
    return {
      source: bloom.getExtractTarget(),
      // extract / blur target は最終 composite 前の生の光量なので、
      // そのまま swapchain へ出すと暗く見えやすい
      // debug view では少し持ち上げて、どこに bloom 候補が残っているかを読み取りやすくする
      colorScale: [6.0, 6.0, 6.0, 1.0]
    };
  }
  if (state.bloomView === "extractHeat") {
    return {
      source: bloom.getExtractHeatTarget(),
      colorScale: [1.0, 1.0, 1.0, 1.0]
    };
  }
  if (state.bloomView === "blurA") {
    return {
      source: bloom.getBlurTargetA(),
      colorScale: [8.0, 8.0, 8.0, 1.0]
    };
  }
  return {
    source: bloom.getBlurTargetB(),
    colorScale: [8.0, 8.0, 8.0, 1.0]
  };
}

// bloom sample の現在値は canvas HUD へ 1 行 1 parameter 形式で流し、
// glow の見え方を比べながら値を直接追えるようにする
function makeHudRows(bloom, state) {
  return [
    { label: "Camera", value: "orbit", note: "drag / arrow" },
    { label: "Zoom", value: "camera", note: "[ / ] / wheel" },
    { label: "Bloom", toggleKey: "B", value: bloom.enabled ? "ON" : "OFF" },
    { label: "Threshold", decKey: "1", incKey: "2", value: bloom.threshold.toFixed(2) },
    { label: "Strength", decKey: "3", incKey: "4", value: bloom.bloomStrength.toFixed(2) },
    { label: "Blur Iter", decKey: "5", incKey: "6", value: String(bloom.blurIterations) },
    { label: "Blur Radius", decKey: "7", incKey: "8", value: bloom.blurRadius.toFixed(2) },
    { label: "Quality", cycleKey: "U", value: getBlurQualityLabel(bloom.getBlurScale()) },
    { label: "Soft Knee", decKey: "Q", incKey: "W", value: bloom.softKnee.toFixed(2) },
    { label: "Extract", decKey: "A", incKey: "S", value: bloom.extractIntensity.toFixed(2) },
    { label: "Exposure", decKey: "T", incKey: "Y", value: bloom.exposure.toFixed(2) },
    { label: "Tone Map", cycleKey: "G", value: getToneMapLabel(bloom.toneMapMode) },
    { label: "View", cycleKey: "V", value: state.bloomView },
    { label: "Pause", toggleKey: "Space", value: state.paused ? "ON" : "OFF" },
    { label: "Reset", key: "R", action: "reset", value: "ready" },
    { label: "Debug", value: DebugConfig.mode, keys: [{ key: "F9" }, { key: "M", action: "mode" }] }
  ];
}

function createFloor(app) {
  // 暗めの floor を置き、bloom 対象の明るい object と対比しやすくする
  const shape = new Shape(app.getGL());
  shape.applyPrimitiveAsset(Primitive.cuboid(46.0, 1.2, 46.0, shape.getPrimitiveOptions()));
  shape.endShape();
  shape.setMaterial("smooth-shader", {
    has_bone: 0,
    ...makeMaterial([0.10, 0.13, 0.18, 1.0], 0.18, 0.25, 16.0)
  });

  const node = app.space.addNode(null, "floor");
  node.setPosition(0.0, -4.4, 0.0);
  node.addShape(shape);
  return node;
}

function createCenterSphere(app) {
  // 中央の白球は bloom の見え方を最も分かりやすくする主役として置く
  const shape = new Shape(app.getGL());
  shape.applyPrimitiveAsset(Primitive.sphere(3.6, 32, 24, shape.getPrimitiveOptions()));
  shape.endShape();
  shape.setMaterial("smooth-shader", {
    has_bone: 0,
    ...makeMaterial([1.0, 0.98, 0.88, 1.0], 0.82, 1.15, 64.0)
  });

  const node = app.space.addNode(null, "center");
  node.setPosition(0.0, 0.2, 0.0);
  node.addShape(shape);
  return node;
}

function createEmissionProbe(app, name, options) {
  // bloom の抽出が specular 由来の細い highlight だけに偏っていないかを見るため、
  // emissive を高めにした小球を複数色で追加する
  // 背景寄りの位置へ浮かせることで、球本体だけでなく背後にも glow が広がるかを確認しやすくする
  // SmoothShader emissive は 0.0-1.0 を使う前提なので、ここでもその範囲内で強めの値を使う
  const shape = new Shape(app.getGL());
  shape.applyPrimitiveAsset(Primitive.sphere(options.size ?? 0.85, 24, 18, shape.getPrimitiveOptions()));
  shape.endShape();
  shape.setMaterial("smooth-shader", {
    has_bone: 0,
    use_texture: 0,
    color: options.color,
    ambient: 0.12,
    specular: 0.10,
    power: 8.0,
    emissive: options.emissive
  });

  const node = app.space.addNode(null, name);
  node.setPosition(options.x, options.y, options.z);
  node.addShape(shape);
  return node;
}

function createGlowOrb(app, name, color, angleDeg, radius, height, size) {
  // bloom は発光オブジェクト専用ではないが、明るい球を周回させると
  // threshold / strength / blur の変化が追いやすい
  const shape = new Shape(app.getGL());
  shape.applyPrimitiveAsset(Primitive.sphere(size, 24, 18, shape.getPrimitiveOptions()));
  shape.endShape();
  shape.setMaterial("smooth-shader", {
    has_bone: 0,
    ...makeMaterial(color, 0.72, 1.05, 42.0)
  });

  const node = app.space.addNode(null, name);
  const rad = angleDeg * Math.PI / 180.0;
  node.setPosition(Math.cos(rad) * radius, height, Math.sin(rad) * radius);
  node.addShape(shape);
  return node;
}

async function start() {
  app = new WebgApp({
    document,
    autoDrawScene: false,
    clearColor: [0.03, 0.05, 0.09, 1.0],
    viewAngle: 54.0,
    messageFontTexture: "../../webg/font512.png",
    camera: {
      target: [0.0, 0.0, 0.0],
      distance: 34.0,
      yaw: 28.0,
      pitch: -12.0
    },
    light: {
      mode: "world-node",
      nodeName: "worldLight",
      position: [80.0, 140.0, 120.0],
      attitude: [0.0, 0.0, 0.0],
      type: 1.0
    },
    debugTools: {
      mode: "debug",
      system: "bloom",
      source: "samples/bloom/main.js",
      probeDefaultAfterFrames: 1
    }
  });
  await app.init();
  // 通常 sample の操作説明は `createHelpPanel()` を使う標準形へ寄せ、
  // bloom 固有 code は行配列を渡すだけにして再利用しやすくする
  app.createHelpPanel({
    id: "bloomHelpOverlay",
    lines: GUIDE_LINES
  });

  const orbit = app.createOrbitEyeRig({
    target: [0.0, 0.0, 0.0],
    distance: 34.0,
    yaw: 28.0,
    pitch: -12.0,
    minDistance: 16.0,
    maxDistance: 82.0,
    wheelZoomStep: 1.3
  });

  const bloom = new BloomPass(app.getGL(), {
    width: app.screen.getWidth(),
    height: app.screen.getHeight(),
    threshold: BLOOM_DEFAULT.threshold,
    extractIntensity: BLOOM_DEFAULT.extractIntensity,
    softKnee: BLOOM_DEFAULT.softKnee,
    bloomStrength: BLOOM_DEFAULT.bloomStrength,
    exposure: BLOOM_DEFAULT.exposure,
    toneMapMode: BLOOM_DEFAULT.toneMapMode,
    blurScale: BLOOM_DEFAULT.blurScale,
    blurIterations: BLOOM_DEFAULT.blurIterations,
    blurRadius: BLOOM_DEFAULT.blurRadius
  });
  await bloom.ready;
  const debugPass = new FullscreenPass(app.getGL(), {
    targetFormat: app.getGL().format
  });
  await debugPass.init();
  app.setDiagnosticsStage("runtime");

  createFloor(app);
  const centerSphere = createCenterSphere(app);
  const emissionProbes = [
    createEmissionProbe(app, "emissionWarm", {
      x: 0.0, y: 4.8, z: -13.5, size: 0.85, color: [1.0, 0.96, 0.82, 1.0], emissive: 0.92
    }),
    createEmissionProbe(app, "emissionBlue", {
      x: -5.4, y: 3.9, z: -11.0, size: 0.78, color: [0.32, 0.70, 1.0, 1.0], emissive: 1.0
    }),
    createEmissionProbe(app, "emissionPink", {
      x: 5.0, y: 5.2, z: -10.5, size: 0.82, color: [1.0, 0.38, 0.74, 1.0], emissive: 0.96
    })
  ];
  const orbitRoot = app.space.addNode(null, "orbRoot");
  orbitRoot.setPosition(0.0, 0.0, 0.0);

  const orbs = [
    createGlowOrb(app, "orbWarm", [1.0, 0.64, 0.28, 1.0], 0.0, 11.0, 1.6, 1.45),
    createGlowOrb(app, "orbPink", [0.96, 0.42, 0.78, 1.0], 90.0, 11.0, 1.9, 1.35),
    createGlowOrb(app, "orbBlue", [0.36, 0.76, 1.0, 1.0], 180.0, 11.0, 1.7, 1.40),
    createGlowOrb(app, "orbLime", [0.72, 1.0, 0.44, 1.0], 270.0, 11.0, 2.0, 1.30)
  ];

  for (let i = 0; i < orbs.length; i++) {
    orbs[i].attach(orbitRoot);
  }

  const state = {
    paused: false,
    bloomView: "composite"
  };

  function refreshDiagnosticsStats() {
    app.mergeDiagnosticsStats({
      bloomEnabled: bloom.enabled ? "yes" : "no",
      bloomView: state.bloomView,
      threshold: bloom.threshold.toFixed(2),
      extractIntensity: bloom.extractIntensity.toFixed(2),
      softKnee: bloom.softKnee.toFixed(2),
      bloomStrength: bloom.bloomStrength.toFixed(2),
      exposure: bloom.exposure.toFixed(2),
      toneMapMode: bloom.toneMapMode,
      toneMapLabel: getToneMapLabel(bloom.toneMapMode),
      blurQuality: getBlurQualityLabel(bloom.getBlurScale()),
      blurScale: bloom.getBlurScale().toFixed(2),
      blurIterations: bloom.blurIterations,
      blurRadius: bloom.blurRadius.toFixed(2),
      paused: state.paused ? "yes" : "no",
      sceneTargetWidth: bloom.getSceneTarget().getWidth(),
      sceneTargetHeight: bloom.getSceneTarget().getHeight(),
      blurTargetWidth: bloom.getBlurTargetA()?.getWidth?.() ?? 0,
      blurTargetHeight: bloom.getBlurTargetA()?.getHeight?.() ?? 0
    });
  }

  // bloom の parameter 一覧は canvas HUD だけへ流し、
  // 操作説明そのものは UIPanel で表示 / 非表示を切り替える
  function refreshHudRows() {
    const rows = makeHudRows(bloom, state);
    app.setHudRows(app.isDebugUiEnabled() ? rows : [], HUD_ROW_OPTIONS);
  }

  function makeProbeReport(frameCount) {
    const report = app.createProbeReport("runtime-probe");
    Diagnostics.addDetail(report, `view=${state.bloomView}`);
    Diagnostics.addDetail(report, `bloom=${bloom.enabled ? "ON" : "OFF"}`);
    Diagnostics.mergeStats(report, {
      frameCount,
      threshold: bloom.threshold.toFixed(2),
      extractIntensity: bloom.extractIntensity.toFixed(2),
      softKnee: bloom.softKnee.toFixed(2),
      bloomStrength: bloom.bloomStrength.toFixed(2),
      exposure: bloom.exposure.toFixed(2),
      toneMapMode: bloom.toneMapMode,
      toneMapLabel: getToneMapLabel(bloom.toneMapMode),
      blurQuality: getBlurQualityLabel(bloom.getBlurScale()),
      blurScale: bloom.getBlurScale().toFixed(2),
      blurIterations: bloom.blurIterations,
      blurRadius: bloom.blurRadius.toFixed(2),
      paused: state.paused ? "yes" : "no",
      sceneTargetWidth: bloom.getSceneTarget().getWidth(),
      sceneTargetHeight: bloom.getSceneTarget().getHeight(),
      blurTargetWidth: bloom.getBlurTargetA()?.getWidth?.() ?? 0,
      blurTargetHeight: bloom.getBlurTargetA()?.getHeight?.() ?? 0
    });
    return report;
  }

  const resetBloom = () => {
    bloom.setEnabled(true);
    bloom.setThreshold(BLOOM_DEFAULT.threshold);
    bloom.setExtractIntensity(BLOOM_DEFAULT.extractIntensity);
    bloom.setSoftKnee(BLOOM_DEFAULT.softKnee);
    bloom.setBloomStrength(BLOOM_DEFAULT.bloomStrength);
    bloom.setExposure(BLOOM_DEFAULT.exposure);
    bloom.setToneMapMode(BLOOM_DEFAULT.toneMapMode);
    bloom.setBlurScale(BLOOM_DEFAULT.blurScale);
    bloom.setBlurIterations(BLOOM_DEFAULT.blurIterations);
    bloom.setBlurRadius(BLOOM_DEFAULT.blurRadius);
  };
  app.configureDiagnosticsCapture({
    labelPrefix: "bloom",
    collect: () => makeProbeReport(app.screen.getFrameCount())
  });
  app.configureDebugKeyInput();

  app.attachInput({
    onKeyDown: async (key, ev) => {
      if (ev.repeat) return;
      if (key === "b") {
        bloom.setEnabled(!bloom.enabled);
      } else if (key === "1") {
        bloom.setThreshold(Math.max(0.1, bloom.threshold - 0.08));
      } else if (key === "2") {
        bloom.setThreshold(Math.min(0.95, bloom.threshold + 0.08));
      } else if (key === "3") {
        bloom.setBloomStrength(Math.max(0.0, bloom.bloomStrength - 0.30));
      } else if (key === "4") {
        bloom.setBloomStrength(Math.min(4.0, bloom.bloomStrength + 0.30));
      } else if (key === "5") {
        bloom.setBlurIterations(Math.max(1, bloom.blurIterations - 1));
      } else if (key === "6") {
        bloom.setBlurIterations(Math.min(6, bloom.blurIterations + 1));
      } else if (key === "7") {
        bloom.setBlurRadius(Math.max(0.2, bloom.blurRadius - 0.35));
      } else if (key === "8") {
        bloom.setBlurRadius(Math.min(4.5, bloom.blurRadius + 0.35));
      } else if (key === "u") {
        bloom.setBlurScale(bloom.getBlurScale() < 0.75 ? 1.0 : 0.5);
      } else if (key === "q") {
        bloom.setSoftKnee(Math.max(0.0, bloom.softKnee - 0.05));
      } else if (key === "w") {
        bloom.setSoftKnee(Math.min(0.95, bloom.softKnee + 0.05));
      } else if (key === "a") {
        bloom.setExtractIntensity(Math.max(0.2, bloom.extractIntensity - 0.10));
      } else if (key === "s") {
        bloom.setExtractIntensity(Math.min(3.0, bloom.extractIntensity + 0.10));
      } else if (key === "t") {
        bloom.setExposure(Math.max(0.25, bloom.exposure - 0.10));
      } else if (key === "y") {
        bloom.setExposure(Math.min(3.0, bloom.exposure + 0.10));
      } else if (key === "g") {
        bloom.setToneMapMode((Math.floor(bloom.toneMapMode) + 1) % 3);
      } else if (key === " ") {
        state.paused = !state.paused;
      } else if (key === "v") {
        const order = ["composite", "scene", "extract", "extractHeat", "blurA", "blurB"];
        const current = order.indexOf(state.bloomView);
        state.bloomView = order[(current + 1) % order.length];
      } else if (key === "r") {
        resetBloom();
      }
    }
  });

  app.start({
    onUpdate: ({ deltaSec, screen }) => {
      orbit.update(deltaSec);
      bloom.resizeToScreen(screen);

      if (!state.paused) {
        orbitRoot.rotateY(18.0 * deltaSec);
        centerSphere.rotateY(10.0 * deltaSec);
        centerSphere.rotateX(6.0 * deltaSec);
        for (let i = 0; i < emissionProbes.length; i++) {
          emissionProbes[i].rotateY((16.0 + i * 5.0) * deltaSec);
          emissionProbes[i].rotateX((9.0 + i * 3.0) * deltaSec);
        }
        for (let i = 0; i < orbs.length; i++) {
          orbs[i].rotateY((18.0 + i * 4.0) * deltaSec);
        }
      }

      refreshDiagnosticsStats();
      refreshHudRows();
      app.updateDebugProbe();
    },
    onBeforeDraw: () => {
      // 3D scene 本体は canvas ではなく sceneTarget に描く
      bloom.beginScene(app.screen, app.clearColor);
      app.space.draw(app.eye);
    },
    onAfterDraw3d: () => {
      // bloom 合成自体は depth なし fullscreen pass で行う
      // そのまま Font/Message 系の depth 付き pipeline を使うと
      // attachment state 不一致になるため、合成後に color を保持したまま
      // 深度付きの canvas pass を開き直して HUD 描画へ渡す
      bloom.render(app.screen, {
        source: bloom.getSceneTarget(),
        clearColor: app.clearColor
      });

      if (state.bloomView !== "composite") {
        const preview = getBloomDebugPreview(state, bloom);
        app.screen.beginPass({
          clearColor: app.clearColor,
          colorLoadOp: "clear",
          depthView: null
        });
        debugPass.setColorScale(...preview.colorScale);
        debugPass.draw(preview.source);
        debugPass.setColorScale(1.0, 1.0, 1.0, 1.0);
      }

      app.screen.clearDepthBuffer();
    }
  });
}
