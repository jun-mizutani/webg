// ---------------------------------------------
// unittest/primitive_normal_map/main.js  2026/04/12
//   primitive_normal_map sample
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
// Primitive  : 比較対象にする基本形状 asset を生成する
// Shape      : 各 primitive と normal map 条件を組み合わせて描画状態を保持する
// Texture    : ベース texture、画像由来 normal、手続き normal をそれぞれ生成する
// SmoothShader: normal map の有無と source 差を陰影として見せる

const SPEED = 0.42;
const ROWS = [
  { label: "sphere", build: (shape) => Primitive.sphere(8, 18, 18, shape.getPrimitiveOptions()) },
  { label: "prism", build: (shape) => Primitive.prism(12, 4, 18, shape.getPrimitiveOptions()) },
  {
    label: "mapCube",
    build: (shape) => {
      shape.setTextureScale(4, 4);
      return Primitive.mapCube(10);
    }
  }
];
const COLS = [
  { label: "off", useNormalMap: false, normalKey: "off" },
  { label: "image", useNormalMap: true, normalKey: "image" },
  { label: "procedural", useNormalMap: true, normalKey: "procedural" }
];
const PALETTE = [
  [0.94, 0.62, 0.46, 1.0],
  [0.46, 0.78, 0.94, 1.0],
  [0.82, 0.66, 0.94, 1.0]
];

const setProjection = (screen, shader, angle = 50) => {
  // 3x3 の比較が窮屈にならない固定投影へそろえる
  const proj = new Matrix();
  const fov = screen.getRecommendedFov(angle);
  proj.makeProjectionMatrix(0.1, 1200.0, fov, screen.getAspect());
  shader.setProjectionMatrix(proj);
};

const loadTextureFlipX = async (gpu, url) => {
  // 既存 sample と同じ向きで比較できるよう、`num256.png` は X 反転して取り込む
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
  const rgba = new Uint8Array(ctx.getImageData(0, 0, canvas.width, canvas.height).data);

  const colorTex = new Texture(gpu);
  await colorTex.initPromise;
  colorTex.setImage(rgba, canvas.width, canvas.height, 4);

  return {
    rgba,
    width: canvas.width,
    height: canvas.height,
    colorTex
  };
};

const createImageNormal = async (gpu, rgba, width, height) => {
  // ベース texture と同じ画素から normal map を作ると、
  // 「元画像由来の凹凸」がどれだけ陰影へ反映されたかを見比べやすい
  const tex = new Texture(gpu);
  await tex.initPromise;
  await tex.buildNormalMapFromHeightMap({
    source: rgba,
    width,
    height,
    ncol: 4,
    channel: "luma",
    strength: 2.0,
    wrap: true,
    invertY: false
  });
  tex.setRepeat();
  return tex;
};

const createProceduralNormal = async (gpu) => {
  // procedural 側は `shapes` で使っていた noise 系の条件を少し控えめにして、
  // image 由来 normal と見分けやすいが強すぎない陰影にする
  const tex = new Texture(gpu);
  await tex.initPromise;
  await tex.buildNormalMapFromProceduralHeight({
    pattern: "noise",
    width: 256,
    height: 256,
    scale: 8.0,
    seed: 11,
    octaves: 4,
    persistence: 0.52,
    lacunarity: 2.0,
    contrast: 1.15,
    normalStrength: 2.0,
    wrap: true
  });
  tex.setRepeat();
  return tex;
};

const createShape = (gpu, rowEntry, colEntry, colorTex, imageNormalTex, proceduralNormalTex, color) => {
  // 行は primitive 差、列は normal source 差だけを表す
  // それ以外の material 条件を固定し、比較対象を絞る
  const shape = new Shape(gpu);
  shape.setTextureMappingMode(0);
  shape.setTextureMappingAxis(1);
  shape.applyPrimitiveAsset(rowEntry.build(shape));
  shape.endShape();

  const normalTexture = colEntry.normalKey === "image"
    ? imageNormalTex
    : colEntry.normalKey === "procedural"
      ? proceduralNormalTex
      : null;

  shape.setMaterial("smooth-shader", {
    has_bone: 0,
    use_texture: 1,
    texture: colorTex,
    use_normal_map: colEntry.useNormalMap ? 1 : 0,
    normal_texture: normalTexture,
    normal_strength: 1.0,
    color,
    ambient: 0.24,
    specular: 0.92,
    power: 56.0,
    emissive: 0.0
  });
  return shape;
};

const start = async ({ screen, gpu, setStatus, setViewportLayout, startLoop, document }) => {
  const shader = new SmoothShader(gpu);
  await shader.init();
  Shape.prototype.shader = shader;
  setViewportLayout(() => {
    setProjection(screen, shader, 50);
  });
  shader.setLightPosition([0.0, 84.0, 150.0, 1.0]);

  const { rgba, width, height, colorTex } = await loadTextureFlipX(gpu, "../../webg/num256.png");
  const imageNormalTex = await createImageNormal(gpu, rgba, width, height);
  const proceduralNormalTex = await createProceduralNormal(gpu);

  const space = new Space();
  const eye = space.addNode(null, "eye");
  eye.setPosition(0, 2, 92);
  eye.setAttitude(0, -10, 0);

  const nodes = [];
  const rotations = [];
  for (let row = 0; row < ROWS.length; row++) {
    for (let col = 0; col < COLS.length; col++) {
      const node = space.addNode(null, `${ROWS[row].label}_${COLS[col].label}`);
      const shape = createShape(
        gpu,
        ROWS[row],
        COLS[col],
        colorTex,
        imageNormalTex,
        proceduralNormalTex,
        PALETTE[row]
      );
      node.setPosition((col - 1) * 24.0, (1 - row) * 24.0, -18.0);
      node.addShape(shape);
      nodes.push(node);
      // `mapCube` 行は面の切り替わりを追いやすくするため、他の行より少しゆっくり回す
      const baseRotation = (0.6 + (row * 3 + col) * 0.12) * SPEED;
      rotations.push(row === 2 ? baseRotation * 0.4 : baseRotation);
    }
  }

  let paused = false;
  document.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    if (key === " ") paused = !paused;
  });

  startLoop(() => {
    if (!paused) {
      // 同じ行の 3 条件を見比べやすいよう、全体は似た動きにしつつ少しだけ回転差を持たせる
      for (let i = 0; i < nodes.length; i++) {
        nodes[i].rotateX(rotations[i] * 0.72);
        nodes[i].rotateY(rotations[i]);
      }
    }

    screen.clear();
    space.draw(eye);
    screen.present();

    setStatus(
      "unittest/primitive_normal_map\n"
      + `paused: ${paused ? "yes" : "no"}\n`
      + "shader: SmoothShader (has_bone=0)\n"
      + "cols: off / image / procedural\n"
      + "rows: sphere / prism / mapCube\n"
      + "base tex: num256.png\n"
      + "image normal: luma strength=2.0\n"
      + "procedural normal: noise strength=2.0\n"
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
