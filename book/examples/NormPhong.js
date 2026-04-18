// ---------------------------------------------
// NormPhong.js    2026/04/18
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import Shader from "../../webg/Shader.js";
import { alignTo } from "../../webg/SkinningConfig.js";

export default class NormPhong extends Shader {
  // `Phong` 相当の材質に法線マップ拡張パラメータを追加して初期化する
  constructor(gpu, options = {}) {
    super(gpu);
    this.default = {
      color: [0.8, 0.8, 1.0, 1.0],
      tex_unit: 0,
      light: [0.0, 0.0, 100.0, 1],
      use_texture: 0,
      use_normal_map: 0,
      normal_strength: 1.0,
      backface_debug: options.backfaceDebug ? 1 : 0,
      emissive: 0,
      ambient: 0.3,
      specular: 0.6,
      power: 40,
      normal_texture: null,
      fog_color: [0.1, 0.15, 0.1, 1.0],
      fog_near: 20.0,
      fog_far: 80.0,
      fog_density: 0.03,
      fog_mode: 0.0
    };
    this.change = {};

    this.uniformData = new Float32Array(72);
    this.uniformStride = alignTo(this.uniformData.byteLength, 256);
    this.maxUniforms = 2048;
    this.dynamicOffsetGroup0 = true;

    this.bindGroupCache = new WeakMap();
    this.defaultNormalTexture = null;
    this.defaultNormalTextureView = null;
    this.cullMode = options.backfaceDebug ? "none" : (options.cullMode ?? "back");
    this.frontFace = options.frontFace ?? "ccw";

    this.OFF_PROJ = 0;
    this.OFF_MV = 16;
    this.OFF_NORM = 32;
    this.OFF_LIGHT = 48;
    this.OFF_COLOR = 52;
    this.OFF_PARAMS0 = 56;
    this.OFF_PARAMS1 = 60;
    this.OFF_FOG_COLOR = 64;
    this.OFF_FOG_PARAMS = 68;
  }

  // 法線マップ対応WGSL・BindGroupLayout・Pipeline・Uniformを生成する
  createResources() {
    const device = this.device;
    const shaderCode = `
struct Uniforms {
  // Phong と同じ Uniforms 構成を使う
  // - normal map 対応でも既存の proj / modelView / normalMat / light / fog の並びは維持する
  proj : mat4x4f,
  modelView : mat4x4f,
  normalMat : mat4x4f,
  lightPos : vec4f,
  color : vec4f,
  params0 : vec4f,
  params1 : vec4f,
  fogColor : vec4f,
  fogParams : vec4f,
};

@group(0) @binding(0) var<uniform> uniforms : Uniforms;
@group(0) @binding(1) var uTexture : texture_2d<f32>;
@group(0) @binding(2) var uSampler : sampler;
// Phong との差分:
// - binding(3) に normal map 用 texture を追加する
@group(0) @binding(3) var uNormalTexture : texture_2d<f32>;

struct VSIn {
  // 頂点入力は Phong と同一
  @location(0) position : vec3f,
  @location(1) normal : vec3f,
  @location(2) texCoord : vec2f,
};

struct VSOut {
  // 頂点出力も Phong と同一
  @builtin(position) position : vec4f,
  @location(0) vPosition : vec3f,
  @location(1) vNormal : vec3f,
  @location(2) vTexCoord : vec2f,
};

struct FSIn {
  @location(0) vPosition : vec3f,
  @location(1) vNormal : vec3f,
  @location(2) vTexCoord : vec2f,
  @builtin(front_facing) frontFacing : bool,
};

@vertex
fn vsMain(input : VSIn) -> VSOut {
  // 頂点シェーダ本体は Phong と同じ
  // - normal map の差分はフラグメント側で法線を作り直すところに集約する
  var output : VSOut;
  let worldPos = uniforms.modelView * vec4f(input.position, 1.0);
  output.position = uniforms.proj * worldPos;
  output.vPosition = worldPos.xyz;
  output.vNormal = (uniforms.normalMat * vec4f(input.normal, 0.0)).xyz;
  output.vTexCoord = input.texCoord;
  return output;
}

@fragment
fn fsMain(input : FSIn) -> @location(0) vec4f {
  // Phong との差分 1:
  // - params1 の割り当てを normal map 用に拡張する
  //   x=useTexture, y=useNormalMap, z=normalStrength, w=backfaceDebug
  let ambient = uniforms.params0.x;
  let specular = uniforms.params0.y;
  let power = uniforms.params0.z;
  let emissive = uniforms.params0.w;

  let texFlag = uniforms.params1.x;
  let normalFlag = uniforms.params1.y;
  let normalStrength = uniforms.params1.z;
  let backfaceDebug = uniforms.params1.w;

  // Phong との差分 2:
  // - まず補間された頂点法線を基準法線として正規化する
  var nnormal = normalize(input.vNormal);
  if (normalFlag > 0.5) {
    // Phong との差分 3:
    // - normal map を読み、TBN 行列で tangent space から eye space へ戻す
    // WGSL制約回避:
    // dpdx/dpdy 由来の非一様制御フロー内では textureSample が使えないため、
    // 明示LODの textureSampleLevel(..., 0.0) で法線マップを読む
    let ntex = textureSampleLevel(uNormalTexture, uSampler, input.vTexCoord, 0.0).xyz * 2.0 - vec3f(1.0, 1.0, 1.0);

    // screen-space 微分から position と UV の変化量を取り出し、
    // tangent / bitangent を再構成する
    let dp1 = dpdx(input.vPosition);
    let dp2 = dpdy(input.vPosition);
    let duv1 = dpdx(input.vTexCoord);
    let duv2 = dpdy(input.vTexCoord);

    // UV ヤコビアンの行列式
    // - UV が退化していると 0 付近になり、接線空間を安全に作れない
    let det = duv1.x * duv2.y - duv1.y * duv2.x;
    if (abs(det) > 1.0e-8) {
      let invDet = 1.0 / det;

      // 接線 T を再構成する
      var tangent = (dp1 * duv2.y - dp2 * duv1.y) * invDet;
      let tlen0 = length(tangent);
      if (tlen0 > 1.0e-8) {
        tangent = tangent / tlen0;

        // Gram-Schmidt で法線 N に直交化し、TBN を安定化する
        tangent = tangent - nnormal * dot(nnormal, tangent);
        let tlen1 = length(tangent);
        if (tlen1 > 1.0e-8) {
          tangent = tangent / tlen1;

          // B は外積で構成する
          var bitangent = cross(nnormal, tangent);
          let blen = length(bitangent);
          if (blen > 1.0e-8) {
            bitangent = bitangent / blen;
            let tbn = mat3x3f(tangent, bitangent, nnormal);
            let mapped = normalize(tbn * ntex);

            // normalStrength で元法線と normal map 法線の混ぜ比率を調整する
            let w = clamp(normalStrength, 0.0, 2.0);
            nnormal = normalize(mix(nnormal, mapped, w));
          }
        }
      }
    }
  }

  // 以降の lighting / fog / texture 合成は Phong と同じ流れを使う
  var litVec : vec3f;
  if (uniforms.lightPos.w != 0.0) {
    litVec = normalize(uniforms.lightPos.xyz - input.vPosition);
  } else {
    litVec = normalize(uniforms.lightPos.xyz);
  }

  let eyeVec = normalize(-input.vPosition);
  let refVec = normalize(reflect(-litVec, nnormal));

  var diff : f32;
  var ispec : f32;
  if (emissive == 0.0) {
    diff = max(dot(nnormal, litVec), 0.0) * (1.0 - ambient);
    ispec = specular * pow(max(dot(refVec, eyeVec), 0.0), power);
  } else {
    diff = 1.0 - ambient;
    ispec = 0.0;
  }

  var color = uniforms.color;
  if (texFlag > 0.5) {
    let tex = textureSample(uTexture, uSampler, input.vTexCoord);
    color = uniforms.color * tex;
    color = mix(diff * uniforms.color, color, uniforms.color.w);
  }

  let lit = vec4f(color.rgb * (ambient + diff) + vec3f(1.0) * ispec, 1.0);
  let fogDistance = length(input.vPosition);
  let fogNear = uniforms.fogParams.x;
  let fogFar = uniforms.fogParams.y;
  let fogDensity = uniforms.fogParams.z;
  let fogMode = uniforms.fogParams.w;
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
    return vec4f(1.0, 0.0, 1.0, 1.0);
  }
  return vec4f(mix(uniforms.fogColor.rgb, lit.rgb, fogFactor), lit.a);
}`;

    const module = this.createShaderModule(shaderCode);

    this.bindGroupLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform", hasDynamicOffset: true }
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "float" }
        },
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: "filtering" }
        },
        {
          binding: 3,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "float" }
        }
      ]
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
            attributes: [
              { shaderLocation: 0, offset: 0, format: "float32x3" },
              { shaderLocation: 1, offset: 3 * 4, format: "float32x3" },
              { shaderLocation: 2, offset: 6 * 4, format: "float32x2" }
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
        topology: "triangle-list",
        cullMode: this.cullMode,
        frontFace: this.frontFace
      },
      depthStencil: {
        format: "depth24plus",
        depthWriteEnabled: true,
        depthCompare: "less"
      }
    });

    this.createUniformBuffer(this.uniformStride * this.maxUniforms);
    this.createDefaultTexture();
    this.createDefaultNormalTexture();
    this.setLightPosition(this.default.light);
    this.useTexture(this.default.use_texture);
    this.useNormalMap(this.default.use_normal_map);
    this.setNormalStrength(this.default.normal_strength);
    this.setColor(this.default.color);
    this.setEmissive(this.default.emissive);
    this.setAmbientLight(this.default.ambient);
    this.setSpecular(this.default.specular);
    this.setSpecularPower(this.default.power);
    this.setFogColor(this.default.fog_color);
    this.setFogNear(this.default.fog_near);
    this.setFogFar(this.default.fog_far);
    this.setFogDensity(this.default.fog_density);
    this.setFogMode(this.default.fog_mode);
    this.setBackfaceDebug(this.default.backface_debug);
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
  }

  // ベーステクスチャ + 法線テクスチャ込みのBindGroupを返す
  getBindGroup(texture) {
    const useTexture = this.uniformData[this.OFF_PARAMS1] !== 0.0;
    const useNormalMap = this.uniformData[this.OFF_PARAMS1 + 1] !== 0.0;
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
      level2 = this.bindGroupCache.get(baseKey);
      if (!level2) {
        level2 = new WeakMap();
        this.bindGroupCache.set(baseKey, level2);
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
      throw new Error("NormPhong requires texture and sampler when use_texture is enabled");
    }
    if (useNormalMap && !normalRes.view) {
      throw new Error("NormPhong requires normal_texture when use_normal_map is enabled");
    }

    const bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer, size: this.uniformData.byteLength } },
        { binding: 1, resource: baseRes.view },
        { binding: 2, resource: baseRes.sampler },
        { binding: 3, resource: normalRes.view }
      ]
    });
    if (level2 && canCacheNormal) {
      level2.set(normalKey, bindGroup);
    }
    return bindGroup;
  }

  // 既定材質辞書を更新し対応setterを呼ぶ
  setDefaultParam(key, value) {
    this.default[key] = value;
    if (key === "color") this.setColor(value);
    else if (key === "tex_unit") this.setTextureUnit(value);
    else if (key === "use_texture") this.useTexture(value);
    else if (key === "use_normal_map") this.useNormalMap(value);
    else if (key === "normal_strength") this.setNormalStrength(value);
    else if (key === "backface_debug") this.setBackfaceDebug(value);
    else if (key === "light") this.setLightPosition(value);
    else if (key === "emissive") this.setEmissive(value);
    else if (key === "ambient") this.setAmbientLight(value);
    else if (key === "specular") this.setSpecular(value);
    else if (key === "power") this.setSpecularPower(value);
    else if (key === "normal_texture") this.change.normal_texture = value;
    else if (key === "fog_color") this.setFogColor(value);
    else if (key === "fog_near") this.setFogNear(value);
    else if (key === "fog_far") this.setFogFar(value);
    else if (key === "fog_density") this.setFogDensity(value);
    else if (key === "fog_mode") this.setFogMode(value);
    else if (key === "use_fog") this.setFogMode(value ? 1.0 : 0.0);
  }

  // 光源位置/種別 `[x,y,z,w]` を設定する
  setLightPosition(positionAndType) {
    this.uniformData.set(positionAndType, this.OFF_LIGHT);
    this.updateUniforms();
  }

  // ベースカラーのテクスチャ利用フラグを設定する
  useTexture(flag) {
    this.uniformData[this.OFF_PARAMS1] = flag;
    this.updateUniforms();
  }

  // 法線マップ適用フラグを設定する
  useNormalMap(flag) {
    this.uniformData[this.OFF_PARAMS1 + 1] = flag;
    this.updateUniforms();
  }

  // 法線マップ強度を設定する
  setNormalStrength(strength) {
    this.uniformData[this.OFF_PARAMS1 + 2] = strength;
    this.updateUniforms();
  }

  // 現状 no-op
  setTextureUnit(_tex_unit) {
    // No-op in WebGPU. Kept for compatibility.
  }

  // 発光フラグを設定する
  setEmissive(flag) {
    this.uniformData[this.OFF_PARAMS0 + 3] = flag;
    this.updateUniforms();
  }

  // 環境光係数を設定する
  setAmbientLight(intensity) {
    this.uniformData[this.OFF_PARAMS0] = intensity;
    this.updateUniforms();
  }

  // 鏡面反射係数を設定する
  setSpecular(intensity) {
    this.uniformData[this.OFF_PARAMS0 + 1] = intensity;
    this.updateUniforms();
  }

  // 鏡面指数を設定する
  setSpecularPower(power) {
    this.uniformData[this.OFF_PARAMS0 + 2] = power;
    this.updateUniforms();
  }

  // ベースカラー `[r,g,b,a]` を設定する
  setColor(color) {
    this.uniformData.set(color, this.OFF_COLOR);
    this.updateUniforms();
  }

  // フォグ色 `[r,g,b,a]` を設定する
  setFogColor(color) {
    this.uniformData.set(color, this.OFF_FOG_COLOR);
    this.updateUniforms();
  }

  // 線形フォグ開始距離を設定する
  setFogNear(value) {
    this.uniformData[this.OFF_FOG_PARAMS] = value;
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

  // 裏面をマゼンタで表示するデバッグモードを設定する
  setBackfaceDebug(flag) {
    this.uniformData[this.OFF_PARAMS1 + 3] = flag ? 1.0 : 0.0;
    this.updateUniforms();
  }

  // 既存の fog_mode を保ちつつ ON/OFF だけ切り替える
  setUseFog(flag) {
    const fogMode = this.change.fog_mode ?? this.default.fog_mode;
    this.setFogMode(flag ? fogMode : 0.0);
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

  // 法線行列を設定する
  setNormalMatrix(m) {
    this.uniformData.set(m.mat, this.OFF_NORM);
    this.updateUniforms();
  }

  // `texture` / `normal_texture` を更新する
  updateTexture(param) {
    if (param.texture !== undefined) {
      this.change.texture = param.texture;
    }
    if (param.normal_texture !== undefined) {
      this.change.normal_texture = param.normal_texture;
    }
  }

  // `shaderParameter` 群を一括反映する
  doParameter(param) {
    this.updateParam(param, "color", this.setColor);
    this.updateParam(param, "light", this.setLightPosition);
    this.updateParam(param, "use_texture", this.useTexture);
    this.updateParam(param, "use_normal_map", this.useNormalMap);
    this.updateParam(param, "normal_strength", this.setNormalStrength);
    this.updateParam(param, "backface_debug", this.setBackfaceDebug);
    this.updateParam(param, "ambient", this.setAmbientLight);
    this.updateParam(param, "specular", this.setSpecular);
    this.updateParam(param, "power", this.setSpecularPower);
    this.updateParam(param, "emissive", this.setEmissive);
    this.updateParam(param, "fog_color", this.setFogColor);
    this.updateParam(param, "fog_near", this.setFogNear);
    this.updateParam(param, "fog_far", this.setFogFar);
    this.updateParam(param, "fog_density", this.setFogDensity);
    this.updateParam(param, "fog_mode", this.setFogMode);
    this.updateParam(param, "use_fog", this.setUseFog);
    this.updateTexture(param);
  }
}
