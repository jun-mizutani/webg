// ---------------------------------------------------------
// headless_tests/core/deferred_lighting_pass/headless_probe.js  2026/07/12
//   Linear High Dynamic Range output contract for DeferredLightingPass
// ---------------------------------------------------------
import assert from "node:assert/strict";
import CameraFrame from "../../../webg/CameraFrame.js";
import DeferredLightingPass, {
  buildDeferredLightingWgsl,
  DEFERRED_LIGHTING_OUTPUT_FORMAT
} from "../../../webg/DeferredLightingPass.js";
import { CAMERA_REVERSE_Z } from "../../../webg/DepthConvention.js";
import Matrix from "../../../webg/Matrix.js";

globalThis.GPUTextureUsage = {
  STORAGE_BINDING: 1,
  TEXTURE_BINDING: 2,
  COPY_SRC: 4
};
globalThis.GPUShaderStage = { COMPUTE: 1 };
globalThis.GPUBufferUsage = { UNIFORM: 1, COPY_DST: 2, STORAGE: 4 };

// DeferredLightingPassが作るtextureとstorage bindingを記録し、形式の不一致を検出します
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
  return { gpu: { device, queue }, textures };
}

// 照明passと同じReverse-Z投影条件を満たす最小Camera Frameを作ります
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

// encode時に必要なG-bufferとvisibility targetを同じ画面寸法で用意します
function makeResources(width, height) {
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

// shaderはrgba16floatへ線形lightingを書き、途中のReinhardとgamma変換を持ちません
{
  const wgsl = buildDeferredLightingWgsl(8);
  assert.equal(DEFERRED_LIGHTING_OUTPUT_FORMAT, "rgba16float");
  assert.match(wgsl, /texture_storage_2d<rgba16float, write>/);
  assert.match(wgsl, /vec4f\(lighting, 1\.0\)/);
  assert.doesNotMatch(wgsl, /lighting \/ \(lighting \+ vec3f\(1\.0\)\)/);
  assert.doesNotMatch(wgsl, /1\.0 \/ 2\.2/);
}

// GPU targetとComputePassのbinding formatは同じrgba16floatへ固定します
// 旧rgba8unormを明示しても受理せず、途中の表示変換へ戻る余地を残しません
{
  const probe = createGpuProbe();
  const pass = new DeferredLightingPass(probe.gpu, { width: 12, height: 6 });
  await pass.ready;
  assert.equal(pass.format, DEFERRED_LIGHTING_OUTPUT_FORMAT);
  assert.equal(pass.getOutputTarget().format, DEFERRED_LIGHTING_OUTPUT_FORMAT);
  assert.equal(probe.textures[0].format, DEFERRED_LIGHTING_OUTPUT_FORMAT);
  assert.equal(
    pass.computePass.bindings.find(({ name }) => name === "output").format,
    DEFERRED_LIGHTING_OUTPUT_FORMAT
  );
  pass.destroy();

  assert.throws(
    () => new DeferredLightingPass(probe.gpu, { format: "rgba8unorm" }),
    /format must be rgba16float/
  );
}

// debug viewを含む全出力も同じHDR targetを使い、encode結果が別形式へ分岐しないことを確認します
{
  const probe = createGpuProbe();
  const pass = new DeferredLightingPass(probe.gpu, { width: 12, height: 6 });
  await pass.ready;
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
  const result = pass.encode(commandEncoder, makeResources(12, 6), {
    cameraFrame: makeFrame(),
    directionalLight: null,
    spotLight: null,
    lights: []
  });
  assert.equal(result, pass.getOutputTarget());
  assert.equal(result.format, DEFERRED_LIGHTING_OUTPUT_FORMAT);
  pass.destroy();
}

console.log("deferred_lighting_pass_hdr_output_contracts: all linear HDR output contracts passed");
