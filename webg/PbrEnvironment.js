// ---------------------------------------------
// PbrEnvironment.js  2026/08/03
//   Precomputed equirectangular IBL resources
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import util from "./util.js";

const HALF_FLOAT_MAX = 65504.0;

// DeferredとForwardが受け取る環境resource集合を同じ規則で検証します
// nullはIBL無効を明示し、resourceとfieldを指定値として検証します
export function validatePbrEnvironmentResources(
  environment,
  intensity,
  label = "PBR environment"
) {
  if (environment === undefined || environment === null) {
    if (intensity !== undefined) {
      throw new Error(`${label} environmentIntensity requires environment`);
    }
    return null;
  }
  const checked = util.readPlainObject(environment, `${label} environment`);
  const supportedKeys = new Set([
    "radiance",
    "irradiance",
    "prefilteredSpecular",
    "brdfLut",
    "sampler",
    "specularMipCount"
  ]);
  for (const key of Object.keys(checked)) {
    if (!supportedKeys.has(key)) {
      throw new Error(`${label} environment.${key} is not supported`);
    }
  }
  for (const name of ["irradiance", "prefilteredSpecular", "brdfLut"]) {
    if (!checked[name] || typeof checked[name].getView !== "function") {
      throw new Error(`${label} environment requires ${name}.getView()`);
    }
  }
  if (checked.radiance !== undefined
    && (!checked.radiance || typeof checked.radiance.getView !== "function")) {
    throw new Error(`${label} environment.radiance must provide getView()`);
  }
  if (!checked.sampler) {
    throw new Error(`${label} environment requires sampler`);
  }
  return {
    intensity: util.readFiniteNumber(
      intensity,
      `${label} environmentIntensity`,
      { min: 0.0 }
    ),
    specularMipCount: util.readFiniteNumber(
      checked.specularMipCount,
      `${label} environment.specularMipCount`,
      { integer: true, min: 1 }
    ),
    radiance: checked.radiance ?? null,
    irradiance: checked.irradiance,
    prefilteredSpecular: checked.prefilteredSpecular,
    brdfLut: checked.brdfLut,
    sampler: checked.sampler
  };
}

// JavaScriptのfloat32をGPU rgba16float / rg16float転送用のbinary16へ変換します
// HDR値を0から1へ補正せず、binary16で表せない有限値は入力errorとして拒否します
export function float32ToFloat16Bits(value, label = "half float value") {
  const checked = util.readFiniteNumber(value, label, {
    min: 0.0,
    max: HALF_FLOAT_MAX
  });
  if (checked === 0.0) return 0;

  const floatBuffer = new ArrayBuffer(4);
  const floatView = new Float32Array(floatBuffer);
  const uintView = new Uint32Array(floatBuffer);
  floatView[0] = checked;
  const bits = uintView[0];
  const exponent = ((bits >>> 23) & 0xff) - 127 + 15;
  const mantissa = bits & 0x7fffff;
  if (exponent <= 0) {
    if (exponent < -10) return 0;
    const normalizedMantissa = mantissa | 0x800000;
    const shift = 14 - exponent;
    return (normalizedMantissa + (1 << (shift - 1))) >>> shift;
  }
  if (exponent >= 31) return 0x7bff;
  const rounded = mantissa + 0x1000;
  if (rounded & 0x800000) {
    if (exponent + 1 >= 31) return 0x7bff;
    return (exponent + 1) << 10;
  }
  return (exponent << 10) | (rounded >>> 13);
}

// GPU readbackしたbinary16をJavaScriptのfloatへ戻し、Compute前処理とCPU参照の比較に使います
export function float16BitsToFloat32(value, label = "half float bits") {
  const bits = util.readFiniteNumber(value, label, {
    integer: true,
    min: 0,
    max: 0xffff
  });
  const sign = (bits & 0x8000) === 0 ? 1.0 : -1.0;
  const exponent = (bits >>> 10) & 0x1f;
  const mantissa = bits & 0x03ff;
  if (exponent === 0) {
    return sign * mantissa * 2 ** -24;
  }
  if (exponent === 0x1f) {
    return mantissa === 0 ? sign * Number.POSITIVE_INFINITY : Number.NaN;
  }
  return sign * (1.0 + mantissa / 1024.0) * 2 ** (exponent - 15);
}

// 行ごとの転送pitchを256 byte境界へ揃え、画像の有効画素は変更せずpaddingだけを加えます
function packFloat16Rows(data, width, height, channels, label, range) {
  if (!(data instanceof Float32Array)) {
    throw new Error(`${label}.data must be a Float32Array`);
  }
  const expectedLength = width * height * channels;
  if (data.length !== expectedLength) {
    throw new Error(`${label}.data length must be ${expectedLength}: ${data.length}`);
  }
  const rowBytes = width * channels * 2;
  const bytesPerRow = Math.ceil(rowBytes / 256) * 256;
  const packed = new Uint16Array(bytesPerRow / 2 * height);
  const packedRowValues = bytesPerRow / 2;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width * channels; x += 1) {
      const sourceIndex = y * width * channels + x;
      const value = util.readFiniteNumber(data[sourceIndex], `${label}.data[${sourceIndex}]`, range);
      packed[y * packedRowValues + x] = float32ToFloat16Bits(
        value,
        `${label}.data[${sourceIndex}]`
      );
    }
  }
  return { packed, bytesPerRow };
}

// width、height、Float32Arrayからなる一つの線形texture levelを検証します
function readLevel(value, label, channels, range) {
  const level = util.readPlainObject(value, label);
  const width = util.readFiniteNumber(level.width, `${label}.width`, {
    integer: true,
    min: 1
  });
  const height = util.readFiniteNumber(level.height, `${label}.height`, {
    integer: true,
    min: 1
  });
  const transfer = packFloat16Rows(level.data, width, height, channels, label, range);
  return { width, height, ...transfer };
}

// 前処理済みIBL画像をGPU textureへ転送し、DeferredLightingPass用のresource集合を提供します
export default class PbrEnvironment {
  constructor(gpu, options = {}) {
    if (!gpu?.device || !gpu?.queue) {
      throw new Error("PbrEnvironment requires a ready WebGPU context");
    }
    this.gpu = gpu;
    this.label = util.readOptionalString(
      options.label,
      "PbrEnvironment label",
      "pbr-environment",
      { trim: true, allowEmpty: false }
    );
    const irradiance = readLevel(
      options.irradiance,
      `${this.label} irradiance`,
      4,
      { min: 0.0, max: HALF_FLOAT_MAX }
    );
    if (!Array.isArray(options.prefilteredSpecular) || options.prefilteredSpecular.length === 0) {
      throw new Error(`${this.label} prefilteredSpecular must contain at least one mip level`);
    }
    const specularLevels = options.prefilteredSpecular.map((level, index) => readLevel(
      level,
      `${this.label} prefilteredSpecular[${index}]`,
      4,
      { min: 0.0, max: HALF_FLOAT_MAX }
    ));
    for (let index = 1; index < specularLevels.length; index += 1) {
      const previous = specularLevels[index - 1];
      const current = specularLevels[index];
      const expectedWidth = Math.max(1, Math.floor(previous.width / 2));
      const expectedHeight = Math.max(1, Math.floor(previous.height / 2));
      if (current.width !== expectedWidth || current.height !== expectedHeight) {
        throw new Error(
          `${this.label} prefilteredSpecular[${index}] size must be `
          + `${expectedWidth}x${expectedHeight}`
        );
      }
    }
    const brdfLut = readLevel(
      options.brdfLut,
      `${this.label} brdfLut`,
      2,
      { min: 0.0, max: 1.0 }
    );
    const radiance = options.radiance === undefined
      ? null
      : readLevel(
        options.radiance,
        `${this.label} radiance`,
        4,
        { min: 0.0, max: HALF_FLOAT_MAX }
      );

    this.radianceTexture = radiance
      ? this.createTexture("radiance", "rgba16float", radiance, 1)
      : null;
    this.irradianceTexture = this.createTexture("irradiance", "rgba16float", irradiance, 1);
    this.specularTexture = this.createTexture(
      "prefiltered-specular",
      "rgba16float",
      specularLevels[0],
      specularLevels.length
    );
    this.brdfLutTexture = this.createTexture("brdf-lut", "rg16float", brdfLut, 1);
    if (radiance) this.writeLevel(this.radianceTexture, radiance, 0);
    this.writeLevel(this.irradianceTexture, irradiance, 0);
    for (let index = 0; index < specularLevels.length; index += 1) {
      this.writeLevel(this.specularTexture, specularLevels[index], index);
    }
    this.writeLevel(this.brdfLutTexture, brdfLut, 0);

    this.irradianceView = this.irradianceTexture.createView();
    this.specularView = this.specularTexture.createView();
    this.brdfLutView = this.brdfLutTexture.createView();
    this.radianceView = this.radianceTexture?.createView() ?? null;
    this.sampler = gpu.device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "linear",
      addressModeU: "repeat",
      addressModeV: "clamp-to-edge"
    });
    this.specularMipCount = specularLevels.length;
    this.irradiance = { getView: () => this.irradianceView };
    this.prefilteredSpecular = { getView: () => this.specularView };
    this.brdfLut = { getView: () => this.brdfLutView };
    this.radiance = this.radianceView
      ? { getView: () => this.radianceView }
      : null;
    this.destroyed = false;
  }

  // 指定formatとmip数を持つsampling専用textureを作ります
  createTexture(name, format, baseLevel, mipLevelCount) {
    return this.gpu.device.createTexture({
      label: `${this.label}:${name}`,
      size: [baseLevel.width, baseLevel.height, 1],
      format,
      mipLevelCount,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    });
  }

  // 既にbinary16へ変換しpitch調整した一つのmip levelをGPUへ転送します
  writeLevel(texture, level, mipLevel) {
    this.gpu.queue.writeTexture(
      { texture, mipLevel },
      level.packed,
      { bytesPerRow: level.bytesPerRow, rowsPerImage: level.height },
      { width: level.width, height: level.height, depthOrArrayLayers: 1 }
    );
  }

  // DeferredLightingPassが受け付ける5 fieldだけを公開し、内部状態をenvironment optionから分離します
  getResources() {
    if (this.destroyed) {
      throw new Error(`${this.label} is destroyed`);
    }
    const resources = {
      irradiance: this.irradiance,
      prefilteredSpecular: this.prefilteredSpecular,
      brdfLut: this.brdfLut,
      sampler: this.sampler,
      specularMipCount: this.specularMipCount
    };
    if (this.radiance) resources.radiance = this.radiance;
    return resources;
  }

  // 三つのGPU textureを一度だけ破棄します
  destroy() {
    if (this.destroyed) return false;
    this.irradianceTexture.destroy();
    this.radianceTexture?.destroy();
    this.specularTexture.destroy();
    this.brdfLutTexture.destroy();
    this.destroyed = true;
    return true;
  }
}
