// Each emitter owns its clock and count; the first ball is ready when play starts,
// and a blocked emitter keeps one pending spawn.
export class EmitterClock {
  constructor() { this.reset(); }
  reset() { this.states = new Map(); }
  advance(emitter, deltaSec, spawn) {
    if (!Number.isFinite(deltaSec) || deltaSec < 0) throw new Error("emitter delta must be non-negative");
    const state = this.states.get(emitter.id) ?? {
      // The first ball appears immediately after Play; intervalSec controls later balls.
      elapsed: emitter.intervalSec,
      count: 0,
      waiting: false
    };
    this.states.set(emitter.id, state);
    if (emitter.maxCount > 0 && state.count >= emitter.maxCount) return;
    state.elapsed += deltaSec;
    state.waiting = false;
    // Spawn at most the emitter capacity in one update, even after a long frame.
    for (let n = 0; n < emitter.maxActive && state.elapsed >= emitter.intervalSec; n++) {
      if (emitter.maxCount > 0 && state.count >= emitter.maxCount) break;
      if (!spawn(state.count)) { state.waiting = true; break; }
      state.count++;
      state.elapsed -= emitter.intervalSec;
    }
    state.elapsed = Math.min(state.elapsed, emitter.intervalSec);
  }
}
