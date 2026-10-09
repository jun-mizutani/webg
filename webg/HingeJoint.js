// ---------------------------------------------
//  HingeJoint.js  2026/08/24
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import util from "./util.js";
import Joint from "./Joint.js";
import JointConstraintRow from "./JointConstraintRow.js";
import {
  buildOrthogonalBasis,
  crossVec3,
  dotVec3,
  getWorldAnchor,
  getPointVelocity,
  getWorldAngularVelocity,
  normalizeVec3,
  readVec3,
  rotateVec3ByQuat,
  subVec3
} from "./JointMath.js";

// anchor位置を一致させ、2本の接線軸だけを揃えて、ヒンジ軸まわりの回転を残す
// motor、limit、frictionはまだ持たず、Hingeの基本自由度だけを評価対象にする
export default class HingeJoint extends Joint {
  // local anchorとlocal hinge axisを検証してHingeJointを生成する
  constructor(options = {}) {
    const opts = util.readPlainObject(options, "HingeJoint options", {});
    super(opts);
    this.localAnchorA = readVec3(
      opts.localAnchorA === undefined ? [0.0, 0.0, 0.0] : opts.localAnchorA,
      "HingeJoint localAnchorA"
    );
    this.localAnchorB = readVec3(
      opts.localAnchorB === undefined ? [0.0, 0.0, 0.0] : opts.localAnchorB,
      "HingeJoint localAnchorB"
    );
    this.localAxisA = readVec3(
      opts.localAxisA === undefined ? [0.0, 1.0, 0.0] : opts.localAxisA,
      "HingeJoint localAxisA",
      { nonZero: true }
    );
    this.localAxisB = readVec3(
      opts.localAxisB === undefined ? [0.0, 1.0, 0.0] : opts.localAxisB,
      "HingeJoint localAxisB",
      { nonZero: true }
    );
    this.localAxisA = normalizeVec3(this.localAxisA, "HingeJoint localAxisA");
    this.localAxisB = normalizeVec3(this.localAxisB, "HingeJoint localAxisB");
  }

  // Joint種類を返す
  getType() {
    return "HingeJoint";
  }

  // anchor位置3行とaxis alignment 2行を現在姿勢から構築する
  // Hinge軸方向の角速度行を作らないことで、その1自由度の回転を残す
  buildConstraintRows() {
    const anchorA = getWorldAnchor(this.bodyA, this.localAnchorA);
    const anchorB = getWorldAnchor(this.bodyB, this.localAnchorB);
    const positionA = this.bodyA.getPosition();
    const positionB = this.bodyB.getPosition();
    const offsetA = subVec3(anchorA, positionA);
    const offsetB = subVec3(anchorB, positionB);
    const anchorDelta = subVec3(anchorB, anchorA);
    const axisA = normalizeVec3(
      rotateVec3ByQuat(this.localAxisA, this.bodyA.getQuat()),
      "HingeJoint world axisA"
    );
    const axisB = normalizeVec3(
      rotateVec3ByQuat(this.localAxisB, this.bodyB.getQuat()),
      "HingeJoint world axisB"
    );
    const alignment = dotVec3(axisA, axisB);
    if (alignment < -0.999999) {
      throw new Error("HingeJoint world axes must not be opposite");
    }
    const tangents = buildOrthogonalBasis(axisA);
    const rows = [];
    const linearAxes = [
      [1.0, 0.0, 0.0],
      [0.0, 1.0, 0.0],
      [0.0, 0.0, 1.0]
    ];
    for (let i = 0; i < linearAxes.length; i++) {
      const axis = linearAxes[i];
      rows.push(new JointConstraintRow({
        name: `anchor_${i}`,
        mode: "linear",
        bodyA: this.bodyA,
        bodyB: this.bodyB,
        axis,
        offsetA,
        offsetB,
        getPositionError: () => dotVec3(anchorDelta, axis),
        getRelativeVelocity: () => {
          const pointVelocityA = getPointVelocity(this.bodyA, offsetA);
          const pointVelocityB = getPointVelocity(this.bodyB, offsetB);
          return dotVec3(subVec3(pointVelocityB, pointVelocityA), axis);
        }
      }));
    }
    const axisError = crossVec3(axisA, axisB);
    const angularA = getWorldAngularVelocity(this.bodyA);
    const angularB = getWorldAngularVelocity(this.bodyB);
    const relativeAngularVelocity = subVec3(angularB, angularA);
    for (let i = 0; i < tangents.length; i++) {
      const axis = tangents[i];
      rows.push(new JointConstraintRow({
        name: `axis_${i}`,
        mode: "angular",
        bodyA: this.bodyA,
        bodyB: this.bodyB,
        axis,
        getPositionError: () => dotVec3(axisError, axis),
        getRelativeVelocity: () => dotVec3(relativeAngularVelocity, axis)
      }));
    }
    return rows;
  }

  // 診断表示や後続のCompute packで使う不変設定を返す
  getDefinition() {
    return {
      type: this.getType(),
      compliance: this.compliance,
      bodyA: this.bodyA,
      bodyB: this.bodyB,
      localAnchorA: [...this.localAnchorA],
      localAnchorB: [...this.localAnchorB],
      localAxisA: [...this.localAxisA],
      localAxisB: [...this.localAxisB]
    };
  }
}
