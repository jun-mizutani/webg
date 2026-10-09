// ---------------------------------------------
// CpuPhysicsSolver.js  2026/09/15
//   CPU state update, broadphase, contact solving, and sleep support for PhysicsSpace
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import { getPhysicsContactPairKind, PHYSICS_CONTACT_PAIR_KIND } from "./PhysicsContactDispatcher.js";
import { solvePhysicsContactImpulse } from "./PhysicsContactImpulseSolver.js";
import util from "./util.js";

// bodyの衝突解決に使う質量寄与を返し、sleep中・static・kinematicを押し戻し対象から外します
export function getSolverInverseMass(space, body) {
  if (!body?.isDynamic?.()) {
    return 0.0;
  }
  if (body.getSleeping?.() === true) {
    return 0.0;
  }
  return body.getInverseMass();
}

// body の衝突解決に使う逆慣性を返す
// sleeping 中、static、kinematic、fixedRotation は角速度を変えないため 0 とする
export function getSolverInverseInertia(space, body) {
  if (!body?.isDynamic?.() || body.getSleeping?.() === true || body.getFixedRotation?.() === true) {
    return [0.0, 0.0, 0.0];
  }
  return body.getInverseInertia?.() ?? [0.0, 0.0, 0.0];
}

// 接触点での速度 v + omega x r を返す
export function getContactPointVelocity(space, state, r) {
  return space._addVec3(
    state.velocity,
    space._crossVec3(space._degVec3ToRad(state.angularVelocity), r)
  );
}

// kinematicの接触面速度を接触法線へ直交する成分だけへ限定します
// quasiStaticの通常速度は0のまま、摩擦計算の相対接線速度だけを変更します
function getSurfaceContactVelocity(space, contactState, normal) {
  const surfaceVelocity = contactState?.body?.getSurfaceVelocity?.()
    ?? contactState?.surfaceVelocity
    ?? [0.0, 0.0, 0.0];
  if (!Array.isArray(surfaceVelocity) || contactState?.body?.isKinematic?.() !== true) {
    return [0.0, 0.0, 0.0];
  }
  const normalComponent = space._dotVec3(surfaceVelocity, normal);
  return [
    surfaceVelocity[0] - normal[0] * normalComponent,
    surfaceVelocity[1] - normal[1] * normalComponent,
    surfaceVelocity[2] - normal[2] * normalComponent
  ];
}

// 通常速度にkinematic接触面の搬送速度だけを加えた接触点速度を返します
function getEffectiveContactPointVelocity(space, contactState, arm, normal) {
  const baseVelocity = getContactPointVelocity(space, {
    velocity: contactState.linearVelocity,
    angularVelocity: contactState.angularVelocity
  }, arm);
  return space._addVec3(
    baseVelocity,
    getSurfaceContactVelocity(space, contactState, normal)
  );
}

// impulse が接触点へ働くときの有効質量分母を返す
export function getImpulseDenominator(space, bodyA, stateA, rA, bodyB, stateB, rB, direction, invMassA, invMassB) {
  const angularA = space._crossVec3(
    space._applyWorldInverseInertia(bodyA, stateA.quat, space._crossVec3(rA, direction)),
    rA
  );
  const angularB = space._crossVec3(
    space._applyWorldInverseInertia(bodyB, stateB.quat, space._crossVec3(rB, direction)),
    rB
  );
  return invMassA + invMassB
    + space._dotVec3(direction, angularA)
    + space._dotVec3(direction, angularB);
}

// impulse を線形速度と角速度へ反映する
export function applyContactImpulse(space, body, state, r, impulse, sign, invMass) {
  if (invMass <= 0.0) {
    return;
  }
  state.velocity[0] += impulse[0] * sign * invMass;
  state.velocity[1] += impulse[1] * sign * invMass;
  state.velocity[2] += impulse[2] * sign * invMass;
  if (body?.getFixedRotation?.() === true) {
    return;
  }
  const angularImpulse = space._crossVec3(r, impulse);
  const angularDeltaRad = space._applyWorldInverseInertia(body, state.quat, angularImpulse);
  const angularDeltaDeg = space._radVec3ToDeg(angularDeltaRad);
  state.angularVelocity[0] += angularDeltaDeg[0] * sign;
  state.angularVelocity[1] += angularDeltaDeg[1] * sign;
  state.angularVelocity[2] += angularDeltaDeg[2] * sign;
}

// sleeping dynamic body が active body と接触した場合に起こす
export function getManifoldMaxPenetration(space, manifold) {
  if (!manifold || !Array.isArray(manifold.contacts)) {
    return 0.0;
  }
  let maxPenetration = 0.0;
  for (let i = 0; i < manifold.contacts.length; i++) {
    maxPenetration = Math.max(
      maxPenetration,
      util.readOptionalFiniteNumber(
        manifold.contacts[i]?.penetration,
        "PhysicsSpace manifold contact penetration",
        0.0
      )
    );
  }
  return maxPenetration;
}

// `_getManifoldCenterPoint`は受け取った値を処理し、後続処理で利用する状態または結果を生成する
export function getManifoldCenterPoint(space, manifold) {
  if (!manifold || !Array.isArray(manifold.contacts) || manifold.contacts.length <= 0) {
    return null;
  }
  const center = [0.0, 0.0, 0.0];
  let count = 0;
  for (let i = 0; i < manifold.contacts.length; i++) {
    if (!Array.isArray(manifold.contacts[i]?.point)) {
      continue;
    }
    center[0] += manifold.contacts[i].point[0];
    center[1] += manifold.contacts[i].point[1];
    center[2] += manifold.contacts[i].point[2];
    count += 1;
  }
  if (count <= 0) {
    return null;
  }
  center[0] /= count;
  center[1] /= count;
  center[2] /= count;
  return center;
}

// `_wakeSleepingBodyForContact`は衝突状態を評価し、位置、速度、接触情報を更新する
export function wakeSleepingBodyForContact(space, sleepingBody, otherBody, stateMap = null, manifold = null) {
  if (!sleepingBody?.isDynamic?.() || sleepingBody.getSleeping?.() !== true) {
    return false;
  }
  if (otherBody?.isDynamic?.() === true && otherBody.getSleeping?.() !== true) {
    const sleepingState = stateMap?.get?.(sleepingBody) ?? null;
    const otherState = stateMap?.get?.(otherBody) ?? null;
    const centerPoint = space._getManifoldCenterPoint(manifold);
    if (sleepingState && otherState && Array.isArray(centerPoint)) {
      const sleepingVelocity = space._getContactPointVelocity(
        sleepingState,
        space._subVec3(centerPoint, sleepingState.position)
      );
      const otherVelocity = space._getContactPointVelocity(
        otherState,
        space._subVec3(centerPoint, otherState.position)
      );
      const relativeVelocity = space._subVec3(otherVelocity, sleepingVelocity);
      const wakeLinearThreshold = Math.max(space.sleepLinearThreshold * 1.25, 0.20);
      if (space._lengthVec3(relativeVelocity) <= wakeLinearThreshold) {
        return false;
      }
    } else if (otherState) {
      const linearSpeed = space._lengthVec3(otherState.velocity);
      const angularSpeed = space._lengthVec3(otherState.angularVelocity);
      const wakeLinearThreshold = Math.max(space.sleepLinearThreshold * 1.25, 0.20);
      const wakeAngularThreshold = Math.max(space.sleepAngularThreshold * 1.25, 4.0);
      if (linearSpeed <= wakeLinearThreshold
          && angularSpeed <= wakeAngularThreshold) {
        return false;
      }
    }
    sleepingBody.wakeUp?.();
    if (sleepingState) {
      sleepingState.sleeping = false;
    }
    space._resetSleepStepCount(sleepingBody);
    return true;
  }
  if (otherBody?.isKinematic?.() === true) {
    sleepingBody.wakeUp?.();
    const stateAfterWake = stateMap?.get?.(sleepingBody);
    if (stateAfterWake) {
      stateAfterWake.sleeping = false;
    }
    space._resetSleepStepCount(sleepingBody);
    return true;
  }
  return false;
}

// 現在の body transform から query 用 state を作る
export function getComputeBoxSweptAabb(space, body, collider, state) {
  const currentAabb = collider.getAabb?.(state.position, state.quat) ?? null;
  if (currentAabb === null) {
    return null;
  }
  if (!(space._computeBoxSourceStateMap instanceof Map)
      || collider.type !== "box") {
    return currentAabb;
  }
  const sourceState = space._computeBoxSourceStateMap.get(body);
  if (!sourceState) {
    throw new Error("PhysicsSpace Compute Box source state is missing for broadphase");
  }
  const sourceAabb = collider.getAabb(sourceState.position, sourceState.quat);
  return {
    min: [
      Math.min(sourceAabb.min[0], currentAabb.min[0]),
      Math.min(sourceAabb.min[1], currentAabb.min[1]),
      Math.min(sourceAabb.min[2], currentAabb.min[2])
    ],
    max: [
      Math.max(sourceAabb.max[0], currentAabb.max[0]),
      Math.max(sourceAabb.max[1], currentAabb.max[1]),
      Math.max(sourceAabb.max[2], currentAabb.max[2])
    ]
  };
}

// broadphase の前段として、step 中の stateMap から collider entry 一覧を作る
// ここではまだ「接触しているか」は見ず、broadphase 候補の材料だけを並べる
export function collectStepColliderEntries(space, stateMap) {
  const entries = [];
  for (let i = 0; i < space.bodies.length; i++) {
    const body = space.bodies[i];
    const collider = body?.getCollider?.();
    if (!collider) {
      continue;
    }
    const state = stateMap.get(body);
    const kind = collider.getBroadphaseKind?.();
    if (typeof kind !== "string" || kind.length === 0) {
      continue;
    }
    entries.push({
      body,
      collider,
      position: [...state.position],
      quat: state.quat,
      aabb: space._getComputeBoxSweptAabb(body, collider, state)
    });
  }
  return entries;
}

// AABB を持つ collider 同士は broadphase 段階で粗く除外する
// plane のように AABB を持たない collider は無限・特殊形状として候補を残す
export function canAabbBroadphaseOverlap(space, entryA, entryB) {
  if (entryA.aabb === null || entryB.aabb === null) {
    return true;
  }
  return space._intersectAabb(
    entryA.aabb.min,
    entryA.aabb.max,
    entryB.aabb.min,
    entryB.aabb.max
  );
}

// Compute版のswept AABBへbroadphase paddingを加えて、近接pairの候補落ちを防ぐ
// paddingはnarrow phaseのpenetrationやpositionへ使わず、接触成立条件を維持します
export function canComputeBoxBroadphaseOverlap(space, entryA, entryB) {
  if (entryA.aabb === null || entryB.aabb === null) {
    return true;
  }
  const padding = space.computeBoxBroadphasePadding;
  return entryA.aabb.min[0] <= entryB.aabb.max[0] + padding
    && entryA.aabb.max[0] + padding >= entryB.aabb.min[0]
    && entryA.aabb.min[1] <= entryB.aabb.max[1] + padding
    && entryA.aabb.max[1] + padding >= entryB.aabb.min[1]
    && entryA.aabb.min[2] <= entryB.aabb.max[2] + padding
    && entryA.aabb.max[2] + padding >= entryB.aabb.min[2];
}

// Boxの外部積分後stateを作り、sleep bodyの次step接触を先に調べます
// 実際のstepFixed()と同じ重力・force・torque・減衰・姿勢積分を使い、予測stateだけを作ります
export function buildComputeBoxPredictedState(space, body, dtSec) {
  const collider = body?.getCollider?.();
  if (collider?.type !== "box") {
    throw new Error("PhysicsSpace Compute Box predicted state requires a Box collider");
  }
  const position = body.getPosition();
  const force = body.getForce();
  const velocity = body.getLinearVelocity();
  const predictedVelocity = [...velocity];
  predictedVelocity[0] += (
    space.gravity[0] * body.getGravityScale()
    + force[0] * body.getInverseMass()
  ) * dtSec;
  predictedVelocity[1] += (
    space.gravity[1] * body.getGravityScale()
    + force[1] * body.getInverseMass()
  ) * dtSec;
  predictedVelocity[2] += (
    space.gravity[2] * body.getGravityScale()
    + force[2] * body.getInverseMass()
  ) * dtSec;

  const predictedAngularVelocity = body.getAngularVelocity();
  if (body.getFixedRotation?.() === true) {
    predictedAngularVelocity[0] = 0.0;
    predictedAngularVelocity[1] = 0.0;
    predictedAngularVelocity[2] = 0.0;
  } else {
    const torque = body.getTorque();
    const angularAccelerationRad = space._applyWorldInverseInertia(
      body,
      body.getQuat(),
      torque
    );
    const angularAccelerationDeg = space._radVec3ToDeg(angularAccelerationRad);
    predictedAngularVelocity[0] += angularAccelerationDeg[0] * dtSec;
    predictedAngularVelocity[1] += angularAccelerationDeg[1] * dtSec;
    predictedAngularVelocity[2] += angularAccelerationDeg[2] * dtSec;
  }

  const linearDampingScale = Math.exp(-body.getLinearDamping() * dtSec);
  predictedVelocity[0] *= linearDampingScale;
  predictedVelocity[1] *= linearDampingScale;
  predictedVelocity[2] *= linearDampingScale;
  const angularDampingScale = Math.exp(-body.getAngularDamping() * dtSec);
  predictedAngularVelocity[0] *= angularDampingScale;
  predictedAngularVelocity[1] *= angularDampingScale;
  predictedAngularVelocity[2] *= angularDampingScale;

  const predictedPosition = [
    position[0] + predictedVelocity[0] * dtSec,
    position[1] + predictedVelocity[1] * dtSec,
    position[2] + predictedVelocity[2] * dtSec
  ];
  const predictedOrientation = space._buildComputeStepQuat(
    body.getQuat(),
    predictedAngularVelocity,
    dtSec
  );
  return {
    position: predictedPosition,
    velocity: predictedVelocity,
    quat: predictedOrientation,
    angularVelocity: predictedAngularVelocity
  };
}

// active Boxとsleep Boxについて、現在は離れて次stepで接触するかを調べます
// 継続接触やAABBの重なりだけではwakeせず、接触法線へ向かう相対速度を返します
export function buildComputeBoxPredictedWakeContact(space, activeBody, sleepingBody, predictedState) {
  const activeCollider = activeBody?.getCollider?.();
  const sleepingCollider = sleepingBody?.getCollider?.();
  if (activeCollider?.type !== "box" || sleepingCollider?.type !== "box") {
    return null;
  }
  const currentManifold = space._buildManifold(
    {
      body: activeBody,
      collider: activeCollider,
      position: activeBody.getPosition(),
      quat: activeBody.getQuat()
    },
    {
      body: sleepingBody,
      collider: sleepingCollider,
      position: sleepingBody.getPosition(),
      quat: sleepingBody.getQuat()
    }
  );
  if (currentManifold !== null) {
    return null;
  }
  const predictedManifold = space._buildManifold(
    {
      body: activeBody,
      collider: activeCollider,
      position: [...predictedState.position],
      quat: predictedState.quat
    },
    {
      body: sleepingBody,
      collider: sleepingCollider,
      position: sleepingBody.getPosition(),
      quat: sleepingBody.getQuat()
    }
  );
  if (!predictedManifold || !Array.isArray(predictedManifold.contacts)
      || predictedManifold.contacts.length <= 0) {
    return null;
  }
  const point = predictedManifold.contacts[0]?.point;
  if (!Array.isArray(point) || point.length !== 3) {
    throw new Error("PhysicsSpace Compute Box predicted contact point is missing");
  }
  const activeVelocity = space._getContactPointVelocity(
    predictedState,
    space._subVec3(point, predictedState.position)
  );
  const sleepingVelocity = space._getContactPointVelocity(
    {
      velocity: sleepingBody.getLinearVelocity(),
      angularVelocity: sleepingBody.getAngularVelocity()
    },
    space._subVec3(point, sleepingBody.getPosition())
  );
  const relativeVelocity = space._subVec3(sleepingVelocity, activeVelocity);
  return {
    normalVelocity: space._dotVec3(relativeVelocity, predictedManifold.normal)
  };
}

// active Boxのswept AABBと新規接触を調べ、対象sleep Boxだけをfixed step前にwakeします
// wake後のbodyはlocal invocationへ渡しますが、他bodyへの入力はstep開始snapshotのまま固定します
export function wakePredictedComputeBoxBodies(space, dtSec) {
  const sleepingBodies = space.bodies.filter((body) => (
    body?.isDynamic?.() === true
    && body.getSleeping?.() === true
    && body.getCollider?.()?.type === "box"
  ));
  const activeBodies = space.bodies.filter((body) => (
    body?.isDynamic?.() === true
    && body.getSleeping?.() !== true
    && body.getCollider?.()?.type === "box"
  ));
  const activeSweptAabbs = new Map();
  for (const activeBody of activeBodies) {
    const linearSpeed = space._lengthVec3(activeBody.getLinearVelocity());
    const angularSpeed = space._lengthVec3(activeBody.getAngularVelocity());
    if (linearSpeed < space.wakeLinearSpeed && angularSpeed < space.wakeAngularSpeed) {
      continue;
    }
    const predictedState = space._buildComputeBoxPredictedState(activeBody, dtSec);
    const collider = activeBody.getCollider();
    const position = activeBody.getPosition();
    const orientation = activeBody.getQuat();
    const currentAabb = collider.getAabb(position, orientation);
    const predictedAabb = collider.getAabb(
      predictedState.position,
      predictedState.quat
    );
    activeSweptAabbs.set(activeBody, {
      aabb: {
        min: [
          Math.min(currentAabb.min[0], predictedAabb.min[0]),
          Math.min(currentAabb.min[1], predictedAabb.min[1]),
          Math.min(currentAabb.min[2], predictedAabb.min[2])
        ],
        max: [
          Math.max(currentAabb.max[0], predictedAabb.max[0]),
          Math.max(currentAabb.max[1], predictedAabb.max[1]),
          Math.max(currentAabb.max[2], predictedAabb.max[2])
        ]
      },
      state: predictedState
    });
  }

  const wakeIds = [];
  const wakeOtherMap = new Map();
  const padding = space.computeBoxBroadphasePadding;
  for (const sleepingBody of sleepingBodies) {
    const sleepingCollider = sleepingBody.getCollider();
    const sleepingAabb = sleepingCollider.getAabb(
      sleepingBody.getPosition(),
      sleepingBody.getQuat()
    );
    const expandedMin = [
      sleepingAabb.min[0] - padding,
      sleepingAabb.min[1] - padding,
      sleepingAabb.min[2] - padding
    ];
    const expandedMax = [
      sleepingAabb.max[0] + padding,
      sleepingAabb.max[1] + padding,
      sleepingAabb.max[2] + padding
    ];
    for (const [activeBody, swept] of activeSweptAabbs.entries()) {
      if (activeBody.canCollideWith?.(sleepingBody) !== true) {
        continue;
      }
      if (!space._intersectAabb(swept.aabb.min, swept.aabb.max, expandedMin, expandedMax)) {
        continue;
      }
      const wakeContact = space._buildComputeBoxPredictedWakeContact(
        activeBody,
        sleepingBody,
        swept.state
      );
      if (wakeContact === null || wakeContact.normalVelocity > -space.wakeLinearSpeed) {
        continue;
      }
      sleepingBody.wakeUp();
      space._resetSleepStepCount(sleepingBody);
      wakeIds.push(space._getBodyId(sleepingBody));
      wakeOtherMap.set(sleepingBody, activeBody);
      break;
    }
  }
  space.lastPredictedWakeBodyIds = wakeIds;
  space.predictedWakeOtherMap = wakeOtherMap;
  return wakeIds;
}

// fixed stepの外部積分後AABBから、Compute方式のBox local invocation候補を一度だけ作る
// solver反復のたびに全bodyを再走査せず、実績済みCompute版のcandidate再利用に合わせる
export function buildComputeBoxCandidateMap(space, entries) {
  if (!Array.isArray(entries)) {
    throw new Error("PhysicsSpace Compute Box candidate entries must be an array");
  }
  const entryByBody = new Map(entries.map((entry) => [entry.body, entry]));
  const indexByBody = new Map(space.bodies.map((body, index) => [body, index]));
  const candidates = new Map();
  for (const entry of entries) {
    if (entry.collider?.type !== "box" || entry.body.isDynamic?.() !== true) {
      continue;
    }
    const bodyCandidates = [];
    for (const otherEntry of entries) {
      if (otherEntry.body === entry.body) {
        continue;
      }
      const otherType = otherEntry.collider?.type;
      const isBox = otherType === "box";
      const isStaticPlane = otherType === "plane" && otherEntry.body.isStatic?.() === true;
      if (!isBox && !isStaticPlane) {
        continue;
      }
      if (isBox && !space._canComputeBoxBroadphaseOverlap(entry, otherEntry)) {
        continue;
      }
      if (!entryByBody.has(otherEntry.body)) {
        throw new Error("PhysicsSpace Compute Box candidate body entry is missing");
      }
      const otherIndex = indexByBody.get(otherEntry.body);
      if (otherIndex === undefined) {
        throw new Error("PhysicsSpace Compute Box candidate body index is missing");
      }
      bodyCandidates.push({ body: otherEntry.body, index: otherIndex });
    }
    // 実績済みCompute solverはbody pairを全て解いた後にPlaneを走査します
    // Plane Nodeがsceneへ先に登録されても、CPU coreの接触処理順をComputeの順番へ合わせます
    bodyCandidates.sort((first, second) => {
      const firstIsPlane = first.body.getCollider?.()?.type === "plane";
      const secondIsPlane = second.body.getCollider?.()?.type === "plane";
      return Number(firstIsPlane) - Number(secondIsPlane);
    });
    candidates.set(entry.body, bodyCandidates);
  }
  return candidates;
}

// broadphase pair を、layer / AABB / collider dispatch の順に確認して追加する
export function pushBroadphasePairIfAllowed(space, pairs, entryA, entryB) {
  if (entryA.body?.canCollideWith?.(entryB.body) !== true) {
    return;
  }
  if (space._isJointCollisionSuppressed(entryA.body, entryB.body)) {
    return;
  }
  if (!space._canAabbBroadphaseOverlap(entryA, entryB)) {
    return;
  }
  if (entryA.collider.canBroadphasePairWith?.(entryB.collider) === true) {
    pairs.push({ entryA, entryB });
    return;
  }
  if (entryB.collider.canBroadphasePairWith?.(entryA.collider) === true) {
    pairs.push({
      entryA: entryB,
      entryB: entryA
    });
  }
}

// 全組み合わせを確認する broadphase
export function collectBruteForceBroadphasePairs(space, entries) {
  const pairs = [];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      space._pushBroadphasePairIfAllowed(pairs, entries[i], entries[j]);
    }
  }
  return pairs;
}

// AABB を持つ finite collider 同士を x 軸 sweep-and-prune で候補化する
export function collectSweepAabbBroadphasePairs(space, entries) {
  const pairs = [];
  const finiteEntries = [];
  const specialEntries = [];
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].aabb === null) {
      specialEntries.push(entries[i]);
    } else {
      finiteEntries.push(entries[i]);
    }
  }

  finiteEntries.sort((entryA, entryB) => entryA.aabb.min[0] - entryB.aabb.min[0]);
  const activeEntries = [];
  for (let i = 0; i < finiteEntries.length; i++) {
    const entryB = finiteEntries[i];
    for (let j = activeEntries.length - 1; j >= 0; j--) {
      if (activeEntries[j].aabb.max[0] < entryB.aabb.min[0]) {
        activeEntries.splice(j, 1);
      }
    }
    for (let j = 0; j < activeEntries.length; j++) {
      space._pushBroadphasePairIfAllowed(pairs, activeEntries[j], entryB);
    }
    activeEntries.push(entryB);
  }

  for (let i = 0; i < specialEntries.length; i++) {
    for (let j = i + 1; j < specialEntries.length; j++) {
      space._pushBroadphasePairIfAllowed(pairs, specialEntries[i], specialEntries[j]);
    }
    for (let j = 0; j < finiteEntries.length; j++) {
      space._pushBroadphasePairIfAllowed(pairs, specialEntries[i], finiteEntries[j]);
    }
  }
  return pairs;
}

// broadphase 候補を列挙する
export function collectBroadphasePairs(space, entries) {
  if (space.broadphaseMode === "bruteForce") {
    return space._collectBruteForceBroadphasePairs(entries);
  }
  return space._collectSweepAabbBroadphasePairs(entries);
}

// narrowphase の一部として、候補 pair を collider 側の dispatch へ渡す
// shape pairごとの接触式とmanifold整形はPhysicsContactDispatcherへ委譲する
export function getRestitution(space, body) {
  return getContactMaterial(space, body).restitution;
}

function getContactMaterial(space, body) {
  return space.materialPairs.material(body?.getPhysicsMaterial?.() ?? {}, body?.getPhysicsMaterialId?.());
}

function contactAngularOptions(space) {
  return {
    getAngularVelocity: state => space._degVec3ToRad(state.angularVelocity),
    applyInverseInertia: (state, impulse) => state.inverseMass > 0
      ? space._applyWorldInverseInertia(state.body, state.physicsState.quat, impulse) : [0, 0, 0],
    applyAngularImpulse: (state, impulse) => {
      if (state.inverseMass <= 0 || state.sleeping === true) return;
      const delta = space._radVec3ToDeg(space._applyWorldInverseInertia(state.body, state.physicsState.quat, impulse));
      for (let axis = 0; axis < 3; axis++) state.angularVelocity[axis] += delta[axis];
    }
  };
}

// material.friction を読み、未指定なら physics space 既定値を使う
export function getFriction(space, body) {
  return getContactMaterial(space, body).dynamicFriction;
}

// manifold 全体の押し戻しを、最深 penetration を基準に 1 回だけ行う
export function resolveManifoldPosition(space, manifold, stateMap) {
  const invMassA = space._getSolverInverseMass(manifold.bodyA);
  const invMassB = space._getSolverInverseMass(manifold.bodyB);
  const invMassSum = invMassA + invMassB;
  if (invMassSum <= 0.0) {
    return;
  }
  let maxPenetration = 0.0;
  for (let i = 0; i < manifold.contacts.length; i++) {
    if (manifold.contacts[i].penetration > maxPenetration) {
      maxPenetration = manifold.contacts[i].penetration;
    }
  }
  if (maxPenetration <= 0.0) {
    return;
  }
  const stateA = stateMap.get(manifold.bodyA);
  const stateB = stateMap.get(manifold.bodyB);
  // 1 frame で penetration を完全に解消しようとすると、stack では押し戻しが強すぎて
  // 微振動や wake を増やしやすい
  // ここでは slop を引いた残りに Baumgarte 係数を掛けて、数 frame に分散して戻す
  const correctionPenetration = Math.max(0.0, maxPenetration - space.positionCorrectionSlop);
  if (correctionPenetration <= 0.0) {
    return;
  }
  const correctionScale = correctionPenetration
    * space.positionCorrectionBeta
    / invMassSum;
  if (invMassA > 0.0) {
    stateA.position[0] -= manifold.normal[0] * correctionScale * invMassA;
    stateA.position[1] -= manifold.normal[1] * correctionScale * invMassA;
    stateA.position[2] -= manifold.normal[2] * correctionScale * invMassA;
  }
  if (invMassB > 0.0) {
    stateB.position[0] += manifold.normal[0] * correctionScale * invMassB;
    stateB.position[1] += manifold.normal[1] * correctionScale * invMassB;
    stateB.position[2] += manifold.normal[2] * correctionScale * invMassB;
  }
}

// 前フレームの cached impulse を現在 state へ先に与える
export function applyWarmStartToContactPoint(space, manifold, contactPoint, stateMap) {
  const normalImpulse = contactPoint.normalImpulse ?? 0.0;
  const tangentImpulse = Array.isArray(contactPoint.tangentImpulse)
    ? contactPoint.tangentImpulse
    : [0.0, 0.0, 0.0];
  if (normalImpulse <= 0.0
      && Math.abs(tangentImpulse[0]) <= 1.0e-8
      && Math.abs(tangentImpulse[1]) <= 1.0e-8
      && Math.abs(tangentImpulse[2]) <= 1.0e-8) {
    return;
  }
  const stateA = stateMap.get(manifold.bodyA);
  const stateB = stateMap.get(manifold.bodyB);
  const invMassA = space._getSolverInverseMass(manifold.bodyA);
  const invMassB = space._getSolverInverseMass(manifold.bodyB);
  if (invMassA + invMassB <= 0.0) {
    return;
  }
  const point = Array.isArray(contactPoint.point)
    ? contactPoint.point
    : [
      (stateA.position[0] + stateB.position[0]) * 0.5,
      (stateA.position[1] + stateB.position[1]) * 0.5,
      (stateA.position[2] + stateB.position[2]) * 0.5
    ];
  const rA = space._subVec3(point, stateA.position);
  const rB = space._subVec3(point, stateB.position);
  const impulse = [
    manifold.normal[0] * normalImpulse + tangentImpulse[0],
    manifold.normal[1] * normalImpulse + tangentImpulse[1],
    manifold.normal[2] * normalImpulse + tangentImpulse[2]
  ];
  space._applyContactImpulse(manifold.bodyA, stateA, rA, impulse, -1.0, invMassA);
  space._applyContactImpulse(manifold.bodyB, stateB, rB, impulse, 1.0, invMassB);
}

// manifold に保存された shared tangent impulse を先に適用する
export function applyWarmStartToSharedManifold(space, manifold, stateMap) {
  const sharedTangentImpulse = Array.isArray(manifold?.sharedTangentImpulse)
    ? manifold.sharedTangentImpulse
    : manifold?.supportTangentImpulse;
  if (!Array.isArray(sharedTangentImpulse)) {
    return;
  }
  if (Math.abs(sharedTangentImpulse[0]) <= 1.0e-8
      && Math.abs(sharedTangentImpulse[1]) <= 1.0e-8
      && Math.abs(sharedTangentImpulse[2]) <= 1.0e-8) {
    return;
  }
  space._applySharedManifoldImpulse(manifold, stateMap, sharedTangentImpulse);
}

// manifold 群へ warm start を適用する
export function applyWarmStartToManifolds(space, manifolds, stateMap) {
  for (let i = 0; i < manifolds.length; i++) {
    if (space._isComputeBoxContact(manifolds[i])) {
      continue;
    }
    space._applyWarmStartToSharedManifold(manifolds[i], stateMap);
    for (let j = 0; j < manifolds[i].contacts.length; j++) {
      space._applyWarmStartToContactPoint(manifolds[i], manifolds[i].contacts[j], stateMap);
    }
  }
}

// 接触法線に直交する 2 本の接線基底を返す
export function buildContactTangents(space, normal, relativeVelocity) {
  const normalVelocity = space._dotVec3(relativeVelocity, normal);
  const tangent = [
    relativeVelocity[0] - normal[0] * normalVelocity,
    relativeVelocity[1] - normal[1] * normalVelocity,
    relativeVelocity[2] - normal[2] * normalVelocity
  ];
  let tangentA = null;
  const tangentLength = space._lengthVec3(tangent);
  if (tangentLength > 1.0e-8) {
    tangentA = [
      tangent[0] / tangentLength,
      tangent[1] / tangentLength,
      tangent[2] / tangentLength
    ];
  } else {
    // 静止接触では relativeVelocity 由来の接線が消えることがあるため、
    // normal と十分に平行でない world axis から直交接線を必ず組み立てる
    const fallbackAxis = Math.abs(normal[1]) < 0.95
      ? [0.0, 1.0, 0.0]
      : [1.0, 0.0, 0.0];
    tangentA = space._crossVec3(fallbackAxis, normal);
    if (space._lengthVec3(tangentA) <= 1.0e-8) {
      tangentA = space._crossVec3([0.0, 0.0, 1.0], normal);
    }
    tangentA = space._normalizeVec3(tangentA, "PhysicsSpace tangentA");
  }
  const tangentB = space._normalizeVec3(
    space._crossVec3(normal, tangentA),
    "PhysicsSpace tangentB"
  );
  return { tangentA, tangentB };
}

// Compute版Box接触で使う法線だけから決まる2本の接線基底を返す
// relative velocityへ依存させず、同じnormalならbodyの処理順と速度状態に関係なく同じ摩擦軸を使う
export function buildComputeContactTangents(space, normal) {
  const seed = Math.abs(normal[0]) > 0.5
    ? [0.0, 1.0, 0.0]
    : [1.0, 0.0, 0.0];
  const tangentA = space._normalizeVec3(
    space._crossVec3(normal, seed),
    "PhysicsSpace Compute contact tangentA"
  );
  const tangentB = space._normalizeVec3(
    space._crossVec3(normal, tangentA),
    "PhysicsSpace Compute contact tangentB"
  );
  return { tangentA, tangentB };
}

// Box同士またはPlaneとBoxの接触をCompute版の局所力積式で解く対象か判定する
// これはsolverを選ぶ機能ではなく、通常の形状ペアdispatchで接触式を選ぶための判定です
export function isComputeBoxContact(space, manifold) {
  const typeA = manifold?.bodyA?.getCollider?.()?.type;
  const typeB = manifold?.bodyB?.getCollider?.()?.type;
  const pairKind = getPhysicsContactPairKind(typeA, typeB);
  return pairKind === PHYSICS_CONTACT_PAIR_KIND.BOX_BOX
    || pairKind === PHYSICS_CONTACT_PAIR_KIND.PLANE_BOX;
}

// Planeを含まない一般shape pairをCompute版body contact式へ渡す対象か判定します
// Box/Boxは専用の候補処理、Plane/shapeはPlane専用処理へ先に分岐するため、ここでは対象外です
export function isComputeBodyContact(space, manifold) {
  if (!manifold || isComputeBoxContact(space, manifold)) {
    return false;
  }
  const typeA = manifold.bodyA?.getCollider?.()?.type;
  const typeB = manifold.bodyB?.getCollider?.()?.type;
  return typeA !== "plane" && typeB !== "plane";
}

// 静止PlaneとSphereまたはCapsuleの接触をCompute版Plane処理へ渡す対象か判定します
// Box接触と同じくsolverを曖昧に切り替えず、形状pairとPlaneのstatic条件で処理を固定します
export function isComputePlaneShapeContact(space, manifold) {
  const typeA = manifold?.bodyA?.getCollider?.()?.type;
  const typeB = manifold?.bodyB?.getCollider?.()?.type;
  const planeBody = typeA === "plane"
    ? manifold.bodyA
    : typeB === "plane"
      ? manifold.bodyB
      : null;
  const shapeType = planeBody === manifold?.bodyA ? typeB : typeA;
  return planeBody?.isStatic?.() === true
    && (shapeType === "sphere" || shapeType === "capsule");
}

// shared PhysicsContactImpulseSolverへPhysicsSpaceのbody stateと単位変換を渡します
// CoreのangularVelocityはdegree単位ですが、接触の角運動量計算はradian単位で行うため、
// contact point velocityと逆慣性寄与をcallbackで変換し、共通solverの式をそのまま使います
// optionsで相手bodyへの反作用、反発、摩擦、再評価条件を指定でき、Boxと一般bodyで同じ式を使います
export function resolveComputeContactPoint(
  space,
  manifold,
  contactPoint,
  stateMap,
  iteration,
  localBody,
  options = {}
) {
  const bodyA = manifold.bodyA;
  const bodyB = manifold.bodyB;
  if (localBody !== bodyA && localBody !== bodyB) {
    throw new Error("PhysicsSpace Compute Box local body is not part of manifold");
  }
  const stateA = stateMap.get(bodyA);
  const stateB = stateMap.get(bodyB);
  const invMassA = space._getSolverInverseMass(bodyA);
  const invMassB = space._getSolverInverseMass(bodyB);
  const inverseMassSum = invMassA + invMassB;
  if (!stateA || !stateB || inverseMassSum <= 1.0e-7) {
    contactPoint.normalImpulse = 0.0;
    contactPoint.tangentImpulse = [0.0, 0.0, 0.0];
    return;
  }

  const localState = stateMap.get(localBody);
  const otherBody = localBody === bodyA ? bodyB : bodyA;
  const otherState = stateMap.get(otherBody);
  const localInvMass = localBody === bodyA ? invMassA : invMassB;
  const otherInvMass = localBody === bodyA ? invMassB : invMassA;
  const coupled = options.coupled === true;
  if (!localState || !otherState) {
    throw new Error("PhysicsSpace Compute Box local state is missing");
  }

  // manifoldの法線とA/B相対速度を共通solverへ渡し、既存Compute経路の符号規則を保持します
  // Plane-BoxでBoxがmanifoldのB側になる場合はlocalSignと相対速度の向きをそろえます
  const normal = [...manifold.normal];
  const localSign = localBody === bodyA ? -1.0 : 1.0;
  // 共通solverの相対速度は通常local bodyからother bodyへ向かう順序で計算します
  // local bodyがmanifoldのB側になるPlane-Boxでは、法線がAからBを向くため相対速度も反転します
  const relativeVelocitySign = localBody === bodyA ? 1.0 : -1.0;
  const localContactState = {
    position: localState.position,
    material: getContactMaterial(space, localBody),
    linearVelocity: localState.velocity,
    angularVelocity: localState.angularVelocity,
    inverseMass: localInvMass,
    positionInverseMass: localInvMass,
    restitution: options.restitutionCoefficient ?? space._getRestitution(localBody),
    friction: options.frictionCoefficient ?? space._getFriction(localBody),
    // state.sleepingは予測wake bodyをlocal invocationのawake状態として表します
    // Nodeのsleep flagは予測wake入口で先に変わるため、ここで直接参照するとsnapshot分離を失います
    sleeping: localState.sleeping === true,
    body: localBody,
    physicsState: localState
  };
  const otherContactState = {
    position: otherState.position,
    material: getContactMaterial(space, otherBody),
    linearVelocity: otherState.velocity,
    angularVelocity: otherState.angularVelocity,
    inverseMass: otherInvMass,
    // position correctionではsleep中dynamic bodyの質量も分配比へ残します
    positionInverseMass: coupled
      ? otherInvMass
      : otherBody.isDynamic?.() === true
        ? otherBody.getInverseMass()
        : 0.0,
    restitution: options.restitutionCoefficient ?? space._getRestitution(otherBody),
    friction: options.frictionCoefficient ?? space._getFriction(otherBody),
    // otherはsource snapshotから受け取ったsleep状態を使い、local bodyの現在状態と分けて扱います
    sleeping: otherState.sleeping === true,
    body: otherBody,
    physicsState: otherState
  };
  const accumulator = {
    targetNormalVelocity: contactPoint.targetNormalVelocity,
    rollingLambda: contactPoint.rollingLambda,
    normalLambda: contactPoint.normalImpulse ?? 0.0,
    tangentLambdaA: contactPoint.computeTangentLambdaA ?? 0.0,
    tangentLambdaB: contactPoint.computeTangentLambdaB ?? 0.0
  };
  const point = Array.isArray(contactPoint.point)
    ? contactPoint.point
    : [
      (stateA.position[0] + stateB.position[0]) * 0.5,
      (stateA.position[1] + stateB.position[1]) * 0.5,
      (stateA.position[2] + stateB.position[2]) * 0.5
    ];
  const basis = space._buildComputeContactTangents(normal);
  const contactResult = solvePhysicsContactImpulse({
    ...contactAngularOptions(space),
    local: localContactState,
    materialPairs: space.materialPairs,
    other: otherContactState,
    normal,
    point,
    penetration: contactPoint.penetration,
    iteration,
    solverIterations: space.solverIterations,
    restingRestitutionSpeed: space.restingRestitutionSpeed,
    // 実績済みCompute solverと同じ設定を明示し、
    // 必要な場合だけ同じ接触の法線lambdaを後続反復でも再評価します
    revisitBodyContactImpulses: options.revisitBodyContactImpulses
      ?? (options.coupled === true ? space.revisitBodyContactImpulses : false),
    restitutionCoefficient: options.restitutionCoefficient,
    frictionCoefficient: options.frictionCoefficient,
    accumulator,
    positionCorrectionSlop: space.positionCorrectionSlop,
    positionCorrectionBeta: options.positionCorrectionBeta ?? space.positionCorrectionBeta,
    tangentBasis: [basis.tangentA, basis.tangentB],
    localSign,
    impulseApplicationEpsilon: 1.0e-7,
    getContactPointVelocity: (state, arm) => space._getContactPointVelocity({
      velocity: state.linearVelocity,
      angularVelocity: state.angularVelocity
    }, arm),
    getRelativeVelocity: (localState, otherState, localArm, otherArm) => {
      const relativeVelocity = space._subVec3(
        getEffectiveContactPointVelocity(space, otherState, otherArm, normal),
        getEffectiveContactPointVelocity(space, localState, localArm, normal)
      );
      return relativeVelocitySign === 1.0
        ? relativeVelocity
        : space._scaleVec3(relativeVelocity, -1.0);
    },
    getAngularContribution: (state, arm, direction) => space._crossVec3(
      space._applyWorldInverseInertia(
        state.body,
        state.physicsState.quat,
        space._crossVec3(arm, direction)
      ),
      arm
    ),
    applyImpulse: (state, arm, impulse, sign) => space._applyContactImpulse(
      state.body,
      state.physicsState,
      arm,
      impulse,
      sign,
      state.inverseMass
    ),
    ...(coupled
      ? {
        applyImpulseToOther: (state, arm, impulse, sign) => space._applyContactImpulse(
          state.body,
          state.physicsState,
          arm,
          impulse,
          sign,
          state.inverseMass
        ),
        applyPositionCorrectionToOther: (state, direction, amount, sign) => {
          state.physicsState.position[0] += direction[0] * amount * sign;
          state.physicsState.position[1] += direction[1] * amount * sign;
          state.physicsState.position[2] += direction[2] * amount * sign;
        }
      }
      : {})
  });
  contactPoint.rollingLambda = accumulator.rollingLambda;
  contactPoint.targetNormalVelocity = accumulator.targetNormalVelocity;
  contactPoint.normalImpulse = accumulator.normalLambda;
  contactPoint.computeTangentLambdaA = accumulator.tangentLambdaA;
  contactPoint.computeTangentLambdaB = accumulator.tangentLambdaB;
  contactPoint.tangentImpulse = [
    basis.tangentA[0] * accumulator.tangentLambdaA + basis.tangentB[0] * accumulator.tangentLambdaB,
    basis.tangentA[1] * accumulator.tangentLambdaA + basis.tangentB[1] * accumulator.tangentLambdaB,
    basis.tangentA[2] * accumulator.tangentLambdaA + basis.tangentB[2] * accumulator.tangentLambdaB
  ];
  return contactResult;
}

// Box/BoxまたはPlane/BoxへCompute版の接触式を適用します
// 既存のBox候補処理から呼び出す入口を保ち、式の実体は一般bodyと共有します
export function resolveComputeBoxContactPoint(
  space,
  manifold,
  contactPoint,
  stateMap,
  iteration,
  localBody,
  options = {}
) {
  return resolveComputeContactPoint(
    space,
    manifold,
    contactPoint,
    stateMap,
    iteration,
    localBody,
    options
  );
}

// Sphere/Capsule/Boxを含む一般body pairへCompute版body contact式を適用します
// CPUでは同じfixed stepのstateMapへ両bodyを反映し、Sphereの力積を次のBox反復へ返します
// Compute版body pairと同じく、反発はbody materialの大きい値、摩擦は幾何平均を使います
export function resolveComputeBodyContactPoint(
  space,
  manifold,
  contactPoint,
  stateMap,
  iteration
) {
  if (!Array.isArray(contactPoint?.point) || contactPoint.point.length !== 3) {
    throw new Error("PhysicsSpace Compute body contact point must be a vec3");
  }
  return resolveComputeContactPoint(
    space,
    manifold,
    contactPoint,
    stateMap,
    iteration,
    manifold.bodyA,
    {
      coupled: true,
      revisitBodyContactImpulses: true
    }
  );
}

// 静止PlaneとSphereまたはCapsuleの接触をCompute版Plane solverと同じ共有impulse式で解きます
// Planeは動かさず、shape側の最低点接触、反発しきい値、法線・摩擦lambdaの増分だけを更新します
export function resolveComputePlaneContactPoint(
  space,
  manifold,
  contactPoint,
  stateMap,
  iteration,
  accumulator
) {
  const bodyA = manifold.bodyA;
  const bodyB = manifold.bodyB;
  const typeA = bodyA?.getCollider?.()?.type;
  const typeB = bodyB?.getCollider?.()?.type;
  const planeBody = typeA === "plane"
    ? bodyA
    : typeB === "plane"
      ? bodyB
      : null;
  const dynamicBody = planeBody === bodyA ? bodyB : bodyA;
  if (planeBody === null
      || planeBody.isStatic?.() !== true
      || (dynamicBody?.getCollider?.()?.type !== "sphere"
        && dynamicBody?.getCollider?.()?.type !== "capsule")) {
    throw new Error("PhysicsSpace Compute Plane contact requires static Plane and Sphere or Capsule");
  }
  if (!accumulator || typeof accumulator !== "object") {
    throw new Error("PhysicsSpace Compute Plane contact accumulator is required");
  }
  const planeState = stateMap.get(planeBody);
  const dynamicState = stateMap.get(dynamicBody);
  if (!planeState || !dynamicState) {
    throw new Error("PhysicsSpace Compute Plane contact state is missing");
  }
  const dynamicInverseMass = space._getSolverInverseMass(dynamicBody);
  if (dynamicInverseMass <= 1.0e-7) {
    accumulator.normalLambda = 0.0;
    accumulator.tangentLambdaA = 0.0;
    accumulator.tangentLambdaB = 0.0;
    contactPoint.normalImpulse = 0.0;
    contactPoint.computeTangentLambdaA = 0.0;
    contactPoint.computeTangentLambdaB = 0.0;
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

  // Compute版Plane solverと同じく、manifoldのPlane法線とshape側の最低点を接触点として使います
  // PlaneColliderはbodyAをPlane、bodyBをshapeへ正規化するため、shapeへの力積符号は常に正方向です
  const normal = [...manifold.normal];
  if (!Array.isArray(contactPoint.point) || contactPoint.point.length !== 3) {
    throw new Error("PhysicsSpace Compute Plane contact point must be a vec3");
  }
  const point = contactPoint.point;
  const localContactState = {
    position: dynamicState.position,
    material: getContactMaterial(space, dynamicBody),
    linearVelocity: dynamicState.velocity,
    angularVelocity: dynamicState.angularVelocity,
    inverseMass: dynamicInverseMass,
    positionInverseMass: dynamicInverseMass,
    restitution: space._getRestitution(dynamicBody),
    friction: space._getFriction(dynamicBody),
    sleeping: dynamicState.sleeping === true,
    body: dynamicBody,
    physicsState: dynamicState
  };
  const planeContactState = {
    position: planeState.position,
    material: getContactMaterial(space, planeBody),
    linearVelocity: planeState.velocity,
    angularVelocity: planeState.angularVelocity,
    inverseMass: 0.0,
    positionInverseMass: 0.0,
    restitution: space._getRestitution(planeBody),
    friction: space._getFriction(planeBody),
    sleeping: true,
    body: planeBody,
    physicsState: planeState
  };
  const basis = space._buildComputeContactTangents(normal);
  const contactResult = solvePhysicsContactImpulse({
    local: localContactState,
    other: planeContactState,
    ...contactAngularOptions(space),
    normal,
    point,
    penetration: contactPoint.penetration,
    iteration,
    solverIterations: space.solverIterations,
    restingRestitutionSpeed: space.restingRestitutionSpeed,
    materialPairs: space.materialPairs,
    // Compute版Planeは同じPlane接触を全反復で再評価するため、CPUでも常に再評価します
    revisitBodyContactImpulses: true,
    accumulator,
    positionCorrectionSlop: space.positionCorrectionSlop,
    positionCorrectionBeta: space.positionCorrectionBeta,
    tangentBasis: [basis.tangentA, basis.tangentB],
    localSign: 1.0,
    impulseApplicationEpsilon: 1.0e-7,
    getContactPointVelocity: (state, arm) => space._getContactPointVelocity({
      velocity: state.linearVelocity,
      angularVelocity: state.angularVelocity
    }, arm),
    getRelativeVelocity: () => space._subVec3(
      space._getContactPointVelocity(dynamicState, space._subVec3(point, dynamicState.position)),
      space._getContactPointVelocity(planeState, space._subVec3(point, planeState.position))
    ),
    getAngularContribution: (state, arm, direction) => space._crossVec3(
      space._applyWorldInverseInertia(
        state.body,
        state.physicsState.quat,
        space._crossVec3(arm, direction)
      ),
      arm
    ),
    applyImpulse: (state, arm, impulse, sign) => space._applyContactImpulse(
      state.body,
      state.physicsState,
      arm,
      impulse,
      sign,
      state.inverseMass
    )
  });
  contactPoint.rollingLambda = accumulator.rollingLambda;
  contactPoint.targetNormalVelocity = accumulator.targetNormalVelocity;
  contactPoint.normalImpulse = accumulator.normalLambda;
  contactPoint.computeTangentLambdaA = accumulator.tangentLambdaA;
  contactPoint.computeTangentLambdaB = accumulator.tangentLambdaB;
  contactPoint.tangentImpulse = [
    basis.tangentA[0] * accumulator.tangentLambdaA + basis.tangentB[0] * accumulator.tangentLambdaB,
    basis.tangentA[1] * accumulator.tangentLambdaA + basis.tangentB[1] * accumulator.tangentLambdaB,
    basis.tangentA[2] * accumulator.tangentLambdaA + basis.tangentB[2] * accumulator.tangentLambdaB
  ];
  if (space._isSupportNormal(normal)) {
    dynamicState.touchedStatic = true;
  }
  return contactResult;
}

// local bodyと相手bodyの向きで一つの累積lambda領域を取得する
// Compute invocationごとに別のaccumulatorを持つため、A側の更新をB側へ共有しない
export function getComputeBoxImpulseAccumulator(space, localBody, otherBody) {
  if (!(space._computeBoxImpulseAccumulators instanceof Map)) {
    throw new Error("PhysicsSpace Compute Box accumulator is not active");
  }
  let bodyAccumulators = space._computeBoxImpulseAccumulators.get(localBody);
  if (!bodyAccumulators) {
    bodyAccumulators = new Map();
    space._computeBoxImpulseAccumulators.set(localBody, bodyAccumulators);
  }
  let accumulator = bodyAccumulators.get(otherBody);
  if (!accumulator) {
    accumulator = { normalLambda: 0.0, tangentLambdaA: 0.0, tangentLambdaB: 0.0 };
    bodyAccumulators.set(otherBody, accumulator);
  }
  return accumulator;
}

// Compute版の一body一invocationに合わせ、local Boxの候補を登録順に解きます
// 相手bodyはstep開始snapshotから読み、local bodyだけのvelocityと仮想positionを更新します
// contactManifoldsにはpairごとに一度だけ診断用manifoldを追加し、逆向きinvocationを一件へまとめます
export function resolveComputeBoxBody(
  space,
  localBody,
  localIndex,
  stateMap,
  sourceStateMap,
  candidateMap,
  iteration,
  contactManifolds
) {
  if (localBody?.getCollider?.()?.type !== "box"
      || localBody.isDynamic?.() !== true) {
    return;
  }
  const localState = stateMap.get(localBody);
  if (!localState || localState.computeBoxActive !== true) {
    return;
  }
  const clearAccumulator = (otherBody) => {
    const accumulator = space._getComputeBoxImpulseAccumulator(localBody, otherBody);
    accumulator.normalLambda = 0.0;
    accumulator.tangentLambdaA = 0.0;
    accumulator.tangentLambdaB = 0.0;
  };
  const solveLocalContact = (localManifold, otherBody, otherState, recordManifold) => {
    if (!localManifold || !Array.isArray(localManifold.contacts)
        || localManifold.contacts.length <= 0) {
      clearAccumulator(otherBody);
      return;
    }
    if (space._isTriggerContact(localManifold)) {
      // trigger は接触情報だけを記録し、位置・速度・sleep条件へ影響を与えません
      if (recordManifold === true) {
        contactManifolds.push(localManifold);
      }
      clearAccumulator(otherBody);
      return;
    }
    const contactPoint = localManifold.contacts[0];
    const accumulator = space._getComputeBoxImpulseAccumulator(localBody, otherBody);
    contactPoint.rollingLambda = accumulator.rollingLambda;
    contactPoint.targetNormalVelocity = accumulator.targetNormalVelocity;
    contactPoint.normalImpulse = accumulator.normalLambda;
    contactPoint.computeTangentLambdaA = accumulator.tangentLambdaA;
    contactPoint.computeTangentLambdaB = accumulator.tangentLambdaB;
    const contactResult = space._resolveComputeBoxContactPoint(
      localManifold,
      contactPoint,
      new Map([
        [localBody, localState],
        [otherBody, otherState]
      ]),
      iteration,
      localBody
    );
    accumulator.rollingLambda = contactPoint.rollingLambda;
    accumulator.targetNormalVelocity = contactPoint.targetNormalVelocity;
    accumulator.normalLambda = contactPoint.normalImpulse ?? 0.0;
    accumulator.tangentLambdaA = contactPoint.computeTangentLambdaA ?? 0.0;
    accumulator.tangentLambdaB = contactPoint.computeTangentLambdaB ?? 0.0;
    const supportNormal = space._scaleVec3(localManifold.normal, -1.0);
    if (space._isSupportNormal(supportNormal)) {
      if (space._getSolverInverseMass(otherBody) <= 0.0) {
        localState.touchedStatic = true;
      } else {
        localState.touchedDynamicSupport = true;
      }
    }
    localState.computeBoxContactObserved = true;
    localState.computeBoxMaxContactSpeed = Math.max(
      localState.computeBoxMaxContactSpeed,
      contactResult?.contactSpeed ?? 0.0
    );
    localState.computeBoxMaxNormalSpeed = Math.max(
      localState.computeBoxMaxNormalSpeed,
      contactResult?.normalSpeed ?? 0.0
    );
    if (otherBody?.isDynamic?.() === true && otherState?.sleeping !== true) {
      localState.computeBoxActiveDynamicBodyContactObserved = true;
    }
    if (otherBody?.isDynamic?.() === true
        && space._isSupportNormal(supportNormal)) {
      localState.computeBoxBodyContactObserved = true;
    }
    if (otherBody?.isStatic?.() === true
        && otherBody.getCollider?.()?.type === "plane") {
      const supportCount = Number.isSafeInteger(localManifold.source?.supportCount)
        ? localManifold.source.supportCount
        : 1;
      if (Math.abs(supportNormal[1]) > 0.5) {
        localState.computeBoxFloorContactObserved = true;
        localState.computeBoxFloorSupportPoints = Math.min(
          localState.computeBoxFloorSupportPoints,
          supportCount
        );
      } else if (contactResult?.normalImpulseApplied === true) {
        localState.computeBoxWallSupportObserved = true;
      }
    }
    if (recordManifold === true) {
      contactManifolds.push(localManifold);
    }
  };

  const candidates = candidateMap.get(localBody);
  if (!Array.isArray(candidates)) {
    throw new Error("PhysicsSpace Compute Box local candidate list is missing");
  }
  for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
    const candidate = candidates[candidateIndex];
    const otherBody = candidate.body;
    const otherIndex = candidate.index;
    if (otherBody === localBody
        || otherBody?.canCollideWith?.(localBody) !== true
        || space._isJointCollisionSuppressed(localBody, otherBody)) {
      continue;
    }
    const otherCollider = otherBody?.getCollider?.();
    if (otherCollider?.type === "box") {
      const sourceOtherState = sourceStateMap.get(otherBody);
      if (!sourceOtherState) {
        throw new Error("PhysicsSpace Compute Box other source state is missing");
      }
      let otherStateForContact = sourceOtherState;
      const predictedWakeOther = space.predictedWakeOtherMap instanceof Map
        ? space.predictedWakeOtherMap.get(localBody)
        : null;
      if (localState.computeBoxWasPredictedWake === true
          && predictedWakeOther === otherBody) {
        const predictedState = space._computeBoxPredictedStateMap?.get(otherBody);
        if (!predictedState) {
          throw new Error("PhysicsSpace Compute Box predicted wake state is missing");
        }
        otherStateForContact = predictedState;
      }
      const localManifold = space._buildManifold(
        {
          body: localBody,
          collider: localBody.getCollider(),
          position: [...localState.position],
          quat: localState.quat
        },
        {
          body: otherBody,
          collider: otherCollider,
          position: [...otherStateForContact.position],
          quat: otherStateForContact.quat
        }
      );
      solveLocalContact(
        localManifold,
        otherBody,
        otherStateForContact,
        localIndex < otherIndex
      );
      continue;
    }
    if (otherCollider?.type !== "plane" || otherBody.isStatic?.() !== true) {
      continue;
    }
    const planeState = sourceStateMap.get(otherBody);
    if (!planeState) {
      throw new Error("PhysicsSpace Compute Plane source state is missing");
    }
    const localManifold = space._buildManifold(
      {
        body: otherBody,
        collider: otherCollider,
        position: [...planeState.position],
        quat: planeState.quat
      },
      {
        body: localBody,
        collider: localBody.getCollider(),
        position: [...localState.position],
        quat: localState.quat
      }
    );
    solveLocalContact(localManifold, otherBody, planeState, true);
  }
}

// 実際に penetration を持っている接点数を返す
export function countPenetratingContacts(space, manifold, threshold = 1.0e-4) {
  if (!Array.isArray(manifold?.contacts)) {
    return 0;
  }
  let count = 0;
  for (let i = 0; i < manifold.contacts.length; i++) {
    if ((manifold.contacts[i]?.penetration ?? 0.0) > threshold) {
      count += 1;
    }
  }
  return count;
}

// manifold 1 点ぶんの impulse を解く
export function resolveContactPoint(space, manifold, contactPoint, stateMap, options = {}) {
  if (space._isTriggerContact(manifold)) return;
  const result = resolveComputeContactPoint(space, manifold, contactPoint, stateMap,
    options.iteration ?? 0, manifold.bodyA, {
      coupled: true, revisitBodyContactImpulses: true,
      restitutionCoefficient: options.restitutionOverride,
      positionCorrectionBeta: 0
    });
  markSleepSupportFromContacts(space, stateMap, [manifold]);
  return result;
}

// manifold 複数接点の高速衝突では、反発だけを代表点 1 個で先に解く
// face-face の対称衝突で各接点が独立に restitution を解くと、
// 線形反発が過小になりやすいため、まず中心点で法線反発を決める
export function resolveImpactCenter(space, manifold, stateMap) {
  if (!manifold || !Array.isArray(manifold.contacts) || manifold.contacts.length <= 1) {
    return false;
  }
  if (space._countPenetratingContacts(manifold) <= 1) {
    return false;
  }
  if (manifold.bodyA?.isDynamic?.() !== true || manifold.bodyB?.isDynamic?.() !== true) {
    return false;
  }
  const restitution = Math.max(
    space._getRestitution(manifold.bodyA),
    space._getRestitution(manifold.bodyB)
  );
  if (restitution <= 1.0e-6) {
    return false;
  }
  const stateA = stateMap.get(manifold.bodyA);
  const stateB = stateMap.get(manifold.bodyB);
  if (!stateA || !stateB) {
    return false;
  }
  const angularSpeedA = space._lengthVec3(stateA.angularVelocity);
  const angularSpeedB = space._lengthVec3(stateB.angularVelocity);
  // 代表 center impulse は、低角速度の linear face-face 衝突を
  // 1 点へ畳んで反発を与えるための補助
  // 回転を伴う接触までここで反発させると、多点 manifold 全体より
  // center impulse が支配して不自然な並進を作りやすい
  if (angularSpeedA > 8.0 || angularSpeedB > 8.0) {
    return false;
  }
  const centerPoint = [0.0, 0.0, 0.0];
  let penetrationSum = 0.0;
  for (let i = 0; i < manifold.contacts.length; i++) {
    const point = Array.isArray(manifold.contacts[i].point)
      ? manifold.contacts[i].point
      : stateA.position;
    centerPoint[0] += point[0];
    centerPoint[1] += point[1];
    centerPoint[2] += point[2];
    penetrationSum += manifold.contacts[i].penetration ?? 0.0;
  }
  centerPoint[0] /= manifold.contacts.length;
  centerPoint[1] /= manifold.contacts.length;
  centerPoint[2] /= manifold.contacts.length;
  const rA = space._subVec3(centerPoint, stateA.position);
  const rB = space._subVec3(centerPoint, stateB.position);
  const contactVelocityA = space._getContactPointVelocity(stateA, rA);
  const contactVelocityB = space._getContactPointVelocity(stateB, rB);
  const relativeVelocity = space._subVec3(contactVelocityB, contactVelocityA);
  const velocityAlongNormal = space._dotVec3(relativeVelocity, manifold.normal);
  if (velocityAlongNormal >= -0.5) {
    return false;
  }
  const linearRelativeVelocity = space._subVec3(stateB.velocity, stateA.velocity);
  const linearVelocityAlongNormal = space._dotVec3(linearRelativeVelocity, manifold.normal);
  // manifold 中心の代表反発は、並進としてぶつかった正面衝突のための補助
  // 回転接触までここで反発させると、接触点全体よりも center impulse が支配して
  // 不自然な横滑りを作りやすい
  if (Math.abs(linearVelocityAlongNormal) <= 0.5
      || Math.abs(linearVelocityAlongNormal) < Math.abs(velocityAlongNormal) * 0.5) {
    return false;
  }
  space._resolveContactPoint(
    manifold,
    {
      featureKey: "impact-center",
      penetration: penetrationSum / manifold.contacts.length,
      point: centerPoint
    },
    stateMap
  );
  return true;
}

// manifold 中心点へ shared impulse を適用する
export function applySharedManifoldImpulse(space, manifold, stateMap, impulse) {
  if (!manifold || !Array.isArray(manifold.contacts) || manifold.contacts.length <= 0) {
    return false;
  }
  const bodyA = manifold.bodyA;
  const bodyB = manifold.bodyB;
  const stateA = stateMap.get(bodyA);
  const stateB = stateMap.get(bodyB);
  if (!stateA || !stateB) {
    return false;
  }
  const invMassA = space._getSolverInverseMass(bodyA);
  const invMassB = space._getSolverInverseMass(bodyB);
  if (invMassA + invMassB <= 0.0) {
    return false;
  }
  const centerPoint = [0.0, 0.0, 0.0];
  for (let i = 0; i < manifold.contacts.length; i++) {
    const point = Array.isArray(manifold.contacts[i].point)
      ? manifold.contacts[i].point
      : stateA.position;
    centerPoint[0] += point[0];
    centerPoint[1] += point[1];
    centerPoint[2] += point[2];
  }
  centerPoint[0] /= manifold.contacts.length;
  centerPoint[1] /= manifold.contacts.length;
  centerPoint[2] /= manifold.contacts.length;
  const rA = space._subVec3(centerPoint, stateA.position);
  const rB = space._subVec3(centerPoint, stateB.position);
  space._applyContactImpulse(
    bodyA,
    stateA,
    rA,
    impulse,
    -1.0,
    invMassA
  );
  space._applyContactImpulse(
    bodyB,
    stateB,
    rB,
    impulse,
    1.0,
    invMassB
  );
  return true;
}

// 多点接触している manifold では、
// 各接点の動摩擦だけでは横滑りが残りやすいため、
// manifold 全体で共有する接線 impulse を追加して static friction を近似する
export function resolveSharedManifoldFriction(space, manifold, stateMap) {
  if (!manifold || !Array.isArray(manifold.contacts) || manifold.contacts.length <= 1) {
    return;
  }
  if (space._countPenetratingContacts(manifold) <= 1) {
    return;
  }
  const bodyA = manifold.bodyA;
  const bodyB = manifold.bodyB;
  const stateA = stateMap.get(bodyA);
  const stateB = stateMap.get(bodyB);
  if (!stateA || !stateB) {
    return;
  }
  const invMassA = space._getSolverInverseMass(bodyA);
  const invMassB = space._getSolverInverseMass(bodyB);
  if (invMassA + invMassB <= 0.0) {
    return;
  }

  let normalImpulseSum = 0.0;
  let tangentImpulseSum = space._lengthVec3(
    Array.isArray(manifold.sharedTangentImpulse)
      ? manifold.sharedTangentImpulse
      : (Array.isArray(manifold.supportTangentImpulse)
        ? manifold.supportTangentImpulse
        : [0.0, 0.0, 0.0])
  );
  const centerPoint = [0.0, 0.0, 0.0];
  for (let i = 0; i < manifold.contacts.length; i++) {
    const point = Array.isArray(manifold.contacts[i].point)
      ? manifold.contacts[i].point
      : stateA.position;
    centerPoint[0] += point[0];
    centerPoint[1] += point[1];
    centerPoint[2] += point[2];
    normalImpulseSum += Math.max(0.0, manifold.contacts[i].normalImpulse ?? 0.0);
    tangentImpulseSum += space._lengthVec3(
      Array.isArray(manifold.contacts[i].tangentImpulse)
        ? manifold.contacts[i].tangentImpulse
        : [0.0, 0.0, 0.0]
    );
  }
  centerPoint[0] /= manifold.contacts.length;
  centerPoint[1] /= manifold.contacts.length;
  centerPoint[2] /= manifold.contacts.length;
  const rA = space._subVec3(centerPoint, stateA.position);
  const rB = space._subVec3(centerPoint, stateB.position);
  const velocityA = space._getContactPointVelocity(stateA, rA);
  const velocityB = space._getContactPointVelocity(stateB, rB);
  const relativeVelocity = space._subVec3(velocityB, velocityA);
  const normalSpeed = space._dotVec3(relativeVelocity, manifold.normal);
  const tangentVelocity = space._subVec3(
    relativeVelocity,
    space._scaleVec3(manifold.normal, normalSpeed)
  );
  const tangentSpeed = space._lengthVec3(tangentVelocity);
  if (tangentSpeed <= 1.0e-4) {
    return;
  }
  const friction = Math.sqrt(
    space._getFriction(bodyA) * space._getFriction(bodyB)
  );
  const maxSupportImpulse = normalImpulseSum * friction * 1.35;
  const remainingImpulse = Math.max(0.0, maxSupportImpulse - tangentImpulseSum * 0.5);
  if (remainingImpulse <= 1.0e-6) {
    return;
  }
  const tangentDir = space._scaleVec3(tangentVelocity, 1.0 / tangentSpeed);
  const centerAxis = space._scaleVec3(tangentDir, -1.0);
  const denominator = space._getImpulseDenominator(
    bodyA,
    stateA,
    rA,
    bodyB,
    stateB,
    rB,
    centerAxis,
    invMassA,
    invMassB
  );
  if (denominator <= 1.0e-12) {
    return;
  }
  const desiredImpulse = tangentSpeed / denominator;
  const impulseMagnitude = Math.min(desiredImpulse, remainingImpulse);
  if (impulseMagnitude <= 1.0e-8) {
    return;
  }
  const impulse = space._scaleVec3(centerAxis, impulseMagnitude);
  const accumulated = Array.isArray(manifold.sharedTangentImpulse)
    ? manifold.sharedTangentImpulse
    : (Array.isArray(manifold.supportTangentImpulse)
      ? manifold.supportTangentImpulse
      : [0.0, 0.0, 0.0]);
  const nextImpulse = [
    accumulated[0] + impulse[0],
    accumulated[1] + impulse[1],
    accumulated[2] + impulse[2]
  ];
  const nextLength = space._lengthVec3(nextImpulse);
  let clampedImpulse = nextImpulse;
  if (nextLength > maxSupportImpulse && nextLength > 1.0e-8) {
    const scale = maxSupportImpulse / nextLength;
    clampedImpulse = [
      nextImpulse[0] * scale,
      nextImpulse[1] * scale,
      nextImpulse[2] * scale
    ];
  }
  const deltaImpulse = [
    clampedImpulse[0] - accumulated[0],
    clampedImpulse[1] - accumulated[1],
    clampedImpulse[2] - accumulated[2]
  ];
  if (!space._applySharedManifoldImpulse(manifold, stateMap, deltaImpulse)) {
    return;
  }
  manifold.sharedTangentImpulse = clampedImpulse;
  manifold.supportTangentImpulse = clampedImpulse;
}

// narrowphase が作った manifold を solver で解決する
// Compute版Box、Plane shape、一般body接触は各形状pairに対応したlambda処理へ分岐します
export function resolveManifold(space, manifold, stateMap, iteration = 0, options = {}) {
  if (!manifold || !Array.isArray(manifold.contacts) || manifold.contacts.length <= 0) {
    return;
  }
  if (space._isTriggerContact(manifold)) {
    return;
  }
  const computeBoxContact = space._isComputeBoxContact(manifold);
  if (computeBoxContact) {
    // Box-Box / Plane-BoxはstepFixedのbody invocationで既に解いています
    // ここでpair manifoldをもう一度解くと、Compute版にない二重力積になるため処理済みとして返します
    return;
  }
  if (space._isComputePlaneShapeContact(manifold)) {
    if (manifold.contacts.length !== 1) {
      throw new Error("PhysicsSpace Compute Plane Sphere/Capsule contact requires one contact point");
    }
    if (!(options.planeImpulseAccumulators instanceof Map)
        || !(options.activePlaneContactKeys instanceof Set)) {
      throw new Error("PhysicsSpace Compute Plane contact accumulators are not active");
    }
    const contactKey = space._getManifoldPairKey(manifold.bodyA, manifold.bodyB);
    options.activePlaneContactKeys.add(contactKey);
    let accumulator = options.planeImpulseAccumulators.get(contactKey);
    if (!accumulator) {
      accumulator = {
        normalLambda: 0.0,
        tangentLambdaA: 0.0,
        tangentLambdaB: 0.0
      };
      options.planeImpulseAccumulators.set(contactKey, accumulator);
    }
    const contactPoint = manifold.contacts[0];
    contactPoint.rollingLambda = accumulator.rollingLambda;
    contactPoint.targetNormalVelocity = accumulator.targetNormalVelocity;
    contactPoint.normalImpulse = accumulator.normalLambda;
    contactPoint.computeTangentLambdaA = accumulator.tangentLambdaA;
    contactPoint.computeTangentLambdaB = accumulator.tangentLambdaB;
    space._wakeSleepingBodyForContact(manifold.bodyA, manifold.bodyB, stateMap, manifold);
    space._wakeSleepingBodyForContact(manifold.bodyB, manifold.bodyA, stateMap, manifold);
    const contactResult = space._resolveComputePlaneContactPoint(
      manifold,
      contactPoint,
      stateMap,
      iteration,
      accumulator
    );
    accumulator.rollingLambda = contactPoint.rollingLambda;
    accumulator.targetNormalVelocity = contactPoint.targetNormalVelocity;
    accumulator.normalLambda = contactPoint.normalImpulse ?? 0.0;
    accumulator.tangentLambdaA = contactPoint.computeTangentLambdaA ?? 0.0;
    accumulator.tangentLambdaB = contactPoint.computeTangentLambdaB ?? 0.0;
    return contactResult;
  }
  if (space._isComputeBodyContact(manifold)) {
    if (manifold.contacts.length !== 1) {
      throw new Error("PhysicsSpace Compute body contact requires one contact point");
    }
    if (!(options.bodyImpulseAccumulators instanceof Map)
        || !(options.activeBodyContactKeys instanceof Set)) {
      throw new Error("PhysicsSpace Compute body contact accumulators are not active");
    }
    const contactPoint = manifold.contacts[0];
    const featureKey = typeof contactPoint.featureKey === "string"
      ? contactPoint.featureKey
      : "contact-0";
    const contactKey = `${space._getManifoldPairKey(manifold.bodyA, manifold.bodyB)}:${featureKey}`;
    options.activeBodyContactKeys.add(contactKey);
    let accumulator = options.bodyImpulseAccumulators.get(contactKey);
    if (!accumulator) {
      accumulator = {
        normalLambda: 0.0,
        tangentLambdaA: 0.0,
        tangentLambdaB: 0.0
      };
      options.bodyImpulseAccumulators.set(contactKey, accumulator);
    }
    contactPoint.rollingLambda = accumulator.rollingLambda;
    contactPoint.targetNormalVelocity = accumulator.targetNormalVelocity;
    contactPoint.normalImpulse = accumulator.normalLambda;
    contactPoint.computeTangentLambdaA = accumulator.tangentLambdaA;
    contactPoint.computeTangentLambdaB = accumulator.tangentLambdaB;
    space._wakeSleepingBodyForContact(manifold.bodyA, manifold.bodyB, stateMap, manifold);
    space._wakeSleepingBodyForContact(manifold.bodyB, manifold.bodyA, stateMap, manifold);
    const contactResult = space._resolveComputeBodyContactPoint(
      manifold,
      contactPoint,
      stateMap,
      iteration
    );
    accumulator.rollingLambda = contactPoint.rollingLambda;
    accumulator.targetNormalVelocity = contactPoint.targetNormalVelocity;
    accumulator.normalLambda = contactPoint.normalImpulse ?? 0.0;
    accumulator.tangentLambdaA = contactPoint.computeTangentLambdaA ?? 0.0;
    accumulator.tangentLambdaB = contactPoint.computeTangentLambdaB ?? 0.0;
    return contactResult;
  }
  space._wakeSleepingBodyForContact(manifold.bodyA, manifold.bodyB, stateMap, manifold);
  space._wakeSleepingBodyForContact(manifold.bodyB, manifold.bodyA, stateMap, manifold);
  space._resolveManifoldPosition(manifold, stateMap);
  const resolvedImpactCenter = space._resolveImpactCenter(manifold, stateMap);
  for (let i = 0; i < manifold.contacts.length; i++) {
    space._resolveContactPoint(
      manifold,
      manifold.contacts[i],
      stateMap,
      resolvedImpactCenter ? { restitutionOverride: 0.0 } : {}
    );
  }
  space._resolveSharedManifoldFriction(manifold, stateMap);

  // 静止 plane への zero-restitution 接触では、
  // manifold 解決後も残った下向き法線速度を打ち消して
  // 「跳ねずに支えられる」挙動を優先する
  if (Math.abs(manifold.normal[1]) >= 0.5
      && Math.max(space._getRestitution(manifold.bodyA), space._getRestitution(manifold.bodyB)) <= 1.0e-6) {
    let dynamicBody = null;
    let dynamicState = null;
    let supportNormal = null;
    if (manifold.bodyA?.isDynamic?.() === true && manifold.bodyB?.isStatic?.() === true) {
      dynamicBody = manifold.bodyA;
      dynamicState = stateMap.get(dynamicBody);
      supportNormal = space._scaleVec3(manifold.normal, -1.0);
    } else if (manifold.bodyB?.isDynamic?.() === true && manifold.bodyA?.isStatic?.() === true) {
      dynamicBody = manifold.bodyB;
      dynamicState = stateMap.get(dynamicBody);
      supportNormal = [...manifold.normal];
    }
    if (dynamicBody && dynamicState) {
      const normalSpeed = space._dotVec3(dynamicState.velocity, supportNormal);
      if (normalSpeed < 0.0) {
        dynamicState.velocity[0] -= supportNormal[0] * normalSpeed;
        dynamicState.velocity[1] -= supportNormal[1] * normalSpeed;
        dynamicState.velocity[2] -= supportNormal[2] * normalSpeed;
      }
    }
  }
}

// sleep 判定は「この step で法線 impulse を打ったか」ではなく、
// 最終的に support contact が存在するかで見る方が安定する
// 静止終盤では relative velocity がほぼ 0 になり、
// _resolveContactPoint 内の touched フラグ更新だけだと support を取りこぼしやすい
export function markSleepSupportFromContacts(space, stateMap, contacts) {
  if (!Array.isArray(contacts)) {
    return;
  }
  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i];
    if (space._isTriggerContact(contact)) {
      continue;
    }
    if (!Array.isArray(contact.normal)) {
      continue;
    }
    const supportNormal = space._isSupportNormal(contact.normal)
      ? contact.normal
      : space._isSupportNormal(space._scaleVec3(contact.normal, -1.0))
        ? space._scaleVec3(contact.normal, -1.0)
        : null;
    if (supportNormal === null) {
      continue;
    }
    const bodyA = contact.bodyA;
    const bodyB = contact.bodyB;
    const stateA = stateMap.get(bodyA);
    const stateB = stateMap.get(bodyB);
    const invMassA = space._getSolverInverseMass(bodyA);
    const invMassB = space._getSolverInverseMass(bodyB);
    if (invMassA > 0.0 && invMassB === 0.0 && stateA) {
      stateA.touchedStatic = true;
    }
    if (invMassB > 0.0 && invMassA === 0.0 && stateB) {
      stateB.touchedStatic = true;
    }
    if (invMassA > 0.0 && invMassB > 0.0) {
      if (stateA) {
        stateA.touchedDynamicSupport = true;
      }
      if (stateB) {
        stateB.touchedDynamicSupport = true;
      }
    }
  }
}
