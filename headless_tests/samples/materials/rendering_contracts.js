// ---------------------------------------------------------
// headless_tests/samples/materials/headless_probe.js  2026/07/15
//   Material comparison sample geometry and render contracts
// ---------------------------------------------------------
import assert from "node:assert/strict";
import fs from "node:fs";
import Shape from "../../../webg/Shape.js";

globalThis.GPUBufferUsage = { VERTEX: 1, INDEX: 2, COPY_DST: 4 };
globalThis.document = { addEventListener() {} };

const { buildIcosphere } = await import("../../../samples/materials/main.js");
const source = fs.readFileSync(
  new URL("../../../samples/materials/main.js", import.meta.url),
  "utf8"
);

class ShapeProbe {
  constructor() {
    this.vertices = [];
    this.normals = [];
    this.triangles = [];
    this.autoCalcNormals = true;
  }

  setAutoCalcNormals(value) {
    this.autoCalcNormals = value;
  }

  addVertex(x, y, z) {
    this.vertices.push([x, y, z]);
    this.normals.push([0, 0, 0]);
    return this.vertices.length;
  }

  setVertNormal(index, x, y, z) {
    this.normals[index] = [x, y, z];
  }

  addTriangle(a, b, c) {
    this.triangles.push([a, b, c]);
  }
}

// 分割数2は共有頂点162個、三角形320面となり、全法線は球面方向を向きます
{
  const shape = new ShapeProbe();
  buildIcosphere(shape, 1.25, 2);
  assert.equal(shape.autoCalcNormals, false);
  assert.equal(shape.vertices.length, 162);
  assert.equal(shape.triangles.length, 320);
  const referenceCounts = new Uint32Array(shape.vertices.length);
  for (const [a, b, c] of shape.triangles) {
    for (const index of [a, b, c]) referenceCounts[index] += 1;
    const p0 = shape.vertices[a];
    const p1 = shape.vertices[b];
    const p2 = shape.vertices[c];
    const ab = p1.map((value, index) => value - p0[index]);
    const ac = p2.map((value, index) => value - p0[index]);
    const faceNormal = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0]
    ];
    assert.ok(faceNormal.reduce((sum, value, index) => sum + value * p0[index], 0) > 0);
  }
  for (let index = 0; index < shape.vertices.length; index += 1) {
    const position = shape.vertices[index];
    const normal = shape.normals[index];
    const positionLength = Math.hypot(...position);
    assert.ok(Math.abs(Math.hypot(...normal) - 1.0) < 1.0e-12);
    for (let component = 0; component < 3; component += 1) {
      assert.ok(Math.abs(normal[component] - position[component] / positionLength) < 1.0e-12);
    }
    assert.ok(referenceCounts[index] === 5 || referenceCounts[index] === 6);
  }
  assert.throws(() => buildIcosphere(new ShapeProbe(), 0.0, 2), /radius must be > 0/);
  assert.throws(() => buildIcosphere(new ShapeProbe(), 1.0, 7), /subdivisions must be <= 6/);
}

// 実ShapeのUV継ぎ目複製後も手動球面法線が有限かつ単位長であることを確認します
{
  const gpu = {
    device: { createBuffer: (descriptor) => ({ descriptor, destroy() {} }) },
    queue: { writeBuffer() {} }
  };
  const shape = new Shape(gpu);
  buildIcosphere(shape, 1.25, 2);
  shape.endShape();
  assert.equal(shape.vertexCount, 178);
  assert.equal(shape.indicesArray.length, 960);
  assert.equal(shape.altVertices.length / 2, 16);
  for (let vertex = 0; vertex < shape.vertexCount; vertex += 1) {
    const offset = vertex * 8 + 3;
    const normal = Array.from(shape.vObj.slice(offset, offset + 3));
    assert.ok(normal.every(Number.isFinite));
    assert.ok(Math.abs(Math.hypot(...normal) - 1.0) < 1.0e-6);
  }
}

// sampleは同じCameraFrameで二経路を描き、全材質値とlinear表示境界を明示します
for (const pattern of [
  /app\.space\.draw\(cameraFrame\)/,
  /pipeline\.renderScene\(app\.space, cameraFrame/,
  /cameraFrame,\s*shadowEnabled: false/,
  /app\.screen\.beginPresentPass\(/,
  /mode: "linear"/,
  /smoothAmbient: 0\.18/,
  /deferredAmbient: 0\.035/,
  /roughness/,
  /metallic/,
  /specular/,
  /power/,
  /emissive/
]) {
  assert.match(source, pattern);
}
assert.doesNotMatch(source, /mode: "reinhard"/);

console.log("sample_materials_rendering_contracts: geometry, palette, and render-path contracts passed");
