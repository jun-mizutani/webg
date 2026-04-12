// ---------------------------------------------
//  AudioSynth.js    2026/04/09
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

export default class AudioSynth {

  constructor() {
    // WebAudio のノードは遅延初期化する
    // ユーザー操作前に AudioContext を作ると再生制限に引っかかりやすいため
    this.ctx = null;
    this.master = null;
    this.seBus = null;
    this.bgmBus = null;
    this.fxInitialized = false;

    this.started = false;
    this.playingBgm = false;
    this.bgmTimer = null;
    this.nextBeatTime = 0;
    this.bgmStep = 0;
    this.bgmBar = 0;
    this.bgmTransposeSemitone = 0;

    // BGM デフォルト設定
    this.bpm = 124;
    this.beat = 60.0 / this.bpm;
    this.root = 220.0;
    this.lookAheadSec = 0.20;
    this.tickMs = 25;

    // 転調候補（半音）0=元キー
    // 極端な移動は避け、ゲームBGMとして破綻しにくい範囲に限定する
    this.modulationCycle = [0, 2, -3, 5, 0, -2, 3, 0];
    this.modulationIndex = 0;
    this.modulateEveryBars = 4;
    this.modulateProbability = 0.60;

    // リズムパート（低音）の音抜き設定
    // 強拍は維持し、弱拍のみ確率で休符化する
    this.rhythmDropWeakProb = 0.30;
    this.rhythmDropTailProb = 0.55;

    // メロディ/SEの具体プリセットはサブクラス側に寄せる
    this.melodies = {};
    this.melodyName = null;
    this.melody = null;

    // エンベロープはコアで管理する
    this.seEnvelopePresets = {
      soft: { attack: 0.005, decay: 0.05, sustain: 0.55, release: 0.08 },
      pluck: { attack: 0.001, decay: 0.025, sustain: 0.25, release: 0.03 },
      hit: { attack: 0.001, decay: 0.02, sustain: 0.15, release: 0.05 },
      boom: { attack: 0.003, decay: 0.08, sustain: 0.50, release: 0.14 },
      sweep: { attack: 0.002, decay: 0.03, sustain: 0.30, release: 0.04 },
      pad: { attack: 0.02, decay: 0.12, sustain: 0.70, release: 0.18 }
    };
    this.bgmEnvelope = { attack: 0.03, decay: 0.2, sustain: 0.6, release: 0.4 };
    this.seReverbImpulseConfig = { kind: "hall", durationSec: 3.2, decay: 1.8 };
    this.bgmReverbImpulseConfig = { kind: "hall", durationSec: 4.0, decay: 1.9 };
  }

  ensureContext() {
    if (this.ctx) return this.ctx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) {
      throw new Error("Web Audio API is not supported in this browser.");
    }
    this.ctx = new Ctx();

    // Master -> destination
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.25;
    this.master.connect(this.ctx.destination);

    // SE/BGM を別バスで管理
    this.seBus = this.ctx.createGain();
    this.seBus.gain.value = 0.90;

    this.bgmBus = this.ctx.createGain();
    this.bgmBus.gain.value = 0.75;
    this.buildFxChain();
    return this.ctx;
  }

  buildFxChain() {
    if (this.fxInitialized) return;
    const ctx = this.ctx;

    // ---- SE FX Chain ----
    this.seDry = ctx.createGain();
    this.seWet = ctx.createGain();
    this.seDelay = ctx.createDelay(1.2);
    this.seFeedback = ctx.createGain();
    this.seTone = ctx.createBiquadFilter();
    this.seTone.type = "lowpass";
    this.seTone.frequency.value = 2600;

    this.seDry.gain.value = 0.88;
    this.seWet.gain.value = 0.22;
    this.seDelay.delayTime.value = 0.11;
    this.seFeedback.gain.value = 0.26;

    this.seRevSend = ctx.createGain();
    this.seConvolver = ctx.createConvolver();
    this.seRevReturn = ctx.createGain();
    this.seRevSend.gain.value = 0.32;
    this.seRevReturn.gain.value = 0.55;
    // SE は room より少し広い hall 系 IR を既定にして、余韻を聞き取りやすくする
    this.updateConvolverImpulse(this.seConvolver, this.seReverbImpulseConfig);

    this.seBus.connect(this.seDry);
    this.seBus.connect(this.seDelay);
    this.seBus.connect(this.seRevSend);
    this.seDelay.connect(this.seTone);
    this.seTone.connect(this.seFeedback);
    this.seFeedback.connect(this.seDelay);
    this.seTone.connect(this.seWet);
    this.seRevSend.connect(this.seConvolver);
    this.seConvolver.connect(this.seRevReturn);
    this.seDry.connect(this.master);
    this.seWet.connect(this.master);
    this.seRevReturn.connect(this.master);

    // ---- BGM FX Chain ----
    this.bgmDry = ctx.createGain();
    this.bgmWet = ctx.createGain();
    this.bgmDelay = ctx.createDelay(2.0);
    this.bgmFeedback = ctx.createGain();
    this.bgmTone = ctx.createBiquadFilter();
    this.bgmTone.type = "lowpass";
    this.bgmTone.frequency.value = 3200;

    this.bgmDry.gain.value = 0.90;
    this.bgmWet.gain.value = 0.18;
    this.bgmDelay.delayTime.value = 0.18;
    this.bgmFeedback.gain.value = 0.22;

    this.bgmRevSend = ctx.createGain();
    this.bgmConvolver = ctx.createConvolver();
    this.bgmRevReturn = ctx.createGain();
    this.bgmRevSend.gain.value = 0.28;
    this.bgmRevReturn.gain.value = 0.48;
    // BGM は hall 系 IR を既定にし、SE より少し広めで長い tail を聞き取りやすくする
    this.updateConvolverImpulse(this.bgmConvolver, this.bgmReverbImpulseConfig);

    this.bgmBus.connect(this.bgmDry);
    this.bgmBus.connect(this.bgmDelay);
    this.bgmBus.connect(this.bgmRevSend);
    this.bgmDelay.connect(this.bgmTone);
    this.bgmTone.connect(this.bgmFeedback);
    this.bgmFeedback.connect(this.bgmDelay);
    this.bgmTone.connect(this.bgmWet);
    this.bgmRevSend.connect(this.bgmConvolver);
    this.bgmConvolver.connect(this.bgmRevReturn);
    this.bgmDry.connect(this.master);
    this.bgmWet.connect(this.master);
    this.bgmRevReturn.connect(this.master);

    this.fxInitialized = true;
  }

  async resume() {
    this.ensureContext();
    if (this.ctx.state === "suspended") {
      await this.ctx.resume();
    }
    this.started = true;
  }

  setMasterVolume(v) {
    this.ensureContext();
    this.master.gain.value = v;
  }

  setSeVolume(v) {
    this.ensureContext();
    this.seBus.gain.value = v;
  }

  setBgmVolume(v) {
    this.ensureContext();
    this.bgmBus.gain.value = v;
  }

  setSeDelay(timeSec = 0.11, feedback = 0.26, wet = 0.22) {
    this.ensureContext();
    this.seDelay.delayTime.value = timeSec;
    this.seFeedback.gain.value = feedback;
    this.seWet.gain.value = wet;
  }

  setBgmDelay(timeSec = 0.18, feedback = 0.22, wet = 0.18) {
    this.ensureContext();
    this.bgmDelay.delayTime.value = timeSec;
    this.bgmFeedback.gain.value = feedback;
    this.bgmWet.gain.value = wet;
  }

  setSeReverb(send = 0.28, returnGain = 0.48) {
    this.ensureContext();
    this.seRevSend.gain.value = send;
    this.seRevReturn.gain.value = returnGain;
  }

  setBgmReverb(send = 0.28, returnGain = 0.48) {
    this.ensureContext();
    this.bgmRevSend.gain.value = send;
    this.bgmRevReturn.gain.value = returnGain;
  }

  // UI から選べる IR 種別一覧を返す
  getImpulseKindList() {
    return ["room", "hall", "plate"];
  }

  // impulse response 設定は kind / duration / decay の 3 値で持ち、
  // 不正値が来ても現在設定を壊しにくいように clamp 済み object へ正規化する
  normalizeImpulseConfig(config = {}, fallback = {}) {
    const kind = String(config.kind);
    if (!this.getImpulseKindList().includes(kind)) {
      throw new Error(`AudioSynth impulse kind must be one of: ${this.getImpulseKindList().join(", ")}`);
    }
    const durationBase = Number(config.durationSec);
    const decayBase = Number(config.decay);
    return {
      kind,
      durationSec: durationBase,
      decay: decayBase
    };
  }

  // 既存 ConvolverNode の buffer だけを差し替え、
  // send / return の routing を変えずに IR character だけ更新する
  updateConvolverImpulse(convolver, config) {
    if (!this.ctx || !convolver) return;
    convolver.buffer = this.createImpulseResponse(
      this.ctx,
      config.durationSec,
      config.decay,
      { kind: config.kind }
    );
  }

  // SE 側 reverb IR の character / duration / decay を更新する
  setSeReverbImpulse(config = {}) {
    this.ensureContext();
    this.seReverbImpulseConfig = this.normalizeImpulseConfig(config, this.seReverbImpulseConfig);
    this.updateConvolverImpulse(this.seConvolver, this.seReverbImpulseConfig);
    return this.getSeReverbImpulseConfig();
  }

  // BGM 側 reverb IR の character / duration / decay を更新する
  setBgmReverbImpulse(config = {}) {
    this.ensureContext();
    this.bgmReverbImpulseConfig = this.normalizeImpulseConfig(config, this.bgmReverbImpulseConfig);
    this.updateConvolverImpulse(this.bgmConvolver, this.bgmReverbImpulseConfig);
    return this.getBgmReverbImpulseConfig();
  }

  getSeReverbImpulseConfig() {
    return { ...this.seReverbImpulseConfig };
  }

  getBgmReverbImpulseConfig() {
    return { ...this.bgmReverbImpulseConfig };
  }

  // 基本トーン生成:
  //   type: sine/square/sawtooth/triangle
  //   gain: 0.0-1.0
  //   dur: 秒
  playTone(freq, dur = 0.12, options = {}) {
    this.ensureContext();
    // playTone() はゲームSE組み立て用の内部 helper でもあるため、
    // 未指定 option は WebAudio の自然な既定値と標準 envelope へ寄せる
    const now = this.ctx.currentTime;
    const type = options.type ?? "sine";
    const gain = options.gain ?? 0.18;
    const profile = options.profile ?? "soft";
    const preset = this.seEnvelopePresets[profile];
    if (!preset) {
      throw new Error(`Unknown SE envelope profile: ${profile}`);
    }
    const attack = options.attack ?? preset?.attack;
    const decay = options.decay ?? preset?.decay;
    const sustain = options.sustain ?? preset?.sustain;
    const release = options.release ?? preset?.release;
    const detune = options.detune ?? 0.0;
    const when = options.when ?? now;
    const pan = options.pan ?? 0.0;

    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    osc.detune.value = detune;

    const env = this.ctx.createGain();
    env.gain.value = 0.0;

    let output = env;
    if (this.ctx.createStereoPanner) {
      const panner = this.ctx.createStereoPanner();
      panner.pan.value = pan;
      env.connect(panner);
      output = panner;
    }

    output.connect(this.seBus);
    osc.connect(env);

    const a = when;
    const d = a + attack;
    const s = d + decay;
    const end = a + dur;
    const r = end + release;

    env.gain.setValueAtTime(0.0, a);
    env.gain.linearRampToValueAtTime(gain, d);
    env.gain.linearRampToValueAtTime(gain * sustain, s);
    env.gain.setValueAtTime(gain * sustain, end);
    env.gain.linearRampToValueAtTime(0.0, r);

    osc.start(a);
    osc.stop(r + 0.001);
  }

  // 未定義名へ自動トーンを割り当てず、呼び出し側に解決を委ねる
  playSe(name) {
    throw new Error(`Unknown sound effect: ${name}`);
  }

  setBpm(bpm) {
    this.bpm = bpm;
    this.beat = 60.0 / this.bpm;
  }

  setRootHz(hz) {
    this.root = hz;
  }

  getMelodyList() {
    return Object.keys(this.melodies);
  }

  setMelody(name) {
    if (!this.melodies[name]) {
      throw new Error(`Unknown melody: ${name}`);
    }
    this.melodyName = name;
    this.melody = this.melodies[name];
  }

  // 外側から任意メロディを追加
  // 必須の完全バリデーションは行わず、足りない項目は再生時にデフォルト補完する
  registerMelody(name, config) {
    if (!name || typeof name !== "string") {
      throw new Error("Melody name must be a non-empty string.");
    }
    if (!config || typeof config !== "object") {
      throw new Error("Melody config must be an object.");
    }
    if (!Array.isArray(config.leadHoldSteps) || config.leadHoldSteps.length === 0) {
      throw new Error(`Melody '${name}' requires leadHoldSteps`);
    }
    if (!Number.isFinite(config.rhythmDropWeakProb) || !Number.isFinite(config.rhythmDropTailProb)) {
      throw new Error(`Melody '${name}' requires rhythmDropWeakProb and rhythmDropTailProb`);
    }
    this.melodies[name] = { ...config };
    if (!this.melodyName) {
      this.melodyName = name;
      this.melody = this.melodies[name];
    }
  }

  startBgm() {
    this.ensureContext();
    if (this.playingBgm) return;
    this.playingBgm = true;
    this.bgmStep = 0;
    this.bgmBar = 0;
    this.bgmTransposeSemitone = 0;
    this.modulationIndex = 0;
    this.nextBeatTime = this.ctx.currentTime + 0.05;
    this.bgmBus.gain.cancelScheduledValues(this.ctx.currentTime);
    this.bgmBus.gain.setTargetAtTime(0.75, this.ctx.currentTime, 0.08);

    this.bgmTimer = window.setInterval(() => {
      this.scheduleBgm(this.lookAheadSec);
    }, this.tickMs);
  }

  stopBgm(fadeSec = 0.20) {
    if (!this.playingBgm) return;
    this.playingBgm = false;
    if (this.bgmTimer !== null) {
      clearInterval(this.bgmTimer);
      this.bgmTimer = null;
    }
    if (this.ctx && this.bgmBus) {
      const t = this.ctx.currentTime;
      this.bgmBus.gain.cancelScheduledValues(t);
      this.bgmBus.gain.setTargetAtTime(0.0, t, Math.max(0.02, fadeSec * 0.25));
    }
  }

  // 8分音符ベースの簡易シーケンサー
  scheduleBgm(lookAheadSec) {
    if (!this.playingBgm) return;
    while (this.nextBeatTime < this.ctx.currentTime + lookAheadSec) {
      this.scheduleBgmStep(this.bgmStep, this.nextBeatTime);
      this.nextBeatTime += this.beat * 0.5;
      this.bgmStep = (this.bgmStep + 1) % 16;
    }
  }

  // 16ステップの固定パターン:
  // - low: ベース
  // - high: リード
  scheduleBgmStep(step, when) {
    // 4/4想定: 16ステップを1小節として扱う
    if (step === 0) {
      this.bgmBar += 1;
      this.maybeModulate();
    }

    const melody = this.melody ?? {};
    const scale = melody.scale ?? [0, 2, 3, 5, 7, 8, 10];
    const bassPattern = melody.bassPattern ?? [0, -5, -2, -7];
    const bassDegree = bassPattern[Math.floor(step / 4) % bassPattern.length];
    if (bassDegree !== null && bassDegree !== undefined && this.shouldPlayRhythm(step, melody)) {
      const bassSemi = this.degreeToSemitone(scale, bassDegree)
        + (melody.bassOctave ?? 0)
        + this.bgmTransposeSemitone;
      const bassHz = this.root * Math.pow(2, bassSemi / 12);
      this.playBgmVoice(
        bassHz,
        when,
        melody.bassDur ?? 0.18,
        melody.bassType ?? "triangle",
        melody.bassGain ?? 0.08
      );
    }

    const stepSec = this.beat * 0.5;
    let leadDegree = null;
    if (Array.isArray(melody.leadDegrees)) {
      leadDegree = melody.leadDegrees[step % melody.leadDegrees.length];
    } else {
      const leadGate = melody.leadGate ?? [0, 3, 6, 8, 10, 13, 14];
      if (leadGate.includes(step)) {
        const degreeStep = melody.leadDegreeStep ?? 3;
        leadDegree = (step * degreeStep) % scale.length;
      }
    }

    if (leadDegree !== null && leadDegree !== undefined) {
      const semitone = this.degreeToSemitone(scale, leadDegree)
        + (melody.leadOctave ?? 12)
        + this.bgmTransposeSemitone;
      const leadHz = this.root * Math.pow(2, semitone / 12);
      const leadHold = this.getStepParam(melody.leadHoldSteps, step, 1.0);
      const baseLeadDur = melody.leadDur ?? 0.12;
      const stretchedLeadDur = Math.max(baseLeadDur, stepSec * leadHold * 0.95);
      this.playBgmVoice(
        leadHz,
        when,
        stretchedLeadDur,
        melody.leadType ?? "square",
        melody.leadGain ?? 0.06
      );
    }
  }

  // ステップ依存パラメータを配列から取得するユーティリティ
  // melody 定義側で必ず配列を持つ前提にし、欠落の自動補完は行わない
  getStepParam(arr, step, fallback) {
    if (!Array.isArray(arr) || arr.length === 0) {
      throw new Error("Melody step parameter array is required");
    }
    const v = arr[step % arr.length];
    if (v === null || v === undefined || Number.isNaN(Number(v))) {
      throw new Error(`Melody step parameter at ${step} must be numeric`);
    }
    return Number(v);
  }

  // リズム音抜き判定:
  // - 4拍子の強拍(0,4,8,12)は常に鳴らす
  // - それ以外の弱拍は時々休符にする
  // - 小節末(7,15)は少し高め確率で抜いてフレーズの息継ぎを作る
  shouldPlayRhythm(step, melody) {
    if ((step % 4) === 0) return true;
    const isTail = (step % 8) === 7;
    const weak = melody?.rhythmDropWeakProb;
    const tail = melody?.rhythmDropTailProb;
    const p = isTail ? tail : weak;
    return Math.random() > p;
  }

  // degree(度数) -> semitone(半音) へ変換する
  // negative degree も扱えるように wrap してオクターブを補正する
  degreeToSemitone(scale, degree) {
    const n = scale.length;
    const wrapped = ((degree % n) + n) % n;
    const octave = (degree - wrapped) / n;
    return scale[wrapped] + octave * 12;
  }

  // 一定小節ごとに時々だけ転調する
  // 常に変えると落ち着かないため、確率ゲートを入れる
  maybeModulate() {
    if (this.bgmBar <= 0) return;
    if ((this.bgmBar % this.modulateEveryBars) !== 0) return;
    if (Math.random() > this.modulateProbability) return;

    this.modulationIndex = (this.modulationIndex + 1) % this.modulationCycle.length;
    this.bgmTransposeSemitone = this.modulationCycle[this.modulationIndex];
  }

  playBgmVoice(freq, when, dur, type, gain) {
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;

    const amp = this.ctx.createGain();
    amp.gain.value = 0.0;
    amp.connect(this.bgmBus);
    osc.connect(amp);

    const a = when;
    const env = this.bgmEnvelope ?? {};
    const attack = env.attack ?? 0.02;
    const decay = env.decay ?? 0.06;
    const sustain = env.sustain ?? 0.65;
    const release = env.release ?? 0.06;
    const peak = when + attack;
    const sustainStart = when + dur;
    const decayEnd = Math.min(peak + decay, sustainStart);
    amp.gain.setValueAtTime(0.0, a);
    amp.gain.linearRampToValueAtTime(gain, peak);
    amp.gain.linearRampToValueAtTime(gain * sustain, decayEnd);
    amp.gain.setValueAtTime(gain * sustain, sustainStart);
    amp.gain.linearRampToValueAtTime(0.0, sustainStart + release);

    osc.start(a);
    osc.stop(sustainStart + release + 0.01);
  }

  setSeEnvelopePreset(name, config) {
    if (!name || typeof name !== "string") {
      throw new Error("Envelope preset name must be a non-empty string.");
    }
    if (!config || typeof config !== "object") {
      throw new Error("Envelope config must be an object.");
    }
    this.seEnvelopePresets[name] = { ...config };
  }

  getSeEnvelopePreset(name) {
    if (!name || typeof name !== "string") {
      throw new Error("Envelope preset name must be a non-empty string.");
    }
    const preset = this.seEnvelopePresets[name];
    if (!preset) {
      throw new Error(`Unknown envelope preset: ${name}`);
    }
    return { ...preset };
  }

  getSeEnvelopePresetList() {
    return Object.keys(this.seEnvelopePresets);
  }

  setBgmEnvelope(config) {
    if (!config || typeof config !== "object") {
      throw new Error("BGM envelope config must be an object.");
    }
    this.bgmEnvelope = { ...this.bgmEnvelope, ...config };
  }

  getBgmEnvelope() {
    return { ...this.bgmEnvelope };
  }

  // impulse response の性格差を小さい設定表で切り替える
  // room は短く近い反射、hall は広く長い tail、plate は金属板らしい明るさを意識する
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

  // 時間が進むほど smoothing を強めたノイズ列を作る
  // これにより tail 後半の高域が少しずつ減り、単純な white noise より自然に聞こえやすくする
  writeImpulseTail(data, decay, profile) {
    const length = data.length;
    let filtered = 0.0;
    for (let i = 0; i < length; i++) {
      const t = length > 1 ? i / (length - 1) : 0.0;
      const amp = Math.pow(1.0 - t, decay);
      const white = Math.random() * 2.0 - 1.0;
      const alpha = profile.alphaStart + ((profile.alphaEnd - profile.alphaStart) * t);
      filtered += (white - filtered) * alpha;
      data[i] = filtered * amp;
    }
  }

  // 冒頭へ数本の early reflection を足して、
  // room / hall / plate の「最初の跳ね返り方」の差を出しやすくする
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
        const burst = (1.0 - t) * (0.55 + Math.random() * 0.45);
        data[index] += burst * reflection.gain;
      }
    }
  }

  // early reflection を足すと peak が上がりやすいので、channel 間をそろえて軽く正規化する
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

  // ConvolverNode 用 Impulse Response データを手続き的に生成
  // 減衰するホワイトノイズで、ConvolverNode に入れて reverb tail を作る
  // durationSec 秒ぶんの長さで stereo AudioBuffer を作る
  // 左右の channel をランダム値を平滑化したノイズで埋める
  // そのランダム値に amp = (1 - t)^decay を掛けて、時間が進むほど小さくする
  // 1. kind(room/hall/plate) の character 切り替え
  // 2. 初期反射のピーク(early reflection)の数本追加
  // 3. tail 後半で高域を落とす簡易 damping
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
