// ---------------------------------------------
//  DofPass.js      2026/04/21
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import RenderTarget from "./RenderTarget.js";
import SeparableBlurPass from "./SeparableBlurPass.js";
import util from "./util.js";

export default class DofPass {
  // scene color + sampled depth から、focus 面だけ sharp に残して
  // それ以外を blur 側へ寄せる最小の被写界深度 pass
  // 利用側は beginScene() で sceneTarget へ 3D scene を描いたあと、
  // render() で depth debug / focus debug / 最終 composite を順に実行する
  constructor(gpu, options = {}) {
    this.gpu = gpu;
    this.device = null;
    this.queue = null;
    this.enabled = options.enabled !== false;
    this.width = util.readOptionalInteger(options.width, "DofPass width", 1, { min: 1 });
    this.height = util.readOptionalInteger(options.height, "DofPass height", 1, { min: 1 });
    this.sceneFormat = options.sceneFormat ?? gpu?.format ?? "bgra8unorm";
    this.canvasFormat = options.canvasFormat ?? gpu?.format ?? "bgra8unorm";
    this.focusDistance = util.readOptionalFiniteNumber(options.focusDistance, "DofPass focusDistance", 34.0, { min: 0 });
    this.focusRange = util.readOptionalFiniteNumber(options.focusRange, "DofPass focusRange", 6.0, { minExclusive: 0 });
    this.maxBlurMix = util.readOptionalFiniteNumber(options.maxBlurMix, "DofPass maxBlurMix", 1.0, { min: 0, max: 1 });
    this.sharpnessWidth = util.readOptionalFiniteNumber(options.sharpnessWidth, "DofPass sharpnessWidth", 0.2, { minExclusive: 0 });
    this.sharpnessPower = util.readOptionalFiniteNumber(options.sharpnessPower, "DofPass sharpnessPower", 8.0, { minExclusive: 0 });
    this.projectionNear = util.readOptionalFiniteNumber(options.projectionNear, "DofPass projectionNear", 0.1, { minExclusive: 0 });
    this.projectionFar = util.readOptionalFiniteNumber(options.projectionFar, "DofPass projectionFar", 1000.0, { minExclusive: 0 });
    if (this.projectionFar <= this.projectionNear) {
      throw new Error("DofPass projectionFar must be greater than projectionNear");
    }
    this.blurRadius = util.readOptionalFiniteNumber(options.blurRadius, "DofPass blurRadius", 2.4, { min: 0 });
    this.blurIterations = util.readOptionalInteger(options.blurIterations, "DofPass blurIterations", 2, { min: 1 });
    this.blurScale = util.readOptionalFiniteNumber(options.blurScale, "DofPass blurScale", 0.5, { minExclusive: 0 });
    this.sceneTarget = null;
    this.depthDebugTarget = null;
    this.focusDebugTarget = null;
    this.blurPass = new SeparableBlurPass(gpu, {
      width: this.width,
      height: this.height,
      targetFormat: this.sceneFormat,
      labelPrefix: "DofPass:blur",
      blurRadius: this.blurRadius,
      targetScale: this.blurScale,
      iterations: this.blurIterations
    });
    this.vertexBuffer = null;
    this.sampler = null;
    this.uniformData = null;
    this.uniformBuffer = null;
    this.layout = null;
    this.pipeline = null;
    this.depthDebugLayout = null;
    this.depthDebugPipeline = null;
    this.focusDebugLayout = null;
    this.focusDebugPipeline = null;
    this.ready = this.init();
  }

  // WebGPU resource 一式をまとめて立ち上げる
  // scene を描く RenderTarget、blur 用 pass、fullscreen quad、
  // DOF 合成 pipeline の順に準備しておく
  async init() {
    if (this.gpu?.ready) {
      await this.gpu.ready;
    }
    this.device = this.gpu?.device ?? null;
    this.queue = this.gpu?.queue ?? null;
    if (!this.device) {
      throw new Error("DofPass requires a ready WebGPU device");
    }

    this.createSampler();
    this.createQuad();
    this.createBuffers();
    this.createLayout();
    await this.createPipeline();
    await this.createDebugPipelines();
    await this.createTargets();
    this.updateUniforms();
    return this;
  }

  async logShaderCompilationInfo(module, label) {
    if (typeof module?.getCompilationInfo !== "function") {
      return null;
    }
    const info = await module.getCompilationInfo();
    const messages = Array.isArray(info?.messages) ? info.messages : [];
    for (const message of messages) {
      const type = String(message?.type ?? message?.messageType ?? "info");
      const lineNum = Number.isFinite(message?.lineNum) ? message.lineNum : null;
      const linePos = Number.isFinite(message?.linePos) ? message.linePos : null;
      const text = String(message?.message ?? message?.text ?? "").trim();
      const location = lineNum === null
        ? ""
        : `:${lineNum}${linePos !== null ? `:${linePos}` : ""}`;
      const prefix = `${label}${location} ${type}`;
      if (type === "error") {
        console.error(prefix, text);
      } else {
        console.warn(prefix, text);
      }
    }
    return info;
  }

  async createWithValidation(label, createFn) {
    if (typeof this.device?.pushErrorScope === "function" && typeof this.device?.popErrorScope === "function") {
      this.device.pushErrorScope("validation");
      const result = createFn();
      const error = await this.device.popErrorScope();
      if (error) {
        console.error(`${label} validation error:`, error);
      }
      return result;
    }
    return createFn();
  }

  // scene / blur の両方を線形補間で読むので linear sampler を共有する
  createSampler() {
    this.sampler = this.device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge"
    });
  }

  // fullscreen quad を triangle-strip 4 頂点で用意する
  // 頂点は position.xy + texCoord.xy の並びで、後段の全 pass が同じ形を使う
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

  createBuffers() {
    // Uniform は JS / WGSL 両方で同じ並びを使う
    // 0: focusDistance   1: focusRange   2: maxBlurMix    3: enabled
    // 4: near            5: far          6: width         7: height
    // 8: sharpnessWidth  9: sharpnessPower
    this.uniformData = new Float32Array(10);
    this.uniformBuffer = this.device.createBuffer({
      size: this.uniformData.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
  }

  // 合成 pass は 3 種類の入力を受ける
  // 1. 元 scene color
  // 2. blur 済み color
  // 3. sceneTarget が持つ sampleable depth
  createLayout() {
    this.layout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "depth" } }
      ]
    });
  }

  // depth debug / focus debug は depth だけ読めればよいので、
  // 合成 pass より小さい bind group layout を共通化する
  createDebugTextureLayout() {
    return this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "depth" } }
      ]
    });
  }

  async createPipeline() {
    const module = this.device.createShaderModule({
      code: `
struct Uniforms {
  focusDistance : f32,
  focusRange : f32,
  maxBlurMix : f32,
  enabled : f32,
  near : f32,
  far : f32,
  width : f32,
  height : f32,
  sharpnessWidth : f32,
  sharpnessPower : f32,
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
@group(0) @binding(5) var depthTexture : texture_depth_2d;

@vertex
fn vsMain(input : VSIn) -> VSOut {
  var output : VSOut;
  output.position = vec4f(input.position, 0.0, 1.0);
  output.vTexCoord = input.texCoord;
  return output;
}

fn linearizeDepth(depth : f32, near : f32, far : f32) -> f32 {
  // depth buffer の非線形値を view 空間距離へ戻す
  // focusDistance はこの線形化後の距離と比較する
  let denom = max(far + depth * (near - far), 0.0001);
  return (near * far) / denom;
}

fn getDepth(uv : vec2f) -> f32 {
  // texture_depth_2d は sample ではなく load で読む
  // UV が右端ぴったりになると範囲外になりうるので少し clamp しておく
  let clamped = clamp(uv, vec2f(0.0), vec2f(0.999999));
  let dims = textureDimensions(depthTexture);
  let pixel = min(vec2u(clamped * vec2f(dims)), dims - vec2u(1u, 1u));
  return textureLoad(depthTexture, vec2i(pixel), 0);
}

fn dofSharpness(x : f32, center : f32, width : f32, power : f32) -> f32 {
  // 焦点からの距離が center に近いほど 1.0 に寄り、
  // 離れるほど指数的に落ちる sharpness カーブを作る
  let numerator = abs(x - center);
  let normalizedDistance = numerator / max(width, 0.0001);
  return exp(-pow(normalizedDistance, power));
}

@fragment
fn fsMain(input : VSOut) -> @location(0) vec4f {
  let sceneColor = textureSample(sceneTexture, sceneSampler, input.vTexCoord);
  if (uniforms.enabled < 0.5) {
    // DOF 無効時は scene をそのまま返し、呼び出し側の処理フローを変えずに済ませる
    return sceneColor;
  }
  let blurColor = textureSample(blurTexture, blurSampler, input.vTexCoord);
  let depth = getDepth(input.vTexCoord);
  let linearDepth = linearizeDepth(depth, uniforms.near, uniforms.far);
  let focusDelta = abs(linearDepth - uniforms.focusDistance);
  let focusRange = max(uniforms.focusRange, 0.0001);
  let t = clamp(focusDelta / focusRange, 0.0, 1.0);
  let focusWeight = dofSharpness(t, 0.0, uniforms.sharpnessWidth, uniforms.sharpnessPower);
  let blurMix = (1.0 - focusWeight) * clamp(uniforms.maxBlurMix, 0.0, 1.0);
  let color = mix(sceneColor.rgb, blurColor.rgb, blurMix);
  return vec4f(color, sceneColor.a);
}`
    });
    const pipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [this.layout]
    });
    await this.logShaderCompilationInfo(module, "DofPass composite");
    this.pipeline = await this.createWithValidation("DofPass composite pipeline", () => this.device.createRenderPipeline({
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
    }));
  }

  // debug 用に 2 種類の表示を持つ
  // depthDebug: 線形 depth を白黒で確認
  // focusDebug: 近景 / 合焦面 / 遠景を色分けして focus 設定を確認
  async createDebugPipelines() {
    this.depthDebugLayout = this.createDebugTextureLayout();
    this.focusDebugLayout = this.createDebugTextureLayout();

    const depthModule = this.device.createShaderModule({
      code: `
struct Uniforms {
  focusDistance : f32,
  focusRange : f32,
  maxBlurMix : f32,
  enabled : f32,
  near : f32,
  far : f32,
  width : f32,
  height : f32,
  sharpnessWidth : f32,
  sharpnessPower : f32,
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
@group(0) @binding(1) var depthTexture : texture_depth_2d;

@vertex
fn vsMain(input : VSIn) -> VSOut {
  var output : VSOut;
  output.position = vec4f(input.position, 0.0, 1.0);
  output.vTexCoord = input.texCoord;
  return output;
}

fn linearizeDepth(depth : f32, near : f32, far : f32) -> f32 {
  // debug でも本番と同じ線形化式を使い、
  // 「見えている階調」と「DOF 判定」がずれないようにする
  let denom = max(far + depth * (near - far), 0.0001);
  return (near * far) / denom;
}

fn getDepth(uv : vec2f) -> f32 {
  let clamped = clamp(uv, vec2f(0.0), vec2f(0.999999));
  let dims = textureDimensions(depthTexture);
  let pixel = min(vec2u(clamped * vec2f(dims)), dims - vec2u(1u, 1u));
  return textureLoad(depthTexture, vec2i(pixel), 0);
}

@fragment
fn fsMain(input : VSOut) -> @location(0) vec4f {
  // 0.0 付近が near、1.0 に近いほど far と読める白黒出力
  let linearDepth = linearizeDepth(getDepth(input.vTexCoord), uniforms.near, uniforms.far);
  let normalized = clamp(linearDepth / max(uniforms.far, 0.0001), 0.0, 1.0);
  return vec4f(vec3f(normalized), 1.0);
}`
    });

    const focusModule = this.device.createShaderModule({
      code: `
struct Uniforms {
  focusDistance : f32,
  focusRange : f32,
  maxBlurMix : f32,
  enabled : f32,
  near : f32,
  far : f32,
  width : f32,
  height : f32,
  sharpnessWidth : f32,
  sharpnessPower : f32,
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
@group(0) @binding(1) var depthTexture : texture_depth_2d;

@vertex
fn vsMain(input : VSIn) -> VSOut {
  var output : VSOut;
  output.position = vec4f(input.position, 0.0, 1.0);
  output.vTexCoord = input.texCoord;
  return output;
}

fn linearizeDepth(depth : f32, near : f32, far : f32) -> f32 {
  let denom = max(far + depth * (near - far), 0.0001);
  return (near * far) / denom;
}

fn getDepth(uv : vec2f) -> f32 {
  let clamped = clamp(uv, vec2f(0.0), vec2f(0.999999));
  let dims = textureDimensions(depthTexture);
  let pixel = min(vec2u(clamped * vec2f(dims)), dims - vec2u(1u, 1u));
  return textureLoad(depthTexture, vec2i(pixel), 0);
}

fn dofSharpness(x : f32, center : f32, width : f32, power : f32) -> f32 {
  let numerator = abs(x - center);
  let normalizedDistance = numerator / max(width, 0.0001);
  return exp(-pow(normalizedDistance, power));
}

@fragment
fn fsMain(input : VSOut) -> @location(0) vec4f {
  // focusDistance より手前は warm、奥は cool に寄せ、
  // 合焦している帯だけ明るく残して focus 面の位置を見やすくする
  let linearDepth = linearizeDepth(getDepth(input.vTexCoord), uniforms.near, uniforms.far);
  let signedDelta = linearDepth - uniforms.focusDistance;
  let focusDelta = abs(signedDelta);
  let focusRange = max(uniforms.focusRange, 0.0001);
  let t = clamp(focusDelta / focusRange, 0.0, 1.0);
  let mask = dofSharpness(t, 0.0, uniforms.sharpnessWidth, uniforms.sharpnessPower);
  let nearColor = vec3f(1.0, 0.34, 0.24);
  let focusColor = vec3f(0.96, 0.98, 0.82);
  let farColor = vec3f(0.30, 0.72, 1.0);
  if (signedDelta < 0.0) {
    return vec4f(mix(nearColor, focusColor, mask), 1.0);
  }
  return vec4f(mix(farColor, focusColor, mask), 1.0);
}`
    });

    await this.logShaderCompilationInfo(depthModule, "DofPass depthDebug");
    const depthLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [this.depthDebugLayout]
    });
    this.depthDebugPipeline = await this.createWithValidation("DofPass depthDebug pipeline", () => this.device.createRenderPipeline({
      layout: depthLayout,
      vertex: {
        module: depthModule,
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
        module: depthModule,
        entryPoint: "fsMain",
        targets: [{ format: this.sceneFormat }]
      },
      primitive: {
        topology: "triangle-strip",
        cullMode: "none"
      }
    }));

    await this.logShaderCompilationInfo(focusModule, "DofPass focusDebug");
    const focusLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [this.focusDebugLayout]
    });
    this.focusDebugPipeline = await this.createWithValidation("DofPass focusDebug pipeline", () => this.device.createRenderPipeline({
      layout: focusLayout,
      vertex: {
        module: focusModule,
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
        module: focusModule,
        entryPoint: "fsMain",
        targets: [{ format: this.sceneFormat }]
      },
      primitive: {
        topology: "triangle-strip",
        cullMode: "none"
      }
    }));
  }

  // sceneTarget は color + depth を持つ本番入力
  // depthDebugTarget / focusDebugTarget は CPU 取得ではなく画面確認用の color target
  async createTargets() {
    this.sceneTarget = new RenderTarget(this.gpu, {
      label: "DofPass:scene",
      width: this.width,
      height: this.height,
      format: this.sceneFormat,
      hasDepth: true,
      sampleDepth: true
    });
    this.depthDebugTarget = new RenderTarget(this.gpu, {
      label: "DofPass:depthDebug",
      width: this.width,
      height: this.height,
      format: this.sceneFormat,
      hasDepth: false
    });
    this.focusDebugTarget = new RenderTarget(this.gpu, {
      label: "DofPass:focusDebug",
      width: this.width,
      height: this.height,
      format: this.sceneFormat,
      hasDepth: false
    });
    await Promise.all([
      this.sceneTarget.ready,
      this.depthDebugTarget.ready,
      this.focusDebugTarget.ready,
      this.blurPass.ready
    ]);
  }

  // JS 側の setter で触る値を uniform buffer へ集約して流す
  // projectionNear / projectionFar は depth 線形化で使うので、
  // camera 側の投影設定と合わせて更新する必要がある
  updateUniforms() {
    this.uniformData[0] = this.focusDistance;
    this.uniformData[1] = this.focusRange;
    this.uniformData[2] = this.maxBlurMix;
    this.uniformData[3] = this.enabled ? 1.0 : 0.0;
    this.uniformData[4] = this.projectionNear;
    this.uniformData[5] = this.projectionFar;
    this.uniformData[6] = this.width;
    this.uniformData[7] = this.height;
    this.uniformData[8] = this.sharpnessWidth;
    this.uniformData[9] = this.sharpnessPower;
    this.queue.writeBuffer(this.uniformBuffer, 0, this.uniformData);
  }

  // scene color、blur color、sampleable depth を 1 つの bind group に束ねる
  // depth は sceneTarget 自身から読むので、第三引数も通常は sceneTarget を渡す
  createBindGroup(sceneSource, blurSource, depthSource) {
    const sceneView = sceneSource?.getColorView?.() ?? sceneSource?.getView?.() ?? sceneSource?.view ?? null;
    const sceneSampler = sceneSource?.getSampler?.() ?? sceneSource?.sampler;
    const blurView = blurSource?.getColorView?.() ?? blurSource?.getView?.() ?? blurSource?.view ?? null;
    const blurSampler = blurSource?.getSampler?.() ?? blurSource?.sampler;
    const depthView = depthSource?.getDepthSampleView?.() ?? depthSource?.depthSampleView ?? null;
    if (!sceneView || !blurView || !depthView) {
      throw new Error("DofPass requires scene color, blur color and sampleable depth");
    }
    if (!sceneSampler || !blurSampler) {
      throw new Error("DofPass requires scene color and blur color to provide samplers");
    }
    return this.device.createBindGroup({
      layout: this.layout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: sceneView },
        { binding: 2, resource: sceneSampler },
        { binding: 3, resource: blurView },
        { binding: 4, resource: blurSampler },
        { binding: 5, resource: depthView }
      ]
    });
  }

  // depth debug / focus debug は depth だけ読むので専用 bind group を使う
  createDepthDebugBindGroup(depthSource) {
    const depthView = depthSource?.getDepthSampleView?.() ?? depthSource?.depthSampleView ?? null;
    if (!depthView) {
      throw new Error("DofPass requires sampleable depth for debug view");
    }
    return this.device.createBindGroup({
      layout: this.depthDebugLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: depthView }
      ]
    });
  }

  // pipeline は外で選んでおき、ここでは quad 描画だけに絞る
  drawQuad(passEncoder) {
    passEncoder.setVertexBuffer(0, this.vertexBuffer);
    passEncoder.draw(4, 1, 0, 0);
  }

  setEnabled(flag) {
    if (typeof flag !== "boolean") {
      throw new Error("DofPass enabled must be boolean");
    }
    this.enabled = !!flag;
    this.updateUniforms();
  }

  setFocusDistance(value) {
    this.focusDistance = util.readOptionalFiniteNumber(value, "DofPass focusDistance", this.focusDistance, { min: 0 });
    this.updateUniforms();
  }

  setFocusRange(value) {
    this.focusRange = util.readOptionalFiniteNumber(value, "DofPass focusRange", this.focusRange, { minExclusive: 0 });
    this.updateUniforms();
  }

  setMaxBlurMix(value) {
    this.maxBlurMix = util.readOptionalFiniteNumber(value, "DofPass maxBlurMix", this.maxBlurMix, { min: 0, max: 1 });
    this.updateUniforms();
  }

  setSharpnessWidth(value) {
    this.sharpnessWidth = util.readOptionalFiniteNumber(value, "DofPass sharpnessWidth", this.sharpnessWidth, { minExclusive: 0 });
    this.updateUniforms();
  }

  setSharpnessPower(value) {
    this.sharpnessPower = util.readOptionalFiniteNumber(value, "DofPass sharpnessPower", this.sharpnessPower, { minExclusive: 0 });
    this.updateUniforms();
  }

  setProjectionRange(near, far) {
    this.projectionNear = util.readOptionalFiniteNumber(near, "DofPass projectionNear", this.projectionNear, { minExclusive: 0 });
    this.projectionFar = util.readOptionalFiniteNumber(far, "DofPass projectionFar", this.projectionFar, { minExclusive: 0 });
    if (this.projectionFar <= this.projectionNear) {
      throw new Error("DofPass projectionFar must be greater than projectionNear");
    }
    this.updateUniforms();
  }

  setBlurRadius(value) {
    this.blurRadius = util.readOptionalFiniteNumber(value, "DofPass blurRadius", this.blurRadius, { min: 0 });
    this.blurPass?.setBlurRadius(this.blurRadius);
  }

  setBlurIterations(value) {
    this.blurIterations = util.readOptionalInteger(value, "DofPass blurIterations", this.blurIterations, { min: 1 });
    this.blurPass?.setIterations(this.blurIterations);
  }

  setBlurScale(value) {
    this.blurScale = util.readOptionalFiniteNumber(value, "DofPass blurScale", this.blurScale, { minExclusive: 0 });
    this.blurPass?.setTargetScale(this.blurScale);
  }

  resize(width, height) {
    this.width = util.readOptionalInteger(width, "DofPass width", this.width, { min: 1 });
    this.height = util.readOptionalInteger(height, "DofPass height", this.height, { min: 1 });
    this.sceneTarget?.resize(this.width, this.height);
    this.depthDebugTarget?.resize(this.width, this.height);
    this.focusDebugTarget?.resize(this.width, this.height);
    this.blurPass?.resize(this.width, this.height);
    this.updateUniforms();
  }

  resizeToScreen(screen) {
    this.resize(screen.getWidth(), screen.getHeight());
    return this;
  }

  getSceneTarget() {
    return this.sceneTarget;
  }

  getBlurTargetA() {
    return this.blurPass?.getTargetA?.() ?? null;
  }

  getBlurTargetB() {
    return this.blurPass?.getTargetB?.() ?? null;
  }

  getBlurScale() {
    return this.blurScale;
  }

  getDepthDebugTarget() {
    return this.depthDebugTarget;
  }

  getFocusDebugTarget() {
    return this.focusDebugTarget;
  }

  // 利用側はこの pass で scene 全体を一度 offscreen へ描く
  // sampleDepth: true の RenderTarget に描くことで、
  // あとから WGSL が depthTexture として depth を読み返せる
  beginScene(screen, clearColor = screen.clearColor) {
    this.resizeToScreen(screen);
    screen.beginPass({
      target: this.sceneTarget,
      clearColor,
      colorLoadOp: "clear",
      depthClear: true
    });
  }

  // 本番の DOF 合成
  // 1. sceneTarget から blur 用 texture を作る
  // 2. destination へ新しい pass を開く
  // 3. scene + blur + depth を読んで最終 color を書く
  runCompositePass(screen, destination = null, clearColor = [0.0, 0.0, 0.0, 1.0]) {
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
    pass.setBindGroup(0, this.createBindGroup(this.sceneTarget, blurTarget, this.sceneTarget));
    this.drawQuad(pass);
  }

  // depth の見え方を白黒で確認する pass
  // projection range が合っていない時はここで違和感が見つけやすい
  runDepthDebugPass(screen) {
    screen.beginPass({
      target: this.depthDebugTarget,
      clearColor: [0.0, 0.0, 0.0, 1.0],
      colorLoadOp: "clear",
      depthView: null
    });
    const pass = this.gpu.passEncoder;
    pass.setPipeline(this.depthDebugPipeline);
    pass.setBindGroup(0, this.createDepthDebugBindGroup(this.sceneTarget));
    this.drawQuad(pass);
  }

  // focusDistance / focusRange が scene のどこに掛かっているかを色分けして確認する pass
  runFocusDebugPass(screen) {
    screen.beginPass({
      target: this.focusDebugTarget,
      clearColor: [0.0, 0.0, 0.0, 1.0],
      colorLoadOp: "clear",
      depthView: null
    });
    const pass = this.gpu.passEncoder;
    pass.setPipeline(this.focusDebugPipeline);
    pass.setBindGroup(0, this.createDepthDebugBindGroup(this.sceneTarget));
    this.drawQuad(pass);
  }

  // render() は DofPass 全体の出力フローをまとめた入口
  // debug target 2 枚を先に更新しておくことで、
  // 利用側は render() 後にそれらをそのまま UI へ表示できる
  render(screen, options = {}) {
    const destination = options.destination;
    const clearColor = options.clearColor;
    this.runDepthDebugPass(screen);
    this.runFocusDebugPass(screen);
    this.runCompositePass(screen, destination, clearColor);
  }
}
