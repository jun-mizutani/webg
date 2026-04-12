// -------------------------------------------------
// tile_sim sample
//   support_units.js 2026/04/10
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// -------------------------------------------------

import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";
import {
  BALL_LIFT,
  BALL_MOVE_DURATION_MS,
  BALL_RADIUS
} from "./constants.js";
import { getWalkableNeighborCount } from "./mission.js";
import { createTileSimHumanActor } from "./alpha_actor.js";

const HUMAN_CELL_FORMATION_RATIO = 0.10;
const HUMAN_GROUP_BACK_RATIO = 0.04;
const SUPPORT_HUMAN_RUNTIME_SCALE = 0.64;
const sharedSupportRigResourceCache = new WeakMap();

// この module は、tile_sim の AI 補助部隊 Bravo / Mule を実体として扱う
// - Alpha は従来どおり player が直接動かし、Bravo と Mule は AI advisor の推奨に沿って追従する
// - まだ敵軍や完全な turn 制は入れず、複数部隊が同じ TileMap 上で意味を持つ段階までを受け持つ

// support unit ごとの base 設定をここへ集める
// - proxy 形状、human tint、role、初期資源を 1 か所で読めるようにする
const SUPPORT_UNIT_CONFIGS = [
  {
    id: "bravo",
    label: "BRAVO",
    role: "ranged",
    baseFood: 3,
    baseArms: 4,
    radius: BALL_RADIUS * 0.82,
    color: [0.52, 0.94, 1.0, 1.0],
    markerColor: [0.16, 0.30, 0.44, 1.0],
    humanTint: [0.72, 0.92, 1.18, 1.0]
  },
  {
    id: "mule",
    label: "MULE",
    role: "supply",
    baseFood: 8,
    baseArms: 6,
    radius: BALL_RADIUS * 0.78,
    color: [0.68, 1.0, 0.56, 1.0],
    markerColor: [0.18, 0.32, 0.18, 1.0],
    humanTint: [0.82, 1.14, 0.74, 1.0]
  }
];

const getSharedSupportRigCache = (app) => {
  let cache = sharedSupportRigResourceCache.get(app);
  if (!cache) {
    cache = new Map();
    sharedSupportRigResourceCache.set(app, cache);
  }
  return cache;
};

// Bravo / Mule の proxy 形状 resource を app ごとに共有する
// - primitive から GPU buffer を組み立てる処理は 1 回だけにし、
//   各 unit node には fresh instance だけをぶら下げる
const getSharedSupportRigResources = (app, config) => {
  const cache = getSharedSupportRigCache(app);
  if (cache.has(config.id)) {
    return cache.get(config.id);
  }

  const bodyTemplate = new Shape(app.getGL());
  if (config.role === "supply") {
    bodyTemplate.applyPrimitiveAsset(
      Primitive.cuboid(
        config.radius * 1.9,
        config.radius * 1.25,
        config.radius * 1.45,
        bodyTemplate.getPrimitiveOptions()
      )
    );
  } else {
    bodyTemplate.applyPrimitiveAsset(
      Primitive.sphere(config.radius, 16, 16, bodyTemplate.getPrimitiveOptions())
    );
  }
  bodyTemplate.endShape();

  const markerTemplate = new Shape(app.getGL());
  markerTemplate.applyPrimitiveAsset(
    Primitive.cuboid(
      config.radius * 1.45,
      config.radius * 0.18,
      config.radius * 0.18,
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

// map 全体から、高地寄り anchor と低地寄り anchor を 1 つずつ選ぶ
// - Bravo は見晴らしの良い高地、Mule は補給に向く低地を好むため、初期配置もその方向へ寄せる
const collectSupportAnchors = (tileMap, alphaCell) => {
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

  const distanceToAlpha = (cell) => {
    return Math.abs(cell.col - alphaCell.col) + Math.abs(cell.row - alphaCell.row);
  };
  const highGround = walkable
    .map((entry) => ({
      ...entry,
      score: entry.cell.height * 3.0 + entry.walkableNeighborCount * 1.1 - distanceToAlpha(entry.cell) * 0.18
    }))
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.cell);
  const lowland = walkable
    .map((entry) => ({
      ...entry,
      score: (6 - entry.cell.height) * 2.4 + entry.walkableNeighborCount * 1.0 - distanceToAlpha(entry.cell) * 0.12
    }))
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.cell);

  return {
    bravo: highGround.find((cell) => distanceToAlpha(cell) >= 2) ?? alphaCell,
    mule: lowland.find((cell) => distanceToAlpha(cell) >= 1) ?? alphaCell
  };
};

// unit の proxy 本体と marker を作る
// - human.glb の見た目を載せる前に、TileMap 上の位置と tween を受け持つ土台 node をここで作る
const createSupportUnitRig = (app, config) => {
  const resources = getSharedSupportRigResources(app, config);
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
  markerNode.setPosition(0.0, config.radius + 0.46, 0.0);
  const markerShape = markerNode.addShape(resources.markerResource);
  markerShape.setMaterial("smooth-shader", {
    has_bone: 0,
    use_texture: 0,
    color: [...config.markerColor],
    ambient: 0.46,
    specular: 0.52,
    power: 26.0
  });

  return {
    node,
    markerNode,
    shape,
    markerShape
  };
};

// support unit 1 体の位置と資源を初期値へ戻す
const resetSupportUnitState = (unit, cell) => {
  unit.cell = cell;
  unit.food = unit.baseFood;
  unit.arms = unit.baseArms;
  unit.isMoving = false;
  unit.lastDecision = "HOLD";
  unit.currentTween = null;
};

// tileMap 上の指定 cell へ unit を即時配置する
const placeSupportUnit = (tileMap, unit) => {
  tileMap.placeNodeOnCell(unit.node, unit.cell, BALL_LIFT, unit.radius);
};

// terrain 高さから、補給量と維持費の基準となる高さ帯を返す
// - 高地は維持が重く、低地は補給しやすいという tile_sim の基本方針を resource 側にも反映する
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

// support unit 1 体ぶんの turn 進行による資源増減を計算する
// - Mule は低地で補給を集めやすく、Bravo は高地で arms を維持しやすいように role 差を持たせる
const resolveSupportUnitEconomyDelta = (unit) => {
  const band = getHeightBand(unit.cell);
  let foodGain = band === "low" ? 2 : band === "mid" ? 1 : 0;
  let armsGain = band === "low" ? 1 : band === "mid" ? 1 : 0;
  let foodUpkeep = band === "high" ? 2 : 1;
  let armsUpkeep = band === "high" ? 1 : 0;

  if (unit.role === "ranged") {
    if (band === "high") {
      armsGain += 1;
    }
    if (band === "low") {
      foodGain = Math.max(0, foodGain - 1);
    }
  }
  if (unit.role === "supply") {
    if (band === "low") {
      foodGain += 2;
      armsGain += 1;
    }
    if (band === "high") {
      foodGain = Math.max(0, foodGain - 1);
      armsGain = Math.max(0, armsGain - 1);
    }
  }

  return {
    band,
    nextFood: Math.max(0, unit.food - foodUpkeep + foodGain),
    nextArms: Math.max(0, unit.arms - armsUpkeep + armsGain)
  };
};

// AI advisor の推奨先へ 1 step だけ進める
// - turn を大きく作り替える前の段階なので、支援部隊は毎回 1 step ずつだけ追従させる
const moveSupportUnitToward = (tileMap, unit, targetCell, onSettled = null) => {
  if (!targetCell || !unit.cell) {
    return false;
  }
  const path = tileMap.findPath(unit.cell, targetCell);
  const nextCell = Array.isArray(path) && path.length >= 2 ? path[1] : null;
  if (!nextCell || !tileMap.canMove(unit.cell, nextCell)) {
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
  unit.markerNode.animateRotation([90.0, 0.0, 0.0], {
    durationMs: BALL_MOVE_DURATION_MS,
    easing: "linear",
    relative: true
  });
  unit.food = Math.max(0, unit.food - 1);
  return true;
};

// Bravo / Mule の実体と、AI による追従処理をまとめる
export const createTileSimSupportSquad = async (app, tileMap, alphaCell, options = {}) => {
  const units = await Promise.all(SUPPORT_UNIT_CONFIGS.map(async (config) => {
    const rig = createSupportUnitRig(app, config);
    const actor = await createTileSimHumanActor(app, rig.node, {
      placementNodeName: `${config.id}-human-placement`,
      offsetNodeName: `${config.id}-human-offset`,
      ballRadius: config.radius,
      ballLift: BALL_LIFT,
      footClearance: -0.06,
      scale: 2.0,
      runtimeScale: SUPPORT_HUMAN_RUNTIME_SCALE,
      yaw: 180.0,
      tintColor: config.humanTint,
      formationBackRatio: HUMAN_GROUP_BACK_RATIO + HUMAN_CELL_FORMATION_RATIO,
      formationRightRatio: config.id === "bravo" ? -HUMAN_CELL_FORMATION_RATIO : HUMAN_CELL_FORMATION_RATIO,
      getFormationYaw: options.getFormationYaw
    });
    actor.hideProxyShapes([rig.shape, rig.markerShape]);
    return {
      ...config,
      ...rig,
      actor,
      cell: alphaCell,
      food: config.baseFood,
      arms: config.baseArms,
      isMoving: false,
      currentTween: null,
      lastDecision: "HOLD"
    };
  }));

  // mission reset 時に Alpha 周辺の標準 anchor へ戻す
  const reset = (anchorCell) => {
    const anchors = collectSupportAnchors(tileMap, anchorCell);
    for (let i = 0; i < units.length; i++) {
      const unit = units[i];
      const cell = anchors[unit.id] ?? anchorCell;
      resetSupportUnitState(unit, cell);
      placeSupportUnit(tileMap, unit);
    }
  };

  // AI advisor の snapshot を見て、Bravo / Mule を 1 step 進める
  const advanceWithAdvisor = (aiSnapshot) => {
    if (!aiSnapshot || !Array.isArray(aiSnapshot.units)) {
      return false;
    }
    let moved = false;
    for (let i = 0; i < units.length; i++) {
      const unit = units[i];
      if (unit.isMoving) {
        continue;
      }
      const plan = aiSnapshot.units.find((entry) => entry.id === unit.id);
      unit.lastDecision = plan?.actionSummary ?? "HOLD";
      const targetCell = plan?.bestAction?.targetCell ?? null;
      if (moveSupportUnitToward(tileMap, unit, targetCell)) {
        moved = true;
      }
    }
    return moved;
  };

  // Alpha の手番が終わったあとに、Bravo / Mule 側の維持費と補給を進める
  // - まだ faction stock を大きく持たず、まずは unit ごとの food / arms が地形でどう変わるかを見る
  const applyTurnStep = () => {
    const summaries = [];
    for (let i = 0; i < units.length; i++) {
      const unit = units[i];
      const delta = resolveSupportUnitEconomyDelta(unit);
      unit.food = delta.nextFood;
      unit.arms = delta.nextArms;
      summaries.push({
        id: unit.id,
        label: unit.label,
        band: delta.band,
        food: unit.food,
        arms: unit.arms
      });
    }
    return summaries;
  };

  // advisor の snapshot を見て Bravo / Mule を 1 step 進め、全員の移動が終わったら callback を呼ぶ
  // - main.js 側はここを turn 境界として使い、support unit の見え方が落ち着いたあとで resource を更新する
  const advanceWithAdvisorAndWait = (aiSnapshot, onSettled = null) => {
    if (!aiSnapshot || !Array.isArray(aiSnapshot.units)) {
      onSettled?.(false);
      return false;
    }
    let moved = false;
    let pending = 0;
    const finish = () => {
      pending -= 1;
      if (pending <= 0) {
        onSettled?.(moved);
      }
    };
    for (let i = 0; i < units.length; i++) {
      const unit = units[i];
      if (unit.isMoving) {
        continue;
      }
      const plan = aiSnapshot.units.find((entry) => entry.id === unit.id);
      unit.lastDecision = plan?.actionSummary ?? "HOLD";
      const targetCell = plan?.bestAction?.targetCell ?? null;
      const path = targetCell ? tileMap.findPath(unit.cell, targetCell) : null;
      const nextCell = Array.isArray(path) && path.length >= 2 ? path[1] : null;
      if (!nextCell || !tileMap.canMove(unit.cell, nextCell)) {
        continue;
      }
      pending += 1;
      if (moveSupportUnitToward(tileMap, unit, targetCell, finish)) {
        moved = true;
      } else {
        finish();
      }
    }
    if (pending <= 0) {
      onSettled?.(false);
    }
    return moved;
  };

  reset(alphaCell);

  return {
    reset,
    advanceWithAdvisor,
    advanceWithAdvisorAndWait,
    applyTurnStep,
    updateActors(deltaMs = 0) {
      for (let i = 0; i < units.length; i++) {
        units[i].actor?.update?.(deltaMs);
      }
    },
    isBusy: () => units.some((unit) => unit.isMoving),
    getUnits: () => units.map((unit) => ({
      id: unit.id,
      label: unit.label,
      role: unit.role,
      cell: unit.cell,
      food: unit.food,
      arms: unit.arms,
      hp: 4,
      control: "ai",
      lastDecision: unit.lastDecision
    }))
  };
};
