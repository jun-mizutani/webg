// ---------------------------------------------
// RadianceHdr.js  2026/08/14
//   Strict Radiance RGBE decoder for PBR environment input
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import util from "./util.js";

const RADIANCE_RGBE_FORMAT = "32-bit_rle_rgbe";
const STANDARD_ORIENTATION = "-Y +X";
const DEFAULT_MAX_PIXELS = 8192 * 4096;
const FLOAT32_MAX = 3.4028234663852886e38;
const MAX_HEADER_BYTES = 64 * 1024;
const MAX_HEADER_LINE_BYTES = 4096;
const NORMALIZED_DIRECTION_EPSILON = 1.0e-5;

// Radianceの既定RGB primariesとequal-energy whiteを公開し、Radiance色空間として扱います
export const RADIANCE_STANDARD_PRIMARIES = Object.freeze([
  0.640, 0.330,
  0.290, 0.600,
  0.150, 0.060,
  0.333, 0.333
]);

// webgのbase color、glTF texture、Tone Mappingが前提とするlinear sRGBの色度座標です
// 最後の2値はsRGB規格で使うD65 whiteであり、Radiance既定のequal-energy whiteとは異なります
export const LINEAR_SRGB_PRIMARIES = Object.freeze([
  0.6400, 0.3300,
  0.3000, 0.6000,
  0.1500, 0.0600,
  0.3127, 0.3290
]);

// Bradford色順応でsource whiteをD65へ移すための行列と逆行列です
// RGBの見た目をchannel名だけで対応させず、sourceとtargetのwhite point差をXYZ上で明示します
const BRADFORD_MATRIX = [
  0.8951, 0.2664, -0.1614,
  -0.7502, 1.7135, 0.0367,
  0.0389, -0.0685, 1.0296
];
const BRADFORD_INVERSE_MATRIX = [
  0.9869929, -0.1470543, 0.1599627,
  0.4323053, 0.5183603, 0.0492912,
  -0.0085287, 0.0400428, 0.9684867
];

// row-major 3x3行列とvec3を乗算し、色変換の各段階で同じ並びを使用します
function multiplyMatrix3Vector(matrix, vector) {
  return [
    matrix[0] * vector[0] + matrix[1] * vector[1] + matrix[2] * vector[2],
    matrix[3] * vector[0] + matrix[4] * vector[1] + matrix[5] * vector[2],
    matrix[6] * vector[0] + matrix[7] * vector[1] + matrix[8] * vector[2]
  ];
}

// 二つのrow-major 3x3行列を合成し、RGBからXYZ、色順応、XYZからRGBを一つへまとめます
function multiplyMatrix3(left, right) {
  const result = new Array(9);
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      result[row * 3 + column] = left[row * 3] * right[column]
        + left[row * 3 + 1] * right[3 + column]
        + left[row * 3 + 2] * right[6 + column];
    }
  }
  return result;
}

// 3x3行列を余因子から反転し、退化したprimariesを近似値へ置き換えず例外にします
function invertMatrix3(matrix, label) {
  const determinant = matrix[0] * (matrix[4] * matrix[8] - matrix[5] * matrix[7])
    - matrix[1] * (matrix[3] * matrix[8] - matrix[5] * matrix[6])
    + matrix[2] * (matrix[3] * matrix[7] - matrix[4] * matrix[6]);
  if (!Number.isFinite(determinant) || Math.abs(determinant) <= 1.0e-12) {
    throw new Error(`${label} matrix must be invertible`);
  }
  const inverseDeterminant = 1.0 / determinant;
  return [
    (matrix[4] * matrix[8] - matrix[5] * matrix[7]) * inverseDeterminant,
    (matrix[2] * matrix[7] - matrix[1] * matrix[8]) * inverseDeterminant,
    (matrix[1] * matrix[5] - matrix[2] * matrix[4]) * inverseDeterminant,
    (matrix[5] * matrix[6] - matrix[3] * matrix[8]) * inverseDeterminant,
    (matrix[0] * matrix[8] - matrix[2] * matrix[6]) * inverseDeterminant,
    (matrix[2] * matrix[3] - matrix[0] * matrix[5]) * inverseDeterminant,
    (matrix[3] * matrix[7] - matrix[4] * matrix[6]) * inverseDeterminant,
    (matrix[1] * matrix[6] - matrix[0] * matrix[7]) * inverseDeterminant,
    (matrix[0] * matrix[4] - matrix[1] * matrix[3]) * inverseDeterminant
  ];
}

// xy色度をY=1のXYZへ変換し、white pointと各primaryを同じ座標系で扱います
function chromaticityToXyz(x, y, label) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || y <= 0.0 || x <= 0.0 || x + y >= 1.0) {
    throw new Error(`${label} chromaticity must satisfy x > 0, y > 0, and x + y < 1`);
  }
  return [x / y, 1.0, (1.0 - x - y) / y];
}

// RGB primariesとwhite pointからRGB-to-XYZ行列を組み立て、white RGB [1,1,1]を指定whiteへ一致させます
function createRgbToXyzMatrix(primaries, label) {
  const red = chromaticityToXyz(primaries[0], primaries[1], `${label} red`);
  const green = chromaticityToXyz(primaries[2], primaries[3], `${label} green`);
  const blue = chromaticityToXyz(primaries[4], primaries[5], `${label} blue`);
  const white = chromaticityToXyz(primaries[6], primaries[7], `${label} white`);
  const primaryMatrix = [
    red[0], green[0], blue[0],
    red[1], green[1], blue[1],
    red[2], green[2], blue[2]
  ];
  const scale = multiplyMatrix3Vector(
    invertMatrix3(primaryMatrix, `${label} primaries`),
    white
  );
  return [
    primaryMatrix[0] * scale[0], primaryMatrix[1] * scale[1], primaryMatrix[2] * scale[2],
    primaryMatrix[3] * scale[0], primaryMatrix[4] * scale[1], primaryMatrix[5] * scale[2],
    primaryMatrix[6] * scale[0], primaryMatrix[7] * scale[1], primaryMatrix[8] * scale[2]
  ];
}

// Radiance equal-energy whiteからsRGB D65へBradford順応した後、linear sRGBへ変換する固定行列を作ります
function createRadianceStandardToLinearSrgbMatrix() {
  const sourceRgbToXyz = createRgbToXyzMatrix(
    RADIANCE_STANDARD_PRIMARIES,
    "Radiance standard"
  );
  const targetRgbToXyz = createRgbToXyzMatrix(LINEAR_SRGB_PRIMARIES, "linear sRGB");
  const sourceWhite = chromaticityToXyz(
    RADIANCE_STANDARD_PRIMARIES[6],
    RADIANCE_STANDARD_PRIMARIES[7],
    "Radiance standard white"
  );
  const targetWhite = chromaticityToXyz(
    LINEAR_SRGB_PRIMARIES[6],
    LINEAR_SRGB_PRIMARIES[7],
    "linear sRGB white"
  );
  const sourceCone = multiplyMatrix3Vector(BRADFORD_MATRIX, sourceWhite);
  const targetCone = multiplyMatrix3Vector(BRADFORD_MATRIX, targetWhite);
  const coneScale = [
    targetCone[0] / sourceCone[0], 0.0, 0.0,
    0.0, targetCone[1] / sourceCone[1], 0.0,
    0.0, 0.0, targetCone[2] / sourceCone[2]
  ];
  const adaptation = multiplyMatrix3(
    BRADFORD_INVERSE_MATRIX,
    multiplyMatrix3(coneScale, BRADFORD_MATRIX)
  );
  return multiplyMatrix3(
    invertMatrix3(targetRgbToXyz, "linear sRGB RGB-to-XYZ"),
    multiplyMatrix3(adaptation, sourceRgbToXyz)
  );
}

// CPU asset生成とtestが同じ係数を確認できるよう、計算済み変換行列を公開します
export const RADIANCE_STANDARD_TO_LINEAR_SRGB_MATRIX = Object.freeze(
  createRadianceStandardToLinearSrgbMatrix()
);

// decoderが既定で許可する最大pixel数を公開し、大きなallocationの上限を呼出側から確認可能にします
export const RADIANCE_HDR_DEFAULT_MAX_PIXELS = DEFAULT_MAX_PIXELS;

// option objectの未知fieldを拒否し、綴り間違いがdecoder設定へ反映されない状態を避けます
function readDecodeOptions(options) {
  const checked = util.readPlainObject(options, "Radiance HDR options");
  const supported = new Set(["label", "maxPixels"]);
  for (const key of Object.keys(checked)) {
    if (!supported.has(key)) {
      throw new Error(`Radiance HDR options.${key} is not supported`);
    }
  }
  return {
    label: util.readOptionalString(
      checked.label,
      "Radiance HDR options.label",
      "Radiance HDR",
      { trim: true, allowEmpty: false }
    ),
    maxPixels: util.readOptionalInteger(
      checked.maxPixels,
      "Radiance HDR options.maxPixels",
      DEFAULT_MAX_PIXELS,
      { min: 1, max: Number.MAX_SAFE_INTEGER }
    )
  };
}

// ArrayBufferまたはUint8Arrayだけを受け取り、binary入力の型を明示します
function readInputBytes(input, label) {
  if (input instanceof Uint8Array) {
    return input;
  }
  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input);
  }
  throw new Error(`${label} input must be an ArrayBuffer or Uint8Array`);
}

// LFまたはCRLFのASCII行を読み、binary payloadへ入る前のheader境界を厳密に進めます
function readAsciiLine(bytes, state, label) {
  const start = state.offset;
  if (start >= bytes.length) {
    throw new Error(`${label} ended before the next header line`);
  }
  let end = start;
  while (end < bytes.length && bytes[end] !== 0x0a) {
    const value = bytes[end];
    if (value !== 0x09 && value !== 0x0d && (value < 0x20 || value > 0x7e)) {
      throw new Error(`${label} header contains a non-ASCII byte at offset ${end}`);
    }
    end += 1;
    if (end - start > MAX_HEADER_LINE_BYTES) {
      throw new Error(`${label} header line exceeds ${MAX_HEADER_LINE_BYTES} bytes`);
    }
  }
  if (end >= bytes.length) {
    throw new Error(`${label} header line is not terminated by LF`);
  }
  let textEnd = end;
  if (textEnd > start && bytes[textEnd - 1] === 0x0d) {
    textEnd -= 1;
  }
  let text = "";
  for (let index = start; index < textEnd; index += 1) {
    text += String.fromCharCode(bytes[index]);
  }
  state.offset = end + 1;
  if (state.offset > MAX_HEADER_BYTES) {
    throw new Error(`${label} header exceeds ${MAX_HEADER_BYTES} bytes`);
  }
  return text;
}

// header数値を完全一致で読み、Numberが先頭部分だけを受け入れる状態を避けます
function readHeaderNumber(text, label, constraints = {}) {
  const trimmed = text.trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)) {
    throw new Error(`${label} must be a decimal number`);
  }
  return util.readFiniteNumber(Number(trimmed), label, constraints);
}

// 空白区切りの固定個数数値を読み、指定個数に一致する行だけを受け付けます
function readHeaderNumberList(text, count, label, constraints = {}) {
  const parts = text.trim().split(/\s+/);
  if (parts.length !== count || parts.some((part) => part.length === 0)) {
    throw new Error(`${label} must contain ${count} numbers`);
  }
  return parts.map((part, index) => readHeaderNumber(
    part,
    `${label}[${index}]`,
    constraints
  ));
}

// exposureやcolor correctionの累積積を検査し、有限値だけを後段へ渡します
function multiplyFinitePositive(current, value, label) {
  const next = current * value;
  if (!Number.isFinite(next) || next <= 0.0) {
    throw new Error(`${label} cumulative product must be finite and > 0`);
  }
  return next;
}

// 情報headerを読み、pixel値の物理的な復元に必要な累積metadataを保持します
function readHeader(bytes, state, label) {
  const magic = readAsciiLine(bytes, state, label);
  if (magic !== "#?RADIANCE" && magic !== "#?RGBE") {
    throw new Error(`${label} magic must be #?RADIANCE or #?RGBE`);
  }

  let format = null;
  let exposure = 1.0;
  const colorCorrection = [1.0, 1.0, 1.0];
  let pixelAspect = 1.0;
  let gamma = 1.0;
  let gammaSeen = false;
  let primaries = [...RADIANCE_STANDARD_PRIMARIES];
  let primariesSeen = false;
  const headerLines = [];

  while (true) {
    const line = readAsciiLine(bytes, state, label);
    if (line.length === 0) break;
    headerLines.push(line);
    const assignment = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!assignment) continue;
    const [, name, valueText] = assignment;
    if (name === "FORMAT") {
      if (format !== null) {
        throw new Error(`${label} FORMAT must appear exactly once`);
      }
      format = valueText.trim();
      continue;
    }
    if (name === "EXPOSURE") {
      const value = readHeaderNumber(valueText, `${label} EXPOSURE`, { minExclusive: 0.0 });
      exposure = multiplyFinitePositive(exposure, value, `${label} EXPOSURE`);
      continue;
    }
    if (name === "COLORCORR") {
      const values = readHeaderNumberList(
        valueText,
        3,
        `${label} COLORCORR`,
        { minExclusive: 0.0 }
      );
      for (let channel = 0; channel < 3; channel += 1) {
        colorCorrection[channel] = multiplyFinitePositive(
          colorCorrection[channel],
          values[channel],
          `${label} COLORCORR[${channel}]`
        );
      }
      continue;
    }
    if (name === "PIXASPECT") {
      const value = readHeaderNumber(valueText, `${label} PIXASPECT`, { minExclusive: 0.0 });
      pixelAspect = multiplyFinitePositive(pixelAspect, value, `${label} PIXASPECT`);
      continue;
    }
    if (name === "GAMMA") {
      if (gammaSeen) {
        throw new Error(`${label} GAMMA must not appear more than once`);
      }
      gamma = readHeaderNumber(valueText, `${label} GAMMA`, { minExclusive: 0.0 });
      gammaSeen = true;
      continue;
    }
    if (name === "PRIMARIES") {
      if (primariesSeen) {
        throw new Error(`${label} PRIMARIES must not appear more than once`);
      }
      primaries = readHeaderNumberList(
        valueText,
        8,
        `${label} PRIMARIES`,
        { minExclusive: 0.0, maxExclusive: 1.0 }
      );
      primariesSeen = true;
    }
  }

  if (format === null) {
    throw new Error(`${label} requires FORMAT=${RADIANCE_RGBE_FORMAT}`);
  }
  if (format !== RADIANCE_RGBE_FORMAT) {
    throw new Error(`${label} FORMAT must be ${RADIANCE_RGBE_FORMAT}: ${format}`);
  }
  if (gamma !== 1.0) {
    throw new Error(`${label} GAMMA must be 1 for linear RGB input: ${gamma}`);
  }
  return {
    magic,
    format,
    exposure,
    colorCorrection,
    pixelAspect,
    gamma,
    primaries,
    headerLines
  };
}

// 標準の上から下、左から右の並びだけを受け入れ、画像の向きを入力規約として固定します
function readResolution(bytes, state, label, maxPixels) {
  const line = readAsciiLine(bytes, state, label);
  const match = /^(-Y)\s+(\d+)\s+(\+X)\s+(\d+)$/.exec(line);
  if (!match) {
    throw new Error(`${label} resolution must use standard -Y height +X width orientation`);
  }
  const height = util.readFiniteNumber(Number(match[2]), `${label} height`, {
    integer: true,
    min: 1,
    max: 32767
  });
  const width = util.readFiniteNumber(Number(match[4]), `${label} width`, {
    integer: true,
    min: 1,
    max: 32767
  });
  const pixelCount = width * height;
  if (!Number.isSafeInteger(pixelCount) || pixelCount > maxPixels) {
    throw new Error(`${label} pixel count must be <= ${maxPixels}: ${pixelCount}`);
  }
  return { width, height, pixelCount, orientation: STANDARD_ORIENTATION };
}

// 新RLEの一channelを復号し、runとliteralがscanline幅を越えないことを確認します
function decodeNewRleChannel(bytes, state, channelData, label) {
  let output = 0;
  while (output < channelData.length) {
    if (state.offset >= bytes.length) {
      throw new Error(`${label} ended inside a new-RLE channel`);
    }
    const code = bytes[state.offset];
    state.offset += 1;
    if (code === 0) {
      throw new Error(`${label} new-RLE packet count must not be 0`);
    }
    if (code > 128) {
      const count = code - 128;
      if (state.offset >= bytes.length) {
        throw new Error(`${label} ended before a new-RLE run value`);
      }
      if (output + count > channelData.length) {
        throw new Error(`${label} new-RLE run exceeds the scanline width`);
      }
      const value = bytes[state.offset];
      state.offset += 1;
      channelData.fill(value, output, output + count);
      output += count;
      continue;
    }
    // Radiance公式writerは非runを最大128 byteに分割するため、128も有効なliteral長です
    const count = code;
    if (output + count > channelData.length) {
      throw new Error(`${label} new-RLE literal exceeds the scanline width`);
    }
    if (state.offset + count > bytes.length) {
      throw new Error(`${label} ended inside a new-RLE literal`);
    }
    channelData.set(bytes.subarray(state.offset, state.offset + count), output);
    state.offset += count;
    output += count;
  }
}

// 一つの新RLE scanlineを4本のchannel streamからinterleaved RGBEへ戻します
function decodeNewRleScanline(bytes, state, width, firstBytes, label) {
  const encodedWidth = (firstBytes[2] << 8) | firstBytes[3];
  if (encodedWidth !== width) {
    throw new Error(`${label} new-RLE scanline width must be ${width}: ${encodedWidth}`);
  }
  const channels = Array.from({ length: 4 }, () => new Uint8Array(width));
  for (let channel = 0; channel < 4; channel += 1) {
    decodeNewRleChannel(bytes, state, channels[channel], `${label} channel ${channel}`);
  }
  const scanline = new Uint8Array(width * 4);
  for (let x = 0; x < width; x += 1) {
    const offset = x * 4;
    scanline[offset] = channels[0][x];
    scanline[offset + 1] = channels[1][x];
    scanline[offset + 2] = channels[2][x];
    scanline[offset + 3] = channels[3][x];
  }
  return scanline;
}

// 非圧縮と旧RLEを同じ規則で読み、repeat markerが直前pixelを越えて増殖しないよう検証します
function decodeOldOrFlatScanline(bytes, state, width, firstBytes, label) {
  const scanline = new Uint8Array(width * 4);
  let outputPixel = 0;
  let repeatShift = 0;
  let pixel = firstBytes;

  while (outputPixel < width) {
    if (pixel === null) {
      if (state.offset + 4 > bytes.length) {
        throw new Error(`${label} ended inside an RGBE pixel`);
      }
      pixel = bytes.subarray(state.offset, state.offset + 4);
      state.offset += 4;
    }
    const isRepeat = pixel[0] === 1 && pixel[1] === 1 && pixel[2] === 1;
    if (isRepeat) {
      if (outputPixel === 0) {
        throw new Error(`${label} old-RLE repeat cannot be the first pixel`);
      }
      if (repeatShift > 40) {
        throw new Error(`${label} old-RLE repeat count is too large`);
      }
      const count = pixel[3] * 2 ** repeatShift;
      if (!Number.isSafeInteger(count) || count <= 0 || outputPixel + count > width) {
        throw new Error(`${label} old-RLE repeat exceeds the scanline width`);
      }
      const previous = scanline.subarray((outputPixel - 1) * 4, outputPixel * 4);
      for (let index = 0; index < count; index += 1) {
        scanline.set(previous, outputPixel * 4);
        outputPixel += 1;
      }
      repeatShift += 8;
      pixel = null;
      continue;
    }
    scanline.set(pixel, outputPixel * 4);
    outputPixel += 1;
    repeatShift = 0;
    pixel = null;
  }
  return scanline;
}

// scanline先頭markerから新RLEか旧RLE／flatかを判定し、判定結果に対応するdecoderを使います
function decodeScanline(bytes, state, width, row, label) {
  if (state.offset + 4 > bytes.length) {
    throw new Error(`${label} ended before scanline ${row}`);
  }
  const firstBytes = bytes.subarray(state.offset, state.offset + 4);
  state.offset += 4;
  const newRle = width >= 8
    && width <= 32767
    && firstBytes[0] === 2
    && firstBytes[1] === 2
    && (firstBytes[2] & 0x80) === 0;
  if (newRle) {
    return decodeNewRleScanline(bytes, state, width, firstBytes, `${label} row ${row}`);
  }
  return decodeOldOrFlatScanline(bytes, state, width, firstBytes, `${label} row ${row}`);
}

// RGBEの共通指数をRadiance公式の+0.5 mantissa規則で線形floatへ復元します
function decodeRgbePixel(rgbe, output, outputOffset, correction, label, pixelIndex) {
  const exponent = rgbe[3];
  if (exponent === 0) {
    output[outputOffset] = 0.0;
    output[outputOffset + 1] = 0.0;
    output[outputOffset + 2] = 0.0;
    output[outputOffset + 3] = 1.0;
    return;
  }
  const scale = 2 ** (exponent - 136);
  for (let channel = 0; channel < 3; channel += 1) {
    const value = ((rgbe[channel] + 0.5) * scale) / correction[channel];
    if (!Number.isFinite(value) || value < 0.0 || value > FLOAT32_MAX) {
      throw new Error(`${label} pixel ${pixelIndex} channel ${channel} is outside finite float32 range`);
    }
    const stored = Math.fround(value);
    if (!Number.isFinite(stored)) {
      throw new Error(`${label} pixel ${pixelIndex} channel ${channel} cannot be stored as float32`);
    }
    output[outputOffset + channel] = stored;
  }
  output[outputOffset + 3] = 1.0;
}

// Radiance RGBE全体を線形RGBA Float32Arrayへ復号し、header補正後の値を返します
export function decodeRadianceHdr(input, options = {}) {
  const checkedOptions = readDecodeOptions(options);
  const bytes = readInputBytes(input, checkedOptions.label);
  const state = { offset: 0 };
  const header = readHeader(bytes, state, checkedOptions.label);
  const resolution = readResolution(
    bytes,
    state,
    checkedOptions.label,
    checkedOptions.maxPixels
  );
  const correction = header.colorCorrection.map((value) => value * header.exposure);
  if (correction.some((value) => !Number.isFinite(value) || value <= 0.0)) {
    throw new Error(`${checkedOptions.label} exposure and COLORCORR product must be finite and > 0`);
  }

  const data = new Float32Array(resolution.pixelCount * 4);
  for (let row = 0; row < resolution.height; row += 1) {
    const scanline = decodeScanline(
      bytes,
      state,
      resolution.width,
      row,
      checkedOptions.label
    );
    for (let x = 0; x < resolution.width; x += 1) {
      const pixelIndex = row * resolution.width + x;
      decodeRgbePixel(
        scanline.subarray(x * 4, x * 4 + 4),
        data,
        pixelIndex * 4,
        correction,
        checkedOptions.label,
        pixelIndex
      );
    }
  }
  if (state.offset !== bytes.length) {
    throw new Error(`${checkedOptions.label} contains ${bytes.length - state.offset} trailing bytes`);
  }

  return {
    width: resolution.width,
    height: resolution.height,
    data,
    sourceFormat: header.format,
    dataFormat: "rgba32float",
    colorSpace: "linear-radiance-rgb",
    orientation: resolution.orientation,
    exposure: header.exposure,
    colorCorrection: [...header.colorCorrection],
    pixelAspect: header.pixelAspect,
    gamma: header.gamma,
    primaries: [...header.primaries],
    headerLines: [...header.headerLines]
  };
}

// 復号済みRadiance標準RGBをBradford順応付きlinear sRGBへ変換します
// 色域外の負値は利用者がrejectまたはclipを明示的に選び、変換関数は選択結果を適用します
export function convertRadianceHdrToLinearSrgb(image, options = {}) {
  const source = validateRadianceHdrForEquirectangularIbl(
    image,
    "Radiance to linear sRGB source"
  );
  if (source.colorSpace !== "linear-radiance-rgb") {
    throw new Error("Radiance to linear sRGB source must not already be converted");
  }
  const checked = util.readPlainObject(options, "Radiance to linear sRGB options");
  const supported = new Set(["outOfGamut"]);
  for (const key of Object.keys(checked)) {
    if (!supported.has(key)) {
      throw new Error(`Radiance to linear sRGB options.${key} is not supported`);
    }
  }
  const outOfGamut = util.readOptionalEnum(
    checked.outOfGamut,
    "Radiance to linear sRGB options.outOfGamut",
    undefined,
    ["reject", "clip"]
  );
  if (outOfGamut === undefined) {
    throw new Error("Radiance to linear sRGB options.outOfGamut is required");
  }

  const data = new Float32Array(source.data.length);
  let clippedComponentCount = 0;
  for (let offset = 0; offset < source.data.length; offset += 4) {
    const converted = multiplyMatrix3Vector(
      RADIANCE_STANDARD_TO_LINEAR_SRGB_MATRIX,
      [source.data[offset], source.data[offset + 1], source.data[offset + 2]]
    );
    for (let channel = 0; channel < 3; channel += 1) {
      let value = converted[channel];
      if (!Number.isFinite(value) || value > FLOAT32_MAX) {
        throw new Error(
          `Radiance to linear sRGB pixel ${offset / 4} channel ${channel} is outside finite float32 range`
        );
      }
      if (value < 0.0) {
        if (outOfGamut === "reject") {
          throw new Error(
            `Radiance to linear sRGB pixel ${offset / 4} channel ${channel} is outside the target gamut: ${value}`
          );
        }
        value = 0.0;
        clippedComponentCount += 1;
      }
      data[offset + channel] = Math.fround(value);
    }
    data[offset + 3] = 1.0;
  }

  return {
    ...source,
    data,
    colorSpace: "linear-srgb",
    primaries: LINEAR_SRGB_PRIMARIES,
    sourcePrimaries: [...source.primaries],
    colorConversion: {
      method: "Bradford chromatic adaptation and RGB primary conversion",
      outOfGamut,
      clippedComponentCount,
      matrix: RADIANCE_STANDARD_TO_LINEAR_SRGB_MATRIX
    }
  };
}

// URLからbinaryを取得して同じdecoderへ渡し、HTTP失敗やcontent欠落を呼出側へ明示します
export async function loadRadianceHdr(url, options = {}) {
  const checkedUrl = util.readOptionalString(
    url,
    "Radiance HDR URL",
    undefined,
    { trim: true, allowEmpty: false }
  );
  if (checkedUrl === undefined) {
    throw new Error("Radiance HDR URL must be specified");
  }
  let response;
  try {
    response = await fetch(checkedUrl);
  } catch (error) {
    throw new Error(`Radiance HDR fetch failed for '${checkedUrl}': ${error?.message ?? error}`);
  }
  if (!response.ok) {
    throw new Error(
      `Radiance HDR fetch failed for '${checkedUrl}': HTTP ${response.status} ${response.statusText}`
    );
  }
  const buffer = await response.arrayBuffer();
  return decodeRadianceHdr(buffer, options);
}

// webgのdistant IBLへ渡す2:1緯度経度入力として色空間とpixel形状を追加検証します
export function validateRadianceHdrForEquirectangularIbl(image, label = "Radiance HDR IBL") {
  if (!image || typeof image !== "object") {
    throw new Error(`${label} image must be a decoded Radiance HDR object`);
  }
  if (image.sourceFormat !== RADIANCE_RGBE_FORMAT
      || (image.colorSpace !== "linear-radiance-rgb" && image.colorSpace !== "linear-srgb")) {
    throw new Error(`${label} requires decoded linear Radiance RGB or converted linear sRGB data`);
  }
  if (image.orientation !== STANDARD_ORIENTATION) {
    throw new Error(`${label} orientation must be ${STANDARD_ORIENTATION}`);
  }
  if (image.width !== image.height * 2) {
    throw new Error(`${label} dimensions must use a 2:1 equirectangular ratio`);
  }
  if (image.pixelAspect !== 1.0) {
    throw new Error(`${label} PIXASPECT must be 1: ${image.pixelAspect}`);
  }
  if (!(image.data instanceof Float32Array) || image.data.length !== image.width * image.height * 4) {
    throw new Error(`${label} data must be a complete RGBA Float32Array`);
  }
  const expectedPrimaries = image.colorSpace === "linear-srgb"
    ? LINEAR_SRGB_PRIMARIES
    : RADIANCE_STANDARD_PRIMARIES;
  if (!Array.isArray(image.primaries)
    || image.primaries.length !== expectedPrimaries.length
    || image.primaries.some((value, index) => value !== expectedPrimaries[index])) {
    throw new Error(`${label} primaries do not match ${image.colorSpace}`);
  }
  return image;
}

// DeferredとForwardのWGSLと同じworld-space方向から緯度経度UVへの変換をCPU評価用に提供します
export function radianceEnvironmentDirectionToUv(direction, label = "environment direction") {
  if (!Array.isArray(direction) || direction.length !== 3) {
    throw new Error(`${label} must be an exact vec3 array`);
  }
  const checked = util.readVec3(direction, label);
  const length = Math.hypot(...checked);
  if (Math.abs(length - 1.0) > NORMALIZED_DIRECTION_EPSILON) {
    throw new Error(`${label} must be normalized`);
  }
  const u = Math.atan2(checked[2], checked[0]) / (2.0 * Math.PI) + 0.5;
  const v = Math.acos(Math.min(Math.max(checked[1], -1.0), 1.0)) / Math.PI;
  return [u, v];
}
