// ---------------------------------------------
//  PhysicsSettings.js  2026/09/11
//   PhysicsSpace option validation and configuration
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import util from "./util.js";
import PhysicsMaterialPairs from './PhysicsMaterialPairs.js';
import { readOptionalVec3 } from "./PhysicsMath.js";

// PhysicsSpaceのconstructor optionを検証し、Spaceの公開設定へ順番どおりに反映します
// gravityやJoint反復数の既定値を一箇所で確認できるようにし、PhysicsSpace本体を接続処理へ集中させます
export function initializePhysicsSpaceSettings(space, options = {}) {
  const opts = util.readPlainObject(options, "PhysicsSpace options", {});
  space.gravity = readOptionalVec3(
    opts.gravity,
    "PhysicsSpace gravity",
    [0.0, -9.8, 0.0]
  );
  space.fixedTimeStepMs = util.readOptionalFiniteNumber(
    opts.fixedTimeStepMs,
    "PhysicsSpace fixedTimeStepMs",
    1000.0 / 120.0,
    { minExclusive: 0.0 }
  );
  space.maxSubSteps = util.readOptionalInteger(
    opts.maxSubSteps,
    "PhysicsSpace maxSubSteps",
    6,
    { min: 1 }
  );
  space.solverIterations = util.readOptionalInteger(
    opts.solverIterations,
    "PhysicsSpace solverIterations",
    4,
    { min: 1 }
  );
  space.broadphaseMode = util.readOptionalEnum(
    opts.broadphaseMode,
    "PhysicsSpace broadphaseMode",
    "sweepAabb",
    ["bruteForce", "sweepAabb"]
  );
  // Compute方式のBox候補と同じく、step開始から積分後までのAABBへ加える余白を保持します
  // 接触を作るための余白ではなく、狭いgapのpairをnarrow phaseへ残すためだけに使います
  space.computeBoxBroadphasePadding = util.readOptionalFiniteNumber(
    opts.computeBoxBroadphasePadding,
    "PhysicsSpace computeBoxBroadphasePadding",
    0.0,
    { min: 0.0 }
  );
  // Box接触のsupport feature許容値をscenarioの基準長から受け取ります
  // 未指定時だけshape依存の既定値を使い、共通scenarioではCPU/Computeへ同じ値を明示します
  space.computeBoxSupportFeatureTolerance = opts.computeBoxSupportFeatureTolerance === undefined
    ? null
    : util.readOptionalFiniteNumber(
      opts.computeBoxSupportFeatureTolerance,
      "PhysicsSpace computeBoxSupportFeatureTolerance",
      0.0,
      { min: 0.0 }
    );
  space.defaultRestitution = util.readOptionalFiniteNumber(
    opts.defaultRestitution,
    "PhysicsSpace defaultRestitution",
    0.0,
    { min: 0.0, max: 1.0 }
  );
  space.defaultFriction = util.readOptionalFiniteNumber(
    opts.defaultFriction,
    "PhysicsSpace defaultFriction",
    0.4,
    { min: 0.0 }
  );
  space.restingRestitutionSpeed = util.readOptionalFiniteNumber(
    opts.restingRestitutionSpeed,
    "PhysicsSpace restingRestitutionSpeed",
    0.5,
    { min: 0.0 }
  );
  space.materialPairs = new PhysicsMaterialPairs({ ...opts,
    defaultRestitution: space.defaultRestitution, defaultFriction: space.defaultFriction });
  space.revisitBodyContactImpulses = util.readOptionalBoolean(
    opts.revisitBodyContactImpulses,
    "PhysicsSpace revisitBodyContactImpulses",
    false
  );
  space.sleepLinearThreshold = util.readOptionalFiniteNumber(
    opts.sleepLinearThreshold,
    "PhysicsSpace sleepLinearThreshold",
    0.12,
    { min: 0.0 }
  );
  space.sleepAngularThreshold = util.readOptionalFiniteNumber(
    opts.sleepAngularThreshold,
    "PhysicsSpace sleepAngularThreshold",
    0.12,
    { min: 0.0 }
  );
  space.sleepStepsThreshold = util.readOptionalInteger(
    opts.sleepStepsThreshold,
    "PhysicsSpace sleepStepsThreshold",
    3,
    { min: 1 }
  );
  space.timeToSleep = util.readOptionalFiniteNumber(opts.timeToSleep,
    "PhysicsSpace timeToSleep", opts.sleepStepsThreshold === undefined
      ? 0.5 : space.sleepStepsThreshold * space.fixedTimeStepMs / 1000, { min: 0 });
  space.sleepStepsThreshold = Math.max(1, Math.ceil(space.timeToSleep * 1000 / space.fixedTimeStepMs));
  // Compute方式のBox接触で使う個体単位sleep判定の接触速度条件を保持します
  // 通常のsleep island判定とは別に、実績済みsolverと同じbodyごとの停止条件へ接続します
  space.persistentSleep = util.readOptionalBoolean(
    opts.persistentSleep,
    "PhysicsSpace persistentSleep",
    true
  );
  space.minimumFloorSupportPoints = util.readOptionalInteger(
    opts.minimumFloorSupportPoints,
    "PhysicsSpace minimumFloorSupportPoints",
    2,
    { min: 1 }
  );
  space.sleepContactSpeed = util.readOptionalFiniteNumber(
    opts.sleepContactSpeed,
    "PhysicsSpace sleepContactSpeed",
    0.01,
    { min: 0.0 }
  );
  space.sleepNormalSpeed = util.readOptionalFiniteNumber(
    opts.sleepNormalSpeed,
    "PhysicsSpace sleepNormalSpeed",
    0.02,
    { min: 0.0 }
  );
  space.wakeLinearSpeed = util.readOptionalFiniteNumber(
    opts.wakeLinearSpeed,
    "PhysicsSpace wakeLinearSpeed",
    space.sleepLinearThreshold * 1.5,
    { min: 0.0 }
  );
  space.wakeAngularSpeed = util.readOptionalFiniteNumber(
    opts.wakeAngularSpeed,
    "PhysicsSpace wakeAngularSpeed",
    space.sleepAngularThreshold * 1.5,
    { min: 0.0 }
  );
  space.positionCorrectionBeta = util.readOptionalFiniteNumber(
    opts.positionCorrectionBeta,
    "PhysicsSpace positionCorrectionBeta",
    0.35,
    { min: 0.0, max: 1.0 }
  );
  space.positionCorrectionSlop = util.readOptionalFiniteNumber(
    opts.positionCorrectionSlop,
    "PhysicsSpace positionCorrectionSlop",
    0.0015,
    { min: 0.0 }
  );
  // Jointの位置拘束はcoreではXPBDへ統一し、接触solverのposition correctionとは別に解きます
  // falseは派生spaceが独自の接触・Joint結合solverを呼ぶときだけ明示的に使います
  space.solveJointsInStep = util.readOptionalBoolean(
    opts.solveJointsInStep,
    "PhysicsSpace solveJointsInStep",
    true
  );
  space.jointSolverIterations = util.readOptionalInteger(
    opts.jointSolverIterations,
    "PhysicsSpace jointSolverIterations",
    4,
    { min: 1, max: 64 }
  );
  space.jointPositionCorrectionIterations = util.readOptionalInteger(
    opts.jointPositionCorrectionIterations,
    "PhysicsSpace jointPositionCorrectionIterations",
    space.jointSolverIterations,
    { min: 0, max: 64 }
  );
  return space;
}
