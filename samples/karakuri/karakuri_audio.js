// ---------------------------------------------
//  karakuri_audio.js  2026/09/17
//   Collision and goal sounds for the Karakuri samples
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import GameAudioSynth from "../../webg/GameAudioSynth.js";

// GameAudioSynthをKarakuriの二種類のイベントへまとめ、接触音の連打も整えます
export class KarakuriAudio {
  constructor(options = {}) {
    this.randomSeed = options.randomSeed ?? 0x6b617261;
    this.synth = null;
    this.bounceCooldownSec = Number.isFinite(options.bounceCooldownSec)
      ? Math.max(0.0, options.bounceCooldownSec)
      : 0.08;
    this.goalBounceCooldownSec = Number.isFinite(options.goalBounceCooldownSec)
      ? Math.max(0.0, options.goalBounceCooldownSec)
      : this.bounceCooldownSec;
    this.lastBounceTime = -Infinity;
    this.lastGoalBounceTime = -Infinity;
    this.ready = false;
    this.previousPlaneContactKeys = new Set();
    this.planeReadbackWarningShown = false;
  }

  // 音声プリセットの準備も、画面の初期表示後へ遅延させます
  ensureSynth() {
    if (!this.synth) this.synth = new GameAudioSynth({ randomSeed: this.randomSeed });
    return this.synth;
  }

  // StartまたはためすのクリックからAudioContextを有効化し、Karakuri向け音量を設定します
  async resume() {
    if (this.ready) return true;
    try {
      const synth = this.ensureSynth();
      await synth.resume();
      synth.setMasterVolume(0.18);
      synth.setSeVolume(0.78);
      synth.setSeReverb(0.16, 0.30);
      this.ready = true;
      return true;
    } catch (error) {
      // 音声機能のない環境でも、物理の試運転は継続できるようにします
      console.warn("Karakuri audio is unavailable:", error);
      return false;
    }
  }

  // 同じ接触をReset後の新しい試運転として数え直します
  resetContactTracking() {
    this.lastBounceTime = -Infinity;
    this.lastGoalBounceTime = -Infinity;
    this.previousPlaneContactKeys = new Set();
  }

  // 球が部品または球へ触れたときに短い衝突音を一回鳴らします
  playBounce() {
    if (!this.ready || !this.synth?.ctx) return false;
    const now = this.synth.ctx.currentTime;
    if (now - this.lastBounceTime < this.bounceCooldownSec) return false;
    this.synth.playSe("wall");
    this.lastBounceTime = now;
    return true;
  }

  // 球がゴール板へ反発したときに短い衝突音を鳴らします
  playGoalBounce() {
    if (!this.ready || !this.synth?.ctx) return false;
    const now = this.synth.ctx.currentTime;
    if (now - this.lastGoalBounceTime < this.goalBounceCooldownSec) return false;
    this.synth.playSe("wall");
    this.lastGoalBounceTime = now;
    return true;
  }

  // ゴール到達時は衝突音と区別できる上昇音を鳴らします
  playGoal() {
    if (!this.ready || !this.synth) return false;
    this.synth.playSe("levelup");
    return true;
  }

  // 物理Planeとの接触開始を調べ、床や壁への最初の接触を衝突音へ渡します
  readPlaneContactBegins(physics, stateData, ballBodyIds) {
    const currentKeys = new Set();
    const begins = [];
    if (!physics?.getPlaneContactsFromReadback || !stateData || !ballBodyIds?.size) {
      this.previousPlaneContactKeys = currentKeys;
      return begins;
    }
    let contacts;
    try {
      contacts = physics.getPlaneContactsFromReadback(stateData, { includeTriggers: false });
    } catch (error) {
      if (!this.planeReadbackWarningShown) {
        console.warn("Karakuri plane contact readback is unavailable:", error);
        this.planeReadbackWarningShown = true;
      }
      this.previousPlaneContactKeys = currentKeys;
      return begins;
    }
    for (const contact of contacts ?? []) {
      if (!ballBodyIds.has(String(contact.bodyAId))) continue;
      const key = `${contact.bodyAId}:${contact.planeIndex}`;
      currentKeys.add(key);
      if (!this.previousPlaneContactKeys.has(key)) begins.push(contact);
    }
    this.previousPlaneContactKeys = currentKeys;
    return begins;
  }
}

// contactのどちらか一方が、今回画面に存在する発射球かを判定します
export function contactIncludesBody(contact, bodyIds) {
  if (!contact || !bodyIds?.size) return false;
  return bodyIds.has(String(contact.bodyAId)) || bodyIds.has(String(contact.bodyBId));
}

// SceneYAMLのSphere bodyと発射器の一時bodyを、接触音の対象となる球一覧へまとめます
export function collectBallBodyIds(sceneApp, manifest, runtimeBodies = []) {
  const bodyIds = new Set(runtimeBodies.map((entry) => String(entry.bodyId)));
  const sphereIds = new Set(
    (manifest?.objects ?? [])
      .filter((object) => object?.shape?.type === "sphere")
      .map((object) => String(object.id))
  );
  for (const binding of sceneApp?.getDiagnostics?.().physics?.bindings ?? []) {
    const objectId = String(binding.id ?? binding.nodeId ?? "");
    if (sphereIds.has(objectId)) bodyIds.add(String(binding.bodyId));
  }
  return bodyIds;
}
