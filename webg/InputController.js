// ---------------------------------------------
// InputController.js  2026/04/09
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import Touch from "./Touch.js";

// 汎用入力コントローラ:
// - キーボード入力を lower-case 化して保持
// - アプリ側へ keydown/keyup/pointerdown を通知
// - Touch.js を使った仮想ボタン入力を同じ keyState に流し込む
export default class InputController {
  constructor(doc) {
    this.doc = doc;
    this.keyState = new Set();
    this.actionMap = new Map();
    this.actionState = new Map();
    this.actionPressed = new Set();
    this.actionReleased = new Set();
    // touch の action ボタンや UI 由来の one-shot 入力を
    // 「そのフレームだけ有効な状態」として扱うための一時領域
    this.actionPulse = new Set();
    this._onKeyDown = null;
    this._onKeyUp = null;
    this._onPointerDown = null;
    this.touch = null;
    this.touchLayoutOptions = {};
    // pointerdown の既定抑止は document 全体へ広げると本文選択や link 操作を妨げやすい
    // そのため、必要なら「どの element 内だけ既定抑止するか」を app 側から渡せるようにする
    this.pointerPreventDefaultElement = null;
    this._attached = false;
  }

  // どの入力源から来ても同じ表記で扱えるように key 名を正規化する
  // - `Space` はブラウザによって `" "` として届くことがあるので `space` に寄せる
  // - `Esc` 系の短縮表記は `escape` に寄せる
  normalizeKey(key) {
    const raw = String(key ?? "").toLowerCase();
    if (raw === " " || raw === "spacebar") return "space";
    const normalized = raw.trim();
    if (!normalized) return "";
    if (normalized === "esc") return "escape";
    return normalized;
  }

  clear() {
    this.keyState.clear();
    this.actionState.clear();
    this.actionPressed.clear();
    this.actionReleased.clear();
    this.actionPulse.clear();
  }

  has(key) {
    return this.keyState.has(this.normalizeKey(key));
  }

  press(key) {
    const normalized = this.normalizeKey(key);
    if (!normalized) return false;
    const wasDown = this.keyState.has(normalized);
    this.keyState.add(normalized);
    this._syncActionStateFromKey(normalized, true, !wasDown);
    return !wasDown;
  }

  release(key) {
    const normalized = this.normalizeKey(key);
    if (!normalized) return false;
    const wasDown = this.keyState.delete(normalized);
    this._syncActionStateFromKey(normalized, false, wasDown);
    return wasDown;
  }

  // frame ごとの瞬間入力フラグをクリアする
  // pulseAction() で積んだ one-shot action もここで落として、
  // 次の frame に状態を持ち越さないようにする
  beginFrame() {
    for (const action of this.actionPulse) {
      const binding = this.actionMap.get(action);
      if (binding) {
        this.actionState.set(action, this._isActionActive(binding));
      } else {
        this.actionState.delete(action);
      }
    }
    this.actionPulse.clear();
    this.actionPressed.clear();
    this.actionReleased.clear();
  }

  // 1 frame 分の入力状態を snapshot としてまとめる
  // record 用にも replay 用にも使えるように、raw key と action edge を両方残す
  captureFrameState(meta = {}) {
    const actions = {};
    for (const [action] of this.actionMap.entries()) {
      actions[action] = {
        active: this.getAction(action),
        pressed: this.actionPressed.has(action),
        released: this.actionReleased.has(action),
        pulse: this.actionPulse.has(action)
      };
    }
    return {
      frame: Number.isFinite(meta.frame) ? Number(meta.frame) : null,
      timeMs: Number.isFinite(meta.timeMs) ? Number(meta.timeMs) : null,
      elapsedSec: Number.isFinite(meta.elapsedSec) ? Number(meta.elapsedSec) : null,
      label: String(meta.label ?? ""),
      source: String(meta.source ?? ""),
      keys: [...this.keyState],
      actionMap: this.getActionMap(),
      actions
    };
  }

  // snapshot を現在の入力状態へ戻す
  // 既存の actionMap があるならそれを優先し、空なら snapshot 側の map を採用する
  applyFrameState(frame = {}, options = {}) {
    const hasFrameActionMap = frame.actionMap && typeof frame.actionMap === "object";
    const shouldReplaceActionMap = options.replaceActionMap === true
      || (this.actionMap.size === 0 && hasFrameActionMap);
    if (shouldReplaceActionMap && hasFrameActionMap) {
      this.registerActionMap(frame.actionMap);
    } else {
      this.clear();
    }
    this.keyState.clear();
    this.actionState.clear();
    this.actionPressed.clear();
    this.actionReleased.clear();
    this.actionPulse.clear();

    const keys = Array.isArray(frame.keys) ? frame.keys : [];
    for (let i = 0; i < keys.length; i++) {
      const key = this.normalizeKey(keys[i]);
      if (key) {
        this.keyState.add(key);
      }
    }

    if (frame.actions && typeof frame.actions === "object") {
      const actionNames = Object.keys(frame.actions);
      for (let i = 0; i < actionNames.length; i++) {
        const action = this.normalizeKey(actionNames[i]);
        if (!action) continue;
        const info = frame.actions[actionNames[i]] ?? {};
        if (info.active === true) this.actionState.set(action, true);
        if (info.pressed === true) this.actionPressed.add(action);
        if (info.released === true) this.actionReleased.add(action);
        if (info.pulse === true) {
          this.actionPulse.add(action);
          this.actionState.set(action, true);
        }
      }
    }

    for (const [action, binding] of this.actionMap.entries()) {
      if (!this.actionState.has(action)) {
        this.actionState.set(action, this._isActionActive(binding));
      }
    }

    return this.captureFrameState({
      frame: frame.frame,
      timeMs: frame.timeMs,
      elapsedSec: frame.elapsedSec,
      label: frame.label,
      source: frame.source
    });
  }

  // action 名と入力キーの対応を登録する
  registerActionMap(map = {}) {
    this.actionMap.clear();
    this.actionState.clear();
    this.actionPressed.clear();
    this.actionReleased.clear();
    this.actionPulse.clear();
    const actionNames = Object.keys(map ?? {});
    for (let i = 0; i < actionNames.length; i++) {
      const action = this.normalizeKey(actionNames[i]);
      if (!action) continue;
      const binding = this._normalizeActionBinding(map[actionNames[i]]);
      this.actionMap.set(action, binding);
      this.actionState.set(action, this._isActionActive(binding));
    }
    return this.getActionMap();
  }

  // 現在の action map を読みやすい配列で返す
  getActionMap() {
    const out = {};
    for (const [action, keys] of this.actionMap.entries()) {
      out[action] = [...keys];
    }
    return out;
  }

  // action の現在押下状態を返す
  getAction(name) {
    const action = this.normalizeKey(name);
    if (!action) return false;
    if (this.actionPulse.has(action)) return true;
    if (this.actionState.get(action) === true) return true;
    return this.has(action);
  }

  // その frame で action が押されたかを返す
  wasActionPressed(name) {
    const action = this.normalizeKey(name);
    if (!action) return false;
    return this.actionPressed.has(action);
  }

  // その frame で action が離されたかを返す
  wasActionReleased(name) {
    const action = this.normalizeKey(name);
    if (!action) return false;
    return this.actionReleased.has(action);
  }

  // momentary action をその frame にだけ発火させる
  // touch の action ボタンや menu 系の one-shot 操作に使う
  // その frame の getAction() からも見えるように actionState へ反映する
  pulseAction(name) {
    const action = this.normalizeKey(name);
    if (!action) return false;
    this.actionPulse.add(action);
    this.actionState.set(action, true);
    this.actionPressed.add(action);
    return true;
  }

  // 旧名称を残しつつ、意味としては pulseAction と同じにする
  triggerAction(name) {
    return this.pulseAction(name);
  }

  // touch controls の配置先と position モードを既定値として保持する
  // canvas 埋め込みレイアウトでは、sample 側が毎回 container を渡さなくても追従できるようにする
  setTouchLayoutOptions(options = {}) {
    this.touchLayoutOptions = {
      ...this.touchLayoutOptions,
      ...(options ?? {})
    };
    return { ...this.touchLayoutOptions };
  }

  // browser や OS のショートカットは、meta / ctrl / alt を伴うことが多い
  // それらまで一律で preventDefault すると DevTools や tab 切替が止まるため、
  // 通常の gameplay 入力だけを抑止対象に絞る
  shouldPreventDefaultForKeyboardEvent(event, key, preventDefault = true) {
    if (preventDefault !== true || !key) {
      return false;
    }
    if (event?.metaKey === true || event?.ctrlKey === true || event?.altKey === true) {
      return false;
    }
    return true;
  }

  // pointerdown の既定抑止を適用する範囲を設定する
  // canvas だけで drag / long press の既定動作を止めたいときに使い、
  // 本文や panel の text selection まで巻き込まないようにする
  setPointerPreventDefaultElement(element) {
    this.pointerPreventDefaultElement = element ?? null;
    return this.pointerPreventDefaultElement;
  }

  // pointer event の既定抑止は「対象 element の内側だけ」に絞れる
  // target が未設定なら従来どおり document 全体を抑止し、
  // 明示指定がある場合だけ contains() で範囲を判定する
  shouldPreventDefaultForPointerEvent(event, preventDefault = true, element = this.pointerPreventDefaultElement) {
    if (preventDefault !== true) {
      return false;
    }
    if (!element) {
      return true;
    }
    const target = event?.target;
    if (!target) {
      return false;
    }
    if (target === element) {
      return true;
    }
    return typeof element.contains === "function" && element.contains(target);
  }

  // Touch.js を利用した仮想ボタン入力を登録する
  // groups は Touch.create と同じ定義を受け取り、
  // hold は keyState へ press/release、action は正規化後の key 名で onAction へ通知する
  installTouchControls({
    touchDeviceOnly = true,
    className = "webg-touch-root",
    groups = [],
    autoSpread = true,
    onAnyPress = null,
    onAction = null
  } = {}) {
    if (this.touch) this.touch.destroy();
    const touchLayoutOptions = { ...(this.touchLayoutOptions ?? {}) };
    this.touch = new Touch(this.doc, {
      touchDeviceOnly,
      ...touchLayoutOptions
    });
    return this.touch.create({
      className,
      groups,
      autoSpread,
      positioningMode: touchLayoutOptions.positioningMode,
      containerElement: touchLayoutOptions.containerElement,
      viewportElement: touchLayoutOptions.viewportElement,
      onAnyPress,
      onPress: ({ key }) => this.press(key),
      onRelease: ({ key }) => this.release(key),
      onAction: (info) => {
        const rawKey = info?.key ?? "";
        const key = this.normalizeKey(rawKey);
        if (!key) return;
        this.pulseAction(key);
        if (onAction) {
          onAction({
            ...(info ?? {}),
            key,
            rawKey
          });
        }
      }
    });
  }

  // 登録済みのDOMイベントを解除する
  detach() {
    // App側やテンプレート側で入力ハンドラを差し替えたいときに使う
    // 既存リスナを残したまま attach() を重ねると二重入力になるため、
    // 再設定前に必ず安全に解除できる入口を用意する
    if (!this._attached) return;
    this.doc.removeEventListener("keydown", this._onKeyDown);
    this.doc.removeEventListener("keyup", this._onKeyUp);
    this.doc.removeEventListener("pointerdown", this._onPointerDown);
    this._onKeyDown = null;
    this._onKeyUp = null;
    this._onPointerDown = null;
    this._attached = false;
  }

  attach({
    onKeyDown,
    onKeyUp,
    onPointerDown,
    preventDefault = true,
    pointerPreventDefaultElement = this.pointerPreventDefaultElement
  } = {}) {

    // ハンドラ差し替え時に二重登録を避けるため、先に旧リスナを外す
    this.detach();

    this._onKeyDown = (e) => {
      const key = this.normalizeKey(e.key);
      if (this.shouldPreventDefaultForKeyboardEvent(e, key, preventDefault)) {
        e.preventDefault();
      }
      this.press(key);
      if (onKeyDown) onKeyDown(key, e);
    };

    this._onKeyUp = (e) => {
      const key = this.normalizeKey(e.key);
      if (this.shouldPreventDefaultForKeyboardEvent(e, key, preventDefault)) {
        e.preventDefault();
      }
      this.release(key);
      if (onKeyUp) onKeyUp(key, e);
    };

    this._onPointerDown = (e) => {
      if (this.shouldPreventDefaultForPointerEvent(e, preventDefault, pointerPreventDefaultElement)) {
        e.preventDefault();
      }
      if (onPointerDown) onPointerDown(e);
    };

    this.doc.addEventListener("keydown", this._onKeyDown);
    this.doc.addEventListener("keyup", this._onKeyUp);
    this.doc.addEventListener("pointerdown", this._onPointerDown);
    this._attached = true;
  }

  _normalizeActionBinding(binding) {
    const keys = Array.isArray(binding) ? binding : [binding];
    const out = new Set();
    for (let i = 0; i < keys.length; i++) {
      const key = this.normalizeKey(keys[i]);
      if (key) out.add(key);
    }
    return out;
  }

  _resolveActionKeys(action) {
    const keys = this.actionMap.get(action);
    if (keys) return [...keys];
    return [action];
  }

  _isActionActive(keys) {
    for (const key of keys) {
      if (this.keyState.has(key)) return true;
    }
    return false;
  }

  _syncActionStateFromKey(key, isDown, changed) {
    if (!changed || !key) {
      return;
    }
    for (const [action, keys] of this.actionMap.entries()) {
      if (!keys.has(key)) continue;
      const active = this._isActionActive(keys);
      const prev = this.actionState.get(action) === true;
      this.actionState.set(action, active);
      if (isDown && !prev && active) {
        this.actionPressed.add(action);
      } else if (!isDown && prev && !active) {
        this.actionReleased.add(action);
      }
    }
  }
}
