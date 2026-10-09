// ---------------------------------------------------------
// api_contracts.js  2026/08/09
//   ComputePerlinNoise2D core API and resource contracts
// ---------------------------------------------------------
import assert from "node:assert/strict";
import ComputePerlinNoise2D, {
  createPerlinWgslLibrary
} from "../../../webg/ComputePerlinNoise2D.js";

globalThis.GPUShaderStage = { COMPUTE: 1 };
globalThis.GPUBufferUsage = { STORAGE: 1, COPY_DST: 2, COPY_SRC: 4 };

const calls = {
  buffers: [],
  dispatches: [],
  submits: 0,
  writes: []
};

const device = {
  createBindGroupLayout: (descriptor) => ({ descriptor }),
  createShaderModule: (descriptor) => ({ descriptor }),
  createPipelineLayout: (descriptor) => ({ descriptor }),
  createComputePipeline: (descriptor) => ({ descriptor }),
  createBuffer(descriptor) {
    const buffer = {
      descriptor,
      destroyed: false,
      destroy() { this.destroyed = true; }
    };
    calls.buffers.push(buffer);
    return buffer;
  },
  createBindGroup: (descriptor) => ({ descriptor }),
  createCommandEncoder() {
    return {
      beginComputePass() {
        return {
          setPipeline() {},
          setBindGroup() {},
          dispatchWorkgroups(x, y, z) { calls.dispatches.push([x, y, z]); },
          end() {}
        };
      },
      finish: () => ({ type: "compute-perlin-command" })
    };
  }
};

const queue = {
  writeBuffer(buffer, offset, words) {
    calls.writes.push([buffer, offset, new Uint32Array(words)]);
  },
  submit() { calls.submits += 1; }
};

const perlin = new ComputePerlinNoise2D({ device, queue });
const library = createPerlinWgslLibrary();
assert.match(library, /fn mixLowbias32/);
assert.match(library, /fn hashSequence5/);
assert.match(library, /fn perlinFbm/);
assert.match(perlin.createWGSL(), /@workgroup_size\(8, 8, 1\)/);

const field = perlin.generateField({
  width: 17,
  height: 9,
  seed: 0xf0000001,
  salt: 0x4d415242,
  periodCells: [7, 5],
  domainOrigin: [-1.25, 0.5],
  domainSize: [7, 5],
  octaves: 5,
  lacunarity: 2,
  gain: 0.5
});

assert.equal(field.width, 17);
assert.equal(field.height, 9);
assert.equal(field.length, 153);
assert.deepEqual(calls.dispatches, [[3, 2, 1]]);
assert.equal(calls.submits, 1);
assert.equal(calls.writes.length, 1);
assert.equal(calls.writes[0][2][2], 0xf0000001);
assert.equal(
  field.buffer.descriptor.usage,
  GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
);

assert.throws(
  () => perlin.generateField({ width: 0, height: 4 }),
  /width must be >= 1/
);
assert.throws(
  () => perlin.generateField({
    width: 4,
    height: 4,
    periodCells: [2, 2],
    octaves: 2,
    lacunarity: 1.5
  }),
  /lacunarity must be an integer for periodic noise/
);
assert.throws(
  () => perlin.generateField({ width: 4, height: 4, domainSize: [1] }),
  /domainSize must be a two-element Array/
);

assert.equal(perlin.destroyField(field), true);
assert.equal(field.buffer, null);
assert.equal(field.parameterBuffer, null);
assert.equal(perlin.destroyField(field), false);
assert.equal(perlin.destroy(), true);
assert.equal(perlin.destroy(), false);
assert.throws(
  () => perlin.generateField({ width: 4, height: 4 }),
  /is destroyed/
);

console.log("compute_perlin_noise_2d_contracts: core API contracts passed");
