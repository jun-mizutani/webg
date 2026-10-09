// ---------------------------------------------
//  DocumentAsset.js  2026/09/19
//   Shared document asset base for SceneAsset and ModelAsset
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import formatJSON from "./JsonFormat.js";
import { parseSceneYAMLDocument, stringifySceneYAML } from "./SceneYaml.js";
import { readSceneText, compressSceneYAML } from "./SceneText.js";

// SceneAssetとModelAssetで共有するdocumentの元データをJSON互換値として複製する
// YAML原文と解析済み値を比較するsnapshotを、呼出側の配列変更から分離する
function cloneJSONValue(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

// 読み込み直後の値と現在値を比較し、YAMLコメントの対応関係を維持できるか確認する
function dataMatchesSnapshot(data, snapshot) {
  return JSON.stringify(data) === JSON.stringify(snapshot);
}

// SceneYAMLとModelYAMLで共通するJSON/YAML文書の入出力を管理する基底class
// Scene固有のDefinition変換、Model固有のgeometry・animation処理、各Validatorは派生classへ残す
export default class DocumentAsset {
  // 解析済みdocument、validator、原文、コメント、読み込み直後のsnapshotを保持する
  // validatorはSceneAssetまたはModelAssetが明示的に生成して渡し、種類の取り違えを初期化時に検出する
  constructor(data = null, options = {}) {
    if (!options.validator
      || typeof options.validator.validate !== "function"
      || typeof options.validator.assertValid !== "function") {
      throw new Error(`${this.constructor.name} requires a document validator`);
    }
    this.data = data;
    this.validator = options.validator;
    this.sourceDocument = options.sourceDocument ?? null;
    this.sourceDataSnapshot = this.sourceDocument ? cloneJSONValue(data) : null;
  }

  // 派生classの名前を、保存時のエラーや診断に使うasset名として返す
  // SceneAssetとModelAssetは既存のエラーメッセージを維持するためgetterを上書きする
  static get assetTypeName() {
    return this.name;
  }

  // JSON parse失敗時に表示する文書種別を返す
  static get jsonParseLabel() {
    return `${this.assetTypeName} JSON`;
  }

  // YAML parse失敗時に表示する文書種別を返す
  static get yamlParseLabel() {
    return `${this.assetTypeName} YAML`;
  }

  // URL取得失敗時に表示する文書種別を返す
  static get loadDocumentLabel() {
    return `${this.assetTypeName} document`;
  }

  // ダウンロードAPIの既定ファイル名を派生classごとに選べるようにする
  // SceneAssetとModelAssetが従来使ってきた名前をそのまま維持する
  static get defaultJSONFilename() {
    return "asset.json";
  }

  // YAML保存時の既定ファイル名を派生classごとに返す
  static get defaultYAMLFilename() {
    return "asset.yaml";
  }

  // YAML gzip保存時の既定ファイル名を派生classごとに返す
  static get defaultYAMLGzFilename() {
    return "asset.yaml.gz";
  }

  // URL読込後のparse失敗時に表示する文書種別を返す
  static getLoadParseLabel(url) {
    return this.isYAMLSource(url) ? this.yamlParseLabel : this.jsonParseLabel;
  }

  // 既にobject化された文書から、呼出元の派生classを生成する
  // new this()を使うことで、SceneAsset/ModelAssetのfromData()を同じ実装へ集約する
  static fromData(data, options = {}) {
    return new this(data, options);
  }

  // JSON文字列を解析し、JSON原文もsource情報として保持する
  // コメントはJSONには存在しないため、空のcomments配列を明示的に保存する
  static fromJSON(text, options = {}) {
    try {
      const data = JSON.parse(text);
      return new this(data, {
        ...options,
        sourceDocument: {
          format: "json",
          sourceText: text,
          comments: Object.freeze([]),
          sourceUrl: options.sourceUrl ?? null
        }
      });
    } catch (err) {
      throw new Error(`Failed to parse ${this.jsonParseLabel}: ${err?.message ?? err}`);
    }
  }

  // 限定YAML方言を解析し、コメントと原文をsource情報として保持する
  // SceneYAMLとModelYAMLは同じparserを使い、assetの検証とbuildだけを派生classで分ける
  static fromYAML(text, options = {}) {
    try {
      const document = parseSceneYAMLDocument(text);
      return new this(document.value, {
        ...options,
        sourceDocument: {
          format: "yaml",
          sourceText: document.sourceText,
          comments: document.comments,
          sourceUrl: options.sourceUrl ?? null
        }
      });
    } catch (err) {
      throw new Error(`Failed to parse ${this.yamlParseLabel}: ${err?.message ?? err}`);
    }
  }

  // URLの拡張子からYAMLまたはYAML gzip入力を判定する
  static isYAMLSource(source) {
    const path = String(source ?? "").trim().toLowerCase().split(/[?#]/, 1)[0];
    return path.endsWith(".yaml") || path.endsWith(".yml")
      || path.endsWith(".yaml.gz") || path.endsWith(".yml.gz");
  }

  // URLの拡張子からgzip圧縮されたJSONまたはYAML入力を判定する
  static isGzipSource(source) {
    const path = String(source ?? "").trim().toLowerCase().split(/[?#]/, 1)[0];
    return path.endsWith(".json.gz") || path.endsWith(".yaml.gz") || path.endsWith(".yml.gz");
  }

  // URLから文書を取得し、拡張子でJSON/YAMLを選択して同じ派生classへ生成する
  // gzip展開やResponseの読み込みはSceneTextへ委譲し、assetは解析済みdocumentの保持へ集中する
  static async load(url) {
    let response;
    try {
      response = await fetch(url);
    } catch (err) {
      throw new Error(`Failed to load ${this.loadDocumentLabel}: ${url} (${err?.message ?? err})`);
    }
    if (!response.ok) {
      throw new Error(`Failed to load ${this.loadDocumentLabel}: ${url} (${response.status} ${response.statusText})`);
    }
    try {
      const text = await readSceneText(response, url);
      const sourceUrl = response.url || url;
      if (this.isYAMLSource(url)) {
        return this.fromYAML(text, { sourceUrl });
      }
      return this.fromJSON(text, { sourceUrl });
    } catch (err) {
      throw new Error(`Failed to parse ${this.getLoadParseLabel(url)}: ${url} (${err?.message ?? err})`);
    }
  }

  // 後段のvalidateやbuildへ渡す解析済みdocumentを差し替える
  // sourceDataSnapshotは自動更新せず、コメント付き原文との不整合を保存時に検出できる状態を保つ
  setData(data) {
    this.data = data;
    return this;
  }

  // 現在保持している解析済みdocumentを返す
  getData() {
    return this.data;
  }

  // 読み込み元の形式、原文、コメント一覧を返す
  // commentsは新しい配列へ複製し、呼出側がasset内部のコメント一覧を変更できないようにする
  getSourceDocument() {
    if (!this.sourceDocument) return null;
    return Object.freeze({
      ...this.sourceDocument,
      comments: Object.freeze([...(this.sourceDocument.comments ?? [])])
    });
  }

  // YAML/JSONを読み込んだ元URLを返し、相対参照の解決に利用する
  getSourceUrl() {
    return this.sourceDocument?.sourceUrl ?? null;
  }

  // JSON互換値の深い複製を返し、assetの内部配列を外部変更から分離する
  cloneJSONValue(value) {
    return cloneJSONValue(value);
  }

  // 整形済みJSONを返す
  // YAMLコメントを失う場合はallowCommentLoss=trueを明示し、意図しないコメント削除を防ぐ
  toJSONText(indent = 2, options = {}) {
    if (this.sourceDocument?.comments?.length && options.allowCommentLoss !== true) {
      throw new Error(`${this.constructor.assetTypeName} YAML comments cannot be exported as JSON without allowCommentLoss: true`);
    }
    return formatJSON(this.data, indent);
  }

  // YAML原文を値が未変更ならそのまま返し、コメントと字下げを保持する
  // 値だけが変更されたコメント付き文書は安全な対応付けができないため例外で停止する
  toYAMLText() {
    if (this.sourceDocument?.format === "yaml") {
      if (!dataMatchesSnapshot(this.data, this.sourceDataSnapshot)) {
        if (this.sourceDocument.comments.length > 0) {
          throw new Error(`${this.constructor.assetTypeName} YAML source changed; provide updated YAML text to preserve comments`);
        }
      } else {
        return this.sourceDocument.sourceText;
      }
    }
    return stringifySceneYAML(this.data);
  }

  // 現在のdocumentをJSONファイルとしてブラウザーからダウンロードする
  downloadJSON(filename = this.constructor.defaultJSONFilename, indent = 2, options = {}) {
    const text = this.toJSONText(indent, options);
    const blob = new Blob([text], { type: "application/json" });
    this.constructor.downloadBlob(blob, filename);
    return text;
  }

  // 現在のdocumentをYAMLファイルとしてブラウザーからダウンロードする
  downloadYAML(filename = this.constructor.defaultYAMLFilename) {
    const text = this.toYAMLText();
    const blob = new Blob([text], { type: "text/yaml;charset=utf-8" });
    this.constructor.downloadBlob(blob, filename);
    return text;
  }

  // 現在のdocumentをコメント付きYAML gzipファイルとしてダウンロードする
  async downloadYAMLGz(filename = this.constructor.defaultYAMLGzFilename) {
    const text = this.toYAMLText();
    const blob = await compressSceneYAML(text);
    this.constructor.downloadBlob(blob, filename);
    return { text, blob };
  }

  // Blobからブラウザーのダウンロードを開始し、完了後に一時URLを解放する
  // SceneAssetとModelAssetの保存処理で同じURL管理を使用する
  static downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
