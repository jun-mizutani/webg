// ---------------------------------------------------------
// headless_tests/core/compute_shadow_pass/headless_probe.js  2026/07/12
//   Visibility-only contracts for directional and spot Shadow resolve
// ---------------------------------------------------------
import assert from "node:assert/strict";
import CameraFrame from "../../../webg/CameraFrame.js";
import ComputeShadowPass, {
  SHADOW_RESOLVE_WGSL
} from "../../../webg/ComputeShadowPass.js";
import ComputeSpotShadowPass, {
  SPOT_SHADOW_RESOLVE_WGSL
} from "../../../webg/ComputeSpotShadowPass.js";
import {
  CAMERA_REVERSE_Z,
  SHADOW_STANDARD_Z
} from "../../../webg/DepthConvention.js";
import Matrix from "../../../webg/Matrix.js";
import { createDirectionalLightMatrices } from "../../../webg/ShadowMapPass.js";
import { createSpotLightMatrices } from "../../../webg/SpotShadowMapPass.js";

globalThis.GPUTextureUsage = { STORAGE_BINDING: 1, TEXTURE_BINDING: 2, COPY_SRC: 4 };
globalThis.GPUShaderStage = { COMPUTE: 1 };
globalThis.GPUBufferUsage = { UNIFORM: 1, COPY_DST: 2 };

// visibility passのuniform writeとdispatchを観測する最小GPU環境を作ります
// albedoを渡さずにencodeできることも、照明責務が外れた契約として確認します
function createGpuProbe() {
  const writes = [];
  const bindGroups = [];
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
    createBindGroup(descriptor) {
      bindGroups.push(descriptor);
      return { descriptor };
    }
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
  return { gpu: { device, queue }, commandEncoder, writes, bindGroups };
}

function makeFrame() {
  const cameraWorldMatrix = new Matrix();
  cameraWorldMatrix.position([10000000001.0, 10000000002.0, 10000000003.0]);
  return new CameraFrame({
    cameraWorldMatrix,
    near: 0.2,
    far: 5000.0,
    vfov: 55.0,
    aspect: 16.0 / 9.0,
    depthConvention: CAMERA_REVERSE_Z
  });
}

function makeResources() {
  return {
    normal: { getView: () => ({}) },
    depth: { getDepthSampleView: () => ({}) },
    shadowDepth: {
      depthConvention: SHADOW_STANDARD_Z,
      getDepthSampleView: () => ({}),
      getWidth: () => 256,
      getHeight: () => 128
    }
  };
}

// 両WGSLはvisibilityだけを書き、albedo・ambient・diffuse・spot coneの照明責務を持ちません
{
  for (const wgsl of [SHADOW_RESOLVE_WGSL, SPOT_SHADOW_RESOLVE_WGSL]) {
    assert.match(wgsl, /vec4f\(vec3f\(visibility\), 1\.0\)/);
    assert.match(wgsl, /vec4f\(1\.0\)/);
    assert.doesNotMatch(wgsl, /albedoTexture/);
    assert.doesNotMatch(wgsl, /\bdiffuse\b/);
    assert.doesNotMatch(wgsl, /\bambient\b/);
    assert.doesNotMatch(wgsl, /\blit\b/);
  }
  assert.doesNotMatch(SPOT_SHADOW_RESOLVE_WGSL, /spotFactor/);
  assert.doesNotMatch(SPOT_SHADOW_RESOLVE_WGSL, /innerCos|outerCos/);
}

// 方向光passはnormal、camera depth、shadow depth、outputだけをbindingし、enabledをuniformへ書きます
{
  const probe = createGpuProbe();
  const pass = new ComputeShadowPass(probe.gpu, { width: 16, height: 8 });
  await pass.ready;
  assert.deepEqual(pass.computePass.bindings.map(({ name }) => name), [
    "params",
    "normal",
    "cameraDepth",
    "shadowDepth",
    "output"
  ]);
  const light = createDirectionalLightMatrices({
    direction: [0.3, -1.0, 0.2],
    target: [1.0e10, 1.0e10, 1.0e10 - 20.0],
    distance: 50.0,
    halfWidth: 20.0,
    halfHeight: 15.0,
    near: 1.0,
    far: 100.0
  });
  pass.encode(probe.commandEncoder, makeResources(), {
    cameraFrame: makeFrame(),
    lightViewProjection: light.viewProjection,
    lightDirection: light.direction,
    bias: 0.002,
    normalBias: 0.004,
    pcfRadius: 2,
    enabled: false
  });
  const uniforms = probe.writes.at(-1).data;
  assert.deepEqual(uniforms.slice(24, 28), [
    Math.fround(0.002),
    Math.fround(0.004),
    2.0,
    0.0
  ]);
  assert.deepEqual(uniforms.slice(28, 32), [256.0, 128.0, 0.0, 0.0]);
  assert.throws(() => pass.encode(probe.commandEncoder, makeResources(), {
    cameraFrame: makeFrame(),
    lightViewProjection: light.viewProjection,
    lightDirection: light.direction,
    ambient: 0.2
  }), /ambient option was removed/);
  pass.destroy();
}

// spot passはcone照明を扱わず、位置とshadow設定だけでvisibilityを生成します
{
  const probe = createGpuProbe();
  const pass = new ComputeSpotShadowPass(probe.gpu, { width: 16, height: 8 });
  await pass.ready;
  assert.deepEqual(pass.computePass.bindings.map(({ name }) => name), [
    "params",
    "normal",
    "cameraDepth",
    "shadowDepth",
    "output"
  ]);
  const lightPosition = [1.0e10 + 5.0, 1.0e10 + 8.0, 1.0e10 - 12.0];
  const light = createSpotLightMatrices({
    position: lightPosition,
    direction: [0.2, -1.0, -0.3],
    near: 0.5,
    far: 80.0,
    fov: 65.0
  });
  pass.encode(probe.commandEncoder, makeResources(), {
    cameraFrame: makeFrame(),
    lightViewProjection: light.viewProjection,
    lightPosition,
    enabled: true
  });
  const uniforms = probe.writes.at(-1).data;
  assert.equal(uniforms[27], 1.0);
  assert.deepEqual(uniforms.slice(28, 32), [256.0, 128.0, 0.0, 0.0]);
  assert.throws(() => pass.encode(probe.commandEncoder, makeResources(), {
    cameraFrame: makeFrame(),
    lightViewProjection: light.viewProjection,
    lightPosition,
    lightDirection: light.direction
  }), /lightDirection option was removed/);
  pass.destroy();
}

console.log("compute_shadow_pass_visibility_contracts: all visibility-only contracts passed");
