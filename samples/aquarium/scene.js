// ---------------------------------------------
// scene.js  2026/10/04
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// 水底の材質、岩、海草を作る。泳ぎの状態はmain.jsが持つ

import Shape from "../../webg/Shape.js";
import Primitive from "../../webg/Primitive.js";
import { buildIcosphere } from "../proceduralShapeBuilders.js";
import ProceduralMaterials from "../../webg/ProceduralMaterials.js";

// 水底と配置物を作り、描画対象・受光対象・所有資源を呼出側へ返す
export async function createScene(app) {
  const gpu = app.getGPU();
  const shapes = [];
  const receivers = [];
  const materials = new ProceduralMaterials(gpu);
  const gravel = await materials.createPreset("stone.pebbles-gravel.gray", {
    tile: { resolution: { pixelsPerMeter: 160 } }
  });

  // UVを実寸周期へ換算する。Normal mapは照明の凹凸を作るだけで、床は水平
  const floor = new Shape(gpu);
  floor.setTextureMappingMode(-1);
  floor.setAutoCalcNormals(false);
  for (const [x, z] of [[-9, -6], [-9, 6], [9, 6], [9, -6]]) {
    floor.addVertexUV(x, 0, z, (x + 6) / gravel.tileSizeMeters[0], (z + 4) / gravel.tileSizeMeters[1]);
    floor.setVertNormal(floor.vertexCount - 1, 0, 1, 0);
  }
  floor.addPlane([0, 1, 2, 3]);
  floor.endShape();
  gravel.applyTo(floor, { roughness: .92, metallic: 0, specular: .4,
    normalStrength: .65, ambient: 0, emissive: 0, flatShading: false });
  app.space.addNode(null, "aquarium-floor").addShape(floor);
  shapes.push(floor);
  receivers.push(floor);

  // 指定した形状・色・位置からPBRのShapeを作り、配置用Nodeへ取り付ける
  function solid(name, geometry, position, color, roughness = .85) {
    const shape = new Shape(gpu);
    const asset = geometry(shape.getPrimitiveOptions(), shape);
    if (asset) shape.applyPrimitiveAsset(asset);
    shape.endShape();
    shape.setMaterial(name, { color: [...color, 1], roughness,
      metallic: 0, specular: .35, ambient: 0, emissive: 0 });
    const node = app.space.addNode(null, name);
    node.addShape(shape);
    node.setPosition(...position);
    shapes.push(shape);
    return node;
  }

  // 外周に岩と海草を寄せ、中央にはイルカが一周する空間を残す
  const rocks = [[-6, .6, -3, .9], [-5.2, .25, -2.8, .45],
    [5.8, .55, 2.9, .85], [6.6, .3, 2.4, .5], [3.8, .35, -3.8, .6],
    [-6.3, .25, 3.2, .4], [-4.8, .25, 3.8, .45], [6.5, .3, -3.1, .5]];
  rocks.forEach(([x, y, z, r], i) => {
    // 1段細分のicosphereは80面。面ごとの法線で丸い球の滑らかさを抑える
    const node = solid(`rock-${i}`, (_options, shape) => {
      buildIcosphere(shape, { radius: r, subdivisions: 1, flatShading: true });
    }, [x * .75, y, z * .8], Array(3).fill(.075 + i * .004), .28);
    node.setAttitude(i * 37, i * 13, i * 19);
    receivers.push(node);
  });

  [[-6.6, -3.6], [5.8, -3.7], [6.8, 3.5], [-6, 3.8]].forEach(([x, z], i) => {
    for (let j = 0; j < 5; j++) {
      const height = .65 + ((i * 3 + j * 7) % 9) * .14;
      const node = solid(`sea-grass-${i}-${j}`, o => Primitive.cone(height, .09, 8, o),
        [x * .75 + (j - 2) * .16, height * .5, z * .8 + Math.sin(j * 2) * .2], [.08, .3 + j * .025, .2]);
      node.setAttitude(0, (j - 2) * 5, (2 - j) * 6);
      receivers.push(node);
    }
  });

  // 赤と黄色の標識ランプを、水槽中心に対して対角の位置へ置く
  // 発光材質は灯体自身を明るくし、point lightは周囲の物体を照らす
  const lamps = [
    { name: "red", x: -3.2, z: 2.2, color: [.8, .018, .009],
      emission: [6, .055, .025], light: [1, .025, .012] },
    { name: "yellow", x: 3.2, z: -2.2, color: [.9, .75, .012],
      emission: [4.5, 4, .025], light: [1, .85, .025] }
  ];
  const lights = [];
  const frameColor = [.055, .075, .085];
  for (const lamp of lamps) {
    const { name, x, z } = lamp;
    solid(`lamp-${name}-foot`, o => Primitive.cuboid(.75, .18, .75, o),
      [x, .09, z], frameColor);
    solid(`lamp-${name}-post`, o => Primitive.cuboid(.12, .5, .12, o),
      [x, .43, z], frameColor);
    solid(`lamp-${name}-cap`, o => Primitive.cuboid(.7, .12, .7, o),
      [x, 1.19, z], frameColor);
    for (const [dx, dz] of [[-.28, -.28], [-.28, .28], [.28, -.28], [.28, .28]]) {
      solid(`lamp-${name}-bar-${dx}-${dz}`, o => Primitive.cuboid(.035, .65, .035, o),
        [x + dx, .865, z + dz], frameColor);
    }
    const bulb = new Shape(gpu);
    buildIcosphere(bulb, { radius: .29, subdivisions: 2, flatShading: false });
    bulb.endShape();
    bulb.setMaterial(`lamp-${name}-light`, { color: [...lamp.color, 1], roughness: .25,
      metallic: 0, specular: .4, ambient: 0, emissive_factor: lamp.emission });
    const bulbNode = app.space.addNode(null, `lamp-${name}-light`);
    bulbNode.addShape(bulb);
    bulbNode.setPosition(x, .85, z);
    shapes.push(bulb);
    lights.push({ type: "point", position: [x, .85, z], color: lamp.light,
      radius: 4.5, intensity: 8 });
  }

  solid("exhibit-base", o => Primitive.cuboid(18.5, .35, 12.5, o),
    [0, -.19, 0], [.035, .1, .12]);

  return { receivers, lights,
    // シーン側が所有する配置物のShapeと手続き材質を解放する
    destroy() {
      for (const shape of shapes) shape.destroy();
      materials.destroy();
    }
  };
}
