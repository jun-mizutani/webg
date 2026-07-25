// ---------------------------------------------------------
// headless_tests/core/space/transparency_contracts.js  2026/07/21
//   Global translucent triangle collection and sort contracts
// ---------------------------------------------------------
import assert from "node:assert/strict";
import CameraFrame from "../../../webg/CameraFrame.js";
import { CAMERA_REVERSE_Z } from "../../../webg/DepthConvention.js";
import Matrix from "../../../webg/Matrix.js";
import Space from "../../../webg/Space.js";
import { createMockGpu } from "../../shared/mock_gpu.js";

const cameraFrame = new CameraFrame({
  cameraWorldMatrix: new Matrix(),
  near: 0.1,
  far: 100,
  vfov: 60,
  aspect: 1,
  depthConvention: CAMERA_REVERSE_Z
});

// Shapeをまたいで収集したentryがview-space Zの小さい遠方から描かれることを確認する
{
  const events = [];
  const mock = createMockGpu();
  const makeShape = (name, depths, firstVertexIndex) => ({
    gpu: mock.gpu,
    isHidden: false,
    skeleton: null,
    shaderParameter() {},
    drawOpaqueMaterials() {
      events.push(`${name}:opaque`);
    },
    collectTranslucentTriangles(modelview, normal, queue, options) {
      for (let index = 0; index < depths.length; index++) {
        queue.push({
          shape: this,
          materialIndex: 1,
          triangleIndex: index,
          modelview,
          normal,
          viewDepth: depths[index],
          traversalOrder: options.traversalOrder,
          index0: firstVertexIndex + index * 3,
          index1: firstVertexIndex + index * 3 + 1,
          index2: firstVertexIndex + index * 3 + 2
        });
      }
    },
    drawMaterial(_modelview, _normal, _materialIndex, options) {
      events.push(`${name}:transparent:${options.firstIndex}:${options.indexCount}`);
      assert.equal(options.translucent, true);
      assert.equal(options.indexFormat, "uint32");
      assert.equal(Object.hasOwn(options, "triangleIndex"), false);
    }
  });

  const space = new Space();
  space.addNode(null, "near-shape").addShape(makeShape("near", [-2, -6], 10));
  space.addNode(null, "far-shape").addShape(makeShape("far", [-8, -4], 20));
  space.draw(cameraFrame);
  assert.deepEqual(events, [
    "near:opaque",
    "far:opaque",
    "far:transparent:0:3",
    "near:transparent:3:3",
    "far:transparent:6:3",
    "near:transparent:9:3"
  ]);
  assert.equal(mock.bufferWrites.length, 1);
  assert.deepEqual(Array.from(mock.bufferWrites[0][2]), [
    20, 21, 22,
    13, 14, 15,
    23, 24, 25,
    10, 11, 12
  ]);
}

// 同じShape・Material・変換がsort結果内で連続する場合は、全indexを1 Draw Callへまとめる
{
  const mock = createMockGpu();
  const calls = [];
  const shape = {
    gpu: mock.gpu,
    isHidden: false,
    skeleton: null,
    shaderParameter() {},
    drawOpaqueMaterials() {},
    collectTranslucentTriangles(modelview, normal, queue, options) {
      const depths = [-2, -8, -5];
      for (let index = 0; index < depths.length; index++) {
        queue.push({
          shape: this,
          materialIndex: 0,
          triangleIndex: index,
          modelview,
          normal,
          viewDepth: depths[index],
          traversalOrder: options.traversalOrder,
          index0: 30 + index * 3,
          index1: 31 + index * 3,
          index2: 32 + index * 3
        });
      }
    },
    drawMaterial(_modelview, _normal, materialIndex, options) {
      calls.push({ materialIndex, options });
    }
  };
  const space = new Space();
  space.addNode(null, "single-transparent-shape").addShape(shape);
  space.draw(cameraFrame, { onlyTranslucent: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].materialIndex, 0);
  assert.equal(calls[0].options.firstIndex, 0);
  assert.equal(calls[0].options.indexCount, 9);
  assert.deepEqual(Array.from(mock.bufferWrites[0][2]), [
    33, 34, 35,
    36, 37, 38,
    30, 31, 32
  ]);
  // 次frameも同じ容量ならGPUBufferを作り直さず、sort結果だけを書き換える
  space.draw(cameraFrame, { onlyTranslucent: true });
  assert.equal(calls.length, 2);
  assert.equal(mock.buffers.length, 1);
  assert.equal(mock.bufferWrites.length, 2);
  assert.equal(mock.bufferWrites[0][0], mock.bufferWrites[1][0]);
}

// custom ShapeがIndexを欠落させても0へ暗黙変換せず、動的Bufferへ書く前に拒否する
{
  const mock = createMockGpu();
  const space = new Space();
  assert.throws(
    () => space.drawSortedTranslucentBatches([{
      shape: { gpu: mock.gpu },
      materialIndex: 0,
      triangleIndex: 0,
      modelview: {},
      normal: {},
      index0: 0,
      index1: 1
    }]),
    /indices must be unsigned 32-bit integers/
  );
  assert.equal(mock.buffers.length, 0);
  assert.equal(mock.bufferWrites.length, 0);
}

// material groupが存在してもcount 0なら透明passを必要とせず、実triangleがあればtrueにする
{
  const space = new Space();
  const node = space.addNode(null, "classification");
  const shape = {
    isHidden: false,
    getMaterialCount: () => 2,
    getMaterialAlpha: (index) => index === 0 ? 1.0 : 0.4,
    getMaterialDrawInfo: (index) => ({ count: index === 0 ? 3 : 0 })
  };
  node.shapes.push(shape);
  assert.equal(space.hasTranslucentTriangles(), false);
  shape.getMaterialDrawInfo = (index) => ({ count: index === 0 ? 3 : 6 });
  assert.equal(space.hasTranslucentTriangles(), true);
  shape.isHidden = true;
  assert.equal(space.hasTranslucentTriangles(), false);
}

// 順序非依存の透明passはtriangle queueを作らず、各Shapeのmaterial一括描画を呼ぶ
{
  const events = [];
  const shaderOverride = { name: "roughness-mask" };
  const makeShape = (name) => ({
    isHidden: false,
    skeleton: null,
    shaderParameter() {},
    collectTranslucentTriangles() {
      assert.fail("order-independent pass must not collect translucent triangles");
    },
    drawMaterial() {
      assert.fail("order-independent pass must not issue triangle draws");
    },
    drawTranslucentMaterials(_modelview, _normal, options) {
      events.push(name);
      assert.equal(options.shaderOverride, shaderOverride);
    }
  });
  const space = new Space();
  space.addNode(null, "first-mask-shape").addShape(makeShape("first"));
  space.addNode(null, "second-mask-shape").addShape(makeShape("second"));
  space.draw(cameraFrame, {
    onlyTranslucent: true,
    orderIndependentTranslucent: true,
    shaderOverride
  });
  assert.deepEqual(events, ["first", "second"]);
}

// Wireframe Shapeはmaterial alphaを使う透明triangle passへ入らない
{
  const space = new Space();
  const node = space.addNode(null, "wireframe-classification");
  node.shapes.push({
    isHidden: false,
    isWireframe: () => true,
    getMaterialCount: () => 1,
    getMaterialAlpha: () => 0.4,
    getMaterialDrawInfo: () => ({ count: 6 })
  });
  assert.equal(space.hasTranslucentTriangles(), false);
}

console.log("PASS Space transparency contracts");
