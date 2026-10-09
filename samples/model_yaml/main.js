// ---------------------------------------------
// samples/model_yaml/main.js  2026/09/19
// ModelYAMLから共有モデルを構築し、個別のNodeへ配置する
// Copyright (c) 2026 Jun Mizutani, MIT license
// ---------------------------------------------
import WebgApp from "../../webg/WebgApp.js";
import ModelAsset from "../../webg/ModelAsset.js";

let app = null;
let asset = null;
let runtime = null;
let rotating = false;
const instances = [];
const gems = [];

// 起動と保存の失敗を画面に表示する
// 入力ファイルを別のモデルへ差し替えず、原因をそのまま利用者へ伝える
function showError(error) {
  const panel = document.getElementById("error");
  panel.hidden = false;
  panel.textContent = error instanceof Error ? error.message : String(error);
  console.error(error);
}

// ボタンに非同期処理を接続し、保存失敗も画面へ通知する
// 処理中は同じ操作の二重実行を防ぎ、完了後に再び操作できる状態へ戻す
function connectButton(id, action) {
  const button = document.getElementById(id);
  button.disabled = false;
  button.addEventListener("click", async () => {
    button.disabled = true;
    document.getElementById("error").hidden = true;
    try {
      await action();
    } catch (error) {
      showError(error);
    } finally {
      button.disabled = false;
    }
  });
}

// 表示中の結晶だけを回転させ、YAML内の初期配置は保持する
// deltaSecはWebgAppが渡すフレーム間隔で、角度は度数で指定する
function updateFrame({ deltaSec }) {
  if (!rotating) return;
  for (const gem of gems) gem.rotateY(30 * deltaSec);
}

// 更新を止めてから、配置と共有GPUリソースを順番に片付ける
// 起動途中の失敗でも、構築済みの範囲を解放できるようにする
function dispose() {
  if (app) app.stop();
  for (const instance of instances) instance.destroy();
  instances.length = 0;
  gems.length = 0;
  if (runtime) {
    runtime.destroy();
    runtime = null;
  }
}

// ModelYAMLの取得と検証を終えた後、GPUを初期化してモデルを構築する
// buildは1回、instantiateは3回に分け、形状を共有しながら配置を分ける
async function start() {
  asset = await ModelAsset.load("./model.yaml");
  asset.assertValid();
  const data = asset.getData();
  const source = asset.getSourceDocument();
  document.getElementById("source").textContent = source.sourceText;

  app = new WebgApp({
    document,
    useMessage: false,
    layoutMode: "embedded",
    fixedCanvasSize: { width: 900, height: 560 },
    clearColor: [0.055, 0.085, 0.14, 1],
    lightPosition: [3, 8, 10, 1],
    debugTools: { mode: "release", system: "model_yaml" }
  });
  await app.init();
  app.createOrbitEyeRig({
    target: [0, 0.9, 0], distance: 11, yaw: 15, pitch: -16,
    minDistance: 4, maxDistance: 30, wheelZoomStep: 0.5
  });

  runtime = asset.build(app.getGPU());
  // 同じroot IDを各配置のnodeMapから取得するため、位置を個別に変えられる
  for (const x of [-2.6, 0, 2.6]) {
    const instance = runtime.instantiate(app.space);
    instances.push(instance);
    const root = instance.nodeMap.get("root");
    const gem = instance.nodeMap.get("gem");
    if (!root || !gem) throw new Error("model.yaml requires root and gem nodes");
    root.setPosition(x, 0, 0);
    gems.push(gem);
  }

  const triangles = data.meshes.reduce((sum, mesh) => sum + mesh.geometry.indices.length / 3, 0);
  document.getElementById("status").textContent =
    "ModelYAML検証成功 / メッシュ " + data.meshes.length +
    " / Node " + data.nodes.length + " / 三角形 " + triangles +
    "（1組） / 配置 " + instances.length + " / コメント " + source.comments.length +
    "\n保存対象は元のモデル定義です。画面上の3組の配置と回転はJavaScriptで設定しています。";

  connectButton("rotate", () => {
    rotating = !rotating;
    document.getElementById("rotate").textContent = rotating ? "回転を停止" : "回転を開始";
  });
  // Assetの値を変更していないので、YAML保存はコメントと字下げを含む原文を返す
  connectButton("save", () => asset.downloadYAML("crystal.model.yaml"));
  connectButton("gzip", () => asset.downloadYAMLGz("crystal.model.yaml.gz"));
  app.start({ onUpdate: updateFrame });
}

// module scriptはDOM構築後に実行されるため、そのまま初期化を開始する
start().catch(error => {
  dispose();
  showError(error);
});
window.addEventListener("pagehide", dispose);
