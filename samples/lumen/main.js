// main.js 2026/09/25
// SceneYAML、物理、Compute粒子、音楽をLUMENの展示操作へまとめる
import { parseSceneYAML } from "../../webg/SceneYaml.js";
import GameAudioSynth from "../../webg/GameAudioSynth.js";
import ObservatoryApp from "./ObservatoryApp.js";
import { populateExhibition, createSculpture } from "./exhibition.js";

let sceneApp = null;
let sculpture = null;
let audio = null;
let musicEnabled = false;
let elapsed = 0;
let pulseTime = -10;
// 描画が進んだ秒数で自動展示を進め、非表示タブから復帰しても演出を連打しない
const PULSE_INTERVAL_SEC = 8;
const DROP_INTERVAL_SEC = 12;
let nextPulseTime = PULSE_INTERVAL_SEC;
let nextDropTime = DROP_INTERVAL_SEC;
let dropCycle = 1;
let pulseCount = 0;

// 初期化・操作・GPUエラーの理由を画面へ残し、更新を停止する
function showError(error) {
  document.getElementById("loading").hidden = true;
  const panel = document.getElementById("error");
  panel.hidden = false;
  panel.textContent = error instanceof Error ? error.message : String(error);
  for (const button of document.querySelectorAll("button")) button.disabled = true;
  sceneApp?.stop();
  audio?.stopBgm();
  console.error(error);
}

// 彫刻を回転し、12秒周期の落下と8秒周期のパルスを順に処理する
// 同じフレームでは先にリセットし、新しく発生させた粒子を消さずに描画へ渡す
function update({ deltaSec }) {
  elapsed += deltaSec;
  if (!sculpture) return;
  sculpture.rings.forEach((node, index) => {
    node.rotateY(deltaSec * (12 + index * 7));
    node.rotateZ(deltaSec * (index % 2 ? -8 : 5));
  });
  if (elapsed >= nextDropTime) {
    sceneApp.reset();
    sceneApp.setPaused(false);
    dropCycle++;
    nextDropTime = elapsed + DROP_INTERVAL_SEC;
    // リセット時には粒子もクリアされるので、同時に新しいパルスを開始する
    nextPulseTime = elapsed;
  }
  if (elapsed >= nextPulseTime) {
    excite();
    nextPulseTime = elapsed + PULSE_INTERVAL_SEC;
  }
  sceneApp.lights[3].intensity = 2 + 8 * Math.exp(-(elapsed - pulseTime) * 1.6);
}

// 球状に発生させた粒子をHDRへ加算し、中央の点光源も同時に明るくする
function excite() {
  const result = sceneApp.getComputeParticleEmitter("pulse").emit(1536, {
    position: [0, 4.76, -0.5], direction: [0, 1, 0], spreadAngle: 180,
    speed: [1.2, 4.2], lifetime: [2, 3.6] });
  pulseTime = elapsed;
  pulseCount++;
  document.getElementById("status").textContent = `PULSE ${pulseCount} / ${result.accepted} PARTICLES · DROP ${dropCycle}`;
  if (musicEnabled) audio.playGameTone(660, 0.18, "woodwind");
}

// Promiseを返す音声操作も含め、UI操作の失敗を共通のエラー表示へ接続する
function connect(id, action) {
  const button = document.getElementById(id);
  button.disabled = false;
  button.addEventListener("click", async () => {
    try { await action(button); } catch (error) { showError(error); }
  });
}

// ユーザの音楽ボタン操作を契機にAudioContextを準備し、穏やかなJazzを再生する
async function toggleMusic(button) {
  if (!audio) {
    audio = new GameAudioSynth();
    audio.setMasterVolume(0.4);
    audio.setBgmVolume(0.35);
    audio.setMelody("jazz_cafe");
  }
  await audio.resume();
  musicEnabled = !musicEnabled;
  if (musicEnabled) audio.startBgm(); else audio.stopBgm();
  button.textContent = musicEnabled ? "音楽 ON" : "音楽 OFF";
  button.setAttribute("aria-pressed", String(musicEnabled));
}

// YAMLの設定を読み、繰り返し配置を追加して高水準PBR・Compute物理へ渡す
async function start() {
  const response = await fetch(new URL("./scene.yaml", import.meta.url));
  if (!response.ok) throw new Error(`SceneYAML: HTTP ${response.status}`);
  const manifest = populateExhibition(parseSceneYAML(await response.text()));
  sceneApp = await ObservatoryApp.create({ project: manifest, renderMode: "continuous",
    physics: { enabled: true, paused: false },
    camera: { target: [0, 2, 0], distance: 21, yaw: 16, pitch: -16, minDistance: 9, maxDistance: 32 },
    effects: { shadow: true, ssao: false, ssr: true, dof: false }, onUpdate: update, onError: showError });
  sceneApp.app.getGPU().device.addEventListener("uncapturederror", event => showError(event.error));
  sculpture = await createSculpture(sceneApp.app);
  Object.assign(sceneApp.renderer.pipeline.bloomOptions, { enabled: true, threshold: 1, strength: 0.45 });
  connect("music", toggleMusic);
  document.getElementById("status").textContent = "SCENE READY / EXPLORE THE LIGHT";
  document.getElementById("loading").hidden = true;
  sceneApp.start();
  excite();
}

// ページ終了時は音を止め、展示独自のテクスチャとShape、高水準アプリを解放する
function destroy() {
  audio?.stopBgm();
  if (sculpture) {
    for (const entry of sculpture.entries) entry.shape.destroy();
    sculpture = null;
  }
  sceneApp?.destroy();
}
window.addEventListener("pagehide", destroy);
// 描画ループから送られた例外も、同じ画面のエラー欄へ表示する
window.addEventListener("error", event => showError(event.error ?? new Error(event.message)));
start().catch(error => { showError(error); destroy(); });
