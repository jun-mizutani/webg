import assert from "node:assert/strict";
import ShapeResource from "../../../webg/ShapeResource.js";

const resource = new ShapeResource({});
resource.positionArray = [1, 2, 3];
resource.indicesArray = [0, 1, 2];
let destroyed = 0;
resource.vertexBuffer = { destroy() { destroyed += 1; } };
resource.indexBuffer = { destroy() { destroyed += 1; } };

assert.equal(resource.retainReference(), 1);
assert.equal(resource.retainReference(), 2);
assert.equal(resource.destroy(), false);
assert.equal(resource.isDestroyed, false);
assert.equal(resource.releaseReference(), 1);
assert.equal(resource.releaseReference(), 0);
assert.equal(resource.destroy(), true);
assert.equal(resource.isDestroyed, true);
assert.equal(destroyed, 2);
assert.deepEqual(resource.positionArray, []);
assert.deepEqual(resource.indicesArray, []);
assert.equal(resource.destroy(), true);
assert.equal(resource.retainReference(), 0);

const forced = new ShapeResource({});
forced.retainReference();
assert.equal(forced.destroy({ force: true }), true);
assert.equal(forced.refCount, 0);

console.log("PASS shape_resource_lifecycle_contracts");
