// ---------------------------------------------
//  project_app_sphere_plane_demo.js  2026/09/08
//   General WebgSceneApp Sphere and Plane Compute physics fixture
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// samples/project_app public fixture
import { createWebgSceneApp } from "../../webg/app/index.js";

const PROJECT_URL = "./project_app_sphere_plane_project.yaml?v=20260908scene-yaml1";
const CAMERA_OPTIONS = {
  target: [0.0, 1.0, 0.0],
  distance: 10.5,
  yaw: 0.0,
  pitch: -7.0,
  minDistance: 5.5,
  maxDistance: 20.0,
  wheelZoomStep: 0.7
};

let sceneApp = null;
let statusElement = null;

// WebgSceneAppの共通診断値から、scene・body・Plane・readbackの対応を表示します
// 利用者が必要な設定と高水準入口の結果を同じ画面で確認できる構成です
function updateStatus() {
  const diagnostics = sceneApp.getDiagnostics();
  const physics = diagnostics.physics;
  const renderer = diagnostics.renderer;
  const nextStatus = [
    "WebgSceneApp / Sphere + Plane",
    `project: ${diagnostics.project.name}  scene: ${diagnostics.project.sceneKind}`,
    `objects: ${diagnostics.project.objectCount ?? 0}  ids: ${(diagnostics.project.objectIds ?? []).join(", ")}`,
    `bodies: ${physics?.bodyCount ?? 0}  bindings: ${physics?.bindingCount ?? 0}  planes: 1`,
    `physics: ${physics?.paused ? "paused" : "running"}  readback: ${physics?.readbackPending ? "pending" : "ready"}`,
    `frame: ${physics?.frameIndex ?? 0}  last readback: ${diagnostics.lastReadback?.frameIndex ?? "none"}`,
    `profile: ${renderer.profile}  environment: ${renderer.hasEnvironment ? "ready" : "unavailable"}`,
    "Drag: orbit   Wheel: zoom"
  ].join("\n");
  if (statusElement.textContent !== nextStatus) statusElement.textContent = nextStatus;
}

// projectだけを指定し、物体生成、PBR描画、Compute fixed stepをWebgSceneAppへ委譲します
// 物体固有の位置、寸法、材質、physicsはproject.objectsで一つずつ確認できます
async function start() {
  statusElement = document.getElementById("status");
  const startButton = document.getElementById("start");
  const stopButton = document.getElementById("stop");
  const resetButton = document.getElementById("reset");
  if (!statusElement || !startButton || !stopButton || !resetButton) {
    throw new Error("project_app_sphere_plane controls are unavailable");
  }
  sceneApp = await createWebgSceneApp({
    project: PROJECT_URL,
    camera: CAMERA_OPTIONS,
    physics: { enabled: true, spatialMatch: "report", paused: true },
    onReadback: updateStatus,
    onPresented: updateStatus,
    onError: (error) => {
      console.error("project_app_sphere_plane runtime failed:", error);
      statusElement.textContent = `project_app_sphere_plane runtime failed\n${error?.message ?? String(error)}`;
    }
  });
  startButton.addEventListener("click", () => { sceneApp.setPaused(false); updateStatus(); });
  stopButton.addEventListener("click", () => { sceneApp.setPaused(true); updateStatus(); });
  resetButton.addEventListener("click", () => { sceneApp.reset(); updateStatus(); });
  updateStatus();
  sceneApp.start();
}

// 初期化エラーを画面へ表示し、project manifestとcreateSceneの確認箇所を残します
document.addEventListener("DOMContentLoaded", () => {
  start().catch((error) => {
    console.error("project_app_sphere_plane failed:", error);
    if (statusElement) statusElement.textContent = `project_app_sphere_plane failed\n${error?.message ?? String(error)}`;
  });
});

// page終了時にWebgSceneAppへGPU resourceとframe loopの解放を依頼します
window.addEventListener("pagehide", () => {
  sceneApp?.destroy();
  sceneApp = null;
});
