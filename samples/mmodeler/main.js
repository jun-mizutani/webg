// ---------------------------------------------
// samples/mmodeler/main.js  2026/05/17
//   mmodeler sample
//   Sections:
//   - webg app subclasses and shaders
//   - constants and shared state
//   - focus, projection, camera, and UI helpers
//   - editor snapshots, selection, geometry, and scene rebuild
//   - picking, input, transform, import/export, diagnostics, startup
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import WebgApp from "../../webg/WebgApp.js";
import SmoothShader from "../../webg/SmoothShader.js";
import Shape from "../../webg/Shape.js";
import ModelAsset from "../../webg/ModelAsset.js";
import Matrix from "../../webg/Matrix.js";
import Diagnostics from "../../webg/Diagnostics.js";
import Touch from "../../webg/Touch.js";
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

// ------------------------------------------------------------
// --- webg app subclasses and shaders
// ------------------------------------------------------------

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

class ModelerWebgApp extends WebgApp {
  // webg コアの WebgApp は透視投影を標準入口にしている。
  // webgmodeler ではコアを変更せず、サンプル専用 subclass で正射影行列だけを追加する。
  updateOrthographicProjection(viewHeight) {
    if (!Number.isFinite(viewHeight) || viewHeight <= 0.0) {
      throw new Error(`ModelerWebgApp.updateOrthographicProjection requires positive viewHeight: ${viewHeight}`);
    }
    const aspect = this.screen.getAspect();
    if (!Number.isFinite(aspect) || aspect <= 0.0) {
      throw new Error(`ModelerWebgApp.updateOrthographicProjection requires positive aspect: ${aspect}`);
    }
    const halfHeight = viewHeight * 0.5;
    const halfWidth = halfHeight * aspect;
    const proj = new Matrix();
    proj.makeProjectionMatrixOrtho(
      this.projectionNear,
      this.projectionFar,
      halfWidth,
      halfHeight
    );
    this.projectionMatrix = proj;
    if (this.shader?.setProjectionMatrix) {
      this.shader.setProjectionMatrix(proj);
    }
    return proj;
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

// ------------------------------------------------------------
// --- constants and shared state
// ------------------------------------------------------------

const ui = {
  status: null,
  fileInput: null,
  meshSelect: null,
  useMesh: null,
  saveJson: null,
  saveJsonGz: null,
  saveGlb: null,
  screenshot: null,
  newScene: null,
  makeFace: null,
  flipFaces: null,
  loopCutFaces: null,
  xMirrorEdit: null,
  undo: null,
  redo: null,
  objectWireframe: null,
  lightBackground: null,
  visiblePickOnly: null,
  overlayAlpha: null,
  overlayAlphaValue: null,
  overlayMarkerColor: null,
  overlayMarkerColorValue: null,
  overlayEdgeColor: null,
  overlayEdgeColorValue: null,
  modeButtons: [],
  toolButtons: [],
  mobileRibbonName: null,
  mobileRibbonHint: null,
  mobileRibbonHeader: null,
  mobileRibbonButtons: [],
  mobileStatus: null,
  mobilePalette: null,
  mobilePaletteTitle: null,
  mobilePaletteButtons: [],
  mobileAxisChooser: null,
  mobileAxisButtons: [],
  mobileViewButtons: []
};

const SAMPLE_NAME = "mmodeler";
const IS_MOBILE_PROFILE = document.body?.dataset?.modelerProfile === "mobile";
const MOBILE_RIBBON_PAGES = [
  {
    name: "FILE",
    actions: ["load", "save-json", "save-glb"]
  },
  {
    name: "SCENE",
    actions: ["new-scene", "toggle-projection", "toggle-x-mirror"]
  },
  {
    name: "HISTORY",
    actions: ["undo", "redo", "screenshot"]
  }
];

const MOBILE_ACTION_LABELS = {
  "load": { label: "Load", detail: "file" },
  "save-json": { label: "Json", detail: "gz" },
  "save-glb": { label: "Glb", detail: "save" },
  "new-scene": { label: "N", detail: "new" },
  "toggle-projection": { label: "Pr", detail: "ortho" },
  "toggle-x-mirror": { label: "M", detail: "mirror" },
  "undo": { label: "Ud", detail: "undo" },
  "redo": { label: "Rd", detail: "redo" },
  "screenshot": { label: "Ss", detail: "shot" },
  "move": { label: "G", detail: "move" },
  "rotate": { label: "R", detail: "rotate" },
  "scale": { label: "S", detail: "scale" },
  "extrude": { label: "E", detail: "extrude" },
  "loop-cut": { label: "L", detail: "loop" },
  "delete": { label: "Del", detail: "delete" },
  "origin-world": { label: "O", detail: "origin" },
  "mode-object": { label: "1", detail: "object" },
  "mode-edit": { label: "Tab", detail: "edit" },
  "tool-face": { label: "f", detail: "face" },
  "tool-vertex": { label: "v", detail: "vertex" },
  "tool-add": { label: "Add", detail: "vertex" },
  "select-all": { label: "A", detail: "all" },
  "invert-selection": { label: "I", detail: "invert" },
  "select-x-negative": { label: "H", detail: "X<0" },
  "view-vertex": { label: "Vcood", detail: "" },
  "object-wireframe": { label: "W", detail: "wire" },
  "edge-slide": { label: "GG", detail: "slide" },
  "add-cube": { label: "Cube", detail: "add" },
  "add-torus": { label: "Torus", detail: "add" },
  "add-plane": { label: "Plane", detail: "add" },
  "add-sphere": { label: "Ball", detail: "add" },
  "add-cylinder": { label: "Cyl", detail: "add" },
  "add-cone": { label: "Cone", detail: "add" },
  "add-double-cone": { label: "DCone", detail: "add" },
  "join-objects": { label: "Join", detail: "object" },
  "primitive-segments-3": { label: "3", detail: "seg" },
  "primitive-segments-4": { label: "4", detail: "seg" },
  "primitive-segments-8": { label: "8", detail: "seg" },
  "primitive-segments-12": { label: "12", detail: "seg" },
  "primitive-segments-16": { label: "16", detail: "seg" },
  "primitive-segments-24": { label: "24", detail: "seg" },
  "primitive-segments-32": { label: "32", detail: "seg" },
  "undefined": { label: "-", detail: "" },
  "palette-next": { label: "Next", detail: "page" },
  "view-x": { label: "X", detail: "view" },
  "view-x-reverse": { label: "-X", detail: "view" },
  "view-y": { label: "Y", detail: "view" },
  "view-y-reverse": { label: "-Y", detail: "view" },
  "view-z": { label: "Z", detail: "view" },
  "view-z-reverse": { label: "-Z", detail: "view" }
};

const mobileUiState = {
  paletteOpen: false,
  paletteKind: "selection",
  palettePage: 0,
  ribbonPageIndex: 0,
  boxSelectArmed: false,
  touch: null,
  gestureAttached: false,
  lastGesture: "-",
  lastGesturePointer: "-",
  lastAction: "",
  lastActionTime: 0,
  lastEmptyTapTime: 0,
  lastEmptyTapX: 0,
  lastEmptyTapY: 0,
  lastEmptyTapPointerType: "",
  lastCanvasTapTime: 0,
  lastCanvasTapX: 0,
  lastCanvasTapY: 0,
  lastCanvasTapPointerType: "",
  pendingCanvasTapTimer: null,
  pendingCanvasTapEvent: null,
  primitiveSegments: 12,
  viewAxis: "z",
  viewFlip: false,
  flickPointer: null,
  lastFlickPointerId: null,
  lastFlickTime: 0,
  suppressMobileButtonPointerId: null,
  suppressMobileButtonUntil: 0,
  suppressCanvasPointerId: null,
  suppressCanvasPointerUntil: 0,
  suppressAxisClickUntil: 0
};

const MOBILE_TOUCH_FLICK_MAX_MS = 650.0;
const MOBILE_TOUCH_FLICK_MIN_SPEED_PX_PER_MS = 0.18;
const MOBILE_MOUSE_FLICK_MAX_MS = 900.0;
const MOBILE_MOUSE_FLICK_MIN_SPEED_PX_PER_MS = 0.08;
const MOBILE_FLICK_HORIZONTAL_DOMINANCE = 1.15;
const MOBILE_GESTURE_DEBUG_VERSION = "2026-05-17-empty-scene-palette-v1";

let app = null;
let meshNode = null;
let selectedFaceNode = null;
let markerRoot = null;
let gridRoot = null;
let orbit = null;
let selectedFaceShader = null;
let overlay2d = null;
let edgeOverlay = null;
let guideOverlay = null;
let overlayEdgeCache = [];
let overlayEdgeCacheDirty = true;
let overlayEdgeUploadDirty = true;
let markerOverlayDirty = true;
let markerOverlayCameraKey = "";
let overlayAlpha = 0.65;
let overlayMarkerColor = [0.0, 0.0, 0.0];
let overlayEdgeColor = [0.0, 0.0, 0.0];
let objectWireframe = false;
let lightBackground = false;
let visiblePickOnly = true;
let xMirrorEdit = false;
const explicitXMirrorVertexPairs = new Map();
let importedAsset = null;
let importedMeshes = [];
let lastSavedName = "-";
let selectionRectEl = null;
let detachModelerKeyBridge = null;
let detachTransformPointerBridge = null;
let editOperations = null;
let transformController = null;

const VIEW_ANGLE_PRESETS = [50.0, 40.0, 32.0, 24.0, 18.0, 12.0, 6.0];
let viewAnglePresetIndex = 0;
const PROJECTION_MODE_PERSPECTIVE = "perspective";
const PROJECTION_MODE_ORTHOGRAPHIC = "orthographic";
let projectionMode = PROJECTION_MODE_PERSPECTIVE;
let projectionUpdateKey = "";
const MIN_CAMERA_DISTANCE = 0.03;
const FIT_MIN_DISTANCE_RATIO = 0.02;
const MIN_WHEEL_ZOOM_STEP = 0.03;
const FIT_WHEEL_ZOOM_RATIO = 0.04;
const MIN_KEY_ZOOM_SPEED = 0.25;
const FIT_KEY_ZOOM_RATIO = 0.35;
const FULL_FRAME_SENSOR_HEIGHT_MM = 24.0;
const EDGE_Z_BIAS_PERSPECTIVE = 0.00028;
const EDGE_Z_BIAS_ORTHOGRAPHIC = 0.00002;
const MARKER_Z_BIAS_PERSPECTIVE = 0.00035;
const MARKER_Z_BIAS_ORTHOGRAPHIC = 0.00002;
const Z_BIAS_REFERENCE_VIEW_ANGLE = 50.0;
const WIREFRAME_OVERLAY_MARKER_COLOR = [0.92, 1.0, 1.0];
const WIREFRAME_OVERLAY_EDGE_COLOR = [0.72, 0.96, 1.0];
const WIREFRAME_OVERLAY_SELECTED_EDGE_COLOR = [1.0, 1.0, 0.82];
const BACKGROUND_DARK_COLOR = [0.07, 0.11, 0.15, 1.0];
const BACKGROUND_LIGHT_COLOR = [0.42, 0.45, 0.48, 1.0];
const VISIBLE_PICK_GRID_COLS = 48;
const VISIBLE_PICK_GRID_ROWS = 48;
const VISIBLE_PICK_GRID_PADDING_PX = 3.0;
const ORBIT_VIEW_PRESETS = {
  "1": {
    forward: { label: "-Z", yaw: 0.0, pitch: 0.0 },
    reverse: { label: "+Z", yaw: 180.0, pitch: 0.0 }
  },
  "3": {
    forward: { label: "-X", yaw: 90.0, pitch: 0.0 },
    reverse: { label: "+X", yaw: -90.0, pitch: 0.0 }
  },
  "7": {
    forward: { label: "-Y", yaw: 0.0, pitch: -90.0 },
    reverse: { label: "+Y", yaw: 0.0, pitch: 90.0 }
  }
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
  lastY: 0.0,
  additive: false,
  allowRectangle: true
};

const loopCutPreview = {
  active: false,
  faceId: null,
  cutEdgeIndex: 0,
  lastClientX: 0.0,
  lastClientY: 0.0
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

const visiblePickStats = {
  mode: "-",
  candidates: 0,
  selected: 0,
  gridFaces: 0,
  gridCells: 0,
  avgFacesPerFilledCell: 0.0,
  maxFacesPerCell: 0
};

// ------------------------------------------------------------
// --- diagnostics counters
// ------------------------------------------------------------

function resetVisiblePickStats(mode = "-") {
  visiblePickStats.mode = mode;
  visiblePickStats.candidates = 0;
  visiblePickStats.selected = 0;
  visiblePickStats.gridFaces = 0;
  visiblePickStats.gridCells = 0;
  visiblePickStats.avgFacesPerFilledCell = 0.0;
  visiblePickStats.maxFacesPerCell = 0;
}

function setVisiblePickSelectionStats(mode, candidates, selected, context = null) {
  visiblePickStats.mode = mode;
  visiblePickStats.candidates = candidates;
  visiblePickStats.selected = selected;
  const grid = context?.occlusionGrid ?? null;
  if (!grid) {
    visiblePickStats.gridFaces = 0;
    visiblePickStats.gridCells = 0;
    visiblePickStats.avgFacesPerFilledCell = 0.0;
    visiblePickStats.maxFacesPerCell = 0;
    return;
  }
  visiblePickStats.gridFaces = grid.faceCount;
  visiblePickStats.gridCells = grid.filledCellCount;
  visiblePickStats.avgFacesPerFilledCell = grid.avgFacesPerFilledCell;
  visiblePickStats.maxFacesPerCell = grid.maxFacesPerCell;
}
const rawInputHistory = [];
const rawInputButtonHistory = [];

// ------------------------------------------------------------
// --- editor model state
// ------------------------------------------------------------

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
  lastSelectedVertexId: null,
  nextVertexId: 1,
  nextFaceId: 1,
  tool: TOOL_SELECT_VERTEX,
  dirty: false,
  lastMessage: "ready",
  undoStack: [],
  redoStack: []
};

// ------------------------------------------------------------
// --- focus, projection, and camera helpers
// ------------------------------------------------------------

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

// 現在の短辺 FOV から、フルサイズ短辺 24mm を前提にした焦点距離相当を計算する
// webg の viewAngle は短辺方向の制御値なので、HUD では利用者が直感しやすい mm 表示へ変換する
function getFullFrameFocalLengthMm() {
  const viewAngle = Number(app?.viewAngle ?? VIEW_ANGLE_PRESETS[viewAnglePresetIndex]);
  if (!Number.isFinite(viewAngle) || viewAngle <= 0.0) {
    return NaN;
  }
  const halfAngleRad = viewAngle * 0.5 * Math.PI / 180.0;
  const tangent = Math.tan(halfAngleRad);
  if (!Number.isFinite(tangent) || tangent <= 0.0) {
    return NaN;
  }
  return FULL_FRAME_SENSOR_HEIGHT_MM / (2.0 * tangent);
}

// HUD / status / diagnostics には視野角の度数ではなく、
// フルサイズ換算で何 mm 相当の見え方かを表示する
function getFocalLengthLabel() {
  const focalLengthMm = getFullFrameFocalLengthMm();
  const value = Number.isFinite(focalLengthMm)
    ? (focalLengthMm >= 10.0 ? focalLengthMm.toFixed(0) : focalLengthMm.toFixed(1))
    : "-";
  return `${value} mm ${viewAnglePresetIndex + 1}/${VIEW_ANGLE_PRESETS.length}`;
}

function getProjectionLabel() {
  return projectionMode === PROJECTION_MODE_ORTHOGRAPHIC ? "Ortho" : "Persp";
}

// Perspective の clip-space zBias は望遠側ほど効きすぎて見えやすい。
// 短辺 FOV の tan 比で弱めると、画面上の見え方の変化に合わせて bias も小さくできる。
function getPerspectiveZBiasScale() {
  const viewAngle = Number(app?.viewAngle ?? VIEW_ANGLE_PRESETS[viewAnglePresetIndex]);
  if (!Number.isFinite(viewAngle) || viewAngle <= 0.0 || viewAngle >= 180.0) {
    throw new Error(`webgmodeler zBias scale requires valid viewAngle: ${viewAngle}`);
  }
  const currentTan = Math.tan(viewAngle * 0.5 * Math.PI / 180.0);
  const referenceTan = Math.tan(Z_BIAS_REFERENCE_VIEW_ANGLE * 0.5 * Math.PI / 180.0);
  if (!Number.isFinite(currentTan) || currentTan <= 0.0 || !Number.isFinite(referenceTan) || referenceTan <= 0.0) {
    throw new Error(`webgmodeler zBias scale produced invalid tangent: current=${currentTan} reference=${referenceTan}`);
  }
  return currentTan / referenceTan;
}

function getEdgeOverlayZBias() {
  if (projectionMode === PROJECTION_MODE_ORTHOGRAPHIC) {
    return EDGE_Z_BIAS_ORTHOGRAPHIC;
  }
  return EDGE_Z_BIAS_PERSPECTIVE * getPerspectiveZBiasScale();
}

function getMarkerOverlayZBias() {
  if (projectionMode === PROJECTION_MODE_ORTHOGRAPHIC) {
    return MARKER_Z_BIAS_ORTHOGRAPHIC;
  }
  return MARKER_Z_BIAS_PERSPECTIVE * getPerspectiveZBiasScale();
}

function markProjectionDependentsDirty() {
  selectedFaceShader?.setProjectionMatrix?.(app.projectionMatrix);
  markerOverlayDirty = true;
  overlayEdgeUploadDirty = true;
}

function getOrthographicViewHeight() {
  const distance = Number(orbit?.orbit?.distance);
  const viewAngle = Number(app?.viewAngle);
  if (!Number.isFinite(distance) || distance <= 0.0) {
    throw new Error(`orthographic projection requires positive orbit distance: ${distance}`);
  }
  if (!Number.isFinite(viewAngle) || viewAngle <= 0.0) {
    throw new Error(`orthographic projection requires positive viewAngle: ${viewAngle}`);
  }
  const vfov = app.screen.getRecommendedFov(viewAngle);
  if (!Number.isFinite(vfov) || vfov <= 0.0) {
    throw new Error(`orthographic projection requires positive recommended fov: ${vfov}`);
  }
  return 2.0 * distance * Math.tan(vfov * 0.5 * Math.PI / 180.0);
}

function readPositiveRecommendedFov(viewAngle, label) {
  const vfov = app.screen.getRecommendedFov(viewAngle);
  if (!Number.isFinite(vfov) || vfov <= 0.0) {
    throw new Error(`${label} requires positive recommended fov: ${vfov}`);
  }
  return vfov;
}

function adjustPerspectiveDistanceForViewAngle(oldViewAngle, newViewAngle) {
  if (!app || !orbit || projectionMode !== PROJECTION_MODE_PERSPECTIVE) {
    return;
  }
  const distance = Number(orbit.orbit.distance);
  if (!Number.isFinite(distance) || distance <= 0.0) {
    throw new Error(`viewAngle distance compensation requires positive orbit distance: ${distance}`);
  }
  const oldFov = readPositiveRecommendedFov(oldViewAngle, "old viewAngle compensation");
  const newFov = readPositiveRecommendedFov(newViewAngle, "new viewAngle compensation");
  const oldTan = Math.tan(oldFov * 0.5 * Math.PI / 180.0);
  const newTan = Math.tan(newFov * 0.5 * Math.PI / 180.0);
  if (!Number.isFinite(oldTan) || oldTan <= 0.0 || !Number.isFinite(newTan) || newTan <= 0.0) {
    throw new Error(`viewAngle distance compensation produced invalid tangent: old=${oldTan} new=${newTan}`);
  }
  orbit.setDistance(distance * oldTan / newTan);
  app.syncCameraFromEyeRig(orbit);
}

// Orthographic では orbit distance を表示高さの計算に使うため、
// viewAngle 変更時に distance を逆補正して画面上の拡大率を保つ
function adjustOrthographicDistanceForViewAngle(oldViewAngle, newViewAngle) {
  if (!app || !orbit || projectionMode !== PROJECTION_MODE_ORTHOGRAPHIC) {
    return;
  }
  const distance = Number(orbit.orbit.distance);
  if (!Number.isFinite(distance) || distance <= 0.0) {
    throw new Error(`orthographic viewAngle compensation requires positive orbit distance: ${distance}`);
  }
  const oldFov = readPositiveRecommendedFov(oldViewAngle, "old orthographic viewAngle compensation");
  const newFov = readPositiveRecommendedFov(newViewAngle, "new orthographic viewAngle compensation");
  const oldTan = Math.tan(oldFov * 0.5 * Math.PI / 180.0);
  const newTan = Math.tan(newFov * 0.5 * Math.PI / 180.0);
  if (!Number.isFinite(oldTan) || oldTan <= 0.0 || !Number.isFinite(newTan) || newTan <= 0.0) {
    throw new Error(`orthographic viewAngle compensation produced invalid tangent: old=${oldTan} new=${newTan}`);
  }
  orbit.setDistance(distance * oldTan / newTan);
  app.syncCameraFromEyeRig(orbit);
}

function makeProjectionUpdateKey() {
  if (!app) {
    throw new Error("makeProjectionUpdateKey requires initialized app");
  }
  const distance = Number(orbit?.orbit?.distance);
  const aspect = app.screen.getAspect();
  return [
    projectionMode,
    Number(app.viewAngle).toFixed(6),
    Number(app.projectionNear).toFixed(6),
    Number(app.projectionFar).toFixed(6),
    Number.isFinite(distance) ? distance.toFixed(6) : "no-orbit-distance",
    Number(aspect).toFixed(6)
  ].join("|");
}

function applyModelerProjection(options = {}) {
  if (!app) {
    throw new Error("applyModelerProjection requires initialized app");
  }
  const nextProjectionKey = makeProjectionUpdateKey();
  if (options.force !== true && projectionUpdateKey === nextProjectionKey) {
    return false;
  }
  if (projectionMode === PROJECTION_MODE_ORTHOGRAPHIC) {
    app.updateOrthographicProjection(getOrthographicViewHeight());
  } else {
    app.updateProjection(app.viewAngle);
  }
  projectionUpdateKey = nextProjectionKey;
  markProjectionDependentsDirty();
  if (options.announce === true) {
    setMessage(`projection ${getProjectionLabel()} ${getFocalLengthLabel()}`);
  } else if (options.updateStatus === true) {
    updateStatus();
  }
  return true;
}

function applyViewAnglePreset(index, options = {}) {
  const total = VIEW_ANGLE_PRESETS.length;
  const oldViewAngle = Number(app?.viewAngle ?? VIEW_ANGLE_PRESETS[viewAnglePresetIndex]);
  viewAnglePresetIndex = ((Math.floor(index) % total) + total) % total;
  const viewAngle = VIEW_ANGLE_PRESETS[viewAnglePresetIndex];
  if (app) {
    adjustPerspectiveDistanceForViewAngle(oldViewAngle, viewAngle);
    adjustOrthographicDistanceForViewAngle(oldViewAngle, viewAngle);
    app.viewAngle = viewAngle;
    applyModelerProjection({
      updateStatus: false
    });
  }
  if (options.announce !== false) {
    setMessage(`focalLength ${getProjectionLabel()} ${getFocalLengthLabel()}`);
  } else {
    updateStatus();
  }
}

function cycleViewAnglePreset(direction = 1) {
  applyViewAnglePreset(viewAnglePresetIndex + direction);
}

function toggleProjectionMode() {
  projectionMode = projectionMode === PROJECTION_MODE_ORTHOGRAPHIC
    ? PROJECTION_MODE_PERSPECTIVE
    : PROJECTION_MODE_ORTHOGRAPHIC;
  applyModelerProjection({
    force: true,
    announce: true
  });
}

function setMobileAxisView(axis, reversed = false) {
  const normalized = String(axis ?? "").toLowerCase();
  const presetKey = normalized === "x"
    ? "3"
    : normalized === "y"
      ? "7"
      : normalized === "z"
        ? "1"
        : null;
  if (!presetKey) {
    return false;
  }
  mobileUiState.viewAxis = normalized;
  mobileUiState.viewFlip = reversed === true;
  updateMobileRibbon();
  return setOrbitViewPreset(presetKey, mobileUiState.viewFlip);
}

// ------------------------------------------------------------
// --- camera keyboard bridge
// ------------------------------------------------------------

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

// ------------------------------------------------------------
// --- DOM cache and mobile UI
// ------------------------------------------------------------

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
  ui.screenshot = document.getElementById("screenshot");
  ui.newScene = document.getElementById("newScene");
  ui.makeFace = document.getElementById("makeFace");
  ui.flipFaces = document.getElementById("flipFaces");
  ui.loopCutFaces = document.getElementById("loopCutFaces");
  ui.xMirrorEdit = document.getElementById("xMirrorEdit");
  ui.undo = document.getElementById("undo");
  ui.redo = document.getElementById("redo");
  ui.objectWireframe = document.getElementById("objectWireframe");
  ui.lightBackground = document.getElementById("lightBackground");
  ui.visiblePickOnly = document.getElementById("visiblePickOnly");
  ui.overlayAlpha = document.getElementById("overlayAlpha");
  ui.overlayAlphaValue = document.getElementById("overlayAlphaValue");
  ui.overlayMarkerColor = document.getElementById("overlayMarkerColor");
  ui.overlayMarkerColorValue = document.getElementById("overlayMarkerColorValue");
  ui.overlayEdgeColor = document.getElementById("overlayEdgeColor");
  ui.overlayEdgeColorValue = document.getElementById("overlayEdgeColorValue");
  ui.modeButtons = Array.from(document.querySelectorAll("[data-mode]"));
  ui.toolButtons = Array.from(document.querySelectorAll("[data-tool]"));
  ui.mobileRibbonName = document.querySelector('[data-role="ribbon-name"]');
  ui.mobileRibbonHint = document.querySelector('[data-role="ribbon-hint"]');
  ui.mobileRibbonHeader = document.querySelector(".ribbon-header");
  ui.mobileRibbonButtons = Array.from(document.querySelectorAll('[data-role="ribbon-action"]'));
  ui.mobileStatus = document.getElementById("mobileStatus");
  ui.mobilePalette = document.getElementById("mobilePalette");
  ui.mobilePaletteTitle = document.getElementById("mobilePaletteTitle");
  ui.mobilePaletteButtons = Array.from(document.querySelectorAll(".palette-button"));
  ui.mobileAxisChooser = document.getElementById("mobileAxisChooser");
  ui.mobileAxisButtons = Array.from(document.querySelectorAll(".axis-button"));
  ui.mobileViewButtons = Array.from(document.querySelectorAll("[data-view-action]"));
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

function getMobileToolLabel() {
  if (editor.mode === EDITOR_MODE_OBJECT) {
    return "Object";
  }
  if (editor.tool === TOOL_SELECT_VERTEX) {
    return "Vertex";
  }
  if (editor.tool === TOOL_SELECT_FACE) {
    return "Face";
  }
  if (editor.tool === TOOL_ADD_VERTEX) {
    return "Add";
  }
  return editor.tool;
}

function getMobileRibbonActionLabel(action) {
  return MOBILE_ACTION_LABELS[action] ?? { label: action, detail: "" };
}

// ユーザー指定の command palette は 4x4 の表示行をそのまま配列化する
// CSS grid は row-major で button を配置するため、ここでは画面上の行順を直接保持する
function paletteRows(rows) {
  return rows.flatMap((row) => row);
}

const MOBILE_COMMAND_PALETTES = [
  paletteRows([
    ["move", "extrude", "tool-add", "tool-vertex"],
    ["rotate", "loop-cut", "delete", "tool-face"],
    ["scale", "edge-slide", "toggle-projection", "undo"],
    ["palette-next", "toggle-x-mirror", "object-wireframe", "redo"]
  ]),
  paletteRows([
    ["select-all", "origin-world", "undefined", "load"],
    ["invert-selection", "screenshot", "undefined", "save-json"],
    ["select-x-negative", "new-scene", "undefined", "save-glb"],
    ["palette-next", "join-objects", "view-vertex", "mode-edit"]
  ]),
  paletteRows([
    ["add-cube", "add-torus", "add-sphere", "add-double-cone"],
    ["add-cylinder", "add-cone", "add-plane", "undefined"],
    ["primitive-segments-3", "primitive-segments-4", "primitive-segments-8", "primitive-segments-12"],
    ["palette-next", "primitive-segments-16", "primitive-segments-24", "primitive-segments-32"]
  ])
];

// mobile palette の Add は「追加」系の文脈 action として使う
// Edit Mode で 3/4 頂点が選択されている場合は面作成、それ以外は Add Vertex tool へ切り替える
function canMakeFaceFromMobileSelection() {
  return editor.mode === EDITOR_MODE_EDIT
      && (editor.selectedVertices.size === 3 || editor.selectedVertices.size === 4);
}

// command palette は未選択状態でも開けるため、選択が前提の command だけを個別に無効化する
// long press 自体では hit した polygon / vertex を選択せず、利用者が作った選択状態を保つ
function hasMobileSelectionForAction(action) {
  if (editor.mode === EDITOR_MODE_OBJECT) {
    return editor.selectedObjectIds.size > 0;
  }
  if (action === "extrude") {
    return editor.selectedFaces.size > 0;
  }
  return editor.selectedVertices.size > 0 || editor.selectedFaces.size > 0;
}

function isMobileActionEnabled(action) {
  if (action === "undefined") {
    return false;
  }
  if (String(action ?? "").startsWith("primitive-segments-")) {
    return true;
  }
  if (action === "move" || action === "rotate" || action === "scale" || action === "extrude" || action === "delete") {
    return hasMobileSelectionForAction(action);
  }
  if (action === "join-objects") {
    return editor.mode === EDITOR_MODE_OBJECT && editor.selectedObjectIds.size >= 2;
  }
  if (action === "save-json" || action === "save-glb") {
    return editor.vertices.length > 0 && (action !== "save-glb" || editor.faces.length > 0);
  }
  if (action === "undo") {
    return editor.undoStack.length > 0;
  }
  if (action === "redo") {
    return editor.redoStack.length > 0;
  }
  if (action === "edge-slide") {
    return editor.mode === EDITOR_MODE_EDIT && getActiveVertexObjects().length > 0;
  }
  if (action === "object-wireframe") {
    return true;
  }
  if (action === "origin-world") {
    return editor.selectedObjectIds.size > 0 || editor.activeObjectId !== null;
  }
  if (action === "loop-cut") {
    return editor.mode === EDITOR_MODE_EDIT
        && getSelectedFaceObjects().some((face) => face.indices.length === 4);
  }
  return true;
}

// mobile ribbon の toggle 系 action が現在 ON かを返す
// button の色と aria-pressed を状態に合わせるため、表示更新側で参照する
function isMobileActionActive(action) {
  if (action === "toggle-x-mirror") {
    return xMirrorEdit;
  }
  if (action === "object-wireframe") {
    return objectWireframe;
  }
  if (action === "mode-edit") {
    return editor.mode === EDITOR_MODE_EDIT;
  }
  if (action === "tool-vertex") {
    return editor.mode === EDITOR_MODE_EDIT && editor.tool === TOOL_SELECT_VERTEX;
  }
  if (action === "tool-face") {
    return editor.mode === EDITOR_MODE_EDIT && editor.tool === TOOL_SELECT_FACE;
  }
  if (action === "view-x" || action === "view-y" || action === "view-z"
      || action === "view-x-reverse" || action === "view-y-reverse" || action === "view-z-reverse") {
    const reversed = action.endsWith("-reverse");
    const axis = reversed ? action.slice(5, 6) : action.slice(-1);
    return mobileUiState.viewAxis === axis && mobileUiState.viewFlip === reversed;
  }
  if (String(action ?? "").startsWith("primitive-segments-")) {
    const segments = Number(String(action).slice("primitive-segments-".length));
    return mobileUiState.primitiveSegments === segments;
  }
  return false;
}

function updateMobileRibbon() {
  if (!IS_MOBILE_PROFILE) {
    return;
  }
  const mode = editor.mode === EDITOR_MODE_EDIT ? "edit" : "object";
  const tool = getMobileToolLabel().toLowerCase();
  const box = mobileUiState.boxSelectArmed ? " | box select armed" : "";
  if (ui.mobileStatus) {
    ui.mobileStatus.textContent = `${mode} / ${tool} | ${editor.lastMessage || "ready"}${box}`;
  }
  const page = MOBILE_RIBBON_PAGES[mobileUiState.ribbonPageIndex] ?? MOBILE_RIBBON_PAGES[0];
  if (ui.mobileRibbonName) {
    ui.mobileRibbonName.textContent = page.name;
  }
  if (ui.mobileRibbonHint) {
    ui.mobileRibbonHint.textContent = `${mode} / ${tool} | ${editor.lastMessage || "ready"}${box}`;
  }
  for (let i = 0; i < ui.mobileRibbonButtons.length; i++) {
    const button = ui.mobileRibbonButtons[i];
    const action = page.actions[i] ?? "";
    const label = getMobileRibbonActionLabel(action);
    const active = isMobileActionActive(action);
    button.dataset.action = action;
    button.innerHTML = action ? `${label.label}<br><small>${label.detail}</small>` : "";
    button.disabled = !action || !isMobileActionEnabled(action);
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  }
  for (const button of ui.mobileViewButtons) {
    const action = button.dataset.viewAction ?? "";
    const active = isMobileActionActive(action);
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  }
  renderMobileAxisChooser();
}

function setMobileOrbitEnabled(enabled) {
  if (orbit) {
    orbit.enabled = enabled;
  }
}

function closeMobilePalette() {
  mobileUiState.paletteOpen = false;
  if (ui.mobilePalette) {
    ui.mobilePalette.classList.remove("open");
  }
}

function closeMobileAxisChooser() {
  if (ui.mobileAxisChooser) {
    ui.mobileAxisChooser.classList.remove("open");
  }
}

function renderMobileAxisChooser() {
  if (!IS_MOBILE_PROFILE || !ui.mobileAxisChooser) {
    return;
  }
  const transformState = transformController?.state ?? null;
  if (!transformState?.active) {
    closeMobileAxisChooser();
    return;
  }
  ui.mobileAxisChooser.classList.add("open");
  const activeAxis = transformState.axisConstraint ?? "free";
  for (const button of ui.mobileAxisButtons) {
    const axis = button.dataset.axis ?? "free";
    const active = axis === activeAxis;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  }
}

// command palette の表示中心を決める
// CSS の translate(-50%, -50%) により left/top は palette の中心点として解釈される
// tap 位置をそのまま中心にすると、ユーザーが指定した geometry や empty 位置を palette が完全に覆ってしまう
// そのため、tap 位置が canvas 中心から見て右上なら右上、左下なら左下というように、tap 位置から外側へずらした候補を作る
// 最初の候補が画面外へはみ出す場合は対角側、その次に残りの斜め方向を試し、どれも入らない場合だけ画面内へ clamp する
function chooseMobilePaletteCenter(rect, localX, localY, halfWidth, halfHeight) {
  const margin = 12.0;
  const gap = 18.0;
  const minCenterX = halfWidth + margin;
  const maxCenterX = rect.width - halfWidth - margin;
  const minCenterY = halfHeight + margin;
  const maxCenterY = rect.height - halfHeight - margin;
  const directionX = localX >= rect.width * 0.5 ? 1.0 : -1.0;
  const directionY = localY >= rect.height * 0.5 ? 1.0 : -1.0;
  const candidates = [
    [directionX, directionY],
    [-directionX, -directionY],
    [directionX, -directionY],
    [-directionX, directionY]
  ];

  for (const [sx, sy] of candidates) {
    const centerX = localX + sx * (halfWidth + gap);
    const centerY = localY + sy * (halfHeight + gap);
    if (centerX >= minCenterX && centerX <= maxCenterX
        && centerY >= minCenterY && centerY <= maxCenterY) {
      return { x: centerX, y: centerY };
    }
  }

  return {
    x: Math.max(minCenterX, Math.min(maxCenterX, localX + directionX * (halfWidth + gap))),
    y: Math.max(minCenterY, Math.min(maxCenterY, localY + directionY * (halfHeight + gap)))
  };
}

// command palette を開く
// double tap や空 scene の操作から呼ばれ、まず保留中の single tap 選択を破棄する
// その後、tap 位置を隠さない中心点を計算して palette を配置し、1 枚目の command page を描画する
function openMobilePalette(kind, clientX, clientY) {
  if (!IS_MOBILE_PROFILE || !ui.mobilePalette) {
    return;
  }
  cancelPendingMobileCanvasTap();
  mobileUiState.paletteOpen = true;
  mobileUiState.paletteKind = kind;
  mobileUiState.palettePage = 0;
  const rect = app.screen.canvas.getBoundingClientRect();
  const paletteHalfWidth = 132;
  const paletteHalfHeight = 108;
  const localX = clientX - rect.left;
  const localY = clientY - rect.top;
  const center = chooseMobilePaletteCenter(rect, localX, localY, paletteHalfWidth, paletteHalfHeight);
  ui.mobilePalette.style.left = `${center.x}px`;
  ui.mobilePalette.style.top = `${center.y}px`;
  ui.mobilePalette.classList.add("open");
  renderMobilePalette();
}

// scene 上に選択や矩形選択の対象になる頂点があるかを確認する
// empty double tap は通常は矩形選択の準備に使うが、object が全削除された状態では囲む対象がない
// その場合は Load / primitive 追加 / New Scene などを呼び出せる command palette を開く
function hasAnyModelerVertices() {
  if (editor.vertices.length > 0) {
    return true;
  }
  return editor.objects.some((object) => Array.isArray(object.vertices) && object.vertices.length > 0);
}

// 現在表示中の command palette page に対応する action 配列を返す
// palettePage は Next button で更新されるため、範囲外になった場合は 1 枚目へ戻して安全に描画する
function getMobilePaletteActions() {
  return MOBILE_COMMAND_PALETTES[mobileUiState.palettePage] ?? MOBILE_COMMAND_PALETTES[0];
}

// command palette の 4x4 button 表示を現在 page の action に合わせて更新する
// 各 button には実行 action、表示 label、active 表示、page switch 表示、disabled 状態をまとめて反映する
// 未割り当て slot は `undefined` action として表示し、空 action は button 自体を隠す
function renderMobilePalette() {
  if (!IS_MOBILE_PROFILE) {
    return;
  }
  const actions = getMobilePaletteActions();
  for (let i = 0; i < ui.mobilePaletteButtons.length; i++) {
    const button = ui.mobilePaletteButtons[i];
    const action = actions[i] ?? "";
    const label = getMobileRibbonActionLabel(action);
    const active = isMobileActionActive(action);
    const pageSwitch = action === "palette-next";
    button.dataset.action = action;
    button.innerHTML = action ? `${label.label}<small>${label.detail}</small>` : "";
    button.disabled = !action || !isMobileActionEnabled(action);
    button.classList.toggle("active", active);
    button.classList.toggle("page-switch", pageSwitch);
    button.setAttribute("aria-pressed", active ? "true" : "false");
    button.style.visibility = action ? "visible" : "hidden";
  }
}

// transform 中の軸制限 chooser を処理する
// `G/R/S/E` の直後だけ有効で、Free / X / Y / Z の選択を transformController へ反映する
// transform が始まっていない場合は chooser を閉じ、誤操作で軸状態だけが残らないようにする
function executeMobileAxisChoice(axis) {
  if (!transformController?.state?.active) {
    closeMobileAxisChooser();
    return;
  }
  const normalized = axis === "x" || axis === "y" || axis === "z" ? axis : null;
  setTransformAxis(normalized);
  renderMobileAxisChooser();
}

// empty double tap 後に矩形選択を準備する
// camera orbit と矩形選択 drag が同じ 1 本指操作を奪い合わないよう、準備中は mobile orbit を止める
// double tap の 2 回目 pointerup と canvasClick が重なった場合は、進行中の tracking を矩形選択用へ切り替える
function armMobileBoxSelect() {
  if (!IS_MOBILE_PROFILE) {
    return;
  }
  cancelPendingMobileCanvasTap();
  mobileUiState.boxSelectArmed = true;
  if (canvasClick.active) {
    // empty double tap の確定 pointerup が canvasClick と重なった場合、
    // pointerdown 時点では boxSelectArmed が false だったため、
    // 現在進行中の click tracking を矩形選択へ切り替える
    canvasClick.additive = true;
    canvasClick.allowRectangle = true;
  }
  setMobileOrbitEnabled(false);
  closeMobilePalette();
  setMessage("box select armed: drag to add selection");
}

// 矩形選択準備を解除し、通常の camera orbit を再開する
// 矩形選択が確定した後、または別の command へ移った後に呼び、boxSelectArmed が残り続けないようにする
function disarmMobileBoxSelect() {
  if (!IS_MOBILE_PROFILE) {
    return;
  }
  mobileUiState.boxSelectArmed = false;
  setMobileOrbitEnabled(true);
}

// empty 位置で single tap した事実を記録する
// Touch の doubletap callback は pointerup 後に発火するため、2 回目 tap を押したまま drag する操作を拾いにくい
// そこで canvas pointerdown 側でも「直前が empty tap だったか」を見られるよう、時刻・座標・pointerType を保存する
function rememberMobileEmptyTap(ev) {
  if (!IS_MOBILE_PROFILE) {
    return;
  }
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  mobileUiState.lastEmptyTapTime = now;
  mobileUiState.lastEmptyTapX = Number(ev?.clientX ?? 0.0);
  mobileUiState.lastEmptyTapY = Number(ev?.clientY ?? 0.0);
  mobileUiState.lastEmptyTapPointerType = String(ev?.pointerType ?? "");
}

// mobile の短い tap を記録する
// 次の pointerdown が近い時刻・近い座標・同じ pointerType なら double tap 候補として扱う
// 2 回目 pointerdown の段階で通常 click tracking を始めないための基準値として使う
function rememberMobileCanvasTap(ev) {
  if (!IS_MOBILE_PROFILE) {
    return;
  }
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  mobileUiState.lastCanvasTapTime = now;
  mobileUiState.lastCanvasTapX = Number(ev?.clientX ?? 0.0);
  mobileUiState.lastCanvasTapY = Number(ev?.clientY ?? 0.0);
  mobileUiState.lastCanvasTapPointerType = String(ev?.pointerType ?? "");
}

// 保留中の mobile single tap 選択を破棄する
// double tap、long press、palette 表示、box select 開始が成立した場合、
// 1 回目 tap の選択処理が後から走ると操作対象が変わるため、timer と保存 event を必ず消す
function cancelPendingMobileCanvasTap() {
  if (mobileUiState.pendingCanvasTapTimer !== null) {
    clearTimeout(mobileUiState.pendingCanvasTapTimer);
  }
  mobileUiState.pendingCanvasTapTimer = null;
  mobileUiState.pendingCanvasTapEvent = null;
}

// 後で single tap 選択を実行するため、PointerEvent から必要な値だけを取り出す
// DOM Event を timer 後にそのまま使うと、環境によって状態が変わったり参照が読みにくくなる
// handleCanvasClick が参照する座標・button・modifier・preventDefault だけを持つ軽い object にする
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

// mobile の single tap 選択を double tap 判定時間だけ遅延させる
// 2 回目 tap や long press が来なかった場合だけ、保存した snapshot を handleCanvasClick へ渡して通常選択を確定する
// desktop profile では操作感を変えないため、従来通り即時に handleCanvasClick を呼ぶ
function scheduleMobileCanvasTap(ev) {
  if (!IS_MOBILE_PROFILE) {
    handleCanvasClick(ev);
    return;
  }
  cancelPendingMobileCanvasTap();
  const snapshot = makeCanvasClickSnapshot(ev);
  mobileUiState.pendingCanvasTapEvent = snapshot;
  mobileUiState.pendingCanvasTapTimer = setTimeout(() => {
    const pending = mobileUiState.pendingCanvasTapEvent;
    mobileUiState.pendingCanvasTapTimer = null;
    mobileUiState.pendingCanvasTapEvent = null;
    if (!pending || transformController?.state?.active || mobileUiState.paletteOpen || mobileUiState.boxSelectArmed) {
      return;
    }
    handleCanvasClick(pending);
  }, 340);
}

// empty double tap から、そのまま指を離さず drag したかを pointerdown 時点で判定する
// Touch の doubletap callback は pointerup 後に発火するため、2 回目の tap を押したまま drag する操作は callback だけでは拾えない
// 直前の empty tap と時間・距離・pointerType が近く、現在位置も empty なら、矩形選択を開始してよいと判断する
// 図形が 1 つもない場合は矩形選択対象がないため false にし、empty scene の double tap は command palette 側へ任せる
function shouldStartMobileBoxSelectFromDoubleTapDown(ev) {
  if (!IS_MOBILE_PROFILE || mobileUiState.boxSelectArmed || transformController?.state?.active) {
    return false;
  }
  if (!hasAnyModelerVertices()) {
    return false;
  }
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  if ((now - mobileUiState.lastEmptyTapTime) > 320.0) {
    return false;
  }
  if (String(ev?.pointerType ?? "") !== mobileUiState.lastEmptyTapPointerType) {
    return false;
  }
  const distance = Math.hypot(
    Number(ev?.clientX ?? 0.0) - mobileUiState.lastEmptyTapX,
    Number(ev?.clientY ?? 0.0) - mobileUiState.lastEmptyTapY
  );
  if (distance > 24.0) {
    return false;
  }
  const hit = inspectGestureTarget(ev.clientX, ev.clientY);
  return hit.kind === "empty";
}

// double tap の 2 回目を通常の click selection として処理しないための判定
// 直前の canvas tap と近い位置で 2 回目 pointerdown が来た場合は、single tap ではなく double tap 候補として扱う
// この時点で canvasClick を開始しないことで、pointerup 側の handleCanvasClick が選択解除や active object 変更を起こすのを防ぐ
// empty + 図形ありの組み合わせは box select の開始として shouldStartMobileBoxSelectFromDoubleTapDown が先に処理する
function shouldSuppressMobileClickForDoubleTapDown(ev) {
  if (!IS_MOBILE_PROFILE || mobileUiState.boxSelectArmed || transformController?.state?.active) {
    return false;
  }
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  if ((now - mobileUiState.lastCanvasTapTime) > 320.0) {
    return false;
  }
  if (String(ev?.pointerType ?? "") !== mobileUiState.lastCanvasTapPointerType) {
    return false;
  }
  const distance = Math.hypot(
    Number(ev?.clientX ?? 0.0) - mobileUiState.lastCanvasTapX,
    Number(ev?.clientY ?? 0.0) - mobileUiState.lastCanvasTapY
  );
  if (distance > 24.0) {
    return false;
  }
  const hit = inspectGestureTarget(ev.clientX, ev.clientY);
  if (hit.kind === "empty" && hasAnyModelerVertices()) {
    return false;
  }
  return true;
}

// mobile ribbon の page index を左右へ循環させる
// 現在の UI では command palette が主操作なので通常は使わないが、
// 旧 ribbon gesture 経路が残っている場合でも page 範囲外へ出ないよう modulo で正規化する
function cycleMobileRibbonPage(step) {
  const count = MOBILE_RIBBON_PAGES.length;
  mobileUiState.ribbonPageIndex = (mobileUiState.ribbonPageIndex + step + count) % count;
  updateMobileRibbon();
  setMessage(`ribbon: ${MOBILE_RIBBON_PAGES[mobileUiState.ribbonPageIndex].name.toLowerCase()}`);
}

// リボン上の左右 flick だけを page 切替 shortcut として受け入れる
// canvas 上の一本指 drag は camera orbit の基本操作なので、速度に関係なく flick と兼用しない
function shouldAcceptMobileFlickShortcut(gesture) {
  if (transformController?.state?.active || mobileUiState.boxSelectArmed) {
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
  const maxMs = isMousePointer ? MOBILE_MOUSE_FLICK_MAX_MS : MOBILE_TOUCH_FLICK_MAX_MS;
  const minSpeed = isMousePointer ? MOBILE_MOUSE_FLICK_MIN_SPEED_PX_PER_MS : MOBILE_TOUCH_FLICK_MIN_SPEED_PX_PER_MS;
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
  if (absX < absY * MOBILE_FLICK_HORIZONTAL_DOMINANCE) {
    return false;
  }
  return elapsedMs <= maxMs
      && (distance / elapsedMs) >= minSpeed;
}

// pointer 診断で flick / camera drag の境界を読み取りやすくするため、
// gesture の時間と速度を短い文字列にまとめる
function formatMobileGestureMotion(gesture) {
  const elapsedMs = Number(gesture.elapsedMs);
  const distance = Number(gesture.distance);
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0.0
      || !Number.isFinite(distance) || distance < 0.0) {
    return "";
  }
  const speed = distance / elapsedMs;
  return ` ${Math.round(elapsedMs)}ms ${speed.toFixed(2)}px/ms`;
}

// mmodeler のリボン切替として受け入れた flick を一箇所で実行する
// pointerup 後に同じリボン button の click / pointerup action が続かないよう、
// 短時間だけ mobile button activation も抑制する
function executeMobileFlickShortcut(gesture, source) {
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  if (mobileUiState.lastFlickPointerId === gesture.pointerId
      && (now - mobileUiState.lastFlickTime) < 120.0) {
    return true;
  }
  mobileUiState.lastFlickPointerId = gesture.pointerId;
  mobileUiState.lastFlickTime = now;
  mobileUiState.lastGesture = `flick:${gesture.direction || "-"}:${source}${formatMobileGestureMotion(gesture)}`;
  mobileUiState.lastGesturePointer = gesture.pointerType || "-";
  mobileUiState.suppressMobileButtonPointerId = Number.isInteger(gesture.pointerId) ? gesture.pointerId : null;
  mobileUiState.suppressMobileButtonUntil = now + 320.0;
  suppressNextCanvasPointer(gesture.pointerId);
  if (mobileUiState.paletteOpen) {
    closeMobilePalette();
  }
  if (gesture.direction === "left") {
    cycleMobileRibbonPage(1);
  } else if (gesture.direction === "right") {
    cycleMobileRibbonPage(-1);
  }
  return true;
}

// mmodeler のリボン切替は、camera orbit と同じ canvas drag へ割り当てない
// `.mobile-ribbon` 上で始まった横 flick だけを window の pointerup まで追跡する
function installMobileRawFlickHandlers(canvas) {
  const isMobileRibbonTarget = (target) => {
    if (typeof target?.closest !== "function") {
      return false;
    }
    return Boolean(target.closest(".mobile-ribbon"));
  };
  const begin = (ev) => {
    if (!IS_MOBILE_PROFILE || transformController?.state?.active || mobileUiState.boxSelectArmed) {
      mobileUiState.flickPointer = null;
      return;
    }
    if (!isMobileRibbonTarget(ev.target)) {
      mobileUiState.flickPointer = null;
      return;
    }
    if (String(ev.pointerType ?? "") !== "touch" && ev.button !== 0) {
      mobileUiState.flickPointer = null;
      return;
    }
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    mobileUiState.flickPointer = {
      pointerId: ev.pointerId,
      pointerType: String(ev.pointerType ?? ""),
      startX: ev.clientX,
      startY: ev.clientY,
      lastX: ev.clientX,
      lastY: ev.clientY,
      startTime: now
    };
    const targetName = ev.target?.tagName ? String(ev.target.tagName).toLowerCase() : "-";
    mobileUiState.lastGesture = `rawstart:${mobileUiState.flickPointer.pointerType || "-"}:${targetName}`;
    mobileUiState.lastGesturePointer = mobileUiState.flickPointer.pointerType || "-";
  };
  const move = (ev) => {
    const state = mobileUiState.flickPointer;
    if (!state || ev.pointerId !== state.pointerId) {
      return;
    }
    state.lastX = ev.clientX;
    state.lastY = ev.clientY;
  };
  const end = (ev) => {
    const state = mobileUiState.flickPointer;
    if (!state || ev.pointerId !== state.pointerId) {
      return;
    }
    mobileUiState.flickPointer = null;
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
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
      elapsedMs: now - state.startTime,
      pointerType: state.pointerType,
      pointerId: state.pointerId
    };
    if (!shouldAcceptMobileFlickShortcut(gesture)) {
      mobileUiState.lastGesture = `rawdrag:${gesture.direction || "-"}${formatMobileGestureMotion(gesture)}`;
      mobileUiState.lastGesturePointer = gesture.pointerType || "-";
      return;
    }
    executeMobileFlickShortcut(gesture, "raw");
    if (ev.cancelable !== false) {
      ev.preventDefault();
    }
  };
  const cancel = (ev) => {
    const state = mobileUiState.flickPointer;
    if (state && ev.pointerId === state.pointerId) {
      mobileUiState.flickPointer = null;
      mobileUiState.lastGesture = "rawcancel";
      mobileUiState.lastGesturePointer = state.pointerType || "-";
    }
  };
  window.addEventListener("pointerdown", begin, true);
  window.addEventListener("pointermove", move, true);
  window.addEventListener("pointerup", end, true);
  window.addEventListener("pointercancel", cancel, true);
}

// リボン flick と同じ pointerup / click で button action が発火すると、
// page 切替と command 実行が同時に起きて操作が読みにくくなる
// flick 確定直後の button activation はここで明示的に抑制する
function shouldSuppressMobileButtonActivation(ev = null) {
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  if (now > mobileUiState.suppressMobileButtonUntil) {
    mobileUiState.suppressMobileButtonPointerId = null;
    mobileUiState.suppressMobileButtonUntil = 0;
    return false;
  }
  if (mobileUiState.suppressMobileButtonPointerId === null) {
    return true;
  }
  return ev?.pointerId === mobileUiState.suppressMobileButtonPointerId;
}

function suppressNextCanvasPointer(pointerId = null, durationMs = 520) {
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  mobileUiState.suppressCanvasPointerId = Number.isInteger(pointerId) ? pointerId : null;
  mobileUiState.suppressCanvasPointerUntil = now + durationMs;
}

function shouldSuppressCanvasPointer(ev) {
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  if (now > mobileUiState.suppressCanvasPointerUntil) {
    mobileUiState.suppressCanvasPointerId = null;
    mobileUiState.suppressCanvasPointerUntil = 0;
    return false;
  }
  if (mobileUiState.suppressCanvasPointerId === null) {
    return true;
  }
  return ev.pointerId === mobileUiState.suppressCanvasPointerId;
}

function inspectGestureTarget(clientX, clientY) {
  if (!app?.screen?.canvas) {
    return { kind: "empty" };
  }
  const ray = makeRayFromMouse(app.screen.canvas, clientX, clientY);
  if (editor.mode === EDITOR_MODE_OBJECT) {
    const objectHit = pickObjectFace(ray);
    return objectHit ? { kind: "object", ...objectHit } : { kind: "empty" };
  }
  if (editor.tool === TOOL_SELECT_VERTEX) {
    const marker = pickVertexByRayDistance(ray) ?? pickVertexMarker(ray);
    if (marker) {
      return { kind: "vertex", vertexId: marker.vertexId };
    }
  }
  const faceHit = pickSelectableFace(ray);
  return faceHit ? { kind: "face", ...faceHit } : { kind: "empty" };
}

function executeMobileAction(action) {
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  if (mobileUiState.lastAction === action && (now - mobileUiState.lastActionTime) < 280) {
    return;
  }
  mobileUiState.lastAction = action;
  mobileUiState.lastActionTime = now;
  if (action === "palette-next") {
    mobileUiState.palettePage = (mobileUiState.palettePage + 1) % MOBILE_COMMAND_PALETTES.length;
    renderMobilePalette();
    setMessage(`command palette ${mobileUiState.palettePage + 1}`);
    return;
  }
  if (String(action ?? "").startsWith("primitive-segments-")) {
    const segments = Number(String(action).slice("primitive-segments-".length));
    if (![3, 4, 8, 12, 16, 24, 32].includes(segments)) {
      throw new Error(`invalid primitive segment count: ${action}`);
    }
    mobileUiState.primitiveSegments = segments;
    renderMobilePalette();
    setMessage(`primitive segments ${segments}`);
    return;
  }
  closeMobilePalette();
  if (!action) {
    return;
  }
  if (action === "undefined") {
    setMessage("undefined command slot");
    return;
  }
  if (!isMobileActionEnabled(action)) {
    return;
  }
  if (action === "load") {
    ui.fileInput?.click();
    setMessage("open file picker");
    return;
  }
  if (action === "save-json") {
    saveModelAssetJsonGz().catch((err) => {
      console.error(err);
      setMessage(`save failed: ${err?.message ?? err}`);
    });
    return;
  }
  if (action === "save-glb") {
    saveGlb();
    return;
  }
  if (action === "new-scene") {
    createInitialModel();
    setMessage("new model");
    return;
  }
  if (action === "add-cube" || action === "add-plane" || action === "add-sphere"
      || action === "add-cylinder" || action === "add-cone"
      || action === "add-torus" || action === "add-double-cone") {
    addPrimitiveObject(action.slice(4));
    return;
  }
  if (action === "join-objects") {
    joinSelectedObjects();
    return;
  }
  if (action === "toggle-projection") {
    toggleProjectionMode();
    return;
  }
  if (action === "toggle-x-mirror") {
    toggleXMirrorEdit();
    return;
  }
  if (action === "view-vertex") {
    showSelectedVertexCoordinates();
    return;
  }
  if (action === "object-wireframe") {
    toggleObjectWireframe();
    return;
  }
  if (action === "undo") {
    undo();
    return;
  }
  if (action === "redo") {
    redo();
    return;
  }
  if (action === "screenshot") {
    takeModelerScreenshot();
    return;
  }
  if (action === "view-x" || action === "view-y" || action === "view-z"
      || action === "view-x-reverse" || action === "view-y-reverse" || action === "view-z-reverse") {
    const reversed = action.endsWith("-reverse");
    const axis = reversed ? action.slice(5, 6) : action.slice(-1);
    setMobileAxisView(axis, reversed);
    return;
  }
  if (action === "move") {
    if (setTransformMode("move")) {
      renderMobileAxisChooser();
    }
    return;
  }
  if (action === "rotate") {
    if (setTransformMode("rotate")) {
      renderMobileAxisChooser();
    }
    return;
  }
  if (action === "scale") {
    if (setTransformMode("scale")) {
      renderMobileAxisChooser();
    }
    return;
  }
  if (action === "extrude") {
    if (setTransformMode("extrude")) {
      renderMobileAxisChooser();
    }
    return;
  }
  if (action === "loop-cut") {
    loopCutSelectedFaces();
    return;
  }
  if (action === "delete") {
    deleteSelected();
    return;
  }
  if (action === "origin-world") {
    moveSelectedObjectsToWorldOrigin();
    return;
  }
  if (action === "invert-selection") {
    invertSelectionForCurrentMode();
    return;
  }
  if (action === "select-x-negative") {
    selectXNegativeForCurrentMode();
    return;
  }
  if (action === "edge-slide") {
    if (setTransformMode("edge-slide")) {
      renderMobileAxisChooser();
    }
    return;
  }
  if (action === "mode-object") {
    setEditorMode(EDITOR_MODE_OBJECT);
    return;
  }
  if (action === "mode-edit") {
    setEditorMode(isEditMode() ? EDITOR_MODE_OBJECT : EDITOR_MODE_EDIT);
    return;
  }
  if (action === "tool-face") {
    setTool(TOOL_SELECT_FACE);
    return;
  }
  if (action === "tool-vertex") {
    setTool(TOOL_SELECT_VERTEX);
    return;
  }
  if (action === "tool-add") {
    if (canMakeFaceFromMobileSelection()) {
      makeFaceFromSelection();
      return;
    }
    setTool(TOOL_ADD_VERTEX);
    return;
  }
  if (action === "select-all") {
    selectAllForCurrentMode();
  }
}

function installMobileOverlayHandlers() {
  if (!IS_MOBILE_PROFILE) {
    return;
  }
  for (const button of ui.mobileRibbonButtons) {
    button.addEventListener("pointerup", (ev) => {
      if (ev.pointerType === "touch") {
        ev.preventDefault();
        if (shouldSuppressMobileButtonActivation(ev)) {
          return;
        }
        executeMobileAction(button.dataset.action);
      }
    });
    button.addEventListener("click", (ev) => {
      if (shouldSuppressMobileButtonActivation(ev)) {
        ev.preventDefault();
        return;
      }
      executeMobileAction(button.dataset.action);
    });
  }
  for (const button of ui.mobilePaletteButtons) {
    button.addEventListener("pointerup", (ev) => {
      if (ev.pointerType === "touch") {
        ev.preventDefault();
        if (shouldSuppressMobileButtonActivation(ev)) {
          return;
        }
        executeMobileAction(button.dataset.action);
      }
    });
    button.addEventListener("click", (ev) => {
      if (shouldSuppressMobileButtonActivation(ev)) {
        ev.preventDefault();
        return;
      }
      executeMobileAction(button.dataset.action);
    });
  }
  for (const button of ui.mobileAxisButtons) {
    button.addEventListener("pointerup", (ev) => {
      if (ev.pointerType === "touch") {
        ev.preventDefault();
        mobileUiState.suppressAxisClickUntil = (typeof performance !== "undefined" ? performance.now() : Date.now()) + 350.0;
        executeMobileAxisChoice(button.dataset.axis);
      }
    });
    button.addEventListener("click", (ev) => {
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      if (now < mobileUiState.suppressAxisClickUntil) {
        ev.preventDefault();
        return;
      }
      executeMobileAxisChoice(button.dataset.axis);
    });
  }
  for (const button of ui.mobileViewButtons) {
    button.addEventListener("pointerup", (ev) => {
      if (ev.pointerType === "touch") {
        ev.preventDefault();
        if (shouldSuppressMobileButtonActivation(ev)) {
          return;
        }
        executeMobileAction(button.dataset.viewAction);
      }
    });
    button.addEventListener("click", (ev) => {
      if (shouldSuppressMobileButtonActivation(ev)) {
        ev.preventDefault();
        return;
      }
      executeMobileAction(button.dataset.viewAction);
    });
  }
}

function installMobileGestureHandlers() {
  if (!IS_MOBILE_PROFILE || !app?.screen?.canvas) {
    return;
  }
  app.screen.canvas.style.touchAction = "none";
  mobileUiState.touch?.detach?.();
  mobileUiState.gestureAttached = false;
  const touch = new Touch(document, {
    touchDeviceOnly: false
  });
  mobileUiState.touch = touch.attachSurface(app.screen.canvas, {
    // PC ブラウザでの開発・デバッグでも long press / flick を確認できるよう、
    // coarse pointer 判定による listener 未登録を避け、mouse pointer も gesture 入力として受け付ける
    touchDeviceOnly: false,
    touchOnly: false,
    cancelOnPointerLeave: false,
    longPressTime: 360,
    minDistance: 56,
    onDoubleTap: (gesture) => {
      cancelPendingMobileCanvasTap();
      mobileUiState.lastGesture = "doubletap";
      mobileUiState.lastGesturePointer = gesture.pointerType || "-";
      if (transformController?.state?.active) {
        return;
      }
      const hit = inspectGestureTarget(gesture.x, gesture.y);
      if (hit.kind === "empty") {
        // double tap は pointerup で確定するため、同じ pointerup が通常クリック選択として続かないよう短時間だけ抑制する
        // 次の drag まで抑制が残ると矩形選択を始められないので、同一 event 用の短い抑制に留める
        if (hasAnyModelerVertices()) {
          suppressNextCanvasPointer(gesture.pointerId, 80);
          armMobileBoxSelect();
        } else {
          suppressNextCanvasPointer(gesture.pointerId);
          openMobilePalette("empty-scene", gesture.x, gesture.y);
          setMessage("command palette");
        }
        return;
      }
      const hasObjectSelection = editor.selectedObjectIds.size > 0;
      const hasEditSelection = editor.selectedVertices.size > 0 || editor.selectedFaces.size > 0;
      if ((editor.mode === EDITOR_MODE_OBJECT && hasObjectSelection)
          || (editor.mode === EDITOR_MODE_EDIT && hasEditSelection)) {
        suppressNextCanvasPointer(gesture.pointerId);
        openMobilePalette("selection", gesture.x, gesture.y);
        setMessage("command palette");
        return;
      }
      // 未選択状態で command palette を開く場合も、pointer 下の object / face / vertex は選択しない
      // Load / New / projection / view など、選択なしで意味を持つ command を呼び出せるようにする
      suppressNextCanvasPointer(gesture.pointerId);
      openMobilePalette("selection", gesture.x, gesture.y);
      setMessage("command palette");
    },
    onLongPress: (gesture) => {
      cancelPendingMobileCanvasTap();
      mobileUiState.lastGesture = "longpress";
      mobileUiState.lastGesturePointer = gesture.pointerType || "-";
      if (transformController?.state?.active) {
        return;
      }
      suppressNextCanvasPointer(gesture.pointerId);
      disarmMobileBoxSelect();
      const hit = inspectGestureTarget(gesture.x, gesture.y);
      if (hit.kind === "empty") {
        // empty の長押しはブラウザの拡大 gesture と誤認されると画面全体の scale が崩れるため、
        // mobile では camera fit を割り当てず、状態確認だけに留める
        setMessage("empty long press");
        return;
      }
      setEditorMode(isEditMode() ? EDITOR_MODE_OBJECT : EDITOR_MODE_EDIT);
    },
    onFlick: null
  });
  mobileUiState.gestureAttached = Boolean(mobileUiState.touch);
  installMobileRawFlickHandlers(app.screen.canvas);
}

function installSafariCalloutGuards() {
  if (!IS_MOBILE_PROFILE || !app?.screen?.canvas) {
    return;
  }
  const preventDefault = (ev) => {
    ev.preventDefault();
  };
  const preventDefaultCapture = (ev) => {
    ev.preventDefault();
  };
  const canvas = app.screen.canvas;
  const appRoot = document.querySelector(".app");
  const viewport = document.querySelector(".viewport");
  const guardTargets = [
    document,
    document.body,
    appRoot,
    viewport,
    canvas,
    ui.mobileRibbonHeader,
    ui.mobileRibbonName,
    ui.mobileRibbonHint,
    ui.mobilePalette,
    ui.mobilePaletteTitle,
    ui.mobileAxisChooser,
    ...ui.mobileViewButtons,
    ...ui.mobilePaletteButtons,
    ...ui.mobileAxisButtons,
    ...ui.mobileRibbonButtons
  ].filter(Boolean);
  for (const target of guardTargets) {
    target.addEventListener("contextmenu", preventDefault);
    target.addEventListener("selectstart", preventDefault);
    target.addEventListener("dragstart", preventDefault);
  }
  const touchGuardTargets = [
    document,
    document.body,
    appRoot,
    viewport,
    canvas
  ].filter(Boolean);
  for (const target of touchGuardTargets) {
    target.addEventListener("touchstart", preventDefaultCapture, { passive: false, capture: true });
    target.addEventListener("touchmove", preventDefaultCapture, { passive: false, capture: true });
    target.addEventListener("touchend", preventDefaultCapture, { passive: false, capture: true });
    target.addEventListener("touchcancel", preventDefaultCapture, { passive: false, capture: true });
    target.addEventListener("gesturestart", preventDefaultCapture, { passive: false, capture: true });
    target.addEventListener("gesturechange", preventDefaultCapture, { passive: false, capture: true });
    target.addEventListener("gestureend", preventDefaultCapture, { passive: false, capture: true });
  }
  document.addEventListener("selectionchange", () => {
    const selection = document.getSelection?.();
    if (selection && selection.rangeCount > 0) {
      selection.removeAllRanges();
    }
  });
}

// ------------------------------------------------------------
// --- status and command availability
// ------------------------------------------------------------

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
    SAMPLE_NAME,
    `mode=${editor.mode}`,
    `activeObject=${activeObject ? `${activeObject.id}:${activeObject.name}` : "-"}`,
    `objects=${editor.objects.length}`,
    `selectedObjects=${editor.selectedObjectIds.size} [${objectIds}]`,
    `objectWireframe=${objectWireframe ? "on" : "off"}`,
    `tool=${editor.tool}`,
    `vertices=${editor.vertices.length} faces=${editor.faces.length}`,
    `selectedVertices=${editor.selectedVertices.size} [${vertexIds}]`,
    `selectedFaces=${editor.selectedFaces.size} [${faceIds}]`,
    `lastVertex=${getLastSelectedVertexLabel()}`,
    `meshSelect=${meshName}`,
    `undo=${editor.undoStack.length} redo=${editor.redoStack.length}`,
    `xMirror=${xMirrorEdit ? "on" : "off"}`,
    `background=${lightBackground ? "light" : "dark"}`,
    `visiblePick=${visiblePickOnly ? "visible only" : "through"}`,
    `visiblePickStats=${visiblePickStats.mode} candidates=${visiblePickStats.candidates} selected=${visiblePickStats.selected} gridFaces=${visiblePickStats.gridFaces} filledCells=${visiblePickStats.gridCells} avgFaces=${visiblePickStats.avgFacesPerFilledCell.toFixed(1)} maxFaces=${visiblePickStats.maxFacesPerCell}`,
    `overlayAlpha=${overlayAlpha.toFixed(2)}`,
    `overlayMarker=${rgbToHexColor(overlayMarkerColor)} overlayEdge=${rgbToHexColor(overlayEdgeColor)}`,
    `projection=${getProjectionLabel()}`,
    `focalLength=${getFocalLengthLabel()}`,
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
  if (!IS_MOBILE_PROFILE) {
    app?.setHudRows?.([
      { line: SAMPLE_NAME },
      { label: "Proj", value: getProjectionLabel() },
      { label: "Lens", value: getFocalLengthLabel() },
      { label: "V/F", value: `${editor.vertices.length}/${editor.faces.length}` },
      { label: "Selected", value: `o${editor.selectedObjectIds.size} v${editor.selectedVertices.size} f${editor.selectedFaces.size}` },
      { label: "Vertex", value: getLastSelectedVertexLabel() },
      { label: "Msg", value: editor.lastMessage }
    ], {
      x: 0,
      y: 0,
      width: 46,
      wrap: true
    });
  }
  updateMobileRibbon();
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
    ui.objectWireframe.disabled = false;
  }
  if (ui.lightBackground) {
    ui.lightBackground.setAttribute("aria-pressed", lightBackground ? "true" : "false");
  }
  if (ui.visiblePickOnly) {
    ui.visiblePickOnly.setAttribute("aria-pressed", visiblePickOnly ? "true" : "false");
  }
  if (ui.xMirrorEdit) {
    ui.xMirrorEdit.setAttribute("aria-pressed", xMirrorEdit ? "true" : "false");
  }
  // DOM control の disabled 状態を null 安全に切り替える
  setDisabled(ui.makeFace, !editMode || (selectedVertexCount !== 3 && selectedVertexCount !== 4));
  // DOM control の disabled 状態を null 安全に切り替える
  setDisabled(ui.flipFaces, !editMode || selectedFaceCount === 0);
  // DOM control の disabled 状態を null 安全に切り替える
  setDisabled(ui.loopCutFaces, !editMode || !getSelectedFaceObjects().some((face) => face.indices.length === 4));
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

// 読み込みのような重い処理へ入る前に、直前の status/message をブラウザへ描画させる
// iPhone Safari で固まる場合でも、最後に描画された文言から停止段階を推定できるようにする
function waitForStatusPaint() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

// ------------------------------------------------------------
// --- undo and redo snapshots
// ------------------------------------------------------------

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
      origin: getObjectOrigin(object),
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
    lastSelectedVertexId: editor.lastSelectedVertexId,
    explicitXMirrorVertexPairs: Array.from(explicitXMirrorVertexPairs.entries()),
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
      origin: readVec3(object.origin ?? [0.0, 0.0, 0.0], `snapshot object ${object.id} origin`),
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
  editor.lastSelectedVertexId = snapshot.lastSelectedVertexId ?? null;
  explicitXMirrorVertexPairs.clear();
  for (const [sourceId, mirrorId] of snapshot.explicitXMirrorVertexPairs ?? []) {
    explicitXMirrorVertexPairs.set(sourceId, mirrorId);
  }
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

// ------------------------------------------------------------
// --- selection and transform targets
// ------------------------------------------------------------

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

// HUD へ表示する最後の直接選択 vertex を取得する
// 選択解除や Shift で選択から外れた場合は古い座標を出さない
function getLastSelectedVertex() {
  if (editor.lastSelectedVertexId === null || !editor.selectedVertices.has(editor.lastSelectedVertexId)) {
    return null;
  }
  return getVertexById(editor.lastSelectedVertexId);
}

// HUD へ収めやすい短い vertex 座標表示を作る
function getLastSelectedVertexLabel() {
  const vertex = getLastSelectedVertex();
  if (!vertex) {
    return "-";
  }
  const coords = vertex.position.map((value) => Number(value).toFixed(3)).join(", ");
  return `v${vertex.id} (${coords})`;
}

// command palette の V から、選択 vertex の座標を status/message へ表示する
// 複数選択時は先頭数件に絞り、詳細すぎる文字列で message 表示を埋めないようにする
function showSelectedVertexCoordinates() {
  if (!isEditMode()) {
    setMessage("switch to edit mode before viewing vertices");
    return;
  }
  const vertices = getActiveVertexObjects();
  if (vertices.length === 0) {
    setMessage("select vertices before viewing coordinates");
    return;
  }
  const entries = vertices.slice(0, 4).map((vertex) => {
    const p = vertex.position.map((value) => Number(value).toFixed(3)).join(",");
    return `v${vertex.id}(${p})`;
  });
  const suffix = vertices.length > entries.length ? ` ... +${vertices.length - entries.length}` : "";
  setMessage(`${entries.join(" ")}${suffix}`);
}

// Edge Slide 用に、選択 vertex ごとのスライド先 edge を決める
// 明示的な edge selection はまだ持たないため、各 vertex に接続する辺のうち画面横方向に最も近いものを使う
// 複数 vertex でも drag 量から得た同じ比率を各 edge 上へ適用する
function getEdgeSlideTargets(vertices) {
  if (!Array.isArray(vertices) || vertices.length === 0) {
    return [];
  }
  const basis = getCameraScreenBasis();
  const selectedIds = new Set(vertices.map((vertex) => vertex.id));
  const neighborIdsByVertexId = new Map();
  const addNeighbor = (a, b) => {
    if (!neighborIdsByVertexId.has(a)) {
      neighborIdsByVertexId.set(a, new Set());
    }
    neighborIdsByVertexId.get(a).add(b);
  };
  for (const face of editor.faces) {
    for (let i = 0; i < face.indices.length; i++) {
      const a = face.indices[i];
      const b = face.indices[(i + 1) % face.indices.length];
      addNeighbor(a, b);
      addNeighbor(b, a);
    }
  }
  const targets = [];
  for (const vertex of vertices) {
    const neighbors = Array.from(neighborIdsByVertexId.get(vertex.id) ?? [])
      .map((id) => getVertexById(id))
      .filter((neighbor) => neighbor !== null);
    let best = null;
    for (const neighbor of neighbors) {
      const edge = sub3(neighbor.position, vertex.position);
      const len = length3(edge);
      if (len <= 1.0e-9) {
        continue;
      }
      const dir = mul3(edge, 1.0 / len);
      const score = Math.abs(dot3(dir, basis.right));
      const selectedPenalty = selectedIds.has(neighbor.id) ? 0.1 : 0.0;
      const rank = score - selectedPenalty;
      if (!best || rank > best.rank) {
        best = {
          vertex,
          start: [...vertex.position],
          end: [...neighbor.position],
          rank
        };
      }
    }
    if (best) {
      targets.push(best);
    }
  }
  return targets;
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

// Object Mode transform が対象にする object 群を返す
function getTransformTargetObjects() {
  commitActiveObject();
  const selectedIds = editor.selectedObjectIds.size > 0
    ? editor.selectedObjectIds
    : new Set(editor.activeObjectId !== null ? [editor.activeObjectId] : []);
  return editor.objects.filter((object) => selectedIds.has(object.id));
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

// object transform はまず origin translation として扱う
// editor vertices は object local 座標で保持し、描画 / pick / export 時だけ world と変換する
function getObjectOrigin(object) {
  return readVec3(object?.origin ?? [0.0, 0.0, 0.0], `object ${object?.id ?? "-"} origin`);
}

function localToWorldPosition(object, position) {
  return add3(readVec3(position, "local position"), getObjectOrigin(object));
}

function worldToLocalPosition(object, position) {
  return sub3(readVec3(position, "world position"), getObjectOrigin(object));
}

function getObjectWorldVertices(object) {
  return (object?.vertices ?? []).map((vertex) => ({
    id: vertex.id,
    position: localToWorldPosition(object, vertex.position)
  }));
}

function makeObjectLocalRay(ray, object) {
  if (!object) {
    return ray;
  }
  const origin = getObjectOrigin(object);
  return {
    ...ray,
    origin: sub3(ray.origin, origin),
    near: ray.near ? sub3(ray.near, origin) : ray.near,
    far: ray.far ? sub3(ray.far, origin) : ray.far
  };
}

// ------------------------------------------------------------
// --- X mirror editing
// ------------------------------------------------------------

// X Mirror 用の位置許容差を model size から決める
// 読み込み model の scale が大きく違っても、同じ相対精度で対称頂点を探せるようにする
function getXMirrorTolerance() {
  return Math.max(getEditorBounds().size * 1.0e-4, 1.0e-5);
}

// X=0 平面を境にした対称位置を返す
// モデラーでの X Mirror として扱うため、X 符号だけを反転し、Y/Z は維持する
function makeXMirrorPosition(position) {
  return [-position[0], position[1], position[2]];
}

// 指定 vertex の X Mirror 対応頂点を active object 内から探す
// 同じ vertex 自身や今回の直接編集対象は除外し、対称相手を上書きして操作意図が競合しないようにする
function findXMirrorVertex(vertex, referencePosition, excludedVertexIds = new Set()) {
  if (!vertex) {
    return null;
  }
  const tolerance = getXMirrorTolerance();
  const target = makeXMirrorPosition(referencePosition);
  let best = null;
  let bestDistanceSq = Infinity;
  for (const candidate of editor.vertices) {
    if (candidate.id === vertex.id || excludedVertexIds.has(candidate.id)) {
      continue;
    }
    const dx = candidate.position[0] - target[0];
    const dy = candidate.position[1] - target[1];
    const dz = candidate.position[2] - target[2];
    if (Math.abs(dx) > tolerance || Math.abs(dy) > tolerance || Math.abs(dz) > tolerance) {
      continue;
    }
    const distanceSq = dx * dx + dy * dy + dz * dz;
    if (distanceSq < bestDistanceSq) {
      best = candidate;
      bestDistanceSq = distanceSq;
    }
  }
  return best;
}

// X Mirror が有効なとき、直接編集した vertex の結果を対称側の既存 vertex へ反映する
// 新しい vertex / face は作らないため、対称相手が存在しない場合は何も補完しない
function makeXMirrorEditPairs(sourceVertices, initialPositions = null) {
  if (!xMirrorEdit || !isEditMode() || !Array.isArray(sourceVertices) || sourceVertices.length === 0) {
    return [];
  }
  const sourceIds = new Set(sourceVertices.map((vertex) => vertex.id));
  const pairs = [];
  for (const vertex of sourceVertices) {
    const explicitMirrorId = explicitXMirrorVertexPairs.get(vertex.id);
    const explicitMirror = explicitMirrorId === undefined || sourceIds.has(explicitMirrorId)
      ? null
      : getVertexById(explicitMirrorId);
    if (explicitMirror) {
      pairs.push({
        sourceId: vertex.id,
        mirrorId: explicitMirror.id
      });
      continue;
    }
    const referencePosition = initialPositions?.get?.(vertex) ?? vertex.position;
    const mirror = findXMirrorVertex(vertex, referencePosition, sourceIds);
    if (mirror) {
      pairs.push({
        sourceId: vertex.id,
        mirrorId: mirror.id
      });
    }
  }
  return pairs;
}

// X Mirror が有効なとき、直接編集した vertex の結果を対称側の既存 vertex へ反映する
// drag preview では最初に見つけた対応関係を使い続け、移動後の mirror 位置で再探索しない
function applyXMirrorEdit(sourceVertices, initialPositions = null, mirrorPairs = null) {
  if (!xMirrorEdit || !isEditMode() || !Array.isArray(sourceVertices) || sourceVertices.length === 0) {
    return {
      updated: 0,
      missing: 0
    };
  }
  if (Array.isArray(mirrorPairs)) {
    let updated = 0;
    for (const pair of mirrorPairs) {
      const source = getVertexById(pair.sourceId);
      const mirror = getVertexById(pair.mirrorId);
      if (!source || !mirror) {
        continue;
      }
      mirror.position = makeXMirrorPosition(source.position);
      updated += 1;
    }
    return {
      updated,
      missing: sourceVertices.length - updated
    };
  }
  const sourceIds = new Set(sourceVertices.map((vertex) => vertex.id));
  let updated = 0;
  let missing = 0;
  for (const vertex of sourceVertices) {
    const referencePosition = initialPositions?.get?.(vertex) ?? vertex.position;
    const mirror = findXMirrorVertex(vertex, referencePosition, sourceIds);
    if (!mirror) {
      missing += Math.abs(referencePosition[0]) > getXMirrorTolerance() ? 1 : 0;
      continue;
    }
    mirror.position = makeXMirrorPosition(vertex.position);
    updated += 1;
  }
  return {
    updated,
    missing
  };
}

// X Mirror 表示用に、選択 vertex の反対側にある既存 vertex id を集める
// 選択済み vertex は赤表示を優先するため、mirror marker には含めない
function getXMirrorSelectedVertexIds() {
  const ids = new Set();
  if (!xMirrorEdit || !isEditMode() || editor.selectedVertices.size === 0) {
    return ids;
  }
  const selectedIds = new Set(editor.selectedVertices);
  for (const id of selectedIds) {
    const vertex = getVertexById(id);
    if (!vertex) {
      continue;
    }
    const explicitMirrorId = explicitXMirrorVertexPairs.get(vertex.id);
    if (explicitMirrorId !== undefined && !selectedIds.has(explicitMirrorId) && getVertexById(explicitMirrorId)) {
      ids.add(explicitMirrorId);
      continue;
    }
    const mirror = findXMirrorVertex(vertex, vertex.position, selectedIds);
    if (mirror && !selectedIds.has(mirror.id)) {
      ids.add(mirror.id);
    }
  }
  return ids;
}

// X Mirror 押し出し用に、選択 face と対称位置にある既存 face を探す
// X=0 上の vertex は同じ vertex を使い、片側だけにある vertex は既存の反対側 vertex を要求する
function findXMirrorFace(face, excludedFaceIds = new Set()) {
  if (!face) {
    return null;
  }
  const mirroredIds = [];
  for (const vertexId of face.indices) {
    const vertex = getVertexById(vertexId);
    if (!vertex) {
      return null;
    }
    if (Math.abs(vertex.position[0]) <= getXMirrorTolerance()) {
      mirroredIds.push(vertex.id);
      continue;
    }
    const mirror = findXMirrorVertex(vertex, vertex.position);
    if (!mirror) {
      return null;
    }
    mirroredIds.push(mirror.id);
  }
  const sourceKey = [...face.indices].sort((a, b) => a - b).join(":");
  const mirrorKey = [...mirroredIds].sort((a, b) => a - b).join(":");
  if (sourceKey === mirrorKey) {
    return null;
  }
  for (const candidate of editor.faces) {
    if (candidate.id === face.id || excludedFaceIds.has(candidate.id) || candidate.indices.length !== mirroredIds.length) {
      continue;
    }
    const candidateKey = [...candidate.indices].sort((a, b) => a - b).join(":");
    if (candidateKey === mirrorKey) {
      return {
        face: candidate,
        vertexPairs: face.indices
          .map((sourceId, index) => ({
            sourceId,
            mirrorId: mirroredIds[index]
          }))
          .filter((pair) => pair.sourceId !== pair.mirrorId)
      };
    }
  }
  return null;
}

// X Mirror が有効な押し出しでは、選択 face の反対側 face も同じ region extrude 対象へ含める
// mirror 側から派生する新規 vertex を通常選択に混ぜないよう、base vertex の対応関係も返す
function getXMirrorExtrusionFaces(faces) {
  const empty = {
    faces,
    mirrorFaceIds: new Set(),
    vertexPairs: []
  };
  if (!xMirrorEdit || !isEditMode() || !Array.isArray(faces) || faces.length === 0) {
    return empty;
  }
  const result = [...faces];
  const includedFaceIds = new Set(result.map((face) => face.id));
  const mirrorFaceIds = new Set();
  const vertexPairs = [];
  for (const face of faces) {
    const mirrorInfo = findXMirrorFace(face, includedFaceIds);
    if (!mirrorInfo) {
      continue;
    }
    result.push(mirrorInfo.face);
    includedFaceIds.add(mirrorInfo.face.id);
    mirrorFaceIds.add(mirrorInfo.face.id);
    vertexPairs.push(...mirrorInfo.vertexPairs);
  }
  return {
    faces: result,
    mirrorFaceIds,
    vertexPairs
  };
}

// 通常選択 vertex と X Mirror 対応 vertex の id pair を明示的に登録する
// 押し出しで新しく生成した mirror 側 vertex は既存位置探索では見つけにくいため、派生元から対応を引き継ぐ
function addExplicitXMirrorVertexPairs(pairs) {
  if (!Array.isArray(pairs) || pairs.length === 0) {
    return;
  }
  for (const pair of pairs) {
    if (!Number.isInteger(pair?.sourceId) || !Number.isInteger(pair?.mirrorId) || pair.sourceId === pair.mirrorId) {
      continue;
    }
    explicitXMirrorVertexPairs.set(pair.sourceId, pair.mirrorId);
    explicitXMirrorVertexPairs.set(pair.mirrorId, pair.sourceId);
  }
}

// ------------------------------------------------------------
// --- geometry topology and winding
// ------------------------------------------------------------

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

// ------------------------------------------------------------
// --- ModelAsset and scene rebuild
// ------------------------------------------------------------

// 編集データから ModelAsset を組み立てる
// faces は三角形または四角形だけを許可し、四角形は表示用 indices へ扇形分解する
function buildModelAssetFromGeometry(vertices = editor.vertices, faces = editor.faces, name = SAMPLE_NAME, origin = [0.0, 0.0, 0.0]) {
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
      generator: "samples/mmodeler",
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
          translation: readVec3(origin, `${name} origin`),
          rotation: [0.0, 0.0, 0.0, 1.0],
          scale: [1.0, 1.0, 1.0]
        }
      }
    ]
  });
}

// active object の編集データから保存用 ModelAsset を作る
function buildModelAssetFromEditor() {
  const object = getActiveObject();
  return buildModelAssetFromGeometry(
    editor.vertices,
    editor.faces,
    object?.name ?? SAMPLE_NAME,
    getObjectOrigin(object)
  );
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
  const shape = new Shape(app.getGPU());
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
  const shape = new Shape(app.getGPU());
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
    const asset = buildModelAssetFromGeometry(object.vertices, object.faces, object.name, [0.0, 0.0, 0.0]);
    const selectedObject = editor.mode === EDITOR_MODE_OBJECT
      && editor.selectedObjectIds.has(object.id);
    const shape = makeShapeFromAsset(asset, selectedObject ? MATERIAL.selectedObject : MATERIAL.mesh);
    // Wireframe 表示は Shape が保持する polygonLoops から線を作る
    // Edit Mode でも mesh 本体を wireframe 化し、選択 vertex / selected face / edge overlay は別 pass として重ねる
    // これにより奥の形状を確認しながら、既存の選択強調を維持できる
    if (objectWireframe) {
      shape.setWireframe(true);
    }
    const node = app.space.addNode(meshNode, `object-${object.id}`);
    const origin = getObjectOrigin(object);
    node.setPosition(origin[0], origin[1], origin[2]);
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
  const origin = getObjectOrigin(getActiveObject());
  selectedFaceNode.setPosition(origin[0], origin[1], origin[2]);
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

// ------------------------------------------------------------
// --- edit overlays and viewport projection
// ------------------------------------------------------------

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

function makeUndirectedEdgeKey(a, b) {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

// edge overlay の line-list 頂点を geometry から再構築する
function rebuildEdgeOverlayBuffer() {
  if (!edgeOverlay) {
    return;
  }
  edgeOverlay.clear();
  const object = getActiveObject();
  const vertexLookup = buildVertexLookup();
  for (const edge of getUniqueOverlayEdges()) {
    const va = vertexLookup.get(edge.a);
    const vb = vertexLookup.get(edge.b);
    if (!va || !vb) {
      continue;
    }
    edgeOverlay.addLine(
      localToWorldPosition(object, va.position),
      localToWorldPosition(object, vb.position),
      getOverlayEdgeColor(edge)
    );
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
  const xMirrorVertexIds = getXMirrorSelectedVertexIds();
  const object = getActiveObject();
  for (const vertex of editor.vertices) {
    const p = projectWorldToNdc(viewProjection, localToWorldPosition(object, vertex.position), getMarkerOverlayZBias());
    if (!p) {
      continue;
    }
    const markerKind = highlightedVertexIds.has(vertex.id)
      ? "selected"
      : xMirrorVertexIds.has(vertex.id)
        ? "mirror"
        : "default";
    overlay2d.addMarker(
      p[0],
      p[1],
      p[2],
      markerRadiusX,
      markerRadiusY,
      // 選択状態に応じて marker overlay の色と alpha を決める
      getOverlayMarkerColor(markerKind)
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
  const cameraKey = makeMarkerOverlayCameraKey(viewProjection, canvas);
  const rebuildMarkers = markerOverlayDirty || markerOverlayCameraKey !== cameraKey;

  if (edgeOverlay) {
    edgeOverlay.zBias = getEdgeOverlayZBias();
    edgeOverlay.setMatrices(app.projectionMatrix, view);
    if (overlayEdgeUploadDirty) {
      // edge overlay の line-list 頂点を geometry から再構築する
      rebuildEdgeOverlayBuffer();
    }
    edgeOverlay.draw();
  }

  if (rebuildMarkers) {
    // vertex marker overlay を現在 camera で再投影して buffer を作り直す
    rebuildMarkerOverlayBuffer(viewProjection, canvas, markerRadiusX, markerRadiusY);
    markerOverlayCameraKey = cameraKey;
  }
  overlay2d.draw();
}

// 床 grid とワールド軸を line-list overlay として描く
// X=赤、Y=青、Z=緑。補助線なので Shape の wireframe ではなく専用線描画を使う。
function drawGuideOverlayPass() {
  if (!guideOverlay || !app?.eye || !app?.projectionMatrix) {
    return;
  }
  app.eye.setWorldMatrix();
  const view = new Matrix();
  view.makeView(app.eye.worldMatrix);
  guideOverlay.zBias = projectionMode === PROJECTION_MODE_ORTHOGRAPHIC ? 0.0 : 0.00008;
  guideOverlay.setMatrices(app.projectionMatrix, view);
  guideOverlay.clear();
  const half = 6;
  const divisions = 12;
  const y = -0.012;
  for (let z = 0; z <= divisions; z++) {
    const p = -half + (z / divisions) * half * 2.0;
    guideOverlay.addLine([-half, y, p], [half, y, p], [0.34, 0.42, 0.48, 0.34]);
  }
  for (let x = 0; x <= divisions; x++) {
    const p = -half + (x / divisions) * half * 2.0;
    guideOverlay.addLine([p, y, -half], [p, y, half], [0.34, 0.42, 0.48, 0.34]);
  }
  guideOverlay.addLine([-half, 0.0, 0.0], [half, 0.0, 0.0], [0.94, 0.12, 0.10, 0.95]);
  guideOverlay.addLine([0.0, -half, 0.0], [0.0, half, 0.0], [0.12, 0.34, 1.0, 0.95]);
  guideOverlay.addLine([0.0, 0.0, -half], [0.0, 0.0, half], [0.10, 0.78, 0.22, 0.95]);
  if (loopCutPreview.active) {
    const face = getFaceById(loopCutPreview.faceId);
    const object = getActiveObject();
    if (face && face.indices.length === 4 && object) {
      const edgeIndex = loopCutPreview.cutEdgeIndex;
      const oppositeIndex = (edgeIndex + 2) % 4;
      const a0 = getVertexById(face.indices[edgeIndex]);
      const a1 = getVertexById(face.indices[(edgeIndex + 1) % 4]);
      const b0 = getVertexById(face.indices[oppositeIndex]);
      const b1 = getVertexById(face.indices[(oppositeIndex + 1) % 4]);
      if (a0 && a1 && b0 && b1) {
        const pa = localToWorldPosition(object, mul3(add3(a0.position, a1.position), 0.5));
        const pb = localToWorldPosition(object, mul3(add3(b0.position, b1.position), 0.5));
        guideOverlay.addLine(pa, pb, [1.0, 0.82, 0.16, 1.0]);
      }
    }
  }
  guideOverlay.draw();
}

// 旧 grid shape が残っている場合だけ取り除く。現在の grid / axis は line-list overlay で描く。
function buildGrid() {
  removeNodeTree(gridRoot);
  gridRoot = null;
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
    ? editor.objects.flatMap((object) => getObjectWorldVertices(object))
    : editor.vertices;
  return computeBoundsForVertices(vertices);
}

// active object だけの bounds を取得する
function getActiveObjectBounds() {
  // 現在の editor.vertices / faces を active object へ書き戻す
  commitActiveObject();
  const object = getActiveObject();
  return computeBoundsForVertices(object ? getObjectWorldVertices(object) : editor.vertices);
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
function getOverlayMarkerColor(kind = "default") {
  if (kind === "selected") {
    return [0.95, 0.08, 0.08, Math.max(overlayAlpha, 0.85)];
  }
  if (kind === "mirror") {
    return [0.0, 0.85, 1.0, Math.max(overlayAlpha, 0.88)];
  }
  if (objectWireframe) {
    // Wireframe 編集時は mesh の線と重なっても未選択頂点を追いやすいよう明るく表示する
    return [
      WIREFRAME_OVERLAY_MARKER_COLOR[0],
      WIREFRAME_OVERLAY_MARKER_COLOR[1],
      WIREFRAME_OVERLAY_MARKER_COLOR[2],
      Math.max(overlayAlpha, 0.92)
    ];
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
      const key = makeUndirectedEdgeKey(a, b);
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
    if (objectWireframe) {
      // Wireframe 編集時は選択 face の境界を通常の黒線より明るくし、線の重なりから見失いにくくする
      return [
        WIREFRAME_OVERLAY_SELECTED_EDGE_COLOR[0],
        WIREFRAME_OVERLAY_SELECTED_EDGE_COLOR[1],
        WIREFRAME_OVERLAY_SELECTED_EDGE_COLOR[2],
        0.98
      ];
    }
    return [0.0, 0.0, 0.0, Math.max(overlayAlpha, 0.92)];
  }
  if (objectWireframe) {
    // Wireframe 編集時は通常 edge も明るい色へ寄せ、裏側の線と頂点を確認しやすくする
    return [
      WIREFRAME_OVERLAY_EDGE_COLOR[0],
      WIREFRAME_OVERLAY_EDGE_COLOR[1],
      WIREFRAME_OVERLAY_EDGE_COLOR[2],
      Math.max(overlayAlpha, 0.9)
    ];
  }
  return [overlayEdgeColor[0], overlayEdgeColor[1], overlayEdgeColor[2], overlayAlpha];
}

// editor bounds に合わせて orbit camera の target と距離を調整する
function fitCameraToEditor() {
  const bounds = getEditorBounds();
  const distance = Math.max(4.0, bounds.size * 2.8);
  orbit.setTarget(bounds.center[0], bounds.center[1], bounds.center[2]);
  orbit.orbit.minDistance = Math.max(MIN_CAMERA_DISTANCE, bounds.size * FIT_MIN_DISTANCE_RATIO);
  orbit.orbit.maxDistance = Math.max(32.0, bounds.size * 12.0);
  orbit.orbit.wheelZoomStep = Math.max(MIN_WHEEL_ZOOM_STEP, bounds.size * FIT_WHEEL_ZOOM_RATIO);
  orbit.orbit.keyZoomSpeed = Math.max(MIN_KEY_ZOOM_SPEED, bounds.size * FIT_KEY_ZOOM_RATIO);
  orbit.setAngles(DEFAULT_CAMERA.yaw, DEFAULT_CAMERA.pitch, 0.0);
  orbit.setDistance(distance);
  app.syncCameraFromEyeRig(orbit);
}

// Blender のテンキー操作に近い固定 view へ orbit camera を切り替える
// target と distance は維持し、視線方向だけを X/Y/Z 軸方向へそろえる
function setOrbitViewPreset(key, reversed = false) {
  const preset = ORBIT_VIEW_PRESETS[key]?.[reversed ? "reverse" : "forward"] ?? null;
  if (!preset) {
    return false;
  }
  // transform 中に視点を切り替えると、mouse preview の screen basis と実 view がずれるため先に確定 / cancel させる
  if (transformController?.state?.active) {
    setMessage("confirm or cancel transform before changing view");
    return true;
  }
  orbit.setAngles(preset.yaw, preset.pitch, 0.0);
  // box select などで orbit が一時停止していても、view preset は即座に camera node へ反映する
  orbit.apply?.(true);
  app.syncCameraFromEyeRig(orbit);
  markerOverlayDirty = true;
  // 最後のユーザー向け message を保存し status を更新する
  setMessage(`view ${preset.label}`);
  return true;
}

// ------------------------------------------------------------
// --- objects, modes, and edit commands
// ------------------------------------------------------------

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
  editor.objects = objects.map((object) => ({
    ...object,
    origin: readVec3(object.origin ?? [0.0, 0.0, 0.0], `object ${object.id} origin`)
  }));
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
    origin: [0.0, 0.0, 0.0],
    vertices: editor.vertices,
    faces: editor.faces,
    nextVertexId: editor.nextVertexId,
    nextFaceId: editor.nextFaceId
  }];
  editor.nextObjectId = id + 1;
  editor.activeObjectId = id;
  editor.selectedObjectIds = new Set([id]);
}

// primitive 追加で使う頂点配列と face 配列を作る
// 既存 object を置き換えず、1 primitive を 1 object として scene へ足すための local geometry を返す
function readMobilePrimitiveSegments() {
  const segments = Number(mobileUiState.primitiveSegments);
  if (![3, 4, 8, 12, 16, 24, 32].includes(segments)) {
    throw new Error(`invalid mobile primitive segment count: ${segments}`);
  }
  return segments;
}

function makePrimitiveGeometry(kind) {
  const normalized = String(kind ?? "").trim().toLowerCase();
  const segments = readMobilePrimitiveSegments();
  if (normalized === "cube") {
    return {
      name: "Cube",
      vertices: [
        [-1.0, 0.0, -1.0],
        [1.0, 0.0, -1.0],
        [1.0, 0.0, 1.0],
        [-1.0, 0.0, 1.0],
        [-1.0, 2.0, -1.0],
        [1.0, 2.0, -1.0],
        [1.0, 2.0, 1.0],
        [-1.0, 2.0, 1.0]
      ],
      faces: [
        [1, 2, 3, 4],
        [5, 6, 7, 8],
        [1, 2, 6, 5],
        [2, 3, 7, 6],
        [3, 4, 8, 7],
        [4, 1, 5, 8]
      ]
    };
  }
  if (normalized === "plane") {
    return {
      name: "Plane",
      vertices: [
        [-1.0, 0.0, -1.0],
        [1.0, 0.0, -1.0],
        [1.0, 0.0, 1.0],
        [-1.0, 0.0, 1.0]
      ],
      faces: [[1, 2, 3, 4]]
    };
  }
  if (normalized === "sphere") {
    const vertices = [[0.0, 2.0, 0.0]];
    const faces = [];
    const longitudeSegments = segments;
    const latitudeSegments = Math.max(3, Math.floor(segments / 2));
    const ringVertexId = (lat, lon) => 2 + (lat - 1) * longitudeSegments + (lon % longitudeSegments);
    for (let lat = 1; lat < latitudeSegments; lat++) {
      const theta = Math.PI * lat / latitudeSegments;
      const y = 1.0 + Math.cos(theta);
      const ringRadius = Math.sin(theta);
      for (let lon = 0; lon < longitudeSegments; lon++) {
        const phi = 2.0 * Math.PI * lon / longitudeSegments;
        vertices.push([
          Math.cos(phi) * ringRadius,
          y,
          Math.sin(phi) * ringRadius
        ]);
      }
    }
    const bottomId = vertices.length + 1;
    vertices.push([0.0, 0.0, 0.0]);
    for (let lon = 0; lon < longitudeSegments; lon++) {
      const nextLon = (lon + 1) % longitudeSegments;
      faces.push([1, ringVertexId(1, nextLon), ringVertexId(1, lon)]);
    }
    for (let lat = 1; lat < latitudeSegments - 1; lat++) {
      for (let lon = 0; lon < longitudeSegments; lon++) {
        const nextLon = (lon + 1) % longitudeSegments;
        faces.push([
          ringVertexId(lat, lon),
          ringVertexId(lat, nextLon),
          ringVertexId(lat + 1, nextLon),
          ringVertexId(lat + 1, lon)
        ]);
      }
    }
    for (let lon = 0; lon < longitudeSegments; lon++) {
      const nextLon = (lon + 1) % longitudeSegments;
      faces.push([ringVertexId(latitudeSegments - 1, lon), ringVertexId(latitudeSegments - 1, nextLon), bottomId]);
    }
    return { name: "Sphere", vertices, faces };
  }
  if (normalized === "torus") {
    const vertices = [];
    const faces = [];
    const ringSegments = segments;
    const tubeSegments = Math.max(3, Math.floor(segments / 2));
    const majorRadius = 0.78;
    const tubeRadius = 0.28;
    const vertexId = (ring, tube) => (ring % ringSegments) * tubeSegments + (tube % tubeSegments) + 1;
    for (let ring = 0; ring < ringSegments; ring++) {
      const ringAngle = 2.0 * Math.PI * ring / ringSegments;
      for (let tube = 0; tube < tubeSegments; tube++) {
        const tubeAngle = 2.0 * Math.PI * tube / tubeSegments;
        const radius = majorRadius + Math.cos(tubeAngle) * tubeRadius;
        vertices.push([
          Math.cos(ringAngle) * radius,
          1.0 + Math.sin(tubeAngle) * tubeRadius,
          Math.sin(ringAngle) * radius
        ]);
      }
    }
    for (let ring = 0; ring < ringSegments; ring++) {
      for (let tube = 0; tube < tubeSegments; tube++) {
        faces.push([
          vertexId(ring, tube),
          vertexId(ring + 1, tube),
          vertexId(ring + 1, tube + 1),
          vertexId(ring, tube + 1)
        ]);
      }
    }
    return { name: "Torus", vertices, faces };
  }
  if (normalized === "cylinder" || normalized === "cone" || normalized === "double-cone") {
    const vertices = [];
    const faces = [];
    const bottomCenterId = 1;
    const topCenterId = 2;
    vertices.push([0.0, 0.0, 0.0]);
    vertices.push([0.0, 2.0, 0.0]);
    for (let i = 0; i < segments; i++) {
      const angle = 2.0 * Math.PI * i / segments;
      vertices.push([Math.cos(angle), 0.0, Math.sin(angle)]);
    }
    if (normalized === "cylinder") {
      for (let i = 0; i < segments; i++) {
        const angle = 2.0 * Math.PI * i / segments;
        vertices.push([Math.cos(angle), 2.0, Math.sin(angle)]);
      }
    } else if (normalized === "double-cone") {
      vertices[0] = [0.0, 0.0, 0.0];
      vertices[1] = [0.0, 2.0, 0.0];
      for (let i = 0; i < segments; i++) {
        const angle = 2.0 * Math.PI * i / segments;
        vertices[i + 2] = [Math.cos(angle), 1.0, Math.sin(angle)];
      }
    }
    for (let i = 0; i < segments; i++) {
      const next = (i + 1) % segments;
      const bottomA = 3 + i;
      const bottomB = 3 + next;
      if (normalized === "cone") {
        faces.push([bottomCenterId, bottomB, bottomA]);
        faces.push([bottomA, bottomB, topCenterId]);
      } else if (normalized === "double-cone") {
        faces.push([bottomCenterId, bottomB, bottomA]);
        faces.push([bottomA, bottomB, topCenterId]);
      } else {
        const topA = 3 + segments + i;
        const topB = 3 + segments + next;
        faces.push([bottomCenterId, bottomB, bottomA]);
        faces.push([bottomA, bottomB, topB, topA]);
        faces.push([topCenterId, topA, topB]);
      }
    }
    return {
      name: normalized === "cone"
        ? "Cone"
        : normalized === "double-cone"
          ? "DoubleCone"
          : "Cylinder",
      vertices,
      faces
    };
  }
  throw new Error(`unknown primitive kind: ${kind}`);
}

// primitive geometry を新しい object として scene に追加する
// New Scene や import と違い、既存 object は残したまま active object だけ新規 primitive へ切り替える
function addPrimitiveObject(kind) {
  const geometry = makePrimitiveGeometry(kind);
  // 現在状態を undo stack へ積み、redo stack を破棄する
  pushUndo(`add ${geometry.name}`);
  // 現在の editor.vertices / faces を active object へ書き戻す
  commitActiveObject();
  const objectId = editor.nextObjectId++;
  const vertices = geometry.vertices.map((position, index) => ({
    id: index + 1,
    position: readVec3(position, `${geometry.name} vertex ${index + 1}`)
  }));
  const faces = geometry.faces.map((indices, index) => ({
    id: index + 1,
    indices: [...indices]
  }));
  const object = {
    id: objectId,
    name: geometry.name,
    origin: [0.0, 0.0, 0.0],
    vertices,
    faces,
    nextVertexId: vertices.length + 1,
    nextFaceId: faces.length + 1
  };
  editor.objects.push(object);
  editor.mode = EDITOR_MODE_OBJECT;
  editor.selectedObjectIds = new Set([objectId]);
  // 指定 object を active にし、編集配列をその object へ接続する
  activateObject(objectId);
  // 全 face の winding を connected component ごとにできるだけ一貫させる
  orientAllFacesConsistently();
  // 現在の editor.vertices / faces を active object へ書き戻す
  commitActiveObject();
  // mesh / selected face / marker の表示をまとめて再構築する
  rebuildScene();
  // 最後のユーザー向け message を保存し status を更新する
  setMessage(`added ${geometry.name}`);
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
  editor.lastSelectedVertexId = null;
  explicitXMirrorVertexPairs.clear();
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
  editor.lastSelectedVertexId = null;
}

// 選択 face の構成 vertex を selectedVertices へ同期する
function syncSelectedVerticesFromSelectedFaces() {
  editor.selectedVertices.clear();
  for (const face of getSelectedFaceObjects()) {
    for (const id of face.indices) {
      editor.selectedVertices.add(id);
    }
  }
  if (editor.lastSelectedVertexId !== null && !editor.selectedVertices.has(editor.lastSelectedVertexId)) {
    editor.lastSelectedVertexId = null;
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

// selectedVertices の中で最後に並ぶ vertex id を取り直す
// Array.prototype.findLast() に依存せず、mobile Safari の差異を避けるため後ろから明示的に走査する
function getLastSelectedVertexIdFromGeometry() {
  for (let i = editor.vertices.length - 1; i >= 0; i--) {
    const id = editor.vertices[i].id;
    if (editor.selectedVertices.has(id)) {
      return id;
    }
  }
  return null;
}

// vertex を選択または Shift 追加選択で切り替える
function selectVertex(id, additive = false) {
  if (!additive) {
    // edit selection の vertex / face を空にする
    clearSelection();
  }
  if (editor.selectedVertices.has(id) && additive) {
    editor.selectedVertices.delete(id);
    if (editor.lastSelectedVertexId === id) {
      editor.lastSelectedVertexId = null;
    }
  } else {
    editor.selectedVertices.add(id);
    editor.lastSelectedVertexId = id;
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
  editor.lastSelectedVertexId = editor.vertices.length > 0
    ? editor.vertices[editor.vertices.length - 1].id
    : null;
  // 全頂点が選択された face を selectedFaces へ同期する
  syncSelectedFacesFromSelectedVertices();
  // mesh / selected face / marker の表示をまとめて再構築する
  rebuildScene();
  // 最後のユーザー向け message を保存し status を更新する
  setMessage(`selected all vertices (${editor.selectedVertices.size})`);
}

// 現在 mode / tool の単位で選択状態を反転する
// vertex tool では vertex、face tool では face、Object Mode では object を対象にして混在選択を避ける
function invertSelectionForCurrentMode() {
  cancelTransformMode();
  cancelLoopCutPreview();
  if (editor.mode === EDITOR_MODE_OBJECT) {
    commitActiveObject();
    const next = new Set();
    for (const object of editor.objects) {
      if (!editor.selectedObjectIds.has(object.id)) {
        next.add(object.id);
      }
    }
    editor.selectedObjectIds = next;
    rebuildScene();
    setMessage(`inverted objects (${editor.selectedObjectIds.size})`);
    return;
  }
  if (editor.tool === TOOL_SELECT_FACE) {
    const next = new Set();
    for (const face of editor.faces) {
      if (!editor.selectedFaces.has(face.id)) {
        next.add(face.id);
      }
    }
    editor.selectedFaces = next;
    syncSelectedVerticesFromSelectedFaces();
    rebuildScene();
    setMessage(`inverted faces (${editor.selectedFaces.size})`);
    return;
  }
  const next = new Set();
  for (const vertex of editor.vertices) {
    if (!editor.selectedVertices.has(vertex.id)) {
      next.add(vertex.id);
    }
  }
  editor.selectedVertices = next;
  editor.lastSelectedVertexId = getLastSelectedVertexIdFromGeometry();
  syncSelectedFacesFromSelectedVertices();
  rebuildScene();
  setMessage(`inverted vertices (${editor.selectedVertices.size})`);
}

// X<0 側の要素を現在 mode / tool に合わせて選択する
// X mirror 編集で左側だけをまとめて選びたい場面を想定し、自動補正せず X 座標の符号だけで判定する
function selectXNegativeForCurrentMode() {
  cancelTransformMode();
  cancelLoopCutPreview();
  if (editor.mode === EDITOR_MODE_OBJECT) {
    commitActiveObject();
    editor.selectedObjectIds = new Set(
      editor.objects
        .filter((object) => getObjectOrigin(object)[0] < 0.0)
        .map((object) => object.id)
    );
    rebuildScene();
    setMessage(`selected X<0 objects (${editor.selectedObjectIds.size})`);
    return;
  }
  if (editor.tool === TOOL_SELECT_FACE) {
    editor.selectedFaces = new Set(
      editor.faces
        .filter((face) => (getFaceCenterFromVertices(face, editor.vertices)?.[0] ?? Infinity) < 0.0)
        .map((face) => face.id)
    );
    syncSelectedVerticesFromSelectedFaces();
    rebuildScene();
    setMessage(`selected X<0 faces (${editor.selectedFaces.size})`);
    return;
  }
  editor.selectedVertices = new Set(
    editor.vertices
      .filter((vertex) => vertex.position[0] < 0.0)
      .map((vertex) => vertex.id)
  );
  editor.lastSelectedVertexId = getLastSelectedVertexIdFromGeometry();
  syncSelectedFacesFromSelectedVertices();
  rebuildScene();
  setMessage(`selected X<0 vertices (${editor.selectedVertices.size})`);
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

// Object Mode で選択中の複数 object を 1 object へ統合する
// 各 object の local 頂点を world 座標へ変換してから、origin が world 原点の新しい object へ詰め直す
function joinSelectedObjects() {
  if (editor.mode !== EDITOR_MODE_OBJECT) {
    setMessage("switch to object mode before joining objects");
    return;
  }
  if (editor.selectedObjectIds.size < 2) {
    setMessage("select at least 2 objects to join");
    return;
  }
  const selectedIds = new Set(editor.selectedObjectIds);
  const selectedObjects = editor.objects.filter((object) => selectedIds.has(object.id));
  if (selectedObjects.length < 2) {
    setMessage("select at least 2 objects to join");
    return;
  }
  // 現在状態を undo stack へ積み、redo stack を破棄する
  pushUndo("join objects");
  // 現在の editor.vertices / faces を active object へ書き戻す
  commitActiveObject();
  const vertices = [];
  const faces = [];
  let nextVertexId = 1;
  let nextFaceId = 1;
  for (const object of selectedObjects) {
    const idMap = new Map();
    for (const vertex of object.vertices) {
      const id = nextVertexId++;
      idMap.set(vertex.id, id);
      vertices.push({
        id,
        position: localToWorldPosition(object, vertex.position)
      });
    }
    for (const face of object.faces) {
      const indices = face.indices.map((vertexId) => {
        const mappedId = idMap.get(vertexId);
        if (!mappedId) {
          throw new Error(`join objects missing vertex ${vertexId} in object ${object.id}`);
        }
        return mappedId;
      });
      faces.push({
        id: nextFaceId++,
        indices
      });
    }
  }
  const joinedId = editor.nextObjectId++;
  const joinedObject = {
    id: joinedId,
    name: "Joined",
    origin: [0.0, 0.0, 0.0],
    vertices,
    faces,
    nextVertexId,
    nextFaceId
  };
  editor.objects = [
    ...editor.objects.filter((object) => !selectedIds.has(object.id)),
    joinedObject
  ];
  editor.nextObjectId = Math.max(...editor.objects.map((object) => object.id)) + 1;
  editor.selectedObjectIds = new Set([joinedId]);
  editor.activeObjectId = null;
  editor.vertices = [];
  editor.faces = [];
  editor.nextVertexId = 1;
  editor.nextFaceId = 1;
  // 指定 object を active にし、編集配列をその object へ接続する
  activateObject(joinedId);
  // mesh / selected face / marker の表示をまとめて再構築する
  rebuildScene();
  // 最後のユーザー向け message を保存し status を更新する
  setMessage(`joined ${selectedObjects.length} objects`);
}

// 選択 object 群の local 原点をワールド原点へ移動する
// 頂点は object local のまま保持し、object transform の origin だけを変更する
function moveSelectedObjectsToWorldOrigin() {
  commitActiveObject();
  const selectedIds = editor.selectedObjectIds.size > 0
    ? new Set(editor.selectedObjectIds)
    : new Set(editor.activeObjectId !== null ? [editor.activeObjectId] : []);
  const objects = editor.objects.filter((object) => selectedIds.has(object.id));
  if (objects.length === 0) {
    setMessage("select object before origin reset");
    return;
  }
  if (objects.every((object) => length3(getObjectOrigin(object)) <= 1.0e-9)) {
    setMessage("object origin already at world origin");
    return;
  }
  pushUndo("move object to world origin");
  for (const object of objects) {
    object.origin = [0.0, 0.0, 0.0];
  }
  const active = getActiveObject();
  if (active) {
    editor.vertices = active.vertices;
    editor.faces = active.faces;
    editor.nextVertexId = active.nextVertexId;
    editor.nextFaceId = active.nextFaceId;
  }
  rebuildScene();
  setMessage(`moved ${objects.length} object(s) to world origin`);
}

// mesh 本体を Wireframe shader に切り替える
// Edit Mode でも object 全体の面ループを Shape.setWireframe() で表示し、edge overlay や選択 marker と併用する
function toggleObjectWireframe() {
  objectWireframe = !objectWireframe;
  // mesh / selected face / marker の表示をまとめて再構築する
  rebuildScene();
  // 最後のユーザー向け message を保存し status を更新する
  setMessage(`wireframe ${objectWireframe ? "on" : "off"}`);
}

// viewport の clear color を暗色 / 明るいグレーで切り替える
// app.clearColor と Screen 側の実際の clear color を同時に更新し、次 frame から背景へ反映する
function applyBackgroundColor() {
  const color = lightBackground ? BACKGROUND_LIGHT_COLOR : BACKGROUND_DARK_COLOR;
  if (app) {
    app.clearColor = [...color];
    app.screen?.setClearColor?.(app.clearColor);
  }
}

function toggleLightBackground() {
  lightBackground = !lightBackground;
  applyBackgroundColor();
  // 最後のユーザー向け message を保存し status を更新する
  setMessage(`background ${lightBackground ? "light gray" : "dark"}`);
}

// Edit Mode のクリック / 矩形選択で、手前から見える要素だけを選ぶか切り替える
function toggleVisiblePickOnly() {
  visiblePickOnly = !visiblePickOnly;
  // 最後のユーザー向け message を保存し status を更新する
  setMessage(`visible pick ${visiblePickOnly ? "only" : "through"}`);
}

// X=0 平面を境にした対称編集を切り替える
// 既存の対称頂点へ位置を反映するだけで、新しい頂点や face は自動生成しない
function toggleXMirrorEdit() {
  xMirrorEdit = !xMirrorEdit;
  markerOverlayDirty = true;
  // 最後のユーザー向け message を保存し status を更新する
  setMessage(`X mirror edit ${xMirrorEdit ? "on" : "off"}`);
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

// loop cut の方向選択 preview を終了する
// 確定時だけでなく、選択変更や Esc でも表示を消せるよう状態を 1 箇所で戻す
function cancelLoopCutPreview(message = "") {
  if (!loopCutPreview.active) {
    return false;
  }
  loopCutPreview.active = false;
  loopCutPreview.faceId = null;
  loopCutPreview.cutEdgeIndex = 0;
  if (message) {
    setMessage(message);
  }
  return true;
}

// 単独 face の loop cut は、pointer に近い辺で方向が変わる preview 操作として扱う
// 2 枚以上の face が選ばれている場合は共有辺から方向を推定できるため即実行する
function loopCutSelectedFaces() {
  const faces = getSelectedFaceObjects();
  if (faces.length === 1 && faces[0].indices.length === 4) {
    loopCutPreview.active = true;
    loopCutPreview.faceId = faces[0].id;
    setMessage("loop cut preview: move pointer near an edge, tap to confirm");
    return;
  }
  cancelLoopCutPreview();
  editOperations.loopCutSelectedFaces();
}

// preview 中の pointer 位置から、選択 face のどの辺が最も近いかを求める
// 画面上の距離で選ぶことで、透視投影や正射影の違いを気にせず直感的に切り替えられる
function updateLoopCutPreviewFromPointer(clientX, clientY) {
  if (!loopCutPreview.active) {
    return false;
  }
  const face = getFaceById(loopCutPreview.faceId);
  const object = getActiveObject();
  const viewProjection = getCurrentViewProjectionMatrix();
  if (!face || face.indices.length !== 4 || !object || !viewProjection) {
    cancelLoopCutPreview("loop cut preview canceled");
    return false;
  }
  let best = null;
  for (let i = 0; i < 4; i++) {
    const a = getVertexById(face.indices[i]);
    const b = getVertexById(face.indices[(i + 1) % 4]);
    if (!a || !b) {
      continue;
    }
    const pa = projectWorldToClient(viewProjection, localToWorldPosition(object, a.position));
    const pb = projectWorldToClient(viewProjection, localToWorldPosition(object, b.position));
    if (!pa || !pb) {
      continue;
    }
    const dx = pb.x - pa.x;
    const dy = pb.y - pa.y;
    const denom = dx * dx + dy * dy;
    const t = denom > 1.0e-9
      ? Math.max(0.0, Math.min(1.0, ((clientX - pa.x) * dx + (clientY - pa.y) * dy) / denom))
      : 0.0;
    const cx = pa.x + dx * t;
    const cy = pa.y + dy * t;
    const dist2 = (clientX - cx) * (clientX - cx) + (clientY - cy) * (clientY - cy);
    if (!best || dist2 < best.dist2) {
      best = { edgeIndex: i, dist2 };
    }
  }
  if (!best) {
    return false;
  }
  loopCutPreview.cutEdgeIndex = best.edgeIndex;
  loopCutPreview.lastClientX = clientX;
  loopCutPreview.lastClientY = clientY;
  return true;
}

// preview で選ばれている辺を使って loop cut を確定する
// 確定時は通常の edit operation と同じ undo / rebuild / message の流れへ渡す
function confirmLoopCutPreview() {
  if (!loopCutPreview.active) {
    return false;
  }
  const cutEdgeIndex = loopCutPreview.cutEdgeIndex;
  cancelLoopCutPreview();
  editOperations.loopCutSelectedFaces({ cutEdgeIndex });
  return true;
}

// ------------------------------------------------------------
// --- picking and rectangle selection
// ------------------------------------------------------------

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
  if (projectionMode === PROJECTION_MODE_ORTHOGRAPHIC) {
    return {
      origin: near,
      dir: sub3(far, near),
      near,
      far,
      ndc: [nx, ny],
      client: { x: clientX, y: clientY },
      projectionMode
    };
  }
  const eyePos = app.eye.getWorldPosition();
  return {
    origin: eyePos,
    dir: sub3(far, eyePos),
    near,
    far,
    ndc: [nx, ny],
    client: { x: clientX, y: clientY },
    projectionMode
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

// face の法線を任意の vertex 配列から計算する
// active object 以外も object 選択で扱うため、editor.vertices 固定の computeFaceNormal() とは分ける
function computeFaceNormalFromVertices(face, vertices) {
  if (!face || face.indices.length < 3) {
    return null;
  }
  const v0 = getVertexByIdFromList(vertices, face.indices[0]);
  const v1 = getVertexByIdFromList(vertices, face.indices[1]);
  const v2 = getVertexByIdFromList(vertices, face.indices[2]);
  if (!v0 || !v1 || !v2) {
    throw new Error(`face ${face?.id ?? "-"} contains missing vertex for normal`);
  }
  const normal = cross3(
    sub3(v1.position, v0.position),
    sub3(v2.position, v0.position)
  );
  const len = length3(normal);
  if (!Number.isFinite(len) || len <= 1.0e-8) {
    return null;
  }
  return [normal[0] / len, normal[1] / len, normal[2] / len];
}

// ray から見て face の表側がこちらを向いているか判定する
// WebGPU の frontFace と同じく、編集データの頂点順から得た法線を表側として扱う
function isFaceFrontFacingRay(face, vertices, ray) {
  const normal = computeFaceNormalFromVertices(face, vertices);
  if (!normal) {
    return false;
  }
  return dot3(normal, ray.dir) < -1.0e-8;
}

// 指定 object 内で ray に最も近く当たる face を探す
function pickFaceInObject(ray, object, options = {}) {
  const localRay = makeObjectLocalRay(ray, object);
  const visibleOnly = options.visibleOnly === true;
  const ignoreFaceId = options.ignoreFaceId ?? null;
  const ignoreVertexId = options.ignoreVertexId ?? null;
  const faces = Array.isArray(options.faces) ? options.faces : object.faces;
  let best = null;
  for (const face of faces) {
    if (face.id === ignoreFaceId || (ignoreVertexId !== null && face.indices.includes(ignoreVertexId))) {
      continue;
    }
    if (visibleOnly && !isFaceFrontFacingRay(face, object.vertices, localRay)) {
      continue;
    }
    const verts = face.indices.map((id) => getVertexByIdFromList(object.vertices, id));
    if (verts.some((vertex) => vertex === null)) {
      throw new Error(`object ${object.id} face ${face.id} contains missing vertex`);
    }
    const triangles = face.indices.length === 3
      ? [[0, 1, 2]]
      : [[0, 1, 2], [0, 2, 3]];
    for (const tri of triangles) {
      const hit = intersectRayTriangle(
        localRay,
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
function pickFace(ray, options = {}) {
  const object = getActiveObject();
  if (!object) {
    return null;
  }
  return pickFaceInObject(ray, object, options);
}

// face tool のクリック選択で使う face hit を取得する
// visible pick が有効なときはまず手前向きの候補を優先するが、
// mobile / PC mouse の編集確認では face winding や視点条件の影響で
// visible 判定だけに失敗すると操作そのものが詰まるため、
// visible 候補が見つからない場合だけ同じ ray で通常 hit を確認する
function pickSelectableFace(ray) {
  const visibleHit = pickFace(ray, {
    visibleOnly: visiblePickOnly
  });
  if (visibleHit || !visiblePickOnly) {
    return visibleHit;
  }
  return pickFace(ray, {
    visibleOnly: false
  });
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

// world point が ray 上でどの距離にあるかを求める
// occlusion 判定では、手前の face hit と候補点の ray 方向距離を比較する
function getPointRayDistance(ray, point) {
  const denom = dot3(ray.dir, ray.dir);
  if (!Number.isFinite(denom) || denom <= 0.0) {
    throw new Error(`point visibility requires non-zero ray direction: ${denom}`);
  }
  const t = dot3(sub3(point, ray.origin), ray.dir) / denom;
  if (!Number.isFinite(t)) {
    throw new Error(`point visibility produced invalid ray distance: ${t}`);
  }
  return t;
}

// 候補点より手前に active object の面があるか調べる
// ignoreFaceId / ignoreVertexId は、候補自身を構成する面で自己遮蔽しないための除外指定
function isPointOccludedByActiveObject(point, ray, options = {}) {
  const object = getActiveObject();
  if (!object || object.faces.length === 0) {
    return false;
  }
  const localRay = makeObjectLocalRay(ray, object);
  const candidateFaces = Array.isArray(options.faces) ? options.faces : null;
  if (candidateFaces && candidateFaces.length === 0) {
    return false;
  }
  const hit = pickFaceInObject(ray, object, {
    ignoreFaceId: options.ignoreFaceId ?? null,
    ignoreVertexId: options.ignoreVertexId ?? null,
    faces: candidateFaces
  });
  if (!hit) {
    return false;
  }
  const pointT = getPointRayDistance(localRay, point);
  const rayLength = length3(localRay.dir);
  if (!Number.isFinite(rayLength) || rayLength <= 0.0) {
    throw new Error(`point occlusion requires positive ray length: ${rayLength}`);
  }
  const tolerance = Math.max(getActiveObjectBounds().size * 1.0e-4, 1.0e-5) / rayLength;
  return hit.t < pointT - tolerance;
}

// face の投影 bbox を grid 化し、候補点の近くにある face だけを遮蔽判定へ渡す
// Visible Pick の矩形選択では候補頂点ごとに全 face を raycast すると重くなるため、screen-space で粗く絞る
function makeVisibleOcclusionGrid(viewProjection) {
  if (!viewProjection) {
    return null;
  }
  const rect = app.screen.canvas.getBoundingClientRect();
  const cols = VISIBLE_PICK_GRID_COLS;
  const rows = VISIBLE_PICK_GRID_ROWS;
  const cells = Array.from({ length: cols * rows }, () => []);
  const pad = VISIBLE_PICK_GRID_PADDING_PX;
  const object = getActiveObject();
  let faceCount = 0;
  const addFaceToCells = (face, bounds) => {
    const left = Math.max(rect.left, bounds.left - pad);
    const right = Math.min(rect.right, bounds.right + pad);
    const top = Math.max(rect.top, bounds.top - pad);
    const bottom = Math.min(rect.bottom, bounds.bottom + pad);
    if (right < rect.left || left > rect.right || bottom < rect.top || top > rect.bottom) {
      return;
    }
    const col0 = Math.max(0, Math.min(cols - 1, Math.floor(((left - rect.left) / rect.width) * cols)));
    const col1 = Math.max(0, Math.min(cols - 1, Math.floor(((right - rect.left) / rect.width) * cols)));
    const row0 = Math.max(0, Math.min(rows - 1, Math.floor(((top - rect.top) / rect.height) * rows)));
    const row1 = Math.max(0, Math.min(rows - 1, Math.floor(((bottom - rect.top) / rect.height) * rows)));
    for (let row = row0; row <= row1; row++) {
      for (let col = col0; col <= col1; col++) {
        cells[row * cols + col].push(face);
      }
    }
  };
  for (const face of editor.faces) {
    faceCount += 1;
    const projected = face.indices
      .map((id) => getVertexById(id))
      .filter((vertex) => vertex !== null)
      .map((vertex) => projectWorldToClient(viewProjection, localToWorldPosition(object, vertex.position)))
      .filter((point) => point !== null);
    if (projected.length === 0) {
      addFaceToCells(face, {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom
      });
      continue;
    }
    if (projected.length !== face.indices.length) {
      addFaceToCells(face, {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom
      });
      continue;
    }
    const bounds = projected.reduce((acc, point) => ({
      left: Math.min(acc.left, point.x),
      right: Math.max(acc.right, point.x),
      top: Math.min(acc.top, point.y),
      bottom: Math.max(acc.bottom, point.y)
    }), {
      left: Infinity,
      right: -Infinity,
      top: Infinity,
      bottom: -Infinity
    });
    addFaceToCells(face, bounds);
  }
  let filledCellCount = 0;
  let totalCellFaces = 0;
  let maxFacesPerCell = 0;
  for (const cell of cells) {
    if (cell.length === 0) {
      continue;
    }
    filledCellCount += 1;
    totalCellFaces += cell.length;
    maxFacesPerCell = Math.max(maxFacesPerCell, cell.length);
  }
  return {
    rect,
    cols,
    rows,
    cells,
    faceCount,
    filledCellCount,
    avgFacesPerFilledCell: filledCellCount > 0 ? totalCellFaces / filledCellCount : 0.0,
    maxFacesPerCell
  };
}

// 候補点の screen cell に入っている face だけを返す
// grid がない場合は null を返し、従来どおり全 face 判定へ戻す
function getVisibleOcclusionFaces(clientPoint, context = null) {
  const grid = context?.occlusionGrid ?? null;
  if (!grid || !clientPoint) {
    return null;
  }
  const { rect, cols, rows, cells } = grid;
  if (clientPoint.x < rect.left || clientPoint.x > rect.right || clientPoint.y < rect.top || clientPoint.y > rect.bottom) {
    return [];
  }
  const col = Math.max(0, Math.min(cols - 1, Math.floor(((clientPoint.x - rect.left) / rect.width) * cols)));
  const row = Math.max(0, Math.min(rows - 1, Math.floor(((clientPoint.y - rect.top) / rect.height) * rows)));
  return cells[row * cols + col];
}

// 1 回の選択処理内で使い回す可視性判定用の情報を作る
// vertex ごとに隣接 face を毎回全探索すると多頂点 model で重くなるため、先に表へまとめる
function makeVisiblePickContext(viewProjection = null) {
  const adjacentFacesByVertexId = new Map();
  for (const face of editor.faces) {
    for (const vertexId of face.indices) {
      let faces = adjacentFacesByVertexId.get(vertexId);
      if (!faces) {
        faces = [];
        adjacentFacesByVertexId.set(vertexId, faces);
      }
      faces.push(face);
    }
  }
  return {
    adjacentFacesByVertexId,
    occlusionGrid: makeVisibleOcclusionGrid(viewProjection)
  };
}

// vertex が現在視点から選択可能な表側に属しているか判定する
// 孤立頂点は所属 face がないため、手前の面に隠れていなければ選択可能とする
function isVertexFrontFacingRay(vertex, ray, context = null) {
  const adjacentFaces = context?.adjacentFacesByVertexId?.get(vertex.id)
    ?? editor.faces.filter((face) => face.indices.includes(vertex.id));
  if (adjacentFaces.length === 0) {
    return true;
  }
  return adjacentFaces.some((face) => isFaceFrontFacingRay(face, editor.vertices, ray));
}

// Visible Pick が有効なとき、裏側または面の奥に隠れた vertex を選択候補から外す
function isVertexSelectableFromView(vertex, ray, context = null) {
  if (!visiblePickOnly) {
    return true;
  }
  if (objectWireframe) {
    // Wireframe 表示では裏側の edge / vertex も編集対象として見えている
    // 表向き face / occlusion の制限を残すと、見えている頂点を選べない状態になるため vertex pick は通す
    return true;
  }
  const localRay = makeObjectLocalRay(ray, getActiveObject());
  if (!isVertexFrontFacingRay(vertex, localRay, context)) {
    return false;
  }
  const candidateFaces = getVisibleOcclusionFaces(ray.client, context);
  return !isPointOccludedByActiveObject(vertex.position, ray, {
    ignoreVertexId: vertex.id,
    faces: candidateFaces
  });
}

// Visible Pick が有効なとき、裏向きまたは手前の面に隠れた face center を選択候補から外す
function isFaceSelectableFromView(face, ray, context = null) {
  if (!visiblePickOnly) {
    return true;
  }
  const localRay = makeObjectLocalRay(ray, getActiveObject());
  if (!isFaceFrontFacingRay(face, editor.vertices, localRay)) {
    return false;
  }
  const center = getFaceCenterFromVertices(face, editor.vertices);
  if (!center) {
    return false;
  }
  const candidateFaces = getVisibleOcclusionFaces(ray.client, context);
  return !isPointOccludedByActiveObject(center, ray, {
    ignoreFaceId: face.id,
    faces: candidateFaces
  });
}

// ray と vertex の最短距離からクリック対象 vertex を探す
function pickVertexByRayDistance(ray) {
  const object = getActiveObject();
  const localRay = makeObjectLocalRay(ray, object);
  const candidates = [];
  const dir = normalize3(localRay.dir, "vertex pick ray");
  const threshold = Math.max(getMarkerRadius() * 2.4, getActiveObjectBounds().size * 0.018);
  for (const vertex of editor.vertices) {
    const rel = sub3(vertex.position, localRay.origin);
    const t = dot3(rel, dir);
    if (t < 0.0) {
      continue;
    }
    const closest = add3(localRay.origin, mul3(dir, t));
    const distance = length3(sub3(vertex.position, closest));
    if (distance > threshold) {
      continue;
    }
    candidates.push({
      vertex,
      vertexId: vertex.id,
      distance,
      t
    });
  }
  candidates.sort((a, b) => (a.distance - b.distance) || (a.t - b.t));
  if (!visiblePickOnly) {
    setVisiblePickSelectionStats("click-vertex", candidates.length, candidates.length > 0 ? 1 : 0);
    return candidates[0] ?? null;
  }
  const context = makeVisiblePickContext(getCurrentViewProjectionMatrix());
  for (const candidate of candidates) {
    if (isVertexSelectableFromView(candidate.vertex, ray, context)) {
      setVisiblePickSelectionStats("click-vertex", candidates.length, 1, context);
      return {
        vertexId: candidate.vertexId,
        distance: candidate.distance,
        t: candidate.t
      };
    }
  }
  setVisiblePickSelectionStats("click-vertex", candidates.length, 0, context);
  return null;
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
    const localRay = makeObjectLocalRay(ray, getActiveObject());
    const faceHit = pickFace(ray);
    const planeHit = faceHit?.point
      ?? intersectRayPlane(localRay, [0.0, 0.0, 0.0], [0.0, 1.0, 0.0])
      ?? intersectRayPlane(localRay, worldToLocalPosition(getActiveObject(), orbit.orbit.target), getCameraScreenBasis().forward);
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
    const faceHit = pickSelectableFace(ray);
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
    if (clientPointInRect(projectWorldToClient(viewProjection, localToWorldPosition(object, vertex.position)), rect)) {
      return true;
    }
  }
  for (const face of object.faces) {
    const center = getFaceCenterFromVertices(face, object.vertices);
    if (center && clientPointInRect(projectWorldToClient(viewProjection, localToWorldPosition(object, center)), rect)) {
      return true;
    }
  }
  return false;
}

// 現在 mode / tool に応じて client 矩形内の object / vertex / face を選択する
function selectByClientRect(rect, additive = false) {
  const viewProjection = getCurrentViewProjectionMatrix();
  resetVisiblePickStats("box");
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
    const object = getActiveObject();
    const selectedVertexEntries = editor.vertices
      .map((vertex) => {
        const projected = projectWorldToClient(viewProjection, localToWorldPosition(object, vertex.position));
        return {
          vertex,
          projected
        };
      })
      .filter((entry) => clientPointInRect(entry.projected, rect));
    const context = visiblePickOnly ? makeVisiblePickContext(viewProjection) : null;
    const selectedIds = selectedVertexEntries
      .filter((entry) => {
        if (!visiblePickOnly) {
          return true;
        }
        const ray = makeRayFromMouse(app.screen.canvas, entry.projected.x, entry.projected.y);
        return isVertexSelectableFromView(entry.vertex, ray, context);
      })
      .map((entry) => entry.vertex.id);
    setVisiblePickSelectionStats("box-vertex", selectedVertexEntries.length, selectedIds.length, context);
    if (!additive) {
      // edit selection の vertex / face を空にする
      clearSelection();
    }
    for (const id of selectedIds) {
      editor.selectedVertices.add(id);
    }
    if (selectedIds.length > 0) {
      editor.lastSelectedVertexId = selectedIds[selectedIds.length - 1];
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
    const object = getActiveObject();
    const selectedFaces = editor.faces
      .map((face) => {
        const center = getFaceCenterFromVertices(face, editor.vertices);
        const projected = center ? projectWorldToClient(viewProjection, localToWorldPosition(object, center)) : null;
        return {
          face,
          center,
          projected
        };
      })
      .filter((entry) => entry.center && clientPointInRect(entry.projected, rect));
    const context = visiblePickOnly ? makeVisiblePickContext(viewProjection) : null;
    const selectedIds = selectedFaces
      .filter((entry) => {
        if (!visiblePickOnly) {
          return true;
        }
        const ray = makeRayFromMouse(app.screen.canvas, entry.projected.x, entry.projected.y);
        return isFaceSelectableFromView(entry.face, ray, context);
      })
      .map((entry) => entry.face.id);
    setVisiblePickSelectionStats("box-face", selectedFaces.length, selectedIds.length, context);
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

// ------------------------------------------------------------
// --- input diagnostics and canvas pointer handlers
// ------------------------------------------------------------

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
  if (shouldSuppressCanvasPointer(ev)) {
    ev.preventDefault();
    return;
  }
  // DOM UI から操作後も keyboard / pointer 入力が canvas へ戻るよう focus を整える
  focusModelerCanvas();
  if (mobileUiState.paletteOpen) {
    closeMobilePalette();
  }
  if (ev.button !== 0) {
    // 左クリック / 矩形選択 tracking 状態を初期化する
    resetCanvasClick();
    return;
  }
  if (shouldStartMobileBoxSelectFromDoubleTapDown(ev)) {
    cancelPendingMobileCanvasTap();
    armMobileBoxSelect();
    canvasClick.active = true;
    canvasClick.pointerId = ev.pointerId;
    canvasClick.startX = ev.clientX;
    canvasClick.startY = ev.clientY;
    canvasClick.lastX = ev.clientX;
    canvasClick.lastY = ev.clientY;
    canvasClick.additive = true;
    canvasClick.allowRectangle = true;
    ev.preventDefault();
    return;
  }
  if (shouldSuppressMobileClickForDoubleTapDown(ev)) {
    cancelPendingMobileCanvasTap();
    // ここで canvasClick を開始しないことで、double tap の 2 回目が
    // 通常クリック選択として selection / active object を変えてしまうことを防ぐ
    resetCanvasClick();
    ev.preventDefault();
    return;
  }
  updateLoopCutPreviewFromPointer(ev.clientX, ev.clientY);
  // 編集用の pick は pointerdown では実行しない
  // pointerdown の時点で scene を再生成すると、短いクリックと選択後の drag 操作を区別しにくい
  // 編集操作は左クリックの pointerup で確定し、中ボタン camera 操作とは入力ボタンで分ける
  canvasClick.active = true;
  canvasClick.pointerId = ev.pointerId;
  canvasClick.startX = ev.clientX;
  canvasClick.startY = ev.clientY;
  canvasClick.lastX = ev.clientX;
  canvasClick.lastY = ev.clientY;
  canvasClick.additive = mobileUiState.boxSelectArmed ? true : isAdditiveSelectionEvent(ev);
  // mobile profile では通常時の左ドラッグを orbit camera に使うため、
  // 矩形選択は empty double tap で boxSelectArmed になった後だけ許可する
  canvasClick.allowRectangle = mobileUiState.boxSelectArmed ? true : (!IS_MOBILE_PROFILE && isPlainLeftDragSelectionEvent(ev));
}

// 左ドラッグ中の位置更新と矩形表示更新を行う
function handleCanvasPointerMove(ev) {
  // DebugDock 用に直近の raw pointer / mouse event 情報を記録する
  updateRawInputDebug("canvas", ev);
  updateLoopCutPreviewFromPointer(ev.clientX, ev.clientY);
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
  if (shouldSuppressCanvasPointer(ev)) {
    ev.preventDefault();
    resetCanvasClick();
    mobileUiState.suppressCanvasPointerId = null;
    mobileUiState.suppressCanvasPointerUntil = 0;
    return;
  }
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
  updateLoopCutPreviewFromPointer(ev.clientX, ev.clientY);
  if (moveDistance > 4.0) {
    if (allowRectangle && !(editor.mode === EDITOR_MODE_EDIT && editor.tool === TOOL_ADD_VERTEX)) {
      // 現在 mode / tool に応じて client 矩形内の object / vertex / face を選択する
      selectByClientRect(dragRect, additive);
      if (mobileUiState.boxSelectArmed) {
        disarmMobileBoxSelect();
      }
      ev.preventDefault();
    }
    return;
  }
  if (confirmLoopCutPreview()) {
    ev.preventDefault();
    return;
  }
  if (mobileUiState.boxSelectArmed) {
    // empty double tap 直後に pointer を離しただけなら、box select 準備を維持する
    // これにより、「double tap で準備し、次の drag で矩形選択」できる
    setMessage("box select armed: drag to add selection");
    ev.preventDefault();
    return;
  }
  if (IS_MOBILE_PROFILE && moveDistance <= 4.0) {
    const hit = inspectGestureTarget(ev.clientX, ev.clientY);
    rememberMobileCanvasTap(ev);
    if (hit.kind === "empty") {
      rememberMobileEmptyTap(ev);
    }
  }
  // mobile では single tap か double tap かを判定する短い猶予を置いてから選択を確定する
  // desktop profile は従来通り即時に click selection を実行する
  scheduleMobileCanvasTap(ev);
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
  canvas.addEventListener("pointerleave", () => {
    if (IS_MOBILE_PROFILE && canvasClick.active) {
      return;
    }
    resetCanvasClick();
  });
}

// ------------------------------------------------------------
// --- transform and keyboard command bridges
// ------------------------------------------------------------

// transformController の mode 表示名を UI へ中継する
function getTransformModeLabel(mode) {
  return transformController.getTransformModeLabel(mode);
}

// transformController の mode 開始を UI へ中継する
function setTransformMode(mode) {
  const started = transformController.setTransformMode(mode);
  if (started) {
    closeMobilePalette();
    renderMobileAxisChooser();
  }
  return started;
}

// transformController の軸制限を UI へ中継する
function setTransformAxis(axis) {
  const changed = transformController.setTransformAxis(axis);
  renderMobileAxisChooser();
  return changed;
}

// transformController の cancel を UI へ中継する
function cancelTransformMode() {
  const cancelled = transformController.cancelTransformMode();
  closeMobileAxisChooser();
  return cancelled;
}

// transformController の confirm を UI へ中継する
function confirmTransformMode() {
  const confirmed = transformController.confirmTransformMode();
  closeMobileAxisChooser();
  return confirmed;
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
    const viewPresetKey = ORBIT_VIEW_PRESETS[key] ? key : null;
    if (viewPresetKey && !ev.metaKey && !ev.altKey) {
      if (setOrbitViewPreset(viewPresetKey, ev.ctrlKey)) {
        ev.preventDefault();
      }
      return;
    }
    if (key === "tab") setEditorMode(isEditMode() ? EDITOR_MODE_OBJECT : EDITOR_MODE_EDIT);
    else if (plainKey && key === "4") setTool(TOOL_SELECT_VERTEX);
    else if (plainKey && key === "2") setTool(TOOL_SELECT_FACE);
    else if (plainKey && key === "5") setTool(TOOL_ADD_VERTEX);
    else if (plainKey && key === "a") selectAllForCurrentMode();
    else if (plainKey && key === "g") setTransformMode("move");
    else if (plainKey && key === "r") setTransformMode("rotate");
    else if (plainKey && key === "s") setTransformMode("scale");
    else if (plainKey && key === "e") setTransformMode("extrude");
    else if (plainKey && transformController?.state?.active && (key === "x" || key === "y" || key === "z")) setTransformAxis(key);
    else if (plainKey && key === "c") loopCutSelectedFaces();
    else if (plainKey && key === "j") moveSelectionByScreenKeys(-1.0, 0.0);
    else if (plainKey && key === "l") moveSelectionByScreenKeys(1.0, 0.0);
    else if (plainKey && key === "i") moveSelectionByScreenKeys(0.0, 1.0);
    else if (plainKey && key === "k") moveSelectionByScreenKeys(0.0, -1.0);
    else if (plainKey && key === "u") moveSelectionByNormalKey(-1.0);
    else if (plainKey && key === "o") moveSelectionByNormalKey(1.0);
    else if (plainKey && key === "n") scaleSelectionByKeyboard(0.92);
    else if (plainKey && key === "m") scaleSelectionByKeyboard(1.08);
    else if (plainKey && key === "f") makeFaceFromSelection();
    else if (plainKey && key === "p") toggleProjectionMode();
    else if (plainKey && key === "v") cycleViewAnglePreset(ev.shiftKey ? -1 : 1);
    else if (plainKey && key === "w") toggleObjectWireframe();
    else if (plainKey && key === "x") deleteSelected();
    else if (key === "delete" || key === "backspace") deleteSelected();
    else if (key === "z" && (ev.metaKey || ev.ctrlKey)) undo();
    else if ((key === "y" && (ev.metaKey || ev.ctrlKey)) || (key === "z" && ev.shiftKey && (ev.metaKey || ev.ctrlKey))) redo();
    else if (key === "escape" && cancelTransformMode()) {
      // transform cancel handled above
    }
    else if (key === "escape" && cancelLoopCutPreview("loop cut preview canceled")) {
      // loop cut preview cancel handled above
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

// ------------------------------------------------------------
// --- import and export
// ------------------------------------------------------------

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
  await waitForStatusPaint();
  let asset = null;
  if (format === "json") {
    if (ModelAsset.isGzipSource(file.name)) {
      // iPhone Safari で .json.gz 読み込みが固まる場合に備え、gzip 展開と JSON parse のどちらで止まるか見えるよう段階表示する
      setMessage(`loading ${fileLabel}: decompressing`);
      await waitForStatusPaint();
      const text = await ModelAsset.decompressGzipBlobToText(file);
      setMessage(`loading ${fileLabel}: parsing`);
      await waitForStatusPaint();
      asset = ModelAsset.fromJSON(text);
    } else {
      setMessage(`loading ${fileLabel}: parsing`);
      await waitForStatusPaint();
      const text = await file.text();
      asset = ModelAsset.fromJSON(text);
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
  setMessage(`loading ${fileLabel}: importing`);
  await waitForStatusPaint();
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
  const origin = typeof worldMatrix.getPosition === "function"
    ? readVec3(worldMatrix.getPosition(), `object ${objectId} origin`)
    : [0.0, 0.0, 0.0];
  for (const vertex of vertices) {
    vertex.position = sub3(vertex.position, origin);
  }
  return {
    id: objectId,
    name: entry.node?.name ?? entry.mesh.name ?? entry.mesh.id ?? `Object ${objectId}`,
    origin,
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
  const filename = "mmodeler_modelasset.json";
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
  const filename = "mmodeler_modelasset.json.gz";
  await asset.downloadJSONGz(filename, 2);
  lastSavedName = filename;
  editor.dirty = false;
  // 最後のユーザー向け message を保存し status を更新する
  setMessage(`saved ${filename}`);
}

// active object の geometry から GLB binary を作る
function buildGlbFromEditor() {
  const object = getActiveObject();
  return buildGlbFromGeometry({
    vertices: editor.vertices,
    faces: editor.faces,
    materialColor: MATERIAL.mesh.color,
    nodeTranslation: getObjectOrigin(object)
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
  const filename = "mmodeler.glb";
  // Blob を一時 URL にして browser download を開始する
  downloadBlob(new Blob([glb], { type: "model/gltf-binary" }), filename);
  lastSavedName = filename;
  editor.dirty = false;
  // 最後のユーザー向け message を保存し status を更新する
  setMessage(`saved ${filename}`);
}

// 現在の canvas 内容を次の present 後に PNG として保存する
// WebgApp 側の screenshot 入口を使い、ファイル名規則と保存処理を app 共通にそろえる
function takeModelerScreenshot() {
  const filename = app.takeScreenshot({
    prefix: "mmodeler"
  });
  focusModelerCanvas();
  // screenshot は次の present 後に保存されるため、canvas toast へ filename を描かない
  // WebgApp.pushToast() は canvas HUD に描かれるので、保存画像内へ filename が写り込む
  setMessage("screenshot requested");
}

// ------------------------------------------------------------
// --- DOM handlers
// ------------------------------------------------------------

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
      // JSON 保存口は配布や転送時のサイズを抑えるため gzip 圧縮済み JSON を出力する
      saveModelAssetJsonGz().catch((err) => {
        console.error(err);
        setMessage(`save failed: ${err?.message ?? err}`);
      });
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
  ui.screenshot?.addEventListener("click", () => {
    try {
      // 現在 frame の描画完了後に canvas を PNG として保存する
      takeModelerScreenshot();
    } catch (err) {
      console.error(err);
      // 最後のユーザー向け message を保存し status を更新する
      setMessage(`screenshot failed: ${err?.message ?? err}`);
    }
  });
  ui.newScene.addEventListener("click", () => {
    // 起動時の初期 cube object を作り scene と camera を初期化する
    createInitialModel();
    // 最後のユーザー向け message を保存し status を更新する
    setMessage("new model");
  });
  ui.objectWireframe?.addEventListener("click", toggleObjectWireframe);
  ui.lightBackground?.addEventListener("click", toggleLightBackground);
  ui.visiblePickOnly?.addEventListener("click", toggleVisiblePickOnly);
  ui.xMirrorEdit?.addEventListener("click", toggleXMirrorEdit);
  ui.makeFace?.addEventListener("click", () => makeFaceFromSelection());
  ui.flipFaces?.addEventListener("click", flipSelectedFaces);
  ui.loopCutFaces?.addEventListener("click", loopCutSelectedFaces);
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

// ------------------------------------------------------------
// --- runtime diagnostics
// ------------------------------------------------------------

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
    xMirrorEdit: xMirrorEdit ? "on" : "off",
    visiblePick: visiblePickOnly ? "visible only" : "through",
    visiblePickMode: visiblePickStats.mode,
    visiblePickCandidates: visiblePickStats.candidates,
    visiblePickSelected: visiblePickStats.selected,
    visiblePickGridFaces: visiblePickStats.gridFaces,
    visiblePickGridCells: visiblePickStats.gridCells,
    visiblePickAvgFacesPerCell: visiblePickStats.avgFacesPerFilledCell.toFixed(1),
    visiblePickMaxFacesPerCell: visiblePickStats.maxFacesPerCell,
    projection: getProjectionLabel(),
    focalLength: getFocalLengthLabel(),
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
    mobileProfile: IS_MOBILE_PROFILE ? "yes" : "no",
    mobileGestureDebugVersion: MOBILE_GESTURE_DEBUG_VERSION,
    mobileGestureAttached: mobileUiState.gestureAttached ? "yes" : "no",
    mobileLastGesture: mobileUiState.lastGesture,
    mobileLastGesturePointer: mobileUiState.lastGesturePointer,
    mobileFlickTracking: mobileUiState.flickPointer ? "active" : "idle",
    mobilePaletteOpen: mobileUiState.paletteOpen ? "yes" : "no",
    mobileBoxSelectArmed: mobileUiState.boxSelectArmed ? "yes" : "no",
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
  Diagnostics.addDetail(report, `xMirrorEdit=${xMirrorEdit ? "on" : "off"}`);
  Diagnostics.addDetail(report, `visiblePick=${visiblePickOnly ? "visible only" : "through"}`);
  Diagnostics.addDetail(report, `visiblePickStats=${visiblePickStats.mode} candidates=${visiblePickStats.candidates} selected=${visiblePickStats.selected} gridFaces=${visiblePickStats.gridFaces} filledCells=${visiblePickStats.gridCells} avgFaces=${visiblePickStats.avgFacesPerFilledCell.toFixed(1)} maxFaces=${visiblePickStats.maxFacesPerCell}`);
  Diagnostics.addDetail(report, `projection=${getProjectionLabel()}`);
  Diagnostics.addDetail(report, `focalLength=${getFocalLengthLabel()}`);
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
    xMirrorEdit: xMirrorEdit ? "on" : "off",
    visiblePick: visiblePickOnly ? "visible only" : "through",
    visiblePickMode: visiblePickStats.mode,
    visiblePickCandidates: visiblePickStats.candidates,
    visiblePickSelected: visiblePickStats.selected,
    visiblePickGridFaces: visiblePickStats.gridFaces,
    visiblePickGridCells: visiblePickStats.gridCells,
    visiblePickAvgFacesPerCell: visiblePickStats.avgFacesPerFilledCell.toFixed(1),
    visiblePickMaxFacesPerCell: visiblePickStats.maxFacesPerCell,
    projection: getProjectionLabel(),
    focalLength: getFocalLengthLabel(),
    activeObjectId: editor.activeObjectId ?? "-",
    mobileGestureAttached: mobileUiState.gestureAttached ? "yes" : "no",
    mobileLastGesture: mobileUiState.lastGesture,
    mobileLastGesturePointer: mobileUiState.lastGesturePointer,
    mobilePaletteOpen: mobileUiState.paletteOpen ? "yes" : "no",
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

// ------------------------------------------------------------
// --- application startup
// ------------------------------------------------------------

// WebgApp 初期化から scene / UI / handler 登録までを順に起動する
async function start() {
  // HTML 上の button / input / select を取得して ui 参照へまとめる
  cacheUi();
  const initialCanvasWidth = IS_MOBILE_PROFILE
    ? Math.max(320, Math.floor(window.innerWidth))
    : 900;
  const initialCanvasHeight = IS_MOBILE_PROFILE
    ? Math.max(520, Math.floor(window.innerHeight))
    : 620;
  app = new ModelerWebgApp({
    document,
    shaderClass: ModelerSmoothShader,
    layoutMode: "embedded",
    fixedCanvasSize: {
      width: initialCanvasWidth,
      height: initialCanvasHeight,
      useDevicePixelRatio: false
    },
    clearColor: BACKGROUND_DARK_COLOR,
    viewAngle: VIEW_ANGLE_PRESETS[viewAnglePresetIndex],
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
      system: SAMPLE_NAME,
      source: "samples/mmodeler/main.js",
      probeDefaultAfterFrames: 1
    }
  });
  await app.init();
  selectedFaceShader = new SelectedFaceOverlayShader(app.getGPU());
  await selectedFaceShader.init();
  if (app.projectionMatrix) {
    selectedFaceShader.setProjectionMatrix(app.projectionMatrix);
  }
  overlay2d = new Overlay2DRenderer(app.getGPU(), { initialVertexCapacity: 8192 });
  await overlay2d.init();
  edgeOverlay = new EdgeWireframeOverlayRenderer(app.getGPU(), { initialVertexCapacity: 8192 });
  await edgeOverlay.init();
  guideOverlay = new EdgeWireframeOverlayRenderer(app.getGPU(), { initialVertexCapacity: 256, zBias: 0.00008 });
  await guideOverlay.init();
  app.attachInput();
  orbit = app.createOrbitEyeRig({
    target: [...DEFAULT_CAMERA.target],
    distance: DEFAULT_CAMERA.distance,
    yaw: DEFAULT_CAMERA.yaw,
    pitch: DEFAULT_CAMERA.pitch,
    orbitKeyMap: { ...INITIAL_ORBIT_BINDINGS.orbitKeyMap },
    panModifierKey: INITIAL_ORBIT_BINDINGS.panModifierKey,
    dragZoomModifierKey: "control",
    minDistance: MIN_CAMERA_DISTANCE,
    maxDistance: 96.0,
    wheelZoomStep: 0.25,
    keyZoomSpeed: 2.0,
    dragZoomSpeed: 0.04,
    dragRotateSpeed: 0.28,
    dragPanSpeed: 2.0,
    pitchMin: -90.0,
    pitchMax: 90.0,
    // mobile profile は画面内操作が主役なので、PC デバッグ時も
    // 通常時の左ドラッグを orbit、短い左クリックを選択として扱う
    dragButton: 0,
    alternateDragButton: 1,
    alternateDragModifierKey: null
  });
  const operationContext = {
    editor,
    addExplicitXMirrorVertexPairs,
    addFace,
    addFaceOrientedToDirection,
    addFaceWithStableOrientation,
    addVertex,
    applyXMirrorEdit,
    clearSelection,
    computeCenter,
    computeFaceNormal,
    computeSelectionNormal,
    createExtrusion: (distance) => editOperations.createExtrusion(distance),
    focusModelerCanvas,
    getActiveVertexObjects,
    getCameraScreenBasis,
    getCanvas: () => app.screen.canvas,
    getEdgeSlideTargets,
    getEditorBounds,
    getSelectedFaceObjects,
    getObjectOrigin,
    getTransformTargetObjects,
    getTransformTargetVertexObjects,
    getVertexById,
    getXMirrorExtrusionFaces,
    isEditMode,
    makeXMirrorEditPairs,
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
  installMobileOverlayHandlers();
  installSafariCalloutGuards();
  // mobile gesture は通常の canvas click handler より先に登録する
  // double tap の 2 回目で選択処理や scene 再構築が先に走ると、
  // doubleTapTime を超えて gesture として成立しにくくなるため
  installMobileGestureHandlers();
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
      if (projectionMode === PROJECTION_MODE_ORTHOGRAPHIC) {
        // Orthographic では orbit distance を表示スケールとして使うため、
        // wheel / drag zoom 後の距離を毎 frame projection に反映する。
        applyModelerProjection({
          updateStatus: false
        });
      }
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
      drawGuideOverlayPass();
      // Edit Mode の edge と marker overlay を scene 描画後に重ねる
      drawEditOverlayPass();
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  // WebgApp 初期化から scene / UI / handler 登録までを順に起動する
  start().catch((err) => {
    console.error("mmodeler failed:", err);
    if (ui.status) {
      ui.status.textContent = `mmodeler failed\n${err?.stack ?? err}`;
    }
  });
});
