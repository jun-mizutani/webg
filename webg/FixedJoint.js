// ---------------------------------------------
//  FixedJoint.js  2026/08/24
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import util from "./util.js";
import Joint from "./Joint.js";
import JointConstraintRow from "./JointConstraintRow.js";
import {
  conjugateQuat,
  dotVec3,
  getPointVelocity,
  getWorldAnchor,
  getWorldAngularVelocity,
  multiplyQuat,
  readQuat,
  readVec3,
  rotateVec3ByQuat,
  subVec3
} from "./JointMath.js";

// 2 bodyのanchor位置と指定した相対姿勢を固定する
// target relative orientationは現在姿勢から推測せず、呼出側が明示した値だけを使う
export default class FixedJoint extends Joint {
  // local anchorとtarget relative orientationを検証してFixedJointを生成する
  constructor(options = {}) {
    const opts = util.readPlainObject(options, "FixedJoint options", {});
    super(opts);
    this.localAnchorA = readVec3(
      opts.localAnchorA === undefined ? [0.0, 0.0, 0.0] : opts.localAnchorA,
      "FixedJoint localAnchorA"
    );
    this.localAnchorB = readVec3(
      opts.localAnchorB === undefined ? [0.0, 0.0, 0.0] : opts.localAnchorB,
      "FixedJoint localAnchorB"
    );
    this.targetRelativeOrientation = readQuat(
      opts.targetRelativeOrientation,
      "FixedJoint targetRelativeOrientation"
    );
  }

  // Joint種類を返す
  getType() {
    return "FixedJoint";
  }

  // 現在のbody姿勢とtarget relative orientationの差をworld rotation vectorで返す
  // qRel = inverse(qA) * qBを求め、targetの逆回転を掛けてからworldへ戻す
  // qと-qが同じ姿勢を表すため、wが負のときだけ符号を反転して短い回転差を選ぶ
  getCurrentOrientationError() {
    const orientationA = this.bodyA.getQuat();
    const orientationB = this.bodyB.getQuat();
    const relative = multiplyQuat(conjugateQuat(orientationA), orientationB);
    const errorLocal = multiplyQuat(
      relative,
      conjugateQuat(this.targetRelativeOrientation)
    );
    if (errorLocal.q[0] < 0.0) {
      errorLocal.negate();
    }
    return rotateVec3ByQuat([
      2.0 * errorLocal.q[1],
      2.0 * errorLocal.q[2],
      2.0 * errorLocal.q[3]
    ], orientationA);
  }

  // anchor位置3行と相対姿勢3行を現在状態から構築する
  // 6行すべてを作ることで、target姿勢からの相対回転も拘束する
  buildConstraintRows() {
    const anchorA = getWorldAnchor(this.bodyA, this.localAnchorA);
    const anchorB = getWorldAnchor(this.bodyB, this.localAnchorB);
    const positionA = this.bodyA.getPosition();
    const positionB = this.bodyB.getPosition();
    const offsetA = subVec3(anchorA, positionA);
    const offsetB = subVec3(anchorB, positionB);
    const anchorDelta = subVec3(anchorB, anchorA);
    const orientationError = this.getCurrentOrientationError();
    const angularA = getWorldAngularVelocity(this.bodyA);
    const angularB = getWorldAngularVelocity(this.bodyB);
    const relativeAngularVelocity = subVec3(angularB, angularA);
    const rows = [];
    const axes = [
      [1.0, 0.0, 0.0],
      [0.0, 1.0, 0.0],
      [0.0, 0.0, 1.0]
    ];
    for (let i = 0; i < axes.length; i++) {
      const axis = axes[i];
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
    for (let i = 0; i < axes.length; i++) {
      const axis = axes[i];
      rows.push(new JointConstraintRow({
        name: `orientation_${i}`,
        mode: "angular",
        bodyA: this.bodyA,
        bodyB: this.bodyB,
        axis,
        getPositionError: () => dotVec3(orientationError, axis),
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
      targetRelativeOrientation: [...this.targetRelativeOrientation.q]
    };
  }
}
