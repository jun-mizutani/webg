// ---------------------------------------------
//  CpuPhysicsBackend.js  2026/09/09
//   Core high-level module adapter for the existing CPU PhysicsSpace
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import PhysicsNode from "../PhysicsNode.js";
import PhysicsSpaceCore from "../PhysicsSpace.js";
import Quat from "../Quat.js";
import util from "../util.js";
import {
  createCpuCollider,
  readExplicitPose,
  readBodyOptions,
  readNodePoseInSpace,
  readOptions
} from "./SceneHelpers.js";

// 既存CPU PhysicsSpaceをcore high-level moduleから呼ぶための薄いbackendです
// 数式、接触順序、sleep判定はcoreへ残し、この層ではNodeからbodyを作る処理だけをまとめます
export default class CpuPhysicsBackend {
  // CPU PhysicsSpaceを生成し、backend名を固定して上位facadeから明示判定できるようにします
  constructor(options = {}) {
    const opts = readOptions(options, "CpuPhysicsBackend");
    this.kind = "cpu";
    this.space = new PhysicsSpaceCore(opts);
    this.destroyed = false;
  }

  // 表示Nodeとshape optionsからPhysicsNodeを作成し、初期姿勢を一度だけコピーします
  // dynamic Nodeの表示と物理用の独立bodyをPhysicsBindingで同期する構造にします
  addBodyFromNode(node, options = {}) {
    this.requireAlive();
    const opts = readBodyOptions(options, "CpuPhysicsBackend.addBodyFromNode");
    const transformSpace = util.readOptionalEnum(
      options.binding?.transformSpace,
      "CpuPhysicsBackend.addBodyFromNode transformSpace",
      "local",
      ["local", "world"]
    );
    const pose = options.initialPose === undefined
      ? readNodePoseInSpace(node, transformSpace, "CpuPhysicsBackend.addBodyFromNode node")
      : readExplicitPose(options.initialPose, "CpuPhysicsBackend.addBodyFromNode initial");
    const name = util.readOptionalString(options.name, "CpuPhysicsBackend body name", "physics-body", {
      trim: true,
      allowEmpty: false
    });
    const body = new PhysicsNode(null, name, {
      // 初期姿勢を設定できるkinematicとしてbodyを組み立て、登録後に指定されたbodyTypeへ変更します
      // collider、material、初期速度を揃えた後で、利用者が指定したbodyTypeへ明示的に変更します
      bodyType: "kinematic",
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
    });
    body.setPosition(...pose.position);
    const orientation = new Quat();
    orientation.q = [...pose.orientation];
    body.setQuat(orientation);
    body.setCollider(createCpuCollider(opts.shape, "CpuPhysicsBackend.addBodyFromNode"));
    body.setPhysicsMaterial(opts.material);
    body.setBodyType(opts.bodyType, { clearVelocity: true, restoreVelocity: false });
    if (opts.linearVelocity !== undefined) body.setLinearVelocityVec(opts.linearVelocity);
    if (opts.angularVelocity !== undefined) body.setAngularVelocityVec(opts.angularVelocity);
    if (opts.isSleeping) body.sleep();
    this.space.addBody(body);
    return body;
  }

  // 既に作成済みPhysicsNodeを明示的に登録する内部入口です
  // Nodeやdescriptorを明示的に受け取り、既存coreのaddBody検証へ渡します
  addRawBody(body) {
    this.requireAlive();
    return this.space.addBody(body);
  }

  // CPU spaceへJointを登録します
  addJoint(joint) {
    this.requireAlive();
    return this.space.addJoint(joint);
  }

  // CPU spaceからJointを外します
  removeJoint(joint) {
    this.requireAlive();
    return this.space.removeJoint(joint);
  }

  // 可変時間をcoreのfixed stepへ分配します
  step(deltaMs) {
    this.requireAlive();
    return this.space.step(deltaMs);
  }

  // CPU body一覧を返します
  getBodies() {
    this.requireAlive();
    return this.space.getBodies();
  }

  // CPU接触、manifold、sleep islandをそのまま高水準APIへ返します
  getLastContacts() { this.requireAlive(); return this.space.getLastContacts(); }

  // 直近の接触点集合をCPU spaceから返します
  getLastManifolds() { this.requireAlive(); return this.space.getLastManifolds(); }

  // 直近のsleep island構成を返し、停止状態の診断へ接続します
  getLastSleepIslands() { this.requireAlive(); return this.space.getLastSleepIslands(); }

  // 直近のbegin/stay/end接触イベント列を返します
  getLastContactEvents() { this.requireAlive(); return this.space.getLastContactEvents(); }

  // 接触listenerをcoreへ登録し、返された解除関数をそのまま返します
  onBeginContact(listener) { this.requireAlive(); return this.space.onBeginContact(listener); }

  // 継続中の接触を通知するlistenerを登録し、解除関数を返します
  onStayContact(listener) { this.requireAlive(); return this.space.onStayContact(listener); }

  // 接触終了を通知するlistenerを登録し、解除関数を返します
  onEndContact(listener) { this.requireAlive(); return this.space.onEndContact(listener); }

  // CPU queryを明示的にdelegateします
  raycast(origin, direction, options = {}) { this.requireAlive(); return this.space.raycast(origin, direction, options); }
  raycastAll(origin, direction, options = {}) { this.requireAlive(); return this.space.raycastAll(origin, direction, options); }
  queryAabb(min, max, options = {}) { this.requireAlive(); return this.space.queryAabb(min, max, options); }
  overlapSphere(center, radius, options = {}) { this.requireAlive(); return this.space.overlapSphere(center, radius, options); }

  // backend内のcore PhysicsSpaceを明示的に参照する内部入口です
  getCoreSpace() {
    this.requireAlive();
    return this.space;
  }

  // backendの状態を確認し、破棄済みbackendへの操作を状態エラーとして通知します
  requireAlive() {
    if (this.destroyed) throw new Error("CpuPhysicsBackend is destroyed");
  }

  // CPU spaceが保持するbody、Joint、contact状態を解放します
  destroy() {
    if (this.destroyed) return false;
    this.space.destroy?.();
    this.destroyed = true;
    return true;
  }
}
