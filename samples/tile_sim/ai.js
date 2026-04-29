// ---------------------------------------------
// samples/tile_sim/ai.js  2026/04/01
//   tile_sim sample
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import { MAX_TERRAIN_HEIGHT } from "./constants.js";
import {
  createPathMoveCounter,
  getWalkableNeighborCount
} from "./mission.js";

// この module は、tile_sim の computer 側判断を最小構成で試す AI advisor を提供する
// - まだ敵軍そのものを完全実装せず、「今の map と mission なら computer は何を重視するか」を見える化する
// - 陣営方針は rule-based、部隊ごとの候補行動は utility score で選ぶ hybrid 構成の入口として使う

// 高さ帯の分類は地形 score の基本になる
// - low / mid / high に分けることで、見た目の高さ差を AI の判断と結び付けやすくする
const getHeightBand = (height) => {
  const value = Number.isFinite(height) ? Number(height) : 0;
  if (value <= 1) {
    return "low";
  }
  if (value >= Math.max(4, MAX_TERRAIN_HEIGHT - 1)) {
    return "high";
  }
  return "mid";
};

// 陣営方針ごとの短い説明と優先目標をここへ集める
// - HUD にも出すため、label は短く、reason は 1 行で読める表現にする
const AI_POLICY_DEFS = {
  hold_highground: {
    label: "HOLD_HIGHGROUND",
    reason: "High ridge control is worth more than fast expansion"
  },
  secure_farmland: {
    label: "SECURE_FARMLAND",
    reason: "Lowland food flow is more urgent than direct combat"
  },
  resupply_front: {
    label: "RESUPPLY_FRONT",
    reason: "Frontline pressure is high, so supply must catch up first"
  },
  pressure_enemy_base: {
    label: "PRESSURE_BASE",
    reason: "Core objectives are open, so pressure can move forward"
  },
  controlled_retreat: {
    label: "CONTROLLED_RETREAT",
    reason: "Risk is too high, so preserving units comes before terrain"
  }
};

// role ごとにどの高さ帯や行動を好むかを数値化する
// - 複数部隊の差を単なる名前にせず、同じ map を見ても優先順位が変わるようにする
const AI_ROLE_PROFILES = {
  frontline: {
    label: "ALPHA",
    terrainBias: { low: -1.0, mid: 2.0, high: 5.0 },
    actionBias: { move: 1.0, capture: 4.0, hold: 1.0, resupply: -1.0, retreat: -2.0 }
  },
  ranged: {
    label: "BRAVO",
    terrainBias: { low: -2.0, mid: 2.0, high: 6.0 },
    actionBias: { move: 1.0, capture: 2.0, hold: 3.0, resupply: 0.0, retreat: -1.0 }
  },
  supply: {
    label: "MULE",
    terrainBias: { low: 5.0, mid: 1.0, high: -5.0 },
    actionBias: { move: 1.0, capture: -4.0, hold: 0.0, resupply: 6.0, retreat: 3.0 }
  }
};

// mission から未回収 beacon 群を抜き出す
// - AI の objective 評価では「今取るべき beacon」だけを見たい
const getRemainingBeacons = (mission) => {
  if (!Array.isArray(mission?.beacons)) {
    return [];
  }
  return mission.beacons.filter((beacon) => !beacon.collected);
};

// cell 間のマンハッタン距離を返す
// - score の細かい比較では path が無くても軽い距離近似を使いたい場面がある
const getCellDistance = (fromCell, toCell) => {
  if (!fromCell || !toCell) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.abs(fromCell.col - toCell.col) + Math.abs(fromCell.row - toCell.row);
};

// role ごとに food / arms の仮状態を作る
// - まだ複数部隊 runtime が無い段階なので、mission 進行から sample 用の資源圧を作る
const createUnitResourceState = (role, mission) => {
  const movesUsed = Number.isFinite(mission?.movesUsed) ? Number(mission.movesUsed) : 0;
  if (role === "frontline") {
    return {
      food: Math.max(1, 4 - Math.floor(movesUsed / 3)),
      arms: Math.max(1, 3 - Math.floor(movesUsed / 5)),
      hp: 5
    };
  }
  if (role === "ranged") {
    return {
      food: Math.max(1, 3 - Math.floor(movesUsed / 4)),
      arms: Math.max(1, 4 - Math.floor(movesUsed / 6)),
      hp: 4
    };
  }
  return {
    food: Math.max(3, 8 - Math.floor(movesUsed / 4)),
    arms: Math.max(3, 6 - Math.floor(movesUsed / 6)),
    hp: 4
  };
};

// map 全体から高地候補と低地補給候補を選ぶ
// - AI は全 cell を等価に見るより、戦略上の anchor 候補を先に絞った方が判断理由を説明しやすい
const collectStrategicCells = (tileMap, mission, anchorCell) => {
  const walkableCells = [];
  for (let i = 0; i < tileMap.cells.length; i++) {
    const cell = tileMap.cells[i];
    if (!cell) {
      continue;
    }
    const walkableNeighborCount = getWalkableNeighborCount(tileMap, cell);
    if (walkableNeighborCount <= 0) {
      continue;
    }
    walkableCells.push({
      cell,
      walkableNeighborCount
    });
  }

  const goalCell = mission?.goalCell ?? anchorCell;
  const rankCells = (scoreFn) => {
    return walkableCells
      .map((entry) => ({
        ...entry,
        score: scoreFn(entry.cell, entry.walkableNeighborCount)
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, 4)
      .map((entry) => entry.cell);
  };

  return {
    highGroundCells: rankCells((cell, walkableNeighborCount) => {
      return cell.height * 3.0 + walkableNeighborCount * 1.2 - getCellDistance(cell, goalCell) * 0.15;
    }),
    supplyCells: rankCells((cell, walkableNeighborCount) => {
      return (MAX_TERRAIN_HEIGHT - cell.height) * 2.2 + walkableNeighborCount * 1.1 - getCellDistance(cell, anchorCell) * 0.12;
    })
  };
};

// sample 用の基準部隊を現在の mission と player 位置から作る
// - 実体の無い unit があっても advisor は動かしたいため、まずは全 role の基準値をここで作る
const createDraftUnits = (mission, strategicCells, anchorCell) => {
  const frontlineCell = anchorCell;
  const rangedCell = strategicCells.highGroundCells.find((cell) => getCellDistance(cell, frontlineCell) >= 2)
    ?? strategicCells.highGroundCells[0]
    ?? frontlineCell;
  const supplyCell = strategicCells.supplyCells.find((cell) => getCellDistance(cell, frontlineCell) >= 1)
    ?? strategicCells.supplyCells[0]
    ?? frontlineCell;

  return [
    {
      id: "alpha",
      role: "frontline",
      cell: frontlineCell,
      ...createUnitResourceState("frontline", mission)
    },
    {
      id: "bravo",
      role: "ranged",
      cell: rangedCell,
      ...createUnitResourceState("ranged", mission)
    },
    {
      id: "mule",
      role: "supply",
      cell: supplyCell,
      ...createUnitResourceState("supply", mission)
    }
  ];
};

// 実体として存在する unit 状態があれば、基準部隊へ上書きして advisor を current 状態へ寄せる
// - Alpha は draft を基準にしつつ、Bravo / Mule の位置や資源だけを support unit 実体から受け取れるようにする
const mergeActualUnits = (draftUnits, actualUnits = []) => {
  const byId = new Map();
  for (let i = 0; i < draftUnits.length; i++) {
    byId.set(draftUnits[i].id, {
      ...draftUnits[i]
    });
  }
  for (let i = 0; i < actualUnits.length; i++) {
    const actual = actualUnits[i];
    if (!actual?.id || !byId.has(actual.id)) {
      continue;
    }
    byId.set(actual.id, {
      ...byId.get(actual.id),
      ...actual
    });
  }
  return Array.from(byId.values());
};

// mission 状態から陣営方針を 1 つ選ぶ
// - ここは explainable な rule-based 入口として保ち、後段で utility 化しなくてよい部分に絞る
const selectFactionPolicy = (mission, units, strategicCells) => {
  const remainingBeacons = getRemainingBeacons(mission);
  const lowFoodUnit = units.find((unit) => unit.food <= 1);
  const lowArmsUnit = units.find((unit) => unit.arms <= 1);
  const frontline = units.find((unit) => unit.role === "frontline");
  const highestGoal = mission?.goalCell?.height ?? 0;
  const highGroundPressure = highestGoal >= 4
    || remainingBeacons.some((beacon) => (beacon?.cell?.height ?? 0) >= 4)
    || (strategicCells.highGroundCells[0]?.height ?? 0) >= 4;

  if (lowFoodUnit || lowArmsUnit) {
    return {
      id: "resupply_front",
      reasonUnit: lowFoodUnit?.id ?? lowArmsUnit?.id ?? null
    };
  }
  if ((mission?.movesLimit ?? 0) > 0 && (mission?.movesUsed ?? 0) / (mission?.movesLimit ?? 1) >= 0.75) {
    return {
      id: "controlled_retreat",
      reasonUnit: frontline?.id ?? null
    };
  }
  if (!mission?.goalUnlocked) {
    if ((mission?.collectedCount ?? 0) === 0 || highGroundPressure) {
      return {
        id: "hold_highground",
        reasonUnit: "bravo"
      };
    }
    return {
      id: "secure_farmland",
      reasonUnit: "mule"
    };
  }
  return {
    id: "pressure_enemy_base",
    reasonUnit: frontline?.id ?? null
  };
};

// 部隊が比較する候補行動群を組み立てる
// - 今は sample 用の advisor なので、抽象度の高い anchor 行動を候補として並べる
const buildActionCandidates = (mission, strategicCells, unit, units) => {
  const remainingBeacons = getRemainingBeacons(mission);
  const frontline = units.find((entry) => entry.role === "frontline") ?? unit;
  const actions = [
    {
      type: "hold",
      targetCell: unit.cell,
      targetLabel: "current line",
      targetKind: "hold"
    }
  ];

  if (mission?.goalCell) {
    actions.push({
      type: "capture",
      targetCell: mission.goalCell,
      targetLabel: "goal",
      targetKind: "goal"
    });
  }
  if (remainingBeacons[0]?.cell) {
    actions.push({
      type: "move",
      targetCell: remainingBeacons[0].cell,
      targetLabel: "beacon",
      targetKind: "beacon"
    });
  }
  if (strategicCells.highGroundCells[0]) {
    actions.push({
      type: unit.role === "ranged" ? "hold" : "move",
      targetCell: strategicCells.highGroundCells[0],
      targetLabel: "high ridge",
      targetKind: "high-ground"
    });
  }
  if (strategicCells.supplyCells[0]) {
    actions.push({
      type: unit.role === "supply" ? "resupply" : "retreat",
      targetCell: strategicCells.supplyCells[0],
      targetLabel: "lowland depot",
      targetKind: "supply-line"
    });
  }
  if (unit.role !== "frontline" && frontline?.cell) {
    actions.push({
      type: unit.role === "supply" ? "resupply" : "move",
      targetCell: frontline.cell,
      targetLabel: "frontline support",
      targetKind: "frontline-support"
    });
  }

  // target 種別と座標が同じ候補は統合し、score 比較を追いやすくする
  const unique = new Map();
  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    const cell = action.targetCell;
    const key = `${action.type}:${action.targetKind}:${cell?.col ?? -1},${cell?.row ?? -1}`;
    if (!unique.has(key)) {
      unique.set(key, action);
    }
  }
  return Array.from(unique.values());
};

// role と高さ帯の相性から terrain score を返す
const scoreTerrain = (unit, action) => {
  const profile = AI_ROLE_PROFILES[unit.role];
  const band = getHeightBand(action.targetCell?.height ?? 0);
  return profile?.terrainBias?.[band] ?? 0.0;
};

// 補給状態から supply score を返す
// - food / arms が苦しい unit ほど低地補給拠点や補給行動を強く好む
const scoreSupply = (unit, action, pathMoves) => {
  const lowResourcePenalty = (Math.max(0, 2 - unit.food) + Math.max(0, 2 - unit.arms)) * 4.0;
  const isSupplyAction = action.targetKind === "supply-line" || action.type === "resupply" || action.type === "retreat";
  if (isSupplyAction) {
    return lowResourcePenalty + Math.max(0, 4.0 - pathMoves);
  }
  return -lowResourcePenalty * 0.65;
};

// 孤立しそうな場所や高地長居の重さを threat score として扱う
const scoreThreat = (tileMap, unit, action) => {
  const walkableNeighborCount = getWalkableNeighborCount(tileMap, action.targetCell);
  const band = getHeightBand(action.targetCell?.height ?? 0);
  let score = Math.min(2.0, walkableNeighborCount * 0.5);
  if (band === "high" && unit.role === "supply") {
    score -= 5.0;
  }
  if (walkableNeighborCount <= 1) {
    score -= 3.0;
  }
  return score;
};

// 味方本隊や補給隊との距離から support score を返す
const scoreSupport = (unit, action, units, getPathMoves) => {
  const supportDistances = units
    .filter((entry) => entry.id !== unit.id)
    .map((entry) => getPathMoves(action.targetCell, entry.cell))
    .filter((distance) => Number.isFinite(distance));
  if (supportDistances.length <= 0) {
    return 0.0;
  }
  const nearestSupport = Math.min(...supportDistances);
  return Math.max(-4.0, 4.0 - nearestSupport);
};

// 陣営方針と target 種別の一致度を objective score として返す
const scoreObjective = (policyId, action) => {
  const kind = action.targetKind;
  if (policyId === "hold_highground") {
    if (kind === "high-ground") return 8.0;
    if (kind === "goal" || kind === "beacon") return 3.0;
    if (kind === "supply-line") return -2.0;
  }
  if (policyId === "secure_farmland") {
    if (kind === "supply-line") return 8.0;
    if (kind === "frontline-support") return 2.0;
    if (kind === "high-ground") return -1.0;
  }
  if (policyId === "resupply_front") {
    if (kind === "supply-line" || kind === "frontline-support") return 8.0;
    if (kind === "goal") return -4.0;
  }
  if (policyId === "pressure_enemy_base") {
    if (kind === "goal") return 8.0;
    if (kind === "beacon") return 4.0;
    if (kind === "high-ground") return 2.0;
  }
  if (policyId === "controlled_retreat") {
    if (kind === "supply-line") return 7.0;
    if (action.type === "retreat") return 5.0;
    if (kind === "goal") return -6.0;
  }
  return 0.0;
};

// path 長から fatigue score を返す
// - 遠すぎる移動は role を問わず少しずつ減点し、高地の重さも移動長へ含める
const scoreFatigue = (pathMoves) => {
  if (!Number.isFinite(pathMoves)) {
    return -20.0;
  }
  return Math.max(-8.0, -pathMoves * 0.9);
};

// role 固有の action 好みを返す
const scoreRoleBias = (unit, action) => {
  const profile = AI_ROLE_PROFILES[unit.role];
  return profile?.actionBias?.[action.type] ?? 0.0;
};

// 候補行動 1 件の total score と内訳を返す
const scoreAction = (tileMap, unit, action, units, policyId, getPathMoves) => {
  const pathMoves = getPathMoves(unit.cell, action.targetCell);
  const breakdown = {
    terrain: scoreTerrain(unit, action),
    supply: scoreSupply(unit, action, pathMoves),
    threat: scoreThreat(tileMap, unit, action),
    support: scoreSupport(unit, action, units, getPathMoves),
    objective: scoreObjective(policyId, action),
    fatigue: scoreFatigue(pathMoves),
    roleBias: scoreRoleBias(unit, action)
  };
  const total = Object.values(breakdown).reduce((sum, value) => sum + value, 0.0);
  return {
    ...action,
    pathMoves,
    breakdown,
    total
  };
};

// snapshot 全体を組み立てる
// - status 行へそのまま出せる summary を用意しつつ、詳細な score 内訳も保持する
const buildAdvisorSnapshot = (tileMap, mission, frontlineCell, actualUnits = []) => {
  const anchorCell = frontlineCell ?? mission?.plan?.startCell ?? mission?.goalCell ?? tileMap.getCell(0, 0);
  const strategicCells = collectStrategicCells(tileMap, mission, anchorCell);
  const units = mergeActualUnits(createDraftUnits(mission, strategicCells, anchorCell), actualUnits);
  const stock = {
    food: Math.max(0, 18 - Math.floor((mission?.movesUsed ?? 0) * 1.2)),
    arms: Math.max(0, 10 - Math.floor((mission?.movesUsed ?? 0) * 0.6))
  };
  const policy = selectFactionPolicy(mission, units, strategicCells);
  const getPathMoves = createPathMoveCounter(tileMap);

  const unitPlans = units.map((unit) => {
    const actions = buildActionCandidates(mission, strategicCells, unit, units)
      .map((action) => scoreAction(tileMap, unit, action, units, policy.id, getPathMoves))
      .sort((left, right) => right.total - left.total);
    const bestAction = actions[0] ?? null;
    const profile = AI_ROLE_PROFILES[unit.role];
    const actionSummary = bestAction
      ? `${bestAction.type.toUpperCase()} ${bestAction.targetLabel.toUpperCase()} ${bestAction.total.toFixed(1)}`
      : "HOLD";
    return {
      ...unit,
      label: profile?.label ?? unit.id.toUpperCase(),
      actions,
      bestAction,
      actionSummary
    };
  });

  return {
    stock,
    policyId: policy.id,
    policyLabel: AI_POLICY_DEFS[policy.id]?.label ?? policy.id.toUpperCase(),
    policyReason: AI_POLICY_DEFS[policy.id]?.reason ?? "",
    focusUnitId: policy.reasonUnit,
    strategicCells,
    units: unitPlans
  };
};

// 毎 frame 全計算しなくて済むよう、mission 状態キーを見て snapshot を cache する advisor を作る
// - ball の現在 cell が変わったときも再計算し、status に出る推奨が player 行動へ追従するようにする
export const createTileSimAiAdvisor = (tileMap, getMissionState, getFrontlineCell, getUnitsState = null) => {
  let lastKey = null;
  let lastSnapshot = null;

  const buildKey = (mission, frontlineCell, actualUnits = []) => {
    const unitKey = actualUnits.map((unit) => {
      return [
        unit.id ?? "unit",
        unit.cell?.col ?? -1,
        unit.cell?.row ?? -1,
        unit.food ?? -1,
        unit.arms ?? -1
      ].join(",");
    }).join(";");
    return [
      mission?.movesUsed ?? 0,
      mission?.movesLimit ?? 0,
      mission?.collectedCount ?? 0,
      mission?.goalUnlocked ? 1 : 0,
      mission?.resultKind ?? "none",
      frontlineCell?.col ?? -1,
      frontlineCell?.row ?? -1,
      unitKey
    ].join("|");
  };

  const getSnapshot = () => {
    const mission = getMissionState?.() ?? null;
    const frontlineCell = getFrontlineCell?.() ?? null;
    const actualUnits = typeof getUnitsState === "function" ? getUnitsState() : [];
    const key = buildKey(mission, frontlineCell, actualUnits);
    if (key === lastKey && lastSnapshot) {
      return lastSnapshot;
    }
    lastKey = key;
    lastSnapshot = buildAdvisorSnapshot(tileMap, mission, frontlineCell, actualUnits);
    return lastSnapshot;
  };

  return {
    getSnapshot
  };
};
