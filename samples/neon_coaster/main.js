// main.js 2026/09/26
// 曲線コース、Followカメラ、PBR、Compute粒子、音楽を疾走デモへまとめる
import { parseSceneYAML } from "../../webg/SceneYaml.js";
import GameAudioSynth from "../../webg/GameAudioSynth.js";
import CoasterApp from "./CoasterApp.js";
import { createCoasterScene } from "./track.js";

let sceneApp = null;
let coaster = null;
let audio = null;
let musicEnabled = false;
let trailElapsed = 0;
const TURBO_SPEED_SCALE = 1.55;
const TRAIL_EMIT_INTERVAL_SEC = 0.045;
const TRAIL_WAVE_PERIOD_SEC = 1.4;

// 初期化またはframe処理の例外を画面へ表示し、更新と音楽を停止する
function showError(error) {
  document.getElementById("loading").hidden = true;
  const panel = document.getElementById("error");
  panel.hidden = false;
  panel.textContent = error instanceof Error ? error.stack ?? error.message : String(error);
  for (const button of document.querySelectorAll("button")) button.disabled = true;
  sceneApp?.stop();
  audio?.stopBgm();
  console.error(error);
}

// Promiseを返す操作も同じエラー表示へ接続し、成功後だけUI状態を更新する
function connect(id, action) {
  const button = document.getElementById(id);
  button.disabled = false;
  button.addEventListener("click", async () => {
    try {
      await action(button);
    } catch (error) {
      showError(error);
    }
  });
}

// 175 BPMのpresetを利用者操作後に開始し、疾走速度とは独立して再生を切り替える
async function toggleMusic(button) {
  if (!audio) {
    audio = new GameAudioSynth();
    audio.setMasterVolume(0.4);
    audio.setBgmVolume(0.34);
    audio.setMelody("run_neon");
  }
  await audio.resume();
  musicEnabled = !musicEnabled;
  if (musicEnabled) audio.startBgm(); else audio.stopBgm();
  button.textContent = musicEnabled ? "MUSIC ON" : "MUSIC OFF";
  button.setAttribute("aria-pressed", String(musicEnabled));
}

// 通常速度とTURBOを切り替え、車両移動とHUDへ同じ倍率を反映する
function toggleTurbo(button) {
  const next = coaster.getSpeedScale() === 1 ? TURBO_SPEED_SCALE : 1;
  coaster.setSpeedScale(next);
  button.textContent = next > 1 ? "TURBO ON" : "TURBO OFF";
  button.setAttribute("aria-pressed", String(next > 1));
}

// 火花の発生数を1.4秒周期で左右各2〜16個へ変え、流れに密度の波を作る
function trailBurstCount(elapsedSec) {
  const phase = elapsedSec * Math.PI * 2 / TRAIL_WAVE_PERIOD_SEC;
  return 9 + Math.round(7 * Math.sin(phase));
}

// 一時停止中もFollowカメラの画角操作を保ち、車両と粒子の発生だけを止める
function togglePause(button) {
  const next = !coaster.isPaused();
  coaster.setPaused(next);
  button.textContent = next ? "RESUME" : "PAUSE";
  button.setAttribute("aria-pressed", String(next));
}

// 車両を進め、赤い追従光、左右へ流す速度粒子、表示数値を同じ先頭車両位置から更新する
function update({ deltaSec }) {
  const sample = coaster.update(deltaSec);
  sceneApp.updateLeadLight(sample.position);
  trailElapsed += coaster.isPaused() ? 0 : deltaSec;
  if (trailElapsed >= TRAIL_EMIT_INTERVAL_SEC) {
    trailElapsed = 0;
    const emitter = sceneApp.getComputeParticleEmitter("speed-trail");
    const diagonalComponent = Math.SQRT1_2;
    const burstCount = trailBurstCount(coaster.getElapsed());
    for (const sideSign of [-1, 1]) {
      const sideOffset = sideSign * 0.95;
      const position = [0, 1, 2].map(axis =>
        sample.position[axis] + sample.side[axis] * sideOffset - sample.tangent[axis] * 0.28
      );
      const direction = [0, 1, 2].map(axis =>
        sample.side[axis] * sideSign * diagonalComponent - sample.tangent[axis] * diagonalComponent
      );
      emitter.emit(burstCount, {
        position,
        direction,
        spreadAngle: 32,
        speed: [1.05, 3.75],
        lifetime: [0.2, 0.55]
      });
    }
  }
  const speed = Math.round(118 * coaster.getSpeedScale());
  document.getElementById("speed").textContent = String(speed);
  document.getElementById("height").textContent = sample.position[1].toFixed(1);
  document.getElementById("bank").textContent = sample.bankDegree.toFixed(0);
}

// SceneYAMLとsample固有sceneを高水準PBRへ渡し、Followカメラを起動する
async function start() {
  const response = await fetch(new URL("./scene.yaml", import.meta.url));
  if (!response.ok) throw new Error(`SceneYAML: HTTP ${response.status}`);
  const manifest = parseSceneYAML(await response.text());
  sceneApp = await CoasterApp.create({
    project: manifest,
    renderMode: "continuous",
    physics: false,
    camera: { target: [0, 8, 0], distance: 14, yaw: 0, pitch: -8, minDistance: 4, maxDistance: 30 },
    effects: { shadow: true, ssao: false, ssr: true, dof: false },
    createScene: ({ app }) => {
      coaster = createCoasterScene(app);
      return { kind: "callback", runtime: coaster, nodes: coaster.nodes, getNode: coaster.getNode };
    },
    onUpdate: update,
    onError: showError
  });
  sceneApp.app.getGPU().device.addEventListener("uncapturederror", event => showError(event.error));
  Object.assign(sceneApp.renderer.pipeline.bloomOptions, {
    enabled: true,
    threshold: 0.9,
    strength: 0.42
  });
  coaster.setSpeedScale(TURBO_SPEED_SCALE);
  connect("turbo", toggleTurbo);
  connect("pause", togglePause);
  connect("music", toggleMusic);
  document.getElementById("loading").hidden = true;
  sceneApp.start();
}

// ページ終了時は音楽を止め、高水準アプリからsceneとGPU資源を順番に解放する
function destroy() {
  audio?.stopBgm();
  sceneApp?.destroy();
  sceneApp = null;
  coaster = null;
}

window.addEventListener("pagehide", destroy);
window.addEventListener("error", event => showError(event.error ?? new Error(event.message)));
start().catch(error => {
  showError(error);
  destroy();
});
