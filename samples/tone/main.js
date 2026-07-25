// ---------------------------------------------
// samples/tone/main.js  2026/07/25
//   ToneSynth sample
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import ToneSynth from "../../webg/ToneSynth.js";

const $ = (id) => document.getElementById(id);

// root note は周波数を直接 UI に出さず、音名から選べるようにする
// 3和音ではこの周波数を基準に半音比率で 3rd / 5th を作る
const ROOT_NOTES = [
  { label: "C3", frequency: 130.81 },
  { label: "G3", frequency: 196.00 },
  { label: "C4", frequency: 261.63 },
  { label: "E4", frequency: 329.63 },
  { label: "G4", frequency: 392.00 },
  { label: "C5", frequency: 523.25 }
];

// OscillatorNode が受け付ける標準波形だけを並べる
// 波形による倍音差を envelope / reverb と切り分けて確認するための選択肢
const WAVE_TYPES = ["sine", "triangle", "square", "sawtooth"];

let ui = null;
const synth = new ToneSynth();
let audioStarted = false;
let selectedEnvelopeProfile = "piano";
let heldVoices = [];
let heldMode = null;

// UI 要素参照を一箇所にまとめ、以後の処理で DOM 検索を繰り返さないようにする
const getUiRefs = () => ({
  status: $("status"),
  btnInit: $("btnInit"),
  btnPlaySingle: $("btnPlaySingle"),
  btnPlayTriad: $("btnPlayTriad"),
  btnStop: $("btnStop"),
  btnDry: $("btnDry"),
  btnRoom: $("btnRoom"),
  btnHall: $("btnHall"),
  btnPlate: $("btnPlate"),
  masterVol: $("masterVol"),
  toneVol: $("toneVol"),
  rootNote: $("rootNote"),
  waveType: $("waveType"),
  playMode: $("playMode"),
  gain: $("gain"),
  envelopeProfile: $("envelopeProfile"),
  attack: $("attack"),
  decay: $("decay"),
  sustain: $("sustain"),
  release: $("release"),
  reverbMix: $("reverbMix"),
  reverbKind: $("reverbKind"),
  reverbLength: $("reverbLength"),
  reverbDecay: $("reverbDecay"),
  masterVal: $("masterVal"),
  toneVolVal: $("toneVolVal"),
  rootVal: $("rootVal"),
  waveVal: $("waveVal"),
  modeVal: $("modeVal"),
  gainVal: $("gainVal"),
  profileVal: $("profileVal"),
  attackVal: $("attackVal"),
  decayVal: $("decayVal"),
  sustainVal: $("sustainVal"),
  releaseVal: $("releaseVal"),
  reverbMixVal: $("reverbMixVal"),
  reverbKindVal: $("reverbKindVal"),
  reverbLengthVal: $("reverbLengthVal"),
  reverbDecayVal: $("reverbDecayVal")
});

// ステータス欄は現在の操作結果や検証エラーを表示する
// 音が鳴らないときに「Audio Start 前なのか、設定エラーなのか」を区別しやすくする
const setStatus = (text) => {
  ui.status.textContent = `status: ${text}`;
};

// 秒数表示を小数 3 桁にそろえ、attack / decay / release の差を読みやすくする
const formatSeconds = (value) => `${Number(value).toFixed(3)} sec`;

// reverb length は細かすぎる桁を見せないことで、空間サイズの比較に集中しやすくする
const formatReverbSeconds = (value) => `${Number(value).toFixed(2)} sec`;

// 比率や gain は小数 2 桁にそろえ、slider の値と表示の対応を単純にする
const formatRatio = (value) => `${Number(value).toFixed(2)}`;

// UI から取得した数値を明示的に検証する
// 不正な値を補正して進めると sample の状態が分かりにくくなるため、その場で例外にする
const readUiNumber = (element, label) => {
  const value = Number(element.value);
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be finite`);
  }
  return value;
};

// select 要素へ選択肢を流し込む
// value と label を分けられるようにして、root note では周波数を value として保持する
const populateSelect = (select, entries) => {
  select.replaceChildren();
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const opt = document.createElement("option");
    opt.value = String(entry.value);
    opt.textContent = entry.label;
    select.appendChild(opt);
  }
};

// AudioContext 開始前は再生・停止・reverb比較ボタンを無効にする
// ブラウザの自動再生制限に従い、ユーザー操作後だけ発音できる状態にする
const setPlayControlsEnabled = (enabled) => {
  ui.btnPlaySingle.disabled = !enabled;
  ui.btnPlayTriad.disabled = !enabled;
  ui.btnStop.disabled = !enabled;
  ui.btnDry.disabled = !enabled;
  ui.btnRoom.disabled = !enabled;
  ui.btnHall.disabled = !enabled;
  ui.btnPlate.disabled = !enabled;
};

// 現在選択中の envelope preset を slider へ反映する
// profile を切り替えた直後に、どの ADSR 値を聞いているかを画面上で確認できるようにする
const applyEnvelopeProfileToUi = (profileName) => {
  const env = synth.getSeEnvelopePreset(profileName);
  ui.attack.value = String(env.attack);
  ui.decay.value = String(env.decay);
  ui.sustain.value = String(env.sustain);
  ui.release.value = String(env.release);
  ui.attackVal.textContent = formatSeconds(env.attack);
  ui.decayVal.textContent = formatSeconds(env.decay);
  ui.sustainVal.textContent = formatRatio(env.sustain);
  ui.releaseVal.textContent = formatSeconds(env.release);
  ui.profileVal.textContent = profileName;
};

// slider で変更した ADSR の一部を、現在の profile に書き戻す
// ToneSynth の API は preset 全体を置き換えるため、現値を読んでから部分更新を合成する
const updateSelectedEnvelope = (partial) => {
  const current = synth.getSeEnvelopePreset(selectedEnvelopeProfile);
  synth.setSeEnvelopePreset(selectedEnvelopeProfile, {
    ...current,
    ...partial
  });
};

// 現在の ADSR slider 値をまとめて選択中 profile へ反映する
// Audio Start 前に slider を動かした場合でも、最初の再生時に見た目どおりの envelope になる
const applyEnvelopeFromUi = () => {
  updateSelectedEnvelope({
    attack: readUiNumber(ui.attack, "envelope attack"),
    decay: readUiNumber(ui.decay, "envelope decay"),
    sustain: readUiNumber(ui.sustain, "envelope sustain"),
    release: readUiNumber(ui.release, "envelope release")
  });
};

// reverb slider と kind select の状態を ToneSynth に適用する
// mix は send と returnGain の両方に使い、1 つの slider で残響量を比較できるようにする
const applyReverbFromUi = () => {
  const mix = readUiNumber(ui.reverbMix, "reverb mix");
  const length = readUiNumber(ui.reverbLength, "reverb length");
  const decay = readUiNumber(ui.reverbDecay, "reverb decay");
  const kind = ui.reverbKind.value;
  synth.setSeReverb(mix * 0.65, mix);
  synth.setSeReverbImpulse({ kind, durationSec: length, decay });
  ui.reverbMixVal.textContent = formatRatio(mix);
  ui.reverbKindVal.textContent = kind;
  ui.reverbLengthVal.textContent = formatReverbSeconds(length);
  ui.reverbDecayVal.textContent = formatRatio(decay);
};

// 音量 slider を ToneSynth に適用する
// AudioContext を作る API なので、Audio Start 後にだけ呼び出す
const applyVolumeFromUi = () => {
  const master = readUiNumber(ui.masterVol, "master volume");
  const tone = readUiNumber(ui.toneVol, "tone volume");
  synth.setMasterVolume(master);
  synth.setSeVolume(tone);
  ui.masterVal.textContent = formatRatio(master);
  ui.toneVolVal.textContent = formatRatio(tone);
};

// mode から鳴らす半音間隔を決める
// single は root のみ、major / minor は root, 3rd, 5th の3音を同時に鳴らす
const getIntervalsForMode = (mode) => {
  if (mode === "single") return [0];
  if (mode === "major") return [0, 4, 7];
  if (mode === "minor") return [0, 3, 7];
  throw new Error(`Unknown tone play mode: ${mode}`);
};

// root 周波数と半音間隔から実際に発音する周波数配列を作る
// 平均律の 12 乗根で計算し、3和音の各音を同じ ToneSynth.playTone() へ渡す
const buildFrequencies = (rootFrequency, intervals) => {
  const frequencies = [];
  for (let i = 0; i < intervals.length; i++) {
    frequencies.push(rootFrequency * Math.pow(2, intervals[i] / 12));
  }
  return frequencies;
};

// 現在押し続けている voice 群を release へ移行させる
// ToneSynth.playTone(..., null, ...) で sustain した音は、この関数で明示的に止める
const stopHeldToneSet = () => {
  if (heldVoices.length === 0) return;
  const voices = heldVoices;
  const mode = heldMode;
  heldVoices = [];
  heldMode = null;
  for (let i = 0; i < voices.length; i++) {
    voices[i].stop();
  }
  setStatus(`${mode ?? "tone"} released`);
};

// 現在の UI 設定で単音または3和音を鳴らし、押下中は sustain させる
// 3和音では各 voice の pan を少し分け、同時発音していることを聞き取りやすくする
const startHeldToneSet = (forcedMode = null) => {
  if (!audioStarted) {
    throw new Error("Audio Start is required before playback");
  }
  stopHeldToneSet();
  applyEnvelopeFromUi();
  applyVolumeFromUi();
  applyReverbFromUi();

  const rootFrequency = readUiNumber(ui.rootNote, "root frequency");
  const mode = forcedMode ?? ui.playMode.value;
  const intervals = getIntervalsForMode(mode);
  const frequencies = buildFrequencies(rootFrequency, intervals);
  const gain = readUiNumber(ui.gain, "tone gain");
  const type = ui.waveType.value;
  const panValues = frequencies.length === 1 ? [0] : [-0.20, 0.0, 0.20];
  const voiceGain = gain / Math.sqrt(frequencies.length);
  heldMode = mode;

  for (let i = 0; i < frequencies.length; i++) {
    const voice = synth.playTone(frequencies[i], null, {
      type,
      profile: selectedEnvelopeProfile,
      gain: voiceGain,
      pan: panValues[i]
    });
    heldVoices.push(voice);
  }

  setStatus(`${mode}: holding ${type}, ${selectedEnvelopeProfile}, ${frequencies.length} voice(s)`);
};

// range input と表示ラベルを同期し、必要なら AudioContext へ即時反映する
// Audio Start 前は表示だけ更新し、Context の早期生成を避ける
const bindRange = (slider, valueLabel, formatter, onInput = null) => {
  const apply = () => {
    const value = readUiNumber(slider, slider.id);
    valueLabel.textContent = formatter(value);
    if (audioStarted && onInput) {
      onInput(value);
    }
  };
  slider.addEventListener("input", () => {
    try {
      apply();
    } catch (err) {
      setStatus(`input error (${err.message})`);
      console.error(err);
    }
  });
  apply();
};

// button を押している間だけ発音し、pointerup / pointercancel で release へ移る
// click ではなく pointer を使うことで、mouse と touch のどちらでも同じ処理フローにする
const bindHoldButton = (button, modeFactory) => {
  button.addEventListener("pointerdown", (event) => {
    if (button.disabled) return;
    event.preventDefault();
    button.setPointerCapture?.(event.pointerId);
    try {
      startHeldToneSet(modeFactory());
    } catch (err) {
      setStatus(`play error (${err.message})`);
      console.error(err);
    }
  });
  // このインスタンスが保持する資源と参照を安全に解放する
  const release = (event) => {
    if (button.hasPointerCapture?.(event.pointerId)) {
      button.releasePointerCapture(event.pointerId);
    }
    stopHeldToneSet();
  };
  button.addEventListener("pointerup", release);
  button.addEventListener("pointercancel", release);
};

// reverb の比較ボタンから kind / mix / length をまとめて設定する
// Dry は mix だけ 0 にし、kind は残したまま残響量の差を聞けるようにする
const setReverbPreset = (kind, mix, length, decay) => {
  ui.reverbKind.value = kind;
  ui.reverbMix.value = String(mix);
  ui.reverbLength.value = String(length);
  ui.reverbDecay.value = String(decay);
  applyReverbFromUi();
  setStatus(`reverb=${kind}, mix=${formatRatio(mix)}`);
};

// select 変更時に、表示ラベルと発音に使う内部状態を更新する
// profile は ADSR slider も同時に切り替えて、聞こえ方と数値を対応させる
const bindSelectEvents = () => {
  ui.rootNote.addEventListener("change", () => {
    ui.rootVal.textContent = ui.rootNote.selectedOptions[0].textContent;
    setStatus(`root=${ui.rootVal.textContent}`);
  });
  ui.waveType.addEventListener("change", () => {
    ui.waveVal.textContent = ui.waveType.value;
    setStatus(`wave=${ui.waveType.value}`);
  });
  ui.playMode.addEventListener("change", () => {
    ui.modeVal.textContent = ui.playMode.value;
    setStatus(`mode=${ui.playMode.value}`);
  });
  ui.envelopeProfile.addEventListener("change", () => {
    selectedEnvelopeProfile = ui.envelopeProfile.value;
    applyEnvelopeProfileToUi(selectedEnvelopeProfile);
    setStatus(`envelope=${selectedEnvelopeProfile}`);
  });
  ui.reverbKind.addEventListener("change", () => {
    if (audioStarted) {
      applyReverbFromUi();
    }
    ui.reverbKindVal.textContent = ui.reverbKind.value;
    setStatus(`reverb kind=${ui.reverbKind.value}`);
  });
};

// 画面初期化、選択肢生成、イベント登録をまとめて行う
// 音を出す処理そのものは Audio Start の user gesture 後まで遅延する
const start = () => {
  ui = getUiRefs();
  setPlayControlsEnabled(false);

  populateSelect(ui.rootNote, ROOT_NOTES.map((note) => ({ value: note.frequency, label: note.label })));
  ui.rootNote.value = "261.63";
  ui.rootVal.textContent = "C4";

  populateSelect(ui.waveType, WAVE_TYPES.map((name) => ({ value: name, label: name })));
  ui.waveType.value = "sine";
  ui.waveVal.textContent = "sine";

  const profiles = synth.getSeEnvelopePresetList();
  populateSelect(ui.envelopeProfile, profiles.map((name) => ({ value: name, label: name })));
  ui.envelopeProfile.value = selectedEnvelopeProfile;
  applyEnvelopeProfileToUi(selectedEnvelopeProfile);

  const reverbKinds = synth.getImpulseKindList();
  populateSelect(ui.reverbKind, reverbKinds.map((name) => ({ value: name, label: name })));
  ui.reverbKind.value = "hall";
  ui.reverbKindVal.textContent = "hall";

  bindSelectEvents();
  bindRange(ui.masterVol, ui.masterVal, formatRatio, () => applyVolumeFromUi());
  bindRange(ui.toneVol, ui.toneVolVal, formatRatio, () => applyVolumeFromUi());
  bindRange(ui.gain, ui.gainVal, formatRatio);
  bindRange(ui.attack, ui.attackVal, formatSeconds, (v) => updateSelectedEnvelope({ attack: v }));
  bindRange(ui.decay, ui.decayVal, formatSeconds, (v) => updateSelectedEnvelope({ decay: v }));
  bindRange(ui.sustain, ui.sustainVal, formatRatio, (v) => updateSelectedEnvelope({ sustain: v }));
  bindRange(ui.release, ui.releaseVal, formatSeconds, (v) => updateSelectedEnvelope({ release: v }));
  bindRange(ui.reverbMix, ui.reverbMixVal, formatRatio, () => applyReverbFromUi());
  bindRange(ui.reverbLength, ui.reverbLengthVal, formatReverbSeconds, () => applyReverbFromUi());
  bindRange(ui.reverbDecay, ui.reverbDecayVal, formatRatio, () => applyReverbFromUi());

  ui.btnInit.addEventListener("click", async () => {
    try {
      await synth.resume();
      audioStarted = true;
      applyEnvelopeFromUi();
      applyVolumeFromUi();
      applyReverbFromUi();
      setPlayControlsEnabled(true);
      ui.btnInit.disabled = true;
      setStatus("audio started");
    } catch (err) {
      setStatus(`failed to start audio (${err.message})`);
      console.error(err);
    }
  });

  bindHoldButton(ui.btnPlaySingle, () => "single");
  bindHoldButton(ui.btnPlayTriad, () => (ui.playMode.value === "minor" ? "minor" : "major"));

  ui.btnStop.addEventListener("click", () => {
    stopHeldToneSet();
    synth.stopAllTones({ release: 0.08 });
    setStatus("all tones stopped");
  });

  ui.btnDry.addEventListener("click", () => setReverbPreset(ui.reverbKind.value, 0.0, readUiNumber(ui.reverbLength, "reverb length"), readUiNumber(ui.reverbDecay, "reverb decay")));
  ui.btnRoom.addEventListener("click", () => setReverbPreset("room", 0.18, 1.20, 2.30));
  ui.btnHall.addEventListener("click", () => setReverbPreset("hall", 0.34, 3.20, 1.80));
  ui.btnPlate.addEventListener("click", () => setReverbPreset("plate", 0.30, 2.10, 1.45));

  setStatus("waiting for Audio Start");
};

document.addEventListener("DOMContentLoaded", () => {
  try {
    start();
  } catch (err) {
    ui = ui ?? getUiRefs();
    setStatus(`init error (${err.message})`);
    console.error(err);
  }
});
