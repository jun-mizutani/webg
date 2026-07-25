// ---------------------------------------------
// samples/mmodeler/MobileInputController.js  2026/05/25
//   mobile input state and gesture controller for mmodeler
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import Touch from "../../webg/Touch.js";

const DEFAULT_FLICK_OPTIONS = {
  touchMaxMs: 650.0,
  touchMinSpeedPxPerMs: 0.18,
  mouseMaxMs: 900.0,
  mouseMinSpeedPxPerMs: 0.08,
  horizontalDominance: 1.15
};

function defaultNow() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function makeCanvasClickSnapshot(ev) {
  return {
    clientX: Number(ev?.clientX ?? 0.0),
    clientY: Number(ev?.clientY ?? 0.0),
    button: Number(ev?.button ?? 0),
    pointerId: Number(ev?.pointerId ?? -1),
    pointerType: String(ev?.pointerType ?? ""),
    shiftKey: ev?.shiftKey === true,
    ctrlKey: ev?.ctrlKey === true,
    altKey: ev?.altKey === true,
    metaKey: ev?.metaKey === true,
    preventDefault: () => {}
  };
}

function makeRollGestureState() {
  return {
    pointers: new Map(),
    active: false,
    startAngle: 0.0,
    lastRoll: 0.0
  };
}

function getRollGesturePointers(state) {
  return Array.from(state.pointers.values()).slice(0, 2);
}

function getScreenAngleBetweenPointers(a, b) {
  return Math.atan2(b.y - a.y, b.x - a.x) * 180.0 / Math.PI;
}

function getRollGestureMetrics(pointers) {
  if (!Array.isArray(pointers) || pointers.length < 2) {
    return null;
  }
  const a = pointers[0];
  const b = pointers[1];
  return {
    angle: getScreenAngleBetweenPointers(a, b),
    distance: Math.hypot(b.x - a.x, b.y - a.y)
  };
}

function normalizeAngleDelta(delta) {
  let value = Number(delta);
  while (value > 180.0) value -= 360.0;
  while (value < -180.0) value += 360.0;
  return value;
}

function requireFunction(value, name) {
  if (typeof value !== "function") {
    throw new Error(`MobileInputController requires ${name}`);
  }
  return value;
}

export default class MobileInputController {
  constructor({
    isMobileProfile,
    ribbonPages,
    singleTapDelayMs = 200.0,
    doubleTapMaxMs = 250.0,
    doubleTapDistancePx = 24.0,
    flick = {},
    now = defaultNow
  } = {}) {
    this.isMobileProfile = isMobileProfile === true;
    this.ribbonPages = Array.isArray(ribbonPages) ? ribbonPages : [];
    this.singleTapDelayMs = singleTapDelayMs;
    this.doubleTapMaxMs = doubleTapMaxMs;
    this.doubleTapDistancePx = doubleTapDistancePx;
    this.flick = { ...DEFAULT_FLICK_OPTIONS, ...flick };
    this.now = requireFunction(now, "now");

    this.ribbonPageIndex = 0;
    this.boxSelectArmed = false;
    this.selectionShiftActive = false;
    this.touch = null;
    this.gestureAttached = false;
    this.lastGesture = "-";
    this.lastGesturePointer = "-";
    this.lastCanvasTapTime = 0;
    this.lastCanvasTapX = 0.0;
    this.lastCanvasTapY = 0.0;
    this.lastCanvasTapPointerType = "";
    this.pendingCanvasTapTimer = null;
    this.pendingCanvasTapEvent = null;
    this.primitiveSegments = 12;
    this.transformAxisConstraint = null;
    this.rollGesture = null;
    this.flickPointer = null;
    this.lastFlickPointerId = null;
    this.lastFlickTime = 0;
    this.suppressMobileButtonPointerId = null;
    this.suppressMobileButtonUntil = 0;
    this.suppressCanvasPointerId = null;
    this.suppressCanvasPointerUntil = 0;

    this.services = {};
  }

  setServices(services = {}) {
    this.services = { ...this.services, ...services };
    return this;
  }

  get currentRibbonPage() {
    return this.ribbonPages[this.ribbonPageIndex] ?? this.ribbonPages[0] ?? { name: "-", actions: [] };
  }

  get isRollActive() {
    return this.rollGesture?.active === true;
  }

  toggleSelectionShift() {
    this.selectionShiftActive = !this.selectionShiftActive;
    this.services.setMessage?.(`selection shift ${this.selectionShiftActive ? "on" : "off"}`);
    this.services.updateMobileRibbon?.();
  }

  setPrimitiveSegments(segments) {
    this.primitiveSegments = Number(segments);
  }

  clearTransformAxis() {
    this.transformAxisConstraint = null;
  }

  toggleTransformAxis(axis) {
    const normalized = axis === "x" || axis === "y" || axis === "z" || axis === "n" ? axis : null;
    this.transformAxisConstraint = this.transformAxisConstraint === normalized ? null : normalized;
    this.services.renderMobilePalette?.();
    const label = this.transformAxisConstraint === "n"
      ? "Normal"
      : (this.transformAxisConstraint?.toUpperCase?.() ?? "free");
    this.services.setMessage?.(`transform axis ${label}`);
  }

  cycleRibbonPage(step) {
    const count = this.ribbonPages.length;
    if (count <= 0) {
      return;
    }
    this.ribbonPageIndex = (this.ribbonPageIndex + step + count) % count;
    this.services.updateMobileRibbon?.();
    this.services.setMessage?.(`ribbon: ${this.currentRibbonPage.name.toLowerCase()}`);
  }

  armBoxSelect(canvasClick = null) {
    if (!this.isMobileProfile) {
      return;
    }
    this.cancelPendingTap();
    this.services.clearBoxSelectSession?.();
    this.boxSelectArmed = true;
    if (canvasClick?.active) {
      canvasClick.additive = true;
      canvasClick.allowRectangle = true;
    }
    this.services.setMobileOrbitEnabled?.(false);
    this.services.closeMobilePalette?.();
    this.services.setMessage?.("box select armed: drag to add selection");
  }

  disarmBoxSelect() {
    if (!this.isMobileProfile) {
      return;
    }
    this.services.clearBoxSelectSession?.();
    this.boxSelectArmed = false;
    this.services.setMobileOrbitEnabled?.(true);
  }

  confirmBoxSelectPreview({ resetCanvasClick } = {}) {
    if (!this.services.isBoxSelectAwaitingConfirm?.()) {
      return false;
    }
    resetCanvasClick?.({ forceHidePreview: true });
    const confirmed = this.services.confirmBoxSelectSession?.() === true;
    if (!confirmed) {
      return false;
    }
    this.boxSelectArmed = false;
    return true;
  }

  rememberCanvasTap(ev) {
    if (!this.isMobileProfile) {
      return;
    }
    this.lastCanvasTapTime = this.now();
    this.lastCanvasTapX = Number(ev?.clientX ?? 0.0);
    this.lastCanvasTapY = Number(ev?.clientY ?? 0.0);
    this.lastCanvasTapPointerType = String(ev?.pointerType ?? "");
  }

  cancelPendingTap() {
    if (this.pendingCanvasTapTimer !== null) {
      clearTimeout(this.pendingCanvasTapTimer);
    }
    this.pendingCanvasTapTimer = null;
    this.pendingCanvasTapEvent = null;
  }

  scheduleCanvasTap(ev, handleCanvasClick) {
    if (!this.isMobileProfile) {
      handleCanvasClick(ev);
      return;
    }
    this.cancelPendingTap();
    const snapshot = makeCanvasClickSnapshot(ev);
    this.pendingCanvasTapEvent = snapshot;
    this.pendingCanvasTapTimer = setTimeout(() => {
      const pending = this.pendingCanvasTapEvent;
      this.pendingCanvasTapTimer = null;
      this.pendingCanvasTapEvent = null;
      if (!pending || this.services.isTransformActive?.() || this.services.isCommandPaletteOpen?.() || this.boxSelectArmed) {
        return;
      }
      handleCanvasClick(pending);
    }, this.singleTapDelayMs);
  }

  isCanvasDoubleTapCandidate(ev) {
    if (!this.isMobileProfile || this.boxSelectArmed || this.services.isTransformActive?.()) {
      return false;
    }
    if ((this.now() - this.lastCanvasTapTime) > this.doubleTapMaxMs) {
      return false;
    }
    if (String(ev?.pointerType ?? "") !== this.lastCanvasTapPointerType) {
      return false;
    }
    const distance = Math.hypot(
      Number(ev?.clientX ?? 0.0) - this.lastCanvasTapX,
      Number(ev?.clientY ?? 0.0) - this.lastCanvasTapY
    );
    return distance <= this.doubleTapDistancePx;
  }

  handleCanvasDoubleTap(ev, { canvasClick = null } = {}) {
    this.cancelPendingTap();
    this.disarmBoxSelect();
    const hit = this.services.inspectGestureTarget?.(ev.clientX, ev.clientY) ?? { kind: "empty" };
    if (hit.kind === "empty") {
      if (this.services.hasAnyModelerVertices?.()) {
        this.armBoxSelect(canvasClick);
        this.services.setMessage?.("box select armed: drag to add selection");
      } else {
        this.services.openMobilePalette?.("empty-scene", ev.clientX, ev.clientY);
        this.services.setMessage?.("command palette");
      }
      return;
    }
    this.services.openMobilePalette?.("selection", ev.clientX, ev.clientY);
    this.services.setMessage?.("command palette");
  }

  shouldAcceptFlickShortcut(gesture) {
    if (this.services.isTransformActive?.() || this.boxSelectArmed) {
      return false;
    }
    if (gesture.direction !== "left" && gesture.direction !== "right") {
      return false;
    }
    const elapsedMs = Number(gesture.elapsedMs);
    const distance = Number(gesture.distance);
    const dx = Number(gesture.dx);
    const dy = Number(gesture.dy);
    const isMousePointer = String(gesture.pointerType ?? "") === "mouse";
    const maxMs = isMousePointer ? this.flick.mouseMaxMs : this.flick.touchMaxMs;
    const minSpeed = isMousePointer ? this.flick.mouseMinSpeedPxPerMs : this.flick.touchMinSpeedPxPerMs;
    if (!Number.isFinite(elapsedMs) || elapsedMs <= 0.0) {
      return false;
    }
    if (!Number.isFinite(distance) || distance <= 0.0) {
      return false;
    }
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
      return false;
    }
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    if (absX < absY * this.flick.horizontalDominance) {
      return false;
    }
    return elapsedMs <= maxMs && (distance / elapsedMs) >= minSpeed;
  }

  formatGestureMotion(gesture) {
    const elapsedMs = Number(gesture.elapsedMs);
    const distance = Number(gesture.distance);
    if (!Number.isFinite(elapsedMs) || elapsedMs <= 0.0
        || !Number.isFinite(distance) || distance < 0.0) {
      return "";
    }
    const speed = distance / elapsedMs;
    return ` ${Math.round(elapsedMs)}ms ${speed.toFixed(2)}px/ms`;
  }

  executeFlickShortcut(gesture, source) {
    const now = this.now();
    if (this.lastFlickPointerId === gesture.pointerId && (now - this.lastFlickTime) < 120.0) {
      return true;
    }
    this.lastFlickPointerId = gesture.pointerId;
    this.lastFlickTime = now;
    this.lastGesture = `flick:${gesture.direction || "-"}:${source}${this.formatGestureMotion(gesture)}`;
    this.lastGesturePointer = gesture.pointerType || "-";
    this.suppressMobileButtonPointerId = Number.isInteger(gesture.pointerId) ? gesture.pointerId : null;
    this.suppressMobileButtonUntil = now + 320.0;
    this.suppressNextCanvasPointer(gesture.pointerId);
    if (this.services.isCommandPaletteOpen?.()) {
      this.services.closeMobilePalette?.();
    }
    if (gesture.direction === "left") {
      this.cycleRibbonPage(1);
    } else if (gesture.direction === "right") {
      this.cycleRibbonPage(-1);
    }
    return true;
  }

  installRawFlickHandlers() {
    const isMobileRibbonTarget = (target) => {
      if (typeof target?.closest !== "function") {
        return false;
      }
      return Boolean(target.closest(".mobile-ribbon"));
    };
    const begin = (ev) => {
      if (!this.isMobileProfile || this.services.isTransformActive?.() || this.boxSelectArmed) {
        this.flickPointer = null;
        return;
      }
      if (!isMobileRibbonTarget(ev.target)) {
        this.flickPointer = null;
        return;
      }
      if (String(ev.pointerType ?? "") !== "touch" && ev.button !== 0) {
        this.flickPointer = null;
        return;
      }
      this.flickPointer = {
        pointerId: ev.pointerId,
        pointerType: String(ev.pointerType ?? ""),
        startX: ev.clientX,
        startY: ev.clientY,
        lastX: ev.clientX,
        lastY: ev.clientY,
        startTime: this.now()
      };
      const targetName = ev.target?.tagName ? String(ev.target.tagName).toLowerCase() : "-";
      this.lastGesture = `rawstart:${this.flickPointer.pointerType || "-"}:${targetName}`;
      this.lastGesturePointer = this.flickPointer.pointerType || "-";
    };
    const move = (ev) => {
      const state = this.flickPointer;
      if (!state || ev.pointerId !== state.pointerId) {
        return;
      }
      state.lastX = ev.clientX;
      state.lastY = ev.clientY;
    };
    const end = (ev) => {
      const state = this.flickPointer;
      if (!state || ev.pointerId !== state.pointerId) {
        return;
      }
      this.flickPointer = null;
      const x = ev.clientX;
      const y = ev.clientY;
      const dx = x - state.startX;
      const dy = y - state.startY;
      const distance = Math.hypot(dx, dy);
      const direction = Math.abs(dx) >= Math.abs(dy)
        ? (dx >= 0.0 ? "right" : "left")
        : (dy >= 0.0 ? "down" : "up");
      const gesture = {
        direction,
        x,
        y,
        startX: state.startX,
        startY: state.startY,
        dx,
        dy,
        distance,
        elapsedMs: this.now() - state.startTime,
        pointerType: state.pointerType,
        pointerId: state.pointerId
      };
      if (!this.shouldAcceptFlickShortcut(gesture)) {
        this.lastGesture = `rawdrag:${gesture.direction || "-"}${this.formatGestureMotion(gesture)}`;
        this.lastGesturePointer = gesture.pointerType || "-";
        return;
      }
      this.executeFlickShortcut(gesture, "raw");
      if (ev.cancelable !== false) {
        ev.preventDefault();
      }
    };
    const cancel = (ev) => {
      const state = this.flickPointer;
      if (state && ev.pointerId === state.pointerId) {
        this.flickPointer = null;
        this.lastGesture = "rawcancel";
        this.lastGesturePointer = state.pointerType || "-";
      }
    };
    window.addEventListener("pointerdown", begin, true);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", end, true);
    window.addEventListener("pointercancel", cancel, true);
  }

  beginRollGesture(state) {
    const pointers = getRollGesturePointers(state);
    const orbit = this.services.getOrbit?.();
    const metrics = getRollGestureMetrics(pointers);
    if (pointers.length < 2 || !orbit?.orbit || !metrics || !Number.isFinite(metrics.distance) || metrics.distance <= 0.0) {
      return false;
    }
    if (this.services.isTransformActive?.() || this.boxSelectArmed
        || this.services.isBoxSelectAwaitingConfirm?.() || this.services.isCommandPaletteOpen?.()) {
      return false;
    }
    // 2 本指入力は EyeRig の pan / pinch と同時に使う
    // ここでは入力を奪わず、角度差だけを lookRoll へ加算するための基準角度を保存する
    this.services.resetCanvasClick?.();
    state.active = true;
    state.startAngle = metrics.angle;
    state.lastRoll = Number(orbit.orbit.lookRoll ?? 0.0);
    this.lastGesture = "roll:start";
    this.lastGesturePointer = "touch";
    return true;
  }

  updateRollGesture(state, ev = null) {
    const orbit = this.services.getOrbit?.();
    const app = this.services.getApp?.();
    if (!state.active || !orbit?.orbit) {
      return;
    }
    const pointers = getRollGesturePointers(state);
    if (pointers.length < 2) {
      return;
    }
    const metrics = getRollGestureMetrics(pointers);
    if (!metrics) {
      return;
    }
    const delta = normalizeAngleDelta(metrics.angle - state.startAngle);
    const nextRoll = Number(orbit.orbit.lookRoll ?? 0.0) + delta;
    // EyeRig の orbit.roll は camera 位置を支える rod 側の回転であり、
    // 画面中心を軸に視野そのものを傾ける操作にはならない
    // 2 本指 roll gesture は eye 側の lookRoll を動かし、camera target / distance は維持する
    orbit.setLookAngles(orbit.orbit.lookYaw, orbit.orbit.lookPitch, nextRoll);
    orbit.apply?.(true);
    app?.syncCameraFromEyeRig?.(orbit);
    state.startAngle = metrics.angle;
    state.lastRoll = nextRoll;
    this.lastGesture = `roll:${delta.toFixed(1)}`;
    this.lastGesturePointer = String(ev?.pointerType ?? "touch");
  }

  finishRollGesture(state, canceled = false) {
    if (!state.active) {
      return;
    }
    const orbit = this.services.getOrbit?.();
    const app = this.services.getApp?.();
    state.active = false;
    app?.syncCameraFromEyeRig?.(orbit);
    this.lastGesture = canceled ? "roll:cancel" : `roll:end:${state.lastRoll.toFixed(1)}`;
    this.lastGesturePointer = "touch";
  }

  installTwoFingerRollGesture(canvas) {
    if (!canvas || !this.isMobileProfile) {
      return;
    }
    const state = makeRollGestureState();
    this.rollGesture = state;

    const onPointerDown = (ev) => {
      if (String(ev.pointerType ?? "") !== "touch") {
        return;
      }
      state.pointers.set(ev.pointerId, {
        id: ev.pointerId,
        x: Number(ev.clientX),
        y: Number(ev.clientY)
      });
      if (state.pointers.size === 2) {
        this.beginRollGesture(state);
      }
    };

    const onPointerMove = (ev) => {
      if (String(ev.pointerType ?? "") !== "touch" || !state.pointers.has(ev.pointerId)) {
        return;
      }
      state.pointers.set(ev.pointerId, {
        id: ev.pointerId,
        x: Number(ev.clientX),
        y: Number(ev.clientY)
      });
      if (state.active) {
        this.updateRollGesture(state, ev);
      } else if (state.pointers.size >= 2) {
        this.beginRollGesture(state);
      }
    };

    const onPointerEnd = (ev) => {
      if (String(ev.pointerType ?? "") !== "touch" || !state.pointers.has(ev.pointerId)) {
        return;
      }
      const wasActive = state.active;
      state.pointers.delete(ev.pointerId);
      if (wasActive && state.pointers.size < 2) {
        this.finishRollGesture(state, ev.type === "pointercancel");
      } else if (!wasActive && state.pointers.size === 1) {
        this.beginRollGesture(state);
      }
    };

    canvas.addEventListener("pointerdown", onPointerDown, true);
    canvas.addEventListener("pointermove", onPointerMove, true);
    canvas.addEventListener("pointerup", onPointerEnd, true);
    canvas.addEventListener("pointercancel", onPointerEnd, true);
  }

  shouldSuppressMobileButtonActivation(ev = null) {
    const now = this.now();
    if (now > this.suppressMobileButtonUntil) {
      this.suppressMobileButtonPointerId = null;
      this.suppressMobileButtonUntil = 0;
      return false;
    }
    if (this.suppressMobileButtonPointerId === null) {
      return true;
    }
    return ev?.pointerId === this.suppressMobileButtonPointerId;
  }

  suppressNextCanvasPointer(pointerId = null, durationMs = 520) {
    const now = this.now();
    this.suppressCanvasPointerId = Number.isInteger(pointerId) ? pointerId : null;
    this.suppressCanvasPointerUntil = now + durationMs;
  }

  shouldSuppressCanvasPointer(ev) {
    const now = this.now();
    if (now > this.suppressCanvasPointerUntil) {
      this.suppressCanvasPointerId = null;
      this.suppressCanvasPointerUntil = 0;
      return false;
    }
    if (this.suppressCanvasPointerId === null) {
      return true;
    }
    return ev.pointerId === this.suppressCanvasPointerId;
  }

  clearCanvasSuppression() {
    this.suppressCanvasPointerId = null;
    this.suppressCanvasPointerUntil = 0;
  }

  installSurfaceGestures(canvas, {
    setEditorMode,
    isEditMode,
    editModeName,
    objectModeName,
    editModeController
  } = {}) {
    if (!this.isMobileProfile || !canvas) {
      return;
    }
    canvas.style.touchAction = "none";
    this.touch?.detach?.();
    this.gestureAttached = false;
    const touch = new Touch(document, {
      touchDeviceOnly: false
    });
    this.touch = touch.attachSurface(canvas, {
      touchDeviceOnly: false,
      touchOnly: false,
      cancelOnPointerLeave: false,
      longPressTime: 360,
      minDistance: 56,
      onDoubleTap: (gesture) => {
        this.cancelPendingTap();
        this.lastGesture = "doubletap";
        this.lastGesturePointer = gesture.pointerType || "-";
        if (this.boxSelectArmed || this.services.isBoxSelectAwaitingConfirm?.()) {
          this.suppressNextCanvasPointer(gesture.pointerId);
          this.disarmBoxSelect();
          this.services.setMessage?.("box select canceled");
        }
      },
      onLongPress: (gesture) => {
        this.cancelPendingTap();
        this.lastGesture = "longpress";
        this.lastGesturePointer = gesture.pointerType || "-";
        if (this.services.isTransformActive?.()) {
          return;
        }
        this.suppressNextCanvasPointer(gesture.pointerId);
        if (editModeController?.getLoopCutPreview().active) {
          this.services.setMessage?.("confirm or cancel loop cut before switching mode");
          return;
        }
        if (editModeController?.getChainSelectPreview().active) {
          this.services.setMessage?.("confirm or cancel Chain Select before switching mode");
          return;
        }
        if (this.boxSelectArmed || this.services.isBoxSelectAwaitingConfirm?.()) {
          this.disarmBoxSelect();
          this.services.setMessage?.("box select canceled");
          return;
        }
        this.disarmBoxSelect();
        const hit = this.services.inspectGestureTarget?.(gesture.x, gesture.y) ?? { kind: "empty" };
        if (hit.kind === "empty") {
          this.services.setMessage?.("empty long press");
          return;
        }
        setEditorMode?.(isEditMode?.() ? objectModeName : editModeName);
      },
      onFlick: null
    });
    this.gestureAttached = Boolean(this.touch);
    this.installRawFlickHandlers();
    this.installTwoFingerRollGesture(canvas);
  }
}
