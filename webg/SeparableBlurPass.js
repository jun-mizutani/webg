// ---------------------------------------------
//  SeparableBlurPass.js  2026/03/30
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import RenderTarget from "./RenderTarget.js";
import util from "./util.js";

export default class SeparableBlurPass {

  // 1 枚の source texture に対して、横 blur -> 縦 blur を ping-pong で繰り返す
  // postprocess の共通部品として分離し、BloomPass や将来の被写界深度から
  // 同じ blur 実装を再利用できるようにする
  constructor(gpu, options = {}) {
    this.gpu = gpu;
    this.device = null;
    this.queue = null;
    this.width = util.readOptionalInteger(options.width, "SeparableBlurPass width", 1, { min: 1 });
    this.height = util.readOptionalInteger(options.height, "SeparableBlurPass height", 1, { min: 1 });
    this.targetFormat = options.targetFormat ?? gpu?.format ?? "bgra8unorm";
    this.labelPrefix = options.labelPrefix ?? "SeparableBlurPass";
    this.blurRadius = util.readOptionalFiniteNumber(options.blurRadius, "SeparableBlurPass blurRadius", 1.0, { min: 0 });
    this.targetScale = util.readOptionalFiniteNumber(options.targetScale, "SeparableBlurPass targetScale", 1.0, { minExclusive: 0 });
    this.iterations = util.readOptionalInteger(options.iterations, "SeparableBlurPass iterations", 2, { min: 1 });
    this.targetA = null;
    this.targetB = null;
    this.vertexBuffer = null;
    this.sampler = null;
    this.uniformBufferH = null;
    this.uniformBufferV = null;
    this.bindGroupLayout = null;
    this.pipeline = null;
    this.uniformDataH = null;
    this.uniformDataV = null;
    this.lastOutputTarget = null;
    this.ready = this.init();
  }

  async init() {
    if (this.gpu?.ready) {
      await this.gpu.ready;
    }
    this.device = this.gpu?.device ?? null;
    this.queue = this.gpu?.queue ?? null;
    if (!this.device) {
      throw new Error("SeparableBlurPass requires a ready WebGPU device");
    }

    this.createSampler();
    this.createQuad();
    this.createBuffers();
    this.createLayout();
    this.createPipeline();
    await this.createTargets();
    this.updateUniforms();
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
    this.uniformDataH = new Float32Array(4);
    this.uniformDataV = new Float32Array(4);
    this.uniformBufferH = this.device.createBuffer({
      size: this.uniformDataH.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.uniformBufferV = this.device.createBuffer({
      size: this.uniformDataV.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
  }

  createLayout() {
    this.bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } }
      ]
    });
  }

  createPipeline() {
    const module = this.device.createShaderModule({
      code: `
struct BlurUniforms {
  direction : vec2f,
  texel : vec2f,
};

@group(0) @binding(0) var<uniform> uniforms : BlurUniforms;
@group(0) @binding(1) var uTexture : texture_2d<f32>;
@group(0) @binding(2) var uSampler : sampler;

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

fn sampleOffset(uv : vec2f, offset : f32) -> vec3f {
  let d = uniforms.direction * uniforms.texel * offset;
  return textureSample(uTexture, uSampler, uv + d).rgb;
}

@fragment
fn fsMain(input : VSOut) -> @location(0) vec4f {
  var color = sampleOffset(input.vTexCoord, 0.0) * 0.227027;
  color += sampleOffset(input.vTexCoord, 1.384615) * 0.316216;
  color += sampleOffset(input.vTexCoord, -1.384615) * 0.316216;
  color += sampleOffset(input.vTexCoord, 3.230769) * 0.070270;
  color += sampleOffset(input.vTexCoord, -3.230769) * 0.070270;
  return vec4f(color, 1.0);
}`
    });
    const pipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [this.bindGroupLayout]
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
        targets: [{ format: this.targetFormat }]
      },
      primitive: {
        topology: "triangle-strip",
        cullMode: "none"
      }
    });
  }

  async createTargets() {
    const targetWidth = this.getScaledWidth();
    const targetHeight = this.getScaledHeight();
    this.targetA = new RenderTarget(this.gpu, {
      label: `${this.labelPrefix}A`,
      width: targetWidth,
      height: targetHeight,
      format: this.targetFormat,
      hasDepth: false
    });
    this.targetB = new RenderTarget(this.gpu, {
      label: `${this.labelPrefix}B`,
      width: targetWidth,
      height: targetHeight,
      format: this.targetFormat,
      hasDepth: false
    });
    await Promise.all([
      this.targetA.ready,
      this.targetB.ready
    ]);
  }

  resolveTextureResources(source) {
    const view = source?.getColorView?.()
      ?? source?.getView?.()
      ?? source?.view
      ?? source?.createView?.()
      ?? null;
    const sampler = source?.getSampler?.()
      ?? source?.sampler;
    if (!view) {
      throw new Error("SeparableBlurPass requires a source texture or RenderTarget");
    }
    if (!sampler) {
      throw new Error("SeparableBlurPass requires the source to provide a sampler");
    }
    return { view, sampler };
  }

  createBindGroup(entries) {
    return this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries
    });
  }

  drawQuad(passEncoder) {
    passEncoder.setVertexBuffer(0, this.vertexBuffer);
    passEncoder.draw(4, 1, 0, 0);
  }

  updateUniforms() {
    const texelX = (1.0 / this.getScaledWidth()) * this.blurRadius;
    const texelY = (1.0 / this.getScaledHeight()) * this.blurRadius;

    this.uniformDataH[0] = 1.0;
    this.uniformDataH[1] = 0.0;
    this.uniformDataH[2] = texelX;
    this.uniformDataH[3] = texelY;
    this.queue.writeBuffer(this.uniformBufferH, 0, this.uniformDataH);

    this.uniformDataV[0] = 0.0;
    this.uniformDataV[1] = 1.0;
    this.uniformDataV[2] = texelX;
    this.uniformDataV[3] = texelY;
    this.queue.writeBuffer(this.uniformBufferV, 0, this.uniformDataV);
  }

  setBlurRadius(value) {
    this.blurRadius = util.readOptionalFiniteNumber(value, "SeparableBlurPass blurRadius", this.blurRadius, { min: 0 });
    if (this.queue) {
      this.updateUniforms();
    }
  }

  setIterations(value) {
    this.iterations = util.readOptionalInteger(value, "SeparableBlurPass iterations", this.iterations, { min: 1 });
  }

  setTargetScale(value) {
    const nextScale = util.readOptionalFiniteNumber(value, "SeparableBlurPass targetScale", this.targetScale, { minExclusive: 0 });
    if (Math.abs(nextScale - this.targetScale) < 0.0001) {
      return;
    }
    this.targetScale = nextScale;
    this.targetA?.resize(this.getScaledWidth(), this.getScaledHeight());
    this.targetB?.resize(this.getScaledWidth(), this.getScaledHeight());
    if (this.queue) {
      this.updateUniforms();
    }
  }

  resize(width, height) {
    this.width = util.readOptionalInteger(width, "SeparableBlurPass width", this.width, { min: 1 });
    this.height = util.readOptionalInteger(height, "SeparableBlurPass height", this.height, { min: 1 });
    this.targetA?.resize(this.getScaledWidth(), this.getScaledHeight());
    this.targetB?.resize(this.getScaledWidth(), this.getScaledHeight());
    if (this.queue) {
      this.updateUniforms();
    }
  }

  resizeToScreen(screen) {
    this.resize(screen.getWidth(), screen.getHeight());
    return this;
  }

  getTargetA() {
    return this.targetA;
  }

  getTargetB() {
    return this.targetB;
  }

  getOutputTarget() {
    return this.lastOutputTarget;
  }

  getTargetScale() {
    return this.targetScale;
  }

  getScaledWidth() {
    return Math.floor(this.width * this.targetScale);
  }

  getScaledHeight() {
    return Math.floor(this.height * this.targetScale);
  }

  runPass(screen, source, target, uniformBuffer) {
    const { view, sampler } = this.resolveTextureResources(source);
    screen.beginPass({
      target,
      clearColor: [0.0, 0.0, 0.0, 1.0],
      colorLoadOp: "clear",
      depthView: null
    });
    const pass = this.gpu.passEncoder;
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.createBindGroup([
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: view },
      { binding: 2, resource: sampler }
    ]));
    this.drawQuad(pass);
  }

  // source texture を受け取り、横 blur / 縦 blur を iterations 回繰り返して
  // 最終的な出力先 RenderTarget を返す
  render(screen, source, options = {}) {
    const iterations = util.hasOwn(options, "iterations")
      ? util.readOptionalInteger(options.iterations, "SeparableBlurPass iterations", this.iterations, { min: 1 })
      : this.iterations;
    if (util.hasOwn(options, "blurRadius")) {
      util.readOptionalFiniteNumber(options.blurRadius, "SeparableBlurPass blurRadius", this.blurRadius, { min: 0 });
      this.setBlurRadius(options.blurRadius);
    } else {
      this.updateUniforms();
    }

    let readTarget = source;
    let writeTarget = this.targetA;
    for (let i = 0; i < iterations; i++) {
      this.runPass(screen, readTarget, writeTarget, this.uniformBufferH);
      readTarget = writeTarget;
      writeTarget = writeTarget === this.targetA ? this.targetB : this.targetA;
      this.runPass(screen, readTarget, writeTarget, this.uniformBufferV);
      readTarget = writeTarget;
      writeTarget = writeTarget === this.targetA ? this.targetB : this.targetA;
    }
    this.lastOutputTarget = readTarget;
    return this.lastOutputTarget;
  }
}
