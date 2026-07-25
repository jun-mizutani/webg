// ---------------------------------------------
// samples/maze/main.js  2026/07/25
//   Walk-through maze sample generated at runtime
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import WebgApp from "../../webg/WebgApp.js";
import EyeRig from "../../webg/EyeRig.js";
import Shape from "../../webg/Shape.js";
import SmoothShader from "../../webg/SmoothShader.js";
import Primitive from "../../webg/Primitive.js";
import Diagnostics from "../../webg/Diagnostics.js";
import FullscreenPass from "../../webg/FullscreenPass.js";
import { buildErrorPanelOptions, buildHelpPanelOptions } from "../../webg/OverlayPanelPresets.js";
import ComputeEffectPipeline from "../../webg/ComputeEffectPipeline.js?v=20260723_dof_coverage";
import CommandPalette from "../../webg/CommandPalette.js";
import { COMPUTE_EDGE_BLEND_MODES } from "../../webg/ComputeEdgePass.js";
import { DEFAULT_PLAYER_HEIGHT, DEFAULT_PLAYER_RADIUS, overlapsPlayerHeight } from "./CollisionWorld.js";
import { buildCollisionWorldFromRuntime } from "./WalkCollisionBuilder.js";

const DEBUG_MODE = "release";
const SAMPLE_LABEL = "maze";
const GUIDE_LINES = [
  "maze: runtime-generated walk-through maze",
  "Drag horizontal: turn  Drag vertical: look up/down",
  "Release drag: return pitch to level",
  "[W][S]: move forward/back  [A][D]: turn left/right",
  "[Shift]: run",
  "[5]/[6]: Toon Levels",
  "[0]: reset view  [K]: screenshot",
  "Double tap/click or [/]: command palette"
];
const DEFAULT_CLEAR_COLOR = [0.050, 0.070, 0.095, 1.0];
const EFFECT_STATE = {
  shadowEnabled: false,
  ssaoEnabled: false,
  ssrEnabled: false,
  toonEnabled: false,
  dofEnabled: false,
  bloomEnabled: false,
  edgeEnabled: true,
  edgeGeometryEnabled: true,
  toonLevels: 4,
  edgeThickness: 2,
  edgeBlendMode: "black-multiply",
  ambientStrength: 0.14,
  ambientOnly: false
};

const TURN_SPEED_DEG = 55.0;
const WALK_SPEED = 3.6;
const RUN_MULTIPLIER = 2.0;
const COLLISION_ENABLED = true;
const FIXED_LOOK_PITCH_DEG = 0.0;
const SPOT_LIGHT_RIGHT_OFFSET = 0.20;
const SPOT_LIGHT_UP_OFFSET = 0.22;
const SPOT_LIGHT_BACK_OFFSET = 0.30;
const SPOT_LIGHT_RIGHT_AIM = 0.08;
const SPOT_LIGHT_DOWN_AIM = 0.04;
const SPOT_LIGHT_NEAR = 0.05;
const SPOT_LIGHT_FAR = 42.0;
const VIEW_SHADOW_HALF_WIDTH = 18.0;
const VIEW_SHADOW_HALF_HEIGHT = 14.0;
const VIEW_SHADOW_LIGHT_DISTANCE = 36.0;
const VIEW_SHADOW_LIGHT_FAR = 72.0;
const VIEW_BASE_MARKER_SIZE = 0.30;
const VIEW_BASE_MARKER_Y_OFFSET = 0.24;
const RADAR_SIZE_CSS_PX = 168;
const RADAR_RANGE_METERS = 8.0;
const RADAR_GRID_STEP_METERS = 4.0;

const MAZE_ROWS = 15;
const MAZE_COLS = 15;
const MAZE_SEED = 20260707;
const CELL_SIZE = 2.5;
const WALL_THICKNESS = 0.1;
const WALL_HEIGHT = 3.0;
const CEILING_THICKNESS = 0.1;
const FLOOR_THICKNESS = 0.1;
const EYE_HEIGHT = 1.6;
const ROOM_MIN_CELLS = 2;
const ROOM_MAX_CELLS = 3;
const ROOM_ATTEMPTS = 20;
const ROOM_TARGET_COUNT = 5;
const ROOM_DOOR_WIDTH = 2.0;
const ROOM_DOOR_HEIGHT = 2.4;
const ROOM_DOOR_TOP_HEIGHT = 0.55;
const ROOM_DOOR_TOP_GAP = 0.05;
const MAZE_OUTER_DOOR_WIDTH = 2.0;
const MAZE_OUTER_DOOR_HEIGHT = 2.4;
const FLOOR_COLORS = Object.freeze({
  corridor: [0.33, 0.39, 0.45, 1.0],
  room: [0.49, 0.38, 0.31, 1.0],
  start: [0.22, 0.48, 0.33, 1.0],
  goal: [0.55, 0.40, 0.16, 1.0]
});
const WALL_COLOR = [0.79, 0.83, 0.88, 1.0];
const CEILING_COLOR = [0.56, 0.61, 0.67, 1.0];
const VIEW_BASE_FLOOR_ID = "1f";
const VIEW_BASE_MARKER_NAME = "maze_view_base_marker";

const SPOT_STATE = {
  fovDeg: 70.0,
  innerDeg: 40.0,
  outerDeg: 50.0
};

let app = null;
let eyeRig = null;
let pipeline = null;
let copyPass = null;
let commandPalette = null;
let collisionWorld = null;
let collisionStats = null;
let viewBaseMarkerNode = null;
let radarCanvas = null;
let radarContext = null;
let totalTriangles = 0;
let visibleTriangles = 0;
let screenshotName = "";
let lastHelpText = "";
let lastHelpUpdateMs = 0;
let loadingStartedAtMs = 0;
let loadingStage = "waiting";
let runtime = { shapes: [] };
let viewerSize = {
  minx: 0.0,
  miny: 0.0,
  minz: 0.0,
  maxx: 0.0,
  maxy: 0.0,
  maxz: 0.0,
  centerx: 0.0,
  centery: 0.0,
  centerz: 0.0,
  max: 10.0
};
let initialViewState = null;
let mazeState = null;
let currentSpotLight = {
  position: [0.0, 0.0, 0.0],
  direction: [0.0, 0.0, -1.0]
};

// `mulberry32`は受け取った値を処理し、後続処理で利用する状態または結果を生成する
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng, minInclusive, maxInclusive) {
  return minInclusive + Math.floor(rng() * (maxInclusive - minInclusive + 1));
}

// `shuffleInPlace`は受け取った値を処理し、後続処理で利用する状態または結果を生成する
function shuffleInPlace(rng, values) {
  for (let i = values.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = values[i];
    values[i] = values[j];
    values[j] = tmp;
  }
  return values;
}

// `triangles`を現在の入力と状態から求め、呼び出し元へ返す
function countTriangles(shapes) {
  let total = 0;
  for (let i = 0; i < shapes.length; i += 1) {
    total += shapes[i]?.getTriangleCount?.() ?? 0;
  }
  return total;
}

// `viewer`のサイズを入力値から計算し、後続処理で使える結果を返す
function computeViewerSize(shapes) {
  if (!Array.isArray(shapes) || shapes.length === 0) {
    return {
      minx: -1.0,
      miny: 0.0,
      minz: -1.0,
      maxx: 1.0,
      maxy: 2.0,
      maxz: 1.0,
      centerx: 0.0,
      centery: 1.0,
      centerz: 0.0,
      max: 2.0
    };
  }
  let minx = Number.POSITIVE_INFINITY;
  let miny = Number.POSITIVE_INFINITY;
  let minz = Number.POSITIVE_INFINITY;
  let maxx = Number.NEGATIVE_INFINITY;
  let maxy = Number.NEGATIVE_INFINITY;
  let maxz = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < shapes.length; i += 1) {
    const box = shapes[i]?.getBoundingBox?.();
    if (!box) {
      continue;
    }
    minx = Math.min(minx, Number(box.minx));
    miny = Math.min(miny, Number(box.miny));
    minz = Math.min(minz, Number(box.minz));
    maxx = Math.max(maxx, Number(box.maxx));
    maxy = Math.max(maxy, Number(box.maxy));
    maxz = Math.max(maxz, Number(box.maxz));
  }
  const sizex = maxx - minx;
  const sizey = maxy - miny;
  const sizez = maxz - minz;
  return {
    minx,
    miny,
    minz,
    maxx,
    maxy,
    maxz,
    centerx: (minx + maxx) * 0.5,
    centery: (miny + maxy) * 0.5,
    centerz: (minz + maxz) * 0.5,
    max: Math.max(sizex, sizey, sizez)
  };
}

// 材質を生成し、後続処理で利用できる状態にする
function makeMaterial(color, options = {}) {
  return {
    color,
    ambient: options.ambient ?? 0.22,
    specular: options.specular ?? 0.16,
    power: options.power ?? 24.0,
    roughness: options.roughness ?? 0.72,
    metallic: options.metallic ?? 0.0,
    emissive: options.emissive ?? 0.0,
    flat_shading: options.flatShading ?? 1
  };
}

// `cuboid`の形状を対象へ追加し、後続処理から参照できるようにする
function addCuboidShape(name, position, size, materialOptions = {}) {
  const shape = new Shape(app.getGPU());
  shape.setName(name);
  shape.applyPrimitiveAsset(Primitive.cuboid(size[0], size[1], size[2], shape.getPrimitiveOptions()));
  shape.endShape();
  shape.setMaterial("smooth-shader", makeMaterial(materialOptions.color, materialOptions));
  const node = app.space.addNode(null, name);
  node.setPosition(...position);
  node.addShape(shape);
  runtime.shapes.push(shape);
  return { node, shape };
}

// `cell`を生成し、後続処理で利用できる状態にする
function makeCell(row, col) {
  return {
    row,
    col,
    visited: false,
    kind: "corridor",
    roomId: null,
    walls: { n: true, e: true, s: true, w: true }
  };
}

// `cell`の`grid`を生成し、後続処理で利用できる状態にする
function createCellGrid(rows, cols) {
  const cells = [];
  for (let row = 0; row < rows; row += 1) {
    const line = [];
    for (let col = 0; col < cols; col += 1) {
      line.push(makeCell(row, col));
    }
    cells.push(line);
  }
  return cells;
}

// `carveBaseMaze`は現在の進行状態に必要な要素を生成または配置する
function carveBaseMaze(cells, rng) {
  const rows = cells.length;
  const cols = cells[0].length;
  const stack = [];
  const start = cells[0][0];
  start.visited = true;
  stack.push(start);

  const dirs = [
    { key: "n", opposite: "s", dr: -1, dc: 0 },
    { key: "e", opposite: "w", dr: 0, dc: 1 },
    { key: "s", opposite: "n", dr: 1, dc: 0 },
    { key: "w", opposite: "e", dr: 0, dc: -1 }
  ];

  while (stack.length > 0) {
    const current = stack[stack.length - 1];
    const nextChoices = [];
    for (let i = 0; i < dirs.length; i += 1) {
      const dir = dirs[i];
      const nr = current.row + dir.dr;
      const nc = current.col + dir.dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) {
        continue;
      }
      const next = cells[nr][nc];
      if (!next.visited) {
        nextChoices.push({ dir, next });
      }
    }
    if (nextChoices.length === 0) {
      stack.pop();
      continue;
    }
    const picked = nextChoices[Math.floor(rng() * nextChoices.length)];
    current.walls[picked.dir.key] = false;
    picked.next.walls[picked.dir.opposite] = false;
    picked.next.visited = true;
    stack.push(picked.next);
  }
}

// `areaOverlapsRoom`は入力条件や交差状態を比較し、判定結果を返す
function areaOverlapsRoom(rooms, row, col, height, width) {
  for (let i = 0; i < rooms.length; i += 1) {
    const room = rooms[i];
    const separated =
      row + height <= room.row ||
      room.row + room.height <= row ||
      col + width <= room.col ||
      room.col + room.width <= col;
    if (!separated) {
      return true;
    }
  }
  return false;
}

// `carveRoom`は現在の進行状態に必要な要素を生成または配置する
function carveRoom(cells, room) {
  for (let row = room.row; row < room.row + room.height; row += 1) {
    for (let col = room.col; col < room.col + room.width; col += 1) {
      const cell = cells[row][col];
      cell.kind = "room";
      cell.roomId = room.id;
      if (col + 1 < room.col + room.width) {
        cell.walls.e = false;
        cells[row][col + 1].walls.w = false;
      }
      if (row + 1 < room.row + room.height) {
        cell.walls.s = false;
        cells[row + 1][col].walls.n = false;
      }
    }
  }
}

// `room`の`door`の`candidates`を現在の入力と状態から求め、呼び出し元へ返す
function collectRoomDoorCandidates(cells, room) {
  const candidates = [];
  for (let row = room.row; row < room.row + room.height; row += 1) {
    const westCol = room.col;
    if (westCol > 0) {
      candidates.push({
        row,
        col: westCol,
        side: "w",
        outsideRow: row,
        outsideCol: westCol - 1
      });
    }
    const eastCol = room.col + room.width - 1;
    if (eastCol < MAZE_COLS - 1) {
      candidates.push({
        row,
        col: eastCol,
        side: "e",
        outsideRow: row,
        outsideCol: eastCol + 1
      });
    }
  }
  for (let col = room.col; col < room.col + room.width; col += 1) {
    const northRow = room.row;
    if (northRow > 0) {
      candidates.push({
        row: northRow,
        col,
        side: "n",
        outsideRow: northRow - 1,
        outsideCol: col
      });
    }
    const southRow = room.row + room.height - 1;
    if (southRow < MAZE_ROWS - 1) {
      candidates.push({
        row: southRow,
        col,
        side: "s",
        outsideRow: southRow + 1,
        outsideCol: col
      });
    }
  }
  return candidates;
}

// `wall`の`between`を対象から切り離し、関連する参照を整理する
function removeWallBetween(cells, row, col, side) {
  const cell = cells[row][col];
  if (side === "n") {
    cell.walls.n = false;
    cells[row - 1][col].walls.s = false;
  } else if (side === "e") {
    cell.walls.e = false;
    cells[row][col + 1].walls.w = false;
  } else if (side === "s") {
    cell.walls.s = false;
    cells[row + 1][col].walls.n = false;
  } else if (side === "w") {
    cell.walls.w = false;
    cells[row][col - 1].walls.e = false;
  }
}

function verticalBoundaryKey(row, boundaryCol) {
  return `v:${row}:${boundaryCol}`;
}

function horizontalBoundaryKey(boundaryRow, col) {
  return `h:${boundaryRow}:${col}`;
}

// `overlayRooms`は現在の進行状態に必要な要素を生成または配置する
function overlayRooms(cells, rng) {
  const rooms = [];
  const doorways = new Map();
  for (let attempt = 0; attempt < ROOM_ATTEMPTS && rooms.length < ROOM_TARGET_COUNT; attempt += 1) {
    const width = randInt(rng, ROOM_MIN_CELLS, ROOM_MAX_CELLS);
    const height = randInt(rng, ROOM_MIN_CELLS, ROOM_MAX_CELLS);
    const row = randInt(rng, 1, MAZE_ROWS - height - 1);
    const col = randInt(rng, 1, MAZE_COLS - width - 1);
    if (areaOverlapsRoom(rooms, row, col, height, width)) {
      continue;
    }
    const room = {
      id: `room-${rooms.length + 1}`,
      row,
      col,
      width,
      height,
      doors: []
    };
    carveRoom(cells, room);
    const candidates = shuffleInPlace(rng, collectRoomDoorCandidates(cells, room));
    const doorCount = Math.min(2, Math.max(1, Math.round((room.width + room.height) / 4)));
    for (let i = 0; i < candidates.length && room.doors.length < doorCount; i += 1) {
      const candidate = candidates[i];
      const outsideCell = cells[candidate.outsideRow][candidate.outsideCol];
      if (outsideCell.roomId === room.id) {
        continue;
      }
      removeWallBetween(cells, candidate.row, candidate.col, candidate.side);
      room.doors.push(candidate);
      if (candidate.side === "w") {
        doorways.set(verticalBoundaryKey(candidate.row, candidate.col), {
          axis: "z",
          row: candidate.row,
          boundaryCol: candidate.col
        });
      } else if (candidate.side === "e") {
        doorways.set(verticalBoundaryKey(candidate.row, candidate.col + 1), {
          axis: "z",
          row: candidate.row,
          boundaryCol: candidate.col + 1
        });
      } else if (candidate.side === "n") {
        doorways.set(horizontalBoundaryKey(candidate.row, candidate.col), {
          axis: "x",
          boundaryRow: candidate.row,
          col: candidate.col
        });
      } else if (candidate.side === "s") {
        doorways.set(horizontalBoundaryKey(candidate.row + 1, candidate.col), {
          axis: "x",
          boundaryRow: candidate.row + 1,
          col: candidate.col
        });
      }
    }
    rooms.push(room);
  }
  return { rooms, doorways };
}

function cellCenterX(col) {
  return (col + 0.5) * CELL_SIZE - (MAZE_COLS * CELL_SIZE * 0.5);
}

function cellCenterZ(row) {
  return (row + 0.5) * CELL_SIZE - (MAZE_ROWS * CELL_SIZE * 0.5);
}

function wallCenterXForVerticalBoundary(boundaryCol) {
  return boundaryCol * CELL_SIZE - (MAZE_COLS * CELL_SIZE * 0.5);
}

function wallCenterZForHorizontalBoundary(boundaryRow) {
  return boundaryRow * CELL_SIZE - (MAZE_ROWS * CELL_SIZE * 0.5);
}

// `maze`の状態を生成し、後続処理で利用できる状態にする
function createMazeState() {
  const rng = mulberry32(MAZE_SEED);
  const cells = createCellGrid(MAZE_ROWS, MAZE_COLS);
  carveBaseMaze(cells, rng);
  const roomOverlay = overlayRooms(cells, rng);
  cells[0][0].kind = "start";
  cells[MAZE_ROWS - 1][MAZE_COLS - 1].kind = "goal";
  const start = { row: 0, col: 0 };
  const goal = { row: MAZE_ROWS - 1, col: MAZE_COLS - 1 };
  return {
    rng,
    cells,
    rooms: roomOverlay.rooms,
    doorways: roomOverlay.doorways,
    start,
    goal
  };
}

function getFloorColor(kind) {
  return FLOOR_COLORS[kind] ?? FLOOR_COLORS.corridor;
}

// `classifyShapeVisibility`は受け取った値を処理し、後続処理で利用する状態または結果を生成する
function classifyShapeVisibility(shape) {
  const name = String(shape?.getName?.() ?? shape?.name ?? "").toLowerCase();
  if (name.includes("_wall_")) {
    return { floor: VIEW_BASE_FLOOR_ID, part: "wall" };
  }
  if (name.includes("_column_")) {
    return { floor: VIEW_BASE_FLOOR_ID, part: "column" };
  }
  if (name.includes("_floor_")) {
    return { floor: VIEW_BASE_FLOOR_ID, part: "floor" };
  }
  if (name.includes("_roof_") || name.includes("_ceiling_")) {
    return { floor: VIEW_BASE_FLOOR_ID, part: "roof" };
  }
  return { floor: VIEW_BASE_FLOOR_ID, part: "misc" };
}

// `use`の形状の`for`の衝突の条件を判定し、結果を真偽値で返す
function shouldUseShapeForCollision(shape, meta) {
  if (!shape || !meta) {
    return false;
  }
  return meta.floor === VIEW_BASE_FLOOR_ID && meta.part !== "floor" && meta.part !== "roof";
}

// 衝突のワールドを現在の入力と実行状態に合わせて更新する
function rebuildCollisionWorld() {
  const result = buildCollisionWorldFromRuntime(runtime, {
    floorId: VIEW_BASE_FLOOR_ID,
    classifyShape: classifyShapeVisibility,
    filterShape: (shape, meta) => shouldUseShapeForCollision(shape, meta)
  });
  collisionWorld = result.world;
  collisionStats = result.stats;
}

// `initial`の表示の状態を生成し、後続処理で利用できる状態にする
function buildInitialViewState() {
  const startX = cellCenterX(mazeState.start.col);
  const startZ = cellCenterZ(mazeState.start.row);
  return {
    position: [startX, 0.0, startZ],
    bodyYaw: 90.0,
    bodyPitch: 0.0,
    bodyRoll: 0.0,
    lookYaw: 0.0,
    lookPitch: FIXED_LOOK_PITCH_DEG,
    lookRoll: 0.0,
    eyeHeight: EYE_HEIGHT
  };
}

// 床の`tiles`を生成し、後続処理で利用できる状態にする
function createFloorTiles() {
  let floorIndex = 0;
  for (let row = 0; row < MAZE_ROWS; row += 1) {
    for (let col = 0; col < MAZE_COLS; col += 1) {
      const cell = mazeState.cells[row][col];
      addCuboidShape(
        `1f_floor_${cell.kind}_${floorIndex}`,
        [cellCenterX(col), -FLOOR_THICKNESS * 0.5, cellCenterZ(row)],
        [CELL_SIZE, FLOOR_THICKNESS, CELL_SIZE],
        {
          color: getFloorColor(cell.kind),
          ambient: 0.24,
          specular: 0.10,
          power: 18.0,
          roughness: 0.88
        }
      );
      floorIndex += 1;
    }
  }
}

// `ceiling`を生成し、後続処理で利用できる状態にする
function createCeiling() {
  addCuboidShape(
    "1f_roof_main",
    [0.0, WALL_HEIGHT + CEILING_THICKNESS * 0.5, 0.0],
    [MAZE_COLS * CELL_SIZE, CEILING_THICKNESS, MAZE_ROWS * CELL_SIZE],
    {
      color: CEILING_COLOR,
      ambient: 0.18,
      specular: 0.08,
      power: 12.0,
      roughness: 0.94
    }
  );
}

// `doorway`の`wall`を対象へ追加し、後続処理から参照できるようにする
function addDoorwayWall(nameBase, axis, center, spanLength, options = {}) {
  const doorWidth = options.doorWidth ?? ROOM_DOOR_WIDTH;
  const doorHeight = options.doorHeight ?? ROOM_DOOR_HEIGHT;
  const lintelHeight = options.lintelHeight ?? ROOM_DOOR_TOP_HEIGHT;
  const sideLength = Math.max(0.0, (spanLength - doorWidth) * 0.5);
  const lintelBottom = WALL_HEIGHT - lintelHeight - ROOM_DOOR_TOP_GAP;
  const lintelCenterY = lintelBottom + lintelHeight * 0.5;
  const sideHeight = WALL_HEIGHT;
  const sideCenterY = sideHeight * 0.5;

  if (axis === "x") {
    if (sideLength > 1.0e-6) {
      addCuboidShape(`${nameBase}_left`, [center[0] - (doorWidth + sideLength) * 0.5, sideCenterY, center[2]], [sideLength, sideHeight, WALL_THICKNESS], { color: WALL_COLOR });
      addCuboidShape(`${nameBase}_right`, [center[0] + (doorWidth + sideLength) * 0.5, sideCenterY, center[2]], [sideLength, sideHeight, WALL_THICKNESS], { color: WALL_COLOR });
    }
    addCuboidShape(`${nameBase}_top`, [center[0], lintelCenterY, center[2]], [doorWidth, lintelHeight, WALL_THICKNESS], { color: WALL_COLOR });
  } else {
    if (sideLength > 1.0e-6) {
      addCuboidShape(`${nameBase}_left`, [center[0], sideCenterY, center[2] - (doorWidth + sideLength) * 0.5], [WALL_THICKNESS, sideHeight, sideLength], { color: WALL_COLOR });
      addCuboidShape(`${nameBase}_right`, [center[0], sideCenterY, center[2] + (doorWidth + sideLength) * 0.5], [WALL_THICKNESS, sideHeight, sideLength], { color: WALL_COLOR });
    }
    addCuboidShape(`${nameBase}_top`, [center[0], lintelCenterY, center[2]], [WALL_THICKNESS, lintelHeight, doorWidth], { color: WALL_COLOR });
  }
}

// `wall`の形状を生成し、後続処理で利用できる状態にする
function createWallGeometry() {
  let segmentIndex = 0;
  const startRow = mazeState.start.row;
  const goalRow = mazeState.goal.row;

  // Outer north and south boundaries
  for (let col = 0; col < MAZE_COLS; col += 1) {
    const x = cellCenterX(col);
    const northZ = wallCenterZForHorizontalBoundary(0);
    addCuboidShape(`1f_wall_outer_n_${segmentIndex}`, [x, WALL_HEIGHT * 0.5, northZ], [CELL_SIZE, WALL_HEIGHT, WALL_THICKNESS], { color: WALL_COLOR });
    segmentIndex += 1;

    const southZ = wallCenterZForHorizontalBoundary(MAZE_ROWS);
    addCuboidShape(`1f_wall_outer_s_${segmentIndex}`, [x, WALL_HEIGHT * 0.5, southZ], [CELL_SIZE, WALL_HEIGHT, WALL_THICKNESS], { color: WALL_COLOR });
    segmentIndex += 1;
  }

  // Outer west boundary with entrance opening
  for (let row = 0; row < MAZE_ROWS; row += 1) {
    const z = cellCenterZ(row);
    const westX = wallCenterXForVerticalBoundary(0);
    if (row === startRow) {
      addDoorwayWall(`1f_wall_outer_w_${segmentIndex}`, "z", [westX, 0.0, z], CELL_SIZE, {
        doorWidth: MAZE_OUTER_DOOR_WIDTH,
        doorHeight: MAZE_OUTER_DOOR_HEIGHT,
        lintelHeight: ROOM_DOOR_TOP_HEIGHT
      });
    } else {
      addCuboidShape(`1f_wall_outer_w_${segmentIndex}`, [westX, WALL_HEIGHT * 0.5, z], [WALL_THICKNESS, WALL_HEIGHT, CELL_SIZE], { color: WALL_COLOR });
    }
    segmentIndex += 1;
  }

  // Outer east boundary with goal opening
  for (let row = 0; row < MAZE_ROWS; row += 1) {
    const z = cellCenterZ(row);
    const eastX = wallCenterXForVerticalBoundary(MAZE_COLS);
    if (row === goalRow) {
      addDoorwayWall(`1f_wall_outer_e_${segmentIndex}`, "z", [eastX, 0.0, z], CELL_SIZE, {
        doorWidth: MAZE_OUTER_DOOR_WIDTH,
        doorHeight: MAZE_OUTER_DOOR_HEIGHT,
        lintelHeight: ROOM_DOOR_TOP_HEIGHT
      });
    } else {
      addCuboidShape(`1f_wall_outer_e_${segmentIndex}`, [eastX, WALL_HEIGHT * 0.5, z], [WALL_THICKNESS, WALL_HEIGHT, CELL_SIZE], { color: WALL_COLOR });
    }
    segmentIndex += 1;
  }

  // Internal east-facing walls
  for (let row = 0; row < MAZE_ROWS; row += 1) {
    for (let col = 0; col < MAZE_COLS - 1; col += 1) {
      const doorway = mazeState.doorways.get(verticalBoundaryKey(row, col + 1)) ?? null;
      if (doorway) {
        const x = wallCenterXForVerticalBoundary(col + 1);
        const z = cellCenterZ(row);
        addDoorwayWall(`1f_wall_internal_e_${segmentIndex}`, "z", [x, 0.0, z], CELL_SIZE);
        segmentIndex += 1;
        continue;
      }
      if (!mazeState.cells[row][col].walls.e) {
        continue;
      }
      const x = wallCenterXForVerticalBoundary(col + 1);
      const z = cellCenterZ(row);
      addCuboidShape(`1f_wall_internal_e_${segmentIndex}`, [x, WALL_HEIGHT * 0.5, z], [WALL_THICKNESS, WALL_HEIGHT, CELL_SIZE], { color: WALL_COLOR });
      segmentIndex += 1;
    }
  }

  // Internal south-facing walls
  for (let row = 0; row < MAZE_ROWS - 1; row += 1) {
    for (let col = 0; col < MAZE_COLS; col += 1) {
      const doorway = mazeState.doorways.get(horizontalBoundaryKey(row + 1, col)) ?? null;
      if (doorway) {
        const x = cellCenterX(col);
        const z = wallCenterZForHorizontalBoundary(row + 1);
        addDoorwayWall(`1f_wall_internal_s_${segmentIndex}`, "x", [x, 0.0, z], CELL_SIZE);
        segmentIndex += 1;
        continue;
      }
      if (!mazeState.cells[row][col].walls.s) {
        continue;
      }
      const x = cellCenterX(col);
      const z = wallCenterZForHorizontalBoundary(row + 1);
      addCuboidShape(`1f_wall_internal_s_${segmentIndex}`, [x, WALL_HEIGHT * 0.5, z], [CELL_SIZE, WALL_HEIGHT, WALL_THICKNESS], { color: WALL_COLOR });
      segmentIndex += 1;
    }
  }
}

// `maze`のシーンを生成し、後続処理で利用できる状態にする
function buildMazeScene() {
  runtime = { shapes: [] };
  mazeState = createMazeState();
  createFloorTiles();
  createCeiling();
  createWallGeometry();
  visibleTriangles = countTriangles(runtime.shapes);
  totalTriangles = visibleTriangles;
  viewerSize = computeViewerSize(runtime.shapes);
  initialViewState = buildInitialViewState();
  rebuildCollisionWorld();
}

// 表示を初期状態へ戻し、前回の状態を残さない
function resetView() {
  eyeRig.setType("first-person");
  eyeRig.setPosition(...initialViewState.position);
  eyeRig.setAngles(
    initialViewState.bodyYaw,
    initialViewState.bodyPitch,
    initialViewState.bodyRoll
  );
  eyeRig.setEyeHeight(initialViewState.eyeHeight);
  eyeRig.setLookAngles(0.0, FIXED_LOOK_PITCH_DEG, 0.0);
  eyeRig.apply(true);
  updateViewBaseMarker();
}

// 表示の`base`の`marker`を生成し、後続処理で利用できる状態にする
function createViewBaseMarker() {
  const shape = new Shape(app.getGPU());
  shape.setName(VIEW_BASE_MARKER_NAME);
  shape.applyPrimitiveAsset(Primitive.cube(VIEW_BASE_MARKER_SIZE, shape.getPrimitiveOptions()));
  shape.endShape();
  shape.setMaterial("smooth-shader", {
    color: [1.0, 0.04, 0.02, 1.0],
    specular: 0.20,
    roughness: 0.55,
    metallic: 0.0,
    emissive: 0.0,
    flat_shading: 1
  });
  const node = app.space.addNode(null, VIEW_BASE_MARKER_NAME);
  node.addShape(shape);
  return node;
}

// 表示の`base`の`marker`を現在の入力と実行状態に合わせて更新する
function updateViewBaseMarker() {
  if (!viewBaseMarkerNode || !eyeRig?.firstPerson) {
    return;
  }
  const position = eyeRig.firstPerson.position;
  viewBaseMarkerNode.setPosition(
    position[0],
    position[1] + VIEW_BASE_MARKER_Y_OFFSET,
    position[2]
  );
}

// `radar`の重ね合わせ表示を生成し、後続処理で利用できる状態にする
function createRadarOverlay() {
  const canvas = document.createElement("canvas");
  canvas.id = "maze-radar";
  canvas.width = RADAR_SIZE_CSS_PX;
  canvas.height = RADAR_SIZE_CSS_PX;
  canvas.style.position = "fixed";
  canvas.style.top = "14px";
  canvas.style.right = "calc(var(--webg-canvas-right-inset, 0px) + 14px)";
  canvas.style.width = `${RADAR_SIZE_CSS_PX}px`;
  canvas.style.height = `${RADAR_SIZE_CSS_PX}px`;
  canvas.style.border = "1px solid rgba(220, 238, 232, 0.72)";
  canvas.style.borderRadius = "14px";
  canvas.style.background = "rgba(7, 16, 20, 0.72)";
  canvas.style.boxShadow = "0 10px 28px rgba(0, 0, 0, 0.35)";
  canvas.style.pointerEvents = "none";
  canvas.style.zIndex = "24";
  document.body.appendChild(canvas);
  radarCanvas = canvas;
  radarContext = canvas.getContext("2d");
}

// `resizeRadarCanvas`は表示領域に合わせて関連する寸法と描画先を更新する
function resizeRadarCanvas() {
  if (!radarCanvas) {
    return;
  }
  const dpr = Math.max(1.0, window.devicePixelRatio || 1.0);
  const width = Math.round(RADAR_SIZE_CSS_PX * dpr);
  const height = Math.round(RADAR_SIZE_CSS_PX * dpr);
  if (radarCanvas.width !== width || radarCanvas.height !== height) {
    radarCanvas.width = width;
    radarCanvas.height = height;
  }
  radarContext?.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// `worldDeltaToRadar`は座標または数値を計算し、後続処理で使う結果を返す
function worldDeltaToRadar(dx, dz, forwardX, forwardZ, scale, center) {
  const rightX = -forwardZ;
  const rightZ = forwardX;
  const radarX = dx * rightX + dz * rightZ;
  const radarY = dx * forwardX + dz * forwardZ;
  return [
    center + radarX * scale,
    center - radarY * scale
  ];
}

// `radar`の重ね合わせ表示を現在の入力と実行状態に合わせて更新する
function updateRadarOverlay() {
  if (!radarCanvas || !radarContext || !eyeRig?.firstPerson || !app?.eye) {
    return;
  }
  resizeRadarCanvas();
  const ctx = radarContext;
  const size = RADAR_SIZE_CSS_PX;
  const center = size * 0.5;
  const radius = size * 0.5 - 14;
  const scale = radius / RADAR_RANGE_METERS;
  const player = eyeRig.firstPerson.position;
  const playerCollision = {
    x: player[0],
    y: player[1],
    z: player[2],
    radius: DEFAULT_PLAYER_RADIUS,
    height: DEFAULT_PLAYER_HEIGHT
  };

  app.eye.setWorldMatrix();
  const cameraForward = app.eye.worldMatrix.mul3x3Vector([0.0, 0.0, -1.0]);
  const horizontalLength = Math.hypot(cameraForward[0], cameraForward[2]);
  if (horizontalLength <= 1.0e-9) {
    throw new Error("maze radar requires camera forward to have an XZ component");
  }
  const forwardX = cameraForward[0] / horizontalLength;
  const forwardZ = cameraForward[2] / horizontalLength;

  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.beginPath();
  ctx.arc(center, center, radius + 8, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = "rgba(8, 18, 22, 0.86)";
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = "rgba(176, 210, 202, 0.16)";
  ctx.lineWidth = 1;
  for (let m = RADAR_GRID_STEP_METERS; m < RADAR_RANGE_METERS; m += RADAR_GRID_STEP_METERS) {
    ctx.beginPath();
    ctx.arc(center, center, m * scale, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(center, center - radius);
  ctx.lineTo(center, center + radius);
  ctx.moveTo(center - radius, center);
  ctx.lineTo(center + radius, center);
  ctx.stroke();

  const segments = collisionWorld?.segments ?? [];
  ctx.strokeStyle = "rgba(230, 238, 232, 0.78)";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  for (const segment of segments) {
    if (!overlapsPlayerHeight(playerCollision, segment)) {
      continue;
    }
    const ax = segment.ax - player[0];
    const az = segment.az - player[2];
    const bx = segment.bx - player[0];
    const bz = segment.bz - player[2];
    const nearA = Math.hypot(ax, az) <= RADAR_RANGE_METERS * 1.25;
    const nearB = Math.hypot(bx, bz) <= RADAR_RANGE_METERS * 1.25;
    if (!nearA && !nearB) {
      continue;
    }
    const a = worldDeltaToRadar(ax, az, forwardX, forwardZ, scale, center);
    const b = worldDeltaToRadar(bx, bz, forwardX, forwardZ, scale, center);
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
  }
  ctx.stroke();

  ctx.fillStyle = "rgba(255, 82, 64, 0.95)";
  ctx.beginPath();
  ctx.moveTo(center, center - 9);
  ctx.lineTo(center - 6, center + 7);
  ctx.lineTo(center + 6, center + 7);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = "rgba(220, 238, 232, 0.65)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(center, center, radius + 8, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "rgba(229, 245, 240, 0.92)";
  ctx.font = "12px sans-serif";
  ctx.fillText("MAP 1F", 12, 20);
  ctx.fillStyle = "rgba(229, 245, 240, 0.68)";
  ctx.fillText(`${RADAR_RANGE_METERS.toFixed(0)}m`, 12, size - 12);
}

// `turn`の入力を現在の入力と実行状態に合わせて更新する
function updateTurnInput(deltaSec) {
  const dt = Number.isFinite(deltaSec) ? deltaSec : 0.0;
  if (dt <= 0.0 || !app?.input || !eyeRig) {
    return;
  }
  let yawDelta = 0.0;
  if (app.input.has("a")) yawDelta -= TURN_SPEED_DEG * dt;
  if (app.input.has("d")) yawDelta += TURN_SPEED_DEG * dt;
  if (yawDelta === 0.0) {
    return;
  }
  eyeRig.firstPerson.bodyYaw += yawDelta;
  eyeRig.apply(true);
}

// `drag`の`look`を現在の入力と実行状態に合わせて更新する
function updateDragLook() {
  if (!eyeRig) {
    return;
  }
  const state = eyeRig.firstPerson;
  const yawChanged = Math.abs(state.lookYaw) > 1.0e-9;
  const pitchChanged = Math.abs(state.lookPitch - FIXED_LOOK_PITCH_DEG) > 1.0e-9;
  const rollChanged = Math.abs(state.lookRoll) > 1.0e-9;
  const shouldResetPitch = !eyeRig.dragging && pitchChanged;
  if (!yawChanged && !shouldResetPitch && !rollChanged) {
    return;
  }
  state.bodyYaw += state.lookYaw;
  state.lookYaw = 0.0;
  if (shouldResetPitch) {
    state.lookPitch = FIXED_LOOK_PITCH_DEG;
  }
  state.lookRoll = 0.0;
  eyeRig.apply(true);
}

// `walk`の`movement`を現在の入力と実行状態に合わせて更新する
function updateWalkMovement(deltaSec) {
  const dt = Number.isFinite(deltaSec) ? deltaSec : 0.0;
  if (dt <= 0.0 || !app?.input || !eyeRig) {
    return;
  }
  const directionInput = Number(app.input.has("w")) - Number(app.input.has("s"));
  if (directionInput === 0.0) {
    return;
  }
  eyeRig.apply(true);
  const cameraForward = app.eye.getWorldMatrix().mul3x3Vector([0.0, 0.0, -1.0]);
  const horizontalLength = Math.hypot(cameraForward[0], cameraForward[2]);
  if (horizontalLength <= 1.0e-9) {
    throw new Error("maze camera forward direction must have an XZ component");
  }
  const runScale = app.input.has("shift") ? RUN_MULTIPLIER : 1.0;
  const distance = WALK_SPEED * runScale * dt * directionInput;
  const dx = cameraForward[0] / horizontalLength * distance;
  const dz = cameraForward[2] / horizontalLength * distance;
  if (COLLISION_ENABLED && collisionWorld) {
    const player = {
      x: eyeRig.firstPerson.position[0],
      y: eyeRig.firstPerson.position[1],
      z: eyeRig.firstPerson.position[2],
      radius: DEFAULT_PLAYER_RADIUS,
      height: DEFAULT_PLAYER_HEIGHT
    };
    collisionWorld.resolvePlayerMove(player, dx, dz);
    eyeRig.firstPerson.position[0] = player.x;
    eyeRig.firstPerson.position[2] = player.z;
  } else {
    eyeRig.firstPerson.position[0] += dx;
    eyeRig.firstPerson.position[2] += dz;
  }
  eyeRig.apply(true);
}

// WebgAppはcamera effect適用時にapp.camera.targetをcameraRigへ反映するため、
// sample所有のfirst-person EyeRig位置をframe snapshot生成前に同じtargetへ同期する
function syncFirstPersonCameraTarget() {
  const position = eyeRig.firstPerson.position;
  app.camera.target[0] = position[0];
  app.camera.target[1] = position[1];
  app.camera.target[2] = position[2];
}

// `displayed`の`yaw`の`deg`を現在の入力と状態から求め、呼び出し元へ返す
function getDisplayedYawDeg(bodyYaw) {
  let yaw = Number(bodyYaw);
  while (yaw <= -180.0) yaw += 360.0;
  while (yaw > 180.0) yaw -= 360.0;
  return yaw;
}

// フレームの`load`の`rows`を現在の入力と状態から求め、呼び出し元へ返す
function getFrameLoadRows() {
  const timer = app?.frameTimer;
  const gpuAvailable = timer?.timestampSupported === true;
  const computeMs = Number.isFinite(timer?.gpuComputeMs) ? `${timer.gpuComputeMs.toFixed(3)} ms` : "--";
  const renderMs = Number.isFinite(timer?.gpuRenderMs) ? `${timer.gpuRenderMs.toFixed(3)} ms` : "--";
  const computeLoad = Number.isFinite(timer?.gpuComputeMs) && timer.frameIntervalMs > 0
    ? `${(timer.gpuComputeMs / timer.frameIntervalMs * 100).toFixed(1)}%`
    : (gpuAvailable ? "--" : "unavailable");
  const renderLoad = Number.isFinite(timer?.gpuRenderMs) && timer.frameIntervalMs > 0
    ? `${(timer.gpuRenderMs / timer.frameIntervalMs * 100).toFixed(1)}%`
    : (gpuAvailable ? "--" : "unavailable");
  const jsLoad = Number.isFinite(timer?.jsLoadPercent) ? `${timer.jsLoadPercent.toFixed(1)}%` : "--";
  return {
    compute: `${computeMs} / ${computeLoad}`,
    render: `${renderMs} / ${renderLoad}`,
    js: jsLoad
  };
}

// `vec3`を検証し、後続処理が扱える共通形式へ整える
function normalizeVec3(value, label) {
  const length = Math.hypot(value[0], value[1], value[2]);
  if (length <= 1.0e-8) {
    throw new Error(`${label} must not be zero`);
  }
  return [value[0] / length, value[1] / length, value[2] / length];
}

// 表示の`locked`の光源を現在の入力と実行状態に合わせて更新する
function updateViewLockedLight() {
  if (!app?.eye) {
    return;
  }
  app.eye.setWorldMatrix();
  const eyeWorld = app.eye.worldMatrix;
  const right = eyeWorld.mul3x3Vector([1.0, 0.0, 0.0]);
  const up = eyeWorld.mul3x3Vector([0.0, 1.0, 0.0]);
  const forward = eyeWorld.mul3x3Vector([0.0, 0.0, -1.0]);
  const eyePosition = app.eye.getWorldPosition();
  const lightPosition = [
    eyePosition[0] + right[0] * SPOT_LIGHT_RIGHT_OFFSET + up[0] * SPOT_LIGHT_UP_OFFSET - forward[0] * SPOT_LIGHT_BACK_OFFSET,
    eyePosition[1] + right[1] * SPOT_LIGHT_RIGHT_OFFSET + up[1] * SPOT_LIGHT_UP_OFFSET - forward[1] * SPOT_LIGHT_BACK_OFFSET,
    eyePosition[2] + right[2] * SPOT_LIGHT_RIGHT_OFFSET + up[2] * SPOT_LIGHT_UP_OFFSET - forward[2] * SPOT_LIGHT_BACK_OFFSET
  ];
  const lightDirection = normalizeVec3([
    forward[0] + right[0] * SPOT_LIGHT_RIGHT_AIM - up[0] * SPOT_LIGHT_DOWN_AIM,
    forward[1] + right[1] * SPOT_LIGHT_RIGHT_AIM - up[1] * SPOT_LIGHT_DOWN_AIM,
    forward[2] + right[2] * SPOT_LIGHT_RIGHT_AIM - up[2] * SPOT_LIGHT_DOWN_AIM
  ], "maze spot light aim");
  currentSpotLight = {
    position: lightPosition,
    direction: lightDirection
  };
}

// `spot`の影の設定値を現在の入力と状態から求め、呼び出し元へ返す
function getSpotShadowOptions() {
  return {
    type: "spot",
    ambient: EFFECT_STATE.ambientStrength,
    pcfRadius: 2,
    spot: {
      position: currentSpotLight.position,
      direction: currentSpotLight.direction,
      fov: SPOT_STATE.fovDeg,
      innerAngle: SPOT_STATE.innerDeg,
      outerAngle: SPOT_STATE.outerDeg,
      near: SPOT_LIGHT_NEAR,
      far: SPOT_LIGHT_FAR,
      aspect: 1.0
    }
  };
}

// HUDの`rows`を現在の入力と実行状態に合わせて更新する
function updateHudRows() {
  const load = getFrameLoadRows();
  const firstPerson = eyeRig?.firstPerson;
  app.setHudRows(app.isDebugUiEnabled() ? [
    { line: "maze" },
    {
      label: "Seed",
      value: String(MAZE_SEED),
      note: `${MAZE_ROWS}x${MAZE_COLS} cells`
    },
    {
      label: "Pos",
      value: `${firstPerson.position[0].toFixed(1)}, ${firstPerson.position[1].toFixed(1)}, ${firstPerson.position[2].toFixed(1)}`,
      note: `eyeHeight=${firstPerson.eyeHeight.toFixed(1)}`
    },
    {
      label: "Look",
      value: `yaw=${getDisplayedYawDeg(firstPerson.bodyYaw).toFixed(1)}`,
      note: `lookYaw=${firstPerson.lookYaw.toFixed(1)} pitch=${firstPerson.lookPitch.toFixed(1)}`
    },
    {
      label: "Maze",
      value: `rooms=${mazeState?.rooms?.length ?? 0}`,
      note: `corridor=${(CELL_SIZE - WALL_THICKNESS).toFixed(2)}m clear`
    },
    {
      label: "Collision",
      value: `${collisionStats?.segmentCount ?? 0} seg / 1F`,
      note: `cand=${collisionWorld?.lastCandidateCount ?? 0} hit=${collisionWorld?.lastHitCount ?? 0}`
    },
    {
      label: "Effect",
      value: `Toon ${EFFECT_STATE.toonEnabled ? `ON ${EFFECT_STATE.toonLevels}` : "OFF"} Edge ${EFFECT_STATE.edgeEnabled ? "ON" : "OFF"}`,
      note: `spot ambient=${EFFECT_STATE.ambientOnly ? "only" : EFFECT_STATE.ambientStrength.toFixed(2)} ${EFFECT_STATE.edgeBlendMode}`
    },
    { label: "Shot", value: screenshotName || "-", note: "K to save" },
    { label: "GPU Compute", value: load.compute },
    { label: "GPU Render", value: load.render },
    { label: "JS Load", value: load.js },
    { line: "Drag yaw/pitch  W/S move  A/D turn  Shift run  0 reset" }
  ] : [], {
    anchor: "top-left",
    x: 0,
    y: 0,
    color: [0.92, 0.96, 1.0],
    minScale: 0.78
  });
}

// ヘルプの行を生成し、後続処理で利用できる状態にする
function buildHelpLines() {
  const firstPerson = eyeRig?.firstPerson ?? {
    position: [0.0, 0.0, 0.0],
    bodyYaw: 0.0,
    lookYaw: 0.0,
    lookPitch: 0.0
  };
  return [
    ...GUIDE_LINES,
    `Seed=${MAZE_SEED} Grid=${MAZE_ROWS}x${MAZE_COLS} Cell=${CELL_SIZE.toFixed(2)}m Rooms=${mazeState?.rooms?.length ?? 0}`,
    `Doorway=${ROOM_DOOR_WIDTH.toFixed(2)}m x ${ROOM_DOOR_HEIGHT.toFixed(2)}m Ceiling=${WALL_HEIGHT.toFixed(2)}m + ${CEILING_THICKNESS.toFixed(2)}m`,
    `Toon=${EFFECT_STATE.toonEnabled ? `ON (${EFFECT_STATE.toonLevels} levels)` : "OFF"} Edge=${EFFECT_STATE.edgeEnabled ? `ON (${EFFECT_STATE.edgeThickness})` : "OFF"} Ambient=${EFFECT_STATE.ambientOnly ? "ONLY" : EFFECT_STATE.ambientStrength.toFixed(2)} Blend=${EFFECT_STATE.edgeBlendMode}`,
    `Light=VIEW SPOT fov=${SPOT_STATE.fovDeg.toFixed(0)} inner=${SPOT_STATE.innerDeg.toFixed(0)} outer=${SPOT_STATE.outerDeg.toFixed(0)}`,
    `Position=${firstPerson.position.map((value) => value.toFixed(2)).join(", ")}`,
    `Yaw=${getDisplayedYawDeg(firstPerson.bodyYaw).toFixed(1)} LookYaw=${firstPerson.lookYaw.toFixed(1)} LookPitch=${firstPerson.lookPitch.toFixed(1)}`,
    `Collision=${collisionStats?.segmentCount ?? 0} segments Candidates=${collisionWorld?.lastCandidateCount ?? 0} Hits=${collisionWorld?.lastHitCount ?? 0}`,
    `VisibleTris=${visibleTriangles} Screenshot=${screenshotName || "-"}`,
    ...(app?.getFrameTimingLines?.() ?? [])
  ];
}

// ヘルプのパネルを現在の入力と実行状態に合わせて更新する
function updateHelpPanel() {
  const panel = app?.getOverlayPanel?.("mazeHelp");
  if (!panel) {
    return;
  }
  const lines = buildHelpLines();
  const nextText = lines.join("\n");
  if (nextText === lastHelpText) {
    return;
  }
  app.updateOverlayPanel("mazeHelp", { lines });
  lastHelpText = nextText;
}

// `loading`のパネルを現在の入力と実行状態に合わせて更新する
function updateLoadingPanel(stage) {
  loadingStage = String(stage ?? loadingStage);
  const elapsedMs = loadingStartedAtMs > 0 ? Math.max(0, performance.now() - loadingStartedAtMs) : 0;
  app?.showOverlayPanel?.({
    id: "mazeLoading",
    title: "Loading maze",
    text: [
      "Generating the runtime maze scene.",
      "This sample builds the walk-through geometry from a fixed seed.",
      "",
      `stage=${loadingStage}`,
      `elapsedMs=${Math.round(elapsedMs)}`
    ].join("\n"),
    anchor: "top-left",
    offsetX: 14,
    offsetY: 14,
    format: "pre",
    scrollY: false,
    maxHeight: "none",
    color: "#fff2d7",
    background: "rgba(22, 32, 26, 0.92)"
  });
}

// `takeViewerScreenshot`は現在のキャンバス画像を取得し、指定形式で保存する
function takeViewerScreenshot() {
  const file = app.takeScreenshot({ prefix: SAMPLE_LABEL });
  screenshotName = file;
  app.pushToast(`saved ${file}`, { durationMs: 1400 });
}

// 操作を対象の状態または描画設定へ反映する
function applyAction(key) {
  if (key === "0") {
    resetView();
  } else if (key === "k") {
    takeViewerScreenshot();
  } else if (key === "5") {
    EFFECT_STATE.toonLevels = Math.max(2, EFFECT_STATE.toonLevels - 1);
  } else if (key === "6") {
    EFFECT_STATE.toonLevels = Math.min(8, EFFECT_STATE.toonLevels + 1);
  }
}

// 操作パレットの`change`を対象の状態または描画設定へ反映する
function applyPaletteChange(id, value) {
  if (id === "ssao") EFFECT_STATE.ssaoEnabled = value;
  else if (id === "shadow") EFFECT_STATE.shadowEnabled = value;
  else if (id === "ssr") EFFECT_STATE.ssrEnabled = value;
  else if (id === "toon") EFFECT_STATE.toonEnabled = value;
  else if (id === "dof") EFFECT_STATE.dofEnabled = value;
  else if (id === "bloom") EFFECT_STATE.bloomEnabled = value;
  else if (id === "edge") EFFECT_STATE.edgeEnabled = value;
  else if (id === "ambient") EFFECT_STATE.ambientOnly = value;
  else if (id === "ambient-strength") EFFECT_STATE.ambientStrength = value;
  else if (id === "toon-levels") EFFECT_STATE.toonLevels = value;
  else if (id === "edge-thickness") EFFECT_STATE.edgeThickness = value;
  else if (id === "edge-blend") EFFECT_STATE.edgeBlendMode = value;
  else if (id === "spot-fov") {
    if (value <= SPOT_STATE.outerDeg) {
      app.pushToast("Spot FOV must be larger than outer angle", { durationMs: 1500 });
      return;
    }
    SPOT_STATE.fovDeg = value;
  } else if (id === "spot-inner") {
    if (value >= SPOT_STATE.outerDeg) {
      app.pushToast("Spot inner must be smaller than outer", { durationMs: 1500 });
      return;
    }
    SPOT_STATE.innerDeg = value;
  } else if (id === "spot-outer") {
    if (value <= SPOT_STATE.innerDeg || value >= SPOT_STATE.fovDeg) {
      app.pushToast("Spot outer must be between inner and FOV", { durationMs: 1500 });
      return;
    }
    SPOT_STATE.outerDeg = value;
  }
}

// 操作パレットのコマンドを対象の状態または描画設定へ反映する
function applyPaletteCommand(id) {
  if (id === "reset-view") {
    resetView();
  } else if (id === "screenshot") {
    takeViewerScreenshot();
  }
}

// コマンドの操作パレットの初期化段階で、必要な状態と資源を準備して処理を開始する
function installCommandPalette() {
  commandPalette = new CommandPalette({
    document,
    container: document.body,
    viewport: app.screen.canvas,
    title: "Maze",
    pageRows: 6,
    pageRowsByPage: [7, 5],
    closeOnCommand: false,
    onCommand: applyPaletteCommand,
    onChange: applyPaletteChange,
    commands: [
      { type: "toggle", id: "ssao", label: "SSAO", detail: "effect", value: () => EFFECT_STATE.ssaoEnabled },
      { type: "toggle", id: "shadow", label: "Shadow", detail: "effect", value: () => EFFECT_STATE.shadowEnabled },
      { type: "toggle", id: "ssr", label: "SSR", detail: "effect", value: () => EFFECT_STATE.ssrEnabled },
      { type: "toggle", id: "toon", label: "Toon", detail: "effect", value: () => EFFECT_STATE.toonEnabled },
      { type: "toggle", id: "dof", label: "DoF", detail: "effect", value: () => EFFECT_STATE.dofEnabled },
      { type: "toggle", id: "bloom", label: "Bloom", detail: "effect", value: () => EFFECT_STATE.bloomEnabled },
      { type: "toggle", id: "edge", label: "Edge", detail: "effect", value: () => EFFECT_STATE.edgeEnabled },
      { type: "toggle", id: "ambient", label: "Ambient", detail: "only", value: () => EFFECT_STATE.ambientOnly },
      { type: "stepper", id: "ambient-strength", label: "Ambient Strength", value: () => EFFECT_STATE.ambientStrength, min: 0.0, max: 1.0, step: 0.02, decimals: 2, input: true },
      { type: "stepper", id: "toon-levels", label: "Toon Levels", value: () => EFFECT_STATE.toonLevels, min: 2, max: 8, step: 1 },
      { type: "stepper", id: "edge-thickness", label: "Edge Thickness", value: () => EFFECT_STATE.edgeThickness, min: 1, max: 4, step: 1 },
      { type: "select", id: "edge-blend", label: "Edge Blend", value: () => EFFECT_STATE.edgeBlendMode, options: COMPUTE_EDGE_BLEND_MODES.map((mode) => ({ value: mode, label: mode })) },
      { id: "reset-view", label: "Reset", detail: "view" },
      { id: "screenshot", label: "Shot", detail: "save" },
      { id: "palette-next", label: "Next", detail: "effect", pageSwitch: true },
      { type: "stepper", id: "spot-fov", label: "Spot FOV", value: () => SPOT_STATE.fovDeg, min: 30, max: 120, step: 5 },
      { type: "stepper", id: "spot-inner", label: "Spot Inner", value: () => SPOT_STATE.innerDeg, min: 5, max: 110, step: 5 },
      { type: "stepper", id: "spot-outer", label: "Spot Outer", value: () => SPOT_STATE.outerDeg, min: 10, max: 115, step: 5 }
    ]
  });
  commandPalette.attachToCanvas(app.screen.canvas, { key: "/" });
}

// タッチ入力の`buttons`の初期化段階で、必要な状態と資源を準備して処理を開始する
function installTouchButtons() {
  app.input.installTouchControls({
    touchDeviceOnly: false,
    groups: [
      {
        id: "maze-move",
        buttons: [
          { key: "w", label: "W", kind: "hold", ariaLabel: "move forward" },
          { key: "a", label: "A", kind: "hold", ariaLabel: "turn left" },
          { key: "s", label: "S", kind: "hold", ariaLabel: "move backward" },
          { key: "d", label: "D", kind: "hold", ariaLabel: "turn right" }
        ]
      }
    ]
  });
}

document.addEventListener("DOMContentLoaded", () => {
  start().catch((error) => {
    app?.setDiagnosticsReport?.(Diagnostics.createErrorReport(error, {
      system: SAMPLE_LABEL,
      source: "samples/maze/main.js",
      stage: app?.getDiagnosticsReport?.()?.stage ?? "start"
    }));
    app?.showOverlayPanel?.(buildErrorPanelOptions(error, {
      title: "maze failed",
      id: "start-error",
      background: "rgba(22, 28, 36, 0.92)"
    }));
    if (app?.isConsoleEnabled?.()) {
      console.error("maze failed:", error);
    }
  });
});

// このインスタンスの初期化段階で、必要な状態と資源を準備して処理を開始する
async function start() {
  app = new WebgApp({
    document,
    shaderClass: SmoothShader,
    autoDrawScene: false,
    renderMode: "ondemand",
    frameTiming: true,
    clearColor: DEFAULT_CLEAR_COLOR,
    lightPosition: [0.0, 100.0, 1000.0, 1.0],
    viewAngle: 90.0,
    projectionNear: 0.1,
    projectionFar: 180.0,
    messageFontTexture: "../../webg/font512.png",
    debugTools: {
      mode: DEBUG_MODE,
      system: SAMPLE_LABEL,
      source: "samples/maze/main.js",
      guideLines: GUIDE_LINES,
      guideOptions: {
        anchor: "top-left",
        x: 0,
        y: 0,
        width: 48,
        wrap: true
      },
      probeDefaultAfterFrames: 1
    }
  });
  await app.init();
  loadingStartedAtMs = performance.now();
  updateLoadingPanel("generating maze");
  buildMazeScene();

  updateLoadingPanel("creating camera");
  eyeRig = new EyeRig(app.cameraRig, app.cameraRod, app.eye, {
    document,
    element: app.screen.canvas,
    input: app.input,
    type: "first-person",
    firstPerson: {
      ...initialViewState,
      moveSpeed: WALK_SPEED,
      runMultiplier: RUN_MULTIPLIER,
      dragRotateSpeed: 0.18,
      lookPitchMin: -85.0,
      lookPitchMax: 85.0,
      keyMap: {
        forward: "__unused_forward__",
        back: "__unused_back__",
        left: "__unused_left__",
        right: "__unused_right__",
        up: "__unused_up__",
        down: "__unused_down__",
        run: "shift"
      }
    }
  });
  eyeRig.attachPointer();
  resetView();

  const gpu = app.getGPU();
  viewBaseMarkerNode = createViewBaseMarker();
  updateViewBaseMarker();
  createRadarOverlay();
  updateRadarOverlay();
  updateViewLockedLight();

  updateLoadingPanel("creating compute effects");
  pipeline = new ComputeEffectPipeline(gpu, {
    label: SAMPLE_LABEL,
    width: app.screen.getWidth(),
    height: app.screen.getHeight(),
    lightTarget: [viewerSize.centerx, viewerSize.centery, viewerSize.centerz],
    lightDistance: VIEW_SHADOW_LIGHT_DISTANCE,
    lightHalfWidth: VIEW_SHADOW_HALF_WIDTH,
    lightHalfHeight: VIEW_SHADOW_HALF_HEIGHT,
    lightFar: VIEW_SHADOW_LIGHT_FAR,
    shadow: {
      ...getSpotShadowOptions()
    },
    toon: {
      floor: 0.14
    },
    edge: {
      mix: 0.40
    },
    dof: {
      focusDistance: 10.0,
      focusRange: 10.0,
      blurRadius: 3,
      blurIterations: 1,
      sampleStep: 2,
      stageSmallScale: 0.55,
      stageMediumScale: 0.40,
      stageLargeScale: 0.25
    }
  });
  copyPass = new FullscreenPass(gpu, {
    targetFormat: gpu.format
  });
  await Promise.all([pipeline.ready, copyPass.init()]);

  app.removeOverlayPanel("mazeLoading");
  const helpLines = buildHelpLines();
  app.showOverlayPanel(buildHelpPanelOptions({
    id: "mazeHelp",
    collapsed: true,
    lines: helpLines
  }));
  lastHelpText = helpLines.join("\n");

  app.attachInput({
    onKeyDown: (key, event) => {
      if (event.repeat) {
        return;
      }
      applyAction(key);
    }
  });
  installTouchButtons();
  installCommandPalette();

  app.configureDiagnosticsCapture({
    labelPrefix: SAMPLE_LABEL,
    collect: () => {
      const report = app.createProbeReport("maze-runtime-probe");
      Diagnostics.mergeStats(report, {
        shapeCount: runtime?.shapes?.length ?? 0,
        visibleTriangles,
        mazeSeed: MAZE_SEED,
        roomCount: mazeState?.rooms?.length ?? 0,
        collisionFloor: collisionStats?.floorId ?? "-",
        collisionSegments: collisionStats?.segmentCount ?? 0,
        collisionGridCells: collisionStats?.gridCellCount ?? 0,
        collisionLastCandidates: collisionWorld?.lastCandidateCount ?? 0,
        collisionLastHits: collisionWorld?.lastHitCount ?? 0
      });
      return report;
    }
  });
  app.configureDebugKeyInput();
  app.setDiagnosticsStage("runtime");

  globalThis.mazeSample = {
    getState: () => ({
      seed: MAZE_SEED,
      roomCount: mazeState?.rooms?.length ?? 0,
      visibleTriangles,
      collision: {
        enabled: COLLISION_ENABLED,
        stats: collisionStats ? { ...collisionStats } : null,
        lastCandidateCount: collisionWorld?.lastCandidateCount ?? 0,
        lastHitCount: collisionWorld?.lastHitCount ?? 0
      },
      firstPerson: {
        position: [...eyeRig.firstPerson.position],
        bodyYaw: eyeRig.firstPerson.bodyYaw,
        lookYaw: eyeRig.firstPerson.lookYaw,
        lookPitch: eyeRig.firstPerson.lookPitch
      }
    })
  };

  app.start({
    onUpdate: ({ deltaSec, screen, timeMs }) => {
      app.afterGpuSubmit();
      updateTurnInput(deltaSec);
      updateDragLook();
      updateWalkMovement(deltaSec);
      eyeRig.update(deltaSec);
      syncFirstPersonCameraTarget();
      updateViewBaseMarker();
      updateRadarOverlay();
      if (timeMs - lastHelpUpdateMs >= 500) {
        updateHelpPanel();
        lastHelpUpdateMs = timeMs;
      }
      pipeline.resize(screen.getWidth(), screen.getHeight());
      app.updateDebugProbe();
      updateHudRows();
      app.setControlRows([]);
    },
    onBeforeDraw: ({ cameraFrame }) => {
      app.beginGpuTiming();
      updateViewLockedLight();
      pipeline.renderScene(
        app.space,
        cameraFrame,
        app.clearColor,
        {
          shadowEnabled: EFFECT_STATE.shadowEnabled && !EFFECT_STATE.ambientOnly,
          ssaoEnabled: EFFECT_STATE.ssaoEnabled,
          ssrEnabled: EFFECT_STATE.ssrEnabled,
          toonEnabled: EFFECT_STATE.toonEnabled,
          edgeEnabled: true,
          edgeGeometryEnabled: EFFECT_STATE.edgeGeometryEnabled,
          forceGBuffer: true,
          shadow: getSpotShadowOptions(),
          timestampWrites: app.getGpuRenderTimestampWrites(true, true)
        }
      );
    },
    onAfterDraw3d: ({ cameraFrame }) => {
      const gpu = app.getGPU();
      gpu.endPass();

      const finalColor = pipeline.encode(gpu.commandEncoder, {
        cameraFrame,
        ssaoEnabled: EFFECT_STATE.ssaoEnabled,
        shadowEnabled: EFFECT_STATE.shadowEnabled && !EFFECT_STATE.ambientOnly,
        ssrEnabled: EFFECT_STATE.ssrEnabled,
        toonEnabled: EFFECT_STATE.toonEnabled,
        dofEnabled: EFFECT_STATE.dofEnabled,
        bloomEnabled: EFFECT_STATE.bloomEnabled,
        edgeEnabled: true,
        edgeGeometryEnabled: EFFECT_STATE.edgeGeometryEnabled,
        forceGBuffer: true,
        toon: {
          levels: EFFECT_STATE.toonLevels
        },
        edge: {
          colorEnabled: false,
          mix: EFFECT_STATE.edgeEnabled ? 0.40 : 0.0,
          blendMode: EFFECT_STATE.edgeBlendMode,
          thickness: EFFECT_STATE.edgeThickness
        },
        shadow: {
          ...getSpotShadowOptions()
        },
        lighting: {
          ambient: EFFECT_STATE.ambientOnly ? 1.0 : EFFECT_STATE.ambientStrength,
          spotIntensity: EFFECT_STATE.ambientOnly ? 0.0 : 1.0
        },
        timestampWrites: app.getGpuTimestampWrites(true, true)
      });

      app.endGpuTiming(gpu.commandEncoder);
      app.screen.beginPresentPass({
        clearColor: app.clearColor,
        colorLoadOp: "clear"
      });
      copyPass.draw(finalColor);
      app.screen.clearDepthBuffer();
    }
  });
}
