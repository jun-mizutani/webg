// ---------------------------------------------
//  SceneAsset.js    2026/03/15
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import SceneValidator from "./SceneValidator.js";
import SceneLoader from "./SceneLoader.js";
import formatJSON from "./JsonFormat.js";

export default class SceneAsset {

  // Scene JSON と validation / build 窓口をまとめる
  constructor(data = null) {
    this.data = data;
    this.validator = new SceneValidator();
  }

  // すでに object 化された Scene JSON から asset を作る
  static fromData(data) {
    return new SceneAsset(data);
  }

  // 文字列 JSON を parse して SceneAsset 化する
  // parse error は Scene JSON 由来だと分かる message へ包み直す
  static fromJSON(text) {
    try {
      return new SceneAsset(JSON.parse(text));
    } catch (err) {
      throw new Error(`Failed to parse Scene JSON: ${err?.message ?? err}`);
    }
  }

  // URL から Scene JSON を読み込み、そのまま asset 化する
  // fetch error と JSON parse error を分けて message 化しておく
  static async load(url) {
    let response;
    try {
      response = await fetch(url);
    } catch (err) {
      throw new Error(`Failed to load Scene JSON: ${url} (${err?.message ?? err})`);
    }
    if (!response.ok) {
      throw new Error(`Failed to load Scene JSON: ${url} (${response.status} ${response.statusText})`);
    }
    try {
      return new SceneAsset(await response.json());
    } catch (err) {
      throw new Error(`Failed to parse Scene JSON: ${url} (${err?.message ?? err})`);
    }
  }

  // 後段の validate / build 対象を差し替える
  setData(data) {
    this.data = data;
    return this;
  }

  // 現在保持している Scene JSON object を返す
  getData() {
    return this.data;
  }

  // Scene JSON を外へ渡す前に深い複製が必要な場面向け helper
  // 現状 class 内で直接は使っていないが、簡易な clone 手段として残している
  cloneJSONValue(value) {
    return JSON.parse(JSON.stringify(value));
  }

  // formatJSON を通して読みやすい整形済み JSON 文字列を返す
  toJSONText(indent = 2) {
    return formatJSON(this.data, indent);
  }

  // 現在の Scene JSON を JSON ファイルとしてダウンロードする
  downloadJSON(filename = "scene.json", indent = 2) {
    const text = this.toJSONText(indent);
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return text;
  }

  // validator を通し、error / warning 一覧を返す
  validate() {
    return this.validator.validate(this.data);
  }

  // invalid な Scene JSON なら即例外を投げる
  assertValid() {
    return this.validator.assertValid(this.data);
  }

  // WebgApp もしくは { app, gpu, space } を受け取り、scene を構築する
  // 実際の実体化は SceneLoader に委譲し、SceneAsset 自身は
  // 「データ保持と入出力の窓口」に役割を絞る
  async build(target) {
    const loader = new SceneLoader(target);
    return loader.build(this.data);
  }
}
