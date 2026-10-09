// ---------------------------------------------
//  app/index.js  2026/09/22
//   Public entry point for webg 3.0 scene applications
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// WebgAppは低水準の描画・入力基盤、WebgSceneAppはproject定義を使う3.0の入口です。
export { default as WebgSceneApp, createWebgSceneApp } from "./WebgSceneApp.js";
export { default as SceneDefinition } from "./SceneDefinition.js";
export {
  default as parseSceneYAML,
  parseSceneYAMLDocument,
  stringifySceneYAML
} from "../SceneYaml.js";
export { compressSceneYAML } from "../SceneText.js";
export { default as DocumentAsset } from "../DocumentAsset.js";
export { default as SceneAsset } from "../SceneAsset.js";
export { default as ModelAsset } from "../ModelAsset.js";
export { default as WaterBody } from "../WaterBody.js";
export { default as ComputeParticleEmitter } from "../ComputeParticleEmitter.js";
export { default as ScenePhysics } from "./ScenePhysics.js";
export {
  default as PbrRenderer,
  PBR_RENDERER_PROFILES,
  resolvePbrRendererProfile,
  resolvePbrDofOptions,
  validatePbrEnvironmentOptions,
  validatePbrPipelineOptions,
  validatePbrRendererOptions
} from "./PbrRenderer.js";

// SceneFrame、backends、binding、manifest validatorは実装を分離するための内部moduleです。
// 利用者は上の入口とSceneYAML project manifestを組み合わせ、必要な拡張時だけ個別moduleを読みます。
