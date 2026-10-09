// ---------------------------------------------
//  ScenePhysics.js  2026/09/10
//   High-level facade for Compute-first physics selection
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import util from "../util.js";
import ComputePhysicsBackend from "./ComputePhysicsBackend.js";
import CpuPhysicsBackend from "./CpuPhysicsBackend.js";
import PhysicsBinding from "./PhysicsBinding.js";

// Compute backendを標準とし、確認用にCPU backendも選択できる高水準ScenePhysics入口です
// 公開向けの物理設定と低水準backendの接続点を一か所へまとめます
export default class ScenePhysics {
  // backendを明示的に選び、対応するresourceとNode bindingを生成します
  // Compute選択時はGPU contextを受け取り、入力の不足を初期化エラーとして通知します
  constructor(options = {}) {
    const opts = util.readPlainObject(options, "ScenePhysics options", {});
    const backendName = util.readOptionalEnum(
      opts.backend,
      "ScenePhysics backend",
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

  // 実行中に追加したCompute bodyをphysicsとNodeの対応表から同時に外します
  // Reset対象の初期bodyと、エミッターが生成した一時bodyを分けて管理します
  removeBody(bodyId) {
    this.requireAlive();
    this.requireCompute();
    const removed = this.backend.removeBody(bodyId);
    this.binding.unbind(bodyId);
    return removed;
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

  // 登録済みのJointを選択中backendから取り外します
  removeJoint(joint) { this.requireAlive(); return this.backend.removeJoint(joint); }

  // CPUはdeltaMsだけで進め、Computeはoptions.commandEncoderへ同じframeのencoderを指定します
  // API差分をbackendごとに明示し、Compute時のencoder不足を呼出側のエラーとして扱います
  step(deltaMs, options = {}) {
    this.requireAlive();
    if (this.kind === "cpu") {
      if (options.commandEncoder !== undefined) {
        throw new Error("ScenePhysics CPU step must not receive commandEncoder");
      }
      return this.backend.step(deltaMs);
    }
    const opts = util.readPlainObject(options, "ScenePhysics Compute step options", {});
    if (!opts.commandEncoder) {
      throw new Error("ScenePhysics Compute step requires options.commandEncoder");
    }
    const { commandEncoder, ...encodeOptions } = opts;
    return this.backend.step(commandEncoder, deltaMs, encodeOptions);
  }

  // Compute frame ownerがstep前後にGPU copyを記録できるよう明示入口を返します
  // readback bufferを作成し、後続のencodeStateReadback()で再利用できるようにします
  createStateReadbackBuffer(...args) { this.requireCompute(); return this.backend.createStateReadbackBuffer(...args); }

  // 同じcommand encoderへGPU stateのcopy命令を記録します
  encodeStateReadback(...args) { this.requireCompute(); return this.backend.encodeStateReadback(...args); }

  // submit後にGPU stateをCPUへ読み戻し、姿勢同期や診断へ渡します
  async readStateReadback(...args) { this.requireCompute(); return this.backend.readStateReadback(...args); }

  // physics stateをbindingへ同期します
  sync() {
    this.requireAlive();
    if (this.kind === "cpu") return this.binding.syncCpu();
    throw new Error("ScenePhysics Compute sync requires readback Float32Array; use syncReadback()");
  }

  // kinematic/static Nodeの操作結果をCPU physics bodyへ明示的に戻します
  // ComputeのGPU control command仕様が確定するまで、CPU専用APIとして区別します
  syncFromNodes() {
    this.requireAlive();
    if (this.kind !== "cpu") {
      throw new Error("ScenePhysics Compute syncFromNodes is not implemented");
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
      throw new Error("ScenePhysics reset requires compute backend");
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
      throw new Error("ScenePhysics resetBody requires compute backend");
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

  // 現在のbackendが管理するbody一覧を返します
  getBodies() { this.requireAlive(); return this.backend.getBodies(); }

  // 直近の接触結果をbackend共通の形式で返します
  getLastContacts() { this.requireAlive(); return this.backend.getLastContacts(); }

  // 直近の接触点集合をbackend共通の形式で返します
  getLastManifolds() { this.requireAlive(); return this.backend.getLastManifolds(); }

  // 直近の接触イベント列をbackend共通の形式で返します
  getLastContactEvents() { this.requireAlive(); return this.backend.getLastContactEvents(); }

  // Compute readback配列から通常のbody接触を抽出します
  getContactsFromReadback(...args) {
    this.requireCompute();
    return this.backend.getContactsFromReadback(...args);
  }

  // Compute readbackで確定した接触イベントをbackendの通知経路へ渡します
  dispatchContactEventsFromReadback(...args) {
    this.requireCompute();
    return this.backend.dispatchContactEventsFromReadback(...args);
  }

  // Compute readback配列からPlane接触だけを抽出し、床接触の診断へ渡します
  getPlaneContactsFromReadback(...args) {
    this.requireCompute();
    return this.backend.getPlaneContactsFromReadback(...args);
  }

  // begin/stay/end contact listenerをbackend共通入口へ接続します
  onBeginContact(listener) { this.requireAlive(); return this.backend.onBeginContact(listener); }

  // 継続中の接触を通知するlistenerをbackendへ登録します
  onStayContact(listener) { this.requireAlive(); return this.backend.onStayContact(listener); }

  // 接触終了を通知するlistenerをbackendへ登録します
  onEndContact(listener) { this.requireAlive(); return this.backend.onEndContact(listener); }

  // CPU/Computeで同じ名前のqueryを提供し、各backendのquery結果を対応する形式で返します
  raycast(...args) { this.requireAlive(); return this.backend.raycast(...args); }

  // 交差した全bodyを返すray queryをbackendへ渡します
  raycastAll(...args) { this.requireAlive(); return this.backend.raycastAll(...args); }

  // 軸平行箱と重なるbodyをbackendへ問い合わせます
  queryAabb(...args) { this.requireAlive(); return this.backend.queryAabb(...args); }

  // 球範囲と重なるbodyをbackendへ問い合わせます
  overlapSphere(...args) { this.requireAlive(); return this.backend.overlapSphere(...args); }

  // Compute backendでだけ利用できることを明示します
  requireCompute() {
    this.requireAlive();
    if (this.kind !== "compute") throw new Error("ScenePhysics requires compute backend");
  }

  // facadeの状態を確認し、破棄済みfacadeへの操作を状態エラーとして通知します
  requireAlive() {
    if (this.destroyed) throw new Error("ScenePhysics is destroyed");
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
