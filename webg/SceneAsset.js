// ---------------------------------------------
//  SceneAsset.js    2026/09/19
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import DocumentAsset from "./DocumentAsset.js";
import SceneValidator from "./SceneValidator.js";
import SceneLoader from "./SceneLoader.js";
import SceneDefinition from "./app/SceneDefinition.js";

// SceneYAMLのproject manifestか、従来Scene JSONかを入力値だけで分類します
// SceneYAMLをSceneAssetへ保持する経路と、旧SceneLoaderへ渡す経路を混同しないために使います
function isSceneDocumentData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  if (data.format === "webg-scene") return true;
  return [
    "objects",
    "objectSets",
    "meshes",
    "renderer",
    "modelAsset",
    "modelAssetUrl",
    "sceneAsset",
    "sceneAssetUrl",
    "materialsUrl",
    "physicsUrl"
  ].some(key => data[key] !== undefined);
}

export default class SceneAsset extends DocumentAsset {

  // SceneAsset固有のValidatorを生成し、共通document処理をDocumentAssetへ渡す
  constructor(data = null, options = {}) {
    super(data, { ...options, validator: new SceneValidator() });
    this.runtimeDefinition = null;
  }

  // 共通DocumentAssetが使うasset名と既存SceneAssetのエラーメッセージを定義する
  static get assetTypeName() {
    return "SceneAsset";
  }

  // JSON parse失敗時の既存表示を維持する
  static get jsonParseLabel() {
    return "Scene JSON";
  }

  // YAML parse失敗時の既存表示を維持する
  static get yamlParseLabel() {
    return "SceneYAML";
  }

  // URL取得失敗時の既存表示を維持する
  static get loadDocumentLabel() {
    return "Scene document";
  }

  // 共通DocumentAssetのダウンロード既定値を従来のSceneAsset名へ合わせる
  static get defaultJSONFilename() {
    return "scene.json";
  }

  // SceneYAMLを保存するときの既定ファイル名を返す
  static get defaultYAMLFilename() {
    return "scene.yaml";
  }

  // SceneYAML gzipを保存するときの既定ファイル名を返す
  static get defaultYAMLGzFilename() {
    return "scene.yaml.gz";
  }

  // SceneYAMLと同じ高水準project manifestとして扱えるAssetか確認する
  isSceneDocument() {
    return isSceneDocumentData(this.data);
  }

  // SceneAssetをSceneDefinitionへ変換する
  // SceneDefinitionが入力形式固有の検証と高水準runtime構築を担当し、値の複製でAsset原本を保ちます
  toSceneDefinition() {
    if (!this.isSceneDocument()) {
      throw new Error("SceneAsset does not contain a SceneYAML project document");
    }
    const orientationFormat = this.sourceDocument?.format === "json"
      && this.data?.format !== "webg-scene"
      ? "legacy-quaternion"
      : "euler";
    const options = {
      orientationFormat,
      sourceDocument: this.sourceDocument
    };
    const sourceUrl = this.getSourceUrl();
    if (sourceUrl !== null) options.sourceUrl = sourceUrl;
    return SceneDefinition.fromData(this.cloneJSONValue(this.data), options);
  }

  // validator を通し、error / warning 一覧を返す
  validate() {
    if (this.isSceneDocument()) {
      const definition = this.toSceneDefinition();
      try {
        definition.validate();
        return { ok: true, errors: [], warnings: [] };
      } catch (error) {
        return { ok: false, errors: [{ path: "manifest", message: error?.message ?? String(error) }], warnings: [] };
      } finally {
        definition.destroy();
      }
    }
    return this.validator.validate(this.data);
  }

  // invalid な Scene JSON なら即例外を投げる
  assertValid() {
    if (this.isSceneDocument()) {
      const definition = this.toSceneDefinition();
      try {
        definition.validate();
        return { ok: true, errors: [], warnings: [] };
      } finally {
        definition.destroy();
      }
    }
    return this.validator.assertValid(this.data);
  }

  // WebgApp もしくは { app, gpu, space } を受け取り、scene を構築する
  // 実際の実体化は SceneLoader に委譲し、SceneAsset 自身は
  // 「データ保持と入出力の窓口」に役割を絞る
  async build(target) {
    if (this.isSceneDocument()) {
      const definition = this.toSceneDefinition();
      try {
        definition.validate();
        let runtime;
        if (this.data.objects !== undefined || this.data.objectSets !== undefined) {
          runtime = await definition.buildPrimitiveScene(target);
        } else if (this.data.modelAsset !== undefined || this.data.modelAssetUrl !== undefined
          || this.data.sceneAsset !== undefined || this.data.sceneAssetUrl !== undefined) {
          runtime = await definition.buildModelRuntime(target);
        } else {
          runtime = await definition.build(target);
        }
        this.runtimeDefinition = definition;
        return runtime;
      } catch (error) {
        definition.destroy();
        throw error;
      }
    }
    const loader = new SceneLoader(target);
    return loader.build(this.data);
  }

  // SceneAssetが保持する高水準runtime用Definitionを破棄し、外部YAML resourceを解放します
  destroy() {
    if (!this.runtimeDefinition) return false;
    const destroyed = this.runtimeDefinition.destroy();
    this.runtimeDefinition = null;
    return destroyed;
  }
}
