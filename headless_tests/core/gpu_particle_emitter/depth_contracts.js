// ---------------------------------------------------------
// headless_tests/core/gpu_particle_emitter/depth_contracts.js  2026/09/23
//   ComputeParticleEmitter Reverse-Z and coordinate contracts
// ---------------------------------------------------------
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CAMERA_REVERSE_Z, SHADOW_STANDARD_Z } from "../../../webg/DepthConvention.js";
import GpuParticleEmitter from "../../../webg/GpuParticleEmitter.js";

const sampleSource = readFileSync(
  new URL("../../../samples/compute_particles/main.js", import.meta.url),
  "utf8"
);
const computeEmitterSource = readFileSync(
  new URL("../../../webg/ComputeParticleEmitter.js", import.meta.url),
  "utf8"
);

globalThis.GPUShaderStage = { COMPUTE: 1, VERTEX: 2, FRAGMENT: 4 };
globalThis.GPUBufferUsage = { STORAGE: 1, COPY_DST: 2, VERTEX: 4, UNIFORM: 8 };

function createProbe() {
  const pipelines = [];
  const buffers = [];
  const device = {
    createBuffer(descriptor) {
      const buffer = { descriptor, destroy() {} };
      buffers.push(buffer);
      return buffer;
    },
    createBindGroupLayout: (descriptor) => ({ descriptor }),
    createShaderModule: (descriptor) => ({ descriptor }),
    createPipelineLayout: (descriptor) => ({ descriptor }),
    createComputePipeline: (descriptor) => ({ descriptor }),
    createRenderPipeline(descriptor) { pipelines.push(descriptor); return { descriptor }; },
    createBindGroup: (descriptor) => ({ descriptor })
  };
  return { gpu: { device, queue: { writeBuffer() {} }, format: "bgra8unorm" }, pipelines, buffers };
}

function createEmitterOptions() {
  return {
    particleCount: 2,
    floatsPerParticle: 4,
    paramFloats: 4,
    initialData: new Float32Array(8),
    computeCode: "@compute @workgroup_size(1) fn main() {}",
    renderCode: "@vertex fn vsMain(@location(0) p: vec2f) -> @builtin(position) vec4f { return vec4f(p, 0.0, 1.0); } @fragment fn fsMain() -> @location(0) vec4f { return vec4f(1.0); }",
    depthConvention: CAMERA_REVERSE_Z,
    coordinateSpace: "camera-relative"
  };
}

// pipelineは通常カメラdepthと同じformat/compareを使用します
{
  const probe = createProbe();
  const emitter = new GpuParticleEmitter(probe.gpu, createEmitterOptions());
  const depth = probe.pipelines[0].depthStencil;
  assert.equal(depth.format, "depth32float");
  assert.equal(depth.depthCompare, "greater");
  assert.equal(depth.depthWriteEnabled, false);
  assert.equal(emitter.coordinateSpace, "camera-relative");
}

// depth conventionと座標空間を省略または別規則にして暗黙変換することを禁止します
{
  const probe = createProbe();
  const base = createEmitterOptions();
  assert.throws(() => new GpuParticleEmitter(probe.gpu, { ...base, depthConvention: undefined }),
    /must be CAMERA_REVERSE_Z or SHADOW_STANDARD_Z/);
  assert.throws(() => new GpuParticleEmitter(probe.gpu, { ...base, depthConvention: SHADOW_STANDARD_Z }),
    /requires CAMERA_REVERSE_Z/);
  assert.throws(() => new GpuParticleEmitter(probe.gpu, { ...base, coordinateSpace: undefined }),
    /coordinateSpace is required/);
  assert.throws(() => new GpuParticleEmitter(probe.gpu, { ...base, coordinateSpace: "world" }),
    /must be one of: camera-relative/);
}

// render passは背景depthを0でclearし、同じpipelineでinstance drawします
{
  const probe = createProbe();
  const emitter = new GpuParticleEmitter(probe.gpu, createEmitterOptions());
  let descriptor = null;
  const pass = { setPipeline() {}, setBindGroup() {}, setVertexBuffer() {}, draw() {}, end() {} };
  emitter.encodeRender({ beginRenderPass(value) { descriptor = value; return pass; } }, {
    colorView: {}, depthView: {}, clearColor: [0.0, 0.0, 0.0, 1.0]
  });
  assert.equal(descriptor.depthStencilAttachment.depthClearValue, 0.0);
}

// 公開sampleは標準ComputeParticleEmitterを使い、target formatを画面から明示します
// 座標空間とReverse-Z規則はEmitter共通実装に集約し、sample shaderとの二重管理を避けます
assert.match(sampleSource, /import ComputeParticleEmitter from "\.\.\/\.\.\/webg\/ComputeParticleEmitter\.js"/);
assert.match(sampleSource, /new ComputeParticleEmitter\(/);
assert.match(sampleSource, /targetFormat:\s*screen\.getGPU\(\)\.format/);
assert.match(computeEmitterSource, /coordinateSpace:\s*["']camera-relative["']/);
assert.match(computeEmitterSource, /depthConvention:\s*CAMERA_REVERSE_Z/);

console.log("gpu_particle_emitter_depth_contracts: all particle contracts passed");
