// ---------------------------------------------------------
// pbr_reference_test.mjs  2026/08/05
//   Application-specific HDR input and PBR reference wiring contracts
// ---------------------------------------------------------
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { decodeDiagnosticRadianceHdr } from "./DiagnosticRadianceHdr.js";
import { createPbrEnvironmentReferenceData } from "../../webg/PbrEnvironmentReference.js";
import { convertRadianceHdrToLinearSrgb } from "../../webg/RadianceHdr.js";

const mainSource = await readFile(new URL("./main.js", import.meta.url), "utf8");

// 9Aの診断HDRは2:1、標準方向、1を超えるradianceを持つHDR入力として保持します
{
  const { decoded, maximum } = decodeDiagnosticRadianceHdr();
  assert.equal(decoded.width, 8);
  assert.equal(decoded.height, 4);
  assert.equal(decoded.orientation, "-Y +X");
  assert.equal(decoded.exposure, 2.0);
  assert.ok(maximum > 40.0, `diagnostic HDR maximum must remain HDR: ${maximum}`);
  const topBlue = decoded.data.subarray(0, 3);
  const bottomWarm = decoded.data.subarray((decoded.width * 3) * 4, (decoded.width * 3) * 4 + 3);
  assert.ok(topBlue[2] > topBlue[0]);
  assert.ok(bottomWarm[0] > bottomWarm[2]);

  // decoded sourceを実際のIBL resourceへCPU積分し、上半球と下半球の色傾向を維持します
  const converted = convertRadianceHdrToLinearSrgb(decoded, { outOfGamut: "clip" });
  assert.equal(converted.colorSpace, "linear-srgb");
  const reference = createPbrEnvironmentReferenceData(converted, {
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
  const averageIrradianceRow = (row) => {
    const sum = [0.0, 0.0, 0.0];
    for (let x = 0; x < reference.irradiance.width; x += 1) {
      const offset = (row * reference.irradiance.width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        sum[channel] += reference.irradiance.data[offset + channel];
      }
    }
    return sum.map((value) => value / reference.irradiance.width);
  };
  const topIrradiance = averageIrradianceRow(0);
  const bottomIrradiance = averageIrradianceRow(reference.irradiance.height - 1);
  // Radianceからlinear sRGBへの変換後も上半球は青が緑より強く、下半球は赤が青より強い方向差を維持します
  assert.ok(topIrradiance[2] > topIrradiance[1]);
  assert.ok(bottomIrradiance[0] > bottomIrradiance[2]);
  assert.deepEqual(
    reference.prefilteredSpecular.map((level) => [level.width, level.height]),
    [[8, 4], [4, 2], [2, 1], [1, 1]]
  );
}

// IBLのみのForward比較ではdrawごとの材質処理後にも直接光が0である必要があります
// 一時uniformは省略材質の既定radianceで上書きされるためshader既定値を更新します
assert.match(
  mainSource,
  /setDefaultParam\(\s*"radiance",\s*directLightEnabled/,
  "IBL-only Forward comparison must set the default radiance used by every material draw"
);
assert.doesNotMatch(
  mainSource,
  /app\.shader\.setRadiance\(directLightEnabled/,
  "frame-local radiance is overwritten by per-material defaults"
);

// 実写HDRはsource IDとstandard生成条件を検証して永続cacheから読み込みます
assert.match(mainSource, /loadPbrEnvironmentCache\(REAL_HDR_CACHE_URL/);
assert.match(mainSource, /expectedSourceId:\s*REAL_HDR_CACHE_SOURCE_ID/);
assert.match(mainSource, /expectedSettings:\s*REAL_HDR_PREPROCESS_OPTIONS/);
assert.match(mainSource, /ENVIRONMENT_MODES\s*=\s*Object\.freeze\(\["procedural", "diagnostic", "real"\]\)/);

console.log("pbr_reference_test: HDR input and application wiring contracts passed");
