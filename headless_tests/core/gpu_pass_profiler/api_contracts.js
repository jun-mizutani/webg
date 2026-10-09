// ---------------------------------------------------------
// api_contracts.js  2026/08/04
//   Named GPU pass profiler contracts
// ---------------------------------------------------------
import assert from "node:assert/strict";
import GpuPassProfiler from "../../../webg/GpuPassProfiler.js";

// Node.jsにWebGPUのbuffer usage定数だけを与え、実GPUなしでresource配置とcommand記録を検証する
globalThis.GPUBufferUsage = {
  QUERY_RESOLVE: 1,
  COPY_SRC: 2,
  COPY_DST: 4,
  MAP_READ: 8
};

const createdBuffers = [];
const device = {
  features: new Set(["timestamp-query"]),
  createQuerySet: (descriptor) => ({ descriptor, destroy() {} }),
  createBuffer: (descriptor) => {
    const buffer = { descriptor, destroy() {} };
    createdBuffers.push(buffer);
    return buffer;
  }
};

// 名前ごとに2 queryを割り当て、resolve元は256 byte境界、readback先は16 byte間隔へ詰める
{
  const profiler = new GpuPassProfiler(device, {
    label: "test-profiler",
    names: ["mask", "composite"],
    sampleWindow: 2
  });
  assert.equal(profiler.beginFrame(), true);
  assert.deepEqual(profiler.getTimestampWrites("composite"), {
    querySet: profiler.slots[0].querySet,
    beginningOfPassWriteIndex: 2,
    endOfPassWriteIndex: 3
  });
  const resolveCalls = [];
  const copyCalls = [];
  const encoder = {
    resolveQuerySet: (...args) => resolveCalls.push(args),
    copyBufferToBuffer: (...args) => copyCalls.push(args)
  };
  assert.equal(profiler.endFrame(encoder), true);
  assert.equal(resolveCalls.length, 1);
  assert.equal(resolveCalls[0][4], 256);
  assert.equal(copyCalls[0][1], 256);
  assert.equal(copyCalls[0][3], 16);
  assert.equal(createdBuffers[0].descriptor.size, 272);
  assert.equal(createdBuffers[1].descriptor.size, 32);
  profiler.destroy();
}

// GPU/CPU sampleは指定窓の移動平均を返し、timestamp-query非対応時はGPUをnullのまま保持する
{
  const profiler = new GpuPassProfiler(
    { features: new Set() },
    { names: ["forward"], sampleWindow: 2 }
  );
  profiler.addGpuSample("forward", 1_000_000n, 2_000_000n);
  profiler.addGpuSample("forward", 2_000_000n, 5_000_000n);
  profiler.addCpuSample("sort", 0.2);
  profiler.addCpuSample("sort", 0.4);
  const snapshot = profiler.getSnapshot();
  assert.equal(snapshot.timestampSupported, false);
  assert.equal(snapshot.gpu.forward.averageMs, 2.0);
  assert.ok(Math.abs(snapshot.cpu.sort.averageMs - 0.3) < 1.0e-12);
  assert.equal(snapshot.gpuTotalAverageMs, null);
  assert.equal(profiler.beginFrame(), false);
}

console.log("PASS GpuPassProfiler contracts");
