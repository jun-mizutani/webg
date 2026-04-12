// ---------------------------------------------
//  DebugProbe.js  2026/03/09
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import DebugConfig from "./DebugConfig.js";

export default class DebugProbe {

  constructor(options = {}) {
    this.defaultAfterFrames = Number.isInteger(options.defaultAfterFrames)
      ? Math.max(1, options.defaultAfterFrames)
      : 1;
    this.pending = [];
    this.lastResult = null;
    this.sequence = 0;
  }

  // 既定は 1 フレーム後に 1 回だけ採取する
  request(options = {}) {
    if (!DebugConfig.isEnabled("enableProbe")) {
      return null;
    }
    const afterFrames = Number.isInteger(options.afterFrames)
      ? Math.max(1, options.afterFrames)
      : this.defaultAfterFrames;
    const entry = {
      id: ++this.sequence,
      label: options.label ?? `probe_${this.sequence}`,
      format: options.format ?? "text",
      afterFrames,
      createdAtFrame: Number.isInteger(options.frameCount) ? options.frameCount : 0,
      collect: typeof options.collect === "function" ? options.collect : (() => null),
      onReady: typeof options.onReady === "function" ? options.onReady : null
    };
    this.pending.push(entry);
    return entry.id;
  }

  // フレーム更新側から呼び、発火した 1 回分だけ collect する
  update(frameCount) {
    if (!DebugConfig.isEnabled("enableProbe")) {
      return null;
    }
    if (this.pending.length === 0) {
      return null;
    }
    for (let i = 0; i < this.pending.length; i++) {
      const entry = this.pending[i];
      if (frameCount - entry.createdAtFrame < entry.afterFrames) {
        continue;
      }
      this.pending.splice(i, 1);
      const payload = entry.collect();
      this.lastResult = {
        id: entry.id,
        label: entry.label,
        format: entry.format,
        frameCount,
        payload
      };
      if (entry.onReady) {
        entry.onReady(this.lastResult);
      }
      return this.lastResult;
    }
    return null;
  }

  hasPending() {
    return this.pending.length > 0;
  }

  getPendingCount() {
    return this.pending.length;
  }

  getLastResult() {
    return this.lastResult;
  }

  clear() {
    this.pending = [];
    this.lastResult = null;
  }
}
