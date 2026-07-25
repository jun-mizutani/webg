// ---------------------------------------------
// samples/mmodeler/transformController.js  2026/05/16
//   mmodeler transform controller
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import { add3, cross3, dot3, mul3, normalize3, sub3 } from "./math3d.js";

// mouse move preview 型の G/R/S/E transform controller を作る
export function createTransformController(ctx) {
  const state = {
    mode: null,
    active: false,
    pointerId: null,
    startX: 0.0,
    startY: 0.0,
    lastX: 0.0,
    lastY: 0.0,
    hasPointer: false,
    basis: null,
    axisConstraint: null,
    center: [0.0, 0.0, 0.0],
    initialPositions: new Map(),
    initialObjectOrigins: new Map(),
    xMirrorPairs: [],
    edgeSlideTargets: [],
    extrudeVertexNormals: new Map(),
    startSnapshot: null,
    wasDirty: false,
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
    const rect = ctx.getCanvas().getBoundingClientRect();
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
    if (!ctx.isEditMode() && normalized === "extrude") {
      ctx.setMessage("switch to edit mode before extrude");
      return false;
    }
    if (!ctx.isEditMode() && normalized === "edge-slide") {
      ctx.setMessage("switch to edit mode before edge slide");
      return false;
    }
    if (state.active) {
      // transformController の cancel を UI へ中継する
      cancelTransformMode();
    }
    if (normalized === "extrude" && ctx.getSelectedFaceObjects().length === 0) {
      ctx.setMessage("select face before extrude");
      return false;
    }
    const objectOriginMove = !ctx.isEditMode() && normalized === "move";
    const targetObjects = objectOriginMove ? (ctx.getTransformTargetObjects?.() ?? []) : [];
    if (normalized && normalized !== "extrude"
        && !objectOriginMove
        && ctx.getTransformTargetVertexObjects(normalized).length === 0) {
      ctx.setMessage(ctx.isEditMode()
        ? `select vertices or faces before ${getTransformModeLabel(normalized)}`
        : `select object before ${getTransformModeLabel(normalized)}`);
      return false;
    }
    if (objectOriginMove && targetObjects.length === 0) {
      ctx.setMessage("select object before move");
      return false;
    }
    ctx.focusModelerCanvas();
    const [startX, startY] = getTransformStartPoint();
    const startSnapshot = ctx.makeSnapshot();
    const wasDirty = ctx.editor.dirty;
    ctx.pushUndo(`${getTransformModeLabel(normalized)} transform`);
    let vertices = [];
    let extrudeVertexNormals = new Map();
    let edgeSlideTargets = [];
    if (objectOriginMove) {
      vertices = targetObjects.flatMap((object) => object.vertices);
      state.initialObjectOrigins = new Map(targetObjects.map((object) => [
        object,
        ctx.getObjectOrigin(object)
      ]));
    } else if (normalized === "extrude") {
      const extrusion = ctx.createExtrusion(0.0);
      if (!extrusion) {
        ctx.editor.undoStack.pop();
        ctx.editor.dirty = wasDirty;
        ctx.setMessage("select face before extrude");
        return false;
      }
      extrudeVertexNormals = extrusion.extrudeVertexNormals;
      vertices = Array.from(extrusion.sourceNewVertexIds ?? extrusion.newVertexIds)
        .map((id) => ctx.getVertexById(id))
        .filter((vertex) => vertex !== null);
      state.xMirrorPairs = extrusion.mirrorTopVertexPairs ?? [];
      ctx.rebuildScene();
    } else {
      vertices = ctx.getTransformTargetVertexObjects(normalized);
    }
    if (normalized === "edge-slide") {
      edgeSlideTargets = ctx.getEdgeSlideTargets?.(vertices) ?? [];
      vertices = edgeSlideTargets.map((target) => target.vertex);
      if (vertices.length === 0) {
        ctx.editor.undoStack.pop();
        ctx.editor.dirty = wasDirty;
        ctx.setMessage("edge slide requires selected vertices on edges");
        return false;
      }
    }
    if (vertices.length === 0 && !objectOriginMove) {
      ctx.editor.undoStack.pop();
      ctx.editor.dirty = wasDirty;
      ctx.setMessage(ctx.isEditMode()
        ? `select vertices or faces before ${getTransformModeLabel(normalized)}`
        : `select object before ${getTransformModeLabel(normalized)}`);
      return false;
    }
    state.mode = normalized;
    state.active = true;
    state.pointerId = null;
    state.startX = startX;
    state.startY = startY;
    state.basis = ctx.getCameraScreenBasis();
    state.axisConstraint = null;
    state.center = ctx.computeCenter(vertices);
    state.initialPositions = new Map(vertices.map((vertex) => [
      vertex,
      [...vertex.position]
    ]));
    if (normalized !== "extrude" && !objectOriginMove) {
      state.xMirrorPairs = ctx.makeXMirrorEditPairs?.(vertices, state.initialPositions) ?? [];
    }
    state.edgeSlideTargets = edgeSlideTargets;
    state.extrudeVertexNormals = extrudeVertexNormals;
    state.startSnapshot = startSnapshot;
    state.wasDirty = wasDirty;
    state.changed = false;
    ctx.setMessage(`${getTransformModeLabel(normalized)} mode: move mouse, left click confirm`);
    return true;
  }

  // transform 開始時 snapshot を復元して preview 変更を取り消す
  function restoreTransformStart() {
    if (state.startSnapshot) {
      ctx.restoreSnapshot(state.startSnapshot);
    }
  }

  // transformController の cancel を UI へ中継する
  function cancelTransformMode() {
    const hadMode = state.mode !== null || state.active;
    if (state.active && (state.changed || state.mode === "extrude")) {
      // transform 開始時 snapshot を復元して preview 変更を取り消す
      restoreTransformStart();
    }
    if (state.active && ctx.editor.undoStack.length > 0) {
      ctx.editor.undoStack.pop();
      ctx.editor.dirty = state.wasDirty;
    }
    state.mode = null;
    state.active = false;
    state.pointerId = null;
    state.basis = null;
    state.axisConstraint = null;
    state.initialPositions = new Map();
    state.initialObjectOrigins = new Map();
    state.xMirrorPairs = [];
    state.edgeSlideTargets = [];
    state.extrudeVertexNormals = new Map();
    state.startSnapshot = null;
    state.wasDirty = false;
    state.changed = false;
    if (hadMode) {
      ctx.setMessage("transform cancelled");
    }
    return hadMode;
  }

  // transformController の confirm を UI へ中継する
  function confirmTransformMode() {
    if (!state.active) {
      return false;
    }
    const mode = state.mode;
    if (!state.changed && ctx.editor.undoStack.length > 0) {
      if (mode === "extrude") {
        // transform 開始時 snapshot を復元して preview 変更を取り消す
        restoreTransformStart();
      }
      ctx.editor.undoStack.pop();
      ctx.editor.dirty = state.wasDirty;
    }
    state.mode = null;
    state.active = false;
    state.pointerId = null;
    state.basis = null;
    state.axisConstraint = null;
    state.initialPositions = new Map();
    state.initialObjectOrigins = new Map();
    state.xMirrorPairs = [];
    state.edgeSlideTargets = [];
    state.extrudeVertexNormals = new Map();
    state.startSnapshot = null;
    state.wasDirty = false;
    state.changed = false;
    ctx.setMessage(`${getTransformModeLabel(mode)} confirmed`);
    return true;
  }

  // axis constraint の内部表現を world axis vector へ変換する
  // `null` は制限なし、`x/y/z` は world X/Y/Z 軸だけへ transform preview を制限する
  function getConstraintAxisVector() {
    if (state.axisConstraint === "x") return [1.0, 0.0, 0.0];
    if (state.axisConstraint === "y") return [0.0, 1.0, 0.0];
    if (state.axisConstraint === "z") return [0.0, 0.0, 1.0];
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
    const normalized = axis === "x" || axis === "y" || axis === "z" ? axis : null;
    state.axisConstraint = state.axisConstraint === normalized ? null : normalized;
    ctx.setMessage(`${getTransformModeLabel(state.mode)} axis ${state.axisConstraint?.toUpperCase?.() ?? "free"}`);
    return true;
  }

  // 指定軸まわりに点を回転させるための Rodrigues 回転を計算する
  function rotatePointAroundAxis(point, center, axis, angleRad) {
    const rel = sub3(point, center);
    const n = normalize3(axis, "transform rotate axis");
    const cosA = Math.cos(angleRad);
    const sinA = Math.sin(angleRad);
    const term1 = mul3(rel, cosA);
    const term2 = mul3(cross3(n, rel), sinA);
    const term3 = mul3(n, dot3(n, rel) * (1.0 - cosA));
    return add3(center, add3(add3(term1, term2), term3));
  }

  // transformController の preview 更新を UI へ中継する
  function applyTransformDrag(clientX, clientY) {
    const vertices = Array.from(state.initialPositions.keys());
    const objectOrigins = Array.from(state.initialObjectOrigins.entries());
    if ((vertices.length === 0 && objectOrigins.length === 0) || !state.basis) {
      return;
    }
    const canvas = ctx.getCanvas();
    const rect = canvas.getBoundingClientRect();
    const bounds = ctx.getEditorBounds();
    const dx = clientX - state.startX;
    const dy = clientY - state.startY;
    const worldPerPixel = Math.max(0.002, bounds.size / Math.max(160.0, Math.min(rect.width, rect.height)));
    const basis = state.basis;
    const moveDelta = add3(
      // vec3 を scalar 倍する
      mul3(basis.right, dx * worldPerPixel),
      // vec3 を scalar 倍する
      mul3(basis.up, -dy * worldPerPixel)
    );
    const axis = getConstraintAxisVector();
    const constrainedMoveDelta = axis
      ? makeAxisMoveDelta(axis, dx, dy, worldPerPixel)
      : moveDelta;
    if (state.mode === "move" && objectOrigins.length > 0) {
      for (const [object, initialOrigin] of objectOrigins) {
        object.origin = add3(initialOrigin, constrainedMoveDelta);
      }
      state.changed = true;
      ctx.rebuildScene();
      ctx.setMessage(`${getTransformModeLabel(state.mode)} object origin${axis ? ` ${state.axisConstraint.toUpperCase()}` : ""}`);
      return;
    }
    for (const vertex of vertices) {
      const initial = state.initialPositions.get(vertex);
      if (!initial) {
        continue;
      }
      if (state.mode === "move") {
        vertex.position = add3(initial, constrainedMoveDelta);
      } else if (state.mode === "rotate") {
        const angleRad = (dx - dy) * 0.01;
        vertex.position = rotatePointAroundAxis(initial, state.center, axis ?? basis.forward, angleRad);
      } else if (state.mode === "scale") {
        const factor = Math.max(0.02, Math.exp((dx - dy) * 0.006));
        if (axis) {
          const rel = sub3(initial, state.center);
          const along = dot3(rel, axis);
          const parallel = mul3(axis, along);
          const perpendicular = sub3(rel, parallel);
          vertex.position = add3(state.center, add3(perpendicular, mul3(parallel, factor)));
        } else {
          vertex.position = add3(
            state.center,
            // vec3 を scalar 倍する
            mul3(sub3(initial, state.center), factor)
          );
        }
      } else if (state.mode === "extrude") {
        const normal = state.extrudeVertexNormals.get(vertex.id) ?? ctx.computeSelectionNormal();
        const distance = (dx - dy) * worldPerPixel;
        vertex.position = axis
          ? add3(initial, constrainedMoveDelta)
          : add3(initial, mul3(normal, distance));
      } else if (state.mode === "edge-slide") {
        const slide = state.edgeSlideTargets.find((target) => target.vertex === vertex);
        if (!slide) {
          continue;
        }
        const ratio = Math.max(-1.0, Math.min(1.0, dx / Math.max(80.0, rect.width * 0.25)));
        vertex.position = add3(slide.start, mul3(sub3(slide.end, slide.start), ratio));
      }
    }
    ctx.applyXMirrorEdit?.(vertices, state.initialPositions, state.xMirrorPairs);
    state.changed = true;
    ctx.rebuildScene();
    ctx.setMessage(`${getTransformModeLabel(state.mode)} drag${axis ? ` ${state.axisConstraint.toUpperCase()}` : ""}`);
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
      confirmTransformMode();
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
    getTransformModeLabel,
    installTransformPointerBridge,
    setTransformAxis,
    setTransformMode
  };
}
