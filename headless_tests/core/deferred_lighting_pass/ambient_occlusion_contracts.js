// ---------------------------------------------------------
// headless_tests/core/deferred_lighting_pass/headless_probe.js  2026/07/15
//   Ambient-only SSAO application contracts for DeferredLightingPass
// ---------------------------------------------------------
import assert from "node:assert/strict";
import CameraFrame from "../../../webg/CameraFrame.js";
import DeferredLightingPass, {
  buildDeferredLightingWgsl
} from "../../../webg/DeferredLightingPass.js";
import { CAMERA_REVERSE_Z } from "../../../webg/DepthConvention.js";
import Matrix from "../../../webg/Matrix.js";

globalThis.GPUTextureUsage = { STORAGE_BINDING: 1, TEXTURE_BINDING: 2, COPY_SRC: 4 };
globalThis.GPUShaderStage = { COMPUTE: 1 };
globalThis.GPUBufferUsage = { UNIFORM: 1, COPY_DST: 2, STORAGE: 4 };

// DeferredLightingPassのbindingとdebug uniformを記録する最小GPU環境を作ります
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
    far: 4000.0,
    vfov: 60.0,
    aspect: 2.0,
    depthConvention: CAMERA_REVERSE_Z
  });
}

function makeResources(width = 16, height = 8) {
  const visibility = {
    getView: () => ({}),
    getWidth: () => width,
    getHeight: () => height
  };
  return {
    albedo: { getView: () => ({}), getWidth: () => width, getHeight: () => height },
    normal: { getView: () => ({}) },
    material: { getView: () => ({}), getWidth: () => width, getHeight: () => height },
    depth: { depthConvention: CAMERA_REVERSE_Z, getDepthSampleView: () => ({}) },
    shadowVisibility: { ...visibility },
    spotShadowVisibility: { ...visibility },
    ambientOcclusion: { ...visibility }
  };
}

// WGSLと同じSchlick FresnelをCPUで評価し、材質対応ambientの不変条件を確認します
function evaluateAmbientDiffuse({
  albedo,
  specular,
  roughness,
  metallic,
  ambient,
  ambientOcclusion,
  nDotV
}) {
  const oneMinusCosine = Math.min(1.0, Math.max(0.0, 1.0 - nDotV));
  const schlickWeight = oneMinusCosine ** 5;
  return albedo.map((channel) => {
    const dielectricF0 = 0.04 * specular;
    const f0 = dielectricF0 * (1.0 - metallic) + channel * metallic;
    const ambientF90 = Math.max(1.0 - roughness, f0);
    const fresnel = f0 + (ambientF90 - f0) * schlickWeight;
    return channel * ambient * ambientOcclusion
      * (1.0 - fresnel) * (1.0 - metallic);
  });
}

// AO visibilityは材質対応ambientだけに掛かり、三種類の直接光blockでは参照されません
{
  const wgsl = buildDeferredLightingWgsl(8);
  assert.match(wgsl, /fn evaluateAmbientDiffuse\(/);
  assert.match(wgsl, /let diffuseWeight = \(vec3f\(1\.0\) - fresnel\) \* \(1\.0 - metallic\)/);
  assert.match(wgsl, /return albedo \* ambient \* ambientOcclusion \* diffuseWeight/);
  assert.match(wgsl, /var lighting = ambientDiffuse \+ albedo\.rgb \* material\.w/);
  const directionalBlock = wgsl.slice(
    wgsl.indexOf("if (params.control.z >= 0.5)"),
    wgsl.indexOf("if (params.control.w >= 0.5)")
  );
  const spotBlock = wgsl.slice(
    wgsl.indexOf("if (params.control.w >= 0.5)"),
    wgsl.indexOf("// 単純化のためpixelごとに全light")
  );
  const pointBlock = wgsl.slice(
    wgsl.indexOf("// 単純化のためpixelごとに全light"),
    wgsl.indexOf("let mapped = lighting")
  );
  for (const block of [directionalBlock, spotBlock, pointBlock]) {
    assert.doesNotMatch(block, /ambientOcclusion/);
  }
  assert.match(wgsl, /vec4f\(vec3f\(ambientOcclusion\), 1\.0\)/);

  const metallicSteps = [0.0, 0.25, 0.5, 0.75, 1.0].map((metallic) =>
    evaluateAmbientDiffuse({
      albedo: [0.48, 0.16, 0.05],
      specular: 0.6,
      roughness: 0.42,
      metallic,
      ambient: 0.1,
      ambientOcclusion: 1.0,
      nDotV: 0.65
    })
  );
  for (let step = 1; step < metallicSteps.length; step += 1) {
    for (let channel = 0; channel < 3; channel += 1) {
      assert.ok(metallicSteps[step][channel] < metallicSteps[step - 1][channel]);
    }
  }
  assert.deepEqual(metallicSteps.at(-1), [0.0, 0.0, 0.0]);
  assert.deepEqual(evaluateAmbientDiffuse({
    albedo: [0.48, 0.16, 0.05],
    specular: 0.6,
    roughness: 0.42,
    metallic: 0.0,
    ambient: 0.1,
    ambientOcclusion: 0.0,
    nDotV: 0.65
  }), [0.0, 0.0, 0.0]);
}

// AO textureは明示bindingされ、debug view 6でvisibilityそのものを観察できます
{
  const probe = createGpuProbe();
  const pass = new DeferredLightingPass(probe.gpu, {
    label: "v2-deferred-ao",
    width: 16,
    height: 8
  });
  await pass.ready;
  pass.encode(probe.commandEncoder, makeResources(), {
    cameraFrame: makeFrame(),
    directionalLight: null,
    spotLight: null,
    lights: [],
    ambient: 0.1,
    view: "ao"
  });
  const uniforms = probe.writes.at(-1).data;
  assert.equal(uniforms[5], 6.0);
  assert.equal(uniforms[15], Math.fround(0.1));
  assert.deepEqual(pass.computePass.bindings.map(({ name }) => name), [
    "params",
    "albedo",
    "normal",
    "depth",
    "material",
    "lights",
    "shadowVisibility",
    "spotShadowVisibility",
    "ambientOcclusion",
    "output"
  ]);
  pass.destroy();
}

// AO resource省略とG-buffer寸法不一致をdispatch前に検出します
{
  const probe = createGpuProbe();
  const pass = new DeferredLightingPass(probe.gpu, { width: 16, height: 8 });
  await pass.ready;
  const missing = makeResources();
  delete missing.ambientOcclusion;
  assert.throws(() => pass.encode(probe.commandEncoder, missing, {
    cameraFrame: makeFrame(),
    directionalLight: null,
    spotLight: null,
    lights: []
  }), /resources require ambientOcclusion target/);
  const mismatch = makeResources();
  mismatch.ambientOcclusion.getWidth = () => 8;
  assert.throws(() => pass.encode(probe.commandEncoder, mismatch, {
    cameraFrame: makeFrame(),
    directionalLight: null,
    spotLight: null,
    lights: []
  }), /ambientOcclusion size 8x8 does not match/);
  pass.destroy();
}

console.log("deferred_lighting_pass_ambient_occlusion_contracts: all ambient-only AO contracts passed");
