// ---------------------------------------------
// BillboardShader.js  2026/03/03
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import Shader from "./Shader.js";

export default class BillboardShader extends Shader {
  // ビルボード描画のuniform管理を初期化する
  constructor(gpu) {
    super(gpu);
    this.uniformData = new Float32Array(44);
    this.bindGroupLayout = null;
    this.bindGroupCache = new WeakMap();

    this.OFF_PROJ = 0;
    this.OFF_VIEW = 16;
    this.OFF_RIGHT = 32;
    this.OFF_UP = 36;
    this.OFF_PARAMS = 40;

    this.projectionMatrix = null;
    this.viewMatrix = null;
  }

  // ビルボード専用のパイプラインとリソースを構築する
  createResources() {
    const device = this.device;
    const shaderCode = `
//------------------ WGSL ------------------------
struct Uniforms {
  proj : mat4x4f,
  view : mat4x4f,
  cameraRight : vec4f,
  cameraUp : vec4f,
  params : vec4f,
};

@group(0) @binding(0) var<uniform> uniforms : Uniforms;
@group(0) @binding(1) var uTexture : texture_2d<f32>;
@group(0) @binding(2) var uSampler : sampler;

struct VSIn {
  @location(0) quadPos : vec2f,
  @location(1) quadUv : vec2f,
  @location(2) center : vec3f,
  @location(3) scale : vec2f,
  @location(4) color : vec4f,
};

struct VSOut {
  @builtin(position) position : vec4f,
  @location(0) vUv : vec2f,
  @location(1) vColor : vec4f,
};

@vertex
fn vsMain(input : VSIn) -> VSOut {
  var output : VSOut;
  let worldPos = input.center
    + uniforms.cameraRight.xyz * (input.quadPos.x * input.scale.x)
    + uniforms.cameraUp.xyz * (input.quadPos.y * input.scale.y);
  let viewPos = uniforms.view * vec4f(worldPos, 1.0);
  output.position = uniforms.proj * viewPos;
  output.vUv = input.quadUv;
  output.vColor = input.color;
  return output;
}

@fragment
fn fsMain(input : VSOut) -> @location(0) vec4f {
  let tex = textureSample(uTexture, uSampler, input.vUv);
  let alpha = tex.a * input.vColor.a * uniforms.params.x;
  return vec4f(tex.rgb * input.vColor.rgb, alpha);
}
//------------------ WGSL ------------------------`;

    const module = this.createShaderModule(shaderCode);
    this.bindGroupLayout = this.createUniformTextureBindGroupLayout({ hasDynamicOffset: false });
    const pipelineLayout = this.createPipelineLayout([this.bindGroupLayout]);

    this.pipeline = device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module,
        entryPoint: "vsMain",
        buffers: [
          {
            arrayStride: 4 * 4,
            stepMode: "vertex",
            attributes: [
              { shaderLocation: 0, offset: 0, format: "float32x2" },
              { shaderLocation: 1, offset: 2 * 4, format: "float32x2" }
            ]
          },
          {
            arrayStride: 9 * 4,
            stepMode: "instance",
            attributes: [
              { shaderLocation: 2, offset: 0, format: "float32x3" },
              { shaderLocation: 3, offset: 3 * 4, format: "float32x2" },
              { shaderLocation: 4, offset: 5 * 4, format: "float32x4" }
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
        depthCompare: "less"
      }
    });

    this.createUniformBuffer(this.uniformData.byteLength);
    this.createDefaultTexture();
    this.setOpacity(1.0);
  }

  // 1x1白テクスチャをデフォルトとして作成する
  createDefaultTexture() {
    super.createDefaultTexture({
      width: 1,
      height: 1,
      samplerDescriptor: {
        magFilter: "linear",
        minFilter: "linear",
        mipmapFilter: "linear"
      }
    });
  }

  // テクスチャ込みbindGroupを取得する
  getBindGroup(texture) {
    return this.getOrCreateTexturedBindGroup({
      texture,
      cache: this.bindGroupCache,
      layout: this.bindGroupLayout
    });
  }

  // 射影行列を設定する
  setProjectionMatrix(m) {
    this.projectionMatrix = m.clone();
    this.uniformData.set(m.mat, this.OFF_PROJ);
    this.updateUniforms();
  }

  // ビュー行列を設定する
  setViewMatrix(m) {
    this.viewMatrix = m.clone();
    this.uniformData.set(m.mat, this.OFF_VIEW);
    this.updateUniforms();
  }

  // カメラの右軸と上軸を設定する
  setCameraAxes(right, up) {
    this.uniformData.set([right[0], right[1], right[2], 0.0], this.OFF_RIGHT);
    this.uniformData.set([up[0], up[1], up[2], 0.0], this.OFF_UP);
    this.updateUniforms();
  }

  // 全体不透明度を設定する
  setOpacity(alpha) {
    this.uniformData[this.OFF_PARAMS] = alpha;
    this.updateUniforms();
  }
}
