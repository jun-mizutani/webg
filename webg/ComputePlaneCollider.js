// ---------------------------------------------
// ComputePlaneCollider.js  2026/09/14
//   Plane collider definition and WGSL library for ComputePhysicsSpace
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import util from "./util.js";
import Collider from "./Collider.js";

// Compute版固定平面のworld法線、planeDistance、動的形状との接触用WGSLをまとめます
// 平面はdot(position, normal) >= planeDistanceを有効側とし、厚みを持たない片面Planeとして扱います
export default class ComputePlaneCollider extends Collider {
  // world法線を正規化し、平面式のplaneDistanceを有限数として保持します
  // 0法線を既定の上向き法線へ置き換えず、平面を定義できない入力として拒否します
  constructor(normal, options = {}) {
    super("plane");
    const opts = util.readPlainObject(options, "ComputePlaneCollider options", {});
    this.id = opts.id;
    this.materialId = opts.materialId;
    this.material = opts.material;
    if (opts.materialId !== undefined && opts.material !== undefined) throw new Error("Specify Plane materialId or material");
    if (opts.offset !== undefined) {
      throw new Error("ComputePlaneCollider options.offset was renamed to options.planeDistance");
    }
    if (!Array.isArray(normal) || normal.length !== 3) {
      throw new Error("ComputePlaneCollider normal must be a 3 element array");
    }
    const checked = normal.map((entry, index) =>
      util.readFiniteNumber(entry, `ComputePlaneCollider normal[${index}]`)
    );
    const length = Math.hypot(checked[0], checked[1], checked[2]);
    if (length <= 0) throw new Error("ComputePlaneCollider normal must not be zero");
    this.normal = checked.map((entry) => entry / length);
    this.planeDistance = util.readOptionalFiniteNumber(
      opts.planeDistance,
      "ComputePlaneCollider planeDistance",
      0
    );
  }

  // Broad Phaseと接触組合せが形状種類を明示的に判別するための名前を返します
  // BoxやSphereとの組合せでもcollider kindを明示値から判定します
  getComputeColliderKind() {
    return "plane";
  }

  // CPU版と同じ種別名を返し、broadphase APIを共通化します
  getBroadphaseKind() {
    return "plane";
  }

  // Planeが候補を作れる相手形状を返し、動的形状との接触候補を生成します
  canBroadphasePairWith(otherCollider) {
    const kind = otherCollider?.getComputeColliderKind?.();
    return kind === "box" || kind === "sphere" || kind === "capsule";
  }

  // 正規化済みworld法線を新しい配列として返します
  // 呼出側へ新しい配列を返し、平面bufferの値を保護します
  getNormal() {
    return [...this.normal];
  }

  // dot(position, normal)と比較するworld planeDistanceを返します
  // planeDistanceは法線を正規化した後の距離単位として、正規化法線と組み合わせます
  getPlaneDistance() {
    return this.planeDistance;
  }

  // CPU版Colliderから継承するworld position queryをComputeの平面式へ合わせて返します
  // scalar planeDistanceをvec3として基底実装へ渡さず、normal方向の平面上のpointをworld positionとします
  getWorldPosition(position = [0, 0, 0]) {
    return [...this.getWorldInfo(position).point];
  }

  // Planeのnormalとworld planeDistanceからCPU queryと接触式が使うpointを返します
  // ComputePlaneColliderのplaneDistanceはCPU PlaneColliderの位置offsetではなく平面方程式の距離です
  getWorldInfo(position = [0, 0, 0]) {
    const base = this._readVec3(position, "ComputePlaneCollider position");
    return {
      normal: [...this.normal],
      point: [
        base[0] + this.normal[0] * this.planeDistance,
        base[1] + this.normal[1] * this.planeDistance,
        base[2] + this.normal[2] * this.planeDistance
      ]
    };
  }

  // CPU版と同じray-plane交差を返します
  intersectRay(position, origin, dir, maxDistance = Infinity) {
    const plane = this.getWorldInfo(position);
    const rayOrigin = this._readVec3(origin, "ComputePlaneCollider ray origin");
    const rayDir = this._readVec3(dir, "ComputePlaneCollider ray dir");
    const rayMaxDistance = maxDistance === Infinity
      ? Infinity
      : this._readFiniteNumber(maxDistance, "ComputePlaneCollider ray maxDistance", { min: 0 });
    const denominator = this._dotVec3(rayDir, plane.normal);
    if (Math.abs(denominator) <= 1.0e-8) return null;
    const distance = this._dotVec3(this._subVec3(plane.point, rayOrigin), plane.normal) / denominator;
    if (distance < 0 || distance > rayMaxDistance) return null;
    return {
      distance,
      position: this._addVec3(rayOrigin, this._scaleVec3(rayDir, distance)),
      normal: denominator < 0 ? [...plane.normal] : this._scaleVec3(plane.normal, -1)
    };
  }

  // PlaneとCompute Box/Sphere/Capsuleのcontactをnormal + planeDistance定義で生成します
  // body側のCPU Colliderへ変換せず、Compute colliderの頂点・半径APIを直接利用します
  buildContactWith(position, otherCollider, otherPosition, bodyA, bodyB, planeQuat = null, otherQuat = null) {
    const kind = otherCollider?.getComputeColliderKind?.();
    if (kind === "box") {
      return this._buildContactWithComputeBoxCollider(
        position,
        otherCollider,
        otherPosition,
        bodyA,
        bodyB,
        planeQuat,
        otherQuat
      );
    }
    if (kind === "sphere") {
      return this._buildContactWithComputeSphereCollider(
        position,
        otherCollider,
        otherPosition,
        bodyA,
        bodyB
      );
    }
    if (kind === "capsule") {
      return this._buildContactWithComputeCapsuleCollider(
        position,
        otherCollider,
        otherPosition,
        bodyA,
        bodyB,
        planeQuat,
        otherQuat
      );
    }
    throw new Error("ComputePlaneCollider contact requires a Compute Box, Sphere, or Capsule collider");
  }

  // CPU版のmanifold契約と同じcontacts配列へ接触を正規化します
  buildManifoldWith(position, otherCollider, otherPosition, bodyA, bodyB, planeQuat = null, otherQuat = null) {
    return Collider.prototype.buildManifoldWith.call(
      this,
      position,
      otherCollider,
      otherPosition,
      bodyA,
      bodyB,
      planeQuat,
      otherQuat
    );
  }

  // Plane-Box接触を支持頂点の代表contact群として返します
  _buildContactWithComputeBoxCollider(position, boxCollider, boxPosition, planeBody, boxBody, planeQuat = null, boxQuat = null) {
    const plane = this.getWorldInfo(position);
    const vertices = boxCollider.getVertices(boxPosition, boxQuat);
    let minimumDistance = Infinity;
    const distances = [];
    for (const vertex of vertices) {
      const distance = this._dotVec3(this._subVec3(vertex, plane.point), plane.normal);
      distances.push(distance);
      minimumDistance = Math.min(minimumDistance, distance);
    }
    const penetration = -minimumDistance;
    if (penetration <= 0) return null;
    const tolerance = Math.max(0.012, Math.min(0.03, Math.max(...boxCollider.getHalfExtents()) * 0.40));
    const supports = [];
    for (let index = 0; index < vertices.length; index++) {
      if (distances[index] > tolerance || distances[index] > minimumDistance + tolerance) continue;
      supports.push({
        featureKey: `compute-plane-box-vertex:${index}`,
        penetration: Math.max(0, -distances[index]),
        point: this._subVec3(vertices[index], this._scaleVec3(plane.normal, distances[index]))
      });
    }
    if (supports.length <= 1) {
      return {
        bodyA: planeBody,
        bodyB: boxBody,
        normal: [...plane.normal],
        contacts: supports.length === 1 ? supports : [{
          featureKey: "compute-plane-box-center",
          penetration,
          point: this._addVec3(
            this._subVec3(boxCollider.getWorldInfo(boxPosition, boxQuat).center, this._scaleVec3(plane.normal, minimumDistance)),
            this._scaleVec3(plane.normal, penetration)
          )
        }]
      };
    }
    const tangentSeed = Math.abs(plane.normal[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0];
    let tangentA = [
      tangentSeed[1] * plane.normal[2] - tangentSeed[2] * plane.normal[1],
      tangentSeed[2] * plane.normal[0] - tangentSeed[0] * plane.normal[2],
      tangentSeed[0] * plane.normal[1] - tangentSeed[1] * plane.normal[0]
    ];
    tangentA = this._normalizeVec3(tangentA, "ComputePlaneCollider tangentA");
    const tangentB = this._normalizeVec3([
      plane.normal[1] * tangentA[2] - plane.normal[2] * tangentA[1],
      plane.normal[2] * tangentA[0] - plane.normal[0] * tangentA[2],
      plane.normal[0] * tangentA[1] - plane.normal[1] * tangentA[0]
    ], "ComputePlaneCollider tangentB");
    const contacts = [];
    const addExtreme = (tangent) => {
      let min = supports[0];
      let max = supports[0];
      let minValue = this._dotVec3(min.point, tangent);
      let maxValue = minValue;
      for (let index = 1; index < supports.length; index++) {
        const value = this._dotVec3(supports[index].point, tangent);
        if (value < minValue) { minValue = value; min = supports[index]; }
        if (value > maxValue) { maxValue = value; max = supports[index]; }
      }
      for (const candidate of [min, max]) {
        if (!contacts.some((contact) => contact.featureKey === candidate.featureKey)) {
          contacts.push({ ...candidate, point: [...candidate.point] });
        }
      }
    };
    addExtreme(tangentA);
    addExtreme(tangentB);
    return { bodyA: planeBody, bodyB: boxBody, normal: [...plane.normal], contacts };
  }

  // Plane-Sphere接触をSphereの最低点から生成します
  _buildContactWithComputeSphereCollider(position, sphereCollider, spherePosition, planeBody, sphereBody) {
    const plane = this.getWorldInfo(position);
    const sphere = sphereCollider.getWorldInfo(spherePosition);
    const point = this._subVec3(sphere.center, this._scaleVec3(plane.normal, sphere.radius));
    const distance = this._dotVec3(this._subVec3(point, plane.point), plane.normal);
    const penetration = -distance;
    if (penetration <= 0) return null;
    return {
      bodyA: planeBody,
      bodyB: sphereBody,
      normal: [...plane.normal],
      penetration,
      point
    };
  }

  // Plane-Capsule接触を、回転後の芯線からPlane法線方向に最も低い端点を選んで生成します
  _buildContactWithComputeCapsuleCollider(position, capsuleCollider, capsulePosition, planeBody, capsuleBody, _planeQuat = null, capsuleQuat = null) {
    const plane = this.getWorldInfo(position);
    const capsule = capsuleCollider.getWorldInfo(capsulePosition, capsuleQuat);
    const distanceA = this._dotVec3(this._subVec3(capsule.pointA, plane.point), plane.normal);
    const distanceB = this._dotVec3(this._subVec3(capsule.pointB, plane.point), plane.normal);
    const basePoint = distanceA <= distanceB ? capsule.pointA : capsule.pointB;
    const distance = Math.min(distanceA, distanceB) - capsule.radius;
    const penetration = -distance;
    if (penetration <= 0) return null;
    return {
      bodyA: planeBody,
      bodyB: capsuleBody,
      normal: [...plane.normal],
      penetration,
      point: this._subVec3(basePoint, this._scaleVec3(plane.normal, capsule.radius))
    };
  }

  // Storage Bufferの一recordとなるnormal.xyzとplaneDistanceを指定Float32Arrayへ書き込みます
  // 配列長不足を部分書き込みで隠さず、呼出側のbuffer設計不一致として例外にします
  writeRecord(target, floatOffset) {
    if (!(target instanceof Float32Array)) {
      throw new Error("ComputePlaneCollider writeRecord target must be a Float32Array");
    }
    const offset = util.readFiniteNumber(floatOffset, "ComputePlaneCollider record offset", {
      integer: true,
      min: 0
    });
    if (offset + 4 > target.length) {
      throw new Error("ComputePlaneCollider writeRecord exceeds target length");
    }
    target.set([...this.normal, this.planeDistance], offset);
  }

  // boundsから床とXZ四壁を作り、閉じたsimulation範囲をPlane配列として表します
  // ComputePhysicsSpace側へ法線や符号の分岐を残さず、平面式の生成をこのclassへ集約します
  static createBoundaryPlanes(bounds) {
    const value = util.readPlainObject(bounds, "ComputePlaneCollider bounds");
    return [
      new ComputePlaneCollider([0, 1, 0], { planeDistance: value.floorY }),
      new ComputePlaneCollider([1, 0, 0], { planeDistance: value.minX }),
      new ComputePlaneCollider([-1, 0, 0], { planeDistance: -value.maxX }),
      new ComputePlaneCollider([0, 0, 1], { planeDistance: value.minZ }),
      new ComputePlaneCollider([0, 0, -1], { planeDistance: -value.maxZ })
    ];
  }

  // ComputePhysicsSpaceの共通impulse関数と各形状のsupport関数へ接続するPlane用WGSLを返します
  // collider typeでBox、Sphere、local-Y Capsuleの最低点を選び、形状ごとのsupport式を使います
  // optionsで未使用形状を省略し、Box専用sampleへSphere/CapsuleのPlane式を持ち込みません
  static createWGSL(options = {}) {
    const hasBox = options.hasBox !== false;
    const hasSphere = options.hasSphere !== false;
    const hasCapsule = options.hasCapsule !== false;
    const capsuleBody = hasCapsule
      ? "body.inverseInertiaLocal.w > 1.5"
      : "false";
    const sphereBody = hasSphere
      ? "body.inverseInertiaLocal.w > 0.5 && body.inverseInertiaLocal.w < 1.5"
      : "false";
    const minimumPointBase = hasBox
      ? "var minimumPoint = computeBoxMinimumPlanePoint(\n    *position, orientation, body.halfExtentsSleepCounter.xyz, normal\n  );"
      : hasSphere
        ? "var minimumPoint = computeSphereMinimumPlanePoint(\n    *position, body.halfExtentsSleepCounter.x, normal\n  );"
        : "var minimumPoint = computeCapsuleMinimumPlanePoint(\n    *position, orientation, body.halfExtentsSleepCounter.x,\n    body.halfExtentsSleepCounter.y, normal\n  );";
    const minimumPointAlternates = [
      hasSphere && hasBox ? `  if (sphereBody) {
    minimumPoint = computeSphereMinimumPlanePoint(
      *position, body.halfExtentsSleepCounter.x, normal
    );
  }` : "",
      hasCapsule && (hasBox || hasSphere) ? `  if (capsuleBody) {
    minimumPoint = computeCapsuleMinimumPlanePoint(
      *position,
      orientation,
      body.halfExtentsSleepCounter.x,
      body.halfExtentsSleepCounter.y,
      normal
    );
  }` : ""
    ].filter(Boolean).join("\n");
    const minimumPointCode = `  let capsuleBody = ${capsuleBody};
  let sphereBody = ${sphereBody};
  ${minimumPointBase}
${minimumPointAlternates}`;
    const boxImpulsePointFunction = hasBox ? `fn computeBoxPlaneImpulsePoint(
  position : vec3f,
  orientation : vec4f,
  halfExtents : vec3f,
  normal : vec3f,
  planeDistance : f32
) -> vec3f {
  // 接触cornerの中心を基本作用点とし、接触しているcornerだけを法線impulseへ使います
  return computeBoxActivePlaneContactCenter(
    position, orientation, halfExtents, normal, planeDistance
  );
}
` : "";
    const boxSupportCode = hasBox ? `  // Boxだけは複数support頂点と重心投影を評価し、単一点支持による過剰な回転を避けます
  var supportCount = 1u;
  var balanced = true;
  if (!sphereBody && !capsuleBody) {
    supportCount = computeBoxPlaneSupportCount(
      *position, orientation, body.halfExtentsSleepCounter.xyz,
      normal, plane.normalPlaneDistance.w
    );
    balanced = computeBoxPlaneSupportBalance(
      *position, orientation, body.halfExtentsSleepCounter.xyz,
      normal, plane.normalPlaneDistance.w
    );
  }
  var supportPoint = minimumPoint.xyz;
  if (!sphereBody && !capsuleBody) {
    // 重心投影が複数支持の内側にある場合は、支持点へ分配された合力を重心投影へ集約します
    // 1点支持または重心投影が支持範囲外の場合は実接触corner中心を使い、転倒回転を保持します
    if (supportCount > 1u && balanced) {
      supportPoint = *position;
    } else {
      supportPoint = computeBoxPlaneImpulsePoint(
        *position,
        orientation,
        body.halfExtentsSleepCounter.xyz,
        normal,
        plane.normalPlaneDistance.w
      );
    }
    supportPoint += normal * (plane.normalPlaneDistance.w - dot(supportPoint, normal));
  }` : `  var supportCount = 1u;
  var balanced = true;
  var supportPoint = minimumPoint.xyz;`;
    return `
struct ComputePlaneRecord {
  // xyzは正規化済み法線、wはdot(position, normal)と比較するplaneDistanceです
  normalPlaneDistance : vec4f,
  material : vec4f,
  identity : vec4f,
};

struct PlaneImpulseAccumulator {
  // fixed step内でPlaneへ蓄積した法線力積と接線2方向の摩擦力積です
  normalLambda : f32,
  tangentLambdaA : f32,
  tangentLambdaB : f32,
  targetNormalVelocity : f32,
};

// Plane法線から直交する接線基底を作り、2方向の摩擦力積を計算します
// wallとfloorで別のXZ分岐を持たず、同じ接触式をすべてのPlaneへ適用します
fn computePlaneTangentBasis(normal : vec3f) -> mat2x3f {
  let seed = select(
    vec3f(1.0, 0.0, 0.0),
    vec3f(0.0, 1.0, 0.0),
    abs(normal.x) > 0.5
  );
  let tangentA = normalize(cross(normal, seed));
  let tangentB = normalize(cross(normal, tangentA));
  return mat2x3f(tangentA, tangentB);
}

${boxImpulsePointFunction}

fn solveComputePlaneBody(
  body : BodyState,
  materialProperties : vec4f,
  historyIndex : u32,
  plane : ComputePlaneRecord,
  position : ptr<function, vec3f>,
  orientation : vec4f,
  linearVelocity : ptr<function, vec3f>,
  angularVelocity : ptr<function, vec3f>,
  iteration : u32,
  maxNormalSpeed : ptr<function, f32>,
  impulseAccumulator : ptr<function, PlaneImpulseAccumulator>,
  wallSupportImpulseY : ptr<function, f32>
) -> u32 {
  // 形状ごとの最低点をPlane式へ投影し、接触、反発、摩擦、支持点数を一つの処理で更新します
  let normal = plane.normalPlaneDistance.xyz;
${minimumPointCode}
  let penetration = plane.normalPlaneDistance.w - dot(minimumPoint.xyz, normal);
  if (penetration <= 0.0) { return 0u; }
${boxSupportCode}
  // Plane上へ投影した作用点の接触速度を求め、法線方向の接触拘束を解きます
  let r = supportPoint - *position;
  let contactVelocity = *linearVelocity + cross(*angularVelocity, r);
  let normalVelocity = dot(contactVelocity, normal);
  let contactMaterial = physicsContactMaterial(
    vec4f(body.material.xy, materialProperties.zw), plane.material,
    materialProperties.y, plane.identity.x, max(0.0, -normalVelocity));
  if ((*impulseAccumulator).targetNormalVelocity < 0.0) {
    (*impulseAccumulator).targetNormalVelocity = physicsImpactTarget(historyIndex, normal,
      max(0.0, -normalVelocity), contactMaterial.x);
  }
  var normalImpulseApplied = (*impulseAccumulator).normalLambda > 0.0000001;
  var normalImpulseMagnitude = (*impulseAccumulator).normalLambda;
  var normalImpulse = vec3f(0.0);
  var frictionImpulse = vec3f(0.0);
  var normalAngularDelta = vec3f(0.0);
  var frictionAngularDelta = vec3f(0.0);
  var denominator = 0.0;
  var restitution = 0.0;
  var tangentSpeed = 0.0;
  var unrestricted = 0.0;
  var frictionLimit = (*impulseAccumulator).normalLambda * body.material.y;
  let angular = cross(
    inverseInertiaApply(orientation, body.inverseInertiaLocal.xyz, cross(r, normal)), r
  );
  denominator = body.linearVelocityInvMass.w + dot(angular, normal);
  if (denominator > 0.0000001 && normalVelocity < 0.0) {
    // 平面へ向かう速度だけを解き、すでに離れている反復では既存の反発速度を保持します
    // 反発は最初の反復だけへ残し、後続の接近反復では静止接触の目標法線速度を0にします
    restitution = select(
      0.0,
      body.material.x,
      iteration == 0u && normalVelocity < -params.scale1.x
    );
    let targetNormalVelocity = select(0.0, (*impulseAccumulator).targetNormalVelocity,
      iteration == 0u);
    let deltaLambda = -(normalVelocity - targetNormalVelocity) / denominator;
    let previousLambda = (*impulseAccumulator).normalLambda;
    let nextLambda = max(previousLambda + deltaLambda, 0.0);
    let appliedLambda = nextLambda - previousLambda;
    (*impulseAccumulator).normalLambda = nextLambda;
    normalImpulseMagnitude = nextLambda;
    normalImpulseApplied = nextLambda > 0.0000001;
    if (abs(appliedLambda) > 0.0000001) {
      normalImpulse = normal * appliedLambda;
      *linearVelocity += normalImpulse * body.linearVelocityInvMass.w;
      normalAngularDelta = inverseInertiaApply(
        orientation, body.inverseInertiaLocal.xyz, cross(r, normalImpulse)
      );
      *angularVelocity += normalAngularDelta;
    }
  }
  // 累積法線力積がある接触だけで摩擦を解き、摩擦力積が法線力を越えないようにします
  if ((*impulseAccumulator).normalLambda > 0.0000001) {
    let basis = computePlaneTangentBasis(normal);
    let postContactVelocity = *linearVelocity + cross(*angularVelocity, r);
    let tangentVelocity = postContactVelocity - normal * dot(postContactVelocity, normal);
    tangentSpeed = length(tangentVelocity);
    if (tangentSpeed > 0.0000001) {
      let tangentA = basis[0];
      let tangentB = basis[1];
      let angularTangentA = cross(
        inverseInertiaApply(orientation, body.inverseInertiaLocal.xyz, cross(r, tangentA)), r
      );
      let angularTangentB = cross(
        inverseInertiaApply(orientation, body.inverseInertiaLocal.xyz, cross(r, tangentB)), r
      );
      let denominatorA = body.linearVelocityInvMass.w + dot(angularTangentA, tangentA);
      let denominatorB = body.linearVelocityInvMass.w + dot(angularTangentB, tangentB);
      var deltaA = 0.0;
      var deltaB = 0.0;
      if (denominatorA > 0.0000001) {
        deltaA = -dot(postContactVelocity, tangentA) / denominatorA;
      }
      if (denominatorB > 0.0000001) {
        deltaB = -dot(postContactVelocity, tangentB) / denominatorB;
      }
      let requestedA = (*impulseAccumulator).tangentLambdaA + deltaA;
      let requestedB = (*impulseAccumulator).tangentLambdaB + deltaB;
      let requestedLength = sqrt(requestedA * requestedA + requestedB * requestedB);
      frictionLimit = (*impulseAccumulator).normalLambda * select(contactMaterial.y, contactMaterial.z,
        requestedLength <= (*impulseAccumulator).normalLambda * contactMaterial.z);
      var tangentScale = 1.0;
      if (requestedLength > frictionLimit && requestedLength > 0.0000001) {
        tangentScale = frictionLimit / requestedLength;
      }
      let nextA = requestedA * tangentScale;
      let nextB = requestedB * tangentScale;
      let appliedA = nextA - (*impulseAccumulator).tangentLambdaA;
      let appliedB = nextB - (*impulseAccumulator).tangentLambdaB;
      (*impulseAccumulator).tangentLambdaA = nextA;
      (*impulseAccumulator).tangentLambdaB = nextB;
      unrestricted = sqrt(deltaA * deltaA + deltaB * deltaB);
      frictionImpulse = tangentA * appliedA + tangentB * appliedB;
      *linearVelocity += frictionImpulse * body.linearVelocityInvMass.w;
      frictionAngularDelta = inverseInertiaApply(
        orientation, body.inverseInertiaLocal.xyz, cross(r, frictionImpulse)
      );
      *angularVelocity += frictionAngularDelta;
    }
  }
  if (iteration == 0u && normalImpulseMagnitude > 0.0 && contactMaterial.w > 0.0) {
    *angularVelocity = physicsRollingVelocity(*angularVelocity, orientation, body.inverseInertiaLocal.xyz,
      normal, normalImpulseMagnitude * contactMaterial.w);
  }
  // sleep判定には最終反復でnormal impulseを適用した平面接触の法線残留速度だけを使います
  // 法線impulseを伴わない接線速度をsleep/wakeの接触指標へ入れず、body自身に残った角速度はlowMotionで別に判定します
  if (normalImpulseApplied && iteration + 1u >= u32(params.timing.z)) {
    // 最終solver反復だけをsleep速度判定へ使い、確定した速度を参照します
    let residualContactVelocity = *linearVelocity + cross(*angularVelocity, r);
    *maxNormalSpeed = max(*maxNormalSpeed, abs(dot(residualContactVelocity, normal)));
    if (abs(normal.y) <= 0.5) {
      let supportImpulseY = max(frictionImpulse.y, 0.0);
      *wallSupportImpulseY += supportImpulseY;
    }
  }
  // penetration補正は速度変化と分離し、Plane法線方向へbody位置だけを押し戻します
  *position += normal * max(penetration - params.scale0.y, 0.0) * params.gravityBeta.w;
  return supportCount;
}
`;
  }
}
