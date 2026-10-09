// ---------------------------------------------
// WaterSystem.js  2026/10/04
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// PBR pipelineが所有する水域のGPU実装。水面・集光をともにOFFにした段階で専用objectを解放する

import WaterCausticField from "./WaterCausticField.js";
import WaterReceiverMask from "./WaterReceiverMask.js";
import WaterLayerPass from "./WaterLayerPass.js";
import WaterSurfacePass from "./WaterSurfacePass.js";
import GpuPassProfiler from "./GpuPassProfiler.js";

// 既存shaderの補助資源にも所有者を付ける。呼び出しと資源は同じGPUDeviceへ委譲する
// 既存deviceへ処理を委譲し、WaterSystem内で資源labelを付けたviewを使う
function labeledGpu(gpu) {
  const device = new Proxy(gpu.device, {
    // deviceの値とmethodを取り出し、buffer・textureの生成時に水の所有labelを付ける
    // 実際の生成は元deviceへ委譲し、同じGPUDeviceの資源として共有する
    get(target, key) {
      const value = Reflect.get(target, key, target);
      if (typeof value !== "function") return value;
      if (!["createBuffer", "createTexture"].includes(key)) return value.bind(target);
      return descriptor => value.call(target, { ...descriptor,
        label: descriptor.label?.startsWith("water:") ? descriptor.label : `water:${descriptor.label ?? key}` });
    }
  });
  return new Proxy(gpu, {
    // 元objectのpropertyを取得し、deviceの操作は元のGPU資源へ委譲する
    get: (target, key) => key === "device" ? device : target[key] });
}

export default class WaterSystem {
  // 有効な水の機能だけを準備し、GPU validationを確認して所有者を返す
  static async create(gpu, pipeline, body, options) {
    gpu = labeledGpu(gpu);
    const result = new WaterSystem(gpu, pipeline, body, options);
    gpu.device.pushErrorScope("validation");
    let failure;
    try {
      if (options.causticsEnabled) {
        result.field = await WaterCausticField.create(gpu, options.quality);
        result.mask = new WaterReceiverMask(gpu, pipeline.width, pipeline.height, body.receivers);
        await result.mask.ready;
        result.params = gpu.device.createBuffer({ label: "water:caustic-projection", size: 32,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
        result.sampler = gpu.device.createSampler({ minFilter: "linear", magFilter: "linear" });
        await pipeline.deferredLightingPass.prepareCaustics();
        const infos = await Promise.all(result.field.passes.map(p => p.shaderModule.getCompilationInfo()));
        const errors = infos.flatMap(i => i.messages).filter(m => m.type === "error");
        if (errors.length) throw new Error(errors.map(m => m.message).join("\n"));
      }
      if (options.surfaceEnabled) {
        result.surface = await WaterSurfacePass.create(gpu, pipeline.width, pipeline.height);
        result.layers = new WaterLayerPass(gpu, pipeline.width, pipeline.height);
        await result.layers.ready;
      }
      result.profiler = new GpuPassProfiler(gpu.device, {
        label: "water:timing", names: ["clear", "trace", "resolve", "geometry", "geometryDepth", "surface", "depth"]
      });
    } catch (error) { failure = error; }
    const gpuError = await gpu.device.popErrorScope();
    if (failure || gpuError) {
      result.destroy();
      throw failure ?? new Error(gpuError.message);
    }
    return result;
  }

  // 水域設定とPBR pipelineを関連付け、各描画段階のGPU資源をまとめて管理する
  constructor(gpu, pipeline, body, options) {
    this.gpu = gpu;
    this.pipeline = pipeline;
    this.body = body;
    this.options = options;
    this.fieldKey = null;
    this.lastFrame = { causticDispatches: 0, receiverPasses: 0, surfaceDispatches: 0, geometryDispatches: 0, depthPasses: 0 };
  }

  // 直接光の向きを検証し、水域設定と時刻が変わった場合に照度を再生成する
  // 可視面の受光maskは毎frame描き、カメラ相対の投影bufferとともに照明段階へ返す
  prepare(encoder, cameraFrame, light, directionalEnabled) {
    this.profiler.beginFrame();
    this.lastFrame = { causticDispatches: 0, receiverPasses: 0, surfaceDispatches: 0, geometryDispatches: 0, depthPasses: 0 };
    if (!this.field || !this.body.receivers.size || !directionalEnabled) return null;
    const direction = light.direction;
    if (Math.abs(direction[0]) > 1e-6 || direction[1] >= 0 || Math.abs(direction[2]) > 1e-6) {
      this.profiler.cancelFrame();
      throw new Error("Water caustics projection currently requires a vertical downward directional light");
    }
    const o = this.body.options;
    const key = JSON.stringify([o, o.speed === 0 || o.amplitude === 0 ? 0 : this.body.time]);
    if (key !== this.fieldKey) this.field.dirty = true;
    this.field.encode(encoder, this.body, {
      // 集光のクリア・追跡・解決に対応するtimestampの書込先を返す
      writes: index => this.profiler.getTimestampWrites(["clear", "trace", "resolve"][index])
    });
    this.fieldKey = key;
    this.mask.receivers = this.body.receivers;
    this.mask.renderReceivers(this.pipeline.currentSpace, cameraFrame, this.pipeline.width, this.pipeline.height);
    const origin = cameraFrame.worldPointToCameraRelative(o.origin);
    this.gpu.queue.writeBuffer(this.params, 0, new Float32Array([
      ...origin, o.extent, o.surfaceHeight - o.origin[1], o.waterlineFade, o.width / 2, o.depth / 2
    ]));
    this.lastFrame.causticDispatches = this.field.dispatches;
    this.lastFrame.receiverPasses = 1;
    return { causticParams: this.params, causticField: this.field.view,
      causticSampler: this.sampler, causticMask: this.mask.emissiveTarget };
  }

  // 水面の深度・法線を先に更新し、後続の透明面と粒子の前後判定に使う
  prepareGeometry(encoder, scene, resources, frame) {
    const result = this.surface.encode(encoder, scene, resources, {
      body: this.body, profiler: this.profiler, ...frame, geometryOnly: true
    });
    this.lastFrame.geometryDispatches = 1;
    this.lastFrame.depthPasses++;
    return result;
  }

  // 水面の屈折・反射をHDRへ合成し、後段が使う色・深度・法線を返す
  composite(encoder, scene, resources, frame) {
    if (!this.surface) return { scene, depth: resources.depth, normal: resources.normal };
    const result = this.surface.encode(encoder, scene, resources, {
      body: this.body, profiler: this.profiler, ...frame
    });
    this.lastFrame.surfaceDispatches = 1;
    this.lastFrame.depthPasses++;
    return result;
  }

  // frame内のtimestampを解決する命令をencoderへ記録する
  finish(encoder) { this.profiler.endFrame(encoder); }
  // GPUへのsubmit後に計測結果の回収を進め、次の統計更新へつなぐ
  afterGpuSubmit() { this.profiler.afterSubmit(); }

  // 有効な機能、直近frameの仕事量、GPU計測値をまとめて返す
  getStats() {
    return { ...this.options, ...this.lastFrame, timing: this.profiler.getSnapshot() };
  }

  // 計測・透明背景・水面・受光mask・照度の所有資源を順に解放する
  // Deferred Lightingの専用variantも解放し、通常PBRの資源を残す
  destroy() {
    this.profiler?.destroy();
    this.layers?.destroy();
    this.surface?.destroy();
    this.mask?.destroy();
    this.field?.destroy();
    this.params?.destroy();
    this.pipeline.deferredLightingPass.releaseCaustics();
  }
}
