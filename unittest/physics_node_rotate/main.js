// ---------------------------------------------
// unittest/physics_node_rotate/main.js  2026/05/06
//   physics_node_rotate unittest
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import Space from "../../webg/Space.js";
import BoxCollider from "../../webg/BoxCollider.js";
import PlaneCollider from "../../webg/PlaneCollider.js";
import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";
import Matrix from "../../webg/Matrix.js";
import SmoothShader from "../../webg/SmoothShader.js";
import PhysicsSpace from "../../webg/PhysicsSpace.js";
import { bootUnitTestApp } from "../shared/UnitTestApp.js";

const CLEAR_COLOR = [0.07, 0.10, 0.13, 1.0];
const FLOOR_CENTER_Y = -18.0;
const FLOOR_HEIGHT = 4.0;
const BLUE_TORQUE_DURATION_SEC = 2.5;
const FEATURED_COLOR_DIM_SCALE = 0.88;

const IMPACT_BLOCK_SPECS = [
  {
    name: "impact_block_a",
    size: [4.5, 4.5, 4.5],
    position: [20.0, -13.75, -28.0],
    color: [0.78, 0.80, 0.84, 1.0]
  },
  {
    name: "impact_block_b",
    size: [4.5, 4.5, 4.5],
    position: [25.5, -13.75, -28.0],
    color: [0.72, 0.74, 0.79, 1.0]
  },
  {
    name: "impact_block_c",
    size: [4.5, 4.5, 4.5],
    position: [31.0, -13.75, -28.0],
    color: [0.76, 0.78, 0.82, 1.0]
  }
];

const BODY_SPECS = [
  {
    name: "spin_beam",
    size: [16.0, 2.6, 2.6],
    position: [-26.0, 12.0, -24.0],
    attitude: [0.0, 0.0, 20.0],
    velocity: [0.0, 0.0, 0.0],
    angularVelocity: [72.0, 0.0, 0.0],
    gravityScale: 0.0,
    linearDamping: 0.0,
    angularDamping: 0.0,
    fixedRotation: false,
    role: "left red: keeps spinning at a steady angularVelocity",
    color: [0.92, 0.44, 0.34, 1.0]
  },
  {
    name: "torque_beam",
    size: [14.0, 2.4, 2.4],
    position: [0.0, 12.0, -20.0],
    attitude: [0.0, 0.0, -18.0],
    velocity: [0.0, 0.0, 0.0],
    angularVelocity: [0.0, 0.0, 0.0],
    gravityScale: 0.0,
    linearDamping: 0.0,
    angularDamping: 0.0,
    fixedRotation: false,
    continuousTorque: [900.0, 0.0, 0.0],
    torquePulse: [3200.0, 0.0, 0.0],
    torqueDurationSec: BLUE_TORQUE_DURATION_SEC,
    role: "center blue: accelerates for a short time, then keeps spinning by inertia",
    color: [0.34, 0.72, 0.95, 1.0]
  },
  {
    name: "fall_beam",
    size: [7.0, 4.0, 4.0],
    position: [25.0, 24.0, -28.0],
    attitude: [12.0, -10.0, 18.0],
    velocity: [-0.7, 0.0, 0.0],
    angularVelocity: [72.0, 0.0, 34.0],
    gravityScale: 1.0,
    linearDamping: 0.5,
    angularDamping: 0.2,
    fixedRotation: false,
    role: "right green: falls onto gray blocks, then settles while spinning slows",
    color: [0.38, 0.82, 0.52, 1.0]
  },
  {
    name: "fixed_beam",
    size: [12.0, 2.6, 2.6],
    position: [0.0, -3.0, -34.0],
    attitude: [0.0, 0.0, 28.0],
    velocity: [0.0, 0.0, 0.0],
    angularVelocity: [90.0, 0.0, 0.0],
    gravityScale: 0.0,
    linearDamping: 0.0,
    angularDamping: 0.0,
    fixedRotation: true,
    role: "back yellow: fixedRotation keeps orientation unchanged",
    color: [0.92, 0.80, 0.34, 1.0]
  }
];

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const setProjection = (screen, shader, angle = 48.0) => {
  const proj = new Matrix();
  const fov = screen.getRecommendedFov(angle);
  proj.makeProjectionMatrix(0.1, 1200.0, fov, screen.getAspect());
  shader.setProjectionMatrix(proj);
};

const createBeamShape = (gpu, size, color) => {
  const shape = new Shape(gpu);
  shape.applyPrimitiveAsset(Primitive.cuboid(size[0], size[1], size[2]));
  shape.endShape();
  shape.setMaterial("smooth-shader", {
    has_bone: 0,
    use_texture: 0,
    color: [...color],
    ambient: 0.42,
    specular: 0.62,
    power: 26.0
  });
  return shape;
};

const createFloorShape = (gpu) => {
  const shape = new Shape(gpu);
  shape.applyPrimitiveAsset(Primitive.cuboid(96.0, FLOOR_HEIGHT, 68.0));
  shape.endShape();
  shape.setMaterial("smooth-shader", {
    has_bone: 0,
    use_texture: 0,
    color: [0.33, 0.36, 0.40, 1.0],
    ambient: 0.56,
    specular: 0.18,
    power: 12.0
  });
  return shape;
};

const createBackdropShape = (gpu) => {
  const shape = new Shape(gpu);
  shape.applyPrimitiveAsset(Primitive.cuboid(112.0, 58.0, 2.0));
  shape.endShape();
  shape.setMaterial("smooth-shader", {
    has_bone: 0,
    use_texture: 0,
    color: [0.86, 0.91, 0.96, 1.0],
    ambient: 0.84,
    specular: 0.08,
    power: 8.0
  });
  return shape;
};

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
  body.setFixedRotation(entry.fixedRotation);
  body.setBodyType("dynamic", {
    clearVelocity: false,
    restoreVelocity: false
  });
};

const applyTorquePulse = (entry) => {
  if (!Array.isArray(entry.torquePulse)) {
    return;
  }
  entry.body.applyTorque(entry.torquePulse);
};

const applyContinuousTorque = (entry) => {
  if (!Array.isArray(entry.continuousTorque)) {
    return;
  }
  if (entry.torqueDurationSec !== null && entry.elapsedSec >= entry.torqueDurationSec) {
    return;
  }
  entry.body.applyTorque(entry.continuousTorque);
};

const cloneRestColor = (color, scale = FEATURED_COLOR_DIM_SCALE) => ([
  clamp(color[0] * scale, 0.0, 1.0),
  clamp(color[1] * scale, 0.0, 1.0),
  clamp(color[2] * scale, 0.0, 1.0),
  1.0
]);

const getEntryPhase = (entry) => {
  if (entry.name === "torque_beam") {
    return entry.elapsedSec < entry.torqueDurationSec ? "torque on" : "torque off";
  }
  if (entry.name === "fall_beam") {
    if (entry.body.getSleeping()) {
      return "sleep";
    }
    const y = entry.body.getPosition()[1];
    if (y > -4.0) {
      return "falling";
    }
    if (y > -11.5) {
      return "impacting blocks";
    }
    return "settling";
  }
  return "";
};

const formatStatus = (entries, paused) => {
  const lines = [
    "unittest/physics_node_rotate",
    "quaternion-based visible rotation from angularVelocity and torque",
    `state: ${paused ? "paused" : "running"}`,
    `blue torque time: first ${BLUE_TORQUE_DURATION_SEC.toFixed(1)} sec only`,
    "green target: gray dynamic blocks on the floor",
    "controls: Space pause/resume, R reset, T strong torque pulse for blue",
    ""
  ];

  for (let i = 0; i < entries.length; i++) {
    lines.push(entries[i].role);
  }
  lines.push("");

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const pos = entry.body.getPosition();
    const ang = entry.body.getAngularVelocity();
    const attitude = entry.body.getLocalAttitude();
    const phase = getEntryPhase(entry);
    lines.push(
      `${entry.name}: ${phase}${phase ? "  " : ""}yaw=${attitude[0].toFixed(1)} pitch=${attitude[1].toFixed(1)} roll=${attitude[2].toFixed(1)}  av(y,p,r)=(${ang[0].toFixed(1)}, ${ang[1].toFixed(1)}, ${ang[2].toFixed(1)})  y=${pos[1].toFixed(2)}`
    );
  }
  return lines.join("\n");
};

const start = async ({ screen, gpu, setStatus, setViewportLayout, startLoop, document }) => {
  const shader = new SmoothShader(gpu);
  await shader.init();
  Shape.prototype.shader = shader;
  shader.setLightPosition([80.0, 120.0, 160.0, 1.0]);

  setViewportLayout(() => {
    setProjection(screen, shader, 48.0);
  });

  const space = new Space();
  const world = new PhysicsSpace({
    gravity: [0.0, -42.0, 0.0],
    fixedTimeStepMs: 1000.0 / 120.0,
    maxSubSteps: 6,
    solverIterations: 5,
    defaultRestitution: 0.0,
    sleepLinearThreshold: 0.2,
    sleepAngularThreshold: 0.25,
    sleepStepsThreshold: 3
  });

  const eye = space.addNode(null, "eye");
  eye.setPosition(0.0, 10.0, 66.0);
  eye.setAttitude(0.0, -8.0, 0.0);

  const floorVisual = space.addNode(null, "floor_visual");
  floorVisual.setPosition(0.0, FLOOR_CENTER_Y, -28.0);
  floorVisual.addShape(createFloorShape(gpu));

  const floorNode = space.addPhysicsNode(null, "floor", {
    bodyType: "static"
  });
  floorNode.setPosition(0.0, FLOOR_CENTER_Y + FLOOR_HEIGHT * 0.5, -28.0);
  // 床は PlaneCollider にし、回転する beam が床 contact でどう止まるかを見やすくする
  // 床の見た目の厚みと物理判定を分けることで、接触法線を常に上向きに保つ
  floorNode.setCollider(new PlaneCollider([0.0, 1.0, 0.0]));
  floorNode.setPhysicsMaterial({
    restitution: 0.0,
    friction: 0.7
  });
  world.addBody(floorNode);

  const backdropNode = space.addNode(null, "backdrop");
  backdropNode.setPosition(0.0, 4.0, -64.0);
  backdropNode.addShape(createBackdropShape(gpu));

  const bodyEntries = [];
  const interactionEntries = [];
  for (let i = 0; i < BODY_SPECS.length; i++) {
    const spec = BODY_SPECS[i];
    const body = space.addPhysicsNode(null, spec.name, {
      bodyType: "kinematic",
      mass: spec.size[0] * 0.2,
      gravityScale: spec.gravityScale,
      linearDamping: spec.linearDamping,
      angularDamping: spec.angularDamping,
      fixedRotation: spec.fixedRotation
    });
    body.addShape(createBeamShape(gpu, spec.size, spec.color));
    // beam は細長い BoxCollider を持ち、body quaternion に追従する OBB として接触判定される
    // この test では姿勢更新と contact の見え方を合わせて観察する
    body.setCollider(new BoxCollider(spec.size));
    body.setPhysicsMaterial({
      restitution: 0.0,
      friction: 0.5
    });
    world.addBody(body);
    bodyEntries.push({
      name: spec.name,
      body,
      initialPosition: [...spec.position],
      initialAttitude: [...spec.attitude],
      initialVelocity: [...spec.velocity],
      initialAngularVelocity: [...spec.angularVelocity],
      fixedRotation: spec.fixedRotation,
      continuousTorque: spec.continuousTorque ? [...spec.continuousTorque] : null,
      torqueDurationSec: spec.torqueDurationSec ?? null,
      torquePulse: spec.torquePulse ? [...spec.torquePulse] : null,
      elapsedSec: 0.0,
      role: spec.role,
      restColor: cloneRestColor(spec.color)
    });
  }

  for (let i = 0; i < IMPACT_BLOCK_SPECS.length; i++) {
    const spec = IMPACT_BLOCK_SPECS[i];
    const body = space.addPhysicsNode(null, spec.name, {
      bodyType: "kinematic",
      mass: 1.4,
      gravityScale: 1.0,
      linearDamping: 0.25,
      angularDamping: 0.2,
      fixedRotation: false
    });
    body.addShape(createBeamShape(gpu, spec.size, spec.color));
    // impact block も BoxCollider を持つ dynamic body とし、落下 beam との box-box contact を見せる
    // 灰色 block 群は接触で押される相手として配置している
    body.setCollider(new BoxCollider(spec.size));
    body.setPhysicsMaterial({
      restitution: 0.0,
      friction: 0.65
    });
    world.addBody(body);
    interactionEntries.push({
      name: spec.name,
      body,
      initialPosition: [...spec.position],
      initialAttitude: [0.0, 0.0, 0.0],
      initialVelocity: [0.0, 0.0, 0.0],
      initialAngularVelocity: [0.0, 0.0, 0.0],
      fixedRotation: false,
      continuousTorque: null,
      torqueDurationSec: null,
      torquePulse: null,
      elapsedSec: 0.0,
      role: "gray support block",
      restColor: cloneRestColor(spec.color, 0.92)
    });
  }

  const resetEntries = [...bodyEntries, ...interactionEntries];

  let paused = false;
  let previousTimeMs = null;

  const resetAllBodies = () => {
    previousTimeMs = null;
    world.accumulatorMs = 0.0;
    for (let i = 0; i < resetEntries.length; i++) {
      resetEntries[i].elapsedSec = 0.0;
      resetBodyEntry(resetEntries[i]);
    }
    for (let i = 0; i < bodyEntries.length; i++) {
      applyTorquePulse(bodyEntries[i]);
    }
  };

  resetAllBodies();

  document.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    if (key === " ") {
      paused = !paused;
      event.preventDefault();
    } else if (key === "r") {
      resetAllBodies();
      paused = false;
      event.preventDefault();
    } else if (key === "t") {
      for (let i = 0; i < bodyEntries.length; i++) {
        applyTorquePulse(bodyEntries[i]);
      }
      event.preventDefault();
    }
  });

  startLoop((timeMs) => {
    if (previousTimeMs === null) {
      previousTimeMs = timeMs;
    }
    const deltaMs = timeMs - previousTimeMs;
    previousTimeMs = timeMs;

    if (!paused) {
      for (let i = 0; i < bodyEntries.length; i++) {
        bodyEntries[i].elapsedSec += Math.min(deltaMs, 40.0) / 1000.0;
        applyContinuousTorque(bodyEntries[i]);
      }
      world.step(Math.min(deltaMs, 40.0));
    }

    screen.clear();
    space.draw(eye);
    screen.present();
    setStatus(formatStatus(bodyEntries, paused));
  });
};

bootUnitTestApp({
  clearColor: CLEAR_COLOR,
  initialStatus: "running physics_node_rotate..."
}, start);
