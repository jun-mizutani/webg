// ---------------------------------------------
// PbrForwardShader.js  2026/10/04
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// Shared-GGX forward shader for HDR composition

import SmoothShader from "./SmoothShader.js";
import { COLOR_SPACE_WGSL } from "./ColorSpace.js";
import { PBR_BRDF_WGSL, PBR_IBL_WGSL, PBR_LOCAL_LIGHT_WGSL } from "./PbrBrdf.js";
import { validatePbrEnvironmentResources } from "./PbrEnvironment.js";
import {
  createViewToLightClip,
  validateStandardShadowDepth
} from "./ComputeShadowPass.js";
import { alignTo } from "./SkinningConfig.js";
import util from "./util.js";

export const PBR_FORWARD_DEFAULT_MAX_LIGHTS = 128;

// SmoothShaderのskinning、normal map、draw resource管理を保ち、照明式だけを共有GGXへ交換します
// 置換markerを必須とし、親shaderとの不一致を例外として報告する
export function buildPbrForwardHdrWgsl(
  smoothWgsl,
  maxLights = PBR_FORWARD_DEFAULT_MAX_LIGHTS,
  { waterDepthClip = false } = {}
) {
  if (typeof smoothWgsl !== "string" || smoothWgsl.length === 0) {
    throw new Error("PbrForwardShader requires non-empty SmoothShader WGSL");
  }
  const checkedMaxLights = util.readFiniteNumber(
    maxLights,
    "PbrForwardShader maxLights",
    { integer: true, min: 1 }
  );
  const vertexMarker = "      @vertex\n      fn vs_main";
  if (!smoothWgsl.includes(vertexMarker)) {
    throw new Error("PbrForwardShader could not find the vertex shader marker");
  }
  let output = smoothWgsl;
  if (waterDepthClip) {
    const fragmentStart = "fn fs_main(input : FragmentInput) -> @location(0) vec4<f32> {";
    if (!output.includes(fragmentStart)) throw new Error("Missing PBR fragment entry point");
    output = output.replace(fragmentStart, `${fragmentStart}
        let waterFront = textureLoad(waterDepth, vec2i(input.fragPosition.xy), 0);
        // Reverse-Zで水面より背後のfragmentだけを水中HDRへ入れる
        if (input.fragPosition.z >= waterFront - 0.000001) { discard; }
    `);
  }

  // 親SmoothShaderのFog／debug／Phong値を維持し、PBR材質値を専用uniformへ追加する
  // 構造末尾へvec4単位で追加し、WGSL uniform alignmentとCPU側offsetを一致させます
  const drawUniformEnd = `        debugColor : vec4<f32>,
        transmissionParams : vec4<f32>,
        volumeParams : vec4<f32>,
      };`;
  const pbrDrawUniformEnd = `        debugColor : vec4<f32>,
        transmissionParams : vec4<f32>,
        volumeParams : vec4<f32>,
        pbrMaterial : vec4<f32>,
        pbrEmissive : vec4<f32>,
        pbrRadiance : vec4<f32>,
      };`;
  if (!output.includes(drawUniformEnd)) {
    throw new Error("PbrForwardShader could not find the SmoothShader DrawUniforms end");
  }
  output = output.replace(drawUniformEnd, pbrDrawUniformEnd);
  output = output.replace(
    vertexMarker,
    `${COLOR_SPACE_WGSL}
${PBR_BRDF_WGSL}

${PBR_IBL_WGSL}

${PBR_LOCAL_LIGHT_WGSL}

${waterDepthClip ? "@group(3) @binding(8) var waterDepth : texture_depth_2d;" : ""}

struct PbrEnvironmentUniforms {
  viewToWorldRow0 : vec4f,
  viewToWorldRow1 : vec4f,
  viewToWorldRow2 : vec4f,
  // x = IBL有効、y = 強度、z = 鏡面map mip数、w = environment Y回転rad
  control : vec4f,
};

@group(3) @binding(0) var<uniform> pbrEnvironment : PbrEnvironmentUniforms;
@group(3) @binding(1) var pbrIrradianceTexture : texture_2d<f32>;
@group(3) @binding(2) var pbrSpecularTexture : texture_2d<f32>;
@group(3) @binding(3) var pbrBrdfLutTexture : texture_2d<f32>;
@group(3) @binding(4) var pbrEnvironmentSampler : sampler;

struct PbrFrameLightingUniforms {
  viewToLightClip : mat4x4f,
  // x = depth bias、y = normal bias、z = PCF radius、w = 予約
  shadowOptions : vec4f,
  shadowSize : vec4f,
  mainPositionRadius : vec4f,
  mainDirectionInner : vec4f,
  // x = outer cosine、y = photometric、z = minimum distance
  mainOuterAndModel : vec4f,
  // x = 0:none / 1:directional / 2:spot shadow、y = Local Light count、z = 0:directional / 1:spot
  control : vec4f,
};

@group(3) @binding(5) var<uniform> pbrFrameLighting : PbrFrameLightingUniforms;
@group(3) @binding(6) var pbrShadowDepthTexture : texture_depth_2d;
@group(3) @binding(7) var<storage, read> pbrLocalLights : array<LocalLight>;

// 透明fragment自身のview-space位置からshadow mapを参照します
// 不透明G-buffer位置で生成済みのscreen-space visibilityは透明面の位置と異なるため、透明面では独自に計算します
fn pbrEvaluateForwardShadow(
  viewPosition : vec3f,
  viewNormal : vec3f,
  surfaceToLight : vec3f
) -> f32 {
  if (pbrFrameLighting.control.x < 0.5) {
    return 1.0;
  }
  let clip = pbrFrameLighting.viewToLightClip * vec4f(viewPosition, 1.0);
  if (abs(clip.w) <= 0.000001) {
    return 1.0;
  }
  let ndc = clip.xyz / clip.w;
  let uv = vec2f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
  if (
    uv.x < 0.0 || uv.x > 1.0 ||
    uv.y < 0.0 || uv.y > 1.0 ||
    ndc.z < 0.0 || ndc.z > 1.0
  ) {
    return 1.0;
  }
  let slope = 1.0 - max(dot(viewNormal, surfaceToLight), 0.0);
  let receiverDepth = ndc.z
    - pbrFrameLighting.shadowOptions.x
    - pbrFrameLighting.shadowOptions.y * slope;
  let center = vec2i(clamp(
    uv * pbrFrameLighting.shadowSize.xy,
    vec2f(0.0),
    pbrFrameLighting.shadowSize.xy - vec2f(1.0)
  ));
  let radius = i32(pbrFrameLighting.shadowOptions.z);
  var visible = 0.0;
  var samples = 0.0;
  for (var y = -2; y <= 2; y += 1) {
    for (var x = -2; x <= 2; x += 1) {
      if (abs(x) <= radius && abs(y) <= radius) {
        let coord = clamp(
          center + vec2i(x, y),
          vec2i(0),
          vec2i(pbrFrameLighting.shadowSize.xy) - vec2i(1)
        );
        let storedDepth = textureLoad(pbrShadowDepthTexture, coord, 0);
        visible += select(0.0, 1.0, receiverDepth <= storedDepth);
        samples += 1.0;
      }
    }
  }
  return visible / max(samples, 1.0);
}

// directionalは距離減衰なし、spotはcone形状と選択中の距離modelを一度ずつ適用します
fn pbrEvaluateForwardMainLightAttenuation(viewPosition : vec3f) -> f32 {
  if (pbrFrameLighting.control.z < 0.5) {
    return 1.0;
  }
  let delta = pbrFrameLighting.mainPositionRadius.xyz - viewPosition;
  let distance = length(delta);
  let radius = pbrFrameLighting.mainPositionRadius.w;
  if (distance >= radius || distance <= 0.0001) {
    return 0.0;
  }
  let lightToSurface = -delta / distance;
  let coneCos = dot(pbrFrameLighting.mainDirectionInner.xyz, lightToSurface);
  let angularAttenuation = smoothstep(
    pbrFrameLighting.mainOuterAndModel.x,
    pbrFrameLighting.mainDirectionInner.w,
    coneCos
  );
  return angularAttenuation * pbrEvaluateDistanceAttenuation(
    distance,
    radius,
    pbrFrameLighting.mainOuterAndModel.y,
    pbrFrameLighting.mainOuterAndModel.z
  );
}

// 環境照明用の方向を、カメラ回転の基底でworld-spaceへ戻す
fn pbrEnvironmentViewToWorld(direction : vec3f) -> vec3f {
  return normalize(vec3f(
    dot(pbrEnvironment.viewToWorldRow0.xyz, direction),
    dot(pbrEnvironment.viewToWorldRow1.xyz, direction),
    dot(pbrEnvironment.viewToWorldRow2.xyz, direction)
  ));
}

// 方向ベクトルから経度と緯度を求め、環境画像のUVへ変換する
fn pbrEnvironmentDirectionToUv(direction : vec3f) -> vec2f {
  let normalized = normalize(direction);
  let u = atan2(normalized.z, normalized.x) / (2.0 * 3.14159265) + 0.5;
  let v = acos(clamp(normalized.y, -1.0, 1.0)) / 3.14159265;
  return vec2f(u, v);
}

// 環境画像の回転角をworld-space方向へ適用し、採取方向を揃える
fn pbrEnvironmentWorldToTextureDirection(direction : vec3f) -> vec3f {
  let cosine = cos(pbrEnvironment.control.w);
  let sine = sin(pbrEnvironment.control.w);
  return normalize(vec3f(
    cosine * direction.x - sine * direction.z,
    direction.y,
    sine * direction.x + cosine * direction.z
  ));
}

// 環境画像から拡散・鏡面の照明を採取し、PBR材質の粗さと金属度で配分する
fn pbrEvaluateForwardIbl(
  baseColor : vec3f,
  normal : vec3f,
  viewDirection : vec3f,
  metallic : f32,
  roughness : f32,
  dielectricF0 : vec3f,
  ambientOcclusion : f32
) -> vec3f {
  let nDotV = max(dot(normal, viewDirection), 0.0);
  let normalWorld = pbrEnvironmentWorldToTextureDirection(
    pbrEnvironmentViewToWorld(normal)
  );
  let reflectionWorld = pbrEnvironmentWorldToTextureDirection(
    pbrEnvironmentViewToWorld(reflect(-viewDirection, normal))
  );
  let irradiance = textureSampleLevel(
    pbrIrradianceTexture,
    pbrEnvironmentSampler,
    pbrEnvironmentDirectionToUv(normalWorld),
    0.0
  ).rgb;
  let maxLod = max(pbrEnvironment.control.z - 1.0, 0.0);
  let prefiltered = textureSampleLevel(
    pbrSpecularTexture,
    pbrEnvironmentSampler,
    pbrEnvironmentDirectionToUv(reflectionWorld),
    roughness * maxLod
  ).rgb;
  let brdf = textureSampleLevel(
    pbrBrdfLutTexture,
    pbrEnvironmentSampler,
    pbrClampBrdfLutUv(
      vec2f(nDotV, roughness),
      textureDimensions(pbrBrdfLutTexture)
    ),
    0.0
  ).rg;
  return pbrEvaluateIblResponse(
    baseColor,
    metallic,
    roughness,
    dielectricF0,
    nDotV,
    irradiance,
    prefiltered,
    brdf,
    ambientOcclusion,
    pbrEnvironment.control.y
  );
}

${vertexMarker}`
  );

  const baseTextureBindings = `      @group(1) @binding(0) var mySampler : sampler;
      @group(1) @binding(1) var myTexture : texture_2d<f32>;
      @group(1) @binding(2) var myNormalTexture : texture_2d<f32>;`;
  const pbrTextureBindings = `${baseTextureBindings}
      @group(1) @binding(3) var metallicRoughnessSampler : sampler;
      @group(1) @binding(4) var metallicRoughnessTexture : texture_2d<f32>;
      @group(1) @binding(5) var occlusionSampler : sampler;
      @group(1) @binding(6) var occlusionTexture : texture_2d<f32>;
      @group(1) @binding(7) var emissiveSampler : sampler;
      @group(1) @binding(8) var emissiveTexture : texture_2d<f32>;`;
  if (!output.includes(baseTextureBindings)) {
    throw new Error("PbrForwardShader could not find the SmoothShader texture bindings");
  }
  output = output.replace(baseTextureBindings, pbrTextureBindings);

  const lightingStart = "        var litVec : vec3<f32>;";
  const lightingEnd = "        var finalColor : vec4<f32>;";
  const startIndex = output.indexOf(lightingStart);
  const endIndex = output.indexOf(lightingEnd, startIndex);
  if (startIndex < 0 || endIndex < 0) {
    throw new Error("PbrForwardShader could not find the SmoothShader lighting block");
  }
  const directionBlock = `        var litVec : vec3<f32>;
        if (u.lightPos.w != 0.0) {
          litVec = normalize(u.lightPos.xyz - input.vPosition);
        } else {
          litVec = normalize(u.lightPos.xyz);
        }
        let eyeVec = normalize(-input.vPosition);

`;
  output = output.slice(0, startIndex) + directionBlock + output.slice(endIndex);

  const textureBlock = `        if (u.flags.y != 0.0) {
          let texColor = textureSample(myTexture, mySampler, input.vTexCoord);
          finalColor = u.color * texColor;
          finalColor = mix(diff * u.color, finalColor, u.color.w);
        } else {
          finalColor = u.color;
        }`;
  const pbrTextureBlock = `        if (u.flags.y != 0.0) {
          let texColor = textureSample(myTexture, mySampler, input.vTexCoord);
          // RGB factorはu.color、透明度factorはu.normalMapParams.yへ分離済みなので、
          // finalColor.aにはtexture alphaだけを保持してfactorの二重乗算を避けます
          finalColor = vec4f(u.color.rgb * texColor.rgb, texColor.a);
        } else {
          finalColor = vec4f(u.color.rgb, 1.0);
        }`;
  if (!output.includes(textureBlock)) {
    throw new Error("PbrForwardShader could not find the SmoothShader base-color block");
  }
  output = output.replace(textureBlock, pbrTextureBlock);

  const debugBackfaceBlock = `        if (u.debugFlags.x != 0.0 && !input.frontFacing) {
          return vec4<f32>(u.debugColor.rgb, 1.0);
        }`;
  if (!output.includes(debugBackfaceBlock)) {
    throw new Error("PbrForwardShader could not find the SmoothShader backface debug block");
  }
  // frontFacing依存の早期returnを後続texture samplingより前へ置くと、WGSL uniformity解析が
  // implicit derivativeを拒否するため、最終色をselectするboolだけをここで保持します
  output = output.replace(
    debugBackfaceBlock,
    "        let pbrDebugBackface = u.debugFlags.x != 0.0 && !input.frontFacing;"
  );

  const rgbLine = "        let rgb = finalColor.rgb * (uAmb + diff) + vec3<f32>(1.0, 1.0, 1.0) * ispec;";
  const pbrLighting = `        // PBR専用uniformは親のPhong、Fog、debug値と別領域に保持します
        let baseColor = srgbToLinear(clamp(finalColor.rgb, vec3f(0.0), vec3f(1.0)));
        var metallic = clamp(u.pbrMaterial.x, 0.0, 1.0);
        var roughness = clamp(u.normalMapParams.z, 0.04, 1.0);
        if (u.pbrMaterial.z != 0.0) {
          let metallicRoughnessSample = textureSample(
            metallicRoughnessTexture,
            metallicRoughnessSampler,
            input.vTexCoord
          );
          roughness = clamp(roughness * metallicRoughnessSample.g, 0.04, 1.0);
          metallic = clamp(metallic * metallicRoughnessSample.b, 0.0, 1.0);
        }
        var materialOcclusion = clamp(u.pbrMaterial.y, 0.0, 1.0);
        if (u.pbrMaterial.w != 0.0) {
          materialOcclusion *= textureSample(
            occlusionTexture,
            occlusionSampler,
            input.vTexCoord
          ).r;
        }
        let dielectricF0 = vec3f(0.04 * uSpec);
        // double-sided pipelineで到達する裏面は法線を視点側へ反転します
        // 片面pipelineでは裏面が除外されるため同じ式を共有できます
        let pbrNormal = select(-nnormal, nnormal, input.frontFacing);
        var directLinear = pbrEvaluateDirectBrdf(
          baseColor,
          pbrNormal,
          eyeVec,
          litVec,
          metallic,
          roughness,
          dielectricF0,
          max(u.pbrRadiance.rgb, vec3f(0.0))
        );
        directLinear *= pbrEvaluateForwardMainLightAttenuation(input.vPosition);
        directLinear *= pbrEvaluateForwardShadow(
          input.vPosition,
          pbrNormal,
          litVec
        );
        let localLightCount = u32(pbrFrameLighting.control.y);
        for (var lightIndex = 0u; lightIndex < ${checkedMaxLights}u; lightIndex += 1u) {
          if (lightIndex < localLightCount) {
            let localLight = pbrLocalLights[lightIndex];
            let localDelta = localLight.positionRadius.xyz - input.vPosition;
            let localDistance = length(localDelta);
            let localRadius = localLight.positionRadius.w;
            if (localDistance < localRadius && localDistance > 0.0001) {
              let localSurfaceToLight = localDelta / localDistance;
              let localAngularAttenuation = pbrEvaluateLocalLightAngularAttenuation(
                localLight,
                -localSurfaceToLight
              );
              if (localAngularAttenuation > 0.0) {
                let localDistanceAttenuation = pbrEvaluateDistanceAttenuation(
                  localDistance,
                  localRadius,
                  localLight.outerCosAndType.z,
                  localLight.outerCosAndType.w
                );
                let localRadiance = localLight.colorIntensity.rgb
                  * localLight.colorIntensity.w
                  * localDistanceAttenuation
                  * localAngularAttenuation;
                directLinear += pbrEvaluateDirectBrdf(
                  baseColor,
                  pbrNormal,
                  eyeVec,
                  localSurfaceToLight,
                  metallic,
                  roughness,
                  dielectricF0,
                  localRadiance
                );
              }
            }
          }
        }
        var indirectLinear = vec3f(0.0);
        if (pbrEnvironment.control.x >= 0.5) {
          indirectLinear = pbrEvaluateForwardIbl(
            baseColor,
            pbrNormal,
            eyeVec,
            metallic,
            roughness,
            dielectricF0,
            materialOcclusion
          );
        }
        var emissiveLinear = baseColor * uEmit + u.pbrEmissive.rgb;
        if (u.pbrEmissive.w != 0.0) {
          let emissiveSrgb = textureSample(
            emissiveTexture,
            emissiveSampler,
            input.vTexCoord
          ).rgb;
          emissiveLinear = baseColor * uEmit
            + srgbToLinear(emissiveSrgb) * u.pbrEmissive.rgb;
        }
        // TransparencyPassの出力はrgba16floatなので、Tone MapやsRGB変換を後段へ渡します
        let rgb = directLinear + indirectLinear + emissiveLinear;`;
  if (!output.includes(rgbLine)) {
    throw new Error("PbrForwardShader could not find the SmoothShader output lighting line");
  }
  output = output.replace(rgbLine, pbrLighting);
  const alphaLine = "        let lit = vec4<f32>(rgb, u.normalMapParams.y);";
  if (!output.includes(alphaLine)) {
    throw new Error("PbrForwardShader could not find the SmoothShader alpha output line");
  }
  // BLENDのsurface Alphaへ非Transmission分を配分し、未屈折背景を残さず
  // surface radianceと屈折済みdestinationの二成分として合成します
  output = output.replace(
    alphaLine,
    `        let materialSurfaceAlpha = u.normalMapParams.y * finalColor.a;
        let effectiveTransmission = clamp(
          u.transmissionParams.x * u.transmissionParams.w,
          0.0,
          1.0
        );
        let physicalSurfaceAlpha = 1.0
          - effectiveTransmission * (1.0 - materialSurfaceAlpha);
        let surfaceAlpha = select(
          materialSurfaceAlpha,
          physicalSurfaceAlpha,
          effectiveTransmission > 0.0
        );
        let lit = vec4<f32>(rgb, surfaceAlpha);`
  );
  const finalReturn = "        return vec4<f32>(outputRgb, lit.a);";
  if (!output.includes(finalReturn)) {
    throw new Error("PbrForwardShader could not find the SmoothShader final return");
  }
  return output.replace(
    finalReturn,
    `        let pbrOutput = vec4<f32>(outputRgb, lit.a);
        return select(pbrOutput, vec4f(u.debugColor.rgb, 1.0), pbrDebugBackface);`
  );
}

// 透明物と将来の特殊材質がDeferredと同じ直接光式を使うための前方HDR shaderです
export default class PbrForwardShader extends SmoothShader {
  // 親の描画基盤を初期化し、PBR材質・環境光・局所光を保持する資源を準備する
  constructor(gpu, options = {}) {
    super(gpu, {
      ...options,
      roughnessSpecular: false
    });

    // SmoothShaderのDrawUniforms末尾へPBR専用vec4を3個追加します
    // 元uniformDataを保持して拡張し、Fog／debug／Phongの既存offsetを維持します
    const smoothUniformData = this.uniformData;
    this.OFF_PBR_MATERIAL = this.UNIFORM_FLOAT_COUNT;
    this.OFF_PBR_EMISSIVE = this.OFF_PBR_MATERIAL + 4;
    this.OFF_PBR_RADIANCE = this.OFF_PBR_EMISSIVE + 4;
    this.UNIFORM_FLOAT_COUNT = this.OFF_PBR_RADIANCE + 4;
    this.UNIFORM_SIZE = this.UNIFORM_FLOAT_COUNT * Float32Array.BYTES_PER_ELEMENT;
    this.uniformStride = alignTo(this.UNIFORM_SIZE, 256);
    this.uniformData = new Float32Array(this.UNIFORM_FLOAT_COUNT);
    this.uniformData.set(smoothUniformData);

    this.default.ambient = 0.0;
    this.default.specular = 1.0;
    this.default.power = 0.0;
    this.default.metallic = 0.0;
    this.default.roughness = 0.5;
    this.default.radiance = [1.0, 1.0, 1.0];
    this.default.occlusion = 1.0;
    this.default.emissive_factor = [0.0, 0.0, 0.0];
    this.default.use_metallic_roughness_texture = 0;
    this.default.metallic_roughness_texture = null;
    this.default.use_occlusion_texture = 0;
    this.default.occlusion_texture = null;
    this.default.use_emissive_texture = 0;
    this.default.emissive_texture = null;
    this.pbrTextureBindGroupCache = new Map();
    this.pbrTextureResourceIds = new WeakMap();
    this.nextPbrTextureResourceId = 1;
    this.pbrEnvironmentBindGroupLayout = null;
    this.maxLights = util.readOptionalInteger(
      options.maxLights,
      "PbrForwardShader maxLights",
      PBR_FORWARD_DEFAULT_MAX_LIGHTS,
      { min: 1 }
    );
    this.pbrFrameLightingUniformBuffer = null;
    this.pbrFrameLightingUniformData = new Float32Array(40);
    this.pbrFrameLightingBindGroup = null;
    this.pbrFrameLightingBindingState = null;
    this.pbrEnvironmentBindingResources = null;
    this.pbrFrameLightingBindingResources = null;
    this.emptyShadowDepthTexture = null;
    this.emptyLocalLightBuffer = null;
    this.pbrEnvironmentUniformBuffer = null;
    this.pbrEnvironmentUniformData = new Float32Array(16);
    this.pbrEnvironmentBindGroup = null;
    this.pbrEnvironmentBindingState = null;
    this.emptyIrradianceTexture = null;
    this.emptySpecularTexture = null;
    this.emptyBrdfLutTexture = null;
    this.emptyIrradianceView = null;
    this.emptySpecularView = null;
    this.emptyBrdfLutView = null;
    this.emptyEnvironmentSampler = null;
    this.defaultMetallicRoughnessTexture = null;
    this.defaultOcclusionTexture = null;
    this.defaultEmissiveTexture = null;
    // GPU resource生成前にPBR既定値をCPU uniformへ確定し、最初のdrawにも未指定値を適用します
    this.setMetallic(this.default.metallic);
    this.setOcclusion(this.default.occlusion);
    this.setUseMetallicRoughnessTexture(this.default.use_metallic_roughness_texture);
    this.setUseOcclusionTexture(this.default.use_occlusion_texture);
    this.setEmissiveFactor(this.default.emissive_factor);
    this.setUseEmissiveTexture(this.default.use_emissive_texture);
    this.setRadiance(this.default.radiance);
    this.waterDepthClip = options.waterDepthClip === true;
    this.wgslSrc = buildPbrForwardHdrWgsl(this.wgslSrc, this.maxLights, { waterDepthClip: this.waterDepthClip });
  }

  // TransparencyPass全体のTransmission倍率を材質値とは別channelへ保存する
  // 0は通常Alpha合成、正値は非Transmission分をPBR surfaceへ配分する物理合成を表す
  setTransmissionPassScale(value) {
    if (!Number.isFinite(value) || value < 0.0 || value > 1.0) {
      throw new Error(
        "PbrForwardShader transmission pass scale must be a finite number between 0.0 and 1.0"
      );
    }
    this.uniformData[this.OFF_TRANSMISSION + 3] = Number(value);
    this.updateUniforms();
  }

  // WebGPUが返すWGSL compiler messageをinit()で検査できるようmodule作成時に保持します
  createShaderModule(code) {
    const module = super.createShaderModule(code);
    this.pbrCompilationInfoPromise = typeof module.getCompilationInfo === "function"
      ? module.getCompilationInfo()
      : null;
    return module;
  }

  // pipeline validationの二次errorだけでなく、最初のWGSL行番号とmessageを例外へ含めます
  async init() {
    const initialized = await super.init();
    if (this.pbrCompilationInfoPromise) {
      const info = await this.pbrCompilationInfoPromise;
      const errors = info.messages.filter((message) => message.type === "error");
      if (errors.length > 0) {
        const details = errors.map((message) => (
          `line ${message.lineNum}:${message.linePos} ${message.message}`
        )).join(" | ");
        throw new Error(`PbrForwardShader WGSL compilation failed: ${details}`);
      }
    }
    return initialized;
  }

  // base／normalに続けてglTF互換の3種類のPBR textureと個別samplerを追加します
  getAdditionalGroup1LayoutEntries() {
    return [
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
      { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 5, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
      { binding: 6, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 7, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
      { binding: 8, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } }
    ];
  }

  // IBL、shadow map、Local Lightをframe共通group3へまとめ、4 bind-group上限内に収めます
  createAdditionalBindGroupLayouts() {
    if (this.backgroundFrost) {
      throw new Error("PbrForwardShader cannot combine PBR environment group with background Frost group");
    }
    this.pbrEnvironmentBindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" }
        },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        {
          binding: 5,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" }
        },
        {
          binding: 6,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "depth" }
        },
        {
          binding: 7,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: "read-only-storage" }
        },
        ...(this.waterDepthClip ? [{ binding: 8, visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "depth" } }] : [])
      ]
    });
    return [this.pbrEnvironmentBindGroupLayout];
  }

  // PBR入力の無効状態を表す、材質値を保つ1x1の既定textureを作る
  // 有効flagが1の場合はtextureを必須とし、完全なresourceだけを描画へ渡す
  createPbrDefaultTexture(label, bytes) {
    const texture = this.device.createTexture({
      label,
      size: [1, 1, 1],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    });
    this.gpu.queue.writeTexture(
      { texture },
      new Uint8Array(bytes),
      { bytesPerRow: 4 },
      { width: 1, height: 1, depthOrArrayLayers: 1 }
    );
    return texture;
  }

  // SmoothShaderが既定group1を作る時点で追加bindingも完全に埋めます
  getAdditionalDefaultGroup1Entries() {
    this.defaultMetallicRoughnessTexture = this.createPbrDefaultTexture(
      "PbrForwardShader:default-metallic-roughness",
      [255, 255, 255, 255]
    );
    this.defaultOcclusionTexture = this.createPbrDefaultTexture(
      "PbrForwardShader:default-occlusion",
      [255, 255, 255, 255]
    );
    this.defaultEmissiveTexture = this.createPbrDefaultTexture(
      "PbrForwardShader:default-emissive",
      [0, 0, 0, 255]
    );
    return [
      { binding: 3, resource: this.defaultSampler },
      { binding: 4, resource: this.defaultMetallicRoughnessTexture.createView() },
      { binding: 5, resource: this.defaultSampler },
      { binding: 6, resource: this.defaultOcclusionTexture.createView() },
      { binding: 7, resource: this.defaultSampler },
      { binding: 8, resource: this.defaultEmissiveTexture.createView() }
    ];
  }

  // IBL無効時もlayoutを満たす零textureをbindし、enabled=0でshaderからの読取を止めます
  createAdditionalResources() {
    this.pbrEnvironmentUniformBuffer = this.device.createBuffer({
      label: "PbrForwardShader:environment-uniforms",
      size: this.pbrEnvironmentUniformData.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    // 既定の環境textureを準備し、環境照明のbindingへ渡せる資源を返す
    const createEnvironmentTexture = (label, format) => this.device.createTexture({
      label,
      size: [1, 1, 1],
      format,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    });
    this.emptyIrradianceTexture = createEnvironmentTexture(
      "PbrForwardShader:empty-irradiance",
      "rgba16float"
    );
    this.emptySpecularTexture = createEnvironmentTexture(
      "PbrForwardShader:empty-specular",
      "rgba16float"
    );
    this.emptyBrdfLutTexture = createEnvironmentTexture(
      "PbrForwardShader:empty-brdf-lut",
      "rg16float"
    );
    this.emptyIrradianceView = this.emptyIrradianceTexture.createView();
    this.emptySpecularView = this.emptySpecularTexture.createView();
    this.emptyBrdfLutView = this.emptyBrdfLutTexture.createView();
    this.emptyEnvironmentSampler = this.device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "linear",
      addressModeU: "repeat",
      addressModeV: "clamp-to-edge"
    });
    this.pbrFrameLightingUniformBuffer = this.device.createBuffer({
      label: "PbrForwardShader:frame-lighting-uniforms",
      size: this.pbrFrameLightingUniformData.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.emptyShadowDepthTexture = this.device.createTexture({
      label: "PbrForwardShader:empty-shadow-depth",
      size: [1, 1, 1],
      format: "depth32float",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT
    });
    this.emptyLocalLightBuffer = this.device.createBuffer({
      label: "PbrForwardShader:empty-local-light",
      size: 64,
      usage: GPUBufferUsage.STORAGE
    });
    this.setEnvironment(null, undefined, null);
    this.setFrameLighting(null, null);
  }

  // Texture wrapper、RenderTarget、GPUTextureを共通のview／samplerへ解決します
  resolvePbrTexture(texture, label) {
    const resolved = this.resolveTextureResources(texture);
    const isInternalDefault = texture === this.defaultNormalTexture
      || texture === this.defaultMetallicRoughnessTexture
      || texture === this.defaultOcclusionTexture
      || texture === this.defaultEmissiveTexture;
    if (!resolved.view || (!resolved.sampler && !isInternalDefault)) {
      throw new Error(`PbrForwardShader requires ${label} texture and sampler`);
    }
    return {
      view: resolved.view,
      sampler: resolved.sampler ?? this.defaultSampler
    };
  }

  // resource参照から安定したcache IDを作り、材質textureの組合せをframe間で再利用します
  getPbrTextureResourceId(resource) {
    if (!resource || (typeof resource !== "object" && typeof resource !== "function")) {
      return String(resource);
    }
    let id = this.pbrTextureResourceIds.get(resource);
    if (id === undefined) {
      id = this.nextPbrTextureResourceId;
      this.nextPbrTextureResourceId += 1;
      this.pbrTextureResourceIds.set(resource, id);
    }
    return String(id);
  }

  // 現在drawのbase、normal、MR、AO、emissiveを一つのgroup1へ厳密に結び付けます
  getBindGroup1(texture) {
    const useTexture = this.uniformData[this.OFF_FLAGS + 1] !== 0.0;
    const useNormalMap = this.uniformData[this.OFF_FLAGS + 3] !== 0.0;
    const useMetallicRoughness = this.uniformData[this.OFF_PBR_MATERIAL + 2] !== 0.0;
    const useOcclusion = this.uniformData[this.OFF_PBR_MATERIAL + 3] !== 0.0;
    const useEmissive = this.uniformData[this.OFF_PBR_EMISSIVE + 3] !== 0.0;
    const baseTexture = texture ?? (!useTexture ? this.defaultTextureResource : null);
    const normalTexture = this.change.normal_texture
      ?? this.default.normal_texture
      ?? (!useNormalMap ? this.defaultNormalTexture : null);
    const metallicRoughnessTexture = this.change.metallic_roughness_texture
      ?? (!useMetallicRoughness ? this.defaultMetallicRoughnessTexture : null);
    const occlusionTexture = this.change.occlusion_texture
      ?? (!useOcclusion ? this.defaultOcclusionTexture : null);
    const emissiveTexture = this.change.emissive_texture
      ?? (!useEmissive ? this.defaultEmissiveTexture : null);
    if (!baseTexture) throw new Error("PbrForwardShader requires texture when use_texture is enabled");
    if (!normalTexture) throw new Error("PbrForwardShader requires normal_texture when enabled");
    if (!metallicRoughnessTexture) {
      throw new Error("PbrForwardShader requires metallic_roughness_texture when enabled");
    }
    if (!occlusionTexture) {
      throw new Error("PbrForwardShader requires occlusion_texture when enabled");
    }
    if (!emissiveTexture) {
      throw new Error("PbrForwardShader requires emissive_texture when enabled");
    }
    const resources = [
      this.resolvePbrTexture(baseTexture, "base-color"),
      this.resolvePbrTexture(normalTexture, "normal"),
      this.resolvePbrTexture(metallicRoughnessTexture, "metallic-roughness"),
      this.resolvePbrTexture(occlusionTexture, "occlusion"),
      this.resolvePbrTexture(emissiveTexture, "emissive")
    ];
    const cacheKey = [
      baseTexture,
      normalTexture,
      metallicRoughnessTexture,
      occlusionTexture,
      emissiveTexture
    ].map((resource) => this.getPbrTextureResourceId(resource)).join(":");
    let bindGroup = this.pbrTextureBindGroupCache.get(cacheKey);
    if (bindGroup) return bindGroup;
    bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout1,
      entries: [
        { binding: 0, resource: resources[0].sampler },
        { binding: 1, resource: resources[0].view },
        { binding: 2, resource: resources[1].view },
        { binding: 3, resource: resources[2].sampler },
        { binding: 4, resource: resources[2].view },
        { binding: 5, resource: resources[3].sampler },
        { binding: 6, resource: resources[3].view },
        { binding: 7, resource: resources[4].sampler },
        { binding: 8, resource: resources[4].view }
      ]
    });
    this.pbrTextureBindGroupCache.set(cacheKey, bindGroup);
    return bindGroup;
  }

  // metallicを共有材質範囲で検証し、Phong powerとは別のPBR専用slotへ格納します
  setMetallic(value) {
    this.uniformData[this.OFF_PBR_MATERIAL + 0] = util.readFiniteNumber(
      value,
      "PbrForwardShader metallic",
      { min: 0.0, max: 1.0 }
    );
    this.updateUniforms();
  }

  // 主要光源の線形RGB radianceをHDRのままuniformへ格納します
  setRadiance(value) {
    const radiance = util.readColor(value, "PbrForwardShader radiance", undefined, 3)
      .map((channel, index) => util.readFiniteNumber(
        channel,
        `PbrForwardShader radiance[${index}]`,
        { min: 0.0 }
      ));
    this.uniformData.set(radiance, this.OFF_PBR_RADIANCE);
    this.updateUniforms();
  }

  // PBR texture使用flagは0または1だけを受け、明示されたflagだけを有効化します
  setPbrTextureFlag(value, label, uniformOffset) {
    this.uniformData[uniformOffset] = util.readFiniteNumber(
      value,
      `PbrForwardShader ${label}`,
      { integer: true, min: 0, max: 1 }
    );
    this.updateUniforms();
  }

  // metallic-roughness textureの使用flagをuniformへ書き込み、次のdrawへ反映します
  setUseMetallicRoughnessTexture(value) {
    this.setPbrTextureFlag(
      value,
      "use_metallic_roughness_texture",
      this.OFF_PBR_MATERIAL + 2
    );
  }

  // occlusion textureの使用flagをuniformへ書き込み、次のdrawへ反映します
  setUseOcclusionTexture(value) {
    this.setPbrTextureFlag(
      value,
      "use_occlusion_texture",
      this.OFF_PBR_MATERIAL + 3
    );
  }

  // emissive textureの使用flagをuniformへ書き込み、次のdrawへ反映します
  setUseEmissiveTexture(value) {
    this.setPbrTextureFlag(
      value,
      "use_emissive_texture",
      this.OFF_PBR_EMISSIVE + 3
    );
  }

  // occlusion係数はIBLだけへ掛ける0から1の材質値として保持します
  setOcclusion(value) {
    this.uniformData[this.OFF_PBR_MATERIAL + 1] = util.readFiniteNumber(
      value,
      "PbrForwardShader occlusion",
      { min: 0.0, max: 1.0 }
    );
    this.updateUniforms();
  }

  // base colorから独立した線形HDR emissive RGBを1.0超過も保ったまま格納します
  setEmissiveFactor(value) {
    const factor = util.readColor(
      value,
      "PbrForwardShader emissive_factor",
      undefined,
      3
    ).map((channel, index) => util.readFiniteNumber(
      channel,
      `PbrForwardShader emissive_factor[${index}]`,
      { min: 0.0 }
    ));
    this.uniformData.set(factor, this.OFF_PBR_EMISSIVE);
    this.updateUniforms();
  }

  // Deferredと同じ前処理済みIBL集合を検証し、camera回転とともにgroup3へ設定します
  setEnvironment(environment, intensity, cameraFrame, rotationDegrees = 0.0) {
    const checkedEnvironment = validatePbrEnvironmentResources(
      environment,
      intensity,
      "PbrForwardShader"
    );
    const cameraWorldMatrix = cameraFrame?.cameraWorldMatrix?.mat ?? null;
    const checkedRotationDegrees = util.readFiniteNumber(
      rotationDegrees,
      "PbrForwardShader environmentRotationDegrees"
    );
    if (checkedEnvironment === null && checkedRotationDegrees !== 0.0) {
      throw new Error("PbrForwardShader environmentRotationDegrees requires environment");
    }
    if (checkedEnvironment !== null && !cameraWorldMatrix) {
      throw new Error("PbrForwardShader environment requires CameraFrame.cameraWorldMatrix");
    }
    let enabled = false;
    let checkedIntensity = 0.0;
    let specularMipCount = 1.0;
    let irradianceView = this.emptyIrradianceView;
    let specularView = this.emptySpecularView;
    let brdfLutView = this.emptyBrdfLutView;
    let sampler = this.emptyEnvironmentSampler;
    if (checkedEnvironment !== null) {
      enabled = true;
      checkedIntensity = checkedEnvironment.intensity;
      specularMipCount = checkedEnvironment.specularMipCount;
      irradianceView = checkedEnvironment.irradiance.getView();
      specularView = checkedEnvironment.prefilteredSpecular.getView();
      brdfLutView = checkedEnvironment.brdfLut.getView();
      sampler = checkedEnvironment.sampler;
    }
    const matrix = cameraWorldMatrix ?? [
      1.0, 0.0, 0.0, 0.0,
      0.0, 1.0, 0.0, 0.0,
      0.0, 0.0, 1.0, 0.0,
      0.0, 0.0, 0.0, 1.0
    ];
    this.pbrEnvironmentUniformData.set([
      matrix[0], matrix[4], matrix[8], 0.0,
      matrix[1], matrix[5], matrix[9], 0.0,
      matrix[2], matrix[6], matrix[10], 0.0,
      enabled ? 1.0 : 0.0,
      checkedIntensity,
      specularMipCount,
      checkedRotationDegrees * Math.PI / 180.0
    ]);
    this.gpu.queue.writeBuffer(
      this.pbrEnvironmentUniformBuffer,
      0,
      this.pbrEnvironmentUniformData
    );
    this.pbrEnvironmentBindingResources = [
      irradianceView,
      specularView,
      brdfLutView,
      sampler
    ];
    this.rebuildPbrFrameBindGroup();
  }

  // Shape.draw()から追加groupを通常のshader処理としてbindします
  getBindGroup3() {
    if (!this.pbrEnvironmentBindGroup) {
      throw new Error("PbrForwardShader environment resources have not been initialized");
    }
    return this.pbrEnvironmentBindGroup;
  }

  // 透明fragment自身でshadow mapを参照し、Deferredが詰めたLocal Light bufferをそのまま共有します
  // shadowまたはLocal Lightが明示的にnullならその機能を無効化し、不完全な有効入力は例外にします
  setFrameLighting(shadow, localLights) {
    let shadowMode = 0.0;
    let shadowView = this.emptyShadowDepthTexture.createView();
    let shadowWidth = 1.0;
    let shadowHeight = 1.0;
    let bias = 0.0;
    let normalBias = 0.0;
    let pcfRadius = 0.0;
    let viewToLightClip = [
      1.0, 0.0, 0.0, 0.0,
      0.0, 1.0, 0.0, 0.0,
      0.0, 0.0, 1.0, 0.0,
      0.0, 0.0, 0.0, 1.0
    ];
    if (shadow !== null) {
      const checkedShadow = util.readPlainObject(shadow, "PbrForwardShader shadow");
      const type = util.readOptionalEnum(
        checkedShadow.type,
        "PbrForwardShader shadow.type",
        undefined,
        ["directional", "spot"]
      );
      if (checkedShadow.type === undefined) {
        throw new Error("PbrForwardShader shadow.type is required");
      }
      if (!checkedShadow.cameraFrame) {
        throw new Error("PbrForwardShader shadow.cameraFrame is required");
      }
      if (!checkedShadow.lightViewProjection) {
        throw new Error("PbrForwardShader shadow.lightViewProjection is required");
      }
      const checkedDepth = validateStandardShadowDepth(
        checkedShadow.depth,
        "PbrForwardShader"
      );
      const depthView = checkedDepth.shadowDepth.getDepthSampleView?.()
        ?? checkedDepth.shadowDepth.getDepthView?.();
      if (!depthView) {
        throw new Error("PbrForwardShader shadow.depth must expose a depth sample view");
      }
      shadowMode = type === "directional" ? 1.0 : 2.0;
      shadowView = depthView;
      shadowWidth = checkedDepth.width;
      shadowHeight = checkedDepth.height;
      bias = util.readFiniteNumber(checkedShadow.bias, "PbrForwardShader shadow.bias", {
        min: 0.0
      });
      normalBias = util.readFiniteNumber(
        checkedShadow.normalBias,
        "PbrForwardShader shadow.normalBias",
        { min: 0.0 }
      );
      pcfRadius = util.readFiniteNumber(
        checkedShadow.pcfRadius,
        "PbrForwardShader shadow.pcfRadius",
        { integer: true, min: 0, max: 2 }
      );
      viewToLightClip = createViewToLightClip(
        checkedShadow.cameraFrame,
        checkedShadow.lightViewProjection
      ).mat;
    }

    let localLightBuffer = this.emptyLocalLightBuffer;
    let localLightCount = 0;
    let mainLightType = 0.0;
    let mainPositionRadius = [0.0, 0.0, 0.0, 1.0];
    let mainDirectionInner = [0.0, 0.0, -1.0, 1.0];
    let mainOuterAndModel = [0.0, 0.0, 0.0, 0.0];
    if (localLights !== null) {
      const checkedLights = util.readPlainObject(
        localLights,
        "PbrForwardShader localLights"
      );
      if (!checkedLights.buffer) {
        throw new Error("PbrForwardShader localLights.buffer is required");
      }
      const sharedMaxLights = util.readFiniteNumber(
        checkedLights.maxLights,
        "PbrForwardShader localLights.maxLights",
        { integer: true, min: 1 }
      );
      if (sharedMaxLights !== this.maxLights) {
        throw new Error(
          `PbrForwardShader localLights.maxLights ${sharedMaxLights} `
          + `does not match shader maxLights ${this.maxLights}`
        );
      }
      localLightCount = util.readFiniteNumber(
        checkedLights.count,
        "PbrForwardShader localLights.count",
        { integer: true, min: 0, max: this.maxLights }
      );
      localLightBuffer = checkedLights.buffer;
      if (!Object.prototype.hasOwnProperty.call(checkedLights, "mainLight")) {
        throw new Error("PbrForwardShader localLights.mainLight is required");
      }
      if (checkedLights.mainLight !== null) {
        const mainLight = util.readPlainObject(
          checkedLights.mainLight,
          "PbrForwardShader localLights.mainLight"
        );
        const type = util.readOptionalEnum(
          mainLight.type,
          "PbrForwardShader localLights.mainLight.type",
          undefined,
          ["directional", "spot"]
        );
        if (mainLight.type === undefined) {
          throw new Error("PbrForwardShader localLights.mainLight.type is required");
        }
        if (type === "spot") {
          const position = util.readVec3(
            mainLight.position,
            "PbrForwardShader localLights.mainLight.position"
          );
          const direction = util.readVec3(
            mainLight.direction,
            "PbrForwardShader localLights.mainLight.direction"
          );
          const radius = util.readFiniteNumber(
            mainLight.radius,
            "PbrForwardShader localLights.mainLight.radius",
            { minExclusive: 0.0 }
          );
          const innerCos = util.readFiniteNumber(
            mainLight.innerCos,
            "PbrForwardShader localLights.mainLight.innerCos",
            { min: -1.0, max: 1.0 }
          );
          const outerCos = util.readFiniteNumber(
            mainLight.outerCos,
            "PbrForwardShader localLights.mainLight.outerCos",
            { min: -1.0, max: 1.0 }
          );
          if (innerCos <= outerCos) {
            throw new Error(
              "PbrForwardShader localLights.mainLight.innerCos must be greater than outerCos"
            );
          }
          const photometric = util.readOptionalBoolean(
            mainLight.photometric,
            "PbrForwardShader localLights.mainLight.photometric",
            false
          );
          const minimumDistance = util.readFiniteNumber(
            mainLight.minimumDistance,
            "PbrForwardShader localLights.mainLight.minimumDistance",
            { min: 0.0, max: radius }
          );
          if (photometric && minimumDistance <= 0.0) {
            throw new Error(
              "PbrForwardShader localLights.mainLight.minimumDistance must be > 0 in photometric mode"
            );
          }
          mainLightType = 1.0;
          mainPositionRadius = [...position, radius];
          mainDirectionInner = [...direction, innerCos];
          mainOuterAndModel = [
            outerCos,
            photometric ? 1.0 : 0.0,
            minimumDistance,
            0.0
          ];
        }
      }
    }

    this.pbrFrameLightingUniformData.set(viewToLightClip, 0);
    this.pbrFrameLightingUniformData.set([bias, normalBias, pcfRadius, 0.0], 16);
    this.pbrFrameLightingUniformData.set([shadowWidth, shadowHeight, 0.0, 0.0], 20);
    this.pbrFrameLightingUniformData.set(mainPositionRadius, 24);
    this.pbrFrameLightingUniformData.set(mainDirectionInner, 28);
    this.pbrFrameLightingUniformData.set(mainOuterAndModel, 32);
    this.pbrFrameLightingUniformData.set([
      shadowMode,
      localLightCount,
      mainLightType,
      0.0
    ], 36);
    this.gpu.queue.writeBuffer(
      this.pbrFrameLightingUniformBuffer,
      0,
      this.pbrFrameLightingUniformData
    );
    this.pbrFrameLightingBindingResources = [shadowView, localLightBuffer];
    this.rebuildPbrFrameBindGroup();
  }

  // WebGPUの4 bind-group下限内へ収めるため、IBLとframe lightingを一つのgroup3へまとめます
  // 材質単位group1を再利用し、frameで共通するresource集合を更新する
  rebuildPbrFrameBindGroup() {
    if (!this.pbrEnvironmentBindingResources || !this.pbrFrameLightingBindingResources
      || (this.waterDepthClip && !this.waterDepthView)) {
      return;
    }
    const nextState = [
      ...this.pbrEnvironmentBindingResources,
      ...this.pbrFrameLightingBindingResources,
      ...(this.waterDepthClip ? [this.waterDepthView] : [])
    ];
    const sameState = this.pbrFrameLightingBindingState
      && nextState.every((resource, index) => (
        resource === this.pbrFrameLightingBindingState[index]
      ));
    if (sameState) return;
    const [irradianceView, specularView, brdfLutView, sampler] =
      this.pbrEnvironmentBindingResources;
    const [shadowView, localLightBuffer] = this.pbrFrameLightingBindingResources;
    this.pbrEnvironmentBindGroup = this.device.createBindGroup({
      layout: this.pbrEnvironmentBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.pbrEnvironmentUniformBuffer } },
        { binding: 1, resource: irradianceView },
        { binding: 2, resource: specularView },
        { binding: 3, resource: brdfLutView },
        { binding: 4, resource: sampler },
        { binding: 5, resource: { buffer: this.pbrFrameLightingUniformBuffer } },
        { binding: 6, resource: shadowView },
        { binding: 7, resource: { buffer: localLightBuffer } },
        ...(this.waterDepthClip ? [{ binding: 8, resource: this.waterDepthView }] : [])
      ]
    });
    this.pbrFrameLightingBindingState = nextState;
  }

  // Shape materialの共通名を親shaderへ反映した後、PBR専用値をdrawごとに必ず確定します
  // field省略時は前の材質値を残さず現在のPBR既定値へ戻します
  doParameter(param) {
    super.doParameter(param);
    this.setMetallic(param.metallic ?? this.default.metallic);
    this.setRadiance(param.radiance ?? this.default.radiance);
    this.setUseMetallicRoughnessTexture(
      param.use_metallic_roughness_texture
        ?? this.default.use_metallic_roughness_texture
    );
    this.setUseOcclusionTexture(
      param.use_occlusion_texture ?? this.default.use_occlusion_texture
    );
    this.setUseEmissiveTexture(
      param.use_emissive_texture ?? this.default.use_emissive_texture
    );
    this.setOcclusion(param.occlusion ?? this.default.occlusion);
    this.setEmissiveFactor(param.emissive_factor ?? this.default.emissive_factor);
    if (param.emissive_factor !== undefined
        && param.emissive !== undefined
        && Number(param.emissive) !== 0.0) {
      throw new Error(
        "PbrForwardShader emissive_factor cannot be combined with legacy emissive"
      );
    }
    for (const key of [
      "metallic_roughness_texture",
      "occlusion_texture",
      "emissive_texture"
    ]) {
      this.change[key] = param[key] ?? this.default[key];
    }
  }

  // appまたはpassが設定するPBR既定値を受け、その他のparameterは親shaderへ委ねます
  setDefaultParam(key, value) {
    if (key === "metallic") {
      this.default.metallic = value;
      this.setMetallic(value);
      return;
    }
    if (key === "radiance") {
      this.default.radiance = [...value];
      this.setRadiance(value);
      return;
    }
    if (key === "use_metallic_roughness_texture") {
      this.default[key] = value;
      this.setUseMetallicRoughnessTexture(value);
      return;
    }
    if (key === "use_occlusion_texture") {
      this.default[key] = value;
      this.setUseOcclusionTexture(value);
      return;
    }
    if (key === "use_emissive_texture") {
      this.default[key] = value;
      this.setUseEmissiveTexture(value);
      return;
    }
    if (key === "occlusion") {
      this.default[key] = value;
      this.setOcclusion(value);
      return;
    }
    if (key === "emissive_factor") {
      this.default[key] = [...value];
      this.setEmissiveFactor(value);
      return;
    }
    super.setDefaultParam(key, value);
  }

  // PBR専用の既定textureと環境resourceを破棄してから親shaderのresourceを解放します
  destroy() {
    this.defaultMetallicRoughnessTexture?.destroy?.();
    this.defaultOcclusionTexture?.destroy?.();
    this.defaultEmissiveTexture?.destroy?.();
    this.emptyIrradianceTexture?.destroy?.();
    this.emptySpecularTexture?.destroy?.();
    this.emptyBrdfLutTexture?.destroy?.();
    this.emptyShadowDepthTexture?.destroy?.();
    this.emptyLocalLightBuffer?.destroy?.();
    this.pbrEnvironmentUniformBuffer?.destroy?.();
    this.pbrFrameLightingUniformBuffer?.destroy?.();
    this.pbrTextureBindGroupCache.clear();
    this.pbrEnvironmentBindGroup = null;
    this.pbrFrameLightingBindGroup = null;
    return super.destroy();
  }
}
