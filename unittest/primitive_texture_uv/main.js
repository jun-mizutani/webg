// ---------------------------------------------
// unittest/primitive_texture_uv/main.js  2026/04/28
//   primitive_texture_uv sample
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import Space from "../../webg/Space.js";
import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";
import Matrix from "../../webg/Matrix.js";
import SmoothShader from "../../webg/SmoothShader.js";
import Texture from "../../webg/Texture.js";
import { bootUnitTestApp } from "../_shared/UnitTestApp.js";

// webgクラスの役割:
// UnitTestApp: Screen 初期化、viewport 追従、status / error 表示を共通化
// Primitive  : 回転体UV、平面UV、専用 cube UV を持つ基本形状を生成
// Shape      : Primitive asset を描画可能な shape として保持し、texture mapping 設定を持つ
// Texture    : UV 崩れを見やすい `num256.png` を読み込む
// SmoothShader: テクスチャ付き primitive の陰影を付けて見えを確認する

const SPEED = 0.42;

const setProjection = (screen, shader, angle = 50) => {
  // UV の見えを比較しやすいよう、少し引いた固定視点の投影にする
  const proj = new Matrix();
  const fov = screen.getRecommendedFov(angle);
  proj.makeProjectionMatrix(0.1, 1200.0, fov, screen.getAspect());
  shader.setProjectionMatrix(proj);
};

const loadTextureFlipY = async (gpu, url) => {
  // canvas の画素列は上端から並ぶため、webg の Bottom-Left UV 基準に合わせて Y 方向だけ反転する
  // X 方向は反転しないことで、UV 検査用の番号が左右反転せず読める向きになる
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
  return tex;
};

const createTexturedShape = (gpu, label, texture) => {
  // 各 primitive に対して、sample 側で texture mapping の違いだけを与える
  const shape = new Shape(gpu);
  shape.shaderParameter("has_bone", 0);
  shape.shaderParameter("use_texture", 1);
  shape.shaderParameter("texture", texture);

  if (label === "sphere") {
    shape.setTextureMappingMode(0);
    shape.setTextureMappingAxis(1);
    shape.applyPrimitiveAsset(Primitive.sphere(8, 20, 20, shape.getPrimitiveOptions()));
  } else if (label === "cone") {
    shape.setTextureMappingMode(0);
    shape.setTextureMappingAxis(1);
    shape.applyPrimitiveAsset(Primitive.cone(10, 6, 16, shape.getPrimitiveOptions()));
  } else if (label === "trunc") {
    shape.setTextureMappingMode(0);
    shape.setTextureMappingAxis(1);
    shape.applyPrimitiveAsset(Primitive.truncated_cone(8, 2, 5, 16, shape.getPrimitiveOptions()));
  } else if (label === "double") {
    shape.setTextureMappingMode(0);
    shape.setTextureMappingAxis(1);
    shape.applyPrimitiveAsset(Primitive.double_cone(10, 8, 16, shape.getPrimitiveOptions()));
  } else if (label === "prism") {
    shape.setTextureMappingMode(0);
    shape.setTextureMappingAxis(1);
    shape.applyPrimitiveAsset(Primitive.prism(12, 4, 16, shape.getPrimitiveOptions()));
  } else if (label === "donut") {
    shape.setTextureMappingMode(0);
    shape.setTextureMappingAxis(1);
    shape.applyPrimitiveAsset(Primitive.donut(8, 3, 16, 16, shape.getPrimitiveOptions()));
  } else if (label === "cube") {
    // cube / cuboid の scale は従来の primitive 比較 sample と同じ値を使い、比較条件をそろえる
    shape.setTextureMappingMode(1);
    shape.setTextureMappingAxis(1);
    shape.setTextureScale(8, 8);
    shape.applyPrimitiveAsset(Primitive.cube(8, shape.getPrimitiveOptions()));
  } else if (label === "cuboid") {
    shape.setTextureMappingMode(1);
    shape.setTextureMappingAxis(1);
    shape.setTextureScale(4, 4);
    shape.applyPrimitiveAsset(Primitive.cuboid(10, 7, 6, shape.getPrimitiveOptions()));
  } else if (label === "mapCube") {
    shape.setTextureScale(4, 4);
    shape.applyPrimitiveAsset(Primitive.mapCube(10));
  } else {
    throw new Error(`unknown primitive label: ${label}`);
  }

  shape.endShape();
  shape.shaderParameter("color", [1.0, 1.0, 1.0, 1.0]);
  shape.shaderParameter("ambient", 0.36);
  shape.shaderParameter("specular", 0.58);
  shape.shaderParameter("power", 28.0);
  return shape;
};

const start = async ({ screen, gpu, setStatus, setViewportLayout, startLoop, document }) => {
  // unittest では shader と projection の共通処理だけを持ち、UV 確認ロジックは sample 本体に残す
  const shader = new SmoothShader(gpu);
  await shader.init();
  Shape.prototype.shader = shader;
  setViewportLayout(() => {
    setProjection(screen, shader, 50);
  });
  shader.setLightPosition([0.0, 90.0, 140.0, 1.0]);

  const texture = await loadTextureFlipY(gpu, "../../webg/num256.png");
  const labels = ["sphere", "cone", "trunc", "double", "prism", "donut", "cube", "cuboid", "mapCube"];
  const shapes = labels.map((label) => createTexturedShape(gpu, label, texture));

  const space = new Space();
  const eye = space.addNode(null, "eye");
  eye.setPosition(0, 2, 92);
  eye.setAttitude(0, -10, 0);

  const nodes = [];
  const rotations = [];
  for (let i = 0; i < shapes.length; i++) {
    const node = space.addNode(null, `primitive_${labels[i]}`);
    const col = i % 3;
    const row = Math.floor(i / 3);
    node.setPosition((col - 1) * 22.0, (1 - row) * 22.0, -18);
    node.addShape(shapes[i]);
    nodes.push(node);
    rotations.push((0.6 + i * 0.15) * SPEED);
  }

  let paused = false;
  document.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    if (key === " ") paused = !paused;
  });

  startLoop(() => {
    if (!paused) {
      // すべての primitive を少しずつ回し、各面と seam を見やすくする
      for (let i = 0; i < nodes.length; i++) {
        nodes[i].rotateX(rotations[i] * 0.8);
        nodes[i].rotateY(rotations[i]);
      }
    }

    screen.clear();
    space.draw(eye);
    screen.present();

    setStatus(
      "unittest/primitive_texture_uv\n"
      + `paused: ${paused ? "yes" : "no"}\n`
      + "1 sphere  txMode=0 axis=1\n"
      + "2 cone    txMode=0 axis=1\n"
      + "3 trunc   txMode=0 axis=1\n"
      + "4 double  txMode=0 axis=1\n"
      + "5 prism   txMode=0 axis=1\n"
      + "6 donut   txMode=0 axis=1\n"
      + "7 cube    txMode=1 axis=1 scale=8x8\n"
      + "8 cuboid  txMode=1 axis=1 scale=4x4\n"
      + "9 mapCube dedicated uv\n"
      + "[space] pause/resume"
    );
  });
};

bootUnitTestApp({
  statusElementId: "status",
  initialStatus: "creating screen...",
  clearColor: [0.1, 0.15, 0.1, 1.0]
}, (app) => {
  return start(app);
});
