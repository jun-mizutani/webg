// ---------------------------------------------
//  ModelAsset.js    2026/04/27
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import ModelValidator from "./ModelValidator.js";
import ModelBuilder from "./ModelBuilder.js";
import formatJSON from "./JsonFormat.js";

export default class ModelAsset {

  // JSON と helper を束ねる高レベル入口を初期化する
  constructor(data = null) {
    // 生データ保持、validation、build の窓口を 1 クラスにまとめる
    this.data = data;
    this.validator = new ModelValidator();
  }

  // 既存 object から生成する
  static fromData(data) {
    return new ModelAsset(data);
  }

  // JSON 文字列から生成する
  static fromJSON(text) {
    try {
      return new ModelAsset(JSON.parse(text));
    } catch (err) {
      throw new Error(`Failed to parse ModelAsset JSON: ${err?.message ?? err}`);
    }
  }

  // ファイル名や URL から gzip 圧縮された ModelAsset JSON か判定する
  // Content-Type ではなく拡張子で判定することで、静的 file server ごとの MIME 差を避ける
  static isGzipSource(source) {
    const path = String(source ?? "").trim().toLowerCase().split(/[?#]/, 1)[0];
    return path.endsWith(".json.gz");
  }

  // Compression Streams API の対応状況を、処理の入口で明示的に検査する
  // gzip は保存・転送形式であり、未対応環境で通常 JSON として誤読すると原因が見えにくいため例外にする
  static assertCompressionStreamSupport(operation = "gzip ModelAsset JSON") {
    if (typeof Blob !== "function" || typeof Response !== "function") {
      throw new Error(`${operation} requires Blob and Response APIs`);
    }
    if (typeof CompressionStream !== "function") {
      throw new Error(`${operation} requires CompressionStream API`);
    }
    if (typeof DecompressionStream !== "function") {
      throw new Error(`${operation} requires DecompressionStream API`);
    }
  }

  // JSON 文字列を gzip Blob へ変換する
  // ModelAsset の構造は変更せず、UTF-8 JSON byte stream だけを gzip 圧縮する
  static async compressTextToGzipBlob(text) {
    ModelAsset.assertCompressionStreamSupport("ModelAsset gzip compression");
    const source = new Blob([String(text)], { type: "application/json" });
    const stream = source.stream().pipeThrough(new CompressionStream("gzip"));
    return await new Response(stream).blob();
  }

  // gzip Blob を復元して JSON 文字列として返す
  // 復元に失敗した場合は gzip stream ではない可能性が高いため、通常 JSON へ自動的には切り替えない
  static async decompressGzipBlobToText(blob) {
    ModelAsset.assertCompressionStreamSupport("ModelAsset gzip decompression");
    const stream = blob.stream().pipeThrough(new DecompressionStream("gzip"));
    return await new Response(stream).text();
  }

  // gzip 圧縮された ModelAsset JSON Blob から生成する
  static async fromGzipBlob(blob) {
    try {
      return ModelAsset.fromJSON(await ModelAsset.decompressGzipBlobToText(blob));
    } catch (err) {
      throw new Error(`Failed to parse gzip ModelAsset JSON: ${err?.message ?? err}`);
    }
  }

  // URL から JSON または .json.gz をロードする
  static async load(url) {
    let response;
    try {
      response = await fetch(url);
    } catch (err) {
      throw new Error(`Failed to load ModelAsset: ${url} (${err?.message ?? err})`);
    }
    if (!response.ok) {
      throw new Error(`Failed to load ModelAsset: ${url} (${response.status} ${response.statusText})`);
    }
    if (ModelAsset.isGzipSource(url)) {
      try {
        return await ModelAsset.fromGzipBlob(await response.blob());
      } catch (err) {
        throw new Error(`Failed to parse gzip ModelAsset JSON: ${url} (${err?.message ?? err})`);
      }
    }
    try {
      return new ModelAsset(await response.json());
    } catch (err) {
      throw new Error(`Failed to parse ModelAsset JSON: ${url} (${err?.message ?? err})`);
    }
  }

  // 保持データを差し替える
  setData(data) {
    this.data = data;
    return this;
  }

  // 保持データを返す
  getData() {
    return this.data;
  }

  // JSON 互換データなので stringify/parse で copy する
  cloneJSONValue(value) {
    return JSON.parse(JSON.stringify(value));
  }

  // vec3 が連続する配列へ uniform scale を掛ける
  // - geometry positions や transform translation を同じ規則で拡大する
  // - ModelAsset は JSON 互換配列を前提にしているが、typed array でも index 書き込み可能なら扱える
  scaleTriplets(values, scale) {
    if (values === undefined || values === null) {
      return;
    }
    if (typeof values.length !== "number" || values.length % 3 !== 0) {
      throw new Error("ModelAsset triplet data must be an array-like value whose length is a multiple of 3");
    }
    for (let i = 0; i + 2 < values.length; i += 3) {
      if (!Number.isFinite(values[i]) || !Number.isFinite(values[i + 1]) || !Number.isFinite(values[i + 2])) {
        throw new Error(`ModelAsset triplet data must contain only finite numbers at index ${i}`);
      }
      values[i] *= scale;
      values[i + 1] *= scale;
      values[i + 2] *= scale;
    }
  }

  // 4x4 行列の平行移動成分だけを拡大する
  // - 回転成分はそのまま保ち、translation だけを uniform scale に合わせて伸ばす
  // - inverseBindMatrix も bind pose との整合を保つため同じ規則で扱う
  scaleMatrixTranslation(matrix, scale) {
    if (matrix === undefined || matrix === null) {
      return;
    }
    if (typeof matrix.length !== "number" || matrix.length < 16) {
      throw new Error("ModelAsset matrix translation target must be an array-like 4x4 matrix");
    }
    if (!Number.isFinite(matrix[12]) || !Number.isFinite(matrix[13]) || !Number.isFinite(matrix[14])) {
      throw new Error("ModelAsset matrix translation components must be finite");
    }
    matrix[12] *= scale;
    matrix[13] *= scale;
    matrix[14] *= scale;
  }

  // clip 定義を id 指定で返す
  getClip(id) {
    if (!this.data || !Array.isArray(this.data.animations)) {
      return null;
    }
    const clipId = String(id ?? "").trim();
    if (!clipId) {
      return null;
    }
    const clip = this.data.animations.find((item) => item?.id === clipId);
    return clip ? this.cloneJSONValue(clip) : null;
  }

  // clip 定義一覧を copy で返す
  getClips() {
    if (!this.data || !Array.isArray(this.data.animations)) {
      return [];
    }
    return this.cloneJSONValue(this.data.animations);
  }

  // clip 名一覧だけを返す
  getClipNames() {
    return this.getClips().map((clip) => clip.id);
  }

  // clip の要約情報を返す
  getClipInfo(id) {
    const clip = this.getClip(id);
    if (!clip) {
      return null;
    }
    const times = Array.isArray(clip.times) ? clip.times : [];
    for (let i = 0; i < times.length; i++) {
      if (!Number.isFinite(times[i])) {
        throw new Error(`ModelAsset clip "${clip.id}" has a non-finite time at index ${i}`);
      }
    }
    const firstTime = times.length > 0 ? Number(times[0]) : 0;
    const lastTime = times.length > 0 ? Number(times[times.length - 1]) : firstTime;
    const durationMs = Math.max(0, (lastTime - firstTime) * 1000);
    return {
      id: clip.id,
      targetSkeleton: clip.targetSkeleton ?? null,
      keyCount: times.length,
      trackCount: Array.isArray(clip.tracks) ? clip.tracks.length : 0,
      durationMs: Math.round(durationMs * 1000) / 1000
    };
  }

  // model 全体へ uniform scale を焼き込む
  // - Node が local scale を継続保持しない構成でも、
  //   mesh / skeleton / animation の translation を data 側でそろえて拡大できる
  // - skinned mesh では geometry だけでなく joint / pose translation も同時に拡大しないと
  //   見た目サイズと骨変形がずれて pose が崩れるため、関連箇所をまとめて更新する
  scaleUniform(scale) {
    const ratio = Number(scale);
    if (!Number.isFinite(ratio) || ratio <= 0.0) {
      throw new Error(`ModelAsset.scaleUniform(scale) requires a positive finite scale: ${scale}`);
    }
    if (!this.data || Math.abs(ratio - 1.0) < 1.0e-6) {
      return this;
    }

    for (let i = 0; i < (this.data.meshes?.length ?? 0); i++) {
      this.scaleTriplets(this.data.meshes[i]?.geometry?.positions, ratio);
    }

    for (let i = 0; i < (this.data.nodes?.length ?? 0); i++) {
      const node = this.data.nodes[i];
      this.scaleTriplets(node?.transform?.translation, ratio);
      this.scaleMatrixTranslation(node?.matrix, ratio);
    }

    for (let i = 0; i < (this.data.skeletons?.length ?? 0); i++) {
      const skeleton = this.data.skeletons[i];
      this.scaleMatrixTranslation(skeleton?.bindShapeMatrix, ratio);
      for (let j = 0; j < (skeleton?.joints?.length ?? 0); j++) {
        const joint = skeleton.joints[j];
        this.scaleMatrixTranslation(joint?.localMatrix, ratio);
        this.scaleMatrixTranslation(joint?.inverseBindMatrix, ratio);
      }
    }

    for (let i = 0; i < (this.data.animations?.length ?? 0); i++) {
      const animation = this.data.animations[i];
      for (let j = 0; j < (animation?.tracks?.length ?? 0); j++) {
        const track = animation.tracks[j];
        for (let k = 0; k < (track?.poses?.length ?? 0); k++) {
          this.scaleMatrixTranslation(track.poses[k], ratio);
        }
      }
    }

    return this;
  }

  // 整形済み JSON 文字列へ変換する
  toJSONText(indent = 2) {
    return formatJSON(this.data, indent);
  }

  // 現在の ModelAsset を gzip Blob へ変換する
  // download を伴わない経路でも使えるよう、Blob 生成と保存開始を分離しておく
  async toJSONGzBlob(indent = 2) {
    return await ModelAsset.compressTextToGzipBlob(this.toJSONText(indent));
  }

  // Blob を一時 URL にして browser download を開始する
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

  // 現在の ModelAsset を JSON ファイルとしてダウンロードする
  downloadJSON(filename = "modelasset.json", indent = 2) {
    const text = this.toJSONText(indent);
    const blob = new Blob([text], { type: "application/json" });
    ModelAsset.downloadBlob(blob, filename);
    return text;
  }

  // 現在の ModelAsset を gzip 圧縮済み JSON としてダウンロードする
  // 非同期 API なので、呼び出し側は await し、未対応環境の例外を UI に表示する
  async downloadJSONGz(filename = "modelasset.json.gz", indent = 2) {
    const text = this.toJSONText(indent);
    const blob = await ModelAsset.compressTextToGzipBlob(text);
    ModelAsset.downloadBlob(blob, filename);
    return {
      text,
      blob
    };
  }

  // 妥当性検証を実行する
  validate() {
    return this.validator.validate(this.data);
  }

  // 妥当性検証に失敗したら例外にする
  assertValid() {
    return this.validator.assertValid(this.data);
  }

  // runtime オブジェクトを生成する
  build(gpu) {
    const builder = new ModelBuilder(gpu);
    return builder.build(this.data);
  }
}
