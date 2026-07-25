import assert from "node:assert/strict";
import Primitive from "../../../webg/Primitive.js";
import Shape from "../../../webg/Shape.js";
import { createMockGpu } from "../../shared/mock_gpu.js";

const cube = Primitive.cube(2);
const cubeData = cube.getData();
assert.equal(cubeData.type, "webg-model-asset");
assert.equal(cubeData.meshes.length, 1);
assert.equal(cubeData.nodes[0].mesh, cubeData.meshes[0].id);
assert.equal(cubeData.meshes[0].geometry.positions.length, 24 * 3);
assert.equal(cubeData.meshes[0].geometry.indices.length, 12 * 3);
assert.equal(cube.validate().ok, true);

const mapped = Primitive.mapCube(2).getData().meshes[0].geometry;
assert.equal(mapped.uvs.length, 24 * 2);
assert.ok(mapped.uvs.every((value) => value >= 0 && value <= 1));

const sphere = Primitive.sphere(2, 6, 8);
const sphereGeometry = sphere.getData().meshes[0].geometry;
assert.ok(sphereGeometry.vertexCount > 0);
assert.ok(sphereGeometry.polygonCount > 0);
assert.ok(sphereGeometry.altVertices.length > 0);
assert.equal(sphere.validate().ok, true);

// 全Primitiveのpolygon loopから作るwireframeが、面の外周edgeだけを持つことを確認する
const primitiveCases = [
  ["revolution", () => Primitive.revolution(2, 8, [0.01, 1, 1, 0, 0.01, -1], true)],
  ["sphere", () => Primitive.sphere(2, 6, 8)],
  ["donut", () => Primitive.donut(2, 0.5, 6, 8)],
  ["cone", () => Primitive.cone(2, 1, 8)],
  ["truncated_cone", () => Primitive.truncated_cone(2, 0.5, 1, 8)],
  ["double_cone", () => Primitive.double_cone(2, 1, 8)],
  ["prism", () => Primitive.prism(2, 1, 8)],
  ["arrow", () => Primitive.arrow(3, 1, 0.25, 8)],
  ["cuboid", () => Primitive.cuboid(2, 3, 4)],
  ["mapCuboid", () => Primitive.mapCuboid(2, 3, 4)],
  ["cube", () => Primitive.cube(2)],
  ["mapCube", () => Primitive.mapCube(2)],
  ["debugBone", () => Primitive.debugBone(0.2)]
];

for (const [name, createAsset] of primitiveCases) {
  const asset = createAsset();
  const geometry = asset.getData().meshes[0].geometry;
  assert.ok(geometry.polygonLoops.length > 0, `${name} requires polygonLoops`);

  const expectedEdges = new Set();
  for (const loop of geometry.polygonLoops) {
    for (let index = 0; index < loop.length; index++) {
      const a = loop[index];
      const b = loop[(index + 1) % loop.length];
      expectedEdges.add(a < b ? `${a}:${b}` : `${b}:${a}`);
    }
  }

  const shape = new Shape(createMockGpu().gpu);
  shape.applyPrimitiveAsset(asset);
  shape.endShape();
  const actualEdges = new Set();
  for (let index = 0; index < shape.wireObj.length; index += 2) {
    const a = shape.wireObj[index];
    const b = shape.wireObj[index + 1];
    actualEdges.add(a < b ? `${a}:${b}` : `${b}:${a}`);
  }
  assert.deepEqual(actualEdges, expectedEdges, `${name} wireframe must contain polygon edges only`);
  assert.equal(shape.wireIndexCount, expectedEdges.size * 2, `${name} wire index count`);
  assert.equal(geometry.indices.length % 3, 0, `${name} render indices must remain triangle-list data`);

  // material slot描画を通ってもtriangle bufferで上書きせず、Shape.draw()にwire bufferを選ばせる。
  shape.setWireframe(true);
  const calls = [];
  shape.draw = (_modelview, _normal, options) => calls.push(options);
  shape.drawOpaqueMaterials({}, {});
  assert.equal(calls.length, 1, `${name} wireframe must draw once`);
  assert.equal(Object.hasOwn(calls[0], "indexBuffer"), false, `${name} must not override wire buffer`);
  assert.equal(Object.hasOwn(calls[0], "indexCount"), false, `${name} must not override wire count`);
}

console.log("PASS primitive_asset_contracts");
