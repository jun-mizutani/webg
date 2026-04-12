// -------------------------------------------------
// touch unittest
//   main.js       2026/04/10
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// -------------------------------------------------

import Screen from "../../webg/Screen.js";
import Space from "../../webg/Space.js";
import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";
import Matrix from "../../webg/Matrix.js";
import SmoothShader from "../../webg/SmoothShader.js";
import Message from "../../webg/Message.js";
import Touch from "../../webg/Touch.js";

// webgクラスの役割:
// Screen : WebGPU初期化とフレーム描画
// Space  : ノード管理と3D描画
// Shape  : デモ用立方体メッシュ生成
// SmoothShader: 基本ライティング
// Message: 画面上の操作ガイド表示
// Touch  : 汎用タッチボタンUIの生成と入力通知

const start = async () => {
  const params = new URLSearchParams(window.location.search);
  const requestedTouchButtonsRaw = Number.parseInt(params.get("touchButtons") ?? "", 10);
  // このサンプルの基本ボタン数は5個
  // URLで `?touchButtons=8` のように指定すると、追加デバッグボタンを生成する
  const baseButtonCount = 5;
  const requestedTouchButtons = Number.isInteger(requestedTouchButtonsRaw)
    ? Math.max(baseButtonCount, Math.min(24, requestedTouchButtonsRaw))
    : baseButtonCount;
  const extraButtonCount = Math.max(0, requestedTouchButtons - baseButtonCount);

  // 1) 画面とシェーダを初期化する
  const screen = new Screen(document);
  await screen.ready;
  screen.setClearColor([0.06, 0.09, 0.16, 1.0]);

  const gpu = screen.getGL();
  const shader = new SmoothShader(gpu);
  await shader.init();
  Shape.prototype.shader = shader;

  const proj = new Matrix();
  const applyViewportLayout = () => {
    screen.resize(Math.max(1, Math.floor(window.innerWidth)), Math.max(1, Math.floor(window.innerHeight)));
    const fov = screen.getRecommendedFov(53.0);
    proj.makeProjectionMatrix(0.1, 2000.0, fov, screen.getAspect());
    shader.setProjectionMatrix(proj);
  };
  applyViewportLayout();
  window.addEventListener("resize", applyViewportLayout);
  window.addEventListener("orientationchange", applyViewportLayout);
  shader.setLightPosition([90.0, 130.0, 120.0, 1.0]);

  // 2) シーンと立方体ノードを作る
  const space = new Space();
  const eye = space.addNode(null, "eye");
  eye.setPosition(0.0, 15.0, 52.0);
  // setAttitude は heading/pitch/bank 順なので、左右オフセットを避けるため
  // headingは0のまま、pitch側だけを負方向へ傾ける
  eye.setAttitude(0.0, -16.0, 0.0);

  const cubeNode = space.addNode(null, "cube");
  const cubeShape = new Shape(gpu);
  cubeShape.applyPrimitiveAsset(Primitive.cube(14.0, cubeShape.getPrimitiveOptions()));
  cubeShape.endShape();
  cubeShape.setMaterial("smooth-shader", {
    has_bone: 0,
    color: [0.36, 0.78, 1.0, 1.0],
    ambient: 0.26,
    specular: 0.88,
    power: 54.0,
    emissive: 0.0
  });
  cubeNode.addShape(cubeShape);

  // 3) 操作用状態を準備する
  // キーボード/タッチ両方の押下状態を同じSetで管理する
  const keyState = new Set();
  const has = (key) => keyState.has(key.toLowerCase());
  const press = (key) => keyState.add(key.toLowerCase());
  const release = (key) => keyState.delete(key.toLowerCase());

  // 4) Messageで操作ガイドを表示する
  const msg = new Message(gpu);
  await msg.init("../../webg/font512.png");
  msg.charOffset = 0;
  msg.shader.setScale(1.0);

  // 5) Touch.jsを使って仮想ボタンを生成する
  // サンプルでは desktop でも確認できるよう touchDeviceOnly=false にする
  const touch = new Touch(document, { touchDeviceOnly: false });
  const debugButtons = [];
  for (let i = 0; i < extraButtonCount; i++) {
    const n = i + 1;
    debugButtons.push({
      key: `debug${n}`,
      label: `D${n}`,
      kind: "action",
      ariaLabel: `debug action ${n}`
    });
  }
  const touchGroups = [
    {
      id: "rotate",
      buttons: [
        { key: "a", label: "A", kind: "hold", ariaLabel: "rotate left" },
        { key: "d", label: "D", kind: "hold", ariaLabel: "rotate right" }
      ]
    },
    {
      id: "action",
      buttons: [
        { key: "r", label: "R", kind: "action", ariaLabel: "reset pose" }
      ]
    },
    {
      id: "move",
      buttons: [
        { key: "arrowleft", label: "\u2190", kind: "hold", ariaLabel: "move left" },
        { key: "arrowright", label: "\u2192", kind: "hold", ariaLabel: "move right" }
      ]
    }
  ];
  if (debugButtons.length > 0) {
    touchGroups.push({
      id: "debug",
      buttons: debugButtons
    });
  }
  const touchRoot = touch.create({
    groups: touchGroups,
    onPress: ({ key }) => press(key),
    onRelease: ({ key }) => release(key),
    onAction: ({ key }) => {
      if (key === "r") {
        // Rはワンショットで姿勢を初期化する
        state.x = 0.0;
        state.yaw = 0.0;
        cubeNode.setPosition(0.0, 0.0, 0.0);
        cubeNode.setAttitude(0.0, 0.0, 0.0);
        return;
      }
      if (key.startsWith("debug")) {
        state.debugActionCount += 1;
      }
    }
  });

  // 6) キーボード入力（event.key.toLowerCase()方式）
  // 押下状態はTouchと同じSetへ反映する
  const onKeyDown = (ev) => {
    const key = ev.key.toLowerCase();
    press(key);
    if (key === "r") {
      state.x = 0.0;
      state.yaw = 0.0;
      cubeNode.setPosition(0.0, 0.0, 0.0);
      cubeNode.setAttitude(0.0, 0.0, 0.0);
    }
    if (key.startsWith("debug")) {
      state.debugActionCount += 1;
    }
  };
  const onKeyUp = (ev) => {
    const key = ev.key.toLowerCase();
    release(key);
  };
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("keyup", onKeyUp);

  const state = {
    x: 0.0,
    yaw: 0.0,
    speed: 24.0,
    rotSpeed: 110.0,
    debugActionCount: 0
  };

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  let lastMs = performance.now();

  // 7) フレーム更新
  const loop = () => {
    const now = performance.now();
    const dt = clamp((now - lastMs) / 1000.0, 0.0, 0.033);
    lastMs = now;

    // hold入力を毎フレーム評価して位置/回転へ反映する
    if (has("arrowleft")) state.x -= state.speed * dt;
    if (has("arrowright")) state.x += state.speed * dt;
    if (has("a")) state.yaw += state.rotSpeed * dt;
    if (has("d")) state.yaw -= state.rotSpeed * dt;

    state.x = clamp(state.x, -18.0, 18.0);
    cubeNode.setPosition(state.x, 0.0, 0.0);
    cubeNode.setAttitude(state.yaw, 0.0, 0.0);

    // HUD: キー/タッチで共通の状態を表示する
    const density = touchRoot?.dataset?.touchDensity ?? "n/a";
    const spread = touchRoot?.dataset?.touchSpread ?? "n/a";
    const layout = touchRoot?.dataset?.touchLayout ?? "n/a";
    const touchCount = touchRoot?.dataset?.touchCount ?? "0";
    const style = touchRoot ? window.getComputedStyle(touchRoot) : null;
    const btnSize = style?.getPropertyValue("--webg-touch-btn-size").trim() ?? "n/a";
    const actionSize = style?.getPropertyValue("--webg-touch-action-size").trim() ?? "n/a";
    msg.setBlock("touch-guide", [
      "unittest/touch (Touch.js)",
      "Keyboard: ArrowLeft/ArrowRight, A/D, R",
      "URL: ?touchButtons=5 | 8 | 12",
      `touchButtons requested=${requestedTouchButtons} actual=${touchCount} density=${density}`,
      `layout=${layout} spread=${spread} debugActions=${state.debugActionCount}`,
      `btnSize=${btnSize} actionSize=${actionSize}`,
      `x=${state.x.toFixed(2)} yaw=${state.yaw.toFixed(1)}`,
      `pressed: left=${has("arrowleft") ? 1 : 0} right=${has("arrowright") ? 1 : 0} a=${has("a") ? 1 : 0} d=${has("d") ? 1 : 0}`
    ], {
      x: 0,
      y: 0,
      color: [0.88, 0.96, 1.0]
    });

    screen.clear();
    space.draw(eye);
    msg.drawScreen();
    screen.present();

    requestAnimationFrame(loop);
  };

  requestAnimationFrame(loop);
};

document.addEventListener("DOMContentLoaded", () => {
  start().catch((err) => {
    console.error(err);
  });
});
