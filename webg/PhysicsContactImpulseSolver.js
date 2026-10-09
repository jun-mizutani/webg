// ---------------------------------------------
//  PhysicsContactImpulseSolver.js  2026/09/13
//   Shared local-contact impulse solver for CPU and GPU Compute paths
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import PhysicsMaterialPairs from './PhysicsMaterialPairs.js';

const defaultMaterialPairs = new PhysicsMaterialPairs();
const EPSILON = 1.0e-8;
const DENOMINATOR_EPSILON = 1.0e-7;

// vec3の内積を計算し、法線速度と有効質量の式で同じ演算順序を使います
function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

// vec3の外積を計算し、作用点の角速度寄与を求めます
function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

// vec3の加算を行い、contact point velocityの計算結果を新しい配列へ返します
function add3(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

// vec3の減算を行い、二つの接触点速度から相対速度を作ります
function sub3(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

// vec3をscalar倍し、接触法線と接線の力積ベクトルを作ります
function scale3(value, scalar) {
  return [value[0] * scalar, value[1] * scalar, value[2] * scalar];
}

// vec3の長さを求め、接線速度と力積の大きさを比較します
function length3(value) {
  return Math.hypot(value[0], value[1], value[2]);
}

// 配列を複製し、診断結果が次の接触計算で上書きされないようにします
function clone3(value) {
  return [value[0], value[1], value[2]];
}

// Rolling resistance is an angular impulse, capped by normal load times a length in metres.
// Keep its vector accumulator within this step; do not multiply the cap by iteration count.
export function solvePhysicsRollingResistance({ normal, normalLambda, length, accumulator,
  local, other, getAngularVelocity, applyInverseInertia, applyAngularImpulse,
  applyToOther = false }) {
  if (!(length > 0) || !(normalLambda > EPSILON) || !applyInverseInertia || !applyAngularImpulse) return;
  const relative = sub3(getAngularVelocity(local), getAngularVelocity(other));
  const tangent = sub3(relative, scale3(normal, dot3(relative, normal)));
  const speed = length3(tangent);
  if (speed <= EPSILON) return;
  const direction = scale3(tangent, 1 / speed);
  let response = applyInverseInertia(local, direction);
  if (other.sleeping !== true) response = add3(response, applyInverseInertia(other, direction));
  const denominator = dot3(direction, response);
  if (denominator <= DENOMINATOR_EPSILON) return;
  const previous = accumulator.rollingLambda ?? [0, 0, 0];
  const requested = sub3(previous, scale3(direction, speed / denominator));
  const magnitude = length3(requested);
  const cap = normalLambda * length;
  const next = magnitude > cap ? scale3(requested, cap / magnitude) : requested;
  const delta = sub3(next, previous);
  accumulator.rollingLambda = next;
  applyAngularImpulse(local, delta);
  if (applyToOther) applyAngularImpulse(other, scale3(delta, -1));
}

// 法線だけから安定した接線基底を作り、bodyの処理順による摩擦軸の変化を防ぎます
// zero法線を任意の方向へ置き換えず、invalid inputはnormalize callback側で検出します
function buildContactTangents(normal, normalize) {
  const seed = Math.abs(normal[0]) > 0.5
    ? [0.0, 1.0, 0.0]
    : [1.0, 0.0, 0.0];
  const tangentA = normalize(cross3(normal, seed), "PhysicsContactImpulseSolver tangentA");
  const tangentB = normalize(cross3(normal, tangentA), "PhysicsContactImpulseSolver tangentB");
  return [tangentA, tangentB];
}

// 接触のlocal body一体分について、GPU Compute版と同じlocal接触式を実行します
// 既定はlocal bodyだけを更新し、Compute版のsnapshot入力を保持します
// applyImpulseToOtherとapplyPositionCorrectionToOtherを渡したcoupled経路では、同じ接触の反作用をotherへ返します
// bodyの角速度単位や逆慣性の実装差はcallbackへ分離し、接触式自体をCPUとComputeで共有します
export function solvePhysicsContactImpulse({
  local,
  other,
  normal,
  point,
  penetration,
  iteration,
  solverIterations,
  restingRestitutionSpeed,
  restitutionCoefficient = null,
  frictionCoefficient = null,
  materialPairs = defaultMaterialPairs,
  getAngularVelocity = state => state.angularVelocity,
  applyInverseInertia = null,
  applyAngularImpulse = null,
  revisitBodyContactImpulses,
  accumulator,
  positionCorrectionSlop,
  positionCorrectionBeta,
  getContactPointVelocity,
  getRelativeVelocity = (localState, otherState, localArm, otherArm) => (
    sub3(
      getContactPointVelocity(otherState, otherArm),
      getContactPointVelocity(localState, localArm)
    )
  ),
  getAngularContribution,
  applyImpulse,
  applyImpulseToOther = null,
  applyPositionCorrectionToOther = null,
  normalize = (value) => {
    const magnitude = length3(value);
    if (magnitude <= EPSILON) {
      throw new Error("PhysicsContactImpulseSolver vector must not be zero");
    }
    return scale3(value, 1.0 / magnitude);
  },
  tangentBasis = null,
  localSign = -1.0,
  impulseApplicationEpsilon = EPSILON,
  traceEnabled = false
}) {
  if (!local || !other || !accumulator) {
    throw new Error("PhysicsContactImpulseSolver local, other, and accumulator are required");
  }
  if (typeof getContactPointVelocity !== "function"
      || typeof getAngularContribution !== "function"
      || typeof applyImpulse !== "function") {
    throw new Error("PhysicsContactImpulseSolver callbacks are required");
  }
  if (!Array.isArray(normal) || normal.length !== 3
      || !Array.isArray(point) || point.length !== 3) {
    throw new Error("PhysicsContactImpulseSolver normal and point must be vec3");
  }

  const inverseMassSum = local.inverseMass + other.inverseMass;
  if (inverseMassSum <= DENOMINATOR_EPSILON) {
    accumulator.normalLambda = 0.0;
    accumulator.tangentLambdaA = 0.0;
    accumulator.tangentLambdaB = 0.0;
    return {
      support: false,
      normalImpulseApplied: false,
      impulseApplied: false,
      contactSpeed: 0.0,
      normalSpeed: 0.0,
      normalVelocity: 0.0,
      positionCorrection: null,
      impulseAudit: null
    };
  }

  const localArm = sub3(point, local.position);
  const otherArm = sub3(point, other.position);
  // 通常のCompute互換経路はlocal bodyだけを更新し、coupled経路だけが相手bodyへ同じ増分を反映します
  // localSignはnormalに対するlocal bodyの向きを表すため、相手へは符号を反転して渡します
  const applyImpulsePair = (impulse) => {
    applyImpulse(local, localArm, impulse, localSign);
    if (typeof applyImpulseToOther === "function") {
      applyImpulseToOther(other, otherArm, impulse, -localSign);
    }
  };
  const relativeVelocity = getRelativeVelocity(local, other, localArm, otherArm);
  const normalVelocity = dot3(relativeVelocity, normal);
  const pair = materialPairs.resolve(local.material ?? local, other.material ?? other,
    Math.max(0, -normalVelocity));
  if (accumulator.targetNormalVelocity === undefined) {
    accumulator.targetNormalVelocity = normalVelocity < -restingRestitutionSpeed
      ? -(restitutionCoefficient ?? pair.restitution) * normalVelocity : 0.0;
  }
  let normalImpulseApplied = accumulator.normalLambda > EPSILON;
  let denominator = 0.0;
  let restitution = 0.0;
  let normalImpulseMagnitude = accumulator.normalLambda;
  let tangentSpeed = 0.0;
  let unrestricted = 0.0;
  let frictionLimit = 0.0;
  let frictionImpulseMagnitude = 0.0;
  let normalImpulseVector = null;
  let frictionImpulseVector = null;
  let impulseApplied = false;
  const angularBefore = traceEnabled ? clone3(local.angularVelocity) : null;
  const normalAngularDelta = [0.0, 0.0, 0.0];
  const frictionAngularDelta = [0.0, 0.0, 0.0];

  // local bodyとother bodyの角運動量を、指定方向の有効質量へ変換します
  // sleeping otherは速度更新を行わないCompute規則に合わせ、otherの寄与を分母から外します
  const getImpulseDenominator = (direction) => {
    const angularLocal = getAngularContribution(local, localArm, direction);
    let result = local.inverseMass + dot3(angularLocal, direction);
    if (other.sleeping !== true) {
      const angularOther = getAngularContribution(other, otherArm, direction);
      result += other.inverseMass + dot3(angularOther, direction);
    }
    return result;
  };

  // Compute版の初回接触で反発目標を作り、累積lambdaの増分だけをlocal bodyへ適用します
  // 後続反復での再評価は残留する接近速度だけに限定し、反発目標は初回反復へ固定します
  const solvePairImpulse = revisitBodyContactImpulses
    || accumulator.normalLambda <= EPSILON;
  if (solvePairImpulse && normalVelocity < 0.0) {
    denominator = getImpulseDenominator(normal);
    if (denominator > DENOMINATOR_EPSILON) {
      restitution = restitutionCoefficient ?? pair.restitution;
      const targetNormalVelocity = iteration === 0
        ? accumulator.targetNormalVelocity
        : 0.0;
      const deltaLambda = -(normalVelocity - targetNormalVelocity) / denominator;
      const previousLambda = accumulator.normalLambda;
      const nextLambda = Math.max(previousLambda + deltaLambda, 0.0);
      const appliedLambda = nextLambda - previousLambda;
      accumulator.normalLambda = nextLambda;
      normalImpulseMagnitude = nextLambda;
      normalImpulseApplied = nextLambda > EPSILON;
      if (Math.abs(appliedLambda) > impulseApplicationEpsilon) {
        const impulse = scale3(normal, appliedLambda);
        normalImpulseVector = traceEnabled ? clone3(impulse) : null;
        applyImpulsePair(impulse);
        const angularDelta = getAngularContribution(local, localArm, impulse);
        normalAngularDelta[0] = -angularDelta[0];
        normalAngularDelta[1] = -angularDelta[1];
        normalAngularDelta[2] = -angularDelta[2];
        impulseApplied = true;
      }
    }
  }

  // 法線lambdaがある接触だけで摩擦を解き、二方向のlambdaを摩擦円へ投影します
  // 法線力積がある接触へ摩擦を加え、離れたpairの接線速度をそのまま保持します
  if (solvePairImpulse && accumulator.normalLambda > EPSILON) {
    const basis = tangentBasis ?? buildContactTangents(normal, normalize);
    const postRelativeVelocity = getRelativeVelocity(local, other, localArm, otherArm);
    const normalComponent = dot3(postRelativeVelocity, normal);
    const tangentVelocity = sub3(
      postRelativeVelocity,
      scale3(normal, normalComponent)
    );
    tangentSpeed = length3(tangentVelocity);
    if (tangentSpeed > EPSILON || accumulator.tangentLambdaA !== 0 || accumulator.tangentLambdaB !== 0) {
      const directions = [basis[0], basis[1]];
      const tangentSpeeds = directions.map((direction) => (
        dot3(postRelativeVelocity, direction)
      ));
      const tangentDenominators = directions.map((direction) => (
        getImpulseDenominator(direction)
      ));
      const deltas = tangentDenominators.map((value, index) => (
        value > DENOMINATOR_EPSILON
          ? -tangentSpeeds[index] / value
          : 0.0
      ));
      const requestedA = accumulator.tangentLambdaA + deltas[0];
      const requestedB = accumulator.tangentLambdaB + deltas[1];
      const requestedLength = Math.hypot(requestedA, requestedB);
      const staticLimit = accumulator.normalLambda * (frictionCoefficient ?? pair.staticFriction);
      frictionLimit = requestedLength <= staticLimit ? staticLimit
        : accumulator.normalLambda * (frictionCoefficient ?? pair.dynamicFriction);
      const tangentScale = requestedLength > frictionLimit && requestedLength > EPSILON
        ? frictionLimit / requestedLength
        : 1.0;
      const nextA = requestedA * tangentScale;
      const nextB = requestedB * tangentScale;
      const appliedA = nextA - accumulator.tangentLambdaA;
      const appliedB = nextB - accumulator.tangentLambdaB;
      accumulator.tangentLambdaA = nextA;
      accumulator.tangentLambdaB = nextB;
      unrestricted = Math.hypot(deltas[0], deltas[1]);
      const frictionImpulse = add3(
        scale3(basis[0], appliedA),
        scale3(basis[1], appliedB)
      );
      frictionImpulseMagnitude = length3(frictionImpulse);
      frictionImpulseVector = traceEnabled ? clone3(frictionImpulse) : null;
      if (Math.abs(appliedA) > impulseApplicationEpsilon
          || Math.abs(appliedB) > impulseApplicationEpsilon) {
        applyImpulsePair(frictionImpulse);
        const angularDelta = getAngularContribution(local, localArm, frictionImpulse);
        frictionAngularDelta[0] = -angularDelta[0];
        frictionAngularDelta[1] = -angularDelta[1];
        frictionAngularDelta[2] = -angularDelta[2];
        impulseApplied = true;
      }
    }
  }

  if (solvePairImpulse) solvePhysicsRollingResistance({ normal,
    normalLambda: accumulator.normalLambda, length: pair.rollingResistanceLength, accumulator,
    local, other, getAngularVelocity, applyInverseInertia, applyAngularImpulse,
    applyToOther: typeof applyImpulseToOther === "function" });
  const residualVelocity = getRelativeVelocity(local, other, localArm, otherArm);
  const positionInverseMassLocal = local.positionInverseMass ?? local.inverseMass;
  const positionInverseMassOther = other.positionInverseMass ?? other.inverseMass;
  const positionInverseMassSum = positionInverseMassLocal + positionInverseMassOther;
  const correctionScale = positionInverseMassSum > DENOMINATOR_EPSILON
    ? positionInverseMassLocal / positionInverseMassSum
    : 0.0;
  const correctionMagnitude = Math.max(
    penetration - positionCorrectionSlop,
    0.0
  ) * positionCorrectionBeta;
  const signedCorrection = correctionMagnitude * correctionScale;
  if (signedCorrection > 0.0) {
    local.position[0] += normal[0] * signedCorrection * localSign;
    local.position[1] += normal[1] * signedCorrection * localSign;
    local.position[2] += normal[2] * signedCorrection * localSign;
  }
  if (correctionMagnitude > 0.0
      && typeof applyPositionCorrectionToOther === "function"
      && positionInverseMassOther > DENOMINATOR_EPSILON) {
    const otherCorrectionScale = correctionMagnitude
      * positionInverseMassOther
      / positionInverseMassSum;
    applyPositionCorrectionToOther(other, normal, otherCorrectionScale, -localSign);
  }

  return {
    support: normal[1] < -0.5,
    normalImpulseApplied,
    impulseApplied,
    normalVelocity,
    contactSpeed: normalImpulseApplied && iteration + 1 >= solverIterations
      ? length3(residualVelocity)
      : 0.0,
    normalSpeed: normalImpulseApplied && iteration + 1 >= solverIterations
      ? Math.abs(dot3(residualVelocity, normal))
      : 0.0,
    positionCorrection: signedCorrection,
    impulseAudit: traceEnabled && normalImpulseApplied
      ? {
        normal: clone3(normal),
        point: clone3(point),
        r: clone3(localArm),
        normalImpulseVector,
        frictionImpulseVector,
        normalVelocity,
        denominator,
        normalImpulse: normalImpulseMagnitude,
        restitution,
        tangentSpeed,
        unrestricted,
        frictionLimit,
        frictionImpulse: frictionImpulseMagnitude,
        angularBefore,
        angularAfter: clone3(local.angularVelocity),
        normalAngularDelta,
        frictionAngularDelta,
        angularDelta: sub3(local.angularVelocity, angularBefore)
      }
      : null
  };
}
