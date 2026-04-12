// ---------------------------------------------
// Background.js   2026/03/07
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import Shader from "./Shader.js";
import Texture from "./Texture.js";

export default class Background extends Shader {
  // 背景描画用の色/窓/順序パラメータを初期化する
  constructor(gpu) {
    // 画面背景専用の矩形描画クラス
    // 3Dシーンとは別に、画像/色をフルスクリーンまたは部分領域へ描く
    super(gpu);
    this.color = [1.0, 1.0, 1.0];
    this.aspect = 1.0;
    this.window = [0.0, 0.0, 1.0, 1.0];
    this.order = 0.0;
    this.vertexBuffer = null;
    this.bindGroupLayout = null;
    this.bindGroupCache = new WeakMap();

    // WGSL Uniforms:
    // color(vec3) @0, aspect(f32) @12, window(vec4) @16
    // => float index: color[0..2], aspect[3], window[4..7]
    this.uniformData = new Float32Array(8);
    this.OFF_COLOR = 0;
    this.OFF_ASPECT = 3;
    this.OFF_WINDOW = 4;
  }

  // 画面全面クワッド描画用のPipeline等を構築する
  createResources() {
    // 背景用WGSL、パイプライン、uniform、頂点バッファを構築する
    const device = this.device;
    const shaderCode = `
//------------------ WGSL ------------------------
struct Uniforms {
  color : vec3f,
  aspect : f32,
  window : vec4f,
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
  var pos = input.position;
  pos.x = input.position.x * uniforms.window.z * uniforms.aspect + uniforms.window.x;
  pos.y = input.position.y * uniforms.window.w + uniforms.window.y;
  pos.z = input.position.z;
  output.position = vec4f(pos, 1.0);
  // HTML Image由来のテクスチャ座標系との差を吸収するためVを反転する
  output.vTexCoord = vec2f(input.texCoord.x, 1.0 - input.texCoord.y);
  return output;
}

@fragment
fn fsMain(input : VSOut) -> @location(0) vec4f {
  let tex = textureSample(uTexture, uSampler, input.vTexCoord);
  return vec4f(tex.rgb * uniforms.color, tex.a);
}
//------------------ WGSL ------------------------`;

    const module = this.createShaderModule(shaderCode);

    this.bindGroupLayout = this.createUniformTextureBindGroupLayout({
      hasDynamicOffset: false
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
        targets: [{ format: this.gpu.format }]
      },
      primitive: {
        topology: "triangle-strip",
        cullMode: "none"
      },
      depthStencil: {
        format: "depth24plus",
        depthWriteEnabled: false,
        depthCompare: "less"
      }
    });

    this.createUniformBuffer(this.uniformData.byteLength);
    this.createDefaultTexture();
    this.makeShape();
    this.setColor(1.0, 1.0, 1.0);
  }

  // 背景デフォルトテクスチャを生成する
  createDefaultTexture() {
    // Use a 64x1 texture so bytesPerRow is 256-byte aligned.
    super.createDefaultTexture({
      width: 64,
      height: 1,
      samplerDescriptor: {
        magFilter: "linear",
        minFilter: "linear"
      }
    });
  }

  // 背景用BindGroupを返す
  getBindGroup(texture) {
    return this.getOrCreateTexturedBindGroup({
      texture,
      cache: this.bindGroupCache,
      layout: this.bindGroupLayout
    });
  }

  // 現状 no-op
  setTextureUnit(tex_unit) {}

  // 背景色を設定する
  setColor(r, g, b) {
    this.color = [r, g, b];
    this.uniformData.set([r, g, b], this.OFF_COLOR);
    this.updateUniforms();
  }

  // アスペクト補正値を設定する
  setAspect(aspect) {
    this.aspect = aspect;
    this.uniformData[this.OFF_ASPECT] = aspect;
    this.updateUniforms();
  }

  // 描画領域のUV窓を設定する
  setWindow(left, top, width, height) {
    // NDC基準(中心座標+半サイズ)で描画領域を設定する
    this.window = [left, top, width, height];
    this.uniformData.set([left, top, width, height], this.OFF_WINDOW);
    this.updateUniforms();
  }

  // ピクセル矩形指定で描画領域を設定する
  setWindowPixels(x, y, width, height, screenWidth, screenHeight) {
    const sx = width / screenWidth;
    const sy = height / screenHeight;
    const cx = ((x + width * 0.5) / screenWidth) * 2.0 - 1.0;
    const cy = 1.0 - ((y + height * 0.5) / screenHeight) * 2.0;
    this.setWindow(cx, cy, sx, sy);
  }

  // テクスチャ縦横比を維持する補正値を設定する
  setTextureAspect(textureWidth, textureHeight, rectWidth, rectHeight) {
    const texAspect = textureWidth / textureHeight;
    const rectAspect = rectWidth / rectHeight;
    this.setAspect(texAspect / rectAspect);
  }

  // 描画順序パラメータを設定する
  setOrder(order) {
    this.order = order;
  }

  // リソース生成と初期状態設定を行う
  init() {
    return super.init();
  }

  // 背景テクスチャを差し替える
  setBackground(texture) {
    this.texture = texture;
  }

  async setBackgroundImage(file) {
    // 画像ファイルをTextureとして読み込み、背景テクスチャに設定する
    const tex = new Texture(this.gpu);
    await tex.initPromise;
    const ok = await tex.readImageFromFile(file);
    if (!ok) return false;
    this.setBackground(tex);
    return true;
  }

  // 背景用ジオメトリを用意する
  makeShape() {
    // 背景四角形の頂点(clip-space)を作成する
    const vertices = new Float32Array([
      -1.0, -1.0, 0.0, 0.0, 0.0,
       1.0, -1.0, 0.0, 1.0, 0.0,
      -1.0,  1.0, 0.0, 0.0, 1.0,
       1.0,  1.0, 0.0, 1.0, 1.0
    ]);
    this.vertexBuffer = this.device.createBuffer({
      size: vertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    });
    this.gpu.queue.writeBuffer(this.vertexBuffer, 0, vertices);
  }

  // 現在のパスへ背景を描く
  draw() {
    const pass = this.gpu.passEncoder;
    if (!pass) return;
    // フルスクリーン背景描画用のパイプラインと頂点バッファを設定
    pass.setPipeline(this.pipeline);
    pass.setVertexBuffer(0, this.vertexBuffer);
    const bindGroup = this.getBindGroup(this.texture);
    // group(0) に背景色uniform とテクスチャ/サンプラをバインド
    pass.setBindGroup(0, bindGroup);
    // triangle-strip 4頂点で画面全体に1枚描画
    pass.draw(4, 1, 0, 0);
  }
}
