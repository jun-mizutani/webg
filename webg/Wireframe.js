// ---------------------------------------------
// Wireframe.js   2026/03/07
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import Shader from "./Shader.js";

export default class Wireframe extends Shader {
  // 辺描画専用シェーダ状態を初期化する
  constructor(gpu) {
    super(gpu);
    this.default = {
      color: [0.2, 0.95, 0.2, 1.0]
    };
    this.change = {};

    this.uniformData = new Float32Array(36);
    this.uniformStride = 256;
    this.maxUniforms = 2048;
    this.dynamicOffsetGroup0 = true;
    this.uniformBindGroup = null;

    this.OFF_PROJ = 0;
    this.OFF_MV = 16;
    this.OFF_COLOR = 32;
  }

  // line-list用WGSL・Pipeline・Uniformを作成する
  createResources() {
    const device = this.device;
    const shaderCode = `
struct Uniforms {
  proj : mat4x4f,
  modelView : mat4x4f,
  color : vec4f,
};

@group(0) @binding(0) var<uniform> uniforms : Uniforms;

struct VSIn {
  @location(0) position : vec3f,
};

struct VSOut {
  @builtin(position) position : vec4f,
  @location(0) color : vec4f,
};

@vertex
fn vsMain(input : VSIn) -> VSOut {
  var output : VSOut;
  let worldPos = uniforms.modelView * vec4f(input.position, 1.0);
  output.position = uniforms.proj * worldPos;
  output.color = uniforms.color;
  return output;
}

@fragment
fn fsMain(input : VSOut) -> @location(0) vec4f {
  return input.color;
}
`;

    const module = this.createShaderModule(shaderCode);
    this.bindGroupLayout = this.createUniformBindGroupLayout({
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
            arrayStride: 8 * 4,
            attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }]
          }
        ]
      },
      fragment: {
        module,
        entryPoint: "fsMain",
        targets: [{ format: this.gpu.format }]
      },
      primitive: {
        topology: "line-list",
        cullMode: "none"
      },
      depthStencil: {
        format: "depth24plus",
        depthWriteEnabled: false,
        depthCompare: "less-equal"
      }
    });

    this.createUniformBuffer(this.uniformStride * this.maxUniforms);
    this.uniformBindGroup = device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer, size: this.uniformData.byteLength } }]
    });
    this.setColor(this.default.color);
  }

  // Group0（Uniform）BindGroupを返す
  getBindGroup() {
    return this.uniformBindGroup;
  }

  // 射影行列を設定する
  setProjectionMatrix(m) {
    this.projectionMatrix = m.clone();
    this.uniformData.set(m.mat, this.OFF_PROJ);
    this.updateUniforms();
  }

  // モデルビュー行列を設定する
  setModelViewMatrix(m) {
    this.uniformData.set(m.mat, this.OFF_MV);
    this.updateUniforms();
  }

  // 現状 no-op
  setNormalMatrix(m) {}

  // 線色 `[r,g,b,a]` を設定する
  setColor(color) {
    this.uniformData.set(color, this.OFF_COLOR);
    this.updateUniforms();
  }

  // Shape側パラメータを適用する
  doParameter(param) {
    this.updateParam(param, "color", this.setColor.bind(this));
  }
}
