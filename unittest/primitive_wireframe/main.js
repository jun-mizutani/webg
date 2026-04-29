// ---------------------------------------------
// unittest/primitive_wireframe/main.js  2026/04/10
//   primitive_wireframe sample
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import Space from "../../webg/Space.js";
import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";
import Matrix from "../../webg/Matrix.js";
import SmoothShader from "../../webg/SmoothShader.js";
import { bootUnitTestApp } from "../_shared/UnitTestApp.js";

// webgクラスの役割:
// UnitTestApp: Screen 初期化、viewport 追従、status / error 表示を共通化
// Primitive  : wireframe 切替対象にする基本形状 asset を生成
// Shape      : primitive asset を描画可能な shape として保持し、wireframe 状態を切り替える
// SmoothShader: solid 表示時の基本ライティングを与え、wireframe 切替との差を見やすくする

const SPEED = 0.44;
const PRIMITIVES = [
  { label: "sphere", build: (shape) => Primitive.sphere(8, 18, 18, shape.getPrimitiveOptions()) },
  { label: "cone", build: (shape) => Primitive.cone(10, 6, 18, shape.getPrimitiveOptions()) },
  { label: "trunc", build: (shape) => Primitive.truncated_cone(8, 2, 5, 18, shape.getPrimitiveOptions()) },
  { label: "double", build: (shape) => Primitive.double_cone(10, 8, 18, shape.getPrimitiveOptions()) },
  { label: "prism", build: (shape) => Primitive.prism(12, 4, 18, shape.getPrimitiveOptions()) },
  { label: "donut", build: (shape) => Primitive.donut(8, 3, 18, 18, shape.getPrimitiveOptions()) },
  { label: "cube", build: (shape) => Primitive.cube(8, shape.getPrimitiveOptions()) },
  { label: "cuboid", build: (shape) => Primitive.cuboid(10, 7, 6, shape.getPrimitiveOptions()) },
  { label: "arrow", build: (shape) => Primitive.arrow(14, 4, 2.8, 16, shape.getPrimitiveOptions()) }
];
const PALETTE = [
  [0.92, 0.48, 0.38, 1.0],
  [0.95, 0.72, 0.32, 1.0],
  [0.88, 0.87, 0.34, 1.0],
  [0.44, 0.82, 0.55, 1.0],
  [0.34, 0.76, 0.82, 1.0],
  [0.39, 0.62, 0.95, 1.0],
  [0.63, 0.50, 0.94, 1.0],
  [0.86, 0.43, 0.80, 1.0],
  [0.92, 0.55, 0.66, 1.0]
];

const setProjection = (screen, shader, angle = 50) => {
  // 3x3 配置の形状を一度に見渡しやすい固定投影へそろえる
  const proj = new Matrix();
  const fov = screen.getRecommendedFov(angle);
  proj.makeProjectionMatrix(0.1, 1200.0, fov, screen.getAspect());
  shader.setProjectionMatrix(proj);
};

const createShape = (gpu, entry, color) => {
  // unittest では material 条件を固定し、geometry 差と wireframe 切替だけを確認しやすくする
  const shape = new Shape(gpu);
  shape.applyPrimitiveAsset(entry.build(shape));
  shape.endShape();
  shape.shaderParameter("has_bone", 0);
  shape.shaderParameter("color", color);
  shape.shaderParameter("ambient", 0.24);
  shape.shaderParameter("specular", 0.86);
  shape.shaderParameter("power", 42.0);
  return shape;
};

const start = async ({ screen, gpu, setStatus, setViewportLayout, startLoop, document }) => {
  const shader = new SmoothShader(gpu);
  await shader.init();
  Shape.prototype.shader = shader;
  setViewportLayout(() => {
    setProjection(screen, shader, 50);
  });
  shader.setLightPosition([0.0, 90.0, 150.0, 1.0]);

  const shapes = PRIMITIVES.map((entry, index) => createShape(gpu, entry, PALETTE[index]));

  const space = new Space();
  const eye = space.addNode(null, "eye");
  eye.setPosition(0, 2, 92);
  eye.setAttitude(0, -10, 0);

  const nodes = [];
  const rotations = [];
  for (let i = 0; i < shapes.length; i++) {
    const node = space.addNode(null, `primitive_${PRIMITIVES[i].label}`);
    const col = i % 3;
    const row = Math.floor(i / 3);
    node.setPosition((col - 1) * 22.0, (1 - row) * 22.0, -18.0);
    node.addShape(shapes[i]);
    nodes.push(node);
    rotations.push((0.55 + i * 0.14) * SPEED);
  }

  const wireframeStates = Array.from({ length: shapes.length }, () => false);

  const syncWireframeStates = () => {
    // shape ごとの現在状態をそのまま描画 object へ反映し、
    // 数字キーの個別切替と W の一括切替を同じ経路で扱う
    for (let i = 0; i < shapes.length; i++) {
      shapes[i].setWireframe(wireframeStates[i]);
    }
  };

  let paused = false;
  const setAllWireframe = (enabled) => {
    // unittest の比較用に、全 primitive を同じ状態へまとめて切り替える
    for (let i = 0; i < wireframeStates.length; i++) {
      wireframeStates[i] = enabled;
    }
    syncWireframeStates();
  };

  const togglePrimitiveWireframe = (index) => {
    // 数字キー 1-9 は表示中の各 primitive に対応し、
    // その shape だけ wireframe を反転できるようにする
    if (index < 0 || index >= wireframeStates.length) return false;
    wireframeStates[index] = !wireframeStates[index];
    syncWireframeStates();
    return true;
  };

  const areAllWireframeEnabled = () => {
    for (let i = 0; i < wireframeStates.length; i++) {
      if (!wireframeStates[i]) return false;
    }
    return true;
  };

  document.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    if (key === " ") {
      paused = !paused;
    } else if (key === "w") {
      setAllWireframe(!areAllWireframeEnabled());
    } else if (key >= "1" && key <= "9") {
      togglePrimitiveWireframe(Number(key) - 1);
    }
  });

  startLoop(() => {
    if (!paused) {
      // 少しずつ回し続け、面の向きと線の消え方をいろいろな角度から見られるようにする
      for (let i = 0; i < nodes.length; i++) {
        nodes[i].rotateX(rotations[i] * 0.78);
        nodes[i].rotateY(rotations[i]);
      }
    }

    screen.clear();
    space.draw(eye);
    screen.present();

    const enabledIndices = [];
    for (let i = 0; i < wireframeStates.length; i++) {
      if (wireframeStates[i]) enabledIndices.push(String(i + 1));
    }

    setStatus(
      "unittest/primitive_wireframe\n"
      + `paused: ${paused ? "yes" : "no"}\n`
      + `wireframe all: ${areAllWireframeEnabled() ? "on" : "off"}\n`
      + `wireframe index: ${enabledIndices.length > 0 ? enabledIndices.join(",") : "-" }\n`
      + "1 sphere   2 cone    3 trunc\n"
      + "4 double   5 prism   6 donut\n"
      + "7 cube     8 cuboid  9 arrow\n"
      + "[1-9] toggle one  [w] toggle all  [space] pause/resume"
    );
  });
};

bootUnitTestApp({
  statusElementId: "status",
  initialStatus: "creating screen...",
  clearColor: [0.07, 0.09, 0.12, 1.0]
}, (app) => {
  return start(app);
});
