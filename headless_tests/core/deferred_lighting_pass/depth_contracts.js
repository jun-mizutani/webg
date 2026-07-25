// ---------------------------------------------------------
// headless_tests/core/deferred_lighting_pass/headless_probe.js  2026/07/14
//   Reverse-Z and Camera Frame contracts for DeferredLightingPass
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

// ComputePassが作成するresourceとGPU writeを記録し、実GPUなしでuniform契約を検査します
// shaderの見た目ではなく、Camera Frameから生成した値がbufferへ入った事実を確認します
function createGpuProbe() {
  const writes = [];
  const shaderModules = [];
  const device = {
    createSampler: (descriptor) => ({ descriptor }),
    createTexture(descriptor) {
      return {
        descriptor,
        createView: () => ({ descriptor }),
        destroy() {}
      };
    },
    createBuffer: (descriptor) => ({ descriptor, destroy() {} }),
    createBindGroupLayout: (descriptor) => ({ descriptor }),
    createShaderModule(descriptor) {
      shaderModules.push(descriptor);
      return { descriptor };
    },
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
  return { gpu: { device, queue }, commandEncoder, writes, shaderModules };
}

// 巨大World位置を持つカメラから、通常カメラ用Reverse-Z frameを作ります
// farへInfinityを渡した場合もprojection paramが明示sentinel 0になることを後段で確認します
function makeFrame(position, far = 50000.0) {
  const cameraWorldMatrix = new Matrix();
  cameraWorldMatrix.position(position);
  return new CameraFrame({
    cameraWorldMatrix,
    near: 0.25,
    far,
    vfov: 60.0,
    aspect: 16.0 / 9.0,
    depthConvention: CAMERA_REVERSE_Z
  });
}

// shaderは背景0を共通helperで判定し、G-bufferのalbedo clear値をそのまま背景へ返します
// depth debug表示にはfinite farでしか使えないfar除算ではなくReverse-Z raw depthを使います
{
  const wgsl = buildDeferredLightingWgsl(8);
  assert.match(wgsl, /isGBufferBackgroundDepth\(depth\)/);
  assert.doesNotMatch(wgsl, /depth\s*>=\s*0\.999999/);
  assert.match(
    wgsl,
    /if \(isGBufferBackgroundDepth\(depth\)\) \{[\s\S]*?vec4f\(albedo\.rgb, 1\.0\)[\s\S]*?return;/
  );
  assert.doesNotMatch(wgsl, /mix\(vec3f\(0\.012, 0\.022, 0\.035\)/);
  assert.doesNotMatch(wgsl, /vec3f\(0\.04, 0\.07, 0\.10\)/);
  assert.match(wgsl, /vec4f\(vec3f\(depth\), 1\.0\)/);
}

// encodeは同じCamera Frameからprojection paramとWorld lightのview-space位置を生成します
// 1e10規模の絶対座標ではなく、小さな差分がGPU bufferへ書かれることを数値で確認します
{
  const probe = createGpuProbe();
  const pass = new DeferredLightingPass(probe.gpu, {
    label: "v2-deferred-lighting",
    width: 16,
    height: 8,
    maxLights: 2
  });
  await pass.ready;
  const resources = {
    albedo: { getView: () => ({}), getWidth: () => 16, getHeight: () => 8 },
    normal: { getView: () => ({}) },
    material: { getView: () => ({}), getWidth: () => 16, getHeight: () => 8 },
    depth: { depthConvention: CAMERA_REVERSE_Z, getDepthSampleView: () => ({}) },
    shadowVisibility: {
      getView: () => ({}),
      getWidth: () => 16,
      getHeight: () => 8
    },
    spotShadowVisibility: {
      getView: () => ({}),
      getWidth: () => 16,
      getHeight: () => 8
    },
    ambientOcclusion: {
      getView: () => ({}),
      getWidth: () => 16,
      getHeight: () => 8
    }
  };
  const base = [1.0e10, -2.0e10, 3.0e10];
  const frame = makeFrame(base);
  pass.encode(probe.commandEncoder, resources, {
    cameraFrame: frame,
    directionalLight: null,
    spotLight: null,
    lights: [{
      type: "point",
      position: [base[0] + 4.0, base[1] - 2.0, base[2] - 15.0],
      color: [0.2, 0.7, 1.0],
      radius: 20.0,
      intensity: 3.0
    }]
  });

  const lightWrite = probe.writes.at(-2).data;
  assert.deepEqual(lightWrite.slice(0, 16), [
    4.0, -2.0, -15.0, 20.0,
    0.2, 0.7, 1.0, 3.0,
    0.0, 0.0, -1.0, 1.0,
    0.0, 0.0, 0.0, 0.0
  ]
    .map((value) => Math.fround(value)));

  const uniformWrite = probe.writes.at(-1).data;
  assert.equal(uniformWrite[0], Math.fround(0.25));
  assert.equal(uniformWrite[1], Math.fround(50000.0));
  assert.ok(Math.abs(uniformWrite[2] - Math.tan(Math.PI / 6.0)) < 1.0e-6);
  assert.ok(Math.abs(uniformWrite[3] - 16.0 / 9.0) < 1.0e-6);
  assert.equal(uniformWrite[4], 1.0);
  pass.destroy();
}

// 無限遠projectionではfar sentinel 0をそのままuniformへ渡し、有限値へ丸めません
{
  const probe = createGpuProbe();
  const pass = new DeferredLightingPass(probe.gpu);
  await pass.ready;
  const resources = {
    color: { getView: () => ({}), getWidth: () => 1, getHeight: () => 1 },
    normal: { getView: () => ({}) },
    material: { getView: () => ({}), getWidth: () => 1, getHeight: () => 1 },
    depth: { depthConvention: CAMERA_REVERSE_Z, getDepthSampleView: () => ({}) },
    shadowVisibility: { getView: () => ({}), getWidth: () => 1, getHeight: () => 1 },
    spotShadowVisibility: { getView: () => ({}), getWidth: () => 1, getHeight: () => 1 },
    ambientOcclusion: { getView: () => ({}), getWidth: () => 1, getHeight: () => 1 }
  };
  pass.encode(probe.commandEncoder, resources, {
    cameraFrame: makeFrame([0.0, 0.0, 0.0], Infinity),
    directionalLight: null,
    spotLight: null,
    lights: []
  });
  assert.equal(probe.writes.at(-1).data[1], 0.0);
  assert.throws(() => pass.encode(probe.commandEncoder, resources, {
    cameraFrame: new Matrix(),
    directionalLight: null,
    spotLight: null,
    lights: []
  }), /requires a Reverse-Z CameraFrame/);
  pass.destroy();
}

console.log("deferred_lighting_pass_depth_contracts: all deferred lighting contracts passed");
