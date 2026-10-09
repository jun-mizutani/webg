// ---------------------------------------------
//  PhysicsSpace.js  2026/09/23
//   ProjectApp sample facade for Compute-first physics selection
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import util from "../../webg/util.js";
import ComputePhysicsBackend from "./ComputePhysicsBackend.js";
import CpuPhysicsBackend from "./CpuPhysicsBackend.js";
import PhysicsBinding from "./PhysicsBinding.js";

// Compute backendを標準とし、確認用にCPU backendも選択できるProjectApp sample入口です
// 公開向けの物理設定と低水準backendの接続点を一か所へまとめます
export default class PhysicsSpace {
  // backendを明示的に選び、対応するresourceとNode bindingを生成します
  // Compute選択時はGPU contextを受け取り、入力の不足を初期化エラーとして通知します
  constructor(options = {}) {
    const opts = util.readPlainObject(options, "user PhysicsSpace options", {});
    const backendName = util.readOptionalEnum(
      opts.backend,
      "user PhysicsSpace backend",
      "compute",
      ["cpu", "compute"]
    );
    this.backend = backendName === "cpu"
      ? new CpuPhysicsBackend(opts)
      : new ComputePhysicsBackend(opts.gpu, opts);
    this.kind = backendName;
    this.binding = new PhysicsBinding(this.backend, { label: `${backendName}-physics-binding` });
    this.destroyed = false;
  }

  // 表示Nodeへbodyを作り、同じ呼出しでPhysicsBindingへ登録します
  // Computeではbody IDをoptions.idへ必須指定し、public IDをGPU登録へ渡します
  addBody(node, options = {}) {
    this.requireAlive();
    const body = this.backend.addBodyFromNode(node, options);
    if (this.kind === "cpu") {
      this.binding.bindCpu(body, node, options.binding);
    } else {
      this.binding.bindCompute(body, node, options.binding);
    }
    return body;
  }

  // 既存bodyをbindingなしで登録する低水準入口です
  addRawBody(body) {
    this.requireAlive();
    return this.backend.addRawBody(body);
  }

  // CPUでは通常body登録、Computeではconstructorのplanesへ移行するため明示的に扱います
  addPlane(node, options = {}) {
    this.requireAlive();
    if (this.kind === "compute") {
      return this.backend.addPlane(node, options);
    }
    return this.addBody(node, { ...options, shape: { ...options.shape, type: "plane" }, bodyType: "static" });
  }

  // Jointを選択中backendへ渡します
  addJoint(joint) { this.requireAlive(); return this.backend.addJoint(joint); }
  removeJoint(joint) { this.requireAlive(); return this.backend.removeJoint(joint); }

  // CPUはdeltaMsだけで進め、Computeはoptions.commandEncoderへ同じframeのencoderを指定します
  // API差分をbackendごとに明示し、Compute時のencoder不足を呼出側のエラーとして扱います
  step(deltaMs, options = {}) {
    this.requireAlive();
    if (this.kind === "cpu") {
      if (options.commandEncoder !== undefined) {
        throw new Error("user PhysicsSpace CPU step must not receive commandEncoder");
      }
      return this.backend.step(deltaMs);
    }
    const opts = util.readPlainObject(options, "user PhysicsSpace Compute step options", {});
    if (!opts.commandEncoder) {
      throw new Error("user PhysicsSpace Compute step requires options.commandEncoder");
    }
    const { commandEncoder, ...encodeOptions } = opts;
    return this.backend.step(commandEncoder, deltaMs, encodeOptions);
  }

  // Compute frame ownerがstep前後にGPU copyを記録できるよう明示入口を返します
  encodeStateReadback(...args) { this.requireCompute(); return this.backend.encodeStateReadback(...args); }
  createStateReadbackBuffer(...args) { this.requireCompute(); return this.backend.createStateReadbackBuffer(...args); }
  async readStateReadback(...args) { this.requireCompute(); return this.backend.readStateReadback(...args); }

  // physics stateをbindingへ同期します
  sync() {
    this.requireAlive();
    if (this.kind === "cpu") return this.binding.syncCpu();
    throw new Error("user PhysicsSpace Compute sync requires readback Float32Array; use syncReadback()");
  }

  // kinematic/static Nodeの操作結果をCPU physics bodyへ明示的に戻します
  // ComputeのGPU control command仕様が確定するまで、CPU専用APIとして区別します
  syncFromNodes() {
    this.requireAlive();
    if (this.kind !== "cpu") {
      throw new Error("user PhysicsSpace Compute syncFromNodes is not implemented");
    }
    return this.binding.syncCpuFromNodes();
  }

  // Compute readbackを読み、対応Nodeだけへ姿勢を反映します
  syncReadback(stateData) {
    this.requireCompute();
    return this.binding.syncCompute(stateData);
  }

  // Computeのkinematic/static Node姿勢を次のGPU fixed stepへ明示的に送ります
  // CPUのsyncFromNodes()と区別し、command欄へ記録されるCompute専用処理であることを名前に残します
  syncComputeFromNode(bodyId, node, options = {}) {
    this.requireCompute();
    return this.backend.syncPhysicsFromNode(bodyId, node, options);
  }

  // Compute backendを登録時のbody配列へ戻し、同じbody IDとNode bindingを保ったまま再生を初期化します
  // CPUとComputeのReset経路を分け、Compute作品で使う処理範囲を明示します
  reset() {
    this.requireAlive();
    if (this.kind !== "compute") {
      throw new Error("user PhysicsSpace reset requires compute backend");
    }
    const result = this.backend.reset();
    this.binding.restoreInitialPoses();
    return result;
  }

  // Compute body一つの初期状態を次のfixed stepへ予約します
  // 世界全体を再構築するreset()とは異なり、他bodyの状態と時刻を保持します
  resetBody(bodyId, options = {}) {
    this.requireAlive();
    if (this.kind !== "compute") {
      throw new Error("user PhysicsSpace resetBody requires compute backend");
    }
    return this.backend.resetBody(bodyId, options);
  }

  // Compute readback配列から指定bodyの位置、速度、sleep状態を取得します
  // GPU上の最新値をreadback配列から取得し、CPU shadow値と分けて扱います
  readBodyStateFromReadback(bodyId, stateData) {
    this.requireCompute();
    return this.backend.readBodyStateFromReadback(bodyId, stateData);
  }

  // physics bodyとNodeの対応を利用者へ観測可能にします
  getBindings() { this.requireAlive(); return this.binding.getEntries(); }
  getBodies() { this.requireAlive(); return this.backend.getBodies(); }
  getLastContacts() { this.requireAlive(); return this.backend.getLastContacts(); }
  getLastManifolds() { this.requireAlive(); return this.backend.getLastManifolds(); }
  getLastContactEvents() { this.requireAlive(); return this.backend.getLastContactEvents(); }
  getContactsFromReadback(...args) {
    this.requireCompute();
    return this.backend.getContactsFromReadback(...args);
  }
  dispatchContactEventsFromReadback(...args) {
    this.requireCompute();
    return this.backend.dispatchContactEventsFromReadback(...args);
  }
  getPlaneContactsFromReadback(...args) {
    this.requireCompute();
    return this.backend.getPlaneContactsFromReadback(...args);
  }

  // begin/stay/end contact listenerをbackend共通入口へ接続します
  onBeginContact(listener) { this.requireAlive(); return this.backend.onBeginContact(listener); }
  onStayContact(listener) { this.requireAlive(); return this.backend.onStayContact(listener); }
  onEndContact(listener) { this.requireAlive(); return this.backend.onEndContact(listener); }

  // CPU/Computeで同じ名前のqueryを提供し、各backendのquery結果を対応する形式で返します
  raycast(...args) { this.requireAlive(); return this.backend.raycast(...args); }
  raycastAll(...args) { this.requireAlive(); return this.backend.raycastAll(...args); }
  queryAabb(...args) { this.requireAlive(); return this.backend.queryAabb(...args); }
  overlapSphere(...args) { this.requireAlive(); return this.backend.overlapSphere(...args); }

  // Compute backendでだけ利用できることを明示します
  requireCompute() {
    this.requireAlive();
    if (this.kind !== "compute") throw new Error("user PhysicsSpace requires compute backend");
  }

  // facadeの状態を確認し、破棄済みfacadeへの操作を状態エラーとして通知します
  requireAlive() {
    if (this.destroyed) throw new Error("user PhysicsSpace is destroyed");
  }

  // bindingとbackendを依存順に破棄します
  destroy() {
    if (this.destroyed) return false;
    this.binding.destroy();
    this.backend.destroy();
    this.destroyed = true;
    return true;
  }
}
