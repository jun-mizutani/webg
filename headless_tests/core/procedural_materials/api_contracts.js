// ---------------------------------------------------------
// api_contracts.js  2026/08/11
//   ProceduralMaterials scale API contracts
// ---------------------------------------------------------
import assert from "node:assert/strict";
import Primitive from "../../../webg/Primitive.js";
import { ProceduralMaterial, ProceduralMaterials } from "../../../webg/ProceduralMaterials.js";
import Shape from "../../../webg/Shape.js";
import { createMockGpu } from "../../shared/mock_gpu.js";

const definition = Object.freeze({
  id: "ceramic.white.square",
  appearance: Object.freeze({
    roughness: 0.16,
    specular: 0.76,
    metallic: 0.0,
    normalStrength: 0.82
  })
});
const result = {
  tileSizeMeters: [0.82, 0.41],
  colorTexture: {},
  heightTexture: {},
  normalTexture: {}
};
const owner = { destroyMaterial: () => true };

// textureを2倍の大きさにする指定が、UとVの反復回数をそれぞれ1/2にすることを確認する
const scaledMaterial = new ProceduralMaterial(owner, definition, result, 2.0);
const scaledShape = new Shape(createMockGpu().gpu);
scaledShape.applyPrimitiveAsset(Primitive.mapCuboid(2, 2, 2));
const originalUv = [...scaledShape.texCoordsArray];
scaledMaterial.applyTo(scaledShape);
for (let index = 0; index < originalUv.length; index += 2) {
  assert.ok(
    Math.abs(scaledShape.texCoordsArray[index] - originalUv[index] / (0.82 * 2.0))
      < Number.EPSILON
  );
  assert.ok(
    Math.abs(scaledShape.texCoordsArray[index + 1] - originalUv[index + 1] / (0.41 * 2.0))
      < Number.EPSILON
  );
}
assert.throws(
  () => scaledMaterial.applyTo(scaledShape),
  /scale was already applied/
);

// scale付き材質をGPU buffer確定後へ適用してCPU／GPUのUVを不一致にできないことを確認する
const completedShape = new Shape(createMockGpu().gpu);
completedShape.applyPrimitiveAsset(Primitive.mapCuboid(2, 2, 2));
completedShape.vertexBuffer = {};
assert.throws(
  () => scaledMaterial.applyTo(completedShape),
  /must be applied before Shape\.endShape\(\)/
);

// scale未指定の既存利用ではUVを書き換えず、endShape後のapplyToも維持する
const unscaledMaterial = new ProceduralMaterial(owner, definition, result);
const unscaledShape = new Shape(createMockGpu().gpu);
unscaledShape.applyPrimitiveAsset(Primitive.mapCuboid(2, 2, 2));
const unscaledUv = [...unscaledShape.texCoordsArray];
unscaledShape.vertexBuffer = {};
unscaledMaterial.applyTo(unscaledShape);
assert.deepEqual(unscaledShape.texCoordsArray, unscaledUv);

// createPresetのscaleを検証し、内部createへ明示的に引き渡すことを確認する
const manager = Object.create(ProceduralMaterials.prototype);
manager.create = async (createdDefinition, options) => ({ createdDefinition, options });
const created = await manager.createPreset("ceramic.white.square", { scale: 1.5 });
assert.equal(created.createdDefinition.id, "ceramic.white.square");
assert.deepEqual(created.options, { scale: 1.5 });
await assert.rejects(
  manager.createPreset("ceramic.white.square", { scale: 0.0 }),
  /scale must be > 0/
);

console.log("procedural_materials_contracts: scale API contracts passed");
