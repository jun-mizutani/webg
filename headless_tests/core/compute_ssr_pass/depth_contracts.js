// ---------------------------------------------------------
// headless_tests/core/compute_ssr_pass/depth_contracts.js  2026/07/23
//   Reverse-Z depth contracts for ray and roughness-pyramid ComputeSsrPass
// ---------------------------------------------------------
import assert from "node:assert/strict";
import CameraFrame from "../../../webg/CameraFrame.js";
import ComputeSsrPass, {
  COMPUTE_SSR_WGSL
} from "../../../webg/ComputeSsrPass.js";
import { CAMERA_REVERSE_Z } from "../../../webg/DepthConvention.js";
import Matrix from "../../../webg/Matrix.js";

globalThis.GPUTextureUsage = { STORAGE_BINDING: 1, TEXTURE_BINDING: 2, COPY_SRC: 4 };
globalThis.GPUShaderStage = { COMPUTE: 1 };
globalThis.GPUBufferUsage = { UNIFORM: 1, COPY_DST: 2 };

// SSRのComputePassが作るresourceとuniform writeを記録する最小GPU環境を用意します
// ray hitの画像結果ではなく、shader契約とprojection値を再現可能な数値として検査します
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

// Geometry BufferとSSRで共有するReverse-Z Camera Frameを作ります
function makeFrame(far = 8000.0) {
  const cameraWorldMatrix = new Matrix();
  cameraWorldMatrix.position([1.0e10, 2.0e10, -3.0e10]);
  return new CameraFrame({
    cameraWorldMatrix,
    near: 0.125,
    far,
    vfov: 62.0,
    aspect: 21.0 / 9.0,
    depthConvention: CAMERA_REVERSE_Z
  });
}

// 全depth sampleは背景0を共通helperで除外し、旧通常Z比較を残しません
// rayとsceneの交差は線形化後の正のview-space距離差なので、符号判定は変更しません
{
  const backgroundChecks = COMPUTE_SSR_WGSL.match(/isGBufferBackgroundDepth\(/g) ?? [];
  assert.equal(backgroundChecks.length, 6);
  assert.doesNotMatch(COMPUTE_SSR_WGSL, /0\.999999/);
  assert.match(COMPUTE_SSR_WGSL, /previousDelta < 0\.0 && currentDelta >= 0\.0/);
  assert.match(COMPUTE_SSR_WGSL, /hitDelta >= 0\.0 && hitDelta <= thickness/);
  assert.match(COMPUTE_SSR_WGSL, /vec4f\(vec3f\(depth\), 1\.0\)/);
}

// finite farのCamera Frameからprojectionと既存SSR parameterを同じuniformへ詰めます
{
  const probe = createGpuProbe();
  const pass = new ComputeSsrPass(probe.gpu, {
    label: "v2-ssr",
    width: 20,
    height: 10,
    resolutionScale: 0.5
  });
  await pass.ready;
  const resources = {
    scene: {
      getView: () => ({}),
      getFormat: () => "rgba16float",
      getWidth: () => 20,
      getHeight: () => 10
    },
    normal: { getView: () => ({}), getWidth: () => 20, getHeight: () => 10 },
    material: {
      getView: () => ({}),
      getFormat: () => "rgba8unorm",
      getWidth: () => 20,
      getHeight: () => 10
    },
    depth: {
      depthConvention: CAMERA_REVERSE_Z,
      getDepthSampleView: () => ({}),
      getWidth: () => 20,
      getHeight: () => 10
    }
  };
  pass.encode(probe.commandEncoder, resources, {
    cameraFrame: makeFrame(),
    intensity: 0.9,
    distance: 40.0,
    thickness: 0.35,
    steps: 48,
    resolutionScale: 0.5,
    reflectivityThreshold: 0.05,
    view: "depth"
  });

  const uniforms = probe.writes.find(({ data }) => data.length === 12).data;
  assert.equal(uniforms[0], Math.fround(0.125));
  assert.equal(uniforms[1], Math.fround(8000.0));
  assert.ok(Math.abs(uniforms[2] - Math.tan(31.0 * Math.PI / 180.0)) < 1.0e-6);
  assert.equal(uniforms[3], Math.fround(21.0 / 9.0));
  assert.deepEqual(uniforms.slice(4, 12), [0.9, 40.0, 0.35, 48.0, 2.0, 0.05, 10.0, 5.0]
    .map((value) => Math.fround(value)));
  assert.deepEqual(
    probe.dispatches.map(({ x, y, z }) => [x, y, z]),
    [[2, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1], [2, 1, 1]]
  );
  pass.destroy();
}

// infinite farは0 sentinelを保持し、旧projection配列だけではencodeできません
{
  const probe = createGpuProbe();
  const pass = new ComputeSsrPass(probe.gpu);
  await pass.ready;
  const resources = {
    scene: {
      getView: () => ({}),
      getFormat: () => "rgba16float",
      getWidth: () => 1,
      getHeight: () => 1
    },
    normal: { getView: () => ({}), getWidth: () => 1, getHeight: () => 1 },
    material: {
      getView: () => ({}),
      getFormat: () => "rgba8unorm",
      getWidth: () => 1,
      getHeight: () => 1
    },
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
  assert.equal(probe.writes.find(({ data }) => data.length === 12).data[1], 0.0);
  assert.throws(() => pass.encode(probe.commandEncoder, resources, {
    projection: [0.125, 8000.0, 0.6, 21.0 / 9.0]
  }), /requires a Reverse-Z CameraFrame/);
  pass.destroy();
}

console.log("compute_ssr_pass_depth_contracts: all SSR depth contracts passed");
