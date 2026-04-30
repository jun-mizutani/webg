// ---------------------------------------------
// samples/high_level/main.js  2026/04/30
//   high_level sample
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import WebgApp from "../../webg/WebgApp.js";
import Shape from "../../webg/Shape.js";
import Primitive from "../../webg/Primitive.js";

// webgクラスの役割:
// WebgApp  : Screen / Shader / Space / Camera / Input / Message をまとめて初期化する
// EyeRig   : mouse drag / touch drag / pinch / arrow key で orbit camera を動かす
// Shape    : primitive の mesh と材質を保持する
// Primitive: 立方体 mesh を作る

const FONT_FILE = "../../webg/font512.png";
const CLEAR_COLOR = [0.1, 0.15, 0.1, 1.0];
const OBJECT_COLOR = [1.0, 0.5, 0.3, 1.0];
const CAMERA_CONFIG = {
  target: [0.0, 0.0, 0.0],
  distance: 8.0,
  yaw: 0.0,
  pitch: 0.0,
  roll: 0.0
};
const ROTATE_Y_SPEED = 0.8;
const ROTATE_X_SPEED = 0.4;

let app = null;
let orbit = null;
let sampleNode = null;

const showStartError = (error) => {
  // WebgApp 初期化前に失敗した場合でも、画面上へ失敗理由を残して原因を追いやすくする
  const existing = document.getElementById("start-error");
  if (existing) existing.remove();
  const panel = document.createElement("pre");
  panel.id = "start-error";
  panel.textContent = `high_level failed\n${error?.message ?? String(error ?? "")}`;
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

const createSampleShape = (gpu) => {
  // 回転方向が読み取りやすいよう、README の WebgApp 例も立方体へそろえる
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
  // WebgApp が用意した Space をそのまま使い、sample 側は object 追加だけに集中する
  const shape = createSampleShape(app.getGL());
  sampleNode = app.space.addNode(null, "obj");
  sampleNode.addShape(shape);
};

const setupOrbitCamera = () => {
  // README の最小例へそのまま mouse / touch の視点操作確認を足せるように、標準 orbit helper を使う
  orbit = app.createOrbitEyeRig({
    target: CAMERA_CONFIG.target,
    distance: CAMERA_CONFIG.distance,
    yaw: CAMERA_CONFIG.yaw,
    pitch: CAMERA_CONFIG.pitch,
    minDistance: 4.0,
    maxDistance: 18.0,
    wheelZoomStep: 1.0
  });
};

const attachSampleInput = () => {
  // WebgApp が初期化した InputController に sample 固有の one-shot action を足し、
  // orbit camera の連続入力と、保存系の単発入力を同じ app 入口で扱えるようにする
  app.attachInput({
    onKeyDown: (key, ev) => {
      if (ev.repeat) return;
      if (key === "s") {
        const file = app.takeScreenshot({ prefix: "high_level" });
        app.pushToast(`screenshot: ${file}`, {
          durationMs: 1400
        });
      }
    }
  });
};

const start = async () => {
  // WebgApp を入口にすると、README low-level 例で手でつないだ初期化をまとめて省略できる
  app = new WebgApp({
    document,
    messageFontTexture: FONT_FILE,
    clearColor: CLEAR_COLOR,
    camera: CAMERA_CONFIG,
    debugTools: {
      mode: "release",
      system: "high_level",
      source: "samples/high_level/main.js"
    }
  });
  await app.init();

  buildScene();
  setupOrbitCamera();
  attachSampleInput();

  app.message.setLines("guide", [
    "Drag: orbit",
    "2-finger drag: pan",
    "Pinch / wheel: zoom",
    "Arrow keys: orbit  [ / ]: zoom  S: screenshot"
  ], {
    anchor: "bottom-left",
    x: 0,
    y: -2
  });

  app.message.setLines("status", [
    "high_level sample",
    "WebgApp + EyeRig"
  ], {
    anchor: "top-left",
    x: 0,
    y: 0
  });

  app.start({
    onUpdate: ({ deltaSec }) => {
      orbit.update(deltaSec);
      sampleNode.rotateY(ROTATE_Y_SPEED);
      sampleNode.rotateX(ROTATE_X_SPEED);
    }
  });
};

document.addEventListener("DOMContentLoaded", () => {
  start().catch((error) => {
    console.error("high_level failed:", error);
    app?.showErrorPanel?.(error, {
      title: "high_level failed",
      id: "start-error",
      background: "rgba(26, 38, 26, 0.92)"
    });
    if (!app) {
      showStartError(error);
    }
  });
});
