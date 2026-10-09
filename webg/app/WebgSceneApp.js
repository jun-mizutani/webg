// ---------------------------------------------
//  WebgSceneApp.js  2026/09/22
//   Core user-facing WebgSceneApp entry for general PBR and Compute physics applications
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// webg core module
import WebgApp from "../WebgApp.js";
import SceneAsset from "../SceneAsset.js";
import ComputeParticleEmitter from "../ComputeParticleEmitter.js";
import { readSceneParticleEmitters } from "../ComputeParticleSettings.js";
import util from "../util.js";

// Core high-level WebgSceneApp module
import PbrRenderer from "./PbrRenderer.js";
import ScenePhysics from "./ScenePhysics.js";
import SceneFrame from "./SceneFrame.js";
import SceneDefinition from "./SceneDefinition.js";
import SceneAnimations from "./SceneAnimations.js";

// objectのキーを確認し、設定の書き間違いを別の項目へ渡さずに通知します
function requireKnownKeys(value, label, allowedKeys) {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`${label}.${key} is not supported`);
    }
  }
}

// project指定をURL、SceneDefinition、manifest objectの三つの入力形式から一つへ解決します
// 呼出側が選んだ入力形式を保持し、読み込み元URLによる相対参照をSceneDefinitionへ任せます
async function resolveProject(value) {
  if (typeof value === "string") return SceneDefinition.load(value);
  if (value instanceof SceneDefinition) return value;
  if (value instanceof SceneAsset) return value.toSceneDefinition();
  if (value && typeof value.validate === "function" && typeof value.getRendererOptions === "function") {
    return value;
  }
  return SceneDefinition.fromData(value, { sourceUrl: globalThis.location?.href });
}

// camera optionをWebgAppのorbit設定と高水準入口固有の焦点対象へ分けます
// focusTargetはNode IDまたはcreateSceneが返すNodeを受け取り、DoF対象を明示します
function readCameraOptions(value) {
  const camera = util.readPlainObject(value, "WebgSceneApp camera", {});
  requireKnownKeys(camera, "WebgSceneApp camera", new Set([
    "rigName",
    "rodName",
    "eyeName",
    "target",
    "distance",
    "yaw",
    "pitch",
    "roll",
    "smooth",
    "inheritTargetYaw",
    "targetYawOffset",
    "minDistance",
    "maxDistance",
    "wheelZoomStep",
    "keyMap",
    "orbit",
    "orbitKeyMap",
    "panModifierKey",
    "rollModifierKey",
    "dragZoomModifierKey",
    "alternateDragButton",
    "alternateDragModifierKey",
    "focusTarget",
    "focusTargetOffset"
  ]));
  const focusTargetOffset = camera.focusTargetOffset === undefined
    ? [0.0, 0.0, 0.0]
    : util.readVec3(camera.focusTargetOffset, "WebgSceneApp camera.focusTargetOffset");
  const focusTarget = camera.focusTarget;
  if (focusTarget !== undefined
    && typeof focusTarget !== "string"
    && typeof focusTarget?.getWorldMatrix !== "function") {
    throw new Error("WebgSceneApp camera.focusTarget must be a Node ID or Node");
  }
  const orbit = { ...camera };
  delete orbit.focusTarget;
  delete orbit.focusTargetOffset;
  return Object.freeze({
    orbit: Object.freeze(orbit),
    focusTarget,
    focusTargetOffset: Object.freeze([...focusTargetOffset])
  });
}

// physics optionをCompute backendの有効状態、空間照合方法、初期停止状態へ整理します
// manifestにphysicsを記述した場合はCompute physicsを選び、明示的なfalseだけが物理を外します
function readPhysicsOptions(value, project) {
  const manifestHasPhysics = project.manifest.physics !== undefined
    || project.manifest.physicsUrl !== undefined;
  if (value === false) {
    return Object.freeze({ enabled: false, spatialMatch: "require-match", paused: true });
  }
  if (value === true || value === undefined) {
    return Object.freeze({
      enabled: value === true || manifestHasPhysics,
      spatialMatch: "require-match",
      paused: true
    });
  }
  const physics = util.readPlainObject(value, "WebgSceneApp physics", {});
  requireKnownKeys(physics, "WebgSceneApp physics", new Set(["enabled", "spatialMatch", "paused"]));
  return Object.freeze({
    enabled: util.readOptionalBoolean(physics.enabled, "WebgSceneApp physics.enabled", true),
    spatialMatch: util.readOptionalEnum(
      physics.spatialMatch,
      "WebgSceneApp physics.spatialMatch",
      "require-match",
      ["report", "require-match"]
    ),
    paused: util.readOptionalBoolean(physics.paused, "WebgSceneApp physics.paused", true)
  });
}

// 画面効果のframe flagを意味のある四項目へ整理します
// profileの既定値を使い、個別に指定された効果だけを上書きします
function readEffectOptions(value, dofDefault) {
  const effects = util.readPlainObject(value, "WebgSceneApp effects", {});
  requireKnownKeys(effects, "WebgSceneApp effects", new Set(["shadow", "ssao", "ssr", "dof"]));
  return Object.freeze({
    shadow: util.readOptionalBoolean(effects.shadow, "WebgSceneApp effects.shadow", true),
    ssao: util.readOptionalBoolean(effects.ssao, "WebgSceneApp effects.ssao", true),
    ssr: util.readOptionalBoolean(effects.ssr, "WebgSceneApp effects.ssr", true),
    dof: util.readOptionalBoolean(effects.dof, "WebgSceneApp effects.dof", dofDefault)
  });
}

// Scene runtimeの実装差を、Node IDからNodeを取得する一つの確認形式へそろえます
// 制作シーン、SceneAsset、createSceneのいずれでも物理bindingと焦点対象の参照を同じ方法で解決します
function createNodeResolver(scene, label) {
  if (typeof scene.getNode === "function") return scene.getNode.bind(scene);
  if (scene.modelRuntime && typeof scene.modelRuntime.getNode === "function") {
    return scene.modelRuntime.getNode.bind(scene.modelRuntime);
  }
  if (scene.runtime && typeof scene.runtime.getNode === "function") {
    return scene.runtime.getNode.bind(scene.runtime);
  }
  if (scene.nodes instanceof Map) {
    return (reference) => {
      const node = scene.nodes.get(String(reference));
      if (!node) throw new Error(`${label} scene node is unavailable: ${reference}`);
      return node;
    };
  }
  if (scene.nodes && typeof scene.nodes === "object") {
    return (reference) => {
      const node = scene.nodes[String(reference)];
      if (!node) throw new Error(`${label} scene node is unavailable: ${reference}`);
      return node;
    };
  }
  return null;
}

// WebgApp、PbrRenderer、SceneFrame、SceneDefinitionを一つの利用者向け入口へまとめます
// projectデータと作品固有callbackの境界を保ち、GPU commandやreadbackの処理順を内部へ集約します
export default class WebgSceneApp {
  // create()から呼ばれ、初期化前の入力とresourceを保持します
  // 実行状態はcreate()の完了後にreadyとなり、利用者へ完全な初期化結果を返します
  constructor(options = {}) {
    const source = util.readPlainObject(options, "WebgSceneApp options", {});
    requireKnownKeys(source, "WebgSceneApp options", new Set([
      "project",
      "document",
      "renderMode",
      "camera",
      "physics",
      "effects",
      "paused",
      "timeScale",
      "label",
      "createScene",
      "onUpdate",
      "onReadback",
      "onPresented",
      "onError"
    ]));
    if (source.project === undefined) {
      throw new Error("WebgSceneApp project is required");
    }
    for (const key of ["createScene", "onUpdate", "onReadback", "onPresented", "onError"]) {
      if (source[key] !== undefined && typeof source[key] !== "function") {
        throw new Error(`WebgSceneApp ${key} must be a function`);
      }
    }
    this.options = source;
    this.renderMode = util.readOptionalEnum(
      source.renderMode,
      "WebgSceneApp renderMode",
      "ondemand",
      ["ondemand", "continuous"],
      { lowerCase: true }
    );
    this.label = util.readOptionalString(source.label, "WebgSceneApp label", "scene-app", {
      trim: true,
      allowEmpty: false
    });
    this.document = source.document ?? globalThis.document;
    this.camera = readCameraOptions(source.camera);
    this.timeScale = util.readOptionalFiniteNumber(
      source.timeScale,
      "WebgSceneApp timeScale",
      1.0,
      { minExclusive: 0.0, max: 4.0 }
    );
    this.createSceneCallback = source.createScene ?? null;
    this.physicsOptions = null;
    this.effectOptions = null;
    this.project = null;
    this.app = null;
    this.renderer = null;
    this.physics = null;
    this.runtime = null;
    this.scene = null;
    this.model = null;
    this.animations = null;
    this.particleEmitters = new Map();
    this.bodyBindings = Object.freeze([]);
    this.frameCallbacks = null;
    this.focusTarget = null;
    this.lastReadback = null;
    this.lastError = null;
    this.running = false;
    this.destroyed = false;
  }

  // projectを読み込み、scene、renderer、physics、frame callbackを順に作成します
  // 初期化の段階ごとにresourceを確定し、失敗時は作成済みresourceを依存順で解放します
  static async create(options = {}) {
    const instance = new WebgSceneApp(options);
    try {
      await instance.initialize();
      return instance;
    } catch (error) {
      instance.destroy();
      throw error;
    }
  }

  // 高水準入口の初期化順を固定し、利用者側へはready状態だけを返します
  // projectのrenderer設定を先に検証し、WebgAppとGPU resourceへ同じ寸法を渡します
  async initialize() {
    this.project = await resolveProject(this.options.project);
    this.project.validate();
    const rendererOptions = this.project.getRendererOptions();
    this.physicsOptions = readPhysicsOptions(this.options.physics, this.project);

    this.app = new WebgApp({
      document: this.document,
      autoDrawScene: false,
      useMessage: false,
      renderMode: this.renderMode,
      clearColor: rendererOptions.clearColor,
      layoutMode: "embedded",
      fixedCanvasSize: {
        width: rendererOptions.width,
        height: rendererOptions.height,
        useDevicePixelRatio: false
      },
      camera: this.camera.orbit
    });
    await this.app.init();
    this.scene = await this.buildScene();
    this.renderer = new PbrRenderer(this.app.getGPU(), rendererOptions);
    await this.renderer.waitUntilReady();
    this.effectOptions = readEffectOptions(
      this.options.effects,
      this.renderer.getDiagnostics().dof?.enabled === true
    );
    this.installCamera();
    await this.buildPhysics();
    this.runtime?.setTimeScale(this.timeScale);
    this.animations = new SceneAnimations(
      this.project.manifest.animations,
      this.scene.getNode,
      this.bodyBindings.map(binding => binding.node)
    );
    for (const definition of readSceneParticleEmitters(this.project.manifest.particleEmitters)) {
      const emitter = await this.createComputeParticleEmitter(definition.options, definition.id);
      if (definition.emission !== undefined) emitter.startEmission(definition.emission);
    }
    this.frameCallbacks = this.createFrameCallbacks();
    return this;
  }

  // projectのModelAsset、SceneAsset、または利用者のcreateScene callbackから表示Nodeを作ります
  // sceneの種類を記録し、Node参照と材質適用結果を高水準APIの状態へ保持します
  async buildScene() {
    const manifest = this.project.manifest;
    const hasModel = manifest.modelAsset !== undefined
      || manifest.modelAssetUrl !== undefined
      || manifest.sceneAsset !== undefined
      || manifest.sceneAssetUrl !== undefined;
    const hasScene = manifest.scene !== undefined || manifest.sceneUrl !== undefined;
    const hasObjects = manifest.objects !== undefined || manifest.objectSets !== undefined;
    if (hasModel && hasScene) {
      throw new Error(`${this.label} project must choose one scene asset source`);
    }
    if (hasObjects && hasScene) {
      throw new Error(`${this.label} project must choose objects, objectSets, or one scene asset source`);
    }
    if (hasModel && this.createSceneCallback) {
      throw new Error(`${this.label} createScene cannot be combined with a scene asset`);
    }
    if (hasScene && this.createSceneCallback) {
      throw new Error(`${this.label} createScene cannot be combined with scene`);
    }
    if (hasObjects && this.createSceneCallback) {
      throw new Error(`${this.label} createScene cannot be combined with objects`);
    }
    if (hasModel) {
      this.model = await this.project.buildModelRuntime(this.app);
      const appliedMaterials = await this.project.applyMaterials(this.model);
      return Object.freeze({
        kind: "model",
        modelRuntime: this.model,
        entries: this.model.entries,
        materialApplications: Object.freeze(appliedMaterials),
        getNode: this.model.getNode
      });
    }
    if (hasScene) {
      const runtime = await this.project.build(this.app);
      return Object.freeze({
        kind: "scene",
        runtime,
        getNode: createNodeResolver({ runtime }, `${this.label} scene`)
      });
    }
    if (hasObjects) {
      return await this.project.buildPrimitiveScene(this.app);
    }
    if (this.createSceneCallback) {
      const created = await this.createSceneCallback({ app: this.app, project: this.project });
      const scene = util.readPlainObject(created, `${this.label} createScene result`, {});
      requireKnownKeys(scene, `${this.label} createScene result`, new Set([
        "kind",
        "runtime",
        "modelRuntime",
        "nodes",
        "getNode"
      ]));
      const getNode = createNodeResolver(scene, `${this.label} scene`);
      return Object.freeze({ ...scene, kind: scene.kind ?? "callback", getNode });
    }
    throw new Error(`${this.label} requires objects, a scene asset, scene, or createScene`);
  }

  // rendererのDoF設定とcamera.focusTargetを接続し、Orbit EyeRigを作成します
  // 合焦対象はNode IDまたはNodeで明示し、指定対象へ焦点を接続します
  installCamera() {
    const focus = this.renderer.getDiagnostics().dof;
    const focusReference = this.camera.focusTarget;
    if (focus?.enabled) {
      if (focusReference === undefined) {
        throw new Error(`${this.label} camera.focusTarget is required when renderer DoF is enabled`);
      }
      this.focusTarget = typeof focusReference === "string"
        ? this.scene.getNode?.(focusReference)
        : focusReference;
      if (!this.focusTarget || typeof this.focusTarget.getWorldMatrix !== "function") {
        throw new Error(`${this.label} camera.focusTarget is unavailable: ${String(focusReference)}`);
      }
    }
    const focusOptions = focus?.enabled
      ? {
        enabled: true,
        mode: "node",
        targetNode: this.focusTarget,
        targetOffset: [...this.camera.focusTargetOffset]
      }
      : undefined;
    this.app.createOrbitEyeRig({ ...this.camera.orbit, focus: focusOptions });
  }

  // project physics manifestをCompute PhysicsSpaceへ渡し、Node bindingとJointを登録します
  // backend選択、GPU ID、fixed step、readback bufferは利用者コードから分離します
  async buildPhysics() {
    if (!this.physicsOptions.enabled) return;
    const physicsManifest = await this.project.loadPhysics();
    if (!physicsManifest.space || typeof physicsManifest.space !== "object") {
      throw new Error(`${this.label} physics.space is required`);
    }
    this.physics = new ScenePhysics({
      gpu: this.app.getGPU(),
      ...physicsManifest.space
    });
    this.runtime = new SceneFrame({
      app: this.app,
      renderer: this.renderer,
      physics: this.physics,
      label: this.label,
      paused: this.options.paused ?? this.physicsOptions.paused
    });
    const modelRuntime = this.scene.modelRuntime ?? this.scene;
    if (typeof modelRuntime.getNode !== "function") {
      throw new Error(`${this.label} physics requires a scene with Node lookup`);
    }
    this.bodyBindings = await this.runtime.addBodiesFromDefinition(
      this.project,
      modelRuntime,
      { spatialMatch: this.physicsOptions.spatialMatch }
    );
    const joints = physicsManifest.joints ?? [];
    if (!Array.isArray(joints)) {
      throw new Error(`${this.label} physics.joints must be an array`);
    }
    if (joints.length > 0) {
      await this.runtime.addJointsFromDefinition(this.project, this.bodyBindings);
    }
  }

  // PBRだけのframe処理と、Compute physicsを含むframe処理を同じcallback構造へ接続します
  // 利用者callbackへは作品固有のイベントだけを渡し、GPU処理順はWebgSceneAppが保持します
  createFrameCallbacks() {
    const callbackOptions = {
      renderScene: { shadowEnabled: this.effectOptions.shadow },
      encode: {
        lights: [],
        lightCount: 0,
        shadowEnabled: this.effectOptions.shadow,
        ssaoEnabled: this.effectOptions.ssao,
        ssrEnabled: this.effectOptions.ssr,
        dofEnabled: this.effectOptions.dof
      },
      onUpdate: (frame) => {
        this.animations?.update(frame.deltaSec * this.timeScale);
        this.options.onUpdate?.({ ...frame, sceneApp: this });
        for (const emitter of this.particleEmitters.values()) {
          if (!emitter.destroyed) emitter.setTimeScale(this.timeScale);
        }
      },
      onPresented: (payload) => {
        if (typeof this.options.onPresented === "function") {
          this.options.onPresented({ ...payload, sceneApp: this });
        }
      }
    };
    if (this.runtime) {
      return this.runtime.createFrameCallbacks({
        ...callbackOptions,
        onReadback: (payload) => {
          this.lastReadback = Object.freeze({
            frameIndex: payload.frameIndex,
            fixedSteps: payload.fixedSteps,
            contactBegin: payload.contacts.begin.length,
            contactStay: payload.contacts.stay.length,
            contactEnd: payload.contacts.end.length
          });
          if (typeof this.options.onReadback === "function") {
            this.options.onReadback({ ...payload, sceneApp: this });
          }
        },
        onError: (error) => this.handleRuntimeError(error)
      });
    }
    return this.renderer.createFrameCallbacks(this.app, callbackOptions);
  }

  // readbackまたはframeのエラーを保存し、利用者へ明示的に通知します
  // callback未指定時は非同期例外として再送出し、エラーを明示的な失敗状態へ伝えます
  handleRuntimeError(error) {
    this.lastError = error;
    if (typeof this.options.onError === "function") {
      this.options.onError(error);
      return;
    }
    queueMicrotask(() => { throw error; });
  }

  // frame loopを開始し、利用者が作品固有の入力やイベントを追加できるready状態へ移します
  start() {
    this.requireAlive();
    if (this.running) return this;
    this.app.start(this.frameCallbacks);
    this.running = true;
    return this;
  }

  // frame loopを停止し、GPU resourceを保持したまま再開できる状態へ移します
  stop() {
    this.requireAlive();
    this.app.stop();
    this.running = false;
    return this;
  }

  // Compute physicsの停止状態を切り替えます
  // PBRだけのappで物理操作を呼び出した場合は、利用者が機能選択を確認できる状態エラーを返します
  setPaused(value) {
    this.requireAlive();
    if (!this.runtime) throw new Error(`${this.label} setPaused requires enabled Compute physics`);
    this.runtime.setPaused(value);
    return this;
  }

  // 物理とSceneYAML animationへ同じ時間倍率を渡し、速度UIを一つの入口へまとめます
  // 1.0を標準速度として、0.5や0.25では動きとエミッターの時間をゆっくり進めます
  setTimeScale(value) {
    this.requireAlive();
    this.timeScale = util.readFiniteNumber(value, `${this.label} timeScale`, {
      minExclusive: 0.0,
      max: 4.0
    });
    this.runtime?.setTimeScale(this.timeScale);
    return this;
  }

  // 現在の速度倍率を返し、MakerやPlayerの表示とスケジューラへ同じ値を渡します
  getTimeScale() {
    this.requireAlive();
    return this.timeScale;
  }

  // 物理appはbody姿勢とreadback世代を戻し、PBR専用appはframe loopを初期状態へ再開します
  // どちらのprojectでもStart／Stop／Resetを同じ作品UIから確認できる入口にします
  reset() {
    this.requireAlive();
    this.resetAnimations();
    // 粒子は発生設定を保ち、前のシーン状態に残っていた粒子と予約を消す
    for (const emitter of this.particleEmitters.values()) {
      if (!emitter.destroyed) emitter.clear();
    }
    if (!this.runtime) {
      this.stop();
      this.start();
      return this;
    }
    this.runtime.reset();
    this.lastReadback = null;
    return this;
  }

  // 登録済みanimation clipのID一覧を返し、作品UIの選択肢へ利用できる状態にします
  getAnimationIds() { this.requireAlive(); return this.animations?.getIds() ?? []; }

  // animation機能が初期化済みであることを確認し、clip操作の共通入口を返します
  requireAnimations() {
    this.requireAlive();
    if (!this.animations) throw new Error(`${this.label} animation operations require initialized app`);
    return this.animations;
  }

  // 指定clipの時刻、再生状態、loop状態を読みます
  getAnimationState(id) { return this.requireAnimations().getState(id); }

  // 指定clipを先頭から再生し、操作結果を状態snapshotで返します
  playAnimation(id, options = {}) { return this.requireAnimations().play(id, options); }

  // 指定clipを現在時刻で一時停止します
  pauseAnimation(id) { return this.requireAnimations().pause(id); }

  // 一時停止中のclipを現在時刻から再開します
  resumeAnimation(id) { return this.requireAnimations().resume(id); }

  // 指定clipを停止状態へ戻し、現在の姿勢を保持します
  stopAnimation(id) { return this.requireAnimations().stop(id); }

  // 指定clipを秒単位の時刻へ移動し、移動後の姿勢をNodeへ反映します
  seekAnimation(id, seconds) { return this.requireAnimations().seek(id, seconds); }

  // 全clipを停止し、各Nodeを登録時の基準姿勢へ戻します
  resetAnimations() {
    this.requireAlive();
    this.animations?.reset();
    return this;
  }

  // 作品固有の接触処理をScenePhysicsの公開イベントへ接続します
  // Compute readbackで確定した接触時点をWebgSceneAppから渡します
  onBeginContact(listener) {
    this.requireAlive();
    if (!this.physics) throw new Error(`${this.label} onBeginContact requires enabled Compute physics`);
    return this.physics.onBeginContact(listener);
  }

  // 解決済みproject、renderer、physics、readbackの状態を利用者向けに返します
  // 内部GPU objectではなく、設定と対応関係を調べられる値へ限定します
  getDiagnostics() {
    this.requireAlive();
    const physicsDiagnostics = this.runtime?.getDiagnostics() ?? null;
    const projectEntries = this.scene?.kind === "primitive" ? (this.scene.entries ?? []) : [];
    return Object.freeze({
      label: this.label,
      running: this.running,
      timeScale: this.timeScale,
      animations: this.getAnimationIds().map(id => this.animations.getState(id)),
      project: {
        name: this.project.label,
        version: this.project.version,
        sceneKind: this.scene?.kind ?? null,
        modelNodeCount: this.scene?.entries?.length ?? null,
        objectCount: projectEntries.length > 0
          ? projectEntries.length
          : Array.isArray(this.project.manifest.objects)
            ? this.project.manifest.objects.length
            : null,
        objectSetCount: Array.isArray(this.project.manifest.objectSets)
          ? this.project.manifest.objectSets.length
          : 0,
        objectIds: projectEntries.length > 0
          ? projectEntries.map((entry) => entry.id)
          : Array.isArray(this.project.manifest.objects)
            ? this.project.manifest.objects.map((entry) => entry.id)
            : [],
        objectSources: projectEntries.map((entry) => ({
          id: entry.id,
          source: entry.source ?? { type: "object" }
        })),
        materialApplications: this.scene?.materialApplications?.length ?? 0,
        materialBindings: this.scene?.materialApplications?.map((application) => ({
          assetMaterialId: application.assetMaterialId,
          materialId: application.materialId,
          kind: application.kind,
          preset: application.preset,
          uvMapping: application.uvMapping,
          nodeCount: application.nodeCount,
          shapeCount: application.shapeCount
        })) ?? []
      },
      renderer: this.renderer.getDiagnostics(),
      physics: physicsDiagnostics
        ? {
          ...physicsDiagnostics,
          bodyCount: this.physics.getBodies().length,
          bindingCount: this.bodyBindings.length,
          bindings: this.bodyBindings.map((binding) => ({
            id: binding.id,
            nodeId: binding.nodeId,
            bodyId: binding.bodyId,
            shape: binding.shape,
            colliderRelation: binding.colliderRelation,
            transformSpace: binding.transformSpace,
            materialId: binding.materialId
          }))
        }
        : null,
      lastReadback: this.lastReadback,
      lastError: this.lastError?.message ?? null
    });
  }

  // 標準粒子をPBRへ登録し、アプリ終了時の解放対象へ加える
  // idを指定するとSceneYAMLで定義した粒子と同じ方法で参照できる
  async createComputeParticleEmitter(options = {}, id = undefined) {
    this.requireAlive();
    if (!this.renderer?.pipeline) throw new Error("particle creation requires initialized PBR renderer");
    const key = id === undefined ? Symbol("particle-emitter")
      : util.readOptionalString(id, "particle emitter id", undefined, { allowEmpty: false });
    if (this.particleEmitters.has(key)) throw new Error(`duplicate particle emitter id: ${String(key)}`);
    const emitter = new ComputeParticleEmitter(this.app.getGPU(), options);
    this.particleEmitters.set(key, emitter);
    try {
      await this.renderer.pipeline.addParticleEmitter(emitter);
      this.requireAlive();
      emitter.setTimeScale(this.timeScale);
      return emitter;
    } catch (error) {
      this.particleEmitters.delete(key);
      emitter.destroy();
      throw error;
    }
  }

  // SceneYAMLまたは登録時に付けたidから発生装置を取得する
  getComputeParticleEmitter(id) {
    this.requireAlive();
    const emitter = this.particleEmitters.get(id);
    if (!emitter || emitter.destroyed) throw new Error(`unknown particle emitter: ${id}`);
    return emitter;
  }

  // app、runtime、renderer、projectを依存順に解放し、終了状態を固定します
  // destroy後の利用者操作は状態エラーとして確認できます
  destroy() {
    if (this.destroyed) return false;
    this.app?.stop?.();
    this.running = false;
    for (const emitter of this.particleEmitters.values()) emitter.destroy();
    this.particleEmitters.clear();
    this.animations?.destroy();
    this.animations = null;
    if (this.runtime) {
      this.runtime.destroy({ ownsPhysics: true, ownsRenderer: true });
    } else {
      this.renderer?.destroy?.();
    }
    this.scene?.runtime?.destroy?.();
    this.model?.runtime?.destroy?.();
    this.project?.destroy?.();
    this.runtime = null;
    this.physics = null;
    this.renderer = null;
    this.scene = null;
    this.model = null;
    this.project = null;
    this.frameCallbacks = null;
    this.destroyed = true;
    return true;
  }

  // 破棄済みappへの操作を状態エラーとして通知します
  requireAlive() {
    if (this.destroyed) throw new Error(`${this.label} is destroyed`);
  }
}

// 関数形式の入口を用意し、短い利用者コードからreadyなWebgSceneAppを作れるようにします
// public nameはWebgSceneApp.createとし、短い関数形式も同じ初期化契約へ接続します
export async function createWebgSceneApp(options = {}) {
  return WebgSceneApp.create(options);
}
