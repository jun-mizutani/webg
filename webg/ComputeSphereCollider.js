// ---------------------------------------------
// ComputeSphereCollider.js  2026/09/13
//   Sphere collider definition and WGSL library for ComputePhysicsSpace
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import util from "./util.js";
import Collider from "./Collider.js";
import SphereCollider from "./SphereCollider.js";
import {
  buildSphereBoxContact,
  buildSphereCapsuleContact
} from "./ComputeShapeContact.js";

// Compute版球体の半径検証、慣性計算、球を含む接触用WGSLをまとめます
// GPU bufferとfixed stepはComputePhysicsSpaceへ残し、このclassはSphere形状に固有の計算だけを提供します
export default class ComputeSphereCollider extends Collider {
  // 半径を正の有限数として保持し、接触式へ有効な球形状を渡します
  // 長さ単位はComputePhysicsSpaceへ登録するpositionやscaleと同じworld単位です
  constructor(radius, options = {}) {
    super("sphere", options);
    this.radius = util.readFiniteNumber(radius, "ComputeSphereCollider radius", {
      minExclusive: 0
    });
    this.cpuCollider = new SphereCollider(this.radius, options);
  }

  // Broad Phaseと接触組合せが形状種類を明示的に判別するための名前を返します
  // shape寸法の3軸一致ではなく、collider kindの明示値からSphereを判定します
  getComputeColliderKind() {
    return "sphere";
  }

  // 検証済み半径をworld単位で返します
  // numberは値として渡るため、collider内部の値を保護したまま返します
  getRadius() {
    return this.cpuCollider.getRadius();
  }

  // BodyStateのshape寸法欄へ格納する3要素を返します
  // 共通AABB処理と描画側がxyzを安全に読めるよう、球では全軸へ同じ半径を記録します
  getHalfExtents() {
    return [this.radius, this.radius, this.radius];
  }

  // CPU版と同じ種別名を返し、Compute専用の形状判別と併用できるようにします
  getBroadphaseKind() {
    return "sphere";
  }

  // SphereがCompute版で接触候補を作れる相手形状を返します
  canBroadphasePairWith(otherCollider) {
    const kind = otherCollider?.getComputeColliderKind?.();
    return kind === "sphere" || kind === "box" || kind === "capsule" || kind === "plane";
  }

  // CPU版と同じcenter、radiusのworld形状情報を返します
  getWorldInfo(position) {
    return this.cpuCollider.getWorldInfo(position);
  }

  // CPU版と同じ球AABBを返します
  getAabb(position) {
    return this.cpuCollider.getAabb(position);
  }

  // CPU版と同じray-sphere交差を返します
  intersectRay(position, origin, dir, maxDistance = Infinity) {
    return this.cpuCollider.intersectRay(position, origin, dir, maxDistance);
  }

  // CPU版と同じ最近傍点によるAABB overlapを返します
  overlapsAabb(position, queryMin, queryMax) {
    return this.cpuCollider.overlapsAabb(position, queryMin, queryMax);
  }

  // CPU版と同じSphere overlap結果を返します
  overlapSphere(position, center, radius) {
    return this.cpuCollider.overlapSphere(position, center, radius);
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
    if (kind === "box") {
      return buildSphereBoxContact(
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
    if (kind === "capsule") {
      return buildSphereCapsuleContact(
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
    if (kind !== "sphere") {
      throw new Error("ComputeSphereCollider contact requires a Compute Sphere, Box, Capsule, or Plane collider");
    }
    return this.cpuCollider.buildContactWith(
      position,
      otherCollider.cpuCollider,
      otherPosition,
      bodyA,
      bodyB,
      quat,
      otherQuat
    );
  }

  // CPU版Colliderのmanifold正規化を利用し、Compute版でも形状接触の共通形式を返します
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
    if (kind !== "box" && kind !== "sphere" && kind !== "capsule") {
      throw new Error("ComputeSphereCollider manifold requires a Compute Sphere, Box, Capsule, or Plane collider");
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

  // 一様密度の中実球について、半径と逆質量からlocal座標の対角逆慣性を返します
  // 固定bodyは逆質量0なので角運動も0とし、半径は検証済みの値を使います
  calculateInverseInertia(inverseMass) {
    const checkedInverseMass = util.readFiniteNumber(
      inverseMass,
      "ComputeSphereCollider inverseMass",
      { min: 0 }
    );
    if (checkedInverseMass === 0) return [0, 0, 0];
    const value = 5 * checkedInverseMass / (2 * this.radius * this.radius);
    return [value, value, value];
  }

  // ComputePhysicsSpaceの共通BodyState、Contact、quaternion宣言へ接続するSphere用WGSLを返します
  // 法線は常にbody Aからbody Bへ向け、共通solverの符号規則を形状組合せへ適用します
  static createWGSL() {
    return `
fn computeSphereWorldRadius(body : BodyState) -> vec3f {
  // sphere半径を3軸へ複製し、共通Broad Phaseのworld radius形式へ合わせます
  return vec3f(body.halfExtentsSleepCounter.x);
}

fn computeSphereContact(bodyA : BodyState, positionA : vec3f, bodyB : BodyState) -> Contact {
  // 2球の中心距離を調べ、重なりがあれば中心線法線と両表面の中点を返します
  let radiusA = bodyA.halfExtentsSleepCounter.x;
  let radiusB = bodyB.halfExtentsSleepCounter.x;
  let delta = bodyB.position.xyz - positionA;
  let distanceSq = dot(delta, delta);
  let radiusSum = radiusA + radiusB;
  if (distanceSq >= radiusSum * radiusSum) {
    return Contact(vec4f(0.0), vec4f(0.0));
  }
  var normal = vec3f(1.0, 0.0, 0.0);
  var distance = 0.0;
  if (distanceSq > 0.00000001) {
    distance = sqrt(distanceSq);
    normal = delta / distance;
  }
  let pointA = positionA + normal * radiusA;
  let pointB = bodyB.position.xyz - normal * radiusB;
  return Contact(vec4f(normal, radiusSum - distance), vec4f((pointA + pointB) * 0.5, 1.0));
}

fn computeSphereBoxContact(
  sphere : BodyState,
  spherePosition : vec3f,
  box : BodyState,
  boxPosition : vec3f,
  boxOrientation : vec4f
) -> Contact {
  // Sphere中心をBoxのlocal座標へ移し、最近傍点または内部の最近接面からcontactを作ります
  let localCenter = quatRotate(quatConjugate(boxOrientation), spherePosition - boxPosition);
  let halfExtents = box.halfExtentsSleepCounter.xyz;
  let closestLocal = clamp(localCenter, -halfExtents, halfExtents);
  let closestWorld = boxPosition + quatRotate(boxOrientation, closestLocal);
  let delta = closestWorld - spherePosition;
  let distanceSq = dot(delta, delta);
  let radius = sphere.halfExtentsSleepCounter.x;
  if (distanceSq >= radius * radius) {
    return Contact(vec4f(0.0), vec4f(0.0));
  }
  var normal = vec3f(1.0, 0.0, 0.0);
  var penetration = radius;
  var point = closestWorld;
  if (distanceSq > 0.00000001) {
    // Box外側ではSphere中心から最近傍点へ向かう方向を法線とします
    let distance = sqrt(distanceSq);
    normal = delta / distance;
    penetration = radius - distance;
    point = (spherePosition + normal * radius + closestWorld) * 0.5;
  } else {
    // Box内部では最も近い面の外向き法線を反転し、Sphereを外へ押し出す接触を作ります
    let faceDistance = halfExtents - abs(localCenter);
    var exitLocal = vec3f(select(-1.0, 1.0, localCenter.x >= 0.0), 0.0, 0.0);
    var nearestDistance = faceDistance.x;
    if (faceDistance.y < nearestDistance) {
      nearestDistance = faceDistance.y;
      exitLocal = vec3f(0.0, select(-1.0, 1.0, localCenter.y >= 0.0), 0.0);
    }
    if (faceDistance.z < nearestDistance) {
      nearestDistance = faceDistance.z;
      exitLocal = vec3f(0.0, 0.0, select(-1.0, 1.0, localCenter.z >= 0.0));
    }
    let exitNormal = quatRotate(boxOrientation, exitLocal);
    normal = -exitNormal;
    penetration = radius + nearestDistance;
    point = spherePosition + exitNormal * nearestDistance;
  }
  return Contact(vec4f(normal, penetration), vec4f(point, 1.0));
}

fn computeSphereMinimumPlanePoint(position : vec3f, radius : f32, normal : vec3f) -> vec4f {
  // Plane法線方向へ半径だけ移動した球の最低点を返します
  return vec4f(position - normal * radius, 1.0);
}
`;
  }
}
