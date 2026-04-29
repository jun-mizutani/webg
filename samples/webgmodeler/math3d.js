// ---------------------------------------------
// samples/webgmodeler/math3d.js  2026/04/29
//   webgmodeler small math helpers
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
// 外部入力や DOM 文字列を数値として扱う前に有限数か検証する
export function readFiniteNumber(value, label) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`${label} must be a finite number: ${value}`);
  }
  return num;
}

// 3 要素の数値配列を vec3 として読み取り、各要素を検証する
export function readVec3(value, label) {
  if (!Array.isArray(value) || value.length < 3) {
    throw new Error(`${label} must be an array with at least 3 numbers`);
  }
  return [
    readFiniteNumber(value[0], `${label}[0]`),
    readFiniteNumber(value[1], `${label}[1]`),
    readFiniteNumber(value[2], `${label}[2]`)
  ];
}

// 2 つの vec3 を成分ごとに加算する
export function add3(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

// 2 つの vec3 の差分を成分ごとに求める
export function sub3(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

// vec3 を scalar 倍する
export function mul3(v, scale) {
  return [v[0] * scale, v[1] * scale, v[2] * scale];
}

// 2 つの vec3 の内積を求める
export function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

// 2 つの vec3 の外積を求める
export function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

// vec3 の長さを求める
export function length3(v) {
  return Math.hypot(v[0], v[1], v[2]);
}

// vec3 を正規化し、長さ 0 付近なら error にする
export function normalize3(v, label = "vector") {
  const len = length3(v);
  if (!Number.isFinite(len) || len <= 1.0e-9) {
    throw new Error(`${label} has zero length`);
  }
  return [v[0] / len, v[1] / len, v[2] / len];
}
