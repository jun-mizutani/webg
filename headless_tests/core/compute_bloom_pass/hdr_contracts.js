// ---------------------------------------------------------
// headless_tests/core/compute_bloom_pass/hdr_contracts.js  2026/07/23
//   Linear HDR contracts for Pyramid ComputeBloomPass
// ---------------------------------------------------------
import assert from "node:assert/strict";
import ComputeBloomPass, {
  COMPUTE_BLOOM_COMPOSITE_WGSL,
  COMPUTE_BLOOM_DEFAULTS,
  COMPUTE_BLOOM_EXTRACT_WGSL,
  COMPUTE_BLOOM_STORAGE_FORMAT,
  COMPUTE_BLOOM_UPSAMPLE_WGSL
} from "../../../webg/ComputeBloomPass.js";
import {
  COMPUTE_IMAGE_PYRAMID_DOWNSAMPLE_WGSL
} from "../../../webg/ComputeImagePyramid.js";

globalThis.GPUTextureUsage = { STORAGE_BINDING: 1, TEXTURE_BINDING: 2, COPY_SRC: 4 };
globalThis.GPUShaderStage = { COMPUTE: 1 };
globalThis.GPUBufferUsage = { UNIFORM: 1, COPY_DST: 2 };

function createGpuProbe() {
  const textures = [];
  const writes = [];
  const dispatches = [];
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
        setPipeline() {},
        setBindGroup() {},
        dispatchWorkgroups(x, y, z) { dispatches.push([x, y, z]); },
        end() {}
      };
    }
  };
  return { gpu: { device, queue }, commandEncoder, textures, writes, dispatches };
}

function makeScene(width = 16, height = 8, format = COMPUTE_BLOOM_STORAGE_FORMAT) {
  return {
    getView: () => ({}),
    getSampler: () => ({}),
    getFormat: () => format,
    getWidth: () => width,
    getHeight: () => height
  };
}

// Extract、downsample、upsample、compositeはTone Map前のHDR値を保持します
{
  assert.equal(COMPUTE_BLOOM_STORAGE_FORMAT, "rgba16float");
  for (const wgsl of [
    COMPUTE_BLOOM_EXTRACT_WGSL,
    COMPUTE_IMAGE_PYRAMID_DOWNSAMPLE_WGSL,
    COMPUTE_BLOOM_UPSAMPLE_WGSL,
    COMPUTE_BLOOM_COMPOSITE_WGSL
  ]) {
    assert.match(wgsl, /texture_storage_2d<rgba16float, write>/);
  }
  assert.match(COMPUTE_BLOOM_EXTRACT_WGSL, /bloomExcess = max\(hardExcess, softExcess\)/);
  assert.match(COMPUTE_BLOOM_EXTRACT_WGSL, /extractScale = bloomExcess \/ brightness/);
  assert.match(COMPUTE_IMAGE_PYRAMID_DOWNSAMPLE_WGSL, /fn readSource/);
  assert.match(COMPUTE_BLOOM_UPSAMPLE_WGSL, /expanded \*= 1\.0 \/ 16\.0/);
  assert.match(
    COMPUTE_BLOOM_UPSAMPLE_WGSL,
    /fine \* params\.values\.x \+ expanded \* params\.values\.y/
  );
  assert.match(
    COMPUTE_BLOOM_COMPOSITE_WGSL,
    /scene\.rgb \+ bloom\.rgb \* params\.values\.x/
  );
  assert.equal(Object.hasOwn(COMPUTE_BLOOM_DEFAULTS, "exposure"), false);
}

// full resolution、5 Pyramid Level、5 progressive upsample出力をrgba16floatで生成します
{
  const probe = createGpuProbe();
  const pass = new ComputeBloomPass(probe.gpu, { width: 16, height: 8 });
  await pass.ready;
  assert.equal(pass.format, COMPUTE_BLOOM_STORAGE_FORMAT);
  assert.equal(probe.textures.length, 12);
  assert.ok(probe.textures.every(({ format }) => format === COMPUTE_BLOOM_STORAGE_FORMAT));

  const output = pass.encode(probe.commandEncoder, makeScene(), {
    threshold: 1.5,
    softKnee: 0.0,
    strength: 0.8,
    filterRadius: 1.2
  });
  assert.equal(output.getFormat(), COMPUTE_BLOOM_STORAGE_FORMAT);
  assert.equal(pass.getBlurTarget().getFormat(), COMPUTE_BLOOM_STORAGE_FORMAT);
  assert.equal(pass.getHalfTarget().getFormat(), COMPUTE_BLOOM_STORAGE_FORMAT);
  assert.equal(pass.getQuarterTarget().getFormat(), COMPUTE_BLOOM_STORAGE_FORMAT);
  assert.equal(pass.getEighthTarget().getFormat(), COMPUTE_BLOOM_STORAGE_FORMAT);
  assert.equal(pass.getSixteenthTarget().getFormat(), COMPUTE_BLOOM_STORAGE_FORMAT);
  assert.equal(pass.getThirtySecondTarget().getFormat(), COMPUTE_BLOOM_STORAGE_FORMAT);
  assert.equal(probe.dispatches.length, 12);

  const compositeUniform = probe.writes.at(-1).data;
  assert.deepEqual(compositeUniform, [0.8, 1, 0, 0]
    .map((value) => Math.fround(value)));
  assert.throws(
    () => pass.encode(probe.commandEncoder, makeScene(16, 8, "rgba8unorm")),
    /scene format must be rgba16float/
  );
  assert.throws(
    () => pass.encode(probe.commandEncoder, makeScene(), { blurRadius: 5 }),
    /no longer supports staged small\/medium\/large bloom parameters/
  );
  pass.destroy();

  assert.throws(
    () => new ComputeBloomPass(probe.gpu, { format: "rgba8unorm" }),
    /format must be rgba16float/
  );
}

console.log("compute_bloom_pass_hdr_contracts: all Pyramid HDR Bloom contracts passed");
