// ---------------------------------------------------------
// headless_tests/core/compute_image_pyramid/filter_radius_contracts.js  2026/07/23
//   Shared Pyramid low-pass filter-radius contracts
// ---------------------------------------------------------
import assert from "node:assert/strict";
import ComputeImagePyramid, {
  COMPUTE_IMAGE_PYRAMID_DEFAULTS,
  COMPUTE_IMAGE_PYRAMID_DOWNSAMPLE_WGSL
} from "../../../webg/ComputeImagePyramid.js";

function createProbe() {
  const calls = [];
  const probe = Object.create(ComputeImagePyramid.prototype);
  probe.label = "pyramid-probe";
  probe.width = 64;
  probe.height = 32;
  probe.format = "rgba16float";
  probe.levels = [2, 4, 8];
  probe.destroyed = false;
  probe.targets = new Map(
    probe.levels.map((level) => [
      level,
      {
        label: `level-${level}`,
        getSampler: () => ({ label: `sampler-${level}` })
      }
    ])
  );
  probe.downsamplePass = {
    setUniforms(values) {
      calls.push(["uniforms", ...values]);
    },
    encode(commandEncoder, resources, options) {
      calls.push([
        "downsample",
        resources.source.label,
        resources.output.label,
        options.timestampWrites
      ]);
    }
  };
  return { probe, calls };
}

const scene = {
  label: "scene",
  getWidth: () => 64,
  getHeight: () => 32,
  getView: () => ({ label: "scene-view" }),
  getFormat: () => "rgba16float",
  getSampler: () => ({ label: "scene-sampler" })
};
const commandEncoder = { beginComputePass() {} };

assert.equal(COMPUTE_IMAGE_PYRAMID_DEFAULTS.filterRadius, 1.0);
assert.match(
  COMPUTE_IMAGE_PYRAMID_DOWNSAMPLE_WGSL,
  /offset \* texel \* params\.filterRadius/
);

// 未指定時は従来と同じ1.0を使い、全Levelへ一つの共通uniformを適用します
{
  const { probe, calls } = createProbe();
  assert.equal(probe.encode(commandEncoder, scene).label, "level-8");
  assert.deepEqual(calls[0], ["uniforms", 1.0, 0.0, 0.0, 0.0]);
  assert.deepEqual(calls.slice(1).map((call) => call.slice(0, 3)), [
    ["downsample", "scene", "level-2"],
    ["downsample", "level-2", "level-4"],
    ["downsample", "level-4", "level-8"]
  ]);
}

// 指定値はLevel数やtarget寸法を変えず、sample間隔だけへ渡します
{
  const { probe, calls } = createProbe();
  probe.encode(commandEncoder, scene, { filterRadius: 2.25 });
  assert.deepEqual(calls[0], ["uniforms", 2.25, 0.0, 0.0, 0.0]);
}

// 範囲外の値を自動補正せず、呼び出し時点で明示的に拒否します
{
  const { probe } = createProbe();
  assert.throws(
    () => probe.encode(commandEncoder, scene, { filterRadius: 0.1 }),
    /filterRadius must be >= 0.25/
  );
  assert.throws(
    () => probe.encode(commandEncoder, scene, { filterRadius: 3.1 }),
    /filterRadius must be <= 3/
  );
}

console.log("PASS compute_image_pyramid_filter_radius_contracts");
