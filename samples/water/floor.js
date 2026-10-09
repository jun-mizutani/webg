// ---------------------------------------------
// floor.js  2026/10/04
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// 材質と幾何形状を固定し、照明だけを比較する小さな水底

import Shape from "../../webg/Shape.js";
import Primitive from "../../webg/Primitive.js";
import ProceduralMaterials from "../../webg/ProceduralMaterials.js";

// 実寸UVの底面と台を作り、手続き材質を適用して所有資源を返す
export async function createFloor(app) {
  const gpu = app.getGPU();
  const materials = new ProceduralMaterials(gpu);
  const material = await materials.createPreset("stone.pebbles-gravel.gray", {
    tile: { resolution: { pixelsPerMeter: 160 } }
  });

  // UVはメートルで作り、presetの実寸周期に合わせて変換する
  // 生成画像の色を材質へ使い、底面の頂点と法線は水平面に固定する
  const floor = new Shape(gpu);
  floor.setTextureMappingMode(-1);
  floor.setAutoCalcNormals(false);
  for (const [x, z] of [[-4, -4], [-4, 4], [4, 4], [4, -4]]) {
    floor.addVertexUV(x, 0, z, (x + 4) / material.tileSizeMeters[0], (z + 4) / material.tileSizeMeters[1]);
    floor.setVertNormal(floor.vertexCount - 1, 0, 1, 0);
  }
  floor.addPlane([0, 1, 2, 3]);
  floor.endShape();
  material.applyTo(floor, {
    roughness: 0.95, metallic: 0, specular: 0.4,
    normalStrength: 0, ambient: 0, emissive: 0, flatShading: false
  });
  app.space.addNode(null, "water-floor").addShape(floor);

  // 底の下に薄い台を置き、y=0の集光面と通常PBRの台を分ける
  const rim = new Shape(gpu);
  rim.applyPrimitiveAsset(Primitive.cuboid(8.6, 0.2, 8.6, rim.getPrimitiveOptions()));
  rim.endShape();
  rim.setMaterial("rim", {
    color: [0.30, 0.36, 0.37, 1], roughness: 0.95,
    metallic: 0, specular: 0.4, ambient: 0, emissive: 0
  });
  const node = app.space.addNode(null, "rim");
  node.setPosition(0, -0.11, 0);
  node.addShape(rim);
  return { materials, floor, rim };
}
