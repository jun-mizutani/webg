// ---------------------------------------------------------
// integration_contracts.js  2026/08/04
//   PBR environment Compute Shader preprocessing contracts
// ---------------------------------------------------------
import assert from "node:assert/strict";
import PbrEnvironmentCompute, {
  PBR_ENVIRONMENT_BRDF_COMPUTE_WGSL,
  PBR_ENVIRONMENT_DIFFUSE_COMPUTE_WGSL,
  PBR_ENVIRONMENT_SPECULAR_COMPUTE_WGSL
} from "../../../webg/PbrEnvironmentCompute.js";
import { LINEAR_SRGB_PRIMARIES } from "../../../webg/RadianceHdr.js";
import { createProceduralEnvironmentRadiance } from "../../../webg/ProceduralEnvironment.js";

// Node上でresource生成とdispatch構成を検査できる最小WebGPU定数だけを明示します
globalThis.GPUBufferUsage = { UNIFORM: 1, COPY_DST: 2, MAP_READ: 4, STORAGE: 8 };
globalThis.GPUTextureUsage = { STORAGE_BINDING: 1, TEXTURE_BINDING: 2, COPY_SRC: 4, COPY_DST: 8 };
globalThis.GPUShaderStage = { COMPUTE: 1 };

const calls = {
  textures: [],
  buffers: [],
  writes: [],
  dispatches: 0,
  destroyedTextures: 0,
  computeDescriptors: []
};
const device = {
  createBuffer: (descriptor) => {
    calls.buffers.push(descriptor);
    return { descriptor, destroy() {} };
  },
  createBindGroupLayout: (descriptor) => ({ descriptor }),
  createShaderModule: (descriptor) => ({ descriptor }),
  createPipelineLayout: (descriptor) => ({ descriptor }),
  createComputePipeline: (descriptor) => ({ descriptor }),
  createBindGroup: (descriptor) => ({ descriptor }),
  createSampler: (descriptor) => ({ descriptor }),
  createTexture: (descriptor) => {
    calls.textures.push(descriptor);
    return {
      descriptor,
      createView: (viewDescriptor = {}) => ({ descriptor: viewDescriptor }),
      destroy() { calls.destroyedTextures += 1; }
    };
  }
};
const queue = {
  writeBuffer() {},
  writeTexture: (...args) => calls.writes.push(args)
};
const gpu = { device, queue };

// WGSLは疑似乱数ではなく共通Hammersley列を使い、三つの積分式を明示します
assert.match(PBR_ENVIRONMENT_DIFFUSE_COMPUTE_WGSL, /fn hammersley/);
assert.match(PBR_ENVIRONMENT_DIFFUSE_COMPUTE_WGSL, /importanceAlias/);
assert.match(PBR_ENVIRONMENT_DIFFUSE_COMPUTE_WGSL, /environmentPdf/);
assert.match(PBR_ENVIRONMENT_DIFFUSE_COMPUTE_WGSL, /environmentProposalSum/);
assert.match(PBR_ENVIRONMENT_DIFFUSE_COMPUTE_WGSL, /radianceSum \* PI/);
assert.match(PBR_ENVIRONMENT_DIFFUSE_COMPUTE_WGSL, /textureLoad/);
assert.match(PBR_ENVIRONMENT_SPECULAR_COMPUTE_WGSL, /importanceSampleGgx/);
assert.match(PBR_ENVIRONMENT_SPECULAR_COMPUTE_WGSL, /ggxLightPdf/);
assert.match(PBR_ENVIRONMENT_SPECULAR_COMPUTE_WGSL, /sampleEnvironmentImportance/);
assert.match(PBR_ENVIRONMENT_SPECULAR_COMPUTE_WGSL, /radianceSum \/ weightSum/);
assert.match(PBR_ENVIRONMENT_SPECULAR_COMPUTE_WGSL, /MIN_INTEGRATION_WEIGHT/);
assert.match(PBR_ENVIRONMENT_DIFFUSE_COMPUTE_WGSL, /proposalSum > 0\.0/);
assert.match(PBR_ENVIRONMENT_SPECULAR_COMPUTE_WGSL, /proposalSum > 0\.0/);
assert.match(PBR_ENVIRONMENT_BRDF_COMPUTE_WGSL, /geometrySchlickGgxIbl/);
assert.doesNotMatch(PBR_ENVIRONMENT_DIFFUSE_COMPUTE_WGSL, /random|noise/i);

const options = {
  irradianceWidth: 4,
  irradianceHeight: 2,
  specularWidth: 8,
  specularHeight: 4,
  specularMipCount: 4,
  brdfLutWidth: 8,
  brdfLutHeight: 8,
  diffuseSampleCount: 16,
  specularSampleCount: 16,
  brdfSampleCount: 16
};
const preprocessor = new PbrEnvironmentCompute(gpu, options);
assert.deepEqual(
  preprocessor.specularTargets.map((target) => [target.width, target.height]),
  [[8, 4], [4, 2], [2, 1], [1, 1]]
);
assert.throws(
  () => new PbrEnvironmentCompute(gpu, { ...options, unknown: true }),
  /options\.unknown is not supported/
);

const source = {
  width: 8,
  height: 4,
  data: new Float32Array(8 * 4 * 4),
  sourceFormat: "32-bit_rle_rgbe",
  colorSpace: "linear-srgb",
  orientation: "-Y +X",
  pixelAspect: 1.0,
  primaries: [...LINEAR_SRGB_PRIMARIES]
};
for (let offset = 0; offset < source.data.length; offset += 4) {
  source.data.set([1.0, 2.0, 3.0, 1.0], offset);
}
const proceduralRadiance = createProceduralEnvironmentRadiance({
  preset: "dark-studio",
  resolution: { width: 8, height: 4 }
});
assert.equal(proceduralRadiance.colorSpace, "linear-srgb");
assert.equal(proceduralRadiance.sourceFormat, "32-bit_rle_rgbe");
assert.deepEqual(proceduralRadiance.primaries, LINEAR_SRGB_PRIMARIES);
assert.equal(proceduralRadiance.data.length, 8 * 4 * 4);
const commandEncoder = {
  beginComputePass(descriptor) {
    calls.computeDescriptors.push(descriptor);
    return {
      setPipeline() {},
      setBindGroup() {},
      dispatchWorkgroups() { calls.dispatches += 1; },
      end() {}
    };
  }
};
const timestampQuerySet = {};
const resources = preprocessor.encode(commandEncoder, source, {
  timestampWrites: {
    querySet: timestampQuerySet,
    beginningOfPassWriteIndex: 2,
    endOfPassWriteIndex: 3
  }
});
assert.equal(calls.writes.length, 1);
assert.equal(preprocessor.importanceAliasBuffer.descriptor.size, 8 * 4 * 8);
assert.equal(
  preprocessor.importanceAliasBuffer.descriptor.usage,
  GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
);
assert.equal(calls.dispatches, 6, "diffuse + four specular levels + BRDF LUT");
assert.equal(resources.specularMipCount, 4);
assert.equal(resources.sampler.descriptor.addressModeU, "repeat");
assert.equal(resources.sampler.descriptor.addressModeV, "clamp-to-edge");
assert.deepEqual(calls.computeDescriptors[0].timestampWrites, {
  querySet: timestampQuerySet,
  beginningOfPassWriteIndex: 2
});
assert.equal(calls.computeDescriptors[1].timestampWrites, undefined);
assert.deepEqual(calls.computeDescriptors.at(-1).timestampWrites, {
  querySet: timestampQuerySet,
  endOfPassWriteIndex: 3
});
assert.throws(
  () => preprocessor.encode(commandEncoder, source, { timestampWrites: { querySet: {} } }),
  /requires a beginning or end index/
);
assert.throws(
  () => preprocessor.encode(commandEncoder, source, { unknown: true }),
  /options\.unknown is not supported/
);

const tooBright = { ...source, data: new Float32Array(source.data) };
tooBright.data[0] = 65504 / Math.PI + 1;
assert.throws(() => preprocessor.encode(commandEncoder, tooBright), /must be <=/);
assert.equal(preprocessor.destroy(), true);
assert.equal(preprocessor.destroy(), false);
assert.throws(() => preprocessor.getResources(), /is destroyed/);

console.log("pbr_environment_compute_contracts: Compute preprocessing contracts passed");
