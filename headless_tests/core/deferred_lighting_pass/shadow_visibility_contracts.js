// ---------------------------------------------------------
// headless_tests/core/deferred_lighting_pass/headless_probe.js  2026/07/15
//   Directional light and shadow visibility contracts for DeferredLightingPass
// ---------------------------------------------------------
import assert from "node:assert/strict";
import CameraFrame from "../../../webg/CameraFrame.js";
import DeferredLightingPass, {
  buildDeferredLightingWgsl,
  DEFERRED_LIGHTING_DEFAULTS,
  DEFERRED_LIGHTING_VIEW_MODES
} from "../../../webg/DeferredLightingPass.js";
import {
  CAMERA_REVERSE_Z,
  SHADOW_STANDARD_Z
} from "../../../webg/DepthConvention.js";
import Matrix from "../../../webg/Matrix.js";

globalThis.GPUTextureUsage = { STORAGE_BINDING: 1, TEXTURE_BINDING: 2, COPY_SRC: 4 };
globalThis.GPUShaderStage = { COMPUTE: 1 };
globalThis.GPUBufferUsage = { UNIFORM: 1, COPY_DST: 2, STORAGE: 4 };

// DeferredLightingPassが作るuniformとbind groupを記録し、方向光のview変換を数値確認します
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
  cameraWorldMatrix.setByEuler(25.0, -10.0, 4.0);
  cameraWorldMatrix.position([1.0e10, -2.0e10, 3.0e10]);
  return new CameraFrame({
    cameraWorldMatrix,
    near: 0.2,
    far: 6000.0,
    vfov: 60.0,
    aspect: 16.0 / 9.0,
    depthConvention: CAMERA_REVERSE_Z
  });
}

function makeResources(width = 16, height = 8, depthConvention = CAMERA_REVERSE_Z) {
  return {
    albedo: { getView: () => ({}), getWidth: () => width, getHeight: () => height },
    normal: { getView: () => ({}) },
    material: { getView: () => ({}), getWidth: () => width, getHeight: () => height },
    depth: { depthConvention, getDepthSampleView: () => ({}) },
    shadowVisibility: {
      getView: () => ({}),
      getWidth: () => width,
      getHeight: () => height
    },
    spotShadowVisibility: {
      getView: () => ({}),
      getWidth: () => width,
      getHeight: () => height
    },
    ambientOcclusion: {
      getView: () => ({}),
      getWidth: () => width,
      getHeight: () => height
    }
  };
}

// 公開既定値とdebug viewへshadow visibilityを追加した契約を確認します
{
  assert.deepEqual(DEFERRED_LIGHTING_DEFAULTS, {
    maxLights: 128,
    ambient: 0.035,
    view: "lighting"
  });
  assert.deepEqual(DEFERRED_LIGHTING_VIEW_MODES, [
    "lighting",
    "albedo",
    "normal",
    "depth",
    "shadow",
    "spotShadow",
    "ao",
    "specular",
    "roughness",
    "metallic",
    "emissive"
  ]);
}

// Shadow visibilityは方向光の直接拡散・鏡面反射だけへ掛かり、ambient項の外側に置かれます
{
  const wgsl = buildDeferredLightingWgsl(8);
  assert.match(wgsl, /shadowVisibilityTexture/);
  assert.match(wgsl, /let ambientDiffuse = evaluateAmbientDiffuse\(/);
  assert.match(wgsl, /var lighting = ambientDiffuse \+ albedo\.rgb \* material\.w/);
  assert.match(wgsl, /evaluateDirectBrdf\([\s\S]*?radiance\s*\n\s*\) \* shadowVisibility/);
  const ambientBlock = wgsl.slice(
    wgsl.indexOf("let ambientDiffuse = evaluateAmbientDiffuse("),
    wgsl.indexOf("if (params.control.z >= 0.5)")
  );
  assert.doesNotMatch(ambientBlock, /shadowVisibility/);
  assert.match(wgsl, /vec4f\(vec3f\(shadowVisibility\), 1\.0\)/);
}

// directional World方向はCamera Frameのview-spaceへ回転され、色・強度・ambientとともにuniformへ入ります
{
  const probe = createGpuProbe();
  const pass = new DeferredLightingPass(probe.gpu, {
    label: "v2-deferred-directional",
    width: 16,
    height: 8,
    maxLights: 4
  });
  await pass.ready;
  const frame = makeFrame();
  const direction = [0.35, -1.0, 0.25];
  pass.encode(probe.commandEncoder, makeResources(), {
    cameraFrame: frame,
    directionalLight: {
      direction,
      color: [1.0, 0.8, 0.6],
      intensity: 2.5
    },
    spotLight: null,
    ambient: 0.08,
    lights: [],
    view: "shadow"
  });
  const uniforms = probe.writes.at(-1).data;
  assert.equal(uniforms.length, 32);
  assert.deepEqual(uniforms.slice(4, 8), [0.0, 4.0, 1.0, 0.0]);
  const length = Math.hypot(...direction);
  const expectedDirection = frame.viewRotationMatrix.mul3x3Vector(
    direction.map((value) => value / length)
  );
  for (let index = 0; index < 3; index += 1) {
    assert.ok(Math.abs(uniforms[8 + index] - expectedDirection[index]) < 1.0e-6);
  }
  assert.equal(uniforms[11], Math.fround(2.5));
  assert.deepEqual(uniforms.slice(12, 16), [1.0, 0.8, 0.6, 0.08]
    .map((value) => Math.fround(value)));
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

// directional lightなしはnullで明示し、省略や誤Depth Convention、寸法不一致を拒否します
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
  assert.equal(probe.writes.at(-1).data[6], 0.0);
  assert.throws(() => pass.encode(probe.commandEncoder, makeResources(), {
    cameraFrame: frame,
    spotLight: null,
    lights: []
  }), /directionalLight option is required/);
  assert.throws(() => pass.encode(
    probe.commandEncoder,
    makeResources(16, 8, SHADOW_STANDARD_Z),
    { cameraFrame: frame, directionalLight: null, spotLight: null, lights: [] }
  ), /depth target must use CAMERA_REVERSE_Z/);
  const mismatched = makeResources();
  mismatched.shadowVisibility.getWidth = () => 8;
  assert.throws(() => pass.encode(probe.commandEncoder, mismatched, {
    cameraFrame: frame,
    directionalLight: null,
    spotLight: null,
    lights: []
  }), /shadowVisibility size 8x8 does not match/);
  pass.destroy();
}

console.log("deferred_lighting_pass_shadow_visibility_contracts: all directional visibility contracts passed");
