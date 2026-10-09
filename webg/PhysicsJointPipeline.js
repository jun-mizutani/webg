// ---------------------------------------------
// PhysicsJointPipeline.js  2026/08/28
//   Joint wake, XPBD correction, and state synchronization for PhysicsSpace
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import util from "./util.js";
import {
  getWorldRotationVectorBetween,
  RAD_TO_DEG
} from "./JointMath.js";
import { solveJointXPBD } from "./JointSolver.js";

// 有効Jointへ接続されたdynamic bodyをfixed step開始前にwakeする
// Joint誤差をsleep中に無視しないため、sleep実装の詳細をJoint種類へ漏らさずSpaceで一括して扱う
export function wakeEnabledJointBodies(space) {
  if (space.solveJointsInStep !== true) {
    return;
  }
  for (let i = 0; i < space.joints.length; i++) {
    const joint = space.joints[i];
    if (joint.isEnabled?.() !== true) {
      continue;
    }
    joint.getBodyA().wakeUp?.();
    joint.getBodyB().wakeUp?.();
  }
}

// 有効Jointへ接続されたdynamic bodyのfixed step開始transformを保存する
// XPBD position correction後に、同じstepのtransform差をphysical velocityへ戻すために使う
export function createJointXpbdPreStepTransformMap(space) {
  const connectedBodies = new Set();
  for (let i = 0; i < space.joints.length; i++) {
    const joint = space.joints[i];
    if (joint.isEnabled?.() !== true) {
      continue;
    }
    connectedBodies.add(joint.getBodyA());
    connectedBodies.add(joint.getBodyB());
  }
  const transformMap = new Map();
  for (const body of connectedBodies) {
    if (body.isDynamic?.() !== true || body.getSleeping?.() === true) {
      continue;
    }
    transformMap.set(body, {
      position: [...body.getPosition()],
      quat: body.getQuat()
    });
  }
  return transformMap;
}

// XPBD position correction後のtransform差をJoint参加bodyのphysical velocityへ戻す
// contact後の現在姿勢とJoint補正後の姿勢を同じfixed stepの速度として次stepへ渡す
export function applyJointXpbdVelocityUpdate(space, transformMap, dtSec) {
  for (const [body, previous] of transformMap.entries()) {
    if (body.isDynamic?.() !== true || body.getSleeping?.() === true) {
      continue;
    }
    const position = body.getPosition();
    body.setLinearVelocityVec([
      (position[0] - previous.position[0]) / dtSec,
      (position[1] - previous.position[1]) / dtSec,
      (position[2] - previous.position[2]) / dtSec
    ]);
    if (body.getFixedRotation?.() === true) {
      body.setAngularVelocityVec([0.0, 0.0, 0.0]);
      continue;
    }
    const rotationVector = getWorldRotationVectorBetween(previous.quat, body.getQuat());
    body.setAngularVelocityVec([
      rotationVector[1] * RAD_TO_DEG / dtSec,
      rotationVector[0] * RAD_TO_DEG / dtSec,
      rotationVector[2] * RAD_TO_DEG / dtSec
    ]);
  }
}

// 登録Box solverのworld XYZ角速度表現へ、Joint補正後の姿勢差を戻します
// PhysicsNodeのEuler入力順へ戻す既存処理とは分け、次stepのsolver stateと同じ軸順を維持します
export function applyRegisteredBoxJointVelocityUpdate(space, transformMap, dtSec) {
  for (const [body, previous] of transformMap.entries()) {
    if (body.isDynamic?.() !== true || body.getSleeping?.() === true) {
      continue;
    }
    const position = body.getPosition();
    body.setLinearVelocityVec([
      (position[0] - previous.position[0]) / dtSec,
      (position[1] - previous.position[1]) / dtSec,
      (position[2] - previous.position[2]) / dtSec
    ]);
    if (body.getFixedRotation?.() === true) {
      body.setAngularVelocityVec([0.0, 0.0, 0.0]);
      continue;
    }
    const rotationVector = getWorldRotationVectorBetween(previous.quat, body.getQuat());
    body.setAngularVelocityVec([
      rotationVector[0] * RAD_TO_DEG / dtSec,
      rotationVector[1] * RAD_TO_DEG / dtSec,
      rotationVector[2] * RAD_TO_DEG / dtSec
    ]);
  }
}

// bodyへ反映済みのJoint XPBD補正をstateMapへ戻す
// sleep island判定が補正前の位置を参照して、古いanchor誤差を記録しないようにする
export function syncStateMapAfterJointSolver(space, stateMap) {
  for (let i = 0; i < space.bodies.length; i++) {
    const body = space.bodies[i];
    const state = stateMap.get(body);
    if (!state) {
      continue;
    }
    state.position = [...body.getPosition()];
    state.quat = body.getQuat();
  }
}

// 有効Jointを種類によらないXPBD position rowとして反復する
// Joint種類別の式はbuildConstraintRows()へ閉じ、PhysicsSpaceは全Jointを一巡する順序だけを管理する
export function solveJointsXPBD(space, dtSec) {
  const diagnostics = space.joints.map((joint) => ({
    type: joint.getType?.() ?? "Joint",
    enabled: false,
    velocityRows: 0,
    positionRows: 0,
    singularRows: 0,
    maxPositionError: 0.0,
    compliance: joint.getCompliance?.() ?? null,
    alpha: null
  }));
  if (space.solveJointsInStep !== true || space.joints.length === 0) {
    space.lastJointDiagnostics = diagnostics;
    return;
  }

  const activeEntries = [];
  let maximumIterations = 0;
  for (let i = 0; i < space.joints.length; i++) {
    const joint = space.joints[i];
    if (joint.isEnabled() !== true) {
      continue;
    }
    const positionIterations = joint.positionCorrectionIterations === null
      || joint.positionCorrectionIterations === undefined
      ? space.jointPositionCorrectionIterations
      : util.readFiniteNumber(
        joint.positionCorrectionIterations,
        `PhysicsSpace Joint ${i} positionCorrectionIterations`,
        { integer: true, min: 0, max: 64 }
      );
    diagnostics[i].enabled = true;
    activeEntries.push({ index: i, joint, positionIterations });
    maximumIterations = Math.max(maximumIterations, positionIterations);
  }

  for (let iteration = 0; iteration < maximumIterations; iteration++) {
    for (let i = 0; i < activeEntries.length; i++) {
      const entry = activeEntries[i];
      if (iteration >= entry.positionIterations) {
        continue;
      }
      const result = solveJointXPBD(entry.joint, dtSec, 1, {
        positionCorrectionIterations: 1
      });
      const diagnostic = diagnostics[entry.index];
      diagnostic.positionRows += result.positionRows;
      diagnostic.singularRows += result.singularRows;
      diagnostic.maxPositionError = Math.max(
        diagnostic.maxPositionError,
        result.maxPositionError
      );
      diagnostic.compliance = result.compliance;
      diagnostic.alpha = result.alpha;
    }
  }
  space.lastJointDiagnostics = diagnostics;
}
