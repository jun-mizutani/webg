// -------------------------------------------------
// cube4
//   main.js       2026/04/16
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// -------------------------------------------------

import WebgApp from "../../webg/WebgApp.js";
import EyeRig from "../../webg/EyeRig.js";
import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";
import GameAudioSynth from "../../webg/GameAudioSynth.js";

const FONT_FILE = "../../webg/font512.png";
const SAVE_KEY = "samples.cube4.highScore";

const BOARD = {
  width: 6,
  depth: 6,
  height: 10,
  cell: 2.5
};

const BASE_Y = -11.0;
const HUD_STATUS_OPTIONS = {
  anchor: "top-left",
  x: 1,
  y: 0,
  color: [0.98, 0.93, 0.84]
};
const HUD_GUIDE_OPTIONS = {
  anchor: "bottom-left",
  x: 1,
  y: 0,
  color: [0.88, 0.95, 1.0]
};

const PIECES = [
  {
    name: "line",
    color: [0.30, 0.88, 0.96, 1.0],
    cells: [[-1, 0, 0], [0, 0, 0], [1, 0, 0], [2, 0, 0]]
  },
  {
    name: "square",
    color: [0.98, 0.85, 0.26, 1.0],
    cells: [[0, 0, 0], [1, 0, 0], [0, 0, 1], [1, 0, 1]]
  },
  {
    name: "tee",
    color: [0.84, 0.46, 0.98, 1.0],
    cells: [[-1, 0, 0], [0, 0, 0], [1, 0, 0], [0, 0, 1]]
  },
  {
    name: "el",
    color: [0.98, 0.58, 0.24, 1.0],
    cells: [[-1, 0, 0], [0, 0, 0], [1, 0, 0], [1, 0, 1]]
  },
  {
    name: "zig",
    color: [0.38, 0.94, 0.52, 1.0],
    cells: [[-1, 0, 0], [0, 0, 0], [0, 0, 1], [1, 0, 1]]
  },
  {
    name: "tripod",
    color: [0.99, 0.35, 0.44, 1.0],
    cells: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]]
  },
  {
    name: "screw",
    color: [0.34, 0.68, 1.0, 1.0],
    cells: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [1, 1, 1]]
  },
  {
    name: "chair",
    color: [1.0, 0.52, 0.74, 1.0],
    cells: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [1, 1, 1]]
  }
];

const LAYER_CLEAR_RATIO = 0.8;
const LAYER_CELL_COUNT = BOARD.width * BOARD.depth;
const LAYER_CLEAR_COUNT = Math.ceil(LAYER_CELL_COUNT * LAYER_CLEAR_RATIO);

let app = null;
let orbit = null;
let audio = null;

const cloneCells = (cells) => cells.map((cell) => [...cell]);
const colorKey = (color) => color.map((value) => value.toFixed(3)).join(",");
const materialKey = (material = {}) => JSON.stringify({
  ambient: material.ambient ?? 0.22,
  specular: material.specular ?? 0.88,
  power: material.power ?? 54.0,
  emissive: material.emissive ?? 0.0,
  flat_shading: material.flat_shading ?? 0
});

const showStartError = (error) => {
  const existing = document.getElementById("start-error");
  if (existing) existing.remove();
  const panel = document.createElement("pre");
  panel.id = "start-error";
  panel.textContent = `cube4 failed\n${error?.message ?? String(error ?? "")}`;
  Object.assign(panel.style, {
    position: "fixed",
    left: "12px",
    top: "12px",
    margin: "0",
    padding: "12px 14px",
    background: "rgba(30, 18, 22, 0.92)",
    color: "#ffe0e7",
    border: "1px solid rgba(255, 155, 173, 0.55)",
    borderRadius: "10px",
    whiteSpace: "pre-wrap",
    maxWidth: "min(560px, calc(100vw - 24px))",
    zIndex: "50"
  });
  document.body.appendChild(panel);
};

const setShapeColor = (shape, color, material = {}) => {
  shape.setMaterial("smooth-shader", {
    has_bone: 0,
    use_texture: 0,
    color: [...color],
    ambient: material.ambient ?? 0.22,
    specular: material.specular ?? 0.88,
    power: material.power ?? 54.0,
    emissive: material.emissive ?? 0.0,
    flat_shading: material.flat_shading ?? 0
  });
};

const createCubeShape = (gpu, color, size = BOARD.cell * 0.90, material = {}) => {
  const shape = new Shape(gpu);
  shape.applyPrimitiveAsset(Primitive.cube(size, shape.getPrimitiveOptions()));
  shape.endShape();
  setShapeColor(shape, color, material);
  return shape;
};

const createBeveledBoxShape = (gpu, width, height, depth, bevel, color, material = {}) => {
  const shape = new Shape(gpu);
  const hx = width * 0.5;
  const hy = height * 0.5;
  const hz = depth * 0.5;
  const b = Math.max(0.01, Math.min(bevel, Math.min(hx, hy, hz) * 0.45));
  const ix = hx - b;
  const iy = hy - b;
  const iz = hz - b;

  const addFace = (pts) => {
    const n = pts.length;
    const cx = pts.reduce((sum, p) => sum + p[0], 0) / n;
    const cy = pts.reduce((sum, p) => sum + p[1], 0) / n;
    const cz = pts.reduce((sum, p) => sum + p[2], 0) / n;
    const [p0, p1, p2] = pts;
    const ux = p1[0] - p0[0];
    const uy = p1[1] - p0[1];
    const uz = p1[2] - p0[2];
    const vx = p2[0] - p0[0];
    const vy = p2[1] - p0[1];
    const vz = p2[2] - p0[2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const outward = nx * cx + ny * cy + nz * cz;
    const ordered = outward >= 0.0 ? pts : [...pts].reverse();
    const indices = [];
    for (let i = 0; i < ordered.length; i++) {
      const p = ordered[i];
      indices.push(shape.addVertex(p[0], p[1], p[2]) - 1);
    }
    shape.addPlane(indices);
  };

  addFace([[-ix, -iy, hz], [ix, -iy, hz], [ix, iy, hz], [-ix, iy, hz]]);
  addFace([[-ix, -iy, -hz], [-ix, iy, -hz], [ix, iy, -hz], [ix, -iy, -hz]]);
  addFace([[hx, -iy, -iz], [hx, iy, -iz], [hx, iy, iz], [hx, -iy, iz]]);
  addFace([[-hx, -iy, -iz], [-hx, -iy, iz], [-hx, iy, iz], [-hx, iy, -iz]]);
  addFace([[-ix, hy, -iz], [-ix, hy, iz], [ix, hy, iz], [ix, hy, -iz]]);
  addFace([[-ix, -hy, -iz], [ix, -hy, -iz], [ix, -hy, iz], [-ix, -hy, iz]]);

  addFace([[-ix, iy, hz], [ix, iy, hz], [ix, hy, iz], [-ix, hy, iz]]);
  addFace([[-ix, -hy, iz], [ix, -hy, iz], [ix, -iy, hz], [-ix, -iy, hz]]);
  addFace([[-ix, hy, -iz], [ix, hy, -iz], [ix, iy, -hz], [-ix, iy, -hz]]);
  addFace([[-ix, -iy, -hz], [ix, -iy, -hz], [ix, -hy, -iz], [-ix, -hy, -iz]]);

  addFace([[ix, -iy, hz], [ix, iy, hz], [hx, iy, iz], [hx, -iy, iz]]);
  addFace([[-hx, -iy, iz], [-hx, iy, iz], [-ix, iy, hz], [-ix, -iy, hz]]);
  addFace([[-ix, -iy, -hz], [-ix, iy, -hz], [-hx, iy, -iz], [-hx, -iy, -iz]]);
  addFace([[hx, -iy, -iz], [hx, iy, -iz], [ix, iy, -hz], [ix, -iy, -hz]]);

  addFace([[ix, hy, -iz], [ix, hy, iz], [hx, iy, iz], [hx, iy, -iz]]);
  addFace([[-hx, iy, -iz], [-hx, iy, iz], [-ix, hy, iz], [-ix, hy, -iz]]);
  addFace([[-ix, -hy, -iz], [-ix, -hy, iz], [-hx, -iy, iz], [-hx, -iy, -iz]]);
  addFace([[hx, -iy, -iz], [hx, -iy, iz], [ix, -hy, iz], [ix, -hy, -iz]]);

  addFace([[ix, iy, hz], [hx, iy, iz], [ix, hy, iz]]);
  addFace([[-ix, iy, hz], [-ix, hy, iz], [-hx, iy, iz]]);
  addFace([[ix, -iy, hz], [ix, -hy, iz], [hx, -iy, iz]]);
  addFace([[-ix, -iy, hz], [-hx, -iy, iz], [-ix, -hy, iz]]);

  addFace([[ix, iy, -hz], [ix, hy, -iz], [hx, iy, -iz]]);
  addFace([[-ix, iy, -hz], [-hx, iy, -iz], [-ix, hy, -iz]]);
  addFace([[ix, -iy, -hz], [hx, -iy, -iz], [ix, -hy, -iz]]);
  addFace([[-ix, -iy, -hz], [-ix, -hy, -iz], [-hx, -iy, -iz]]);

  shape.endShape();
  setShapeColor(shape, color, {
    ...material,
    flat_shading: material.flat_shading ?? 1
  });
  return shape;
};

const createCuboidShape = (gpu, width, height, depth, color, material = {}) => {
  const shape = new Shape(gpu);
  shape.applyPrimitiveAsset(Primitive.cuboid(width, height, depth, shape.getPrimitiveOptions()));
  shape.endShape();
  setShapeColor(shape, color, material);
  return shape;
};

const createSlot = (space, name, gpu, options = {}, parentNode = null) => {
  const node = space.addNode(parentNode, name);
  const shape = createBeveledBoxShape(
    gpu,
    options.size ?? BOARD.cell * 0.90,
    options.size ?? BOARD.cell * 0.90,
    options.size ?? BOARD.cell * 0.90,
    options.bevel ?? BOARD.cell * 0.12,
    options.color ?? [0.9, 0.9, 0.9, 1.0],
    {
      emissive: 0.5,
      ...(options.material ?? {})
    }
  );
  node.addShape(shape);
  node.hide(true);
  return {
    node,
    shape,
    visible: false,
    colorKey: "",
    materialKey: "",
    scale: 1.0
  };
};

const applySlot = (slot, visible, position, color, material = {}, scale = 1.0) => {
  if (!slot) return;
  if (!visible) {
    if (slot.visible) {
      slot.node.hide(true);
      slot.visible = false;
    }
    return;
  }

  slot.node.setPosition(position[0], position[1], position[2]);
  if (slot.scale !== scale) {
    slot.node.setScale(scale);
    slot.scale = scale;
  }

  const nextColorKey = colorKey(color);
  const nextMaterialKey = materialKey(material);
  if (slot.colorKey !== nextColorKey || slot.materialKey !== nextMaterialKey) {
    setShapeColor(slot.shape, color, material);
    slot.colorKey = nextColorKey;
    slot.materialKey = nextMaterialKey;
  }

  if (!slot.visible) {
    slot.node.hide(false);
    slot.visible = true;
  }
};

const emptyLayer = () =>
  Array.from({ length: BOARD.depth }, () => Array(BOARD.width).fill(null));

const createBoard = () =>
  Array.from({ length: BOARD.height }, () => emptyLayer());

const hideSlotSet = (slots) => {
  for (let i = 0; i < slots.length; i++) {
    applySlot(slots[i], false);
  }
};

const rotateCell = ([x, y, z], axis) => {
  if (axis === "x") return [x, -z, y];
  if (axis === "y") return [z, y, -x];
  return [-y, x, z];
};

const rotateCells = (cells, axis) => cells.map((cell) => rotateCell(cell, axis));
const rotatePointEuler = (point, yawDeg, pitchDeg, bankDeg) => {
  const yaw = yawDeg * Math.PI / 180.0;
  const pitch = pitchDeg * Math.PI / 180.0;
  const bank = bankDeg * Math.PI / 180.0;
  let [x, y, z] = point;

  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  [x, z] = [x * cy + z * sy, -x * sy + z * cy];

  const cx = Math.cos(pitch);
  const sx = Math.sin(pitch);
  [y, z] = [y * cx - z * sx, y * sx + z * cx];

  const cz = Math.cos(bank);
  const sz = Math.sin(bank);
  [x, y] = [x * cz - y * sz, x * sz + y * cz];

  return [x, y, z];
};

const getExtents = (cells) => {
  const xs = cells.map((cell) => cell[0]);
  const ys = cells.map((cell) => cell[1]);
  const zs = cells.map((cell) => cell[2]);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
    minZ: Math.min(...zs),
    maxZ: Math.max(...zs)
  };
};

const choosePiece = (bag) => {
  if (bag.length === 0) {
    const next = PIECES.map((piece) => piece);
    for (let i = next.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [next[i], next[j]] = [next[j], next[i]];
    }
    bag.push(...next);
  }
  const def = bag.shift();
  return {
    name: def.name,
    color: [...def.color],
    cells: cloneCells(def.cells)
  };
};

const worldFromGrid = (x, y, z) => [
  (x - (BOARD.width - 1) * 0.5) * BOARD.cell,
  BASE_Y + y * BOARD.cell,
  (z - (BOARD.depth - 1) * 0.5) * BOARD.cell
];

const getOrbitYawDeg = () => Number.isFinite(orbit?.orbit?.yaw) ? orbit.orbit.yaw : 0.0;
const playSe = (name) => {
  try {
    audio?.playSe(name);
  } catch (_) {
    // 最初のユーザー操作前など、まだ audio context が使えない場面は黙って流す
  }
};

const resolveCameraRelativeMove = (direction) => {
  const rad = getOrbitYawDeg() * Math.PI / 180.0;
  const forward = [-Math.sin(rad), -Math.cos(rad)];
  const right = [-forward[1], forward[0]];
  const basis = direction === "up"
    ? forward
    : direction === "down"
      ? [-forward[0], -forward[1]]
      : direction === "right"
        ? right
        : [-right[0], -right[1]];

  if (Math.abs(basis[0]) >= Math.abs(basis[1])) {
    return [basis[0] >= 0.0 ? 1 : -1, 0, 0];
  }
  return [0, 0, basis[1] >= 0.0 ? 1 : -1];
};

const createDemoGallery = (space, gpu) => {
  const boardWidth = BOARD.width * BOARD.cell;
  const boardDepth = BOARD.depth * BOARD.cell;
  const cols = 4;
  const spacingX = boardWidth * 0.34;
  const spacingZ = boardDepth * 0.60;
  const startX = -spacingX * 1.5;
  const positions = [];
  for (let i = 0; i < PIECES.length; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    positions.push([
      startX + col * spacingX,
      BASE_Y + BOARD.height * BOARD.cell * (row === 0 ? 0.70 : 0.46),
      row === 0 ? -spacingZ * 0.34 : spacingZ * 0.18
    ]);
  }

  return PIECES.map((def, index) => {
    const root = space.addNode(null, `demo_root_${def.name}`);
    root.setPosition(...positions[index]);
    const localPositions = [];
    const slots = Array.from({ length: def.cells.length }, (_, cellIndex) =>
      createSlot(space, `demo_${def.name}_${cellIndex}`, gpu, {
        size: BOARD.cell * 0.84,
        bevel: BOARD.cell * 0.10,
        color: def.color,
        material: {
          ambient: 0.22,
          specular: 0.92,
          power: 68.0,
          emissive: 0.0
        }
      }, root)
    );

    const extents = getExtents(def.cells);
    const center = [
      (extents.minX + extents.maxX) * 0.5,
      (extents.minY + extents.maxY) * 0.5,
      (extents.minZ + extents.maxZ) * 0.5
    ];
    for (let i = 0; i < def.cells.length; i++) {
      const [x, y, z] = def.cells[i];
      const localPosition = [
        (x - center[0]) * BOARD.cell * 0.90,
        (y - center[1]) * BOARD.cell * 0.90,
        (z - center[2]) * BOARD.cell * 0.90
      ];
      localPositions.push(localPosition);
      applySlot(
        slots[i],
        true,
        localPosition,
        def.color,
        {
          ambient: 0.22,
          specular: 0.92,
          power: 68.0,
          emissive: 0.0,
          flat_shading: 1
        },
        1.0
      );
    }

    return {
      root,
      slots,
      localPositions,
      baseAngles: {
        yaw: index * 24.0,
        pitch: -14.0 + (index % 3) * 9.0,
        bank: (index % 2 === 0 ? 12.0 : -12.0)
      },
      speed: {
        yaw: (index % 2 === 0 ? 1 : -1) * (3.0 + index * 0.45),
        pitch: (index % 3 === 0 ? -1 : 1) * (1.4 + (index % 4) * 0.35),
        bank: (index % 2 === 0 ? 1 : -1) * (1.9 + (index % 3) * 0.45)
      },
      basePosition: positions[index]
    };
  });
};

const updateDemoGallery = (gallery, visible, timeSec) => {
  if (!Array.isArray(gallery)) return;
  for (let i = 0; i < gallery.length; i++) {
    const item = gallery[i];
    if (!item?.root) continue;
    if (!visible) {
      hideSlotSet(item.slots);
      continue;
    }
    for (let j = 0; j < item.slots.length; j++) {
      const slot = item.slots[j];
      if (!slot.visible) {
        slot.node.hide(false);
        slot.visible = true;
      }
    }
    item.root.setPosition(
      item.basePosition[0],
      item.basePosition[1] + Math.sin(timeSec * (0.8 + i * 0.11)) * 0.45,
      item.basePosition[2]
    );
    item.root.dirty = true;
    const yaw = item.baseAngles.yaw + timeSec * item.speed.yaw;
    const pitch = item.baseAngles.pitch + Math.sin(timeSec * item.speed.pitch + i * 0.7) * 18.0;
    const bank = item.baseAngles.bank + Math.cos(timeSec * item.speed.bank + i * 0.45) * 16.0;
    for (let j = 0; j < item.slots.length; j++) {
      const slot = item.slots[j];
      const rotated = rotatePointEuler(item.localPositions[j], yaw, pitch, bank);
      slot.node.setPosition(rotated[0], rotated[1], rotated[2]);
      slot.node.setAttitude(yaw, pitch, bank);
      slot.node.dirty = true;
    }
  }
};

const makeRuntime = (space, gpu) => {
  const lockedSlots = [];
  for (let y = 0; y < BOARD.height; y++) {
    const layer = [];
    for (let z = 0; z < BOARD.depth; z++) {
      const row = [];
      for (let x = 0; x < BOARD.width; x++) {
        row.push(createSlot(space, `locked_${x}_${y}_${z}`, gpu, {
          size: BOARD.cell * 0.86,
          material: {
            ambient: 0.24,
            specular: 0.82,
            power: 48.0
          }
        }));
      }
      layer.push(row);
    }
    lockedSlots.push(layer);
  }

  const activeSlots = Array.from({ length: 4 }, (_, index) =>
    createSlot(space, `active_${index}`, gpu, {
      size: BOARD.cell * 0.90,
      material: {
        ambient: 0.20,
        specular: 1.08,
        power: 76.0,
        emissive: 0.5
      }
    })
  );

  const ghostSlots = Array.from({ length: 4 }, (_, index) =>
    createSlot(space, `ghost_${index}`, gpu, {
      size: BOARD.cell * 0.78,
      color: [0.35, 0.44, 0.58, 1.0],
      material: {
        ambient: 0.64,
        specular: 0.16,
        power: 14.0
      }
    })
  );

  const previewSlots = Array.from({ length: 4 }, (_, index) =>
    createSlot(space, `preview_${index}`, gpu, {
      size: BOARD.cell * 0.68,
      material: {
        ambient: 0.24,
        specular: 0.96,
        power: 52.0
      }
    })
  );

  return {
    board: createBoard(),
    bag: [],
    active: null,
    next: null,
    score: 0,
    lines: 0,
    level: 1,
    fallTimer: 0.0,
    started: false,
    paused: false,
    gameOver: false,
    highScore: Number(app.loadProgress(SAVE_KEY, 0) ?? 0),
    lockedSlots,
    activeSlots,
    ghostSlots,
    previewSlots,
    demoGallery: createDemoGallery(space, gpu),
    dirtyVisuals: true
  };
};

const getCellsInWorld = (piece) =>
  piece.cells.map(([x, y, z]) => [x + piece.position.x, y + piece.position.y, z + piece.position.z]);

const isInsideBoard = (x, y, z) =>
  x >= 0 && x < BOARD.width && y >= 0 && y < BOARD.height && z >= 0 && z < BOARD.depth;

const canPlace = (runtime, cells) => {
  for (let i = 0; i < cells.length; i++) {
    const [x, y, z] = cells[i];
    if (!isInsideBoard(x, y, z)) return false;
    if (runtime.board[y][z][x] !== null) return false;
  }
  return true;
};

const computeSpawnPosition = (cells) => {
  const extents = getExtents(cells);
  let x = Math.floor((BOARD.width - 1) * 0.5);
  let z = Math.floor((BOARD.depth - 1) * 0.5);
  const y = BOARD.height - 1 - extents.maxY;

  if (x + extents.minX < 0) x -= x + extents.minX;
  if (x + extents.maxX >= BOARD.width) x -= x + extents.maxX - (BOARD.width - 1);
  if (z + extents.minZ < 0) z -= z + extents.minZ;
  if (z + extents.maxZ >= BOARD.depth) z -= z + extents.maxZ - (BOARD.depth - 1);

  return { x, y, z };
};

const updateHighScore = (runtime) => {
  if (runtime.score > runtime.highScore) {
    runtime.highScore = runtime.score;
    app.saveProgress(SAVE_KEY, runtime.highScore);
  }
};

const spawnPiece = (runtime) => {
  runtime.active = runtime.next ?? choosePiece(runtime.bag);
  runtime.next = choosePiece(runtime.bag);
  runtime.active.position = computeSpawnPosition(runtime.active.cells);
  runtime.fallTimer = 0.0;
  runtime.dirtyVisuals = true;

  if (!canPlace(runtime, getCellsInWorld(runtime.active))) {
    runtime.gameOver = true;
    runtime.active = null;
    playSe("gameover");
    app.pushToast("Game Over", { durationMs: 1800 });
  }
};

const restartGame = (runtime) => {
  runtime.board = createBoard();
  runtime.bag = [];
  runtime.active = null;
  runtime.next = null;
  runtime.score = 0;
  runtime.lines = 0;
  runtime.level = 1;
  runtime.fallTimer = 0.0;
  runtime.started = false;
  runtime.paused = false;
  runtime.gameOver = false;
  runtime.dirtyVisuals = true;
  spawnPiece(runtime);
  playSe("countdown");
  app.pushToast("Restarted", { durationMs: 1000 });
};

const beginGame = (runtime) => {
  if (runtime.started || runtime.gameOver) return;
  runtime.started = true;
  runtime.fallTimer = 0.0;
  try {
    audio?.startBgm();
  } catch (_) {
    // user gesture 由来の最初の開始時に鳴れば十分
  }
  playSe("ui_ok");
};

const tryMove = (runtime, dx, dy, dz) => {
  if (!runtime.active || runtime.gameOver) return false;
  const candidate = {
    ...runtime.active.position,
    x: runtime.active.position.x + dx,
    y: runtime.active.position.y + dy,
    z: runtime.active.position.z + dz
  };
  const cells = runtime.active.cells.map(([x, y, z]) => [x + candidate.x, y + candidate.y, z + candidate.z]);
  if (!canPlace(runtime, cells)) return false;
  runtime.active.position = candidate;
  runtime.dirtyVisuals = true;
  return true;
};

const tryRotate = (runtime, axis) => {
  if (!runtime.active || runtime.gameOver) return false;
  const rotated = rotateCells(runtime.active.cells, axis);
  const kicks = [
    [0, 0, 0],
    [1, 0, 0],
    [-1, 0, 0],
    [0, 0, 1],
    [0, 0, -1],
    [0, 1, 0]
  ];

  for (let i = 0; i < kicks.length; i++) {
    const [dx, dy, dz] = kicks[i];
    const cells = rotated.map(([x, y, z]) => [
      x + runtime.active.position.x + dx,
      y + runtime.active.position.y + dy,
      z + runtime.active.position.z + dz
    ]);
    if (canPlace(runtime, cells)) {
      runtime.active.cells = rotated;
      runtime.active.position.x += dx;
      runtime.active.position.y += dy;
      runtime.active.position.z += dz;
      runtime.dirtyVisuals = true;
      return true;
    }
  }
  return false;
};

const lockPiece = (runtime) => {
  if (!runtime.active) return;
  const worldCells = getCellsInWorld(runtime.active);
  for (let i = 0; i < worldCells.length; i++) {
    const [x, y, z] = worldCells[i];
    runtime.board[y][z][x] = [...runtime.active.color];
  }
  runtime.active = null;

  const preserved = [];
  const clearedLayers = [];
  for (let y = 0; y < BOARD.height; y++) {
    const fillCount = countLayerBlocks(runtime.board[y]);
    if (fillCount >= LAYER_CLEAR_COUNT) {
      clearedLayers.push(fillCount);
    } else {
      preserved.push(runtime.board[y]);
    }
  }

  while (preserved.length < BOARD.height) {
    preserved.push(emptyLayer());
  }
  runtime.board = preserved;

  const cleared = clearedLayers.length;
  if (cleared > 0) {
    runtime.lines += cleared;
    const layerScore = clearedLayers.reduce((sum, fillCount) => sum + scoreForClearedLayer(fillCount), 0);
    const chainBonus = cleared > 1 ? 1.0 + (cleared - 1) * 0.35 : 1.0;
    runtime.score += Math.round(layerScore * chainBonus * runtime.level);
    runtime.level = 1 + Math.floor(runtime.lines / 6);
    playSe("levelup");
    const perfectCount = clearedLayers.filter((fillCount) => fillCount >= LAYER_CELL_COUNT).length;
    const minFill = Math.min(...clearedLayers);
    if (perfectCount === cleared) {
      app.pushToast(`${cleared} perfect layer clear`, { durationMs: 1300 });
    } else {
      app.pushToast(`${cleared} layer clear (${minFill}/${LAYER_CELL_COUNT}+ filled)`, { durationMs: 1300 });
    }
  } else {
    playSe("block");
  }

  updateHighScore(runtime);
  spawnPiece(runtime);
};

const hardDrop = (runtime) => {
  if (!runtime.active || runtime.gameOver) return;
  let steps = 0;
  while (tryMove(runtime, 0, -1, 0)) {
    steps += 1;
  }
  runtime.score += steps * 2;
  updateHighScore(runtime);
  lockPiece(runtime);
};

const computeGhostCells = (runtime) => {
  if (!runtime.active) return [];
  let offset = 0;
  let cells = getCellsInWorld(runtime.active);
  while (true) {
    const next = cells.map(([x, y, z]) => [x, y - 1, z]);
    if (!canPlace(runtime, next)) break;
    cells = next;
    offset += 1;
  }
  return offset > 0 ? cells : [];
};

const countLayerBlocks = (layer) => {
  let count = 0;
  for (let z = 0; z < BOARD.depth; z++) {
    for (let x = 0; x < BOARD.width; x++) {
      if (layer[z][x] !== null) count += 1;
    }
  }
  return count;
};

const scoreForClearedLayer = (fillCount) => {
  if (fillCount >= LAYER_CELL_COUNT) return 520;
  const ratio = (fillCount - LAYER_CLEAR_COUNT) / Math.max(1, LAYER_CELL_COUNT - LAYER_CLEAR_COUNT);
  const clamped = Math.max(0.0, Math.min(1.0, ratio));
  return Math.round(120 + clamped * 180);
};

const renderBoard = (runtime) => {
  for (let y = 0; y < BOARD.height; y++) {
    for (let z = 0; z < BOARD.depth; z++) {
      for (let x = 0; x < BOARD.width; x++) {
        const slot = runtime.lockedSlots[y][z][x];
        const cellColor = runtime.board[y][z][x];
        if (cellColor === null) {
          applySlot(slot, false);
          continue;
        }
        applySlot(
          slot,
          true,
          worldFromGrid(x, y, z),
          cellColor,
          {
            ambient: 0.26,
            specular: 0.78,
            power: 48.0,
            flat_shading: 1
          }
        );
      }
    }
  }

  for (let i = 0; i < runtime.activeSlots.length; i++) {
    applySlot(runtime.activeSlots[i], false);
    applySlot(runtime.ghostSlots[i], false);
  }

  if (runtime.started && runtime.active) {
    const activeCells = getCellsInWorld(runtime.active);
    for (let i = 0; i < activeCells.length; i++) {
      applySlot(
        runtime.activeSlots[i],
        true,
        worldFromGrid(...activeCells[i]),
        runtime.active.color,
        {
          ambient: 0.18,
          specular: 1.10,
          power: 82.0,
          emissive: 0.8,
          flat_shading: 1
        }
      );
    }

    const ghostCells = computeGhostCells(runtime);
    for (let i = 0; i < ghostCells.length; i++) {
      applySlot(
        runtime.ghostSlots[i],
        true,
        worldFromGrid(...ghostCells[i]),
        [0.32, 0.40, 0.54, 1.0],
        {
          ambient: 0.66,
          specular: 0.12,
          power: 12.0,
          flat_shading: 1
        }
      );
    }
  }

  for (let i = 0; i < runtime.previewSlots.length; i++) {
    applySlot(runtime.previewSlots[i], false);
  }

  if (runtime.started && runtime.next) {
    const previewBase = [BOARD.width * BOARD.cell * 0.96, BASE_Y + BOARD.height * BOARD.cell * 0.72, -BOARD.depth * BOARD.cell * 0.82];
    for (let i = 0; i < runtime.next.cells.length; i++) {
      const [x, y, z] = runtime.next.cells[i];
      applySlot(
        runtime.previewSlots[i],
        true,
        [
          previewBase[0] + x * (BOARD.cell * 0.82),
          previewBase[1] + y * (BOARD.cell * 0.82),
          previewBase[2] + z * (BOARD.cell * 0.82)
        ],
        runtime.next.color,
        {
          ambient: 0.22,
          specular: 0.94,
          power: 54.0,
          flat_shading: 1
        }
      );
    }
  }

  runtime.dirtyVisuals = false;
};

const updateHud = (runtime) => {
  if (!runtime.started || runtime.gameOver) {
    app.setStatusLines([
      runtime.gameOver
        ? `game over  score ${runtime.score}  level ${runtime.level}  layer ${runtime.lines}`
        : `score ${runtime.score}  level ${runtime.level}  layer ${runtime.lines}  press move/rotate/drop to start`
    ], HUD_STATUS_OPTIONS);
    app.setGuideLines([
      "A / S / D: rotate around X / Y / Z",
      "X: 1 step down   Space: hard drop",
      "P: pause   R: restart   K: screenshot"
    ], HUD_GUIDE_OPTIONS);
    return;
  }

  app.setStatusLines([
    `score ${runtime.score}  level ${runtime.level}  layer ${runtime.lines}`
  ], HUD_STATUS_OPTIONS);
  app.setGuideLines([], HUD_GUIDE_OPTIONS);
};

const createDecor = (space, gpu) => {
  const center = worldFromGrid((BOARD.width - 1) * 0.5, 0.0, (BOARD.depth - 1) * 0.5);
  const boardWidth = BOARD.width * BOARD.cell;
  const boardDepth = BOARD.depth * BOARD.cell;
  const boardHeight = BOARD.height * BOARD.cell;

  const floorNode = space.addNode(null, "floor");
  floorNode.setPosition(center[0], BASE_Y - BOARD.cell * 0.9, center[2]);
  floorNode.addShape(createCuboidShape(
    gpu,
    boardWidth,
    0.8,
    boardDepth,
    [0.20, 0.26, 0.34, 1.0],
    {
      ambient: 0.42,
      specular: 0.10,
      power: 6.0
    }
  ));

  const pedestalNode = space.addNode(null, "pedestal");
  pedestalNode.setPosition(center[0], BASE_Y - BOARD.cell * 1.35, center[2]);
  pedestalNode.addShape(createCuboidShape(
    gpu,
    boardWidth,
    0.18,
    boardDepth,
    [0.16, 0.20, 0.27, 1.0],
    {
      ambient: 0.20,
      specular: 0.08,
      power: 6.0
    }
  ));

  const beaconShape = createCubeShape(gpu, [0.96, 0.42, 0.24, 1.0], BOARD.cell * 0.26, {
    ambient: 0.30,
    specular: 1.20,
    power: 110.0,
    emissive: 0.55
  });
  const beaconNode = space.addNode(null, "beacon");
  beaconNode.setPosition(center[0], BASE_Y + boardHeight + 0.8, center[2]);
  beaconNode.addShape(beaconShape);

  return { beaconNode, center, boardHeight };
};

const setupOrbit = () => {
  orbit = new EyeRig(app.cameraRig, app.cameraRod, app.eye, {
    document,
    element: app.screen.canvas,
    input: app.input,
    type: "orbit",
    orbit: {
      target: [0.0, BASE_Y + BOARD.height * BOARD.cell * 0.42, 0.0],
      distance: 43.0,
      yaw: 18.0,
      pitch: -30.0,
      minDistance: 22.0,
      maxDistance: 78.0,
      wheelZoomStep: 1.4,
      keyMap: {
        left: "_",
        right: "_",
        up: "_",
        down: "_",
        zoomIn: "_",
        zoomOut: "_"
      }
    }
  });
  orbit.attachPointer();
};

const fallIntervalSec = (runtime) => Math.max(0.42, 1.95 - (runtime.level - 1) * 0.12);

const attachInput = (runtime) => {
  app.attachInput({
    onKeyDown: (key, ev) => {
      if (runtime.gameOver && key !== "r") return;
      if (key === "p" && !ev.repeat) {
        runtime.paused = !runtime.paused;
        playSe(runtime.paused ? "ui_ok" : "ui_move");
        app.pushToast(runtime.paused ? "Paused" : "Resumed", { durationMs: 900 });
        return;
      }
      if (key === "r" && !ev.repeat) {
        restartGame(runtime);
        return;
      }
      if (key === "k" && !ev.repeat) {
        const file = app.takeScreenshot({ prefix: "cube4" });
        playSe("coin");
        app.pushToast(`screenshot: ${file}`, { durationMs: 1400 });
        return;
      }
      if (runtime.paused) return;

      if (key === "arrowleft") {
        beginGame(runtime);
        if (tryMove(runtime, ...resolveCameraRelativeMove("left"))) playSe("ui_move");
      } else if (key === "arrowright") {
        beginGame(runtime);
        if (tryMove(runtime, ...resolveCameraRelativeMove("right"))) playSe("ui_move");
      } else if (key === "arrowup") {
        beginGame(runtime);
        if (tryMove(runtime, ...resolveCameraRelativeMove("up"))) playSe("ui_move");
      } else if (key === "arrowdown") {
        beginGame(runtime);
        if (tryMove(runtime, ...resolveCameraRelativeMove("down"))) playSe("ui_move");
      } else if (key === "a" && !ev.repeat) {
        beginGame(runtime);
        if (tryRotate(runtime, "x")) playSe("piyoon");
      } else if (key === "s" && !ev.repeat) {
        beginGame(runtime);
        if (tryRotate(runtime, "y")) playSe("piyoon");
      } else if (key === "d" && !ev.repeat) {
        beginGame(runtime);
        if (tryRotate(runtime, "z")) playSe("piyoon");
      } else if (key === "space" && !ev.repeat) {
        beginGame(runtime);
        hardDrop(runtime);
      } else if (key === "x") {
        beginGame(runtime);
        if (tryMove(runtime, 0, -1, 0)) {
          runtime.score += 1;
          updateHighScore(runtime);
          playSe("ui_move");
        } else {
          lockPiece(runtime);
        }
      }
    }
  });
};

const start = async () => {
  app = new WebgApp({
    document,
    clearColor: [0.05, 0.07, 0.11, 1.0],
    lightPosition: [90.0, 160.0, 120.0, 1.0],
    viewAngle: 52.0,
    projectionFar: 1400.0,
    messageFontTexture: FONT_FILE,
    camera: {
      target: [0.0, BASE_Y + BOARD.height * BOARD.cell * 0.42, 0.0],
      distance: 48.0,
      yaw: 18.0,
      pitch: -30.0
    },
    debugTools: {
      mode: "release"
    }
  });
  await app.init();
  audio = new GameAudioSynth();
  audio.setMasterVolume(0.22);
  audio.setSeVolume(0.78);
  audio.setSeReverb(0.14);
  audio.setBgmVolume(0.18);
  audio.setBpm(96);
  audio.setMelody("night_drive");
  audio.setBgmDelay(0.20, 0.18, 0.12);
  audio.setBgmReverb(0.18, 0.26);

  const runtime = makeRuntime(app.space, app.getGL());
  const decor = createDecor(app.space, app.getGL());
  setupOrbit();
  attachInput(runtime);
  spawnPiece(runtime);
  renderBoard(runtime);
  updateHud(runtime);
  app.pushToast("3D cube4 ready", { durationMs: 1200 });

  app.start({
    onUpdate: ({ deltaSec }) => {
      orbit.update(deltaSec);
      updateDemoGallery(runtime.demoGallery, !runtime.started, app.runtimeElapsedSec);
      decor.beaconNode.rotateY(36.0 * deltaSec);
      decor.beaconNode.setPosition(
        decor.center[0],
        BASE_Y + decor.boardHeight + 0.8 + Math.sin(app.runtimeElapsedSec * 1.8) * 0.32,
        decor.center[2]
      );

      if (runtime.started && !runtime.paused && !runtime.gameOver && runtime.active) {
        runtime.fallTimer += deltaSec;
        if (runtime.fallTimer >= fallIntervalSec(runtime)) {
          runtime.fallTimer = 0.0;
          if (!tryMove(runtime, 0, -1, 0)) {
            lockPiece(runtime);
          }
        }
      }

      if (runtime.dirtyVisuals) {
        renderBoard(runtime);
      }
      updateHud(runtime);
    }
  });
};

document.addEventListener("DOMContentLoaded", () => {
  start().catch((error) => {
    console.error("cube4 failed:", error);
    app?.showErrorPanel?.(error, {
      title: "cube4 failed",
      id: "start-error",
      background: "rgba(28, 18, 20, 0.92)"
    });
    if (!app) {
      showStartError(error);
    }
  });
});
