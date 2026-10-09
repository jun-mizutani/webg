// ---------------------------------------------
// ComputePhysicsCpuEmulator.js  2026/08/29
//   CPU mirror of the ComputePhysicsSpace path used by falling_dominoes
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import ComputePlaneCollider from "../../webg/ComputePlaneCollider.js";

const EPSILON = 1.0e-8;
const DEFAULT_DIVERGENCE_LIMITS = Object.freeze({
  position: 1.0e-4,
  linear: 1.0e-3,
  angular: 1.0e-2,
  orientation: 1.0e-3
});

// CPU側のVec3演算を一箇所へ集め、GPUの接触式と同じ式を追跡しやすくします
// 配列長を補ったり非有限値を別値へ置き換えたりせず、呼出側の計算不成立をそのまま残します
// 配列を新しく返し、solver途中の速度配列を別bodyの計算と共有しないようにします
function add3(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

// quaternion加算専用の4要素演算を行い、Vec3演算でもscalar成分を保持します
function add4(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3]];
}

// 位置、速度、角速度の差をGPUのvec3減算と同じ順序で計算します
function sub3(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

// worldベクトルへscalarを掛け、impulseと位置補正の符号を呼出側へ残します
function scale3(value, scalar) {
  return [value[0] * scalar, value[1] * scalar, value[2] * scalar];
}

// 姿勢quaternionへscalarを掛け、4成分を落とさず積分式へ渡します
function scale4(value, scalar) {
  return [value[0] * scalar, value[1] * scalar, value[2] * scalar, value[3] * scalar];
}

// 接触法線への射影を求め、法線速度とSATの分離判定で共通利用します
function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

// 接触点の腕とimpulseから角速度への寄与を求めます
function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

// 速度ベクトルの大きさを求め、sleep閾値と接触残留速度を比較します
function length3(value) {
  return Math.hypot(value[0], value[1], value[2]);
}

// 非zeroの接線基底だけを返し、zero vectorを別方向へ置き換えず計算不成立を検出します
function normalize3(value) {
  const length = length3(value);
  if (length <= EPSILON) throw new Error("ComputePhysicsCpuEmulator vector must not be zero");
  return scale3(value, 1 / length);
}

// Plane法線から直交する2本の接線基底を作り、body pairの摩擦方向を法線から決めます
function computePlaneTangentBasis(normal) {
  const seed = Math.abs(normal[0]) > 0.5 ? [0, 1, 0] : [1, 0, 0];
  const tangentA = normalize3(cross3(normal, seed));
  const tangentB = normalize3(cross3(normal, tangentA));
  return [tangentA, tangentB];
}

// 複数のPlane支持点がbody重心の投影を支えられるかを、GPUの辺・三角形判定と同じ順序で調べます
// 1点支持を安定支持へ置き換えず、重心投影が支持featureの内側にある場合だけtrueを返します
function computePlaneSupportBalance(activePoints, normal, position, tolerance) {
  if (activePoints.length < 2) return false;
  const [tangentA, tangentB] = computePlaneTangentBasis(normal);
  const supports = activePoints.map((point) => [dot3(point, tangentA), dot3(point, tangentB)]);
  const center = [dot3(position, tangentA), dot3(position, tangentB)];
  const distanceToSegment = (first, second) => {
    const edge = [second[0] - first[0], second[1] - first[1]];
    const lengthSquared = edge[0] * edge[0] + edge[1] * edge[1];
    if (lengthSquared <= EPSILON) return Math.hypot(center[0] - first[0], center[1] - first[1]);
    const projection = Math.max(0, Math.min(1,
      ((center[0] - first[0]) * edge[0] + (center[1] - first[1]) * edge[1]) / lengthSquared
    ));
    return Math.hypot(
      center[0] - first[0] - edge[0] * projection,
      center[1] - first[1] - edge[1] * projection
    );
  };
  for (let first = 0; first < supports.length; first++) {
    for (let second = first + 1; second < supports.length; second++) {
      if (distanceToSegment(supports[first], supports[second]) <= tolerance) return true;
    }
  }
  if (supports.length < 3) return false;
  for (let first = 0; first < supports.length; first++) {
    for (let second = first + 1; second < supports.length; second++) {
      for (let third = second + 1; third < supports.length; third++) {
        const edgeA = [supports[second][0] - supports[first][0], supports[second][1] - supports[first][1]];
        const edgeB = [supports[third][0] - supports[first][0], supports[third][1] - supports[first][1]];
        const denominator = edgeA[0] * edgeB[1] - edgeA[1] * edgeB[0];
        if (Math.abs(denominator) <= EPSILON) continue;
        const toCenter = [center[0] - supports[first][0], center[1] - supports[first][1]];
        const coordinateA = (toCenter[0] * edgeB[1] - toCenter[1] * edgeB[0]) / denominator;
        const coordinateB = (edgeA[0] * toCenter[1] - edgeA[1] * toCenter[0]) / denominator;
        if (coordinateA >= -1.0e-6 && coordinateB >= -1.0e-6
          && coordinateA + coordinateB <= 1.0 + 1.0e-6) return true;
      }
    }
  }
  return false;
}

// webgのquaternionは[w,x,y,z]順なので、GPUのvec4(x=scalar,yzw=vector)式を配列へ対応させます
// GPUとCPUで姿勢の成分順を取り違えると接触法線だけでなくBoxのAABBも変わるため、ここで固定します
// 二つの姿勢または角速度quaternionの積をGPUと同じ成分順で返します
function quatMultiply(a, b) {
  return [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]
  ];
}

// 姿勢の長さを検証して正規化し、正規化済みquaternionを返します
function quatNormalize(value) {
  const length = Math.hypot(value[0], value[1], value[2], value[3]);
  if (length <= EPSILON) throw new Error("ComputePhysicsCpuEmulator quaternion must not be zero");
  return value.map((entry) => entry / length);
}

// worldからlocalへ戻すquaternion変換のため、姿勢の共役を返します
function quatConjugate(value) {
  return [value[0], -value[1], -value[2], -value[3]];
}

// local軸上のBox頂点や接触点をworld座標へ回転します
function quatRotate(orientation, value) {
  const rotated = quatMultiply(
    quatMultiply(orientation, [0, value[0], value[1], value[2]]),
    quatConjugate(orientation)
  );
  return rotated.slice(1, 4);
}

// GPUのfixed stepと同じ有限回転Δq ⊗ qを行い、Broad Phase予測とsolver後姿勢で式を共有します
// ここで別の角速度積分を使うと候補生成だけがずれて接触力積の比較ができなくなるためです
function integrateOrientation(orientation, angularVelocity, dt) {
  const angularSpeed = length3(angularVelocity);
  if (angularSpeed === 0.0) {
    return quatNormalize(orientation);
  }
  const halfAngle = angularSpeed * dt * 0.5;
  const scale = Math.sin(halfAngle) / angularSpeed;
  const delta = [
    Math.cos(halfAngle),
    angularVelocity[0] * scale,
    angularVelocity[1] * scale,
    angularVelocity[2] * scale
  ];
  return quatNormalize(quatMultiply(delta, orientation));
}

// readback比較用の配列を複製し、CPU stateの内部配列を保護します
function cloneArray(value) {
  return [...value];
}

// body stateの配列欄を複製し、source snapshotとnext stateを共有しないようにします
function cloneState(state) {
  return {
    ...state,
    position: cloneArray(state.position),
    orientation: cloneArray(state.orientation),
    linearVelocity: cloneArray(state.linearVelocity),
    angularVelocity: cloneArray(state.angularVelocity)
  };
}

// B31のfixed step診断を複製し、最大角速度を記録したstepの値を後から比較できるようにします
function cloneStage(stage) {
  if (stage === null) return null;
  return {
    start: cloneArray(stage.start),
    afterB30: cloneArray(stage.afterB30),
    afterB32: cloneArray(stage.afterB32),
    afterPlane: cloneArray(stage.afterPlane),
    end: cloneArray(stage.end),
    events: cloneArray(stage.events)
  };
}

// 接触一回分の診断値を複製し、作用点・法線・角速度差を外部の解析処理へ安全に渡します
// 物理計算用の配列を共有せず、readback比較と同じく診断側からsolver状態を書き換えられない形にします
function cloneImpulseAudit(audit) {
  if (audit === null) return null;
  return {
    ...audit,
    normal: cloneArray(audit.normal),
    point: cloneArray(audit.point),
    r: cloneArray(audit.r),
    normalImpulseVector: cloneArray(audit.normalImpulseVector),
    frictionImpulseVector: cloneArray(audit.frictionImpulseVector),
    angularBefore: cloneArray(audit.angularBefore),
    angularAfter: cloneArray(audit.angularAfter),
    normalAngularDelta: cloneArray(audit.normalAngularDelta),
    frictionAngularDelta: cloneArray(audit.frictionAngularDelta),
    angularDelta: cloneArray(audit.angularDelta)
  };
}

// 一body一fixed stepの接触履歴を複製し、後続bodyへ波及した順番を確認できるようにします
// body接触とPlane接触を別配列に保持し、最終値だけから発生源を推測しないようにします
function cloneBodyTrace(trace) {
  if (trace === null) return null;
  return {
    id: trace.id,
    start: cloneArray(trace.start),
    preContact: trace.preContact === null ? null : cloneArray(trace.preContact),
    bodyImpulses: trace.bodyImpulses.map(cloneImpulseAudit),
    planeImpulses: trace.planeImpulses.map(cloneImpulseAudit),
    end: trace.end === null ? null : cloneArray(trace.end),
    sleeping: trace.sleeping
  };
}

// 一fixed step内の全trace bodyを複製し、body間の角速度波及をstep単位で保存します
function cloneStepTrace(trace) {
  if (trace === null) return null;
  return {
    fixedStep: trace.fixedStep,
    bodies: trace.bodies.map(cloneBodyTrace)
  };
}

// GPUのBodyStateに必要な動的属性だけをdescriptorから取り出し、CPU専用counterと命令を分離します
// GPU readbackを内部stateへ混ぜず、CPUエミュレータが独立に進んだ結果を比較できるようにします
function buildState(descriptor) {
  const colliderKind = descriptor.collider?.getComputeColliderKind?.();
  if (colliderKind !== "box") {
    throw new Error(`ComputePhysicsCpuEmulator supports only ComputeBoxCollider, got ${colliderKind ?? "unknown"}`);
  }
  const bodyType = descriptor.bodyType ?? "dynamic";
  const mass = Number(descriptor.mass);
  if (!Number.isFinite(mass) || mass <= 0) {
    throw new Error(`ComputePhysicsCpuEmulator body ${descriptor.id} mass must be positive`);
  }
  const inverseMass = bodyType === "dynamic" ? 1 / mass : 0;
  const inverseInertia = descriptor.inverseInertiaLocal === undefined
    ? descriptor.collider.calculateInverseInertia(inverseMass)
    : [...descriptor.inverseInertiaLocal];
  const halfExtents = descriptor.collider.getHalfExtents();
  const material = descriptor.material ?? {};
  return {
    id: descriptor.id,
    bodyType,
    allowSleep: descriptor.allowSleep !== false,
    gravityScale: descriptor.gravityScale ?? 1,
    collisionLayer: descriptor.collisionLayer ?? 1,
    collisionMask: descriptor.collisionMask ?? 0xffffffff,
    inverseMass,
    inverseInertia,
    halfExtents,
    restitution: material.restitution ?? 0.02,
    friction: material.friction ?? 0.8,
    linearDamping: material.linearDamping ?? 0.08,
    angularDamping: material.angularDamping ?? 0.12,
    position: cloneArray(descriptor.position),
    orientation: quatNormalize(cloneArray(descriptor.orientation ?? [1, 0, 0, 0])),
    linearVelocity: cloneArray(descriptor.linearVelocity ?? [0, 0, 0]),
    angularVelocity: cloneArray(descriptor.angularVelocity ?? [0, 0, 0]),
    sleeping: descriptor.isSleeping === true,
    sleepCounter: 0
  };
}

// CPU上でGPUのComputePlaneRecordと同じ五つの境界平面を作ります
// 平面を別の衝突厚へ置き換えず、normalとplaneDistanceの定義をそのまま再利用します
function createBoundaryPlanes(bounds) {
  const names = ["minX", "maxX", "minZ", "maxZ", "floorY"];
  if (!bounds || names.some((name) => !Number.isFinite(bounds[name]))) {
    throw new Error("ComputePhysicsCpuEmulator bounds must contain finite minX, maxX, minZ, maxZ, and floorY");
  }
  return [
    new ComputePlaneCollider([0, 1, 0], { planeDistance: bounds.floorY }),
    new ComputePlaneCollider([1, 0, 0], { planeDistance: bounds.minX }),
    new ComputePlaneCollider([-1, 0, 0], { planeDistance: -bounds.maxX }),
    new ComputePlaneCollider([0, 0, 1], { planeDistance: bounds.minZ }),
    new ComputePlaneCollider([0, 0, -1], { planeDistance: -bounds.maxZ })
  ];
}

// GPUのComputePhysicsSpaceと同じ物理順序でBoxのworld軸半径を計算します
// 姿勢の現在値と予測値を両方に渡すことで、回転中の候補を落とさないswept AABBになります
function computeBoxWorldRadius(state, orientation) {
  const axes = [
    quatRotate(orientation, [1, 0, 0]),
    quatRotate(orientation, [0, 1, 0]),
    quatRotate(orientation, [0, 0, 1])
  ];
  return [
    Math.abs(axes[0][0]) * state.halfExtents[0]
      + Math.abs(axes[1][0]) * state.halfExtents[1]
      + Math.abs(axes[2][0]) * state.halfExtents[2],
    Math.abs(axes[0][1]) * state.halfExtents[0]
      + Math.abs(axes[1][1]) * state.halfExtents[1]
      + Math.abs(axes[2][1]) * state.halfExtents[2],
    Math.abs(axes[0][2]) * state.halfExtents[0]
      + Math.abs(axes[1][2]) * state.halfExtents[1]
      + Math.abs(axes[2][2]) * state.halfExtents[2]
  ];
}

function computeBoxCorners(state, position, orientation) {
  const axes = [
    quatRotate(orientation, [1, 0, 0]),
    quatRotate(orientation, [0, 1, 0]),
    quatRotate(orientation, [0, 0, 1])
  ];
  const corners = [];
  for (let index = 0; index < 8; index++) {
    const signs = [
      (index & 1) !== 0 ? 1 : -1,
      (index & 2) !== 0 ? 1 : -1,
      (index & 4) !== 0 ? 1 : -1
    ];
    corners.push(add3(
      add3(
        add3(position, scale3(axes[0], state.halfExtents[0] * signs[0])),
        scale3(axes[1], state.halfExtents[1] * signs[1])
      ),
      scale3(axes[2], state.halfExtents[2] * signs[2])
    ));
  }
  return corners;
}

// GPUのcomputeBoxSupportFeatureCenterと同じ投影差で面・辺のsupport点群を選びます
// 既定の1点経路ではこの配列の平均だけを使い、実験経路では複数点を接触拘束へ渡します
function computeBoxSupportFeature(state, position, orientation, direction, tolerance) {
  const points = computeBoxCorners(state, position, orientation);
  const projections = points.map((point) => dot3(point, direction));
  const maximum = Math.max(...projections);
  const selected = points.filter((point, index) => maximum - projections[index] <= tolerance);
  if (selected.length === 0) throw new Error("ComputePhysicsCpuEmulator Box support feature is empty");
  return selected;
}

// support点群の平均を求め、GPUの代表contact pointを再現する既定経路で使います
// 複数接触点の実験でも中心点を診断値として残せるよう、選択と平均を分離します
function computeBoxSupportFeatureCenter(state, position, orientation, direction, tolerance) {
  const selected = computeBoxSupportFeature(state, position, orientation, direction, tolerance);
  const sum = selected.reduce((total, point) => add3(total, point), [0, 0, 0]);
  return scale3(sum, 1 / selected.length);
}

// 一つのSAT軸を検査し、最小penetrationの法線候補をGPUと同じ順序で保存します
// 軸の長さがほぼ0の外積はGPUと同じく分離判定の対象外として扱い、法線を明示値から保ちます
function testSatAxis(axisInput, centerDelta, axesA, extentsA, axesB, extentsB, best) {
  const lengthSq = dot3(axisInput, axisInput);
  if (lengthSq < 1.0e-8) return true;
  const axis = scale3(axisInput, 1 / Math.sqrt(lengthSq));
  const radiusA = extentsA[0] * Math.abs(dot3(axesA[0], axis))
    + extentsA[1] * Math.abs(dot3(axesA[1], axis))
    + extentsA[2] * Math.abs(dot3(axesA[2], axis));
  const radiusB = extentsB[0] * Math.abs(dot3(axesB[0], axis))
    + extentsB[1] * Math.abs(dot3(axesB[1], axis))
    + extentsB[2] * Math.abs(dot3(axesB[2], axis));
  const signedDistance = dot3(centerDelta, axis);
  const overlap = radiusA + radiusB - Math.abs(signedDistance);
  if (overlap <= 0) return false;
  if (overlap < best.penetration) {
    best.normal = signedDistance >= 0 ? axis : scale3(axis, -1);
    best.penetration = overlap;
  }
  return true;
}

// GPUのcomputeBoxContactを15軸SATとsupport feature中点まで含めて再現します
// CPU版のmanifoldを簡略化して使わず、最終contact pointの違いを比較へ残します
function computeBoxContact(bodyA, positionA, orientationA, bodyB, tolerance) {
  const orientationB = quatNormalize(bodyB.orientation);
  const axesA = [
    quatRotate(orientationA, [1, 0, 0]),
    quatRotate(orientationA, [0, 1, 0]),
    quatRotate(orientationA, [0, 0, 1])
  ];
  const axesB = [
    quatRotate(orientationB, [1, 0, 0]),
    quatRotate(orientationB, [0, 1, 0]),
    quatRotate(orientationB, [0, 0, 1])
  ];
  const centerDelta = sub3(bodyB.position, positionA);
  const best = { normal: [0, 0, 0], penetration: Infinity };
  for (let axis = 0; axis < 3; axis++) {
    if (!testSatAxis(axesA[axis], centerDelta, axesA, bodyA.halfExtents, axesB, bodyB.halfExtents, best)) return null;
    if (!testSatAxis(axesB[axis], centerDelta, axesA, bodyA.halfExtents, axesB, bodyB.halfExtents, best)) return null;
  }
  for (let axisA = 0; axisA < 3; axisA++) {
    for (let axisB = 0; axisB < 3; axisB++) {
      if (!testSatAxis(
        cross3(axesA[axisA], axesB[axisB]),
        centerDelta,
        axesA,
        bodyA.halfExtents,
        axesB,
        bodyB.halfExtents,
        best
      )) return null;
    }
  }
  const pointA = computeBoxSupportFeatureCenter(bodyA, positionA, orientationA, best.normal, tolerance);
  const pointB = computeBoxSupportFeatureCenter(bodyB, bodyB.position, orientationB, scale3(best.normal, -1), tolerance);
  return {
    normal: best.normal,
    penetration: best.penetration,
    point: scale3(add3(pointA, pointB), 0.5)
  };
}

// body pairのsupport featureから最大4点の接触manifold候補を作ります
// 同じ法線上の接触点を並べ、代表1点へ集中していた法線・摩擦力積を複数作用点へ分散します
function computeBoxContacts(bodyA, positionA, orientationA, bodyB, tolerance, maximumPoints) {
  const orientationB = quatNormalize(bodyB.orientation);
  const axesA = [
    quatRotate(orientationA, [1, 0, 0]),
    quatRotate(orientationA, [0, 1, 0]),
    quatRotate(orientationA, [0, 0, 1])
  ];
  const axesB = [
    quatRotate(orientationB, [1, 0, 0]),
    quatRotate(orientationB, [0, 1, 0]),
    quatRotate(orientationB, [0, 0, 1])
  ];
  const centerDelta = sub3(bodyB.position, positionA);
  const best = { normal: [0, 0, 0], penetration: Infinity };
  for (let axis = 0; axis < 3; axis++) {
    if (!testSatAxis(axesA[axis], centerDelta, axesA, bodyA.halfExtents, axesB, bodyB.halfExtents, best)) return [];
    if (!testSatAxis(axesB[axis], centerDelta, axesA, bodyA.halfExtents, axesB, bodyB.halfExtents, best)) return [];
  }
  for (let axisA = 0; axisA < 3; axisA++) {
    for (let axisB = 0; axisB < 3; axisB++) {
      if (!testSatAxis(
        cross3(axesA[axisA], axesB[axisB]),
        centerDelta,
        axesA,
        bodyA.halfExtents,
        axesB,
        bodyB.halfExtents,
        best
      )) return [];
    }
  }
  const supportA = computeBoxSupportFeature(bodyA, positionA, orientationA, best.normal, tolerance);
  const supportB = computeBoxSupportFeature(bodyB, bodyB.position, orientationB, scale3(best.normal, -1), tolerance);
  const [tangentA] = computePlaneTangentBasis(best.normal);
  const orderedA = [...supportA].sort((first, second) => dot3(first, tangentA) - dot3(second, tangentA));
  const orderedB = [...supportB].sort((first, second) => dot3(first, tangentA) - dot3(second, tangentA));
  const pointCount = Math.min(maximumPoints, orderedA.length, orderedB.length);
  const contacts = [];
  for (let index = 0; index < pointCount; index++) {
    contacts.push({
      normal: best.normal,
      penetration: best.penetration,
      point: scale3(add3(orderedA[index], orderedB[index]), 0.5),
      manifoldIndex: index,
      manifoldCount: pointCount
    });
  }
  return contacts;
}

// GPUのworld/local逆慣性変換をCPU側へ写し、角速度へのimpulse効果を同じ向きで計算します
// fixedRotationやstatic bodyはinverseInertiaが0なので、同じ式で角速度差分を計算します
function inverseInertiaApply(orientation, inverseInertia, value) {
  const local = quatRotate(quatConjugate(orientation), value);
  return quatRotate(orientation, [
    local[0] * inverseInertia[0],
    local[1] * inverseInertia[1],
    local[2] * inverseInertia[2]
  ]);
}

// GPUの次step予測BodyStateを作り、sleep bodyのwake判定とwake後solverへ同じ相手速度を渡します
// 現在の相手stateだけを使う判定へ戻さず、重力・命令・減衰・移動を順に適用します
function predictWakeBody(body, command, config, dt, gravity) {
  const predicted = cloneState(body);
  let linearVelocity = cloneArray(body.linearVelocity);
  let angularVelocity = cloneArray(body.angularVelocity);
  if (body.bodyType === "dynamic") {
    linearVelocity = add3(linearVelocity, scale3(gravity, body.gravityScale * dt));
    angularVelocity = add3(
      angularVelocity,
      inverseInertiaApply(body.orientation, body.inverseInertia, command.angularImpulse)
    );
  }
  linearVelocity = scale3(linearVelocity, Math.exp(-body.linearDamping * dt));
  angularVelocity = scale3(angularVelocity, Math.exp(-body.angularDamping * dt));
  predicted.position = add3(body.position, scale3(linearVelocity, dt));
  predicted.orientation = integrateOrientation(body.orientation, angularVelocity, dt);
  predicted.linearVelocity = linearVelocity;
  predicted.angularVelocity = angularVelocity;
  return predicted;
}

// GPUの一fixed step予測AABBを作り、XZ Gridとswept Yの最終候補条件をCPUで再現します
// 全pairを無条件でsolverへ渡さず、GPUと同じく候補外接触を計算しない比較にします
function buildPredictedAabbs(states, commands, config) {
  const result = states.map((body, index) => {
    const orientation = quatNormalize(body.orientation);
    const sleeping = config.persistentSleep && body.sleeping;
    const moves = body.bodyType === "dynamic" && !sleeping;
    const command = commands[index];
    const predictedVelocity = moves
      ? add3(body.linearVelocity, scale3(config.gravity, body.gravityScale * config.dt))
      : [0, 0, 0];
    const predictedPosition = moves
      ? add3(body.position, scale3(predictedVelocity, config.dt))
      : cloneArray(body.position);
    const predictedOrientation = moves
      ? integrateOrientation(orientation, body.angularVelocity, config.dt)
      : orientation;
    const currentRadius = computeBoxWorldRadius(body, orientation);
    const predictedRadius = computeBoxWorldRadius(body, predictedOrientation);
    const padding = config.broadphasePadding;
    return {
      minX: Math.min(body.position[0] - currentRadius[0], predictedPosition[0] - predictedRadius[0]) - padding,
      minZ: Math.min(body.position[2] - currentRadius[2], predictedPosition[2] - predictedRadius[2]) - padding,
      maxX: Math.max(body.position[0] + currentRadius[0], predictedPosition[0] + predictedRadius[0]) + padding,
      maxZ: Math.max(body.position[2] + currentRadius[2], predictedPosition[2] + predictedRadius[2]) + padding,
      minY: Math.min(body.position[1] - currentRadius[1], predictedPosition[1] - predictedRadius[1]) - padding,
      maxY: Math.max(body.position[1] + currentRadius[1], predictedPosition[1] + predictedRadius[1]) + padding
    };
  });
  return result;
}

// Broad Phaseの最終bitsetをbody別配列へ変換し、GPUのbit走査順であるslot昇順を維持します
// XZ cellの重複をSetへまとめた後も、候補をslot順へ整列して接触力積の順序を保ちます
function buildCandidates(states, aabbs, config) {
  const candidates = states.map(() => []);
  for (let bodyA = 0; bodyA < states.length; bodyA++) {
    if (states[bodyA].bodyType === "static") continue;
    for (let bodyB = 0; bodyB < states.length; bodyB++) {
      if (bodyA === bodyB || states[bodyB].bodyType === "static") continue;
      const a = aabbs[bodyA];
      const b = aabbs[bodyB];
      const controlPair = (states[bodyA].collisionLayer & states[bodyB].collisionMask) !== 0
        && (states[bodyB].collisionLayer & states[bodyA].collisionMask) !== 0;
      const overlaps = a.minX <= b.maxX && b.minX <= a.maxX
        && a.minZ <= b.maxZ && b.minZ <= a.maxZ
        && a.minY <= b.maxY && b.minY <= a.maxY;
      if (controlPair && overlaps) candidates[bodyA].push(bodyB);
    }
  }
  return candidates;
}

// Compute版Plane solverのBox support点、法線impulse、摩擦impulse、位置補正を一回分実行します
// fixed step内の累積力積を受け取り、反復ごとに全量を再適用せず差分だけを速度へ加えます
function solvePlaneContact(body, position, orientation, plane, planeIndex, linearVelocity, angularVelocity, iteration, config, accumulator) {
  const normal = plane.normal;
  const corners = computeBoxCorners(body, position, orientation);
  const projections = corners.map((point) => dot3(point, normal));
  const minimum = Math.min(...projections);
  const penetration = plane.planeDistance - minimum;
  if (penetration <= 0) {
    return {
      supportCount: 0,
      normalImpulseApplied: false,
      supportImpulseY: 0,
      contactSpeed: 0,
      normalSpeed: 0,
      linearVelocity,
      angularVelocity,
      impulseAudit: null
    };
  }
  const supportCount = projections.filter((value) => value <= plane.planeDistance + config.positionSlop).length;
  const activePoints = corners.filter((point) => dot3(point, normal) <= plane.planeDistance + config.positionSlop);
  if (activePoints.length === 0) {
    throw new Error(
      `ComputePhysicsCpuEmulator Plane contact has no active support point: planeDistance=${plane.planeDistance} minimum=${minimum} projections=${projections.join(",")}`
    );
  }
  // 重心投影が複数支持の内側にある場合は、支持点へ分配された合力を重心投影へ集約します
  // 1点支持または重心投影が支持範囲外の場合は実接触corner中心を使い、転倒回転を保持します
  const supportBalanced = computePlaneSupportBalance(
    activePoints, normal, position, config.positionSlop
  );
  let supportPoint = supportBalanced
    ? cloneArray(position)
    : scale3(
      activePoints.reduce((sum, point) => add3(sum, point), [0, 0, 0]),
      1 / activePoints.length
    );
  supportPoint = add3(supportPoint, scale3(normal, plane.planeDistance - dot3(supportPoint, normal)));
  const r = sub3(supportPoint, position);
  let contactVelocity = add3(linearVelocity, cross3(angularVelocity, r));
  const normalVelocity = dot3(contactVelocity, normal);
  let normalImpulseApplied = accumulator.normalLambda > EPSILON;
  let frictionImpulse = [0, 0, 0];
  let normalImpulseMagnitude = accumulator.normalLambda;
  let denominator = 0;
  let restitution = 0;
  let tangentSpeed = 0;
  let unrestricted = 0;
  let frictionLimit = accumulator.normalLambda * body.friction;
  let normalImpulseVector = [0, 0, 0];
  let frictionImpulseVector = [0, 0, 0];
  let normalAngularDelta = [0, 0, 0];
  let frictionAngularDelta = [0, 0, 0];
  const angularBefore = cloneArray(angularVelocity);
  if (normalVelocity < 0) {
    const angular = cross3(inverseInertiaApply(orientation, body.inverseInertia, cross3(r, normal)), r);
    denominator = body.inverseMass + dot3(angular, normal);
    if (denominator > 1.0e-7) {
      restitution = iteration === 0 && normalVelocity < -config.restingRestitutionSpeed
        ? body.restitution
        : 0;
      // 反発は最初の反復だけへ残し、静止接触の目標法線速度は0にします
      const targetNormalVelocity = -restitution * normalVelocity;
      const deltaLambda = -(normalVelocity - targetNormalVelocity) / denominator;
      const previousLambda = accumulator.normalLambda;
      const nextLambda = Math.max(previousLambda + deltaLambda, 0);
      const appliedLambda = nextLambda - previousLambda;
      accumulator.normalLambda = nextLambda;
      normalImpulseMagnitude = nextLambda;
      normalImpulseApplied = nextLambda > EPSILON;
      if (Math.abs(appliedLambda) > EPSILON) {
        const impulse = scale3(normal, appliedLambda);
        normalImpulseVector = cloneArray(impulse);
        linearVelocity = add3(linearVelocity, scale3(impulse, body.inverseMass));
        normalAngularDelta = inverseInertiaApply(orientation, body.inverseInertia, cross3(r, impulse));
        angularVelocity = add3(angularVelocity, normalAngularDelta);
      }
    }
  }
  // 累積法線力積がある接触だけで摩擦を解き、摩擦力積が法線力を越えないようにします
  if (accumulator.normalLambda > EPSILON) {
    const tangentSeed = Math.abs(normal[0]) > 0.5 ? [0, 1, 0] : [1, 0, 0];
    const tangentA = normalize3(cross3(normal, tangentSeed));
    const tangentB = normalize3(cross3(normal, tangentA));
    contactVelocity = add3(linearVelocity, cross3(angularVelocity, r));
    const tangentVelocity = sub3(contactVelocity, scale3(normal, dot3(contactVelocity, normal)));
    tangentSpeed = length3(tangentVelocity);
    if (tangentSpeed > EPSILON) {
      const angularTangentA = cross3(
        inverseInertiaApply(orientation, body.inverseInertia, cross3(r, tangentA)), r
      );
      const angularTangentB = cross3(
        inverseInertiaApply(orientation, body.inverseInertia, cross3(r, tangentB)), r
      );
      const denominatorA = body.inverseMass + dot3(angularTangentA, tangentA);
      const denominatorB = body.inverseMass + dot3(angularTangentB, tangentB);
      const deltaA = denominatorA > 1.0e-7
        ? -dot3(contactVelocity, tangentA) / denominatorA
        : 0;
      const deltaB = denominatorB > 1.0e-7
        ? -dot3(contactVelocity, tangentB) / denominatorB
        : 0;
      const requestedA = accumulator.tangentLambdaA + deltaA;
      const requestedB = accumulator.tangentLambdaB + deltaB;
      frictionLimit = accumulator.normalLambda * body.friction;
      const requestedLength = Math.hypot(requestedA, requestedB);
      const tangentScale = requestedLength > frictionLimit && requestedLength > EPSILON
        ? frictionLimit / requestedLength
        : 1;
      const nextA = requestedA * tangentScale;
      const nextB = requestedB * tangentScale;
      const appliedA = nextA - accumulator.tangentLambdaA;
      const appliedB = nextB - accumulator.tangentLambdaB;
      accumulator.tangentLambdaA = nextA;
      accumulator.tangentLambdaB = nextB;
      unrestricted = Math.hypot(deltaA, deltaB);
      frictionImpulse = add3(scale3(tangentA, appliedA), scale3(tangentB, appliedB));
      frictionImpulseVector = cloneArray(frictionImpulse);
      linearVelocity = add3(linearVelocity, scale3(frictionImpulse, body.inverseMass));
      frictionAngularDelta = inverseInertiaApply(
        orientation, body.inverseInertia, cross3(r, frictionImpulse)
      );
      angularVelocity = add3(angularVelocity, frictionAngularDelta);
    }
  }
  const residualVelocity = add3(linearVelocity, cross3(angularVelocity, r));
  position[0] += normal[0] * Math.max(penetration - config.positionSlop, 0) * config.positionCorrectionBeta;
  position[1] += normal[1] * Math.max(penetration - config.positionSlop, 0) * config.positionCorrectionBeta;
  position[2] += normal[2] * Math.max(penetration - config.positionSlop, 0) * config.positionCorrectionBeta;
  return {
    supportCount,
    normalImpulseApplied,
    supportImpulseY: Math.abs(normal[1]) <= 0.5 ? Math.max(frictionImpulse[1], 0) : 0,
    contactSpeed: normalImpulseApplied ? length3(residualVelocity) : 0,
    normalSpeed: normalImpulseApplied ? Math.abs(dot3(residualVelocity, normal)) : 0,
    linearVelocity,
    angularVelocity,
    impulseAudit: normalImpulseApplied
      ? {
        kind: "plane",
        planeIndex,
        iteration: iteration + 1,
        normal,
        point: cloneArray(supportPoint),
        r: cloneArray(r),
        normalImpulseVector,
        frictionImpulseVector,
        normalVelocity,
        denominator,
        normalImpulse: normalImpulseMagnitude,
        restitution,
        tangentSpeed,
        unrestricted,
        frictionLimit,
        frictionImpulse: length3(frictionImpulse),
        angularBefore,
        angularAfter: cloneArray(angularVelocity),
        normalAngularDelta,
        frictionAngularDelta,
        angularDelta: sub3(angularVelocity, angularBefore)
      }
      : null
  };
}

// 一つのbodyについてCompute solverのnormal impulse、friction、position correctionを再現します
// other bodyはGPUと同じstep開始snapshotから読み、A側の局所速度だけを更新します
function solveBodyContact(
  body,
  other,
  otherIndex,
  position,
  orientation,
  linearVelocity,
  angularVelocity,
  iteration,
  config,
  accumulator,
  contactOverride = null
) {
  // config.manifoldPointsが指定されていればその接触点群を使い、未指定時は代表1点を使います
  // 接触点の作り方と力積solverを混ぜず、複数点化の効果だけを比較できるようにします
  const contact = contactOverride ?? computeBoxContact(
    body,
    position,
    orientation,
    other,
    config.supportFeatureTolerance
  );
  if (contact === null) {
    accumulator.normalLambda = 0;
    accumulator.tangentLambdaA = 0;
    accumulator.tangentLambdaB = 0;
    return {
      support: false,
      normalImpulseApplied: false,
      impulseApplied: false,
      contactSpeed: 0,
      normalSpeed: 0,
      otherIndex,
      linearVelocity,
      angularVelocity,
      impulseAudit: null
    };
  }
  const normal = contact.normal;
  const inverseMassSum = body.inverseMass + other.inverseMass;
  if (inverseMassSum <= 1.0e-7) {
    accumulator.normalLambda = 0;
    accumulator.tangentLambdaA = 0;
    accumulator.tangentLambdaB = 0;
    return {
      support: false,
      normalImpulseApplied: false,
      impulseApplied: false,
      contactSpeed: 0,
      normalSpeed: 0,
      otherIndex,
      linearVelocity,
      angularVelocity,
      impulseAudit: null
    };
  }
  const point = contact.point;
  const rA = sub3(point, position);
  const rB = sub3(point, other.position);
  const velocityA = add3(linearVelocity, cross3(angularVelocity, rA));
  const velocityB = add3(other.linearVelocity, cross3(other.angularVelocity, rB));
  const relative = sub3(velocityB, velocityA);
  const normalVelocity = dot3(relative, normal);
  const otherOrientation = quatNormalize(other.orientation);
  let normalImpulseApplied = accumulator.normalLambda > EPSILON;
  let denominator = 0;
  let restitution = 0;
  let normalImpulseMagnitude = accumulator.normalLambda;
  let tangentSpeed = 0;
  let unrestricted = 0;
  let frictionLimit = 0;
  let frictionImpulseMagnitude = 0;
  let normalImpulseVector = [0, 0, 0];
  let frictionImpulseVector = [0, 0, 0];
  let normalAngularDelta = [0, 0, 0];
  let frictionAngularDelta = [0, 0, 0];
  let impulseApplied = false;
  const angularBefore = cloneArray(angularVelocity);
  const angularA = cross3(inverseInertiaApply(orientation, body.inverseInertia, cross3(rA, normal)), rA);
  const angularB = cross3(inverseInertiaApply(otherOrientation, other.inverseInertia, cross3(rB, normal)), rB);
  const otherSleeping = other.sleeping;
  denominator = otherSleeping
    ? body.inverseMass + dot3(angularA, normal)
    : inverseMassSum + dot3(add3(angularA, angularB), normal);
  // config.revisitBodyContactImpulses が有効な場合は局所反復で残留法線速度を解き直します
  // 局所反復でも相手bodyはstep開始snapshotのままなので、CPU近似経路として扱います
  const solvePairImpulse = config.revisitBodyContactImpulses || accumulator.normalLambda <= EPSILON;
  if (solvePairImpulse && normalVelocity < 0 && denominator > 1.0e-7) {
    restitution = iteration === 0 && normalVelocity < -config.restingRestitutionSpeed
      ? Math.min(body.restitution, other.restitution)
      : 0;
    const targetNormalVelocity = -restitution * normalVelocity;
    const deltaLambda = -(normalVelocity - targetNormalVelocity) / denominator;
    const previousLambda = accumulator.normalLambda;
    const nextLambda = Math.max(previousLambda + deltaLambda, 0);
    const appliedLambda = nextLambda - previousLambda;
    accumulator.normalLambda = nextLambda;
    normalImpulseMagnitude = nextLambda;
    normalImpulseApplied = nextLambda > EPSILON;
    if (Math.abs(appliedLambda) > EPSILON) {
      // 法線力積は累積値の差分だけをbody Aへ反映し、反復ごとの全量再適用を避けます
      impulseApplied = true;
      const impulse = scale3(normal, appliedLambda);
      normalImpulseVector = cloneArray(impulse);
      linearVelocity = add3(linearVelocity, scale3(impulse, -body.inverseMass));
      normalAngularDelta = scale3(
        inverseInertiaApply(orientation, body.inverseInertia, cross3(rA, impulse)),
        -1
      );
      angularVelocity = add3(angularVelocity, normalAngularDelta);
    }
  }
  // 累積法線力積があるpairだけで摩擦を解き、接線2方向の力積を摩擦円内へ射影します
  if (solvePairImpulse && accumulator.normalLambda > EPSILON) {
    const basis = computePlaneTangentBasis(normal);
    const postRelative = sub3(velocityB, add3(linearVelocity, cross3(angularVelocity, rA)));
    const tangentVelocity = sub3(postRelative, scale3(normal, dot3(postRelative, normal)));
    tangentSpeed = length3(tangentVelocity);
    if (tangentSpeed > EPSILON) {
      const tangentA = basis[0];
      const tangentB = basis[1];
      const angularTangentA = cross3(
        inverseInertiaApply(orientation, body.inverseInertia, cross3(rA, tangentA)), rA
      );
      const angularTangentB = cross3(
        inverseInertiaApply(otherOrientation, other.inverseInertia, cross3(rB, tangentA)), rB
      );
      const angularTangentA2 = cross3(
        inverseInertiaApply(orientation, body.inverseInertia, cross3(rA, tangentB)), rA
      );
      const angularTangentB2 = cross3(
        inverseInertiaApply(otherOrientation, other.inverseInertia, cross3(rB, tangentB)), rB
      );
      const denominatorA = otherSleeping
        ? body.inverseMass + dot3(angularTangentA, tangentA)
        : inverseMassSum + dot3(add3(angularTangentA, angularTangentB), tangentA);
      const denominatorB = otherSleeping
        ? body.inverseMass + dot3(angularTangentA2, tangentB)
        : inverseMassSum + dot3(add3(angularTangentA2, angularTangentB2), tangentB);
      const deltaA = denominatorA > EPSILON ? -dot3(postRelative, tangentA) / denominatorA : 0;
      const deltaB = denominatorB > EPSILON ? -dot3(postRelative, tangentB) / denominatorB : 0;
      const requestedA = accumulator.tangentLambdaA + deltaA;
      const requestedB = accumulator.tangentLambdaB + deltaB;
      frictionLimit = accumulator.normalLambda * Math.sqrt(Math.max(body.friction * other.friction, 0));
      const requestedLength = Math.hypot(requestedA, requestedB);
      const tangentScale = requestedLength > frictionLimit && requestedLength > EPSILON
        ? frictionLimit / requestedLength
        : 1;
      const nextA = requestedA * tangentScale;
      const nextB = requestedB * tangentScale;
      const appliedA = nextA - accumulator.tangentLambdaA;
      const appliedB = nextB - accumulator.tangentLambdaB;
      accumulator.tangentLambdaA = nextA;
      accumulator.tangentLambdaB = nextB;
      unrestricted = Math.hypot(deltaA, deltaB);
      const frictionImpulse = add3(scale3(tangentA, appliedA), scale3(tangentB, appliedB));
      frictionImpulseMagnitude = length3(frictionImpulse);
      frictionImpulseVector = cloneArray(frictionImpulse);
      if (frictionImpulseMagnitude > EPSILON) {
        impulseApplied = true;
        linearVelocity = add3(linearVelocity, scale3(frictionImpulse, -body.inverseMass));
        frictionAngularDelta = scale3(
          inverseInertiaApply(orientation, body.inverseInertia, cross3(rA, frictionImpulse)),
          -1
        );
        angularVelocity = add3(angularVelocity, frictionAngularDelta);
      }
    }
  }
  const residualVelocity = sub3(
    velocityB,
    add3(linearVelocity, cross3(angularVelocity, rA))
  );
  const correction = Math.max(contact.penetration - config.positionSlop, 0) * config.positionCorrectionBeta;
  const correctionScale = body.inverseMass / inverseMassSum;
  const correctionVector = scale3(normal, -correction * correctionScale);
  position[0] += correctionVector[0];
  position[1] += correctionVector[1];
  position[2] += correctionVector[2];
  return {
    support: normal[1] < -0.5,
    normalImpulseApplied,
    impulseApplied,
    contactSpeed: normalImpulseApplied && iteration + 1 >= config.solverIterations ? length3(residualVelocity) : 0,
    normalSpeed: normalImpulseApplied && iteration + 1 >= config.solverIterations
      ? Math.abs(dot3(residualVelocity, normal))
      : 0,
    otherIndex,
    normalVelocity,
    position: cloneArray(point),
    linearVelocity: cloneArray(linearVelocity),
    angularVelocity: cloneArray(angularVelocity),
    impulseAudit: normalImpulseApplied
      ? {
        kind: "body",
        otherId: other.id,
        iteration: iteration + 1,
        normal,
        point: cloneArray(point),
        r: cloneArray(rA),
        normalImpulseVector,
        frictionImpulseVector,
        normalVelocity,
        denominator,
        normalImpulse: normalImpulseMagnitude,
        restitution,
        tangentSpeed,
        unrestricted,
        frictionLimit,
        frictionImpulse: frictionImpulseMagnitude,
        angularBefore,
        angularAfter: cloneArray(angularVelocity),
        normalAngularDelta,
        frictionAngularDelta,
        angularDelta: sub3(angularVelocity, angularBefore),
        manifoldIndex: contact.manifoldIndex ?? 0,
        manifoldCount: contact.manifoldCount ?? 1
      }
      : null
  };
}

// CPU側の一fixed stepを実行し、GPUのB31 stage診断へ対応する途中速度も保持します
// bodyごとの処理は同じsource snapshotから独立に書き出し、GPUのping-pong state更新順へ合わせます
export default class ComputePhysicsCpuEmulator {
  constructor(options = {}) {
    if (!Array.isArray(options.bodies) || options.bodies.length === 0) {
      throw new Error("ComputePhysicsCpuEmulator bodies must be a non-empty array");
    }
    if (!Array.isArray(options.gravity) || options.gravity.length !== 3) {
      throw new Error("ComputePhysicsCpuEmulator gravity must be a 3 element array");
    }
    if (!Number.isFinite(options.fixedTimeStepMs) || options.fixedTimeStepMs <= 0) {
      throw new Error("ComputePhysicsCpuEmulator fixedTimeStepMs must be positive");
    }
    if (!Number.isInteger(options.solverIterations) || options.solverIterations < 1) {
      throw new Error("ComputePhysicsCpuEmulator solverIterations must be a positive integer");
    }
    const bodyContactManifoldPoints = options.bodyContactManifoldPoints ?? 1;
    if (!Number.isInteger(bodyContactManifoldPoints)
      || bodyContactManifoldPoints < 1
      || bodyContactManifoldPoints > 4) {
      throw new Error("ComputePhysicsCpuEmulator bodyContactManifoldPoints must be an integer from 1 to 4");
    }
    const revisitBodyContactImpulses = options.revisitBodyContactImpulses ?? false;
    if (typeof revisitBodyContactImpulses !== "boolean") {
      throw new Error("ComputePhysicsCpuEmulator revisitBodyContactImpulses must be boolean");
    }
    const traceBodyIds = options.traceBodyIds ?? [];
    if (!Array.isArray(traceBodyIds) || traceBodyIds.some((bodyId) => !Number.isInteger(bodyId))) {
      throw new Error("ComputePhysicsCpuEmulator traceBodyIds must be an array of integer body IDs");
    }
    this.gravity = cloneArray(options.gravity);
    this.traceBodyIds = new Set(traceBodyIds);
    this.planes = createBoundaryPlanes(options.bounds);
    this.config = {
      dt: options.fixedTimeStepMs / 1000,
      solverIterations: options.solverIterations,
      bodyContactManifoldPoints,
      revisitBodyContactImpulses,
      persistentSleep: options.persistentSleep !== false,
      positionCorrectionBeta: options.positionCorrectionBeta ?? 1,
      positionSlop: options.positionSlop ?? 0.0005,
      broadphasePadding: options.broadphasePadding ?? 0.001,
      supportFeatureTolerance: options.supportFeatureTolerance ?? 0.01,
      restingRestitutionSpeed: options.restingRestitutionSpeed ?? 0.5,
      sleepLinearSpeed: options.sleepLinearSpeed ?? 0.02,
      sleepAngularSpeed: options.sleepAngularSpeed ?? 0.3,
      sleepContactSpeed: options.sleepContactSpeed ?? 0.01,
      sleepNormalSpeed: options.sleepNormalSpeed ?? 0.02,
      sleepSteps: options.sleepSteps ?? 5,
      minimumFloorSupportPoints: options.minimumFloorSupportPoints ?? 2,
      wakeLinearSpeed: options.wakeLinearSpeed ?? 0.03,
      wakeAngularSpeed: options.wakeAngularSpeed
        ?? (options.sleepAngularSpeed ?? 0.3) * 1.5,
      divergenceLimits: {
        position: options.divergencePositionLimit ?? DEFAULT_DIVERGENCE_LIMITS.position,
        linear: options.divergenceLinearLimit ?? DEFAULT_DIVERGENCE_LIMITS.linear,
        angular: options.divergenceAngularLimit ?? DEFAULT_DIVERGENCE_LIMITS.angular,
        orientation: options.divergenceOrientationLimit ?? DEFAULT_DIVERGENCE_LIMITS.orientation
      }
    };
    if (this.config.wakeAngularSpeed < this.config.sleepAngularSpeed) {
      throw new Error("ComputePhysicsCpuEmulator wakeAngularSpeed must be at least sleepAngularSpeed");
    }
    this.reset(options.bodies);
  }

  // 初期descriptorからCPU状態を再構築し、GPUのR操作と同じ開始条件へ戻します
  // state、sleep counter、命令、診断peakを同時に消去します
  reset(bodies) {
    if (!Array.isArray(bodies) || bodies.length === 0) {
      throw new Error("ComputePhysicsCpuEmulator reset bodies must be a non-empty array");
    }
    this.states = bodies.map((body) => buildState(body));
    this.commands = this.states.map(() => ({ angularImpulse: [0, 0, 0] }));
    this.bodyIndexById = new Map(this.states.map((body, index) => [body.id, index]));
    this.fixedStepCount = 0;
    this.lastStage = null;
    this.lastTrace = null;
    this.peakStage = null;
    this.firstDivergence = null;
    this.lastReport = null;
    for (const bodyId of this.traceBodyIds) {
      if (!this.bodyIndexById.has(bodyId)) {
        throw new Error(`ComputePhysicsCpuEmulator trace body ${bodyId} is missing from bodies`);
      }
    }
  }

  // GPUのapplyAngularImpulseに対応する一回命令をCPU側へ蓄積します
  // 次のfixed stepで一度だけ消費し、commandをそのstepの入力として扱います
  applyAngularImpulse(bodyId, impulse) {
    const index = this.bodyIndexById.get(bodyId);
    if (index === undefined) throw new Error(`ComputePhysicsCpuEmulator unknown body id: ${bodyId}`);
    if (!Array.isArray(impulse) || impulse.length !== 3 || impulse.some((value) => !Number.isFinite(value))) {
      throw new Error("ComputePhysicsCpuEmulator angular impulse must be a finite 3 element array");
    }
    this.commands[index].angularImpulse = add3(this.commands[index].angularImpulse, impulse);
  }

  // 指定fixed step数だけCPU状態を進め、最後のB31 stageを返します
  // 0 stepを許可し、GPU readbackが同一frame内に物理更新を含まない場合も比較状態を保持します
  advance(stepCount) {
    if (!Number.isInteger(stepCount) || stepCount < 0) {
      throw new Error("ComputePhysicsCpuEmulator advance stepCount must be a non-negative integer");
    }
    let stage = this.lastStage;
    for (let step = 0; step < stepCount; step++) {
      stage = this.step();
      this.fixedStepCount += 1;
    }
    this.lastStage = stage;
    return stage;
  }

  // GPUの一body一invocation方式をCPUでbody単位に再現し、全bodyの新stateを同時に確定します
  // 途中でthis.statesを書き換えず、同じsource snapshotを各bodyのother入力へ渡します
  step() {
    const source = this.states.map((body) => cloneState(body));
    const commands = this.commands.map((command) => ({ angularImpulse: cloneArray(command.angularImpulse) }));
    const aabbs = buildPredictedAabbs(source, commands, { ...this.config, gravity: this.gravity });
    const candidates = buildCandidates(source, aabbs, this.config);
    const nextStates = [];
    const traces = [];
    let b31Stage = null;
    for (let index = 0; index < source.length; index++) {
      const result = this.solveBody(
        index,
        source,
        commands,
        candidates[index],
        this.traceBodyIds.has(source[index].id)
      );
      nextStates.push(result.state);
      if (result.stage !== null) b31Stage = result.stage;
      if (result.trace !== null) traces.push(result.trace);
    }
    this.states = nextStates;
    this.commands = this.states.map(() => ({ angularImpulse: [0, 0, 0] }));
    this.lastTrace = traces.length === 0
      ? null
      : {
        fixedStep: this.fixedStepCount + 1,
        bodies: traces.map(cloneBodyTrace)
      };
    if (b31Stage !== null) {
      const currentPeak = Math.max(b31Stage.afterB30[3], b31Stage.afterB32[3], b31Stage.afterPlane[3]);
      const previousPeak = this.peakStage === null
        ? -Infinity
        : Math.max(this.peakStage.afterB30[3], this.peakStage.afterB32[3], this.peakStage.afterPlane[3]);
      if (currentPeak > previousPeak) this.peakStage = cloneStage(b31Stage);
    }
    return b31Stage;
  }

  // sleep bodyへ接触するawake bodyだけを走査し、現在接触または次fixed stepの接触で法線接近を判定します
  // sleep中の隣接bodyをwake起点にせず、連鎖の直前bodyが既に接触している場合も取りこぼさないようにします
  findWakeContact(index, source, commands, candidateIndices) {
    const body = source[index];
    let best = { contact: false, normalVelocity: 0, approachSpeed: 0, otherIndex: -1 };
    for (const otherIndex of candidateIndices) {
      const other = source[otherIndex];
      if (other.bodyType === "static" || other.sleeping) continue;
      // まず現在位置の接触を確認し、既に接触しているawake bodyからの連鎖を保持します
      let contact = computeBoxContact(other, other.position, other.orientation, body, this.config.supportFeatureTolerance);
      let contactOther = other;
      if (contact === null) {
        // 現在は離れているpairだけ、次fixed stepの活動bodyを予測して新規接触を調べます
        const predictedOther = predictWakeBody(other, commands[otherIndex], this.config, this.config.dt, this.gravity);
        contactOther = predictedOther;
        contact = computeBoxContact(contactOther, contactOther.position, contactOther.orientation, body, this.config.supportFeatureTolerance);
      }
      if (contact === null) continue;
      const point = contact.point;
      const velocityA = add3(contactOther.linearVelocity, cross3(contactOther.angularVelocity, sub3(point, contactOther.position)));
      const velocityB = add3(body.linearVelocity, cross3(body.angularVelocity, sub3(point, body.position)));
      const normalVelocity = dot3(sub3(velocityB, velocityA), contact.normal);
      const approachSpeed = Math.max(0, -normalVelocity);
      if (!best.contact || approachSpeed > best.approachSpeed) {
        best = { contact: true, normalVelocity, approachSpeed, otherIndex };
      }
      // 現在接触でも予測接触でも、awake bodyからの法線接近が閾値へ届けばsleep bodyを起こします
      if (normalVelocity <= -this.config.wakeLinearSpeed) {
        return { awake: true, ...best };
      }
    }
    return { awake: false, ...best };
  }

  // 一つのbodyの外部命令、減衰、接触solver、sleep判定をGPUの順番で実行します
  // 計算順序を変更した近似結果を「GPU再現」と表示しないため、未対応形状は初期化時に拒否します
  solveBody(index, source, commands, candidateIndices, traceEnabled = false) {
    const sourceBody = source[index];
    const command = commands[index];
    let position = cloneArray(sourceBody.position);
    let orientation = quatNormalize(sourceBody.orientation);
    let linearVelocity = cloneArray(sourceBody.linearVelocity);
    let angularVelocity = cloneArray(sourceBody.angularVelocity);
    const trace = traceEnabled
      ? {
        id: sourceBody.id,
        start: [...sourceBody.linearVelocity, length3(sourceBody.angularVelocity)],
        preContact: null,
        bodyImpulses: [],
        planeImpulses: [],
        end: null,
        sleeping: false
      }
      : null;
    const commandWakes = length3(command.angularImpulse) > 0;
    const sourceWasSleeping = this.config.persistentSleep && sourceBody.sleeping;
    let wasSleeping = sourceWasSleeping && sourceBody.allowSleep && !commandWakes;
    if (sourceBody.bodyType === "static") {
      if (trace !== null) {
        trace.preContact = [0, 0, 0, 0];
        trace.end = [0, 0, 0, 0];
      }
      return {
        state: { ...cloneState(sourceBody), position, orientation, linearVelocity: [0, 0, 0], angularVelocity: [0, 0, 0], sleeping: false },
        stage: null,
        trace
      };
    }
    let wakeAudit = { awake: false, contact: false, normalVelocity: 0, approachSpeed: 0, otherIndex: -1 };
    if (wasSleeping) {
      wakeAudit = this.findWakeContact(index, source, commands, candidateIndices);
      if (!wakeAudit.awake) {
        if (trace !== null) {
          trace.end = [...sourceBody.linearVelocity, length3(sourceBody.angularVelocity)];
          trace.sleeping = true;
        }
        return { state: cloneState(sourceBody), stage: null, trace };
      }
      wasSleeping = false;
    }
    if (sourceBody.bodyType === "dynamic") {
      linearVelocity = add3(linearVelocity, scale3(this.gravity, sourceBody.gravityScale * this.config.dt));
      angularVelocity = add3(
        angularVelocity,
        inverseInertiaApply(orientation, sourceBody.inverseInertia, command.angularImpulse)
      );
    }
    linearVelocity = scale3(linearVelocity, Math.exp(-sourceBody.linearDamping * this.config.dt));
    angularVelocity = scale3(angularVelocity, Math.exp(-sourceBody.angularDamping * this.config.dt));
    position = add3(position, scale3(linearVelocity, this.config.dt));
    orientation = integrateOrientation(orientation, angularVelocity, this.config.dt);
    if (trace !== null) trace.preContact = [...linearVelocity, length3(angularVelocity)];
    const stage = sourceBody.id === 31
      ? {
        start: [...sourceBody.linearVelocity, length3(sourceBody.angularVelocity)],
        afterB30: [0, 0, 0, 0],
        afterB32: [0, 0, 0, 0],
        afterPlane: [0, 0, 0, 0],
        end: [0, 0, 0, 0],
        events: [0, 0, 0, 0]
      }
      : null;
    let hasSupport = false;
    let bodyContactObserved = false;
    let activeDynamicBodyContactObserved = false;
    let nonFloorPlaneContactObserved = false;
    let maxContactSpeed = 0;
    let maxNormalSpeed = 0;
    let floorContactObserved = false;
    let floorSupportPoints = 8;
    let wallSupportImpulseY = 0;
    let bodySupportObserved = false;
    let peakSupportPenetration = -Infinity;
    let peakSupportNormalImpulse = 0;
    let peakSupportOtherSleeping = false;
    let wakeSolverSeed = sourceWasSleeping && wakeAudit.awake;
    // GPUのPlaneごとのfunction-local accumulatorをCPU側でもfixed step単位で保持します
    // solver反復で全量を再適用せず、法線・摩擦力積の増分だけを同じ順序で反映します
    const planeImpulseAccumulators = this.planes.map(() => ({
      normalLambda: 0,
      tangentLambdaA: 0,
      tangentLambdaB: 0
    }));
    // GPUと同じくcandidate pairごとに累積力積を分け、pairごとの接触拘束を独立して扱います
    const pairImpulseAccumulators = new Map(candidateIndices.map((otherIndex) => [otherIndex, null]));
    for (let iteration = 0; iteration < this.config.solverIterations; iteration++) {
      // candidate bitsetをslot昇順で走査し、B30/B32の順番がGPUと一致するようにします
      for (const otherIndex of candidateIndices) {
        const solverOther = wakeSolverSeed && otherIndex === wakeAudit.otherIndex
          ? predictWakeBody(source[otherIndex], commands[otherIndex], this.config, this.config.dt, this.gravity)
          : source[otherIndex];
        const contacts = this.config.bodyContactManifoldPoints === 1
          ? [computeBoxContact(
            sourceBody,
            position,
            orientation,
            solverOther,
            this.config.supportFeatureTolerance
          )]
          : computeBoxContacts(
            sourceBody,
            position,
            orientation,
            solverOther,
            this.config.supportFeatureTolerance,
            this.config.bodyContactManifoldPoints
          );
        const validContacts = contacts[0] === null ? [] : contacts;
        if (validContacts.length === 0) {
          pairImpulseAccumulators.set(otherIndex, null);
          continue;
        }
        // GPUと同じく、法線方向や力積の有無に関係なく現在stepの実接触を記録します
        // sleep中bodyだけとの接触とactive bodyとの接触を後段で分けるため、最終接触を記録します
        bodyContactObserved = true;
        if (solverOther.inverseMass > 0 && !solverOther.sleeping) {
          activeDynamicBodyContactObserved = true;
        }
        let accumulators = pairImpulseAccumulators.get(otherIndex);
        if (accumulators === null || accumulators.length !== validContacts.length) {
          accumulators = validContacts.map(() => ({
            normalLambda: 0,
            tangentLambdaA: 0,
            tangentLambdaB: 0
          }));
          pairImpulseAccumulators.set(otherIndex, accumulators);
        }
        for (let contactIndex = 0; contactIndex < validContacts.length; contactIndex++) {
          const contactResult = solveBodyContact(
            sourceBody,
            solverOther,
            otherIndex,
            position,
            orientation,
            linearVelocity,
            angularVelocity,
            iteration,
            this.config,
            accumulators[contactIndex],
            validContacts[contactIndex]
          );
          linearVelocity = contactResult.linearVelocity;
          angularVelocity = contactResult.angularVelocity;
          if (trace !== null && contactResult.impulseAudit !== null) {
            trace.bodyImpulses.push(cloneImpulseAudit(contactResult.impulseAudit));
          }
          if (contactResult.support) {
            bodySupportObserved = true;
            hasSupport = true;
            if (contactResult.normalVelocity !== undefined && contactResult.normalVelocity < 0) {
              peakSupportPenetration = Math.max(peakSupportPenetration, contactResult.normalVelocity);
            }
          }
          maxContactSpeed = Math.max(maxContactSpeed, contactResult.contactSpeed);
          maxNormalSpeed = Math.max(maxNormalSpeed, contactResult.normalSpeed);
          if (stage !== null && contactResult.impulseApplied) {
            const stageValue = [...linearVelocity, length3(angularVelocity)];
            if (otherIndex === 29) {
              stage.afterB30 = stageValue;
              stage.events[0] = iteration + 1;
            }
            if (otherIndex === 31) {
              stage.afterB32 = stageValue;
              stage.events[1] = iteration + 1;
            }
          }
        }
      }
      for (let planeIndex = 0; planeIndex < this.planes.length; planeIndex++) {
        const plane = this.planes[planeIndex];
        const planeResult = solvePlaneContact(
          sourceBody,
          position,
          orientation,
          plane,
          planeIndex,
          linearVelocity,
          angularVelocity,
          iteration,
          this.config,
          planeImpulseAccumulators[planeIndex]
        );
        linearVelocity = planeResult.linearVelocity;
        angularVelocity = planeResult.angularVelocity;
        if (trace !== null && planeResult.impulseAudit !== null) {
          trace.planeImpulses.push(cloneImpulseAudit(planeResult.impulseAudit));
        }
        maxContactSpeed = Math.max(maxContactSpeed, planeResult.contactSpeed);
        maxNormalSpeed = Math.max(maxNormalSpeed, planeResult.normalSpeed);
        wallSupportImpulseY += iteration + 1 >= this.config.solverIterations ? planeResult.supportImpulseY : 0;
        if (planeResult.supportCount > 0 && plane.normal[1] > 0.5) {
          floorContactObserved = true;
          floorSupportPoints = Math.min(floorSupportPoints, planeResult.supportCount);
          hasSupport = hasSupport || planeResult.supportCount >= this.config.minimumFloorSupportPoints;
        }
        if (planeResult.supportCount > 0 && Math.abs(plane.normal[1]) <= 0.5) {
          // 床以外のPlaneとの実接触を、床1点支持bodyの外部支持候補へ記録します
          nonFloorPlaneContactObserved = true;
        }
        if (stage !== null && planeResult.normalImpulseApplied) {
          stage.afterPlane = [...linearVelocity, length3(angularVelocity)];
          stage.events[2] = iteration + 1;
          stage.events[3] = planeIndex + 1;
        }
      }
    }
    const wallSupportObserved = wallSupportImpulseY > 0;
    const floorOnePointExternalContact = floorContactObserved
      && floorSupportPoints < this.config.minimumFloorSupportPoints
      && (bodyContactObserved || nonFloorPlaneContactObserved);
    const combinedSupport = floorSupportPoints >= this.config.minimumFloorSupportPoints
      || bodySupportObserved
      || wallSupportObserved
      || floorOnePointExternalContact;
    if (floorContactObserved) {
      // 床1点だけでも同じstepにbodyまたは壁との実接触があれば、外部接触付き支持として扱います
      hasSupport = (hasSupport && combinedSupport) || floorOnePointExternalContact;
    } else {
      hasSupport = hasSupport || wallSupportObserved;
    }
    const lowMotion = length3(linearVelocity) < this.config.sleepLinearSpeed
      && length3(angularVelocity) < this.config.sleepAngularSpeed;
    const quietContact = maxContactSpeed < this.config.sleepContactSpeed
      && maxNormalSpeed < this.config.sleepNormalSpeed;
    // 床へ密着して自身が静止したbodyは、上載bodyの沈み込み速度を分離してsleepを判定します
    // 下側body自身の速度はlowMotionで検査し、上載bodyが強く押し込めばwake条件で再びsolverへ戻します
    const floorSupportLoadSettled = floorContactObserved
      && floorSupportPoints >= this.config.minimumFloorSupportPoints
      && lowMotion;
    let sleepContactQuiet = quietContact || floorSupportLoadSettled;
    // sleep中bodyとの微小な再接触だけでcounterを失わせず、active body接触では通常条件を適用します
    const sleepingContactsOnly = bodyContactObserved && !activeDynamicBodyContactObserved;
    const lowMotionWithSleepingContacts = sleepingContactsOnly
      && length3(linearVelocity) < this.config.wakeLinearSpeed
      && length3(angularVelocity) < this.config.wakeAngularSpeed;
    const sleepMotionSettled = lowMotion || lowMotionWithSleepingContacts;
    sleepContactQuiet = sleepContactQuiet || lowMotionWithSleepingContacts;
    let sleepCounter = sourceWasSleeping && wakeAudit.awake ? 0 : sourceBody.sleepCounter;
    let sleepFlag = false;
    if (this.config.persistentSleep
      && sourceBody.allowSleep
      && hasSupport
      && sleepMotionSettled
      && sleepContactQuiet) {
      sleepCounter = Math.min(sleepCounter + 1, this.config.sleepSteps);
      if (sleepCounter >= this.config.sleepSteps) {
        linearVelocity = [0, 0, 0];
        angularVelocity = [0, 0, 0];
        sleepFlag = true;
      }
    } else {
      sleepCounter = 0;
    }
    if (stage !== null) {
      stage.end = [...linearVelocity, length3(angularVelocity)];
    }
    if (trace !== null) {
      trace.end = [...linearVelocity, length3(angularVelocity)];
      trace.sleeping = sleepFlag;
    }
    return {
      state: {
        ...cloneState(sourceBody),
        position,
        orientation,
        linearVelocity,
        angularVelocity,
        sleeping: sleepFlag,
        sleepCounter
      },
      stage,
      trace
    };
  }

  // 最新CPU状態をbody ID別に返し、GPU readbackとの差分計算が固定slotへ依存しないようにします
  // 配列を直接公開せず、比較表示側がCPU状態を変更できない複製を返します
  getStates() {
    return new Map(this.states.map((state) => [state.id, Object.freeze(cloneState(state))]));
  }

  // 最新fixed stepの全trace body接触履歴を返し、発生源を後段の解析で選べるようにします
  // GPU stateやCPU stateを返すAPIとは分離し、診断を有効にした場合だけ明示的に利用します
  getLastTrace() {
    return cloneStepTrace(this.lastTrace);
  }

  // GPU状態とCPU状態の最大差分をbody別に調べ、最初に大きく外れたbodyも残します
  // CPU演算の丸め誤差を隠す許容値は設けず、位置・線速度・角速度・姿勢・sleepを個別に表示します
  compare(gpuStates) {
    if (!(gpuStates instanceof Map)) throw new Error("ComputePhysicsCpuEmulator compare gpuStates must be a Map");
    const result = {
      maxPositionError: 0,
      maxLinearError: 0,
      maxAngularError: 0,
      maxOrientationError: 0,
      positionBodyId: null,
      linearBodyId: null,
      angularBodyId: null,
      orientationBodyId: null,
      sleepingMismatchCount: 0
    };
    for (const cpuState of this.states) {
      const gpuState = gpuStates.get(cpuState.id);
      if (!gpuState) throw new Error(`ComputePhysicsCpuEmulator GPU state is missing body ${cpuState.id}`);
      const positionError = length3(sub3(cpuState.position, gpuState.position));
      const linearError = length3(sub3(cpuState.linearVelocity, gpuState.linearVelocity));
      const angularError = length3(sub3(cpuState.angularVelocity, gpuState.angularVelocity));
      const orientationError = Math.hypot(
        cpuState.orientation[0] - gpuState.orientation[0],
        cpuState.orientation[1] - gpuState.orientation[1],
        cpuState.orientation[2] - gpuState.orientation[2],
        cpuState.orientation[3] - gpuState.orientation[3]
      );
      if (positionError > result.maxPositionError) {
        result.maxPositionError = positionError;
        result.positionBodyId = cpuState.id;
      }
      if (linearError > result.maxLinearError) {
        result.maxLinearError = linearError;
        result.linearBodyId = cpuState.id;
      }
      if (angularError > result.maxAngularError) {
        result.maxAngularError = angularError;
        result.angularBodyId = cpuState.id;
      }
      if (orientationError > result.maxOrientationError) {
        result.maxOrientationError = orientationError;
        result.orientationBodyId = cpuState.id;
      }
      if (cpuState.sleeping !== gpuState.sleeping) result.sleepingMismatchCount += 1;
    }
    return result;
  }

  // 最初に設定した比較限界を越えたreadback境界だけを保存し、接触連鎖で差分が増えた位置を追跡します
  // GPU状態へ追従して差分を消す処理はせず、CPU独立計算の最初の崩れをそのまま残します
  recordFirstDivergence(phase, fixedStep, comparison) {
    if (this.firstDivergence !== null) return;
    const limits = this.config.divergenceLimits;
    const diverged = comparison.maxPositionError > limits.position
      || comparison.maxLinearError > limits.linear
      || comparison.maxAngularError > limits.angular
      || comparison.maxOrientationError > limits.orientation;
    if (diverged) {
      this.firstDivergence = Object.freeze({
        phase,
        fixedStep,
        ...comparison
      });
    }
  }

  // readback境界の前後でCPUを比較し、進めたfixed step数とB31途中速度を一つにまとめます
  // GPU stateをCPUへコピーして一致させる処理はせず、差分が拡大する時点をそのまま診断へ渡します
  compareAndAdvance(preGpuStates, postGpuStates, stepCount, preFixedStepCount = null) {
    if (preFixedStepCount !== null) {
      if (!Number.isInteger(preFixedStepCount) || preFixedStepCount < 0) {
        throw new Error("ComputePhysicsCpuEmulator preFixedStepCount must be a non-negative integer");
      }
      if (this.fixedStepCount > preFixedStepCount) {
        throw new Error(
          `ComputePhysicsCpuEmulator timeline moved backwards: cpu=${this.fixedStepCount} gpu=${preFixedStepCount}`
        );
      }
      // readbackがCPU計算より先に進んだ場合は、途中のGPU stateを補正入力にせずCPUだけを同じstep数まで追い付きます
      const catchUpSteps = preFixedStepCount - this.fixedStepCount;
      if (catchUpSteps > 0) this.advance(catchUpSteps);
    }
    const before = this.compare(preGpuStates);
    this.recordFirstDivergence(
      "before",
      preFixedStepCount ?? this.fixedStepCount,
      before
    );
    const stage = this.advance(stepCount);
    const after = this.compare(postGpuStates);
    this.recordFirstDivergence(
      "after",
      preFixedStepCount === null ? this.fixedStepCount : preFixedStepCount + stepCount,
      after
    );
    this.lastReport = Object.freeze({
      cpuFixedStep: this.fixedStepCount,
      advancedSteps: stepCount,
      catchUpSteps: preFixedStepCount === null ? 0 : Math.max(0, preFixedStepCount - (this.fixedStepCount - stepCount)),
      firstDivergence: this.firstDivergence,
      before,
      after,
      // falling_dominoes専用診断がB29〜B32のpair力積をCoreへ埋め込まずに参照できるよう、独立traceを返します
      trace: this.lastTrace === null ? null : cloneStepTrace(this.lastTrace),
      stage: stage ? {
        ...cloneStage(stage)
      } : null,
      peakStage: cloneStage(this.peakStage)
    });
    return this.lastReport;
  }

  // 最後に計算したCPU/GPU比較結果を読み取り、readback未完了時は明示的にnullを返します
  getLastReport() {
    return this.lastReport;
  }
}
