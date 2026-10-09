// ---------------------------------------------
// PhysicsStepPipeline.js  2026/08/29
//   Fixed-step execution order for PhysicsSpace
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import util from "./util.js";
import { stepMixedPhysicsSpace } from "./CpuMixedPhysicsPipeline.js";

// PhysicsSpaceの一fixed stepについて、積分、候補生成、接触、Joint、同期、sleepの順序をまとめます
// shape pairの計算はspaceへ委譲し、ここでは更新順序と各処理の接続だけを扱います
export function stepPhysicsSpace(space, dtSec) {
  const numericDtSec = util.readFiniteNumber(dtSec, "PhysicsSpace dtSec", {
    minExclusive: 0.0
  });
  if (space.cpuBoxPhysicsAdapter.shouldUseForStep()) {
    return space.cpuBoxPhysicsAdapter.step(numericDtSec);
  }
  if (space.cpuBoxPhysicsAdapter.hasBoxBodies()) {
    return stepMixedPhysicsSpace(space, numericDtSec);
  }
  space._wakeEnabledJointBodies();
  space._wakePredictedComputeBoxBodies(numericDtSec);
  const jointXpbdPreStepTransformMap = space.solveJointsInStep === true
    ? space._createJointXpbdPreStepTransformMap()
    : null;
  const stateMap = new Map();
  const solvedContacts = [];
  // Compute版の相手body入力は外部積分前のstep開始状態を読む
  // local bodyの重力・減衰・移動後stateを保存した相手へ混ぜず、body invocation間の順序依存を作らない
  space._computeBoxSourceStateMap = new Map();

  for (let i = 0; i < space.bodies.length; i++) {
    const body = space.bodies[i];
    const predictedWake = space.predictedWakeOtherMap instanceof Map
      && space.predictedWakeOtherMap.has(body);
    const sourceSleeping = body.getSleeping?.() === true || predictedWake;
    const state = {
      position: space._cloneVec3(body.getPosition()),
      velocity: space._cloneVec3(body.getLinearVelocity()),
      quat: body.getQuat(),
      angularVelocity: space._cloneVec3(body.getAngularVelocity()),
      // 予測wake bodyはlocal invocationではawakeとして扱い、相手snapshotではsleepのまま保持します
      // Compute版と同じく、wakeしたbody自身だけを進め、他bodyの有効質量へsleep前の状態を反映します
      sleeping: sourceSleeping && !predictedWake,
      // Compute版と同じく、step開始時にawakeだったdynamic Boxだけをlocal invocationへ渡します
      // sleep中bodyは相手snapshotとして参照し、そのstepのlocal積分を停止状態として扱います
      computeBoxActive: body.isDynamic?.() === true
        && body.getSleeping?.() !== true
        && body.getCollider?.()?.type === "box",
      // 予測wakeで起こされたbodyには、wake判定を作った相手を限定して渡します
      // それ以外の相手へ予測stateを広げると、実際には接触していないbodyまで動かします
      computeBoxWasPredictedWake: predictedWake,
      touchedStatic: false,
      touchedDynamicSupport: false,
      // Compute方式のBox sleep判定が、このstepで観測した接触と速度をbodyごとに保持します
      // 接触のたびに全bodyのislandへまとめず、最後のsolver反復で得た速度条件を後段へ渡します
      computeBoxContactObserved: false,
      computeBoxBodyContactObserved: false,
      computeBoxActiveDynamicBodyContactObserved: false,
      computeBoxMaxContactSpeed: 0.0,
      computeBoxMaxNormalSpeed: 0.0,
      computeBoxFloorContactObserved: false,
      computeBoxFloorSupportPoints: Infinity,
      computeBoxWallSupportObserved: false
    };
    stateMap.set(body, state);
    space._computeBoxSourceStateMap.set(body, {
      ...state,
      // Nodeは予測wake判定の入口で起こされていても、相手入力snapshotには元のsleep状態を残します
      sleeping: sourceSleeping,
      position: [...state.position],
      velocity: [...state.velocity],
      angularVelocity: [...state.angularVelocity],
      quat: state.quat.clone()
    });

    if (!body.isDynamic() || body.getSleeping() === true) {
      continue;
    }

    const force = body.getForce();
    const torque = body.getTorque();
    state.velocity[0] += (space.gravity[0] * body.getGravityScale() + force[0] * body.getInverseMass()) * numericDtSec;
    state.velocity[1] += (space.gravity[1] * body.getGravityScale() + force[1] * body.getInverseMass()) * numericDtSec;
    state.velocity[2] += (space.gravity[2] * body.getGravityScale() + force[2] * body.getInverseMass()) * numericDtSec;

    if (body.getFixedRotation() !== true) {
      // torque は線形質量ではなく慣性で回りやすさが決まる
      // world-space torque を現在姿勢の inverse inertia へ通して、
      // 角加速度として angularVelocity へ積分する
      const angularAccelerationRad = space._applyWorldInverseInertia(body, state.quat, torque);
      const angularAccelerationDeg = space._radVec3ToDeg(angularAccelerationRad);
      state.angularVelocity[0] += angularAccelerationDeg[0] * numericDtSec;
      state.angularVelocity[1] += angularAccelerationDeg[1] * numericDtSec;
      state.angularVelocity[2] += angularAccelerationDeg[2] * numericDtSec;
    } else {
      state.angularVelocity[0] = 0.0;
      state.angularVelocity[1] = 0.0;
      state.angularVelocity[2] = 0.0;
    }

    // dampingは実績済みCompute方式と同じ指数減衰で適用し、fixed step幅に依存しない減衰を作ります
    const linearDampingScale = Math.exp(-body.getLinearDamping() * numericDtSec);
    state.velocity[0] *= linearDampingScale;
    state.velocity[1] *= linearDampingScale;
    state.velocity[2] *= linearDampingScale;

    const angularDampingScale = Math.exp(-body.getAngularDamping() * numericDtSec);
    state.angularVelocity[0] *= angularDampingScale;
    state.angularVelocity[1] *= angularDampingScale;
    state.angularVelocity[2] *= angularDampingScale;

    state.position[0] += state.velocity[0] * numericDtSec;
    state.position[1] += state.velocity[1] * numericDtSec;
    state.position[2] += state.velocity[2] * numericDtSec;
    // 全形状へ有限回転Δq ⊗ qを適用し、物理問い合わせと描画へ同じquaternionを渡します
    // Box、Sphere、Capsuleで姿勢更新を分けず、接触計算へ同じfixed step結果を渡します
    state.quat = space._buildComputeStepQuat(
      state.quat,
      state.angularVelocity,
      numericDtSec
    );
  }

  // 外部積分だけを終えたstateを保存し、予測wakeの接触相手へ渡します
  // solver反復中に先に解かれたbodyのimpulseを混ぜず、Compute版のpredictWakeBodyに対応させます
  space._computeBoxPredictedStateMap = new Map();
  for (const [body, state] of stateMap.entries()) {
    space._computeBoxPredictedStateMap.set(body, {
      ...state,
      position: [...state.position],
      velocity: [...state.velocity],
      angularVelocity: [...state.angularVelocity],
      quat: state.quat.clone()
    });
  }
  const computeBoxEntries = space._collectStepColliderEntries(stateMap);
  const computeBoxCandidateMap = space._buildComputeBoxCandidateMap(computeBoxEntries);

  // Compute版の一body一invocation処理と同じく、相手入力は上のstep開始snapshotで固定する
  // Box接触の候補はfixed step内で再利用し、同じ反復内で先に更新された相手stateを読まない
  space._computeBoxImpulseAccumulators = new Map();
  const planeImpulseAccumulators = new Map();
  const bodyImpulseAccumulators = new Map();

  let latestManifolds = [];
  for (let iter = 0; iter < space.solverIterations; iter++) {
    // 非Box形状は既存どおり反復ごとに候補とnarrowphaseを再評価する
    const manifolds = space._collectManifolds(stateMap, {
      includeComputeBoxContacts: false
    });
    const computeManifolds = [];
    if (iter === 0) {
      space._hydrateManifoldsFromCache(manifolds);
      space._applyWarmStartToManifolds(manifolds, stateMap);
    }
    for (let i = 0; i < manifolds.length; i++) {
      const flatContacts = space._flattenManifoldContacts(manifolds[i]);
      for (let j = 0; j < flatContacts.length; j++) {
        solvedContacts.push(flatContacts[j]);
      }
    }
    const activePlaneContactKeys = new Set();
    const activeBodyContactKeys = new Set();
    for (let i = 0; i < manifolds.length; i++) {
      space._resolveManifold(manifolds[i], stateMap, iter, {
        planeImpulseAccumulators,
        activePlaneContactKeys,
        bodyImpulseAccumulators,
        activeBodyContactKeys
      });
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
    // 実績済みCompute solverと同じく、body登録順にlocal Box invocationを実行します
    // 全pair manifoldをbody ID順へ整列し、sweep-and-pruneの列挙順から独立した処理順にします
    for (let bodyIndex = 0; bodyIndex < space.bodies.length; bodyIndex += 1) {
      space._resolveComputeBoxBody(
        space.bodies[bodyIndex],
        bodyIndex,
        stateMap,
        space._computeBoxSourceStateMap ?? stateMap,
        computeBoxCandidateMap,
        iter,
        computeManifolds
      );
    }
    latestManifolds = [...manifolds, ...computeManifolds];
    for (let i = 0; i < computeManifolds.length; i += 1) {
      const flatContacts = space._flattenManifoldContacts(computeManifolds[i]);
      for (let j = 0; j < flatContacts.length; j += 1) {
        solvedContacts.push(flatContacts[j]);
      }
    }
  }
  space._markSleepSupportFromContacts(stateMap, solvedContacts);
  space.lastContacts = solvedContacts;
  space.lastManifolds = latestManifolds.map((manifold) => space._cloneManifold(manifold));
  const currentContactMap = space._buildContactMap(solvedContacts);
  space.lastContactEvents = space._buildContactEvents(currentContactMap);
  space._emitContactEvents(space.lastContactEvents);
  space.previousContactMap = currentContactMap;
  space.previousManifoldMap = space._buildManifoldCache(latestManifolds);

  const activeDynamicBodies = [];
  for (let i = 0; i < space.bodies.length; i++) {
    const body = space.bodies[i];
    const state = stateMap.get(body);
    body.clearAccumulators?.();

    if (!body.isDynamic()) {
      continue;
    }
    if (body.getSleeping() === true) {
      continue;
    }

    activeDynamicBodies.push(body);

    body.syncNodeFromPhysics(state.position, {
      quat: state.quat
    });
    body.setLinearVelocityVec(state.velocity);
    body.setAngularVelocityVec(state.angularVelocity);
  }
  // 接触のvelocity solverを終えたphysical stateへ、JointのXPBD位置補正を追加する
  // XPBDのposition correctionはlinear / angular velocityへ戻さず、次stepの速度へ偽のエネルギーを注入しない
  space._solveJointsXPBD(numericDtSec);
  if (space.solveJointsInStep === true && space.joints.length > 0) {
    space._syncStateMapAfterJointSolver(stateMap);
  }
  if (jointXpbdPreStepTransformMap !== null) {
    space._applyJointXpbdVelocityUpdate(jointXpbdPreStepTransformMap, numericDtSec);
  }
  const computeBoxBodies = activeDynamicBodies.filter((body) => (
    stateMap.get(body)?.computeBoxContactObserved === true
  ));
  const otherActiveBodies = activeDynamicBodies.filter((body) => (
    stateMap.get(body)?.computeBoxContactObserved !== true
  ));
  const sleepingBodies = computeBoxBodies.length > 0
    ? space._applyComputeBoxSleepStates(computeBoxBodies, stateMap)
    : new Set();
  const islandSleepingBodies = otherActiveBodies.length > 0
    ? space._applySleepIslands(otherActiveBodies, stateMap, solvedContacts)
    : new Set();
  for (const body of islandSleepingBodies) {
    sleepingBodies.add(body);
  }
  space._computeBoxSourceStateMap = null;
  space._computeBoxPredictedStateMap = null;
  space._computeBoxImpulseAccumulators = null;
  return stateMap;
}
