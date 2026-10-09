// ---------------------------------------------
//  project_app_object_set_variants_demo.js  2026/09/08
//   General WebgSceneApp objectSets variants fixture
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// samples/project_app public fixture
import { createWebgSceneApp } from "../../webg/app/index.js";

const PROJECT_URL = "./project_app_object_set_variants_project.yaml?v=20260909scene-yaml1";
const CAMERA_OPTIONS = {
  target: [0.0, 1.0, 0.0],
  distance: 7.2,
  yaw: 0.0,
  pitch: -12.0,
  minDistance: 3.5,
  maxDistance: 16.0,
  wheelZoomStep: 0.6
};

let sceneApp = null;
let statusElement = null;

// variantsで選択された種類を生成IDとCompute bodyへ対応付けて表示します
// 利用者が形状混在の圧縮定義を実行中の個体へ追跡できることを確認するfixtureです
function updateStatus() {
  const diagnostics = sceneApp.getDiagnostics();
  const physics = diagnostics.physics;
  const renderer = diagnostics.renderer;
  const sources = diagnostics.project.objectSources ?? [];
  const generated = sources.filter((entry) => entry.source.type === "objectSet");
  const first = generated[0];
  const last = generated[generated.length - 1];
  const nextStatus = [
    "WebgSceneApp / objectSets variants cycle",
    `project: ${diagnostics.project.name}  scene: ${diagnostics.project.sceneKind}`,
    `objects: ${diagnostics.project.objectCount ?? 0}  objectSets: ${diagnostics.project.objectSetCount ?? 0}`,
    `ids: ${first?.id ?? "none"} ... ${last?.id ?? "none"}`,
    `variants: ${first?.source.variantId ?? "none"} -> ${generated[1]?.source.variantId ?? "none"} -> ${generated[2]?.source.variantId ?? "none"}`,
    "instancePattern: orientation/velocity cycle, mass range",
    `bodies: ${physics?.bodyCount ?? 0}  bindings: ${physics?.bindingCount ?? 0}  planes: 1`,
    `physics: ${physics?.paused ? "paused" : "running"}  readback: ${physics?.readbackPending ? "pending" : "ready"}`,
    `frame: ${physics?.frameIndex ?? 0}  last readback: ${diagnostics.lastReadback?.frameIndex ?? "none"}`,
    `profile: ${renderer.profile}  environment: ${renderer.hasEnvironment ? "ready" : "unavailable"}`,
    "Drag: orbit   Wheel: zoom"
  ].join("\n");
  if (statusElement.textContent !== nextStatus) statusElement.textContent = nextStatus;
}

// projectだけを指定し、複数variant、grid3d、個体overrideをWebgSceneAppへ委譲します
// 物体ごとのshapeとphysicsを一つずつ並べず、variantsとcycle patternで同じ条件を表現します
async function start() {
  statusElement = document.getElementById("status");
  const startButton = document.getElementById("start");
  const stopButton = document.getElementById("stop");
  const resetButton = document.getElementById("reset");
  if (!statusElement || !startButton || !stopButton || !resetButton) {
    throw new Error("project_app_object_set_variants controls are unavailable");
  }
  sceneApp = await createWebgSceneApp({
    project: PROJECT_URL,
    camera: CAMERA_OPTIONS,
    physics: { enabled: true, spatialMatch: "report", paused: true },
    onReadback: updateStatus,
    onPresented: updateStatus,
    onError: (error) => {
      console.error("project_app_object_set_variants runtime failed:", error);
      statusElement.textContent = `project_app_object_set_variants runtime failed\n${error?.message ?? String(error)}`;
    }
  });
  startButton.addEventListener("click", () => { sceneApp.setPaused(false); updateStatus(); });
  stopButton.addEventListener("click", () => { sceneApp.setPaused(true); updateStatus(); });
  resetButton.addEventListener("click", () => { sceneApp.reset(); updateStatus(); });
  updateStatus();
  sceneApp.start();
}

// 初期化エラーを画面へ表示し、variant参照の検証位置を残します
document.addEventListener("DOMContentLoaded", () => {
  start().catch((error) => {
    console.error("project_app_object_set_variants failed:", error);
    if (statusElement) statusElement.textContent = `project_app_object_set_variants failed\n${error?.message ?? String(error)}`;
  });
});

// page終了時にWebgSceneAppへGPU resourceとframe loopの解放を依頼します
window.addEventListener("pagehide", () => {
  sceneApp?.destroy();
  sceneApp = null;
});
