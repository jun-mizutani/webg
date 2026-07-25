// ---------------------------------------------
//  GlassMaskShader.js  2026/05/04
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import Shader from "./Shader.js";

export default class GlassMaskShader extends Shader {

  // 生成: ガラス用 mask shader の設定値と uniform 配列を初期化する
  // この時点では GPU pipeline は作らず、init() から createResources() が呼ばれるまで待つ
  constructor(gpu, options = {}) {
    super(gpu);
    this.targetFormat = options.targetFormat ?? gpu?.format ?? "bgra8unorm";
    this.depthCompare = options.depthCompare ?? "less";
    this.cullMode = options.cullMode ?? "back";
    this.frontFace = options.frontFace ?? "ccw";
    this.OFF_PROJ = 0;
    this.OFF_MV = 16;
    this.OFF_COLOR = 32;
    this.UNIFORM_FLOAT_COUNT = 36;
    this.uniformData = new Float32Array(this.UNIFORM_FLOAT_COUNT);
    this.bindGroup = null;
    this.default = {
      color: options.color ?? [0.72, 0.90, 1.0, 0.72]
    };
    this.setColor(this.default.color);
  }

  // GPU 準備: Shape.draw() から使う pipeline、uniform buffer、bind group を作る
  // この shader はガラス面の色を画面へ直接出すのではなく、mask target へ色と alpha を書く
  createResources() {
    const shaderCode = `
struct Uniforms {
  projMatrix : mat4x4f,
  modelViewMatrix : mat4x4f,
  color : vec4f,
};

@group(0) @binding(0) var<uniform> uniforms : Uniforms;

struct VSIn {
  @location(0) position : vec3f,
  @location(1) normal : vec3f,
  @location(2) texCoord : vec2f,
};

struct VSOut {
  @builtin(position) position : vec4f,
};

@vertex
fn vsMain(input : VSIn) -> VSOut {
  var output : VSOut;
  output.position = uniforms.projMatrix * uniforms.modelViewMatrix * vec4f(input.position, 1.0);
  return output;
}

@fragment
fn fsMain() -> @location(0) vec4f {
  return uniforms.color;
}`;

    const module = this.createShaderModule(shaderCode);
    this.bindGroupLayout = this.createUniformBindGroupLayout();
    const pipelineLayout = this.createPipelineLayout([this.bindGroupLayout]);
    this.pipeline = this.device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module,
        entryPoint: "vsMain",
        buffers: [{
          arrayStride: 8 * 4,
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x3" },
            { shaderLocation: 1, offset: 3 * 4, format: "float32x3" },
            { shaderLocation: 2, offset: 6 * 4, format: "float32x2" }
          ]
        }]
      },
      fragment: {
        module,
        entryPoint: "fsMain",
        targets: [{ format: this.targetFormat }]
      },
      primitive: {
        topology: "triangle-list",
        cullMode: this.cullMode,
        frontFace: this.frontFace
      },
      depthStencil: {
        depthWriteEnabled: false,
        depthCompare: this.depthCompare,
        format: "depth24plus"
      }
    });
    this.createUniformBuffer(this.uniformData.byteLength);
    this.bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [{
        binding: 0,
        resource: { buffer: this.uniformBuffer }
      }]
    });
    this.updateUniforms();
  }

  // bind : Shape.draw() が group(0) に設定する bind group を返す
  // mask shader は texture を読まないため、uniform buffer だけを含む bind group を共有する
  getBindGroup() {
    return this.bindGroup;
  }

  // カメラ設定: screen resize や camera 設定後の projection matrix を uniform へ書く
  // vertex shader はこの行列で mesh 頂点を clip 空間へ変換する
  setProjectionMatrix(m) {
    this.projectionMatrix = m.clone();
    this.uniformData.set(m.mat, this.OFF_PROJ);
    this.updateUniforms();
  }

  // 描画直前: Node.draw() が作った modelView matrix を uniform へ書く
  // ガラス Shape の位置、向き、大きさはこの行列で mask 描画へ反映される
  setModelViewMatrix(m) {
    this.uniformData.set(m.mat, this.OFF_MV);
    this.updateUniforms();
  }

  // 描画互換: Shape.draw() から呼ばれるが、mask 描画では法線を使わない
  // SmoothShader と同じ呼び出し経路へ乗せるために空の関数として用意する
  setNormalMatrix(m) {}

  // 材質反映: mask target へ書く RGB tint と alpha 強度を uniform へ書く
  // alpha は FrostedGlassPass の合成時に blur の混ぜ具合として使われる
  setColor(color) {
    const next = Array.isArray(color) ? color : this.default.color;
    this.uniformData.set([
      Number(next[0] ?? 1.0),
      Number(next[1] ?? 1.0),
      Number(next[2] ?? 1.0),
      Number(next[3] ?? 1.0)
    ], this.OFF_COLOR);
    this.updateUniforms();
  }

  // Shape parameter 反映: setMaterial() や shaderParameter() の値を shader uniform へ流す
  // color と mask_color のどちらでも mask 色を指定できるようにする
  doParameter(param = {}) {
    if (param.color !== undefined) this.setColor(param.color);
    if (param.mask_color !== undefined) this.setColor(param.mask_color);
  }
}
