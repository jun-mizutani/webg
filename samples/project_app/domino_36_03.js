// ---------------------------------------------
//  domino_36_03.js  2026/09/08
//   WebgSceneApp-based high-level version of the domino 36_03 scene
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// samples/project_app high-level entry
import { createWebgSceneApp } from "../../webg/app/index.js";

// SceneYAML projectへ作品の形状、材質、PBR、Compute physics、objectSetを集約します
const PROJECT_URL = "./domino_36_03_project.yaml?v=20260909scene-yaml1";

// 36_03の確認に使う初期視点をprojectのfocusTargetと組み合わせます
const CAMERA_OPTIONS = Object.freeze({
  target: [1.8570757, 1.9625048, -0.9360865],
  distance: 9.4536,
  yaw: 43.1183,
  pitch: -21.5792,
  roll: 2.2335,
  minDistance: 9.0,
  maxDistance: 26.0,
  wheelZoomStep: 0.8,
  focusTarget: "display-ball",
  focusTargetOffset: [0.0, 0.0, 0.0]
});

// 可動板の操作範囲と一回の移動量を作品の入力設定としてまとめます
const BOARD_STEP = 0.18;
const BOARD_LIMITS = Object.freeze({
  minX: 0.292,
  maxX: 1.092,
  minY: 3.726,
  maxY: 5.526
});

// 物理の進行状態とdiagnostics表示を保持します
let sceneApp = null;
let boardNode = null;
let boardBodyId = null;
let statusElement = null;
let lastReadback = null;
let lastError = null;

// sceneAppのdiagnosticsから、project objectとCompute bodyを同じIDで確認します
function resolveBoardBinding() {
  const diagnostics = sceneApp.getDiagnostics();
  const binding = diagnostics.physics?.bindings?.find((entry) => entry.id === "movable-board");
  if (!binding) throw new Error("domino_36_03 movable-board body binding is unavailable");
  boardNode = sceneApp.scene.getNode("movable-board");
  boardBodyId = binding.bodyId;
}

// Nodeの現在位置を有限なworld座標として読み取ります
function readBoardPosition() {
  const position = boardNode?.getPosition?.();
  if (!Array.isArray(position) || position.length < 3
    || position.some((value) => !Number.isFinite(value))) {
    throw new Error("domino_36_03 movable-board position must be finite");
  }
  return [position[0], position[1], position[2]];
}

// 可動板の位置をNodeとCompute kinematic bodyへ同じframe入力として渡します
// physics.syncComputeFromNode()は、WebgSceneAppへ追加された唯一の作品固有入力処理です
function moveBoard(axis, direction) {
  const position = readBoardPosition();
  const axisIndex = axis === "x" ? 0 : axis === "y" ? 1 : -1;
  if (axisIndex < 0) throw new Error(`domino_36_03 unsupported board axis: ${axis}`);
  const next = position[axisIndex] + BOARD_STEP * direction;
  const minimum = axisIndex === 0 ? BOARD_LIMITS.minX : BOARD_LIMITS.minY;
  const maximum = axisIndex === 0 ? BOARD_LIMITS.maxX : BOARD_LIMITS.maxY;
  if (next < minimum || next > maximum) return false;
  position[axisIndex] = next;
  boardNode.setPosition(...position);
  sceneApp.physics.syncComputeFromNode(boardBodyId, boardNode, {
    syncBodyType: false,
    syncVelocity: false,
    wakeUp: true
  });
  return true;
}

// StartとStopをWebgSceneAppの物理停止状態へ接続し、ボタン表示を同期します
function setPaused(value) {
  sceneApp.setPaused(value);
  document.getElementById("start").disabled = !value;
  document.getElementById("stop").disabled = value;
}

// WebgSceneAppの解決済み設定とreadback状態を、比較用diagnosticsとして表示します
function updateStatus() {
  if (!sceneApp || !statusElement) return;
  const diagnostics = sceneApp.getDiagnostics();
  const physics = diagnostics.physics;
  const renderer = diagnostics.renderer;
  const board = boardNode ? readBoardPosition().slice(0, 2).map((value) => value.toFixed(3)) : ["?", "?"];
  const nextStatus = [
    "WebgSceneApp / domino 36_03",
    `objects: ${diagnostics.project.objectCount}  objectSets: ${diagnostics.project.objectSetCount}`,
    `bodies: ${physics?.bodyCount ?? 0}  bindings: ${physics?.bindingCount ?? 0}`,
    `profile: ${renderer.profile}  environment: ${renderer.hasEnvironment ? "ready" : "missing"}`,
    `PBR: SSAO ${renderer.ssao?.enabled === false ? "OFF" : "ON"}  SSR ${renderer.ssr?.enabled === false ? "OFF" : "ON"}  DoF ${renderer.dof?.enabled ? "ON" : "OFF"}`,
    `physics: ${physics?.paused ? "paused" : "running"}  readback: ${physics?.readbackPending ? "pending" : "ready"}`,
    `movable-board: (${board.join(", ")})  contacts: ${lastReadback?.contactBegin ?? 0}/${lastReadback?.contactStay ?? 0}/${lastReadback?.contactEnd ?? 0}`,
    "Arrow keys: move board   Drag: orbit   Wheel: zoom",
    "SceneYAML: primitive objects + objectSets + PBR + Compute physics"
  ].join("\n");
  statusElement.textContent = nextStatus;
}

// キーボードと画面ボタンを同じ板操作へ変換します
function handleBoardInput(axis, direction) {
  try {
    moveBoard(axis, direction);
    updateStatus();
  } catch (error) {
    showError(error);
  }
}

// WebgSceneAppが返す確定readbackを保存し、接触数を画面へ反映します
function handleReadback(payload) {
  lastReadback = {
    contactBegin: payload.contacts.begin.length,
    contactStay: payload.contacts.stay.length,
    contactEnd: payload.contacts.end.length
  };
  updateStatus();
}

// 高水準入口の初期化失敗を画面へ表示し、SceneYAML pathと実装境界を確認できる状態にします
function showError(error) {
  lastError = error instanceof Error ? error : new Error(String(error));
  console.error("domino_36_03 failed:", lastError);
  const panel = document.createElement("pre");
  panel.id = "runtime-error";
  panel.textContent = `domino_36_03 failed\n${lastError.message}`;
  document.getElementById("domino-stage")?.append(panel);
  sceneApp?.stop?.();
  for (const button of document.querySelectorAll("button")) button.disabled = true;
}

// SceneYAML projectをWebgSceneAppへ渡し、PBR、Compute physics、Node bindingを一度に準備します
async function start() {
  statusElement = document.getElementById("status");
  const startButton = document.getElementById("start");
  const stopButton = document.getElementById("stop");
  const resetButton = document.getElementById("reset");
  if (!statusElement || !startButton || !stopButton || !resetButton) {
    throw new Error("domino_36_03 controls are unavailable");
  }

  sceneApp = await createWebgSceneApp({
    project: PROJECT_URL,
    camera: CAMERA_OPTIONS,
    physics: { enabled: true, spatialMatch: "require-match", paused: true },
    onReadback: handleReadback,
    onPresented: updateStatus,
    onError: showError
  });
  resolveBoardBinding();

  startButton.disabled = false;
  stopButton.disabled = true;
  resetButton.disabled = false;
  startButton.addEventListener("click", () => setPaused(false));
  stopButton.addEventListener("click", () => setPaused(true));
  resetButton.addEventListener("click", () => {
    setPaused(true);
    sceneApp.reset();
    lastReadback = null;
    updateStatus();
  });
  for (const button of document.querySelectorAll("#board-controls button")) {
    button.addEventListener("click", () => handleBoardInput(
      button.dataset.axis,
      Number(button.dataset.direction)
    ));
  }
  window.addEventListener("keydown", (event) => {
    const actions = {
      ArrowLeft: ["x", -1],
      ArrowRight: ["x", 1],
      ArrowUp: ["y", 1],
      ArrowDown: ["y", -1]
    };
    const action = actions[event.key];
    if (!action) return;
    event.preventDefault();
    handleBoardInput(action[0], action[1]);
  });
  updateStatus();
  sceneApp.start();
}

document.addEventListener("DOMContentLoaded", () => {
  start().catch(showError);
});

window.addEventListener("pagehide", () => {
  sceneApp?.destroy();
  sceneApp = null;
});
