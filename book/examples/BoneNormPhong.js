// ---------------------------------------------
// BoneNormPhong.js 2026/04/18
//   WebGPU Version
// ---------------------------------------------

'use strict';

import Shader from '../../webg/Shader.js';
import { DEFAULT_MAX_SKIN_BONES, SKIN_MATRIX_FLOATS_PER_BONE, SKIN_MATRIX_VECTORS_PER_BONE, alignTo } from "../../webg/SkinningConfig.js";

export default class BoneNormPhong extends Shader {

  // `BonePhong` のスキニング処理へ `NormPhong` の法線マップ処理を統合した shader を初期化する
  constructor(gpu, options = {}) {
    super(gpu);

    this.MAX_BONES = DEFAULT_MAX_SKIN_BONES;
    this.BONE_DATA_SIZE = this.MAX_BONES * SKIN_MATRIX_FLOATS_PER_BONE;
    this.BONE_VECTOR_COUNT = this.MAX_BONES * SKIN_MATRIX_VECTORS_PER_BONE;

    this.OFF_PROJ   = 0;
    this.OFF_VIEW   = 16;
    this.OFF_NORM   = 32;
    this.OFF_LIGHT  = 48;
    this.OFF_COLOR  = 52;
    this.OFF_PARAMS = 56; // amb/spec/power/emit
    this.OFF_FLAGS  = 60; // hasBone/texFlag/weightDebug/useNormalMap
    this.OFF_NMAP   = 64; // normalStrength/unused/unused/unused
    this.OFF_FOG_COLOR = 68;
    this.OFF_FOG_PARAMS = 72;
    this.OFF_DEBUG_FLAGS = 76; // backfaceDebug/unused/unused/unused
    this.OFF_DEBUG_COLOR = 80; // backfaceColor/unused/unused/unused
    this.OFF_BONES  = 84;

    this.UNIFORM_FLOAT_COUNT = 84 + this.BONE_DATA_SIZE;
    this.UNIFORM_SIZE = this.UNIFORM_FLOAT_COUNT * 4;
    this.uniformStride = alignTo(this.UNIFORM_SIZE, 256);
    this.maxUniforms = 2048;
    this.dynamicOffsetGroup0 = true;

    this.default = {
      color        : [0.8, 0.8, 1.0, 1.0],
      light        : [0.0, 0.0, 100.0, 1],
      use_texture  : 0,
      use_normal_map: 0,
      normal_strength: 1.0,
      emissive     : 0,
      ambient      : 0.3,
      specular     : 0.6,
      power        : 40,
      has_bone     : 0,
      weight_debug : 0,
      texture      : null,
      normal_texture: null,
      fog_color: [0.1, 0.15, 0.1, 1.0],
      fog_near: 20.0,
      fog_far: 80.0,
      fog_density: 0.03,
      fog_mode: 0.0,
      backface_debug: options.backfaceDebug ? 1 : 0,
      backface_color: [1.0, 0.0, 1.0, 1.0]
    };

    this.change = {};
    this.uniformData = new Float32Array(this.UNIFORM_FLOAT_COUNT);
    this._dummySkinBuffer = null;
    this._dummySkinVertexCapacity = 0;
    this.defaultNormalTexture = null;
    this.defaultNormalTextureView = null;
    this.cullMode = options.backfaceDebug ? "none" : (options.cullMode ?? "back");
    this.frontFace = options.frontFace ?? "ccw";

    this.wgslSrc = `
      struct Uniforms {
        projMatrix : mat4x4<f32>,
        viewMatrix : mat4x4<f32>,
        normalMatrix : mat4x4<f32>,
        lightPos   : vec4<f32>,
        color      : vec4<f32>,
        params     : vec4<f32>,  // x=ambient, y=specular, z=power, w=emissive
        flags      : vec4<f32>,  // x=hasBone, y=useTexture, z=weightDebug, w=useNormalMap
        normalMapParams : vec4<f32>, // x=normalStrength
        fogColor   : vec4<f32>,
        fogParams  : vec4<f32>,
        debugFlags : vec4<f32>,  // x=backfaceDebug
        debugColor : vec4<f32>,  // rgb=backfaceColor
        // BonePhong と同じく、1本の bone を vec4 x 3 で持つ圧縮 palette を並べる
        bones      : array<vec4<f32>, ${this.BONE_VECTOR_COUNT}>,
      };

      @group(0) @binding(0) var<uniform> u : Uniforms;
      @group(1) @binding(0) var mySampler: sampler;
      @group(1) @binding(1) var myTexture: texture_2d<f32>;
      // NormPhong との差分:
      // - group(1) binding(2) に normal map 用 texture を追加する
      @group(1) @binding(2) var myNormalTexture: texture_2d<f32>;

      struct VertexInput {
        @location(0) position : vec3<f32>,
        @location(1) normal   : vec3<f32>,
        @location(2) texCoord : vec2<f32>,
        // BonePhong との差分:
        // - location(3)(4) に bone index / weight を追加して skinning 入力を受ける
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

        // BonePhong と同じ分岐:
        // - hasBone=0 のときは単位行列を使い、静的 mesh と同じ経路で描く
        if (u.flags.x == 0.0) {
          mat = mat4x4<f32>(
            vec4<f32>(1.0, 0.0, 0.0, 0.0),
            vec4<f32>(0.0, 1.0, 0.0, 0.0),
            vec4<f32>(0.0, 0.0, 1.0, 0.0),
            vec4<f32>(0.0, 0.0, 0.0, 1.0)
          );
        } else {
          // BonePhong と同じ差分:
          // - 各頂点が参照する最大4本の bone index から、palette 上の開始位置を引く
          let i0 = i32(input.index.x) * 3;
          let i1 = i32(input.index.y) * 3;
          let i2 = i32(input.index.z) * 3;
          let i3 = i32(input.index.w) * 3;

          var v0 : vec4<f32>;
          var v1 : vec4<f32>;
          var v2 : vec4<f32>;

          // 各 bone の 3 行ぶんを weight 付きで合成し、頂点専用の skin 行列をその場で組み立てる
          v0  = u.bones[i0]     * input.weight.x + u.bones[i1]     * input.weight.y;
          v0 += u.bones[i2]     * input.weight.z + u.bones[i3]     * input.weight.w;

          v1  = u.bones[i0 + 1] * input.weight.x + u.bones[i1 + 1] * input.weight.y;
          v1 += u.bones[i2 + 1] * input.weight.z + u.bones[i3 + 1] * input.weight.w;

          v2  = u.bones[i0 + 2] * input.weight.x + u.bones[i1 + 2] * input.weight.y;
          v2 += u.bones[i2 + 2] * input.weight.z + u.bones[i3 + 2] * input.weight.w;

          mat[0] = vec4<f32>(v0.x, v1.x, v2.x, 0.0);
          mat[1] = vec4<f32>(v0.y, v1.y, v2.y, 0.0);
          mat[2] = vec4<f32>(v0.z, v1.z, v2.z, 0.0);
          mat[3] = vec4<f32>(v0.w, v1.w, v2.w, 1.0);
        }

        // フラグメント側の weight_debug で色表示できるよう、先頭3成分だけを varying として渡す
        output.vTexCoord = input.texCoord;
        output.vWeight = input.weight.xyz;

        // position / normal は BonePhong と同じく、skin 済み行列を通してから
        // view / normal 行列へ送る
        let pos4 = u.viewMatrix * mat * vec4<f32>(input.position, 1.0);
        output.vPosition = pos4.xyz;

        let normMat = u.normalMatrix * mat;
        output.vNormal = (normMat * vec4<f32>(input.normal, 0.0)).xyz;

        output.position = u.projMatrix * pos4;
        return output;
      }

      @fragment
      fn fs_main(input : FragmentInput) -> @location(0) vec4<f32> {
        // BonePhong と同じ差分:
        // - weight_debug が有効な間は lighting より先に weight 可視化色を返す
        if (u.flags.z != 0.0) {
          let c = clamp(input.vWeight, vec3<f32>(0.0), vec3<f32>(1.0));
          return vec4<f32>(c, 1.0);
        }

        var finalColor : vec4<f32>;
        var lit_vec : vec3<f32>;
        var diff : f32 = 0.0;
        var Ispec : f32 = 0.0;
        let white = vec3<f32>(1.0, 1.0, 1.0);

        let uAmb = u.params.x;
        let uSpec = u.params.y;
        let uSpecPower = u.params.z;
        let uEmit = u.params.w;

        // NormPhong と同じ差分:
        // - skin 済み頂点法線を基準法線として normal map を重ねる
        var nnormal = normalize(input.vNormal);
        if (u.flags.w != 0.0) {
          // 法線マップのサンプリングは非一様制御フロー制約を避けるため
          // textureSampleLevel(..., 0.0) を使う
          let ntex = textureSampleLevel(myNormalTexture, mySampler, input.vTexCoord, 0.0).xyz * 2.0 - vec3<f32>(1.0, 1.0, 1.0);
          let dp1 = dpdx(input.vPosition);
          let dp2 = dpdy(input.vPosition);
          let duv1 = dpdx(input.vTexCoord);
          let duv2 = dpdy(input.vTexCoord);
          // UVの退化を判定する
          let det = duv1.x * duv2.y - duv1.y * duv2.x;
          if (abs(det) > 1.0e-8) {
            let invDet = 1.0 / det;
            // 微分から接線Tを復元
            var tangent = (dp1 * duv2.y - dp2 * duv1.y) * invDet;
            var bitangent = (-dp1 * duv2.x + dp2 * duv1.x) * invDet;
            let tlen0 = length(tangent);
            let blen0 = length(bitangent);
            if (tlen0 > 1.0e-8 && blen0 > 1.0e-8) {
              tangent = tangent / tlen0;
              bitangent = bitangent / blen0;
              // Nと直交化し、TBNの基底を安定化する
              tangent = tangent - nnormal * dot(nnormal, tangent);
              let tlen1 = length(tangent);
              if (tlen1 > 1.0e-8) {
                tangent = tangent / tlen1;
                // 微分から得た bitangent と、直交化後の tangent / normal から作る bitangent の
                // 向きが食い違うと凹凸が反転するため、handedness を合わせる
                let handedness = select(-1.0, 1.0, dot(cross(nnormal, tangent), bitangent) >= 0.0);
                bitangent = normalize(cross(nnormal, tangent)) * handedness;
                let mapped = normalize(mat3x3<f32>(tangent, bitangent, nnormal) * ntex);
                // 元法線との補間比が normal_strength
                let w = clamp(u.normalMapParams.x, 0.0, 2.0);
                nnormal = normalize(mix(nnormal, mapped, w));
              }
            }
          }
        }

        // 以降の lighting / fog / texture 合成は NormPhong と同じ流れ
        if (u.lightPos.w != 0.0) {
          lit_vec = normalize(u.lightPos.xyz - input.vPosition);
        } else {
          lit_vec = normalize(u.lightPos.xyz);
        }

        let eye_vec = normalize(-input.vPosition);
        let ref_vec = normalize(reflect(-lit_vec, nnormal));

        if (uEmit == 0.0) {
          diff = max(dot(nnormal, lit_vec), 0.0) * (1.0 - uAmb);
          Ispec = uSpec * pow(max(dot(ref_vec, eye_vec), 0.0), uSpecPower);
        } else {
          diff = 1.0 - uAmb;
          Ispec = 0.0;
        }

        if (u.flags.y != 0.0) {
          let texColor = textureSample(myTexture, mySampler, input.vTexCoord);
          finalColor = u.color * texColor;
          finalColor = mix(diff * u.color, finalColor, u.color.w);
        } else {
          finalColor = u.color;
        }

        if (u.debugFlags.x != 0.0 && !input.frontFacing) {
          // 裏面の見え方を一目で区別できるよう、指定色へ切り替える
          return vec4<f32>(u.debugColor.rgb, 1.0);
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
        return vec4<f32>(mix(u.fogColor.rgb, lit.rgb, fogFactor), lit.a);
      }
    `;
  }

  // ボーン対応 + 法線マップ対応Pipeline/BindGroup/Uniformを作成する
  createResources() {
    const device = this.device;
    const shaderModule = this.createShaderModule(this.wgslSrc);

    this.createUniformBuffer(this.uniformStride * this.maxUniforms);

    this.bindGroupLayout0 = this.createUniformBindGroupLayout({
      hasDynamicOffset: true
    });

    this.bindGroupLayout1 = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } }
      ]
    });

    const pipelineLayout = this.createPipelineLayout([
      this.bindGroupLayout0,
      this.bindGroupLayout1
    ]);

    this.pipeline = device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_main',
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

    this.uniformBindGroup = device.createBindGroup({
      layout: this.bindGroupLayout0,
      entries: [{
        binding: 0,
        resource: { buffer: this.uniformBuffer, size: this.UNIFORM_SIZE }
      }]
    });

    this.bindGroup1Cache = new WeakMap();
    this.createDefaultTexture();
    this.createDefaultNormalTexture();

    this.setLightPosition(this.default.light);
    this.setColor(this.default.color);
    this.useTexture(this.default.use_texture);
    this.useNormalMap(this.default.use_normal_map);
    this.setNormalStrength(this.default.normal_strength);
    this.setEmissive(this.default.emissive);
    this.setAmbientLight(this.default.ambient);
    this.setSpecular(this.default.specular);
    this.setSpecularPower(this.default.power);
    this.setHasBone(this.default.has_bone);
    this.setWeightDebug(this.default.weight_debug);
    this.setFogColor(this.default.fog_color);
    this.setFogNear(this.default.fog_near);
    this.setFogFar(this.default.fog_far);
    this.setFogDensity(this.default.fog_density);
    this.setFogMode(this.default.fog_mode);
    this.setBackfaceDebug(this.default.backface_debug);
    this.setBackfaceColor(this.default.backface_color);
  }

  // パイプラインと既定BindGroupをセットする
  useProgram(passEncoder) {
    if (!passEncoder || !this.pipeline) return;
    passEncoder.setPipeline(this.pipeline);
    passEncoder.setBindGroup(0, this.uniformBindGroup);
    passEncoder.setBindGroup(1, this.getBindGroup1(null));
  }

  // ベースカラー用の1x1白テクスチャを作成する
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

  // 法線未指定時の1x1フラット法線テクスチャを作成する
  createDefaultNormalTexture() {
    const bytes = new Uint8Array([128, 128, 255, 255]);
    this.defaultNormalTexture = this.device.createTexture({
      size: [1, 1, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    });
    this.gpu.queue.writeTexture(
      { texture: this.defaultNormalTexture },
      bytes,
      { bytesPerRow: 4 },
      { width: 1, height: 1, depthOrArrayLayers: 1 }
    );
    this.defaultNormalTextureView = this.defaultNormalTexture.createView();

    this.defaultTextureBindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout1,
      entries: [
        { binding: 0, resource: this.defaultSampler },
        { binding: 1, resource: this.defaultTextureView },
        { binding: 2, resource: this.defaultNormalTextureView }
      ]
    });
  }

  // Group0（Uniform）BindGroupを返す
  getBindGroup() {
    return this.uniformBindGroup;
  }

  // Group1（Sampler + BaseTex + NormalTex）BindGroupを返す
  getBindGroup1(texture) {
    const useTexture = this.uniformData[this.OFF_FLAGS + 1] !== 0.0;
    const useNormalMap = this.uniformData[this.OFF_FLAGS + 3] !== 0.0;
    const baseTexture = texture ?? (!useTexture ? this.defaultTexture : null);
    const normalTexture = this.change.normal_texture
      ?? this.default.normal_texture
      ?? (!useNormalMap ? this.defaultNormalTexture : null);
    const baseKey = baseTexture;
    const normalKey = normalTexture;
    const canCacheBase = !!baseKey && (typeof baseKey === "object" || typeof baseKey === "function");
    const canCacheNormal = !!normalKey && (typeof normalKey === "object" || typeof normalKey === "function");

    let level2 = null;
    if (canCacheBase) {
      level2 = this.bindGroup1Cache.get(baseKey);
      if (!level2) {
        level2 = new WeakMap();
        this.bindGroup1Cache.set(baseKey, level2);
      }
    }
    if (level2 && canCacheNormal && level2.has(normalKey)) {
      return level2.get(normalKey);
    }

    const baseRes = this.resolveTextureResources(baseTexture);
    const normalRes = normalTexture
      ? this.resolveTextureResources(normalTexture)
      : { view: undefined, sampler: baseRes.sampler };
    if (!baseRes.view || !baseRes.sampler) {
      throw new Error("BoneNormPhong requires texture and sampler when use_texture is enabled");
    }
    if (useNormalMap && !normalRes.view) {
      throw new Error("BoneNormPhong requires normal_texture when use_normal_map is enabled");
    }

    const bg = this.device.createBindGroup({
      layout: this.bindGroupLayout1,
      entries: [
        { binding: 0, resource: baseRes.sampler },
        { binding: 1, resource: baseRes.view },
        { binding: 2, resource: normalRes.view }
      ]
    });

    if (level2 && canCacheNormal) {
      level2.set(normalKey, bg);
    }
    return bg;
  }

  // 非スキニング描画用のダミースキン頂点バッファを返す
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
    this.projectionMatrix = m.clone();
    this.uniformData.set(m.mat, this.OFF_PROJ);
    this.updateUniforms();
  }

  // モデルビュー行列を設定する
  setModelViewMatrix(m) {
    this.uniformData.set(m.mat, this.OFF_VIEW);
    this.updateUniforms();
  }

  // 法線行列を設定する
  setNormalMatrix(m) {
    this.uniformData.set(m.mat, this.OFF_NORM);
    this.updateUniforms();
  }

  // 光源パラメータを設定する
  setLightPosition(positionAndType) {
    this.uniformData.set(positionAndType, this.OFF_LIGHT);
    this.updateUniforms();
  }

  // ベースカラーを設定する
  setColor(color) {
    this.uniformData.set(color, this.OFF_COLOR);
    this.updateUniforms();
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

  // ベースカラーのテクスチャ利用フラグを設定する
  useTexture(flag) {
    this.uniformData[this.OFF_FLAGS + 1] = flag ? 1.0 : 0.0;
    this.updateUniforms();
  }

  // 頂点ウェイト可視化モードをON/OFFする
  setWeightDebug(flag) {
    this.uniformData[this.OFF_FLAGS + 2] = flag ? 1.0 : 0.0;
    this.updateUniforms();
  }

  // 法線マップ適用フラグを設定する
  useNormalMap(flag) {
    this.uniformData[this.OFF_FLAGS + 3] = flag ? 1.0 : 0.0;
    this.updateUniforms();
  }

  // 法線マップ強度を設定する
  setNormalStrength(value) {
    this.uniformData[this.OFF_NMAP + 0] = value;
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

  // 裏面の色を別色で表示するデバッグモードを設定する
  setBackfaceDebug(flag) {
    this.uniformData[this.OFF_DEBUG_FLAGS + 0] = flag ? 1.0 : 0.0;
    this.updateUniforms();
  }

  // 裏面表示に使う色を設定する
  setBackfaceColor(color) {
    this.uniformData.set(color, this.OFF_DEBUG_COLOR);
    this.updateUniforms();
  }

  // 既存の fog_mode を保ちつつ ON/OFF だけ切り替える
  setUseFog(flag) {
    const fogMode = this.change.fog_mode ?? this.default.fog_mode;
    this.setFogMode(flag ? fogMode : 0.0);
  }

  // `texture` / `normal_texture` を更新する
  updateTexture(param) {
    if (param.texture) this.useTexture(1);
    if (param.texture !== undefined) {
      this.change.texture = param.texture;
    }
    if (param.normal_texture !== undefined) {
      this.change.normal_texture = param.normal_texture;
    }
  }

  // 現状 no-op
  setTextureUnit(_unit) {
    // No-op in WebGPU.
  }

  // ボーン行列パレットをUniformへ書き込む
  setMatrixPalette(matrixPalette) {
    this.uniformData.set(matrixPalette, this.OFF_BONES);
    this.updateUniforms();
  }

  // Shape側パラメータを一括反映する
  doParameter(param) {
    this.updateParam(param, "color", this.setColor);
    this.updateParam(param, "light", this.setLightPosition);
    this.updateParam(param, "use_texture", this.useTexture);
    this.updateParam(param, "use_normal_map", this.useNormalMap);
    this.updateParam(param, "normal_strength", this.setNormalStrength);
    this.updateParam(param, "ambient", this.setAmbientLight);
    this.updateParam(param, "specular", this.setSpecular);
    this.updateParam(param, "power", this.setSpecularPower);
    this.updateParam(param, "emissive", this.setEmissive);
    this.updateParam(param, "has_bone", this.setHasBone);
    this.updateParam(param, "weight_debug", this.setWeightDebug);
    this.updateParam(param, "fog_color", this.setFogColor);
    this.updateParam(param, "fog_near", this.setFogNear);
    this.updateParam(param, "fog_far", this.setFogFar);
    this.updateParam(param, "fog_density", this.setFogDensity);
    this.updateParam(param, "fog_mode", this.setFogMode);
    this.updateParam(param, "use_fog", this.setUseFog);
    this.updateParam(param, "backface_debug", this.setBackfaceDebug);
    this.updateParam(param, "backface_color", this.setBackfaceColor);
    this.updateTexture(param);
  }

  // デフォルト値を更新し対応setterを呼ぶ
  setDefaultParam(key, value) {
    this.default[key] = value;
    if (key === "color") this.setColor(value);
    else if (key === "light") this.setLightPosition(value);
    else if (key === "use_texture") this.useTexture(value);
    else if (key === "use_normal_map") this.useNormalMap(value);
    else if (key === "normal_strength") this.setNormalStrength(value);
    else if (key === "emissive") this.setEmissive(value);
    else if (key === "ambient") this.setAmbientLight(value);
    else if (key === "specular") this.setSpecular(value);
    else if (key === "power") this.setSpecularPower(value);
    else if (key === "has_bone") this.setHasBone(value);
    else if (key === "weight_debug") this.setWeightDebug(value);
    else if (key === "normal_texture") this.change.normal_texture = value;
    else if (key === "fog_color") this.setFogColor(value);
    else if (key === "fog_near") this.setFogNear(value);
    else if (key === "fog_far") this.setFogFar(value);
    else if (key === "fog_density") this.setFogDensity(value);
    else if (key === "fog_mode") this.setFogMode(value);
    else if (key === "use_fog") this.setFogMode(value ? 1.0 : 0.0);
    else if (key === "backface_debug") this.setBackfaceDebug(value);
    else if (key === "backface_color") this.setBackfaceColor(value);
  }
}
