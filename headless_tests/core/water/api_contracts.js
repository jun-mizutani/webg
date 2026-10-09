import assert from "node:assert/strict";
import WaterBody from "../../../webg/WaterBody.js";
import ComputeEffectPipeline from "../../../webg/ComputeEffectPipeline.js";
import { WaterBody as PublicWaterBody } from "../../../webg/app/index.js";

assert.equal(PublicWaterBody, WaterBody);
const input = { origin: [1, 0, 2], absorption: [.09, .035, .025], waveMix: [2, 1, 1] };
const body = new WaterBody(input);
input.origin[0] = 99;
assert.equal(body.options.origin[0], 1);
assert.ok(Object.isFrozen(body.options) && Object.isFrozen(body.options.absorption));
const original = body.options;
for (const patch of [{ amplitude: 3 }, { extent: 1 }, { variation: 2 }, { absorption: [-1, 0, 0] },
  { ior: NaN }, { origin: [0, Infinity, 0] }]) {
  assert.throws(() => body.setOptions(patch));
  assert.equal(body.options, original);
}
assert.throws(() => body.setTime(-1));
body.setTime(3).setOptions({ amplitude: .2 });
const params = body.createWaveUniforms(512, 256);
assert.deepEqual(Array.from(params.slice(0, 4)), [512, 256, 20, 3]);
assert.deepEqual(Array.from(params.slice(36, 39)), [2, 1, 1]);
const node = { shapes: [] };
body.addReceiver(node, { children: false, strength: .25 });
assert.equal(body.receivers.get(node).children, false);
assert.throws(() => body.addReceiver(node, { strength: NaN }));
assert.equal(body.receivers.get(node).strength, .25);
body.removeReceiver(node);
assert.equal(body.receivers.size, 0);

// OFFではGPUなしで接続を解除でき、専用variantのmoduleすら読み込まない。
const pipeline = Object.create(ComputeEffectPipeline.prototype);
pipeline.destroyed = false;
let releases = 0;
pipeline.waterSystem = { destroy() { releases++; } };
await pipeline.setWater(body);
assert.equal(releases, 1);
assert.equal(pipeline.waterSystem, null);
assert.equal(pipeline.getWaterStats().surfaceDispatches, 0);
await assert.rejects(pipeline.setWater({}, { surfaceEnabled: true }), /WaterBody/);
await assert.rejects(pipeline.setWater(body, { quality: "ultra" }), /quality/);
await assert.rejects(pipeline.setWater(body, { surfaceEnabled: 1 }), /boolean/);
pipeline.waterPending = true;
await assert.rejects(pipeline.setWater(body), /await/);
pipeline.waterPending = false;
pipeline.destroyed = true;
await assert.rejects(pipeline.setWater(null), /destroyed/);

// 高水準rendererの接続と計測回収。通常PBRのcallbackには追加処理を入れない。
const { default: PbrRenderer } = await import("../../../webg/app/PbrRenderer.js");
const renderer = Object.create(PbrRenderer.prototype);
renderer.destroyed = false;
renderer.state = "ready";
renderer.ready = Promise.resolve(renderer);
renderer.width = 960;
renderer.height = 720;
let submitted = 0, connected = null;
renderer.pipeline = {
  waterSystem: {},
  afterGpuSubmit() { submitted++; },
  setWater(value) { connected = value; },
  getWaterStats() { return { surfaceEnabled: true }; }
};
await renderer.setWater(body, { surfaceEnabled: true });
assert.equal(connected, body);
assert.equal(renderer.getWaterStats().surfaceEnabled, true);
const callbacks = renderer.createFrameCallbacks({ space: {} });
const screen = { getWidth: () => 960, getHeight: () => 720 };
callbacks.onUpdate({ screen });
assert.equal(submitted, 1);
renderer.pipeline.waterSystem = null;
callbacks.onUpdate({ screen });
assert.equal(submitted, 1);

console.log("water API contracts passed");
