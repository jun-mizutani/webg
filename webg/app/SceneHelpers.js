// ---------------------------------------------
//  SceneHelpers.js  2026/09/08
//   Shared validation and transform helpers for high-level WebgSceneApp modules
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import BoxCollider from "../BoxCollider.js";
import CapsuleCollider from "../CapsuleCollider.js";
import ComputeBoxCollider from "../ComputeBoxCollider.js";
import ComputeCapsuleCollider from "../ComputeCapsuleCollider.js";
import ComputeSphereCollider from "../ComputeSphereCollider.js";
import PlaneCollider from "../PlaneCollider.js";
import SphereCollider from "../SphereCollider.js";
import util from "../util.js";
import Matrix from "../Matrix.js";
import Quat from "../Quat.js";
import { GEOMETRY_TYPES, TRANSFORM_SPACES } from "./AuthoringVocabulary.js";

// world行列の3軸が正規直交基底になっていることを確認します
// 単位uniform scale・回転・平行移動から成る剛体姿勢をphysicsへ渡します
function assertRigidUnitMatrix(matrix, label) {
  if (!matrix || !Array.isArray(matrix.mat) || matrix.mat.length < 16) {
    throw new Error(`${label} requires a 4x4 matrix`);
  }
  const scale = matrix.getUniformScale?.();
  if (scale === null || scale === undefined || Math.abs(scale - 1.0) > 1.0e-5) {
    throw new Error(`${label} requires unit uniform scale`);
  }
  const m = matrix.mat;
  const values = [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error(`${label} requires finite matrix values`);
  }
  const x = [m[0], m[1], m[2]];
  const y = [m[4], m[5], m[6]];
  const z = [m[8], m[9], m[10]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const determinant = x[0] * (y[1] * z[2] - y[2] * z[1])
    - y[0] * (x[1] * z[2] - x[2] * z[1])
    + z[0] * (x[1] * y[2] - x[2] * y[1]);
  if (Math.abs(dot(x, y)) > 1.0e-5
    || Math.abs(dot(y, z)) > 1.0e-5
    || Math.abs(dot(z, x)) > 1.0e-5
    || Math.abs(determinant - 1.0) > 1.0e-5) {
    throw new Error(`${label} requires a rigid rotation matrix without shear or reflection`);
  }
  return matrix;
}

// Nodeと全ancestorのworld行列を検査し、階層全体の座標基準をそろえます
// 親の相殺されたscaleや上位Nodeのshearも、physics登録前に同じ理由で知らせます
function assertRigidUnitHierarchy(node, label) {
  const world = assertRigidUnitMatrix(node.getWorldMatrix(), label);
  let parent = node.getParent?.() ?? null;
  while (parent) {
    assertRigidUnitMatrix(parent.getWorldMatrix(), `${label} parent`);
    parent = parent.getParent?.() ?? null;
  }
  return world;
}

// optionsをplain objectとして検証し、未指定時だけ空objectを返します
// 明示された値の型を保ったまま検証し、呼出側の記述ミスを即座に通知します
export function readOptions(value, name) {
  return util.readPlainObject(value, name, {});
}

// Nodeが持つ初期姿勢をCPU/Compute descriptorで共通利用できる配列へ変換します
// Quaternionはwebgの[ w, x, y, z ]順の配列を直接返します
export function readNodePose(node, label) {
  if (!node || typeof node.getPosition !== "function" || typeof node.getQuat !== "function") {
    throw new Error(`${label} requires a Node with getPosition()/getQuat()`);
  }
  const position = node.getPosition();
  if (!Array.isArray(position) || position.length !== 3) {
    throw new Error(`${label} position must be a vec3`);
  }
  const checkedPosition = position.map((value, index) => util.readFiniteNumber(
    value,
    `${label} position[${index}]`
  ));
  const quatValue = node.getQuat();
  if (!quatValue || !Array.isArray(quatValue.q) || quatValue.q.length < 4) {
    throw new Error(`${label} quaternion must provide q[ w, x, y, z ]`);
  }
  const orientation = quatValue.q.slice(0, 4).map((value, index) => util.readFiniteNumber(
    value,
    `${label} orientation[${index}]`
  ));
  return { position: checkedPosition, orientation };
}

// Nodeのワールド行列から剛体として使えるworld姿勢を読み取ります
// 親Nodeの移動と回転を反映し、物理bodyへ渡す座標基準を明示します
export function readNodeWorldPose(node, label) {
  if (!node || typeof node.getWorldMatrix !== "function") {
    throw new Error(`${label} requires getWorldMatrix()`);
  }
  const world = assertRigidUnitHierarchy(node, `${label} world pose`);
  const scale = world.getUniformScale();
  const rigid = world.removeUniformScale(scale);
  const quat = new Quat();
  quat.matrixToQuat(rigid);
  return {
    position: world.getPosition().map((value, index) => util.readFiniteNumber(
      value,
      `${label} world position[${index}]`
    )),
    orientation: quat.q.slice(0, 4).map((value, index) => util.readFiniteNumber(
      value,
      `${label} world orientation[${index}]`
    ))
  };
}

// local/worldの選択を登録時と同期時で共有します
// world指定は親階層を持つNodeの物理接続に使います
export function readNodePoseInSpace(node, space, label) {
  if (!TRANSFORM_SPACES.includes(space)) {
    throw new Error(`${label} transformSpace must be local or world`);
  }
  return space === "world" ? readNodeWorldPose(node, label) : readNodePose(node, label);
}

// 既に解決した初期姿勢をCompute/CPU descriptorへ渡せる有限配列へ検証します
// ModelAssetの親階層ではworld姿勢を明示的に渡すため、Node再読込みと区別します
export function readExplicitPose(value, label) {
  const pose = util.readPlainObject(value, `${label} pose`);
  if (!Array.isArray(pose.position) || pose.position.length !== 3) {
    throw new Error(`${label} pose.position must be a vec3`);
  }
  if (!Array.isArray(pose.orientation) || pose.orientation.length !== 4) {
    throw new Error(`${label} pose.orientation must be a quaternion`);
  }
  return {
    position: pose.position.map((entry, index) => util.readFiniteNumber(
      entry,
      `${label} pose.position[${index}]`
    )),
    orientation: pose.orientation.map((entry, index) => util.readFiniteNumber(
      entry,
      `${label} pose.orientation[${index}]`
    ))
  };
}

// world物理姿勢を親Nodeに対するlocal姿勢へ戻して書き込みます
// 親は単位uniform scaleの剛体変換として扱い、対応範囲外の変形は理由付き診断へ返します
export function writeNodePoseInSpace(node, state, space, label) {
  if (!TRANSFORM_SPACES.includes(space)) {
    throw new Error(`${label} transformSpace must be local or world`);
  }
  if (space === "local") {
    writeNodePose(node, state, label);
    return;
  }
  if (!node || typeof node.setByMatrix !== "function") {
    throw new Error(`${label} world pose requires setByMatrix()`);
  }
  const world = new Matrix();
  const orientationSource = state?.orientation instanceof Quat
    ? state.orientation.q
    : Array.isArray(state?.orientation)
      ? state.orientation
      : state?.orientation?.q;
  if (!Array.isArray(orientationSource) || orientationSource.length < 4) {
    throw new Error(`${label} world pose orientation must be a quaternion`);
  }
  const orientation = new Quat();
  orientation.q = orientationSource.slice(0, 4).map((value, index) => util.readFiniteNumber(
    value,
    `${label} world orientation[${index}]`
  ));
  world.setByQuat(orientation);
  world.position(state.position);
  const parent = node.getParent?.() ?? null;
  if (parent) {
    if (typeof parent.getWorldMatrix !== "function") {
      throw new Error(`${label} parent requires getWorldMatrix()`);
    }
    const parentWorld = assertRigidUnitHierarchy(parent, `${label} world pose parent`);
    if (typeof parentWorld.inverse_strict !== "function" || !parentWorld.inverse_strict()) {
      throw new Error(`${label} parent world matrix must be invertible`);
    }
    world.lmul(parentWorld);
  }
  node.setByMatrix(world);
}

// body optionから形状定義を取り出し、指定されたshape typeをそのまま使用します
// CPUとComputeの各backendはこの定義をそれぞれのcollider classへ変換します
export function readShapeOptions(value, label) {
  const shape = util.readPlainObject(value, `${label} shape`);
  const type = util.readOptionalEnum(
    shape.type,
    `${label} shape.type`,
    undefined,
    [...GEOMETRY_TYPES, "plane"]
  );
  if (type === undefined) {
    throw new Error(`${label} shape.type is required`);
  }
  return { ...shape, type };
}

// shape定義をCPU colliderへ変換し、寸法の検証を既存core classへ集約します
// 形状の不足値は対応するconstructorで検証し、発生した例外をそのまま返します
export function createCpuCollider(shapeValue, label) {
  const shape = readShapeOptions(shapeValue, label);
  const colliderOptions = shape.offset === undefined ? {} : { offset: shape.offset };
  switch (shape.type) {
  case "box":
    return new BoxCollider(shape.size, colliderOptions);
  case "sphere":
    return new SphereCollider(shape.radius, colliderOptions);
  case "capsule":
    return new CapsuleCollider(shape.radius, shape.segmentLength, colliderOptions);
  case "plane":
    return new PlaneCollider(shape.normal, colliderOptions);
  default:
    throw new Error(`${label} unsupported CPU shape type: ${shape.type}`);
  }
}

// shape定義をCompute colliderへ変換し、GPU BodyStateが扱える形状だけを明示的に受け付けます
// PlaneはComputePhysicsSpaceのconstructorへ渡す専用配列で管理し、body colliderは対応する立体形状で作成します
export function createComputeCollider(shapeValue, label) {
  const shape = readShapeOptions(shapeValue, label);
  const colliderOptions = shape.offset === undefined ? {} : { offset: shape.offset };
  switch (shape.type) {
  case "box":
    return new ComputeBoxCollider(shape.size, colliderOptions);
  case "sphere":
    return new ComputeSphereCollider(shape.radius, colliderOptions);
  case "capsule":
    return new ComputeCapsuleCollider(shape.radius, shape.segmentLength, colliderOptions);
  case "plane":
    throw new Error(`${label} Compute body shape cannot be plane; configure planes at backend creation`);
  default:
    throw new Error(`${label} unsupported Compute shape type: ${shape.type}`);
  }
}

// body登録時にNodeから受け取る共通物理値を読み、CPU/Compute descriptorの入力へ複製します
// 数値を丸めず、明示された不正値をその場で検出できるようにします
export function readBodyOptions(value, label) {
  const options = readOptions(value, `${label} options`);
  const bodyType = util.readOptionalEnum(
    options.bodyType,
    `${label} bodyType`,
    "dynamic",
    ["static", "kinematic", "dynamic"]
  );
  const mass = util.readOptionalFiniteNumber(options.mass, `${label} mass`, 1.0, { min: 0.0 });
  if (bodyType === "dynamic" && mass <= 0.0) {
    throw new Error(`${label} mass must be positive for a dynamic body`);
  }
  const material = readOptions(options.material, `${label} material`);
  return {
    bodyType,
    mass,
    gravityScale: util.readOptionalFiniteNumber(options.gravityScale, `${label} gravityScale`, 1.0),
    linearDamping: util.readOptionalFiniteNumber(options.linearDamping, `${label} linearDamping`, 0.0, { min: 0.0 }),
    angularDamping: util.readOptionalFiniteNumber(options.angularDamping, `${label} angularDamping`, 0.0, { min: 0.0 }),
    allowSleep: util.readOptionalBoolean(options.allowSleep, `${label} allowSleep`, true),
    isSleeping: util.readOptionalBoolean(options.isSleeping, `${label} isSleeping`, false),
    isTrigger: util.readOptionalBoolean(options.isTrigger, `${label} isTrigger`, false),
    fixedRotation: util.readOptionalBoolean(options.fixedRotation, `${label} fixedRotation`, false),
    collisionLayer: options.collisionLayer,
    collisionMask: options.collisionMask,
    linearVelocity: options.linearVelocity,
    angularVelocity: options.angularVelocity,
    material,
    shape: readShapeOptions(options.shape, label)
  };
}

// Nodeへ物理姿勢を反映し、PhysicsNodeと通常Nodeの両方を同じbindingから扱います
// PhysicsNodeが持つ専用同期APIを優先し、通常Nodeでは位置とQuatだけを明示的に書き込みます
export function writeNodePose(node, state, label) {
  if (!node || typeof node !== "object") {
    throw new Error(`${label} node must be an object`);
  }
  if (!state || !Array.isArray(state.position) || state.position.length !== 3) {
    throw new Error(`${label} state.position must be a vec3`);
  }
  if (!state.orientation || !Array.isArray(state.orientation.q)) {
    throw new Error(`${label} state.orientation must be a Quat`);
  }
  if (typeof node.syncNodeFromPhysics === "function") {
    node.syncNodeFromPhysics(state.position, { quat: state.orientation });
    return;
  }
  if (typeof node.setPosition !== "function" || typeof node.setQuat !== "function") {
    throw new Error(`${label} node requires syncNodeFromPhysics() or setPosition()/setQuat()`);
  }
  node.setPosition(...state.position);
  node.setQuat(state.orientation);
}
