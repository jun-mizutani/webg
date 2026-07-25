// ---------------------------------------------
// unittest/physics_node_fall/main.js  2026/05/06
//   physics_node_fall unittest
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

const BODY_SPECS = [
  {
    name: "box_a",
    size: 8.0,
    position: [-24.0, 34.0, -32.0],
    attitude: [16.0, -10.0, 12.0],
    velocity: [1.8, 0.0, 0.0],
    color: [0.88, 0.44, 0.34, 1.0]
  },
  {
    name: "box_b",
    size: 6.8,
    position: [-8.0, 28.0, -22.0],
    attitude: [-14.0, 22.0, -8.0],
    velocity: [-1.2, 0.0, 0.0],
    color: [0.32, 0.72, 0.95, 1.0]
  },
  {
    name: "box_c",
    size: 9.0,
    position: [11.0, 38.0, -30.0],
    attitude: [11.0, 14.0, -18.0],
    velocity: [0.9, 0.0, 0.0],
    color: [0.38, 0.82, 0.52, 1.0]
  },
  {
    name: "box_d",
    size: 7.6,
    position: [27.0, 31.0, -20.0],
    attitude: [-18.0, -16.0, 10.0],
    velocity: [-1.5, 0.0, 0.0],
    color: [0.92, 0.80, 0.34, 1.0]
  }
];

// 値を範囲に収める
// fixed timestep の一時停止明けで deltaMs が大きく跳ねても
// accumulator が過剰に膨らまないように使う
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// 透視投影行列を shader へ流す
// resize のたびに呼び、画面縦横比が変わっても箱の見え方が崩れないようにする
const setProjection = (screen, shader, angle = 48.0) => {
  const proj = new Matrix();
  const fov = screen.getRecommendedFov(angle);
  proj.makeProjectionMatrix(0.1, 1200.0, fov, screen.getAspect());
  shader.setProjectionMatrix(proj);
};

// 立方体用 Shape を生成する
// 形の違いではなく落下と停止を見たい test なので、単色の cube だけに絞る
const createCubeShape = (gpu, size, color) => {
  const shape = new Shape(gpu);
  shape.applyPrimitiveAsset(Primitive.cube(size));
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

// 床 Shape を生成する
// floor を厚み付き cuboid にしておくと、停止高さを数値でも目視でも追いやすい
const createFloorShape = (gpu) => {
  const shape = new Shape(gpu);
  shape.applyPrimitiveAsset(Primitive.cuboid(92.0, FLOOR_HEIGHT, 64.0));
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

// 背景板 Shape を生成する
// 奥行きの基準を置き、立方体の落下量と傾きを読み取りやすくする
const createBackdropShape = (gpu) => {
  const shape = new Shape(gpu);
  shape.applyPrimitiveAsset(Primitive.cuboid(104.0, 56.0, 2.0));
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

// 1 個の立方体を初期状態へ戻す
// dynamic 中は直接位置変更できないため、reset では一度 kinematic に戻してから再投入する
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
  body.setAngularVelocity(0.0, 0.0, 0.0);
  entry.shape.updateMaterial({
    color: [...entry.activeColor]
  });
  body.setBodyType("dynamic", {
    clearVelocity: false,
    restoreVelocity: false
  });
};

// status 表示を組み立てる
// 何個止まったか、どの bodyType にいるか、現在の操作方法を 1 か所で読めるようにする
const formatStatus = (entries, paused, settledThisRun) => {
  const lines = [
    "unittest/physics_node_fall",
    "tilted cubes fall through PhysicsSpace and stop on the floor",
    `state: ${paused ? "paused" : "running"}`,
    `settled: ${settledThisRun}/${entries.length}`,
    "controls: Space pause/resume, R reset",
    ""
  ];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const pos = entry.body.getPosition();
    lines.push(
      `${entry.name}: ${entry.body.getBodyType()} / ${entry.body.getSleeping() ? "sleeping" : "awake"}  x=${pos[0].toFixed(2)} y=${pos[1].toFixed(2)} z=${pos[2].toFixed(2)}`
    );
  }
  return lines.join("\n");
};

// 起動後の scene、入力、固定 timestep を初期化する
// PhysicsSpace 本体の前段として、PhysicsNode の利用イメージを小さく可視化する
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
    sleepLinearThreshold: 0.2
  });

  const eye = space.addNode(null, "eye");
  eye.setPosition(0.0, 8.0, 60.0);
  eye.setAttitude(0.0, -7.0, 0.0);

  const floorVisual = space.addNode(null, "floor_visual");
  floorVisual.setPosition(0.0, FLOOR_CENTER_Y, -28.0);
  floorVisual.addShape(createFloorShape(gpu));

  const floorNode = space.addPhysicsNode(null, "floor", {
    bodyType: "static"
  });
  floorNode.setPosition(0.0, FLOOR_CENTER_Y + FLOOR_HEIGHT * 0.5, -28.0);
  // 床の見た目は薄い箱だが、物理判定は無限平面 collider にする
  // 落下停止の確認では床端の形状ではなく、plane contact と sleep の安定性を見たい
  floorNode.setCollider(new PlaneCollider([0.0, 1.0, 0.0]));
  floorNode.setPhysicsMaterial({
    restitution: 0.0,
    friction: 0.7
  });
  world.addBody(floorNode);

  const backdropNode = space.addNode(null, "backdrop");
  backdropNode.setPosition(0.0, 4.0, -62.0);
  backdropNode.addShape(createBackdropShape(gpu));

  const bodyEntries = [];
  for (let i = 0; i < BODY_SPECS.length; i++) {
    const spec = BODY_SPECS[i];
    const body = space.addPhysicsNode(null, spec.name, {
      bodyType: "kinematic",
      mass: spec.size * 0.4,
      gravityScale: 1.0,
      linearDamping: 1.8
    });
    const shape = createCubeShape(gpu, spec.size, spec.color);
    body.addShape(shape);
    // 見た目の cube と同じ大きさの BoxCollider を設定し、床との接触で止まることを確認する
    // この visual test は数値 assert ではなく、contact による押し戻しと sleep の見え方を担当する
    body.setCollider(new BoxCollider([spec.size, spec.size, spec.size]));
    body.setPhysicsMaterial({
      restitution: 0.0,
      friction: 0.5
    });
    world.addBody(body);
    bodyEntries.push({
      name: spec.name,
      body,
      shape,
      initialPosition: [...spec.position],
      initialAttitude: [...spec.attitude],
      initialVelocity: [...spec.velocity],
      activeColor: [...spec.color],
      restColor: [
        clamp(spec.color[0] * 0.88, 0.0, 1.0),
        clamp(spec.color[1] * 0.88, 0.0, 1.0),
        clamp(spec.color[2] * 0.88, 0.0, 1.0),
        1.0
      ]
    });
  }

  let paused = false;
  let previousTimeMs = null;
  let settledThisRun = 0;

  const resetAllBodies = () => {
    settledThisRun = 0;
    previousTimeMs = null;
    world.accumulatorMs = 0.0;
    for (let i = 0; i < bodyEntries.length; i++) {
      resetBodyEntry(bodyEntries[i]);
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
    }
  });

  startLoop((timeMs) => {
    if (previousTimeMs === null) {
      previousTimeMs = timeMs;
    }
    const deltaMs = clamp(timeMs - previousTimeMs, 0.0, 80.0);
    previousTimeMs = timeMs;

    if (!paused) {
      world.step(deltaMs);
      settledThisRun = 0;
      for (let i = 0; i < bodyEntries.length; i++) {
        const entry = bodyEntries[i];
        if (entry.body.getSleeping()) {
          settledThisRun += 1;
          entry.shape.updateMaterial({
            color: [...entry.restColor]
          });
        } else {
          entry.shape.updateMaterial({
            color: [...entry.activeColor]
          });
        }
      }
    }

    screen.clear();
    space.draw(eye);
    screen.present();
    setStatus(formatStatus(bodyEntries, paused, settledThisRun));
  });
};

bootUnitTestApp(
  {
    clearColor: CLEAR_COLOR,
    initialStatus: "creating physics node fall test..."
  },
  start
);
