// ---------------------------------------------
// unittest/scene_mesh/main.js 2026/10/04
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
// 公開WebgSceneAppでYAMLを読み、表示meshと明示した衝突形状のCompute物理更新を確認する
import { createWebgSceneApp } from "../../webg/app/index.js";

const result = document.getElementById("result");
const ids = ["meshBox", "meshSphere", "meshCapsule"];
let readbacks = 0;
const contacted = new Set();

// GPU状態を描画Nodeへ反映した後に高さを取得し、各物体の床付近への到達を記録する
// 到達済みの3体が現在も指定の高さ範囲に揃うと、このページの確認条件をPASSとする
function showReadback({ sceneApp }) {
  readbacks += 1;
  const heights = ids.map((id) => sceneApp.scene.getNode(id).getWorldMatrix().mat[13]);
  heights.forEach((height, index) => {
    if (Number.isFinite(height) && height > 0.3 && height < 0.7) {
      contacted.add(ids[index]);
    }
  });
  const landed = contacted.size === ids.length
    && heights.every((height) => Number.isFinite(height) && height > 0.3 && height < 0.7);
  result.textContent = [
    landed ? "PASS: 3種類の衝突形状で床付近への落下を確認" : "確認中",
    `readbacks: ${readbacks}`,
    ...ids.map((id, index) => `${id}: y=${heights[index].toFixed(4)}`)
  ].join("\n");
}

// 初期化または実行中の例外を結果欄へ表示し、原因の位置をstackから確認できるようにする
function showError(error) {
  result.textContent = `ERROR: ${error.stack ?? error.message}`;
}

// project URLからmeshとprimitiveを構築し、GPU読み戻しの通知を結果表示へ接続する
async function start() {
  const app = await createWebgSceneApp({
    project: "./scene.yaml",
    paused: false,
    camera: { target: [0, 1, 0], distance: 11, yaw: 15, pitch: -20 },
    onReadback: showReadback,
    onError: showError
  });
  app.start();
}

start().catch(showError);
