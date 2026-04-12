// ---------------------------------------------
// Phong.js       2026/04/12
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import Shader from "../../webg/Shader.js";
import { alignTo } from "../../webg/SkinningConfig.js";

export default class Phong extends Shader {
  // Phong用デフォルト材質/Uniformオフセットを定義する
  constructor(gpu, options = {}) {
    // 汎用メッシュ向けPhongシェーダ
    // Shape.draw() から modelView/normal/color/light などを受け取って描画する
    super(gpu);
    this.default = {
      color: [0.8, 0.8, 1.0, 1.0],
      tex_unit: 0,
      light: [0.0, 0.0, 100.0, 1],
      use_texture: 0,
      backface_debug: options.backfaceDebug ? 1 : 0,
      emissive: 0,
      ambient: 0.3,
      specular: 0.6,
      power: 40,
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
    this.bindGroupCache = new WeakMap();

    this.OFF_PROJ = 0;
    this.OFF_MV = 16;
    this.OFF_NORM = 32;
    this.OFF_LIGHT = 48;
    this.OFF_COLOR = 52;
    this.OFF_PARAMS0 = 56;
    this.OFF_PARAMS1 = 60;
    this.OFF_FOG_COLOR = 64;
    this.OFF_FOG_PARAMS = 68;
    this.dynamicOffsetGroup0 = true;
    this.cullMode = options.backfaceDebug ? "none" : (options.cullMode ?? "back");
    this.frontFace = options.frontFace ?? "ccw";
    // 骨オーバーレイなどで depth 比較だけ変えたい用途のため、
    // 既存既定値は維持したまま constructor option で上書きできるようにする
    this.depthWriteEnabled = options.depthWriteEnabled ?? true;
    this.depthCompare = options.depthCompare ?? "less";
  }

  // WGSL・BindGroupLayout・Pipeline・Uniformを生成する
  createResources() {
    // WGSLモジュール、パイプライン、uniform/既定テクスチャを生成する
    const device = this.device;
    const shaderCode = `
//------------------ WGSL ------------------------
struct Uniforms {
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

struct VSIn {
  @location(0) position : vec3f,
  @location(1) normal : vec3f,
  @location(2) texCoord : vec2f,
};

struct VSOut {
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
  // 両面描画では back face の法線をそのまま使うと lighting が反転して暗く見える
  // frontFacing に応じて法線向きをそろえ、片面/両面のどちらでも自然な反射にする
  let facing = select(-1.0, 1.0, input.frontFacing);
  let nnormal = normalize(input.vNormal) * facing;
  let backfaceDebug = uniforms.params1.y;
  var litVec : vec3f;
  if (uniforms.lightPos.w != 0.0) {
    litVec = normalize(uniforms.lightPos.xyz - input.vPosition);
  } else {
    litVec = normalize(uniforms.lightPos.xyz);
  }
  let eyeVec = normalize(-input.vPosition);
  let refVec = normalize(reflect(-litVec, nnormal));
  let ambient = uniforms.params0.x;
  let specular = uniforms.params0.y;
  let power = uniforms.params0.z;
  let emissive = uniforms.params0.w;
  var diff : f32;
  var ispec : f32;
  if (emissive == 0.0) {
    diff = max(dot(nnormal, litVec), 0.0) * (1.0 - ambient);
    ispec = specular * pow(max(dot(refVec, eyeVec), 0.0), power);
  } else {
    diff = 1.0 - ambient;
    ispec = 0.0;
  }
  let texFlag = uniforms.params1.x;
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
}
//------------------ WGSL ------------------------`;

    // シェーダモジュールを作成
    const module = this.createShaderModule(shaderCode);

    this.bindGroupLayout = this.createUniformTextureBindGroupLayout({
      hasDynamicOffset: true
    });
    if (this.debugBindLayout) {
      console.log("Phong.bindGroupLayout", this.bindGroupLayout);
    }

    const pipelineLayout = this.createPipelineLayout([this.bindGroupLayout]);
    if (this.debugBindLayout) {
      console.log("Phong.pipelineLayout", pipelineLayout);
    }
    // RenderPipelineで頂点属性を設定
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
        targets: [
          {
            format: this.gpu.format
          }
        ]
      },
      primitive: {
        topology: "triangle-list",
        cullMode: this.cullMode,
        frontFace: this.frontFace
      },
      depthStencil: {
        format: "depth24plus",
        depthWriteEnabled: this.depthWriteEnabled,
        depthCompare: this.depthCompare
      }
    });

    this.createUniformBuffer(this.uniformStride * this.maxUniforms);
    this.createDefaultTexture();
    this.setLightPosition(this.default.light);
    this.useTexture(this.default.use_texture);
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

  // 1x1白テクスチャ/サンプラを作る
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

  // テクスチャ込みBindGroupを返す（WeakMapキャッシュあり）
  getBindGroup(texture) {
    // textureごとのBindGroupをキャッシュ付きで取得する
    return this.getOrCreateTexturedBindGroup({
      texture,
      cache: this.bindGroupCache,
      layout: this.bindGroupLayout,
      uniformSize: this.uniformData.byteLength
    });
  }

  // デフォルト材質辞書を更新し対応setterを呼ぶ
  setDefaultParam(key, value) {
    this.default[key] = value;
    if (key === "color") this.setColor(value);
    else if (key === "tex_unit") this.setTextureUnit(value);
    else if (key === "use_texture") this.useTexture(value);
    else if (key === "backface_debug") this.setBackfaceDebug(value);
    else if (key === "light") this.setLightPosition(value);
    else if (key === "emissive") this.setEmissive(value);
    else if (key === "ambient") this.setAmbientLight(value);
    else if (key === "specular") this.setSpecular(value);
    else if (key === "power") this.setSpecularPower(value);
    else if (key === "fog_color") this.setFogColor(value);
    else if (key === "fog_near") this.setFogNear(value);
    else if (key === "fog_far") this.setFogFar(value);
    else if (key === "fog_density") this.setFogDensity(value);
    else if (key === "fog_mode") this.setFogMode(value);
    else if (key === "use_fog") this.setFogMode(value ? 1.0 : 0.0);
  }

  // 光源位置/種別 `[x,y,z,w]` を設定する
  setLightPosition(positionAndType) {
    // light.xyz と light.w(点光源/平行光フラグ)を設定
    this.uniformData.set(positionAndType, this.OFF_LIGHT);
    this.updateUniforms();
  }

  // テクスチャ利用フラグを設定する
  useTexture(flag) {
    this.uniformData[this.OFF_PARAMS1] = flag;
    this.updateUniforms();
  }

  // 現状 no-op
  setTextureUnit(tex_unit) {
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
    this.uniformData[this.OFF_PARAMS1 + 1] = flag ? 1.0 : 0.0;
    this.updateUniforms();
  }

  // 既存の fog_mode を保ちつつ ON/OFF だけ切り替える
  setUseFog(flag) {
    const fogMode = this.change.fog_mode ?? this.default.fog_mode;
    this.setFogMode(flag ? fogMode : 0.0);
  }

  // 射影行列を設定する
  setProjectionMatrix(m) {
    // カメラ投影行列を更新する
    this.projectionMatrix = m.clone();
    this.uniformData.set(m.mat, this.OFF_PROJ);
    this.updateUniforms();
  }

  // モデルビュー行列を設定する
  setModelViewMatrix(m) {
    // Nodeから渡された modelView 行列を更新する
    this.uniformData.set(m.mat, this.OFF_MV);
    this.updateUniforms();
  }

  // 法線変換行列を設定する
  setNormalMatrix(m) {
    this.uniformData.set(m.mat, this.OFF_NORM);
    this.updateUniforms();
  }

  // テクスチャ関連パラメータを適用する
  updateTexture(param) {
    if (param.texture !== undefined) {
      this.change.texture = param.texture;
    }
  }

  // Shapeの `shaderParameter` 群を一括反映する
  doParameter(param) {
    this.updateParam(param, "color", this.setColor);
    this.updateParam(param, "light", this.setLightPosition);
    this.updateParam(param, "use_texture", this.useTexture);
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
