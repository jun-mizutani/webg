// node samples/sound/game_audio_se_test.mjs
// 名称互換、包絡、停止、ノイズの乱数独立性、全ノードの後始末を検証する。
import assert from "node:assert/strict";
import GameAudioSynth from "../../webg/GameAudioSynth.js";
import { GAME_SOUND_PRESETS } from "../../webg/GameSoundPresets.js";

class Param {
  value = 0;
  events = [];
  setValueAtTime(value, time) { this.record(value, time); }
  linearRampToValueAtTime(value, time) { this.record(value, time); }
  exponentialRampToValueAtTime(value, time) {
    assert.ok(value > 0);
    this.record(value, time);
  }
  cancelScheduledValues(time) { this.events = this.events.filter(event => event.time < time); }
  record(value, time) {
    assert.ok(Number.isFinite(value) && Number.isFinite(time));
    assert.ok(time >= (this.events.at(-1)?.time ?? 0), "automation must be chronological");
    this.events.push({value, time});
  }
}

function mockContext(withPanner = true) {
  const nodes = [];
  const node = (kind) => {
    const result = {kind, gain:new Param(), frequency:new Param(), Q:new Param(), pan:new Param(),
      disconnected:false, connect() {}, disconnect() { this.disconnected = true; },
      start(time) { this.startTime = time; }, stop(time) { this.stopTime = time; }};
    nodes.push(result);
    return result;
  };
  return {nodes, currentTime:0, sampleRate:48000,
    createOscillator:() => node("tone"), createGain:() => node("amp"),
    createBiquadFilter:() => node("filter"), createBufferSource:() => node("noise"),
    ...(withPanner ? {createStereoPanner:() => node("pan")} : {}),
    createBuffer(channels, length, sampleRate) {
      const data = new Float32Array(length);
      return {sampleRate, getChannelData:() => data};
    }};
}

const names = ["paddle", "wall", "block", "levelup", "gameover", "poyoon", "piyoon",
  "baan", "shupa", "coin", "jump", "laser", "damage", "powerup", "ui_move", "ui_ok",
  "countdown", "tail_probe"];
for (const withPanner of [true, false]) {
  const synth = new GameAudioSynth({randomSeed:123});
  synth.ctx = mockContext(withPanner);
  synth.ensureContext = () => synth.ctx;
  synth.seBus = {};
  assert.deepEqual(synth.getSoundEffectList(), names);
  assert.deepEqual(synth.getGameSeList(), names);
  for (const envelope of [null, {attack:2, decay:3, sustain:1, release:0},
    {attack:0, decay:0, sustain:0, release:.8}]) {
    if (envelope) for (const profile of synth.getSeEnvelopePresetList()) {
      synth.setSeEnvelopePreset(profile, envelope);
    }
    for (const name of names) {
      const info = synth.getSoundEffectInfo(name);
      assert.ok(info.profiles.includes(info.primaryProfile));
      assert.ok(info.durationSec > 0);
      const first = synth.ctx.nodes.length;
      synth.playSe(name);
      const voices = [...synth.activeVoices];
      assert.equal(voices.length, GAME_SOUND_PRESETS[name].layers.length);
      for (const voice of voices) {
        assert.ok(voice.osc.stopTime > voice.startTime);
        assert.ok(voice.stopTime <= info.durationSec + 1e-9);
        voice.osc.onended();
      }
      assert.equal(synth.activeVoices.size, 0);
      assert.ok(synth.ctx.nodes.slice(first).every(node => node.disconnected),
        name + ": source/filter/gain/panner must be released");
    }
  }
  const reference = new GameAudioSynth({randomSeed:123});
  assert.equal(synth.scoreDrumRandom.random(), reference.scoreDrumRandom.random(),
    "SE noise must not consume BGM drum random values");

  // 未来に予約したノイズも、既存の停止APIで止まる。
  const voice = synth.playGameSoundLayer(GAME_SOUND_PRESETS.block.layers[0], 10);
  synth.stopAllTones({release:.02});
  assert.equal(voice.osc.stopTime, .021);
  assert.equal(voice.stopped, true);
  voice.osc.onended();
  assert.equal(synth.activeVoices.size, 0);
  assert.throws(() => synth.playSe("unknown"));
}

// 主音色を編集すると、その音色の層と試聴待ち時間へ反映される。
const synth = new GameAudioSynth();
synth.ctx = mockContext(); synth.seBus = {};
synth.ensureContext = () => synth.ctx;
const before = synth.getSoundEffectInfo("ui_move").durationSec;
synth.setSeEnvelopePreset("guitar", {attack:.02, decay:0, sustain:.5, release:.5});
synth.playSe("ui_move");
const tone = [...synth.activeVoices][0];
assert.equal(tone.amp.gain.events[1].time, .02);
assert.equal(tone.releaseSec, .5);
assert.ok(synth.getSoundEffectInfo("ui_move").durationSec > before);
console.log("GameAudioSynth SE: 18 names, envelopes, cancellation, cleanup, random isolation OK");
