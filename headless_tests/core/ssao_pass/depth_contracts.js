// ---------------------------------------------------------
// headless_tests/core/ssao_pass/headless_probe.js  2026/07/12
//   Reverse-Z depth contracts for SsaoPass
// ---------------------------------------------------------
import assert from "node:assert/strict";
import CameraFrame from "../../../webg/CameraFrame.js";
import { CAMERA_REVERSE_Z } from "../../../webg/DepthConvention.js";
import Matrix from "../../../webg/Matrix.js";
import SsaoPass, {
  SSAO_BILATERAL_WGSL,
  SSAO_WGSL
} from "../../../webg/SsaoPass.js";

globalThis.GPUTextureUsage = { STORAGE_BINDING: 1, TEXTURE_BINDING: 2, COPY_SRC: 4 };
globalThis.GPUShaderStage = { COMPUTE: 1 };
globalThis.GPUBufferUsage = { UNIFORM: 1, COPY_DST: 2 };

// 二段のComputePassが書くuniformとdispatchを記録する最小GPU環境を作ります
// 実GPUの画像比較に依存せず、SSAOとbilateral合成が同じprojectionを使うことを確認します
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

// Camera Frameを作り、Geometry BufferとSSAOが共有するprojection情報を一箇所へ集約します
function makeFrame(far = 2000.0) {
  const cameraWorldMatrix = new Matrix();
  cameraWorldMatrix.position([1.0e9, -2.0e9, 3.0e9]);
  return new CameraFrame({
    cameraWorldMatrix,
    near: 0.2,
    far,
    vfov: 50.0,
    aspect: 16.0 / 10.0,
    depthConvention: CAMERA_REVERSE_Z
  });
}

// raw AOとbilateralの双方で背景0だけを除外し、通常Zの1付近比較を残しません
{
  for (const wgsl of [SSAO_WGSL, SSAO_BILATERAL_WGSL]) {
    assert.match(wgsl, /isGBufferBackgroundDepth/);
    assert.doesNotMatch(wgsl, /0\.999999/);
  }
  assert.match(SSAO_WGSL, /!isGBufferBackgroundDepth\(sampleDepth\)/);
  assert.match(SSAO_BILATERAL_WGSL, /!isGBufferBackgroundDepth\(sampleDepth\)/);
}

// 一つのCamera Frameから作ったprojectionがraw AOとbilateralの両uniformへ入ります
{
  const probe = createGpuProbe();
  const pass = new SsaoPass(probe.gpu, {
    label: "v2-ssao",
    width: 20,
    height: 10,
    resolutionScale: 0.5
  });
  await pass.ready;
  const resources = {
    normal: { getView: () => ({}), getWidth: () => 20, getHeight: () => 10 },
    depth: {
      depthConvention: CAMERA_REVERSE_Z,
      getDepthSampleView: () => ({}),
      getWidth: () => 20,
      getHeight: () => 10
    }
  };
  pass.encode(probe.commandEncoder, resources, {
    cameraFrame: makeFrame(),
    radius: 24.0,
    strength: 1.25,
    bias: 0.04,
    samples: 12,
    enabled: true
  });

  const rawUniform = probe.writes.at(-2).data;
  const bilateralUniform = probe.writes.at(-1).data;
  const projection = rawUniform.slice(4, 8);
  assert.equal(projection[0], Math.fround(0.2));
  assert.equal(projection[1], Math.fround(2000.0));
  assert.ok(Math.abs(projection[2] - Math.tan(25.0 * Math.PI / 180.0)) < 1.0e-6);
  assert.equal(projection[3], Math.fround(1.6));
  assert.deepEqual(bilateralUniform.slice(0, 4), projection);
  assert.deepEqual(probe.dispatches.map(({ x, y, z }) => [x, y, z]), [
    [2, 1, 1],
    [3, 2, 1]
  ]);
  pass.destroy();
}

// 無限遠はfarを有限値へ補正せずsentinel 0とし、旧projection配列は受け付けません
{
  const probe = createGpuProbe();
  const pass = new SsaoPass(probe.gpu);
  await pass.ready;
  const resources = {
    normal: { getView: () => ({}), getWidth: () => 1, getHeight: () => 1 },
    depth: {
      depthConvention: CAMERA_REVERSE_Z,
      getDepthSampleView: () => ({}),
      getWidth: () => 1,
      getHeight: () => 1
    }
  };
  pass.encode(probe.commandEncoder, resources, {
    cameraFrame: makeFrame(Infinity)
  });
  assert.equal(probe.writes.at(-2).data[5], 0.0);
  assert.equal(probe.writes.at(-1).data[1], 0.0);
  assert.throws(() => pass.encode(probe.commandEncoder, resources, {
    projection: [0.2, 2000.0, 0.5, 1.6]
  }), /requires a Reverse-Z CameraFrame/);
  pass.destroy();
}

console.log("ssao_pass_depth_contracts: all SSAO depth contracts passed");
