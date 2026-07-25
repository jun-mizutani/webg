import assert from "node:assert/strict";
import ModelBuilder from "../../../webg/ModelBuilder.js";

const builder = new ModelBuilder({});
const matrix = builder.matrixFromTransform({
  translation: [4, 5, 6],
  rotation: [0, 0, 0, 1],
  scale: [2, 2, 2],
});
assert.deepEqual(matrix.getPosition(), [4, 5, 6]);
assert.equal(matrix.mat[0], 2);
assert.equal(matrix.mat[5], 2);
assert.equal(matrix.mat[10], 2);
assert.throws(() => builder.matrixFromTransform([]), /must be an object/);
assert.throws(() => builder.matrixFromTransform({}), /translation must be a finite vec3/);
assert.equal(builder.getSharedShapeKey({ id: "mesh" }), "mesh|skin=0");
assert.equal(builder.getSharedShapeKey({ name: "mesh", skin: {} }), "mesh|skin=1");
assert.equal(builder.getSharedShapeKey({}), null);

const stages = [];
builder.emitStage((stage) => stages.push(stage), "geometry");
assert.deepEqual(stages, ["geometry"]);

console.log("PASS model_builder_conversion_contracts");
