// ---------------------------------------------
//  project_app_joint_compute_node_demo.js  2026/09/10
//   SceneYAML Joint Compute physics with Node synchronization
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// 高水準SceneYAML入口と、connector姿勢へ使う最小限のcore数学型を読み込みます
import { createWebgSceneApp } from "../../webg/app/index.js";
import Quat from "../../webg/Quat.js";

const PROJECT_URL = "./project_app_joint_compute_node_project.yaml?v=20260910scene-yaml1";
const FIXED_TIME_STEP_SEC = 1.0 / 120.0;
const DRIVER_START_X = -3.30;
const DRIVER_END_X = 3.30;
const DRIVER_Y = 4.00;
const DRIVER_Z = 0.0;
const DRIVER_SPEED = 0.80;

// joint_compute_nodeと同じ視点を使い、GPU物理、readback、Node描画の結果を比較しやすくします
const CAMERA_OPTIONS = {
  target: [-0.18, 3.55, -0.28],
  distance: 6.90,
  yaw: -46.37,
  pitch: -32.61,
  roll: -23.80,
  minDistance: 6.0,
  maxDistance: 15.0
};

// SceneYAMLの論理IDからWebgSceneAppが割り当てたCompute body bindingを取得します
// SceneYAMLの文字列IDとGPU内部の数値body IDを画面側で混同しないため、登録結果を一度だけ参照します
function findBodyBinding(id) {
  const binding = sceneApp?.bodyBindings.find((entry) => entry.id === id);
  if (!binding) throw new Error(`project_app_joint_compute_node body binding is unavailable: ${id}`);
  return binding;
}

// 指定方向へcapsuleのローカルY軸を向けるNode用Quaternionを作ります
// 振り子connectorは物理bodyを持たない表示専用Nodeのため、readbackした二点から毎回姿勢を再構成します
function createQuaternionFromUpDirection(direction) {
  const length = Math.hypot(direction[0], direction[1], direction[2]);
  if (!Number.isFinite(length) || length <= 1.0e-8) {
    throw new Error("project_app_joint_compute_node connector direction must be finite and non-zero");
  }
  const x = direction[0] / length;
  const y = direction[1] / length;
  const z = direction[2] / length;
  const quaternion = new Quat();
  if (y <= -1.0 + 1.0e-8) {
    quaternion.setRotateX(180.0);
    return quaternion;
  }
  const scale = Math.sqrt(2.0 * (1.0 + y));
  quaternion.q[0] = 0.5 * scale;
  quaternion.q[1] = z / scale;
  quaternion.q[2] = 0.0;
  quaternion.q[3] = -x / scale;
  quaternion.normalize();
  return quaternion;
}

// GPU readbackのbody stateをSceneYAMLの論理IDから読み取ります
// Readback配列のslot番号を作品側へ持ち込まず、body bindingが変換境界を担当します
function readBodyState(stateData, id) {
  const binding = findBodyBinding(id);
  return sceneApp.physics.readBodyStateFromReadback(binding.bodyId, stateData);
}

// 振り子の支点と重りの中点、方向、姿勢を表示専用connector Nodeへ反映します
// connectorはSceneYAMLの物理body一覧から外し、Jointの動きを説明する質量なしのShapeとして扱います
function updatePendulumConnector(stateData) {
  const pivot = readBodyState(stateData, "pendulum-pivot");
  const weight = readBodyState(stateData, "pendulum-weight");
  const connector = sceneApp.scene.getNode("pendulum-connector");
  const direction = [
    weight.position[0] - pivot.position[0],
    weight.position[1] - pivot.position[1],
    weight.position[2] - pivot.position[2]
  ];
  connector.setPosition(
    (pivot.position[0] + weight.position[0]) * 0.5,
    (pivot.position[1] + weight.position[1]) * 0.5,
    (pivot.position[2] + weight.position[2]) * 0.5
  );
  connector.setQuat(createQuaternionFromUpDirection(direction));
}

// kinematic Capsuleの経路上の距離を進め、SceneYAMLで登録したNodeとCompute bodyを同じ姿勢へそろえます
// onUpdateはSceneFrameのfixed step記録より前に呼ばれるため、次のCompute stepへ位置を渡せます
function updateCrossingCapsule(deltaSec) {
  if (paused) return;
  if (direction !== 0) {
    driverDistance += direction * DRIVER_SPEED * deltaSec;
    const pathLength = DRIVER_END_X - DRIVER_START_X;
    if (driverDistance <= 0.0) {
      driverDistance = 0.0;
      direction = 0;
    } else if (driverDistance >= pathLength) {
      driverDistance = pathLength;
      direction = 0;
    }
  }
  const node = sceneApp.scene.getNode("crossing-capsule");
  node.setPosition(DRIVER_START_X + driverDistance, DRIVER_Y, DRIVER_Z);
  const binding = findBodyBinding("crossing-capsule");
  if (motionMode === "impact") {
    // impact modeでは処方速度もGPUへ渡し、Capsuleがropeへ運動量を伝える経路を確認します
    sceneApp.physics.syncComputeFromNode(binding.bodyId, {
      syncPhysicsFromNode: () => ({
        position: node.getPosition(),
        quat: node.getQuat(),
        linearVelocity: direction === 0 ? [0.0, 0.0, 0.0] : [DRIVER_SPEED * direction, 0.0, 0.0],
        angularVelocity: [0.0, 0.0, 0.0]
      })
    }, { syncVelocity: true, wakeUp: true });
  } else {
    // quasiStatic modeでは位置処方だけを渡し、接触側へ外部速度を与えない実験を行います
    sceneApp.physics.syncComputeFromNode(binding.bodyId, node, { syncVelocity: false, wakeUp: true });
  }
}

// project、renderer、Compute physics、Node bindingをまとめて表示状態へ変換します
// sceneAppが返す診断値を使うため、body数やJoint数を作品側で再計算しません
function updateStatus() {
  if (!sceneApp || !statusElement) return;
  const diagnostics = sceneApp.getDiagnostics();
  const physics = diagnostics.physics;
  const driver = sceneApp.scene.getNode("crossing-capsule").getPosition();
  const nextStatus = [
    "WebgSceneApp / SceneYAML joint_compute_node",
    `project: ${diagnostics.project.name}  scene: ${diagnostics.project.sceneKind}`,
    `objects: ${diagnostics.project.objectCount ?? 0}  objectSets: ${diagnostics.project.objectSetCount ?? 0}`,
    `bodies: ${physics?.bodyCount ?? 0}  bindings: ${physics?.bindingCount ?? 0}  joints: ${physics?.jointCount ?? "--"}`,
    `physics: ${paused ? "paused" : "running"}  readback: ${physics?.readbackPending ? "pending" : "ready"}`,
    `driver: x=${driver[0].toFixed(2)}  mode=${motionMode}  direction=${direction}`,
    `frame: ${physics?.frameIndex ?? 0}  last readback: ${diagnostics.lastReadback?.frameIndex ?? "none"}`,
    `profile: ${diagnostics.renderer.profile}  environment: ${diagnostics.renderer.hasEnvironment ? "ready" : "unavailable"}`,
    "A / D: move the kinematic Capsule   Q: quasiStatic   I: impact",
    "P: pause/resume   R: reset and start from the left",
    "Drag: orbit   Wheel: zoom"
  ].join("\n");
  if (statusElement.textContent !== nextStatus) statusElement.textContent = nextStatus;
}

// キーボード入力をCapsuleの移動、接触mode、物理の停止、Resetへ振り分けます
// 高水準APIのStart／Stop／Resetと同じ状態をキーボードからも確認できるようにします
function applyAction(key, event) {
  const normalized = String(key).toLowerCase();
  if (normalized === "a") direction = -1;
  else if (normalized === "d") direction = 1;
  else if (normalized === "q") motionMode = "quasiStatic";
  else if (normalized === "i") motionMode = "impact";
  else if (normalized === "p" || key === " ") {
    paused = !paused;
    sceneApp.setPaused(paused);
  } else if (normalized === "r") {
    resetScene();
    paused = false;
    sceneApp.setPaused(false);
  } else return;
  event?.preventDefault();
  updateStatus();
}

// SceneYAMLのbody、Joint、Node姿勢、readback世代を初期状態へ戻します
// 高水準入口のreset()を使い、GPU bodyを作品側で個別に再登録する処理を置きません
function resetScene() {
  sceneApp.reset();
  driverDistance = 0.0;
  direction = 1;
  const node = sceneApp.scene.getNode("crossing-capsule");
  node.setPosition(DRIVER_START_X, DRIVER_Y, DRIVER_Z);
  updateStatus();
}

// SceneYAML projectだけをWebgSceneAppへ渡し、PBR、Compute fixed step、readback、Node同期を準備します
// 作品側のJavaScriptには、動くCapsuleと質量なしconnectorの表示処理だけを残します
async function start() {
  statusElement = document.getElementById("status");
  const startButton = document.getElementById("start");
  const stopButton = document.getElementById("stop");
  const resetButton = document.getElementById("reset");
  if (!statusElement || !startButton || !stopButton || !resetButton) {
    throw new Error("project_app_joint_compute_node controls are unavailable");
  }

  sceneApp = await createWebgSceneApp({
    project: PROJECT_URL,
    camera: CAMERA_OPTIONS,
    physics: { enabled: true, spatialMatch: "report", paused: true },
    onUpdate: ({ deltaSec }) => {
      updateCrossingCapsule(Math.min(deltaSec, FIXED_TIME_STEP_SEC * 8.0));
      updateStatus();
    },
    onReadback: ({ stateData }) => {
      updatePendulumConnector(stateData);
      updateStatus();
    },
    onPresented: updateStatus,
    onError: (error) => {
      console.error("project_app_joint_compute_node runtime failed:", error);
      statusElement.textContent = `project_app_joint_compute_node runtime failed\n${error?.message ?? String(error)}`;
    }
  });

  startButton.addEventListener("click", () => {
    paused = false;
    sceneApp.setPaused(false);
    updateStatus();
  });
  stopButton.addEventListener("click", () => {
    paused = true;
    sceneApp.setPaused(true);
    updateStatus();
  });
  resetButton.addEventListener("click", resetScene);

  sceneApp.app.attachInput({
    onKeyDown: (key, event) => {
      if (event.repeat && !["a", "d"].includes(String(key).toLowerCase())) return;
      applyAction(key, event);
    },
    onKeyUp: (key, event) => {
      const normalized = String(key).toLowerCase();
      if (normalized === "a" || normalized === "d") event.preventDefault();
    }
  });

  updateStatus();
  sceneApp.start();
}

let sceneApp = null;
let statusElement = null;
let paused = true;
let driverDistance = 0.0;
let direction = 1;
let motionMode = "quasiStatic";

// 初期化失敗を画面へ表示し、SceneYAMLの検証エラーを利用者が確認できる状態にします
document.addEventListener("DOMContentLoaded", () => {
  start().catch((error) => {
    console.error("project_app_joint_compute_node failed:", error);
    if (statusElement) statusElement.textContent = `project_app_joint_compute_node failed\n${error?.message ?? String(error)}`;
  });
});

// ページを離れるときにWebgSceneAppへGPU resourceとframe loopの解放を依頼します
window.addEventListener("pagehide", () => {
  sceneApp?.destroy();
  sceneApp = null;
});
