// ---------------------------------------------
//  PhysicsDescriptor.js  2026/08/27
//   Common CPU/Compute physics descriptor for the isolated physics study area
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import util from "./util.js";

// 共通descriptorで扱うbody種別を固定し、backendへ同じ文字列を渡します
export const COMMON_PHYSICS_BODY_TYPES = Object.freeze([
  "static",
  "kinematic",
  "dynamic"
]);

// kinematic bodyの移動方式を固定し、衝突エネルギーの扱いをdescriptorへ明示します
export const COMMON_PHYSICS_MOTION_MODES = Object.freeze([
  "none",
  "quasiStatic",
  "impact"
]);

// 共通descriptorで扱う剛体形状を固定し、shape typeを明示値として使います
export const COMMON_PHYSICS_SHAPE_TYPES = Object.freeze([
  "box",
  "sphere",
  "capsule"
]);

// CPU版PhysicsNodeが角速度をdegree/secで保持するため、共通値からの変換係数を公開します
export const RAD_TO_DEG = 180.0 / Math.PI;
export const DEG_TO_RAD = Math.PI / 180.0;

// 必須vec3を検証して複製し、3要素がそろった値だけを保持します
function readRequiredVec3(value, name, constraints = {}) {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new Error(`${name} must be a 3 element array`);
  }
  return Object.freeze(value.map((entry, index) => util.readFiniteNumber(
    entry,
    `${name}[${index}]`,
    constraints
  )));
}

// 共通moduleが速度や位置のvec3を同じ検証へ接続できるよう、内部validatorを公開します
export { readRequiredVec3 as normalizeVec3 };

// 任意vec3を検証し、未指定時だけ明示した共通既定値を複製します
function readOptionalVec3(value, name, fallback, constraints = {}) {
  return readRequiredVec3(
    value === undefined ? fallback : value,
    name,
    constraints
  );
}

// 共通quaternionを[w,x,y,z]順で検証・正規化し、単位quaternionを保持します
function readOrientation(value, name) {
  if (!Array.isArray(value) || value.length !== 4) {
    throw new Error(`${name} must be a 4 element array`);
  }
  const checked = value.map((entry, index) => util.readFiniteNumber(
    entry,
    `${name}[${index}]`
  ));
  const length = Math.hypot(...checked);
  if (length <= 0.0) {
    throw new Error(`${name} must not be a zero quaternion`);
  }
  return Object.freeze(checked.map((entry) => entry / length));
}

// 任意quaternionを共通のidentity既定値とともに検証します
function readOptionalOrientation(value, name) {
  return readOrientation(
    value === undefined ? [1.0, 0.0, 0.0, 0.0] : value,
    name
  );
}

// body shape以外の共通オブジェクトへ暗黙の型変換を行わず検証します
function readRequiredObject(value, name) {
  return util.readPlainObject(value, name);
}

// shape offsetを検証し、CPU版で利用可能な位置ずれを共通descriptorへ保持します
// Compute版へ変換するときはoffsetが0であることを別途確認し、対応する値を引き継ぎます
function readShapeOffset(value, name) {
  return readOptionalVec3(value, name, [0.0, 0.0, 0.0]);
}

// 種別を必須文字列として検証し、登録済みshapeだけを受け付けます
function readRequiredEnum(value, name, allowed) {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error(`${name} must be one of: ${allowed.join(", ")}`);
  }
  return value;
}

// Box、Sphere、Capsuleの共通寸法定義を正規化します
// CapsuleはCPU版とCompute版の両方でlocal Y軸を使うため、axisを必ずyへ固定します
export function normalizeShape(value, name = "shape") {
  const shape = readRequiredObject(value, name);
  const type = readRequiredEnum(shape.type, `${name}.type`, COMMON_PHYSICS_SHAPE_TYPES);
  if (type === "box") {
    return Object.freeze({
      type,
      size: readRequiredVec3(shape.size, `${name}.size`, { minExclusive: 0.0 }),
      offset: readShapeOffset(shape.offset, `${name}.offset`)
    });
  }
  if (type === "sphere") {
    return Object.freeze({
      type,
      radius: util.readFiniteNumber(shape.radius, `${name}.radius`, { minExclusive: 0.0 }),
      offset: readShapeOffset(shape.offset, `${name}.offset`)
    });
  }
  const axis = shape.axis === undefined
    ? "y"
    : readRequiredEnum(shape.axis, `${name}.axis`, ["y"]);
  return Object.freeze({
    type,
    radius: util.readFiniteNumber(shape.radius, `${name}.radius`, { minExclusive: 0.0 }),
    segmentLength: util.readFiniteNumber(shape.segmentLength, `${name}.segmentLength`, { min: 0.0 }),
    axis,
    offset: readShapeOffset(shape.offset, `${name}.offset`)
  });
}
// positionと[w,x,y,z] orientationを共通transformとして検証します
// target transformでもbody初期状態でも同じ検証を通し、完全なtransformだけを保持します
export function normalizeTransformDescriptor(value, name = "transform", options = {}) {
  const transform = readRequiredObject(value, name);
  const requireOrientation = options.requireOrientation === true;
  if (requireOrientation && transform.orientation === undefined) {
    throw new Error(`${name}.orientation is required`);
  }
  return Object.freeze({
    position: readRequiredVec3(transform.position, `${name}.position`),
    orientation: readOptionalOrientation(transform.orientation, `${name}.orientation`)
  });
}

// Planeのworld法線とplaneDistanceを正規化します
// Planeはbody shapeではなくworld resourceとして扱い、CPU側ではstatic bodyへ変換します
export function normalizePlane(value, name = "plane") {
  const plane = readRequiredObject(value, name);
  const inputNormal = readRequiredVec3(plane.normal, `${name}.normal`);
  const length = Math.hypot(...inputNormal);
  if (length <= 0.0) {
    throw new Error(`${name}.normal must not be a zero vector`);
  }
  return Object.freeze({
    normal: Object.freeze(inputNormal.map((entry) => entry / length)),
    planeDistance: util.readOptionalFiniteNumber(
      plane.planeDistance,
      `${name}.planeDistance`,
      0.0
    )
  });
}

// restitutionとfrictionだけを共通materialとして保持し、dampingはbody属性と分離します
function normalizeMaterial(value, name) {
  const material = util.readPlainObject(value, name, {});
  const normalized = {};
  if (material.restitution !== undefined) {
    normalized.restitution = util.readFiniteNumber(
      material.restitution,
      `${name}.restitution`,
      { min: 0.0, max: 1.0 }
    );
  }
  if (material.friction !== undefined) {
    normalized.friction = util.readFiniteNumber(
      material.friction,
      `${name}.friction`,
      { min: 0.0 }
    );
  }
  return Object.freeze(normalized);
}

// CPU/Computeで共有するbody descriptorを正規化します
// 共通角速度はrad/sec、姿勢は[w,x,y,z]、寸法はworld単位として固定します
export function normalizeBodyDescriptor(value, name = "body") {
  const body = readRequiredObject(value, name);
  const shape = normalizeShape(body.shape, `${name}.shape`);
  const bodyType = body.bodyType === undefined
    ? "dynamic"
    : readRequiredEnum(body.bodyType, `${name}.bodyType`, COMMON_PHYSICS_BODY_TYPES);
  const transform = normalizeTransformDescriptor(body, name);
  const motionMode = body.motionMode === undefined
    ? "none"
    : readRequiredEnum(body.motionMode, `${name}.motionMode`, COMMON_PHYSICS_MOTION_MODES);
  if (bodyType === "kinematic" && motionMode === "none") {
    throw new Error(`${name}.motionMode is required for a kinematic body`);
  }
  if (bodyType !== "kinematic" && motionMode !== "none") {
    throw new Error(`${name}.motionMode requires bodyType=kinematic`);
  }
  const linearVelocity = readOptionalVec3(
    body.linearVelocity,
    `${name}.linearVelocity`,
    [0.0, 0.0, 0.0]
  );
  const angularVelocity = readOptionalVec3(
    body.angularVelocity,
    `${name}.angularVelocity`,
    [0.0, 0.0, 0.0]
  );
  const mass = util.readOptionalFiniteNumber(body.mass, `${name}.mass`, 1.0, {
    minExclusive: 0.0
  });
  const allowSleep = util.readOptionalBoolean(body.allowSleep, `${name}.allowSleep`, true);
  const isSleeping = util.readOptionalBoolean(body.isSleeping, `${name}.isSleeping`, false);
  if (isSleeping && !allowSleep) {
    throw new Error(`${name}.isSleeping requires allowSleep=true`);
  }
  const inertiaLocal = body.inertiaLocal === undefined
    ? undefined
    : readRequiredVec3(body.inertiaLocal, `${name}.inertiaLocal`, { minExclusive: 0.0 });
  const normalized = {
    ...(body.id === undefined
      ? {}
      : { id: util.readFiniteNumber(body.id, `${name}.id`, { integer: true, minExclusive: 0.0 }) }),
    bodyType,
    motionMode,
    position: transform.position,
    orientation: transform.orientation,
    linearVelocity,
    angularVelocity,
    mass,
    inertiaLocal,
    gravityScale: util.readOptionalFiniteNumber(body.gravityScale, `${name}.gravityScale`, 1.0),
    linearDamping: util.readOptionalFiniteNumber(body.linearDamping, `${name}.linearDamping`, 0.0, { min: 0.0 }),
    angularDamping: util.readOptionalFiniteNumber(body.angularDamping, `${name}.angularDamping`, 0.0, { min: 0.0 }),
    allowSleep,
    isSleeping,
    isTrigger: util.readOptionalBoolean(body.isTrigger, `${name}.isTrigger`, false),
    fixedRotation: util.readOptionalBoolean(body.fixedRotation, `${name}.fixedRotation`, false),
    collisionLayer: util.readOptionalFiniteNumber(body.collisionLayer, `${name}.collisionLayer`, 1, {
      integer: true,
      min: 0,
      max: 0xffffffff
    }),
    collisionMask: util.readOptionalFiniteNumber(body.collisionMask, `${name}.collisionMask`, 0xffffffff, {
      integer: true,
      min: 0,
      max: 0xffffffff
    }),
    material: normalizeMaterial(body.material, `${name}.material`),
    shape
  };
  return Object.freeze(normalized);
}

// 共通world設定を正規化し、CPUとComputeで異なる既定値を一つの入力から消します
export function normalizeWorldDescriptor(value = {}) {
  const world = util.readPlainObject(value, "world");
  if (world.planes !== undefined && !Array.isArray(world.planes)) {
    throw new Error("world.planes must be an array");
  }
  const planes = world.planes === undefined
    ? Object.freeze([])
    : Object.freeze(world.planes.map((plane, index) => normalizePlane(plane, `world.planes[${index}]`)));
  return Object.freeze({
    gravity: readOptionalVec3(world.gravity, "world.gravity", [0.0, -9.8, 0.0]),
    fixedTimeStepMs: util.readOptionalFiniteNumber(
      world.fixedTimeStepMs,
      "world.fixedTimeStepMs",
      1000.0 / 120.0,
      { minExclusive: 0.0 }
    ),
    maxSubSteps: util.readOptionalFiniteNumber(world.maxSubSteps, "world.maxSubSteps", 6, {
      integer: true,
      min: 1
    }),
    solverIterations: util.readOptionalFiniteNumber(world.solverIterations, "world.solverIterations", 4, {
      integer: true,
      min: 1
    }),
    defaultRestitution: util.readOptionalFiniteNumber(
      world.defaultRestitution,
      "world.defaultRestitution",
      0.0,
      { min: 0.0, max: 1.0 }
    ),
    defaultFriction: util.readOptionalFiniteNumber(
      world.defaultFriction,
      "world.defaultFriction",
      0.4,
      { min: 0.0 }
    ),
    planes
  });
}
