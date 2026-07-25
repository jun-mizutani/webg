import assert from "node:assert/strict";
import ComputeFogPass, {
  COMPUTE_FOG_FORMAT,
  COMPUTE_FOG_WGSL
} from "../../../webg/ComputeFogPass.js";
import { CAMERA_REVERSE_Z } from "../../../webg/DepthConvention.js";

globalThis.GPUTextureUsage = { STORAGE_BINDING: 1, TEXTURE_BINDING: 2, COPY_SRC: 4 };
globalThis.GPUShaderStage = { COMPUTE: 1 };
globalThis.GPUBufferUsage = { UNIFORM: 1, COPY_DST: 2 };

function createGpuProbe() {
  const textures = [];
  const writes = [];
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
  const queue = {
    writeBuffer(buffer, offset, data) {
      writes.push({ buffer, offset, data: Array.from(data) });
    }
  };
  const commandEncoder = {
    beginComputePass() {
      return {
        setPipeline() {}, setBindGroup() {}, dispatchWorkgroups() {}, end() {}
      };
    }
  };
  return { gpu: { device, queue }, commandEncoder, textures, writes };
}

function makeScene(width = 16, height = 8, format = COMPUTE_FOG_FORMAT) {
  return {
    getView: () => ({}),
    getFormat: () => format,
    getWidth: () => width,
    getHeight: () => height
  };
}

function makeDepth(width = 16, height = 8, convention = CAMERA_REVERSE_Z) {
  return {
    depthConvention: convention,
    getDepthSampleView: () => ({}),
    getWidth: () => width,
    getHeight: () => height
  };
}

function makeFrame() {
  return {
    depthConvention: CAMERA_REVERSE_Z,
    near: 0.1,
    far: 1000,
    infiniteFar: false,
    vfov: 60,
    aspect: 2
  };
}

function fogVisibility(distance, options) {
  if (options.mode === "linear") {
    const range = Math.max(options.far - options.near, 0.0001);
    const linear = Math.max(0, Math.min(1, (options.far - distance) / range));
    const weight = Math.max(0, Math.min(1, options.density * 50));
    return 1 - (1 - linear) * weight;
  }
  return Math.max(0, Math.min(1, Math.exp(-options.density * distance)));
}

// linearとexpはSmoothShaderと同じ距離fog式を使います。
{
  assert.equal(fogVisibility(20, { mode: "linear", near: 20, far: 80, density: 0.03 }), 1);
  assert.equal(fogVisibility(80, { mode: "linear", near: 20, far: 80, density: 0.03 }), 0);
  assert.ok(Math.abs(fogVisibility(40, { mode: "exp", density: 0.03 }) - Math.exp(-1.2)) < 1e-12);
}

// HDRを維持し、背景depthでは透明合成済みsceneを変更しません。
{
  assert.equal(COMPUTE_FOG_FORMAT, "rgba16float");
  assert.match(COMPUTE_FOG_WGSL, /texture_storage_2d<rgba16float, write>/);
  assert.match(COMPUTE_FOG_WGSL, /isGBufferBackgroundDepth\(depth\)/);
  assert.match(COMPUTE_FOG_WGSL, /reconstructGBufferViewPosition/);
  assert.match(COMPUTE_FOG_WGSL, /textureStore\(outputTexture, coord, scene\)/);
  assert.doesNotMatch(COMPUTE_FOG_WGSL, /clamp\(scene\.rgb/);
}

// scene、Reverse-Z depth、CameraFrameを検証し、fog値をuniformへそのまま渡します。
{
  const probe = createGpuProbe();
  const pass = new ComputeFogPass(probe.gpu, { width: 16, height: 8 });
  await pass.ready;
  const scene = makeScene();
  const depth = makeDepth();
  const output = pass.encode(probe.commandEncoder, { scene, depth }, {
    cameraFrame: makeFrame(),
    color: [0.2, 0.3, 0.4],
    near: 12,
    far: 120,
    density: 0.02,
    mode: "exp",
    enabled: true
  });
  assert.equal(output.getFormat(), COMPUTE_FOG_FORMAT);
  assert.equal(probe.textures[0].format, COMPUTE_FOG_FORMAT);
  assert.deepEqual(
    probe.writes.at(-1).data.slice(4, 12),
    [0.2, 0.3, 0.4, 0, 12, 120, 0.02, 2].map((value) => Math.fround(value))
  );
  assert.throws(
    () => pass.encode(probe.commandEncoder, { scene: makeScene(16, 8, "rgba8unorm"), depth }, {
      cameraFrame: makeFrame()
    }),
    /scene format must be rgba16float/
  );
  assert.throws(
    () => pass.encode(probe.commandEncoder, { scene, depth: makeDepth(16, 8, {}) }, {
      cameraFrame: makeFrame()
    }),
    /CAMERA_REVERSE_Z depth target/
  );
  assert.throws(
    () => pass.encode(probe.commandEncoder, { scene, depth }, {
      cameraFrame: makeFrame(), near: 50, far: 50
    }),
    /far must be greater than near/
  );
  assert.throws(
    () => pass.encode(probe.commandEncoder, { scene, depth }, {
      cameraFrame: makeFrame(), mode: "height"
    }),
    /mode must be one of: linear, exp/
  );
  pass.destroy();
}

console.log("compute_fog_pass_hdr_depth_contracts: all fog contracts passed");
