// ---------------------------------------------
//  ProjectRuntime.js  2026/09/23
//   Compute physics and PBR frame coordination for general applications
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import util from "../../webg/util.js";
import { readNodeWorldPose } from "./project_app_helpers.js";
import { installCameraDofConstraint } from "./CameraDofConstraint.js";
import ProjectJointBindings, { readProjectAnchors, readProjectJointDefinitions } from "./ProjectJointBindings.js";

// Blender制作シーン、PBR renderer、Compute physicsを作品から一つのframe処理へ接続します
// 作品側はbody登録と作品固有の更新へ集中し、GPU commandとreadbackの順序を共通化します
export default class ProjectRuntime {
  // WebgApp、PbrRenderer、Compute PhysicsSpaceを受け取り、実行状態を作成します
  // rendererとphysicsの組を明示的に検証し、完全な初期化状態から実行を始めます
  constructor(options = {}) {
    const opts = util.readPlainObject(options, "ProjectRuntime options", {});
    if (!opts.app || typeof opts.app !== "object") {
      throw new Error("ProjectRuntime requires app");
    }
    if (!opts.renderer || typeof opts.renderer.createFrameCallbacks !== "function") {
      throw new Error("ProjectRuntime requires a PbrRenderer");
    }
    if (!opts.physics || opts.physics.kind !== "compute") {
      throw new Error("ProjectRuntime requires a Compute PhysicsSpace");
    }
    this.app = opts.app;
    this.renderer = opts.renderer;
    this.physics = opts.physics;
    this.label = util.readOptionalString(opts.label, "ProjectRuntime label", "project-runtime", {
      trim: true,
      allowEmpty: false
    });
    this.paused = util.readOptionalBoolean(opts.paused, `${this.label} paused`, true);
    this.stateReadbackBuffer = null;
    this.readbackPending = null;
    this.readbackQueued = false;
    this.initialReadback = true;
    this.resetEpoch = 0;
    this.frameIndex = 0;
    this.lastFixedSteps = 0;
    this.destroyed = false;
    this.prepared = false;
    this.projectJoints = null;
    this.cameraDofConstraint = null;
  }

  // NodeをCompute bodyへ登録し、PhysicsSpaceのbindingへ対応を保存します
  // body IDはbackendが採番し、作品側は返された安定した参照だけを保持します
  addBody(node, options = {}) {
    this.requireAlive();
    if (this.prepared) {
      throw new Error(`${this.label} addBody requires registration before prepare()`);
    }
    return this.physics.addBody(node, options);
  }

  // JointをCompute PhysicsSpaceへ登録し、bodyの対応とは別に管理します
  // Joint形式の検証とsolverへの変換はPhysicsSpaceへ委譲します
  addJoint(joint) {
    this.requireAlive();
    return this.physics.addJoint(joint);
  }

  // physics manifestのbody定義をModelAsset Nodeへ対応付けて登録します
  // manifestはNode IDとshape・materialを記述し、GPU body IDはruntimeが内部で管理します
  // spatialMatchとbody単位のcolliderRelationでlocal geometryとcolliderの意図を記録します
  // matchは一致を登録条件へ、proxyは差分を設計情報として保存します
  async addBodiesFromProject(project, modelRuntime, options = {}) {
    this.requireAlive();
    if (this.prepared) {
      throw new Error(`${this.label} addBodiesFromProject requires registration before prepare()`);
    }
    if (!project || typeof project.loadPhysics !== "function") {
      throw new Error(`${this.label} addBodiesFromProject requires a SceneProject`);
    }
    if (!modelRuntime || typeof modelRuntime.getNode !== "function") {
      throw new Error(`${this.label} addBodiesFromProject requires a model runtime`);
    }
    const opts = util.readPlainObject(options, `${this.label} addBodiesFromProject options`, {});
    for (const key of Object.keys(opts)) {
      if (key !== "spatialMatch") {
        throw new Error(`${this.label} addBodiesFromProject unknown option: ${key}`);
      }
    }
    const spatialMatch = util.readOptionalEnum(
      opts.spatialMatch,
      `${this.label} addBodiesFromProject spatialMatch`,
      "report",
      ["report", "require-match"]
    );
    const manifest = await project.loadPhysics();
    const bodies = manifest.bodies ?? [];
    if (!Array.isArray(bodies)) {
      throw new Error(`${this.label} physics.bodies must be an array`);
    }
    const result = [];
    const nodes = new Set();
    for (const body of bodies) {
      const definition = util.readPlainObject(body, `${this.label} physics body`, {});
      const nodeId = util.readOptionalString(
        definition.node,
        `${this.label} physics body.node`,
        undefined,
        { trim: true, allowEmpty: false }
      );
      if (nodes.has(nodeId)) {
        throw new Error(`${this.label} physics body.node is duplicated: ${nodeId}`);
      }
      nodes.add(nodeId);
      const node = modelRuntime.getNode(nodeId);
      const spatial = typeof modelRuntime.describeSpatial === "function"
        ? modelRuntime.describeSpatial(nodeId, definition.shape)
        : null;
      const colliderRelation = util.readOptionalEnum(
        definition.colliderRelation,
        `${this.label} physics body.colliderRelation`,
        undefined,
        ["match", "proxy"]
      );
      const anchors = readProjectAnchors(
        definition.anchors,
        `${this.label} physics body "${nodeId}" anchors`
      );
      // body単位の意図を優先し、proxyは差分を記録したうえで登録します
      const bodySpatialMatch = colliderRelation === "match"
        ? "require-match"
        : colliderRelation === "proxy" ? "report" : spatialMatch;
      if (bodySpatialMatch === "require-match" && spatial && !spatial.comparison.matched) {
        throw new Error(
          `${this.label} physics body "${nodeId}" spatial correspondence failed: `
          + spatial.comparison.reason
        );
      }
      const bodyOptions = { ...definition };
      delete bodyOptions.node;
      delete bodyOptions.anchors;
      delete bodyOptions.colliderRelation;
      if (typeof bodyOptions.id === "string") {
        bodyOptions.name = bodyOptions.id;
        delete bodyOptions.id;
      }
      // 親Nodeを持つModelAssetはworld姿勢でbodyへ登録し、readbackを同じ親のlocal姿勢へ戻します
      // 単独Nodeは従来のlocal姿勢を維持し、複合assetだけ変換境界を有効にします
      const parent = node.getParent?.() ?? null;
      const transformSpace = util.readOptionalEnum(
        definition.transformSpace,
        `${this.label} physics body "${nodeId}" transformSpace`,
        parent ? "world" : "local",
        ["local", "world"]
      );
      delete bodyOptions.transformSpace;
      if (parent && transformSpace === "local") {
        throw new Error(
          `${this.label} physics body "${nodeId}" transformSpace local requires a root Node; use world for a parent Node`
        );
      }
      if (transformSpace === "world") {
        const worldPose = readNodeWorldPose(
          node,
          `${this.label} physics body "${nodeId}" world pose`
        );
        bodyOptions.initialPose = {
          position: [...worldPose.position],
          orientation: [...worldPose.orientation]
        };
        bodyOptions.binding = { ...(bodyOptions.binding ?? {}), transformSpace: "world" };
      }
      const bodyId = this.addBody(node, bodyOptions);
      result.push(Object.freeze({
        id: definition.id ?? nodeId,
        nodeId,
        bodyId,
        node,
        shape: structuredClone(definition.shape),
        bodyType: definition.bodyType,
        spatial,
        transformSpace,
        colliderRelation: colliderRelation ?? null,
        anchors
      }));
    }
    return Object.freeze(result);
  }

  // physics manifestのjointsをModelAsset Nodeへ対応付け、全body登録後にまとめてcoreへ登録します
  // Joint endpointはbodyのIDまたはNode binding名とlocalPointで記述し、GPU slotを作品側へ漏らしません
  async addJointsFromProject(project, bodyBindings = []) {
    this.requireAlive();
    if (this.prepared) throw new Error(`${this.label} addJointsFromProject requires registration before prepare()`);
    if (!project || typeof project.loadPhysics !== "function") throw new Error(`${this.label} addJointsFromProject requires a SceneProject`);
    const manifest = await project.loadPhysics();
    const resolved = readProjectJointDefinitions(manifest, bodyBindings, this.label);
    if (this.projectJoints) this.projectJoints.clear(this.physics);
    this.projectJoints = new ProjectJointBindings(resolved.definitions, this.label);
    this.projectJoints.register(this.physics);
    return Object.freeze({ entries: this.projectJoints.getEntries(), capacity: resolved.capacity });
  }

  // GPU state readbackを作成し、frame callbackを利用できる準備状態へ移します
  // body登録が完了した後に一度呼び、以後の状態bufferを同じ順序で再利用します
  prepare() {
    this.requireAlive();
    if (this.prepared) return this;
    this.installCameraDofConstraint();
    this.stateReadbackBuffer = this.physics.createStateReadbackBuffer();
    this.prepared = true;
    this.initialReadback = true;
    return this;
  }

  // PbrRendererの公開DoF範囲をEyeRigのユーザ操作へ接続します
  // 設定値の直接指定や対象Nodeの外部移動は、PbrRendererの通常検証へ残して入力経路だけを制限します
  installCameraDofConstraint() {
    if (this.cameraDofConstraint) return this.cameraDofConstraint;
    const dof = this.renderer.getDiagnostics().dof;
    if (!dof?.enabled || dof.focusSource !== "camera") return null;
    if (!this.app.eyeRig) {
      throw new Error(`${this.label} DoF camera focus requires app.eyeRig`);
    }
    this.cameraDofConstraint = installCameraDofConstraint(this.app.eyeRig, {
      minFocusDistance: dof.rangeMeters
    });
    return this.cameraDofConstraint;
  }

  // 物理の進行状態を切り替え、表示とカメラの更新は継続できる状態にします
  // 初期状態では停止を選び、Start操作からCompute fixed stepを記録します
  setPaused(value) {
    this.requireAlive();
    this.paused = util.readOptionalBoolean(value, `${this.label} paused`, this.paused);
    return this.paused;
  }

  // 現在の停止状態を反転し、作品UIから一つの操作として呼べる結果を返します
  togglePaused() {
    return this.setPaused(!this.paused);
  }

  // 登録時のbody、Node、接触履歴、fixed step累積を初期状態へ戻します
  // 進行中readbackは世代番号で判別し、現在世代の結果だけを新しい状態へ適用します
  reset() {
    this.requireAlive();
    this.projectJoints?.clear(this.physics);
    this.physics.reset();
    this.projectJoints?.restore(this.physics);
    this.resetEpoch += 1;
    this.initialReadback = true;
    this.readbackQueued = false;
    this.lastFixedSteps = 0;
    this.frameIndex += 1;
    return this;
  }

  // PBR callbackへCompute fixed stepとreadback処理を接続したframe handlerを作成します
  // 描画、物理、GPU submitの順序を共通化し、作品側のframe管理を省略します
  createFrameCallbacks(options = {}) {
    this.requireAlive();
    this.prepare();
    const opts = util.readPlainObject(options, `${this.label} frame options`, {});
    const onUpdate = opts.onUpdate;
    const onReadback = opts.onReadback;
    const onError = opts.onError;
    const onPresented = opts.onPresented;
    if (onUpdate !== undefined && typeof onUpdate !== "function") {
      throw new Error(`${this.label} onUpdate must be a function`);
    }
    if (onReadback !== undefined && typeof onReadback !== "function") {
      throw new Error(`${this.label} onReadback must be a function`);
    }
    if (onError !== undefined && typeof onError !== "function") {
      throw new Error(`${this.label} onError must be a function`);
    }
    if (onPresented !== undefined && typeof onPresented !== "function") {
      throw new Error(`${this.label} onPresented must be a function`);
    }
    const rendererCallbacks = this.renderer.createFrameCallbacks(this.app, {
      renderScene: opts.renderScene,
      encode: opts.encode,
      onUpdate,
      onPresented,
      beforeRenderScene: (frame) => this.encodePhysics(frame),
      afterPresentPass: (frame) => {
        this.scheduleReadback(onReadback, onError, frame);
      }
    });
    return Object.freeze(rendererCallbacks);
  }

  // 現在frameのencoderへ物理fixed stepとstate copyを記録します
  // 物理状態のreadbackは描画用Nodeへ適用済みの世代と分け、次frameの表示へ渡します
  encodePhysics(frame) {
    this.requireReady();
    const deltaSec = util.readFiniteNumber(frame.deltaSec, `${this.label} frame deltaSec`, {
      min: 0.0
    });
    const commandEncoder = frame.screen?.getGPU?.()?.commandEncoder;
    if (!commandEncoder) {
      throw new Error(`${this.label} frame requires a command encoder`);
    }
    this.lastFixedSteps = this.paused
      ? 0
      : this.physics.step(deltaSec * 1000.0, { commandEncoder });
    if (this.readbackPending === null && (this.initialReadback || this.lastFixedSteps > 0)) {
      this.physics.encodeStateReadback(commandEncoder, this.stateReadbackBuffer);
      this.readbackQueued = true;
      this.initialReadback = false;
    }
    this.frameIndex += 1;
  }

  // WebgAppが現在frameをsubmitした後に、GPU state readbackを開始します
  // microtaskへ渡してpresentのqueue.submit完了後にmapAsyncを実行します
  scheduleReadback(onReadback, onError, frame) {
    if (!this.readbackQueued || this.readbackPending !== null) return;
    queueMicrotask(() => {
      this.queueReadback(onReadback, onError, frame);
    });
  }

  // 完了したreadbackをNode、contact event、作品callbackへ反映します
  // Reset前の世代結果は観測値として破棄し、次の初期readbackを待ちます
  queueReadback(onReadback, onError, frame) {
    if (!this.readbackQueued || this.readbackPending !== null) return;
    this.readbackQueued = false;
    const requestEpoch = this.resetEpoch;
    const requestFrame = this.frameIndex;
    const request = this.physics.readStateReadback(this.stateReadbackBuffer).then((stateData) => {
      if (requestEpoch !== this.resetEpoch || this.destroyed) return;
      this.physics.syncReadback(stateData);
      const contacts = this.physics.dispatchContactEventsFromReadback(stateData);
      if (typeof onReadback === "function") {
        onReadback({
          frame,
          frameIndex: requestFrame,
          stateData,
          contacts,
          fixedSteps: this.lastFixedSteps,
          physics: this.physics
        });
      }
    }, (error) => {
      if (this.destroyed) return;
      if (typeof onError === "function") {
        onError(error);
        return;
      }
      queueMicrotask(() => {
        throw error;
      });
    });
    this.readbackPending = request;
    request.then(() => {
      if (this.readbackPending === request) this.readbackPending = null;
    }, () => {
      if (this.readbackPending === request) this.readbackPending = null;
    });
  }

  // runtimeの状態を返し、作品UIや診断がGPU同期の進行を表示できるようにします
  getDiagnostics() {
    this.requireAlive();
    const projectJoints = this.projectJoints?.getEntries?.() ?? [];
    return Object.freeze({
      label: this.label,
      paused: this.paused,
      prepared: this.prepared,
      frameIndex: this.frameIndex,
      fixedSteps: this.lastFixedSteps,
      readbackPending: this.readbackPending !== null,
      readbackQueued: this.readbackQueued,
      resetEpoch: this.resetEpoch,
      jointCount: projectJoints.length,
      projectJoints,
      cameraDofConstraint: this.cameraDofConstraint?.getDiagnostics?.() ?? null
    });
  }

  // readback buffer、physics、rendererを依存順に解放し、runtimeを終了状態へ移します
  // 呼出側がresourceを共有する場合はownsPhysicsまたはownsRendererで解放範囲を指定します
  destroy(options = {}) {
    if (this.destroyed) return false;
    const opts = util.readPlainObject(options, `${this.label} destroy options`, {});
    const ownsPhysics = util.readOptionalBoolean(opts.ownsPhysics, `${this.label} ownsPhysics`, true);
    const ownsRenderer = util.readOptionalBoolean(opts.ownsRenderer, `${this.label} ownsRenderer`, true);
    this.cameraDofConstraint?.destroy?.();
    this.cameraDofConstraint = null;
    this.stateReadbackBuffer?.destroy?.();
    this.projectJoints?.clear(this.physics);
    if (ownsPhysics) this.physics.destroy?.();
    if (ownsRenderer) this.renderer.destroy?.();
    this.stateReadbackBuffer = null;
    this.destroyed = true;
    return true;
  }

  // runtimeが実行可能な状態であることを確認し、部分初期化を明示的に通知します
  requireReady() {
    this.requireAlive();
    if (!this.prepared || !this.stateReadbackBuffer) {
      throw new Error(`${this.label} requires prepare()`);
    }
  }

  // 破棄済みruntimeへの操作を状態エラーとして通知します
  requireAlive() {
    if (this.destroyed) throw new Error(`${this.label} is destroyed`);
  }
}
