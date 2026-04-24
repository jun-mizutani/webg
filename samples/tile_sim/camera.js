// -------------------------------------------------
// tile_sim sample
//   camera.js     2026/04/24
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// -------------------------------------------------

import { CELL_SIZE, DISPLAY_AREA_SCROLL_DURATION_MS } from "./constants.js";

// この module は、tile_sim の camera と pointer picking の helper をまとめる
// - displayArea 中心の camera target 同期、mouse 位置からの ray 作成をここで扱う
// - 視点制御まわりを mission や controller から切り離し、責務を見やすくする

// canvas 上の CSS 座標を NDC へ変換する
// - pointer 位置から ray を作る前段として、screen 上の位置を clip space 基準へそろえる
export const cssToNdc = (canvas, clientX, clientY) => {
  const rect = canvas.getBoundingClientRect();
  const x = ((clientX - rect.left) / rect.width) * 2.0 - 1.0;
  const y = 1.0 - ((clientY - rect.top) / rect.height) * 2.0;
  return [x, y];
};

// pointer 位置から world ray を作る
// - click selection では TileMap.pickCell() が origin / dir を受け取るため、
//   canvas 座標から ray を作る処理を sample 側 helper にまとめる
export const makeRayFromMouse = (canvas, clientX, clientY, eyeNode, proj, view) => {
  const [nx, ny] = cssToNdc(canvas, clientX, clientY);
  const invVp = proj.clone();
  invVp.mul(view);
  invVp.inverse_strict();

  const near = invVp.mulVector([nx, ny, -1.0]);
  const far = invVp.mulVector([nx, ny, 1.0]);
  const eyePos = eyeNode.getWorldPosition();
  const dir = [
    far[0] - eyePos[0],
    far[1] - eyePos[1],
    far[2] - eyePos[2]
  ];

  return {
    origin: eyePos,
    dir,
    near,
    far,
    ndc: [nx, ny]
  };
};

// vec3 が完全に同じ値かどうかを調べる
// - displayArea scroll の camera tween を無駄に作り直さないために使う
export const sameVec3 = (left, right) => {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length < 3 || right.length < 3) {
    return false;
  }
  return left[0] === right[0] && left[1] === right[1] && left[2] === right[2];
};

// displayArea の中心を camera target 用の world 座標へ変換する
// - TileMap は col / row の矩形を返すので、camera が見るべき中心点は sample 側で計算する
export const getDisplayAreaCenter = (displayArea) => {
  return [
    (displayArea.minCol + displayArea.maxCol + 1) * 0.5 * CELL_SIZE,
    0.0,
    (displayArea.minRow + displayArea.maxRow + 1) * 0.5 * CELL_SIZE
  ];
};

// WebgApp 標準 orbit と app.camera の両方へ target を反映する
// - createOrbitEyeRig() 使用時は EyeRig 側が source of truth になるため、
//   displayArea 追従の tween も EyeRig.setTarget() を通して更新する
// - 標準 orbit を使わない最小構成でも app.camera.target だけは更新できるようにする
const setCameraTarget = (app, target) => {
  if (!Array.isArray(target) || target.length < 3) {
    throw new Error("tile_sim camera target must be a 3D vector");
  }
  if (target.some((value) => !Number.isFinite(value))) {
    throw new Error("tile_sim camera target values must be finite");
  }
  if (app?.eyeRig?.setTarget) {
    app.eyeRig.setTarget(target[0], target[1], target[2]);
    app.syncCameraFromEyeRig?.(app.eyeRig);
    return;
  }
  if (Array.isArray(app?.camera?.target) && app.camera.target.length >= 3) {
    app.camera.target[0] = target[0];
    app.camera.target[1] = target[1];
    app.camera.target[2] = target[2];
    app.cameraRig?.setPosition?.(target[0], target[1], target[2]);
  }
};

// ballCell に追従して displayArea と camera target を同期する helper を作る
// - followCell() の結果をそのまま使い、表示窓の中心へ camera target を寄せる
// - animate=true のときだけ tween を作り、scroll 中の見え方を滑らかにする
export const createDisplayAreaSync = (tileMap, app) => {
  let cameraTargetTween = null;
  let cameraTarget = null;

  return (ballCell, animate = false) => {
    const displayArea = tileMap.followCell(ballCell);
    const center = getDisplayAreaCenter(displayArea);
    const target = [center[0], 0.0, center[2]];
    if (!animate) {
      cameraTargetTween = null;
      cameraTarget = [...target];
      setCameraTarget(app, target);
      return displayArea;
    }
    const current = app.camera?.target ?? null;
    if (sameVec3(current, target)) {
      cameraTargetTween = null;
      cameraTarget = [...target];
      return displayArea;
    }
    const tweenStillActive = Array.isArray(app.tweens) && app.tweens.includes(cameraTargetTween);
    if (cameraTargetTween && !cameraTargetTween.isFinished() && tweenStillActive && sameVec3(cameraTarget, target)) {
      return displayArea;
    }
    cameraTarget = [...target];
    const tweenState = {
      x: app.camera.target[0],
      y: app.camera.target[1],
      z: app.camera.target[2]
    };
    cameraTargetTween = app.createTween(tweenState, {
      x: target[0],
      y: target[1],
      z: target[2]
    }, {
      durationMs: DISPLAY_AREA_SCROLL_DURATION_MS,
      easing: "outCubic",
      // displayArea の tween は camera target だけを更新し、
      // ball や marker の tween を app.clearTweens() で巻き込まないように分離する
      onUpdate: (state, progress, tweenRef) => {
        if (cameraTargetTween !== tweenRef) {
          return;
        }
        setCameraTarget(app, [state.x, state.y, state.z]);
      },
      onComplete: (state, tweenRef) => {
        if (cameraTargetTween !== tweenRef) {
          return;
        }
        setCameraTarget(app, target);
        cameraTargetTween = null;
      }
    });
    return displayArea;
  };
};
