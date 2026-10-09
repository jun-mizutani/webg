// ---------------------------------------------
//  PhysicsMath.js  2026/08/29
//   Shared vector, quaternion, and physics-result helpers
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import Quat from "./Quat.js";
import util from "./util.js";

const DEG_TO_RAD = Math.PI / 180.0;
const RAD_TO_DEG = 180.0 / Math.PI;
const EPSILON = 1.0e-8;

// optionのvec3を検証して読み、未指定時は呼出側が指定した既定値を複製して返します
// 数値の検証をPhysicsSpaceと各adapterで重複させず、同じ入力条件を共通化します
export function readOptionalVec3(value, name, defaultValue) {
  if (value === undefined) {
    return [...defaultValue];
  }
  if (!Array.isArray(value) || value.length < 3) {
    throw new Error(`${name} must be a vec3 array`);
  }
  return [
    util.readFiniteNumber(value[0], `${name}[0]`),
    util.readFiniteNumber(value[1], `${name}[1]`),
    util.readFiniteNumber(value[2], `${name}[2]`)
  ];
}

// 必須のvec3を検証して読み、入力配列をそのまま保持しない複製を返します
// 要素不足や非有限値を別の値へ置き換えず、呼出側へ入力不成立を通知します
export function readVec3(value, name) {
  if (!Array.isArray(value) || value.length < 3) {
    throw new Error(`${name} must be a vec3 array`);
  }
  return [
    util.readFiniteNumber(value[0], `${name}[0]`),
    util.readFiniteNumber(value[1], `${name}[1]`),
    util.readFiniteNumber(value[2], `${name}[2]`)
  ];
}

// vec3を複製し、solver中の配列を呼出側と共有しないようにします
export function cloneVec3(value) {
  return [value[0], value[1], value[2]];
}

// rad/secのworld角速度から、一fixed step分の有限回転quaternionを作ります
// 角速度の大きさを回転角へ直接変換し、一次近似ではなく実回転のΔqを返します
function buildFiniteRotationDelta(angularVelocityRad, dtSec) {
  const angularSpeed = Math.hypot(
    angularVelocityRad[0],
    angularVelocityRad[1],
    angularVelocityRad[2]
  );
  if (angularSpeed === 0.0) {
    return [1.0, 0.0, 0.0, 0.0];
  }
  const halfAngle = angularSpeed * dtSec * 0.5;
  const scale = Math.sin(halfAngle) / angularSpeed;
  return [
    Math.cos(halfAngle),
    angularVelocityRad[0] * scale,
    angularVelocityRad[1] * scale,
    angularVelocityRad[2] * scale
  ];
}

// Δqを現在姿勢の左へ掛け、world角速度の更新規則Δq ⊗ qを配列で返します
// Box専用solverもこの関数を使い、通常CPUの全形状で同じ有限回転を適用します
export function buildDeltaQuaternionStep(orientation, angularVelocityRad, dtSec) {
  const delta = buildFiniteRotationDelta(angularVelocityRad, dtSec);
  const next = [
    delta[0] * orientation[0]
      - delta[1] * orientation[1]
      - delta[2] * orientation[2]
      - delta[3] * orientation[3],
    delta[0] * orientation[1]
      + delta[1] * orientation[0]
      + delta[2] * orientation[3]
      - delta[3] * orientation[2],
    delta[0] * orientation[2]
      - delta[1] * orientation[3]
      + delta[2] * orientation[0]
      + delta[3] * orientation[1],
    delta[0] * orientation[3]
      + delta[1] * orientation[2]
      - delta[2] * orientation[1]
      + delta[3] * orientation[0]
  ];
  const length = Math.hypot(next[0], next[1], next[2], next[3]);
  if (length <= EPSILON) {
    throw new Error("PhysicsMath delta quaternion must not be zero");
  }
  return next.map((value) => value / length);
}

// CPUのdegree/sec角速度をrad/secへ変換し、有限回転Δq ⊗ qをQuatで返します
// PhysicsSpaceの一般shape経路とBox solverが同じ配列計算を使う入口です
export function buildComputeStepQuat(orientation, angularVelocity, dtSec) {
  const nextValues = buildDeltaQuaternionStep(
    orientation.q,
    degVec3ToRad(angularVelocity),
    dtSec
  );
  const next = orientation.clone();
  next.q[0] = nextValues[0];
  next.q[1] = nextValues[1];
  next.q[2] = nextValues[2];
  next.q[3] = nextValues[3];
  return next;
}

// public contactを複製し、内部のnormalやpoint配列を公開結果と共有しないようにします
export function cloneContact(contact) {
  return {
    bodyA: contact.bodyA,
    bodyB: contact.bodyB,
    normal: [...contact.normal],
    penetration: contact.penetration,
    point: Array.isArray(contact.point) ? [...contact.point] : null
  };
}

// manifoldを複製し、接触点とimpulseの配列をcacheやpublic getterから分離します
export function cloneManifold(manifold) {
  return {
    bodyA: manifold.bodyA,
    bodyB: manifold.bodyB,
    normal: [...manifold.normal],
    source: manifold.source ? { ...manifold.source } : null,
    sharedTangentImpulse: Array.isArray(manifold.sharedTangentImpulse)
      ? [...manifold.sharedTangentImpulse]
      : (Array.isArray(manifold.supportTangentImpulse)
        ? [...manifold.supportTangentImpulse]
        : [0.0, 0.0, 0.0]),
    supportTangentImpulse: Array.isArray(manifold.sharedTangentImpulse)
      ? [...manifold.sharedTangentImpulse]
      : (Array.isArray(manifold.supportTangentImpulse)
        ? [...manifold.supportTangentImpulse]
        : [0.0, 0.0, 0.0]),
    contacts: manifold.contacts.map((contact) => ({
      featureKey: typeof contact.featureKey === "string" ? contact.featureKey : null,
      penetration: contact.penetration,
      point: Array.isArray(contact.point) ? [...contact.point] : null,
      normalImpulse: contact.normalImpulse ?? 0.0,
      tangentImpulse: Array.isArray(contact.tangentImpulse)
        ? [...contact.tangentImpulse]
        : [0.0, 0.0, 0.0]
    }))
  };
}

// vec3の長さを返し、速度や重力の大きさを共通の計算順で比較します
export function lengthVec3(value) {
  return Math.hypot(value[0], value[1], value[2]);
}

// vec3の内積を返し、support判定や姿勢計算で同じ式を使います
export function dotVec3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

// vec3を指定倍率で複製し、入力配列を変更せずに返します
export function scaleVec3(value, scale) {
  return [value[0] * scale, value[1] * scale, value[2] * scale];
}

// 重力の逆向きをup axisとして返し、重力がほぼzeroのときは既定のworld Yを使います
// 既存のsupport判定と同じ条件を保ち、重力値の変更でsleep判定軸だけがずれないようにします
export function getUpAxisFromGravity(gravity) {
  const gravityLength = lengthVec3(gravity);
  if (gravityLength <= EPSILON) {
    return [0.0, 1.0, 0.0];
  }
  return [
    -gravity[0] / gravityLength,
    -gravity[1] / gravityLength,
    -gravity[2] / gravityLength
  ];
}

// 接触法線が重力に対して支持方向を向くか判定します
export function isSupportNormal(gravity, normal, threshold = 0.25) {
  if (!Array.isArray(normal)) {
    return false;
  }
  return dotVec3(normal, getUpAxisFromGravity(gravity)) >= threshold;
}

// degree/secのvec3をrad/secへ変換します
export function degVec3ToRad(value) {
  return [value[0] * DEG_TO_RAD, value[1] * DEG_TO_RAD, value[2] * DEG_TO_RAD];
}

// rad/secのvec3をdegree/secへ戻します
export function radVec3ToDeg(value) {
  return [value[0] * RAD_TO_DEG, value[1] * RAD_TO_DEG, value[2] * RAD_TO_DEG];
}

// vec3の差を返し、引数の配列を読み取り専用として扱います
export function subVec3(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

// vec3の和を返し、引数の配列を読み取り専用として扱います
export function addVec3(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

// vec3の外積を返し、回転軸や角速度寄与を同じ成分順で計算します
export function crossVec3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

// quaternionを[w,x,y,z]配列として読みます
// 既存PhysicsSpaceのquery補助が受け付けていた入力形式と既定姿勢を維持します
export function getQuatArray(quat) {
  if (Array.isArray(quat) && quat.length >= 4) {
    return [quat[0], quat[1], quat[2], quat[3]];
  }
  if (!quat || !Array.isArray(quat.q) || quat.q.length < 4) {
    return [1.0, 0.0, 0.0, 0.0];
  }
  return [quat.q[0], quat.q[1], quat.q[2], quat.q[3]];
}

// quaternionでvec3を回転し、collider queryと慣性計算で同じ回転式を使います
export function rotateVec3ByQuat(value, quat) {
  const q = getQuatArray(quat);
  const w = q[0];
  const x = q[1];
  const y = q[2];
  const z = q[3];
  const vx = value[0];
  const vy = value[1];
  const vz = value[2];
  const tx = 2.0 * (y * vz - z * vy);
  const ty = 2.0 * (z * vx - x * vz);
  const tz = 2.0 * (x * vy - y * vx);
  return [
    vx + w * tx + (y * tz - z * ty),
    vy + w * ty + (z * tx - x * tz),
    vz + w * tz + (x * ty - y * tx)
  ];
}

// 単位軸とdegree角からquaternionを組み立てます
export function buildAxisAngleQuat(axis, degree) {
  const unitAxis = normalizeVec3(axis, "PhysicsSpace axis");
  const halfRad = degree * Math.PI / 360.0;
  const s = Math.sin(halfRad);
  const quat = new Quat();
  quat.q[0] = Math.cos(halfRad);
  quat.q[1] = unitAxis[0] * s;
  quat.q[2] = unitAxis[1] * s;
  quat.q[3] = unitAxis[2] * s;
  quat.normalize();
  return quat;
}

// 二つの単位vec3を結ぶ最小回転quaternionを返します
// 反対向きのときはfromに直交する軸を明示的に選び、正規化可能な軸を使います
export function buildQuatFromUnitVectors(fromVec, toVec) {
  const from = normalizeVec3(fromVec, "PhysicsSpace fromVec");
  const to = normalizeVec3(toVec, "PhysicsSpace toVec");
  const dot = Math.max(-1.0, Math.min(1.0, dotVec3(from, to)));
  if (dot >= 1.0 - EPSILON) {
    return new Quat();
  }
  if (dot <= -1.0 + EPSILON) {
    const axis = Math.abs(from[1]) < 0.9
      ? crossVec3(from, [0.0, 1.0, 0.0])
      : crossVec3(from, [1.0, 0.0, 0.0]);
    return buildAxisAngleQuat(axis, 180.0);
  }
  const cross = crossVec3(from, to);
  const quat = new Quat();
  quat.q[0] = 1.0 + dot;
  quat.q[1] = cross[0];
  quat.q[2] = cross[1];
  quat.q[3] = cross[2];
  quat.normalize();
  return quat;
}

// bodyのlocal inverse inertiaをworld quaternionへ通して、world vectorへ適用します
// static bodyとfixed rotation bodyは従来どおり角速度寄与を持たない値を返します
export function applyWorldInverseInertia(body, quat, value) {
  if (body?.isDynamic?.() !== true || body?.getFixedRotation?.() === true) {
    return [0.0, 0.0, 0.0];
  }
  const inverseInertia = body.getInverseInertia?.() ?? [0.0, 0.0, 0.0];
  const axes = [
    rotateVec3ByQuat([1.0, 0.0, 0.0], quat),
    rotateVec3ByQuat([0.0, 1.0, 0.0], quat),
    rotateVec3ByQuat([0.0, 0.0, 1.0], quat)
  ];
  const result = [0.0, 0.0, 0.0];
  for (let index = 0; index < 3; index += 1) {
    const amount = dotVec3(value, axes[index]) * inverseInertia[index];
    result[0] += axes[index][0] * amount;
    result[1] += axes[index][1] * amount;
    result[2] += axes[index][2] * amount;
  }
  return result;
}

// vec3を正規化し、zero vectorを別方向へ置き換えず入力不成立を通知します
export function normalizeVec3(value, name) {
  const length = lengthVec3(value);
  if (length <= EPSILON) {
    throw new Error(`${name} must not be a zero vector`);
  }
  return [value[0] / length, value[1] / length, value[2] / length];
}

// 2点間距離の二乗を返し、平方根を使わずqueryや接触判定を比較します
export function distanceSqVec3(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}
