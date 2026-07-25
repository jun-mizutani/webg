// ---------------------------------------------------------
// headless_tests/core/ssao_pass/headless_probe.js  2026/07/13
//   headless contracts for SsaoPass
// ---------------------------------------------------------
import assert from "node:assert/strict";
import CameraFrame from "../../../webg/CameraFrame.js";
import SsaoPass, {
  SSAO_BILATERAL_WGSL,
  SSAO_DEFAULTS,
  SSAO_WGSL
} from "../../../webg/SsaoPass.js";
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

// SsaoPassが生成するresourceとcommandを記録する最小GPUDeviceを用意します
// 実GPUを使わず、binding、uniform、dispatch、破棄の契約を観測します
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

function createResources(width, height) {
  const sized = { getWidth: () => width, getHeight: () => height };
  return {
    normal: { ...sized, getView: () => ({ name: "normal-view" }) },
    depth: {
      ...sized,
      depthConvention: CAMERA_REVERSE_Z,
      getDepthSampleView: () => ({ name: "depth-view" })
    }
  };
}

// 既定値とWGSLはG-buffer normal、depth、storage outputの契約を公開します
assert.deepEqual(SSAO_DEFAULTS, {
  radius: 18,
  strength: 1.35,
  bias: 0.05,
  samples: 12,
  resolutionScale: 0.7
});
assert.match(SSAO_WGSL, /reconstructGBufferViewPosition/);
assert.match(SSAO_WGSL, /texture_storage_2d<rgba8unorm, write>/);
assert.match(SSAO_WGSL, /outputCoord/);
assert.match(SSAO_WGSL, /sourceUv/);
assert.match(SSAO_WGSL, /smoothstep\(params\.ao\.z, 0\.75, facingDot\)/);
assert.match(SSAO_WGSL, /exp2\(-average \* params\.ao\.y \* 2\.2\)/);
assert.match(SSAO_BILATERAL_WGSL, /fullCoordToAoCoord/);
assert.match(SSAO_BILATERAL_WGSL, /for \(var y = -2; y <= 2; y \+= 1\)/);
assert.match(SSAO_BILATERAL_WGSL, /depthWeight/);
assert.match(SSAO_BILATERAL_WGSL, /normalWeight/);

// encodeは低解像度raw AOとフル解像度compositeで、別々のworkgroup数を計算します
{
  const probe = createGpuProbe();
  const pass = new SsaoPass(probe.gpu, {
    label: "ssao-probe",
    width: 17,
    height: 9,
    resolutionScale: 0.5
  });
  await pass.ready;
  const resources = createResources(17, 9);
  const output = pass.encode(probe.commandEncoder, resources, {
    cameraFrame: createCameraFrame(),
    radius: 20,
    strength: 1.5,
    bias: 0.08,
    samples: 16,
    resolutionScale: 0.5,
    enabled: true,
    timestampWrites: {
      querySet: {},
      beginningOfPassWriteIndex: 0,
      endOfPassWriteIndex: 1
    }
  });
  assert.equal(output, pass.getOutputTarget());
  assert.equal(probe.bindGroups.length, 2);
  assert.deepEqual(probe.dispatches[0], {
    x: 2,
    y: 1,
    z: 1,
    descriptor: {
      label: "ssao-probe",
      timestampWrites: { querySet: {}, beginningOfPassWriteIndex: 0 }
    }
  });
  assert.deepEqual(probe.dispatches[1], {
    x: 3,
    y: 2,
    z: 1,
    descriptor: {
      label: "ssao-probe:bilateral",
      timestampWrites: { querySet: {}, endOfPassWriteIndex: 1 }
    }
  });
  const uniforms = probe.uniformWrites.at(-2).data;
  const expected = [20, 1.5, 0.08, 16, 0.1, 100, 0.5, 16 / 9, 1, 0, 9, 5];
  assert.equal(uniforms.length, expected.length);
  for (let index = 0; index < expected.length; index++) {
    assert.ok(Math.abs(uniforms[index] - expected[index]) < 1e-6);
  }
  const compositeUniforms = probe.uniformWrites.at(-1).data;
  const expectedComposite = [0.1, 100, 0.5, 16 / 9, 1, 0, 17, 9];
  assert.equal(compositeUniforms.length, expectedComposite.length);
  for (let index = 0; index < expectedComposite.length; index++) {
    assert.ok(Math.abs(compositeUniforms[index] - expectedComposite[index]) < 1e-6);
  }
  assert.equal(pass.resize(17, 9), false);
  assert.equal(pass.resize(32, 24), true);
  assert.equal(pass.rawTarget.getWidth(), 16);
  assert.equal(pass.rawTarget.getHeight(), 12);
  assert.equal(pass.outputTarget.getWidth(), 32);
  assert.equal(pass.outputTarget.getHeight(), 24);
  const uniformBuffer = pass.computePass.uniformBuffer;
  const bilateralUniformBuffer = pass.bilateralPass.uniformBuffer;
  assert.equal(pass.destroy(), true);
  assert.equal(uniformBuffer.destroyed, true);
  assert.equal(bilateralUniformBuffer.destroyed, true);
  assert.equal(pass.destroy(), false);
  assert.throws(() => pass.getOutputTarget(), /is destroyed/);
}

// 不正parameterはWGSL側でclampせず、command発行前に例外として検出します
{
  const probe = createGpuProbe();
  const pass = new SsaoPass(probe.gpu);
  await pass.ready;
  const resources = createResources(1, 1);
  const cameraFrame = createCameraFrame();
  assert.throws(
    () => pass.encode(probe.commandEncoder, resources, {
      cameraFrame,
      samples: 17
    }),
    /samples must be <= 16/
  );
  assert.throws(
    () => pass.encode(probe.commandEncoder, resources, {
      cameraFrame: {}
    }),
    /requires a Reverse-Z CameraFrame/
  );
  assert.throws(
    () => pass.encode(probe.commandEncoder, resources, {
      cameraFrame,
      view: "depth"
    }),
    /view option was removed/
  );
  assert.throws(
    () => pass.encode(probe.commandEncoder, resources, {
      cameraFrame,
      resolutionScale: 0.4
    }),
    /resolutionScale must be >= 0.5/
  );
  pass.destroy();
}

console.log("PASS SsaoPass headless contracts");
