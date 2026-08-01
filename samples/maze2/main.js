// ---------------------------------------------
// samples/maze2/main.js  2026/08/01
//   Octagonal sci-fi walk-through maze
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
import ComputeEffectPipeline from "../../webg/ComputeEffectPipeline.js";
import {
  COMPUTE_BLOOM_DEFAULTS
} from "../../webg/ComputeBloomPass.js?v=20260723_image_pyramid";
import { buildErrorPanelOptions, buildHelpPanelOptions } from "../../webg/OverlayPanelPresets.js";
import CommandPalette from "../../webg/CommandPalette.js";
import util from "../../webg/util.js";
import CollisionWorld, {
  CollisionSegment,
  DEFAULT_PLAYER_HEIGHT,
  DEFAULT_PLAYER_RADIUS,
  overlapsPlayerHeight
} from "./CollisionWorld.js";

const DEBUG_MODE = "release";
const SAMPLE_LABEL = "maze2";
const GUIDE_LINES = [
  "maze2: octagonal sci-fi walk-through maze",
  "Drag horizontal: turn  Drag vertical: look up/down",
  "Release drag: return pitch to level",
  "[W][S]: move forward/back  [A/Left][D/Right]: turn right/left",
  "[Shift]: run",
  "[5]/[6]: SSR intensity",
  "[0]: reset view  [K]: screenshot",
  "Double tap/click or [/]: command palette"
];
const DEFAULT_CLEAR_COLOR = [0.050, 0.070, 0.095, 1.0];
const EFFECT_STATE = {
  ssrEnabled: true,
  ssrIntensity: 0.68,
  ssrDistance: 14.0,
  ssrThickness: 0.30,
  ssrSteps: 48,
  ssrScale: 0.70,
  reflectivityThreshold: 0.05,
  bloomEnabled: true,
  bloomStrength: 1.10,
  bloomThreshold: 0.60,
  bloomSoftKnee: 0.40,
  bloomHalfWeight: COMPUTE_BLOOM_DEFAULTS.halfWeight,
  bloomQuarterWeight: COMPUTE_BLOOM_DEFAULTS.quarterWeight,
  bloomEighthWeight: COMPUTE_BLOOM_DEFAULTS.eighthWeight,
  bloomSixteenthWeight: COMPUTE_BLOOM_DEFAULTS.sixteenthWeight,
  bloomThirtySecondWeight: 0.80,
  bloomFilterRadius: COMPUTE_BLOOM_DEFAULTS.filterRadius,
  edgeEnabled: true,
  edgeThickness: 1,
  exposure: 1.00,
  saturation: 1.32
};
// 白系の壁と天井を光源範囲外でも判別できる基礎照度
// Pipeline初期化時と毎frameのlighting optionで同じ値を共有する
const DEFERRED_AMBIENT = 0.11;

const TURN_SPEED_DEG = 55.0;
const WALK_SPEED = 3.6;
const RUN_MULTIPLIER = 2.0;
const COLLISION_ENABLED = true;
const FIXED_LOOK_PITCH_DEG = 0.0;
const VIEW_BASE_MARKER_SIZE = 0.30;
const VIEW_BASE_MARKER_Y_OFFSET = 0.24;
const RADAR_SIZE_CSS_PX = 168;
const RADAR_RANGE_METERS = 12.0;
const RADAR_GRID_STEP_METERS = 4.0;

const MAZE_ROWS = 15;
const MAZE_COLS = 15;
const MAZE_SEED = 20260707;
const CELL_SIZE = 4.0;
const WALL_THICKNESS = 0.12;
const WALL_HEIGHT = 4.0;
const CEILING_THICKNESS = 0.12;
const FLOOR_THICKNESS = 0.12;
const LOWER_BEVEL_SIZE = 0.62;
const UPPER_BEVEL_SIZE = 1.0;
const EYE_HEIGHT = 1.6;
const ROOM_MIN_CELLS = 2;
const ROOM_MAX_CELLS = 3;
const ROOM_ATTEMPTS = 20;
const ROOM_TARGET_COUNT = 5;
const ROOM_DOOR_WIDTH = 2.4;
const ROOM_DOOR_HEIGHT = 2.7;
const ROOM_DOOR_TOP_HEIGHT = WALL_HEIGHT - ROOM_DOOR_HEIGHT;
const ROOM_DOOR_TOP_GAP = 0.0;
const MAZE_OUTER_DOOR_WIDTH = 2.4;
const MAZE_OUTER_DOOR_HEIGHT = 2.7;
const MAX_ACTIVE_LIGHTS = 64;
const LIGHT_RESELECT_DISTANCE = 1.0;
const FIXTURE_PANEL_CROSS_SPAN = 1.48;
const FIXTURE_PANEL_LONG_SPAN = 3.60;
const FIXTURE_PANEL_HEIGHT = 0.025;
const FIXTURE_PANEL_CENTER_Y = 3.95;
const FIXTURE_GEOMETRY_VISIBLE = true;
// maze-runtime-probeで確認したcamera targetをplayerの床面上の初期位置として使う
// EyeRigがEYE_HEIGHTを加えるため、JSONのeyePosition.y = 1.6と同じ視点高さになる
const INITIAL_POSITION_X = -4.0959586292702035;
const INITIAL_POSITION_Z = 9.691514516173461;
const INITIAL_BODY_YAW_DEG = -29.91426226806605;
const CEILING_LIGHT_COLORS = Object.freeze({
  white: [1.00, 0.98, 0.94],
  green: [0.18, 1.00, 0.46],
  orange: [1.00, 0.34, 0.06],
  red: [1.00, 0.05, 0.10]
});
const FLOOR_COLORS = Object.freeze({
  // alphaは透明度ではなくSSR reflectivityで、白系床も鏡面にならない低い値に抑える
  corridor: [0.68, 0.73, 0.80, 0.28],
  room: [0.82, 0.76, 0.66, 0.28],
  start: [0.04, 0.72, 0.48, 0.22],
  goal: [0.96, 0.24, 0.04, 0.22],
  junction: [0.04, 0.48, 0.88, 0.24]
});
// 床以外の通路内装は同じ白系の色を使い、照明色による変化を素直に受けるようにする
// 主壁、上下斜面、天井の面の違いはcolorではなくroughness / metallicで表現する
const INTERIOR_SURFACE_COLOR = [0.82, 0.84, 0.88, 0.70];
const WALL_COLOR = INTERIOR_SURFACE_COLOR;
const RAIL_COLOR = INTERIOR_SURFACE_COLOR;
const UPPER_RAIL_COLOR = INTERIOR_SURFACE_COLOR;
const CEILING_COLOR = INTERIOR_SURFACE_COLOR;
const CAP_COLOR = [0.08, 0.58, 0.62, 0.20];
const VIEW_BASE_FLOOR_ID = "1f";
const VIEW_BASE_MARKER_NAME = "maze_view_base_marker";

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
let wallSegments = [];
let logicalLights = [];
let activeLights = [];
let lastLightSelectionPosition = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
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

// 迷路生成専用のMT19937を固定seedから初期化する
// callbackを呼ぶたびに[0, 1)の値を順番に返し、掘削、部屋配置、照明色選択で一つの乱数列を共有する
// util.MersenneTwister側がseedをunsigned 32bit整数として検証するため、暗黙の丸めは行わない
function createMazeRandom(seed) {
  const generator = new util.MersenneTwister(seed);
  return () => generator.random();
}

// 迷路生成中に、指定した最小値から最大値までの整数を疑似乱数で一つ選ぶ
function randInt(rng, minInclusive, maxInclusive) {
  return minInclusive + Math.floor(rng() * (maxInclusive - minInclusive + 1));
}

// 部屋の入口候補などの配列を、渡された疑似乱数生成器を使ってその場で並べ替える
function shuffleInPlace(rng, values) {
  for (let i = values.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = values[i];
    values[i] = values[j];
    values[j] = tmp;
  }
  return values;
}

// 形状生成後の集計段階で、すべてのShapeが持つ三角形数を合計する
function countTriangles(shapes) {
  let total = 0;
  for (let i = 0; i < shapes.length; i += 1) {
    total += shapes[i]?.getTriangleCount?.() ?? 0;
  }
  return total;
}

// 形状生成後の集計段階で、全Shapeを囲む境界箱と中心、大きさを求める
// 形状がない場合も後続処理が有効な値を使えるように既定の範囲を返す
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

// 形状生成段階で、色と表面特性をSmoothShaderへ渡せる材質オブジェクトへまとめる
// 指定されなかった特性にはmaze2で共通の既定値を補う
function makeMaterial(color, options = {}) {
  return {
    color,
    ambient: options.ambient ?? 0.22,
    specular: options.specular ?? 0.16,
    power: options.power ?? 24.0,
    roughness: options.roughness ?? 0.72,
    metallic: options.metallic ?? 0.0,
    // 第2版G-bufferはsurface値を必須検証するため、発光しない材質も0を明示する
    emissive: options.emissive ?? 0.0,
    flat_shading: options.flatShading ?? 1
  };
}

// 単独の直方体が必要な段階で、Shape、材質、Nodeをまとめて作りsceneへ登録する
// 作成したShapeは三角形数の集計や診断にも使うためruntimeへ保存する
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

// 迷路生成の初期段階で、行列位置と四方向の壁を持つ一つのcellを作る
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

// 迷路生成の初期段階で、指定された行数と列数のcellを二次元配列へ並べる
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

// 基本迷路の生成段階で、深さ優先探索により未訪問cellへ通路を掘る
// 隣接する二つのcellでは向かい合う壁を同時に取り除く
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

// 部屋配置の候補選定段階で、新しい矩形範囲が既存の部屋と重なるかを判定する
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

// 部屋生成段階で、矩形内のcellを部屋として記録し、内部の壁を取り除く
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

// 部屋生成段階で、部屋の外周から迷路通路へ接続できる入口候補を列挙する
// 迷路の外へ出る辺は候補に含めない
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

// 部屋の入口を確定する段階で、指定cellと隣接cellの間にある壁を両側から取り除く
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

// 壁生成の準備段階で、南北方向へ延びる境界をMapで識別する文字列を作る
function verticalBoundaryKey(row, boundaryCol) {
  return `v:${row}:${boundaryCol}`;
}

// 壁生成の準備段階で、東西方向へ延びる境界をMapで識別する文字列を作る
function horizontalBoundaryKey(boundaryRow, col) {
  return `h:${boundaryRow}:${col}`;
}

// 基本迷路の生成後に複数の部屋を重ね、通路へ接続する入口を配置する
// 戻り値には確定した部屋と、壁形状を入口幅だけ開けるための境界情報を含める
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

// 形状配置段階で、列番号を迷路中央が原点になるX座標へ変換する
function cellCenterX(col) {
  return (col + 0.5) * CELL_SIZE - (MAZE_COLS * CELL_SIZE * 0.5);
}

// 形状配置段階で、行番号を迷路中央が原点になるZ座標へ変換する
function cellCenterZ(row) {
  return (row + 0.5) * CELL_SIZE - (MAZE_ROWS * CELL_SIZE * 0.5);
}

// 壁配置段階で、列と列の間にある境界番号をX座標へ変換する
function wallCenterXForVerticalBoundary(boundaryCol) {
  return boundaryCol * CELL_SIZE - (MAZE_COLS * CELL_SIZE * 0.5);
}

// 壁配置段階で、行と行の間にある境界番号をZ座標へ変換する
function wallCenterZForHorizontalBoundary(boundaryRow) {
  return boundaryRow * CELL_SIZE - (MAZE_ROWS * CELL_SIZE * 0.5);
}

// scene構築の最初に、固定seedの基本迷路、部屋、入口、開始地点、終了地点をまとめて生成する
function createMazeState() {
  const rng = createMazeRandom(MAZE_SEED);
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

// 床形状の生成段階で、cellの用途に対応する色を選ぶ
// 未知の用途は通常通路の色として扱う
function getFloorColor(kind) {
  return FLOOR_COLORS[kind] ?? FLOOR_COLORS.corridor;
}

class MeshBuilder {
  // 同じ材質を使う多数の面を一つのShapeへまとめるため、空の形状と材質を準備する
  constructor(name, material) {
    this.name = name;
    this.material = material;
    this.shape = new Shape(app.getGPU());
    this.shape.setName(name);
    this.faceCount = 0;
  }

  // 形状生成段階で、多角形の頂点順を外向きへそろえてから三角形へ分割する
  // solidCenterがある場合は面中心との位置関係から表裏を判定する
  addFace(points, solidCenter) {
    let ordered = points;
    if (solidCenter && points.length >= 3) {
      const a = points[0];
      const b = points[1];
      const c = points[2];
      const ux = b[0] - a[0];
      const uy = b[1] - a[1];
      const uz = b[2] - a[2];
      const vx = c[0] - a[0];
      const vy = c[1] - a[1];
      const vz = c[2] - a[2];
      const normal = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
      const center = points.reduce((sum, p) => [sum[0] + p[0], sum[1] + p[1], sum[2] + p[2]], [0, 0, 0]).map((v) => v / points.length);
      const outward = [center[0] - solidCenter[0], center[1] - solidCenter[1], center[2] - solidCenter[2]];
      if (normal[0] * outward[0] + normal[1] * outward[1] + normal[2] * outward[2] < 0) {
        ordered = [...points].reverse();
      }
    }
    const indices = ordered.map((point) => this.shape.addVertex(point[0], point[1], point[2]) - 1);
    for (let i = 1; i + 1 < indices.length; i += 1) {
      this.shape.addTriangle(indices[0], indices[i], indices[i + 1]);
    }
    this.faceCount += 1;
  }

  // 形状生成段階で、中心座標と大きさから直方体の六面を作り現在のShapeへ追加する
  addBox(center, size) {
    const hx = size[0] * 0.5;
    const hy = size[1] * 0.5;
    const hz = size[2] * 0.5;
    const [x, y, z] = center;
    const p = [
      [x - hx, y - hy, z - hz], [x + hx, y - hy, z - hz],
      [x + hx, y + hy, z - hz], [x - hx, y + hy, z - hz],
      [x - hx, y - hy, z + hz], [x + hx, y - hy, z + hz],
      [x + hx, y + hy, z + hz], [x - hx, y + hy, z + hz]
    ];
    this.addFace([p[0], p[3], p[2], p[1]], center);
    this.addFace([p[4], p[5], p[6], p[7]], center);
    this.addFace([p[0], p[4], p[7], p[3]], center);
    this.addFace([p[1], p[2], p[6], p[5]], center);
    this.addFace([p[0], p[1], p[5], p[4]], center);
    this.addFace([p[3], p[7], p[6], p[2]], center);
  }

  // 形状生成の完了段階で、蓄積した頂点を確定し、材質を設定してsceneへ登録する
  // 面が一つもない場合は空のShapeを登録せずnullを返す
  finish() {
    if (this.faceCount === 0) return null;
    this.shape.endShape();
    this.shape.setMaterial("smooth-shader", this.material);
    const node = app.space.addNode(null, this.name);
    node.addShape(this.shape);
    runtime.shapes.push(this.shape);
    return this.shape;
  }
}

// cellの開口方向から、天井panelの幅と前後長を決める
// 直線cellは通路方向へ3.60mまで伸ばし、上部斜面側は1.48mに抑える
// 曲がり角、T字、十字、roomは一方向へ不自然に伸ばさず、斜面に接触しない正方形panelを使う
function getFixturePanelSize(cell) {
  const xOpenings = Number(!cell.walls.e) + Number(!cell.walls.w);
  const zOpenings = Number(!cell.walls.n) + Number(!cell.walls.s);
  if (xOpenings > zOpenings) return [FIXTURE_PANEL_LONG_SPAN, FIXTURE_PANEL_HEIGHT, FIXTURE_PANEL_CROSS_SPAN];
  if (zOpenings > xOpenings) return [FIXTURE_PANEL_CROSS_SPAN, FIXTURE_PANEL_HEIGHT, FIXTURE_PANEL_LONG_SPAN];
  return [FIXTURE_PANEL_CROSS_SPAN, FIXTURE_PANEL_HEIGHT, FIXTURE_PANEL_CROSS_SPAN];
}

// scene形状の生成前に、床、天井、壁、斜面、天井灯を材質別にまとめるMeshBuilderを準備する
// 同じ材質を使う多数のcellを少数のShapeへ統合して描画回数を抑える
function createBuilders() {
  // 壁、天井、斜面で共通する材質項目へ、部位ごとの粗さと金属度を設定する
  const material = (color, roughness, metallic) => makeMaterial(color, {
    ambient: 0.08,
    specular: 0.30,
    power: 40,
    roughness,
    metallic,
    flatShading: 1
  });
  // fixtureの側面もpoint lightと同じ色相で見えるよう、色別のmaterial groupを持つ
  // 形状をcellごとに分割せず、4色のgroupへまとめてShape数を抑える
  const fixtureMaterial = (color) => makeMaterial([...color, 0.10], {
    ambient: 0.18,
    specular: 0.80,
    power: 48,
    roughness: 0.10,
    metallic: 0.10,
    // 全面発光によるBloomを避け、天井灯直下のpoint light反射を主な高輝度成分にする
    emissive: 0.10,
    flatShading: 1
  });
  // 床は非金属の塗装面とし、白系・鮮やか系の色を保ちながら弱い反射だけを残す
  const floorMaterial = (color, roughness) => makeMaterial(color, {
    ambient: 0.08,
    specular: 0.48,
    power: 32,
    roughness,
    metallic: 0.08,
    flatShading: 1
  });
  return {
    corridorFloor: new MeshBuilder("1f_floor_corridor_group", floorMaterial(FLOOR_COLORS.corridor, 0.62)),
    roomFloor: new MeshBuilder("1f_floor_room_group", floorMaterial(FLOOR_COLORS.room, 0.62)),
    startFloor: new MeshBuilder("1f_floor_start_group", floorMaterial(FLOOR_COLORS.start, 0.56)),
    goalFloor: new MeshBuilder("1f_floor_goal_group", floorMaterial(FLOOR_COLORS.goal, 0.56)),
    junctionFloor: new MeshBuilder("1f_floor_junction_group", floorMaterial(FLOOR_COLORS.junction, 0.54)),
    // 壁と天井は白系の拡散面として読みやすくし、金属感は上下railへ集中させる
    ceiling: new MeshBuilder("1f_roof_group", material(CEILING_COLOR, 0.55, 0.28)),
    walls: new MeshBuilder("1f_wall_group", material(WALL_COLOR, 0.42, 0.28)),
    lowerRails: new MeshBuilder("1f_lower_rail_group", material(RAIL_COLOR, 0.20, 0.32)),
    upperRails: new MeshBuilder("1f_upper_rail_group", material(UPPER_RAIL_COLOR, 0.16, 0.36)),
    caps: new MeshBuilder("1f_cap_group", material(CAP_COLOR, 0.40, 0.55)),
    fixtureWhite: new MeshBuilder("1f_fixture_white_group", fixtureMaterial(CEILING_LIGHT_COLORS.white)),
    fixtureGreen: new MeshBuilder("1f_fixture_green_group", fixtureMaterial(CEILING_LIGHT_COLORS.green)),
    fixtureOrange: new MeshBuilder("1f_fixture_orange_group", fixtureMaterial(CEILING_LIGHT_COLORS.orange)),
    fixtureRed: new MeshBuilder("1f_fixture_red_group", fixtureMaterial(CEILING_LIGHT_COLORS.red))
  };
}

// cell座標から60% white / 各13.3% green-orange-redの色名を決める
// fixtureとDeferred Lightingがこの関数を共有し、発光パネルの色と実ライトの色を必ず一致させる
function getCeilingLightColorName(row, col) {
  const colorBucket = (row * 7 + col * 11) % 15;
  if (colorBucket < 9) return "white";
  if (colorBucket < 11) return "green";
  if (colorBucket < 13) return "orange";
  return "red";
}

// 色名に対応するfixture mesh builderを返す
// 未定義の色名は黙ってwhiteへ置き換えず、生成時の不整合として例外にする
function getFixtureBuilder(builders, colorName) {
  const fixtureBuilder = {
    white: builders.fixtureWhite,
    green: builders.fixtureGreen,
    orange: builders.fixtureOrange,
    red: builders.fixtureRed
  }[colorName];
  if (!fixtureBuilder) throw new Error(`Unknown ceiling light color: ${colorName}`);
  return fixtureBuilder;
}

// 衝突判定の構築段階で、描画用の壁区間をXZ平面上のCollisionSegmentへ変換して登録する
function addCollisionSegment(world, segment, sourceId) {
  if (segment.axis === "x") {
    world.addSegment(new CollisionSegment(segment.start, segment.fixed, segment.end, segment.fixed, 0, segment.maxY, sourceId));
  } else {
    world.addSegment(new CollisionSegment(segment.fixed, segment.start, segment.fixed, segment.end, 0, segment.maxY, sourceId));
  }
}

// 壁区間の生成後に、歩行者の高さへ影響する区間だけで衝突検索用の空間格子を作り直す
// 同時に診断表示で使う線分数と格子数を記録する
function rebuildCollisionWorld() {
  collisionWorld = new CollisionWorld({ cellSize: CELL_SIZE });
  let count = 0;
  wallSegments.forEach((segment, index) => {
    if (segment.minY > DEFAULT_PLAYER_HEIGHT || segment.collision === false) return;
    addCollisionSegment(collisionWorld, segment, index);
    count += 1;
  });
  collisionStats = {
    floorId: VIEW_BASE_FLOOR_ID,
    shapeCount: runtime.shapes.length,
    usedShapeCount: 0,
    triangleCount: 0,
    verticalTriangleCount: 0,
    segmentCount: count,
    gridCellCount: collisionWorld.grid.size
  };
  collisionWorld.stats = collisionStats;
}

// 視点作成前に、開始位置、向き、目の高さをfirst-person用の初期状態へまとめる
function buildInitialViewState() {
  return {
    position: [INITIAL_POSITION_X, 0.0, INITIAL_POSITION_Z],
    bodyYaw: INITIAL_BODY_YAW_DEG,
    bodyPitch: 0.0,
    bodyRoll: 0.0,
    lookYaw: 0.0,
    lookPitch: FIXED_LOOK_PITCH_DEG,
    lookRoll: 0.0,
    eyeHeight: EYE_HEIGHT
  };
}

// scene形状の生成段階で、全cellへ床、天井、発光する天井灯を配置する
// 床はcellの用途、天井灯は通路の開口方向と色分類に応じて形状と材質を選ぶ
function createFloorAndCeiling(builders) {
  for (let row = 0; row < MAZE_ROWS; row += 1) {
    for (let col = 0; col < MAZE_COLS; col += 1) {
      const cell = mazeState.cells[row][col];
      const openingCount = Number(!cell.walls.n) + Number(!cell.walls.e) + Number(!cell.walls.s) + Number(!cell.walls.w);
      const isJunction = cell.kind === "corridor" && openingCount >= 3;
      const floorBuilder = isJunction
        ? builders.junctionFloor
        : (builders[`${cell.kind}Floor`] ?? builders.corridorFloor);
      floorBuilder.addBox([cellCenterX(col), -FLOOR_THICKNESS * 0.5, cellCenterZ(row)], [CELL_SIZE, FLOOR_THICKNESS, CELL_SIZE]);
      builders.ceiling.addBox([cellCenterX(col), WALL_HEIGHT + CEILING_THICKNESS * 0.5, cellCenterZ(row)], [CELL_SIZE, CEILING_THICKNESS, CELL_SIZE]);
      // 天井灯の直方体を表示設定に従って追加し、点光源の反射を受ける下面を作る
      if (FIXTURE_GEOMETRY_VISIBLE) {
        const fixtureBuilder = getFixtureBuilder(builders, getCeilingLightColorName(row, col));
        fixtureBuilder.addBox(
          [cellCenterX(col), FIXTURE_PANEL_CENTER_Y, cellCenterZ(row)],
          getFixturePanelSize(cell)
        );
      }
    }
  }
}

// 壁区間の収集段階で、有効な長さと高さを持つ直線区間だけを配列へ追加する
function addWallSpan(segments, axis, fixed, start, end, minY = 0, maxY = WALL_HEIGHT, collision = true) {
  if (end - start <= 1.0e-6 || maxY - minY <= 1.0e-6) return;
  segments.push({ axis, fixed, start, end, minY, maxY, collision });
}

// 入口を持つ壁の収集段階で、入口の左右と上部に残る壁区間を分けて追加する
// 入口中央の通行範囲は衝突線分にも描画面にも含めない
function addDoorwaySpans(segments, axis, fixed, center, spanLength, options = {}) {
  const doorWidth = options.doorWidth ?? ROOM_DOOR_WIDTH;
  const doorHeight = options.doorHeight ?? ROOM_DOOR_HEIGHT;
  const sideLength = Math.max(0.0, (spanLength - doorWidth) * 0.5);
  const spanStart = center - spanLength * 0.5;
  addWallSpan(segments, axis, fixed, spanStart, spanStart + sideLength);
  addWallSpan(segments, axis, fixed, spanStart + sideLength + doorWidth, spanStart + spanLength);
  addWallSpan(segments, axis, fixed, center - doorWidth * 0.5, center + doorWidth * 0.5, doorHeight, WALL_HEIGHT, false);
}

// 迷路構造の確定後に、四方向の壁情報を重複のない直線区間へ変換する
// 部屋の入口と迷路外周の出入口では、開口部を避けた短い区間へ分割する
function collectWallSegments() {
  const segments = [];
  const startRow = mazeState.start.row;
  const goalRow = mazeState.goal.row;
  for (let col = 0; col < MAZE_COLS; col += 1) {
    const x = cellCenterX(col);
    addWallSpan(segments, "x", wallCenterZForHorizontalBoundary(0), x - CELL_SIZE * 0.5, x + CELL_SIZE * 0.5);
    addWallSpan(segments, "x", wallCenterZForHorizontalBoundary(MAZE_ROWS), x - CELL_SIZE * 0.5, x + CELL_SIZE * 0.5);
  }
  for (let row = 0; row < MAZE_ROWS; row += 1) {
    const z = cellCenterZ(row);
    const westX = wallCenterXForVerticalBoundary(0);
    if (row === startRow) {
      addDoorwaySpans(segments, "z", westX, z, CELL_SIZE, {
        doorWidth: MAZE_OUTER_DOOR_WIDTH,
        doorHeight: MAZE_OUTER_DOOR_HEIGHT
      });
    } else {
      addWallSpan(segments, "z", westX, z - CELL_SIZE * 0.5, z + CELL_SIZE * 0.5);
    }
    const eastX = wallCenterXForVerticalBoundary(MAZE_COLS);
    if (row === goalRow) {
      addDoorwaySpans(segments, "z", eastX, z, CELL_SIZE, {
        doorWidth: MAZE_OUTER_DOOR_WIDTH,
        doorHeight: MAZE_OUTER_DOOR_HEIGHT
      });
    } else {
      addWallSpan(segments, "z", eastX, z - CELL_SIZE * 0.5, z + CELL_SIZE * 0.5);
    }
  }
  for (let row = 0; row < MAZE_ROWS; row += 1) {
    for (let col = 0; col < MAZE_COLS - 1; col += 1) {
      const doorway = mazeState.doorways.get(verticalBoundaryKey(row, col + 1)) ?? null;
      const x = wallCenterXForVerticalBoundary(col + 1);
      const z = cellCenterZ(row);
      if (doorway) {
        addDoorwaySpans(segments, "z", x, z, CELL_SIZE);
        continue;
      }
      if (mazeState.cells[row][col].walls.e) addWallSpan(segments, "z", x, z - CELL_SIZE * 0.5, z + CELL_SIZE * 0.5);
    }
  }
  for (let row = 0; row < MAZE_ROWS - 1; row += 1) {
    for (let col = 0; col < MAZE_COLS; col += 1) {
      const doorway = mazeState.doorways.get(horizontalBoundaryKey(row + 1, col)) ?? null;
      const x = cellCenterX(col);
      const z = wallCenterZForHorizontalBoundary(row + 1);
      if (doorway) {
        addDoorwaySpans(segments, "x", z, x, CELL_SIZE);
        continue;
      }
      if (mazeState.cells[row][col].walls.s) addWallSpan(segments, "x", z, x - CELL_SIZE * 0.5, x + CELL_SIZE * 0.5);
    }
  }
  return segments;
}

// wall中心から見たrail断面と、その長手方向終端の頂点を返す
// wall / floor / ceilingと重なる面はこの段階では生成せず、呼び出し側が可視面だけを選ぶ
function createRailSection(segment, side, upper) {
  if (segment.minY > 0 || segment.maxY < WALL_HEIGHT - 1.0e-6) return;
  const half = WALL_THICKNESS * 0.5;
  const bevelSize = upper ? UPPER_BEVEL_SIZE : LOWER_BEVEL_SIZE;
  const wallFace = segment.fixed + side * half;
  const tip = segment.fixed + side * (half + bevelSize);
  let startSection;
  let endSection;
  if (segment.axis === "x") {
    startSection = upper
      ? [[segment.start, WALL_HEIGHT, wallFace], [segment.start, WALL_HEIGHT - bevelSize, wallFace], [segment.start, WALL_HEIGHT, tip]]
      : [[segment.start, 0, wallFace], [segment.start, bevelSize, wallFace], [segment.start, 0, tip]];
    endSection = startSection.map((point) => [segment.end, point[1], point[2]]);
  } else {
    startSection = upper
      ? [[wallFace, WALL_HEIGHT, segment.start], [wallFace, WALL_HEIGHT - bevelSize, segment.start], [tip, WALL_HEIGHT, segment.start]]
      : [[wallFace, 0, segment.start], [wallFace, bevelSize, segment.start], [tip, 0, segment.start]];
    endSection = startSection.map((point) => [point[0], point[1], segment.end]);
  }
  const points = [...startSection, ...endSection];
  const center = points
    .reduce((sum, point) => [sum[0] + point[0], sum[1] + point[1], sum[2] + point[2]], [0, 0, 0])
    .map((value) => value / points.length);
  return { startSection, endSection, center };
}

// 三角柱のうち通路側から見える斜面だけをquadとして追加する
// wall面、床面、天井面は主構造側に既に存在するため、重複させない
function addRailSlope(builder, segment, side, upper) {
  const rail = createRailSection(segment, side, upper);
  if (!rail) return;
  builder.addFace([
    rail.startSection[1],
    rail.startSection[2],
    rail.endSection[2],
    rail.endSection[1]
  ], rail.center);
}

// railの終端面だけに三角形capを1枚追加する
// 自由端にはaccent cap materialを使い、L字のrail終端は別のmiter bridgeで接続する
// 短い三角柱を重ねないため、通常railと同一平面の面を作らない
function addRailEndCap(builder, segment, side, upper, atStart) {
  const rail = createRailSection(segment, side, upper);
  if (!rail) return;
  builder.addFace(atStart ? rail.startSection : rail.endSection, rail.center);
}

// 直交するhorizontal / vertical railの終端辺を一枚のmiter bridgeで接続する
// sx / szはcornerから見たそれぞれのrail側面の符号で、4組すべてがL字の上下角を囲む
// bridgeの4頂点は二本のslope quadがすでに持つ終端辺の頂点をそのまま使うため、座標差の隙間を作らない
function addRailCornerMiter(builder, x, z, sx, sz, upper) {
  const half = WALL_THICKNESS * 0.5;
  const bevelSize = upper ? UPPER_BEVEL_SIZE : LOWER_BEVEL_SIZE;
  const wallY = upper ? WALL_HEIGHT - bevelSize : bevelSize;
  const tipY = upper ? WALL_HEIGHT : 0;

  // horizontal railの終端辺はxを固定し、vertical railの終端辺はzを固定する
  // 4頂点を順に結ぶと、二本の斜面の間を閉じつつwall、floor、ceilingのcoplanar面を作らない
  const horizontalWallEdge = [x, wallY, z + sz * half];
  const horizontalTipEdge = [x, tipY, z + sz * (half + bevelSize)];
  const verticalTipEdge = [x + sx * (half + bevelSize), tipY, z];
  const verticalWallEdge = [x + sx * half, wallY, z];
  const solidCenter = [x, upper ? WALL_HEIGHT : 0, z];
  builder.addFace([
    horizontalWallEdge,
    horizontalTipEdge,
    verticalTipEdge,
    verticalWallEdge
  ], solidCenter);
}

// 壁区間の収集後に、主壁、上下斜面、自由端、直角接続部の実際の面を生成する
// 隣接区間の接続関係を先に調べ、重複面や不要な終端面を作らない
function createWallGeometry(builders) {
  wallSegments = collectWallSegments();
  // 壁区間の端点を、方向に依存しない同じ形式の文字列へ変換する
  const endpointKey = (axis, fixed, along) => axis === "x"
    ? `${along.toFixed(4)},${fixed.toFixed(4)}`
    : `${fixed.toFixed(4)},${along.toFixed(4)}`;
  const oppositeDirection = Object.freeze({ west: "east", east: "west", north: "south", south: "north" });
  const endpointTopology = new Map();

  // endpointごとに、そこからどの方角へfull-height wallが伸びるかを記録する
  // 単なる本数ではL字、T字、十字、自由端を区別できないため、方向集合を保持する
  wallSegments.forEach((segment) => {
    if (segment.minY > 0 || segment.maxY < WALL_HEIGHT - 1.0e-6) return;
    const endpointEntries = [
      {
        along: segment.start,
        direction: segment.axis === "x" ? "west" : "north"
      },
      {
        along: segment.end,
        direction: segment.axis === "x" ? "east" : "south"
      }
    ];
    for (const endpoint of endpointEntries) {
      const key = endpointKey(segment.axis, segment.fixed, endpoint.along);
      const topology = endpointTopology.get(key) ?? { directions: new Set() };
      topology.directions.add(endpoint.direction);
      endpointTopology.set(key, topology);
    }
  });

  // 一つの端点へ東西方向と南北方向の壁が一本ずつ接続する直角角かを判定する
  const isRightAngleCorner = (topology) => {
    if (!topology || topology.directions.size !== 2) return false;
    const hasHorizontal = topology.directions.has("west") || topology.directions.has("east");
    const hasVertical = topology.directions.has("north") || topology.directions.has("south");
    return hasHorizontal && hasVertical;
  };

  // 壁端の接続状態から、斜面を閉じる終端面が必要かを判定する
  const shouldAddEndCap = (topology, direction) => {
    if (!topology) return true;
    if (topology.directions.has(oppositeDirection[direction])) return false;
    return !isRightAngleCorner(topology);
  };

  // 自由端とjunctionの端だけにaccent capを置く
  // L字は後段でmiter bridgeを追加するため、ここでcapを作らない
  // 一つの壁端について、上下左右の斜面へ必要な終端面だけを追加する
  const addEndpointCaps = (segment, topology, direction, atStart) => {
    if (!shouldAddEndCap(topology, direction)) return;
    for (const side of [-1, 1]) {
      addRailEndCap(builders.caps, segment, side, false, atStart);
      addRailEndCap(builders.caps, segment, side, true, atStart);
    }
  };

  wallSegments.forEach((segment) => {
    const centerAlong = (segment.start + segment.end) * 0.5;
    const centerY = (segment.minY + segment.maxY) * 0.5;
    const length = segment.end - segment.start;
    const center = segment.axis === "x" ? [centerAlong, centerY, segment.fixed] : [segment.fixed, centerY, centerAlong];
    const size = segment.axis === "x" ? [length, segment.maxY - segment.minY, WALL_THICKNESS] : [WALL_THICKNESS, segment.maxY - segment.minY, length];
    builders.walls.addBox(center, size);

    // railはwall / floor / ceilingと重なる面を持たない可視斜面quadだけを作る
    addRailSlope(builders.lowerRails, segment, -1, false);
    addRailSlope(builders.lowerRails, segment, 1, false);
    addRailSlope(builders.upperRails, segment, -1, true);
    addRailSlope(builders.upperRails, segment, 1, true);
    if (segment.minY > 0 || segment.maxY < WALL_HEIGHT - 1.0e-6) return;

    const startTopology = endpointTopology.get(endpointKey(segment.axis, segment.fixed, segment.start));
    const endTopology = endpointTopology.get(endpointKey(segment.axis, segment.fixed, segment.end));
    const startDirection = segment.axis === "x" ? "west" : "north";
    const endDirection = segment.axis === "x" ? "east" : "south";
    addEndpointCaps(segment, startTopology, startDirection, true);
    addEndpointCaps(segment, endTopology, endDirection, false);
  });

  // L字の4組のrail側面を、それぞれ共有する終端辺でmiter接続する
  // これは自由端capではなく二本のslopeを連続させるbridgeなので、junctionの開口へは伸びない
  for (const [key, topology] of endpointTopology) {
    if (!isRightAngleCorner(topology)) continue;
    const [x, z] = key.split(",").map(Number);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        addRailCornerMiter(builders.lowerRails, x, z, sx, sz, false);
        addRailCornerMiter(builders.upperRails, x, z, sx, sz, true);
      }
    }
  }
}

// scene形状の生成後に、各cellの天井灯直下へ通路照明用point lightを一灯ずつ作る
// point lightは下側の通路と直上の天井灯下面を同時に照らし、下面へ高輝度の直接反射を作る
function createLogicalLights() {
  logicalLights = [];
  for (let row = 0; row < MAZE_ROWS; row += 1) {
    for (let col = 0; col < MAZE_COLS; col += 1) {
      const colorName = getCeilingLightColorName(row, col);
      const color = CEILING_LIGHT_COLORS[colorName];
      const position = [cellCenterX(col), 3.70, cellCenterZ(row)];
      logicalLights.push({
        type: "point",
        position,
        color,
        radius: 7.2,
        intensity: 5.2
      });
    }
  }
}

// 更新処理の中で、視点に近く照明範囲へ届くpoint lightを最大数まで選び直す
// 視点の移動が小さい間は前回の選択を再利用して並べ替えの負荷を抑える
function updateActiveLights(force = false) {
  const position = eyeRig?.firstPerson?.position ?? initialViewState?.position;
  if (!position) return;
  const moved = Math.hypot(position[0] - lastLightSelectionPosition[0], position[2] - lastLightSelectionPosition[1]);
  if (!force && moved < LIGHT_RESELECT_DISTANCE) return;
  activeLights = logicalLights
    .map((light) => ({ light, distanceSq: (light.position[0] - position[0]) ** 2 + (light.position[2] - position[2]) ** 2 }))
    .filter((entry) => entry.distanceSq <= (entry.light.radius + CELL_SIZE * 2) ** 2)
    .sort((a, b) => a.distanceSq - b.distanceSq)
    .slice(0, MAX_ACTIVE_LIGHTS)
    .map((entry) => entry.light);
  lastLightSelectionPosition = [position[0], position[2]];
}

// 起動時のscene構築段階で、迷路生成から形状、光源、衝突判定、集計までを順番に実行する
function buildMazeScene() {
  runtime = { shapes: [] };
  mazeState = createMazeState();
  const builders = createBuilders();
  createFloorAndCeiling(builders);
  createWallGeometry(builders);
  Object.values(builders).forEach((builder) => builder.finish());
  createLogicalLights();
  visibleTriangles = countTriangles(runtime.shapes);
  totalTriangles = visibleTriangles;
  viewerSize = computeViewerSize(runtime.shapes);
  initialViewState = buildInitialViewState();
  rebuildCollisionWorld();
}

// 起動時またはリセット操作時に、視点の位置、身体の向き、見上げ角を初期状態へ戻す
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

// scene構築後に、歩行者の基準位置を3D空間内で示す赤い目印を作る
function createViewBaseMarker() {
  const shape = new Shape(app.getGPU());
  shape.setName(VIEW_BASE_MARKER_NAME);
  shape.applyPrimitiveAsset(Primitive.cube(VIEW_BASE_MARKER_SIZE, shape.getPrimitiveOptions()));
  shape.endShape();
  shape.setMaterial("smooth-shader", {
    color: [1.0, 0.04, 0.02, 1.0],
    specular: 0.12,
    roughness: 0.55,
    metallic: 0.0,
    emissive: 0.0,
    flat_shading: 1
  });
  const node = app.space.addNode(null, VIEW_BASE_MARKER_NAME);
  node.addShape(shape);
  return node;
}

// 各更新時に、赤い基準位置の目印を現在の歩行者位置へ追従させる
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

// 画面部品の準備段階で、壁と現在方向を表示するレーダー用canvasを作る
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

// レーダー描画前に、端末の画素比へ合わせてcanvas内部の解像度と座標変換を更新する
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

// レーダー描画中に、歩行者から見たワールド座標差を画面上の座標へ変換する
// 現在の視線方向が常にレーダー上方になるように回転を含める
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

// 各更新時に、現在位置周辺の衝突線分と進行方向をレーダーへ描き直す
// 歩行者の高さと表示距離に合う壁だけを選んで表示する
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

// 各更新時に、A、D、左右矢印の入力を経過時間に応じた身体の回転へ変換する
function updateTurnInput(deltaSec) {
  const dt = Number.isFinite(deltaSec) ? deltaSec : 0.0;
  if (dt <= 0.0 || !app?.input || !eyeRig) {
    return;
  }
  let yawDelta = 0.0;
  if (app.input.has("a") || app.input.has("arrowleft")) yawDelta += TURN_SPEED_DEG * dt;
  if (app.input.has("d") || app.input.has("arrowright")) yawDelta -= TURN_SPEED_DEG * dt;
  if (yawDelta === 0.0) {
    return;
  }
  eyeRig.firstPerson.bodyYaw += yawDelta;
  eyeRig.apply(true);
}

// 各更新時に、ドラッグ中の左右視線を身体の向きへ取り込み、ドラッグ終了時は上下視線を水平へ戻す
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

// 各更新時に、WまたはSの入力を現在の視線方向に沿った前後移動へ変換する
// 衝突判定が有効な場合は壁からの押し戻しを適用してから視点位置を確定する
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

// WebgAppはonUpdate後にcamera shakeなどの最終効果をcameraRigへ適用するため、
// sampleが直接所有するfirst-person EyeRigの位置をapp.camera.targetへ明示的に同期する
// ここを省くと論理playerとradarだけが移動し、CameraFrameは旧target位置から作られてしまう
// Deferred point lightもCameraFrame基準でview-space化されるので、視点と照明を同時に一致させる
function syncFirstPersonCameraTarget() {
  const position = eyeRig.firstPerson.position;
  app.camera.target[0] = position[0];
  app.camera.target[1] = position[1];
  app.camera.target[2] = position[2];
}

// 状態表示の作成段階で、身体の角度を-180度より大きく180度以下の範囲へそろえる
function getDisplayedYawDeg(bodyYaw) {
  let yaw = Number(bodyYaw);
  while (yaw <= -180.0) yaw += 360.0;
  while (yaw > 180.0) yaw -= 360.0;
  return yaw;
}

// 状態表示の更新段階で、GPUとJavaScriptの計測値を表示用の文字列へ整形する
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

// 各更新時に、位置、迷路、衝突、描画効果、負荷の現在値を画面上のHUDへ反映する
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
      value: `SSR ${EFFECT_STATE.ssrEnabled ? `ON ${EFFECT_STATE.ssrIntensity.toFixed(2)}` : "OFF"} Bloom ${EFFECT_STATE.bloomEnabled ? "ON" : "OFF"} Edge ON`,
      note: `deferred lights=${activeLights.length}/${logicalLights.length}`
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

// ヘルプ表示の更新前に、操作方法と現在状態を行単位の文字列配列へまとめる
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
    `Doorway=${ROOM_DOOR_WIDTH.toFixed(2)}m x ${ROOM_DOOR_HEIGHT.toFixed(2)}m Ceiling=${WALL_HEIGHT.toFixed(2)}m / bevel=${LOWER_BEVEL_SIZE.toFixed(2)}/${UPPER_BEVEL_SIZE.toFixed(2)}m`,
    `SSR=${EFFECT_STATE.ssrEnabled ? `ON (${EFFECT_STATE.ssrIntensity.toFixed(2)}, scale ${EFFECT_STATE.ssrScale.toFixed(2)})` : "OFF"} Bloom=${EFFECT_STATE.bloomEnabled ? `ON (${EFFECT_STATE.bloomStrength.toFixed(2)})` : "OFF"} Edge=ON`,
    `Deferred lights=${activeLights.length}/${logicalLights.length} (max ${MAX_ACTIVE_LIGHTS}) / Shadow=OFF / SSAO=OFF`,
    `Position=${firstPerson.position.map((value) => value.toFixed(2)).join(", ")}`,
    `Yaw=${getDisplayedYawDeg(firstPerson.bodyYaw).toFixed(1)} LookYaw=${firstPerson.lookYaw.toFixed(1)} LookPitch=${firstPerson.lookPitch.toFixed(1)}`,
    `Collision=${collisionStats?.segmentCount ?? 0} segments Candidates=${collisionWorld?.lastCandidateCount ?? 0} Hits=${collisionWorld?.lastHitCount ?? 0}`,
    `VisibleTris=${visibleTriangles} Screenshot=${screenshotName || "-"}`,
    ...(app?.getFrameTimingLines?.() ?? [])
  ];
}

// 定期更新時にヘルプ内容を作り直し、前回から文字列が変化した場合だけ画面へ反映する
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

// 起動処理の各段階で、現在の処理名と経過時間を読み込み表示へ反映する
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

// スクリーンショット操作時に現在のcanvasを保存し、ファイル名を通知と状態表示へ反映する
function takeViewerScreenshot() {
  const file = app.takeScreenshot({ prefix: SAMPLE_LABEL });
  screenshotName = file;
  app.pushToast(`saved ${file}`, { durationMs: 1400 });
}

// キー入力の受付後に、視点リセット、撮影、SSR強度変更のいずれかを実行する
function applyAction(key) {
  if (key === "0") {
    resetView();
  } else if (key === "k") {
    takeViewerScreenshot();
  } else if (key === "5") {
    EFFECT_STATE.ssrIntensity = Math.max(0, EFFECT_STATE.ssrIntensity - 0.05);
  } else if (key === "6") {
    EFFECT_STATE.ssrIntensity = Math.min(1, EFFECT_STATE.ssrIntensity + 0.05);
  }
}

// CommandPaletteの設定変更時に、選択された描画効果の値を実行時設定へ反映する
function applyPaletteChange(id, value) {
  if (id === "ssr") EFFECT_STATE.ssrEnabled = value;
  else if (id === "edge") EFFECT_STATE.edgeEnabled = value;
  else if (id === "bloom") EFFECT_STATE.bloomEnabled = value;
  else if (id === "ssr-intensity") EFFECT_STATE.ssrIntensity = value;
  else if (id === "ssr-distance") EFFECT_STATE.ssrDistance = value;
  else if (id === "ssr-thickness") EFFECT_STATE.ssrThickness = value;
  else if (id === "ssr-steps") EFFECT_STATE.ssrSteps = value;
  else if (id === "ssr-scale") EFFECT_STATE.ssrScale = value;
  else if (id === "bloom-strength") EFFECT_STATE.bloomStrength = value;
  else if (id === "bloom-threshold") EFFECT_STATE.bloomThreshold = value;
  else if (id === "bloom-soft-knee") EFFECT_STATE.bloomSoftKnee = value;
  else if (id === "exposure") EFFECT_STATE.exposure = value;
  app?.requestRender?.();
}

// CommandPaletteの実行項目が選ばれたときに、リセットまたは撮影を呼び出す
function applyPaletteCommand(id) {
  if (id === "reset-view") {
    resetView();
  } else if (id === "screenshot") {
    takeViewerScreenshot();
  }
}

// 入力部品の準備段階で、描画効果の調整と操作を行うCommandPaletteをcanvasへ接続する
function installCommandPalette() {
  commandPalette = new CommandPalette({
    document,
    container: document.body,
    viewport: app.screen.canvas,
    title: "Maze",
    pageRows: 4,
    pageRowsByPage: [4, 4, 4],
    closeOnCommand: false,
    onCommand: applyPaletteCommand,
    onChange: applyPaletteChange,
    commands: [
      { id: "reset-view", label: "Reset", detail: "view" },
      { id: "screenshot", label: "Shot", detail: "save" },
      null,
      { id: "palette-next", label: "Next", detail: "effect", pageSwitch: true },
      { type: "stepper", id: "ssr-intensity", label: "Reflect", value: () => EFFECT_STATE.ssrIntensity, min: 0, max: 1, step: 0.05, decimals: 2, input: true },
      { type: "stepper", id: "ssr-distance", label: "Distance", value: () => EFFECT_STATE.ssrDistance, min: 1, max: 20, step: 1, decimals: 1, input: true },
      { type: "stepper", id: "ssr-thickness", label: "Thickness", value: () => EFFECT_STATE.ssrThickness, min: 0.02, max: 1, step: 0.02, decimals: 2, input: true },
      null,
      null,
      null,
      { id: "palette-next", label: "Next", detail: "effect", pageSwitch: true },
      { type: "stepper", id: "ssr-steps", label: "Steps", value: () => EFFECT_STATE.ssrSteps, min: 12, max: 64, step: 4 },
      { type: "stepper", id: "ssr-scale", label: "SSR Scale", value: () => EFFECT_STATE.ssrScale, min: 0.5, max: 1, step: 0.05, decimals: 2, input: true },
      { type: "stepper", id: "exposure", label: "Exposure", value: () => EFFECT_STATE.exposure, min: 0.4, max: 2.5, step: 0.05, decimals: 2, input: true },
      { type: "toggle", id: "ssr", label: "SSR", detail: "effect", value: () => EFFECT_STATE.ssrEnabled },
      { type: "toggle", id: "edge", label: "Edge", detail: "effect", value: () => EFFECT_STATE.edgeEnabled },
      { type: "toggle", id: "bloom", label: "Bloom", detail: "effect", value: () => EFFECT_STATE.bloomEnabled },
      { id: "palette-next", label: "Next", detail: "effect", pageSwitch: true },
      { type: "stepper", id: "bloom-strength", label: "Bloom Strength", value: () => EFFECT_STATE.bloomStrength, min: 0, max: 3, step: 0.05, decimals: 2, input: true },
      { type: "stepper", id: "bloom-threshold", label: "Bloom Threshold", value: () => EFFECT_STATE.bloomThreshold, min: 0, max: 4, step: 0.05, decimals: 2, input: true },
      { type: "stepper", id: "bloom-soft-knee", label: "Bloom Soft Knee", value: () => EFFECT_STATE.bloomSoftKnee, min: 0, max: 1, step: 0.05, decimals: 2, input: true }
    ]
  });
  commandPalette.attachToCanvas(app.screen.canvas, { key: "/" });
}

// 入力部品の準備段階で、タッチ操作用の移動と回転ボタンを画面へ追加する
function installTouchButtons() {
  app.input.installTouchControls({
    touchDeviceOnly: false,
    groups: [
      {
        id: "maze-move",
        buttons: [
          { key: "a", label: "A", kind: "hold", ariaLabel: "turn right" },
          { key: "w", label: "W", kind: "hold", ariaLabel: "move forward" },
          { key: "d", label: "D", kind: "hold", ariaLabel: "turn left" },
          { key: "s", label: "S", kind: "hold", ariaLabel: "move backward" }
        ]
      }
    ]
  });
}

// HTMLの読み込み完了後に起動処理を開始し、失敗時は診断情報と画面上のエラーを残す
document.addEventListener("DOMContentLoaded", () => {
  // 非同期の起動処理で発生した例外を利用者向け表示と診断結果へ変換する
  start().catch((error) => {
    app?.setDiagnosticsReport?.(Diagnostics.createErrorReport(error, {
      system: SAMPLE_LABEL,
      source: "samples/maze2/main.js",
      stage: app?.getDiagnosticsReport?.()?.stage ?? "start"
    }));
    app?.showOverlayPanel?.(buildErrorPanelOptions(error, {
      title: "maze2 failed",
      id: "start-error",
      background: "rgba(22, 28, 36, 0.92)"
    }));
    if (app?.isConsoleEnabled?.()) {
      console.error("maze2 failed:", error);
    }
  });
});

// 起動処理全体を、GPU初期化、scene構築、視点作成、描画効果準備、入力登録、描画開始の順に進める
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
      source: "samples/maze2/main.js",
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
  updateActiveLights(true);

  updateLoadingPanel("creating compute effects");
  const effectSize = {
    width: app.screen.getWidth(),
    height: app.screen.getHeight()
  };
  // 第2版ではG-buffer、Deferred Shading、SSR、tone map、geometry edgeを
  // 一つのPipelineへ集約し、全passが同じCameraFrameを参照することを保証する
  // Shadow MapとSSAOはPipeline内の中立visibility出力だけを使用し、効果自体は無効にする
  pipeline = new ComputeEffectPipeline(gpu, {
    label: `${SAMPLE_LABEL}:pipeline`,
    ...effectSize,
    maxLights: MAX_ACTIVE_LIGHTS,
    lighting: {
      ambient: DEFERRED_AMBIENT,
      directionalIntensity: 0.0
    },
    ssr: {
      intensity: EFFECT_STATE.ssrIntensity,
      distance: EFFECT_STATE.ssrDistance,
      thickness: EFFECT_STATE.ssrThickness,
      steps: EFFECT_STATE.ssrSteps,
      resolutionScale: EFFECT_STATE.ssrScale,
      reflectivityThreshold: EFFECT_STATE.reflectivityThreshold
    },
    composer: {
      mode: "mix"
    },
    bloom: {
      enabled: EFFECT_STATE.bloomEnabled,
      threshold: EFFECT_STATE.bloomThreshold,
      softKnee: EFFECT_STATE.bloomSoftKnee,
      strength: EFFECT_STATE.bloomStrength,
      halfWeight: EFFECT_STATE.bloomHalfWeight,
      quarterWeight: EFFECT_STATE.bloomQuarterWeight,
      eighthWeight: EFFECT_STATE.bloomEighthWeight,
      sixteenthWeight: EFFECT_STATE.bloomSixteenthWeight,
      thirtySecondWeight: EFFECT_STATE.bloomThirtySecondWeight,
      filterRadius: EFFECT_STATE.bloomFilterRadius
    },
    toneMap: {
      exposure: EFFECT_STATE.exposure,
      saturation: EFFECT_STATE.saturation,
      gamma: 2.2,
      mode: "reinhard",
      blackBackground: false
    }
  });
  copyPass = new FullscreenPass(gpu);
  await Promise.all([
    pipeline.ready,
    copyPass.init()
  ]);

  app.removeOverlayPanel("mazeLoading");
  const helpLines = buildHelpLines();
  app.showOverlayPanel(buildHelpPanelOptions({
    id: "mazeHelp",
    collapsed: true,
    lines: helpLines
  }));
  lastHelpText = helpLines.join("\n");

  app.attachInput({
    // キーが押されたときに、一度だけ実行するmaze2固有の操作へ渡す
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
    // 診断要求時に、迷路、衝突、光源の現在状態を共通の実行結果へ追加する
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
        collisionLastHits: collisionWorld?.lastHitCount ?? 0,
        logicalLights: logicalLights.length,
        activeLights: activeLights.length,
        shadowMap: "off",
        ssao: "off"
      });
      return report;
    }
  });
  app.configureDebugKeyInput();
  app.setDiagnosticsStage("runtime");

  globalThis.mazeSample = {
    // 自動試験や開発者ツールから、迷路と視点の現在状態を読み取れる形で返す
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
    // 各frameの描画前に、入力、歩行、視点、レーダー、光源、画面表示を更新する
    onUpdate: ({ deltaSec, screen, timeMs }) => {
      app.afterGpuSubmit();
      updateTurnInput(deltaSec);
      updateDragLook();
      updateWalkMovement(deltaSec);
      eyeRig.update(deltaSec);
      // WebgAppがこのcallback後にcamera effectを適用してCameraFrameを確定する前に、
      // first-personの現在位置をcamera基準位置へ同期する
      syncFirstPersonCameraTarget();
      updateViewBaseMarker();
      updateRadarOverlay();
      updateActiveLights();
      if (timeMs - lastHelpUpdateMs >= 500) {
        updateHelpPanel();
        lastHelpUpdateMs = timeMs;
      }
      const width = screen.getWidth();
      const height = screen.getHeight();
      pipeline.resize(width, height);
      app.updateDebugProbe();
      updateHudRows();
      app.setControlRows([]);
    },
    // 3D描画の開始直前に、確定したCameraFrameを使ってG-buffer用のscene描画を記録する
    onBeforeDraw: ({ cameraFrame }) => {
      app.beginGpuTiming();
      // WebgAppが描画直前に確定したCameraFrameをそのまま渡し、
      // camera-relative座標とReverse-Z projectionのsnapshotを後段まで共有する
      pipeline.renderScene(app.space, cameraFrame, app.clearColor, {
        shadowEnabled: false,
        timestampWrites: app.getGpuRenderTimestampWrites(true, true)
      });
    },
    // 3D描画の記録後に、照明、SSR、Bloom、輪郭、トーンマッピング、画面転送を順に記録する
    onAfterDraw3d: ({ cameraFrame }) => {
      const gpu = app.getGPU();
      gpu.endPass();

      // Shadow MapとSSAOを無効にし、天井panel由来のpoint lightだけでDeferred Shadingする
      // SSR、Bloom、geometry edgeをHDR sceneから最終表示まで同じPipelineで接続する
      const finalColor = pipeline.encode(gpu.commandEncoder, {
        cameraFrame,
        shadowEnabled: false,
        ssaoEnabled: false,
        ssrEnabled: EFFECT_STATE.ssrEnabled,
        toonEnabled: false,
        dofEnabled: false,
        bloomEnabled: EFFECT_STATE.bloomEnabled,
        edgeEnabled: EFFECT_STATE.edgeEnabled,
        edgeGeometryEnabled: true,
        lights: activeLights,
        lightCount: activeLights.length,
        lighting: {
          ambient: DEFERRED_AMBIENT,
          directionalIntensity: 0.0
        },
        ssr: {
          intensity: EFFECT_STATE.ssrIntensity,
          distance: EFFECT_STATE.ssrDistance,
          thickness: EFFECT_STATE.ssrThickness,
          steps: EFFECT_STATE.ssrSteps,
          resolutionScale: EFFECT_STATE.ssrScale,
          reflectivityThreshold: EFFECT_STATE.reflectivityThreshold
        },
        composer: {
          mode: "mix"
        },
        bloom: {
          threshold: EFFECT_STATE.bloomThreshold,
          softKnee: EFFECT_STATE.bloomSoftKnee,
          strength: EFFECT_STATE.bloomStrength,
          halfWeight: EFFECT_STATE.bloomHalfWeight,
          quarterWeight: EFFECT_STATE.bloomQuarterWeight,
          eighthWeight: EFFECT_STATE.bloomEighthWeight,
          sixteenthWeight: EFFECT_STATE.bloomSixteenthWeight,
          thirtySecondWeight: EFFECT_STATE.bloomThirtySecondWeight,
          filterRadius: EFFECT_STATE.bloomFilterRadius
        },
        edge: {
          colorEnabled: false,
          strength: 1.35,
          threshold: 0.10,
          mix: 0.68,
          blendMode: "black-multiply",
          thickness: EFFECT_STATE.edgeThickness,
          normalWeight: 1.0,
          depthWeight: 0.75
        },
        toneMap: {
          exposure: EFFECT_STATE.exposure,
          saturation: EFFECT_STATE.saturation,
          gamma: 2.2,
          mode: "reinhard",
          blackBackground: false
        },
        timestampWrites: app.getGpuTimestampWrites(true, true)
      });

      app.endGpuTiming(gpu.commandEncoder);
      // 画面copyはdepth attachmentを持たないpresentation passへ記録する
      // 後続のFont/HUD用にはcolorを保持してReverse-Z depth passを開き直す
      app.screen.beginPresentPass({
        clearColor: app.clearColor,
        colorLoadOp: "clear"
      });
      copyPass.draw(finalColor);
      app.screen.clearDepthBuffer();
    }
  });

  // page遷移後に巨大なmaze用GPU resourceを保持しないよう、所有者順に解放する
  window.addEventListener("pagehide", () => {
    app.stop();
    copyPass.destroy?.();
    pipeline.destroy();
  }, { once: true });
}
