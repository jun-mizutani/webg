// ---------------------------------------------
//  ComputePhysicsBackend.js  2026/09/23
//   ProjectApp sample adapter for the existing ComputePhysicsSpace
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import ComputePhysicsSpace from "../../webg/ComputePhysicsSpace.js";
import ComputePlaneCollider from "../../webg/ComputePlaneCollider.js";
import util from "../../webg/util.js";
import {
  createComputeCollider,
  readExplicitPose,
  readBodyOptions,
  readNodePoseInSpace,
  readOptions
} from "./project_app_helpers.js";

// physics manifestの平面定義をComputePlaneColliderへ変換します
// 既存のCollider入力も受理し、projectから読む平面は法線と距離を明示する形式にそろえます
function readComputePlanes(value, label) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((entry, index) => {
    if (entry instanceof ComputePlaneCollider) return entry;
    const definition = util.readPlainObject(entry, `${label}[${index}]`);
    for (const key of Object.keys(definition)) {
      if (key !== "normal" && key !== "planeDistance") {
        throw new Error(`${label}[${index}].${key} is not supported`);
      }
    }
    return new ComputePlaneCollider(definition.normal, {
      planeDistance: definition.planeDistance
    });
  });
}

// 既存ComputePhysicsSpaceをProjectApp sampleから呼ぶためのbackendです
// GPU command、submit、readbackの境界と必要な同期点を呼出側へ明示します
export default class ComputePhysicsBackend {
  // GPU context、Compute space設定、固定Plane配列を検証してbackendを生成します
  // Planeはconstructor時に受け取った設定を固定のCompute Plane入力として使用します
  constructor(gpu, options = {}) {
    if (!gpu?.device || !gpu?.queue) {
      throw new Error("ComputePhysicsBackend requires a ready WebGPU context");
    }
    const opts = readOptions(options, "ComputePhysicsBackend");
    const planes = readComputePlanes(opts.planes, "ComputePhysicsBackend planes");
    this.kind = "compute";
    this.space = new ComputePhysicsSpace(gpu, { ...opts, planes });
    this.initialBodyDescriptors = [];
    this.nextBodyId = 1;
    this.destroyed = false;
  }

  // Compute body descriptorを再利用できる初期状態として複製します
  // 姿勢と速度の配列を分けて保持し、Reset時に初回登録と同じ値を再びGPUへ渡します
  cloneBodyDescriptor(descriptor) {
    const copy = { ...descriptor };
    for (const field of ["position", "orientation", "linearVelocity", "angularVelocity"]) {
      if (Array.isArray(descriptor[field])) copy[field] = [...descriptor[field]];
    }
    if (descriptor.material && typeof descriptor.material === "object") {
      copy.material = { ...descriptor.material };
    }
    return copy;
  }

  // 表示Nodeとshape optionsからCompute body descriptorを作り、GPU spaceへ登録します
  // NodeのQuaternionをcoreが要求する[ w, x, y, z ]配列へ直接渡します
  addBodyFromNode(node, options = {}) {
    this.requireAlive();
    const opts = readBodyOptions(options, "ComputePhysicsBackend.addBodyFromNode");
    const transformSpace = util.readOptionalEnum(
      options.binding?.transformSpace,
      "ComputePhysicsBackend.addBodyFromNode transformSpace",
      "local",
      ["local", "world"]
    );
    const pose = options.initialPose === undefined
      ? readNodePoseInSpace(node, transformSpace, "ComputePhysicsBackend.addBodyFromNode node")
      : readExplicitPose(options.initialPose, "ComputePhysicsBackend.addBodyFromNode initial");
    const id = options.id === undefined
      ? this.nextBodyId
      : util.readFiniteNumber(options.id, "ComputePhysicsBackend body id", {
        integer: true,
        minExclusive: 0
      });
    this.nextBodyId = Math.max(this.nextBodyId, id + 1);
    const collider = createComputeCollider(opts.shape, "ComputePhysicsBackend.addBodyFromNode");
    const descriptor = {
      id,
      bodyType: opts.bodyType,
      position: pose.position,
      orientation: pose.orientation,
      linearVelocity: opts.linearVelocity ?? [0.0, 0.0, 0.0],
      angularVelocity: opts.angularVelocity ?? [0.0, 0.0, 0.0],
      collider,
      mass: opts.mass,
      gravityScale: opts.gravityScale,
      linearDamping: opts.linearDamping,
      angularDamping: opts.angularDamping,
      allowSleep: opts.allowSleep,
      isSleeping: opts.isSleeping,
      isTrigger: opts.isTrigger,
      fixedRotation: opts.fixedRotation,
      collisionLayer: opts.collisionLayer,
      collisionMask: opts.collisionMask,
      material: opts.material
    };
    const bodyId = this.space.addBody(descriptor);
    this.initialBodyDescriptors.push(this.cloneBodyDescriptor(descriptor));
    return bodyId;
  }

  // 既に検証済みのCompute descriptorを明示的に登録する内部入口です
  addRawBody(descriptor) {
    this.requireAlive();
    const bodyId = this.space.addBody(descriptor);
    this.initialBodyDescriptors.push(this.cloneBodyDescriptor(descriptor));
    return bodyId;
  }

  // 登録時の全body descriptorを再投入し、Compute spaceとGPU stateを初期状態へ戻します
  // body IDとslotの並びを保ったまま、既存のPhysicsBindingが同じNodeへ接続し続けられる形にします
  reset() {
    this.requireAlive();
    if (this.initialBodyDescriptors.length === 0) {
      throw new Error("ComputePhysicsBackend reset requires registered bodies");
    }
    this.space.setBodies(this.initialBodyDescriptors.map((descriptor) => (
      this.cloneBodyDescriptor(descriptor)
    )));
    this.space.resetAccumulator();
    return this;
  }

  // 指定bodyだけを初期姿勢、速度、sleep状態へ戻す命令をGPUへ予約します
  // 全bodyを再構築するreset()と分け、他の物体の時刻と状態を保持したまま再試行できます
  resetBody(bodyId, { position, orientation = [1, 0, 0, 0], initialState = "awake" } = {}) {
    this.requireAlive();
    const record = this.space.getBodyInfo(bodyId);
    if (!Array.isArray(position) || position.length !== 3) {
      throw new Error("ComputePhysicsBackend.resetBody position must be a 3 element array");
    }
    if (!Array.isArray(orientation) || orientation.length !== 4) {
      throw new Error("ComputePhysicsBackend.resetBody orientation must be a 4 element array");
    }
    if (initialState !== "awake" && initialState !== "sleeping") {
      throw new Error("ComputePhysicsBackend.resetBody initialState must be awake or sleeping");
    }
    if (initialState === "sleeping" && record.allowSleep !== true) {
      throw new Error("ComputePhysicsBackend.resetBody sleeping requires allowSleep=true");
    }
    this.space.teleport(bodyId, position, { keepVelocity: false, wakeUp: false });
    this.space.setBodyOrientation(bodyId, orientation, { wakeUp: false });
    if (initialState === "sleeping") this.space.sleepBody(bodyId);
    else this.space.wakeBody(bodyId);
    return this;
  }

  // Compute spaceの固定Plane配列をconstructor時に確定し、space生成後はその配列を基準に計算します
  addPlane() {
    this.requireAlive();
    throw new Error("ComputePhysicsBackend.addPlane requires planes in backend constructor options");
  }

  // Compute Joint descriptorをGPU spaceへ登録します
  addJoint(joint) { this.requireAlive(); return this.space.addJoint(joint); }
  removeJoint(jointId) { this.requireAlive(); return this.space.removeJoint(jointId); }

  // 同じPhysicsSpace facadeから呼べるよう、deltaMsとcommandEncoderを明示的に受け取ります
  // commandEncoderを受け取り、GPU commandへ固定stepを記録します。入力の不足はGPU記録エラーとして通知します
  step(commandEncoder, deltaMs, options = {}) {
    this.requireAlive();
    return this.space.encode(commandEncoder, deltaMs, options);
  }

  // body stateのGPU bufferを返し、描画側がreadbackなしに参照する高度な経路を残します
  getRenderState() { this.requireAlive(); return this.space.getRenderState(); }
  getBodies() { this.requireAlive(); return this.space.getBodies(); }
  getLastContacts() { this.requireAlive(); return this.space.getLastContacts(); }
  getLastManifolds() { this.requireAlive(); return this.space.getLastManifolds(); }
  getLastContactEvents() { this.requireAlive(); return this.space.getLastContactEvents(); }
  getContactsFromReadback(...args) { this.requireAlive(); return this.space.getContactsFromReadback(...args); }
  getPlaneContactsFromReadback(...args) { this.requireAlive(); return this.space.getPlaneContactsFromReadback(...args); }
  dispatchContactEventsFromReadback(...args) {
    this.requireAlive();
    return this.space.dispatchContactEventsFromReadback(...args);
  }

  // Compute contact listenerをreadback結果の通知経路へ登録します
  onBeginContact(listener) { this.requireAlive(); return this.space.onBeginContact(listener); }
  onStayContact(listener) { this.requireAlive(); return this.space.onStayContact(listener); }
  onEndContact(listener) { this.requireAlive(); return this.space.onEndContact(listener); }

  // state readback用bufferの作成とcopy記録をexplicit APIとして公開します
  createStateReadbackBuffer(...args) { this.requireAlive(); return this.space.createStateReadbackBuffer(...args); }
  encodeStateReadback(...args) { this.requireAlive(); return this.space.encodeStateReadback(...args); }
  async readStateReadback(...args) { this.requireAlive(); return this.space.readStateReadback(...args); }
  readBodyStateFromReadback(...args) { this.requireAlive(); return this.space.readBodyStateFromReadback(...args); }
  syncNodeFromPhysics(...args) { this.requireAlive(); return this.space.syncNodeFromPhysics(...args); }
  syncPhysicsFromNode(...args) { this.requireAlive(); return this.space.syncPhysicsFromNode(...args); }

  // Compute diagnostics readbackを通常frameから分離したままdelegateします
  createDiagnosticReadbackBuffer(...args) { this.requireAlive(); return this.space.createDiagnosticReadbackBuffer(...args); }
  encodeDiagnosticReadback(...args) { this.requireAlive(); return this.space.encodeDiagnosticReadback(...args); }
  async readDiagnosticReadback(...args) { this.requireAlive(); return this.space.readDiagnosticReadback(...args); }

  // Compute backendの利用可否を判定する共通guardです
  requireAlive() {
    if (this.destroyed) throw new Error("ComputePhysicsBackend is destroyed");
  }

  // GPU resourcesを解放し、backendの状態をdestroyedへ更新します
  destroy() {
    if (this.destroyed) return false;
    this.space.destroy?.();
    this.destroyed = true;
    return true;
  }
}
