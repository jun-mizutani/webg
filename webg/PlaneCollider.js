// ---------------------------------------------
//  PlaneCollider.js  2026/08/28
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import Collider from "./Collider.js";
import BoxCollider from "./BoxCollider.js";
import {
  buildPlaneBoxSupportContact,
  buildPlaneTangentBasis,
  isPlaneSupportProjectionBalanced
} from "./PlaneBoxContact.js";

export default class PlaneCollider extends Collider {

  // normal と offset を持つ plane collider を生成する
  constructor(normal, options = {}) {
    super("plane", options);
    this.normal = this._normalizeVec3(
      this._readVec3(normal, "PlaneCollider normal"),
      "PlaneCollider normal"
    );
  }

  // broadphase では plane 候補として扱う
  getBroadphaseKind() {
    return "plane";
  }

  // plane は box / sphere / capsule との候補だけを作る
  canBroadphasePairWith(otherCollider) {
    return otherCollider?.getBroadphaseKind?.() === "box"
      || otherCollider?.getBroadphaseKind?.() === "sphere"
      || otherCollider?.getBroadphaseKind?.() === "capsule";
  }

  // physics space 上の normal / point を返す
  getWorldInfo(position) {
    return {
      normal: [...this.normal],
      point: this.getWorldPosition(position)
    };
  }

  // plane法線に直交する2本の接線基底を作り、支持範囲の判定を2Dへ変換する
  // 法線と平行にならないworld axisを選ぶため、床・壁・斜面で同じ判定を使える
  _buildSupportTangentBasis(normal) {
    return buildPlaneTangentBasis(normal);
  }

  // body重心の平面投影が支持点の線分または三角形の内側にあるか判定する
  // 支持範囲の内側なら重心投影へ合力を集約し、接触点の偏りから余分な回転を作らない
  _isSupportProjectionBalanced(activePoints, normal, position, tolerance) {
    return isPlaneSupportProjectionBalanced(
      activePoints,
      normal,
      position,
      tolerance,
      this._buildSupportTangentBasis(normal)
    );
  }

  // ray と plane の交点を返す
  intersectRay(position, origin, dir, maxDistance = Infinity) {
    const plane = this.getWorldInfo(position);
    const rayOrigin = this._readVec3(origin, "PlaneCollider ray origin");
    const rayDir = this._readVec3(dir, "PlaneCollider ray dir");
    const denom = this._dotVec3(rayDir, plane.normal);
    if (Math.abs(denom) <= 1.0e-8) {
      return null;
    }
    const originToPlane = this._subVec3(plane.point, rayOrigin);
    const distance = this._dotVec3(originToPlane, plane.normal) / denom;
    if (distance < 0.0 || distance > maxDistance) {
      return null;
    }
    return {
      distance,
      position: this._addVec3(rayOrigin, this._scaleVec3(rayDir, distance)),
      normal: denom < 0.0 ? [...plane.normal] : this._scaleVec3(plane.normal, -1.0)
    };
  }

  // plane-box 接触を生成する
  _buildContactWithBoxCollider(position, boxCollider, boxPosition, planeBody, boxBody, planeQuat = null, boxQuat = null) {
    if (!(boxCollider instanceof BoxCollider)) {
      throw new Error("PlaneCollider box contact requires a BoxCollider");
    }
    const plane = this.getWorldInfo(position);
    const box = boxCollider.getWorldInfo(boxPosition, boxQuat);
    // Compute版のposition slopと同じく、Boxの最大全長に対する比率で支持頂点を選ぶ
    // 固定値の広い許容範囲を使わず、浅い接触を広い面接触へ膨らませない
    const vertices = boxCollider.getVertices(boxPosition, boxQuat);
    const positionSlop = Math.max(box.half[0], box.half[1], box.half[2]) * 0.0125;
    const contact = buildPlaneBoxSupportContact(
      plane,
      box.center,
      vertices,
      positionSlop,
      this._buildSupportTangentBasis(plane.normal)
    );
    if (contact === null) {
      return null;
    }
    return {
      bodyA: planeBody,
      bodyB: boxBody,
      normal: [...plane.normal],
      source: {
        kind: "computePlaneBox",
        supportCount: contact.activePoints.length,
        balanced: contact.balanced
      },
      contacts: [{
        featureKey: "compute-plane-box-support",
        penetration: contact.penetration,
        point: contact.point
      }]
    };
  }

  // plane-sphere 接触を生成する
  _buildContactWithSphereCollider(position, sphereCollider, spherePosition, planeBody, sphereBody) {
    const plane = this.getWorldInfo(position);
    const sphere = sphereCollider.getWorldInfo(spherePosition);
    const centerToPlane = this._subVec3(sphere.center, plane.point);
    const distance = this._dotVec3(centerToPlane, plane.normal);
    const penetration = sphere.radius - distance;
    if (penetration <= 0.0) {
      return null;
    }
    const point = this._subVec3(sphere.center, this._scaleVec3(plane.normal, sphere.radius));
    return {
      bodyA: planeBody,
      bodyB: sphereBody,
      normal: [...plane.normal],
      penetration,
      point
    };
  }

  // plane-capsule 接触を生成する
  _buildContactWithCapsuleCollider(position, capsuleCollider, capsulePosition, planeBody, capsuleBody, _planeQuat = null, capsuleQuat = null) {
    const plane = this.getWorldInfo(position);
    const capsule = capsuleCollider.getWorldInfo(capsulePosition, capsuleQuat);
    const distanceA = this._dotVec3(this._subVec3(capsule.pointA, plane.point), plane.normal);
    const distanceB = this._dotVec3(this._subVec3(capsule.pointB, plane.point), plane.normal);
    const distance = Math.min(distanceA, distanceB);
    const penetration = capsule.radius - distance;
    if (penetration <= 0.0) {
      return null;
    }
    const basePoint = distanceA <= distanceB ? capsule.pointA : capsule.pointB;
    const point = this._subVec3(basePoint, this._scaleVec3(plane.normal, capsule.radius));
    return {
      bodyA: planeBody,
      bodyB: capsuleBody,
      normal: [...plane.normal],
      penetration,
      point
    };
  }

};  // class PlaneCollider
