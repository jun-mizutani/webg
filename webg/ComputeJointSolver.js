// ---------------------------------------------
//  ComputeJointSolver.js  2026/08/25
//   WGSL XPBD solver for Compute Physics Joint records
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import { COMPUTE_PHYSICS_JOINT_LAYOUT } from "./ComputeJointBuffer.js";

const MAX_JOINT_ROWS = 6;

// Compute版Jointのposition correctionを、既存contact solver後の独立passとして生成します
// contact solverのWGSLへ形状別Joint式を混ぜず、共通recordとtype switchだけでDistance/BallSocket/Hinge/Fixedを処理します
export function createComputeJointWGSL({
  maxBodies,
  recordBaseU32,
  maxJointLinks,
  jointSolverIterations,
  jointPassParity = 0
}) {
  const layout = COMPUTE_PHYSICS_JOINT_LAYOUT;
  const checkedMaxBodies = Number(maxBodies);
  const checkedRecordBase = Number(recordBaseU32);
  const checkedMaxLinks = Number(maxJointLinks);
  const checkedIterations = Number(jointSolverIterations);
  const checkedParity = Number(jointPassParity);
  if (!Number.isInteger(checkedMaxBodies) || checkedMaxBodies < 1) {
    throw new Error("createComputeJointWGSL maxBodies must be a positive integer");
  }
  if (!Number.isInteger(checkedRecordBase) || checkedRecordBase < 1) {
    throw new Error("createComputeJointWGSL recordBaseU32 must be a positive integer");
  }
  if (!Number.isInteger(checkedMaxLinks) || checkedMaxLinks < 2) {
    throw new Error("createComputeJointWGSL maxJointLinks must be at least 2");
  }
  if (!Number.isInteger(checkedIterations) || checkedIterations < 1 || checkedIterations > 64) {
    throw new Error("createComputeJointWGSL jointSolverIterations must be in [1, 64]");
  }
  if (!Number.isInteger(checkedParity) || checkedParity < 0 || checkedParity > 1) {
    throw new Error("createComputeJointWGSL jointPassParity must be 0 or 1");
  }

  return `
const JOINT_RECORD_BASE : u32 = ${checkedRecordBase}u;
const JOINT_MAX_LINKS : u32 = ${checkedMaxLinks}u;
const JOINT_RECORD_STRIDE : u32 = ${layout.recordStrideU32}u;
const JOINT_PASS_PARITY : u32 = ${checkedParity}u;
const JOINT_EPSILON : f32 = 0.00000001;

struct JointBodyState {
  position : vec4f,
  orientation : vec4f,
  linearVelocityInvMass : vec4f,
  angularVelocitySleep : vec4f,
  halfExtentsSleepCounter : vec4f,
  inverseInertiaLocal : vec4f,
  material : vec4f,
  color : vec4f,
};

struct JointSimParams {
  timing : vec4f,
  gravityBeta : vec4f,
  bounds : vec4f,
  scale0 : vec4f,
  scale1 : vec4f,
  sleep : vec4f,
  grid : vec4f,
  wake : vec4f,
};

struct JointRow {
  axis : vec3f,
  error : f32,
  angular : bool,
  valid : bool,
};

@group(0) @binding(0) var<storage, read> jointSrcBodies : array<JointBodyState>;
@group(0) @binding(1) var<storage, read_write> jointDstBodies : array<JointBodyState>;
@group(0) @binding(2) var<uniform> jointParams : JointSimParams;
@group(0) @binding(7) var<storage, read_write> jointData : array<u32>;

// [w,x,y,z] quaternionを乗算し、BodyStateと同じ成分順で姿勢補正を適用します
fn jointQuatMultiply(a : vec4f, b : vec4f) -> vec4f {
  return vec4f(
    a.x*b.x-a.y*b.y-a.z*b.z-a.w*b.w,
    a.x*b.y+a.y*b.x+a.z*b.w-a.w*b.z,
    a.x*b.z-a.y*b.w+a.z*b.x+a.w*b.y,
    a.x*b.w+a.y*b.z-a.z*b.y+a.w*b.x
  );
}

// 単位quaternionの共役を返し、local/world回転を同じ関数で変換します
fn jointQuatConjugate(q : vec4f) -> vec4f {
  return vec4f(q.x, -q.y, -q.z, -q.w);
}

// XPBD反復中の姿勢丸め誤差を正規化し、回転の大きさをGPU上で維持します
fn jointQuatNormalize(q : vec4f) -> vec4f {
  let lengthSq = dot(q, q);
  return q * inverseSqrt(lengthSq);
}

// world vectorをquaternionで回転し、local anchor/axisを現在姿勢へ変換します
fn jointQuatRotate(q : vec4f, value : vec3f) -> vec3f {
  return jointQuatMultiply(
    jointQuatMultiply(q, vec4f(0.0, value)),
    jointQuatConjugate(q)
  ).yzw;
}

// world角度ベクトルを現在姿勢へ左から適用し、angular Joint rowの姿勢だけを補正します
fn jointApplyRotationCorrection(orientation : vec4f, rotationVector : vec3f) -> vec4f {
  let angle = length(rotationVector);
  if (angle <= JOINT_EPSILON) {
    return jointQuatNormalize(
      orientation + jointQuatMultiply(vec4f(0.0, rotationVector), orientation) * 0.5
    );
  }
  let axis = rotationVector / angle;
  let half = angle * 0.5;
  let delta = vec4f(cos(half), axis * sin(half));
  return jointQuatNormalize(jointQuatMultiply(delta, orientation));
}

// local対角逆慣性をworld軸へ適用し、Box/Capsule/SphereのBodyState欄を共通に扱います
fn jointInverseInertiaApply(orientation : vec4f, inverseLocal : vec3f, value : vec3f) -> vec3f {
  let local = jointQuatRotate(jointQuatConjugate(orientation), value);
  return jointQuatRotate(orientation, local * inverseLocal);
}

// 固定stride recordのuint欄を参照します
fn jointUint(recordIndex : u32, offset : u32) -> u32 {
  return jointData[JOINT_RECORD_BASE + recordIndex * JOINT_RECORD_STRIDE + offset];
}

// 固定stride recordのfloat欄をbitcastで参照します
fn jointFloat(recordIndex : u32, offset : u32) -> f32 {
  return bitcast<f32>(jointUint(recordIndex, offset));
}

// record内のvec3欄を読み、anchor/axisの成分順を固定します
fn jointVec3(recordIndex : u32, offset : u32) -> vec3f {
  return vec3f(
    jointFloat(recordIndex, offset),
    jointFloat(recordIndex, offset + 1u),
    jointFloat(recordIndex, offset + 2u)
  );
}

// record内のquaternion欄を読み、target relative orientationをGPUへ渡します
fn jointQuat(recordIndex : u32, offset : u32) -> vec4f {
  return vec4f(
    jointFloat(recordIndex, offset),
    jointFloat(recordIndex, offset + 1u),
    jointFloat(recordIndex, offset + 2u),
    jointFloat(recordIndex, offset + 3u)
  );
}

// CPU Jointと同じposition slop規則を使い、許容範囲内の微小誤差をlambdaの対象外として扱います
fn jointCorrectedError(error : f32, slop : f32) -> f32 {
  let magnitude = max(abs(error) - slop, 0.0);
  return select(-magnitude, magnitude, error >= 0.0);
}

// axisからCPU buildOrthogonalBasisと同じ順序の2接線軸を作ります
fn jointBuildBasis(axisInput : vec3f) -> array<vec3f, 2> {
  let axis = normalize(axisInput);
  var reference = vec3f(0.0, 1.0, 0.0);
  if (abs(axis.y) >= 0.9) { reference = vec3f(1.0, 0.0, 0.0); }
  let first = normalize(cross(axis, reference));
  let second = normalize(cross(axis, first));
  return array<vec3f, 2>(first, second);
}

// FixedJointのrelative orientation errorをworld rotation vectorへ変換します
fn jointFixedOrientationError(bodyA : JointBodyState, bodyB : JointBodyState, targetQuat : vec4f) -> vec3f {
  let relative = jointQuatMultiply(
    jointQuatConjugate(jointQuatNormalize(bodyA.orientation)),
    jointQuatNormalize(bodyB.orientation)
  );
  var localError = jointQuatMultiply(relative, jointQuatConjugate(jointQuatNormalize(targetQuat)));
  if (localError.x < 0.0) { localError = -localError; }
  return jointQuatRotate(
    jointQuatNormalize(bodyA.orientation),
    2.0 * localError.yzw
  );
}

// Joint種類とrow番号から、現在のanchor/axis状態に対するscalar constraintを構築します
// linear rowはanchor差、angular rowはaxis alignmentまたはrelative orientation差を返します
fn jointBuildRow(
  recordIndex : u32,
  bodyA : JointBodyState,
  bodyB : JointBodyState,
  rowIndex : u32
) -> JointRow {
  let jointType = jointUint(recordIndex, ${layout.type}u);
  let anchorA = bodyA.position.xyz + jointQuatRotate(
    jointQuatNormalize(bodyA.orientation),
    jointVec3(recordIndex, ${layout.localAnchorA}u)
  );
  let anchorB = bodyB.position.xyz + jointQuatRotate(
    jointQuatNormalize(bodyB.orientation),
    jointVec3(recordIndex, ${layout.localAnchorB}u)
  );
  let anchorDelta = anchorB - anchorA;
  let axes = array<vec3f, 3>(
    vec3f(1.0, 0.0, 0.0),
    vec3f(0.0, 1.0, 0.0),
    vec3f(0.0, 0.0, 1.0)
  );
  if (jointType == 0u) {
    let distanceSq = dot(anchorDelta, anchorDelta);
    var axis = jointVec3(recordIndex, ${layout.localAxisA}u);
    var distance = 0.0;
    if (distanceSq > JOINT_EPSILON * JOINT_EPSILON) {
      distance = sqrt(distanceSq);
      axis = anchorDelta / distance;
    }
    return JointRow(axis, distance - jointFloat(recordIndex, ${layout.distance}u), false, true);
  }
  if (jointType == 1u) {
    return JointRow(axes[rowIndex], dot(anchorDelta, axes[rowIndex]), false, true);
  }
  if (jointType == 2u) {
    if (rowIndex < 3u) {
      return JointRow(axes[rowIndex], dot(anchorDelta, axes[rowIndex]), false, true);
    }
    let axisA = jointQuatRotate(
      jointQuatNormalize(bodyA.orientation),
      normalize(jointVec3(recordIndex, ${layout.localAxisA}u))
    );
    let axisB = jointQuatRotate(
      jointQuatNormalize(bodyB.orientation),
      normalize(jointVec3(recordIndex, ${layout.localAxisB}u))
    );
    let basis = jointBuildBasis(axisA);
    let tangent = basis[rowIndex - 3u];
    return JointRow(tangent, dot(cross(axisA, axisB), tangent), true, true);
  }
  if (jointType == 3u) {
    if (rowIndex < 3u) {
      return JointRow(axes[rowIndex], dot(anchorDelta, axes[rowIndex]), false, true);
    }
    let error = jointFixedOrientationError(
      bodyA,
      bodyB,
      jointQuat(recordIndex, ${layout.targetRelativeOrientation}u)
    );
    return JointRow(axes[rowIndex - 3u], dot(error, axes[rowIndex - 3u]), true, true);
  }
  return JointRow(vec3f(0.0), 0.0, false, false);
}

// constraint rowの有効質量を計算し、固定bodyの逆質量・逆慣性0をそのまま反映します
fn jointEffectiveMass(
  row : JointRow,
  bodyA : JointBodyState,
  bodyB : JointBodyState,
  rA : vec3f,
  rB : vec3f
) -> f32 {
  let inverseMassA = bodyA.linearVelocityInvMass.w;
  let inverseMassB = bodyB.linearVelocityInvMass.w;
  if (row.angular) {
    return dot(row.axis, jointInverseInertiaApply(
      jointQuatNormalize(bodyA.orientation), bodyA.inverseInertiaLocal.xyz, row.axis
    )) + dot(row.axis, jointInverseInertiaApply(
      jointQuatNormalize(bodyB.orientation), bodyB.inverseInertiaLocal.xyz, row.axis
    ));
  }
  let angularA = cross(rA, row.axis);
  let angularB = cross(rB, row.axis);
  return inverseMassA + inverseMassB
    + dot(angularA, jointInverseInertiaApply(
      jointQuatNormalize(bodyA.orientation), bodyA.inverseInertiaLocal.xyz, angularA
    ))
    + dot(angularB, jointInverseInertiaApply(
      jointQuatNormalize(bodyB.orientation), bodyB.inverseInertiaLocal.xyz, angularB
    ));
}

// 一つのXPBD rowをlambda差分で解き、現在body側だけへposition/orientation correctionを適用します
// A側recordはAのJ=-1、B側recordはBのJ=+1を使うため、各recordだけを更新します
fn jointSolveRow(
  recordIndex : u32,
  rowIndex : u32,
  side : u32,
  bodyA : JointBodyState,
  bodyB : JointBodyState,
  row : JointRow,
  position : ptr<function, vec3f>,
  orientation : ptr<function, vec4f>
) {
  if (!row.valid) { return; }
  let anchorA = bodyA.position.xyz + jointQuatRotate(
    jointQuatNormalize(bodyA.orientation),
    jointVec3(recordIndex, ${layout.localAnchorA}u)
  );
  let anchorB = bodyB.position.xyz + jointQuatRotate(
    jointQuatNormalize(bodyB.orientation),
    jointVec3(recordIndex, ${layout.localAnchorB}u)
  );
  let rA = anchorA - bodyA.position.xyz;
  let rB = anchorB - bodyB.position.xyz;
  let effectiveMass = jointEffectiveMass(row, bodyA, bodyB, rA, rB);
  let dt = jointParams.timing.x;
  let alpha = jointFloat(recordIndex, ${layout.compliance}u) / (dt * dt);
  let correctedError = jointCorrectedError(
    row.error,
    jointFloat(recordIndex, ${layout.positionCorrectionSlop}u)
  );
  let relativeVelocity = select(
    dot(
      bodyB.linearVelocityInvMass.xyz + cross(bodyB.angularVelocitySleep.xyz, rB)
        - bodyA.linearVelocityInvMass.xyz - cross(bodyA.angularVelocitySleep.xyz, rA),
      row.axis
    ),
    dot(bodyB.angularVelocitySleep.xyz - bodyA.angularVelocitySleep.xyz, row.axis),
    row.angular
  );
  let lambdaOffset = ${layout.lambda}u + rowIndex;
  let previousLambda = jointFloat(recordIndex, lambdaOffset);
  jointData[JOINT_RECORD_BASE + recordIndex * JOINT_RECORD_STRIDE + ${layout.relativeVelocity}u + rowIndex] = bitcast<u32>(relativeVelocity);
  if (effectiveMass + alpha <= JOINT_EPSILON) {
    jointData[JOINT_RECORD_BASE + recordIndex * JOINT_RECORD_STRIDE + ${layout.error}u + rowIndex] = bitcast<u32>(correctedError);
    jointData[JOINT_RECORD_BASE + recordIndex * JOINT_RECORD_STRIDE + ${layout.runtimeFlags}u] = 3u;
    return;
  }
  let deltaLambda = (-correctedError - alpha * previousLambda) / (effectiveMass + alpha);
  jointData[JOINT_RECORD_BASE + recordIndex * JOINT_RECORD_STRIDE + lambdaOffset] = bitcast<u32>(previousLambda + deltaLambda);
  jointData[JOINT_RECORD_BASE + recordIndex * JOINT_RECORD_STRIDE + ${layout.error}u + rowIndex] = bitcast<u32>(correctedError);
  jointData[JOINT_RECORD_BASE + recordIndex * JOINT_RECORD_STRIDE + ${layout.runtimeFlags}u] = 1u;
  let sideSign = select(-1.0, 1.0, side == 1u);
  if (row.angular) {
    let angularDelta = jointInverseInertiaApply(
      jointQuatNormalize(select(bodyA.orientation, bodyB.orientation, side == 1u)),
      select(bodyA.inverseInertiaLocal.xyz, bodyB.inverseInertiaLocal.xyz, side == 1u),
      row.axis * (deltaLambda * sideSign)
    );
    *orientation = jointApplyRotationCorrection(*orientation, angularDelta);
  } else {
    *position += select(bodyA.linearVelocityInvMass.w, bodyB.linearVelocityInvMass.w, side == 1u)
      * row.axis * (deltaLambda * sideSign);
    let lever = select(rA, rB, side == 1u);
    let angularImpulse = cross(lever, row.axis) * (deltaLambda * sideSign);
    let angularDelta = jointInverseInertiaApply(
      jointQuatNormalize(*orientation),
      select(bodyA.inverseInertiaLocal.xyz, bodyB.inverseInertiaLocal.xyz, side == 1u),
      angularImpulse
    );
    *orientation = jointApplyRotationCorrection(*orientation, angularDelta);
  }
}

// XPBD後の姿勢差をworld rotation vectorへ変換し、Joint位置補正分だけ速度へ戻します
// contact solverの速度へ補正を全量再注入せず、このpass自身が追加したtransform差だけを加えます
fn jointRotationVectorBetween(previous : vec4f, current : vec4f) -> vec3f {
  var delta = jointQuatMultiply(
    jointQuatNormalize(current),
    jointQuatConjugate(jointQuatNormalize(previous))
  );
  if (delta.x < 0.0) { delta = -delta; }
  let vectorLength = length(delta.yzw);
  if (vectorLength <= JOINT_EPSILON) { return 2.0 * delta.yzw; }
  let angle = 2.0 * atan2(vectorLength, delta.x);
  return delta.yzw * (angle / vectorLength);
}

// 1 invocationが1 bodyを担当し、body adjacencyの各recordを局所XPBD反復で解きます
// A/Bのrecordは別invocationが同じsrc stateを参照するため、各invocationのbuffer書き込みを分離します
@compute @workgroup_size(64)
fn jointMain(@builtin(global_invocation_id) id : vec3u) {
  let bodyIndex = id.x;
  let bodyCount = u32(jointParams.timing.y);
  if (bodyIndex >= bodyCount) { return; }
  let source = jointSrcBodies[bodyIndex];
  if (source.position.w <= 0.0) {
    jointDstBodies[bodyIndex] = source;
    return;
  }
  let rangeOffset = bodyIndex * 2u;
  let adjacencyStart = jointData[rangeOffset];
  let adjacencyCount = jointData[rangeOffset + 1u];
  var position = source.position.xyz;
  var orientation = jointQuatNormalize(source.orientation);
  var hasJoint = false;
  // 一つのdispatchでは全bodyが同じsource stateを読むため、反復間のstate交換はSpace側で行います
  // ここは1回だけ解き、次のdispatchが直前の全body補正結果をsourceとして読む構成にします
  for (var iteration = 0u; iteration < 1u; iteration += 1u) {
    for (var link = 0u; link < ${checkedMaxLinks}u; link += 1u) {
      if (link >= adjacencyCount) { break; }
      let recordIndex = jointData[${checkedMaxBodies * 2}u + adjacencyStart + link];
      // Joint slotの偶奇でpassを分け、同じbodyへ接続した隣接Jointを順番に補正します
      if ((recordIndex / 2u) % 2u != JOINT_PASS_PARITY) { continue; }
      let flags = jointUint(recordIndex, ${layout.flags}u);
      if ((flags & ${layout.enabledFlag}u) == 0u) { continue; }
      let ownSide = jointUint(recordIndex, ${layout.side}u);
      var bodyA = jointSrcBodies[jointUint(recordIndex, ${layout.bodyA}u)];
      var bodyB = jointSrcBodies[jointUint(recordIndex, ${layout.bodyB}u)];
      if (ownSide == 0u) {
        bodyA.position = vec4f(position, 1.0);
        bodyA.orientation = orientation;
      } else {
        bodyB.position = vec4f(position, 1.0);
        bodyB.orientation = orientation;
      }
      let rowCount = jointUint(recordIndex, ${layout.rowCount}u);
      for (var rowIndex = 0u; rowIndex < ${MAX_JOINT_ROWS}u; rowIndex += 1u) {
        if (rowIndex >= rowCount) { break; }
        let row = jointBuildRow(recordIndex, bodyA, bodyB, rowIndex);
        jointSolveRow(recordIndex, rowIndex, ownSide, bodyA, bodyB, row, &position, &orientation);
        if (ownSide == 0u) {
          bodyA.position = vec4f(position, 1.0);
          bodyA.orientation = orientation;
        } else {
          bodyB.position = vec4f(position, 1.0);
          bodyB.orientation = orientation;
        }
        hasJoint = true;
      }
    }
  }
  var result = source;
  result.position = vec4f(position, 1.0);
  result.orientation = orientation;
  if (hasJoint) {
    let dt = jointParams.timing.x;
    result.linearVelocityInvMass = vec4f(
      source.linearVelocityInvMass.xyz + (position - source.position.xyz) / dt,
      source.linearVelocityInvMass.w
    );
    result.angularVelocitySleep = vec4f(
      source.angularVelocitySleep.xyz + jointRotationVectorBetween(source.orientation, orientation) / dt,
      0.0
    );
  }
  jointDstBodies[bodyIndex] = result;
}
`;
}

export default createComputeJointWGSL;
