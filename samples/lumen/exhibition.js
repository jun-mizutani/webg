// exhibition.js 2026/09/25
// SceneYAMLの共通材質を使い、展示空間の繰り返し配置と彫刻を構築する
import Shape from "../../webg/Shape.js";
import Primitive from "../../webg/Primitive.js";

// Boxの寸法、配置、材質を一つのSceneYAML互換オブジェクトにまとめる
function box(id, size, position, material, physics) {
  const object = { id, shape: { type: "box", size }, transform: { position }, material };
  if (physics) object.physics = physics;
  return object;
}

// 展示台、壁のパネル、床の継ぎ目、物理トレイを決定的な数値で配置する
// 物理球は表示と同じSphere寸法を用い、12個だけをGPUで更新する
export function populateExhibition(manifest) {
  const objects = manifest.objects;
  for (let index = -5; index <= 5; index++) {
    objects.push(box(`seam-x-${index}`, [0.025, 0.012, 22], [index * 2, -0.02, 0], "shell"));
    objects.push(box(`seam-z-${index}`, [24, 0.012, 0.025], [0, -0.02, index * 2], "shell"));
  }
  for (let index = 0; index < 9; index++) {
    const x = (index - 4) * 2.6;
    objects.push(box(`wall-${index}`, [2.45, 10.5, 0.35], [x, 5.25, -7], "shell"));
    objects.push(box(`wall-light-${index}`, [0.035, 7.2, 0.04], [x - 1.1, 5.1, -6.8], index % 2 ? "amber" : "cyan"));
  }
  for (const side of [-1, 1]) {
    objects.push(box(`plinth-${side}`, [2.8, 0.8, 2.8], [side * 5, 0.4, -1], "shell"));
    objects.push(box(`plinth-trim-${side}`, [2.82, 0.04, 2.82], [side * 5, 0.75, -1], side < 0 ? "cyan" : "amber"));
    objects.push(box(`rail-${side}`, [0.045, 0.025, 16], [side * 8, 0.005, 0], side < 0 ? "cyan" : "amber"));
  }
  objects.push(box("tray", [5.6, 0.25, 2.4], [0, 0.15, 5.2], "shell", {
    bodyType: "static", material: { restitution: 0.85, friction: 0.25 } }));
  for (const side of [-1, 1]) {
    objects.push(box(`tray-edge-x-${side}`, [0.18, 0.65, 2.4], [side * 2.7, 0.5, 5.2], "gold", { bodyType: "static" }));
    objects.push(box(`tray-edge-z-${side}`, [5.4, 0.65, 0.18], [0, 0.5, 5.2 + side * 1.1], "gold", { bodyType: "static" }));
  }
  for (let index = 0; index < 12; index++) {
    objects.push({ id: `falling-orb-${index}`, shape: { type: "sphere", radius: 0.22 },
      transform: { position: [(index % 4 - 1.5) * 0.85, 5 + Math.floor(index / 4) * 0.85, 5.2 + (index % 3 - 1) * 0.45] },
      material: index % 2 ? "gold" : "silver",
      physics: { bodyType: "dynamic", mass: 1.2, material: { restitution: 0.85, friction: 0.25 } } });
  }
  return manifest;
}

// PrimitiveのgeometryをPBR Shapeへ変換し、展示用Nodeへ一度だけ登録する
function addShape(app, id, asset, position, material) {
  const shape = new Shape(app.getGPU());
  shape.applyPrimitiveAsset(asset);
  shape.endShape();
  shape.setMaterial(id, material);
  const node = app.space.addNode(null, id);
  node.setPosition(...position);
  node.addShape(shape);
  return { node, shape };
}

// トーラスの階層回転、Transmissionガラス、アルミニウム球を展示へ追加する
// ここで作ったShapeは呼出側が終了時に解放する
export function createSculpture(app) {
  const entries = [];
  const metal = { color: [0.92, 0.68, 0.32, 1], metallic: 1, roughness: 0.18, specular: 1 };
  for (let index = 0; index < 3; index++) {
    const ring = addShape(app, `orbit-${index}`, Primitive.donut(2.35 - index * 0.32, 0.11, 16, 96), [0, 4.76, -0.5], metal);
    ring.node.rotateX(55 + index * 35);
    ring.node.rotateZ(index * 60);
    entries.push(ring);
  }
  const baseRing = addShape(app, "base-ring", Primitive.donut(2.25, 0.035, 8, 96), [0, 0.63, -0.5],
    { color: [0.1, 0.8, 1, 1], metallic: 0, specular: 1, roughness: 0.3, emissive_factor: [0.05, 3, 4] });
  entries.push(baseRing);
  entries.push(addShape(app, "glass-orb", Primitive.sphere(1.15, 32, 48), [-5, 1.85, -1],
    { color: [0.55, 0.88, 0.95, 1], alpha: 0.25, alpha_mode: "BLEND", metallic: 0, roughness: 0.08,
      specular: 1, transmission: 0.95, ior: 1.45, attenuation_color: [0.5, 0.88, 0.95], attenuation_distance: 3 }));
  entries.push(addShape(app, "glass-heart", Primitive.donut(0.55, 0.025, 8, 64), [-5, 1.85, -1],
    { color: [0.1, 1, 1, 1], metallic: 0, specular: 1, emissive_factor: [0.05, 3, 3.5], roughness: 0.3 }));
  const aluminum = { color: [0.78, 0.84, 0.9, 1], metallic: 1, roughness: 0.08, specular: 1 };
  entries.push(addShape(app, "aluminum-orb", Primitive.sphere(1.15, 32, 48), [5, 1.85, -1], aluminum));
  return { entries, rings: entries.slice(0, 3).map(entry => entry.node) };
}
