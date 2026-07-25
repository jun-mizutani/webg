// ---------------------------------------------------------
// headless_tests/core/compute_bloom_pass/api_contracts.js  2026/07/23
//   Headless contracts for Pyramid ComputeBloomPass
// ---------------------------------------------------------
import assert from "node:assert/strict";
import ComputeBloomPass, {
  COMPUTE_BLOOM_COMPOSITE_WGSL,
  COMPUTE_BLOOM_DEFAULTS,
  COMPUTE_BLOOM_EXTRACT_WGSL,
  COMPUTE_BLOOM_LEVELS,
  COMPUTE_BLOOM_STORAGE_FORMAT,
  COMPUTE_BLOOM_UPSAMPLE_WGSL
} from "../../../webg/ComputeBloomPass.js";
import {
  computePyramidDimension,
  validatePyramidLevels
} from "../../../webg/ComputeImagePyramid.js";

function createProbe() {
  const probe = Object.create(ComputeBloomPass.prototype);
  probe.label = "bloom-probe";
  probe.width = 32;
  probe.height = 24;
  probe.format = COMPUTE_BLOOM_STORAGE_FORMAT;
  probe.destroyed = false;
  probe.params = { ...COMPUTE_BLOOM_DEFAULTS };
  return probe;
}

function createTarget(label, width = 32, height = 24, calls = null) {
  return {
    label,
    width,
    height,
    getWidth() { return this.width; },
    getHeight() { return this.height; },
    getView() { return { label: `${label}-view` }; },
    getFormat() { return COMPUTE_BLOOM_STORAGE_FORMAT; },
    getSampler() { return { label: `${label}-sampler` }; },
    resize(nextWidth, nextHeight) {
      calls?.push(["resize", label, nextWidth, nextHeight]);
      this.width = nextWidth;
      this.height = nextHeight;
      return true;
    }
  };
}

// Pyramid Bloomの既定値と、旧staged APIを暗黙変換せず拒否する契約です
{
  const probe = createProbe();
  assert.deepEqual(probe.validateEncodeOptions(), COMPUTE_BLOOM_DEFAULTS);
  assert.equal(COMPUTE_BLOOM_STORAGE_FORMAT, "rgba16float");
  assert.deepEqual(COMPUTE_BLOOM_LEVELS, [2, 4, 8, 16, 32]);
  assert.equal(computePyramidDimension(5, 2, "test width"), 3);
  assert.equal(computePyramidDimension(1, 32, "test width"), 1);
  assert.deepEqual(validatePyramidLevels([2, 4, 8]), [2, 4, 8]);
  assert.throws(
    () => validatePyramidLevels([2, 8]),
    /levels\[1\] must be 4/
  );
  assert.match(COMPUTE_BLOOM_EXTRACT_WGSL, /hardExcess = max\(brightness - threshold, 0\.0\)/);
  assert.match(COMPUTE_BLOOM_UPSAMPLE_WGSL, /fn readCoarse/);
  assert.match(COMPUTE_BLOOM_COMPOSITE_WGSL, /scene\.rgb \+ bloom\.rgb \* params\.values\.x/);
  for (const name of [
    "smallScale",
    "smallThreshold",
    "smallSampleStep",
    "blurRadius",
    "blurIterations",
    "resolutionScale",
    "stageMode",
    "exposure"
  ]) {
    assert.throws(
      () => probe.validateEncodeOptions({ [name]: 1 }),
      /no longer supports staged small\/medium\/large bloom parameters/
    );
  }
  assert.throws(
    () => probe.validateEncodeOptions({ threshold: -0.1 }),
    /threshold must be >= 0/
  );
  assert.throws(
    () => probe.validateEncodeOptions({ filterRadius: 0.1 }),
    /filterRadius must be >= 0.25/
  );
}

// sceneはfull-resolution rgba16float targetであることを要求します
{
  const probe = createProbe();
  const scene = createTarget("scene");
  assert.equal(probe.validateScene(scene), scene);
  assert.throws(
    () => probe.validateScene({ ...scene, getHeight: () => 12 }),
    /does not match 32x24/
  );
  assert.throws(
    () => probe.validateScene({ ...scene, getFormat: () => "rgba8unorm" }),
    /scene format must be rgba16float/
  );
}

// extract後にPyramidを一度作り、1/32からfull resolutionへ段階的にupsampleします
{
  const probe = createProbe();
  const calls = [];
  const scene = createTarget("scene");
  probe.extractTarget = createTarget("extract");
  probe.sixteenthUpsampleTarget = createTarget("up-16");
  probe.eighthUpsampleTarget = createTarget("up-8");
  probe.quarterUpsampleTarget = createTarget("up-4");
  probe.halfUpsampleTarget = createTarget("up-2");
  probe.bloomTarget = createTarget("bloom");
  probe.outputTarget = createTarget("output");
  const levels = new Map([
    [2, createTarget("half")],
    [4, createTarget("quarter")],
    [8, createTarget("eighth")],
    [16, createTarget("sixteenth")],
    [32, createTarget("thirty-second")]
  ]);
  probe.extractPass = {
    setUniforms(values) { calls.push(["extract-uniforms", ...values]); },
    encode(commandEncoder, resources) {
      calls.push(["extract", resources.scene.label, resources.output.label]);
    }
  };
  probe.pyramid = {
    encode(commandEncoder, source) { calls.push(["pyramid", source.label]); },
    getLevel(level) { return levels.get(level); }
  };
  const makeUpsample = (label) => ({
    setUniforms(values) { calls.push(["upsample-uniforms", label, ...values]); },
    encode(commandEncoder, resources) {
      calls.push(["upsample", label, resources.fine.label, resources.coarse.label, resources.output.label]);
    }
  });
  probe.sixteenthUpsamplePass = makeUpsample("16");
  probe.eighthUpsamplePass = makeUpsample("8");
  probe.quarterUpsamplePass = makeUpsample("4");
  probe.halfUpsamplePass = makeUpsample("2");
  probe.fullUpsamplePass = makeUpsample("full");
  probe.compositePass = {
    setUniforms(values) { calls.push(["composite-uniforms", ...values]); },
    encode(commandEncoder, resources) {
      calls.push(["composite", resources.scene.label, resources.bloom.label, resources.output.label]);
    }
  };

  assert.equal(probe.encode({ beginComputePass() {} }, scene, {
    threshold: 0.5,
    softKnee: 0.25,
    strength: 2.0,
    halfWeight: 0.4,
    quarterWeight: 0.3,
    eighthWeight: 0.2,
    sixteenthWeight: 0.1,
    thirtySecondWeight: 0.15,
    filterRadius: 1.25,
    enabled: false
  }), probe.outputTarget);
  assert.deepEqual(calls, [
    ["extract-uniforms", 0.5, 0.25, 0, 0],
    ["extract", "scene", "extract"],
    ["pyramid", "extract"],
    ["upsample-uniforms", "16", 0.1, 0.15, 1.25, 0],
    ["upsample", "16", "sixteenth", "thirty-second", "up-16"],
    ["upsample-uniforms", "8", 0.2, 1, 1.25, 0],
    ["upsample", "8", "eighth", "up-16", "up-8"],
    ["upsample-uniforms", "4", 0.3, 1, 1.25, 0],
    ["upsample", "4", "quarter", "up-8", "up-4"],
    ["upsample-uniforms", "2", 0.4, 1, 1.25, 0],
    ["upsample", "2", "half", "up-4", "up-2"],
    ["upsample-uniforms", "full", 0, 1, 1.25, 0],
    ["upsample", "full", "extract", "up-2", "bloom"],
    ["composite-uniforms", 2, 0, 0, 0],
    ["composite", "scene", "bloom", "output"]
  ]);
}

// resizeはfull-resolution target、Pyramid、progressive upsample targetを更新します
{
  const probe = createProbe();
  const calls = [];
  probe.extractTarget = createTarget("extract", 32, 24, calls);
  probe.sixteenthUpsampleTarget = createTarget("up-16", 2, 2, calls);
  probe.eighthUpsampleTarget = createTarget("up-8", 4, 3, calls);
  probe.quarterUpsampleTarget = createTarget("up-4", 8, 6, calls);
  probe.halfUpsampleTarget = createTarget("up-2", 16, 12, calls);
  probe.bloomTarget = createTarget("bloom", 32, 24, calls);
  probe.outputTarget = createTarget("output", 32, 24, calls);
  probe.pyramid = {
    resize(width, height) {
      calls.push(["pyramid", width, height]);
      return true;
    }
  };
  assert.equal(probe.resize(64, 48), true);
  assert.deepEqual(calls, [
    ["resize", "extract", 64, 48],
    ["pyramid", 64, 48],
    ["resize", "up-16", 4, 3],
    ["resize", "up-8", 8, 6],
    ["resize", "up-4", 16, 12],
    ["resize", "up-2", 32, 24],
    ["resize", "bloom", 64, 48],
    ["resize", "output", 64, 48]
  ]);
}

console.log("PASS ComputeBloomPass Pyramid API contracts");
