// ---------------------------------------------
// ComputeCapsuleCollider.js  2026/09/13
//   Local-Y capsule collider definition and WGSL library for ComputePhysicsSpace
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import util from "./util.js";
import Collider from "./Collider.js";
import CapsuleCollider from "./CapsuleCollider.js";
import {
  buildCapsuleBoxContact,
  buildCapsuleCapsuleContact,
  buildCapsuleSphereContact
} from "./ComputeShapeContact.js";

// Compute版Capsuleの寸法検証、CPU query、慣性計算、GPU接触用WGSLをまとめます
// CPU版と同じく芯線はlocal Y軸へ置き、body quaternionでworld方向を決めます
// GPU buffer、fixed step、solverの実行順はComputePhysicsSpaceへ残します
export default class ComputeCapsuleCollider extends Collider {
  // radiusと芯線長を保持し、正の半径でGPU接触に有効なCapsuleを構成します
  // segmentLengthは0を許可し、球へ縮退するCPU版と同じ形状境界を残します
  constructor(radius, segmentLength, options = {}) {
    super("capsule", options);
    this.radius = util.readFiniteNumber(radius, "ComputeCapsuleCollider radius", {
      minExclusive: 0
    });
    this.segmentLength = util.readFiniteNumber(segmentLength, "ComputeCapsuleCollider segmentLength", {
      min: 0
    });
    this.cpuCollider = new CapsuleCollider(this.radius, this.segmentLength, options);
  }

  // Compute BodyStateで形状を選ぶための明示的な種別名を返します
  // BoxやSphereへ寸法から読み替えず、Capsule typeをGPUへ渡します
  getComputeColliderKind() {
    return "capsule";
  }

  // CPU版と同じbroadphase種別名を返します
  getBroadphaseKind() {
    return "capsule";
  }

  // Compute Capsuleが候補を作れる相手形状を返します
  // PlaneはSpace側で別配列から処理しますが、Collider APIでは組合せを明示します
  canBroadphasePairWith(otherCollider) {
    const kind = otherCollider?.getComputeColliderKind?.();
    return kind === "capsule" || kind === "sphere" || kind === "box" || kind === "plane";
  }

  // 半径を返し、呼出側が形状寸法を再計算しないようにします
  getRadius() {
    return this.radius;
  }

  // CPU版と同じ芯線長を返します
  getSegmentLength() {
    return this.segmentLength;
  }

  // 芯線の片側長を返します
  getHalfSegment() {
    return this.segmentLength * 0.5;
  }

  // BodyStateのxyz欄へradius、halfSegment、radiusを格納する値を返します
  // この欄はBoxのhalf extentsとは意味が異なるため、Capsuleのtype値と組み合わせて解釈します
  getBodyShapeData() {
    return [this.radius, this.getHalfSegment(), this.radius];
  }

  // BodyStateへ格納するlocal Y姿勢のhalf extentsを返します
  // world AABBはgetAabb()またはWGSLのcomputeCapsuleWorldRadius()でquaternionを反映して求めます
  getHalfExtents() {
    return [this.radius, this.getHalfSegment() + this.radius, this.radius];
  }

  // CPU版と同じcenter、回転後の芯線端点、radiusのworld形状を返します
  getWorldInfo(position, quat = null) {
    return this.cpuCollider.getWorldInfo(position, quat);
  }

  // CPU版と同じく回転後の芯線端点を包むworld AABBを返します
  getAabb(position, quat = null) {
    return this.cpuCollider.getAabb(position, quat);
  }

  // CPU版と同じ円筒部・端球のray交差を、明示されたquaternion姿勢から返します
  intersectRay(position, origin, dir, maxDistance = Infinity, quat = null) {
    return this.cpuCollider.intersectRay(position, origin, dir, maxDistance, quat);
  }

  // 回転後の芯線とworld AABBの最近傍判定を返します
  overlapsAabb(position, queryMin, queryMax, quat = null) {
    return this.cpuCollider.overlapsAabb(position, queryMin, queryMax, quat);
  }

  // 回転後の芯線最近傍点によるSphere overlapを返します
  overlapSphere(position, center, radius, quat = null) {
    return this.cpuCollider.overlapSphere(position, center, radius, quat);
  }

  // Compute Collider同士のcontact dispatchを形状ペアごとのCompute式へ接続します
  // PlaneはCompute独自のnormal + planeDistance定義なのでPlane側へ明示委譲します
  buildContactWith(position, otherCollider, otherPosition, bodyA, bodyB, quat = null, otherQuat = null) {
    const kind = otherCollider?.getComputeColliderKind?.();
    if (kind === "plane") {
      return otherCollider.buildContactWith(
        otherPosition,
        this,
        position,
        bodyB,
        bodyA,
        otherQuat,
        quat
      );
    }
    if (kind === "sphere") {
      return buildCapsuleSphereContact(
        this,
        position,
        otherCollider,
        otherPosition,
        bodyA,
        bodyB,
        quat,
        otherQuat
      );
    }
    if (kind === "box") {
      return buildCapsuleBoxContact(
        this,
        position,
        otherCollider,
        otherPosition,
        bodyA,
        bodyB,
        quat,
        otherQuat
      );
    }
    if (kind !== "capsule") {
      throw new Error("ComputeCapsuleCollider contact requires a Compute Capsule, Sphere, Box, or Plane collider");
    }
    return buildCapsuleCapsuleContact(
      this,
      position,
      otherCollider,
      otherPosition,
      bodyA,
      bodyB,
      quat,
      otherQuat
    );
  }

  // CPU版Colliderのmanifold正規化を利用し、Capsule接触を共通形式へ変換します
  buildManifoldWith(position, otherCollider, otherPosition, bodyA, bodyB, quat = null, otherQuat = null) {
    const kind = otherCollider?.getComputeColliderKind?.();
    if (kind === "plane") {
      return Collider.prototype.buildManifoldWith.call(
        this,
        position,
        otherCollider,
        otherPosition,
        bodyA,
        bodyB,
        quat,
        otherQuat
      );
    }
    if (kind !== "capsule" && kind !== "sphere" && kind !== "box") {
      throw new Error("ComputeCapsuleCollider manifold requires a Compute Capsule, Sphere, Box, or Plane collider");
    }
    return Collider.prototype.buildManifoldWith.call(
      this,
      position,
      otherCollider,
      otherPosition,
      bodyA,
      bodyB,
      quat,
      otherQuat
    );
  }

  // CPU版PhysicsNodeのCapsule自動慣性と同じY軸対称の対角逆慣性を返します
  // radiusは正数として検証し、慣性計算へ有効な値を渡します
  calculateInverseInertia(inverseMass) {
    const checkedInverseMass = util.readFiniteNumber(
      inverseMass,
      "ComputeCapsuleCollider inverseMass",
      { min: 0 }
    );
    if (checkedInverseMass === 0) return [0, 0, 0];
    const radiusSq = this.radius * this.radius;
    const totalHeight = this.segmentLength + 2 * this.radius;
    return [
      12 * checkedInverseMass / (3 * radiusSq + totalHeight * totalHeight),
      2 * checkedInverseMass / radiusSq,
      12 * checkedInverseMass / (3 * radiusSq + totalHeight * totalHeight)
    ];
  }

  // ComputePhysicsSpaceのBodyState、Broad Phase、接触solver、Plane支持処理へ接続するCapsule WGSLを返します
  // local Y芯線をbody quaternionで回転し、world AABBと各形状の接触へ同じ端点を渡します
  static createWGSL() {
    return `
struct ComputeCapsuleBoxClosest {
  // Capsule芯線上の点とBox表面の最近接点を、距離の比較結果と一緒に保持します
  segmentPoint : vec3f,
  boxPoint : vec3f,
  distanceSq : f32,
};

struct ComputeCapsuleSegmentClosest {
  // 2本のCapsule芯線上で距離が最小になるworld座標の点を保持します
  pointA : vec3f,
  pointB : vec3f,
};

fn computeCapsuleWorldRadius(body : BodyState, orientation : vec4f) -> vec3f {
  // 回転後のlocal Y軸を芯線方向とし、両端を半径で広げたworld AABB半径を返します
  let radius = body.halfExtentsSleepCounter.x;
  let halfSegment = body.halfExtentsSleepCounter.y;
  let axis = abs(quatRotate(orientation, vec3f(0.0, 1.0, 0.0)));
  return vec3f(radius) + axis * halfSegment;
}

fn computeCapsulePointA(position : vec3f, orientation : vec4f, halfSegment : f32) -> vec3f {
  // local Y負方向の芯線端点をbody quaternionでworld空間へ回転します
  return position + quatRotate(orientation, vec3f(0.0, -halfSegment, 0.0));
}

fn computeCapsulePointB(position : vec3f, orientation : vec4f, halfSegment : f32) -> vec3f {
  // local Y正方向の芯線端点をbody quaternionでworld空間へ回転します
  return position + quatRotate(orientation, vec3f(0.0, halfSegment, 0.0));
}

fn computeCapsuleClosestPointOnSegment(
  pointA : vec3f,
  pointB : vec3f,
  point : vec3f
) -> vec3f {
  // 退化していない芯線では射影比率を0..1へclampし、線分上の最近傍点を返します
  let segment = pointB - pointA;
  let lengthSq = dot(segment, segment);
  if (lengthSq <= 0.00000001) { return pointA; }
  let t = clamp(dot(point - pointA, segment) / lengthSq, 0.0, 1.0);
  return pointA + segment * t;
}

fn computeCapsuleSegmentSegmentClosest(
  p1 : vec3f,
  q1 : vec3f,
  p2 : vec3f,
  q2 : vec3f
) -> ComputeCapsuleSegmentClosest {
  // 任意方向の2線分について、両方の線分範囲へ収まる最近傍比率を求めます
  let d1 = q1 - p1;
  let d2 = q2 - p2;
  let relative = p1 - p2;
  let a = dot(d1, d1);
  let e = dot(d2, d2);
  let f = dot(d2, relative);
  var s = 0.0;
  var t = 0.0;
  if (a <= 0.00000001 && e <= 0.00000001) {
    return ComputeCapsuleSegmentClosest(p1, p2);
  }
  if (a <= 0.00000001) {
    t = clamp(f / e, 0.0, 1.0);
  } else {
    let c = dot(d1, relative);
    if (e <= 0.00000001) {
      s = clamp(-c / a, 0.0, 1.0);
    } else {
      let b = dot(d1, d2);
      let denominator = a * e - b * b;
      if (abs(denominator) > 0.00000001) {
        s = clamp((b * f - c * e) / denominator, 0.0, 1.0);
      } else {
        // 平行な芯線が重なる場合は重なり中央を選び、端点由来の不要な回転力積を避けます
        let lengthA = sqrt(a);
        let axis = d1 / lengthA;
        let projectionP2 = dot(p2 - p1, axis);
        let projectionQ2 = dot(q2 - p1, axis);
        let overlapMin = max(0.0, min(projectionP2, projectionQ2));
        let overlapMax = min(lengthA, max(projectionP2, projectionQ2));
        if (overlapMin <= overlapMax) {
          let pointA = p1 + axis * ((overlapMin + overlapMax) * 0.5);
          return ComputeCapsuleSegmentClosest(
            pointA,
            computeCapsuleClosestPointOnSegment(p2, q2, pointA)
          );
        }
      }
      t = (b * s + f) / e;
      if (t < 0.0) {
        t = 0.0;
        s = clamp(-c / a, 0.0, 1.0);
      } else if (t > 1.0) {
        t = 1.0;
        s = clamp((b - c) / a, 0.0, 1.0);
      }
    }
  }
  return ComputeCapsuleSegmentClosest(p1 + d1 * s, p2 + d2 * t);
}

fn computeCapsuleContactFromClosest(
  pointA : vec3f,
  pointB : vec3f,
  radiusA : f32,
  radiusB : f32
) -> Contact {
  // 2つの最近接点を球同士として扱い、半径の和からcontact法線とpenetrationを求めます
  let delta = pointB - pointA;
  let distanceSq = dot(delta, delta);
  let radiusSum = radiusA + radiusB;
  if (distanceSq >= radiusSum * radiusSum) {
    return Contact(vec4f(0.0), vec4f(0.0));
  }
  var normal = vec3f(1.0, 0.0, 0.0);
  var distanceValue = 0.0;
  if (distanceSq > 0.00000001) {
    distanceValue = sqrt(distanceSq);
    normal = delta / distanceValue;
  }
  let pointOnA = pointA + normal * radiusA;
  let pointOnB = pointB - normal * radiusB;
  return Contact(
    vec4f(normal, radiusSum - distanceValue),
    vec4f((pointOnA + pointOnB) * 0.5, 1.0)
  );
}

fn computeCapsuleCapsuleContact(
  capsuleA : BodyState,
  positionA : vec3f,
  orientationA : vec4f,
  capsuleB : BodyState,
  orientationB : vec4f
) -> Contact {
  // 両Capsuleのlocal Y軸を回転し、任意方向の2芯線間の最近傍点から接触を作ります
  let halfA = capsuleA.halfExtentsSleepCounter.y;
  let halfB = capsuleB.halfExtentsSleepCounter.y;
  let closest = computeCapsuleSegmentSegmentClosest(
    computeCapsulePointA(positionA, orientationA, halfA),
    computeCapsulePointB(positionA, orientationA, halfA),
    computeCapsulePointA(capsuleB.position.xyz, orientationB, halfB),
    computeCapsulePointB(capsuleB.position.xyz, orientationB, halfB)
  );
  return computeCapsuleContactFromClosest(
    closest.pointA,
    closest.pointB,
    capsuleA.halfExtentsSleepCounter.x,
    capsuleB.halfExtentsSleepCounter.x
  );
}

fn computeCapsuleSphereContact(
  capsule : BodyState,
  capsulePosition : vec3f,
  capsuleOrientation : vec4f,
  sphere : BodyState
) -> Contact {
  // 回転後のCapsule芯線上でSphere中心に最も近い点を選びます
  let halfSegment = capsule.halfExtentsSleepCounter.y;
  let pointA = computeCapsuleClosestPointOnSegment(
    computeCapsulePointA(capsulePosition, capsuleOrientation, halfSegment),
    computeCapsulePointB(capsulePosition, capsuleOrientation, halfSegment),
    sphere.position.xyz
  );
  return computeCapsuleContactFromClosest(
    pointA,
    sphere.position.xyz,
    capsule.halfExtentsSleepCounter.x,
    sphere.halfExtentsSleepCounter.x
  );
}

fn computeCapsulePointOnAabb(point : vec3f, halfExtents : vec3f) -> vec3f {
  // local Boxの範囲へ点をclampし、線分とBoxの最近接計算へ使います
  return clamp(point, -halfExtents, halfExtents);
}

fn computeCapsuleTestSegmentAabb(
  segmentStart : vec3f,
  segmentDelta : vec3f,
  t : f32,
  halfExtents : vec3f,
  best : ptr<function, ComputeCapsuleBoxClosest>
) {
  // 線分の端点と各軸面との交点を調べ、線分とAABBの最短候補を更新します
  let segmentPoint = segmentStart + segmentDelta * t;
  let boxPoint = computeCapsulePointOnAabb(segmentPoint, halfExtents);
  let delta = segmentPoint - boxPoint;
  let distanceSq = dot(delta, delta);
  if (distanceSq < (*best).distanceSq) {
    (*best) = ComputeCapsuleBoxClosest(segmentPoint, boxPoint, distanceSq);
  }
}

fn computeCapsuleSegmentObbClosest(
  pointA : vec3f,
  pointB : vec3f,
  boxPosition : vec3f,
  boxOrientation : vec4f,
  boxHalfExtents : vec3f
) -> ComputeCapsuleBoxClosest {
  // Capsule芯線をBox localへ変換し、端点と面交差候補から最短点を求めます
  let localA = quatRotate(quatConjugate(boxOrientation), pointA - boxPosition);
  let localB = quatRotate(quatConjugate(boxOrientation), pointB - boxPosition);
  let segmentDelta = localB - localA;
  var best = ComputeCapsuleBoxClosest(localA, computeCapsulePointOnAabb(localA, boxHalfExtents), 1e30);
  // 線分端点とBox各面との交点を候補へ追加し、距離の最小値だけを残します
  computeCapsuleTestSegmentAabb(localA, segmentDelta, 0.0, boxHalfExtents, &best);
  computeCapsuleTestSegmentAabb(localA, segmentDelta, 1.0, boxHalfExtents, &best);
  for (var axis = 0u; axis < 3u; axis += 1u) {
    let component = segmentDelta[axis];
    if (abs(component) > 0.00000001) {
      let first = (-boxHalfExtents[axis] - localA[axis]) / component;
      let second = (boxHalfExtents[axis] - localA[axis]) / component;
      if (first >= 0.0 && first <= 1.0) {
        computeCapsuleTestSegmentAabb(localA, segmentDelta, first, boxHalfExtents, &best);
      }
      if (second >= 0.0 && second <= 1.0) {
        computeCapsuleTestSegmentAabb(localA, segmentDelta, second, boxHalfExtents, &best);
      }
    }
  }
  best.segmentPoint = boxPosition + quatRotate(boxOrientation, best.segmentPoint);
  best.boxPoint = boxPosition + quatRotate(boxOrientation, best.boxPoint);
  return best;
}

fn computeCapsuleBoxContact(
  capsule : BodyState,
  capsulePosition : vec3f,
  capsuleOrientation : vec4f,
  box : BodyState,
  boxPosition : vec3f,
  boxOrientation : vec4f
) -> Contact {
  // Capsule芯線とOBBの最近接点から接触を作り、内部時は最も近いBox面を法線に選びます
  let pointA = computeCapsulePointA(
    capsulePosition, capsuleOrientation, capsule.halfExtentsSleepCounter.y
  );
  let pointB = computeCapsulePointB(
    capsulePosition, capsuleOrientation, capsule.halfExtentsSleepCounter.y
  );
  let closest = computeCapsuleSegmentObbClosest(
    pointA,
    pointB,
    boxPosition,
    boxOrientation,
    box.halfExtentsSleepCounter.xyz
  );
  let radius = capsule.halfExtentsSleepCounter.x;
  if (closest.distanceSq > 0.00000001) {
    // Box外側では最近接2点を端球同士として扱います
    return computeCapsuleContactFromClosest(
      closest.segmentPoint,
      closest.boxPoint,
      radius,
      0.0
    );
  }
  // 芯線がBox内部に入った場合は、最短面の法線と半径から押し出しcontactを作ります
  let localSegmentPoint = quatRotate(
    quatConjugate(boxOrientation),
    closest.segmentPoint - boxPosition
  );
  let faceDistance = box.halfExtentsSleepCounter.xyz - abs(localSegmentPoint);
  var axis = 0u;
  var nearestDistance = faceDistance.x;
  if (faceDistance.y < nearestDistance) {
    axis = 1u;
    nearestDistance = faceDistance.y;
  }
  if (faceDistance.z < nearestDistance) {
    axis = 2u;
    nearestDistance = faceDistance.z;
  }
  var localNormal = vec3f(0.0);
  localNormal[axis] = select(1.0, -1.0, localSegmentPoint[axis] >= 0.0);
  let normal = quatRotate(boxOrientation, localNormal);
  return Contact(
    vec4f(normal, radius + max(0.0, nearestDistance)),
    vec4f(closest.boxPoint, 1.0)
  );
}

fn computeCapsuleMinimumPlanePoint(
  position : vec3f,
  orientation : vec4f,
  radius : f32,
  halfSegment : f32,
  normal : vec3f
) -> vec4f {
  // Plane法線方向に最も低い芯線端点を選び、端球半径を足した最低点を返します
  let pointA = computeCapsulePointA(position, orientation, halfSegment);
  let pointB = computeCapsulePointB(position, orientation, halfSegment);
  let point = select(pointA, pointB, dot(pointB, normal) < dot(pointA, normal));
  return vec4f(point - normal * radius, 1.0);
}
`;
  }
}
