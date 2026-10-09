// ---------------------------------------------
//  JointSolver.js  2026/08/25
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import util from "./util.js";

const SINGULAR_ROW_EPSILON = 1.0e-12;

// Jointの速度行と位置行を共通の処理順で解く
// body状態やGPU resourceを直接持たず、Distance/Hingeの型別式をrowへ閉じ込める
// velocityCorrectionBetaとpositionCorrectionBetaを分け、接触中の速度追従と接触後の位置復元を別に調整できる
// positionCorrectionIterationsを0にすると、接触後のbody位置を動かさず速度行だけで拘束を追従する
export function solveJoint(joint, dtSec, iterations, options = {}) {
  const dt = util.readFiniteNumber(dtSec, "JointSolver dtSec", { minExclusive: 0.0 });
  const count = util.readOptionalInteger(
    iterations,
    "JointSolver iterations",
    4,
    { min: 1, max: 64 }
  );
  const opts = util.readPlainObject(options, "JointSolver options", {});
  const positionCount = util.readOptionalInteger(
    opts.positionCorrectionIterations,
    "JointSolver positionCorrectionIterations",
    count,
    { min: 0, max: 64 }
  );
  const velocityCount = util.readOptionalInteger(
    opts.velocityCorrectionIterations,
    "JointSolver velocityCorrectionIterations",
    count,
    { min: 0, max: 64 }
  );
  const velocityCorrectionBetaScale = util.readOptionalFiniteNumber(
    opts.velocityCorrectionBetaScale,
    "JointSolver velocityCorrectionBetaScale",
    1.0,
    { min: 0.0 }
  );
  let velocityRows = 0;
  let positionRows = 0;
  let singularRows = 0;
  let maxPositionError = 0.0;

  // 速度行は相対速度と位置誤差のbiasを同じfixed step内で解く
  // velocityCorrectionIterations=0なら、位置行だけを実行する比較条件にできる
  for (let iteration = 0; iteration < velocityCount; iteration++) {
    const rows = joint.buildConstraintRows();
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const error = row.getPositionError();
      maxPositionError = Math.max(maxPositionError, Math.abs(error));
      const effectiveMass = row.getEffectiveMass();
      if (effectiveMass <= SINGULAR_ROW_EPSILON) {
        singularRows += 1;
        continue;
      }
      const bias = joint.velocityCorrectionBeta * velocityCorrectionBetaScale * error / dt;
      const lambda = -(row.getRelativeVelocity() + bias) / effectiveMass;
      row.applyVelocityImpulse(lambda);
      velocityRows += 1;
    }
  }

  // 位置行は速度solver後に残ったanchor / 軸の誤差だけを補正する
  // slopはJointへ明示された値だけを差し引き、他の数値へ勝手に丸めない
  for (let iteration = 0; iteration < positionCount; iteration++) {
    const rows = joint.buildConstraintRows();
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const error = joint.getPositionCorrectionError(row.getPositionError());
      maxPositionError = Math.max(maxPositionError, Math.abs(error));
      if (Math.abs(error) <= SINGULAR_ROW_EPSILON) {
        continue;
      }
      const effectiveMass = row.getEffectiveMass();
      if (effectiveMass <= SINGULAR_ROW_EPSILON) {
        singularRows += 1;
        continue;
      }
      const lambda = -joint.positionCorrectionBeta * error / effectiveMass;
      row.applyPositionImpulse(lambda);
      positionRows += 1;
    }
  }

  return {
    type: joint.getType(),
    velocityRows,
    positionRows,
    singularRows,
    maxPositionError
  };
}

// XPBDのposition constraintをpersistent lambdaで解く
// physical velocityへposition補正を戻さず、complianceと過去lambdaを含むdelta lambdaだけをtransformへ適用する
export function solveJointXPBD(joint, dtSec, iterations, options = {}) {
  const dt = util.readFiniteNumber(dtSec, "JointSolver XPBD dtSec", { minExclusive: 0.0 });
  const count = util.readOptionalInteger(
    iterations,
    "JointSolver XPBD iterations",
    4,
    { min: 1, max: 64 }
  );
  const opts = util.readPlainObject(options, "JointSolver XPBD options", {});
  const positionCount = util.readOptionalInteger(
    opts.positionCorrectionIterations,
    "JointSolver XPBD positionCorrectionIterations",
    count,
    { min: 0, max: 64 }
  );
  const compliance = util.readFiniteNumber(
    joint.getCompliance(),
    "JointSolver XPBD compliance",
    { min: 0.0 }
  );
  const alpha = compliance / (dt * dt);
  let positionRows = 0;
  let singularRows = 0;
  let maxPositionError = 0.0;

  // XPBDでは各反復のdelta lambdaだけを適用し、rowごとのlambda合計はJointへ保持する
  // 速度biasやpositionCorrectionBetaは使わず、complianceと有効質量で補正量を決める
  for (let iteration = 0; iteration < positionCount; iteration++) {
    const rows = joint.buildConstraintRows();
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const error = joint.getPositionCorrectionError(row.getPositionError());
      maxPositionError = Math.max(maxPositionError, Math.abs(error));
      const effectiveMass = row.getEffectiveMass();
      const denominator = effectiveMass + alpha;
      if (denominator <= SINGULAR_ROW_EPSILON) {
        singularRows += 1;
        continue;
      }
      const previousLambda = joint.getPositionConstraintLambda(row.name);
      const deltaLambda = (-error - alpha * previousLambda) / denominator;
      row.applyPositionImpulse(deltaLambda);
      joint.setPositionConstraintLambda(row.name, previousLambda + deltaLambda);
      positionRows += 1;
    }
  }

  return {
    type: joint.getType(),
    velocityRows: 0,
    positionRows,
    singularRows,
    maxPositionError,
    compliance,
    alpha
  };
}
