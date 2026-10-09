// ---------------------------------------------
// PbrBrdf.js  2026/08/04
//   Shared metallic-roughness direct-light BRDF
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// 非金属の既定F0は屈折率約1.5に相当する4%反射率を線形値で表します
export const PBR_DIELECTRIC_F0 = 0.04;

// GGXの分母がroughness 0で特異になることを避けるため、材質入力で保証する下限を共有します
// shader内で暗黙補正せず、CPU側の材質検証で範囲外を検出します
export const PBR_MIN_ROUGHNESS = 0.04;

// F0=1の方向別single-scatter albedoを除算するときの数値下限です
// 理論上0へ近い値でも無限大をshaderへ伝播させず、CPU評価とWGSLで同じ値を使用します
export const PBR_MIN_DIRECTIONAL_ALBEDO = 1.0e-4;

// DeferredとForwardが同じ64 byte配列要素を読むためのLocal Light WGSL断片です
// JavaScript側でview-spaceへ変換済みの値だけを受け、shaderではview-spaceの座標系を使います
export const PBR_LOCAL_LIGHT_WGSL = `
struct LocalLight {
  positionRadius : vec4f,
  colorIntensity : vec4f,
  directionInnerCos : vec4f,
  outerCosAndType : vec4f,
};

fn pbrEvaluateLocalLightAngularAttenuation(
  light : LocalLight,
  lightToSurface : vec3f
) -> f32 {
  if (light.outerCosAndType.y < 0.5) {
    return 1.0;
  }
  let coneCos = dot(light.directionInnerCos.xyz, lightToSurface);
  return smoothstep(
    light.outerCosAndType.x,
    light.directionInnerCos.w,
    coneCos
  );
}

// relativeは有限半径減衰、photometricはrange端を滑らかに切る逆二乗減衰です
// photometricのminimumDistanceはCPU側の必須入力で、点光源の特異点を物理的な近接限界として定義します
fn pbrEvaluateDistanceAttenuation(
  distance : f32,
  radius : f32,
  photometric : f32,
  minimumDistance : f32
) -> f32 {
  if (photometric < 0.5) {
    return pow(max(1.0 - distance / radius, 0.0), 2.0);
  }
  let rangeRatio = distance / radius;
  let rangeAttenuation = pow(max(1.0 - pow(rangeRatio, 4.0), 0.0), 2.0);
  return rangeAttenuation / max(
    distance * distance,
    minimumDistance * minimumDistance
  );
}
`;

// 前方描画と遅延描画が同じ直接光BRDFを使うためのWGSL断片です
// baseColor、radiance、dielectricF0はすべて線形RGBとして受け取ります
export const PBR_BRDF_WGSL = `
fn pbrSchlickWeight(cosine : f32) -> f32 {
  let oneMinusCosine = clamp(1.0 - cosine, 0.0, 1.0);
  let squared = oneMinusCosine * oneMinusCosine;
  return squared * squared * oneMinusCosine;
}

fn pbrEvaluateF0(
  baseColor : vec3f,
  metallic : f32,
  dielectricF0 : vec3f
) -> vec3f {
  return mix(dielectricF0, baseColor, metallic);
}

fn pbrEvaluateDirectBrdf(
  baseColor : vec3f,
  normal : vec3f,
  viewDirection : vec3f,
  lightDirection : vec3f,
  metallic : f32,
  perceptualRoughness : f32,
  dielectricF0 : vec3f,
  radiance : vec3f
) -> vec3f {
  let nDotL = max(dot(normal, lightDirection), 0.0);
  let nDotV = max(dot(normal, viewDirection), 0.0);
  if (nDotL == 0.0 || nDotV == 0.0) {
    return vec3f(0.0);
  }

  let halfVector = normalize(lightDirection + viewDirection);
  let nDotH = max(dot(normal, halfVector), 0.0);
  let vDotH = max(dot(viewDirection, halfVector), 0.0);
  let alpha = perceptualRoughness * perceptualRoughness;
  let alphaSquared = alpha * alpha;
  let distributionDenominator = nDotH * nDotH * (alphaSquared - 1.0) + 1.0;
  let distribution = alphaSquared
    / (3.14159265 * distributionDenominator * distributionDenominator);

  let geometryK = (perceptualRoughness + 1.0)
    * (perceptualRoughness + 1.0) / 8.0;
  let geometryView = nDotV / (nDotV * (1.0 - geometryK) + geometryK);
  let geometryLight = nDotL / (nDotL * (1.0 - geometryK) + geometryK);
  let geometry = geometryView * geometryLight;

  let f0 = pbrEvaluateF0(baseColor, metallic, dielectricF0);
  let fresnel = f0 + (vec3f(1.0) - f0) * pbrSchlickWeight(vDotH);
  let specularBrdf = distribution * geometry * fresnel / (4.0 * nDotV * nDotL);
  let diffuseBrdf = (vec3f(1.0) - fresnel) * (1.0 - metallic)
    * baseColor / 3.14159265;
  return (diffuseBrdf + specularBrdf) * radiance * nDotL;
}
`;

// ForwardとDeferredのsplit-sum IBL合成を同じ関数へ集約します
// BRDF LUTは環境mapと同じrepeat samplerで読むため、端点をtexel中心へclampして左右の回り込みを防ぎます
export const PBR_IBL_WGSL = `
struct PbrIblResponse {
  diffuse : vec3f,
  specular : vec3f,
};

fn pbrClampBrdfLutUv(uv : vec2f, dimensions : vec2u) -> vec2f {
  let texel = vec2f(1.0) / vec2f(dimensions);
  return clamp(uv, texel * 0.5, vec2f(1.0) - texel * 0.5);
}

// F0、BRDF LUT、multiple-scattering補償、間接光occlusionから鏡面IBLの乗算係数を返します
// 環境mapとSSR hit radianceのどちらにも同じ反射面側のPBR係数を適用できるよう独立させます
fn pbrEvaluateSpecularIblWeight(
  f0 : vec3f,
  brdf : vec2f,
  ambientOcclusion : f32
) -> vec3f {
  let directionalAlbedo = max(brdf.x + brdf.y, ${PBR_MIN_DIRECTIONAL_ALBEDO});
  let energyCompensation = vec3f(1.0)
    + f0 * (1.0 / directionalAlbedo - 1.0);
  return (f0 * brdf.x + vec3f(brdf.y))
    * energyCompensation * ambientOcclusion;
}

// split-sum IBLを拡散と鏡面へ分けて返し、SSRが鏡面成分だけを置換できるようにします
fn pbrEvaluateIblComponents(
  baseColor : vec3f,
  metallic : f32,
  roughness : f32,
  dielectricF0 : vec3f,
  nDotV : f32,
  irradiance : vec3f,
  prefiltered : vec3f,
  brdf : vec2f,
  ambientOcclusion : f32,
  environmentIntensity : f32
) -> PbrIblResponse {
  let f0 = pbrEvaluateF0(baseColor, metallic, dielectricF0);
  let ambientF90 = max(vec3f(1.0 - roughness), f0);
  let fresnel = f0 + (ambientF90 - f0) * pbrSchlickWeight(nDotV);
  let diffuseBrdf = (vec3f(1.0) - fresnel) * (1.0 - metallic)
    * baseColor / 3.14159265;

  // BRDF LUTのscale+biasはF0=1で残るsingle-scatter directional albedoです
  // scaled GGX lobeは失われた割合だけ既存鏡面lobeを増やし、金属と誘電体をF0で連続的に扱います
  // これはHeitzの全散乱を確率的に追跡する方式ではなく、real-time向けenergy compensation近似です
  let diffuse = irradiance * diffuseBrdf
    * ambientOcclusion * environmentIntensity;
  let specular = prefiltered
    * pbrEvaluateSpecularIblWeight(f0, brdf, ambientOcclusion)
    * environmentIntensity;
  return PbrIblResponse(diffuse, specular);
}

// Forwardなど合計値だけを必要とする呼び出し側へIBL応答を返します
fn pbrEvaluateIblResponse(
  baseColor : vec3f,
  metallic : f32,
  roughness : f32,
  dielectricF0 : vec3f,
  nDotV : f32,
  irradiance : vec3f,
  prefiltered : vec3f,
  brdf : vec2f,
  ambientOcclusion : f32,
  environmentIntensity : f32
) -> vec3f {
  let response = pbrEvaluateIblComponents(
    baseColor,
    metallic,
    roughness,
    dielectricF0,
    nDotV,
    irradiance,
    prefiltered,
    brdf,
    ambientOcclusion,
    environmentIntensity
  );
  return response.diffuse + response.specular;
}
`;
