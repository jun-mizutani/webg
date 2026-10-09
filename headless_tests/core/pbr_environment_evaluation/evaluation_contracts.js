// ---------------------------------------------------------
// evaluation_contracts.js  2026/08/04
//   White furnace, BRDF LUT edge, and environment memory contracts
// ---------------------------------------------------------
import assert from "node:assert/strict";
import {
  estimatePbrEnvironmentMemory,
  evaluatePbrIblEnergyCompensation,
  evaluatePbrWhiteFurnace,
  evaluatePbrWhiteFurnacePoint,
  samplePbrBrdfLutClamped
} from "../../../webg/PbrEnvironmentEvaluation.js";

// 4x2 LUTへ座標を識別できる値を入れ、NdotV=1が右端から左端へrepeatしないことを確認します
const edgeLut = {
  width: 4,
  height: 2,
  data: new Float32Array([
    0.1, 0.01, 0.2, 0.02, 0.3, 0.03, 0.9, 0.09,
    0.4, 0.04, 0.5, 0.05, 0.6, 0.06, 0.8, 0.08
  ])
};
const assertPairNear = (actual, expected) => {
  assert.equal(actual.length, 2);
  assert.ok(Math.abs(actual[0] - expected[0]) <= 1.0e-6);
  assert.ok(Math.abs(actual[1] - expected[1]) <= 1.0e-6);
};
assertPairNear(samplePbrBrdfLutClamped(edgeLut, 1.0, 0.04), [0.9, 0.09]);
assertPairNear(samplePbrBrdfLutClamped(edgeLut, 0.0, 1.0), [0.4, 0.04]);

// 完全反射metalのconstant LUTではunit white furnace応答も全channel 1になります
const perfectLut = {
  width: 2,
  height: 2,
  data: new Float32Array([1, 0, 1, 0, 1, 0, 1, 0])
};
const perfectMetal = evaluatePbrWhiteFurnacePoint(perfectLut, {
  metallic: 1.0,
  roughness: 0.5,
  normalDotView: 1.0
});
assert.deepEqual(perfectMetal.color, [1, 1, 1]);
assert.deepEqual(perfectMetal.energyCompensation, [1, 1, 1]);
const furnace = evaluatePbrWhiteFurnace(perfectLut);
assert.equal(furnace.passed, true);
assert.equal(furnace.maximum, 1.0);
assert.equal(furnace.sampleCount, 40);

// F0=1でsingle-scatter albedoが0.25なら補償係数4となり、F0=0.04では1.12となります
const compensation = evaluatePbrIblEnergyCompensation(
  [1.0, 0.04, 0.0],
  [0.2, 0.05]
);
assert.ok(Math.abs(compensation[0] - 4.0) <= 1.0e-12);
assert.ok(Math.abs(compensation[1] - 1.12) <= 1.0e-12);
assert.equal(compensation[2], 1.0);

// 補償を無効にしたCPU基準も残し、導入前後を同じLUTと走査条件で比較可能にします
const uncompensatedMetal = evaluatePbrWhiteFurnacePoint(perfectLut, {
  metallic: 1.0,
  roughness: 0.5,
  normalDotView: 1.0,
  multipleScattering: false
});
assert.equal(uncompensatedMetal.multipleScattering, false);
assert.deepEqual(uncompensatedMetal.energyCompensation, [1, 1, 1]);

// 診断設定のruntime/cache payloadとCompute一時textureをformatのbyte数から厳密に算出します
const memory = estimatePbrEnvironmentMemory([8, 4], {
  irradianceWidth: 8,
  irradianceHeight: 4,
  specularWidth: 16,
  specularHeight: 8,
  specularMipCount: 5,
  brdfLutWidth: 32,
  brdfLutHeight: 32,
  diffuseSampleCount: 128,
  specularSampleCount: 128,
  brdfSampleCount: 128
});
assert.equal(memory.radianceBytes, 256);
assert.equal(memory.irradianceBytes, 256);
assert.equal(memory.specularBytes, 1368);
assert.equal(memory.brdfRuntimeBytes, 4096);
assert.equal(memory.runtimeTextureBytes, 5976);
assert.equal(memory.computeSourceBytes, 512);
assert.equal(memory.brdfComputeBytes, 8192);
assert.equal(memory.computeTextureBytes, 10328);
assert.equal(memory.computeImportanceBytes, 256);
assert.equal(memory.computeWorkingBytes, 10584);

assert.throws(() => samplePbrBrdfLutClamped(edgeLut, 1.1, 0.5), /must be <= 1/);
assert.throws(() => evaluatePbrWhiteFurnacePoint(perfectLut, { roughness: 0.0 }), /must be >= 0.04/);
assert.throws(() => evaluatePbrIblEnergyCompensation([1, 1, 1], [0.1]), /exact vec2/);
assert.throws(() => estimatePbrEnvironmentMemory([8, 8], {}), /must use a 2:1/);

console.log("pbr_environment_evaluation_contracts: white furnace and memory contracts passed");
