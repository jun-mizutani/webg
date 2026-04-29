// ---------------------------------------------
// unittest/primitive_modelasset/main.js  2026/04/12
//   primitive_modelasset sample
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import Space from "../../webg/Space.js";
import Primitive from "../../webg/Primitive.js";
import ModelAsset from "../../webg/ModelAsset.js";
import ModelValidator from "../../webg/ModelValidator.js";
import ModelBuilder from "../../webg/ModelBuilder.js";
import Shape from "../../webg/Shape.js";
import Matrix from "../../webg/Matrix.js";
import SmoothShader from "../../webg/SmoothShader.js";
import { bootUnitTestApp } from "../_shared/UnitTestApp.js";

// webgクラスの役割:
// UnitTestApp   : Screen 初期化、viewport 追従、status / error 表示を共通化
// Primitive     : 各基本形状を `ModelAsset` として返す
// ModelValidator: asset 構造が build 前提を満たすかを確認する
// ModelBuilder  : asset を runtime `Shape` / `Node` へ変換する
// Space         : build 後の node tree を描画する
// SmoothShader  : material 条件を単純化し、build 経路確認に集中しやすくする

const SPEED = 0.42;
const PALETTE = [
  [0.92, 0.58, 0.45, 1.0],
  [0.95, 0.74, 0.36, 1.0],
  [0.85, 0.86, 0.34, 1.0],
  [0.47, 0.82, 0.58, 1.0],
  [0.36, 0.76, 0.84, 1.0],
  [0.40, 0.62, 0.95, 1.0],
  [0.64, 0.52, 0.94, 1.0],
  [0.85, 0.46, 0.78, 1.0],
  [0.92, 0.56, 0.66, 1.0]
];

const buildPrimitiveAssets = () => {
  // `ModelAsset.fromData()` を 1 件含め、Primitive が返す asset と
  // 中間 JSON を通した asset の両方を同じ builder 経路へ載せる
  return [
    { label: "sphere", asset: Primitive.sphere(8, 18, 18, { txAxis: 1 }) },
    { label: "cone", asset: Primitive.cone(10, 6, 18, { txAxis: 1 }) },
    { label: "trunc", asset: Primitive.truncated_cone(8, 2, 5, 18, { txAxis: 1 }) },
    { label: "double", asset: Primitive.double_cone(10, 8, 18, { txAxis: 1 }) },
    { label: "prism", asset: Primitive.prism(12, 4, 18, { txAxis: 1 }) },
    { label: "donut", asset: Primitive.donut(8, 3, 18, 18, { txAxis: 1 }) },
    {
      label: "cube",
      asset: Primitive.cube(8, {
        txMode: 1,
        txAxis: 1,
        txScaleU: 8,
        txScaleV: 8
      })
    },
    {
      label: "cuboid",
      asset: Primitive.cuboid(10, 7, 6, {
        txMode: 1,
        txAxis: 1,
        txScaleU: 4,
        txScaleV: 4
      })
    },
    {
      label: "mapCube",
      asset: ModelAsset.fromData(Primitive.mapCube(10).getData())
    }
  ];
};

const setProjection = (screen, shader, angle = 50) => {
  // 3x3 配置の build 結果を見渡しやすい固定投影へそろえる
  const proj = new Matrix();
  const fov = screen.getRecommendedFov(angle);
  proj.makeProjectionMatrix(0.1, 1200.0, fov, screen.getAspect());
  shader.setProjectionMatrix(proj);
};

const applyMaterial = (shape, color) => {
  // validator / builder の確認が主目的なので、material 条件は色付き SmoothShader に絞る
  shape.shaderParameter("has_bone", 0);
  shape.shaderParameter("color", color);
  shape.shaderParameter("ambient", 0.24);
  shape.shaderParameter("specular", 0.88);
  shape.shaderParameter("power", 42.0);
};

const start = async ({ screen, gpu, setStatus, setViewportLayout, startLoop, document }) => {
  const shader = new SmoothShader(gpu);
  await shader.init();
  Shape.prototype.shader = shader;
  setViewportLayout(() => {
    setProjection(screen, shader, 50);
  });
  shader.setLightPosition([0.0, 92.0, 150.0, 1.0]);

  const validator = new ModelValidator();
  const builder = new ModelBuilder(gpu);
  const assets = buildPrimitiveAssets();

  const buildEntries = [];
  let warningCount = 0;
  for (let i = 0; i < assets.length; i++) {
    const assetData = assets[i].asset.getData();
    const validation = validator.validate(assetData);
    if (!validation.ok) {
      const lines = validation.errors.map((item) => `${item.path}: ${item.message}`).join("\n");
      throw new Error(`primitive_modelasset validation failed for ${assets[i].label}\n${lines}`);
    }
    warningCount += validation.warnings.length;

    const built = builder.build(assetData);
    const shape = built.shapes[0];
    applyMaterial(shape, PALETTE[i]);
    buildEntries.push({
      label: assets[i].label,
      built,
      warningCount: validation.warnings.length
    });
  }

  const space = new Space();
  const eye = space.addNode(null, "eye");
  eye.setPosition(0, 2, 92);
  eye.setAttitude(0, -10, 0);

  const roots = [];
  const rotations = [];
  for (let i = 0; i < buildEntries.length; i++) {
    const instantiated = buildEntries[i].built.instantiate(space);
    const rootInfo = buildEntries[i].built.nodes.find((nodeInfo) => nodeInfo.parent === null) ?? buildEntries[i].built.nodes[0];
    const rootNode = instantiated.nodeMap.get(rootInfo.id);
    const col = i % 3;
    const row = Math.floor(i / 3);
    rootNode.setPosition((col - 1) * 22.0, (1 - row) * 22.0, -18.0);
    roots.push(rootNode);
    rotations.push((0.55 + i * 0.12) * SPEED);
  }

  let paused = false;
  document.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    if (key === " ") paused = !paused;
  });

  startLoop(() => {
    if (!paused) {
      // build 後の runtime node を回して、geometry upload と node tree 復元後の描画が維持されるかを見る
      for (let i = 0; i < roots.length; i++) {
        roots[i].rotateX(rotations[i] * 0.8);
        roots[i].rotateY(rotations[i]);
      }
    }

    screen.clear();
    space.draw(eye);
    screen.present();

    const perEntry = buildEntries.map((entry, index) => {
      return `${index + 1} ${entry.label} warn=${entry.warningCount} nodes=${entry.built.nodes.length} shapes=${entry.built.shapes.length}`;
    }).join("\n");

    setStatus(
      "unittest/primitive_modelasset\n"
      + `paused: ${paused ? "yes" : "no"}\n`
      + `assetCount: ${buildEntries.length}\n`
      + `validatorWarnings: ${warningCount}\n`
      + `${perEntry}\n`
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
