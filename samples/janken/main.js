// ---------------------------------------------
// samples/janken/main.js  2026/07/25
//   Janken game using hand.glb and AnimationState
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import WebgApp from "../../webg/WebgApp.js";
import { buildErrorPanelOptions } from "../../webg/OverlayPanelPresets.js";
import SmoothShader from "../../webg/SmoothShader.js";
import Action from "../../webg/Action.js";
import AnimationState from "../../webg/AnimationState.js";
import Message from "../../webg/Message.js";
import Diagnostics from "../../webg/Diagnostics.js";
import GameStateManager from "../GameStateManager.js";

const GLTF_FILE = new URL("../gltf_loader/hand.glb", import.meta.url).href;
const FONT_FILE = "../../webg/font512.png";

// janken で使う 3 つの手を、画面表示・入力ガイド・AnimationState の state 名まで
// 1 つの表から引けるようにまとめる
const CHOICES = [
  {
    id: "rock",
    label: "Rock",
    guideKey: "G",
    action: "N0"
  },
  {
    id: "scissors",
    label: "Scissors",
    guideKey: "C",
    action: "N2"
  },
  {
    id: "paper",
    label: "Paper",
    guideKey: "P",
    action: "N5"
  }
];

const FINGER_PATTERNS = [
  { id: "N1", fromKey: 2, toKey: 3, entryDurationMs: 250 },
  { id: "N2", fromKey: 4, toKey: 5, entryDurationMs: 250 },
  { id: "N3", fromKey: 6, toKey: 7, entryDurationMs: 250 },
  { id: "N4", fromKey: 8, toKey: 9, entryDurationMs: 250 },
  { id: "N5", fromKey: 10, toKey: 11, entryDurationMs: 250 },
  { id: "N0", fromKey: 12, toKey: 13, entryDurationMs: 250 }
];

const RESULT_COLORS = {
  ready: [0.90, 0.92, 1.0],
  win: [0.42, 1.0, 0.52],
  lose: [1.0, 0.48, 0.48],
  draw: [1.0, 0.90, 0.42]
};

let app = null;
let resultMessage = null;
let playerHand = null;
let cpuHand = null;
let gameStateManager = null;
let roundCount = 0;
let lastInputKey = "";
let sharedHandModel = null;
// 現在 round の表示内容を 1 箇所へ集約し、
// Message と diagnostics の両方が同じ情報源を見るようにする
let resultState = {
  kind: "ready",
  title: "Press G / C / P",
  detail: "Rock / Scissors / Paper",
  playerChoiceId: "rock",
  cpuChoiceId: "rock"
};

// シーンの進行段階を現在の入力と実行状態に合わせて更新する
function syncScenePhase(phase = gameStateManager?.currentStateId ?? null) {
  if (!app || !phase) {
    return null;
  }
  app.setScenePhase(phase, {
    force: true
  });
  return phase;
}

// シーンの進行段階を受け取り、現在の設定と後続処理へ反映する
function setScenePhase(phase, options = {}) {
  if (!gameStateManager) {
    return null;
  }
  const result = gameStateManager.setState(phase, options);
  syncScenePhase();
  return result;
}

const HAND_SPACING_X = 1.15;
const HAND_DEPTH_Z = 0.0;
const CAMERA_DISTANCE_SCALE = 1.884;
const CAMERA_PITCH_DEG = 10.0;
const TOUCH_BUTTON_GROUP = [
  {
    id: "janken-touch",
    buttons: [
      { key: "g", label: "G", kind: "action", ariaLabel: "choose rock" },
      { key: "c", label: "C", kind: "action", ariaLabel: "choose scissors" },
      { key: "p", label: "P", kind: "action", ariaLabel: "choose paper" }
    ]
  }
];

// 読み込み完了後に sample 全体を立ち上げる
// 失敗時は diagnostics report と画面上の error panel を両方出して、
// sample 利用者が原因を追いやすいようにする
document.addEventListener("DOMContentLoaded", () => {
  start().catch((err) => {
    app?.setDiagnosticsReport?.(Diagnostics.createErrorReport(err, {
      system: "janken",
      source: "samples/janken/main.js",
      stage: app?.getDiagnosticsReport?.()?.stage ?? "start"
    }));
    if (app?.isConsoleEnabled?.()) {
      console.error("janken failed:", err);
    }
    app?.showOverlayPanel?.(buildErrorPanelOptions(err, {
      title: "janken sample failed",
      id: "start-error",
      background: "rgba(26, 38, 26, 0.92)"
    }));
  });
}, false);

function getChoice(choiceId) {
  return CHOICES.find((item) => item.id === choiceId) ?? CHOICES[0];
}

// app 側の手は各 round で独立に乱数決定する
// ここでは state 名そのものを返し、後段の Action / AnimationState 両方で再利用する
function getRandomChoice() {
  return CHOICES[Math.floor(Math.random() * CHOICES.length)];
}

// diagnostics の環境確認では 2 つの hand をまとめて渡したいので、
// player / cpu の shape 配列を毎回同じ手順で集める helper を用意する
function getAllShapes() {
  return [
    ...(playerHand?.fig?.shapes ?? []),
    ...(cpuHand?.fig?.shapes ?? [])
  ];
}

// 操作の制御処理を生成し、後続処理で利用できる状態にする
function buildActionController(animation) {
  const action = new Action(animation);
  // hand sample の key 区間をそのまま action 化し、
  // AnimationState は「どの action を出すか」の選択だけを担当する
  for (let i = 0; i < FINGER_PATTERNS.length; i++) {
    const pattern = FINGER_PATTERNS[i];
    action.addPattern(pattern);
    action.addAction(pattern.id, [pattern.id]);
  }
  action.setVerbose(false);
  return action;
}

// `hand`の状態の`machine`を生成し、後続処理で利用できる状態にする
function buildHandStateMachine(hand) {
  // janken では入力を高レベル command と見なし、
  // その場で AnimationState.setState() を呼んで action を開始する
  // update() は現在 action の進行と state 情報の保持に専念させる
  hand.machine = new AnimationState(hand.action, {
    initialState: "rock"
  });

  for (let i = 0; i < CHOICES.length; i++) {
    const choice = CHOICES[i];
    // janken では遷移条件の評価より、入力時の setState() が中心なので
    // 各 state は「対応 action を 1 つ持つ」最小形で登録する
    hand.machine.addState({
      id: choice.id,
      action: choice.action
    });
  }
  // 起動直後は 2 つの hand ともグーにそろえ、
  // 画面を開いた時点で pose が不定にならないようにする
  hand.machine.setState("rock", {
    startOptions: {
      entryDurationMs: 250
    },
    force: true
  });
}

// 実行状態の`root`のノードの`info`を現在の入力と状態から求め、呼び出し元へ返す
function getRuntimeRootNodeInfo(runtime) {
  // runtime.nodes は build 結果の node 定義なので、
  // instantiate ごとに同じ root id を使って scene 上の root node を引ける
  return runtime.nodes.find((item) => item.parent === null)
    ?? runtime.nodes[0]
    ?? null;
}

// `shared`の`hand`のモデルを読み込み、検証済みのデータとして後続処理へ渡す
async function loadSharedHandModel() {
  // hand.glb の build は 1 回だけ行い、
  // player / cpu は runtime.instantiate() で fresh runtime を複数作る
  sharedHandModel = await app.loadModel(GLTF_FILE, {
    format: "gltf",
    instantiate: false,
    startAnimations: false,
    gltf: {
      includeSkins: true
    }
  });
  return sharedHandModel;
}

// `instantiateHandModel`は元データから独立して利用できる複製または実行状態を作る
function instantiateHandModel() {
  // 1 回 build した runtime から fresh な node / shape / animation 状態を起こし、
  // 2 つの hand が同じ resource を共有しつつ pose は独立するようにする
  if (!sharedHandModel) {
    throw new Error("Shared hand model is not loaded");
  }
  return sharedHandModel.instantiate(app.space, {
    bindAnimations: true
  });
}

// `hand`の制御処理を生成し、後続処理で利用できる状態にする
async function createHandController(options) {
  const runtime = sharedHandModel?.runtime ?? null;
  const instantiated = instantiateHandModel();
  const shapes = instantiated.shapes;
  const rootNodeInfo = getRuntimeRootNodeInfo(runtime);
  const root = rootNodeInfo
    ? (instantiated.nodeMap?.get(rootNodeInfo.id) ?? null)
    : null;
  if (!root) {
    throw new Error(`Failed to resolve glTF root node for ${options.id}`);
  }

  // root は手全体の配置と向きを持つ node
  // 左右の位置やロール角はここでまとめて管理する
  root.setPosition(options.positionX, 0.0, 0.0);
  root.setAttitude(options.yaw, 0.0, options.roll ?? 0.0);

  const fig = { shapes };

  let vertexCount = 0;
  let triangleCount = 0;

  // 2 つの hand は同じ glb から作るが、別々の controller として扱う
  for (let i = 0; i < shapes.length; i++) {
    const shape = shapes[i];
    shape.setMaterial("smooth-shader", {
      ambient: 0.42,
      specular: 0.32,
      power: 42,
      use_texture: 0,
      use_normal_map: 0,
      color: options.color
    });
    vertexCount += shape.getVertexCount();
    triangleCount += shape.getTriangleCount();
  }

  const hand = {
    id: options.id,
    root,
    fig,
    action: buildActionController(fig.shapes[0].anim),
    machine: null,
    vertexCount,
    triangleCount
  };

  buildHandStateMachine(hand);
  return hand;
}

// diagnostics 用の要約値を毎 frame 更新する
// player / cpu の state と action を同じ report へまとめることで、
// どちらか片方だけが止まっていないかを見つけやすくする
function updateDiagnosticsStats() {
  const envReport = app.checkEnvironment({
    stage: "runtime-check",
    shapes: getAllShapes()
  });
  const playerDebug = playerHand?.machine?.getDebugInfo?.() ?? null;
  const cpuDebug = cpuHand?.machine?.getDebugInfo?.() ?? null;

  app.mergeDiagnosticsStats({
    roundCount,
    playerChoice: getChoice(resultState.playerChoiceId).label,
    cpuChoice: getChoice(resultState.cpuChoiceId).label,
    result: resultState.title,
    playerState: playerDebug?.stateId ?? "-",
    playerAction: playerDebug?.actionId ?? "-",
    cpuState: cpuDebug?.stateId ?? "-",
    cpuAction: cpuDebug?.actionId ?? "-",
    vertexCount: (playerHand?.vertexCount ?? 0) + (cpuHand?.vertexCount ?? 0),
    triangleCount: (playerHand?.triangleCount ?? 0) + (cpuHand?.triangleCount ?? 0),
    envOk: envReport.ok ? "yes" : "no",
    envWarning: envReport.warnings?.[0] ?? "-"
  });
  return envReport;
}

// 検査情報のレポートを生成し、後続処理で利用できる状態にする
function makeProbeReport(frameCount) {
  // one-shot probe では、その瞬間の勝敗結果と 2 つの手の state を固定する
  // round のあとで「何を出していたか」をテキストや JSON へ残しやすくする
  const envReport = app.checkEnvironment({
    stage: "runtime-probe",
    shapes: getAllShapes()
  });
  const report = app.createProbeReport("runtime-probe");
  const playerDebug = playerHand?.machine?.getDebugInfo?.() ?? null;
  const cpuDebug = cpuHand?.machine?.getDebugInfo?.() ?? null;
  Diagnostics.addDetail(report, `gltfFile=${GLTF_FILE}`);
  Diagnostics.addDetail(report, `playerChoice=${getChoice(resultState.playerChoiceId).label}`);
  Diagnostics.addDetail(report, `cpuChoice=${getChoice(resultState.cpuChoiceId).label}`);
  Diagnostics.addDetail(report, `result=${resultState.title}`);
  Diagnostics.addDetail(report, `playerState=${playerDebug?.stateId ?? "-"}`);
  Diagnostics.addDetail(report, `cpuState=${cpuDebug?.stateId ?? "-"}`);
  Diagnostics.addDetail(report, `playerAction=${playerDebug?.actionId ?? "-"}`);
  Diagnostics.addDetail(report, `cpuAction=${cpuDebug?.actionId ?? "-"}`);
  if (envReport.warnings?.length) {
    Diagnostics.addDetail(report, `envWarning=${envReport.warnings[0]}`);
  }
  Diagnostics.mergeStats(report, {
    frameCount,
    roundCount,
    playerAction: playerDebug?.actionId ?? "-",
    cpuAction: cpuDebug?.actionId ?? "-",
    vertexCount: (playerHand?.vertexCount ?? 0) + (cpuHand?.vertexCount ?? 0),
    triangleCount: (playerHand?.triangleCount ?? 0) + (cpuHand?.triangleCount ?? 0),
    envOk: envReport.ok ? "yes" : "no"
  });
  return report;
}

function getResultColor(kind) {
  return RESULT_COLORS[kind] ?? RESULT_COLORS.ready;
}

// `guide`の行を生成し、後続処理で利用できる状態にする
function buildGuideLines() {
  // ゲーム側の guide は必要最小限に絞り、
  // diagnostics key は WebgApp 側の共通仕様へ任せる
  return [
    "janken",
    "",
    "[g] rock(N0)  [c] scissors(N2)  [p] paper(N5)",
    "[touch] G / C / P",
    "[space] reset"
  ];
}

// 状態表示の行を生成し、後続処理で利用できる状態にする
function buildStatusLines(envReport) {
  // HUD では「入力」「現在の手」「AnimationState が選んでいる action」「勝敗」を
  // 1 画面で追えるようにする
  const playerDebug = playerHand?.machine?.getDebugInfo?.() ?? null;
  const cpuDebug = cpuHand?.machine?.getDebugInfo?.() ?? null;
  return [
    `phase=${app?.getScenePhase?.() ?? "-"} key=[${lastInputKey || " "}] round=${roundCount}`,
    `you=${getChoice(resultState.playerChoiceId).label} state=${playerDebug?.stateId ?? "-"} action=${playerDebug?.actionId ?? "-"}`,
    `app=${getChoice(resultState.cpuChoiceId).label} state=${cpuDebug?.stateId ?? "-"} action=${cpuDebug?.actionId ?? "-"}`,
    `result=${resultState.title}`,
    `env=${envReport.ok ? "OK" : "WARN"}`,
    app.getDiagnosticsStatusLine(),
    app.isDebugUiEnabled() ? app.getProbeStatusLine() : ""
  ];
}

// 結果のメッセージを現在の入力と実行状態に合わせて更新する
function updateResultMessage() {
  if (!resultMessage) return;
  resultMessage.clear();
  const color = getResultColor(resultState.kind);
  // 勝敗文字は短い ASCII title として Message block へ置き、
  // guide/status と独立に画面中央で読み取れるようにする
  resultMessage.setBlock("janken-result", [
    resultState.title,
    resultState.detail
  ], {
    anchor: "center",
    y: -2,
    align: "center",
    color,
    width: 28,
    clip: false
  });
}

// `judgeResult`は入力条件や交差状態を比較し、判定結果を返す
function judgeResult(playerChoiceId, cpuChoiceId) {
  // 判定は resultState に入る最終文字列までここで返し、
  // 呼び出し側が if を重ねずに済むようにする
  if (playerChoiceId === cpuChoiceId) {
    return {
      kind: "draw",
      title: "Draw",
      detail: `${getChoice(playerChoiceId).label} vs ${getChoice(cpuChoiceId).label}`
    };
  }
  const winsAgainst = {
    rock: "scissors",
    scissors: "paper",
    paper: "rock"
  };
  if (winsAgainst[playerChoiceId] === cpuChoiceId) {
    return {
      kind: "win",
      title: "You win",
      detail: `${getChoice(playerChoiceId).label} beats ${getChoice(cpuChoiceId).label}`
    };
  }
  return {
    kind: "lose",
    title: "You lose",
    detail: `${getChoice(cpuChoiceId).label} beats ${getChoice(playerChoiceId).label}`
  };
}

// 選択した手を手の形状と動作へ反映する
function applyChoiceToHand(hand, choiceId) {
  // janken は入力が来た瞬間に同じ state でも出し直したいので、
  // 高レベル API として AnimationState.setState(..., force:true) を使う
  hand.machine.setState(choiceId, {
    startOptions: {
      entryDurationMs: 250
    },
    force: true
  });
}

// `round`の初期化段階で、必要な状態と資源を準備して処理を開始する
function startRound(playerChoiceId) {
  // 1 回の入力で player / cpu の手決定、AnimationState 更新、
  // 勝敗表示更新までをまとめて進める
  const cpuChoice = getRandomChoice();
  roundCount += 1;

  applyChoiceToHand(playerHand, playerChoiceId);
  applyChoiceToHand(cpuHand, cpuChoice.id);

  resultState = {
    ...judgeResult(playerChoiceId, cpuChoice.id),
    playerChoiceId,
    cpuChoiceId: cpuChoice.id
  };
  updateResultMessage();
}

// ゲームを初期状態へ戻し、前回の状態を残さない
function resetGame() {
  // reset は round 数だけでなく、2 つの hand pose と Message 表示も
  // 起動直後と同じ状態へ戻す
  roundCount = 0;
  applyChoiceToHand(playerHand, "rock");
  applyChoiceToHand(cpuHand, "rock");
  resultState = {
    kind: "ready",
    title: "Press G / C / P",
    detail: "Rock / Scissors / Paper",
    playerChoiceId: "rock",
    cpuChoiceId: "rock"
  };
  updateResultMessage();
}

// キーを受け取った段階で、対応する状態更新と処理を実行する
function handleKey(key) {
  // 入力解釈はここに集約し、
  // attachInput 側は key を受けて振り分けるだけに保つ
  const normalizedKey = app?.input?.normalizeKey?.(key)
    ?? String(key ?? "").toLowerCase();
  lastInputKey = normalizedKey;

  switch (normalizedKey) {
    case "g":
      setScenePhase("result", {
        force: true,
        context: {
          playerChoiceId: "rock"
        }
      });
      break;
    case "c":
      setScenePhase("result", {
        force: true,
        context: {
          playerChoiceId: "scissors"
        }
      });
      break;
    case "p":
      setScenePhase("result", {
        force: true,
        context: {
          playerChoiceId: "paper"
        }
      });
      break;
    case "space":
      setScenePhase("ready", {
        force: true,
        context: {
          reason: "reset"
        }
      });
      break;
    default:
      break;
  }
}

// このインスタンスの初期化段階で、必要な状態と資源を準備して処理を開始する
async function start() {
  // WebgApp は camera / diagnostics / message font まで含めて初期化し、
  // sample 側は janken 固有の scene 構築へ集中する
  app = new WebgApp({
    document,
    shaderClass: SmoothShader,
    clearColor: [0.08, 0.10, 0.18, 1.0],
    lightPosition: [0.0, 140.0, 800.0, 1.0],
    viewAngle: 48.0,
    messageFontTexture: FONT_FILE,
    debugTools: {
      mode: "release",
      system: "janken",
      source: "samples/janken/main.js",
      probeDefaultAfterFrames: 1
    },
    camera: {
      target: [0.0, 0.0, 0.0],
      distance: 8.0,
      yaw: 0.0,
      pitch: CAMERA_PITCH_DEG
    }
  });
  await app.init();
  // janken のような小さい game でも phase helper が自然かを見るため、
  // ready と result の 2 状態だけを GameStateManager へ寄せて比較する
  gameStateManager = new GameStateManager({
    initialState: "ready"
  });
  gameStateManager.addState({
    id: "ready",
    onEnter: () => {
      resetGame();
    }
  });
  gameStateManager.addState({
    id: "result",
    onEnter: (info) => {
      const playerChoiceId = info?.context?.playerChoiceId ?? resultState.playerChoiceId;
      startRound(playerChoiceId);
    }
  });
  app.setDiagnosticsStage("loading");
  app.configureDiagnosticsCapture({
    labelPrefix: "janken",
    collect: () => makeProbeReport(app.screen.getFrameCount())
  });
  app.configureDebugKeyInput();
  app.attachInput({
    onKeyDown: (key) => handleKey(key)
  });
  const touchRoot = app.input.installTouchControls({
    touchDeviceOnly: false,
    groups: TOUCH_BUTTON_GROUP,
    onAction: ({ key }) => handleKey(key)
  });
  if (touchRoot) {
    touchRoot.style.justifyContent = "flex-end";
    touchRoot.style.alignItems = "flex-end";
    touchRoot.style.paddingLeft = "16px";
    touchRoot.style.paddingRight = "16px";
    touchRoot.style.paddingBottom = "18px";
    touchRoot.style.setProperty("--webg-touch-btn-font-size", "24px");
    const touchGroup = touchRoot.querySelector(".webg-touch-group");
    if (touchGroup) {
      touchGroup.style.gap = "12px";
    }
    const touchButtons = touchRoot.querySelectorAll(".webg-touch-btn");
    for (let i = 0; i < touchButtons.length; i++) {
      const btn = touchButtons[i];
      btn.style.width = "64px";
      btn.style.height = "64px";
    }
  }
  // guide は sample の固定説明なので起動時に一度だけ登録し、
  // 毎 frame は変化する status だけ更新する
  app.message.setLines("guide", buildGuideLines(), {
    anchor: "bottom-left",
    x: 0,
    y: -2,
    color: [0.90, 0.95, 1.0]
  });
  // 中央の勝敗 title は guide/status と別 scale で描きたいので、
  // sample 専用の Message を 1 つ持ち、短い ASCII 表示だけを担当させる
  resultMessage = new Message(app.getGPU());
  await resultMessage.init(FONT_FILE);
  resultMessage.shader.setScale(2.0);

  // 左右の hand は同じ asset から作るが、色と配置を変えて
  // player / cpu の役割が直感的に分かるようにする
  await loadSharedHandModel();
  playerHand = await createHandController({
    id: "player",
    positionX: -HAND_SPACING_X,
    yaw: 14.0,
    roll: -30.0,
    color: [0.95, 0.77, 0.71, 1.0]
  });
  cpuHand = await createHandController({
    id: "cpu",
    positionX: HAND_SPACING_X,
    // 右側の青い手は親指が見えるよう、local Y を少し内向きに振る
    yaw: 164.0,
    roll: 30.0,
    color: [0.66, 0.82, 1.0, 1.0]
  });
  cpuHand.root.setPosition(HAND_SPACING_X, 0.0, HAND_DEPTH_Z);

  // 2 つの手が画面に収まるよう、最初の hand size を基準に視点距離を決める
  // 少し引いた距離と上からの pitch を与え、左右の手と結果表示を同時に見やすくする
  const size = app.getShapeSize(playerHand.fig.shapes);
  app.cameraRig.setPosition(0.0, size.centery, size.centerz);
  app.eye.setPosition(0.0, 0.0, Math.max(1.0, size.max * CAMERA_DISTANCE_SCALE));
  app.eye.setAttitude(0.0, CAMERA_PITCH_DEG, 0.0);

  setScenePhase("ready", {
    force: true
  });
  app.setDiagnosticsStage("runtime");
  updateResultMessage();

  app.start({
    onUpdate: (ctx) => {
      // 毎 frame は 2 つの AnimationState を進め、
      // その結果を diagnostics と HUD へ反映するだけに保つ
      playerHand.machine.update({ nowMs: ctx.timeMs }, ctx.deltaSec * 1000.0);
      cpuHand.machine.update({ nowMs: ctx.timeMs }, ctx.deltaSec * 1000.0);

      const envReport = updateDiagnosticsStats();
      if (app.isDebugUiEnabled()) {
        app.message.setLines("status", buildStatusLines(envReport).filter(Boolean), {
          anchor: "top-left",
          x: 0,
          y: 0,
          color: [1.0, 0.88, 0.72]
        });
      } else {
        app.message.setLines("status", []);
      }
    },
    onAfterHud: () => {
      // 勝敗 title は HUD block の後ろへ埋もれないよう、
      // canvas HUD を描いたあとで中央に重ねる
      resultMessage.drawScreen();
    }
  });
}
