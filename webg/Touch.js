// ---------------------------------------------
// Touch.js       2026/07/25
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import util from "./util.js";

// 汎用タッチ入力UI:
// - coarse pointer 端末向けの仮想ボタンを生成する
// - hold/action の2種を統一的に扱う
// - onPress/onRelease/onAction コールバックでアプリ側へ橋渡しする
// - 指定 element 上の flick / long press / double tap などの gesture を検出する
export default class Touch {
  constructor(doc, options = {}) {
    this.doc = doc ?? document;
    this.options = {
      touchDeviceOnly: true,
      force: false,
      styleId: "webg-touch-style",
      positioningMode: "fixed",
      containerElement: null,
      viewportElement: null,
      ...options
    };
    this.root = null;
    this.groups = [];
    this.pointerToButton = new Map();
    this.onPress = null;
    this.onRelease = null;
    this.onAction = null;
    this.onAnyPress = null;
    this.autoSpread = true;
    this.surface = null;
    this._boundReleaseAll = () => {
      this.releaseAll();
      this.cancelSurfaceGesture("blur");
    };
    window.addEventListener("blur", this._boundReleaseAll);
    this._boundApplyLayoutMode = () => {
      this.applyDensitySize();
      this.applyLayoutMode();
    };
    window.addEventListener("resize", this._boundApplyLayoutMode);
    window.addEventListener("orientationchange", this._boundApplyLayoutMode);
  }

  // グループを検証し、後続処理が扱える共通形式へ整える
  normalizeGroup(group, index) {
    if (!group || typeof group !== "object" || Array.isArray(group)) {
      throw new Error(`Touch group[${index}] must be an object`);
    }
    const buttons = Array.isArray(group.buttons) ? group.buttons : [];
    if (!Array.isArray(group.buttons)) {
      throw new Error(`Touch group[${index}].buttons must be an array`);
    }
    return {
      ...group,
      buttons: buttons.map((button, buttonIndex) => this.normalizeButton(button, index, buttonIndex))
    };
  }

  // ボタンを検証し、後続処理が扱える共通形式へ整える
  normalizeButton(button, groupIndex, buttonIndex) {
    if (!button || typeof button !== "object" || Array.isArray(button)) {
      throw new Error(`Touch group[${groupIndex}] button[${buttonIndex}] must be an object`);
    }
    if (typeof button.key !== "string" || button.key.length === 0) {
      throw new Error(`Touch group[${groupIndex}] button[${buttonIndex}] requires a non-empty string key`);
    }
    if (button.width !== undefined && (!Number.isFinite(button.width) || button.width <= 0)) {
      throw new Error(`Touch group[${groupIndex}] button[${buttonIndex}].width must be a finite number > 0`);
    }
    if (button.height !== undefined && (!Number.isFinite(button.height) || button.height <= 0)) {
      throw new Error(`Touch group[${groupIndex}] button[${buttonIndex}].height must be a finite number > 0`);
    }
    return {
      ...button,
      key: button.key
    };
  }

  // `coarse`のポインターの条件を判定し、結果を真偽値で返す
  isCoarsePointer() {
    if (this.options.force) return true;
    if (!window.matchMedia) return false;
    return window.matchMedia("(pointer: coarse)").matches;
  }

  // 有効状態の条件を判定し、結果を真偽値で返す
  isEnabled() {
    if (!this.options.touchDeviceOnly) return true;
    return this.isCoarsePointer();
  }

  // `injectDefaultStyle`は必要な画面要素を準備し、表示状態を更新する
  injectDefaultStyle() {
    if (this.doc.getElementById(this.options.styleId)) return;
    const style = this.doc.createElement("style");
    style.id = this.options.styleId;
    style.textContent = `
      .webg-touch-root {
        --webg-touch-btn-size: 52px;
        --webg-touch-action-size: 52px;
        --webg-touch-btn-font-size: 22px;
        position: fixed;
        left: 0;
        right: var(--webg-canvas-right-inset, 0px);
        bottom: 0;
        padding: 10px 12px calc(10px + env(safe-area-inset-bottom));
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        align-items: flex-end;
        row-gap: 8px;
        column-gap: 10px;
        z-index: 30;
        pointer-events: none;
        user-select: none;
        -webkit-user-select: none;
      }
      .webg-touch-root.webg-touch-multiline {
        justify-content: center;
      }
      .webg-touch-root.webg-touch-spread {
        justify-content: space-between;
      }
      .webg-touch-group {
        display: flex;
        flex-wrap: nowrap;
        gap: 8px;
        pointer-events: auto;
        flex: 0 0 auto;
      }
      .webg-touch-btn {
        width: var(--webg-touch-btn-size);
        height: var(--webg-touch-btn-size);
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.58);
        background: rgba(16, 24, 16, 0.52);
        color: #f4f7ff;
        font: 700 var(--webg-touch-btn-font-size)/1 sans-serif;
        touch-action: none;
        -webkit-tap-highlight-color: transparent;
      }
      .webg-touch-btn.webg-touch-action {
        width: var(--webg-touch-action-size);
        height: var(--webg-touch-action-size);
        border-radius: 36px;
        font-size: var(--webg-touch-btn-font-size);
        background: rgba(28, 78, 42, 0.58);
      }
      .webg-touch-btn.webg-touch-active {
        background: rgba(66, 152, 255, 0.78);
        border-color: rgba(218, 235, 255, 0.92);
      }
    `;
    this.doc.head.appendChild(style);
  }

  // このインスタンスを生成し、後続処理で利用できる状態にする
  create({
    groups = [],
    autoSpread = true,
    onPress = null,
    onRelease = null,
    onAction = null,
    onAnyPress = null,
    className = "webg-touch-root",
    positioningMode = this.options.positioningMode,
    containerElement = this.options.containerElement,
    viewportElement = this.options.viewportElement
  } = {}) {
    if (!this.isEnabled()) return null;
    this.destroy();
    this.injectDefaultStyle();

    this.onPress = onPress;
    this.onRelease = onRelease;
    this.onAction = onAction;
    this.onAnyPress = onAnyPress;

    const root = this.doc.createElement("div");
    root.className = className;
    this.root = root;
    const normalizedGroups = groups.map((group, index) => this.normalizeGroup(group, index));
    this.groups = normalizedGroups;
    this.autoSpread = autoSpread;
    this.options.positioningMode = positioningMode === "absolute" ? "absolute" : "fixed";
    this.options.containerElement = containerElement ?? this.doc.body;
    this.options.viewportElement = viewportElement ?? null;
    if (this.options.positioningMode === "absolute") {
      root.style.position = "absolute";
      root.style.left = "0px";
      root.style.right = "0px";
      root.style.bottom = "0px";
      root.style.top = "auto";
      const host = this.options.containerElement;
      if (host?.style) {
        const currentPosition = host.style.position || window.getComputedStyle(host).position;
        if (currentPosition === "static" || !currentPosition) {
          host.style.position = "relative";
        }
      }
    } else {
      root.style.position = "fixed";
      root.style.left = "0px";
      root.style.right = "var(--webg-canvas-right-inset, 0px)";
      root.style.bottom = "0px";
      root.style.top = "auto";
    }

    for (let gi = 0; gi < normalizedGroups.length; gi++) {
      const g = normalizedGroups[gi];
      const wrap = this.doc.createElement("div");
      wrap.className = `webg-touch-group ${g.className ?? ""}`.trim();
      wrap.dataset.group = g.id ?? `group_${gi}`;

      const buttons = g.buttons;
      for (let bi = 0; bi < buttons.length; bi++) {
        const b = buttons[bi];
        const key = b.key;
        const kind = b.kind === "action" ? "action" : "hold";
        const el = this.doc.createElement("button");
        el.type = "button";
        el.className = `webg-touch-btn ${kind === "action" ? "webg-touch-action" : ""} ${b.className ?? ""}`.trim();
        el.textContent = String(b.label ?? key);
        el.dataset.key = key;
        el.dataset.kind = kind;
        if (b.ariaLabel) el.setAttribute("aria-label", b.ariaLabel);
        if (b.width) el.style.width = `${b.width}px`;
        if (b.height) el.style.height = `${b.height}px`;
        if (b.width || b.height) el.dataset.touchFixedSize = "1";

        const infoFromEvent = (ev) => ({ key, kind, button: b, element: el, event: ev, touch: this });

        // `down`を受け取った段階で、対応する状態更新と処理を実行する
        const onDown = (ev) => {
          ev.preventDefault();
          if (this.onAnyPress) this.onAnyPress(infoFromEvent(ev));
          if (kind === "action") {
            el.classList.add("webg-touch-active");
            if (this.onAction) this.onAction(infoFromEvent(ev));
            return;
          }
          this.pointerToButton.set(ev.pointerId, { key, button: b, element: el });
          el.classList.add("webg-touch-active");
          if (this.onPress) this.onPress(infoFromEvent(ev));
        };

        // `up`を受け取った段階で、対応する状態更新と処理を実行する
        const onUp = (ev) => {
          ev.preventDefault();
          if (kind === "action") {
            el.classList.remove("webg-touch-active");
            return;
          }
          const mapped = this.pointerToButton.get(ev.pointerId);
          if (!mapped || mapped.element !== el) return;
          this.pointerToButton.delete(ev.pointerId);
          el.classList.remove("webg-touch-active");
          if (this.onRelease) this.onRelease(infoFromEvent(ev));
        };

        el.addEventListener("pointerdown", onDown);
        el.addEventListener("pointerup", onUp);
        el.addEventListener("pointercancel", onUp);
        el.addEventListener("pointerleave", onUp);
        wrap.appendChild(el);
      }
      root.appendChild(wrap);
    }

    (this.options.containerElement ?? this.doc.body).appendChild(root);
    this.applyDensitySize();
    this.applyLayoutMode();
    return root;
  }

  // action ボタンだけをまとめて作る簡易入口
  // sample 側では hold ボタンと分けずに、ワンショット操作群だけを
  // ひとまとめに見せたいときに使う
  createActionButtons(groups = [], options = {}) {
    const normalizedGroups = groups.map((group, index) => {
      const normalizedGroup = this.normalizeGroup(group, index);
      const buttons = normalizedGroup.buttons;
      return {
        ...normalizedGroup,
        buttons: buttons.map((button) => ({
          ...button,
          kind: "action"
        }))
      };
    });
    return this.create({
      ...options,
      groups: normalizedGroups
    });
  }

  // `surface`の設定値を検証し、後続処理が扱える共通形式へ整える
  normalizeSurfaceOptions(options = {}) {
    const out = {
      touchDeviceOnly: this.options.touchDeviceOnly,
      touchOnly: true,
      preventDefault: true,
      stopPropagation: false,
      setTouchActionNone: true,
      cancelOnPointerLeave: true,
      minDistance: 50,
      longPressTime: 500,
      longPressMoveTolerance: 10,
      tapMoveTolerance: 12,
      doubleTapTime: 320,
      doubleTapDistance: 24,
      onGesture: null,
      onFlick: null,
      onLongPress: null,
      onDoubleTap: null,
      onTap: null,
      ...options
    };
    out.minDistance = util.readOptionalFiniteNumber(out.minDistance, "Touch surface minDistance", 50, { minExclusive: 0 });
    out.longPressTime = util.readOptionalFiniteNumber(out.longPressTime, "Touch surface longPressTime", 500, { min: 0 });
    out.longPressMoveTolerance = util.readOptionalFiniteNumber(out.longPressMoveTolerance, "Touch surface longPressMoveTolerance", 10, { min: 0 });
    out.tapMoveTolerance = util.readOptionalFiniteNumber(out.tapMoveTolerance, "Touch surface tapMoveTolerance", 12, { min: 0 });
    out.doubleTapTime = util.readOptionalFiniteNumber(out.doubleTapTime, "Touch surface doubleTapTime", 320, { min: 0 });
    out.doubleTapDistance = util.readOptionalFiniteNumber(out.doubleTapDistance, "Touch surface doubleTapDistance", 24, { min: 0 });
    out.cancelOnPointerLeave = util.readOptionalBoolean(out.cancelOnPointerLeave, "Touch surface cancelOnPointerLeave", true) !== false;
    return out;
  }

  // `surface`のポインターの`allowed`の条件を判定し、結果を真偽値で返す
  isSurfacePointerAllowed(ev, options) {
    if (options.touchOnly && String(ev?.pointerType ?? "") !== "touch") {
      return false;
    }
    return true;
  }

  // `surface`の`gesture`の`info`を生成し、後続処理で利用できる状態にする
  makeSurfaceGestureInfo(type, extra = {}, event = null) {
    const surface = this.surface;
    const state = surface?.state ?? {};
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const x = Number(extra.x ?? state.lastX ?? state.startX ?? 0);
    const y = Number(extra.y ?? state.lastY ?? state.startY ?? 0);
    const dx = Number(extra.dx ?? x - Number(state.startX ?? x));
    const dy = Number(extra.dy ?? y - Number(state.startY ?? y));
    return {
      type,
      direction: extra.direction ?? null,
      x,
      y,
      startX: Number(extra.startX ?? state.startX ?? x),
      startY: Number(extra.startY ?? state.startY ?? y),
      dx,
      dy,
      distance: Number(extra.distance ?? Math.hypot(dx, dy)),
      elapsedMs: Number(extra.elapsedMs ?? now - Number(state.startTime ?? now)),
      pointerType: String(extra.pointerType ?? state.pointerType ?? event?.pointerType ?? ""),
      pointerId: extra.pointerId ?? state.pointerId ?? event?.pointerId ?? null,
      event,
      touch: this,
      surface: surface?.element ?? null
    };
  }

  // `emitSurfaceGesture`は入力またはイベントを受け取り、対応する処理へ振り分ける
  emitSurfaceGesture(type, extra = {}, event = null) {
    const options = this.surface?.options;
    if (!options) return null;
    const info = this.makeSurfaceGestureInfo(type, extra, event);
    if (options.onGesture) options.onGesture(info);
    if (type === "flick" && options.onFlick) options.onFlick(info);
    if (type === "longpress" && options.onLongPress) options.onLongPress(info);
    if (type === "doubletap" && options.onDoubleTap) options.onDoubleTap(info);
    if (type === "tap" && options.onTap) options.onTap(info);
    return info;
  }

  // `surface`の`long`の`press`の`timer`を初期状態へ戻し、前回の状態を残さない
  clearSurfaceLongPressTimer() {
    const state = this.surface?.state;
    if (!state?.longPressTimer) return;
    clearTimeout(state.longPressTimer);
    state.longPressTimer = null;
  }

  // `cancel`の`surface`の`gesture`の条件を判定し、結果を真偽値で返す
  cancelSurfaceGesture(reason = "cancel") {
    const surface = this.surface;
    if (!surface) return false;
    const state = surface.state;
    const wasActive = state.active;
    this.clearSurfaceLongPressTimer();
    state.active = false;
    state.pointerId = null;
    state.pointerType = "";
    state.startX = 0.0;
    state.startY = 0.0;
    state.lastX = 0.0;
    state.lastY = 0.0;
    state.startTime = 0.0;
    state.longPressFired = false;
    state.longPressCancelled = false;
    state.cancelReason = reason;
    return wasActive;
  }

  // `surface`の方向を現在の入力と状態から求め、呼び出し元へ返す
  getSurfaceDirection(dx, dy, minDistance) {
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    if (absX >= absY) {
      if (absX < minDistance) return null;
      return dx >= 0 ? "right" : "left";
    }
    if (absY < minDistance) return null;
    return dy >= 0 ? "down" : "up";
  }

  // `emit`の`surface`の`double`の`tap`の条件を判定し、結果を真偽値で返す
  shouldEmitSurfaceDoubleTap(x, y, now, options, pointerType) {
    const state = this.surface?.state;
    if (!state || options.doubleTapTime <= 0) return false;
    if (state.lastTapTime <= 0) return false;
    if (pointerType && state.lastTapPointerType && pointerType !== state.lastTapPointerType) return false;
    if (now - state.lastTapTime > options.doubleTapTime) return false;
    return Math.hypot(x - state.lastTapX, y - state.lastTapY) <= options.doubleTapDistance;
  }

  // `rememberSurfaceTap`は受け取った値を処理し、後続処理で利用する状態または結果を生成する
  rememberSurfaceTap(x, y, now, pointerType) {
    const state = this.surface?.state;
    if (!state) return;
    state.lastTapTime = now;
    state.lastTapX = x;
    state.lastTapY = y;
    state.lastTapPointerType = String(pointerType ?? "");
  }

  // `surface`のイベントの既定のを受け取った段階で、対応する状態更新と処理を実行する
  handleSurfaceEventDefault(ev, options) {
    if (options.preventDefault && ev?.cancelable !== false) {
      ev.preventDefault();
    }
    if (options.stopPropagation) {
      ev.stopPropagation();
    }
  }

  // `surface`を対象へ追加し、後続処理から参照できるようにする
  attachSurface(element, options = {}) {
    if (!element || typeof element.addEventListener !== "function") {
      throw new Error("Touch.attachSurface requires an event target element");
    }
    const normalized = this.normalizeSurfaceOptions(options);
    if (normalized.touchDeviceOnly && !this.isCoarsePointer()) {
      return null;
    }
    this.detachSurface();

    const state = {
      active: false,
      pointerId: null,
      pointerType: "",
      startX: 0.0,
      startY: 0.0,
      lastX: 0.0,
      lastY: 0.0,
      startTime: 0.0,
      longPressTimer: null,
      longPressFired: false,
      longPressCancelled: false,
      cancelReason: "",
      lastTapTime: 0.0,
      lastTapX: 0.0,
      lastTapY: 0.0,
      lastTapPointerType: ""
    };
    const previousTouchAction = element?.style ? element.style.touchAction : null;

    // ポインターの`down`を受け取った段階で、対応する状態更新と処理を実行する
    const onPointerDown = (ev) => {
      if (!this.isSurfacePointerAllowed(ev, normalized)) return;
      this.handleSurfaceEventDefault(ev, normalized);
      if (state.active) {
        this.cancelSurfaceGesture("multi-pointer");
        return;
      }
      state.active = true;
      state.pointerId = ev.pointerId;
      state.pointerType = String(ev.pointerType ?? "");
      state.startX = ev.clientX;
      state.startY = ev.clientY;
      state.lastX = ev.clientX;
      state.lastY = ev.clientY;
      state.startTime = typeof performance !== "undefined" ? performance.now() : Date.now();
      state.longPressFired = false;
      state.longPressCancelled = false;
      state.cancelReason = "";
      if (normalized.longPressTime >= 0) {
        this.clearSurfaceLongPressTimer();
        state.longPressTimer = setTimeout(() => {
          if (!state.active || state.longPressCancelled) return;
          state.longPressTimer = null;
          state.longPressFired = true;
          this.emitSurfaceGesture("longpress", {
            x: state.lastX,
            y: state.lastY,
            pointerType: state.pointerType,
            pointerId: state.pointerId
          }, ev);
        }, normalized.longPressTime);
      }
      element.setPointerCapture?.(ev.pointerId);
    };

    // ポインターの`move`を受け取った段階で、対応する状態更新と処理を実行する
    const onPointerMove = (ev) => {
      if (!state.active || ev.pointerId !== state.pointerId) return;
      this.handleSurfaceEventDefault(ev, normalized);
      state.lastX = ev.clientX;
      state.lastY = ev.clientY;
      const dx = state.lastX - state.startX;
      const dy = state.lastY - state.startY;
      if (!state.longPressCancelled
          && Math.hypot(dx, dy) > normalized.longPressMoveTolerance) {
        state.longPressCancelled = true;
        this.clearSurfaceLongPressTimer();
      }
    };

    // ポインターの`up`を受け取った段階で、対応する状態更新と処理を実行する
    const onPointerUp = (ev) => {
      if (!state.active || ev.pointerId !== state.pointerId) return;
      this.handleSurfaceEventDefault(ev, normalized);
      this.clearSurfaceLongPressTimer();
      state.lastX = ev.clientX;
      state.lastY = ev.clientY;
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      const dx = state.lastX - state.startX;
      const dy = state.lastY - state.startY;
      const distance = Math.hypot(dx, dy);
      const elapsedMs = now - state.startTime;
      const direction = this.getSurfaceDirection(dx, dy, normalized.minDistance);
      const longPressFired = state.longPressFired;
      const pointerType = state.pointerType;
      const pointerId = state.pointerId;
      const startX = state.startX;
      const startY = state.startY;
      const x = state.lastX;
      const y = state.lastY;

      if (element.hasPointerCapture?.(ev.pointerId)) {
        element.releasePointerCapture(ev.pointerId);
      }
      this.cancelSurfaceGesture("up");

      if (longPressFired) {
        return;
      }
      if (direction) {
        this.emitSurfaceGesture("flick", { direction, dx, dy, distance, elapsedMs, pointerType, pointerId, startX, startY, x, y }, ev);
        return;
      }
      if (distance <= normalized.tapMoveTolerance) {
        if (this.shouldEmitSurfaceDoubleTap(x, y, now, normalized, pointerType)) {
          state.lastTapTime = 0.0;
          this.emitSurfaceGesture("doubletap", { dx, dy, distance, elapsedMs, pointerType, pointerId, startX, startY, x, y }, ev);
        } else {
          this.rememberSurfaceTap(x, y, now, pointerType);
          this.emitSurfaceGesture("tap", { dx, dy, distance, elapsedMs, pointerType, pointerId, startX, startY, x, y }, ev);
        }
      }
    };

    // ポインターの`cancel`を受け取った段階で、対応する状態更新と処理を実行する
    const onPointerCancel = (ev) => {
      if (!state.active || ev.pointerId !== state.pointerId) return;
      this.handleSurfaceEventDefault(ev, normalized);
      if (element.hasPointerCapture?.(ev.pointerId)) {
        element.releasePointerCapture(ev.pointerId);
      }
      this.cancelSurfaceGesture("cancel");
    };

    if (element?.style && normalized.setTouchActionNone) {
      element.style.touchAction = "none";
    }
    element.addEventListener("pointerdown", onPointerDown);
    element.addEventListener("pointermove", onPointerMove);
    element.addEventListener("pointerup", onPointerUp);
    element.addEventListener("pointercancel", onPointerCancel);
    if (normalized.cancelOnPointerLeave) {
      element.addEventListener("pointerleave", onPointerCancel);
    }

    this.surface = {
      element,
      options: normalized,
      state,
      previousTouchAction,
      listeners: {
        onPointerDown,
        onPointerMove,
        onPointerUp,
        onPointerCancel
      }
    };
    return {
      element,
      touch: this,
      detach: () => this.detachSurface()
    };
  }

  attachGesture(element, options = {}) {
    return this.attachSurface(element, options);
  }

  // `surface`を対象から切り離し、関連する参照を整理する
  detachSurface() {
    const surface = this.surface;
    if (!surface) return false;
    const { element, listeners } = surface;
    this.cancelSurfaceGesture("detach");
    element.removeEventListener("pointerdown", listeners.onPointerDown);
    element.removeEventListener("pointermove", listeners.onPointerMove);
    element.removeEventListener("pointerup", listeners.onPointerUp);
    element.removeEventListener("pointercancel", listeners.onPointerCancel);
    if (surface.options?.cancelOnPointerLeave) {
      element.removeEventListener("pointerleave", listeners.onPointerCancel);
    }
    if (element?.style && surface.previousTouchAction !== null) {
      element.style.touchAction = surface.previousTouchAction;
    }
    this.surface = null;
    return true;
  }

  detachGesture() {
    return this.detachSurface();
  }

  // `density`のサイズを対象の状態または描画設定へ反映する
  applyDensitySize() {
    if (!this.root) return;
    const btns = this.root.querySelectorAll(".webg-touch-btn");
    const count = btns.length;
    let size = 52;
    let density = "normal";
    if (count >= 9) {
      size = 44;
      density = "compact";
    } else if (count >= 6) {
      size = 48;
      density = "dense";
    }

    this.root.dataset.touchCount = String(count);
    this.root.dataset.touchDensity = density;
    this.root.style.setProperty("--webg-touch-btn-size", `${size}px`);
    this.root.style.setProperty("--webg-touch-action-size", `${size}px`);
  }

  // 配置のモードを対象の状態または描画設定へ反映する
  applyLayoutMode() {
    if (!this.root) return;
    const rawViewportWidth = this.options.viewportElement?.clientWidth
      ?? this.root.parentElement?.clientWidth
      ?? window.innerWidth;
    if (!Number.isFinite(rawViewportWidth) || rawViewportWidth <= 0) {
      throw new Error(`Touch applyLayoutMode requires viewport width > 0: ${rawViewportWidth}`);
    }
    const viewportWidth = Math.floor(rawViewportWidth);
    const groups = this.root.querySelectorAll(".webg-touch-group");
    const rootStyle = window.getComputedStyle(this.root);
    const padLeft = util.readFiniteNumber(Number.parseFloat(rootStyle.paddingLeft), "Touch root padding-left");
    const padRight = util.readFiniteNumber(Number.parseFloat(rootStyle.paddingRight), "Touch root padding-right");
    const groupGap = util.readFiniteNumber(Number.parseFloat(rootStyle.columnGap), "Touch root column-gap");
    let estimatedWidth = padLeft + padRight;
    const groupItems = [];

    for (let gi = 0; gi < groups.length; gi++) {
      const btns = groups[gi].querySelectorAll(".webg-touch-btn");
      if (btns.length === 0) continue;
      let groupWidth = 0;
      for (let bi = 0; bi < btns.length; bi++) {
        const style = window.getComputedStyle(btns[bi]);
        groupWidth += util.readFiniteNumber(Number.parseFloat(style.width), `Touch button width[${gi}:${bi}]`);
      }
      const groupStyle = window.getComputedStyle(groups[gi]);
      const btnGap = util.readFiniteNumber(
        Number.parseFloat(groupStyle.columnGap || groupStyle.gap),
        `Touch group gap[${gi}]`
      );
      groupWidth += btnGap * Math.max(0, btns.length - 1);
      groupItems.push({ element: groups[gi], width: groupWidth, buttonCount: btns.length });
      estimatedWidth += groupWidth;
    }
    estimatedWidth += groupGap * Math.max(0, groupItems.length - 1);

    // サイズを確定した後の実幅で、単一行か複数行かを判断する
    const useMultiline = estimatedWidth > viewportWidth * 0.95;
    const spreadEligibleGroupCount = groupItems.length >= 3;
    let useSpread = false;
    if (this.autoSpread && spreadEligibleGroupCount) {
      if (!useMultiline) {
        // 1行で余白が十分あるときは左右へ展開し、中央グループを作りやすくする
        const freeWidth = viewportWidth - estimatedWidth;
        useSpread = freeWidth > viewportWidth * 0.08;
      } else {
        // 複数行時は行単位で左右展開可否を判定するため、ここでは有効化して後段へ委譲する
        useSpread = true;
      }
    }

    this.root.dataset.touchLayout = useMultiline ? "multiline" : "singleline";
    this.root.dataset.touchSpread = useSpread ? "spread" : "center";
    this.root.classList.toggle("webg-touch-multiline", useMultiline);
    this.root.classList.toggle("webg-touch-spread", useSpread);

    if (useMultiline && useSpread) {
      const availableWidth = viewportWidth * 0.95 - padLeft - padRight;
      this.applyMultilineSpreadByRows(groupItems, groupGap, availableWidth);
    } else {
      this.resetGroupInlineLayout(groupItems);
    }
  }

  // グループの`inline`の配置を初期状態へ戻し、前回の状態を残さない
  resetGroupInlineLayout(groupItems = null) {
    const items = groupItems ?? Array.from(this.root?.querySelectorAll(".webg-touch-group") ?? []).map((el) => ({ element: el }));
    for (let i = 0; i < items.length; i++) {
      const el = items[i].element;
      if (!el) continue;
      el.style.removeProperty("flex");
      el.style.removeProperty("width");
      el.style.removeProperty("flex-wrap");
      el.style.removeProperty("row-gap");
      el.style.removeProperty("justify-content");
    }
  }

  // 複数行に分かれた項目を行ごとの幅に合わせて配置する
  applyMultilineSpreadByRows(groupItems, groupGap, availableWidth) {
    this.resetGroupInlineLayout(groupItems);
    const rows = [];
    let current = [];
    let usedWidth = 0;

    for (let i = 0; i < groupItems.length; i++) {
      const item = groupItems[i];
      const need = current.length === 0 ? item.width : item.width + groupGap;
      if (current.length > 0 && usedWidth + need > availableWidth) {
        rows.push(current);
        current = [item];
        usedWidth = item.width;
      } else {
        current.push(item);
        usedWidth += need;
      }
    }
    if (current.length > 0) rows.push(current);

    // 1行に1グループだけ載るケースでは、グループ内ボタン自体を左右へ展開する
    for (let ri = 0; ri < rows.length; ri++) {
      const row = rows[ri];
      if (row.length !== 1) continue;
      const item = row[0];
      const el = item.element;
      if (!el) continue;
      el.style.flex = "1 1 100%";
      if (item.buttonCount <= 1) {
        el.style.justifyContent = "center";
        continue;
      }
      if (item.width > availableWidth) {
        // 単独行でも横幅超過する場合はグループ内で折り返してはみ出しを防ぐ
        el.style.width = "100%";
        el.style.flexWrap = "wrap";
        el.style.rowGap = "8px";
        el.style.justifyContent = "space-between";
      } else {
        el.style.justifyContent = "space-between";
      }
    }
  }

  // `all`が保持する資源と参照を安全に解放する
  releaseAll() {
    const entries = Array.from(this.pointerToButton.entries());
    this.pointerToButton.clear();
    for (let i = 0; i < entries.length; i++) {
      const [, mapped] = entries[i];
      if (mapped?.element) mapped.element.classList.remove("webg-touch-active");
      if (this.onRelease) {
        this.onRelease({
          key: mapped?.key ?? "",
          kind: "hold",
          button: mapped?.button ?? null,
          element: mapped?.element ?? null,
          event: null,
          touch: this
        });
      }
    }
  }

  // このインスタンスが保持する資源と参照を安全に解放する
  destroy() {
    this.detachSurface();
    this.releaseAll();
    if (this.root?.parentNode) {
      this.root.parentNode.removeChild(this.root);
    }
    this.root = null;
    this.groups = [];
  }
}
