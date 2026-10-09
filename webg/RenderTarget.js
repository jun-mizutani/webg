// ---------------------------------------------
//  RenderTarget.js  2026/09/09
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import util from "./util.js";
import { requireDepthConvention } from "./DepthConvention.js";

export default class RenderTarget {

  // offscreen color/depth texture をまとめて管理する
  constructor(gpu, options = {}) {
    this.gpu = gpu;
    this.device = null;
    this.queue = null;
    this.label = options.label ?? "RenderTarget";
    this.width = util.readOptionalInteger(options.width, "RenderTarget width", 1, { min: 1 });
    this.height = util.readOptionalInteger(options.height, "RenderTarget height", 1, { min: 1 });
    this.format = options.format ?? "rgba8unorm";
    this.hasDepth = options.hasDepth !== false;
    // 被写界深度のような後段 pass から深度 texture を読みたい場合は、
    // sampleDepth を true にすると TEXTURE_BINDING usage を追加する
    // depth formatはdepthConventionから取得する
    this.sampleDepth = options.sampleDepth === true;
    this.depthConvention = this.hasDepth
      ? requireDepthConvention(options.depthConvention, `${this.label} depthConvention`)
      : null;
    this.depthFormat = this.depthConvention?.format ?? null;
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

  // textureを作り直す前に現在のGPU資源を破棄する
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
  // 既存textureと寸法が同じ場合はGPU resourceを維持し、再生成しなかったことをfalseで返す
  resize(width, height) {
    const nextWidth = util.readOptionalInteger(width, "RenderTarget width", this.width, { min: 1 });
    const nextHeight = util.readOptionalInteger(height, "RenderTarget height", this.height, { min: 1 });
    const hasCompleteTextures = this.colorTexture !== null
      && (!this.hasDepth || this.depthTexture !== null);
    if (nextWidth === this.width && nextHeight === this.height && hasCompleteTextures) {
      return false;
    }
    this.width = nextWidth;
    this.height = nextHeight;
    if (!this.device) {
      return false;
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
    return true;
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

  // 現在のcolor/depth target幅を返し、画面やpassの寸法計算へ渡します
  getWidth() {
    return this.width;
  }

  // 現在のcolor/depth target高さを返し、画面やpassの寸法計算へ渡します
  getHeight() {
    return this.height;
  }

  // color textureのformatを返し、後段passの入力検証へ渡します
  getFormat() {
    return this.format;
  }

  // color texture本体を返し、GPU copyや外部resource接続へ利用します
  getTexture() {
    return this.colorTexture;
  }

  // color texture viewを返し、render passの描画先へ渡します
  getView() {
    return this.colorView;
  }

  // color viewを明示名で返し、色入力を要求するpassへ渡します
  getColorView() {
    return this.colorView;
  }

  // depth attachment用viewを返し、depth render passへ渡します
  getDepthView() {
    return this.depthView;
  }

  // depth texture本体を返し、depth copyやresource管理へ利用します
  getDepthTexture() {
    return this.depthTexture;
  }

  // shader sampling用depth viewを返し、DoFやSSRの深度入力へ渡します
  getDepthSampleView() {
    return this.depthSampleView;
  }

  // depth textureがshader sampling用途で生成されたかを返します
  isDepthSampled() {
    return this.sampleDepth;
  }

  // color texture用samplerを返し、全画面passのtexture samplingへ渡します
  getSampler() {
    return this.sampler;
  }
}
