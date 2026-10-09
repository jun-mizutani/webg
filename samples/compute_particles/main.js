// ---------------------------------------------
// samples/compute_particles/main.js  2026/09/23
//   ComputeParticleEmitter based particle simulation sample
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import WebgApp from "../../webg/WebgApp.js";
import ComputeParticleEmitter from "../../webg/ComputeParticleEmitter.js";
import { buildErrorPanelOptions, buildHelpPanelOptions } from "../../webg/OverlayPanelPresets.js";

// 容量、時間、カメラはサンプルの操作状態として保持し、粒子の位置・速度はEmitterへ任せる
const PARTICLE_COUNT = 49152;
const RING_COMMAND_COUNT = 24;
const CLEAR_COLOR = [0.006, 0.012, 0.020, 1.0];
const PARTICLE_LIFETIME = [3.2, 7.8];

let app = null;
let screen = null;
let emitter = null;
let frameNumber = 0;
let paused = false;
let emitterMode = 0;
let pointerHelpVisible = false;
let lastHelpText = "";

// 標準Emitterの診断値と現在の表示モードを、Help panelへ渡す行へまとめる
// estimatedAliveCountはGPU readbackではなく最大寿命に基づく予約数であることを表示する
function buildHelpLines() {
  const diagnostics = emitter?.getDiagnostics();
  return [
    "compute_particles",
    `particles: ${PARTICLE_COUNT.toLocaleString()}  mode: ${emitterMode === 0 ? "fountain" : "ring"}`,
    `GPU ComputeParticleEmitter: ${diagnostics?.estimatedAliveCount ?? 0} estimated / ${diagnostics?.capacity ?? 0}`,
    `commands: ${diagnostics?.pendingCommands ?? 0}  rejected: ${diagnostics?.rejectedCount ?? 0}`,
    `compute/render: shared storage buffer  paused: ${paused ? "yes" : "no"}`,
    ...(app?.getFrameTimingLines?.() ?? []),
    "drag: orbit  Shift+drag: pan  wheel: zoom  Space: burst  1: fountain  2: ring  P: pause  H: help"
  ];
}

// 初期化後にHelp panelを作成し、標準Emitterの使い方を画面へ表示する
// GPU初期化前は表示先がないため、初期化後だけ実行する
function showHelpPanel() {
  if (!app) throw new Error("compute_particles help requires an initialized WebgApp");
  const lines = buildHelpLines();
  app.showOverlayPanel(buildHelpPanelOptions({
    id: "gpuParticlesHelp",
    collapsed: true,
    title: "Help",
    anchor: "top-left",
    maxWidth: "500px",
    collapseLabelExpanded: "Hide Help",
    collapseLabelCollapsed: "Show Help",
    lines
  }));
  lastHelpText = lines.join("\n");
}

// 毎frameの診断値を既存panelへ反映し、操作用のheader buttonを再生成しない
// GPU上の粒子数を読み戻さず、標準APIの推定値をそのまま表示する
function updateHelpPanel() {
  if (!app) return;
  const panel = app.getOverlayPanel?.("gpuParticlesHelp");
  if (!panel) return;
  const lines = buildHelpLines();
  const text = lines.join("\n");
  if (text === lastHelpText) return;
  panel.options.lines = lines;
  panel.options.text = text;
  panel.bodyEl.textContent = text;
  lastHelpText = text;
}

// 一括発生の共通条件を返し、fountainとringで異なる位置・方向だけを指定できるようにする
// speedとlifetimeの単位はそれぞれワールド長さ/秒と秒で、範囲はEmitterが検証する
function createEmission(position, direction, spreadAngle = 65) {
  return {
    position,
    direction,
    spreadAngle,
    speed: [0.42, 1.24],
    lifetime: PARTICLE_LIFETIME
  };
}

// 現在の表示モードを消去して、標準EmitterのGPU発生要求を再構成する
// ringは24件の位置別要求へ分け、最大32件の要求queue内で円周上の粒子を作る
function loadMode(mode) {
  emitterMode = mode;
  emitter.clear();
  if (mode === 0) {
    const result = emitter.emit(PARTICLE_COUNT, createEmission([0, -0.52, 0], [0, 1, 0]));
    if (result.accepted !== PARTICLE_COUNT) throw new Error(`fountain initialization was rejected: ${JSON.stringify(result)}`);
    return;
  }
  const particlesPerCommand = PARTICLE_COUNT / RING_COMMAND_COUNT;
  for (let index = 0; index < RING_COMMAND_COUNT; index += 1) {
    const angle = index * Math.PI * 2.0 / RING_COMMAND_COUNT;
    const position = [Math.cos(angle) * 1.3, -0.52, Math.sin(angle) * 1.3];
    const direction = [Math.cos(angle), 0.28, Math.sin(angle)];
    const result = emitter.emit(particlesPerCommand, createEmission(position, direction, 38));
    if (result.accepted !== particlesPerCommand) throw new Error(`ring initialization was rejected: ${JSON.stringify(result)}`);
  }
}

// Spaceキーで使う一時的な火花を標準Emitterへ追加する
// replace-oldestが古い予約を明示的に置き換えるため、容量超過を診断値へ反映できる
function emitBurst() {
  const result = emitter.emit(2048, createEmission([0, -0.35, 0], [0, 1, 0], 80));
  if (result.rejected > 0) console.info("compute_particles burst", result);
}

// キー操作を標準Emitterのmode切替、burst、pause、Help操作へ接続する
// cameraの矢印キーやドラッグ操作はWebgAppのEyeRigへ任せる
function handleKeyDown(event) {
  const key = String(event.key).toLowerCase();
  if (event.key === " ") {
    emitBurst();
    event.preventDefault();
  } else if (key === "1") {
    loadMode(0);
  } else if (key === "2") {
    loadMode(1);
  } else if (key === "p") {
    paused = !paused;
    emitter.setPaused(paused);
  } else if (key === "h") {
    pointerHelpVisible = !pointerHelpVisible;
    app.getOverlayPanel?.("gpuParticlesHelp")?.setCollapsed?.(!pointerHelpVisible);
  } else {
    return;
  }
  updateHelpPanel();
  event.preventDefault();
}

// WebgAppが作ったCompute frameへ、clear、GPU更新、粒子描画、submitの順を記録する
// emitterはcameraFrameを読み、command encoderの生成とqueue submitはWebgAppのScreenへ残す
function renderGpuParticlesFrame(context) {
  const gpu = screen.getGPU();
  const deltaSec = Math.min(context.deltaSec, 1.0 / 30.0);
  frameNumber += 1;
  screen.clear();
  gpu.endPass();
  const commandEncoder = gpu.commandEncoder;
  emitter.encodeFrame(commandEncoder, {
    cameraFrame: context.cameraFrame,
    deltaSec
  });
  emitter.encodeRender(commandEncoder, {
    colorView: gpu.context.getCurrentTexture().createView(),
    depthView: gpu.depthView
  });
  screen.present();
  updateHelpPanel();
}

// WebgAppと標準ComputeParticleEmitterを初期化し、カメラ・入力・GPU frameを接続する
// targetFormatはScreenのswapchain形式へ明示し、PBR統合時のHDR形式とは別の直接描画経路を検証する
async function start() {
  app = new WebgApp({
    document,
    computeFrame: true,
    renderMode: "continuous",
    clearColor: CLEAR_COLOR,
    useMessage: false,
    setDefaultShapeShader: false,
    debugTools: {
      mode: "release",
      system: "compute_particles",
      source: "samples/compute_particles/main.js"
    }
  });
  await app.init();
  screen = app.screen;
  app.createOrbitEyeRig({ target: [0, 0, 0], distance: 6.5, yaw: 0, pitch: -0.24 });
  emitter = new ComputeParticleEmitter(screen.getGPU(), {
    label: "compute_particles",
    targetFormat: screen.getGPU().format,
    capacity: PARTICLE_COUNT,
    seed: 20260923,
    preset: "spark",
    overflow: "replace-oldest",
    simulation: { gravity: [0, -0.70, 0], drag: 0.05 },
    appearance: {
      colors: [[1.0, 0.28, 0.04], [0.04, 0.46, 1.0]],
      intensity: 1.26,
      size: [0.006, 0.018]
    }
  });
  loadMode(0);
  window.addEventListener("keydown", handleKeyDown);
  showHelpPanel();
  app.start({ onComputeFrame: renderGpuParticlesFrame });
}

// ページ終了時に標準EmitterとWebgAppのGPU resourceをまとめて解放する
window.addEventListener("pagehide", () => {
  emitter?.destroy();
  app?.stop();
});

// DOM構築後にGPU初期化を開始し、失敗理由をHelp panel相当のエラー表示へ渡す
document.addEventListener("DOMContentLoaded", () => {
  start().catch(error => {
    console.error("compute_particles failed:", error);
    app?.showOverlayPanel?.(buildErrorPanelOptions(error, {
      title: "compute_particles failed",
      id: "start-error",
      background: "rgba(26, 22, 32, 0.92)"
    }));
  });
});
