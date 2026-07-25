// ---------------------------------------------------------
// headless_tests/core/shadow_map_pass/headless_probe.js  2026/07/13
//   Standard-Z generation contracts for directional and spot Shadow Maps
// ---------------------------------------------------------
import assert from "node:assert/strict";
import CameraFrame from "../../../webg/CameraFrame.js";
import {
  CAMERA_REVERSE_Z,
  projectViewDepth,
  SHADOW_STANDARD_Z
} from "../../../webg/DepthConvention.js";
import Matrix from "../../../webg/Matrix.js";
import ShadowMapPass, {
  createDirectionalLightMatrices,
  createFrustumFitDirectionalLightMatrices,
  SHADOW_MAP_DEPTH_FORMAT
} from "../../../webg/ShadowMapPass.js";
import {
  createSpotLightMatrices
} from "../../../webg/SpotShadowMapPass.js";

globalThis.GPUTextureUsage = { RENDER_ATTACHMENT: 1, TEXTURE_BINDING: 2 };
globalThis.GPUShaderStage = { VERTEX: 1 };
globalThis.GPUBufferUsage = { UNIFORM: 1, COPY_DST: 2, VERTEX: 4 };

function makeCameraFrame(far = 120.0) {
  return new CameraFrame({
    cameraWorldMatrix: new Matrix(),
    near: 0.1,
    far,
    vfov: 54.0,
    aspect: 16.0 / 9.0,
    depthConvention: CAMERA_REVERSE_Z
  });
}

// frustum-fitはReverse-Z行列を通常Zの式で逆算せず、CameraFrameの確定値を直接使用します
{
  const light = createFrustumFitDirectionalLightMatrices({
    direction: [0.46, -0.82, 0.34],
    distance: 34.0,
    cameraFrame: makeCameraFrame()
  });
  assert.equal(light.fitFar, 120.0);
  assert.ok(light.near > 0.0);
  assert.ok(light.far > light.near);
  assert.ok(light.viewProjection.mat.every(Number.isFinite));

  assert.throws(() => createFrustumFitDirectionalLightMatrices({
    direction: [0.46, -0.82, 0.34],
    distance: 34.0,
    cameraFrame: makeCameraFrame(Infinity)
  }), /requires finite fitFar/);

  const finiteFit = createFrustumFitDirectionalLightMatrices({
    direction: [0.46, -0.82, 0.34],
    distance: 34.0,
    cameraFrame: makeCameraFrame(Infinity),
    fitFar: 80.0
  });
  assert.equal(finiteFit.fitFar, 80.0);
}

// ShadowMapPassがWebGPUへ渡すpipeline、texture、render pass descriptorを記録します
// formatだけでなくcompareとclearが同じDepth Conventionから得られることを検査します
function createGpuProbe() {
  const pipelines = [];
  const textures = [];
  const renderPasses = [];
  const pass = {
    setPipeline() {},
    setBindGroup() {},
    setVertexBuffer() {},
    setIndexBuffer() {},
    drawIndexed() {},
    end() {}
  };
  const commandEncoder = {
    beginRenderPass(descriptor) {
      renderPasses.push(descriptor);
      return pass;
    }
  };
  const device = {
    createBindGroupLayout: (descriptor) => ({ descriptor }),
    createShaderModule: (descriptor) => ({ descriptor }),
    createPipelineLayout: (descriptor) => ({ descriptor }),
    createRenderPipeline(descriptor) {
      pipelines.push(descriptor);
      return { descriptor };
    },
    createBindGroup: (descriptor) => ({ descriptor }),
    createBuffer: (descriptor) => ({ descriptor, destroy() {} }),
    createTexture(descriptor) {
      textures.push(descriptor);
      return {
        descriptor,
        createView: () => ({ descriptor }),
        destroy() {}
      };
    },
    createCommandEncoder: () => commandEncoder
  };
  return {
    gpu: {
      device,
      queue: { writeBuffer() {} },
      commandEncoder,
      endPass() {}
    },
    pipelines,
    textures,
    renderPasses
  };
}

// 方向光の正射影はnearを0、farを1へ写し、中間距離を線形に分布させます
// 正射影は透視除算による非線形分布を持たないため、通常Zの基準値を直接確認します
{
  const near = 2.0;
  const far = 82.0;
  const light = createDirectionalLightMatrices({
    direction: [0.4, -1.0, 0.2],
    target: [10.0, 3.0, -7.0],
    distance: 20.0,
    halfWidth: 12.0,
    halfHeight: 8.0,
    near,
    far
  });
  assert.ok(Math.abs(light.projection.mulVector([0.0, 0.0, -near])[2] - 0.0) < 1.0e-12);
  assert.ok(Math.abs(light.projection.mulVector([0.0, 0.0, -far])[2] - 1.0) < 1.0e-12);
  assert.ok(Math.abs(light.projection.mulVector([0.0, 0.0, -42.0])[2] - 0.5) < 1.0e-12);
}

// spot lightの透視投影はSHADOW_STANDARD_Zの独立参照式とnear・中間・farで一致します
{
  const near = 0.5;
  const far = 60.0;
  const light = createSpotLightMatrices({
    position: [4.0, 8.0, 2.0],
    direction: [-0.3, -1.0, -0.2],
    near,
    far,
    fov: 70.0,
    aspect: 1.25
  });
  for (const distance of [near, 1.0, 7.5, 25.0, far]) {
    const actual = light.projection.mulVector([0.0, 0.0, -distance])[2];
    const expected = projectViewDepth(distance, near, far, SHADOW_STANDARD_Z);
    assert.ok(Math.abs(actual - expected) < 1.0e-10,
      `spot depth distance=${distance} actual=${actual} expected=${expected}`);
  }
}

// GPU resourceとrender passはdepth32float・less・clear 1を一体で使用します
{
  const probe = createGpuProbe();
  const shadow = new ShadowMapPass(probe.gpu, {
    label: "v2-shadow-standard-z",
    width: 64,
    height: 32
  });
  assert.equal(shadow.depthConvention, SHADOW_STANDARD_Z);
  assert.equal(SHADOW_MAP_DEPTH_FORMAT, SHADOW_STANDARD_Z.format);
  assert.equal(shadow.depthFormat, "depth32float");
  assert.equal(probe.textures[0].format, "depth32float");
  assert.equal(probe.pipelines[0].depthStencil.format, "depth32float");
  assert.equal(probe.pipelines[0].depthStencil.depthCompare, "less");
  assert.equal(probe.pipelines[0].depthStencil.depthWriteEnabled, true);

  const light = createDirectionalLightMatrices({
    direction: [1.0, -1.0, 1.0],
    target: [0.0, 0.0, 0.0],
    distance: 10.0,
    halfWidth: 5.0,
    halfHeight: 5.0,
    near: 1.0,
    far: 30.0
  });
  assert.equal(shadow.renderSpace({ nodes: [] }, light.viewProjection), 0);
  assert.equal(probe.renderPasses[0].depthStencilAttachment.depthClearValue, 1.0);
  assert.equal(shadow.getBindingResources().shadowDepth.depthConvention, SHADOW_STANDARD_Z);
  shadow.destroy();
}

// 旧depthFormat optionを受け付けて暗黙に固定値へ戻す互換経路は設けません
{
  const probe = createGpuProbe();
  assert.throws(() => new ShadowMapPass(probe.gpu, {
    depthFormat: "depth24plus"
  }), /depthFormat option was removed/);
}

console.log("shadow_map_pass_depth_convention_contracts: all Shadow Map generation contracts passed");
