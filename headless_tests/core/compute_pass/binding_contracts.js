// ---------------------------------------------------------
// headless_tests/core/compute_pass/headless_probe.js  2026/06/14
//   headless contracts for core candidate ComputePass
// ---------------------------------------------------------
import assert from "node:assert/strict";
import ComputePass from "../../../webg/ComputePass.js";

globalThis.GPUShaderStage = { COMPUTE: 4 };
globalThis.GPUBufferUsage = { UNIFORM: 1, COPY_DST: 2 };

// constructorを使わず、binding検証methodに必要なlabelだけを持つprobeを作る
// GPUDeviceなしで番号、名前、type、dispatch基準の契約を確認する
function createValidationProbe() {
  const probe = Object.create(ComputePass.prototype);
  probe.label = "binding-probe";
  return probe;
}

// 明示的bindingは入力順ではなくbinding番号順へ並び、全typeを保持する
{
  const probe = createValidationProbe();
  const bindings = probe.validateBindings([
    {
      binding: 2,
      name: "output",
      type: "storage-texture",
      dispatchSize: true
    },
    { binding: 0, name: "params", type: "uniform-buffer" },
    { binding: 1, name: "source", type: "sampled-texture" }
  ]);
  assert.deepEqual(bindings.map((entry) => entry.binding), [0, 1, 2]);
  assert.deepEqual(bindings.map((entry) => entry.name), ["params", "source", "output"]);
}

// binding番号、name、type、dispatch基準の曖昧さは自動補正せず例外にする
{
  const probe = createValidationProbe();
  assert.throws(() => probe.validateBindings([]), /requires explicit bindings/);
  assert.throws(() => probe.validateBindings([
    { binding: 0, name: "a", type: "sampled-texture", dispatchSize: true },
    { binding: 0, name: "b", type: "storage-texture" }
  ]), /duplicate binding number/);
  assert.throws(() => probe.validateBindings([
    { binding: 0, name: "same", type: "sampled-texture", dispatchSize: true },
    { binding: 1, name: "same", type: "storage-texture" }
  ]), /duplicate binding name/);
  assert.throws(() => probe.validateBindings([
    { binding: 0, name: "unknown", type: "mystery", dispatchSize: true }
  ]), /unsupported type/);
  const explicitDispatchBindings = probe.validateBindings([
    { binding: 0, name: "source", type: "sampled-texture" }
  ]);
  assert.equal(explicitDispatchBindings.length, 1);
  assert.throws(() => probe.validateBindings([
    { binding: 0, name: "source", type: "sampled-texture", dispatchSize: true },
    { binding: 1, name: "output", type: "storage-texture", dispatchSize: true }
  ]), /at most one dispatchSize binding/);
}

// 各typeが期待するWebGPU layout entryへ変換されることを確認する
{
  const probe = createValidationProbe();
  assert.deepEqual(
    probe.createLayoutEntry({ binding: 1, name: "data", type: "read-only-storage-buffer" }),
    {
      binding: 1,
      visibility: GPUShaderStage.COMPUTE,
      buffer: { type: "read-only-storage" }
    }
  );
  assert.deepEqual(
    probe.createLayoutEntry({ binding: 2, name: "depth", type: "depth-texture" }),
    {
      binding: 2,
      visibility: GPUShaderStage.COMPUTE,
      texture: {
        sampleType: "depth",
        viewDimension: "2d",
        multisampled: false
      }
    }
  );
}

// dispatch時は配列位置ではなくnameでresourceを解決し、不足nameを例外にする
{
  const probe = createValidationProbe();
  probe.uniformBuffer = { label: "uniform-buffer" };
  assert.deepEqual(
    probe.resolveBindingResource(
      { binding: 0, name: "params", type: "uniform-buffer" },
      {}
    ),
    { buffer: probe.uniformBuffer }
  );
  assert.throws(
    () => probe.resolveBindingResource(
      { binding: 1, name: "scene", type: "sampled-texture" },
      {}
    ),
    /requires resource: scene/
  );
  const target = { getView: () => "scene-view" };
  assert.equal(
    probe.resolveBindingResource(
      { binding: 1, name: "scene", type: "sampled-texture" },
      { scene: target }
    ),
    "scene-view"
  );
}

// 完全なprobeでworkgroup計算、timestampWrites、厳密uniform長、destroyを確認する
{
  const calls = [];
  const uniformBuffer = {
    destroyed: false,
    destroy() {
      this.destroyed = true;
    }
  };
  const passEncoder = {
    setPipeline(value) {
      calls.push(["pipeline", value.label]);
    },
    setBindGroup(index) {
      calls.push(["bind-group", index]);
    },
    dispatchWorkgroups(x, y, z) {
      calls.push(["dispatch", x, y, z]);
    },
    end() {
      calls.push(["end"]);
    }
  };
  const device = {
    createBuffer() {
      return uniformBuffer;
    },
    createBindGroupLayout(descriptor) {
      return { descriptor };
    },
    createShaderModule(descriptor) {
      return { descriptor };
    },
    createPipelineLayout(descriptor) {
      return { descriptor };
    },
    createComputePipeline() {
      return { label: "probe-pipeline" };
    },
    createBindGroup(descriptor) {
      return { descriptor };
    }
  };
  const writes = [];
  const gpu = {
    device,
    queue: {
      writeBuffer(buffer, offset, data) {
        writes.push([buffer, offset, [...data]]);
      }
    }
  };
  const pass = new ComputePass(gpu, {
    label: "compute-pass-probe",
    code: "@compute @workgroup_size(4, 2, 1) fn main() {}",
    workgroupSize: [4, 2, 1],
    uniformFloats: 4,
    bindings: [
      { binding: 0, name: "params", type: "uniform-buffer" },
      { binding: 1, name: "output", type: "storage-texture", dispatchSize: true }
    ]
  });
  pass.setUniforms([1, 2, 3, 4]);
  assert.deepEqual(writes[0][2], [1, 2, 3, 4]);
  assert.throws(() => pass.setUniforms([1, 2, 3]), /uniforms length must be 4/);
  const encoder = {
    beginComputePass(descriptor) {
      calls.push(["begin", descriptor.label, descriptor.timestampWrites]);
      return passEncoder;
    }
  };
  const output = {
    getWidth: () => 10,
    getHeight: () => 5,
    getView: () => "output-view"
  };
  pass.encode(encoder, { output }, { timestampWrites: "timestamps" });
  assert.deepEqual(calls, [
    ["begin", "compute-pass-probe", "timestamps"],
    ["pipeline", "probe-pipeline"],
    ["bind-group", 0],
    ["dispatch", 3, 3, 1],
    ["end"]
  ]);
  assert.equal(pass.destroy(), true);
  assert.equal(uniformBuffer.destroyed, true);
  assert.equal(pass.destroy(), false);
  assert.throws(() => pass.encode(encoder, { output }), /is destroyed/);
}

// bindingにdispatch基準がないpassはencode時の明示寸法を使用します
{
  const probe = createValidationProbe();
  probe.destroyed = false;
  probe.bindings = [];
  probe.dispatchBinding = null;
  probe.workgroupSize = [8, 4, 2];
  probe.pipeline = {};
  probe.bindGroupLayout = {};
  probe.device = { createBindGroup: () => ({}) };
  const calls = [];
  const encoder = {
    beginComputePass() {
      return {
        setPipeline() {},
        setBindGroup() {},
        dispatchWorkgroups(x, y, z) {
          calls.push([x, y, z]);
        },
        end() {}
      };
    }
  };
  probe.encode(encoder, {}, { dispatchSize: [17, 9, 3] });
  assert.deepEqual(calls, [[3, 3, 2]]);
}

console.log("PASS ComputePass headless contracts");
