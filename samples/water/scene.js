// ---------------------------------------------
// scene.js  2026/10/04
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// 同じPBR材質の球、箱、斜面へ集光を設定する。奥の赤い箱は通常PBRで描く

import Shape from "../../webg/Shape.js";
import Primitive from "../../webg/Primitive.js";
import { createFloor } from "./floor.js";

// 水底と配置物を作り、描画対象・受光対象・所有資源を呼出側へ返す
export async function createScene(app) {
  const floor = await createFloor(app);
  const objects = {};

  // 指定した形状・色・位置からPBRのShapeを作り、配置用Nodeへ取り付ける
  function solid(name, asset, position, color) {
    const shape = new Shape(app.getGPU());
    shape.applyPrimitiveAsset(asset(shape.getPrimitiveOptions()));
    shape.endShape();
    shape.setMaterial(name, { color: [...color, 1], roughness: 0.85,
      metallic: 0, specular: 0.4, ambient: 0, emissive: 0 });
    const node = app.space.addNode(null, name);
    node.setPosition(...position);
    node.addShape(shape);
      return { node, shape };
  }

  objects.sphere = solid("sphere", options => Primitive.sphere(0.85, 40, 28, options),
    [-1.6, 0.88, 0.4], [0.80, 0.85, 0.78]);
  objects.box = solid("box", options => Primitive.cuboid(1.5, 0.8, 1.5, options),
    [1.4, 0.4, 0.8], [0.72, 0.80, 0.84]);
  objects.excluded = solid("excluded", options => Primitive.cuboid(1.1, 0.9, 1.1, options),
    [2.0, 0.45, -2.3], [0.66, 0.32, 0.25]);

  // 頂点で高さを変えた斜面。座標ではなくShape登録で受光を決める
  const slope = new Shape(app.getGPU());
  for (const [x, y, z] of [[-1, 0.08, -0.65], [-1, 0.08, 0.65],
    [1, 0.95, 0.65], [1, 0.95, -0.65]]) slope.addVertex(x, y, z);
  slope.addPlane([0, 1, 2, 3]);
  slope.endShape();
  slope.setMaterial("slope", { color: [0.76, 0.80, 0.67, 1], roughness: 0.9,
    metallic: 0, specular: 0.4, ambient: 0, emissive: 0 });
  const slopeNode = app.space.addNode(null, "slope");
  slopeNode.setPosition(-1.3, 0, -2.1);
  slopeNode.addShape(slope);
  objects.slope = { node: slopeNode, shape: slope };
  objects.alpha = solid("water-alpha-test", options => Primitive.cuboid(0.6, 0.6, 0.6, options),
    [0, 3, 0], [0.95, 0.45, 0.12]);
  objects.alpha.shape.setMaterial("water-alpha-test", { color: [0.95, 0.45, 0.12, 1],
    alpha: 0.5, roughness: 0.1, metallic: 0, specular: 0.4, ambient: 0, emissive: 0 });
  objects.alpha.shape.hide(true);

  return { ...floor, objects };
}
