// ---------------------------------------------
//  BoxCollider.js  2026/08/28
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import Collider from "./Collider.js";
import { boxesOverlap, buildBoxContact } from "./BoxContact.js";

export default class BoxCollider extends Collider {

  // size と offset を持つ box collider を生成する
  constructor(size, options = {}) {
    super("box", options);
    this.size = this._readVec3(size, "BoxCollider size");
  }

  // half extents を返す
  getHalfExtents() {
    return [
      this.size[0] * 0.5,
      this.size[1] * 0.5,
      this.size[2] * 0.5
    ];
  }

  // broadphase では box 候補として扱う
  getBroadphaseKind() {
    return "box";
  }

  // box は box / plane / sphere / capsule との候補を作る
  canBroadphasePairWith(otherCollider) {
    return otherCollider?.getBroadphaseKind?.() === "box"
      || otherCollider?.getBroadphaseKind?.() === "plane"
      || otherCollider?.getBroadphaseKind?.() === "sphere"
      || otherCollider?.getBroadphaseKind?.() === "capsule";
  }

  // physics space 上の center / half を返す
  getWorldInfo(position, quat = null) {
    return {
      center: this.getWorldPosition(position, quat),
      half: this.getHalfExtents(),
      axes: this._getOrientationAxes(quat)
    };
  }

  // OBB の 8 頂点を world-space で返す
  // plane-box のように面で支えたい組み合わせでは、
  // support point 1 個だけよりも頂点群が必要になる
  getVertices(position, quat = null) {
    const box = this.getWorldInfo(position, quat);
    const vertices = [];
    for (let sx = -1; sx <= 1; sx += 2) {
      for (let sy = -1; sy <= 1; sy += 2) {
        for (let sz = -1; sz <= 1; sz += 2) {
          vertices.push([
            box.center[0]
              + box.axes[0][0] * box.half[0] * sx
              + box.axes[1][0] * box.half[1] * sy
              + box.axes[2][0] * box.half[2] * sz,
            box.center[1]
              + box.axes[0][1] * box.half[0] * sx
              + box.axes[1][1] * box.half[1] * sy
              + box.axes[2][1] * box.half[2] * sz,
            box.center[2]
              + box.axes[0][2] * box.half[0] * sx
              + box.axes[1][2] * box.half[1] * sy
              + box.axes[2][2] * box.half[2] * sz
          ]);
        }
      }
    }
    return vertices;
  }

  // physics space AABB を返す
  getAabb(position, quat = null) {
    const info = this.getWorldInfo(position, quat);
    const extent = [0.0, 0.0, 0.0];
    for (let worldAxis = 0; worldAxis < 3; worldAxis++) {
      extent[worldAxis] =
        Math.abs(info.axes[0][worldAxis]) * info.half[0] +
        Math.abs(info.axes[1][worldAxis]) * info.half[1] +
        Math.abs(info.axes[2][worldAxis]) * info.half[2];
    }
    return {
      min: [
        info.center[0] - extent[0],
        info.center[1] - extent[1],
        info.center[2] - extent[2]
      ],
      max: [
        info.center[0] + extent[0],
        info.center[1] + extent[1],
        info.center[2] + extent[2]
      ]
    };
  }

  // ray と box の交点を返す
  intersectRay(position, origin, dir, maxDistance = Infinity, quat = null) {
    const worldPosition = this._readVec3(position, "BoxCollider position");
    const rayOrigin = this._readVec3(origin, "BoxCollider ray origin");
    const rayDir = this._readVec3(dir, "BoxCollider ray dir");
    const rayMaxDistance = maxDistance === Infinity
      ? Infinity
      : this._readFiniteNumber(
        maxDistance,
        "BoxCollider ray maxDistance",
        { min: 0.0 }
      );
    const box = this.getWorldInfo(worldPosition, quat);
    const localOrigin = this._inverseRotateVec3ByQuat(this._subVec3(rayOrigin, box.center), quat);
    const localDir = this._inverseRotateVec3ByQuat(rayDir, quat);
    const min = [-box.half[0], -box.half[1], -box.half[2]];
    const max = [box.half[0], box.half[1], box.half[2]];
    let tMin = -Infinity;
    let tMax = Infinity;
    let hitNormal = [0.0, 0.0, 0.0];

    for (let axis = 0; axis < 3; axis++) {
      if (Math.abs(localDir[axis]) <= 1.0e-8) {
        if (localOrigin[axis] < min[axis] || localOrigin[axis] > max[axis]) {
          return null;
        }
        continue;
      }
      const invDir = 1.0 / localDir[axis];
      let t1 = (min[axis] - localOrigin[axis]) * invDir;
      let t2 = (max[axis] - localOrigin[axis]) * invDir;
      let axisNormal = [0.0, 0.0, 0.0];
      axisNormal[axis] = -1.0;
      if (t1 > t2) {
        const temp = t1;
        t1 = t2;
        t2 = temp;
        axisNormal[axis] = 1.0;
      }
      if (t1 > tMin) {
        tMin = t1;
        hitNormal = axisNormal;
      }
      tMax = Math.min(tMax, t2);
      if (tMin > tMax) {
        return null;
      }
    }

    const distance = tMin >= 0.0 ? tMin : tMax;
    if (distance < 0.0 || distance > rayMaxDistance) {
      return null;
    }
    return {
      distance,
      position: this._addVec3(rayOrigin, this._scaleVec3(rayDir, distance)),
      normal: this._rotateVec3ByQuat(hitNormal, quat)
    };
  }

  // world AABB と重なるかを返す
  overlapsAabb(position, queryMin, queryMax, quat = null) {
    const min = this._readVec3(queryMin, "BoxCollider query min");
    const max = this._readVec3(queryMax, "BoxCollider query max");
    const queryBox = {
      center: [
        (min[0] + max[0]) * 0.5,
        (min[1] + max[1]) * 0.5,
        (min[2] + max[2]) * 0.5
      ],
      half: [
        (max[0] - min[0]) * 0.5,
        (max[1] - min[1]) * 0.5,
        (max[2] - min[2]) * 0.5
      ],
      axes: [
        [1.0, 0.0, 0.0],
        [0.0, 1.0, 0.0],
        [0.0, 0.0, 1.0]
      ]
    };
    return boxesOverlap(this.getWorldInfo(position, quat), queryBox);
  }

  // sphere と重なるとき最近傍点と距離を返す
  overlapSphere(position, center, radius, quat = null) {
    const worldPosition = this._readVec3(position, "BoxCollider position");
    const sphereCenter = this._readVec3(center, "BoxCollider sphere center");
    const sphereRadius = this._readFiniteNumber(
      radius,
      "BoxCollider sphere radius",
      { min: 0.0 }
    );
    const box = this.getWorldInfo(worldPosition, quat);
    const delta = this._subVec3(sphereCenter, box.center);
    const closestPoint = [...box.center];
    for (let axis = 0; axis < 3; axis++) {
      const distanceOnAxis = this._dotVec3(delta, box.axes[axis]);
      const clamped = Math.max(-box.half[axis], Math.min(box.half[axis], distanceOnAxis));
      closestPoint[0] += box.axes[axis][0] * clamped;
      closestPoint[1] += box.axes[axis][1] * clamped;
      closestPoint[2] += box.axes[axis][2] * clamped;
    }
    const closestDelta = this._subVec3(sphereCenter, closestPoint);
    const distanceSq = this._dotVec3(closestDelta, closestDelta);
    if (distanceSq > sphereRadius * sphereRadius) {
      return null;
    }
    return {
      closestPoint,
      distance: Math.sqrt(distanceSq)
    };
  }

  // box-box 接触を生成する
  _buildContactWithBoxCollider(position, otherCollider, otherPosition, bodyA, bodyB, quat = null, otherQuat = null) {
    if (!(otherCollider instanceof BoxCollider)) {
      throw new Error("BoxCollider box contact requires another BoxCollider");
    }
    const boxA = this.getWorldInfo(position, quat);
    const boxB = otherCollider.getWorldInfo(otherPosition, otherQuat);
    const defaultTolerance = Math.max(...boxA.half, ...boxB.half) * 0.25;
    const contact = buildBoxContact(boxA, boxB, defaultTolerance);
    if (contact === null) {
      return null;
    }
    const contacts = [{
      featureKey: "compute-box-primary",
      penetration: contact.penetration,
      point: contact.point
    }];
    return {
      bodyA,
      bodyB,
      normal: contact.normal,
      source: { kind: "computeBox" },
      contacts
    };
  }

  // plane-box 組み合わせでは plane 側の式へ委譲する
  _buildContactWithPlaneCollider(position, planeCollider, planePosition, bodyA, bodyB, quat = null, otherQuat = null) {
    return planeCollider.buildContactWith(
      planePosition,
      this,
      position,
      bodyB,
      bodyA,
      otherQuat,
      quat
    );
  }

  // sphere-box 組み合わせでは sphere 側の式へ委譲する
  _buildContactWithSphereCollider(position, sphereCollider, spherePosition, bodyA, bodyB, quat = null, otherQuat = null) {
    return sphereCollider.buildContactWith(
      spherePosition,
      this,
      position,
      bodyB,
      bodyA,
      otherQuat,
      quat
    );
  }

  // capsule-box 組み合わせでは capsule 側の式へ委譲する
  _buildContactWithCapsuleCollider(position, capsuleCollider, capsulePosition, bodyA, bodyB, quat = null, otherQuat = null) {
    return capsuleCollider.buildContactWith(
      capsulePosition,
      this,
      position,
      bodyB,
      bodyA,
      otherQuat,
      quat
    );
  }

};  // class BoxCollider
