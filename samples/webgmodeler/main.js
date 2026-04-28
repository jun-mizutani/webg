// -------------------------------------------------
// webgmodeler sample
//   main.js       2026/04/28
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// -------------------------------------------------

import WebgApp from "../../webg/WebgApp.js";
import SmoothShader from "../../webg/SmoothShader.js";
import Shape from "../../webg/Shape.js";
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
import Overlay2DRenderer from "./overlay2dRenderer.js";
import EdgeWireframeOverlayRenderer from "./edgeWireframeOverlayRenderer.js";

class ModelerSmoothShader extends SmoothShader {
  // インスタンス生成時に renderer や shader が使う状態を初期化する
  constructor(gpu, options = {}) {
    // modeler では裏面も確認対象なので、描画時の culling は切る
    // frontFace は webg / WebGPU の標準どおり CCW を表として維持する
    super(gpu, {
      cullMode: "none",
      frontFace: "ccw",
      ...options
    });
  }
}

class SelectedFaceOverlayShader extends ModelerSmoothShader {
  // インスタンス生成時に renderer や shader が使う状態を初期化する
  constructor(gpu) {
    // 選択面は通常 mesh の後に重ねるため、depth buffer を更新しない
    // 同一深度の面を通すため depthCompare は less-equal にする
    super(gpu, {
      depthWriteEnabled: false,
      depthCompare: "less-equal"
    });
    // world 座標の頂点を動かすと選択面が剥がれて見えるため、vertex shader の
    // clip-space z だけをごく小さく手前へ寄せるw 比例にすることで透視除算後の
    // bias が距離に対して極端に変わらないようにする
    this.wgslSrc = this.wgslSrc.replace(
      "output.position = u.projMatrix * pos4;",
      "output.position = u.projMatrix * pos4;\n        output.position.z = max(0.0, output.position.z - 0.00045 * output.position.w);"
    );
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
  saveJsonGz: null,
  saveGlb: null,
  newScene: null,
  makeFace: null,
  flipFaces: null,
  undo: null,
  redo: null,
  objectWireframe: null,
  overlayAlpha: null,
  overlayAlphaValue: null,
  overlayMarkerColor: null,
  overlayMarkerColorValue: null,
  overlayEdgeColor: null,
  overlayEdgeColorValue: null,
  modeButtons: [],
  toolButtons: []
};

let app = null;
let meshNode = null;
let selectedFaceNode = null;
let markerRoot = null;
let gridRoot = null;
let orbit = null;
let selectedFaceShader = null;
let overlay2d = null;
let edgeOverlay = null;
let overlayEdgeCache = [];
let overlayEdgeCacheDirty = true;
let overlayEdgeUploadDirty = true;
let markerOverlayDirty = true;
let markerOverlayCameraKey = "";
let overlayAlpha = 0.65;
let overlayMarkerColor = [0.0, 0.0, 0.0];
let overlayEdgeColor = [0.0, 0.0, 0.0];
let objectWireframe = false;
let importedAsset = null;
let importedMeshes = [];
let lastSavedName = "-";
let selectionRectEl = null;
let detachModelerKeyBridge = null;
let detachTransformPointerBridge = null;
let editOperations = null;
let transformController = null;

const cameraModifier = {
  shift: false
};

const canvasClick = {
  active: false,
  pointerId: null,
  startX: 0.0,
  startY: 0.0,
  lastX: 0.0,
  lastY: 0.0,
  additive: false,
  allowRectangle: true
};

const rawInputDebug = {
  source: "idle",
  type: "",
  button: null,
  buttons: 0,
  target: "",
  insideCanvas: false,
  x: 0.0,
  y: 0.0
};
const rawInputHistory = [];
const rawInputButtonHistory = [];

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

// DOM UI から操作後も keyboard / pointer 入力が canvas へ戻るよう focus を整える
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

// KeyboardEvent の key / code を EyeRig が使う camera key 名へ正規化する
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

// 現在の orbit camera が使う pan modifier key を取得する
function getOrbitPanModifierKey() {
  return orbit?.orbit?.panModifierKey ?? INITIAL_ORBIT_BINDINGS.panModifierKey;
}

// KeyboardEvent が orbit pan modifier を押している状態か判定する
function isOrbitPanModifierEvent(ev) {
  const panModifierKey = getOrbitPanModifierKey();
  if (panModifierKey === "shift") return ev.shiftKey === true;
  if (panModifierKey === "control" || panModifierKey === "ctrl") return ev.ctrlKey === true;
  if (panModifierKey === "alt" || panModifierKey === "option") return ev.altKey === true;
  if (panModifierKey === "meta" || panModifierKey === "command" || panModifierKey === "cmd") return ev.metaKey === true;
  return false;
}

// event と InputController の状態を合わせて pan modifier の有効状態を判定する
function isOrbitPanModifierActive(ev = null) {
  const panModifierKey = getOrbitPanModifierKey();
  return (ev ? isOrbitPanModifierEvent(ev) : false)
    || cameraModifier.shift === true
    || app.input.has(panModifierKey);
}

// DOM focus に左右されず camera 用 key state を InputController へ同期する
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
  // keydown event と InputController の両方へ pan modifier 状態を同期する
  const syncPanModifier = (ev, key) => {
    if (key === panModifierKey || isOrbitPanModifierEvent(ev)) {
      cameraModifier.shift = true;
      app.input.press(panModifierKey);
      return true;
    }
    return isOrbitPanModifierActive(ev);
  };
  // Shift + Arrow の PAN を EyeRig の target 更新として即時反映する
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
  // document 全体の keydown を拾い、camera 用 key だけ InputController へ渡す
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
  // keyup で camera 用 key state と pan modifier の残留を解除する
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
  // window focus を失った時に camera key state が押しっぱなしで残らないよう解除する
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
  // WebgApp 初期化から scene / UI / handler 登録までを順に起動する
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
  ui.saveJsonGz = document.getElementById("saveJsonGz");
  ui.saveGlb = document.getElementById("saveGlb");
  ui.newScene = document.getElementById("newScene");
  ui.makeFace = document.getElementById("makeFace");
  ui.flipFaces = document.getElementById("flipFaces");
  ui.undo = document.getElementById("undo");
  ui.redo = document.getElementById("redo");
  ui.objectWireframe = document.getElementById("objectWireframe");
  ui.overlayAlpha = document.getElementById("overlayAlpha");
  ui.overlayAlphaValue = document.getElementById("overlayAlphaValue");
  ui.overlayMarkerColor = document.getElementById("overlayMarkerColor");
  ui.overlayMarkerColorValue = document.getElementById("overlayMarkerColorValue");
  ui.overlayEdgeColor = document.getElementById("overlayEdgeColor");
  ui.overlayEdgeColorValue = document.getElementById("overlayEdgeColorValue");
  ui.modeButtons = Array.from(document.querySelectorAll("[data-mode]"));
  ui.toolButtons = Array.from(document.querySelectorAll("[data-tool]"));
  if (ui.overlayAlpha) {
    overlayAlpha = readFiniteNumber(ui.overlayAlpha.value, overlayAlpha);
  }
  if (ui.overlayMarkerColor) {
    overlayMarkerColor = hexColorToRgb(ui.overlayMarkerColor.value, overlayMarkerColor);
  }
  if (ui.overlayEdgeColor) {
    overlayEdgeColor = hexColorToRgb(ui.overlayEdgeColor.value, overlayEdgeColor);
  }
}

// UI へ表示する文字列はここでまとめる
// canvas 上の HUD だけでなく DOM 側 status へも同じ情報を出すことで、
// クリック対象や選択数の確認がしやすくなる
function updateStatus() {
  // mode や選択状態から各コマンド button を実行可能か更新する
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
  const pointerDebug = getPointerDebugSnapshot();
  const rawInput = getRawInputDebugSnapshot();
  const lines = [
    "webgmodeler",
    `mode=${editor.mode}`,
    `activeObject=${activeObject ? `${activeObject.id}:${activeObject.name}` : "-"}`,
    `objects=${editor.objects.length}`,
    `selectedObjects=${editor.selectedObjectIds.size} [${objectIds}]`,
    `objectWireframe=${objectWireframe ? "on" : "off"}`,
    `tool=${editor.tool}`,
    `vertices=${editor.vertices.length} faces=${editor.faces.length}`,
    `selectedVertices=${editor.selectedVertices.size} [${vertexIds}]`,
    `selectedFaces=${editor.selectedFaces.size} [${faceIds}]`,
    `meshSelect=${meshName}`,
    `undo=${editor.undoStack.length} redo=${editor.redoStack.length}`,
    `overlayAlpha=${overlayAlpha.toFixed(2)}`,
    `overlayMarker=${rgbToHexColor(overlayMarkerColor)} overlayEdge=${rgbToHexColor(overlayEdgeColor)}`,
    `dirty=${editor.dirty ? "yes" : "no"}`,
    `saved=${lastSavedName}`,
    `transform=${transformState.mode ?? "-"}${transformState.active ? " dragging" : ""}`,
    `keyState: L=${app?.input.has(orbitKeyMap.left) ? 1 : 0} R=${app?.input.has(orbitKeyMap.right) ? 1 : 0} U=${app?.input.has(orbitKeyMap.up) ? 1 : 0} D=${app?.input.has(orbitKeyMap.down) ? 1 : 0} Pm=${shiftActive ? 1 : 0}`,
    `rawInput=${rawInput.text}`,
    `pointer=${pointerDebug.text}`,
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
    { label: "Wire", value: objectWireframe ? "on" : "off" },
    { label: "V/F", value: `${editor.vertices.length}/${editor.faces.length}` },
    { label: "Selected", value: `o${editor.selectedObjectIds.size} v${editor.selectedVertices.size} f${editor.selectedFaces.size}` },
    { label: "Xform", value: transformState.mode ?? "-" },
    { label: "Keys", value: `A=${arrowActive ? 1 : 0} Sh=${shiftActive ? 1 : 0}` },
    { label: "Ptr", value: pointerDebug.action },
    { label: "Msg", value: editor.lastMessage }
  ], {
    x: 0,
    y: 0,
    width: 46,
    wrap: true
  });
}

// DOM control の disabled 状態を null 安全に切り替える
function setDisabled(control, disabled) {
  if (control) {
    control.disabled = disabled;
  }
}

// mode や選択状態から各コマンド button を実行可能か更新する
function updateCommandAvailability() {
  const selectedVertexCount = editor.selectedVertices.size;
  const selectedFaceCount = editor.selectedFaces.size;
  const editMode = isEditMode();
  for (const button of ui.modeButtons) {
    button.setAttribute("aria-pressed", button.dataset.mode === editor.mode ? "true" : "false");
  }
  for (const button of ui.toolButtons) {
    button.setAttribute("aria-pressed", button.dataset.tool === editor.tool ? "true" : "false");
    button.disabled = !editMode;
  }
  if (ui.objectWireframe) {
    ui.objectWireframe.setAttribute("aria-pressed", objectWireframe ? "true" : "false");
    ui.objectWireframe.disabled = editMode;
  }
  // DOM control の disabled 状態を null 安全に切り替える
  setDisabled(ui.makeFace, !editMode || (selectedVertexCount !== 3 && selectedVertexCount !== 4));
  // DOM control の disabled 状態を null 安全に切り替える
  setDisabled(ui.flipFaces, !editMode || selectedFaceCount === 0);
  // DOM control の disabled 状態を null 安全に切り替える
  setDisabled(ui.undo, editor.undoStack.length === 0);
  // DOM control の disabled 状態を null 安全に切り替える
  setDisabled(ui.redo, editor.redoStack.length === 0);
  // DOM control の disabled 状態を null 安全に切り替える
  setDisabled(ui.useMesh, !importedAsset || importedMeshes.length === 0);
  // DOM control の disabled 状態を null 安全に切り替える
  setDisabled(ui.saveJson, editor.vertices.length === 0);
  // DOM control の disabled 状態を null 安全に切り替える
  setDisabled(ui.saveJsonGz, editor.vertices.length === 0);
  // DOM control の disabled 状態を null 安全に切り替える
  setDisabled(ui.saveGlb, editor.vertices.length === 0 || editor.faces.length === 0);
}

// 最後のユーザー向け message を保存し status を更新する
function setMessage(message) {
  editor.lastMessage = String(message ?? "");
  // editor / camera / diagnostics の現在状態を DOM status と HUD へ反映する
  updateStatus();
}

// undo は編集データと選択状態だけを保存する
// Shape や Node は表示キャッシュなので履歴に入れず、復元後に rebuildScene() で作り直す
function makeSnapshot() {
  // 現在の editor.vertices / faces を active object へ書き戻す
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

// snapshot から editor 全体を復元し scene を再構築する
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
  // mesh / selected face / marker の表示をまとめて再構築する
  rebuildScene();
}

// 現在状態を undo stack へ積み、redo stack を破棄する
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

// undo stack から前状態を復元し、現在状態を redo stack へ退避する
function undo() {
  if (editor.undoStack.length === 0) {
    // 最後のユーザー向け message を保存し status を更新する
    setMessage("undo stack is empty");
    return;
  }
  editor.redoStack.push(makeSnapshot());
  const snapshot = editor.undoStack.pop();
  // snapshot から editor 全体を復元し scene を再構築する
  restoreSnapshot(snapshot);
  // 最後のユーザー向け message を保存し status を更新する
  setMessage("undo");
}

// redo stack から次状態を復元し、現在状態を undo stack へ退避する
function redo() {
  if (editor.redoStack.length === 0) {
    // 最後のユーザー向け message を保存し status を更新する
    setMessage("redo stack is empty");
    return;
  }
  editor.undoStack.push(makeSnapshot());
  const snapshot = editor.redoStack.pop();
  // snapshot から editor 全体を復元し scene を再構築する
  restoreSnapshot(snapshot);
  // 最後のユーザー向け message を保存し status を更新する
  setMessage("redo");
}

// vertex id から vertex object を引く
// 見つからない id は参照整合性の破損なので、呼び出し側が先に検証する
function getVertexById(id) {
  return editor.vertices.find((vertex) => vertex.id === id) ?? null;
}

// active object の face id から face を取得する
function getFaceById(id) {
  return editor.faces.find((face) => face.id === id) ?? null;
}

// 選択 vertex id を実際の vertex object 配列へ変換する
function getSelectedVertexObjects() {
  return Array.from(editor.selectedVertices)
    .map((id) => getVertexById(id))
    .filter((vertex) => vertex !== null);
}

// 選択 face id を実際の face object 配列へ変換する
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

// 表示上強調する vertex id を明示選択と選択 face から求める
function getHighlightedVertexIds() {
  const ids = new Set(editor.selectedVertices);
  for (const face of getSelectedFaceObjects()) {
    for (const id of face.indices) {
      ids.add(id);
    }
  }
  return ids;
}

// transform 対象 vertex id を vertex object 配列へ変換する
function getActiveVertexObjects() {
  return getActiveVertexIds()
    .map((id) => getVertexById(id))
    .filter((vertex) => vertex !== null);
}

// Object Mode で選択中 object 群の全 vertex object を集める
function getSelectedObjectVertexObjects() {
  // 現在の editor.vertices / faces を active object へ書き戻す
  commitActiveObject();
  const vertices = [];
  for (const object of editor.objects) {
    if (editor.selectedObjectIds.has(object.id)) {
      vertices.push(...object.vertices);
    }
  }
  return vertices;
}

// mode と transform 種類に応じて操作対象 vertex object を決める
function getTransformTargetVertexObjects(mode) {
  if (editor.mode === EDITOR_MODE_OBJECT) {
    return mode === "extrude" ? [] : getSelectedObjectVertexObjects();
  }
  return getActiveVertexObjects();
}

// vertex 群の平均位置を選択中心として計算する
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
    // 2 つの vec3 の差分を成分ごとに求める
    sub3(v1.position, v0.position),
    // 2 つの vec3 の差分を成分ごとに求める
    sub3(v2.position, v0.position)
  );
  const len = length3(normal);
  if (len <= 1.0e-9) {
    return [0.0, 1.0, 0.0];
  }
  return [normal[0] / len, normal[1] / len, normal[2] / len];
}

// 指定 vertex loop の法線を頂点 id から計算する
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
    // 2 つの vec3 の差分を成分ごとに求める
    sub3(v1.position, v0.position),
    // 2 つの vec3 の差分を成分ごとに求める
    sub3(v2.position, v0.position)
  );
  const len = length3(normal);
  if (len <= 1.0e-9) {
    return [0.0, 1.0, 0.0];
  }
  return [normal[0] / len, normal[1] / len, normal[2] / len];
}

// face loop の頂点順を反転して表裏を入れ替える
function reverseVertexLoop(vertexIds) {
  return [...vertexIds].reverse();
}

// loop 内で edge がどちら向きに並んでいるかを調べる
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

// 孤立 face の法線が原点側を表にしないよう反転要否を判定する
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

// 隣接 face の共有辺と逆向きになるよう新規 loop の向きを調整する
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

// 全 face の winding を connected component ごとにできるだけ一貫させる
function orientAllFacesConsistently() {
  const edgeMap = new Map();
  // 共有辺を向きに依存しない key として扱い、隣接 face を探索しやすくする
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

// 選択 face または選択 vertex 周辺から transform 用の代表法線を求める
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

// active object の編集データから保存用 ModelAsset を作る
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
    const localLoop = [];
    for (const vertexId of face.indices) {
      const vertex = getVertexById(vertexId);
      if (!vertex) {
        throw new Error(`selected face ${face.id} references missing vertex ${vertexId}`);
      }
      // selected face は通常 mesh の後、edge / marker overlay の前に描く
      // 別 geometry として重ねるだけなので、world-space で法線方向へ浮かせない
      // 大きな位置 offset は薄い面や斜め視点で「剥がれた別ポリゴン」に見えるため避ける
      const p = vertex.position;
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

// ModelAsset から Shape を生成し material と shader を設定する
function makeShapeFromAsset(asset, materialParams, shader = null) {
  const shape = new Shape(app.getGL());
  if (shader) {
    shape.shader = shader;
  }
  shape.applyPrimitiveAsset(asset);
  shape.endShape();
  shape.setMaterial("smooth-shader", materialParams);
  return shape;
}

// 既存 Shape の geometry resource を共有する表示 instance を作る
function makeShapeInstance(baseShape, materialParams = null, shader = null) {
  const shape = new Shape(app.getGL());
  if (shader) {
    shape.shader = shader;
  }
  shape.referShape(baseShape);
  shape.copyShaderParamsFromShape(baseShape);
  if (materialParams) {
    shape.setMaterial("smooth-shader", materialParams);
  }
  return shape;
}

// scene graph から node subtree を shape 破棄込みで取り除く
function removeNodeTree(node) {
  if (node) {
    app.space.removeNodeTree(node, { destroyShapes: true });
  }
}

// 全 object の mesh Shape を編集データから再構築する
function rebuildMeshShape() {
  // 現在の editor.vertices / faces を active object へ書き戻す
  commitActiveObject();
  // scene graph から node subtree を shape 破棄込みで取り除く
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
    // Object Mode の wireframe は Shape が保持する polygonLoops から線を作る
    // color は materialParams 側の値をそのまま使い、edge overlay 用の黒や選択 face 用の黄色を混ぜない
    // そのため object の通常色を保ったまま、Quad / addPolygon の face loop 外周だけを表示できる
    if (editor.mode === EDITOR_MODE_OBJECT && objectWireframe) {
      shape.setWireframe(true);
    }
    const node = app.space.addNode(meshNode, `object-${object.id}`);
    node.webgmodelerKind = "object";
    node.webgmodelerObjectId = object.id;
    node.addShape(shape);
  }
}

// Edit Mode の選択 face overlay Shape を再構築する
function rebuildSelectedFaceShape() {
  // scene graph から node subtree を shape 破棄込みで取り除く
  removeNodeTree(selectedFaceNode);
  selectedFaceNode = null;
  if (!isEditMode()) {
    return;
  }
  const asset = buildSelectedFaceAsset();
  if (!asset) {
    return;
  }
  const shape = makeShapeFromAsset(asset, MATERIAL.selectedFace, selectedFaceShader);
  selectedFaceNode = app.space.addNode(null, "webgmodeler-selected-faces");
  selectedFaceNode.addShape(shape);
}

// 旧 3D marker node を使わないため marker root を空に保つ
function rebuildMarkers() {
  // scene graph から node subtree を shape 破棄込みで取り除く
  removeNodeTree(markerRoot);
  markerRoot = null;
}

// mesh / selected face / marker の表示をまとめて再構築する
function rebuildScene() {
  overlayEdgeCacheDirty = true;
  overlayEdgeUploadDirty = true;
  markerOverlayDirty = true;
  // 全 object の mesh Shape を編集データから再構築する
  rebuildMeshShape();
  // Edit Mode の選択 face overlay Shape を再構築する
  rebuildSelectedFaceShape();
  // 旧 3D marker node を使わないため marker root を空に保つ
  rebuildMarkers();
  // editor / camera / diagnostics の現在状態を DOM status と HUD へ反映する
  updateStatus();
}

// vertex id から vertex object を引く Map を作る
function buildVertexLookup(vertices = editor.vertices) {
  const lookup = new Map();
  for (const vertex of vertices) {
    lookup.set(vertex.id, vertex);
  }
  return lookup;
}

// 行列を丸めた文字列 key にして camera 変化検出へ使う
function matrixKey(matrix, precision = 100000) {
  return Array.from(matrix.mat, (value) => Math.round(Number(value) * precision)).join(",");
}

// marker overlay の再投影が必要か判定する camera key を作る
function makeMarkerOverlayCameraKey(viewProjection, canvas) {
  // marker は screen-space quad なので、camera/projection/canvas size が同じなら
  // 静止中に全頂点を再投影する必要はない
  return [
    canvas.width,
    canvas.height,
    // 行列を丸めた文字列 key にして camera 変化検出へ使う
    matrixKey(viewProjection)
  ].join("|");
}

// edge overlay の line-list 頂点を geometry から再構築する
function rebuildEdgeOverlayBuffer() {
  if (!edgeOverlay) {
    return;
  }
  edgeOverlay.clear();
  const vertexLookup = buildVertexLookup();
  for (const edge of getUniqueOverlayEdges()) {
    const va = vertexLookup.get(edge.a);
    const vb = vertexLookup.get(edge.b);
    if (!va || !vb) {
      continue;
    }
    edgeOverlay.addLine(va.position, vb.position, getOverlayEdgeColor(edge));
  }
  overlayEdgeUploadDirty = false;
}

// vertex marker overlay を現在 camera で再投影して buffer を作り直す
function rebuildMarkerOverlayBuffer(viewProjection, canvas, markerRadiusX, markerRadiusY) {
  if (!overlay2d) {
    return;
  }
  overlay2d.clear();
  const highlightedVertexIds = getHighlightedVertexIds();
  for (const vertex of editor.vertices) {
    const p = projectWorldToNdc(viewProjection, vertex.position, 0.00035);
    if (!p) {
      continue;
    }
    overlay2d.addMarker(
      p[0],
      p[1],
      p[2],
      markerRadiusX,
      markerRadiusY,
      // 選択状態に応じて marker overlay の色と alpha を決める
      getOverlayMarkerColor(highlightedVertexIds.has(vertex.id))
    );
  }
  markerOverlayDirty = false;
}

// Edit Mode の edge と marker overlay を scene 描画後に重ねる
function drawEditOverlayPass() {
  if (!overlay2d || !isEditMode() || !app?.eye || !app?.projectionMatrix) {
    return;
  }
  app.eye.setWorldMatrix();
  const view = new Matrix();
  view.makeView(app.eye.worldMatrix);
  const viewProjection = app.projectionMatrix.clone();
  viewProjection.mul_(view);
  const canvas = app.screen.canvas;
  const markerRadiusPx = 2.5;
  const markerRadiusX = markerRadiusPx * 2.0 / Math.max(1, canvas.width);
  const markerRadiusY = markerRadiusPx * 2.0 / Math.max(1, canvas.height);

  if (edgeOverlay) {
    edgeOverlay.setMatrices(app.projectionMatrix, view);
    if (overlayEdgeUploadDirty) {
      // edge overlay の line-list 頂点を geometry から再構築する
      rebuildEdgeOverlayBuffer();
    }
    edgeOverlay.draw();
  }

  const cameraKey = makeMarkerOverlayCameraKey(viewProjection, canvas);
  if (markerOverlayDirty || markerOverlayCameraKey !== cameraKey) {
    // vertex marker overlay を現在 camera で再投影して buffer を作り直す
    rebuildMarkerOverlayBuffer(viewProjection, canvas, markerRadiusX, markerRadiusY);
    markerOverlayCameraKey = cameraKey;
  }
  overlay2d.draw();
}

// 初期状態で奥行きと高さが読みやすいよう、薄い床 grid を置く
// grid は編集対象ではなく、ray pick の filter でも除外する
function buildGrid() {
  // scene graph から node subtree を shape 破棄込みで取り除く
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

// vertex 群の bounding box と中心と代表 size を計算する
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

// 全 object を含む editor 全体の bounds を取得する
function getEditorBounds() {
  // 現在の editor.vertices / faces を active object へ書き戻す
  commitActiveObject();
  const vertices = editor.objects.length > 0
    ? editor.objects.flatMap((object) => object.vertices)
    : editor.vertices;
  return computeBoundsForVertices(vertices);
}

// active object だけの bounds を取得する
function getActiveObjectBounds() {
  // 現在の editor.vertices / faces を active object へ書き戻す
  commitActiveObject();
  const object = getActiveObject();
  return computeBoundsForVertices(object?.vertices ?? editor.vertices);
}

// active object と camera 距離から 3D marker 判定用半径を決める
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

// 選択状態に応じて marker overlay の色と alpha を決める
function getOverlayMarkerColor(selected) {
  if (selected) {
    return [0.95, 0.08, 0.08, Math.max(overlayAlpha, 0.85)];
  }
  return [overlayMarkerColor[0], overlayMarkerColor[1], overlayMarkerColor[2], overlayAlpha];
}

// DOM color input の hex 文字列を shader 用 RGB 配列へ変換する
function hexColorToRgb(value, fallback = [0.0, 0.0, 0.0]) {
  const text = String(value ?? "").trim();
  const match = /^#?([0-9a-fA-F]{6})$/.exec(text);
  if (!match) {
    return [...fallback];
  }
  const hex = match[1];
  return [
    parseInt(hex.slice(0, 2), 16) / 255.0,
    parseInt(hex.slice(2, 4), 16) / 255.0,
    parseInt(hex.slice(4, 6), 16) / 255.0
  ];
}

// RGB 配列を DOM color input 用 hex 文字列へ変換する
function rgbToHexColor(color) {
  // 0.0 から 1.0 の色成分を DOM color input 用の 2 桁 hex へ変換する
  const toHex = (value) => {
    const byte = Math.max(0, Math.min(255, Math.round((Number(value) || 0) * 255)));
    return byte.toString(16).padStart(2, "0");
  };
  return `#${toHex(color?.[0])}${toHex(color?.[1])}${toHex(color?.[2])}`;
}

// Matrix の raw 配列を使って 4D vector 変換を行う
function multiplyMatrixVectorRaw(matrix, point) {
  const m = matrix.mat;
  const x = point[0];
  const y = point[1];
  const z = point[2];
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
    m[3] * x + m[7] * y + m[11] * z + m[15]
  ];
}

// world 座標を clip / NDC 座標へ投影し overlay 用 z bias を適用する
function projectWorldToNdc(viewProjection, point, zBias = 0.00035) {
  const clip = multiplyMatrixVectorRaw(viewProjection, point);
  const w = clip[3];
  if (!Number.isFinite(w) || w <= 1.0e-6) {
    return null;
  }
  const x = clip[0] / w;
  const y = clip[1] / w;
  const z = clip[2] / w;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return null;
  }
  if (x < -1.2 || x > 1.2 || y < -1.2 || y > 1.2 || z < -0.02 || z > 1.02) {
    return null;
  }
  return [x, y, Math.max(0.0, Math.min(1.0, z - zBias))];
}

// 現在 camera の viewProjection 行列を作る
function getCurrentViewProjectionMatrix() {
  app.eye.setWorldMatrix();
  const view = new Matrix();
  view.makeView(app.eye.worldMatrix);
  const viewProjection = app.projectionMatrix.clone();
  viewProjection.mul_(view);
  return viewProjection;
}

// world 座標をブラウザ client 座標へ投影する
function projectWorldToClient(viewProjection, point) {
  const ndc = projectWorldToNdc(viewProjection, point, 0.0);
  if (!ndc) {
    return null;
  }
  const rect = app.screen.canvas.getBoundingClientRect();
  return {
    x: rect.left + ((ndc[0] + 1.0) * 0.5) * rect.width,
    y: rect.top + ((1.0 - ndc[1]) * 0.5) * rect.height,
    z: ndc[2]
  };
}

// 2 点の client 座標から矩形範囲を作る
function makeClientRect(x0, y0, x1, y1) {
  return {
    left: Math.min(x0, x1),
    right: Math.max(x0, x1),
    top: Math.min(y0, y1),
    bottom: Math.max(y0, y1)
  };
}

// client 座標点が矩形内にあるか判定する
function clientPointInRect(point, rect) {
  return point
    && point.x >= rect.left
    && point.x <= rect.right
    && point.y >= rect.top
    && point.y <= rect.bottom;
}

// face loop から重複なしの edge 一覧を作って cache する
function getUniqueOverlayEdges() {
  if (!overlayEdgeCacheDirty) {
    return overlayEdgeCache;
  }
  const edges = new Map();
  for (const face of editor.faces) {
    for (let i = 0; i < face.indices.length; i++) {
      const a = face.indices[i];
      const b = face.indices[(i + 1) % face.indices.length];
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (!edges.has(key)) {
        edges.set(key, {
          a,
          b,
          faceIds: new Set()
        });
      }
      edges.get(key).faceIds.add(face.id);
    }
  }
  overlayEdgeCache = Array.from(edges.values());
  overlayEdgeCacheDirty = false;
  return overlayEdgeCache;
}

// 選択 face 境界かどうかで edge overlay の色を決める
function getOverlayEdgeColor(edge) {
  const selectedFace = Array.from(edge.faceIds).some((id) => editor.selectedFaces.has(id));
  if (selectedFace) {
    return [0.0, 0.0, 0.0, Math.max(overlayAlpha, 0.92)];
  }
  return [overlayEdgeColor[0], overlayEdgeColor[1], overlayEdgeColor[2], overlayAlpha];
}

// editor bounds に合わせて orbit camera の target と距離を調整する
function fitCameraToEditor() {
  const bounds = getEditorBounds();
  const distance = Math.max(4.0, bounds.size * 2.8);
  orbit.setTarget(bounds.center[0], bounds.center[1], bounds.center[2]);
  orbit.orbit.minDistance = Math.max(0.5, bounds.size * 0.15);
  orbit.orbit.maxDistance = Math.max(32.0, bounds.size * 12.0);
  orbit.orbit.wheelZoomStep = Math.max(0.2, bounds.size * 0.09);
  orbit.orbit.keyZoomSpeed = Math.max(1.0, bounds.size * 0.6);
  orbit.setAngles(DEFAULT_CAMERA.yaw, DEFAULT_CAMERA.pitch, 0.0);
  orbit.setDistance(distance);
  app.syncCameraFromEyeRig(orbit);
}

// activeObjectId に対応する object を取得する
function getActiveObject() {
  return editor.objects.find((object) => object.id === editor.activeObjectId) ?? null;
}

// 現在の editor.vertices / faces を active object へ書き戻す
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

// 指定 object を active にし、編集配列をその object へ接続する
function activateObject(id, { clearEditSelection = true } = {}) {
  // 現在の editor.vertices / faces を active object へ書き戻す
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
    // edit selection の vertex / face を空にする
    clearSelection();
  }
  return true;
}

// import などで object 一覧を丸ごと差し替えて active object を設定する
function replaceObjectsAndActivate(objects, activeObjectId, {
  selectedObjectIds = [activeObjectId],
  mode = EDITOR_MODE_OBJECT
} = {}) {
  // import / new scene のように editor.objects 全体を差し替える場面では、
  // 差し替え前の activeObjectId が新しい object id と偶然一致することがある
  // その状態で activateObject() を直接呼ぶと、activateObject() 冒頭の
  // commitActiveObject() が古い editor.vertices / faces を新しい object へ
  // 書き戻してしまうhand.glb を読み込んでも cube が残って見えた原因がこれである
  //
  // ここでは一度 activeObjectId を null にして、古い編集バッファを commit しない
  // 状態を明示的に作ってから新しい object を activate する
  if (!Array.isArray(objects) || objects.length === 0) {
    throw new Error("replaceObjectsAndActivate requires at least one object");
  }
  const active = objects.find((object) => object.id === activeObjectId);
  if (!active) {
    throw new Error(`replaceObjectsAndActivate missing active object ${activeObjectId}`);
  }
  editor.objects = objects;
  editor.nextObjectId = Math.max(...objects.map((object) => object.id)) + 1;
  editor.selectedObjectIds = new Set(selectedObjectIds);
  editor.mode = mode;
  editor.activeObjectId = null;
  editor.vertices = [];
  editor.faces = [];
  editor.nextVertexId = 1;
  editor.nextFaceId = 1;
  // 指定 object を active にし、編集配列をその object へ接続する
  activateObject(activeObjectId);
}

// 現在 mode が Edit Mode か判定する
function isEditMode() {
  return editor.mode === EDITOR_MODE_EDIT;
}

// 現在の編集配列から単一 object 状態を作り直す
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

// Object Mode の object 選択を追加または置換する
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
    // 指定 object を active にし、編集配列をその object へ接続する
    activateObject(id);
  }
  return true;
}

// 入力 mode 名を有効な editor mode へ正規化する
function normalizeEditorMode(mode) {
  const normalized = String(mode ?? "").trim();
  if (!EDITOR_MODES.has(normalized)) {
    throw new Error(`unknown editor mode: ${mode}`);
  }
  return normalized;
}

// Object / Edit Mode を切り替えて表示と選択状態を更新する
function setEditorMode(mode) {
  const normalized = normalizeEditorMode(mode);
  if (editor.mode === normalized) {
    // editor / camera / diagnostics の現在状態を DOM status と HUD へ反映する
    updateStatus();
    return;
  }
  // transformController の cancel を UI へ中継する
  cancelTransformMode();
  editor.mode = normalized;
  if (normalized === EDITOR_MODE_OBJECT) {
    // edit selection の vertex / face を空にする
    clearSelection();
    if (editor.activeObjectId !== null) {
      editor.selectedObjectIds = new Set([editor.activeObjectId]);
    }
  } else {
    // Edit Mode では vertex marker / edge overlay / selected face overlay が主役になる
    // Object Wireframe を残すと通常 mesh が line-list 化され、overlay の見え方と役割が混ざるため解除する
    objectWireframe = false;
    if (!getActiveObject() && editor.objects.length > 0) {
      // Object Mode の object 選択を追加または置換する
      selectObject(editor.objects[0].id, false);
    }
  }
  // mesh / selected face / marker の表示をまとめて再構築する
  rebuildScene();
  // 最後のユーザー向け message を保存し status を更新する
  setMessage(`${normalized} mode`);
}

// 入力 tool 名を有効な tool 名へ正規化する
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

// Edit Mode の選択 / 追加 tool を切り替える
function setTool(tool) {
  editor.tool = normalizeToolName(tool);
  if (!isEditMode()) {
    // Object / Edit Mode を切り替えて表示と選択状態を更新する
    setEditorMode(EDITOR_MODE_EDIT);
    return;
  }
  // 最後のユーザー向け message を保存し status を更新する
  setMessage(`tool ${editor.tool}`);
}

// 編集データへ新しい vertex を追加して id を返す
function addVertex(position) {
  const id = editor.nextVertexId++;
  editor.vertices.push({
    id,
    position: readVec3(position, `vertex ${id}`)
  });
  return id;
}

// 編集データへ新しい face を追加して id を返す
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

// 隣接面や原点基準で向きを安定させて face を追加する
function addFaceWithStableOrientation(vertexIds) {
  return addFace(orientLoopByAdjacentFaces(vertexIds));
}

// 指定方向に法線が向くよう頂点順を調整して face を追加する
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

// 起動時の初期 cube object を作り scene と camera を初期化する
function createInitialModel() {
  editor.vertices = [];
  editor.faces = [];
  editor.selectedVertices = new Set();
  editor.selectedFaces = new Set();
  editor.nextVertexId = 1;
  editor.nextFaceId = 1;
  editor.undoStack = [];
  editor.redoStack = [];
  // 編集データへ新しい vertex を追加して id を返す
  addVertex([-1.0, 0.0, -1.0]);
  // 編集データへ新しい vertex を追加して id を返す
  addVertex([1.0, 0.0, -1.0]);
  // 編集データへ新しい vertex を追加して id を返す
  addVertex([1.0, 0.0, 1.0]);
  // 編集データへ新しい vertex を追加して id を返す
  addVertex([-1.0, 0.0, 1.0]);
  // 編集データへ新しい vertex を追加して id を返す
  addVertex([-1.0, 2.0, -1.0]);
  // 編集データへ新しい vertex を追加して id を返す
  addVertex([1.0, 2.0, -1.0]);
  // 編集データへ新しい vertex を追加して id を返す
  addVertex([1.0, 2.0, 1.0]);
  // 編集データへ新しい vertex を追加して id を返す
  addVertex([-1.0, 2.0, 1.0]);
  // 編集データへ新しい face を追加して id を返す
  addFace([1, 2, 3, 4]);
  // 編集データへ新しい face を追加して id を返す
  addFace([5, 6, 7, 8]);
  // 編集データへ新しい face を追加して id を返す
  addFace([1, 2, 6, 5]);
  // 編集データへ新しい face を追加して id を返す
  addFace([2, 3, 7, 6]);
  // 編集データへ新しい face を追加して id を返す
  addFace([3, 4, 8, 7]);
  // 編集データへ新しい face を追加して id を返す
  addFace([4, 1, 5, 8]);
  // 全 face の winding を connected component ごとにできるだけ一貫させる
  orientAllFacesConsistently();
  // 現在の編集配列から単一 object 状態を作り直す
  resetObjectState("Cube");
  editor.mode = EDITOR_MODE_OBJECT;
  editor.dirty = false;
  editor.lastMessage = "new model";
  // mesh / selected face / marker の表示をまとめて再構築する
  rebuildScene();
  // editor bounds に合わせて orbit camera の target と距離を調整する
  fitCameraToEditor();
}

// edit selection の vertex / face を空にする
function clearSelection() {
  editor.selectedVertices.clear();
  editor.selectedFaces.clear();
}

// 選択 face の構成 vertex を selectedVertices へ同期する
function syncSelectedVerticesFromSelectedFaces() {
  editor.selectedVertices.clear();
  for (const face of getSelectedFaceObjects()) {
    for (const id of face.indices) {
      editor.selectedVertices.add(id);
    }
  }
}

// 全頂点が選択された face を selectedFaces へ同期する
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

// vertex を選択または Shift 追加選択で切り替える
function selectVertex(id, additive = false) {
  if (!additive) {
    // edit selection の vertex / face を空にする
    clearSelection();
  }
  if (editor.selectedVertices.has(id) && additive) {
    editor.selectedVertices.delete(id);
  } else {
    editor.selectedVertices.add(id);
  }
  // 全頂点が選択された face を selectedFaces へ同期する
  syncSelectedFacesFromSelectedVertices();
}

// face を選択または Shift 追加選択で切り替え、構成 vertex も同期する
function selectFace(id, additive = false) {
  if (!additive) {
    // edit selection の vertex / face を空にする
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
  // 選択 face の構成 vertex を selectedVertices へ同期する
  syncSelectedVerticesFromSelectedFaces();
}

// Object Mode / Edit Mode に応じた全選択を行う
function selectAllForCurrentMode() {
  // transformController の cancel を UI へ中継する
  cancelTransformMode();
  if (editor.mode === EDITOR_MODE_OBJECT) {
    // 現在の editor.vertices / faces を active object へ書き戻す
    commitActiveObject();
    editor.selectedObjectIds = new Set(editor.objects.map((object) => object.id));
    if (!getActiveObject() && editor.objects.length > 0) {
      // 指定 object を active にし、編集配列をその object へ接続する
      activateObject(editor.objects[0].id);
    }
    // mesh / selected face / marker の表示をまとめて再構築する
    rebuildScene();
    // 最後のユーザー向け message を保存し status を更新する
    setMessage(`selected all objects (${editor.selectedObjectIds.size})`);
    return;
  }

  editor.selectedVertices = new Set(editor.vertices.map((vertex) => vertex.id));
  // 全頂点が選択された face を selectedFaces へ同期する
  syncSelectedFacesFromSelectedVertices();
  // mesh / selected face / marker の表示をまとめて再構築する
  rebuildScene();
  // 最後のユーザー向け message を保存し status を更新する
  setMessage(`selected all vertices (${editor.selectedVertices.size})`);
}

// editOperations の削除処理を UI から呼び出す薄い wrapper
function deleteSelected() {
  if (editor.mode === EDITOR_MODE_OBJECT) {
    deleteSelectedObjects();
    return;
  }
  editOperations.deleteSelected();
}

// Object Mode で選択 object を削除する
// active object の編集配列を object 一覧へ書き戻してから削除し、残った object を新しい active にする
function deleteSelectedObjects() {
  if (editor.mode !== EDITOR_MODE_OBJECT) {
    setMessage("switch to object mode before deleting objects");
    return;
  }
  if (editor.selectedObjectIds.size === 0) {
    setMessage("select objects before deleting objects");
    return;
  }
  pushUndo("delete objects");
  commitActiveObject();
  const removedIds = new Set(editor.selectedObjectIds);
  editor.objects = editor.objects.filter((object) => !removedIds.has(object.id));
  editor.selectedObjectIds.clear();
  editor.activeObjectId = null;
  editor.vertices = [];
  editor.faces = [];
  editor.nextVertexId = 1;
  editor.nextFaceId = 1;
  if (editor.objects.length > 0) {
    const nextObject = editor.objects[0];
    editor.selectedObjectIds = new Set([nextObject.id]);
    // 指定 object を active にし、編集配列をその object へ接続する
    activateObject(nextObject.id);
  }
  // edit selection の vertex / face を空にする
  clearSelection();
  // mesh / selected face / marker の表示をまとめて再構築する
  rebuildScene();
  // 最後のユーザー向け message を保存し status を更新する
  setMessage(`deleted ${removedIds.size} object(s)`);
}

// Object Mode で mesh 本体を Wireframe shader に切り替える
// Edit Mode の edge overlay とは別に、object 全体の面ループを Shape.setWireframe() で確認する
function toggleObjectWireframe() {
  if (editor.mode !== EDITOR_MODE_OBJECT) {
    setMessage("switch to object mode before wireframe display");
    return;
  }
  objectWireframe = !objectWireframe;
  // mesh / selected face / marker の表示をまとめて再構築する
  rebuildScene();
  // 最後のユーザー向け message を保存し status を更新する
  setMessage(`object wireframe ${objectWireframe ? "on" : "off"}`);
}

// editOperations の face 作成処理を UI / keyboard から呼び出す薄い wrapper
function makeFaceFromSelection(size = null) {
  editOperations.makeFaceFromSelection(size);
}

// editOperations の extrusion 作成処理を transform から呼べるよう中継する
function createExtrusion(distance) {
  return editOperations.createExtrusion(distance);
}

// editOperations の即時 extrude 処理を呼び出す
function extrudeSelectedFaces() {
  editOperations.extrudeSelectedFaces();
}

// editOperations の face 反転処理を呼び出す
function flipSelectedFaces() {
  editOperations.flipSelectedFaces();
}

// canvas 上の client 座標を NDC 座標へ変換する
function cssToNdc(canvas, clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const x = ((clientX - rect.left) / rect.width) * 2.0 - 1.0;
  const y = 1.0 - ((clientY - rect.top) / rect.height) * 2.0;
  return [x, y];
}

// mouse client 座標から world 空間の pick ray を作る
function makeRayFromMouse(canvas, clientX, clientY) {
  app.eye.setWorldMatrix();
  const view = new Matrix();
  view.makeView(app.eye.worldMatrix);
  const [nx, ny] = cssToNdc(canvas, clientX, clientY);
  const invVp = app.projectionMatrix.clone();
  invVp.mul_(view);
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

// pick ray と plane の交点を求める
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

// 任意の vertex 配列から id 一致の vertex を探す
function getVertexByIdFromList(vertices, id) {
  return vertices.find((vertex) => vertex.id === id) ?? null;
}

// 指定 object 内で ray に最も近く当たる face を探す
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

// active object 内で ray に当たる face を探す
function pickFace(ray) {
  const object = getActiveObject();
  if (!object) {
    return null;
  }
  return pickFaceInObject(ray, object);
}

// 全 object から ray に最も近く当たる object face を探す
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

// 旧 marker Node pick の入口を残し、現在は null を返す
function pickVertexMarker(ray) {
  // vertex marker は 2D overlay pass で描くため、Space 上には marker Node を作らない
  // 頂点選択は pickVertexByRayDistance() が主経路なので、旧 marker Node raycast は使わない
  return null;
}

// camera の right / up / forward 方向を world 空間で取得する
function getCameraScreenBasis() {
  app.eye.setWorldMatrix();
  const eyeMatrix = app.eye.getWorldMatrix();
  return {
    right: normalize3(eyeMatrix.mul3x3Vector([1.0, 0.0, 0.0]), "camera right"),
    up: normalize3(eyeMatrix.mul3x3Vector([0.0, 1.0, 0.0]), "camera up"),
    forward: normalize3(eyeMatrix.mul3x3Vector([0.0, 0.0, -1.0]), "camera forward")
  };
}

// ray と vertex の最短距離からクリック対象 vertex を探す
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

// Shift が押されているかを見て追加選択か判定する
function isAdditiveSelectionEvent(ev) {
  return ev.shiftKey === true || app.input.has("shift");
}

// 左ドラッグ矩形選択は modifier なしの左ドラッグだけで開始する
// Option + 左ドラッグは macOS 向け orbit fallback、Ctrl + 左ドラッグは drag zoom fallback、
// Shift + 左ドラッグは fallback PAN へ使うため、選択矩形としては扱わない
function isPlainLeftDragSelectionEvent(ev) {
  return ev.button === 0
    && ev.shiftKey !== true
    && ev.ctrlKey !== true
    && ev.altKey !== true
    && ev.metaKey !== true
    && !app.input.has("shift")
    && !app.input.has("control")
    && !app.input.has("ctrl")
    && !app.input.has("alt")
    && !app.input.has("option")
    && !app.input.has("meta")
    && !app.input.has("command")
    && !app.input.has("cmd");
}

// 左クリックを mode / tool に応じた選択または頂点追加として処理する
function handleCanvasClick(ev) {
  const ray = makeRayFromMouse(app.screen.canvas, ev.clientX, ev.clientY);

  if (editor.mode === EDITOR_MODE_OBJECT) {
    const faceHit = pickObjectFace(ray);
    if (faceHit && selectObject(faceHit.objectId, isAdditiveSelectionEvent(ev))) {
      // mesh / selected face / marker の表示をまとめて再構築する
      rebuildScene();
      // 最後のユーザー向け message を保存し status を更新する
      setMessage(`selected object ${getActiveObject()?.name ?? editor.activeObjectId}`);
      return;
    }
    if (!isAdditiveSelectionEvent(ev)) {
      editor.selectedObjectIds.clear();
      // mesh / selected face / marker の表示をまとめて再構築する
      rebuildScene();
      // 最後のユーザー向け message を保存し status を更新する
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
      // 最後のユーザー向け message を保存し status を更新する
      setMessage("could not place vertex from this view");
      ev.preventDefault();
      return;
    }
    // 現在状態を undo stack へ積み、redo stack を破棄する
    pushUndo("add vertex");
    const id = addVertex(planeHit);
    // vertex を選択または Shift 追加選択で切り替える
    selectVertex(id, false);
    // mesh / selected face / marker の表示をまとめて再構築する
    rebuildScene();
    // 最後のユーザー向け message を保存し status を更新する
    setMessage(`added vertex ${id}`);
    return;
  }

  const marker = editor.tool === TOOL_SELECT_VERTEX
    ? (pickVertexByRayDistance(ray) ?? pickVertexMarker(ray))
    : null;
  if (editor.tool === TOOL_SELECT_VERTEX && marker) {
    // vertex を選択または Shift 追加選択で切り替える
    selectVertex(marker.vertexId, isAdditiveSelectionEvent(ev));
    // mesh / selected face / marker の表示をまとめて再構築する
    rebuildScene();
    // 最後のユーザー向け message を保存し status を更新する
    setMessage(`selected vertex ${marker.vertexId}`);
    return;
  }

  if (editor.tool === TOOL_SELECT_FACE) {
    const faceHit = pickFace(ray);
    if (faceHit) {
      // face を選択または Shift 追加選択で切り替え、構成 vertex も同期する
      selectFace(faceHit.faceId, isAdditiveSelectionEvent(ev));
      // mesh / selected face / marker の表示をまとめて再構築する
      rebuildScene();
      // 最後のユーザー向け message を保存し status を更新する
      setMessage(`selected face ${faceHit.faceId} with vertices`);
      return;
    }
  }

  if (!isAdditiveSelectionEvent(ev)) {
    // edit selection の vertex / face を空にする
    clearSelection();
    // mesh / selected face / marker の表示をまとめて再構築する
    rebuildScene();
    // 最後のユーザー向け message を保存し status を更新する
    setMessage("selection cleared");
  }
}

// 左クリック / 矩形選択 tracking 状態を初期化する
function resetCanvasClick() {
  canvasClick.active = false;
  canvasClick.pointerId = null;
  // 矩形選択表示を非表示にする
  hideSelectionRect();
}

// 矩形選択表示用 DOM 要素を必要に応じて作成する
function ensureSelectionRectElement() {
  if (selectionRectEl?.isConnected) {
    return selectionRectEl;
  }
  const canvas = app?.screen?.canvas ?? null;
  const parent = canvas?.parentElement ?? null;
  if (!canvas || !parent) {
    return null;
  }
  selectionRectEl = document.createElement("div");
  selectionRectEl.className = "selection-rect";
  parent.appendChild(selectionRectEl);
  return selectionRectEl;
}

// 矩形選択表示を非表示にする
function hideSelectionRect() {
  if (selectionRectEl) {
    selectionRectEl.style.display = "none";
  }
}

// ドラッグ開始点と現在点から矩形選択 DOM の位置と大きさを更新する
function updateSelectionRectElement() {
  const el = ensureSelectionRectElement();
  const canvas = app?.screen?.canvas ?? null;
  if (!el || !canvas) {
    return;
  }
  const canvasRect = canvas.getBoundingClientRect();
  const dragRect = makeClientRect(
    canvasClick.startX,
    canvasClick.startY,
    canvasClick.lastX,
    canvasClick.lastY
  );
  const left = Math.max(canvasRect.left, dragRect.left) - canvasRect.left;
  const top = Math.max(canvasRect.top, dragRect.top) - canvasRect.top;
  const right = Math.min(canvasRect.right, dragRect.right) - canvasRect.left;
  const bottom = Math.min(canvasRect.bottom, dragRect.bottom) - canvasRect.top;
  el.style.display = "block";
  el.style.left = `${Math.max(0, left)}px`;
  el.style.top = `${Math.max(0, top)}px`;
  el.style.width = `${Math.max(0, right - left)}px`;
  el.style.height = `${Math.max(0, bottom - top)}px`;
}

// 現在の左ドラッグが矩形選択表示を出す距離に達したか判定する
function shouldShowSelectionRect() {
  if (!canvasClick.active) {
    return false;
  }
  if (!canvasClick.allowRectangle) {
    return false;
  }
  if (editor.mode === EDITOR_MODE_EDIT && editor.tool === TOOL_ADD_VERTEX) {
    return false;
  }
  const distance = Math.hypot(canvasClick.lastX - canvasClick.startX, canvasClick.lastY - canvasClick.startY);
  return distance > 4.0;
}

// face を構成する vertex の平均位置を face center として求める
function getFaceCenterFromVertices(face, vertices) {
  const points = face.indices
    .map((id) => getVertexByIdFromList(vertices, id))
    .filter((vertex) => vertex !== null)
    .map((vertex) => vertex.position);
  if (points.length === 0) {
    return null;
  }
  const sum = points.reduce((acc, point) => add3(acc, point), [0.0, 0.0, 0.0]);
  return mul3(sum, 1.0 / points.length);
}

// object の vertex または face center が矩形内に入るか判定する
function objectIntersectsClientRect(object, viewProjection, rect) {
  for (const vertex of object.vertices) {
    if (clientPointInRect(projectWorldToClient(viewProjection, vertex.position), rect)) {
      return true;
    }
  }
  for (const face of object.faces) {
    const center = getFaceCenterFromVertices(face, object.vertices);
    if (center && clientPointInRect(projectWorldToClient(viewProjection, center), rect)) {
      return true;
    }
  }
  return false;
}

// 現在 mode / tool に応じて client 矩形内の object / vertex / face を選択する
function selectByClientRect(rect, additive = false) {
  const viewProjection = getCurrentViewProjectionMatrix();
  if (editor.mode === EDITOR_MODE_OBJECT) {
    // 現在の editor.vertices / faces を active object へ書き戻す
    commitActiveObject();
    const selectedIds = editor.objects
      .filter((object) => objectIntersectsClientRect(object, viewProjection, rect))
      .map((object) => object.id);
    if (!additive) {
      editor.selectedObjectIds.clear();
    }
    for (const id of selectedIds) {
      editor.selectedObjectIds.add(id);
    }
    if (selectedIds.length > 0) {
      // 指定 object を active にし、編集配列をその object へ接続する
      activateObject(selectedIds[0], { clearEditSelection: true });
      for (const id of selectedIds) {
        editor.selectedObjectIds.add(id);
      }
    }
    // mesh / selected face / marker の表示をまとめて再構築する
    rebuildScene();
    // 最後のユーザー向け message を保存し status を更新する
    setMessage(`box selected objects ${selectedIds.length}`);
    return selectedIds.length;
  }

  if (editor.tool === TOOL_SELECT_VERTEX) {
    const selectedIds = editor.vertices
      .filter((vertex) => clientPointInRect(projectWorldToClient(viewProjection, vertex.position), rect))
      .map((vertex) => vertex.id);
    if (!additive) {
      // edit selection の vertex / face を空にする
      clearSelection();
    }
    for (const id of selectedIds) {
      editor.selectedVertices.add(id);
    }
    // 全頂点が選択された face を selectedFaces へ同期する
    syncSelectedFacesFromSelectedVertices();
    // mesh / selected face / marker の表示をまとめて再構築する
    rebuildScene();
    // 最後のユーザー向け message を保存し status を更新する
    setMessage(`box selected vertices ${selectedIds.length}`);
    return selectedIds.length;
  }

  if (editor.tool === TOOL_SELECT_FACE) {
    const selectedIds = editor.faces
      .filter((face) => {
        const center = getFaceCenterFromVertices(face, editor.vertices);
        return center && clientPointInRect(projectWorldToClient(viewProjection, center), rect);
      })
      .map((face) => face.id);
    if (!additive) {
      // edit selection の vertex / face を空にする
      clearSelection();
    }
    for (const id of selectedIds) {
      editor.selectedFaces.add(id);
    }
    // 選択 face の構成 vertex を selectedVertices へ同期する
    syncSelectedVerticesFromSelectedFaces();
    // mesh / selected face / marker の表示をまとめて再構築する
    rebuildScene();
    // 最後のユーザー向け message を保存し status を更新する
    setMessage(`box selected faces ${selectedIds.length}`);
    return selectedIds.length;
  }
  return 0;
}

// DebugDock 用に直近の raw pointer / mouse event 情報を記録する
function updateRawInputDebug(source, ev) {
  const canvas = app?.screen?.canvas ?? null;
  const rect = canvas?.getBoundingClientRect?.() ?? null;
  const x = Number(ev?.clientX ?? 0.0);
  const y = Number(ev?.clientY ?? 0.0);
  rawInputDebug.source = source;
  rawInputDebug.type = String(ev?.type ?? "");
  rawInputDebug.button = Number.isFinite(ev?.button) ? ev.button : null;
  rawInputDebug.buttons = Number.isFinite(ev?.buttons) ? ev.buttons : 0;
  rawInputDebug.target = String(ev?.target?.tagName ?? "");
  rawInputDebug.x = Number.isFinite(x) ? x : 0.0;
  rawInputDebug.y = Number.isFinite(y) ? y : 0.0;
  rawInputDebug.insideCanvas = !!rect
    && rawInputDebug.x >= rect.left
    && rawInputDebug.x <= rect.right
    && rawInputDebug.y >= rect.top
    && rawInputDebug.y <= rect.bottom;
  const snapshot = { ...rawInputDebug };
  rawInputHistory.push(snapshot);
  if (rawInputHistory.length > 32) {
    rawInputHistory.shift();
  }
  const isButtonEvent = rawInputDebug.type.includes("down")
    || rawInputDebug.type.includes("up")
    || rawInputDebug.type.includes("click")
    || rawInputDebug.type.includes("wheel")
    || rawInputDebug.type.includes("contextmenu")
    || rawInputDebug.buttons !== 0;
  if (isButtonEvent) {
    rawInputButtonHistory.push(snapshot);
    if (rawInputButtonHistory.length > 16) {
      rawInputButtonHistory.shift();
    }
  }
}

// EyeRig pointer debug の 1 件を copy しやすい文字列へ整形する
function formatPointerDebugEntry(entry) {
  if (!entry) return "-";
  return `${entry.action} b=${entry.button ?? "-"} bs=${entry.buttons} id=${entry.pointerId ?? "-"} type=${entry.pointerType || "-"} dx=${Number(entry.dx ?? 0).toFixed(1)} dy=${Number(entry.dy ?? 0).toFixed(1)} in=${entry.inside ? 1 : 0} el=${entry.elementTag || "-"} mod=S${entry.shift ? 1 : 0}C${entry.ctrl ? 1 : 0}A${entry.alt ? 1 : 0}M${entry.meta ? 1 : 0}`;
}

// raw input debug の 1 件を copy しやすい文字列へ整形する
function formatRawInputEntry(entry) {
  if (!entry) return "-";
  return `${entry.source}:${entry.type} b=${entry.button ?? "-"} bs=${entry.buttons} target=${entry.target || "-"} in=${entry.insideCanvas ? 1 : 0} x=${Number(entry.x ?? 0).toFixed(1)} y=${Number(entry.y ?? 0).toFixed(1)}`;
}

// 現在と履歴の EyeRig pointer debug を diagnostics 用にまとめる
function getPointerDebugSnapshot() {
  const pointerDebug = orbit?.pointerDebug ?? null;
  if (!pointerDebug) {
    return {
      action: "-",
      text: "-"
    };
  }
  const text = formatPointerDebugEntry(pointerDebug);
  const history = Array.isArray(orbit?.pointerDebugHistory)
    ? orbit.pointerDebugHistory.slice(-8).map(formatPointerDebugEntry)
    : [];
  return {
    action: pointerDebug.action,
    button: pointerDebug.button ?? "-",
    buttons: pointerDebug.buttons,
    pointerId: pointerDebug.pointerId ?? "-",
    pointerType: pointerDebug.pointerType || "-",
    dx: pointerDebug.dx.toFixed(1),
    dy: pointerDebug.dy.toFixed(1),
    inside: pointerDebug.inside ? "yes" : "no",
    elementTag: pointerDebug.elementTag || "-",
    shift: pointerDebug.shift ? "yes" : "no",
    ctrl: pointerDebug.ctrl ? "yes" : "no",
    alt: pointerDebug.alt ? "yes" : "no",
    meta: pointerDebug.meta ? "yes" : "no",
    text,
    historyText: history.join(" | ")
  };
}

// 現在と履歴の raw input debug を diagnostics 用にまとめる
function getRawInputDebugSnapshot() {
  const text = formatRawInputEntry(rawInputDebug);
  const history = rawInputHistory.slice(-8).map(formatRawInputEntry);
  const buttonHistory = rawInputButtonHistory.slice(-8).map(formatRawInputEntry);
  return {
    source: rawInputDebug.source,
    type: rawInputDebug.type || "-",
    button: rawInputDebug.button ?? "-",
    buttons: rawInputDebug.buttons,
    target: rawInputDebug.target || "-",
    insideCanvas: rawInputDebug.insideCanvas ? "yes" : "no",
    x: rawInputDebug.x.toFixed(1),
    y: rawInputDebug.y.toFixed(1),
    text,
    historyText: history.join(" | "),
    buttonHistoryText: buttonHistory.join(" | ")
  };
}

// 左クリック開始を記録し、クリック選択か矩形選択かの追跡を始める
function handleCanvasPointerDown(ev) {
  // DebugDock 用に直近の raw pointer / mouse event 情報を記録する
  updateRawInputDebug("canvas", ev);
  // DOM UI から操作後も keyboard / pointer 入力が canvas へ戻るよう focus を整える
  focusModelerCanvas();
  if (ev.button !== 0) {
    // 左クリック / 矩形選択 tracking 状態を初期化する
    resetCanvasClick();
    return;
  }
  // 編集用の pick は pointerdown では実行しない
  // pointerdown の時点で scene を再生成すると、短いクリックと選択後の drag 操作を区別しにくい
  // 編集操作は左クリックの pointerup で確定し、中ボタン camera 操作とは入力ボタンで分ける
  canvasClick.active = true;
  canvasClick.pointerId = ev.pointerId;
  canvasClick.startX = ev.clientX;
  canvasClick.startY = ev.clientY;
  canvasClick.lastX = ev.clientX;
  canvasClick.lastY = ev.clientY;
  canvasClick.additive = isAdditiveSelectionEvent(ev);
  canvasClick.allowRectangle = isPlainLeftDragSelectionEvent(ev);
}

// 左ドラッグ中の位置更新と矩形表示更新を行う
function handleCanvasPointerMove(ev) {
  // DebugDock 用に直近の raw pointer / mouse event 情報を記録する
  updateRawInputDebug("canvas", ev);
  if (!canvasClick.active) {
    return;
  }
  if (canvasClick.pointerId !== null && ev.pointerId !== canvasClick.pointerId) {
    return;
  }
  canvasClick.lastX = ev.clientX;
  canvasClick.lastY = ev.clientY;
  if (shouldShowSelectionRect()) {
    // ドラッグ開始点と現在点から矩形選択 DOM の位置と大きさを更新する
    updateSelectionRectElement();
  } else {
    // 矩形選択表示を非表示にする
    hideSelectionRect();
  }
}

// 左クリック終了時に短クリック選択または矩形選択を実行する
function handleCanvasPointerUp(ev) {
  // DebugDock 用に直近の raw pointer / mouse event 情報を記録する
  updateRawInputDebug("canvas", ev);
  if (!canvasClick.active) {
    return;
  }
  if (canvasClick.pointerId !== null && ev.pointerId !== canvasClick.pointerId) {
    return;
  }
  const moveDistance = Math.hypot(ev.clientX - canvasClick.startX, ev.clientY - canvasClick.startY);
  const dragRect = makeClientRect(canvasClick.startX, canvasClick.startY, ev.clientX, ev.clientY);
  const additive = canvasClick.additive;
  const allowRectangle = canvasClick.allowRectangle;
  // 左クリック / 矩形選択 tracking 状態を初期化する
  resetCanvasClick();
  if (moveDistance > 4.0) {
    if (allowRectangle && !(editor.mode === EDITOR_MODE_EDIT && editor.tool === TOOL_ADD_VERTEX)) {
      // 現在 mode / tool に応じて client 矩形内の object / vertex / face を選択する
      selectByClientRect(dragRect, additive);
      ev.preventDefault();
    }
    return;
  }
  // 左クリックを mode / tool に応じた選択または頂点追加として処理する
  handleCanvasClick(ev);
  ev.preventDefault();
}

// canvas と window / document に pointer 診断と選択用 handler を登録する
function installPointerHandlers() {
  const canvas = app.screen.canvas;
  canvas.tabIndex = 0;
  window.addEventListener("pointerdown", (ev) => updateRawInputDebug("window", ev), true);
  window.addEventListener("pointermove", (ev) => updateRawInputDebug("window", ev), true);
  window.addEventListener("pointerup", (ev) => updateRawInputDebug("window", ev), true);
  window.addEventListener("mousedown", (ev) => updateRawInputDebug("window", ev), true);
  window.addEventListener("mousemove", (ev) => updateRawInputDebug("window", ev), true);
  window.addEventListener("mouseup", (ev) => updateRawInputDebug("window", ev), true);
  window.addEventListener("auxclick", (ev) => updateRawInputDebug("window", ev), true);
  window.addEventListener("wheel", (ev) => updateRawInputDebug("window", ev), true);
  document.addEventListener("pointerdown", (ev) => updateRawInputDebug("document", ev), true);
  document.addEventListener("mousedown", (ev) => updateRawInputDebug("document", ev), true);
  document.addEventListener("auxclick", (ev) => updateRawInputDebug("document", ev), true);
  canvas.addEventListener("contextmenu", (ev) => ev.preventDefault());
  canvas.addEventListener("pointerdown", handleCanvasPointerDown);
  canvas.addEventListener("pointermove", handleCanvasPointerMove);
  canvas.addEventListener("pointerup", handleCanvasPointerUp);
  canvas.addEventListener("pointercancel", resetCanvasClick);
  canvas.addEventListener("pointerleave", resetCanvasClick);
}

// transformController の mode 表示名を UI へ中継する
function getTransformModeLabel(mode) {
  return transformController.getTransformModeLabel(mode);
}

// transformController の mode 開始を UI へ中継する
function setTransformMode(mode) {
  return transformController.setTransformMode(mode);
}

// transformController の cancel を UI へ中継する
function cancelTransformMode() {
  return transformController.cancelTransformMode();
}

// transformController の confirm を UI へ中継する
function confirmTransformMode() {
  return transformController.confirmTransformMode();
}

// transformController の preview 更新を UI へ中継する
function applyTransformDrag(clientX, clientY) {
  return transformController.applyTransformDrag(clientX, clientY);
}

// transformController の pointer bridge を登録する
function installTransformPointerBridge(canvas) {
  return transformController.installTransformPointerBridge(canvas);
}

// keyboard 補助移動を editOperations へ中継する
function moveActiveVerticesBy(delta, label) {
  return editOperations.moveActiveVerticesBy(delta, label);
}

// screen 平面 keyboard 移動を editOperations へ中継する
function moveSelectionByScreenKeys(stepX, stepY) {
  return editOperations.moveSelectionByScreenKeys(stepX, stepY);
}

// 法線方向 keyboard 移動を editOperations へ中継する
function moveSelectionByNormalKey(direction) {
  return editOperations.moveSelectionByNormalKey(direction);
}

// keyboard scale を editOperations へ中継する
function scaleSelectionByKeyboard(factor) {
  return editOperations.scaleSelectionByKeyboard(factor);
}

// mode / tool / transform / camera / edit 操作用 keyboard handler を登録する
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
    else if (plainKey && key === "a") selectAllForCurrentMode();
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
    else if (plainKey && key === "f") makeFaceFromSelection();
    else if (plainKey && key === "w") toggleObjectWireframe();
    else if (plainKey && key === "x") deleteSelected();
    else if (key === "delete" || key === "backspace") deleteSelected();
    else if (key === "z" && (ev.metaKey || ev.ctrlKey)) undo();
    else if ((key === "y" && (ev.metaKey || ev.ctrlKey)) || (key === "z" && ev.shiftKey && (ev.metaKey || ev.ctrlKey))) redo();
    else if (key === "escape" && cancelTransformMode()) {
      // transform cancel handled above
    }
    else if (key === "escape") {
      // edit selection の vertex / face を空にする
      clearSelection();
      // mesh / selected face / marker の表示をまとめて再構築する
      rebuildScene();
      // 最後のユーザー向け message を保存し status を更新する
      setMessage("selection cleared");
    } else {
      return;
    }
    ev.preventDefault();
  });
}

// 読み込み file 名から json / gltf / dae などの形式を判定する
function detectFileFormat(file) {
  const name = String(file?.name ?? "").toLowerCase();
  if (name.endsWith(".json") || name.endsWith(".json.gz")) return "json";
  if (name.endsWith(".gltf") || name.endsWith(".glb")) return "gltf";
  if (name.endsWith(".dae")) return "collada";
  throw new Error(`unsupported file extension: ${file?.name ?? "(unknown)"}`);
}

// ModelAsset node 定義から transform matrix を作る
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

// node 親子関係をたどって world matrix を cache 付きで解決する関数を作る
function buildWorldMatrixResolver(nodes) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const cache = new Map();
  // node index から親 chain を含む world matrix を再帰的に解決する
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

// ModelAsset の mesh node から import 候補 entry を作る
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

// import 候補 entry を mesh select UI へ反映する
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
  // editor / camera / diagnostics の現在状態を DOM status と HUD へ反映する
  updateStatus();
}

// file input から ModelAsset / glTF / GLB / Collada を読み込む
async function loadModelFile(file) {
  if (!file) {
    return;
  }
  const format = detectFileFormat(file);
  const fileLabel = String(file.name ?? "(unknown)");
  // 最後のユーザー向け message を保存し status を更新する
  setMessage(`loading ${fileLabel}`);
  let asset = null;
  if (format === "json") {
    if (ModelAsset.isGzipSource(file.name)) {
      asset = await ModelAsset.fromGzipBlob(file);
    } else {
      asset = ModelAsset.fromJSON(await file.text());
    }
  } else {
    const url = URL.createObjectURL(file);
    try {
      // GLB / glTF / Collada は embedded_glb_viewer と同じ WebgApp.loadModel()
      // 経路でいったん ModelAsset へ正規化する特に GLB は skinned mesh や
      // static transform の bake を loader 側へ任せる必要があるため、
      // webgmodeler 側で skin 解析を無効化しない編集データへ変換する時点で
      // skin / animation は使わないが、positions は viewer と同じ正規化済み mesh を読む
      const loaded = await app.loadModel(url, {
        format,
        instantiate: false,
        validate: true,
        startAnimations: false,
        onStage: (stage) => {
          // 最後のユーザー向け message を保存し status を更新する
          setMessage(`loading ${fileLabel}: ${stage}`);
        }
      });
      asset = loaded.asset;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  asset.assertValid();
  importedAsset = asset;
  // import 候補 entry を mesh select UI へ反映する
  populateMeshSelect(asset);
  if (importedMeshes.length > 0) {
    // mesh select の現在項目を編集 object として取り込む
    importSelectedMesh();
  } else {
    // 最後のユーザー向け message を保存し status を更新する
    setMessage(`loaded ${fileLabel}, but no mesh was found`);
  }
}

// mesh select の現在項目を編集 object として取り込む
function importSelectedMesh() {
  if (!importedAsset) {
    // 最後のユーザー向け message を保存し status を更新する
    setMessage("load a model file first");
    return;
  }
  if (ui.meshSelect.value === "all") {
    // 読み込み済み asset の全 mesh entry を複数 object として取り込む
    importAllMeshes();
    return;
  }
  const index = Number(ui.meshSelect.value);
  const entry = importedMeshes.find((item) => item.index === index);
  if (!entry) {
    // 最後のユーザー向け message を保存し status を更新する
    setMessage("selected mesh is not available");
    return;
  }
  const object = buildEditorObjectFromImportEntry(entry, DEFAULT_OBJECT_ID);
  // 現在状態を undo stack へ積み、redo stack を破棄する
  pushUndo("import mesh");
  // import などで object 一覧を丸ごと差し替えて active object を設定する
  replaceObjectsAndActivate([object], object.id);
  // 全 face の winding を connected component ごとにできるだけ一貫させる
  orientAllFacesConsistently();
  // 現在の editor.vertices / faces を active object へ書き戻す
  commitActiveObject();
  editor.undoStack = [];
  editor.redoStack = [];
  editor.dirty = false;
  // mesh / selected face / marker の表示をまとめて再構築する
  rebuildScene();
  // editor bounds に合わせて orbit camera の target と距離を調整する
  fitCameraToEditor();
  // 最後のユーザー向け message を保存し status を更新する
  setMessage(`imported ${entry.label}`);
}

// import entry の geometry を editor object 形式へ変換する
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
      // 入力値を有限数として読み取り、不正値なら分かりやすい error にする
      readFiniteNumber(geometry.positions[i], `positions[${i}]`),
      // 入力値を有限数として読み取り、不正値なら分かりやすい error にする
      readFiniteNumber(geometry.positions[i + 1], `positions[${i + 1}]`),
      // 入力値を有限数として読み取り、不正値なら分かりやすい error にする
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

// 読み込み済み asset の全 mesh entry を複数 object として取り込む
function importAllMeshes() {
  if (importedMeshes.length === 0) {
    // 最後のユーザー向け message を保存し status を更新する
    setMessage("no mesh to import");
    return;
  }
  // 現在状態を undo stack へ積み、redo stack を破棄する
  pushUndo("import all meshes");
  const objects = importedMeshes.map((entry, index) => buildEditorObjectFromImportEntry(entry, DEFAULT_OBJECT_ID + index));
  // import などで object 一覧を丸ごと差し替えて active object を設定する
  replaceObjectsAndActivate(objects, objects[0].id);
  for (const object of objects) {
    // 指定 object を active にし、編集配列をその object へ接続する
    activateObject(object.id);
    // 全 face の winding を connected component ごとにできるだけ一貫させる
    orientAllFacesConsistently();
    // 現在の editor.vertices / faces を active object へ書き戻す
    commitActiveObject();
  }
  // 指定 object を active にし、編集配列をその object へ接続する
  activateObject(objects[0].id);
  editor.undoStack = [];
  editor.redoStack = [];
  editor.dirty = false;
  // mesh / selected face / marker の表示をまとめて再構築する
  rebuildScene();
  // editor bounds に合わせて orbit camera の target と距離を調整する
  fitCameraToEditor();
  // 最後のユーザー向け message を保存し status を更新する
  setMessage(`imported ${editor.objects.length} object(s)`);
}

// active object を ModelAsset JSON として保存する
function saveModelAssetJson() {
  const asset = buildModelAssetFromEditor();
  asset.assertValid();
  const filename = "webgmodeler_modelasset.json";
  asset.downloadJSON(filename, 2);
  lastSavedName = filename;
  editor.dirty = false;
  // 最後のユーザー向け message を保存し status を更新する
  setMessage(`saved ${filename}`);
}

// active object を gzip 圧縮済み ModelAsset JSON として保存する
async function saveModelAssetJsonGz() {
  const asset = buildModelAssetFromEditor();
  asset.assertValid();
  const filename = "webgmodeler_modelasset.json.gz";
  await asset.downloadJSONGz(filename, 2);
  lastSavedName = filename;
  editor.dirty = false;
  // 最後のユーザー向け message を保存し status を更新する
  setMessage(`saved ${filename}`);
}

// active object の geometry から GLB binary を作る
function buildGlbFromEditor() {
  return buildGlbFromGeometry({
    vertices: editor.vertices,
    faces: editor.faces,
    materialColor: MATERIAL.mesh.color
  });
}

// Blob を一時 URL にして browser download を開始する
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

// active object を GLB file として保存する
function saveGlb() {
  const glb = buildGlbFromEditor();
  const filename = "webgmodeler.glb";
  // Blob を一時 URL にして browser download を開始する
  downloadBlob(new Blob([glb], { type: "model/gltf-binary" }), filename);
  lastSavedName = filename;
  editor.dirty = false;
  // 最後のユーザー向け message を保存し status を更新する
  setMessage(`saved ${filename}`);
}

// HTML button / input / select の event handler を登録する
function installDomHandlers() {
  for (const button of ui.modeButtons) {
    button.addEventListener("click", () => setEditorMode(button.dataset.mode));
  }
  for (const button of ui.toolButtons) {
    button.addEventListener("click", () => setTool(button.dataset.tool));
  }
  ui.fileInput.addEventListener("change", () => {
    const file = ui.fileInput.files?.[0] ?? null;
    // file input から ModelAsset / glTF / GLB / Collada を読み込む
    loadModelFile(file)
      .catch((err) => {
        console.error(err);
        // 最後のユーザー向け message を保存し status を更新する
        setMessage(`load failed: ${err?.message ?? err}`);
      })
      .finally(() => {
        // embedded_glb_viewer と同じく value を戻し、同じ GLB を再選択した場合も
        // change event が発火するようにするこれは失敗後の再試行を確実にするための
        // UI 状態リセットであり、ロード失敗を隠す fallback ではない
        ui.fileInput.value = "";
      });
  });
  ui.useMesh.addEventListener("click", () => {
    try {
      // mesh select の現在項目を編集 object として取り込む
      importSelectedMesh();
    } catch (err) {
      console.error(err);
      // 最後のユーザー向け message を保存し status を更新する
      setMessage(`import failed: ${err?.message ?? err}`);
    }
  });
  ui.saveJson.addEventListener("click", () => {
    try {
      // active object を ModelAsset JSON として保存する
      saveModelAssetJson();
    } catch (err) {
      console.error(err);
      // 最後のユーザー向け message を保存し status を更新する
      setMessage(`save failed: ${err?.message ?? err}`);
    }
  });
  ui.saveJsonGz.addEventListener("click", async () => {
    try {
      // active object を gzip 圧縮済み ModelAsset JSON として保存する
      await saveModelAssetJsonGz();
    } catch (err) {
      console.error(err);
      // 最後のユーザー向け message を保存し status を更新する
      setMessage(`save failed: ${err?.message ?? err}`);
    }
  });
  ui.saveGlb.addEventListener("click", () => {
    try {
      // active object を GLB file として保存する
      saveGlb();
    } catch (err) {
      console.error(err);
      // 最後のユーザー向け message を保存し status を更新する
      setMessage(`glb export failed: ${err?.message ?? err}`);
    }
  });
  ui.newScene.addEventListener("click", () => {
    // 起動時の初期 cube object を作り scene と camera を初期化する
    createInitialModel();
    // 最後のユーザー向け message を保存し status を更新する
    setMessage("new model");
  });
  ui.objectWireframe?.addEventListener("click", toggleObjectWireframe);
  ui.makeFace?.addEventListener("click", () => makeFaceFromSelection());
  ui.flipFaces?.addEventListener("click", flipSelectedFaces);
  ui.undo.addEventListener("click", undo);
  ui.redo.addEventListener("click", redo);
  ui.overlayAlpha?.addEventListener("input", () => {
    overlayAlpha = readFiniteNumber(ui.overlayAlpha.value, overlayAlpha);
    markerOverlayDirty = true;
    overlayEdgeUploadDirty = true;
    if (ui.overlayAlphaValue) {
      ui.overlayAlphaValue.textContent = overlayAlpha.toFixed(2);
    }
  });
  ui.overlayMarkerColor?.addEventListener("input", () => {
    overlayMarkerColor = hexColorToRgb(ui.overlayMarkerColor.value, overlayMarkerColor);
    markerOverlayDirty = true;
    if (ui.overlayMarkerColorValue) {
      ui.overlayMarkerColorValue.textContent = rgbToHexColor(overlayMarkerColor);
    }
  });
  ui.overlayEdgeColor?.addEventListener("input", () => {
    overlayEdgeColor = hexColorToRgb(ui.overlayEdgeColor.value, overlayEdgeColor);
    overlayEdgeUploadDirty = true;
    if (ui.overlayEdgeColorValue) {
      ui.overlayEdgeColorValue.textContent = rgbToHexColor(overlayEdgeColor);
    }
  });
}

// DebugDock 用に editor / input / camera 周辺の stats を更新する
function refreshDiagnosticsStats() {
  const rawInput = getRawInputDebugSnapshot();
  const pointerDebug = getPointerDebugSnapshot();
  app.mergeDiagnosticsStats({
    vertexCount: editor.vertices.length,
    faceCount: editor.faces.length,
    selectedVertexCount: editor.selectedVertices.size,
    selectedFaceCount: editor.selectedFaces.size,
    selectedObjectCount: editor.selectedObjectIds.size,
    objectCount: editor.objects.length,
    importedMeshCount: importedMeshes.length,
    importedAssetLoaded: importedAsset ? "yes" : "no",
    editorMode: editor.mode,
    objectWireframe: objectWireframe ? "on" : "off",
    activeObjectId: editor.activeObjectId ?? "-",
    tool: editor.tool,
    dirty: editor.dirty ? "yes" : "no",
    rawInput: rawInput.text,
    rawInputHistory: rawInput.historyText,
    rawInputButtonHistory: rawInput.buttonHistoryText,
    rawInputSource: rawInput.source,
    rawInputType: rawInput.type,
    rawInputButton: rawInput.button,
    rawInputButtons: rawInput.buttons,
    rawInputTarget: rawInput.target,
    rawInputInsideCanvas: rawInput.insideCanvas,
    eyeRigPointer: pointerDebug.text,
    eyeRigPointerHistory: pointerDebug.historyText,
    eyeRigPointerAction: pointerDebug.action,
    eyeRigPointerButton: pointerDebug.button,
    eyeRigPointerButtons: pointerDebug.buttons,
    eyeRigPointerInside: pointerDebug.inside,
    eyeRigPointerElement: pointerDebug.elementTag,
    message: editor.lastMessage
  });
}

// DebugProbe 用に現在状態の diagnostics report を組み立てる
function makeProbeReport(frameCount) {
  const report = app.createProbeReport("runtime-probe");
  const rawInput = getRawInputDebugSnapshot();
  const pointerDebug = getPointerDebugSnapshot();
  Diagnostics.addDetail(report, `tool=${editor.tool}`);
  Diagnostics.addDetail(report, `mode=${editor.mode}`);
  Diagnostics.addDetail(report, `objectWireframe=${objectWireframe ? "on" : "off"}`);
  Diagnostics.addDetail(report, `vertices=${editor.vertices.length}`);
  Diagnostics.addDetail(report, `faces=${editor.faces.length}`);
  Diagnostics.addDetail(report, `rawInput=${rawInput.text}`);
  Diagnostics.addDetail(report, `rawInputHistory=${rawInput.historyText}`);
  Diagnostics.addDetail(report, `rawInputButtonHistory=${rawInput.buttonHistoryText}`);
  Diagnostics.addDetail(report, `eyeRigPointer=${pointerDebug.text}`);
  Diagnostics.addDetail(report, `eyeRigPointerHistory=${pointerDebug.historyText}`);
  Diagnostics.mergeStats(report, {
    frameCount,
    vertexCount: editor.vertices.length,
    faceCount: editor.faces.length,
    selectedVertexCount: editor.selectedVertices.size,
    selectedFaceCount: editor.selectedFaces.size,
    selectedObjectCount: editor.selectedObjectIds.size,
    objectCount: editor.objects.length,
    importedMeshCount: importedMeshes.length,
    importedAssetLoaded: importedAsset ? "yes" : "no",
    editorMode: editor.mode,
    objectWireframe: objectWireframe ? "on" : "off",
    activeObjectId: editor.activeObjectId ?? "-",
    rawInput: rawInput.text,
    rawInputHistory: rawInput.historyText,
    rawInputButtonHistory: rawInput.buttonHistoryText,
    rawInputSource: rawInput.source,
    rawInputType: rawInput.type,
    rawInputButton: rawInput.button,
    rawInputButtons: rawInput.buttons,
    rawInputTarget: rawInput.target,
    rawInputInsideCanvas: rawInput.insideCanvas,
    eyeRigPointer: pointerDebug.text,
    eyeRigPointerHistory: pointerDebug.historyText,
    eyeRigPointerAction: pointerDebug.action,
    eyeRigPointerButton: pointerDebug.button,
    eyeRigPointerButtons: pointerDebug.buttons,
    eyeRigPointerInside: pointerDebug.inside,
    eyeRigPointerElement: pointerDebug.elementTag,
    message: editor.lastMessage
  });
  return report;
}

// WebgApp 初期化から scene / UI / handler 登録までを順に起動する
async function start() {
  // HTML 上の button / input / select を取得して ui 参照へまとめる
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
      yaw: DEFAULT_CAMERA.yaw,
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
  selectedFaceShader = new SelectedFaceOverlayShader(app.getGL());
  await selectedFaceShader.init();
  if (app.projectionMatrix) {
    selectedFaceShader.setProjectionMatrix(app.projectionMatrix);
  }
  overlay2d = new Overlay2DRenderer(app.getGL(), { initialVertexCapacity: 8192 });
  await overlay2d.init();
  edgeOverlay = new EdgeWireframeOverlayRenderer(app.getGL(), { initialVertexCapacity: 8192 });
  await edgeOverlay.init();
  app.attachInput();
  orbit = app.createOrbitEyeRig({
    target: [...DEFAULT_CAMERA.target],
    distance: DEFAULT_CAMERA.distance,
    yaw: DEFAULT_CAMERA.yaw,
    pitch: DEFAULT_CAMERA.pitch,
    orbitKeyMap: { ...INITIAL_ORBIT_BINDINGS.orbitKeyMap },
    panModifierKey: INITIAL_ORBIT_BINDINGS.panModifierKey,
    dragZoomModifierKey: "control",
    minDistance: 0.5,
    maxDistance: 96.0,
    wheelZoomStep: 0.5,
    keyZoomSpeed: 4.0,
    dragZoomSpeed: 0.04,
    dragRotateSpeed: 0.28,
    dragPanSpeed: 2.0,
    pitchMin: -85.0,
    pitchMax: 85.0,
    dragButton: 1,
    alternateDragButton: 0,
    alternateDragModifierKey: "alt"
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
  detachTransformPointerBridge?.();
  detachTransformPointerBridge = installTransformPointerBridge(app.screen.canvas);
  // 床 grid を共有頂点の wireframe plane として作る
  buildGrid();
  // 起動時の初期 cube object を作り scene と camera を初期化する
  createInitialModel();
  // HTML button / input / select の event handler を登録する
  installDomHandlers();
  // canvas と window / document に pointer 診断と選択用 handler を登録する
  installPointerHandlers();
  // mode / tool / transform / camera / edit 操作用 keyboard handler を登録する
  installKeyboardHandlers();
  detachModelerKeyBridge?.();
  detachModelerKeyBridge = installModelerKeyBridge();
  // editor / camera / diagnostics の現在状態を DOM status と HUD へ反映する
  updateStatus();
  // DOM UI から操作後も keyboard / pointer 入力が canvas へ戻るよう focus を整える
  focusModelerCanvas();
  // import 候補 entry を mesh select UI へ反映する
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
    // frame ごとに diagnostics と UI 表示を更新し、projection 依存 shader へ現在行列を渡す
    onUpdate({ screen, deltaSec }) {
      // DebugDock 用に editor / input / camera 周辺の stats を更新する
      refreshDiagnosticsStats();
      if (selectedFaceShader && app.projectionMatrix) {
        selectedFaceShader.setProjectionMatrix(app.projectionMatrix);
      }
      // editor / camera / diagnostics の現在状態を DOM status と HUD へ反映する
      updateStatus();
      if (app.debugProbe) {
        app.debugProbe.collect = () => makeProbeReport(screen.getFrameCount());
      }
    },
    // 3D scene 描画後に edit overlay を重ねる
    onAfterDraw3d() {
      // Edit Mode の edge と marker overlay を scene 描画後に重ねる
      drawEditOverlayPass();
    }
  });
}
