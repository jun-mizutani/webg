// ---------------------------------------------
// Wireframe.js   2026/04/27
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import Shader from "./Shader.js";
import {
  DEFAULT_MAX_SKIN_BONES,
  SKIN_MATRIX_FLOATS_PER_BONE,
  SKIN_MATRIX_VECTORS_PER_BONE
} from "./SkinningConfig.js";

export default class Wireframe extends Shader {
  // 辺描画専用シェーダ状態を初期化する
  constructor(gpu) {
    super(gpu);
    this.MAX_BONES = DEFAULT_MAX_SKIN_BONES;
    this.BONE_DATA_SIZE = this.MAX_BONES * SKIN_MATRIX_FLOATS_PER_BONE;
    this.BONE_VECTOR_COUNT = this.MAX_BONES * SKIN_MATRIX_VECTORS_PER_BONE;
    this.BONE_UNIFORM_SIZE = this.BONE_DATA_SIZE * Float32Array.BYTES_PER_ELEMENT;

    this.default = {
      color: [0.2, 0.95, 0.2, 1.0],
      has_bone: 0
    };
    this.change = {};

    this.uniformData = new Float32Array(40);
    this.uniformStride = 256;
    this.maxUniforms = 2048;
    this.dynamicOffsetGroup0 = true;
    this.uniformBindGroup = null;
    this.skinBindGroupCache = new WeakMap();
    this.defaultBoneBuffer = null;
    this.defaultBoneBindGroup = null;
    this.manualSkinSource = {};
    this.activeSkinSource = null;
    this._dummySkinBuffer = null;
    this._dummySkinVertexCapacity = 0;

    this.OFF_PROJ = 0;
    this.OFF_MV = 16;
    this.OFF_COLOR = 32;
    this.OFF_FLAGS = 36; // hasBone/unused/unused/unused
  }

  // line-list用WGSL・Pipeline・Uniformを作成する
  createResources() {
    const device = this.device;
    const shaderCode = `
struct Uniforms {
  proj : mat4x4f,
  modelView : mat4x4f,
  color : vec4f,
  flags : vec4f,
};

struct SkinUniforms {
  bones : array<vec4f, ${this.BONE_VECTOR_COUNT}>,
};

@group(0) @binding(0) var<uniform> uniforms : Uniforms;
@group(2) @binding(0) var<uniform> skin : SkinUniforms;

struct VSIn {
  @location(0) position : vec3f,
  @location(1) normal : vec3f,
  @location(2) texCoord : vec2f,
  @location(3) index : vec4f,
  @location(4) weight : vec4f,
};

struct VSOut {
  @builtin(position) position : vec4f,
  @location(0) color : vec4f,
};

@vertex
fn vsMain(input : VSIn) -> VSOut {
  var output : VSOut;
  var skinMat : mat4x4f;

  if (uniforms.flags.x == 0.0) {
    skinMat = mat4x4f(
      vec4f(1.0, 0.0, 0.0, 0.0),
      vec4f(0.0, 1.0, 0.0, 0.0),
      vec4f(0.0, 0.0, 1.0, 0.0),
      vec4f(0.0, 0.0, 0.0, 1.0)
    );
  } else {
    let i0 = i32(input.index.x) * 3;
    let i1 = i32(input.index.y) * 3;
    let i2 = i32(input.index.z) * 3;
    let i3 = i32(input.index.w) * 3;

    var v0 : vec4f;
    var v1 : vec4f;
    var v2 : vec4f;

    v0  = skin.bones[i0] * input.weight.x + skin.bones[i1] * input.weight.y;
    v0 += skin.bones[i2] * input.weight.z + skin.bones[i3] * input.weight.w;

    v1  = skin.bones[i0 + 1] * input.weight.x + skin.bones[i1 + 1] * input.weight.y;
    v1 += skin.bones[i2 + 1] * input.weight.z + skin.bones[i3 + 1] * input.weight.w;

    v2  = skin.bones[i0 + 2] * input.weight.x + skin.bones[i1 + 2] * input.weight.y;
    v2 += skin.bones[i2 + 2] * input.weight.z + skin.bones[i3 + 2] * input.weight.w;

    skinMat[0] = vec4f(v0.x, v1.x, v2.x, 0.0);
    skinMat[1] = vec4f(v0.y, v1.y, v2.y, 0.0);
    skinMat[2] = vec4f(v0.z, v1.z, v2.z, 0.0);
    skinMat[3] = vec4f(v0.w, v1.w, v2.w, 1.0);
  }

  let worldPos = uniforms.modelView * skinMat * vec4f(input.position, 1.0);
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
    this.bindGroupLayout2 = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: "uniform", hasDynamicOffset: false }
        }
      ]
    });
    const emptyBindGroupLayout1 = this.device.createBindGroupLayout({
      entries: []
    });
    const pipelineLayout = this.createPipelineLayout([
      this.bindGroupLayout,
      emptyBindGroupLayout1,
      this.bindGroupLayout2
    ]);
    this.pipeline = device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module,
        entryPoint: "vsMain",
        buffers: [
          {
            arrayStride: 8 * 4,
            attributes: [
              { shaderLocation: 0, offset: 0, format: "float32x3" },
              { shaderLocation: 1, offset: 3 * 4, format: "float32x3" },
              { shaderLocation: 2, offset: 6 * 4, format: "float32x2" }
            ]
          },
          {
            arrayStride: 8 * 4,
            attributes: [
              { shaderLocation: 3, offset: 0, format: "float32x4" },
              { shaderLocation: 4, offset: 4 * 4, format: "float32x4" }
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
    this.createDefaultBoneBindGroup();
    this.setColor(this.default.color);
    this.setHasBone(this.default.has_bone);
  }

  // Group0（Uniform）BindGroupを返す
  getBindGroup() {
    return this.uniformBindGroup;
  }

  // non-bone draw 用の空 bone bind group を作る
  createDefaultBoneBindGroup() {
    this.defaultBoneBuffer = this.device.createBuffer({
      size: this.BONE_UNIFORM_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    const zeros = new Float32Array(this.BONE_DATA_SIZE);
    this.gpu.queue.writeBuffer(this.defaultBoneBuffer, 0, zeros);
    this.defaultBoneBindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout2,
      entries: [{
        binding: 0,
        resource: { buffer: this.defaultBoneBuffer, size: this.BONE_UNIFORM_SIZE }
      }]
    });
  }

  // group2 の bone palette bind group を返す
  // wireframe でも SmoothShader と同じ group2 を使い、Shape.draw() の差し替えを容易にする
  getBindGroup2(skinSource = null) {
    if (this.uniformData[this.OFF_FLAGS] === 0.0) {
      return this.defaultBoneBindGroup;
    }
    const source = skinSource ?? this.activeSkinSource;
    if (!source) {
      throw new Error("Wireframe requires setMatrixPalette() before drawing with has_bone = 1");
    }
    const entry = this.skinBindGroupCache.get(source);
    if (!entry) {
      throw new Error("Wireframe has no cached bone palette for the current skin source");
    }
    return entry.bindGroup;
  }

  // skeleton ごとの bone buffer / bind group を作る
  ensureSkinEntry(skinSource) {
    let entry = this.skinBindGroupCache.get(skinSource);
    if (entry) {
      return entry;
    }
    const buffer = this.device.createBuffer({
      size: this.BONE_UNIFORM_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    entry = {
      buffer,
      bindGroup: this.device.createBindGroup({
        layout: this.bindGroupLayout2,
        entries: [{
          binding: 0,
          resource: { buffer, size: this.BONE_UNIFORM_SIZE }
        }]
      })
    };
    this.skinBindGroupCache.set(skinSource, entry);
    return entry;
  }

  // non-skinned mesh でも SmoothShader と同じ slot1 layout を満たすための dummy buffer を返す
  getDummySkinVertexBuffer(vertexCount) {
    const capacity = Math.max(1, Number(vertexCount) || 1);
    if (this._dummySkinBuffer && this._dummySkinVertexCapacity >= capacity) {
      return this._dummySkinBuffer;
    }
    this._dummySkinVertexCapacity = capacity;
    const strideFloats = 8;
    const bytes = capacity * strideFloats * Float32Array.BYTES_PER_ELEMENT;
    this._dummySkinBuffer = this.device.createBuffer({
      size: bytes,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    });
    const zeros = new Float32Array(capacity * strideFloats);
    this.gpu.queue.writeBuffer(this._dummySkinBuffer, 0, zeros);
    return this._dummySkinBuffer;
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

  // bone 利用フラグを設定する
  setHasBone(flag) {
    this.uniformData[this.OFF_FLAGS] = flag ? 1.0 : 0.0;
    this.updateUniforms();
  }

  // bone palette を skeleton ごとの専用 buffer へ書き込む
  setMatrixPalette(matrixPalette, skinSource = this.manualSkinSource) {
    if (!matrixPalette) {
      throw new Error("Wireframe.setMatrixPalette requires matrix palette data");
    }
    if (matrixPalette.byteLength > this.BONE_UNIFORM_SIZE) {
      throw new Error("Wireframe received matrix palette data larger than the configured bone buffer");
    }
    const entry = this.ensureSkinEntry(skinSource);
    this.gpu.queue.writeBuffer(
      entry.buffer,
      0,
      matrixPalette.buffer,
      matrixPalette.byteOffset,
      matrixPalette.byteLength
    );
    this.activeSkinSource = skinSource;
  }

  // Shape側パラメータを適用する
  doParameter(param) {
    this.updateParam(param, "color", this.setColor.bind(this));
    this.updateParam(param, "has_bone", this.setHasBone.bind(this));
  }
}
