// ---------------------------------------------
// Font.js        2026/03/10
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import Shader from "./Shader.js";

export default class Font extends Shader {
  // フォント描画用Uniform管理を初期化する
  constructor(gpu) {
    // Text/Messageの1文字描画専用シェーダ
    // 文字ごとに dynamic offset で uniform を切り替える
    super(gpu);
    this.scale = 1.0;
    this.uniformData = new Float32Array(20);
    this.uniformStride = 256;
    this.maxUniforms = 2048;
    this.bindGroupLayout = null;
    this.bindGroupCache = new WeakMap();
  }

  // 文字描画専用Pipeline/BindGroupを生成する
  createResources() {
    // フォント描画パイプラインとuniform/既定テクスチャを構築する
    const device = this.device;
    const shaderCode = `
//------------------ WGSL ------------------------
struct Uniforms {
  charInfo : vec4f, // x, y, ch, scale
  color : vec4f,
  texStep : vec2f,
  flags : vec2f,
  texel : vec2f,
  cellStep : vec2f,
};

@group(0) @binding(0) var<uniform> uniforms : Uniforms;
@group(0) @binding(1) var uTexture : texture_2d<f32>;
@group(0) @binding(2) var uSampler : sampler;

struct VSIn {
  @location(0) position : vec3f,
  @location(1) texCoord : vec2f,
};

struct VSOut {
  @builtin(position) position : vec4f,
  @location(0) vTexCoord : vec2f,
};

@vertex
fn vsMain(input : VSIn) -> VSOut {
  var output : VSOut;
  let scale = uniforms.charInfo.w;
  let y0 = floor((uniforms.charInfo.z + 0.5) / 16.0);
  let x = uniforms.charInfo.z - y0 * 16.0;
  let y = y0;
  var pos = input.position;
  pos.x = (input.position.x + uniforms.charInfo.x * uniforms.cellStep.x) * scale - 1.0;
  pos.y = 1.0 + (input.position.y - uniforms.cellStep.y * (uniforms.charInfo.y + 1.0)) * scale;
  output.position = vec4f(pos.xy, 0.0, 1.0);
  let cell = uniforms.texStep;
  let inset = uniforms.texel * 0.5;
  let uv = input.texCoord * (cell - uniforms.texel) + inset + cell * vec2f(x, y);
  output.vTexCoord = uv;
  return output;
}

@fragment
fn fsMain(input : VSOut) -> @location(0) vec4f {
  var v = input.vTexCoord.y;
  if (uniforms.flags.x > 0.5) {
    v = 1.0 - v;
  }
  let uv = vec2f(input.vTexCoord.x, v);
  let tex = textureSample(uTexture, uSampler, uv);
  return vec4f(uniforms.color.rgb, 1.0) * tex.a;
}
//------------------ WGSL ------------------------`;

    const module = this.createShaderModule(shaderCode);

    this.bindGroupLayout = this.createUniformTextureBindGroupLayout({
      hasDynamicOffset: true
    });

    const pipelineLayout = this.createPipelineLayout([this.bindGroupLayout]);

    this.pipeline = device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module,
        entryPoint: "vsMain",
        buffers: [
          {
            arrayStride: 5 * 4,
            attributes: [
              { shaderLocation: 0, offset: 0, format: "float32x3" },
              { shaderLocation: 1, offset: 3 * 4, format: "float32x2" }
            ]
          }
        ]
      },
      fragment: {
        module,
        entryPoint: "fsMain",
        targets: [
          {
            format: this.gpu.format,
            blend: {
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
            }
          }
        ]
      },
      primitive: {
        topology: "triangle-strip",
        cullMode: "none"
      },
      depthStencil: {
        format: "depth24plus",
        depthWriteEnabled: false,
        depthCompare: "always"
      }
    });

    this.createUniformBuffer(this.uniformStride * this.maxUniforms);
    this.createDefaultTexture();
    this.setTextureUnit(0);
    this.setChar(0, 0, 0x20);
    this.setColor(1.0, 1.0, 1.0);
    this.setScale(1.0);
    this.setTexStep(1.0 / 16.0, 1.0 / 8.0);
    this.setTexelSize(1.0 / 128.0, 1.0 / 128.0);
    this.setCellStep(2.0 / 80.0, 2.0 / 25.0);
    this.setFlipV(true);
  }

  // 1x1白テクスチャを生成する
  createDefaultTexture() {
    super.createDefaultTexture({
      width: 1,
      height: 1,
      samplerDescriptor: {
        magFilter: "nearest",
        minFilter: "nearest"
      }
    });
  }

  // テクスチャ付きBindGroupを返す
  getBindGroup(texture) {
    // フォントテクスチャごとにBindGroupをキャッシュする
    return this.getOrCreateTexturedBindGroup({
      texture,
      cache: this.bindGroupCache,
      layout: this.bindGroupLayout,
      uniformSize: this.uniformData.byteLength
    });
  }

  // 現状 no-op
  setTextureUnit(tex_unit) {}

  // 描画対象文字と座標を設定する
  setChar(x, y, ch) {
    // 1文字分のセル位置と文字コードをセットする
    this.uniformData[0] = x;
    this.uniformData[1] = y;
    this.uniformData[2] = ch;
    this.uniformData[3] = this.scale;
    this.updateUniformsAt(0);
  }

  // 文字描画位置を設定する
  setPos(x, y) {
    this.uniformData[0] = x;
    this.uniformData[1] = y;
    this.uniformData[2] = 32.0;
    this.uniformData[3] = this.scale;
    this.updateUniformsAt(0);
  }

  // 文字色を設定する
  setColor(r, g, b) {
    this.uniformData.set([r, g, b, 1.0], 4);
    this.updateUniformsAt(0);
  }

  // 文字スケールを設定する
  setScale(scale) {
    this.scale = scale;
    this.uniformData[3] = scale;
    this.updateUniformsAt(0);
  }

  // 現在スケールを返す
  getScale() {
    return this.scale;
  }

  // 文字セルUVステップを設定する
  setTexStep(u, v) {
    // フォントアトラス1セルのUV幅/高さを指定する
    this.uniformData[8] = u;
    this.uniformData[9] = v;
    this.updateUniformsAt(0);
  }

  // V反転有効/無効を設定する
  setFlipV(enable) {
    this.uniformData[10] = enable ? 1.0 : 0.0;
    this.updateUniformsAt(0);
  }

  // テクセルサイズを設定する
  setTexelSize(u, v) {
    this.uniformData[12] = u;
    this.uniformData[13] = v;
    this.updateUniformsAt(0);
  }

  // 1文字セルのNDC幅/高さを設定する
  setCellStep(x, y) {
    this.uniformData[14] = x;
    this.uniformData[15] = y;
    this.updateUniformsAt(0);
  }

  // 配列Uniformの `index` へ文字情報を設定する
  setCharAt(index, x, y, ch) {
    this.uniformData[0] = x;
    this.uniformData[1] = y;
    this.uniformData[2] = ch;
    this.uniformData[3] = this.scale;
    this.updateUniformsAt(index);
  }

  // 該当文字インスタンスのUniformを更新する
  updateUniformsAt(index) {
    if (!this.uniformBuffer || !this.uniformData) return;
    const offset = this.uniformStride * index;
    this.gpu.queue.writeBuffer(this.uniformBuffer, offset, this.uniformData.buffer, 0, this.uniformData.byteLength);
  }
}
