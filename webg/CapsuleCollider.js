// ---------------------------------------------
//  CapsuleCollider.js  2026/05/07
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import Collider from "./Collider.js";
import BoxCollider from "./BoxCollider.js";
import PlaneCollider from "./PlaneCollider.js";
import SphereCollider from "./SphereCollider.js";

export default class CapsuleCollider extends Collider {

  // radius と y 軸方向の segmentLength を持つ capsule collider を生成する
  constructor(radius, segmentLength, options = {}) {
    super("capsule", options);
    this.radius = this._readFiniteNumber(
      radius,
      "CapsuleCollider radius",
      { min: 0.0 }
    );
    this.segmentLength = this._readFiniteNumber(
      segmentLength,
      "CapsuleCollider segmentLength",
      { min: 0.0 }
    );
  }

  // 半径を返す
  getRadius() {
    return this.radius;
  }

  // capsule の芯線長を返す
  getSegmentLength() {
    return this.segmentLength;
  }

  // broadphase では capsule 候補として扱う
  getBroadphaseKind() {
    return "capsule";
  }

  // capsule は capsule / sphere / box / plane との候補を作る
  canBroadphasePairWith(otherCollider) {
    const kind = otherCollider?.getBroadphaseKind?.();
    return kind === "capsule" || kind === "sphere" || kind === "box" || kind === "plane";
  }

  // physics space 上の center / segment endpoints / radius を返す
  getWorldInfo(position, quat = null) {
    const center = this.getWorldPosition(position, quat);
    const halfSegment = this.segmentLength * 0.5;
    return {
      center,
      pointA: [center[0], center[1] - halfSegment, center[2]],
      pointB: [center[0], center[1] + halfSegment, center[2]],
      halfSegment,
      radius: this.radius
    };
  }

  // physics space AABB を返す
  getAabb(position, quat = null) {
    const capsule = this.getWorldInfo(position, quat);
    return {
      min: [
        capsule.center[0] - capsule.radius,
        capsule.center[1] - capsule.halfSegment - capsule.radius,
        capsule.center[2] - capsule.radius
      ],
      max: [
        capsule.center[0] + capsule.radius,
        capsule.center[1] + capsule.halfSegment + capsule.radius,
        capsule.center[2] + capsule.radius
      ]
    };
  }

  // 線分上の最近傍点を返す
  _closestPointOnSegment(pointA, pointB, point) {
    const ab = this._subVec3(pointB, pointA);
    const abLengthSq = this._dotVec3(ab, ab);
    if (abLengthSq <= 1.0e-12) {
      return [...pointA];
    }
    const ap = this._subVec3(point, pointA);
    const t = Math.max(0.0, Math.min(1.0, this._dotVec3(ap, ab) / abLengthSq));
    return this._addVec3(pointA, this._scaleVec3(ab, t));
  }

  // AABB 上の最近傍点を返す
  _closestPointOnAabb(point, aabb) {
    return [
      Math.max(aabb.min[0], Math.min(aabb.max[0], point[0])),
      Math.max(aabb.min[1], Math.min(aabb.max[1], point[1])),
      Math.max(aabb.min[2], Math.min(aabb.max[2], point[2]))
    ];
  }

  // 線分 capsule と AABB の最近傍点を近似的に返す
  _closestSegmentAabbPoints(pointA, pointB, aabb) {
    const ab = this._subVec3(pointB, pointA);
    let bestT = 0.0;
    let bestSegmentPoint = pointA;
    let bestBoxPoint = this._closestPointOnAabb(bestSegmentPoint, aabb);
    let bestDistanceSq = this._dotVec3(
      this._subVec3(bestSegmentPoint, bestBoxPoint),
      this._subVec3(bestSegmentPoint, bestBoxPoint)
    );

    const testT = (t) => {
      const segmentPoint = this._addVec3(pointA, this._scaleVec3(ab, t));
      const boxPoint = this._closestPointOnAabb(segmentPoint, aabb);
      const delta = this._subVec3(boxPoint, segmentPoint);
      const distanceSq = this._dotVec3(delta, delta);
      if (distanceSq < bestDistanceSq) {
        bestT = t;
        bestSegmentPoint = segmentPoint;
        bestBoxPoint = boxPoint;
        bestDistanceSq = distanceSq;
      }
    };

    testT(0.0);
    testT(1.0);
    for (let axis = 0; axis < 3; axis++) {
      if (Math.abs(ab[axis]) <= 1.0e-12) {
        continue;
      }
      const breakpoints = [
        (aabb.min[axis] - pointA[axis]) / ab[axis],
        (aabb.max[axis] - pointA[axis]) / ab[axis]
      ];
      for (let i = 0; i < breakpoints.length; i++) {
        if (breakpoints[i] >= 0.0 && breakpoints[i] <= 1.0) {
          testT(breakpoints[i]);
        }
      }
    }

    return {
      segmentPoint: bestSegmentPoint,
      otherPoint: bestBoxPoint,
      distanceSq: bestDistanceSq,
      t: bestT
    };
  }

  // 線分 capsule と OBB の最近傍点を返す
  _closestSegmentObbPoints(pointA, pointB, box, quat = null) {
    const localPointA = this._inverseRotateVec3ByQuat(this._subVec3(pointA, box.center), quat);
    const localPointB = this._inverseRotateVec3ByQuat(this._subVec3(pointB, box.center), quat);
    const localClosest = this._closestSegmentAabbPoints(localPointA, localPointB, {
      min: [-box.half[0], -box.half[1], -box.half[2]],
      max: [box.half[0], box.half[1], box.half[2]]
    });
    const segmentPoint = this._addVec3(
      box.center,
      this._rotateVec3ByQuat(localClosest.segmentPoint, quat)
    );
    const otherPoint = this._addVec3(
      box.center,
      this._rotateVec3ByQuat(localClosest.otherPoint, quat)
    );
    return {
      segmentPoint,
      otherPoint,
      distanceSq: localClosest.distanceSq,
      t: localClosest.t
    };
  }

  // 2 線分の最近傍点を返す
  _closestSegmentSegmentPoints(p1, q1, p2, q2) {
    const d1 = this._subVec3(q1, p1);
    const d2 = this._subVec3(q2, p2);
    const r = this._subVec3(p1, p2);
    const a = this._dotVec3(d1, d1);
    const d1Length = Math.sqrt(a);
    const e = this._dotVec3(d2, d2);
    const f = this._dotVec3(d2, r);
    let s = 0.0;
    let t = 0.0;

    if (a <= 1.0e-12 && e <= 1.0e-12) {
      return { pointA: [...p1], pointB: [...p2] };
    }
    if (a <= 1.0e-12) {
      t = Math.max(0.0, Math.min(1.0, f / e));
    } else {
      const c = this._dotVec3(d1, r);
      if (e <= 1.0e-12) {
        s = Math.max(0.0, Math.min(1.0, -c / a));
      } else {
        const b = this._dotVec3(d1, d2);
        const denom = a * e - b * b;
        if (denom !== 0.0) {
          s = Math.max(0.0, Math.min(1.0, (b * f - c * e) / denom));
        } else if (d1Length > 1.0e-12) {
          // 平行で重なり区間を持つ線分では、どの点を最近傍点に選ぶかで
          // 不要な回転 impulse が混ざる
          // overlap の中央を contact point に寄せることで、
          // 対称条件の capsule-capsule 接触を安定させる
          const axis = this._scaleVec3(d1, 1.0 / d1Length);
          const projP2 = this._dotVec3(this._subVec3(p2, p1), axis);
          const projQ2 = this._dotVec3(this._subVec3(q2, p1), axis);
          const otherMin = Math.min(projP2, projQ2);
          const otherMax = Math.max(projP2, projQ2);
          const overlapMin = Math.max(0.0, otherMin);
          const overlapMax = Math.min(d1Length, otherMax);
          if (overlapMin <= overlapMax) {
            const overlapCenter = (overlapMin + overlapMax) * 0.5;
            const pointA = this._addVec3(p1, this._scaleVec3(axis, overlapCenter));
            return {
              pointA,
              pointB: this._closestPointOnSegment(p2, q2, pointA)
            };
          }
        }
        t = (b * s + f) / e;
        if (t < 0.0) {
          t = 0.0;
          s = Math.max(0.0, Math.min(1.0, -c / a));
        } else if (t > 1.0) {
          t = 1.0;
          s = Math.max(0.0, Math.min(1.0, (b - c) / a));
        }
      }
    }
    return {
      pointA: this._addVec3(p1, this._scaleVec3(d1, s)),
      pointB: this._addVec3(p2, this._scaleVec3(d2, t))
    };
  }

  // ray と capsule の交点を返す
  intersectRay(position, origin, dir, maxDistance = Infinity) {
    const capsule = this.getWorldInfo(position);
    const rayOrigin = this._readVec3(origin, "CapsuleCollider ray origin");
    const rayDir = this._readVec3(dir, "CapsuleCollider ray dir");
    const rayMaxDistance = maxDistance === Infinity
      ? Infinity
      : this._readFiniteNumber(
        maxDistance,
        "CapsuleCollider ray maxDistance",
        { min: 0.0 }
      );
    const localOrigin = this._subVec3(rayOrigin, capsule.center);
    const candidates = [];

    const addSphereHit = (sphereCenter) => {
      const originToCenter = this._subVec3(rayOrigin, sphereCenter);
      const b = this._dotVec3(originToCenter, rayDir);
      const c = this._dotVec3(originToCenter, originToCenter) - capsule.radius * capsule.radius;
      const discriminant = b * b - c;
      if (discriminant < 0.0) return;
      const sqrtDiscriminant = Math.sqrt(discriminant);
      let distance = -b - sqrtDiscriminant;
      if (distance < 0.0) {
        distance = -b + sqrtDiscriminant;
      }
      if (distance < 0.0 || distance > rayMaxDistance) return;
      const hitPosition = this._addVec3(rayOrigin, this._scaleVec3(rayDir, distance));
      const normalDelta = this._subVec3(hitPosition, sphereCenter);
      const normalLength = this._lengthVec3(normalDelta);
      candidates.push({
        distance,
        position: hitPosition,
        normal: normalLength > 1.0e-8
          ? this._scaleVec3(normalDelta, 1.0 / normalLength)
          : this._scaleVec3(rayDir, -1.0)
      });
    };

    const a = rayDir[0] * rayDir[0] + rayDir[2] * rayDir[2];
    if (a > 1.0e-12) {
      const b = localOrigin[0] * rayDir[0] + localOrigin[2] * rayDir[2];
      const c = localOrigin[0] * localOrigin[0] + localOrigin[2] * localOrigin[2] - capsule.radius * capsule.radius;
      const discriminant = b * b - a * c;
      if (discriminant >= 0.0) {
        const sqrtDiscriminant = Math.sqrt(discriminant);
        const distances = [
          (-b - sqrtDiscriminant) / a,
          (-b + sqrtDiscriminant) / a
        ];
        for (let i = 0; i < distances.length; i++) {
          const distance = distances[i];
          const y = localOrigin[1] + rayDir[1] * distance;
          if (distance >= 0.0 && distance <= rayMaxDistance && y >= -capsule.halfSegment && y <= capsule.halfSegment) {
            const hitPosition = this._addVec3(rayOrigin, this._scaleVec3(rayDir, distance));
            const normalDelta = [hitPosition[0] - capsule.center[0], 0.0, hitPosition[2] - capsule.center[2]];
            const normalLength = this._lengthVec3(normalDelta);
            candidates.push({
              distance,
              position: hitPosition,
              normal: normalLength > 1.0e-8 ? this._scaleVec3(normalDelta, 1.0 / normalLength) : [1.0, 0.0, 0.0]
            });
          }
        }
      }
    }
    addSphereHit(capsule.pointA);
    addSphereHit(capsule.pointB);
    candidates.sort((left, right) => left.distance - right.distance);
    return candidates.length > 0 ? candidates[0] : null;
  }

  // world AABB と重なるかを返す
  overlapsAabb(position, queryMin, queryMax) {
    const min = this._readVec3(queryMin, "CapsuleCollider query min");
    const max = this._readVec3(queryMax, "CapsuleCollider query max");
    const capsule = this.getWorldInfo(position);
    const closest = this._closestSegmentAabbPoints(capsule.pointA, capsule.pointB, { min, max });
    return closest.distanceSq <= capsule.radius * capsule.radius;
  }

  // sphere と重なるとき最近傍点と距離を返す
  overlapSphere(position, center, radius) {
    const capsule = this.getWorldInfo(position);
    const queryCenter = this._readVec3(center, "CapsuleCollider sphere center");
    const queryRadius = this._readFiniteNumber(
      radius,
      "CapsuleCollider sphere radius",
      { min: 0.0 }
    );
    const closestPoint = this._closestPointOnSegment(capsule.pointA, capsule.pointB, queryCenter);
    const delta = this._subVec3(queryCenter, closestPoint);
    const centerDistance = this._lengthVec3(delta);
    if (centerDistance > capsule.radius + queryRadius) {
      return null;
    }
    if (centerDistance <= capsule.radius) {
      return {
        closestPoint: [...queryCenter],
        distance: 0.0
      };
    }
    const normal = this._scaleVec3(delta, 1.0 / centerDistance);
    return {
      closestPoint: this._addVec3(closestPoint, this._scaleVec3(normal, capsule.radius)),
      distance: centerDistance - capsule.radius
    };
  }

  // capsule-capsule 接触を生成する
  _buildContactWithCapsuleCollider(position, otherCollider, otherPosition, bodyA, bodyB) {
    if (!(otherCollider instanceof CapsuleCollider)) {
      throw new Error("CapsuleCollider capsule contact requires another CapsuleCollider");
    }
    const capsuleA = this.getWorldInfo(position);
    const capsuleB = otherCollider.getWorldInfo(otherPosition);
    const closest = this._closestSegmentSegmentPoints(
      capsuleA.pointA,
      capsuleA.pointB,
      capsuleB.pointA,
      capsuleB.pointB
    );
    return this._buildContactFromClosestPoints(
      closest.pointA,
      closest.pointB,
      capsuleA.radius + capsuleB.radius,
      bodyA,
      bodyB
    );
  }

  // capsule-sphere 接触を生成する
  _buildContactWithSphereCollider(position, sphereCollider, spherePosition, bodyA, bodyB) {
    if (!(sphereCollider instanceof SphereCollider)) {
      throw new Error("CapsuleCollider sphere contact requires a SphereCollider");
    }
    const capsule = this.getWorldInfo(position);
    const sphere = sphereCollider.getWorldInfo(spherePosition);
    const closestPoint = this._closestPointOnSegment(capsule.pointA, capsule.pointB, sphere.center);
    return this._buildContactFromClosestPoints(
      closestPoint,
      sphere.center,
      capsule.radius + sphere.radius,
      bodyA,
      bodyB
    );
  }

  // capsule-box 接触を生成する
  _buildContactWithBoxCollider(position, boxCollider, boxPosition, bodyA, bodyB, quat = null, boxQuat = null) {
    if (!(boxCollider instanceof BoxCollider)) {
      throw new Error("CapsuleCollider box contact requires a BoxCollider");
    }
    const capsule = this.getWorldInfo(position, quat);
    const box = boxCollider.getWorldInfo(boxPosition, boxQuat);
    const closest = this._closestSegmentObbPoints(capsule.pointA, capsule.pointB, box, boxQuat);
    if (closest.distanceSq > 1.0e-12) {
      return this._buildContactFromClosestPoints(
        closest.segmentPoint,
        closest.otherPoint,
        capsule.radius,
        bodyA,
        bodyB
      );
    }

    const localSegmentPoint = this._inverseRotateVec3ByQuat(this._subVec3(closest.segmentPoint, box.center), boxQuat);
    const distancesToFaces = [
      box.half[0] - Math.abs(localSegmentPoint[0]),
      box.half[1] - Math.abs(localSegmentPoint[1]),
      box.half[2] - Math.abs(localSegmentPoint[2])
    ];
    let axis = 0;
    if (distancesToFaces[1] < distancesToFaces[axis]) axis = 1;
    if (distancesToFaces[2] < distancesToFaces[axis]) axis = 2;
    const localNormal = [0.0, 0.0, 0.0];
    localNormal[axis] = localSegmentPoint[axis] >= 0.0 ? -1.0 : 1.0;
    return {
      bodyA,
      bodyB,
      normal: this._rotateVec3ByQuat(localNormal, boxQuat),
      penetration: capsule.radius + Math.max(0.0, distancesToFaces[axis]),
      point: closest.otherPoint
    };
  }

  // plane-capsule 組み合わせでは plane 側の式へ委譲する
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

  // 最近傍点 pair と許容半径から contact を生成する
  _buildContactFromClosestPoints(pointA, pointB, radiusSum, bodyA, bodyB) {
    const delta = this._subVec3(pointB, pointA);
    const distance = this._lengthVec3(delta);
    const penetration = radiusSum - distance;
    if (penetration <= 0.0) {
      return null;
    }
    const normal = distance > 1.0e-8 ? this._scaleVec3(delta, 1.0 / distance) : [1.0, 0.0, 0.0];
    return {
      bodyA,
      bodyB,
      normal,
      penetration,
      point: this._addVec3(pointA, this._scaleVec3(normal, Math.max(0.0, radiusSum - penetration * 0.5)))
    };
  }

};  // class CapsuleCollider
