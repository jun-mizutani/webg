// ---------------------------------------------------------
// headless_tests/core/compute_effect_composer/headless_probe.js  2026/09/23
//   Linear High Dynamic Range reflection composition contract
// ---------------------------------------------------------
import assert from "node:assert/strict";
import CameraFrame from "../../../webg/CameraFrame.js";
import ComputeEffectComposer, {
  COMPUTE_EFFECT_COMPOSER_FORMAT,
  COMPUTE_EFFECT_COMPOSER_WGSL
} from "../../../webg/ComputeEffectComposer.js";
import { CAMERA_REVERSE_Z } from "../../../webg/DepthConvention.js";
import Matrix from "../../../webg/Matrix.js";

globalThis.GPUTextureUsage = { STORAGE_BINDING: 1, TEXTURE_BINDING: 2, COPY_SRC: 4 };
globalThis.GPUShaderStage = { COMPUTE: 1 };
globalThis.GPUBufferUsage = { UNIFORM: 1, COPY_DST: 2 };

// Composerが作るtargetとuniform writeを記録します
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
    writeTexture() {},
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

// full resolution base/depthと低解像度を許すSSR reflectionを作ります
function makeResources(width = 16, height = 8, reflectionWidth = 8, reflectionHeight = 4) {
  return {
    base: {
      getView: () => ({}),
      getFormat: () => COMPUTE_EFFECT_COMPOSER_FORMAT,
      getWidth: () => width,
      getHeight: () => height
    },
    reflection: {
      getView: () => ({}),
      getFormat: () => COMPUTE_EFFECT_COMPOSER_FORMAT,
      getWidth: () => reflectionWidth,
      getHeight: () => reflectionHeight
    },
    depth: {
      depthConvention: CAMERA_REVERSE_Z,
      getDepthSampleView: () => ({}),
      getWidth: () => width,
      getHeight: () => height
    }
  };
}

// PBR SSR置換に必要な同解像度G-buffer、鏡面IBL、BRDF LUTをlegacy resourceへ追加します
function makePbrResources() {
  const resources = makeResources();
  const fullSizeTarget = {
    getView: () => ({}),
    getWidth: () => 16,
    getHeight: () => 8
  };
  return {
    ...resources,
    specularIbl: { ...fullSizeTarget, getFormat: () => "rgba16float" },
    albedo: fullSizeTarget,
    normal: fullSizeTarget,
    material: fullSizeTarget,
    ambientOcclusion: fullSizeTarget,
    brdfLut: { getView: () => ({}) },
    brdfSampler: {}
  };
}

// ComposerとG-bufferで同じReverse-Z投影を使うための固定Camera Frameを作ります
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

// shaderはReverse-Z geometry上だけ反射を合成し、High Dynamic Range値をclampしません
{
  assert.equal(COMPUTE_EFFECT_COMPOSER_FORMAT, "rgba16float");
  assert.match(COMPUTE_EFFECT_COMPOSER_WGSL, /texture_storage_2d<rgba16float, write>/);
  assert.match(COMPUTE_EFFECT_COMPOSER_WGSL, /!isGBufferBackgroundDepth\(depth\)/);
  assert.doesNotMatch(COMPUTE_EFFECT_COMPOSER_WGSL, /depth < 0\.999999/);
  assert.match(COMPUTE_EFFECT_COMPOSER_WGSL, /linearColor = base \+ reflection\.rgb \* reflectionWeight/);
  assert.match(COMPUTE_EFFECT_COMPOSER_WGSL, /linearColor = mix\(base, reflection\.rgb, reflectionWeight\)/);
  assert.match(COMPUTE_EFFECT_COMPOSER_WGSL, /let baseWithoutSpecularIbl = max\(base - specularIbl, vec3f\(0\.0\)\)/);
  assert.match(COMPUTE_EFFECT_COMPOSER_WGSL, /let replacedColor = baseWithoutSpecularIbl \+ ssrSpecular/);
  assert.match(COMPUTE_EFFECT_COMPOSER_WGSL, /linearColor = mix\(base, replacedColor, confidence\)/);
  assert.match(COMPUTE_EFFECT_COMPOSER_WGSL, /pbrEvaluateSpecularIblWeight/);
  assert.match(COMPUTE_EFFECT_COMPOSER_WGSL, /reflectionWeight \* params\.control\.y/);
  assert.match(COMPUTE_EFFECT_COMPOSER_WGSL, /vec4f\(linearColor, 1\.0\)/);
  assert.doesNotMatch(COMPUTE_EFFECT_COMPOSER_WGSL, /clamp\(linearColor/);
}

// base、reflection、outputは同じHDR形式を共有し、reflectionだけ低解像度を許可します
{
  const probe = createGpuProbe();
  const pass = new ComputeEffectComposer(probe.gpu, { width: 16, height: 8 });
  await pass.ready;
  assert.equal(pass.format, COMPUTE_EFFECT_COMPOSER_FORMAT);
  assert.equal(pass.getOutputTarget().getFormat(), COMPUTE_EFFECT_COMPOSER_FORMAT);
  assert.equal(probe.textures[0].format, COMPUTE_EFFECT_COMPOSER_FORMAT);
  assert.equal(
    pass.computePass.bindings.find(({ name }) => name === "output").format,
    COMPUTE_EFFECT_COMPOSER_FORMAT
  );
  const output = pass.encode(probe.commandEncoder, makeResources(), { mode: "add" });
  assert.equal(output.getFormat(), COMPUTE_EFFECT_COMPOSER_FORMAT);
  assert.equal(probe.writes.at(-1).data[0], 0.0);
  pass.encode(probe.commandEncoder, makeResources(), { mode: "mix" });
  assert.equal(probe.writes.at(-1).data[0], 1.0);
  pass.encode(probe.commandEncoder, makePbrResources(), {
    mode: "pbr-ssr",
    intensity: 1.25,
    cameraFrame: makeFrame()
  });
  assert.equal(probe.writes.at(-1).data[0], 2.0);
  assert.equal(probe.writes.at(-1).data[1], 1.25);
  assert.throws(
    () => pass.encode(probe.commandEncoder, makeResources(), {
      mode: "pbr-ssr",
      cameraFrame: makeFrame()
    }),
    /pbr-ssr resources require specularIbl target/
  );

  const oldBase = makeResources();
  oldBase.base.getFormat = () => "rgba8unorm";
  assert.throws(
    () => pass.encode(probe.commandEncoder, oldBase),
    /base format must be rgba16float/
  );
  const oldReflection = makeResources();
  oldReflection.reflection.getFormat = () => "rgba8unorm";
  assert.throws(
    () => pass.encode(probe.commandEncoder, oldReflection),
    /reflection format must be rgba16float/
  );
  const wrongDepth = makeResources();
  wrongDepth.depth.depthConvention = {};
  assert.throws(
    () => pass.encode(probe.commandEncoder, wrongDepth),
    /CAMERA_REVERSE_Z depth target/
  );
  assert.throws(
    () => pass.encode(probe.commandEncoder, makeResources(8, 8)),
    /base size 8x8 does not match output size 16x8/
  );
  assert.throws(
    () => pass.encode(probe.commandEncoder, makeResources(16, 8, 0, 4)),
    /reflection width must be >= 1/
  );
  pass.destroy();

  assert.throws(
    () => new ComputeEffectComposer(probe.gpu, { format: "rgba8unorm" }),
    /format must be rgba16float/
  );
}

console.log("compute_effect_composer_reflection_contracts: all linear composition contracts passed");
