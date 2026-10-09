// ---------------------------------------------
// samples/compute_benchmark/main.js  2026/09/03
//   Runtime PBR full-pass GPU baseline benchmark
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import WebgApp from "../../webg/WebgApp.js";
import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";
import FullscreenPass from "../../webg/FullscreenPass.js";
import ComputeEffectPipeline from "../../webg/ComputeEffectPipeline.js";
import PbrEnvironment from "../../webg/PbrEnvironment.js";
import util from "../../webg/util.js";
import { createProceduralEnvironmentData } from "../../webg/ProceduralEnvironment.js";

let app = null;
let pipeline = null;
let copyPass = null;
let pbrEnvironment = null;
let benchmarkLights = [];
let lastResult = null;
let running = false;

const dom = {
  samples: document.getElementById("samples"),
  warmup: document.getElementById("warmup"),
  localLights: document.getElementById("localLights"),
  pbrSsrFusion: document.getElementById("pbrSsrFusion"),
  run: document.getElementById("run"),
  downloadJson: document.getElementById("downloadJson"),
  downloadCsv: document.getElementById("downloadCsv"),
  preview: document.getElementById("preview"),
  status: document.getElementById("status"),
  result: document.getElementById("result")
};

const CLEAR_COLOR = Object.freeze([0.018, 0.026, 0.038, 1.0]);
const BENCHMARK_TONE_MAP_EXPOSURE = 1.0;
const BENCHMARK_SHADOW_MAP_SIZE = 1024;
const BENCHMARK_SSAO_OPTIONS = Object.freeze({
  radius: 2.8,
  strength: 1.28,
  bias: 0.045,
  samples: 12,
  resolutionScale: 1.0
});
const BENCHMARK_SSR_OPTIONS = Object.freeze({
  intensity: 0.82,
  steps: 48,
  distance: 24.0,
  thickness: 0.34,
  resolutionScale: 1.0,
  reflectivityThreshold: 0.02
});
const BENCHMARK_TRANSMISSION_OPTIONS = Object.freeze({
  transmissionEnabled: true,
  transmissionStrength: 1.0,
  transmissionDistance: 42.0,
  transmissionHitThickness: 0.1,
  transmissionSteps: 64
});
const TRANSPARENCY_PROFILE_NAMES = Object.freeze([
  "transmissionMask",
  "transmissionVolume",
  "transmissionExit",
  "transmissionComposite",
  "frostPyramid",
  "roughnessMask",
  "frostComposite",
  "forward"
]);

// 測定条件は結果の意味そのものなので、自動補正せず範囲外入力を例外として通知する
function readIntegerInput(element, label, { min, max }) {
  return util.readFiniteNumber(Number(element.value), label, {
    integer: true,
    min,
    max
  });
}

// 進行状態を一つの表示要素へ集約し、測定中のcase名と完了状態を追跡可能にする
function setStatus(message) {
  dom.status.textContent = message;
}

// 同じGPU resourceへpreviewとbenchmarkが同時にcommandを記録しないよう操作を止める
function setRunning(nextRunning) {
  running = nextRunning;
  dom.run.disabled = nextRunning;
  dom.preview.disabled = nextRunning;
  dom.pbrSsrFusion.disabled = nextRunning;
}

// 一つの計測区間をtimestamp-queryで囲み、外側queryを渡せない複合区間はqueue完了時間で読む
class GpuPassTimer {
  constructor(device, queue) {
    this.device = device;
    this.queue = queue;
    this.supported = device.features?.has?.("timestamp-query") === true;
  }

  // QuerySet、resolve Buffer、readback Bufferを一つのsampleだけに割り当てる
  createSlot(label) {
    return {
      querySet: this.device.createQuerySet({
        label: `${label}:query`,
        type: "timestamp",
        count: 2
      }),
      resolveBuffer: this.device.createBuffer({
        label: `${label}:resolve`,
        size: 16,
        usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC
      }),
      readBuffer: this.device.createBuffer({
        label: `${label}:read`,
        size: 16,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
      })
    };
  }

  // callbackが記録したrender/compute列の直前と直後へtimestampを書き、GPU経過時間を返す
  async measure(label, encodeCallback, options = {}) {
    if (!this.supported) {
      throw new Error("GPU timestamp-query is not supported on this device");
    }
    if (options.timerMode === "queue-wall") {
      return this.measureQueueWall(label, encodeCallback, options);
    }
    const gpu = app.getGPU();
    const slot = this.createSlot(label);
    const timestampWrites = {
      querySet: slot.querySet,
      beginningOfPassWriteIndex: 0,
      endOfPassWriteIndex: 1
    };
    gpu.endPass?.();
    gpu.commandEncoder = this.device.createCommandEncoder({ label: `${label}:encoder` });
    if (typeof gpu.commandEncoder.writeTimestamp === "function") {
      gpu.commandEncoder.writeTimestamp(slot.querySet, 0);
      encodeCallback(gpu.commandEncoder, undefined);
      gpu.endPass?.();
      gpu.commandEncoder.writeTimestamp(slot.querySet, 1);
    } else {
      encodeCallback(gpu.commandEncoder, timestampWrites);
    }
    gpu.endPass?.();
    gpu.commandEncoder.resolveQuerySet(slot.querySet, 0, 2, slot.resolveBuffer, 0);
    gpu.commandEncoder.copyBufferToBuffer(slot.resolveBuffer, 0, slot.readBuffer, 0, 16);
    const commandBuffer = gpu.commandEncoder.finish();
    gpu.commandEncoder = null;
    this.queue.submit([commandBuffer]);
    options.afterSubmit?.();
    await slot.readBuffer.mapAsync(GPUMapMode.READ);
    const values = new BigUint64Array(slot.readBuffer.getMappedRange());
    const start = values[0];
    const end = values[1];
    slot.readBuffer.unmap();
    slot.resolveBuffer.destroy();
    slot.readBuffer.destroy();
    slot.querySet.destroy?.();
    if (end < start) throw new Error(`${label} timestamp end is smaller than start`);
    const milliseconds = Number(end - start) / 1_000_000.0;
    if (!Number.isFinite(milliseconds) || milliseconds < 0.0) {
      throw new Error(`${label} timestamp result is invalid: ${milliseconds}`);
    }
    return milliseconds;
  }

  // 外側timestampをdescriptorへ渡せない複合区間はsubmit直前からqueue完了までを測る
  // command encode時間は開始前に終え、GPU待機を含むwall時間で0表示を避ける
  async measureQueueWall(label, encodeCallback, options = {}) {
    const gpu = app.getGPU();
    gpu.endPass?.();
    gpu.commandEncoder = this.device.createCommandEncoder({ label: `${label}:queue-wall-encoder` });
    encodeCallback(gpu.commandEncoder, undefined);
    gpu.endPass?.();
    const commandBuffer = gpu.commandEncoder.finish();
    gpu.commandEncoder = null;
    const startedAt = performance.now();
    this.queue.submit([commandBuffer]);
    options.afterSubmit?.();
    await this.queue.onSubmittedWorkDone();
    const milliseconds = performance.now() - startedAt;
    if (!Number.isFinite(milliseconds) || milliseconds < 0.0) {
      throw new Error(`${label} queue-wall result is invalid: ${milliseconds}`);
    }
    return milliseconds;
  }
}

// SmoothShaderとPBR Forward Shaderが共有する公開material fieldを一箇所で設定する
function setMaterial(shape, color, options = {}) {
  shape.setMaterial("smooth-shader", {
    has_bone: 0,
    use_texture: 0,
    color: [color[0], color[1], color[2], 1.0],
    alpha: options.alpha ?? 1.0,
    ambient: 0.0,
    specular: options.specular ?? 0.55,
    power: 0.0,
    roughness: options.roughness ?? 0.42,
    metallic: options.metallic ?? 0.0,
    emissive: options.emissive ?? 0.0,
    flat_shading: options.flatShading ?? 0,
    transmission: options.transmission ?? 0.0,
    ior: options.ior ?? 1.5,
    attenuation_color: options.attenuationColor ?? [1.0, 1.0, 1.0],
    attenuation_distance: options.attenuationDistance ?? 1.0
  });
}

// Primitive asset生成、Shape確定、material登録を共通化しscene定義の差だけを読みやすくする
function createShape(gpu, primitiveFactory, color, options = {}) {
  const shape = new Shape(gpu);
  shape.applyPrimitiveAsset(primitiveFactory(shape.getPrimitiveOptions()));
  shape.endShape();
  setMaterial(shape, color, options);
  return shape;
}

// Shapeを固定sceneへ登録し、位置と姿勢をbenchmark条件として明示する
function addShapeNode(name, shape, position, attitude = [0, 0, 0]) {
  const node = app.space.addNode(null, name);
  node.setPosition(...position);
  node.setAttitude(...attitude);
  node.addShape(shape);
  return node;
}

// 金属度、粗さ、Transmissionが異なる固定物体を配置し、全PBR段階へ有効な入力を作る
function createBenchmarkScene() {
  const gpu = app.getGPU();
  addShapeNode(
    "bench_floor",
    createShape(gpu, (options) => Primitive.cuboid(34, 0.8, 28, options), [0.32, 0.36, 0.40], {
      roughness: 0.58,
      metallic: 0.0
    }),
    [0, -4.4, -3]
  );
  addShapeNode(
    "bench_back_wall",
    createShape(gpu, (options) => Primitive.cuboid(34, 13, 0.8, options), [0.44, 0.49, 0.56], {
      roughness: 0.72
    }),
    [0, 1.6, -16.5]
  );
  addShapeNode(
    "bench_left_wall",
    createShape(gpu, (options) => Primitive.cuboid(0.8, 13, 26, options), [0.38, 0.30, 0.25], {
      roughness: 0.66
    }),
    [-16.8, 1.6, -4.0]
  );

  const definitions = [
    { color: [0.92, 0.26, 0.16], roughness: 0.10, metallic: 1.0, factory: (o) => Primitive.cube(3.2, o) },
    { color: [0.12, 0.58, 0.90], roughness: 0.24, metallic: 0.0, factory: (o) => Primitive.sphere(1.9, 36, 24, o) },
    { color: [0.22, 0.76, 0.36], roughness: 0.42, metallic: 0.65, factory: (o) => Primitive.cuboid(2.4, 5.8, 2.4, o) },
    { color: [0.90, 0.72, 0.18], roughness: 0.62, metallic: 1.0, factory: (o) => Primitive.donut(1.4, 0.36, 36, 18, o) },
    { color: [0.66, 0.24, 0.88], roughness: 0.82, metallic: 0.0, factory: (o) => Primitive.cube(2.5, o) },
    { color: [0.88, 0.42, 0.62], roughness: 0.34, metallic: 0.3, factory: (o) => Primitive.sphere(1.55, 32, 20, o) }
  ];
  const transforms = [
    [[-7.8, -1.6, -7.8], [0, 24, 0]],
    [[-2.8, -1.3, -8.4], [0, 0, 0]],
    [[3.2, -1.8, -7.4], [0, -18, 0]],
    [[8.2, -1.1, -8.6], [65, 0, 18]],
    [[-5.2, -0.8, -1.8], [0, 42, 0]],
    [[4.6, -1.4, -1.2], [0, 0, 0]]
  ];
  definitions.forEach((definition, index) => {
    addShapeNode(
      `bench_object_${index}`,
      createShape(gpu, definition.factory, definition.color, definition),
      transforms[index][0],
      transforms[index][1]
    );
  });

  // 閉じた透明球へTransmission、IOR、吸収を明示し、屈折4段階を必ず実行させる
  addShapeNode(
    "bench_transmission",
    createShape(gpu, (options) => Primitive.sphere(2.15, 36, 24, options), [0.28, 0.66, 0.92], {
      alpha: 0.28,
      roughness: 0.18,
      metallic: 0.0,
      transmission: 0.92,
      ior: 1.52,
      attenuationColor: [0.78, 0.92, 1.0],
      attenuationDistance: 2.0
    }),
    [0.4, -1.0, -4.0]
  );
}

// 最大128灯から選べる固定point light列を作り、灯数以外の入力条件をrun間で変えない
function createBenchmarkLights() {
  const palette = [
    [1.0, 0.18, 0.08], [0.08, 0.42, 1.0], [0.10, 1.0, 0.38],
    [1.0, 0.55, 0.08], [0.72, 0.12, 1.0], [0.08, 0.95, 1.0]
  ];
  return Array.from({ length: 128 }, (_, index) => {
    const ring = 4.0 + (index % 6) * 2.2;
    const angle = index * 2.39996;
    return Object.freeze({
      type: "point",
      position: [
        Math.cos(angle) * ring,
        -2.4 + (index % 8) * 1.15,
        -5.0 + Math.sin(angle) * (7.0 + (index % 5) * 1.5)
      ],
      color: palette[index % palette.length],
      radius: 7.5 + (index % 5) * 0.8,
      intensity: 2.8 + (index % 4) * 0.35
    });
  });
}

// PBR全caseへ同じIBL、直接光、Local Light、SSR、Transmission、Tone Map条件を渡す
function createPbrPipelineOptions(cameraFrame, localLights, pbrSsrFusionEnabled) {
  return {
    cameraFrame,
    shadowEnabled: true,
    ssaoEnabled: true,
    ssrEnabled: true,
    pbrSsrFusionEnabled,
    fogEnabled: false,
    toonEnabled: false,
    dofEnabled: false,
    bloomEnabled: false,
    edgeEnabled: false,
    vignetteEnabled: false,
    ssao: BENCHMARK_SSAO_OPTIONS,
    ssr: BENCHMARK_SSR_OPTIONS,
    composer: { mode: "pbr-ssr" },
    transparency: BENCHMARK_TRANSMISSION_OPTIONS,
    lighting: {
      unitSystem: "relative",
      ambient: 0.0,
      environment: pbrEnvironment.getResources(),
      environmentIntensity: 1.0,
      environmentBackground: true,
      environmentRotationDegrees: 0.0,
      directionalColor: [1.0, 0.96, 0.90],
      directionalIntensity: 1.0
    },
    lights: localLights,
    toneMap: {
      mode: "reinhard",
      exposure: BENCHMARK_TONE_MAP_EXPOSURE,
      saturation: 1.0,
      gamma: 2.2,
      blackBackground: false
    }
  };
}

// canvas変更時だけ全画面targetを現在の物理解像度へ揃える
function resizeBenchmarkTargets() {
  pipeline.resize(app.screen.getWidth(), app.screen.getHeight());
}

// WebgAppの共通更新入口から一つのCamera Frameを確定し全passで再利用する
function getCameraFrame() {
  return app.updateCameraFrame();
}

// 個別caseの前にPBR全体を一度実行し、各段階の実在する出力targetを同じ条件で準備する
async function prepareInputs(localLights, pbrSsrFusionEnabled) {
  const gpu = app.getGPU();
  resizeBenchmarkTargets();
  gpu.endPass?.();
  gpu.commandEncoder = gpu.device.createCommandEncoder({ label: "pbr-benchmark:prepare" });
  const cameraFrame = getCameraFrame();
  pipeline.renderScene(app.space, cameraFrame, CLEAR_COLOR, { shadowEnabled: true });
  const options = createPbrPipelineOptions(cameraFrame, localLights, pbrSsrFusionEnabled);
  const finalColor = pipeline.encode(gpu.commandEncoder, options);
  // Two-pass reference caseが使うSSR出力とComposer出力を計測外で準備する
  // full-pbr-pipelineは融合経路を使い、この準備commandの時間は各caseのtimestampへ含めない
  const resources = pipeline.gbuffer.getBindingResources();
  const lighting = pipeline.deferredLightingPass.getOutputTarget();
  const ambientOcclusion = pipeline.ssaoPass.getOutputTarget();
  const reflection = pipeline.ssrPass.encode(gpu.commandEncoder, {
    scene: lighting,
    normal: resources.normal,
    material: resources.material,
    depth: resources.depth
  }, {
    ...BENCHMARK_SSR_OPTIONS,
    cameraFrame,
    enabled: true,
    view: "reflection",
    integrationMode: "pbr"
  });
  const composed = pipeline.composer.encode(gpu.commandEncoder, {
    base: lighting,
    reflection,
    depth: resources.depth,
    specularIbl: pipeline.deferredLightingPass.getSpecularIblTarget(),
    albedo: resources.albedo ?? resources.color,
    normal: resources.normal,
    material: resources.material,
    ambientOcclusion,
    brdfLut: pbrEnvironment.getResources().brdfLut,
    brdfSampler: pbrEnvironment.getResources().sampler
  }, {
    mode: "pbr-ssr",
    intensity: BENCHMARK_SSR_OPTIONS.intensity,
    cameraFrame
  });
  gpu.endPass?.();
  const commandBuffer = gpu.commandEncoder.finish();
  gpu.commandEncoder = null;
  gpu.queue.submit([commandBuffer]);
  pipeline.afterGpuSubmit();
  await gpu.queue.onSubmittedWorkDone();
  return {
    cameraFrame,
    options,
    resources,
    directionalVisibility: pipeline.directionalShadowPass.getOutputTarget(),
    spotVisibility: pipeline.spotShadowPass.outputTarget,
    ambientOcclusion,
    lighting,
    reflection,
    composed,
    transparent: pipeline.transparencyPass.outputTarget,
    finalColor
  };
}

// PBR全体の最終色をpresentし、IBL、SSR、Transmissionが入力sceneで働くことを目視確認する
async function renderPreview() {
  const gpu = app.getGPU();
  resizeBenchmarkTargets();
  gpu.commandEncoder = gpu.device.createCommandEncoder({ label: "pbr-benchmark:preview" });
  const cameraFrame = getCameraFrame();
  const localLights = benchmarkLights.slice(0, readIntegerInput(dom.localLights, "Local Lights", {
    min: 0,
    max: 128
  }));
  const pbrSsrFusionEnabled = dom.pbrSsrFusion.value === "fused";
  pipeline.renderScene(app.space, cameraFrame, CLEAR_COLOR, { shadowEnabled: true });
  const finalColor = pipeline.encode(
    gpu.commandEncoder,
    createPbrPipelineOptions(cameraFrame, localLights, pbrSsrFusionEnabled)
  );
  app.screen.beginPresentPass({ clearColor: CLEAR_COLOR, colorLoadOp: "clear" });
  copyPass.draw(finalColor);
  app.screen.clearDepthBuffer();
  app.screen.present();
  pipeline.afterGpuSubmit();
}

// 配列の算術平均を統計値計算で共用する
function average(values) {
  return values.reduce((sum, value) => sum + value, 0.0) / values.length;
}

// 平均だけでなく中央値と95 percentileを残し、外れ値で最適化判断を誤りにくくする
function summarizeSamples(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const averageMs = average(sorted);
  const variance = average(sorted.map((value) => (value - averageMs) ** 2));
  const middle = Math.floor(sorted.length / 2);
  const medianMs = sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) * 0.5
    : sorted[middle];
  return {
    samples: sorted.length,
    averageMs,
    medianMs,
    percentile95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
    stddevMs: Math.sqrt(variance)
  };
}

// 欠損したプロファイル統計は0にせず明示的な未計測記号で表示する
function formatMs(value) {
  return Number.isFinite(value) ? value.toFixed(3) : "--";
}

// HTML tableをcaseごとの中央値、P95、範囲、sample数が同時に読める形へ更新する
function renderResultTable(result) {
  const rows = result.cases.map((entry) => `
    <tr>
      <td>${entry.name}</td>
      <td>${entry.group}</td>
      <td>${formatMs(entry.averageMs)}</td>
      <td>${formatMs(entry.medianMs)}</td>
      <td>${formatMs(entry.percentile95Ms)}</td>
      <td>${formatMs(entry.minMs)} / ${formatMs(entry.maxMs)}</td>
      <td>${entry.timerMode === "gpu-profiler" ? "profile" : entry.timerMode === "queue-wall" ? "queue" : "gpu"}</td>
      <td>${entry.samples}</td>
    </tr>
  `).join("");
  dom.result.innerHTML = `
    <table>
      <thead><tr>
        <th>case</th><th>group</th><th>avg ms</th><th>median</th>
        <th>P95</th><th>min/max</th><th>timer</th><th>n</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

// Top-level PBR passを現在の公開class境界で個別実行し、前処理時間を測定値へ混ぜない
function getBenchmarkCases(localLights, pbrSsrFusionEnabled) {
  return [
    {
      name: "gbuffer-render",
      group: "geometry",
      run: (prepared, _encoder, timestampWrites) => pipeline.gbuffer.renderSpace(
        app.space,
        prepared.cameraFrame,
        CLEAR_COLOR,
        { timestampWrites }
      )
    },
    {
      name: "shadow-map",
      group: "shadow",
      run: (_prepared, _encoder, timestampWrites) => pipeline.directionalShadowMap.renderSpace(
        app.space,
        pipeline.light.viewProjection,
        { timestampWrites }
      )
    },
    {
      name: "shadow-visibility",
      group: "shadow",
      run: (prepared, encoder, timestampWrites) => pipeline.directionalShadowPass.encode(
        encoder,
        { ...prepared.resources, ...pipeline.directionalShadowMap.getBindingResources() },
        {
          cameraFrame: prepared.cameraFrame,
          lightViewProjection: pipeline.light.viewProjection,
          lightDirection: pipeline.light.direction,
          enabled: true,
          bias: 0.0015,
          normalBias: 0.003,
          pcfRadius: 1,
          timestampWrites
        }
      )
    },
    {
      name: "ssao",
      group: "ambient-occlusion",
      run: (prepared, encoder, timestampWrites) => pipeline.ssaoPass.encode(
        encoder,
        { normal: prepared.resources.normal, depth: prepared.resources.depth },
        { ...BENCHMARK_SSAO_OPTIONS, cameraFrame: prepared.cameraFrame, enabled: true, timestampWrites }
      )
    },
    {
      name: "deferred-lighting-pbr",
      group: "lighting",
      run: (prepared, encoder, timestampWrites) => pipeline.deferredLightingPass.encode(
        encoder,
        {
          ...prepared.resources,
          shadowVisibility: prepared.directionalVisibility,
          spotShadowVisibility: prepared.spotVisibility,
          ambientOcclusion: prepared.ambientOcclusion
        },
        {
          cameraFrame: prepared.cameraFrame,
          directionalLight: {
            direction: pipeline.light.direction,
            color: [1.0, 0.96, 0.90],
            intensity: 1.0
          },
          spotLight: null,
          unitSystem: "relative",
          ambient: 0.0,
          environment: pbrEnvironment.getResources(),
          environmentIntensity: 1.0,
          environmentBackground: true,
          environmentRotationDegrees: 0.0,
          lights: localLights,
          view: "lighting",
          timestampWrites
        }
      )
    },
    {
      name: "ssr-pbr",
      group: "reflection",
      run: (prepared, encoder, timestampWrites) => pipeline.ssrPass.encode(
        encoder,
        {
          scene: prepared.lighting,
          normal: prepared.resources.normal,
          material: prepared.resources.material,
          depth: prepared.resources.depth
        },
        {
          ...BENCHMARK_SSR_OPTIONS,
          cameraFrame: prepared.cameraFrame,
          enabled: true,
          view: "reflection",
          integrationMode: "pbr",
          timestampWrites
        }
      )
    },
    {
      name: "pbr-ssr-composer",
      group: "reflection",
      run: (prepared, encoder, timestampWrites) => pipeline.composer.encode(
        encoder,
        {
          base: prepared.lighting,
          reflection: prepared.reflection,
          depth: prepared.resources.depth,
          specularIbl: pipeline.deferredLightingPass.getSpecularIblTarget(),
          albedo: prepared.resources.albedo ?? prepared.resources.color,
          normal: prepared.resources.normal,
          material: prepared.resources.material,
          ambientOcclusion: prepared.ambientOcclusion,
          brdfLut: pbrEnvironment.getResources().brdfLut,
          brdfSampler: pbrEnvironment.getResources().sampler
        },
        {
          mode: "pbr-ssr",
          intensity: BENCHMARK_SSR_OPTIONS.intensity,
          cameraFrame: prepared.cameraFrame,
          timestampWrites
        }
      )
    },
    {
      name: "ssr-pbr-fused",
      group: "reflection",
      run: (prepared, encoder, timestampWrites) => pipeline.ssrPass.encode(
        encoder,
        {
          scene: prepared.lighting,
          normal: prepared.resources.normal,
          material: prepared.resources.material,
          depth: prepared.resources.depth
        },
        {
          ...BENCHMARK_SSR_OPTIONS,
          cameraFrame: prepared.cameraFrame,
          enabled: true,
          view: "reflection",
          integrationMode: "pbr",
          pbrComposite: {
            base: prepared.lighting,
            depth: prepared.resources.depth,
            specularIbl: pipeline.deferredLightingPass.getSpecularIblTarget(),
            albedo: prepared.resources.albedo ?? prepared.resources.color,
            normal: prepared.resources.normal,
            material: prepared.resources.material,
            ambientOcclusion: prepared.ambientOcclusion,
            brdfLut: pbrEnvironment.getResources().brdfLut,
            brdfSampler: pbrEnvironment.getResources().sampler,
            output: pipeline.composer.getOutputTarget()
          },
          timestampWrites
        }
      )
    },
    {
      name: "transparency-pbr",
      group: "transparency",
      timerMode: "queue-wall",
      afterSubmit: () => pipeline.afterGpuSubmit(),
      run: (prepared, encoder) => pipeline.transparencyPass.encode(encoder, {
        scene: prepared.composed,
        depth: prepared.resources.depth,
        space: app.space,
        cameraFrame: prepared.cameraFrame,
        clearColor: app.clearColor,
        maxFrostRoughness: 0.18,
        radiance: [1.0, 0.96, 0.90],
        environment: pbrEnvironment.getResources(),
        environmentIntensity: 1.0,
        environmentRotationDegrees: 0.0,
        transmission: {
          enabled: true,
          strength: 1.0,
          distance: 42.0,
          hitThickness: 0.1,
          steps: 64
        },
        shadow: {
          type: "directional",
          depth: pipeline.directionalShadowMap,
          cameraFrame: prepared.cameraFrame,
          lightViewProjection: pipeline.light.viewProjection,
          bias: 0.0015,
          normalBias: 0.003,
          pcfRadius: 1
        },
        localLights: pipeline.deferredLightingPass.getLocalLightBindingResources(),
        lightOverride: (() => {
          const direction = prepared.cameraFrame.viewRotationMatrix.mul3x3Vector(pipeline.light.direction);
          return [-direction[0], -direction[1], -direction[2], 0.0];
        })()
      })
    },
    {
      name: "tone-map",
      group: "output",
      run: (prepared, encoder, timestampWrites) => pipeline.toneMapPass.encode(
        encoder,
        { scene: prepared.transparent, depth: prepared.resources.depth },
        {
          mode: "reinhard",
          exposure: BENCHMARK_TONE_MAP_EXPOSURE,
          saturation: 1.0,
          gamma: 2.2,
          blackBackground: false,
          timestampWrites
        }
      )
    },
    {
      name: "full-pbr-pipeline",
      group: "combined",
      afterSubmit: () => pipeline.afterGpuSubmit(),
      run: (_prepared, encoder, timestampWrites) => {
        const cameraFrame = getCameraFrame();
        const firstTimestampWrites = timestampWrites?.beginningOfPassWriteIndex === undefined
          ? undefined
          : {
              querySet: timestampWrites.querySet,
              beginningOfPassWriteIndex: timestampWrites.beginningOfPassWriteIndex
            };
        const lastTimestampWrites = timestampWrites?.endOfPassWriteIndex === undefined
          ? undefined
          : {
              querySet: timestampWrites.querySet,
              endOfPassWriteIndex: timestampWrites.endOfPassWriteIndex
            };
        pipeline.renderScene(app.space, cameraFrame, CLEAR_COLOR, {
          shadowEnabled: true,
          shadowTimestampWrites: firstTimestampWrites
        });
        return pipeline.encode(
          encoder,
          {
            ...createPbrPipelineOptions(cameraFrame, localLights, pbrSsrFusionEnabled),
            timestampWrites: lastTimestampWrites
          }
        );
      }
    }
  ];
}

// TransparencyPassの非同期プロファイラが保持する内部8区間をbenchmark行へ変換する
function createTransparencyProfileCases() {
  const snapshot = pipeline.getTransparencyPerformanceSnapshot();
  return TRANSPARENCY_PROFILE_NAMES.map((name) => {
    const statistics = snapshot.gpu[name];
    if (!statistics || statistics.sampleCount === 0) {
      throw new Error(`Transparency GPU profile did not produce samples for ${name}`);
    }
    return {
      name: `transparency:${name}`,
      group: "transparency-detail",
      timerMode: "gpu-profiler",
      samples: statistics.sampleCount,
      averageMs: statistics.averageMs,
      medianMs: statistics.medianMs,
      percentile95Ms: null,
      minMs: statistics.minimumMs,
      maxMs: statistics.maximumMs,
      stddevMs: null,
      rawSamplesMs: null
    };
  });
}

// 一つのcaseをwarmup後に反復し、進行中でも完了caseをtableへ追加する
async function measureCaseSet(options, timer) {
  const localLights = benchmarkLights.slice(0, options.localLightCount);
  const cases = getBenchmarkCases(localLights, options.pbrSsrFusionEnabled);
  const results = [];
  const totalPerCase = options.samples + options.warmup;
  const total = cases.length * totalPerCase;
  let finished = 0;
  for (const testCase of cases) {
    const samples = [];
    for (let index = 0; index < totalPerCase; index += 1) {
      finished += 1;
      setStatus(
        `Running ${testCase.name} ${index + 1}/${totalPerCase}\n`
        + `${finished}/${total} measurements encoded`
      );
      const prepared = await prepareInputs(localLights, options.pbrSsrFusionEnabled);
      const milliseconds = await timer.measure(
        testCase.name,
        (encoder, timestampWrites) => testCase.run(prepared, encoder, timestampWrites),
        { afterSubmit: testCase.afterSubmit, timerMode: testCase.timerMode }
      );
      if (index >= options.warmup) samples.push(milliseconds);
    }
    results.push({
      name: testCase.name,
      group: testCase.group,
      timerMode: testCase.timerMode ?? "gpu-timestamp",
      ...summarizeSamples(samples),
      rawSamplesMs: samples
    });
    renderResultTable({ cases: results });
  }
  await app.getGPU().queue.onSubmittedWorkDone();
  await Promise.resolve();
  results.push(...createTransparencyProfileCases());
  renderResultTable({ cases: results });
  return results;
}

// JSON単体から同じ条件を再現できるよう解像度、scene規模、光源、PBR固定値を記録する
function createMetadata(options) {
  return {
    app: "compute_benchmark",
    benchmarkVersion: "pbr-runtime-baseline-1",
    createdAt: new Date().toISOString(),
    canvasWidth: app.screen.getWidth(),
    canvasHeight: app.screen.getHeight(),
    displayWidth: app.screen.displayWidth,
    displayHeight: app.screen.displayHeight,
    canvasElementWidth: app.screen.canvas.width,
    canvasElementHeight: app.screen.canvas.height,
    devicePixelRatio: window.devicePixelRatio ?? 1,
    samples: options.samples,
    warmup: options.warmup,
    localLightCount: options.localLightCount,
    pbrSsrFusionEnabled: options.pbrSsrFusionEnabled,
    shadowMapSize: BENCHMARK_SHADOW_MAP_SIZE,
    ssao: BENCHMARK_SSAO_OPTIONS,
    ssr: BENCHMARK_SSR_OPTIONS,
    transmission: BENCHMARK_TRANSMISSION_OPTIONS,
    environment: {
      type: "procedural-linear-hdr",
      radianceSize: [64, 32],
      irradianceSize: [32, 16],
      specularMipCount: 6,
      brdfLutSize: [64, 64],
      intensity: 1.0,
      background: true
    },
    toneMapExposure: BENCHMARK_TONE_MAP_EXPOSURE,
    excludedStages: ["environment-preprocess", "fog", "toon", "dof", "bloom", "edge", "vignette"],
    timestampSupported: app.getGPU().device.features?.has?.("timestamp-query") === true,
    userAgent: navigator.userAgent
  };
}

// UI入力を検証してPBR基準測定を最後まで実行し、結果保存を有効にする
async function runBenchmark() {
  if (running) return;
  const options = {
    samples: readIntegerInput(dom.samples, "Samples", { min: 1, max: 200 }),
    warmup: readIntegerInput(dom.warmup, "Warmup", { min: 0, max: 50 }),
    localLightCount: readIntegerInput(dom.localLights, "Local Lights", { min: 0, max: 128 }),
    pbrSsrFusionEnabled: dom.pbrSsrFusion.value === "fused"
  };
  const gpu = app.getGPU();
  const timer = new GpuPassTimer(gpu.device, gpu.queue);
  if (!timer.supported) throw new Error("This browser / GPU does not expose timestamp-query");
  setRunning(true);
  dom.downloadJson.disabled = true;
  dom.downloadCsv.disabled = true;
  try {
    const cases = await measureCaseSet(options, timer);
    lastResult = { metadata: createMetadata(options), cases };
    renderResultTable(lastResult);
    setStatus(
      `Done. ${cases.length} cases measured at `
      + `${lastResult.metadata.canvasWidth}x${lastResult.metadata.canvasHeight}`
    );
    dom.downloadJson.disabled = false;
    dom.downloadCsv.disabled = false;
    window.pbrBenchmarkResult = lastResult;
    document.body.dataset.benchmarkStatus = "ready";
    await renderPreview();
  } finally {
    setRunning(false);
  }
}

// Blob URLを一時作成し、benchmark結果を利用者の端末へ保存する
function downloadText(filename, mimeType, text) {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// raw sampleと全metadataを保持するJSONを保存する
function downloadJson() {
  if (!lastResult) return;
  downloadText(
    `compute_benchmark_pbr_${Date.now()}.json`,
    "application/json",
    JSON.stringify(lastResult, null, 2)
  );
}

// 表計算で比較しやすい1 case 1行のCSVへ要約統計と主要条件を書き出す
function downloadCsv() {
  if (!lastResult) return;
  const header = [
    "name", "group", "averageMs", "medianMs", "percentile95Ms", "stddevMs",
    "minMs", "maxMs", "samples", "timer", "canvasWidth", "canvasHeight",
    "devicePixelRatio", "localLightCount", "pbrSsrFusionEnabled", "shadowMapSize"
  ];
  const rows = lastResult.cases.map((entry) => [
    entry.name,
    entry.group,
    entry.averageMs,
    entry.medianMs,
    entry.percentile95Ms,
    entry.stddevMs,
    entry.minMs,
    entry.maxMs,
    entry.samples,
    entry.timerMode,
    lastResult.metadata.canvasWidth,
    lastResult.metadata.canvasHeight,
    lastResult.metadata.devicePixelRatio,
    lastResult.metadata.localLightCount,
    lastResult.metadata.pbrSsrFusionEnabled,
    lastResult.metadata.shadowMapSize
  ]);
  downloadText(
    `compute_benchmark_pbr_${Date.now()}.csv`,
    "text/csv",
    [header, ...rows].map((row) => row.join(",")).join("\n")
  );
}

// WebgApp、固定scene、IBL、PBR pipelineを順に準備し、preview後に操作を受け付ける
async function start() {
  app = new WebgApp({
    document,
    autoDrawScene: false,
    renderMode: "ondemand",
    frameTiming: true,
    clearColor: CLEAR_COLOR,
    viewAngle: 54,
    projectionFar: 140,
    messageFontTexture: "../../webg/font512.png",
    camera: {
      target: [0, -1.2, -6.0],
      distance: 30,
      yaw: 24,
      pitch: -14
    },
    debugTools: {
      mode: "release",
      system: "compute_benchmark",
      source: "samples/compute_benchmark/main.js"
    }
  });
  await app.init();
  app.createOrbitEyeRig({
    target: [0, -1.2, -6.0],
    distance: 30,
    yaw: 24,
    pitch: -14,
    minDistance: 18,
    maxDistance: 54
  });
  createBenchmarkScene();
  benchmarkLights = createBenchmarkLights();
  const gpu = app.getGPU();
  pbrEnvironment = new PbrEnvironment(gpu, {
    label: "pbr-benchmark-environment",
    ...createProceduralEnvironmentData()
  });
  pipeline = new ComputeEffectPipeline(gpu, {
    label: "pbr-benchmark",
    width: app.screen.getWidth(),
    height: app.screen.getHeight(),
    shadowMapSize: BENCHMARK_SHADOW_MAP_SIZE,
    maxLights: 128,
    ssao: BENCHMARK_SSAO_OPTIONS,
    ssr: BENCHMARK_SSR_OPTIONS,
    composer: { mode: "pbr-ssr" },
    transparency: BENCHMARK_TRANSMISSION_OPTIONS,
    lighting: {
      ambient: 0.0,
      directionalIntensity: 1.0
    },
    toneMap: {
      mode: "reinhard",
      exposure: BENCHMARK_TONE_MAP_EXPOSURE,
      saturation: 1.0,
      gamma: 2.2
    }
  });
  copyPass = new FullscreenPass(gpu, { targetFormat: gpu.format });
  await Promise.all([pipeline.ready, copyPass.init()]);

  dom.run.addEventListener("click", () => {
    runBenchmark().catch((error) => {
      console.error(error);
      document.body.dataset.benchmarkStatus = "error";
      setStatus(`Error: ${error.message}`);
      setRunning(false);
    });
  });
  dom.preview.addEventListener("click", () => {
    renderPreview().catch((error) => {
      console.error(error);
      setStatus(`Preview error: ${error.message}`);
    });
  });
  dom.downloadJson.addEventListener("click", downloadJson);
  dom.downloadCsv.addEventListener("click", downloadCsv);
  window.addEventListener("pagehide", () => {
    copyPass?.destroy?.();
    pipeline?.destroy?.();
    pbrEnvironment?.destroy?.();
    app?.stop?.();
  }, { once: true });

  const timestampSupported = gpu.device.features?.has?.("timestamp-query") === true;
  document.body.dataset.benchmarkStatus = timestampSupported ? "idle" : "unsupported";
  setStatus(timestampSupported
    ? "Ready. Press Run PBR Baseline."
    : "GPU timestamp-query is unavailable on this browser / GPU.");
  await renderPreview();
}

start().catch((error) => {
  console.error(error);
  document.body.dataset.benchmarkStatus = "error";
  setStatus(`Startup error: ${error.message}`);
});
