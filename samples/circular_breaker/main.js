// -------------------------------------------------
// circular_breaker sample
//   main.js       2026/04/10
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// -------------------------------------------------

import WebgApp from "../../webg/WebgApp.js";
import SmoothShader from "../../webg/SmoothShader.js";
import GameAudioSynth from "../../webg/GameAudioSynth.js";
import Diagnostics from "../../webg/Diagnostics.js";
import DebugConfig from "../../webg/DebugConfig.js";
import DebugProbe from "../../webg/DebugProbe.js";
import { applyGameBgmPreset } from "../GameAudioPresets.js";

import {
  RAD,
  SHADOW_Y,
  PADDLE_HALF_LEN,
  PADDLE_HALF_DEPTH,
  PADDLE_Y,
  PUCK_RADIUS,
  PARTICLE_POOL,
  clamp
} from "./constants.js";
import { makeBeveledCylinder, makeBeveledBox, colorize } from "./shapeFactory.js";
import { drawHud } from "./Hud.js";
import { createGameRuntime } from "./gameRuntime.js";
import { createScenePhaseController } from "./scenePhases.js";
import { createSparkEmitter, drawSparkEmitter } from "./particleEffects.js";
import { createArenaLight, createArenaBackdrop } from "./arenaScene.js";
import { createBlockField } from "./blockField.js";
import {
  ACTION_MAP,
  installTouchLayoutStyle,
  createDebugActionHandlers,
  runPressedActionHandlers
} from "./inputConfig.js";

const FONT_FILE = "../../webg/font512.png";
const DIAG_TEXT_FILE = "circular_breaker_diagnostics.txt";
const DIAG_JSON_FILE = "circular_breaker_diagnostics.json";
const DEBUG_MODE = "release";
const HELP_LINES = [
  "ArrowLeft / ArrowRight: move paddle",
  "[a] / [d]: rotate paddle",
  "[enter] / [space] / click: start stage",
  "[r]: reset puck / restart after result",
  "[k]: pause on/off",
  "[o]: force game over",
  "[p]: save screenshot",
  "[q] / [w]: diagnostics probe text / json",
  "[c] / [v]: copy diagnostics text / json",
  "[j] / [l]: log diagnostics text / json",
  "[f] / [g]: save diagnostics text / json",
  "[m]: toggle debug / release"
];

// ゲーム全体の初期化とメインループ構築
const start = async () => {
  // 1) WebgApp を入口にして、起動・viewport・projection・HUD 基盤を標準経路へ寄せる
  const app = new WebgApp({
    document,
    shaderClass: SmoothShader,
    messageFontTexture: FONT_FILE,
    clearColor: [0.1, 0.1, 0.2, 1.0],
    viewAngle: 52.0,
    projectionFar: 2000.0,
    lightPosition: [0.0, 110.0, 90.0, 1.0],
    debugTools: {
      mode: DEBUG_MODE
    }
  });
  await app.init();

  const screen = app.screen;
  const gpu = app.getGL();
  const msg = app.message;
  msg.charOffset = 0;
  msg.shader.setScale(1.0);

  // GameAudioSynth: WebAudio(oscillator) ベースのSE/BGM
  const audio = new GameAudioSynth();
  audio.setMasterVolume(0.22);
  audio.setSeVolume(0.90);
  audio.setBgmVolume(0.70);
  // BGM の場面切り替えは sample 側の preset へ分離し、
  // GameAudioSynth 本体は melody / SE catalog の管理へ集中させる
  applyGameBgmPreset(audio, "menu");

  // 3) シーン管理クラス
  const space = app.space;

  // 4) アリーナ背景
  // 床、床パターン、外周壁、ガイドリング、light を builder 側へ寄せ、
  // start() では「scene 全体をどの順で組み立てるか」だけを追えるようにする
  createArenaLight(space);
  const {
    floorShape,
    ringShape
  } = createArenaBackdrop({
    space,
    gpu
  });

  // 8) パック
  const puckNode = space.addNode(null, "puck");
  const puckShape = makeBeveledCylinder(gpu, PUCK_RADIUS, 1.8, 0.45, 24);
  colorize(puckShape, [0.95, 0.97, 1.0, 1.0], 0.10, 1.20, 92.0, 0.0);
  puckNode.addShape(puckShape);

  // 9) パドル（ベベル付き長方形）
  // paddleNode:
  //   - 当たり判定/移動/カメラ追従の基準ノード
  // paddleBodyNode:
  //   - 見た目専用ノード
  //   - 反作用の押し戻しをここにだけ加え、カメラ揺れを分離する
  const paddleNode = space.addNode(null, "paddle");
  const paddleBodyNode = space.addNode(paddleNode, "paddleBody");
  const paddleShape = makeBeveledBox(gpu, PADDLE_HALF_LEN * 2.0, 1.8, PADDLE_HALF_DEPTH * 2.0, 0.36);
  colorize(paddleShape, [1.0, 0.55, 0.20, 1.0], 0.16, 1.10, 86.0, 0.0);
  paddleBodyNode.addShape(paddleShape);
  paddleNode.setPosition(0.0, PADDLE_Y, 0.0);

  // パドル/パックの疑似影（床上に薄い暗色メッシュを追従表示）
  const paddleShadowNode = space.addNode(null, "paddleShadow");
  const paddleShadowBodyNode = space.addNode(paddleShadowNode, "paddleShadowBody");
  const paddleShadowShape = makeBeveledBox(gpu, PADDLE_HALF_LEN * 2.0 * 0.98, 0.18, PADDLE_HALF_DEPTH * 2.0 * 0.98, 0.04);
  colorize(paddleShadowShape, [0.03, 0.03, 0.04, 1.0], 0.95, 0.0, 4.0, 0.0);
  paddleShadowBodyNode.addShape(paddleShadowShape);
  paddleShadowNode.setPosition(0.0, SHADOW_Y, 0.0);

  const puckShadowNode = space.addNode(null, "puckShadow");
  const puckShadowShape = makeBeveledCylinder(gpu, PUCK_RADIUS * 1.18, 0.14, 0.03, 20);
  colorize(puckShadowShape, [0.03, 0.03, 0.04, 1.0], 0.95, 0.0, 4.0, 0.0);
  puckShadowNode.addShape(puckShadowShape);
  puckShadowNode.setPosition(0.0, SHADOW_Y, 0.0);

  // 10) カメラ
  // パドル子ノードとして配置し、パドル基準視点で追従させる
  const eye = space.addNode(paddleNode, "eye");
  eye.setPosition(0.0, 34.0, 50.0);
  eye.setAttitude(0.0, -36.0, 0.0);

  // 11) block field
  // texture、prototype、配置済み node table を builder から受け取り、
  // runtime / stageFlow はここで受け取った table を共有して使う
  const {
    blocks,
    blockAssets
  } = await createBlockField({
    space,
    gpu
  });

  // 12) spark effect
  // spark effect は ParticleEmitter を使ってまとめて管理し、
  // main.js では「何発まで保持するか」と「どの preset を使うか」だけを見る
  const sparkEmitter = await createSparkEmitter(app);

  // 入力管理
  // WebgApp が用意した InputController をそのまま使い、
  // gameplay 側はキー状態と action だけに集中する
  const input = app.input;
  app.registerActionMap(ACTION_MAP);
  installTouchLayoutStyle(document);

  // ゲーム進行ロジックをランタイムに集約
  const runtime = createGameRuntime({
    blocks,
    sparkEmitter,
    audio,
    screen,
    puckNode,
    puckShape,
    puckShadowNode,
    paddleNode,
    paddleBodyNode,
    paddleShadowNode,
    paddleShadowBodyNode,
    blockAssets,
    isActionDown: (action) => app.getAction(action),
    clearKeys: () => input.clear(),
    saveProgress: (key, data) => app.saveProgress(key, data),
    loadProgress: (key, defaultValue) => app.loadProgress(key, defaultValue)
  });
  // GameStateManager の定義塊を別 module へ寄せ、
  // main.js は scene 構築と loop / input 配線へ集中させる
  const {
    getScenePhase,
    setScenePhase,
    updateScenePhase,
    requestResume,
    requestStageStart,
    requestRestart
  } = createScenePhaseController({
    app,
    runtime,
    audio
  });

  const debugProbe = new DebugProbe({
    defaultAfterFrames: 1
  });
  let diagnosticsCopyState = "READY";
  let debugProbeState = "IDLE";
  let debugProbeFormat = "text";

  const createDiagnosticsReport = (stage = "runtime") => {
    const aliveBlocks = blocks.filter((block) => block.active).length;
    const lockedBlocks = blocks.filter((block) => block.active && block.type === "locked").length;
    const hardBlocks = blocks.filter((block) => block.active && block.type === "hard").length;
    const report = Diagnostics.createSuccessReport({
      system: "circular_breaker",
      source: "samples/circular_breaker/main.js",
      stage
    });
    const allShapes = [
      floorShape,
      ringShape,
      puckShape,
      paddleShape,
      ...blocks.map((block) => block.shape)
    ];
    const endedShapeCount = allShapes.filter((shape) => shape?.vertexBuffer || shape?.indexBuffer).length;
    const phase = getScenePhase();
    Diagnostics.mergeStats(report, {
      level: runtime.state.level,
      score: runtime.state.score,
      packsRemain: runtime.state.packsRemain,
      destroyedThisStage: runtime.state.destroyedThisStage,
      targetBreaks: runtime.state.targetBreaks,
      aliveBlocks,
      lockedBlocks,
      hardBlocks,
      paused: phase === "pause" ? "yes" : "no",
      gameEnded: phase === "result" ? "yes" : "no",
      scenePhase: phase,
      audioUnlocked: runtime.state.audioUnlocked ? "yes" : "no",
      particlePool: sparkEmitter?.maxParticles ?? PARTICLE_POOL,
      activeParticles: runtime.getActiveParticleCount(),
      endedShapeCount
    });
    Diagnostics.addDetail(report, `stageResult=${runtime.state.stageResultText}`);
    Diagnostics.addDetail(report, `packEvent=${runtime.state.packEventText || "-"}`);
    Diagnostics.addDetail(report, `puck=(${runtime.state.puckX.toFixed(2)},${runtime.state.puckZ.toFixed(2)}) v=(${runtime.state.puckVx.toFixed(2)},${runtime.state.puckVz.toFixed(2)})`);
    Diagnostics.addDetail(report, `paddle=(${runtime.state.paddleCx.toFixed(2)},${runtime.state.paddleCz.toFixed(2)}) yaw=${(runtime.state.paddleYaw * RAD).toFixed(1)}`);
    return report;
  };

  const getProbeStatusLine = () =>
    `mode=${DebugConfig.mode} probe=${debugProbeState} pending=${debugProbe.getPendingCount?.() ?? 0} fmt=${debugProbeFormat}`;

  const getDiagnosticsStatusLine = (report) =>
    `diag=${report.ok ? "OK" : "ERROR"} stage=${report.stage} copy=${diagnosticsCopyState}`;

  const requestProbe = (format = "text", afterFrames = 1) => {
    debugProbeFormat = format;
    const probeId = debugProbe.request({
      label: `circular_breaker_${format}_probe`,
      format,
      afterFrames,
      frameCount: screen.getFrameCount?.() ?? 0,
      collect: () => createDiagnosticsReport("runtime-probe"),
      onReady: async (result) => {
        if (!DebugConfig.isEnabled("enableDiagnostics")) {
          diagnosticsCopyState = format === "json" ? "PROBE JSON READY" : "PROBE TEXT READY";
          return;
        }
        if (format === "json") {
          const copied = await Diagnostics.copyJSON(result.payload);
          diagnosticsCopyState = copied ? "PROBE JSON COPIED" : "PROBE JSON READY";
        } else {
          const copied = await Diagnostics.copyText(result.payload);
          diagnosticsCopyState = copied ? "PROBE TEXT COPIED" : "PROBE TEXT READY";
        }
      }
    });
    debugProbeState = probeId ? `WAIT ${afterFrames}F` : "PROBE DISABLED";
  };
  const debugActionHandlers = createDebugActionHandlers({
    runtime,
    input,
    createDiagnosticsReport,
    requestProbe,
    setDiagnosticsCopyState: (value) => {
      diagnosticsCopyState = value;
    },
    diagTextFile: DIAG_TEXT_FILE,
    diagJsonFile: DIAG_JSON_FILE
  });

  // 初期状態を整えてメインループ開始
  runtime.updateStageMissionText();
  runtime.resetBlocks();
  runtime.resetPaddleToInitial();
  runtime.resetPuck(true);
  setScenePhase("intro", {
    force: true
  });

  // intro の待機中だけ、任意の入力で gameplay 開始へ進める
  // keyboard action と pointer / touch の両方から同じ処理を呼べるようにする
  const requestStageStartIfWaiting = () => {
    if (getScenePhase() !== "intro") return false;
    if (runtime.state.stageIntroSec <= 0.0) return false;
    return requestStageStart();
  };

  // result では restart、それ以外では puck reset として扱う
  // keyboard / touch の両方から同じ action 名で呼べるようにする
  const handleResetAction = () => {
    if (getScenePhase() === "result") {
      runtime.restartGame();
      requestRestart();
      return;
    }
    runtime.resetPuck();
  };

  // pause は play <-> pause の往復だけを受け持ち、
  // intro / result / stage-clear では反応させない
  const handlePauseAction = () => {
    if (getScenePhase() === "play") {
      setScenePhase("pause", {
        force: true,
        context: {
          source: "action-toggle"
        }
      });
      return;
    }
    if (getScenePhase() === "pause") {
      requestResume(performance.now());
    }
  };

  // action map から得た one-shot input を gameplay 操作へ反映する
  // game 操作は key 名ではなく action 名で扱い、入力源差を main loop へ持ち込まない
  const handleGameActions = () => {
    if (app.wasActionPressed("pause")) {
      handlePauseAction();
    }
    if (app.wasActionPressed("start")) {
      requestStageStartIfWaiting();
    }
    if (app.wasActionPressed("reset")) {
      handleResetAction();
    }
  };

  // メインループ
  // 入力/物理更新 -> 描画 -> 次フレーム予約
  const loop = () => {
    try {
      updateTouchActionVisibility();
      const now = performance.now();
      let dt = (now - runtime.state.lastMs) / 1000.0;
      runtime.state.lastMs = now;
      dt = clamp(dt, 0.0, 0.033);
      updateScenePhase(now, dt * 1000.0);
      handleGameActions();
      runPressedActionHandlers(app, debugActionHandlers);
      const phase = getScenePhase();

      if (phase === "result") {
        // 終了時はゲーム進行を止めるが、描画/演出更新は継続する
        // 例外が起きても finally 側で次フレームを予約し、見かけ上の停止を避ける
        const diagnosticsReport = createDiagnosticsReport("game-ended");
        const probeResult = debugProbe.update(screen.getFrameCount?.() ?? 0);
        if (probeResult && debugProbeState.startsWith("WAIT")) {
          debugProbeState = `READY ${probeResult.format.toUpperCase()}`;
        }
        runtime.updateStageFlow(dt);
        app.updateParticleEmitters(dt * 1000.0);
        screen.clear();
        space.draw(eye);
        drawSparkEmitter(sparkEmitter, eye, app.projectionMatrix);
        drawHud(msg, runtime.state, {
          scenePhase: phase,
          debugLines: DebugConfig.isDebug()
            ? [getDiagnosticsStatusLine(diagnosticsReport), getProbeStatusLine()]
            : []
        });
        screen.present();
        return;
      }
      if (phase === "pause") return;

      runtime.updatePaddle(dt);
      runtime.updatePuck(dt);
      runtime.updateStageFlow(dt);
      app.updateParticleEmitters(dt * 1000.0);
      runtime.updateLevel();
      const diagnosticsReport = createDiagnosticsReport("runtime");
      const probeResult = debugProbe.update(screen.getFrameCount?.() ?? 0);
      if (probeResult && debugProbeState.startsWith("WAIT")) {
        debugProbeState = `READY ${probeResult.format.toUpperCase()}`;
      }

      screen.clear();
      space.draw(eye);
      drawSparkEmitter(sparkEmitter, eye, app.projectionMatrix);
      drawHud(msg, runtime.state, {
        scenePhase: phase,
        debugLines: DebugConfig.isDebug()
          ? [getDiagnosticsStatusLine(diagnosticsReport), getProbeStatusLine()]
          : []
      });
      screen.present();
    } catch (err) {
      // ループ内例外で requestAnimationFrame が途切れるのを防ぐ
      console.error("circular_breaker loop error:", err);
    } finally {
      // action edge は 1 frame ごとに落とし、
      // wasActionPressed() を次 frame へ持ち越さない
      input.beginFrame();
      requestAnimationFrame(loop);
    }
  };

  // 入力ハンドラ
  // gameplay 操作は action map を main loop 側で処理し、
  // ここでは音声 unlock と開始トリガだけに絞る
  input.attach({
    onKeyDown: () => {
      runtime.unlockAudio();
      requestStageStartIfWaiting();
    },
    onPointerDown: () => {
      requestStageStartIfWaiting();
    }
  });
  const touchRoot = input.installTouchControls({
    // circular_breaker でもPCデバッグで配置確認できるよう常時表示にする
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
        buttons: [
          { key: "reset", label: "R", kind: "action", ariaLabel: "reset puck" }
        ]
      },
      {
        id: "move",
        className: "cb-touch-group",
        buttons: [
          { key: "move_left", label: "\u2190", kind: "hold", ariaLabel: "move left" },
          { key: "move_right", label: "\u2192", kind: "hold", ariaLabel: "move right" }
        ]
      }
    ],
    onAnyPress: () => {
      requestStageStartIfWaiting();
    }
  });

  const updateTouchActionVisibility = () => {
    if (!touchRoot) return;
    const actionBtn = touchRoot.querySelector(".webg-touch-btn[data-key='reset']");
    if (!actionBtn) return;
    // GameStateManager の top-level phase を基準にし、
    // play / pause 中だけ中央Rボタンを隠して intro / clear / result では再表示する
    const phase = getScenePhase();
    const hideDuringGameplay = phase === "play" || phase === "pause";
    actionBtn.style.display = hideDuringGameplay ? "none" : "";
  };
  updateTouchActionVisibility();

  requestAnimationFrame(loop);
};

// エントリポイント
document.addEventListener("DOMContentLoaded", () => {
  start().catch((err) => {
    console.error(err);
  });
});
