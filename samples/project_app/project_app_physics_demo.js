// ---------------------------------------------
//  project_app_physics_demo.js  2026/09/08
//   General WebgSceneApp Blender scene and Compute physics fixture
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import { createWebgSceneApp } from "../../webg/app/index.js";

const PROJECT_URL = "./project_app_physics_project.yaml?v=20260909scene-yaml1";
const CAMERA_OPTIONS = {
  target: [0.0, 3.4, 0.0],
  distance: 18.0,
  yaw: 0.0,
  pitch: -8.0,
  minDistance: 9.0,
  maxDistance: 32.0,
  wheelZoomStep: 0.8,
  focusTarget: "ball"
};

let sceneApp = null;
let statusElement = null;

// WebgSceneAppがまとめた物理とPBRの診断値を画面へ表示します
// body対応、停止状態、readback世代を同じ状態表示で確認します
function updateStatus() {
  const diagnostics = sceneApp.getDiagnostics();
  const physics = diagnostics.physics;
  const renderer = diagnostics.renderer;
  const nextStatus = [
    "WebgSceneApp / Blender scene / Compute physics",
    `project: ${diagnostics.project.name}  nodes: ${diagnostics.project.modelNodeCount}`,
    `objects: ${diagnostics.project.objectCount ?? 0}  ids: ${(diagnostics.project.objectIds ?? []).join(", ")}`,
    `bodies: ${physics?.bodyCount ?? 0}  bindings: ${physics?.bindingCount ?? 0}`,
    `physics: ${physics?.paused ? "paused" : "running"}  readback: ${physics?.readbackPending ? "pending" : "ready"}`,
    `frame: ${physics?.frameIndex ?? 0}  last readback: ${diagnostics.lastReadback?.frameIndex ?? "none"}`,
    `DoF: ${renderer.dof?.enabled ? "enabled" : "disabled"}  focus: ${renderer.dof?.rangeMeters ?? "n/a"} m`,
    "Drag: orbit   Wheel: zoom"
  ].join("\n");
  if (statusElement.textContent !== nextStatus) statusElement.textContent = nextStatus;
}

// project、camera、physicsの三つを指定し、Compute固定stepとreadbackをWebgSceneAppへ委譲します
// body ID、Node同期、GPU command、Resetの接続はWebgSceneAppへ集約します
async function start() {
  statusElement = document.getElementById("status");
  const startButton = document.getElementById("start");
  const stopButton = document.getElementById("stop");
  const resetButton = document.getElementById("reset");
  if (!statusElement || !startButton || !stopButton || !resetButton) {
    throw new Error("project_app_physics controls are unavailable");
  }
  sceneApp = await createWebgSceneApp({
    project: PROJECT_URL,
    camera: CAMERA_OPTIONS,
    physics: { enabled: true, spatialMatch: "require-match", paused: true },
    onReadback: updateStatus,
    onPresented: updateStatus,
    onError: (error) => {
      console.error("project_app_physics runtime failed:", error);
      statusElement.textContent = `project_app_physics runtime failed\n${error?.message ?? String(error)}`;
    }
  });
  startButton.addEventListener("click", () => { sceneApp.setPaused(false); updateStatus(); });
  stopButton.addEventListener("click", () => { sceneApp.setPaused(true); updateStatus(); });
  resetButton.addEventListener("click", () => { sceneApp.reset(); updateStatus(); });
  updateStatus();
  sceneApp.start();
}

// 初期化エラーを画面へ表示し、Blender制作シーンとphysics manifestの対応を確認できる状態へ残します
document.addEventListener("DOMContentLoaded", () => {
  start().catch((error) => {
    console.error("project_app_physics failed:", error);
    if (statusElement) statusElement.textContent = `project_app_physics failed\n${error?.message ?? String(error)}`;
  });
});

// page終了時にWebgSceneAppへGPU resourceとframe loopの解放を依頼します
window.addEventListener("pagehide", () => {
  sceneApp?.destroy();
  sceneApp = null;
});
