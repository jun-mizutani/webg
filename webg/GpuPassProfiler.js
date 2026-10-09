// ---------------------------------------------
//  GpuPassProfiler.js  2026/08/10
//   Named GPU pass timestamp and CPU interval profiler
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// performance.now()が使えるブラウザではsub-millisecond精度を使い、Node.js testなどではDate.now()へ戻す
// 計測対象側が時刻取得方法を重複実装せず、CPU区間の単位を常にmillisecondへ統一する
export function readPerformanceTime() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

// 複数のRender/Compute Passへ名前付きtimestamp区間を割り当て、非同期readbackから移動平均を作る
// query結果待ちで描画loopを停止しないよう3個のslotを循環し、空きがないframeだけ計測を省略する
export default class GpuPassProfiler {

  // GPUDevice、区間名、平均sample数を検証し、timestamp-query対応時だけGPU resourceを確保する
  constructor(device, options = {}) {
    if (!device) {
      throw new Error("GpuPassProfiler requires a GPUDevice");
    }
    if (!Array.isArray(options.names) || options.names.length === 0) {
      throw new Error("GpuPassProfiler names must be a non-empty array");
    }
    this.device = device;
    this.label = typeof options.label === "string" && options.label.length > 0
      ? options.label
      : "gpu-pass-profiler";
    this.names = [...options.names];
    if (new Set(this.names).size !== this.names.length
        || this.names.some((name) => typeof name !== "string" || name.length === 0)) {
      throw new Error("GpuPassProfiler names must be unique non-empty strings");
    }
    this.nameToIndex = new Map(this.names.map((name, index) => [name, index]));
    this.sampleWindow = options.sampleWindow ?? 60;
    if (!Number.isInteger(this.sampleWindow) || this.sampleWindow < 1) {
      throw new Error("GpuPassProfiler sampleWindow must be a positive integer");
    }
    this.timestampSupported = device.features?.has?.("timestamp-query") === true;
    this.gpuSamples = new Map(this.names.map((name) => [name, []]));
    this.cpuSamples = new Map();
    this.gpuLatestMs = new Map();
    this.cpuLatestMs = new Map();
    this.lastCompletedNames = new Set();
    this.activeSlot = null;
    this.destroyed = false;
    // timestamp-query非対応deviceではCPU計測だけを継続し、GPU時間を0として誤表示しない
    this.slots = this.timestampSupported
      ? [0, 1, 2].map((index) => this.createTimestampSlot(index))
      : [];
  }

  // 1 frame分の全区間を格納するQuerySet、256 byte境界のresolve Buffer、連続read Bufferを作る
  // 各区間を個別resolveできるため、Transmission無効時など一部Passだけが記録されても読み戻せる
  createTimestampSlot(index) {
    const intervalCount = this.names.length;
    return {
      index,
      state: "idle",
      recordedNames: new Set(),
      querySet: this.device.createQuerySet({
        label: `${this.label}:query-${index}`,
        type: "timestamp",
        count: intervalCount * 2
      }),
      resolveBuffer: this.device.createBuffer({
        label: `${this.label}:resolve-${index}`,
        size: (intervalCount - 1) * 256 + 16,
        usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC
      }),
      readBuffer: this.device.createBuffer({
        label: `${this.label}:read-${index}`,
        size: intervalCount * 16,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
      })
    };
  }

  // 次の1 frameへ空きslotを割り当て、前回の記録名を消して新しいPass列を受け付ける
  // 全slotがreadback中の場合はfalseを返し、描画は続けたまま当該frameのGPU計測だけを省略する
  beginFrame() {
    this.requireAlive();
    if (!this.timestampSupported) return false;
    const slot = this.slots.find((entry) => entry.state === "idle");
    if (!slot) {
      this.activeSlot = null;
      return false;
    }
    slot.state = "recording";
    slot.recordedNames.clear();
    this.activeSlot = slot;
    return true;
  }

  // 指定名のPass開始・終了へ連続した2個のtimestamp queryを割り当てるdescriptorを返す
  // 同じ名前を1 frameで二度使う誤りは結果を上書きするため、曖昧な平均へせず例外で通知する
  getTimestampWrites(name) {
    this.requireAlive();
    const intervalIndex = this.nameToIndex.get(name);
    if (intervalIndex === undefined) {
      throw new Error(`${this.label} unknown GPU interval: ${name}`);
    }
    const slot = this.activeSlot;
    if (!slot) return undefined;
    if (slot.recordedNames.has(name)) {
      throw new Error(`${this.label} GPU interval was recorded twice: ${name}`);
    }
    slot.recordedNames.add(name);
    return {
      querySet: slot.querySet,
      beginningOfPassWriteIndex: intervalIndex * 2,
      endOfPassWriteIndex: intervalIndex * 2 + 1
    };
  }

  // 記録済み区間だけを256 byte境界へresolveし、map用Bufferでは16 byteずつ連続配置する
  // 呼び出し側は全対象Passをencoderへ追加した後、queue.submit()より前に一度だけ実行する
  endFrame(commandEncoder) {
    this.requireAlive();
    const slot = this.activeSlot;
    if (!slot) return false;
    if (!commandEncoder || typeof commandEncoder.resolveQuerySet !== "function") {
      throw new Error(`${this.label} requires GPUCommandEncoder.resolveQuerySet()`);
    }
    if (slot.recordedNames.size === 0) {
      slot.state = "idle";
      this.activeSlot = null;
      return false;
    }
    for (const name of slot.recordedNames) {
      const intervalIndex = this.nameToIndex.get(name);
      const resolveOffset = intervalIndex * 256;
      const readOffset = intervalIndex * 16;
      commandEncoder.resolveQuerySet(
        slot.querySet,
        intervalIndex * 2,
        2,
        slot.resolveBuffer,
        resolveOffset
      );
      commandEncoder.copyBufferToBuffer(
        slot.resolveBuffer,
        resolveOffset,
        slot.readBuffer,
        readOffset,
        16
      );
    }
    slot.state = "submitted";
    this.activeSlot = null;
    return true;
  }

  // encode途中の例外時にrecording slotをidleへ戻し、不完全なqueryをsubmit対象へ残さない
  cancelFrame() {
    const slot = this.activeSlot;
    if (!slot) return false;
    slot.recordedNames.clear();
    slot.state = "idle";
    this.activeSlot = null;
    return true;
  }

  // queue.submit()直後にsubmitted slotのmapAsyncを開始し、完了callbackで各区間の平均を更新する
  // Promiseをawaitしないため、GPU完了待ちをJavaScript描画loopへ持ち込まず次frameの処理を続行できる
  afterSubmit() {
    this.requireAlive();
    for (const slot of this.slots) {
      if (slot.state !== "submitted") continue;
      slot.state = "mapping";
      slot.readBuffer.mapAsync(GPUMapMode.READ).then(() => {
        const values = new BigUint64Array(slot.readBuffer.getMappedRange());
        for (const name of slot.recordedNames) {
          const intervalIndex = this.nameToIndex.get(name);
          this.addGpuSample(
            name,
            values[intervalIndex * 2],
            values[intervalIndex * 2 + 1]
          );
        }
        // 最後にreadbackが完了したframeで実行された区間だけを、合計時間の対象として記録する
        this.lastCompletedNames = new Set(slot.recordedNames);
        slot.readBuffer.unmap();
        slot.recordedNames.clear();
        slot.state = "idle";
      }).catch((error) => {
        slot.recordedNames.clear();
        slot.state = "idle";
        console.error(`${this.label} GPU timestamp readback failed:`, error);
      });
    }
  }

  // GPUの開始・終了timestampをmillisecondへ変換し、指定区間の最新値と移動平均sampleへ追加する
  // counter逆転や非有限値は異常sampleとして破棄し、正常値の平均を壊さない
  addGpuSample(name, startNs, endNs) {
    const samples = this.gpuSamples.get(name);
    if (!samples) {
      throw new Error(`${this.label} unknown GPU interval: ${name}`);
    }
    if (endNs < startNs) return false;
    const sampleMs = Number(endNs - startNs) / 1_000_000.0;
    if (!Number.isFinite(sampleMs) || sampleMs < 0.0) return false;
    samples.push(sampleMs);
    if (samples.length > this.sampleWindow) samples.shift();
    this.gpuLatestMs.set(name, sampleMs);
    return true;
  }

  // JavaScript側で測った名前付き区間をmillisecond単位で追加し、GPUと同じsample窓で平均する
  // scene集計やtriangle sortなどGPU timestampでは見えない準備時間を同じsnapshotへまとめる
  addCpuSample(name, sampleMs) {
    this.requireAlive();
    if (typeof name !== "string" || name.length === 0) {
      throw new Error(`${this.label} CPU interval name must be a non-empty string`);
    }
    if (!Number.isFinite(sampleMs) || sampleMs < 0.0) {
      throw new Error(`${this.label} CPU interval must be a non-negative finite number: ${sampleMs}`);
    }
    const samples = this.cpuSamples.get(name) ?? [];
    samples.push(sampleMs);
    if (samples.length > this.sampleWindow) samples.shift();
    this.cpuSamples.set(name, samples);
    this.cpuLatestMs.set(name, sampleMs);
    return true;
  }

  // sample配列から最新値、移動平均、保持数を作り、呼び出し側が生配列を変更できない形で返す
  summarizeSamples(samples, latestMs) {
    if (!samples || samples.length === 0) {
      return {
        latestMs: null,
        averageMs: null,
        medianMs: null,
        minimumMs: null,
        maximumMs: null,
        sampleCount: 0
      };
    }
    const averageMs = samples.reduce((sum, value) => sum + value, 0.0) / samples.length;
    const sorted = [...samples].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    const medianMs = sorted.length % 2 === 0
      ? (sorted[middle - 1] + sorted[middle]) * 0.5
      : sorted[middle];
    return {
      latestMs,
      averageMs,
      medianMs,
      minimumMs: sorted[0],
      maximumMs: sorted[sorted.length - 1],
      sampleCount: samples.length
    };
  }

  // 異常frameログ用に、配列複製や中央値sortを行わず現在のlatest値だけを返す
  // GPU値は非同期readback完了時点のsampleであり、呼出frameと同一とは限らないことも明示する
  getLatestSnapshot() {
    this.requireAlive();
    const gpu = {};
    for (const name of this.names) {
      const value = this.gpuLatestMs.get(name);
      gpu[name] = Number.isFinite(value) ? value : null;
    }
    const cpu = {};
    for (const [name, value] of this.cpuLatestMs) {
      cpu[name] = Number.isFinite(value) ? value : null;
    }
    return {
      timestampSupported: this.timestampSupported,
      gpuFrameAligned: false,
      gpu,
      cpu
    };
  }

  // 現在のGPU/CPU区間を名前別objectへ変換し、Diagnosticsやbenchmark probeへ渡す
  // GPU非対応時はsupported=falseとnull値を明示し、CPU値だけは引き続き取得可能にする
  getSnapshot() {
    this.requireAlive();
    const gpu = {};
    for (const name of this.names) {
      gpu[name] = this.summarizeSamples(
        this.gpuSamples.get(name),
        this.gpuLatestMs.get(name) ?? null
      );
    }
    const cpu = {};
    for (const [name, samples] of this.cpuSamples) {
      cpu[name] = this.summarizeSamples(samples, this.cpuLatestMs.get(name) ?? null);
    }
    const gpuAverageValues = [...this.lastCompletedNames]
      .map((name) => gpu[name]?.averageMs)
      .filter(Number.isFinite);
    return {
      timestampSupported: this.timestampSupported,
      sampleWindow: this.sampleWindow,
      gpu,
      cpu,
      activeGpuNames: [...this.lastCompletedNames],
      gpuTotalAverageMs: gpuAverageValues.length > 0
        ? gpuAverageValues.reduce((sum, value) => sum + value, 0.0)
        : null
    };
  }

  // destroy後の計測API利用を検出し、破棄済みGPU Bufferへcommandを記録しない
  requireAlive() {
    if (this.destroyed) {
      throw new Error(`${this.label} is destroyed`);
    }
  }

  // 非同期map中でないslotのBufferとQuerySetを破棄し、参照を解放する
  // pagehide時はdevice処理終了後に破棄されるため、mapping中でもcallbackが状態だけを片付けられる形を保つ
  destroy() {
    if (this.destroyed) return false;
    this.cancelFrame();
    for (const slot of this.slots) {
      slot.querySet.destroy?.();
      slot.resolveBuffer.destroy?.();
      slot.readBuffer.destroy?.();
      slot.recordedNames.clear();
    }
    this.slots = [];
    this.destroyed = true;
    return true;
  }
}
