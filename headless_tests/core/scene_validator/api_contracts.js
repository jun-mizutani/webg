import assert from "node:assert/strict";
import SceneValidator from "../../../webg/SceneValidator.js";

const validator = new SceneValidator();
const minimal = {
  type: "webg-scene",
  version: "1.0",
  primitives: [],
  models: [],
};
const valid = validator.validate(minimal);
assert.equal(valid.ok, true);
assert.ok(valid.warnings.some((entry) => entry.path === "scene"));

const invalid = validator.validate({
  type: "wrong",
  version: 1,
  primitives: [{ id: "shared", type: "cube", args: [] }],
  models: [{ id: "shared", source: "model.json" }],
  tileMap: {},
});
assert.equal(invalid.ok, false);
assert.ok(invalid.errors.some((entry) => entry.path === "scene.type"));
assert.ok(invalid.errors.some((entry) => entry.path === "scene.version"));
assert.ok(invalid.errors.some((entry) => entry.path === "scene.tileMap"));
assert.ok(invalid.errors.some((entry) => /duplicated across/.test(entry.message)));
assert.throws(() => validator.assertValid({ type: "wrong" }), /Invalid Scene JSON/);

const reset = validator.validate(minimal);
assert.equal(reset.ok, true);

console.log("PASS scene_validator_api_contracts");
