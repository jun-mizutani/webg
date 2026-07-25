// ---------------------------------------------
// FrameTimer.js  2026/06/14
//   Frame interval, JavaScript, and GPU timing helper
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
// GPU timestampとJavaScript処理時間を同じframe間隔に対する割合へ変換する
// GPU readbackは複数slotを循環させ、mapAsync完了をframe loop内でawaitしない
export default class FrameTimer {
  // WebGPU deviceと計測optionを受け取り、JS計測状態とGPU query slotを初期化する
  // timestamp-query未対応deviceではGPU resourceを作らず、JS時間だけを計測できる状態にする
  constructor(device, options = {}) {
    if (!device) {
      throw new Error("FrameTimer requires a GPUDevice");
    }
    this.device = device;
    // nowはJS処理時間を得る時刻取得関数で、testでは決定的な値を返す関数へ差し替えられる
    this.now = options.now ?? (() => performance.now());
    this.sampleWindow = options.sampleWindow ?? 30;
    if (!Number.isInteger(this.sampleWindow) || this.sampleWindow < 1) {
      throw new Error("FrameTimer sampleWindow must be a positive integer");
    }
    this.timestampSupported = device.features?.has?.("timestamp-query") === true;
    this.samples = [];
    this.gpuComputeSamples = [];
    this.gpuRenderSamples = [];
    this.frameIntervalMs = 0.0;
    this.jsTimeMs = 0.0;
    this.gpuComputeMs = null;
    this.gpuRenderMs = null;
    this.jsLoadPercent = 0.0;
    this.gpuLoadPercent = null;
    this.frameJsStartedAt = 0.0;
    this.activeSlot = null;
    // timestamp-query対応時だけ3個のslotを生成し、GPU実行とCPU readbackを重ねられるようにする
    this.slots = this.timestampSupported
      ? [0, 1, 2].map((index) => this.createTimestampSlot(index))
      : [];
  }

  // 1 frame分のCompute/Render timestampを保存するquery setとreadback Bufferを作る
  // indexは3個の非同期slotを識別するlabelに使い、返したobjectがslotの状態遷移を保持する
  createTimestampSlot(index) {
    return {
      index,
      state: "idle",
      computeRecorded: false,
      renderRecorded: false,
      querySet: this.device.createQuerySet({
        label: `frame-timer:query-${index}`,
        type: "timestamp",
        count: 4
      }),
      resolveBuffer: this.device.createBuffer({
        label: `frame-timer:resolve-${index}`,
        // resolveQuerySet()のdestination offsetは256 byte alignmentが必要
        // Computeを0、Renderを256へ置き、readback時だけ連続した32 byteへ詰め直す
        size: 272,
        usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC
      }),
      readBuffer: this.device.createBuffer({
        label: `frame-timer:read-${index}`,
        size: 32,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
      })
    };
  }

  // requestAnimationFrameで確定したframe間隔を保存し、同期JavaScript処理の計測を開始する
  // 負値や非有限値は時刻管理の異常なので補正せず例外にする
  beginFrame(frameIntervalMs) {
    if (!Number.isFinite(frameIntervalMs) || frameIntervalMs < 0.0) {
      throw new Error(`FrameTimer frame interval must be non-negative: ${frameIntervalMs}`);
    }
    this.frameIntervalMs = frameIntervalMs;
    this.frameJsStartedAt = this.now();
  }

  // render command発行と入力更新が終わった段階でJavaScript処理時間を確定する
  // frame間隔と処理時間を移動平均用配列へ追加し、表示用の平均値を更新する
  endFrame() {
    const jsTimeMs = this.now() - this.frameJsStartedAt;
    if (!Number.isFinite(jsTimeMs) || jsTimeMs < 0.0) {
      throw new Error(`FrameTimer JavaScript time must be non-negative: ${jsTimeMs}`);
    }
    this.samples.push({
      frameIntervalMs: this.frameIntervalMs,
      jsTimeMs
    });
    if (this.samples.length > this.sampleWindow) {
      this.samples.shift();
    }
    this.updateAverages();
  }

  // 保存済みのframe sampleからframe間隔、JS時間、各loadの移動平均を再計算する
  // 初回frameの0 msは割合計算に使わず、正のframe間隔を持つsampleだけを対象にする
  updateAverages() {
    if (this.samples.length === 0) return;
    // 初回frameの0 msを除外し、実際のframe間隔を持つsampleだけを新しい配列へ抽出する
    const validFrames = this.samples.filter((sample) => sample.frameIntervalMs > 0.0);
    if (validFrames.length === 0) return;
    // reduce callbackは各sampleのframe間隔を加算し、sample数で割るための合計値を作る
    const frameMs = validFrames.reduce((sum, sample) => sum + sample.frameIntervalMs, 0.0) / validFrames.length;
    // reduce callbackは同じsample集合のJS処理時間を加算し、frame平均と対応するJS平均を作る
    const jsMs = validFrames.reduce((sum, sample) => sum + sample.jsTimeMs, 0.0) / validFrames.length;
    this.frameIntervalMs = frameMs;
    this.jsTimeMs = jsMs;
    this.jsLoadPercent = frameMs > 0.0 ? jsMs / frameMs * 100.0 : 0.0;
    if (Number.isFinite(this.gpuComputeMs) || Number.isFinite(this.gpuRenderMs)) {
      this.gpuLoadPercent = frameMs > 0.0 ? this.getGpuTotalMs() / frameMs * 100.0 : 0.0;
    }
  }

  // これから記録する1 frame分のGPU計測に空きslotを割り当てる
  // 3 slotすべてがreadback中ならfalseを返し、描画を止めずそのframeの計測だけを省略する
  beginGpuTiming() {
    if (!this.timestampSupported) return false;
    // find callbackでidle状態の先頭slotを探し、同じslotを複数frameから同時利用しないようにする
    const slot = this.slots.find((entry) => entry.state === "idle");
    if (!slot) {
      this.activeSlot = null;
      return false;
    }
    slot.state = "recording";
    slot.computeRecorded = false;
    slot.renderRecorded = false;
    this.activeSlot = slot;
    return true;
  }

  // Compute Passの先頭または末尾へtimestamp書き込みを設定するdescriptorを返す
  // 複数substepでは最初のpassだけbegin、最後のpassだけendをtrueにして反復全体を計測する
  getGpuTimestampWrites(begin, end) {
    return this.getPassTimestampWrites("compute", begin, end);
  }

  // Render Pass全体の開始と終了をquery index 2 / 3へ記録するdescriptorを返す
  // Vertex / rasterization / Fragment / attachment処理を分離せず、Render Pass全体として計測する
  getGpuRenderTimestampWrites(begin = true, end = true) {
    return this.getPassTimestampWrites("render", begin, end);
  }

  // ComputeまたはRenderの種類と開始/終了flagからWebGPUのtimestampWritesを組み立てる
  // active slotがない場合や中央substepの場合はundefinedを返し、pass descriptorから設定を省略させる
  getPassTimestampWrites(passType, begin, end) {
    const slot = this.activeSlot;
    if (!slot) return undefined;
    if (begin !== true && end !== true) return undefined;
    if (passType !== "compute" && passType !== "render") {
      throw new Error(`FrameTimer unknown pass type: ${passType}`);
    }
    const queryOffset = passType === "compute" ? 0 : 2;
    if (passType === "compute") slot.computeRecorded = true;
    if (passType === "render") slot.renderRecorded = true;
    const timestampWrites = { querySet: slot.querySet };
    if (begin === true) timestampWrites.beginningOfPassWriteIndex = queryOffset;
    if (end === true) timestampWrites.endOfPassWriteIndex = queryOffset + 1;
    return timestampWrites;
  }

  // 全passの記録後にquery解決とmap-read Bufferへのcopy commandをencoderへ追加する
  // 実際に記録したCompute/Render区間だけを解決し、submit後にreadbackできるsubmitted状態へ進める
  endGpuTiming(encoder) {
    const slot = this.activeSlot;
    if (!slot) return false;
    if (!encoder || typeof encoder.resolveQuerySet !== "function") {
      throw new Error("FrameTimer requires GPUCommandEncoder.resolveQuerySet()");
    }
    if (!slot.computeRecorded && !slot.renderRecorded) {
      throw new Error("FrameTimer requires a recorded Compute or Render Pass");
    }
    if (slot.computeRecorded) {
      encoder.resolveQuerySet(slot.querySet, 0, 2, slot.resolveBuffer, 0);
    }
    if (slot.renderRecorded) {
      encoder.resolveQuerySet(slot.querySet, 2, 2, slot.resolveBuffer, 256);
    }
    if (slot.computeRecorded) {
      encoder.copyBufferToBuffer(slot.resolveBuffer, 0, slot.readBuffer, 0, 16);
    }
    if (slot.renderRecorded) {
      encoder.copyBufferToBuffer(slot.resolveBuffer, 256, slot.readBuffer, 16, 16);
    }
    slot.state = "submitted";
    this.activeSlot = null;
    return true;
  }

  // queue.submit()直後に呼び、submitted状態のslotを非同期map処理へ進める
  // Promiseをawaitせず、完了callbackで平均値を更新してslotを次frameで再利用可能に戻す
  afterSubmit() {
    for (const slot of this.slots) {
      if (slot.state !== "submitted") continue;
      slot.state = "mapping";
      // mapAsync成功callbackでGPUが書いた4個のtimestampを読み、区間別の移動平均へ反映する
      slot.readBuffer.mapAsync(GPUMapMode.READ).then(() => {
        const values = new BigUint64Array(slot.readBuffer.getMappedRange());
        if (slot.computeRecorded) {
          this.addGpuSample("compute", values[0], values[1]);
        }
        if (slot.renderRecorded) {
          this.addGpuSample("render", values[2], values[3]);
        }
        const gpuTotalMs = this.getGpuTotalMs();
        this.gpuLoadPercent = this.frameIntervalMs > 0.0
          ? gpuTotalMs / this.frameIntervalMs * 100.0
          : 0.0;
        slot.readBuffer.unmap();
        slot.computeRecorded = false;
        slot.renderRecorded = false;
        slot.state = "idle";
      // mapAsync失敗callbackでslotを再利用可能に戻し、失敗理由をconsoleへ明示する
      }).catch((error) => {
        slot.computeRecorded = false;
        slot.renderRecorded = false;
        slot.state = "idle";
        console.error("GPU timestamp readback failed:", error);
      });
    }
  }

  // 取得した開始/終了timestampをmsへ変換し、ComputeまたはRenderの移動平均へ追加する
  // timestamp counterがresetして値が逆転したsampleは巨大値に変換せずfalseを返して破棄する
  addGpuSample(passType, startNs, endNs) {
    if (endNs < startNs) return false;
    const sampleMs = Number(endNs - startNs) / 1_000_000.0;
    if (!Number.isFinite(sampleMs) || sampleMs < 0.0) return false;
    const samples = passType === "compute"
      ? this.gpuComputeSamples
      : this.gpuRenderSamples;
    samples.push(sampleMs);
    if (samples.length > this.sampleWindow) {
      samples.shift();
    }
    // reduce callbackで対象区間のsampleを合計し、表示に使う移動平均時間を求める
    const averageMs = samples.reduce((sum, sample) => sum + sample, 0.0) / samples.length;
    if (passType === "compute") this.gpuComputeMs = averageMs;
    if (passType === "render") this.gpuRenderMs = averageMs;
    return true;
  }

  // 現在のCompute平均とRender平均を加算し、計測対象GPU区間の合計msを返す
  // まだ取得していない区間は0として扱い、片方だけ取得済みの表示にも使用できるようにする
  getGpuTotalMs() {
    const computeMs = Number.isFinite(this.gpuComputeMs) ? this.gpuComputeMs : 0.0;
    const renderMs = Number.isFinite(this.gpuRenderMs) ? this.gpuRenderMs : 0.0;
    return computeMs + renderMs;
  }

  // Help panelへ渡す英語の計測行を、現在の移動平均値から組み立てる
  // timestamp-query未対応時はGPU値を0で代用せずunavailableを明示する
  getDisplayLines() {
    const frame = this.frameIntervalMs > 0.0 ? this.frameIntervalMs.toFixed(2) : "--";
    const jsTime = this.jsTimeMs >= 0.0 ? this.jsTimeMs.toFixed(2) : "--";
    const jsLoad = Number.isFinite(this.jsLoadPercent) ? this.jsLoadPercent.toFixed(1) : "--";
    if (!this.timestampSupported) {
      return [
        `Frame interval: ${frame} ms`,
        `JS time: ${jsTime} ms  JS load: ${jsLoad}%`,
        "GPU timing: unavailable (timestamp-query)"
      ];
    }
    const computeTime = Number.isFinite(this.gpuComputeMs) ? this.gpuComputeMs.toFixed(3) : "--";
    const renderTime = Number.isFinite(this.gpuRenderMs) ? this.gpuRenderMs.toFixed(3) : "--";
    const hasGpuTotal = Number.isFinite(this.gpuComputeMs) || Number.isFinite(this.gpuRenderMs);
    const gpuTotalMs = hasGpuTotal ? this.getGpuTotalMs() : null;
    const totalTime = Number.isFinite(gpuTotalMs) ? gpuTotalMs.toFixed(3) : "--";
    const computeLoadPercent = Number.isFinite(this.gpuComputeMs) && this.frameIntervalMs > 0.0
      ? this.gpuComputeMs / this.frameIntervalMs * 100.0
      : null;
    const renderLoadPercent = Number.isFinite(this.gpuRenderMs) && this.frameIntervalMs > 0.0
      ? this.gpuRenderMs / this.frameIntervalMs * 100.0
      : null;
    const totalLoadPercent = Number.isFinite(gpuTotalMs) && this.frameIntervalMs > 0.0
      ? gpuTotalMs / this.frameIntervalMs * 100.0
      : null;
    const computeLoad = Number.isFinite(computeLoadPercent) ? computeLoadPercent.toFixed(1) : "--";
    const renderLoad = Number.isFinite(renderLoadPercent) ? renderLoadPercent.toFixed(1) : "--";
    const totalLoad = Number.isFinite(totalLoadPercent) ? totalLoadPercent.toFixed(1) : "--";
    return [
      `Frame interval: ${frame} ms`,
      `GPU compute: ${computeTime} ms  Load: ${computeLoad}%`,
      `GPU render: ${renderTime} ms  Load: ${renderLoad}%`,
      `GPU total: ${totalTime} ms  GPU load: ${totalLoad}%`,
      `JS time: ${jsTime} ms  JS load: ${jsLoad}%`
    ];
  }
}
