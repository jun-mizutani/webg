// ---------------------------------------------
// DepthConvention.js  2026/08/14
//   Shared camera and shadow depth conventions
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import util from "./util.js";

// 深度形式、clear値、比較関数、near/farの対応を一つの不変objectへまとめます
// 深度設定は同じobjectから取得し、format・compare・clearの組み合わせを一体で管理します
function createDepthConvention({
  name,
  format,
  reversed,
  nearDepth,
  farDepth,
  clearValue,
  compare,
  compareEqual
}) {
  return Object.freeze({
    name,
    format,
    reversed,
    nearDepth,
    farDepth,
    clearValue,
    compare,
    compareEqual
  });
}
// 通常カメラはfloat depthの精度分布を活用するReverse-Zだけを使用します
// near=1、far=0なので、clear後の背景より大きいdepthを持つfragmentが手前になります
export const CAMERA_REVERSE_Z = createDepthConvention({
  name: "camera-reverse-z",
  format: "depth32float",
  reversed: true,
  nearDepth: 1.0,
  farDepth: 0.0,
  clearValue: 0.0,
  compare: "greater",
  compareEqual: "greater-equal"
});

// Shadow Mapはnear=0、far=1の通常Zを使います
// camera depthと同じdepth32floatでも比較方向と値の意味が異なるため、別のconventionとして扱います
export const SHADOW_STANDARD_Z = createDepthConvention({
  name: "shadow-standard-z",
  format: "depth32float",
  reversed: false,
  nearDepth: 0.0,
  farDepth: 1.0,
  clearValue: 1.0,
  compare: "less",
  compareEqual: "less-equal"
});

const KNOWN_DEPTH_CONVENTIONS = [
  CAMERA_REVERSE_Z,
  SHADOW_STANDARD_Z
];

// API境界で既知のconventionそのものが渡されたことを確認します
// 同じfieldを持つcloneを受け入れると、一部fieldだけを変更した独自規則が混入できるため拒否します
export function requireDepthConvention(value, label = "depth convention") {
  const checkedLabel = util.readOptionalString(
    label,
    "depth convention label",
    "depth convention",
    { trim: true, allowEmpty: false }
  );
  if (!KNOWN_DEPTH_CONVENTIONS.includes(value)) {
    throw new Error(
      `${checkedLabel} must be CAMERA_REVERSE_Z or SHADOW_STANDARD_Z`
    );
  }
  return value;
}

// near/farを使う深度計算の入力を共通検証します
// 無限farは利用側がInfinityを明示した場合だけ許可し、有限値は有限farとして検証します
export function readDepthRange(
  near,
  far,
  label = "depth range",
  { allowInfiniteFar = false } = {}
) {
  const checkedLabel = util.readOptionalString(
    label,
    "depth range label",
    "depth range",
    { trim: true, allowEmpty: false }
  );
  const checkedNear = util.readFiniteNumber(
    near,
    `${checkedLabel} near`,
    { minExclusive: 0.0 }
  );
  if (far === Infinity) {
    if (!allowInfiniteFar) {
      throw new Error(`${checkedLabel} far must be finite`);
    }
    return {
      near: checkedNear,
      far: Infinity,
      infiniteFar: true
    };
  }
  const checkedFar = util.readFiniteNumber(
    far,
    `${checkedLabel} far`,
    { minExclusive: checkedNear }
  );
  return {
    near: checkedNear,
    far: checkedFar,
    infiniteFar: false
  };
}

// 正のview-space距離をWebGPUの0から1のdepthへ投影します
// Matrix実装とは独立した参照式として使い、行列係数を同じコードから自己検証しないようにします
export function projectViewDepth(
  viewDepth,
  near,
  far,
  convention = CAMERA_REVERSE_Z
) {
  const checkedConvention = requireDepthConvention(
    convention,
    "projectViewDepth convention"
  );
  const range = readDepthRange(
    near,
    far,
    "projectViewDepth",
    { allowInfiniteFar: checkedConvention === CAMERA_REVERSE_Z }
  );
  const checkedViewDepth = util.readFiniteNumber(
    viewDepth,
    "projectViewDepth viewDepth",
    { min: range.near }
  );
  if (!range.infiniteFar && checkedViewDepth > range.far) {
    throw new Error(
      `projectViewDepth viewDepth must be <= ${range.far}: ${checkedViewDepth}`
    );
  }

  if (checkedConvention.reversed) {
    if (range.infiniteFar) {
      return range.near / checkedViewDepth;
    }
    return (
      range.near * (range.far - checkedViewDepth)
      / (checkedViewDepth * (range.far - range.near))
    );
  }

  if (range.infiniteFar) {
    throw new Error("SHADOW_STANDARD_Z does not support an infinite far plane");
  }
  return (
    range.far * (checkedViewDepth - range.near)
    / (checkedViewDepth * (range.far - range.near))
  );
}

// depth textureから読んだ値を正のview-space距離へ戻します
// 背景値は距離を持たないため先に例外とし、実際の深度から計算できる距離だけを返します
export function linearizeDepth(
  depth,
  near,
  far,
  convention = CAMERA_REVERSE_Z
) {
  const checkedConvention = requireDepthConvention(
    convention,
    "linearizeDepth convention"
  );
  const range = readDepthRange(
    near,
    far,
    "linearizeDepth",
    { allowInfiniteFar: checkedConvention === CAMERA_REVERSE_Z }
  );
  const checkedDepth = util.readFiniteNumber(
    depth,
    "linearizeDepth depth",
    { min: 0.0, max: 1.0 }
  );
  if (isBackgroundDepth(checkedDepth, checkedConvention)) {
    throw new Error("linearizeDepth cannot linearize the background depth");
  }

  if (checkedConvention.reversed) {
    if (range.infiniteFar) {
      return range.near / checkedDepth;
    }
    return (
      range.near * range.far
      / (range.near + checkedDepth * (range.far - range.near))
    );
  }

  return (
    range.near * range.far
    / (range.far + checkedDepth * (range.near - range.far))
  );
}

// texture clearで書かれた背景値だけを背景として判定します
// far付近の実geometryを背景と区別するため、許容幅を使わず深度規約をそのまま判定します
export function isBackgroundDepth(
  depth,
  convention = CAMERA_REVERSE_Z
) {
  const checkedConvention = requireDepthConvention(
    convention,
    "isBackgroundDepth convention"
  );
  const checkedDepth = util.readFiniteNumber(
    depth,
    "isBackgroundDepth depth",
    { min: 0.0, max: 1.0 }
  );
  return checkedDepth === checkedConvention.clearValue;
}
