// samples/compute_particle_emitter/main.js 2026/09/22
// SceneYAMLから発生装置を作り、操作と診断表示を標準APIへ接続する
import { createWebgSceneApp } from "../../webg/app/index.js";

let sceneApp = null;
let emitters = [];
let paused = false;
let continuous = true;
let bloomEnabled = true;
let lastResult = "発生要求の結果はここに表示します";

// 初期化・描画・GPU処理の失敗を表示し、操作を止める
function showError(error) {
  document.getElementById("error").hidden = false;
  document.getElementById("error").textContent = error.message;
  for (const button of document.querySelectorAll("button")) button.disabled = true;
  sceneApp?.stop();
  console.error(error);
}

// 状態表示にはCPU上の最大寿命から求めた推定数を使う
function updateStatus() {
  if (!sceneApp) return;
  document.getElementById("status").textContent = emitters.map(emitter => {
    const state = emitter.getDiagnostics();
    return `${emitter.label}: 推定 ${state.estimatedAliveCount}/${state.capacity}, 拒否 ${state.rejectedCount}, 保留 ${state.pendingCommands}`;
  }).join("\n") + "\n" + lastResult;
}

// ボタンの処理を接続し、操作時の例外も同じ場所へ表示する
function connect(id, action) {
  const button = document.getElementById(id);
  button.disabled = false;
  button.addEventListener("click", () => {
    try { action(button); updateStatus(); } catch (error) { showError(error); }
  });
}

// YAMLの二つの発生装置と、JavaScriptで追加する光点を同じPBRへ登録する
async function start() {
  sceneApp = await createWebgSceneApp({ project: "./scene.yaml", renderMode: "continuous", physics: { enabled: false },
    effects: { ssao: false, ssr: false },
    camera: { target: [0, 1.5, 0], distance: 12, yaw: 15, pitch: -18 },
    onUpdate: updateStatus, onError: showError });
  // Bloomは既存のPBR実行時設定へ渡し、粒子の発生設定と独立して比較する
  Object.assign(sceneApp.renderer.pipeline.bloomOptions, { enabled: true, threshold: 1, strength: .35 });
  const fountain = sceneApp.getComputeParticleEmitter("fountain");
  const sparks = sceneApp.getComputeParticleEmitter("sparks");
  const light = await sceneApp.createComputeParticleEmitter({ preset: "light", label: "light", capacity: 256 }, "light");
  emitters = [fountain, sparks, light];
  sceneApp.app.getGPU().device.addEventListener("uncapturederror", event => showError(event.error));
  connect("burst", () => {
    lastResult = JSON.stringify(sparks.emit(64, { position: [0, 1.3, -0.3],
      direction: [0, 1, 0], spreadAngle: 60, speed: [2, 5], lifetime: [.6, 1] }));
  });
  connect("light", () => {
    lastResult = JSON.stringify(light.emit(64, { position: [2, 1.3, 0] }));
  });
  connect("continuous", button => {
    continuous = !continuous;
    if (continuous) fountain.startEmission(sceneApp.project.manifest.particleEmitters[0].emission);
    else fountain.stopEmission();
    button.textContent = continuous ? "連続発生を停止" : "連続発生を再開";
  });
  connect("pause", button => {
    paused = !paused;
    for (const emitter of emitters) emitter.setPaused(paused);
    button.textContent = paused ? "更新を再開" : "一時停止";
  });
  connect("clear", () => { for (const emitter of emitters) emitter.clear(); });
  connect("bloom", button => {
    bloomEnabled = !bloomEnabled;
    sceneApp.renderer.pipeline.bloomOptions.enabled = bloomEnabled;
    button.textContent = bloomEnabled ? "Bloom OFF" : "Bloom ON";
  });
  sceneApp.start();
}

// 画面から離れる際は、PBRへ登録した全Emitterもアプリと一緒に解放する
window.addEventListener("pagehide", () => sceneApp?.destroy());
start().catch(error => { showError(error); sceneApp?.destroy(); });
