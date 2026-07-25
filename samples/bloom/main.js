// ---------------------------------------------
// samples/bloom/main.js  2026/07/25
//   bloom sample
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
import BloomPass from "../../webg/BloomPass.js";
import Diagnostics from "../../webg/Diagnostics.js";
import BloomDebugFullscreenPass, {
  resolveBloomDebugPreview
} from "./BloomDebugFullscreenPass.js";

// bloom sample の役割:
// - offscreen `RenderTarget` に 3D scene を描き、その結果へ `BloomPass` を掛けてから
//   canvas へ戻す最小経路を示す
// - PBR や shadow と独立に、postprocess を別レイヤとして追加できることを確認する
// - `WebgApp` の起動補助を使いつつ、描画本体だけを custom pass へ差し替える例にする

const GUIDE_LINES = [
  "CommandPalette: double tap canvas or press /",
  "Drag or Arrow keys: orbit camera",
  "[ / ] or wheel: zoom",
  "Use palette controls to compare bloom extraction, blur and tone mapping"
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

let app = null;
let palette = null;
let lastHelpText = "";

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
    app?.showOverlayPanel?.(buildErrorPanelOptions(err, {
      title: "bloom sample failed",
      id: "start-error",
      background: "rgba(26, 38, 26, 0.92)"
    }));
  });
});

// 材質を生成し、後続処理で利用できる状態にする
function makeMaterial(color, ambient, specular, power) {
  return {
    use_texture: 0,
    color,
    ambient,
    specular,
    power
  };
}

// `tone`のマップの`label`を現在の入力と状態から求め、呼び出し元へ返す
function getToneMapLabel(mode) {
  if (mode < 0.5) return "off";
  if (mode < 1.5) return "reinhard";
  return "aces";
}

function getBlurQualityLabel(scale) {
  return scale < 0.75 ? "half" : "full";
}

// 床を生成し、後続処理で利用できる状態にする
function createFloor(app) {
  // 暗めの floor を置き、bloom 対象の明るい object と対比しやすくする
  const shape = new Shape(app.getGPU());
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

// `center`の`sphere`を生成し、後続処理で利用できる状態にする
function createCenterSphere(app) {
  // 中央の白球は bloom の見え方を最も分かりやすくする主役として置く
  const shape = new Shape(app.getGPU());
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

// `emission`の検査情報を生成し、後続処理で利用できる状態にする
function createEmissionProbe(app, name, options) {
  // bloom の抽出が specular 由来の細い highlight だけに偏っていないかを見るため、
  // emissive を高めにした小球を複数色で追加する
  // 背景寄りの位置へ浮かせることで、球本体だけでなく背後にも glow が広がるかを確認しやすくする
  // SmoothShader emissive は 0.0-1.0 を使う前提なので、ここでもその範囲内で強めの値を使う
  const shape = new Shape(app.getGPU());
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

// `glow`の`orb`を生成し、後続処理で利用できる状態にする
function createGlowOrb(app, name, color, angleDeg, radius, height, size) {
  // bloom は発光オブジェクト専用ではないが、明るい球を周回させると
  // threshold / strength / blur の変化が追いやすい
  const shape = new Shape(app.getGPU());
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

// このインスタンスの初期化段階で、必要な状態と資源を準備して処理を開始する
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
      mode: "release",
      system: "bloom",
      source: "samples/bloom/main.js",
      probeDefaultAfterFrames: 1
    }
  });
  await app.init();
  // 通常 sample の操作説明は `buildHelpPanelOptions()` を使う標準形へ寄せ、
  // bloom 固有 code は行配列を渡すだけにして再利用しやすくする
  app.showOverlayPanel(buildHelpPanelOptions({
    id: "bloomHelpOverlay",
    collapsed: true,
    lines: GUIDE_LINES
  }));

  const orbit = app.createOrbitEyeRig({
    target: [0.0, 0.0, 0.0],
    distance: 34.0,
    yaw: 28.0,
    pitch: -12.0,
    minDistance: 16.0,
    maxDistance: 82.0,
    wheelZoomStep: 1.3
  });

  const bloom = new BloomPass(app.getGPU(), {
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
  const debugPass = new BloomDebugFullscreenPass(app.getGPU(), {
    targetFormat: app.getGPU().format,
    sourceFormat: bloom.sceneFormat
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

  // ヘルプの行を生成し、後続処理で利用できる状態にする
  function buildHelpLines() {
    return [
      ...GUIDE_LINES,
      "",
      `Bloom: ${bloom.enabled ? "ON" : "OFF"} / view: ${state.bloomView}`,
      `Threshold: ${bloom.threshold.toFixed(2)} / strength: ${bloom.bloomStrength.toFixed(2)}`,
      `Blur: radius ${bloom.blurRadius.toFixed(2)} / iter ${bloom.blurIterations} / quality ${getBlurQualityLabel(bloom.getBlurScale())}`,
      `Extract: ${bloom.extractIntensity.toFixed(2)} / soft knee: ${bloom.softKnee.toFixed(2)}`,
      `Exposure: ${bloom.exposure.toFixed(2)} / tone map: ${getToneMapLabel(bloom.toneMapMode)}`,
      `Pause: ${state.paused ? "ON" : "OFF"}`
    ];
  }

  // ヘルプのパネルを現在の入力と実行状態に合わせて更新する
  function updateHelpPanel() {
    const panel = app.getOverlayPanel("bloomHelpOverlay");
    if (!panel) return;
    const lines = buildHelpLines();
    const text = lines.join("\n");
    if (text === lastHelpText) return;
    app.updateOverlayPanel("bloomHelpOverlay", { lines });
    lastHelpText = text;
  }

  // 診断情報の統計情報を現在の入力と実行状態に合わせて更新する
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

  // 検査情報のレポートを生成し、後続処理で利用できる状態にする
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

  // ブルームを初期状態へ戻し、前回の状態を残さない
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
      title: "Bloom",
      pageRows: 5,
      pageRowsByPage: [5, 5, 5],
      closeOnCommand: false,
      onChange: (id, value) => {
        if (id === "enabled") bloom.setEnabled(value);
        else if (id === "threshold") bloom.setThreshold(value);
        else if (id === "strength") bloom.setBloomStrength(value);
        else if (id === "blur-radius") bloom.setBlurRadius(value);
        else if (id === "blur-iter") bloom.setBlurIterations(value);
        else if (id === "soft-knee") bloom.setSoftKnee(value);
        else if (id === "extract") bloom.setExtractIntensity(value);
        else if (id === "exposure") bloom.setExposure(value);
        else if (id === "tone-map") bloom.setToneMapMode(value);
        else if (id === "quality") bloom.setBlurScale(value === "half" ? 0.5 : 1.0);
        else if (id === "view") state.bloomView = value;
        else if (id === "paused") state.paused = value;
        refreshAfterControlChange();
      },
      onCommand: (id) => {
        if (id === "reset") resetBloom();
        refreshAfterControlChange();
      },
      commands: [
        // 1ページ目
        { type: "toggle", id: "enabled", label: "Bloom", detail: "on/off", value: () => bloom.enabled },
        { type: "toggle", id: "paused", label: "Pause", detail: "anim", value: () => state.paused },
        null,
        { id: "palette-next", label: "Next", detail: "page", pageSwitch: true },
        { type: "select", id: "view", label: "View", value: () => state.bloomView, options: [
          { value: "composite", label: "composite" },
          { value: "scene", label: "scene" },
          { value: "extract", label: "extract" },
          { value: "extractHeat", label: "heat" },
          { value: "blurA", label: "blurA" },
          { value: "blurB", label: "blurB" }
        ] },
        { type: "stepper", id: "threshold", label: "Threshold", value: () => bloom.threshold, min: 0.1, max: 0.95, step: 0.08, decimals: 2, input: true },
        { type: "stepper", id: "strength", label: "Strength", value: () => bloom.bloomStrength, min: 0.0, max: 4.0, step: 0.30, decimals: 2, input: true },
        { type: "stepper", id: "blur-radius", label: "Blur Radius", value: () => bloom.blurRadius, min: 0.2, max: 4.5, step: 0.35, decimals: 2, input: true },
        // 2ページ目
        null,
        null,
        null,
        { id: "palette-next", label: "Next", detail: "page", pageSwitch: true },
        { type: "stepper", id: "blur-iter", label: "Blur Iter", value: () => bloom.blurIterations, min: 1, max: 6, step: 1, decimals: 0, input: true },
        { type: "stepper", id: "soft-knee", label: "Soft Knee", value: () => bloom.softKnee, min: 0.0, max: 0.95, step: 0.05, decimals: 2, input: true },
        { id: "reset", label: "Reset", detail: "params" },
        null,
        null,
        null,
        { type: "stepper", id: "extract", label: "Extract", value: () => bloom.extractIntensity, min: 0.2, max: 3.0, step: 0.10, decimals: 2, input: true },
        // 3ページ目
        null,
        null,
        null,
        { id: "palette-next", label: "Next", detail: "page", pageSwitch: true },
        { type: "stepper", id: "exposure", label: "Exposure", value: () => bloom.exposure, min: 0.25, max: 3.0, step: 0.10, decimals: 2, input: true },
        { type: "select", id: "tone-map", label: "Tone Map", value: () => Math.floor(bloom.toneMapMode), options: [
          { value: 0, label: "off" },
          { value: 1, label: "reinhard" },
          { value: 2, label: "aces" }
        ] },
        { type: "select", id: "quality", label: "Quality", value: () => getBlurQualityLabel(bloom.getBlurScale()), options: [
          { value: "full", label: "full" },
          { value: "half", label: "half" }
        ] },
        null,
        null,
        null,
        null,
      ]
    });
    palette.attachToCanvas(app.screen.canvas, { key: "/" });
    palette.setStyle(getDefaultCommandPaletteCss());
  };

  createPalette();
  refreshAfterControlChange();
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
      updateHelpPanel();
      app.updateDebugProbe();
    },
    onBeforeDraw: () => {
      // 3D scene 本体は canvas ではなく sceneTarget に描く
      // beginScene() はコア側で寸法変化を判定し、必要な場合だけtargetを再生成する
      bloom.beginScene(app.screen, app.clearColor);
      app.space.draw(app.eye);
    },
    onAfterDraw3d: () => {
      // bloom 合成自体は depth なし fullscreen pass で行う
      // そのまま Font/Message 系の depth 付き pipeline を使うと
      // attachment state 不一致になるため、合成後に color を保持したまま
      // 深度付きの canvas pass を開き直して overlay表示へ渡す
      bloom.render(app.screen, {
        source: bloom.getSceneTarget(),
        clearColor: app.clearColor
      });

      if (state.bloomView !== "composite") {
        const preview = resolveBloomDebugPreview(state.bloomView, bloom);
        app.screen.beginPresentPass({
          clearColor: app.clearColor,
          colorLoadOp: "clear"
        });
        debugPass.setColorScale(...preview.colorScale);
        debugPass.draw(preview.source);
        debugPass.setColorScale(1.0, 1.0, 1.0, 1.0);
      }

      app.screen.clearDepthBuffer();
    }
  });
}
