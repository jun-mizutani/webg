// ---------------------------------------------
//  FullscreenPass.js  2026/03/09
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import Shader from "./Shader.js";

export default class FullscreenPass extends Shader {

  // fullscreen quad で 1 枚の texture を現在 pass へ描く
  constructor(gpu, options = {}) {
    super(gpu);
    this.targetFormat = options.targetFormat ?? gpu?.format ?? "bgra8unorm";
    this.blendMode = options.blendMode ?? "replace";
    this.texture = null;
    this.vertexBuffer = null;
    this.bindGroupLayout = null;
    this.bindGroupCache = new WeakMap();

    // colorScale(vec4) + uvScale(vec2) + uvOffset(vec2)
    // を uniform へまとめ、copy だけでなく後段の合成 pass へも流用しやすくする
    this.uniformData = new Float32Array(8);
    this.OFF_COLOR_SCALE = 0;
    this.OFF_UV_SCALE = 4;
    this.OFF_UV_OFFSET = 6;
    this.setColorScale(1.0, 1.0, 1.0, 1.0);
    this.setUvScale(1.0, 1.0);
    this.setUvOffset(0.0, 0.0);
  }

  // blend mode ごとの差を pipeline 定義へまとめる
  resolveBlendState() {
    if (this.blendMode === "add") {
      return {
        color: {
          srcFactor: "one",
          dstFactor: "one",
          operation: "add"
        },
        alpha: {
          srcFactor: "one",
          dstFactor: "one",
          operation: "add"
        }
      };
    }
    if (this.blendMode === "alpha") {
      return {
        color: {
          srcFactor: "src-alpha",
          dstFactor: "one-minus-src-alpha",
          operation: "add"
        },
        alpha: {
          srcFactor: "one",
          dstFactor: "one-minus-src-alpha",
          operation: "add"
        }
      };
    }
    return undefined;
  }

  // fullscreen pass 用 pipeline / quad / uniform を生成する
  createResources() {
    const shaderCode = `
struct Uniforms {
  colorScale : vec4f,
  uvScale : vec2f,
  uvOffset : vec2f,
};

@group(0) @binding(0) var<uniform> uniforms : Uniforms;
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
  output.vTexCoord = input.texCoord * uniforms.uvScale + uniforms.uvOffset;
  return output;
}

@fragment
fn fsMain(input : VSOut) -> @location(0) vec4f {
  return textureSample(uTexture, uSampler, input.vTexCoord) * uniforms.colorScale;
}`;

    const module = this.createShaderModule(shaderCode);
    this.bindGroupLayout = this.createUniformTextureBindGroupLayout({
      hasDynamicOffset: false
    });
    const pipelineLayout = this.createPipelineLayout([this.bindGroupLayout]);

    this.pipeline = this.device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module,
        entryPoint: "vsMain",
        buffers: [
          {
            arrayStride: 4 * 4,
            attributes: [
              { shaderLocation: 0, offset: 0, format: "float32x2" },
              { shaderLocation: 1, offset: 2 * 4, format: "float32x2" }
            ]
          }
        ]
      },
      fragment: {
        module,
        entryPoint: "fsMain",
        targets: [{
          format: this.targetFormat,
          blend: this.resolveBlendState()
        }]
      },
      primitive: {
        topology: "triangle-strip",
        cullMode: "none"
      }
    });

    this.createUniformBuffer(this.uniformData.byteLength);
    this.createDefaultTexture({
      width: 64,
      height: 1,
      samplerDescriptor: {
        magFilter: "linear",
        minFilter: "linear",
        mipmapFilter: "linear"
      }
    });
    this.makeQuad();
    this.updateUniforms();
  }

  // fullscreen quad 頂点を 1 度だけ作る
  makeQuad() {
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
    this.gpu.queue.writeBuffer(this.vertexBuffer, 0, vertices);
  }

  setSource(texture) {
    this.texture = texture;
  }

  setColorScale(r, g, b, a = 1.0) {
    this.uniformData.set([r, g, b, a], this.OFF_COLOR_SCALE);
    this.updateUniforms();
  }

  setUvScale(u, v) {
    this.uniformData.set([u, v], this.OFF_UV_SCALE);
    this.updateUniforms();
  }

  setUvOffset(u, v) {
    this.uniformData.set([u, v], this.OFF_UV_OFFSET);
    this.updateUniforms();
  }

  // 現在の pass へ source texture を 1 枚描く
  draw(texture = this.texture) {
    const pass = this.gpu?.passEncoder;
    if (!pass) return;
    this.useProgram(pass);
    pass.setVertexBuffer(0, this.vertexBuffer);
    pass.setBindGroup(0, this.getOrCreateTexturedBindGroup({
      texture,
      cache: this.bindGroupCache,
      layout: this.bindGroupLayout
    }));
    pass.draw(4, 1, 0, 0);
  }
}
