// ---------------------------------------------
//  project_app_joint_demo.js  2026/09/08
//   General WebgSceneApp primitive Distance Joint fixture
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// samples/project_app public fixture
import { createWebgSceneApp } from "../../webg/app/index.js";

const PROJECT_URL = "./project_app_joint_project.yaml?v=20260909scene-yaml1";
const CAMERA_OPTIONS = {
  target: [0.0, 1.2, 0.0],
  distance: 8.5,
  yaw: 0.0,
  pitch: -9.0,
  minDistance: 4.5,
  maxDistance: 16.0,
  wheelZoomStep: 0.6
};

let sceneApp = null;
let statusElement = null;

// WebgSceneAppの診断結果から、object IDを使ったJoint登録結果を表示します
// GPU body ID、Joint ID、両端のobject IDを同じ画面で確認できる構成です
function updateStatus() {
  const diagnostics = sceneApp.getDiagnostics();
  const physics = diagnostics.physics;
  const renderer = diagnostics.renderer;
  const joints = physics?.projectJoints ?? [];
  const jointSummary = joints.map((joint) => (
    `${joint.id}: ${joint.a.body}(${joint.a.bodyId}) - ${joint.b.body}(${joint.b.bodyId}) length=${joint.lengthMeters}`
  ));
  const nextStatus = [
    "WebgSceneApp / primitive Distance Joint",
    `objects: ${diagnostics.project.objectCount ?? 0}  ids: ${(diagnostics.project.objectIds ?? []).join(", ")}`,
    `bodies: ${physics?.bodyCount ?? 0}  bindings: ${physics?.bindingCount ?? 0}`,
    `joints: ${physics?.jointCount ?? 0}`,
    ...jointSummary,
    `physics: ${physics?.paused ? "paused" : "running"}  readback: ${physics?.readbackPending ? "pending" : "ready"}`,
    `frame: ${physics?.frameIndex ?? 0}  profile: ${renderer.profile}`,
    "Drag: orbit   Wheel: zoom"
  ].join("\n");
  if (statusElement.textContent !== nextStatus) statusElement.textContent = nextStatus;
}

// projectのobjectsとphysics.jointsをWebgSceneAppへ渡し、描画・固定step・readbackを共通入口へ委譲します
// Jointの登録結果はready後にdiagnosticsから読み取り、Start前の契約確認へ利用します
async function start() {
  statusElement = document.getElementById("status");
  const startButton = document.getElementById("start");
  const stopButton = document.getElementById("stop");
  const resetButton = document.getElementById("reset");
  if (!statusElement || !startButton || !stopButton || !resetButton) {
    throw new Error("project_app_joint controls are unavailable");
  }
  sceneApp = await createWebgSceneApp({
    project: PROJECT_URL,
    camera: CAMERA_OPTIONS,
    physics: { enabled: true, spatialMatch: "report", paused: true },
    onReadback: updateStatus,
    onPresented: updateStatus,
    onError: (error) => {
      console.error("project_app_joint runtime failed:", error);
      statusElement.textContent = `project_app_joint runtime failed\n${error?.message ?? String(error)}`;
    }
  });
  const jointCount = sceneApp.getDiagnostics().physics?.jointCount ?? 0;
  if (jointCount !== 1) throw new Error(`project_app_joint expected one registered Joint, received ${jointCount}`);
  startButton.addEventListener("click", () => { sceneApp.setPaused(false); updateStatus(); });
  stopButton.addEventListener("click", () => { sceneApp.setPaused(true); updateStatus(); });
  resetButton.addEventListener("click", () => { sceneApp.reset(); updateStatus(); });
  updateStatus();
  sceneApp.start();
}

// 初期化エラーを画面へ表示し、Joint参照の誤りをブラウザで確認できる状態へ残します
document.addEventListener("DOMContentLoaded", () => {
  start().catch((error) => {
    console.error("project_app_joint failed:", error);
    if (statusElement) statusElement.textContent = `project_app_joint failed\n${error?.message ?? String(error)}`;
  });
});

// ページ終了時にWebgSceneAppへGPU resourceとframe loopの解放を依頼します
window.addEventListener("pagehide", () => {
  sceneApp?.destroy();
  sceneApp = null;
});
