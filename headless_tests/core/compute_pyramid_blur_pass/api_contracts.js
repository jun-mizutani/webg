// ---------------------------------------------------------
// ComputePyramidBlurPass API and encode-order contracts  2026/07/24
// ---------------------------------------------------------
import assert from "node:assert/strict";
import ComputePyramidBlurPass, {
  COMPUTE_PYRAMID_BLUR_DEFAULTS,
  COMPUTE_PYRAMID_BLUR_LEVELS,
  COMPUTE_PYRAMID_BLUR_UPSAMPLE_WGSL
} from "../../../webg/ComputePyramidBlurPass.js";

function createProbe() {
  const calls = [];
  const probe = Object.create(ComputePyramidBlurPass.prototype);
  probe.label = "pyramid-blur-probe";
  probe.width = 64;
  probe.height = 32;
  probe.format = "rgba16float";
  probe.levels = [...COMPUTE_PYRAMID_BLUR_LEVELS];
  probe.params = { ...COMPUTE_PYRAMID_BLUR_DEFAULTS };
  probe.destroyed = false;
  const targets = new Map(
    probe.levels.map((level) => [
      level,
      {
        label: `level-${level}`,
        getSampler: () => ({ label: `sampler-${level}` })
      }
    ])
  );
  probe.pyramid = {
    encode(commandEncoder, source, options) {
      calls.push(["downsample", source.label, options.filterRadius, options.timestampWrites]);
      return targets.get(16);
    },
    getLevel(level) {
      return targets.get(level);
    }
  };
  probe.outputTarget = { label: "output" };
  probe.upsamplePass = {
    setUniforms(values) {
      calls.push(["uniforms", ...values]);
    },
    encode(commandEncoder, resources, options = {}) {
      calls.push([
        "upsample",
        resources.source.label,
        resources.output.label,
        options.timestampWrites
      ]);
    }
  };
  return { probe, calls };
}

assert.deepEqual(COMPUTE_PYRAMID_BLUR_LEVELS, [2, 4, 8, 16]);
assert.equal(COMPUTE_PYRAMID_BLUR_DEFAULTS.filterRadius, 1.0);
assert.match(COMPUTE_PYRAMID_BLUR_UPSAMPLE_WGSL, /1\.0 \/ 16\.0/);
assert.doesNotMatch(COMPUTE_PYRAMID_BLUR_UPSAMPLE_WGSL, /clamp\(/);

{
  const { probe } = createProbe();
  assert.deepEqual(probe.validateEncodeOptions(), { filterRadius: 1.0 });
  assert.deepEqual(
    probe.validateEncodeOptions({ filterRadius: 2.25 }),
    { filterRadius: 2.25 }
  );
  assert.throws(
    () => probe.validateEncodeOptions({ filterRadius: 0.1 }),
    /filterRadius must be >= 0.25/
  );
  assert.throws(
    () => probe.validateEncodeOptions({ filterRadius: 3.1 }),
    /filterRadius must be <= 3/
  );
}

{
  const { probe, calls } = createProbe();
  const timestamps = {
    querySet: { label: "query" },
    beginningOfPassWriteIndex: 0,
    endOfPassWriteIndex: 1
  };
  const result = probe.encode(
    { beginComputePass() {} },
    { label: "scene" },
    { filterRadius: 1.5, timestampWrites: timestamps }
  );
  assert.equal(result, probe.outputTarget);
  assert.deepEqual(calls.map((call) => call.slice(0, 3)), [
    ["downsample", "scene", 1.5],
    ["uniforms", 1.5, 0.0],
    ["upsample", "level-16", "level-8"],
    ["upsample", "level-8", "level-4"],
    ["upsample", "level-4", "level-2"],
    ["upsample", "level-2", "output"]
  ]);
  assert.deepEqual(calls[0][3], {
    querySet: timestamps.querySet,
    beginningOfPassWriteIndex: 0
  });
  assert.deepEqual(calls.at(-1)[3], {
    querySet: timestamps.querySet,
    endOfPassWriteIndex: 1
  });
}

console.log("PASS compute_pyramid_blur_pass_api_contracts");
