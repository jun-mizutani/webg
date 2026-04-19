// ---------------------------------------------
//  GameAudioSynth.js   2026/04/19
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import AudioSynth from "./AudioSynth.js";

export default class GameAudioSynth extends AudioSynth {

  constructor() {
    super();

    this.installMelodyPresets();
    this.installSePresets();

    // 既定メロディ
    this.setMelody("minor_drive");

    // BGM は少し長めの余韻を持つ既定値にする
    this.setBgmEnvelope({ attack: 0.03, decay: 0.2, sustain: 0.6, release: 0.4 });
  }

  // GameAudioSynth向けの発音ヘルパー
  // profile でエンベロープ形を選び、optionsで上書き可能
  playGameTone(freq, dur = 0.12, profile = "soft", options = {}) {
    this.playTone(freq, dur, { profile, ...options });
  }

  // AudioSynth の registerMelody() を使って、
  // ゲーム向けのメロディパターンをまとめて追加する
  installMelodyPresets() {
    const defaultLeadHoldSteps = [1, 1, 1, 1.6, 1, 1, 1, 2.0, 1, 1, 1, 1.6, 1, 1, 1, 2.4];
    const defaultRhythmDropWeakProb = 0.30;
    const defaultRhythmDropTailProb = 0.55;
    // 既定 + 追加の共通プリセット（登録経路を一本化）
    // BGM は 1 小節の短い反復だけで終わらせず、
    // 2 小節以上の lead phrase と 8 step の bass cycle を使うと、
    // 同じフレーズの連打に聞こえにくくなる
    const basePresets = [
      { name: "minor_drive",
        scale: [0, 2, 3, 5, 7, 8, 10],
        bassPattern: [0, -5, -2, -7, 0, -3, -5, -2],
        bassOctave: 0,
        // 2 小節ぶんの明示的な phrase にして、bar 反復をそのまま感じにくくする
        leadDegrees: [0, 2, 3, 5, 3, 2, 0, null, 0, 2, 3, 5, 7, 5, 3, 2, 0, 2, 3, 5, 6, 5, 3, 2, 0, 2, 3, 5, 7, 8, 7, 5],
        // 強拍と終端だけ音価を伸ばし、フレーズの切れ目が分かるようにする
        leadHoldSteps: [2.0, 1.0, 1.0, 1.8, 1.0, 1.0, 1.0, 2.4, 1.0, 1.0, 1.0, 1.8, 1.0, 1.0, 1.0, 2.6, 1.0, 1.0, 1.0, 1.8, 1.0, 1.0, 1.0, 2.2, 1.0, 1.0, 1.0, 1.8, 1.0, 1.0, 1.0, 3.0],
        leadOctave: 12,
        leadType: "square",
        leadDur: 0.11,
        leadGain: 0.06,
        bassType: "triangle",
        bassDur: 0.20,
        bassGain: 0.08 },
      { name: "bright_arp",
        scale: [0, 2, 4, 7, 9, 12],
        bassPattern: [0, -3, -5, -2, 0, -5, -3, -2],
        bassOctave: -12,
        // 上昇と下降を 2 周ぶん並べ、アルペジオがすぐ同じ形に戻らないようにする
        leadDegrees: [0, 2, 4, 6, 5, 4, 2, 0, 0, 2, 4, 6, 5, 4, 2, 0, 0, 3, 5, 6, 8, 6, 5, 3, 0, 2, 4, 6, 9, 8, 6, 4],
        leadOctave: 12,
        leadType: "triangle",
        leadDur: 0.10,
        leadGain: 0.065,
        bassType: "triangle",
        bassDur: 0.16,
        bassGain: 0.075 },
      { name: "sparse_echo",
        scale: [0, 3, 5, 7, 10],
        bassPattern: [0, null, -5, null],
        bassOctave: -12,
        leadDegrees: [0, null, 2, null, 4, null, 2, null, 0, null, 5, null, 4, null, 2, null],
        leadOctave: 12,
        leadType: "sine",
        leadDur: 0.18,
        leadGain: 0.05,
        bassType: "sawtooth",
        bassDur: 0.12,
        bassGain: 0.06,
        rhythmDropWeakProb: 0.55,
        rhythmDropTailProb: 0.75 },
      { name: "hero_run",
        scale: [0, 2, 4, 5, 7, 9, 11],
        bassPattern: [0, -5, -3, -7, 0, -2, -5, -3],
        bassOctave: -12,
        leadDegrees: [0, 2, 4, 5, 7, 5, 4, 2, 0, 2, 3, 5, 7, 9, 7, 5, 4, 2, 0, 2, 4, 5, 7, 9, 11, 9, 7, 5, 4, 2, 0, 2],
        leadOctave: 12,
        leadType: "square",
        leadDur: 0.09,
        leadGain: 0.065,
        bassType: "triangle",
        bassDur: 0.18,
        bassGain: 0.08,
        rhythmDropWeakProb: 0.22,
        rhythmDropTailProb: 0.45 },
      { name: "sky_hop",
        scale: [0, 2, 4, 7, 9, 12],
        bassPattern: [0, -3, -5, -2],
        bassOctave: -12,
        leadGate: [0, 2, 4, 6, 8, 10, 12, 14],
        leadDegreeStep: 2,
        leadOctave: 12,
        leadType: "triangle",
        leadDur: 0.12,
        leadGain: 0.06,
        bassType: "triangle",
        bassDur: 0.15,
        bassGain: 0.07,
        rhythmDropWeakProb: 0.28,
        rhythmDropTailProb: 0.50 },
      { name: "cave_pulse",
        scale: [0, 2, 3, 5, 7, 8, 10],
        bassPattern: [0, null, -5, null],
        bassOctave: -12,
        leadDegrees: [0, null, 2, null, 3, null, 5, null, 7, null, 5, null, 3, null, 2, null],
        leadOctave: 12,
        leadType: "sine",
        leadDur: 0.18,
        leadGain: 0.05,
        bassType: "sawtooth",
        bassDur: 0.12,
        bassGain: 0.06,
        rhythmDropWeakProb: 0.58,
        rhythmDropTailProb: 0.75 },
      { name: "boss_alert",
        scale: [0, 1, 3, 5, 6, 8, 10],
        bassPattern: [0, -1, -5, -6, 0, -2, -5, -6],
        bassOctave: -12,
        leadDegrees: [0, 3, 6, 3, 1, 3, 6, 8, 6, 3, 1, 0, 10, 8, 6, 3, 0, 3, 6, 8, 10, 8, 6, 3, 1, 3, 6, 8, 10, 8, 6, 3],
        leadOctave: 12,
        leadType: "sawtooth",
        leadDur: 0.10,
        leadGain: 0.068,
        bassType: "square",
        bassDur: 0.20,
        bassGain: 0.082,
        rhythmDropWeakProb: 0.18,
        rhythmDropTailProb: 0.40 },
      { name: "retro_pop",
        scale: [0, 2, 4, 5, 7, 9, 11],
        bassPattern: [0, -7, -5, -3],
        bassOctave: -12,
        leadGate: [0, 1, 3, 4, 6, 8, 9, 11, 12, 14],
        leadDegreeStep: 5,
        leadOctave: 12,
        leadType: "square",
        leadDur: 0.09,
        leadGain: 0.062,
        bassType: "triangle",
        bassDur: 0.14,
        bassGain: 0.074,
        rhythmDropWeakProb: 0.32,
        rhythmDropTailProb: 0.58 },
      { name: "night_drive",
        scale: [0, 2, 3, 5, 7, 8, 10],
        bassPattern: [0, -5, -2, -7, 0, -3, -5, -1],
        bassOctave: -12,
        leadDegrees: [0, 2, 3, 5, 7, 5, 3, 2, 0, null, 2, 3, 5, 7, 8, 7, 5, 3, 2, 0, 2, 3, 5, 7, 8, 10, 8, 7, 5, 3, 2, 0],
        // 中盤と小節終端の音を長めに保持して、浮遊感を強める
        leadHoldSteps: [1.0, 1.0, 1.0, 1.8, 1.0, 1.0, 1.0, 2.2, 1.0, 1.0, 1.0, 1.8, 1.0, 1.0, 1.0, 2.8, 1.0, 1.0, 1.0, 1.8, 1.0, 1.0, 1.0, 2.2, 1.0, 1.0, 1.0, 1.8, 1.0, 1.0, 1.0, 3.0],
        leadOctave: 12,
        leadType: "triangle",
        leadDur: 0.12,
        leadGain: 0.058,
        bassType: "triangle",
        bassDur: 0.18,
        bassGain: 0.072,
        rhythmDropWeakProb: 0.35,
        rhythmDropTailProb: 0.62 }
    ];

    // 追加メロディプリセットも、1 小節で lead と bass が同時に巻き戻ると
    // 「新しい名前のプリセットなのに反復感だけが目立つ」状態になりやすい
    // そのため basePresets 本体と同様に、2 小節以上の phrase と
    // 8 step の bass cycle を持たせて、同じ bar loop に聞こえにくくする
    basePresets.push(
      { name: "sunrise_step", 
        scale: [0, 2, 4, 5, 7, 9, 11], 
        bassPattern: [0, -5, -3, -2, 0, -4, -2, -5], 
        leadDegrees: [0, 2, 4, 5, 7, 5, 4, 2, 0, 2, 4, 7, 9, 7, 5, 4, 0, 2, 4, 5, 7, 9, 7, 5, 4, 5, 7, 9, 11, 9, 7, 5], 
        leadType: "triangle", 
        leadDur: 0.11, 
        leadGain: 0.060, 
        bassType: "triangle", 
        bassDur: 0.15, 
        bassGain: 0.072 },
      { name: "comet_lane", 
        scale: [0, 2, 3, 5, 7, 8, 10], 
        bassPattern: [0, -7, -5, -2, 0, -5, -3, -7], 
        leadDegrees: [0, 2, 3, 5, 7, 5, 3, 2, 0, 2, 3, 7, 8, 10, 8, 7, 5, 3, 2, 0, 2, 3, 5, 7, 8, 7, 5, 3, 2, 3, 5, 7], 
        leadType: "square", 
        leadDur: 0.10, 
        leadGain: 0.064, 
        bassType: "triangle", 
        bassDur: 0.16, 
        bassGain: 0.078 },
      { name: "crystal_arc", 
        scale: [0, 2, 4, 7, 9, 12], 
        bassPattern: [0, -3, -5, null, 0, -5, -3, null], 
        leadDegrees: [0, 2, 4, null, 5, 4, 2, null, 0, 4, 6, null, 8, 6, 4, null, 0, 2, 4, null, 6, 4, 2, null, 5, 6, 8, null, 9, 8, 6, null], 
        leadType: "sine", 
        leadDur: 0.16, 
        leadGain: 0.052, 
        bassType: "sawtooth", 
        bassDur: 0.13, 
        bassGain: 0.062, 
        rhythmDropWeakProb: 0.48, 
        rhythmDropTailProb: 0.70 },
      { name: "metro_chase", 
        scale: [0, 2, 3, 5, 7, 8, 10], 
        bassPattern: [0, -5, -2, -7, 0, -3, -5, -1], 
        leadDegrees: [0, 3, 5, 3, 7, 5, 8, 7, 5, 3, 2, 0, 2, 3, 5, 7, 8, 10, 8, 7, 5, 3, 2, 0, 3, 5, 7, 8, 10, 8, 7, 5], 
        leadType: "square", 
        leadDur: 0.09, 
        leadGain: 0.066, 
        bassType: "square", 
        bassDur: 0.14, 
        bassGain: 0.080 },
      { name: "neon_waltz", 
        scale: [0, 2, 4, 5, 7, 9, 11], 
        bassPattern: [0, -3, -5, -7, 0, -5, -2, -7], 
        leadDegrees: [0, 2, 4, 5, 7, 5, 4, 2, 0, 2, 4, 7, 9, 7, 5, 4, 2, 4, 5, 7, 9, 7, 5, 4, 2, 0, 2, 4, 7, 9, 7, 5], 
        leadType: "triangle", 
        leadDur: 0.12, 
        leadGain: 0.060, 
        bassType: "triangle", 
        bassDur: 0.16, 
        bassGain: 0.070 },
      { name: "ember_dash", 
        scale: [0, 1, 3, 5, 6, 8, 10], 
        bassPattern: [0, -1, -5, -6, 0, -2, -5, -6], 
        leadDegrees: [0, 3, 6, 3, 1, 3, 6, 8, 6, 3, 1, 0, 3, 6, 8, 10, 8, 6, 3, 1, 0, 1, 3, 6, 8, 10, 8, 6, 3, 1, 0, 10], 
        leadType: "sawtooth", 
        leadDur: 0.10, 
        leadGain: 0.068, 
        bassType: "square", 
        bassDur: 0.17, 
        bassGain: 0.083 },
      { name: "glacier_line", 
        scale: [0, 2, 3, 5, 7, 8, 10], 
        bassPattern: [0, null, -5, null, 0, null, -3, null], 
        leadDegrees: [0, null, 2, null, 3, null, 5, null, 7, null, 5, null, 3, null, 2, null, 0, null, 2, null, 5, null, 7, null, 8, null, 7, null, 5, null, 3, null], 
        leadType: "sine", 
        leadDur: 0.18, 
        leadGain: 0.048, 
        bassType: "triangle", 
        bassDur: 0.12, 
        bassGain: 0.058, 
        rhythmDropWeakProb: 0.60, 
        rhythmDropTailProb: 0.78 },
      { name: "monsoon_bit", 
        scale: [0, 2, 4, 7, 9, 12], 
        bassPattern: [0, -5, -3, -2, 0, -3, -5, -2], 
        leadDegrees: [0, 2, 5, 7, 5, 2, 0, 2, 4, 7, 9, 7, 5, 4, 2, 0, 0, 2, 5, 7, 9, 7, 5, 2, 4, 5, 7, 9, 12, 9, 7, 5], 
        leadType: "triangle", 
        leadDur: 0.11, 
        leadGain: 0.061, 
        bassType: "sawtooth", 
        bassDur: 0.15, 
        bassGain: 0.074 },
      { name: "orbit_runner", 
        scale: [0, 2, 3, 5, 7, 8, 10], 
        bassPattern: [0, -5, -2, -7, 0, -3, -5, -1], 
        leadDegrees: [0, 2, 3, 5, 7, 8, 7, 5, 3, 2, 0, 2, 3, 5, 7, 10, 8, 7, 5, 3, 2, 0, 2, 3, 5, 7, 8, 10, 8, 7, 5, 3], 
        leadHoldSteps: [1, 1, 1, 1.8, 1, 1, 1, 2.1, 1, 1, 1, 1.6, 1, 1, 1, 2.6, 1, 1, 1, 1.8, 1, 1, 1, 2.0, 1, 1, 1, 1.7, 1, 1, 1, 2.8], 
        leadType: "square", 
        leadDur: 0.11, 
        leadGain: 0.064, 
        bassType: "triangle", 
        bassDur: 0.16, 
        bassGain: 0.076 },
      { name: "pulse_rider", 
        scale: [0, 2, 4, 5, 7, 9, 11], 
        bassPattern: [0, -7, -5, -3, 0, -5, -2, -7], 
        leadDegrees: [0, 5, 7, 5, 9, 7, 5, 4, 2, 4, 5, 7, 9, 7, 5, 4, 0, 2, 4, 5, 7, 9, 11, 9, 7, 5, 4, 2, 4, 5, 7, 9], 
        leadType: "square", 
        leadDur: 0.09, 
        leadGain: 0.062, 
        bassType: "triangle", 
        bassDur: 0.14, 
        bassGain: 0.074 },
      { name: "lunar_bounce", 
        scale: [0, 2, 4, 7, 9, 12], 
        bassPattern: [0, -3, -5, -2, 0, -5, -3, -2], 
        leadDegrees: [0, 2, 4, 2, 5, 4, 2, 0, 4, 6, 8, 6, 9, 8, 6, 4, 0, 2, 4, 7, 5, 4, 2, 0, 4, 6, 8, 9, 8, 6, 4, 2], 
        leadType: "triangle", 
        leadDur: 0.11, 
        leadGain: 0.063, 
        bassType: "triangle", 
        bassDur: 0.16, 
        bassGain: 0.075 },
      { name: "canyon_blip", 
        scale: [0, 3, 5, 7, 10], 
        bassPattern: [0, null, -5, null, 0, null, -3, null], 
        leadDegrees: [0, null, 2, null, 4, null, 2, null, 0, null, 5, null, 4, null, 2, null, 0, null, 2, null, 4, null, 5, null, 7, null, 5, null, 4, null, 2, null], 
        leadType: "sine", 
        leadDur: 0.17, 
        leadGain: 0.049, 
        bassType: "sawtooth", 
        bassDur: 0.12, 
        bassGain: 0.060, 
        rhythmDropWeakProb: 0.57, 
        rhythmDropTailProb: 0.76 },
      { name: "drift_echo", 
        scale: [0, 2, 3, 5, 7, 8, 10], 
        bassPattern: [0, -5, null, -7, 0, -3, null, -5], 
        leadDegrees: [0, 2, 3, 5, 7, 5, 3, 2, 0, null, 2, 3, 7, 8, 10, 8, 7, 5, 3, 2, 0, null, 2, 3, 5, 7, 8, 10, 8, 7, 5, 3], 
        leadHoldSteps: [1, 1, 1, 1.8, 1, 1, 1, 2.1, 1, 1, 1, 1.7, 1, 1, 1, 2.7, 1, 1, 1, 1.8, 1, 1, 1, 2.2, 1, 1, 1, 1.7, 1, 1, 1, 2.9], 
        leadType: "triangle", 
        leadDur: 0.13, 
        leadGain: 0.057, 
        bassType: "triangle", 
        bassDur: 0.16, 
        bassGain: 0.071 },
      { name: "arcade_flash", 
        scale: [0, 2, 4, 5, 7, 9, 11], 
        bassPattern: [0, -5, -3, -7, 0, -2, -5, -3], 
        leadDegrees: [0, 4, 5, 7, 5, 4, 2, 0, 2, 4, 5, 7, 9, 7, 5, 4, 0, 2, 4, 5, 7, 9, 11, 9, 7, 5, 4, 2, 4, 5, 7, 9], 
        leadType: "square", 
        leadDur: 0.09, 
        leadGain: 0.067, 
        bassType: "square", 
        bassDur: 0.15, 
        bassGain: 0.082 },
      { name: "turbo_minor", 
        scale: [0, 2, 3, 5, 7, 8, 10], 
        bassPattern: [0, -5, -2, -7, 0, -3, -5, -1], 
        leadDegrees: [0, 3, 5, 7, 5, 3, 2, 0, 2, 3, 5, 7, 8, 7, 5, 3, 0, 2, 3, 5, 7, 8, 10, 8, 7, 5, 3, 2, 3, 5, 7, 8], 
        leadType: "square", 
        leadDur: 0.10, 
        leadGain: 0.066, 
        bassType: "triangle", 
        bassDur: 0.17, 
        bassGain: 0.079 },
      { name: "harbor_light", 
        scale: [0, 2, 4, 7, 9, 12], 
        bassPattern: [0, -3, -5, -2, 0, -5, -3, -2], 
        leadDegrees: [0, 2, 4, 7, 9, 7, 4, 2, 0, 2, 4, 7, 9, 7, 4, 2, 0, 4, 7, 9, 7, 4, 2, 0, 2, 4, 7, 9, 12, 9, 7, 4], 
        leadType: "triangle", 
        leadDur: 0.12, 
        leadGain: 0.058, 
        bassType: "triangle", 
        bassDur: 0.16, 
        bassGain: 0.070 },
      { name: "desert_loop", 
        scale: [0, 1, 3, 5, 6, 8, 10], 
        bassPattern: [0, -1, -5, -6, 0, -2, -5, -6], 
        leadDegrees: [0, 3, 6, 3, 1, 3, 6, 8, 6, 3, 1, 0, 10, 8, 6, 3, 0, 3, 6, 8, 10, 8, 6, 3, 1, 3, 6, 8, 10, 8, 6, 3], 
        leadType: "sawtooth", 
        leadDur: 0.11, 
        leadGain: 0.067, 
        bassType: "square", 
        bassDur: 0.18, 
        bassGain: 0.082 },
      { name: "ion_stream", 
        scale: [0, 2, 4, 5, 7, 9, 11], 
        bassPattern: [0, -7, -5, -3, 0, -5, -2, -7], 
        leadDegrees: [0, 5, 7, 9, 7, 5, 4, 2, 0, 2, 4, 5, 7, 9, 7, 5, 0, 2, 4, 5, 7, 9, 11, 9, 7, 5, 4, 2, 4, 5, 7, 9], 
        leadType: "square", 
        leadDur: 0.09, 
        leadGain: 0.063, 
        bassType: "triangle", 
        bassDur: 0.14, 
        bassGain: 0.073 },
      { name: "starlit_hook", 
        scale: [0, 2, 3, 5, 7, 8, 10], 
        bassPattern: [0, -5, -2, -7, 0, -3, -5, -1], 
        leadDegrees: [0, 2, 3, 5, 7, 5, 3, 2, 7, 8, 10, 8, 7, 5, 3, 2, 0, 2, 3, 5, 7, 8, 7, 5, 3, 2, 0, 2, 3, 5, 7, 10], 
        leadHoldSteps: [1, 1, 1, 1.7, 1, 1, 1, 2.0, 1, 1, 1, 1.9, 1, 1, 1, 2.5, 1, 1, 1, 1.8, 1, 1, 1, 2.2, 1, 1, 1, 1.8, 1, 1, 1, 2.8], 
        leadType: "triangle", 
        leadDur: 0.12, 
        leadGain: 0.060, 
        bassType: "triangle", 
        bassDur: 0.16, 
        bassGain: 0.074 },
      { name: "skyline_chip", 
        scale: [0, 2, 4, 7, 9, 12], 
        bassPattern: [0, -3, -5, -2, 0, -5, -3, -2], 
        leadDegrees: [0, 2, 4, 6, 5, 4, 2, 0, 0, 2, 4, 6, 8, 6, 4, 2, 0, 2, 4, 6, 8, 9, 8, 6, 4, 2, 0, 2, 4, 6, 8, 6], 
        leadType: "triangle", 
        leadDur: 0.11, 
        leadGain: 0.061, 
        bassType: "triangle", 
        bassDur: 0.15, 
        bassGain: 0.072 },
      { name: "ripple_drive", 
        scale: [0, 3, 5, 7, 10], 
        bassPattern: [0, null, -5, null, 0, null, -3, null], 
        leadDegrees: [0, null, 2, null, 4, null, 2, null, 5, null, 4, null, 2, null, 0, null, 0, null, 2, null, 4, null, 5, null, 7, null, 5, null, 4, null, 2, null], 
        leadType: "sine", 
        leadDur: 0.18, 
        leadGain: 0.050, 
        bassType: "sawtooth", 
        bassDur: 0.12, 
        bassGain: 0.060, 
        rhythmDropWeakProb: 0.62, 
        rhythmDropTailProb: 0.80 },
      { name: "storm_grid", 
        scale: [0, 1, 3, 5, 6, 8, 10], 
        bassPattern: [0, -1, -5, -6, 0, -2, -5, -6], 
        leadDegrees: [0, 4, 6, 4, 3, 4, 6, 8, 6, 4, 3, 1, 0, 3, 6, 8, 10, 8, 6, 4, 3, 1, 0, 1, 3, 4, 6, 8, 10, 8, 6, 4], 
        leadType: "sawtooth", 
        leadDur: 0.10, 
        leadGain: 0.069, 
        bassType: "square", 
        bassDur: 0.18, 
        bassGain: 0.084 },
      { name: "twilight_swing",
        scale: [0, 2, 4, 5, 7, 9, 11], 
        bassPattern: [0, -5, -3, -2, 0, -4, -2, -5], 
        leadDegrees: [0, 2, 4, 5, 7, 5, 4, 2, 0, 2, 4, 7, 9, 7, 5, 4, 2, 4, 5, 7, 9, 7, 5, 4, 2, 0, 2, 4, 7, 9, 11, 9], 
        leadHoldSteps: [1, 1, 1, 1.6, 1, 1, 1, 2.0, 1, 1, 1, 1.6, 1, 1, 1, 2.4, 1, 1, 1, 1.7, 1, 1, 1, 2.1, 1, 1, 1, 1.7, 1, 1, 1, 2.8], 
        leadType: "triangle", 
        leadDur: 0.12, 
        leadGain: 0.058, 
        bassType: "triangle",
        bassDur: 0.16,
        bassGain: 0.070 }
    );

    for (let i = 0; i < basePresets.length; i++) {
      const preset = {
        leadHoldSteps: [...defaultLeadHoldSteps],
        rhythmDropWeakProb: defaultRhythmDropWeakProb,
        rhythmDropTailProb: defaultRhythmDropTailProb,
        ...basePresets[i]
      };
      const { name, ...config } = preset;
      this.registerMelody(name, config);
    }
  }

  installSePresets() {
    // ゲーム SE は、単発の短い波形で終わらせず、
    // 主音・補助音・少し長い余韻を重ねて、reverb と delay が聞こえやすい設計にする
    const tone = (t0, freq, dur, profile, options = {}) => {
      this.playGameTone(freq, dur, profile, {
        when: t0,
        ...options
      });
    };

    this.gameSe = {
      paddle: (t0) => {
        tone(t0, 520, 0.12, "hit", { type: "triangle", gain: 0.10, release: 0.10, pan: -0.10 });
        tone(t0 + 0.018, 780, 0.14, "pluck", { type: "square", gain: 0.06, release: 0.10, pan: 0.12 });
        tone(t0 + 0.050, 1040, 0.18, "soft", { type: "sine", gain: 0.05, release: 0.16, pan: 0.26 });
        tone(t0 + 0.006, 330, 0.20, "soft", { type: "triangle", gain: 0.05, release: 0.20, pan: -0.28 });
      },
      wall: (t0) => {
        tone(t0, 260, 0.10, "hit", { type: "sine", gain: 0.09, release: 0.08, pan: -0.04 });
        tone(t0 + 0.018, 520, 0.12, "soft", { type: "triangle", gain: 0.05, release: 0.10, pan: 0.08 });
        tone(t0 + 0.052, 980, 0.16, "pluck", { type: "sine", gain: 0.04, release: 0.14, pan: 0.18 });
      },
      block: (t0) => {
        tone(t0, 620, 0.11, "hit", { type: "triangle", gain: 0.08, release: 0.09, pan: -0.08 });
        tone(t0 + 0.016, 930, 0.12, "pluck", { type: "square", gain: 0.055, release: 0.10, pan: 0.08 });
        tone(t0 + 0.040, 1480, 0.18, "soft", { type: "sine", gain: 0.04, release: 0.16, pan: 0.22 });
        tone(t0 + 0.006, 260, 0.16, "soft", { type: "triangle", gain: 0.05, release: 0.18, pan: -0.22 });
      },
      levelup: (t0) => {
        tone(t0, 392, 0.14, "soft", { type: "triangle", gain: 0.09, release: 0.12, pan: -0.10 });
        tone(t0 + 0.10, 523.25, 0.16, "soft", { type: "triangle", gain: 0.10, release: 0.14, pan: 0.02 });
        tone(t0 + 0.22, 659.25, 0.18, "soft", { type: "triangle", gain: 0.10, release: 0.16, pan: 0.14 });
        tone(t0 + 0.34, 783.99, 0.22, "pad", { type: "sine", gain: 0.08, release: 0.18, pan: 0.24 });
      },
      gameover: (t0) => {
        tone(t0, 329.63, 0.20, "boom", { type: "sawtooth", gain: 0.11, release: 0.14, pan: -0.06 });
        tone(t0 + 0.12, 246.94, 0.24, "boom", { type: "sawtooth", gain: 0.10, release: 0.16, pan: 0.00 });
        tone(t0 + 0.28, 196.00, 0.30, "boom", { type: "triangle", gain: 0.09, release: 0.20, pan: -0.10 });
        tone(t0 + 0.42, 146.83, 0.32, "pad", { type: "sine", gain: 0.06, release: 0.24, pan: 0.12 });
      },
      // ぽよーん
      poyoon: (t0) => {
        tone(t0, 280, 0.16, "soft", { type: "triangle", gain: 0.11, release: 0.14, pan: -0.16 });
        tone(t0 + 0.045, 430, 0.18, "soft", { type: "sine", gain: 0.08, release: 0.16, pan: 0.06 });
        tone(t0 + 0.120, 650, 0.24, "pad", { type: "triangle", gain: 0.05, release: 0.18, pan: 0.22 });
      },
      // ぴよーん
      piyoon: (t0) => {
        tone(t0, 560, 0.10, "pluck", { type: "square", gain: 0.10, release: 0.08, pan: -0.10 });
        tone(t0 + 0.028, 880, 0.12, "soft", { type: "triangle", gain: 0.08, release: 0.10, pan: 0.08 });
        tone(t0 + 0.070, 1320, 0.16, "soft", { type: "sine", gain: 0.05, release: 0.14, pan: 0.20 });
      },
      // バーン
      baan: (t0) => {
        tone(t0, 110, 0.16, "boom", { type: "sawtooth", gain: 0.13, release: 0.12, pan: -0.05 });
        tone(t0 + 0.012, 72, 0.22, "boom", { type: "triangle", gain: 0.11, release: 0.18, pan: 0.04 });
        tone(t0 + 0.045, 240, 0.08, "hit", { type: "square", gain: 0.05, release: 0.07, pan: 0.12 });
      },
      // シュパ
      shupa: (t0) => {
        tone(t0, 980, 0.08, "sweep", { type: "sawtooth", gain: 0.08, release: 0.07, pan: -0.38 });
        tone(t0 + 0.020, 680, 0.10, "sweep", { type: "sawtooth", gain: 0.07, release: 0.08, pan: 0.30 });
        tone(t0 + 0.050, 420, 0.14, "soft", { type: "triangle", gain: 0.05, release: 0.12, pan: 0.04 });
      },
      coin: (t0) => {
        tone(t0, 880, 0.08, "pluck", { type: "square", gain: 0.08, release: 0.07, pan: -0.10 });
        tone(t0 + 0.028, 1320, 0.10, "pluck", { type: "square", gain: 0.08, release: 0.08, pan: 0.04 });
        tone(t0 + 0.056, 1760, 0.12, "soft", { type: "triangle", gain: 0.05, release: 0.10, pan: 0.18 });
      },
      jump: (t0) => {
        tone(t0, 300, 0.08, "hit", { type: "triangle", gain: 0.09, release: 0.07, pan: -0.08 });
        tone(t0 + 0.030, 494, 0.12, "soft", { type: "triangle", gain: 0.08, release: 0.10, pan: 0.03 });
        tone(t0 + 0.090, 660, 0.16, "pad", { type: "sine", gain: 0.06, release: 0.14, pan: 0.14 });
      },
      laser: (t0) => {
        tone(t0, 1480, 0.05, "sweep", { type: "square", gain: 0.08, release: 0.05, pan: -0.28 });
        tone(t0 + 0.016, 1120, 0.06, "sweep", { type: "square", gain: 0.07, release: 0.05, pan: -0.05 });
        tone(t0 + 0.032, 840, 0.08, "sweep", { type: "square", gain: 0.06, release: 0.06, pan: 0.12 });
        tone(t0 + 0.056, 560, 0.11, "soft", { type: "triangle", gain: 0.05, release: 0.09, pan: 0.22 });
      },
      damage: (t0) => {
        tone(t0, 220, 0.10, "boom", { type: "sawtooth", gain: 0.10, release: 0.10, pan: -0.06 });
        tone(t0 + 0.040, 160, 0.14, "boom", { type: "sawtooth", gain: 0.09, release: 0.12, pan: 0.02 });
        tone(t0 + 0.090, 110, 0.18, "pad", { type: "triangle", gain: 0.07, release: 0.16, pan: 0.12 });
      },
      powerup: (t0) => {
        tone(t0, 392, 0.10, "soft", { type: "triangle", gain: 0.07, release: 0.10, pan: -0.12 });
        tone(t0 + 0.050, 523.25, 0.12, "soft", { type: "triangle", gain: 0.08, release: 0.11, pan: -0.02 });
        tone(t0 + 0.110, 659.25, 0.14, "soft", { type: "triangle", gain: 0.09, release: 0.12, pan: 0.10 });
        tone(t0 + 0.170, 783.99, 0.18, "soft", { type: "triangle", gain: 0.09, release: 0.14, pan: 0.20 });
        tone(t0 + 0.240, 987.77, 0.22, "pad", { type: "sine", gain: 0.06, release: 0.18, pan: 0.28 });
      },
      ui_move: (t0) => {
        tone(t0, 740, 0.05, "pluck", { type: "square", gain: 0.04, release: 0.05, pan: -0.06 });
        tone(t0 + 0.018, 880, 0.06, "soft", { type: "triangle", gain: 0.03, release: 0.05, pan: 0.05 });
      },
      ui_ok: (t0) => {
        tone(t0, 660, 0.06, "pluck", { type: "triangle", gain: 0.06, release: 0.06, pan: -0.04 });
        tone(t0 + 0.032, 990, 0.08, "pluck", { type: "triangle", gain: 0.06, release: 0.06, pan: 0.06 });
        tone(t0 + 0.076, 1320, 0.10, "soft", { type: "sine", gain: 0.04, release: 0.08, pan: 0.18 });
      },
      countdown: (t0) => {
        tone(t0, 520, 0.05, "hit", { type: "square", gain: 0.06, release: 0.05, pan: -0.04 });
        tone(t0 + 0.110, 520, 0.05, "hit", { type: "square", gain: 0.06, release: 0.05, pan: 0.02 });
        tone(t0 + 0.240, 760, 0.08, "pluck", { type: "square", gain: 0.07, release: 0.06, pan: 0.10 });
        tone(t0 + 0.360, 1046, 0.10, "soft", { type: "triangle", gain: 0.05, release: 0.08, pan: 0.22 });
      },
      // reverb と envelope の差を聞き分けやすくする確認用SE
      // 冒頭の短い輪郭音で attack を、その後の長めの胴鳴りで decay / sustain / release と reverb tail を追いやすくする
      tail_probe: (t0) => {
        tone(t0, 523.25, 0.08, "soft", { type: "triangle", gain: 0.08, release: 0.06, pan: -0.22 });
        tone(t0 + 0.050, 659.25, 0.12, "soft", { type: "sine", gain: 0.06, release: 0.09, pan: 0.18 });
        tone(t0 + 0.120, 392.00, 0.48, "pad", { type: "triangle", gain: 0.11, release: 0.22, pan: -0.10 });
        tone(t0 + 0.200, 587.33, 0.56, "pad", { type: "sine", gain: 0.10, release: 0.28, pan: 0.12 });
        tone(t0 + 0.380, 783.99, 0.36, "soft", { type: "triangle", gain: 0.06, release: 0.20, pan: 0.26 });
        tone(t0 + 0.520, 1046.50, 0.24, "pluck", { type: "square", gain: 0.04, release: 0.16, pan: 0.34 });
      }
    };

    // sound sample などで「どの SE がどの envelope profile を使うか」を追えるようにする
    this.soundEffectCatalog = {
      paddle: { label: "paddle", profiles: ["hit", "pluck", "soft"], primaryProfile: "hit" },
      wall: { label: "wall", profiles: ["hit", "soft"], primaryProfile: "hit" },
      block: { label: "block", profiles: ["hit", "soft", "pluck"], primaryProfile: "hit" },
      levelup: { label: "levelup", profiles: ["soft", "pad"], primaryProfile: "soft" },
      gameover: { label: "gameover", profiles: ["boom", "pad"], primaryProfile: "boom" },
      poyoon: { label: "poyoon", profiles: ["soft", "pad"], primaryProfile: "soft" },
      piyoon: { label: "piyoon", profiles: ["pluck", "soft"], primaryProfile: "pluck" },
      baan: { label: "baan", profiles: ["boom", "hit"], primaryProfile: "boom" },
      shupa: { label: "shupa", profiles: ["sweep", "pluck"], primaryProfile: "sweep" },
      coin: { label: "coin", profiles: ["pluck", "soft"], primaryProfile: "pluck" },
      jump: { label: "jump", profiles: ["hit", "soft", "pad"], primaryProfile: "hit" },
      laser: { label: "laser", profiles: ["sweep", "pluck"], primaryProfile: "sweep" },
      damage: { label: "damage", profiles: ["boom", "hit"], primaryProfile: "boom" },
      powerup: { label: "powerup", profiles: ["soft", "pad"], primaryProfile: "soft" },
      ui_move: { label: "ui_move", profiles: ["pluck", "hit"], primaryProfile: "pluck" },
      ui_ok: { label: "ui_ok", profiles: ["pluck", "soft"], primaryProfile: "pluck" },
      countdown: { label: "countdown", profiles: ["hit", "pluck", "soft"], primaryProfile: "hit" },
      tail_probe: { label: "tail_probe", profiles: ["soft", "pad", "boom"], primaryProfile: "pad" }
    };
  }

  getSoundEffectList() {
    return Object.keys(this.soundEffectCatalog ?? {});
  }

  getSoundEffectInfo(name) {
    if (!name || typeof name !== "string") {
      throw new Error("Sound effect name must be a non-empty string.");
    }
    const info = this.soundEffectCatalog?.[name];
    if (!info) {
      throw new Error(`Unknown sound effect: ${name}`);
    }
    return {
      name,
      label: info.label ?? name,
      profiles: [...(info.profiles ?? [])],
      primaryProfile: info.primaryProfile ?? info.profiles?.[0] ?? "soft"
    };
  }

  getGameSeList() {
    return Object.keys(this.gameSe ?? {});
  }

  playSe(name) {
    this.ensureContext();
    const t0 = this.ctx.currentTime;
    if (this.gameSe && this.gameSe[name]) {
      this.gameSe[name](t0);
      return;
    }
    throw new Error(`Unknown game sound effect: ${name}`);
  }

  // 追加ゲームSEも playSe(name) と同じ strict な解決規則を使う
  playGameSe(name) {
    this.playSe(name);
  }
}
