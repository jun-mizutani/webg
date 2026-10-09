// ---------------------------------------------------------
// decode_contracts.js  2026/08/04
//   Radiance RGBE input, metadata, RLE, and orientation contracts
// ---------------------------------------------------------
import assert from "node:assert/strict";
import {
  convertRadianceHdrToLinearSrgb,
  decodeRadianceHdr,
  LINEAR_SRGB_PRIMARIES,
  loadRadianceHdr,
  radianceEnvironmentDirectionToUv,
  RADIANCE_STANDARD_TO_LINEAR_SRGB_MATRIX,
  RADIANCE_STANDARD_PRIMARIES,
  validateRadianceHdrForEquirectangularIbl
} from "../../../webg/RadianceHdr.js";

const encoder = new TextEncoder();

// ASCII headerとbinary RGBE payloadを結合し、実fileと同じbyte境界をtest内で構築します
function concatBytes(...parts) {
  const normalized = parts.map((part) => typeof part === "string" ? encoder.encode(part) : part);
  const length = normalized.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of normalized) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

// 標準headerへ指定resolutionとpayloadを追加し、flat、旧RLE、新RLEの入力を共通化します
function makeHdr(payload, {
  width,
  height,
  header = "",
  orientation = null,
  format = "32-bit_rle_rgbe"
}) {
  const resolution = orientation ?? `-Y ${height} +X ${width}`;
  const metadata = header.length > 0 ? `${header}\n` : "";
  return concatBytes(
    `#?RADIANCE\nFORMAT=${format}\n${metadata}\n${resolution}\n`,
    payload
  );
}

// channelごとの絶対誤差を確認し、RGBE量子化による既知の差だけを許します
function assertClose(actual, expected, epsilon, label) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${label}: expected ${expected}, actual ${actual}`);
}

// Radiance公式例のRGBE pixelをflat scanlineから読み、+0.5 mantissa規則を固定します
{
  const decoded = decodeRadianceHdr(makeHdr(
    new Uint8Array([128, 64, 32, 129]),
    { width: 1, height: 1 }
  ));
  assert.equal(decoded.width, 1);
  assert.equal(decoded.height, 1);
  assert.equal(decoded.sourceFormat, "32-bit_rle_rgbe");
  assert.equal(decoded.colorSpace, "linear-radiance-rgb");
  assert.equal(decoded.orientation, "-Y +X");
  assertClose(decoded.data[0], 128.5 / 128.0, 1.0e-7, "official example R");
  assertClose(decoded.data[1], 64.5 / 128.0, 1.0e-7, "official example G");
  assertClose(decoded.data[2], 32.5 / 128.0, 1.0e-7, "official example B");
  assert.equal(decoded.data[3], 1.0);
}

// EXPOSUREとCOLORCORRは累積し、fileへ適用済みの倍率でpixel値を除算して元radianceへ戻します
{
  const decoded = decodeRadianceHdr(makeHdr(
    new Uint8Array([128, 64, 32, 129]),
    {
      width: 1,
      height: 1,
      header: "EXPOSURE=2\nEXPOSURE=0.5\nCOLORCORR=2 1 0.5\nCOLORCORR=0.5 2 1"
    }
  ));
  assert.equal(decoded.exposure, 1.0);
  assert.deepEqual(decoded.colorCorrection, [1.0, 2.0, 0.5]);
  assertClose(decoded.data[0], 128.5 / 128.0, 1.0e-7, "corrected R");
  assertClose(decoded.data[1], (64.5 / 128.0) / 2.0, 1.0e-7, "corrected G");
  assertClose(decoded.data[2], (32.5 / 128.0) / 0.5, 1.0e-7, "corrected B");
}

// 新RLEは4 channelを個別に復号し、literalとrunを同じ8 pixelへinterleaveします
{
  const payload = new Uint8Array([
    2, 2, 0, 8,
    8, 10, 20, 30, 40, 50, 60, 70, 80,
    136, 64,
    8, 80, 70, 60, 50, 40, 30, 20, 10,
    136, 129
  ]);
  const decoded = decodeRadianceHdr(makeHdr(payload, { width: 8, height: 1 }));
  assertClose(decoded.data[0], 10.5 / 128.0, 1.0e-7, "new RLE first R");
  assertClose(decoded.data[1], 64.5 / 128.0, 1.0e-7, "new RLE first G");
  assertClose(decoded.data[2], 80.5 / 128.0, 1.0e-7, "new RLE first B");
  assertClose(decoded.data[28], 80.5 / 128.0, 1.0e-7, "new RLE last R");
  assertClose(decoded.data[30], 10.5 / 128.0, 1.0e-7, "new RLE last B");
}

// Radiance公式writerが生成するpacket code 128は、128 byteの非run literalとして復号します
{
  const payload = [2, 2, 0, 128];
  for (let channel = 0; channel < 4; channel += 1) {
    payload.push(128);
    for (let x = 0; x < 128; x += 1) {
      payload.push(channel === 3 ? 129 : (x + channel * 17) & 0xff);
    }
  }
  const decoded = decodeRadianceHdr(makeHdr(
    new Uint8Array(payload),
    { width: 128, height: 1 }
  ));
  assertClose(decoded.data[0], 0.5 / 128.0, 1.0e-7, "128 literal first R");
  assertClose(decoded.data[127 * 4], 127.5 / 128.0, 1.0e-7, "128 literal last R");
}

// 旧RLE markerは直前pixelを指定数だけ繰り返し、flat readerと誤って4 pixel扱いしません
{
  const decoded = decodeRadianceHdr(makeHdr(
    new Uint8Array([128, 64, 32, 129, 1, 1, 1, 3]),
    { width: 4, height: 1 }
  ));
  for (let pixel = 1; pixel < 4; pixel += 1) {
    assert.deepEqual(
      [...decoded.data.subarray(pixel * 4, pixel * 4 + 4)],
      [...decoded.data.subarray(0, 4)]
    );
  }
}

// 8x4の標準Radiance RGB入力だけが現段階のdistant equirectangular IBL境界を通過します
{
  const pixel = [64, 96, 128, 132];
  const payload = new Uint8Array(8 * 4 * 4);
  for (let offset = 0; offset < payload.length; offset += 4) payload.set(pixel, offset);
  const decoded = decodeRadianceHdr(makeHdr(payload, { width: 8, height: 4 }));
  assert.equal(validateRadianceHdrForEquirectangularIbl(decoded), decoded);
  assert.deepEqual(decoded.primaries, RADIANCE_STANDARD_PRIMARIES);
  assert.throws(
    () => validateRadianceHdrForEquirectangularIbl({ ...decoded, width: 7 }),
    /2:1 equirectangular ratio/
  );
  assert.throws(
    () => validateRadianceHdrForEquirectangularIbl({ ...decoded, pixelAspect: 1.2 }),
    /PIXASPECT must be 1/
  );
  assert.throws(
    () => validateRadianceHdrForEquirectangularIbl({
      ...decoded,
      primaries: [0.63, ...decoded.primaries.slice(1)]
    }),
    /primaries do not match linear-radiance-rgb/
  );
}

// Radiance equal-energy whiteはBradford順応後のlinear sRGBでもneutral [1,1,1]を維持します
{
  const width = 2;
  const height = 1;
  const decoded = {
    width,
    height,
    data: new Float32Array([1, 1, 1, 1, 1, 1, 1, 1]),
    sourceFormat: "32-bit_rle_rgbe",
    dataFormat: "rgba32float",
    colorSpace: "linear-radiance-rgb",
    orientation: "-Y +X",
    exposure: 1.0,
    colorCorrection: [1, 1, 1],
    pixelAspect: 1.0,
    gamma: 1.0,
    primaries: [...RADIANCE_STANDARD_PRIMARIES],
    headerLines: []
  };
  const converted = convertRadianceHdrToLinearSrgb(decoded, { outOfGamut: "reject" });
  assert.equal(converted.colorSpace, "linear-srgb");
  assert.deepEqual(converted.primaries, LINEAR_SRGB_PRIMARIES);
  assert.deepEqual(converted.sourcePrimaries, RADIANCE_STANDARD_PRIMARIES);
  assert.equal(converted.colorConversion.clippedComponentCount, 0);
  for (const index of [0, 1, 2, 4, 5, 6]) {
    assertClose(converted.data[index], 1.0, 2.0e-6, `converted neutral[${index}]`);
  }
  assert.equal(RADIANCE_STANDARD_TO_LINEAR_SRGB_MATRIX.length, 9);
  assert.equal(validateRadianceHdrForEquirectangularIbl(converted), converted);
}

// target gamut外の負値はrejectとclipを呼出側が明示し、暗黙の黒clipを行いません
{
  const decoded = {
    width: 2,
    height: 1,
    data: new Float32Array([0, 1, 0, 1, 0, 1, 0, 1]),
    sourceFormat: "32-bit_rle_rgbe",
    dataFormat: "rgba32float",
    colorSpace: "linear-radiance-rgb",
    orientation: "-Y +X",
    exposure: 1.0,
    colorCorrection: [1, 1, 1],
    pixelAspect: 1.0,
    gamma: 1.0,
    primaries: [...RADIANCE_STANDARD_PRIMARIES],
    headerLines: []
  };
  assert.throws(
    () => convertRadianceHdrToLinearSrgb(decoded, { outOfGamut: "reject" }),
    /outside the target gamut/
  );
  const clipped = convertRadianceHdrToLinearSrgb(decoded, { outOfGamut: "clip" });
  assert.ok(clipped.colorConversion.clippedComponentCount > 0);
  assert.ok([...clipped.data].every((value) => value >= 0.0));
  assert.throws(
    () => convertRadianceHdrToLinearSrgb(decoded),
    /outOfGamut is required/
  );
}

// WGSLと同じ方向規則を固定し、row 0が+Y、U中央が+Xになる基準を9Bへ渡します
{
  assert.deepEqual(radianceEnvironmentDirectionToUv([1, 0, 0]), [0.5, 0.5]);
  assert.deepEqual(radianceEnvironmentDirectionToUv([0, 1, 0]), [0.5, 0.0]);
  assert.deepEqual(radianceEnvironmentDirectionToUv([0, -1, 0]), [0.5, 1.0]);
  assert.deepEqual(radianceEnvironmentDirectionToUv([0, 0, 1]), [0.75, 0.5]);
  assert.deepEqual(radianceEnvironmentDirectionToUv([0, 0, -1]), [0.25, 0.5]);
  assert.throws(() => radianceEnvironmentDirectionToUv([2, 0, 0]), /must be normalized/);
}

// data URL経由でもfetchとArrayBufferの同じ処理を通り、file専用の別decoderを作りません
{
  const bytes = makeHdr(new Uint8Array([128, 64, 32, 129]), { width: 1, height: 1 });
  const url = `data:application/octet-stream;base64,${Buffer.from(bytes).toString("base64")}`;
  const decoded = await loadRadianceHdr(url, { label: "data URL HDR" });
  assert.equal(decoded.width, 1);
}

// 形式、向き、metadata、RLE、payloadの不整合を推測や既定画像で補いません
{
  const pixel = new Uint8Array([128, 64, 32, 129]);
  assert.throws(() => decodeRadianceHdr(encoder.encode("NOT-RADIANCE\n")), /magic must be/);
  assert.throws(
    () => decodeRadianceHdr(concatBytes("#?RADIANCE\n\n-Y 1 +X 1\n", pixel)),
    /requires FORMAT=32-bit_rle_rgbe/
  );
  assert.throws(
    () => decodeRadianceHdr(makeHdr(pixel, { width: 1, height: 1, format: "32-bit_rle_xyze" })),
    /FORMAT must be 32-bit_rle_rgbe/
  );
  assert.throws(
    () => decodeRadianceHdr(makeHdr(pixel, { width: 1, height: 1, orientation: "+Y 1 +X 1" })),
    /resolution must use standard -Y height \+X width orientation/
  );
  assert.throws(
    () => decodeRadianceHdr(makeHdr(pixel, { width: 1, height: 1, header: "EXPOSURE=0" })),
    /EXPOSURE must be > 0/
  );
  assert.throws(
    () => decodeRadianceHdr(makeHdr(pixel, { width: 1, height: 1, header: "GAMMA=2.2" })),
    /GAMMA must be 1 for linear RGB input/
  );
  assert.throws(
    () => decodeRadianceHdr(makeHdr(pixel, { width: 1, height: 1 }), { maxPixels: 0 }),
    /maxPixels must be >= 1/
  );
  assert.throws(
    () => decodeRadianceHdr(concatBytes(makeHdr(pixel, { width: 1, height: 1 }), new Uint8Array([0]))),
    /contains 1 trailing bytes/
  );
  assert.throws(
    () => decodeRadianceHdr(makeHdr(new Uint8Array([2, 2, 0, 8, 0]), { width: 8, height: 1 })),
    /packet count must not be 0/
  );
  assert.throws(
    () => decodeRadianceHdr(makeHdr(new Uint8Array([2, 2, 0, 8, 128]), { width: 8, height: 1 })),
    /literal exceeds the scanline width/
  );
  assert.throws(
    () => decodeRadianceHdr(pixel, { unknown: true }),
    /options\.unknown is not supported/
  );
}

console.log("radiance_hdr_decode_contracts: RGBE, metadata, RLE, and direction contracts passed");
