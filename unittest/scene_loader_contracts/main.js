// ---------------------------------------------
// unittest/scene_loader_contracts/main.js  2026/07/25
//   scene_loader_contracts unittest
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import SceneAsset from "../../webg/SceneAsset.js";
import Space from "../../webg/Space.js";
import Shape from "../../webg/Shape.js";
import Primitive from "../../webg/Primitive.js";
import Matrix from "../../webg/Matrix.js";
import SmoothShader from "../../webg/SmoothShader.js";
import { bootUnitTestApp } from "../shared/UnitTestApp.js";

const CLEAR_COLOR = [0.06, 0.09, 0.12, 1.0];
const CRATE_START_POSITION = [0.0, 8.0, -24.0];
const CRATE_START_VELOCITY = [0.0, 0.0, 0.0];
const CRATE_START_ANGULAR_VELOCITY = [0.0, 0.0, 0.0];
const FLOOR_CENTER_Y = -22.0;
const FLOOR_HEIGHT = 4.0;
const FLOOR_TOP_Y = FLOOR_CENTER_Y + FLOOR_HEIGHT * 0.5;
const lines = [];
let passCount = 0;
let failCount = 0;

const SCENE_DATA = {
  type: "webg-scene",
  version: "1.0",
  physicsSpace: {
    gravity: [0.0, -32.0, 0.0],
    fixedTimeStepMs: 1000.0 / 120.0,
    maxSubSteps: 6,
    solverIterations: 5,
    defaultRestitution: 0.0,
    defaultFriction: 0.45,
    sleepLinearThreshold: 0.18,
    sleepAngularThreshold: 0.22,
    sleepStepsThreshold: 3
  },
  input: {
    bindings: [
      { key: "r", action: "reset-crate", description: "reset crate" }
    ]
  },
  primitives: [
    {
      id: "floor",
      type: "cuboid",
      args: [84.0, 4.0, 56.0],
      transform: {
        translation: [0.0, FLOOR_CENTER_Y, -24.0],
        rotation: [0.0, 0.0, 0.0, 1.0],
        scale: [1.0, 1.0, 1.0]
      },
      material: {
        id: "smooth-shader",
        shaderParams: {
          has_bone: 0,
          use_texture: 0,
          color: [0.52, 0.56, 0.60, 1.0],
          ambient: 0.74,
          specular: 0.20,
          power: 10.0
        }
      },
      physics: {
        bodyType: "static",
        collider: {
          type: "plane",
          normal: [0.0, 1.0, 0.0],
          offset: [0.0, FLOOR_HEIGHT * 0.5, 0.0]
        },
        material: {
          friction: 0.72,
          restitution: 0.0
        }
      }
    },
    {
      id: "crate",
      type: "cuboid",
      args: [8.0, 8.0, 8.0],
      transform: {
        translation: [...CRATE_START_POSITION],
        rotation: [0.0, 0.0, 0.0, 1.0],
        scale: [1.0, 1.0, 1.0]
      },
      material: {
        id: "smooth-shader",
        shaderParams: {
          has_bone: 0,
          use_texture: 0,
          color: [0.34, 0.72, 0.95, 1.0],
          ambient: 0.42,
          specular: 0.62,
          power: 26.0
        }
      },
      physics: {
        bodyType: "dynamic",
        mass: 3.2,
        linearDamping: 0.35,
        angularDamping: 0.1,
        velocity: [...CRATE_START_VELOCITY],
        angularVelocity: [...CRATE_START_ANGULAR_VELOCITY],
        collider: {
          type: "box",
          size: [8.0, 8.0, 8.0]
        },
        material: {
          friction: 0.45,
          restitution: 0.0
        }
      }
    }
  ]
};

const log = (line) => {
  lines.push(line);
};

// 値を現在の入力と状態から求め、呼び出し元へ返す
const formatValue = (value) => {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

// このインスタンスを検証し、後続処理が扱える共通形式へ整える
const check = (label, condition, detail = "") => {
  if (condition) {
    passCount += 1;
    log(`PASS ${label}`);
  } else {
    failCount += 1;
    log(`FAIL ${label}${detail ? `: ${detail}` : ""}`);
  }
};

// 投影を受け取り、現在の設定と後続処理へ反映する
const setProjection = (screen, shader, angle = 48.0) => {
  const proj = new Matrix();
  const fov = screen.getRecommendedFov(angle);
  proj.makeProjectionMatrix(0.1, 1200.0, fov, screen.getAspect());
  shader.setProjectionMatrix(proj);
};

const cloneSceneData = () => JSON.parse(JSON.stringify(SCENE_DATA));

// 状態表示を生成し、後続処理で利用できる状態にする
const buildStatus = ({ runtime, paused, beforePos, afterPos }) => {
  const crateEntry = runtime.getEntry("crate");
  const floorEntry = runtime.getEntry("floor");
  const crateBody = crateEntry?.physicsNode ?? null;
  const linesOut = [
    "scene_loader_contracts",
    "visual guide: blue crate = dynamic body, gray floor = static body",
    `checks: ${passCount} pass / ${failCount} fail`,
    `state: ${paused ? "paused" : "running"}`,
    "controls: Space pause/resume, R reset crate",
    "",
    `runtime.physicsSpace: ${runtime.physicsSpace ? "present" : "missing"}`,
    `floor physicsNode: ${floorEntry?.physicsNode ? floorEntry.physicsNode.getBodyType() : "none"}`,
    "expected motion: crate falls straight down from y=8.0 to about y=-16.0 and then stops",
    ""
  ];
  if (crateBody) {
    const position = crateBody.getPosition();
    const attitude = crateBody.getLocalAttitude();
    linesOut.push(
      `crate: ${crateBody.getBodyType()} / ${crateBody.getSleeping() ? "sleep" : "awake"}  x=${position[0].toFixed(2)} y=${position[1].toFixed(2)} z=${position[2].toFixed(2)}`
    );
    linesOut.push(
      `crate attitude: yaw=${attitude[0].toFixed(1)} pitch=${attitude[1].toFixed(1)} roll=${attitude[2].toFixed(1)}`
    );
  }
  linesOut.push(
    `smoke motion: before=${beforePos.map((v) => v.toFixed(3)).join(", ")}  after=${afterPos.map((v) => v.toFixed(3)).join(", ")}`
  );
  linesOut.push("");
  for (let i = 0; i < lines.length; i++) {
    linesOut.push(lines[i]);
  }
  return linesOut.join("\n");
};

// このインスタンスの初期化段階で、必要な状態と資源を準備して処理を開始する
const start = async ({ screen, gpu, setStatus, setViewportLayout, startLoop, document }) => {
  const shader = new SmoothShader(gpu);
  await shader.init();
  Shape.prototype.shader = shader;
  shader.setLightPosition([80.0, 120.0, 160.0, 1.0]);

  setViewportLayout(() => {
    setProjection(screen, shader, 48.0);
  });

  const sceneAsset = SceneAsset.fromData(cloneSceneData());
  const validateResult = sceneAsset.validate();
  check("SceneAsset.validate accepts physicsSpace scene", validateResult.ok, formatValue(validateResult.errors));
  check("SceneAsset.validate warning count is finite", Number.isFinite(validateResult.warnings.length), formatValue(validateResult.warnings));

  const space = new Space();
  const runtime = await sceneAsset.build({ gpu, space });
  check("sceneRuntime includes physicsSpace", runtime.physicsSpace !== null && runtime.physicsSpace !== undefined);
  check("sceneRuntime exposes stepPhysics()", typeof runtime.stepPhysics === "function");

  const floorEntry = runtime.getEntry("floor");
  const crateEntry = runtime.getEntry("crate");
  check("floor entry has physicsNode", floorEntry?.physicsNode !== null && floorEntry?.physicsNode !== undefined);
  check("crate entry has physicsNode", crateEntry?.physicsNode !== null && crateEntry?.physicsNode !== undefined);
  check("floor physicsNode is static", floorEntry?.physicsNode?.getBodyType?.() === "static", floorEntry?.physicsNode?.getBodyType?.());
  check("crate physicsNode is dynamic", crateEntry?.physicsNode?.getBodyType?.() === "dynamic", crateEntry?.physicsNode?.getBodyType?.());

  const beforePos = crateEntry.physicsNode.getPosition();
  const stepCount = runtime.stepPhysics(1000.0 / 60.0);
  const afterPos = crateEntry.physicsNode.getPosition();
  check("stepPhysics performs at least one fixed step", stepCount >= 1, formatValue(stepCount));
  check("crate moves downward after stepPhysics", afterPos[1] < beforePos[1], formatValue({ beforePos, afterPos }));
  check("crate keeps zero horizontal motion after stepPhysics", Math.abs(afterPos[0] - beforePos[0]) <= 1.0e-8, formatValue({ beforePos, afterPos }));
  check("crate remains above floor top at first step", afterPos[1] > FLOOR_TOP_Y, formatValue({ afterPos, floorTopY: FLOOR_TOP_Y }));

  const eye = space.addNode(null, "eye");
  eye.setPosition(0.0, -6.0, 80.0);
  eye.setAttitude(0.0, 0.0, 0.0);

  // `crate`を初期状態へ戻し、前回の状態を残さない
  const resetCrate = () => {
    const body = crateEntry.physicsNode;
    body.wakeUp();
    body.setBodyType("kinematic", {
      clearVelocity: true,
      restoreVelocity: false
    });
    body.setPosition(
      CRATE_START_POSITION[0],
      CRATE_START_POSITION[1],
      CRATE_START_POSITION[2]
    );
    body.setAttitude(0.0, 0.0, 0.0);
    body.setLinearVelocity(
      CRATE_START_VELOCITY[0],
      CRATE_START_VELOCITY[1],
      CRATE_START_VELOCITY[2]
    );
    body.setAngularVelocity(
      CRATE_START_ANGULAR_VELOCITY[0],
      CRATE_START_ANGULAR_VELOCITY[1],
      CRATE_START_ANGULAR_VELOCITY[2]
    );
    body.clearAccumulators();
    body.setBodyType("dynamic", {
      clearVelocity: false,
      restoreVelocity: false
    });
    runtime.physicsSpace.resetAccumulator();
  };

  const input = runtime.createInputHandler({
    "reset-crate": () => resetCrate()
  });

  let paused = false;
  let previousTimeMs = null;

  document.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    if (key === " ") {
      paused = !paused;
      event.preventDefault();
      return;
    }
    input.onKeyDown(event.key, event);
  });

  startLoop((timeMs) => {
    if (previousTimeMs === null) {
      previousTimeMs = timeMs;
    }
    const deltaMs = Math.min(40.0, timeMs - previousTimeMs);
    previousTimeMs = timeMs;

    if (!paused) {
      runtime.stepPhysics(deltaMs);
      runtime.update();
    }

    screen.clear();
    space.draw(eye);
    screen.present();
    setStatus(buildStatus({ runtime, paused, beforePos, afterPos }));
  });
};

bootUnitTestApp({
  clearColor: CLEAR_COLOR,
  initialStatus: "loading scene_loader_contracts..."
}, start);
