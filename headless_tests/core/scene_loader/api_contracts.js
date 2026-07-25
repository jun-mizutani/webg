import assert from "node:assert/strict";
import SceneLoader from "../../../webg/SceneLoader.js";
import BoxCollider from "../../../webg/BoxCollider.js";
import PlaneCollider from "../../../webg/PlaneCollider.js";
import SphereCollider from "../../../webg/SphereCollider.js";
import CapsuleCollider from "../../../webg/CapsuleCollider.js";

const loader = new SceneLoader({});
const matrix = loader.matrixFromTransform({
  translation: [1, 2, 3],
  rotation: [0, 0, 0, 1],
  scale: [2, 3, 4],
});
assert.deepEqual(matrix.getPosition(), [1, 2, 3]);
assert.equal(matrix.mat[0], 2);
assert.equal(matrix.mat[5], 3);
assert.equal(matrix.mat[10], 4);
assert.throws(() => loader.matrixFromTransform({}), /translation must be a finite vec3/);

const lines = loader.normalizeHudLines([
  { x: 1, y: 2, text: 3, color: [1, 1, 1, 1] },
]);
assert.deepEqual(lines[0], { x: 1, y: 2, text: "3", color: [1, 1, 1, 1] });
assert.throws(() => loader.normalizeHudLines([null]), /must be an object/);

assert.ok(loader.buildPhysicsCollider({ type: "box", size: [1, 2, 3] }) instanceof BoxCollider);
assert.ok(loader.buildPhysicsCollider({ type: "plane", normal: [0, 1, 0] }) instanceof PlaneCollider);
assert.ok(loader.buildPhysicsCollider({ type: "sphere", radius: 2 }) instanceof SphereCollider);
assert.ok(loader.buildPhysicsCollider({ type: "capsule", radius: 1, segmentLength: 3 }) instanceof CapsuleCollider);
assert.throws(() => loader.buildPhysicsCollider({ type: "mesh" }), /Unsupported physics collider type/);

console.log("PASS scene_loader_conversion_contracts");
