// ---------------------------------------------------------
// headless_tests/core/gpu_particle_emitter/headless_probe.js  2026/07/13
//   headless contracts for GpuParticleEmitter
// ---------------------------------------------------------
import assert from "node:assert/strict";
import { CAMERA_REVERSE_Z } from "../../../webg/DepthConvention.js";
import GpuParticleEmitter from "../../../webg/GpuParticleEmitter.js";

// constructorを使わず、配列検証とcommand encodeに必要な状態だけを持つprobeを作る
// GPUDeviceのpipeline生成とは分けて、Emitterの入力と発行順序を確認する
function createProbe() {
  const probe = Object.create(GpuParticleEmitter.prototype);
  probe.label = "particle-probe";
  probe.particleCount = 10;
  probe.floatsPerParticle = 12;
  probe.workgroupSize = 4;
  probe.paramFloats = 20;
  // constructorを通らないfixtureでも、Render Passが参照する現行depth契約を明示します
  probe.depthConvention = CAMERA_REVERSE_Z;
  probe.destroyed = false;
  return probe;
}

// 初期Particle配列は粒子数とstrideに完全一致し、billboard頂点はtriangle-listを構成する
{
  const probe = createProbe();
  const initial = new Float32Array(120);
  assert.equal(probe.validateInitialData(initial), initial);
  assert.throws(
    () => probe.validateInitialData(new Float32Array(119)),
    /initialData length must be 120/
  );
  assert.throws(
    () => probe.validateInitialData([]),
    /initialData must be a Float32Array/
  );
  const quad = new Float32Array(12);
  assert.equal(probe.validateQuadVertices(quad), quad);
  assert.throws(
    () => probe.validateQuadVertices(new Float32Array(8)),
    /vertex count must be divisible by 3/
  );
}

// uniform配列はWGSL layoutと同じfloat数だけを受け付け、queueへそのまま転送する
{
  const probe = createProbe();
  const writes = [];
  probe.paramData = new Float32Array(20);
  probe.paramBuffer = { label: "params" };
  probe.queue = {
    writeBuffer(buffer, offset, data) {
      writes.push([buffer.label, offset, [...data]]);
    }
  };
  const params = new Float32Array(20);
  params[3] = 10;
  probe.writeParams(params);
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0], "params");
  assert.equal(writes[0][2][3], 10);
  assert.throws(
    () => probe.writeParams(new Float32Array(19)),
    /params length must be 20/
  );
}

// Compute encodeは粒子数をworkgroup幅で切り上げ、pipelineとbind groupを1回設定する
{
  const probe = createProbe();
  const calls = [];
  probe.computePipeline = { label: "compute-pipeline" };
  probe.computeBindGroup = { label: "compute-bind-group" };
  const pass = {
    setPipeline(value) {
      calls.push(["pipeline", value.label]);
    },
    setBindGroup(index, value) {
      calls.push(["bind-group", index, value.label]);
    },
    dispatchWorkgroups(count) {
      calls.push(["dispatch", count]);
    },
    end() {
      calls.push(["end"]);
    }
  };
  const encoder = {
    beginComputePass(descriptor) {
      calls.push(["begin", descriptor.label, descriptor.timestampWrites]);
      return pass;
    }
  };
  probe.encodeCompute(encoder, { timestampWrites: "compute-timestamps" });
  assert.deepEqual(calls, [
    ["begin", "particle-probe:compute-pass", "compute-timestamps"],
    ["pipeline", "compute-pipeline"],
    ["bind-group", 0, "compute-bind-group"],
    ["dispatch", 3],
    ["end"]
  ]);
}

// Render encodeは明示されたViewへquad頂点数 x 粒子数のinstance drawを発行する
{
  const probe = createProbe();
  const calls = [];
  probe.quadVertices = new Float32Array(12);
  probe.renderPipeline = { label: "render-pipeline" };
  probe.renderBindGroup = { label: "render-bind-group" };
  probe.quadBuffer = { label: "quad-buffer" };
  const pass = {
    setPipeline(value) {
      calls.push(["pipeline", value.label]);
    },
    setBindGroup(index, value) {
      calls.push(["bind-group", index, value.label]);
    },
    setVertexBuffer(index, value) {
      calls.push(["vertex-buffer", index, value.label]);
    },
    draw(vertices, instances, firstVertex, firstInstance) {
      calls.push(["draw", vertices, instances, firstVertex, firstInstance]);
    },
    end() {
      calls.push(["end"]);
    }
  };
  const encoder = {
    beginRenderPass(descriptor) {
      calls.push([
        "begin",
        descriptor.colorAttachments[0].view,
        descriptor.depthStencilAttachment.view
      ]);
      return pass;
    }
  };
  probe.encodeRender(encoder, {
    colorView: "color-view",
    depthView: "depth-view",
    clearColor: [0.0, 0.1, 0.2, 1.0]
  });
  assert.deepEqual(calls, [
    ["begin", "color-view", "depth-view"],
    ["pipeline", "render-pipeline"],
    ["bind-group", 0, "render-bind-group"],
    ["vertex-buffer", 0, "quad-buffer"],
    ["draw", 6, 10, 0, 0],
    ["end"]
  ]);
  assert.throws(
    () => probe.encodeRender(encoder, {
      colorView: "color-view",
      depthView: null,
      clearColor: [0.0, 0.0, 0.0, 1.0]
    }),
    /requires depthView/
  );
}

// destroyは所有する3本のBufferだけを一度破棄し、破棄後の利用を明示的な例外にする
{
  const probe = createProbe();
  const destroyed = [];
  probe.particleBuffer = {
    destroy() {
      destroyed.push("particle");
    }
  };
  probe.quadBuffer = {
    destroy() {
      destroyed.push("quad");
    }
  };
  probe.paramBuffer = {
    destroy() {
      destroyed.push("params");
    }
  };
  probe.computePipeline = {};
  probe.renderPipeline = {};
  probe.computeBindGroup = {};
  probe.renderBindGroup = {};

  assert.equal(probe.destroy(), true);
  assert.deepEqual(destroyed, ["particle", "quad", "params"]);
  assert.equal(probe.destroy(), false);
  assert.throws(() => probe.getParticleCount(), /has been destroyed/);
  assert.throws(() => probe.getWorkgroupSize(), /has been destroyed/);
  assert.throws(() => probe.getParticleBuffer(), /has been destroyed/);
  assert.throws(
    () => probe.writeParams(new Float32Array(20)),
    /has been destroyed/
  );
  assert.throws(
    () => probe.encodeCompute({ beginComputePass() {} }),
    /has been destroyed/
  );
  assert.throws(
    () => probe.encodeRender({ beginRenderPass() {} }, {
      colorView: "color-view",
      depthView: "depth-view",
      clearColor: [0.0, 0.0, 0.0, 1.0]
    }),
    /has been destroyed/
  );
}

console.log("PASS GpuParticleEmitter headless contracts");
