// -------------------------------------------------
// detouch/main.js
//   main.js       2026/04/12
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// detach_attach.html 相当の挙動を current webg API で実装したサンプル
// -------------------------------------------------

import WebgApp from "../../webg/WebgApp.js";
import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";
import Texture from "../../webg/Texture.js";
import util from "../../webg/util.js";

// webgクラスの役割:
// WebgApp : Screen / Shader / Space / Camera / Input / Message をまとめて初期化する
// Shape   : 軸メッシュ、球メッシュを作り Node へ載せる
// Primitive: 球 primitive を作る
// Texture : 球の番号テクスチャを読み込み、Phong 材質へ渡す

const FONT_FILE = "../../webg/font512.png";
const TEXTURE_FILE = "../../webg/num256.png";
const CLEAR_COLOR = [0.02, 0.02, 0.03, 1.0];
const CAMERA_CONFIG = {
  target: [0.0, 0.0, 0.0],
  distance: 140.0,
  yaw: 0.0,
  pitch: 0.0,
  roll: 0.0
};
const HUD_GUIDE_COLOR = [0.70, 0.90, 1.0];
const HUD_STATUS_COLOR = [1.0, 0.92, 0.78];
const TOUCH_DEBUG_STYLE_ID = "detouch-touch-debug-style";

let app = null;
let fps = 0.0;
let animationPaused = false;
let touchUiEnabled = false;

let lBase = null;
let lLod = null;
let lTop = null;
let rBase = null;
let rLod = null;
let rTop = null;
let sphereObj = null;
let satelliteObj = null;

// detouch では X 反転した番号テクスチャを使い、
// 左右で parent を付け替えても文字向きの確認がしやすい状態を作る
const loadTextureFlipX = async (gpu, url) => {
  const response = await fetch(url);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(bitmap, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const tex = new Texture(gpu);
  await tex.initPromise;
  tex.setImage(new Uint8Array(imageData), canvas.width, canvas.height, 4);
  tex.setRepeat();
  return tex;
};

// 原点から正方向へ伸びる軸形状を直方体で作り、
// attach / detach 後の見た目変化を追いやすいガイドとして使う
const createAxis = (gpu, sx, sy, sz, color) => {
  const obj = new Shape(gpu);

  obj.addVertex(0, 0, sz);
  obj.addVertex(sx, 0, sz);
  obj.addVertex(0, sy, sz);
  obj.addVertex(sx, sy, sz);
  obj.addVertex(0, sy, 0);
  obj.addVertex(sx, sy, 0);
  obj.addVertex(0, 0, 0);
  obj.addVertex(sx, 0, 0);

  obj.addPlane([0, 1, 2]);
  obj.addPlane([2, 1, 3]);
  obj.addPlane([2, 3, 4]);
  obj.addPlane([4, 3, 5]);
  obj.addPlane([4, 5, 6]);
  obj.addPlane([6, 5, 7]);
  obj.addPlane([6, 7, 0]);
  obj.addPlane([0, 7, 1]);
  obj.addPlane([1, 7, 3]);
  obj.addPlane([3, 7, 5]);
  obj.addPlane([6, 0, 4]);
  obj.addPlane([4, 0, 2]);
  obj.endShape();

  obj.setMaterial("smooth-shader", {
    has_bone: 0,
    color,
    ambient: 0.4,
    specular: 0.25,
    power: 20.0,
    use_texture: 0
  });
  return obj;
};

// 球の親を左右先端のどちらかへ付け替え、
// world 側の見た目を保ったまま local だけが変わる状態を観察できるようにする
const exchangeParent = () => {
  if (!sphereObj) return;
  if (sphereObj.parent === lTop) {
    sphereObj.detach();
    sphereObj.attach(rTop);
  } else {
    sphereObj.detach();
    sphereObj.attach(lTop);
  }
};

// 右先端ノードとの付け外しだけを切り替え、
// attach 先を null にする場合と別親へ差し替える場合の違いを比較できるようにする
const detachAttachRight = () => {
  if (!sphereObj) return;
  if (sphereObj.parent === rTop) {
    sphereObj.detach();
  } else {
    sphereObj.attach(rTop);
  }
};

// 操作説明は guide block として bottom-left に固定し、
// detouch sample が今どの入力を受け付けるかを毎 frame 変えずに読めるようにする
const updateGuideLines = () => {
  app.setGuideLines([
    "[Space] exchange parent  [D] detach/attach right",
    "[W]/[Z] pitch  [A]/[S] yaw  [F]/[G] zoom",
    "[Q] pause animation  [X] resume animation"
  ], {
    anchor: "bottom-left",
    x: 0,
    y: -2,
    color: HUD_GUIDE_COLOR
  });
};

// attach / detach の確認に必要な world/local 情報を status block へまとめ、
// sample 利用者が現在の親と姿勢差分を上から順に追えるようにする
const updateStatusLines = () => {
  const right = rTop.getWorldPosition();
  const left = lTop.getWorldPosition();
  const worldAtt = sphereObj.getWorldAttitude();
  const localAtt = sphereObj.getLocalAttitude();
  const parentName = sphereObj.parent ? sphereObj.parent.name : "null";

  app.setStatusLines([
    `FPS: ${fps.toFixed(1)}  touch ui: ${touchUiEnabled ? "ON" : "OFF"}  anim: ${animationPaused ? "PAUSED" : "RUN"}`,
    `Right x:${right[0].toFixed(2)} y:${right[1].toFixed(2)}  Left x:${left[0].toFixed(2)} y:${left[1].toFixed(2)}`,
    `sphere parent: ${parentName}`,
    `world h:${worldAtt[0].toFixed(2)} p:${worldAtt[1].toFixed(2)} b:${worldAtt[2].toFixed(2)}`,
    `local h:${localAtt[0].toFixed(2)} p:${localAtt[1].toFixed(2)} b:${localAtt[2].toFixed(2)}`
  ], {
    anchor: "top-left",
    x: 0,
    y: 0,
    color: HUD_STATUS_COLOR
  });
};

// FPS は 1 frame ごとの瞬間値だと揺れが大きいので、
// detouch では緩く平滑化して attach / detach 操作中も読みやすくする
const updateFps = (deltaSec) => {
  if (deltaSec <= 0.0) return;
  const instant = 1.0 / deltaSec;
  fps = fps === 0.0 ? instant : (fps * 0.9 + instant * 0.1);
};

// detouch 専用の touch button は PC でも見えるようにし、
// 旧 sample の入力確認を desktop 上でもすぐ再現できるようにする
const ensureTouchDebugStyle = () => {
  if (document.getElementById(TOUCH_DEBUG_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = TOUCH_DEBUG_STYLE_ID;
  style.textContent = `
    .detouch-touch-root {
      z-index: 9999;
    }
    .detouch-touch-root .webg-touch-btn {
      border-width: 2px;
      background: rgba(24, 38, 26, 0.78);
    }
    .detouch-touch-root .webg-touch-btn.webg-touch-action {
      background: rgba(36, 92, 50, 0.82);
    }
  `;
  document.head.appendChild(style);
};

// キーと touch button の両方を同じ処理フローへ流し、
// sample の本題である attach / detach 確認が入力方式に依存しないようにする
const handleKey = (key) => {
  if (!app) return;
  if (key === "w") app.cameraRig.rotateX(3.0);
  if (key === "z") app.cameraRig.rotateX(-3.0);
  if (key === "a") app.cameraRig.rotateY(3.0);
  if (key === "s") app.cameraRig.rotateY(-3.0);
  if (key === "f") app.eye.move(0.0, 0.0, -3.0);
  if (key === "g") app.eye.move(0.0, 0.0, 3.0);
  if (key === "d") detachAttachRight();
  if (key === "space") exchangeParent();
  if (key === "q") animationPaused = true;
  if (key === "x") animationPaused = false;
};

// detouch の Node 構成は旧 sample と同じまま保ち、
// 表示系と入力系だけを WebgApp 標準経路へ寄せる
const buildScene = async () => {
  const gpu = app.getGL();
  const tex = await loadTextureFlipX(gpu, TEXTURE_FILE);

  // WebgApp の camera rig を detouch 向け位置へ寄せ、
  // 旧 sample と同じく少し上からアーム全体を見下ろす構図にする
  app.cameraRod.setPosition(0.0, 50.0, 0.0);

  lBase = app.space.addNode(null, "lBase");
  lBase.setPosition(-50.0, 0.0, 0.0);
  lLod = app.space.addNode(lBase, "lLod");
  lLod.setPosition(0.0, 50.0, 0.0);
  lTop = app.space.addNode(lLod, "lTop");
  lTop.setPosition(0.0, 30.0, 0.0);

  rBase = app.space.addNode(null, "rBase");
  rBase.setPosition(50.0, 0.0, 0.0);
  rLod = app.space.addNode(rBase, "rLod");
  rLod.setPosition(0.0, 50.0, 0.0);
  rTop = app.space.addNode(rLod, "rTop");
  rTop.setPosition(0.0, 30.0, 0.0);

  const axis1 = createAxis(gpu, 5.0, 50.0, 1.0, [0.8, 0.2, 0.2, 1.0]);
  lBase.addShape(axis1);
  rBase.addShape(axis1);

  const axis2 = createAxis(gpu, 3.0, 30.0, 1.0, [0.2, 1.0, 0.0, 1.0]);
  lLod.addShape(axis2);
  rLod.addShape(axis2);

  const axis3 = createAxis(gpu, 4.0, 4.0, 1.0, [0.5, 1.0, 1.0, 1.0]);
  lTop.addShape(axis3);
  rTop.addShape(axis3);

  sphereObj = app.space.addNode(rTop, "sphereObj");
  sphereObj.setPosition(0.0, 5.0, 0.0);
  const sphereShape = new Shape(gpu);
  sphereShape.setTexture(tex);
  sphereShape.setTextureMappingMode(0);
  sphereShape.setTextureMappingAxis(1);
  sphereShape.applyPrimitiveAsset(Primitive.sphere(6.0, 16, 10, sphereShape.getPrimitiveOptions()));
  sphereShape.endShape();
  sphereShape.setMaterial("smooth-shader", {
    has_bone: 0,
    color: [1.0, 1.0, 1.0, 1.0],
    texture: tex,
    use_texture: 1,
    ambient: 0.4,
    specular: 0.35,
    power: 24.0
  });
  sphereObj.addShape(sphereShape);

  satelliteObj = app.space.addNode(sphereObj, "satelliteObj");
  satelliteObj.setPosition(20.0, 0.0, 0.0);
  const satelliteShape = new Shape(gpu);
  satelliteShape.applyPrimitiveAsset(Primitive.sphere(4.0, 16, 10, satelliteShape.getPrimitiveOptions()));
  satelliteShape.endShape();
  satelliteShape.setMaterial("smooth-shader", {
    has_bone: 0,
    color: [1.0, 0.5, 1.0, 1.0],
    use_texture: 0,
    ambient: 0.35,
    specular: 0.25,
    power: 20.0
  });
  satelliteObj.addShape(satelliteShape);

  rBase.rotateZ(20.0);
  lBase.rotateZ(-20.0);
};

// touch button はキー入力の代替としてだけ使い、
// guide/status の役割は Message HUD に残して表示責務を混ぜない
const attachInput = () => {
  app.attachInput({
    onKeyDown: (key) => {
      handleKey(key);
    }
  });

  ensureTouchDebugStyle();
  const touchRoot = app.input.installTouchControls({
    touchDeviceOnly: false,
    className: "webg-touch-root detouch-touch-root",
    groups: [
      {
        id: "look",
        buttons: [
          { key: "w", label: "W", kind: "action", ariaLabel: "look up" },
          { key: "z", label: "Z", kind: "action", ariaLabel: "look down" },
          { key: "a", label: "A", kind: "action", ariaLabel: "look left" },
          { key: "s", label: "S", kind: "action", ariaLabel: "look right" }
        ]
      },
      {
        id: "zoom",
        buttons: [
          { key: "f", label: "F", kind: "action", ariaLabel: "zoom in" },
          { key: "g", label: "G", kind: "action", ariaLabel: "zoom out" },
          { key: " ", label: "EX", kind: "action", ariaLabel: "exchange parent" },
          { key: "d", label: "D", kind: "action", ariaLabel: "detach attach right" }
        ]
      },
      {
        id: "run",
        buttons: [
          { key: "x", label: "X", kind: "action", ariaLabel: "resume animation" },
          { key: "q", label: "Q", kind: "action", ariaLabel: "pause animation" }
        ]
      }
    ],
    onAction: ({ key }) => {
      handleKey(key);
    }
  });
  touchUiEnabled = !!touchRoot;
};

// detouch は WebgApp を入口にしつつ、
// attach / detach の見た目確認に必要な Node 構造だけを sample 側で組み立てる
const start = async () => {
  app = new WebgApp({
    document,
    messageFontTexture: FONT_FILE,
    clearColor: CLEAR_COLOR,
    viewAngle: 53.0,
    camera: CAMERA_CONFIG,
    lightPosition: [0.0, 100.0, 100.0, 1.0]
  });
  await app.init();

  await buildScene();
  attachInput();
  updateGuideLines();
  updateStatusLines();

  app.start({
    onUpdate: ({ deltaSec }) => {
      updateFps(deltaSec);
      if (!animationPaused) {
        sphereObj.rotateY(120.0 * deltaSec);
        satelliteObj.rotateY(160.0 * deltaSec);
        lLod.rotateZ(108.0 * deltaSec);
        rLod.rotateZ(-48.0 * deltaSec);
      }
      updateStatusLines();
    }
  });
};

// 起動失敗時は console と fixed-format panel の両方へ流し、
// sample 利用者が browser 上でも原因を読み取れる状態を残す
document.addEventListener("DOMContentLoaded", () => {
  start().catch((err) => {
    util.printf("detouch start error: %s\n", err?.message ?? String(err));
    console.error(err);
    app?.showErrorPanel?.(err, {
      title: "detouch sample failed",
      id: "start-error",
      background: "rgba(26, 38, 26, 0.92)"
    });
  });
});
