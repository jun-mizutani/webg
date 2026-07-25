// ---------------------------------------------
// samples/dof/main.js  2026/07/25
//   dof sample
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
import DofPass from "../../webg/DofPass.js?v=20260702_stage_width";
import FullscreenPass from "../../webg/FullscreenPass.js";
import Diagnostics from "../../webg/Diagnostics.js";

// この sample の役割:
// - 直接光 diffuse / specular を含む scene color と depth を使って、
//   focus 面だけ sharp に残す最小の被写界深度を示す
// - `SeparableBlurPass` を bloom 以外でも再利用できることを確認する
// - CommandPalette と diagnostics を使い、focusDistance / focusRange / blur の関係を追いやすくする

const GUIDE_LINES = [
  "CommandPalette: double tap canvas or press /",
  "Drag or Arrow keys: orbit camera",
  "Wheel or [ / ]: zoom",
  "X: start or cancel benchmark",
  "Use palette controls to compare focus, blur and staged stage load"
];

const DOF_DEFAULT = {
  dofMode: "staged",
  focusDistance: 36.0,
  // Focus Range は compute_dof と同じく、blur stage 1つ分の距離幅として扱う
  // DofPass core も同じstage幅仕様へ揃えているため、この値をそのまま渡す
  focusRange: 7.0,
  maxBlurMix: 1.0,
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

const BACKGROUND_OPTIONS = Object.freeze([
  { value: "deep", label: "deep", color: [0.025, 0.035, 0.055, 1.0] },
  { value: "black", label: "black", color: [0.0, 0.0, 0.0, 1.0] },
  { value: "slate", label: "slate", color: [0.10, 0.12, 0.15, 1.0] },
  { value: "gray", label: "gray", color: [0.30, 0.32, 0.35, 1.0] },
  { value: "cream", label: "cream", color: [0.78, 0.74, 0.64, 1.0] }
]);
const BENCHMARK_DEFAULT = Object.freeze({
  warmupFrames: 45,
  sampleFrames: 90
});
const BENCHMARK_CASES = Object.freeze([
  { id: "dof_off", label: "DOF Off", dofEnabled: false, dofMode: "staged", blurScale: 1.0 },
  { id: "staged_s1", label: "Staged S1", dofEnabled: true, dofMode: "staged", blurScale: 1.0, stagedStageCount: 1 },
  { id: "staged_s2", label: "Staged S2", dofEnabled: true, dofMode: "staged", blurScale: 1.0, stagedStageCount: 2 },
  { id: "staged_full", label: "Staged Full", dofEnabled: true, dofMode: "staged", blurScale: 1.0, stagedStageCount: 3 },
  { id: "staged_half", label: "Staged Half", dofEnabled: true, dofMode: "staged", blurScale: 0.5 }
]);

let app = null;
let palette = null;
let lastHelpText = "";
let lastHelpUpdateMs = 0;

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
    app?.showOverlayPanel?.(buildErrorPanelOptions(err, {
      title: "dof sample failed",
      id: "start-error",
      background: "rgba(24, 34, 24, 0.92)"
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

function getBlurQualityLabel(scale) {
  return scale < 0.75 ? "half" : "full";
}

function getBackgroundOption(value) {
  return BACKGROUND_OPTIONS.find((option) => option.value === value) ?? BACKGROUND_OPTIONS[0];
}

// ステージの`blur`の`iterations`を現在の入力と状態から求め、呼び出し元へ返す
function formatStageBlurIterations(dof) {
  const iterations = dof.getStageBlurIterations();
  return `${iterations.small}/${iterations.medium}/${iterations.large}`;
}

// 被写界深度の`blur`の倍率を読み込み、検証済みのデータとして後続処理へ渡す
function readDofBlurScale(dof) {
  // 現行DofPassの公開methodだけを使用し、古いcache向けproperty fallbackでAPI不一致を隠さない
  return dof.getBlurScale();
}

function formatDiagnosticNumber(value, digits) {
  return Number.isFinite(value) ? value.toFixed(digits) : "unavailable";
}

// 背景の色を受け取り、現在の設定と後続処理へ反映する
function setBackgroundColor(app, value) {
  // app.clearColor は scene の offscreen pass と最終compositeのclearに共通で使う
  // 配列を共有すると外部変更を追いにくいため、palette選択時に新しい配列として差し替える
  const option = getBackgroundOption(value);
  app.clearColor = option.color.slice();
  return option.value;
}

// `captureDofSettings`は受け取った値を処理し、後続処理で利用する状態または結果を生成する
function captureDofSettings(dof) {
  // benchmark 実行前の利用者設定へ戻せるよう、
  // DofPass が保持している公開値を一度 object として退避する
  return {
    enabled: dof.enabled,
    dofMode: dof.dofMode,
    focusDistance: dof.focusDistance,
    focusRange: dof.focusRange,
    maxBlurMix: dof.maxBlurMix,
    sharpnessWidth: dof.sharpnessWidth,
    sharpnessPower: dof.sharpnessPower,
    blurScale: readDofBlurScale(dof),
    stageBlurIterations: dof.getStageBlurIterations(),
    blurRadius: dof.blurRadius,
    stagedStageCount: dof.getStagedStageCount()
  };
}

// 被写界深度の`settings`を対象の状態または描画設定へ反映する
function applyDofSettings(dof, settings) {
  // benchmark 用の case 切り替えでも通常 UI と同じ setter を通し、
  // DofPass 内の uniform と blur pass 状態がずれないようにする
  dof.setEnabled(settings.enabled);
  dof.setDofMode(settings.dofMode);
  dof.setFocusDistance(settings.focusDistance);
  dof.setFocusRange(settings.focusRange);
  dof.setMaxBlurMix(settings.maxBlurMix);
  dof.setSharpnessWidth(settings.sharpnessWidth);
  dof.setSharpnessPower(settings.sharpnessPower);
  if (Number.isFinite(settings.blurScale)) {
    dof.setBlurScale(settings.blurScale);
  }
  dof.setStageBlurIterations(settings.stageBlurIterations);
  dof.setBlurRadius(settings.blurRadius);
  dof.setStagedStageCount(settings.stagedStageCount);
}

// `cloneBenchmarkCase`は元データから独立して利用できる複製または実行状態を作る
function cloneBenchmarkCase(baseSettings, definition) {
  // benchmark は現在の焦点条件や blur radius を保ったまま
  // mode / on-off / blurScale だけを差し替えて比較する
  return {
    id: definition.id,
    label: definition.label,
    settings: {
      ...baseSettings,
      enabled: definition.dofEnabled,
      dofMode: definition.dofMode,
      blurScale: definition.blurScale,
      stagedStageCount: definition.stagedStageCount ?? baseSettings.stagedStageCount
    }
  };
}

// フレームの`timing`の`snapshot`を読み込み、検証済みのデータとして後続処理へ渡す
function readFrameTimingSnapshot(frameTimer) {
  // Help panel 用の文字列ではなく、集計しやすい生の数値を JSON へ残す
  // timestamp-query 未対応時は GPU 値を 0 に補正せず null のまま保持する
  if (!frameTimer) {
    return null;
  }
  const timestampSupported = frameTimer.timestampSupported === true;
  const hasGpuTime = Number.isFinite(frameTimer.gpuComputeMs) || Number.isFinite(frameTimer.gpuRenderMs);
  return {
    frameIntervalMs: Number.isFinite(frameTimer.frameIntervalMs) ? frameTimer.frameIntervalMs : null,
    jsTimeMs: Number.isFinite(frameTimer.jsTimeMs) ? frameTimer.jsTimeMs : null,
    jsLoadPercent: Number.isFinite(frameTimer.jsLoadPercent) ? frameTimer.jsLoadPercent : null,
    gpuComputeMs: Number.isFinite(frameTimer.gpuComputeMs) ? frameTimer.gpuComputeMs : null,
    gpuRenderMs: Number.isFinite(frameTimer.gpuRenderMs) ? frameTimer.gpuRenderMs : null,
    gpuTotalMs: timestampSupported && hasGpuTime ? frameTimer.getGpuTotalMs() : null,
    gpuLoadPercent: Number.isFinite(frameTimer.gpuLoadPercent) ? frameTimer.gpuLoadPercent : null,
    timestampSupported
  };
}

// `averageMetric`は座標または数値を計算し、後続処理で使う結果を返す
function averageMetric(samples, key) {
  const values = samples
    .map((sample) => sample[key])
    .filter((value) => Number.isFinite(value));
  if (values.length === 0) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0.0) / values.length;
}

// `minMetric`は座標または数値を計算し、後続処理で使う結果を返す
function minMetric(samples, key) {
  const values = samples
    .map((sample) => sample[key])
    .filter((value) => Number.isFinite(value));
  if (values.length === 0) {
    return null;
  }
  return Math.min(...values);
}

// `maxMetric`は座標または数値を計算し、後続処理で使う結果を返す
function maxMetric(samples, key) {
  const values = samples
    .map((sample) => sample[key])
    .filter((value) => Number.isFinite(value));
  if (values.length === 0) {
    return null;
  }
  return Math.max(...values);
}

// `summarizeBenchmarkSamples`は現在値を読みやすい診断文字列へ整形する
function summarizeBenchmarkSamples(samples) {
  // raw sample をそのまま捨てず JSON に残しつつ、
  // 後から比較しやすい平均 / 最小 / 最大も同時に保存する
  return {
    sampleCount: samples.length,
    average: {
      frameIntervalMs: averageMetric(samples, "frameIntervalMs"),
      jsTimeMs: averageMetric(samples, "jsTimeMs"),
      jsLoadPercent: averageMetric(samples, "jsLoadPercent"),
      gpuComputeMs: averageMetric(samples, "gpuComputeMs"),
      gpuRenderMs: averageMetric(samples, "gpuRenderMs"),
      gpuTotalMs: averageMetric(samples, "gpuTotalMs"),
      gpuLoadPercent: averageMetric(samples, "gpuLoadPercent")
    },
    min: {
      frameIntervalMs: minMetric(samples, "frameIntervalMs"),
      jsTimeMs: minMetric(samples, "jsTimeMs"),
      gpuRenderMs: minMetric(samples, "gpuRenderMs"),
      gpuTotalMs: minMetric(samples, "gpuTotalMs")
    },
    max: {
      frameIntervalMs: maxMetric(samples, "frameIntervalMs"),
      jsTimeMs: maxMetric(samples, "jsTimeMs"),
      gpuRenderMs: maxMetric(samples, "gpuRenderMs"),
      gpuTotalMs: maxMetric(samples, "gpuTotalMs")
    }
  };
}

// `benchmark`のJSONを指定された形式または保存先へ出力する
function downloadBenchmarkJson(payload) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `dof-benchmark-${timestamp}.json`;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// `benchmark`の状態表示の`text`を現在の入力と状態から求め、呼び出し元へ返す
function getBenchmarkStatusText(benchmark) {
  if (benchmark.running) {
    const currentCase = benchmark.runner?.cases?.[benchmark.runner.caseIndex] ?? null;
    return `${benchmark.runner.phase}:${benchmark.runner.caseIndex + 1}/${benchmark.runner.cases.length} ${currentCase?.id ?? "--"} ${benchmark.runner.phaseFrame}/${benchmark.runner.phaseTarget}`;
  }
  if (benchmark.lastResult) {
    return `done:${benchmark.lastResult.results.length}cases`;
  }
  return "idle";
}

// ヘルプの行を生成し、後続処理で利用できる状態にする
function buildHelpLines() {
  const dof = app?.dofPass;
  const benchmark = app?.dofBenchmark;
  return [
    ...GUIDE_LINES,
    "",
    `DOF: ${dof?.enabled ? "ON" : "OFF"} / mode: staged`,
    `Background: ${app?.dofBackgroundName ?? "--"}`,
    `Focus: ${dof?.focusDistance?.toFixed?.(1) ?? "--"} / range: ${dof?.focusRange?.toFixed?.(1) ?? "--"}`,
    `Blur: radius ${dof?.blurRadius?.toFixed?.(2) ?? "--"} / stages ${dof?.getStagedStageCount?.() ?? "--"} / iter ${dof ? formatStageBlurIterations(dof) : "--"}`,
    `Bench: ${getBenchmarkStatusText(benchmark ?? { running: false, lastResult: null })}`,
    ...app.getFrameTimingLines()
  ];
}

// ヘルプのパネルを現在の入力と実行状態に合わせて更新する
function updateHelpPanel() {
  const panel = app?.getOverlayPanel?.("dofHelpOverlay");
  if (!panel) return;
  const lines = buildHelpLines();
  const text = lines.join("\n");
  if (text === lastHelpText) return;
  app.updateOverlayPanel("dofHelpOverlay", { lines });
  lastHelpText = text;
}

// `normalize3`を検証し、後続処理が扱える共通形式へ整える
function normalize3(vector) {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (length < 0.000001) {
    return [0.0, 0.0, -1.0];
  }
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

// `cross3`は座標または数値を計算し、後続処理で使う結果を返す
function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

// `scaled3`を対象へ追加し、後続処理から参照できるようにする
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

// `shared`の`sphere`の`source`を生成し、後続処理で利用できる状態にする
function createSharedSphereSource(app) {
  // dof sample の球は半径だけが違い、segment 数と shader は同じなので、
  // geometry は unit sphere を 1 回だけ作って shared resource として再利用する
  const shape = new Shape(app.getGPU());
  shape.applyPrimitiveAsset(Primitive.sphere(1.0, 28, 20, shape.getPrimitiveOptions()));
  shape.endShape();
  return shape;
}

// 深度の`sphere`を生成し、後続処理で利用できる状態にする
function createDepthSphere(app, sourceShape, name, options) {
  // 色は instance ごとに変えたいが、頂点バッファまでは増やしたくないため、
  // shared sphere resource を参照する instance に材質だけ個別設定する
  const shape = sourceShape.createInstance();
  shape.setMaterial("smooth-shader", {
    has_bone: 0,
    ...makeMaterial(options.color, 0.70, 1.00, 58.0)
  });

  const node = app.space.addNode(null, name);
  node.setPosition(options.x, options.y, options.z);
  node.setScale(options.radius);
  node.addShape(shape);
  return node;
}

// 深度の`band`を生成し、後続処理で利用できる状態にする
function createDepthBand(app, sourceShape, prefix, entries) {
  const nodes = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    nodes.push(createDepthSphere(app, sourceShape, `${prefix}_${i}`, entry));
  }
  return nodes;
}

// 深度の`marker`を生成し、後続処理で利用できる状態にする
function createDepthMarker(app, name, options) {
  const shape = new Shape(app.getGPU());
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

// `focus`の`guide`を生成し、後続処理で利用できる状態にする
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

// `focus`の`guide`を現在の入力と実行状態に合わせて更新する
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

// このインスタンスの初期化段階で、必要な状態と資源を準備して処理を開始する
async function start() {
  app = new WebgApp({
    document,
    autoDrawScene: false,
    frameTiming: true,
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
      mode: "release",
      system: "dof",
      source: "samples/dof/main.js",
      probeDefaultAfterFrames: 1
    }
  });
  await app.init();
  // dof sample でも bloom と同じ help panel を使い、
  // 操作説明は左上 panel、current value は CommandPalette と diagnostics に分けて読む
  app.showOverlayPanel(buildHelpPanelOptions({
    id: "dofHelpOverlay",
    collapsed: true,
    lines: GUIDE_LINES
  }));

  const orbit = app.createOrbitEyeRig({
    target: [0.0, 0.0, 0.0],
    distance: 36.0,
    yaw: 18.0,
    pitch: -10.0,
    minDistance: 16.0,
    maxDistance: 88.0,
    wheelZoomStep: 1.3
  });

  const dof = new DofPass(app.getGPU(), {
    width: app.screen.getWidth(),
    height: app.screen.getHeight(),
    dofMode: DOF_DEFAULT.dofMode,
    focusDistance: DOF_DEFAULT.focusDistance,
    focusRange: DOF_DEFAULT.focusRange,
    maxBlurMix: DOF_DEFAULT.maxBlurMix,
    sharpnessWidth: DOF_DEFAULT.sharpnessWidth,
    sharpnessPower: DOF_DEFAULT.sharpnessPower,
    blurScale: DOF_DEFAULT.blurScale,
    stageBlurIterations: DOF_DEFAULT.stageBlurIterations,
    blurRadius: DOF_DEFAULT.blurRadius,
    stagedStageCount: DOF_DEFAULT.stagedStageCount
  });
  await dof.ready;
  app.dofPass = dof;

  const debugPass = new FullscreenPass(app.getGPU(), {
    targetFormat: app.getGPU().format
  });
  await debugPass.init();

  app.setDiagnosticsStage("runtime");
  const sharedSphereShape = createSharedSphereSource(app);

  createDepthMarker(app, "markerNear", { x: -13.0, y: 0.0, z: 16.0, radius: 0.45, height: 22.5, color: [0.90, 0.36, 0.28, 1.0] });
  createDepthMarker(app, "markerMid", { x: 0.0, y: 0.0, z: 0.0, radius: 0.45, height: 25.5, color: [0.92, 0.84, 0.36, 1.0] });
  createDepthMarker(app, "markerFar", { x: 13.0, y: 0.0, z: -16.0, radius: 0.45, height: 28.5, color: [0.36, 0.82, 1.0, 1.0] });

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
    dofView: "composite",
    background: "deep",
    benchmark: {
      warmupFrames: BENCHMARK_DEFAULT.warmupFrames,
      sampleFrames: BENCHMARK_DEFAULT.sampleFrames,
      running: false,
      lastResult: null,
      runner: null
    }
  };
  app.dofBenchmark = state.benchmark;
  app.dofBackgroundName = setBackgroundColor(app, state.background);

  // `focus`の`guide`の`text`を現在の入力と状態から求め、呼び出し元へ返す
  function getFocusGuideText() {
    const pos = focusGuide.center.getPosition();
    return `(${pos[0].toFixed(1)}, ${pos[1].toFixed(1)}, ${pos[2].toFixed(1)})`;
  }

  // 診断情報の統計情報を現在の入力と実行状態に合わせて更新する
  function refreshDiagnosticsStats() {
    const blurScale = readDofBlurScale(dof);
    app.mergeDiagnosticsStats({
      dofEnabled: dof.enabled ? "yes" : "no",
      dofMode: dof.dofMode,
      dofView: state.dofView,
      background: state.background,
      focusDistance: formatDiagnosticNumber(dof.focusDistance, 1),
      focusRange: formatDiagnosticNumber(dof.focusRange, 1),
      sharpnessWidth: formatDiagnosticNumber(dof.sharpnessWidth, 2),
      sharpnessPower: formatDiagnosticNumber(dof.sharpnessPower, 2),
      maxBlurMix: formatDiagnosticNumber(dof.maxBlurMix, 2),
      blurScale: formatDiagnosticNumber(blurScale, 2),
      blurQuality: Number.isFinite(blurScale) ? getBlurQualityLabel(blurScale) : "unavailable",
      stageBlurIterations: formatStageBlurIterations(dof),
      blurRadius: formatDiagnosticNumber(dof.blurRadius, 2),
      stagedStageCount: dof.getStagedStageCount(),
      focusGuide: getFocusGuideText(),
      sceneTargetWidth: dof.getSceneTarget().getWidth(),
      sceneTargetHeight: dof.getSceneTarget().getHeight(),
      blurTargetWidth: dof.getBlurTargetA()?.getWidth?.() ?? 0,
      blurTargetHeight: dof.getBlurTargetA()?.getHeight?.() ?? 0,
      benchmarkStatus: getBenchmarkStatusText(state.benchmark),
      benchmarkWarmup: state.benchmark.warmupFrames,
      benchmarkSamples: state.benchmark.sampleFrames
    });
  }

  // 検査情報のレポートを生成し、後続処理で利用できる状態にする
  function makeProbeReport(frameCount) {
    const report = app.createProbeReport("runtime-probe");
    const blurScale = readDofBlurScale(dof);
    Diagnostics.addDetail(report, `view=${state.dofView}`);
    Diagnostics.addDetail(report, `dof=${dof.enabled ? "ON" : "OFF"}`);
    Diagnostics.mergeStats(report, {
      frameCount,
      dofMode: dof.dofMode,
      background: state.background,
      focusDistance: formatDiagnosticNumber(dof.focusDistance, 1),
      focusRange: formatDiagnosticNumber(dof.focusRange, 1),
      sharpnessWidth: formatDiagnosticNumber(dof.sharpnessWidth, 2),
      sharpnessPower: formatDiagnosticNumber(dof.sharpnessPower, 2),
      maxBlurMix: formatDiagnosticNumber(dof.maxBlurMix, 2),
      blurScale: formatDiagnosticNumber(blurScale, 2),
      blurQuality: Number.isFinite(blurScale) ? getBlurQualityLabel(blurScale) : "unavailable",
      stageBlurIterations: formatStageBlurIterations(dof),
      blurRadius: formatDiagnosticNumber(dof.blurRadius, 2),
      stagedStageCount: dof.getStagedStageCount(),
      focusGuide: getFocusGuideText(),
      sceneTargetWidth: dof.getSceneTarget().getWidth(),
      sceneTargetHeight: dof.getSceneTarget().getHeight(),
      blurTargetWidth: dof.getBlurTargetA()?.getWidth?.() ?? 0,
      blurTargetHeight: dof.getBlurTargetA()?.getHeight?.() ?? 0,
      benchmarkStatus: getBenchmarkStatusText(state.benchmark),
      benchmarkWarmup: state.benchmark.warmupFrames,
      benchmarkSamples: state.benchmark.sampleFrames
    });
    return report;
  }

  // `benchmark`の`runner`を生成し、後続処理で利用できる状態にする
  function createBenchmarkRunner() {
    // benchmark は現在の利用者設定を基準に組み立て、終了後にその設定へ戻す
    // 表示経路は常に composite へ固定し、debug view の追加 cost を測定へ混ぜない
    const baseSettings = captureDofSettings(dof);
    const cases = BENCHMARK_CASES.map((definition) => cloneBenchmarkCase(baseSettings, definition));
    return {
      startedAt: new Date().toISOString(),
      originalSettings: baseSettings,
      originalView: state.dofView,
      originalBackground: state.background,
      warmupFrames: state.benchmark.warmupFrames,
      sampleFrames: state.benchmark.sampleFrames,
      cases,
      caseIndex: 0,
      phase: "warmup",
      phaseFrame: 0,
      phaseTarget: state.benchmark.warmupFrames,
      currentSamples: [],
      results: [],
      canceled: false
    };
  }

  // `benchmark`の`case`を対象の状態または描画設定へ反映する
  function applyBenchmarkCase(runner) {
    const currentCase = runner.cases[runner.caseIndex];
    if (!currentCase) {
      return;
    }
    applyDofSettings(dof, currentCase.settings);
    state.dofView = "composite";
    runner.phase = "warmup";
    runner.phaseFrame = 0;
    runner.phaseTarget = runner.warmupFrames;
    runner.currentSamples = [];
  }

  // `finalizeBenchmark`は受け取った値を処理し、後続処理で利用する状態または結果を生成する
  function finalizeBenchmark(cancelled = false) {
    const runner = state.benchmark.runner;
    if (!runner) {
      return;
    }
    applyDofSettings(dof, runner.originalSettings);
    state.dofView = runner.originalView;
    state.benchmark.running = false;
    state.benchmark.runner = null;
    if (!cancelled) {
      state.benchmark.lastResult = {
        type: "samples/dof-benchmark",
        version: 1,
        capturedAt: new Date().toISOString(),
        startedAt: runner.startedAt,
        warmupFrames: runner.warmupFrames,
        sampleFrames: runner.sampleFrames,
        system: "dof",
        source: "samples/dof/main.js",
        browser: {
          userAgent: navigator.userAgent,
          language: navigator.language,
          hardwareConcurrency: navigator.hardwareConcurrency ?? null
        },
        screen: {
          canvasWidth: app.screen.getWidth(),
          canvasHeight: app.screen.getHeight(),
          devicePixelRatio: window.devicePixelRatio ?? 1
        },
        background: runner.originalBackground,
        focusSettings: runner.originalSettings,
        timestampSupported: app.frameTimer?.timestampSupported === true,
        results: runner.results
      };
    }
    refreshAfterControlChange();
  }

  // `benchmark`の初期化段階で、必要な状態と資源を準備して処理を開始する
  function startBenchmark() {
    if (state.benchmark.running) {
      state.benchmark.runner.canceled = true;
      return;
    }
    state.benchmark.running = true;
    state.benchmark.runner = createBenchmarkRunner();
    applyBenchmarkCase(state.benchmark.runner);
    refreshAfterControlChange();
  }

  // `benchmark`を指定された形式または保存先へ出力する
  function downloadBenchmark() {
    if (!state.benchmark.lastResult) {
      return;
    }
    downloadBenchmarkJson(state.benchmark.lastResult);
  }

  // `advanceBenchmark`はゲームまたは計測の進行段階を次の状態へ更新する
  function advanceBenchmark() {
    const runner = state.benchmark.runner;
    if (!runner) {
      return;
    }
    if (runner.canceled) {
      finalizeBenchmark(true);
      return;
    }

    const snapshot = readFrameTimingSnapshot(app.frameTimer);
    if (runner.phase === "warmup") {
      runner.phaseFrame += 1;
      if (runner.phaseFrame >= runner.phaseTarget) {
        runner.phase = "sample";
        runner.phaseFrame = 0;
        runner.phaseTarget = runner.sampleFrames;
        runner.currentSamples = [];
      }
      return;
    }

    if (snapshot) {
      runner.currentSamples.push({
        frame: app.screen.getFrameCount(),
        ...snapshot
      });
    }
    runner.phaseFrame += 1;
    if (runner.phaseFrame < runner.phaseTarget) {
      return;
    }

    const currentCase = runner.cases[runner.caseIndex];
    runner.results.push({
      id: currentCase.id,
      label: currentCase.label,
      settings: currentCase.settings,
      summary: summarizeBenchmarkSamples(runner.currentSamples),
      samples: runner.currentSamples.slice()
    });
    runner.caseIndex += 1;
    if (runner.caseIndex >= runner.cases.length) {
      finalizeBenchmark(false);
      return;
    }
    applyBenchmarkCase(runner);
  }

  // 被写界深度を初期状態へ戻し、前回の状態を残さない
  const resetDof = () => {
    dof.setEnabled(true);
    dof.setDofMode(DOF_DEFAULT.dofMode);
    dof.setFocusDistance(DOF_DEFAULT.focusDistance);
    dof.setFocusRange(DOF_DEFAULT.focusRange);
    dof.setMaxBlurMix(DOF_DEFAULT.maxBlurMix);
    dof.setSharpnessWidth(DOF_DEFAULT.sharpnessWidth);
    dof.setSharpnessPower(DOF_DEFAULT.sharpnessPower);
    dof.setBlurScale(DOF_DEFAULT.blurScale);
    dof.setStageBlurIterations(DOF_DEFAULT.stageBlurIterations);
    dof.setBlurRadius(DOF_DEFAULT.blurRadius);
    dof.setStagedStageCount(DOF_DEFAULT.stagedStageCount);
  };

  // Palette操作後に、Help Panel、Palette再描画、再描画予約をまとめて行う
  // DoFの値はDofPass自身を正として保持し、Paletteは常にgetterで現在値を読み直す
  const refreshAfterControlChange = () => {
    palette?.render();
    updateHelpPanel();
    app.requestRender();
  };

  // mode switch buttonのactive表示を、現在のDofPass状態から決める
  // CommandPalette側の見た目と実際のdofModeがずれないようここで一元化する
  const getCommandState = (id) => ({
    active: (id === "mode-staged" && dof.dofMode === "staged") ||
      (id === "bench-run" && state.benchmark.running),
    disabled: ((id !== "bench-run" && id !== "bench-save")
      && state.benchmark.running === true) ||
      (id === "bench-save" && (state.benchmark.running || !state.benchmark.lastResult))
  });

  // button型commandをDofPassのsetterへ変換する
  // stepper/select/toggleはonChangeで扱い、ここではmode switchとresetだけを担当する
  const handleCommand = (id) => {
    if (id === "mode-staged") {
      dof.setDofMode("staged");
    } else if (id === "bench-run") {
      startBenchmark();
      return;
    } else if (id === "bench-save") {
      downloadBenchmark();
      return;
    } else if (id === "reset") {
      resetDof();
      state.dofView = "composite";
    }
    refreshAfterControlChange();
  };

  // DoFの調整値をCommandPaletteへまとめる
  // スマホではcanvasのダブルタップ、PCでは`/`で開け、現在値はstepper/select上に直接表示される
  const createPalette = () => {
    palette = new CommandPalette({
      document,
      container: document.body,
      viewport: app.screen.canvas,
      title: "Depth of Field",
      pageRows: 5,
      pageRowsByPage: [5, 5, 5, 5],
      closeOnCommand: false,
      getCommandState,
      onCommand: handleCommand,
      onChange: (id, value) => {
        if (state.benchmark.running) {
          return;
        }
        if (id === "enabled") dof.setEnabled(value);
        else if (id === "focus-distance") dof.setFocusDistance(value);
        else if (id === "focus-range") dof.setFocusRange(value);
        else if (id === "focus-hold") dof.setSharpnessWidth(value);
        else if (id === "blur-radius") dof.setBlurRadius(value);
        else if (id === "max-blur") dof.setMaxBlurMix(value);
        else if (id === "view") state.dofView = value;
        else if (id === "background") {
          state.background = setBackgroundColor(app, value);
          app.dofBackgroundName = state.background;
        }
        else if (id === "quality") dof.setBlurScale(value === "half" ? 0.5 : 1.0);
        else if (id === "small-iter") dof.setStageBlurIterations({ small: value });
        else if (id === "medium-iter") dof.setStageBlurIterations({ medium: value });
        else if (id === "large-iter") dof.setStageBlurIterations({ large: value });
        else if (id === "stage-count") dof.setStagedStageCount(value);
        else if (id === "curve") dof.setSharpnessPower(value);
        else if (id === "bench-warmup") state.benchmark.warmupFrames = value;
        else if (id === "bench-samples") state.benchmark.sampleFrames = value;
        refreshAfterControlChange();
      },
      commands: [
        // 1ページ目
        { type: "toggle", id: "enabled", label: "DOF", detail: "on/off", value: () => dof.enabled },
        { id: "mode-staged", label: "Staged", detail: "blur", modeSwitch: true },
        null,
        { id: "palette-next", label: "Next", detail: "page", pageSwitch: true },
        { type: "stepper", id: "focus-distance", label: "Focus Dist", value: () => dof.focusDistance, min: 4.0, max: 90.0, step: 1.5, decimals: 1, input: true },
        { type: "stepper", id: "focus-range", label: "Focus Range", value: () => dof.focusRange, min: 1.0, max: 30.0, step: 0.8, decimals: 1, input: true },
        { type: "stepper", id: "focus-hold", label: "Focus Hold", value: () => dof.sharpnessWidth, min: 0.0, max: 0.95, step: 0.05, decimals: 2, input: true },
        { type: "stepper", id: "blur-radius", label: "Blur Radius", value: () => dof.blurRadius, min: 0.3, max: 8.0, step: 0.35, decimals: 2, input: true },
        // 2ページ目
        null,
        null,
        null,
        { id: "palette-next", label: "Next", detail: "page", pageSwitch: true },
        { type: "stepper", id: "max-blur", label: "Max Blur", value: () => dof.maxBlurMix, min: 0.0, max: 1.0, step: 0.08, decimals: 2, input: true },
        { type: "select", id: "view", label: "View", value: () => state.dofView, options: [
          { value: "composite", label: "composite" },
          { value: "scene", label: "scene" },
          { value: "depth", label: "depth" },
          { value: "focusMask", label: "focusMask" },
          { value: "stageMask", label: "stageMask" },
          { value: "blurSmall", label: "blurSmall" },
          { value: "blurMedium", label: "blurMedium" },
          { value: "blurLarge", label: "blurLarge" }
        ] },
        { type: "select", id: "background", label: "Background", value: () => state.background, options: BACKGROUND_OPTIONS.map((option) => ({
          value: option.value,
          label: option.label
        })) },
        { type: "select", id: "quality", label: "Quality", value: () => getBlurQualityLabel(readDofBlurScale(dof)), options: [
          { value: "full", label: "full" },
          { value: "half", label: "half" }
        ] },
        // 3ページ目
        null,
        null,
        null,
        { id: "palette-next", label: "Next", detail: "page", pageSwitch: true },
        { type: "stepper", id: "small-iter", label: "Small Iter", value: () => dof.getStageBlurIterations().small, min: 1, max: 6, step: 1, decimals: 0, input: true },
        { type: "stepper", id: "medium-iter", label: "Medium Iter", value: () => dof.getStageBlurIterations().medium, min: 1, max: 6, step: 1, decimals: 0, input: true },
        { type: "stepper", id: "large-iter", label: "Large Iter", value: () => dof.getStageBlurIterations().large, min: 1, max: 6, step: 1, decimals: 0, input: true },
        { type: "stepper", id: "stage-count", label: "Stage Cnt", value: () => dof.getStagedStageCount(), min: 1, max: 3, step: 1, decimals: 0, input: true },
        // 4ページ目
        null,
        null,
        null,
        { id: "palette-next", label: "Next", detail: "page", pageSwitch: true },
        { type: "stepper", id: "curve", label: "Curve", value: () => dof.sharpnessPower, min: 0.25, max: 4.0, step: 0.25, decimals: 2, input: true },
        { id: "bench-run", label: "Bench", detail: "run/cancel" },
        { id: "bench-save", label: "JSON", detail: "download" },
        { id: "reset", label: "Reset", detail: "params" },
        null,
        { type: "stepper", id: "bench-warmup", label: "Warmup", value: () => state.benchmark.warmupFrames, min: 5, max: 240, step: 5, decimals: 0, input: true },
        { type: "stepper", id: "bench-samples", label: "Samples", value: () => state.benchmark.sampleFrames, min: 10, max: 360, step: 10, decimals: 0, input: true },
      ]
    });
    palette.attachToCanvas(app.screen.canvas, { key: "/" });
    palette.setStyle(getDefaultCommandPaletteCss());
  };

  createPalette();
  refreshAfterControlChange();

  app.configureDiagnosticsCapture({
    labelPrefix: "dof",
    collect: () => makeProbeReport(app.screen.getFrameCount())
  });
  app.configureDebugKeyInput();

  app.attachInput({
    onKeyDown: async (key, ev) => {
      if (ev.repeat) return;
      let changed = true;
      if (state.benchmark.running && key !== "x") {
        changed = false;
      } else if (key === "x") {
        startBenchmark();
      } else
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
        dof.setBlurRadius(Math.min(8.0, dof.blurRadius + 0.35));
      } else if (key === "7") {
        dof.setMaxBlurMix(Math.max(0.0, dof.maxBlurMix - 0.08));
      } else if (key === "8") {
        dof.setMaxBlurMix(Math.min(1.0, dof.maxBlurMix + 0.08));
      } else if (key === "u") {
        dof.setBlurScale(readDofBlurScale(dof) < 0.75 ? 1.0 : 0.5);
      } else if (key === "v") {
        const order = ["composite", "scene", "depth", "focusMask", "stageMask", "blurSmall", "blurMedium", "blurLarge"];
        const current = order.indexOf(state.dofView);
        state.dofView = order[(current + 1) % order.length];
      } else if (key === "r") {
        resetDof();
      } else {
        changed = false;
      }
      if (changed) {
        refreshAfterControlChange();
      }
    }
  });

  app.start({
    onUpdate: ({ deltaSec, screen }) => {
      app.afterGpuSubmit();
      if (state.benchmark.running) {
        advanceBenchmark();
        app.requestRender();
      }
      if (screen.getFrameCount() === 0 || performance.now() - lastHelpUpdateMs >= 500) {
        updateHelpPanel();
        lastHelpUpdateMs = performance.now();
      }
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
      app.updateDebugProbe();
    },
    onBeforeDraw: ({ renderFrameToken }) => {
      // beginScene() はコア側で寸法変化を判定し、必要な場合だけtargetを再生成する
      // sceneTarget には通常の forward 描画結果をそのまま入れる
      // ここで直接光specularを落とすと、blur画像へ切り替わった瞬間に
      // highlightだけが消えて不自然になるため、DoFでも照明済みscene colorを使う
      app.beginGpuTiming();
      dof.beginScene(app.screen, app.clearColor, {
        // tokenはCameraFrameの内部値を公開せず、同一描画frameであることだけをpassへ伝える
        renderFrameToken,
        timestampWrites: app.getGpuRenderTimestampWrites(true, false)
      });
      // scene geometryとDoF depth復元を同じ描画フレーム識別子へ固定する
      app.space.draw(renderFrameToken);
    },
    onAfterDraw3d: ({ renderFrameToken }) => {
      dof.render(app.screen, {
        renderFrameToken,
        clearColor: app.clearColor,
        timestampWrites: app.getGpuRenderTimestampWrites(false, true)
      });
      // timestamp query の resolve は RenderPassEncoder を閉じてからでないと記録できない
      // 通常の present() なら自動で閉じるが、GPU timing はその前に resolve を追加するため明示的に閉じる
      app.getGPU().endPass();
      app.endGpuTiming(app.getGPU().commandEncoder);

      if (state.dofView !== "composite") {
        const debugSource = state.dofView === "scene"
          ? dof.getSceneTarget()
          : state.dofView === "depth"
            ? dof.getDepthDebugTarget()
            : state.dofView === "focusMask"
              ? dof.getFocusDebugTarget()
              : state.dofView === "stageMask"
                ? dof.getStageDebugTarget()
                : state.dofView === "blurSmall"
                  ? dof.getSmallBlurTarget()
                  : state.dofView === "blurMedium"
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
}
