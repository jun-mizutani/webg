// -------------------------------------------------
// demo_spheres sample
//   main.js       2026/04/28
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// -------------------------------------------------

import Screen from "../../webg/Screen.js";
import Space from "../../webg/Space.js";
import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";
import Matrix from "../../webg/Matrix.js";
import SmoothShader from "../../webg/SmoothShader.js";
import Texture from "../../webg/Texture.js";
import InputController from "../../webg/InputController.js";

// webgクラスの役割:
// Screen : WebGPU初期化と描画フレーム制御
// Space  : 多数ノード(40個)の階層回転を管理
// Shape  : 球/円錐などのメッシュ生成と参照
// SmoothShader: 全Shape共通の照明シェーダ
// Texture: 画像をGPUテクスチャ化して形状へ適用
// Matrix : 投影行列を作成してシェーダへ渡す

const hud = document.getElementById("hud");
const SPEED = 0.2;

const setProjection = (screen, shader, angle = 53) => {
  // 透視投影行列をシェーダへ設定
  const proj = new Matrix();
  const fov = screen.getRecommendedFov(angle);
  proj.makeProjectionMatrix(0.1, 1000.0, fov, screen.getAspect());
  shader.setProjectionMatrix(proj);
};

const color = (div, i, count) => {
  const d = 0.5 / div;
  return [d * i + 0.5, ((count % 2000) * 0.00025) + 0.5, 1.0 - d * i, 1.0];
};

const loadTextureFlipY = async (gpu, url) => {
  // canvas は上端から画素を返すため、webg の Bottom-Left UV 基準に合わせて Y 方向だけ反転する
  const response = await fetch(url);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  ctx.translate(0, canvas.height);
  ctx.scale(1, -1);
  ctx.drawImage(bitmap, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const tex = new Texture(gpu);
  await tex.initPromise;
  tex.setImage(new Uint8Array(imageData), canvas.width, canvas.height, 4);
  tex.setRepeat();
  return tex;
};

const makeShapes = (gpu, tex) => {
  // 9種類の基本形状を先に作って共有する
  const shapes = [];
  for (let i = 1; i <= 9; i++) {
    const s = new Shape(gpu);
    s.shaderParameter("texture", tex);
    if (i === 1) s.applyPrimitiveAsset(Primitive.sphere(5, 16, 16, s.getPrimitiveOptions()));
    else if (i === 2) s.applyPrimitiveAsset(Primitive.cone(8, 8, 16, s.getPrimitiveOptions()));
    else if (i === 3) s.applyPrimitiveAsset(Primitive.truncated_cone(4, 3, 6, 16, s.getPrimitiveOptions()));
    else if (i === 4) s.applyPrimitiveAsset(Primitive.double_cone(6, 6, 16, s.getPrimitiveOptions()));
    else if (i === 5) s.applyPrimitiveAsset(Primitive.prism(6, 4, 16, s.getPrimitiveOptions()));
    else if (i === 6) s.applyPrimitiveAsset(Primitive.donut(5, 4, 16, 16, s.getPrimitiveOptions()));
    else if (i === 7) {
      s.setTextureMappingMode(1);
      s.setTextureMappingAxis(1);
      s.setTextureScale(8, 8);
      s.applyPrimitiveAsset(Primitive.cube(8, s.getPrimitiveOptions()));
    } else if (i === 8) {
      s.setTextureMappingMode(1);
      s.setTextureMappingAxis(1);
      s.setTextureScale(4, 4);
      s.applyPrimitiveAsset(Primitive.cuboid(10, 7, 4, s.getPrimitiveOptions()));
    } else {
      s.setTextureScale(4, 4);
      s.applyPrimitiveAsset(Primitive.mapCube(8));
    }
    s.endShape();
    s.shaderParameter("has_bone", 0);
    s.shaderParameter("color", [1.0, 1.0, 1.0, 1.0]);
    s.shaderParameter("use_texture", 1);
    shapes.push(s);
  }
  return shapes;
};

const start = async () => {
  // キー入力状態フラグ
  let quit = false;
  let help = true;

  const screen = new Screen(document);
  await screen.ready;
  screen.setClearColor([0.0, 0.0, 0.3, 1.0]);

  const shader = new SmoothShader(screen.getGL());
  await shader.init();
  Shape.prototype.shader = shader;
  const applyViewportLayout = () => {
    screen.resize(Math.max(1, Math.floor(window.innerWidth)), Math.max(1, Math.floor(window.innerHeight)));
    setProjection(screen, shader, 53);
  };
  applyViewportLayout();
  window.addEventListener("resize", applyViewportLayout);
  window.addEventListener("orientationchange", applyViewportLayout);
  shader.setLightPosition([0, 100, 1000, 1]);

  const tex = await loadTextureFlipY(screen.getGL(), "../../webg/num256.png");

  const shapes = makeShapes(screen.getGL(), tex);
  const numNodes = 40;

  const space = new Space();
  const nodes = [];
  let totalVertices = 0;
  let totalTriangles = 0;

  for (let i = 0; i < numNodes; i++) {
    const base = space.addNode(null, `base${i}`);
    const obj = space.addNode(base, `obj${i}`);
    base.setPosition(0, (i + 1) * 1.5, 0);
    obj.setPosition(0, 0, 22.0);

    // referShapeで共通メッシュを再利用し、ノード数が多くても生成負荷を抑える
    const s = new Shape(screen.getGL());
    s.referShape(shapes[0]);
    s.shaderParameter("has_bone", 0);
    s.shaderParameter("color", color(numNodes, i + 1, 0));
    if (i % 2 === 0) {
      s.shaderParameter("use_texture", 1);
      s.shaderParameter("texture", tex);
    }
    obj.addShape(s);
    totalVertices += s.getVertexCount();
    totalTriangles += s.getTriangleCount();
    nodes.push({ base, obj, shape: s });
  }

  const changeShape = (shapeNo) => {
    totalVertices = 0;
    totalTriangles = 0;
    for (let i = 0; i < nodes.length; i++) {
      const s = nodes[i].shape;
      s.referShape(shapes[shapeNo]);
      s.shaderParameter("has_bone", 0);
      if (i % 2 === 0) {
        s.shaderParameter("use_texture", 1);
        s.shaderParameter("texture", tex);
      }
      totalVertices += s.getVertexCount();
      totalTriangles += s.getTriangleCount();
    }
  };

  const eyeBase = space.addNode(null, "eyeBase");
  const eye = space.addNode(eyeBase, "eye");
  eye.setPosition(0, 30, 100);

  const input = new InputController(document);
  // HUD や説明文の drag selection を妨げないよう、
  // pointerdown の既定抑止は canvas 上だけへ限定する
  input.setPointerPreventDefaultElement(screen.canvas);
  const handleActionKey = (key) => {
    if (key === "q") quit = true;
    else if (key === "p") screen.screenShot();
    else if (key === "w") eyeBase.rotateX(0.3 * SPEED);
    else if (key === "s") eyeBase.rotateX(-0.3 * SPEED);
    else if (key === "a") eyeBase.rotateY(0.3 * SPEED);
    else if (key === "d") eyeBase.rotateY(-0.3 * SPEED);
    else if (key === "z") eye.move(0, 0, -1 * SPEED);
    else if (key === "x") eye.move(0, 0, 1 * SPEED);
    else if (key === "h") help = !help;
    else if (key >= "1" && key <= "9") changeShape(Number(key) - 1);
  };
  input.attach({
    onKeyDown: (key, ev) => {
      if (ev.repeat) return;
      handleActionKey(key);
    }
  });
  input.installTouchControls({
    touchDeviceOnly: true,
    groups: [
      {
        id: "look",
        buttons: [
          { key: "w", label: "W", kind: "action", ariaLabel: "camera up" },
          { key: "s", label: "S", kind: "action", ariaLabel: "camera down" },
          { key: "a", label: "A", kind: "action", ariaLabel: "camera left" },
          { key: "d", label: "D", kind: "action", ariaLabel: "camera right" }
        ]
      },
      {
        id: "zoom",
        buttons: [
          { key: "z", label: "Z", kind: "action", ariaLabel: "zoom in" },
          { key: "x", label: "X", kind: "action", ariaLabel: "zoom out" },
          { key: "h", label: "H", kind: "action", ariaLabel: "toggle help" }
        ]
      },
      {
        id: "shape",
        buttons: [
          { key: "1", label: "1", kind: "action", ariaLabel: "shape 1" },
          { key: "2", label: "2", kind: "action", ariaLabel: "shape 2" },
          { key: "3", label: "3", kind: "action", ariaLabel: "shape 3" },
          { key: "4", label: "4", kind: "action", ariaLabel: "shape 4" },
          { key: "5", label: "5", kind: "action", ariaLabel: "shape 5" },
          { key: "6", label: "6", kind: "action", ariaLabel: "shape 6" },
          { key: "7", label: "7", kind: "action", ariaLabel: "shape 7" },
          { key: "8", label: "8", kind: "action", ariaLabel: "shape 8" },
          { key: "9", label: "9", kind: "action", ariaLabel: "shape 9" }
        ]
      }
    ],
    onAction: ({ key }) => handleActionKey(key)
  });

  const loop = () => {
    if (quit) return;
    const count = screen.getFrameCount();
    for (let i = 0; i < numNodes; i++) {
      nodes[i].base.rotateY(0.2 * (i + 1) * SPEED);
      const s = nodes[i].shape;
      s.shaderParameter("color", color(numNodes, i + 1, count));
      if (i % 2 === 0) nodes[i].obj.rotateX(-2.0 * SPEED);
      else nodes[i].obj.rotateX(1.0 * SPEED);
    }

    // Screen.clear -> Space.draw -> Screen.present が1フレームの基本手順
    screen.clear();       // 1フレーム描画
    space.draw(eye);
    screen.present();

    if (hud) {
      const fps = space.count() * 1000 / Math.max(space.uptime(), 1);
      hud.textContent =
        `demo_spheres\n` +
        `FPS: ${fps.toFixed(2)}\n` +
        `Vertices: ${totalVertices}\n` +
        `Triangles: ${totalTriangles}\n` +
        `${help ? "keys: q,p,w/s,a/d,z/x,1-9,h" : "h:toggle help"}`;
    }
    requestAnimationFrame(loop);
  };

  space.timerStart();
  requestAnimationFrame(loop);
};

document.addEventListener("DOMContentLoaded", start);
