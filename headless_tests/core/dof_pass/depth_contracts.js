// ---------------------------------------------------------
// headless_tests/core/dof_pass/headless_probe.js  2026/07/13
//   Camera Reverse-Z contracts for the render-pass DofPass
// ---------------------------------------------------------
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import CameraFrame, { createRenderFrameToken } from "../../../webg/CameraFrame.js";
import DofPass, {
  createDofProjectionParams,
  DOF_REVERSE_Z_WGSL
} from "../../../webg/DofPass.js";
import {
  CAMERA_REVERSE_Z,
  projectViewDepth
} from "../../../webg/DepthConvention.js";
import Matrix from "../../../webg/Matrix.js";

// 実際のCameraFrameを作り、テスト用objectのfield不足を誤って許容しないようにします
function makeFrame(far = 5000.0) {
  return new CameraFrame({
    cameraWorldMatrix: new Matrix(),
    near: 0.25,
    far,
    vfov: 60,
    aspect: 2,
    depthConvention: CAMERA_REVERSE_Z
  });
}

// WGSLと独立したJavaScript参照式でshader式を再現します
// projectViewDepthで作ったdepthが元の正のview-space距離へ戻ることを複数距離で確認します
function linearizeLikeShader(depth, near, farUniform) {
  if (farUniform === 0.0) {
    return near / depth;
  }
  return near * farUniform / (near + depth * (farUniform - near));
}

// finite farではCameraFrameのnear/farをそのままfloat32 uniformへ格納します
{
  const frame = makeFrame(5000.0);
  const projection = createDofProjectionParams(frame);
  assert.ok(projection instanceof Float32Array);
  assert.deepEqual(Array.from(projection), [0.25, 5000.0]);

  for (const distance of [0.25, 1.0, 25.0, 1000.0, 5000.0]) {
    const depth = projectViewDepth(
      distance,
      frame.near,
      frame.far,
      CAMERA_REVERSE_Z
    );
    const restored = linearizeLikeShader(depth, projection[0], projection[1]);
    assert.ok(Math.abs(restored - distance) <= Math.max(1.0e-6, distance * 1.0e-6));
  }
}

// infinite farはfar uniformを0に符号化し、near/depthで距離を復元します
{
  const frame = makeFrame(Infinity);
  const projection = createDofProjectionParams(frame);
  assert.deepEqual(Array.from(projection), [0.25, 0.0]);

  for (const distance of [0.25, 4.0, 10000.0, 1.0e8]) {
    const depth = projectViewDepth(
      distance,
      frame.near,
      frame.far,
      CAMERA_REVERSE_Z
    );
    const restored = linearizeLikeShader(depth, projection[0], projection[1]);
    assert.ok(Math.abs(restored - distance) <= Math.max(1.0e-6, distance * 1.0e-6));
  }
}

// 通常Zobjectや不正rangeを自動補正せず、Camera Frame境界で停止します
{
  assert.throws(() => createDofProjectionParams(null), /Reverse-Z CameraFrame/);
  assert.throws(
    () => createDofProjectionParams({
      depthConvention: {},
      near: 0.1,
      far: 1000
    }),
    /Reverse-Z CameraFrame/
  );
  assert.throws(
    () => createDofProjectionParams({
      depthConvention: CAMERA_REVERSE_Z,
      near: 1,
      far: 0.5
    }),
    /far must be > 1/
  );
  assert.throws(
    () => new DofPass(null, { projectionNear: 0.1 }),
    /no longer supports projectionNear/
  );
  assert.throws(
    () => new DofPass(null, { projectionFar: 1000 }),
    /no longer supports projectionFar/
  );
}

// render-pass版の全shaderは同じReverse-Z式を埋め込み、背景0を距離へ変換しません
{
  assert.match(DOF_REVERSE_Z_WGSL, /return depth == 0\.0/);
  assert.match(DOF_REVERSE_Z_WGSL, /if \(far == 0\.0\)/);
  assert.match(DOF_REVERSE_Z_WGSL, /return near \/ depth/);
  assert.match(
    DOF_REVERSE_Z_WGSL,
    /near \+ depth \* \(far - near\)/
  );
  assert.doesNotMatch(DOF_REVERSE_Z_WGSL, /max\(/);

  const source = readFileSync(new URL("../../../webg/DofPass.js", import.meta.url), "utf8");
  assert.equal((source.match(/\$\{DOF_REVERSE_Z_WGSL\}/g) ?? []).length, 4);
  assert.doesNotMatch(source, /fn linearizeDepth\(/);
  assert.match(source, /depthConvention: CAMERA_REVERSE_Z/);
  assert.match(source, /resolveRenderFrameTokenCameraFrame\(/);
  assert.match(source, /renderFrameToken !== this\.renderFrameToken/);
  assert.doesNotMatch(source, /const cameraFrame = options\.cameraFrame/);
  assert.doesNotMatch(source, /const renderFrameToken = options\.view/);
  assert.equal(typeof DofPass.prototype.setProjectionRange, "undefined");
}

// 公開描画APIはCameraFrame直接入力を拒否し、WebgAppの不透明Viewだけを受け付けます
assert.throws(
  () => DofPass.prototype.beginScene.call({}, {}, [], { cameraFrame: {} }),
  /no longer accepts cameraFrame/
);
assert.throws(
  () => DofPass.prototype.render.call({}, {}, { cameraFrame: {} }),
  /no longer accepts cameraFrame/
);
assert.throws(
  () => DofPass.prototype.beginScene.call({}, {}, [], { view: {} }),
  /no longer accepts view/
);
assert.throws(
  () => DofPass.prototype.render.call({}, {}, { view: {} }),
  /no longer accepts view/
);

// beginSceneとrenderは同じrenderFrameTokenだけを受け入れ、内部CameraFrame identityを維持します
{
  const frame = makeFrame();
  const renderFrameToken = createRenderFrameToken(frame);
  const otherRenderFrameToken = createRenderFrameToken(makeFrame());
  const calls = [];
  const pass = {
    sceneTarget: {},
    renderFrameToken: null,
    cameraFrame: null,
    updateUniforms() { calls.push("uniforms"); },
    resizeToScreen() { calls.push("resize"); },
    runDepthDebugPass() { calls.push("depth"); },
    runFocusDebugPass() { calls.push("focus"); },
    runStageDebugPass() { calls.push("stage"); },
    runCompositePass() { calls.push("composite"); }
  };
  const screen = {
    clearColor: [0, 0, 0, 1],
    beginPass() { calls.push("begin"); }
  };

  DofPass.prototype.beginScene.call(pass, screen, screen.clearColor, { renderFrameToken });
  assert.equal(pass.renderFrameToken, renderFrameToken);
  assert.equal(pass.cameraFrame, frame);
  assert.equal(pass.sceneTarget.cameraFrame, frame);
  DofPass.prototype.render.call(pass, screen, { renderFrameToken });
  assert.deepEqual(calls, ["uniforms", "resize", "begin", "depth", "focus", "stage", "composite"]);
  assert.throws(
    () => DofPass.prototype.render.call(pass, screen, {
      renderFrameToken: otherRenderFrameToken
    }),
    /same renderFrameToken used by beginScene/
  );
}

console.log("dof_pass_depth_contracts: all render-pass DoF Reverse-Z contracts passed");
