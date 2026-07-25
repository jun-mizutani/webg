// ---------------------------------------------------------
// headless_tests/core/compute_ssr_pass/hdr_reflection_contracts.js  2026/07/23
//   Linear HDR ray and material-roughness filtering contracts for ComputeSsrPass
// ---------------------------------------------------------
import assert from "node:assert/strict";
import CameraFrame from "../../../webg/CameraFrame.js";
import ComputeSsrPass, {
  COMPUTE_SSR_DEFAULTS,
  COMPUTE_SSR_INPUT_FORMAT,
  COMPUTE_SSR_MATERIAL_FORMAT,
  COMPUTE_SSR_OUTPUT_FORMAT,
  COMPUTE_SSR_ROUGHNESS_WGSL,
  COMPUTE_SSR_VIEW_MODES,
  COMPUTE_SSR_WGSL
} from "../../../webg/ComputeSsrPass.js";
import { CAMERA_REVERSE_Z } from "../../../webg/DepthConvention.js";
import Matrix from "../../../webg/Matrix.js";

globalThis.GPUTextureUsage = { STORAGE_BINDING: 1, TEXTURE_BINDING: 2, COPY_SRC: 4 };
globalThis.GPUShaderStage = { COMPUTE: 1 };
globalThis.GPUBufferUsage = { UNIFORM: 1, COPY_DST: 2 };

// SSRが作るtargetとbindingを記録します
function createGpuProbe() {
  const textures = [];
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
  const queue = { writeTexture() {}, writeBuffer() {} };
  const commandEncoder = {
    beginComputePass() {
      return {
        setPipeline() {}, setBindGroup() {}, dispatchWorkgroups() {}, end() {}
      };
    }
  };
  return { gpu: { device, queue }, commandEncoder, textures };
}

function makeFrame() {
  return new CameraFrame({
    cameraWorldMatrix: new Matrix(),
    near: 0.1,
    far: 1000.0,
    vfov: 60.0,
    aspect: 2.0,
    depthConvention: CAMERA_REVERSE_Z
  });
}

// Tone Map前sceneとG-buffer materialを、同一のfull resolutionで用意します
function makeResources(width = 20, height = 10) {
  const sized = { getWidth: () => width, getHeight: () => height };
  return {
    scene: {
      ...sized,
      getView: () => ({}),
      getFormat: () => COMPUTE_SSR_INPUT_FORMAT
    },
    normal: { ...sized, getView: () => ({}) },
    material: {
      ...sized,
      getView: () => ({}),
      getFormat: () => COMPUTE_SSR_MATERIAL_FORMAT
    },
    depth: {
      ...sized,
      depthConvention: CAMERA_REVERSE_Z,
      getDepthSampleView: () => ({})
    }
  };
}

// SSRは独自の固定照明やgamma変換を持たず、hit位置のHDR sceneを反射色にします
{
  assert.equal(COMPUTE_SSR_INPUT_FORMAT, "rgba16float");
  assert.equal(COMPUTE_SSR_OUTPUT_FORMAT, "rgba16float");
  assert.equal(COMPUTE_SSR_MATERIAL_FORMAT, "rgba8unorm");
  assert.equal(COMPUTE_SSR_DEFAULTS.view, "reflection");
  assert.deepEqual(COMPUTE_SSR_VIEW_MODES, ["reflection", "normal", "depth"]);
  assert.match(COMPUTE_SSR_WGSL, /texture_storage_2d<rgba16float, write>/);
  assert.match(COMPUTE_SSR_WGSL, /reflection = textureLoad\(sceneTexture, hitCoord, 0\)\.rgb/);
  assert.match(COMPUTE_SSR_WGSL, /material\.r, material\.b/);
  assert.doesNotMatch(COMPUTE_SSR_WGSL, /roughnessResponse/);
  assert.match(COMPUTE_SSR_ROUGHNESS_WGSL, /roughness \* 3\.0/);
  assert.match(COMPUTE_SSR_ROUGHNESS_WGSL, /rawReflection\.a/);
  assert.match(COMPUTE_SSR_ROUGHNESS_WGSL, /mix\(halfColor, quarterColor/);
  assert.match(COMPUTE_SSR_ROUGHNESS_WGSL, /mix\(quarterColor, eighthColor/);
  assert.doesNotMatch(COMPUTE_SSR_WGSL, /fn shade\(/);
  assert.doesNotMatch(COMPUTE_SSR_WGSL, /1\.0 \/ 2\.2/);
  assert.doesNotMatch(COMPUTE_SSR_WGSL, /mix\(baseColor/);
  assert.match(COMPUTE_SSR_WGSL, /vec4f\(reflectionOnly, reflectionWeight\)/);
}

// targetとComputePassはHDR形式を共有し、sceneとmaterialを明示bindingします
{
  const probe = createGpuProbe();
  const pass = new ComputeSsrPass(probe.gpu, {
    width: 20,
    height: 10,
    resolutionScale: 0.5
  });
  await pass.ready;
  assert.equal(pass.format, COMPUTE_SSR_OUTPUT_FORMAT);
  assert.equal(pass.getOutputTarget().getFormat(), COMPUTE_SSR_OUTPUT_FORMAT);
  assert.equal(probe.textures.length, 5);
  assert.ok(probe.textures.every(({ format }) => format === COMPUTE_SSR_OUTPUT_FORMAT));
  assert.deepEqual(
    pass.computePass.bindings.map(({ name }) => name),
    ["params", "scene", "normal", "depth", "material", "output"]
  );
  assert.deepEqual(
    pass.roughnessPass.bindings.map(({ name }) => name),
    ["params", "rawReflection", "half", "quarter", "eighth", "material", "sampler", "output"]
  );
  const output = pass.encode(probe.commandEncoder, makeResources(), {
    cameraFrame: makeFrame()
  });
  assert.equal(output.getFormat(), COMPUTE_SSR_OUTPUT_FORMAT);

  const oldScene = makeResources();
  oldScene.scene.getFormat = () => "rgba8unorm";
  assert.throws(
    () => pass.encode(probe.commandEncoder, oldScene, { cameraFrame: makeFrame() }),
    /scene format must be rgba16float/
  );
  const wrongMaterial = makeResources();
  wrongMaterial.material.getFormat = () => "rgba16float";
  assert.throws(
    () => pass.encode(probe.commandEncoder, wrongMaterial, { cameraFrame: makeFrame() }),
    /material format must be rgba8unorm/
  );
  const wrongDepth = makeResources();
  wrongDepth.depth.depthConvention = {};
  assert.throws(
    () => pass.encode(probe.commandEncoder, wrongDepth, { cameraFrame: makeFrame() }),
    /CAMERA_REVERSE_Z depth target/
  );
  const wrongSize = makeResources();
  wrongSize.material.getHeight = () => 5;
  assert.throws(
    () => pass.encode(probe.commandEncoder, wrongSize, { cameraFrame: makeFrame() }),
    /material size 20x5 does not match scene size 20x10/
  );
  assert.throws(
    () => pass.encode(probe.commandEncoder, makeResources(), {
      cameraFrame: makeFrame(),
      view: "composite"
    }),
    /view must be one of: reflection, normal, depth/
  );
  pass.destroy();

  assert.throws(
    () => new ComputeSsrPass(probe.gpu, { format: "rgba8unorm" }),
    /format must be rgba16float/
  );
}

console.log("compute_ssr_pass_hdr_reflection_contracts: all roughness-filtered HDR contracts passed");
