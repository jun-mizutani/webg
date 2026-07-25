// ---------------------------------------------
//  SceneValidator.js  2026/07/25
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

export default class SceneValidator {

  // Scene JSON の妥当性検証器を初期化する
  // errors は build を止める不整合、
  // warnings は build 自体は可能だが scene 記述の意図がぶれやすい点をためる
  constructor() {
    this.errors = [];
    this.warnings = [];
  }

  // 1 件の致命的な不整合を記録する
  addError(path, message) {
    this.errors.push({ path, message });
  }

  // 1 件の注意事項を記録する
  addWarning(path, message) {
    this.warnings.push({ path, message });
  }

  // 汎用の条件確認を行い、失敗時は errors へ積む
  // validate 系 helper の戻り値としても使い、
  // 後段が「この検証が通ったか」を簡単に判断できるようにする
  expect(condition, path, message) {
    if (!condition) {
      this.addError(path, message);
      return false;
    }
    return true;
  }

  // 配列前提の項目を入口で正規化する
  // null を返した場合は、呼び出し側がそれ以上深掘りしない
  ensureArray(value, path, label) {
    if (!Array.isArray(value)) {
      this.addError(path, `${label} must be an array`);
      return null;
    }
    return value;
  }

  // object 前提の項目を確認する
  // array を object と誤認しないように明示的にはじく
  ensureObject(value, path, label) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      this.addError(path, `${label} must be an object`);
      return null;
    }
    return value;
  }

  // finite な number でなければ後段の transform や camera 計算が壊れるので、
  // NaN / Infinity / 文字列をまとめて拒否する
  validateFiniteNumber(value, path, label) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      this.addError(path, `${label} must be a finite number`);
      return false;
    }
    return true;
  }

  // xyz や quaternion のような固定長配列をよく使うので、
  // 数値配列確認と長さ確認を 1 箇所へまとめる
  validateNumberArray(value, path, label, length = null) {
    const array = this.ensureArray(value, path, label);
    if (!array) return null;
    if (length !== null) {
      this.expect(array.length === length, path, `${label} length must be ${length}`);
    }
    for (let i = 0; i < array.length; i++) {
      this.validateFiniteNumber(array[i], `${path}[${i}]`, label);
    }
    return array;
  }

  // primitives / models の id を先に集め、
  // 重複検出や cross reference の存在確認に使える Set を作る
  buildIdSet(items, path, label) {
    const ids = new Set();
    if (!Array.isArray(items)) return ids;
    for (let i = 0; i < items.length; i++) {
      const id = items[i]?.id;
      if (typeof id !== "string" || id.length === 0) {
        this.addError(`${path}[${i}].id`, `${label} id must be a non-empty string`);
        continue;
      }
      if (ids.has(id)) {
        this.addError(`${path}[${i}].id`, `${label} id "${id}" is duplicated`);
        continue;
      }
      ids.add(id);
    }
    return ids;
  }

  // transform は任意項目だが、指定された場合は
  // translation(vec3) / rotation(quaternion) / scale(vec3) の形を期待する
  validateTransform(transform, path) {
    if (!transform) return;
    const obj = this.ensureObject(transform, path, "transform");
    if (!obj) return;
    if (obj.translation !== undefined) {
      this.validateNumberArray(obj.translation, `${path}.translation`, "translation", 3);
    }
    if (obj.rotation !== undefined) {
      this.validateNumberArray(obj.rotation, `${path}.rotation`, "rotation", 4);
    }
    if (obj.scale !== undefined) {
      this.validateNumberArray(obj.scale, `${path}.scale`, "scale", 3);
    }
  }

  // material override は placement entry 側から shape の見え方を差し替える入口
  // material.id だけ差し替えるケースと shaderParams だけ上書きするケースの両方を許可する
  validateMaterialOverride(material, path) {
    if (!material) return;
    const obj = this.ensureObject(material, path, "material");
    if (!obj) return;
    if (obj.id !== undefined && typeof obj.id !== "string") {
      this.addError(`${path}.id`, "material id must be a string");
    }
    if (obj.shaderParams !== undefined && !this.ensureObject(obj.shaderParams, `${path}.shaderParams`, "shaderParams")) {
      return;
    }
  }

  // 物理空間設定は PhysicsSpace constructor option と同じ役割を持つ
  // Scene JSON 側では実行時補完を増やしすぎず、
  // 数値型と enum 整合性をここで先に確認して loader 側を単純にする
  validatePhysicsSpace(physicsSpace, path) {
    const obj = this.ensureObject(physicsSpace, path, "physicsSpace");
    if (!obj) return;
    if (obj.gravity !== undefined) {
      this.validateNumberArray(obj.gravity, `${path}.gravity`, "gravity", 3);
    }
    const finiteFields = [
      "fixedTimeStepMs",
      "maxSubSteps",
      "solverIterations",
      "defaultRestitution",
      "defaultFriction",
      "sleepLinearThreshold",
      "sleepAngularThreshold",
      "sleepStepsThreshold"
    ];
    for (let i = 0; i < finiteFields.length; i++) {
      const field = finiteFields[i];
      if (obj[field] !== undefined) {
        this.validateFiniteNumber(obj[field], `${path}.${field}`, field);
      }
    }
    if (obj.broadphaseMode !== undefined) {
      const validModes = new Set(["sweepAabb", "bruteForce"]);
      this.expect(
        typeof obj.broadphaseMode === "string" && validModes.has(obj.broadphaseMode),
        `${path}.broadphaseMode`,
        `broadphaseMode must be one of ${[...validModes].join(", ")}`
      );
    }
  }

  // physics material は見た目 material と混同せず、
  // 反発と摩擦だけを entry.physics.material へ明示する
  validatePhysicsMaterial(material, path) {
    const obj = this.ensureObject(material, path, "physics material");
    if (!obj) return;
    if (obj.restitution !== undefined) {
      this.validateFiniteNumber(obj.restitution, `${path}.restitution`, "restitution");
    }
    if (obj.friction !== undefined) {
      this.validateFiniteNumber(obj.friction, `${path}.friction`, "friction");
    }
  }

  // physics collider は Scene JSON から PhysicsNode へ渡す最小形状定義
  // shape 自動推定はまだ入れず、type と必要パラメータを明示させる
  validatePhysicsCollider(collider, path) {
    const obj = this.ensureObject(collider, path, "physics collider");
    if (!obj) return;
    const validTypes = new Set(["box", "plane", "sphere", "capsule"]);
    this.expect(
      typeof obj.type === "string" && validTypes.has(obj.type),
      `${path}.type`,
      `physics collider type must be one of ${[...validTypes].join(", ")}`
    );
    if (obj.offset !== undefined) {
      this.validateNumberArray(obj.offset, `${path}.offset`, "offset", 3);
    }
    if (obj.type === "box" && obj.size !== undefined) {
      this.validateNumberArray(obj.size, `${path}.size`, "size", 3);
    }
    if (obj.type === "plane" && obj.normal !== undefined) {
      this.validateNumberArray(obj.normal, `${path}.normal`, "normal", 3);
    }
    if (obj.type === "sphere" && obj.radius !== undefined) {
      this.validateFiniteNumber(obj.radius, `${path}.radius`, "radius");
    }
    if (obj.type === "capsule") {
      if (obj.radius !== undefined) {
        this.validateFiniteNumber(obj.radius, `${path}.radius`, "radius");
      }
      if (obj.segmentLength !== undefined) {
        this.validateFiniteNumber(obj.segmentLength, `${path}.segmentLength`, "segmentLength");
      }
    }
    if (obj.type === "box" && obj.size === undefined) {
      this.addError(`${path}.size`, "box collider requires size");
    }
    if (obj.type === "plane" && obj.normal === undefined) {
      this.addError(`${path}.normal`, "plane collider requires normal");
    }
    if (obj.type === "sphere" && obj.radius === undefined) {
      this.addError(`${path}.radius`, "sphere collider requires radius");
    }
    if (obj.type === "capsule") {
      if (obj.radius === undefined) {
        this.addError(`${path}.radius`, "capsule collider requires radius");
      }
      if (obj.segmentLength === undefined) {
        this.addError(`${path}.segmentLength`, "capsule collider requires segmentLength");
      }
    }
  }

  // primitive / model entry に物理を付与する場合の検証
  // 物理参加させる entry は collider を必須にし、
  // 動作モードや初速を Scene JSON 側で明示できるようにする
  validatePhysics(physics, path) {
    const obj = this.ensureObject(physics, path, "physics");
    if (!obj) return;
    const validBodyTypes = new Set(["static", "kinematic", "dynamic"]);
    if (obj.bodyType !== undefined) {
      this.expect(
        typeof obj.bodyType === "string" && validBodyTypes.has(obj.bodyType),
        `${path}.bodyType`,
        `physics bodyType must be one of ${[...validBodyTypes].join(", ")}`
      );
    }
    const finiteFields = [
      "mass",
      "gravityScale",
      "linearDamping",
      "angularDamping",
      "collisionLayer",
      "collisionMask"
    ];
    for (let i = 0; i < finiteFields.length; i++) {
      const field = finiteFields[i];
      if (obj[field] !== undefined) {
        this.validateFiniteNumber(obj[field], `${path}.${field}`, field);
      }
    }
    const boolFields = ["allowSleep", "trigger", "fixedRotation", "startSleeping"];
    for (let i = 0; i < boolFields.length; i++) {
      const field = boolFields[i];
      if (obj[field] !== undefined && typeof obj[field] !== "boolean") {
        this.addError(`${path}.${field}`, `${field} must be a boolean`);
      }
    }
    if (obj.velocity !== undefined) {
      this.validateNumberArray(obj.velocity, `${path}.velocity`, "velocity", 3);
    }
    if (obj.angularVelocity !== undefined) {
      this.validateNumberArray(obj.angularVelocity, `${path}.angularVelocity`, "angularVelocity", 3);
    }
    if (obj.material !== undefined) {
      this.validatePhysicsMaterial(obj.material, `${path}.material`);
    }
    if (obj.collider === undefined) {
      this.addError(`${path}.collider`, "physics requires collider");
    } else {
      this.validatePhysicsCollider(obj.collider, `${path}.collider`);
    }
  }

  // camera は WebgApp camera の代表的な public field に対応させている
  // 値の意味まではここで制限せず、型と配列長の整合性だけを見る
  validateCamera(camera, path) {
    const obj = this.ensureObject(camera, path, "camera");
    if (!obj) return;
    if (obj.target !== undefined) this.validateNumberArray(obj.target, `${path}.target`, "target", 3);
    if (obj.distance !== undefined) this.validateFiniteNumber(obj.distance, `${path}.distance`, "distance");
    if (obj.yaw !== undefined) this.validateFiniteNumber(obj.yaw, `${path}.yaw`, "yaw");
    if (obj.pitch !== undefined) this.validateFiniteNumber(obj.pitch, `${path}.pitch`, "pitch");
    if (obj.roll !== undefined) this.validateFiniteNumber(obj.roll, `${path}.roll`, "roll");
    if (obj.viewAngle !== undefined) this.validateFiniteNumber(obj.viewAngle, `${path}.viewAngle`, "viewAngle");
    if (obj.near !== undefined) this.validateFiniteNumber(obj.near, `${path}.near`, "near");
    if (obj.far !== undefined) this.validateFiniteNumber(obj.far, `${path}.far`, "far");
  }

  // hud は文字列配列でも object 配列でも書けるようにしている
  // string の簡易記法と詳細指定の object 記法を両方受け入れるため、
  // 行ごとに分岐して検証する
  validateHud(hud, path) {
    const obj = this.ensureObject(hud, path, "hud");
    if (!obj) return;
    // 線の`array`を検証し、後続処理が扱える共通形式へ整える
    const validateLineArray = (value, linePath, label) => {
      const lines = this.ensureArray(value, linePath, label);
      if (!lines) return;
      for (let i = 0; i < lines.length; i++) {
        const item = lines[i];
        if (typeof item === "string") continue;
        const line = this.ensureObject(item, `${linePath}[${i}]`, "line");
        if (!line) continue;
        this.expect(typeof line.text === "string", `${linePath}[${i}].text`, "line text must be a string");
        if (line.x !== undefined) this.validateFiniteNumber(line.x, `${linePath}[${i}].x`, "line x");
        if (line.y !== undefined) this.validateFiniteNumber(line.y, `${linePath}[${i}].y`, "line y");
        if (line.color !== undefined) this.validateNumberArray(line.color, `${linePath}[${i}].color`, "line color", 3);
      }
    };
    if (obj.guideLines !== undefined) validateLineArray(obj.guideLines, `${path}.guideLines`, "guideLines");
    if (obj.statusLines !== undefined) validateLineArray(obj.statusLines, `${path}.statusLines`, "statusLines");
  }

  // input.bindings は key -> action の最小宣言
  // 実際の key 判定は後段の SceneLoader で lower-case map へ変換する
  validateInput(input, path) {
    const obj = this.ensureObject(input, path, "input");
    if (!obj) return;
    const bindings = this.ensureArray(obj.bindings ?? [], `${path}.bindings`, "bindings");
    if (!bindings) return;
    for (let i = 0; i < bindings.length; i++) {
      const binding = this.ensureObject(bindings[i], `${path}.bindings[${i}]`, "binding");
      if (!binding) continue;
      this.expect(typeof binding.key === "string" && binding.key.length > 0, `${path}.bindings[${i}].key`, "binding key must be a non-empty string");
      this.expect(typeof binding.action === "string" && binding.action.length > 0, `${path}.bindings[${i}].action`, "binding action must be a non-empty string");
      if (binding.description !== undefined && typeof binding.description !== "string") {
        this.addError(`${path}.bindings[${i}].description`, "binding description must be a string");
      }
    }
  }

  // primitive entry は Primitive の factory 呼び出し情報を表す
  // type と args が通れば build 自体は可能なので、
  // ここでは factory 実行前に最低限の構造だけを確認する
  validatePrimitive(entry, path) {
    const obj = this.ensureObject(entry, path, "primitive");
    if (!obj) return;
    const primitiveTypes = new Set([
      "sphere",
      "donut",
      "cone",
      "truncated_cone",
      "double_cone",
      "prism",
      "arrow",
      "cuboid",
      "cube",
      "mapCuboid",
      "mapCube",
      "debugBone"
    ]);
    this.expect(typeof obj.id === "string" && obj.id.length > 0, `${path}.id`, "primitive id must be a non-empty string");
    this.expect(typeof obj.type === "string" && primitiveTypes.has(obj.type), `${path}.type`, `primitive type must be one of ${[...primitiveTypes].join(", ")}`);
    if (obj.args !== undefined && !Array.isArray(obj.args)) {
      this.addError(`${path}.args`, "primitive args must be an array");
    }
    this.validateTransform(obj.transform, `${path}.transform`);
    this.validateMaterialOverride(obj.material, `${path}.material`);
    if (obj.physics !== undefined) {
      this.validatePhysics(obj.physics, `${path}.physics`);
    }
  }

  // model entry は source URL か埋め込み asset のどちらかで ModelAsset を解決する
  // SceneLoader 側が迷わないよう、最低 1 つは必須とする
  validateModel(entry, path) {
    const obj = this.ensureObject(entry, path, "model");
    if (!obj) return;
    this.expect(typeof obj.id === "string" && obj.id.length > 0, `${path}.id`, "model id must be a non-empty string");
    const hasSource = typeof obj.source === "string" && obj.source.length > 0;
    const hasAsset = obj.asset && typeof obj.asset === "object" && !Array.isArray(obj.asset);
    this.expect(hasSource || hasAsset, path, "model must have source or asset");
    if (obj.source !== undefined && typeof obj.source !== "string") {
      this.addError(`${path}.source`, "model source must be a string");
    }
    this.validateTransform(obj.transform, `${path}.transform`);
    this.validateMaterialOverride(obj.material, `${path}.material`);
    if (obj.physics !== undefined) {
      this.validatePhysics(obj.physics, `${path}.physics`);
    }
    if (obj.bindAnimations !== undefined && typeof obj.bindAnimations !== "boolean") {
      this.addError(`${path}.bindAnimations`, "bindAnimations must be a boolean");
    }
    if (obj.startAnimations !== undefined && typeof obj.startAnimations !== "boolean") {
      this.addError(`${path}.startAnimations`, "startAnimations must be a boolean");
    }
    if (obj.playOnUpdate !== undefined && typeof obj.playOnUpdate !== "boolean") {
      this.addError(`${path}.playOnUpdate`, "playOnUpdate must be a boolean");
    }
  }

  // Scene JSON 全体を検証する本体
  // まず top-level を見てから camera / hud / input / primitives / models の順に進み、
  // 最後に cross-check と warning 追加を行う
  validateScene(scene) {
    this.errors = [];
    this.warnings = [];

    if (!scene || typeof scene !== "object" || Array.isArray(scene)) {
      this.addError("scene", "Scene must be an object");
      return { ok: false, errors: this.errors, warnings: this.warnings };
    }

    if (scene.version !== undefined && typeof scene.version !== "string") {
      this.addError("scene.version", "version must be a string");
    }
    if (scene.type !== undefined && scene.type !== "webg-scene") {
      this.addError("scene.type", "type must be \"webg-scene\"");
    }

    if (scene.meta !== undefined) {
      this.ensureObject(scene.meta, "scene.meta", "meta");
    }
    if (scene.camera !== undefined) this.validateCamera(scene.camera, "scene.camera");
    if (scene.hud !== undefined) this.validateHud(scene.hud, "scene.hud");
    if (scene.input !== undefined) this.validateInput(scene.input, "scene.input");
    if (scene.physicsSpace !== undefined) this.validatePhysicsSpace(scene.physicsSpace, "scene.physicsSpace");
    if (scene.tileMap !== undefined) {
      this.addError("scene.tileMap", "tileMap is not supported by the current webg core");
    }

    const primitiveEntries = this.ensureArray(scene.primitives ?? [], "scene.primitives", "primitives");
    const modelEntries = this.ensureArray(scene.models ?? [], "scene.models", "models");
    const primitiveIds = this.buildIdSet(primitiveEntries, "scene.primitives", "primitive");
    const modelIds = this.buildIdSet(modelEntries, "scene.models", "model");

    // 各 entry の局所的な構造を確認する
    if (primitiveEntries) {
      for (let i = 0; i < primitiveEntries.length; i++) {
        this.validatePrimitive(primitiveEntries[i], `scene.primitives[${i}]`);
      }
    }
    if (modelEntries) {
      for (let i = 0; i < modelEntries.length; i++) {
        this.validateModel(modelEntries[i], `scene.models[${i}]`);
      }
    }

    // primitive と model の namespace は共有なので、両配列をまたぐ id 重複も禁止する
    for (const id of primitiveIds) {
      if (modelIds.has(id)) {
        this.addError(`scene.models`, `id "${id}" is duplicated across primitives and models`);
      }
    }

    // 完全に空の scene は build 自体はできるが、
    // 利用者の書き間違いか最小テンプレートの書きかけである可能性が高いので warning にする
    if ((primitiveEntries?.length ?? 0) === 0 && (modelEntries?.length ?? 0) === 0) {
      this.addWarning("scene", "scene has no primitives or models");
    }

    const hasPhysicsEntries = [...(primitiveEntries ?? []), ...(modelEntries ?? [])]
      .some((entry) => entry?.physics !== undefined);
    if (hasPhysicsEntries && scene.physicsSpace === undefined) {
      this.addWarning("scene.physicsSpace", "physics entries exist; default PhysicsSpace settings will be used");
    }

    return {
      ok: this.errors.length === 0,
      errors: this.errors,
      warnings: this.warnings
    };
  }

  // public API は validate() に寄せ、内部実装名 validateScene() を隠す
  validate(scene) {
    return this.validateScene(scene);
  }

  // build 前に即例外で止めたい呼び出し側向け helper
  // すべての error を 1 つの message へまとめ、
  // sample 側が panel や console へそのまま出しやすい形にする
  assertValid(scene) {
    const result = this.validateScene(scene);
    if (result.ok) return result;
    const lines = result.errors.map((item) => `- ${item.path}: ${item.message}`);
    throw new Error(`Invalid Scene JSON\n${lines.join("\n")}`);
  }
}
