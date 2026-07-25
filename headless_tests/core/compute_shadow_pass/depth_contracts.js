// ---------------------------------------------------------
// headless_tests/core/compute_shadow_pass/headless_probe.js  2026/07/12
//   Camera Reverse-Z and Shadow Standard-Z resolve contracts
// ---------------------------------------------------------
import assert from "node:assert/strict";
import CameraFrame from "../../../webg/CameraFrame.js";
import ComputeShadowPass, {
  createViewToLightClip,
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
import {
  createDirectionalLightMatrices
} from "../../../webg/ShadowMapPass.js";
import {
  createSpotLightMatrices
} from "../../../webg/SpotShadowMapPass.js";

globalThis.GPUTextureUsage = { STORAGE_BINDING: 1, TEXTURE_BINDING: 2, COPY_SRC: 4 };
globalThis.GPUShaderStage = { COMPUTE: 1 };
globalThis.GPUBufferUsage = { UNIFORM: 1, COPY_DST: 2 };

// 二つのShadow resolveがGPUへ書くuniformを記録する最小環境を作ります
// 描画色ではなく、異なる二つのdepth規則とcamera-relative行列の入力値を検査します
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

// 同じ相対配置を原点付近と巨大World offsetで作れるCamera Frameを返します
function makeFrame(offset = 0.0, far = 4000.0) {
  const cameraWorldMatrix = new Matrix();
  cameraWorldMatrix.setByEuler(17.0, -6.0, 2.0);
  cameraWorldMatrix.position([offset + 1.0, offset + 2.0, offset + 3.0]);
  return new CameraFrame({
    cameraWorldMatrix,
    near: 0.125,
    far,
    vfov: 60.0,
    aspect: 16.0 / 9.0,
    depthConvention: CAMERA_REVERSE_Z
  });
}

function makeDirectionalLight(offset = 0.0) {
  return createDirectionalLightMatrices({
    direction: [0.3, -1.0, 0.2],
    target: [offset, offset, offset - 20.0],
    distance: 50.0,
    halfWidth: 20.0,
    halfHeight: 15.0,
    near: 1.0,
    far: 100.0
  });
}

// G-bufferの背景はcamera Reverse-Zの0、Shadow Map比較は通常Zのreceiver <= storedです
// raw depth同士の規則を混ぜず、背景では遮蔽なしを表すvisibility 1を返します
{
  for (const wgsl of [SHADOW_RESOLVE_WGSL, SPOT_SHADOW_RESOLVE_WGSL]) {
    assert.match(wgsl, /isGBufferBackgroundDepth\(cameraDepth\)/);
    assert.doesNotMatch(wgsl, /0\.999999/);
    assert.match(wgsl, /receiverDepth <= storedDepth/);
    assert.match(wgsl, /textureStore\(outputTexture, coord, vec4f\(1\.0\)\)/);
    assert.match(wgsl, /viewToLightClip/);
    assert.doesNotMatch(wgsl, /cameraWorld\s*:/);
  }
}

// CPU倍精度でlightViewProjectionとcameraWorldを合成すると、巨大offsetがGPU入力前に相殺されます
// 原点付近と100億offsetの結果差は、binary64計算の小さな誤差内に収まることを確認します
{
  const origin = createViewToLightClip(makeFrame(), makeDirectionalLight().viewProjection);
  const offset = 1.0e10;
  const huge = createViewToLightClip(
    makeFrame(offset),
    makeDirectionalLight(offset).viewProjection
  );
  for (let index = 0; index < 16; index += 1) {
    assert.ok(Math.abs(origin.mat[index] - huge.mat[index]) < 1.0e-6,
      `viewToLightClip[${index}] origin=${origin.mat[index]} huge=${huge.mat[index]}`);
  }
}

function makeResources(shadowDepthConvention = SHADOW_STANDARD_Z) {
  return {
    albedo: { getView: () => ({}) },
    normal: { getView: () => ({}) },
    depth: { getDepthSampleView: () => ({}) },
    shadowDepth: {
      depthConvention: shadowDepthConvention,
      getDepthSampleView: () => ({}),
      getWidth: () => 128,
      getHeight: () => 64
    }
  };
}

// 方向光resolveはCamera Frame projection、合成済み行列、view-space方向をuniformへ書きます
{
  const probe = createGpuProbe();
  const pass = new ComputeShadowPass(probe.gpu, { width: 8, height: 4 });
  await pass.ready;
  const frame = makeFrame(1.0e10);
  const light = makeDirectionalLight(1.0e10);
  pass.encode(probe.commandEncoder, makeResources(), {
    cameraFrame: frame,
    lightViewProjection: light.viewProjection,
    lightDirection: light.direction
  });
  const uniforms = probe.writes.at(-1).data;
  const expectedMatrix = createViewToLightClip(frame, light.viewProjection).mat;
  assert.equal(uniforms[0], Math.fround(frame.near));
  assert.equal(uniforms[1], Math.fround(frame.far));
  for (let index = 0; index < 16; index += 1) {
    assert.ok(Math.abs(uniforms[4 + index] - expectedMatrix[index]) < 1.0e-5);
  }
  assert.deepEqual(uniforms.slice(28, 30), [128.0, 64.0]);
  assert.throws(() => pass.encode(probe.commandEncoder, makeResources(CAMERA_REVERSE_Z), {
    cameraFrame: frame,
    lightViewProjection: light.viewProjection,
    lightDirection: light.direction
  }), /shadowDepth must use SHADOW_STANDARD_Z/);
  pass.destroy();
}

// spot resolveは巨大World light位置をCamera Frameで小さいview-space位置へ変換します
{
  const probe = createGpuProbe();
  const pass = new ComputeSpotShadowPass(probe.gpu, { width: 8, height: 4 });
  await pass.ready;
  const offset = 1.0e10;
  const frame = makeFrame(offset, Infinity);
  const lightPosition = [offset + 5.0, offset + 7.0, offset - 9.0];
  const light = createSpotLightMatrices({
    position: lightPosition,
    direction: [0.2, -1.0, -0.3],
    near: 0.5,
    far: 80.0,
    fov: 65.0
  });
  pass.encode(probe.commandEncoder, makeResources(), {
    cameraFrame: frame,
    lightViewProjection: light.viewProjection,
    lightPosition
  });
  const uniforms = probe.writes.at(-1).data;
  const expectedPosition = frame.worldPointToView(lightPosition);
  assert.equal(uniforms[1], 0.0);
  for (let index = 0; index < 3; index += 1) {
    assert.ok(Math.abs(uniforms[20 + index] - expectedPosition[index]) < 1.0e-5);
  }
  assert.deepEqual(uniforms.slice(28, 30), [128.0, 64.0]);
  pass.destroy();
}

console.log("compute_shadow_pass_depth_contracts: all mixed depth and camera-relative contracts passed");
