// ---------------------------------------------------------
// headless_tests/core/compute_ssr_pass/api_contracts.js  2026/07/23
//   Headless ray and roughness-pyramid contracts for ComputeSsrPass
// ---------------------------------------------------------
import assert from "node:assert/strict";
import CameraFrame from "../../../webg/CameraFrame.js";
import ComputeSsrPass, {
  COMPUTE_SSR_DEFAULTS,
  COMPUTE_SSR_INPUT_FORMAT,
  COMPUTE_SSR_MATERIAL_FORMAT,
  COMPUTE_SSR_VIEW_MODES,
  COMPUTE_SSR_WGSL
} from "../../../webg/ComputeSsrPass.js";
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
  COPY_DST: 2
};

// ComputeSsrPassが生成するresourceとcommandを記録する最小GPUDeviceを用意する
// 実GPUなしでuniform更新、dispatch size、destroyの契約を確認する
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
    far: 1000.0,
    vfov: 60.0,
    aspect: 2.0,
    depthConvention: CAMERA_REVERSE_Z
  });
}

// SSRはTone Map前のHDR sceneと、同じCameraFrameで作ったG-buffer一式を読みます
function createResources(width = 20, height = 10) {
  const sized = { getWidth: () => width, getHeight: () => height };
  return {
    scene: {
      ...sized,
      getView: () => ({ name: "scene-view" }),
      getFormat: () => COMPUTE_SSR_INPUT_FORMAT
    },
    normal: { ...sized, getView: () => ({ name: "normal-view" }) },
    material: {
      ...sized,
      getView: () => ({ name: "material-view" }),
      getFormat: () => COMPUTE_SSR_MATERIAL_FORMAT
    },
    depth: {
      ...sized,
      depthConvention: CAMERA_REVERSE_Z,
      getDepthSampleView: () => ({ name: "depth-view" })
    }
  };
}

assert.deepEqual(COMPUTE_SSR_DEFAULTS, {
  intensity: 0.82,
  distance: 42,
  thickness: 0.42,
  steps: 48,
  resolutionScale: 0.7,
  reflectivityThreshold: 0.05,
  enabled: true,
  view: "reflection"
});
assert.deepEqual(COMPUTE_SSR_VIEW_MODES, [
  "reflection",
  "normal",
  "depth"
]);
assert.match(COMPUTE_SSR_WGSL, /projectToUv/);
assert.match(COMPUTE_SSR_WGSL, /outputCoord/);
assert.match(COMPUTE_SSR_WGSL, /earlyReflectivity/);
assert.match(COMPUTE_SSR_WGSL, /for \(var i = 0; i < 128; i \+= 1\)/);
assert.match(COMPUTE_SSR_WGSL, /reflectionWeight/);

// encodeはray、3段Pyramid、roughness filterの順にdispatchします
{
  const probe = createGpuProbe();
  const pass = new ComputeSsrPass(probe.gpu, {
    label: "ssr-probe",
    width: 20,
    height: 10,
    resolutionScale: 0.5,
    reflectivityThreshold: 0.12
  });
  await pass.ready;
  const resources = createResources();
  const output = pass.encode(probe.commandEncoder, resources, {
    cameraFrame: createCameraFrame(),
    enabled: false,
    intensity: 1.2,
    distance: 36,
    thickness: 0.3,
    steps: 32,
    resolutionScale: 0.5,
    reflectivityThreshold: 0.12,
    view: "reflection",
    timestampWrites: {
      querySet: {},
      endOfPassWriteIndex: 1
    }
  });
  assert.equal(output, pass.getOutputTarget());
  assert.equal(probe.bindGroups.length, 5);
  assert.deepEqual(probe.dispatches[0], {
    x: 2,
    y: 1,
    z: 1,
    descriptor: {
      label: "ssr-probe",
      timestampWrites: undefined
    }
  });
  assert.deepEqual(
    probe.dispatches.map(({ x, y, z }) => [x, y, z]),
    [[2, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1], [2, 1, 1]]
  );
  assert.deepEqual(probe.dispatches.at(-1), {
    x: 2,
    y: 1,
    z: 1,
    descriptor: {
      label: "ssr-probe:roughness-filter",
      timestampWrites: {
        querySet: {},
        endOfPassWriteIndex: 1
      }
    }
  });
  const uniforms = probe.uniformWrites[0].data;
  const expected = [
    Math.fround(0.1), 1000, Math.fround(Math.tan(Math.PI / 6)), 2,
    0, 36, 0.3, 32, 0, 0.12, 10, 5
  ];
  assert.equal(uniforms.length, expected.length);
  for (let index = 0; index < expected.length; index += 1) {
    assert.ok(Math.abs(uniforms[index] - expected[index]) < 1e-6);
  }
  assert.deepEqual(probe.uniformWrites.at(-1).data, [1, 0, 0, 0]);
  assert.equal(pass.resize(20, 10), false);
  assert.equal(pass.resize(32, 24), true);
  assert.equal(pass.getOutputTarget().getWidth(), 16);
  assert.equal(pass.getOutputTarget().getHeight(), 12);
  const rayUniformBuffer = pass.computePass.uniformBuffer;
  const roughnessUniformBuffer = pass.roughnessPass.uniformBuffer;
  assert.equal(pass.destroy(), true);
  assert.equal(rayUniformBuffer.destroyed, true);
  assert.equal(roughnessUniformBuffer.destroyed, true);
  assert.equal(pass.destroy(), false);
  assert.throws(() => pass.getOutputTarget(), /is destroyed/);
}

// 不正なparameterとviewはcommand記録前に例外へする
{
  const probe = createGpuProbe();
  const pass = new ComputeSsrPass(probe.gpu);
  await pass.ready;
  const resources = createResources(1, 1);
  const cameraFrame = createCameraFrame();
  assert.throws(
    () => pass.encode(probe.commandEncoder, resources, {
      cameraFrame: {},
      view: "reflection"
    }),
    /requires a Reverse-Z CameraFrame/
  );
  assert.throws(
    () => pass.encode(probe.commandEncoder, resources, {
      cameraFrame,
      steps: 8
    }),
    /steps must be >= 12/
  );
  assert.throws(
    () => pass.encode(probe.commandEncoder, resources, {
      cameraFrame,
      view: "ao"
    }),
    /view must be one of/
  );
  assert.throws(
    () => pass.encode(probe.commandEncoder, resources, {
      cameraFrame,
      resolutionScale: 0.4
    }),
    /resolutionScale must be >= 0.5/
  );
  assert.throws(
    () => pass.encode(probe.commandEncoder, resources, {
      cameraFrame,
      reflectivityThreshold: -0.1
    }),
    /reflectivityThreshold must be >= 0/
  );
  pass.destroy();
}

console.log("PASS ComputeSsrPass headless contracts");
