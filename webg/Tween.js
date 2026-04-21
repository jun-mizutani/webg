// ---------------------------------------------
// Tween.js       2026/04/21
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// Tween: in-between の略で、開始値と終了値の間を補間する
// - 数値や vec3 / color のような配列を、時間をかけて 1 つの値から別の値へ補間する
// - WebgApp からは general-purpose な補間器として使い、Shape 側では parameter animation の下地に使う
// - どの値を、どの時間で、どの ease で動かしているかを 1 つの class に閉じ込める
// - sample や unittest を読む人が、演出の責務を追いやすいようにする

import util from "./util.js";

// 入れ子配列やオブジェクトを、そのまま別用途に流用できる形で複製する
// 補間の途中で元データが書き換わっても、Tween 側の基準値が壊れないようにする
const cloneValue = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => cloneValue(item));
  }
  if (value && typeof value === "object") {
    return { ...value };
  }
  return value;
};

// もっとも単純な線形補間を数値 1 個に対して行う
// これを基礎にして、配列や object 全体の補間へ広げる
const lerpNumber = (from, to, t) => from + (to - from) * t;

// 補間対象が数値か配列かで分岐し、同じ式で扱える形へそろえる
// object の場合は key ごとに呼ばれ、最終的には target 全体へ writeValue される
const lerpValue = (from, to, t) => {
  if (Array.isArray(to)) {
    if (!Array.isArray(from) || from.length !== to.length) {
      throw new Error("Tween requires matching array start/end values");
    }
    return to.map((item, index) => lerpValue(from[index], item, t));
  }
  if (typeof to === "number" && typeof from === "number") {
    return lerpNumber(from, to, t);
  }
  if (typeof to === "number") {
    throw new Error("Tween requires numeric start value for numeric interpolation");
  }
  if (from === undefined) {
    throw new Error("Tween requires explicit start value for non-numeric interpolation");
  }
  return t >= 1.0 ? cloneValue(to) : cloneValue(from);
};

// 既存 target へ補間結果を書き戻す
// array は index、object は property key で更新し、参照をできるだけ保つ
const writeValue = (target, key, value) => {
  if (Array.isArray(target)) {
    target[key] = cloneValue(value);
    return;
  }
  if (!target || typeof target !== "object") {
    return;
  }
  const current = target[key];
  if (Array.isArray(value)) {
    if (Array.isArray(current)) {
      current.length = value.length;
      for (let i = 0; i < value.length; i++) {
        current[i] = value[i];
      }
    } else {
      target[key] = cloneValue(value);
    }
    return;
  }
  if (value && typeof value === "object") {
    target[key] = cloneValue(value);
    return;
  }
  target[key] = value;
};

export default class Tween {
  static getEasingMap() {
    return {
      linear: (t) => t,
      inquad: (t) => t * t,
      outquad: (t) => 1 - (1 - t) * (1 - t),
      inoutquad: (t) => (t < 0.5)
        ? (2 * t * t)
        : (1 - Math.pow(-2 * t + 2, 2) * 0.5),
      incubic: (t) => t * t * t,
      outcubic: (t) => 1 - Math.pow(1 - t, 3),
      inoutcubic: (t) => (t < 0.5)
        ? (4 * t * t * t)
        : (1 - Math.pow(-2 * t + 2, 3) * 0.5),
      outexpo: (t) => (t >= 1.0 ? 1.0 : 1 - Math.pow(2, -10 * t)),
      outsine: (t) => Math.sin((t * Math.PI) * 0.5)
    };
  }

  static isKnownEasing(name) {
    return Object.prototype.hasOwnProperty.call(Tween.getEasingMap(), String(name).toLowerCase());
  }

  // Tween は「どの target を、何へ、どの速さで動かすか」を 1 本持つ
  // target は object でも array でもよく、WebgApp からは演出部品として使う
  constructor(target = {}, to = {}, options = {}) {
    // 補間対象と目標値を保持し、途中で外側の参照が変わっても壊れにくくする
    this.target = target;
    this.to = cloneValue(to);
    // from が指定されればその値を起点にし、なければ target の現状値を起点にする
    this.fromSource = options.from !== undefined ? cloneValue(options.from) : null;
    // durationMs は 0 以下なら即時適用として扱う
    this.durationMs = util.readOptionalFiniteNumber(options.durationMs, "Tween durationMs", 0, { min: 0 });
    this.elapsedMs = 0;
    this.paused = options.paused === true;
    this.finished = false;
    // easing は名前で受け、必要ならあとから resolveEasing() で拡張しやすくする
    this.easingName = String(options.easing ?? "linear").toLowerCase();
    if (options.easing !== undefined && !Tween.isKnownEasing(this.easingName)) {
      throw new Error(`Tween easing "${options.easing}" is not supported`);
    }
    this.easing = Tween.resolveEasing(this.easingName);
    // onUpdate / onComplete は sample 側の演出連携用に用意する
    this.onUpdate = util.readOptionalFunction(options.onUpdate, "Tween onUpdate");
    this.onComplete = util.readOptionalFunction(options.onComplete, "Tween onComplete");
    // 開始時点の値を snapshot して、途中で target が変わっても補間の基準が揺れないようにする
    this.start = this.captureStartValues();

    // duration が 0 のときは、1 frame 待たずに最終値を適用する
    // HUD や即時色変更のような用途では、ここで完了扱いにした方が扱いやすい
    if (this.durationMs <= 0) {
      this.apply(1.0);
      this.finished = true;
      if (this.onUpdate) {
        this.onUpdate(this.target, 1.0, this);
      }
      if (this.onComplete) {
        this.onComplete(this.target, this);
      }
    } else {
      this.apply(0.0);
    }
  }

  // easing 名を関数へ解決する
  // ここを 1 か所にまとめておくと、sample 側は "outCubic" のような文字列だけを渡せる
  static resolveEasing(name = "linear") {
    const easingName = String(name ?? "linear").toLowerCase();
    const easingMap = Tween.getEasingMap();
    return easingMap[easingName] ?? easingMap.linear;
  }

// 開始値 snapshot を作る
// target が array の場合は index ごと、object の場合は property ごとに基準値を取り、
// 値が欠けているときは補間を続けず例外として扱う
  captureStartValues() {
    if (Array.isArray(this.target) && Array.isArray(this.to)) {
      const fromArray = Array.isArray(this.fromSource) ? this.fromSource : null;
      return this.to.map((item, index) => {
        const candidate = fromArray?.[index] ?? this.target[index];
        if (candidate === undefined) {
          throw new Error(`Tween missing start value at index ${index}`);
        }
        return cloneValue(candidate);
      });
    }

    const keys = Object.keys(this.to ?? {});
    const fromObject = this.fromSource && typeof this.fromSource === "object" && !Array.isArray(this.fromSource)
      ? this.fromSource
      : null;
    const start = {};
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const candidate = fromObject?.[key] ?? this.target?.[key];
      if (candidate === undefined) {
        throw new Error(`Tween missing start value for key "${key}"`);
      }
      start[key] = cloneValue(candidate);
    }
    return start;
  }

  // 現在の progress を target へ反映する
  // ここでは「どこまで進んだか」を受け取るだけにして、時間の進み方は update() に任せる
  apply(progress = 0.0) {
    const eased = this.easing(Math.max(0.0, Math.min(1.0, progress)));
    if (Array.isArray(this.target) && Array.isArray(this.to)) {
      for (let i = 0; i < this.to.length; i++) {
        writeValue(this.target, i, lerpValue(this.start[i], this.to[i], eased));
      }
      return this.target;
    }

    const keys = Object.keys(this.to ?? {});
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      writeValue(this.target, key, lerpValue(this.start[key], this.to[key], eased));
    }
    return this.target;
  }

  // 時間を 1 frame 進めて、補間先へ値を書き戻す
  // finished なら何もしない、paused なら時間だけ止めてそのまま返す
  update(deltaMs = 0) {
    if (this.finished) {
      return true;
    }
    if (this.paused) {
      return false;
    }

    this.elapsedMs += util.readOptionalFiniteNumber(deltaMs, "Tween deltaMs", 0, { min: 0 });
    const progress = this.durationMs <= 0 ? 1.0 : Math.min(1.0, this.elapsedMs / this.durationMs);
    this.apply(progress);
    if (this.onUpdate) {
      this.onUpdate(this.target, progress, this);
    }
    if (progress >= 1.0) {
      this.finished = true;
      if (this.onComplete) {
        this.onComplete(this.target, this);
      }
      return true;
    }
    return false;
  }

  // 同じ Tween をもう一度使うためのリセット処理
  // values を渡したときは、そこを新しい from として再スタートする
  reset(values = null) {
    if (values !== null && values !== undefined) {
      this.fromSource = cloneValue(values);
    }
    this.elapsedMs = 0;
    this.finished = false;
    this.start = this.captureStartValues();
    this.apply(0.0);
    return this;
  }

  // 一時停止と再開は、演出を止めたいけれど Tween の状態自体は保持したいときに使う
  pause() {
    this.paused = true;
    return this;
  }

  resume() {
    this.paused = false;
    return this;
  }

  // 完了状態かどうかを、外側から参照しやすくする
  isFinished() {
    return this.finished;
  }

  // 外側から clone が必要なときに、関数を経由して同じロジックを再利用する
  static cloneValue(value) {
    return cloneValue(value);
  }
}
