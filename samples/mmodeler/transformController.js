// ---------------------------------------------
// samples/mmodeler/transformController.js  2026/05/24
//   mmodeler transform controller
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import { add3, dot3, mul3 } from "./math3d.js";

// mouse move preview 型の G/R/S/E transform controller を作る
// services は一時的な依存集合であり、transform の session 化を進める過程で小さく分解する予定
export function createTransformController(services) {
  const state = {
    mode: null,
    active: false,
    pointerId: null,
    startX: 0.0,
    startY: 0.0,
    segmentStartX: 0.0,
    segmentStartY: 0.0,
    segmentChanged: false,
    lastX: 0.0,
    lastY: 0.0,
    hasPointer: false,
    basis: null,
    axisConstraint: null,
    initialObjectTransforms: new Map(),
    targetKind: null,
    historyTransaction: null,
    changed: false
  };

  // transformController の mode 表示名を UI へ中継する
  function getTransformModeLabel(mode) {
    if (mode === "move") return "move";
    if (mode === "rotate") return "rotate";
    if (mode === "scale") return "scale";
    if (mode === "extrude") return "extrude";
    if (mode === "edge-slide") return "edge slide";
    return "-";
  }

  // transform 開始時の基準 mouse 座標を現在位置または canvas 中心から決める
  function getTransformStartPoint() {
    if (state.hasPointer) {
      return [state.lastX, state.lastY];
    }
    const rect = services.getCanvas().getBoundingClientRect();
    return [
      rect.left + rect.width * 0.5,
      rect.top + rect.height * 0.5
    ];
  }

  // transformController の mode 開始を UI へ中継する
  function setTransformMode(mode) {
    const normalized = mode === "move" || mode === "rotate" || mode === "scale" || mode === "extrude" || mode === "edge-slide"
      ? mode
      : null;
    if (!normalized) {
      // transformController の cancel を UI へ中継する
      cancelTransformMode();
      return true;
    }
    if (!services.isEditMode() && normalized === "extrude") {
      services.setMessage("switch to edit mode before extrude");
      return false;
    }
    if (!services.isEditMode() && normalized === "edge-slide") {
      services.setMessage("switch to edit mode before edge slide");
      return false;
    }
    if (state.active) {
      // transformController の cancel を UI へ中継する
      cancelTransformMode();
    }
    const objectTransform = !services.isEditMode() && (normalized === "move" || normalized === "rotate" || normalized === "scale");
    const targetObjects = objectTransform ? (services.getTransformTargetObjects?.() ?? []) : [];
    if (objectTransform && targetObjects.length === 0) {
      services.setMessage(`select object before ${getTransformModeLabel(normalized)}`);
      return false;
    }
    services.focusModelerCanvas();
    const [startX, startY] = getTransformStartPoint();
    const historyTransaction = services.beginTransformTransaction(`${getTransformModeLabel(normalized)} transform`);
    let targetKind = null;
    if (objectTransform) {
      state.initialObjectTransforms = services.createObjectTransformSnapshot(targetObjects);
      targetKind = "object";
    } else {
      if (!services.startEditTransformSession(normalized)) {
        services.rollbackTransformTransaction(historyTransaction);
        return false;
      }
      targetKind = "edit";
    }
    state.mode = normalized;
    state.active = true;
    state.pointerId = null;
    state.startX = startX;
    state.startY = startY;
    state.segmentStartX = startX;
    state.segmentStartY = startY;
    state.segmentChanged = false;
    state.basis = services.getCameraScreenBasis();
    state.axisConstraint = null;
    state.targetKind = targetKind;
    state.historyTransaction = historyTransaction;
    state.changed = false;
    services.setMessage(`${getTransformModeLabel(normalized)} mode: move mouse, left click confirm`);
    return true;
  }

  // transform 開始時 snapshot を復元して preview 変更を取り消す
  function restoreTransformStart() {
    services.restoreTransformStartSnapshot(state.historyTransaction);
  }

  function hasTransformChanged() {
    return getTransformTargetKind() === "edit"
      ? services.hasEditTransformChanged()
      : state.changed;
  }

  function getTransformTargetKind() {
    return state.targetKind;
  }

  function hasTransformSegmentChanged() {
    return getTransformTargetKind() === "edit"
      ? services.hasEditTransformSegmentChanged()
      : state.segmentChanged;
  }

  function markObjectTransformSegmentChanged() {
    state.segmentChanged = true;
  }

  // transform session の終了時に pointer / preview / constraint state を初期状態へ戻す
  // cancel と confirm のどちらでも同じ後始末を行い、履歴の扱いだけを各処理側に残す
  function resetTransformSessionState(editSessionEnd) {
    const targetKind = getTransformTargetKind();
    state.mode = null;
    state.active = false;
    state.pointerId = null;
    state.segmentStartX = 0.0;
    state.segmentStartY = 0.0;
    state.segmentChanged = false;
    state.basis = null;
    state.axisConstraint = null;
    state.initialObjectTransforms = new Map();
    state.targetKind = null;
    state.historyTransaction = null;
    state.changed = false;
    if (targetKind === "edit") {
      if (editSessionEnd === "confirm") {
        services.confirmEditTransformSession();
      } else {
        services.cancelEditTransformSession();
      }
    }
  }

  // transformController の cancel を UI へ中継する
  function cancelTransformMode() {
    const hadMode = state.mode !== null || state.active;
    if (state.active && (hasTransformChanged() || state.mode === "extrude")) {
      // transform 開始時 snapshot を復元して preview 変更を取り消す
      restoreTransformStart();
    }
    if (state.active) {
      services.rollbackTransformTransaction(state.historyTransaction);
    }
    resetTransformSessionState("cancel");
    if (hadMode) {
      services.setMessage("transform cancelled");
    }
    return hadMode;
  }

  // transformController の confirm を UI へ中継する
  function confirmTransformMode() {
    if (!state.active) {
      return false;
    }
    const mode = state.mode;
    if (!hasTransformChanged()) {
      if (mode === "extrude") {
        // transform 開始時 snapshot を復元して preview 変更を取り消す
        restoreTransformStart();
      }
      services.rollbackTransformTransaction(state.historyTransaction);
    }
    resetTransformSessionState("confirm");
    services.setMessage(`${getTransformModeLabel(mode)} confirmed`);
    return true;
  }

  // mobile touch では pointerup を確定ではなく 1 drag segment の終了として扱う
  // 現在の preview を次 segment の基準へ移し、tap で明示 confirm できるようにする
  function finishTransformDragSegment() {
    const objectTransformObjects = Array.from(state.initialObjectTransforms.keys());
    if (objectTransformObjects.length > 0) {
      state.initialObjectTransforms = services.createObjectTransformSnapshot(objectTransformObjects);
    }
    if (getTransformTargetKind() === "edit") {
      services.finishEditTransformDragSegment();
    }
    state.pointerId = null;
    state.segmentChanged = false;
    services.setMessage(`${getTransformModeLabel(state.mode)} segment ended: tap to confirm`);
  }

  // axis constraint の内部表現を world axis vector へ変換する
  // `null` は制限なし、`x/y/z` は world X/Y/Z 軸だけへ transform preview を制限する
  function getConstraintAxisVector(axisConstraint) {
    if (axisConstraint === "x") return [1.0, 0.0, 0.0];
    if (axisConstraint === "y") return [0.0, 1.0, 0.0];
    if (axisConstraint === "z") return [0.0, 0.0, 1.0];
    return null;
  }

  // 画面上の drag 量を指定 world axis 上の移動量へ変換する
  // 軸が画面上でどちらへ見えているかを camera basis へ投影し、その方向の drag 成分だけを使う
  function makeAxisMoveDelta(axis, dx, dy, worldPerPixel) {
    const screenX = dot3(axis, state.basis.right);
    const screenY = dot3(axis, state.basis.up);
    const screenLen = Math.hypot(screenX, screenY);
    if (screenLen <= 1.0e-6) {
      return [0.0, 0.0, 0.0];
    }
    const pixelsAlongAxis = (dx * screenX + (-dy) * screenY) / screenLen;
    return mul3(axis, pixelsAlongAxis * worldPerPixel);
  }

  // palette や keyboard から transform の軸制限を切り替える
  function setTransformAxis(axis) {
    if (!state.active) {
      return false;
    }
    const normalized = axis === "x" || axis === "y" || axis === "z" || axis === "n" ? axis : null;
    const targetKind = getTransformTargetKind();
    const objectAxis = normalized === "n" ? null : normalized;
    const axisConstraint = targetKind === "edit"
      ? services.toggleEditTransformAxisConstraint(normalized)
      : (state.axisConstraint = state.axisConstraint === objectAxis ? null : objectAxis);
    const label = axisConstraint === "n"
      ? "Normal"
      : (axisConstraint?.toUpperCase?.() ?? "free");
    services.setMessage(`${getTransformModeLabel(state.mode)} axis ${label}`);
    return true;
  }

  function makePointerDragInput(clientX, clientY) {
    const canvas = services.getCanvas();
    const rect = canvas.getBoundingClientRect();
    const dx = clientX - state.startX;
    const dy = clientY - state.startY;
    const basis = state.basis;
    return {
      basis,
      dx,
      dy,
      rect
    };
  }

  function makeObjectTransformDragInput(clientX, clientY) {
    const input = makePointerDragInput(clientX, clientY);
    const bounds = services.getEditorBounds();
    const worldPerPixel = Math.max(0.002, bounds.size / Math.max(160.0, Math.min(input.rect.width, input.rect.height)));
    const moveDelta = add3(
      // vec3 を scalar 倍する
      mul3(input.basis.right, input.dx * worldPerPixel),
      // vec3 を scalar 倍する
      mul3(input.basis.up, -input.dy * worldPerPixel)
    );
    const axis = getConstraintAxisVector(state.axisConstraint);
    const constrainedMoveDelta = axis
      ? makeAxisMoveDelta(axis, input.dx, input.dy, worldPerPixel)
      : moveDelta;
    return {
      ...input,
      axis,
      constrainedMoveDelta,
      worldPerPixel
    };
  }

  function applyObjectTransformDragPreview(clientX, clientY) {
    const objects = Array.from(state.initialObjectTransforms.keys());
    if (objects.length === 0) {
      return;
    }
    if (Math.hypot(clientX - state.segmentStartX, clientY - state.segmentStartY) > 3.0) {
      markObjectTransformSegmentChanged();
    }
    const input = makeObjectTransformDragInput(clientX, clientY);
    services.applyObjectTransformPreview({
      mode: state.mode,
      objects,
      initialTransforms: state.initialObjectTransforms,
      axis: input.axis,
      basis: input.basis,
      dx: input.dx,
      dy: input.dy,
      constrainedMoveDelta: input.constrainedMoveDelta
    });
    state.changed = true;
    markObjectTransformSegmentChanged();
  }

  function applyEditTransformDragPreview(clientX, clientY) {
    const input = makePointerDragInput(clientX, clientY);
    services.applyEditTransformDrag({
      basis: input.basis,
      dx: input.dx,
      dy: input.dy,
      viewportHeight: input.rect.height,
      viewportWidth: input.rect.width
    });
  }

  // transformController の preview 更新を UI へ中継する
  function applyTransformDrag(clientX, clientY) {
    const targetKind = getTransformTargetKind();
    if (targetKind === null || !state.basis) {
      return;
    }
    if (targetKind === "object") {
      applyObjectTransformDragPreview(clientX, clientY);
    } else {
      applyEditTransformDragPreview(clientX, clientY);
    }
  }

  // transformController の pointer bridge を登録する
  function installTransformPointerBridge(canvas) {
    // transform 中の pointer event を通常選択や camera 操作へ流さないよう止める
    const stopTransformEvent = (ev) => {
      ev.preventDefault();
      ev.stopImmediatePropagation();
    };
    // transform mode に入る前の最新 mouse 座標を開始基準として保持する
    const rememberPointer = (ev) => {
      state.lastX = ev.clientX;
      state.lastY = ev.clientY;
      state.hasPointer = true;
    };
    // 左クリックは確定、右クリックは cancel として capture phase で先に処理する
    // touch pointer は押した瞬間を確定に使うと drag preview に入れないため、
    // pointerdown では操作対象を記録し、pointermove で preview、pointerup で確定する
    const onPointerDownCapture = (ev) => {
      rememberPointer(ev);
      if (!state.active) {
        return;
      }
      if (String(ev.pointerType ?? "") === "touch") {
        state.pointerId = ev.pointerId;
        state.startX = ev.clientX;
        state.startY = ev.clientY;
        state.segmentStartX = ev.clientX;
        state.segmentStartY = ev.clientY;
        state.segmentChanged = false;
        stopTransformEvent(ev);
        return;
      }
      if (ev.button === 0) {
        confirmTransformMode();
        stopTransformEvent(ev);
      } else if (ev.button === 2) {
        cancelTransformMode();
        stopTransformEvent(ev);
      }
    };
    // transform active 中は mouse move を preview 更新として扱う
    const onPointerMoveCapture = (ev) => {
      rememberPointer(ev);
      if (!state.active) {
        return;
      }
      if (state.pointerId !== null && ev.pointerId !== state.pointerId) {
        return;
      }
      applyTransformDrag(ev.clientX, ev.clientY);
      stopTransformEvent(ev);
    };
    const onPointerUpCapture = (ev) => {
      rememberPointer(ev);
      if (!state.active || String(ev.pointerType ?? "") !== "touch") {
        return;
      }
      if (state.pointerId !== null && ev.pointerId !== state.pointerId) {
        return;
      }
      const moved = state.segmentChanged
        || hasTransformSegmentChanged()
        || Math.hypot(ev.clientX - state.segmentStartX, ev.clientY - state.segmentStartY) > 4.0;
      if (moved) {
        finishTransformDragSegment();
      } else {
        confirmTransformMode();
      }
      stopTransformEvent(ev);
    };
    canvas.addEventListener("pointerdown", onPointerDownCapture, true);
    window.addEventListener("pointermove", onPointerMoveCapture, true);
    window.addEventListener("pointerup", onPointerUpCapture, true);
    window.addEventListener("pointercancel", onPointerUpCapture, true);
    window.addEventListener("blur", cancelTransformMode);
    return () => {
      canvas.removeEventListener("pointerdown", onPointerDownCapture, true);
      window.removeEventListener("pointermove", onPointerMoveCapture, true);
      window.removeEventListener("pointerup", onPointerUpCapture, true);
      window.removeEventListener("pointercancel", onPointerUpCapture, true);
      window.removeEventListener("blur", cancelTransformMode);
    };
  }

  return {
    state,
    applyTransformDrag,
    cancelTransformMode,
    confirmTransformMode,
    finishTransformDragSegment,
    getTransformModeLabel,
    installTransformPointerBridge,
    setTransformAxis,
    setTransformMode
  };
}
