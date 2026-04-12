// ---------------------------------------------
//  Action.js        2026/03/09
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import util from "./util.js";

export default class Action {

  // Animation参照とアクション辞書を初期化する
  constructor(anim, options = {}) {
    // 1本の Animation(= clip) の内部キーフレーム区間を
    // pattern として再利用し、それらを action として束ねる
    // 既存の addKeyPattern / addAction / startAction / playAction を残しつつ、
    // object ベース API へ寄せるための土台として使う
    this.anim = anim;
    this.actions = {};
    this.patterns = [];
    this.patternMap = new Map();
    this.patternOrder = [];
    this.pat_index = -1;
    this.verbose = false;
    this.currentAction = null;
    this.currentActionId = null;
    this.currentPattern = null;
    this.currentPatternId = null;
    this.playing = false;
    this.paused = false;
    this.defaultLoop = options.loop === true;
  }

  // 現在の clip から key 範囲妥当性を確認する
  validatePatternRange(id, fromKey, toKey) {
    // Animation 側に key 範囲 helper がある場合はそちらを使い、
    // ない場合だけ従来どおり数値の大小関係だけで判定する
    if (typeof this.anim?.isValidKeyRange === "function") {
      if (!this.anim.isValidKeyRange(fromKey, toKey)) {
        const keyCount = typeof this.anim?.getKeyCount === "function"
          ? this.anim.getKeyCount()
          : "unknown";
        throw new Error(
          `pattern "${id}" uses invalid key range ${fromKey}->${toKey} for clip keyCount=${keyCount}`
        );
      }
      return;
    }

    if (fromKey >= toKey) {
      throw new Error(`pattern "${id}" requires fromKey < toKey`);
    }
  }

  // pattern 定義を正規化する
  normalizePattern(def) {
    if (!def || typeof def !== "object") {
      throw new Error("pattern definition must be an object");
    }
    const id = String(def.id ?? "").trim();
    const fromKey = Number(def.fromKey);
    const toKey = Number(def.toKey);
    const entryDurationMs = Number(def.entryDurationMs ?? 0);

    if (!id) {
      throw new Error("pattern id is required");
    }
    if (!Number.isInteger(fromKey) || !Number.isInteger(toKey)) {
      throw new Error(`pattern "${id}" must use integer fromKey/toKey`);
    }
    if (fromKey < 0 || toKey < 0) {
      throw new Error(`pattern "${id}" must use non-negative key indices`);
    }
    if (!Number.isFinite(entryDurationMs) || entryDurationMs < 0) {
      throw new Error(`pattern "${id}" requires entryDurationMs >= 0`);
    }
    this.validatePatternRange(id, fromKey, toKey);

    return {
      id,
      fromKey,
      toKey,
      entryDurationMs
    };
  }

  // action 定義を正規化する
  normalizeAction(def) {
    if (!def || typeof def !== "object") {
      throw new Error("action definition must be an object");
    }
    const id = String(def.id ?? "").trim();
    if (!id) {
      throw new Error("action id is required");
    }
    const patterns = Array.isArray(def.patterns) ? [...def.patterns] : [];
    if (patterns.length === 0) {
      throw new Error(`action "${id}" requires at least one pattern`);
    }

    const patternIds = patterns.map((patternRef) => this.resolvePatternId(patternRef));
    return {
      id,
      patterns: patternIds,
      loop: def.loop === undefined ? this.defaultLoop : def.loop === true
    };
  }

  // pattern 参照を id へ解決する
  resolvePatternId(patternRef) {
    if (typeof patternRef === "number") {
      const pattern = this.patterns[patternRef];
      if (!pattern) {
        throw new Error(`unknown pattern index "${patternRef}"`);
      }
      return pattern.id;
    }
    const id = String(patternRef ?? "").trim();
    if (!id || !this.patternMap.has(id)) {
      throw new Error(`unknown pattern "${patternRef}"`);
    }
    return id;
  }

  // pattern を object 形式で登録する
  addPattern(def) {
    const pattern = this.normalizePattern(def);
    const existingIndex = this.patternMap.has(pattern.id)
      ? this.patterns.findIndex((item) => item?.id === pattern.id)
      : -1;

    if (existingIndex >= 0) {
      this.patterns[existingIndex] = pattern;
    } else {
      this.patterns.push(pattern);
      this.patternOrder.push(pattern.id);
    }
    this.patternMap.set(pattern.id, pattern);
    return pattern;
  }

  // キー区間パターンを登録する
  addKeyPattern(name, time, from, to) {
    // 既存 sample 互換のため、返り値は配列 index のまま維持する
    const pattern = this.addPattern({
      id: name,
      entryDurationMs: time,
      fromKey: from,
      toKey: to
    });
    return this.patterns.findIndex((item) => item?.id === pattern.id);
  }

  // id 指定で pattern を返す
  getPattern(id = null) {
    if (id === null || id === undefined) {
      return this.currentPattern;
    }
    return this.patternMap.get(String(id)) ?? null;
  }

  // pattern 情報を外部参照用 object として返す
  getPatternInfo(id = null) {
    const pattern = this.getPattern(id);
    return pattern ? { ...pattern } : null;
  }

  // すべての pattern を登録順で返す
  getPatterns() {
    return this.patterns.filter(Boolean).map((pattern) => ({ ...pattern }));
  }

  // pattern を削除する
  removePattern(id) {
    const patternId = String(id ?? "").trim();
    if (!this.patternMap.has(patternId)) {
      return false;
    }
    const index = this.patterns.findIndex((item) => item?.id === patternId);
    if (index >= 0) {
      this.patterns[index] = null;
    }
    this.patternMap.delete(patternId);
    this.patternOrder = this.patternOrder.filter((item) => item !== patternId);
    return true;
  }

  // pattern を全消去する
  clearPatterns() {
    this.patterns = [];
    this.patternMap.clear();
    this.patternOrder = [];
    this.currentPattern = null;
    this.currentPatternId = null;
    this.pat_index = -1;
  }

  // action を object 形式で登録する
  addActionDef(def) {
    const action = this.normalizeAction(def);
    this.actions[action.id] = action;
    return action;
  }

  // パターン列をアクション名で登録する
  addAction(name, pattern_list) {
    // 既存 API は pattern index 配列を受け取るため、
    // ここで pattern id 配列へ正規化して保持する
    return this.addActionDef({
      id: name,
      patterns: pattern_list
    });
  }

  // action を返す
  getAction(id) {
    return this.actions[String(id ?? "")] ?? null;
  }

  // すべての action を返す
  getActions() {
    return Object.values(this.actions).map((action) => ({
      id: action.id,
      patterns: [...action.patterns],
      loop: action.loop
    }));
  }

  // action を削除する
  removeAction(id) {
    const actionId = String(id ?? "");
    if (!this.actions[actionId]) {
      return false;
    }
    delete this.actions[actionId];
    return true;
  }

  // action を全消去する
  clearActions() {
    this.actions = {};
    this.currentAction = null;
    this.currentActionId = null;
  }

  // ログ出力を切り替える
  setVerbose(true_or_false) {
    this.verbose = true_or_false;
  }

  // 進行中 action の現在情報を返す
  getCurrentAction() {
    return this.currentAction;
  }

  // action 状態を要約して返す
  getActionInfo() {
    return {
      actionId: this.currentActionId,
      patternId: this.currentPatternId,
      patternIndex: this.pat_index,
      loop: this.currentAction?.loop === true,
      playing: this.playing,
      paused: this.paused
    };
  }

  // 進行中 pattern の現在情報を返す
  getCurrentPattern() {
    return this.currentPattern;
  }

  // 現在の pattern index を返す
  getCurrentPatternIndex() {
    return this.pat_index;
  }

  // 再生中か返す
  isPlaying() {
    return this.playing && !this.paused;
  }

  // pattern を単独再生する
  startPattern(patternId, options = {}) {
    const pattern = this.getPattern(patternId);
    if (!pattern) {
      return -1;
    }
    this.currentAction = null;
    this.currentActionId = null;
    this.currentPattern = pattern;
    this.currentPatternId = pattern.id;
    this.pat_index = 0;
    this.playing = true;
    this.paused = false;
    const entryDurationMs = options.entryDurationMs ?? pattern.entryDurationMs;
    return this.transitionToKey(entryDurationMs, pattern.fromKey, pattern.toKey);
  }

  // key 指定で遷移開始する
  transitionToKey(entryDurationMs, fromKey, toKey) {
    this.validatePatternRange(this.currentPatternId ?? "pattern", fromKey, toKey);
    this.anim.startTimeFromTo(entryDurationMs, fromKey, toKey);
    return fromKey * 2;
  }

  // action を新 API 名で開始する
  start(actionId, options = {}) {
    const action = this.getAction(actionId);
    if (!action) {
      if (this.verbose) {
        util.printf("action \"%s\" not found\n", actionId);
      }
      return -1;
    }
    this.currentAction = action;
    this.currentActionId = action.id;
    this.pat_index = 0;
    this.playing = true;
    this.paused = false;
    const patternId = action.patterns[this.pat_index];
    this.currentPattern = this.getPattern(patternId);
    this.currentPatternId = this.currentPattern?.id ?? null;
    if (!this.currentPattern) {
      return -1;
    }
    const entryDurationMs = options.entryDurationMs ?? this.currentPattern.entryDurationMs;
    return this.transitionToKey(
      entryDurationMs,
      this.currentPattern.fromKey,
      this.currentPattern.toKey
    );
  }

  // 指定アクション再生を開始する
  startAction(action_name) {
    return this.start(action_name);
  }

  // 進行中アクションを1ステップ更新する
  play(_deltaMs = null) {
    if (!this.playing) {
      return -1;
    }
    if (this.paused) {
      return this.currentPattern ? this.currentPattern.fromKey * 2 : -1;
    }

    // 現行 Animation は内部の Schedule が実時間差分を管理するため、
    // Action 側は今のところ delta を独自解釈せず、1ステップ進行だけ委譲する
    const ip = this.anim.play();

    if (!this.currentAction) {
      if (ip < 0) {
        this.playing = false;
      }
      return ip;
    }
    if (ip < 0) {       // end of current pattern
      this.pat_index = this.pat_index + 1;
      if (this.pat_index >= this.currentAction.patterns.length) {
        if (this.currentAction.loop) {
          this.pat_index = 0;
        } else {
          this.playing = false;
          return -1;      // end of current action
        }
      }
      const patternId = this.currentAction.patterns[this.pat_index];
      this.currentPattern = this.getPattern(patternId);
      this.currentPatternId = this.currentPattern?.id ?? null;
      if (!this.currentPattern) {
        this.playing = false;
        return -1;
      }
      return this.transitionToKey(
        this.currentPattern.entryDurationMs,
        this.currentPattern.fromKey,
        this.currentPattern.toKey
      );
    }
    return ip;
  }

  // 旧 API 名互換
  playAction() {
    return this.play();
  }

  // 停止する
  stop() {
    this.playing = false;
    this.paused = false;
    this.currentAction = null;
    this.currentActionId = null;
    this.currentPattern = null;
    this.currentPatternId = null;
    this.pat_index = -1;
    this.anim.schedule.pause = false;
    this.anim.schedule.stopped = true;
  }

  // 一時停止する
  pause() {
    this.paused = true;
    this.anim.schedule.pause = true;
  }

  // 再開する
  resume() {
    if (!this.playing) {
      return;
    }
    this.paused = false;
    this.anim.schedule.pause = false;
  }

  // パターン情報からAnimation再生を開始する
  startTimeFromTo(pat) {
    const pattern = typeof pat === "number" ? this.patterns[pat] : this.getPattern(pat);
    if (!pattern) {
      return -1;
    }
    if (this.verbose) {
      util.printf("\npattern.%2d %10s %4d msec  %2d -> %2d\n",
        this.pat_index, pattern.id, pattern.entryDurationMs, pattern.fromKey, pattern.toKey);
    }
    this.currentPattern = pattern;
    this.currentPatternId = pattern.id;
    return this.transitionToKey(
      pattern.entryDurationMs,
      pattern.fromKey,
      pattern.toKey
    );
  }

};
