// SceneYAMLのobject animationを公開APIで操作する表示専用サンプルです。
// Copyright (c) 2026 Jun Mizutani, released under the MIT license.
import { createWebgSceneApp } from "../../webg/app/index.js";

// 任意のbrowser probeからも同じappを確認できます。姿勢の補間はcoreへ委譲します。
export let sceneApp = null;
const compressed = new URLSearchParams(location.search).get("gzip") === "1";
const PROJECT_URL = compressed ? "./scene_animation.yaml.gz" : "./scene_animation.yaml";
let controls;
let failed = false;

function showError(error) {
  failed = true;
  console.error("scene_animation failed:", error);
  const panel = document.getElementById("error");
  if (panel) {
    panel.hidden = false;
    panel.textContent = `scene_animation failed\n${error?.message ?? String(error)}`;
  }
  document.querySelector("main").dataset.state = "error";
  document.querySelectorAll(".controls button, .controls input, .controls select")
    .forEach((element) => { element.disabled = true; });
  // エラー表示は通常のstatus更新で消しません。
  try { sceneApp?.stop(); } catch (stopError) { console.error(stopError); }
}

function updateStatus() {
  if (!sceneApp || !controls || failed) return;
  const state = sceneApp.getAnimationState(controls.clip.value);
  const diagnostics = sceneApp.getDiagnostics();
  const next = [
    `SceneYAML: ${PROJECT_URL} | renderMode: ondemand | physics: disabled`,
    `clip: ${state.id} | status: ${state.status} | time: ${state.time.toFixed(3)} / ${state.duration.toFixed(3)} s | loop: ${state.loop}`,
    `frames: ${diagnostics.running ? "running" : "stopped"} | objects: ${diagnostics.project.objectCount} | PBR: ${diagnostics.renderer.profile}`,
    "Play: 先頭から再生 / Pause・Stop: 姿勢保持 / Seek: 指定時刻で一時停止",
    "Reset animations: 全clip停止＋基準配置 / Reset scene: アニメーションと物理をリセット（この例は物理なし）"
  ].join("\n");
  if (controls.status.textContent !== next) controls.status.textContent = next;
  controls.seekTime.max = String(state.duration);
  controls.pause.disabled = state.status !== "playing";
  controls.resume.disabled = state.status !== "paused";
  controls.startFrames.disabled = diagnostics.running;
  controls.stopFrames.disabled = !diagnostics.running;
}

// 同期例外とPromiseの失敗を同じ画面へ表示します。
function bind(id, action) {
  document.getElementById(id).addEventListener("click", async () => {
    try {
      await action();
      updateStatus();
    } catch (error) { showError(error); }
  });
}

async function initialize() {
  controls = {
    clip: document.getElementById("clip"),
    loop: document.getElementById("loop"),
    seekTime: document.getElementById("seek-time"),
    pause: document.getElementById("pause"),
    resume: document.getElementById("resume"),
    startFrames: document.getElementById("start-frames"),
    stopFrames: document.getElementById("stop-frames"),
    status: document.getElementById("status")
  };
  sceneApp = await createWebgSceneApp({
    project: PROJECT_URL,
    renderMode: "ondemand",
    physics: false,
    camera: {
      target: [0, 1.4, 0], distance: 9, yaw: 20, pitch: -12,
      minDistance: 4, maxDistance: 18, wheelZoomStep: 0.6
    },
    onPresented: () => {
      try { updateStatus(); } catch (error) { showError(error); }
    },
    onError: showError
  });
  if (failed) { sceneApp.destroy(); sceneApp = null; return; }
  for (const method of [
    "getAnimationIds", "playAnimation", "pauseAnimation", "resumeAnimation",
    "stopAnimation", "seekAnimation", "resetAnimations", "getAnimationState"
  ]) {
    if (typeof sceneApp[method] !== "function") {
      throw new Error(`WebgSceneApp.${method} is unavailable; object animation core is required`);
    }
  }
  const ids = sceneApp.getAnimationIds();
  if (!ids.includes("gate-motion")) throw new Error("Expected gate-motion animation in SceneYAML");
  for (const id of ids) {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = id;
    controls.clip.append(option);
  }
  controls.clip.value = "gate-motion";
  controls.clip.addEventListener("change", () => {
    try { updateStatus(); } catch (error) { showError(error); }
  });

  bind("play", () => sceneApp.playAnimation(controls.clip.value, { loop: controls.loop.checked }));
  bind("pause", () => sceneApp.pauseAnimation(controls.clip.value));
  bind("resume", () => sceneApp.resumeAnimation(controls.clip.value));
  bind("stop-animation", () => sceneApp.stopAnimation(controls.clip.value));
  bind("seek", () => {
    // 不正な入力はブラウザーの入力欄に表示し、coreへNaNを渡しません。
    if (!controls.seekTime.reportValidity()) return;
    const seconds = controls.seekTime.valueAsNumber;
    if (!Number.isFinite(seconds)) { controls.seekTime.reportValidity(); return; }
    return sceneApp.seekAnimation(controls.clip.value, seconds);
  });
  bind("reset-animations", () => sceneApp.resetAnimations());
  bind("reset", () => sceneApp.reset());
  // app.start/stopは描画ループの操作です。clipの再生状態とは独立しています。
  bind("start-frames", () => sceneApp.start());
  bind("stop-frames", () => sceneApp.stop());
  document.querySelectorAll(".controls button, .controls input, .controls select")
    .forEach((element) => { element.disabled = false; });
  sceneApp.start();
  updateStatus();
  document.querySelector("main").dataset.state = "ready";
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => initialize().catch(showError), { once: true });
} else {
  initialize().catch(showError);
}

window.addEventListener("pagehide", () => {
  sceneApp?.destroy();
  sceneApp = null;
});
