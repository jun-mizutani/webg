// ---------------------------------------------
// samples/sound/main.js  2026/04/09
//   sound sample
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import GameAudioSynth from "../../webg/GameAudioSynth.js";

const $ = (id) => document.getElementById(id);

// UI参照をまとめて保持し、イベント登録時の重複取得を避ける
let ui = null;

const getUiRefs = () => ({
  btnInit: $("btnInit"),
  btnBgmOn: $("btnBgmOn"),
  btnBgmOff: $("btnBgmOff"),
  soundEffect: $("soundEffect"),
  btnPlaySe: $("btnPlaySe"),
  btnNextSe: $("btnNextSe"),
  btnAuditionSe: $("btnAuditionSe"),
  seProfiles: $("seProfiles"),
  seEditingProfile: $("seEditingProfile"),
  masterVol: $("masterVol"),
  seVol: $("seVol"),
  bgmVol: $("bgmVol"),
  bpm: $("bpm"),
  melody: $("melody"),
  seDelay: $("seDelay"),
  bgmDelay: $("bgmDelay"),
  seReverb: $("seReverb"),
  bgmReverb: $("bgmReverb"),
  seReverbKind: $("seReverbKind"),
  bgmReverbKind: $("bgmReverbKind"),
  seReverbDuration: $("seReverbDuration"),
  bgmReverbDuration: $("bgmReverbDuration"),
  seReverbDecay: $("seReverbDecay"),
  bgmReverbDecay: $("bgmReverbDecay"),
  seEnvelopeProfile: $("seEnvelopeProfile"),
  seAttack: $("seAttack"),
  seDecay: $("seDecay"),
  seSustain: $("seSustain"),
  seRelease: $("seRelease"),
  bgmAttack: $("bgmAttack"),
  bgmDecay: $("bgmDecay"),
  bgmSustain: $("bgmSustain"),
  bgmRelease: $("bgmRelease"),
  btnSeDry: $("btnSeDry"),
  btnSeWet: $("btnSeWet"),
  btnBgmDry: $("btnBgmDry"),
  btnBgmWet: $("btnBgmWet"),
  masterVal: $("masterVal"),
  seVal: $("seVal"),
  bgmVal: $("bgmVal"),
  bpmVal: $("bpmVal"),
  seDelayVal: $("seDelayVal"),
  bgmDelayVal: $("bgmDelayVal"),
  seReverbVal: $("seReverbVal"),
  bgmReverbVal: $("bgmReverbVal"),
  seReverbDurationVal: $("seReverbDurationVal"),
  bgmReverbDurationVal: $("bgmReverbDurationVal"),
  seReverbDecayVal: $("seReverbDecayVal"),
  bgmReverbDecayVal: $("bgmReverbDecayVal"),
  seAttackVal: $("seAttackVal"),
  seDecayVal: $("seDecayVal"),
  seSustainVal: $("seSustainVal"),
  seReleaseVal: $("seReleaseVal"),
  bgmAttackVal: $("bgmAttackVal"),
  bgmDecayVal: $("bgmDecayVal"),
  bgmSustainVal: $("bgmSustainVal"),
  bgmReleaseVal: $("bgmReleaseVal"),
  status: $("status")
});

const synth = new GameAudioSynth();
let statusText = "waiting for Audio Start";
let selectedSeEnvelopeProfile = "soft";
let selectedSoundEffect = "poyoon";
let soundEffectList = [];
let selectedSoundEffectIndex = 0;
let seAuditionToken = 0;
let seAuditionRunning = false;

const setStatus = (text) => {
  // 操作結果をステータス行へ表示する
  statusText = text;
  renderStatus();
};

const formatSeconds = (value) => `${Number(value).toFixed(3)} sec`;
const formatReverbSeconds = (value) => `${Number(value).toFixed(2)} sec`;
const formatRatio = (value) => `${Number(value).toFixed(2)} ratio`;
const formatPlain = (value) => `${Number(value).toFixed(2)}`;
// 連続試聴のあいだに少し待ち時間を入れて、余韻の違いが聞き取りやすいようにする
const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

const renderStatus = () => {
  ui.status.textContent = `status: ${statusText}`;
};

const applySeEnvelopeToUi = (profileName) => {
  const env = synth.getSeEnvelopePreset(profileName);
  ui.seAttack.value = String(env.attack ?? 0.005);
  ui.seDecay.value = String(env.decay ?? 0.05);
  ui.seSustain.value = String(env.sustain ?? 0.55);
  ui.seRelease.value = String(env.release ?? 0.08);
  ui.seAttackVal.textContent = formatSeconds(ui.seAttack.value);
  ui.seDecayVal.textContent = formatSeconds(ui.seDecay.value);
  ui.seSustainVal.textContent = formatRatio(ui.seSustain.value);
  ui.seReleaseVal.textContent = formatSeconds(ui.seRelease.value);
  ui.seEditingProfile.textContent = profileName;
};

const updateSelectedSeEnvelope = (partial) => {
  // setSeEnvelopePreset() は preset 全体を置き換える API なので、
  // sample 側で現在値を読み直してから部分更新を合成する
  const current = synth.getSeEnvelopePreset(selectedSeEnvelopeProfile);
  synth.setSeEnvelopePreset(selectedSeEnvelopeProfile, {
    ...current,
    ...partial
  });
};

const populateReverbKinds = (select) => {
  const kinds = synth.getImpulseKindList();
  select.replaceChildren();
  for (let i = 0; i < kinds.length; i++) {
    const kind = kinds[i];
    const opt = document.createElement("option");
    opt.value = kind;
    opt.textContent = kind;
    select.appendChild(opt);
  }
};

const applySeReverbImpulseToUi = (config) => {
  ui.seReverbKind.value = config.kind;
  ui.seReverbDuration.value = String(config.durationSec);
  ui.seReverbDecay.value = String(config.decay);
  ui.seReverbDurationVal.textContent = formatReverbSeconds(config.durationSec);
  ui.seReverbDecayVal.textContent = formatPlain(config.decay);
};

const applyBgmReverbImpulseToUi = (config) => {
  ui.bgmReverbKind.value = config.kind;
  ui.bgmReverbDuration.value = String(config.durationSec);
  ui.bgmReverbDecay.value = String(config.decay);
  ui.bgmReverbDurationVal.textContent = formatReverbSeconds(config.durationSec);
  ui.bgmReverbDecayVal.textContent = formatPlain(config.decay);
};

const applyBgmEnvelopeToUi = (envelope) => {
  ui.bgmAttack.value = String(envelope.attack ?? 0.03);
  ui.bgmDecay.value = String(envelope.decay ?? 0.2);
  ui.bgmSustain.value = String(envelope.sustain ?? 0.6);
  ui.bgmRelease.value = String(envelope.release ?? 0.4);
  ui.bgmAttackVal.textContent = formatSeconds(ui.bgmAttack.value);
  ui.bgmDecayVal.textContent = formatSeconds(ui.bgmDecay.value);
  ui.bgmSustainVal.textContent = formatRatio(ui.bgmSustain.value);
  ui.bgmReleaseVal.textContent = formatSeconds(ui.bgmRelease.value);
};

const updateSeReverbImpulseFromUi = (partial = {}) => {
  const next = synth.setSeReverbImpulse({
    ...synth.getSeReverbImpulseConfig(),
    ...partial
  });
  applySeReverbImpulseToUi(next);
  return next;
};

const updateBgmReverbImpulseFromUi = (partial = {}) => {
  const next = synth.setBgmReverbImpulse({
    ...synth.getBgmReverbImpulseConfig(),
    ...partial
  });
  applyBgmReverbImpulseToUi(next);
  return next;
};

const applySoundEffectInfo = (name) => {
  const info = synth.getSoundEffectInfo(name);
  selectedSoundEffect = name;
  const index = soundEffectList.indexOf(name);
  if (index >= 0) {
    selectedSoundEffectIndex = index;
  }
  ui.soundEffect.value = name;
  ui.seProfiles.textContent = info.profiles.join(", ");
  ui.seEnvelopeProfile.replaceChildren();
  for (let i = 0; i < info.profiles.length; i++) {
    const profileName = info.profiles[i];
    const opt = document.createElement("option");
    opt.value = profileName;
    opt.textContent = profileName;
    ui.seEnvelopeProfile.appendChild(opt);
  }
  selectedSeEnvelopeProfile = info.primaryProfile;
  ui.seEnvelopeProfile.value = selectedSeEnvelopeProfile;
  applySeEnvelopeToUi(selectedSeEnvelopeProfile);
};

const playSelectedSoundEffect = (name = selectedSoundEffect) => {
  // 選択中の SE を 1 回だけ鳴らし、比較の起点をそろえる
  if (!name) return;
  synth.playSe(name);
  setStatus(`sound effect=${name}`);
};

const moveSoundEffectSelection = (step = 1, play = true) => {
  // catalog を巡回しながら、現在選択をひとつずつ進める
  if (soundEffectList.length === 0) return;
  const nextIndex = (selectedSoundEffectIndex + step + soundEffectList.length) % soundEffectList.length;
  const nextName = soundEffectList[nextIndex];
  applySoundEffectInfo(nextName);
  if (play) {
    playSelectedSoundEffect(nextName);
  } else {
    setStatus(`sound effect=${nextName}`);
  }
};

const auditionAllSoundEffects = async () => {
  // catalog を順番に鳴らし、短時間で新しい SE 群の差をつかめるようにする
  if (soundEffectList.length === 0) return;
  if (seAuditionRunning) {
    seAuditionToken += 1;
    seAuditionRunning = false;
    ui.btnAuditionSe.textContent = "Audition All";
    setStatus("sound audition stopped");
    return;
  }

  const token = ++seAuditionToken;
  seAuditionRunning = true;
  ui.btnAuditionSe.textContent = "Stop Audition";

  try {
    for (let i = 0; i < soundEffectList.length; i++) {
      if (token !== seAuditionToken) break;
      const name = soundEffectList[i];
      applySoundEffectInfo(name);
      synth.playSe(name);
      setStatus(`audition ${i + 1}/${soundEffectList.length}: ${name}`);
      const waitMs = name === "tail_probe" ? 720 : 460;
      await sleep(waitMs);
    }
    if (token === seAuditionToken) {
      setStatus("sound audition complete");
    }
  } finally {
    if (token === seAuditionToken) {
      seAuditionRunning = false;
      ui.btnAuditionSe.textContent = "Audition All";
    }
  }
};

const setEnabledAfterInit = (enabled) => {
  // オーディオ初期化後に操作ボタン群を有効化する
  ui.btnBgmOn.disabled = !enabled;
  ui.btnBgmOff.disabled = !enabled;
  ui.btnPlaySe.disabled = !enabled;
  ui.btnNextSe.disabled = !enabled;
  ui.btnAuditionSe.disabled = !enabled;
  ui.btnSeDry.disabled = !enabled;
  ui.btnSeWet.disabled = !enabled;
  ui.btnBgmDry.disabled = !enabled;
  ui.btnBgmWet.disabled = !enabled;
};

const bindRange = (slider, valueLabel, fn) => {
  // スライダ値表示とオーディオパラメータ更新を同期する
  const apply = () => {
    valueLabel.textContent = slider.value;
    fn(Number(slider.value));
  };
  slider.addEventListener("input", apply);
  apply();
};

const start = async () => {
  ui = getUiRefs();
  renderStatus();

  // 初期状態ではWebAudio未解禁のため操作を無効にしておく
  setEnabledAfterInit(false);

  // メロディ候補をUIに展開する
  const melodies = synth.getMelodyList();
  // GameAudioSynth 側でメロディ定義は basePresets に一本化されている
  for (let i = 0; i < melodies.length; i++) {
    const name = melodies[i];
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    ui.melody.appendChild(opt);
  }
  ui.melody.value = melodies.includes("minor_drive") ? "minor_drive" : (melodies[0] ?? "");
  ui.melody.disabled = melodies.length === 0;
  ui.melody.addEventListener("change", () => {
    // 現在BGMメロディを選択肢から切り替える
    if (!ui.melody.value) return;
    synth.setMelody(ui.melody.value);
    setStatus(`melody=${ui.melody.value}`);
  });

  soundEffectList = synth.getSoundEffectList();
  for (let i = 0; i < soundEffectList.length; i++) {
    const name = soundEffectList[i];
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    ui.soundEffect.appendChild(opt);
  }
  selectedSoundEffect = soundEffectList[0] ?? "poyoon";
  applySoundEffectInfo(selectedSoundEffect);
  populateReverbKinds(ui.seReverbKind);
  populateReverbKinds(ui.bgmReverbKind);
  applySeReverbImpulseToUi(synth.setSeReverbImpulse({ kind: "hall", durationSec: 3.2, decay: 1.8 }));
  applyBgmReverbImpulseToUi(synth.getBgmReverbImpulseConfig());
  ui.soundEffect.addEventListener("change", () => {
    if (!ui.soundEffect.value) return;
    applySoundEffectInfo(ui.soundEffect.value);
    setStatus(`sound effect=${ui.soundEffect.value}`);
  });
  ui.seEnvelopeProfile.addEventListener("change", () => {
    selectedSeEnvelopeProfile = ui.seEnvelopeProfile.value || "soft";
    applySeEnvelopeToUi(selectedSeEnvelopeProfile);
    setStatus(`se envelope=${selectedSeEnvelopeProfile}`);
  });
  ui.seReverbKind.addEventListener("change", () => {
    const config = updateSeReverbImpulseFromUi({ kind: ui.seReverbKind.value || "room" });
    setStatus(`SE reverb kind=${config.kind}`);
  });
  ui.bgmReverbKind.addEventListener("change", () => {
    const config = updateBgmReverbImpulseFromUi({ kind: ui.bgmReverbKind.value || "hall" });
    setStatus(`BGM reverb kind=${config.kind}`);
  });

  // 現在のBGM envelope を UI へ反映し、実値から調整を始められるようにする
  applyBgmEnvelopeToUi(synth.getBgmEnvelope());

  ui.btnPlaySe.addEventListener("click", () => {
    playSelectedSoundEffect();
  });

  ui.btnNextSe.addEventListener("click", () => {
    moveSoundEffectSelection(1, true);
  });

  ui.btnAuditionSe.addEventListener("click", () => {
    auditionAllSoundEffects().catch((err) => {
      seAuditionRunning = false;
      ui.btnAuditionSe.textContent = "Audition All";
      setStatus(`audition failed (${err?.message ?? err})`);
      console.error(err);
    });
  });

  ui.btnInit.addEventListener("click", async () => {
    // ユーザ操作を契機にAudioContextをresumeする
    try {
      await synth.resume();
      setEnabledAfterInit(true);
      ui.btnInit.disabled = true;
      setStatus("audio started");
    } catch (err) {
      setStatus(`failed to start audio (${err?.message ?? err})`);
      console.error(err);
    }
  });

  ui.btnBgmOn.addEventListener("click", () => {
    // ループBGM再生を開始する
    synth.startBgm();
    setStatus("bgm playing");
  });

  ui.btnBgmOff.addEventListener("click", () => {
    // BGMを短いフェードで停止する
    synth.stopBgm(0.2);
    setStatus("bgm stopped");
  });

  ui.btnSeDry.addEventListener("click", () => {
    // SE側リバーブを即座にdryへ戻す
    ui.seReverb.value = "0.00";
    ui.seReverbVal.textContent = "0.00";
    synth.setSeReverb(0.0, 0.0);
    synth.playSe(selectedSoundEffect);
    setStatus("SE reverb: dry");
  });

  ui.btnSeWet.addEventListener("click", () => {
    // SE側リバーブを最大wetへ設定する
    ui.seReverb.value = "1.00";
    ui.seReverbVal.textContent = "1.00";
    synth.setSeReverb(0.65, 1.0);
    synth.playSe(selectedSoundEffect);
    setStatus("SE reverb: max");
  });

  ui.btnBgmDry.addEventListener("click", () => {
    // BGM側リバーブをdryへ設定する
    ui.bgmReverb.value = "0.00";
    ui.bgmReverbVal.textContent = "0.00";
    synth.setBgmReverb(0.0, 0.0);
    setStatus("BGM reverb: dry");
  });

  ui.btnBgmWet.addEventListener("click", () => {
    // BGM側リバーブをmaxへ設定する
    ui.bgmReverb.value = "1.00";
    ui.bgmReverbVal.textContent = "1.00";
    synth.setBgmReverb(0.50, 1.0);
    setStatus("BGM reverb: max");
  });

  // 各スライダをシンセの対応パラメータへ接続する
  bindRange(ui.masterVol, ui.masterVal, (v) => synth.setMasterVolume(v));
  bindRange(ui.seVol, ui.seVal, (v) => synth.setSeVolume(v));
  bindRange(ui.bgmVol, ui.bgmVal, (v) => synth.setBgmVolume(v));
  bindRange(ui.bpm, ui.bpmVal, (v) => synth.setBpm(v));
  bindRange(ui.seDelay, ui.seDelayVal, (v) => synth.setSeDelay(v));
  bindRange(ui.bgmDelay, ui.bgmDelayVal, (v) => synth.setBgmDelay(v));
  bindRange(ui.seReverb, ui.seReverbVal, (v) => synth.setSeReverb(v * 0.65, v));
  bindRange(ui.bgmReverb, ui.bgmReverbVal, (v) => synth.setBgmReverb(v * 0.50, v));
  bindRange(ui.seReverbDuration, ui.seReverbDurationVal, (v) => {
    // duration は impulse response が何秒ぶん続くかを表し、
    // 値を上げるほど reverb tail が長く残りやすくなる
    ui.seReverbDurationVal.textContent = formatReverbSeconds(v);
    updateSeReverbImpulseFromUi({ durationSec: v });
  });
  bindRange(ui.seReverbDecay, ui.seReverbDecayVal, (v) => {
    // decay は tail の落ち方を決める係数で、
    // 値を上げるほど後半が早く減衰し、room 寄りに聞こえやすくなる
    ui.seReverbDecayVal.textContent = formatPlain(v);
    updateSeReverbImpulseFromUi({ decay: v });
  });
  bindRange(ui.bgmReverbDuration, ui.bgmReverbDurationVal, (v) => {
    // BGM 側も同様に IR 長を変え、長い hall tail と短い room tail を聞き比べやすくする
    ui.bgmReverbDurationVal.textContent = formatReverbSeconds(v);
    updateBgmReverbImpulseFromUi({ durationSec: v });
  });
  bindRange(ui.bgmReverbDecay, ui.bgmReverbDecayVal, (v) => {
    // BGM 側の decay は tail の落ち着き方を変えるので、
    // melody を流したまま空間の広がり方を比較できる
    ui.bgmReverbDecayVal.textContent = formatPlain(v);
    updateBgmReverbImpulseFromUi({ decay: v });
  });
  bindRange(ui.seAttack, ui.seAttackVal, (v) => {
    // attack は発音開始から peak に到達するまでの時間を秒で調整する
    ui.seAttackVal.textContent = formatSeconds(v);
    updateSelectedSeEnvelope({ attack: v });
  });
  bindRange(ui.seDecay, ui.seDecayVal, (v) => {
    // decay は peak から sustain 量まで落ち着くまでの時間を秒で調整する
    ui.seDecayVal.textContent = formatSeconds(v);
    updateSelectedSeEnvelope({ decay: v });
  });
  bindRange(ui.seSustain, ui.seSustainVal, (v) => {
    // sustain は peak を 1.0 とした保持量の比率で調整する
    ui.seSustainVal.textContent = formatRatio(v);
    updateSelectedSeEnvelope({ sustain: v });
  });
  bindRange(ui.seRelease, ui.seReleaseVal, (v) => {
    // release はノート終了後に無音へ落ちるまでの時間を秒で調整する
    ui.seReleaseVal.textContent = formatSeconds(v);
    updateSelectedSeEnvelope({ release: v });
  });
  bindRange(ui.bgmAttack, ui.bgmAttackVal, (v) => {
    // attack は発音開始から peak に到達するまでの時間を秒で調整する
    ui.bgmAttackVal.textContent = formatSeconds(v);
    synth.setBgmEnvelope({ attack: v });
  });
  bindRange(ui.bgmDecay, ui.bgmDecayVal, (v) => {
    // decay は peak から sustain 量まで落ち着くまでの時間を秒で調整する
    ui.bgmDecayVal.textContent = formatSeconds(v);
    synth.setBgmEnvelope({ decay: v });
  });
  bindRange(ui.bgmSustain, ui.bgmSustainVal, (v) => {
    // sustain は peak を 1.0 とした保持量の比率で調整する
    ui.bgmSustainVal.textContent = formatRatio(v);
    synth.setBgmEnvelope({ sustain: v });
  });
  bindRange(ui.bgmRelease, ui.bgmReleaseVal, (v) => {
    // release はノート終了後に無音へ落ちるまでの時間を秒で調整する
    ui.bgmReleaseVal.textContent = formatSeconds(v);
    synth.setBgmEnvelope({ release: v });
  });
  renderStatus();
};

document.addEventListener("DOMContentLoaded", () => {
  start().catch((err) => {
    setStatus(`init error (${err?.message ?? err})`);
    console.error(err);
  });
});
