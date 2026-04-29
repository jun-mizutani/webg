// ---------------------------------------------
// samples/tile_sim/mission.js  2026/04/10
//   tile_sim sample
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";
import {
  BEACON_COUNT,
  MARKER_BASE_Y,
  MARKER_HEAD_OFFSET_Y,
  MARKER_HEAD_SIZE,
  MARKER_SPIN_DEG_PER_SEC,
  MARKER_STEM_HEIGHT,
  MARKER_STEM_WIDTH,
  MOVE_BUDGET_PADDING,
  MOVE_BUDGET_RATIO
} from "./constants.js";

// この module は、tile_sim の baseline mission ルールと marker 表示をまとめる
// - start / beacon / goal の計画、marker 生成、到着時の判定、HUD 文言生成をここへ集める
// - まずは tile_game と同じ基礎ルールを保持し、あとから strategy / simulation 系の要素を足しやすくする
const sharedObjectiveMarkerResourceCache = new WeakMap();

// 指定 cell から歩ける隣接 cell 数を数える
// - start / beacon / goal 候補は行き止まりすぎない場所を選びたいため、この指標を使う
export const getWalkableNeighborCount = (tileMap, cell) => {
  if (!cell) {
    return 0;
  }
  const neighbors = [
    tileMap.getCell(cell.col + 1, cell.row),
    tileMap.getCell(cell.col - 1, cell.row),
    tileMap.getCell(cell.col, cell.row + 1),
    tileMap.getCell(cell.col, cell.row - 1)
  ];
  let count = 0;
  for (let i = 0; i < neighbors.length; i++) {
    const next = neighbors[i];
    if (next && tileMap.canMove(cell, next)) {
      count += 1;
    }
  }
  return count;
};

// cell 間の move 数を cache 付きで返す helper を作る
// - mission 生成中は同じ経路長を何度も引くため、TileMap.findPath() の結果を sample 側で再利用する
export const createPathMoveCounter = (tileMap) => {
  const cache = new Map();
  return (fromCell, toCell) => {
    if (!fromCell || !toCell) {
      return Number.POSITIVE_INFINITY;
    }
    const key = `${fromCell.col},${fromCell.row}->${toCell.col},${toCell.row}`;
    if (cache.has(key)) {
      return cache.get(key);
    }
    const path = tileMap.findPath(fromCell, toCell);
    const moves = Array.isArray(path) ? Math.max(0, path.length - 1) : Number.POSITIVE_INFINITY;
    cache.set(key, moves);
    return moves;
  };
};

// start -> beacon 群 -> goal の必要最小 move 数を見積もる
// - beacon の取得順は複数あり得るため、小さい件数に限って順列を試して最短手数を求める
export const getMinimumMissionMoves = (getPathMoves, startCell, beaconCells, goalCell) => {
  if (!goalCell) {
    return Number.POSITIVE_INFINITY;
  }
  if (!Array.isArray(beaconCells) || beaconCells.length === 0) {
    return getPathMoves(startCell, goalCell);
  }

  let best = Number.POSITIVE_INFINITY;
  const used = new Array(beaconCells.length).fill(false);

  // 現在位置から未取得 beacon を 1 つずつ試し、最短合計 move 数を更新する
  const search = (currentCell, movesSoFar, collectedCount) => {
    if (movesSoFar >= best) {
      return;
    }
    if (collectedCount >= beaconCells.length) {
      const tailMoves = getPathMoves(currentCell, goalCell);
      if (Number.isFinite(tailMoves)) {
        best = Math.min(best, movesSoFar + tailMoves);
      }
      return;
    }
    for (let i = 0; i < beaconCells.length; i++) {
      if (used[i]) {
        continue;
      }
      const nextCell = beaconCells[i];
      const nextMoves = getPathMoves(currentCell, nextCell);
      if (!Number.isFinite(nextMoves)) {
        continue;
      }
      used[i] = true;
      search(nextCell, movesSoFar + nextMoves, collectedCount + 1);
      used[i] = false;
    }
  };

  search(startCell, 0, 0);
  return best;
};

// 現在の map から mission 用の start / beacon / goal / move budget を決める
// - 一本道すぎない場所、十分に離れた場所を選び、何度遊んでも同じ mission に固定する
export const createMissionPlan = (tileMap, startCell) => {
  const getPathMoves = createPathMoveCounter(tileMap);
  const candidates = [];
  for (let i = 0; i < tileMap.cells.length; i++) {
    const cell = tileMap.cells[i];
    if (!cell) {
      continue;
    }
    if (cell.col === startCell.col && cell.row === startCell.row) {
      continue;
    }
    const walkableNeighborCount = getWalkableNeighborCount(tileMap, cell);
    if (walkableNeighborCount < 2) {
      continue;
    }
    const startMoves = getPathMoves(startCell, cell);
    if (!Number.isFinite(startMoves) || startMoves < 2) {
      continue;
    }
    candidates.push({
      cell,
      walkableNeighborCount,
      startMoves
    });
  }

  let goalCell = null;
  let bestGoalScore = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    const score = candidate.startMoves * 2.2 + candidate.walkableNeighborCount * 1.4 - candidate.cell.height * 0.15;
    if (score > bestGoalScore) {
      bestGoalScore = score;
      goalCell = candidate.cell;
    }
  }

  if (!goalCell) {
    goalCell = tileMap.getCell(Math.max(0, tileMap.width - 2), Math.max(0, tileMap.height - 2)) ?? startCell;
  }

  const beaconCells = [];
  const used = new Set([`${startCell.col},${startCell.row}`, `${goalCell.col},${goalCell.row}`]);
  for (let beaconIndex = 0; beaconIndex < BEACON_COUNT; beaconIndex++) {
    let bestBeacon = null;
    let bestBeaconScore = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      const key = `${candidate.cell.col},${candidate.cell.row}`;
      if (used.has(key)) {
        continue;
      }
      const goalMoves = getPathMoves(candidate.cell, goalCell);
      if (!Number.isFinite(goalMoves) || goalMoves < 2) {
        continue;
      }
      const spreadMoves = beaconCells.length === 0
        ? candidate.startMoves
        : Math.min(...beaconCells.map((cell) => getPathMoves(candidate.cell, cell)));
      const score = candidate.startMoves * 1.2 + goalMoves * 0.75 + spreadMoves * 1.65
        + candidate.walkableNeighborCount * 0.45 - candidate.cell.height * 0.10;
      if (score > bestBeaconScore) {
        bestBeaconScore = score;
        bestBeacon = candidate.cell;
      }
    }
    if (!bestBeacon) {
      break;
    }
    beaconCells.push(bestBeacon);
    used.add(`${bestBeacon.col},${bestBeacon.row}`);
  }

  const minimumMoves = getMinimumMissionMoves(getPathMoves, startCell, beaconCells, goalCell);
  const moveLimit = Number.isFinite(minimumMoves)
    ? minimumMoves + Math.max(MOVE_BUDGET_PADDING, Math.floor(minimumMoves * MOVE_BUDGET_RATIO))
    : 18;

  return {
    startCell,
    goalCell,
    beaconCells,
    minimumMoves,
    moveLimit
  };
};

// beacon / goal marker の root node を cell 上へ置く
// - marker 自体は複数 node で出来ているため、root の位置だけを更新して扱う
export const placeObjectiveMarker = (node, cell) => {
  if (!node || !cell) {
    return;
  }
  node.setPosition(cell.center[0], cell.topY + MARKER_BASE_Y, cell.center[2]);
};

const getSharedObjectiveMarkerResources = (app) => {
  let resources = sharedObjectiveMarkerResourceCache.get(app);
  if (resources) {
    return resources;
  }

  const gpu = app.getGL();
  const stemTemplate = new Shape(gpu);
  stemTemplate.applyPrimitiveAsset(
    Primitive.cuboid(
      MARKER_STEM_WIDTH,
      MARKER_STEM_HEIGHT,
      MARKER_STEM_WIDTH,
      stemTemplate.getPrimitiveOptions()
    )
  );
  stemTemplate.endShape();

  const headTemplate = new Shape(gpu);
  headTemplate.applyPrimitiveAsset(
    Primitive.cuboid(
      MARKER_HEAD_SIZE,
      MARKER_HEAD_SIZE,
      MARKER_HEAD_SIZE,
      headTemplate.getPrimitiveOptions()
    )
  );
  headTemplate.endShape();

  resources = {
    stemResource: stemTemplate.getResource(),
    headResource: headTemplate.getResource()
  };
  sharedObjectiveMarkerResourceCache.set(app, resources);
  return resources;
};

// 柱と head を持つ objective marker を作る
// - beacon / goal の両方で同じ構造を使い、色だけを変えて役割を分ける
export const createObjectiveMarker = (app, name, options = {}) => {
  const resources = getSharedObjectiveMarkerResources(app);
  const root = app.space.addNode(null, name);

  const stemNode = app.space.addNode(root, `${name}-stem`);
  stemNode.setPosition(0.0, MARKER_STEM_HEIGHT * 0.5, 0.0);
  const stemShape = stemNode.addShape(resources.stemResource);
  stemShape.setMaterial("smooth-shader", {
    has_bone: 0,
    use_texture: 0,
    color: [...(options.stemColor ?? [0.26, 0.32, 0.42, 1.0])],
    ambient: 0.28,
    specular: 0.52,
    power: 26.0
  });
  const headNode = app.space.addNode(root, `${name}-head`);
  headNode.setPosition(0.0, MARKER_HEAD_OFFSET_Y, 0.0);
  const headShape = headNode.addShape(resources.headResource);
  headShape.setMaterial("smooth-shader", {
    has_bone: 0,
    use_texture: 0,
    color: [...(options.headColor ?? [0.96, 0.86, 0.38, 1.0])],
    ambient: 0.42,
    specular: 0.88,
    power: 46.0
  });
  root.hide(true);

  return {
    root,
    headNode,
    stemShape,
    headShape,
    place(cell) {
      placeObjectiveMarker(root, cell);
      root.hide(false);
    },
    setVisible(visible) {
      root.hide(!visible);
    },
    setColors(stemColor, headColor) {
      stemShape.updateMaterial({
        color: [...stemColor]
      });
      headShape.updateMaterial({
        color: [...headColor]
      });
    },
    spin(deltaSec) {
      headNode.rotateY(MARKER_SPIN_DEG_PER_SEC * deltaSec);
    }
  };
};

// 開始地点に使う cell を map 全体から選ぶ
// - 中央付近で、歩ける方向が複数ある cell を優先し、最初の操作で詰まらないようにする
export const findStartCell = (tileMap) => {
  const centerCol = Math.floor(tileMap.width * 0.5);
  const centerRow = Math.floor(tileMap.height * 0.5);
  let bestCell = tileMap.getCell(centerCol, centerRow) ?? tileMap.getCell(0, 0);
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < tileMap.cells.length; i++) {
    const cell = tileMap.cells[i];
    if (!cell) {
      continue;
    }
    const walkableNeighborCount = getWalkableNeighborCount(tileMap, cell);
    if (walkableNeighborCount < 2) {
      continue;
    }
    const dist = Math.abs(cell.col - centerCol) + Math.abs(cell.row - centerRow);
    const score = walkableNeighborCount * 10.0 - dist - cell.height * 0.75;
    if (score > bestScore) {
      bestScore = score;
      bestCell = cell;
    }
  }

  return bestCell ?? tileMap.getCell(0, 0);
};

// mission 状態と marker 表示をまとめる runtime を作る
// - title / play / result の切り替えは main.js 側 helper が持ち、ここでは play 中の mission 進行だけを扱う
export const createTileMapMissionRuntime = (app, tileMap) => {
  let onResult = null;
  const beaconMarkers = Array.from({ length: BEACON_COUNT }, (_, index) => {
    return createObjectiveMarker(app, `beacon-${index}`, {
      stemColor: [0.22, 0.34, 0.46, 1.0],
      headColor: index === 0 ? [0.38, 0.96, 1.0, 1.0] : [0.98, 0.46, 0.82, 1.0]
    });
  });
  const goalMarker = createObjectiveMarker(app, "goal-marker", {
    stemColor: [0.34, 0.28, 0.18, 1.0],
    headColor: [0.48, 0.54, 0.64, 1.0]
  });

  const mission = {
    plan: null,
    beacons: [],
    goalCell: null,
    turnCount: 0,
    movesUsed: 0,
    movesLimit: 0,
    minimumMoves: 0,
    collectedCount: 0,
    goalUnlocked: false,
    resultKind: "title",
    resultMessage: "Click GO or press Enter / Space to start",
    turnSummary: ""
  };

  // goal の開閉状態に応じて marker 色を切り替える
  // - beacon 未回収時は閉じた見た目、全回収後は開いた見た目にする
  const updateGoalMarkerAppearance = () => {
    goalMarker.setColors(
      mission.goalUnlocked ? [0.52, 0.40, 0.12, 1.0] : [0.26, 0.30, 0.38, 1.0],
      mission.goalUnlocked ? [1.0, 0.82, 0.34, 1.0] : [0.48, 0.54, 0.64, 1.0]
    );
  };

  // mission 計画を作り直し、marker とカウンタを初期状態へ戻す
  // - title から play へ入る前や retry 時に毎回ここを通して同じ初期化順を保つ
  const resetMission = () => {
    mission.plan = createMissionPlan(tileMap, findStartCell(tileMap));
    mission.goalCell = mission.plan.goalCell;
    mission.turnCount = 0;
    mission.movesUsed = 0;
    mission.movesLimit = mission.plan.moveLimit;
    mission.minimumMoves = mission.plan.minimumMoves;
    mission.collectedCount = 0;
    mission.goalUnlocked = mission.plan.beaconCells.length === 0;
    mission.resultKind = "playing";
    mission.resultMessage = "";
    mission.turnSummary = "";
    mission.beacons = mission.plan.beaconCells.map((cell, index) => ({
      cell,
      collected: false,
      marker: beaconMarkers[index]
    }));

    for (let i = 0; i < beaconMarkers.length; i++) {
      const beacon = mission.beacons[i];
      if (beacon) {
        beacon.marker.place(beacon.cell);
        beacon.marker.setVisible(true);
      } else {
        beaconMarkers[i].setVisible(false);
      }
    }

    goalMarker.place(mission.goalCell);
    updateGoalMarkerAppearance();
    goalMarker.setVisible(true);
  };

  // beacon / goal marker の回転演出を毎 frame 進める
  // - static な地形の中で目的地が埋もれないよう、head だけを回して目立たせる
  const updateMarkers = (deltaSec) => {
    for (let i = 0; i < mission.beacons.length; i++) {
      const beacon = mission.beacons[i];
      if (!beacon.collected) {
        beacon.marker.spin(deltaSec);
      }
    }
    goalMarker.spin(deltaSec);
  };

  // 現在 cell に未取得 beacon があるかを調べる
  // - 到着時の取得判定は毎回 beacon 配列を走査して、同じ cell かどうかで判断する
  const findBeaconOnCell = (cell) => {
    if (!cell) {
      return null;
    }
    for (let i = 0; i < mission.beacons.length; i++) {
      const beacon = mission.beacons[i];
      if (beacon.collected) {
        continue;
      }
      if (beacon.cell.col === cell.col && beacon.cell.row === cell.row) {
        return beacon;
      }
    }
    return null;
  };

  // 現在 cell が goal かどうかを調べる
  // - beacon 全取得後の到着判定だけで使う、小さい比較 helper
  const isGoalCell = (cell) => {
    return !!cell
      && !!mission.goalCell
      && mission.goalCell.col === cell.col
      && mission.goalCell.row === cell.row;
  };

  // 残り budget を 0 未満にならない形で返す
  // - 停止条件ではなく、guide / STATE / AI の比較用 budget として使う
  const getMovesLeft = () => Math.max(0, mission.movesLimit - mission.movesUsed);

  // 移動完了後に beacon 取得と goal 到達をまとめて判定する
  // - result 表示は HUD の guide / status が担当するため、ここでは mission 結果の確定だけを行う
  // - play 中の主要ルールはこの到着処理へ集約し、controller 側には持ち込まない
  const handleArrival = (cell) => {
    const beacon = findBeaconOnCell(cell);
    if (beacon) {
      beacon.collected = true;
      beacon.marker.setVisible(false);
      mission.collectedCount += 1;
      app.flashMessage(`BEACON ${mission.collectedCount}/${mission.beacons.length}`, {
        durationMs: 1200
      });
      if (mission.collectedCount >= mission.beacons.length) {
        mission.goalUnlocked = true;
        updateGoalMarkerAppearance();
        app.flashMessage("GOAL OPEN", {
          durationMs: 1400
        });
      }
    }

    if (mission.goalUnlocked && isGoalCell(cell)) {
      mission.resultKind = "clear";
      mission.resultMessage = `MISSION CLEAR  ${mission.movesUsed}/${mission.movesLimit} MOVES`;
      onResult?.(mission.resultKind, mission.resultMessage);
    }
  };

  // result 確定時の通知先を sample 側から差し替える
  // - mission runtime 自体は phase 切り替え方針を持たず、result の確定だけを外へ伝える
  const setResultHandler = (handler) => {
    onResult = typeof handler === "function" ? handler : null;
  };

  // Alpha の 1 手と支援部隊の追従が終わったあとに、turn 表示と summary を更新する
  // - 資源値の実体は main.js / support_units.js 側が持ち、ここでは HUD と result 文脈で読む summary だけを保持する
  const advanceTurn = ({ alphaUnit = null, supportUnits = [], enemyUnits = [] } = {}) => {
    mission.turnCount += 1;
    const alphaFood = Number.isFinite(alphaUnit?.food) ? alphaUnit.food : 0;
    const alphaArms = Number.isFinite(alphaUnit?.arms) ? alphaUnit.arms : 0;
    const supportLowFood = Array.isArray(supportUnits)
      ? supportUnits.filter((unit) => Number.isFinite(unit?.food) && unit.food <= 1)
      : [];
    const nearestEnemyDistance = Array.isArray(enemyUnits) && enemyUnits.length > 0
      ? Math.min(...enemyUnits.map((unit) => Number.isFinite(unit?.distanceToAlpha) ? unit.distanceToAlpha : Number.POSITIVE_INFINITY))
      : Number.POSITIVE_INFINITY;
    if (supportLowFood.length > 0) {
      mission.turnSummary = `TURN ${mission.turnCount}  LOW FOOD ${supportLowFood.map((unit) => unit.label).join("/")}`;
      app.flashMessage(mission.turnSummary, {
        durationMs: 900
      });
      return;
    }
    if (nearestEnemyDistance <= 1) {
      mission.turnSummary = `TURN ${mission.turnCount}  CONTACT WARDEN`;
      app.flashMessage(mission.turnSummary, {
        durationMs: 900
      });
      return;
    }
    if (nearestEnemyDistance <= 2) {
      mission.turnSummary = `TURN ${mission.turnCount}  THREAT RANGE ${nearestEnemyDistance}`;
      app.flashMessage(mission.turnSummary, {
        durationMs: 800
      });
      return;
    }
    mission.turnSummary = `TURN ${mission.turnCount}  ALPHA F${alphaFood} A${alphaArms}`;
  };

  return {
    mission,
    goalMarker,
    setResultHandler,
    resetMission,
    advanceTurn,
    updateMarkers,
    getMovesLeft,
    handleMoveStart: () => {
      mission.movesUsed += 1;
    },
    handleMoveComplete: ({ toCell }) => {
      handleArrival(toCell);
    }
  };
};

// phase ごとの guide text を組み立てる
// - title / play / result で役割が違うため、表示文言をここで切り替える
export const buildGuideLines = (phase, mission, dialogueState = null) => {
  if (dialogueState?.active) {
    return [];
  }
  if (phase === "title") {
    return [
      "TILE EXPEDITION",
      `Lead Alpha while Bravo and Mule react against the enemy Warden`,
      `Collect ${mission.beacons.length} beacon(s), then reach the goal`,
      `Shortest route hint: ${mission.minimumMoves} moves   Budget: ${mission.movesLimit}`,
      "Click GO or press Enter / Space to start"
    ];
  }
  if (phase === "result") {
    return [
      mission.resultKind === "clear" ? "MISSION CLEAR" : "MISSION FAILED",
      mission.resultMessage || "",
      `Collected ${mission.collectedCount}/${mission.beacons.length} beacon(s)`,
      "Click GO or press Enter / Space to retry"
    ].filter(Boolean);
  }
  const movesLeft = Math.max(0, (mission?.movesLimit ?? 0) - (mission?.movesUsed ?? 0));
  return [
    "Arrow / touch: move Alpha",
    "Bravo and Mule react after Alpha moves, then Warden answers",
    "Collect every beacon, then step onto the goal",
    "Click: inspect tile   1 / 2 / 3: orbit preset   R: reset camera",
    `Moves used: ${mission.movesUsed}/${mission.movesLimit}   Left: ${movesLeft}`
  ];
};

// top-left の status 行を組み立てる
// - phase、mission、現在選択中 cell、AI advisor の推奨を短い行で同時に読める形へそろえる
export const buildStatusLines = (phase, mission, controller, aiSnapshot = null, enemyUnits = [], dialogueState = null) => {
  const selected = controller.selected?.cell ?? null;
  if (dialogueState?.active) {
    return [];
  }
  const movesLeft = Math.max(0, (mission?.movesLimit ?? 0) - (mission?.movesUsed ?? 0));
  const startHint = phase === "title"
    ? "START GO / SPACE"
    : phase === "result"
      ? "RETRY GO / SPACE"
      : "MOVE ARROWS / TOUCH";
  const lines = [
    `PHASE ${phase.toUpperCase()}`,
    `TURN ${mission.turnCount}`,
    `DIALOGUE ${dialogueState?.active ? "ACTIVE" : "IDLE"}`,
    startHint,
    `BEACON ${mission.collectedCount}/${mission.beacons.length}`,
    `MOVES USED ${mission.movesUsed}/${mission.movesLimit}`,
    `LEFT ${movesLeft}`,
    `GOAL ${mission.goalUnlocked ? "OPEN" : "LOCKED"}`,
    selected
      ? `CELL (${selected.col},${selected.row}) H=${selected.height} ${selected.terrain.toUpperCase()}`
      : "CELL -"
  ];
  if (aiSnapshot) {
    const visibleUnits = Array.isArray(aiSnapshot.units) ? aiSnapshot.units.slice(0, 3) : [];
    for (let i = 0; i < visibleUnits.length; i++) {
      const unit = visibleUnits[i];
      lines.push(`${unit.label} F${unit.food} A${unit.arms}`);
    }
    lines.push(`AI ${aiSnapshot.policyLabel}`);
    const aiPlans = Array.isArray(aiSnapshot.units) ? aiSnapshot.units.slice(0, 2) : [];
    for (let i = 0; i < aiPlans.length; i++) {
      const unit = aiPlans[i];
      lines.push(`${unit.label} ${unit.actionSummary}`);
    }
  }
  const visibleEnemies = Array.isArray(enemyUnits) ? enemyUnits.slice(0, 1) : [];
  for (let i = 0; i < visibleEnemies.length; i++) {
    const unit = visibleEnemies[i];
    const distance = Number.isFinite(unit?.cell?.col) && controller.ballCell
      ? Math.abs(unit.cell.col - controller.ballCell.col) + Math.abs(unit.cell.row - controller.ballCell.row)
      : -1;
    lines.push(`ENEMY ${unit.label} F${unit.food} A${unit.arms} D${distance >= 0 ? distance : "-"}`);
    if (unit.lastDecision) {
      lines.push(`${unit.label} ${unit.lastDecision}`);
    }
  }
  if (mission.turnSummary) {
    lines.push(mission.turnSummary);
  }
  if (dialogueState?.lastChoiceLabel) {
    lines.push(`CHOICE ${dialogueState.lastChoiceLabel}`);
  }
  return lines;
};
