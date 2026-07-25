// ---------------------------------------------
// samples/circular_breaker/stageFlow.js  2026/04/09
//   circular_breaker sample
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import {
  PUCK_Y,
  STAGE_BASE_TARGET_BREAKS,
  STAGE_INTRO_MAX_SEC,
  STAGE_CLEAR_BANNER_SEC
} from "./constants.js";
import {
  countAliveBlocks,
  resetBlocksForStage
} from "./blockField.js";

// この file は gameRuntime.js から createStageFlowController() として使われ、
// stage クリア、時間切れ、game over、score 計算など
// play 中の stage 内だけで閉じる進行ルールをまとめる
// top-level phase の決定は scenePhases.js へ任せ、
// ここでは「stage 内で何が起きたか」と timer の更新だけを扱う

// stage 進行と block 再配置をまとめる helper
// runtime 本体は移動 / 衝突 / visual 更新へ集中し、
// 「いつ stage が進むか」「いつ game が終わるか」はここで追えるようにする
// ただし scene 遷移そのものは返さず、結果を state に反映するだけに止める
export const createStageFlowController = ({
  state,
  blocks,
  blockAssets,
  clearKeys,
  updateStageMissionText,
  spawnSparks,
  audio,
  highScoreStore
} = {}) => {
  const getAliveBlockCount = () => countAliveBlocks(blocks);

  const getStageRemainingSec = () => {
    const elapsed = (performance.now() - state.stageStartTime) / 1000.0;
    return Math.max(0.0, state.stageTimeLimitSec - elapsed);
  };

  const triggerPackEvent = (text, sec = 1.05) => {
    state.packEventText = text;
    state.packEventBannerSec = sec;
  };

  // 全 block を次 stage 用の type と見た目へ戻す
  // lock と switch の組み合わせは stage ごとに最低限成立するよう補正する
  const resetBlocks = () => {
    state.locksOpen = resetBlocksForStage({
      blocks,
      level: state.level,
      blockAssets
    });
  };

  const endGame = (reasonText = "GAME OVER") => {
    if (state.gameFinished) return false;
    state.gameFinished = true;
    state.stageClearBannerSec = 0.0;
    state.stageIntroSec = 0.0;
    state.stageIntroNeedsInput = false;
    state.gameOverText = reasonText;
    state.highScores = highScoreStore.addHighScore(state.score);
    clearKeys();
    return true;
  };

  // clear banner, intro wait, pack event などの stage 進行系 timer を進める
  // particle の寿命計算は ParticleEmitter 側が担当するため、ここでは stage 進行だけに絞る
  const updateStageFlow = (dt) => {
    const clearWasVisible = state.stageClearBannerSec > 0.0;
    if (state.stageClearBannerSec > 0.0) {
      state.stageClearBannerSec = Math.max(0.0, state.stageClearBannerSec - dt);
    }
    if (state.packEventBannerSec > 0.0) {
      state.packEventBannerSec = Math.max(0.0, state.packEventBannerSec - dt);
    }
    if (state.stageClearBannerSec <= 0.0 && state.stageIntroSec > 0.0) {
      if (state.stageIntroNeedsInput) return;
      state.stageIntroSec = Math.max(0.0, state.stageIntroSec - dt);
      if (clearWasVisible && state.stageIntroSec > 0.0) {
        // stage clear 演出が終わった次 frame から intro countdown を見せる
        // 実際の intro phase への遷移は scenePhases.js が判断する
        clearKeys();
      }
    }
  };

  const nextStage = (clearedByMission) => {
    clearKeys();
    const alive = getAliveBlockCount();
    const remainSec = getStageRemainingSec();
    const timeBonus = clearedByMission ? Math.floor(remainSec) * 10 : 0;
    const missionBonus = clearedByMission ? 400 * state.level : 0;
    const remainPenalty = alive * 50;
    const delta = missionBonus + timeBonus - remainPenalty;
    state.score = Math.max(0, state.score + delta);
    state.stageResultText = clearedByMission
      ? `CLEAR +${missionBonus + timeBonus} / PENALTY -${remainPenalty}`
      : `TIME UP PENALTY -${remainPenalty}`;
    state.stageClearBannerSec = clearedByMission ? STAGE_CLEAR_BANNER_SEC : 0.0;
    state.stageIntroSec = STAGE_INTRO_MAX_SEC;
    state.stageIntroNeedsInput = false;
    state.level++;
    // 次 stage の目標破壊数は base 値から組み直す
    // ここで import が抜けると nextStage() が途中で止まり、
    // destroyedThisStage や block 再配置が残って即再クリアの原因になる
    state.targetBreaks = STAGE_BASE_TARGET_BREAKS + (state.level - 1);
    state.puckSpeed = 28.0 + (state.level - 1) * 3.0;
    state.destroyedThisStage = 0;
    state.packEventBannerSec = 0.0;
    state.packEventText = "";
    if (!clearedByMission && state.audioUnlocked) {
      audio.playSe("gameover");
    }
    resetBlocks();
    spawnSparks(0, PUCK_Y, 0, 0.0);
  };

  const updateLevel = () => {
    if (state.gameFinished) return;
    if (state.stageIntroSec > 0.0) return;
    const alive = getAliveBlockCount();
    const remainSec = getStageRemainingSec();
    const missionDone = state.destroyedThisStage >= state.targetBreaks || alive <= 0;
    if (missionDone) {
      nextStage(true);
      return;
    }
    if (remainSec <= 0.0) {
      nextStage(false);
    }
  };

  return {
    resetBlocks,
    getAliveBlockCount,
    getStageRemainingSec,
    triggerPackEvent,
    endGame,
    updateStageFlow,
    updateLevel
  };
};

export default createStageFlowController;
