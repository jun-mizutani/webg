// ---------------------------------------------
// WaterSurfacePass.js  2026/10/04
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// 画面内のPBR背景を屈折し、同じ環境・directional lightを水面へ反射する

import ComputePass from "./ComputePass.js";
import StorageTargetFactory from "./StorageTargetFactory.js";
import { GBUFFER_WGSL_COMMON, createGBufferProjectionParams } from "./GeometryBufferPass.js";
import { PBR_BRDF_WGSL } from "./PbrBrdf.js";
import { WATER_WAVE_WGSL } from "./WaterWaveWgsl.js";
import { buildWaterSurfaceWgsl } from "./WaterSurfaceWgsl.js";
import WaterDepthPass from "./WaterDepthPass.js";

export default class WaterSurfacePass {
  // GPU出力先の準備とshader compilationを確認し、成功した水面passを返す
  static async create(gpu, width, height) {
    const result = new WaterSurfacePass(gpu, width, height);
    try {
      await Promise.all(result.targets.map(target => target.ready));
      const infos = await Promise.all([result.pass, result.geometryPass].map(p => p.shaderModule.getCompilationInfo()));
      const errors = infos.flatMap(info => info.messages).filter(message => message.type === "error");
      if (errors.length) throw new Error(errors.map(m => m.message).join("\n"));
      return result;
    } catch (error) { result.destroy(); throw error; }
  }

  // 水面の色・深度・法線の出力先とカメラbufferを作り、合成用と深度更新用のpassを準備する
  constructor(gpu, width, height) {
    this.gpu = gpu;
    const factory = new StorageTargetFactory(gpu);
    this.output = factory.create({ label: "water:hdr", width, height, format: "rgba16float" });
    this.depthValues = factory.create({ label: "water:depth-values", width, height, format: "r32float" });
    this.normal = factory.create({ label: "water:normal", width, height, format: "rgba8unorm" });
    this.targets = [this.output, this.depthValues, this.normal];
    this.depth = new WaterDepthPass(gpu, width, height);
    this.camera = gpu.device.createBuffer({ label: "water:camera", size: 112,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.pass = new ComputePass(gpu, {
      label: "water:surface", code: WATER_WAVE_WGSL + GBUFFER_WGSL_COMMON
        + PBR_BRDF_WGSL + buildWaterSurfaceWgsl(), uniformFloats: 44,
      bindings: [
        { binding: 0, name: "params", type: "uniform-buffer" },
        { binding: 1, name: "scene", type: "sampled-texture" },
        { binding: 2, name: "depth", type: "depth-texture" },
        { binding: 3, name: "sampler", type: "sampler" },
        { binding: 4, name: "camera", type: "read-only-storage-buffer" },
        { binding: 5, name: "output", type: "storage-texture", format: "rgba16float", dispatchSize: true },
        { binding: 6, name: "normal", type: "sampled-texture" },
        { binding: 7, name: "depthOutput", type: "storage-texture", format: "r32float" },
        { binding: 8, name: "normalOutput", type: "storage-texture", format: "rgba8unorm" },
        { binding: 9, name: "specularEnvironment", type: "sampled-texture" },
        { binding: 10, name: "environmentSampler", type: "sampler" }
      ]
    });
    this.geometryPass = new ComputePass(gpu, { label: "water:geometry",
      code: WATER_WAVE_WGSL + GBUFFER_WGSL_COMMON + PBR_BRDF_WGSL
        + buildWaterSurfaceWgsl({ geometryOnly: true }), uniformFloats: 44,
      bindings: this.pass.bindings });
  }

  // 波・カメラ基底・PBR照明をGPUへ渡し、水面の色・深度・法線を更新する
  // 深度は後段の共通attachmentへ転写し、三つの出力先を合成結果として返す
  encode(encoder, scene, resources, { body, cameraFrame, environment, light, lighting, profiler, geometryOnly = false }) {
    const o = body.options;
    for (const target of this.targets) target.resize(scene.width, scene.height);
    const m = cameraFrame.cameraWorldMatrix.mat;
    const eye = cameraFrame.worldPointToCameraRelative(o.origin).map(v => -v);
    const values = body.createWaveUniforms();
    values.set([...eye, 0], 12);
    values.set([m[0], m[1], m[2], cameraFrame.aspect], 16);
    values.set([m[4], m[5], m[6], 0], 20);
    values.set([-m[8], -m[9], -m[10], Math.tan(cameraFrame.vfov * Math.PI / 360)], 24);
    const pass = geometryOnly ? this.geometryPass : this.pass;
    pass.setUniforms(values);
    this.gpu.queue.writeBuffer(this.camera, 0, new Float32Array([
      ...createGBufferProjectionParams(cameraFrame), o.width / 2, o.depth / 2, o.roughness, 0,
      ...o.absorption, 0, ...(light?.direction ?? [0, -1, 0]), light ? lighting.directionalIntensity : 0,
      ...lighting.directionalColor, 0,
      environment.enabled ? 1 : 0, environment.intensity, environment.specularMipCount, 0,
      environment.rotationCos ?? 1, environment.rotationSin ?? 0, 0, 0
    ]));
    pass.encode(encoder, { scene, depth: resources.depth, normal: resources.normal,
      sampler: this.output.sampler, camera: this.camera, output: this.output,
      depthOutput: this.depthValues, normalOutput: this.normal,
      specularEnvironment: environment.prefilteredSpecular, environmentSampler: environment.sampler
    }, { timestampWrites: profiler?.getTimestampWrites(geometryOnly ? "geometry" : "surface") });
    this.depth.encode(encoder, this.depthValues, profiler?.getTimestampWrites(geometryOnly ? "geometryDepth" : "depth"));
    return { scene: this.output, depth: this.depth, normal: this.normal };
  }

  // 合成用と深度更新用のCompute pass、カメラbuffer、深度、出力画像を解放する
  destroy() {
    this.geometryPass?.destroy();
    this.pass?.destroy();
    this.camera?.destroy();
    this.depth?.destroy();
    for (const target of this.targets) target.destroy();
  }
}
