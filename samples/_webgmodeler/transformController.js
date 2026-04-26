// -------------------------------------------------
// webgmodeler transform controller
// -------------------------------------------------

import { add3, cross3, dot3, mul3, normalize3, sub3 } from "./math3d.js";

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
    center: [0.0, 0.0, 0.0],
    initialPositions: new Map(),
    extrudeVertexNormals: new Map(),
    startSnapshot: null,
    wasDirty: false,
    changed: false
  };

  function getTransformModeLabel(mode) {
    if (mode === "move") return "move";
    if (mode === "rotate") return "rotate";
    if (mode === "scale") return "scale";
    if (mode === "extrude") return "extrude";
    return "-";
  }

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

  function setTransformMode(mode) {
    const normalized = mode === "move" || mode === "rotate" || mode === "scale" || mode === "extrude"
      ? mode
      : null;
    if (!normalized) {
      cancelTransformMode();
      return true;
    }
    if (!ctx.isEditMode() && normalized === "extrude") {
      ctx.setMessage("switch to edit mode before extrude");
      return false;
    }
    if (state.active) {
      cancelTransformMode();
    }
    if (normalized === "extrude" && ctx.getSelectedFaceObjects().length === 0) {
      ctx.setMessage("select face before extrude");
      return false;
    }
    if (normalized && normalized !== "extrude" && ctx.getTransformTargetVertexObjects(normalized).length === 0) {
      ctx.setMessage(ctx.isEditMode()
        ? `select vertices or faces before ${getTransformModeLabel(normalized)}`
        : `select object before ${getTransformModeLabel(normalized)}`);
      return false;
    }
    ctx.focusModelerCanvas();
    const [startX, startY] = getTransformStartPoint();
    const startSnapshot = ctx.makeSnapshot();
    const wasDirty = ctx.editor.dirty;
    ctx.pushUndo(`${getTransformModeLabel(normalized)} transform`);
    let vertices = [];
    let extrudeVertexNormals = new Map();
    if (normalized === "extrude") {
      const extrusion = ctx.createExtrusion(0.0);
      if (!extrusion) {
        ctx.editor.undoStack.pop();
        ctx.editor.dirty = wasDirty;
        ctx.setMessage("select face before extrude");
        return false;
      }
      extrudeVertexNormals = extrusion.extrudeVertexNormals;
      vertices = Array.from(extrusion.newVertexIds)
        .map((id) => ctx.getVertexById(id))
        .filter((vertex) => vertex !== null);
      ctx.rebuildScene();
    } else {
      vertices = ctx.getTransformTargetVertexObjects(normalized);
    }
    if (vertices.length === 0) {
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
    state.center = ctx.computeCenter(vertices);
    state.initialPositions = new Map(vertices.map((vertex) => [
      vertex,
      [...vertex.position]
    ]));
    state.extrudeVertexNormals = extrudeVertexNormals;
    state.startSnapshot = startSnapshot;
    state.wasDirty = wasDirty;
    state.changed = false;
    ctx.setMessage(`${getTransformModeLabel(normalized)} mode: move mouse, left click confirm`);
    return true;
  }

  function restoreTransformStart() {
    if (state.startSnapshot) {
      ctx.restoreSnapshot(state.startSnapshot);
    }
  }

  function cancelTransformMode() {
    const hadMode = state.mode !== null || state.active;
    if (state.active && (state.changed || state.mode === "extrude")) {
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
    state.initialPositions = new Map();
    state.extrudeVertexNormals = new Map();
    state.startSnapshot = null;
    state.wasDirty = false;
    state.changed = false;
    if (hadMode) {
      ctx.setMessage("transform cancelled");
    }
    return hadMode;
  }

  function confirmTransformMode() {
    if (!state.active) {
      return false;
    }
    const mode = state.mode;
    if (!state.changed && ctx.editor.undoStack.length > 0) {
      if (mode === "extrude") {
        restoreTransformStart();
      }
      ctx.editor.undoStack.pop();
      ctx.editor.dirty = state.wasDirty;
    }
    state.mode = null;
    state.active = false;
    state.pointerId = null;
    state.basis = null;
    state.initialPositions = new Map();
    state.extrudeVertexNormals = new Map();
    state.startSnapshot = null;
    state.wasDirty = false;
    state.changed = false;
    ctx.setMessage(`${getTransformModeLabel(mode)} confirmed`);
    return true;
  }

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

  function applyTransformDrag(clientX, clientY) {
    const vertices = Array.from(state.initialPositions.keys());
    if (vertices.length === 0 || !state.basis) {
      return;
    }
    const canvas = ctx.getCanvas();
    const rect = canvas.getBoundingClientRect();
    const bounds = ctx.getEditorBounds();
    const dx = clientX - state.startX;
    const dy = clientY - state.startY;
    const worldPerPixel = Math.max(0.002, bounds.size / Math.max(160.0, Math.min(rect.width, rect.height)));
    const basis = state.basis;
    for (const vertex of vertices) {
      const initial = state.initialPositions.get(vertex);
      if (!initial) {
        continue;
      }
      if (state.mode === "move") {
        const delta = add3(
          mul3(basis.right, dx * worldPerPixel),
          mul3(basis.up, -dy * worldPerPixel)
        );
        vertex.position = add3(initial, delta);
      } else if (state.mode === "rotate") {
        const angleRad = (dx - dy) * 0.01;
        vertex.position = rotatePointAroundAxis(initial, state.center, basis.forward, angleRad);
      } else if (state.mode === "scale") {
        const factor = Math.max(0.02, Math.exp((dx - dy) * 0.006));
        vertex.position = add3(
          state.center,
          mul3(sub3(initial, state.center), factor)
        );
      } else if (state.mode === "extrude") {
        const normal = state.extrudeVertexNormals.get(vertex.id) ?? ctx.computeSelectionNormal();
        const distance = (dx - dy) * worldPerPixel;
        vertex.position = add3(initial, mul3(normal, distance));
      }
    }
    state.changed = true;
    ctx.rebuildScene();
    ctx.setMessage(`${getTransformModeLabel(state.mode)} drag`);
  }

  function installTransformPointerBridge(canvas) {
    const stopTransformEvent = (ev) => {
      ev.preventDefault();
      ev.stopImmediatePropagation();
    };
    const rememberPointer = (ev) => {
      state.lastX = ev.clientX;
      state.lastY = ev.clientY;
      state.hasPointer = true;
    };
    const onPointerDownCapture = (ev) => {
      rememberPointer(ev);
      if (!state.active) {
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
    const onPointerMoveCapture = (ev) => {
      rememberPointer(ev);
      if (!state.active) {
        return;
      }
      applyTransformDrag(ev.clientX, ev.clientY);
      stopTransformEvent(ev);
    };
    canvas.addEventListener("pointerdown", onPointerDownCapture, true);
    window.addEventListener("pointermove", onPointerMoveCapture, true);
    window.addEventListener("blur", cancelTransformMode);
    return () => {
      canvas.removeEventListener("pointerdown", onPointerDownCapture, true);
      window.removeEventListener("pointermove", onPointerMoveCapture, true);
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
    setTransformMode
  };
}
