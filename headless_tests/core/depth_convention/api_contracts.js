// ---------------------------------------------------------
// headless_tests/core/depth_convention/headless_probe.js  2026/07/12
//   Numeric contracts for camera and shadow depth conventions
// ---------------------------------------------------------
import assert from "node:assert/strict";
import {
  CAMERA_REVERSE_Z,
  SHADOW_STANDARD_Z,
  isBackgroundDepth,
  linearizeDepth,
  projectViewDepth,
  readDepthRange,
  requireDepthConvention
} from "../../../webg/DepthConvention.js";

// 浮動小数点演算の実測値と期待値を、値の大きさに応じた相対誤差で比較します
// assertion messageには両方の値を残し、行列や深度式のどちらがずれたか追跡できるようにします
function assertAlmostEqual(actual, expected, relativeTolerance, label) {
  const scale = Math.max(1.0, Math.abs(actual), Math.abs(expected));
  const difference = Math.abs(actual - expected);
  assert.ok(
    difference <= relativeTolerance * scale,
    `${label}: actual=${actual} expected=${expected} difference=${difference}`
  );
}

// 通常カメラとShadow Mapは同じdepth32floatでも、near/far、clear、compareの意味が異なります
// 二つを別objectとして固定し、field単位の書き換えやcloneによる独自規則を拒否することを確認します
{
  assert.equal(CAMERA_REVERSE_Z.format, "depth32float");
  assert.equal(CAMERA_REVERSE_Z.nearDepth, 1.0);
  assert.equal(CAMERA_REVERSE_Z.farDepth, 0.0);
  assert.equal(CAMERA_REVERSE_Z.clearValue, 0.0);
  assert.equal(CAMERA_REVERSE_Z.compare, "greater");
  assert.equal(CAMERA_REVERSE_Z.compareEqual, "greater-equal");
  assert.equal(CAMERA_REVERSE_Z.reversed, true);

  assert.equal(SHADOW_STANDARD_Z.format, "depth32float");
  assert.equal(SHADOW_STANDARD_Z.nearDepth, 0.0);
  assert.equal(SHADOW_STANDARD_Z.farDepth, 1.0);
  assert.equal(SHADOW_STANDARD_Z.clearValue, 1.0);
  assert.equal(SHADOW_STANDARD_Z.compare, "less");
  assert.equal(SHADOW_STANDARD_Z.compareEqual, "less-equal");
  assert.equal(SHADOW_STANDARD_Z.reversed, false);

  assert.equal(Object.isFrozen(CAMERA_REVERSE_Z), true);
  assert.equal(Object.isFrozen(SHADOW_STANDARD_Z), true);
  assert.equal(requireDepthConvention(CAMERA_REVERSE_Z), CAMERA_REVERSE_Z);
  assert.throws(
    () => requireDepthConvention({ ...CAMERA_REVERSE_Z }),
    /must be CAMERA_REVERSE_Z or SHADOW_STANDARD_Z/
  );
}

// near/farの不整合を無限遠や既定値へ補正せず、数値入力の誤りとして検出します
// Infinityは呼び出し側がallowInfiniteFarを明示した通常カメラ用途だけで受け入れます
{
  assert.deepEqual(
    readDepthRange(0.1, 1000.0, "finite range"),
    { near: 0.1, far: 1000.0, infiniteFar: false }
  );
  assert.deepEqual(
    readDepthRange(0.1, Infinity, "infinite range", { allowInfiniteFar: true }),
    { near: 0.1, far: Infinity, infiniteFar: true }
  );
  assert.throws(() => readDepthRange(0.0, 100.0), /near must be > 0/);
  assert.throws(() => readDepthRange(1.0, 1.0), /far must be > 1/);
  assert.throws(() => readDepthRange(1.0, Infinity), /far must be finite/);
}

// finite farのReverse-Zではnearが1、farが0になり、距離が増えるほどdepthが単調減少します
// 複数の中間距離を往復させ、projectとlinearizeが同じ端点だけを偶然通す実装を防ぎます
{
  const near = 0.125;
  const far = 1000000.0;
  const distances = [near, 0.25, 1.0, 10.0, 1000.0, far * 0.5, far];
  let previousDepth = Infinity;
  for (const distance of distances) {
    const depth = projectViewDepth(distance, near, far, CAMERA_REVERSE_Z);
    assert.ok(
      depth < previousDepth,
      `Reverse-Z must decrease with distance: distance=${distance} depth=${depth}`
    );
    previousDepth = depth;
    if (distance === far) {
      assert.equal(depth, 0.0);
      continue;
    }
    const restored = linearizeDepth(depth, near, far, CAMERA_REVERSE_Z);
    assertAlmostEqual(restored, distance, 1.0e-11, `finite Reverse-Z ${distance}`);
  }
  assert.equal(projectViewDepth(near, near, far, CAMERA_REVERSE_Z), 1.0);
  assert.equal(isBackgroundDepth(0.0, CAMERA_REVERSE_Z), true);
  assert.equal(isBackgroundDepth(Number.MIN_VALUE, CAMERA_REVERSE_Z), false);
  assert.throws(
    () => linearizeDepth(0.0, near, far, CAMERA_REVERSE_Z),
    /cannot linearize the background depth/
  );
}

// infinite farのReverse-Zはnear/depthで距離を復元します
// 非常に遠い距離でも0ではないdepthを保持し、clearされた背景0と区別できることを確認します
{
  const near = 0.5;
  const distances = [near, 1.0, 100.0, 1.0e6, 1.0e12];
  for (const distance of distances) {
    const depth = projectViewDepth(distance, near, Infinity, CAMERA_REVERSE_Z);
    assert.ok(depth > 0.0, `infinite Reverse-Z depth must be positive: ${depth}`);
    const restored = linearizeDepth(depth, near, Infinity, CAMERA_REVERSE_Z);
    assertAlmostEqual(restored, distance, 1.0e-12, `infinite Reverse-Z ${distance}`);
  }
}

// Shadow Mapは第一実装期では通常Zを維持します
// near=0、far=1と中間距離の往復を固定し、camera Reverse-Zの式が混入した場合に検出します
{
  const near = 1.0;
  const far = 250.0;
  const distances = [near, 2.0, 25.0, 125.0, far];
  let previousDepth = -Infinity;
  for (const distance of distances) {
    const depth = projectViewDepth(distance, near, far, SHADOW_STANDARD_Z);
    assert.ok(
      depth > previousDepth,
      `standard-Z must increase with distance: distance=${distance} depth=${depth}`
    );
    previousDepth = depth;
    if (distance === far) {
      assert.equal(depth, 1.0);
      continue;
    }
    const restored = linearizeDepth(depth, near, far, SHADOW_STANDARD_Z);
    assertAlmostEqual(restored, distance, 1.0e-12, `shadow standard-Z ${distance}`);
  }
  assert.equal(projectViewDepth(near, near, far, SHADOW_STANDARD_Z), 0.0);
  assert.equal(isBackgroundDepth(1.0, SHADOW_STANDARD_Z), true);
  assert.equal(isBackgroundDepth(1.0 - Number.EPSILON, SHADOW_STANDARD_Z), false);
  assert.throws(
    () => projectViewDepth(10.0, near, Infinity, SHADOW_STANDARD_Z),
    /far must be finite/
  );
}

console.log("depth_convention_api_contracts: all numeric contracts passed");
