// ---------------------------------------------
// samples/transmission/main.js  2026/08/14
//   Screen-space PBR transmission and refraction comparison
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import CommandPalette, {
  getDefaultCommandPaletteCss
} from "../../webg/CommandPalette.js";
import ComputeEffectPipeline from "../../webg/ComputeEffectPipeline.js";
import Diagnostics from "../../webg/Diagnostics.js";
import FullscreenPass from "../../webg/FullscreenPass.js";
import {
  buildErrorPanelOptions,
  buildHelpPanelOptions
} from "../../webg/OverlayPanelPresets.js";
import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";
import {
  TRANSMISSION_DEFAULTS
} from "../../webg/TransparencyPass.js";
import util from "../../webg/util.js";
import WebgApp from "../../webg/WebgApp.js";
import ProceduralMaterials from "../../webg/ProceduralMaterials.js";

const DEFAULT_STATE = {
  enabled: true,
  paused: false,
  rayDebug: false,
  selectedMaterial: "sphere",
  materials: {
    sphere: { strength: 0.92, ior: 1.33, roughness: 0.08, alpha: 0.24, attenuationColor: [0.72, 0.90, 1.00], attenuationDistance: 2.0 },
    slab: { strength: 0.84, ior: 1.52, roughness: 0.16, alpha: 0.28, attenuationColor: [0.82, 1.00, 0.74], attenuationDistance: 1.6 },
    torus: { strength: 0.78, ior: 1.76, roughness: 0.04, alpha: 0.32, attenuationColor: [1.00, 0.78, 0.62], attenuationDistance: 1.2 }
  }
};

// HelpのFPSは0.2秒分のframe数と実経過時間から平均し、瞬間値の細かな揺れを表示しない
const FPS_AVERAGE_INTERVAL_SEC = 0.2;
// 通常frameはprimitive値の比較だけにし、原因分析に必要な状態変化と長いframeだけを保存する
const ANOMALY_LOG_CAPACITY = 64;
const ANOMALY_FRAME_TIME_THRESHOLD_MS = 20.0;
const ANOMALY_FRAGMENTATION_THRESHOLD = 16;
const ANOMALY_BATCH_INCREASE_THRESHOLD = 16;
const ANOMALY_QUEUE_CPU_THRESHOLD_MS = 4.0;

// 既定値をUI編集可能な独立objectへ複製し、Resetでも同じ初期条件を再現する
function createInitialState() {
  return {
    enabled: DEFAULT_STATE.enabled,
    paused: DEFAULT_STATE.paused,
    rayDebug: DEFAULT_STATE.rayDebug,
    selectedMaterial: DEFAULT_STATE.selectedMaterial,
    materials: Object.fromEntries(
      Object.entries(DEFAULT_STATE.materials).map(([key, material]) => [key, {
        ...material,
        attenuationColor: [...material.attenuationColor]
      }])
    )
  };
}

const state = createInitialState();
const transmissiveShapes = new Map();
const animatedNodes = [];
const surfaceMaterialHandles = new Map();
let app = null;
let pipeline = null;
let copyPass = null;
let palette = null;
let surfaceMaterials = null;
let lastHelpText = "";
let displayedFps = null;
let fpsElapsedSec = 0.0;
let fpsFrameCount = 0;
const transmissionAnomalyLog = {
  capacity: ANOMALY_LOG_CAPACITY,
  count: 0,
  writeIndex: 0,
  entries: new Array(ANOMALY_LOG_CAPACITY)
};
let lastObservedQueueFrameSequence = 0;
let hasPreviousQueueSummary = false;
let previousBatchCount = 0;
let previousFragmentationCount = 0;
let previousGlobalSortInstanceCount = 0;
let previousAmbiguousPairCount = 0;
let previousIgnoredSmallOverlapPairCount = 0;
let previousQueueTotalMs = 0.0;

// ring内部順ではなく古い順へ並べたcopyは、利用者がconsoleから要求したときだけ生成する
window.transmissionAnomalyLog = transmissionAnomalyLog;
window.getTransmissionAnomalyLog = () => {
  const ordered = [];
  const count = transmissionAnomalyLog.count;
  const start = count < ANOMALY_LOG_CAPACITY ? 0 : transmissionAnomalyLog.writeIndex;
  for (let index = 0; index < count; index++) {
    ordered.push(
      transmissionAnomalyLog.entries[(start + index) % ANOMALY_LOG_CAPACITY]
    );
  }
  return ordered;
};

// 未計測のnullを保持したまま、取得済み時間だけをmicrosecond相当の小数3桁へ丸める
// Diagnostics JSONで文字列ではなく数値として出し、後から表計算や比較scriptへ渡せるようにする
function roundTiming(value) {
  return Number.isFinite(value) ? Number(value.toFixed(3)) : null;
}

// TransparencyPassの階層化snapshotをF9+Mのflatなstatsへ展開し、区間名をJSON keyへ固定する
// GPU未対応時はnullを残し、0 msという実測値とtimestamp-query未取得を区別する
function createPerformanceDiagnostics(snapshot) {
  const gpu = snapshot.gpu;
  const cpu = snapshot.cpu;
  return {
    transmissionTimestampQuery: snapshot.timestampSupported,
    transmissionGpuSampleCount: gpu.forward?.sampleCount ?? 0,
    transmissionTriangleCount: snapshot.queue?.triangleCount ?? 0,
    transmissionBatchCount: snapshot.queue?.batchCount ?? 0,
    transmissionInstanceCount: snapshot.queue?.instanceCount ?? 0,
    transmissionIndependentInstanceCount: snapshot.queue?.independentInstanceCount ?? 0,
    transmissionGlobalSortInstanceCount: snapshot.queue?.globallySortedInstanceCount ?? 0,
    transmissionAmbiguousPairCount: snapshot.queue?.ambiguousPairCount ?? 0,
    transmissionCoarseAmbiguousPairCount: snapshot.queue?.coarseAmbiguousPairCount ?? 0,
    transmissionTightBoundsGroupCount: snapshot.queue?.tightBoundsGroupCount ?? 0,
    transmissionTightBoundsUnavailableGroupCount:
      snapshot.queue?.tightBoundsUnavailableGroupCount ?? 0,
    transmissionIgnoredSmallOverlapPairCount:
      snapshot.queue?.ignoredSmallOverlapPairCount ?? 0,
    transmissionMaximumIgnoredOverlapPixels: roundTiming(
      snapshot.queue?.maximumIgnoredOverlapPixels
    ),
    transmissionGpuMaskMs: roundTiming(gpu.transmissionMask?.averageMs),
    transmissionGpuVolumeMs: roundTiming(gpu.transmissionVolume?.averageMs),
    transmissionGpuExitMs: roundTiming(gpu.transmissionExit?.averageMs),
    transmissionGpuRefractionMs: roundTiming(gpu.transmissionComposite?.averageMs),
    transmissionGpuPyramidMs: roundTiming(gpu.frostPyramid?.averageMs),
    transmissionGpuRoughnessMaskMs: roundTiming(gpu.roughnessMask?.averageMs),
    transmissionGpuFrostCompositeMs: roundTiming(gpu.frostComposite?.averageMs),
    transmissionGpuForwardMs: roundTiming(gpu.forward?.averageMs),
    transmissionGpuTotalMs: roundTiming(snapshot.gpuTotalAverageMs),
    transmissionCpuSceneSummaryMs: roundTiming(cpu.sceneSummary?.averageMs),
    transmissionCpuQueueCollectMs: roundTiming(cpu.queueCollect?.averageMs),
    transmissionCpuQueueSortMs: roundTiming(cpu.queueSort?.averageMs),
    transmissionCpuQueuePrepareMs: roundTiming(cpu.queuePrepare?.averageMs),
    transmissionCpuQueueTotalMs: roundTiming(cpu.queueTotal?.averageMs),
    transmissionCpuMaskEncodeMs: roundTiming(cpu.transmissionMaskEncode?.averageMs),
    transmissionCpuVolumeEncodeMs: roundTiming(cpu.transmissionVolumeEncode?.averageMs),
    transmissionCpuExitEncodeMs: roundTiming(cpu.transmissionExitEncode?.averageMs),
    transmissionCpuRefractionEncodeMs: roundTiming(cpu.transmissionCompositeEncode?.averageMs),
    transmissionCpuPyramidEncodeMs: roundTiming(cpu.frostPyramidEncode?.averageMs),
    transmissionCpuRoughnessMaskEncodeMs: roundTiming(cpu.roughnessMaskEncode?.averageMs),
    transmissionCpuFrostCompositeEncodeMs: roundTiming(cpu.frostCompositeEncode?.averageMs),
    transmissionCpuForwardEncodeMs: roundTiming(cpu.forwardEncode?.averageMs),
    transmissionCpuEncodeMs: roundTiming(cpu.transparencyEncode?.averageMs)
  };
}

// 不透明と透明で同じ公開material fieldを使い、G-bufferと透明Forwardの入力差を作らない
function createMaterial(color, options = {}) {
  return {
    has_bone: 0,
    use_texture: 0,
    color: [color[0], color[1], color[2], 1.0],
    alpha: options.alpha ?? 1.0,
    ambient: 0.0,
    specular: options.specular ?? 0.55,
    roughness: options.roughness ?? 0.45,
    metallic: options.metallic ?? 0.0,
    power: 0.0,
    emissive: options.emissive ?? 0.0,
    flat_shading: options.flatShading ?? 0
  };
}

// Primitive assetをShapeへ確定し、materialを一箇所で登録する
function createPrimitiveShape(gpu, primitiveAsset, material) {
  const shape = new Shape(gpu);
  shape.applyPrimitiveAsset(primitiveAsset);
  shape.endShape();
  shape.setMaterial("smooth-shader", material);
  return shape;
}

// 4頂点の平面へ生成textureの物理寸法に基づく反復UVを設定する
// mode 1を頂点追加前に選び、1を超えるUVが球面継ぎ目補正で変更されることを防ぐ
function createTexturedPlaneShape(gpu, vertices, surfaceSizeMeters, textureResult, options) {
  if (!Array.isArray(vertices) || vertices.length !== 4) {
    throw new Error("transmission textured plane requires four vertices");
  }
  const surfaceU = util.readFiniteNumber(
    surfaceSizeMeters?.[0],
    "transmission textured plane U size"
  );
  const surfaceV = util.readFiniteNumber(
    surfaceSizeMeters?.[1],
    "transmission textured plane V size"
  );
  // タイルはU、Vともに4倍に拡大
  const tileU = util.readFiniteNumber(
    textureResult?.tileSizeMeters?.[0] * 4,
    "transmission textured plane tile U size"
  );
  const tileV = util.readFiniteNumber(
    textureResult?.tileSizeMeters?.[1] * 4,
    "transmission textured plane tile V size"
  );
  if (surfaceU <= 0.0 || surfaceV <= 0.0 || tileU <= 0.0 || tileV <= 0.0) {
    throw new Error("transmission textured plane sizes must be greater than zero");
  }

  const shape = new Shape(gpu);
  shape.setTextureMappingMode(1);
  shape.setAutoCalcNormals(true);
  const uv = [
    [0.0, 0.0],
    [surfaceU / tileU, 0.0],
    [surfaceU / tileU, surfaceV / tileV],
    [0.0, surfaceV / tileV]
  ];
  const indices = vertices.map((position, index) => (
    shape.addVertexUV(
      util.readFiniteNumber(position?.[0], `transmission plane vertex ${index} x`),
      util.readFiniteNumber(position?.[1], `transmission plane vertex ${index} y`),
      util.readFiniteNumber(position?.[2], `transmission plane vertex ${index} z`),
      uv[index][0],
      uv[index][1]
    ) - 1
  ));
  shape.addPlane(indices);
  shape.endShape();
  textureResult.applyTo(shape, options);
  return shape;
}

// Shapeをroot Nodeへ追加し、配置と姿勢をscene構築側から読み取れる形に保つ
function addShapeNode(name, shape, position, attitude = [0, 0, 0]) {
  const node = app.space.addNode(null, name);
  node.setPosition(...position);
  node.setAttitude(...attitude);
  node.addShape(shape);
  return node;
}

// 透明体の背後全体をレンガ面で覆い、画面空間屈折の移動量を目地と模様から読み取れるようにする
function createReferenceBackground(gpu, brickTexture) {
  const width = 20.0;
  const height = 20.0;
  const wall = createTexturedPlaneShape(
    gpu,
    [
      [-width / 2, -height / 2, 0.0],
      [width / 2, -height / 2, 0.0],
      [width / 2, height / 2, 0.0],
      [-width / 2, height / 2, 0.0]
    ],
    [width, height],
    brickTexture,
    { roughness: 0.72, specular: 0.34, metallic: 0.0, normalStrength: 1.35 }
  );
  addShapeNode("brick-wall", wall, [0.0, 0.0, -8.8]);
}

// Oak板の長軸を奥行き方向へ向け、既存床と同じ上面高さと範囲を一枚の反復UV面で覆う
function createOakFloor(gpu, oakTexture) {
  const width = 18.0;
  const depth = 18.0;
  const floor = createTexturedPlaneShape(
    gpu,
    [
      [-width / 2, 0.0, -depth / 2],
      [-width / 2, 0.0, depth / 2],
      [width / 2, 0.0, depth / 2],
      [width / 2, 0.0, -depth / 2]
    ],
    [depth, width],
    oakTexture,
    { roughness: 0.48, specular: 0.46, metallic: 0.0, normalStrength: 1.20 }
  );
  addShapeNode("oak-floor", floor, [0.0, -2.8, -3.0]);
}

// coreのCompute generatorへcatalogの完成presetを渡し、壁と床が共有するtextureを起動時に一度だけ作る
async function createSurfaceTextures(gpu) {
  surfaceMaterials = new ProceduralMaterials(gpu);
  try {
    for (const presetId of ["brick.running.red", "wood.oak.mixed-sawn"]) {
      const material = await surfaceMaterials.createPreset(presetId);
      surfaceMaterialHandles.set(presetId, material);
    }
  } catch (error) {
    destroySurfaceTextures();
    throw error;
  }
}

// page終了または生成途中の失敗時に、生成texture、parameter buffer、generator参照を明示的に解放する
function destroySurfaceTextures() {
  surfaceMaterialHandles.clear();
  surfaceMaterials?.destroy();
  surfaceMaterials = null;
}

// 球、厚い板、トーラスへ独立した材質値を設定し、形状差と材質差を同じ画面で比較する
function createTransmissionObjects(gpu) {
  const glassMaterial = (color, materialState) => createMaterial(color, {
    alpha: materialState.alpha,
    roughness: materialState.roughness,
    specular: 1.0,
    metallic: 0.0
  });
  const sphereState = state.materials.sphere;
  const slabState = state.materials.slab;
  const torusState = state.materials.torus;
  const sphere = createPrimitiveShape(
    gpu,
    Primitive.sphere(1.85, 40, 28, {}),
    glassMaterial([0.74, 0.92, 1.0], sphereState)
  );
  const slab = createPrimitiveShape(
    gpu,
    Primitive.cuboid(2.8, 4.0, 0.75, {}),
    glassMaterial([0.88, 1.0, 0.82], slabState)
  );
  const torus = createPrimitiveShape(
    gpu,
    Primitive.donut(1.35, 0.48, 32, 20, {}),
    glassMaterial([1.0, 0.84, 0.72], torusState)
  );
  transmissiveShapes.set("sphere", sphere);
  transmissiveShapes.set("slab", slab);
  transmissiveShapes.set("torus", torus);

  // 球は base の周りを回転させる
  const base = app.space.addNode(null, "base");
  base.setPosition(-3.8, 0.0, -2.2);
  base.setAttitude(0, 0, 0);
  const gsphere = app.space.addNode(base, "glass-sphere");
  gsphere.setPosition(0, 0.5, 0);
  gsphere.setAttitude(0, 0, 0);
  gsphere.addShape(sphere);
  // アニメーションさせるノードをまとめる
  animatedNodes.push(
    base,
    addShapeNode("glass-slab", slab, [0.0, 0.0, -2.4], [0, 18, 0]),
    addShapeNode("glass-torus", torus, [3.8, 0.0, -2.1], [68, 12, 0])
  );
}

// Oak床、レンガ壁、三種類の透明形状を作り、屈折前後を一画面で比較できるsceneにする
async function createScene() {
  const gpu = app.getGPU();
  await createSurfaceTextures(gpu);
  try {
    createOakFloor(gpu, surfaceMaterialHandles.get("wood.oak.mixed-sawn"));
    createReferenceBackground(gpu, surfaceMaterialHandles.get("brick.running.red"));
    createTransmissionObjects(gpu);
  } catch (error) {
    destroySurfaceTextures();
    throw error;
  }
}

// 各材質のTransmission、IOR、吸収、Alpha、roughnessを対応するShapeへ個別に反映する
// Thicknessは2D offset用の互換入力で、2面屈折には使わないためsampleから設定しない
function applyMaterialState() {
  for (const [key, shape] of transmissiveShapes) {
    const material = state.materials[key];
    shape.updateMaterial({
      alpha: material.alpha,
      roughness: material.roughness,
      transmission: material.strength,
      ior: material.ior,
      attenuation_color: material.attenuationColor,
      attenuation_distance: material.attenuationDistance
    });
  }
  document.body.dataset.transmissionEnabled = state.enabled ? "true" : "false";
  app?.requestRender?.();
}

// frame間隔を0.2秒以上蓄積し、その区間のframe数を実経過時間で割った平均FPSを更新する
// 戻り値は表示値が確定したframeだけtrueとなり、HelpのDOM更新頻度を計測間隔へ制限する
function updateDisplayedFps(deltaSec) {
  const elapsedSec = util.readFiniteNumber(deltaSec, "transmission FPS deltaSec", {
    min: 0.0
  });
  if (elapsedSec === 0.0) return false;

  fpsElapsedSec += elapsedSec;
  fpsFrameCount += 1;
  if (fpsElapsedSec < FPS_AVERAGE_INTERVAL_SEC) return false;

  displayedFps = fpsFrameCount / fpsElapsedSec;
  fpsElapsedSec = 0.0;
  fpsFrameCount = 0;
  return true;
}

// GPU／CPU pass統計のsnapshotとDiagnostics向けobjectを0.2秒周期でまとめて更新する
// profilerのsample収集は毎frame継続し、表示用の配列複製・sort・object生成だけを間引く
function updatePerformanceDiagnostics() {
  const selectedMaterial = state.materials[state.selectedMaterial];
  const performanceSnapshot = pipeline.getTransparencyPerformanceSnapshot();
  const performanceDiagnostics = createPerformanceDiagnostics(performanceSnapshot);
  // 画面UIを操作せずに、ブラウザ計測とconsoleから同じsnapshotを取得できるよう公開する
  window.transmissionPerformance = performanceSnapshot;
  document.body.dataset.transmissionTimingReady =
    performanceDiagnostics.transmissionGpuSampleCount >= 30 ? "true" : "false";
  app.mergeDiagnosticsStats({
    transmission: state.enabled ? "on" : "off",
    selectedMaterial: state.selectedMaterial,
    strength: selectedMaterial.strength.toFixed(2),
    ior: selectedMaterial.ior.toFixed(2),
    rayDistance: TRANSMISSION_DEFAULTS.distance.toFixed(1),
    rayHitThickness: TRANSMISSION_DEFAULTS.hitThickness.toFixed(2),
    raySteps: TRANSMISSION_DEFAULTS.steps,
    attenuationR: selectedMaterial.attenuationColor[0].toFixed(2),
    attenuationG: selectedMaterial.attenuationColor[1].toFixed(2),
    attenuationB: selectedMaterial.attenuationColor[2].toFixed(2),
    attenuationDistance: selectedMaterial.attenuationDistance.toFixed(2),
    roughness: selectedMaterial.roughness.toFixed(2),
    alpha: selectedMaterial.alpha.toFixed(2),
    ...performanceDiagnostics
  });
}

// 長いframe、分断増加、queue CPU超過、sort状態変化のframeだけ詳細snapshotをringへ保存する
// onUpdate時点のqueue workspaceは直前renderの状態なので、deltaSecが示す停止frameと対応付けられる
function recordTransmissionAnomaly(deltaSec, screen) {
  const summary = pipeline.getTransparencyQueueFrameSummary();
  if (!summary || summary.frameSequence <= 0
      || summary.frameSequence === lastObservedQueueFrameSequence) {
    return false;
  }
  const deltaMs = util.readFiniteNumber(deltaSec, "transmission anomaly deltaSec", {
    min: 0.0
  }) * 1000.0;
  const priorBatchCount = previousBatchCount;
  const priorFragmentationCount = previousFragmentationCount;
  const priorGlobalSortInstanceCount = previousGlobalSortInstanceCount;
  const priorAmbiguousPairCount = previousAmbiguousPairCount;
  const priorIgnoredSmallOverlapPairCount = previousIgnoredSmallOverlapPairCount;
  const priorQueueTotalMs = previousQueueTotalMs;
  const batchIncrease = hasPreviousQueueSummary
    ? summary.batchCount - priorBatchCount
    : 0;
  const sortStateChanged = hasPreviousQueueSummary && (
    summary.globallySortedInstanceCount !== previousGlobalSortInstanceCount
    || summary.ambiguousPairCount !== previousAmbiguousPairCount
    || summary.ignoredSmallOverlapPairCount !== previousIgnoredSmallOverlapPairCount
  );
  const longFrame = deltaMs >= ANOMALY_FRAME_TIME_THRESHOLD_MS;
  const fragmentationThresholdCrossed = hasPreviousQueueSummary
    && summary.fragmentationCount >= ANOMALY_FRAGMENTATION_THRESHOLD
    && priorFragmentationCount < ANOMALY_FRAGMENTATION_THRESHOLD;
  const batchIncreased = batchIncrease >= ANOMALY_BATCH_INCREASE_THRESHOLD;
  const queueCpuThresholdCrossed = hasPreviousQueueSummary
    && summary.queueTotalMs >= ANOMALY_QUEUE_CPU_THRESHOLD_MS
    && priorQueueTotalMs < ANOMALY_QUEUE_CPU_THRESHOLD_MS;

  lastObservedQueueFrameSequence = summary.frameSequence;
  previousBatchCount = summary.batchCount;
  previousFragmentationCount = summary.fragmentationCount;
  previousGlobalSortInstanceCount = summary.globallySortedInstanceCount;
  previousAmbiguousPairCount = summary.ambiguousPairCount;
  previousIgnoredSmallOverlapPairCount = summary.ignoredSmallOverlapPairCount;
  previousQueueTotalMs = summary.queueTotalMs;
  hasPreviousQueueSummary = true;
  if (!longFrame && !fragmentationThresholdCrossed && !batchIncreased
      && !queueCpuThresholdCrossed && !sortStateChanged) {
    return false;
  }

  const previous = {
    batchCount: priorBatchCount,
    fragmentationCount: priorFragmentationCount,
    globallySortedInstanceCount: priorGlobalSortInstanceCount,
    ambiguousPairCount: priorAmbiguousPairCount,
    ignoredSmallOverlapPairCount: priorIgnoredSmallOverlapPairCount,
    queueTotalMs: Number(priorQueueTotalMs.toFixed(6))
  };
  const triggers = [];
  if (longFrame) triggers.push("frame-time");
  if (fragmentationThresholdCrossed) triggers.push("fragmentation-threshold");
  if (batchIncreased) triggers.push("batch-increase");
  if (queueCpuThresholdCrossed) triggers.push("queue-cpu-threshold");
  if (sortStateChanged) triggers.push("sort-state-change");
  const debugSnapshot = pipeline.getTransparencyQueueDebugSnapshot();
  const record = {
    queueFrameSequence: summary.frameSequence,
    screenFrameCount: screen.getFrameCount(),
    capturedAtMs: Number(performance.now().toFixed(3)),
    deltaMs: Number(deltaMs.toFixed(3)),
    displayedFps: Number.isFinite(displayedFps) ? Number(displayedFps.toFixed(3)) : null,
    triggers,
    previous,
    summary: {
      triangleCount: summary.triangleCount,
      batchCount: summary.batchCount,
      batchIncrease,
      fragmentationCount: summary.fragmentationCount,
      instanceCount: summary.instanceCount,
      independentInstanceCount: summary.independentInstanceCount,
      globallySortedInstanceCount: summary.globallySortedInstanceCount,
      ambiguousPairCount: summary.ambiguousPairCount,
      coarseAmbiguousPairCount: summary.coarseAmbiguousPairCount,
      tightBoundsGroupCount: summary.tightBoundsGroupCount,
      tightBoundsUnavailableGroupCount: summary.tightBoundsUnavailableGroupCount,
      ignoredSmallOverlapPairCount: summary.ignoredSmallOverlapPairCount,
      maximumIgnoredOverlapPixels: Number(
        summary.maximumIgnoredOverlapPixels.toFixed(6)
      ),
      queueCollectMs: Number(summary.queueCollectMs.toFixed(6)),
      queueSortMs: Number(summary.queueSortMs.toFixed(6)),
      queuePrepareMs: Number(summary.queuePrepareMs.toFixed(6)),
      queueTotalMs: Number(summary.queueTotalMs.toFixed(6))
    },
    detail: debugSnapshot
  };
  transmissionAnomalyLog.entries[transmissionAnomalyLog.writeIndex] = record;
  transmissionAnomalyLog.writeIndex =
    (transmissionAnomalyLog.writeIndex + 1) % ANOMALY_LOG_CAPACITY;
  transmissionAnomalyLog.count = Math.min(
    transmissionAnomalyLog.count + 1,
    ANOMALY_LOG_CAPACITY
  );
  document.body.dataset.transmissionAnomalyCount = String(transmissionAnomalyLog.count);
  return true;
}

// 操作値と近似範囲をHelp panelへまとめ、画面を見ながら数値の意味を確認できるようにする
function buildHelpLines() {
  const selected = state.materials[state.selectedMaterial];
  // WebgAppのFrameTimerが求めたframe間隔と処理時間の割合をそのまま使い、
  // sample側でGPUとJavaScriptの計測区間や未取得値の扱いを重複実装しない
  const frameTimingLines = app?.getFrameTimingLines?.() ?? [
    "Frame timing: measuring..."
  ];
  return [
    "Transmission / screen-space refraction",
    "CommandPalette: double tap canvas or press /",
    "Drag or Arrow keys: orbit camera",
    `FPS: ${displayedFps === null ? "measuring..." : displayedFps.toFixed(1)} (0.2 s average)`,
    ...frameTimingLines,
    "",
    `Transmission: ${state.enabled ? "ON" : "OFF"}`,
    `Ray status debug: ${state.rayDebug ? "ON" : "OFF"}`,
    ...(state.rayDebug ? [
      "Debug: red invalid volume / orange entry refraction",
      "Debug: magenta boundary miss / yellow TIR after one reflection",
      "Debug: cyan outside distance / green background miss"
    ] : []),
    `Selected: ${state.selectedMaterial} / strength ${selected.strength.toFixed(2)}`,
    `IOR: ${selected.ior.toFixed(2)} / front-back boundaries + one reflection`,
    `Absorption RGB: ${selected.attenuationColor.map((value) => value.toFixed(2)).join(" / ")}`,
    `Attenuation distance: ${selected.attenuationDistance.toFixed(2)}`,
    `Surface: roughness ${selected.roughness.toFixed(2)} / alpha ${selected.alpha.toFixed(2)}`,
    `Ray: distance ${TRANSMISSION_DEFAULTS.distance.toFixed(1)} / hit ${TRANSMISSION_DEFAULTS.hitThickness.toFixed(2)} / steps ${TRANSMISSION_DEFAULTS.steps}`,
    "Sphere / slab / torus keep independent material values",
    "One internal reflection is supported; screen edge and overlapping volumes remain limits"
  ];
}

// Help内容が変化した場合だけDOMを更新し、frameごとのpanel再構築を避ける
function updateHelpPanel() {
  const lines = buildHelpLines();
  const text = lines.join("\n");
  if (text === lastHelpText) return;
  app.updateOverlayPanel("transmissionHelp", { lines });
  lastHelpText = text;
}

// 初期値へ戻した後にmaterial、Help、Palette、再描画要求を同じ順序で同期する
function resetState() {
  const initial = createInitialState();
  state.enabled = initial.enabled;
  state.paused = initial.paused;
  state.rayDebug = initial.rayDebug;
  state.selectedMaterial = initial.selectedMaterial;
  state.materials = initial.materials;
  applyMaterialState();
  updateHelpPanel();
  palette?.render();
}

// CommandPaletteは1ページ5行を保ち、Nextを各ページの右上へ固定する
function createPalette() {
  palette = new CommandPalette({
    document,
    container: document.body,
    viewport: app.screen.canvas,
    title: "Transmission",
    pageRows: 5,
    pageRowsByPage: [5, 5, 5],
    closeOnCommand: false,
    getCommandState: (id) => ({
      active: id === `select-${state.selectedMaterial}`
    }),
    onChange: (id, value) => {
      const material = state.materials[state.selectedMaterial];
      if (id === "enabled") state.enabled = value;
      else if (id === "paused") state.paused = value;
      else if (id === "ray-debug") state.rayDebug = value;
      else if (id === "strength") material.strength = value;
      else if (id === "ior") material.ior = value;
      else if (id === "roughness") material.roughness = value;
      else if (id === "alpha") material.alpha = value;
      else if (id === "attenuation-r") material.attenuationColor[0] = value;
      else if (id === "attenuation-g") material.attenuationColor[1] = value;
      else if (id === "attenuation-b") material.attenuationColor[2] = value;
      else if (id === "attenuation-distance") material.attenuationDistance = value;
      applyMaterialState();
      updateHelpPanel();
      palette.render();
    },
    onCommand: (id) => {
      if (id === "reset") {
        resetState();
        return;
      }
      if (id === "select-sphere" || id === "select-slab" || id === "select-torus") {
        state.selectedMaterial = id.slice("select-".length);
        updateHelpPanel();
        palette.render();
      }
    },
    commands: [
      { type: "toggle", id: "enabled", label: "Transmission", detail: "on/off", value: () => state.enabled },
      { type: "toggle", id: "paused", label: "Pause", detail: "motion", value: () => state.paused },
      { id: "reset", label: "Reset", detail: "defaults" },
      { id: "palette-next", label: "Next", detail: "page", pageSwitch: true },
      { id: "select-sphere", label: "Sphere", detail: "material", modeSwitch: true },
      { id: "select-slab", label: "Slab", detail: "material", modeSwitch: true },
      { id: "select-torus", label: "Torus", detail: "material", modeSwitch: true },
      { type: "toggle", id: "ray-debug", label: "Ray Debug", detail: "status", value: () => state.rayDebug },
      { type: "stepper", id: "strength", label: "Transmission", value: () => state.materials[state.selectedMaterial].strength, min: 0.0, max: 1.0, step: 0.05, decimals: 2, input: true },
      { type: "stepper", id: "ior", label: "IOR", value: () => state.materials[state.selectedMaterial].ior, min: 1.0, max: 2.5, step: 0.05, decimals: 2, input: true },
      null,
      { type: "toggle", id: "enabled", label: "Transmission", detail: "on/off", value: () => state.enabled },
      { type: "toggle", id: "paused", label: "Pause", detail: "motion", value: () => state.paused },
      { id: "reset", label: "Reset", detail: "defaults" },
      { id: "palette-next", label: "Next", detail: "page", pageSwitch: true },
      { id: "select-sphere", label: "Sphere", detail: "material", modeSwitch: true },
      { id: "select-slab", label: "Slab", detail: "material", modeSwitch: true },
      { id: "select-torus", label: "Torus", detail: "material", modeSwitch: true },
      null,
      { type: "stepper", id: "roughness", label: "Roughness", value: () => state.materials[state.selectedMaterial].roughness, min: 0.04, max: 1.0, step: 0.04, decimals: 2, input: true },
      { type: "stepper", id: "alpha", label: "Surface Alpha", value: () => state.materials[state.selectedMaterial].alpha, min: 0.02, max: 0.98, step: 0.04, decimals: 2, input: true },
      null,
      { type: "toggle", id: "enabled", label: "Transmission", detail: "on/off", value: () => state.enabled },
      { type: "toggle", id: "paused", label: "Pause", detail: "motion", value: () => state.paused },
      { id: "reset", label: "Reset", detail: "defaults" },
      { id: "palette-next", label: "Next", detail: "page", pageSwitch: true },
      { type: "stepper", id: "attenuation-r", label: "Absorption R", value: () => state.materials[state.selectedMaterial].attenuationColor[0], min: 0.0, max: 1.0, step: 0.05, decimals: 2, input: true },
      { type: "stepper", id: "attenuation-g", label: "Absorption G", value: () => state.materials[state.selectedMaterial].attenuationColor[1], min: 0.0, max: 1.0, step: 0.05, decimals: 2, input: true },
      { type: "stepper", id: "attenuation-b", label: "Absorption B", value: () => state.materials[state.selectedMaterial].attenuationColor[2], min: 0.0, max: 1.0, step: 0.05, decimals: 2, input: true },
      { type: "stepper", id: "attenuation-distance", label: "Absorption Dist", value: () => state.materials[state.selectedMaterial].attenuationDistance, min: 0.05, max: 20.0, step: 0.25, decimals: 2, input: true },
    ]
  });
  palette.attachToCanvas(app.screen.canvas, { key: "/" });
  palette.setStyle(getDefaultCommandPaletteCss());
}

// 起動失敗をOverlay、dataset、consoleへ同時に出し、ブラウザ自動確認でも理由を取得可能にする
function reportError(error) {
  document.body.dataset.sampleStatus = "error";
  app?.setDiagnosticsReport?.(Diagnostics.createErrorReport(error, {
    system: "transmission",
    source: "samples/transmission/main.js"
  }));
  app?.showOverlayPanel?.(buildErrorPanelOptions(error, {
    title: "transmission failed",
    id: "transmission-error"
  }));
  console.error("transmission sample failed:", error);
}

// WebgAppの同一Camera FrameでG-buffer、透明mask、屈折、透明Forward、Tone Mapを順に接続する
async function start() {
  app = new WebgApp({
    document,
    autoDrawScene: false,
    renderMode: "ondemand",
    frameTiming: true,
    clearColor: [0.125, 0.145, 0.175, 1.0],
    viewAngle: 50,
    projectionFar: 100,
    camera: {
      target: [0.0, -0.1, -3.4],
      distance: 18.5,
      yaw: 4,
      pitch: -5
    },
    debugTools: {
      mode: "release",
      system: "transmission",
      source: "samples/transmission/main.js",
      probeDefaultAfterFrames: 1
    }
  });
  await app.init();
  app.createOrbitEyeRig({
    target: [0.0, -0.1, -3.4],
    distance: 18.5,
    yaw: 4,
    pitch: -5,
    minDistance: 11,
    maxDistance: 32
  });
  await createScene();

  const helpLines = buildHelpLines();
  app.showOverlayPanel(buildHelpPanelOptions({
    id: "transmissionHelp",
    collapsed: true,
    lines: helpLines
  }));
  lastHelpText = helpLines.join("\n");
  createPalette();

  const gpu = app.getGPU();
  pipeline = new ComputeEffectPipeline(gpu, {
    label: "transmission-sample",
    width: app.screen.getWidth(),
    height: app.screen.getHeight(),
    lighting: {
      // 透明surfaceの陰側と暗色の床を観察できる明るさまで、sample固有の環境光を補う
      ambient: 0.11,
      directionalColor: [1.0, 0.96, 0.99],
      directionalIntensity: 2.85
    },
    toneMap: {
      mode: "reinhard",
      // 線形HDR全体をTone Mapping前に増幅し、レンガ壁、Oak床、屈折像を明るく表示する
      exposure: 2.55,
      saturation: 1.05,
      gamma: 2.2
    }
  });
  copyPass = new FullscreenPass(gpu);
  await Promise.all([pipeline.ready, copyPass.init()]);
  applyMaterialState();

  app.attachInput({
    onKeyDown: async (key, event) => {
      if (event.repeat) return;
      if (key === "t") state.enabled = !state.enabled;
      else if (key === " ") state.paused = !state.paused;
      else if (key === "r") resetState();
      applyMaterialState();
      updateHelpPanel();
      palette.render();
    }
  });
  app.setDiagnosticsStage("runtime");
  app.configureDebugKeyInput();
  document.body.dataset.sampleStatus = "ready";

  app.start({
    // 形状を小さく動かし、entry／exit法線とcamera角度に応じて2面屈折rayが追従することを確認する
    onUpdate: ({ deltaSec, screen }) => {
      app.afterGpuSubmit();
      pipeline.afterGpuSubmit();
      recordTransmissionAnomaly(deltaSec, screen);
      // 同じ0.2秒tickでHelpと計測snapshotを更新し、統計配列の複製・sortを毎frame行わない
      const refreshPerformanceDiagnostics = updateDisplayedFps(deltaSec);
      if (refreshPerformanceDiagnostics) {
        updateHelpPanel();
        updatePerformanceDiagnostics();
      }
      if (!state.paused) {
        animatedNodes[0].rotateX(150.0 * deltaSec);
        animatedNodes[1].rotateY(50.0 * deltaSec);
        animatedNodes[2].rotateX(29.0 * deltaSec);
        animatedNodes[2].rotateY(13.0 * deltaSec);
      }
      pipeline.resize(screen.getWidth(), screen.getHeight());
      app.updateDebugProbe();
    },

    // 不透明物だけをG-bufferへ描き、透明形状は後段TransparencyPassへ残す
    onBeforeDraw: ({ cameraFrame }) => {
      // G-buffer Renderと後続ComputeEffectPipelineを同じframe timing slotへ記録し、
      // HelpのGPU loadが未接続の「--」ではなく実測percentageになるようにする
      app.beginGpuTiming();
      pipeline.renderScene(app.space, cameraFrame, app.clearColor, {
        shadowEnabled: false,
        timestampWrites: app.getGpuRenderTimestampWrites()
      });
    },

    // 線形HDRの不透明背景へ屈折を適用してから透明surfaceを合成し、最後にTone Mapする
    onAfterDraw3d: ({ cameraFrame }) => {
      gpu.endPass();
      const finalColor = pipeline.encode(gpu.commandEncoder, {
        cameraFrame,
        timestampWrites: app.getGpuTimestampWrites(true, true),
        shadowEnabled: false,
        ssaoEnabled: false,
        ssrEnabled: false,
        toonEnabled: false,
        dofEnabled: false,
        bloomEnabled: false,
        edgeEnabled: false,
        fogEnabled: false,
        transparency: {
          transmissionEnabled: state.enabled,
          transmissionStrength: 1.0,
          transmissionRayDebugEnabled: state.rayDebug,
          // HDR environmentを使わないsampleでは背景未到達rayをアプリのclearColorへ置き換える
          transmissionRayMissFallback: "clear"
        }
      });
      // 計測対象passをすべてencodeした後にqueryをresolveし、submit後のreadbackへ渡す
      app.endGpuTiming(gpu.commandEncoder);
      app.screen.beginPresentPass({ clearColor: app.clearColor, colorLoadOp: "clear" });
      copyPass.draw(finalColor);
      app.screen.clearDepthBuffer();
    }
  });

  window.addEventListener("pagehide", () => {
    app.stop();
    palette?.destroy?.();
    copyPass?.destroy?.();
    pipeline?.destroy?.();
    destroySurfaceTextures();
  }, { once: true });
}

document.addEventListener("DOMContentLoaded", () => {
  start().catch(reportError);
});
