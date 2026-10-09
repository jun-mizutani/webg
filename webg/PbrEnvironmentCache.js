// ---------------------------------------------
// PbrEnvironmentCache.js  2026/09/09
//   Versioned binary cache for preprocessed PBR environments
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import PbrEnvironment, {
  float16BitsToFloat32,
  float32ToFloat16Bits
} from "./PbrEnvironment.js";
import {
  readPbrEnvironmentPreprocessOptions
} from "./PbrEnvironmentReference.js";
import { validateRadianceHdrForEquirectangularIbl } from "./RadianceHdr.js";
import util from "./util.js";

export const PBR_ENVIRONMENT_CACHE_FORMAT = "webg-pbr-environment-cache";
export const PBR_ENVIRONMENT_CACHE_VERSION = 1;

const MAGIC = [0x57, 0x45, 0x42, 0x47, 0x50, 0x42, 0x52, 0x00];
const HEADER_BYTES = 16;
const HALF_FLOAT_BYTES = Uint16Array.BYTES_PER_ELEMENT;
const MAX_METADATA_BYTES = 1024 * 1024;
const MAX_PAYLOAD_BYTES = 1024 * 1024 * 1024;
export const PBR_ENVIRONMENT_GENERATOR_ID = "webg-split-sum-ggx-environment-mis-linear-srgb-v3";
const PREPROCESS_SETTING_KEYS = [
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
];
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

// objectの許可fieldを一箇所で検査し、cache版に対応するfieldだけを読み込みます
function rejectUnknownKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label}.${key} is not supported`);
  }
}

// ArrayBufferとそのviewだけを受け取り、binary入力の型を明示します
function readBytes(value, label) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new Error(`${label} must be an ArrayBuffer or typed-array view`);
}

// source IDはURLとは独立した内容識別子として必須にし、内容を識別できる文字列を使います
function readSourceId(value, label) {
  if (value === undefined) throw new Error(`${label} is required`);
  return util.readOptionalString(value, label, undefined, {
    trim: true,
    allowEmpty: false
  });
}

// cacheへ保存する生成条件は全fieldを必須にし、decoder側へ完全な条件を渡します
function readCompletePreprocessSettings(value, label) {
  const checked = util.readPlainObject(value, label);
  for (const name of PREPROCESS_SETTING_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(checked, name)) {
      throw new Error(`${label}.${name} is required`);
    }
  }
  return readPbrEnvironmentPreprocessOptions(checked);
}

// 一つのFloat32 levelについて寸法、channel数、値域を検証します
function readLevel(value, label, channels, range) {
  const level = util.readPlainObject(value, label);
  rejectUnknownKeys(level, new Set(["width", "height", "data"]), label);
  const width = util.readFiniteNumber(level.width, `${label}.width`, {
    integer: true,
    min: 1
  });
  const height = util.readFiniteNumber(level.height, `${label}.height`, {
    integer: true,
    min: 1
  });
  if (!(level.data instanceof Float32Array)) {
    throw new Error(`${label}.data must be a Float32Array`);
  }
  const expectedLength = width * height * channels;
  if (level.data.length !== expectedLength) {
    throw new Error(`${label}.data length must be ${expectedLength}: ${level.data.length}`);
  }
  for (let index = 0; index < level.data.length; index += 1) {
    util.readFiniteNumber(level.data[index], `${label}.data[${index}]`, range);
  }
  return { width, height, data: level.data, channels };
}

// settings順とmip寸法をCPU／Compute前処理と同じ規則で固定します
function readPreprocessed(value, label) {
  const preprocessed = util.readPlainObject(value, label);
  rejectUnknownKeys(
    preprocessed,
    new Set(["irradiance", "prefilteredSpecular", "brdfLut", "settings"]),
    label
  );
  const settings = readCompletePreprocessSettings(
    preprocessed.settings,
    `${label}.settings`
  );
  const irradiance = readLevel(
    preprocessed.irradiance,
    `${label}.irradiance`,
    4,
    { min: 0.0, max: 65504.0 }
  );
  if (irradiance.width !== settings.irradianceWidth
    || irradiance.height !== settings.irradianceHeight) {
    throw new Error(`${label}.irradiance size does not match settings`);
  }
  if (!Array.isArray(preprocessed.prefilteredSpecular)
    || preprocessed.prefilteredSpecular.length !== settings.specularMipCount) {
    throw new Error(
      `${label}.prefilteredSpecular length must be ${settings.specularMipCount}`
    );
  }
  let width = settings.specularWidth;
  let height = settings.specularHeight;
  const prefilteredSpecular = preprocessed.prefilteredSpecular.map((level, mipLevel) => {
    const checked = readLevel(
      level,
      `${label}.prefilteredSpecular[${mipLevel}]`,
      4,
      { min: 0.0, max: 65504.0 }
    );
    if (checked.width !== width || checked.height !== height) {
      throw new Error(
        `${label}.prefilteredSpecular[${mipLevel}] size must be ${width}x${height}`
      );
    }
    width = Math.max(1, Math.floor(width / 2));
    height = Math.max(1, Math.floor(height / 2));
    return checked;
  });
  const brdfLut = readLevel(
    preprocessed.brdfLut,
    `${label}.brdfLut`,
    2,
    { min: 0.0, max: 1.0 }
  );
  if (brdfLut.width !== settings.brdfLutWidth
    || brdfLut.height !== settings.brdfLutHeight) {
    throw new Error(`${label}.brdfLut size does not match settings`);
  }
  return { irradiance, prefilteredSpecular, brdfLut, settings };
}

// metadataとpayloadのlevel順を固定し、decoder側の推測を不要にします
function makeLevelDescriptors(source, preprocessed) {
  return [
    { name: "radiance", mipLevel: 0, width: source.width, height: source.height, channels: 4 },
    {
      name: "irradiance",
      mipLevel: 0,
      width: preprocessed.irradiance.width,
      height: preprocessed.irradiance.height,
      channels: 4
    },
    ...preprocessed.prefilteredSpecular.map((level, mipLevel) => ({
      name: "prefilteredSpecular",
      mipLevel,
      width: level.width,
      height: level.height,
      channels: 4
    })),
    {
      name: "brdfLut",
      mipLevel: 0,
      width: preprocessed.brdfLut.width,
      height: preprocessed.brdfLut.height,
      channels: 2
    }
  ];
}

// property順を固定したmetadataを作り、同じ入力から同じcache byte列を生成します
function makeMetadata(sourceId, source, preprocessed) {
  return {
    format: PBR_ENVIRONMENT_CACHE_FORMAT,
    version: PBR_ENVIRONMENT_CACHE_VERSION,
    generator: PBR_ENVIRONMENT_GENERATOR_ID,
    encoding: "float16-le",
    source: {
      id: sourceId,
      width: source.width,
      height: source.height,
      colorSpace: source.colorSpace,
      orientation: source.orientation
    },
    preprocess: { ...preprocessed.settings },
    levels: makeLevelDescriptors(source, preprocessed)
  };
}

// level値をlittle-endian binary16へ書き、HDRのlevel値を入力スケールのまま保持します
function writeHalfFloatLevel(view, byteOffset, level, label) {
  for (let index = 0; index < level.data.length; index += 1) {
    view.setUint16(
      byteOffset + index * HALF_FLOAT_BYTES,
      float32ToFloat16Bits(level.data[index], `${label}.data[${index}]`),
      true
    );
  }
  return byteOffset + level.data.length * HALF_FLOAT_BYTES;
}

// 元HDRと前処理結果を、版付きmetadataとhalf-float payloadからなる一つのArrayBufferへ保存します
export function encodePbrEnvironmentCache(options) {
  const checked = util.readPlainObject(options, "PBR environment cache options");
  rejectUnknownKeys(
    checked,
    new Set(["sourceId", "source", "preprocessed"]),
    "PBR environment cache options"
  );
  const sourceId = readSourceId(checked.sourceId, "PBR environment cache sourceId");
  const source = validateRadianceHdrForEquirectangularIbl(
    checked.source,
    "PBR environment cache source"
  );
  if (source.colorSpace !== "linear-srgb") {
    throw new Error("PBR environment cache source colorSpace must be linear-srgb");
  }
  const preprocessed = readPreprocessed(
    checked.preprocessed,
    "PBR environment cache preprocessed"
  );
  const metadata = makeMetadata(sourceId, source, preprocessed);
  const metadataBytes = textEncoder.encode(JSON.stringify(metadata));
  if (metadataBytes.length > MAX_METADATA_BYTES) {
    throw new Error(`PBR environment cache metadata exceeds ${MAX_METADATA_BYTES} bytes`);
  }
  const levels = [
    { ...source, channels: 4 },
    preprocessed.irradiance,
    ...preprocessed.prefilteredSpecular,
    preprocessed.brdfLut
  ];
  const payloadBytes = levels.reduce(
    (sum, level) => sum + level.data.length * HALF_FLOAT_BYTES,
    0
  );
  if (!Number.isSafeInteger(payloadBytes) || payloadBytes > MAX_PAYLOAD_BYTES) {
    throw new Error(`PBR environment cache payload exceeds ${MAX_PAYLOAD_BYTES} bytes`);
  }
  const buffer = new ArrayBuffer(HEADER_BYTES + metadataBytes.length + payloadBytes);
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  bytes.set(MAGIC, 0);
  view.setUint32(8, PBR_ENVIRONMENT_CACHE_VERSION, true);
  view.setUint32(12, metadataBytes.length, true);
  bytes.set(metadataBytes, HEADER_BYTES);
  let byteOffset = HEADER_BYTES + metadataBytes.length;
  levels.forEach((level, index) => {
    byteOffset = writeHalfFloatLevel(
      view,
      byteOffset,
      level,
      `PBR environment cache level[${index}]`
    );
  });
  return buffer;
}

// JSON parse後のmetadata構造を全field検証し、未知版や未知encodingを拒否します
function readMetadata(value) {
  const metadata = util.readPlainObject(value, "PBR environment cache metadata");
  rejectUnknownKeys(
    metadata,
    new Set([
      "format",
      "version",
      "generator",
      "encoding",
      "source",
      "preprocess",
      "levels"
    ]),
    "PBR environment cache metadata"
  );
  if (metadata.format !== PBR_ENVIRONMENT_CACHE_FORMAT) {
    throw new Error(`PBR environment cache format is not ${PBR_ENVIRONMENT_CACHE_FORMAT}`);
  }
  const version = util.readFiniteNumber(metadata.version, "PBR environment cache version", {
    integer: true,
    min: 1
  });
  if (version !== PBR_ENVIRONMENT_CACHE_VERSION) {
    throw new Error(`PBR environment cache version ${version} is not supported`);
  }
  if (metadata.encoding !== "float16-le") {
    throw new Error("PBR environment cache encoding must be float16-le");
  }
  if (metadata.generator !== PBR_ENVIRONMENT_GENERATOR_ID) {
    throw new Error(
      `PBR environment cache generator must be ${PBR_ENVIRONMENT_GENERATOR_ID}`
    );
  }
  const source = util.readPlainObject(metadata.source, "PBR environment cache source metadata");
  rejectUnknownKeys(
    source,
    new Set(["id", "width", "height", "colorSpace", "orientation"]),
    "PBR environment cache source metadata"
  );
  const checkedSource = {
    id: readSourceId(source.id, "PBR environment cache source metadata.id"),
    width: util.readFiniteNumber(source.width, "PBR environment cache source metadata.width", {
      integer: true,
      min: 1
    }),
    height: util.readFiniteNumber(source.height, "PBR environment cache source metadata.height", {
      integer: true,
      min: 1
    }),
    colorSpace: util.readOptionalString(
      source.colorSpace,
      "PBR environment cache source metadata.colorSpace",
      undefined,
      { trim: true, allowEmpty: false }
    ),
    orientation: util.readOptionalString(
      source.orientation,
      "PBR environment cache source metadata.orientation",
      undefined,
      { trim: true, allowEmpty: false }
    )
  };
  if (checkedSource.colorSpace !== "linear-srgb") {
    throw new Error("PBR environment cache source colorSpace must be linear-srgb");
  }
  if (checkedSource.orientation !== "-Y +X") {
    throw new Error("PBR environment cache source orientation must be -Y +X");
  }
  const preprocess = readCompletePreprocessSettings(
    metadata.preprocess,
    "PBR environment cache metadata.preprocess"
  );
  if (!Array.isArray(metadata.levels)) {
    throw new Error("PBR environment cache metadata.levels must be an array");
  }
  const expectedLevels = makeLevelDescriptors(checkedSource, {
    settings: preprocess,
    irradiance: { width: preprocess.irradianceWidth, height: preprocess.irradianceHeight },
    prefilteredSpecular: Array.from({ length: preprocess.specularMipCount }, (_unused, mipLevel) => ({
      width: Math.max(1, Math.floor(preprocess.specularWidth / (2 ** mipLevel))),
      height: Math.max(1, Math.floor(preprocess.specularHeight / (2 ** mipLevel)))
    })),
    brdfLut: { width: preprocess.brdfLutWidth, height: preprocess.brdfLutHeight }
  });
  if (metadata.levels.length !== expectedLevels.length) {
    throw new Error(`PBR environment cache metadata.levels length must be ${expectedLevels.length}`);
  }
  metadata.levels.forEach((level, index) => {
    const checkedLevel = util.readPlainObject(level, `PBR environment cache metadata.levels[${index}]`);
    rejectUnknownKeys(
      checkedLevel,
      new Set(["name", "mipLevel", "width", "height", "channels"]),
      `PBR environment cache metadata.levels[${index}]`
    );
    const expected = expectedLevels[index];
    for (const name of ["name", "mipLevel", "width", "height", "channels"]) {
      if (checkedLevel[name] !== expected[name]) {
        throw new Error(
          `PBR environment cache metadata.levels[${index}].${name} must be ${expected[name]}`
        );
      }
    }
  });
  return { ...metadata, source: checkedSource, preprocess, levels: expectedLevels };
}

// 一つのpayload levelをFloat32へ戻し、PbrEnvironmentの既存入力形式へ接続します
function readHalfFloatLevel(view, byteOffset, descriptor) {
  const valueCount = descriptor.width * descriptor.height * descriptor.channels;
  const data = new Float32Array(valueCount);
  for (let index = 0; index < valueCount; index += 1) {
    data[index] = float16BitsToFloat32(
      view.getUint16(byteOffset + index * HALF_FLOAT_BYTES, true),
      `PBR environment cache ${descriptor.name}[${index}]`
    );
  }
  return {
    level: { width: descriptor.width, height: descriptor.height, data },
    nextOffset: byteOffset + valueCount * HALF_FLOAT_BYTES
  };
}

// cacheを厳密に復号し、期待source IDまたは前処理条件が違う場合は利用前に止めます
export function decodePbrEnvironmentCache(value, options = {}) {
  const checkedOptions = util.readPlainObject(options, "PBR environment cache decode options");
  rejectUnknownKeys(
    checkedOptions,
    new Set(["expectedSourceId", "expectedSettings"]),
    "PBR environment cache decode options"
  );
  const bytes = readBytes(value, "PBR environment cache data");
  if (bytes.byteLength < HEADER_BYTES) throw new Error("PBR environment cache header is truncated");
  for (let index = 0; index < MAGIC.length; index += 1) {
    if (bytes[index] !== MAGIC[index]) throw new Error("PBR environment cache magic does not match");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerVersion = view.getUint32(8, true);
  if (headerVersion !== PBR_ENVIRONMENT_CACHE_VERSION) {
    throw new Error(`PBR environment cache version ${headerVersion} is not supported`);
  }
  const metadataLength = view.getUint32(12, true);
  if (metadataLength > MAX_METADATA_BYTES) {
    throw new Error(`PBR environment cache metadata exceeds ${MAX_METADATA_BYTES} bytes`);
  }
  const payloadOffset = HEADER_BYTES + metadataLength;
  if (payloadOffset > bytes.byteLength) {
    throw new Error("PBR environment cache metadata is truncated");
  }
  let parsedMetadata;
  try {
    parsedMetadata = JSON.parse(textDecoder.decode(bytes.subarray(HEADER_BYTES, payloadOffset)));
  } catch (error) {
    throw new Error(`PBR environment cache metadata is invalid: ${error.message}`);
  }
  const metadata = readMetadata(parsedMetadata);
  const expectedPayloadBytes = metadata.levels.reduce((sum, descriptor) => {
    const levelBytes = descriptor.width * descriptor.height
      * descriptor.channels * HALF_FLOAT_BYTES;
    if (!Number.isSafeInteger(levelBytes)) {
      throw new Error(`PBR environment cache ${descriptor.name} payload size is not safe`);
    }
    return sum + levelBytes;
  }, 0);
  if (!Number.isSafeInteger(expectedPayloadBytes)
    || expectedPayloadBytes > MAX_PAYLOAD_BYTES) {
    throw new Error(`PBR environment cache payload exceeds ${MAX_PAYLOAD_BYTES} bytes`);
  }
  if (checkedOptions.expectedSourceId !== undefined) {
    const expectedSourceId = readSourceId(
      checkedOptions.expectedSourceId,
      "PBR environment cache expectedSourceId"
    );
    if (metadata.source.id !== expectedSourceId) {
      throw new Error(
        `PBR environment cache source ID ${metadata.source.id} does not match ${expectedSourceId}`
      );
    }
  }
  if (checkedOptions.expectedSettings !== undefined) {
    const expected = readCompletePreprocessSettings(
      checkedOptions.expectedSettings,
      "PBR environment cache expectedSettings"
    );
    for (const [name, expectedValue] of Object.entries(expected)) {
      if (metadata.preprocess[name] !== expectedValue) {
        throw new Error(
          `PBR environment cache preprocess.${name} ${metadata.preprocess[name]} `
          + `does not match ${expectedValue}`
        );
      }
    }
  }
  let byteOffset = payloadOffset;
  const decodedLevels = metadata.levels.map((descriptor) => {
    const byteLength = descriptor.width * descriptor.height
      * descriptor.channels * HALF_FLOAT_BYTES;
    if (byteOffset + byteLength > bytes.byteLength) {
      throw new Error(`PBR environment cache ${descriptor.name} payload is truncated`);
    }
    const decoded = readHalfFloatLevel(view, byteOffset, descriptor);
    byteOffset = decoded.nextOffset;
    return decoded.level;
  });
  if (byteOffset !== bytes.byteLength) {
    throw new Error("PBR environment cache has trailing payload bytes");
  }
  const specularStart = 2;
  const specularEnd = specularStart + metadata.preprocess.specularMipCount;
  return {
    metadata,
    environment: {
      radiance: decodedLevels[0],
      irradiance: decodedLevels[1],
      prefilteredSpecular: decodedLevels.slice(specularStart, specularEnd),
      brdfLut: decodedLevels[specularEnd]
    }
  };
}

// HTTP statusとarrayBuffer APIを検証し、通信成功時の環境データだけをcacheへ保存します
export async function loadPbrEnvironmentCache(url, options = {}) {
  const checked = util.readPlainObject(options, "PBR environment cache load options");
  rejectUnknownKeys(
    checked,
    new Set(["fetch", "expectedSourceId", "expectedSettings"]),
    "PBR environment cache load options"
  );
  const checkedUrl = util.readOptionalString(
    url,
    "PBR environment cache URL",
    undefined,
    { trim: true, allowEmpty: false }
  );
  if (url === undefined) throw new Error("PBR environment cache URL is required");
  const fetchFunction = util.readOptionalFunction(
    checked.fetch,
    "PBR environment cache fetch",
    globalThis.fetch,
    { allowNull: false }
  );
  if (typeof fetchFunction !== "function") {
    throw new Error("PBR environment cache load requires fetch");
  }
  const response = await fetchFunction(checkedUrl);
  if (!response || typeof response.arrayBuffer !== "function") {
    throw new Error("PBR environment cache fetch response requires arrayBuffer()");
  }
  if (response.ok !== true) {
    throw new Error(
      `PBR environment cache request failed with status ${response.status ?? "unknown"}`
    );
  }
  return decodePbrEnvironmentCache(await response.arrayBuffer(), {
    expectedSourceId: checked.expectedSourceId,
    expectedSettings: checked.expectedSettings
  });
}

// 同じkeyの非同期loadとGPU environmentを共有し、利用中resourceの破棄を拒否します
export class PbrEnvironmentCacheRepository {
  constructor(gpu, options = {}) {
    if (!gpu?.device || !gpu?.queue) {
      throw new Error("PbrEnvironmentCacheRepository requires a ready WebGPU context");
    }
    const checked = util.readPlainObject(options, "PBR environment repository options");
    rejectUnknownKeys(checked, new Set(["loader", "label"]), "PBR environment repository options");
    this.gpu = gpu;
    this.loader = util.readOptionalFunction(
      checked.loader,
      "PBR environment repository loader",
      loadPbrEnvironmentCache,
      { allowNull: false }
    );
    this.label = util.readOptionalString(
      checked.label,
      "PBR environment repository label",
      "pbr-environment-repository",
      { trim: true, allowEmpty: false }
    );
    this.entries = new Map();
    this.destroyed = false;
    this.destroying = false;
  }

  // cacheが破棄処理へ入っていないことを確認し、request操作の入口を保護します
  requireAvailable() {
    if (this.destroyed || this.destroying) throw new Error(`${this.label} is not available`);
  }

  // key、URL、期待条件を一つのrequest signatureへ固定し、同じkeyの意味変更を拒否します
  makeRequest(key, url, options) {
    if (key === undefined) throw new Error(`${this.label} key is required`);
    const checkedKey = util.readOptionalString(key, `${this.label} key`, undefined, {
      trim: true,
      allowEmpty: false
    });
    if (url === undefined) throw new Error(`${this.label} URL is required`);
    const checkedUrl = util.readOptionalString(url, `${this.label} URL`, undefined, {
      trim: true,
      allowEmpty: false
    });
    const checkedOptions = util.readPlainObject(options, `${this.label} acquire options`);
    rejectUnknownKeys(
      checkedOptions,
      new Set(["expectedSourceId", "expectedSettings"]),
      `${this.label} acquire options`
    );
    const expectedSourceId = checkedOptions.expectedSourceId === undefined
      ? undefined
      : readSourceId(checkedOptions.expectedSourceId, `${this.label} expectedSourceId`);
    const expectedSettings = checkedOptions.expectedSettings === undefined
      ? undefined
      : readCompletePreprocessSettings(
        checkedOptions.expectedSettings,
        `${this.label} expectedSettings`
      );
    return {
      key: checkedKey,
      url: checkedUrl,
      expectedSourceId,
      expectedSettings,
      signature: JSON.stringify([checkedUrl, expectedSourceId ?? null, expectedSettings ?? null])
    };
  }

  // 最初のacquireだけloadとGPU転送を行い、同じkeyの並行acquireも一つのPromiseを共有します
  async acquire(key, url, options = {}) {
    this.requireAvailable();
    const request = this.makeRequest(key, url, options);
    let entry = this.entries.get(request.key);
    if (entry && entry.signature !== request.signature) {
      throw new Error(`${this.label} key ${request.key} is already bound to different input`);
    }
    if (!entry) {
      entry = {
        signature: request.signature,
        references: 0,
        environment: null,
        promise: null
      };
      entry.promise = Promise.resolve(this.loader(request.url, {
        expectedSourceId: request.expectedSourceId,
        expectedSettings: request.expectedSettings
      })).then((decoded) => {
        entry.environment = new PbrEnvironment(this.gpu, {
          label: `${this.label}:${request.key}`,
          ...decoded.environment
        });
        return entry.environment;
      }).catch((error) => {
        if (this.entries.get(request.key) === entry) this.entries.delete(request.key);
        throw error;
      });
      this.entries.set(request.key, entry);
    }
    const environment = await entry.promise;
    this.requireAvailable();
    entry.references += 1;
    let released = false;
    return {
      environment,
      getResources: () => {
        if (released) throw new Error(`${this.label} handle ${request.key} is released`);
        return environment.getResources();
      },
      release: () => {
        if (released) return false;
        released = true;
        entry.references -= 1;
        return true;
      }
    };
  }

  // 参照中のenvironmentは破棄せず例外にし、0参照になったkeyだけを明示削除します
  async evict(key) {
    this.requireAvailable();
    const checkedKey = util.readOptionalString(key, `${this.label} key`, undefined, {
      trim: true,
      allowEmpty: false
    });
    const entry = this.entries.get(checkedKey);
    if (!entry) return false;
    const environment = await entry.promise;
    if (entry.references !== 0) {
      throw new Error(`${this.label} key ${checkedKey} has ${entry.references} active reference(s)`);
    }
    environment.destroy();
    this.entries.delete(checkedKey);
    return true;
  }

  // repository全体も0参照を必須にし、利用中resourceを参照数に応じて保持します
  async destroy() {
    if (this.destroyed) return false;
    if (this.destroying) throw new Error(`${this.label} destroy is already in progress`);
    this.destroying = true;
    const entries = [...this.entries.entries()];
    try {
      const environments = await Promise.all(entries.map(([_key, entry]) => entry.promise));
      for (const [key, entry] of entries) {
        if (entry.references !== 0) {
          throw new Error(`${this.label} key ${key} has ${entry.references} active reference(s)`);
        }
      }
      for (const environment of environments) environment.destroy();
      this.entries.clear();
      this.destroyed = true;
      return true;
    } finally {
      this.destroying = false;
    }
  }
}
