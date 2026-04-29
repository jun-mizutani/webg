// ---------------------------------------------
// samples/circular_breaker/Hud.js  2026/03/26
//   circular_breaker sample
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
// この file は main.js の render loop から drawHud() として呼ばれ、
// gameplay HUD、待機表示、result 表示をまとめて描く
// 状態遷移そのものは scenePhases.js に残し、
// ここでは state と現在 phase をどう見せるかだけを追えるようにする

const drawEntries = (msg, entries = [], scale = 1.0) => {
  if (!Array.isArray(entries) || entries.length === 0) return;
  msg.shader.setScale(scale);
  msg.replaceAll(entries);
  msg.drawScreen();
};

const drawDebugLines = (msg, lines = []) => {
  if (!Array.isArray(lines) || lines.length === 0) return;
  const startY = Math.max(0, 25 - lines.length);
  drawEntries(msg, lines.map((line, i) => ({
    id: `debug-${i}`,
    text: String(line),
    x: 0,
    y: startY + i,
    color: [0.80, 0.92, 1.0]
  })));
};

// HUD描画
// 通常は上部主要情報のみを表示し、操作ガイドは待機中のみ表示する
export const drawHud = (msg, state, options = {}) => {
  const debugLines = options.debugLines ?? [];
  const currentPhase = options.scenePhase ?? "intro";
  const isResultPhase = currentPhase === "result";
  // 上部固定HUD（scale=2）: LEVEL(左), 進捗(中央), SCORE(右), PACK(左寄り)
  const topScale = 2;
  const topCols = Math.floor(80.0 / topScale);
  const levelText = `LEVEL ${state.level}`;
  const packText = `PACK ${state.packsRemain}`;
  const missionText = `(${state.destroyedThisStage}/${state.targetBreaks})`;
  const scoreText = `SCORE ${state.score}`;
  const levelX = 0;
  const packX = levelText.length + 2;
  const scoreX = Math.max(0, topCols - scoreText.length - 1);
  const topY = 0;
  const missionIdealX = Math.max(0, Math.floor((topCols - missionText.length) * 0.5));
  const missionMinX = packX + packText.length + 2;
  const missionMaxX = scoreX - missionText.length - 2;
  const missionFitsTop = missionMaxX >= missionMinX;
  const missionX = missionFitsTop
    ? Math.max(missionMinX, Math.min(missionMaxX, missionIdealX))
    : Math.max(0, missionIdealX);
  const missionY = missionFitsTop ? topY : (topY + 1);

  drawEntries(msg, [
    {
      id: "cb-level",
      text: levelText,
      x: levelX,
      y: topY,
      color: [1.0, 0.90, 0.36]
    },
    {
      id: "cb-pack",
      text: packText,
      x: packX,
      y: topY,
      color: [0.56, 1.0, 0.64]
    },
    {
      id: "cb-mission",
      text: missionText,
      x: missionX,
      y: missionY,
      color: [0.62, 0.94, 1.0]
    },
    {
      id: "cb-score",
      text: scoreText,
      x: scoreX,
      y: topY,
      color: [0.92, 0.86, 1.0]
    }
  ], topScale);
  msg.shader.setScale(1.0);
  drawDebugLines(msg, debugLines);

  // ステージクリア直後は中央に大きいメッセージを重ね表示する
  if (state.stageClearBannerSec > 0.0) {
    const scale = 2;
    const text1 = "STAGE CLEAR!";
    const text2 = `NEXT LEVEL ${state.level}`;
    const x1 = Math.max(0, Math.floor((80.0 / scale - text1.length) * 0.5));
    const x2 = Math.max(0, Math.floor((80.0 / scale - text2.length) * 0.5));
    const y1 = Math.max(0, Math.floor((25.0 / scale) * 0.45));
    const y2 = y1 + 2;
    drawEntries(msg, [
      {
        id: "cb-stage-clear-title",
        text: text1,
        x: x1,
        y: y1,
        color: [1.0, 0.95, 0.45]
      },
      {
        id: "cb-stage-clear-next",
        text: text2,
        x: x2,
        y: y2,
        color: [0.84, 0.92, 1.0]
      }
    ], scale);
    msg.shader.setScale(1.0);
    drawDebugLines(msg, debugLines);
  }

  if (state.packEventBannerSec > 0.0 && !isResultPhase) {
    const scale = 2;
    const text = state.packEventText || "PACK";
    const x = Math.max(0, Math.floor((80.0 / scale - text.length) * 0.5));
    const y = Math.max(0, Math.floor((25.0 / scale) * 0.60));
    drawEntries(msg, [
      {
        id: "cb-pack-event",
        text,
        x,
        y,
        color: [0.60, 1.0, 0.66]
      }
    ], scale);
    msg.shader.setScale(1.0);
    drawDebugLines(msg, debugLines);
  }

  if (isResultPhase) {
    const scale = 2;
    const cols = Math.floor(80.0 / scale);
    const rows = Math.floor(25.0 / scale);
    const text1 = state.gameOverText || "GAME OVER";
    const text2 = `FINAL SCORE ${state.score}`;
    const x1 = Math.max(0, Math.floor((cols - text1.length) * 0.5));
    const x2 = Math.max(0, Math.floor((cols - text2.length) * 0.5));
    const y1 = 1;
    // ハイスコア上位5件を scale=2 に統一して視認性を上げる
    const title = "HIGHSCORES TOP 5";
    const tx = Math.max(0, Math.floor((cols - title.length) * 0.5));
    const titleY = 5;
    const hs = Array.isArray(state.highScores) ? state.highScores : [];
    const scoreEntries = [
      {
        id: "cb-game-over-title",
        text: text1,
        x: x1,
        y: y1,
        color: [1.0, 0.42, 0.42]
      },
      {
        id: "cb-game-over-score",
        text: text2,
        x: x2,
        y: y1 + 2,
        color: [1.0, 0.94, 0.64]
      },
      {
        id: "cb-game-over-rank-title",
        text: title,
        x: tx,
        y: titleY,
        color: [0.86, 0.95, 1.0]
      }
    ];
    for (let i = 0; i < 5; i++) {
      const rec = hs[i];
      const line = rec
        ? `${i + 1}. ${String(rec.score).padStart(7, " ")}`
        : `${i + 1}. -------`;
      const lx = Math.max(0, Math.floor((cols - line.length) * 0.5));
      scoreEntries.push({
        id: `cb-game-over-rank-${i}`,
        text: line,
        x: lx,
        y: titleY + 1 + i,
        color: [0.92, 0.90, 0.98]
      });
    }
    // 静止画面に見えないよう、終了画面では点滅ガイドを表示する
    // これにより requestAnimationFrame が継続していることを視認できる
    const blinkOn = (Math.floor(performance.now() / 350.0) % 2) === 0;
    if (blinkOn) {
      const guide = "PRESS R TO RESTART";
      const gx = Math.max(0, Math.floor((cols - guide.length) * 0.5));
      const gy = Math.max(titleY + 6, rows - 1);
      scoreEntries.push({
        id: "cb-game-over-guide",
        text: guide,
        x: gx,
        y: gy,
        color: [0.68, 0.96, 0.74]
      });
    }
    drawEntries(msg, scoreEntries, scale);
    msg.shader.setScale(1.0);
    drawDebugLines(msg, debugLines);
    return;
  }

  if (state.stageClearBannerSec <= 0.0 && state.stageIntroSec > 0.0) {
    const scale = 2;
    const text1 = state.stageIntroNeedsInput
      ? "PRESS ANY KEY TO START"
      : `NEXT STAGE IN ${state.stageIntroSec.toFixed(1)}s`;
    const text2 = state.stageIntroNeedsInput ? "READY?" : "OR PRESS ANY KEY";
    const x1 = Math.max(0, Math.floor((80.0 / scale - text1.length) * 0.5));
    const x2 = Math.max(0, Math.floor((80.0 / scale - text2.length) * 0.5));
    const y1 = 2;
    const y2 = y1 + 1;
    const g1 = "MOVE: <-- / -->";
    const g2 = "ROTATE: A / D";
    const g3 = "RESET: R   PAUSE: K   END: O   SHOT: P";
    const g4 = "DIAG: Q/W probe  C/V copy  J/L log";
    const g5 = "SAVE: F/G  MODE: M";
    const gx1 = Math.max(0, Math.floor((80.0 / scale - g1.length) * 0.5));
    const gx2 = Math.max(0, Math.floor((80.0 / scale - g2.length) * 0.5));
    const gx3 = Math.max(0, Math.floor((80.0 / scale - g3.length) * 0.5));
    const gx4 = Math.max(0, Math.floor((80.0 / scale - g4.length) * 0.5));
    const gx5 = Math.max(0, Math.floor((80.0 / scale - g5.length) * 0.5));
    drawEntries(msg, [
      {
        id: "cb-stage-intro-title",
        text: text1,
        x: x1,
        y: y1,
        color: [0.9, 0.96, 1.0]
      },
      {
        id: "cb-stage-intro-subtitle",
        text: text2,
        x: x2,
        y: y2,
        color: [0.86, 0.90, 0.98]
      },
      {
        id: "cb-stage-intro-move",
        text: g1,
        x: gx1,
        y: y2 + 2,
        color: [0.46, 0.95, 0.52]
      },
      {
        id: "cb-stage-intro-rotate",
        text: g2,
        x: gx2,
        y: y2 + 3,
        color: [0.46, 0.95, 0.52]
      },
      {
        id: "cb-stage-intro-reset",
        text: g3,
        x: gx3,
        y: y2 + 4,
        color: [0.46, 0.95, 0.52]
      },
      {
        id: "cb-stage-intro-diag",
        text: g4,
        x: gx4,
        y: y2 + 5,
        color: [0.46, 0.95, 0.52]
      },
      {
        id: "cb-stage-intro-save",
        text: g5,
        x: gx5,
        y: y2 + 6,
        color: [0.46, 0.95, 0.52]
      }
    ], scale);
    msg.shader.setScale(1.0);
    drawDebugLines(msg, debugLines);
  }
};
