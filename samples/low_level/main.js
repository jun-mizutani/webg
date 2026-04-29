// ---------------------------------------------
// samples/low_level/main.js  2026/04/12
//   low_level sample
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import Screen from "../../webg/Screen.js";
import Space from "../../webg/Space.js";
import Shape from "../../webg/Shape.js";
import Primitive from "../../webg/Primitive.js";
import Matrix from "../../webg/Matrix.js";
import SmoothShader from "../../webg/SmoothShader.js";

// webgクラスの役割:
// Screen    : canvas と WebGPU device / command encoder の初期化を担当する
// Space     : scene graph と draw 順序を保持する
// Shape     : primitive を GPU buffer 化し、材質設定と一緒に node へ渡す
// Primitive : 球や立方体などの基本形状データを作る
// Matrix    : projection matrix を作り、shader へ渡す
// SmoothShader: 最小の立体物へ光を当てる標準 shader

const CLEAR_COLOR = [0.1, 0.15, 0.1, 1.0];
const VIEW_ANGLE = 55.0;
const LIGHT_POSITION = [120.0, 180.0, 140.0, 1.0];
const OBJECT_COLOR = [1.0, 0.5, 0.3, 1.0];
const CAMERA_DISTANCE = 8.0;
const ROTATE_Y_SPEED = 0.8;
const ROTATE_X_SPEED = 0.4;

let screen = null;
let shader = null;
let space = null;
let eye = null;
let sampleNode = null;

const showStartError = (error) => {
  // WebgApp を使わない sample でも起動失敗理由が画面から追えるように、DOM で固定表示する
  const existing = document.getElementById("start-error");
  if (existing) existing.remove();
  const panel = document.createElement("pre");
  panel.id = "start-error";
  panel.textContent = `low_level failed\n${error?.message ?? String(error ?? "")}`;
  Object.assign(panel.style, {
    position: "fixed",
    left: "12px",
    top: "12px",
    margin: "0",
    padding: "12px 14px",
    background: "rgba(30, 45, 30, 0.92)",
    color: "#ffd7df",
    border: "1px solid rgba(255, 163, 186, 0.55)",
    borderRadius: "10px",
    whiteSpace: "pre-wrap",
    maxWidth: "min(560px, calc(100vw - 24px))",
    zIndex: "50"
  });
  document.body.appendChild(panel);
};

const applyViewportLayout = () => {
  // canvas size と projection matrix を同じタイミングで更新し、縦横比の崩れを避ける
  if (!screen || !shader) return;
  screen.resize(
    Math.max(1, Math.floor(window.innerWidth)),
    Math.max(1, Math.floor(window.innerHeight))
  );
  const projection = new Matrix();
  projection.makeProjectionMatrix(
    0.1,
    1000.0,
    screen.getRecommendedFov(VIEW_ANGLE),
    screen.getAspect()
  );
  shader.setProjectionMatrix(projection);
};

const createSampleShape = (gpu) => {
  // 回転が読み取りやすいよう、README の最小例も立方体へそろえて表示する
  const shape = new Shape(gpu);
  shape.applyPrimitiveAsset(Primitive.cube(2.0, shape.getPrimitiveOptions()));
  shape.endShape();
  shape.setMaterial("smooth-shader", {
    has_bone: 0,
    use_texture: 0,
    color: OBJECT_COLOR
  });
  return shape;
};

const buildScene = () => {
  // low-level では Space、視点 node、object node をすべて明示的に組み立てる
  space = new Space();
  eye = space.addNode(null, "eye");
  eye.setPosition(0.0, 0.0, CAMERA_DISTANCE);

  const shape = createSampleShape(screen.getGL());
  sampleNode = space.addNode(null, "obj");
  sampleNode.addShape(shape);
};

const frame = () => {
  // 毎 frame 少しずつ回転させることで、静止画では分かりにくい立体感を確認しやすくする
  sampleNode.rotateY(ROTATE_Y_SPEED);
  sampleNode.rotateX(ROTATE_X_SPEED);
  screen.clear();
  space.draw(eye);
  screen.present();
  requestAnimationFrame(frame);
};

const start = async () => {
  // README の low-level 例と同じ順序で Screen、shader、projection、scene をつなぐ
  screen = new Screen(document);
  await screen.ready;
  screen.setClearColor(CLEAR_COLOR);

  shader = new SmoothShader(screen.getGL());
  await shader.init();
  Shape.prototype.shader = shader;

  applyViewportLayout();
  window.addEventListener("resize", applyViewportLayout);
  window.addEventListener("orientationchange", applyViewportLayout);
  shader.setLightPosition(LIGHT_POSITION);

  buildScene();
  requestAnimationFrame(frame);
};

document.addEventListener("DOMContentLoaded", () => {
  start().catch((error) => {
    console.error("low_level failed:", error);
    showStartError(error);
  });
});
