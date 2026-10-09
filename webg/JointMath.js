// ---------------------------------------------
//  JointMath.js  2026/08/25
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import util from "./util.js";
import Quat from "./Quat.js";

export const JOINT_EPSILON = 1.0e-8;
export const RAD_TO_DEG = 180.0 / Math.PI;

// vec3 option を検証して複製する
// Joint定義が呼出側の配列を直接変更しないように、必ず新しい配列を返す
export function readVec3(value, name, { nonZero = false } = {}) {
  if (!Array.isArray(value) || value.length < 3) {
    throw new Error(`${name} must be a vec3 array`);
  }
  const result = [
    util.readFiniteNumber(value[0], `${name}[0]`),
    util.readFiniteNumber(value[1], `${name}[1]`),
    util.readFiniteNumber(value[2], `${name}[2]`)
  ];
  if (nonZero && lengthVec3(result) <= JOINT_EPSILON) {
    throw new Error(`${name} must not be a zero vector`);
  }
  return result;
}

// quaternion optionを検証して複製する
// target relative orientationは現在姿勢から自動生成せず、明示された単位quaternionだけを受け付ける
export function readQuat(value, name) {
  const source = Array.isArray(value) ? value : value?.q;
  if (!Array.isArray(source) || source.length < 4) {
    throw new Error(`${name} must be a quaternion array or Quat-like object`);
  }
  const result = new Quat();
  result.q = [
    util.readFiniteNumber(source[0], `${name}[0]`),
    util.readFiniteNumber(source[1], `${name}[1]`),
    util.readFiniteNumber(source[2], `${name}[2]`),
    util.readFiniteNumber(source[3], `${name}[3]`)
  ];
  const magnitude = Math.hypot(...result.q);
  if (magnitude <= JOINT_EPSILON) {
    throw new Error(`${name} must not be a zero quaternion`);
  }
  if (Math.abs(magnitude - 1.0) > 1.0e-5) {
    throw new Error(`${name} must be a unit quaternion`);
  }
  return result;
}

// vec3の基本演算を返す
// Joint別モジュールへ同じ計算式を複写せず、CPU試作と将来のCompute移植で共有する
export function addVec3(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

// 2つのvec3の差を返す
export function subVec3(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

// 2つのquaternionを乗算した結果を返す
// 入力quaternionを変更せず、body Aからbody Bへの相対姿勢計算を共通化する
export function multiplyQuat(a, b) {
  const result = a.clone();
  result.mulQuat(b);
  result.normalize();
  return result;
}

// quaternionの共役を複製して返す
// body姿勢が単位quaternionである前提の逆回転を、元の姿勢を変更せずに作る
export function conjugateQuat(value) {
  const result = value.clone();
  result.conjugate();
  return result;
}

// 前後の姿勢quaternionからworld空間の小回転ベクトルを求める
// XPBD後の姿勢差をphysical angular velocityへ戻すため、符号が短い回転になるよう扱う
export function getWorldRotationVectorBetween(previousQuat, currentQuat) {
  const delta = multiplyQuat(currentQuat, conjugateQuat(previousQuat));
  if (delta.q[0] < 0.0) {
    delta.negate();
  }
  const vectorLength = Math.hypot(delta.q[1], delta.q[2], delta.q[3]);
  if (vectorLength <= JOINT_EPSILON) {
    return [
      2.0 * delta.q[1],
      2.0 * delta.q[2],
      2.0 * delta.q[3]
    ];
  }
  const angle = 2.0 * Math.atan2(vectorLength, delta.q[0]);
  const scale = angle / vectorLength;
  return [
    delta.q[1] * scale,
    delta.q[2] * scale,
    delta.q[3] * scale
  ];
}

// vec3を指定倍率で拡大した結果を返す
export function scaleVec3(value, scale) {
  return [value[0] * scale, value[1] * scale, value[2] * scale];
}

// 2つのvec3の内積を返す
export function dotVec3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

// 2つのvec3の外積を返す
export function crossVec3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

// vec3の長さを返す
export function lengthVec3(value) {
  return Math.hypot(value[0], value[1], value[2]);
}

// vec3を正規化する
// 長さがない軸を任意の軸へ置き換えず、呼出側の不正なJoint定義を明示的に停止する
export function normalizeVec3(value, name) {
  const length = lengthVec3(value);
  if (length <= JOINT_EPSILON) {
    throw new Error(`${name} must not be a zero vector`);
  }
  return scaleVec3(value, 1.0 / length);
}

// quaternionでvec3を回転する
// webgのQuat配列は [w, x, y, z] なので、同じ並びをここでも維持する
export function rotateVec3ByQuat(value, quat) {
  const q = quat?.q;
  if (!Array.isArray(q) || q.length < 4) {
    throw new Error("Joint quaternion must be a Quat-like object");
  }
  const w = q[0];
  const x = q[1];
  const y = q[2];
  const z = q[3];
  const tx = 2.0 * (y * value[2] - z * value[1]);
  const ty = 2.0 * (z * value[0] - x * value[2]);
  const tz = 2.0 * (x * value[1] - y * value[0]);
  return [
    value[0] + w * tx + (y * tz - z * ty),
    value[1] + w * ty + (z * tx - x * tz),
    value[2] + w * tz + (x * ty - y * tx)
  ];
}

// quaternionの逆回転でvec3を回転する
// 元のquaternionを変更せず、共役quaternionを作って回転結果を返す
export function inverseRotateVec3ByQuat(value, quat) {
  const inverse = quat.clone();
  inverse.conjugate();
  return rotateVec3ByQuat(value, inverse);
}

// bodyのlocal anchorをworld anchorへ変換する
// body transformを直接変更せず、現在姿勢からその場のanchor位置だけを算出する
export function getWorldAnchor(body, localAnchor) {
  return addVec3(body.getPosition(), rotateVec3ByQuat(localAnchor, body.getQuat()));
}

// world方向ベクトルへbodyのlocal inverse inertiaを適用する
// PhysicsSpaceと同じdiagonal local inertiaの解釈を使い、角速度単位の変換は呼出側で行う
export function applyWorldInverseInertia(body, worldVector) {
  if (!isMovableBody(body) || body.getFixedRotation?.() === true) {
    return [0.0, 0.0, 0.0];
  }
  const localInverse = body.getInverseInertia?.();
  if (!Array.isArray(localInverse) || localInverse.length < 3) {
    throw new Error("Joint body must expose getInverseInertia() as a vec3");
  }
  const quat = body.getQuat();
  const axes = [
    rotateVec3ByQuat([1.0, 0.0, 0.0], quat),
    rotateVec3ByQuat([0.0, 1.0, 0.0], quat),
    rotateVec3ByQuat([0.0, 0.0, 1.0], quat)
  ];
  const result = [0.0, 0.0, 0.0];
  for (let i = 0; i < 3; i++) {
    const amount = dotVec3(worldVector, axes[i]) * localInverse[i];
    result[0] += axes[i][0] * amount;
    result[1] += axes[i][1] * amount;
    result[2] += axes[i][2] * amount;
  }
  return result;
}

// Joint solverから見たbodyの逆質量を返す
// static / kinematic / sleeping bodyはこの試作では押し戻さない
export function getSolverInverseMass(body) {
  if (!isMovableBody(body) || body.getSleeping?.() === true) {
    return 0.0;
  }
  return body.getInverseMass();
}

// Joint solverから見たbodyが移動可能かを返す
export function isMovableBody(body) {
  return body?.isDynamic?.() === true;
}

// 接触点の線速度を返す
// PhysicsNodeのangularVelocityはdegree/secなので、ここでrad/secへ変換する
export function getPointVelocity(body, offset) {
  const velocity = body.getLinearVelocity();
  const angularVelocity = getWorldAngularVelocity(body);
  return addVec3(velocity, crossVec3(angularVelocity, offset));
}

// PhysicsNodeの[yaw, pitch, roll]角速度をworld XYZのrad/secへ変換する
// PhysicsSpaceの姿勢積分がQuat.eulerToQuat(yaw, pitch, roll)を使うため、Joint側も同じ軸順序を明示する
export function getWorldAngularVelocity(body) {
  const angularVelocity = body.getAngularVelocity();
  return [
    angularVelocity[1] / RAD_TO_DEG,
    angularVelocity[0] / RAD_TO_DEG,
    angularVelocity[2] / RAD_TO_DEG
  ];
}

// world XYZの角速度差をPhysicsNodeの[yaw, pitch, roll]配列へ加える
// world Xはpitch、world Yはyaw、world Zはrollへ戻す
export function addWorldAngularVelocity(body, angularDeltaRad, sign) {
  const angularVelocity = body.getAngularVelocity();
  const deltaDeg = scaleVec3(angularDeltaRad, sign * RAD_TO_DEG);
  body.setAngularVelocityVec([
    angularVelocity[0] + deltaDeg[1],
    angularVelocity[1] + deltaDeg[0],
    angularVelocity[2] + deltaDeg[2]
  ]);
}

// 速度impulseをbodyへ適用する
// impulseの符号はrow側で決め、ここではA/Bどちらにも同じ物理式を使う
export function applyVelocityImpulse(body, offset, impulse, sign) {
  const inverseMass = getSolverInverseMass(body);
  if (inverseMass <= 0.0) {
    return;
  }
  const velocity = body.getLinearVelocity();
  const linearDelta = scaleVec3(impulse, sign * inverseMass);
  body.setLinearVelocityVec(addVec3(velocity, linearDelta));
  if (body.getFixedRotation?.() === true) {
    return;
  }
  const angularImpulse = crossVec3(offset, impulse);
  const angularDeltaRad = applyWorldInverseInertia(body, angularImpulse);
  addWorldAngularVelocity(body, angularDeltaRad, sign);
}

// angular-onlyの速度impulseをbodyへ適用する
// HingeJointの軸揃え行ではlinear velocityを変えず、角速度だけを変更する
export function applyAngularVelocityImpulse(body, angularImpulse, sign) {
  if (!isMovableBody(body) || body.getSleeping?.() === true || body.getFixedRotation?.() === true) {
    return;
  }
  const angularDeltaRad = applyWorldInverseInertia(body, angularImpulse);
  addWorldAngularVelocity(body, angularDeltaRad, sign);
}

// 位置補正用のlinear/angular impulseをbody transformへ適用する
// coreのdynamic transform setter制限を破らないようsyncNodeFromPhysics()だけを使用する
export function applyPositionImpulse(body, offset, impulse, sign) {
  const inverseMass = getSolverInverseMass(body);
  if (inverseMass <= 0.0) {
    return;
  }
  const position = body.getPosition();
  const linearDelta = scaleVec3(impulse, sign * inverseMass);
  const nextPosition = addVec3(position, linearDelta);
  let nextQuat = body.getQuat();
  if (body.getFixedRotation?.() !== true) {
    const angularImpulse = crossVec3(offset, impulse);
    const angularDeltaRad = scaleVec3(applyWorldInverseInertia(body, angularImpulse), sign);
    nextQuat = applyWorldRotationVector(nextQuat, angularDeltaRad);
  }
  body.syncNodeFromPhysics(nextPosition, { quat: nextQuat });
}

// angular-onlyの位置補正をbody姿勢へ適用する
// HingeJointの軸揃えなど、anchorを動かさない角度制約で使う
export function applyAngularPositionImpulse(body, angularImpulse, sign) {
  if (!isMovableBody(body) || body.getSleeping?.() === true || body.getFixedRotation?.() === true) {
    return;
  }
  const angularDeltaRad = scaleVec3(applyWorldInverseInertia(body, angularImpulse), sign);
  body.syncNodeFromPhysics(body.getPosition(), {
    quat: applyWorldRotationVector(body.getQuat(), angularDeltaRad)
  });
}

// world-spaceの小さいrotation vectorをquaternionへ反映する
// world補正はleft multiplicationにし、PhysicsSpaceの姿勢補正と同じ向きを維持する
export function applyWorldRotationVector(quat, rotationVector) {
  const delta = new Quat();
  delta.q[1] = rotationVector[0] * 0.5;
  delta.q[2] = rotationVector[1] * 0.5;
  delta.q[3] = rotationVector[2] * 0.5;
  delta.normalize();
  const next = quat.clone();
  next.lmulQuat(delta);
  next.normalize();
  return next;
}

// 軸に直交する安定した2本の接線軸を返す
// 軸が特定の基準軸と平行なときだけ、別の固定基準軸を明示的に選ぶ
export function buildOrthogonalBasis(axis) {
  const unitAxis = normalizeVec3(axis, "Joint axis");
  const reference = Math.abs(unitAxis[1]) < 0.9
    ? [0.0, 1.0, 0.0]
    : [1.0, 0.0, 0.0];
  const first = normalizeVec3(crossVec3(unitAxis, reference), "Joint tangent axis");
  const second = normalizeVec3(crossVec3(unitAxis, first), "Joint second tangent axis");
  return [first, second];
}
