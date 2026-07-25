import assert from "node:assert/strict";
import Texture from "../../../webg/Texture.js";
import { createMockGpu } from "../../shared/mock_gpu.js";

const mock = createMockGpu();
const texture = new Texture(mock.gpu);
await texture.initPromise;
assert.equal(texture.ready, true);

texture.setupTexture();
assert.equal(texture.width, 1);
assert.equal(texture.height, 1);
assert.equal(mock.textureWrites.length, 1);
const firstTexture = texture.texture;
texture.ensureTexture(1, 1);
assert.equal(texture.texture, firstTexture);
texture.ensureTexture(2, 2);
assert.equal(firstTexture.destroyed, true);

const height = texture.makeProceduralHeightMapPixels({
  width: 8,
  height: 4,
  scale: 2,
  pattern: "noise",
  contrast: 1,
  bias: 0,
  seed: 3,
});
assert.equal(height.image.length, 8 * 4 * 4);
assert.equal(height.ncol, 4);
assert.ok(height.image.every((value) => value >= 0 && value <= 255));

const billboardA = texture.makeProceduralBillboardTexturePixels({ width: 8, height: 8, seed: 7 });
const billboardB = texture.makeProceduralBillboardTexturePixels({ width: 8, height: 8, seed: 7 });
assert.deepEqual(billboardA.image, billboardB.image);

texture.createTexture(2, 2, 4);
texture.fillTexture(10, 20, 30, 40);
assert.deepEqual([...texture.image.slice(0, 4)], [10, 20, 30, 40]);
assert.equal(texture.point(1, 1, [null, 1, 2, 3, 4]), true);
assert.deepEqual([...texture.image.slice(12, 16)], [1, 2, 3, 4]);
texture.assignTexture();
assert.equal(texture.getView(), texture.view);
assert.equal(texture.getSampler(), texture.sampler);

console.log("PASS texture_resource_contracts");
