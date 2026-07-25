// ---------------------------------------------
//  BoxCollider.js  2026/07/25
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import Collider from "./Collider.js";

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
    return this._buildObbContact(this.getWorldInfo(position, quat), queryBox, {
      includeTouching: true
    }) !== null;
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

  // OBB 同士の SAT contact を返す
  _buildObbContact(boxA, boxB, options = {}) {
    const centerDelta = this._subVec3(boxB.center, boxA.center);
    const includeTouching = options.includeTouching === true;
    let bestOverlap = Infinity;
    let bestAxis = null;
    let bestSource = {
      kind: "faceA",
      axisIndex: 0
    };
    let bestFaceOverlap = Infinity;
    let bestFaceAxis = null;
    let bestFaceSource = null;
    let bestEdgeOverlap = Infinity;
    let bestEdgeAxis = null;
    let bestEdgeSource = null;

    // `testAxis`は入力条件や交差状態を比較し、判定結果を返す
    const testAxis = (axis, source) => {
      const length = this._lengthVec3(axis);
      if (length <= 1.0e-8) {
        return true;
      }
      const unitAxis = this._scaleVec3(axis, 1.0 / length);
      let radiusA = 0.0;
      let radiusB = 0.0;
      for (let i = 0; i < 3; i++) {
        radiusA += boxA.half[i] * Math.abs(this._dotVec3(unitAxis, boxA.axes[i]));
        radiusB += boxB.half[i] * Math.abs(this._dotVec3(unitAxis, boxB.axes[i]));
      }
      const distance = this._dotVec3(centerDelta, unitAxis);
      const overlap = radiusA + radiusB - Math.abs(distance);
      if (includeTouching ? overlap < 0.0 : overlap <= 0.0) {
        return false;
      }
      if (overlap < bestOverlap) {
        bestOverlap = overlap;
        bestAxis = distance >= 0.0 ? unitAxis : this._scaleVec3(unitAxis, -1.0);
        bestSource = source;
      }
      if (source.kind === "edge") {
        if (overlap < bestEdgeOverlap) {
          bestEdgeOverlap = overlap;
          bestEdgeAxis = distance >= 0.0 ? unitAxis : this._scaleVec3(unitAxis, -1.0);
          bestEdgeSource = source;
        }
      } else if (overlap < bestFaceOverlap) {
        bestFaceOverlap = overlap;
        bestFaceAxis = distance >= 0.0 ? unitAxis : this._scaleVec3(unitAxis, -1.0);
        bestFaceSource = source;
      }
      return true;
    };

    for (let i = 0; i < 3; i++) {
      if (!testAxis(boxA.axes[i], { kind: "faceA", axisIndex: i })) return null;
      if (!testAxis(boxB.axes[i], { kind: "faceB", axisIndex: i })) return null;
    }
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        const axis = [
          boxA.axes[i][1] * boxB.axes[j][2] - boxA.axes[i][2] * boxB.axes[j][1],
          boxA.axes[i][2] * boxB.axes[j][0] - boxA.axes[i][0] * boxB.axes[j][2],
          boxA.axes[i][0] * boxB.axes[j][1] - boxA.axes[i][1] * boxB.axes[j][0]
        ];
        if (!testAxis(axis, { kind: "edge", axisIndexA: i, axisIndexB: j })) return null;
      }
    }
    // game 用の box-box では、edge 軸が face 軸よりわずかに有利なだけなら
    // manifold を維持しやすい face 軸を優先した方が、横滑りより回転が出やすい
    // SAT の厳密最小軸だけを選ぶと、beam と box の接触が edge 1 点へ落ちやすい
    if (bestSource?.kind === "edge" && bestFaceSource) {
      const overlapGap = bestFaceOverlap - bestEdgeOverlap;
      let faceBias = Math.max(0.05, Math.min(0.35, bestFaceOverlap * 0.18));
      // edge 軸がほぼ主軸方向を向いているなら、実際には face patch が育つ途中でも
      // SAT の微差で edge 1 点へ落ちやすい
      // この条件では face manifold を優先した方が persistent patch が続きやすい
      if (bestEdgeAxis) {
        const axisDominance = Math.max(
          Math.abs(bestEdgeAxis[0]),
          Math.abs(bestEdgeAxis[1]),
          Math.abs(bestEdgeAxis[2])
        );
        if (axisDominance >= 0.72) {
          faceBias = Math.max(faceBias, 0.8);
        }
      }
      if (overlapGap <= faceBias) {
        bestOverlap = bestFaceOverlap;
        bestAxis = bestFaceAxis;
        bestSource = bestFaceSource;
      }
    }
    return {
      normal: bestAxis ?? [1.0, 0.0, 0.0],
      penetration: bestOverlap,
      point: this._getObbContactPoint(boxA, boxB, bestAxis ?? [1.0, 0.0, 0.0]),
      source: bestSource
    };
  }

  // face 上の 4 頂点を返す
  _getFaceVertices(box, axisIndex, sign) {
    const tangentIndices = [];
    for (let i = 0; i < 3; i++) {
      if (i !== axisIndex) {
        tangentIndices.push(i);
      }
    }
    const faceCenter = [
      box.center[0] + box.axes[axisIndex][0] * box.half[axisIndex] * sign,
      box.center[1] + box.axes[axisIndex][1] * box.half[axisIndex] * sign,
      box.center[2] + box.axes[axisIndex][2] * box.half[axisIndex] * sign,
    ];
    const tangentA = box.axes[tangentIndices[0]];
    const tangentB = box.axes[tangentIndices[1]];
    const halfA = box.half[tangentIndices[0]];
    const halfB = box.half[tangentIndices[1]];
    return [
      [
        faceCenter[0] - tangentA[0] * halfA - tangentB[0] * halfB,
        faceCenter[1] - tangentA[1] * halfA - tangentB[1] * halfB,
        faceCenter[2] - tangentA[2] * halfA - tangentB[2] * halfB
      ],
      [
        faceCenter[0] + tangentA[0] * halfA - tangentB[0] * halfB,
        faceCenter[1] + tangentA[1] * halfA - tangentB[1] * halfB,
        faceCenter[2] + tangentA[2] * halfA - tangentB[2] * halfB
      ],
      [
        faceCenter[0] + tangentA[0] * halfA + tangentB[0] * halfB,
        faceCenter[1] + tangentA[1] * halfA + tangentB[1] * halfB,
        faceCenter[2] + tangentA[2] * halfA + tangentB[2] * halfB
      ],
      [
        faceCenter[0] - tangentA[0] * halfA + tangentB[0] * halfB,
        faceCenter[1] - tangentA[1] * halfA + tangentB[1] * halfB,
        faceCenter[2] - tangentA[2] * halfA + tangentB[2] * halfB
      ]
    ];
  }

  // polygon を scalar <= limit で clip する
  _clipPolygonByMax(points, getScalar, limit) {
    if (!Array.isArray(points) || points.length <= 0) {
      return [];
    }
    const clipped = [];
    for (let i = 0; i < points.length; i++) {
      const current = points[i];
      const next = points[(i + 1) % points.length];
      const currentValue = getScalar(current);
      const nextValue = getScalar(next);
      const currentInside = currentValue <= limit + 1.0e-8;
      const nextInside = nextValue <= limit + 1.0e-8;
      if (currentInside && nextInside) {
        clipped.push(next);
        continue;
      }
      if (currentInside !== nextInside) {
        const denom = nextValue - currentValue;
        const t = Math.abs(denom) <= 1.0e-8 ? 0.0 : (limit - currentValue) / denom;
        clipped.push([
          current[0] + (next[0] - current[0]) * t,
          current[1] + (next[1] - current[1]) * t,
          current[2] + (next[2] - current[2]) * t
        ]);
      }
      if (!currentInside && nextInside) {
        clipped.push(next);
      }
    }
    return clipped;
  }

  // polygon を scalar >= limit で clip する
  _clipPolygonByMin(points, getScalar, limit) {
    return this._clipPolygonByMax(points, (point) => -getScalar(point), -limit);
  }

  // 3D 点列から重複を落とす
  _dedupePolygonPoints(points) {
    const unique = [];
    for (let i = 0; i < points.length; i++) {
      const exists = unique.some((point) => {
        const dx = point[0] - points[i][0];
        const dy = point[1] - points[i][1];
        const dz = point[2] - points[i][2];
        return dx * dx + dy * dy + dz * dz <= 1.0e-8;
      });
      if (!exists) {
        unique.push(points[i]);
      }
    }
    return unique;
  }

  // 基準 face と incident face を clip して manifold を作る
  _buildFaceManifold(referenceBox, incidentBox, referenceNormal, referenceAxisIndex, penetration) {
    const referenceCenter = [...referenceBox.center];
    const referenceSign = this._dotVec3(referenceNormal, referenceBox.axes[referenceAxisIndex]) >= 0.0 ? 1.0 : -1.0;
    referenceCenter[0] += referenceBox.axes[referenceAxisIndex][0] * referenceBox.half[referenceAxisIndex] * referenceSign;
    referenceCenter[1] += referenceBox.axes[referenceAxisIndex][1] * referenceBox.half[referenceAxisIndex] * referenceSign;
    referenceCenter[2] += referenceBox.axes[referenceAxisIndex][2] * referenceBox.half[referenceAxisIndex] * referenceSign;

    const tangentIndices = [];
    for (let i = 0; i < 3; i++) {
      if (i !== referenceAxisIndex) {
        tangentIndices.push(i);
      }
    }
    const tangentA = referenceBox.axes[tangentIndices[0]];
    const tangentB = referenceBox.axes[tangentIndices[1]];
    const tangentHalfA = referenceBox.half[tangentIndices[0]];
    const tangentHalfB = referenceBox.half[tangentIndices[1]];
    let incidentAxisIndex = 0;
    let incidentAxisAbsDot = -Infinity;
    for (let i = 0; i < 3; i++) {
      const axisDot = this._dotVec3(incidentBox.axes[i], referenceNormal);
      const absDot = Math.abs(axisDot);
      if (absDot > incidentAxisAbsDot) {
        incidentAxisAbsDot = absDot;
        incidentAxisIndex = i;
      }
    }
    // incident face は referenceNormal に最も平行な軸を選び、
    // そのうち reference face と向き合う側の符号を採る
    const incidentSign = this._dotVec3(incidentBox.axes[incidentAxisIndex], referenceNormal) >= 0.0 ? -1.0 : 1.0;
    let polygon = this._getFaceVertices(incidentBox, incidentAxisIndex, incidentSign);
    const offsetOnA = (point) => this._dotVec3(this._subVec3(point, referenceCenter), tangentA);
    const offsetOnB = (point) => this._dotVec3(this._subVec3(point, referenceCenter), tangentB);
    polygon = this._clipPolygonByMax(polygon, offsetOnA, tangentHalfA);
    polygon = this._clipPolygonByMin(polygon, offsetOnA, -tangentHalfA);
    polygon = this._clipPolygonByMax(polygon, offsetOnB, tangentHalfB);
    polygon = this._clipPolygonByMin(polygon, offsetOnB, -tangentHalfB);
    polygon = this._dedupePolygonPoints(polygon);
    if (polygon.length <= 0) {
      return [{
        featureKey: `obb-support:${referenceAxisIndex}`,
        penetration,
        point: this._getObbContactPoint(referenceBox, incidentBox, this._scaleVec3(referenceNormal, -1.0))
      }];
    }
    const contacts = [];
    for (let i = 0; i < polygon.length; i++) {
      const vertexDelta = this._subVec3(polygon[i], referenceCenter);
      const distance = this._dotVec3(vertexDelta, referenceNormal);
      contacts.push({
        featureKey: `obb-face:${incidentAxisIndex}:${i}`,
        penetration: Math.max(0.0, -distance),
        point: this._subVec3(polygon[i], this._scaleVec3(referenceNormal, distance))
      });
    }
    if (contacts.length <= 0) {
      const chosen = polygon[0];
      const distance = this._dotVec3(this._subVec3(chosen, referenceCenter), referenceNormal);
      return [{
        featureKey: `obb-face:${incidentAxisIndex}:0`,
        penetration: Math.max(0.0, -distance),
        point: this._subVec3(chosen, this._scaleVec3(referenceNormal, distance))
      }];
    }
    return contacts;
  }

  // normal 上で向き合う support point の中点を contact point として返す
  _getObbContactPoint(boxA, boxB, normal) {
    const supportA = [...boxA.center];
    const supportB = [...boxB.center];
    for (let i = 0; i < 3; i++) {
      const signA = this._dotVec3(normal, boxA.axes[i]) >= 0.0 ? 1.0 : -1.0;
      const signB = this._dotVec3(normal, boxB.axes[i]) >= 0.0 ? -1.0 : 1.0;
      supportA[0] += boxA.axes[i][0] * boxA.half[i] * signA;
      supportA[1] += boxA.axes[i][1] * boxA.half[i] * signA;
      supportA[2] += boxA.axes[i][2] * boxA.half[i] * signA;
      supportB[0] += boxB.axes[i][0] * boxB.half[i] * signB;
      supportB[1] += boxB.axes[i][1] * boxB.half[i] * signB;
      supportB[2] += boxB.axes[i][2] * boxB.half[i] * signB;
    }
    return [
      (supportA[0] + supportB[0]) * 0.5,
      (supportA[1] + supportB[1]) * 0.5,
      (supportA[2] + supportB[2]) * 0.5
    ];
  }

  // box-box 接触を生成する
  _buildContactWithBoxCollider(position, otherCollider, otherPosition, bodyA, bodyB, quat = null, otherQuat = null) {
    if (!(otherCollider instanceof BoxCollider)) {
      throw new Error("BoxCollider box contact requires another BoxCollider");
    }
    const contact = this._buildObbContact(
      this.getWorldInfo(position, quat),
      otherCollider.getWorldInfo(otherPosition, otherQuat)
    );
    if (contact === null) {
      return null;
    }
    let contacts = [{
      featureKey: `obb-primary:${contact.source?.kind ?? "unknown"}`,
      penetration: contact.penetration,
      point: contact.point
    }];
    if (contact.source?.kind === "faceA") {
      contacts = this._buildFaceManifold(
        this.getWorldInfo(position, quat),
        otherCollider.getWorldInfo(otherPosition, otherQuat),
        contact.normal,
        contact.source.axisIndex,
        contact.penetration
      );
    } else if (contact.source?.kind === "faceB") {
      contacts = this._buildFaceManifold(
        otherCollider.getWorldInfo(otherPosition, otherQuat),
        this.getWorldInfo(position, quat),
        this._scaleVec3(contact.normal, -1.0),
        contact.source.axisIndex,
        contact.penetration
      );
    }
    return {
      bodyA,
      bodyB,
      normal: contact.normal,
      source: contact.source ? { ...contact.source } : null,
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
