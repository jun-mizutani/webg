// ---------------------------------------------
// Shader.js       2026/04/30
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import util from "./util.js";

export default class Shader {
  // GPU参照と共通状態を初期化する
  constructor(gpu) {
    // Shader基底クラス:
    // 各派生シェーダ(Phong/BonePhong/Font/Background)の共通処理を集約する
    this.gpu = gpu;
    this.device = null;
    this.pipeline = null;
    this.bindGroupLayout = null;
    this.uniformBuffer = null;
    this.uniformData = null;
    this.default = {};
    this.change = {};
    this.defaultTexture = null;
    this.defaultTextureView = null;
    this.defaultSampler = null;
    this.defaultTextureResource = null;
    this.bindGroupCache = null;
    this.dynamicOffsetGroup0 = false;
    this.activeUniformIndex = 0;
  }

  async init() {
    // GPU準備完了を待ってから、派生クラスのリソース生成へ進む
    if (this.gpu?.ready) {
      await this.gpu.ready;
    }
    this.device = this.gpu?.device ?? null;
    if (!this.device) {
      util.printf("WebGPU device is not ready.\n");
      return false;
    }
    this.createResources();
    return true;
  }

  // 派生クラスで実装するリソース生成フック
  createResources() {
    // implemented in subclasses
  }

  // 指定サイズのUniform Bufferを作成する
  createUniformBuffer(byteLength) {
    // Uniform専用GPUBufferを生成する
    this.uniformBuffer = this.device.createBuffer({
      size: byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
  }

  createShaderModule(code) {
    return this.device.createShaderModule({ code });
  }

  createPipelineLayout(bindGroupLayouts) {
    return this.device.createPipelineLayout({ bindGroupLayouts });
  }

  createUniformBindGroupLayout({
    hasDynamicOffset = false,
    visibility = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
    binding = 0
  } = {}) {
    return this.device.createBindGroupLayout({
      entries: [
        {
          binding,
          visibility,
          buffer: { type: "uniform", hasDynamicOffset }
        }
      ]
    });
  }

  createTextureBindGroupLayout({
    samplerBinding = 0,
    textureBinding = 1,
    samplerVisibility = GPUShaderStage.FRAGMENT,
    textureVisibility = GPUShaderStage.FRAGMENT,
    sampler = {},
    texture = {}
  } = {}) {
    return this.device.createBindGroupLayout({
      entries: [
        { binding: samplerBinding, visibility: samplerVisibility, sampler },
        { binding: textureBinding, visibility: textureVisibility, texture }
      ]
    });
  }

  createUniformTextureBindGroupLayout({
    hasDynamicOffset = false,
    uniformBinding = 0,
    textureBinding = 1,
    samplerBinding = 2,
    uniformVisibility = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
    textureVisibility = GPUShaderStage.FRAGMENT,
    samplerVisibility = GPUShaderStage.FRAGMENT,
    texture = { sampleType: "float" },
    sampler = { type: "filtering" }
  } = {}) {
    return this.device.createBindGroupLayout({
      entries: [
        {
          binding: uniformBinding,
          visibility: uniformVisibility,
          buffer: { type: "uniform", hasDynamicOffset }
        },
        { binding: textureBinding, visibility: textureVisibility, texture },
        { binding: samplerBinding, visibility: samplerVisibility, sampler }
      ]
    });
  }

  createDefaultTexture({
    width = 1,
    height = 1,
    format = "rgba8unorm",
    usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    data = null,
    color = [255, 255, 255, 255],
    samplerDescriptor = {
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "linear"
    }
  } = {}) {
    // テクスチャ未設定時でも描画が成立するよう、1x1既定テクスチャを作る
    const bytes = data ?? (() => {
      const out = new Uint8Array(width * height * 4);
      for (let i = 0; i < width * height; i++) {
        const o = i * 4;
        out[o] = color[0];
        out[o + 1] = color[1];
        out[o + 2] = color[2];
        out[o + 3] = color[3];
      }
      return out;
    })();

    this.defaultTexture = this.device.createTexture({
      size: [width, height, 1],
      format,
      usage
    });

    this.gpu.queue.writeTexture(
      { texture: this.defaultTexture },
      bytes,
      { bytesPerRow: width * 4 },
      { width, height, depthOrArrayLayers: 1 }
    );

    this.defaultTextureView = this.defaultTexture.createView();
    this.defaultSampler = this.device.createSampler(samplerDescriptor);
    this.defaultTextureResource = {
      texture: this.defaultTexture,
      view: this.defaultTextureView,
      sampler: this.defaultSampler
    };
    return this.defaultTextureResource;
  }

  resolveTextureResources(texture) {
    const view = texture?.getView?.()
      ?? texture?.view
      ?? texture?.createView?.();
    const sampler = texture?.getSampler?.()
      ?? texture?.sampler;
    return { view, sampler };
  }

  getOrCreateTexturedBindGroup({
    texture = null,
    cache = this.bindGroupCache,
    layout = this.bindGroupLayout,
    uniformBinding = 0,
    textureBinding = 1,
    samplerBinding = 2,
    uniformBuffer = this.uniformBuffer,
    uniformSize = null
  } = {}) {
    // texture単位でBindGroupをキャッシュし、毎描画の再生成を避ける
    const cacheKey = texture?.getTexture?.()
      ?? texture?.texture
      ?? texture;
    if (cacheKey && cache?.has?.(cacheKey)) {
      return cache.get(cacheKey);
    }

    const { view, sampler } = this.resolveTextureResources(texture);
    if (!view) {
      throw new Error(`${this.constructor.name} requires a texture view for bind group creation`);
    }
    if (!sampler) {
      throw new Error(`${this.constructor.name} requires a sampler for bind group creation`);
    }
    const entries = [];
    if (uniformBuffer) {
      const resource = uniformSize !== null
        ? { buffer: uniformBuffer, size: uniformSize }
        : { buffer: uniformBuffer };
      entries.push({ binding: uniformBinding, resource });
    }
    entries.push({ binding: textureBinding, resource: view });
    entries.push({ binding: samplerBinding, resource: sampler });

    const bindGroup = this.device.createBindGroup({ layout, entries });
    if (cacheKey && cache?.set) {
      cache.set(cacheKey, bindGroup);
    }
    return bindGroup;
  }

  // 現在の `uniformData` をGPUへ転送する
  updateUniforms() {
    // 現在のuniformDataをGPUへ転送する
    // dynamic offset時は activeUniformIndex に対応する領域へ書き込む
    if (!this.uniformBuffer || !this.uniformData) return;
    let offset = 0;
    if (this.dynamicOffsetGroup0 && this.uniformStride) {
      offset = this.activeUniformIndex * this.uniformStride;
    }
    this.gpu.queue.writeBuffer(
      this.uniformBuffer,
      offset,
      this.uniformData.buffer,
      0,
      this.uniformData.byteLength
    );
  }

  // 配列型Uniformの `index` 位置へ転送する
  updateUniformsAt(index) {
    if (!this.uniformBuffer || !this.uniformData || !this.uniformStride) return;
    const offset = this.uniformStride * index;
    this.gpu.queue.writeBuffer(this.uniformBuffer, offset, this.uniformData.buffer, 0, this.uniformData.byteLength);
  }

  // 動的オフセット用インデックスを確保する
  allocUniformIndex() {
    // 1フレーム内の動的uniformスロット番号を払い出す
    // slot 0 は Font の基礎設定(scale / color / texStep など)の
    // 即時更新領域として予約しているため、描画用 slot は 1 から使う
    if (!this.gpu) return 0;
    if (this.gpu.uniformIndex === undefined) {
      this.gpu.uniformIndex = 1;
    }
    const idx = this.gpu.uniformIndex;
    this.gpu.uniformIndex += 1;
    return idx;
  }

  // パイプラインをセットする
  useProgram(passEncoder = this.gpu?.passEncoder) {
    if (!passEncoder || !this.pipeline) return;
    passEncoder.setPipeline(this.pipeline);
  }

  // `shaderParameter` の差分適用ユーティリティ
  updateParam(param, key, updateFunc) {
    // Shape側パラメータが未指定なら default へ自動復帰させる共通処理
    const compare = (table1, table2) => {
      if (table1 === table2) return true;
      if (table1.length !== table2.length) return false;
      for (let i = 0; i < table1.length; i++) {
        if (table1[i] !== table2[i]) return false;
      }
      return true;
    };

    if (param[key] !== undefined) {
      this.change[key] = param[key];
      updateFunc.call(this, param[key]);
    } else {
      const c = this.change;
      if (c[key] !== undefined) {
        const d = this.default;
        if (typeof d[key] === "object") {
          if (!compare(c[key], d[key])) {
            c[key] = d[key];
            updateFunc.call(this, d[key]);
          }
        } else if (c[key] !== d[key]) {
          c[key] = d[key];
          updateFunc.call(this, d[key]);
        }
      }
    }
  }
}
