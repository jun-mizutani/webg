// ---------------------------------------------------------
// headless_tests/core/deferred_lighting_pass/headless_probe.js  2026/07/12
//   Spot light cone and visibility contracts for DeferredLightingPass
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

// DeferredLightingPassのspot uniformとbindingを実GPUなしで観測します
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
  cameraWorldMatrix.setByEuler(18.0, -7.0, 3.0);
  cameraWorldMatrix.position([1.0e10, -2.0e10, 3.0e10]);
  return new CameraFrame({
    cameraWorldMatrix,
    near: 0.2,
    far: 5000.0,
    vfov: 60.0,
    aspect: 16.0 / 9.0,
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
    shadowVisibility: visibility,
    spotShadowVisibility: { ...visibility },
    ambientOcclusion: { ...visibility }
  };
}

// spot cone、距離減衰、shadow visibilityは別要因として一度ずつ掛けられます
{
  const wgsl = buildDeferredLightingWgsl(4);
  assert.match(wgsl, /let cone = clamp\(\(spotCos - outerCos\) \/ \(innerCos - outerCos\)/);
  assert.match(wgsl, /let attenuation = pow\(max\(1\.0 - distance \/ radius, 0\.0\), 2\.0\)/);
  assert.match(wgsl, /\* attenuation\s*\n\s*\* cone/);
  assert.match(wgsl, /\) \* spotShadowVisibility/);
  assert.doesNotMatch(wgsl, /spotShadowVisibility \* spotShadowVisibility/);
  assert.match(wgsl, /vec4f\(vec3f\(spotShadowVisibility\), 1\.0\)/);
}

// 巨大World位置のspot lightを小さいview-space位置へ変換し、方向は平行移動なしで回転します
{
  const probe = createGpuProbe();
  const pass = new DeferredLightingPass(probe.gpu, {
    label: "v2-deferred-spot",
    width: 16,
    height: 8,
    maxLights: 2
  });
  await pass.ready;
  const frame = makeFrame();
  const camera = frame.cameraWorldPosition;
  const position = [camera[0] + 5.0, camera[1] + 3.0, camera[2] - 12.0];
  const direction = [0.25, -1.0, -0.35];
  const innerCos = Math.cos(30.0 * Math.PI / 180.0);
  const outerCos = Math.cos(42.0 * Math.PI / 180.0);
  pass.encode(probe.commandEncoder, makeResources(), {
    cameraFrame: frame,
    directionalLight: null,
    spotLight: {
      position,
      direction,
      color: [1.0, 0.45, 0.2],
      radius: 25.0,
      intensity: 4.0,
      innerCos,
      outerCos
    },
    lights: [],
    view: "spotShadow"
  });
  const uniforms = probe.writes.at(-1).data;
  assert.equal(uniforms.length, 32);
  assert.deepEqual(uniforms.slice(4, 8), [0.0, 5.0, 0.0, 1.0]);
  const expectedPosition = frame.worldPointToView(position);
  for (let index = 0; index < 3; index += 1) {
    assert.ok(Math.abs(uniforms[16 + index] - expectedPosition[index]) < 1.0e-6);
  }
  assert.equal(uniforms[19], 25.0);
  const length = Math.hypot(...direction);
  const expectedDirection = frame.viewRotationMatrix.mul3x3Vector(
    direction.map((value) => value / length)
  );
  for (let index = 0; index < 3; index += 1) {
    assert.ok(Math.abs(uniforms[20 + index] - expectedDirection[index]) < 1.0e-6);
  }
  assert.equal(uniforms[23], 4.0);
  assert.deepEqual(uniforms.slice(24, 27), [1.0, 0.45, 0.2]
    .map((value) => Math.fround(value)));
  assert.ok(Math.abs(uniforms[27] - innerCos) < 1.0e-6);
  assert.ok(Math.abs(uniforms[28] - outerCos) < 1.0e-6);
  pass.destroy();
}

// spotなしはnullで明示し、cone順序、zero direction、visibility寸法を厳密に拒否します
{
  const probe = createGpuProbe();
  const pass = new DeferredLightingPass(probe.gpu, { width: 16, height: 8 });
  await pass.ready;
  const frame = makeFrame();
  pass.encode(probe.commandEncoder, makeResources(), {
    cameraFrame: frame,
    directionalLight: null,
    spotLight: null,
    lights: []
  });
  assert.equal(probe.writes.at(-1).data[7], 0.0);
  assert.throws(() => pass.encode(probe.commandEncoder, makeResources(), {
    cameraFrame: frame,
    directionalLight: null,
    lights: []
  }), /spotLight option is required/);
  const invalidBase = {
    position: [0.0, 2.0, -4.0],
    color: [1.0, 1.0, 1.0],
    radius: 10.0,
    intensity: 1.0,
    innerCos: 0.5,
    outerCos: 0.7
  };
  assert.throws(() => pass.encode(probe.commandEncoder, makeResources(), {
    cameraFrame: frame,
    directionalLight: null,
    spotLight: { ...invalidBase, direction: [0.0, -1.0, 0.0] },
    lights: []
  }), /innerCos must be greater than outerCos/);
  assert.throws(() => pass.encode(probe.commandEncoder, makeResources(), {
    cameraFrame: frame,
    directionalLight: null,
    spotLight: { ...invalidBase, direction: [0.0, 0.0, 0.0], innerCos: 0.8 },
    lights: []
  }), /direction has zero length/);
  const mismatch = makeResources();
  mismatch.spotShadowVisibility.getHeight = () => 4;
  assert.throws(() => pass.encode(probe.commandEncoder, mismatch, {
    cameraFrame: frame,
    directionalLight: null,
    spotLight: null,
    lights: []
  }), /spotShadowVisibility size 16x4 does not match/);
  pass.destroy();
}

console.log("deferred_lighting_pass_spot_visibility_contracts: all spot lighting contracts passed");
