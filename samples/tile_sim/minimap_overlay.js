// -------------------------------------------------
// tile_sim sample
//   minimap_overlay.js 2026/03/30
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// -------------------------------------------------

// この module は、tile_sim 用の小さい 2D tactical map overlay を担当する
// - 3D の TileMap を見失わないよう、盤面全体を俯瞰する小さい DOM canvas を追加する
// - Alpha / Bravo / Mule / Warden / beacon / goal / selection を同じ 2D 上で確認できるようにする
// - DialogueOverlay とは別レイヤーで右下寄りへ固定し、scene の中央を大きく隠さないことを優先する

const STYLE_ID = "tile-sim-minimap-style";
const CANVAS_SIZE_PX = 164;
const PANEL_BOTTOM_PX = 108;
const PANEL_RIGHT_PX = 12;
const PANEL_PADDING_PX = 10;
const PANEL_WIDTH_PX = 196;
const PANEL_Z_INDEX = 836;

// タイル高さを minimap 上の色帯へ変換する
// - 3D 側の blue / green / orange / white の傾向を保ちつつ、2D では少し暗めに寄せて marker を見やすくする
const getHeightColor = (height) => {
  const safeHeight = Number.isFinite(height) ? Number(height) : 0;
  if (safeHeight <= 0) {
    return "#365f9a";
  }
  if (safeHeight <= 2) {
    return "#4d7a47";
  }
  if (safeHeight <= 4) {
    return "#98632f";
  }
  return "#d4d9e4";
};

// minimap panel 用の CSS を 1 回だけ注入する
// - sample 専用 style をこの module に閉じ込め、他 sample の overlay へ影響を広げないようにする
const ensureStyle = (doc) => {
  if (!doc || doc.getElementById(STYLE_ID)) {
    return;
  }
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.tile-sim-minimap-root {
  position: fixed;
  right: calc(${PANEL_RIGHT_PX}px + var(--webg-canvas-right-inset, 0px));
  bottom: ${PANEL_BOTTOM_PX}px;
  width: ${PANEL_WIDTH_PX}px;
  padding: ${PANEL_PADDING_PX}px;
  box-sizing: border-box;
  border-radius: 14px;
  border: 1px solid rgba(202, 220, 255, 0.24);
  background: rgba(12, 20, 14, 0.58);
  box-shadow: 0 12px 24px rgba(0, 0, 0, 0.22);
  backdrop-filter: blur(2px);
  color: #ffffff;
  pointer-events: none;
  z-index: ${PANEL_Z_INDEX};
}

.tile-sim-minimap-title {
  margin: 0 0 6px 0;
  font: 700 11px/1.25 "Avenir Next", "Hiragino Sans", "Yu Gothic", sans-serif;
  letter-spacing: 0.05em;
}

.tile-sim-minimap-canvas {
  display: block;
  width: ${CANVAS_SIZE_PX}px;
  height: ${CANVAS_SIZE_PX}px;
  border-radius: 10px;
  border: 1px solid rgba(210, 224, 255, 0.18);
  background: rgba(10, 16, 10, 0.54);
}

.tile-sim-minimap-legend {
  margin-top: 6px;
  font: 600 10px/1.4 "Avenir Next", "Hiragino Sans", "Yu Gothic", sans-serif;
  color: rgba(255, 255, 255, 0.92);
}
`;
  doc.head.appendChild(style);
};

// canvas の実ピクセル倍率を devicePixelRatio へ合わせる
// - minimap が小さいため、ぼやけやすい canvas は高 DPI で描いて輪郭を保つ
const resizeCanvasForDpr = (canvas, logicalWidth, logicalHeight) => {
  const dprSource = typeof window !== "undefined" ? (window.devicePixelRatio ?? 1) : 1;
  const dpr = Math.max(1, Math.floor(dprSource * 100) / 100);
  const widthPx = Math.max(1, Math.round(logicalWidth * dpr));
  const heightPx = Math.max(1, Math.round(logicalHeight * dpr));
  if (canvas.width !== widthPx || canvas.height !== heightPx) {
    canvas.width = widthPx;
    canvas.height = heightPx;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
};

// minimap 上の cell 原点と cell サイズを map 寸法から求める
// - 12x12 固定でも helper にしておき、今後 map が変わっても同じ計算を再利用できるようにする
const getBoardMetrics = (tileMap) => {
  const cols = Math.max(1, Number(tileMap?.width ?? 1));
  const rows = Math.max(1, Number(tileMap?.height ?? 1));
  const boardSide = CANVAS_SIZE_PX - 16;
  const cellSize = Math.max(6, Math.floor(boardSide / Math.max(cols, rows)));
  const boardWidth = cellSize * cols;
  const boardHeight = cellSize * rows;
  const offsetX = Math.floor((CANVAS_SIZE_PX - boardWidth) * 0.5);
  const offsetY = Math.floor((CANVAS_SIZE_PX - boardHeight) * 0.5);
  return {
    cols,
    rows,
    cellSize,
    boardWidth,
    boardHeight,
    offsetX,
    offsetY
  };
};

// 指定 cell を minimap 上の描画矩形へ変換する
// - row / col の整数 grid をそのまま 2D canvas の矩形へ写し取る
const getCellRect = (metrics, cell) => {
  return {
    x: metrics.offsetX + cell.col * metrics.cellSize,
    y: metrics.offsetY + cell.row * metrics.cellSize,
    size: metrics.cellSize
  };
};

// beacon を小さい diamond として描く
// - unit marker より小さくして、目的地が重なっても主役 unit を見失いにくくする
const drawBeaconMarker = (ctx, x, y, size, color) => {
  const half = size * 0.5;
  ctx.beginPath();
  ctx.moveTo(x, y - half);
  ctx.lineTo(x + half, y);
  ctx.lineTo(x, y + half);
  ctx.lineTo(x - half, y);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
};

// unit 種別に応じた小さい marker を描く
// - Alpha と Bravo は球体イメージに合わせて circle、Mule と Warden は角柱イメージに合わせて square にする
const drawUnitMarker = (ctx, kind, x, y, radius, fillColor, strokeColor = null) => {
  if (kind === "square") {
    const side = radius * 1.8;
    ctx.beginPath();
    ctx.rect(x - side * 0.5, y - side * 0.5, side, side);
    ctx.fillStyle = fillColor;
    ctx.fill();
    if (strokeColor) {
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = strokeColor;
      ctx.stroke();
    }
    return;
  }
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = fillColor;
  ctx.fill();
  if (strokeColor) {
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = strokeColor;
    ctx.stroke();
  }
};

// tile_sim 用 minimap overlay を作る
// - 盤面全体の terrain、高さ帯、objective、各 unit の位置を小さい panel で追えるようにする
// - update() を main loop から毎 frame 呼び、phase や unit 状態の変化へ追従する
export const createTileSimMinimapOverlay = ({
  document,
  tileMap,
  getMission,
  getAlphaUnit,
  getSupportUnits,
  getEnemyUnits,
  getSelectedCell,
  getScenePhase,
  getDialogueState
} = {}) => {
  if (!document || !document.body || !tileMap) {
    return {
      update() {}
    };
  }

  ensureStyle(document);

  const root = document.createElement("section");
  root.className = "tile-sim-minimap-root";

  const title = document.createElement("div");
  title.className = "tile-sim-minimap-title";
  title.textContent = "TACTICAL MAP";
  root.appendChild(title);

  const canvas = document.createElement("canvas");
  canvas.className = "tile-sim-minimap-canvas";
  root.appendChild(canvas);

  const legend = document.createElement("div");
  legend.className = "tile-sim-minimap-legend";
  legend.textContent = "A Alpha  B Bravo  M Mule  W Warden  <> Beacon  [] Goal";
  root.appendChild(legend);

  document.body.appendChild(root);

  // 現在の mission と unit 群を minimap canvas へ描く
  // - 盤面全体を毎 frame 描き直しても 12x12 と小さいため、差分管理よりも処理意図の分かりやすさを優先する
  const update = () => {
    const ctx = resizeCanvasForDpr(canvas, CANVAS_SIZE_PX, CANVAS_SIZE_PX);
    if (!ctx) {
      return;
    }
    const mission = typeof getMission === "function" ? getMission() : null;
    const alphaUnit = typeof getAlphaUnit === "function" ? getAlphaUnit() : null;
    const supportUnits = typeof getSupportUnits === "function" ? getSupportUnits() : [];
    const enemyUnits = typeof getEnemyUnits === "function" ? getEnemyUnits() : [];
    const selectedCell = typeof getSelectedCell === "function" ? getSelectedCell() : null;
    const phase = typeof getScenePhase === "function" ? getScenePhase() : "play";
    const dialogueActive = typeof getDialogueState === "function"
      ? getDialogueState()?.active === true
      : false;

    const metrics = getBoardMetrics(tileMap);
    ctx.clearRect(0, 0, CANVAS_SIZE_PX, CANVAS_SIZE_PX);
    ctx.fillStyle = "rgba(6, 10, 18, 0.72)";
    ctx.fillRect(0, 0, CANVAS_SIZE_PX, CANVAS_SIZE_PX);

    for (let row = 0; row < metrics.rows; row++) {
      for (let col = 0; col < metrics.cols; col++) {
        const cell = tileMap.getCell(col, row);
        if (!cell) {
          continue;
        }
        const rect = getCellRect(metrics, cell);
        ctx.fillStyle = getHeightColor(cell.height);
        ctx.fillRect(rect.x, rect.y, rect.size, rect.size);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.10)";
        ctx.lineWidth = 1;
        ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.size - 1, rect.size - 1);
      }
    }

    if (selectedCell) {
      const rect = getCellRect(metrics, selectedCell);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.strokeRect(rect.x + 1, rect.y + 1, rect.size - 2, rect.size - 2);
    }

    const visibleBeacons = Array.isArray(mission?.beacons)
      ? mission.beacons.filter((beacon) => beacon && beacon.collected !== true)
      : [];
    for (let i = 0; i < visibleBeacons.length; i++) {
      const beacon = visibleBeacons[i];
      const rect = getCellRect(metrics, beacon.cell);
      const cx = rect.x + rect.size * 0.5;
      const cy = rect.y + rect.size * 0.5;
      drawBeaconMarker(ctx, cx, cy, Math.max(4, rect.size * 0.56), i === 0 ? "#52e8ff" : "#ff76ce");
    }

    if (mission?.goalCell) {
      const rect = getCellRect(metrics, mission.goalCell);
      ctx.lineWidth = 2;
      ctx.strokeStyle = mission.goalUnlocked ? "#ffd45b" : "#8f99aa";
      ctx.strokeRect(rect.x + 2, rect.y + 2, rect.size - 4, rect.size - 4);
    }

    const drawUnitOnCell = (cell, kind, fillColor, strokeColor = null) => {
      if (!cell) {
        return;
      }
      const rect = getCellRect(metrics, cell);
      const cx = rect.x + rect.size * 0.5;
      const cy = rect.y + rect.size * 0.5;
      drawUnitMarker(ctx, kind, cx, cy, Math.max(3, rect.size * 0.26), fillColor, strokeColor);
    };

    drawUnitOnCell(alphaUnit?.cell, "circle", "#ffb2b7", "#ffe36e");
    const bravo = Array.isArray(supportUnits) ? supportUnits.find((unit) => unit.id === "bravo") : null;
    const mule = Array.isArray(supportUnits) ? supportUnits.find((unit) => unit.id === "mule") : null;
    const warden = Array.isArray(enemyUnits) ? enemyUnits[0] ?? null : null;
    drawUnitOnCell(bravo?.cell, "circle", "#79ebff", "#d6fbff");
    drawUnitOnCell(mule?.cell, "square", "#8eff77", "#e7ffe0");
    drawUnitOnCell(warden?.cell, "square", "#ff746a", "#ffd5d2");

    title.textContent = [
      "TACTICAL MAP",
      phase ? ` ${String(phase).toUpperCase()}` : "",
      Number.isFinite(mission?.turnCount) ? `  T${mission.turnCount}` : ""
    ].join("").trim();
    root.style.opacity = dialogueActive ? "0.86" : "1.0";
  };

  return {
    update
  };
};
