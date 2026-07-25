// ---------------------------------------------------------
// headless_tests/core/shape/material_contracts.js  2026/07/21
//   Shape material slot / triangle material contracts
// ---------------------------------------------------------
import assert from "node:assert/strict";
import Shape from "../../../webg/Shape.js";
import { createMockGpu } from "../../shared/mock_gpu.js";

// 共有頂点を使う2三角形を作り、materialが頂点ではなくtriangleへ割り当てられることを確認する
const createTwoMaterialShape = () => {
  const mock = createMockGpu();
  const shape = new Shape(mock.gpu);
  shape.setAutoCalcNormals(false);
  shape.addVertexUV(-1, -1, 0, 0, 0);
  shape.addVertexUV(1, -1, 0, 1, 0);
  shape.addVertexUV(1, 1, 0, 1, 1);
  shape.addVertexUV(-1, 1, 0, 0, 1);
  for (let index = 0; index < 4; index++) {
    shape.setVertNormal(index, 0, 0, 1);
  }
  shape.setMaterial("smooth-shader", {
    color: [0.9, 0.3, 0.2, 1.0],
    alpha: 1.0
  });
  shape.setMaterialAt(1, "smooth-shader", {
    color: [0.2, 0.6, 1.0, 1.0],
    alpha: 0.45
  });
  shape.addTriangle(0, 1, 2);
  shape.addTriangle(0, 2, 3, 1);
  shape.endShape();
  return { mock, shape };
};

{
  const { shape } = createTwoMaterialShape();
  assert.equal(shape.getMaterialCount(), 2);
  assert.equal(shape.getMaterial().id, "smooth-shader");
  assert.equal(shape.getMaterialAt(1).params.alpha, 0.45);
  assert.deepEqual(shape.triangleMaterialIndices, [0, 1]);
  assert.equal(shape.triangleCenters.length, 6);
  assert.deepEqual(Array.from(shape.triangleVertexIndices), [0, 4, 5, 0, 5, 3]);
  assert.equal(shape.getMaterialDrawInfo(0).count, 3);
  assert.equal(shape.getMaterialDrawInfo(1).count, 3);
  assert.ok(shape.getMaterialDrawInfo(0).buffer);
  assert.ok(shape.getMaterialDrawInfo(1).buffer);

  // geometry resourceを共有してもmaterial slot内容はinstanceごとに独立する
  const instance = shape.createInstance();
  instance.updateMaterialAt(1, { alpha: 0.25 });
  assert.equal(instance.getMaterialAlpha(1), 0.25);
  assert.equal(shape.getMaterialAlpha(1), 0.45);
  assert.equal(instance.getResource(), shape.getResource());
}

// sort済み動的Index Bufferを渡した場合は、material既定Bufferで上書きせず指定範囲を描く
{
  const { shape } = createTwoMaterialShape();
  const calls = [];
  const dynamicIndexBuffer = { label: "sorted-translucent" };
  shape.draw = (_modelview, _normal, options) => calls.push(options);
  shape.drawMaterial({}, {}, 1, {
    indexBuffer: dynamicIndexBuffer,
    indexFormat: "uint32",
    indexCount: 6,
    firstIndex: 3,
    translucent: true
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].materialIndex, 1);
  assert.equal(calls[0].indexBuffer, dynamicIndexBuffer);
  assert.equal(calls[0].indexFormat, "uint32");
  assert.equal(calls[0].indexCount, 6);
  assert.equal(calls[0].firstIndex, 3);
  assert.equal(calls[0].translucent, true);
}

// 既存APIはslot 0だけを操作し、alpha未指定materialはopaqueとして扱う
{
  const shape = new Shape(createMockGpu().gpu);
  shape.setMaterial("legacy", { color: [1, 1, 1, 1] });
  assert.equal(shape.getMaterialCount(), 1);
  assert.equal(shape.getMaterialAlpha(0), 1.0);
  shape.updateMaterial({ roughness: 0.5 });
  assert.equal(shape.getMaterialAt(0).params.roughness, 0.5);
}

// 利用者の誤指定はslot 0や有効範囲へ補正せず、その場で例外にする
{
  const shape = new Shape(createMockGpu().gpu);
  assert.throws(
    () => shape.setMaterialAt(2, "skipped", {}),
    /must not skip slot 1/
  );
  assert.throws(
    () => shape.setMaterial("invalid-alpha", { alpha: 1.1 }),
    /must be <= 1/
  );
  shape.setMaterial("opaque", { alpha: 1.0 });
  shape.addVertexUV(0, 0, 0, 0, 0);
  shape.addVertexUV(1, 0, 0, 1, 0);
  shape.addVertexUV(0, 1, 0, 0, 1);
  shape.addTriangle(0, 1, 2, 1);
  assert.throws(
    () => shape.endShape(),
    /material index 1 is outside 0\.\.0/
  );
}

// 確定前なら既存triangleのslotを変更でき、確定後はGPU bufferとの不一致を拒否する
{
  const { shape } = createTwoMaterialShape();
  assert.throws(
    () => shape.setTriangleMaterial(0, 1),
    /must be called before endShape/
  );
}

// Wireframeはmaterial別triangle bufferへ分割せず、Shape全体のwire bufferを一度だけ使う
{
  const { shape } = createTwoMaterialShape();
  shape.setWireframe(true);
  const calls = [];
  shape.draw = (_modelview, _normal, options) => calls.push(options);

  shape.drawOpaqueMaterials({}, {});
  assert.equal(calls.length, 1);
  assert.equal(calls[0].materialIndex, 0);
  assert.equal(calls[0].translucent, false);
  assert.equal(Object.hasOwn(calls[0], "indexBuffer"), false);
  assert.equal(Object.hasOwn(calls[0], "indexCount"), false);

  const translucentQueue = [];
  shape.collectTranslucentTriangles({}, {}, translucentQueue);
  assert.deepEqual(translucentQueue, []);

  shape.setWireframe(false);
  shape.shaderParameter("wireframe", true);
  assert.equal(shape.isWireframe(), true);
}

// 順序非依存passは透明triangleを個別描画せず、透明materialのindex bufferを一度だけ使う
{
  const { shape } = createTwoMaterialShape();
  const calls = [];
  const shaderOverride = { name: "roughness-mask" };
  shape.drawMaterial = (_modelview, _normal, materialIndex, options) => {
    calls.push({ materialIndex, options });
  };

  shape.drawTranslucentMaterials({}, {}, { shaderOverride });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].materialIndex, 1);
  assert.equal(calls[0].options.translucent, true);
  assert.equal(calls[0].options.shaderOverride, shaderOverride);
  assert.equal(Object.hasOwn(calls[0].options, "triangleIndex"), false);
}

console.log("PASS Shape material slot contracts");
