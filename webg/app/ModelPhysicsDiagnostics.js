// ---------------------------------------------
//  ModelPhysicsDiagnostics.js  2026/09/08
//   Spatial diagnostics for ModelAsset physics bindings
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import util from "../util.js";

// Nodeのworld行列でlocal pointを変換し、表示Node上の接続点を読み取ります
// ModelAssetの親階層を含む姿勢を一つのworld座標へまとめ、colliderとJointの照合に使います
export function readNodeWorldPoint(node, localPoint, label = "ModelAsset world point") {
  if (!node || typeof node.getWorldMatrix !== "function") {
    throw new Error(`${label} requires a Node with getWorldMatrix()`);
  }
  if (!Array.isArray(localPoint) || localPoint.length !== 3) {
    throw new Error(`${label} localPoint must be a vec3`);
  }
  const point = localPoint.map((value, index) => util.readFiniteNumber(
    value,
    `${label} localPoint[${index}]`
  ));
  const matrix = node.getWorldMatrix();
  if (!Array.isArray(matrix?.mat) || matrix.mat.length < 16) {
    throw new Error(`${label} requires a 4x4 world matrix`);
  }
  const m = matrix.mat;
  return [
    m[0] * point[0] + m[4] * point[1] + m[8] * point[2] + m[12],
    m[1] * point[0] + m[5] * point[1] + m[9] * point[2] + m[13],
    m[2] * point[0] + m[6] * point[1] + m[10] * point[2] + m[14]
  ].map((value, index) => util.readFiniteNumber(value, `${label} worldPoint[${index}]`));
}

// quaternionでbody local pointを回転し、readback positionへ加えてworld anchorを作ります
// Jointの目標距離と実測距離を同じsnapshotから計算し、Node表示との比較値をそろえます
function readBodyWorldPoint(state, localPoint, label) {
  if (!state || !Array.isArray(state.position) || state.position.length !== 3) {
    throw new Error(`${label} requires a body position`);
  }
  if (!Array.isArray(state.orientation) || state.orientation.length < 4) {
    throw new Error(`${label} requires a body orientation`);
  }
  const [w, x, y, z] = state.orientation.map((value, index) => util.readFiniteNumber(
    value,
    `${label} orientation[${index}]`
  ));
  const [px, py, pz] = localPoint;
  const tx = 2.0 * (y * pz - z * py);
  const ty = 2.0 * (z * px - x * pz);
  const tz = 2.0 * (x * py - y * px);
  const rotated = [
    px + w * tx + (y * tz - z * ty),
    py + w * ty + (z * tx - x * tz),
    pz + w * tz + (x * ty - y * tx)
  ];
  return state.position.map((value, index) => util.readFiniteNumber(
    value + rotated[index],
    `${label} worldPoint[${index}]`
  ));
}

// 二つのworld pointの距離を計算します
// DistanceJointの目標距離とsnapshot上の接続点距離を同じ単位で比較します
export function distanceBetweenPoints(a, b, label = "point distance") {
  if (!Array.isArray(a) || a.length !== 3 || !Array.isArray(b) || b.length !== 3) {
    throw new Error(`${label} requires two vec3 values`);
  }
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

// JointBindingsのentryとCompute readbackからJointの接続点をsnapshot化します
// body ID、Node ID、local anchor、world anchor、目標距離を一つの検証結果として返します
export function readJointStateSnapshot(jointResult, bodyBindings, physics, stateData, label = "SceneFrame") {
  if (!jointResult || !Array.isArray(jointResult.entries)) {
    throw new Error(`${label} joint result is unavailable`);
  }
  if (!Array.isArray(bodyBindings)) throw new Error(`${label} bodyBindings must be an array`);
  if (!physics || typeof physics.readBodyStateFromReadback !== "function") {
    throw new Error(`${label} physics readback reader is unavailable`);
  }
  const bindings = new Map(bodyBindings.map((entry) => [entry.bodyId, entry]));
  return Object.freeze(jointResult.entries.map((entry, index) => {
    const path = `${label} joint snapshot[${index}]`;
    const bindingA = bindings.get(entry.a.bodyId);
    const bindingB = bindings.get(entry.b.bodyId);
    if (!bindingA || !bindingB) throw new Error(`${path} body binding is unavailable`);
    const stateA = physics.readBodyStateFromReadback(entry.a.bodyId, stateData);
    const stateB = physics.readBodyStateFromReadback(entry.b.bodyId, stateData);
    const anchorA = readBodyWorldPoint(stateA, entry.a.localPoint, `${path}.a`);
    const anchorB = readBodyWorldPoint(stateB, entry.b.localPoint, `${path}.b`);
    const observedDistance = distanceBetweenPoints(anchorA, anchorB, `${path}.distance`);
    return Object.freeze({
      id: entry.id,
      targetDistance: entry.lengthMeters,
      observedDistance,
      error: observedDistance - entry.lengthMeters,
      a: Object.freeze({
        bodyId: entry.a.bodyId,
        body: entry.a.body,
        nodeId: bindingA.nodeId,
        localPoint: Object.freeze([...entry.a.localPoint]),
        worldPoint: Object.freeze(anchorA)
      }),
      b: Object.freeze({
        bodyId: entry.b.bodyId,
        body: entry.b.body,
        nodeId: bindingB.nodeId,
        localPoint: Object.freeze([...entry.b.localPoint]),
        worldPoint: Object.freeze(anchorB)
      })
    });
  }));
}

// Joint接続点の初期world距離からfixtureの目標距離を確定します
// ModelAssetの実際のNode配置を基準にし、説明用の推測値を物理manifestへ持ち込みません
export function readInitialJointLength(nodeA, pointA, nodeB, pointB, label = "ModelAsset initial Joint") {
  const worldA = readNodeWorldPoint(nodeA, pointA, `${label}.a`);
  const worldB = readNodeWorldPoint(nodeB, pointB, `${label}.b`);
  return distanceBetweenPoints(worldA, worldB, `${label}.length`);
}
