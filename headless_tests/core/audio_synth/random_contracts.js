// ---------------------------------------------------------
// random_contracts.js  2026/08/01
//   ToneSynth / AudioSynth independent MT19937 stream contracts
// ---------------------------------------------------------
import assert from "node:assert/strict";
import AudioSynth from "../../../webg/AudioSynth.js";
import GameAudioSynth from "../../../webg/GameAudioSynth.js";
import ToneSynth from "../../../webg/ToneSynth.js";

// 同じ基準seedから生成したreverb streamは同じimpulse tailを再現する
const toneA = new ToneSynth({ randomSeed: 1234 });
const toneB = new ToneSynth({ randomSeed: 1234 });
const profile = toneA.getImpulseProfile("room");
const tailA = new Float32Array(32);
const tailB = new Float32Array(32);
toneA.writeImpulseTail(tailA, 2.5, profile);
toneB.writeImpulseTail(tailB, 2.5, profile);
assert.deepEqual(tailA, tailB);

// reverbの消費量は、独立したrhythm / modulation streamへ影響しない
const audioA = new AudioSynth({ randomSeed: 5678 });
const audioB = new AudioSynth({ randomSeed: 5678 });
audioA.writeImpulseTail(new Float32Array(128), 2.5, audioA.getImpulseProfile("hall"));
assert.equal(audioA.rhythmRandom.random(), audioB.rhythmRandom.random());
assert.equal(audioA.modulationRandom.random(), audioB.modulationRandom.random());

// GameAudioSynthも同じoptionsを基底classへ渡し、引数なしAPIも維持する
const gameA = new GameAudioSynth({ randomSeed: 91 });
const gameB = new GameAudioSynth({ randomSeed: 91 });
assert.equal(gameA.rhythmRandom.random(), gameB.rhythmRandom.random());
assert.doesNotThrow(() => new GameAudioSynth());

// 不正seedを固定値へ置き換えず、constructorで明示的に通知する
assert.throws(
  () => new ToneSynth({ randomSeed: -1 }),
  /ToneSynth randomSeed must be >= 0/
);
assert.throws(
  () => new AudioSynth({ randomSeed: 1.5 }),
  /ToneSynth randomSeed must be an integer/
);

console.log("PASS audio synth independent MT19937 stream contracts");
