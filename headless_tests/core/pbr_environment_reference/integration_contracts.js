// ---------------------------------------------------------
// integration_contracts.js  2026/08/04
//   CPU reference irradiance, specular prefilter, and BRDF LUT contracts
// ---------------------------------------------------------
import assert from "node:assert/strict";
import {
  createPbrEnvironmentReferenceData,
  createPbrEnvironmentImportanceDistribution,
  pbrEnvironmentDirectionFromUv,
  pbrHammersley,
  samplePbrEquirectangularBilinear
} from "../../../webg/PbrEnvironmentReference.js";
import {
  LINEAR_SRGB_PRIMARIES,
  RADIANCE_STANDARD_PRIMARIES
} from "../../../webg/RadianceHdr.js";

// 色変換後と同じlinear sRGB metadataを持つ2:1 sourceを作り、積分だけを独立して評価します
function makeSource(width, height, evaluate) {
  const data = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const color = evaluate(x, y);
      data.set([color[0], color[1], color[2], 1.0], (y * width + x) * 4);
    }
  }
  return {
    width,
    height,
    data,
    sourceFormat: "32-bit_rle_rgbe",
    colorSpace: "linear-srgb",
    orientation: "-Y +X",
    pixelAspect: 1.0,
    primaries: [...LINEAR_SRGB_PRIMARIES]
  };
}

// Radiance decoder直後のRGBを渡した場合は、輝度係数の黙示的な取り違えを防ぐため明示変換を要求します
{
  const source = makeSource(8, 4, () => [1.0, 1.0, 1.0]);
  source.colorSpace = "linear-radiance-rgb";
  source.primaries = [...RADIANCE_STANDARD_PRIMARIES];
  assert.throws(
    () => createPbrEnvironmentImportanceDistribution(source),
    /explicit conversion to linear-srgb/
  );
}

// linear sRGBの三原色はY係数0.2126、0.7152、0.0722の比率でimportance massへ反映します
{
  const source = makeSource(6, 3, (x) => (
    x % 3 === 0 ? [1.0, 0.0, 0.0] : x % 3 === 1 ? [0.0, 1.0, 0.0] : [0.0, 0.0, 1.0]
  ));
  const distribution = createPbrEnvironmentImportanceDistribution(source);
  const red = distribution.pdfSolidAngle[0];
  const green = distribution.pdfSolidAngle[1];
  const blue = distribution.pdfSolidAngle[2];
  assert.ok(Math.abs(green / red - 0.7152 / 0.2126) <= 1.0e-6);
  assert.ok(Math.abs(blue / red - 0.0722 / 0.2126) <= 1.0e-6);
}

// 一定環境のimportance PDFは球面全体で1／4πとなり、緯度経度pixel面積差を相殺します
{
  const source = makeSource(8, 4, () => [2.0, 2.0, 2.0]);
  const distribution = createPbrEnvironmentImportanceDistribution(source);
  const expected = 1.0 / (4.0 * Math.PI);
  for (const value of distribution.pdfSolidAngle) {
    assert.ok(Math.abs(value - expected) <= 1.0e-7, `constant environment PDF ${value}`);
  }
  assert.equal(distribution.zeroRadiance, false);
}

const smallOptions = Object.freeze({
  irradianceWidth: 4,
  irradianceHeight: 2,
  specularWidth: 8,
  specularHeight: 4,
  specularMipCount: 4,
  brdfLutWidth: 8,
  brdfLutHeight: 8,
  diffuseSampleCount: 64,
  specularSampleCount: 64,
  brdfSampleCount: 64
});

// typed array全要素を比較し、失敗時はindexと実値を表示します
function assertArrayClose(actual, expected, epsilon, label) {
  assert.equal(actual.length, expected.length, `${label} length`);
  for (let index = 0; index < actual.length; index += 1) {
    assert.ok(
      Math.abs(actual[index] - expected[index]) <= epsilon,
      `${label}[${index}] expected ${expected[index]}, actual ${actual[index]}`
    );
  }
}

// 全黒環境は積分値0を保つ明示的な一様球面分布となり、0除算や別環境へ置換しません
{
  const source = makeSource(8, 4, () => [0.0, 0.0, 0.0]);
  const distribution = createPbrEnvironmentImportanceDistribution(source);
  assert.equal(distribution.zeroRadiance, true);
  const result = createPbrEnvironmentReferenceData(source, smallOptions);
  for (let offset = 0; offset < result.irradiance.data.length; offset += 4) {
    assertArrayClose(
      result.irradiance.data.subarray(offset, offset + 3),
      [0, 0, 0],
      0.0,
      "black irradiance"
    );
  }
}

// UVから方向への変換はshader規則の逆変換となり、上端と水平4方向を固定します
{
  assertArrayClose(pbrEnvironmentDirectionFromUv(0.5, 0.0), [0, 1, 0], 1.0e-12, "+Y");
  assertArrayClose(pbrEnvironmentDirectionFromUv(0.5, 0.5), [1, 0, 0], 1.0e-12, "+X");
  assertArrayClose(pbrEnvironmentDirectionFromUv(0.75, 0.5), [0, 0, 1], 1.0e-12, "+Z");
  assertArrayClose(pbrEnvironmentDirectionFromUv(0.25, 0.5), [0, 0, -1], 1.0e-12, "-Z");
}

// Hammersley列は決定的で、最初の4 sampleを将来のCompute Shader比較値として固定します
{
  assert.deepEqual(pbrHammersley(0, 4), [0.0, 0.0]);
  assert.deepEqual(pbrHammersley(1, 4), [0.25, 0.5]);
  assert.deepEqual(pbrHammersley(2, 4), [0.5, 0.25]);
  assert.deepEqual(pbrHammersley(3, 4), [0.75, 0.75]);
}

// Uの継ぎ目はrepeat、V端はclampとなり、反対側のpixel中心を誤って混ぜません
{
  const source = makeSource(4, 2, (x, y) => [x, y, 0]);
  assertArrayClose(samplePbrEquirectangularBilinear(source, 0.125, 0.25), [0, 0, 0], 1.0e-12, "center");
  assertArrayClose(samplePbrEquirectangularBilinear(source, 1.125, 0.25), [0, 0, 0], 1.0e-12, "U repeat");
  assertArrayClose(samplePbrEquirectangularBilinear(source, 0.0, 0.25), [1.5, 0, 0], 1.0e-12, "U seam");
  assertArrayClose(samplePbrEquirectangularBilinear(source, 0.125, 0.0), [0, 0, 0], 1.0e-12, "V top clamp");
}

// 一定radianceではdiffuse irradianceがπ倍となり、全roughnessのspecularは一定値を維持します
{
  const constant = [2.0, 3.0, 4.0];
  const source = makeSource(8, 4, () => constant);
  const result = createPbrEnvironmentReferenceData(source, smallOptions);
  for (let offset = 0; offset < result.irradiance.data.length; offset += 4) {
    assertArrayClose(
      result.irradiance.data.subarray(offset, offset + 3),
      constant.map((value) => value * Math.PI),
      2.0e-6,
      `constant irradiance pixel ${offset / 4}`
    );
    assert.equal(result.irradiance.data[offset + 3], 1.0);
  }
  assert.deepEqual(
    result.prefilteredSpecular.map((level) => [level.width, level.height]),
    [[8, 4], [4, 2], [2, 1], [1, 1]]
  );
  for (const [levelIndex, level] of result.prefilteredSpecular.entries()) {
    for (let offset = 0; offset < level.data.length; offset += 4) {
      assertArrayClose(
        level.data.subarray(offset, offset + 3),
        constant,
        1.0e-6,
        `constant specular level ${levelIndex} pixel ${offset / 4}`
      );
      assert.equal(level.data[offset + 3], 1.0);
    }
  }
  for (const value of result.brdfLut.data) {
    assert.ok(Number.isFinite(value) && value >= 0.0 && value <= 1.0, `BRDF LUT value ${value}`);
  }
}

// 上が青、下が暖色のsourceでは、上下半球のdiffuse irradianceも同じ色傾向を保持します
{
  const source = makeSource(8, 4, (_x, y) => y < 2 ? [1.0, 2.0, 8.0] : [6.0, 1.0, 0.25]);
  const first = createPbrEnvironmentReferenceData(source, smallOptions);
  const second = createPbrEnvironmentReferenceData(source, smallOptions);
  const top = first.irradiance.data.subarray(0, 3);
  const bottomOffset = first.irradiance.width * (first.irradiance.height - 1) * 4;
  const bottom = first.irradiance.data.subarray(bottomOffset, bottomOffset + 3);
  assert.ok(top[2] > top[0], `top irradiance must remain blue: ${[...top]}`);
  assert.ok(bottom[0] > bottom[2], `bottom irradiance must remain warm: ${[...bottom]}`);
  assert.deepEqual(first.irradiance.data, second.irradiance.data);
  for (let level = 0; level < first.prefilteredSpecular.length; level += 1) {
    assert.deepEqual(first.prefilteredSpecular[level].data, second.prefilteredSpecular[level].data);
  }
  assert.deepEqual(first.brdfLut.data, second.brdfLut.data);
}

// 小さい高輝度pixelを含む環境でも低sample MISが高sample基準へ収束し、まだらの原因を固定します
{
  const source = makeSource(16, 8, (x, y) => (
    x === 11 && y === 2 ? [600.0, 500.0, 400.0] : [0.5, 0.6, 0.7]
  ));
  const low = createPbrEnvironmentReferenceData(source, {
    ...smallOptions,
    diffuseSampleCount: 256,
    specularSampleCount: 256,
    brdfSampleCount: 256
  });
  const high = createPbrEnvironmentReferenceData(source, {
    ...smallOptions,
    diffuseSampleCount: 2048,
    specularSampleCount: 2048,
    brdfSampleCount: 2048
  });
  let maximumDiffuseDifference = 0.0;
  for (let offset = 0; offset < low.irradiance.data.length; offset += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      maximumDiffuseDifference = Math.max(
        maximumDiffuseDifference,
        Math.abs(low.irradiance.data[offset + channel] - high.irradiance.data[offset + channel])
      );
    }
  }
  assert.ok(
    maximumDiffuseDifference < 2.0,
    `bright-pixel diffuse MIS maximum difference ${maximumDiffuseDifference}`
  );
}

// 不正sourceと矛盾optionを自動補正せず、積分開始前に例外として報告します
{
  const source = makeSource(8, 4, () => [1, 1, 1]);
  assert.throws(
    () => createPbrEnvironmentReferenceData(source, { ...smallOptions, unknown: true }),
    /options\.unknown is not supported/
  );
  assert.throws(
    () => createPbrEnvironmentReferenceData(source, { ...smallOptions, irradianceWidth: 3 }),
    /irradiance output must use a 2:1/
  );
  assert.throws(
    () => createPbrEnvironmentReferenceData(source, {
      ...smallOptions,
      specularWidth: 2,
      specularHeight: 1,
      specularMipCount: 4
    }),
    /repeated 1x1 levels/
  );
  const negative = makeSource(8, 4, () => [1, 1, 1]);
  negative.data[0] = -0.1;
  assert.throws(
    () => createPbrEnvironmentReferenceData(negative, smallOptions),
    /source\.data\[0\] must be >= 0/
  );
}

console.log("pbr_environment_reference_contracts: CPU IBL reference values passed");
