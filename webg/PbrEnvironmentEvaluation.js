// ---------------------------------------------
// PbrEnvironmentEvaluation.js  2026/08/14
//   CPU acceptance evaluation for split-sum PBR environments
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import {
  PBR_DIELECTRIC_F0,
  PBR_MIN_DIRECTIONAL_ALBEDO,
  PBR_MIN_ROUGHNESS
} from "./PbrBrdf.js";
import { readPbrEnvironmentPreprocessOptions } from "./PbrEnvironmentReference.js";
import util from "./util.js";

// binary16 runtime textureの一画素当たりbyte数をformat別に固定します
const RGBA16_FLOAT_BYTES = 8;
const RG16_FLOAT_BYTES = 4;
const RGBA32_FLOAT_BYTES = 16;

// exact vec3の各componentを共通数値検証へ通し、完全な色とF0を保持します
function readUnitVec3(value, label) {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new Error(`${label} must be an exact vec3 array`);
  }
  return value.map((component, index) => util.readFiniteNumber(
    component,
    `${label}[${index}]`,
    { min: 0.0, max: 1.0 }
  ));
}

// BRDF LUTのRG dataと寸法を検証し、shaderのtexture samplingと同じ入力範囲を保証します
function readBrdfLut(value, label) {
  const lut = util.readPlainObject(value, label);
  const width = util.readFiniteNumber(lut.width, `${label}.width`, {
    integer: true,
    min: 1
  });
  const height = util.readFiniteNumber(lut.height, `${label}.height`, {
    integer: true,
    min: 1
  });
  if (!(lut.data instanceof Float32Array)) {
    throw new Error(`${label}.data must be a Float32Array`);
  }
  if (lut.data.length !== width * height * 2) {
    throw new Error(`${label}.data length must be ${width * height * 2}: ${lut.data.length}`);
  }
  for (let index = 0; index < lut.data.length; index += 1) {
    util.readFiniteNumber(lut.data[index], `${label}.data[${index}]`, { min: 0.0, max: 1.0 });
  }
  return { width, height, data: lut.data };
}

// shaderのtexel中心clampとlinear filterをCPUで再現し、NdotV=1でU=0へrepeatしない値を返します
export function samplePbrBrdfLutClamped(brdfLut, normalDotView, roughness) {
  const lut = readBrdfLut(brdfLut, "PBR evaluation BRDF LUT");
  const nDotV = util.readFiniteNumber(normalDotView, "PBR evaluation normalDotView", {
    min: 0.0,
    max: 1.0
  });
  const checkedRoughness = util.readFiniteNumber(roughness, "PBR evaluation roughness", {
    min: PBR_MIN_ROUGHNESS,
    max: 1.0
  });
  const clampCoordinate = (coordinate, size) => Math.min(
    Math.max(coordinate, 0.5 / size),
    1.0 - 0.5 / size
  );
  const u = clampCoordinate(nDotV, lut.width);
  const v = clampCoordinate(checkedRoughness, lut.height);
  const sourceX = u * lut.width - 0.5;
  const sourceY = v * lut.height - 0.5;
  const x0 = Math.floor(sourceX);
  const y0 = Math.floor(sourceY);
  const x1 = Math.min(x0 + 1, lut.width - 1);
  const y1 = Math.min(y0 + 1, lut.height - 1);
  const fractionX = sourceX - x0;
  const fractionY = sourceY - y0;
  const read = (x, y, channel) => lut.data[(y * lut.width + x) * 2 + channel];
  return [0, 1].map((channel) => {
    const top = read(x0, y0, channel) * (1.0 - fractionX)
      + read(x1, y0, channel) * fractionX;
    const bottom = read(x0, y1, channel) * (1.0 - fractionX)
      + read(x1, y1, channel) * fractionX;
    return top * (1.0 - fractionY) + bottom * fractionY;
  });
}

// split-sum LUTからscaled GGX lobeのRGB補償係数を計算します
// LUTのscale+biasはF0=1のsingle-scatter directional albedoに一致するため、欠損率を別textureなしで求められます
export function evaluatePbrIblEnergyCompensation(dielectricOrMetalF0, brdf) {
  const f0 = readUnitVec3(dielectricOrMetalF0, "PBR IBL energy compensation F0");
  if (!Array.isArray(brdf) || brdf.length !== 2) {
    throw new Error("PBR IBL energy compensation BRDF must be an exact vec2 array");
  }
  const checkedBrdf = brdf.map((component, index) => util.readFiniteNumber(
    component,
    `PBR IBL energy compensation BRDF[${index}]`,
    { min: 0.0, max: 1.0 }
  ));
  const directionalAlbedo = Math.max(
    checkedBrdf[0] + checkedBrdf[1],
    PBR_MIN_DIRECTIONAL_ALBEDO
  );
  return f0.map((component) => 1.0 + component * (1.0 / directionalAlbedo - 1.0));
}

// unit white環境に対するsplit-sum IBL応答をCPUで計算し、energy gainとlossの基準値を返します
export function evaluatePbrWhiteFurnacePoint(brdfLut, options = {}) {
  const checked = util.readPlainObject(options, "PBR white furnace options");
  const supported = new Set([
    "baseColor",
    "metallic",
    "roughness",
    "normalDotView",
    "dielectricF0",
    "multipleScattering"
  ]);
  for (const key of Object.keys(checked)) {
    if (!supported.has(key)) throw new Error(`PBR white furnace options.${key} is not supported`);
  }
  const baseColor = readUnitVec3(checked.baseColor ?? [1.0, 1.0, 1.0], "PBR white furnace baseColor");
  const metallic = util.readOptionalFiniteNumber(
    checked.metallic,
    "PBR white furnace metallic",
    0.0,
    { min: 0.0, max: 1.0 }
  );
  const roughness = util.readOptionalFiniteNumber(
    checked.roughness,
    "PBR white furnace roughness",
    PBR_MIN_ROUGHNESS,
    { min: PBR_MIN_ROUGHNESS, max: 1.0 }
  );
  const normalDotView = util.readOptionalFiniteNumber(
    checked.normalDotView,
    "PBR white furnace normalDotView",
    1.0,
    { min: 0.0, max: 1.0 }
  );
  const dielectricF0 = readUnitVec3(
    checked.dielectricF0 ?? [PBR_DIELECTRIC_F0, PBR_DIELECTRIC_F0, PBR_DIELECTRIC_F0],
    "PBR white furnace dielectricF0"
  );
  const multipleScattering = util.readOptionalBoolean(
    checked.multipleScattering,
    "PBR white furnace multipleScattering",
    true
  );
  const brdf = samplePbrBrdfLutClamped(brdfLut, normalDotView, roughness);
  const schlickWeight = (1.0 - normalDotView) ** 5;
  const f0 = baseColor.map((base, channel) => (
    dielectricF0[channel] * (1.0 - metallic) + base * metallic
  ));
  const energyCompensation = multipleScattering
    ? evaluatePbrIblEnergyCompensation(f0, brdf)
    : [1.0, 1.0, 1.0];
  const color = baseColor.map((base, channel) => {
    const ambientF90 = Math.max(1.0 - roughness, f0[channel]);
    const fresnel = f0[channel] + (ambientF90 - f0[channel]) * schlickWeight;
    const diffuse = (1.0 - fresnel) * (1.0 - metallic) * base;
    const specular = (f0[channel] * brdf[0] + brdf[1])
      * energyCompensation[channel];
    return diffuse + specular;
  });
  return {
    baseColor: baseColor,
    metallic,
    roughness,
    normalDotView,
    brdf: brdf,
    multipleScattering,
    energyCompensation: energyCompensation,
    color: color
  };
}

// 白い誘電体と白い金属を複数角度・roughnessで走査し、増光の有無と単一散乱lossを数値化します
export function evaluatePbrWhiteFurnace(brdfLut, options = {}) {
  const checked = util.readPlainObject(options, "PBR white furnace grid options");
  const supported = new Set([
    "roughnesses",
    "normalDotViews",
    "maximumEnergy",
    "multipleScattering"
  ]);
  for (const key of Object.keys(checked)) {
    if (!supported.has(key)) throw new Error(`PBR white furnace grid options.${key} is not supported`);
  }
  const readSequence = (value, fallback, label, range) => {
    const sequence = value ?? fallback;
    if (!Array.isArray(sequence) || sequence.length === 0) {
      throw new Error(`${label} must be a non-empty array`);
    }
    return sequence.map((entry, index) => util.readFiniteNumber(entry, `${label}[${index}]`, range));
  };
  const roughnesses = readSequence(
    checked.roughnesses,
    [0.04, 0.25, 0.5, 0.75, 1.0],
    "PBR white furnace roughnesses",
    { min: PBR_MIN_ROUGHNESS, max: 1.0 }
  );
  const normalDotViews = readSequence(
    checked.normalDotViews,
    [0.25, 0.5, 0.75, 1.0],
    "PBR white furnace normalDotViews",
    { min: 0.0, max: 1.0 }
  );
  const maximumEnergy = util.readOptionalFiniteNumber(
    checked.maximumEnergy,
    "PBR white furnace maximumEnergy",
    1.02,
    { min: 1.0 }
  );
  const multipleScattering = util.readOptionalBoolean(
    checked.multipleScattering,
    "PBR white furnace grid multipleScattering",
    true
  );
  const samples = [];
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (const metallic of [0.0, 1.0]) {
    for (const roughness of roughnesses) {
      for (const normalDotView of normalDotViews) {
        const sample = evaluatePbrWhiteFurnacePoint(brdfLut, {
          metallic,
          roughness,
          normalDotView,
          multipleScattering
        });
        minimum = Math.min(minimum, ...sample.color);
        maximum = Math.max(maximum, ...sample.color);
        samples.push(sample);
      }
    }
  }
  return {
    passed: minimum >= 0.0 && maximum <= maximumEnergy,
    minimum,
    maximum,
    maximumEnergy,
    multipleScattering,
    maximumSingleScatterLoss: 1.0 - minimum,
    sampleCount: samples.length,
    samples: samples
  };
}

// 指定解像度のcache復元時とCompute前処理時に必要な論理texture byte数をformatから算出します
export function estimatePbrEnvironmentMemory(sourceSize, preprocessOptions = {}) {
  if (!Array.isArray(sourceSize) || sourceSize.length !== 2) {
    throw new Error("PBR environment memory sourceSize must be an exact vec2 array");
  }
  const sourceWidth = util.readFiniteNumber(sourceSize[0], "PBR environment memory sourceWidth", {
    integer: true,
    min: 1
  });
  const sourceHeight = util.readFiniteNumber(sourceSize[1], "PBR environment memory sourceHeight", {
    integer: true,
    min: 1
  });
  if (sourceWidth !== sourceHeight * 2) {
    throw new Error("PBR environment memory source must use a 2:1 equirectangular ratio");
  }
  const settings = readPbrEnvironmentPreprocessOptions(preprocessOptions);
  const radianceBytes = sourceWidth * sourceHeight * RGBA16_FLOAT_BYTES;
  const irradianceBytes = settings.irradianceWidth * settings.irradianceHeight
    * RGBA16_FLOAT_BYTES;
  let specularBytes = 0;
  let width = settings.specularWidth;
  let height = settings.specularHeight;
  for (let mip = 0; mip < settings.specularMipCount; mip += 1) {
    specularBytes += width * height * RGBA16_FLOAT_BYTES;
    width = Math.max(1, Math.floor(width / 2));
    height = Math.max(1, Math.floor(height / 2));
  }
  const brdfRuntimeBytes = settings.brdfLutWidth * settings.brdfLutHeight
    * RG16_FLOAT_BYTES;
  const brdfComputeBytes = settings.brdfLutWidth * settings.brdfLutHeight
    * RGBA16_FLOAT_BYTES;
  const runtimeTextureBytes = radianceBytes + irradianceBytes + specularBytes + brdfRuntimeBytes;
  const computeSourceBytes = sourceWidth * sourceHeight * RGBA32_FLOAT_BYTES;
  const computeTextureBytes = computeSourceBytes + irradianceBytes + specularBytes + brdfComputeBytes;
  const computeImportanceBytes = sourceWidth * sourceHeight * 8;
  const computeWorkingBytes = computeTextureBytes + computeImportanceBytes;
  return {
    radianceBytes,
    irradianceBytes,
    specularBytes,
    brdfRuntimeBytes,
    runtimeTextureBytes,
    cachePayloadBytes: runtimeTextureBytes,
    computeSourceBytes,
    brdfComputeBytes,
    computeTextureBytes,
    computeImportanceBytes,
    computeWorkingBytes,
    settings: { ...settings }
  };
}
