// ---------------------------------------------
// samples/tile_sim/enemy_units.js  2026/04/10
//   tile_sim sample
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";
import {
  BALL_LIFT,
  BALL_MOVE_DURATION_MS,
  BALL_RADIUS
} from "./constants.js";
import {
  createPathMoveCounter,
  getWalkableNeighborCount
} from "./mission.js";
import { createTileSimHumanActor } from "./alpha_actor.js";

const HUMAN_CELL_FORMATION_RATIO = 0.20;
const HUMAN_GROUP_BACK_RATIO = 0.04;
const sharedEnemyRigResourceCache = new WeakMap();

// この module は、tile_sim の敵側存在感を最小構成で作る監視部隊を扱う
// - まだ本格的な戦闘解決は入れず、goal 周辺や高地を守ろうとする相手側の圧力を盤面へ出す
// - Alpha の手番後に 1 step だけ反応し、味方支援部隊とは別の判断軸を sample 上で見せる

const ENEMY_SCOUT_CONFIG = {
  id: "warden",
  label: "WARDEN",
  role: "watch",
  baseFood: 4,
  baseArms: 5,
  radius: BALL_RADIUS * 0.84,
  color: [1.0, 0.44, 0.40, 1.0],
  markerColor: [0.42, 0.10, 0.10, 1.0],
  humanTint: [1.08, 0.62, 0.62, 1.0]
};

const getSharedEnemyRigCache = (app) => {
  let cache = sharedEnemyRigResourceCache.get(app);
  if (!cache) {
    cache = new Map();
    sharedEnemyRigResourceCache.set(app, cache);
  }
  return cache;
};

// 敵監視部隊の proxy 形状 resource を app ごとに共有する
// - 現在は Warden 1 体でも、同じ role を増やしたときに geometry build が増えないようにしておく
const getSharedEnemyRigResources = (app, config) => {
  const cache = getSharedEnemyRigCache(app);
  if (cache.has(config.id)) {
    return cache.get(config.id);
  }

  const bodyTemplate = new Shape(app.getGL());
  bodyTemplate.applyPrimitiveAsset(
    Primitive.cuboid(
      config.radius * 1.55,
      config.radius * 1.20,
      config.radius * 1.55,
      bodyTemplate.getPrimitiveOptions()
    )
  );
  bodyTemplate.endShape();

  const markerTemplate = new Shape(app.getGL());
  markerTemplate.applyPrimitiveAsset(
    Primitive.cuboid(
      config.radius * 0.24,
      config.radius * 1.05,
      config.radius * 0.24,
      markerTemplate.getPrimitiveOptions()
    )
  );
  markerTemplate.endShape();

  const resources = {
    bodyResource: bodyTemplate.getResource(),
    markerResource: markerTemplate.getResource()
  };
  cache.set(config.id, resources);
  return resources;
};

// 高さ帯を low / mid / high へ分ける
// - resource の維持費と、守備位置としての好みを同じ分類で読めるようにする
const getHeightBand = (cell) => {
  const height = Number.isFinite(cell?.height) ? Number(cell.height) : 0;
  if (height <= 1) {
    return "low";
  }
  if (height >= 4) {
    return "high";
  }
  return "mid";
};

// cell を map key へ変換する
// - occupied 判定を軽い Set で扱うための小さい helper
const getCellKey = (cell) => `${cell?.col ?? -1},${cell?.row ?? -1}`;

// 4 方向の隣接 cell を返す
// - path が blocked されたときに、代替の 1 step 候補を比較するために使う
const getNeighborCells = (tileMap, cell) => {
  if (!cell) {
    return [];
  }
  return [
    tileMap.getCell(cell.col + 1, cell.row),
    tileMap.getCell(cell.col - 1, cell.row),
    tileMap.getCell(cell.col, cell.row + 1),
    tileMap.getCell(cell.col, cell.row - 1)
  ].filter(Boolean);
};

// 盤面から「守備高地」と「補給低地」の候補を選ぶ
// - guard cell は高地かつ goal / beacon に寄りやすい場所
// - depot cell は低地かつ歩きやすく、守備拠点から遠すぎない場所を選ぶ
const collectEnemyAnchors = (tileMap, alphaCell, mission) => {
  const walkable = [];
  for (let i = 0; i < tileMap.cells.length; i++) {
    const cell = tileMap.cells[i];
    if (!cell) {
      continue;
    }
    const walkableNeighborCount = getWalkableNeighborCount(tileMap, cell);
    if (walkableNeighborCount <= 0) {
      continue;
    }
    walkable.push({
      cell,
      walkableNeighborCount
    });
  }

  const goalCell = mission?.goalCell ?? alphaCell;
  const remainingBeacons = Array.isArray(mission?.beacons)
    ? mission.beacons.filter((beacon) => !beacon.collected).map((beacon) => beacon.cell)
    : [];
  const getObjectiveDistance = (cell) => {
    const goalDistance = Math.abs(cell.col - goalCell.col) + Math.abs(cell.row - goalCell.row);
    if (remainingBeacons.length <= 0) {
      return goalDistance;
    }
    const beaconDistance = Math.min(...remainingBeacons.map((beaconCell) => {
      return Math.abs(cell.col - beaconCell.col) + Math.abs(cell.row - beaconCell.row);
    }));
    return Math.min(goalDistance, beaconDistance);
  };
  const getAlphaDistance = (cell) => {
    return Math.abs(cell.col - alphaCell.col) + Math.abs(cell.row - alphaCell.row);
  };

  const guardCell = walkable
    .map((entry) => ({
      ...entry,
      score: entry.cell.height * 3.2
        + entry.walkableNeighborCount * 1.2
        - getObjectiveDistance(entry.cell) * 1.1
        + Math.min(5.0, getAlphaDistance(entry.cell) * 0.25)
    }))
    .sort((left, right) => right.score - left.score)[0]?.cell ?? goalCell;

  const depotCell = walkable
    .map((entry) => ({
      ...entry,
      score: (5 - entry.cell.height) * 2.4
        + entry.walkableNeighborCount * 1.0
        - (Math.abs(entry.cell.col - guardCell.col) + Math.abs(entry.cell.row - guardCell.row)) * 0.65
    }))
    .sort((left, right) => right.score - left.score)[0]?.cell ?? guardCell;

  return {
    guardCell,
    depotCell
  };
};

// 敵監視部隊の見た目を作る
// - 味方側と区別しやすいように、赤系 cuboid と短い marker を組み合わせる
const createEnemyScoutRig = (app, config) => {
  const resources = getSharedEnemyRigResources(app, config);
  const node = app.space.addNode(null, config.id);
  const shape = node.addShape(resources.bodyResource);
  shape.setMaterial("smooth-shader", {
    has_bone: 0,
    use_texture: 0,
    color: [...config.color],
    ambient: 0.34,
    specular: 0.72,
    power: 34.0
  });

  const markerNode = app.space.addNode(node, `${config.id}-marker`);
  markerNode.setPosition(0.0, config.radius + 0.34, 0.0);
  const markerShape = markerNode.addShape(resources.markerResource);
  markerShape.setMaterial("smooth-shader", {
    has_bone: 0,
    use_texture: 0,
    color: [...config.markerColor],
    ambient: 0.42,
    specular: 0.54,
    power: 26.0
  });

  return {
    node,
    markerNode,
    shape,
    markerShape
  };
};

// 敵部隊を現在 cell へ即時配置する
const placeEnemyScout = (tileMap, unit) => {
  tileMap.placeNodeOnCell(unit.node, unit.cell, BALL_LIFT, unit.radius);
};

// resource の増減を、敵監視部隊向けの性格に合わせて解決する
// - 高地にいると arms は維持しやすいが food は苦しくなる
// - 低地へ下ると補給は楽になるが、防衛姿勢としての arms は伸びにくい
const resolveEnemyEconomyDelta = (unit) => {
  const band = getHeightBand(unit.cell);
  let foodGain = band === "low" ? 2 : band === "mid" ? 1 : 0;
  let armsGain = band === "high" ? 2 : band === "mid" ? 1 : 0;
  let foodUpkeep = band === "high" ? 2 : 1;
  let armsUpkeep = band === "low" ? 1 : 0;

  if (band === "high") {
    foodGain = Math.max(0, foodGain - 1);
  }
  if (band === "low") {
    armsGain = Math.max(0, armsGain - 1);
  }

  return {
    band,
    nextFood: Math.max(0, unit.food - foodUpkeep + foodGain),
    nextArms: Math.max(0, unit.arms - armsUpkeep + armsGain)
  };
};

// occupied cell を避けつつ、target へ近づく次の 1 step を選ぶ
// - 直接 path の先頭が埋まっている場合でも、隣接候補から最も近い経路を選び直す
const chooseAdvanceCell = (tileMap, fromCell, targetCell, occupiedKeys) => {
  if (!fromCell || !targetCell) {
    return null;
  }
  const directPath = tileMap.findPath(fromCell, targetCell);
  const directNext = Array.isArray(directPath) && directPath.length >= 2 ? directPath[1] : null;
  if (directNext && !occupiedKeys.has(getCellKey(directNext)) && tileMap.canMove(fromCell, directNext)) {
    return directNext;
  }

  const getPathMoves = createPathMoveCounter(tileMap);
  return getNeighborCells(tileMap, fromCell)
    .filter((cell) => tileMap.canMove(fromCell, cell))
    .filter((cell) => !occupiedKeys.has(getCellKey(cell)))
    .map((cell) => ({
      cell,
      pathMoves: getPathMoves(cell, targetCell),
      heightBonus: cell.height ?? 0
    }))
    .filter((entry) => Number.isFinite(entry.pathMoves))
    .sort((left, right) => {
      if (left.pathMoves !== right.pathMoves) {
        return left.pathMoves - right.pathMoves;
      }
      return right.heightBonus - left.heightBonus;
    })[0]?.cell ?? null;
};

// 敵監視部隊の現在 intent を決める
// - まず補給切れを避け、その次に goal / beacon の守り、最後に近い Alpha への圧力を見る
const selectEnemyIntent = (tileMap, unit, alphaUnit, supportUnits, mission) => {
  const anchors = collectEnemyAnchors(tileMap, alphaUnit?.cell ?? unit.cell, mission);
  const getPathMoves = createPathMoveCounter(tileMap);
  const friendlyUnits = [alphaUnit, ...(Array.isArray(supportUnits) ? supportUnits : [])].filter(Boolean);
  const nearestFriendly = friendlyUnits
    .map((entry) => ({
      unit: entry,
      pathMoves: getPathMoves(unit.cell, entry.cell)
    }))
    .filter((entry) => Number.isFinite(entry.pathMoves))
    .sort((left, right) => left.pathMoves - right.pathMoves)[0] ?? null;
  const remainingBeacons = Array.isArray(mission?.beacons)
    ? mission.beacons.filter((beacon) => !beacon.collected).map((beacon) => beacon.cell)
    : [];
  const highBeacon = remainingBeacons
    .filter((cell) => (cell?.height ?? 0) >= 3)
    .sort((left, right) => getPathMoves(unit.cell, left) - getPathMoves(unit.cell, right))[0] ?? null;

  if (unit.food <= 1 || unit.arms <= 1) {
    return {
      id: "resupply_lowland",
      targetCell: anchors.depotCell,
      summary: "RESUPPLY LOWLAND"
    };
  }
  if (nearestFriendly && nearestFriendly.pathMoves <= 2) {
    return {
      id: "pressure_front",
      targetCell: nearestFriendly.unit.cell,
      summary: `PRESSURE ${nearestFriendly.unit.label ?? nearestFriendly.unit.id?.toUpperCase() ?? "ALPHA"}`
    };
  }
  if (mission?.goalUnlocked && mission?.goalCell) {
    return {
      id: "guard_goal",
      targetCell: mission.goalCell,
      summary: "GUARD GOAL"
    };
  }
  if (highBeacon) {
    return {
      id: "watch_beacon",
      targetCell: highBeacon,
      summary: "WATCH HIGH BEACON"
    };
  }
  return {
    id: "hold_ridge",
    targetCell: anchors.guardCell,
    summary: "HOLD RIDGE"
  };
};

// 敵監視部隊を 1 step 移動させる
// - occupied cell を避けながら target へ近づき、移動完了後に callback を返す
const moveEnemyScoutToward = (tileMap, unit, targetCell, occupiedKeys, onSettled = null) => {
  const nextCell = chooseAdvanceCell(tileMap, unit.cell, targetCell, occupiedKeys);
  if (!nextCell) {
    return false;
  }
  const targetPosition = tileMap.getNodePositionOnCell(nextCell, BALL_LIFT, unit.radius);
  if (!targetPosition) {
    return false;
  }
  unit.actor?.faceTowardCells?.(unit.cell, nextCell, {
    durationMs: BALL_MOVE_DURATION_MS
  });
  unit.isMoving = true;
  unit.currentTween = unit.node.animatePosition(targetPosition, {
    durationMs: BALL_MOVE_DURATION_MS,
    easing: "outCubic",
    onComplete: () => {
      unit.currentTween = null;
      unit.isMoving = false;
      unit.cell = nextCell;
      onSettled?.();
    }
  });
  unit.markerNode.animateRotation([0.0, 0.0, 90.0], {
    durationMs: BALL_MOVE_DURATION_MS,
    easing: "linear",
    relative: true
  });
  unit.food = Math.max(0, unit.food - 1);
  return true;
};

// 敵監視部隊 runtime を作る
// - 現段階では 1 体だけを扱い、goal 防衛と高地監視の最小ループに絞る
export const createTileSimEnemyScout = async (app, tileMap, getMissionState) => {
  const rig = createEnemyScoutRig(app, ENEMY_SCOUT_CONFIG);
  const actor = await createTileSimHumanActor(app, rig.node, {
    placementNodeName: "warden-human-placement",
    offsetNodeName: "warden-human-offset",
    ballRadius: ENEMY_SCOUT_CONFIG.radius,
    ballLift: BALL_LIFT,
    footClearance: -0.06,
    scale: 2.0,
    yaw: 180.0,
    tintColor: ENEMY_SCOUT_CONFIG.humanTint,
    formationBackRatio: HUMAN_GROUP_BACK_RATIO + HUMAN_CELL_FORMATION_RATIO
  });
  actor.hideProxyShapes([rig.shape, rig.markerShape]);
  const unit = {
    ...ENEMY_SCOUT_CONFIG,
    ...rig,
    actor,
    cell: tileMap.getCell(0, 0),
    food: ENEMY_SCOUT_CONFIG.baseFood,
    arms: ENEMY_SCOUT_CONFIG.baseArms,
    isMoving: false,
    currentTween: null,
    lastDecision: "HOLD RIDGE"
  };

  // mission reset 時に、goal と beacon を守りやすい高地へ戻す
  const reset = (alphaCell, goalCell = null, beaconCells = []) => {
    const missionShape = {
      goalCell,
      beacons: Array.isArray(beaconCells) ? beaconCells.map((cell) => ({ cell, collected: false })) : []
    };
    const anchors = collectEnemyAnchors(tileMap, alphaCell, missionShape);
    unit.cell = anchors.guardCell;
    unit.food = unit.baseFood;
    unit.arms = unit.baseArms;
    unit.isMoving = false;
    unit.currentTween = null;
    unit.lastDecision = "HOLD RIDGE";
    placeEnemyScout(tileMap, unit);
  };

  // Alpha 手番後の盤面を見て、敵監視部隊を 1 step 反応させる
  const advanceTurnAndWait = ({ alphaUnit = null, supportUnits = [] } = {}, onSettled = null) => {
    const mission = getMissionState?.() ?? null;
    const intent = selectEnemyIntent(tileMap, unit, alphaUnit, supportUnits, mission);
    unit.lastDecision = intent.summary;
    const occupiedKeys = new Set(
      [alphaUnit, ...(Array.isArray(supportUnits) ? supportUnits : [])]
        .filter(Boolean)
        .map((entry) => getCellKey(entry.cell))
    );
    if (moveEnemyScoutToward(tileMap, unit, intent.targetCell, occupiedKeys, () => onSettled?.(true))) {
      return true;
    }
    onSettled?.(false);
    return false;
  };

  // turn 終了時の敵 resource を更新し、HUD 用 summary を返す
  const applyTurnStep = (alphaUnit = null) => {
    const delta = resolveEnemyEconomyDelta(unit);
    unit.food = delta.nextFood;
    unit.arms = delta.nextArms;
    const distanceToAlpha = alphaUnit?.cell
      ? Math.abs(unit.cell.col - alphaUnit.cell.col) + Math.abs(unit.cell.row - alphaUnit.cell.row)
      : Number.POSITIVE_INFINITY;
    return [
      {
        id: unit.id,
        label: unit.label,
        band: delta.band,
        food: unit.food,
        arms: unit.arms,
        distanceToAlpha,
        actionSummary: unit.lastDecision
      }
    ];
  };

  return {
    reset,
    advanceTurnAndWait,
    applyTurnStep,
    updateActor(deltaMs = 0) {
      unit.actor?.update?.(deltaMs);
    },
    isBusy: () => unit.isMoving,
    getUnits: () => [{
      id: unit.id,
      role: unit.role,
      label: unit.label,
      cell: unit.cell,
      food: unit.food,
      arms: unit.arms,
      hp: 4,
      control: "enemy",
      lastDecision: unit.lastDecision
    }]
  };
};
