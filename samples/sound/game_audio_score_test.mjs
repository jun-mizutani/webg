// node samples/sound/game_audio_score_test.mjs
// 全プリセットの予約時刻と打音の後始末を、音声デバイスなしで検証する。
import assert from "node:assert/strict";
import GameAudioSynth from "../../webg/GameAudioSynth.js";
import { GAME_MUSIC_PRESETS } from "../../webg/GameMusicPresets.js";

class Param {
  value = 0;
  events = [];
  setValueAtTime(value, time) { this.record(value, time); }
  linearRampToValueAtTime(value, time) { this.record(value, time); }
  exponentialRampToValueAtTime(value, time) {
    assert.ok(value > 0);
    this.record(value, time);
  }
  record(value, time) {
    assert.ok(Number.isFinite(value) && Number.isFinite(time));
    assert.ok(time >= (this.events.at(-1)?.time ?? 0), "automation times must increase");
    this.events.push({value, time});
  }
}

function mockContext() {
  const nodes = [];
  const node = (kind) => {
    const result = {kind, gain:new Param(), frequency:new Param(), Q:new Param(),
      connections:[], disconnected:false,
      connect(target) { this.connections.push(target); },
      disconnect() { this.disconnected = true; },
      start(time) { this.startTime = time; },
      stop(time) { this.stopTime = time; }};
    nodes.push(result);
    return result;
  };
  return {nodes, currentTime:0, sampleRate:48000,
    createOscillator:() => node("osc"), createGain:() => node("amp"),
    createBiquadFilter:() => node("filter"), createBufferSource:() => node("noise"),
    createBuffer(channels, length, sampleRate) {
      const data = new Float32Array(length);
      return {sampleRate, getChannelData:() => data};
    }};
}

const synth = new GameAudioSynth();
synth.ctx = mockContext();
synth.bgmBus = {};
assert.equal(synth.getMelodyList().length, 24);
for (const name of synth.getMelodyList()) {
  synth.setMelody(name);
  for (const envelope of [
    {attack:.03, decay:.2, sustain:.6, release:.4},
    {attack:2, decay:2, sustain:1, release:5},
    {attack:0, decay:0, sustain:0, release:0}
  ]) {
    synth.setBgmEnvelope(envelope);
    const first = synth.ctx.nodes.length;
    synth.playingBgm = true;
    synth.songStep = 0;
    synth.nextBeatTime = .05;
    const loopDuration = 32 * synth.beat;
    synth.scheduleBgm(loopDuration + .049);
    assert.equal(synth.songStep, 0, name + ": complete eight-bar loop");
    assert.ok(Math.abs(synth.nextBeatTime - (.05 + loopDuration)) < 1e-9);
    const nodes = synth.ctx.nodes.slice(first);
    const sources = nodes.filter(n => n.kind === "osc" || n.kind === "noise");
    assert.ok(sources.some(n => n.kind === "noise"), name + ": percussion present");
    for (const source of sources) {
      assert.ok(source.stopTime > source.startTime);
      source.onended();
    }
    assert.equal(synth.scoreVoices.size, 0);
    assert.ok(nodes.every(n => n.disconnected), "all voice nodes released");
    synth.playingBgm = false;
  }
}

// 高域補正は移調後の周波数を使い、伴奏の音量には影響しない。
synth.setBgmEnvelope({attack:.03, decay:.2, sustain:.6, release:.4});
function peak(note, root, soften) {
  synth.setRootHz(root);
  synth.playScoreVoice(note, 1, .2, "square", .032, soften);
  const osc = [...synth.scoreVoices].at(-1);
  const amp = synth.ctx.nodes.at(-1);
  const gain = (amp.kind === "amp" ? amp : synth.ctx.nodes.at(-2)).gain.events[1].value;
  osc.onended();
  return gain;
}
assert.ok(peak(91, 220, true) < peak(69, 220, true));
assert.ok(peak(81, 440, true) < peak(81, 220, true));
assert.equal(peak(91, 220, false), .032);

// 曲切替は予約済みのノイズ音源も止める。
synth.playScoreDrum("snare", 10, .03);
const pending = [...synth.scoreVoices];
synth.setMelody("jazz_cafe");
assert.equal(synth.scoreVoices.size, 0);
assert.ok(pending.every(source => source.stopTime === undefined));
pending.forEach(source => source.onended());
assert.ok(synth.ctx.nodes.slice(-3).every(node => node.disconnected));

// nullを持続として扱いつつ、明示的な休符で音価を区切る。
const restSynth = new GameAudioSynth();
const config = {...GAME_MUSIC_PRESETS.jazz_cafe, leadGate:.5,
  lead:[[-1,60,null,-1,64,null,null,-1], ...Array.from({length:7}, () => Array(8).fill(-1))]};
restSynth.registerMelody("rest_probe", {...config, format:"score"});
assert.throws(() => restSynth.registerMelody("bad", {...config, format:"score", leadGate:0}));
assert.throws(() => restSynth.registerMelody("bad", {...config, format:"score",
  lead:[Array(8).fill(-2), ...config.lead.slice(1)]}));
restSynth.setMelody("rest_probe");
restSynth.scheduleAccompaniment = () => {};
restSynth.scheduleScoreDrums = () => {};
const leadCalls = [];
restSynth.playScoreVoice = (...args) => leadCalls.push(args);
restSynth.setBgmMelodyVolume(.5);
for (let step = 0; step < 8; step++) restSynth.scheduleScoreStep(step, 1);
assert.deepEqual(leadCalls.map(call => call[0]), [60,64]);
assert.ok(Math.abs(leadCalls[0][2] - restSynth.beat * .5) < 1e-9);
assert.ok(Math.abs(leadCalls[1][2] - restSynth.beat * (1 + config.swing) * .5) < 1e-9);
assert.equal(leadCalls[0][4], config.leadGain * .5);
assert.equal(leadCalls[0][6], leadCalls[0][2], "release fits the gap before a rest");
restSynth.setBgmMelodyVolume(0);
restSynth.scheduleScoreStep(1, 2);
assert.equal(leadCalls.length, 2, "muted melody schedules no voices");

// 倍率は曲切替で保持し、両パートを0にすると音源を生成しない。
synth.setBgmMelodyVolume(0);
synth.setBgmRhythmVolume(0);
synth.setMelody("jazz_corner");
const beforeMute = synth.ctx.nodes.length;
for (let step = 0; step < 64; step++) synth.scheduleScoreStep(step, 1);
assert.equal(synth.ctx.nodes.length, beforeMute);
assert.throws(() => synth.setBgmMelodyVolume(-1));
assert.throws(() => synth.setBgmRhythmVolume(3));
assert.throws(() => synth.setBgmRhythmVolume(NaN));
synth.setBgmRhythmVolume(.5);
let first = synth.ctx.nodes.length;
synth.scheduleAccompaniment(synth.melody, 0, 0, 1);
const bass = synth.ctx.nodes.slice(first).find(node => node.kind === "amp");
assert.equal(bass.gain.events[1].value, .082 * .5);
first = synth.ctx.nodes.length;
synth.scheduleScoreDrums(synth.melody, 0, 1);
const kick = synth.ctx.nodes.slice(first).find(node => node.kind === "amp");
assert.equal(kick.gain.events[1].value, .12 * .8 * .5);

// 単純な移調だけの曲を作らず、休符と音程の並びも24曲で書き分ける。
const shapes = new Set();
for (const song of Object.values(GAME_MUSIC_PRESETS)) {
  const notes = song.lead.flat();
  const firstPitch = notes.find(note => note !== null && note !== -1);
  assert.ok(notes.includes(-1), "each piece has explicit breathing space");
  shapes.add(notes.map(note => note === null ? "hold" : note === -1 ? "rest" : note - firstPitch).join(","));
}
assert.equal(shapes.size, 24);
console.log("GameAudioSynth: 24 presets, timing, envelopes, rests, part mix, cleanup OK");
