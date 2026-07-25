// ---------------------------------------------------------
// headless_tests/core/frame_timer/headless_probe.js  2026/07/13
//   headless contracts for webg/FrameTimer.js
// ---------------------------------------------------------
import assert from "node:assert/strict";
import FrameTimer from "../../../webg/FrameTimer.js";

// timestamp-query非対応deviceでもJS時間とframe間隔は測定し、GPU値を捏造しません
{
  const times = [100.0, 102.0];
  const timer = new FrameTimer(
    { features: new Set() },
    { now: () => times.shift(), sampleWindow: 1 }
  );
  timer.beginFrame(20.0);
  timer.endFrame();
  assert.equal(timer.jsTimeMs, 2.0);
  assert.equal(timer.jsLoadPercent, 10.0);
  assert.equal(timer.gpuComputeMs, null);
  assert.equal(timer.gpuLoadPercent, null);
  assert.deepEqual(timer.getDisplayLines(), [
    "Frame interval: 20.00 ms",
    "JS time: 2.00 ms  JS load: 10.0%",
    "GPU timing: unavailable (timestamp-query)"
  ]);
}

// ComputeとRenderの平均時間を合計し、GPU loadをGPU total / frame intervalで求めます
{
  const timer = new FrameTimer(
    { features: new Set() },
    { now: () => 0.0, sampleWindow: 2 }
  );
  timer.timestampSupported = true;
  timer.frameIntervalMs = 20.0;
  assert.equal(timer.addGpuSample("compute", 1_000_000n, 3_000_000n), true);
  assert.equal(timer.addGpuSample("render", 4_000_000n, 10_000_000n), true);
  assert.equal(timer.gpuComputeMs, 2.0);
  assert.equal(timer.gpuRenderMs, 6.0);
  assert.equal(timer.getGpuTotalMs(), 8.0);
  assert.deepEqual(timer.getDisplayLines(), [
    "Frame interval: 20.00 ms",
    "GPU compute: 2.000 ms  Load: 10.0%",
    "GPU render: 6.000 ms  Load: 30.0%",
    "GPU total: 8.000 ms  GPU load: 40.0%",
    "JS time: 0.00 ms  JS load: 0.0%"
  ]);
  assert.equal(timer.addGpuSample("render", 10n, 9n), false);
}

console.log("PASS FrameTimer headless contracts");
