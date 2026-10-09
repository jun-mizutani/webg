// ---------------------------------------------
// samples/scene_model_yaml/main.js  2026/09/19
// SceneYAMLの外部ModelYAML参照をPBRとCompute物理へ接続する
// Copyright (c) 2026 Jun Mizutani, MIT license
// ---------------------------------------------
import SceneAsset from "../../webg/SceneAsset.js";
import { createWebgSceneApp } from "../../webg/app/index.js";

let sceneApp = null;
let sceneAsset = null;
let modelAsset = null;
let stoppedByError = false;

// 初期化・描画・保存の失敗を画面に表示し、失敗理由を保持する
function showError(error) {
  const panel = document.getElementById("error");
  panel.hidden = false;
  panel.textContent = error instanceof Error ? error.message : String(error);
  console.error(error);
}

// フレーム処理の失敗時はループを止め、続行できない操作を無効にする
function handleRuntimeError(error) {
  stoppedByError = true;
  if (sceneApp) sceneApp.stop();
  for (const button of document.querySelectorAll("button")) button.disabled = true;
  showError(error);
}

// 物理の進行と読み込んだ二つの文書の情報を表示する
// 初期化完了前のcallbackでは、まだ参照できないsceneAppを使わない
function updateStatus() {
  if (!sceneApp) return;
  const state = sceneApp.getDiagnostics();
  const text = "SceneYAML → modelAssetUrl → ModelYAML → PBR + Compute物理\n" +
    "物理: " + (state.physics.paused ? "停止中" : "実行中") +
    " / body " + state.physics.bodyCount + " / binding " + state.physics.bindingCount +
    " / 固定更新 240Hz\n" +
    "SceneYAMLコメント " + sceneAsset.getSourceDocument().comments.length +
    " / ModelYAMLコメント " + modelAsset.getSourceDocument().comments.length;
  const target = document.getElementById("status");
  if (target.textContent !== text) target.textContent = text;
}

// 保存・操作をボタンへ接続し、例外を画面へ通知する
// 実行中の連打を防ぎ、処理完了後にボタンを再び使えるようにする
function connectButton(id, action) {
  const button = document.getElementById(id);
  button.disabled = false;
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await action();
      updateStatus();
    } catch (error) {
      showError(error);
    } finally {
      button.disabled = stoppedByError;
    }
  });
}

// SceneAssetが保持するSceneYAMLから起動し、モデル読込みはSceneDefinitionへ任せる
// 実際に描画されたModelAssetを参照するため、表示用に再fetchしない
async function start() {
  sceneAsset = await SceneAsset.load("./scene.yaml");
  sceneAsset.assertValid();
  sceneApp = await createWebgSceneApp({
    project: sceneAsset,
    camera: {
      target: [0, 1.4, 0], distance: 12, yaw: 18, pitch: -18,
      minDistance: 5, maxDistance: 24, wheelZoomStep: 0.5
    },
    physics: { enabled: true, paused: true, spatialMatch: "require-match" },
    onReadback: updateStatus,
    onError: handleRuntimeError
  });
  modelAsset = sceneApp.model.asset;
  document.getElementById("scene-source").textContent = sceneAsset.toYAMLText();
  document.getElementById("model-source").textContent = modelAsset.toYAMLText();

  connectButton("play", () => sceneApp.setPaused(false));
  connectButton("pause", () => sceneApp.setPaused(true));
  // Reset後は停止状態に統一し、初期位置を確認してから再実行できるようにする
  connectButton("reset", () => {
    sceneApp.setPaused(true);
    sceneApp.reset();
  });
  // 相対参照./model.yamlが維持されるよう、保存する名前も入力と揃える
  connectButton("save-scene", () => sceneAsset.downloadYAML("scene.yaml"));
  connectButton("save-model", () => modelAsset.downloadYAML("model.yaml"));
  updateStatus();
  sceneApp.start();
}

// module scriptはDOM構築後に実行されるため、そのまま起動する
start().catch(error => {
  handleRuntimeError(error);
  if (sceneApp) sceneApp.destroy();
});

// GPU処理とモデル・マテリアルの解放は高水準アプリへまとめて依頼する
window.addEventListener("pagehide", () => {
  if (sceneApp) sceneApp.destroy();
});
