// ---------------------------------------------
// samples/procedural_texture/perlin_noise_2d_test.mjs  2026/08/06
//   CPU contracts for the material-independent PerlinNoise2D reference class
// ---------------------------------------------
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import PerlinNoise2D from "./PerlinNoise2D.js";

// CPUと将来のGPUで完全一致しないscalarも比較できるよう、誤差上限付きで値を検証する
function assertNear(actual, expected, tolerance, label) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: actual=${actual}, expected=${expected}, tolerance=${tolerance}`
  );
}

const noise = new PerlinNoise2D({
  seed: 2026080207,
  salt: 0x4d415242,
  numericMode: "f32-reference"
});
assert.ok(Object.isFrozen(noise), "constructor settings are immutable");
assert.throws(() => { noise.seed = 1; }, TypeError);

const knownSamples = Object.freeze([
  [0, 0, 0],
  [0.25, 0.75, -0.16588646173477173],
  [-1.25, 2.5, 0.2781500816345215],
  [7.125, -3.875, 0.133090540766716]
]);
for (const [x, y, expected] of knownSamples) {
  assert.equal(noise.sample(x, y), expected, `known sample (${x}, ${y})`);
}

assert.equal(noise.sample(-0.375, -1.625), noise.sample(-0.375, -1.625));
assert.notEqual(
  noise.sample(0.375, 1.625),
  new PerlinNoise2D({ seed: 2026080207, salt: 0x4d415243 }).sample(0.375, 1.625),
  "salt changes the lattice gradients"
);

const periodic = new PerlinNoise2D({
  seed: 123456789,
  salt: 0x5045524c,
  periodCells: [8, 6]
});
const periodicPoints = Object.freeze([
  [-1.25, -0.5],
  [0.125, 2.75],
  [7.875, 5.5]
]);
for (const [x, y] of periodicPoints) {
  assertNear(periodic.sample(x, y), periodic.sample(x + 8, y), 1e-6, "periodic x value");
  assertNear(periodic.sample(x, y), periodic.sample(x, y + 6), 1e-6, "periodic y value");
  assertNear(
    periodic.fbm(x, y, { octaves: 5, lacunarity: 2, gain: 0.5 }),
    periodic.fbm(x + 8, y, { octaves: 5, lacunarity: 2, gain: 0.5 }),
    2e-6,
    "periodic fBm"
  );
}

const derivativeStep = 1 / 1024;
// X方向の中心差分から境界近傍の傾きを求め、周期端で一階微分が連続するか確認する
function finiteDerivativeX(source, x, y) {
  return (source.sample(x + derivativeStep, y) - source.sample(x - derivativeStep, y))
    / (2 * derivativeStep);
}
// Y方向の中心差分から境界近傍の傾きを求め、周期端で一階微分が連続するか確認する
function finiteDerivativeY(source, x, y) {
  return (source.sample(x, y + derivativeStep) - source.sample(x, y - derivativeStep))
    / (2 * derivativeStep);
}
assertNear(
  finiteDerivativeX(periodic, 0, 1.375),
  finiteDerivativeX(periodic, 8, 1.375),
  2e-4,
  "periodic x boundary derivative"
);
assertNear(
  finiteDerivativeY(periodic, 2.625, 0),
  finiteDerivativeY(periodic, 2.625, 6),
  2e-4,
  "periodic y boundary derivative"
);

// 大きなperiodでは格子cacheを確保せず、座標hashへfallbackして同じ周期契約を保つ
const largePeriod = new PerlinNoise2D({
  seed: 123456789,
  salt: 0x5045524c,
  periodCells: [1048577, 1]
});
assertNear(
  largePeriod.sample(0.25, 0.5),
  largePeriod.sample(1048577.25, 0.5),
  1e-6,
  "large period hash fallback"
);

const fieldOptions = Object.freeze({
  width: 17,
  height: 11,
  domainOrigin: [-2.5, 1.25],
  domainSize: [8, 6],
  octaves: 4,
  lacunarity: 2,
  gain: 0.5
});
const field = periodic.fillFbm(fieldOptions);
const fieldFbmOptions = Object.freeze({
  octaves: fieldOptions.octaves,
  lacunarity: fieldOptions.lacunarity,
  gain: fieldOptions.gain
});
assert.ok(field instanceof Float32Array);
assert.equal(field.length, fieldOptions.width * fieldOptions.height);
for (const [column, row] of [[0, 0], [5, 3], [16, 10]]) {
  const x = Math.fround(
    fieldOptions.domainOrigin[0]
    + Math.fround((column / fieldOptions.width) * fieldOptions.domainSize[0])
  );
  const y = Math.fround(
    fieldOptions.domainOrigin[1]
    + Math.fround((row / fieldOptions.height) * fieldOptions.domainSize[1])
  );
  assert.equal(
    field[row * fieldOptions.width + column],
    periodic.fbm(x, y, fieldFbmOptions),
    `row-major field sample (${column}, ${row})`
  );
}
assert.deepEqual(periodic.fillFbm(fieldOptions), field, "field generation is deterministic");

let sum = 0;
let sumSquared = 0;
let count = 0;
for (let y = -8; y < 8; y += 0.25) {
  for (let x = -8; x < 8; x += 0.25) {
    const value = noise.sample(x + 0.03125, y + 0.09375);
    assert.ok(value >= -Math.SQRT2 && value <= Math.SQRT2, "sample theoretical range");
    sum += value;
    sumSquared += value * value;
    count += 1;
  }
}
const mean = sum / count;
const variance = sumSquared / count - mean * mean;
assert.ok(Math.abs(mean) < 0.04, `sample mean is near zero: ${mean}`);
assert.ok(variance > 0.02, `sample has useful variance: ${variance}`);

const turbulence = noise.turbulence(1.25, -2.75, { octaves: 5, lacunarity: 2, gain: 0.5 });
const ridged = noise.ridgedFbm(1.25, -2.75, { octaves: 5, lacunarity: 2, gain: 0.5 });
assert.ok(turbulence >= 0 && turbulence <= Math.SQRT2);
assertNear(ridged, 1 - turbulence, 2e-6, "ridged and turbulence relation");

assert.throws(() => new PerlinNoise2D({ unknown: true }), /unknown option/);
assert.throws(() => new PerlinNoise2D({ seed: -1 }), /seed must be >= 0/);
assert.throws(() => new PerlinNoise2D({ periodCells: [0, 4] }), /periodCells\[0\]/);
assert.throws(() => new PerlinNoise2D({ numericMode: "float64" }), /numericMode/);
assert.throws(() => noise.sample(Number.NaN, 0), /x must be a finite number/);
assert.throws(
  () => periodic.fbm(0, 0, { octaves: 3, lacunarity: 1.5, gain: 0.5 }),
  /lacunarity must be an integer/
);
assert.throws(() => periodic.fillFbm({ width: 0, height: 1 }), /width must be >= 1/);

const benchmarkOptions = {
  width: 244,
  height: 244,
  domainOrigin: [0, 0],
  domainSize: [8, 8],
  octaves: 5,
  lacunarity: 2,
  gain: 0.5
};
const start = performance.now();
const benchmarkField = periodic.fillFbm(benchmarkOptions);
const elapsed = performance.now() - start;
assert.equal(benchmarkField.length, 244 * 244);

console.log(
  `PerlinNoise2D CPU PASS: known=${knownSamples.length}, mean=${mean.toFixed(6)}, `
  + `variance=${variance.toFixed(6)}, 244x244x5=${elapsed.toFixed(1)}ms`
);
