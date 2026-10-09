// ---------------------------------------------
// PbrEnvironmentReference.js  2026/08/14
//   Deterministic CPU reference for split-sum PBR environment preprocessing
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import util from "./util.js";
import { validateRadianceHdrForEquirectangularIbl } from "./RadianceHdr.js";

const PI = Math.PI;
const TWO_PI = Math.PI * 2.0;
const MIN_PBR_ROUGHNESS = 0.04;
const MAX_OUTPUT_PIXELS = 8192 * 4096;
const MAX_SAMPLE_COUNT = 65536;
const LINEAR_SRGB_LUMINANCE = [0.2126, 0.7152, 0.0722];

// vec3の内積を返し、sampling loop内で配列の意味を明示します
function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

// vec3の外積を返し、法線を中心とした接線frameを構築します
function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

// CPU参照内部で生成したvectorだけを正規化し、利用者入力の誤りは上流検証へ残します
function normalizeGenerated3(value, label) {
  const length = Math.hypot(...value);
  if (!Number.isFinite(length) || length <= 0.0) {
    throw new Error(`${label} generated a non-normalizable vector`);
  }
  return value.map((component) => component / length);
}

// 作業色空間linear sRGBのRGBからD65基準の輝度Yを求め、importance weightを輝度で決めます
function linearSrgbLuminance(rgb) {
  return rgb[0] * LINEAR_SRGB_LUMINANCE[0]
    + rgb[1] * LINEAR_SRGB_LUMINANCE[1]
    + rgb[2] * LINEAR_SRGB_LUMINANCE[2];
}

// 緯度経度pixelが球面上で占める立体角を行境界のcos差から正確に求めます
function equirectangularPixelSolidAngle(width, height, y) {
  const theta0 = y * PI / height;
  const theta1 = (y + 1) * PI / height;
  return TWO_PI / width * (Math.cos(theta0) - Math.cos(theta1));
}

// 輝度と立体角からWalker alias tableと立体角当たりPDFを作ります
// 全黒環境は積分値が厳密に0なので、sampling表だけを一様球面分布として定義します
export function createPbrEnvironmentImportanceDistribution(sourceImage) {
  const source = validateRadianceHdrForEquirectangularIbl(
    sourceImage,
    "PBR environment importance source"
  );
  validateSourceRadiance(source);
  const pixelCount = source.width * source.height;
  const weights = new Float64Array(pixelCount);
  const solidAngles = new Float64Array(source.height);
  let totalWeight = 0.0;
  for (let y = 0; y < source.height; y += 1) {
    const solidAngle = equirectangularPixelSolidAngle(source.width, source.height, y);
    solidAngles[y] = solidAngle;
    for (let x = 0; x < source.width; x += 1) {
      const pixel = y * source.width + x;
      const offset = pixel * 4;
      const luminance = linearSrgbLuminance(source.data.subarray(offset, offset + 3));
      const weight = luminance * solidAngle;
      weights[pixel] = weight;
      totalWeight += weight;
    }
  }
  if (!Number.isFinite(totalWeight) || totalWeight < 0.0) {
    throw new Error("PBR environment importance total weight is invalid");
  }
  const zeroRadiance = totalWeight === 0.0;
  if (zeroRadiance) totalWeight = 4.0 * PI;
  const probabilityMass = new Float64Array(pixelCount);
  const pdfSolidAngle = new Float32Array(pixelCount);
  const scaled = new Float64Array(pixelCount);
  const small = [];
  const large = [];
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const y = Math.floor(pixel / source.width);
    const probability = zeroRadiance
      ? solidAngles[y] / (4.0 * PI)
      : weights[pixel] / totalWeight;
    probabilityMass[pixel] = probability;
    pdfSolidAngle[pixel] = probability / solidAngles[y];
    scaled[pixel] = probability * pixelCount;
    (scaled[pixel] < 1.0 ? small : large).push(pixel);
  }
  const thresholds = new Float32Array(pixelCount);
  const aliases = new Uint32Array(pixelCount);
  while (small.length > 0 && large.length > 0) {
    const low = small.pop();
    const high = large.pop();
    thresholds[low] = scaled[low];
    aliases[low] = high;
    scaled[high] = scaled[high] - (1.0 - scaled[low]);
    (scaled[high] < 1.0 ? small : large).push(high);
  }
  for (const pixel of [...small, ...large]) {
    thresholds[pixel] = 1.0;
    aliases[pixel] = pixel;
  }
  return {
    width: source.width,
    height: source.height,
    pixelCount,
    totalWeight,
    zeroRadiance,
    thresholds,
    aliases,
    pdfSolidAngle
  };
}

// UV pixel中心をDeferred／Forwardと同じ緯度経度world-space方向へ変換します
export function pbrEnvironmentDirectionFromUv(u, v) {
  const checkedU = util.readFiniteNumber(u, "PBR environment u", { min: 0.0, max: 1.0 });
  const checkedV = util.readFiniteNumber(v, "PBR environment v", { min: 0.0, max: 1.0 });
  const longitude = (checkedU - 0.5) * TWO_PI;
  const latitude = checkedV * PI;
  const sinLatitude = Math.sin(latitude);
  return [
    Math.cos(longitude) * sinLatitude,
    Math.cos(latitude),
    Math.sin(longitude) * sinLatitude
  ];
}

// Van der Corputのbit反転を0から1へ写し、全実行で同じsample列を生成します
export function pbrRadicalInverseVdc(value) {
  let bits = util.readFiniteNumber(value, "PBR sample index", {
    integer: true,
    min: 0,
    max: 0xffffffff
  }) >>> 0;
  bits = ((bits << 16) | (bits >>> 16)) >>> 0;
  bits = (((bits & 0x55555555) << 1) | ((bits & 0xaaaaaaaa) >>> 1)) >>> 0;
  bits = (((bits & 0x33333333) << 2) | ((bits & 0xcccccccc) >>> 2)) >>> 0;
  bits = (((bits & 0x0f0f0f0f) << 4) | ((bits & 0xf0f0f0f0) >>> 4)) >>> 0;
  bits = (((bits & 0x00ff00ff) << 8) | ((bits & 0xff00ff00) >>> 8)) >>> 0;
  return bits * 2.3283064365386963e-10;
}

// Hammersley点列を返し、CPUと将来のCompute Shaderでsample indexを共有可能にします
export function pbrHammersley(index, count) {
  const checkedCount = util.readFiniteNumber(count, "PBR sample count", {
    integer: true,
    min: 1,
    max: 0xffffffff
  });
  const checkedIndex = util.readFiniteNumber(index, "PBR sample index", {
    integer: true,
    min: 0,
    max: checkedCount - 1
  });
  return [checkedIndex / checkedCount, pbrRadicalInverseVdc(checkedIndex)];
}

// 緯度経度sourceをU repeat、V clampのbilinear filterで読み、継ぎ目を跨ぐsampleを連続にします
export function samplePbrEquirectangularBilinear(image, u, v) {
  const checkedU = util.readFiniteNumber(u, "PBR environment sample u");
  const checkedV = util.readFiniteNumber(v, "PBR environment sample v", { min: 0.0, max: 1.0 });
  if (!image || typeof image !== "object"
    || !Number.isInteger(image.width) || image.width < 1
    || !Number.isInteger(image.height) || image.height < 1
    || !(image.data instanceof Float32Array)
    || image.data.length !== image.width * image.height * 4) {
    throw new Error("PBR environment sample image must contain complete RGBA float data");
  }
  const wrappedU = checkedU - Math.floor(checkedU);
  const sourceX = wrappedU * image.width - 0.5;
  const sourceY = checkedV * image.height - 0.5;
  const x0Unwrapped = Math.floor(sourceX);
  const y0Unclamped = Math.floor(sourceY);
  const xFraction = sourceX - x0Unwrapped;
  const yFraction = sourceY - y0Unclamped;
  const wrapX = (x) => ((x % image.width) + image.width) % image.width;
  const clampY = (y) => Math.min(Math.max(y, 0), image.height - 1);
  const x0 = wrapX(x0Unwrapped);
  const x1 = wrapX(x0Unwrapped + 1);
  const y0 = clampY(y0Unclamped);
  const y1 = clampY(y0Unclamped + 1);
  const read = (x, y, channel) => image.data[(y * image.width + x) * 4 + channel];
  const result = [0.0, 0.0, 0.0];
  for (let channel = 0; channel < 3; channel += 1) {
    const top = read(x0, y0, channel) * (1.0 - xFraction)
      + read(x1, y0, channel) * xFraction;
    const bottom = read(x0, y1, channel) * (1.0 - xFraction)
      + read(x1, y1, channel) * xFraction;
    result[channel] = top * (1.0 - yFraction) + bottom * yFraction;
  }
  return result;
}

// unit directionをsourceの緯度経度UVへ変換し、CPU convolutionのsample位置を決めます
function directionToUv(direction) {
  const normalized = normalizeGenerated3(direction, "PBR environment sample direction");
  return [
    Math.atan2(normalized[2], normalized[0]) / TWO_PI + 0.5,
    Math.acos(Math.min(Math.max(normalized[1], -1.0), 1.0)) / PI
  ];
}

// 任意方向が属する元HDR pixelを求め、environment proposalの立体角当たりPDFを返します
function environmentPdfForDirection(distribution, direction) {
  const uv = directionToUv(direction);
  const wrappedU = uv[0] - Math.floor(uv[0]);
  const x = Math.min(Math.floor(wrappedU * distribution.width), distribution.width - 1);
  const y = Math.min(Math.floor(uv[1] * distribution.height), distribution.height - 1);
  return distribution.pdfSolidAngle[y * distribution.width + x];
}

// HammersleyのXでalias列、Yでthresholdを選び、2の累乗寸法との周期的な整列を避けます
function sampleEnvironmentImportance(source, distribution, samplePoint) {
  const column = Math.min(
    Math.floor(samplePoint[0] * distribution.pixelCount),
    distribution.pixelCount - 1
  );
  const pixel = samplePoint[1] < distribution.thresholds[column]
    ? column
    : distribution.aliases[column];
  const x = pixel % distribution.width;
  const y = Math.floor(pixel / distribution.width);
  const offset = pixel * 4;
  return {
    direction: pbrEnvironmentDirectionFromUv(
      (x + 0.5) / distribution.width,
      (y + 0.5) / distribution.height
    ),
    radiance: source.data.subarray(offset, offset + 3),
    pdf: distribution.pdfSolidAngle[pixel]
  };
}

// 法線を中心とする直交frameを作り、local hemisphere sampleをworld-spaceへ移します
function makeTangentFrame(normal) {
  const helper = Math.abs(normal[1]) < 0.999 ? [0.0, 1.0, 0.0] : [1.0, 0.0, 0.0];
  const tangent = normalizeGenerated3(cross3(helper, normal), "PBR tangent");
  const bitangent = cross3(normal, tangent);
  return { tangent, bitangent };
}

// local vectorを法線frameへ写し、数値誤差を除いてunit directionへ戻します
function localToWorld(local, normal, frame) {
  return normalizeGenerated3([
    frame.tangent[0] * local[0] + frame.bitangent[0] * local[1] + normal[0] * local[2],
    frame.tangent[1] * local[0] + frame.bitangent[1] * local[1] + normal[1] * local[2],
    frame.tangent[2] * local[0] + frame.bitangent[2] * local[1] + normal[2] * local[2]
  ], "PBR world sample");
}

// cosine-weighted hemisphereをsamplingし、Lambert irradiance積分の分散を下げます
function sampleCosineHemisphere(sample) {
  const radius = Math.sqrt(sample[1]);
  const phi = TWO_PI * sample[0];
  return [
    Math.cos(phi) * radius,
    Math.sin(phi) * radius,
    Math.sqrt(Math.max(1.0 - sample[1], 0.0))
  ];
}

// sourceの一方向をbilinear samplingし、RGB成分だけを積分へ使います
function sampleSourceDirection(source, direction) {
  const uv = directionToUv(direction);
  return samplePbrEquirectangularBilinear(source, uv[0], uv[1]);
}

// 一つの法線方向についてcosine-weighted Monte Carloでdiffuse irradianceを求めます
function integrateDiffuseIrradiance(source, distribution, normal, sampleCount) {
  const frame = makeTangentFrame(normal);
  const sum = [0.0, 0.0, 0.0];
  let weightSum = 0.0;
  for (let index = 0; index < sampleCount; index += 1) {
    const point = pbrHammersley(index, sampleCount);
    const local = sampleCosineHemisphere(point);
    const direction = localToWorld(local, normal, frame);
    const radiance = sampleSourceDirection(source, direction);
    const cosine = Math.max(dot3(normal, direction), 0.0);
    const cosinePdf = cosine / PI;
    const environmentPdf = environmentPdfForDirection(distribution, direction);
    const proposalSum = cosinePdf + environmentPdf;
    const misWeight = cosine / proposalSum;
    for (let channel = 0; channel < 3; channel += 1) {
      sum[channel] += radiance[channel] * misWeight;
    }
    weightSum += misWeight;

    const environment = sampleEnvironmentImportance(source, distribution, point);
    const environmentCosine = Math.max(dot3(normal, environment.direction), 0.0);
    if (environmentCosine > 0.0) {
      const environmentCosinePdf = environmentCosine / PI;
      const environmentProposalSum = environment.pdf + environmentCosinePdf;
      const environmentMisWeight = environmentCosine / environmentProposalSum;
      for (let channel = 0; channel < 3; channel += 1) {
        sum[channel] += environment.radiance[channel]
          * environmentMisWeight;
      }
      weightSum += environmentMisWeight;
    }
  }
  if (!Number.isFinite(weightSum) || weightSum <= 0.0) {
    throw new Error("PBR diffuse reference produced no valid samples");
  }
  return sum.map((value) => value * PI / weightSum);
}

// GGX分布のhalf vectorをimportance samplingし、roughness別鏡面環境積分に使います
function importanceSampleGgx(sample, roughness) {
  const alpha = Math.max(roughness, MIN_PBR_ROUGHNESS) ** 2;
  const alphaSquared = alpha * alpha;
  const phi = TWO_PI * sample[0];
  const cosTheta = Math.sqrt(
    (1.0 - sample[1]) / (1.0 + (alphaSquared - 1.0) * sample[1])
  );
  const sinTheta = Math.sqrt(Math.max(1.0 - cosTheta * cosTheta, 0.0));
  return [Math.cos(phi) * sinTheta, Math.sin(phi) * sinTheta, cosTheta];
}

// split-sum前処理でV=Nを仮定し、GGX sampleのNdotL加重平均を求めます
function ggxLightPdf(normal, view, light, roughness) {
  const halfVectorRaw = [
    view[0] + light[0],
    view[1] + light[1],
    view[2] + light[2]
  ];
  const halfLength = Math.hypot(...halfVectorRaw);
  if (halfLength <= 0.0) return 0.0;
  const halfVector = halfVectorRaw.map((value) => value / halfLength);
  const nDotH = Math.max(dot3(normal, halfVector), 0.0);
  const vDotH = Math.max(dot3(view, halfVector), 0.0);
  if (nDotH <= 0.0 || vDotH <= 0.0) return 0.0;
  const alpha = Math.max(roughness, MIN_PBR_ROUGHNESS) ** 2;
  const alphaSquared = alpha * alpha;
  const denominator = nDotH * nDotH * (alphaSquared - 1.0) + 1.0;
  const distribution = alphaSquared / (PI * denominator * denominator);
  return distribution * nDotH / (4.0 * vDotH);
}

// GGX proposalとenvironment proposalをbalance heuristicで合成し、高輝度小領域と鋭いlobeを両方sampleします
function integrateSpecularPrefilter(source, distribution, normal, roughness, sampleCount) {
  const frame = makeTangentFrame(normal);
  const view = normal;
  const sum = [0.0, 0.0, 0.0];
  let weightSum = 0.0;
  for (let index = 0; index < sampleCount; index += 1) {
    const point = pbrHammersley(index, sampleCount);
    const localHalf = importanceSampleGgx(point, roughness);
    const halfVector = localToWorld(localHalf, normal, frame);
    const vDotH = Math.max(dot3(view, halfVector), 0.0);
    const light = [
      2.0 * vDotH * halfVector[0] - view[0],
      2.0 * vDotH * halfVector[1] - view[1],
      2.0 * vDotH * halfVector[2] - view[2]
    ];
    const nDotL = Math.max(dot3(normal, light), 0.0);
    if (nDotL > 0.0) {
      const ggxPdf = ggxLightPdf(normal, view, light, roughness);
      const environmentPdf = environmentPdfForDirection(distribution, light);
      const targetWeight = ggxPdf * nDotL;
      const misWeight = targetWeight / (ggxPdf + environmentPdf);
      const radiance = sampleSourceDirection(source, light);
      for (let channel = 0; channel < 3; channel += 1) {
        sum[channel] += radiance[channel] * misWeight;
      }
      weightSum += misWeight;
    }

    const environment = sampleEnvironmentImportance(source, distribution, point);
    const environmentNdotL = Math.max(dot3(normal, environment.direction), 0.0);
    if (environmentNdotL > 0.0) {
      const environmentGgxPdf = ggxLightPdf(
        normal,
        view,
        environment.direction,
        roughness
      );
      const targetWeight = environmentGgxPdf * environmentNdotL;
      const misWeight = targetWeight / (environmentGgxPdf + environment.pdf);
      for (let channel = 0; channel < 3; channel += 1) {
        sum[channel] += environment.radiance[channel] * misWeight;
      }
      weightSum += misWeight;
    }
  }
  if (!Number.isFinite(weightSum) || weightSum <= 0.0) {
    throw new Error("PBR specular reference produced no valid samples");
  }
  return sum.map((value) => value / weightSum);
}

// IBL向けSchlick-GGX可視性項を評価し、shader用BRDF LUTの積分規則を固定します
function geometrySchlickGgxIbl(nDotDirection, roughness) {
  const k = roughness * roughness * 0.5;
  return nDotDirection / (nDotDirection * (1.0 - k) + k);
}

// NdotVとroughnessについてsplit-sum BRDF LUTのscaleとbiasを積分します
function integrateBrdfLutPixel(nDotV, roughness, sampleCount) {
  const view = [Math.sqrt(Math.max(1.0 - nDotV * nDotV, 0.0)), 0.0, nDotV];
  let scale = 0.0;
  let bias = 0.0;
  for (let index = 0; index < sampleCount; index += 1) {
    const halfVector = importanceSampleGgx(pbrHammersley(index, sampleCount), roughness);
    const vDotH = Math.max(dot3(view, halfVector), 0.0);
    const light = [
      2.0 * vDotH * halfVector[0] - view[0],
      2.0 * vDotH * halfVector[1] - view[1],
      2.0 * vDotH * halfVector[2] - view[2]
    ];
    const nDotL = Math.max(light[2], 0.0);
    const nDotH = Math.max(halfVector[2], 0.0);
    if (nDotL <= 0.0 || nDotH <= 0.0) continue;
    const geometry = geometrySchlickGgxIbl(nDotV, roughness)
      * geometrySchlickGgxIbl(nDotL, roughness);
    const visibility = geometry * vDotH / (nDotH * nDotV);
    const fresnelWeight = (1.0 - vDotH) ** 5;
    scale += (1.0 - fresnelWeight) * visibility;
    bias += fresnelWeight * visibility;
  }
  return [scale / sampleCount, bias / sampleCount];
}

// 一つの出力levelを全pixel中心方向について生成し、alphaを1へ固定します
function makeRgbaLevel(width, height, evaluate) {
  const data = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const direction = pbrEnvironmentDirectionFromUv(
        (x + 0.5) / width,
        (y + 0.5) / height
      );
      const color = evaluate(direction);
      const offset = (y * width + x) * 4;
      data.set([color[0], color[1], color[2], 1.0], offset);
    }
  }
  return { width, height, data };
}

// optionの整数値を共通helperで検証し、指定した解像度やsample数をそのまま使います
export function readPbrEnvironmentPreprocessOptions(options) {
  const checked = util.readPlainObject(options, "PBR environment reference options");
  const supported = new Set([
    "irradianceWidth",
    "irradianceHeight",
    "specularWidth",
    "specularHeight",
    "specularMipCount",
    "brdfLutWidth",
    "brdfLutHeight",
    "diffuseSampleCount",
    "specularSampleCount",
    "brdfSampleCount"
  ]);
  for (const key of Object.keys(checked)) {
    if (!supported.has(key)) {
      throw new Error(`PBR environment reference options.${key} is not supported`);
    }
  }
  const readSize = (name, fallback) => util.readOptionalInteger(
    checked[name],
    `PBR environment reference options.${name}`,
    fallback,
    { min: 1, max: 32767 }
  );
  const readSamples = (name, fallback) => util.readOptionalInteger(
    checked[name],
    `PBR environment reference options.${name}`,
    fallback,
    { min: 1, max: MAX_SAMPLE_COUNT }
  );
  const result = {
    irradianceWidth: readSize("irradianceWidth", 32),
    irradianceHeight: readSize("irradianceHeight", 16),
    specularWidth: readSize("specularWidth", 64),
    specularHeight: readSize("specularHeight", 32),
    specularMipCount: readSize("specularMipCount", 6),
    brdfLutWidth: readSize("brdfLutWidth", 64),
    brdfLutHeight: readSize("brdfLutHeight", 64),
    diffuseSampleCount: readSamples("diffuseSampleCount", 256),
    specularSampleCount: readSamples("specularSampleCount", 256),
    brdfSampleCount: readSamples("brdfSampleCount", 256)
  };
  if (result.irradianceWidth * result.irradianceHeight > MAX_OUTPUT_PIXELS) {
    throw new Error(`PBR irradiance output pixel count must be <= ${MAX_OUTPUT_PIXELS}`);
  }
  if (result.specularWidth * result.specularHeight > MAX_OUTPUT_PIXELS) {
    throw new Error(`PBR specular output pixel count must be <= ${MAX_OUTPUT_PIXELS}`);
  }
  if (result.brdfLutWidth * result.brdfLutHeight > MAX_OUTPUT_PIXELS) {
    throw new Error(`PBR BRDF LUT output pixel count must be <= ${MAX_OUTPUT_PIXELS}`);
  }
  if (result.irradianceWidth !== result.irradianceHeight * 2) {
    throw new Error("PBR irradiance output must use a 2:1 equirectangular ratio");
  }
  if (result.specularWidth !== result.specularHeight * 2) {
    throw new Error("PBR specular output must use a 2:1 equirectangular ratio");
  }
  let mipWidth = result.specularWidth;
  let mipHeight = result.specularHeight;
  for (let level = 1; level < result.specularMipCount; level += 1) {
    mipWidth = Math.max(1, Math.floor(mipWidth / 2));
    mipHeight = Math.max(1, Math.floor(mipHeight / 2));
    if (level < result.specularMipCount - 1 && mipWidth === 1 && mipHeight === 1) {
      throw new Error("PBR specularMipCount contains repeated 1x1 levels");
    }
  }
  return result;
}

// 前処理が作業色空間linear sRGBを受け取ったことと全RGB値を検査し、対応するprimariesの輝度係数を使います
function validateSourceRadiance(source) {
  if (source.colorSpace !== "linear-srgb") {
    throw new Error(
      "PBR environment preprocessing requires explicit conversion to linear-srgb"
    );
  }
  for (let offset = 0; offset < source.data.length; offset += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      util.readFiniteNumber(
        source.data[offset + channel],
        `PBR environment source.data[${offset + channel}]`,
        { min: 0.0 }
      );
    }
  }
}

// sourceからdiffuse irradiance、roughness別specular mip、BRDF LUTのCPU基準値を生成します
export function createPbrEnvironmentReferenceData(sourceImage, options = {}) {
  const source = validateRadianceHdrForEquirectangularIbl(
    sourceImage,
    "PBR environment reference source"
  );
  validateSourceRadiance(source);
  const checked = readPbrEnvironmentPreprocessOptions(options);
  const importance = createPbrEnvironmentImportanceDistribution(source);
  const irradiance = makeRgbaLevel(
    checked.irradianceWidth,
    checked.irradianceHeight,
    (normal) => integrateDiffuseIrradiance(
      source,
      importance,
      normal,
      checked.diffuseSampleCount
    )
  );

  const prefilteredSpecular = [];
  let width = checked.specularWidth;
  let height = checked.specularHeight;
  for (let level = 0; level < checked.specularMipCount; level += 1) {
    const roughness = checked.specularMipCount === 1
      ? MIN_PBR_ROUGHNESS
      : level / (checked.specularMipCount - 1);
    prefilteredSpecular.push(makeRgbaLevel(
      width,
      height,
      (normal) => integrateSpecularPrefilter(
        source,
        importance,
        normal,
        roughness,
        checked.specularSampleCount
      )
    ));
    width = Math.max(1, Math.floor(width / 2));
    height = Math.max(1, Math.floor(height / 2));
  }

  const brdfData = new Float32Array(checked.brdfLutWidth * checked.brdfLutHeight * 2);
  for (let y = 0; y < checked.brdfLutHeight; y += 1) {
    const roughness = Math.max((y + 0.5) / checked.brdfLutHeight, MIN_PBR_ROUGHNESS);
    for (let x = 0; x < checked.brdfLutWidth; x += 1) {
      const nDotV = (x + 0.5) / checked.brdfLutWidth;
      const integrated = integrateBrdfLutPixel(nDotV, roughness, checked.brdfSampleCount);
      brdfData.set(integrated, (y * checked.brdfLutWidth + x) * 2);
    }
  }

  return {
    irradiance,
    prefilteredSpecular: prefilteredSpecular,
    brdfLut: {
      width: checked.brdfLutWidth,
      height: checked.brdfLutHeight,
      data: brdfData
    },
    settings: { ...checked }
  };
}
