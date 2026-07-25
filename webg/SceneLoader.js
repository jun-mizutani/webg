// ---------------------------------------------
//  SceneLoader.js   2026/05/06
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import Primitive from "./Primitive.js";
import ModelAsset from "./ModelAsset.js";
import Matrix from "./Matrix.js";
import Quat from "./Quat.js";
import PhysicsSpace from "./PhysicsSpace.js";
import BoxCollider from "./BoxCollider.js";
import PlaneCollider from "./PlaneCollider.js";
import SphereCollider from "./SphereCollider.js";
import CapsuleCollider from "./CapsuleCollider.js";
import SceneValidator from "./SceneValidator.js";
import util from "./util.js";

export default class SceneLoader {

  // Scene JSON から app / space 上の実体を組み立てる
  constructor(target = {}) {
    // WebgApp を直接渡すケースを最優先にしつつ、
    // 必要最小限の { gpu, space } でも使えるようにしておく
    const looksLikeWebgApp =
      typeof target?.getGPU === "function" &&
      target?.screen &&
      target?.space;

    this.app = looksLikeWebgApp ? target : null;
    this.gpu = looksLikeWebgApp
      ? this.app.getGPU()
      : (target?.gpu ?? null);
    this.space = looksLikeWebgApp
      ? this.app.space
      : (target?.space ?? null);
    this.physicsSpace = target?.physicsSpace ?? null;
    this.scene = null;
    this.validator = new SceneValidator();
  }

  // JSON で受けた transform を Node 用 Matrix へ変換する
  // rotation は [x, y, z, w] quaternion で受け取り、
  // webg 内部の Quat 順序 [w, x, y, z] へ並べ替えてから行列化する
  matrixFromTransform(transform = {}) {
    if (!transform || typeof transform !== "object" || Array.isArray(transform)) {
      throw new Error("scene node transform must be an object");
    }
    const translation = transform.translation;
    const rotation = transform.rotation;
    const scale = transform.scale;
    if (!Array.isArray(translation) || translation.length < 3 || translation.some((value) => !Number.isFinite(value))) {
      throw new Error("scene node transform.translation must be a finite vec3");
    }
    if (!Array.isArray(rotation) || rotation.length < 4 || rotation.some((value) => !Number.isFinite(value))) {
      throw new Error("scene node transform.rotation must be a finite quat [x, y, z, w]");
    }
    if (!Array.isArray(scale) || scale.length < 3 || scale.some((value) => !Number.isFinite(value))) {
      throw new Error("scene node transform.scale must be a finite vec3");
    }
    const quat = new Quat();
    const mat = new Matrix();
    quat.q = [rotation[3], rotation[0], rotation[1], rotation[2]];
    mat.makeUnit();
    mat.setByQuat(quat);
    mat.mat[0] *= scale[0];
    mat.mat[1] *= scale[0];
    mat.mat[2] *= scale[0];
    mat.mat[4] *= scale[1];
    mat.mat[5] *= scale[1];
    mat.mat[6] *= scale[1];
    mat.mat[8] *= scale[2];
    mat.mat[9] *= scale[2];
    mat.mat[10] *= scale[2];
    mat.position(translation);
    return mat;
  }

  // HUD 行は x / y / text / color をすべて明示した object のみ受け付ける
  // ここで不足値を補わず、scene 側の記述漏れをその場で検出できるようにする
  normalizeHudLines(lines = []) {
    return lines.map((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new Error(`scene.hud lines[${index}] must be an object with x/y/text/color`);
      }
      if (!Number.isFinite(item.x) || !Number.isFinite(item.y)) {
        throw new Error(`scene.hud lines[${index}] requires finite x/y`);
      }
      if (item.text === undefined) {
        throw new Error(`scene.hud lines[${index}] requires text`);
      }
      if (!Array.isArray(item.color)) {
        throw new Error(`scene.hud lines[${index}] requires color array`);
      }
      return {
        x: item.x,
        y: item.y,
        text: String(item.text),
        color: [...item.color]
      };
    });
  }

  // Scene JSON に hud があれば WebgApp 側の guide/status 表示へ反映する
  // app を持たない最小構成 { gpu, space } 利用では HUD を触らず素通しする
  applyHud(scene) {
    if (!this.app || !scene?.hud) {
      return;
    }
    const guideEntries = this.normalizeHudLines(scene.hud.guideLines ?? []);
    this.app.guideEntries = guideEntries;

    if (this.app?.setStatusLines) {
      const statusEntries = this.normalizeHudLines(scene.hud.statusLines ?? [], 0, 6, [1.0, 0.88, 0.72]);
      this.app.statusEntries = statusEntries;
    }
  }

  // Scene JSON の camera を現在の WebgApp camera state へ写し込む
  // cameraRig / eye がある場合は Node にも反映し、
  // updateProjection() があれば near / far / viewAngle と整合させる
  applyCamera(scene) {
    if (!this.app || !scene?.camera) {
      return;
    }
    const camera = scene.camera;
    const target = camera.target;
    if (!Array.isArray(target) || target.length < 3 || target.some((value) => !Number.isFinite(value))) {
      throw new Error("scene.camera.target must be a 3D vector");
    }
    const requiredNumbers = [
      ["distance", camera.distance],
      ["yaw", camera.yaw],
      ["pitch", camera.pitch],
      ["roll", camera.roll],
      ["viewAngle", camera.viewAngle],
      ["near", camera.near],
      ["far", camera.far]
    ];
    for (let i = 0; i < requiredNumbers.length; i++) {
      const [name, value] = requiredNumbers[i];
      if (!Number.isFinite(value)) {
        throw new Error(`scene.camera.${name} must be a finite number`);
      }
    }
    this.app.camera.target = [...target];
    this.app.camera.distance = camera.distance;
    this.app.camera.yaw = camera.yaw;
    this.app.camera.pitch = camera.pitch;
    this.app.camera.roll = camera.roll;
    this.app.viewAngle = camera.viewAngle;
    this.app.projectionNear = camera.near;
    this.app.projectionFar = camera.far;

    if (this.app.cameraRig && this.app.eye) {
      this.app.cameraRig.setPosition(...this.app.camera.target);
      this.app.cameraRig.setAttitude(this.app.camera.yaw, this.app.camera.pitch, this.app.camera.roll);
      this.app.eye.setPosition(0.0, 0.0, this.app.camera.distance);
      this.app.eye.setAttitude(0.0, 0.0, 0.0);
    }
    if (this.app.updateProjection) {
      this.app.updateProjection(this.app.viewAngle);
    }
  }

  // 1 entry ごとに placement 用の親 node を作る
  // primitive / model の runtime が持つ root node をこの下へ attach することで、
  // scene JSON 側の transform を asset 本体から分離して管理できる
  createPlacementNode(entry, defaultName) {
    const node = this.space.addNode(null, entry.name ?? defaultName);
    const transform = this.matrixFromTransform(entry.transform ?? {});
    node.setByMatrix(transform);
    return node;
  }

  // scene.physicsSpace から PhysicsSpace を用意する
  // 呼び出し側が既存 physicsSpace を渡している場合はそれを再利用し、
  // Scene JSON 側の設定値だけを上書き反映する
  ensurePhysicsSpace(scene = {}) {
    if (!this.physicsSpace) {
      this.physicsSpace = new PhysicsSpace(scene.physicsSpace ?? {});
      return this.physicsSpace;
    }
    const settings = scene.physicsSpace;
    if (!settings) {
      return this.physicsSpace;
    }
    if (settings.gravity !== undefined) this.physicsSpace.setGravity(settings.gravity);
    if (settings.fixedTimeStepMs !== undefined) this.physicsSpace.setFixedTimeStepMs(settings.fixedTimeStepMs);
    if (settings.maxSubSteps !== undefined) this.physicsSpace.setMaxSubSteps(settings.maxSubSteps);
    if (settings.solverIterations !== undefined) this.physicsSpace.setSolverIterations(settings.solverIterations);
    if (settings.broadphaseMode !== undefined) this.physicsSpace.setBroadphaseMode(settings.broadphaseMode);
    if (settings.defaultRestitution !== undefined) this.physicsSpace.setDefaultRestitution(settings.defaultRestitution);
    if (settings.defaultFriction !== undefined) this.physicsSpace.setDefaultFriction(settings.defaultFriction);
    if (settings.sleepLinearThreshold !== undefined) this.physicsSpace.setSleepLinearThreshold(settings.sleepLinearThreshold);
    if (settings.sleepAngularThreshold !== undefined) this.physicsSpace.setSleepAngularThreshold(settings.sleepAngularThreshold);
    if (settings.sleepStepsThreshold !== undefined) this.physicsSpace.setSleepStepsThreshold(settings.sleepStepsThreshold);
    return this.physicsSpace;
  }

  // Scene JSON の collider 定義から対応する collider instance を作る
  buildPhysicsCollider(colliderDef = {}) {
    if (!colliderDef || typeof colliderDef !== "object" || Array.isArray(colliderDef)) {
      throw new Error("scene entry physics.collider must be an object");
    }
    const options = {};
    if (colliderDef.offset !== undefined) {
      options.offset = [...colliderDef.offset];
    }
    switch (colliderDef.type) {
    case "box":
      return new BoxCollider(colliderDef.size, options);
    case "plane":
      return new PlaneCollider(colliderDef.normal, options);
    case "sphere":
      return new SphereCollider(colliderDef.radius, options);
    case "capsule":
      return new CapsuleCollider(colliderDef.radius, colliderDef.segmentLength, options);
    default:
      throw new Error(`Unsupported physics collider type: ${colliderDef.type}`);
    }
  }

  // physics entry は placement node を PhysicsNode として生成する
  // 初期配置は kinematic 状態で安全に行い、最後に Scene JSON 指定の bodyType へ切り替える
  createPhysicsPlacementNode(entry, defaultName, scene) {
    const physics = entry.physics ?? {};
    const body = this.space.addPhysicsNode(null, entry.name ?? defaultName, {
      bodyType: "kinematic",
      mass: physics.mass ?? 1.0,
      gravityScale: physics.gravityScale ?? 1.0,
      linearDamping: physics.linearDamping ?? 0.0,
      angularDamping: physics.angularDamping ?? 0.0,
      allowSleep: physics.allowSleep ?? true,
      isTrigger: physics.trigger ?? false,
      fixedRotation: physics.fixedRotation ?? false,
      collisionLayer: physics.collisionLayer ?? 1,
      collisionMask: physics.collisionMask ?? 0xffffffff
    });
    const transform = this.matrixFromTransform(entry.transform ?? {});
    body.setByMatrix(transform);
    body.setCollider(this.buildPhysicsCollider(physics.collider));
    if (physics.material !== undefined) {
      body.setPhysicsMaterial({ ...physics.material });
    }
    if (physics.velocity !== undefined) {
      body.setLinearVelocityVec(physics.velocity);
    }
    if (physics.angularVelocity !== undefined) {
      body.setAngularVelocityVec(physics.angularVelocity);
    }
    this.ensurePhysicsSpace(scene).addBody(body);
    body.setBodyType(physics.bodyType ?? "static", {
      clearVelocity: false,
      restoreVelocity: false
    });
    if (physics.startSleeping === true) {
      body.sleep();
    }
    return body;
  }

  // entry.material があれば shape の material 設定を差し替える
  // material.id を必須にし、現在 material への暗黙継承は行わない
  applyMaterialOverride(shape, material = {}) {
    if (!shape || !material) return;
    if (material.id === undefined) {
      throw new Error("scene entry material override requires material.id");
    }
    const shaderParams = material.shaderParams === undefined ? {} : material.shaderParams;
    shape.setMaterial(material.id, shaderParams);
  }

  // primitive entry は Primitive static factory の薄い wrapper として扱う
  // validator を通っていても factory がなければ build 時 error にする
  buildPrimitiveAsset(entry) {
    const args = Array.isArray(entry.args) ? entry.args : [];
    const factory = Primitive[entry.type];
    if (typeof factory !== "function") {
      throw new Error(`Unsupported primitive type: ${entry.type}`);
    }
    return factory.call(Primitive, ...args);
  }

  // model entry は埋め込み asset と外部 source の両方を許可する
  // SceneValidator 済みでも、load 失敗や parse 失敗はここで例外になる
  async resolveModelAsset(entry) {
    if (entry.asset) {
      return ModelAsset.fromData(entry.asset);
    }
    return ModelAsset.load(entry.source);
  }

  // runtime.instantiate() で生成された root node を placementNode の子へ付け直す
  // これにより asset 内部の原点や joint 構造は保ったまま、
  // scene entry 単位の配置だけを外側から操作できる
  attachRootsToPlacement(runtime, createdNodeMap, placementNode) {
    const roots = runtime.nodes.filter((nodeInfo) => nodeInfo.parent === null);
    for (let i = 0; i < roots.length; i++) {
      const rootNode = createdNodeMap.get(roots[i].id);
      if (rootNode) {
        rootNode.attach(placementNode);
      }
    }
  }

  // shape 単位の軽い override をまとめて適用する
  // ここでは material と wireframe を entry 側から差し替えられるようにしている
  applyShapeOverrides(shapes, entry) {
    for (let i = 0; i < shapes.length; i++) {
      const shape = shapes[i];
      if (entry.material) {
        this.applyMaterialOverride(shape, entry.material);
      }
      if (entry.wireframe === true) {
        shape.setWireframe(true);
      }
    }
  }

  // 1 つの primitive / model entry から runtime 一式を組み立てる
  // asset.build() -> instantiate() -> placement attach -> override 適用
  // という共通フローをここへ寄せて、primitive と model の差分を asset 解決だけに絞る
  async buildEntryRuntime(entry, asset) {
    const runtime = asset.build(this.gpu);
    const placementNode = entry.physics
      ? this.createPhysicsPlacementNode(entry, entry.id, this.scene)
      : this.createPlacementNode(entry, entry.id);
    const instantiated = runtime.instantiate(this.space, {
      bindAnimations: entry.bindAnimations !== false
    });
    this.attachRootsToPlacement(runtime, instantiated.nodeMap, placementNode);
    this.applyShapeOverrides(runtime.shapes, entry);

    if (entry.startAnimations !== false) {
      runtime.startAllAnimations();
    }

    return {
      id: entry.id,
      type: entry.type ?? "model",
      asset,
      runtime,
      placementNode,
      physicsNode: entry.physics ? placementNode : null,
      nodeMap: instantiated.nodeMap,
      playOnUpdate: entry.playOnUpdate !== false
    };
  }

  // input.bindings を lower-case key の Map へ変換する
  // key 判定を `event.key.toLowerCase()` へ寄せやすい形で持っておく
  createInputMap(scene) {
    const bindings = scene?.input?.bindings ?? [];
    const map = new Map();
    for (let i = 0; i < bindings.length; i++) {
      const binding = bindings[i];
      map.set(String(binding.key).toLowerCase(), {
        action: binding.action,
        description: binding.description ?? ""
      });
    }
    return map;
  }

  // SceneLoader 全体の build 入口
  // 1. validation
  // 2. app への camera / hud 適用
  // 3. primitives / models の runtime 化
  // 4. input handler と update helper の返却
  async build(scene) {
    this.scene = scene;
    this.validator.assertValid(scene);
    if (!this.gpu) {
      throw new Error("SceneLoader requires gpu or WebgApp");
    }
    if (!this.space) {
      throw new Error("SceneLoader requires space or WebgApp");
    }

    this.applyCamera(scene);
    this.applyHud(scene);
    if (scene.physicsSpace !== undefined) {
      this.ensurePhysicsSpace(scene);
    }

    const entries = [];
    const primitiveDefs = scene.primitives ?? [];
    const modelDefs = scene.models ?? [];

    // primitives は同期生成できるが、buildEntryRuntime を共通化するため
    // model と同じ await 付きフローでそろえている
    for (let i = 0; i < primitiveDefs.length; i++) {
      const entry = primitiveDefs[i];
      const asset = this.buildPrimitiveAsset(entry);
      entries.push(await this.buildEntryRuntime(entry, asset));
    }

    // models は source 読み込みが入りうるため非同期で解決する
    for (let i = 0; i < modelDefs.length; i++) {
      const entry = modelDefs[i];
      const asset = await this.resolveModelAsset(entry);
      entries.push(await this.buildEntryRuntime(entry, asset));
    }

    const inputMap = this.createInputMap(scene);
    const physicsSpace = this.physicsSpace;

    return {
      entries,
      inputMap,
      physicsSpace,
      scene,
      // 毎 frame 呼ぶと、playOnUpdate が有効な runtime だけ animation を進める
      // scene 全体を 1 つの update call で扱えるようにするための薄い helper
      update() {
        let played = 0;
        for (let i = 0; i < entries.length; i++) {
          if (entries[i].playOnUpdate) {
            played += entries[i].runtime.playAllAnimations();
          }
        }
        return played;
      },
      // 物理付き scene の場合に caller から明示的に physics step を進める入口
      stepPhysics(deltaMs) {
        if (!physicsSpace) {
          return 0;
        }
        return physicsSpace.step(util.readFiniteNumber(deltaMs, "sceneRuntime stepPhysics deltaMs", {
          min: 0.0
        }));
      },
      // actionHandlers を受け取り、Scene JSON の input.bindings を
      // 実際の keydown callback へ橋渡しする
      createInputHandler(actionHandlers = {}) {
        return {
          onKeyDown: (key, ev) => {
            const binding = inputMap.get(String(key).toLowerCase());
            if (!binding) return;
            const handler = actionHandlers[binding.action];
            if (typeof handler === "function") {
              handler({ key, action: binding.action, description: binding.description, event: ev });
            }
          }
        };
      },
      // scene entry を id で引けるようにして、
      // sample 側が配置 node や runtime をあとから取り出しやすくする
      getEntry(id) {
        return entries.find((item) => item.id === id) ?? null;
      }
    };
  }
}
