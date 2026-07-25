// ---------------------------------------------
// unittest/compression/main.js  2026/04/27
//   compression unittest
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import Primitive from "../../webg/Primitive.js";
import ModelValidator from "../../webg/ModelValidator.js";
import ModelAsset from "../../webg/ModelAsset.js";

// DOM 上の各操作部品を最初に取得し、以後の処理はこの ui object 経由に統一する
// Compression Streams API 自体は DOM と独立しているが、この unittest では入力、結果表示、
// download button の状態を 1 画面で追えるようにする
const ui = {
  loadSample: document.getElementById("loadSample"),
  fileInput: document.getElementById("fileInput"),
  compress: document.getElementById("compress"),
  decompress: document.getElementById("decompress"),
  downloadCompressed: document.getElementById("downloadCompressed"),
  downloadRestored: document.getElementById("downloadRestored"),
  jsonText: document.getElementById("jsonText"),
  status: document.getElementById("status"),
  restored: document.getElementById("restored")
};

// 圧縮処理の結果は browser 内の Blob と文字列として保持する
// textarea の内容が変わった時は、この state を消して「直近の圧縮結果は無効」と分かる状態に戻す
const state = {
  compressedBlob: null,
  restoredText: "",
  sourceFilename: "modelasset.json",
  stats: null
};

const encoder = new TextEncoder();
const validator = new ModelValidator();

// Compression Streams API が使える環境か確認する
// CompressionStream だけでは復元確認ができないため、DecompressionStream も必須にしている
function supportsCompressionStreams() {
  return typeof CompressionStream === "function"
    && typeof DecompressionStream === "function"
    && typeof Blob === "function"
    && typeof Response === "function";
}

// JS 文字列長ではなく UTF-8 byte 数を測る
// JSON に日本語や非 ASCII が入った場合も、実際に圧縮される byte 数で比較する
function byteLength(text) {
  return encoder.encode(text).byteLength;
}

// status 表示用に byte 数を読みやすい単位へ変換する
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

// 圧縮後サイズが元サイズに対して何 % になったかを表示する
// 100% 未満なら小さくなり、100% 以上なら gzip header 等の分だけ増えたことを示す
function formatRatio(originalBytes, compressedBytes) {
  if (originalBytes <= 0) return "n/a";
  return `${((compressedBytes / originalBytes) * 100).toFixed(2)}%`;
}

// JSON 文字列を Blob stream に変換し、CompressionStream に流して gzip Blob を作る
// CompressionStream は byte stream を扱うため、ModelAsset の構造はここでは変更しない
async function compressText(text, format = "gzip") {
  if (format !== "gzip") {
    throw new Error(`unsupported compression format: ${format}`);
  }
  return await ModelAsset.compressTextToGzipBlob(text);
}

// gzip Blob を DecompressionStream に流し、復元後の JSON 文字列として読む
// 圧縮結果が本当に利用可能かを確認するため、compress 後に必ずこの経路も通す
async function decompressBlob(blob, format = "gzip") {
  if (format !== "gzip") {
    throw new Error(`unsupported decompression format: ${format}`);
  }
  return await ModelAsset.decompressGzipBlobToText(blob);
}

// textarea の内容を JSON として parse し、ModelAsset の最低限の構造を検証する
// 圧縮自体は任意の text に対して可能だが、この unittest は ModelAsset JSON 用なので事前検証する
function validateModelAssetText(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error(`JSON parse failed: ${err?.message ?? err}`);
  }
  const result = validator.validate(data);
  if (!result.ok) {
    const lines = result.errors
      .slice(0, 8)
      .map((item) => `${item.path}: ${item.message}`);
    throw new Error(`ModelAsset validation failed\n${lines.join("\n")}`);
  }
  return {
    data,
    warningCount: result.warnings.length
  };
}

// 起動直後や Load Sample で使う確認用 ModelAsset JSON を作る
// Primitive.cube() の出力を使うことで、positions / indices / uvs など実際の geometry を含む
function makeSampleModelAssetText() {
  const asset = Primitive.cube(8, {
    txMode: 1,
    txAxis: 1,
    txScaleU: 4,
    txScaleV: 4
  });
  const data = asset.getData();
  data.meta = {
    ...(data.meta ?? {}),
    name: "compression_unittest_cube",
    generator: "unittest/compression",
    source: "Primitive.cube",
    unitScale: 1.0,
    upAxis: "Y"
  };
  return JSON.stringify(data, null, 2);
}

// Blob を一時 URL に変換し、hidden anchor を click して browser download を開始する
// 圧縮済み Blob と復元 JSON Blob の両方で同じ helper を使う
function downloadBlob(blob, filename) {
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

// status panel へ現在の段階や error を表示する
// className は CSS の ok / warn / error 色分けに使う
function setStatus(message, className = "") {
  ui.status.className = className;
  ui.status.textContent = message;
}

// API 対応状況と state の有無に応じて button の有効 / 無効を更新する
// 圧縮結果がない状態では decompress と download を押せないようにする
function updateButtons() {
  const supported = supportsCompressionStreams();
  ui.compress.disabled = !supported;
  ui.decompress.disabled = !supported || !state.compressedBlob;
  ui.downloadCompressed.disabled = !state.compressedBlob;
  ui.downloadRestored.disabled = !state.restoredText;
}

// 圧縮処理の統計を status panel にまとめて表示する
// state.stats が無い場合は、API 対応状況だけを表示して待機状態にする
function renderStats(prefix = "ready") {
  const supported = supportsCompressionStreams();
  const supportLine = supported
    ? "CompressionStream: yes\nDecompressionStream: yes"
    : "CompressionStream: no\nDecompressionStream: no";
  if (!state.stats) {
    setStatus(`${prefix}\n${supportLine}`);
    updateButtons();
    return;
  }
  const { originalBytes, compressedBytes, restoredBytes, warningCount, match } = state.stats;
  setStatus(
    `${prefix}\n`
    + `${supportLine}\n`
    + `source: ${state.sourceFilename}\n`
    + `original: ${formatBytes(originalBytes)}\n`
    + `compressed: ${formatBytes(compressedBytes)} (${formatRatio(originalBytes, compressedBytes)})\n`
    + `restored: ${formatBytes(restoredBytes)}\n`
    + `modelAssetWarnings: ${warningCount}\n`
    + `roundTripMatch: ${match ? "yes" : "no"}`,
    match ? "ok" : "warn"
  );
  updateButtons();
}

// Compress button の主処理
// 1. API 対応を確認
// 2. textarea の ModelAsset JSON を検証
// 3. gzip 圧縮
// 4. 直後に復元
// 5. 元文字列と復元文字列の完全一致を記録
async function runCompression() {
  if (!supportsCompressionStreams()) {
    throw new Error("Compression Streams API is not available in this browser");
  }
  const text = ui.jsonText.value;
  const validation = validateModelAssetText(text);
  const compressedBlob = await compressText(text, "gzip");
  const restoredText = await decompressBlob(compressedBlob, "gzip");
  state.compressedBlob = compressedBlob;
  state.restoredText = restoredText;
  state.stats = {
    originalBytes: byteLength(text),
    compressedBytes: compressedBlob.size,
    restoredBytes: byteLength(restoredText),
    warningCount: validation.warningCount,
    match: restoredText === text
  };
  ui.restored.textContent = restoredText.slice(0, 12000);
  renderStats("compressed and decompressed");
}

// 画面上の各 button と file input に処理を割り当てる
// ここでは DOM event から state 更新へつなぎ、圧縮ロジック自体は helper 関数に任せる
function installHandlers() {
  // sample JSON を読み直し、直近の圧縮結果と復元 preview を破棄する
  ui.loadSample.addEventListener("click", () => {
    state.sourceFilename = "compression_unittest_modelasset.json";
    state.compressedBlob = null;
    state.restoredText = "";
    state.stats = null;
    ui.jsonText.value = makeSampleModelAssetText();
    ui.restored.textContent = "";
    renderStats("sample loaded");
  });

  // ユーザーが選択した ModelAsset JSON を textarea に読み込み、圧縮待ち状態へ戻す
  ui.fileInput.addEventListener("change", async () => {
    const file = ui.fileInput.files?.[0];
    if (!file) return;
    state.sourceFilename = file.name;
    state.compressedBlob = null;
    state.restoredText = "";
    state.stats = null;
    ui.jsonText.value = ModelAsset.isGzipSource(file.name)
      ? await ModelAsset.decompressGzipBlobToText(file)
      : await file.text();
    ui.restored.textContent = "";
    renderStats(`loaded ${file.name}`);
  });

  // 現在の textarea 内容を gzip 圧縮し、復元一致まで一気に確認する
  ui.compress.addEventListener("click", async () => {
    try {
      setStatus("compressing...");
      await runCompression();
    } catch (err) {
      state.compressedBlob = null;
      state.restoredText = "";
      state.stats = null;
      updateButtons();
      setStatus(`error:\n${err?.message ?? err}`, "error");
    }
  });

  // 直近の圧縮 Blob だけをもう一度復元し、preview を更新する
  // 圧縮済み byte stream を保存後に読み戻す処理の最小確認になる
  ui.decompress.addEventListener("click", async () => {
    try {
      if (!state.compressedBlob) return;
      state.restoredText = await decompressBlob(state.compressedBlob, "gzip");
      ui.restored.textContent = state.restoredText.slice(0, 12000);
      renderStats("decompressed existing blob");
    } catch (err) {
      setStatus(`error:\n${err?.message ?? err}`, "error");
    }
  });

  // 直近の gzip Blob を `.json.gz` として保存する
  // 中身は ModelAsset JSON の gzip byte stream で、JSON 構造そのものは変更していない
  ui.downloadCompressed.addEventListener("click", () => {
    if (!state.compressedBlob) return;
    const name = state.sourceFilename.replace(/\.json$/i, "") || "modelasset";
    downloadBlob(state.compressedBlob, `${name}.json.gz`);
  });

  // 復元済み JSON を通常の `.json` として保存する
  // roundTripMatch が yes の場合、元 textarea 内容と byte 単位で同じ文字列になる
  ui.downloadRestored.addEventListener("click", () => {
    if (!state.restoredText) return;
    const blob = new Blob([state.restoredText], { type: "application/json" });
    const name = state.sourceFilename.replace(/\.json$/i, "") || "modelasset";
    downloadBlob(blob, `${name}.restored.json`);
  });
}

// 起動時に event handler を登録し、確認用 ModelAsset JSON を textarea へ読み込む
// ブラウザが Compression Streams API に未対応でも、画面上で理由が分かる状態にする
function start() {
  installHandlers();
  ui.jsonText.value = makeSampleModelAssetText();
  renderStats(supportsCompressionStreams() ? "sample loaded" : "Compression Streams API is not available");
}

start();
