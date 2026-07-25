// ---------------------------------------------
//  FullscreenPass.js  2026/07/25
//   Final display texture presentation pass
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import Shader from "./Shader.js";
import util from "./util.js";

export const FULLSCREEN_SOURCE_FORMAT = "rgba8unorm";
export const FULLSCREEN_BLEND_MODES = Object.freeze(["replace", "add", "alpha"]);

export default class FullscreenPass extends Shader {

  // fullscreen quad で 1 枚の texture を現在 pass へ描く
  constructor(gpu, options = {}) {
    super(gpu);
    this.requestedTargetFormat = options.targetFormat;
    this.targetFormat = null;
    this.blendMode = util.readOptionalEnum(
      options.blendMode,
      "FullscreenPass blendMode",
      "replace",
      FULLSCREEN_BLEND_MODES
    );
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

  // キャンバスへ出力する派生パスも同じ形式検証を共有します
  resolveTargetFormat() {
    const canvasFormat = util.readOptionalString(
      this.gpu?.format,
      "FullscreenPass canvas format",
      undefined,
      { trim: true, allowEmpty: false }
    );
    if (!canvasFormat) {
      throw new Error("FullscreenPass requires an initialized canvas format");
    }
    const requestedFormat = util.readOptionalString(
      this.requestedTargetFormat,
      "FullscreenPass targetFormat",
      canvasFormat,
      { trim: true, allowEmpty: false }
    );
    if (requestedFormat !== canvasFormat) {
      throw new Error(
        `FullscreenPass targetFormat must match canvas format ${canvasFormat}`
      );
    }
    this.targetFormat = canvasFormat;
    return this.targetFormat;
  }

  // fullscreen pass 用 pipeline / quad / uniform を生成する
  createResources() {
    this.resolveTargetFormat();
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
    this.texture = this.validateSource(texture);
  }

  // 色の倍率を受け取り、現在の設定と後続処理へ反映する
  setColorScale(r, g, b, a = 1.0) {
    this.uniformData.set([
      util.readFiniteNumber(r, "FullscreenPass colorScale.r"),
      util.readFiniteNumber(g, "FullscreenPass colorScale.g"),
      util.readFiniteNumber(b, "FullscreenPass colorScale.b"),
      util.readFiniteNumber(a, "FullscreenPass colorScale.a")
    ], this.OFF_COLOR_SCALE);
    this.updateUniforms();
  }

  // `uv`の倍率を受け取り、現在の設定と後続処理へ反映する
  setUvScale(u, v) {
    this.uniformData.set([
      util.readFiniteNumber(u, "FullscreenPass uvScale.u"),
      util.readFiniteNumber(v, "FullscreenPass uvScale.v")
    ], this.OFF_UV_SCALE);
    this.updateUniforms();
  }

  // `uv`の`offset`を受け取り、現在の設定と後続処理へ反映する
  setUvOffset(u, v) {
    this.uniformData.set([
      util.readFiniteNumber(u, "FullscreenPass uvOffset.u"),
      util.readFiniteNumber(v, "FullscreenPass uvOffset.v")
    ], this.OFF_UV_OFFSET);
    this.updateUniforms();
  }

  // 最終表示sourceがTone Map後の形式・canvas実pixel寸法を持つことを検証します
  validateSource(texture) {
    if (
      !texture ||
      typeof texture.getView !== "function" ||
      typeof texture.getSampler !== "function" ||
      typeof texture.getFormat !== "function" ||
      typeof texture.getWidth !== "function" ||
      typeof texture.getHeight !== "function"
    ) {
      throw new Error(
        "FullscreenPass source must be a RenderTarget-compatible display texture"
      );
    }
    if (texture.getFormat() !== FULLSCREEN_SOURCE_FORMAT) {
      throw new Error(`FullscreenPass source format must be ${FULLSCREEN_SOURCE_FORMAT}`);
    }
    const width = util.readFiniteNumber(texture.getWidth(), "FullscreenPass source width", {
      integer: true,
      min: 1
    });
    const height = util.readFiniteNumber(texture.getHeight(), "FullscreenPass source height", {
      integer: true,
      min: 1
    });
    const canvasWidth = util.readFiniteNumber(
      this.gpu?.canvas?.width,
      "FullscreenPass canvas width",
      { integer: true, min: 1 }
    );
    const canvasHeight = util.readFiniteNumber(
      this.gpu?.canvas?.height,
      "FullscreenPass canvas height",
      { integer: true, min: 1 }
    );
    if (width !== canvasWidth || height !== canvasHeight) {
      throw new Error(
        `FullscreenPass source size ${width}x${height} does not match canvas size `
        + `${canvasWidth}x${canvasHeight}`
      );
    }
    if (!texture.getView() || !texture.getSampler()) {
      throw new Error("FullscreenPass source view and sampler must be ready");
    }
    return texture;
  }

  // depthなしswapchain passへTone Map後のsource textureを1枚描く
  draw(texture = this.texture) {
    const pass = this.gpu?.passEncoder;
    if (!pass) {
      throw new Error("FullscreenPass.draw requires an active presentation render pass");
    }
    if (this.gpu.passTargetsSwapChain !== true || this.gpu.passHasDepth !== false) {
      throw new Error(
        "FullscreenPass.draw requires Screen.beginPresentPass() with no depth attachment"
      );
    }
    const checkedTexture = this.validateSource(texture);
    this.useProgram(pass);
    pass.setVertexBuffer(0, this.vertexBuffer);
    pass.setBindGroup(0, this.getOrCreateTexturedBindGroup({
      texture: checkedTexture,
      cache: this.bindGroupCache,
      layout: this.bindGroupLayout
    }));
    pass.draw(4, 1, 0, 0);
  }
}
