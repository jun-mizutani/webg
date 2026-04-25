// -------------------------------------------------
// webgmodeler sample
//   main.js       2026/04/24
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// -------------------------------------------------

import WebgApp from "../../webg/WebgApp.js";
import SmoothShader from "../../webg/SmoothShader.js";
import Shape from "../../webg/Shape.js";
import Primitive from "../../webg/Primitive.js";
import ModelAsset from "../../webg/ModelAsset.js";
import Matrix from "../../webg/Matrix.js";
import Diagnostics from "../../webg/Diagnostics.js";
import {
  DEFAULT_CAMERA,
  DEFAULT_OBJECT_ID,
  EDITOR_MODE_EDIT,
  EDITOR_MODE_OBJECT,
  EDITOR_MODES,
  INITIAL_ORBIT_BINDINGS,
  MATERIAL,
  TOOL_ADD_VERTEX,
  TOOL_SELECT_FACE,
  TOOL_SELECT_VERTEX,
  TOOLS
} from "./modelerConfig.js";
import {
  add3,
  cross3,
  dot3,
  length3,
  mul3,
  normalize3,
  readFiniteNumber,
  readVec3,
  sub3
} from "./math3d.js";
import { buildGlbFromGeometry } from "./glbExporter.js";
import { createEditOperations } from "./editOperations.js";
import { createTransformController } from "./transformController.js";

class ModelerSmoothShader extends SmoothShader {
  constructor(gpu) {
    // modeler では裏面も確認対象なので、描画時の culling は切る。
    // frontFace は webg / WebGPU の標準どおり CCW を表として維持する。
    super(gpu, {
      cullMode: "none",
      frontFace: "ccw"
    });
  }
}

// webgmodeler は「編集データ」を唯一の正として扱う
// - vertices / faces は ModelAsset よりも操作しやすい形で保持する
// - 表示用 Shape と保存用 ModelAsset は、編集データから毎回再生成する
// - import した複雑な asset も、選択 mesh の positions / indices / polygonLoops を編集データへ写す
// この方針により、画面表示と JSON 出力が別々の状態へずれることを防ぐ

const ui = {
  status: null,
  fileInput: null,
  meshSelect: null,
  useMesh: null,
  saveJson: null,
  saveGlb: null,
  newScene: null,
  deleteSelected: null,
  makeTriangle: null,
  makeQuad: null,
  extrude: null,
  flipFaces: null,
  undo: null,
  redo: null,
  modeButtons: [],
  toolButtons: []
};

let app = null;
let meshNode = null;
let selectedFaceNode = null;
let markerRoot = null;
let gridRoot = null;
let orbit = null;
let importedAsset = null;
let importedMeshes = [];
let lastSavedName = "-";
let detachModelerKeyBridge = null;
let detachPanModifierBridge = null;
let detachTransformPointerBridge = null;
let editOperations = null;
let transformController = null;

const cameraPointer = {
  active: false,
  pointerId: null,
  lastX: 0.0,
  lastY: 0.0
};

const cameraModifier = {
  shift: false
};

const canvasClick = {
  active: false,
  pointerId: null,
  startX: 0.0,
  startY: 0.0,
  lastX: 0.0,
  lastY: 0.0
};

// 編集状態:
// - vertex.id / face.id は削除後も意味が変わらない識別子として使う
// - face.indices は vertex id の配列であり、三角形または四角形だけを許可する
// - selectedVertices / selectedFaces は id の Set として保持し、UI 操作の基準にする
const editor = {
  mode: EDITOR_MODE_OBJECT,
  objects: [],
  selectedObjectIds: new Set(),
  activeObjectId: null,
  nextObjectId: DEFAULT_OBJECT_ID,
  vertices: [],
  faces: [],
  selectedVertices: new Set(),
  selectedFaces: new Set(),
  nextVertexId: 1,
  nextFaceId: 1,
  tool: TOOL_SELECT_VERTEX,
  dirty: false,
  lastMessage: "ready",
  undoStack: [],
  redoStack: []
};

function focusModelerCanvas() {
  const canvas = app?.screen?.canvas ?? null;
  if (!canvas) {
    return;
  }
  // embedded 形式では DOM button / file input / select に focus が移りやすい
  // camera や keyboard tool の操作前に canvas へ focus を戻し、InputController の状態を安定させる
  if (canvas.tabIndex < 0 || !Number.isFinite(canvas.tabIndex)) {
    canvas.tabIndex = 0;
  }
  if (typeof canvas.focus === "function") {
    canvas.focus({
      preventScroll: true
    });
  }
}

function normalizeModelerCameraKey(ev) {
  const normalizedKey = app?.input?.normalizeKey(ev?.key ?? "") ?? "";
  const normalizedCode = String(ev?.code ?? "").toLowerCase();
  const panModifierKey = getOrbitPanModifierKey();
  if (normalizedKey === panModifierKey || normalizedCode === `${panModifierKey}left` || normalizedCode === `${panModifierKey}right`) {
    return panModifierKey;
  }
  const keyMap = orbit?.orbit?.keyMap ?? INITIAL_ORBIT_BINDINGS.orbitKeyMap;
  for (const key of [keyMap.left, keyMap.right, keyMap.up, keyMap.down]) {
    if (normalizedKey === key || normalizedCode === key) {
      return key;
    }
  }
  return normalizedKey;
}

function getOrbitPanModifierKey() {
  return orbit?.orbit?.panModifierKey ?? INITIAL_ORBIT_BINDINGS.panModifierKey;
}

function isOrbitPanModifierEvent(ev) {
  const panModifierKey = getOrbitPanModifierKey();
  if (panModifierKey === "shift") return ev.shiftKey === true;
  if (panModifierKey === "control" || panModifierKey === "ctrl") return ev.ctrlKey === true;
  if (panModifierKey === "alt" || panModifierKey === "option") return ev.altKey === true;
  if (panModifierKey === "meta" || panModifierKey === "command" || panModifierKey === "cmd") return ev.metaKey === true;
  return false;
}

function isOrbitPanModifierActive(ev = null) {
  const panModifierKey = getOrbitPanModifierKey();
  return (ev ? isOrbitPanModifierEvent(ev) : false)
    || cameraModifier.shift === true
    || app.input.has(panModifierKey);
}

function installModelerKeyBridge() {
  if (typeof window === "undefined" || !app?.input) {
    return () => {};
  }
  const keyMap = orbit?.orbit?.keyMap ?? INITIAL_ORBIT_BINDINGS.orbitKeyMap;
  const panModifierKey = getOrbitPanModifierKey();
  const bridgedKeys = new Set([
    keyMap.left,
    keyMap.right,
    keyMap.up,
    keyMap.down,
    panModifierKey
  ]);
  const syncPanModifier = (ev, key) => {
    if (key === panModifierKey || isOrbitPanModifierEvent(ev)) {
      cameraModifier.shift = true;
      app.input.press(panModifierKey);
      return true;
    }
    return isOrbitPanModifierActive(ev);
  };
  const panByArrowKey = (key) => {
    const panPixels = 18.0;
    let dx = 0.0;
    let dy = 0.0;
    if (key === keyMap.left) dx -= panPixels;
    else if (key === keyMap.right) dx += panPixels;
    else if (key === keyMap.up) dy += panPixels;
    else if (key === keyMap.down) dy -= panPixels;
    else return false;
    app.eye.setWorldMatrix();
    orbit.panViewByScreenDelta(dx, dy);
    orbit.apply();
    app.syncCameraFromEyeRig(orbit);
    setMessage(`camera pan ${key}`);
    return true;
  };
  const onKeyDown = (ev) => {
    const key = normalizeModelerCameraKey(ev);
    if (!bridgedKeys.has(key)) {
      return;
    }
    // embedded_glb_viewer と同様に、DOM UI へ focus が移っていても
    // EyeRig.update() が読む camera key state だけは InputController 側へ確実に反映する
    ev.preventDefault();
    const shiftDown = syncPanModifier(ev, key);
    if (shiftDown && key !== panModifierKey && panByArrowKey(key)) {
      app.input.release(key);
      ev.stopImmediatePropagation();
      return;
    }
    app.input.press(key);
  };
  const onKeyUp = (ev) => {
    const key = normalizeModelerCameraKey(ev);
    if (!bridgedKeys.has(key)) {
      return;
    }
    ev.preventDefault();
    app.input.release(key);
    if (key === panModifierKey || !isOrbitPanModifierEvent(ev)) {
      cameraModifier.shift = false;
      app.input.release(panModifierKey);
    }
  };
  const onBlur = () => {
    cameraModifier.shift = false;
    for (const key of bridgedKeys) {
      app.input.release(key);
    }
  };
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("keyup", onKeyUp, true);
  window.addEventListener("blur", onBlur);
  return () => {
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("keyup", onKeyUp, true);
    window.removeEventListener("blur", onBlur);
  };
}

document.addEventListener("DOMContentLoaded", () => {
  start().catch((err) => {
    console.error("webgmodeler failed:", err);
    if (ui.status) {
      ui.status.textContent = `webgmodeler failed\n${err?.stack ?? err}`;
    }
  });
});

// DOM の参照は起動時に一度だけ集める
// コード中で getElementById を散らさず、UI と編集ロジックの境界を見えやすくする
function cacheUi() {
  ui.status = document.getElementById("status");
  ui.fileInput = document.getElementById("modelFile");
  ui.meshSelect = document.getElementById("meshSelect");
  ui.useMesh = document.getElementById("useMesh");
  ui.saveJson = document.getElementById("saveJson");
  ui.saveGlb = document.getElementById("saveGlb");
  ui.newScene = document.getElementById("newScene");
  ui.deleteSelected = document.getElementById("deleteSelected");
  ui.makeTriangle = document.getElementById("makeTriangle");
  ui.makeQuad = document.getElementById("makeQuad");
  ui.extrude = document.getElementById("extrude");
  ui.flipFaces = document.getElementById("flipFaces");
  ui.undo = document.getElementById("undo");
  ui.redo = document.getElementById("redo");
  ui.modeButtons = Array.from(document.querySelectorAll("[data-mode]"));
  ui.toolButtons = Array.from(document.querySelectorAll("[data-tool]"));
}

// UI へ表示する文字列はここでまとめる
// canvas 上の HUD だけでなく DOM 側 status へも同じ情報を出すことで、
// クリック対象や選択数の確認がしやすくなる
function updateStatus() {
  updateCommandAvailability();
  const meshValue = ui.meshSelect?.value ?? "-1";
  const meshName = meshValue === "all"
    ? `all objects (${importedMeshes.length})`
    : importedMeshes.find((entry) => entry.index === Number(meshValue))?.label ?? "-";
  const transformState = transformController?.state ?? { mode: null, active: false };
  const faceIds = Array.from(editor.selectedFaces).join(", ") || "-";
  const vertexIds = Array.from(editor.selectedVertices).join(", ") || "-";
  const objectIds = Array.from(editor.selectedObjectIds).join(", ") || "-";
  const activeObject = getActiveObject();
  const orbitKeyMap = orbit?.orbit?.keyMap ?? INITIAL_ORBIT_BINDINGS.orbitKeyMap;
  const panModifierKey = orbit?.orbit?.panModifierKey ?? INITIAL_ORBIT_BINDINGS.panModifierKey;
  const arrowActive = app
    ? app.input.has(orbitKeyMap.left) || app.input.has(orbitKeyMap.right) || app.input.has(orbitKeyMap.up) || app.input.has(orbitKeyMap.down)
    : false;
  const shiftActive = app
    ? app.input.has(panModifierKey) || cameraModifier.shift
    : cameraModifier.shift;
  const orbitTarget = orbit?.orbit?.target ?? [NaN, NaN, NaN];
  const lines = [
    "webgmodeler",
    `mode=${editor.mode}`,
    `activeObject=${activeObject ? `${activeObject.id}:${activeObject.name}` : "-"}`,
    `objects=${editor.objects.length}`,
    `selectedObjects=${editor.selectedObjectIds.size} [${objectIds}]`,
    `tool=${editor.tool}`,
    `vertices=${editor.vertices.length} faces=${editor.faces.length}`,
    `selectedVertices=${editor.selectedVertices.size} [${vertexIds}]`,
    `selectedFaces=${editor.selectedFaces.size} [${faceIds}]`,
    `meshSelect=${meshName}`,
    `undo=${editor.undoStack.length} redo=${editor.redoStack.length}`,
    `dirty=${editor.dirty ? "yes" : "no"}`,
    `saved=${lastSavedName}`,
    `transform=${transformState.mode ?? "-"}${transformState.active ? " dragging" : ""}`,
    `keyState: L=${app?.input.has(orbitKeyMap.left) ? 1 : 0} R=${app?.input.has(orbitKeyMap.right) ? 1 : 0} U=${app?.input.has(orbitKeyMap.up) ? 1 : 0} D=${app?.input.has(orbitKeyMap.down) ? 1 : 0} Pm=${shiftActive ? 1 : 0}`,
    `arrowActive=${arrowActive ? "yes" : "no"} shiftPan=${shiftActive && arrowActive ? "yes" : "no"}`,
    `orbitTarget=${orbitTarget.map((v) => Number.isFinite(v) ? v.toFixed(3) : "NaN").join(", ")}`,
    `message=${editor.lastMessage}`
  ];
  if (ui.status) {
    ui.status.textContent = lines.join("\n");
  }
  app?.setHudRows?.([
    { line: "webgmodeler" },
    { label: "Mode", value: editor.mode },
    { label: "Tool", value: editor.tool },
    { label: "V/F", value: `${editor.vertices.length}/${editor.faces.length}` },
    { label: "Selected", value: `o${editor.selectedObjectIds.size} v${editor.selectedVertices.size} f${editor.selectedFaces.size}` },
    { label: "Xform", value: transformState.mode ?? "-" },
    { label: "Keys", value: `A=${arrowActive ? 1 : 0} Sh=${shiftActive ? 1 : 0}` },
    { label: "Msg", value: editor.lastMessage }
  ], {
    x: 0,
    y: 0,
    width: 46,
    wrap: true
  });
}

function setDisabled(control, disabled) {
  if (control) {
    control.disabled = disabled;
  }
}

function updateCommandAvailability() {
  const selectedVertexCount = editor.selectedVertices.size;
  const selectedFaceCount = editor.selectedFaces.size;
  const selectedAnything = selectedVertexCount > 0 || selectedFaceCount > 0;
  const editMode = isEditMode();
  for (const button of ui.modeButtons) {
    button.setAttribute("aria-pressed", button.dataset.mode === editor.mode ? "true" : "false");
  }
  for (const button of ui.toolButtons) {
    button.setAttribute("aria-pressed", button.dataset.tool === editor.tool ? "true" : "false");
    button.disabled = !editMode;
  }
  setDisabled(ui.makeTriangle, !editMode || selectedVertexCount !== 3);
  setDisabled(ui.makeQuad, !editMode || selectedVertexCount !== 4);
  setDisabled(ui.extrude, !editMode || selectedFaceCount === 0);
  setDisabled(ui.flipFaces, !editMode || selectedFaceCount === 0);
  setDisabled(ui.deleteSelected, !editMode || !selectedAnything);
  setDisabled(ui.undo, editor.undoStack.length === 0);
  setDisabled(ui.redo, editor.redoStack.length === 0);
  setDisabled(ui.useMesh, !importedAsset || importedMeshes.length === 0);
  setDisabled(ui.saveJson, editor.vertices.length === 0);
  setDisabled(ui.saveGlb, editor.vertices.length === 0 || editor.faces.length === 0);
}

function setMessage(message) {
  editor.lastMessage = String(message ?? "");
  updateStatus();
}

// undo は編集データと選択状態だけを保存する
// Shape や Node は表示キャッシュなので履歴に入れず、復元後に rebuildScene() で作り直す
function makeSnapshot() {
  commitActiveObject();
  return {
    mode: editor.mode,
    objects: editor.objects.map((object) => ({
      id: object.id,
      name: object.name,
      vertices: object.vertices.map((vertex) => ({
        id: vertex.id,
        position: [...vertex.position]
      })),
      faces: object.faces.map((face) => ({
        id: face.id,
        indices: [...face.indices]
      })),
      nextVertexId: object.nextVertexId,
      nextFaceId: object.nextFaceId
    })),
    selectedObjectIds: Array.from(editor.selectedObjectIds),
    activeObjectId: editor.activeObjectId,
    nextObjectId: editor.nextObjectId,
    selectedVertices: Array.from(editor.selectedVertices),
    selectedFaces: Array.from(editor.selectedFaces),
    nextVertexId: editor.nextVertexId,
    nextFaceId: editor.nextFaceId
  };
}

function restoreSnapshot(snapshot) {
  if (Array.isArray(snapshot.objects)) {
    editor.objects = snapshot.objects.map((object) => ({
      id: object.id,
      name: object.name,
      vertices: object.vertices.map((vertex) => ({
        id: vertex.id,
        position: readVec3(vertex.position, `snapshot object ${object.id} vertex ${vertex.id}`)
      })),
      faces: object.faces.map((face) => ({
        id: face.id,
        indices: [...face.indices]
      })),
      nextVertexId: object.nextVertexId,
      nextFaceId: object.nextFaceId
    }));
    editor.mode = snapshot.mode ?? EDITOR_MODE_OBJECT;
    editor.selectedObjectIds = new Set(snapshot.selectedObjectIds ?? []);
    editor.activeObjectId = snapshot.activeObjectId ?? editor.objects[0]?.id ?? null;
    editor.nextObjectId = snapshot.nextObjectId ?? Math.max(DEFAULT_OBJECT_ID, ...editor.objects.map((object) => object.id)) + 1;
    const active = getActiveObject() ?? editor.objects[0] ?? null;
    if (active) {
      editor.activeObjectId = active.id;
      editor.vertices = active.vertices;
      editor.faces = active.faces;
      editor.nextVertexId = active.nextVertexId;
      editor.nextFaceId = active.nextFaceId;
    } else {
      editor.vertices = [];
      editor.faces = [];
      editor.nextVertexId = 1;
      editor.nextFaceId = 1;
    }
  } else {
    editor.vertices = snapshot.vertices.map((vertex) => ({
      id: vertex.id,
      position: readVec3(vertex.position, `snapshot vertex ${vertex.id}`)
    }));
    editor.faces = snapshot.faces.map((face) => ({
      id: face.id,
      indices: [...face.indices]
    }));
    editor.nextVertexId = snapshot.nextVertexId;
    editor.nextFaceId = snapshot.nextFaceId;
  }
  editor.selectedVertices = new Set(snapshot.selectedVertices);
  editor.selectedFaces = new Set(snapshot.selectedFaces);
  editor.dirty = true;
  rebuildScene();
}

function pushUndo(label) {
  editor.undoStack.push(makeSnapshot());
  if (editor.undoStack.length > 80) {
    editor.undoStack.shift();
  }
  editor.redoStack = [];
  editor.dirty = true;
  if (label) {
    editor.lastMessage = label;
  }
}

function undo() {
  if (editor.undoStack.length === 0) {
    setMessage("undo stack is empty");
    return;
  }
  editor.redoStack.push(makeSnapshot());
  const snapshot = editor.undoStack.pop();
  restoreSnapshot(snapshot);
  setMessage("undo");
}

function redo() {
  if (editor.redoStack.length === 0) {
    setMessage("redo stack is empty");
    return;
  }
  editor.undoStack.push(makeSnapshot());
  const snapshot = editor.redoStack.pop();
  restoreSnapshot(snapshot);
  setMessage("redo");
}

// vertex id から vertex object を引く
// 見つからない id は参照整合性の破損なので、呼び出し側が先に検証する
function getVertexById(id) {
  return editor.vertices.find((vertex) => vertex.id === id) ?? null;
}

function getFaceById(id) {
  return editor.faces.find((face) => face.id === id) ?? null;
}

function getSelectedVertexObjects() {
  return Array.from(editor.selectedVertices)
    .map((id) => getVertexById(id))
    .filter((vertex) => vertex !== null);
}

function getSelectedFaceObjects() {
  return Array.from(editor.selectedFaces)
    .map((id) => getFaceById(id))
    .filter((face) => face !== null);
}

// 選択頂点が無い場合は選択 face の構成頂点を対象にする
// face 選択後に Move / Scale / Extrude を自然に使うための「操作対象」決定であり、
// データの欠落を補う処理ではない
function getActiveVertexIds() {
  if (editor.selectedVertices.size > 0) {
    return Array.from(editor.selectedVertices);
  }
  const ids = new Set();
  for (const face of getSelectedFaceObjects()) {
    for (const id of face.indices) {
      ids.add(id);
    }
  }
  return Array.from(ids);
}

function getHighlightedVertexIds() {
  const ids = new Set(editor.selectedVertices);
  for (const face of getSelectedFaceObjects()) {
    for (const id of face.indices) {
      ids.add(id);
    }
  }
  return ids;
}

function getActiveVertexObjects() {
  return getActiveVertexIds()
    .map((id) => getVertexById(id))
    .filter((vertex) => vertex !== null);
}

function getSelectedObjectVertexObjects() {
  commitActiveObject();
  const vertices = [];
  for (const object of editor.objects) {
    if (editor.selectedObjectIds.has(object.id)) {
      vertices.push(...object.vertices);
    }
  }
  return vertices;
}

function getTransformTargetVertexObjects(mode) {
  if (editor.mode === EDITOR_MODE_OBJECT) {
    return mode === "extrude" ? [] : getSelectedObjectVertexObjects();
  }
  return getActiveVertexObjects();
}

function computeCenter(vertices) {
  if (!Array.isArray(vertices) || vertices.length === 0) {
    return [0.0, 0.0, 0.0];
  }
  const sum = [0.0, 0.0, 0.0];
  for (const vertex of vertices) {
    sum[0] += vertex.position[0];
    sum[1] += vertex.position[1];
    sum[2] += vertex.position[2];
  }
  return [sum[0] / vertices.length, sum[1] / vertices.length, sum[2] / vertices.length];
}

// face の法線は頂点順に従って計算する
// 三角形と四角形だけを扱うため、先頭3頂点で面の向きを決める
function computeFaceNormal(face) {
  if (!face || face.indices.length < 3) {
    return [0.0, 1.0, 0.0];
  }
  const v0 = getVertexById(face.indices[0]);
  const v1 = getVertexById(face.indices[1]);
  const v2 = getVertexById(face.indices[2]);
  if (!v0 || !v1 || !v2) {
    return [0.0, 1.0, 0.0];
  }
  const normal = cross3(
    sub3(v1.position, v0.position),
    sub3(v2.position, v0.position)
  );
  const len = length3(normal);
  if (len <= 1.0e-9) {
    return [0.0, 1.0, 0.0];
  }
  return [normal[0] / len, normal[1] / len, normal[2] / len];
}

function computeNormalForVertexIds(vertexIds) {
  if (!Array.isArray(vertexIds) || vertexIds.length < 3) {
    return [0.0, 1.0, 0.0];
  }
  const v0 = getVertexById(vertexIds[0]);
  const v1 = getVertexById(vertexIds[1]);
  const v2 = getVertexById(vertexIds[2]);
  if (!v0 || !v1 || !v2) {
    return [0.0, 1.0, 0.0];
  }
  const normal = cross3(
    sub3(v1.position, v0.position),
    sub3(v2.position, v0.position)
  );
  const len = length3(normal);
  if (len <= 1.0e-9) {
    return [0.0, 1.0, 0.0];
  }
  return [normal[0] / len, normal[1] / len, normal[2] / len];
}

function reverseVertexLoop(vertexIds) {
  return [...vertexIds].reverse();
}

function getLoopEdgeDirection(loop, a, b) {
  for (let i = 0; i < loop.length; i++) {
    const current = loop[i];
    const next = loop[(i + 1) % loop.length];
    if (current === a && next === b) {
      return 1;
    }
    if (current === b && next === a) {
      return -1;
    }
  }
  return 0;
}

function shouldFlipLoopAwayFromOrigin(vertexIds) {
  const vertices = vertexIds
    .map((id) => getVertexById(id))
    .filter((vertex) => vertex !== null);
  if (vertices.length < 3) {
    return false;
  }
  const center = computeCenter(vertices);
  const toOrigin = mul3(center, -1.0);
  if (length3(toOrigin) <= 1.0e-8) {
    return false;
  }
  const normal = computeNormalForVertexIds(vertexIds);
  // 法線が原点方向を向く面は「原点側が裏」として反転し、孤立面でも外向きを初期表面にする
  return dot3(normal, toOrigin) > 0.0;
}

function orientLoopByAdjacentFaces(vertexIds) {
  let score = 0;
  for (const face of editor.faces) {
    for (let i = 0; i < vertexIds.length; i++) {
      const a = vertexIds[i];
      const b = vertexIds[(i + 1) % vertexIds.length];
      const existingDirection = getLoopEdgeDirection(face.indices, a, b);
      if (existingDirection === 0) {
        continue;
      }
      // 隣り合う面は共有辺を逆向きに持つと winding が連続する
      score += existingDirection === 1 ? -1 : 1;
    }
  }
  if (score < 0) {
    return reverseVertexLoop(vertexIds);
  }
  if (score > 0) {
    return [...vertexIds];
  }
  return shouldFlipLoopAwayFromOrigin(vertexIds)
    ? reverseVertexLoop(vertexIds)
    : [...vertexIds];
}

function orientAllFacesConsistently() {
  const edgeMap = new Map();
  const edgeKey = (a, b) => a < b ? `${a}:${b}` : `${b}:${a}`;
  for (const face of editor.faces) {
    for (let i = 0; i < face.indices.length; i++) {
      const a = face.indices[i];
      const b = face.indices[(i + 1) % face.indices.length];
      const key = edgeKey(a, b);
      const entries = edgeMap.get(key) ?? [];
      entries.push({ face, a, b });
      edgeMap.set(key, entries);
    }
  }

  const visited = new Set();
  for (const seed of editor.faces) {
    if (visited.has(seed.id)) {
      continue;
    }
    if (shouldFlipLoopAwayFromOrigin(seed.indices)) {
      seed.indices = reverseVertexLoop(seed.indices);
    }
    visited.add(seed.id);
    const queue = [seed];
    while (queue.length > 0) {
      const face = queue.shift();
      for (let i = 0; i < face.indices.length; i++) {
        const a = face.indices[i];
        const b = face.indices[(i + 1) % face.indices.length];
        const entries = edgeMap.get(edgeKey(a, b)) ?? [];
        for (const entry of entries) {
          const other = entry.face;
          if (other.id === face.id || visited.has(other.id)) {
            continue;
          }
          if (getLoopEdgeDirection(other.indices, a, b) === 1) {
            other.indices = reverseVertexLoop(other.indices);
          }
          visited.add(other.id);
          queue.push(other);
        }
      }
    }
  }
}

function computeSelectionNormal() {
  const selectedFaces = getSelectedFaceObjects();
  if (selectedFaces.length > 0) {
    const sum = [0.0, 0.0, 0.0];
    for (const face of selectedFaces) {
      const normal = computeFaceNormal(face);
      sum[0] += normal[0];
      sum[1] += normal[1];
      sum[2] += normal[2];
    }
    const len = length3(sum);
    if (len > 1.0e-9) {
      return [sum[0] / len, sum[1] / len, sum[2] / len];
    }
  }
  return [0.0, 1.0, 0.0];
}

// 編集データから ModelAsset を組み立てる
// faces は三角形または四角形だけを許可し、四角形は表示用 indices へ扇形分解する
function buildModelAssetFromGeometry(vertices = editor.vertices, faces = editor.faces, name = "webgmodeler") {
  const idToIndex = new Map();
  const positions = [];
  for (let i = 0; i < vertices.length; i++) {
    const vertex = vertices[i];
    idToIndex.set(vertex.id, i);
    positions.push(vertex.position[0], vertex.position[1], vertex.position[2]);
  }

  const indices = [];
  const polygonLoops = [];
  for (const face of faces) {
    if (face.indices.length !== 3 && face.indices.length !== 4) {
      throw new Error(`face ${face.id} must have 3 or 4 vertices`);
    }
    const loop = face.indices.map((vertexId) => {
      if (!idToIndex.has(vertexId)) {
        throw new Error(`face ${face.id} references missing vertex ${vertexId}`);
      }
      return idToIndex.get(vertexId);
    });
    polygonLoops.push(loop);
    for (let i = 0; i < loop.length - 2; i++) {
      indices.push(loop[0], loop[i + 1], loop[i + 2]);
    }
  }

  return ModelAsset.fromData({
    version: "1.0",
    type: "webg-model-asset",
    meta: {
      name,
      generator: "samples/webgmodeler",
      source: "editor",
      unitScale: 1.0,
      upAxis: "Y"
    },
    materials: [
      {
        id: "webgmodeler_mat",
        shaderParams: { ...MATERIAL.mesh }
      }
    ],
    meshes: [
      {
        id: "webgmodeler_mesh",
        name: `${name}_mesh`,
        material: "webgmodeler_mat",
        geometry: {
          vertexCount: vertices.length,
          polygonCount: indices.length / 3,
          positions,
          uvs: new Array(vertices.length * 2).fill(0.0),
          indices,
          polygonLoops
        }
      }
    ],
    skeletons: [],
    animations: [],
    nodes: [
      {
        id: "webgmodeler_node",
        name: "webgmodeler_node",
        parent: null,
        mesh: "webgmodeler_mesh",
        transform: {
          translation: [0.0, 0.0, 0.0],
          rotation: [0.0, 0.0, 0.0, 1.0],
          scale: [1.0, 1.0, 1.0]
        }
      }
    ]
  });
}

function buildModelAssetFromEditor() {
  return buildModelAssetFromGeometry(editor.vertices, editor.faces, getActiveObject()?.name ?? "webgmodeler");
}

// 選択 face だけの overlay geometry を作る
// 選択状態が mesh material 全体へ混ざらないよう、選択面は別 Shape として重ねる
function buildSelectedFaceAsset() {
  const selectedFaces = getSelectedFaceObjects();
  if (selectedFaces.length === 0) {
    return null;
  }
  const positions = [];
  const indices = [];
  let vertexOffset = 0;
  for (const face of selectedFaces) {
    const normal = computeFaceNormal(face);
    const offset = mul3(normal, 0.012);
    const localLoop = [];
    for (const vertexId of face.indices) {
      const vertex = getVertexById(vertexId);
      if (!vertex) {
        throw new Error(`selected face ${face.id} references missing vertex ${vertexId}`);
      }
      const p = add3(vertex.position, offset);
      positions.push(p[0], p[1], p[2]);
      localLoop.push(vertexOffset++);
    }
    for (let i = 0; i < localLoop.length - 2; i++) {
      indices.push(localLoop[0], localLoop[i + 1], localLoop[i + 2]);
    }
  }
  return ModelAsset.fromData({
    version: "1.0",
    type: "webg-model-asset",
    meta: { name: "webgmodeler_selection" },
    materials: [],
    meshes: [
      {
        id: "selection_mesh",
        geometry: {
          vertexCount: positions.length / 3,
          polygonCount: indices.length / 3,
          positions,
          uvs: new Array((positions.length / 3) * 2).fill(0.0),
          indices
        }
      }
    ],
    skeletons: [],
    animations: [],
    nodes: []
  });
}

function makeShapeFromAsset(asset, materialParams) {
  const shape = new Shape(app.getGL());
  shape.applyPrimitiveAsset(asset);
  shape.endShape();
  shape.setMaterial("smooth-shader", materialParams);
  return shape;
}

function makeShapeInstance(baseShape, materialParams = null) {
  const shape = new Shape(app.getGL());
  shape.referShape(baseShape);
  shape.copyShaderParamsFromShape(baseShape);
  if (materialParams) {
    shape.setMaterial("smooth-shader", materialParams);
  }
  return shape;
}

function removeNodeTree(node) {
  if (node) {
    app.space.removeNodeTree(node, { destroyShapes: true });
  }
}

function rebuildMeshShape() {
  commitActiveObject();
  removeNodeTree(meshNode);
  meshNode = null;
  if (editor.objects.length === 0) {
    return;
  }
  meshNode = app.space.addNode(null, "webgmodeler-objects");
  for (const object of editor.objects) {
    if (object.faces.length === 0) {
      continue;
    }
    const asset = buildModelAssetFromGeometry(object.vertices, object.faces, object.name);
    const selectedObject = editor.mode === EDITOR_MODE_OBJECT
      && editor.selectedObjectIds.has(object.id);
    const shape = makeShapeFromAsset(asset, selectedObject ? MATERIAL.selectedObject : MATERIAL.mesh);
    const node = app.space.addNode(meshNode, `object-${object.id}`);
    node.webgmodelerKind = "object";
    node.webgmodelerObjectId = object.id;
    node.addShape(shape);
  }
}

function rebuildSelectedFaceShape() {
  removeNodeTree(selectedFaceNode);
  selectedFaceNode = null;
  if (!isEditMode()) {
    return;
  }
  const asset = buildSelectedFaceAsset();
  if (!asset) {
    return;
  }
  const shape = makeShapeFromAsset(asset, MATERIAL.selectedFace);
  selectedFaceNode = app.space.addNode(null, "webgmodeler-selected-faces");
  selectedFaceNode.addShape(shape);
}

// marker は vertex id を node 側へ保持する
// Space.raycast() の hit.node から編集データの vertex id へ戻れるようにする
function rebuildMarkers() {
  removeNodeTree(markerRoot);
  if (!isEditMode()) {
    markerRoot = null;
    return;
  }
  markerRoot = app.space.addNode(null, "webgmodeler-markers");
  const radius = getMarkerRadius();
  const highlightedVertexIds = getHighlightedVertexIds();
  const baseMarkerShape = makeShapeFromAsset(Primitive.sphere(radius, 8, 8), MATERIAL.marker);
  for (const vertex of editor.vertices) {
    const selected = highlightedVertexIds.has(vertex.id);
    const markerShape = makeShapeInstance(
      baseMarkerShape,
      selected ? MATERIAL.selectedMarker : null
    );
    const node = app.space.addNode(markerRoot, `vertex-${vertex.id}`);
    node.webgmodelerKind = "vertex";
    node.webgmodelerVertexId = vertex.id;
    node.setPosition(vertex.position[0], vertex.position[1], vertex.position[2]);
    node.addShape(markerShape);
  }
}

function rebuildScene() {
  rebuildMeshShape();
  rebuildSelectedFaceShape();
  rebuildMarkers();
  updateStatus();
}

// 初期状態で奥行きと高さが読みやすいよう、薄い床 grid を置く
// grid は編集対象ではなく、ray pick の filter でも除外する
function buildGrid() {
  removeNodeTree(gridRoot);
  gridRoot = app.space.addNode(null, "webgmodeler-grid");
  const half = 6;
  const divisions = 12;
  const y = -0.012;
  const positions = [];
  const uvs = [];
  const indices = [];
  const polygonLoops = [];
  for (let z = 0; z <= divisions; z++) {
    for (let x = 0; x <= divisions; x++) {
      positions.push(
        -half + (x / divisions) * half * 2.0,
        y,
        -half + (z / divisions) * half * 2.0
      );
      uvs.push(x / divisions, z / divisions);
    }
  }
  const row = divisions + 1;
  for (let z = 0; z < divisions; z++) {
    for (let x = 0; x < divisions; x++) {
      const a = z * row + x;
      const b = a + 1;
      const d = (z + 1) * row + x;
      const c = d + 1;
      indices.push(a, b, c, a, c, d);
      polygonLoops.push([a, b, c, d]);
    }
  }
  const gridAsset = ModelAsset.fromData({
    version: "1.0",
    type: "webg-model-asset",
    meta: { name: "webgmodeler_grid" },
    materials: [],
    meshes: [
      {
        id: "grid_mesh",
        geometry: {
          vertexCount: positions.length / 3,
          polygonCount: indices.length / 3,
          positions,
          uvs,
          indices,
          polygonLoops
        }
      }
    ],
    skeletons: [],
    animations: [],
    nodes: []
  });
  const gridShape = makeShapeFromAsset(gridAsset, {
    color: MATERIAL.grid.color,
    wireframe: 1
  });
  gridShape.setWireframe(true);
  const node = app.space.addNode(gridRoot, "grid-wire-plane");
  node.addShape(gridShape);
}

function computeBoundsForVertices(vertices) {
  if (vertices.length === 0) {
    return {
      min: [-2.0, 0.0, -2.0],
      max: [2.0, 2.0, 2.0],
      center: [0.0, 0.6, 0.0],
      size: 4.0
    };
  }
  const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (const vertex of vertices) {
    for (let i = 0; i < 3; i++) {
      if (vertex.position[i] < min[i]) min[i] = vertex.position[i];
      if (vertex.position[i] > max[i]) max[i] = vertex.position[i];
    }
  }
  const center = [
    (min[0] + max[0]) * 0.5,
    (min[1] + max[1]) * 0.5,
    (min[2] + max[2]) * 0.5
  ];
  const size = Math.max(
    1.0,
    max[0] - min[0],
    max[1] - min[1],
    max[2] - min[2]
  );
  return { min, max, center, size };
}

function getEditorBounds() {
  commitActiveObject();
  const vertices = editor.objects.length > 0
    ? editor.objects.flatMap((object) => object.vertices)
    : editor.vertices;
  return computeBoundsForVertices(vertices);
}

function getActiveObjectBounds() {
  commitActiveObject();
  const object = getActiveObject();
  return computeBoundsForVertices(object?.vertices ?? editor.vertices);
}

function getMarkerRadius() {
  const bounds = getActiveObjectBounds();
  const eyePosition = app?.eye?.getWorldPosition?.() ?? null;
  const eyeDistance = eyePosition
    ? length3(sub3(eyePosition, bounds.center))
    : bounds.size * 2.8;
  const sizeRadius = Math.max(0.020, bounds.size * 0.014);
  const viewCap = Math.max(0.020, eyeDistance * 0.018);
  return Math.min(sizeRadius, viewCap);
}

function fitCameraToEditor() {
  const bounds = getEditorBounds();
  const distance = Math.max(4.0, bounds.size * 2.8);
  orbit.setTarget(bounds.center[0], bounds.center[1], bounds.center[2]);
  orbit.orbit.minDistance = Math.max(0.5, bounds.size * 0.15);
  orbit.orbit.maxDistance = Math.max(32.0, bounds.size * 12.0);
  orbit.orbit.wheelZoomStep = Math.max(0.4, bounds.size * 0.18);
  orbit.orbit.keyZoomSpeed = Math.max(2.0, bounds.size * 1.2);
  orbit.setAngles(DEFAULT_CAMERA.head, DEFAULT_CAMERA.pitch, 0.0);
  orbit.setDistance(distance);
  app.syncCameraFromEyeRig(orbit);
}

function getActiveObject() {
  return editor.objects.find((object) => object.id === editor.activeObjectId) ?? null;
}

function commitActiveObject() {
  const object = getActiveObject();
  if (!object) {
    return;
  }
  object.vertices = editor.vertices;
  object.faces = editor.faces;
  object.nextVertexId = editor.nextVertexId;
  object.nextFaceId = editor.nextFaceId;
}

function activateObject(id, { clearEditSelection = true } = {}) {
  commitActiveObject();
  const object = editor.objects.find((entry) => entry.id === id) ?? null;
  if (!object) {
    return false;
  }
  editor.activeObjectId = object.id;
  editor.vertices = object.vertices;
  editor.faces = object.faces;
  editor.nextVertexId = object.nextVertexId;
  editor.nextFaceId = object.nextFaceId;
  if (clearEditSelection) {
    clearSelection();
  }
  return true;
}

function isEditMode() {
  return editor.mode === EDITOR_MODE_EDIT;
}

function resetObjectState(name = "Cube") {
  const id = DEFAULT_OBJECT_ID;
  editor.objects = [{
    id,
    name: String(name || "Object"),
    vertices: editor.vertices,
    faces: editor.faces,
    nextVertexId: editor.nextVertexId,
    nextFaceId: editor.nextFaceId
  }];
  editor.nextObjectId = id + 1;
  editor.activeObjectId = id;
  editor.selectedObjectIds = new Set([id]);
}

function selectObject(id, additive = false) {
  const object = editor.objects.find((entry) => entry.id === id);
  if (!object) {
    return false;
  }
  if (!additive) {
    editor.selectedObjectIds.clear();
  }
  if (additive && editor.selectedObjectIds.has(id)) {
    editor.selectedObjectIds.delete(id);
    if (editor.activeObjectId === id) {
      editor.activeObjectId = editor.selectedObjectIds.values().next().value ?? null;
    }
  } else {
    editor.selectedObjectIds.add(id);
    activateObject(id);
  }
  return true;
}

function normalizeEditorMode(mode) {
  const normalized = String(mode ?? "").trim();
  if (!EDITOR_MODES.has(normalized)) {
    throw new Error(`unknown editor mode: ${mode}`);
  }
  return normalized;
}

function setEditorMode(mode) {
  const normalized = normalizeEditorMode(mode);
  if (editor.mode === normalized) {
    updateStatus();
    return;
  }
  cancelTransformMode();
  editor.mode = normalized;
  if (normalized === EDITOR_MODE_OBJECT) {
    clearSelection();
    if (editor.activeObjectId !== null) {
      editor.selectedObjectIds = new Set([editor.activeObjectId]);
    }
  } else {
    if (!getActiveObject() && editor.objects.length > 0) {
      selectObject(editor.objects[0].id, false);
    }
  }
  rebuildScene();
  setMessage(`${normalized} mode`);
}

function normalizeToolName(tool) {
  const normalized = String(tool ?? "").trim();
  if (normalized === "select") {
    return TOOL_SELECT_VERTEX;
  }
  if (!TOOLS.has(normalized)) {
    throw new Error(`unknown tool: ${tool}`);
  }
  return normalized;
}

function setTool(tool) {
  editor.tool = normalizeToolName(tool);
  if (!isEditMode()) {
    setEditorMode(EDITOR_MODE_EDIT);
    return;
  }
  setMessage(`tool ${editor.tool}`);
}

function addVertex(position) {
  const id = editor.nextVertexId++;
  editor.vertices.push({
    id,
    position: readVec3(position, `vertex ${id}`)
  });
  return id;
}

function addFace(vertexIds) {
  if (!Array.isArray(vertexIds) || (vertexIds.length !== 3 && vertexIds.length !== 4)) {
    throw new Error("addFace requires 3 or 4 vertex ids");
  }
  const unique = new Set(vertexIds);
  if (unique.size !== vertexIds.length) {
    throw new Error("face vertices must be unique");
  }
  for (const id of vertexIds) {
    if (!getVertexById(id)) {
      throw new Error(`face references missing vertex ${id}`);
    }
  }
  const id = editor.nextFaceId++;
  editor.faces.push({
    id,
    indices: [...vertexIds]
  });
  return id;
}

function addFaceWithStableOrientation(vertexIds) {
  return addFace(orientLoopByAdjacentFaces(vertexIds));
}

function addFaceOrientedToDirection(vertexIds, targetDirection) {
  let orientedIds = [...vertexIds];
  if (length3(targetDirection) > 1.0e-9) {
    const normal = computeNormalForVertexIds(orientedIds);
    if (dot3(normal, targetDirection) < 0.0) {
      orientedIds = reverseVertexLoop(orientedIds);
    }
  } else {
    orientedIds = orientLoopByAdjacentFaces(orientedIds);
  }
  return addFace(orientedIds);
}

// 選択頂点から新しい face を作るときは、現在の視点から見た画面上の並びを使う
// 単に選択順で面を張ると、クリック順しだいで三角形が裏返ったり、
// 四角形の対角線が交差したりするため、selection center を基準に screen right/up へ投影して角度順へ並べる
function orderVertexIdsForFaceFromView(vertexIds) {
  if (!Array.isArray(vertexIds) || (vertexIds.length !== 3 && vertexIds.length !== 4)) {
    throw new Error("orderVertexIdsForFaceFromView requires 3 or 4 vertex ids");
  }
  const vertices = vertexIds.map((id) => {
    const vertex = getVertexById(id);
    if (!vertex) {
      throw new Error(`face references missing vertex ${id}`);
    }
    return vertex;
  });
  const center = computeCenter(vertices);
  const basis = getCameraScreenBasis();
  const ordered = vertices
    .map((vertex) => {
      const rel = sub3(vertex.position, center);
      return {
        id: vertex.id,
        angle: Math.atan2(dot3(rel, basis.up), dot3(rel, basis.right))
      };
    })
    .sort((left, right) => left.angle - right.angle)
    .map((entry) => entry.id);

  const p0 = getVertexById(ordered[0]).position;
  const p1 = getVertexById(ordered[1]).position;
  const p2 = getVertexById(ordered[2]).position;
  const normal = cross3(sub3(p1, p0), sub3(p2, p0));
  const eyeDir = sub3(app.eye.getWorldPosition(), center);
  // 新規作成 face は「いま見ている側」を表にする
  // dot が負なら法線が視点と反対を向いているため、頂点順を反転して表裏をそろえる
  if (dot3(normal, eyeDir) < 0.0) {
    ordered.reverse();
  }
  return ordered;
}

function createInitialModel() {
  editor.vertices = [];
  editor.faces = [];
  editor.selectedVertices = new Set();
  editor.selectedFaces = new Set();
  editor.nextVertexId = 1;
  editor.nextFaceId = 1;
  editor.undoStack = [];
  editor.redoStack = [];
  addVertex([-1.0, 0.0, -1.0]);
  addVertex([1.0, 0.0, -1.0]);
  addVertex([1.0, 0.0, 1.0]);
  addVertex([-1.0, 0.0, 1.0]);
  addVertex([-1.0, 2.0, -1.0]);
  addVertex([1.0, 2.0, -1.0]);
  addVertex([1.0, 2.0, 1.0]);
  addVertex([-1.0, 2.0, 1.0]);
  addFace([1, 2, 3, 4]);
  addFace([5, 6, 7, 8]);
  addFace([1, 2, 6, 5]);
  addFace([2, 3, 7, 6]);
  addFace([3, 4, 8, 7]);
  addFace([4, 1, 5, 8]);
  orientAllFacesConsistently();
  resetObjectState("Cube");
  editor.mode = EDITOR_MODE_OBJECT;
  editor.dirty = false;
  editor.lastMessage = "new model";
  rebuildScene();
  fitCameraToEditor();
}

function clearSelection() {
  editor.selectedVertices.clear();
  editor.selectedFaces.clear();
}

function syncSelectedVerticesFromSelectedFaces() {
  editor.selectedVertices.clear();
  for (const face of getSelectedFaceObjects()) {
    for (const id of face.indices) {
      editor.selectedVertices.add(id);
    }
  }
}

function syncSelectedFacesFromSelectedVertices() {
  editor.selectedFaces.clear();
  if (editor.selectedVertices.size < 3) {
    return;
  }
  for (const face of editor.faces) {
    if (face.indices.every((id) => editor.selectedVertices.has(id))) {
      editor.selectedFaces.add(face.id);
    }
  }
}

function selectVertex(id, additive = false) {
  if (!additive) {
    clearSelection();
  }
  if (editor.selectedVertices.has(id) && additive) {
    editor.selectedVertices.delete(id);
  } else {
    editor.selectedVertices.add(id);
  }
  syncSelectedFacesFromSelectedVertices();
}

function selectFace(id, additive = false) {
  if (!additive) {
    clearSelection();
  }
  const face = getFaceById(id);
  if (!face) {
    return;
  }
  if (editor.selectedFaces.has(id) && additive) {
    editor.selectedFaces.delete(id);
  } else {
    editor.selectedFaces.add(id);
  }
  syncSelectedVerticesFromSelectedFaces();
}

function deleteSelected() {
  editOperations.deleteSelected();
}

function makeFaceFromSelection(size) {
  editOperations.makeFaceFromSelection(size);
}

function createExtrusion(distance) {
  return editOperations.createExtrusion(distance);
}

function extrudeSelectedFaces() {
  editOperations.extrudeSelectedFaces();
}

function flipSelectedFaces() {
  editOperations.flipSelectedFaces();
}

function cssToNdc(canvas, clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const x = ((clientX - rect.left) / rect.width) * 2.0 - 1.0;
  const y = 1.0 - ((clientY - rect.top) / rect.height) * 2.0;
  return [x, y];
}

function makeRayFromMouse(canvas, clientX, clientY) {
  app.eye.setWorldMatrix();
  const view = new Matrix();
  view.makeView(app.eye.worldMatrix);
  const [nx, ny] = cssToNdc(canvas, clientX, clientY);
  const invVp = app.projectionMatrix.clone();
  invVp.mul(view);
  invVp.inverse_strict();
  const near = invVp.mulVector([nx, ny, -1.0]);
  const far = invVp.mulVector([nx, ny, 1.0]);
  const eyePos = app.eye.getWorldPosition();
  return {
    origin: eyePos,
    dir: sub3(far, eyePos),
    near,
    far,
    ndc: [nx, ny]
  };
}

function intersectRayPlane(ray, point, normal) {
  const n = normalize3(normal, "plane normal");
  const denom = dot3(ray.dir, n);
  if (Math.abs(denom) < 1.0e-8) {
    return null;
  }
  const t = dot3(sub3(point, ray.origin), n) / denom;
  if (!Number.isFinite(t)) {
    throw new Error(`ray-plane intersection produced invalid t: ${t}`);
  }
  return add3(ray.origin, mul3(ray.dir, t));
}

// Moller-Trumbore で ray と triangle の交差を調べる
// face pick は編集データを直接見るため、Shape の AABB hit より正確な面選択になる
function intersectRayTriangle(ray, p0, p1, p2) {
  const eps = 1.0e-8;
  const edge1 = sub3(p1, p0);
  const edge2 = sub3(p2, p0);
  const h = cross3(ray.dir, edge2);
  const a = dot3(edge1, h);
  if (Math.abs(a) < eps) {
    return null;
  }
  const f = 1.0 / a;
  const s = sub3(ray.origin, p0);
  const u = f * dot3(s, h);
  if (u < 0.0 || u > 1.0) {
    return null;
  }
  const q = cross3(s, edge1);
  const v = f * dot3(ray.dir, q);
  if (v < 0.0 || u + v > 1.0) {
    return null;
  }
  const t = f * dot3(edge2, q);
  if (t <= eps) {
    return null;
  }
  return {
    t,
    point: add3(ray.origin, mul3(ray.dir, t))
  };
}

function getVertexByIdFromList(vertices, id) {
  return vertices.find((vertex) => vertex.id === id) ?? null;
}

function pickFaceInObject(ray, object) {
  let best = null;
  for (const face of object.faces) {
    const verts = face.indices.map((id) => getVertexByIdFromList(object.vertices, id));
    if (verts.some((vertex) => vertex === null)) {
      throw new Error(`object ${object.id} face ${face.id} contains missing vertex`);
    }
    const triangles = face.indices.length === 3
      ? [[0, 1, 2]]
      : [[0, 1, 2], [0, 2, 3]];
    for (const tri of triangles) {
      const hit = intersectRayTriangle(
        ray,
        verts[tri[0]].position,
        verts[tri[1]].position,
        verts[tri[2]].position
      );
      if (hit && (!best || hit.t < best.t)) {
        best = {
          ...hit,
          objectId: object.id,
          faceId: face.id
        };
      }
    }
  }
  return best;
}

function pickFace(ray) {
  const object = getActiveObject();
  if (!object) {
    return null;
  }
  return pickFaceInObject(ray, object);
}

function pickObjectFace(ray) {
  let best = null;
  for (const object of editor.objects) {
    const hit = pickFaceInObject(ray, object);
    if (hit && (!best || hit.t < best.t)) {
      best = hit;
    }
  }
  return best;
}

function pickVertexMarker(ray) {
  const hit = app.space.raycast(ray.origin, ray.dir, {
    firstHit: true,
    filter: ({ node }) => node?.webgmodelerKind === "vertex"
  });
  if (!hit) {
    return null;
  }
  return {
    vertexId: hit.node.webgmodelerVertexId,
    point: hit.point,
    t: hit.t
  };
}

function getCameraScreenBasis() {
  app.eye.setWorldMatrix();
  const eyeMatrix = app.eye.getWorldMatrix();
  return {
    right: normalize3(eyeMatrix.mul3x3Vector([1.0, 0.0, 0.0]), "camera right"),
    up: normalize3(eyeMatrix.mul3x3Vector([0.0, 1.0, 0.0]), "camera up"),
    forward: normalize3(eyeMatrix.mul3x3Vector([0.0, 0.0, -1.0]), "camera forward")
  };
}

function pickVertexByRayDistance(ray) {
  let best = null;
  const dir = normalize3(ray.dir, "vertex pick ray");
  const threshold = Math.max(getMarkerRadius() * 2.4, getActiveObjectBounds().size * 0.018);
  for (const vertex of editor.vertices) {
    const rel = sub3(vertex.position, ray.origin);
    const t = dot3(rel, dir);
    if (t < 0.0) {
      continue;
    }
    const closest = add3(ray.origin, mul3(dir, t));
    const distance = length3(sub3(vertex.position, closest));
    if (distance > threshold) {
      continue;
    }
    if (!best || distance < best.distance || (distance === best.distance && t < best.t)) {
      best = {
        vertexId: vertex.id,
        distance,
        t
      };
    }
  }
  return best;
}

function installPanModifierBridge(canvas) {
  const resetPointer = () => {
    const panModifierKey = getOrbitPanModifierKey();
    cameraPointer.active = false;
    cameraPointer.pointerId = null;
    cameraModifier.shift = false;
    app.input.release(panModifierKey);
  };
  const onPointerDownCapture = (ev) => {
    const transformState = transformController?.state ?? { mode: null, active: false };
    if (transformState.mode || transformState.active) {
      return;
    }
    if (String(ev.pointerType ?? "") === "touch") {
      return;
    }
    if (ev.button !== 0) {
      return;
    }
    focusModelerCanvas();
    cameraPointer.active = true;
    cameraPointer.pointerId = ev.pointerId;
    cameraPointer.lastX = ev.clientX;
    cameraPointer.lastY = ev.clientY;
  };
  const onPointerMoveCapture = (ev) => {
    const transformState = transformController?.state ?? { mode: null, active: false };
    if (transformState.mode || transformState.active) {
      return;
    }
    if (!cameraPointer.active) {
      return;
    }
    if (cameraPointer.pointerId !== null && ev.pointerId !== cameraPointer.pointerId) {
      return;
    }
    const dx = ev.clientX - cameraPointer.lastX;
    const dy = ev.clientY - cameraPointer.lastY;
    cameraPointer.lastX = ev.clientX;
    cameraPointer.lastY = ev.clientY;
    const panModifierKey = getOrbitPanModifierKey();
    if (isOrbitPanModifierEvent(ev)) {
      cameraModifier.shift = true;
      app.input.press(panModifierKey);
    }
    const shiftDown = isOrbitPanModifierActive(ev);
    if (!shiftDown) {
      return;
    }
    // 一部の環境では modifier 状態が pointermove の event field に乗らないことがある
    // その場合でも InputController 側の key state を見て、EyeRig と同じ pan helper を先に実行する
    // stopImmediatePropagation() により、この frame の pointermove が EyeRig の rotate 処理へ流れないようにする
    app.eye.setWorldMatrix();
    orbit.panViewByScreenDelta(dx, dy);
    orbit.apply();
    app.syncCameraFromEyeRig(orbit);
    // この bridge が pointermove を止めた frame は EyeRig.onPointerMove() が呼ばれない
    // EyeRig 側の lastClient 座標を同じ値へ進めておくと、modifier を離した直後に
    // 溜まった差分が通常 orbit として一度に処理されることを避けられる
    orbit.lastClientX = ev.clientX;
    orbit.lastClientY = ev.clientY;
    ev.preventDefault();
    ev.stopImmediatePropagation();
  };
  canvas.addEventListener("pointerdown", onPointerDownCapture, true);
  canvas.addEventListener("pointermove", onPointerMoveCapture, true);
  canvas.addEventListener("pointerup", resetPointer, true);
  canvas.addEventListener("pointercancel", resetPointer, true);
  canvas.addEventListener("pointerleave", resetPointer, true);
  window.addEventListener("blur", resetPointer);
  return () => {
    canvas.removeEventListener("pointerdown", onPointerDownCapture, true);
    canvas.removeEventListener("pointermove", onPointerMoveCapture, true);
    canvas.removeEventListener("pointerup", resetPointer, true);
    canvas.removeEventListener("pointercancel", resetPointer, true);
    canvas.removeEventListener("pointerleave", resetPointer, true);
    window.removeEventListener("blur", resetPointer);
  };
}

function isAdditiveSelectionEvent(ev) {
  return ev.shiftKey === true || app.input.has("shift");
}

function handleCanvasClick(ev) {
  const ray = makeRayFromMouse(app.screen.canvas, ev.clientX, ev.clientY);

  if (editor.mode === EDITOR_MODE_OBJECT) {
    const faceHit = pickObjectFace(ray);
    if (faceHit && selectObject(faceHit.objectId, isAdditiveSelectionEvent(ev))) {
      rebuildScene();
      setMessage(`selected object ${getActiveObject()?.name ?? editor.activeObjectId}`);
      return;
    }
    if (!isAdditiveSelectionEvent(ev)) {
      editor.selectedObjectIds.clear();
      rebuildScene();
      setMessage("object selection cleared");
    }
    return;
  }

  if (editor.tool === TOOL_ADD_VERTEX) {
    const faceHit = pickFace(ray);
    const planeHit = faceHit?.point
      ?? intersectRayPlane(ray, [0.0, 0.0, 0.0], [0.0, 1.0, 0.0])
      ?? intersectRayPlane(ray, orbit.orbit.target, getCameraScreenBasis().forward);
    if (!planeHit) {
      setMessage("could not place vertex from this view");
      ev.preventDefault();
      return;
    }
    pushUndo("add vertex");
    const id = addVertex(planeHit);
    selectVertex(id, false);
    rebuildScene();
    setMessage(`added vertex ${id}`);
    return;
  }

  const marker = editor.tool === TOOL_SELECT_VERTEX
    ? (pickVertexByRayDistance(ray) ?? pickVertexMarker(ray))
    : null;
  if (editor.tool === TOOL_SELECT_VERTEX && marker) {
    selectVertex(marker.vertexId, isAdditiveSelectionEvent(ev));
    rebuildScene();
    setMessage(`selected vertex ${marker.vertexId}`);
    return;
  }

  if (editor.tool === TOOL_SELECT_FACE) {
    const faceHit = pickFace(ray);
    if (faceHit) {
      selectFace(faceHit.faceId, isAdditiveSelectionEvent(ev));
      rebuildScene();
      setMessage(`selected face ${faceHit.faceId} with vertices`);
      return;
    }
  }

  if (!isAdditiveSelectionEvent(ev)) {
    clearSelection();
    rebuildScene();
    setMessage("selection cleared");
  }
}

function resetCanvasClick() {
  canvasClick.active = false;
  canvasClick.pointerId = null;
}

function handleCanvasPointerDown(ev) {
  focusModelerCanvas();
  if (ev.button !== 0) {
    resetCanvasClick();
    return;
  }
  // 編集用の pick は pointerdown では実行しない
  // pointerdown の時点で scene を再生成すると、同じ左ドラッグを使う EyeRig の
  // orbit / Shift+PAN と競合しやすい。短いクリックだけを pointerup で編集操作として確定する
  canvasClick.active = true;
  canvasClick.pointerId = ev.pointerId;
  canvasClick.startX = ev.clientX;
  canvasClick.startY = ev.clientY;
  canvasClick.lastX = ev.clientX;
  canvasClick.lastY = ev.clientY;
}

function handleCanvasPointerMove(ev) {
  if (!canvasClick.active) {
    return;
  }
  if (canvasClick.pointerId !== null && ev.pointerId !== canvasClick.pointerId) {
    return;
  }
  canvasClick.lastX = ev.clientX;
  canvasClick.lastY = ev.clientY;
}

function handleCanvasPointerUp(ev) {
  if (!canvasClick.active) {
    return;
  }
  if (canvasClick.pointerId !== null && ev.pointerId !== canvasClick.pointerId) {
    return;
  }
  const moveDistance = Math.hypot(ev.clientX - canvasClick.startX, ev.clientY - canvasClick.startY);
  resetCanvasClick();
  if (moveDistance > 4.0) {
    return;
  }
  handleCanvasClick(ev);
  ev.preventDefault();
}

function installPointerHandlers() {
  const canvas = app.screen.canvas;
  canvas.tabIndex = 0;
  canvas.addEventListener("contextmenu", (ev) => ev.preventDefault());
  canvas.addEventListener("pointerdown", handleCanvasPointerDown);
  canvas.addEventListener("pointermove", handleCanvasPointerMove);
  canvas.addEventListener("pointerup", handleCanvasPointerUp);
  canvas.addEventListener("pointercancel", resetCanvasClick);
  canvas.addEventListener("pointerleave", resetCanvasClick);
}

function getTransformModeLabel(mode) {
  return transformController.getTransformModeLabel(mode);
}

function setTransformMode(mode) {
  return transformController.setTransformMode(mode);
}

function cancelTransformMode() {
  return transformController.cancelTransformMode();
}

function confirmTransformMode() {
  return transformController.confirmTransformMode();
}

function applyTransformDrag(clientX, clientY) {
  return transformController.applyTransformDrag(clientX, clientY);
}

function installTransformPointerBridge(canvas) {
  return transformController.installTransformPointerBridge(canvas);
}

function moveActiveVerticesBy(delta, label) {
  return editOperations.moveActiveVerticesBy(delta, label);
}

function moveSelectionByScreenKeys(stepX, stepY) {
  return editOperations.moveSelectionByScreenKeys(stepX, stepY);
}

function moveSelectionByNormalKey(direction) {
  return editOperations.moveSelectionByNormalKey(direction);
}

function scaleSelectionByKeyboard(factor) {
  return editOperations.scaleSelectionByKeyboard(factor);
}

function installKeyboardHandlers() {
  window.addEventListener("keydown", (ev) => {
    if (ev.target && ["INPUT", "SELECT", "TEXTAREA"].includes(ev.target.tagName)) {
      return;
    }
    const key = String(ev.key ?? "").toLowerCase();
    const plainKey = !ev.metaKey && !ev.ctrlKey && !ev.altKey;
    if (key === "tab") setEditorMode(isEditMode() ? EDITOR_MODE_OBJECT : EDITOR_MODE_EDIT);
    else if (key === "1") setTool(TOOL_SELECT_VERTEX);
    else if (key === "2") setTool(TOOL_SELECT_FACE);
    else if (key === "3") setTool(TOOL_ADD_VERTEX);
    else if (plainKey && key === "g") setTransformMode("move");
    else if (plainKey && key === "r") setTransformMode("rotate");
    else if (plainKey && key === "s") setTransformMode("scale");
    else if (plainKey && key === "e") setTransformMode("extrude");
    else if (plainKey && key === "j") moveSelectionByScreenKeys(-1.0, 0.0);
    else if (plainKey && key === "l") moveSelectionByScreenKeys(1.0, 0.0);
    else if (plainKey && key === "i") moveSelectionByScreenKeys(0.0, 1.0);
    else if (plainKey && key === "k") moveSelectionByScreenKeys(0.0, -1.0);
    else if (plainKey && key === "u") moveSelectionByNormalKey(-1.0);
    else if (plainKey && key === "o") moveSelectionByNormalKey(1.0);
    else if (plainKey && key === "n") scaleSelectionByKeyboard(0.92);
    else if (plainKey && key === "m") scaleSelectionByKeyboard(1.08);
    else if (plainKey && key === "f") flipSelectedFaces();
    else if (key === "delete" || key === "backspace") deleteSelected();
    else if (key === "z" && (ev.metaKey || ev.ctrlKey)) undo();
    else if ((key === "y" && (ev.metaKey || ev.ctrlKey)) || (key === "z" && ev.shiftKey && (ev.metaKey || ev.ctrlKey))) redo();
    else if (key === "escape" && cancelTransformMode()) {
      // transform cancel handled above
    }
    else if (key === "escape") {
      clearSelection();
      rebuildScene();
      setMessage("selection cleared");
    } else {
      return;
    }
    ev.preventDefault();
  });
}

function detectFileFormat(file) {
  const name = String(file?.name ?? "").toLowerCase();
  if (name.endsWith(".json")) return "json";
  if (name.endsWith(".gltf") || name.endsWith(".glb")) return "gltf";
  if (name.endsWith(".dae")) return "collada";
  throw new Error(`unsupported file extension: ${file?.name ?? "(unknown)"}`);
}

function matrixFromNodeDef(node) {
  const matrix = new Matrix();
  if (Array.isArray(node?.matrix) && node.matrix.length >= 16) {
    matrix.setBulk(node.matrix);
    return matrix;
  }
  const transform = node?.transform ?? {};
  const t = Array.isArray(transform.translation) ? transform.translation : [0, 0, 0];
  const r = Array.isArray(transform.rotation) ? transform.rotation : [0, 0, 0, 1];
  const s = Array.isArray(transform.scale) ? transform.scale : [1, 1, 1];
  const x = Number(r[0] ?? 0);
  const y = Number(r[1] ?? 0);
  const z = Number(r[2] ?? 0);
  const w = Number(r[3] ?? 1);
  const sx = Number(s[0] ?? 1);
  const sy = Number(s[1] ?? 1);
  const sz = Number(s[2] ?? 1);
  matrix.setBulk([
    (1 - 2 * y * y - 2 * z * z) * sx,
    (2 * x * y + 2 * w * z) * sx,
    (2 * x * z - 2 * w * y) * sx,
    0,
    (2 * x * y - 2 * w * z) * sy,
    (1 - 2 * x * x - 2 * z * z) * sy,
    (2 * y * z + 2 * w * x) * sy,
    0,
    (2 * x * z + 2 * w * y) * sz,
    (2 * y * z - 2 * w * x) * sz,
    (1 - 2 * x * x - 2 * y * y) * sz,
    0,
    Number(t[0] ?? 0),
    Number(t[1] ?? 0),
    Number(t[2] ?? 0),
    1
  ]);
  return matrix;
}

function buildWorldMatrixResolver(nodes) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const cache = new Map();
  const resolve = (node) => {
    if (!node) {
      return new Matrix();
    }
    if (cache.has(node.id)) {
      return cache.get(node.id).clone();
    }
    const local = matrixFromNodeDef(node);
    const parent = node.parent ? nodeById.get(node.parent) : null;
    const world = parent ? resolve(parent) : new Matrix();
    world.mul_(local);
    cache.set(node.id, world.clone());
    return world;
  };
  return resolve;
}

function makeImportEntries(asset) {
  const data = asset.getData();
  const meshes = Array.isArray(data?.meshes) ? data.meshes : [];
  const nodes = Array.isArray(data?.nodes) ? data.nodes : [];
  const meshById = new Map(meshes.map((mesh, index) => [mesh.id, { mesh, index }]));
  const resolveWorldMatrix = buildWorldMatrixResolver(nodes);
  const entries = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (!node?.mesh || !meshById.has(node.mesh)) {
      continue;
    }
    const meshEntry = meshById.get(node.mesh);
    entries.push({
      index: entries.length,
      meshIndex: meshEntry.index,
      mesh: meshEntry.mesh,
      node,
      worldMatrix: resolveWorldMatrix(node),
      label: `${entries.length}: ${node.name ?? node.id ?? "node"} / ${meshEntry.mesh.name ?? meshEntry.mesh.id ?? "mesh"} v=${meshEntry.mesh.geometry?.vertexCount ?? Math.floor((meshEntry.mesh.geometry?.positions?.length ?? 0) / 3)}`
    });
  }
  if (entries.length > 0) {
    return entries;
  }
  return meshes.map((mesh, index) => ({
    index,
    meshIndex: index,
    mesh,
    node: null,
    worldMatrix: new Matrix(),
    label: `${index}: ${mesh.name ?? mesh.id ?? "mesh"} v=${mesh.geometry?.vertexCount ?? Math.floor((mesh.geometry?.positions?.length ?? 0) / 3)}`
  }));
}

function populateMeshSelect(asset) {
  importedMeshes = makeImportEntries(asset);
  ui.meshSelect.innerHTML = "";
  if (importedMeshes.length > 1) {
    const allOption = document.createElement("option");
    allOption.value = "all";
    allOption.textContent = `all objects (${importedMeshes.length})`;
    ui.meshSelect.appendChild(allOption);
  }
  for (const entry of importedMeshes) {
    const option = document.createElement("option");
    option.value = String(entry.index);
    option.textContent = entry.label;
    ui.meshSelect.appendChild(option);
  }
  if (importedMeshes.length === 0) {
    const option = document.createElement("option");
    option.value = "-1";
    option.textContent = "no mesh";
    ui.meshSelect.appendChild(option);
  }
  updateStatus();
}

async function loadModelFile(file) {
  if (!file) {
    return;
  }
  const format = detectFileFormat(file);
  setMessage(`loading ${file.name}`);
  let asset = null;
  if (format === "json") {
    asset = ModelAsset.fromJSON(await file.text());
  } else {
    const url = URL.createObjectURL(file);
    try {
      const loaded = await app.loadModel(url, {
        format,
        instantiate: false,
        validate: true,
        startAnimations: false,
        gltf: {
          includeSkins: false
        }
      });
      asset = loaded.asset;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  asset.assertValid();
  importedAsset = asset;
  populateMeshSelect(asset);
  if (importedMeshes.length > 0) {
    importSelectedMesh();
  } else {
    setMessage(`loaded ${file.name}, but no mesh was found`);
  }
}

function importSelectedMesh() {
  if (!importedAsset) {
    setMessage("load a model file first");
    return;
  }
  if (ui.meshSelect.value === "all") {
    importAllMeshes();
    return;
  }
  const index = Number(ui.meshSelect.value);
  const entry = importedMeshes.find((item) => item.index === index);
  if (!entry) {
    setMessage("selected mesh is not available");
    return;
  }
  const object = buildEditorObjectFromImportEntry(entry, DEFAULT_OBJECT_ID);
  pushUndo("import mesh");
  editor.objects = [object];
  editor.nextObjectId = object.id + 1;
  editor.selectedObjectIds = new Set([object.id]);
  editor.mode = EDITOR_MODE_OBJECT;
  activateObject(object.id);
  orientAllFacesConsistently();
  commitActiveObject();
  editor.undoStack = [];
  editor.redoStack = [];
  editor.dirty = false;
  rebuildScene();
  fitCameraToEditor();
  setMessage(`imported ${entry.label}`);
}

function buildEditorObjectFromImportEntry(entry, objectId) {
  const geometry = entry.mesh.geometry;
  if (!geometry || !Array.isArray(geometry.positions) || !Array.isArray(geometry.indices)) {
    throw new Error(`mesh ${entry.label} does not contain editable positions and indices`);
  }
  const vertices = [];
  const faces = [];
  let nextVertexId = 1;
  let nextFaceId = 1;
  const worldMatrix = entry.worldMatrix ?? new Matrix();
  for (let i = 0; i + 2 < geometry.positions.length; i += 3) {
    const position = worldMatrix.mulVector([
      readFiniteNumber(geometry.positions[i], `positions[${i}]`),
      readFiniteNumber(geometry.positions[i + 1], `positions[${i + 1}]`),
      readFiniteNumber(geometry.positions[i + 2], `positions[${i + 2}]`)
    ]);
    vertices.push({
      id: nextVertexId++,
      position: readVec3(position, `object ${objectId} vertex ${nextVertexId - 1}`)
    });
  }
  const loops = Array.isArray(geometry.polygonLoops) && geometry.polygonLoops.length > 0
    ? geometry.polygonLoops
    : [];
  if (loops.length > 0) {
    for (let i = 0; i < loops.length; i++) {
      const loop = loops[i];
      if (!Array.isArray(loop) || (loop.length !== 3 && loop.length !== 4)) {
        throw new Error(`polygonLoops[${i}] must be a triangle or quad for this initial modeler`);
      }
      const indices = loop.map((vertexIndex) => {
        const id = Number(vertexIndex) + 1;
        if (!vertices.some((vertex) => vertex.id === id)) {
          throw new Error(`polygonLoops[${i}] references missing vertex index ${vertexIndex}`);
        }
        return id;
      });
      faces.push({
        id: nextFaceId++,
        indices
      });
    }
  } else {
    for (let i = 0; i + 2 < geometry.indices.length; i += 3) {
      faces.push({
        id: nextFaceId++,
        indices: [
          Number(geometry.indices[i]) + 1,
          Number(geometry.indices[i + 1]) + 1,
          Number(geometry.indices[i + 2]) + 1
        ]
      });
    }
  }
  return {
    id: objectId,
    name: entry.node?.name ?? entry.mesh.name ?? entry.mesh.id ?? `Object ${objectId}`,
    vertices,
    faces,
    nextVertexId,
    nextFaceId
  };
}

function importAllMeshes() {
  if (importedMeshes.length === 0) {
    setMessage("no mesh to import");
    return;
  }
  pushUndo("import all meshes");
  editor.objects = importedMeshes.map((entry, index) => buildEditorObjectFromImportEntry(entry, DEFAULT_OBJECT_ID + index));
  editor.nextObjectId = DEFAULT_OBJECT_ID + editor.objects.length;
  editor.selectedObjectIds = new Set(editor.objects.length > 0 ? [editor.objects[0].id] : []);
  editor.mode = EDITOR_MODE_OBJECT;
  activateObject(editor.objects[0]?.id ?? null);
  for (const object of editor.objects) {
    activateObject(object.id);
    orientAllFacesConsistently();
    commitActiveObject();
  }
  activateObject(editor.objects[0]?.id ?? null);
  editor.undoStack = [];
  editor.redoStack = [];
  editor.dirty = false;
  rebuildScene();
  fitCameraToEditor();
  setMessage(`imported ${editor.objects.length} object(s)`);
}

function saveModelAssetJson() {
  const asset = buildModelAssetFromEditor();
  asset.assertValid();
  const filename = "webgmodeler_modelasset.json";
  asset.downloadJSON(filename, 2);
  lastSavedName = filename;
  editor.dirty = false;
  setMessage(`saved ${filename}`);
}

function buildGlbFromEditor() {
  return buildGlbFromGeometry({
    vertices: editor.vertices,
    faces: editor.faces,
    materialColor: MATERIAL.mesh.color
  });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function saveGlb() {
  const glb = buildGlbFromEditor();
  const filename = "webgmodeler.glb";
  downloadBlob(new Blob([glb], { type: "model/gltf-binary" }), filename);
  lastSavedName = filename;
  editor.dirty = false;
  setMessage(`saved ${filename}`);
}

function installDomHandlers() {
  for (const button of ui.modeButtons) {
    button.addEventListener("click", () => setEditorMode(button.dataset.mode));
  }
  for (const button of ui.toolButtons) {
    button.addEventListener("click", () => setTool(button.dataset.tool));
  }
  ui.fileInput.addEventListener("change", () => {
    const file = ui.fileInput.files?.[0] ?? null;
    loadModelFile(file).catch((err) => {
      console.error(err);
      setMessage(`load failed: ${err?.message ?? err}`);
    });
  });
  ui.useMesh.addEventListener("click", () => {
    try {
      importSelectedMesh();
    } catch (err) {
      console.error(err);
      setMessage(`import failed: ${err?.message ?? err}`);
    }
  });
  ui.saveJson.addEventListener("click", () => {
    try {
      saveModelAssetJson();
    } catch (err) {
      console.error(err);
      setMessage(`save failed: ${err?.message ?? err}`);
    }
  });
  ui.saveGlb.addEventListener("click", () => {
    try {
      saveGlb();
    } catch (err) {
      console.error(err);
      setMessage(`glb export failed: ${err?.message ?? err}`);
    }
  });
  ui.newScene.addEventListener("click", () => {
    createInitialModel();
    setMessage("new model");
  });
  ui.deleteSelected.addEventListener("click", deleteSelected);
  ui.makeTriangle.addEventListener("click", () => makeFaceFromSelection(3));
  ui.makeQuad.addEventListener("click", () => makeFaceFromSelection(4));
  ui.extrude.addEventListener("click", () => setTransformMode("extrude"));
  ui.flipFaces.addEventListener("click", flipSelectedFaces);
  ui.undo.addEventListener("click", undo);
  ui.redo.addEventListener("click", redo);
}

function refreshDiagnosticsStats() {
  app.mergeDiagnosticsStats({
    vertexCount: editor.vertices.length,
    faceCount: editor.faces.length,
    selectedVertexCount: editor.selectedVertices.size,
    selectedFaceCount: editor.selectedFaces.size,
    selectedObjectCount: editor.selectedObjectIds.size,
    editorMode: editor.mode,
    activeObjectId: editor.activeObjectId ?? "-",
    tool: editor.tool,
    dirty: editor.dirty ? "yes" : "no"
  });
}

function makeProbeReport(frameCount) {
  const report = app.createProbeReport("runtime-probe");
  Diagnostics.addDetail(report, `tool=${editor.tool}`);
  Diagnostics.addDetail(report, `mode=${editor.mode}`);
  Diagnostics.addDetail(report, `vertices=${editor.vertices.length}`);
  Diagnostics.addDetail(report, `faces=${editor.faces.length}`);
  Diagnostics.mergeStats(report, {
    frameCount,
    vertexCount: editor.vertices.length,
    faceCount: editor.faces.length,
    selectedVertexCount: editor.selectedVertices.size,
    selectedFaceCount: editor.selectedFaces.size,
    selectedObjectCount: editor.selectedObjectIds.size,
    editorMode: editor.mode
  });
  return report;
}

async function start() {
  cacheUi();
  app = new WebgApp({
    document,
    shaderClass: ModelerSmoothShader,
    layoutMode: "embedded",
    fixedCanvasSize: {
      width: 900,
      height: 620,
      useDevicePixelRatio: false
    },
    clearColor: [0.07, 0.11, 0.15, 1.0],
    viewAngle: 50.0,
    projectionNear: 0.05,
    projectionFar: 1000.0,
    messageFontTexture: "../../webg/font512.png",
    light: {
      mode: "world-node",
      nodeName: "modelerLight",
      position: [80.0, 140.0, 120.0],
      attitude: [0.0, 0.0, 0.0],
      type: 1.0
    },
    camera: {
      target: [...DEFAULT_CAMERA.target],
      distance: DEFAULT_CAMERA.distance,
      head: DEFAULT_CAMERA.head,
      pitch: DEFAULT_CAMERA.pitch
    },
    debugTools: {
      mode: "release",
      system: "webgmodeler",
      source: "samples/webgmodeler/main.js",
      probeDefaultAfterFrames: 1
    }
  });
  await app.init();
  app.attachInput();
  orbit = app.createOrbitEyeRig({
    target: [...DEFAULT_CAMERA.target],
    distance: DEFAULT_CAMERA.distance,
    head: DEFAULT_CAMERA.head,
    pitch: DEFAULT_CAMERA.pitch,
    orbitKeyMap: { ...INITIAL_ORBIT_BINDINGS.orbitKeyMap },
    panModifierKey: INITIAL_ORBIT_BINDINGS.panModifierKey,
    minDistance: 0.5,
    maxDistance: 96.0,
    wheelZoomStep: 1.0,
    keyZoomSpeed: 8.0,
    dragRotateSpeed: 0.28,
    dragPanSpeed: 2.0,
    pitchMin: -85.0,
    pitchMax: 85.0,
    dragButton: 0
  });
  const operationContext = {
    editor,
    addFaceOrientedToDirection,
    addFaceWithStableOrientation,
    addVertex,
    clearSelection,
    computeCenter,
    computeFaceNormal,
    computeSelectionNormal,
    createExtrusion: (distance) => editOperations.createExtrusion(distance),
    focusModelerCanvas,
    getActiveVertexObjects,
    getCameraScreenBasis,
    getCanvas: () => app.screen.canvas,
    getEditorBounds,
    getSelectedFaceObjects,
    getTransformTargetVertexObjects,
    getVertexById,
    isEditMode,
    makeSnapshot,
    orderVertexIdsForFaceFromView,
    pushUndo,
    rebuildScene,
    restoreSnapshot,
    reverseVertexLoop,
    setMessage
  };
  editOperations = createEditOperations(operationContext);
  transformController = createTransformController(operationContext);
  detachPanModifierBridge?.();
  detachPanModifierBridge = installPanModifierBridge(app.screen.canvas);
  detachTransformPointerBridge?.();
  detachTransformPointerBridge = installTransformPointerBridge(app.screen.canvas);
  buildGrid();
  createInitialModel();
  installDomHandlers();
  installPointerHandlers();
  installKeyboardHandlers();
  detachModelerKeyBridge?.();
  detachModelerKeyBridge = installModelerKeyBridge();
  updateStatus();
  focusModelerCanvas();
  populateMeshSelect(ModelAsset.fromData({
    version: "1.0",
    type: "webg-model-asset",
    materials: [],
    meshes: [],
    skeletons: [],
    animations: [],
    nodes: []
  }));

  app.start({
    onUpdate({ screen, deltaSec }) {
      refreshDiagnosticsStats();
      updateStatus();
      if (app.debugProbe) {
        app.debugProbe.collect = () => makeProbeReport(screen.getFrameCount());
      }
    }
  });
}
