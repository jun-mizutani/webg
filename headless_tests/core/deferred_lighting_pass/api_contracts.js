// ---------------------------------------------------------
// headless_tests/core/deferred_lighting_pass/headless_probe.js  2026/07/13
//   headless contracts for DeferredLightingPass
// ---------------------------------------------------------
import assert from "node:assert/strict";
import CameraFrame from "../../../webg/CameraFrame.js";
import DeferredLightingPass, {
  buildDeferredLightingWgsl,
  DEFERRED_LIGHTING_DEFAULTS,
  DEFERRED_LOCAL_LIGHT_STRIDE_FLOATS,
  DEFERRED_LOCAL_LIGHT_TYPE_IDS,
  DEFERRED_LOCAL_LIGHT_TYPES,
  DEFERRED_LIGHTING_VIEW_MODES
} from "../../../webg/DeferredLightingPass.js";
import { CAMERA_REVERSE_Z } from "../../../webg/DepthConvention.js";
import Matrix from "../../../webg/Matrix.js";

globalThis.GPUTextureUsage = {
  STORAGE_BINDING: 1,
  TEXTURE_BINDING: 2,
  COPY_SRC: 4
};
globalThis.GPUShaderStage = {
  COMPUTE: 1
};
globalThis.GPUBufferUsage = {
  UNIFORM: 1,
  COPY_DST: 2,
  STORAGE: 4
};

// DeferredLightingPassが生成するresourceとcommandを記録する最小GPUDeviceを用意する
// 実GPUなしでuniform、light buffer、dispatch size、destroyの契約を確認する
function createGpuProbe() {
  const textures = [];
  const buffers = [];
  const uniformWrites = [];
  const bindGroups = [];
  const dispatches = [];
  const device = {
    createSampler(descriptor) {
      return { descriptor };
    },
    createTexture(descriptor) {
      const texture = {
        descriptor,
        destroyed: false,
        createView() {
          return { label: `${descriptor.label}:view` };
        },
        destroy() {
          this.destroyed = true;
        }
      };
      textures.push(texture);
      return texture;
    },
    createBuffer(descriptor) {
      const buffer = {
        descriptor,
        destroyed: false,
        destroy() {
          this.destroyed = true;
        }
      };
      buffers.push(buffer);
      return buffer;
    },
    createBindGroupLayout(descriptor) {
      return { descriptor };
    },
    createShaderModule(descriptor) {
      return { descriptor };
    },
    createPipelineLayout(descriptor) {
      return { descriptor };
    },
    createComputePipeline(descriptor) {
      return { descriptor };
    },
    createBindGroup(descriptor) {
      bindGroups.push(descriptor);
      return { descriptor };
    }
  };
  const queue = {
    writeBuffer(buffer, offset, data) {
      uniformWrites.push({
        buffer,
        offset,
        data: Array.from(data)
      });
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
  return {
    gpu: { device, queue },
    commandEncoder,
    textures,
    buffers,
    uniformWrites,
    bindGroups,
    dispatches
  };
}

function createCameraFrame() {
  return new CameraFrame({
    cameraWorldMatrix: new Matrix(),
    near: 0.1,
    far: 100.0,
    vfov: 2.0 * Math.atan(0.5) * 180.0 / Math.PI,
    aspect: 16.0 / 9.0,
    depthConvention: CAMERA_REVERSE_Z
  });
}

// Lightingは完全なG-bufferに加え、各shadowとAOのvisibility targetを明示的に受け取ります
function createResources(width, height) {
  const sized = { getWidth: () => width, getHeight: () => height };
  return {
    albedo: { ...sized, getView: () => ({ name: "albedo-view" }) },
    normal: { ...sized, getView: () => ({ name: "normal-view" }) },
    material: { ...sized, getView: () => ({ name: "material-view" }) },
    depth: {
      ...sized,
      depthConvention: CAMERA_REVERSE_Z,
      getDepthSampleView: () => ({ name: "depth-view" })
    },
    shadowVisibility: { ...sized, getView: () => ({ name: "shadow-view" }) },
    spotShadowVisibility: { ...sized, getView: () => ({ name: "spot-shadow-view" }) },
    ambientOcclusion: { ...sized, getView: () => ({ name: "ao-view" }) }
  };
}

assert.deepEqual(DEFERRED_LIGHTING_DEFAULTS, {
  maxLights: 128,
  ambient: 0.035,
  view: "lighting"
});
assert.deepEqual(DEFERRED_LOCAL_LIGHT_TYPES, ["point", "cone"]);
assert.deepEqual(DEFERRED_LOCAL_LIGHT_TYPE_IDS, { point: 0, cone: 1 });
assert.equal(DEFERRED_LOCAL_LIGHT_STRIDE_FLOATS, 16);
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
assert.match(buildDeferredLightingWgsl(32), /array<LocalLight>/);
assert.match(buildDeferredLightingWgsl(32), /directionInnerCos\s*:\s*vec4f/);
assert.match(buildDeferredLightingWgsl(32), /outerCosAndType\s*:\s*vec4f/);
assert.match(buildDeferredLightingWgsl(32), /for \(var i = 0u; i < 32u; i \+= 1u\)/);
assert.match(buildDeferredLightingWgsl(32), /reconstructGBufferViewPosition/);

// encodeはG-buffer、view matrix、light配列からuniformとstorage bufferを書き、output targetへdispatchする
{
  const probe = createGpuProbe();
  const pass = new DeferredLightingPass(probe.gpu, {
    label: "deferred-probe",
    width: 17,
    height: 9,
    maxLights: 4
  });
  await pass.ready;
  const resources = createResources(17, 9);
  const output = pass.encode(probe.commandEncoder, resources, {
    cameraFrame: createCameraFrame(),
    directionalLight: null,
    spotLight: null,
    lights: [
      { type: "point", position: [1, 2, 3], color: [1, 0.5, 0.25], radius: 7, intensity: 2 },
      { type: "point", position: [-1, 0, 4], color: [0.2, 0.3, 0.4], radius: 6, intensity: 1.5 }
    ],
    lightCount: 2,
    view: "normal",
    timestampWrites: {
      querySet: {},
      beginningOfPassWriteIndex: 0
    }
  });
  assert.equal(output, pass.getOutputTarget());
  assert.equal(probe.bindGroups.length, 1);
  assert.deepEqual(probe.dispatches[0], {
    x: 3,
    y: 2,
    z: 1,
    descriptor: {
      label: "deferred-probe",
      timestampWrites: {
        querySet: {},
        beginningOfPassWriteIndex: 0
      }
    }
  });
  const uniformWrite = probe.uniformWrites.at(-1).data;
  const expectedUniforms = [0.1, 100, 0.5, 16 / 9, 2, 2, 0, 0];
  assert.equal(uniformWrite.length, 32);
  for (let index = 0; index < expectedUniforms.length; index += 1) {
    assert.ok(Math.abs(uniformWrite[index] - expectedUniforms[index]) < 1e-6);
  }
  const lightWrite = probe.uniformWrites.at(-2).data;
  const expectedLightData = [
    1, 2, 3, 7,
    1, 0.5, 0.25, 2,
    0, 0, -1, 1,
    0, 0, 0, 0,
    -1, 0, 4, 6,
    0.2, 0.3, 0.4, 1.5,
    0, 0, -1, 1,
    0, 0, 0, 0
  ];
  for (let index = 0; index < expectedLightData.length; index += 1) {
    assert.ok(Math.abs(lightWrite[index] - expectedLightData[index]) < 1e-6);
  }
  assert.equal(pass.resize(17, 9), false);
  assert.equal(pass.resize(32, 24), true);
  const lightBuffer = pass.lightBuffer;
  const uniformBuffer = pass.computePass.uniformBuffer;
  assert.equal(pass.destroy(), true);
  assert.equal(lightBuffer.destroyed, true);
  assert.equal(uniformBuffer.destroyed, true);
  assert.equal(pass.destroy(), false);
  assert.throws(() => pass.getOutputTarget(), /is destroyed/);
}

// 不正なCameraFrame、light option、lightCountはcommand記録前に例外へする
{
  const probe = createGpuProbe();
  const pass = new DeferredLightingPass(probe.gpu);
  await pass.ready;
  const resources = createResources(1, 1);
  const cameraFrame = createCameraFrame();
  const lights = [{
    type: "point",
    position: [0, 0, 0],
    color: [1, 1, 1],
    radius: 1,
    intensity: 1
  }];
  assert.throws(
    () => pass.encode(probe.commandEncoder, resources, {
      cameraFrame: {},
      directionalLight: null,
      spotLight: null,
      lights
    }),
    /requires a Reverse-Z CameraFrame/
  );
  assert.throws(
    () => pass.encode(probe.commandEncoder, resources, {
      cameraFrame,
      spotLight: null,
      lights
    }),
    /directionalLight option is required/
  );
  assert.throws(
    () => pass.encode(probe.commandEncoder, resources, {
      cameraFrame,
      directionalLight: null,
      spotLight: null,
      lights,
      lightCount: 2
    }),
    /lightCount exceeds lights.length/
  );
  pass.destroy();
}

console.log("PASS DeferredLightingPass headless contracts");
