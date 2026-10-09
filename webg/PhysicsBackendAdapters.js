// ---------------------------------------------
//  PhysicsBackendAdapters.js  2026/08/27
//   CPU/Compute adapters for the isolated common physics descriptor
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import Quat from "./Quat.js";
import PhysicsNode from "./PhysicsNode.js";
import PhysicsSpace from "./PhysicsSpace.js";
import BoxCollider from "./BoxCollider.js";
import SphereCollider from "./SphereCollider.js";
import CapsuleCollider from "./CapsuleCollider.js";
import PlaneCollider from "./PlaneCollider.js";
import ComputeBoxCollider from "./ComputeBoxCollider.js";
import ComputeSphereCollider from "./ComputeSphereCollider.js";
import ComputeCapsuleCollider from "./ComputeCapsuleCollider.js";
import ComputePlaneCollider from "./ComputePlaneCollider.js";
import util from "./util.js";
import {
  DEG_TO_RAD,
  RAD_TO_DEG,
  normalizeBodyDescriptor,
  normalizePlane,
  normalizeShape,
  normalizeWorldDescriptor
} from "./PhysicsDescriptor.js";

// 共通descriptorの検証済みquaternionをwebg CPU APIのQuatへ変換します
// PhysicsNodeへ未正規化配列を渡さず、Computeと同じ姿勢をCPU側でも再現します
export function createCpuQuat(orientation, name = "orientation") {
  const values = Array.isArray(orientation)
    ? orientation
    : orientation?.q;
  if (!Array.isArray(values) || values.length !== 4) {
    throw new Error(`${name} must be a 4 element quaternion array`);
  }
  const checked = values.map((entry, index) => util.readFiniteNumber(
    entry,
    `${name}[${index}]`
  ));
  const length = Math.hypot(...checked);
  if (length <= 0.0) {
    throw new Error(`${name} must not be a zero quaternion`);
  }
  const quat = new Quat();
  quat.q[0] = checked[0] / length;
  quat.q[1] = checked[1] / length;
  quat.q[2] = checked[2] / length;
  quat.q[3] = checked[3] / length;
  return quat;
}

// 共通rad/sec角速度をCPU PhysicsNodeのdegree/sec表現へ変換します
// 単位変換をsample側へ漏らさず、CPUとComputeの入力契約を一箇所へ集約します
export function createCpuAngularVelocity(angularVelocity) {
  if (!Array.isArray(angularVelocity) || angularVelocity.length !== 3) {
    throw new Error("angularVelocity must be a 3 element array");
  }
  return Object.freeze(angularVelocity.map((entry, index) => {
    const numeric = util.readFiniteNumber(entry, `angularVelocity[${index}]`);
    return numeric * RAD_TO_DEG;
  }));
}

// 共通shapeをCPU Colliderへ変換します
// Computeで利用できるoffsetを明示的に検証し、CPU版の既存Collider仕様を保持します
export function createCpuCollider(value, name = "shape") {
  const shape = normalizeShape(value, name);
  if (shape.type === "box") {
    return new BoxCollider(shape.size, { offset: shape.offset });
  }
  if (shape.type === "sphere") {
    return new SphereCollider(shape.radius, { offset: shape.offset });
  }
  return new CapsuleCollider(shape.radius, shape.segmentLength, { offset: shape.offset });
}

// Compute BodyStateで未対応のnon-zero offsetを明示的に拒否します
// offsetを原点へ移したり、寸法へ混ぜたりするとCPUとGPUの形状が別物になるためです
function assertComputeOffsetSupported(shape) {
  if (shape.offset.some((entry) => Math.abs(entry) > 0.0)) {
    throw new Error("Compute backend does not support non-zero shape.offset in BodyState");
  }
}

// 共通shapeをCompute Colliderへ変換します
// Collider種別をsizeの形から推測せず、descriptorのtypeをそのままComputeへ渡します
export function createComputeCollider(value, name = "shape") {
  const shape = normalizeShape(value, name);
  assertComputeOffsetSupported(shape);
  if (shape.type === "box") {
    return new ComputeBoxCollider(shape.size);
  }
  if (shape.type === "sphere") {
    return new ComputeSphereCollider(shape.radius);
  }
  return new ComputeCapsuleCollider(shape.radius, shape.segmentLength);
}

// CPU body optionへ共通descriptorの物理属性を変換します
// CPUだけが使うdegree/secとPhysicsNodeのinertia表現をこの境界で吸収します
function createCpuBodyOptions(body) {
  const options = {
    bodyType: body.bodyType,
    mass: body.mass,
    gravityScale: body.gravityScale,
    linearDamping: body.linearDamping,
    angularDamping: body.angularDamping,
    allowSleep: body.allowSleep,
    isSleeping: body.isSleeping,
    isTrigger: body.isTrigger,
    fixedRotation: body.fixedRotation,
    collisionLayer: body.collisionLayer,
    collisionMask: body.collisionMask,
    material: body.material
  };
  if (body.inertiaLocal !== undefined) {
    options.inertia = body.inertiaLocal;
  }
  return options;
}

// CPU PhysicsNodeを直接生成するか、Spaceの管理配列へ登録して生成するかを分けます
// Browser sampleではparentNode引数にSpaceが渡るため、Space.addPhysicsNode()を使わないと
// Node自身は作られてもscene描画の走査対象にならず、物理状態だけが進む結果になります
function createCpuPhysicsNodeInstance(parentNode, name, options) {
  if (parentNode && typeof parentNode.addPhysicsNode === "function") {
    // Spaceはscene graphの親Nodeではないため、nullを親としてSpaceの登録入口へ渡します
    return parentNode.addPhysicsNode(null, name, options);
  }
  // 通常のNodeが渡された場合は、Node階層の親子関係をPhysicsNodeへそのまま設定します
  return new PhysicsNode(parentNode, name, options);
}

// 共通body descriptorからCPU PhysicsNodeを生成します
// parentNodeは通常のNodeまたはscene登録機能を持つSpaceを受け付け、物理descriptorは物理値だけを保持します
export function createCpuPhysicsNode(parentNode, name, value) {
  const body = normalizeBodyDescriptor(value, `body:${name}`);
  const node = createCpuPhysicsNodeInstance(
    parentNode,
    util.readOptionalString(name, "CPU PhysicsNode name", "common-body", {
      trim: true,
      allowEmpty: false
    }),
    {
      ...createCpuBodyOptions(body),
      collider: createCpuCollider(body.shape, `body:${name}.shape`)
    }
  );
  node.syncNodeFromPhysics(body.position, {
    quat: createCpuQuat(body.orientation, `body:${name}.orientation`)
  });
  node.setLinearVelocityVec(body.linearVelocity);
  node.setAngularVelocityVec(createCpuAngularVelocity(body.angularVelocity));
  return node;
}

// 共通body descriptorからComputePhysicsSpace.addBody()用descriptorを生成します
// Compute側のangularVelocityはrad/sec、inertiaはinverse inertia localへ明示変換します
export function createComputeBodyDescriptor(value, name = "body") {
  const body = normalizeBodyDescriptor(value, name);
  const computeBody = {
    ...(body.id === undefined ? {} : { id: body.id }),
    position: [...body.position],
    orientation: [...body.orientation],
    linearVelocity: [...body.linearVelocity],
    angularVelocity: [...body.angularVelocity],
    bodyType: body.bodyType,
    motionMode: body.motionMode,
    mass: body.mass,
    gravityScale: body.gravityScale,
    allowSleep: body.allowSleep,
    isSleeping: body.isSleeping,
    isTrigger: body.isTrigger,
    fixedRotation: body.fixedRotation,
    collisionLayer: body.collisionLayer,
    collisionMask: body.collisionMask,
    material: {
      ...body.material,
      linearDamping: body.linearDamping,
      angularDamping: body.angularDamping
    },
    collider: createComputeCollider(body.shape, `${name}.shape`)
  };
  // ComputePhysicsSpaceは非回転bodyへnon-zero inverse inertiaを拒否するため、
  // 固定条件では明示値を渡さず、BodyState側のゼロ逆慣性処理へ接続します
  if (body.inertiaLocal !== undefined && body.bodyType === "dynamic" && !body.fixedRotation) {
    computeBody.inverseInertiaLocal = body.inertiaLocal.map((entry, index) => {
      const numeric = util.readFiniteNumber(entry, `${name}.inertiaLocal[${index}]`, {

        minExclusive: 0.0
      });
      return 1.0 / numeric;
    });
  }
  return Object.freeze(computeBody);
}

// 共通PlaneをCPUのstatic PhysicsNodeへ変換します
// PlaneColliderはNode位置とoffsetで表現するため、原点static nodeのoffsetへnormal * planeDistanceを置きます
export function createCpuPlaneNode(parentNode, name, value) {
  const plane = normalizePlane(value, `plane:${name}`);
  const offset = plane.normal.map((entry) => entry * plane.planeDistance);
  return createCpuPhysicsNodeInstance(
    parentNode,
    util.readOptionalString(name, "CPU Plane PhysicsNode name", "common-plane", {
      trim: true,
      allowEmpty: false
    }),
    {
      bodyType: "static",
      collider: new PlaneCollider(plane.normal, { offset })
    }
  );
}

// 共通PlaneをComputePhysicsSpaceのworld Planeへ変換します
// ComputePlaneColliderのplaneDistanceはbody位置ではなくdot(position, normal)の距離として渡します
export function createComputePlaneCollider(value, name = "plane") {
  const plane = normalizePlane(value, name);
  return new ComputePlaneCollider(plane.normal, {
    planeDistance: plane.planeDistance
  });
}

// 共通Plane一覧をCPU static node一覧へ変換します
// Planeごとに個別nodeを作り、CPU PhysicsSpace.addBody()の既存入口へそのまま登録できる形にします
export function createCpuPlaneNodes(parentNode, planes) {
  if (!Array.isArray(planes)) {
    throw new Error("planes must be an array");
  }
  return planes.map((plane, index) => createCpuPlaneNode(
    parentNode,
    `common-plane-${index}`,
    plane
  ));
}

// 共通Plane一覧をComputePhysicsSpace optionsへ変換します
// Planeをbody slotへ追加せず、Compute側の専用plane bufferへ登録する差をここで吸収します
export function createComputePlaneColliders(planes) {
  if (!Array.isArray(planes)) {
    throw new Error("planes must be an array");
  }
  return planes.map((plane, index) => createComputePlaneCollider(
    plane,
    `world.planes[${index}]`
  ));
}

// 共通scenarioのsolver設定からCPU PhysicsSpaceへ渡す共通接触条件を抜き出します
// 未指定の値はPhysicsSpaceへ渡さず、呼出側が明示した条件だけを検証して保持します
function createCpuSolverOptions(value = undefined) {
  if (value === undefined) {
    return {};
  }
  const solver = util.readPlainObject(value, "CPU solver options");
  const options = {};
  if (solver.positionCorrectionBeta !== undefined) {
    options.positionCorrectionBeta = util.readFiniteNumber(
      solver.positionCorrectionBeta,
      "CPU solver options.positionCorrectionBeta",
      { min: 0.0, max: 1.0 }
    );
  }
  if (solver.positionSlop !== undefined) {
    options.positionCorrectionSlop = util.readFiniteNumber(
      solver.positionSlop,
      "CPU solver options.positionSlop",
      { min: 0.0 }
    );
  }
  if (solver.restingRestitutionSpeed !== undefined) {
    options.restingRestitutionSpeed = util.readFiniteNumber(
      solver.restingRestitutionSpeed,
      "CPU solver options.restingRestitutionSpeed",
      { min: 0.0 }
    );
  }
  if (solver.revisitBodyContactImpulses !== undefined) {
    if (typeof solver.revisitBodyContactImpulses !== "boolean") {
      throw new Error("CPU solver options.revisitBodyContactImpulses must be boolean");
    }
    options.revisitBodyContactImpulses = solver.revisitBodyContactImpulses;
  }
  return options;
}

// 共通world descriptorからCPU PhysicsSpace optionsを生成します
// broadphaseはCPU固有のsweepAabbを明示し、ComputeのXZ Grid設定と分けて管理します
export function createCpuPhysicsSpaceOptions(value = {}, solverOptions = undefined) {
  const world = normalizeWorldDescriptor(value);
  const checkedSolverOptions = createCpuSolverOptions(solverOptions);
  return Object.freeze({
    gravity: [...world.gravity],
    fixedTimeStepMs: world.fixedTimeStepMs,
    maxSubSteps: world.maxSubSteps,
    solverIterations: world.solverIterations,
    broadphaseMode: "sweepAabb",
    defaultRestitution: world.defaultRestitution,
    defaultFriction: world.defaultFriction,
    ...checkedSolverOptions
  });
}

// 共通world descriptorからComputePhysicsSpace optionsを生成します
// Compute専用のXZ GridとPlane bufferを設定し、Compute broadphase名をそのまま使います
export function createComputePhysicsSpaceOptions(value = {}) {
  const world = normalizeWorldDescriptor(value);
  return Object.freeze({
    gravity: [...world.gravity],
    fixedTimeStepMs: world.fixedTimeStepMs,
    maxSubSteps: world.maxSubSteps,
    solverIterations: world.solverIterations,
    defaultRestitution: world.defaultRestitution,
    defaultFriction: world.defaultFriction,
    planes: createComputePlaneColliders(world.planes)
  });
}

// 共通descriptorをCPUとComputeの両方へ変換できるか検証する便利な入口を提供します
// PhysicsSpaceやGPUを生成せず、入力契約と変換可能範囲だけを比較テストできます
export function validateCommonBodyForBackends(value, name = "body") {
  const body = normalizeBodyDescriptor(value, name);
  createCpuCollider(body.shape, `${name}.shape`);
  createComputeCollider(body.shape, `${name}.shape`);
  return body;
}

// CPU backendの単位変換を逆向きに確認するための補助関数を提供します
// Compute readback値をCPU診断へ合わせるときも同じ変換係数を利用します
export function convertCpuAngularVelocityToCommon(value) {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new Error("CPU angularVelocity must be a 3 element array");
  }
  return Object.freeze(value.map((entry, index) => {
    const numeric = util.readFiniteNumber(entry, `CPU angularVelocity[${index}]`);
    return numeric * DEG_TO_RAD;
  }));
}

// PhysicsSpace importを明示的に使用する実験用factoryです
// 共通化検討コードがconstructor引数の組み立てを重複させないようにします
export function createCpuPhysicsSpace(value = {}, solverOptions = undefined) {
  return new PhysicsSpace(createCpuPhysicsSpaceOptions(value, solverOptions));
}
