// ---------------------------------------------------------
// headless_tests/core/tween/api_contracts.js  2026/07/28
//   Tween numeric and array interpolation contracts
// ---------------------------------------------------------
import assert from "node:assert/strict";
import Tween from "../../../webg/Tween.js";

const EPSILON = 0.0001;

// 浮動小数点の補間結果は丸め誤差を含むため、期待値との差を明示的な許容幅で比較する
function assertApprox(actual, expected, label, epsilon = EPSILON) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `${label}: expected ${expected}, actual ${actual}`
  );
}

// 配列の要素数と各成分を確認し、数値だけ合って配列構造が変わる不具合も検出する
function assertApproxArray(actual, expected, label, epsilon = EPSILON) {
  assert.ok(Array.isArray(actual), `${label}: actual value must be an array`);
  assert.equal(actual.length, expected.length, `${label}: array length`);
  for (let i = 0; i < expected.length; i++) {
    assertApprox(actual[i], expected[i], `${label}[${i}]`, epsilon);
  }
}

// 数値とcolor配列を同じTweenで補間し、開始値、easing途中値、終端値を順に確認する
const target = {
  value: 0.0,
  color: [0.0, 0.0, 0.0]
};
const tween = new Tween(target, {
  value: 10.0,
  color: [1.0, 0.5, 0.25]
}, {
  durationMs: 1000,
  easing: "outCubic"
});

assertApprox(target.value, 0.0, "Tween starts from current numeric value");
assertApproxArray(target.color, [0.0, 0.0, 0.0], "Tween starts from current color");

tween.update(500);
const easedHalf = 1.0 - Math.pow(1.0 - 0.5, 3);
assertApprox(target.value, 10.0 * easedHalf, "outCubic numeric midpoint");
assertApproxArray(
  target.color,
  [1.0 * easedHalf, 0.5 * easedHalf, 0.25 * easedHalf],
  "outCubic color midpoint"
);

tween.update(500);
assertApprox(target.value, 10.0, "Tween reaches numeric target");
assertApproxArray(target.color, [1.0, 0.5, 0.25], "Tween reaches color target");
assert.equal(tween.isFinished(), true, "Tween reports completion at duration");

console.log("tween_api_contracts: numeric and array interpolation passed");
