// ---------------------------------------------
// WaterLayerPass.js  2026/10/04
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// 水面の背後のAlpha Blend面と粒子だけを屈折用HDRに加える
// 手前のlayerは通常の透明pass/粒子passが水面深度で描く

import RenderTarget from "./RenderTarget.js";
import PbrForwardShader from "./PbrForwardShader.js";
import { buildComputeParticleRenderWgsl } from "./ComputeParticleShaders.js";

export default class WaterLayerPass {
  // 水面の奥を描くHDR画像と透明面shaderを作り、粒子pipelineの再利用用cacheを準備する
  constructor(gpu, width, height) {
    this.gpu = gpu;
    this.output = new RenderTarget(gpu, { label: "water:underwater-layers", width, height,
      hasDepth: false, format: "rgba16float",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
        | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST });
    this.shader = new PbrForwardShader(gpu, {
      colorFormat: "rgba16float", depthWriteEnabled: false, waterDepthClip: true
    });
    this.ready = Promise.all([this.output.ready, this.shader.init()]);
    this.particlePipelines = new Map();
  }

  // emitterの更新は一度だけ。水中・手前の描画で同じGPU粒子bufferを共有する
  prepareParticles(encoder, particlePass, cameraFrame, deltaSec) {
    const active = [];
    for (const emitter of particlePass?.emitters ?? []) {
      if (emitter.destroyed) { particlePass.emitters.delete(emitter); continue; }
      emitter.encodeFrame(encoder, { cameraFrame, deltaSec });
      if (emitter.getEstimatedAliveCount() > 0) active.push(emitter);
    }
    return active;
  }

  // 水面の奥だけを描く粒子pipelineを取得し、初回作成後はcacheを再利用する
  getParticlePipeline(emitter) {
    let pipeline = this.particlePipelines.get(emitter);
    if (pipeline) return pipeline;
    const device = this.gpu.device;
    const module = device.createShaderModule({ label: "water:underwater-particles",
      code: buildComputeParticleRenderWgsl({ behindWater: true }) });
    const waterLayout = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "depth" } }
    ] });
    pipeline = device.createRenderPipeline({ label: "water:underwater-particles",
      layout: device.createPipelineLayout({ bindGroupLayouts: [emitter.renderPipeline.getBindGroupLayout(0), waterLayout] }),
      vertex: { module, entryPoint: "vsMain", buffers: [{ arrayStride: 8,
        attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }] }] },
      fragment: { module, entryPoint: "fsMain", targets: [{ format: "rgba16float",
        blend: { color: { srcFactor: "src-alpha", dstFactor: "one", operation: "add" },
          alpha: { srcFactor: "zero", dstFactor: "one", operation: "add" } } }] },
      primitive: { topology: "triangle-list" },
      depthStencil: { format: "depth32float", depthWriteEnabled: false, depthCompare: "greater" }
    });
    this.particlePipelines.set(emitter, pipeline);
    return pipeline;
  }

  // 不透明HDRを複製し、水面深度より奥の透明面と粒子を順に重ねる
  // 出力は水面の屈折背景に使い、手前の透明layerは後続の通常passで描く
  encode(encoder, scene, opaqueDepth, waterDepth, {
    cameraFrame, space, hasTriangles, activeParticles, lighting, lightOverride, localLights, shadow
  }) {
    if (!hasTriangles && activeParticles.length === 0) return scene;
    this.output.resize(scene.width, scene.height);
    encoder.copyTextureToTexture({ texture: scene.colorTexture }, { texture: this.output.colorTexture },
      [scene.width, scene.height]);
    if (hasTriangles) {
      this.shader.waterDepthView = waterDepth.getDepthSampleView();
      this.shader.setProjectionMatrix(cameraFrame.projectionMatrix);
      this.shader.setDefaultParam("radiance", lighting.directionalColor.map(c => c * lighting.directionalIntensity));
      this.shader.setEnvironment(lighting.environment, lighting.environmentIntensity, cameraFrame,
        lighting.environmentRotationDegrees ?? 0);
      this.shader.setFrameLighting(shadow, localLights);
      this.shader.setTransmissionPassScale(0);
      const pass = encoder.beginRenderPass({ label: "water:underwater-alpha",
        colorAttachments: [{ view: this.output.getView(), loadOp: "load", storeOp: "store" }],
        depthStencilAttachment: { view: opaqueDepth.getDepthView(), depthReadOnly: true } });
      this.gpu.passEncoder = pass;
      this.gpu.uniformIndex = 1;
      try { space.draw(cameraFrame, { onlyTranslucent: true, shaderOverride: this.shader, lightOverride }); }
      finally { pass.end(); this.gpu.passEncoder = null; }
    }
    for (const emitter of activeParticles) {
      const pipeline = this.getParticlePipeline(emitter);
      const group = this.gpu.device.createBindGroup({ label: "water:particle-depth",
        layout: pipeline.getBindGroupLayout(1), entries: [{ binding: 0, resource: waterDepth.getDepthSampleView() }] });
      const pass = encoder.beginRenderPass({ label: "water:underwater-particles",
        colorAttachments: [{ view: this.output.getView(), loadOp: "load", storeOp: "store" }],
        depthStencilAttachment: { view: opaqueDepth.getDepthView(), depthReadOnly: true } });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, emitter.renderBindGroup);
      pass.setBindGroup(1, group);
      pass.setVertexBuffer(0, emitter.quadBuffer);
      pass.draw(6, emitter.particleCount);
      pass.end();
    }
    return this.output;
  }

  // 透明面shaderとHDR出力を解放し、再利用していた粒子pipelineのcacheを空にする
  destroy() {
    this.shader.destroy();
    this.output.destroy();
    this.particlePipelines.clear();
  }
}
