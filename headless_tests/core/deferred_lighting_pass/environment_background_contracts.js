// ---------------------------------------------------------
// headless_tests/core/deferred_lighting_pass/environment_background_contracts.js  2026/08/03
//   HDR background and shared environment rotation contracts
// ---------------------------------------------------------
import assert from "node:assert/strict";
import CameraFrame from "../../../webg/CameraFrame.js";
import DeferredLightingPass, {
  buildDeferredLightingWgsl
} from "../../../webg/DeferredLightingPass.js";
import { CAMERA_REVERSE_Z } from "../../../webg/DepthConvention.js";
import Matrix from "../../../webg/Matrix.js";

globalThis.GPUTextureUsage = {
  STORAGE_BINDING: 1,
  TEXTURE_BINDING: 2,
  COPY_SRC: 4
};
globalThis.GPUShaderStage = { COMPUTE: 1 };
globalThis.GPUBufferUsage = { UNIFORM: 1, COPY_DST: 2, STORAGE: 4 };

// 背景用radiance binding、uniform書き込み、dispatchを記録する最小GPUを作ります
function createGpuProbe() {
  const uniformWrites = [];
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
      uniformWrites.push({ buffer, offset, data: Array.from(data) });
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
  return {
    gpu: { device, queue },
    commandEncoder,
    uniformWrites,
    bindGroups
  };
}

// 背景rayの復元に使う投影条件とcamera回転を明示したCamera Frameを作ります
function createCameraFrame() {
  return new CameraFrame({
    cameraWorldMatrix: new Matrix(),
    near: 0.1,
    far: 100.0,
    vfov: 60.0,
    aspect: 2.0,
    depthConvention: CAMERA_REVERSE_Z
  });
}

// 背景pixelを含むDeferred Lighting encodeに必要なG-buffer一式を作ります
function createResources(width, height) {
  const sized = { getWidth: () => width, getHeight: () => height };
  return {
    albedo: { ...sized, getView: () => ({ name: "albedo" }) },
    normal: { ...sized, getView: () => ({ name: "normal" }) },
    material: { ...sized, getView: () => ({ name: "material" }) },
    emissive: { ...sized, getView: () => ({ name: "emissive" }) },
    depth: {
      ...sized,
      depthConvention: CAMERA_REVERSE_Z,
      getDepthSampleView: () => ({ name: "depth" })
    },
    shadowVisibility: { ...sized, getView: () => ({ name: "shadow" }) },
    spotShadowVisibility: { ...sized, getView: () => ({ name: "spot-shadow" }) },
    ambientOcclusion: { ...sized, getView: () => ({ name: "ao" }) }
  };
}

// 同じ元HDRから作られたradiance、irradiance、specular、LUTを一組にします
function createEnvironment(includeRadiance = true) {
  const texture = (name) => ({ getView: () => ({ name }) });
  return {
    ...(includeRadiance ? { radiance: texture("radiance") } : {}),
    irradiance: texture("irradiance"),
    prefilteredSpecular: texture("specular"),
    brdfLut: texture("brdf-lut"),
    sampler: { name: "environment-sampler" },
    specularMipCount: 5
  };
}

// shaderは元HDRを背景pixelへ書き、IBLと同じ環境回転関数を通して参照します
{
  const wgsl = buildDeferredLightingWgsl(8);
  assert.match(wgsl, /@group\(0\) @binding\(15\) var radianceTexture/);
  assert.match(wgsl, /fn sampleEnvironmentRadiance\(/);
  assert.match(wgsl, /textureLoad\(radianceTexture/);
  assert.match(wgsl, /if \(isGBufferBackgroundDepth\(depth\)\)/);
  assert.match(wgsl, /params\.environmentControl\.w >= 0\.5/);
  assert.match(wgsl, /sampleEnvironmentRadiance\(worldDirection\)/);
  assert.match(
    wgsl,
    /let normalWorld = environmentWorldToTextureDirection\(environmentViewToWorld\(normal\)\)/
  );
  assert.match(wgsl, /let reflectionWorld = environmentWorldToTextureDirection\(/);
}

// 背景表示と90度回転はuniformへ明示され、元radiance viewがbinding 15へ渡ります
{
  const probe = createGpuProbe();
  const pass = new DeferredLightingPass(probe.gpu, {
    label: "environment-background-probe",
    width: 8,
    height: 4
  });
  await pass.ready;
  pass.encode(probe.commandEncoder, createResources(8, 4), {
    cameraFrame: createCameraFrame(),
    directionalLight: null,
    spotLight: null,
    lights: [],
    ambient: 0.0,
    environment: createEnvironment(),
    environmentIntensity: 1.25,
    environmentBackground: true,
    environmentRotationDegrees: 90.0
  });
  const uniforms = probe.uniformWrites.at(-1).data;
  assert.equal(uniforms.length, 52);
  assert.deepEqual(uniforms.slice(44, 48), [1.0, 1.25, 5.0, 1.0]);
  assert.ok(Math.abs(uniforms[48]) < 1e-6);
  assert.ok(Math.abs(uniforms[49] - 1.0) < 1e-6);
  const entries = probe.bindGroups.at(-1).entries;
  assert.equal(entries.find(({ binding }) => binding === 15).resource.name, "radiance");
  pass.destroy();
}

// 背景表示や回転の入力不足は固定背景や無回転へ補わず、encode時点で検出します
{
  const probe = createGpuProbe();
  const pass = new DeferredLightingPass(probe.gpu, { width: 8, height: 4 });
  await pass.ready;
  const common = {
    cameraFrame: createCameraFrame(),
    directionalLight: null,
    spotLight: null,
    lights: [],
    ambient: 0.0
  };
  assert.throws(
    () => pass.encode(probe.commandEncoder, createResources(8, 4), {
      ...common,
      environmentBackground: true
    }),
    /environmentBackground requires environment/
  );
  assert.throws(
    () => pass.encode(probe.commandEncoder, createResources(8, 4), {
      ...common,
      environment: createEnvironment(false),
      environmentIntensity: 1.0,
      environmentBackground: true
    }),
    /environmentBackground requires environment\.radiance/
  );
  assert.throws(
    () => pass.encode(probe.commandEncoder, createResources(8, 4), {
      ...common,
      environmentRotationDegrees: 45.0
    }),
    /environmentRotationDegrees requires environment/
  );
  pass.destroy();
}

console.log("deferred_lighting_pass_environment_background_contracts: all contracts passed");
