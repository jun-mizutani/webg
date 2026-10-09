// ---------------------------------------------------------
// headless_tests/core/pbr_environment_debug_pass/debug_contracts.js  2026/08/03
//   Environment diagnostic view, mip, exposure, and selection contracts
// ---------------------------------------------------------
import assert from "node:assert/strict";
import PbrEnvironmentDebugPass, {
  mapPbrEnvironmentDebugUv,
  PBR_ENVIRONMENT_DEBUG_FORMAT,
  PBR_ENVIRONMENT_DEBUG_VIEWS,
  PBR_ENVIRONMENT_DEBUG_WGSL
} from "../../../webg/PbrEnvironmentDebugPass.js";

globalThis.GPUShaderStage = { COMPUTE: 1 };
globalThis.GPUBufferUsage = { UNIFORM: 1, COPY_DST: 2 };

// ComputePassが作るpipeline、uniform書込み、dispatchを記録する最小GPUを作ります
function createGpuProbe() {
  const uniformWrites = [];
  const dispatches = [];
  const device = {
    createBuffer: (descriptor) => ({ descriptor, destroy() {} }),
    createBindGroupLayout: (descriptor) => ({ descriptor }),
    createShaderModule: (descriptor) => ({ descriptor }),
    createPipelineLayout: (descriptor) => ({ descriptor }),
    createComputePipeline: (descriptor) => ({ descriptor }),
    createBindGroup: (descriptor) => ({ descriptor })
  };
  const queue = {
    writeBuffer(_buffer, _offset, data) {
      uniformWrites.push(Array.from(data));
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
  return { gpu: { device, queue }, commandEncoder, uniformWrites, dispatches };
}

// resize可能なrgba16float target factoryを使い、実textureなしでpassの形式を確認します
function createTargetFactory() {
  const target = {
    width: 16,
    height: 8,
    ready: Promise.resolve(),
    destroyed: false,
    getView: () => ({ name: "debug-output" }),
    getWidth() { return this.width; },
    getHeight() { return this.height; },
    getFormat: () => PBR_ENVIRONMENT_DEBUG_FORMAT,
    resize(width, height) {
      if (this.width === width && this.height === height) return false;
      this.width = width;
      this.height = height;
      return true;
    },
    destroy() { this.destroyed = true; }
  };
  return {
    format: PBR_ENVIRONMENT_DEBUG_FORMAT,
    create: () => target,
    target
  };
}

function createEnvironment(includeRadiance = true) {
  const texture = (name) => ({ getView: () => ({ name }) });
  return {
    ...(includeRadiance ? { radiance: texture("radiance") } : {}),
    irradiance: texture("irradiance"),
    prefilteredSpecular: texture("specular"),
    brdfLut: texture("brdf-lut"),
    sampler: {},
    specularMipCount: 5
  };
}

assert.deepEqual(PBR_ENVIRONMENT_DEBUG_VIEWS, [
  "radiance",
  "irradiance",
  "specular",
  "brdfLut"
]);
assert.match(PBR_ENVIRONMENT_DEBUG_WGSL, /textureLoad\(radianceTexture/);
assert.match(PBR_ENVIRONMENT_DEBUG_WGSL, /textureLoad\(irradianceTexture/);
assert.match(PBR_ENVIRONMENT_DEBUG_WGSL, /textureLoad\(specularTexture, coord, mipLevel\)/);
assert.match(PBR_ENVIRONMENT_DEBUG_WGSL, /let brdf = textureLoad\(brdfLutTexture/);
assert.match(PBR_ENVIRONMENT_DEBUG_WGSL, /contentMin/);
assert.match(PBR_ENVIRONMENT_DEBUG_WGSL, /exp2\(params\.control\.z\)/);
assert.match(PBR_ENVIRONMENT_DEBUG_WGSL, /markerDistance/);

// 960x720へ2:1画像を収める上下の黒帯を除き、表示領域の端と中央を画像UVへ戻します
const assertUvNear = (actual, expected) => {
  assert.equal(actual.length, 2);
  assert.ok(Math.abs(actual[0] - expected[0]) <= Number.EPSILON);
  assert.ok(Math.abs(actual[1] - expected[1]) <= Number.EPSILON);
};
assertUvNear(mapPbrEnvironmentDebugUv([0.5, 0.5], [960, 720], [8, 4]), [0.5, 0.5]);
assertUvNear(mapPbrEnvironmentDebugUv([0.25, 0.25], [960, 720], [8, 4]), [0.25, 0.125]);
assertUvNear(mapPbrEnvironmentDebugUv([0.75, 0.75], [960, 720], [8, 4]), [0.75, 0.875]);
assert.equal(mapPbrEnvironmentDebugUv([0.5, 0.1], [960, 720], [8, 4]), null);
assert.throws(
  () => mapPbrEnvironmentDebugUv([1.1, 0.5], [960, 720], [8, 4]),
  /must be <= 1/
);
assert.throws(
  () => mapPbrEnvironmentDebugUv([0.5, 0.5], [0, 720], [8, 4]),
  /must be >= 1/
);

// specular mip 2はroughness 0.5となり、露出と選択UVを同じuniformへ保持します
{
  const probe = createGpuProbe();
  const factory = createTargetFactory();
  const pass = new PbrEnvironmentDebugPass(probe.gpu, {
    label: "environment-debug-probe",
    width: 16,
    height: 8,
    targetFactory: factory
  });
  await pass.ready;
  const output = pass.encode(probe.commandEncoder, createEnvironment(), {
    view: "specular",
    mipLevel: 2,
    exposureStops: 1.0,
    selectedUv: [0.25, 0.75]
  });
  assert.equal(output, factory.target);
  assert.deepEqual(probe.uniformWrites.at(-1), [2, 2, 1, 0.5, 0.25, 0.75, 0, 0]);
  assert.deepEqual(probe.dispatches, [[2, 1, 1]]);
  assert.equal(pass.resize(16, 8), false);
  assert.equal(pass.resize(32, 24), true);
  assert.equal(pass.getOutputTarget().getWidth(), 32);
  assert.equal(pass.destroy(), true);
  assert.equal(pass.destroy(), false);
  assert.equal(factory.target.destroyed, true);
  assert.throws(() => pass.getOutputTarget(), /is destroyed/);
}

// 欠けた元HDR、範囲外mip、不正view、不正UVは別resourceへ置き換えず例外にします
{
  const probe = createGpuProbe();
  const pass = new PbrEnvironmentDebugPass(probe.gpu, {
    width: 16,
    height: 8,
    targetFactory: createTargetFactory()
  });
  await pass.ready;
  assert.throws(
    () => pass.encode(probe.commandEncoder, createEnvironment(false)),
    /requires environment\.radiance/
  );
  assert.throws(
    () => pass.encode(probe.commandEncoder, createEnvironment(), { mipLevel: 5 }),
    /must be <= 4/
  );
  assert.throws(
    () => pass.encode(probe.commandEncoder, createEnvironment(), { view: "normal" }),
    /must be one of/
  );
  assert.throws(
    () => pass.encode(probe.commandEncoder, createEnvironment(), { selectedUv: [0.5] }),
    /exact vec2/
  );
  assert.throws(
    () => pass.encode(probe.commandEncoder, createEnvironment(), { selectedUv: [1.1, 0.5] }),
    /must be <= 1/
  );
  pass.destroy();
}

console.log("pbr_environment_debug_pass_contracts: diagnostic view contracts passed");
