import assert from "node:assert/strict";
import Shape from "../../../webg/Shape.js";
import Primitive from "../../../webg/Primitive.js";
import { createMockGpu } from "../../shared/mock_gpu.js";

const mock = createMockGpu();
const shape = new Shape(mock.gpu);
shape.setName("cube");
shape.applyPrimitiveAsset(Primitive.cube(2, shape.getPrimitiveOptions()));

assert.equal(shape.getName(), "cube");
assert.equal(shape.getVertexCount(), 24);
assert.equal(shape.primitiveCount, 12);
assert.equal(shape.getResource().refCount, 1);
assert.deepEqual(shape.getBoundingBox(), {
  minx: -1, maxx: 1,
  miny: -1, maxy: 1,
  minz: -1, maxz: 1,
});

assert.equal(shape.endShape(), 24);
assert.equal(shape.getTriangleCount(), 12);
assert.ok(shape.vertexBuffer);
assert.ok(shape.indexBuffer);
assert.ok(shape.wireIndexBuffer);
assert.equal(mock.bufferWrites.length >= 3, true);

const instance = shape.createInstance();
assert.equal(instance.getResource(), shape.getResource());
assert.equal(shape.getResource().refCount, 2);
instance.setMaterial("instance", { roughness: 0.5 });
assert.equal(instance.getMaterial().id, "instance");
assert.notEqual(instance.getMaterial().id, shape.getMaterial().id);

const resource = shape.getResource();
instance.destroy();
assert.equal(resource.refCount, 1);
shape.destroy({ destroyResource: true });
assert.equal(resource.isDestroyed, true);
assert.ok(mock.buffers.every((buffer) => buffer.destroyed));

console.log("PASS shape_resource_lifecycle_contracts");
