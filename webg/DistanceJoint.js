// ---------------------------------------------
//  DistanceJoint.js  2026/08/24
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import util from "./util.js";
import Joint from "./Joint.js";
import JointConstraintRow from "./JointConstraintRow.js";
import {
  JOINT_EPSILON,
  dotVec3,
  getWorldAnchor,
  getPointVelocity,
  normalizeVec3,
  readVec3,
  subVec3
} from "./JointMath.js";

// 2 body anchor間の距離を1本のbilateral constraintで保つ
// anchor、距離、solver設定だけを保持し、実際の速度・位置更新はJointSolverへ渡す
export default class DistanceJoint extends Joint {
  // local anchorと目標距離を検証してDistanceJointを生成する
  constructor(options = {}) {
    super(options);
    const opts = util.readPlainObject(options, "DistanceJoint options", {});
    this.localAnchorA = readVec3(
      opts.localAnchorA === undefined ? [0.0, 0.0, 0.0] : opts.localAnchorA,
      "DistanceJoint localAnchorA"
    );
    this.localAnchorB = readVec3(
      opts.localAnchorB === undefined ? [0.0, 0.0, 0.0] : opts.localAnchorB,
      "DistanceJoint localAnchorB"
    );
    const initialAnchorA = getWorldAnchor(this.bodyA, this.localAnchorA);
    const initialAnchorB = getWorldAnchor(this.bodyB, this.localAnchorB);
    const initialDelta = subVec3(initialAnchorB, initialAnchorA);
    const initialDistance = Math.hypot(initialDelta[0], initialDelta[1], initialDelta[2]);
    this.distance = util.readOptionalFiniteNumber(
      opts.distance,
      "DistanceJoint distance",
      initialDistance,
      { min: 0.0 }
    );
    this.referenceAxis = opts.axis === undefined
      ? null
      : readVec3(opts.axis, "DistanceJoint axis", { nonZero: true });
    if (initialDistance <= JOINT_EPSILON && this.referenceAxis === null) {
      throw new Error("DistanceJoint axis is required when the initial anchor distance is zero");
    }
  }

  // Joint種類を返す
  getType() {
    return "DistanceJoint";
  }

  // 現在のanchor位置とconstraint軸を計算する
  // anchorが重なったときはconstructorで明示されたaxisだけを使い、任意方向を自動生成しない
  _getCurrentGeometry() {
    const anchorA = getWorldAnchor(this.bodyA, this.localAnchorA);
    const anchorB = getWorldAnchor(this.bodyB, this.localAnchorB);
    const delta = subVec3(anchorB, anchorA);
    const length = Math.hypot(delta[0], delta[1], delta[2]);
    const axis = length > JOINT_EPSILON
      ? normalizeVec3(delta, "DistanceJoint current anchor delta")
      : normalizeVec3(this.referenceAxis, "DistanceJoint axis");
    return {
      anchorA,
      anchorB,
      axis,
      length
    };
  }

  // DistanceJointの1本のlinear constraint rowを作る
  // rowのposition errorは現在距離-目標距離、relative velocityはB anchor-A anchorの軸方向速度
  buildConstraintRows() {
    const geometry = this._getCurrentGeometry();
    const positionA = this.bodyA.getPosition();
    const positionB = this.bodyB.getPosition();
    const offsetA = subVec3(geometry.anchorA, positionA);
    const offsetB = subVec3(geometry.anchorB, positionB);
    return [new JointConstraintRow({
      name: "distance",
      mode: "linear",
      bodyA: this.bodyA,
      bodyB: this.bodyB,
      axis: geometry.axis,
      offsetA,
      offsetB,
      getPositionError: () => geometry.length - this.distance,
      getRelativeVelocity: () => {
        const pointVelocityA = getPointVelocity(this.bodyA, offsetA);
        const pointVelocityB = getPointVelocity(this.bodyB, offsetB);
        return dotVec3(subVec3(pointVelocityB, pointVelocityA), geometry.axis);
      }
    })];
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
      distance: this.distance,
      axis: this.referenceAxis === null ? null : [...this.referenceAxis]
    };
  }
}
