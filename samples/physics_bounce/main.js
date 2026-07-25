// ---------------------------------------------
// samples/physics_bounce/main.js  2026/05/12
//   physics_bounce sample
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import WebgApp from "../../webg/WebgApp.js";
import { buildErrorPanelOptions } from "../../webg/OverlayPanelPresets.js";
import BoxCollider from "../../webg/BoxCollider.js";
import PlaneCollider from "../../webg/PlaneCollider.js";
import SphereCollider from "../../webg/SphereCollider.js";
import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";
import PhysicsSpace from "../../webg/PhysicsSpace.js";

const FONT_FILE = "../../webg/font512.png";
const CLEAR_COLOR = [0.06, 0.09, 0.10, 1.0];
const FLOOR_HEIGHT = 1.2;
const FLOOR_TOP_Y = -14.0;
const FLOOR_CENTER_Y = FLOOR_TOP_Y - FLOOR_HEIGHT * 0.5;
const FLOOR_SIZE = [104.0, FLOOR_HEIGHT, 68.0];
const WALL_HEIGHT = 10.0;
const WALL_THICKNESS = 3.0;
const WALL_CENTER_Y = FLOOR_TOP_Y + WALL_HEIGHT * 0.5;
const ARENA_CENTER_Z = -26.0;
const ARENA_HALF_WIDTH = FLOOR_SIZE[0] * 0.5;
const ARENA_HALF_DEPTH = FLOOR_SIZE[2] * 0.5;
const SPHERE_RADIUS = 2.0;
const DEFAULT_BALL_COUNT = 96;
const MAX_BALL_COUNT = 1000;
const BURST_BALL_COUNT = 5;
const CONTACT_FLASH_MS = 90.0;
const CONTACT_FLASH_COLOR = [1.0, 0.08, 0.04, 1.0];
const CAMERA_CONFIG = {
  target: [0.0, 18.0, ARENA_CENTER_Z],
  distance: 98.0,
  yaw: 0.0,
  pitch: -32.0,
  minDistance: 46.0,
  maxDistance: 180.0,
  wheelZoomStep: 6.0
};

const GUIDE_LINES = [
  "Drag: orbit",
  "Shift + drag: pan",
  "Wheel / [ ]: zoom",
  "Space: add 5 balls",
  "P: pause  R: reset"
];

const SEED_SPECS = [
  {
    name: "red_in",
    label: "red inward",
    position: [-30.0, 34.0, -26.0],
    velocity: [14.0, -3.0, 0.0],
    restitution: 0.82,
    color: [0.88, 0.48, 0.38, 1.0]
  },
  {
    name: "blue_in",
    label: "blue inward",
    position: [30.0, 34.0, -26.0],
    velocity: [-14.0, -3.0, 0.0],
    restitution: 0.86,
    color: [0.36, 0.76, 0.92, 1.0]
  },
  {
    name: "green_cross",
    label: "green cross",
    position: [-18.0, 48.0, -18.0],
    velocity: [9.5, -8.0, -1.2],
    restitution: 0.78,
    color: [0.38, 0.82, 0.52, 1.0]
  },
  {
    name: "yellow_cross",
    label: "yellow cross",
    position: [18.0, 48.0, -34.0],
    velocity: [-9.5, -8.0, 1.2],
    restitution: 0.84,
    color: [0.92, 0.80, 0.34, 1.0]
  },
  {
    name: "violet_drop",
    label: "violet drop",
    position: [0.0, 62.0, -26.0],
    velocity: [1.2, -18.0, 0.0],
    restitution: 0.9,
    color: [0.72, 0.58, 0.88, 1.0]
  },
  {
    name: "gray_soft",
    label: "gray soft",
    position: [0.0, 22.0, -26.0],
    velocity: [-0.8, -4.0, 0.0],
    restitution: 0.38,
    color: [0.70, 0.74, 0.76, 1.0]
  }
];

let app = null;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const normalizeRatio = (value) => value - Math.floor(value);

const showStartError = (error) => {
  const existing = document.getElementById("start-error");
  if (existing) existing.remove();
  const panel = document.createElement("pre");
  panel.id = "start-error";
  panel.textContent = `physics_bounce failed\n${error?.message ?? String(error ?? "")}`;
  Object.assign(panel.style, {
    position: "fixed",
    left: "12px",
    top: "12px",
    margin: "0",
    padding: "12px 14px",
    background: "rgba(26, 38, 34, 0.94)",
    color: "#ffd7df",
    border: "1px solid rgba(255, 163, 186, 0.55)",
    borderRadius: "10px",
    whiteSpace: "pre-wrap",
    maxWidth: "min(560px, calc(100vw - 24px))",
    zIndex: "50"
  });
  document.body.appendChild(panel);
};

// URL パラメータ ?count= から球数を読み取る
// 指定がないか不正値の場合は、負荷が高すぎない既定値へ戻す
const readBallCount = (win) => {
  const raw = new URL(win.location.href).searchParams.get("count");
  if (raw === null) {
    return DEFAULT_BALL_COUNT;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_BALL_COUNT;
  }
  return Math.max(1, Math.min(MAX_BALL_COUNT, parsed));
};

// 初期球群の配置を作る
// 単純な縦積みではなく、横方向へばらした lane と落下高さの差で球同士の衝突を見やすくする
const generateBallSpecs = (count) => {
  const specs = [];
  const columnsPerLayer = 20;
  const rowsPerLayer = 12;
  const ballsPerLayer = columnsPerLayer * rowsPerLayer;
  for (let i = 0; i < count; i++) {
    const seed = SEED_SPECS[i % SEED_SPECS.length];
    const layer = Math.floor(i / ballsPerLayer);
    const layerIndex = i % ballsPerLayer;
    const row = Math.floor(layerIndex / columnsPerLayer);
    const column = layerIndex % columnsPerLayer;
    const xJitter = normalizeRatio(Math.sin((i + 1) * 12.9898) * 43758.5453) - 0.5;
    const zJitter = normalizeRatio(Math.sin((i + 1) * 78.233) * 24634.6345) - 0.5;
    const yJitter = normalizeRatio(Math.sin((i + 1) * 39.425) * 18753.2341);
    const laneX = -44.0 + column * 4.6 + xJitter * 0.7;
    const laneZ = ARENA_CENTER_Z - 25.3 + row * 4.6 + zJitter * 0.7;
    const inwardX = laneX < 0.0 ? 1.0 : -1.0;
    const inwardZ = laneZ < ARENA_CENTER_Z ? 1.0 : -1.0;
    const speedScale = 0.72 + normalizeRatio(Math.sin((i + 1) * 5.371) * 913.137) * 0.6;
    specs.push({
      name: `ball_${i}`,
      label: `${seed.label} ${i}`,
      position: [
        clamp(laneX, -44.0, 44.0),
        18.0 + layer * 4.8 + yJitter * 2.0,
        clamp(laneZ, ARENA_CENTER_Z - 25.0, ARENA_CENTER_Z + 25.0)
      ],
      velocity: [
        inwardX * (7.0 + (i % 7) * 1.3) * speedScale,
        -4.0 - (i % 5) * 1.8,
        inwardZ * (1.0 + (i % 4) * 0.55)
      ],
      restitution: clamp(seed.restitution + ((i % 5) - 2) * 0.025, 0.35, 0.94),
      color: [...seed.color]
    });
  }
  return specs;
};

// Space キーで追加投入する burst 球群を作る
// 中央寄りへ数個ずつ入れて、既存球群との衝突密度を手早く上げられるようにする
const generateBurstBallSpecs = (startIndex, count) => {
  const specs = [];
  const burstIndex = Math.floor(startIndex / BURST_BALL_COUNT);
  const burstAngle = burstIndex * 0.83;
  const burstCenterX = Math.sin(burstAngle) * 8.0;
  const burstCenterZ = ARENA_CENTER_Z + Math.cos(burstAngle * 0.7) * 6.0;
  const burstOffsets = [
    [-14.0, 0.0, -7.0],
    [-7.0, 5.0, 5.0],
    [0.0, 10.0, -1.0],
    [7.0, 15.0, 7.0],
    [14.0, 20.0, -5.0]
  ];
  for (let i = 0; i < count; i++) {
    const index = startIndex + i;
    const seed = SEED_SPECS[index % SEED_SPECS.length];
    const angle = burstAngle - 0.85 + i * 0.42;
    const offset = burstOffsets[i % burstOffsets.length];
    const x = burstCenterX + offset[0];
    const y = 34.0 + offset[1] * 0.65 + (burstIndex % 3) * 2.0;
    const z = burstCenterZ + offset[2];
    const speed = 15.0 + (index % 4) * 2.2;
    specs.push({
      name: `ball_${index}`,
      label: `${seed.label} ${index}`,
      position: [
        clamp(x, -42.0, 42.0),
        y,
        clamp(z, ARENA_CENTER_Z - 24.0, ARENA_CENTER_Z + 24.0)
      ],
      velocity: [
        Math.sin(angle) * speed,
        -16.0 - i * 1.4,
        Math.cos(angle) * speed * 0.45
      ],
      restitution: clamp(seed.restitution + 0.04, 0.4, 0.96),
      color: [...seed.color]
    });
  }
  return specs;
};

// 共有球 mesh を 1 つ作り、各球は instance shape を持つ
// これにより球数を増やしても同じ ShapeResource を再利用できる
const createSpherePrototypeShape = (gpu, radius) => {
  const shape = new Shape(gpu);
  shape.applyPrimitiveAsset(Primitive.sphere(radius, 20, 16, shape.getPrimitiveOptions()));
  shape.endShape();
  shape.setMaterial("smooth-shader", {
    has_bone: 0,
    use_texture: 0,
    color: [1.0, 1.0, 1.0, 1.0],
    ambient: 0.44,
    specular: 1.05,
    power: 78.0
  });
  return shape;
};

const createSphereInstanceShape = (prototypeShape, color) => {
  const shape = prototypeShape.createInstance();
  shape.updateMaterial({
    color: [...color]
  });
  return shape;
};

const createFloorShape = (gpu) => {
  const shape = new Shape(gpu);
  shape.applyPrimitiveAsset(Primitive.cuboid(FLOOR_SIZE[0], FLOOR_SIZE[1], FLOOR_SIZE[2]));
  shape.endShape();
  shape.setMaterial("smooth-shader", {
    has_bone: 0,
    use_texture: 0,
    color: [0.35, 0.38, 0.36, 1.0],
    ambient: 0.58,
    specular: 0.16,
    power: 10.0
  });
  return shape;
};

const createWallShape = (gpu, size) => {
  const shape = new Shape(gpu);
  shape.applyPrimitiveAsset(Primitive.cuboid(size[0], size[1], size[2]));
  shape.endShape();
  shape.setMaterial("smooth-shader", {
    has_bone: 0,
    use_texture: 0,
    color: [0.46, 0.50, 0.48, 1.0],
    ambient: 0.54,
    specular: 0.18,
    power: 12.0
  });
  return shape;
};

// 球を初期位置と初期速度へ戻し、毎回同じ条件で反発を見直せるようにする
const resetBodyEntry = (entry) => {
  const body = entry.body;
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
  body.setLinearVelocity(
    entry.initialVelocity[0],
    entry.initialVelocity[1],
    entry.initialVelocity[2]
  );
  body.setAngularVelocity(0.0, 0.0, 0.0);
  entry.contactSeen = false;
  entry.impactVy = null;
  entry.maxAfterImpact = null;
  entry.lastContact = false;
  entry.lastBallContact = false;
  entry.flashMs = 0.0;
  entry.shape.updateMaterial({
    color: [...entry.activeColor]
  });
  body.setBodyType("dynamic", {
    clearVelocity: false,
    restoreVelocity: false
  });
};

const contactIncludesBody = (contact, body) => (
  contact.bodyA === body || contact.bodyB === body
);

const isBallBody = (entries, body) => entries.some((entry) => entry.body === body);
const isFloorBody = (body) => body?.getName?.() === "floor";

const getBallBallContactCount = (entries, contacts) => {
  let count = 0;
  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i];
    if (isBallBody(entries, contact.bodyA) && isBallBody(entries, contact.bodyB)) {
      count += 1;
    }
  }
  return count;
};

// contact 情報をもとに flash 色、静止色、球同士接触数を更新する
// 床 contact は常時起こるため flash 条件から外し、壁や球との衝突だけを目立たせる
const updateBounceDiagnostics = (entries, contacts, deltaMs) => {
  const ballBallContacts = getBallBallContactCount(entries, contacts);
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const pos = entry.body.getPosition();
    const velocity = entry.body.getLinearVelocity();
    const hasContact = contacts.some((contact) => contactIncludesBody(contact, entry.body));
    const hasBallContact = contacts.some((contact) => (
      contactIncludesBody(contact, entry.body)
      && isBallBody(entries, contact.bodyA)
      && isBallBody(entries, contact.bodyB)
    ));
    const hasNonFloorContact = contacts.some((contact) => (
      contactIncludesBody(contact, entry.body)
      && !isFloorBody(contact.bodyA)
      && !isFloorBody(contact.bodyB)
    ));
    entry.lastContact = hasContact;
    entry.lastBallContact = hasBallContact;
    const sleeping = entry.body.getSleeping();
    entry.flashMs = sleeping ? 0.0 : Math.max(0.0, entry.flashMs - deltaMs);
    if (hasNonFloorContact && !sleeping) {
      entry.flashMs = CONTACT_FLASH_MS;
    }
    if (hasContact && !entry.contactSeen) {
      entry.contactSeen = true;
      entry.impactVy = velocity[1];
      entry.maxAfterImpact = pos[1];
    }
    if (entry.contactSeen) {
      entry.maxAfterImpact = Math.max(entry.maxAfterImpact, pos[1]);
    }
    const color = entry.flashMs > 0.0
      ? CONTACT_FLASH_COLOR
      : sleeping
        ? entry.restColor
        : entry.activeColor;
    entry.shape.updateMaterial({
      color: [...color]
    });
  }
  return ballBallContacts;
};

const formatStatusLines = (entries, paused, totalBallBallContacts, lastBallBallContacts, sharedSphereResource, fps) => {
  const awakeCount = entries.filter((entry) => !entry.body.getSleeping()).length;
  return [
    "physics_bounce sample",
    "multiple bouncing spheres in a low-walled thin-floor arena",
    `state: ${paused ? "paused" : "running"}  fps: ${fps.toFixed(1)}`,
    `awake: ${awakeCount}/${entries.length}  sphere-sphere contacts: ${totalBallBallContacts} total / ${lastBallBallContacts} current`,
    `shared sphere resource refs: ${sharedSphereResource?.refCount ?? "--"}  count URL: ?count=1..${MAX_BALL_COUNT}`,
    `controls: Space add ${BURST_BALL_COUNT} balls, P pause/resume, R reset`
  ];
};

const start = async () => {
  app = new WebgApp({
    document,
    messageFontTexture: FONT_FILE,
    clearColor: CLEAR_COLOR,
    viewAngle: 48.0,
    projectionNear: 0.1,
    projectionFar: 1200.0,
    light: {
      mode: "eye-fixed",
      position: [70.0, 120.0, 160.0, 1.0]
    },
    camera: {
      target: CAMERA_CONFIG.target,
      distance: CAMERA_CONFIG.distance,
      yaw: CAMERA_CONFIG.yaw,
      pitch: CAMERA_CONFIG.pitch
    },
    debugTools: {
      mode: "release",
      system: "physics_bounce",
      source: "samples/physics_bounce/main.js"
    }
  });
  await app.init();

  app.createOrbitEyeRig(CAMERA_CONFIG);

  const gpu = app.getGPU();
  const space = app.space;
  const world = new PhysicsSpace({
    gravity: [0.0, -42.0, 0.0],
    fixedTimeStepMs: 1000.0 / 120.0,
    maxSubSteps: 6,
    solverIterations: 6,
    defaultRestitution: 0.0,
    defaultFriction: 0.03,
    sleepLinearThreshold: 0.16,
    sleepStepsThreshold: 8
  });

  const floorVisual = space.addNode(null, "floor_visual");
  floorVisual.setPosition(0.0, FLOOR_CENTER_Y, ARENA_CENTER_Z);
  floorVisual.addShape(createFloorShape(gpu));

  const floorNode = space.addPhysicsNode(null, "floor", {
    bodyType: "static"
  });
  floorNode.setPosition(0.0, FLOOR_TOP_Y, ARENA_CENTER_Z);
  floorNode.setCollider(new PlaneCollider([0.0, 1.0, 0.0]));
  floorNode.setPhysicsMaterial({
    restitution: 0.0,
    friction: 0.03
  });
  world.addBody(floorNode);

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
      restitution: 0.78,
      friction: 0.03
    });
    world.addBody(wallBody);
  };

  addWall(
    "wall_left",
    [-ARENA_HALF_WIDTH - WALL_THICKNESS * 0.5, WALL_CENTER_Y, ARENA_CENTER_Z],
    [WALL_THICKNESS, WALL_HEIGHT, FLOOR_SIZE[2]]
  );
  addWall(
    "wall_right",
    [ARENA_HALF_WIDTH + WALL_THICKNESS * 0.5, WALL_CENTER_Y, ARENA_CENTER_Z],
    [WALL_THICKNESS, WALL_HEIGHT, FLOOR_SIZE[2]]
  );
  addWall(
    "wall_back",
    [0.0, WALL_CENTER_Y, ARENA_CENTER_Z - ARENA_HALF_DEPTH - WALL_THICKNESS * 0.5],
    [FLOOR_SIZE[0] + WALL_THICKNESS * 2.0, WALL_HEIGHT, WALL_THICKNESS]
  );
  addWall(
    "wall_front",
    [0.0, WALL_CENTER_Y, ARENA_CENTER_Z + ARENA_HALF_DEPTH + WALL_THICKNESS * 0.5],
    [FLOOR_SIZE[0] + WALL_THICKNESS * 2.0, WALL_HEIGHT, WALL_THICKNESS]
  );

  const spherePrototypeShape = createSpherePrototypeShape(gpu, SPHERE_RADIUS);
  const ballSpecs = generateBallSpecs(readBallCount(window));
  const bodyEntries = [];
  let nextBallIndex = ballSpecs.length;

  const addBallEntry = (spec) => {
    const body = space.addPhysicsNode(null, spec.name, {
      bodyType: "kinematic",
      mass: 1.0,
      gravityScale: 1.0,
      linearDamping: 0.02
    });
    const shape = createSphereInstanceShape(spherePrototypeShape, spec.color);
    body.addShape(shape);
    body.setCollider(new SphereCollider(SPHERE_RADIUS));
    body.setPhysicsMaterial({
      restitution: spec.restitution,
      friction: 0.03
    });
    world.addBody(body);
    const entry = {
      label: spec.label,
      body,
      shape,
      initialPosition: [...spec.position],
      initialVelocity: [...spec.velocity],
      activeColor: [...spec.color],
      restColor: [
        clamp(spec.color[0] * 0.88, 0.0, 1.0),
        clamp(spec.color[1] * 0.88, 0.0, 1.0),
        clamp(spec.color[2] * 0.88, 0.0, 1.0),
        1.0
      ],
      contactSeen: false,
      impactVy: null,
      maxAfterImpact: null,
      lastContact: false,
      lastBallContact: false,
      flashMs: 0.0
    };
    bodyEntries.push(entry);
    resetBodyEntry(entry);
  };

  const addBurstBalls = () => {
    const available = MAX_BALL_COUNT - bodyEntries.length;
    if (available <= 0) {
      return 0;
    }
    const count = Math.min(BURST_BALL_COUNT, available);
    const burstSpecs = generateBurstBallSpecs(nextBallIndex, count);
    nextBallIndex += count;
    for (let i = 0; i < burstSpecs.length; i++) {
      addBallEntry(burstSpecs[i]);
    }
    return count;
  };

  for (let i = 0; i < ballSpecs.length; i++) {
    addBallEntry(ballSpecs[i]);
  }

  let paused = false;
  let fpsEstimate = 0.0;
  let totalBallBallContacts = 0;
  let lastBallBallContacts = 0;

  const resetAllBodies = () => {
    totalBallBallContacts = 0;
    lastBallBallContacts = 0;
    world.accumulatorMs = 0.0;
    for (let i = 0; i < bodyEntries.length; i++) {
      resetBodyEntry(bodyEntries[i]);
    }
  };

  app.attachInput({
    onKeyDown: (key, event) => {
      if (event.repeat) {
        return;
      }
      if (key === "space") {
        const added = addBurstBalls();
        if (added > 0) {
          app.pushToast(`added ${added} balls`, {
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
    onUpdate: ({ deltaSec }) => {
      const deltaMs = deltaSec * 1000.0;
      if (deltaMs > 0.0) {
        const instantFps = 1000.0 / deltaMs;
        fpsEstimate = fpsEstimate <= 0.0
          ? instantFps
          : fpsEstimate * 0.9 + instantFps * 0.1;
      }

      if (!paused) {
        world.step(deltaMs);
        lastBallBallContacts = updateBounceDiagnostics(bodyEntries, world.getLastContacts(), deltaMs);
        totalBallBallContacts += lastBallBallContacts;
      }

      app.message.setLines(
        "status",
        formatStatusLines(
          bodyEntries,
          paused,
          totalBallBallContacts,
          lastBallBallContacts,
          spherePrototypeShape.getResource(),
          fpsEstimate
        ),
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
    console.error("physics_bounce failed:", error);
    app?.showOverlayPanel?.(buildErrorPanelOptions(error, {
      title: "physics_bounce failed",
      id: "start-error",
      background: "rgba(26, 38, 34, 0.94)"
    }));
    if (!app) {
      showStartError(error);
    }
  });
});
