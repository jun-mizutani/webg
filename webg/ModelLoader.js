// ---------------------------------------------
//  ModelLoader.js   2026/03/10
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import ModelAsset from "./ModelAsset.js";
import ModelBuilder from "./ModelBuilder.js";
import GltfShape from "./GltfShape.js";
import ColladaShape from "./ColladaShape.js";
import util from "./util.js";

export default class ModelLoader {

  // glTF / Collada / ModelAsset JSON の読み込み差を吸収する
  constructor(target = {}) {
    const looksLikeWebgApp =
      typeof target?.getGL === "function" &&
      target?.screen &&
      target?.space;

    this.app = looksLikeWebgApp ? target : null;
    this.gpu = looksLikeWebgApp
      ? this.app.getGL()
      : (target?.gpu ?? null);
    this.space = looksLikeWebgApp
      ? this.app.space
      : (target?.space ?? null);
  }

  // 拡張子か明示指定から読み込み形式を決める
  detectFormat(source, options = {}) {
    if (options.format) {
      return String(options.format).toLowerCase();
    }
    const normalized = String(source ?? "").trim().toLowerCase();
    if (normalized.endsWith(".gltf") || normalized.endsWith(".glb")) {
      return "gltf";
    }
    if (normalized.endsWith(".dae")) {
      return "collada";
    }
    if (normalized.endsWith(".json")) {
      return "json";
    }
    throw new Error(`Cannot detect model format: ${source}`);
  }

  // コールバックが無い場合も同じ呼び方で stage 通知できるようにする
  emitStage(handler, stage) {
    if (typeof handler === "function") {
      handler(stage);
    }
  }

  async yieldFrame() {
    if (typeof requestAnimationFrame === "function") {
      await new Promise((resolve) => requestAnimationFrame(() => resolve()));
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  // JSON はそのまま ModelAsset として読み込む
  async loadJSON(source) {
    return {
      format: "json",
      importer: null,
      asset: await ModelAsset.load(source)
    };
  }

  // glTF は importer で ModelAsset へ正規化する
  async loadGltf(source, options = {}, onStage = null) {
    const importer = new GltfShape(this.gpu);
    await importer.load(source, { onStage });
    return {
      format: "gltf",
      importer,
      asset: await importer.toModelAssetAsync({
        includeSkins: options.includeSkins !== false,
        onStage
      })
    };
  }

  // Collada は text load と parse を経由して ModelAsset へ正規化する
  async loadCollada(source, options = {}, onStage = null) {
    const importer = new ColladaShape(this.gpu);
    const text = await util.readUrl(source);
    this.emitStage(onStage, "parse");
    const parsed = importer.parse(text, options.verbose === true, options.output);
    if (!parsed) {
      throw new Error(`Failed to parse Collada: ${source}`);
    }
    const asset = importer.toModelAsset(
      options.boneEnable !== false,
      options.texSelect
    );
    importer.releaseMeshes();
    return {
      format: "collada",
      importer,
      asset
    };
  }

  // 形式ごとの差を吸収して ModelAsset を返す
  async loadAsset(source, options = {}) {
    const format = this.detectFormat(source, options);
    if (format === "json") {
      return this.loadJSON(source);
    }
    if (format === "gltf") {
      return this.loadGltf(source, options.gltf ?? options, options.onStage);
    }
    if (format === "collada") {
      return this.loadCollada(source, options.collada ?? options, options.onStage);
    }
    throw new Error(`Unsupported model format: ${format}`);
  }

  // build / instantiate / animation start までまとめて行う高レベル入口
  async load(source, options = {}) {
    const onStage = options.onStage;
    this.emitStage(onStage, "fetch");
    const loaded = await this.loadAsset(source, options);
    const asset = loaded.asset instanceof ModelAsset
      ? loaded.asset
      : ModelAsset.fromData(loaded.asset?.getData ? loaded.asset.getData() : loaded.asset);

    if (options.validate !== false) {
      this.emitStage(onStage, "validate");
      await this.yieldFrame();
      asset.assertValid();
    }

    if (!this.gpu) {
      throw new Error("ModelLoader requires gpu or WebgApp");
    }

    this.emitStage(onStage, "build");
    await this.yieldFrame();
    const builder = new ModelBuilder(this.gpu);
    const runtime = typeof builder.buildAsync === "function"
      ? await builder.buildAsync(asset.getData(), { onStage })
      : builder.build(asset.getData());
    if (typeof loaded.importer?.applyRuntimeMaterials === "function") {
      this.emitStage(onStage, "apply-runtime-materials");
      await this.yieldFrame();
      await loaded.importer.applyRuntimeMaterials(runtime, onStage);
    }
    let instantiated = null;

    if (options.instantiate !== false && this.space) {
      this.emitStage(onStage, "instantiate");
      await this.yieldFrame();
      instantiated = runtime.instantiate(this.space, options.instantiateOptions ?? {});
    }

    if (options.startAnimations === true) {
      this.emitStage(onStage, "runtime");
      runtime.startAllAnimations();
    }

    return {
      source,
      format: loaded.format,
      importer: loaded.importer,
      asset,
      runtime,
      instantiated,
      getClipNames() {
        return asset.getClipNames();
      },
      getClipInfo(id) {
        return asset.getClipInfo(id);
      },
      instantiate: (space = this.space, instantiateOptions = {}) => {
        if (!space) {
          throw new Error("ModelLoader result requires a space to instantiate");
        }
        instantiated = runtime.instantiate(space, instantiateOptions);
        return instantiated;
      },
      downloadJSON(filename = "modelasset.json", indent = 2) {
        return asset.downloadJSON(filename, indent);
      }
    };
  }
}
