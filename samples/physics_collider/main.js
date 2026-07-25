// ---------------------------------------------
// samples/physics_collider/main.js  2026/07/25
//   physics_collider sample
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import WebgApp from "../../webg/WebgApp.js";
import { buildErrorPanelOptions } from "../../webg/OverlayPanelPresets.js";
import BoxCollider from "../../webg/BoxCollider.js";
import PlaneCollider from "../../webg/PlaneCollider.js";
import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";
import PhysicsSpace from "../../webg/PhysicsSpace.js";

const FONT_FILE = "../../webg/font512.png";

// 背景色はやや暗めのグレー
const CLEAR_COLOR = [0.1, 0.1, 0.15, 1.0];
// 1 unit = 1 meter を前提に、1.2m x 1.2m ほどの浅いトレーを卓上実験の舞台として使う
const FLOOR_HEIGHT = 0.06;
const FLOOR_TOP_Y = 0.0;
const FLOOR_CENTER_Y = FLOOR_TOP_Y - FLOOR_HEIGHT * 0.5;
const FLOOR_SIZE = [1.2, FLOOR_HEIGHT, 1.2];
const ARENA_CENTER_Z = 0.0;
const WALL_HEIGHT = 0.12;
const WALL_THICKNESS = 0.04;
const WALL_CENTER_Y = FLOOR_TOP_Y + WALL_HEIGHT * 0.5;
const CONTACT_FLASH_MS = 90.0;
const DEFAULT_BODY_COUNT = 24;
const MAX_BODY_COUNT = 200;
const RELEASE_INTERVAL_MS = 20.0;
const BURST_BODY_COUNT = 4;
const BODY_SPEC_ORDER = [0, 2, 3, 4, 1, 0, 2, 4, 3];
const CAMERA_CONFIG = {
  target: [0.0, 0.22, 0.0],
  distance: 1.95,
  yaw: 0.0,
  pitch: -34.0,
  minDistance: 1.1,
  maxDistance: 3.4,
  wheelZoomStep: 0.12
};

const GUIDE_LINES = [
  "Drag: orbit",
  "Shift + drag: pan",
  "Wheel / [ ]: zoom",
  "Space: add 4 boxes",
  "P: pause  R: reset"
];

// sleep island の状態に応じた色相の変化
const ISLAND_STATE_TINT = {
  awake: [1.00, 0.32, 0.24],
  candidate: [1.00, 0.80, 0.22],
  sleeping: [0.34, 0.70, 1.00]
};

// 睡眠島ごとに異なる色相を割り当てるためのリング。島 ID に対して mod して使う
const ISLAND_HUE_RING = [
  [1.00, 0.34, 0.30],
  [0.98, 0.64, 0.24],
  [0.94, 0.86, 0.28],
  [0.44, 0.84, 0.52],
  [0.30, 0.76, 0.94],
  [0.58, 0.56, 0.96],
  [0.92, 0.46, 0.78]
];

// 落下する物体のサイズや初期角度、物理材質などのパラメータの基本セットを定義
const BASE_BODY_SPECS = [
  {
    role: "long beam",
    size: [0.10, 0.02, 0.02],
    attitude: [8.0, 0.0, 14.0],
    angularVelocity: [16.0, 0.0, 12.0],
    restitution: 0.02,
    friction: 0.78,
    linearDamping: 0.07,
    angularDamping: 0.10,
    color: [0.92, 0.44, 0.34, 1.0]
  },
  {
    role: "cube",
    size: [0.08, 0.08, 0.08],
    attitude: [14.0, 8.0, 10.0],
    angularVelocity: [18.0, 14.0, 10.0],
    restitution: 0.02,
    friction: 0.70,
    linearDamping: 0.08,
    angularDamping: 0.11,
    color: [0.34, 0.72, 0.95, 1.0]
  },
  {
    role: "flat plate",
    size: [0.09, 0.018, 0.06],
    attitude: [0.0, -10.0, 16.0],
    angularVelocity: [14.0, 0.0, 18.0],
    restitution: 0.015,
    friction: 0.82,
    linearDamping: 0.08,
    angularDamping: 0.11,
    color: [0.40, 0.84, 0.54, 1.0]
  },
  {
    role: "tall column",
    size: [0.03, 0.10, 0.03],
    attitude: [6.0, 0.0, -10.0],
    angularVelocity: [12.0, 0.0, 16.0],
    restitution: 0.015,
    friction: 0.76,
    linearDamping: 0.08,
    angularDamping: 0.10,
    color: [0.92, 0.80, 0.34, 1.0]
  },
  {
    role: "deep block",
    size: [0.05, 0.05, 0.09],
    attitude: [10.0, 10.0, 0.0],
    angularVelocity: [16.0, 12.0, 14.0],
    restitution: 0.02,
    friction: 0.72,
    linearDamping: 0.09,
    angularDamping: 0.11,
    color: [0.76, 0.60, 0.90, 1.0]
  }
];

let app = null;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const normalizeRatio = (value) => value - Math.floor(value);

// `showStartError`は必要な画面要素を準備し、表示状態を更新する
const showStartError = (error) => {
  const existing = document.getElementById("start-error");
  if (existing) existing.remove();
  const panel = document.createElement("pre");
  panel.id = "start-error";
  panel.textContent = `physics_collider failed\n${error?.message ?? String(error ?? "")}`;
  Object.assign(panel.style, {
    position: "fixed",
    left: "12px",
    top: "12px",
    margin: "0",
    padding: "12px 14px",
    background: "rgba(28, 32, 42, 0.94)",
    color: "#ffd7df",
    border: "1px solid rgba(255, 163, 186, 0.55)",
    borderRadius: "10px",
    whiteSpace: "pre-wrap",
    maxWidth: "min(560px, calc(100vw - 24px))",
    zIndex: "50"
  });
  document.body.appendChild(panel);
};

// URL パラメータからボディ数を読み取る
// 指定がないか不正値の場合はデフォルト値を返す
const readBodyCount = (win) => {
  const raw = new URL(win.location.href).searchParams.get("count");
  if (raw === null) {
    return DEFAULT_BODY_COUNT;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_BODY_COUNT;
  }
  return Math.max(1, Math.min(MAX_BODY_COUNT, parsed));
};

// ボディスペックのベースセットから、指定数のボディスペックを生成する
// 位置や角度、投入時刻に差を持たせて、OBB の向き変化と接触順序を読みやすくする
const generateBodySpecs = (count) => {
  const specs = [];
  const columnsPerLayer = 4;
  const rowsPerLayer = 4;
  const bodiesPerLayer = columnsPerLayer * rowsPerLayer;
  for (let i = 0; i < count; i++) {
    const base = BASE_BODY_SPECS[BODY_SPEC_ORDER[i % BODY_SPEC_ORDER.length]];
    const layer = Math.floor(i / bodiesPerLayer);
    const layerIndex = i % bodiesPerLayer;
    const row = Math.floor(layerIndex / columnsPerLayer);
    const column = layerIndex % columnsPerLayer;
    const xJitter = normalizeRatio(Math.sin((i + 1) * 12.9898) * 43758.5453) - 0.5;
    const zJitter = normalizeRatio(Math.sin((i + 1) * 78.233) * 24634.6345) - 0.5;
    const x = -0.27 + column * 0.1 + xJitter * 0.05;
    const z = ARENA_CENTER_Z - 0.21 + row * 0.1 + zJitter * 0.02;
    specs.push({
      name: `box_${i}`,
      role: `${base.role} ${i}`,
      size: [...base.size],
      position: [
        clamp(x, -0.31, 0.31),
        1.0 + layer * 0.10 + row * 0.05,
        clamp(z, ARENA_CENTER_Z - 0.23, ARENA_CENTER_Z + 0.23)
      ],
      attitude: [
        base.attitude[0] + ((i % 3) - 1) * 4.0,
        base.attitude[1] + ((i % 5) - 2) * 3.0,
        base.attitude[2] + ((i % 4) - 1.5) * 3.5
      ],
      velocity: [0.0, 0.0, 0.0],
      angularVelocity: [
        base.angularVelocity[0] + (i % 4) * 0.4,
        base.angularVelocity[1] + (i % 3) * 0.5,
        base.angularVelocity[2] + (i % 5) * 0.4
      ],
      restitution: base.restitution,
      friction: base.friction,
      linearDamping: base.linearDamping,
      angularDamping: base.angularDamping,
      color: [...base.color],
      releaseAtMs: i * RELEASE_INTERVAL_MS
    });
  }
  return specs;
};

// `box`の形状を生成し、後続処理で利用できる状態にする
const createBoxShape = (gpu, size, color) => {
  const shape = new Shape(gpu);
  shape.applyPrimitiveAsset(Primitive.cuboid(size[0], size[1], size[2]));
  shape.endShape();
  shape.setMaterial("smooth-shader", {
    has_bone: 0,
    use_texture: 0,
    color: [...color],
    ambient: 0.44,
    specular: 0.66,
    power: 28.0
  });
  return shape;
};

// 床の形状を生成し、後続処理で利用できる状態にする
const createFloorShape = (gpu) => {
  const shape = new Shape(gpu);
  shape.applyPrimitiveAsset(Primitive.cuboid(FLOOR_SIZE[0], FLOOR_SIZE[1], FLOOR_SIZE[2]));
  shape.endShape();
  shape.setMaterial("smooth-shader", {
    has_bone: 0,
    use_texture: 0,
    color: [0.32, 0.36, 0.40, 1.0],
    ambient: 0.56,
    specular: 0.18,
    power: 12.0
  });
  return shape;
};

// `wall`の形状を生成し、後続処理で利用できる状態にする
const createWallShape = (gpu, size) => {
  const shape = new Shape(gpu);
  shape.applyPrimitiveAsset(Primitive.cuboid(size[0], size[1], size[2]));
  shape.endShape();
  shape.setMaterial("smooth-shader", {
    has_bone: 0,
    use_texture: 0,
    color: [0.44, 0.49, 0.54, 1.0],
    ambient: 0.56,
    specular: 0.16,
    power: 10.0
  });
  return shape;
};

const getRestColor = (color) => ([
  clamp(color[0] * 0.88, 0.0, 1.0),
  clamp(color[1] * 0.88, 0.0, 1.0),
  clamp(color[2] * 0.88, 0.0, 1.0),
  1.0
]);

const getFlashColor = (color) => ([
  clamp(color[0] * 1.18 + 0.10, 0.0, 1.0),
  clamp(color[1] * 1.18 + 0.10, 0.0, 1.0),
  clamp(color[2] * 1.18 + 0.10, 0.0, 1.0),
  1.0
]);

const mixRgb = (base, overlay, amount) => ([
  clamp(base[0] * (1.0 - amount) + overlay[0] * amount, 0.0, 1.0),
  clamp(base[1] * (1.0 - amount) + overlay[1] * amount, 0.0, 1.0),
  clamp(base[2] * (1.0 - amount) + overlay[2] * amount, 0.0, 1.0),
  1.0
]);

// sleep island ごとに、島の状態に応じた色を計算してボディ名ごとに保持する
const buildSleepIslandDebug = (physicsSpace) => {
  const islands = physicsSpace.getLastSleepIslands();
  const byBodyName = new Map();
  const summary = {
    awake: 0,
    candidate: 0,
    sleeping: 0,
    largestBodyCount: 0,
    maxPenetration: 0.0
  };
  for (let i = 0; i < islands.length; i++) {
    const island = islands[i];
    const hue = ISLAND_HUE_RING[(island.islandId - 1) % ISLAND_HUE_RING.length];
    const tint = ISLAND_STATE_TINT[island.state] ?? [1.0, 1.0, 1.0];
    const accent = mixRgb(hue, tint, 0.35);
    summary[island.state] += 1;
    summary.largestBodyCount = Math.max(summary.largestBodyCount, island.bodyCount);
    summary.maxPenetration = Math.max(summary.maxPenetration, island.maxPenetration ?? 0.0);
    for (let j = 0; j < island.bodyNames.length; j++) {
      byBodyName.set(island.bodyNames[j], {
        islandId: island.islandId,
        state: island.state,
        accent,
        bodyCount: island.bodyCount,
        minSleepStepCount: island.minSleepStepCount,
        blockReason: island.blockReason
      });
    }
  }
  return {
    islands,
    byBodyName,
    summary
  };
};

// ボディエントリをリリースする。物理スペースに追加して、動的ボディへ切り替える
const activateBodyEntry = (entry) => {
  if (entry.released === true) {
    return;
  }
  if (entry.inPhysics !== true) {
    entry.physicsSpace.addBody(entry.body);
    entry.inPhysics = true;
  }
  entry.body.setBodyType("dynamic", {
    clearVelocity: false,
    restoreVelocity: false
  });
  entry.released = true;
};

// まだリリースしていないエントリの中から、指定数だけリリースする
const activateBurstEntries = (entries, count) => {
  let activated = 0;
  for (let i = 0; i < entries.length && activated < count; i++) {
    if (entries[i].released === false) {
      activateBodyEntry(entries[i]);
      activated += 1;
    }
  }
  return activated;
};

// ボディエントリを初期状態へ戻す
// 物理 world からはいったん外し、位置、角度、速度、flash 状態を再初期化する
const resetBodyEntry = (entry) => {
  const body = entry.body;
  if (entry.inPhysics === true) {
    entry.physicsSpace.removeBody(body);
    entry.inPhysics = false;
  }
  body.wakeUp();
  body.setBodyType("kinematic", {
    clearVelocity: true,
    restoreVelocity: false
  });
  body.setPosition(
    entry.initialPosition[0],
    entry.initialPosition[1],
    entry.initialPosition[2]
  );
  body.setAttitude(
    entry.initialAttitude[0],
    entry.initialAttitude[1],
    entry.initialAttitude[2]
  );
  body.setLinearVelocity(
    entry.initialVelocity[0],
    entry.initialVelocity[1],
    entry.initialVelocity[2]
  );
  body.setAngularVelocity(
    entry.initialAngularVelocity[0],
    entry.initialAngularVelocity[1],
    entry.initialAngularVelocity[2]
  );
  body.clearAccumulators();
  entry.released = false;
  entry.lastContactMs = -Infinity;
};

// 状態表示の行を現在の入力と状態から求め、呼び出し元へ返す
const formatStatusLines = (entries, physicsSpace, paused, fps, runTimeMs, sleepIslandDebug) => {
  const contactCount = physicsSpace.getLastContacts().length;
  let awakeCount = 0;
  let releasedCount = 0;
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].released) {
      releasedCount += 1;
    }
    if (!entries[i].body.getSleeping()) {
      awakeCount += 1;
    }
  }

  return [
    "physics_collider sample",
    "rotating BoxCollider OBB bodies released into a low-walled arena",
    `state: ${paused ? "paused" : "running"}  fps: ${fps.toFixed(1)}  elapsed: ${(runTimeMs * 0.001).toFixed(1)}s`,
    `released: ${releasedCount}/${entries.length}  awake: ${awakeCount}/${entries.length}  contacts: ${contactCount}`,
    `sleep islands: awake ${sleepIslandDebug.summary.awake}  candidate ${sleepIslandDebug.summary.candidate}  sleeping ${sleepIslandDebug.summary.sleeping}  largest ${sleepIslandDebug.summary.largestBodyCount}  maxPen ${(sleepIslandDebug.summary.maxPenetration ?? 0).toFixed(3)}`,
    `release spacing: ${RELEASE_INTERVAL_MS.toFixed(0)}ms  burst: Space add ${BURST_BODY_COUNT}`,
    "meter scale: arena 1.2m x 1.2m / body max 0.10m / gravity -4.9m/s^2",
    "spawn: 1.00m+ tabletop drop / no initial velocity / low initial spin",
    "island color: hue = island id  tint = awake/candidate/sleeping",
    `count URL: ?count=1..${MAX_BODY_COUNT}`
  ];
};

// このインスタンスの初期化段階で、必要な状態と資源を準備して処理を開始する
const start = async () => {
  app = new WebgApp({
    document,
    messageFontTexture: FONT_FILE,
    clearColor: CLEAR_COLOR,
    viewAngle: 48.0,
    projectionNear: 0.02,
    projectionFar: 20.0,
    light: {
      mode: "eye-fixed",
      position: [1.8, 3.6, 2.8, 1.0]
    },
    camera: {
      target: CAMERA_CONFIG.target,
      distance: CAMERA_CONFIG.distance,
      yaw: CAMERA_CONFIG.yaw,
      pitch: CAMERA_CONFIG.pitch
    },
    debugTools: {
      mode: "release",
      system: "physics_collider",
      source: "samples/physics_collider/main.js"
    }
  });
  await app.init();

  app.createOrbitEyeRig(CAMERA_CONFIG);

  const gpu = app.getGPU();
  const space = app.space;
  const physicsSpace = new PhysicsSpace({
    gravity: [0.0, -4.9, 0.0],
    fixedTimeStepMs: 1000.0 / 120.0,
    maxSubSteps: 6,
    solverIterations: 7,
    defaultRestitution: 0.1,
    defaultFriction: 0.72,
    sleepLinearThreshold: 0.6,
    sleepAngularThreshold: 5.0,
    sleepStepsThreshold: 5
  });

  const floorVisual = space.addNode(null, "floor_visual");
  floorVisual.setPosition(0.0, FLOOR_CENTER_Y, ARENA_CENTER_Z);
  floorVisual.addShape(createFloorShape(gpu));

  const floor = space.addPhysicsNode(null, "floor", {
    bodyType: "static"
  });
  floor.setPosition(0.0, FLOOR_TOP_Y, ARENA_CENTER_Z);
  floor.setCollider(new PlaneCollider([0.0, 1.0, 0.0]));
  floor.setPhysicsMaterial({
    restitution: 0.05,
    friction: 0.88
  });
  physicsSpace.addBody(floor);

  // `wall`を対象へ追加し、後続処理から参照できるようにする
  const addWall = (name, position, size) => {
    const wallVisual = space.addNode(null, `${name}_visual`);
    wallVisual.setPosition(position[0], position[1], position[2]);
    wallVisual.addShape(createWallShape(gpu, size));

    const wallBody = space.addPhysicsNode(null, name, {
      bodyType: "static"
    });
    wallBody.setPosition(position[0], position[1], position[2]);
    wallBody.setCollider(new BoxCollider(size));
    wallBody.setPhysicsMaterial({
      restitution: 0.1,
      friction: 0.82
    });
    physicsSpace.addBody(wallBody);
  };

  const arenaHalfWidth = FLOOR_SIZE[0] * 0.5;
  const arenaHalfDepth = FLOOR_SIZE[2] * 0.5;
  addWall(
    "wall_left",
    [-arenaHalfWidth - WALL_THICKNESS * 0.5, WALL_CENTER_Y, ARENA_CENTER_Z],
    [WALL_THICKNESS, WALL_HEIGHT, FLOOR_SIZE[2]]
  );
  addWall(
    "wall_right",
    [arenaHalfWidth + WALL_THICKNESS * 0.5, WALL_CENTER_Y, ARENA_CENTER_Z],
    [WALL_THICKNESS, WALL_HEIGHT, FLOOR_SIZE[2]]
  );
  addWall(
    "wall_back",
    [0.0, WALL_CENTER_Y, ARENA_CENTER_Z - arenaHalfDepth - WALL_THICKNESS * 0.5],
    [FLOOR_SIZE[0] + WALL_THICKNESS * 2.0, WALL_HEIGHT, WALL_THICKNESS]
  );
  addWall(
    "wall_front",
    [0.0, WALL_CENTER_Y, ARENA_CENTER_Z + arenaHalfDepth + WALL_THICKNESS * 0.5],
    [FLOOR_SIZE[0] + WALL_THICKNESS * 2.0, WALL_HEIGHT, WALL_THICKNESS]
  );

  const bodyEntries = [];
  const bodySpecs = generateBodySpecs(readBodyCount(window));
  let nextBodyIndex = bodySpecs.length;
  for (let i = 0; i < bodySpecs.length; i++) {
    const spec = bodySpecs[i];
    const body = space.addPhysicsNode(null, spec.name, {
      bodyType: "kinematic",
      mass: 1.0,
      linearDamping: spec.linearDamping,
      angularDamping: spec.angularDamping
    });
    body.setPosition(spec.position[0], spec.position[1], spec.position[2]);
    body.setAttitude(spec.attitude[0], spec.attitude[1], spec.attitude[2]);
    body.setCollider(new BoxCollider(spec.size));
    body.setPhysicsMaterial({
      restitution: spec.restitution,
      friction: spec.friction
    });
    body.setLinearVelocity(spec.velocity[0], spec.velocity[1], spec.velocity[2]);
    body.setAngularVelocity(
      spec.angularVelocity[0],
      spec.angularVelocity[1],
      spec.angularVelocity[2]
    );
    const shape = createBoxShape(gpu, spec.size, spec.color);
    body.addShape(shape);
    bodyEntries.push({
      name: spec.name,
      body,
      physicsSpace,
      shape,
      baseColor: [...spec.color],
      initialPosition: [...spec.position],
      initialAttitude: [...spec.attitude],
      initialVelocity: [...spec.velocity],
      initialAngularVelocity: [...spec.angularVelocity],
      releaseAtMs: spec.releaseAtMs,
      inPhysics: false,
      released: false,
      lastContactMs: -Infinity
    });
  }

  let paused = false;
  let runTimeMs = 0.0;
  let fpsEstimate = 0.0;

  // `burst`の`bodies`を対象へ追加し、後続処理から参照できるようにする
  const addBurstBodies = () => {
    const releasedNow = activateBurstEntries(bodyEntries, BURST_BODY_COUNT);
    if (releasedNow > 0) {
      return releasedNow;
    }
    const available = MAX_BODY_COUNT - bodyEntries.length;
    if (available <= 0) {
      return 0;
    }
    const addCount = Math.min(BURST_BODY_COUNT, available);
    const extraSpecs = generateBodySpecs(nextBodyIndex + addCount).slice(nextBodyIndex);
    nextBodyIndex += addCount;
    for (let i = 0; i < extraSpecs.length; i++) {
      const spec = extraSpecs[i];
      const body = space.addPhysicsNode(null, spec.name, {
        bodyType: "kinematic",
        mass: 1.0,
        linearDamping: spec.linearDamping,
        angularDamping: spec.angularDamping
      });
      body.setPosition(spec.position[0], spec.position[1], spec.position[2]);
      body.setAttitude(spec.attitude[0], spec.attitude[1], spec.attitude[2]);
      body.setCollider(new BoxCollider(spec.size));
      body.setPhysicsMaterial({
        restitution: spec.restitution,
        friction: spec.friction
      });
      body.setLinearVelocity(spec.velocity[0], spec.velocity[1], spec.velocity[2]);
      body.setAngularVelocity(
        spec.angularVelocity[0],
        spec.angularVelocity[1],
        spec.angularVelocity[2]
      );
      const shape = createBoxShape(gpu, spec.size, spec.color);
      body.addShape(shape);
      bodyEntries.push({
        name: spec.name,
        body,
        physicsSpace,
        shape,
        baseColor: [...spec.color],
        initialPosition: [...spec.position],
        initialAttitude: [...spec.attitude],
        initialVelocity: [...spec.velocity],
        initialAngularVelocity: [...spec.angularVelocity],
        releaseAtMs: spec.releaseAtMs,
        inPhysics: false,
        released: false,
        lastContactMs: -Infinity
      });
    }
    return activateBurstEntries(bodyEntries, addCount);
  };

  // すべての物体を初期状態へ戻し、前回の状態を残さない
  const resetAllBodies = () => {
    for (let i = 0; i < bodyEntries.length; i++) {
      resetBodyEntry(bodyEntries[i]);
    }
    runTimeMs = 0.0;
    physicsSpace.accumulatorMs = 0.0;
  };

  app.attachInput({
    onKeyDown: (key, event) => {
      if (event.repeat) {
        return;
      }
      if (key === "space") {
        const added = addBurstBodies();
        if (added > 0) {
          app.pushToast(`added ${added} boxes`, {
            durationMs: 1200
          });
        }
        event.preventDefault();
      } else if (key === "p") {
        paused = !paused;
        event.preventDefault();
      } else if (key === "r") {
        resetAllBodies();
        paused = false;
        event.preventDefault();
      }
    }
  });

  app.message.setLines("guide", GUIDE_LINES, {
    anchor: "bottom-left",
    x: 0,
    y: -2
  });

  app.start({
    onUpdate: ({ timeMs, deltaSec }) => {
      const deltaMs = deltaSec * 1000.0;
      if (deltaMs > 0.0) {
        const instantFps = 1000.0 / deltaMs;
        fpsEstimate = fpsEstimate <= 0.0
          ? instantFps
          : fpsEstimate * 0.9 + instantFps * 0.1;
      }

      if (!paused) {
        runTimeMs += deltaMs;
        for (let i = 0; i < bodyEntries.length; i++) {
          if (bodyEntries[i].released === false && runTimeMs >= bodyEntries[i].releaseAtMs) {
            activateBodyEntry(bodyEntries[i]);
          }
        }
        physicsSpace.step(deltaMs);
      }

      const contacts = physicsSpace.getLastContacts();
      const sleepIslandDebug = buildSleepIslandDebug(physicsSpace);
      for (let i = 0; i < contacts.length; i++) {
        for (let j = 0; j < bodyEntries.length; j++) {
          if (contacts[i].bodyA === bodyEntries[j].body || contacts[i].bodyB === bodyEntries[j].body) {
            bodyEntries[j].lastContactMs = timeMs;
          }
        }
      }
      for (let i = 0; i < bodyEntries.length; i++) {
        const entry = bodyEntries[i];
        const flashActive = (timeMs - entry.lastContactMs) <= CONTACT_FLASH_MS;
        const islandInfo = sleepIslandDebug.byBodyName.get(entry.name) ?? null;
        const restColor = islandInfo
          ? mixRgb(getRestColor(entry.baseColor), islandInfo.accent, 0.55)
          : getRestColor(entry.baseColor);
        const flashColor = islandInfo
          ? mixRgb(getFlashColor(entry.baseColor), islandInfo.accent, 0.45)
          : getFlashColor(entry.baseColor);
        entry.shape.updateMaterial({
          color: flashActive ? flashColor : restColor
        });
      }

      app.message.setLines(
        "status",
        formatStatusLines(bodyEntries, physicsSpace, paused, fpsEstimate, runTimeMs, sleepIslandDebug),
        {
          anchor: "top-left",
          x: 0,
          y: 0
        }
      );
    }
  });
};

document.addEventListener("DOMContentLoaded", () => {
  start().catch((error) => {
    console.error("physics_collider failed:", error);
    app?.showOverlayPanel?.(buildErrorPanelOptions(error, {
      title: "physics_collider failed",
      id: "start-error",
      background: "rgba(28, 32, 42, 0.94)"
    }));
    if (!app) {
      showStartError(error);
    }
  });
});
