// ---------------------------------------------
// BonePhong.js    2026/10/04
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

'use strict';

import Shader from '../../webg/Shader.js';
import { CAMERA_REVERSE_Z } from '../../webg/DepthConvention.js';
import { DEFAULT_MAX_SKIN_BONES, SKIN_MATRIX_FLOATS_PER_BONE, SKIN_MATRIX_VECTORS_PER_BONE, alignTo } from "../../webg/SkinningConfig.js";

export default class BonePhong extends Shader {

  // 共通上限までのボーン行列パレットを扱うUniform構成とWGSLを初期化する
  constructor(gpu, options = {}) {
    // スキニング対応Phongシェーダ
    // 頂点ごとの boneIndex/weight と matrix palette を使って変形する
    super(gpu);
    
    // 定数定義
    this.MAX_BONES = DEFAULT_MAX_SKIN_BONES;
    // 1本のボーンの行列を3個のvec4として保持し、12個のfloat（48バイト）を使う
    this.BONE_DATA_SIZE = this.MAX_BONES * SKIN_MATRIX_FLOATS_PER_BONE;
    this.BONE_VECTOR_COUNT = this.MAX_BONES * SKIN_MATRIX_VECTORS_PER_BONE;
    
    // 各行列と材質値の格納位置を、Float32Arrayの要素番号として定義する
    // 4×4行列は16個のfloatとして保持する
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

    // 行列、材質、ボーンパレットを含むuniformの総要素数を求める
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
    
    // CPU側でuniform値を組み立てる配列を確保する
    this.uniformData = new Float32Array(this.UNIFORM_FLOAT_COUNT);
    this._dummySkinBuffer = null;
    this._dummySkinVertexCapacity = 0;
    this.cullMode = options.backfaceDebug ? "none" : (options.cullMode ?? "back");
    this.frontFace = options.frontFace ?? "ccw";
    
    // 頂点変形と画素の照明計算を行うWGSLを定義する
    this.wgslSrc = `
      struct Uniforms {
        projMatrix : mat4x4<f32>,
        viewMatrix : mat4x4<f32>,
        normalMatrix : mat4x4<f32>, // mat4の配置規則に合わせて4×4の領域を確保する
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
      // ボーンの影響度で位置と法線を変形し、視点と投影の変換後の値を次の段階へ渡す
      fn vs_main(input : VertexInput) -> VertexOutput {
        var output : VertexOutput;
        var mat : mat4x4<f32>;
        
        // スキニングの有効状態に応じて、単位行列または影響度で合成したボーン行列を選ぶ
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

          // 合成した3行の成分を列単位に並べ直し、WGSLの4×4行列を作る
          mat[0] = vec4<f32>(v0.x, v1.x, v2.x, 0.0);
          mat[1] = vec4<f32>(v0.y, v1.y, v2.y, 0.0);
          mat[2] = vec4<f32>(v0.z, v1.z, v2.z, 0.0);
          mat[3] = vec4<f32>(v0.w, v1.w, v2.w, 1.0);
        }

        output.vTexCoord = input.texCoord;
        output.vWeight = input.weight.xyz;
        
        // スキニング後の位置へモデルビュー行列を掛け、視点空間の座標を求める
        let pos4 = u.viewMatrix * mat * vec4<f32>(input.position, 1.0);
        output.vPosition = pos4.xyz;
        
        // 法線を方向ベクトルとしてボーン行列と法線行列で変換する
        let normMat = u.normalMatrix * mat;
        output.vNormal = (normMat * vec4<f32>(input.normal, 0.0)).xyz;

        output.position = u.projMatrix * pos4;
        return output;
      }

      @fragment
      // 補間された法線と材質からPhong照明を計算し、必要に応じてテクスチャとフォグを反映する
      fn fs_main(input : FragmentInput) -> @location(0) vec4<f32> {
        if (u.flags.z != 0.0) {
          // 最初の3本のボーンの影響度をR、G、Bへ対応させ、重みの分布を色で表示する
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

        // 点光源では画素から光源への方向、平行光では設定済みの光の方向を求める
        if (u.lightPos.w != 0.0) {
          lit_vec = normalize(u.lightPos.xyz - input.vPosition);
        } else {
          lit_vec = normalize(u.lightPos.xyz);
        }

        let eye_vec = normalize(-input.vPosition);
        let ref_vec = normalize(reflect(-lit_vec, nnormal));

        // 材質の環境光、鏡面反射、光沢の指数、発光フラグをuniformから取り出す
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

        // テクスチャ利用フラグに応じて、素材色と画像の色を組み合わせる
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
    // 3) 行列と材質のuniform、およびテクスチャを渡すバインドグループ
    // を構築する
    const device = this.device;

    // 1) WGSLをGPUで実行するシェーダーモジュールを作る
    const shaderModule = this.createShaderModule(this.wgslSrc);

    // 2) 描画ごとの行列と材質値を保持するuniformバッファを作る
    // 複数Shapeを同一RenderPassで描くため、描画ごとのuniformスロットを確保する
    this.createUniformBuffer(this.uniformStride * this.maxUniforms);

    // 3) uniformとテクスチャのバインド位置を定義する
    // グループ0は行列、材質、ボーンパレットを含むuniformを扱う
    this.bindGroupLayout0 = this.createUniformBindGroupLayout({
      hasDynamicOffset: true
    });

    // グループ1はテクスチャとサンプラーを扱う
    this.bindGroupLayout1 = this.createTextureBindGroupLayout({
      samplerBinding: 0,
      textureBinding: 1
    });

    // 4) 二つのバインドグループの構成を描画パイプラインへ渡す
    const pipelineLayout = this.createPipelineLayout([
      this.bindGroupLayout0,
      this.bindGroupLayout1
    ]);

    // 5) 二つの頂点バッファと深度規則を使う描画パイプラインを作る
    this.pipeline = device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_main',
        // スキン付きメッシュのShape.endShape()は属性を二つの頂点バッファへ分ける
        // 第1バッファには位置3成分、法線3成分、UV2成分を格納する
        // 第2バッファにはボーン番号4成分と影響度4成分を格納する
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
        depthCompare: CAMERA_REVERSE_Z.compare,
        format: CAMERA_REVERSE_Z.format
      }
    });

    // 6) uniformバッファをグループ0へ結び付ける
    this.uniformBindGroup = device.createBindGroup({
      layout: this.bindGroupLayout0,
      entries: [{
        binding: 0,
        resource: { buffer: this.uniformBuffer, size: this.UNIFORM_SIZE }
      }]
    });

    this.bindGroup1Cache = new WeakMap();
    this.createDefaultTexture();

    // 環境光を含む材質と照明の既定値を設定し、色など一部の値を指定する例も同じ初期条件で描く
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

  // 静的メッシュ用に影響度が0の補助頂点バッファを用意し、必要な容量を確保して再利用する
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
    this.updateUniforms(); // 行列の更新をuniformバッファへ反映する
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

  // 材質同期用の共通インターフェースとして呼び出し口を保持する
  // このシェーダーの各setterはuniform配列への書き込みとGPUへの反映をその場で行う
  _updateParams() {
    const d = this.default; // 共通の既定材質を参照する
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

  // 既存APIとの共通の呼び出し口としてテクスチャ単位指定を受け付ける
  setTextureUnit(unit) {
    // WebGPUではバインドグループがテクスチャの接続先を管理する
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
