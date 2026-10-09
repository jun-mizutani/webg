// ---------------------------------------------
//  ModelSpatialCorrespondence.js  2026/09/08
//   ModelAsset Node, local geometry, and physics collider correspondence
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import Quat from "../Quat.js";
import util from "../util.js";
import { readNodePose } from "./SceneHelpers.js";

// meshのlocal頂点から中心、範囲、寸法を読み、表示形状の基準情報へまとめます
// Nodeの姿勢とは分離したlocal座標として保持し、collider照合の共通入力にします
export function readLocalGeometry(mesh, label = "ModelAsset mesh") {
  const geometry = util.readPlainObject(mesh?.geometry, `${label}.geometry`);
  const positions = geometry.positions;
  if (!Array.isArray(positions) || positions.length < 9 || positions.length % 3 !== 0) {
    throw new Error(`${label}.geometry.positions must contain at least three local vertices`);
  }
  const vertexCount = util.readFiniteNumber(
    geometry.vertexCount ?? positions.length / 3,
    `${label}.geometry.vertexCount`,
    { integer: true, min: 3 }
  );
  if (positions.length !== vertexCount * 3) {
    throw new Error(`${label}.geometry.positions must contain ${vertexCount * 3} values`);
  }
  const polygonCount = util.readFiniteNumber(
    geometry.polygonCount ?? 0,
    `${label}.geometry.polygonCount`,
    { integer: true, min: 0 }
  );
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = util.readFiniteNumber(
        positions[index + axis],
        `${label}.geometry.positions[${index + axis}]`
      );
      min[axis] = Math.min(min[axis], value);
      max[axis] = Math.max(max[axis], value);
    }
  }
  const center = min.map((value, axis) => (value + max[axis]) * 0.5);
  const size = max.map((value, axis) => value - min[axis]);
  size.forEach((value, axis) => util.readFiniteNumber(
    value,
    `${label}.geometry.size[${axis}]`,
    { minExclusive: 0.0 }
  ));
  let radius = 0.0;
  for (let index = 0; index < positions.length; index += 3) {
    const dx = positions[index] - center[0];
    const dy = positions[index + 1] - center[1];
    const dz = positions[index + 2] - center[2];
    radius = Math.max(radius, Math.hypot(dx, dy, dz));
  }
  return Object.freeze({
    vertexCount,
    polygonCount,
    min: Object.freeze([...min]),
    max: Object.freeze([...max]),
    center: Object.freeze([...center]),
    size: Object.freeze([...size]),
    boundingRadius: radius
  });
}

// Nodeのlocal姿勢と親階層を反映したworld姿勢を同じ情報へまとめます
// PhysicsBindingが読むlocal poseと、画面で観測するworld poseを区別して返します
export function readNodeSpatialPose(node, label = "ModelAsset Node") {
  const local = readNodePose(node, `${label} local pose`);
  if (typeof node.getWorldMatrix !== "function") {
    throw new Error(`${label} requires getWorldMatrix()`);
  }
  const worldMatrix = node.getWorldMatrix();
  const worldPosition = worldMatrix.getPosition();
  const checkedWorldPosition = worldPosition.map((value, index) => util.readFiniteNumber(
    value,
    `${label} world position[${index}]`
  ));
  let worldOrientation = null;
  const uniformScale = worldMatrix.getUniformScale?.();
  if (uniformScale !== null && uniformScale !== undefined) {
    const rigid = worldMatrix.removeUniformScale(uniformScale);
    const quat = new Quat();
    quat.matrixToQuat(rigid);
    worldOrientation = quat.q.slice(0, 4).map((value, index) => util.readFiniteNumber(
      value,
      `${label} world orientation[${index}]`
    ));
  }
  return Object.freeze({
    local: Object.freeze({
      position: Object.freeze([...local.position]),
      orientation: Object.freeze([...local.orientation])
    }),
    world: Object.freeze({
      position: Object.freeze(checkedWorldPosition),
      orientation: worldOrientation ? Object.freeze(worldOrientation) : null
    })
  });
}

// physics manifestのcolliderを検証済みの比較情報へ変換します
// shapeの寸法とoffsetをNode local geometryと同じ座標系へそろえます
export function readColliderDefinition(shapeValue, label = "physics collider") {
  const shape = util.readPlainObject(shapeValue, `${label} shape`);
  const type = util.readOptionalEnum(
    shape.type,
    `${label}.type`,
    undefined,
    ["box", "sphere", "capsule"]
  );
  const offset = shape.offset === undefined
    ? [0.0, 0.0, 0.0]
    : shape.offset;
  if (!Array.isArray(offset) || offset.length < 3) {
    throw new Error(`${label}.offset must be a vec3 array`);
  }
  const checkedOffset = offset.slice(0, 3).map((value, index) => util.readFiniteNumber(
    value,
    `${label}.offset[${index}]`
  ));
  if (type === "box") {
    if (!Array.isArray(shape.size) || shape.size.length < 3) {
      throw new Error(`${label}.size must be a vec3 array`);
    }
    const size = shape.size.slice(0, 3).map((value, index) => util.readFiniteNumber(
      value,
      `${label}.size[${index}]`,
      { minExclusive: 0.0 }
    ));
    return Object.freeze({ type, size: Object.freeze(size), offset: Object.freeze(checkedOffset) });
  }
  if (type === "sphere") {
    const radius = util.readFiniteNumber(shape.radius, `${label}.radius`, { minExclusive: 0.0 });
    return Object.freeze({ type, radius, offset: Object.freeze(checkedOffset) });
  }
  const radius = util.readFiniteNumber(shape.radius, `${label}.radius`, { minExclusive: 0.0 });
  const segmentLength = util.readFiniteNumber(
    shape.segmentLength,
    `${label}.segmentLength`,
    { min: 0.0 }
  );
  return Object.freeze({
    type,
    radius,
    segmentLength,
    offset: Object.freeze(checkedOffset)
  });
}

// local geometryとcolliderの形状、寸法、中心を比較し、空間対応の結果を返します
// mismatchは起動時に理由を読める形で返し、許容値はasset寸法に比例した一定基準で計算します
export function compareGeometryToCollider(localGeometry, collider, label = "ModelAsset collider") {
  const scale = Math.max(...localGeometry.size, collider.radius ?? 0.0, 1.0);
  const tolerance = Math.max(1.0e-4, scale * 0.005);
  const centerDelta = localGeometry.center.map((value, axis) => value - collider.offset[axis]);
  const centerMatch = centerDelta.every((value) => Math.abs(value) <= tolerance);
  let sizeDelta = null;
  let shapeMatch = false;
  let reason = "形状種別の照合結果が不一致";
  if (collider.type === "box") {
    sizeDelta = localGeometry.size.map((value, axis) => value - collider.size[axis]);
    shapeMatch = sizeDelta.every((value) => Math.abs(value) <= tolerance);
    reason = shapeMatch ? "boxのlocal寸法が一致" : "boxのlocal寸法の照合結果が不一致";
  } else if (collider.type === "sphere") {
    const geometryRadius = Math.max(...localGeometry.size) * 0.5;
    sizeDelta = [geometryRadius - collider.radius];
    shapeMatch = localGeometry.size.every((value) => Math.abs(value - collider.radius * 2.0) <= tolerance)
      && Math.abs(localGeometry.boundingRadius - collider.radius) <= tolerance;
    reason = shapeMatch ? "sphereのlocal半径が一致" : "sphereのlocal半径の照合結果が不一致";
  } else if (collider.type === "capsule") {
    const expectedSize = [collider.radius * 2.0, collider.segmentLength + collider.radius * 2.0, collider.radius * 2.0];
    sizeDelta = localGeometry.size.map((value, axis) => value - expectedSize[axis]);
    shapeMatch = sizeDelta.every((value) => Math.abs(value) <= tolerance);
    reason = shapeMatch ? "capsuleのlocal Y寸法が一致" : "capsuleのlocal寸法の照合結果が不一致";
  }
  const matched = centerMatch && shapeMatch;
  return Object.freeze({
    matched,
    tolerance,
    centerMatch,
    centerDelta: Object.freeze(centerDelta),
    shapeMatch,
    sizeDelta: sizeDelta ? Object.freeze(sizeDelta) : null,
    reason: matched ? "Node原点、local geometry、colliderが対応" : `${label}: ${reason}`
  });
}

// ModelAsset entryへNode姿勢、local geometry、collider対応を一つの説明情報として付加します
// 登録時の検証結果と作品側の診断表示が同じ値を参照できるようにします
export function createModelSpatialCorrespondence(entry, shapeValue, label = "ModelAsset entry") {
  if (!entry?.node || !entry?.mesh) {
    throw new Error(`${label} requires a Node and mesh`);
  }
  const localGeometry = readLocalGeometry(entry.mesh, `${label} mesh`);
  const nodePose = readNodeSpatialPose(entry.node, `${label} Node`);
  const collider = readColliderDefinition(shapeValue, `${label} collider`);
  const comparison = compareGeometryToCollider(localGeometry, collider, label);
  return Object.freeze({
    nodeId: entry.id,
    nodeName: entry.name,
    nodePose,
    localGeometry,
    collider,
    comparison
  });
}
