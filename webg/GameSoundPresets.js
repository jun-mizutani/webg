// ---------------------------------------------
// GameSoundPresets.js  2026/10/04
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// atとdurationは秒。音高変化、帯域を絞ったノイズ、少量の余韻で出来事を区別する

// 発生時刻・周波数・長さ・音色・音量から、効果音の有声音layerを作る
const tone = (at, frequency, duration, profile, gain, options = {}) =>
  ({ at, frequency, duration, profile, gain, ...options });
// 発生時刻・filter周波数・長さ・音色・音量から、効果音のnoise layerを作る
const noise = (at, filterHz, duration, profile, gain, options = {}) =>
  ({ at, filterHz, duration, profile, gain, noise: true, ...options });

export const GAME_SOUND_PRESETS = {
  // 衝突：低い胴鳴りと短い接触音。連続衝突でも音程の列になりにくくする
  paddle: { primaryProfile: "percussion", layers: [
    tone(0, 230, .07, "percussion", .12, { endHz: 125, type: "sine" }),
    noise(0, 1500, .035, "percussion", .11, { q: .7, pan: -.08 }),
    tone(.008, 460, .055, "guitar", .025, { endHz: 330, type: "triangle", pan: .08 })
  ] },
  wall: { primaryProfile: "percussion", layers: [
    tone(0, 175, .065, "percussion", .105, { endHz: 105 }),
    noise(0, 850, .025, "percussion", .08, { q: .8 }),
    tone(.006, 350, .045, "piano", .024, { type: "triangle", filterHz: 1500 })
  ] },
  block: { primaryProfile: "percussion", layers: [
    noise(0, 2600, .075, "percussion", .16, { filterEndHz: 1000, q: .6 }),
    tone(0, 560, .09, "guitar", .065, { endHz: 240, type: "triangle" }),
    noise(.025, 3500, .055, "percussion", .05, { pan: .15 })
  ] },
  // 達成：安定した音程と和音。衝突音から聞き分けられる長さにする
  levelup: { primaryProfile: "piano", layers: [
    tone(0, 392, .13, "piano", .07, { type: "triangle", pan: -.12 }),
    tone(.09, 493.88, .14, "piano", .075, { type: "triangle" }),
    tone(.19, 587.33, .16, "piano", .075, { type: "triangle", pan: .12 }),
    tone(.30, 783.99, .24, "organ", .045),
    tone(.30, 493.88, .24, "organ", .022, { pan: -.12 }),
    noise(.30, 3200, .045, "percussion", .025)
  ] },
  gameover: { primaryProfile: "piano", layers: [
    tone(0, 329.63, .19, "piano", .075, { type: "triangle" }),
    tone(.16, 293.66, .20, "piano", .075, { type: "triangle" }),
    tone(.33, 246.94, .22, "piano", .07, { type: "triangle" }),
    tone(.52, 164.81, .30, "organ", .065),
    tone(.52, 196, .30, "organ", .025, { filterHz: 1300 }),
    noise(.52, 400, .13, "percussion", .045, { noiseType: "lowpass" })
  ] },
  // 弾性のある動き：階段状の音程ではなく、連続する滑らかな変化を使う
  poyoon: { primaryProfile: "piano", layers: [
    tone(0, 160, .20, "piano", .105, { endHz: 430, type: "sine" }),
    tone(.13, 430, .17, "woodwind", .05, { endHz: 250, type: "sine", pan: .12 }),
    noise(0, 700, .025, "percussion", .04)
  ] },
  piyoon: { primaryProfile: "guitar", layers: [
    tone(0, 380, .15, "guitar", .075, { endHz: 1050, type: "triangle", filterHz: 2300 }),
    tone(.12, 1050, .11, "woodwind", .032, { endHz: 700, pan: .1 }),
    noise(0, 1800, .025, "percussion", .035)
  ] },
  baan: { primaryProfile: "percussion", layers: [
    tone(0, 145, .25, "percussion", .18, { endHz: 42 }),
    noise(0, 2200, .22, "percussion", .20, { filterEndHz: 280, noiseType: "lowpass" }),
    noise(.025, 600, .28, "piano", .075, { filterEndHz: 180, noiseType: "lowpass", pan: .06 })
  ] },
  shupa: { primaryProfile: "brass", layers: [
    noise(0, 900, .15, "brass", .16, { filterEndHz: 3600, q: .65, pan: -.18 }),
    noise(.055, 3000, .09, "guitar", .075, { filterEndHz: 700, q: .65, pan: .18 }),
    tone(0, 320, .10, "percussion", .032, { endHz: 140 })
  ] },
  coin: { primaryProfile: "guitar", layers: [
    tone(0, 659.25, .085, "guitar", .075, { type: "triangle", pan: -.06 }),
    tone(.06, 987.77, .14, "guitar", .07, { type: "sine", pan: .06 }),
    tone(.06, 1318.51, .10, "piano", .023, { filterHz: 2300 }),
    noise(0, 3500, .018, "percussion", .022)
  ] },
  jump: { primaryProfile: "percussion", layers: [
    tone(0, 190, .17, "percussion", .095, { endHz: 620, type: "triangle" }),
    noise(0, 600, .04, "percussion", .06, { filterEndHz: 1600 }),
    tone(.10, 620, .08, "woodwind", .022, { endHz: 700 })
  ] },
  laser: { primaryProfile: "guitar", layers: [
    tone(0, 1350, .16, "guitar", .075, { endHz: 180, type: "sawtooth", filterHz: 2500, filterEndHz: 700 }),
    tone(.006, 680, .12, "percussion", .045, { endHz: 90, type: "sine" }),
    noise(0, 2800, .03, "percussion", .06, { filterEndHz: 1100 })
  ] },
  damage: { primaryProfile: "percussion", layers: [
    noise(0, 1200, .10, "percussion", .16, { filterEndHz: 500, q: .55 }),
    tone(0, 185, .15, "percussion", .11, { endHz: 65, type: "triangle", filterHz: 1200 }),
    tone(.025, 138, .11, "guitar", .035, { endHz: 80, type: "sine" })
  ] },
  powerup: { primaryProfile: "piano", layers: [
    tone(0, 261.63, .13, "piano", .075, { type: "triangle" }),
    tone(.075, 329.63, .13, "piano", .075, { type: "triangle" }),
    tone(.15, 392, .15, "piano", .075, { type: "triangle" }),
    tone(.23, 523.25, .24, "organ", .05),
    tone(.23, 659.25, .24, "organ", .03, { pan: .12 }),
    noise(.23, 2400, .06, "percussion", .035, { filterEndHz: 4000 })
  ] },
  // 操作音は小さい短音にし、連打時も控えめな余韻に収める
  ui_move: { primaryProfile: "guitar", layers: [
    tone(0, 440, .035, "guitar", .035, { endHz: 540, type: "sine" }),
    noise(0, 1300, .012, "percussion", .018)
  ] },
  ui_ok: { primaryProfile: "guitar", layers: [
    tone(0, 523.25, .065, "guitar", .05, { type: "triangle" }),
    tone(.05, 783.99, .095, "guitar", .045, { type: "sine" }),
    noise(.05, 2200, .018, "percussion", .018)
  ] },
  countdown: { primaryProfile: "percussion", layers: [
    tone(0, 440, .045, "percussion", .055, { type: "triangle" }),
    noise(0, 1200, .018, "percussion", .035),
    tone(.16, 440, .045, "percussion", .055, { type: "triangle" }),
    noise(.16, 1200, .018, "percussion", .035),
    tone(.32, 660, .065, "guitar", .055, { type: "triangle" }),
    tone(.43, 880, .12, "piano", .045)
  ] },
  // 包絡と残響の比較用。短いノイズから長い胴鳴りへ移る
  tail_probe: { primaryProfile: "organ", layers: [
    noise(0, 1800, .045, "percussion", .07),
    tone(.055, 523.25, .13, "piano", .06, { type: "triangle", pan: -.15 }),
    tone(.13, 392, .48, "organ", .075, { type: "triangle", pan: -.10 }),
    tone(.21, 587.33, .56, "organ", .055, { pan: .12 }),
    tone(.40, 783.99, .28, "guitar", .035, { pan: .20 })
  ] }
};
