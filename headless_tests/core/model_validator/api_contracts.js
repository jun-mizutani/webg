import assert from "node:assert/strict";
import ModelValidator from "../../../webg/ModelValidator.js";

const validator = new ModelValidator();
const minimal = {
  type: "webg-model-asset",
  version: "1.0",
  materials: [],
  meshes: [],
  skeletons: [],
  animations: [],
  nodes: [],
};
const valid = validator.validate(minimal);
assert.equal(valid.ok, true);
assert.deepEqual(valid.errors, []);

const invalid = validator.validate({
  type: "wrong",
  version: "",
  meshes: [{
    id: "mesh",
    geometry: {
      positions: [0, 0],
      indices: [0, 1, 2],
    },
  }],
  nodes: [{ id: "node", mesh: "missing" }],
});
assert.equal(invalid.ok, false);
assert.ok(invalid.errors.some((entry) => entry.path === "type"));
assert.ok(invalid.errors.some((entry) => entry.path === "version"));
assert.ok(invalid.errors.some((entry) => entry.path === "meshes[0].geometry.positions"));
assert.ok(invalid.errors.some((entry) => entry.path === "nodes[0].mesh"));
assert.throws(() => validator.assertValid({}), /Invalid ModelAsset/);

const reset = validator.validate(minimal);
assert.equal(reset.ok, true);
assert.deepEqual(reset.errors, []);

console.log("PASS model_validator_api_contracts");
