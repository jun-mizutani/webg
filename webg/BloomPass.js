// ---------------------------------------------
//  BloomPass.js    2026/03/30
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import RenderTarget from "./RenderTarget.js";
import SeparableBlurPass from "./SeparableBlurPass.js";

export default class BloomPass {

  // scene color -> bright extract -> SeparableBlurPass -> composite をまとめる
  constructor(gpu, options = {}) {
    this.gpu = gpu;
    this.device = null;
    this.queue = null;
    this.enabled = options.enabled !== false;
    this.width = Math.max(1, Math.floor(options.width ?? 1));
    this.height = Math.max(1, Math.floor(options.height ?? 1));
    // 3D scene 本体は既存の Phong / BonePhong 系 pipeline をそのまま流用するため、
    // 既定の offscreen color format も canvas と同じ gpu.format にそろえる
    // ここを別 format にすると、scene 側 pipeline の color target format と一致せず
    // RenderPassEncoder.SetPipeline 時点で validation error になる
    this.sceneFormat = options.sceneFormat ?? gpu?.format ?? "bgra8unorm";
    this.canvasFormat = options.canvasFormat ?? gpu?.format ?? "bgra8unorm";
    this.threshold = Number.isFinite(options.threshold) ? options.threshold : 0.68;
    this.extractIntensity = Number.isFinite(options.extractIntensity) ? options.extractIntensity : 1.0;
    this.softKnee = Number.isFinite(options.softKnee) ? options.softKnee : 0.35;
    this.bloomStrength = Number.isFinite(options.bloomStrength) ? options.bloomStrength : 1.15;
    this.exposure = Number.isFinite(options.exposure) ? options.exposure : 1.0;
    this.toneMapMode = Number.isFinite(options.toneMapMode) ? options.toneMapMode : 0.0;
    this.blurRadius = Number.isFinite(options.blurRadius) ? options.blurRadius : 1.0;
    this.blurScale = Number.isFinite(options.blurScale) ? options.blurScale : 1.0;
    this.blurIterations = Number.isInteger(options.blurIterations)
      ? Math.max(1, options.blurIterations)
      : 2;
    this.sceneTarget = null;
    this.extractTarget = null;
    this.extractHeatTarget = null;
    // blur の GPU 資源と ping-pong 処理は別 helper へ分け、
    // BloomPass 自体は extract と composite の流れが読み取りやすい形に保つ
    this.blurPass = new SeparableBlurPass(gpu, {
      width: this.width,
      height: this.height,
      targetFormat: this.sceneFormat,
      labelPrefix: "BloomPass:blur",
      blurRadius: this.blurRadius,
      targetScale: this.blurScale,
      iterations: this.blurIterations
    });
    this.vertexBuffer = null;
    this.sampler = null;
    this.extractUniformBuffer = null;
    this.compositeUniformBuffer = null;
    this.extractLayout = null;
    this.compositeLayout = null;
    this.extractPipeline = null;
    this.extractHeatPipeline = null;
    this.compositePipeline = null;
    this.copyPipeline = null;
    this.ready = this.init();
  }

  async init() {
    if (this.gpu?.ready) {
      await this.gpu.ready;
    }
    this.device = this.gpu?.device ?? null;
    this.queue = this.gpu?.queue ?? null;
    if (!this.device) {
      throw new Error("BloomPass requires a ready WebGPU device");
    }

    this.createSampler();
    this.createQuad();
    this.createBuffers();
    this.createLayouts();
    this.createPipelines();
    await this.createTargets();
    this.updateExtractUniforms();
    this.updateCompositeUniforms();
    return this;
  }

  createSampler() {
    this.sampler = this.device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge"
    });
  }

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
    this.extractUniformData = new Float32Array(4);
    this.compositeUniformData = new Float32Array(4);

    this.extractUniformBuffer = this.device.createBuffer({
      size: this.extractUniformData.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.compositeUniformBuffer = this.device.createBuffer({
      size: this.compositeUniformData.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
  }

  createLayouts() {
    this.extractLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } }
      ]
    });
    this.compositeLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } }
      ]
    });
  }

  makeFullscreenModule(fragmentBody) {
    const code = `
struct VSIn {
  @location(0) position : vec2f,
  @location(1) texCoord : vec2f,
};

struct VSOut {
  @builtin(position) position : vec4f,
  @location(0) vTexCoord : vec2f,
};

@vertex
fn vsMain(input : VSIn) -> VSOut {
  var output : VSOut;
  output.position = vec4f(input.position, 0.0, 1.0);
  output.vTexCoord = input.texCoord;
  return output;
}

${fragmentBody}`;
    return this.device.createShaderModule({ code });
  }

  createPipeline(layout, module, format) {
    const pipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [layout]
    });
    return this.device.createRenderPipeline({
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
        targets: [{ format }]
      },
      primitive: {
        topology: "triangle-strip",
        cullMode: "none"
      }
    });
  }

  createPipelines() {
    const extractModule = this.makeFullscreenModule(`
struct ExtractUniforms {
  threshold : f32,
  intensity : f32,
  softKnee : f32,
  pad1 : f32,
};

@group(0) @binding(0) var<uniform> uniforms : ExtractUniforms;
@group(0) @binding(1) var uTexture : texture_2d<f32>;
@group(0) @binding(2) var uSampler : sampler;

@fragment
fn fsMain(input : VSOut) -> @location(0) vec4f {
  let color = textureSample(uTexture, uSampler, input.vTexCoord);
  let luma = dot(color.rgb, vec3f(0.2126, 0.7152, 0.0722));
  let peak = max(max(color.r, color.g), color.b);
  // luma だけだと青や赤の強い emissive がやや弱く判定されやすいため、
  // ここでは peak もはっきり混ぜて「色付きでも十分に明るい発光」を拾いやすくする
  let brightness = mix(luma, peak, 0.65);
  let knee = max(uniforms.softKnee, 0.0001);
  let kneeStart = uniforms.threshold - knee;
  let t = clamp((brightness - kneeStart) / (knee * 2.0), 0.0, 1.0);
  let soft = t * t * (3.0 - 2.0 * t) * knee;
  let hard = max(0.0, brightness - uniforms.threshold);
  let gain = max(hard, soft);
  let bloom = color.rgb * gain * uniforms.intensity;
  return vec4f(bloom, 1.0);
}`);

    const extractHeatModule = this.makeFullscreenModule(`
struct ExtractUniforms {
  threshold : f32,
  intensity : f32,
  softKnee : f32,
  pad1 : f32,
};

@group(0) @binding(0) var<uniform> uniforms : ExtractUniforms;
@group(0) @binding(1) var uTexture : texture_2d<f32>;
@group(0) @binding(2) var uSampler : sampler;

fn computeBrightness(color : vec3f) -> f32 {
  let luma = dot(color, vec3f(0.2126, 0.7152, 0.0722));
  let peak = max(max(color.r, color.g), color.b);
  return mix(luma, peak, 0.65);
}

fn computeGain(brightness : f32, threshold : f32, softKnee : f32) -> f32 {
  let knee = max(softKnee, 0.0001);
  let kneeStart = threshold - knee;
  let t = clamp((brightness - kneeStart) / (knee * 2.0), 0.0, 1.0);
  let soft = t * t * (3.0 - 2.0 * t) * knee;
  let hard = max(0.0, brightness - threshold);
  return max(hard, soft);
}

fn heatColor(level : f32) -> vec3f {
  let cold = vec3f(0.02, 0.04, 0.10);
  let mid = vec3f(0.10, 0.54, 1.0);
  let warm = vec3f(1.0, 0.62, 0.14);
  let hot = vec3f(1.0, 0.96, 0.86);
  if (level < 0.45) {
    return mix(cold, mid, level / 0.45);
  }
  if (level < 0.80) {
    return mix(mid, warm, (level - 0.45) / 0.35);
  }
  return mix(warm, hot, (level - 0.80) / 0.20);
}

@fragment
fn fsMain(input : VSOut) -> @location(0) vec4f {
  let color = textureSample(uTexture, uSampler, input.vTexCoord).rgb;
  let brightness = computeBrightness(color);
  let gain = computeGain(brightness, uniforms.threshold, uniforms.softKnee);
  let level = clamp(gain * uniforms.intensity, 0.0, 1.0);
  return vec4f(heatColor(level), 1.0);
}`);

    const compositeModule = this.makeFullscreenModule(`
struct CompositeUniforms {
  bloomStrength : f32,
  enabled : f32,
  exposure : f32,
  toneMapMode : f32,
};

@group(0) @binding(0) var<uniform> uniforms : CompositeUniforms;
@group(0) @binding(1) var sceneTexture : texture_2d<f32>;
@group(0) @binding(2) var sceneSampler : sampler;
@group(0) @binding(3) var bloomTexture : texture_2d<f32>;
@group(0) @binding(4) var bloomSampler : sampler;

fn toneMapReinhard(color : vec3f) -> vec3f {
  return color / (vec3f(1.0) + color);
}

fn toneMapAces(color : vec3f) -> vec3f {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((color * (a * color + vec3f(b))) / (color * (c * color + vec3f(d)) + vec3f(e)), vec3f(0.0), vec3f(1.0));
}

@fragment
fn fsMain(input : VSOut) -> @location(0) vec4f {
  let sceneColor = textureSample(sceneTexture, sceneSampler, input.vTexCoord);
  let bloomColor = textureSample(bloomTexture, bloomSampler, input.vTexCoord).rgb;
  if (uniforms.enabled < 0.5) {
    return sceneColor;
  }
  let combined = sceneColor.rgb + bloomColor * uniforms.bloomStrength;
  let exposed = combined * max(uniforms.exposure, 0.0);
  if (uniforms.toneMapMode < 0.5) {
    return vec4f(exposed, sceneColor.a);
  }
  if (uniforms.toneMapMode < 1.5) {
    return vec4f(toneMapReinhard(exposed), sceneColor.a);
  }
  return vec4f(toneMapAces(exposed), sceneColor.a);
}`);

    this.extractPipeline = this.createPipeline(this.extractLayout, extractModule, this.sceneFormat);
    this.extractHeatPipeline = this.createPipeline(this.extractLayout, extractHeatModule, this.sceneFormat);
    this.compositePipeline = this.createPipeline(this.compositeLayout, compositeModule, this.canvasFormat);
  }

  async createTargets() {
    this.sceneTarget = new RenderTarget(this.gpu, {
      label: "BloomPass:scene",
      width: this.width,
      height: this.height,
      format: this.sceneFormat,
      hasDepth: true
    });
    this.extractTarget = new RenderTarget(this.gpu, {
      label: "BloomPass:extract",
      width: this.width,
      height: this.height,
      format: this.sceneFormat,
      hasDepth: false
    });
    this.extractHeatTarget = new RenderTarget(this.gpu, {
      label: "BloomPass:extractHeat",
      width: this.width,
      height: this.height,
      format: this.sceneFormat,
      hasDepth: false
    });
    await Promise.all([
      this.sceneTarget.ready,
      this.extractTarget.ready,
      this.extractHeatTarget.ready,
      this.blurPass.ready
    ]);
  }

  // source として渡された object から view/sampler を解決する
  resolveTextureResources(source) {
    const view = source?.getColorView?.()
      ?? source?.getView?.()
      ?? source?.view
      ?? source?.createView?.()
      ?? null;
    const sampler = source?.getSampler?.()
      ?? source?.sampler;
    if (!view) {
      throw new Error("BloomPass requires a source texture or RenderTarget");
    }
    if (!sampler) {
      throw new Error("BloomPass requires the source to provide a sampler");
    }
    return { view, sampler };
  }

  createBindGroup(layout, entries) {
    return this.device.createBindGroup({ layout, entries });
  }

  drawQuad(passEncoder) {
    passEncoder.setVertexBuffer(0, this.vertexBuffer);
    passEncoder.draw(4, 1, 0, 0);
  }

  updateExtractUniforms() {
    this.extractUniformData[0] = this.threshold;
    this.extractUniformData[1] = this.extractIntensity;
    this.extractUniformData[2] = this.softKnee;
    this.queue.writeBuffer(this.extractUniformBuffer, 0, this.extractUniformData);
  }

  updateCompositeUniforms() {
    this.compositeUniformData[0] = this.bloomStrength;
    this.compositeUniformData[1] = this.enabled ? 1.0 : 0.0;
    this.compositeUniformData[2] = this.exposure;
    this.compositeUniformData[3] = this.toneMapMode;
    this.queue.writeBuffer(this.compositeUniformBuffer, 0, this.compositeUniformData);
  }

  setEnabled(flag) {
    this.enabled = !!flag;
    this.updateCompositeUniforms();
  }

  setThreshold(value) {
    this.threshold = Number(value);
    this.updateExtractUniforms();
  }

  setSoftKnee(value) {
    this.softKnee = Number(value);
    this.updateExtractUniforms();
  }

  setExtractIntensity(value) {
    this.extractIntensity = Number(value);
    this.updateExtractUniforms();
  }

  setBloomStrength(value) {
    this.bloomStrength = Number(value);
    this.updateCompositeUniforms();
  }

  setExposure(value) {
    this.exposure = Number(value);
    this.updateCompositeUniforms();
  }

  setToneMapMode(value) {
    this.toneMapMode = Number(value);
    this.updateCompositeUniforms();
  }

  setBlurRadius(value) {
    this.blurRadius = Number(value);
    this.blurPass?.setBlurRadius(this.blurRadius);
  }

  setBlurScale(value) {
    this.blurScale = Number(value);
    this.blurPass?.setTargetScale(this.blurScale);
  }

  setBlurIterations(value) {
    this.blurIterations = Math.floor(Number(value));
    this.blurPass?.setIterations(this.blurIterations);
  }

  resize(width, height) {
    this.width = Math.floor(Number(width));
    this.height = Math.floor(Number(height));
    this.sceneTarget?.resize(this.width, this.height);
    this.extractTarget?.resize(this.width, this.height);
    this.extractHeatTarget?.resize(this.width, this.height);
    this.blurPass?.resize(this.width, this.height);
  }

  resizeToScreen(screen) {
    this.resize(screen.getWidth(), screen.getHeight());
    return this;
  }

  getSceneTarget() {
    return this.sceneTarget;
  }

  getExtractTarget() {
    return this.extractTarget;
  }

  getExtractHeatTarget() {
    return this.extractHeatTarget;
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

  // 3D scene を offscreen color/depth target へ描く開始点
  beginScene(screen, clearColor = screen.clearColor) {
    this.resizeToScreen(screen);
    screen.beginPass({
      target: this.sceneTarget,
      clearColor,
      colorLoadOp: "clear",
      depthClear: true
    });
  }

  runExtractPass(screen, source) {
    const { view, sampler } = this.resolveTextureResources(source);
    screen.beginPass({
      target: this.extractTarget,
      clearColor: [0.0, 0.0, 0.0, 1.0],
      colorLoadOp: "clear",
      depthView: null
    });
    const pass = this.gpu.passEncoder;
    pass.setPipeline(this.extractPipeline);
    pass.setBindGroup(0, this.createBindGroup(this.extractLayout, [
      { binding: 0, resource: { buffer: this.extractUniformBuffer } },
      { binding: 1, resource: view },
      { binding: 2, resource: sampler }
    ]));
    this.drawQuad(pass);
  }

  runExtractHeatPass(screen, source) {
    const { view, sampler } = this.resolveTextureResources(source);
    screen.beginPass({
      target: this.extractHeatTarget,
      clearColor: [0.0, 0.0, 0.0, 1.0],
      colorLoadOp: "clear",
      depthView: null
    });
    const pass = this.gpu.passEncoder;
    pass.setPipeline(this.extractHeatPipeline);
    pass.setBindGroup(0, this.createBindGroup(this.extractLayout, [
      { binding: 0, resource: { buffer: this.extractUniformBuffer } },
      { binding: 1, resource: view },
      { binding: 2, resource: sampler }
    ]));
    this.drawQuad(pass);
  }

  runCompositePass(screen, sceneSource, bloomSource, destination = null, clearColor = [0.0, 0.0, 0.0, 1.0]) {
    const sceneTex = this.resolveTextureResources(sceneSource);
    const bloomTex = this.resolveTextureResources(bloomSource);
    screen.beginPass({
      target: destination,
      clearColor,
      colorLoadOp: "clear",
      depthView: null
    });
    const pass = this.gpu.passEncoder;
    pass.setPipeline(this.compositePipeline);
    pass.setBindGroup(0, this.createBindGroup(this.compositeLayout, [
      { binding: 0, resource: { buffer: this.compositeUniformBuffer } },
      { binding: 1, resource: sceneTex.view },
      { binding: 2, resource: sceneTex.sampler },
      { binding: 3, resource: bloomTex.view },
      { binding: 4, resource: bloomTex.sampler }
    ]));
    this.drawQuad(pass);
  }

  // scene target を入力として bloom を実行し、最後に canvas または destination へ戻す
  render(screen, options = {}) {
    const source = options.source;
    const destination = options.destination;
    const clearColor = options.clearColor;

    if (!this.enabled) {
      this.runCompositePass(screen, source, source, destination, clearColor);
      return;
    }

    this.runExtractPass(screen, source);
    this.runExtractHeatPass(screen, source);
    // blur の横 / 縦 2 pass と target 入れ替えは helper 側へ委譲する
    const blurTarget = this.blurPass.render(screen, this.extractTarget, {
      iterations: this.blurIterations,
      blurRadius: this.blurRadius
    });
    this.runCompositePass(screen, source, blurTarget, destination, clearColor);
  }
}
