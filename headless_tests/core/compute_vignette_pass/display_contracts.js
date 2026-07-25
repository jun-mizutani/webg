import assert from "node:assert/strict";
import ComputeVignettePass, {
  COMPUTE_VIGNETTE_FORMAT,
  COMPUTE_VIGNETTE_WGSL
} from "../../../webg/ComputeVignettePass.js";

globalThis.GPUTextureUsage = { STORAGE_BINDING: 1, TEXTURE_BINDING: 2, COPY_SRC: 4 };
globalThis.GPUShaderStage = { COMPUTE: 1 };
globalThis.GPUBufferUsage = { UNIFORM: 1, COPY_DST: 2 };

function createGpuProbe() {
  const textures = [];
  const writes = [];
  const device = {
    createSampler: (descriptor) => ({ descriptor }),
    createTexture(descriptor) {
      textures.push(descriptor);
      return {
        descriptor,
        createView: () => ({ descriptor }),
        destroy() {}
      };
    },
    createBuffer: (descriptor) => ({ descriptor, destroy() {} }),
    createBindGroupLayout: (descriptor) => ({ descriptor }),
    createShaderModule: (descriptor) => ({ descriptor }),
    createPipelineLayout: (descriptor) => ({ descriptor }),
    createComputePipeline: (descriptor) => ({ descriptor }),
    createBindGroup: (descriptor) => ({ descriptor })
  };
  const queue = {
    writeBuffer(buffer, offset, data) {
      writes.push({ buffer, offset, data: Array.from(data) });
    }
  };
  const commandEncoder = {
    beginComputePass() {
      return {
        setPipeline() {}, setBindGroup() {}, dispatchWorkgroups() {}, end() {}
      };
    }
  };
  return { gpu: { device, queue }, commandEncoder, textures, writes };
}

function makeScene(width = 16, height = 8, format = COMPUTE_VIGNETTE_FORMAT) {
  return {
    getView: () => ({}),
    getFormat: () => format,
    getWidth: () => width,
    getHeight: () => height
  };
}

// VignetteはTone MapとEdge後の表示色だけを読み書きします。
{
  assert.equal(COMPUTE_VIGNETTE_FORMAT, "rgba8unorm");
  assert.match(COMPUTE_VIGNETTE_WGSL, /texture_storage_2d<rgba8unorm, write>/);
  assert.match(COMPUTE_VIGNETTE_WGSL, /delta\.x \*= f32\(dims\.x\)/);
  assert.match(COMPUTE_VIGNETTE_WGSL, /source\.rgb \* mix\(vec3f\(1\.0\), params\.tint\.rgb, tintMix\)/);
  assert.doesNotMatch(COMPUTE_VIGNETTE_WGSL, /texture_depth_2d/);
}

// center、radius、softness、strength、tintを検証し、uniformへそのまま渡します。
{
  const probe = createGpuProbe();
  const pass = new ComputeVignettePass(probe.gpu, { width: 16, height: 8 });
  await pass.ready;
  const output = pass.encode(probe.commandEncoder, makeScene(), {
    center: [0.45, 0.55],
    radius: 1.1,
    softness: 0.4,
    strength: 0.8,
    tint: [0.1, 0.2, 0.3],
    enabled: true
  });
  assert.equal(output.getFormat(), COMPUTE_VIGNETTE_FORMAT);
  assert.equal(probe.textures[0].format, COMPUTE_VIGNETTE_FORMAT);
  assert.deepEqual(
    probe.writes.at(-1).data,
    [0.45, 0.55, 1.1, 0.4, 0.8, 1, 0, 0, 0.1, 0.2, 0.3, 0]
      .map((value) => Math.fround(value))
  );
  assert.throws(
    () => pass.encode(probe.commandEncoder, makeScene(16, 8, "rgba16float")),
    /scene format must be rgba8unorm/
  );
  assert.throws(
    () => pass.encode(probe.commandEncoder, makeScene(), { radius: 0.3, softness: 0.4 }),
    /softness must be <= 0.3/
  );
  assert.throws(
    () => pass.encode(probe.commandEncoder, makeScene(), { strength: 1.1 }),
    /strength must be <= 1/
  );
  pass.destroy();
}

console.log("compute_vignette_pass_display_contracts: all display contracts passed");
