// -------------------------------------------------
// circular_breaker sample
//   scenePhases.js 2026/04/09
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// -------------------------------------------------

import GameStateManager from "../GameStateManager.js";
import { applyGameBgmPreset, playGameEventSound } from "../GameAudioPresets.js";

// この file は main.js から createScenePhaseController() として呼ばれ、
// GameStateManager を使って circular_breaker の最上位の場面を管理する
// stageFlow.js は stage 内ルールだけを更新し、
// ここではその結果を intro / play / pause / stage-clear / result へ変換する

// circular_breaker 用の top-level state machine を構築する
// main.js から state 定義の塊を外し、
// phase と音の対応を別 module で比較できるようにする
export const createScenePhaseController = ({
  app,
  runtime,
  audio
}) => {
  const gsm = new GameStateManager({
    initialState: "intro"
  });
  let startRequested = false;
  let restartRequested = false;
  app.setScenePhase("intro", {
    force: true
  });

  // 外側の code から現在 phase を読みやすくする薄い helper
  const getScenePhase = () => gsm.currentStateId ?? "intro";

  // manual に phase を切り替える時は GameStateManager を直接操作し、
  // pause のような明示遷移だけを main.js から扱えるようにする
  const setScenePhase = (phase, options = {}) => {
    const result = gsm.setState(phase, options);
    app.setScenePhase(gsm.currentStateId ?? phase, {
      force: true
    });
    return result;
  };

  // intro の開始要求は keyboard / touch のどちらから来ても
  // 1 frame 分の one-shot flag として扱う
  const requestStageStart = () => {
    runtime.unlockAudio();
    startRequested = true;
    return true;
  };

  // result からの restart も one-shot flag にし、
  // 実際の intro 遷移判定は state machine 側へ集約する
  const requestRestart = () => {
    restartRequested = true;
    return true;
  };

  // 毎フレームの update では runtime が持つ stage 内状態と
  // input から来た one-shot 要求をまとめて state machine へ渡す
  const updateScenePhase = (nowMs, deltaMs, options = {}) => {
    const result = gsm.update({
      nowMs,
      ...runtime.getSceneSignals(),
      startRequested,
      restartRequested,
      resumeRequested: options.resumeRequested === true
    }, deltaMs);
    app.setScenePhase(result?.state?.id ?? gsm.currentStateId ?? "intro", {
      force: true
    });
    startRequested = false;
    restartRequested = false;
    return result;
  };

  // pause 解除は 1 フレームだけ resumeRequested を立てればよいので、
  // key handler 側ではこの helper だけ呼べばよい形にする
  const requestResume = (nowMs = performance.now()) => updateScenePhase(nowMs, 0, {
    resumeRequested: true
  });

  // intro では開始待機中か次 stage 準備中かで BGM を分ける
  // pause から戻ってきた直後以外は ready voice を鳴らして開始前を知らせる
  const enterIntro = ({ machine }) => {
    const previousPhase = machine.currentTransition?.from ?? null;
    if (previousPhase === "stage-clear" || previousPhase === "play") {
      // stage-clear 後だけでなく time-up で play から直接 intro へ戻る時も、
      // 次 stage の待機表示に入る準備をここでそろえる
      runtime.prepareStageIntro(false);
    }
    applyGameBgmPreset(audio, runtime.state.stageIntroNeedsInput ? "menu" : "field");
    if (!runtime.state.audioUnlocked) return;
    audio.startBgm();
    if (previousPhase !== "intro") {
      playGameEventSound(audio, "ready");
    }
  };

  // play は実ゲーム中の標準 phase
  // pause 復帰時は毎回 go voice が重複しないよう前 phase を見て抑制する
  const enterPlay = ({ machine }) => {
    const previousPhase = machine.currentTransition?.from ?? null;
    if (previousPhase !== "pause") {
      runtime.beginStagePlay();
    }
    applyGameBgmPreset(audio, "chase");
    if (!runtime.state.audioUnlocked) return;
    audio.startBgm();
    if (previousPhase !== "pause") {
      playGameEventSound(audio, "go");
    }
  };

  // pause は runtime 側も停止状態へ切り替え、
  // 停止通知音でプレイ停止を音でも把握できるようにする
  const enterPause = () => {
    applyGameBgmPreset(audio, "menu");
    if (!runtime.state.audioUnlocked) return;
    audio.startBgm();
    playGameEventSound(audio, "stop");
  };

  // stage clear は短い演出 phase として扱い、
  // victory BGM と clear 通知音をここで直接鳴らす
  const enterStageClear = () => {
    applyGameBgmPreset(audio, "victory");
    if (!runtime.state.audioUnlocked) return;
    audio.startBgm();
    playGameEventSound(audio, "clear");
  };

  // result は game over や pack empty の終端 phase
  // fail 通知音はここで 1 回だけ鳴らす
  const enterResult = () => {
    applyGameBgmPreset(audio, "menu");
    if (!runtime.state.audioUnlocked) return;
    audio.startBgm();
    playGameEventSound(audio, "fail");
  };

  gsm.addState({
    id: "intro",
    onEnter: enterIntro,
    transitions: [
      {
        to: "play",
        label: "start stage",
        test: (context) =>
          context.startRequested === true
          || (context.stageIntroNeedsInput !== true && context.stageIntroSec <= 0.0)
      },
      {
        to: "result",
        label: "game over",
        test: (context) => context.gameFinished === true
      }
    ]
  });

  gsm.addState({
    id: "play",
    onEnter: enterPlay,
    transitions: [
      {
        to: "intro",
        label: "next stage without clear banner",
        test: (context) => context.stageClearBannerSec <= 0.0 && context.stageIntroSec > 0.0
      },
      {
        to: "stage-clear",
        label: "show clear banner",
        test: (context) => context.stageClearBannerSec > 0.0
      },
      {
        to: "result",
        label: "game over",
        test: (context) => context.gameFinished === true
      }
    ]
  });

  gsm.addState({
    id: "pause",
    onEnter: enterPause,
    transitions: [
      {
        to: "play",
        label: "resume",
        test: (context) => context.resumeRequested === true
      },
      {
        to: "result",
        label: "game over while paused",
        test: (context) => context.gameFinished === true
      }
    ]
  });

  gsm.addState({
    id: "stage-clear",
    onEnter: enterStageClear,
    transitions: [
      {
        to: "intro",
        label: "prepare next stage",
        test: (context) => context.stageClearBannerSec <= 0.0 && context.stageIntroSec > 0.0
      },
      {
        to: "result",
        label: "game over",
        test: (context) => context.gameFinished === true
      }
    ]
  });

  gsm.addState({
    id: "result",
    onEnter: enterResult,
    transitions: [
      {
        to: "intro",
        label: "restart",
        test: (context) => context.restartRequested === true
      }
    ]
  });

  return {
    getScenePhase,
    setScenePhase,
    updateScenePhase,
    requestResume,
    requestStageStart,
    requestRestart
  };
};

export default createScenePhaseController;
