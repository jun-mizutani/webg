// ---------------------------------------------------------
// headless_tests/core/compute_dof_pass/api_contracts.js  2026/07/23
//   Headless API contracts for image-pyramid ComputeDofPass
// ---------------------------------------------------------
import assert from "node:assert/strict";
import CameraFrame from "../../../webg/CameraFrame.js";
import ComputeDofPass, {
  COMPUTE_DOF_FORMAT
} from "../../../webg/ComputeDofPass.js";
import { CAMERA_REVERSE_Z } from "../../../webg/DepthConvention.js";
import Matrix from "../../../webg/Matrix.js";

function createCameraFrame() {
  return new CameraFrame({
    cameraWorldMatrix: new Matrix(),
    near: 0.2,
    far: 200.0,
    vfov: 2.0 * Math.atan(0.5) * 180.0 / Math.PI,
    aspect: 1.5,
    depthConvention: CAMERA_REVERSE_Z
  });
}

function createProbe() {
  const probe = Object.create(ComputeDofPass.prototype);
  probe.label = "dof-probe";
  probe.width = 32;
  probe.height = 24;
  probe.destroyed = false;
  return probe;
}

// 未指定値、debug mode、廃止したstaged blur parameterの拒否を確認します
{
  const probe = createProbe();
  assert.deepEqual(probe.validateEncodeOptions(), {
    focusDistance: 36.0,
    focusRange: 7.0,
    blurRadius: 1.0,
    cocScale: 1.0,
    enabled: true,
    debugView: "composite",
    debugMode: 0.0,
    sharpnessWidth: 0.15,
    sharpnessPower: 1.0
  });
  assert.equal(probe.validateEncodeOptions({ debugView: "depth" }).debugMode, 1.0);
  assert.equal(probe.validateEncodeOptions({ debugView: "focus" }).debugMode, 2.0);
  assert.throws(
    () => probe.validateEncodeOptions({ debugView: "unknown" }),
    /debugView must be one of/
  );
  assert.throws(
    () => probe.validateEncodeOptions({ projectionNear: 0.1 }),
    /no longer supports projectionNear/
  );
  for (const name of [
    "blurIterations",
    "sampleStep",
    "stageSmallScale",
    "stageMediumScale",
    "stageLargeScale"
  ]) {
    assert.throws(
      () => probe.validateEncodeOptions({ [name]: 1 }),
      /no longer supports staged DoF blur parameters/
    );
  }
  assert.throws(
    () => probe.validateEncodeOptions({ focusRange: 0.0 }),
    /focusRange must be > 0/
  );
  assert.throws(
    () => probe.validateEncodeOptions({ blurRadius: 0.1 }),
    /blurRadius must be >= 0.25/
  );
  assert.throws(
    () => probe.validateEncodeOptions({ blurRadius: 3.1 }),
    /blurRadius must be <= 3/
  );
  assert.equal(probe.validateEncodeOptions({ cocScale: 1.6 }).cocScale, 1.6);
  assert.equal(probe.validateEncodeOptions({ maxBlurMix: 0.8 }).cocScale, 0.8);
  assert.throws(
    () => probe.validateEncodeOptions({ cocScale: 2.1 }),
    /cocScale must be <= 2/
  );
  assert.throws(
    () => probe.validateEncodeOptions({ cocScale: 1.2, maxBlurMix: 0.8 }),
    /cocScale and legacy maxBlurMix must match/
  );
}

// sceneとCamera Reverse-Z depthは独立resourceとして寸法と形式を一致させます
{
  const probe = createProbe();
  const scene = {
    getWidth: () => 32,
    getHeight: () => 24,
    getView: () => ({ label: "scene-color-view" }),
    getFormat: () => COMPUTE_DOF_FORMAT
  };
  const depth = {
    depthConvention: CAMERA_REVERSE_Z,
    getWidth: () => 32,
    getHeight: () => 24,
    getDepthSampleView: () => ({ label: "scene-depth-view" })
  };
  assert.deepEqual(probe.validateResources({ scene, depth }), { scene, depth });
  assert.throws(
    () => probe.validateResources({ scene: { ...scene, getWidth: () => 16 }, depth }),
    /does not match output size/
  );
  assert.throws(
    () => probe.validateResources({
      scene,
      depth: { ...depth, getDepthSampleView: () => null }
    }),
    /depth sample view is not ready/
  );
}

// encodeはscene、near/far coverage、CoC metadataを生成し、固定Levelとdepthを渡します
{
  const probe = createProbe();
  const calls = [];
  const scene = {
    label: "scene",
    getWidth: () => 32,
    getHeight: () => 24,
    getView: () => ({ label: "scene-color-view" }),
    getFormat: () => COMPUTE_DOF_FORMAT
  };
  const depth = {
    label: "depth",
    depthConvention: CAMERA_REVERSE_Z,
    getWidth: () => 32,
    getHeight: () => 24,
    getDepthSampleView: () => ({ label: "scene-depth-view" })
  };
  const targets = new Map([
    [2, { label: "half", getSampler: () => ({ label: "sampler" }) }],
    [4, { label: "quarter" }],
    [8, { label: "eighth" }],
    [16, { label: "sixteenth" }]
  ]);
  const farTargets = new Map([
    [2, { label: "far-half" }],
    [4, { label: "far-quarter" }],
    [8, { label: "far-eighth" }],
    [16, { label: "far-sixteenth" }]
  ]);
  const nearTargets = new Map([
    [2, { label: "near-half" }],
    [4, { label: "near-quarter" }],
    [8, { label: "near-eighth" }],
    [16, { label: "near-sixteenth" }]
  ]);
  const cocTargets = new Map([
    [2, { label: "coc-half" }],
    [4, { label: "coc-quarter" }],
    [8, { label: "coc-eighth" }],
    [16, { label: "coc-sixteenth" }]
  ]);
  probe.outputTarget = { label: "output" };
  probe.farFieldTarget = { label: "far-field" };
  probe.nearFieldTarget = { label: "near-field" };
  probe.cocFieldTarget = { label: "coc-field" };
  probe.pyramid = {
    encode(commandEncoder, source, options) {
      calls.push([
        "pyramid",
        source.label,
        options.filterRadius,
        options.timestampWrites
      ]);
    },
    getLevel(level) {
      return targets.get(level);
    }
  };
  probe.cocExtractPass = {
    setUniforms(values) {
      calls.push(["coc-uniforms", ...values]);
    },
    encode(commandEncoder, resources) {
      calls.push([
        "coc-extract",
        resources.scene.label,
        resources.depth.label,
        resources.farOutput.label,
        resources.nearOutput.label,
        resources.cocOutput.label
      ]);
    }
  };
  probe.farPyramid = {
    encode(commandEncoder, source, options) {
      calls.push(["far-pyramid", source.label, options.filterRadius]);
    },
    getLevel(level) {
      return farTargets.get(level);
    }
  };
  probe.nearPyramid = {
    encode(commandEncoder, source, options) {
      calls.push(["near-pyramid", source.label, options.filterRadius]);
    },
    getLevel(level) {
      return nearTargets.get(level);
    }
  };
  probe.cocPyramid = {
    encode(commandEncoder, source, options) {
      calls.push(["coc-pyramid", source.label, options.filterRadius]);
    },
    getLevel(level) {
      return cocTargets.get(level);
    }
  };
  probe.compositePass = {
    setUniforms(values) {
      calls.push(["uniforms", ...values]);
    },
    encode(commandEncoder, resources, options) {
      calls.push([
        "composite",
        resources.scene.label,
        resources.sceneHalf.label,
        resources.sceneQuarter.label,
        resources.sceneEighth.label,
        resources.sceneSixteenth.label,
        resources.farHalf.label,
        resources.farQuarter.label,
        resources.farEighth.label,
        resources.farSixteenth.label,
        resources.nearHalf.label,
        resources.nearQuarter.label,
        resources.nearEighth.label,
        resources.nearSixteenth.label,
        resources.cocSixteenth.label,
        resources.depth.label,
        resources.output.label,
        options.timestampWrites
      ]);
    }
  };
  const querySet = {};
  assert.equal(probe.encode({ beginComputePass() {} }, { scene, depth }, {
    cameraFrame: createCameraFrame(),
    focusDistance: 24.0,
    focusRange: 5.0,
    blurRadius: 1.4,
    cocScale: 0.8,
    enabled: false,
    debugView: "focus",
    sharpnessWidth: 0.25,
    sharpnessPower: 6.0,
    timestampWrites: {
      querySet,
      beginningOfPassWriteIndex: 2,
      endOfPassWriteIndex: 3
    }
  }), probe.outputTarget);
  assert.deepEqual(calls[0], [
    "pyramid",
    "scene",
    1.4,
    { querySet, beginningOfPassWriteIndex: 2 }
  ]);
  assert.deepEqual(calls[1], [
    "coc-uniforms",
    24.0, 5.0, 0.8, 0.0,
    Math.fround(0.2), 200.0, 0.5, 1.5,
    0.25, 6.0, 2.0, 0.0
  ]);
  assert.deepEqual(calls[2], [
    "coc-extract",
    "scene",
    "depth",
    "far-field",
    "near-field",
    "coc-field"
  ]);
  assert.deepEqual(calls[3], ["far-pyramid", "far-field", 1.4]);
  assert.deepEqual(calls[4], ["near-pyramid", "near-field", 1.4]);
  assert.deepEqual(calls[5], ["coc-pyramid", "coc-field", 1.4]);
  assert.deepEqual(calls[6], [
    "uniforms",
    24.0, 5.0, 0.8, 0.0,
    Math.fround(0.2), 200.0, 0.5, 1.5,
    0.25, 6.0, 2.0, 0.0
  ]);
  assert.deepEqual(calls[7], [
    "composite",
    "scene",
    "half",
    "quarter",
    "eighth",
    "sixteenth",
    "far-half",
    "far-quarter",
    "far-eighth",
    "far-sixteenth",
    "near-half",
    "near-quarter",
    "near-eighth",
    "near-sixteenth",
    "coc-sixteenth",
    "depth",
    "output",
    { querySet, endOfPassWriteIndex: 3 }
  ]);
}

// resizeはfull-resolution targetと4系統のPyramidを更新します
{
  const probe = createProbe();
  const calls = [];
  probe.outputTarget = {
    getWidth: () => 32,
    getHeight: () => 24,
    resize(width, height) {
      calls.push(["output", width, height]);
    }
  };
  probe.farFieldTarget = {
    getWidth: () => 32,
    getHeight: () => 24,
    resize(width, height) {
      calls.push(["far-field", width, height]);
    }
  };
  probe.nearFieldTarget = {
    getWidth: () => 32,
    getHeight: () => 24,
    resize(width, height) {
      calls.push(["near-field", width, height]);
    }
  };
  probe.cocFieldTarget = {
    getWidth: () => 32,
    getHeight: () => 24,
    resize(width, height) {
      calls.push(["coc-field", width, height]);
    }
  };
  probe.pyramid = {
    resize(width, height) {
      calls.push(["pyramid", width, height]);
      return true;
    }
  };
  probe.farPyramid = {
    resize(width, height) {
      calls.push(["far-pyramid", width, height]);
      return true;
    }
  };
  probe.nearPyramid = {
    resize(width, height) {
      calls.push(["near-pyramid", width, height]);
      return true;
    }
  };
  probe.cocPyramid = {
    resize(width, height) {
      calls.push(["coc-pyramid", width, height]);
      return true;
    }
  };
  assert.equal(probe.resize(64, 48), true);
  assert.deepEqual(calls, [
    ["output", 64, 48],
    ["far-field", 64, 48],
    ["near-field", 64, 48],
    ["coc-field", 64, 48],
    ["pyramid", 64, 48],
    ["far-pyramid", 64, 48],
    ["near-pyramid", 64, 48],
    ["coc-pyramid", 64, 48]
  ]);
}

console.log("PASS ComputeDofPass image-pyramid API contracts");
