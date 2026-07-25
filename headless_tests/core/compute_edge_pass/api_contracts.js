// ---------------------------------------------------------
// headless_tests/core/compute_edge_pass/headless_probe.js  2026/07/13
//   headless contracts for ComputeEdgePass
// ---------------------------------------------------------
import assert from "node:assert/strict";
import CameraFrame from "../../../webg/CameraFrame.js";
import ComputeEdgePass, {
  COMPUTE_EDGE_FORMAT
} from "../../../webg/ComputeEdgePass.js";
import { CAMERA_REVERSE_Z } from "../../../webg/DepthConvention.js";
import Matrix from "../../../webg/Matrix.js";

function createCameraFrame() {
  return new CameraFrame({
    cameraWorldMatrix: new Matrix(),
    near: 0.1,
    far: 120.0,
    vfov: 2.0 * Math.atan(0.48) * 180.0 / Math.PI,
    aspect: 1.6,
    depthConvention: CAMERA_REVERSE_Z
  });
}

// GPUDeviceを作らず、parameterとscene検証に必要な状態だけを持つprobeを作る
// Sobel edgeの契約確認をpipeline生成とは切り分け、入力と出力の責務だけを検証する
function createProbe() {
  const probe = Object.create(ComputeEdgePass.prototype);
  probe.label = "edge-probe";
  probe.width = 32;
  probe.height = 24;
  probe.destroyed = false;
  return probe;
}

// 未指定値には設計上の既定値を使い、明示された不正値は自動補正しない
{
  const probe = createProbe();
  assert.deepEqual(probe.validateEncodeOptions(), {
    strength: 1.0,
    threshold: 0.16,
    mix: 1.0,
    blendMode: "black-multiply",
    colorEnabled: true,
    geometryEnabled: false,
    normalWeight: 1.0,
    depthWeight: 1.0,
    thickness: 1,
    enabled: true
  });
  assert.throws(
    () => probe.validateEncodeOptions({ strength: -0.1 }),
    /strength must be >= 0/
  );
  assert.throws(
    () => probe.validateEncodeOptions({ threshold: 1.1 }),
    /threshold must be <= 1/
  );
  assert.throws(
    () => probe.validateEncodeOptions({ mix: 1.2 }),
    /mix must be <= 1/
  );
  assert.throws(
    () => probe.validateEncodeOptions({ blendMode: "unknown" }),
    /blendMode must be one of/
  );
  assert.throws(
    () => probe.validateEncodeOptions({ normalWeight: -0.1 }),
    /normalWeight must be >= 0/
  );
  assert.throws(
    () => probe.validateEncodeOptions({ thickness: 5 }),
    /thickness must be <= 4/
  );
  assert.throws(
    () => probe.validateEncodeOptions({ enabled: 1 }),
    /enabled must be boolean/
  );
}

// geometry edgeはnormal、depth、projectionがそろっている場合だけ使える
{
  const probe = createProbe();
  const normal = {
    getWidth: () => 32,
    getHeight: () => 24,
    getView: () => ({ label: "normal-view" })
  };
  const depth = {
    depthConvention: CAMERA_REVERSE_Z,
    getWidth: () => 32,
    getHeight: () => 24,
    getDepthSampleView: () => ({ label: "depth-view" })
  };
  const cameraFrame = createCameraFrame();
  assert.deepEqual(probe.validateGeometryResources({
    normal,
    depth,
    cameraFrame
  }, true), {
    normal,
    depth,
    projection: new Float32Array([0.1, 120.0, 0.48, 1.6]),
    cameraFrame
  });
  assert.equal(probe.validateGeometryResources({}, false), null);
  assert.throws(
    () => probe.validateGeometryResources({ normal, depth }, true),
    /requires a Reverse-Z CameraFrame/
  );
}

// sceneはViewと正しい寸法を持つ必要があり、内部targetとの寸法不一致を拒否する
{
  const probe = createProbe();
  const scene = {
    getWidth: () => 32,
    getHeight: () => 24,
    getView: () => ({ label: "scene-view" }),
    getFormat: () => COMPUTE_EDGE_FORMAT
  };
  assert.equal(probe.validateScene(scene), scene);
  assert.throws(
    () => probe.validateScene({
      ...scene,
      getWidth: () => 64
    }),
    /does not match output size/
  );
  assert.throws(
    () => probe.validateScene({
      ...scene,
      getView: () => null
    }),
    /scene view is not ready/
  );
}

// dispatchはsceneを入力に1回だけ実行され、最終output targetを返す
{
  const probe = createProbe();
  const calls = [];
  const scene = {
    label: "scene",
    getWidth: () => 32,
    getHeight: () => 24,
    getView: () => ({ label: "scene-view" }),
    getFormat: () => COMPUTE_EDGE_FORMAT
  };
  probe.outputTarget = { label: "output" };
  probe.edgePass = {
    setUniforms(values) {
      calls.push(["uniforms", ...values]);
    },
    encode(commandEncoder, resources) {
      calls.push(["encode", resources.scene.label, resources.output.label]);
    }
  };

  assert.equal(probe.encode({ beginComputePass() {} }, scene, {
    strength: 1.4,
    threshold: 0.22,
    mix: 0.65,
    blendMode: "white-add",
    thickness: 3,
    enabled: false
  }), probe.outputTarget);
  assert.deepEqual(calls, [
    ["uniforms", 1.4, 0.22, 0.65, 0.0, 2.0, 2.0, 0.0, 0.0],
    ["encode", "scene", "output"]
  ]);
}

// geometry edge経路ではnormal、depth、projectionを使ったdispatchへ切り替わる
{
  const probe = createProbe();
  const calls = [];
  const scene = {
    label: "scene",
    getWidth: () => 32,
    getHeight: () => 24,
    getView: () => ({ label: "scene-view" }),
    getFormat: () => COMPUTE_EDGE_FORMAT
  };
  const normal = {
    label: "normal",
    getWidth: () => 32,
    getHeight: () => 24,
    getView: () => ({ label: "normal-view" })
  };
  const depth = {
    label: "depth",
    depthConvention: CAMERA_REVERSE_Z,
    getWidth: () => 32,
    getHeight: () => 24,
    getDepthSampleView: () => ({ label: "depth-view" })
  };
  probe.outputTarget = { label: "output" };
  probe.geometryEdgePass = {
    setUniforms(values) {
      calls.push(["geometry-uniforms", ...values]);
    },
    encode(commandEncoder, resources) {
      calls.push([
        "geometry-encode",
        resources.scene.label,
        resources.normal.label,
        resources.depth.label,
        resources.output.label
      ]);
    }
  };

  assert.equal(probe.encode({ beginComputePass() {} }, scene, {
    strength: 1.1,
    threshold: 0.18,
    mix: 0.70,
    blendMode: "black-subtract",
    geometryEnabled: true,
    normalWeight: 1.4,
    depthWeight: 1.2,
    thickness: 4,
    enabled: true,
    normal,
    depth,
    cameraFrame: createCameraFrame()
  }), probe.outputTarget);
  assert.deepEqual(calls, [
    ["geometry-uniforms", 1.1, 0.18, 0.7, 1.0, 1.0, 3.0, 1.0, 1.0, 1.4, 1.2, 0.0, 0.0, Math.fround(0.1), 120.0, Math.fround(0.48), Math.fround(1.6)],
    ["geometry-encode", "scene", "normal", "depth", "output"]
  ]);
}

// resizeはoutput targetを同じ寸法へ更新する
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
  assert.equal(probe.resize(64, 48), true);
  assert.deepEqual(calls, [
    ["output", 64, 48]
  ]);
  assert.equal(probe.width, 64);
  assert.equal(probe.height, 48);
  assert.throws(() => probe.resize(64, 48.5), /height must be an integer/);
}

console.log("PASS ComputeEdgePass headless contracts");
