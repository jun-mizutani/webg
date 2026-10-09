// ---------------------------------------------------------
// api_contracts.js  2026/08/03
//   Precomputed IBL resource contracts
// ---------------------------------------------------------
import assert from "node:assert/strict";
import PbrEnvironment, {
  float16BitsToFloat32,
  float32ToFloat16Bits,
  validatePbrEnvironmentResources
} from "../../../webg/PbrEnvironment.js";

globalThis.GPUTextureUsage = { TEXTURE_BINDING: 1, COPY_DST: 2 };

function makeLevel(width, height, channels, value) {
  return { width, height, data: new Float32Array(width * height * channels).fill(value) };
}

function createGpuProbe() {
  const descriptors = [];
  const writes = [];
  const textures = [];
  const device = {
    createTexture(descriptor) {
      descriptors.push(descriptor);
      const texture = {
        descriptor,
        destroyed: false,
        createView: () => ({ descriptor }),
        destroy() { this.destroyed = true; }
      };
      textures.push(texture);
      return texture;
    },
    createSampler: (descriptor) => ({ descriptor })
  };
  const queue = {
    writeTexture(destination, data, layout, size) {
      writes.push({ destination, data, layout, size });
    }
  };
  return { gpu: { device, queue }, descriptors, writes, textures };
}

assert.equal(float32ToFloat16Bits(0.0), 0x0000);
assert.equal(float32ToFloat16Bits(1.0), 0x3c00);
assert.equal(float32ToFloat16Bits(2.0), 0x4000);
assert.equal(float16BitsToFloat32(0x0000), 0.0);
assert.equal(float16BitsToFloat32(0x3c00), 1.0);
assert.equal(float16BitsToFloat32(0x4000), 2.0);
assert.equal(float16BitsToFloat32(0x7c00), Number.POSITIVE_INFINITY);
assert.ok(Number.isNaN(float16BitsToFloat32(0x7e00)));
assert.throws(() => float32ToFloat16Bits(Number.NaN), /must be finite/);
assert.throws(() => float32ToFloat16Bits(70000), /must be <= 65504/);

{
  const textureResource = { getView: () => ({}) };
  const resources = {
    irradiance: textureResource,
    prefilteredSpecular: textureResource,
    brdfLut: textureResource,
    sampler: {},
    specularMipCount: 5
  };
  const checked = validatePbrEnvironmentResources(resources, 1.25, "test PBR");
  assert.equal(checked.intensity, 1.25);
  assert.equal(checked.specularMipCount, 5);
  assert.equal(validatePbrEnvironmentResources(null, undefined, "test PBR"), null);
  assert.throws(
    () => validatePbrEnvironmentResources(null, 1.0, "test PBR"),
    /environmentIntensity requires environment/
  );
  assert.throws(
    () => validatePbrEnvironmentResources({ ...resources, unknown: true }, 1.0, "test PBR"),
    /environment\.unknown is not supported/
  );
  assert.throws(
    () => validatePbrEnvironmentResources({ ...resources, brdfLut: null }, 1.0, "test PBR"),
    /requires brdfLut\.getView\(\)/
  );
}

{
  const probe = createGpuProbe();
  const environment = new PbrEnvironment(probe.gpu, {
    irradiance: makeLevel(4, 2, 4, 0.5),
    prefilteredSpecular: [
      makeLevel(4, 2, 4, 2.0),
      makeLevel(2, 1, 4, 1.0),
      makeLevel(1, 1, 4, 0.5)
    ],
    brdfLut: makeLevel(4, 4, 2, 0.25)
  });
  assert.equal(environment.specularMipCount, 3);
  const resources = environment.getResources();
  assert.deepEqual(Object.keys(resources).sort(), [
    "brdfLut",
    "irradiance",
    "prefilteredSpecular",
    "sampler",
    "specularMipCount"
  ]);
  assert.equal(resources.irradiance, environment.irradiance);
  assert.equal(resources.prefilteredSpecular, environment.prefilteredSpecular);
  assert.equal(resources.brdfLut, environment.brdfLut);
  assert.equal(resources.sampler, environment.sampler);
  assert.equal(resources.specularMipCount, 3);
  assert.equal(probe.descriptors[1].format, "rgba16float");
  assert.equal(probe.descriptors[1].mipLevelCount, 3);
  assert.equal(probe.descriptors[2].format, "rg16float");
  assert.equal(probe.writes.length, 5);
  assert.equal(probe.writes[0].layout.bytesPerRow, 256);
  assert.deepEqual(probe.writes.slice(1, 4).map((write) => write.destination.mipLevel), [0, 1, 2]);
  assert.equal(environment.destroy(), true);
  assert.equal(environment.destroy(), false);
  assert.ok(probe.textures.every((texture) => texture.destroyed));
  assert.throws(() => environment.getResources(), /is destroyed/);
}

{
  const probe = createGpuProbe();
  assert.throws(() => new PbrEnvironment(probe.gpu, {
    irradiance: makeLevel(4, 2, 4, 0.5),
    prefilteredSpecular: [
      makeLevel(4, 2, 4, 1.0),
      makeLevel(3, 1, 4, 1.0)
    ],
    brdfLut: makeLevel(4, 4, 2, 0.25)
  }), /size must be 2x1/);
}

console.log("pbr_environment_api_contracts: HDR texture upload contracts passed");
