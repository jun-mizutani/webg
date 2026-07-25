// ---------------------------------------------------------
// headless_tests/core/deferred_lighting_pass/headless_probe.js  2026/07/15
//   Shared GGX material contracts for DeferredLightingPass
// ---------------------------------------------------------
import assert from "node:assert/strict";
import CameraFrame from "../../../webg/CameraFrame.js";
import DeferredLightingPass, {
  buildDeferredLightingWgsl
} from "../../../webg/DeferredLightingPass.js";
import { CAMERA_REVERSE_Z } from "../../../webg/DepthConvention.js";
import GeometryBufferPass, {
  GBUFFER_MIN_ROUGHNESS
} from "../../../webg/GeometryBufferPass.js";
import Matrix from "../../../webg/Matrix.js";

globalThis.GPUTextureUsage = {
  STORAGE_BINDING: 1,
  TEXTURE_BINDING: 2,
  COPY_SRC: 4,
  RENDER_ATTACHMENT: 8,
  COPY_DST: 16
};
globalThis.GPUShaderStage = { COMPUTE: 1, VERTEX: 2, FRAGMENT: 4 };
globalThis.GPUBufferUsage = { UNIFORM: 1, COPY_DST: 2, STORAGE: 4, VERTEX: 8 };

// DeferredLightingPassのmaterial bindingとdebug uniformを記録します
function createGpuProbe() {
  const writes = [];
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
    createRenderPipeline: (descriptor) => ({ descriptor }),
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
        dispatchWorkgroups() {},
        end() {}
      };
    }
  };
  return { gpu: { device, queue }, commandEncoder, writes };
}

function makeFrame() {
  const cameraWorldMatrix = new Matrix();
  cameraWorldMatrix.position([1.0e10, -2.0e10, 3.0e10]);
  return new CameraFrame({
    cameraWorldMatrix,
    near: 0.2,
    far: 5000.0,
    vfov: 60.0,
    aspect: 2.0,
    depthConvention: CAMERA_REVERSE_Z
  });
}

function makeResources(width = 16, height = 8) {
  const sampled = {
    getView: () => ({}),
    getWidth: () => width,
    getHeight: () => height
  };
  return {
    albedo: { ...sampled },
    normal: { getView: () => ({}) },
    material: { ...sampled },
    depth: { depthConvention: CAMERA_REVERSE_Z, getDepthSampleView: () => ({}) },
    shadowVisibility: { ...sampled },
    spotShadowVisibility: { ...sampled },
    ambientOcclusion: { ...sampled }
  };
}

// 一つのGGX系関数をpoint、directional、spotの三種類が共有します
{
  const wgsl = buildDeferredLightingWgsl(8);
  const calls = wgsl.match(/evaluateDirectBrdf\(/g) ?? [];
  assert.equal(calls.length, 4);
  assert.match(wgsl, /let distribution = alphaSquared/);
  assert.match(wgsl, /let geometry = geometryView \* geometryLight/);
  assert.match(wgsl, /fn schlickWeight\(cosine : f32\) -> f32/);
  assert.match(wgsl, /let fresnel = f0 \+ \(vec3f\(1\.0\) - f0\) \* schlickWeight\(vDotH\)/);
  assert.match(wgsl, /let diffuseBrdf = \(vec3f\(1\.0\) - fresnel\) \* \(1\.0 - metallic\)/);
  assert.doesNotMatch(wgsl, /pow\(max\(dot\([^\n]+\), 0\.0\), 32\.0\)/);
  assert.doesNotMatch(wgsl, /specular \* 0\.18/);
  assert.doesNotMatch(wgsl, /pow\(1\.0 - vDotH, 5\.0\)/);
  assert.doesNotMatch(wgsl, /max\(material\.y/);
}

// G-buffer roughness下限はshader内clampではなくCPU material検証として固定します
{
  assert.equal(GBUFFER_MIN_ROUGHNESS, 0.04);
  const probe = createGpuProbe();
  const pass = new GeometryBufferPass(probe.gpu);
  await pass.ready;
  assert.throws(() => pass.packMaterial({
    albedo: [0.5, 0.5, 0.5],
    specular: 0.5,
    roughness: 0.039,
    metallic: 0.0,
    emissive: 0.0
  }), /roughness must be >= 0\.04/);
  assert.equal(pass.packMaterial({
    albedo: [0.5, 0.5, 0.5],
    specular: 0.5,
    roughness: 0.04,
    metallic: 0.0,
    emissive: 0.0
  })[5], Math.fround(0.04));
  pass.destroy();
}

// material textureを明示bindingし、各channelのdebug view番号を固定します
{
  const probe = createGpuProbe();
  const pass = new DeferredLightingPass(probe.gpu, { width: 16, height: 8 });
  await pass.ready;
  for (const [view, expectedMode] of [
    ["specular", 7.0],
    ["roughness", 8.0],
    ["metallic", 9.0],
    ["emissive", 10.0]
  ]) {
    pass.encode(probe.commandEncoder, makeResources(), {
      cameraFrame: makeFrame(),
      directionalLight: null,
      spotLight: null,
      lights: [],
      view
    });
    assert.equal(probe.writes.at(-1).data[5], expectedMode);
  }
  assert.ok(pass.computePass.bindings.some(({ name }) => name === "material"));
  const missing = makeResources();
  delete missing.material;
  assert.throws(() => pass.encode(probe.commandEncoder, missing, {
    cameraFrame: makeFrame(),
    directionalLight: null,
    spotLight: null,
    lights: []
  }), /resources require material target/);
  const mismatch = makeResources();
  mismatch.material.getHeight = () => 4;
  assert.throws(() => pass.encode(probe.commandEncoder, mismatch, {
    cameraFrame: makeFrame(),
    directionalLight: null,
    spotLight: null,
    lights: []
  }), /material size 16x4 does not match/);
  pass.destroy();
}

console.log("deferred_lighting_pass_material_brdf_contracts: all shared material BRDF contracts passed");
