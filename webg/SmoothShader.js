// ---------------------------------------------
// SmoothShader.js 2026/07/23
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

'use strict';

import Shader from './Shader.js';
import { CAMERA_REVERSE_Z } from "./DepthConvention.js";
import {
  DEFAULT_MAX_SKIN_BONES,
  SKIN_MATRIX_FLOATS_PER_BONE,
  SKIN_MATRIX_VECTORS_PER_BONE,
  alignTo
} from "./SkinningConfig.js";

export default class SmoothShader extends Shader {

  // shader warning は app diagnostics へ直接流さず、
  // console 上で原因を追えるようにしつつ同じ文言の連投だけ抑える
  static warnedMessages = new Set();

  // 同一 parameter / 値の warning を 1 回だけ console へ出す
  warnOnce(message, dedupeKey = message) {
    const key = String(dedupeKey ?? message);
    if (SmoothShader.warnedMessages.has(key)) {
      return false;
    }
    SmoothShader.warnedMessages.add(key);
    console.warn(String(message));
    return true;
  }

  // 0.0-1.0 の係数 parameter は warning を出しつつ clip して継続する
  // shader 設定値の軽い範囲逸脱で描画全体を止めず、何が clip されたかは明示的に残す
  clipUnitIntervalParameter(value, label) {
    if (!Number.isFinite(value)) {
      throw new Error(`SmoothShader ${label} must be a finite number`);
    }
    const numeric = Number(value);
    if (numeric >= 0.0 && numeric <= 1.0) {
      return numeric;
    }
    const clipped = Math.min(1.0, Math.max(0.0, numeric));
    this.warnOnce(
      `SmoothShader ${label}=${numeric} is outside 0.0 - 1.0; clipped to ${clipped}`,
      `SmoothShader:${label}:${numeric}->${clipped}`
    );
    return clipped;
  }

  // 非負値 parameter は warning を出しつつ 0.0 へ clip して継続する
  clipNonNegativeParameter(value, label) {
    if (!Number.isFinite(value)) {
      throw new Error(`SmoothShader ${label} must be a finite number`);
    }
    const numeric = Number(value);
    if (numeric >= 0.0) {
      return numeric;
    }
    this.warnOnce(
      `SmoothShader ${label}=${numeric} is below 0.0; clipped to 0.0`,
      `SmoothShader:${label}:${numeric}->0`
    );
    return 0.0;
  }

  // smooth shading 用の共通 shader を初期化する
  // static mesh / skinned mesh / normal map の有無を 1 本で扱うが、
  // per-draw uniform と bone palette は別 buffer / 別 bind group に分ける
  constructor(gpu, options = {}) {
    super(gpu);

    this.MAX_BONES = DEFAULT_MAX_SKIN_BONES;
    this.BONE_DATA_SIZE = this.MAX_BONES * SKIN_MATRIX_FLOATS_PER_BONE;
    this.BONE_VECTOR_COUNT = this.MAX_BONES * SKIN_MATRIX_VECTORS_PER_BONE;
    this.BONE_UNIFORM_SIZE = this.BONE_DATA_SIZE * Float32Array.BYTES_PER_ELEMENT;

    this.OFF_PROJ = 0;
    this.OFF_VIEW = 16;
    this.OFF_NORM = 32;
    this.OFF_LIGHT = 48;
    this.OFF_COLOR = 52;
    this.OFF_MULTIPLY_COLOR = 56;
    this.OFF_ADD_COLOR = 60;
    this.OFF_PARAMS = 64; // ambient/specular/power/emissive
    this.OFF_FLAGS = 68; // hasBone/useTexture/weightDebug/useNormalMap
    this.OFF_NMAP = 72; // normalStrength/alpha/roughness/unused
    this.OFF_FOG_COLOR = 76;
    this.OFF_FOG_PARAMS = 80;
    this.OFF_DEBUG_FLAGS = 84; // backfaceDebug/unused/unused/unused
    this.OFF_DEBUG_COLOR = 88; // backfaceColor/unused/unused/unused

    this.UNIFORM_FLOAT_COUNT = 92;
    this.UNIFORM_SIZE = this.UNIFORM_FLOAT_COUNT * Float32Array.BYTES_PER_ELEMENT;
    this.uniformStride = alignTo(this.UNIFORM_SIZE, 256);
    this.maxUniforms = 2048;
    this.dynamicOffsetGroup0 = true;

    this.backgroundFrost = options.backgroundFrost === true;
    // Roughness mask用shaderは透明面の色を出さず、material roughnessだけをRenderTargetへ記録する
    // roughnessSpecularは透明forward描画でroughnessをPhong鏡面指数とピーク強度へ反映する
    this.roughnessMask = options.roughnessMask === true;
    this.roughnessSpecular = options.roughnessSpecular === true;
    this.backgroundFrostBindGroupLayout = null;
    this.backgroundFrostBindGroup = null;
    this.backgroundFrostTextureView = null;

    this.default = {
      color: [0.8, 0.8, 1.0, 1.0],
      multiplyColor: [1.0, 1.0, 1.0, 1.0],
      addColor: [0.0, 0.0, 0.0, 0.0],
      light: [0.0, 0.0, 100.0, 1.0],
      use_texture: 0,
      use_normal_map: 0,
      normal_strength: 1.0,
      // color[3]は既存texture混合の意味を保ち、描画透明度は独立したalphaで指定する
      alpha: 1.0,
      // Frost用SmoothShaderでは、roughness省略時に従来の透明表示を変えない
      // 明示値があるmaterialだけが背景ぼかしへ参加する
      roughness: (this.backgroundFrost || this.roughnessMask) ? 0.04 : 0.46,
      emissive: 0,
      ambient: 0.3,
      specular: 0.6,
      power: 40.0,
      has_bone: 0,
      weight_debug: 0,
      texture: null,
      normal_texture: null,
      fog_color: [0.1, 0.15, 0.1, 1.0],
      fog_near: 20.0,
      fog_far: 80.0,
      fog_density: 0.03,
      fog_mode: 0.0,
      flat_shading: 0,
      backface_debug: options.backfaceDebug ? 1 : 0,
      backface_color: [1.0, 0.0, 1.0, 1.0]
    };

    this.change = {};
    this.uniformData = new Float32Array(this.UNIFORM_FLOAT_COUNT);
    this.bindGroup1Cache = new WeakMap();
    this.skinBindGroupCache = new WeakMap();
    this.skinEntryList = [];
    this.defaultNormalTexture = null;
    this.defaultNormalTextureView = null;
    this.defaultTextureBindGroup = null;
    this.defaultBoneBuffer = null;
    this.defaultBoneBindGroup = null;
    this.manualSkinSource = {};
    this.activeSkinSource = null;
    this._dummySkinBuffer = null;
    this._dummySkinVertexCapacity = 0;

    this.cullMode = options.backfaceDebug ? "none" : (options.cullMode ?? "back");
    this.frontFace = options.frontFace ?? "ccw";
    this.depthWriteEnabled = options.depthWriteEnabled ?? true;
    this.depthCompare = CAMERA_REVERSE_Z.compare;
    this.colorFormat = options.colorFormat ?? this.gpu.format;
    this.translucentPipeline = null;

    this.wgslSrc = `
      struct DrawUniforms {
        projMatrix : mat4x4<f32>,
        viewMatrix : mat4x4<f32>,
        normalMatrix : mat4x4<f32>,
        lightPos : vec4<f32>,
        color : vec4<f32>,
        multiplyColor : vec4<f32>,
        addColor : vec4<f32>,
        params : vec4<f32>,
        flags : vec4<f32>,
        normalMapParams : vec4<f32>,
        fogColor : vec4<f32>,
        fogParams : vec4<f32>,
        debugFlags : vec4<f32>,
        debugColor : vec4<f32>,
      };

      struct SkinUniforms {
        bones : array<vec4<f32>, ${this.BONE_VECTOR_COUNT}>,
      };

      @group(0) @binding(0) var<uniform> u : DrawUniforms;
      @group(1) @binding(0) var mySampler : sampler;
      @group(1) @binding(1) var myTexture : texture_2d<f32>;
      @group(1) @binding(2) var myNormalTexture : texture_2d<f32>;
      @group(2) @binding(0) var<uniform> skin : SkinUniforms;
      ${this.backgroundFrost ? `
      // 透明合成前のHDR sceneを一度だけぼかしたtexture
      // fragmentごとのmaterial roughnessでsurface色との混合率を決める
      @group(3) @binding(0) var frostBackgroundTexture : texture_2d<f32>;
      ` : ""}

      struct VertexInput {
        @location(0) position : vec3<f32>,
        @location(1) normal : vec3<f32>,
        @location(2) texCoord : vec2<f32>,
        @location(3) index : vec4<f32>,
        @location(4) weight : vec4<f32>,
      };

      struct VertexOutput {
        @builtin(position) position : vec4<f32>,
        @location(0) vPosition : vec3<f32>,
        @location(1) vNormal : vec3<f32>,
        @location(2) vTexCoord : vec2<f32>,
        @location(3) vWeight : vec3<f32>,
      };

      struct FragmentInput {
        @builtin(position) fragPosition : vec4<f32>,
        @location(0) vPosition : vec3<f32>,
        @location(1) vNormal : vec3<f32>,
        @location(2) vTexCoord : vec2<f32>,
        @location(3) vWeight : vec3<f32>,
        @builtin(front_facing) frontFacing : bool,
      };

      @vertex
      fn vs_main(input : VertexInput) -> VertexOutput {
        var output : VertexOutput;
        var skinMat : mat4x4<f32>;

        if (u.flags.x == 0.0) {
          skinMat = mat4x4<f32>(
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

          v0  = skin.bones[i0] * input.weight.x + skin.bones[i1] * input.weight.y;
          v0 += skin.bones[i2] * input.weight.z + skin.bones[i3] * input.weight.w;

          v1  = skin.bones[i0 + 1] * input.weight.x + skin.bones[i1 + 1] * input.weight.y;
          v1 += skin.bones[i2 + 1] * input.weight.z + skin.bones[i3 + 1] * input.weight.w;

          v2  = skin.bones[i0 + 2] * input.weight.x + skin.bones[i1 + 2] * input.weight.y;
          v2 += skin.bones[i2 + 2] * input.weight.z + skin.bones[i3 + 2] * input.weight.w;

          skinMat[0] = vec4<f32>(v0.x, v1.x, v2.x, 0.0);
          skinMat[1] = vec4<f32>(v0.y, v1.y, v2.y, 0.0);
          skinMat[2] = vec4<f32>(v0.z, v1.z, v2.z, 0.0);
          skinMat[3] = vec4<f32>(v0.w, v1.w, v2.w, 1.0);
        }

        output.vTexCoord = input.texCoord;
        output.vWeight = input.weight.xyz;

        let pos4 = u.viewMatrix * skinMat * vec4<f32>(input.position, 1.0);
        output.vPosition = pos4.xyz;

        let normMat = u.normalMatrix * skinMat;
        output.vNormal = (normMat * vec4<f32>(input.normal, 0.0)).xyz;

        output.position = u.projMatrix * pos4;
        return output;
      }

      @fragment
      fn fs_main(input : FragmentInput) -> @location(0) vec4<f32> {
        if (u.flags.z != 0.0) {
          let c = clamp(input.vWeight, vec3<f32>(0.0), vec3<f32>(1.0));
          return vec4<f32>(c, 1.0);
        }

        ${this.roughnessMask ? `
        // 透明面のAlphaやsurface色を混ぜず、material roughnessだけをmaskへ記録する
        // RenderTarget側のmax blendにより透明面が重なるpixelでは最大roughnessが残る
        let maskRoughness = clamp(u.normalMapParams.z, 0.04, 1.0);
        return vec4<f32>(maskRoughness, maskRoughness, maskRoughness, 1.0);
        ` : `

        // roughness mask variantではこの通常照明部分をWGSLへ生成しません
        // 無条件returnの後へ不要なコードを連結せず、compilerのunreachable警告を防ぎます
        let uAmb = u.params.x;
        let uSpec = u.params.y;
        let uSpecPower = u.params.z;
        let uEmit = u.params.w;

        var nnormal = normalize(input.vNormal);
        if (u.debugFlags.y != 0.0) {
          // flat_shading では、補間済み頂点法線ではなく
          // 現在 fragment が属する三角形の面法線を微分から再構成する
          // frontFacing に合わせて向きをそろえ、両面描画でも陰影を安定させる
          let facing = select(-1.0, 1.0, input.frontFacing);
          nnormal = normalize(cross(dpdy(input.vPosition), dpdx(input.vPosition))) * facing;
        }
        if (u.flags.w != 0.0) {
          // 接線属性を持たない mesh でも normal map を使えるよう、
          // fragment 微分から TBN を再構成して接線空間法線を view 空間へ戻す
          let ntex = textureSampleLevel(myNormalTexture, mySampler, input.vTexCoord, 0.0).xyz * 2.0 - vec3<f32>(1.0, 1.0, 1.0);
          let dp1 = dpdx(input.vPosition);
          let dp2 = dpdy(input.vPosition);
          let duv1 = dpdx(input.vTexCoord);
          let duv2 = dpdy(input.vTexCoord);
          let det = duv1.x * duv2.y - duv1.y * duv2.x;
          if (abs(det) > 1.0e-8) {
            let invDet = 1.0 / det;
            var tangent = (dp1 * duv2.y - dp2 * duv1.y) * invDet;
            var bitangent = (-dp1 * duv2.x + dp2 * duv1.x) * invDet;
            let tlen0 = length(tangent);
            let blen0 = length(bitangent);
            if (tlen0 > 1.0e-8 && blen0 > 1.0e-8) {
              tangent = tangent / tlen0;
              bitangent = bitangent / blen0;
              tangent = tangent - nnormal * dot(nnormal, tangent);
              let tlen1 = length(tangent);
              if (tlen1 > 1.0e-8) {
                tangent = tangent / tlen1;
                // 微分から得た bitangent と、直交化後の tangent / normal から作る bitangent の
                // 向きが食い違うと凹凸が反転するため、handedness をここで合わせる
                let handedness = select(-1.0, 1.0, dot(cross(nnormal, tangent), bitangent) >= 0.0);
                bitangent = normalize(cross(nnormal, tangent)) * handedness;
                let mapped = normalize(mat3x3<f32>(tangent, bitangent, nnormal) * ntex);
                let w = clamp(u.normalMapParams.x, 0.0, 2.0);
                nnormal = normalize(mix(nnormal, mapped, w));
              }
            }
          }
        }
 
        var litVec : vec3<f32>;
        if (u.lightPos.w != 0.0) {
          litVec = normalize(u.lightPos.xyz - input.vPosition);
        } else {
          litVec = normalize(u.lightPos.xyz);
        }

        let eyeVec = normalize(-input.vPosition);
        let refVec = normalize(reflect(-litVec, nnormal));

        let litDiff = max(dot(nnormal, litVec), 0.0) * (1.0 - uAmb);
        ${this.roughnessSpecular ? `
        // powerはPhong鏡面項における反射vectorと視線vectorの内積の累乗数として扱う
        // roughnessが増えるほど有効鏡面指数を1へ近づけ、同時にピーク強度を下げることで
        // ハイライトを広く鈍くしつつ、広範囲が一様に白くなる状態を避ける
        let specularRoughness = smoothstep(
          0.04,
          1.0,
          clamp(u.normalMapParams.z, 0.04, 1.0)
        );
        // GGX側の知覚的roughnessに近い鋭さをPhong反射vector式へ移すため、
        // roughness^4の逆数から鏡面指数を求める。上限512はsubpixel aliasを抑えつつ、
        // opacity sampleの既定power 30より十分に狭いハイライトを作る
        let clampedSpecularRoughness = clamp(u.normalMapParams.z, 0.04, 1.0);
        let roughnessSquared = clampedSpecularRoughness * clampedSpecularRoughness;
        let roughnessFourth = roughnessSquared * roughnessSquared;
        let roughnessDerivedExponent = clamp(0.5 / roughnessFourth - 0.5, 1.0, 512.0);
        let materialExponent = mix(max(uSpecPower, 1.0), 1.0, specularRoughness);
        let effectiveSpecularExponent = max(roughnessDerivedExponent, materialExponent);
        let specularPeak = mix(1.0, 0.12, specularRoughness);
        let litSpec = uSpec * specularPeak
          * pow(max(dot(refVec, eyeVec), 0.0), effectiveSpecularExponent);
        ` : `
        let litSpec = uSpec * pow(max(dot(refVec, eyeVec), 0.0), uSpecPower);
        `}
        let emissiveBlend = clamp(uEmit, 0.0, 1.0);
        let diff = mix(litDiff, 1.0 - uAmb, emissiveBlend);
        let ispec = litSpec * (1.0 - emissiveBlend);

        var finalColor : vec4<f32>;
        if (u.flags.y != 0.0) {
          let texColor = textureSample(myTexture, mySampler, input.vTexCoord);
          finalColor = u.color * texColor;
          finalColor = mix(diff * u.color, finalColor, u.color.w);
        } else {
          finalColor = u.color;
        }

        // color は glTF material 由来の base color として残し、
        // sample 側の役割色や選択表示は multiply / add の後段で重ねる
        // これにより元 material を上書きせず、必要な draw だけ色味を調整できる
        finalColor = vec4<f32>(
          finalColor.rgb * u.multiplyColor.rgb + u.addColor.rgb,
          finalColor.a * u.multiplyColor.a + u.addColor.a
        );

        if (u.debugFlags.x != 0.0 && !input.frontFacing) {
          return vec4<f32>(u.debugColor.rgb, 1.0);
        }

        let rgb = finalColor.rgb * (uAmb + diff) + vec3<f32>(1.0, 1.0, 1.0) * ispec;
        let lit = vec4<f32>(rgb, u.normalMapParams.y);
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
        var outputRgb = mix(u.fogColor.rgb, lit.rgb, fogFactor);
        ${this.backgroundFrost ? `
        // roughness 0.04は透明surfaceの最小値としてぼかしなしに対応させ、
        // 1.0へ近づくほどHDR背景のblur画像を強く混合する
        let frostDimensions = vec2<i32>(textureDimensions(frostBackgroundTexture));
        let frostPixel = clamp(
          vec2<i32>(input.fragPosition.xy),
          vec2<i32>(0),
          frostDimensions - vec2<i32>(1)
        );
        let blurredBackground = textureLoad(frostBackgroundTexture, frostPixel, 0).rgb;
        let roughness = clamp(u.normalMapParams.z, 0.04, 1.0);
        let frostAmount = smoothstep(0.04, 1.0, roughness);
        // 最大roughnessでもsurface tintとspecularを完全には消さず、
        // Alpha Blend量と独立してトーラス等の形状を読み取れるようにする
        outputRgb = mix(outputRgb, blurredBackground, frostAmount * 0.65);
        ` : ""}
        return vec4<f32>(outputRgb, lit.a);
        `}
      }
    `;
  }

  // pipeline / bind group / default resource を生成する
  createResources() {
    const device = this.device;
    const shaderModule = this.createShaderModule(this.wgslSrc);

    // group0 は draw ごとに切り替わる small uniform に限定し、
    // dynamic offset を使って多数 draw を 1 つの buffer にまとめる
    this.createUniformBuffer(this.uniformStride * this.maxUniforms);

    this.bindGroupLayout0 = this.createUniformBindGroupLayout({
      hasDynamicOffset: true
    });

    // group1 は base texture と normal texture をまとめる
    // normal map を使わない場合でも 1x1 の既定 normal texture を bind して形を固定する
    this.bindGroupLayout1 = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } }
      ]
    });

    // group2 は bone palette 専用に分離し、
    // non-bone draw では共有の空 palette を bind してインタフェースだけそろえる
    this.bindGroupLayout2 = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: "uniform", hasDynamicOffset: false }
        }
      ]
    });

    if (this.backgroundFrost) {
      this.backgroundFrostBindGroupLayout = this.device.createBindGroupLayout({
        entries: [{
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "float" }
        }]
      });
    }

    const pipelineLayouts = [
      this.bindGroupLayout0,
      this.bindGroupLayout1,
      this.bindGroupLayout2
    ];
    if (this.backgroundFrostBindGroupLayout) {
      pipelineLayouts.push(this.backgroundFrostBindGroupLayout);
    }
    const pipelineLayout = this.createPipelineLayout(pipelineLayouts);

    // OpaqueとTranslucentは同じshader/bind groupを共有し、depth writeだけをpipeline stateで分ける
    // Alpha値でpipeline stateを動的変更できないため、二つのpipelineを生成してdraw時に選択する
    const createPipeline = (depthWriteEnabled, label) => device.createRenderPipeline({
      label,
      layout: pipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: "vs_main",
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
        module: shaderModule,
        entryPoint: "fs_main",
        targets: [{
          format: this.colorFormat,
          blend: this.roughnessMask
            ? {
                color: { srcFactor: "one", dstFactor: "one", operation: "max" },
                alpha: { srcFactor: "one", dstFactor: "one", operation: "max" }
              }
            : {
                color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
                alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" }
              }
        }]
      },
      primitive: {
        topology: "triangle-list",
        cullMode: this.cullMode,
        frontFace: this.frontFace
      },
      depthStencil: {
        depthWriteEnabled,
        depthCompare: this.depthCompare,
        format: CAMERA_REVERSE_Z.format
      }
    });
    this.pipeline = createPipeline(this.depthWriteEnabled, "SmoothShader:opaque");
    this.translucentPipeline = createPipeline(false, "SmoothShader:translucent");

    this.uniformBindGroup = device.createBindGroup({
      layout: this.bindGroupLayout0,
      entries: [{
        binding: 0,
        resource: { buffer: this.uniformBuffer, size: this.UNIFORM_SIZE }
      }]
    });

    this.createDefaultTexture();
    this.createDefaultNormalTexture();
    this.createDefaultBoneBindGroup();

    this.setLightPosition(this.default.light);
    this.setColor(this.default.color);
    this.setMultiplyColor(this.default.multiplyColor);
    this.setAddColor(this.default.addColor);
    this.useTexture(this.default.use_texture);
    this.useNormalMap(this.default.use_normal_map);
    this.setNormalStrength(this.default.normal_strength);
    this.setAlpha(this.default.alpha);
    this.setRoughness(this.default.roughness);
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
    this.setFlatShading(this.default.flat_shading);
    this.setBackfaceDebug(this.default.backface_debug);
    this.setBackfaceColor(this.default.backface_color);
  }

  // default の 1x1 白テクスチャを作る
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

  // normal map 未指定時に使う 1x1 の flat normal texture を作る
  createDefaultNormalTexture() {
    const bytes = new Uint8Array([128, 128, 255, 255]);
    this.defaultNormalTexture = this.device.createTexture({
      size: [1, 1, 1],
      format: "rgba8unorm",
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

  // pipeline と既定 bind group をまとめて設定する
  useProgram(passEncoder) {
    if (!passEncoder || !this.pipeline) return;
    passEncoder.setPipeline(this.pipeline);
    passEncoder.setBindGroup(0, this.uniformBindGroup);
    passEncoder.setBindGroup(1, this.defaultTextureBindGroup);
    passEncoder.setBindGroup(2, this.defaultBoneBindGroup);
  }

  // group0 の uniform bind group を返す
  getBindGroup() {
    return this.uniformBindGroup;
  }

  // group1 の texture bind group を返す
  // base texture / normal texture の組み合わせごとにキャッシュする
  getBindGroup1(texture) {
    const useTexture = this.uniformData[this.OFF_FLAGS + 1] !== 0.0;
    const useNormalMap = this.uniformData[this.OFF_FLAGS + 3] !== 0.0;
    const isDefaultTexture = texture === this.defaultTextureResource || texture === this.defaultTexture;
    const baseTexture = texture ?? (!useTexture ? this.defaultTextureResource : null);
    const normalTexture = this.change.normal_texture
      ?? this.default.normal_texture
      ?? (!useNormalMap ? this.defaultNormalTexture : null);
    const normalKey = normalTexture;
    const baseKey = baseTexture;

    if (!useTexture && !useNormalMap && (!texture || isDefaultTexture)) {
      return this.defaultTextureBindGroup;
    }

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
      throw new Error("SmoothShader requires texture and sampler when use_texture is enabled");
    }
    if (useNormalMap && !normalRes.view) {
      throw new Error("SmoothShader requires normal_texture when use_normal_map is enabled");
    }

    const bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout1,
      entries: [
        { binding: 0, resource: baseRes.sampler },
        { binding: 1, resource: baseRes.view },
        { binding: 2, resource: normalRes.view }
      ]
    });
    if (level2 && canCacheNormal) {
      level2.set(normalKey, bindGroup);
    }
    return bindGroup;
  }

  // group2 の bone palette bind group を返す
  // has_bone = 0 の draw では shared の空 palette を返し、
  // has_bone = 1 の draw では skeleton ごとの buffer / bind group を返す
  getBindGroup2(skinSource = null) {
    if (this.uniformData[this.OFF_FLAGS + 0] === 0.0) {
      return this.defaultBoneBindGroup;
    }
    const source = skinSource ?? this.activeSkinSource;
    if (!source) {
      throw new Error("SmoothShader requires setMatrixPalette() before drawing with has_bone = 1");
    }
    const entry = this.skinBindGroupCache.get(source);
    if (!entry) {
      throw new Error("SmoothShader has no cached bone palette for the current skin source");
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
    this.skinEntryList.push(entry);
    return entry;
  }

  // non-skinned mesh に対しても slot1 の頂点レイアウトだけはそろえる
  // ここでは index / weight を 0 埋めしたダミー buffer を返す
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

  // 射影行列を現在の draw slot へ反映する
  setProjectionMatrix(m) {
    this.projectionMatrix = m.clone();
    this.uniformData.set(m.mat, this.OFF_PROJ);
    this.updateUniforms();
  }

  // モデルビュー行列を現在の draw slot へ反映する
  setModelViewMatrix(m) {
    this.uniformData.set(m.mat, this.OFF_VIEW);
    this.updateUniforms();
  }

  // 法線行列を現在の draw slot へ反映する
  setNormalMatrix(m) {
    this.uniformData.set(m.mat, this.OFF_NORM);
    this.updateUniforms();
  }

  // 光源位置/種類 `[x, y, z, w]` を設定する
  setLightPosition(positionAndType) {
    this.uniformData.set(positionAndType, this.OFF_LIGHT);
    this.updateUniforms();
  }

  // ベースカラーを設定する
  setColor(color) {
    this.uniformData.set(color, this.OFF_COLOR);
    this.updateUniforms();
  }

  // ベースカラーへ後段で掛ける乗算色を設定する
  // glTF material の `color` を壊さず、サンプル側の役割色を重ねたいときに使う
  setMultiplyColor(color) {
    this.uniformData.set(color, this.OFF_MULTIPLY_COLOR);
    this.updateUniforms();
  }

  // ベースカラーへ後段で足す加算色を設定する
  // ハイライトや発光寄りの強調を、元 material の色を保持したまま追加できる
  setAddColor(color) {
    this.uniformData.set(color, this.OFF_ADD_COLOR);
    this.updateUniforms();
  }

  // 環境光係数を設定する
  setAmbientLight(intensity) {
    this.uniformData[this.OFF_PARAMS + 0] = this.clipUnitIntervalParameter(intensity, "ambient");
    this.updateUniforms();
  }

  // 鏡面反射係数を設定する
  setSpecular(intensity) {
    this.uniformData[this.OFF_PARAMS + 1] = this.clipUnitIntervalParameter(intensity, "specular");
    this.updateUniforms();
  }

  // 鏡面指数を設定する
  setSpecularPower(power) {
    this.uniformData[this.OFF_PARAMS + 2] = this.clipNonNegativeParameter(power, "power");
    this.updateUniforms();
  }

  // 発光量を設定する
  // 旧来の true/false も受けるが、数値なら 0.0-1.0 の連続量として扱う
  setEmissive(value) {
    let numeric = 0.0;
    if (typeof value === "boolean") {
      numeric = value ? 1.0 : 0.0;
    } else {
      if (!Number.isFinite(value)) {
        throw new Error("SmoothShader emissive must be boolean or a finite number");
      }
      numeric = this.clipUnitIntervalParameter(value, "emissive");
    }
    this.uniformData[this.OFF_PARAMS + 3] = numeric;
    this.updateUniforms();
  }

  // bone 利用フラグを設定する
  setHasBone(flag) {
    this.uniformData[this.OFF_FLAGS + 0] = flag ? 1.0 : 0.0;
    this.updateUniforms();
  }

  // base texture 利用フラグを設定する
  useTexture(flag) {
    this.uniformData[this.OFF_FLAGS + 1] = flag ? 1.0 : 0.0;
    this.updateUniforms();
  }

  // weight 可視化モードを設定する
  setWeightDebug(flag) {
    this.uniformData[this.OFF_FLAGS + 2] = flag ? 1.0 : 0.0;
    this.updateUniforms();
  }

  // normal map 利用フラグを設定する
  useNormalMap(flag) {
    this.uniformData[this.OFF_FLAGS + 3] = flag ? 1.0 : 0.0;
    this.updateUniforms();
  }

  // normal map 強度を設定する
  setNormalStrength(value) {
    this.uniformData[this.OFF_NMAP + 0] = value;
    this.updateUniforms();
  }

  // Shape materialの描画透明度を設定する
  // 範囲外をclipするとopaque/translucent分類との不一致を隠すため、ここでも厳密に拒否する
  setAlpha(value) {
    if (!Number.isFinite(value) || value < 0.0 || value > 1.0) {
      throw new Error("SmoothShader alpha must be a finite number between 0.0 and 1.0");
    }
    this.uniformData[this.OFF_NMAP + 1] = Number(value);
    this.updateUniforms();
  }

  // material roughnessを透明surfaceのFrost混合率として保持する
  // G-buffer materialと同じ0.04-1.0契約を使い、範囲外を自動補正しない
  setRoughness(value) {
    if (!Number.isFinite(value) || value < 0.04 || value > 1.0) {
      throw new Error("SmoothShader roughness must be a finite number between 0.04 and 1.0");
    }
    this.uniformData[this.OFF_NMAP + 2] = Number(value);
    this.updateUniforms();
  }

  // TransparencyPassが生成したblur済みHDR sceneをgroup 3へ結び付ける
  // resizeでtexture viewが変わった場合だけbind groupを作り直す
  setBackgroundFrostTexture(source) {
    if (!this.backgroundFrostBindGroupLayout) {
      throw new Error("SmoothShader background Frost support is not enabled");
    }
    const view = source?.getView?.() ?? source?.view ?? null;
    if (!view) {
      throw new Error("SmoothShader requires a background Frost texture view");
    }
    if (view === this.backgroundFrostTextureView && this.backgroundFrostBindGroup) {
      return false;
    }
    this.backgroundFrostTextureView = view;
    this.backgroundFrostBindGroup = this.device.createBindGroup({
      layout: this.backgroundFrostBindGroupLayout,
      entries: [{ binding: 0, resource: view }]
    });
    return true;
  }

  // Shape.draw()が任意groupを同じ処理フローでbindできるようgroup 3を公開する
  getBindGroup3() {
    if (this.backgroundFrost && !this.backgroundFrostBindGroup) {
      throw new Error("SmoothShader background Frost texture has not been set");
    }
    return this.backgroundFrostBindGroup;
  }

  // フォグ色を設定する
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

  // 既存の fog_mode を保ったまま ON/OFF だけ切り替える
  setUseFog(flag) {
    const fogMode = this.change.fog_mode ?? this.default.fog_mode;
    this.setFogMode(flag ? fogMode : 0.0);
  }

  // 面単位法線を使う flat shading を設定する
  // 0 なら頂点法線を補間し、1 なら fragment 微分から面法線を再構成する
  setFlatShading(flag) {
    this.uniformData[this.OFF_DEBUG_FLAGS + 1] = flag ? 1.0 : 0.0;
    this.updateUniforms();
  }

  // 裏面色のデバッグ表示を設定する
  setBackfaceDebug(flag) {
    this.uniformData[this.OFF_DEBUG_FLAGS + 0] = flag ? 1.0 : 0.0;
    this.updateUniforms();
  }

  // 裏面表示に使う色を設定する
  setBackfaceColor(color) {
    this.uniformData.set(color, this.OFF_DEBUG_COLOR);
    this.updateUniforms();
  }

  // Texture Unit は bind group 管理に置き換わっているため no-op のまま残す
  setTextureUnit(_unit) {}

  // bone palette を skeleton ごとの専用 buffer へ書き込む
  // per-draw uniform と切り離すことで、non-bone draw 側の書き戻し量を小さく保つ
  setMatrixPalette(matrixPalette, skinSource = this.manualSkinSource) {
    if (!matrixPalette) {
      throw new Error("SmoothShader.setMatrixPalette requires matrix palette data");
    }
    if (matrixPalette.byteLength > this.BONE_UNIFORM_SIZE) {
      throw new Error("SmoothShader received matrix palette data larger than the configured bone buffer");
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

  // Shape 側パラメータを一括反映する
  doParameter(param) {
    this.updateParam(param, "color", this.setColor);
    this.updateParam(param, "multiplyColor", this.setMultiplyColor);
    this.updateParam(param, "addColor", this.setAddColor);
    this.updateParam(param, "light", this.setLightPosition);
    this.updateParam(param, "use_texture", this.useTexture);
    this.updateParam(param, "use_normal_map", this.useNormalMap);
    this.updateParam(param, "normal_strength", this.setNormalStrength);
    this.updateParam(param, "alpha", this.setAlpha);
    this.updateParam(param, "roughness", this.setRoughness);
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
    this.updateParam(param, "flat_shading", this.setFlatShading);
    this.updateParam(param, "backface_debug", this.setBackfaceDebug);
    this.updateParam(param, "backface_color", this.setBackfaceColor);
    this.updateTexture(param);
  }

  // default 値を更新し、必要な setter も同時に流す
  setDefaultParam(key, value) {
    this.default[key] = value;
    if (key === "color") this.setColor(value);
    else if (key === "multiplyColor") this.setMultiplyColor(value);
    else if (key === "addColor") this.setAddColor(value);
    else if (key === "light") this.setLightPosition(value);
    else if (key === "use_texture") this.useTexture(value);
    else if (key === "use_normal_map") this.useNormalMap(value);
    else if (key === "normal_strength") this.setNormalStrength(value);
    else if (key === "alpha") this.setAlpha(value);
    else if (key === "roughness") this.setRoughness(value);
    else if (key === "ambient") this.setAmbientLight(value);
    else if (key === "specular") this.setSpecular(value);
    else if (key === "power") this.setSpecularPower(value);
    else if (key === "emissive") this.setEmissive(value);
    else if (key === "has_bone") this.setHasBone(value);
    else if (key === "weight_debug") this.setWeightDebug(value);
    else if (key === "normal_texture") this.change.normal_texture = value;
    else if (key === "fog_color") this.setFogColor(value);
    else if (key === "fog_near") this.setFogNear(value);
    else if (key === "fog_far") this.setFogFar(value);
    else if (key === "fog_density") this.setFogDensity(value);
    else if (key === "fog_mode") this.setFogMode(value);
    else if (key === "use_fog") this.setFogMode(value ? 1.0 : 0.0);
    else if (key === "flat_shading") this.setFlatShading(value);
    else if (key === "backface_debug") this.setBackfaceDebug(value);
    else if (key === "backface_color") this.setBackfaceColor(value);
  }

  // Shape.draw()がopaque/translucentの描画目的に応じたpipelineを選ぶ入口
  getPipeline(_hasSkeleton = false, options = {}) {
    return options.translucent === true ? this.translucentPipeline : this.pipeline;
  }

  // shaderが所有するBufferとTextureを破棄し、Render Pipeline参照を解放する
  // sampler、bind group、layout、pipelineには明示destroy APIがないため参照だけを外す
  destroy() {
    this.uniformBuffer?.destroy();
    this.defaultTexture?.destroy();
    this.defaultNormalTexture?.destroy();
    this.defaultBoneBuffer?.destroy();
    this._dummySkinBuffer?.destroy();
    this.backgroundFrostBindGroup = null;
    this.backgroundFrostTextureView = null;
    this.backgroundFrostBindGroupLayout = null;
    for (const entry of this.skinEntryList) {
      entry.buffer?.destroy();
    }
    this.skinEntryList.length = 0;
    this.uniformBuffer = null;
    this.defaultTexture = null;
    this.defaultNormalTexture = null;
    this.defaultBoneBuffer = null;
    this._dummySkinBuffer = null;
    this.pipeline = null;
    this.translucentPipeline = null;
    return true;
  }
}
