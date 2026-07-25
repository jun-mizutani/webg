// ---------------------------------------------------------
// headless_tests/core/compute_blur_pass/headless_probe.js  2026/07/13
//   Linear High Dynamic Range contract for ComputeBlurPass
// ---------------------------------------------------------
import assert from "node:assert/strict";
import ComputeBlurPass, {
  COMPUTE_BLUR_FORMAT,
  COMPUTE_BLUR_WGSL
} from "../../../webg/ComputeBlurPass.js";

globalThis.GPUTextureUsage = { STORAGE_BINDING: 1, TEXTURE_BINDING: 2, COPY_SRC: 4 };
globalThis.GPUShaderStage = { COMPUTE: 1 };
globalThis.GPUBufferUsage = { UNIFORM: 1, COPY_DST: 2 };

// blurが作るping-pong textureとuniform writeを記録します
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
    writeTexture() {},
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

function makeSource(width = 16, height = 8, format = COMPUTE_BLUR_FORMAT) {
  return {
    getView: () => ({}),
    getFormat: () => format,
    getWidth: () => width,
    getHeight: () => height
  };
}

// shaderはHDR加重平均を行い、CPU検証値を再補正しません
{
  assert.equal(COMPUTE_BLUR_FORMAT, "rgba16float");
  assert.match(COMPUTE_BLUR_WGSL, /texture_storage_2d<rgba16float, write>/);
  assert.match(COMPUTE_BLUR_WGSL, /let radius = i32\(params\.radius\)/);
  assert.doesNotMatch(COMPUTE_BLUR_WGSL, /clamp\(i32\(round\(params\.radius\)\)/);
  assert.doesNotMatch(COMPUTE_BLUR_WGSL, /max\(f32\(radius\)/);
  assert.doesNotMatch(COMPUTE_BLUR_WGSL, /max\(weightSum/);
}

// source、二個のping-pong target、storage bindingは同じHDR形式を共有します
{
  const probe = createGpuProbe();
  const pass = new ComputeBlurPass(probe.gpu, { width: 16, height: 8 });
  await pass.ready;
  assert.equal(pass.format, COMPUTE_BLUR_FORMAT);
  assert.equal(probe.textures.length, 2);
  assert.ok(probe.textures.every(({ format }) => format === COMPUTE_BLUR_FORMAT));
  assert.equal(pass.getIntermediateTarget().getFormat(), COMPUTE_BLUR_FORMAT);
  assert.equal(pass.getOutputTarget().getFormat(), COMPUTE_BLUR_FORMAT);

  const output = pass.encode(probe.commandEncoder, makeSource(), {
    radius: 5,
    iterations: 1
  });
  assert.equal(output.getFormat(), COMPUTE_BLUR_FORMAT);
  assert.deepEqual(probe.writes.map(({ data }) => data.slice(0, 3)), [
    [1, 0, 5],
    [0, 1, 5]
  ]);
  assert.throws(
    () => pass.encode(probe.commandEncoder, makeSource(16, 8, "rgba8unorm")),
    /source format must be rgba16float/
  );
  assert.throws(
    () => pass.encode(probe.commandEncoder, makeSource(), { radius: 0 }),
    /radius must be >= 1/
  );
  pass.destroy();

  assert.throws(
    () => new ComputeBlurPass(probe.gpu, { format: "rgba8unorm" }),
    /format must be rgba16float/
  );
}

console.log("compute_blur_pass_hdr_contracts: all linear blur contracts passed");
