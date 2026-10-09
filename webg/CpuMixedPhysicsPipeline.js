// ---------------------------------------------
//  CpuMixedPhysicsPipeline.js  2026/08/29
//   Coupled mixed-shape fixed-step execution for the CPU PhysicsSpace
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import util from "./util.js";

// PhysicsSpaceの現在Node状態から、一fixed stepで共有するmutable stateMapを作ります
// BoxとSphere・Capsuleを別solverへ分けず、全shapeの位置・姿勢・速度を同じMapで更新します
function createMixedStateMap(space) {
  const stateMap = new Map();
  for (const body of space.bodies) {
    const state = {
      position: space._cloneVec3(body.getPosition()),
      velocity: space._cloneVec3(body.getLinearVelocity()),
      quat: body.getQuat(),
      angularVelocity: space._cloneVec3(body.getAngularVelocity()),
      sleeping: body.getSleeping?.() === true,
      touchedStatic: false,
      touchedDynamicSupport: false
    };
    stateMap.set(body, state);
  }
  return stateMap;
}

// sleep中の接触結果とcontact eventを保持したまま、重い接触探索と反復solverを省略します
// 公開APIが毎fixed stepのstay eventを返す現在の挙動を維持するため、保存済みcontactからeventだけ再生成します
function buildSleepingMixedFastPathState(space) {
  const stateMap = createMixedStateMap(space);
  const currentContactMap = space._buildContactMap(space.lastContacts);
  space.lastContactEvents = space._buildContactEvents(currentContactMap);
  space._emitContactEvents(space.lastContactEvents);
  space.previousContactMap = currentContactMap;
  return stateMap;
}

// 一つのdynamic bodyへgravity、外力、減衰、姿勢積分を一度だけ適用します
// BoxもSphere・Capsuleも同じfixed stepの外部積分を通り、contact反復ではそのstateを再利用します
function integrateDynamicBody(space, body, state, dtSec) {
  if (!body.isDynamic() || state.sleeping === true) {
    return;
  }
  const force = body.getForce();
  const torque = body.getTorque();
  state.velocity[0] += (
    space.gravity[0] * body.getGravityScale()
    + force[0] * body.getInverseMass()
  ) * dtSec;
  state.velocity[1] += (
    space.gravity[1] * body.getGravityScale()
    + force[1] * body.getInverseMass()
  ) * dtSec;
  state.velocity[2] += (
    space.gravity[2] * body.getGravityScale()
    + force[2] * body.getInverseMass()
  ) * dtSec;

  if (body.getFixedRotation?.() !== true) {
    // torqueは線形質量ではなく慣性を通して角速度へ変換します
    const angularAccelerationRad = space._applyWorldInverseInertia(body, state.quat, torque);
    const angularAccelerationDeg = space._radVec3ToDeg(angularAccelerationRad);
    state.angularVelocity[0] += angularAccelerationDeg[0] * dtSec;
    state.angularVelocity[1] += angularAccelerationDeg[1] * dtSec;
    state.angularVelocity[2] += angularAccelerationDeg[2] * dtSec;
  } else {
    state.angularVelocity[0] = 0.0;
    state.angularVelocity[1] = 0.0;
    state.angularVelocity[2] = 0.0;
  }

  // fixed step幅に依存する過減衰を避けるため、既存CPU pathと同じ指数減衰を使います
  const linearDampingScale = Math.exp(-body.getLinearDamping() * dtSec);
  state.velocity[0] *= linearDampingScale;
  state.velocity[1] *= linearDampingScale;
  state.velocity[2] *= linearDampingScale;
  const angularDampingScale = Math.exp(-body.getAngularDamping() * dtSec);
  state.angularVelocity[0] *= angularDampingScale;
  state.angularVelocity[1] *= angularDampingScale;
  state.angularVelocity[2] *= angularDampingScale;

  state.position[0] += state.velocity[0] * dtSec;
  state.position[1] += state.velocity[1] * dtSec;
  state.position[2] += state.velocity[2] * dtSec;
    // 全形状へ有限回転Δq ⊗ qを適用し、接触点計算へ同じ姿勢更新結果を渡します
    // 形状ごとに積分式を分けると、Capsuleの端点や接触点がBoxと異なる姿勢で評価されます
  state.quat = space._buildComputeStepQuat(
    state.quat,
    state.angularVelocity,
    dtSec
  );
}

// 全dynamic bodyを一度だけ外部積分し、静的Planeとkinematic bodyは入力状態として残します
// contact solverの反復回数が増えてもgravityやdampingが複数回適用されないようにします
function integrateMixedBodies(space, stateMap, dtSec) {
  for (const body of space.bodies) {
    const state = stateMap.get(body);
    if (!state) {
      throw new Error("CpuMixedPhysicsPipeline body state is missing before integration");
    }
    integrateDynamicBody(space, body, state, dtSec);
  }
}

// contact pairとfeatureからfixed step内の累積lambdaを識別するkeyを作ります
// manifoldを反復ごとに再生成しても、同じ接触点のnormal・friction lambdaを継続できます
function getCoupledContactKey(space, manifold, contact, contactIndex) {
  const pairKey = space._getManifoldPairKey(manifold.bodyA, manifold.bodyB);
  const featureKey = typeof contact.featureKey === "string"
    ? contact.featureKey
    : `contact-${contactIndex}`;
  return `${pairKey}:${featureKey}`;
}

// Box/PlaneまたはBox/Boxの接触を同じstateMapの両bodyへ反映します
// Box-BoxはbodyAをlocal body、Plane-BoxはBox側をlocal bodyに選び、相手bodyへ反作用を返します
function resolveCoupledBoxManifold(
  space,
  manifold,
  stateMap,
  iteration,
  accumulators,
  activeContactKeys
) {
  if (space._isTriggerContact(manifold)) {
    return;
  }
  space._wakeSleepingBodyForContact(manifold.bodyA, manifold.bodyB, stateMap, manifold);
  space._wakeSleepingBodyForContact(manifold.bodyB, manifold.bodyA, stateMap, manifold);

  const localBody = manifold.bodyA.getCollider?.()?.type === "box"
    ? manifold.bodyA
    : manifold.bodyB;
  if (localBody?.getCollider?.()?.type !== "box") {
    throw new Error("CpuMixedPhysicsPipeline coupled Box manifold has no Box body");
  }
  for (let contactIndex = 0; contactIndex < manifold.contacts.length; contactIndex += 1) {
    const contact = manifold.contacts[contactIndex];
    const key = getCoupledContactKey(space, manifold, contact, contactIndex);
    activeContactKeys.add(key);
    let accumulator = accumulators.get(key);
    if (!accumulator) {
      accumulator = {
        normalLambda: 0.0,
        tangentLambdaA: 0.0,
        tangentLambdaB: 0.0
      };
      accumulators.set(key, accumulator);
    }
    contact.rollingLambda = accumulator.rollingLambda;
    contact.targetNormalVelocity = accumulator.targetNormalVelocity;
    contact.normalImpulse = accumulator.normalLambda;
    contact.computeTangentLambdaA = accumulator.tangentLambdaA;
    contact.computeTangentLambdaB = accumulator.tangentLambdaB;
    space._resolveComputeBoxContactPoint(
      manifold,
      contact,
      stateMap,
      iteration,
      localBody,
      { coupled: true }
    );
    accumulator.rollingLambda = contact.rollingLambda;
    accumulator.targetNormalVelocity = contact.targetNormalVelocity;
    accumulator.normalLambda = contact.normalImpulse ?? 0.0;
    accumulator.tangentLambdaA = contact.computeTangentLambdaA ?? 0.0;
    accumulator.tangentLambdaB = contact.computeTangentLambdaB ?? 0.0;
  }
}

// manifold群の最終反復から、公開contact配列へ一度だけ展開します
// 反復回数ぶんの同一pairを一件へまとめ、最終反復のpenetrationを公開します
function flattenFinalContacts(space, manifolds) {
  const contacts = [];
  for (const manifold of manifolds) {
    contacts.push(...space._flattenManifoldContacts(manifold));
  }
  return contacts;
}

// coupled solverの最終stateをPhysicsNodeへ同期し、sleep処理前のawake body一覧を返します
// state.sleepingを先に反映するため、sleep中bodyの次frame外力を初期化済み状態で管理します
function synchronizeCoupledBodies(space, stateMap) {
  const activeDynamicBodies = [];
  for (const body of space.bodies) {
    const state = stateMap.get(body);
    if (!state) {
      throw new Error("CpuMixedPhysicsPipeline body state is missing at synchronization");
    }
    body.clearAccumulators?.();
    if (!body.isDynamic()) {
      continue;
    }
    if (state.sleeping === true) {
      body.stopMotion();
      body.sleep();
      continue;
    }
    body.wakeUp();
    body.syncNodeFromPhysics(state.position, { quat: state.quat });
    body.setLinearVelocityVec(state.velocity);
    body.setAngularVelocityVec(state.angularVelocity);
    activeDynamicBodies.push(body);
  }
  return activeDynamicBodies;
}

// Box/Plane、Box/Box、Sphere/Capsuleを同じstateMapとsolver反復へ入れます
// Boxだけを先に一fixed step進める方式を使わず、Sphereの力積が次のBox反復へ戻る構成です
export function stepMixedPhysicsSpace(space, dtSec) {
  const numericDtSec = util.readFiniteNumber(dtSec, "PhysicsSpace mixed dtSec", {
    minExclusive: 0.0
  });
  if (!space.cpuBoxPhysicsAdapter.hasBoxBodies()) {
    throw new Error("CpuMixedPhysicsPipeline requires at least one Box body");
  }

  space._wakeEnabledJointBodies();
  space._wakePredictedComputeBoxBodies(numericDtSec);
  const dynamicBodies = space.bodies.filter((body) => body.isDynamic?.() === true);
  if (space._canUseSpaceSleepingFastPath(dynamicBodies)) {
    return buildSleepingMixedFastPathState(space);
  }
  const jointXpbdPreStepTransformMap = space.solveJointsInStep === true
    ? space._createJointXpbdPreStepTransformMap()
    : null;
  const stateMap = createMixedStateMap(space);
  integrateMixedBodies(space, stateMap, numericDtSec);
  const coupledAccumulators = new Map();
  const planeImpulseAccumulators = new Map();
  const bodyImpulseAccumulators = new Map();
  let latestManifolds = [];

  for (let iteration = 0; iteration < space.solverIterations; iteration += 1) {
    // 現在のstateMapから全shape pairを再評価し、直前のSphere/Capsule力積をBox接触にも渡します
    const manifolds = space._collectManifolds(stateMap, {
      includeComputeBoxContacts: true
    });
    if (iteration === 0) {
      space._hydrateManifoldsFromCache(manifolds);
      space._applyWarmStartToManifolds(manifolds, stateMap);
    }
    const activeContactKeys = new Set();
    const activePlaneContactKeys = new Set();
    const activeBodyContactKeys = new Set();
    for (const manifold of manifolds) {
      if (space._isComputeBoxContact(manifold)) {
        resolveCoupledBoxManifold(
          space,
          manifold,
          stateMap,
          iteration,
          coupledAccumulators,
          activeContactKeys
        );
      } else {
        space._resolveManifold(manifold, stateMap, iteration, {
          planeImpulseAccumulators,
          activePlaneContactKeys,
          bodyImpulseAccumulators,
          activeBodyContactKeys
        });
      }
    }
    // 反復中に分離した接触のlambdaを残さず、同じfixed step内で再接触したときは新しい制約として解きます
    for (const key of coupledAccumulators.keys()) {
      if (!activeContactKeys.has(key)) {
        coupledAccumulators.delete(key);
      }
    }
    // 反復中に分離したPlane接触のlambdaを残さず、再接触時は新しい接触として解きます
    for (const key of planeImpulseAccumulators.keys()) {
      if (!activePlaneContactKeys.has(key)) {
        planeImpulseAccumulators.delete(key);
      }
    }
    // 反復中に分離した一般body接触のlambdaを残さず、再接触時は新しい接触として解きます
    for (const key of bodyImpulseAccumulators.keys()) {
      if (!activeBodyContactKeys.has(key)) {
        bodyImpulseAccumulators.delete(key);
      }
    }
    latestManifolds = manifolds;
  }

  const finalManifolds = latestManifolds;
  const solvedContacts = flattenFinalContacts(space, finalManifolds);
  space._markSleepSupportFromContacts(stateMap, solvedContacts);
  const activeDynamicBodies = synchronizeCoupledBodies(space, stateMap);
  space._solveJointsXPBD(numericDtSec);
  if (space.solveJointsInStep === true && space.joints.length > 0) {
    space._syncStateMapAfterJointSolver(stateMap);
  }
  if (jointXpbdPreStepTransformMap !== null) {
    space._applyJointXpbdVelocityUpdate(jointXpbdPreStepTransformMap, numericDtSec);
  }
  space._applySleepIslands(activeDynamicBodies, stateMap, solvedContacts);
  space.sleepFastPathReady = true;

  const currentContactMap = space._buildContactMap(solvedContacts);
  space.lastContacts = solvedContacts.map((contact) => space._cloneContact(contact));
  space.lastManifolds = finalManifolds.map((manifold) => space._cloneManifold(manifold));
  space.lastContactEvents = space._buildContactEvents(currentContactMap);
  space._emitContactEvents(space.lastContactEvents);
  space.previousContactMap = currentContactMap;
  space.previousManifoldMap = space._buildManifoldCache(finalManifolds);
  return stateMap;
}
