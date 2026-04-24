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

// webgmodeler は「編集データ」を唯一の正として扱う
// - vertices / faces は ModelAsset よりも操作しやすい形で保持する
// - 表示用 Shape と保存用 ModelAsset は、編集データから毎回再生成する
// - import した複雑な asset も、選択 mesh の positions / indices / polygonLoops を編集データへ写す
// この方針により、画面表示と JSON 出力が別々の状態へずれることを防ぐ

const TOOL_SELECT = "select";
const TOOL_ADD_VERTEX = "addVertex";
const TOOLS = new Set([
  TOOL_SELECT,
  TOOL_ADD_VERTEX
]);

const DEFAULT_CAMERA = {
  target: [0.0, 0.8, 0.0],
  distance: 12.0,
  head: 28.0,
  pitch: -18.0
};

const INITIAL_ORBIT_BINDINGS = {
  orbitKeyMap: {
    left: "arrowleft",
    right: "arrowright",
    up: "arrowup",
    down: "arrowdown"
  },
  panModifierKey: "shift"
};

const MATERIAL = {
  mesh: {
    color: [0.52, 0.68, 0.82, 1.0],
    ambient: 0.34,
    specular: 0.42,
    power: 24.0,
    use_texture: 0,
    has_bone: 0
  },
  selectedFace: {
    color: [1.0, 0.72, 0.20, 1.0],
    ambient: 0.48,
    specular: 0.28,
    power: 18.0,
    use_texture: 0,
    has_bone: 0
  },
  marker: {
    color: [0.12, 0.26, 0.36, 1.0],
    ambient: 0.42,
    specular: 0.28,
    power: 18.0,
    use_texture: 0,
    has_bone: 0
  },
  selectedMarker: {
    color: [1.0, 0.22, 0.18, 1.0],
    ambient: 0.5,
    specular: 0.34,
    power: 18.0,
    use_texture: 0,
    has_bone: 0
  },
  grid: {
    color: [0.23, 0.28, 0.32, 1.0],
    ambient: 0.58,
    specular: 0.12,
    power: 8.0,
    use_texture: 0,
    has_bone: 0
  }
};

const ui = {
  status: null,
  fileInput: null,
  meshSelect: null,
  useMesh: null,
  saveJson: null,
  newScene: null,
  deleteSelected: null,
  makeTriangle: null,
  makeQuad: null,
  extrude: null,
  undo: null,
  redo: null,
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
  vertices: [],
  faces: [],
  selectedVertices: new Set(),
  selectedFaces: new Set(),
  nextVertexId: 1,
  nextFaceId: 1,
  tool: TOOL_SELECT,
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
  ui.newScene = document.getElementById("newScene");
  ui.deleteSelected = document.getElementById("deleteSelected");
  ui.makeTriangle = document.getElementById("makeTriangle");
  ui.makeQuad = document.getElementById("makeQuad");
  ui.extrude = document.getElementById("extrude");
  ui.undo = document.getElementById("undo");
  ui.redo = document.getElementById("redo");
  ui.toolButtons = Array.from(document.querySelectorAll("[data-tool]"));
}

// 数値配列は編集データの根幹なので、import 時点で有限数だけを受け付ける
// 不正な値を 0 に丸めると、読み込み元の破損や loader 差分を隠してしまうため例外にする
function readFiniteNumber(value, label) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`${label} must be a finite number: ${value}`);
  }
  return num;
}

// vec3 をコピーしながら検証する
// vertices[].position は以後の pick / drag / export の全てが参照するため、
// 配列長と finite number の条件をここで固定する
function readVec3(value, label) {
  if (!Array.isArray(value) || value.length < 3) {
    throw new Error(`${label} must be an array with at least 3 numbers`);
  }
  return [
    readFiniteNumber(value[0], `${label}[0]`),
    readFiniteNumber(value[1], `${label}[1]`),
    readFiniteNumber(value[2], `${label}[2]`)
  ];
}

function add3(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function sub3(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function mul3(v, scale) {
  return [v[0] * scale, v[1] * scale, v[2] * scale];
}

function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

function length3(v) {
  return Math.hypot(v[0], v[1], v[2]);
}

function normalize3(v, label = "vector") {
  const len = length3(v);
  if (!Number.isFinite(len) || len <= 1.0e-9) {
    throw new Error(`${label} has zero length`);
  }
  return [v[0] / len, v[1] / len, v[2] / len];
}

// UI へ表示する文字列はここでまとめる
// canvas 上の HUD だけでなく DOM 側 status へも同じ情報を出すことで、
// クリック対象や選択数の確認がしやすくなる
function updateStatus() {
  const meshName = importedMeshes[Number(ui.meshSelect?.value ?? -1)]?.label ?? "-";
  const faceIds = Array.from(editor.selectedFaces).join(", ") || "-";
  const vertexIds = Array.from(editor.selectedVertices).join(", ") || "-";
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
    `tool=${editor.tool}`,
    `vertices=${editor.vertices.length} faces=${editor.faces.length}`,
    `selectedVertices=${editor.selectedVertices.size} [${vertexIds}]`,
    `selectedFaces=${editor.selectedFaces.size} [${faceIds}]`,
    `meshSelect=${meshName}`,
    `undo=${editor.undoStack.length} redo=${editor.redoStack.length}`,
    `dirty=${editor.dirty ? "yes" : "no"}`,
    `saved=${lastSavedName}`,
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
    { label: "Tool", value: editor.tool },
    { label: "V/F", value: `${editor.vertices.length}/${editor.faces.length}` },
    { label: "Selected", value: `v${editor.selectedVertices.size} f${editor.selectedFaces.size}` },
    { label: "Keys", value: `A=${arrowActive ? 1 : 0} Sh=${shiftActive ? 1 : 0}` },
    { label: "Msg", value: editor.lastMessage }
  ], {
    x: 0,
    y: 0,
    width: 46,
    wrap: true
  });
}

function setMessage(message) {
  editor.lastMessage = String(message ?? "");
  updateStatus();
}

// undo は編集データと選択状態だけを保存する
// Shape や Node は表示キャッシュなので履歴に入れず、復元後に rebuildScene() で作り直す
function makeSnapshot() {
  return {
    vertices: editor.vertices.map((vertex) => ({
      id: vertex.id,
      position: [...vertex.position]
    })),
    faces: editor.faces.map((face) => ({
      id: face.id,
      indices: [...face.indices]
    })),
    selectedVertices: Array.from(editor.selectedVertices),
    selectedFaces: Array.from(editor.selectedFaces),
    nextVertexId: editor.nextVertexId,
    nextFaceId: editor.nextFaceId
  };
}

function restoreSnapshot(snapshot) {
  editor.vertices = snapshot.vertices.map((vertex) => ({
    id: vertex.id,
    position: readVec3(vertex.position, `snapshot vertex ${vertex.id}`)
  }));
  editor.faces = snapshot.faces.map((face) => ({
    id: face.id,
    indices: [...face.indices]
  }));
  editor.selectedVertices = new Set(snapshot.selectedVertices);
  editor.selectedFaces = new Set(snapshot.selectedFaces);
  editor.nextVertexId = snapshot.nextVertexId;
  editor.nextFaceId = snapshot.nextFaceId;
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

function getActiveVertexObjects() {
  return getActiveVertexIds()
    .map((id) => getVertexById(id))
    .filter((vertex) => vertex !== null);
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
function buildModelAssetFromEditor() {
  const idToIndex = new Map();
  const positions = [];
  for (let i = 0; i < editor.vertices.length; i++) {
    const vertex = editor.vertices[i];
    idToIndex.set(vertex.id, i);
    positions.push(vertex.position[0], vertex.position[1], vertex.position[2]);
  }

  const indices = [];
  const polygonLoops = [];
  for (const face of editor.faces) {
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
      name: "webgmodeler",
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
        name: "webgmodeler_mesh",
        material: "webgmodeler_mat",
        geometry: {
          vertexCount: editor.vertices.length,
          polygonCount: indices.length / 3,
          positions,
          uvs: new Array(editor.vertices.length * 2).fill(0.0),
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

function removeNodeTree(node) {
  if (node) {
    app.space.removeNodeTree(node, { destroyShapes: true });
  }
}

function rebuildMeshShape() {
  removeNodeTree(meshNode);
  meshNode = null;
  if (editor.faces.length === 0) {
    return;
  }
  const asset = buildModelAssetFromEditor();
  const shape = makeShapeFromAsset(asset, MATERIAL.mesh);
  meshNode = app.space.addNode(null, "webgmodeler-mesh");
  meshNode.addShape(shape);
}

function rebuildSelectedFaceShape() {
  removeNodeTree(selectedFaceNode);
  selectedFaceNode = null;
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
  markerRoot = app.space.addNode(null, "webgmodeler-markers");
  const radius = getMarkerRadius();
  for (const vertex of editor.vertices) {
    const selected = editor.selectedVertices.has(vertex.id);
    const markerShape = makeShapeFromAsset(
      Primitive.sphere(radius, 8, 8),
      selected ? MATERIAL.selectedMarker : MATERIAL.marker
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
  const lineShape = makeShapeFromAsset(Primitive.cuboid(12.0, 0.018, 0.018), MATERIAL.grid);
  for (let i = -6; i <= 6; i++) {
    const xNode = app.space.addNode(gridRoot, `grid-x-${i}`);
    const xShape = new Shape(app.getGL());
    xShape.referShape(lineShape);
    xShape.copyShaderParamsFromShape(lineShape);
    xNode.addShape(xShape);
    xNode.setPosition(0.0, -0.012, i);
    xNode.setAttitude(0.0, 0.0, 0.0);

    const zNode = app.space.addNode(gridRoot, `grid-z-${i}`);
    const zShape = new Shape(app.getGL());
    zShape.referShape(lineShape);
    zShape.copyShaderParamsFromShape(lineShape);
    zNode.addShape(zShape);
    zNode.setPosition(i, -0.018, 0.0);
    zNode.setAttitude(90.0, 0.0, 0.0);
  }
}

function getEditorBounds() {
  if (editor.vertices.length === 0) {
    return {
      min: [-2.0, 0.0, -2.0],
      max: [2.0, 2.0, 2.0],
      center: [0.0, 0.6, 0.0],
      size: 4.0
    };
  }
  const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (const vertex of editor.vertices) {
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

function getMarkerRadius() {
  return Math.max(0.055, getEditorBounds().size * 0.022);
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

function normalizeToolName(tool) {
  const normalized = String(tool ?? "").trim();
  if (!TOOLS.has(normalized)) {
    throw new Error(`unknown tool: ${tool}`);
  }
  return normalized;
}

function setTool(tool) {
  editor.tool = normalizeToolName(tool);
  for (const button of ui.toolButtons) {
    button.setAttribute("aria-pressed", button.dataset.tool === editor.tool ? "true" : "false");
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
  addVertex([-1.4, 0.0, -1.0]);
  addVertex([1.4, 0.0, -1.0]);
  addVertex([1.4, 0.0, 1.0]);
  addVertex([-1.4, 0.0, 1.0]);
  addVertex([0.0, 1.8, 0.0]);
  addFace([1, 2, 3, 4]);
  addFace([1, 2, 5]);
  addFace([2, 3, 5]);
  addFace([3, 4, 5]);
  addFace([4, 1, 5]);
  editor.dirty = false;
  editor.lastMessage = "new model";
  rebuildScene();
  fitCameraToEditor();
}

function clearSelection() {
  editor.selectedVertices.clear();
  editor.selectedFaces.clear();
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
}

function deleteSelected() {
  if (editor.selectedVertices.size === 0 && editor.selectedFaces.size === 0) {
    setMessage("nothing selected");
    return;
  }
  pushUndo("delete selection");
  const deleteFacesOnly = editor.selectedFaces.size > 0;
  const removedVertices = deleteFacesOnly
    ? new Set()
    : new Set(editor.selectedVertices);
  editor.faces = editor.faces.filter((face) => {
    if (editor.selectedFaces.has(face.id)) return false;
    return !face.indices.some((vertexId) => removedVertices.has(vertexId));
  });
  editor.vertices = editor.vertices.filter((vertex) => !removedVertices.has(vertex.id));
  clearSelection();
  rebuildScene();
  setMessage("deleted selection");
}

function makeFaceFromSelection(size) {
  const ids = Array.from(editor.selectedVertices);
  if (ids.length !== size) {
    setMessage(`${size === 3 ? "Triangle" : "Quad"} requires ${size} selected vertices`);
    return;
  }
  pushUndo(`make ${size === 3 ? "triangle" : "quad"}`);
  const orientedIds = orderVertexIdsForFaceFromView(ids);
  const faceId = addFace(orientedIds);
  editor.selectedFaces = new Set([faceId]);
  rebuildScene();
  setMessage(`created front-facing face ${faceId}`);
}

function extrudeSelectedFaces() {
  const faces = getSelectedFaceObjects();
  if (faces.length === 0) {
    setMessage("select face before extrude");
    return;
  }
  pushUndo("extrude faces");
  const newFaceIds = [];
  const newVertexIds = new Set();
  const bounds = getEditorBounds();
  const distance = Math.max(0.25, bounds.size * 0.18);
  for (const face of faces) {
    const normal = computeFaceNormal(face);
    const top = [];
    for (const vertexId of face.indices) {
      const vertex = getVertexById(vertexId);
      if (!vertex) {
        throw new Error(`face ${face.id} references missing vertex ${vertexId}`);
      }
      const id = addVertex(add3(vertex.position, mul3(normal, distance)));
      top.push(id);
      newVertexIds.add(id);
    }
    newFaceIds.push(addFace(top));
    for (let i = 0; i < face.indices.length; i++) {
      const next = (i + 1) % face.indices.length;
      newFaceIds.push(addFace([
        face.indices[i],
        face.indices[next],
        top[next],
        top[i]
      ]));
    }
  }
  editor.selectedVertices = newVertexIds;
  editor.selectedFaces = new Set(newFaceIds);
  rebuildScene();
  setMessage(`extruded ${faces.length} face(s)`);
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

function pickFace(ray) {
  let best = null;
  for (const face of editor.faces) {
    const verts = face.indices.map((id) => getVertexById(id));
    if (verts.some((vertex) => vertex === null)) {
      throw new Error(`face ${face.id} contains missing vertex`);
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
          faceId: face.id
        };
      }
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

function installPanModifierBridge(canvas) {
  const resetPointer = () => {
    const panModifierKey = getOrbitPanModifierKey();
    cameraPointer.active = false;
    cameraPointer.pointerId = null;
    cameraModifier.shift = false;
    app.input.release(panModifierKey);
  };
  const onPointerDownCapture = (ev) => {
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
  const marker = pickVertexMarker(ray);

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

  if (marker) {
    selectVertex(marker.vertexId, isAdditiveSelectionEvent(ev));
    rebuildScene();
    setMessage(`selected vertex ${marker.vertexId}`);
    return;
  }

  const faceHit = pickFace(ray);
  if (faceHit) {
    selectFace(faceHit.faceId, isAdditiveSelectionEvent(ev));
    rebuildScene();
    setMessage(`selected face ${faceHit.faceId}`);
    return;
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

function getKeyboardEditStep() {
  return Math.max(0.04, getEditorBounds().size * 0.035);
}

function moveActiveVerticesBy(delta, label) {
  const vertices = getActiveVertexObjects();
  if (vertices.length === 0) {
    setMessage("select vertices or faces before keyboard edit");
    return false;
  }
  pushUndo(label);
  for (const vertex of vertices) {
    vertex.position = add3(vertex.position, delta);
  }
  rebuildScene();
  setMessage(label);
  return true;
}

function moveSelectionByScreenKeys(stepX, stepY) {
  const basis = getCameraScreenBasis();
  const step = getKeyboardEditStep();
  const delta = add3(
    mul3(basis.right, stepX * step),
    mul3(basis.up, stepY * step)
  );
  return moveActiveVerticesBy(delta, "keyboard move screen");
}

function moveSelectionByNormalKey(direction) {
  const step = getKeyboardEditStep();
  const normal = computeSelectionNormal();
  return moveActiveVerticesBy(mul3(normal, direction * step), "keyboard move normal");
}

function scaleSelectionByKeyboard(factor) {
  const vertices = getActiveVertexObjects();
  if (vertices.length === 0) {
    setMessage("select vertices or faces before keyboard scale");
    return false;
  }
  pushUndo("keyboard scale selection");
  const center = computeCenter(vertices);
  for (const vertex of vertices) {
    vertex.position = add3(
      center,
      mul3(sub3(vertex.position, center), factor)
    );
  }
  rebuildScene();
  setMessage(`keyboard scale ${factor.toFixed(2)}`);
  return true;
}

function installKeyboardHandlers() {
  window.addEventListener("keydown", (ev) => {
    if (ev.target && ["INPUT", "SELECT", "TEXTAREA"].includes(ev.target.tagName)) {
      return;
    }
    const key = String(ev.key ?? "").toLowerCase();
    if (key === "1") setTool(TOOL_SELECT);
    else if (key === "2") setTool(TOOL_ADD_VERTEX);
    else if (key === "j") moveSelectionByScreenKeys(-1.0, 0.0);
    else if (key === "l") moveSelectionByScreenKeys(1.0, 0.0);
    else if (key === "i") moveSelectionByScreenKeys(0.0, 1.0);
    else if (key === "k") moveSelectionByScreenKeys(0.0, -1.0);
    else if (key === "u") moveSelectionByNormalKey(-1.0);
    else if (key === "o") moveSelectionByNormalKey(1.0);
    else if (key === "n") scaleSelectionByKeyboard(0.92);
    else if (key === "m") scaleSelectionByKeyboard(1.08);
    else if (key === "delete" || key === "backspace") deleteSelected();
    else if (key === "z" && (ev.metaKey || ev.ctrlKey)) undo();
    else if ((key === "y" && (ev.metaKey || ev.ctrlKey)) || (key === "z" && ev.shiftKey && (ev.metaKey || ev.ctrlKey))) redo();
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

function populateMeshSelect(asset) {
  const data = asset.getData();
  const meshes = Array.isArray(data?.meshes) ? data.meshes : [];
  importedMeshes = meshes.map((mesh, index) => ({
    index,
    mesh,
    label: `${index}: ${mesh.name ?? mesh.id ?? "mesh"} v=${mesh.geometry?.vertexCount ?? Math.floor((mesh.geometry?.positions?.length ?? 0) / 3)}`
  }));
  ui.meshSelect.innerHTML = "";
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
  const index = Number(ui.meshSelect.value);
  const entry = importedMeshes.find((item) => item.index === index);
  if (!entry) {
    setMessage("selected mesh is not available");
    return;
  }
  const geometry = entry.mesh.geometry;
  if (!geometry || !Array.isArray(geometry.positions) || !Array.isArray(geometry.indices)) {
    throw new Error(`mesh ${entry.label} does not contain editable positions and indices`);
  }
  pushUndo("import mesh");
  editor.vertices = [];
  editor.faces = [];
  editor.selectedVertices = new Set();
  editor.selectedFaces = new Set();
  editor.nextVertexId = 1;
  editor.nextFaceId = 1;
  for (let i = 0; i + 2 < geometry.positions.length; i += 3) {
    addVertex([
      readFiniteNumber(geometry.positions[i], `positions[${i}]`),
      readFiniteNumber(geometry.positions[i + 1], `positions[${i + 1}]`),
      readFiniteNumber(geometry.positions[i + 2], `positions[${i + 2}]`)
    ]);
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
      addFace(loop.map((vertexIndex) => {
        const id = Number(vertexIndex) + 1;
        if (!getVertexById(id)) {
          throw new Error(`polygonLoops[${i}] references missing vertex index ${vertexIndex}`);
        }
        return id;
      }));
    }
  } else {
    for (let i = 0; i + 2 < geometry.indices.length; i += 3) {
      addFace([
        Number(geometry.indices[i]) + 1,
        Number(geometry.indices[i + 1]) + 1,
        Number(geometry.indices[i + 2]) + 1
      ]);
    }
  }
  editor.undoStack = [];
  editor.redoStack = [];
  editor.dirty = false;
  rebuildScene();
  fitCameraToEditor();
  setMessage(`imported ${entry.label}`);
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

function installDomHandlers() {
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
  ui.newScene.addEventListener("click", () => {
    createInitialModel();
    setMessage("new model");
  });
  ui.deleteSelected.addEventListener("click", deleteSelected);
  ui.makeTriangle.addEventListener("click", () => makeFaceFromSelection(3));
  ui.makeQuad.addEventListener("click", () => makeFaceFromSelection(4));
  ui.extrude.addEventListener("click", extrudeSelectedFaces);
  ui.undo.addEventListener("click", undo);
  ui.redo.addEventListener("click", redo);
}

function refreshDiagnosticsStats() {
  app.mergeDiagnosticsStats({
    vertexCount: editor.vertices.length,
    faceCount: editor.faces.length,
    selectedVertexCount: editor.selectedVertices.size,
    selectedFaceCount: editor.selectedFaces.size,
    tool: editor.tool,
    dirty: editor.dirty ? "yes" : "no"
  });
}

function makeProbeReport(frameCount) {
  const report = app.createProbeReport("runtime-probe");
  Diagnostics.addDetail(report, `tool=${editor.tool}`);
  Diagnostics.addDetail(report, `vertices=${editor.vertices.length}`);
  Diagnostics.addDetail(report, `faces=${editor.faces.length}`);
  Diagnostics.mergeStats(report, {
    frameCount,
    vertexCount: editor.vertices.length,
    faceCount: editor.faces.length,
    selectedVertexCount: editor.selectedVertices.size,
    selectedFaceCount: editor.selectedFaces.size
  });
  return report;
}

async function start() {
  cacheUi();
  app = new WebgApp({
    document,
    shaderClass: SmoothShader,
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
  detachPanModifierBridge?.();
  detachPanModifierBridge = installPanModifierBridge(app.screen.canvas);
  buildGrid();
  createInitialModel();
  installDomHandlers();
  installPointerHandlers();
  installKeyboardHandlers();
  detachModelerKeyBridge?.();
  detachModelerKeyBridge = installModelerKeyBridge();
  setTool(TOOL_SELECT);
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
