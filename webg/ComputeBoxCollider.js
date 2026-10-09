// ---------------------------------------------
// ComputeBoxCollider.js  2026/09/14
//   Box collider definition and WGSL library for ComputePhysicsSpace
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import util from "./util.js";
import Collider from "./Collider.js";
import BoxCollider from "./BoxCollider.js";
import {
  buildBoxCapsuleContact,
  buildBoxSphereContact
} from "./ComputeShapeContact.js";

// Compute版直方体の寸法検証、慣性計算、OBB接触用WGSLをまとめます
// GPU bufferとfixed stepはComputePhysicsSpaceへ残し、このclassはBox形状に固有の計算だけを提供します
export default class ComputeBoxCollider extends Collider {
  // full sizeを検証して保持し、既存BoxColliderと同じくgetHalfExtents()で半サイズを公開します
  // 0以下の軸を微小値へ置き換えず、体積を持たないBoxとして初期化時に拒否します
  constructor(size, options = {}) {
    super("box", options);
    if (!Array.isArray(size) || size.length !== 3) {
      throw new Error("ComputeBoxCollider size must be a 3 element array");
    }
    this.size = size.map((entry, index) => {
      const checked = util.readFiniteNumber(entry, `ComputeBoxCollider size[${index}]`, {
        minExclusive: 0
      });
      return checked;
    });
    this.cpuCollider = new BoxCollider(this.size, options);
  }

  // full sizeの各軸を半分にしたOBB half extentsを新しい配列で返します
  // 呼出側へ新しい配列を返し、colliderに保存したsizeを保護します
  getHalfExtents() {
    return this.cpuCollider.getHalfExtents();
  }

  // Broad Phaseと接触組合せが形状種類を明示的に判別するための名前を返します
  // Sphereとの混在時もcollider kindを明示値から判定します
  getComputeColliderKind() {
    return "box";
  }

  // CPU版と同じ種別名を返し、queryやmanifoldの共通処理から形状を判別できるようにします
  // Compute専用のgetComputeColliderKindを残したまま、CPU版のbroadphase APIも提供します
  getBroadphaseKind() {
    return "box";
  }

  // BoxがCompute版で接触候補を作れる相手形状を返します
  // CPU版Colliderを候補へ混ぜず、local-Y CapsuleをCompute Capsuleとして明示的に受け付けます
  canBroadphasePairWith(otherCollider) {
    const kind = otherCollider?.getComputeColliderKind?.();
    return kind === "box" || kind === "sphere" || kind === "capsule" || kind === "plane";
  }

  // CPU版と同じcenter、half、world axesの形状情報を返します
  // ComputePhysicsSpaceのGPU接触とは別に、readback後の形状queryとmanifoldで利用できます
  getWorldInfo(position, quat = null) {
    return this.cpuCollider.getWorldInfo(position, quat);
  }

  // 回転済みBoxの8頂点を返し、Plane支持や複数contact生成へ利用できるようにします
  getVertices(position, quat = null) {
    return this.cpuCollider.getVertices(position, quat);
  }

  // 回転を含むworld AABBを返します
  getAabb(position, quat = null) {
    return this.cpuCollider.getAabb(position, quat);
  }

  // CPU版と同じOBB slab判定でray hitを返します
  intersectRay(position, origin, dir, maxDistance = Infinity, quat = null) {
    return this.cpuCollider.intersectRay(position, origin, dir, maxDistance, quat);
  }

  // CPU版と同じ15軸SATでAABBとの重なりを判定します
  overlapsAabb(position, queryMin, queryMax, quat = null) {
    return this.cpuCollider.overlapsAabb(position, queryMin, queryMax, quat);
  }

  // CPU版と同じ最近傍点計算でSphere overlapを返します
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
      return buildBoxSphereContact(
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
      return buildBoxCapsuleContact(
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
    if (kind !== "box") {
      throw new Error("ComputeBoxCollider contact requires a Compute Box, Sphere, Capsule, or Plane collider");
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

  // CPU版Colliderのmanifold正規化を利用し、face接触では複数contactを保持します
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
      throw new Error("ComputeBoxCollider manifold requires a Compute Box, Sphere, Capsule, or Plane collider");
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

  // 一様密度直方体の半サイズと逆質量からlocal座標の対角逆慣性を返します
  // 固定bodyは逆質量0なので角運動も0とし、寸法は検証済みの入力値を使います
  calculateInverseInertia(inverseMass) {
    const checkedInverseMass = util.readFiniteNumber(
      inverseMass,
      "ComputeBoxCollider inverseMass",
      { min: 0 }
    );
    if (checkedInverseMass === 0) return [0, 0, 0];
    const half = this.getHalfExtents();
    return [
      3 * checkedInverseMass / (half[1] ** 2 + half[2] ** 2),
      3 * checkedInverseMass / (half[0] ** 2 + half[2] ** 2),
      3 * checkedInverseMass / (half[0] ** 2 + half[1] ** 2)
    ];
  }

  // ComputePhysicsSpaceの共通quaternion、BodyState、Contact、params宣言へ接続するBox用WGSLを返します
  // 関数名へcomputeBox接頭辞を付け、Sphereなど別形状のsupport関数と衝突しない名前にします
  static createWGSL() {
    return `
fn computeBoxWorldRadius(orientation : vec4f, halfExtents : vec3f) -> vec3f {
  // 回転済みOBBを包むworld軸方向の半径を求め、Broad Phase AABBへ渡します
  let axisX = quatRotate(orientation, vec3f(1.0, 0.0, 0.0));
  let axisY = quatRotate(orientation, vec3f(0.0, 1.0, 0.0));
  let axisZ = quatRotate(orientation, vec3f(0.0, 0.0, 1.0));
  return abs(axisX) * halfExtents.x + abs(axisY) * halfExtents.y + abs(axisZ) * halfExtents.z;
}

fn computeBoxCornerLocal(halfExtents : vec3f, cornerIndex : u32) -> vec3f {
  // cornerIndexの3bitを各軸の符号へ展開し、OBBの8頂点を作ります
  return vec3f(
    select(-halfExtents.x, halfExtents.x, (cornerIndex & 1u) != 0u),
    select(-halfExtents.y, halfExtents.y, (cornerIndex & 2u) != 0u),
    select(-halfExtents.z, halfExtents.z, (cornerIndex & 4u) != 0u)
  );
}

fn computeBoxSupportFeatureCenter(
  position : vec3f,
  orientation : vec4f,
  halfExtents : vec3f,
  direction : vec3f
) -> vec3f {
  // 指定方向のsupport featureに属する頂点を集め、単一点ではなく代表中心を返します
  var maximum = -1e30;
  var projections : array<f32, 8>;
  var points : array<vec3f, 8>;
  for (var index = 0u; index < 8u; index += 1u) {
    let point = position + quatRotate(orientation, computeBoxCornerLocal(halfExtents, index));
    points[index] = point;
    projections[index] = dot(point, direction);
    maximum = max(maximum, projections[index]);
  }
  var sum = vec3f(0.0);
  var count = 0u;
  // projection差がtolerance以内の頂点を同じ面または辺としてまとめます
  for (var index = 0u; index < 8u; index += 1u) {
    if (maximum - projections[index] <= params.scale0.w) {
      sum += points[index];
      count += 1u;
    }
  }
  return sum / f32(count);
}

fn computeBoxTestSatAxis(
  axisInput : vec3f,
  centerDelta : vec3f,
  axesA : mat3x3f,
  extentsA : vec3f,
  axesB : mat3x3f,
  extentsB : vec3f,
  best : ptr<function, vec4f>
) -> bool {
  // SATの一軸について投影間隔を調べ、最小重なりの軸をcontact法線候補へ保存します
  let lengthSq = dot(axisInput, axisInput);
  if (lengthSq < 0.00000001) { return true; }
  let axis = axisInput * inverseSqrt(lengthSq);
  let radiusA = extentsA.x * abs(dot(axesA[0], axis))
    + extentsA.y * abs(dot(axesA[1], axis))
    + extentsA.z * abs(dot(axesA[2], axis));
  let radiusB = extentsB.x * abs(dot(axesB[0], axis))
    + extentsB.y * abs(dot(axesB[1], axis))
    + extentsB.z * abs(dot(axesB[2], axis));
  let signedDistance = dot(centerDelta, axis);
  let overlap = radiusA + radiusB - abs(signedDistance);
  if (overlap <= 0.0) { return false; }
  if (overlap < (*best).w) {
    (*best) = vec4f(select(-axis, axis, signedDistance >= 0.0), overlap);
  }
  return true;
}

// 面接触のincident四角形をreference面の側面と接触平面で一度だけ切り取り、最大4点と代表点を共有します
// 4接触点のsolverが同じclip結果を参照するため、点ごとに同じ多角形を生成し直しません
struct ComputeBoxContactManifold {
  normalPenetration : vec4f,
  representativePoint : vec4f,
  points : array<vec4f, 4>,
  pointCount : u32,
};

fn emptyComputeBoxContactManifold() -> ComputeBoxContactManifold {
  var result : ComputeBoxContactManifold;
  result.normalPenetration = vec4f(0.0);
  result.representativePoint = vec4f(0.0);
  result.pointCount = 0u;
  for (var index = 0u; index < 4u; index += 1u) {
    result.points[index] = vec4f(0.0);
  }
  return result;
}

fn computeBoxFaceContactManifold(
  referencePosition : vec3f, referenceAxes : mat3x3f, referenceExtents : vec3f,
  referenceAxis : u32, normal : vec3f,
  incidentPosition : vec3f, incidentAxes : mat3x3f, incidentExtents : vec3f
) -> ComputeBoxContactManifold {
  var result = emptyComputeBoxContactManifold();
  let faceCenter = referencePosition + normal * referenceExtents[referenceAxis];
  var incidentAxis = 0u;
  for (var axis = 1u; axis < 3u; axis += 1u) {
    if (abs(dot(incidentAxes[axis], normal)) > abs(dot(incidentAxes[incidentAxis], normal))) {
      incidentAxis = axis;
    }
  }
  let incidentNormal = incidentAxes[incidentAxis]
    * select(1.0, -1.0, dot(incidentAxes[incidentAxis], normal) >= 0.0);
  let center = incidentPosition + incidentNormal * incidentExtents[incidentAxis];
  let u = (incidentAxis + 1u) % 3u;
  let v = (incidentAxis + 2u) % 3u;
  let edgeU = incidentAxes[u] * incidentExtents[u];
  let edgeV = incidentAxes[v] * incidentExtents[v];
  var polygon : array<vec3f, 16>;
  polygon[0] = center - edgeU - edgeV;
  polygon[1] = center + edgeU - edgeV;
  polygon[2] = center + edgeU + edgeV;
  polygon[3] = center - edgeU + edgeV;
  var count = 4u;
  // 4側面で有限な面積へ制限し、最後の平面で実際に触れている部分を選びます
  for (var side = 0u; side < 5u; side += 1u) {
    var clipNormal = normal;
    var limit = params.scale0.y;
    if (side < 4u) {
      let axis = (referenceAxis + 1u + side / 2u) % 3u;
      clipNormal = referenceAxes[axis] * select(-1.0, 1.0, side % 2u == 0u);
      limit = referenceExtents[axis];
    }
    var output : array<vec3f, 16>;
    var outputCount = 0u;
    for (var index = 0u; index < count; index += 1u) {
      let current = polygon[index];
      let previous = polygon[(index + count - 1u) % count];
      let distance = dot(current - faceCenter, clipNormal) - limit;
      let previousDistance = dot(previous - faceCenter, clipNormal) - limit;
      if ((distance <= 0.0) != (previousDistance <= 0.0)) {
        output[outputCount] = previous + (current - previous)
          * (previousDistance / (previousDistance - distance));
        outputCount += 1u;
      }
      if (distance <= 0.0) {
        output[outputCount] = current;
        outputCount += 1u;
      }
    }
    polygon = output;
    count = outputCount;
    if (count == 0u) { return result; }
  }
  var centroid = vec3f(0.0);
  for (var index = 0u; index < count; index += 1u) {
    centroid += polygon[index];
  }
  centroid /= f32(count);
  result.representativePoint = vec4f(
    centroid - normal * dot(centroid - faceCenter, normal) * 0.5,
    1.0
  );
  result.pointCount = min(count, 4u);
  for (var pointIndex = 0u; pointIndex < result.pointCount; pointIndex += 1u) {
    let selectedIndex = select(pointIndex, pointIndex * count / 4u, count > 4u);
    // 頂点を面の重心へ少し寄せ、clip境界の丸め誤差で接触点が面外へ出ることを抑えます
    let vertex = mix(polygon[selectedIndex], centroid, 0.15);
    result.points[pointIndex] = vec4f(
      vertex - normal * dot(vertex - faceCenter, normal) * 0.5,
      1.0
    );
  }
  return result;
}

fn computeBoxContactManifold(
  bodyA : BodyState,
  positionA : vec3f,
  orientationA : vec4f,
  bodyB : BodyState
) -> ComputeBoxContactManifold {
  var result = emptyComputeBoxContactManifold();
  // 面法線6軸と辺同士の外積9軸を検査し、最小penetration軸から接触点を作ります
  let orientationB = quatNormalize(bodyB.orientation);
  let axesA = mat3x3f(
    quatRotate(orientationA, vec3f(1.0, 0.0, 0.0)),
    quatRotate(orientationA, vec3f(0.0, 1.0, 0.0)),
    quatRotate(orientationA, vec3f(0.0, 0.0, 1.0))
  );
  let axesB = mat3x3f(
    quatRotate(orientationB, vec3f(1.0, 0.0, 0.0)),
    quatRotate(orientationB, vec3f(0.0, 1.0, 0.0)),
    quatRotate(orientationB, vec3f(0.0, 0.0, 1.0))
  );
  let delta = bodyB.position.xyz - positionA;
  var best = vec4f(0.0, 0.0, 0.0, 1e30);
  for (var axis = 0u; axis < 3u; axis += 1u) {
    // 各Boxの面法線を検査し、分離軸があれば直ちに非接触を返します
    if (!computeBoxTestSatAxis(
      axesA[axis], delta, axesA, bodyA.halfExtentsSleepCounter.xyz,
      axesB, bodyB.halfExtentsSleepCounter.xyz, &best
    )) { return result; }
    if (!computeBoxTestSatAxis(
      axesB[axis], delta, axesA, bodyA.halfExtentsSleepCounter.xyz,
      axesB, bodyB.halfExtentsSleepCounter.xyz, &best
    )) { return result; }
  }
  for (var axisA = 0u; axisA < 3u; axisA += 1u) {
    // edge-edge軸を追加検査し、回転Box同士の分離を見落とさないようにします
    for (var axisB = 0u; axisB < 3u; axisB += 1u) {
      if (!computeBoxTestSatAxis(
        cross(axesA[axisA], axesB[axisB]), delta,
        axesA, bodyA.halfExtentsSleepCounter.xyz,
        axesB, bodyB.halfExtentsSleepCounter.xyz, &best
      )) { return result; }
    }
  }
  result.normalPenetration = best;
  // SAT法線が面法線と一致する場合は、有限な面同士の重なりを作用点へ使います
  // 面法線以外のSAT軸は辺同士の接触として、後段のsupport featureで処理します
  let bodyADynamic = bodyA.linearVelocityInvMass.w > 0.0;
  let bodyBDynamic = bodyB.linearVelocityInvMass.w > 0.0;
  // 有限面の支持点補正はdynamic-staticの接触へ適用し、dynamic-dynamicはCPU版と同じsupport中心を使います
  if (bodyADynamic != bodyBDynamic) {
    for (var axis = 0u; axis < 3u; axis += 1u) {
      if (abs(dot(axesB[axis], best.xyz)) > 0.99999) {
        var face = computeBoxFaceContactManifold(
          bodyB.position.xyz, axesB, bodyB.halfExtentsSleepCounter.xyz, axis, -best.xyz,
          positionA, axesA, bodyA.halfExtentsSleepCounter.xyz
        );
        face.normalPenetration = best;
        return face;
      }
      if (abs(dot(axesA[axis], best.xyz)) > 0.99999) {
        var face = computeBoxFaceContactManifold(
          positionA, axesA, bodyA.halfExtentsSleepCounter.xyz, axis, best.xyz,
          bodyB.position.xyz, axesB, bodyB.halfExtentsSleepCounter.xyz
        );
        face.normalPenetration = best;
        return face;
      }
    }
  }
  let pointA = computeBoxSupportFeatureCenter(
    positionA, orientationA, bodyA.halfExtentsSleepCounter.xyz, best.xyz
  );
  let pointB = computeBoxSupportFeatureCenter(
    bodyB.position.xyz, orientationB, bodyB.halfExtentsSleepCounter.xyz, -best.xyz
  );
  // A側とB側のsupport feature中心の中点をsolverの作用点へ渡します
  result.representativePoint = vec4f((pointA + pointB) * 0.5, 1.0);
  result.points[0] = result.representativePoint;
  result.pointCount = 1u;
  return result;
}

fn computeBoxContact(
  bodyA : BodyState,
  positionA : vec3f,
  orientationA : vec4f,
  bodyB : BodyState
) -> Contact {
  let manifold = computeBoxContactManifold(bodyA, positionA, orientationA, bodyB);
  return Contact(manifold.normalPenetration, manifold.representativePoint);
}

fn computeBoxMinimumPlanePoint(
  position : vec3f,
  orientation : vec4f,
  halfExtents : vec3f,
  normal : vec3f
) -> vec4f {
  // Plane法線方向の最深頂点と、許容範囲に入る支持頂点数を同時に求めます
  var minimum = 1e30;
  var point = vec3f(0.0);
  var supportCount = 0u;
  for (var index = 0u; index < 8u; index += 1u) {
    let candidate = position + quatRotate(orientation, computeBoxCornerLocal(halfExtents, index));
    let projection = dot(candidate, normal);
    if (projection < minimum) {
      minimum = projection;
      point = candidate;
    }
  }
  for (var index = 0u; index < 8u; index += 1u) {
    let candidate = position + quatRotate(orientation, computeBoxCornerLocal(halfExtents, index));
    if (dot(candidate, normal) <= minimum + params.scale0.y) { supportCount += 1u; }
  }
  return vec4f(point, f32(supportCount));
}

  // PlaneのplaneDistanceとposition slopで実際に接触候補となるBox corner数を数えます
// 最深cornerからの相対距離ではなくPlane位置を基準にし、作用点生成とsleep支持判定の集合を一致させます
fn computeBoxPlaneSupportCount(
  position : vec3f,
  orientation : vec4f,
  halfExtents : vec3f,
  normal : vec3f,
  planeLimit : f32
) -> u32 {
  // Plane式を基準にsupport頂点を数え、最深頂点との差ではない支持集合を作ります
  var supportCount = 0u;
  for (var index = 0u; index < 8u; index += 1u) {
    let candidate = position + quatRotate(orientation, computeBoxCornerLocal(halfExtents, index));
    if (dot(candidate, normal) <= planeLimit + params.scale0.y) {
      supportCount += 1u;
    }
  }
  return supportCount;
}

// Plane上の2接線軸へpointを写し、支持辺と重心投影の距離を同じ単位で比較します
// 法線の向きだけから接線軸を決め、Box colliderへ共通の接触式を適用します
fn computeBoxPlaneTangentCoordinates(point : vec3f, normal : vec3f) -> vec2f {
  let tangentSeed = select(
    vec3f(1.0, 0.0, 0.0),
    vec3f(0.0, 1.0, 0.0),
    abs(normal.x) > 0.5
  );
  let tangentA = normalize(cross(normal, tangentSeed));
  let tangentB = normalize(cross(normal, tangentA));
  return vec2f(dot(point, tangentA), dot(point, tangentB));
}

// 実接触cornerの支持辺または支持三角形へbody重心のPlane投影が入るかを判定します
// 1点支持は常にfalseとし、2点支持は辺からposition slop以内、3点以上は三角形内だけを許可します
fn computeBoxPlaneSupportBalance(
  position : vec3f,
  orientation : vec4f,
  halfExtents : vec3f,
  normal : vec3f,
  planeLimit : f32
) -> bool {
  // 支持頂点をPlane接線座標へ投影し、辺または三角形が重心投影を支えるか判定します
  var supportPoints : array<vec2f, 8>;
  var supportCount = 0u;
  for (var cornerIndex = 0u; cornerIndex < 8u; cornerIndex += 1u) {
    let candidate = position + quatRotate(orientation, computeBoxCornerLocal(halfExtents, cornerIndex));
    if (dot(candidate, normal) <= planeLimit + params.scale0.y) {
      supportPoints[supportCount] = computeBoxPlaneTangentCoordinates(candidate, normal);
      supportCount += 1u;
    }
  }
  if (supportCount < 2u) { return false; }
  // 2点支持では重心投影と支持辺の距離を調べ、支持点数に応じた安定性を判定します
  let center = computeBoxPlaneTangentCoordinates(position, normal);

  for (var firstIndex = 0u; firstIndex < 8u; firstIndex += 1u) {
    if (firstIndex >= supportCount) { break; }
    for (var secondIndex = firstIndex + 1u; secondIndex < 8u; secondIndex += 1u) {
      if (secondIndex >= supportCount) { break; }
      let edge = supportPoints[secondIndex] - supportPoints[firstIndex];
      let edgeLengthSq = dot(edge, edge);
      if (edgeLengthSq > 0.00000001) {
        let projection = clamp(
          dot(center - supportPoints[firstIndex], edge) / edgeLengthSq,
          0.0,
          1.0
        );
        let nearest = supportPoints[firstIndex] + edge * projection;
        if (distance(center, nearest) <= params.scale0.y) { return true; }
      }
    }
  }
  if (supportCount < 3u) { return false; }

  // 3点以上では支持三角形のbarycentric座標へ入り、面内支持だけを許可します
  for (var firstIndex = 0u; firstIndex < 8u; firstIndex += 1u) {
    if (firstIndex >= supportCount) { break; }
    for (var secondIndex = firstIndex + 1u; secondIndex < 8u; secondIndex += 1u) {
      if (secondIndex >= supportCount) { break; }
      for (var thirdIndex = secondIndex + 1u; thirdIndex < 8u; thirdIndex += 1u) {
        if (thirdIndex >= supportCount) { break; }
        let edgeA = supportPoints[secondIndex] - supportPoints[firstIndex];
        let edgeB = supportPoints[thirdIndex] - supportPoints[firstIndex];
        let denominator = edgeA.x * edgeB.y - edgeA.y * edgeB.x;
        if (abs(denominator) > 0.00000001) {
          let toCenter = center - supportPoints[firstIndex];
          let coordinateA = (toCenter.x * edgeB.y - toCenter.y * edgeB.x) / denominator;
          let coordinateB = (edgeA.x * toCenter.y - edgeA.y * toCenter.x) / denominator;
          if (coordinateA >= -0.000001
            && coordinateB >= -0.000001
            && coordinateA + coordinateB <= 1.000001) {
            return true;
          }
        }
      }
    }
  }
  return false;
}

// Planeのposition slop内へ実際に入ったBox頂点だけを平均し、impulseの作用点を返します
// 呼出側は最深頂点のpenetrationが正であることを確認してから呼ぶため、contactCountは必ず1以上です
fn computeBoxActivePlaneContactCenter(
  position : vec3f,
  orientation : vec4f,
  halfExtents : vec3f,
  normal : vec3f,
  planeLimit : f32
) -> vec3f {
  // Planeの許容範囲内にあるBox頂点を平均し、複数点支持の接触中心を作ります
  var contactSum = vec3f(0.0);
  var contactCount = 0u;
  for (var index = 0u; index < 8u; index += 1u) {
    let candidate = position + quatRotate(orientation, computeBoxCornerLocal(halfExtents, index));
    if (dot(candidate, normal) <= planeLimit + params.scale0.y) {
      contactSum += candidate;
      contactCount += 1u;
    }
  }
  // 0件を別の頂点へ置き換えず、呼出条件が壊れた場合は除算結果を非有限値として検出可能にします
  return contactSum / f32(contactCount);
}
`;
  }
}
