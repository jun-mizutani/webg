// ---------------------------------------------
//  GameAudioSynth.js   2026/10/02
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import AudioSynth from "./AudioSynth.js";
import util from "./util.js";
import { GAME_MUSIC_PRESETS } from "./GameMusicPresets.js";
import { GAME_SOUND_PRESETS } from "./GameSoundPresets.js";

// 1小節8ステップ。打音は旋律と同じ時計で予約し、swingにも追従する。
const SCORE_DRUM_PATTERNS = {
  basic: {kick:[0,4], snare:[2,6], hat:[0,2,4,6]},
  walk: {kick:[0,4], snare:[2,6], hat:[0,1,2,3,4,5,6,7]},
  bossa: {kick:[0,3,4], snare:[2,6], hat:[0,2,4,6,7]},
  ballad: {kick:[0], snare:[6], hat:[2,6]},
  funk: {kick:[0,3,4], snare:[2,6], hat:[0,1,2,3,4,5,6,7]},
  run: {kick:[0,2,4,6], snare:[2,6], hat:[0,1,2,3,4,5,6,7]}
};

export default class GameAudioSynth extends AudioSynth {

  // インスタンス生成時に、受け取った設定を検証して初期状態を準備する
  constructor(options = {}) {
    super(options);

    // 演奏位置、予約済み音、再開時の音量を初期化してから曲を登録する
    this.songStep = 0;
    this.scoreVoices = new Set();
    this.scoreDrumNoise = null;
    this.scoreDrumRandom = this.createRandomGenerator(0x6472756d);
    this.gameSeNoise = null;
    this.gameSeRandom = this.createRandomGenerator(0x73656e6f);
    this.requestedBgmVolume = .75;
    this.bgmMelodyVolume = 1;
    this.bgmRhythmVolume = 1;
    this.installMelodyPresets();
    this.installSePresets();

    // 既定メロディ
    this.setMelody("jazz_cafe");

    // BGM は少し長めの余韻を持つ既定値にする
    this.setBgmEnvelope({ attack: 0.03, decay: 0.2, sustain: 0.6, release: 0.4 });
  }

  // GameAudioSynth向けの発音ヘルパー
  // profile でエンベロープ形を選び、optionsで上書き可能
  playGameTone(freq, dur = 0.12, profile = "piano", options = {}) {
    this.playTone(freq, dur, { profile, ...options });
  }


  // 譜面をインスタンスへ登録する。公開一覧は24曲、表示ラベルは英語で統一する
  installMelodyPresets() {
    for (const [name, song] of Object.entries(GAME_MUSIC_PRESETS)) {
      this.registerMelody(name, { ...song, format: "score" });
    }
  }

  // 8小節の譜面は登録時に検証・複製し、後から元配列を編集しても演奏を変えない
  // AudioSynthの度数形式をアプリが追加する場合は、親の登録処理で扱う
  registerMelody(name, config) {
    if (config?.format !== "score") return super.registerMelody(name, config);
    const key = util.readOptionalString(name, "GameAudioSynth melody name", undefined,
      { allowEmpty: false, trim: true });
    if (key === undefined) throw new Error("GameAudioSynth melody name is required");
    const label = util.readOptionalString(config.label, key + ".label", undefined, {allowEmpty:false});
    if (label === undefined) throw new Error(key + ": label is required");
    const bpm = util.readFiniteNumber(config.bpm, key + ".bpm", {min:70,max:200});
    const swing = util.readFiniteNumber(config.swing, key + ".swing", {min:.5,max:.67});
    const leadGain = util.readOptionalFiniteNumber(config.leadGain, key + ".leadGain",
      config.type === "square" ? .032 : .058, {min:0,max:.2});
    const leadGate = util.readOptionalFiniteNumber(config.leadGate, key + ".leadGate", .82,
      {min:.1,max:1});
    const groove = util.readOptionalEnum(config.groove, key + ".groove", undefined,
      ["basic", "walk", "bossa", "ballad", "funk", "run"]);
    const type = util.readOptionalEnum(config.type, key + ".type", undefined,
      ["sine", "triangle", "square", "sawtooth"]);
    if (groove === undefined || type === undefined) throw new Error(key + ": groove and type are required");
    if (!Array.isArray(config.chords) || config.chords.length !== 8
      || !Array.isArray(config.lead) || config.lead.length !== 8) {
      throw new Error(key + ": chords and lead must each contain 8 bars");
    }
    const chords = config.chords.map((chord, bar) => {
      if (!Array.isArray(chord) || chord.length < 3 || chord.length > 5) {
        throw new Error(key + ": each chord requires 3 to 5 notes");
      }
      return chord.map((note, index) => util.readFiniteNumber(note,
        key + ".chords[" + bar + "][" + index + "]", {integer:true,min:13,max:115}));
    });
    const lead = config.lead.map((notes, bar) => {
      if (!Array.isArray(notes) || notes.length !== 8) throw new Error(key + ": expected 8 steps per bar");
      return notes.map((note, index) => note === null ? null : util.readFiniteNumber(note,
        key + ".lead[" + bar + "][" + index + "]", {integer:true,min:-1,max:127}));
    });
    this.melodies[key] = {format:"score",label,bpm,swing,groove,type,chords,lead,leadGain,leadGate};
    if (this.melodyName === null || this.melodyName === key) {
      this.melodyName = key;
      this.melody = this.melodies[key];
    }
  }

  // 選択済みかどうかに関係なく登録曲の英語ラベルを返す。未知名は例外にする
  getMelodyLabel(name) {
    if (!Object.hasOwn(this.melodies, name)) throw new Error("Unknown melody: " + name);
    const song = this.melodies[name];
    return song.format === "score" ? song.label : name;
  }

  // 切替時は新曲の冒頭とテンポをそろえる
  setMelody(name) {
    super.setMelody(name);
    this.songStep = 0;
    this.stopScoreVoices();
    this.bgmStep = 0;
    this.bgmBar = 0;
    this.bgmTransposeSemitone = 0;
    this.modulationIndex = 0;
    if (this.melody.format === "score") this.setBpm(this.melody.bpm);
    if (this.playingBgm) this.nextBeatTime = this.ctx.currentTime + .05;
  }

  // 再開始時に8小節の先頭へ戻す。音量は画面で指定した値を保持する
  startBgm() {
    if (this.playingBgm) return;
    this.ensureContext();
    this.stopScoreVoices();
    this.songStep = 0;
    this.playingBgm = true;
    this.bgmStep = 0;
    this.bgmBar = 0;
    this.bgmTransposeSemitone = 0;
    this.modulationIndex = 0;
    this.nextBeatTime = this.ctx.currentTime + .05;
    this.bgmBus.gain.cancelScheduledValues(this.ctx.currentTime);
    this.bgmBus.gain.setTargetAtTime(this.requestedBgmVolume, this.ctx.currentTime, .02);
    this.bgmTimer = window.setInterval(() => this.scheduleBgm(this.lookAheadSec), this.tickMs);
  }

  // BGM停止時のフェードとは別に、利用者の指定音量を覚えて再開へ渡す
  setBgmVolume(value) {
    super.setBgmVolume(value);
    this.requestedBgmVolume = util.readFiniteNumber(value, "GameAudioSynth BGM volume", {min:0});
  }

  // 譜面形式のパート倍率。曲切替後も保持し、次に予約する音から反映する。
  setBgmMelodyVolume(value) {
    this.bgmMelodyVolume = util.readFiniteNumber(value, "GameAudioSynth melody volume", {min:0,max:2});
  }

  setBgmRhythmVolume(value) {
    this.bgmRhythmVolume = util.readFiniteNumber(value, "GameAudioSynth rhythm volume", {min:0,max:2});
  }

  // 内蔵譜面は64ステップで循環し、アプリが登録した度数形式は親の演奏処理を使う
  scheduleBgm(lookAheadSec) {
    if (this.melody.format !== "score") return super.scheduleBgm(lookAheadSec);
    if (!this.playingBgm) return;
    while (this.nextBeatTime < this.ctx.currentTime + lookAheadSec) {
      this.scheduleScoreStep(this.songStep, this.nextBeatTime);
      // 2個の8分音符の合計は常に1拍。BPMを維持したまま後半の発音を遅らせる
      const swing = this.melody.swing;
      this.nextBeatTime += this.beat * (this.songStep % 2 === 0 ? swing : 1 - swing);
      this.songStep = (this.songStep + 1) % 64;
    }
  }

  // 旋律、拍を支えるベース、和音、打楽器を同じ小節位置から予約する
  scheduleScoreStep(step, when) {
    const song = this.melody;
    const bar = Math.floor(step / 8), eighth = step % 8;
    this.bgmBar = bar + 1;
    const notes = song.lead[bar];
    this.scheduleAccompaniment(song, bar, eighth, when);
    this.scheduleScoreDrums(song, eighth, when);
    if (notes[eighth] !== null && notes[eighth] !== -1
      && this.bgmMelodyVolume > 0 && song.leadGain > 0) {
      // nullは持続、-1は休符。次の発音・休符・小節末で音価を区切る。
      let length = 1;
      while (eighth + length < 8 && notes[eighth + length] === null) length++;
      // Swing時の長短を音価にも反映し、次の発音位置との間隔をそろえる
      let beats = 0;
      for (let i = 0; i < length; i++) beats += (eighth + i) % 2 === 0 ? song.swing : 1 - song.swing;
      const interval = this.beat * beats;
      // 曲ごとの歯切れをgateで作り、余韻も次の発音／休符までに収める。
      this.playScoreVoice(notes[eighth], when, interval * song.leadGate, song.type,
        song.leadGain * this.bgmMelodyVolume, true, interval * (1 - song.leadGate));
    }
  }

  // 曲調ごとにベースと和音の発音位置を選ぶ。Jazzは根音を低音へ分離する
  scheduleAccompaniment(song, bar, eighth, when) {
    if (this.bgmRhythmVolume === 0) return;
    const chord = song.chords[bar], unit = this.beat * .5;
    const patterns = {
      basic: {bass:[0,4], comp:[2,6]},
      walk: {bass:[0,2,4,6], comp:[1,4,7]},
      bossa: {bass:[0,3,4,7], comp:[0,3,6]},
      ballad: {bass:[0,4], comp:[0,5]},
      funk: {bass:[0,3,4,6], comp:[1,3,6]},
      run: {bass:[0,2,4,6], comp:[1,3,5,7]}
    };
    const pattern = patterns[song.groove];
    if (pattern.bass.includes(eighth)) {
      let note = chord[0] - 12;
      if (song.groove === "walk") {
        // 4拍目は次の和音の根音の半音下から近づき、8小節の循環をつなぐ
        const walk = [chord[0]-12, chord[1]-12, chord[2]-12,
          song.chords[(bar+1)%8][0]-13];
        note = walk[eighth / 2];
      } else if (song.groove !== "basic" && eighth >= 4) {
        note = chord[0] - 5;
      }
      this.playScoreVoice(note, when, unit * (song.groove === "run" ? 1.2 : 1.7),
        "triangle", (eighth === 0 ? .082 : .067) * this.bgmRhythmVolume);
    }
    if (pattern.comp.includes(eighth)) {
      const voiced = song.groove === "basic" || song.groove === "run" ? chord : chord.slice(1);
      for (const note of voiced) this.playScoreVoice(note + 12, when,
        unit * (song.groove === "ballad" ? 3 : .9), "sine", .019 * this.bgmRhythmVolume);
    }
  }

  // UIのADSR比率を音価内へ収め、短い音でも予約時刻を必ず昇順にする
  // 持続音が次の音を覆いすぎないよう、Releaseは音価と同じ長さまでとする
  playScoreVoice(note, when, duration, type, gain, softenLead = false, releaseLimit = duration) {
    const osc = this.ctx.createOscillator(), amp = this.ctx.createGain();
    const env = this.getBgmEnvelope();
    for (const key of ["attack", "decay", "release"]) {
      util.readFiniteNumber(env[key], "GameAudioSynth envelope." + key, {min:0});
    }
    util.readFiniteNumber(env.sustain, "GameAudioSynth envelope.sustain", {min:0,max:1});
    const scale = duration / Math.max(duration, env.attack + env.decay);
    const noteEnd = when + duration;
    const peak = Math.min(noteEnd, when + env.attack * scale);
    const decayEnd = Math.min(noteEnd, peak + env.decay * scale);
    const end = when + duration + Math.min(env.release, duration, releaseLimit);
    osc.type = type;
    // rootの既定220 Hzを基準にし、旋律・低音・和音を同じ比率で移調する
    osc.frequency.value = this.root * 2 ** ((note - 57) / 12);
    let tone = null;
    if (softenLead) {
      // 高い旋律ほど音量を下げ、矩形波などの強い倍音を丸める。
      // 譜面の音高は保ち、rootによる移調後の実周波数で補正する。
      const frequency = osc.frequency.value;
      gain *= Math.min(1, (880 / frequency) ** .45);
      tone = this.ctx.createBiquadFilter();
      tone.type = "lowpass";
      tone.frequency.value = Math.min(3000, Math.max(1400, frequency * 1.8));
      tone.Q.value = .5;
      osc.connect(tone);
      tone.connect(amp);
    } else {
      osc.connect(amp);
    }
    amp.connect(this.bgmBus);
    amp.gain.setValueAtTime(0, when);
    amp.gain.linearRampToValueAtTime(gain, peak);
    amp.gain.linearRampToValueAtTime(gain * env.sustain, decayEnd);
    amp.gain.setValueAtTime(gain * env.sustain, when + duration);
    amp.gain.linearRampToValueAtTime(0, end);
    this.scoreVoices.add(osc);
    osc.onended = () => {
      osc.disconnect(); tone?.disconnect(); amp.disconnect(); this.scoreVoices.delete(osc);
    };
    osc.start(when);
    osc.stop(end + .01);
  }

  // ゆっくりした曲とJazzは薄く、funk/runは明確な拍を付ける。
  scheduleScoreDrums(song, eighth, when) {
    if (this.bgmRhythmVolume === 0) return;
    const pattern = SCORE_DRUM_PATTERNS[song.groove];
    const styleLevel = song.groove === "ballad" ? .55
      : song.groove === "basic" && song.type === "sine" ? .5
      : song.groove === "walk" || song.groove === "bossa" ? .8 : 1;
    const level = styleLevel * this.bgmRhythmVolume;
    if (pattern.kick.includes(eighth)) this.playScoreDrum("kick", when, .12 * level);
    if (pattern.snare.includes(eighth)) this.playScoreDrum("snare", when, .075 * level);
    if (pattern.hat.includes(eighth)) {
      this.playScoreDrum("hat", when, (eighth % 2 === 0 ? .026 : .017) * level);
    }
  }

  // 外部音源を使わず、下降する正弦波と帯域を絞ったノイズで短い打音を作る。
  // 打音の包絡はBGMのADSRから独立させ、長いReleaseでも拍を濁らせない。
  playScoreDrum(kind, when, gain) {
    if (gain === 0) return;
    const duration = kind === "kick" ? .18 : kind === "snare" ? .11 : .045;
    const amp = this.ctx.createGain();
    let source, tone = null;
    if (kind === "kick") {
      source = this.ctx.createOscillator();
      source.type = "sine";
      source.frequency.setValueAtTime(135, when);
      source.frequency.exponentialRampToValueAtTime(48, when + .12);
      source.connect(amp);
    } else {
      if (!this.scoreDrumNoise || this.scoreDrumNoise.sampleRate !== this.ctx.sampleRate) {
        this.scoreDrumNoise = this.ctx.createBuffer(1, Math.ceil(this.ctx.sampleRate * .2),
          this.ctx.sampleRate);
        const data = this.scoreDrumNoise.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = this.scoreDrumRandom.random() * 2 - 1;
      }
      source = this.ctx.createBufferSource();
      source.buffer = this.scoreDrumNoise;
      tone = this.ctx.createBiquadFilter();
      tone.type = "bandpass";
      tone.frequency.value = kind === "snare" ? 1800 : 4200;
      tone.Q.value = kind === "snare" ? .7 : 1;
      source.connect(tone);
      tone.connect(amp);
    }
    amp.connect(this.bgmBus);
    amp.gain.setValueAtTime(0, when);
    amp.gain.linearRampToValueAtTime(gain, when + .003);
    amp.gain.exponentialRampToValueAtTime(.0001, when + duration);
    amp.gain.linearRampToValueAtTime(0, when + duration + .005);
    this.scoreVoices.add(source);
    source.onended = () => {
      source.disconnect(); tone?.disconnect(); amp.disconnect(); this.scoreVoices.delete(source);
    };
    source.start(when);
    source.stop(when + duration + .01);
  }

  // 曲切替時に新曲の予約済み音も停止し、前の曲の音符を持ち越さない
  stopScoreVoices() {
    for (const osc of this.scoreVoices) osc.stop();
    this.scoreVoices.clear();
  }

  // プリセットの音と、UIが示す包絡一覧を同じ層データから作る。
  installSePresets() {
    this.gameSe = {};
    this.soundEffectCatalog = {};
    for (const [name, preset] of Object.entries(GAME_SOUND_PRESETS)) {
      this.gameSe[name] = (when) => {
        for (const layer of preset.layers) this.playGameSoundLayer(layer, when + layer.at);
      };
      this.soundEffectCatalog[name] = {
        label: name,
        profiles: [...new Set(preset.layers.map(layer => layer.profile))],
        primaryProfile: preset.primaryProfile
      };
    }
  }

  // 音高変化とフィルター付きノイズをSEバスへ送る。BGMのノイズとは乱数を分ける。
  // ToneSynthと同じvoice形式で管理し、stopAllTones()で予約中の層も停止できる。
  playGameSoundLayer(layer, when) {
    this.ensureContext();
    const duration = util.readFiniteNumber(layer.duration, "GameAudioSynth SE duration", {minExclusive:0});
    const gain = util.readFiniteNumber(layer.gain, "GameAudioSynth SE gain", {min:0});
    if (gain === 0) return;
    const env = this.getSeEnvelopePreset(layer.profile);
    const scale = duration / Math.max(duration, env.attack + env.decay);
    const noteEnd = when + duration;
    const attackEnd = Math.min(noteEnd, when + env.attack * scale);
    const decayEnd = Math.min(noteEnd, attackEnd + env.decay * scale);
    const end = noteEnd + env.release;
    const amp = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();
    filter.type = layer.noise ? (layer.noiseType ?? "bandpass") : "lowpass";
    filter.Q.value = layer.q ?? .6;
    const cutoff = Math.min(layer.filterHz ?? 2800, this.ctx.sampleRate * .45);
    filter.frequency.setValueAtTime(cutoff, when);
    if (layer.filterEndHz !== undefined) {
      filter.frequency.exponentialRampToValueAtTime(
        Math.min(layer.filterEndHz, this.ctx.sampleRate * .45), noteEnd);
    }

    let source;
    if (layer.noise) {
      if (!this.gameSeNoise || this.gameSeNoise.sampleRate !== this.ctx.sampleRate) {
        this.gameSeNoise = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
        const data = this.gameSeNoise.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = this.gameSeRandom.random() * 2 - 1;
      }
      source = this.ctx.createBufferSource();
      source.buffer = this.gameSeNoise;
      source.loop = true;
    } else {
      source = this.ctx.createOscillator();
      source.type = layer.type ?? "sine";
      source.frequency.setValueAtTime(layer.frequency, when);
      if (layer.endHz !== undefined) {
        source.frequency.exponentialRampToValueAtTime(layer.endHz, noteEnd);
      }
    }
    source.connect(filter);
    filter.connect(amp);
    let panner = null;
    if (this.ctx.createStereoPanner) {
      panner = this.ctx.createStereoPanner();
      panner.pan.value = layer.pan ?? 0;
      amp.connect(panner);
      panner.connect(this.seBus);
    } else {
      amp.connect(this.seBus);
    }
    const sustainGain = gain * env.sustain;
    amp.gain.setValueAtTime(0, when);
    amp.gain.linearRampToValueAtTime(gain, attackEnd);
    amp.gain.linearRampToValueAtTime(sustainGain, decayEnd);
    amp.gain.setValueAtTime(sustainGain, noteEnd);
    amp.gain.linearRampToValueAtTime(0, end);
    const voice = {osc:source, amp, startTime:when, releaseSec:env.release,
      sustainGain, stopped:false, stopTime:end};
    voice.stop = (stopWhen = this.ctx.currentTime, options = {}) => this.stopTone(voice, stopWhen, options);
    this.activeVoices.add(voice);
    source.onended = () => {
      this.activeVoices.delete(voice);
      voice.stopped = true;
      source.disconnect(); filter.disconnect(); amp.disconnect(); panner?.disconnect();
    };
    source.start(when);
    source.stop(end + .001);
    return voice;
  }

  // 登録済みの効果音名を返し、UIの選択肢やデバッグ一覧へ渡します
  getSoundEffectList() {
    return Object.keys(this.soundEffectCatalog ?? {});
  }

  // 音の`effect`の`info`を現在の入力と状態から求め、呼び出し元へ返す
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
      primaryProfile: info.primaryProfile ?? info.profiles?.[0] ?? "piano",
      durationSec: Math.max(...GAME_SOUND_PRESETS[name].layers.map(layer =>
        layer.at + layer.duration + this.getSeEnvelopePreset(layer.profile).release))
    };
  }

  // 登録済みのゲーム効果音名を返し、作品側の操作UIへ渡します
  getGameSeList() {
    return Object.keys(this.gameSe ?? {});
  }

  // `playSe`は選択中の音声またはアニメーションの再生状態を更新する
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
