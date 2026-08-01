// ---------------------------------------------
//  AudioSynth.js    2026/08/01
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import util from "./util.js";
import ToneSynth from "./ToneSynth.js";

export default class AudioSynth extends ToneSynth {

  // ToneSynth の単音基盤を SE として使い、そこへ BGM 用 bus とシーケンサー状態を追加する
  // GameAudioSynth はこのクラスの上にプリセット名と効果音カタログを載せる
  constructor(options = {}) {
    const opts = util.readPlainObject(options, "AudioSynth options", {});
    super({
      randomSeed: opts.randomSeed,
      masterGain: 0.25,
      toneBusGain: 0.90,
      toneDryGain: 0.88,
      toneWetGain: 0.22,
      toneDelayTime: 0.11,
      toneFeedbackGain: 0.26,
      toneLowpassFrequency: 2600,
      toneReverbSend: 0.32,
      toneReverbReturn: 0.55,
      toneEnvelopePresets: {
        percussion: { attack: 0.001, decay: 0.030, sustain: 0.04, release: 0.035 },
        brass: { attack: 0.085, decay: 0.180, sustain: 0.82, release: 0.280 },
        woodwind: { attack: 0.145, decay: 0.120, sustain: 0.58, release: 0.220 },
        organ: { attack: 0.004, decay: 0.010, sustain: 0.98, release: 0.180 },
        piano: { attack: 0.002, decay: 0.420, sustain: 0.16, release: 0.180 },
        guitar: { attack: 0.001, decay: 0.160, sustain: 0.08, release: 0.090 }
      },
      toneReverbImpulseConfig: { kind: "hall", durationSec: 3.2, decay: 1.8 }
    });

    // BGMの休符と転調を別streamへ分け、片方の判定回数がもう片方を変えないようにする
    this.rhythmRandom = this.createRandomGenerator(0x72687974);
    this.modulationRandom = this.createRandomGenerator(0x6d6f6475);

    // ToneSynth が持つ単音用 bus / envelope / reverb を、
    // AudioSynth では SE 用の基盤としてそのまま使う
    this.seBus = null;
    this.seDry = null;
    this.seWet = null;
    this.seDelay = null;
    this.seFeedback = null;
    this.seTone = null;
    this.seRevSend = null;
    this.seConvolver = null;
    this.seRevReturn = null;
    this.seEnvelopePresets = this.toneEnvelopePresets;
    this.seReverbImpulseConfig = this.toneReverbImpulseConfig;

    // BGM 側は AudioSynth が追加で管理する
    this.bgmBus = null;
    this.bgmDry = null;
    this.bgmWet = null;
    this.bgmDelay = null;
    this.bgmFeedback = null;
    this.bgmTone = null;
    this.bgmRevSend = null;
    this.bgmConvolver = null;
    this.bgmRevReturn = null;
    this.bgmFxInitialized = false;

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
    // 強拍は維持し、弱拍のみ確率で休符化して変化をつける
    this.rhythmDropWeakProb = 0.30;
    this.rhythmDropTailProb = 0.55;

    // メロディ/SEのプリセットはサブクラス側に実装する
    this.melodies = {};
    this.melodyName = null;
    this.melody = null;

    this.bgmEnvelope = { attack: 0.03, decay: 0.2, sustain: 0.6, release: 0.4 };
    this.bgmReverbImpulseConfig = { kind: "hall", durationSec: 4.0, decay: 1.9 };

    // mp3 / wav / ogg などの外部音声素材は AudioBuffer として保持する
    // 読み込み名の誤りや未ロード再生は例外にし、無音や代替 tone へ丸めない
    this.audioBuffers = new Map();
    this.activeAudioBufferVoices = new Set();
  }

  // ToneSynth が生成した単音用バスを SE 名で扱えるように束ね直す
  // SE 用の公開プロパティを参照する既存 UI が、toneBus の実体へ到達できるようにする
  bindSeAliases() {
    this.seBus = this.toneBus;
    this.seDry = this.toneDry;
    this.seWet = this.toneWet;
    this.seDelay = this.toneDelay;
    this.seFeedback = this.toneFeedback;
    this.seTone = this.toneTone;
    this.seRevSend = this.toneRevSend;
    this.seConvolver = this.toneConvolver;
    this.seRevReturn = this.toneRevReturn;
    this.seEnvelopePresets = this.toneEnvelopePresets;
    this.seReverbImpulseConfig = this.toneReverbImpulseConfig;
  }

  // ToneSynth の AudioContext と SE 系統を用意したあと、BGM 系統を追加する
  // BGM bus は SE と別にして、音量、delay、reverb を個別に調整できるようにする
  ensureContext() {
    const ctx = super.ensureContext();
    this.bindSeAliases();
    if (this.bgmFxInitialized) {
      return ctx;
    }

    // BGM は SE と別 bus にし、音量と残響を個別に制御する
    this.bgmBus = this.ctx.createGain();
    this.bgmBus.gain.value = 0.75;
    this.buildBgmFxChain();
    return ctx;
  }

  // BGM bus から dry / delay / reverb に分岐し、最後に master へ戻す
  // SE 側とは別の delay 時間と reverb impulse を持たせ、長い音楽用の響きにする
  buildBgmFxChain() {
    if (this.bgmFxInitialized) return;
    const ctx = this.ctx;

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

    this.bgmFxInitialized = true;
  }

  // BGM bus の音量を変更する
  // SE とは別に、BGM だけを小さくしたりフェード処理の基準を変えたりできる
  setBgmVolume(v) {
    this.ensureContext();
    this.bgmBus.gain.value = util.readFiniteNumber(v, "AudioSynth BGM volume", { min: 0.0 });
  }

  // BGM bus の delay を変更する
  // timeSec は反復間隔、feedback は繰り返し量、wet は delay 音の混合量を表す
  setBgmDelay(timeSec = 0.18, feedback = 0.22, wet = 0.18) {
    this.ensureContext();
    this.bgmDelay.delayTime.value = util.readFiniteNumber(timeSec, "AudioSynth BGM delay time", { min: 0.0 });
    this.bgmFeedback.gain.value = util.readFiniteNumber(feedback, "AudioSynth BGM delay feedback", { min: 0.0 });
    this.bgmWet.gain.value = util.readFiniteNumber(wet, "AudioSynth BGM delay wet", { min: 0.0 });
  }

  // BGM bus の reverb 量を変更する
  // send と returnGain を分けることで、残響へ送る量と最終出力へ戻す量を個別に調整する
  setBgmReverb(send = 0.28, returnGain = 0.48) {
    this.ensureContext();
    this.bgmRevSend.gain.value = util.readFiniteNumber(send, "AudioSynth BGM reverb send", { min: 0.0 });
    this.bgmRevReturn.gain.value = util.readFiniteNumber(returnGain, "AudioSynth BGM reverb return", { min: 0.0 });
  }

  // BGM bus の reverb impulse を更新する
  // 長めの hall など、持続音に合う空間特性を SE とは別に設定できる
  setBgmReverbImpulse(config = {}) {
    this.ensureContext();
    this.bgmReverbImpulseConfig = this.normalizeImpulseConfig(config);
    this.updateConvolverImpulse(this.bgmConvolver, this.bgmReverbImpulseConfig);
    return this.getBgmReverbImpulseConfig();
  }

  // 現在の BGM 用 reverb impulse 設定をコピーして返す
  // UI 側が戻り値を編集しても内部状態へ直接影響しない
  getBgmReverbImpulseConfig() {
    return { ...this.bgmReverbImpulseConfig };
  }

  // 未定義名へ自動トーンを割り当てず、呼び出し側に解決を委ねる
  // GameAudioSynth はこのメソッドを上書きし、名前付き効果音 catalog を解決する
  playSe(name) {
    throw new Error(`Unknown sound effect: ${name}`);
  }

  // 音声素材名を検証する
  // 空文字や非文字列を許すと buffer table の参照ミスが見えにくくなるため明確に止める
  readAudioBufferName(name, label = "AudioSynth audio buffer name") {
    if (typeof name !== "string" || name.trim().length === 0) {
      throw new Error(`${label} must be a non-empty string.`);
    }
    return name.trim();
  }

  // AudioBuffer らしい object かを検証する
  // 実行環境によって AudioBuffer constructor を直接参照できないため、再生に必要な形だけを見る
  readAudioBufferObject(buffer, label = "AudioSynth audio buffer") {
    if (!buffer || typeof buffer !== "object" || typeof buffer.getChannelData !== "function") {
      throw new Error(`${label} must be an AudioBuffer.`);
    }
    if (!Number.isFinite(buffer.duration) || buffer.duration <= 0) {
      throw new Error(`${label} duration must be > 0.`);
    }
    return buffer;
  }

  // AudioBufferSourceNode の送り先 bus を解決する
  // 未知の bus 名は SE へ丸めず、呼び出し側の意図不明として例外にする
  getAudioBufferBus(busName = "se") {
    const bus = util.readOptionalEnum(busName, "AudioSynth audio buffer bus", "se", ["se", "bgm"]);
    this.ensureContext();
    if (bus === "se") {
      return { name: bus, node: this.seBus };
    }
    return { name: bus, node: this.bgmBus };
  }

  // 既に取得済みの ArrayBuffer を AudioBuffer に decode して登録する
  // fetch の責務と decode の責務を分けることで、アプリ側が独自 loader を使う場合にも再利用できる
  async decodeAudioBuffer(name, arrayBuffer) {
    const key = this.readAudioBufferName(name);
    if (!(arrayBuffer instanceof ArrayBuffer)) {
      throw new Error("AudioSynth decodeAudioBuffer source must be an ArrayBuffer.");
    }
    this.ensureContext();
    const copy = arrayBuffer.slice(0);
    const decoded = await this.ctx.decodeAudioData(copy);
    const buffer = this.readAudioBufferObject(decoded, `AudioSynth audio buffer '${key}'`);
    this.audioBuffers.set(key, buffer);
    return buffer;
  }

  // URL から mp3 / wav / ogg などの音声ファイルを読み込み、AudioBuffer として登録する
  // HTTP error や decode error はそのまま失敗として扱い、代替音へフォールバックしない
  async loadAudioBuffer(name, url) {
    const key = this.readAudioBufferName(name);
    if (typeof url !== "string" || url.trim().length === 0) {
      throw new Error("AudioSynth audio URL must be a non-empty string.");
    }
    const sourceUrl = url.trim();
    this.ensureContext();
    const response = await fetch(sourceUrl);
    if (!response.ok) {
      throw new Error(`Failed to load audio buffer '${key}': ${response.status} ${response.statusText}`);
    }
    return this.decodeAudioBuffer(key, await response.arrayBuffer());
  }

  // 既に作成済みの AudioBuffer を名前付き素材として登録する
  // 手続き生成や別 loader から渡された buffer を、AudioSynth の bus / reverb 経路へ流せるようにする
  registerAudioBuffer(name, buffer) {
    const key = this.readAudioBufferName(name);
    const audioBuffer = this.readAudioBufferObject(buffer, `AudioSynth audio buffer '${key}'`);
    this.audioBuffers.set(key, audioBuffer);
    return audioBuffer;
  }

  // 登録済みの音声素材名を返す
  // UI 側ではこの一覧を使って、実際に再生可能な素材だけを選択肢にできる
  getAudioBufferList() {
    return [...this.audioBuffers.keys()];
  }

  // 名前付き AudioBuffer をコピーではなく参照として返す
  // AudioBuffer は大きいので複製せず、未登録名は明確な設定ミスとして例外にする
  getAudioBuffer(name) {
    const key = this.readAudioBufferName(name);
    const buffer = this.audioBuffers.get(key);
    if (!buffer) {
      throw new Error(`Unknown audio buffer: ${key}`);
    }
    return buffer;
  }

  // 登録済み AudioBuffer を SE または BGM bus へ流して再生する
  // source は使い捨てなので、再生ごとに AudioBufferSourceNode と GainNode を作る
  playAudioBuffer(name, options = {}) {
    const key = this.readAudioBufferName(name);
    const opts = util.readPlainObject(options, "AudioSynth playAudioBuffer options", {});
    const buffer = this.getAudioBuffer(key);
    const bus = this.getAudioBufferBus(opts.bus === undefined ? "se" : opts.bus);
    const now = this.ctx.currentTime;
    const when = util.readOptionalFiniteNumber(opts.when, "AudioSynth audio buffer when", now);
    const gainValue = util.readOptionalFiniteNumber(opts.gain, "AudioSynth audio buffer gain", 1.0, { min: 0.0 });
    const playbackRate = util.readOptionalFiniteNumber(
      opts.playbackRate,
      "AudioSynth audio buffer playbackRate",
      1.0,
      { minExclusive: 0.0 }
    );
    const detune = util.readOptionalFiniteNumber(opts.detune, "AudioSynth audio buffer detune", 0.0);
    const offset = util.readOptionalFiniteNumber(
      opts.offset,
      "AudioSynth audio buffer offset",
      0.0,
      { min: 0.0, maxExclusive: buffer.duration }
    );
    const duration = opts.duration === undefined
      ? undefined
      : util.readFiniteNumber(opts.duration, "AudioSynth audio buffer duration", { minExclusive: 0.0 });
    const loop = util.readOptionalBoolean(opts.loop, "AudioSynth audio buffer loop", false);
    const pan = util.readOptionalFiniteNumber(opts.pan, "AudioSynth audio buffer pan", 0.0, { min: -1.0, max: 1.0 });

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = loop;
    source.playbackRate.value = playbackRate;
    source.detune.value = detune;

    const gain = this.ctx.createGain();
    gain.gain.value = gainValue;

    let output = gain;
    let panner = null;
    if (this.ctx.createStereoPanner) {
      panner = this.ctx.createStereoPanner();
      panner.pan.value = pan;
      gain.connect(panner);
      output = panner;
    }
    output.connect(bus.node);
    source.connect(gain);

    const voice = {
      name: key,
      bus: bus.name,
      source,
      gain,
      panner,
      startTime: when,
      stopped: false
    };
    voice.stop = (stopWhen = this.ctx.currentTime, stopOptions = {}) => {
      this.stopAudioBuffer(voice, stopWhen, stopOptions);
    };

    source.onended = () => {
      this.activeAudioBufferVoices.delete(voice);
      voice.stopped = true;
      source.disconnect();
      gain.disconnect();
      panner?.disconnect();
    };
    this.activeAudioBufferVoices.add(voice);

    if (duration === undefined) {
      source.start(when, offset);
    } else {
      source.start(when, offset, duration);
    }
    return voice;
  }

  // playAudioBuffer() が返した voice を停止する
  // fadeSec を指定すると GainNode を短く落としてから stop し、クリック音を避けやすくする
  stopAudioBuffer(voice, when = null, options = {}) {
    if (!voice || voice.stopped) return;
    const opts = util.readPlainObject(options, "AudioSynth stopAudioBuffer options", {});
    const stopWhen = when === null
      ? (this.ctx ? this.ctx.currentTime : 0.0)
      : util.readFiniteNumber(when, "AudioSynth stopAudioBuffer when");
    const fadeSec = util.readOptionalFiniteNumber(
      opts.fadeSec,
      "AudioSynth stopAudioBuffer fadeSec",
      0.03,
      { min: 0.0 }
    );
    voice.gain.gain.cancelScheduledValues(stopWhen);
    voice.gain.gain.setValueAtTime(voice.gain.gain.value, stopWhen);
    voice.gain.gain.linearRampToValueAtTime(0.0, stopWhen + fadeSec);
    try {
      voice.source.stop(stopWhen + fadeSec + 0.001);
    } catch (_error) {
      // stop 済み source の重複 stop は無視する
    }
    voice.stopped = true;
  }

  // 現在再生中の AudioBufferSourceNode をまとめて停止する
  // bus を指定すると SE だけ、または BGM 素材だけを止められる
  stopAllAudioBuffers(options = {}) {
    const opts = util.readPlainObject(options, "AudioSynth stopAllAudioBuffers options", {});
    const bus = opts.bus === undefined
      ? null
      : util.readOptionalEnum(opts.bus, "AudioSynth stopAllAudioBuffers bus", "se", ["se", "bgm"]);
    const fadeSec = util.readOptionalFiniteNumber(
      opts.fadeSec,
      "AudioSynth stopAllAudioBuffers fadeSec",
      0.03,
      { min: 0.0 }
    );
    const voices = [...this.activeAudioBufferVoices];
    for (let i = 0; i < voices.length; i++) {
      if (bus !== null && voices[i].bus !== bus) continue;
      this.stopAudioBuffer(voices[i], null, { fadeSec });
    }
  }

  // BGM シーケンサーのテンポを BPM で設定し、8分音符 step の基準時間を更新する
  setBpm(bpm) {
    this.bpm = util.readFiniteNumber(bpm, "AudioSynth BPM", { minExclusive: 0.0 });
    this.beat = 60.0 / this.bpm;
  }

  // BGM の基準周波数を設定する
  // melody の degree / semitone 計算は、この root Hz を出発点にする
  setRootHz(hz) {
    this.root = util.readFiniteNumber(hz, "AudioSynth root Hz", { minExclusive: 0.0 });
  }

  // 登録済み melody 名を返す
  // UI や sample はこの一覧から選択肢を組み立てる
  getMelodyList() {
    return Object.keys(this.melodies);
  }

  // 現在再生に使う melody preset を切り替える
  // 未登録名は自動補完せず、設定ミスとして明確に失敗させる
  setMelody(name) {
    if (!this.melodies[name]) {
      throw new Error(`Unknown melody: ${name}`);
    }
    this.melodyName = name;
    this.melody = this.melodies[name];
  }

  // 外側から任意メロディを追加
  // 必須の完全バリデーションは行わず、不足項目は再生時にデフォルトで補完
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

  // BGM 再生を開始し、短い interval で先読みスケジューリングを回す
  // WebAudio の時刻へ直接予約するため、画面更新の揺れに影響されにくい
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

  // BGM 再生を停止し、BGM bus を短くフェードアウトさせる
  // すでに予約済みの oscillator は自然に終わり、以後の step 予約だけを止める
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

  // 現在時刻から lookAheadSec 先までの BGM step を予約する
  // setInterval はこの関数を繰り返し呼び、予約済み時間を少しずつ先へ進める
  scheduleBgm(lookAheadSec) {
    if (!this.playingBgm) return;
    while (this.nextBeatTime < this.ctx.currentTime + lookAheadSec) {
      this.scheduleBgmStep(this.bgmStep, this.nextBeatTime);
      this.nextBeatTime += this.beat * 0.5;
      this.bgmStep = (this.bgmStep + 1) % 16;
    }
  }

  // 16 step ループの 1 step を解釈し、bass と lead の voice を必要に応じて予約する
  // melody preset は度数で記述され、ここで Hz と発音時間に変換される
  scheduleBgmStep(step, when) {
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

  // melody preset の step 配列から現在 step に対応する数値を読む
  // 配列欠落や NaN は BGM 設定ミスとして例外にし、静かな補正は行わない
  getStepParam(arr, step, _unusedFallback) {
    if (!Array.isArray(arr) || arr.length === 0) {
      throw new Error("Melody step parameter array is required");
    }
    const v = arr[step % arr.length];
    if (v === null || v === undefined || Number.isNaN(Number(v))) {
      throw new Error(`Melody step parameter at ${step} must be numeric`);
    }
    return Number(v);
  }

  // rhythm part を鳴らすかどうかを step と melody 設定から判定する
  // 強拍は残し、弱拍や小節末だけを確率で抜いて反復感を弱める
  shouldPlayRhythm(step, melody) {
    if ((step % 4) === 0) return true;
    const isTail = (step % 8) === 7;
    const weak = melody?.rhythmDropWeakProb;
    const tail = melody?.rhythmDropTailProb;
    const p = isTail ? tail : weak;
    return this.rhythmRandom.random() > p;
  }

  // scale の度数を半音数へ変換する
  // 負の degree も wrap して、bass pattern の下方向移動を自然に扱う
  degreeToSemitone(scale, degree) {
    const n = scale.length;
    const wrapped = ((degree % n) + n) % n;
    const octave = (degree - wrapped) / n;
    return scale[wrapped] + octave * 12;
  }

  // 一定小節ごとに確率で転調し、BGM の反復感を弱める
  // 常に転調すると落ち着かないため、modulateProbability で発生頻度を制御する
  maybeModulate() {
    if (this.bgmBar <= 0) return;
    if ((this.bgmBar % this.modulateEveryBars) !== 0) return;
    if (this.modulationRandom.random() > this.modulateProbability) return;

    this.modulationIndex = (this.modulationIndex + 1) % this.modulationCycle.length;
    this.bgmTransposeSemitone = this.modulationCycle[this.modulationIndex];
  }

  // BGM 用の 1 voice を生成し、BGM envelope で音量変化を予約する
  // SE と違い、ここでは pan や個別 stop は持たせず、短い予約音として使う
  playBgmVoice(freq, when, dur, type, gain) {
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;

    const amp = this.ctx.createGain();
    amp.gain.value = 0.0;
    amp.connect(this.bgmBus);
    osc.connect(amp);

    const attack = this.bgmEnvelope.attack ?? 0.02;
    const decay = this.bgmEnvelope.decay ?? 0.06;
    const sustain = this.bgmEnvelope.sustain ?? 0.65;
    const release = this.bgmEnvelope.release ?? 0.06;
    const peak = when + attack;
    const sustainStart = when + dur;
    const decayEnd = Math.min(peak + decay, sustainStart);
    amp.gain.setValueAtTime(0.0, when);
    amp.gain.linearRampToValueAtTime(gain, peak);
    amp.gain.linearRampToValueAtTime(gain * sustain, decayEnd);
    amp.gain.setValueAtTime(gain * sustain, sustainStart);
    amp.gain.linearRampToValueAtTime(0.0, sustainStart + release);

    osc.start(when);
    osc.stop(sustainStart + release + 0.01);
  }

  // BGM voice に使う envelope を部分更新する
  // attack / decay / sustain / release のうち、渡された項目だけを現在値へ重ねる
  setBgmEnvelope(config) {
    if (!config || typeof config !== "object") {
      throw new Error("BGM envelope config must be an object.");
    }
    this.bgmEnvelope = { ...this.bgmEnvelope, ...config };
  }

  // 現在の BGM envelope をコピーして返す
  // 呼び出し側の編集で内部状態が直接変化しないようにする
  getBgmEnvelope() {
    return { ...this.bgmEnvelope };
  }
}
