// -------------------------------------------------
// tile_sim sample
//   controller.js 2026/03/28
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// -------------------------------------------------

import {
  BALL_BOUNCE_HEIGHT,
  BALL_LIFT,
  BALL_MOVE_DURATION_MS,
  BALL_RADIUS
} from "./constants.js";
import { createDisplayAreaSync } from "./camera.js";

// この module は、ball の論理位置と見た目の同期を受け持つ controller を提供する
// - selection、displayArea 追従、ball tween、marker 回転をまとめて管理する
// - mission 判定そのものは持たず、移動の開始 / 完了 hook だけを外へ渡す形にしている

// ball の移動 tween 中に加える hop 高さを返す
// - 直線移動だけだと盤面の凹凸を跨ぐ感じが弱いため、進行率から一時的な上方向 offset を作る
export const getBallBounceOffset = (progress) => {
  const t = Math.max(0.0, Math.min(1.0, Number(progress ?? 0.0)));
  return Math.sin(t * Math.PI) * BALL_BOUNCE_HEIGHT;
};

// ball が現在立っている cell を「上面が選択中」の形へ変換する
// - `refreshTileColors()` は hit 情報を受けるため、ball の現在位置も pick と同じ形式で扱う
export const makeTopSelection = (cell) => {
  if (!cell) {
    return null;
  }
  return {
    cell,
    hitFace: "top",
    hitHeight: cell.topY,
    point: [cell.center[0], cell.topY, cell.center[2]]
  };
};

// ball の論理位置、selection、displayArea 追従をまとめて扱う controller を作る
// - play 中の移動ルールは TileMap に任せつつ、sample 固有の tween と HUD 更新だけをここで束ねる
export const createTileMapController = (tileMap, app, ballNode, ballMarkerNode, initialCell = null, hooks = {}) => {
  let ballCell = initialCell ?? tileMap.getCell(3, 3);
  let selected = makeTopSelection(ballCell);
  let ballMoveTween = null;
  let queuedMove = null;
  const syncDisplayArea = createDisplayAreaSync(tileMap, app);

  // 選択状態込みで TileMap の表示色を更新する
  // - controller 内では selection を直接持つため、更新入口を 1 つにまとめる
  const refreshTileColors = () => {
    tileMap.refreshTileColors(selected);
  };

  // ball の論理位置、表示位置、selection をまとめて同期する
  // - title 復帰や retry 時は、ここを通して ball と displayArea を同時に初期位置へ戻す
  const syncBallPlacement = (cell, animateDisplayArea = false) => {
    ballCell = cell;
    selected = makeTopSelection(ballCell);
    queuedMove = null;
    syncDisplayArea(ballCell, animateDisplayArea);
    tileMap.placeNodeOnCell(ballNode, ballCell, BALL_LIFT, BALL_RADIUS);
    refreshTileColors();
  };

  // ball が向かう先へ displayArea を先に動かす
  // - 移動完了を待たずに視界を進め、map がスクロールしながら ball が動く見え方を作る
  const startDisplayAreaScroll = (cell, animate = true) => {
    syncDisplayArea(cell, animate);
    refreshTileColors();
  };

  // click で触った cell / wall を selection として反映する
  // - click は調査用であり、ball の論理位置までは変えない
  const applySelection = (hit) => {
    selected = hit;
    refreshTileColors();
  };

  // ball の移動中に来た次の方向入力を 1 件だけ保留する
  // - 連打や key repeat を完全に捨てると、1 手ごとに入力が切れたように感じやすいため、
  //   最後に押された方向だけを次の移動候補として残す
  const queueMove = (dx, dy) => {
    queuedMove = { dx, dy };
  };

  // 直前の移動で保留していた方向入力を消化する
  // - result へ入ったあとまで自動で移動が続くと分かりにくいため、play 中だけ実行する
  const flushQueuedMove = () => {
    if (!queuedMove) {
      return false;
    }
    if ((app.getScenePhase?.() ?? "title") !== "play") {
      queuedMove = null;
      return false;
    }
    const nextMove = queuedMove;
    queuedMove = null;
    return moveBall(nextMove.dx, nextMove.dy);
  };

  // 方向入力を隣接 cell への移動要求へ変換する
  // - 範囲外や height 差が大きい移動は、Tween を作る前にここで弾く
  const moveBall = (dx, dy) => {
    if (!ballCell) {
      return false;
    }
    if (ballMoveTween && !ballMoveTween.isFinished()) {
      queueMove(dx, dy);
      return true;
    }
    const nextCell = tileMap.getCell(ballCell.col + dx, ballCell.row + dy);
    if (!nextCell) {
      selected = makeTopSelection(ballCell);
      refreshTileColors();
      return false;
    }
    if (!tileMap.canMove(ballCell, nextCell)) {
      selected = makeTopSelection(ballCell);
      refreshTileColors();
      return false;
    }
    return startBallMove(nextCell);
  };

  // 1 回の移動要求を ball の tween と mission hook へ変換する
  // - moveBall() が通した nextCell だけを受け取り、見た目と mission 進行を同時に進める
  const startBallMove = (nextCell) => {
    if (ballMoveTween && !ballMoveTween.isFinished()) {
      return false;
    }
    const previousCell = ballCell;
    const targetPosition = tileMap.getNodePositionOnCell(nextCell, BALL_LIFT, BALL_RADIUS);
    if (!targetPosition) {
      return false;
    }

    startDisplayAreaScroll(nextCell, true);
    if (typeof hooks.onMoveStart === "function") {
      hooks.onMoveStart({
        fromCell: previousCell,
        toCell: nextCell
      });
    }
    ballMoveTween = ballNode.animatePosition(targetPosition, {
      durationMs: BALL_MOVE_DURATION_MS,
      easing: "outCubic",
      onUpdate: (target, progress) => {
        target[1] += getBallBounceOffset(progress);
      },
      onComplete: () => {
        ballMoveTween = null;
        ballCell = nextCell;
        selected = makeTopSelection(ballCell);
        refreshTileColors();
        if (typeof hooks.onMoveComplete === "function") {
          hooks.onMoveComplete({
            fromCell: previousCell,
            toCell: nextCell
          });
        }
        flushQueuedMove();
      }
    });
    if (!ballMoveTween) {
      return false;
    }

    // 旧 sample 由来の marker を持つ場合だけ回転補間を続ける
    // - tile_sim では marker 非表示の proxy ball 構成へ寄せたため、null を許可しておく
    if (ballMarkerNode?.animateRotation) {
      ballMarkerNode.animateRotation([90.0, 0.0, 0.0], {
        durationMs: BALL_MOVE_DURATION_MS,
        easing: "linear",
        relative: true
      });
    }

    return true;
  };

  return {
    get ballCell() {
      return ballCell;
    },
    get selected() {
      return selected;
    },
    syncBallPlacement,
    applySelection,
    moveBall,
    setBallCell(cell, animateDisplayArea = false) {
      syncBallPlacement(cell, animateDisplayArea);
    },
    syncDisplayArea: (animate = false) => syncDisplayArea(ballCell, animate),
    isBallMoving: () => !!ballMoveTween && !ballMoveTween.isFinished()
  };
};
