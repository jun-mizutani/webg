// ---------------------------------------------
// samples/compute_benchmark/main.js  2026/07/25
//   GPU benchmark for standard compute effect APIs
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import WebgApp from "../../webg/WebgApp.js";
import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";
import FullscreenPass from "../../webg/FullscreenPass.js";
import ComputeEffectPipeline from "../../webg/ComputeEffectPipeline.js?v=20260723_dof_coverage";
import {
  COMPUTE_BLOOM_DEFAULTS
} from "../../webg/ComputeBloomPass.js?v=20260723_image_pyramid";
import ComputePyramidBlurPass, {
  COMPUTE_PYRAMID_BLUR_LEVELS
} from "../../webg/ComputePyramidBlurPass.js?v=20260724_pyramid_blur";

let app = null;
let pipeline = null;
let copyPass = null;
let pyramidBlurPass = null;
let lastResult = null;
let running = false;

const dom = {
  samples: document.getElementById("samples"),
  warmup: document.getElementById("warmup"),
  pyramidFilterRadius: document.getElementById("pyramidFilterRadius"),
  run: document.getElementById("run"),
  downloadJson: document.getElementById("downloadJson"),
  downloadCsv: document.getElementById("downloadCsv"),
  preview: document.getElementById("preview"),
  status: document.getElementById("status"),
  result: document.getElementById("result")
};

const clearColor = [0.035, 0.055, 0.075, 1.0];

// benchmarkの照明入力は変えず、Tone Map後の確認画像だけが暗く沈まない露出を全経路で共有します
// preview、単体tone-map計測、full-pipeline、入力準備で別の露出を使うと測定条件の意味がずれるため一つに固定します
const BENCHMARK_TONE_MAP_EXPOSURE = 2.0;

// 個別pass、preview、full-pipelineで同じFogとVignette設定を使い、
// 設定差ではなく実行範囲の違いを比較できるようにする
const BENCHMARK_FOG_OPTIONS = Object.freeze({
  mode: "linear",
  color: Object.freeze([0.07, 0.11, 0.16]),
  near: 14.0,
  far: 58.0,
  density: 0.022
});
const BENCHMARK_VIGNETTE_OPTIONS = Object.freeze({
  center: Object.freeze([0.5, 0.5]),
  radius: 0.84,
  softness: 0.32,
  strength: 0.52,
  tint: Object.freeze([0.16, 0.20, 0.28])
});

// BloomはPyramid Bloomの既定値をそのまま使い、DoF用のblur設定とは分離します
// PyramidのLevel構成を測定ごとに変えず、同じ画質条件でGPU時間を比較します
function createBenchmarkBloomOptions() {
  return {
    ...COMPUTE_BLOOM_DEFAULTS
  };
}

// 測定条件は結果の意味そのものなので、自動補正せず不正値は即時例外にする
function readIntegerInput(element, label, { min, max }) {
  const value = Number(element.value);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be an integer from ${min} to ${max}: ${element.value}`);
  }
  return value;
}

// `finite`の入力を読み込み、検証済みのデータとして後続処理へ渡す
function readFiniteInput(element, label, { min, max }) {
  const value = Number(element.value);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} must be a finite number from ${min} to ${max}: ${element.value}`);
  }
  return value;
}

// 測定の進行状況はこの関数だけが更新し、複数箇所で表記がずれないようにする
function setStatus(message) {
  dom.status.textContent = message;
}

// 測定中は同じ GPU resource へ別の操作が重ならないよう UI の入口を止める
function setRunning(nextRunning) {
  running = nextRunning;
  dom.run.disabled = nextRunning;
  dom.preview.disabled = nextRunning;
}

// timestamp-query 1回分の最小構成をまとめた timer
// 単一 pass の timestamp が不安定な項目は queue 完了待ち時間へ切り替える
class GpuPassTimer {
  constructor(device, queue) {
    this.device = device;
    this.queue = queue;
    this.supported = device.features?.has?.("timestamp-query") === true;
  }

  // query set と readback buffer は測定ごとに作り、前回の map 状態を持ち越さない
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

  // encodeCallback は 1 項目分の command だけを記録する
  // 複数 pass を内包する effect は queue-wall に切り替え、安定した比較値を取る
  async measure(label, encodeCallback, options = {}) {
    if (!this.supported) {
      throw new Error("GPU timestamp-query is not supported on this device");
    }
    if (options.timerMode === "queue-wall") {
      return this.measureQueueWall(label, encodeCallback);
    }
    const gpu = app.getGPU();
    const slot = this.createSlot(label);
    const timestampWrites = {
      querySet: slot.querySet,
      beginningOfPassWriteIndex: 0,
      endOfPassWriteIndex: 1
    };

    gpu.endPass?.();
    gpu.commandEncoder = this.device.createCommandEncoder({
      label: `${label}:encoder`
    });
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

    await slot.readBuffer.mapAsync(GPUMapMode.READ);
    const values = new BigUint64Array(slot.readBuffer.getMappedRange());
    const start = values[0];
    const end = values[1];
    slot.readBuffer.unmap();
    slot.resolveBuffer.destroy();
    slot.readBuffer.destroy();
    slot.querySet.destroy?.();
    if (end < start) {
      throw new Error(`${label} timestamp end is smaller than start`);
    }
    const ms = Number(end - start) / 1_000_000.0;
    if (!Number.isFinite(ms) || ms < 0.0) {
      throw new Error(`${label} timestamp result is invalid: ${ms}`);
    }
    return ms;
  }

  // pass 数が多い処理は queue 完了待ちで一括計測し、driver 差で止まることを避ける
  async measureQueueWall(label, encodeCallback) {
    const gpu = app.getGPU();
    gpu.endPass?.();
    gpu.commandEncoder = this.device.createCommandEncoder({
      label: `${label}:queue-wall-encoder`
    });
    const startedAt = performance.now();
    encodeCallback(gpu.commandEncoder, undefined);
    gpu.endPass?.();
    const commandBuffer = gpu.commandEncoder.finish();
    gpu.commandEncoder = null;
    this.queue.submit([commandBuffer]);
    await this.queue.onSubmittedWorkDone?.();
    const elapsed = performance.now() - startedAt;
    if (!Number.isFinite(elapsed) || elapsed < 0.0) {
      throw new Error(`${label} queue-wall result is invalid: ${elapsed}`);
    }
    return elapsed;
  }
}

// 不透明材質と透明材質を同じ入口で作り、alphaをTransparencyPassの分類へ渡す
function setMaterial(shape, color, options = {}) {
  shape.setMaterial("smooth-shader", {
    has_bone: 0,
    use_texture: 0,
    color: [color[0], color[1], color[2], options.alpha ?? 1.0],
    alpha: options.alpha ?? 1.0,
    ambient: options.ambient ?? 0.03,
    specular: options.specular ?? 0.55,
    power: options.power ?? 32.0,
    roughness: options.roughness ?? 0.42,
    metallic: options.metallic ?? 0.0,
    emissive: options.emissive ?? 0.0,
    flat_shading: options.flat_shading ?? 0
  });
}

// Shape を作る手順を共通化し、すべての測定 object が同じ材質設定規約で揃うようにする
function createShape(gpu, primitiveFactory, color, options = {}) {
  const shape = new Shape(gpu);
  shape.applyPrimitiveAsset(primitiveFactory(shape.getPrimitiveOptions()));
  shape.endShape();
  setMaterial(shape, color, options);
  return shape;
}

// scene graph への登録を 1 箇所へまとめ、測定 scene の構成を追いやすくする
function addShapeNode(name, shape, position, attitude = [0, 0, 0]) {
  const node = app.space.addNode(null, name);
  node.setPosition(...position);
  node.setAttitude(...attitude);
  node.addShape(shape);
  return node;
}

// G-buffer, shadow, SSR, Bloom などが十分な入力を持てるよう、
// 床、壁、反射率の異なる複数物体を固定 scene として用意する
function createBenchmarkScene() {
  const gpu = app.getGPU();
  addShapeNode(
    "bench_floor",
    createShape(gpu, (options) => Primitive.cuboid(34, 0.8, 28, options), [0.28, 0.32, 0.36, 0.70], {
      ambient: 0.04,
      specular: 0.82,
      power: 64
    }),
    [0, -4.4, -3]
  );
  addShapeNode(
    "bench_back_wall",
    createShape(gpu, (options) => Primitive.cuboid(34, 13, 0.8, options), [0.42, 0.47, 0.54, 0.18], {
      ambient: 0.03,
      specular: 0.24,
      power: 18
    }),
    [0, 1.6, -16.5]
  );
  addShapeNode(
    "bench_left_wall",
    createShape(gpu, (options) => Primitive.cuboid(0.8, 13, 26, options), [0.35, 0.29, 0.25, 0.12], {
      ambient: 0.02,
      specular: 0.18,
      power: 12
    }),
    [-16.8, 1.6, -4.0]
  );

  const colors = [
    [0.92, 0.26, 0.16, 0.34],
    [0.12, 0.58, 0.90, 0.62],
    [0.22, 0.76, 0.36, 0.42],
    [0.90, 0.72, 0.18, 0.48],
    [0.66, 0.24, 0.88, 0.52],
    [0.88, 0.42, 0.62, 0.38]
  ];
  const factories = [
    (options) => Primitive.cube(3.2, options),
    (options) => Primitive.sphere(1.9, 36, 24, options),
    (options) => Primitive.cuboid(2.4, 5.8, 2.4, options),
    (options) => Primitive.donut(1.4, 0.36, 36, 18, options),
    (options) => Primitive.cube(2.5, options),
    (options) => Primitive.sphere(1.55, 32, 20, options)
  ];
  const transforms = [
    [[-7.8, -1.6, -7.8], [0, 24, 0]],
    [[-2.8, -1.3, -8.4], [0, 0, 0]],
    [[3.2, -1.8, -7.4], [0, -18, 0]],
    [[8.2, -1.1, -8.6], [65, 0, 18]],
    [[-5.2, -0.8, -1.8], [0, 42, 0]],
    [[4.6, -1.4, -1.2], [0, 0, 0]]
  ];
  for (let index = 0; index < factories.length; index += 1) {
    addShapeNode(
      `bench_object_${index}`,
      createShape(gpu, factories[index], colors[index], {
        ambient: 0.0,
        specular: 0.72,
        power: 36
      }),
      transforms[index][0],
      transforms[index][1]
    );
  }

  // 現行pipelineの自動透明合成をfull-pipelineと個別caseの両方で実行させる
  addShapeNode(
    "bench_glass",
    createShape(gpu, (options) => Primitive.sphere(2.15, 36, 24, options), [0.28, 0.66, 0.92], {
      alpha: 0.42,
      ambient: 0.04,
      specular: 0.84,
      power: 64,
      roughness: 0.38
    }),
    [0.4, -1.0, -4.0]
  );
}

// 色消去値は render pass ごとに object 形式で渡すため、配列から変換する
function getClearColorObject() {
  return {
    r: clearColor[0],
    g: clearColor[1],
    b: clearColor[2],
    a: clearColor[3]
  };
}

// canvas の大きさが変わっても、pipeline とPyramid blurの内部targetを現在サイズへ揃える
function resizeBenchmarkTargets() {
  const width = app.screen.getWidth();
  const height = app.screen.getHeight();
  pipeline.resize(width, height);
  pyramidBlurPass.resize(width, height);
}

// WebgAppと同じ更新入口から一つのCamera Frameを確定し、全passへ同じsnapshotを渡す
function getEffectInputs() {
  return { cameraFrame: app.updateCameraFrame() };
}

// GeometryBufferPass の cost を単独で測るため、通常描画と別 case に分ける
function renderGBuffer(timestampWrites = undefined) {
  const { cameraFrame } = getEffectInputs();
  pipeline.gbuffer.renderSpace(
    app.space,
    cameraFrame,
    clearColor,
    { timestampWrites }
  );
}

// ShadowMapPass は lighting 合成前の独立コストとして別計測する
function renderShadowMap(timestampWrites = undefined) {
  pipeline.directionalShadowMap.renderSpace(
    app.space,
    pipeline.light.viewProjection,
    { timestampWrites }
  );
}

// compute shadow lighting は G-buffer と shadow map を入力にするので、
// prepareInputs 済みの resource を前提に単体 encode する
function encodeShadowLighting(encoder, timestampWrites = undefined) {
  const { cameraFrame } = getEffectInputs();
  const resources = pipeline.gbuffer.getBindingResources();
  return pipeline.directionalShadowPass.encode(
    encoder,
    {
      ...resources,
      ...pipeline.directionalShadowMap.getBindingResources()
    },
    {
      cameraFrame,
      lightViewProjection: pipeline.light.viewProjection,
      lightDirection: pipeline.light.direction,
      enabled: true,
      bias: 0.0015,
      normalBias: 0.012,
      pcfRadius: 1,
      timestampWrites
    }
  );
}

// TransparencyPassのSmoothShaderへ、統合pipelineと同じview-space入射方向を渡す
function createTransparencyLightOverride(cameraFrame) {
  const direction = cameraFrame.viewRotationMatrix.mul3x3Vector(pipeline.light.direction);
  return [-direction[0], -direction[1], -direction[2], 0.0];
}

// 個別 pass の測定前に共通入力を準備する
// ここは本体の比較対象ではないため timestamp を付けず、毎回同条件を作る
async function prepareInputs() {
  const gpu = app.getGPU();
  resizeBenchmarkTargets();
  gpu.endPass?.();
  gpu.commandEncoder = gpu.device.createCommandEncoder({
    label: "compute-effect-benchmark:prepare"
  });
  const { cameraFrame } = getEffectInputs();
  pipeline.renderScene(app.space, cameraFrame, clearColor, { shadowEnabled: true });
  const finalColor = pipeline.encode(gpu.commandEncoder, {
    cameraFrame,
    shadowEnabled: true,
    ssaoEnabled: true,
    ssrEnabled: true,
    fogEnabled: true,
    toonEnabled: false,
    dofEnabled: false,
    bloomEnabled: false,
    edgeEnabled: true,
    edgeGeometryEnabled: true,
    vignetteEnabled: true,
    fog: BENCHMARK_FOG_OPTIONS,
    edge: {
      colorEnabled: false,
      blendMode: "black-multiply",
      thickness: 2
    },
    vignette: BENCHMARK_VIGNETTE_OPTIONS
  });
  const resources = pipeline.gbuffer.getBindingResources();
  const shadowed = pipeline.deferredLightingPass.getOutputTarget();
  const reflection = pipeline.ssrPass.getOutputTarget();
  const composed = pipeline.composer.getOutputTarget();
  const transparent = pipeline.transparencyPass.outputTarget;
  const fogged = pipeline.fogPass.getOutputTarget();
  const toneMapped = pipeline.toneMapPass.getOutputTarget();
  const edged = pipeline.edgePass.getOutputTarget();
  gpu.endPass?.();
  const commandBuffer = gpu.commandEncoder.finish();
  gpu.commandEncoder = null;
  gpu.queue.submit([commandBuffer]);
  await gpu.queue.onSubmittedWorkDone?.();
  return {
    resources,
    cameraFrame,
    shadowed,
    reflection,
    composed,
    transparent,
    fogged,
    toneMapped,
    edged,
    finalColor
  };
}

// 現在の benchmark scene を効果付きで画面に出し、測定条件そのものを目視確認できるようにする
async function renderPreview() {
  const gpu = app.getGPU();
  const { cameraFrame } = getEffectInputs();
  gpu.commandEncoder = gpu.device.createCommandEncoder({
    label: "compute-effect-benchmark:preview"
  });
  pipeline.renderScene(app.space, cameraFrame, clearColor, {
    shadowEnabled: true,
    ssaoEnabled: true,
    ssrEnabled: true,
    toonEnabled: false,
    edgeEnabled: true,
    edgeGeometryEnabled: true
  });
  const finalColor = pipeline.encode(gpu.commandEncoder, {
    cameraFrame,
    ssaoEnabled: true,
    shadowEnabled: true,
    ssrEnabled: true,
    fogEnabled: true,
    toonEnabled: false,
    dofEnabled: false,
    bloomEnabled: true,
    edgeEnabled: true,
    edgeGeometryEnabled: true,
    vignetteEnabled: true,
    composer: { mode: "mix" },
    fog: BENCHMARK_FOG_OPTIONS,
    toneMap: {
      mode: "reinhard",
      exposure: BENCHMARK_TONE_MAP_EXPOSURE,
      saturation: 1.06,
      gamma: 2.2,
      blackBackground: false
    },
    edge: {
      colorEnabled: false,
      blendMode: "black-multiply",
      thickness: 2
    },
    vignette: BENCHMARK_VIGNETTE_OPTIONS
  });
  app.screen.beginPresentPass({
    clearColor,
    colorLoadOp: "clear"
  });
  copyPass.draw(finalColor);
  app.screen.clearDepthBuffer();
  app.screen.present();
}

// 基本統計量は JSON と table の両方で使うため共通化する
function average(values) {
  return values.reduce((sum, value) => sum + value, 0.0) / values.length;
}

// 観測された時間分布から、比較に使う平均、最小、最大、分散を求める
function summarizeSamples(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const avg = average(sorted);
  const variance = average(sorted.map((value) => (value - avg) ** 2));
  return {
    samples: sorted.length,
    averageMs: avg,
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
    stddevMs: Math.sqrt(variance)
  };
}

// 表示用の数値桁数を統一し、欠損時は明示的に -- と出す
function formatMs(value) {
  return Number.isFinite(value) ? value.toFixed(3) : "--";
}

// UI の timer 表示は短くし、詳細な意味は README 側へ残す
function formatTimerLabel(timerMode) {
  if (timerMode === "queue-wall") return "queue";
  if (timerMode === "gpu-timestamp") return "gpu";
  return String(timerMode ?? "--");
}

// HTML table は 1 case 1 行に固定し、標準解像度の結果だけを素直に読める構成にする
function renderResultTable(result) {
  const rows = result.cases.map((entry) => `
    <tr>
      <td>${entry.name}</td>
      <td>${entry.group}</td>
      <td>${formatMs(entry.averageMs)}</td>
      <td>${formatMs(entry.stddevMs)}</td>
      <td>${formatMs(entry.minMs)} / ${formatMs(entry.maxMs)}</td>
      <td>${formatTimerLabel(entry.timerMode)}</td>
      <td>${entry.samples}</td>
    </tr>
  `).join("");
  dom.result.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>case</th>
          <th>group</th>
          <th>avg ms</th>
          <th>stddev</th>
          <th>min/max</th>
          <th>timer</th>
          <th>n</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

// 利用者が比較したい標準 API の effect を 1 つずつ独立 case として並べる
// G-buffer や shadow map も前段コストとして一緒に測り、後段 effect だけを過大評価しないようにする
function getBenchmarkCases(options) {
  return [
    {
      name: "gbuffer-render",
      group: "render",
      run: (_prepared, _encoder, timestampWrites) => renderGBuffer(timestampWrites)
    },
    {
      name: "shadow-map",
      group: "render",
      run: (_prepared, _encoder, timestampWrites) => renderShadowMap(timestampWrites)
    },
    {
      name: "shadow-visibility",
      group: "compute",
      run: (_prepared, encoder, timestampWrites) => encodeShadowLighting(encoder, timestampWrites)
    },
    {
      name: "blur",
      group: "compute",
      timerMode: "queue-wall",
      run: (prepared, encoder, timestampWrites) => pyramidBlurPass.encode(
        encoder,
        prepared.shadowed,
        {
          filterRadius: options.pyramidFilterRadius,
          timestampWrites
        }
      )
    },
    {
      name: "toon",
      group: "compute",
      run: (prepared, encoder, timestampWrites) => pipeline.toonPass.encode(
        encoder,
        prepared.shadowed,
        {
          levels: 4,
          strength: 1.0,
          floor: 0.12,
          timestampWrites
        }
      )
    },
    {
      name: "dof",
      group: "compute",
      timerMode: "queue-wall",
      run: (prepared, encoder, timestampWrites) => pipeline.dofPass.encode(
        encoder,
        {
          scene: prepared.shadowed,
          depth: prepared.resources.depth
        },
        {
          cameraFrame: prepared.cameraFrame,
          focusDistance: 14.0,
          focusRange: 5.5,
          timestampWrites
        }
      )
    },
    {
      name: "bloom",
      group: "compute",
      timerMode: "queue-wall",
      run: (prepared, encoder, timestampWrites) => pipeline.bloomPass.encode(
        encoder,
        prepared.shadowed,
        {
          ...createBenchmarkBloomOptions(options),
          timestampWrites
        }
      )
    },
    {
      name: "ssao",
      group: "compute",
      timerMode: "queue-wall",
      run: (prepared, encoder, timestampWrites) => pipeline.ssaoPass.encode(encoder, {
          normal: prepared.resources.normal,
          depth: prepared.resources.depth
        }, {
          cameraFrame: prepared.cameraFrame,
          enabled: true,
          radius: 2.8,
          strength: 1.28,
          samples: 12,
          timestampWrites
        })
    },
    {
      name: "ssr-ray",
      group: "compute",
      run: (prepared, encoder, timestampWrites) => pipeline.ssrPass.encode(encoder, {
          scene: prepared.shadowed,
          normal: prepared.resources.normal,
          material: prepared.resources.material,
          depth: prepared.resources.depth
        }, {
          cameraFrame: prepared.cameraFrame,
          enabled: true,
          view: "reflection",
          intensity: 0.82,
          steps: 48,
          distance: 24.0,
          thickness: 0.34,
          timestampWrites
        })
    },
    {
      name: "ssr-composer",
      group: "compute",
      run: (prepared, encoder, timestampWrites) => pipeline.composer.encode(
        encoder,
        {
          // composerのbaseは線形HDRシーンであり、rgba8unormのSSAO可視率ではありません
          // 遅延照明済みのshadowed色を使い、SSR反射との合成だけを単独測定します
          base: prepared.shadowed,
          reflection: prepared.reflection,
          depth: prepared.resources.depth
        },
        {
          mode: "mix",
          timestampWrites
        }
      )
    },
    {
      name: "transparency",
      group: "render+compute",
      timerMode: "queue-wall",
      run: (prepared, encoder) => pipeline.transparencyPass.encode(encoder, {
        scene: prepared.composed,
        depth: prepared.resources.depth,
        space: app.space,
        cameraFrame: prepared.cameraFrame,
        ambient: 0.10,
        lightOverride: createTransparencyLightOverride(prepared.cameraFrame)
      })
    },
    {
      name: "fog",
      group: "compute",
      run: (prepared, encoder, timestampWrites) => pipeline.fogPass.encode(
        encoder,
        {
          scene: prepared.transparent,
          depth: prepared.resources.depth
        },
        {
          ...BENCHMARK_FOG_OPTIONS,
          enabled: true,
          cameraFrame: prepared.cameraFrame,
          timestampWrites
        }
      )
    },
    {
      name: "tone-map",
      group: "compute",
      run: (prepared, encoder, timestampWrites) => pipeline.toneMapPass.encode(
        encoder,
        {
          scene: prepared.fogged,
          depth: prepared.resources.depth
        },
        {
          mode: "reinhard",
          exposure: BENCHMARK_TONE_MAP_EXPOSURE,
          saturation: 1.06,
          gamma: 2.2,
          timestampWrites
        }
      )
    },
    {
      name: "edge",
      group: "compute",
      timerMode: "queue-wall",
      run: (prepared, encoder, timestampWrites) => pipeline.edgePass.encode(
        encoder,
        prepared.toneMapped,
        {
          colorEnabled: false,
          geometryEnabled: true,
          normal: prepared.resources.normal,
          depth: prepared.resources.depth,
          cameraFrame: prepared.cameraFrame,
          thickness: 2,
          blendMode: "black-multiply",
          timestampWrites
        }
      )
    },
    {
      name: "vignette",
      group: "compute",
      run: (prepared, encoder, timestampWrites) => pipeline.vignettePass.encode(
        encoder,
        prepared.edged,
        {
          ...BENCHMARK_VIGNETTE_OPTIONS,
          enabled: true,
          timestampWrites
        }
      )
    },
    {
      name: "full-pipeline",
      group: "combined",
      timerMode: "queue-wall",
      run: (_prepared, encoder, timestampWrites) => {
        const { cameraFrame } = getEffectInputs();
        pipeline.renderScene(app.space, cameraFrame, clearColor, {
          shadowEnabled: true,
          ssaoEnabled: true,
          ssrEnabled: true,
          toonEnabled: true,
          edgeEnabled: true,
          edgeGeometryEnabled: true
        });
        return pipeline.encode(encoder, {
          cameraFrame,
          ssaoEnabled: true,
          shadowEnabled: true,
          ssrEnabled: true,
          fogEnabled: true,
          toonEnabled: true,
          dofEnabled: true,
          bloomEnabled: true,
          edgeEnabled: true,
          edgeGeometryEnabled: true,
          vignetteEnabled: true,
          toon: { levels: 4 },
          fog: BENCHMARK_FOG_OPTIONS,
          dof: {
            focusDistance: 14.0,
            focusRange: 5.5
          },
          bloom: {
            ...createBenchmarkBloomOptions(options)
          },
          edge: {
            colorEnabled: false,
            blendMode: "black-multiply",
            thickness: 2
          },
          vignette: BENCHMARK_VIGNETTE_OPTIONS,
          composer: { mode: "mix" },
          toneMap: {
            mode: "reinhard",
            exposure: BENCHMARK_TONE_MAP_EXPOSURE,
            saturation: 1.06,
            gamma: 2.2
          },
          timestampWrites
        });
      }
    }
  ];
}

// JSON だけ見ても、測定条件と端末条件が追跡できるよう metadata を残す
function createMetadata(options) {
  return {
    app: "compute_benchmark",
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
    pyramidFilterRadius: options.pyramidFilterRadius,
    pyramidLevels: [...COMPUTE_PYRAMID_BLUR_LEVELS],
    toneMapExposure: BENCHMARK_TONE_MAP_EXPOSURE,
    fog: BENCHMARK_FOG_OPTIONS,
    vignette: BENCHMARK_VIGNETTE_OPTIONS,
    timestampSupported: app.getGPU().device.features?.has?.("timestamp-query") === true,
    userAgent: navigator.userAgent
  };
}

// 1 case を warmup 後に複数回測り、逐次 table へ反映して途中経過も読めるようにする
async function measureCaseSet(options, timer) {
  const cases = getBenchmarkCases(options);
  const results = [];
  const totalPerCase = options.samples + options.warmup;
  const total = cases.length * totalPerCase;
  let finished = 0;
  for (const testCase of cases) {
    const samples = [];
    for (let index = 0; index < totalPerCase; index += 1) {
      finished += 1;
      setStatus(
        `Running ${testCase.name} ${index + 1}/${totalPerCase}\n` +
        `${finished}/${total} samples encoded`
      );
      const prepared = await prepareInputs();
      const ms = await timer.measure(testCase.name, (encoder, timestampWrites) => {
        testCase.run(prepared, encoder, timestampWrites);
      }, {
        timerMode: testCase.timerMode
      });
      if (index >= options.warmup) {
        samples.push(ms);
      }
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
  return results;
}

// UI から標準条件を読み取り、1 回の benchmark を最後まで走らせる
async function runBenchmark() {
  if (running) return;
  const options = {
    samples: readIntegerInput(dom.samples, "Samples", { min: 1, max: 200 }),
    warmup: readIntegerInput(dom.warmup, "Warmup", { min: 0, max: 50 }),
    pyramidFilterRadius: readFiniteInput(
      dom.pyramidFilterRadius,
      "Pyramid Radius",
      { min: 0.25, max: 3.0 }
    )
  };
  const gpu = app.getGPU();
  const timer = new GpuPassTimer(gpu.device, gpu.queue);
  if (!timer.supported) {
    throw new Error("This browser / GPU does not expose timestamp-query");
  }

  setRunning(true);
  dom.downloadJson.disabled = true;
  dom.downloadCsv.disabled = true;
  const cases = await measureCaseSet(options, timer);
  lastResult = {
    metadata: createMetadata(options),
    cases
  };
  renderResultTable(lastResult);
  setStatus(`Done. ${cases.length} cases measured at ${lastResult.metadata.canvasWidth}x${lastResult.metadata.canvasHeight}`);
  dom.downloadJson.disabled = false;
  dom.downloadCsv.disabled = false;
  await renderPreview();
  setRunning(false);
}

// 保存処理は JSON / CSV で共通なので、download 部分だけを小関数へ分ける
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

// JSON は後から集計しやすいよう、raw sample と metadata を含めてそのまま保存する
function downloadJson() {
  if (!lastResult) return;
  downloadText(
    `compute_benchmark_${Date.now()}.json`,
    "application/json",
    JSON.stringify(lastResult, null, 2)
  );
}

// CSV は表計算へ直接入れやすいよう、1 case 1 行の要約値だけにする
function downloadCsv() {
  if (!lastResult) return;
  const header = [
    "name",
    "group",
    "averageMs",
    "stddevMs",
    "minMs",
    "maxMs",
    "samples",
    "timer",
    "canvasWidth",
    "canvasHeight",
    "devicePixelRatio",
    "pyramidFilterRadius",
    "pyramidLevels"
  ];
  const rows = lastResult.cases.map((entry) => [
    entry.name,
    entry.group,
    entry.averageMs,
    entry.stddevMs,
    entry.minMs,
    entry.maxMs,
    entry.samples,
    formatTimerLabel(entry.timerMode),
    lastResult.metadata.canvasWidth,
    lastResult.metadata.canvasHeight,
    lastResult.metadata.devicePixelRatio,
    lastResult.metadata.pyramidFilterRadius,
    lastResult.metadata.pyramidLevels.join("|")
  ]);
  downloadText(
    `compute_benchmark_${Date.now()}.csv`,
    "text/csv",
    [header, ...rows].map((row) => row.join(",")).join("\n")
  );
}

// 起動時に benchmark scene と各 pass を初期化し、preview と測定の両方を使える状態へする
async function start() {
  app = new WebgApp({
    document,
    autoDrawScene: false,
    renderMode: "ondemand",
    frameTiming: true,
    clearColor,
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
  const gpu = app.getGPU();
  pipeline = new ComputeEffectPipeline(gpu, {
    label: "compute-effect-benchmark",
    width: app.screen.getWidth(),
    height: app.screen.getHeight(),
    shadowMapSize: 1024,
    lighting: {
      ambient: 0.10,
      directionalIntensity: 1.0
    },
    ssr: {
      steps: 48,
      distance: 24.0,
      thickness: 0.34
    },
    composer: {
      mode: "mix"
    },
    toneMap: {
      mode: "reinhard",
      exposure: BENCHMARK_TONE_MAP_EXPOSURE,
      saturation: 1.06,
      gamma: 2.2
    }
  });
  pyramidBlurPass = new ComputePyramidBlurPass(gpu, {
    label: "compute-effect-benchmark:pyramid-blur",
    width: app.screen.getWidth(),
    height: app.screen.getHeight(),
    levels: COMPUTE_PYRAMID_BLUR_LEVELS
  });
  copyPass = new FullscreenPass(gpu, {
    targetFormat: gpu.format
  });
  await Promise.all([
    pipeline.ready,
    pyramidBlurPass.ready,
    copyPass.init()
  ]);

  dom.run.addEventListener("click", () => {
    runBenchmark().catch((error) => {
      console.error(error);
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
    pyramidBlurPass?.destroy?.();
    pipeline?.destroy?.();
    app?.stop?.();
  }, { once: true });

  const timestampSupported = gpu.device.features?.has?.("timestamp-query") === true;
  setStatus(timestampSupported
    ? "Ready. Press Run Benchmark."
    : "GPU timestamp-query is unavailable on this browser / GPU.");
  await renderPreview();
}

start().catch((error) => {
  console.error(error);
  setStatus(`Startup error: ${error.message}`);
});
