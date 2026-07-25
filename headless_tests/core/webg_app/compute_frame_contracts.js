// ---------------------------------------------------------
// headless_tests/core/webg_app/headless_probe.js  2026/07/13
//   headless contracts for WebgApp compute-first frame
// ---------------------------------------------------------
import assert from "node:assert/strict";
import Matrix from "../../../webg/Matrix.js";
import WebgApp from "../../../webg/WebgApp.js";

// WebgApp constructorはDOMとGPUの初期化を行うため、このprobeでは呼びません
// frame()が参照するfieldとmethodだけを明示的に用意し、コアのCompute-first処理順、
// 停止条件、handler契約をGPUなしで検証します
// constructorを通さず、1 frameに必要な最小stateを持つWebgAppを作ります
// testごとに新しいobjectを返し、時刻やevent配列が別testへ残らないようにします
function createProbeApp() {
  const app = Object.create(WebgApp.prototype);
  app.events = [];
  app.computeFrame = true;
  app.running = true;
  app._frameScheduled = true;
  app.lastFrameTime = 1000.0;
  app.runtimeElapsedSec = 0.0;
  app.elapsedSec = 0.0;
  app.eye = {
    worldMatrix: new Matrix(),
    setWorldMatrix() {}
  };
  app.projectionNear = 0.1;
  app.projectionFar = 1000.0;
  app.viewAngle = 60.0;
  app.screen = {
    getRecommendedFov: (value) => value,
    getAspect: () => 16.0 / 9.0
  };
  app.shader = null;
  app.cameraFrame = null;
  app.renderFrameToken = null;
  app.projectionMatrix = null;
  app.handlers = {
    onFrameTiming: (deltaMs, timeMs) => {
      app.events.push(["timing", deltaMs, timeMs]);
    },
    onUpdate: (ctx) => {
      app.events.push(["update", ctx.timeMs, ctx.deltaSec]);
      return false;
    },
    onComputeFrame: (ctx) => {
      app.events.push(["render", ctx.timeMs, ctx.deltaSec]);
    },
    onBeforeDraw: null,
    onAfterDraw3d: null,
    onAfterHud: null
  };
  app.input = {
    beginFrame: () => app.events.push(["input"])
  };
  app.frameTimer = {
    beginFrame: (deltaMs) => app.events.push(["timer-begin", deltaMs]),
    endFrame: () => app.events.push(["timer-end"])
  };
  app.shouldAutoPauseFrameLoop = () => false;
  app.updateManagedEyeRig = () => false;
  app.getFrameContext = (timeMs) => ({
    app,
    timeMs,
    timeSec: timeMs * 0.001,
    deltaSec: app.elapsedSec
  });
  app.requestRender = () => {
    app.events.push(["request"]);
    return true;
  };
  return app;
}

// 通常frameではtiming hook、update、compute render、input、次frame予約の順になることを確認します
{
  const app = createProbeApp();
  app.frame(1016.0);
  assert.equal(app.elapsedSec, 0.016);
  assert.equal(app.runtimeElapsedSec, 0.016);
  assert.equal(app.lastFrameTime, 1016.0);
  assert.deepEqual(app.events, [
    ["timer-begin", 16.0],
    ["timing", 16.0, 1016.0],
    ["update", 1016.0, 0.016],
    ["render", 1016.0, 0.016],
    ["input"],
    ["timer-end"],
    ["request"]
  ]);
}

// onUpdateがtrueを返した場合はGPU commandを発行せず、そのframeでloopを停止することを確認します
{
  const app = createProbeApp();
  app.handlers.onUpdate = () => true;
  app.frame(1016.0);
  assert.equal(app.running, false);
  assert.deepEqual(app.events, [
    ["timer-begin", 16.0],
    ["timing", 16.0, 1016.0],
    ["timer-end"]
  ]);
}

// page非表示相当では時刻基準をresetし、updateやrenderへ進まないことを確認します
{
  const app = createProbeApp();
  app.shouldAutoPauseFrameLoop = () => true;
  app.frame(1016.0);
  assert.equal(app.lastFrameTime, 0.0);
  assert.deepEqual(app.events, []);
}

// 時刻が逆行した場合はdeltaを0へ補正せず、simulation異常として例外にすることを確認します
{
  const app = createProbeApp();
  assert.throws(
    () => app.frame(999.0),
    /requires non-negative time delta/
  );
  assert.deepEqual(app.events, []);
}

// Compute-first handlerを指定し忘れた場合に、無表示で継続せず例外になることを確認します
{
  const app = Object.create(WebgApp.prototype);
  app.handlers = { onComputeFrame: null };
  assert.throws(
    () => app.renderComputeFrame({ timeMs: 0.0, deltaSec: 0.0 }),
    /requires start\(\{ onComputeFrame \}\)/
  );
}

// start()はCompute-first設定とhandlerの不一致をloop開始前に検出します
{
  const app = new WebgApp({ document: {}, computeFrame: true });
  app.requestRender = () => true;
  assert.throws(
    () => app.start(),
    /requires start\(\{ onComputeFrame \}\)/
  );
}

{
  const app = new WebgApp({ document: {} });
  app.requestRender = () => true;
  assert.throws(
    () => app.start({ onComputeFrame: () => {} }),
    /requires computeFrame: true/
  );
}

console.log("PASS WebgApp compute-first headless contracts");
