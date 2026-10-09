// ---------------------------------------------
// ComputeParticlePass.js  2026/10/04
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// 透明合成後、画面効果前のHDR画像へ複数Emitterの発光をまとめる

import RenderTarget from "./RenderTarget.js";
import ComputeParticleEmitter from "./ComputeParticleEmitter.js";

export default class ComputeParticlePass {
  // 最初のEmitter登録時に一つだけ中間HDR画像を用意する
  constructor(gpu, { width, height }) {
    this.gpu = gpu;
    this.emitters = new Set();
    this.destroyed = false;
    this.target = new RenderTarget(gpu, { width, height, hasDepth: false, format: "rgba16float",
      label: "compute-particle-hdr", usage: GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST
        | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    this.ready = this.target.ready.then(() => {
      if (this.destroyed) { this.target.destroy(); throw new Error("particle pass destroyed during initialization"); }
      return this;
    });
  }

  // 同じGPUDeviceのEmitterを登録し、破棄までこのpassで管理する
  add(emitter) {
    if (this.destroyed) throw new Error("particle pass is destroyed");
    if (!(emitter instanceof ComputeParticleEmitter) || emitter.device !== this.gpu.device) {
      throw new Error("particle pass requires a ComputeParticleEmitter on the same device");
    }
    emitter.requireAlive();
    this.emitters.add(emitter);
  }

  // Bloom設定から独立して全Emitterを更新し、生存予約があるframeだけHDRをコピーする
  encode(encoder, scene, { depth, cameraFrame, deltaSec, activeParticles = null }) {
    if (this.destroyed) throw new Error("particle pass is destroyed");
    const active = activeParticles ?? [];
    for (const emitter of activeParticles === null ? this.emitters : []) {
      if (emitter.destroyed) { this.emitters.delete(emitter); continue; }
      emitter.encodeFrame(encoder, { cameraFrame, deltaSec });
      if (emitter.getEstimatedAliveCount() > 0) active.push(emitter);
    }
    if (active.length === 0) return scene;
    this.target.resize(scene.getWidth(), scene.getHeight());
    encoder.copyTextureToTexture({ texture: scene.colorTexture }, { texture: this.target.colorTexture },
      [scene.getWidth(), scene.getHeight(), 1]);
    for (const emitter of active) emitter.encodeRender(encoder,
      { colorView: this.target.getColorView(), depthView: depth.getDepthView() });
    return this.target;
  }

  // 描画サイズ変更時に中間画像も合わせる
  resize(width, height) { this.target.resize(width, height); }

  // 登録した粒子bufferと中間画像を一緒に解放する
  destroy() {
    if (this.destroyed) return false;
    this.destroyed = true;
    for (const emitter of this.emitters) emitter.destroy();
    this.emitters.clear();
    this.target.destroy();
    return true;
  }
}
