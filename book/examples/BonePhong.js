// ---------------------------------------------
// BonePhong.js    2026/04/12
//   WebGPU Version
// ---------------------------------------------

'use strict';

import Shader from '../../webg/Shader.js';
import { DEFAULT_MAX_SKIN_BONES, SKIN_MATRIX_FLOATS_PER_BONE, SKIN_MATRIX_VECTORS_PER_BONE, alignTo } from "../../webg/SkinningConfig.js";

export default class BonePhong extends Shader {

  // 共通上限までのボーン行列パレットを扱うUniform構成とWGSLを初期化する
  constructor(gpu, options = {}) {
    // スキニング対応Phongシェーダ
    // 頂点ごとの boneIndex/weight と matrix palette を使って変形する
    super(gpu);
    
    // 定数定義
    this.MAX_BONES = DEFAULT_MAX_SKIN_BONES;
    // 1 bone = vec4 x 3 = 12 floats = 48 bytes
    this.BONE_DATA_SIZE = this.MAX_BONES * SKIN_MATRIX_FLOATS_PER_BONE;
    this.BONE_VECTOR_COUNT = this.MAX_BONES * SKIN_MATRIX_VECTORS_PER_BONE;
    
    // Uniform Buffer Layout Offsets (Float32Array index)
    // 1 mat4 = 16 floats
    this.OFF_PROJ   = 0;
    this.OFF_VIEW   = 16;
    this.OFF_NORM   = 32;
    this.OFF_LIGHT  = 48; // vec4
    this.OFF_COLOR  = 52; // vec4
    this.OFF_PARAMS = 56; // vec4 (amb, spec, power, emit)
    this.OFF_FLAGS  = 60; // vec4 (hasBone, texFlag, weightDebug, backfaceDebug)
    this.OFF_FOG_COLOR = 64; // vec4
    this.OFF_FOG_PARAMS = 68; // vec4 (near, far, density, mode)
    this.OFF_BONES  = 72; // vec4 array start

    // Uniform Buffer Size (in floats)
    this.UNIFORM_FLOAT_COUNT = 72 + this.BONE_DATA_SIZE;
    this.UNIFORM_SIZE = this.UNIFORM_FLOAT_COUNT * 4;
    // WebGPUのdynamic offsetは256バイト境界が必要
    this.uniformStride = alignTo(this.UNIFORM_SIZE, 256);
    this.maxUniforms = 2048;
    this.dynamicOffsetGroup0 = true;

    this.default = {
      color      : [0.8, 0.8, 1.0, 1.0], 
      light      : [0.0, 0.0, 100.0, 1], 
      use_texture: 0,
      emissive   : 0, 
      ambient    : 0.3, 
      specular   : 0.6,
      power      : 40, 
      has_bone   : 0,
      weight_debug: 0,
      backface_debug: options.backfaceDebug ? 1 : 0,
      texture    : null,
      fog_color: [0.1, 0.15, 0.1, 1.0],
      fog_near: 20.0,
      fog_far: 80.0,
      fog_density: 0.03,
      fog_mode: 0.0
    };

    this.change = {};
    
    // CPU side buffer for uniforms
    this.uniformData = new Float32Array(this.UNIFORM_FLOAT_COUNT);
    this._dummySkinBuffer = null;
    this._dummySkinVertexCapacity = 0;
    this.cullMode = options.backfaceDebug ? "none" : (options.cullMode ?? "back");
    this.frontFace = options.frontFace ?? "ccw";
    
    // WGSL Shader Code
    this.wgslSrc = `
      struct Uniforms {
        projMatrix : mat4x4<f32>,
        viewMatrix : mat4x4<f32>,
        normalMatrix : mat4x4<f32>, // padding to mat4 alignment
        lightPos   : vec4<f32>,
        color      : vec4<f32>,
        // x: amb, y: spec, z: power, w: emit
        params     : vec4<f32>, 
        // x: hasBone, y: texFlag, z: weightDebug, w: backfaceDebug
        flags      : vec4<f32>,
        fogColor   : vec4<f32>,
        fogParams  : vec4<f32>,
        bones      : array<vec4<f32>, ${this.BONE_VECTOR_COUNT}>,
      };

      @group(0) @binding(0) var<uniform> u : Uniforms;
      @group(1) @binding(0) var mySampler: sampler;
      @group(1) @binding(1) var myTexture: texture_2d<f32>;

      struct VertexInput {
        @location(0) position : vec3<f32>,
        @location(1) normal   : vec3<f32>,
        @location(2) texCoord : vec2<f32>,
        @location(3) index    : vec4<f32>,
        @location(4) weight   : vec4<f32>,
      };

      struct VertexOutput {
        @builtin(position) position : vec4<f32>,
        @location(0) vPosition : vec3<f32>,
        @location(1) vNormal   : vec3<f32>,
        @location(2) vTexCoord : vec2<f32>,
        @location(3) vWeight   : vec3<f32>,
      };

      struct FragmentInput {
        @location(0) vPosition : vec3<f32>,
        @location(1) vNormal   : vec3<f32>,
        @location(2) vTexCoord : vec2<f32>,
        @location(3) vWeight   : vec3<f32>,
        @builtin(front_facing) frontFacing : bool,
      };

      @vertex
      fn vs_main(input : VertexInput) -> VertexOutput {
        var output : VertexOutput;
        var mat : mat4x4<f32>;
        
        // Bone Calculation
        if (u.flags.x == 0.0) {
          mat = mat4x4<f32>(
            vec4<f32>(1.0, 0.0, 0.0, 0.0),
            vec4<f32>(0.0, 1.0, 0.0, 0.0),
            vec4<f32>(0.0, 0.0, 1.0, 0.0),
            vec4<f32>(0.0, 0.0, 0.0, 1.0)
          );
        } else {
          let i0 = i32(input.index.x) * 3;
          let i1 = i32(input.index.y) * 3;
          let i2 = i32(input.index.z) * 3;
          let i3 = i32(input.index.w) * 3;

          var v0 : vec4<f32>;
          var v1 : vec4<f32>;
          var v2 : vec4<f32>;

          v0  = u.bones[i0]     * input.weight.x + u.bones[i1]     * input.weight.y;
          v0 += u.bones[i2]     * input.weight.z + u.bones[i3]     * input.weight.w;
          
          v1  = u.bones[i0 + 1] * input.weight.x + u.bones[i1 + 1] * input.weight.y;
          v1 += u.bones[i2 + 1] * input.weight.z + u.bones[i3 + 1] * input.weight.w;
          
          v2  = u.bones[i0 + 2] * input.weight.x + u.bones[i1 + 2] * input.weight.y;
          v2 += u.bones[i2 + 2] * input.weight.z + u.bones[i3 + 2] * input.weight.w;

          // Construct matrix (Column-Major) from computed rows
          mat[0] = vec4<f32>(v0.x, v1.x, v2.x, 0.0);
          mat[1] = vec4<f32>(v0.y, v1.y, v2.y, 0.0);
          mat[2] = vec4<f32>(v0.z, v1.z, v2.z, 0.0);
          mat[3] = vec4<f32>(v0.w, v1.w, v2.w, 1.0);
        }

        output.vTexCoord = input.texCoord;
        output.vWeight = input.weight.xyz;
        
        // World Position
        let pos4 = u.viewMatrix * mat * vec4<f32>(input.position, 1.0);
        output.vPosition = pos4.xyz;
        
        // Normal (Using mat3 logic on mat4 data)
        let normMat = u.normalMatrix * mat;
        output.vNormal = (normMat * vec4<f32>(input.normal, 0.0)).xyz;

        output.position = u.projMatrix * pos4;
        return output;
      }

      @fragment
      fn fs_main(input : FragmentInput) -> @location(0) vec4<f32> {
        if (u.flags.z != 0.0) {
          // weight debug color: R=w0, G=w1, B=w2.
          let c = clamp(input.vWeight, vec3<f32>(0.0), vec3<f32>(1.0));
          return vec4<f32>(c, 1.0);
        }
        let backfaceDebug = u.flags.w;
        var finalColor : vec4<f32>;
        var lit_vec : vec3<f32>;
        var diff : f32 = 0.0;
        var Ispec : f32 = 0.0;
        let white = vec3<f32>(1.0, 1.0, 1.0);
        let nnormal = normalize(input.vNormal);

        // Light Position Logic
        if (u.lightPos.w != 0.0) {
          lit_vec = normalize(u.lightPos.xyz - input.vPosition);
        } else {
          lit_vec = normalize(u.lightPos.xyz);
        }

        let eye_vec = normalize(-input.vPosition);
        let ref_vec = normalize(reflect(-lit_vec, nnormal));

        // Unpack params
        let uAmb = u.params.x;
        let uSpec = u.params.y;
        let uSpecPower = u.params.z;
        let uEmit = u.params.w;

        if (uEmit == 0.0) {
          diff = max(dot(nnormal, lit_vec), 0.0) * (1.0 - uAmb);
          Ispec = uSpec * pow(max(dot(ref_vec, eye_vec), 0.0), uSpecPower);
        } else {
          diff = 1.0 - uAmb;
          Ispec = 0.0;
        }

        // Texture Logic
        if (u.flags.y != 0.0) {
           let texColor = textureSample(myTexture, mySampler, input.vTexCoord);
           finalColor = u.color * texColor;
           finalColor = mix(diff * u.color, finalColor, u.color.w);
        } else {
           finalColor = u.color;
        }

        let rgb = finalColor.rgb * (uAmb + diff) + white * Ispec;
        let lit = vec4<f32>(rgb, 1.0);
        let fogDistance = length(input.vPosition);
        let fogNear = u.fogParams.x;
        let fogFar = u.fogParams.y;
        let fogDensity = u.fogParams.z;
        let fogMode = u.fogParams.w;
        var fogFactor = 1.0;
        if (fogMode > 0.5 && fogMode < 1.5) {
          let fogRange = max(fogFar - fogNear, 0.0001);
          let linearFactor = clamp((fogFar - fogDistance) / fogRange, 0.0, 1.0);
          let linearWeight = clamp(fogDensity * 50.0, 0.0, 1.0);
          fogFactor = 1.0 - (1.0 - linearFactor) * linearWeight;
        } else if (fogMode >= 1.5) {
          fogFactor = clamp(exp(-fogDensity * fogDistance), 0.0, 1.0);
        }
        if (backfaceDebug > 0.5 && !input.frontFacing) {
          return vec4<f32>(1.0, 0.0, 1.0, 1.0);
        }
        return vec4<f32>(mix(u.fogColor.rgb, lit.rgb, fogFactor), lit.a);
      }
    `;
  }

  // ボーン対応Pipeline（2頂点バッファ）とBindGroupを作成する
  createResources() {
    // BonePhong専用の:
    // 1) シェーダ
    // 2) 2系統頂点バッファレイアウト
    // 3) uniform/bone/texture bind group
    // を構築する
    const device = this.device;

    // 1. Create Shader Module
    const shaderModule = this.createShaderModule(this.wgslSrc);

    // 2. Create Uniform Buffer
    // 複数Shapeを同一RenderPassで描くため、描画ごとのuniformスロットを確保する
    this.createUniformBuffer(this.uniformStride * this.maxUniforms);

    // 3. Create Bind Group Layouts
    // Group 0: Uniforms
    this.bindGroupLayout0 = this.createUniformBindGroupLayout({
      hasDynamicOffset: true
    });

    // Group 1: Texture (Sampler + TextureView)
    this.bindGroupLayout1 = this.createTextureBindGroupLayout({
      samplerBinding: 0,
      textureBinding: 1
    });

    // 4. Create Pipeline Layout
    const pipelineLayout = this.createPipelineLayout([
      this.bindGroupLayout0,
      this.bindGroupLayout1
    ]);

    // 5. Create Render Pipeline
    this.pipeline = device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_main',
        // Shape.endShape() for skinned meshes builds two vertex buffers:
        // - vertexBuffer0: pos(3) normal(3) uv(2)
        // - vertexBuffer1: boneIndex(4) weight(4)
        buffers: [
          {
            arrayStride: 8 * 4,
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' },
              { shaderLocation: 1, offset: 3 * 4, format: 'float32x3' },
              { shaderLocation: 2, offset: 6 * 4, format: 'float32x2' }
            ]
          },
          {
            arrayStride: 8 * 4,
            attributes: [
              { shaderLocation: 3, offset: 0, format: 'float32x4' },
              { shaderLocation: 4, offset: 4 * 4, format: 'float32x4' }
            ]
          }
        ]
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_main',
        targets: [{
          format: this.gpu.format,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }
          }
        }]
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: this.cullMode,
        frontFace: this.frontFace
      },
      depthStencil: {
        depthWriteEnabled: true,
        depthCompare: 'less',
        format: 'depth24plus'
      }
    });

    // 6. Create BindGroup 0 (Uniforms)
    this.uniformBindGroup = device.createBindGroup({
      layout: this.bindGroupLayout0,
      entries: [{
        binding: 0,
        resource: { buffer: this.uniformBuffer, size: this.UNIFORM_SIZE }
      }]
    });

    this.bindGroup1Cache = new WeakMap();
    this.createDefaultTexture();

    // Initialize material/light defaults so samples that only set a subset
    // of parameters (e.g. color + texture flag) do not end up with zero ambient.
    this.setLightPosition(this.default.light);
    this.setColor(this.default.color);
    this.useTexture(this.default.use_texture);
    this.setEmissive(this.default.emissive);
    this.setAmbientLight(this.default.ambient);
    this.setSpecular(this.default.specular);
    this.setSpecularPower(this.default.power);
    this.setHasBone(this.default.has_bone);
    this.setWeightDebug(this.default.weight_debug);
    this.setBackfaceDebug(this.default.backface_debug);
    this.setFogColor(this.default.fog_color);
    this.setFogNear(this.default.fog_near);
    this.setFogFar(this.default.fog_far);
    this.setFogDensity(this.default.fog_density);
    this.setFogMode(this.default.fog_mode);
  }

  // パイプラインをセットし描画前状態を整える
  useProgram(passEncoder) {
    if (!passEncoder || !this.pipeline) return;
    passEncoder.setPipeline(this.pipeline);
    passEncoder.setBindGroup(0, this.uniformBindGroup);
    passEncoder.setBindGroup(1, this.getBindGroup1(null));
  }

  // デフォルト白テクスチャを作る
  createDefaultTexture() {
    // テクスチャ未指定時のフォールバック(1x1)を用意する
    const defaultTextureInfo = super.createDefaultTexture({
      width: 1,
      height: 1,
      samplerDescriptor: {
        magFilter: "linear",
        minFilter: "linear",
        mipmapFilter: "linear"
      }
    });
    this.defaultTextureBindGroup = this.getOrCreateTexturedBindGroup({
      texture: defaultTextureInfo,
      layout: this.bindGroupLayout1,
      cache: null,
      uniformBuffer: null,
      textureBinding: 1,
      samplerBinding: 0
    });
  }

  // Group0（Uniform）BindGroupを返す
  getBindGroup() {
    // group(0): uniform buffer のみ
    return this.uniformBindGroup;
  }

  // Group1（Sampler/Texture）BindGroupを返す
  getBindGroup1(texture) {
    const useTexture = this.uniformData[this.OFF_FLAGS + 1] !== 0.0;
    if (!texture && !useTexture) return this.defaultTextureBindGroup;
    return this.getOrCreateTexturedBindGroup({
      texture,
      cache: this.bindGroup1Cache,
      layout: this.bindGroupLayout1,
      uniformBuffer: null,
      textureBinding: 1,
      samplerBinding: 0
    });
  }

  getDummySkinVertexBuffer(vertexCount) {
    if (vertexCount <= 0) vertexCount = 1;
    if (this._dummySkinBuffer && this._dummySkinVertexCapacity >= vertexCount) {
      return this._dummySkinBuffer;
    }
    this._dummySkinVertexCapacity = vertexCount;
    const strideFloats = 8;
    const bytes = vertexCount * strideFloats * Float32Array.BYTES_PER_ELEMENT;
    this._dummySkinBuffer = this.device.createBuffer({
      size: bytes,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    });
    const zeros = new Float32Array(vertexCount * strideFloats);
    this.gpu.queue.writeBuffer(this._dummySkinBuffer, 0, zeros);
    return this._dummySkinBuffer;
  }

  // 射影行列を設定する

  setProjectionMatrix(m) {
    // 投影行列をuniformへ反映
    this.projectionMatrix = m.clone();
    this.uniformData.set(m.mat, this.OFF_PROJ);
    this.updateUniforms(); // Consider batching updates if performance is key
  }

  // モデルビュー行列を設定する
  setModelViewMatrix(m) {
    // モデルビュー行列をuniformへ反映
    this.uniformData.set(m.mat, this.OFF_VIEW);
    this.updateUniforms();
  }

  // 法線行列を設定する
  setNormalMatrix(m) {
    // 法線行列をuniformへ反映
    this.uniformData.set(m.mat, this.OFF_NORM);
    this.updateUniforms();
  }

  // 光源パラメータを設定する
  setLightPosition(positionAndType) {
    // positionAndType: [x, y, z, type]
    this.uniformData.set(positionAndType, this.OFF_LIGHT);
    this.updateUniforms();
  }

  // ベースカラーを設定する
  setColor(color) {
    this.uniformData.set(color, this.OFF_COLOR);
    this.updateUniforms();
  }

  // 材質/フラグの内部同期を行う
  _updateParams() {
    const d = this.default; // Fallback to current values
    // Logic needs to track current state since setters are individual.
    // Using `this.change` or `this.default` from base class strategy.
    
    // Simplification: We write directly to buffer memory
    // Buffer layout: x: amb, y: spec, z: power, w: emit
    // Note: We need to store these values to re-pack them because they are set individually.
    // Let's assume we read from uniformData (not ideal but works if initialized) or store local cache.
  }

  // 環境光係数を設定する
  setAmbientLight(intensity) {
    this.uniformData[this.OFF_PARAMS + 0] = intensity;
    this.updateUniforms();
  }

  // 鏡面反射係数を設定する
  setSpecular(intensity) {
    this.uniformData[this.OFF_PARAMS + 1] = intensity;
    this.updateUniforms();
  }

  // 鏡面指数を設定する
  setSpecularPower(power) {
    this.uniformData[this.OFF_PARAMS + 2] = power;
    this.updateUniforms();
  }

  // 発光フラグを設定する
  setEmissive(flag) {
    this.uniformData[this.OFF_PARAMS + 3] = flag ? 1.0 : 0.0;
    this.updateUniforms();
  }

  // スキニング有効フラグを設定する
  setHasBone(flag) {
    this.uniformData[this.OFF_FLAGS + 0] = flag ? 1.0 : 0.0;
    this.updateUniforms();
  }

  // テクスチャ利用フラグを設定する
  useTexture(flag) {
    this.uniformData[this.OFF_FLAGS + 1] = flag ? 1.0 : 0.0;
    this.updateUniforms();
  }

  // 頂点ウェイト可視化モードをON/OFFする
  setWeightDebug(flag) {
    this.uniformData[this.OFF_FLAGS + 2] = flag ? 1.0 : 0.0;
    this.updateUniforms();
  }

  // 裏面をマゼンタで表示するデバッグモードを設定する
  setBackfaceDebug(flag) {
    this.uniformData[this.OFF_FLAGS + 3] = flag ? 1.0 : 0.0;
    this.updateUniforms();
  }

  // フォグ色 `[r,g,b,a]` を設定する
  setFogColor(color) {
    this.uniformData.set(color, this.OFF_FOG_COLOR);
    this.updateUniforms();
  }

  // 線形フォグ開始距離を設定する
  setFogNear(value) {
    this.uniformData[this.OFF_FOG_PARAMS + 0] = value;
    this.updateUniforms();
  }

  // 線形フォグ終了距離を設定する
  setFogFar(value) {
    this.uniformData[this.OFF_FOG_PARAMS + 1] = value;
    this.updateUniforms();
  }

  // 指数フォグ密度を設定する
  setFogDensity(value) {
    this.uniformData[this.OFF_FOG_PARAMS + 2] = value;
    this.updateUniforms();
  }

  // フォグモードを設定する 0=off 1=linear 2=exp
  setFogMode(value) {
    this.uniformData[this.OFF_FOG_PARAMS + 3] = value;
    this.updateUniforms();
  }

  // 既存の fog_mode を保ちつつ ON/OFF だけ切り替える
  setUseFog(flag) {
    const fogMode = this.change.fog_mode ?? this.default.fog_mode;
    this.setFogMode(flag ? fogMode : 0.0);
  }

  // テクスチャ関連パラメータを適用する

  updateTexture(param) {
    if (param.texture) this.useTexture(1);
  }

  // 現状 no-op
  setTextureUnit(unit) {
    // Not needed in WebGPU (BindGroups handle binding), 
    // but kept for API compatibility if logic relies on it.
  }

  // ボーン行列パレットをUniformへ書き込む

  setMatrixPalette(matrixPalette) {
    // Skeleton側で更新された行列パレットをuniform配列へコピーする
    this.uniformData.set(matrixPalette, this.OFF_BONES);
    this.updateUniforms();
  }

  // Shape側パラメータを一括反映する

  doParameter(param) {
    // Shape.shaderParameter を既定値付きでまとめて反映する
    this.updateParam(param, "color", this.setColor);
    this.updateParam(param, "light", this.setLightPosition);
    this.updateParam(param, "use_texture", this.useTexture);
    this.updateParam(param, "ambient", this.setAmbientLight);
    this.updateParam(param, "specular", this.setSpecular);
    this.updateParam(param, "power", this.setSpecularPower);
    this.updateParam(param, "emissive", this.setEmissive);
    this.updateParam(param, "has_bone", this.setHasBone);
    this.updateParam(param, "weight_debug", this.setWeightDebug);
    this.updateParam(param, "backface_debug", this.setBackfaceDebug);
    this.updateParam(param, "fog_color", this.setFogColor);
    this.updateParam(param, "fog_near", this.setFogNear);
    this.updateParam(param, "fog_far", this.setFogFar);
    this.updateParam(param, "fog_density", this.setFogDensity);
    this.updateParam(param, "fog_mode", this.setFogMode);
    this.updateParam(param, "use_fog", this.setUseFog);
    this.updateTexture(param);
  }

  // デフォルト値を更新し対応setterを呼ぶ
  setDefaultParam(key, value) {
    this.default[key] = value;
    if (key === "color") this.setColor(value);
    else if (key === "light") this.setLightPosition(value);
    else if (key === "use_texture") this.useTexture(value);
    else if (key === "emissive") this.setEmissive(value);
    else if (key === "ambient") this.setAmbientLight(value);
    else if (key === "specular") this.setSpecular(value);
    else if (key === "power") this.setSpecularPower(value);
    else if (key === "has_bone") this.setHasBone(value);
    else if (key === "weight_debug") this.setWeightDebug(value);
    else if (key === "backface_debug") this.setBackfaceDebug(value);
    else if (key === "fog_color") this.setFogColor(value);
    else if (key === "fog_near") this.setFogNear(value);
    else if (key === "fog_far") this.setFogFar(value);
    else if (key === "fog_density") this.setFogDensity(value);
    else if (key === "fog_mode") this.setFogMode(value);
    else if (key === "use_fog") this.setFogMode(value ? 1.0 : 0.0);
  }
};
