// ---------------------------------------------
//  JointConstraintRow.js  2026/08/24
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import util from "./util.js";
import {
  applyAngularPositionImpulse,
  applyAngularVelocityImpulse,
  applyPositionImpulse,
  applyVelocityImpulse,
  crossVec3,
  dotVec3,
  applyWorldInverseInertia,
  getSolverInverseMass,
  scaleVec3
} from "./JointMath.js";

// linear / angularを同じsolverへ渡すための1自由度制約行を表す
// Joint別モジュールはrowの軸、誤差、速度、impulse適用方法だけを定義する
export default class JointConstraintRow {
  // 制約行の入力を検証し、solverが参照する関数を保持する
  constructor({
    name,
    mode,
    bodyA,
    bodyB,
    axis,
    offsetA = [0.0, 0.0, 0.0],
    offsetB = [0.0, 0.0, 0.0],
    getPositionError,
    getRelativeVelocity
  }) {
    if (typeof name !== "string" || name.length === 0) {
      throw new Error("JointConstraintRow name must be a non-empty string");
    }
    if (mode !== "linear" && mode !== "angular") {
      throw new Error(`JointConstraintRow mode is unsupported: ${mode}`);
    }
    if (!bodyA || !bodyB) {
      throw new Error(`JointConstraintRow ${name} requires bodyA and bodyB`);
    }
    if (!Array.isArray(axis) || axis.length < 3) {
      throw new Error(`JointConstraintRow ${name} axis must be a vec3`);
    }
    if (typeof getPositionError !== "function" || typeof getRelativeVelocity !== "function") {
      throw new Error(`JointConstraintRow ${name} requires error and velocity functions`);
    }
    this.name = name;
    this.mode = mode;
    this.bodyA = bodyA;
    this.bodyB = bodyB;
    this.axis = [...axis];
    this.offsetA = [...offsetA];
    this.offsetB = [...offsetB];
    this._getPositionError = getPositionError;
    this._getRelativeVelocity = getRelativeVelocity;
  }

  // 現在の位置誤差を返す
  getPositionError() {
    return util.readFiniteNumber(
      this._getPositionError(),
      `JointConstraintRow ${this.name} positionError`
    );
  }

  // 現在の制約軸方向の相対速度を返す
  getRelativeVelocity() {
    return util.readFiniteNumber(
      this._getRelativeVelocity(),
      `JointConstraintRow ${this.name} relativeVelocity`
    );
  }

  // この行へ単位impulseを加えたときの速度変化係数を返す
  // 値が0に近い場合はJointSolverがsingular rowとして記録し、解を捏造しない
  getEffectiveMass() {
    if (this.mode === "angular") {
      const inverseA = applyWorldInverseInertia(this.bodyA, this.axis);
      const inverseB = applyWorldInverseInertia(this.bodyB, this.axis);
      return dotVec3(this.axis, inverseA) + dotVec3(this.axis, inverseB);
    }
    const impulse = this.axis;
    const inverseMassA = getSolverInverseMass(this.bodyA);
    const inverseMassB = getSolverInverseMass(this.bodyB);
    const angularA = crossVec3(
      applyWorldInverseInertia(this.bodyA, crossVec3(this.offsetA, impulse)),
      this.offsetA
    );
    const angularB = crossVec3(
      applyWorldInverseInertia(this.bodyB, crossVec3(this.offsetB, impulse)),
      this.offsetB
    );
    return inverseMassA + inverseMassB
      + dotVec3(this.axis, angularA)
      + dotVec3(this.axis, angularB);
  }

  // 速度solverで求めたscalar impulseを適用する
  applyVelocityImpulse(lambda) {
    const impulse = scaleVec3(this.axis, lambda);
    if (this.mode === "angular") {
      applyAngularVelocityImpulse(this.bodyA, impulse, -1.0);
      applyAngularVelocityImpulse(this.bodyB, impulse, 1.0);
      return;
    }
    applyVelocityImpulse(this.bodyA, this.offsetA, impulse, -1.0);
    applyVelocityImpulse(this.bodyB, this.offsetB, impulse, 1.0);
  }

  // 位置solverで求めたscalar correctionを適用する
  applyPositionImpulse(lambda) {
    const impulse = scaleVec3(this.axis, lambda);
    if (this.mode === "angular") {
      applyAngularPositionImpulse(this.bodyA, impulse, -1.0);
      applyAngularPositionImpulse(this.bodyB, impulse, 1.0);
      return;
    }
    applyPositionImpulse(this.bodyA, this.offsetA, impulse, -1.0);
    applyPositionImpulse(this.bodyB, this.offsetB, impulse, 1.0);
  }
}
