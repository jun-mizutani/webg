// ---------------------------------------------
// unittest/scene_mesh/check.mjs 2026/10/04
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
// Node.js上でScene YAMLの形式、mesh展開、明示した衝突形状を検証する
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SceneDefinition } from "../../webg/app/index.js";
import { readSceneMeshes, appendSceneMesh } from "../../webg/app/SceneMesh.js";

// 同じYAMLから表示定義と物理定義を読み、3種類の衝突形状が指定どおりになることを確認する
const source = readFileSync(new URL("scene.yaml", import.meta.url), "utf8");
const definition = SceneDefinition.fromYAML(source);
definition.validate();
const manifest = definition.manifest;
const physics = await definition.loadPhysics();
assert.deepEqual(physics.bodies.map((body) => body.shape.type), ["box", "box", "sphere", "capsule"]);

// 展開先の最小インターフェースで頂点と面を記録し、GPU初期化から独立してmeshを検証する
const mesh = readSceneMeshes(manifest.meshes).get("wedge");
const vertices = [];
const faces = [];
appendSceneMesh({
  // UVを含む頂点を記録し、元の頂点順と座標の一致を確認する
  addVertexUV(...vertex) { vertices.push(vertex); },
  // 面の頂点indexを記録し、楔形の面数を確認する
  addPolygon(face) { faces.push(face); }
}, mesh);
assert.equal(vertices.length, 6);
assert.equal(faces.length, 5);
assert.deepEqual(vertices[0], [-0.5, -0.5, -0.5, 0, 0]);

// flat shadingでは面ごとに頂点を展開し、隣接面の法線を独立して扱える構成を確認する
const flatVertices = [];
const flatFaces = [];
appendSceneMesh({
  // 各面へ展開された頂点を記録する
  addVertexUV(...vertex) { flatVertices.push(vertex); },
  // 展開後の面indexを記録する
  addPolygon(face) { flatFaces.push(face); }
}, mesh, true);
assert.equal(flatVertices.length, mesh.faces.reduce((sum, face) => sum + face.length, 0));
assert.equal(new Set(flatFaces.flat()).size, flatVertices.length);

// 面から参照される頂点だけが出力されることを、追加した未参照頂点で確認する
const unused = structuredClone(mesh);
unused.vertices.push([2, 2, 2]);
let usedCount = 0;
appendSceneMesh({
  // 出力頂点数を数え、面が参照する頂点の範囲を確認する
  addVertexUV() { usedCount += 1; },
  // このケースは頂点数の検査を担当し、面の出力は呼び出し完了だけを確認する
  addPolygon() {}
}, unused);
assert.equal(usedCount, mesh.vertices.length);

// 独立した作品へ変更を加え、期待する入力エラーが検出されることを確認する
// 各ケースの定義は検証完了時に破棄し、次のケースを同じfixtureから開始する
function rejects(change, pattern) {
  const data = structuredClone(manifest);
  change(data);
  const project = SceneDefinition.fromData(data);
  try {
    assert.throws(() => project.validate(), pattern);
  } finally {
    project.destroy();
  }
}

rejects((data) => delete data.objects[1].physics.shape, /shape is required/);
rejects((data) => { data.objects[1].shape = { type: "box", size: [1, 1, 1] }; }, /either shape or mesh/);
rejects((data) => { data.objects[1].mesh = "missing"; }, /unknown mesh/);
rejects((data) => data.meshes.push(structuredClone(data.meshes[0])), /duplicated id/);
rejects((data) => { data.meshes[0].faces[0][0] = 100; }, /faces/);
rejects((data) => { data.meshes[0].vertices[0][0] = NaN; }, /vertices/);
rejects((data) => { data.meshes[0].faces[0] = [0, 1, 1]; }, /repeated indices/);
rejects((data) => { data.meshes[0].vertices[1] = [...data.meshes[0].vertices[0]]; }, /degenerate/);
rejects((data) => { data.objects[1].physics.shape.type = "mesh"; }, /type/);
rejects((data) => { data.objects[1].transform.scale = [2, 2, 2]; }, /unit/);
rejects((data) => { data.objects[1].material.uvMapping = "real-cuboid"; }, /uvMapping/);
rejects((data) => { data.scene = { nodes: [] }; }, /inline webg-scene/);

// 表示専用作品とprimitive作品も同じ形式検証を通ることを確認する
const display = structuredClone(manifest);
delete display.physics;
display.objects.forEach((object) => delete object.physics);
const displayDefinition = SceneDefinition.fromData(display);
displayDefinition.validate();
displayDefinition.destroy();

const primitive = structuredClone(manifest);
delete primitive.meshes;
primitive.objects = primitive.objects.slice(0, 1);
const primitiveDefinition = SceneDefinition.fromData(primitive);
primitiveDefinition.validate();
primitiveDefinition.destroy();
definition.destroy();
console.log("PASS: mesh format, all 3 explicit colliders, geometry emission, invalid inputs, display-only and primitive compatibility");
