// -------------------------------------------------
// webgmodeler small math helpers
// -------------------------------------------------

export function readFiniteNumber(value, label) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`${label} must be a finite number: ${value}`);
  }
  return num;
}

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

export function add3(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub3(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function mul3(v, scale) {
  return [v[0] * scale, v[1] * scale, v[2] * scale];
}

export function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

export function length3(v) {
  return Math.hypot(v[0], v[1], v[2]);
}

export function normalize3(v, label = "vector") {
  const len = length3(v);
  if (!Number.isFinite(len) || len <= 1.0e-9) {
    throw new Error(`${label} has zero length`);
  }
  return [v[0] / len, v[1] / len, v[2] / len];
}
