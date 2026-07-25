// ---------------------------------------------------------
// headless_tests/core/billboard/headless_probe.js  2026/07/13
//   Camera-relative instance contracts for Billboard
// ---------------------------------------------------------
import assert from "node:assert/strict";
import Billboard from "../../../webg/Billboard.js";
import Matrix from "../../../webg/Matrix.js";

function createProbe() {
  const writes = [];
  const draws = [];
  const passEncoder = {
    setPipeline() {},
    setVertexBuffer() {},
    setBindGroup() {},
    draw(...args) { draws.push(args); }
  };
  const gpu = {
    passEncoder,
    queue: {
      writeBuffer(_buffer, _offset, source, sourceOffset = 0, size = source.byteLength) {
        writes.push(Array.from(new Float32Array(source, sourceOffset, size / 4)));
      }
    }
  };
  return { gpu, writes, draws };
}

// GPU resource生成を省き、draw直前のinstance変換とshader入力だけを記録します
function createBillboardProbe(maxCount = 4) {
  const probe = createProbe();
  const billboard = new Billboard(probe.gpu, maxCount);
  billboard.initialized = true;
  billboard.instanceBuffer = {};
  billboard.vertexBuffer = {};
  billboard.texture = {};
  billboard.shader = {
    pipeline: {},
    viewMatrix: null,
    projectionMatrix: null,
    right: null,
    up: null,
    setViewMatrix(value) { this.viewMatrix = value.clone(); },
    setProjectionMatrix(value) { this.projectionMatrix = value.clone(); },
    setCameraAxes(right, up) {
      this.right = [...right];
      this.up = [...up];
    },
    getBindGroup() { return {}; }
  };
  return { billboard, ...probe };
}

// 100億単位のWorld位置をJavaScript Numberで保持し、draw直前の差だけをfloat32へ書きます
{
  const base = 1.0e10;
  const cameraWorld = new Matrix();
  cameraWorld.position([base, -base, base]);
  const eye = {
    count: 0,
    worldMatrix: cameraWorld,
    setWorldMatrix() { this.count += 1; }
  };
  const projection = new Matrix().makeProjectionMatrix(0.1, 1000.0, 60.0, 1.0);
  const { billboard, writes, draws } = createBillboardProbe();

  billboard.addBillboard(
    base + 0.25,
    -base - 0.5,
    base - 20.0,
    2.0,
    3.0,
    [0.2, 0.4, 0.6, 0.8]
  );
  assert.deepEqual(billboard.worldPositionData.slice(0, 3), [
    base + 0.25,
    -base - 0.5,
    base - 20.0
  ]);
  billboard.draw(eye, projection);

  assert.equal(eye.count, 1);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].slice(0, 9), [
    0.25, -0.5, -20.0,
    2.0, 3.0,
    Math.fround(0.2), Math.fround(0.4), Math.fround(0.6), Math.fround(0.8)
  ]);
  assert.deepEqual(draws, [[4, 1, 0, 0]]);
  assert.deepEqual(billboard.shader.viewMatrix.getPosition(), [0.0, 0.0, 0.0]);
  assert.deepEqual(billboard.shader.right, [1.0, 0.0, 0.0]);
  assert.deepEqual(billboard.shader.up, [0.0, 1.0, 0.0]);
}

// setPositionもWorld値をfloat32へ早期変換せず、不正数値は追加時点で拒否します
{
  const { billboard } = createBillboardProbe();
  billboard.addBillboard(1.0, 2.0, 3.0, 1.0, 1.0);
  billboard.setPosition(0, 1.0e12 + 0.25, -2.0e12, 3.0e12);
  assert.deepEqual(billboard.worldPositionData.slice(0, 3), [
    1.0e12 + 0.25,
    -2.0e12,
    3.0e12
  ]);
  assert.throws(
    () => billboard.addBillboard(Number.NaN, 0.0, 0.0, 1.0, 1.0),
    /Billboard x must be finite/
  );
}

console.log("billboard_camera_relative_contracts: all instance coordinate contracts passed");
