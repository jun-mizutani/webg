// ---------------------------------------------
//  RenderTarget.js  2026/03/30
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

export default class RenderTarget {

  // offscreen color/depth texture をまとめて管理する
  constructor(gpu, options = {}) {
    this.gpu = gpu;
    this.device = null;
    this.queue = null;
    this.label = options.label ?? "RenderTarget";
    this.width = Math.max(1, Math.floor(options.width ?? 1));
    this.height = Math.max(1, Math.floor(options.height ?? 1));
    this.format = options.format ?? "rgba8unorm";
    this.hasDepth = options.hasDepth !== false;
    // 被写界深度のような後段 pass から深度 texture を読みたい場合は、
    // sampleDepth を true にすると TEXTURE_BINDING usage を追加する
    // depth format 自体は既存 pipeline と合わせるため従来値を既定に保つ
    this.sampleDepth = options.sampleDepth === true;
    this.depthFormat = options.depthFormat ?? "depth24plus";
    this.usage = options.usage
      ?? (GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC);
    this.depthUsage = options.depthUsage
      ?? (GPUTextureUsage.RENDER_ATTACHMENT | (this.sampleDepth ? GPUTextureUsage.TEXTURE_BINDING : 0));
    this.colorTexture = null;
    this.colorView = null;
    this.depthTexture = null;
    this.depthView = null;
    this.depthSampleView = null;
    this.sampler = null;
    this.ready = this.init(options);
  }

  // GPU device 準備完了後に texture 群を作る
  async init(options = {}) {
    if (this.gpu?.ready) {
      await this.gpu.ready;
    }
    this.device = this.gpu?.device ?? null;
    this.queue = this.gpu?.queue ?? null;
    if (!this.device) {
      throw new Error("RenderTarget requires a ready WebGPU device");
    }
    this.createSampler(options.samplerDescriptor);
    this.resize(this.width, this.height);
    return this;
  }

  // fullscreen pass から読む sampler を 1 つ保持する
  createSampler(descriptor = null) {
    const samplerDescriptor = descriptor ?? {
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge"
    };
    this.sampler = this.device.createSampler(samplerDescriptor);
  }

  // texture を作り直す前に旧 GPU 資源を破棄する
  destroyTextures() {
    if (this.colorTexture) {
      this.colorTexture.destroy();
    }
    if (this.depthTexture) {
      this.depthTexture.destroy();
    }
    this.colorTexture = null;
    this.colorView = null;
    this.depthTexture = null;
    this.depthView = null;
    this.depthSampleView = null;
  }

  // 指定サイズに合わせて color/depth texture を作る
  resize(width, height) {
    this.width = Math.floor(width ?? this.width);
    this.height = Math.floor(height ?? this.height);
    if (!this.device) {
      return;
    }

    this.destroyTextures();

    this.colorTexture = this.device.createTexture({
      label: `${this.label}:color`,
      size: [this.width, this.height, 1],
      format: this.format,
      usage: this.usage
    });
    this.colorView = this.colorTexture.createView();

    if (this.hasDepth) {
      this.depthTexture = this.device.createTexture({
        label: `${this.label}:depth`,
        size: [this.width, this.height, 1],
        format: this.depthFormat,
        usage: this.depthUsage
      });
      this.depthView = this.depthTexture.createView();
      this.depthSampleView = this.sampleDepth ? this.depthTexture.createView() : this.depthView;
    }
  }

  // screen の現在サイズへ追従する
  resizeToScreen(screen) {
    this.resize(screen.getWidth(), screen.getHeight());
    return this;
  }

  // 明示的に破棄する
  destroy() {
    this.destroyTextures();
    this.sampler = null;
  }

  getWidth() {
    return this.width;
  }

  getHeight() {
    return this.height;
  }

  getFormat() {
    return this.format;
  }

  getTexture() {
    return this.colorTexture;
  }

  getView() {
    return this.colorView;
  }

  getColorView() {
    return this.colorView;
  }

  getDepthView() {
    return this.depthView;
  }

  getDepthTexture() {
    return this.depthTexture;
  }

  getDepthSampleView() {
    return this.depthSampleView;
  }

  isDepthSampled() {
    return this.sampleDepth;
  }

  getSampler() {
    return this.sampler;
  }
}
