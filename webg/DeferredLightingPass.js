// ---------------------------------------------
// DeferredLightingPass.js  2026/10/04
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// G-buffer deferred lighting compute pass

import { WATER_LIGHTING_BINDINGS, WATER_LIGHTING_DIFFUSE } from "./WaterLightingWgsl.js";
import ComputePass from "./ComputePass.js";
import {
  createGBufferProjectionParams,
  GBUFFER_MIN_ROUGHNESS,
  GBUFFER_WGSL_COMMON
} from "./GeometryBufferPass.js";
import { CAMERA_REVERSE_Z } from "./DepthConvention.js";
import { PBR_BRDF_WGSL, PBR_IBL_WGSL, PBR_LOCAL_LIGHT_WGSL } from "./PbrBrdf.js";
import { validatePbrEnvironmentResources } from "./PbrEnvironment.js";
import StorageTargetFactory, {
  resizeTarget
} from "./StorageTargetFactory.js";
import util from "./util.js";

export const DEFERRED_LIGHTING_DEFAULTS = Object.freeze({
  maxLights: 128,
  ambient: 0.035,
  view: "lighting"
});

// 照明値はtone mapping前の線形High Dynamic Range値として後段へ渡す
// rgba8unormへ途中で量子化すると1.0を超える輝度と暗部の階調が失われるため、形式を固定する
export const DEFERRED_LIGHTING_OUTPUT_FORMAT = "rgba16float";

export const DEFERRED_LIGHTING_VIEW_MODES = Object.freeze([
  "lighting",
  "albedo",
  "normal",
  "depth",
  "shadow",
  "spotShadow",
  "ao",
  "specular",
  "roughness",
  "metallic",
  "emissive",
  "occlusion"
]);

// Local Lightは全方向のpointと、放射方向を持つconeを同じ配列で扱います
// GPU側の数値IDはstorage bufferにのみ使い、公開入力では意味が明確な文字列typeを必須とします
export const DEFERRED_LOCAL_LIGHT_TYPES = Object.freeze(["point", "cone"]);
export const DEFERRED_LOCAL_LIGHT_TYPE_IDS = Object.freeze({
  point: 0,
  cone: 1
});
export const DEFERRED_LOCAL_LIGHT_STRIDE_FLOATS = 16;
export const DEFERRED_LIGHTING_UNIT_SYSTEMS = Object.freeze([
  "relative",
  "photometric"
]);

// G-bufferのalbedo、view-space normal、depthを読み、Local Light配列をpixel単位で評価する
// lighting用StorageTargetを所有し、Geometry Passの出力を入力として受け取る
export function buildDeferredLightingWgsl(maxLights = DEFERRED_LIGHTING_DEFAULTS.maxLights, { caustics = false } = {}) {
  const checkedMaxLights = util.readFiniteNumber(
    maxLights,
    "DeferredLightingPass maxLights",
    { integer: true, min: 1 }
  );
  return `
struct Params {
  // projection = near, far, tan(vfov/2), aspect
  projection : vec4f,
  // control.x = Local Light count、control.y = debug view、control.z = directional enabled
  control : vec4f,
  // xyz = 光が進むview-space方向、w = intensity
  directionalDirectionIntensity : vec4f,
  // rgb = directional color、w = shadowと独立して適用するambient係数
  directionalColorAmbient : vec4f,
  // xyz = view-space spot位置、w = 有効半径
  spotPositionRadius : vec4f,
  // xyz = 光が進むview-space方向、w = intensity
  spotDirectionIntensity : vec4f,
  // rgb = spot color、w = inner cone cosine
  spotColorInner : vec4f,
  // x = outer cone cosine、y = 0:relative / 1:photometric、z = minimum distance
  spotCone : vec4f,
  // view-space方向をworld-spaceへ戻す回転行列の各行
  viewToWorldRow0 : vec4f,
  viewToWorldRow1 : vec4f,
  viewToWorldRow2 : vec4f,
  // x = IBL有効、y = 強度、z = 鏡面mapのmip数、w = HDR背景表示
  environmentControl : vec4f,
  // x = environment Y回転のcos、y = sin、z/w = 予約
  environmentRotation : vec4f,
};

${GBUFFER_WGSL_COMMON}

${PBR_BRDF_WGSL}

${PBR_IBL_WGSL}

${PBR_LOCAL_LIGHT_WGSL}

@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var albedoTexture : texture_2d<f32>;
@group(0) @binding(2) var normalTexture : texture_2d<f32>;
@group(0) @binding(3) var depthTexture : texture_depth_2d;
@group(0) @binding(4) var materialTexture : texture_2d<f32>;
@group(0) @binding(5) var<storage, read> lights : array<LocalLight>;
@group(0) @binding(6) var shadowVisibilityTexture : texture_2d<f32>;
@group(0) @binding(7) var spotShadowVisibilityTexture : texture_2d<f32>;
@group(0) @binding(8) var ambientOcclusionTexture : texture_2d<f32>;
@group(0) @binding(9) var outputTexture : texture_storage_2d<${DEFERRED_LIGHTING_OUTPUT_FORMAT}, write>;
@group(0) @binding(10) var irradianceTexture : texture_2d<f32>;
@group(0) @binding(11) var prefilteredSpecularTexture : texture_2d<f32>;
@group(0) @binding(12) var brdfLutTexture : texture_2d<f32>;
@group(0) @binding(13) var environmentSampler : sampler;
@group(0) @binding(14) var emissiveTexture : texture_2d<f32>;
@group(0) @binding(15) var radianceTexture : texture_2d<f32>;
@group(0) @binding(16) var specularIblOutputTexture : texture_storage_2d<${DEFERRED_LIGHTING_OUTPUT_FORMAT}, write>;

// view-space方向をcameraの回転成分でworld-spaceへ戻す
fn environmentViewToWorld(direction : vec3f) -> vec3f {
  return normalize(vec3f(
    dot(params.viewToWorldRow0.xyz, direction),
    dot(params.viewToWorldRow1.xyz, direction),
    dot(params.viewToWorldRow2.xyz, direction)
  ));
}

// world-space方向へ環境自身のY回転の逆変換を適用し、背景とIBLで同じtexture方向を参照します
fn environmentWorldToTextureDirection(direction : vec3f) -> vec3f {
  let cosine = params.environmentRotation.x;
  let sine = params.environmentRotation.y;
  return normalize(vec3f(
    cosine * direction.x - sine * direction.z,
    direction.y,
    sine * direction.x + cosine * direction.z
  ));
}

// world-space方向を緯度経度形式の環境map UVへ変換します
fn environmentDirectionToUv(direction : vec3f) -> vec2f {
  let normalized = normalize(direction);
  let u = atan2(normalized.z, normalized.x) / (2.0 * 3.14159265) + 0.5;
  let v = acos(clamp(normalized.y, -1.0, 1.0)) / 3.14159265;
  return vec2f(u, v);
}

// 元HDRはrgba32floatでも使えるようtextureLoadでbilinear参照し、U repeatとV clampを明示します
fn sampleEnvironmentRadiance(direction : vec3f) -> vec3f {
  let uv = environmentDirectionToUv(environmentWorldToTextureDirection(direction));
  let dims = textureDimensions(radianceTexture);
  let sourceX = fract(uv.x) * f32(dims.x) - 0.5;
  let sourceY = clamp(uv.y, 0.0, 1.0) * f32(dims.y) - 0.5;
  let x0Unwrapped = i32(floor(sourceX));
  let y0Unclamped = i32(floor(sourceY));
  let fraction = vec2f(sourceX - floor(sourceX), sourceY - floor(sourceY));
  let width = i32(dims.x);
  let height = i32(dims.y);
  let x0 = ((x0Unwrapped % width) + width) % width;
  let x1 = (((x0Unwrapped + 1) % width) + width) % width;
  let y0 = clamp(y0Unclamped, 0, height - 1);
  let y1 = clamp(y0Unclamped + 1, 0, height - 1);
  let top = mix(
    textureLoad(radianceTexture, vec2i(x0, y0), 0).rgb,
    textureLoad(radianceTexture, vec2i(x1, y0), 0).rgb,
    fraction.x
  );
  let bottom = mix(
    textureLoad(radianceTexture, vec2i(x0, y1), 0).rgb,
    textureLoad(radianceTexture, vec2i(x1, y1), 0).rgb,
    fraction.x
  );
  return mix(top, bottom, fraction.y);
}

// split-sum方式で拡散irradianceとroughness別鏡面環境反射を評価します
// irradiance mapは入射radianceとcosineの半球積分値を線形RGBで保持します
fn evaluateImageBasedLighting(
  baseColor : vec3f,
  normal : vec3f,
  viewDirection : vec3f,
  material : vec4f,
  ambientOcclusion : f32
) -> PbrIblResponse {
  let roughness = material.y;
  let metallic = material.z;
  let dielectricF0 = vec3f(0.04 * material.x);
  let nDotV = max(dot(normal, viewDirection), 0.0);

  let normalWorld = environmentWorldToTextureDirection(environmentViewToWorld(normal));
  let reflectionWorld = environmentWorldToTextureDirection(
    environmentViewToWorld(reflect(-viewDirection, normal))
  );
  let irradiance = textureSampleLevel(
    irradianceTexture,
    environmentSampler,
    environmentDirectionToUv(normalWorld),
    0.0
  ).rgb;

  let maxLod = max(params.environmentControl.z - 1.0, 0.0);
  let prefiltered = textureSampleLevel(
    prefilteredSpecularTexture,
    environmentSampler,
    environmentDirectionToUv(reflectionWorld),
    roughness * maxLod
  ).rgb;
  let brdf = textureSampleLevel(
    brdfLutTexture,
    environmentSampler,
    pbrClampBrdfLutUv(
      vec2f(nDotV, roughness),
      textureDimensions(brdfLutTexture)
    ),
    0.0
  ).rg;
  return pbrEvaluateIblComponents(
    baseColor,
    metallic,
    roughness,
    dielectricF0,
    nDotV,
    irradiance,
    prefiltered,
    brdf,
    ambientOcclusion,
    params.environmentControl.y
  );
}

// 一様な環境光を、Lambert積分後の線形拡散環境強度として評価します
// metallic-roughness材質では金属のbase colorを鏡面F0として扱うため、
// Fresnelへ配分した割合とmetallic成分を拡散アンビエントから除外します
// 金属の環境鏡面反射はImage Based Lightingで計算し、拡散色とは分けて扱います
fn evaluateAmbientDiffuse(
  albedo : vec3f,
  normal : vec3f,
  viewDirection : vec3f,
  material : vec4f,
  ambient : f32,
  ambientOcclusion : f32
) -> vec3f {
  let roughness = material.y;
  let metallic = material.z;
  let dielectricF0 = vec3f(0.04 * material.x);
  let f0 = mix(dielectricF0, albedo, metallic);
  let nDotV = max(dot(normal, viewDirection), 0.0);
  // roughnessで環境光用F90を抑え、粗い面のgrazing Fresnelを適正な範囲へ保つ
  let ambientF90 = max(vec3f(1.0 - roughness), f0);
  let fresnel = f0 + (ambientF90 - f0) * pbrSchlickWeight(nDotV);
  let diffuseWeight = (vec3f(1.0) - fresnel) * (1.0 - metallic);
  return albedo * ambient * ambientOcclusion * diffuseWeight;
}

// Local Light（point / cone）、directional、spotで共有するGGX系の直接反射モデルです
// material = specular、roughness、metallic、emissiveで、roughnessはCPU側で${GBUFFER_MIN_ROUGHNESS}以上を保証します
fn evaluateDirectBrdf(
  albedo : vec3f,
  normal : vec3f,
  viewDirection : vec3f,
  lightDirection : vec3f,
  material : vec4f,
  radiance : vec3f
) -> vec3f {
  let dielectricF0 = vec3f(0.04 * material.x);
  return pbrEvaluateDirectBrdf(
    albedo,
    normal,
    viewDirection,
    lightDirection,
    material.z,
    material.y,
    dielectricF0,
    radiance
  );
}

// pointは全方向へ1、coneは光が進む方向とlight-to-surface方向の角度で減衰します
// innerCos > outerCosはCPU側で保証し、cone境界だけをsmoothstepで連続にします
${caustics ? WATER_LIGHTING_BINDINGS : ""}

@compute @workgroup_size(8, 8, 1)
// G-bufferから材質と位置を復元し、直接光・環境光・発光を線形HDRへ合成する
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  let dimsU = textureDimensions(albedoTexture);
  if (id.x >= dimsU.x || id.y >= dimsU.y) {
    return;
  }

  let coord = vec2<i32>(id.xy);
  let dims = vec2<i32>(dimsU);
  // 全pixelの鏡面出力を最初に0へ初期化し、背景・debug view・IBL無効時もframe内の値を確定する
  textureStore(specularIblOutputTexture, coord, vec4f(0.0));
  let albedo = textureLoad(albedoTexture, coord, 0);
  let material = textureLoad(materialTexture, coord, 0);
  let emissive = textureLoad(emissiveTexture, coord, 0).rgb;
  let depth = textureLoad(depthTexture, coord, 0);
  let mode = i32(round(params.control.y));

  if (isGBufferBackgroundDepth(depth)) {
    // 背景pixelはG-bufferのalbedo clear値を背景色として引き継ぐ
    // 背景色の決定をrenderScene()へclearColorを渡したアプリに
    // 背景の所有権を残しつつ、位置復元とlight評価は背景depthで早期終了する
    if (mode == 0 && params.environmentControl.x >= 0.5
      && params.environmentControl.w >= 0.5) {
      let pixel = vec2f(id.xy) + vec2f(0.5);
      let ndc = vec2f(
        pixel.x / f32(dimsU.x) * 2.0 - 1.0,
        1.0 - pixel.y / f32(dimsU.y) * 2.0
      );
      let viewDirection = normalize(vec3f(
        ndc.x * params.projection.z * params.projection.w,
        ndc.y * params.projection.z,
        -1.0
      ));
      let worldDirection = environmentViewToWorld(viewDirection);
      let radiance = sampleEnvironmentRadiance(worldDirection)
        * params.environmentControl.y;
      textureStore(outputTexture, coord, vec4f(radiance, 1.0));
    } else {
      textureStore(outputTexture, coord, vec4f(albedo.rgb, 1.0));
    }
    return;
  }

  let normal = decodeGBufferNormal(textureLoad(normalTexture, coord, 0).rgb);
  if (mode == 1) {
    textureStore(outputTexture, coord, vec4f(albedo.rgb, 1.0));
    return;
  }
  if (mode == 2) {
    textureStore(outputTexture, coord, vec4f(normal * 0.5 + vec3f(0.5), 1.0));
    return;
  }
  if (mode == 3) {
    // Reverse-Zのraw depthはnearで1、遠方ほど0へ近づくため、finite/infinite farで同じ表示になる
    textureStore(outputTexture, coord, vec4f(vec3f(depth), 1.0));
    return;
  }
  let shadowVisibility = textureLoad(shadowVisibilityTexture, coord, 0).r;
  let spotShadowVisibility = textureLoad(spotShadowVisibilityTexture, coord, 0).r;
  let ambientOcclusion = textureLoad(ambientOcclusionTexture, coord, 0).r;
  if (mode == 4) {
    textureStore(outputTexture, coord, vec4f(vec3f(shadowVisibility), 1.0));
    return;
  }
  if (mode == 5) {
    textureStore(outputTexture, coord, vec4f(vec3f(spotShadowVisibility), 1.0));
    return;
  }
  if (mode == 6) {
    textureStore(outputTexture, coord, vec4f(vec3f(ambientOcclusion), 1.0));
    return;
  }
  if (mode == 7) {
    textureStore(outputTexture, coord, vec4f(vec3f(material.x), 1.0));
    return;
  }
  if (mode == 8) {
    textureStore(outputTexture, coord, vec4f(vec3f(material.y), 1.0));
    return;
  }
  if (mode == 9) {
    textureStore(outputTexture, coord, vec4f(vec3f(material.z), 1.0));
    return;
  }
  if (mode == 10) {
    textureStore(outputTexture, coord, vec4f(emissive, 1.0));
    return;
  }
  if (mode == 11) {
    textureStore(outputTexture, coord, vec4f(vec3f(material.w), 1.0));
    return;
  }

  let position = reconstructGBufferViewPosition(coord, depth, dims, params.projection);
  let viewDirection = normalize(-position);
  let lightCount = u32(clamp(params.control.x, 0.0, ${checkedMaxLights}.0));
  // 拡散アンビエントにはSSAOと材質のenergy配分を適用し、shadowは直接光で評価する
  // emissiveは独立した発光成分として扱い、ambientと分けて一度だけ加算する
  let indirectOcclusion = ambientOcclusion * material.w;
  let ambientDiffuse = evaluateAmbientDiffuse(
    albedo.rgb,
    normal,
    viewDirection,
    material,
    params.directionalColorAmbient.w,
    indirectOcclusion
  );
  var environmentLighting = vec3f(0.0);
  var specularIbl = vec3f(0.0);
  if (params.environmentControl.x >= 0.5) {
    let ibl = evaluateImageBasedLighting(
      albedo.rgb,
      normal,
      viewDirection,
      material,
      indirectOcclusion
    );
    environmentLighting = ibl.diffuse + ibl.specular;
    specularIbl = ibl.specular;
  }
  // SSR合成はこの鏡面IBLだけを置換し、拡散IBL、直接光、emissiveを保持します
  textureStore(specularIblOutputTexture, coord, vec4f(specularIbl, 1.0));
  var lighting = ambientDiffuse + environmentLighting + emissive;

  if (params.control.z >= 0.5) {
    let surfaceToLight = normalize(-params.directionalDirectionIntensity.xyz);
    let radiance = params.directionalColorAmbient.rgb
      * params.directionalDirectionIntensity.w;
    lighting += evaluateDirectBrdf(
      albedo.rgb,
      normal,
      viewDirection,
      surfaceToLight,
      material,
      radiance
    ) * shadowVisibility;
${caustics ? WATER_LIGHTING_DIFFUSE : ""}
  }

  if (params.control.w >= 0.5) {
    let lightVector = params.spotPositionRadius.xyz - position;
    let distance = length(lightVector);
    let radius = params.spotPositionRadius.w;
    if (distance < radius && distance > 0.0001) {
      let surfaceToLight = lightVector / distance;
      let lightToSurface = -surfaceToLight;
      let spotCos = dot(normalize(params.spotDirectionIntensity.xyz), lightToSurface);
      let innerCos = params.spotColorInner.w;
      let outerCos = params.spotCone.x;
      let cone = clamp((spotCos - outerCos) / (innerCos - outerCos), 0.0, 1.0);
      let attenuation = pbrEvaluateDistanceAttenuation(
        distance,
        radius,
        params.spotCone.y,
        params.spotCone.z
      );
      let radiance = params.spotColorInner.rgb
        * params.spotDirectionIntensity.w
        * attenuation
        * cone;
      // coneはライト形状、visibilityは遮蔽物として別々に一度だけ評価する
      lighting += evaluateDirectBrdf(
        albedo.rgb,
        normal,
        viewDirection,
        surfaceToLight,
        material,
        radiance
      ) * spotShadowVisibility;
    }
  }

  // 単純化のためpixelごとに全Local Lightを走査し、距離と放射角の減衰を一度だけ適用します
  for (var i = 0u; i < ${checkedMaxLights}u; i += 1u) {
    if (i < lightCount) {
      let light = lights[i];
      let delta = light.positionRadius.xyz - position;
      let distance = length(delta);
      let radius = light.positionRadius.w;
      if (distance < radius && distance > 0.0001) {
        let surfaceToLight = delta / distance;
        let lightToSurface = -surfaceToLight;
        let angularAttenuation = pbrEvaluateLocalLightAngularAttenuation(
          light,
          lightToSurface
        );
        // cone内の画素でGGXのBRDFを評価し、放射範囲に応じた負荷に抑える
        if (angularAttenuation > 0.0) {
          let distanceAttenuation = pbrEvaluateDistanceAttenuation(
            distance,
            radius,
            light.outerCosAndType.z,
            light.outerCosAndType.w
          );
          let radiance = light.colorIntensity.rgb
            * light.colorIntensity.w
            * distanceAttenuation
            * angularAttenuation;
          lighting += evaluateDirectBrdf(
            albedo.rgb,
            normal,
            viewDirection,
            surfaceToLight,
            material,
            radiance
          );
        }
      }
    }
  }

  // 線形照明値を保持し、tone mappingとdisplay gamma変換は後段へ渡す
  // 最終表示変換を一度だけ行うことで、SSRなど後続effectが物理的な輝度を読めるようにする
  textureStore(outputTexture, coord, vec4f(lighting, 1.0));
}`;
}

// G-bufferを読む多数ライト評価を1クラスへまとめ、uniform、light buffer、出力targetを管理する
// Scene更新、Geometry Pass、canvasへのcopyはアプリケーション側へ残し、責務をlightingだけへ絞る
export default class DeferredLightingPass {
  // 出力サイズ、最大light数、内部ComputePassを確定し、毎frame使うGPU resourceを先に作る
  constructor(gpu, options = {}) {
    if (!gpu?.device || !gpu?.queue) {
      throw new Error("DeferredLightingPass requires a ready WebGPU context");
    }
    this.gpu = gpu;
    this.label = util.readOptionalString(
      options.label,
      "DeferredLightingPass label",
      "deferred-lighting",
      { trim: true, allowEmpty: false }
    );
    this.width = util.readOptionalInteger(
      options.width,
      `${this.label} width`,
      1,
      { min: 1 }
    );
    this.height = util.readOptionalInteger(
      options.height,
      `${this.label} height`,
      1,
      { min: 1 }
    );
    this.format = util.readOptionalString(
      options.format,
      `${this.label} format`,
      DEFERRED_LIGHTING_OUTPUT_FORMAT,
      { trim: true, allowEmpty: false }
    );
    if (this.format !== DEFERRED_LIGHTING_OUTPUT_FORMAT) {
      throw new Error(
        `${this.label} format must be ${DEFERRED_LIGHTING_OUTPUT_FORMAT}`
      );
    }
    this.maxLights = util.readOptionalInteger(
      options.maxLights,
      `${this.label} maxLights`,
      DEFERRED_LIGHTING_DEFAULTS.maxLights,
      { min: 1 }
    );
    this.targetFactory = options.targetFactory ?? new StorageTargetFactory(gpu, {
      label: `${this.label}:storage`,
      format: this.format
    });
    if (this.targetFactory.format !== this.format) {
      throw new Error(
        `${this.label} StorageTargetFactory format must be ${this.format}`
      );
    }
    this.outputTarget = this.targetFactory.create({
      label: `${this.label}:output`,
      width: this.width,
      height: this.height,
      format: this.format
    });
    // 最終照明から鏡面IBLだけを分離し、SSRの置換元として同じ解像度に保持します
    this.specularIblTarget = this.targetFactory.create({
      label: `${this.label}:specular-ibl`,
      width: this.width,
      height: this.height,
      format: this.format
    });
    this.lightData = new Float32Array(
      this.maxLights * DEFERRED_LOCAL_LIGHT_STRIDE_FLOATS
    );
    this.lightBuffer = gpu.device.createBuffer({
      label: `${this.label}:lights`,
      size: this.lightData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    this.currentLightCount = 0;
    this.currentForwardMainLight = null;
    // IBL無効時も固定layoutを満たすだけの零textureを用意し、shaderの有効flagで読取を止めます
    this.emptyIrradianceTexture = gpu.device.createTexture({
      label: `${this.label}:empty-irradiance`,
      size: [1, 1, 1],
      format: "rgba16float",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    });
    this.emptySpecularTexture = gpu.device.createTexture({
      label: `${this.label}:empty-specular`,
      size: [1, 1, 1],
      format: "rgba16float",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    });
    this.emptyBrdfLutTexture = gpu.device.createTexture({
      label: `${this.label}:empty-brdf-lut`,
      size: [1, 1, 1],
      format: "rg16float",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    });
    this.emptyRadianceTexture = gpu.device.createTexture({
      label: `${this.label}:empty-radiance`,
      size: [1, 1, 1],
      format: "rgba32float",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    });
    this.emptyEnvironmentSampler = gpu.device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "linear",
      addressModeU: "repeat",
      addressModeV: "clamp-to-edge"
    });
    this.computePass = new ComputePass(gpu, {
      label: this.label,
      code: buildDeferredLightingWgsl(this.maxLights),
      uniformFloats: 52,
      bindings: [
        { binding: 0, name: "params", type: "uniform-buffer" },
        { binding: 1, name: "albedo", type: "sampled-texture" },
        { binding: 2, name: "normal", type: "sampled-texture" },
        { binding: 3, name: "depth", type: "depth-texture" },
        { binding: 4, name: "material", type: "sampled-texture" },
        { binding: 5, name: "lights", type: "read-only-storage-buffer" },
        { binding: 6, name: "shadowVisibility", type: "sampled-texture" },
        { binding: 7, name: "spotShadowVisibility", type: "sampled-texture" },
        { binding: 8, name: "ambientOcclusion", type: "sampled-texture" },
        {
          binding: 9,
          name: "output",
          type: "storage-texture",
          format: this.format,
          dispatchSize: true
        },
        { binding: 10, name: "irradiance", type: "sampled-texture" },
        { binding: 11, name: "prefilteredSpecular", type: "sampled-texture" },
        { binding: 12, name: "brdfLut", type: "sampled-texture" },
        { binding: 13, name: "environmentSampler", type: "sampler" },
        { binding: 14, name: "emissive", type: "sampled-texture" },
        {
          binding: 15,
          name: "radiance",
          type: "sampled-texture",
          sampleType: "unfilterable-float"
        },
        {
          binding: 16,
          name: "specularIblOutput",
          type: "storage-texture",
          format: this.format
        }
      ]
    });
    this.ready = Promise.all([this.outputTarget.ready, this.specularIblTarget.ready]);
    this.destroyed = false;
  }

  // 通常の17bindingは維持し、水が必要な間だけ専用variantを所有する
  // 専用の照明variantを準備し、既存computePassとWGSLの接続を維持する
  async prepareCaustics() {
    this.requireAlive();
    if (this.causticsComputePass) return;
    const pass = new ComputePass(this.gpu, {
      label: `${this.label}:caustics`,
      code: buildDeferredLightingWgsl(this.maxLights, { caustics: true }),
      uniformFloats: 52,
      bindings: [...this.computePass.bindings,
        { binding: 17, name: "causticParams", type: "read-only-storage-buffer" },
        { binding: 18, name: "causticField", type: "sampled-texture" },
        { binding: 19, name: "causticSampler", type: "sampler" },
        { binding: 20, name: "causticMask", type: "sampled-texture" }]
    });
    try {
      const info = await pass.shaderModule.getCompilationInfo();
      const errors = info.messages.filter(m => m.type === "error");
      if (errors.length) throw new Error(errors.map(m => m.message).join("\n"));
      this.requireAlive();
      this.causticsComputePass = pass;
    } catch (error) { pass.destroy(); throw error; }
  }

  // 集光専用variantを解放し、通常照明のpassを継続して使う状態へ戻す
  releaseCaustics() {
    this.causticsComputePass?.destroy();
    this.causticsComputePass = null;
  }

  // encode前に共通resourceが生きているかを確認し、destroy後の誤使用を早い段階で止める
  requireAlive() {
    if (this.destroyed) {
      throw new Error(`${this.label} is destroyed`);
    }
  }

  // G-buffer生成時と同じCamera Frameから投影paramとlight用view-space変換を取得する
  // 一frameのCameraFrameからprojectionとview matrixをまとめて受け取り、カメラ状態を統一する
  validateCameraFrame(cameraFrame) {
    const projection = createGBufferProjectionParams(cameraFrame);
    if (typeof cameraFrame.worldPointToView !== "function") {
      throw new Error(`${this.label} cameraFrame must provide worldPointToView(point)`);
    }
    return { cameraFrame, projection };
  }

  // G-buffer resourceはalbedo、normal、depthが揃って初めてlighting評価できるため、必要resourceを明示する
  validateResources(resources) {
    const checked = util.readPlainObject(resources, `${this.label} resources`);
    const albedo = checked.albedo ?? checked.color;
    const normal = checked.normal;
    const depth = checked.depth;
    const material = checked.material;
    const emissive = checked.emissive;
    const shadowVisibility = checked.shadowVisibility;
    const spotShadowVisibility = checked.spotShadowVisibility;
    const ambientOcclusion = checked.ambientOcclusion;
    if (!albedo || typeof albedo.getView !== "function") {
      throw new Error(`${this.label} resources require albedo or color target`);
    }
    if (!normal || typeof normal.getView !== "function") {
      throw new Error(`${this.label} resources require normal target`);
    }
    if (!material || typeof material.getView !== "function") {
      throw new Error(`${this.label} resources require material target`);
    }
    if (!emissive || typeof emissive.getView !== "function") {
      throw new Error(`${this.label} resources require emissive target`);
    }
    if (
      !depth ||
      (
        typeof depth.getDepthSampleView !== "function" &&
        typeof depth.getDepthView !== "function"
      )
    ) {
      throw new Error(`${this.label} resources require depth target`);
    }
    if (depth.depthConvention !== CAMERA_REVERSE_Z) {
      throw new Error(`${this.label} depth target must use CAMERA_REVERSE_Z`);
    }
    if (!shadowVisibility || typeof shadowVisibility.getView !== "function") {
      throw new Error(`${this.label} resources require shadowVisibility target`);
    }
    if (!spotShadowVisibility || typeof spotShadowVisibility.getView !== "function") {
      throw new Error(`${this.label} resources require spotShadowVisibility target`);
    }
    if (!ambientOcclusion || typeof ambientOcclusion.getView !== "function") {
      throw new Error(`${this.label} resources require ambientOcclusion target`);
    }
    const width = util.readFiniteNumber(
      albedo.getWidth?.() ?? this.outputTarget.getWidth(),
      `${this.label} albedo width`,
      { integer: true, min: 1 }
    );
    const height = util.readFiniteNumber(
      albedo.getHeight?.() ?? this.outputTarget.getHeight(),
      `${this.label} albedo height`,
      { integer: true, min: 1 }
    );
    if (width !== this.outputTarget.getWidth() || height !== this.outputTarget.getHeight()) {
      throw new Error(
        `${this.label} G-buffer size ${width}x${height} does not match output size `
        + `${this.outputTarget.getWidth()}x${this.outputTarget.getHeight()}`
      );
    }
    const materialWidth = material.getWidth?.();
    const materialHeight = material.getHeight?.();
    if (materialWidth !== width || materialHeight !== height) {
      throw new Error(
        `${this.label} material size ${materialWidth}x${materialHeight} `
        + `does not match G-buffer size ${width}x${height}`
      );
    }
    const emissiveWidth = emissive.getWidth?.();
    const emissiveHeight = emissive.getHeight?.();
    if (emissiveWidth !== width || emissiveHeight !== height) {
      throw new Error(
        `${this.label} emissive size ${emissiveWidth}x${emissiveHeight} `
        + `does not match G-buffer size ${width}x${height}`
      );
    }
    const shadowWidth = shadowVisibility.getWidth?.();
    const shadowHeight = shadowVisibility.getHeight?.();
    if (shadowWidth !== width || shadowHeight !== height) {
      throw new Error(
        `${this.label} shadowVisibility size ${shadowWidth}x${shadowHeight} `
        + `does not match G-buffer size ${width}x${height}`
      );
    }
    const spotShadowWidth = spotShadowVisibility.getWidth?.();
    const spotShadowHeight = spotShadowVisibility.getHeight?.();
    if (spotShadowWidth !== width || spotShadowHeight !== height) {
      throw new Error(
        `${this.label} spotShadowVisibility size ${spotShadowWidth}x${spotShadowHeight} `
        + `does not match G-buffer size ${width}x${height}`
      );
    }
    const aoWidth = ambientOcclusion.getWidth?.();
    const aoHeight = ambientOcclusion.getHeight?.();
    if (aoWidth !== width || aoHeight !== height) {
      throw new Error(
        `${this.label} ambientOcclusion size ${aoWidth}x${aoHeight} `
        + `does not match G-buffer size ${width}x${height}`
      );
    }
    return {
      albedo,
      normal,
      depth,
      material,
      emissive,
      shadowVisibility,
      spotShadowVisibility,
      ambientOcclusion
    };
  }

  // IBLを使う場合は前処理済みtexture、sampler、mip数、強度をすべて必須にします
  // 入力resource一式をencode時点で検証し、不完全な構成をエラーとして報告する
  validateEnvironment(
    environment,
    intensity,
    ambient,
    backgroundEnabled,
    rotationDegrees
  ) {
    const checked = validatePbrEnvironmentResources(environment, intensity, this.label);
    if (checked === null) {
      if (backgroundEnabled) {
        throw new Error(`${this.label} environmentBackground requires environment`);
      }
      if (rotationDegrees !== 0.0) {
        throw new Error(`${this.label} environmentRotationDegrees requires environment`);
      }
      return {
        enabled: false,
        intensity: 0.0,
        specularMipCount: 1.0,
        irradiance: this.emptyIrradianceTexture.createView(),
        prefilteredSpecular: this.emptySpecularTexture.createView(),
        brdfLut: this.emptyBrdfLutTexture.createView(),
        radiance: this.emptyRadianceTexture.createView(),
        sampler: this.emptyEnvironmentSampler
      };
    }
    if (ambient !== 0.0) {
      throw new Error(`${this.label} ambient must be 0 when environment is enabled`);
    }
    if (backgroundEnabled && checked.radiance === null) {
      throw new Error(`${this.label} environmentBackground requires environment.radiance`);
    }
    const rotationRadians = rotationDegrees * Math.PI / 180.0;
    return {
      enabled: true,
      intensity: checked.intensity,
      specularMipCount: checked.specularMipCount,
      irradiance: checked.irradiance,
      prefilteredSpecular: checked.prefilteredSpecular,
      brdfLut: checked.brdfLut,
      radiance: checked.radiance ?? this.emptyRadianceTexture.createView(),
      backgroundEnabled,
      rotationCos: Math.cos(rotationRadians),
      rotationSin: Math.sin(rotationRadians),
      sampler: checked.sampler
    };
  }

  // 主要directional lightを検証し、World方向をCamera Frameのview-spaceへ回転します
  // nullはdirectional lightなしを明示し、optionの省略はdirectional light未指定として拒否します
  validateDirectionalLight(cameraFrame, directionalLight, unitSystem) {
    if (directionalLight === null) {
      return {
        enabled: false,
        direction: [0.0, 0.0, -1.0],
        color: [0.0, 0.0, 0.0],
        intensity: 0.0,
        unitSystem
      };
    }
    const light = util.readPlainObject(
      directionalLight,
      `${this.label} directionalLight`
    );
    const direction = util.readColor(
      light.direction,
      `${this.label} directionalLight.direction`,
      undefined,
      3
    );
    const length = Math.hypot(...direction);
    if (length <= 1.0e-8) {
      throw new Error(`${this.label} directionalLight.direction has zero length`);
    }
    const normalized = direction.map((value) => value / length);
    const viewDirection = cameraFrame.viewRotationMatrix.mul3x3Vector(normalized);
    return {
      enabled: true,
      direction: viewDirection,
      color: util.readColor(
        light.color,
        `${this.label} directionalLight.color`,
        undefined,
        3
      ),
      intensity: util.readFiniteNumber(
        light.intensity,
        `${this.label} directionalLight.intensity`,
        { min: 0.0 }
      ),
      unitSystem
    };
  }

  // spot lightのWorld位置と方向をCamera Frameでview-spaceへ変換し、coneと距離範囲を検証します
  // cone減衰は照明形状、spotShadowVisibilityは遮蔽物としてshader内で別々に評価します
  validateSpotLight(cameraFrame, spotLight, unitSystem) {
    if (spotLight === null) {
      return {
        enabled: false,
        position: [0.0, 0.0, 0.0],
        direction: [0.0, 0.0, -1.0],
        color: [0.0, 0.0, 0.0],
        radius: 1.0,
        intensity: 0.0,
        innerCos: 1.0,
        outerCos: 0.0,
        unitSystem,
        minimumDistance: 0.0
      };
    }
    const light = util.readPlainObject(spotLight, `${this.label} spotLight`);
    const position = util.readColor(
      light.position,
      `${this.label} spotLight.position`,
      undefined,
      3
    );
    const direction = util.readColor(
      light.direction,
      `${this.label} spotLight.direction`,
      undefined,
      3
    );
    const directionLength = Math.hypot(...direction);
    if (directionLength <= 1.0e-8) {
      throw new Error(`${this.label} spotLight.direction has zero length`);
    }
    const innerCos = util.readFiniteNumber(
      light.innerCos,
      `${this.label} spotLight.innerCos`,
      { min: -1.0, max: 1.0 }
    );
    const outerCos = util.readFiniteNumber(
      light.outerCos,
      `${this.label} spotLight.outerCos`,
      { min: -1.0, max: 1.0 }
    );
    if (innerCos <= outerCos) {
      throw new Error(`${this.label} spotLight.innerCos must be greater than outerCos`);
    }
    const radius = util.readFiniteNumber(
      light.radius,
      `${this.label} spotLight.radius`,
      { minExclusive: 0.0 }
    );
    let minimumDistance = 0.0;
    if (unitSystem === "photometric") {
      if (light.minimumDistance === undefined) {
        throw new Error(
          `${this.label} spotLight.minimumDistance is required in photometric mode`
        );
      }
      minimumDistance = util.readFiniteNumber(
        light.minimumDistance,
        `${this.label} spotLight.minimumDistance`,
        { minExclusive: 0.0, max: radius }
      );
    } else if (light.minimumDistance !== undefined) {
      throw new Error(
        `${this.label} spotLight.minimumDistance requires photometric unitSystem`
      );
    }
    const normalizedDirection = direction.map((value) => value / directionLength);
    return {
      enabled: true,
      position: cameraFrame.worldPointToView(position),
      direction: cameraFrame.viewRotationMatrix.mul3x3Vector(normalizedDirection),
      color: util.readColor(
        light.color,
        `${this.label} spotLight.color`,
        undefined,
        3
      ),
      radius,
      intensity: util.readFiniteNumber(
        light.intensity,
        `${this.label} spotLight.intensity`,
        { min: 0.0 }
      ),
      innerCos,
      outerCos,
      unitSystem,
      minimumDistance
    };
  }

  // Local Lightの公開入力を検証し、GPUへ書き込むview-spaceデータへ一度だけ正規化します
  // coneの必須fieldを検証し、不足を入力作成側のエラーとしてencode時点で報告する
  validateLights(cameraFrame, lights, lightCount, unitSystem) {
    if (!Array.isArray(lights)) {
      throw new Error(`${this.label} lights must be an array`);
    }
    const count = util.readOptionalInteger(
      lightCount,
      `${this.label} lightCount`,
      lights.length,
      { min: 0, max: this.maxLights }
    );
    if (count > lights.length) {
      throw new Error(`${this.label} lightCount exceeds lights.length`);
    }
    const checkedLights = [];
    for (let index = 0; index < count; index += 1) {
      const prefix = `${this.label} lights[${index}]`;
      const light = util.readPlainObject(lights[index], `${this.label} lights[${index}]`);
      if (light.type === undefined) {
        throw new Error(`${prefix}.type is required`);
      }
      const type = util.readOptionalEnum(
        light.type,
        `${prefix}.type`,
        undefined,
        DEFERRED_LOCAL_LIGHT_TYPES
      );
      const worldPosition = util.readVec3(light.position, `${prefix}.position`);
      const color = util.readColor(light.color, `${prefix}.color`, undefined, 3);
      const radius = util.readFiniteNumber(light.radius, `${prefix}.radius`, {
        minExclusive: 0
      });
      let minimumDistance = 0.0;
      if (unitSystem === "photometric") {
        if (light.minimumDistance === undefined) {
          throw new Error(`${prefix}.minimumDistance is required in photometric mode`);
        }
        minimumDistance = util.readFiniteNumber(
          light.minimumDistance,
          `${prefix}.minimumDistance`,
          { minExclusive: 0.0, max: radius }
        );
      } else if (light.minimumDistance !== undefined) {
        throw new Error(`${prefix}.minimumDistance requires photometric unitSystem`);
      }
      const intensity = util.readFiniteNumber(light.intensity, `${prefix}.intensity`, {
        min: 0
      });
      const position = util.readVec3(
        cameraFrame.worldPointToView(worldPosition),
        `${prefix} view-space position`
      );

      let direction = [0.0, 0.0, -1.0];
      let innerCos = 1.0;
      let outerCos = 0.0;
      if (type === "cone") {
        const worldDirection = util.readVec3(light.direction, `${prefix}.direction`);
        const worldDirectionLength = Math.hypot(...worldDirection);
        if (worldDirectionLength <= 1.0e-8) {
          throw new Error(`${prefix}.direction has zero length`);
        }
        const innerAngle = util.readFiniteNumber(
          light.innerAngle,
          `${prefix}.innerAngle`,
          { minExclusive: 0.0, max: 90.0 }
        );
        const outerAngle = util.readFiniteNumber(
          light.outerAngle,
          `${prefix}.outerAngle`,
          { minExclusive: 0.0, max: 90.0 }
        );
        if (innerAngle >= outerAngle) {
          throw new Error(`${prefix}.innerAngle must be less than outerAngle`);
        }
        const normalizedWorldDirection = worldDirection.map(
          (value) => value / worldDirectionLength
        );
        const rotatedDirection = util.readVec3(
          cameraFrame.viewRotationMatrix.mul3x3Vector(normalizedWorldDirection),
          `${prefix} view-space direction`
        );
        const rotatedDirectionLength = Math.hypot(...rotatedDirection);
        if (rotatedDirectionLength <= 1.0e-8) {
          throw new Error(`${prefix} view-space direction has zero length`);
        }
        direction = rotatedDirection.map((value) => value / rotatedDirectionLength);
        innerCos = Math.cos(innerAngle * Math.PI / 180.0);
        outerCos = Math.cos(outerAngle * Math.PI / 180.0);
      }

      checkedLights.push({
        type,
        typeId: DEFERRED_LOCAL_LIGHT_TYPE_IDS[type],
        position,
        color,
        radius,
        intensity,
        direction,
        innerCos,
        outerCos,
        minimumDistance,
        unitSystem
      });
    }
    return checkedLights;
  }

  // light配列をview-spaceのGPU storage bufferへ詰め替え、view mode込みでlighting dispatchを記録する
  encode(commandEncoder, resources, options = {}) {
    this.requireAlive();
    const checkedResources = this.validateResources(resources);
    const { cameraFrame, projection } = this.validateCameraFrame(options.cameraFrame);
    const unitSystem = util.readOptionalEnum(
      options.unitSystem,
      `${this.label} unitSystem`,
      "relative",
      DEFERRED_LIGHTING_UNIT_SYSTEMS
    );
    if (!Object.prototype.hasOwnProperty.call(options, "directionalLight")) {
      throw new Error(`${this.label} directionalLight option is required; use null for none`);
    }
    const directional = this.validateDirectionalLight(
      cameraFrame,
      options.directionalLight,
      unitSystem
    );
    if (!Object.prototype.hasOwnProperty.call(options, "spotLight")) {
      throw new Error(`${this.label} spotLight option is required; use null for none`);
    }
    const spot = this.validateSpotLight(cameraFrame, options.spotLight, unitSystem);
    this.currentForwardMainLight = spot.enabled ? {
      type: "spot",
      position: spot.position,
      direction: spot.direction,
      radius: spot.radius,
      innerCos: spot.innerCos,
      outerCos: spot.outerCos,
      photometric: unitSystem === "photometric",
      minimumDistance: spot.minimumDistance
    } : directional.enabled ? {
      type: "directional",
      photometric: unitSystem === "photometric"
    } : null;
    const ambient = util.readOptionalFiniteNumber(
      options.ambient,
      `${this.label} ambient`,
      DEFERRED_LIGHTING_DEFAULTS.ambient,
      { min: 0.0, max: 1.0 }
    );
    const environmentBackground = util.readOptionalBoolean(
      options.environmentBackground,
      `${this.label} environmentBackground`,
      false
    );
    const environmentRotationDegrees = util.readOptionalFiniteNumber(
      options.environmentRotationDegrees,
      `${this.label} environmentRotationDegrees`,
      0.0
    );
    const environment = this.validateEnvironment(
      options.environment,
      options.environmentIntensity,
      ambient,
      environmentBackground,
      environmentRotationDegrees
    );
    const view = util.readOptionalEnum(
      options.view,
      `${this.label} view`,
      DEFERRED_LIGHTING_DEFAULTS.view,
      DEFERRED_LIGHTING_VIEW_MODES
    );
    const localLights = this.validateLights(
      cameraFrame,
      options.lights,
      options.lightCount,
      unitSystem
    );
    const lightCount = localLights.length;
    this.currentLightCount = lightCount;

    this.lightData.fill(0.0);
    for (let index = 0; index < lightCount; index += 1) {
      const light = localLights[index];
      const offset = index * DEFERRED_LOCAL_LIGHT_STRIDE_FLOATS;
      this.lightData.set([
        light.position[0],
        light.position[1],
        light.position[2],
        light.radius
      ], offset);
      this.lightData.set([
        light.color[0],
        light.color[1],
        light.color[2],
        light.intensity
      ], offset + 4);
      this.lightData.set([
        light.direction[0],
        light.direction[1],
        light.direction[2],
        light.innerCos
      ], offset + 8);
      this.lightData.set([
        light.outerCos,
        light.typeId,
        unitSystem === "photometric" ? 1.0 : 0.0,
        light.minimumDistance
      ], offset + 12);
    }
    this.gpu.queue.writeBuffer(this.lightBuffer, 0, this.lightData);

    const viewMode = view === "albedo" ? 1.0
      : view === "normal" ? 2.0
        : view === "depth" ? 3.0
          : view === "shadow" ? 4.0
            : view === "spotShadow" ? 5.0
              : view === "ao" ? 6.0
                : view === "specular" ? 7.0
                  : view === "roughness" ? 8.0
                    : view === "metallic" ? 9.0
                      : view === "emissive" ? 10.0
                        : view === "occlusion" ? 11.0
                          : 0.0;
    const compute = options.caustics ? this.causticsComputePass : this.computePass;
    if (!compute) throw new Error("prepareCaustics() must complete before encode");
    this.currentEnvironment = environment;
    compute.setUniforms([
      ...projection,
      lightCount,
      viewMode,
      directional.enabled ? 1.0 : 0.0,
      spot.enabled ? 1.0 : 0.0,
      directional.direction[0],
      directional.direction[1],
      directional.direction[2],
      directional.intensity,
      directional.color[0],
      directional.color[1],
      directional.color[2],
      ambient,
      spot.position[0],
      spot.position[1],
      spot.position[2],
      spot.radius,
      spot.direction[0],
      spot.direction[1],
      spot.direction[2],
      spot.intensity,
      spot.color[0],
      spot.color[1],
      spot.color[2],
      spot.innerCos,
      spot.outerCos,
      unitSystem === "photometric" ? 1.0 : 0.0,
      spot.minimumDistance,
      0.0,
      cameraFrame.cameraWorldMatrix.mat[0],
      cameraFrame.cameraWorldMatrix.mat[4],
      cameraFrame.cameraWorldMatrix.mat[8],
      0.0,
      cameraFrame.cameraWorldMatrix.mat[1],
      cameraFrame.cameraWorldMatrix.mat[5],
      cameraFrame.cameraWorldMatrix.mat[9],
      0.0,
      cameraFrame.cameraWorldMatrix.mat[2],
      cameraFrame.cameraWorldMatrix.mat[6],
      cameraFrame.cameraWorldMatrix.mat[10],
      0.0,
      environment.enabled ? 1.0 : 0.0,
      environment.intensity,
      environment.specularMipCount,
      environment.backgroundEnabled ? 1.0 : 0.0,
      environment.rotationCos ?? 1.0,
      environment.rotationSin ?? 0.0,
      0.0,
      0.0
    ]);
    compute.encode(commandEncoder, {
      ...(options.caustics ?? {}),
      albedo: checkedResources.albedo,
      normal: checkedResources.normal,
      depth: checkedResources.depth,
      material: checkedResources.material,
      emissive: checkedResources.emissive,
      lights: this.lightBuffer,
      shadowVisibility: checkedResources.shadowVisibility,
      spotShadowVisibility: checkedResources.spotShadowVisibility,
      ambientOcclusion: checkedResources.ambientOcclusion,
      irradiance: environment.irradiance,
      prefilteredSpecular: environment.prefilteredSpecular,
      brdfLut: environment.brdfLut,
      environmentSampler: environment.sampler,
      radiance: environment.radiance,
      output: this.outputTarget,
      specularIblOutput: this.specularIblTarget
    }, {
      timestampWrites: options.timestampWrites
    });
    return this.outputTarget;
  }

  // 外部のscreen resizeに追従してlighting結果と鏡面IBL targetを同じ寸法へ更新する
  resize(width, height) {
    this.requireAlive();
    this.width = util.readFiniteNumber(width, `${this.label} width`, {
      integer: true,
      min: 1
    });
    this.height = util.readFiniteNumber(height, `${this.label} height`, {
      integer: true,
      min: 1
    });
    const outputChanged = resizeTarget(this.outputTarget, this.width, this.height);
    const specularIblChanged = resizeTarget(
      this.specularIblTarget,
      this.width,
      this.height
    );
    return outputChanged || specularIblChanged;
  }

  // fullscreen copyやdebug表示で使うlighting結果のtargetを外部へ返す
  getOutputTarget() {
    this.requireAlive();
    return this.outputTarget;
  }

  // 同じframeのSSR Composerが置換元に使う鏡面IBL専用targetを返す
  getSpecularIblTarget() {
    this.requireAlive();
    return this.specularIblTarget;
  }

  // 同じframeの透明Forward描画が検証・変換済みLocal Lightを再利用できる形で返します
  // encode前の零件状態も明示し、公開lights配列を一度だけGPU形式へ変換します
  getLocalLightBindingResources() {
    this.requireAlive();
    return {
      buffer: this.lightBuffer,
      count: this.currentLightCount,
      maxLights: this.maxLights,
      mainLight: this.currentForwardMainLight
    };
  }

  // 内部ComputePass、storage buffer、output targetをまとめて解放し、二重解放も吸収する
  destroy() {
    if (this.destroyed) {
      return false;
    }
    this.releaseCaustics();
    this.computePass.destroy();
    this.lightBuffer.destroy();
    this.emptyIrradianceTexture.destroy();
    this.emptySpecularTexture.destroy();
    this.emptyBrdfLutTexture.destroy();
    this.emptyRadianceTexture.destroy();
    this.outputTarget.destroy();
    this.specularIblTarget.destroy();
    this.destroyed = true;
    return true;
  }
}
