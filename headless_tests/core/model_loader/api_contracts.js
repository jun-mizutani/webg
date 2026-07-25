import assert from "node:assert/strict";
import ModelLoader from "../../../webg/ModelLoader.js";

const loader = new ModelLoader({ gpu: { id: "gpu" }, space: { id: "space" } });
assert.equal(loader.gpu.id, "gpu");
assert.equal(loader.space.id, "space");
assert.equal(loader.detectFormat("model.gltf?x=1"), "gltf");
assert.equal(loader.detectFormat("model.GLB"), "gltf");
assert.equal(loader.detectFormat("model.dae"), "collada");
assert.equal(loader.detectFormat("model.json"), "json");
assert.equal(loader.detectFormat("model.json.gz#part"), "json");
assert.equal(loader.detectFormat("ignored.bin", { format: "gzip-json" }), "json");
assert.throws(() => loader.detectFormat("model.bin"), /Cannot detect model format/);
assert.throws(() => loader.detectFormat("model.json", { format: "obj" }), /Unsupported model format option/);
assert.throws(() => loader.detectFormat(""), /non-empty source string/);

const stages = [];
loader.emitStage((stage) => stages.push(stage), "load");
assert.deepEqual(stages, ["load"]);

console.log("PASS model_loader_format_contracts");
