// ---------------------------------------------------------
// headless_tests/core/ssao_pass/headless_probe.js  2026/07/12
//   Ambient Occlusion visibility-only contracts for SsaoPass
// ---------------------------------------------------------
import assert from "node:assert/strict";
import CameraFrame from "../../../webg/CameraFrame.js";
import {
  CAMERA_REVERSE_Z,
  SHADOW_STANDARD_Z
} from "../../../webg/DepthConvention.js";
import Matrix from "../../../webg/Matrix.js";
import SsaoPass, {
  SSAO_BILATERAL_WGSL,
  SSAO_WGSL
} from "../../../webg/SsaoPass.js";

globalThis.GPUTextureUsage = { STORAGE_BINDING: 1, TEXTURE_BINDING: 2, COPY_SRC: 4 };
globalThis.GPUShaderStage = { COMPUTE: 1 };
globalThis.GPUBufferUsage = { UNIFORM: 1, COPY_DST: 2 };

// raw AOとbilateral visibilityのbinding・uniform・dispatchを記録します
function createGpuProbe() {
  const writes = [];
  const dispatches = [];
  const device = {
    createSampler: (descriptor) => ({ descriptor }),
    createTexture: (descriptor) => ({
      descriptor,
      createView: () => ({ descriptor }),
      destroy() {}
    }),
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
    beginComputePass(descriptor) {
      return {
        setPipeline() {},
        setBindGroup() {},
        dispatchWorkgroups(x, y, z) {
          dispatches.push({ x, y, z, descriptor });
        },
        end() {}
      };
    }
  };
  return { gpu: { device, queue }, commandEncoder, writes, dispatches };
}

function makeFrame() {
  const cameraWorldMatrix = new Matrix();
  cameraWorldMatrix.position([1.0e10, -2.0e10, 3.0e10]);
  return new CameraFrame({
    cameraWorldMatrix,
    near: 0.2,
    far: 3000.0,
    vfov: 55.0,
    aspect: 2.0,
    depthConvention: CAMERA_REVERSE_Z
  });
}

function makeResources(width = 20, height = 10, convention = CAMERA_REVERSE_Z) {
  return {
    normal: { getView: () => ({}), getWidth: () => width, getHeight: () => height },
    depth: {
      depthConvention: convention,
      getDepthSampleView: () => ({}),
      getWidth: () => width,
      getHeight: () => height
    }
  };
}

// rawとbilateralの両WGSLはscene colorを読まず、AO visibilityだけを書きます
{
  for (const wgsl of [SSAO_WGSL, SSAO_BILATERAL_WGSL]) {
    assert.doesNotMatch(wgsl, /colorTexture/);
    assert.doesNotMatch(wgsl, /source\.rgb|source\.a/);
    assert.match(wgsl, /vec4f\(vec3f\(ao\), 1\.0\)/);
    assert.match(wgsl, /vec4f\(1\.0\)/);
  }
  assert.doesNotMatch(SSAO_BILATERAL_WGSL, /centerNormal \* 0\.5/);
}

// Compute bindingはnormalとcamera depthへ限定され、bilateral後もフル解像度visibilityを返します
{
  const probe = createGpuProbe();
  const pass = new SsaoPass(probe.gpu, {
    label: "v2-ssao-visibility",
    width: 20,
    height: 10,
    resolutionScale: 0.5
  });
  await pass.ready;
  assert.deepEqual(pass.computePass.bindings.map(({ name }) => name), [
    "params",
    "normal",
    "depth",
    "output"
  ]);
  assert.deepEqual(pass.bilateralPass.bindings.map(({ name }) => name), [
    "params",
    "normal",
    "depth",
    "ao",
    "output"
  ]);
  const output = pass.encode(probe.commandEncoder, makeResources(), {
    cameraFrame: makeFrame(),
    enabled: false
  });
  assert.equal(output, pass.getOutputTarget());
  assert.equal(output.getWidth(), 20);
  assert.equal(output.getHeight(), 10);
  assert.equal(probe.writes.at(-2).data[8], 0.0);
  assert.equal(probe.writes.at(-1).data[4], 0.0);
  assert.deepEqual(probe.dispatches.map(({ x, y, z }) => [x, y, z]), [
    [2, 1, 1],
    [3, 2, 1]
  ]);
  pass.destroy();
}

// 旧view option、通常Z depth、入力寸法不一致を黙って処理しません
{
  const probe = createGpuProbe();
  const pass = new SsaoPass(probe.gpu, { width: 20, height: 10 });
  await pass.ready;
  assert.throws(() => pass.encode(probe.commandEncoder, makeResources(), {
    cameraFrame: makeFrame(),
    view: "composite"
  }), /view option was removed/);
  assert.throws(() => pass.encode(
    probe.commandEncoder,
    makeResources(20, 10, SHADOW_STANDARD_Z),
    { cameraFrame: makeFrame() }
  ), /require CAMERA_REVERSE_Z depth target/);
  assert.throws(() => pass.encode(
    probe.commandEncoder,
    makeResources(10, 10),
    { cameraFrame: makeFrame() }
  ), /does not match output size/);
  pass.destroy();
}

console.log("ssao_pass_visibility_contracts: all AO visibility contracts passed");
