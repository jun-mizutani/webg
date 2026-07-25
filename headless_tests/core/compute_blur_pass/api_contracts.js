// ---------------------------------------------------------
// headless_tests/core/compute_blur_pass/headless_probe.js  2026/06/14
//   headless contracts for ComputeBlurPass
// ---------------------------------------------------------
import assert from "node:assert/strict";
import ComputeBlurPass from "../../../webg/ComputeBlurPass.js";

// GPUDeviceを作らず、parameterとsource検証に必要な状態だけを持つprobeを作る
// dispatch契約を独立して確認し、WebGPU pipeline生成の成否とは分けて調査できるようにする
function createProbe() {
  const probe = Object.create(ComputeBlurPass.prototype);
  probe.label = "blur-probe";
  probe.width = 32;
  probe.height = 24;
  probe.destroyed = false;
  return probe;
}

// radiusとiterationsは既定値を持つが、明示された小数や範囲外値は補正しない
{
  const probe = createProbe();
  assert.deepEqual(probe.validateEncodeOptions(), {
    radius: 3,
    iterations: 1
  });
  assert.deepEqual(probe.validateEncodeOptions({
    radius: 8,
    iterations: 4
  }), {
    radius: 8,
    iterations: 4
  });
  assert.throws(
    () => probe.validateEncodeOptions({ radius: 0 }),
    /radius must be >= 1/
  );
  assert.throws(
    () => probe.validateEncodeOptions({ radius: 2.5 }),
    /radius must be an integer/
  );
  assert.throws(
    () => probe.validateEncodeOptions({ iterations: 1.5 }),
    /iterations must be an integer/
  );
}

// sourceはViewと正しい寸法を持つ必要があり、内部targetとの寸法不一致を拒否する
{
  const probe = createProbe();
  const source = {
    getWidth: () => 32,
    getHeight: () => 24,
    getView: () => ({ label: "source-view" })
  };
  assert.equal(probe.validateSource(source), source);
  assert.throws(
    () => probe.validateSource({
      ...source,
      getWidth: () => 16
    }),
    /does not match output size/
  );
  assert.throws(
    () => probe.validateSource({
      ...source,
      getView: () => null
    }),
    /source view is not ready/
  );
}

// 反復ごとに水平、垂直の順でdispatchし、常に専用output targetを返す
{
  const probe = createProbe();
  const calls = [];
  const source = {
    label: "source",
    getWidth: () => 32,
    getHeight: () => 24,
    getView: () => ({ label: "source-view" })
  };
  probe.intermediateTarget = { label: "intermediate" };
  probe.outputTarget = { label: "output" };
  probe.horizontalPass = {
    setUniforms(values) {
      calls.push(["h-uniforms", ...values]);
    },
    encode(commandEncoder, resources) {
      calls.push(["h-dispatch", resources.source.label, resources.output.label]);
    }
  };
  probe.verticalPass = {
    setUniforms(values) {
      calls.push(["v-uniforms", ...values]);
    },
    encode(commandEncoder, resources) {
      calls.push(["v-dispatch", resources.source.label, resources.output.label]);
    }
  };

  assert.equal(
    probe.encode({ beginComputePass() {} }, source, { radius: 5, iterations: 2 }),
    probe.outputTarget
  );
  assert.deepEqual(calls, [
    ["h-uniforms", 1.0, 0.0, 5, 0.0],
    ["h-dispatch", "source", "intermediate"],
    ["v-uniforms", 0.0, 1.0, 5, 0.0],
    ["v-dispatch", "intermediate", "output"],
    ["h-uniforms", 1.0, 0.0, 5, 0.0],
    ["h-dispatch", "output", "intermediate"],
    ["v-uniforms", 0.0, 1.0, 5, 0.0],
    ["v-dispatch", "intermediate", "output"]
  ]);
}

console.log("PASS ComputeBlurPass headless contracts");
