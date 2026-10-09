// ---------------------------------------------
//  project_app_object_set_demo.js  2026/09/08
//   General WebgSceneApp objectSets fixture
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// samples/project_app public fixture
import { createWebgSceneApp } from "../../webg/app/index.js";

const PROJECT_URL = "./project_app_object_set_project.yaml?v=20260909scene-yaml1";
const CAMERA_OPTIONS = {
  target: [0.0, 1.35, 0.0],
  distance: 8.5,
  yaw: 0.0,
  pitch: -10.0,
  minDistance: 4.0,
  maxDistance: 18.0,
  wheelZoomStep: 0.6
};

let sceneApp = null;
let statusElement = null;

// objectSetsの生成結果をobject ID、source set、physics bodyへ対応付けて表示します
// 利用者が圧縮した定義から個体を追跡できることを確認するfixtureです
function updateStatus() {
  const diagnostics = sceneApp.getDiagnostics();
  const physics = diagnostics.physics;
  const renderer = diagnostics.renderer;
  const sources = diagnostics.project.objectSources ?? [];
  const first = sources.find((entry) => entry.source.type === "objectSet");
  const last = [...sources].reverse().find((entry) => entry.source.type === "objectSet");
  const nextStatus = [
    "WebgSceneApp / objectSets grid3d",
    `project: ${diagnostics.project.name}  scene: ${diagnostics.project.sceneKind}`,
    `objects: ${diagnostics.project.objectCount ?? 0}  objectSets: ${diagnostics.project.objectSetCount ?? 0}`,
    `ids: ${first?.id ?? "none"} ... ${last?.id ?? "none"}`,
    `source: ${first?.source.setId ?? "none"}  index=${first?.source.index ?? "-"}`,
    `bodies: ${physics?.bodyCount ?? 0}  bindings: ${physics?.bindingCount ?? 0}  planes: 1`,
    `physics: ${physics?.paused ? "paused" : "running"}  readback: ${physics?.readbackPending ? "pending" : "ready"}`,
    `frame: ${physics?.frameIndex ?? 0}  last readback: ${diagnostics.lastReadback?.frameIndex ?? "none"}`,
    `profile: ${renderer.profile}  environment: ${renderer.hasEnvironment ? "ready" : "unavailable"}`,
    "Drag: orbit   Wheel: zoom"
  ].join("\n");
  if (statusElement.textContent !== nextStatus) statusElement.textContent = nextStatus;
}

// projectだけを指定し、16個のBox、PBR材質、Compute bodyをWebgSceneAppへ委譲します
// 個別objectを16個並べず、objectSetsのprototypeとgrid3dで同じ条件を表現します
async function start() {
  statusElement = document.getElementById("status");
  const startButton = document.getElementById("start");
  const stopButton = document.getElementById("stop");
  const resetButton = document.getElementById("reset");
  if (!statusElement || !startButton || !stopButton || !resetButton) {
    throw new Error("project_app_object_set controls are unavailable");
  }
  sceneApp = await createWebgSceneApp({
    project: PROJECT_URL,
    camera: CAMERA_OPTIONS,
    physics: { enabled: true, spatialMatch: "report", paused: true },
    onReadback: updateStatus,
    onPresented: updateStatus,
    onError: (error) => {
      console.error("project_app_object_set runtime failed:", error);
      statusElement.textContent = `project_app_object_set runtime failed\n${error?.message ?? String(error)}`;
    }
  });
  startButton.addEventListener("click", () => { sceneApp.setPaused(false); updateStatus(); });
  stopButton.addEventListener("click", () => { sceneApp.setPaused(true); updateStatus(); });
  resetButton.addEventListener("click", () => { sceneApp.reset(); updateStatus(); });
  updateStatus();
  sceneApp.start();
}

// 初期化エラーを画面へ表示し、projectの配置規則と検証位置を残します
document.addEventListener("DOMContentLoaded", () => {
  start().catch((error) => {
    console.error("project_app_object_set failed:", error);
    if (statusElement) statusElement.textContent = `project_app_object_set failed\n${error?.message ?? String(error)}`;
  });
});

// page終了時にWebgSceneAppへGPU resourceとframe loopの解放を依頼します
window.addEventListener("pagehide", () => {
  sceneApp?.destroy();
  sceneApp = null;
});
