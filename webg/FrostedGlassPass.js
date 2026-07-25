// ---------------------------------------------
//  FrostedGlassPass.js  2026/06/21
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import RenderTarget from "./RenderTarget.js";
import SeparableBlurPass from "./SeparableBlurPass.js";
import util from "./util.js";

export default class FrostedGlassPass {

  // 生成段階: 曇りガラス合成に必要な設定値と中間 pass の参照を用意する
  // この時点では WebGPU device が未準備でもよいように、GPU resource 作成は init() に任せる
  constructor(gpu, options = {}) {
    this.gpu = gpu;
    this.device = null;
    this.queue = null;
    this.enabled = options.enabled !== false;
    this.width = util.readOptionalInteger(options.width, "FrostedGlassPass width", 1, { min: 1 });
    this.height = util.readOptionalInteger(options.height, "FrostedGlassPass height", 1, { min: 1 });
    this.sceneFormat = options.sceneFormat ?? gpu?.format ?? "bgra8unorm";
    this.canvasFormat = options.canvasFormat ?? gpu?.format ?? "bgra8unorm";
    this.depthConvention = options.depthConvention ?? gpu?.depthConvention;
    this.blurRadius = util.readOptionalFiniteNumber(options.blurRadius, "FrostedGlassPass blurRadius", 2.2, { min: 0 });
    this.blurIterations = util.readOptionalInteger(options.blurIterations, "FrostedGlassPass blurIterations", 2, { min: 1 });
    this.blurScale = util.readOptionalFiniteNumber(options.blurScale, "FrostedGlassPass blurScale", 0.5, { minExclusive: 0 });
    this.blurStrength = util.readOptionalFiniteNumber(options.blurStrength, "FrostedGlassPass blurStrength", 1.0, { min: 0, max: 1 });
    this.tintStrength = util.readOptionalFiniteNumber(options.tintStrength, "FrostedGlassPass tintStrength", 0.25, { min: 0, max: 1 });
    this.maskPower = util.readOptionalFiniteNumber(options.maskPower, "FrostedGlassPass maskPower", 1.0, { minExclusive: 0 });
    this.sceneTarget = null;
    this.maskTarget = null;
    this.blurPass = new SeparableBlurPass(gpu, {
      width: this.width,
      height: this.height,
      targetFormat: this.sceneFormat,
      labelPrefix: "FrostedGlassPass:blur",
      blurRadius: this.blurRadius,
      targetScale: this.blurScale,
      iterations: this.blurIterations
    });
    this.vertexBuffer = null;
    this.sampler = null;
    this.uniformData = new Float32Array(8);
    this.uniformBuffer = null;
    this.layout = null;
    this.pipeline = null;
    this.ready = this.init();
  }

  // GPU 準備段階: sampler、quad、buffer、pipeline、render target を順に作る
  // await frosted.ready の完了後に beginScene() 以降の描画 API を使える
  async init() {
    if (this.gpu?.ready) {
      await this.gpu.ready;
    }
    this.device = this.gpu?.device ?? null;
    this.queue = this.gpu?.queue ?? null;
    if (!this.device) {
      throw new Error("FrostedGlassPass requires a ready WebGPU device");
    }
    this.createSampler();
    this.createQuad();
    this.createBuffers();
    this.createLayout();
    this.createPipeline();
    await this.createTargets();
    await this.blurPass.ready;
    this.updateUniforms();
    return this;
  }

  // texture 読み取り準備段階: scene、blur、mask を線形補間で読む sampler を作る
  // fullscreen composite では 3 枚の texture を同じ補間条件で読む
  createSampler() {
    this.sampler = this.device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge"
    });
  }

  // fullscreen 描画準備段階: 画面全体を覆う triangle-strip の頂点 buffer を作る
  // composite shader はこの quad の UV で scene、blur、mask を読む
  createQuad() {
    const vertices = new Float32Array([
      -1.0, -1.0, 0.0, 1.0,
       1.0, -1.0, 1.0, 1.0,
      -1.0,  1.0, 0.0, 0.0,
       1.0,  1.0, 1.0, 0.0
    ]);
    this.vertexBuffer = this.device.createBuffer({
      size: vertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    });
    this.queue.writeBuffer(this.vertexBuffer, 0, vertices);
  }

  // uniform 準備段階: blur 強度や tint 強度を GPU へ渡す buffer を作る
  // 値そのものの書き込みは updateUniforms() で行う
  createBuffers() {
    this.uniformBuffer = this.device.createBuffer({
      size: this.uniformData.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
  }

  // bind group 設計段階: composite shader が読む uniform と 3 枚の texture binding を定義する
  // binding 1/3/5 が texture、binding 2/4/6 がそれぞれの sampler
  createLayout() {
    this.layout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 6, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } }
      ]
    });
  }

  // composite pipeline 準備段階: scene、blur、mask を合成して最終色を作る shader を作る
  // mask alpha が blur mix、mask RGB が tint の入力になる
  createPipeline() {
    const module = this.device.createShaderModule({
      code: `
struct Uniforms {
  blurStrength : f32,
  tintStrength : f32,
  enabled : f32,
  maskPower : f32,
  width : f32,
  height : f32,
  pad0 : f32,
  pad1 : f32,
};

struct VSIn {
  @location(0) position : vec2f,
  @location(1) texCoord : vec2f,
};

struct VSOut {
  @builtin(position) position : vec4f,
  @location(0) vTexCoord : vec2f,
};

@group(0) @binding(0) var<uniform> uniforms : Uniforms;
@group(0) @binding(1) var sceneTexture : texture_2d<f32>;
@group(0) @binding(2) var sceneSampler : sampler;
@group(0) @binding(3) var blurTexture : texture_2d<f32>;
@group(0) @binding(4) var blurSampler : sampler;
@group(0) @binding(5) var maskTexture : texture_2d<f32>;
@group(0) @binding(6) var maskSampler : sampler;

@vertex
fn vsMain(input : VSIn) -> VSOut {
  var output : VSOut;
  output.position = vec4f(input.position, 0.0, 1.0);
  output.vTexCoord = input.texCoord;
  return output;
}

@fragment
fn fsMain(input : VSOut) -> @location(0) vec4f {
  let sceneColor = textureSample(sceneTexture, sceneSampler, input.vTexCoord);
  if (uniforms.enabled < 0.5) {
    return sceneColor;
  }
  let blurColor = textureSample(blurTexture, blurSampler, input.vTexCoord);
  let mask = textureSample(maskTexture, maskSampler, input.vTexCoord);
  let maskAmount = pow(clamp(mask.a, 0.0, 1.0), max(uniforms.maskPower, 0.0001));
  let blurMix = clamp(maskAmount * uniforms.blurStrength, 0.0, 1.0);
  let tintMix = clamp(maskAmount * uniforms.tintStrength, 0.0, 1.0);
  let blurred = mix(sceneColor.rgb, blurColor.rgb, blurMix);
  let tinted = mix(blurred, mask.rgb, tintMix);
  return vec4f(tinted, sceneColor.a);
}`
    });
    const pipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [this.layout]
    });
    this.pipeline = this.device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module,
        entryPoint: "vsMain",
        buffers: [{
          arrayStride: 4 * 4,
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x2" },
            { shaderLocation: 1, offset: 2 * 4, format: "float32x2" }
          ]
        }]
      },
      fragment: {
        module,
        entryPoint: "fsMain",
        targets: [{ format: this.canvasFormat }]
      },
      primitive: {
        topology: "triangle-strip",
        cullMode: "none"
      }
    });
  }

  // render target 準備段階: 不透明 scene 用 target と glass mask 用 target を作る
  // blur 用 target は SeparableBlurPass の内部 target を使う
  async createTargets() {
    this.sceneTarget = new RenderTarget(this.gpu, {
      label: "FrostedGlassPass:scene",
      width: this.width,
      height: this.height,
      format: this.sceneFormat,
      hasDepth: true,
      depthConvention: this.depthConvention
    });
    this.maskTarget = new RenderTarget(this.gpu, {
      label: "FrostedGlassPass:mask",
      width: this.width,
      height: this.height,
      format: this.sceneFormat,
      hasDepth: false
    });
    await Promise.all([
      this.sceneTarget.ready,
      this.maskTarget.ready
    ]);
  }

  // uniform 更新段階: JavaScript 側の現在値を composite shader の uniform buffer へ転送する
  // slider や key 操作で値を変えた後は、この関数経由で次 frame の描画へ反映される
  updateUniforms() {
    this.uniformData[0] = this.blurStrength;
    this.uniformData[1] = this.tintStrength;
    this.uniformData[2] = this.enabled ? 1.0 : 0.0;
    this.uniformData[3] = this.maskPower;
    this.uniformData[4] = this.width;
    this.uniformData[5] = this.height;
    this.queue.writeBuffer(this.uniformBuffer, 0, this.uniformData);
  }

  // bind group 入力確認段階: RenderTarget などから color view と sampler を取り出す
  // 必要な resource が足りない場合は、どの入力が不足しているか分かる error にする
  resolveColorResources(source, label) {
    const view = source?.getColorView?.() ?? source?.getView?.() ?? source?.view ?? null;
    const sampler = source?.getSampler?.() ?? source?.sampler;
    if (!view || !sampler) {
      throw new Error(`FrostedGlassPass requires ${label} to provide color view and sampler`);
    }
    return { view, sampler };
  }

  // bind group 作成段階: scene、blur、mask の 3 入力を composite shader へ渡す
  // render() のたびに、その frame の blur 出力 target をここで binding する
  createBindGroup(sceneSource, blurSource, maskSource) {
    const scene = this.resolveColorResources(sceneSource, "scene source");
    const blur = this.resolveColorResources(blurSource, "blur source");
    const mask = this.resolveColorResources(maskSource, "mask source");
    return this.device.createBindGroup({
      layout: this.layout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: scene.view },
        { binding: 2, resource: scene.sampler },
        { binding: 3, resource: blur.view },
        { binding: 4, resource: blur.sampler },
        { binding: 5, resource: mask.view },
        { binding: 6, resource: mask.sampler }
      ]
    });
  }

  // fullscreen 描画段階: composite pipeline へ渡す quad を 1 枚描く
  // pipeline と bind group は呼び出し側で設定済みであることを前提にする
  drawQuad(passEncoder) {
    passEncoder.setVertexBuffer(0, this.vertexBuffer);
    passEncoder.draw(4, 1, 0, 0);
  }

  // resize 段階: canvas サイズ変更に合わせて scene、mask、blur target を作り直す
  // width と height は composite shader の uniform にも残しておく
  resize(width, height) {
    const nextWidth = util.readOptionalInteger(width, "FrostedGlassPass width", this.width, { min: 1 });
    const nextHeight = util.readOptionalInteger(height, "FrostedGlassPass height", this.height, { min: 1 });
    if (nextWidth === this.width && nextHeight === this.height && this.sceneTarget) {
      return false;
    }
    this.width = nextWidth;
    this.height = nextHeight;
    this.sceneTarget?.resize(this.width, this.height);
    this.maskTarget?.resize(this.width, this.height);
    this.blurPass?.resize(this.width, this.height);
    this.updateUniforms();
    return true;
  }

  // resize 連携段階: Screen が持つ現在の canvas サイズへ pass 全体を追従させる
  // unittest や WebgApp の resize callback から呼ぶ入口として使う
  resizeToScreen(screen) {
    this.resize(screen.getWidth(), screen.getHeight());
    return this;
  }

  // scene pass 開始段階: 不透明 object を描くための offscreen pass を開始する
  // この pass で作った color は後で blur され、depth は mask pass の depth test に使われる
  beginScene(screen, clearColor = screen.clearColor) {
    this.resizeToScreen(screen);
    screen.beginPass({
      target: this.sceneTarget,
      clearColor,
      colorLoadOp: "clear",
      depthClear: true
    });
  }

  // mask pass 開始段階: ガラス Shape だけを mask target へ描く pass を開始する
  // scene pass の depth を load するため、手前の不透明 object には mask が重ならない
  beginMask(screen, clearColor = [0.0, 0.0, 0.0, 0.0]) {
    screen.beginPass({
      target: this.maskTarget,
      clearColor,
      colorLoadOp: "clear",
      depthView: this.sceneTarget.getDepthView(),
      depthClear: false
    });
  }

  // composite 実行段階: scene を blur し、scene、blur、mask を合成して destination へ描く
  // destination を省略した場合は canvas へ最終結果を書き込む
  render(screen, options = {}) {
    const destination = options.destination ?? null;
    const clearColor = options.clearColor ?? [0.0, 0.0, 0.0, 1.0];
    const blurTarget = this.blurPass.render(screen, this.sceneTarget, {
      iterations: this.blurIterations,
      blurRadius: this.blurRadius
    });
    screen.beginPass({
      target: destination,
      clearColor,
      colorLoadOp: "clear",
      depthView: null
    });
    const pass = this.gpu.passEncoder;
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.createBindGroup(this.sceneTarget, blurTarget, this.maskTarget));
    this.drawQuad(pass);
    return destination;
  }

  // 設定変更段階: 曇りガラス効果そのものの on/off を切り替える
  // false のときも pass 構成は保ち、composite shader が scene color をそのまま返す
  setEnabled(flag) {
    if (typeof flag !== "boolean") {
      throw new Error("FrostedGlassPass enabled must be boolean");
    }
    this.enabled = flag;
    this.updateUniforms();
  }

  // 設定変更段階: blur のサンプル間隔を変更する
  // 値は内部の SeparableBlurPass にも渡される
  setBlurRadius(value) {
    this.blurRadius = util.readOptionalFiniteNumber(value, "FrostedGlassPass blurRadius", this.blurRadius, { min: 0 });
    this.blurPass?.setBlurRadius(this.blurRadius);
  }

  // 設定変更段階: 横 blur と縦 blur の往復回数を変更する
  // 回数を増やすほど滑らかになるが描画 pass も増える
  setBlurIterations(value) {
    this.blurIterations = util.readOptionalInteger(value, "FrostedGlassPass blurIterations", this.blurIterations, { min: 1 });
    this.blurPass?.setIterations(this.blurIterations);
  }

  // 設定変更段階: blur 用中間 target の解像度倍率を変更する
  // 0.5 なら半解像度 blur になり、負荷を抑えながら柔らかい見た目にできる
  setBlurScale(value) {
    this.blurScale = util.readOptionalFiniteNumber(value, "FrostedGlassPass blurScale", this.blurScale, { minExclusive: 0 });
    this.blurPass?.setTargetScale(this.blurScale);
  }

  // 設定変更段階: mask alpha による blur の混ぜ具合を変更する
  // 0 に近いほど raw scene、1 に近いほど blur scene へ寄る
  setBlurStrength(value) {
    this.blurStrength = util.readOptionalFiniteNumber(value, "FrostedGlassPass blurStrength", this.blurStrength, { min: 0, max: 1 });
    this.updateUniforms();
  }

  // 設定変更段階: mask RGB の tint を最終色へ混ぜる強さを変更する
  // ガラスの色味を見せたいときに上げ、純粋な背景 blur にしたいときに下げる
  setTintStrength(value) {
    this.tintStrength = util.readOptionalFiniteNumber(value, "FrostedGlassPass tintStrength", this.tintStrength, { min: 0, max: 1 });
    this.updateUniforms();
  }

  // 設定変更段階: mask alpha の効き方を指数的に調整する
  // 1 より小さいと弱い mask も効きやすく、1 より大きいと濃い mask だけが強く効く
  setMaskPower(value) {
    this.maskPower = util.readOptionalFiniteNumber(value, "FrostedGlassPass maskPower", this.maskPower, { minExclusive: 0 });
    this.updateUniforms();
  }

  // debug 取得段階: 不透明 scene を描いた render target を返す
  // unittest の scene view や後段 pass の入力確認に使う
  getSceneTarget() {
    return this.sceneTarget;
  }

  // debug 取得段階: ガラス Shape の mask を描いた render target を返す
  // unittest の mask view でガラス領域と depth test の結果を確認する
  getMaskTarget() {
    return this.maskTarget;
  }

  // debug 取得段階: 直近の render() で使った blur 出力 target を返す
  // render() 前はまだ null の場合がある
  getBlurTarget() {
    return this.blurPass?.getOutputTarget?.() ?? null;
  }

  // debug 取得段階: blur ping-pong の一時 target A を返す
  // blur の中間結果を目視したいときに使う
  getBlurTargetA() {
    return this.blurPass?.getTargetA?.() ?? null;
  }

  // debug 取得段階: blur ping-pong の一時 target B を返す
  // blur の中間結果を目視したいときに使う
  getBlurTargetB() {
    return this.blurPass?.getTargetB?.() ?? null;
  }
}
