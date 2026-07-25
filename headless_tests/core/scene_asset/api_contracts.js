import assert from "node:assert/strict";
import SceneAsset from "../../../webg/SceneAsset.js";

const data = {
  type: "webg-scene",
  version: "1.0",
  primitives: [],
  models: [],
};
const asset = SceneAsset.fromData(data);
assert.equal(asset.getData(), data);
assert.equal(asset.validate().ok, true);
assert.equal(JSON.parse(asset.toJSONText()).type, "webg-scene");

const parsed = SceneAsset.fromJSON(JSON.stringify(data));
assert.deepEqual(parsed.getData(), data);
parsed.getData().version = "2.0";
assert.equal(data.version, "1.0");
assert.throws(() => SceneAsset.fromJSON("{"), /Failed to parse Scene JSON/);

const replacement = { ...data, primitives: [] };
assert.equal(asset.setData(replacement), asset);
assert.equal(asset.getData(), replacement);
assert.equal(asset.assertValid().ok, true);

console.log("PASS scene_asset_data_contracts");
