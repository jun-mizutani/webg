// ---------------------------------------------------------
// headless_tests/core/compute_dof_pass/hdr_depth_contracts.js  2026/07/23
//   Linear HDR, image pyramid, and Camera Reverse-Z contracts for ComputeDofPass
// ---------------------------------------------------------
import assert from "node:assert/strict";
import CameraFrame from "../../../webg/CameraFrame.js";
import ComputeDofPass, {
  COMPUTE_DOF_COC_EXTRACT_WGSL,
  COMPUTE_DOF_COMPOSITE_WGSL,
  COMPUTE_DOF_FORMAT
} from "../../../webg/ComputeDofPass.js";
import {
  COMPUTE_IMAGE_PYRAMID_DOWNSAMPLE_WGSL
} from "../../../webg/ComputeImagePyramid.js";
import { CAMERA_REVERSE_Z } from "../../../webg/DepthConvention.js";
import Matrix from "../../../webg/Matrix.js";

globalThis.GPUTextureUsage = { STORAGE_BINDING: 1, TEXTURE_BINDING: 2, COPY_SRC: 4 };
globalThis.GPUShaderStage = { COMPUTE: 1 };
globalThis.GPUBufferUsage = { UNIFORM: 1, COPY_DST: 2 };

// DoFが所有する全texture、uniform write、dispatchを実GPUなしで記録します
function createGpuProbe() {
  const textures = [];
  const writes = [];
  const dispatches = [];
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
        setPipeline() {},
        setBindGroup() {},
        dispatchWorkgroups(x, y, z) { dispatches.push([x, y, z]); },
        end() {}
      };
    }
  };
  return { gpu: { device, queue }, commandEncoder, textures, writes, dispatches };
}

function makeFrame(far = 5000) {
  return new CameraFrame({
    cameraWorldMatrix: new Matrix(),
    near: 0.25,
    far,
    vfov: 60,
    aspect: 2,
    depthConvention: CAMERA_REVERSE_Z
  });
}

function makeResources(width = 16, height = 8, sceneFormat = COMPUTE_DOF_FORMAT) {
  return {
    scene: {
      getView: () => ({}),
      getSampler: () => ({}),
      getFormat: () => sceneFormat,
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

// 共通Pyramid downsampleとDoF compositeの色targetはすべてHDRです
{
  assert.equal(COMPUTE_DOF_FORMAT, "rgba16float");
  for (const wgsl of [
    COMPUTE_IMAGE_PYRAMID_DOWNSAMPLE_WGSL,
    COMPUTE_DOF_COC_EXTRACT_WGSL,
    COMPUTE_DOF_COMPOSITE_WGSL
  ]) {
    assert.match(wgsl, /texture_storage_2d<rgba16float, write>/);
    assert.doesNotMatch(wgsl, /texture_storage_2d<rgba8unorm/);
  }
  assert.match(COMPUTE_IMAGE_PYRAMID_DOWNSAMPLE_WGSL, /fn readSource/);
  assert.match(COMPUTE_IMAGE_PYRAMID_DOWNSAMPLE_WGSL, /offset \* texel \* params\.filterRadius/);
  assert.match(COMPUTE_DOF_COMPOSITE_WGSL, /params\.values\.z, 0\.0, 4\.0/);
  assert.match(COMPUTE_DOF_COMPOSITE_WGSL, /mix\(halfLayer, quarterLayer/);
  assert.match(COMPUTE_DOF_COMPOSITE_WGSL, /mix\(quarterLayer, eighthLayer/);
  assert.match(COMPUTE_DOF_COMPOSITE_WGSL, /mix\(eighthLayer, sixteenthLayer/);
  assert.match(COMPUTE_DOF_COMPOSITE_WGSL, /pow\(smoothWeight, params\.shape\.y\)/);
  assert.match(COMPUTE_DOF_COMPOSITE_WGSL, /stagePosition\(abs\(delta\), params\.values\.y\)/);
}

// coverageとCoCを分離し、元輪郭内部を同じstageのscene blurへ置換します
{
  assert.match(COMPUTE_DOF_COC_EXTRACT_WGSL, /fn cocStage\(distance : f32\)/);
  assert.match(COMPUTE_DOF_COC_EXTRACT_WGSL, /if \(delta > 0\.0\)/);
  assert.match(COMPUTE_DOF_COC_EXTRACT_WGSL, /else if \(delta < 0\.0\)/);
  assert.match(COMPUTE_DOF_COC_EXTRACT_WGSL, /let layer = vec4f\(scene\.rgb, 1\.0\)/);
  assert.match(COMPUTE_DOF_COC_EXTRACT_WGSL, /var cocOutputTexture/);
  assert.match(COMPUTE_DOF_COC_EXTRACT_WGSL, /vec4f\(0\.0, stage, 0\.0, 0\.0\)/);
  assert.match(COMPUTE_DOF_COC_EXTRACT_WGSL, /vec4f\(stage, 0\.0, 0\.0, 0\.0\)/);
  assert.doesNotMatch(COMPUTE_DOF_COC_EXTRACT_WGSL, /scene\.rgb \* coverage/);
  assert.match(COMPUTE_DOF_COC_EXTRACT_WGSL, /isGBufferBackgroundDepth\(depth\)/);
  assert.match(COMPUTE_DOF_COMPOSITE_WGSL, /isGBufferBackgroundDepth\(depth\)/);
  assert.match(COMPUTE_DOF_COMPOSITE_WGSL, /fn sceneBlurAtStage/);
  assert.match(COMPUTE_DOF_COMPOSITE_WGSL, /color = sceneBlurAtStage\(uv, stageValue\)\.rgb/);
  assert.match(COMPUTE_DOF_COMPOSITE_WGSL, /let isOutOfFocusNear = delta < 0\.0 && isOutOfFocus/);
  assert.match(COMPUTE_DOF_COMPOSITE_WGSL, /if \(!isOutOfFocusNear\)/);
  assert.doesNotMatch(COMPUTE_DOF_COMPOSITE_WGSL, /stageValue <= params\.shape\.x\) \{\s*textureStore/);
  assert.doesNotMatch(COMPUTE_DOF_COMPOSITE_WGSL, /fn resolveLayerColor/);
  assert.match(COMPUTE_DOF_COMPOSITE_WGSL, /moment \/ coverage/);
  assert.match(
    COMPUTE_DOF_COMPOSITE_WGSL,
    /farComposite = compositeCoverageLayer\(scene\.rgb, farSpreadLayer\(uv\)\)/
  );
  assert.doesNotMatch(COMPUTE_DOF_COMPOSITE_WGSL, /backgroundBlur/);
  assert.match(COMPUTE_DOF_COMPOSITE_WGSL, /nearComposite = compositeCoverageLayer\(farComposite/);
  assert.match(COMPUTE_DOF_COMPOSITE_WGSL, /linearizeGBufferDepth\(depth, params\.projection\)/);
  assert.match(COMPUTE_DOF_COMPOSITE_WGSL, /vec4f\(vec3f\(depth\), 1\.0\)/);
  assert.doesNotMatch(COMPUTE_DOF_COMPOSITE_WGSL, /fn linearizeDepth\(/);
  assert.doesNotMatch(COMPUTE_DOF_COMPOSITE_WGSL, /max\(focusRange/);
  assert.doesNotMatch(COMPUTE_DOF_COMPOSITE_WGSL, /mixScale/);
  assert.doesNotMatch(COMPUTE_DOF_COMPOSITE_WGSL, /max\(params\.shape\.y/);
}

// 全owned targetはrgba16floatで、Camera Frameからprojection uniformを作ります
{
  const probe = createGpuProbe();
  const pass = new ComputeDofPass(probe.gpu, { width: 16, height: 8 });
  await pass.ready;
  assert.equal(pass.format, COMPUTE_DOF_FORMAT);
  assert.equal(probe.textures.length, 20);
  assert.ok(probe.textures.every(({ format }) => format === COMPUTE_DOF_FORMAT));

  const output = pass.encode(probe.commandEncoder, makeResources(), {
    cameraFrame: makeFrame(),
    focusDistance: 40,
    focusRange: 8,
    blurRadius: 1.5,
    cocScale: 0.75,
    enabled: true,
    debugView: "depth",
    sharpnessWidth: 0.2,
    sharpnessPower: 1.5
  });
  assert.equal(output.getFormat(), COMPUTE_DOF_FORMAT);
  assert.equal(pass.getSmallBlurTarget().getFormat(), COMPUTE_DOF_FORMAT);
  assert.equal(pass.getMediumBlurTarget().getFormat(), COMPUTE_DOF_FORMAT);
  assert.equal(pass.getLargeBlurTarget().getFormat(), COMPUTE_DOF_FORMAT);
  assert.equal(pass.getSixteenthTarget().getFormat(), COMPUTE_DOF_FORMAT);
  assert.equal(pass.getFarFieldTarget().getFormat(), COMPUTE_DOF_FORMAT);
  assert.equal(pass.getFarSixteenthTarget().getFormat(), COMPUTE_DOF_FORMAT);
  assert.equal(pass.getNearFieldTarget().getFormat(), COMPUTE_DOF_FORMAT);
  assert.equal(pass.getNearSixteenthTarget().getFormat(), COMPUTE_DOF_FORMAT);
  assert.equal(pass.getCocFieldTarget().getFormat(), COMPUTE_DOF_FORMAT);
  assert.equal(pass.getCocSixteenthTarget().getFormat(), COMPUTE_DOF_FORMAT);
  assert.deepEqual(probe.dispatches, [
    [1, 1, 1],
    [1, 1, 1],
    [1, 1, 1],
    [1, 1, 1],
    [2, 1, 1],
    [1, 1, 1],
    [1, 1, 1],
    [1, 1, 1],
    [1, 1, 1],
    [1, 1, 1],
    [1, 1, 1],
    [1, 1, 1],
    [1, 1, 1],
    [1, 1, 1],
    [1, 1, 1],
    [1, 1, 1],
    [1, 1, 1],
    [2, 1, 1]
  ]);

  const uniforms = probe.writes.at(-1).data;
  assert.deepEqual(uniforms.slice(0, 8), [
    40, 8, 0.75, 1,
    0.25, 5000, Math.tan(Math.PI / 6), 2
  ].map((value) => Math.fround(value)));
  assert.deepEqual(uniforms.slice(8, 12), [0.2, 1.5, 1, 0]
    .map((value) => Math.fround(value)));
  assert.deepEqual(probe.writes.at(-2).data, [1.5, 0, 0, 0]
    .map((value) => Math.fround(value)));
  assert.deepEqual(probe.writes.at(-3).data, [1.5, 0, 0, 0]
    .map((value) => Math.fround(value)));
  assert.deepEqual(probe.writes.at(-4).data, [1.5, 0, 0, 0]
    .map((value) => Math.fround(value)));
  assert.deepEqual(probe.writes.at(-5).data.slice(0, 12), uniforms);
  assert.deepEqual(probe.writes.at(-6).data, [1.5, 0, 0, 0]
    .map((value) => Math.fround(value)));

  pass.encode(probe.commandEncoder, makeResources(), {
    cameraFrame: makeFrame(Infinity)
  });
  assert.equal(probe.writes.at(-1).data[5], 0);

  assert.throws(
    () => pass.encode(probe.commandEncoder, makeResources(16, 8, "rgba8unorm"), {
      cameraFrame: makeFrame()
    }),
    /scene format must be rgba16float/
  );
  const wrongDepth = makeResources();
  wrongDepth.depth.depthConvention = {};
  assert.throws(
    () => pass.encode(probe.commandEncoder, wrongDepth, { cameraFrame: makeFrame() }),
    /CAMERA_REVERSE_Z depth target/
  );
  assert.throws(
    () => pass.encode(probe.commandEncoder, makeResources(), {
      cameraFrame: makeFrame(),
      projectionNear: 0.1
    }),
    /no longer supports projectionNear/
  );
  assert.throws(
    () => pass.encode(probe.commandEncoder, makeResources(), {
      cameraFrame: makeFrame(),
      blurRadius: 0.1
    }),
    /blurRadius must be >= 0.25/
  );
  assert.throws(
    () => pass.encode(probe.commandEncoder, makeResources(), {
      cameraFrame: makeFrame(),
      blurIterations: 3
    }),
    /no longer supports staged DoF blur parameters/
  );
  assert.throws(
    () => pass.encode(probe.commandEncoder, makeResources(), {}),
    /requires a Reverse-Z CameraFrame/
  );
  pass.destroy();

  assert.throws(
    () => new ComputeDofPass(probe.gpu, { format: "rgba8unorm" }),
    /format must be rgba16float/
  );
}

console.log("compute_dof_pass_hdr_depth_contracts: all Pyramid DoF contracts passed");
