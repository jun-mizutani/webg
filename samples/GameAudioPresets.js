// -------------------------------------------------
// game support
//   GameAudioPresets.js 2026/04/12
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// -------------------------------------------------

// sample 側で共通に使う BGM preset を core から分離し、
// GameAudioSynth 自体は「SE catalog と melody preset を持つ synth」に集中させる
export const GAME_BGM_PRESETS = {
  default: {
    label: "default",
    melody: "minor_drive",
    bpm: 124,
    root: 220.0,
    envelope: { attack: 0.03, decay: 0.20, sustain: 0.60, release: 0.40 }
  },
  menu: {
    label: "menu",
    melody: "night_drive",
    bpm: 100,
    root: 196.0,
    envelope: { attack: 0.035, decay: 0.18, sustain: 0.62, release: 0.42 }
  },
  field: {
    label: "field",
    melody: "sunrise_step",
    bpm: 116,
    root: 220.0,
    envelope: { attack: 0.03, decay: 0.19, sustain: 0.60, release: 0.38 }
  },
  chase: {
    label: "chase",
    melody: "hero_run",
    bpm: 136,
    root: 220.0,
    envelope: { attack: 0.02, decay: 0.17, sustain: 0.58, release: 0.34 }
  },
  boss: {
    label: "boss",
    melody: "boss_alert",
    bpm: 144,
    root: 196.0,
    envelope: { attack: 0.02, decay: 0.16, sustain: 0.56, release: 0.32 }
  },
  victory: {
    label: "victory",
    melody: "bright_arp",
    bpm: 132,
    root: 220.0,
    envelope: { attack: 0.025, decay: 0.18, sustain: 0.62, release: 0.40 }
  }
};

// core 側に場面専用 API を増やさず、sample 側では既存の SE 名を
// 「ゲーム上の出来事に対応した通知音」として読み替える
export const GAME_EVENT_SOUND_MAP = {
  ready: "countdown",
  go: "ui_ok",
  stop: "ui_move",
  clear: "levelup",
  fail: "gameover",
  bonus: "powerup"
};

export const getGameBgmPresetList = () => Object.keys(GAME_BGM_PRESETS);

export const getGameBgmPresetInfo = (name) => {
  if (!name || typeof name !== "string") {
    throw new Error("BGM preset name must be a non-empty string.");
  }
  const info = GAME_BGM_PRESETS[name];
  if (!info) {
    throw new Error(`Unknown BGM preset: ${name}`);
  }
  return {
    name,
    label: info.label ?? name,
    melody: info.melody,
    bpm: info.bpm,
    root: info.root,
    envelope: { ...info.envelope }
  };
};

export const applyGameBgmPreset = (audio, name) => {
  if (!audio) {
    throw new Error("Audio synth is required.");
  }
  const info = getGameBgmPresetInfo(name);
  audio.setMelody(info.melody);
  audio.setBpm(info.bpm);
  audio.setRootHz(info.root);
  audio.setBgmEnvelope(info.envelope);
  return info;
};

export const getGameEventSoundName = (name) => {
  if (!name || typeof name !== "string") {
    throw new Error("Event sound name must be a non-empty string.");
  }
  const seName = GAME_EVENT_SOUND_MAP[name];
  if (!seName) {
    throw new Error(`Unknown event sound: ${name}`);
  }
  return seName;
};

export const playGameEventSound = (audio, name) => {
  if (!audio) {
    throw new Error("Audio synth is required.");
  }
  const seName = getGameEventSoundName(name);
  audio.playSe(seName);
  return {
    event: name,
    soundEffect: seName
  };
};
