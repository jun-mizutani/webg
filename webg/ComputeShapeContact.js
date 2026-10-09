// ---------------------------------------------
//  ComputeShapeContact.js  2026/09/13
//   Compute-only CPU shape-pair contact construction for webg
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// Compute colliderのCPU readback queryで使う形状ペア固有の接触式をまとめます
// CPU版Colliderの委譲順に依存せず、entry A/BとGPU shape dispatchの順序をここで明示します

// 二点間の差を新しい配列で返し、法線と距離の計算へ使います
function subtract(left, right) {
  return [
    left[0] - right[0],
    left[1] - right[1],
    left[2] - right[2]
  ];
}

// 点へベクトルを加え、表面点や接触点のworld座標を構成します
function add(left, right) {
  return [
    left[0] + right[0],
    left[1] + right[1],
    left[2] + right[2]
  ];
}

// ベクトルをscalar倍し、半径方向の表面点を求めます
function scale(value, scalar) {
  return [value[0] * scalar, value[1] * scalar, value[2] * scalar];
}

// 二つのベクトルの内積を求め、姿勢付きBoxのlocal座標を計算します
function dot(left, right) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

// ベクトル長を求め、接触のpenetrationと単位法線を計算します
function length(value) {
  return Math.hypot(value[0], value[1], value[2]);
}

// 距離がある場合はdeltaを正規化し、中心一致の退化状態ではGPUと同じ基準軸を返します
// 退化状態を別の接触へ補正せず、形状式で定めた決定的な法線だけを選びます
function normalFromDelta(delta, distance) {
  return distance > 1.0e-8 ? scale(delta, 1.0 / distance) : [1.0, 0.0, 0.0];
}

// 単一contactの共通形式を作り、呼出し側のbody entry順をそのまま保持します
// manifoldへの変換は各Compute Colliderの基底Collider処理へ任せます
function createContact(bodyA, bodyB, normal, penetration, point) {
  return {
    bodyA,
    bodyB,
    normal,
    penetration,
    point
  };
}

// 逆順の形状計算結果をentry A/B順へ戻し、法線だけを反転します
// 接触点とpenetrationは形状の同じ接触を表すため、そのまま保持します
function reverseContact(contact, bodyA, bodyB) {
  if (contact === null) return null;
  return createContact(
    bodyA,
    bodyB,
    scale(contact.normal, -1.0),
    contact.penetration,
    [...contact.point]
  );
}

// SphereとCapsuleの最近接線分点からGPUと同じ二表面点中点contactを作ります
// Sphere先行のnormalはSphereからCapsuleへ向け、body A/Bは呼出し側entry順を維持します
export function buildSphereCapsuleContact(
  sphereCollider,
  spherePosition,
  capsuleCollider,
  capsulePosition,
  bodyA,
  bodyB,
  _sphereQuat = null,
  capsuleQuat = null
) {
  const sphere = sphereCollider.getWorldInfo(spherePosition);
  const capsule = capsuleCollider.getWorldInfo(capsulePosition, capsuleQuat);
  const capsuleClosestPoint = capsuleCollider.cpuCollider._closestPointOnSegment(
    capsule.pointA,
    capsule.pointB,
    sphere.center
  );
  const delta = subtract(capsuleClosestPoint, sphere.center);
  const distance = length(delta);
  const penetration = sphere.radius + capsule.radius - distance;
  if (penetration <= 0.0) return null;
  const normal = normalFromDelta(delta, distance);
  const sphereSurfacePoint = add(sphere.center, scale(normal, sphere.radius));
  const capsuleSurfacePoint = subtract(capsuleClosestPoint, scale(normal, capsule.radius));
  return createContact(
    bodyA,
    bodyB,
    normal,
    penetration,
    scale(add(sphereSurfacePoint, capsuleSurfacePoint), 0.5)
  );
}

// CapsuleとSphereの逆順をSphere先行の式で計算し、entry A/Bへ戻します
// GPUのcapsuleB/sphereA分岐が行う法線反転と同じ向きをCPU readbackへ適用します
export function buildCapsuleSphereContact(
  capsuleCollider,
  capsulePosition,
  sphereCollider,
  spherePosition,
  bodyA,
  bodyB,
  capsuleQuat = null,
  sphereQuat = null
) {
  const sphereFirst = buildSphereCapsuleContact(
    sphereCollider,
    spherePosition,
    capsuleCollider,
    capsulePosition,
    bodyB,
    bodyA,
    sphereQuat,
    capsuleQuat
  );
  return reverseContact(sphereFirst, bodyA, bodyB);
}

// SphereとBoxの最近接点から、GPUの外部接触・内部接触を分けたcontactを作ります
// 外部ではSphere表面点とBox最近接点の中点、内部では最短退出面上の点を使います
export function buildSphereBoxContact(
  sphereCollider,
  spherePosition,
  boxCollider,
  boxPosition,
  bodyA,
  bodyB,
  _sphereQuat = null,
  boxQuat = null
) {
  const sphere = sphereCollider.getWorldInfo(spherePosition);
  const box = boxCollider.getWorldInfo(boxPosition, boxQuat);
  const centerDelta = subtract(sphere.center, box.center);
  const closestPoint = [...box.center];
  for (let axis = 0; axis < 3; axis++) {
    const distanceOnAxis = dot(centerDelta, box.axes[axis]);
    const clamped = Math.max(-box.half[axis], Math.min(box.half[axis], distanceOnAxis));
    closestPoint[0] += box.axes[axis][0] * clamped;
    closestPoint[1] += box.axes[axis][1] * clamped;
    closestPoint[2] += box.axes[axis][2] * clamped;
  }

  const delta = subtract(closestPoint, sphere.center);
  const distance = length(delta);
  if (distance > 1.0e-8) {
    const penetration = sphere.radius - distance;
    if (penetration <= 0.0) return null;
    const normal = scale(delta, 1.0 / distance);
    const sphereSurfacePoint = add(sphere.center, scale(normal, sphere.radius));
    return createContact(
      bodyA,
      bodyB,
      normal,
      penetration,
      scale(add(sphereSurfacePoint, closestPoint), 0.5)
    );
  }

  // Box内部では、Sphere中心から最短のBox面へ向かう退出方向を明示的に選びます
  const localCenter = box.axes.map((axis) => dot(centerDelta, axis));
  const distancesToFaces = box.half.map((halfExtent, axis) => halfExtent - Math.abs(localCenter[axis]));
  let nearestAxis = 0;
  if (distancesToFaces[1] < distancesToFaces[nearestAxis]) nearestAxis = 1;
  if (distancesToFaces[2] < distancesToFaces[nearestAxis]) nearestAxis = 2;
  const exitSign = localCenter[nearestAxis] >= 0.0 ? 1.0 : -1.0;
  const exitNormal = scale(box.axes[nearestAxis], exitSign);
  return createContact(
    bodyA,
    bodyB,
    scale(exitNormal, -1.0),
    sphere.radius + Math.max(0.0, distancesToFaces[nearestAxis]),
    add(sphere.center, scale(exitNormal, distancesToFaces[nearestAxis]))
  );
}

// BoxとSphereの逆順をSphere-Box式で計算し、GPUのsphereB分岐と同じ法線へ戻します
// Box entryをbody Aとして保持するため、body参照はこの関数で明示的に再構成します
export function buildBoxSphereContact(
  boxCollider,
  boxPosition,
  sphereCollider,
  spherePosition,
  bodyA,
  bodyB,
  boxQuat = null,
  sphereQuat = null
) {
  const sphereFirst = buildSphereBoxContact(
    sphereCollider,
    spherePosition,
    boxCollider,
    boxPosition,
    bodyB,
    bodyA,
    sphereQuat,
    boxQuat
  );
  return reverseContact(sphereFirst, bodyA, bodyB);
}

// CapsuleとCapsuleの二線分最近接点から、二つの半径を別々に使うcontactを作ります
// CPU版の半径和だけの接触点式を使わず、GPUと同じ二表面点中点を返します
export function buildCapsuleCapsuleContact(
  capsuleColliderA,
  positionA,
  capsuleColliderB,
  positionB,
  bodyA,
  bodyB,
  quatA = null,
  quatB = null
) {
  const capsuleA = capsuleColliderA.getWorldInfo(positionA, quatA);
  const capsuleB = capsuleColliderB.getWorldInfo(positionB, quatB);
  const closest = capsuleColliderA.cpuCollider._closestSegmentSegmentPoints(
    capsuleA.pointA,
    capsuleA.pointB,
    capsuleB.pointA,
    capsuleB.pointB
  );
  const delta = subtract(closest.pointB, closest.pointA);
  const distance = length(delta);
  const penetration = capsuleA.radius + capsuleB.radius - distance;
  if (penetration <= 0.0) return null;
  const normal = normalFromDelta(delta, distance);
  const surfacePointA = add(closest.pointA, scale(normal, capsuleA.radius));
  const surfacePointB = subtract(closest.pointB, scale(normal, capsuleB.radius));
  return createContact(
    bodyA,
    bodyB,
    normal,
    penetration,
    scale(add(surfacePointA, surfacePointB), 0.5)
  );
}

// CapsuleとBoxのGPU式をCPU readbackへ明示接続し、外部と内部の接触点を分けます
// 外部では二表面点中点、内部ではBox最近接点を使い、CapsuleからBoxへ向く法線を返します
export function buildCapsuleBoxContact(
  capsuleCollider,
  capsulePosition,
  boxCollider,
  boxPosition,
  bodyA,
  bodyB,
  capsuleQuat = null,
  boxQuat = null
) {
  const capsule = capsuleCollider.getWorldInfo(capsulePosition, capsuleQuat);
  const box = boxCollider.getWorldInfo(boxPosition, boxQuat);
  const closest = capsuleCollider.cpuCollider._closestSegmentObbPoints(
    capsule.pointA,
    capsule.pointB,
    box,
    boxQuat
  );
  const delta = subtract(closest.otherPoint, closest.segmentPoint);
  const distance = length(delta);
  if (distance > 1.0e-8) {
    const penetration = capsule.radius - distance;
    if (penetration <= 0.0) return null;
    const normal = scale(delta, 1.0 / distance);
    const capsuleSurfacePoint = add(closest.segmentPoint, scale(normal, capsule.radius));
    return createContact(
      bodyA,
      bodyB,
      normal,
      penetration,
      scale(add(capsuleSurfacePoint, closest.otherPoint), 0.5)
    );
  }

  // 芯線がBox内部へ入った場合は、芯線点から最短面へ向かうBox外向き方向を選びます
  const localSegmentPoint = subtract(closest.segmentPoint, box.center);
  const localCoordinates = box.axes.map((axis) => dot(localSegmentPoint, axis));
  const distancesToFaces = box.half.map((halfExtent, axis) => halfExtent - Math.abs(localCoordinates[axis]));
  let nearestAxis = 0;
  if (distancesToFaces[1] < distancesToFaces[nearestAxis]) nearestAxis = 1;
  if (distancesToFaces[2] < distancesToFaces[nearestAxis]) nearestAxis = 2;
  const normalSign = localCoordinates[nearestAxis] >= 0.0 ? -1.0 : 1.0;
  const normal = scale(box.axes[nearestAxis], normalSign);
  return createContact(
    bodyA,
    bodyB,
    normal,
    capsule.radius + Math.max(0.0, distancesToFaces[nearestAxis]),
    [...closest.otherPoint]
  );
}

// BoxとCapsuleの逆順をCapsule-Box式で計算し、GPUのcapsuleB分岐と同じ法線へ戻します
// Box entryをbody Aとして保持し、接触点とpenetrationは同じ形状接触から引き継ぎます
export function buildBoxCapsuleContact(
  boxCollider,
  boxPosition,
  capsuleCollider,
  capsulePosition,
  bodyA,
  bodyB,
  boxQuat = null,
  capsuleQuat = null
) {
  const capsuleFirst = buildCapsuleBoxContact(
    capsuleCollider,
    capsulePosition,
    boxCollider,
    boxPosition,
    bodyB,
    bodyA,
    capsuleQuat,
    boxQuat
  );
  return reverseContact(capsuleFirst, bodyA, bodyB);
}
