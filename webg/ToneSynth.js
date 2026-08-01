// ---------------------------------------------
//  ToneSynth.js    2026/08/01
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import util from "./util.js";

export default class ToneSynth {

  // 単音再生に必要な AudioContext、出力 bus、エンベロープ、残響設定を初期化する
  // 実際の WebAudio node はユーザー操作後の ensureContext() まで作らない
  constructor(options = {}) {
    const opts = util.readPlainObject(options, "ToneSynth options", {});

    // 音声内の再現可能な乱数streamを作る基準seed
    // 時刻やブラウザ組み込み乱数から暗黙生成せず、未指定時も固定値で同じ音響素材を作る
    this.randomSeed = util.readOptionalInteger(
      opts.randomSeed,
      "ToneSynth randomSeed",
      5489,
      { min: 0, max: 0xffffffff }
    );
    this.reverbRandom = this.createRandomGenerator(0x72657662);

    // AudioContext はユーザー操作まで遅延初期化する
    // constructor で作るとブラウザ再生制限に引っかかりやすいため
    this.ctx = null;
    this.master = null;
    this.toneBus = null;
    this.fxInitialized = false;
    this.started = false;

    // stopAllTones() や外側の明示停止で参照できるよう、
    // 現在鳴っている tone voice を Set で保持する
    this.activeVoices = new Set();

    // 単音用バスの既定値
    this.masterGainValue = util.readOptionalFiniteNumber(
      opts.masterGain,
      "ToneSynth masterGain",
      0.25,
      { min: 0.0 }
    );
    this.toneBusGainValue = util.readOptionalFiniteNumber(
      opts.toneBusGain,
      "ToneSynth toneBusGain",
      0.90,
      { min: 0.0 }
    );
    this.toneDryGainValue = util.readOptionalFiniteNumber(
      opts.toneDryGain,
      "ToneSynth toneDryGain",
      0.88,
      { min: 0.0 }
    );
    this.toneWetGainValue = util.readOptionalFiniteNumber(
      opts.toneWetGain,
      "ToneSynth toneWetGain",
      0.22,
      { min: 0.0 }
    );
    this.toneDelayTimeValue = util.readOptionalFiniteNumber(
      opts.toneDelayTime,
      "ToneSynth toneDelayTime",
      0.11,
      { min: 0.0 }
    );
    this.toneFeedbackGainValue = util.readOptionalFiniteNumber(
      opts.toneFeedbackGain,
      "ToneSynth toneFeedbackGain",
      0.26,
      { min: 0.0 }
    );
    this.toneLowpassFrequencyValue = util.readOptionalFiniteNumber(
      opts.toneLowpassFrequency,
      "ToneSynth toneLowpassFrequency",
      2600,
      { minExclusive: 0.0 }
    );
    this.toneReverbSendValue = util.readOptionalFiniteNumber(
      opts.toneReverbSend,
      "ToneSynth toneReverbSend",
      0.32,
      { min: 0.0 }
    );
    this.toneReverbReturnValue = util.readOptionalFiniteNumber(
      opts.toneReverbReturn,
      "ToneSynth toneReverbReturn",
      0.55,
      { min: 0.0 }
    );

    // 単音用 envelope preset は楽器カテゴリとしてここで持つ
    // 波形自体は oscillator type で決まり、ここでは発音開始から余韻までの時間変化を楽器らしく分ける
    this.toneEnvelopePresets = opts.toneEnvelopePresets ?? {
      percussion: { attack: 0.001, decay: 0.030, sustain: 0.04, release: 0.035 },
      brass: { attack: 0.085, decay: 0.180, sustain: 0.82, release: 0.280 },
      woodwind: { attack: 0.145, decay: 0.120, sustain: 0.58, release: 0.220 },
      organ: { attack: 0.004, decay: 0.010, sustain: 0.98, release: 0.180 },
      piano: { attack: 0.002, decay: 0.420, sustain: 0.16, release: 0.180 },
      guitar: { attack: 0.001, decay: 0.160, sustain: 0.08, release: 0.090 }
    };
    this.toneReverbImpulseConfig = opts.toneReverbImpulseConfig ?? {
      kind: "hall",
      durationSec: 3.2,
      decay: 1.8
    };
    this.seReverbImpulseConfig = this.toneReverbImpulseConfig;
    this.seEnvelopePresets = this.toneEnvelopePresets;
  }

  // 基準seedと用途識別値をlowbias32で結合し、ほかの用途と独立したMT19937を作る
  // streamIdは4文字程度のASCIIを16進表現した固定値にして、用途をcommentから追跡できるようにする
  createRandomGenerator(streamId) {
    const id = util.readFiniteNumber(streamId, "ToneSynth random streamId", {
      integer: true,
      min: 0,
      max: 0xffffffff
    });
    const streamSeed = util.hashUint32Sequence([id], this.randomSeed);
    return new util.MersenneTwister(streamSeed);
  }

  // WebAudio の実体を作成し、master から単音 bus までの最小経路を準備する
  // ブラウザの自動再生制限を避けるため、resume() や再生 API から遅延して呼ばれる
  ensureContext() {
    if (this.ctx) return this.ctx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) {
      throw new Error("Web Audio API is not supported in this browser.");
    }
    this.ctx = new Ctx();

    this.master = this.ctx.createGain();
    this.master.gain.value = this.masterGainValue;
    this.master.connect(this.ctx.destination);

    this.toneBus = this.ctx.createGain();
    this.toneBus.gain.value = this.toneBusGainValue;
    this.buildToneFxChain();
    return this.ctx;
  }

  // 単音 bus から dry / delay / reverb に分岐し、最後に master へ戻す
  // この段階で作る FX chain は AudioSynth では SE 系統として再利用される
  buildToneFxChain() {
    if (this.fxInitialized) return;
    const ctx = this.ctx;

    this.toneDry = ctx.createGain();
    this.toneWet = ctx.createGain();
    this.toneDelay = ctx.createDelay(1.2);
    this.toneFeedback = ctx.createGain();
    this.toneTone = ctx.createBiquadFilter();
    this.toneTone.type = "lowpass";
    this.toneTone.frequency.value = this.toneLowpassFrequencyValue;

    this.toneDry.gain.value = this.toneDryGainValue;
    this.toneWet.gain.value = this.toneWetGainValue;
    this.toneDelay.delayTime.value = this.toneDelayTimeValue;
    this.toneFeedback.gain.value = this.toneFeedbackGainValue;

    this.toneRevSend = ctx.createGain();
    this.toneConvolver = ctx.createConvolver();
    this.toneRevReturn = ctx.createGain();
    this.toneRevSend.gain.value = this.toneReverbSendValue;
    this.toneRevReturn.gain.value = this.toneReverbReturnValue;
    this.updateConvolverImpulse(this.toneConvolver, this.toneReverbImpulseConfig);

    this.toneBus.connect(this.toneDry);
    this.toneBus.connect(this.toneDelay);
    this.toneBus.connect(this.toneRevSend);
    this.toneDelay.connect(this.toneTone);
    this.toneTone.connect(this.toneFeedback);
    this.toneFeedback.connect(this.toneDelay);
    this.toneTone.connect(this.toneWet);
    this.toneRevSend.connect(this.toneConvolver);
    this.toneConvolver.connect(this.toneRevReturn);
    this.toneDry.connect(this.master);
    this.toneWet.connect(this.master);
    this.toneRevReturn.connect(this.master);

    this.fxInitialized = true;
  }

  // ユーザー操作後に AudioContext を有効化し、以後の発音を許可する
  // 呼び出し側は click / touch などのイベント内で await してから音を鳴らす
  async resume() {
    this.ensureContext();
    if (this.ctx.state === "suspended") {
      await this.ctx.resume();
    }
    this.started = true;
  }

  // master bus の音量を変更し、単音と派生クラスの BGM をまとめて調整する
  setMasterVolume(v) {
    this.ensureContext();
    this.master.gain.value = util.readFiniteNumber(v, "ToneSynth master volume", { min: 0.0 });
  }

  // SE / 単音 bus の音量を変更する
  // ToneSynth 単体ではこの bus が唯一の発音経路で、AudioSynth では SE bus として扱われる
  setSeVolume(v) {
    this.ensureContext();
    this.toneBus.gain.value = util.readFiniteNumber(v, "ToneSynth SE volume", { min: 0.0 });
  }

  // SE / 単音 bus の delay を変更する
  // timeSec は反復間隔、feedback は繰り返し量、wet は delay 音の混合量を表す
  setSeDelay(timeSec = 0.11, feedback = 0.26, wet = 0.22) {
    this.ensureContext();
    this.toneDelay.delayTime.value = util.readFiniteNumber(timeSec, "ToneSynth SE delay time", { min: 0.0 });
    this.toneFeedback.gain.value = util.readFiniteNumber(feedback, "ToneSynth SE delay feedback", { min: 0.0 });
    this.toneWet.gain.value = util.readFiniteNumber(wet, "ToneSynth SE delay wet", { min: 0.0 });
  }

  // SE / 単音 bus の reverb 量を変更する
  // send は convolver へ送る量、returnGain は残響音を master へ戻す量を表す
  setSeReverb(send = 0.28, returnGain = 0.48) {
    this.ensureContext();
    this.toneRevSend.gain.value = util.readFiniteNumber(send, "ToneSynth SE reverb send", { min: 0.0 });
    this.toneRevReturn.gain.value = util.readFiniteNumber(returnGain, "ToneSynth SE reverb return", { min: 0.0 });
  }

  // reverb impulse の kind として受け付ける名前を返す
  // UI の選択肢や設定検証では、この一覧を信頼できる source として使う
  getImpulseKindList() {
    return ["room", "hall", "plate"];
  }

  // reverb impulse 設定を検証し、ConvolverNode に渡せる形式へ正規化する
  // 不正値はその場で例外にして、音響設定の誤記を静かに隠さない
  normalizeImpulseConfig(config = {}) {
    const obj = util.readPlainObject(config, "ToneSynth impulse config", {});
    const kind = String(obj.kind);
    if (!this.getImpulseKindList().includes(kind)) {
      throw new Error(`ToneSynth impulse kind must be one of: ${this.getImpulseKindList().join(", ")}`);
    }
    return {
      kind,
      durationSec: util.readFiniteNumber(obj.durationSec, "ToneSynth impulse durationSec", { minExclusive: 0.0 }),
      decay: util.readFiniteNumber(obj.decay, "ToneSynth impulse decay", { minExclusive: 0.0 })
    };
  }

  // 既存の ConvolverNode に新しい impulse response を設定する
  // routing は変えず、残響の性格だけを差し替えるための小さな更新点
  updateConvolverImpulse(convolver, config) {
    if (!this.ctx || !convolver) return;
    convolver.buffer = this.createImpulseResponse(
      this.ctx,
      config.durationSec,
      config.decay,
      { kind: config.kind }
    );
  }

  // SE / 単音 bus の reverb impulse を更新する
  // room / hall / plate と長さ、減衰を変えることで残響の質感を切り替える
  setSeReverbImpulse(config = {}) {
    this.ensureContext();
    this.toneReverbImpulseConfig = this.normalizeImpulseConfig(config);
    this.seReverbImpulseConfig = this.toneReverbImpulseConfig;
    this.updateConvolverImpulse(this.toneConvolver, this.toneReverbImpulseConfig);
    return this.getSeReverbImpulseConfig();
  }

  // 現在の SE / 単音用 reverb impulse 設定をコピーして返す
  // 呼び出し側が戻り値を書き換えても、内部状態が直接変わらないようにする
  getSeReverbImpulseConfig() {
    return { ...this.toneReverbImpulseConfig };
  }

  // SE / 単音用 envelope preset を登録または置き換える
  // playTone() の profile 名から参照されるため、4 要素を明示的に検証する
  setSeEnvelopePreset(name, config) {
    if (!name || typeof name !== "string") {
      throw new Error("ToneSynth envelope preset name must be a non-empty string.");
    }
    if (!config || typeof config !== "object") {
      throw new Error("ToneSynth envelope config must be an object.");
    }
    this.toneEnvelopePresets[name] = {
      attack: util.readFiniteNumber(config.attack, `ToneSynth envelope ${name} attack`, { min: 0.0 }),
      decay: util.readFiniteNumber(config.decay, `ToneSynth envelope ${name} decay`, { min: 0.0 }),
      sustain: util.readFiniteNumber(config.sustain, `ToneSynth envelope ${name} sustain`, { min: 0.0 }),
      release: util.readFiniteNumber(config.release, `ToneSynth envelope ${name} release`, { min: 0.0 })
    };
    this.seEnvelopePresets = this.toneEnvelopePresets;
  }

  // 指定した SE / 単音用 envelope preset をコピーして返す
  // profile 名の間違いは Unknown として明確に失敗させる
  getSeEnvelopePreset(name) {
    if (!name || typeof name !== "string") {
      throw new Error("ToneSynth envelope preset name must be a non-empty string.");
    }
    const preset = this.toneEnvelopePresets[name];
    if (!preset) {
      throw new Error(`Unknown ToneSynth envelope preset: ${name}`);
    }
    return { ...preset };
  }

  // 登録済みの SE / 単音用 envelope profile 名を返す
  // sound sample の UI はこの一覧から選択肢を組み立てられる
  getSeEnvelopePresetList() {
    return Object.keys(this.toneEnvelopePresets);
  }

  // 単音を生成し、ADSR とエフェクトを適用して toneBus へ流す
  // dur を null にすると sustain 状態を維持し、stopTone() で明示停止できる
  playTone(freq, dur = 0.12, options = {}) {
    this.ensureContext();
    const opts = util.readPlainObject(options, "ToneSynth playTone options", {});
    const now = this.ctx.currentTime;
    const type = opts.type ?? "sine";
    const gain = util.readOptionalFiniteNumber(opts.gain, "ToneSynth tone gain", 0.18, { min: 0.0 });
    const profile = opts.profile ?? "piano";
    const preset = this.toneEnvelopePresets[profile];
    if (!preset) {
      throw new Error(`Unknown ToneSynth envelope profile: ${profile}`);
    }
    const attack = util.readOptionalFiniteNumber(opts.attack, "ToneSynth tone attack", preset.attack, { min: 0.0 });
    const decay = util.readOptionalFiniteNumber(opts.decay, "ToneSynth tone decay", preset.decay, { min: 0.0 });
    const sustain = util.readOptionalFiniteNumber(opts.sustain, "ToneSynth tone sustain", preset.sustain, { min: 0.0 });
    const release = util.readOptionalFiniteNumber(opts.release, "ToneSynth tone release", preset.release, { min: 0.0 });
    const detune = util.readOptionalFiniteNumber(opts.detune, "ToneSynth tone detune", 0.0);
    const when = util.readOptionalFiniteNumber(opts.when, "ToneSynth tone when", now);
    const pan = util.readOptionalFiniteNumber(opts.pan, "ToneSynth tone pan", 0.0, { min: -1.0, max: 1.0 });
    const holdDuration = dur === null ? null : util.readFiniteNumber(dur, "ToneSynth tone duration", { min: 0.0 });

    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = util.readFiniteNumber(freq, "ToneSynth tone frequency", { minExclusive: 0.0 });
    osc.detune.value = detune;

    const amp = this.ctx.createGain();
    amp.gain.value = 0.0;

    let output = amp;
    if (this.ctx.createStereoPanner) {
      const panner = this.ctx.createStereoPanner();
      panner.pan.value = pan;
      amp.connect(panner);
      output = panner;
    }

    output.connect(this.toneBus);
    osc.connect(amp);

    const attackEnd = when + attack;
    const decayEnd = attackEnd + decay;
    const sustainGain = gain * sustain;
    amp.gain.setValueAtTime(0.0, when);
    amp.gain.linearRampToValueAtTime(gain, attackEnd);
    amp.gain.linearRampToValueAtTime(sustainGain, decayEnd);

    const voice = {
      osc,
      amp,
      startTime: when,
      releaseSec: release,
      sustainGain,
      stopped: false
    };
    voice.stop = (stopWhen = this.ctx.currentTime, stopOptions = {}) => {
      this.stopTone(voice, stopWhen, stopOptions);
    };

    this.activeVoices.add(voice);
    osc.onended = () => {
      this.activeVoices.delete(voice);
      voice.stopped = true;
      osc.disconnect();
      amp.disconnect();
    };

    osc.start(when);

    if (holdDuration !== null) {
      const sustainStart = when + holdDuration;
      amp.gain.setValueAtTime(sustainGain, sustainStart);
      amp.gain.linearRampToValueAtTime(0.0, sustainStart + release);
      osc.stop(sustainStart + release + 0.001);
      voice.stopTime = sustainStart + release;
    }

    return voice;
  }

  // playTone() が返した voice を release へ移行させる
  // dur=null で鳴らした持続音や、途中で止めたい音はこの関数で停止する
  stopTone(voice, when = null, options = {}) {
    if (!voice || voice.stopped) return;
    const opts = util.readPlainObject(options, "ToneSynth stopTone options", {});
    const now = this.ctx ? this.ctx.currentTime : 0.0;
    const stopWhen = when === null
      ? now
      : util.readFiniteNumber(when, "ToneSynth stopTone when");
    const release = util.readOptionalFiniteNumber(
      opts.release,
      "ToneSynth stopTone release",
      voice.releaseSec ?? 0.06,
      { min: 0.0 }
    );
    voice.amp.gain.cancelScheduledValues(stopWhen);
    voice.amp.gain.setValueAtTime(voice.sustainGain ?? 0.0, stopWhen);
    voice.amp.gain.linearRampToValueAtTime(0.0, stopWhen + release);
    try {
      voice.osc.stop(stopWhen + release + 0.001);
    } catch (_error) {
      // stop 済み voice の重複 stop は無視する
    }
    voice.stopTime = stopWhen + release;
    voice.stopped = true;
  }

  // 現在 activeVoices に残っている全 tone voice をまとめて停止する
  // scene 終了や pause 時に、長く残る単音を整理するために使う
  stopAllTones(options = {}) {
    const opts = util.readPlainObject(options, "ToneSynth stopAllTones options", {});
    const now = this.ctx ? this.ctx.currentTime : 0.0;
    const release = util.readOptionalFiniteNumber(
      opts.release,
      "ToneSynth stopAllTones release",
      0.04,
      { min: 0.0 }
    );
    const voices = [...this.activeVoices];
    for (let i = 0; i < voices.length; i++) {
      this.stopTone(voices[i], now, { release });
    }
  }

  // impulse response の性格差を小さい設定表で切り替える
  // room は短く近い反射、hall は広く長い tail、plate は金属板らしい感じ
  getImpulseProfile(kind = "room") {
    const profiles = {
      room: {
        alphaStart: 0.86,
        alphaEnd: 0.18,
        reflectionBurstMs: 2.0,
        earlyReflections: [
          { leftMs: 17, rightMs: 23, gain: 0.42 },
          { leftMs: 31, rightMs: 37, gain: 0.28 },
          { leftMs: 49, rightMs: 57, gain: 0.18 }
        ]
      },
      hall: {
        alphaStart: 0.78,
        alphaEnd: 0.07,
        reflectionBurstMs: 3.0,
        earlyReflections: [
          { leftMs: 41, rightMs: 53, gain: 0.26 },
          { leftMs: 67, rightMs: 79, gain: 0.18 },
          { leftMs: 104, rightMs: 118, gain: 0.12 }
        ]
      },
      plate: {
        alphaStart: 0.92,
        alphaEnd: 0.12,
        reflectionBurstMs: 1.6,
        earlyReflections: [
          { leftMs: 9, rightMs: 11, gain: 0.24 },
          { leftMs: 17, rightMs: 19, gain: 0.18 },
          { leftMs: 27, rightMs: 31, gain: 0.12 }
        ]
      }
    };
    return profiles[kind] ?? profiles.room;
  }

  // impulse response の tail になる減衰ノイズを書き込む
  // 時間が進むほど振幅と高域を落とし、単純な white noise より残響らしくする
  writeImpulseTail(data, decay, profile) {
    const length = data.length;
    let filtered = 0.0;
    for (let i = 0; i < length; i++) {
      const t = length > 1 ? i / (length - 1) : 0.0;
      const amp = Math.pow(1.0 - t, decay);
      const white = this.reverbRandom.random() * 2.0 - 1.0;
      const alpha = profile.alphaStart + ((profile.alphaEnd - profile.alphaStart) * t);
      filtered += (white - filtered) * alpha;
      data[i] = filtered * amp;
    }
  }

  // impulse response の冒頭に early reflection を追加する
  // room / hall / plate の最初の跳ね返り方を変えて、空間の大きさを聞き分けやすくする
  addEarlyReflections(data, sampleRate, profile, channelIndex) {
    const length = data.length;
    const burstLength = Math.max(1, Math.floor((profile.reflectionBurstMs / 1000) * sampleRate));
    const timeKey = channelIndex === 0 ? "leftMs" : "rightMs";
    for (let i = 0; i < profile.earlyReflections.length; i++) {
      const reflection = profile.earlyReflections[i];
      const start = Math.floor((reflection[timeKey] / 1000) * sampleRate);
      if (start >= length) continue;
      for (let j = 0; j < burstLength; j++) {
        const index = start + j;
        if (index >= length) break;
        const t = burstLength > 1 ? j / (burstLength - 1) : 0.0;
        const burst = (1.0 - t) * (0.55 + this.reverbRandom.random() * 0.45);
        data[index] += burst * reflection.gain;
      }
    }
  }

  // impulse response 全体の peak をそろえる
  // early reflection を足した後でも、ConvolverNode へ極端に大きい信号を渡さないようにする
  normalizeImpulse(impulse, peak = 0.85) {
    let maxAbs = 0.0;
    for (let ch = 0; ch < impulse.numberOfChannels; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < data.length; i++) {
        maxAbs = Math.max(maxAbs, Math.abs(data[i]));
      }
    }
    if (maxAbs <= 0.000001) {
      return impulse;
    }
    const gain = peak / maxAbs;
    for (let ch = 0; ch < impulse.numberOfChannels; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < data.length; i++) {
        data[i] *= gain;
      }
    }
    return impulse;
  }

  // ConvolverNode に渡す stereo impulse response を手続き的に作る
  // 外部音声ファイルを使わず、tail noise と early reflection から残響素材を生成する
  createImpulseResponse(ctx, durationSec = 1.5, decay = 2.5, options = {}) {
    const length = Math.max(1, Math.floor(ctx.sampleRate * durationSec));
    const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
    const profile = this.getImpulseProfile(options.kind ?? "room");
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      this.writeImpulseTail(data, decay, profile);
      this.addEarlyReflections(data, ctx.sampleRate, profile, ch);
    }
    return this.normalizeImpulse(impulse);
  }
}
