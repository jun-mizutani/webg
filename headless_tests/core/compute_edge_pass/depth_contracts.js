// ---------------------------------------------------------
// headless_tests/core/compute_edge_pass/headless_probe.js  2026/07/14
//   Tone-mapped color and Camera Reverse-Z geometry edge contracts
// ---------------------------------------------------------
import assert from "node:assert/strict";
import CameraFrame from "../../../webg/CameraFrame.js";
import ComputeEdgePass, {
  COMPUTE_EDGE_FORMAT,
  COMPUTE_EDGE_GEOMETRY_WGSL,
  COMPUTE_EDGE_INPUT_FORMATS,
  COMPUTE_EDGE_WGSL
} from "../../../webg/ComputeEdgePass.js";
import { CAMERA_REVERSE_Z } from "../../../webg/DepthConvention.js";
import Matrix from "../../../webg/Matrix.js";

globalThis.GPUTextureUsage = { STORAGE_BINDING: 1, TEXTURE_BINDING: 2, COPY_SRC: 4 };
globalThis.GPUShaderStage = { COMPUTE: 1 };
globalThis.GPUBufferUsage = { UNIFORM: 1, COPY_DST: 2 };

// color-onlyとgeometry付きのどちらのComputePassがdispatchされたかを記録します
function createGpuProbe() {
  const writes = [];
  const dispatches = [];
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
    writeTexture() {},
    writeBuffer(buffer, offset, data) {
      writes.push({ buffer, offset, data: Array.from(data) });
    }
  };
  const commandEncoder = {
    beginComputePass(descriptor) {
      return {
        setPipeline() {},
        setBindGroup() {},
        dispatchWorkgroups(x, y, z) { dispatches.push({ x, y, z, descriptor }); },
        end() {}
      };
    }
  };
  return { gpu: { device, queue }, commandEncoder, writes, dispatches };
}

function makeFrame(far = 5000) {
  return new CameraFrame({
    cameraWorldMatrix: new Matrix(),
    near: 0.2,
    far,
    vfov: 60,
    aspect: 2,
    depthConvention: CAMERA_REVERSE_Z
  });
}

function makeScene(width = 16, height = 8, format = COMPUTE_EDGE_FORMAT) {
  return {
    getView: () => ({}),
    getFormat: () => format,
    getWidth: () => width,
    getHeight: () => height
  };
}

function makeGeometry(width = 16, height = 8) {
  return {
    normal: {
      getView: () => ({}),
      getWidth: () => width,
      getHeight: () => height
    },
    depth: {
      depthConvention: CAMERA_REVERSE_Z,
      getDepthSampleView: () => ({}),
      getWidth: () => width,
      getHeight: () => height
    }
  };
}

// 表示色入力はrgba・bgraの通常unormを受け、storage出力はrgba8unormへ固定します
{
  assert.deepEqual(COMPUTE_EDGE_INPUT_FORMATS, ["rgba8unorm", "bgra8unorm"]);
  assert.equal(COMPUTE_EDGE_FORMAT, "rgba8unorm");
  assert.match(COMPUTE_EDGE_WGSL, /texture_storage_2d<rgba8unorm, write>/);
  assert.doesNotMatch(COMPUTE_EDGE_WGSL, /clamp\(i32\(round\(params\.control\.y\)/);
  assert.doesNotMatch(COMPUTE_EDGE_WGSL, /clamp\(params\.values\.z/);
  assert.match(COMPUTE_EDGE_WGSL, /max\(source\.rgb - vec3f\(amount\)/);
  assert.match(COMPUTE_EDGE_WGSL, /min\(source\.rgb \+ vec3f\(amount\)/);
}

// geometry shaderはReverse-Z背景0と共通線形化を使い、旧depth 1比較を持ちません
{
  assert.match(COMPUTE_EDGE_GEOMETRY_WGSL, /isGBufferBackgroundDepth\(centerDepthRaw\)/);
  assert.match(COMPUTE_EDGE_GEOMETRY_WGSL, /!isGBufferBackgroundDepth\(sampleDepthRaw\)/);
  assert.match(COMPUTE_EDGE_GEOMETRY_WGSL, /linearizeGBufferDepth\(centerDepthRaw, params\.projection\)/);
  assert.doesNotMatch(COMPUTE_EDGE_GEOMETRY_WGSL, /0\.999999/);
  assert.doesNotMatch(COMPUTE_EDGE_GEOMETRY_WGSL, /max\(centerDepth, 0\.0001\)/);
  assert.doesNotMatch(COMPUTE_EDGE_GEOMETRY_WGSL, /clamp\(i32\(round\(params\.control\.y\)/);
}

// color-onlyはTone Map済みsceneだけで動作し、geometry modeはCamera Frameを必須とします
{
  const probe = createGpuProbe();
  const pass = new ComputeEdgePass(probe.gpu, { width: 16, height: 8 });
  await pass.ready;
  assert.equal(pass.getOutputTarget().getFormat(), COMPUTE_EDGE_FORMAT);

  pass.encode(probe.commandEncoder, makeScene(), {
    geometryEnabled: false,
    thickness: 3,
    mix: 0.5
  });
  assert.equal(probe.writes.at(-1).data[5], 2);

  pass.encode(probe.commandEncoder, makeScene(16, 8, "bgra8unorm"), {
    geometryEnabled: false
  });
  assert.equal(probe.dispatches.length, 2);

  const geometry = makeGeometry();
  pass.encode(probe.commandEncoder, makeScene(), {
    ...geometry,
    cameraFrame: makeFrame(),
    geometryEnabled: true,
    colorEnabled: false,
    normalWeight: 1.5,
    depthWeight: 2.0
  });
  const uniforms = probe.writes.at(-1).data;
  assert.deepEqual(uniforms.slice(8, 12), [1.5, 2, 0, 0]);
  assert.deepEqual(uniforms.slice(12, 16), [
    0.2, 5000, Math.tan(Math.PI / 6), 2
  ].map((value) => Math.fround(value)));

  pass.encode(probe.commandEncoder, makeScene(), {
    ...geometry,
    cameraFrame: makeFrame(Infinity),
    geometryEnabled: true
  });
  assert.equal(probe.writes.at(-1).data[13], 0);

  assert.throws(
    () => pass.encode(probe.commandEncoder, makeScene(16, 8, "rgba16float")),
    /scene format must be rgba8unorm or bgra8unorm; received rgba16float/
  );
  const wrongDepth = makeGeometry();
  wrongDepth.depth.depthConvention = {};
  assert.throws(
    () => pass.encode(probe.commandEncoder, makeScene(), {
      ...wrongDepth,
      cameraFrame: makeFrame(),
      geometryEnabled: true
    }),
    /depth must use CAMERA_REVERSE_Z/
  );
  assert.throws(
    () => pass.encode(probe.commandEncoder, makeScene(), {
      ...geometry,
      projection: [0.1, 1000, 0.5, 2],
      geometryEnabled: true
    }),
    /projection option was removed/
  );
  assert.throws(
    () => pass.encode(probe.commandEncoder, makeScene(), {
      ...geometry,
      cameraFrame: makeFrame(),
      geometryEnabled: false
    }),
    /geometry resources require geometryEnabled true/
  );
  pass.destroy();
}

console.log("compute_edge_pass_depth_contracts: all display and geometry edge contracts passed");
