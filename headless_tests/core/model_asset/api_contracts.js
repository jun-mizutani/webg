import assert from "node:assert/strict";
import ModelAsset from "../../../webg/ModelAsset.js";
import Primitive from "../../../webg/Primitive.js";

const source = Primitive.cube(2).getData();
source.nodes[0].transform.translation = [1, 2, 3];
const asset = ModelAsset.fromData(source);
assert.equal(asset.getData(), source);
assert.equal(asset.validate().ok, true);

source.animations = [{
  id: "move",
  times: [0, 0.5, 1],
  tracks: [],
}];
assert.equal(ModelAsset.isGzipSource("MODEL.JSON.GZ?v=1"), true);
assert.equal(ModelAsset.isGzipSource("model.json"), false);
assert.deepEqual(asset.getClipNames(), ["move"]);
assert.deepEqual(asset.getClipInfo("move"), {
  id: "move",
  targetSkeleton: null,
  keyCount: 3,
  trackCount: 0,
  durationMs: 1000,
});
const clip = asset.getClip("move");
clip.times[0] = 99;
assert.equal(source.animations[0].times[0], 0);

const firstPosition = source.meshes[0].geometry.positions[0];
asset.scaleUniform(2);
assert.equal(source.meshes[0].geometry.positions[0], firstPosition * 2);
assert.deepEqual(source.nodes[0].transform.translation, [2, 4, 6]);
assert.equal(JSON.parse(asset.toJSONText()).type, "webg-model-asset");
assert.throws(() => ModelAsset.fromJSON("{"), /Failed to parse ModelAsset JSON/);
assert.throws(() => asset.scaleUniform(0), /positive finite scale/);

console.log("PASS model_asset_data_contracts");
