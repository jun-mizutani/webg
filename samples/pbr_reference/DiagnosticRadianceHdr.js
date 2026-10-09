// ---------------------------------------------------------
// DiagnosticRadianceHdr.js  2026/08/03
//   Deterministic 8x4 Radiance RGBE input for direction and HDR-value checks
// ---------------------------------------------------------
import {
  decodeRadianceHdr,
  validateRadianceHdrForEquirectangularIbl
} from "../../webg/RadianceHdr.js";

const WIDTH = 8;
const HEIGHT = 4;
const FILE_EXPOSURE = 2.0;

// 線形Radiance RGBをRGBEへ量子化し、decoderとは独立した入力byte列を作ります
function encodeRgbe(linearRgb) {
  const maximum = Math.max(...linearRgb);
  if (maximum < 1.0e-32) return [0, 0, 0, 0];
  const exponent = Math.floor(Math.log2(maximum)) + 1;
  const scale = 256.0 / 2 ** exponent;
  const mantissas = linearRgb.map((value) => {
    const encoded = Math.floor(value * scale);
    if (encoded < 0 || encoded > 255) {
      throw new Error(`Diagnostic Radiance HDR mantissa is out of range: ${encoded}`);
    }
    return encoded;
  });
  const exponentByte = exponent + 128;
  if (exponentByte <= 0 || exponentByte > 255) {
    throw new Error(`Diagnostic Radiance HDR exponent is out of range: ${exponentByte}`);
  }
  return [...mantissas, exponentByte];
}

// rowとcolumnに固有色を配置し、上下反転、左右反転、U方向、HDR clipを同時に判別可能にします
function diagnosticRadianceAt(x, y) {
  if (y === 0) {
    // row 0は+Y側の青い空で、+Z寄りのcolumn 6だけ高輝度の暖色光源を置きます
    return x === 6 ? [48.0, 36.0, 18.0] : [1.0, 2.0, 12.0];
  }
  if (y === 3) {
    // 最終rowは-Y側の地面色とし、上下が入れ替わると画面から判別できます
    return [0.70, 0.25, 0.08];
  }
  const band = [
    [8.0, 0.5, 0.25],
    [6.0, 1.0, 5.0],
    [0.5, 8.0, 1.0],
    [7.0, 6.0, 0.5]
  ][Math.floor(x / 2)];
  const scale = y === 1 ? 1.0 : 0.25;
  return band.map((value) => value * scale);
}

// ASCII headerとflat RGBE scanlineを一つのUint8Arrayへ連結します
export function createDiagnosticRadianceHdrBytes() {
  const header = new TextEncoder().encode(
    "#?RADIANCE\n"
    + "SOFTWARE=webg DiagnosticRadianceHdr.js\n"
    + "FORMAT=32-bit_rle_rgbe\n"
    + `EXPOSURE=${FILE_EXPOSURE}\n`
    + "PIXASPECT=1\n"
    + "\n"
    + `-Y ${HEIGHT} +X ${WIDTH}\n`
  );
  const payload = new Uint8Array(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      // file側にはEXPOSURE適用済み値を保存し、decoderが元radianceへ除算して戻すことも検査します
      const exposed = diagnosticRadianceAt(x, y).map((value) => value * FILE_EXPOSURE);
      payload.set(encodeRgbe(exposed), (y * WIDTH + x) * 4);
    }
  }
  const bytes = new Uint8Array(header.length + payload.length);
  bytes.set(header, 0);
  bytes.set(payload, header.length);
  return bytes;
}

// 診断byte列を公開decoderで復号し、9Bへ渡す2:1環境入力条件まで確認します
export function decodeDiagnosticRadianceHdr() {
  const decoded = decodeRadianceHdr(createDiagnosticRadianceHdrBytes(), {
    label: "webg diagnostic Radiance HDR"
  });
  validateRadianceHdrForEquirectangularIbl(decoded, "webg diagnostic Radiance HDR IBL");
  let maximum = 0.0;
  for (let index = 0; index < decoded.data.length; index += 4) {
    maximum = Math.max(
      maximum,
      decoded.data[index],
      decoded.data[index + 1],
      decoded.data[index + 2]
    );
  }
  return Object.freeze({ decoded, maximum });
}
