// ---------------------------------------------------------
// headless_tests/core/webg_app/headless_probe.js  2026/07/12
//   WebgApp Camera Frame ownership and renderFrameToken contracts
// ---------------------------------------------------------
import assert from "node:assert/strict";
import Matrix from "../../../webg/Matrix.js";
import WebgApp from "../../../webg/WebgApp.js";
import { resolveRenderFrameTokenCameraFrame } from "../../../webg/CameraFrame.js";
import { readFileSync } from "node:fs";

// DOMやGPUを初期化せず、Camera Frame生成に必要なWebgApp fieldだけを明示します
function createAppProbe() {
  const app = Object.create(WebgApp.prototype);
  const world = new Matrix();
  world.setByEuler(20.0, -5.0, 3.0);
  world.position([1.0e10, -2.0e10, 3.0e10]);
  app.eye = {
    count: 0,
    worldMatrix: world,
    setWorldMatrix() { this.count += 1; }
  };
  app.projectionNear = 0.125;
  app.projectionFar = Infinity;
  app.viewAngle = 65.0;
  app.screen = {
    getRecommendedFov(value) { assert.equal(value, 65.0); return 61.0; },
    getAspect() { return 16.0 / 9.0; }
  };
  app.shader = {
    count: 0,
    setProjectionMatrix(matrix) { this.count += 1; this.matrix = matrix; }
  };
  app.cameraFrame = null;
  app.renderFrameToken = null;
  app.projectionMatrix = null;
  return app;
}

// 一回の更新でeye World matrixを一度snapshotし、projectionとshaderへ同じMatrixを公開します
{
  const app = createAppProbe();
  const frame = app.updateCameraFrame();
  assert.equal(app.eye.count, 1);
  assert.equal(app.cameraFrame, frame);
  assert.ok(Object.isFrozen(app.renderFrameToken));
  assert.deepEqual(Object.keys(app.renderFrameToken), []);
  assert.equal("near" in app.renderFrameToken, false);
  assert.equal("far" in app.renderFrameToken, false);
  assert.equal("projectionMatrix" in app.renderFrameToken, false);
  assert.equal("depthConvention" in app.renderFrameToken, false);
  assert.equal(
    resolveRenderFrameTokenCameraFrame(app.renderFrameToken, "probe"),
    frame
  );
  assert.equal(app.projectionMatrix, frame.projectionMatrix);
  assert.equal(app.shader.matrix, frame.projectionMatrix);
  assert.equal(app.shader.count, 1);
  assert.equal(frame.near, 0.125);
  assert.equal(frame.far, Infinity);
  assert.equal(frame.vfov, 61.0);
  assert.equal(frame.aspect, 16.0 / 9.0);
  assert.deepEqual(frame.cameraWorldPosition, [1.0e10, -2.0e10, 3.0e10]);

  const firstRenderFrameToken = app.renderFrameToken;
  const secondFrame = app.updateCameraFrame();
  assert.notEqual(app.renderFrameToken, firstRenderFrameToken);
  assert.equal(
    resolveRenderFrameTokenCameraFrame(app.renderFrameToken, "probe"),
    secondFrame
  );
}

// shapeが似たobjectをtokenとして受け入れず、内部frameを推測するfallbackを持ちません
assert.throws(
  () => resolveRenderFrameTokenCameraFrame(Object.freeze({}), "probe"),
  /requires a renderFrameToken from WebgApp/
);

// onUpdateへ前frameのtokenを渡さず、camera確定後の描画分岐でだけcontextへ設定します
{
  const source = readFileSync(new URL("../../../webg/WebgApp.js", import.meta.url), "utf8");
  assert.match(source, /cameraFrame:\s*null,\s*\n\s*renderFrameToken:\s*null/);
  assert.equal(
    (source.match(/ctx\.renderFrameToken = this\.renderFrameToken/g) ?? []).length,
    2
  );
  assert.doesNotMatch(source, /\brenderView\b|ctx\.view\s*=/);
}

// eyeがない状態を既定カメラで補わず、frame所有者の設定不足として停止します
{
  const app = createAppProbe();
  app.eye = null;
  assert.throws(() => app.updateCameraFrame(), /requires an eye Node/);
}

console.log("webg_app_camera_frame_contracts: all ownership contracts passed");
