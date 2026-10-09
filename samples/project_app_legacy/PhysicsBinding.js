// ---------------------------------------------
//  PhysicsBinding.js  2026/09/23
//   Explicit Node and physics-body synchronization for the ProjectApp sample
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import Quat from "../../webg/Quat.js";
import util from "../../webg/util.js";
import {
  readNodePoseInSpace,
  writeNodePoseInSpace
} from "./project_app_helpers.js";

// 表示NodeとCPU bodyまたはCompute body IDの対応を明示的に保持します
// bodyやNodeは登録時に指定した対応表で管理し、対応表の組だけを同期対象にします
export default class PhysicsBinding {
  // backend種別を記録し、各backendに対応する同期方法をbindingへ固定します
  constructor(backend, options = {}) {
    if (!backend || (backend.kind !== "cpu" && backend.kind !== "compute")) {
      throw new Error("PhysicsBinding requires a CPU or Compute backend");
    }
    const opts = util.readPlainObject(options, "PhysicsBinding options", {});
    this.backend = backend;
    this.label = util.readOptionalString(opts.label, "PhysicsBinding label", "physics-binding", {
      trim: true,
      allowEmpty: false
    });
    this.entries = [];
    this.destroyed = false;
  }

  // CPU PhysicsNodeと描画Nodeの組を登録します
  // bodyまたはNodeの重複登録をその場で検出し、同期対象を一意に保ちます
  bindCpu(body, node, options = {}) {
    this.requireKind("cpu");
    this.requireAlive();
    if (!body || typeof body.getPosition !== "function" || typeof body.getQuat !== "function") {
      throw new Error(`${this.label} bindCpu body requires getPosition()/getQuat()`);
    }
    this.requireNode(node);
    if (this.entries.some((entry) => entry.body === body || entry.node === node)) {
      throw new Error(`${this.label} bindCpu body or node is already bound`);
    }
    const opts = util.readPlainObject(options, `${this.label} bindCpu options`, {});
    const transformSpace = util.readOptionalEnum(
      opts.transformSpace,
      `${this.label} bindCpu transformSpace`,
      "local",
      ["local", "world"]
    );
    const entry = Object.freeze({
      kind: "cpu",
      body,
      node,
      transformSpace,
      initialPose: this.captureNodePose(node, transformSpace, `${this.label} bindCpu initial pose`),
      syncVelocity: util.readOptionalBoolean(opts.syncVelocity, `${this.label} syncVelocity`, false),
      syncSleep: util.readOptionalBoolean(opts.syncSleep, `${this.label} syncSleep`, false),
      writeFromNode: util.readOptionalBoolean(opts.writeFromNode, `${this.label} writeFromNode`, false)
    });
    if (entry.syncVelocity
      && (typeof node.setLinearVelocityVec !== "function"
        || typeof node.setAngularVelocityVec !== "function")) {
      throw new Error(`${this.label} bindCpu syncVelocity requires velocity setters on node`);
    }
    if (entry.syncSleep
      && (typeof node.sleep !== "function" || typeof node.wakeUp !== "function")) {
      throw new Error(`${this.label} bindCpu syncSleep requires sleep()/wakeUp() on node`);
    }
    this.entries.push(entry);
    return entry;
  }

  // Compute body IDと描画Nodeの組を登録します
  // body slotとは独立して、readbackで使うpublic body IDをそのまま保存します
  bindCompute(bodyId, node, options = {}) {
    this.requireKind("compute");
    this.requireAlive();
    const id = util.readFiniteNumber(bodyId, `${this.label} bindCompute bodyId`, {
      integer: true,
      minExclusive: 0
    });
    this.requireNode(node);
    if (this.entries.some((entry) => entry.bodyId === id || entry.node === node)) {
      throw new Error(`${this.label} bindCompute body ID or node is already bound`);
    }
    const opts = util.readPlainObject(options, `${this.label} bindCompute options`, {});
    const transformSpace = util.readOptionalEnum(
      opts.transformSpace,
      `${this.label} bindCompute transformSpace`,
      "local",
      ["local", "world"]
    );
    const entry = Object.freeze({
      kind: "compute",
      bodyId: id,
      node,
      transformSpace,
      initialPose: this.captureNodePose(node, transformSpace, `${this.label} bindCompute initial pose`),
      syncVelocity: util.readOptionalBoolean(opts.syncVelocity, `${this.label} syncVelocity`, false),
      syncSleep: util.readOptionalBoolean(opts.syncSleep, `${this.label} syncSleep`, false)
    });
    this.entries.push(entry);
    return entry;
  }

  // Nodeがtransform setterを持つことを登録時に確認します
  requireNode(node) {
    if (!node || typeof node !== "object") {
      throw new Error(`${this.label} binding node must be an object`);
    }
  }

  // Nodeの初期位置と姿勢をResetで再利用できる不変な値へ変換します
  // 物理bodyの初期入力と表示Nodeの初期状態を同じ姿勢から開始します
  captureNodePose(node, transformSpace, label) {
    const pose = readNodePoseInSpace(node, transformSpace, label);
    return Object.freeze({
      position: Object.freeze([...pose.position]),
      orientation: Object.freeze([...pose.orientation])
    });
  }

  // backend種別を確認し、CPU用同期とCompute用readbackを対応する処理へ振り分けます
  requireKind(kind) {
    if (this.backend.kind !== kind) {
      throw new Error(`${this.label} requires ${kind} backend, got ${this.backend.kind}`);
    }
  }

  // CPU bodyの現在姿勢を対応Nodeへ同期します
  syncCpu() {
    this.requireKind("cpu");
    this.requireAlive();
    return this.entries.map((entry) => {
      const quat = entry.body.getQuat();
      const state = {
        position: entry.body.getPosition(),
        orientation: quat
      };
      writeNodePoseInSpace(entry.node, state, entry.transformSpace, `${this.label} CPU binding`);
      if (entry.syncVelocity && typeof entry.node.setLinearVelocityVec === "function") {
        entry.node.setLinearVelocityVec(entry.body.getLinearVelocity());
      }
      if (entry.syncVelocity && typeof entry.node.setAngularVelocityVec === "function") {
        entry.node.setAngularVelocityVec(entry.body.getAngularVelocity());
      }
      if (entry.syncSleep) {
        if (entry.body.getSleeping()) {
          entry.node.sleep();
        } else {
          entry.node.wakeUp();
        }
      }
      return entry;
    });
  }

  // CPUのkinematic/static bodyへ、操作後の表示Node姿勢を明示的に書き戻します
  // dynamic bodyへの外部移動要求を登録時のbodyTypeで検証し、kinematic/static bodyの操作と区別します
  syncCpuFromNodes() {
    this.requireKind("cpu");
    this.requireAlive();
    return this.entries.filter((entry) => entry.writeFromNode).map((entry) => {
      if (!entry.body.isKinematic?.() && !entry.body.isStatic?.()) {
        throw new Error(`${this.label} syncCpuFromNodes cannot write a dynamic body`);
      }
      const pose = readNodePoseInSpace(
        entry.node,
        entry.transformSpace,
        `${this.label} CPU source node`
      );
      entry.body.setPosition(...pose.position);
      const orientation = new Quat();
      orientation.q = [...pose.orientation];
      entry.body.setQuat(orientation);
      entry.body.wakeUp?.();
      return entry;
    });
  }

  // Compute readback配列を対応Nodeへ同期します
  // readback配列を必須入力としてNodeを最新状態へ更新し、取得前の呼出しは状態エラーとして通知します
  syncCompute(stateData) {
    this.requireKind("compute");
    this.requireAlive();
    if (!(stateData instanceof Float32Array)) {
      throw new Error(`${this.label} syncCompute requires a Float32Array readback`);
    }
    return this.entries.map((entry) => {
      const state = this.backend.readBodyStateFromReadback(entry.bodyId, stateData);
      const orientation = new Quat();
      orientation.q = [...state.orientation];
      writeNodePoseInSpace(entry.node, {
        position: state.position,
        orientation
      }, entry.transformSpace, `${this.label} Compute body ${entry.bodyId}`);
      return entry;
    });
  }

  // 登録時の姿勢をNodeへ戻し、物理Reset直後の表示状態をそろえます
  // GPU readbackを待つ前の最初の描画から、物理の初期配置を表示します
  restoreInitialPoses() {
    this.requireAlive();
    for (const entry of this.entries) {
      const orientation = new Quat();
      orientation.q = [...entry.initialPose.orientation];
      writeNodePoseInSpace(entry.node, {
        position: [...entry.initialPose.position],
        orientation
      }, entry.transformSpace, `${this.label} reset pose`);
    }
    return this.entries.length;
  }

  // 登録済みbindingの複製配列を返し、呼出側が内部配列から独立して扱えるようにします
  getEntries() {
    this.requireAlive();
    return [...this.entries];
  }

  // 指定bodyのbindingを解除します
  unbind(target) {
    this.requireAlive();
    const index = this.entries.findIndex((entry) => (
      entry.body === target || entry.bodyId === target || entry.node === target
    ));
    if (index < 0) {
      throw new Error(`${this.label} binding target is not registered`);
    }
    return this.entries.splice(index, 1)[0];
  }

  // bindingの状態を確認し、破棄済みbindingへの操作を状態エラーとして通知します
  requireAlive() {
    if (this.destroyed) throw new Error(`${this.label} is destroyed`);
  }

  // binding一覧を破棄し、backend resourceは外側のPhysicsSpaceへ残します
  destroy() {
    if (this.destroyed) return false;
    this.entries.length = 0;
    this.destroyed = true;
    return true;
  }
}
