// ---------------------------------------------
// samples/mmodeler/main.js  2026/07/25
//   mmodeler sample
//   Sections:
//   - webg app subclasses and shaders
//   - constants and shared state
//   - focus, projection, camera, mobile UI, and status helpers
//   - snapshots, information overlays, object transforms, and scene rebuild
//   - object/mode command routing, picking/input, keyboard, import/export, diagnostics, startup
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import WebgApp from "../../webg/WebgApp.js";
import SmoothShader from "../../webg/SmoothShader.js";
import ModelAsset from "../../webg/ModelAsset.js";
import Matrix from "../../webg/Matrix.js";
import Quat from "../../webg/Quat.js";
import Diagnostics from "../../webg/Diagnostics.js";
import { CAMERA_REVERSE_Z } from "../../webg/DepthConvention.js";
import BoxSelectSession from "./BoxSelectSession.js";
import CommandPalette, { getCommandActionLabel } from "./CommandPalette.js";
import EditModeController from "./EditModeController.js";
import ModelerCommandDispatcher from "./ModelerCommandDispatcher.js";
import ModelerImportExport from "./ModelerImportExport.js";
import MobileInputController from "./MobileInputController.js";
import ModelerPicking, { intersectRayPlane } from "./ModelerPicking.js";
import { buildPrimitiveObject as buildModelerPrimitiveObject } from "./ModelerPrimitiveFactory.js";
import ModelerRenderer from "./ModelerRenderer.js";
import ModelerScene from "./ModelerScene.js";
import ObjectModeController from "./ObjectModeController.js";
import SculptModeController from "./SculptModeController.js";
import ViewController from "./ViewController.js";
import {
  DEFAULT_CAMERA,
  DEFAULT_OBJECT_ID,
  EDITOR_MODE_EDIT,
  EDITOR_MODE_OBJECT,
  EDITOR_MODE_SCULPT,
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
  readQuatXyzw,
  readVec3,
  sub3
} from "./math3d.js";
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
  // mmodeler の透視投影だけ、編集対象に寄せた depth range を使う。
  // 正射影は従来の range を維持し、projection mode 切り替え時の見え方を不用意に変えない。
  updateProjection(viewAngle = this.viewAngle) {
    const proj = new Matrix();
    const vfov = this.screen.getRecommendedFov(viewAngle);
    proj.makeProjectionMatrix(
      PERSPECTIVE_PROJECTION_NEAR,
      PERSPECTIVE_PROJECTION_FAR,
      vfov,
      this.screen.getAspect()
    );
    this.projectionMatrix = proj;
    if (this.shader?.setProjectionMatrix) {
      this.shader.setProjectionMatrix(proj);
    }
    return proj;
  }

  // webg コアの WebgApp は透視投影を標準入口にしている。
  // mmodeler ではコアを変更せず、サンプル専用 subclass で正射影行列だけを追加する。
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
      ORTHOGRAPHIC_PROJECTION_NEAR,
      ORTHOGRAPHIC_PROJECTION_FAR,
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
    // Camera Reverse-Zで同一深度の面を通すためgreater-equal比較を使用する
    // 通常 mesh は裏面確認のため両面描画するが、選択面 overlay は背面まで色を出すと
    // 反対側の face が選択されているように見えるため、overlay だけ back-face culling を有効にする
    super(gpu, {
      cullMode: "back",
      depthWriteEnabled: false,
      depthCompare: CAMERA_REVERSE_Z.compareEqual
    });
    // world 座標の頂点を動かすと選択面が剥がれて見えるため、vertex shader の
    // clip-space z だけをごく小さく手前へ寄せるw 比例にすることで透視除算後の
    // bias が距離に対して極端に変わらないようにする
    this.wgslSrc = this.wgslSrc.replace(
      "output.position = u.projMatrix * pos4;",
      `output.position = u.projMatrix * pos4;\n        output.position.z = min(output.position.w, output.position.z + ${SELECTED_FACE_Z_BIAS_PERSPECTIVE.toFixed(8)} * output.position.w);`
    );
  }
}

// mmodeler は editable scene object を保存・表示の正本として扱う
// - Object Mode では object list と object transform が正本になる
// - Edit Mode では EditModeController の edit session が表示・pick・preview の正本になる
// - 表示用 Shape と保存用 ModelAsset は、必要な境界で editable geometry から再生成する
// この方針により、画面表示、pick 対象、保存対象がどの状態を読んでいるかを追いやすくする

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
  mobileViewButtons: [],
  mobileSelectionShift: null,
  coordinateOverlay: null,
  coordinateOverlayTitle: null,
  coordinateOverlayHint: null,
  coordinateOverlayLabels: [],
  coordinateOverlayFields: [],
  coordinateFalloffSelect: null,
  coordinateOverlayApply: null,
  coordinateOverlayClose: null,
  objectInfoOverlay: null,
  objectInfoTitle: null,
  objectInfoBounds: null,
  objectInfoVertices: null,
  objectInfoPolygons: null,
  objectInfoOrigin: null,
  objectInfoFocalLength: null,
  objectInfoOrbitDistance: null,
  objectInfoCameraDistance: null
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

const MOBILE_GESTURE_DEBUG_VERSION = "2026-05-17-empty-scene-palette-v1";

const mobileInput = new MobileInputController({
  isMobileProfile: IS_MOBILE_PROFILE,
  ribbonPages: MOBILE_RIBBON_PAGES
});

let app = null;
let orbit = null;
let modelerRenderer = null;
let selectedFaceShader = null;
let overlay2d = null;
let edgeOverlay = null;
let guideOverlay = null;
let overlayEdgeCache = [];
let overlayEdgeCacheDirty = true;
let overlayEdgeUploadDirty = true;
let markerOverlayDirty = true;
let markerOverlayCameraKey = "";
let coordinateOverlayLastTouchAction = "";
let coordinateOverlayLastTouchTime = 0;
let coordinateOverlayMode = "coordinate";
let overlayAlpha = 0.65;
let overlayMarkerColor = [0.0, 0.0, 0.0];
let overlayEdgeColor = [0.0, 0.0, 0.0];
let xMirrorEdit = false;
let importedAsset = null;
let importedMeshes = [];
let lastSavedName = "-";
let detachModelerKeyBridge = null;
let detachTransformPointerBridge = null;
let commandPalette = null;
let boxSelectSession = null;
let editModeController = null;
let modelerImportExport = null;
let modelerCommandDispatcher = null;
let modelerPicking = null;
let objectModeController = null;
let sculptModeController = null;
let transformController = null;

const VIEW_ANGLE_PRESETS = [50.0, 40.0, 32.0, 24.0, 18.0, 12.0, 6.0];
// 24 degree は 35mm full-frame 短辺換算で約 56mm になり、
// mobile の初期表示で極端な広角にならず形状確認しやすい
let viewAnglePresetIndex = 3;
const ORTHOGRAPHIC_PROJECTION_NEAR = 0.05;
const ORTHOGRAPHIC_PROJECTION_FAR = 1000.0;
const PERSPECTIVE_PROJECTION_NEAR = ORTHOGRAPHIC_PROJECTION_NEAR;
const PERSPECTIVE_PROJECTION_FAR = ORTHOGRAPHIC_PROJECTION_FAR;
const Z_BIAS_REFERENCE_PERSPECTIVE_NEAR = 0.05;
const Z_BIAS_REFERENCE_PERSPECTIVE_FAR = 1000.0;
const PROJECTION_MODE_PERSPECTIVE = "perspective";
const PROJECTION_MODE_ORTHOGRAPHIC = "orthographic";
const viewController = new ViewController({
  perspectiveMode: PROJECTION_MODE_PERSPECTIVE,
  orthographicMode: PROJECTION_MODE_ORTHOGRAPHIC,
  initialProjectionMode: PROJECTION_MODE_PERSPECTIVE,
  initialObjectWireframe: false,
  initialLightBackground: false,
  initialVisiblePickOnly: true,
  initialViewAxis: "z",
  initialViewFlip: false
});
let projectionUpdateKey = "";
const MIN_CAMERA_DISTANCE = 0.03;
const UNRESTRICTED_ORBIT_PITCH_DEGREES = 1000000.0;
const NORMALIZED_ORBIT_PITCH_DEGREES = 180.0;
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
const GUIDE_Z_BIAS_PERSPECTIVE = 0.00008;
const SELECTED_FACE_Z_BIAS_BASE = 0.00045;
const SELECTED_FACE_Z_BIAS_PERSPECTIVE = SELECTED_FACE_Z_BIAS_BASE * getPerspectiveDepthCoefficientZBiasScale();
const Z_BIAS_REFERENCE_VIEW_ANGLE = 50.0;
const WIREFRAME_OVERLAY_MARKER_COLOR = [0.92, 1.0, 1.0];
const WIREFRAME_OVERLAY_EDGE_COLOR = [0.72, 0.96, 1.0];
const WIREFRAME_OVERLAY_SELECTED_EDGE_COLOR = [1.0, 1.0, 0.82];
const SELECTED_VERTEX_EDGE_COLOR = [0.95, 0.08, 0.08];
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

// `visible`の`pick`の選択状態の統計情報を受け取り、現在の設定と後続処理へ反映する
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

// mmodeler の scene state を保持する
// 詳細な field の意味は ModelerScene.js に集約し、main.js は scene 操作の接続役へ寄せていく
const editor = new ModelerScene({
  mode: EDITOR_MODE_OBJECT,
  nextObjectId: DEFAULT_OBJECT_ID,
  tool: TOOL_SELECT_FACE
});

// ------------------------------------------------------------
// --- focus, projection, and camera helpers
// ------------------------------------------------------------

// DOM UI から操作後も keyboard / pointer 入力が canvas へ戻るよう focus を整える
function focusModelerCanvas() {
  const canvas = app?.screen?.canvas ?? null;
  if (!canvas) {
    return;
  }
  if (isTextEntryTarget(document?.activeElement)) {
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
  return viewController.getProjectionLabel();
}

// Perspective projection の NDC depth は near / far から決まる係数に比例して変化する
// projection range を調整したときも overlay bias の見え方を基準値へ寄せるため、
// 基準 projection と現在 projection の depth coefficient 比を zBias に掛けて安定させる
function getPerspectiveDepthCoefficientZBiasScale() {
  const current = getPerspectiveDepthCoefficient(PERSPECTIVE_PROJECTION_NEAR, PERSPECTIVE_PROJECTION_FAR);
  const reference = getPerspectiveDepthCoefficient(Z_BIAS_REFERENCE_PERSPECTIVE_NEAR, Z_BIAS_REFERENCE_PERSPECTIVE_FAR);
  if (!Number.isFinite(current) || current <= 0.0 || !Number.isFinite(reference) || reference <= 0.0) {
    throw new Error(`mmodeler zBias depth scale requires valid coefficients: current=${current} reference=${reference}`);
  }
  return current / reference;
}

// `perspective`の深度の`coefficient`を現在の入力と状態から求め、呼び出し元へ返す
function getPerspectiveDepthCoefficient(near, far) {
  const n = Number(near);
  const f = Number(far);
  if (!Number.isFinite(n) || !Number.isFinite(f) || n <= 0.0 || f <= n) {
    throw new Error(`mmodeler zBias depth coefficient requires 0 < near < far: near=${near} far=${far}`);
  }
  return Math.abs(f * n / (n - f));
}

// Perspective の clip-space zBias は望遠側ほど効きすぎて見えやすい
// FOV scale と depth coefficient scale を掛け合わせ、焦点距離と near/far の変更の両方に追従させる
function getPerspectiveZBiasScale() {
  const viewAngle = Number(app?.viewAngle ?? VIEW_ANGLE_PRESETS[viewAnglePresetIndex]);
  if (!Number.isFinite(viewAngle) || viewAngle <= 0.0 || viewAngle >= 180.0) {
    throw new Error(`mmodeler zBias scale requires valid viewAngle: ${viewAngle}`);
  }
  const currentTan = Math.tan(viewAngle * 0.5 * Math.PI / 180.0);
  const referenceTan = Math.tan(Z_BIAS_REFERENCE_VIEW_ANGLE * 0.5 * Math.PI / 180.0);
  if (!Number.isFinite(currentTan) || currentTan <= 0.0 || !Number.isFinite(referenceTan) || referenceTan <= 0.0) {
    throw new Error(`mmodeler zBias scale produced invalid tangent: current=${currentTan} reference=${referenceTan}`);
  }
  return (currentTan / referenceTan) * getPerspectiveDepthCoefficientZBiasScale();
}

// 輪郭の重ね合わせ表示の`z`の`bias`を現在の入力と状態から求め、呼び出し元へ返す
function getEdgeOverlayZBias() {
  if (viewController.projectionMode === PROJECTION_MODE_ORTHOGRAPHIC) {
    return EDGE_Z_BIAS_ORTHOGRAPHIC;
  }
  return EDGE_Z_BIAS_PERSPECTIVE * getPerspectiveZBiasScale();
}

// `marker`の重ね合わせ表示の`z`の`bias`を現在の入力と状態から求め、呼び出し元へ返す
function getMarkerOverlayZBias() {
  if (viewController.projectionMode === PROJECTION_MODE_ORTHOGRAPHIC) {
    return MARKER_Z_BIAS_ORTHOGRAPHIC;
  }
  return MARKER_Z_BIAS_PERSPECTIVE * getPerspectiveZBiasScale();
}

// `guide`の重ね合わせ表示の`z`の`bias`を現在の入力と状態から求め、呼び出し元へ返す
function getGuideOverlayZBias() {
  if (viewController.projectionMode === PROJECTION_MODE_ORTHOGRAPHIC) {
    return 0.0;
  }
  return GUIDE_Z_BIAS_PERSPECTIVE * getPerspectiveZBiasScale();
}

// edit mesh の頂点・面が変わったときは edge cache と marker 投影を作り直す
function markEditOverlayGeometryDirty() {
  overlayEdgeCacheDirty = true;
  overlayEdgeUploadDirty = true;
  markerOverlayDirty = true;
}

// 選択状態や edge 色だけが変わったときは edge buffer の再 upload と marker 再描画だけでよい
function markEditOverlayVisualDirty() {
  overlayEdgeUploadDirty = true;
  markerOverlayDirty = true;
}

// marker 色や camera 変化など、screen-space marker だけを再投影したい場合の印
function markMarkerOverlayDirty() {
  markerOverlayDirty = true;
}

// edge overlay の色や alpha だけが変わったとき、line-list geometry は再計算せず色付き buffer だけ作り直す
function markEdgeOverlayUploadDirty() {
  overlayEdgeUploadDirty = true;
}

// `markProjectionDependentsDirty`は座標または数値を計算し、後続処理で使う結果を返す
function markProjectionDependentsDirty() {
  selectedFaceShader?.setProjectionMatrix?.(app.projectionMatrix);
  markEditOverlayVisualDirty();
}

// `orthographic`の表示の高さを現在の入力と状態から求め、呼び出し元へ返す
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

// `positive`の`recommended`の`fov`を読み込み、検証済みのデータとして後続処理へ渡す
function readPositiveRecommendedFov(viewAngle, label) {
  const vfov = app.screen.getRecommendedFov(viewAngle);
  if (!Number.isFinite(vfov) || vfov <= 0.0) {
    throw new Error(`${label} requires positive recommended fov: ${vfov}`);
  }
  return vfov;
}

// `adjustPerspectiveDistanceForViewAngle`は座標または数値を計算し、後続処理で使う結果を返す
function adjustPerspectiveDistanceForViewAngle(oldViewAngle, newViewAngle) {
  if (!app || !orbit || viewController.projectionMode !== PROJECTION_MODE_PERSPECTIVE) {
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
  if (!app || !orbit || viewController.projectionMode !== PROJECTION_MODE_ORTHOGRAPHIC) {
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

// 投影の`update`のキーを生成し、後続処理で利用できる状態にする
function makeProjectionUpdateKey() {
  if (!app) {
    throw new Error("makeProjectionUpdateKey requires initialized app");
  }
  const distance = Number(orbit?.orbit?.distance);
  const aspect = app.screen.getAspect();
  return [
    viewController.projectionMode,
    Number(app.viewAngle).toFixed(6),
    Number(app.projectionNear).toFixed(6),
    Number(app.projectionFar).toFixed(6),
    Number.isFinite(distance) ? distance.toFixed(6) : "no-orbit-distance",
    Number(aspect).toFixed(6)
  ].join("|");
}

// `modeler`の投影を対象の状態または描画設定へ反映する
function applyModelerProjection(options = {}) {
  if (!app) {
    throw new Error("applyModelerProjection requires initialized app");
  }
  const nextProjectionKey = makeProjectionUpdateKey();
  if (options.force !== true && projectionUpdateKey === nextProjectionKey) {
    return false;
  }
  if (viewController.projectionMode === PROJECTION_MODE_ORTHOGRAPHIC) {
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

// 表示の`angle`の`preset`を対象の状態または描画設定へ反映する
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
  viewController.runToggleProjectionCommand();
}

function setMobileAxisView(axis, reversed = false) {
  return viewController.runSetMobileAxisViewCommand(axis, reversed);
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
    if (isTextEntryTarget(ev.target)) {
      return;
    }
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
    if (isTextEntryTarget(ev.target)) {
      return;
    }
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
  ui.mobileViewButtons = Array.from(document.querySelectorAll("[data-view-action]"));
  ui.mobileSelectionShift = document.getElementById("mobileSelectionShift");
  ui.coordinateOverlay = document.getElementById("coordinateOverlay");
  ui.coordinateOverlayTitle = document.getElementById("coordinateOverlayTitle");
  ui.coordinateOverlayHint = document.getElementById("coordinateOverlayHint");
  ui.coordinateOverlayLabels = [
    document.getElementById("coordinateLabelX"),
    document.getElementById("coordinateLabelY"),
    document.getElementById("coordinateLabelZ")
  ].filter(Boolean);
  ui.coordinateOverlayFields = Array.from(document.querySelectorAll("[data-coordinate-axis]"));
  ui.coordinateFalloffSelect = document.getElementById("coordinateFalloff");
  ui.coordinateOverlayApply = document.getElementById("coordinateOverlayApply");
  ui.coordinateOverlayClose = document.getElementById("coordinateOverlayClose");
  ui.objectInfoOverlay = document.getElementById("objectInfoOverlay");
  ui.objectInfoTitle = document.getElementById("objectInfoTitle");
  ui.objectInfoBounds = document.getElementById("objectInfoBounds");
  ui.objectInfoVertices = document.getElementById("objectInfoVertices");
  ui.objectInfoPolygons = document.getElementById("objectInfoPolygons");
  ui.objectInfoOrigin = document.getElementById("objectInfoOrigin");
  ui.objectInfoFocalLength = document.getElementById("objectInfoFocalLength");
  ui.objectInfoOrbitDistance = document.getElementById("objectInfoOrbitDistance");
  ui.objectInfoCameraDistance = document.getElementById("objectInfoCameraDistance");
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

// モバイル操作の`tool`の`label`を現在の入力と状態から求め、呼び出し元へ返す
function getMobileToolLabel() {
  const mode = getRenderableEditorMode();
  const tool = getRenderableEditorTool();
  if (mode === EDITOR_MODE_OBJECT) {
    return "Object";
  }
  if (mode === EDITOR_MODE_SCULPT) {
    return "Sculpt";
  }
  if (tool === TOOL_SELECT_VERTEX) {
    return "Vertex";
  }
  if (tool === TOOL_SELECT_FACE) {
    return "Face";
  }
  if (tool === TOOL_ADD_VERTEX) {
    return "Add";
  }
  return tool;
}

function getMobileRibbonActionLabel(action) {
  return getCommandActionLabel(action);
}

// command palette は未選択状態でも開けるため、選択が前提の command だけを個別に無効化する
// long press 自体では hit した polygon / vertex を選択せず、利用者が作った選択状態を保つ
function hasMobileSelectionForAction(action) {
  if (getRenderableEditorMode() === EDITOR_MODE_OBJECT) {
    return editor.selectedObjectIds.size > 0;
  }
  const editMesh = getRenderableEditMeshState();
  if (action === "extrude") {
    return editMesh.selectedFaces.size > 0;
  }
  return editMesh.selectedVertices.size > 0 || editMesh.selectedFaces.size > 0;
}

// モバイル操作の操作の有効状態の条件を判定し、結果を真偽値で返す
function isMobileActionEnabled(action) {
  if (action === "undefined") {
    return false;
  }
  if (action === "mode-sculpt"
      || action === "mode-edit"
      || action === "sculpt-draw"
      || action === "sculpt-blur"
      || action === "sculpt-grab"
      || action === "sculpt-pinch"
      || action === "sculpt-plus"
      || action === "sculpt-minus") {
    return getActiveObject() !== null;
  }
  if (action === "tool-face" || action === "tool-vertex" || action === "tool-add") {
    return getRenderableEditorMode() === EDITOR_MODE_EDIT;
  }
  if (String(action ?? "").startsWith("primitive-segments-")) {
    return true;
  }
  if (action === "axis-x" || action === "axis-y" || action === "axis-z") {
    return true;
  }
  if (action === "axis-normal") {
    return getRenderableEditorMode() === EDITOR_MODE_EDIT
      && editModeController?.canUseNormalAxisConstraint?.() === true;
  }
  if (action === "move" || action === "rotate" || action === "scale" || action === "extrude" || action === "delete") {
    return hasMobileSelectionForAction(action);
  }
  if (action === "join-objects") {
    return getRenderableEditorMode() === EDITOR_MODE_OBJECT && editor.selectedObjectIds.size >= 2;
  }
  if (action === "save-json" || action === "save-glb") {
    return hasActiveGeometryForSave({ requireFaces: action === "save-glb" });
  }
  if (action === "undo") {
    return editor.undoStack.length > 0;
  }
  if (action === "redo") {
    return editor.redoStack.length > 0;
  }
  if (action === "edge-slide") {
    return getRenderableEditorMode() === EDITOR_MODE_EDIT && editModeController.getActiveVertexObjects().length > 0;
  }
  if (action === "chain-select" || action === "select-loop") {
    return getRenderableEditorMode() === EDITOR_MODE_EDIT && editModeController.getActiveVertexObjects().length > 0;
  }
  if (action === "subdivide") {
    const editMesh = getRenderableEditMeshState();
    return getRenderableEditorMode() === EDITOR_MODE_EDIT
      && editMesh.faces.length > 0
      && editMesh.faces.every((face) => face.indices.length === 4);
  }
  if (action === "catmull-clark") {
    const editMesh = getRenderableEditMeshState();
    return getRenderableEditorMode() === EDITOR_MODE_EDIT
      && editMesh.faces.length > 0;
  }
  if (action === "view-vertex") {
    return getRenderableEditorMode() === EDITOR_MODE_SCULPT
      || (getRenderableEditorMode() === EDITOR_MODE_EDIT && editModeController.getActiveVertexObjects().length > 0);
  }
  if (action === "sculpt-brush") {
    return sculptModeController !== null;
  }
  if (action === "object-info") {
    return getActiveObject() !== null;
  }
  if (action === "object-wireframe") {
    return true;
  }
  if (action === "object-smooth-shading") {
    return true;
  }
  if (action === "origin-world") {
    return editor.selectedObjectIds.size > 0 || editor.activeObjectId !== null;
  }
  if (action === "loop-cut") {
    return getRenderableEditorMode() === EDITOR_MODE_EDIT
        && editModeController.getSelectedFaceObjects().some((face) => face.indices.length === 4);
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
    return viewController.objectWireframe;
  }
  if (action === "object-smooth-shading") {
    return viewController.objectSmoothShading;
  }
  if (action === "mode-sculpt") {
    return getRenderableEditorMode() === EDITOR_MODE_SCULPT;
  }
  if (action === "mode-edit") {
    return getRenderableEditorMode() === EDITOR_MODE_EDIT;
  }
  if (action === "sculpt-draw" || action === "sculpt-blur" || action === "sculpt-grab" || action === "sculpt-pinch") {
    return getRenderableEditorMode() === EDITOR_MODE_SCULPT
      && sculptModeController?.brushType === action.slice("sculpt-".length);
  }
  if (action === "sculpt-plus") {
    return getRenderableEditorMode() === EDITOR_MODE_SCULPT
      && (sculptModeController?.brushStrength ?? 0.0) >= 0.0;
  }
  if (action === "sculpt-minus") {
    return getRenderableEditorMode() === EDITOR_MODE_SCULPT
      && (sculptModeController?.brushStrength ?? 0.0) < 0.0;
  }
  if (action === "tool-vertex") {
    return getRenderableEditorMode() === EDITOR_MODE_EDIT && getRenderableEditorTool() === TOOL_SELECT_VERTEX;
  }
  if (action === "tool-face") {
    return getRenderableEditorMode() === EDITOR_MODE_EDIT && getRenderableEditorTool() === TOOL_SELECT_FACE;
  }
  if (action === "axis-x" || action === "axis-y" || action === "axis-z" || action === "axis-normal") {
    const axis = action === "axis-normal" ? "n" : action.slice(-1);
    return mobileInput.transformAxisConstraint === axis;
  }
  if (action === "view-x" || action === "view-y" || action === "view-z"
      || action === "view-x-reverse" || action === "view-y-reverse" || action === "view-z-reverse") {
    const reversed = action.endsWith("-reverse");
    const axis = reversed ? action.slice(5, 6) : action.slice(-1);
    return viewController.isMobileAxisViewActive(axis, reversed);
  }
  if (String(action ?? "").startsWith("primitive-segments-")) {
    const segments = Number(String(action).slice("primitive-segments-".length));
    return mobileInput.primitiveSegments === segments;
  }
  return false;
}

// モバイル操作の`ribbon`を現在の入力と実行状態に合わせて更新する
function updateMobileRibbon() {
  if (!IS_MOBILE_PROFILE) {
    return;
  }
  const currentMode = getRenderableEditorMode();
  const mode = currentMode === EDITOR_MODE_EDIT
    ? "edit"
    : currentMode === EDITOR_MODE_SCULPT
      ? "sculpt"
      : "object";
  const tool = getMobileToolLabel().toLowerCase();
  const box = mobileInput.boxSelectArmed ? " | box select armed" : "";
  const shift = mobileInput.selectionShiftActive
    ? (currentMode === EDITOR_MODE_SCULPT ? " | brush armed" : " | shift")
    : "";
  if (ui.mobileStatus) {
    ui.mobileStatus.textContent = `${mode} / ${tool} | ${editor.lastMessage || "ready"}${box}${shift}`;
  }
  const page = mobileInput.currentRibbonPage;
  if (ui.mobileRibbonName) {
    ui.mobileRibbonName.textContent = page.name;
  }
  if (ui.mobileRibbonHint) {
    ui.mobileRibbonHint.textContent = `${mode} / ${tool} | ${editor.lastMessage || "ready"}${box}${shift}`;
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
  if (ui.mobileSelectionShift) {
    ui.mobileSelectionShift.classList.toggle("active", mobileInput.selectionShiftActive);
    ui.mobileSelectionShift.setAttribute("aria-pressed", mobileInput.selectionShiftActive ? "true" : "false");
  }
}

// モバイル操作の選択状態の`shift`の有効状態を切り替え、表示と処理へ反映する
function toggleMobileSelectionShift() {
  mobileInput.toggleSelectionShift();
  if (getRenderableEditorMode() === EDITOR_MODE_SCULPT) {
    setMessage(`brush stroke ${mobileInput.selectionShiftActive ? "armed" : "orbit"}`);
    setMobileOrbitEnabled(!mobileInput.selectionShiftActive);
  }
}

// 空白部分のダブルタップから彫刻ブラシの入力方式を切り替える
function toggleSculptBrushInputFromEmptyDoubleTap(ev = null) {
  if (!isSculptMode()) {
    return false;
  }
  mobileInput.selectionShiftActive = !mobileInput.selectionShiftActive;
  setMobileOrbitEnabled(!mobileInput.selectionShiftActive);
  updateMobileRibbon();
  if (ev) {
    updateSculptPreviewFromPointer(ev.clientX, ev.clientY);
  }
  setMessage(mobileInput.selectionShiftActive ? "sculpt brush drag" : "sculpt camera orbit");
  return true;
}

// モバイル操作の周回視点の有効状態を受け取り、現在の設定と後続処理へ反映する
function setMobileOrbitEnabled(enabled) {
  if (orbit) {
    orbit.enabled = enabled;
  }
}

// `signed`の`degrees`を検証し、後続処理が扱える共通形式へ整える
function normalizeSignedDegrees(degrees, limit = NORMALIZED_ORBIT_PITCH_DEGREES) {
  const numeric = Number(degrees);
  if (!Number.isFinite(numeric)) {
    return 0.0;
  }
  const fullTurn = limit * 2.0;
  const wrapped = ((numeric + limit) % fullTurn + fullTurn) % fullTurn - limit;
  return wrapped === -limit && numeric > 0.0 ? limit : wrapped;
}

// 周回視点の`pitch`の`for`の`modeler`を検証し、後続処理が扱える共通形式へ整える
function normalizeOrbitPitchForModeler() {
  if (!orbit?.orbit || orbit.orbit.rotationInputMode === "camera-view") {
    return false;
  }
  const normalizedPitch = normalizeSignedDegrees(orbit.orbit.pitch);
  if (Math.abs(normalizedPitch - orbit.orbit.pitch) <= 1.0e-9) {
    return false;
  }
  orbit.orbit.pitch = normalizedPitch;
  orbit.apply?.(true);
  app?.syncCameraFromEyeRig?.(orbit);
  return true;
}

function closeMobilePalette() {
  commandPalette?.close();
}

// coordinate overlay を閉じ、canvas 操作へ戻れるようにする
function closeCoordinateOverlay() {
  ui.coordinateOverlay?.classList.remove("open");
  focusModelerCanvas();
}

// `closeObjectInfoOverlay`は必要な画面要素を準備し、表示状態を更新する
function closeObjectInfoOverlay() {
  ui.objectInfoOverlay?.classList.remove("open");
  focusModelerCanvas();
}

// iPhone Safari では touchstart / touchend の preventDefault により click が発火しない場合がある
// coordinate overlay の操作部品だけは Safari guard の対象外にし、button は touchend / pointerup でも実行する
function isCoordinateOverlayControl(target) {
  const element = target?.closest
    ? target
    : target?.parentElement ?? null;
  return element?.closest?.(".coordinate-overlay input, .coordinate-overlay select, .coordinate-overlay button") !== null;
}

// `text`の`entry`の対象の条件を判定し、結果を真偽値で返す
function isTextEntryTarget(target) {
  const element = target?.closest
    ? target
    : target?.parentElement ?? null;
  return element?.closest?.("input, textarea, select, [contenteditable='true']") !== null;
}

// `coordinate`の重ね合わせ表示のボタンの操作の実行段階で、必要な処理を決められた順序で進める
function runCoordinateOverlayButtonAction(action, ev = null) {
  ev?.preventDefault?.();
  ev?.stopPropagation?.();
  action();
}

// `coordinate`の重ね合わせ表示のボタンのタッチ入力の操作の実行段階で、必要な処理を決められた順序で進める
function runCoordinateOverlayButtonTouchAction(name, action, ev) {
  const elapsed = performance.now() - coordinateOverlayLastTouchTime;
  if (coordinateOverlayLastTouchAction === name && elapsed >= 0.0 && elapsed < 120.0) {
    ev?.preventDefault?.();
    ev?.stopPropagation?.();
    return;
  }
  coordinateOverlayLastTouchAction = name;
  coordinateOverlayLastTouchTime = performance.now();
  runCoordinateOverlayButtonAction(action, ev);
}

// `suppress`の`coordinate`の重ね合わせ表示の`click`の条件を判定し、結果を真偽値で返す
function shouldSuppressCoordinateOverlayClick(name) {
  const elapsed = performance.now() - coordinateOverlayLastTouchTime;
  if (coordinateOverlayLastTouchAction === name && elapsed >= 0.0 && elapsed < 420.0) {
    coordinateOverlayLastTouchAction = "";
    coordinateOverlayLastTouchTime = 0.0;
    return true;
  }
  return false;
}

// command palette を開く
// double tap や空 scene の操作から呼ばれ、表示位置と page 描画は CommandPalette に任せる
function openMobilePalette(kind, clientX, clientY) {
  closeCoordinateOverlay();
  closeObjectInfoOverlay();
  mobileInput.clearTransformAxis();
  commandPalette?.open(kind, clientX, clientY);
}

// scene 上に選択や矩形選択の対象になる頂点があるかを確認する
// empty double tap は通常は矩形選択の準備に使うが、object が全削除された状態では囲む対象がない
// その場合は Load / primitive 追加 / New Scene などを呼び出せる command palette を開く
function hasAnyModelerVertices() {
  const editMesh = getRenderableEditMeshState();
  if (editMesh.vertices.length > 0) {
    return true;
  }
  return editor.objects.some((object) => Array.isArray(object.vertices) && object.vertices.length > 0);
}

// command palette の 4x4 button 表示を現在 page の action に合わせて更新する
// 表示処理の本体は CommandPalette が持ち、main.js 側は状態変更後の再描画入口だけを残す
function renderMobilePalette() {
  commandPalette?.render();
}

// command palette 上で transform 開始前の軸制限 option を切り替える
// transform 開始後に別 UI へ指や mouse を移動すると、tap confirm や preview 変更と競合するため、
// axis は `G/R/S/E/GG` を押す前に palette 上で確定しておく
function setPaletteTransformAxis(axis) {
  mobileInput.toggleTransformAxis(axis);
}

// palette で事前選択した軸制限を、transform session 開始直後の controller へ反映する
function applyPaletteTransformAxisConstraint() {
  const axis = mobileInput.transformAxisConstraint;
  if (axis === "n" && getRenderableEditorMode() !== EDITOR_MODE_EDIT) {
    return;
  }
  if (axis === "x" || axis === "y" || axis === "z" || axis === "n") {
    transformController.setTransformAxis(axis);
  }
}

// mobile の短い tap を記録する
// 次の pointerdown が近い時刻・近い座標・同じ pointerType なら double tap 候補として扱う
// 2 回目 pointerdown の段階で通常 click tracking を始めないための基準値として使う
function rememberMobileCanvasTap(ev) {
  mobileInput.rememberCanvasTap(ev);
}

// 保留中の mobile single tap 選択を破棄する
// double tap、long press、palette 表示、box select 開始が成立した場合、
// 1 回目 tap の選択処理が後から走ると操作対象が変わるため、timer と保存 event を必ず消す
function cancelPendingMobileCanvasTap() {
  mobileInput.cancelPendingTap();
}

// mobile の single tap 選択を double tap 判定時間だけ遅延させる
// 2 回目 tap や long press が来なかった場合だけ、保存した snapshot を handleCanvasClick へ渡して通常選択を確定する
// desktop profile では操作感を変えないため、従来通り即時に handleCanvasClick を呼ぶ
function scheduleMobileCanvasTap(ev) {
  mobileInput.scheduleCanvasTap(ev, handleCanvasClick);
}

function isMobileCanvasDoubleTapCandidate(ev) {
  return mobileInput.isCanvasDoubleTapCandidate(ev);
}

function handleMobileCanvasDoubleTap(ev) {
  mobileInput.handleCanvasDoubleTap(ev, { canvasClick });
}

// リボン flick と同じ pointerup / click で button action が発火すると、
// page 切替と command 実行が同時に起きて操作が読みにくくなる
// flick 確定直後の button activation はここで明示的に抑制する
function shouldSuppressMobileButtonActivation(ev = null) {
  return mobileInput.shouldSuppressMobileButtonActivation(ev);
}

function suppressNextCanvasPointer(pointerId = null, durationMs = 520) {
  mobileInput.suppressNextCanvasPointer(pointerId, durationMs);
}

function shouldSuppressCanvasPointer(ev) {
  return mobileInput.shouldSuppressCanvasPointer(ev);
}

// `inspectGestureTarget`は入力条件や交差状態を比較し、判定結果を返す
function inspectGestureTarget(clientX, clientY) {
  if (!app?.screen?.canvas) {
    return { kind: "empty" };
  }
  const mode = getRenderableEditorMode();
  const tool = getRenderableEditorTool();
  const pick = modelerPicking.pickAtClientPoint(clientX, clientY, {
    includeObjectFace: mode === EDITOR_MODE_OBJECT,
    includeVertex: mode !== EDITOR_MODE_OBJECT && tool === TOOL_SELECT_VERTEX,
    includeSelectableFace: mode !== EDITOR_MODE_OBJECT
  });
  if (mode === EDITOR_MODE_OBJECT) {
    return pick.objectFaceHit ? { kind: "object", ...pick.objectFaceHit } : { kind: "empty" };
  }
  if (tool === TOOL_SELECT_VERTEX) {
    if (pick.vertexHit) {
      return { kind: "vertex", vertexId: pick.vertexHit.vertexId };
    }
  }
  return pick.selectableFaceHit ? { kind: "face", ...pick.selectableFaceHit } : { kind: "empty" };
}

// command palette / ribbon / view button から届く mmodeler command id を dispatcher へ渡す
// 実際の分類は ModelerCommandDispatcher が担当し、main.js 側は event handler からの入口だけを残す
function dispatchModelerCommand(action) {
  if (!modelerCommandDispatcher) {
    throw new Error("ModelerCommandDispatcher is not initialized");
  }
  modelerCommandDispatcher.dispatch(action);
}

// モバイル操作の重ね合わせ表示の`handlers`の初期化段階で、必要な状態と資源を準備して処理を開始する
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
        dispatchModelerCommand(button.dataset.action);
      }
    });
    button.addEventListener("click", (ev) => {
      if (shouldSuppressMobileButtonActivation(ev)) {
        ev.preventDefault();
        return;
      }
      dispatchModelerCommand(button.dataset.action);
    });
  }
  for (const button of ui.mobilePaletteButtons) {
    button.addEventListener("pointerup", (ev) => {
      if (ev.pointerType === "touch") {
        ev.preventDefault();
        if (shouldSuppressMobileButtonActivation(ev)) {
          return;
        }
        dispatchModelerCommand(button.dataset.action);
      }
    });
    button.addEventListener("click", (ev) => {
      if (shouldSuppressMobileButtonActivation(ev)) {
        ev.preventDefault();
        return;
      }
      dispatchModelerCommand(button.dataset.action);
    });
  }
  for (const button of ui.mobileViewButtons) {
    button.addEventListener("pointerup", (ev) => {
      if (ev.pointerType === "touch") {
        ev.preventDefault();
        if (shouldSuppressMobileButtonActivation(ev)) {
          return;
        }
        dispatchModelerCommand(button.dataset.viewAction);
      }
    });
    button.addEventListener("click", (ev) => {
      if (shouldSuppressMobileButtonActivation(ev)) {
        ev.preventDefault();
        return;
      }
      dispatchModelerCommand(button.dataset.viewAction);
    });
  }
  ui.mobileSelectionShift?.addEventListener("pointerup", (ev) => {
    if (ev.pointerType === "touch") {
      ev.preventDefault();
      ev.stopPropagation();
      if (shouldSuppressMobileButtonActivation(ev)) {
        return;
      }
      toggleMobileSelectionShift();
    }
  });
  ui.mobileSelectionShift?.addEventListener("click", (ev) => {
    if (shouldSuppressMobileButtonActivation(ev)) {
      ev.preventDefault();
      return;
    }
    toggleMobileSelectionShift();
  });
}

// モバイル操作の`gesture`の`handlers`の初期化段階で、必要な状態と資源を準備して処理を開始する
function installMobileGestureHandlers() {
  mobileInput.installSurfaceGestures(app?.screen?.canvas, {
    setEditorMode,
    getEditorMode: getRenderableEditorMode,
    editModeName: EDITOR_MODE_EDIT,
    objectModeName: EDITOR_MODE_OBJECT,
    sculptModeName: EDITOR_MODE_SCULPT,
    editModeController
  });
}

// `safari`の`callout`の`guards`の初期化段階で、必要な状態と資源を準備して処理を開始する
function installSafariCalloutGuards() {
  if (!IS_MOBILE_PROFILE || !app?.screen?.canvas) {
    return;
  }
  // `preventDefault`は入力またはイベントを受け取り、対応する処理へ振り分ける
  const preventDefault = (ev) => {
    if (isCoordinateOverlayControl(ev.target)) {
      return;
    }
    ev.preventDefault();
  };
  // `preventDefaultCapture`は入力またはイベントを受け取り、対応する処理へ振り分ける
  const preventDefaultCapture = (ev) => {
    if (isCoordinateOverlayControl(ev.target)) {
      return;
    }
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
    ui.mobileSelectionShift,
    ...ui.mobileViewButtons,
    ...ui.mobilePaletteButtons,
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
    if (isTextEntryTarget(document.activeElement)) {
      return;
    }
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
  const mode = getRenderableEditorMode();
  const editMesh = mode === EDITOR_MODE_SCULPT && activeObject
    ? {
        vertices: activeObject.vertices ?? [],
        faces: activeObject.faces ?? [],
        selectedVertices: new Set(),
        selectedFaces: new Set()
      }
    : getRenderableEditMeshState();
  const faceIds = Array.from(editMesh.selectedFaces).join(", ") || "-";
  const vertexIds = Array.from(editMesh.selectedVertices).join(", ") || "-";
  const tool = getRenderableEditorTool();
  const lines = [
    SAMPLE_NAME,
    `mode=${mode}`,
    `activeObject=${activeObject ? `${activeObject.id}:${activeObject.name}` : "-"}`,
    `objects=${editor.objects.length}`,
    `selectedObjects=${editor.selectedObjectIds.size} [${objectIds}]`,
    `objectWireframe=${viewController.objectWireframe ? "on" : "off"}`,
    `objectSmooth=${viewController.objectSmoothShading ? "on" : "off"}`,
    `tool=${tool}`,
    `vertices=${editMesh.vertices.length} faces=${editMesh.faces.length}`,
    `selectedVertices=${editMesh.selectedVertices.size} [${vertexIds}]`,
    `selectedFaces=${editMesh.selectedFaces.size} [${faceIds}]`,
    `lastVertex=${editModeController.getLastSelectedVertexLabel()}`,
    `meshSelect=${meshName}`,
    `undo=${editor.undoStack.length} redo=${editor.redoStack.length}`,
    `xMirror=${xMirrorEdit ? "on" : "off"}`,
    `background=${viewController.lightBackground ? "light" : "dark"}`,
    `visiblePick=${viewController.visiblePickOnly ? "visible only" : "through"}`,
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
      { label: "V/F", value: `${editMesh.vertices.length}/${editMesh.faces.length}` },
      { label: "Selected", value: `o${editor.selectedObjectIds.size} v${editMesh.selectedVertices.size} f${editMesh.selectedFaces.size}` },
      { label: "Vertex", value: editModeController.getLastSelectedVertexLabel() },
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
  const editMesh = getRenderableEditMeshState();
  const mode = getRenderableEditorMode();
  const tool = getRenderableEditorTool();
  const selectedVertexCount = editMesh.selectedVertices.size;
  const selectedFaceCount = editMesh.selectedFaces.size;
  const editMode = isEditMode();
  for (const button of ui.modeButtons) {
    button.setAttribute("aria-pressed", button.dataset.mode === mode ? "true" : "false");
  }
  for (const button of ui.toolButtons) {
    button.setAttribute("aria-pressed", button.dataset.tool === tool ? "true" : "false");
    button.disabled = !editMode;
  }
  if (ui.objectWireframe) {
    ui.objectWireframe.setAttribute("aria-pressed", viewController.objectWireframe ? "true" : "false");
    ui.objectWireframe.disabled = false;
  }
  if (ui.lightBackground) {
    ui.lightBackground.setAttribute("aria-pressed", viewController.lightBackground ? "true" : "false");
  }
  if (ui.visiblePickOnly) {
    ui.visiblePickOnly.setAttribute("aria-pressed", viewController.visiblePickOnly ? "true" : "false");
  }
  if (ui.xMirrorEdit) {
    ui.xMirrorEdit.setAttribute("aria-pressed", xMirrorEdit ? "true" : "false");
  }
  // DOM control の disabled 状態を null 安全に切り替える
  setDisabled(ui.makeFace, !editMode || (selectedVertexCount !== 3 && selectedVertexCount !== 4));
  // DOM control の disabled 状態を null 安全に切り替える
  setDisabled(ui.flipFaces, !editMode || selectedFaceCount === 0);
  // DOM control の disabled 状態を null 安全に切り替える
  setDisabled(ui.loopCutFaces, !editMode || !editModeController.getSelectedFaceObjects().some((face) => face.indices.length === 4));
  // DOM control の disabled 状態を null 安全に切り替える
  setDisabled(ui.undo, editor.undoStack.length === 0);
  // DOM control の disabled 状態を null 安全に切り替える
  setDisabled(ui.redo, editor.redoStack.length === 0);
  // DOM control の disabled 状態を null 安全に切り替える
  setDisabled(ui.useMesh, !importedAsset || importedMeshes.length === 0);
  // DOM control の disabled 状態を null 安全に切り替える
  setDisabled(ui.saveJson, !hasActiveGeometryForSave());
  // DOM control の disabled 状態を null 安全に切り替える
  setDisabled(ui.saveJsonGz, !hasActiveGeometryForSave());
  // DOM control の disabled 状態を null 安全に切り替える
  setDisabled(ui.saveGlb, !hasActiveGeometryForSave({ requireFaces: true }));
}

// 最後のユーザー向け message を保存し status を更新する
function setMessage(message) {
  editor.setMessage(message);
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

// undo / redo 用に Edit Mode 側の snapshot state を取得する
// EditModeController 未初期化は起動順の破損なので、古い editor field へ黙って戻さず明示的に止める
function createEditMeshSnapshot() {
  if (!editModeController) {
    throw new Error("EditModeController is not initialized");
  }
  return editModeController.createEditMeshSnapshot();
}

// snapshot から Edit Mode 側の state だけを復元する
// object list や active object の接続は restoreSnapshot() 側で済ませてから呼ぶ
function restoreEditMeshSnapshot(snapshot) {
  if (!editModeController) {
    throw new Error("EditModeController is not initialized");
  }
  editModeController.restoreEditMeshSnapshot(snapshot);
}

// undo は scene 全体と Edit Mode session の状態を保存する
// Shape や Node は表示キャッシュなので履歴に入れず、復元後に rebuildScene() で作り直す
function makeSnapshot() {
  // Edit Mode session があれば active object へ明示的に反映してから object list を保存する
  commitActiveObject();
  const editSnapshot = createEditMeshSnapshot();
  return {
    mode: editSnapshot.mode,
    tool: editSnapshot.tool,
    objects: editor.objects.map((object) => ({
      id: object.id,
      name: object.name,
      origin: getObjectOrigin(object),
      rotation: getObjectRotation(object),
      scale: getObjectScale(object),
      vertices: object.vertices.map((vertex) => ({
        id: vertex.id,
        position: [...vertex.position]
      })),
      faces: object.faces.map((face) => ({
        id: face.id,
        indices: [...face.indices]
      })),
      nextVertexId: object.nextVertexId ?? object.vertices.length,
      nextFaceId: object.nextFaceId
    })),
    selectedObjectIds: Array.from(editor.selectedObjectIds),
    activeObjectId: editor.activeObjectId,
    nextObjectId: editor.nextObjectId,
    selectedVertices: editSnapshot.selectedVertices,
    selectedFaces: editSnapshot.selectedFaces,
    lastSelectedVertexId: editSnapshot.lastSelectedVertexId,
    explicitXMirrorVertexPairs: editSnapshot.explicitXMirrorVertexPairs,
    nextVertexId: editSnapshot.nextVertexId,
    nextFaceId: editSnapshot.nextFaceId
  };
}

// snapshot から editor 全体を復元し scene を再構築する
function restoreSnapshot(snapshot) {
  if (Array.isArray(snapshot.objects)) {
    const objects = snapshot.objects.map((object) => ({
      id: object.id,
      name: object.name,
      origin: readVec3(object.origin ?? [0.0, 0.0, 0.0], `snapshot object ${object.id} origin`),
      rotation: getObjectRotation(object),
      scale: getObjectScale(object),
      vertices: object.vertices.map((vertex) => ({
        id: vertex.id,
        position: readVec3(vertex.position, `snapshot object ${object.id} vertex ${vertex.id}`)
      })),
      faces: object.faces.map((face) => ({
        id: face.id,
        indices: [...face.indices]
      })),
      nextVertexId: object.nextVertexId ?? object.vertices.length,
      nextFaceId: object.nextFaceId
    }));
    const activeObjectId = objects.some((object) => object.id === snapshot.activeObjectId)
      ? snapshot.activeObjectId
      : objects[0]?.id ?? null;
    if (activeObjectId !== null) {
      replaceObjectsAndActivate(objects, activeObjectId, {
        selectedObjectIds: snapshot.selectedObjectIds ?? [activeObjectId],
        mode: snapshot.mode ?? EDITOR_MODE_OBJECT
      });
      editor.nextObjectId = snapshot.nextObjectId ?? editor.nextObjectId;
    } else {
      editModeController?.discardEditSession(snapshot.mode ?? EDITOR_MODE_OBJECT);
      editor.objects = [];
      editor.selectedObjectIds = new Set();
      editor.activeObjectId = null;
      editor.nextObjectId = snapshot.nextObjectId ?? DEFAULT_OBJECT_ID;
      editor.clearEditableMesh();
    }
    const active = getActiveObject();
    restoreEditMeshSnapshot({
      mode: snapshot.mode ?? EDITOR_MODE_OBJECT,
      tool: snapshot.tool,
      selectedVertices: snapshot.selectedVertices ?? [],
      selectedFaces: snapshot.selectedFaces ?? [],
      lastSelectedVertexId: snapshot.lastSelectedVertexId ?? null,
      nextVertexId: active?.nextVertexId ?? 0,
      nextFaceId: active?.nextFaceId ?? 1,
      explicitXMirrorVertexPairs: snapshot.explicitXMirrorVertexPairs ?? []
    });
  } else {
    const vertices = snapshot.vertices.map((vertex) => ({
      id: vertex.id,
      position: readVec3(vertex.position, `snapshot vertex ${vertex.id}`)
    }));
    const faces = snapshot.faces.map((face) => ({
      id: face.id,
      indices: [...face.indices]
    }));
    const object = {
      id: DEFAULT_OBJECT_ID,
      name: SAMPLE_NAME,
      origin: [0.0, 0.0, 0.0],
      rotation: [0.0, 0.0, 0.0, 1.0],
      scale: 1.0,
      vertices,
      faces,
      nextVertexId: snapshot.nextVertexId ?? vertices.length,
      nextFaceId: snapshot.nextFaceId
    };
    editor.replaceObjectsAndActivate([object], object.id, {
      selectedObjectIds: [object.id],
      mode: snapshot.mode ?? EDITOR_MODE_OBJECT
    });
    restoreEditMeshSnapshot({
      mode: snapshot.mode ?? EDITOR_MODE_OBJECT,
      tool: snapshot.tool,
      selectedVertices: snapshot.selectedVertices ?? [],
      selectedFaces: snapshot.selectedFaces ?? [],
      lastSelectedVertexId: snapshot.lastSelectedVertexId ?? null,
      nextVertexId: snapshot.nextVertexId ?? vertices.length,
      nextFaceId: snapshot.nextFaceId,
      explicitXMirrorVertexPairs: snapshot.explicitXMirrorVertexPairs ?? []
    });
  }
  editor.markDirty();
  // mesh / selected face / marker の表示をまとめて再構築する
  rebuildScene();
}

// 現在状態を undo stack へ積み、redo stack を破棄する
function pushUndo(label) {
  editor.pushUndoSnapshot(makeSnapshot(), label);
}

// transform preview は開始時に undo を 1 件積み、失敗・cancel・無変更確定ではその 1 件だけを戻す
// undo stack の深さも transaction に含め、別の履歴を誤って取り除かないよう境界を明示する
function beginTransformTransaction(label) {
  const startSnapshot = makeSnapshot();
  const wasDirty = editor.dirty;
  const undoDepth = editor.undoStack.length;
  editor.pushUndoSnapshot(startSnapshot, label);
  return {
    startSnapshot,
    undoDepth,
    wasDirty
  };
}

// transform 開始後に作った preview / extrusion を開始時 snapshot へ戻す
// undo の取り消しとは分け、表示と geometry の巻き戻しが必要な場面だけで呼ぶ
function restoreTransformStartSnapshot(transaction) {
  if (!transaction) {
    return;
  }
  restoreSnapshot(transaction.startSnapshot);
}

// transform 開始時に積んだ undo entry と dirty state を transaction 境界まで戻す
// 変形開始後に失敗した場合や、preview だけで確定しなかった場合に履歴を汚さないための処理
function rollbackTransformTransaction(transaction) {
  if (!transaction) {
    return;
  }
  while (editor.undoStack.length > transaction.undoDepth) {
    editor.undoStack.pop();
  }
  editor.dirty = transaction.wasDirty;
}

// undo stack から前状態を復元し、現在状態を redo stack へ退避する
function undo() {
  if (editor.undoStack.length === 0) {
    // 最後のユーザー向け message を保存し status を更新する
    setMessage("undo stack is empty");
    return;
  }
  editor.pushRedoSnapshot(makeSnapshot());
  const snapshot = editor.popUndoSnapshot();
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
  editor.pushUndoSnapshotForRedo(makeSnapshot());
  const snapshot = editor.popRedoSnapshot();
  // snapshot から editor 全体を復元し scene を再構築する
  restoreSnapshot(snapshot);
  // 最後のユーザー向け message を保存し status を更新する
  setMessage("redo");
}

// ------------------------------------------------------------
// --- information overlays and object geometry helpers
// ------------------------------------------------------------

function formatInfoVec3(values) {
  return values.map((value) => Number(value).toFixed(3)).join(", ");
}

// `info`の距離を現在の入力と状態から求め、呼び出し元へ返す
function formatInfoDistance(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "-";
  }
  const absValue = Math.abs(numeric);
  if (absValue >= 100.0) {
    return numeric.toFixed(1);
  }
  if (absValue >= 10.0) {
    return numeric.toFixed(2);
  }
  return numeric.toFixed(3);
}

// Info overlay では object 情報と一緒に現在 camera の見え方も確認できるようにする
// 焦点距離は status / diagnostics と同じ 35mm full-frame 換算を使い、
// orbit distance は EyeRig の target から camera eye までの距離、
// origin distance は world 原点から現在 eye 位置までの距離として表示する
function getCameraInfoForOverlay() {
  const eyePosition = app?.eye?.getWorldPosition?.() ?? null;
  const cameraDistance = Array.isArray(eyePosition) && eyePosition.length >= 3
    ? Math.hypot(Number(eyePosition[0]), Number(eyePosition[1]), Number(eyePosition[2]))
    : NaN;
  return {
    focalLength: getFocalLengthLabel(),
    orbitDistance: Number(orbit?.orbit?.distance),
    cameraDistance
  };
}

// 座標 overlay の input へ現在の vertex position を反映する
// 表示用の丸めは使わず、入力欄には編集対象の実数値をそのまま入れる
function setCoordinateOverlayValues(vertex) {
  coordinateOverlayMode = "coordinate";
  const labels = ["X", "Y", "Z"];
  for (let i = 0; i < ui.coordinateOverlayLabels.length; i++) {
    ui.coordinateOverlayLabels[i].textContent = labels[i] ?? "";
  }
  for (const field of ui.coordinateOverlayFields) {
    field.type = "number";
    field.inputMode = "decimal";
    field.step = "any";
    field.hidden = false;
  }
  if (ui.coordinateFalloffSelect) {
    ui.coordinateFalloffSelect.hidden = true;
  }
  const axes = ["x", "y", "z"];
  for (let i = 0; i < axes.length; i++) {
    const field = ui.coordinateOverlayFields.find((input) => input.dataset.coordinateAxis === axes[i]);
    if (field) {
      field.value = String(vertex.position[i]);
      field.disabled = false;
    }
  }
}

// `brush`の重ね合わせ表示の`values`を受け取り、現在の設定と後続処理へ反映する
function setBrushOverlayValues() {
  coordinateOverlayMode = "brush";
  const labels = ["Rad", "Str", "Shape"];
  for (let i = 0; i < ui.coordinateOverlayLabels.length; i++) {
    ui.coordinateOverlayLabels[i].textContent = labels[i] ?? "";
  }
  for (const field of ui.coordinateOverlayFields) {
    field.type = "text";
    field.inputMode = "decimal";
    field.step = "any";
    field.hidden = false;
  }
  const options = sculptModeController?.getBrushOptions?.() ?? { radius: 0.1, strength: 0.25, falloff: "sphere" };
  const fields = ui.coordinateOverlayFields;
  const radiusField = fields.find((input) => input.dataset.coordinateAxis === "x");
  const strengthField = fields.find((input) => input.dataset.coordinateAxis === "y");
  const directionField = fields.find((input) => input.dataset.coordinateAxis === "z");
  if (radiusField) {
    radiusField.value = String(options.radius);
    radiusField.disabled = false;
  }
  if (strengthField) {
    strengthField.value = String(Math.abs(options.strength));
    strengthField.disabled = false;
  }
  if (directionField) {
    directionField.hidden = true;
    directionField.disabled = true;
  }
  if (ui.coordinateFalloffSelect) {
    ui.coordinateFalloffSelect.hidden = false;
    ui.coordinateFalloffSelect.disabled = false;
    ui.coordinateFalloffSelect.value = String(options.falloff ?? "sphere");
  }
}

// 座標 overlay の入力欄を無効にする
// 複数選択時に誤って一部の vertex だけを書き換えないよう、表示だけに切り替える
function disableCoordinateOverlayFields() {
  for (const field of ui.coordinateOverlayFields) {
    field.value = "";
    field.disabled = true;
  }
}

// coordinate overlay の入力値を単一選択 vertex へ反映する
// 不正な数値は readFiniteNumber() が例外にし、message に理由を出して geometry は変更しない
function applyCoordinateOverlayInput() {
  if (coordinateOverlayMode === "brush") {
    applyBrushOverlayInput();
    return;
  }
  const vertices = editModeController.getActiveVertexObjects();
  if (vertices.length !== 1) {
    setMessage("select one vertex before editing coordinates");
    return;
  }
  const vertex = vertices[0];
  try {
    const nextPosition = [
      readFiniteNumber(ui.coordinateOverlayFields.find((input) => input.dataset.coordinateAxis === "x")?.value, "coordinate X"),
      readFiniteNumber(ui.coordinateOverlayFields.find((input) => input.dataset.coordinateAxis === "y")?.value, "coordinate Y"),
      readFiniteNumber(ui.coordinateOverlayFields.find((input) => input.dataset.coordinateAxis === "z")?.value, "coordinate Z")
    ];
    if (vertex.position.every((value, index) => value === nextPosition[index])) {
      setMessage(`v${vertex.id} coordinate unchanged`);
      return;
    }
    pushUndo(`edit v${vertex.id} coordinates`);
    vertex.position = nextPosition;
    rebuildScene();
    setCoordinateOverlayValues(vertex);
    setMessage(`updated v${vertex.id} coordinates`);
  } catch (err) {
    console.error(err);
    setMessage(`coordinate edit failed: ${err?.message ?? err}`);
  }
}

// `brush`の重ね合わせ表示の入力を対象の状態または描画設定へ反映する
function applyBrushOverlayInput() {
  if (!sculptModeController) {
    setMessage("sculpt brush is not ready");
    return;
  }
  try {
    const radius = readFiniteNumber(ui.coordinateOverlayFields.find((input) => input.dataset.coordinateAxis === "x")?.value, "brush radius");
    const rawStrength = readFiniteNumber(ui.coordinateOverlayFields.find((input) => input.dataset.coordinateAxis === "y")?.value, "brush strength");
    const falloff = ui.coordinateFalloffSelect?.value ?? sculptModeController.falloffType;
    if (radius <= 0.0) {
      throw new Error("brush radius must be positive");
    }
    const currentSign = sculptModeController.brushStrength < 0.0 ? -1.0 : 1.0;
    const strength = rawStrength < 0.0 ? rawStrength : Math.abs(rawStrength) * currentSign;
    sculptModeController.setBrushOptions({
      radius,
      strength,
      falloff
    });
    setBrushOverlayValues();
    setMessage(`brush radius ${radius} strength ${strength} falloff ${falloff}`);
    updateMobileRibbon();
  } catch (err) {
    console.error(err);
    setMessage(`brush edit failed: ${err?.message ?? err}`);
  }
}

// `bounds`の`info`の`for`の`positions`を入力値から計算し、後続処理で使える結果を返す
function computeBoundsInfoForPositions(positions) {
  if (!Array.isArray(positions) || positions.length === 0) {
    return {
      min: [0.0, 0.0, 0.0],
      max: [0.0, 0.0, 0.0],
      size: [0.0, 0.0, 0.0]
    };
  }
  const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (const position of positions) {
    const p = readVec3(position, "object info position");
    for (let i = 0; i < 3; i++) {
      if (p[i] < min[i]) min[i] = p[i];
      if (p[i] > max[i]) max[i] = p[i];
    }
  }
  return {
    min,
    max,
    size: [
      max[0] - min[0],
      max[1] - min[1],
      max[2] - min[2]
    ]
  };
}

// 現在操作中のオブジェクト情報を返す
function getActiveObjectInfo() {
  const object = getActiveObject();
  if (!object) {
    return null;
  }
  const editMesh = getRenderableEditorMode() === EDITOR_MODE_EDIT
    ? getRenderableEditMeshState()
    : null;
  const vertices = editMesh?.vertices ?? object.vertices ?? [];
  const faces = editMesh?.faces ?? object.faces ?? [];
  const worldPositions = vertices.map((vertex) => localToWorldPosition(object, vertex.position));
  return {
    object,
    bounds: computeBoundsInfoForPositions(worldPositions),
    vertexCount: vertices.length,
    polygonCount: faces.length,
    origin: getObjectOrigin(object)
  };
}

// `showActiveObjectInfo`は必要な画面要素を準備し、表示状態を更新する
function showActiveObjectInfo() {
  const info = getActiveObjectInfo();
  if (!info) {
    setMessage("no active object");
    return;
  }
  closeMobilePalette();
  closeCoordinateOverlay();
  if (ui.objectInfoTitle) {
    ui.objectInfoTitle.textContent = `${info.object.name ?? "Object"} #${info.object.id}`;
  }
  if (ui.objectInfoBounds) {
    ui.objectInfoBounds.textContent = formatInfoVec3(info.bounds.size);
  }
  if (ui.objectInfoVertices) {
    ui.objectInfoVertices.textContent = String(info.vertexCount);
  }
  if (ui.objectInfoPolygons) {
    ui.objectInfoPolygons.textContent = String(info.polygonCount);
  }
  if (ui.objectInfoOrigin) {
    ui.objectInfoOrigin.textContent = formatInfoVec3(info.origin);
  }
  const cameraInfo = getCameraInfoForOverlay();
  if (ui.objectInfoFocalLength) {
    ui.objectInfoFocalLength.textContent = cameraInfo.focalLength;
  }
  if (ui.objectInfoOrbitDistance) {
    ui.objectInfoOrbitDistance.textContent = formatInfoDistance(cameraInfo.orbitDistance);
  }
  if (ui.objectInfoCameraDistance) {
    ui.objectInfoCameraDistance.textContent = formatInfoDistance(cameraInfo.cameraDistance);
  }
  ui.objectInfoOverlay?.classList.add("open");
  setMessage(`object info: ${info.vertexCount} vertices, ${info.polygonCount} polygons`);
}

// command palette の Vcood から、表示と入力を兼ねた座標 overlay を開く
// 最初の実装では単一 vertex の直接編集に限定し、複数選択は情報表示だけにする
function showSelectedVertexCoordinates() {
  if (isSculptMode()) {
    showSculptBrushSettings();
    return;
  }
  if (!isEditMode()) {
    setMessage("switch to edit mode before viewing vertices");
    return;
  }
  const vertices = editModeController.getActiveVertexObjects();
  if (vertices.length === 0) {
    setMessage("select vertices before viewing coordinates");
    return;
  }
  closeMobilePalette();
  closeObjectInfoOverlay();
  const firstVertex = vertices[0];
  const firstPosition = firstVertex.position.map((value) => Number(value).toFixed(3)).join(", ");
  if (ui.coordinateOverlayTitle) {
    ui.coordinateOverlayTitle.textContent = vertices.length === 1
      ? `Vertex v${firstVertex.id}`
      : `${vertices.length} vertices selected`;
  }
  if (ui.coordinateOverlayHint) {
    ui.coordinateOverlayHint.textContent = vertices.length === 1
      ? "Edit X / Y / Z, then Apply"
      : `First: v${firstVertex.id} (${firstPosition}). Select one vertex to edit coordinates.`;
  }
  if (vertices.length === 1) {
    setCoordinateOverlayValues(firstVertex);
  } else {
    disableCoordinateOverlayFields();
  }
  ui.coordinateOverlay?.classList.add("open");
  setMessage(vertices.length === 1 ? `editing v${firstVertex.id} coordinates` : `${vertices.length} vertices selected`);
  if (vertices.length === 1) {
    ui.coordinateOverlayFields[0]?.focus();
    ui.coordinateOverlayFields[0]?.select();
  }
}

// `showSculptBrushSettings`は必要な画面要素を準備し、表示状態を更新する
function showSculptBrushSettings() {
  if (!sculptModeController) {
    setMessage("sculpt brush is not ready");
    return;
  }
  closeMobilePalette();
  closeObjectInfoOverlay();
  setEditorMode(EDITOR_MODE_SCULPT);
  if (ui.coordinateOverlayTitle) {
    ui.coordinateOverlayTitle.textContent = "Sculpt brush";
  }
  if (ui.coordinateOverlayHint) {
    ui.coordinateOverlayHint.textContent = "Edit radius, strength, and falloff shape, then Apply.";
  }
  setBrushOverlayValues();
  ui.coordinateOverlay?.classList.add("open");
  setMessage("editing sculpt brush");
  ui.coordinateOverlayFields[0]?.focus();
  ui.coordinateOverlayFields[0]?.select();
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

// object transform は mesh data とは別の object state として保持する
// editor vertices は object local 座標で保持し、描画 / pick / export 時だけ world と変換する
function getObjectOrigin(object) {
  return readVec3(object?.origin ?? [0.0, 0.0, 0.0], `object ${object?.id ?? "-"} origin`);
}

// オブジェクトの回転を現在の入力と状態から求め、呼び出し元へ返す
function getObjectRotation(object) {
  const rotation = readQuatXyzw(object?.rotation ?? [0.0, 0.0, 0.0, 1.0], `object ${object?.id ?? "-"} rotation`);
  const len = Math.hypot(rotation[0], rotation[1], rotation[2], rotation[3]);
  if (!Number.isFinite(len) || len <= 1.0e-9) {
    throw new Error(`object ${object?.id ?? "-"} rotation must be a non-zero quaternion`);
  }
  return [
    rotation[0] / len,
    rotation[1] / len,
    rotation[2] / len,
    rotation[3] / len
  ];
}

// オブジェクトの倍率を現在の入力と状態から求め、呼び出し元へ返す
function getObjectScale(object) {
  const scale = readFiniteNumber(object?.scale ?? 1.0, `object ${object?.id ?? "-"} scale`);
  if (Math.abs(scale) <= 1.0e-8) {
    throw new Error(`object ${object?.id ?? "-"} scale must be non-zero`);
  }
  return scale;
}

// `quatFromObjectRotation`は座標または数値を計算し、後続処理で使う結果を返す
function quatFromObjectRotation(object) {
  const rotation = getObjectRotation(object);
  const quat = new Quat();
  quat.q = [rotation[3], rotation[0], rotation[1], rotation[2]];
  quat.normalize();
  return quat;
}

// `matrixFromObjectRotation`は座標または数値を計算し、後続処理で使う結果を返す
function matrixFromObjectRotation(object) {
  const matrix = new Matrix();
  matrix.setByQuat(quatFromObjectRotation(object));
  return matrix;
}

// `localToWorldPosition`は座標または数値を計算し、後続処理で使う結果を返す
function localToWorldPosition(object, position) {
  const scale = getObjectScale(object);
  const rotated = matrixFromObjectRotation(object).mul3x3Vector(mul3(readVec3(position, "local position"), scale));
  return add3(rotated, getObjectOrigin(object));
}

// `worldToLocalPosition`は座標または数値を計算し、後続処理で使う結果を返す
function worldToLocalPosition(object, position) {
  const scale = getObjectScale(object);
  const rel = sub3(readVec3(position, "world position"), getObjectOrigin(object));
  const inverse = quatFromObjectRotation(object);
  inverse.conjugate();
  const matrix = new Matrix();
  matrix.setByQuat(inverse);
  return mul3(matrix.mul3x3Vector(rel), 1.0 / scale);
}

// `worldToLocalDirection`は座標または数値を計算し、後続処理で使う結果を返す
function worldToLocalDirection(object, direction) {
  const scale = getObjectScale(object);
  const inverse = quatFromObjectRotation(object);
  inverse.conjugate();
  const matrix = new Matrix();
  matrix.setByQuat(inverse);
  return mul3(matrix.mul3x3Vector(readVec3(direction, "world direction")), 1.0 / scale);
}

// `localToWorldDirection`は座標または数値を計算し、後続処理で使う結果を返す
function localToWorldDirection(object, direction) {
  const scale = getObjectScale(object);
  const matrix = matrixFromObjectRotation(object);
  return matrix.mul3x3Vector(mul3(readVec3(direction, "local direction"), scale));
}

// オブジェクトのワールドの`vertices`を現在の入力と状態から求め、呼び出し元へ返す
function getObjectWorldVertices(object) {
  return (object?.vertices ?? []).map((vertex) => ({
    id: vertex.id,
    position: localToWorldPosition(object, vertex.position)
  }));
}

// オブジェクトのローカルの`ray`を生成し、後続処理で利用できる状態にする
function makeObjectLocalRay(ray, object) {
  if (!object) {
    return ray;
  }
  return {
    ...ray,
    origin: worldToLocalPosition(object, ray.origin),
    dir: worldToLocalDirection(object, ray.dir),
    near: ray.near ? worldToLocalPosition(object, ray.near) : ray.near,
    far: ray.far ? worldToLocalPosition(object, ray.far) : ray.far
  };
}

// ------------------------------------------------------------
// --- ModelAsset and scene rebuild
// ------------------------------------------------------------

// 保存 / export 対象として使う active object geometry を取得する
// Edit Mode 中の内部 session は commit 境界で active object へ反映してから保存対象にする
function getActiveGeometryForSave() {
  commitActiveObject();
  const object = getActiveObject();
  return {
    object,
    vertices: object?.vertices ?? [],
    faces: object?.faces ?? []
  };
}

// 保存できる形状が現在の編集対象に存在するかを返す
function hasActiveGeometryForSave({ requireFaces = false } = {}) {
  const editMesh = getRenderableEditorMode() === EDITOR_MODE_EDIT
    ? getRenderableEditMeshState()
    : null;
  const object = getActiveObject();
  const vertices = editMesh?.vertices ?? object?.vertices ?? [];
  const faces = editMesh?.faces ?? object?.faces ?? [];
  return vertices.length > 0 && (!requireFaces || faces.length > 0);
}

// active object の編集データから保存用 ModelAsset を作る
function buildModelAssetFromEditor() {
  const { object, vertices, faces } = getActiveGeometryForSave();
  return modelerImportExport.createModelAssetFromGeometry({
    vertices,
    faces,
    name: object?.name ?? SAMPLE_NAME,
    origin: getObjectOrigin(object),
    rotation: getObjectRotation(object),
    scale: getObjectScale(object),
    material: MATERIAL.mesh
  });
}

// 選択 face だけの overlay geometry を作る
// 選択状態が mesh material 全体へ混ざらないよう、選択面は別 Shape として重ねる
function buildSelectedFaceAsset() {
  const selectedFaces = editModeController.getSelectedFaceObjects();
  if (selectedFaces.length === 0) {
    return null;
  }
  const positions = [];
  const indices = [];
  let vertexOffset = 0;
  for (const face of selectedFaces) {
    const localLoop = [];
    for (const vertexId of face.indices) {
      const vertex = editModeController.getVertexById(vertexId);
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
    meta: { name: "mmodeler_selection" },
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

// 全 object の mesh Shape を編集データから再構築する
function rebuildMeshShape() {
  // Edit Mode session の変更を active object へ反映し、object list から表示 mesh を再構築する
  commitActiveObject();
  modelerRenderer.rebuildMeshShapes({
    objects: editor.objects,
    selectedObjectIds: editor.selectedObjectIds,
    objectModeActive: getRenderableEditorMode() === EDITOR_MODE_OBJECT,
    objectWireframe: viewController.objectWireframe,
    objectSmoothShading: viewController.objectSmoothShading,
    getObjectOrigin,
    getObjectRotation,
    getObjectScale
  });
}

// Edit Mode の選択 face overlay Shape を再構築する
function rebuildSelectedFaceShape() {
  const editModeActive = isEditMode();
  modelerRenderer.rebuildSelectedFaceShape({
    editModeActive,
    asset: editModeActive ? buildSelectedFaceAsset() : null,
    origin: getObjectOrigin(getActiveObject()),
    rotation: getObjectRotation(getActiveObject()),
    scale: getObjectScale(getActiveObject()),
    shader: selectedFaceShader
  });
}

// 旧 3D marker node を使わないため marker root を空に保つ
function rebuildMarkers() {
  modelerRenderer.rebuildMarkers();
}

// mesh / selected face / marker の表示をまとめて再構築する
function rebuildScene() {
  markEditOverlayGeometryDirty();
  // 全 object の mesh Shape を編集データから再構築する
  rebuildMeshShape();
  // Edit Mode の選択 face overlay Shape を再構築する
  rebuildSelectedFaceShape();
  // 旧 3D marker node を使わないため marker root を空に保つ
  rebuildMarkers();
  // editor / camera / diagnostics の現在状態を DOM status と HUD へ反映する
  updateStatus();
}

// 頂点・面・object geometry が変わらない選択操作では mesh 本体を作り直さない
// 多頂点 model で single tap selection の応答を保つため、選択 face / marker / edge overlay だけ更新する
function refreshSelectionVisuals() {
  markEditOverlayVisualDirty();
  rebuildSelectedFaceShape();
  updateStatus();
}

// ------------------------------------------------------------
// --- edit overlays and viewport projection
// ------------------------------------------------------------

// vertex index から vertex object を直接引ける dense 配列を検証して返す
function buildVertexLookup(vertices = getRenderableEditMeshState().vertices) {
  for (let index = 0; index < vertices.length; index++) {
    if (vertices[index]?.id !== index) {
      throw new Error(`dense vertex invariant broken: vertices[${index}].id is ${vertices[index]?.id}`);
    }
  }
  return vertices;
}

// Edit Mode の overlay / hit test / status が読む mesh state を取得する
// Edit Mode 中は EditModeController の内部 session、Object Mode や初期化中は scene 互換 field を返す
function getRenderableEditMeshState() {
  return editModeController?.getRenderableEditMeshState?.() ?? editor;
}

// mode の読み取り元を renderable edit state に集める
function getRenderableEditorMode() {
  return getRenderableEditMeshState().mode;
}

// tool の読み取り元を renderable edit state に集める
function getRenderableEditorTool() {
  return getRenderableEditMeshState().tool;
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
  const editMesh = getRenderableEditMeshState();
  modelerRenderer.rebuildEdgeOverlayBuffer({
    edgeOverlay,
    edges: getUniqueOverlayEdges(),
    editMesh,
    object: getActiveObject(),
    buildVertexLookup,
    localToWorldPosition,
    getEdgeColor: getOverlayEdgeColor
  });
  overlayEdgeUploadDirty = false;
}

// marker overlay 再投影結果を renderer へ渡す描画 data にまとめる
// active object や edit mesh は renderer へ渡さず、screen-space marker の配列に変換して境界を小さく保つ
function makeMarkerOverlayRenderData(viewProjection, markerRadiusX, markerRadiusY) {
  const markers = [];
  const highlightedVertexIds = editModeController.getHighlightedVertexIds();
  const xMirrorVertexIds = editModeController.getXMirrorSelectedVertexIds();
  const object = getActiveObject();
  const editMesh = getRenderableEditMeshState();
  for (const vertex of editMesh.vertices) {
    const p = projectWorldToNdc(viewProjection, localToWorldPosition(object, vertex.position), getMarkerOverlayZBias());
    if (!p) {
      continue;
    }
    const markerKind = highlightedVertexIds.has(vertex.id)
      ? "selected"
      : xMirrorVertexIds.has(vertex.id)
        ? "mirror"
        : "default";
    markers.push({
      x: p[0],
      y: p[1],
      z: p[2],
      radiusX: markerRadiusX,
      radiusY: markerRadiusY,
      color: getOverlayMarkerColor(markerKind)
    });
  }
  return {
    overlay2d,
    markers
  };
}

// Edit Mode の edge と marker overlay を scene 描画後に重ねる
function drawEditOverlayPass() {
  if (!overlay2d || !isEditMode()) {
    return;
  }
  const viewState = modelerRenderer.makeOverlayViewProjection();
  if (!viewState?.canvas) {
    return;
  }
  const canvas = viewState.canvas;
  const markerRadiusPx = 2.5;
  const markerRadiusX = markerRadiusPx * 2.0 / Math.max(1, canvas.width);
  const markerRadiusY = markerRadiusPx * 2.0 / Math.max(1, canvas.height);
  const cameraKey = makeMarkerOverlayCameraKey(viewState.viewProjectionMatrix, canvas);
  const rebuildMarkers = markerOverlayDirty || markerOverlayCameraKey !== cameraKey;

  modelerRenderer.drawEdgeOverlayLines({
    edgeOverlay,
    viewState,
    zBias: getEdgeOverlayZBias(),
    rebuildBuffer: overlayEdgeUploadDirty,
    rebuild: rebuildEdgeOverlayBuffer
  });

  modelerRenderer.drawMarkerOverlay({
    overlay2d,
    rebuildMarkers,
    markerOverlayRenderData: rebuildMarkers
      ? makeMarkerOverlayRenderData(viewState.viewProjectionMatrix, markerRadiusX, markerRadiusY)
      : null
  });
  if (rebuildMarkers) {
    markerOverlayCameraKey = cameraKey;
    markerOverlayDirty = false;
  }
}

// `sculpt`の`preview`の重ね合わせ表示の処理の描画段階で、必要な描画命令と表示内容を記録する
function drawSculptPreviewOverlayPass() {
  if (!overlay2d || !isSculptMode() || !sculptModeController) {
    return;
  }
  const hit = sculptModeController.cursorHit;
  if (!hit?.screenCenter) {
    return;
  }
  const viewState = modelerRenderer.makeOverlayViewProjection();
  const canvas = viewState?.canvas;
  if (!canvas) {
    return;
  }
  const activeObject = getActiveObject();
  const screenRadius = activeObject && hit.hit === true
    ? computeSculptPreviewRadiusNdc(activeObject, hit, viewState.viewProjectionMatrix, canvas)
    : null;
  const fallbackRadiusPx = 18.0;
  const radiusNdc = screenRadius ?? fallbackRadiusPx * 2.0 / Math.max(1, canvas.width);
  const viewDirection = activeObject
    ? worldToLocalDirection(activeObject, getCameraScreenBasis().forward)
    : [0.0, 0.0, 1.0];
  const rotation = activeObject
    ? computeSculptPreviewRotation(activeObject, hit.normal)
    : 0.0;
  const preview = sculptModeController.getBrushPreview({
    center: hit.screenCenter,
    screenRadius: radiusNdc,
    hit: hit.hit === true,
    normal: hit.normal,
    viewDirection,
    rotation
  });
  if (!preview) {
    return;
  }
  const color = preview.hit
    ? (mobileInput.selectionShiftActive ? [0.0, 0.95, 0.55, 0.28] : [0.1, 0.72, 1.0, 0.22])
    : [0.85, 0.85, 0.85, 0.16];
  overlay2d.clear();
  overlay2d.addMarker(
    preview.center[0],
    preview.center[1],
    0.0,
    preview.majorRadius,
    preview.minorRadius,
    color,
    preview.rotation
  );
  overlay2d.draw();
}

// `sculpt`の`preview`の回転を入力値から計算し、後続処理で使える結果を返す
function computeSculptPreviewRotation(object, localNormal) {
  const basis = getCameraScreenBasis();
  const worldNormal = normalize3(localToWorldDirection(object, localNormal), "sculpt preview normal");
  const projectedX = dot3(worldNormal, basis.right);
  const projectedY = dot3(worldNormal, basis.up);
  if (Math.hypot(projectedX, projectedY) <= 1.0e-5) {
    return 0.0;
  }
  return Math.atan2(projectedY, projectedX) + Math.PI * 0.5;
}

// `sculpt`の`preview`の半径の`ndc`を入力値から計算し、後続処理で使える結果を返す
function computeSculptPreviewRadiusNdc(object, hit, viewProjection, canvas) {
  if (!hit?.center || !hit?.normal || !viewProjection || !canvas) {
    return null;
  }
  const radius = Number(sculptModeController?.brushRadius);
  if (!Number.isFinite(radius) || radius <= 0.0) {
    return null;
  }
  const basis = getCameraScreenBasis();
  const worldNormal = normalize3(localToWorldDirection(object, hit.normal), "sculpt preview normal");
  const normalScreenX = dot3(worldNormal, basis.right);
  const normalScreenY = dot3(worldNormal, basis.up);
  let screenMajorX = -normalScreenY;
  let screenMajorY = normalScreenX;
  if (Math.hypot(screenMajorX, screenMajorY) <= 1.0e-5) {
    screenMajorX = 1.0;
    screenMajorY = 0.0;
  }
  const screenWorldDirection = add3(mul3(basis.right, screenMajorX), mul3(basis.up, screenMajorY));
  let tangent = sub3(screenWorldDirection, mul3(worldNormal, dot3(screenWorldDirection, worldNormal)));
  if (length3(tangent) <= 1.0e-5) {
    tangent = cross3(worldNormal, basis.forward);
  }
  if (length3(tangent) <= 1.0e-5) {
    tangent = cross3(worldNormal, basis.right);
  }
  tangent = normalize3(tangent, "sculpt preview tangent");
  const centerWorld = localToWorldPosition(object, hit.center);
  const edgeWorld = add3(centerWorld, mul3(tangent, Math.abs(getObjectScale(object)) * radius));
  const centerNdc = projectWorldToNdc(viewProjection, centerWorld, 0.0);
  const edgeNdc = projectWorldToNdc(viewProjection, edgeWorld, 0.0);
  if (!centerNdc || !edgeNdc) {
    return null;
  }
  const dxPx = (edgeNdc[0] - centerNdc[0]) * canvas.width * 0.5;
  const dyPx = (edgeNdc[1] - centerNdc[1]) * canvas.height * 0.5;
  const radiusPx = Math.hypot(dxPx, dyPx);
  if (!Number.isFinite(radiusPx) || radiusPx <= 0.0) {
    return null;
  }
  return Math.max(6.0, radiusPx) * 2.0 / Math.max(1, canvas.width);
}

// 床 grid とワールド軸、または編集 preview を line-list overlay として描く
// preview は edit edge と同じ位置に重なることがあるため、描画順を分けて最後に重ねる
function makeGuideOverlayLines({ includeBaseGuides = true, includeEditPreviews = true } = {}) {
  const lines = [];
  const half = 6;
  const divisions = 12;
  const y = -0.012;
  if (includeBaseGuides) {
    for (let z = 0; z <= divisions; z++) {
      const p = -half + (z / divisions) * half * 2.0;
      lines.push({ a: [-half, y, p], b: [half, y, p], color: [0.34, 0.42, 0.48, 0.34] });
    }
    for (let x = 0; x <= divisions; x++) {
      const p = -half + (x / divisions) * half * 2.0;
      lines.push({ a: [p, y, -half], b: [p, y, half], color: [0.34, 0.42, 0.48, 0.34] });
    }
    lines.push({ a: [-half, 0.0, 0.0], b: [half, 0.0, 0.0], color: [0.94, 0.12, 0.10, 0.95] });
    lines.push({ a: [0.0, -half, 0.0], b: [0.0, half, 0.0], color: [0.12, 0.34, 1.0, 0.95] });
    lines.push({ a: [0.0, 0.0, -half], b: [0.0, 0.0, half], color: [0.10, 0.78, 0.22, 0.95] });
  }
  if (!includeEditPreviews) {
    return lines;
  }
  const loopCutGuideLine = editModeController.getLoopCutPreviewGuideLine();
  const activeObject = getActiveObject();
  if (loopCutGuideLine && activeObject) {
    const pa = localToWorldPosition(activeObject, loopCutGuideLine.a);
    const pb = localToWorldPosition(activeObject, loopCutGuideLine.b);
    lines.push({ a: pa, b: pb, color: [0.10, 1.0, 0.24, 1.0] });
  }
  const chainSelectGuideLines = editModeController.getChainSelectPreviewGuideLines();
  if (chainSelectGuideLines.length > 0 && activeObject) {
    for (const guideLine of chainSelectGuideLines) {
      const pa = localToWorldPosition(activeObject, guideLine.a);
      const pb = localToWorldPosition(activeObject, guideLine.b);
      lines.push({ a: pa, b: pb, color: [0.10, 1.0, 0.24, 1.0] });
    }
  }
  return lines;
}

// 床 grid とワールド軸を line-list overlay として描く
// X=赤、Y=青、Z=緑。補助線なので Shape の wireframe ではなく専用線描画を使う。
function drawGuideOverlayPass() {
  const viewState = modelerRenderer.makeOverlayViewProjection();
  modelerRenderer.drawGuideOverlayLines({
    guideOverlay,
    viewState,
    zBias: getGuideOverlayZBias(),
    lines: makeGuideOverlayLines({
      includeBaseGuides: true,
      includeEditPreviews: false
    })
  });
}

// loop cut / Chain Select などの編集 preview は edit edge overlay の後に描く
// Chain Select は既存 edge と完全に重なるため、黒い edit edge に隠れない描画順にする
function drawEditPreviewOverlayPass() {
  const viewState = modelerRenderer.makeOverlayViewProjection();
  modelerRenderer.drawGuideOverlayLines({
    guideOverlay,
    viewState,
    zBias: getGuideOverlayZBias(),
    lines: makeGuideOverlayLines({
      includeBaseGuides: false,
      includeEditPreviews: true
    })
  });
}

// 旧 grid shape が残っている場合だけ取り除く。現在の grid / axis は line-list overlay で描く。
function buildGrid() {
  modelerRenderer.clearGridRoot();
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
  // bounds は object list を読むため、Edit Mode session があれば active object へ反映してから集計する
  commitActiveObject();
  const vertices = editor.objects.length > 0
    ? editor.objects.flatMap((object) => getObjectWorldVertices(object))
    : getRenderableEditMeshState().vertices;
  return computeBoundsForVertices(vertices);
}

// active object だけの bounds を取得する
function getActiveObjectBounds() {
  // active object bounds は committed object data から計算する
  commitActiveObject();
  const object = getActiveObject();
  return computeBoundsForVertices(object ? getObjectWorldVertices(object) : getRenderableEditMeshState().vertices);
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
  if (viewController.objectWireframe) {
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
  // Camera Reverse-Zでは大きいdepthが手前なので、marker biasはNDC depthへ加算する
  return [x, y, Math.max(0.0, Math.min(1.0, z + zBias))];
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
  const editMesh = getRenderableEditMeshState();
  for (const face of editMesh.faces) {
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
  const editMesh = getRenderableEditMeshState();
  if (editMesh.selectedVertices.has(edge.a) && editMesh.selectedVertices.has(edge.b)) {
    return [
      SELECTED_VERTEX_EDGE_COLOR[0],
      SELECTED_VERTEX_EDGE_COLOR[1],
      SELECTED_VERTEX_EDGE_COLOR[2],
      Math.max(overlayAlpha, 0.92)
    ];
  }
  const selectedFace = Array.from(edge.faceIds).some((id) => editMesh.selectedFaces.has(id));
  if (selectedFace) {
    if (viewController.objectWireframe) {
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
  if (viewController.objectWireframe) {
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
  const distance = Math.max(DEFAULT_CAMERA.distance, bounds.size * 2.8);
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
  markMarkerOverlayDirty();
  // 最後のユーザー向け message を保存し status を更新する
  setMessage(`view ${preset.label}`);
  return true;
}

// ------------------------------------------------------------
// --- objects, modes, and edit commands
// ------------------------------------------------------------

// activeObjectId に対応する object を取得する
function getActiveObject() {
  return editor.getActiveObject();
}

// Edit Mode session の mesh を active object へ反映する
// session が無い起動初期や Object Mode では、ModelerScene の互換 edit buffer を commit する
function commitActiveObject() {
  if (getRenderableEditorMode() === EDITOR_MODE_SCULPT) {
    return true;
  }
  if (editModeController) {
    editModeController.commitEditMeshState();
    return;
  }
  editor.commitActiveObject();
}

// 指定 object を active にし、編集配列をその object へ接続する
function activateObject(id, {
  clearEditSelection = true,
  commitCurrent = true
} = {}) {
  return editor.activateObject(id, {
    clearEditSelection,
    commitCurrent
  });
}

// import などで object 一覧を丸ごと差し替えて active object を設定する
function replaceObjectsAndActivate(objects, activeObjectId, {
  selectedObjectIds = [activeObjectId],
  mode = EDITOR_MODE_OBJECT
} = {}) {
  // import / new scene のように editor.objects 全体を差し替える場面では、
  // 差し替え前の activeObjectId が新しい object id と偶然一致することがある
  // その状態で activateObject() を直接呼ぶと、activateObject() 冒頭の
  // commitActiveObject() が古い edit buffer を新しい object へ
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
  const normalizedObjects = objects.map((object) => ({
    ...object,
    origin: readVec3(object.origin ?? [0.0, 0.0, 0.0], `object ${object.id} origin`),
    rotation: getObjectRotation(object),
    scale: getObjectScale(object)
  }));
  editModeController?.discardEditSession(mode);
  editor.replaceObjectsAndActivate(normalizedObjects, activeObjectId, {
    selectedObjectIds,
    mode
  });
}

// 現在 mode が Edit Mode か判定する
function isEditMode() {
  return getRenderableEditorMode() === EDITOR_MODE_EDIT;
}

// 現在 mode が Sculpt Mode か判定する
function isSculptMode() {
  return getRenderableEditorMode() === EDITOR_MODE_SCULPT;
}

// `sculpt`の`brush`の方向を受け取り、現在の設定と後続処理へ反映する
function setSculptBrushDirection(direction) {
  if (!sculptModeController) {
    throw new Error("SculptModeController is not initialized");
  }
  const sign = Number(direction) < 0 ? -1 : 1;
  const current = Number(sculptModeController.brushStrength);
  const magnitude = Number.isFinite(current) && Math.abs(current) > 0.0
    ? Math.abs(current)
    : 0.25;
  sculptModeController.setBrushOptions({
    strength: magnitude * sign
  });
  setEditorMode(EDITOR_MODE_SCULPT);
  setMessage(sign > 0 ? "sculpt brush normal +" : "sculpt brush normal -");
  renderMobilePalette();
}

// `sculpt`の`brush`の`type`を受け取り、現在の設定と後続処理へ反映する
function setSculptBrushType(type) {
  if (!sculptModeController) {
    throw new Error("SculptModeController is not initialized");
  }
  sculptModeController.setBrushOptions({ type });
  setEditorMode(EDITOR_MODE_SCULPT);
  setMessage(`sculpt brush ${type}`);
  renderMobilePalette();
}

// `primitive`のオブジェクトを生成し、後続処理で利用できる状態にする
function buildPrimitiveObject(kind, objectId) {
  return buildModelerPrimitiveObject(kind, objectId, {
    segments: mobileInput.primitiveSegments
  });
}

// Object Mode の object 選択を追加または置換する
function selectObject(id, additive = false) {
  if (!objectModeController) {
    throw new Error("ObjectModeController is not initialized");
  }
  return objectModeController.selectObject(id, additive);
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
  if (getRenderableEditorMode() === normalized) {
    // editor / camera / diagnostics の現在状態を DOM status と HUD へ反映する
    updateStatus();
    return;
  }
  if (editModeController?.getLoopCutPreview().active) {
    setMessage("confirm or cancel loop cut before switching mode");
    return;
  }
  if (editModeController?.getChainSelectPreview().active) {
    setMessage("confirm or cancel Chain Select before switching mode");
    return;
  }
  transformController.cancelTransformMode();
  closeCoordinateOverlay();
  if (sculptModeController?.hasActiveStroke?.()) {
    sculptModeController.cancelStroke();
  }
  if (getRenderableEditorMode() === EDITOR_MODE_SCULPT && normalized !== EDITOR_MODE_SCULPT) {
    mobileInput.selectionShiftActive = false;
    setMobileOrbitEnabled(true);
  }
  if (normalized === EDITOR_MODE_OBJECT) {
    editModeController.exitEditMode();
    // edit selection の vertex / face を空にする
    editModeController.clearSelection();
    editor.selectActiveObjectOnly();
    setMobileOrbitEnabled(true);
  } else if (normalized === EDITOR_MODE_EDIT) {
    // Edit Mode では vertex marker / edge overlay / selected face overlay が主役になる
    // Object Wireframe を残すと通常 mesh が line-list 化され、overlay の見え方と役割が混ざるため解除する
    viewController.disableObjectWireframe();
    if (!getActiveObject() && editor.objects.length > 0) {
      // Object Mode の object 選択を追加または置換する
      selectObject(editor.objects[0].id, false);
    }
    editModeController.enterEditMode({
      object: getActiveObject(),
      tool: TOOL_SELECT_FACE
    });
    setMobileOrbitEnabled(true);
  } else if (normalized === EDITOR_MODE_SCULPT) {
    editModeController.exitEditMode();
    editModeController.clearSelection();
    viewController.disableObjectWireframe();
    if (!getActiveObject() && editor.objects.length > 0) {
      selectObject(editor.objects[0].id, false);
    }
    editor.mode = EDITOR_MODE_SCULPT;
    mobileInput.selectionShiftActive = false;
    setMobileOrbitEnabled(true);
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

// 選択頂点から新しい face を作るときは、現在の視点から見た画面上の並びを使う
// 単に選択順で面を張ると、クリック順しだいで三角形が裏返ったり、
// 四角形の対角線が交差したりするため、selection center を基準に screen right/up へ投影して角度順へ並べる
function orderVertexIdsForFaceFromView(vertexIds) {
  if (!Array.isArray(vertexIds) || (vertexIds.length !== 3 && vertexIds.length !== 4)) {
    throw new Error("orderVertexIdsForFaceFromView requires 3 or 4 vertex ids");
  }
  const vertices = vertexIds.map((id) => {
    const vertex = editModeController.getVertexById(id);
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

  const p0 = editModeController.getVertexById(ordered[0]).position;
  const p1 = editModeController.getVertexById(ordered[1]).position;
  const p2 = editModeController.getVertexById(ordered[2]).position;
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
  const object = buildModelerPrimitiveObject("cube", DEFAULT_OBJECT_ID);
  replaceObjectsAndActivate([object], object.id, {
    selectedObjectIds: [object.id],
    mode: EDITOR_MODE_OBJECT
  });
  editor.resetHistory();
  editor.markClean();
  editor.setMessage("new model");
  // mesh / selected face / marker の表示をまとめて再構築する
  rebuildScene();
  // editor bounds に合わせて orbit camera の target と距離を調整する
  fitCameraToEditor();
}

// Object Mode / Edit Mode に応じた全選択を行う
function selectAllForCurrentMode() {
  transformController.cancelTransformMode();
  cancelLoopCutPreview();
  cancelChainSelectPreview();
  if (getRenderableEditorMode() === EDITOR_MODE_OBJECT) {
    objectModeController.selectAllObjects();
    return;
  }
  editModeController.selectAll();
}

// 現在 mode / tool の単位で選択状態を反転する
// vertex tool では vertex、face tool では face、Object Mode では object を対象にして混在選択を避ける
function invertSelectionForCurrentMode() {
  transformController.cancelTransformMode();
  cancelLoopCutPreview();
  cancelChainSelectPreview();
  if (getRenderableEditorMode() === EDITOR_MODE_OBJECT) {
    objectModeController.invertObjectSelection();
    return;
  }
  editModeController.invertSelection();
}

// X<0 側の要素を現在 mode / tool に合わせて選択する
// X mirror 編集で左側だけをまとめて選びたい場面を想定し、自動補正せず X 座標の符号だけで判定する
function selectXNegativeForCurrentMode() {
  transformController.cancelTransformMode();
  cancelLoopCutPreview();
  cancelChainSelectPreview();
  if (getRenderableEditorMode() === EDITOR_MODE_OBJECT) {
    objectModeController.selectXNegativeObjects();
    return;
  }
  editModeController.selectXNegative();
}

// 現在 mode に応じて object または edit selection を削除する
function deleteSelected() {
  if (getRenderableEditorMode() === EDITOR_MODE_OBJECT) {
    objectModeController.deleteSelectedObjects();
    return;
  }
  editModeController.deleteSelected();
}

// mesh 本体を Wireframe shader に切り替える
// Edit Mode でも object 全体の面ループを Shape.setWireframe() で表示し、edge overlay や選択 marker と併用する
function toggleObjectWireframe() {
  viewController.runToggleObjectWireframeCommand();
}

// viewport の clear color を暗色 / 明るいグレーで切り替える
// app.clearColor と Screen 側の実際の clear color を同時に更新し、次 frame から背景へ反映する
function applyBackgroundColor() {
  const color = viewController.lightBackground ? BACKGROUND_LIGHT_COLOR : BACKGROUND_DARK_COLOR;
  if (app) {
    app.clearColor = [...color];
    app.screen?.setClearColor?.(app.clearColor);
  }
}

function toggleLightBackground() {
  viewController.runToggleLightBackgroundCommand();
}

// Edit Mode のクリック / 矩形選択で、手前から見える要素だけを選ぶか切り替える
function toggleVisiblePickOnly() {
  viewController.runToggleVisiblePickOnlyCommand();
}

// loop cut の方向選択 preview を終了する
// 確定時だけでなく、選択変更や Esc でも表示を消せるよう状態を 1 箇所で戻す
function cancelLoopCutPreview(message = "") {
  const canceled = editModeController.cancelLoopCutPreview();
  if (!canceled) {
    return false;
  }
  if (message) {
    setMessage(message);
  }
  return true;
}

// preview 中の pointer 位置から、選択 face のどの辺が最も近いかを求める
// 画面上の距離で選ぶことで、透視投影や正射影の違いを気にせず直感的に切り替えられる
function updateLoopCutPreviewFromPointer(clientX, clientY) {
  const loopCutPreview = editModeController.getLoopCutPreview();
  if (!loopCutPreview.active) {
    return false;
  }
  const face = editModeController.getFaceById(loopCutPreview.faceId);
  const object = getActiveObject();
  const viewProjection = getCurrentViewProjectionMatrix();
  if (!face || face.indices.length !== 4 || !object || !viewProjection) {
    cancelLoopCutPreview("loop cut preview canceled");
    return false;
  }
  const screenEdges = [];
  for (let i = 0; i < 4; i++) {
    const a = editModeController.getVertexById(face.indices[i]);
    const b = editModeController.getVertexById(face.indices[(i + 1) % 4]);
    if (!a || !b) {
      continue;
    }
    const pa = projectWorldToClient(viewProjection, localToWorldPosition(object, a.position));
    const pb = projectWorldToClient(viewProjection, localToWorldPosition(object, b.position));
    if (!pa || !pb) {
      continue;
    }
    screenEdges.push({ edgeIndex: i, a: pa, b: pb });
  }
  return editModeController.updateLoopCutPreviewEdgeFromScreenEdges(clientX, clientY, screenEdges);
}

// Chain Select preview を終了する
// preview 中は通常の tap selection を行わないため、確定または cancel の入口を明示しておく
function cancelChainSelectPreview(message = "") {
  const canceled = editModeController.cancelChainSelectPreview();
  if (!canceled) {
    return false;
  }
  if (message) {
    setMessage(message);
  }
  return true;
}

// Chain Select の方向候補を screen 座標へ投影し、pointer に近い方向を preview として選ぶ
// seed vertex は edit session 側の頂点を使い、active object 側の古い mesh を参照しない
function updateChainSelectPreviewFromPointer(clientX, clientY) {
  const preview = editModeController.getChainSelectPreview();
  if (!preview.active) {
    return false;
  }
  const seed = editModeController.getVertexById(preview.seedVertexId);
  const object = getActiveObject();
  const viewProjection = getCurrentViewProjectionMatrix();
  if (!seed || !object || !viewProjection) {
    cancelChainSelectPreview("Chain Select preview canceled");
    return false;
  }
  const seedPoint = projectWorldToClient(viewProjection, localToWorldPosition(object, seed.position));
  if (!seedPoint) {
    return false;
  }
  const directions = [];
  for (const neighborId of editModeController.buildNeighborIdsByVertexId().get(seed.id) ?? []) {
    const neighbor = editModeController.getVertexById(neighborId);
    if (!neighbor) {
      continue;
    }
    const neighborPoint = projectWorldToClient(viewProjection, localToWorldPosition(object, neighbor.position));
    if (!neighborPoint) {
      continue;
    }
    directions.push({
      neighborId,
      seed: seedPoint,
      neighbor: neighborPoint
    });
  }
  return editModeController.updateChainSelectPreviewFromScreenDirections(clientX, clientY, directions);
}

// ------------------------------------------------------------
// --- picking and rectangle selection
// ------------------------------------------------------------

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

// Shift が押されているかを見て追加選択か判定する
function isAdditiveSelectionEvent(ev) {
  return ev.shiftKey === true || app.input.has("shift") || mobileInput.selectionShiftActive;
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

// `clientToNdc`は座標または数値を計算し、後続処理で使う結果を返す
function clientToNdc(clientX, clientY) {
  const rect = app.screen.canvas.getBoundingClientRect();
  return {
    x: ((clientX - rect.left) / Math.max(1, rect.width)) * 2.0 - 1.0,
    y: 1.0 - ((clientY - rect.top) / Math.max(1, rect.height)) * 2.0
  };
}

function getObjectFaceById(object, faceId) {
  return object?.faces?.find((face) => face.id === faceId) ?? null;
}

// オブジェクトの`face`の法線を入力値から計算し、後続処理で使える結果を返す
function computeObjectFaceNormal(object, faceId, fallback = [0.0, 0.0, 1.0]) {
  const face = getObjectFaceById(object, faceId);
  const lookup = buildVertexLookup(object?.vertices ?? []);
  const ids = face?.indices ?? [];
  if (ids.length < 3) {
    return [...fallback];
  }
  const a = lookup[ids[0]]?.position;
  for (let i = 1; i + 1 < ids.length; i += 1) {
    const b = lookup[ids[i]]?.position;
    const c = lookup[ids[i + 1]]?.position;
    if (!a || !b || !c) {
      continue;
    }
    const n = cross3(sub3(b, a), sub3(c, a));
    if (length3(n) > 1.0e-9) {
      return normalize3(n);
    }
  }
  return [...fallback];
}

// `pickSculptSurfaceAtClient`は現在状態から対象を選択し、結果を返すまたは選択を切り替える
function pickSculptSurfaceAtClient(clientX, clientY) {
  const object = getActiveObject();
  if (!object || !modelerPicking) {
    return null;
  }
  const pick = modelerPicking.pickAtClientPoint(clientX, clientY, {
    includeActiveFace: true
  });
  const hit = pick.activeFaceHit;
  if (!hit) {
    return null;
  }
  return {
    object,
    point: hit.point,
    normal: computeObjectFaceNormal(object, hit.faceId),
    faceId: hit.faceId
  };
}

// ローカルのカメラの`basis`の`for`のオブジェクトを現在の入力と状態から求め、呼び出し元へ返す
function getLocalCameraBasisForObject(object) {
  const basis = getCameraScreenBasis();
  return {
    right: worldToLocalDirection(object, basis.right),
    up: worldToLocalDirection(object, basis.up),
    forward: worldToLocalDirection(object, basis.forward)
  };
}

// ポインターの位置から彫刻ブラシのプレビューを更新する
function updateSculptPreviewFromPointer(clientX, clientY) {
  if (!isSculptMode() || !sculptModeController) {
    return false;
  }
  const hit = pickSculptSurfaceAtClient(clientX, clientY);
  const ndc = clientToNdc(clientX, clientY);
  if (!hit) {
    sculptModeController.cursorHit = {
      center: null,
      normal: [0.0, 0.0, 1.0],
      hit: false,
      screenCenter: [ndc.x, ndc.y]
    };
    return false;
  }
  sculptModeController.cursorHit = {
    center: [...hit.point],
    normal: [...hit.normal],
    hit: true,
    screenCenter: [ndc.x, ndc.y]
  };
  return true;
}

// `beginSculptStrokeFromPointer`は処理周期の開始または終了に必要な状態を更新する
function beginSculptStrokeFromPointer(ev) {
  if (!isSculptMode() || !mobileInput.selectionShiftActive || !sculptModeController) {
    return false;
  }
  const hit = pickSculptSurfaceAtClient(ev.clientX, ev.clientY);
  updateSculptPreviewFromPointer(ev.clientX, ev.clientY);
  if (!hit) {
    setMessage("sculpt: no surface");
    return false;
  }
  const ndc = clientToNdc(ev.clientX, ev.clientY);
  pushUndo("sculpt stroke");
  const started = sculptModeController.beginStroke({
    object: hit.object,
    center: hit.point,
    normal: hit.normal,
    hit: true,
    xMirror: xMirrorEdit,
    screenCenter: [ndc.x, ndc.y],
    viewBasis: getLocalCameraBasisForObject(hit.object)
  });
  if (started) {
    setMobileOrbitEnabled(false);
    canvasClick.active = false;
  }
  return started;
}

// ポインターの入力を彫刻の一筆へ反映する
function applySculptStrokeFromPointer(ev) {
  if (!sculptModeController?.hasActiveStroke?.()) {
    return false;
  }
  const hit = pickSculptSurfaceAtClient(ev.clientX, ev.clientY);
  updateSculptPreviewFromPointer(ev.clientX, ev.clientY);
  const brushType = sculptModeController.getBrushOptions?.().type ?? "draw";
  if (!hit) {
    if (brushType !== "grab") {
      return false;
    }
    const ndc = clientToNdc(ev.clientX, ev.clientY);
    sculptModeController.applyStrokeSample({
      hit: false,
      xMirror: xMirrorEdit,
      screenCenter: [ndc.x, ndc.y]
    });
    return true;
  }
  const ndc = clientToNdc(ev.clientX, ev.clientY);
  sculptModeController.applyStrokeSample({
    object: hit.object,
    center: hit.point,
    normal: hit.normal,
    hit: true,
    xMirror: xMirrorEdit,
    screenCenter: [ndc.x, ndc.y],
    viewBasis: getLocalCameraBasisForObject(hit.object)
  });
  return true;
}

// `endSculptStrokeFromPointer`は処理周期の開始または終了に必要な状態を更新する
function endSculptStrokeFromPointer() {
  if (!sculptModeController?.hasActiveStroke?.()) {
    return false;
  }
  sculptModeController.endStroke();
  if (isSculptMode()) {
    setMobileOrbitEnabled(!mobileInput.selectionShiftActive);
  }
  rebuildScene();
  return true;
}

// 左クリックを mode / tool に応じた選択または頂点追加として処理する
function handleCanvasClick(ev) {
  const mode = getRenderableEditorMode();
  if (mode === EDITOR_MODE_SCULPT) {
    updateSculptPreviewFromPointer(ev.clientX, ev.clientY);
    return;
  }
  const tool = getRenderableEditorTool();
  const pick = modelerPicking.pickAtClientPoint(ev.clientX, ev.clientY, {
    includeObjectFace: mode === EDITOR_MODE_OBJECT,
    includeActiveFace: mode !== EDITOR_MODE_OBJECT && tool === TOOL_ADD_VERTEX,
    includeVertex: mode !== EDITOR_MODE_OBJECT && tool === TOOL_SELECT_VERTEX,
    includeSelectableFace: mode !== EDITOR_MODE_OBJECT && tool === TOOL_SELECT_FACE
  });
  const ray = pick.ray;

  if (mode === EDITOR_MODE_OBJECT) {
    const faceHit = pick.objectFaceHit;
    if (faceHit && objectModeController.selectObjectFromPick(faceHit.objectId, isAdditiveSelectionEvent(ev))) {
      return;
    }
    if (!isAdditiveSelectionEvent(ev)) {
      objectModeController.clearObjectSelectionFromPick();
    }
    return;
  }

  if (tool === TOOL_ADD_VERTEX) {
    const localRay = makeObjectLocalRay(ray, getActiveObject());
    const faceHit = pick.activeFaceHit;
    const planeHit = faceHit?.point
      ?? intersectRayPlane(localRay, [0.0, 0.0, 0.0], [0.0, 1.0, 0.0])
      ?? intersectRayPlane(
        localRay,
        worldToLocalPosition(getActiveObject(), orbit.orbit.target),
        worldToLocalDirection(getActiveObject(), getCameraScreenBasis().forward)
      );
    if (!planeHit) {
      // 最後のユーザー向け message を保存し status を更新する
      setMessage("could not place vertex from this view");
      ev.preventDefault();
      return;
    }
    editModeController.addVertexFromPick(planeHit, isAdditiveSelectionEvent(ev));
    return;
  }

  const marker = tool === TOOL_SELECT_VERTEX ? pick.vertexHit : null;
  if (tool === TOOL_SELECT_VERTEX && marker) {
    editModeController.selectVertexFromPick(marker.vertexId, isAdditiveSelectionEvent(ev));
    return;
  }

  if (tool === TOOL_SELECT_FACE) {
    const faceHit = pick.selectableFaceHit;
    if (faceHit) {
      editModeController.selectFaceFromPick(faceHit.faceId, isAdditiveSelectionEvent(ev));
      return;
    }
  }

  if (!isAdditiveSelectionEvent(ev)) {
    editModeController.clearSelectionFromPick();
  }
}

// 左クリック / 矩形選択 tracking 状態を初期化する
// mobile の box select preview 待ちでは、pointercancel や tap confirm の微小 move で
// 確認用の矩形が消えないよう、session が残っている間は preview 表示を保持する
function resetCanvasClick({ forceHidePreview = false } = {}) {
  canvasClick.active = false;
  canvasClick.pointerId = null;
  if (forceHidePreview || !boxSelectSession?.isAwaitingConfirm) {
    // 矩形選択表示を非表示にする
    boxSelectSession?.hideRect();
  }
}

// ドラッグ開始点と現在点から矩形選択 DOM の位置と大きさを更新する
function updateSelectionRectElement() {
  const dragRect = makeClientRect(
    canvasClick.startX,
    canvasClick.startY,
    canvasClick.lastX,
    canvasClick.lastY
  );
  boxSelectSession?.showRect(dragRect);
}

// 現在の左ドラッグが矩形選択表示を出す距離に達したか判定する
function shouldShowSelectionRect() {
  if (!canvasClick.active) {
    return false;
  }
  if (!canvasClick.allowRectangle) {
    return false;
  }
  if (getRenderableEditorMode() === EDITOR_MODE_EDIT && getRenderableEditorTool() === TOOL_ADD_VERTEX) {
    return false;
  }
  if (getRenderableEditorMode() === EDITOR_MODE_SCULPT) {
    return false;
  }
  const distance = Math.hypot(canvasClick.lastX - canvasClick.startX, canvasClick.lastY - canvasClick.startY);
  return distance > 4.0;
}

// mobile の矩形選択 preview を tap で確定する
// 確定できた場合は mobile の armed 状態も解除し、通常 camera 操作へ戻す
function confirmBoxSelectPreview() {
  return mobileInput.confirmBoxSelectPreview({ resetCanvasClick });
}

// 現在 mode / tool に応じて client 矩形内の object / vertex / face を選択する
function selectByClientRect(rect, additive = false) {
  const viewProjection = getCurrentViewProjectionMatrix();
  resetVisiblePickStats("box");
  const mode = getRenderableEditorMode();
  const tool = getRenderableEditorTool();
  if (mode === EDITOR_MODE_OBJECT) {
    // Object Mode selection は object list を読むため、先に Edit Mode session を active object へ反映する
    commitActiveObject();
    const { selectedIds } = modelerPicking.collectObjectRectCandidates(rect, viewProjection);
    return objectModeController.selectObjectsByIdsFromBox(selectedIds, additive);
  }

  if (tool === TOOL_SELECT_VERTEX) {
    const { candidateCount, selectedIds, context, mode: pickMode } = modelerPicking.collectVertexRectCandidates(rect, viewProjection);
    setVisiblePickSelectionStats(pickMode ?? "box-vertex", candidateCount, selectedIds.length, context);
    return editModeController.selectVerticesByIdsFromBox(selectedIds, additive);
  }

  if (tool === TOOL_SELECT_FACE) {
    const { candidateCount, selectedIds, context, mode: pickMode } = modelerPicking.collectFaceRectCandidates(rect, viewProjection);
    setVisiblePickSelectionStats(pickMode ?? "box-face", candidateCount, selectedIds.length, context);
    return editModeController.selectFacesByIdsFromBox(selectedIds, additive);
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
  if (commandPalette?.isOpen) {
    closeMobilePalette();
  }
  if (ev.button !== 0) {
    // 左クリック / 矩形選択 tracking 状態を初期化する
    resetCanvasClick();
    return;
  }
  if (beginSculptStrokeFromPointer(ev)) {
    ev.preventDefault();
    return;
  }
  if (isSculptMode()) {
    updateSculptPreviewFromPointer(ev.clientX, ev.clientY);
  }
  if (isMobileCanvasDoubleTapCandidate(ev)) {
    // empty/object の判定が重い場合でも、1 回目 tap の選択 timer が先に走らないよう先に破棄する
    cancelPendingMobileCanvasTap();
  }
  updateLoopCutPreviewFromPointer(ev.clientX, ev.clientY);
  updateChainSelectPreviewFromPointer(ev.clientX, ev.clientY);
  // 編集用の pick は pointerdown では実行しない
  // pointerdown の時点で scene を再生成すると、短いクリックと選択後の drag 操作を区別しにくい
  // 編集操作は左クリックの pointerup で確定し、中ボタン camera 操作とは入力ボタンで分ける
  canvasClick.active = true;
  canvasClick.pointerId = ev.pointerId;
  canvasClick.startX = ev.clientX;
  canvasClick.startY = ev.clientY;
  canvasClick.lastX = ev.clientX;
  canvasClick.lastY = ev.clientY;
  canvasClick.additive = mobileInput.boxSelectArmed ? true : isAdditiveSelectionEvent(ev);
  // mobile profile では通常時の左ドラッグを orbit camera に使うため、
  // 矩形選択は empty double tap で boxSelectArmed になった後だけ許可する
  canvasClick.allowRectangle = mobileInput.boxSelectArmed ? true : (!IS_MOBILE_PROFILE && isPlainLeftDragSelectionEvent(ev));
}

// 左ドラッグ中の位置更新と矩形表示更新を行う
function handleCanvasPointerMove(ev) {
  // DebugDock 用に直近の raw pointer / mouse event 情報を記録する
  updateRawInputDebug("canvas", ev);
  if (applySculptStrokeFromPointer(ev)) {
    ev.preventDefault();
    return;
  }
  if (isSculptMode()) {
    updateSculptPreviewFromPointer(ev.clientX, ev.clientY);
  }
  updateLoopCutPreviewFromPointer(ev.clientX, ev.clientY);
  updateChainSelectPreviewFromPointer(ev.clientX, ev.clientY);
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
  } else if (!boxSelectSession?.isAwaitingConfirm) {
    // 矩形選択表示を非表示にする
    boxSelectSession?.hideRect();
  }
}

// 左クリック終了時に短クリック選択または矩形選択を実行する
function handleCanvasPointerUp(ev) {
  // DebugDock 用に直近の raw pointer / mouse event 情報を記録する
  updateRawInputDebug("canvas", ev);
  if (shouldSuppressCanvasPointer(ev)) {
    ev.preventDefault();
    resetCanvasClick();
    mobileInput.clearCanvasSuppression();
    return;
  }
  if (endSculptStrokeFromPointer()) {
    ev.preventDefault();
    resetCanvasClick();
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
  const loopCutPreviewActive = editModeController.getLoopCutPreview().active;
  const chainSelectPreviewActive = editModeController.getChainSelectPreview().active;
  if (!loopCutPreviewActive || moveDistance > 4.0) {
    updateLoopCutPreviewFromPointer(ev.clientX, ev.clientY);
  }
  if (!chainSelectPreviewActive || moveDistance > 4.0) {
    updateChainSelectPreviewFromPointer(ev.clientX, ev.clientY);
  }
  if (moveDistance > 4.0) {
    if (allowRectangle && !(getRenderableEditorMode() === EDITOR_MODE_EDIT && getRenderableEditorTool() === TOOL_ADD_VERTEX)) {
      if (IS_MOBILE_PROFILE && mobileInput.boxSelectArmed) {
        // mobile では pointerup を確定にせず、指で隠れていた終点を確認できる preview として保持する
        boxSelectSession?.holdPreview(dragRect, additive);
      } else {
        // desktop では従来通り drag 終了時点で矩形内の object / vertex / face を選択する
        selectByClientRect(dragRect, additive);
      }
      ev.preventDefault();
    }
    return;
  }
  if (IS_MOBILE_PROFILE && isMobileCanvasDoubleTapCandidate(ev)) {
    handleMobileCanvasDoubleTap(ev);
    ev.preventDefault();
    return;
  }
  if (editModeController.confirmLoopCutPreview()) {
    ev.preventDefault();
    return;
  }
  if (editModeController.confirmChainSelectPreview()) {
    ev.preventDefault();
    return;
  }
  if (confirmBoxSelectPreview()) {
    ev.preventDefault();
    return;
  }
  if (mobileInput.boxSelectArmed) {
    // empty double tap 直後に pointer を離しただけなら、box select 準備を維持する
    // preview 作成後の短い tap は confirmBoxSelectPreview() で確定済みなので、
    // ここではまだ矩形が存在しない準備状態だけを維持する
    setMessage("box select armed: drag to add selection");
    ev.preventDefault();
    return;
  }
  if (IS_MOBILE_PROFILE && moveDistance <= 4.0) {
    rememberMobileCanvasTap(ev);
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
// --- keyboard handlers
// ------------------------------------------------------------

// transform を開始し、palette で事前選択した軸制限と mobile palette 表示を同期する
function setTransformMode(mode) {
  const started = transformController.setTransformMode(mode);
  if (started) {
    applyPaletteTransformAxisConstraint();
    closeMobilePalette();
  }
  return started;
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
    else if (plainKey && key === "4") editModeController.setTool(TOOL_SELECT_VERTEX);
    else if (plainKey && key === "2") editModeController.setTool(TOOL_SELECT_FACE);
    else if (plainKey && key === "5") editModeController.setTool(TOOL_ADD_VERTEX);
    else if (plainKey && key === "a") selectAllForCurrentMode();
    else if (plainKey && key === "g") setTransformMode("move");
    else if (plainKey && key === "r") setTransformMode("rotate");
    else if (plainKey && key === "s") setTransformMode("scale");
    else if (plainKey && key === "e") setTransformMode("extrude");
    else if (plainKey && transformController?.state?.active && (key === "x" || key === "y" || key === "z")) transformController.setTransformAxis(key);
    else if (plainKey && key === "c") editModeController.runLoopCutCommand();
    else if (plainKey && key === "j") editModeController.moveSelectionByScreenKeys(-1.0, 0.0);
    else if (plainKey && key === "l") editModeController.moveSelectionByScreenKeys(1.0, 0.0);
    else if (plainKey && key === "i") editModeController.moveSelectionByScreenKeys(0.0, 1.0);
    else if (plainKey && key === "k") editModeController.moveSelectionByScreenKeys(0.0, -1.0);
    else if (plainKey && key === "u") editModeController.moveSelectionByNormalKey(-1.0);
    else if (plainKey && key === "o") editModeController.moveSelectionByNormalKey(1.0);
    else if (plainKey && key === "n") editModeController.scaleSelectionByKeyboard(0.92);
    else if (plainKey && key === "m") editModeController.scaleSelectionByKeyboard(1.08);
    else if (plainKey && key === "f") editModeController.makeFaceFromSelection();
    else if (plainKey && key === "p") toggleProjectionMode();
    else if (plainKey && key === "v") cycleViewAnglePreset(ev.shiftKey ? -1 : 1);
    else if (plainKey && key === "w") toggleObjectWireframe();
    else if (plainKey && key === "x") deleteSelected();
    else if (key === "delete" || key === "backspace") deleteSelected();
    else if (key === "z" && (ev.metaKey || ev.ctrlKey)) undo();
    else if ((key === "y" && (ev.metaKey || ev.ctrlKey)) || (key === "z" && ev.shiftKey && (ev.metaKey || ev.ctrlKey))) redo();
    else if (key === "escape" && transformController.cancelTransformMode()) {
      // transform cancel handled above
    }
    else if (key === "escape" && cancelLoopCutPreview("loop cut preview canceled")) {
      // loop cut preview cancel handled above
    }
    else if (key === "escape" && cancelChainSelectPreview("Chain Select preview canceled")) {
      // Chain Select preview cancel handled above
    }
    else if (key === "escape") {
      // edit selection の vertex / face を空にする
      editModeController.clearSelection();
      // 選択だけの変更なので mesh 本体は再生成せず overlay だけ更新する
      refreshSelectionVisuals();
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

// import 候補 entry を mesh select UI へ反映する
function populateMeshSelect(asset) {
  importedMeshes = modelerImportExport.makeImportEntries(asset);
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
  const fileLabel = String(file.name ?? "(unknown)");
  // 最後のユーザー向け message を保存し status を更新する
  setMessage(`loading ${fileLabel}`);
  await waitForStatusPaint();
  const loaded = await modelerImportExport.loadModelAssetFile(file, {
    loadModel: (url, options) => app.loadModel(url, options),
    onStage: async (stage, context) => {
      // iPhone Safari で .json.gz 読み込みが固まる場合に備え、どの段階で止まるか見えるよう段階表示する
      setMessage(`loading ${context.fileLabel}: ${stage}`);
      await waitForStatusPaint();
    }
  });
  const asset = loaded.asset;
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
  const object = modelerImportExport.buildEditorObjectFromImportEntry(entry, DEFAULT_OBJECT_ID);
  // 現在状態を undo stack へ積み、redo stack を破棄する
  pushUndo("import mesh");
  // import などで object 一覧を丸ごと差し替えて active object を設定する
  replaceObjectsAndActivate([object], object.id);
  // 外部 asset の polygonLoops / indices は exporter が決めた面順を正として扱う
  // 原点基準の自動補正を import 直後に掛けると、複数 object や原点外の部品で正しい winding を反転し得る
  commitActiveObject();
  editor.resetHistory();
  editor.markClean();
  // mesh / selected face / marker の表示をまとめて再構築する
  rebuildScene();
  // editor bounds に合わせて orbit camera の target と距離を調整する
  fitCameraToEditor();
  // 最後のユーザー向け message を保存し status を更新する
  setMessage(`imported ${entry.label}`);
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
  const objects = importedMeshes.map((entry, index) => modelerImportExport.buildEditorObjectFromImportEntry(entry, DEFAULT_OBJECT_ID + index));
  // import などで object 一覧を丸ごと差し替えて active object を設定する
  replaceObjectsAndActivate(objects, objects[0].id);
  for (const object of objects) {
    // 指定 object を active にし、編集配列をその object へ接続する
    activateObject(object.id);
    // 外部 asset の面順は object ごとに保存対象へそのまま反映する
    // 編集中に新規 face を作る場合の orientation 補助とは分けて考える
    commitActiveObject();
  }
  // 指定 object を active にし、編集配列をその object へ接続する
  activateObject(objects[0].id);
  editor.resetHistory();
  editor.markClean();
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
  const filename = modelerImportExport.saveModelAssetJson(asset);
  lastSavedName = filename;
  editor.markClean();
  // 最後のユーザー向け message を保存し status を更新する
  setMessage(`saved ${filename}`);
}

// active object を gzip 圧縮済み ModelAsset JSON として保存する
async function saveModelAssetJsonGz() {
  const asset = buildModelAssetFromEditor();
  const filename = await modelerImportExport.saveModelAssetJsonGz(asset);
  lastSavedName = filename;
  editor.markClean();
  // 最後のユーザー向け message を保存し status を更新する
  setMessage(`saved ${filename}`);
}

// active object を GLB file として保存する
function saveGlb() {
  const { object, vertices, faces } = getActiveGeometryForSave();
  const filename = modelerImportExport.saveGlbFromGeometry({
    vertices,
    faces,
    materialColor: MATERIAL.mesh.color,
    nodeTranslation: getObjectOrigin(object),
    nodeRotation: getObjectRotation(object),
    nodeScale: getObjectScale(object)
  });
  lastSavedName = filename;
  editor.markClean();
  // 最後のユーザー向け message を保存し status を更新する
  setMessage(`saved ${filename}`);
}

// file operation の失敗を console と status message の両方へ出す
// handler ごとに catch 文を重複させると message 表記がずれやすいため、入口をここへ集める
function reportFileOperationFailure(label, err) {
  console.error(err);
  setMessage(`${label} failed: ${err?.message ?? err}`);
}

// Promise を返す file operation を実行し、失敗時の message を統一する
async function runAsyncFileOperation(label, operation) {
  try {
    await operation();
  } catch (err) {
    reportFileOperationFailure(label, err);
  }
}

// 同期的な file operation を実行し、失敗時の message を統一する
function runFileOperation(label, operation) {
  try {
    operation();
  } catch (err) {
    reportFileOperationFailure(label, err);
  }
}

// palette / ribbon / DOM button から file picker を開くための共通入口
function openModelFilePicker() {
  if (!ui.fileInput) {
    throw new Error("file input is not available");
  }
  ui.fileInput.click();
}

// file input の現在選択を読み込み、同じ file を再選択できるよう最後に value を戻す
async function loadSelectedModelFile() {
  const file = ui.fileInput.files?.[0] ?? null;
  try {
    await loadModelFile(file);
  } finally {
    // embedded_glb_viewer と同じく value を戻し、同じ GLB を再選択した場合も
    // change event が発火するようにするこれは失敗後の再試行を確実にするための
    // UI 状態リセットであり、ロード失敗を隠す fallback ではない
    ui.fileInput.value = "";
  }
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
    button.addEventListener("click", () => editModeController.setTool(button.dataset.tool));
  }
  ui.fileInput.addEventListener("change", () => {
    runAsyncFileOperation("load", loadSelectedModelFile);
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
    // JSON 保存口は配布や転送時のサイズを抑えるため gzip 圧縮済み JSON を出力する
    runAsyncFileOperation("save", saveModelAssetJsonGz);
  });
  ui.saveJsonGz.addEventListener("click", async () => {
    // active object を gzip 圧縮済み ModelAsset JSON として保存する
    await runAsyncFileOperation("save", saveModelAssetJsonGz);
  });
  ui.saveGlb.addEventListener("click", () => {
    // active object を GLB file として保存する
    runFileOperation("glb export", saveGlb);
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
  ui.xMirrorEdit?.addEventListener("click", () => editModeController.toggleXMirrorEdit());
  ui.makeFace?.addEventListener("click", () => editModeController.makeFaceFromSelection());
  ui.flipFaces?.addEventListener("click", () => editModeController.flipSelectedFaces());
  ui.loopCutFaces?.addEventListener("click", () => editModeController.runLoopCutCommand());
  ui.undo.addEventListener("click", undo);
  ui.redo.addEventListener("click", redo);
  ui.coordinateOverlayApply?.addEventListener("pointerup", (ev) => {
    if (ev.pointerType === "touch") {
      runCoordinateOverlayButtonTouchAction("apply", applyCoordinateOverlayInput, ev);
    }
  });
  ui.coordinateOverlayApply?.addEventListener("touchend", (ev) => {
    runCoordinateOverlayButtonTouchAction("apply", applyCoordinateOverlayInput, ev);
  }, { passive: false });
  ui.coordinateOverlayApply?.addEventListener("click", (ev) => {
    if (shouldSuppressCoordinateOverlayClick("apply")) {
      ev.preventDefault();
      return;
    }
    runCoordinateOverlayButtonAction(applyCoordinateOverlayInput, ev);
  });
  ui.coordinateOverlayClose?.addEventListener("pointerup", (ev) => {
    if (ev.pointerType === "touch") {
      runCoordinateOverlayButtonTouchAction("close", closeCoordinateOverlay, ev);
    }
  });
  ui.coordinateOverlayClose?.addEventListener("touchend", (ev) => {
    runCoordinateOverlayButtonTouchAction("close", closeCoordinateOverlay, ev);
  }, { passive: false });
  ui.coordinateOverlayClose?.addEventListener("click", (ev) => {
    if (shouldSuppressCoordinateOverlayClick("close")) {
      ev.preventDefault();
      return;
    }
    runCoordinateOverlayButtonAction(closeCoordinateOverlay, ev);
  });
  ui.coordinateOverlay?.addEventListener("pointerdown", (ev) => ev.stopPropagation());
  ui.coordinateOverlay?.addEventListener("pointerup", (ev) => ev.stopPropagation());
  ui.coordinateOverlay?.addEventListener("click", (ev) => ev.stopPropagation());
  for (const field of ui.coordinateOverlayFields) {
    field.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    field.addEventListener("pointerup", (ev) => ev.stopPropagation());
    field.addEventListener("click", (ev) => ev.stopPropagation());
    field.addEventListener("focus", (ev) => ev.stopPropagation());
    field.addEventListener("focusin", (ev) => ev.stopPropagation());
    field.addEventListener("focusout", (ev) => ev.stopPropagation());
    field.addEventListener("touchstart", (ev) => ev.stopPropagation(), { passive: true });
    field.addEventListener("touchend", (ev) => ev.stopPropagation(), { passive: true });
    field.addEventListener("beforeinput", (ev) => ev.stopPropagation());
    field.addEventListener("input", (ev) => ev.stopPropagation());
  }
  ui.coordinateFalloffSelect?.addEventListener("pointerdown", (ev) => ev.stopPropagation());
  ui.coordinateFalloffSelect?.addEventListener("pointerup", (ev) => ev.stopPropagation());
  ui.coordinateFalloffSelect?.addEventListener("click", (ev) => ev.stopPropagation());
  ui.coordinateFalloffSelect?.addEventListener("touchstart", (ev) => ev.stopPropagation(), { passive: true });
  ui.coordinateFalloffSelect?.addEventListener("touchend", (ev) => ev.stopPropagation(), { passive: true });
  ui.coordinateFalloffSelect?.addEventListener("change", (ev) => ev.stopPropagation());
  ui.coordinateOverlay?.addEventListener("keydown", (ev) => {
    ev.stopPropagation();
    if (ev.key === "Enter") {
      ev.preventDefault();
      applyCoordinateOverlayInput();
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      closeCoordinateOverlay();
    }
  });
  ui.objectInfoOverlay?.addEventListener("pointerdown", (ev) => ev.stopPropagation());
  ui.objectInfoOverlay?.addEventListener("pointerup", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    closeObjectInfoOverlay();
  });
  ui.objectInfoOverlay?.addEventListener("touchend", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    closeObjectInfoOverlay();
  }, { passive: false });
  ui.objectInfoOverlay?.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    closeObjectInfoOverlay();
  });
  ui.overlayAlpha?.addEventListener("input", () => {
    overlayAlpha = readFiniteNumber(ui.overlayAlpha.value, overlayAlpha);
    markEditOverlayVisualDirty();
    if (ui.overlayAlphaValue) {
      ui.overlayAlphaValue.textContent = overlayAlpha.toFixed(2);
    }
  });
  ui.overlayMarkerColor?.addEventListener("input", () => {
    overlayMarkerColor = hexColorToRgb(ui.overlayMarkerColor.value, overlayMarkerColor);
    markMarkerOverlayDirty();
    if (ui.overlayMarkerColorValue) {
      ui.overlayMarkerColorValue.textContent = rgbToHexColor(overlayMarkerColor);
    }
  });
  ui.overlayEdgeColor?.addEventListener("input", () => {
    overlayEdgeColor = hexColorToRgb(ui.overlayEdgeColor.value, overlayEdgeColor);
    markEdgeOverlayUploadDirty();
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
  const editMesh = getRenderableEditMeshState();
  app.mergeDiagnosticsStats({
    vertexCount: editMesh.vertices.length,
    faceCount: editMesh.faces.length,
    selectedVertexCount: editMesh.selectedVertices.size,
    selectedFaceCount: editMesh.selectedFaces.size,
    selectedObjectCount: editor.selectedObjectIds.size,
    objectCount: editor.objects.length,
    importedMeshCount: importedMeshes.length,
    importedAssetLoaded: importedAsset ? "yes" : "no",
    editorMode: getRenderableEditorMode(),
    objectWireframe: viewController.objectWireframe ? "on" : "off",
    objectSmoothShading: viewController.objectSmoothShading ? "on" : "off",
    xMirrorEdit: xMirrorEdit ? "on" : "off",
    visiblePick: viewController.visiblePickOnly ? "visible only" : "through",
    visiblePickMode: visiblePickStats.mode,
    visiblePickCandidates: visiblePickStats.candidates,
    visiblePickSelected: visiblePickStats.selected,
    visiblePickGridFaces: visiblePickStats.gridFaces,
    visiblePickGridCells: visiblePickStats.gridCells,
    visiblePickAvgFacesPerCell: visiblePickStats.avgFacesPerFilledCell.toFixed(1),
    visiblePickMaxFacesPerCell: visiblePickStats.maxFacesPerCell,
    projection: getProjectionLabel(),
    projectionNear: Number(app.projectionNear).toFixed(4),
    projectionFar: Number(app.projectionFar).toFixed(1),
    focalLength: getFocalLengthLabel(),
    activeObjectId: editor.activeObjectId ?? "-",
    tool: getRenderableEditorTool(),
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
    mobileGestureAttached: mobileInput.gestureAttached ? "yes" : "no",
    mobileLastGesture: mobileInput.lastGesture,
    mobileLastGesturePointer: mobileInput.lastGesturePointer,
    mobileFlickTracking: mobileInput.flickPointer ? "active" : "idle",
    mobilePaletteOpen: commandPalette?.isOpen ? "yes" : "no",
    mobileSelectionShift: mobileInput.selectionShiftActive ? "on" : "off",
    mobileBoxSelectArmed: mobileInput.boxSelectArmed ? "yes" : "no",
    mobileBoxSelectPreview: boxSelectSession?.isAwaitingConfirm ? "yes" : "no",
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
  const editMesh = getRenderableEditMeshState();
  Diagnostics.addDetail(report, `tool=${getRenderableEditorTool()}`);
  Diagnostics.addDetail(report, `mode=${getRenderableEditorMode()}`);
  Diagnostics.addDetail(report, `objectWireframe=${viewController.objectWireframe ? "on" : "off"}`);
  Diagnostics.addDetail(report, `xMirrorEdit=${xMirrorEdit ? "on" : "off"}`);
  Diagnostics.addDetail(report, `visiblePick=${viewController.visiblePickOnly ? "visible only" : "through"}`);
  Diagnostics.addDetail(report, `visiblePickStats=${visiblePickStats.mode} candidates=${visiblePickStats.candidates} selected=${visiblePickStats.selected} gridFaces=${visiblePickStats.gridFaces} filledCells=${visiblePickStats.gridCells} avgFaces=${visiblePickStats.avgFacesPerFilledCell.toFixed(1)} maxFaces=${visiblePickStats.maxFacesPerCell}`);
  Diagnostics.addDetail(report, `projection=${getProjectionLabel()}`);
  Diagnostics.addDetail(report, `focalLength=${getFocalLengthLabel()}`);
  Diagnostics.addDetail(report, `vertices=${editMesh.vertices.length}`);
  Diagnostics.addDetail(report, `faces=${editMesh.faces.length}`);
  Diagnostics.addDetail(report, `rawInput=${rawInput.text}`);
  Diagnostics.addDetail(report, `rawInputHistory=${rawInput.historyText}`);
  Diagnostics.addDetail(report, `rawInputButtonHistory=${rawInput.buttonHistoryText}`);
  Diagnostics.addDetail(report, `eyeRigPointer=${pointerDebug.text}`);
  Diagnostics.addDetail(report, `eyeRigPointerHistory=${pointerDebug.historyText}`);
  Diagnostics.mergeStats(report, {
    frameCount,
    vertexCount: editMesh.vertices.length,
    faceCount: editMesh.faces.length,
    selectedVertexCount: editMesh.selectedVertices.size,
    selectedFaceCount: editMesh.selectedFaces.size,
    selectedObjectCount: editor.selectedObjectIds.size,
    objectCount: editor.objects.length,
    importedMeshCount: importedMeshes.length,
    importedAssetLoaded: importedAsset ? "yes" : "no",
    editorMode: getRenderableEditorMode(),
    objectWireframe: viewController.objectWireframe ? "on" : "off",
    xMirrorEdit: xMirrorEdit ? "on" : "off",
    visiblePick: viewController.visiblePickOnly ? "visible only" : "through",
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
    mobileGestureAttached: mobileInput.gestureAttached ? "yes" : "no",
    mobileLastGesture: mobileInput.lastGesture,
    mobileLastGesturePointer: mobileInput.lastGesturePointer,
    mobilePaletteOpen: commandPalette?.isOpen ? "yes" : "no",
    mobileSelectionShift: mobileInput.selectionShiftActive ? "on" : "off",
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
    projectionNear: PERSPECTIVE_PROJECTION_NEAR,
    projectionFar: PERSPECTIVE_PROJECTION_FAR,
    messageFontTexture: "../../webg/font512.png",
    light: {
      // mmodeler は形状確認を優先するため、光源は world 固定ではなく視点上方に固定する。
      // 裏側へ回り込んでも camera 側から陰影が入り、Object Mode の立体感を保てる。
      mode: "eye-fixed",
      position: [30.0, 80.0, 120.0, 1.0],
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
  modelerImportExport = new ModelerImportExport({
    filenamePrefix: "ma",
    documentRef: document,
    urlApi: URL
  });
  modelerRenderer = new ModelerRenderer({
    app,
    modelerImportExport,
    material: MATERIAL
  });
  // iPhone Safari では file picker 復帰後に document.hasFocus() が false のまま残り、
  // ondemand 描画の requestRender() が canvas frame を再予約できない場合がある
  // mmodeler は公開済み webg core の挙動を変えず、この sample だけ page visibility を pause 根拠にする
  app.shouldAutoPauseFrameLoop = function shouldAutoPauseFrameLoopForModeler() {
    if (this.renderMode === "continuous") {
      return false;
    }
    return this.doc?.hidden === true || this.doc?.visibilityState === "hidden";
  };
  await app.init();
  boxSelectSession = new BoxSelectSession({
    getCanvas: () => app.screen.canvas,
    getEditorMode: getRenderableEditorMode,
    getEditorTool: getRenderableEditorTool,
    setMobileOrbitEnabled,
    setMessage,
    selectByClientRect,
    defaultMode: EDITOR_MODE_OBJECT
  });
  mobileInput.setServices({
    setMessage,
    updateMobileRibbon,
    renderMobilePalette,
    setMobileOrbitEnabled,
    closeMobilePalette,
    clearBoxSelectSession: () => boxSelectSession?.clear(),
    isBoxSelectAwaitingConfirm: () => boxSelectSession?.isAwaitingConfirm === true,
    confirmBoxSelectSession: () => boxSelectSession?.confirm() === true,
    isTransformActive: () => transformController?.state?.active === true,
    isSculptStrokeActive: () => sculptModeController?.hasActiveStroke?.() === true,
    isCommandPaletteOpen: () => commandPalette?.isOpen === true,
    enterSculptModeFromFlick: () => setEditorMode(EDITOR_MODE_SCULPT),
    handleSculptEmptyDoubleTap: (ev) => toggleSculptBrushInputFromEmptyDoubleTap(ev),
    showSculptBrushSettings,
    showActiveObjectInfo,
    inspectGestureTarget,
    hasAnyModelerVertices,
    openMobilePalette,
    getOrbit: () => orbit,
    getApp: () => app,
    resetCanvasClick
  });
  commandPalette = new CommandPalette({
    isMobileProfile: IS_MOBILE_PROFILE,
    root: ui.mobilePalette,
    buttons: ui.mobilePaletteButtons,
    getCanvasRect: () => app.screen.canvas.getBoundingClientRect(),
    getActionLabel: getMobileRibbonActionLabel,
    isActionEnabled: isMobileActionEnabled,
    isActionActive: isMobileActionActive,
    cancelPendingTap: cancelPendingMobileCanvasTap,
    isSculptPalette: () => getRenderableEditorMode() === EDITOR_MODE_SCULPT
  });
  viewController.setEffects({
    applyProjection: applyModelerProjection,
    rebuildScene,
    applyBackgroundColor,
    updateMobileRibbon,
    setOrbitViewPreset,
    setMessage
  });
  objectModeController = new ObjectModeController({
    scene: editor,
    objectModeName: EDITOR_MODE_OBJECT,
    commitActiveObject,
    activateObject,
    rebuildScene,
    setMessage,
    pushUndo,
    getObjectOrigin,
    getObjectRotation,
    getObjectScale,
    localToWorldPosition,
    buildPrimitiveObject
  });
  editModeController = new EditModeController({
    scene: editor,
    objectModeName: EDITOR_MODE_OBJECT,
    editModeName: EDITOR_MODE_EDIT,
    faceToolName: TOOL_SELECT_FACE,
    normalizeToolName,
    setEditorMode,
    setMessage,
    rebuildScene,
    refreshSelectionVisuals,
    pushUndo,
    markMarkerOverlayDirty,
    getXMirrorEdit: () => xMirrorEdit,
    setXMirrorEdit: (value) => {
      xMirrorEdit = value === true;
    },
    orderVertexIdsForFaceFromView,
    getCameraScreenBasis
  });
  sculptModeController = new SculptModeController({
    scene: editor,
    sculptModeName: EDITOR_MODE_SCULPT,
    setMessage,
    rebuildScene,
    markDirty: () => editor.markDirty()
  });
  modelerPicking = new ModelerPicking({
    getCanvas: () => app.screen.canvas,
    getEye: () => app.eye,
    getProjectionMatrix: () => app.projectionMatrix,
    getProjectionMode: () => viewController.projectionMode,
    orthographicMode: PROJECTION_MODE_ORTHOGRAPHIC,
    getObjects: () => editor.objects,
    getActiveObject,
    getRenderableEditorMode,
    editModeName: EDITOR_MODE_EDIT,
    getRenderableEditMeshState,
    makeObjectLocalRay,
    buildVertexLookup,
    localToWorldPosition,
    projectWorldToClient,
    clientPointInRect,
    getCurrentViewProjectionMatrix,
    getActiveObjectBounds,
    getFaceCenter: (face) => editModeController.getFaceCenter(face),
    getVisiblePickOnly: () => viewController.visiblePickOnly,
    getObjectWireframe: () => viewController.objectWireframe,
    isMobileProfile: IS_MOBILE_PROFILE,
    visiblePickGridCols: VISIBLE_PICK_GRID_COLS,
    visiblePickGridRows: VISIBLE_PICK_GRID_ROWS,
    visiblePickGridPaddingPx: VISIBLE_PICK_GRID_PADDING_PX,
    setVisiblePickSelectionStats
  });
  modelerCommandDispatcher = new ModelerCommandDispatcher({
    palette: commandPalette,
    isActionEnabled: isMobileActionEnabled,
    setMessage,
    openFilePicker: openModelFilePicker,
    saveJson: saveModelAssetJsonGz,
    saveGlb,
    createInitialModel,
    objectModeController,
    editModeController,
    viewController,
    showSelectedVertexCoordinates,
    showSculptBrushSettings,
    showActiveObjectInfo,
    cycleViewAnglePreset,
    undo,
    redo,
    takeScreenshot: takeModelerScreenshot,
    setTransformMode,
    deleteSelected,
    invertSelectionForCurrentMode,
    selectXNegativeForCurrentMode,
    setEditorMode,
    setSculptBrushType,
    setSculptBrushDirection,
    selectAllForCurrentMode,
    setPrimitiveSegments: (segments) => {
      mobileInput.setPrimitiveSegments(segments);
    },
    setPaletteTransformAxis,
    renderPalette: renderMobilePalette,
    closePalette: closeMobilePalette,
    objectModeName: EDITOR_MODE_OBJECT,
    editModeName: EDITOR_MODE_EDIT,
    sculptModeName: EDITOR_MODE_SCULPT,
    faceToolName: TOOL_SELECT_FACE,
    vertexToolName: TOOL_SELECT_VERTEX,
    addVertexToolName: TOOL_ADD_VERTEX
  });
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
    // EyeRig は有限の pitch 範囲を前提にするため、mmodeler 側では十分広い範囲を渡し、
    // orbit pitch を実質的に無制限として扱う
    pitchMin: -UNRESTRICTED_ORBIT_PITCH_DEGREES,
    pitchMax: UNRESTRICTED_ORBIT_PITCH_DEGREES,
    // mobile profile は画面内操作が主役なので、PC デバッグ時も
    // 通常時の左ドラッグを orbit、短い左クリックを選択として扱う
    dragButton: 0,
    alternateDragButton: 1,
    alternateDragModifierKey: null
  });
  const transformServices = {
    // scene / history transaction
    beginTransformTransaction,
    rebuildScene,
    restoreTransformStartSnapshot,
    rollbackTransformTransaction,
    // object transform operations
    applyObjectTransformPreview: (options) => objectModeController.applyObjectTransformPreview(options),
    createObjectTransformSnapshot: (objects) => objectModeController.createObjectTransformSnapshot(objects),
    // UI / pointer environment
    focusModelerCanvas,
    getCanvas: () => app.screen.canvas,
    setMessage,
    setMobileOrbitEnabled,
    // camera / geometry helpers
    getCameraScreenBasis,
    getEditorBounds,
    // edit geometry operations
    applyEditTransformDrag: (options) => editModeController.applyEditTransformDrag(options),
    cancelEditTransformSession: () => editModeController.cancelEditTransformSession(),
    confirmEditTransformSession: () => editModeController.confirmEditTransformSession(),
    finishEditTransformDragSegment: () => editModeController.finishEditTransformDragSegment(),
    hasEditTransformChanged: () => editModeController.hasEditTransformChanged(),
    hasEditTransformSegmentChanged: () => editModeController.hasEditTransformSegmentChanged(),
    startEditTransformSession: (mode) => editModeController.startEditTransformSession(mode),
    toggleEditTransformAxisConstraint: (axis) => editModeController.toggleEditTransformAxisConstraint(axis),
    getTransformTargetObjects: () => objectModeController.getTransformTargetObjects(),
    isEditMode
  };
  transformController = createTransformController(transformServices);
  detachTransformPointerBridge?.();
  detachTransformPointerBridge = transformController.installTransformPointerBridge(app.screen.canvas);
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
      normalizeOrbitPitchForModeler();
      if (viewController.projectionMode === PROJECTION_MODE_ORTHOGRAPHIC) {
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
      drawEditPreviewOverlayPass();
      drawSculptPreviewOverlayPass();
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
