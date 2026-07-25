// ---------------------------------------------
//  SphereCollider.js  2026/05/06
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import Collider from "./Collider.js";
import BoxCollider from "./BoxCollider.js";
import PlaneCollider from "./PlaneCollider.js";

export default class SphereCollider extends Collider {

  // radius と offset を持つ sphere collider を生成する
  constructor(radius, options = {}) {
    super("sphere", options);
    this.radius = this._readFiniteNumber(
      radius,
      "SphereCollider radius",
      { min: 0.0 }
    );
  }

  // 半径を返す
  getRadius() {
    return this.radius;
  }

  // broadphase では sphere 候補として扱う
  getBroadphaseKind() {
    return "sphere";
  }

  // sphere は sphere / box / plane / capsule との候補を作る
  canBroadphasePairWith(otherCollider) {
    const kind = otherCollider?.getBroadphaseKind?.();
    return kind === "sphere" || kind === "box" || kind === "plane" || kind === "capsule";
  }

  // physics space 上の center / radius を返す
  getWorldInfo(position) {
    return {
      center: this.getWorldPosition(position),
      radius: this.radius
    };
  }

  // physics space AABB を返す
  getAabb(position) {
    const info = this.getWorldInfo(position);
    return {
      min: [
        info.center[0] - info.radius,
        info.center[1] - info.radius,
        info.center[2] - info.radius
      ],
      max: [
        info.center[0] + info.radius,
        info.center[1] + info.radius,
        info.center[2] + info.radius
      ]
    };
  }

  // ray と sphere の交点を返す
  intersectRay(position, origin, dir, maxDistance = Infinity) {
    const sphere = this.getWorldInfo(position);
    const rayOrigin = this._readVec3(origin, "SphereCollider ray origin");
    const rayDir = this._readVec3(dir, "SphereCollider ray dir");
    const rayMaxDistance = maxDistance === Infinity
      ? Infinity
      : this._readFiniteNumber(
        maxDistance,
        "SphereCollider ray maxDistance",
        { min: 0.0 }
      );
    const originToCenter = this._subVec3(rayOrigin, sphere.center);
    const b = this._dotVec3(originToCenter, rayDir);
    const c = this._dotVec3(originToCenter, originToCenter) - sphere.radius * sphere.radius;
    const discriminant = b * b - c;
    if (discriminant < 0.0) {
      return null;
    }

    const sqrtDiscriminant = Math.sqrt(discriminant);
    let distance = -b - sqrtDiscriminant;
    if (distance < 0.0) {
      distance = -b + sqrtDiscriminant;
    }
    if (distance < 0.0 || distance > rayMaxDistance) {
      return null;
    }

    const hitPosition = this._addVec3(rayOrigin, this._scaleVec3(rayDir, distance));
    const normalDelta = this._subVec3(hitPosition, sphere.center);
    const normalLength = this._lengthVec3(normalDelta);
    const normal = normalLength > 1.0e-8
      ? this._scaleVec3(normalDelta, 1.0 / normalLength)
      : this._scaleVec3(rayDir, -1.0);
    return {
      distance,
      position: hitPosition,
      normal
    };
  }

  // world AABB と重なるかを返す
  overlapsAabb(position, queryMin, queryMax) {
    const min = this._readVec3(queryMin, "SphereCollider query min");
    const max = this._readVec3(queryMax, "SphereCollider query max");
    const sphere = this.getWorldInfo(position);
    const closestPoint = [
      Math.max(min[0], Math.min(max[0], sphere.center[0])),
      Math.max(min[1], Math.min(max[1], sphere.center[1])),
      Math.max(min[2], Math.min(max[2], sphere.center[2]))
    ];
    const delta = this._subVec3(sphere.center, closestPoint);
    return this._dotVec3(delta, delta) <= sphere.radius * sphere.radius;
  }

  // sphere と重なるとき最近傍点と距離を返す
  overlapSphere(position, center, radius) {
    const sphere = this.getWorldInfo(position);
    const queryCenter = this._readVec3(center, "SphereCollider sphere center");
    const queryRadius = this._readFiniteNumber(
      radius,
      "SphereCollider sphere radius",
      { min: 0.0 }
    );
    const delta = this._subVec3(queryCenter, sphere.center);
    const centerDistance = this._lengthVec3(delta);
    const maxDistance = sphere.radius + queryRadius;
    if (centerDistance > maxDistance) {
      return null;
    }
    if (centerDistance <= sphere.radius) {
      return {
        closestPoint: [...queryCenter],
        distance: 0.0
      };
    }
    const normal = this._scaleVec3(delta, 1.0 / centerDistance);
    return {
      closestPoint: this._addVec3(sphere.center, this._scaleVec3(normal, sphere.radius)),
      distance: centerDistance - sphere.radius
    };
  }

  // sphere-sphere 接触を生成する
  _buildContactWithSphereCollider(position, otherCollider, otherPosition, bodyA, bodyB) {
    if (!(otherCollider instanceof SphereCollider)) {
      throw new Error("SphereCollider sphere contact requires another SphereCollider");
    }
    const sphereA = this.getWorldInfo(position);
    const sphereB = otherCollider.getWorldInfo(otherPosition);
    const delta = this._subVec3(sphereB.center, sphereA.center);
    const distance = this._lengthVec3(delta);
    const penetration = sphereA.radius + sphereB.radius - distance;
    if (penetration <= 0.0) {
      return null;
    }
    const normal = distance > 1.0e-8 ? this._scaleVec3(delta, 1.0 / distance) : [1.0, 0.0, 0.0];
    return {
      bodyA,
      bodyB,
      normal,
      penetration,
      point: this._addVec3(sphereA.center, this._scaleVec3(normal, sphereA.radius - penetration * 0.5))
    };
  }

  // sphere-box 接触を生成する
  _buildContactWithBoxCollider(position, boxCollider, boxPosition, bodyA, bodyB, quat = null, boxQuat = null) {
    if (!(boxCollider instanceof BoxCollider)) {
      throw new Error("SphereCollider box contact requires a BoxCollider");
    }
    const sphere = this.getWorldInfo(position);
    const box = boxCollider.getWorldInfo(boxPosition, boxQuat);
    const centerDelta = this._subVec3(sphere.center, box.center);
    const closestPoint = [...box.center];
    for (let axis = 0; axis < 3; axis++) {
      const distanceOnAxis = this._dotVec3(centerDelta, box.axes[axis]);
      const clamped = Math.max(-box.half[axis], Math.min(box.half[axis], distanceOnAxis));
      closestPoint[0] += box.axes[axis][0] * clamped;
      closestPoint[1] += box.axes[axis][1] * clamped;
      closestPoint[2] += box.axes[axis][2] * clamped;
    }
    const delta = this._subVec3(closestPoint, sphere.center);
    const distance = this._lengthVec3(delta);

    if (distance > 1.0e-8) {
      const penetration = sphere.radius - distance;
      if (penetration <= 0.0) {
        return null;
      }
      return {
        bodyA,
        bodyB,
        normal: this._scaleVec3(delta, 1.0 / distance),
        penetration,
        point: closestPoint
      };
    }

    const localCenter = [
      this._dotVec3(centerDelta, box.axes[0]),
      this._dotVec3(centerDelta, box.axes[1]),
      this._dotVec3(centerDelta, box.axes[2])
    ];
    const distancesToFaces = [
      box.half[0] - Math.abs(localCenter[0]),
      box.half[1] - Math.abs(localCenter[1]),
      box.half[2] - Math.abs(localCenter[2])
    ];
    let axis = 0;
    if (distancesToFaces[1] < distancesToFaces[axis]) axis = 1;
    if (distancesToFaces[2] < distancesToFaces[axis]) axis = 2;
    const normalScale = localCenter[axis] >= 0.0 ? -1.0 : 1.0;
    const normal = this._scaleVec3(box.axes[axis], normalScale);
    return {
      bodyA,
      bodyB,
      normal,
      penetration: sphere.radius + Math.max(0.0, distancesToFaces[axis]),
      point: this._addVec3(sphere.center, this._scaleVec3(normal, sphere.radius))
    };
  }

  // plane-sphere 組み合わせでは plane 側の式へ委譲する
  _buildContactWithPlaneCollider(position, planeCollider, planePosition, bodyA, bodyB, quat = null, planeQuat = null) {
    return planeCollider.buildContactWith(
      planePosition,
      this,
      position,
      bodyB,
      bodyA,
      planeQuat,
      quat
    );
  }

  // capsule-sphere 組み合わせでは capsule 側の式へ委譲する
  _buildContactWithCapsuleCollider(position, capsuleCollider, capsulePosition, bodyA, bodyB, quat = null, capsuleQuat = null) {
    return capsuleCollider.buildContactWith(
      capsulePosition,
      this,
      position,
      bodyB,
      bodyA,
      capsuleQuat,
      quat
    );
  }

};  // class SphereCollider
