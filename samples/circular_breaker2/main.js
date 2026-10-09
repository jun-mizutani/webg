// ---------------------------------------------
// samples/circular_breaker2/main.js  2026/09/22
//   SceneYAML / ModelYAML / PBR based circular breaker sample
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import SceneAsset from "../../webg/SceneAsset.js";
import ArenaSceneApp from "./ArenaSceneApp.js";
import GameAudioSynth from "../../webg/GameAudioSynth.js";
import Diagnostics from "../../webg/Diagnostics.js";
import DebugConfig from "../../webg/DebugConfig.js";
import DebugProbe from "../../webg/DebugProbe.js";

import {
  RAD,
  SHADOW_Y,
  PARTICLE_POOL,
  clamp
} from "./constants.js";
import { createGameRuntime } from "./gameRuntime.js";
import { createScenePhaseController } from "./scenePhases.js";
import { createSparkEmitter } from "./particleEffects.js";
import { createBlockField } from "./blockField.js";
import {
  ACTION_MAP,
  installTouchLayoutStyle,
  createDebugActionHandlers,
  runPressedActionHandlers
} from "./inputConfig.js";

const DIAG_TEXT_FILE = "circular_breaker2_diagnostics.txt";
const DIAG_JSON_FILE = "circular_breaker2_diagnostics.json";

let sceneApp = null;
let sceneAsset = null;
let runtime = null;
let phaseController = null;
let debugProbe = null;
let debugProbeState = "IDLE";
let debugProbeFormat = "text";
let diagnosticsCopyState = "READY";
let touchRoot = null;
let destroyBlockTextures = null;
let gameBlocks = [];

// エラーを画面上へ残し、初期化失敗と実行中失敗を同じ表示で確認できるようにする
const showError = (error) => {
  const panel = document.getElementById("error");
  if (panel) {
    panel.hidden = false;
    panel.textContent = error instanceof Error ? error.stack ?? error.message : String(error);
  }
  console.error("circular_breaker2 failed:", error);
};

// frame処理で発生した例外を保存し、以後の入力を止めて原因を画面へ通知する
const handleRuntimeError = (error) => {
  sceneApp?.stop();
  for (const button of document.querySelectorAll("button")) button.disabled = true;
  showError(error);
};

// DOM HUDへ現在のゲーム状態を反映する
// 得点・進行状態はCanvas外の先頭行へまとめ、幅が足りないときはCSSで折り返す
// 見出しの高さが変わった場合もArenaSceneAppが残りのCanvas領域へ追従する
const updateHud = (debugLines = []) => {
  if (!runtime || !phaseController) return;
  const state = runtime.state;
  const phase = phaseController.getScenePhase();
  const hud = document.getElementById("hud");
  if (hud) {
    hud.textContent = [
      `LEVEL ${state.level}    PACK ${state.packsRemain}    `
        + `${state.destroyedThisStage}/${state.targetBreaks}    SCORE ${state.score}`,
      `PHASE ${phase.toUpperCase()}    ${state.stageResultText}`,
      phase === "result" ? `${state.gameOverText} — R: RESTART` : "",
      phase === "result" ? `BEST: ${state.highScores.map(item => item.score).join(" / ")}` : "",
      state.packEventText && state.packEventBannerSec > 0.0 ? state.packEventText : ""
    ].filter(Boolean).join("  |  ");
  }
  const status = document.getElementById("status");
  if (status) {
    const debugText = debugLines.length > 0 ? `\n${debugLines.join("\n")}` : "";
    status.textContent = debugText;
    status.hidden = debugText.length === 0;
  }
  const startPrompt = document.getElementById("start-prompt");
  if (startPrompt) {
    startPrompt.hidden = phase !== "intro" || !state.stageIntroNeedsInput;
  }
};

// 現在のPBR Shapeとゲーム状態を診断レポートへまとめる
// DebugProbeや保存操作から同じ観測値を利用し、描画実装と診断実装の差を減らす
const createDiagnosticsReport = (stage = "runtime") => {
  const model = sceneApp?.model;
  const shapeOf = (id) => model?.getEntry(id)?.shapes?.[0] ?? null;
  const shapes = [
    shapeOf("floor"),
    shapeOf("puck"),
    shapeOf("paddle-body"),
    shapeOf("puck-shadow"),
    shapeOf("paddle-shadow-body"),
    ...gameBlocks.map((block) => block.shape)
  ];
  const aliveBlocks = gameBlocks.filter((block) => block.active).length;
  const lockedBlocks = gameBlocks.filter(
    (block) => block.active && block.type === "locked"
  ).length ?? 0;
  const hardBlocks = gameBlocks.filter(
    (block) => block.active && block.type === "hard"
  ).length ?? 0;
  const report = Diagnostics.createSuccessReport({
    system: "circular_breaker2",
    source: "samples/circular_breaker2/main.js",
    stage
  });
  Diagnostics.mergeStats(report, {
    level: runtime?.state.level ?? 0,
    score: runtime?.state.score ?? 0,
    packsRemain: runtime?.state.packsRemain ?? 0,
    destroyedThisStage: runtime?.state.destroyedThisStage ?? 0,
    targetBreaks: runtime?.state.targetBreaks ?? 0,
    aliveBlocks,
    lockedBlocks,
    hardBlocks,
    scenePhase: phaseController?.getScenePhase?.() ?? "unknown",
    audioUnlocked: runtime?.state.audioUnlocked ? "yes" : "no",
    particlePool: PARTICLE_POOL,
    activeParticles: runtime?.getActiveParticleCount?.() ?? 0,
    endedShapeCount: shapes.filter((shape) => shape?.vertexBuffer || shape?.indexBuffer).length
  });
  Diagnostics.addDetail(report, `puck=(${(runtime?.state.puckX ?? 0).toFixed(2)},${(runtime?.state.puckZ ?? 0).toFixed(2)})`);
  Diagnostics.addDetail(report, `paddle=(${(runtime?.state.paddleCx ?? 0).toFixed(2)},${(runtime?.state.paddleCz ?? 0).toFixed(2)}) yaw=${((runtime?.state.paddleYaw ?? 0) * RAD).toFixed(1)}`);
  Diagnostics.addDetail(report, `sceneComments=${sceneAsset?.getSourceDocument?.().comments?.length ?? 0}`);
  Diagnostics.addDetail(report, `modelComments=${sceneApp?.model?.asset?.getSourceDocument?.().comments?.length ?? 0}`);
  return report;
};

// DebugProbeの結果を次のHUD更新へ接続する
const updateDebugProbe = () => {
  if (!debugProbe || !sceneApp) return;
  const result = debugProbe.update(sceneApp.app.screen.getFrameCount?.() ?? 0);
  if (result && debugProbeState.startsWith("WAIT")) {
    debugProbeState = `READY ${result.format.toUpperCase()}`;
  }
};

// 指定形式の診断を次のframe以降に収集し、コピー可能な結果へする
const requestProbe = (format = "text", afterFrames = 1) => {
  debugProbeFormat = format;
  const probeId = debugProbe.request({
    label: `circular_breaker2_${format}_probe`,
    format,
    afterFrames,
    frameCount: sceneApp?.app.screen.getFrameCount?.() ?? 0,
    collect: () => createDiagnosticsReport("runtime-probe"),
    onReady: async (result) => {
      if (!DebugConfig.isEnabled("enableDiagnostics")) {
        diagnosticsCopyState = format === "json" ? "PROBE JSON READY" : "PROBE TEXT READY";
        return;
      }
      const copied = format === "json"
        ? await Diagnostics.copyJSON(result.payload)
        : await Diagnostics.copyText(result.payload);
      diagnosticsCopyState = copied
        ? (format === "json" ? "PROBE JSON COPIED" : "PROBE TEXT COPIED")
        : (format === "json" ? "PROBE JSON READY" : "PROBE TEXT READY");
    }
  });
  debugProbeState = probeId ? `WAIT ${afterFrames}F` : "PROBE DISABLED";
};

// 画面上のデバッグ情報を現在の設定とProbe状態から作る
const getDebugLines = () => DebugConfig.isDebug()
  ? [
    `diag=${diagnosticsCopyState}`,
    `sparks bursts=${sceneApp.sparkEmitter.burstCount} estimated=${sceneApp.sparkEmitter.getEstimatedAliveCount()}`,
    `paddle yaw=${(runtime.state.paddleYaw * RAD).toFixed(2)} position=(${runtime.state.paddleCx.toFixed(2)}, ${runtime.state.paddleCz.toFixed(2)})`,
    `probe=${debugProbeState} pending=${debugProbe?.getPendingCount?.() ?? 0} fmt=${debugProbeFormat}`
  ]
  : [];

// pause/resultでもHUDを更新し、ゲーム進行だけを止める
// 火花の時間刻みを渡し、GPU更新とHDR合成はBloom直前に行う
const updateFrame = ({ deltaSec, timeMs }) => {
  if (!runtime || !phaseController || !sceneApp) return;
  const now = Number.isFinite(timeMs) ? timeMs : performance.now();
  const dt = clamp(Number.isFinite(deltaSec) ? deltaSec : 0.0, 0.0, 0.033);
  updateTouchActionVisibility();
  phaseController.updateScenePhase(now, dt * 1000.0);
  handleGameActions();
  runPressedActionHandlers(sceneApp.app, debugActionHandlers);
  const phase = phaseController.getScenePhase();
  sceneApp.sparkEmitter.setPaused(phase === "pause");

  if (phase === "result") {
    runtime.updateStageFlow(dt);
    updateDebugProbe();
    updateHud(getDebugLines());
    return;
  }
  if (phase === "pause") {
    updateDebugProbe();
    updateHud(getDebugLines());
    return;
  }
  runtime.updatePaddle(dt);
  runtime.updatePuck(dt);
  runtime.updateStageFlow(dt);
  runtime.updateLevel();
  updateDebugProbe();
  updateHud(getDebugLines());
};

// input actionに応じてintro、pause、resultの処理を切り替える
const handleGameActions = () => {
  const app = sceneApp.app;
  if (app.wasActionPressed("pause")) {
    const phase = phaseController.getScenePhase();
    if (phase === "play") {
      phaseController.setScenePhase("pause", { force: true, context: { source: "action-toggle" } });
    } else if (phase === "pause") {
      phaseController.requestResume(performance.now());
    }
  }
  if (app.wasActionPressed("start")) requestStageStartIfWaiting();
  if (app.wasActionPressed("reset")) {
    if (phaseController.getScenePhase() === "result") {
      runtime.restartGame();
      phaseController.requestRestart();
    } else {
      runtime.resetPuck();
    }
  }
};

// intro待機中の開始要求をkeyboard、pointer、touchから共通化する
const requestStageStartIfWaiting = () => {
  if (!runtime || phaseController.getScenePhase() !== "intro") return false;
  if (runtime.state.stageIntroSec <= 0.0) return false;
  return phaseController.requestStageStart();
};

// touch操作用のresetボタンをplay中だけ隠す
const updateTouchActionVisibility = () => {
  const button = touchRoot?.querySelector(".webg-touch-btn[data-key='reset']");
  if (!button || !phaseController) return;
  const phase = phaseController.getScenePhase();
  button.style.display = phase === "play" || phase === "pause" ? "none" : "";
};

// DebugConfigから利用する保存・Probe操作をaction mapへ接続する
const debugActionHandlers = createDebugActionHandlers({
  runtime: {
    takeScreenshot: () => runtime?.takeScreenshot(),
    endGame: (text) => runtime?.endGame(text)
  },
  input: { clear: () => sceneApp?.app.input.clear() },
  createDiagnosticsReport,
  requestProbe,
  setDiagnosticsCopyState: (value) => {
    diagnosticsCopyState = value;
  },
  diagTextFile: DIAG_TEXT_FILE,
  diagJsonFile: DIAG_JSON_FILE
});

// SceneYAMLからWebgSceneAppを初期化し、ModelYAMLのNodeを既存gameplayへ接続する
const start = async () => {
  sceneAsset = await SceneAsset.load("./scene.yaml");
  sceneAsset.assertValid();
  sceneApp = await ArenaSceneApp.create({
    project: sceneAsset,
    physics: false,
    effects: { shadow: true, ssao: false, ssr: true, dof: false },
    onUpdate: updateFrame,
    onError: handleRuntimeError
  });

  const app = sceneApp.app;
  const model = sceneApp.model;
  const getNode = (id) => model.getNode(id);
  const getShape = (id) => {
    const shapes = model.getEntry(id).shapes;
    if (shapes.length !== 1) throw new Error(`circular_breaker2 node "${id}" must contain one Shape`);
    return shapes[0];
  };
  const puckNode = getNode("puck");
  const puckShape = getShape("puck");
  const puckShadowNode = getNode("puck-shadow");
  const paddleNode = getNode("paddle");
  const paddleBodyNode = getNode("paddle-body");
  const paddleShape = getShape("paddle-body");
  const paddleShadowNode = getNode("paddle-shadow");
  const paddleShadowBodyNode = getNode("paddle-shadow-body");
  // PBRの影と反射を使い、床へ重ねていた疑似シャドウの形状を描画対象から外す
  // ゲーム処理が位置更新するNodeは保ち、ステージ切り替えでも非表示を維持する
  getShape("puck-shadow").hide(true);
  getShape("paddle-shadow-body").hide(true);
  const { blocks, blockAssets, destroy } = await createBlockField({ model, gpu: app.getGPU() });
  destroyBlockTextures = destroy;
  gameBlocks = blocks;
  // 統合pipelineの既存BloomをHDR段階で有効にし、トーンマッピング前に合成する
  // SceneYAMLの高水準renderer設定にBloom項目がないため、サンプル側で明示する
  Object.assign(sceneApp.renderer.pipeline.bloomOptions, {
    enabled: true, threshold: 1.1, softKnee: .4, strength: .38, filterRadius: 1.0
  });

  // 旧版と同じくパドルの子に視点を置き、回転と横移動を画面全体へ反映する
  // Orbitのキー更新とpointer操作を解除し、左右キーをゲーム操作だけに使う
  app.eyeRig.detachPointer();
  app.eyeRigOptions = { update: false, syncCamera: false };
  app.eye.setParent(paddleNode);
  app.eye.setPosition(0, 34, 50);
  app.eye.setAttitude(0, -36, 0);
  app.viewAngle = 52;
  app.projectionFar = 2000;

  // SceneYAMLのPBR材質をゲーム固有のpuck/paddle色へ調整する
  puckShape.updateMaterial({
    color: [0.92, 0.96, 1.0, 1.0],
    metallic: 0.25,
    roughness: 0.30,
    specular: 1.0,
    emissive_factor: [0.02, 0.02, 0.02]
  });
  paddleShape.updateMaterial({
    color: [1.0, 0.28, 0.05, 1.0],
    metallic: 0.65,
    roughness: 0.20,
    specular: 1.0,
    emissive_factor: [0.12, 0.012, 0.002]
  });

  const audio = new GameAudioSynth();
  audio.setMasterVolume(0.40);
  audio.setSeVolume(0.90);
  audio.setBgmVolume(0.70);
  const sparkEmitter = await createSparkEmitter(sceneApp);
  const input = app.input;
  app.registerActionMap(ACTION_MAP);
  installTouchLayoutStyle(document);

  runtime = createGameRuntime({
    blocks,
    sparkEmitter,
    audio,
    screen: app.screen,
    puckNode,
    puckShape,
    puckShadowNode,
    paddleNode,
    paddleBodyNode,
    paddleShadowNode,
    paddleShadowBodyNode,
    blockAssets,
    // 押し続ける操作に加え、描画frameの間に押して離した短い入力も1frame分反映する
    isActionDown: (action) => app.getAction(action) || app.wasActionPressed(action),
    clearKeys: () => input.clear(),
    saveProgress: (key, data) => app.saveProgress(key, data),
    loadProgress: (key, defaultValue) => app.loadProgress(key, defaultValue)
  });
  phaseController = createScenePhaseController({ app, runtime, audio });
  debugProbe = new DebugProbe({ defaultAfterFrames: 1 });

  runtime.updateStageMissionText();
  runtime.resetBlocks();
  runtime.resetPaddleToInitial();
  runtime.resetPuck(true);
  phaseController.setScenePhase("intro", { force: true });

  input.attach({
    onKeyDown: () => {
      runtime.unlockAudio();
      requestStageStartIfWaiting();
    },
    onPointerDown: () => requestStageStartIfWaiting()
  });
  touchRoot = input.installTouchControls({
    touchDeviceOnly: false,
    className: "webg-touch-root cb-touch-root",
    groups: [
      {
        id: "rotate",
        className: "cb-touch-group",
        buttons: [
          { key: "rotate_left", label: "A", kind: "hold", ariaLabel: "rotate left" },
          { key: "rotate_right", label: "D", kind: "hold", ariaLabel: "rotate right" }
        ]
      },
      {
        id: "action",
        className: "cb-touch-group",
        buttons: [{ key: "reset", label: "R", kind: "action", ariaLabel: "reset puck" }]
      },
      {
        id: "move",
        className: "cb-touch-group",
        buttons: [
          { key: "move_left", label: "←", kind: "hold", ariaLabel: "move left" },
          { key: "move_right", label: "→", kind: "hold", ariaLabel: "move right" }
        ]
      }
    ],
    onAnyPress: () => requestStageStartIfWaiting()
  });
  updateTouchActionVisibility();
  updateHud();
  sceneApp.start();
};

document.addEventListener("DOMContentLoaded", () => {
  start().catch((error) => {
    handleRuntimeError(error);
    sceneApp?.destroy();
    destroyBlockTextures?.();
    destroyBlockTextures = null;
  });
});

// ページ離脱時にPBR、ModelAsset、ParticleEmitter、入力処理をまとめて解放する
window.addEventListener("pagehide", () => {
  sceneApp?.destroy();
  destroyBlockTextures?.();
  destroyBlockTextures = null;
  sceneApp = null;
});
