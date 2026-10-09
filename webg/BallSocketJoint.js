// ---------------------------------------------
//  BallSocketJoint.js  2026/08/24
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import util from "./util.js";
import Joint from "./Joint.js";
import JointConstraintRow from "./JointConstraintRow.js";
import {
  dotVec3,
  getPointVelocity,
  getWorldAnchor,
  readVec3,
  subVec3
} from "./JointMath.js";

// 2 bodyのanchor位置だけを一致させ、相対回転の3自由度を残す
// motor、limit、angular dampingはまだ持たず、BallSocketの基本拘束だけを評価対象にする
export default class BallSocketJoint extends Joint {
  // local anchorを検証してBallSocketJointを生成する
  constructor(options = {}) {
    const opts = util.readPlainObject(options, "BallSocketJoint options", {});
    super(opts);
    this.localAnchorA = readVec3(
      opts.localAnchorA === undefined ? [0.0, 0.0, 0.0] : opts.localAnchorA,
      "BallSocketJoint localAnchorA"
    );
    this.localAnchorB = readVec3(
      opts.localAnchorB === undefined ? [0.0, 0.0, 0.0] : opts.localAnchorB,
      "BallSocketJoint localAnchorB"
    );
  }

  // Joint種類を返す
  getType() {
    return "BallSocketJoint";
  }

  // anchor位置のXYZ成分を3行に分けて、現在姿勢から拘束を構築する
  // angular rowを作らないことで、2 bodyの相対回転をすべて残す
  buildConstraintRows() {
    const anchorA = getWorldAnchor(this.bodyA, this.localAnchorA);
    const anchorB = getWorldAnchor(this.bodyB, this.localAnchorB);
    const positionA = this.bodyA.getPosition();
    const positionB = this.bodyB.getPosition();
    const offsetA = subVec3(anchorA, positionA);
    const offsetB = subVec3(anchorB, positionB);
    const anchorDelta = subVec3(anchorB, anchorA);
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
      localAnchorB: [...this.localAnchorB]
    };
  }
}
