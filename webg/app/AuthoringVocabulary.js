// ---------------------------------------------
// AuthoringVocabulary.js     2026/09/08
//   Shared vocabulary for high-level project authoring
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import util from "../util.js";

// 物体中心記述で共有する安定IDの表記規則を一か所へ集めます
export const STABLE_ID_PATTERN = "^[A-Za-z][A-Za-z0-9_-]*$";
const stableIdPattern = new RegExp(STABLE_ID_PATTERN);

// 表示形状と接触形状の関係を作者が選択する語彙です
export const COLLIDER_RELATIONS = Object.freeze(["match", "proxy"]);

// physics bodyの姿勢を読む座標基準を作者が選択する語彙です
export const TRANSFORM_SPACES = Object.freeze(["local", "world"]);

// projectで現在扱う表示・接触形状の種類を共有します
export const GEOMETRY_TYPES = Object.freeze(["box", "sphere", "capsule"]);

// 物体・部品・接続点・Joint IDとして利用できる識別子を判定します
export function isStableIdentifier(value) {
  return typeof value === "string" && stableIdPattern.test(value);
}

// 実行時validatorが使う安定IDを読み、診断位置を保ったエラーへつなげます
export function readStableIdentifier(value, label) {
  const id = util.readOptionalString(value, label, undefined, { trim: true, allowEmpty: false });
  if (!isStableIdentifier(id)) throw new Error(`${label} must be a stable ID matching ${STABLE_ID_PATTERN}`);
  return id;
}

// 配列で定義した語彙をSchema検査へ渡せる独立コピーとして返します
export function copyAuthoringEnum(values) {
  return [...values];
}
