// ---------------------------------------------
//  karakuri_maker.js  2026/10/04
//   Click-based child-friendly SceneYAML editor for Karakuri Maker
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import { addDominoRow } from "./domino_parts.js";
import { DEFAULT_BALL_RADIUS, DEFAULT_BALL_MASS } from "./karakuri_physics_defaults.js";
import Quat from "../../webg/Quat.js";
import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";
import { compressSceneYAML, createWebgSceneApp, SceneDefinition } from "../../webg/app/index.js";
import {
  createPrimitiveNode,
  readPrimitiveDefinitions,
  readPrimitiveMaterialManifest
} from "../../webg/app/PrimitiveScene.js";
import { readObjectEuler, objectRelations as findObjectRelations, uniqueObjectId, editDocument, readEditorNumber, editObjectMaterial } from "./editor_state.js";
import { viewProjection, projectPoint, pointOnDepth, screenRay, pickMesh } from "./editor_projection.js";
import { EmitterClock } from "./emitter_clock.js";
import { createKarakuriEmitterVisual, syncKarakuriEmitterVisual } from "./emitter_visual.js";
import { createGoalBodyReferences, findReachedGoals, goalContactMatches, contactIncludesGoalTarget } from "./goal_runtime.js";
import { KarakuriAudio, collectBallBodyIds, contactIncludesBody } from "./karakuri_audio.js";
import {
  getLanguage,
  applyLanguage,
  setLanguage,
  setStatus,
  formatTimeScale,
  t
} from "./karakuri_shared.js";
import {
  downloadBlob,
  parseKarakuriDocument,
  migrateKarakuriStandardStartupTimeScale,
  prepareKarakuriProceduralMaterials,
  destroyKarakuriProceduralMaterialCache,
  isKarakuriTimingEnabled,
  reportKarakuriTiming,
  readKarakuriText,
  stringifyKarakuriDocument
} from "./scene_document.js";

const DEFAULT_SCENE_URL = "./karakuri_scene.yaml?v=20260917r2";
const LOCAL_SCENE_KEY = "karakuri-maker-scene-yaml-v2";
const LOCAL_INITIAL_SCENE_KEY = "karakuri-maker-initial-scene-yaml-v2";
const CAMERA_RETURN_DURATION_SEC = 0.35;
const PREVIEW_CAMERA = {
  target: [0.0, 1.5, 0.0],
  distance: 17.3,
  yaw: 0.0,
  pitch: 0.0,
  roll: 0.0,
  minDistance: 3.5,
  maxDistance: 22.0,
  wheelZoomStep: 0.45,
  focusTarget: "ramp"
};

let language = getLanguage();
let state = null;
let selectedIndex = -1;
let placement = null;
let viewMode = "3d";
let detailsOpen = false;
let preview3dApp = null;
let previewProceduralMaterials = new Map();
const previewProceduralCache = { manager: null, device: undefined, materialsByKey: new Map() };
let previewObjectEntries = new Map();
let preview3dBuildToken = 0;
let statusElement = null;
let dragState = null;
let previewQueue = Promise.resolve();
let loadToken = 0;
let makerMode = "edit";
let pendingPart = null;
let undoStack = [];
let previewPhysics = false;
let previewPaused = true;
let previewReady = false;
let emitterEditorOpen = false;
let selectedEmitterId = null;
let cameraReturn = null;
const cameraGesturePointerIds = new Set();
const cameraGesturePositions = new Map();
let cameraGestureMoved = false;
const selectionMaterials = new WeakMap();
const previewEmitterClock = new EmitterClock();
let previewRuntimeBodies = [];
let previewSpawnedCount = 0;
let previewEmitterVisuals = [];
let previewGoalState = { reached: new Set(), bodyReferences: new Map() };
const karakuriAudio = new KarakuriAudio();

function pushUndoSnapshot(manifest) {
  undoStack.push(structuredClone(manifest));
  if (undoStack.length > 40) undoStack.shift();
}

// object定義から表示変換を除いた部分を比較し、Nodeだけ更新できる編集かを判定します
// 形状、材質、物理条件の変更はShapeやbodyの再生成が必要なため、全体再構築へ渡します
function previewObjectStructure(object) {
  if (!object) return null;
  const { transform, ...structure } = object;
  return JSON.stringify(structure);
}

// 物理を停止したMaker previewへSceneYAMLのobject差分だけを反映します
// 追加・削除・transform変更はGPU appを維持し、Procedural Materialを使う追加だけは明示的に再構築へ戻します
function syncPreviewObjectChange(previousManifest, nextManifest) {
  const reject = (reason) => ({ handled: false, reason });
  if (!preview3dApp || !previewReady || previewPhysics || makerMode !== "edit") {
    return reject("preview is not in editable display mode");
  }
  if (JSON.stringify(previousManifest.proceduralMaterials ?? [])
    !== JSON.stringify(nextManifest.proceduralMaterials ?? [])) {
    return reject("procedural material definition changed");
  }
  const previousObjects = new Map((previousManifest.objects ?? []).map((object) => [object.id, object]));
  const nextObjects = new Map((nextManifest.objects ?? []).map((object) => [object.id, object]));
  for (const [id, previous] of previousObjects) {
    const next = nextObjects.get(id);
    if (next && previewObjectStructure(previous) !== previewObjectStructure(next)) {
      return reject(`object structure changed: ${id}`);
    }
  }
  const proceduralIds = new Set(
    (nextManifest.proceduralMaterials ?? []).map((definition) => definition?.materialId)
  );
  const added = [...nextObjects.values()].filter((object) => !previousObjects.has(object.id));
  if (added.some((object) => object.parent !== undefined)) return reject("parented object addition requires full rebuild");
  if (added.some((object) => proceduralIds.has(object.material))) {
    return reject("procedural material addition requires full rebuild");
  }

  const created = [];
  try {
    if (added.length > 0) {
      const materialDefinitions = readPrimitiveMaterialManifest(nextManifest.materials);
      for (const object of added) {
        const [definition] = readPrimitiveDefinitions(
          [object],
          undefined,
          `Karakuri preview object ${object.id}`,
          { materialDefinitions, orientationFormat: "euler" }
        );
        const entry = createPrimitiveNode(preview3dApp.app, definition, `Karakuri preview object ${object.id}`);
        previewObjectEntries.set(entry.id, entry);
        created.push(entry);
      }
    }
    for (const [id, entry] of [...previewObjectEntries]) {
      if (nextObjects.has(id)) continue;
      preview3dApp.app.space.removeNode(entry.node, { destroyShapes: true });
      previewObjectEntries.delete(id);
    }
    for (const [id, object] of nextObjects) {
      const entry = previewObjectEntries.get(id);
      if (!entry) throw new Error(`Karakuri preview object entry is unavailable: ${id}`);
      entry.node.setPosition(...(object.transform?.position ?? [0, 0, 0]));
      const euler = readObjectEuler(object);
      const quat = new Quat();
      quat.eulerToQuat(euler.yaw, euler.pitch, euler.roll);
      entry.node.setQuat(quat);
    }
    preview3dApp.app.requestRender();
    return { handled: true, reason: "incremental object update" };
  } catch (error) {
    for (const entry of created) {
      preview3dApp.app.space.removeNode(entry.node, { destroyShapes: true });
      previewObjectEntries.delete(entry.id);
    }
    throw error;
  }
}

function setMakerMode(nextMode) {
  makerMode = nextMode;
  render();
}

function updateChildHint(text, kind = "info") {
  const element = document.getElementById("work-hint");
  setStatus(element, text, kind);
  const stage = document.getElementById("stage-message");
  if (stage) stage.textContent = text;
}

// 視点の自動復帰を中断し、次のマウス操作を現在位置から始めます
function cancelCameraReturn() {
  cameraReturn = null;
}

// 視点操作として記録したpointerを消し、部品操作との候補状態を解放します
function clearCameraGesture() {
  cameraGesturePointerIds.clear();
  cameraGesturePositions.clear();
  cameraGestureMoved = false;
}

// 視点復帰と視点操作の候補をまとめて解除します
function cancelCameraInteraction() {
  cancelCameraReturn();
  clearCameraGesture();
}

// 角度を一周分の差が小さい方向へ補間できる値へそろえます
function shortestAngleDelta(from, to) {
  let delta = to - from;
  while (delta > 180.0) delta -= 360.0;
  while (delta < -180.0) delta += 360.0;
  return delta;
}

// EyeRigの公開状態へMakerの初期視点を適用し、ondemand描画も起こします
function applyPreviewCameraState(app, next) {
  const eyeRig = app?.app?.eyeRig;
  if (!eyeRig?.orbit) return false;
  const orbit = eyeRig.orbit;
  orbit.target[0] = next.target[0];
  orbit.target[1] = next.target[1];
  orbit.target[2] = next.target[2];
  orbit.distance = next.distance;
  orbit.yaw = next.yaw;
  orbit.pitch = next.pitch;
  orbit.roll = next.roll;
  eyeRig.apply();
  app.app.syncCameraFromEyeRig(eyeRig);
  app.app.requestRender();
  return true;
}

// 視点ドラッグ終了時の現在値を保存し、初期視点への復帰を開始します
function beginCameraReturn(app = preview3dApp) {
  if (!app?.app?.eyeRig?.orbit || makerMode !== "edit" || viewMode !== "3d") return;
  const orbit = app.app.eyeRig.orbit;
  cameraReturn = {
    app,
    elapsedSec: 0.0,
    start: {
      target: [...orbit.target],
      distance: orbit.distance,
      yaw: orbit.yaw,
      pitch: orbit.pitch,
      roll: orbit.roll
    },
    yawDelta: shortestAngleDelta(orbit.yaw, PREVIEW_CAMERA.yaw),
    rollDelta: shortestAngleDelta(orbit.roll, PREVIEW_CAMERA.roll)
  };
  app.app.requestRender();
}

// 1 frameごとに視点を初期状態へ近づけ、復帰完了時は初期値を正確に確定します
function updateCameraReturn(app, deltaSec) {
  if (!cameraReturn) return;
  if (cameraReturn.app !== app || makerMode !== "edit" || viewMode !== "3d") {
    cancelCameraReturn();
    return;
  }
  cameraReturn.elapsedSec += Math.max(0.0, Number(deltaSec) || 0.0);
  const progress = Math.min(1.0, cameraReturn.elapsedSec / CAMERA_RETURN_DURATION_SEC);
  const eased = 1.0 - ((1.0 - progress) ** 3);
  const start = cameraReturn.start;
  applyPreviewCameraState(app, {
    target: start.target.map((value, axis) => value + (PREVIEW_CAMERA.target[axis] - value) * eased),
    distance: start.distance + (PREVIEW_CAMERA.distance - start.distance) * eased,
    yaw: start.yaw + cameraReturn.yawDelta * eased,
    pitch: start.pitch + (PREVIEW_CAMERA.pitch - start.pitch) * eased,
    roll: start.roll + cameraReturn.rollDelta * eased
  });
  if (progress >= 1.0) {
    applyPreviewCameraState(app, PREVIEW_CAMERA);
    cancelCameraReturn();
  }
}

// 左ドラッグを視点操作の候補として記録し、復帰中の視点をその場で止めます
function beginCameraGesture(event) {
  cancelCameraReturn();
  if (!state || makerMode !== "edit" || viewMode !== "3d" || pendingPart || event.button !== 0) return;
  if (event.pointerType === "touch") {
    if (cameraGesturePointerIds.size === 0) cameraGestureMoved = false;
    cameraGesturePointerIds.add(event.pointerId);
  } else {
    clearCameraGesture();
    cameraGesturePointerIds.add(event.pointerId);
  }
  cameraGesturePositions.set(event.pointerId, [event.clientX, event.clientY]);
}

// EyeRigと同じpointerを監視し、実際に視点が動いたgestureだけを復帰対象にします
function trackCameraGesture(event) {
  if (!cameraGesturePointerIds.has(event.pointerId)) return;
  const previous = cameraGesturePositions.get(event.pointerId);
  if (previous && (previous[0] !== event.clientX || previous[1] !== event.clientY)) {
    cameraGestureMoved = true;
  }
  cameraGesturePositions.set(event.pointerId, [event.clientX, event.clientY]);
}

// 視点操作のpointerが終わった時点で、部品操作でなければ自動復帰を開始します
function finishCameraGesture(event) {
  if (!cameraGesturePointerIds.has(event.pointerId)) return;
  cameraGesturePointerIds.delete(event.pointerId);
  cameraGesturePositions.delete(event.pointerId);
  if (cameraGesturePointerIds.size > 0) return;
  const eyeRig = preview3dApp?.app?.eyeRig;
  const isCameraDrag = event.pointerType === "touch" || eyeRig?.dragging === true;
  const shouldReturn = !dragState && isCameraDrag && cameraGestureMoved;
  clearCameraGesture();
  if (shouldReturn) beginCameraReturn();
}

// ウィンドウからフォーカスが外れた場合も、視点操作を正面復帰へ収束させます
function handleCameraBlur() {
  if (!cameraGesturePointerIds.size || dragState || !cameraGestureMoved) return;
  clearCameraGesture();
  beginCameraReturn();
}

function reportError(error) {
  console.error(error);
  setStatus(statusElement, `${t(language, "statusError")}\n${error.message ?? error}`, "error");
}

function commitMutation(edit, rebuild = true) {
  if (!state || makerMode !== "edit") return false;
  try {
    const previousManifest = state.manifest;
    const next = editDocument(state, edit);
    const previewResult = rebuild
      ? syncPreviewObjectChange(previousManifest, next.manifest)
      : { handled: false, reason: "caller disabled preview rebuild" };
    pushUndoSnapshot(state.manifest);
    state.project.destroy();
    state = next;
    storeLocalScene();
    if (rebuild && !previewResult.handled) {
      if (isKarakuriTimingEnabled()) {
        console.info(`[Karakuri timing] Maker preview full rebuild: ${previewResult.reason}`);
      }
      void rebuild3dPreview(false);
    }
    return true;
  } catch (error) { reportError(error); return false; }
}

// 16進RGBをSceneYAMLの0から1までのRGB配列へ変換します
function colorToRgb(value) {
  const text = String(value).replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(text)) throw new Error(`Invalid color: ${value}`);
  return [0, 2, 4].map((offset) => Number.parseInt(text.slice(offset, offset + 2), 16) / 255);
}

// SceneYAMLのRGB配列をinput type=colorへ渡せる16進表記に変換します
function rgbToColor(value) {
  return `#${value.slice(0, 3).map((entry) => Math.round(entry * 255).toString(16).padStart(2, "0")).join("")}`;
}

// 現在選択中のobjectを返し、画面の選択状態とmanifestの対応を一か所へ集めます
function selectedObject() {
  const object = selectedIndex >= 0 ? state?.manifest.objects?.[selectedIndex] ?? null : null;
  return isSelectableObject(object) ? object : null;
}

// 選択中の発射台を返し、表示NodeとSceneYAMLのemitter定義を同じIDで結びます
function selectedEmitter() {
  return state?.manifest.emitters?.find((emitter) => emitter.id === selectedEmitterId) ?? null;
}

// 旧版の部屋を含む作品でも、床・壁は工作部品の選択対象から外します。
function isSelectablePart(id) {
  return !/(^|[-_])(floor|wall)(?:$|[-_])/i.test(String(id ?? ""));
}

// wall材質を使う背景も、IDの付け方に関係なく工作部品の選択対象から外します。
function isSelectableObject(object) {
  return !!object && isSelectablePart(object.id) && object.material !== "wall";
}

// 編集範囲内へ値を収め、クリック配置と矢印操作で同じ範囲を使います
function clampToBounds(value, axis) {
  const bounds = state.world.editBounds;
  return Math.max(bounds.min[axis], Math.min(bounds.max[axis], value));
}

// 坂とゴールを材質と形状から判定し、SceneYAMLのプリミティブ定義へ役割を戻します
function isRampObject(object) {
  return object?.material === "ramp" || object?.id === "ramp";
}

function isGoalObject(object) {
  return object?.material === "goal" || object?.id === "goal-board";
}

// 坂を載せられるつみきを探し、近くへ置いた坂をつみきの上面へそろえます
// 床や壁のような背景物体は候補から外し、既存の支持台と追加したつみきを共通に扱います
function snapRampPosition(position, rampHeight = 0.14) {
  const candidates = (state.manifest.objects ?? []).filter((object) => (
    object.shape?.type === "box"
      && !isBackdropObject(object)
      && (object.id.includes("support") || object.material === "machine-floor")
  ));
  let nearest = null;
  let nearestDistance = Infinity;
  for (const support of candidates) {
    const supportPosition = support.transform?.position ?? [0, 0, 0];
    const dx = position[0] - supportPosition[0];
    const dz = position[2] - supportPosition[2];
    const distance = Math.hypot(dx, dz);
    const reach = Math.max(0.55, ((support.shape.size?.[0] ?? 0.7) + 1.8) * 0.5);
    if (distance <= reach && distance < nearestDistance) {
      nearest = support;
      nearestDistance = distance;
    }
  }
  if (!nearest) return [...position];
  const supportPosition = nearest.transform?.position ?? [0, 0, 0];
  return [
    clampToBounds(supportPosition[0], 0),
    clampToBounds(supportPosition[1] + nearest.shape.size[1] * 0.5 + rampHeight * 0.5 + 0.015, 1),
    clampToBounds(supportPosition[2], 2)
  ];
}

// 役割ごとの初期形状、位置、材質、物理bodyを一つの定義へまとめます
// 追加するprimitiveの初期形状、初期材質、初期物理を作ります
// markerPositionを受け取ったときは、画面で選んだ位置を新しい物体の中心へ使います
function makeObject(type, index, markerPosition = null) {
  const shape = type === "sphere"
    ? { type, radius: DEFAULT_BALL_RADIUS }
    : type === "capsule"
      ? { type, radius: 0.14, segmentLength: 0.5 }
      : type === "ramp"
        ? { type: "box", size: [1.8, 0.14, 0.56] }
      : type === "goal"
        ? { type: "box", size: [0.82, 0.16, 0.90] }
        : { type, size: [0.7, 0.35, 0.7] };
  const defaultPosition = type === "ramp"
    ? [0, 0.72, 0]
    : type === "goal"
      ? [1.35, 0.52, 0]
      : [0, type === "box" ? 0.3 : 1.4, 0];
  const position = markerPosition
    ? type === "ramp" ? snapRampPosition(markerPosition, shape.size[1]) : [markerPosition[0], markerPosition[1], markerPosition[2]]
    : defaultPosition;
  const materialId = type === "sphere"
    ? "ball"
    : type === "ramp"
      ? "ramp"
      : type === "goal"
        ? "goal"
        : type === "box" ? "machine-floor" : "goal";
  const dynamic = type === "sphere" || type === "capsule";
  return {
    id: uniqueObjectId(state.manifest, type),
    shape,
    transform: {
      position,
      ...(type === "ramp" ? { orientation: { roll: -13 } } : type === "goal" ? { orientation: { roll: 13 } } : {})
    },
    material: state.manifest.materials.find(m => m.id === materialId)?.id ?? state.manifest.materials[0]?.id,
    physics: {
      bodyType: dynamic ? "dynamic" : "static",
      ...(dynamic ? {
        mass: type === "sphere" ? DEFAULT_BALL_MASS : 0.5,
        material: { friction: 0.15, restitution: 0.72 }
      } : {})
    }
  };
}

// objectのEuler回転をMakerで扱う名前付き形式へ読み替えます
// 2D画面のY軸は下向きのため、3DワールドのrollをCSS回転へ変換します
// SceneYAMLと3D Nodeが使う角度値は保持し、Makerの平面表示だけ座標系を合わせます
function previewRoll(object) {
  return -readObjectEuler(object).roll;
}

// Makerの回転ボタンで変更した角度をSceneYAMLへ戻します
function writeObjectEuler(object, euler) {
  object.transform ??= {};
  object.transform.orientation = {
    yaw: euler.yaw,
    pitch: euler.pitch,
    roll: euler.roll
  };
}

// objectの形状からプレビューで使う横幅と高さを返します
function previewSize(object) {
  const shape = object.shape;
  if (shape.type === "box") return [shape.size[0], shape.size[1]];
  if (shape.type === "capsule") return [shape.radius * 2, shape.segmentLength + shape.radius * 2];
  return [shape.radius * 2, shape.radius * 2];
}

// 表示範囲をほぼ覆う背景物体を判定し、空白クリックを背景の下へ渡せるようにします
function isBackdropObject(object) {
  const [sizeX, sizeY] = previewSize(object);
  const bounds = state.world.editBounds;
  const worldWidth = bounds.max[0] - bounds.min[0];
  const worldHeight = bounds.max[1] - bounds.min[1];
  return sizeX >= worldWidth * 0.9 && sizeY >= worldHeight * 0.9;
}

// ワールド位置を2Dプレビューの横位置と高さへ変換します
function mapSidePosition(position, width, height) {
  const bounds = state.world.editBounds;
  return {
    left: ((position[0] - bounds.min[0]) / (bounds.max[0] - bounds.min[0])) * width,
    bottom: ((position[1] - bounds.min[1]) / (bounds.max[1] - bounds.min[1])) * height
  };
}

// ワールド位置を3D表示上の選択面位置へ変換します
// Makerでは見ている人がクリックしやすいようにX/Yを主に使い、Zを少し奥行きへ反映します
function map3dPosition(position, width, height) {
  return projectPoint(viewProjection(preview3dApp?.app), position, width, height);
}

// クリック位置を2D編集面のワールド座標へ変換し、次の配置場所として保存します
function setPlacementFromSideEvent(event) {
  if (!state || makerMode !== "edit") return;
  const preview = event.currentTarget;
  const rect = preview.getBoundingClientRect();
  const xRatio = (event.clientX - rect.left) / rect.width;
  const yRatio = 1.0 - (event.clientY - rect.top) / rect.height;
  const bounds = state.world.editBounds;
  placement = {
    position: [
      bounds.min[0] + xRatio * (bounds.max[0] - bounds.min[0]),
      bounds.min[1] + yRatio * (bounds.max[1] - bounds.min[1]),
      0
    ],
    source: "2d"
  };
  render();
}

// クリック位置をXY工作面へ投影し、新しい部品をZ=0へ置きます。
function setPlacementFrom3dEvent(event) {
  if (!state || makerMode !== "edit") return;
  // The same left drag rotates the empty scene; a placement click belongs to the part tool.
  cancelCameraInteraction();
  preview3dApp?.app.eyeRig?.cancelDrag?.();
  event.stopImmediatePropagation();
  event.preventDefault();
  const canvas = event.currentTarget;
  const rect = canvas.getBoundingClientRect();
  const xRatio = (event.clientX - rect.left) / rect.width;
  const zRatio = (event.clientY - rect.top) / rect.height;
  const selected = selectedObject();
  const depth = pendingPart ? 0 : selected?.transform?.position?.[2] ?? 0;
  const point = pointOnDepth(viewProjection(preview3dApp?.app), xRatio, zRatio, depth);
  if (!point) return;
  const position = point.map((v, axis) => clampToBounds(v, axis));
  if (pendingPart === "emitter") {
    placePendingEmitter(position);
    return;
  }
  if (pendingPart) {
    placePendingPart(position);
    return;
  }
  placement = {
    position,
    source: "3d"
  };
  render();
}

// pointer位置を2D表示の編集面上のワールド座標へ変換し、物体移動と配置で同じ範囲を使います
function sidePointerPosition(event) {
  const rect = document.getElementById("mini-preview").getBoundingClientRect();
  const bounds = state.world.editBounds;
  return [
    clampToBounds(bounds.min[0] + ((event.clientX - rect.left) / rect.width) * (bounds.max[0] - bounds.min[0]), 0),
    clampToBounds(bounds.max[1] - ((event.clientY - rect.top) / rect.height) * (bounds.max[1] - bounds.min[1]), 1)
  ];
}

// pointer位置を選択部品の奥行きにあるXY平面へ投影します
function preview3dPointerPosition(event, depthOverride = null) {
  const rect = document.getElementById("preview-3d-host").getBoundingClientRect();
  const depth = depthOverride ?? selectedObject()?.transform?.position?.[2] ?? 0;
  const point = pointOnDepth(viewProjection(preview3dApp?.app), (event.clientX-rect.left)/rect.width, (event.clientY-rect.top)/rect.height, depth);
  return point ? [point[0], point[1]] : null;
}

// 選択物体のpointer操作を開始し、2D／3Dの画面移動を同じdrag stateで追跡します
function beginObjectDrag(index, event) {
  if (!isSelectableObject(state.manifest.objects[index])) return;
  if (makerMode !== "edit") return;
  if (event.button !== 0) return;
  // Let a left drag on an empty area orbit the camera, but reserve a picked part for editing.
  cancelCameraInteraction();
  preview3dApp?.app.eyeRig?.cancelDrag?.();
  event.stopImmediatePropagation();
  event.preventDefault();
  selectedIndex = index;
  selectedEmitterId = null;
  emitterEditorOpen = false;
  detailsOpen = false;
  const object = selectedObject();
  if (object.parent) { reportError(new Error("Parented objects: edit local position in More settings")); return; }
  object.transform ??= {};
  object.transform.position ??= [0, 0, 0];
  const pointer = viewMode === "2d" ? sidePointerPosition(event) : preview3dPointerPosition(event);
  if (!pointer) return;
  dragState = { index, pointerId: event.pointerId, moved: false, mode: viewMode,
    before: [...object.transform.position], pointer };
  pushUndoSnapshot(state.manifest);
  event.currentTarget.classList.add("selected");
  renderSelection();
  renderEditor();
}

// 表示中の発射台を選択し、XYドラッグでspawnPositionを編集できる状態へ移します
function beginEmitterDrag(emitterId, event) {
  if (makerMode !== "edit" || event.button !== 0) return;
  const emitter = state?.manifest.emitters?.find((entry) => entry.id === emitterId);
  if (!emitter) return;
  cancelCameraInteraction();
  preview3dApp?.app.eyeRig?.cancelDrag?.();
  event.stopImmediatePropagation();
  event.preventDefault();
  selectedIndex = -1;
  selectedEmitterId = emitter.id;
  emitterEditorOpen = true;
  detailsOpen = false;
  emitter.spawnPosition ??= [0.0, 0.0, 0.0];
  const pointer = preview3dPointerPosition(event, emitter.spawnPosition[2]);
  if (!pointer) return;
  emitterDragState = {
    kind: "emitter",
    emitterId,
    pointerId: event.pointerId,
    moved: false,
    mode: "3d",
    before: [...emitter.spawnPosition],
    pointer
  };
  pushUndoSnapshot(state.manifest);
  event.currentTarget.setPointerCapture?.(event.pointerId);
  render();
}

// pointer移動中の座標をmanifestとpreviewへ反映し、既存の3D Nodeも同じ位置へ同期します
function moveDraggedObject(event) {
  if (emitterDragState && emitterDragState.pointerId === event.pointerId) {
    moveDraggedEmitter(event);
    return;
  }
  if (!dragState || dragState.pointerId !== event.pointerId || makerMode !== "edit") return;
  const object = state.manifest.objects?.[dragState.index];
  if (!object) return;
  if (dragState.mode === "2d") {
    const [x, y] = sidePointerPosition(event);
    object.transform.position[0] = clampToBounds(dragState.before[0] + x - dragState.pointer[0], 0);
    object.transform.position[1] = clampToBounds(dragState.before[1] + y - dragState.pointer[1], 1);
  } else {
    const point = preview3dPointerPosition(event);
    if (!point) return;
    object.transform.position[0] = clampToBounds(dragState.before[0] + point[0] - dragState.pointer[0], 0);
    object.transform.position[1] = clampToBounds(dragState.before[1] + point[1] - dragState.pointer[1], 1);
  }
  dragState.moved = true;
  syncObjectTo3d(object);
  render();
}

let emitterDragState = null;

// 発射台をXY平面上で動かし、spawnPositionと表示Nodeを同時に更新します
function moveDraggedEmitter(event) {
  if (!emitterDragState || emitterDragState.pointerId !== event.pointerId || makerMode !== "edit") return;
  const emitter = state?.manifest.emitters?.find((entry) => entry.id === emitterDragState.emitterId);
  if (!emitter) return;
  const point = preview3dPointerPosition(event, emitterDragState.before[2]);
  if (!point) return;
  emitter.spawnPosition[0] = clampToBounds(emitterDragState.before[0] + point[0] - emitterDragState.pointer[0], 0);
  emitter.spawnPosition[1] = clampToBounds(emitterDragState.before[1] + point[1] - emitterDragState.pointer[1], 1);
  emitterDragState.moved = true;
  const visual = previewEmitterVisuals.find((entry) => entry.emitterId === emitter.id);
  syncKarakuriEmitterVisual(visual, emitter);
  render();
}

// pointer操作を終え、移動した物体をSceneYAMLとして保存可能な状態へ残します
function finishObjectDrag(event) {
  if (!dragState || dragState.pointerId !== event.pointerId) return;
  const moved = dragState.moved;
  if (event.type === "pointercancel") {
    const object = selectedObject();
    object.transform.position = dragState.before;
    syncObjectTo3d(object);
  }
  dragState = null;
  if (moved && event.type !== "pointercancel") {
    storeLocalScene();
    setStatus(statusElement, t(language, "objectMoved"), "ok");
  }
  if (!moved || event.type === "pointercancel") undoStack.pop();
  render();
}

// 発射台のpointer操作を確定し、移動結果をSceneYAMLへ保存します
function finishEmitterDrag(event) {
  if (!emitterDragState || emitterDragState.pointerId !== event.pointerId) return;
  const stateAtStart = emitterDragState;
  const emitter = state?.manifest.emitters?.find((entry) => entry.id === stateAtStart.emitterId);
  const moved = stateAtStart.moved;
  if (emitter && event.type === "pointercancel") {
    emitter.spawnPosition = stateAtStart.before;
    syncKarakuriEmitterVisual(
      previewEmitterVisuals.find((entry) => entry.emitterId === emitter.id),
      emitter
    );
  }
  emitterDragState = null;
  if (moved && event.type !== "pointercancel") {
    storeLocalScene();
    setStatus(statusElement, t(language, "emitterMoved"), "ok");
  }
  if (!moved || event.type === "pointercancel") undoStack.pop();
  render();
}

// 2Dプレビューへobjectを配置し、クリックで選択できる面を作ります
function renderPreview() {
  const preview = document.getElementById("mini-preview");
  // 配置マーカとクリック面を同じ親で保持し、空白クリック時に既存の表示要素を巻き込まないようにします
  preview.querySelectorAll(".mini-object").forEach((item) => item.remove());
  const marker = document.getElementById("placement-marker");
  if (marker.parentElement !== preview) preview.append(marker);
  const rect = preview.getBoundingClientRect();
  const width = rect.width || 640;
  const height = rect.height || 420;
  for (const [index, object] of (state.manifest.objects ?? []).entries()) {
    if (!isSelectableObject(object)) continue;
    const position = object.transform?.position ?? [0, 0, 0];
    const [sizeX, sizeY] = previewSize(object);
    const point = mapSidePosition(position, width, height);
    const item = document.createElement("button");
    item.className = `mini-object${selectedIndex === index ? " selected" : ""}`;
    item.type = "button";
    item.title = object.id;
    item.setAttribute("aria-label", object.id);
    item.style.left = `${point.left}px`;
    item.style.bottom = `${point.bottom}px`;
    item.style.width = `${Math.max(16, sizeX / (state.world.editBounds.max[0] - state.world.editBounds.min[0]) * width)}px`;
    item.style.height = `${Math.max(16, sizeY / (state.world.editBounds.max[1] - state.world.editBounds.min[1]) * height)}px`;
    const material = state.manifest.materials.find((entry) => entry.id === object.material);
    item.style.background = rgbToColor(material?.color ?? [0.8, 0.8, 0.8, 1]);
    if (object.shape.type === "sphere") item.style.borderRadius = "50%";
    item.style.transform = `translate(-50%, 50%) rotate(${previewRoll(object)}deg)`;
    item.addEventListener("click", (event) => {
      event.stopPropagation();
      selectedIndex = index;
      selectedEmitterId = null;
      emitterEditorOpen = false;
      detailsOpen = false;
      render();
    });
    item.addEventListener("pointerdown", (event) => beginObjectDrag(index, event));
    preview.append(item);
  }
  renderPlacementMarker();
}

// 選択した立体の描画材質を変え、元のSceneYAML材質は編集用に保持します。
// GPU texture handleは同じresourceを参照し、配列parameterだけを複製します
function cloneShapeMaterialParams(params) {
  return Object.fromEntries(Object.entries(params ?? {}).map(([key, value]) => [
    key,
    Array.isArray(value) ? [...value] : value
  ]));
}

function render3dOverlay() {
  if (!preview3dApp || !state) return;
  const selected = makerMode === "edit" ? selectedObject()?.id : null;
  for (const entry of previewObjectEntries.values()) {
    for (const shape of entry.node.shapes ?? []) {
      if (!selectionMaterials.has(shape)) selectionMaterials.set(shape, cloneShapeMaterialParams(shape.materialParams));
      const base = selectionMaterials.get(shape);
      const active = entry.id === selected;
      if (shape.karakuriSelected === active) continue;
      shape.setMaterial(shape.materialId, active
        ? { ...base, color: [1, 0.48, 0.06, 1], metallic: 0, emissive_factor: [0.25, 0.08, 0], emissive: 0 }
        : base);
      shape.karakuriSelected = active;
      preview3dApp.app.requestRender();
    }
  }
  for (const visual of previewEmitterVisuals) {
    const active = makerMode === "edit" && visual.emitterId === selectedEmitterId;
    for (const part of visual.parts) {
      const shape = part.shape;
      if (!selectionMaterials.has(shape)) selectionMaterials.set(shape, cloneShapeMaterialParams(shape.materialParams));
      const base = selectionMaterials.get(shape);
      if (shape.karakuriSelected === active) continue;
      shape.setMaterial(shape.materialId, active
        ? { ...base, color: [1, 0.48, 0.06, 1], metallic: 0, emissive_factor: [0.25, 0.08, 0], emissive: 0 }
        : base);
      shape.karakuriSelected = active;
      preview3dApp.app.requestRender();
    }
  }
  renderPlacementMarker();
}

function selectMesh(event) {
  if (!previewReady || makerMode !== "edit" || event.button !== 0) return;
  if (pendingPart) { setPlacementFrom3dEvent(event); return; }
  const rect = event.currentTarget.getBoundingClientRect();
  for (const node of preview3dApp.app.space.nodes) if (!node.parent) node.setWorldMatrix();
  const ray = screenRay(viewProjection(preview3dApp.app),
    (event.clientX-rect.left)/rect.width, (event.clientY-rect.top)/rect.height);
  const selectableIds = new Set((state.manifest.objects ?? []).filter(isSelectableObject).map(object => object.id));
  const objectEntries = [...previewObjectEntries.values()].filter(entry => selectableIds.has(entry.id));
  const emitterEntries = previewEmitterVisuals.flatMap((visual) => visual.pickEntries);
  const entry = pickMesh([...objectEntries, ...emitterEntries], ray);
  if (!entry) {
    selectedIndex = -1;
    selectedEmitterId = null;
    emitterEditorOpen = false;
    render();
    return;
  }
  if (entry.karakuriEmitterId) {
    beginEmitterDrag(entry.karakuriEmitterId, event);
    event.currentTarget.setPointerCapture(event.pointerId);
    render();
    return;
  }
  beginObjectDrag(state.manifest.objects.findIndex(o => o.id === entry.id), event);
  event.currentTarget.setPointerCapture(event.pointerId);
  render();
}

// 現在の配置マークを2Dまたは3Dの表示面へ反映します
function renderPlacementMarker() {
  const marker2d = document.getElementById("placement-marker");
  const marker3d = document.getElementById("placement-marker-3d");
  if (!placement) {
    marker2d.hidden = true;
    marker3d.hidden = true;
    return;
  }
  const sideRect = document.getElementById("mini-preview").getBoundingClientRect();
  const sidePoint = mapSidePosition(placement.position, sideRect.width || 640, sideRect.height || 420);
  marker2d.style.left = `${sidePoint.left}px`;
  marker2d.style.bottom = `${sidePoint.bottom}px`;
  marker2d.hidden = viewMode !== "2d";
  const hostRect = document.getElementById("preview-3d-host").getBoundingClientRect();
  const point3d = map3dPosition(placement.position, hostRect.width || 640, hostRect.height || 420);
  if (point3d) {
    marker3d.style.left = `${point3d.left}px`;
    marker3d.style.bottom = `${point3d.bottom}px`;
  }
  marker3d.hidden = viewMode !== "3d" || !point3d;
}

// 部品棚で選んだ部品を、工作台のクリック位置へ追加します
function placePendingPart(position) {
  const type = pendingPart;
  if (!type || type === "emitter" || makerMode !== "edit") return;
  if (type === "domino") {
    let first;
    if (!commitMutation(manifest => { first = addDominoRow(manifest, position, state.world.editBounds); })) return;
    selectedIndex = first;
    selectedEmitterId = null;
    emitterEditorOpen = false;
    pendingPart = null;
    placement = null;
    render();
    updateChildHint(t(language, "dominoArranged"), "ok");
    return;
  }
  const object = makeObject(type, state.manifest.objects.length + 1, position);
  const snappedRamp = type === "ramp"
    && object.transform.position.some((value, index) => Math.abs(value - position[index]) > 0.001);
  if (!commitMutation(manifest => {
    manifest.objects.push(object);
    if (type === "goal") {
      const ids = new Set((manifest.goals ?? []).map(g => g.id));
      let id = `reach-${object.id}`;
      while (ids.has(id)) id += "-new";
      (manifest.goals ??= []).push({ id, target: object.id, message: t(language, "goalReached"), once: true });
    }
  })) return;
  selectedIndex = state.manifest.objects.length - 1;
  selectedEmitterId = null;
  emitterEditorOpen = false;
  pendingPart = null;
  placement = null;
  render();
  updateChildHint(t(language, snappedRamp ? "rampPlaced" : "objectPlaced"), "ok");
}

// ボールを出す部品を工作台へ置き、発射器の詳しい値をおとなの設定へ渡します
function placePendingEmitter(position) {
  if (makerMode !== "edit" || pendingPart !== "emitter") return;
  if (state.manifest.emitters?.length) {
    selectedIndex = -1;
    selectedEmitterId = state.manifest.emitters[0].id;
    emitterEditorOpen = true;
    pendingPart = null;
    render();
    updateChildHint(t(language, "emitter"));
    return;
  }
  const emitter = {
    id: uniqueObjectId(state.manifest, "ball-launcher"),
    intervalSec: 2.0,
    maxActive: 5,
    maxCount: 24,
    spawnPosition: position,
    initialVelocity: [0.2, 0, 0],
    lifetimeSec: 14.0,
    prototype: {
      shape: { type: "sphere", radius: DEFAULT_BALL_RADIUS },
      material: state.manifest.materials.find(m => m.id === "ball")?.id ?? state.manifest.materials[0]?.id,
      physics: { bodyType: "dynamic", mass: DEFAULT_BALL_MASS, material: { friction: 0.15, restitution: 0.72 } }
    }
  };
  if (!commitMutation(manifest => { (manifest.emitters ??= []).push(emitter); })) return;
  selectedIndex = -1;
  selectedEmitterId = emitter.id;
  emitterEditorOpen = true;
  pendingPart = null;
  placement = null;
  render();
  updateChildHint(t(language, "emitterPlaced"), "ok");
}

// 3Dビュー上の倍率ボタンをSceneYAMLの選択肢から作ります
function renderSpeedControls() {
  const container = document.getElementById("speed-controls");
  if (!container) return;
  container.setAttribute("aria-label", t(language, "speed"));
  const options = state?.playback?.timeScaleOptions ?? [];
  const optionKey = options.join(",");
  if (container.dataset.optionsKey !== optionKey) {
    container.querySelectorAll(".speed-button").forEach((button) => button.remove());
    for (const value of options) {
      const button = document.createElement("button");
      button.className = "button speed-button";
      button.type = "button";
      button.dataset.scale = String(value);
      button.textContent = formatTimeScale(value);
      button.addEventListener("click", () => {
        if (!preview3dApp || makerMode === "edit" || !previewReady) return;
        preview3dApp.setTimeScale(Number(value));
        renderSpeedControls();
      });
      container.append(button);
    }
    container.dataset.optionsKey = optionKey;
  }
  const current = preview3dApp?.getTimeScale();
  for (const button of container.querySelectorAll(".speed-button")) {
    const active = Number(button.dataset.scale) === current;
    button.disabled = makerMode === "edit" || !previewReady || !preview3dApp;
    button.classList.toggle("selected", active);
    button.setAttribute("aria-pressed", String(active));
    button.title = `${t(language, "speed")}: ${button.textContent}`;
  }
}

// 子ども向けの部品棚と試運転ボタンの表示を現在の状態へそろえます
function renderChildControls() {
  renderSpeedControls();
  const edit = makerMode === "edit";
  const running = makerMode === "running";
  const paused = makerMode === "paused";
  const undo = document.getElementById("undo");
  const tryButton = document.getElementById("try");
  const pause = document.getElementById("pause");
  const restart = document.getElementById("restart");
  const backEdit = document.getElementById("back-edit");
  const rampGuide = document.getElementById("ramp-guide");
  const resetScene = document.getElementById("reset-scene");
  if (undo) undo.disabled = !edit || undoStack.length === 0;
  if (tryButton) { tryButton.hidden = !edit; tryButton.disabled = !edit || !previewReady; }
  if (pause) { pause.hidden = edit; pause.textContent = running ? t(language, "pause") : t(language, "resume"); }
  if (restart) restart.hidden = edit;
  if (backEdit) backEdit.hidden = edit;
  if (rampGuide) rampGuide.hidden = !(edit && pendingPart === "ramp");
  if (resetScene) resetScene.disabled = !edit || !previewReady;
  const modeText = running ? t(language, "modePlaying") : paused ? t(language, "modePaused") : t(language, "modeEdit");
  const mode = document.getElementById("work-mode");
  if (mode) mode.textContent = modeText;
  for (const button of document.querySelectorAll(".kk-part")) {
    button.disabled = !edit || !previewReady;
    button.classList.toggle("selected", button.dataset.part === pendingPart);
  }
  const emitterButton = document.getElementById("add-emitter");
  if (emitterButton) emitterButton.disabled = !edit || !previewReady;
  for (const id of ["turn-left", "turn-right", "duplicate-selected", "delete-selected"]) {
    const button = document.getElementById(id);
    if (button) button.disabled = !edit || !selectedObject();
  }
  for (const id of ["pause", "restart", "back-edit"]) {
    const button = document.getElementById(id);
    if (button) button.disabled = edit || (id !== "back-edit" && !previewReady);
  }
  for (const element of document.querySelectorAll(".kk-technical-editor input, .kk-technical-editor select, #emitter-editor input, #close-emitter-details")) {
    element.disabled = !edit;
  }
  const help = document.querySelector(".kk-selection-help");
  if (help) help.textContent = edit
    ? (selectedEmitter() ? t(language, "emitterSelectedHint") : t(language, "selectedPartHint"))
    : t(language, "tryHint");
  if (edit && pendingPart === "ramp") updateChildHint(t(language, "rampGuide"));
  else if (edit && pendingPart) updateChildHint(t(language, "placedHint"));
  else if (running) updateChildHint(t(language, "tryHint"));
  else if (paused) updateChildHint(t(language, "pausedHint"));
  else if (selectedEmitter()) updateChildHint(t(language, "emitterSelectedHint"));
  else if (selectedObject()) updateChildHint(t(language, "selectedPartHint"));
  else if (!selectedObject()) updateChildHint(t(language, "stageHint"));
}

// 材質manifestのIDを編集欄のselectへ展開します
function renderMaterialOptions(currentId) {
  const select = document.getElementById("object-material");
  select.replaceChildren();
  for (const material of state.manifest.materials ?? []) {
    const option = document.createElement("option");
    option.value = material.id;
    option.textContent = material.id;
    option.selected = material.id === currentId;
    select.append(option);
  }
}

// 選択状態に応じて、普段使う移動操作と詳細設定の表示を切り替えます
function renderSelection() {
  const object = selectedObject();
  const emitter = selectedEmitter();
  const panel = document.getElementById("selection-panel");
  const empty = document.getElementById("selection-empty");
  if (panel) panel.hidden = !object && !emitter;
  if (empty) empty.hidden = !!object || !!emitter;
  if (object || emitter) {
    document.getElementById("selected-name").textContent = object?.name ?? object?.id ?? t(language, "emitter");
  }
  const detailsButton = document.getElementById("toggle-details");
  if (detailsButton) {
    detailsButton.hidden = !object;
    detailsButton.disabled = makerMode !== "edit";
    detailsButton.textContent = t(language, detailsOpen ? "closeDetails" : "details");
  }
  for (const id of ["turn-left", "turn-right", "duplicate-selected", "delete-selected"]) {
    const button = document.getElementById(id);
    if (button) button.hidden = !!emitter;
  }
}

// 選択中objectの定義を詳細設定欄へ表示します
function renderEditor() {
  const editor = document.getElementById("editor");
  const object = selectedObject();
  editor.hidden = !object || !detailsOpen;
  if (!object || !detailsOpen) return;
  const material = state.manifest.materials.find((entry) => entry.id === object.material);
  document.getElementById("object-id").value = object.id;
  document.getElementById("object-shape").value = object.shape.type;
  document.getElementById("object-body").value = object.physics?.bodyType ?? "display";
  for (const [axis, i] of [["x",0],["y",1],["z",2]]) document.getElementById(`position-${axis}`).value = object.transform?.position?.[i] ?? 0;
  document.getElementById("material-color").value = rgbToColor(material?.color ?? [1, 1, 1]);
  document.getElementById("material-roughness").value = material?.roughness ?? 0.5;
  document.getElementById("body-mass").value = object.physics?.mass ?? 1.0;
  renderMaterialOptions(object.material);
}

// 選択中の発射台の位置と発射設定を表示し、SceneYAMLのemitterへ戻せる状態にします
function renderEmitterEditor() {
  const editor = document.getElementById("emitter-editor");
  const emitter = selectedEmitter() ?? state?.manifest.emitters?.[0] ?? null;
  if (!editor) return;
  editor.hidden = !emitter || !emitterEditorOpen;
  if (!emitter) return;
  const position = emitter.spawnPosition ?? [0.0, 0.0, 0.0];
  document.getElementById("emitter-position-x").value = position[0];
  document.getElementById("emitter-position-y").value = position[1];
  document.getElementById("emitter-position-z").value = position[2];
  document.getElementById("emitter-interval").value = emitter.intervalSec ?? 2.0;
  document.getElementById("emitter-max").value = emitter.maxActive ?? 4;
}

// 選択中objectを3D Nodeへ同期し、編集した位置と回転をすぐに表示します
function syncObjectTo3d(object) {
  if (!preview3dApp || previewObjectEntries.size === 0) return;
  const entry = previewObjectEntries.get(object.id);
  if (!entry?.node) return;
  entry.node.setPosition(...(object.transform?.position ?? [0, 0, 0]));
  const euler = readObjectEuler(object);
  const quat = new Quat();
  quat.eulerToQuat(euler.yaw, euler.pitch, euler.roll);
  entry.node.setQuat(quat);
  preview3dApp.app.requestRender();
}

// 試運転中の一時bodyをResetと再構築でまとめて初期化し、編集画面へ結果を持ち越しません
function resetPreviewRuntimeState() {
  previewEmitterClock.reset();
  previewRuntimeBodies = [];
  previewSpawnedCount = 0;
  previewGoalState = { reached: new Set(), bodyReferences: new Map() };
  karakuriAudio.resetContactTracking();
  const result = document.getElementById("play-result");
  if (result) {
    result.hidden = true;
    result.textContent = "";
  }
}

// 3D previewを再構築するときに、現在のentry参照だけを切り替えます
// 同じGPUDeviceのpreviewではProcedural Material cacheを維持し、Compute生成を繰り返しません
function clearPreviewProceduralMaterials() {
  previewProceduralMaterials = new Map();
}

// ページ終了時やGPUDevice切替時にpreview用Procedural Textureを解放します
function destroyPreviewProceduralMaterials() {
  destroyKarakuriProceduralMaterialCache(previewProceduralCache);
  previewProceduralMaterials = new Map();
}

// SceneYAMLの材質manifestを、一時Nodeへ適用できるShape parameterへ変換します
function previewShapeMaterial(manifest, materialId) {
  const definition = readPrimitiveMaterialManifest(manifest.materials).get(materialId);
  if (!definition) throw new Error(`Karakuri material is unavailable: ${materialId}`);
  return structuredClone(definition.params);
}

// エミッターprototypeの形状を、Makerの試運転用Shapeへ変換します
function createPreviewRuntimeShape(app, manifest, prototype) {
  const shape = new Shape(app.app.getGPU());
  try {
    const options = shape.getPrimitiveOptions();
    const geometry = prototype.shape;
    const procedural = previewProceduralMaterials.get(prototype.material);
    if (procedural && geometry.type !== "box") {
      throw new Error(`${prototype.material} procedural texture requires a box shape for mapRealCuboid`);
    }
    if (geometry.type === "sphere") {
      shape.applyPrimitiveAsset(Primitive.sphere(geometry.radius, 32, 24, options));
    } else if (geometry.type === "box") {
      shape.applyPrimitiveAsset(procedural
        ? Primitive.mapRealCuboid(...geometry.size)
        : Primitive.cuboid(...geometry.size, options));
    } else if (geometry.type === "capsule") {
      shape.applyPrimitiveAsset(Primitive.capsule(geometry.radius, geometry.segmentLength, 12, 24, options));
    } else {
      throw new Error(`Karakuri emitter shape is unsupported: ${geometry.type}`);
    }
    if (procedural) procedural.applyTo(shape);
    shape.endShape();
    if (!procedural) shape.setMaterial(prototype.material, previewShapeMaterial(manifest, prototype.material));
    return shape;
  } catch (error) {
    shape.destroy();
    throw error;
  }
}

// 試運転で発射器から球を生成し、表示NodeとCompute bodyを同じ一時物体へ接続します
function spawnPreviewEmitterBall(app, manifest, emitter, ordinal) {
  const activeCount = previewRuntimeBodies.filter((entry) => entry.emitterId === emitter.id).length;
  if (activeCount >= emitter.maxActive) return false;
  let nodeId = `${emitter.id}-${String(ordinal + 1).padStart(4, "0")}`;
  const ids = new Set(app.app.space.nodes.map((node) => node.name));
  while (ids.has(nodeId)) nodeId += "-spawn";
  const node = app.app.space.addNode(null, nodeId);
  node.setPosition(...emitter.spawnPosition);
  try {
    node.addShape(createPreviewRuntimeShape(app, manifest, emitter.prototype));
    const physics = emitter.prototype.physics;
    const bodyId = app.physics.addBody(node, {
      ...physics,
      shape: physics.shape ?? emitter.prototype.shape,
      linearVelocity: emitter.initialVelocity,
      persistent: false
    });
    previewRuntimeBodies.push({ bodyId, node, emitterId: emitter.id, ageSec: 0.0, lifetimeSec: emitter.lifetimeSec });
    previewSpawnedCount += 1;
    return true;
  } catch (error) {
    app.app.space.removeNode(node, { destroyShapes: true });
    throw error;
  }
}

// 寿命を終えた試運転用bodyをCompute spaceとscene graphから解放します
function retirePreviewRuntimeBody(app, entry) {
  app.physics.removeBody(entry.bodyId);
  app.app.space.removeNode(entry.node, { destroyShapes: true });
  const index = previewRuntimeBodies.indexOf(entry);
  if (index >= 0) previewRuntimeBodies.splice(index, 1);
}

// 物理時間に合わせて試運転の発射器と一時bodyを進めます
function updatePreviewEmitter(app, manifest, simulationDeltaSec) {
  if (previewPaused || !manifest.emitters?.length) return;
  for (const entry of [...previewRuntimeBodies]) {
    entry.ageSec += simulationDeltaSec;
    if (entry.ageSec >= entry.lifetimeSec) retirePreviewRuntimeBody(app, entry);
  }
  for (const emitter of manifest.emitters) {
    previewEmitterClock.advance(
      emitter,
      simulationDeltaSec,
      (ordinal) => spawnPreviewEmitterBall(app, manifest, emitter, ordinal)
    );
  }
}

// readbackで確定した接触をゴールへ照合し、到達後も試運転を続けながら結果を見せます
function handlePreviewGoalContacts(app, contacts) {
  if (preview3dApp !== app || makerMode !== "running" || !state?.goals?.length || !contacts?.length) return [];
  previewGoalState.bodyReferences = createGoalBodyReferences(app, previewRuntimeBodies);
  const reached = findReachedGoals(state.goals, previewGoalState.bodyReferences, contacts, previewGoalState.reached);
  if (!reached.length) return reached;
  const result = document.getElementById("play-result");
  if (result) {
    result.textContent = reached.at(-1).message;
    result.hidden = false;
  }
  render();
  return reached;
}

// 試運転中の球の接触音、ゴール板への反発音、ゴール到達音をPlayerと同じ規則で再生します
function handlePreviewContactSounds(app, payload) {
  if (preview3dApp !== app) return;
  const contacts = payload?.contacts?.begin ?? [];
  const reached = handlePreviewGoalContacts(app, contacts);
  if (reached.length > 0) karakuriAudio.playGoal();

  const ballBodyIds = collectBallBodyIds(app, state?.manifest, previewRuntimeBodies);
  const ballContacts = contacts.filter((contact) => contactIncludesBody(contact, ballBodyIds));
  const ballGoalContact = ballContacts.some((contact) => contactIncludesGoalTarget(
    contact,
    previewGoalState.bodyReferences,
    state?.goals ?? []
  ));
  if (ballGoalContact) karakuriAudio.playGoalBounce();
  else if (ballContacts.length > 0) {
    karakuriAudio.playBounce();
  }
  const planeBegins = karakuriAudio.readPlaneContactBegins(
    payload?.physics,
    payload?.stateData,
    ballBodyIds
  );
  if (planeBegins.length > 0 && reached.length === 0) karakuriAudio.playBounce();
}

// 3D表示が選ばれているとき、最新の編集配置から描画と試運転のデータを再構築します
async function rebuild3dPreview(usePhysics = previewPhysics) {
  const startedAt = globalThis.performance?.now?.();
  const token = ++preview3dBuildToken;
  cancelCameraInteraction();
  previewPhysics = usePhysics;
  previewReady = false;
  previewQueue = previewQueue.then(async () => {
  if (token !== preview3dBuildToken) return;
  if (preview3dApp) {
    preview3dApp.destroy();
    preview3dApp = null;
  }
  previewEmitterVisuals = [];
  clearPreviewProceduralMaterials();
  previewObjectEntries = new Map();
  resetPreviewRuntimeState();
  if (viewMode !== "3d" || !state) return;
  let app = null;
  try {
    // ドラッグと回転で更新した編集データから、描画・物理・発射台に使う定義をまとめて作り直します
    // 検証が完了した定義へ切り替え、「ためす」「なおす」「はじめから」へ現在の配置を引き継ぎます
    const next = parseKarakuriDocument(stringifyKarakuriDocument(state.manifest, state), state.sourceUrl);
    state.project.destroy();
    state = next;

    // 検証済みの物体と材質を共有し、表示領域に合わせて調整するrendererを浅く複製します
    // WebgSceneAppへ現在の作品定義を渡し、描画と物理の初期配置を揃えて生成します
    const manifest = {
      ...state.projectManifest,
      renderer: {
        ...(state.projectManifest.renderer ?? {})
      }
    };
    manifest.renderer ??= {};
    const host = document.getElementById("preview-3d-host");
    manifest.renderer.width = Math.max(1, Math.round(host.clientWidth));
    manifest.renderer.height = Math.max(1, Math.round(host.clientHeight));
    manifest.renderer.dof = { enabled: false };
    app = await createWebgSceneApp({
      project: SceneDefinition.fromData(manifest),
      camera: PREVIEW_CAMERA,
      physics: usePhysics && manifest.physics?.space
        ? { enabled: true, spatialMatch: "report", paused: previewPaused }
        : false,
      effects: { shadow: true, ssao: true, ssr: true, dof: false },
      timeScale: state.playback.defaultTimeScale,
      label: "Karakuri Maker 3D preview",
      onPresented: () => render3dOverlay(),
      onUpdate: (frame) => {
        updateCameraReturn(app, frame.deltaSec);
        if (preview3dApp !== app || !usePhysics) return;
        try {
          updatePreviewEmitter(app, { ...manifest, emitters: state.emitters }, frame.deltaSec * app.getTimeScale());
        } catch (error) {
          previewPaused = true;
          app.setPaused(true);
          makerMode = "paused";
          reportError(error);
          render();
        }
      },
      onReadback: (payload) => handlePreviewContactSounds(app, payload),
      onError: (error) => {
        console.error("Karakuri Maker 3D preview failed:", error);
        setStatus(statusElement, `${t(language, "statusError")}\n${error?.message ?? String(error)}`, "error");
      }
    });
    if (previewProceduralCache.device !== undefined && previewProceduralCache.device !== app.app.getGPU().device) {
      // WebGPUDeviceをまたいだTexture再利用は許可せず、切替を検出した時点で旧cacheを解放します
      destroyPreviewProceduralMaterials();
    }
    const procedural = await prepareKarakuriProceduralMaterials(app, state.manifest, previewProceduralCache);
    if (token !== preview3dBuildToken) {
      app.destroy();
      return;
    }
    preview3dApp = app;
    previewObjectEntries = new Map((app.scene.entries ?? []).map((entry) => [entry.id, entry]));
    previewProceduralMaterials = procedural.materials;
    previewEmitterVisuals = state.emitters.map((emitter) => (
      createKarakuriEmitterVisual(app, state.manifest, emitter)
    ));
    app.app.viewAngle = 14;
    app.app.updateProjection();
    preview3dApp.start();
    if (preview3dApp.physics) preview3dApp.setPaused(previewPaused);
    previewReady = true;
    reportKarakuriTiming(
      "Maker preview build",
      startedAt,
      `${manifest.objects?.length ?? 0} objects, physics=${usePhysics}`
    );
    render3dOverlay();
    render();
  } catch (error) {
    previewEmitterVisuals = [];
    if (preview3dApp === app) {
      preview3dApp = null;
      destroyPreviewProceduralMaterials();
    }
    app?.destroy();
    console.error("Karakuri Maker 3D preview build failed:", error);
    setStatus(statusElement, `${t(language, "statusError")}\n${error?.message ?? String(error)}`, "error");
  }
  }).catch(reportError);
  return previewQueue;
}

// 現在のSceneYAMLをブラウザー内へ保存し、MakerからPlayerへ作品を渡せるようにします
function storeLocalScene() {
  if (!state) return;
  try {
    const startedAt = globalThis.performance?.now?.();
    const text = stringifyKarakuriDocument(state.manifest, state);
    globalThis.localStorage?.setItem(LOCAL_SCENE_KEY, text);
    reportKarakuriTiming("Maker local SceneYAML save", startedAt, `${text.length} bytes`);
  } catch (error) {
    console.error("Karakuri Maker local SceneYAML save failed:", error);
    setStatus(statusElement, `${t(language, "localSceneStorageError")}\n${error?.message ?? String(error)}`, "error");
  }
}

// 最初に確定したSceneYAMLを、Makerが使う初期配置として保存します
function rememberSavedInitialScene(text) {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return false;
    if (storage.getItem(LOCAL_INITIAL_SCENE_KEY) !== null) return "kept";
    storage.setItem(LOCAL_INITIAL_SCENE_KEY, text);
    return "set";
  } catch (error) {
    console.error("Karakuri Maker initial SceneYAML save failed:", error);
    return false;
  }
}

// 保存済みのSceneYAMLに標準起動速度の更新を適用します
function migrateStoredScene(text, key) {
  if (!text) return text;
  const migrated = migrateKarakuriStandardStartupTimeScale(text);
  if (migrated === text) return text;
  try { globalThis.localStorage?.setItem(key, migrated); }
  catch (error) { console.warn("Karakuri stored SceneYAML startup speed migration could not be saved", error); }
  return migrated;
}

async function readInitialScene() {
  let saved = null;
  try { saved = globalThis.localStorage?.getItem(LOCAL_INITIAL_SCENE_KEY) ?? null; }
  catch (error) { console.warn("Karakuri Maker initial SceneYAML unavailable; using samples/karakuri/karakuri_scene.yaml", error); }
  saved = migrateStoredScene(saved, LOCAL_INITIAL_SCENE_KEY);
  if (saved) return { text: saved, sourceUrl: "local:karakuri-maker-initial-scene.yaml" };
  const response = await fetch(DEFAULT_SCENE_URL);
  if (!response.ok) throw new Error(`Karakuri SceneYAML request failed: ${response.status}`);
  return { text: await response.text(), sourceUrl: DEFAULT_SCENE_URL };
}

// 2D表示、3D選択面、詳細欄を同時に更新し、現在のmanifestを画面へ反映します
function render() {
  if (!state) return;
  setEditingEnabled(!!state);
  renderPreview();
  render3dOverlay();
  renderSelection();
  renderEditor();
  renderEmitterEditor();
  renderChildControls();
}

function setEditingEnabled(enabled) {
  for (const element of document.querySelectorAll("button, input, select")) {
    if (!["language", "scene-file"].includes(element.id)) element.disabled = !enabled;
  }
}

// 選択したobjectを矢印で動かし、位置をSceneYAMLと表示Nodeへ同時に書き込みます
function moveSelected(axis, amount) {
  if (makerMode !== "edit") return;
  const object = selectedObject();
  if (!object) return;
  pushUndoSnapshot(state.manifest);
  object.transform ??= {};
  object.transform.position ??= [0, 0, 0];
  object.transform.position[axis] = clampToBounds(object.transform.position[axis] + amount, axis);
  syncObjectTo3d(object);
  storeLocalScene();
  render();
}

// 選択したobjectを回転させ、SceneYAMLの名前付きEuler角へ保存します
function turnSelected(amount) {
  if (makerMode !== "edit") return;
  const object = selectedObject();
  if (!object) return;
  pushUndoSnapshot(state.manifest);
  const euler = readObjectEuler(object);
  euler.roll += amount;
  writeObjectEuler(object, euler);
  syncObjectTo3d(object);
  storeLocalScene();
  render();
}

// Jointとanimationから選択中objectへの参照を調べ、削除後に残る参照を利用者へ知らせます
function objectRelations(objectId) {
  return findObjectRelations(state.manifest, objectId);
}

// 選択中objectをmanifestから削除し、参照切れを残さずにprojectを再検証します
function deleteSelected() {
  const object = selectedObject();
  if (!object) return;
  const relations = objectRelations(object.id);
  if (relations.length > 0) {
    setStatus(statusElement, `${t(language, "deleteBlocked")}\n${relations.join(", ")}`, "error");
    return;
  }
  if (!commitMutation(manifest => manifest.objects.splice(selectedIndex, 1))) return;
  selectedIndex = -1;
  detailsOpen = false;
  placement = null;
  render();
  setStatus(statusElement, t(language, "objectDeleted"), "ok");
  updateChildHint(t(language, "removed"), "ok");
}

// 選択中の部品を少し横へずらして複製し、同じ工作を続けて作れるようにします
function duplicateSelected() {
  const object = selectedObject();
  if (!object || makerMode !== "edit") return;
  const copy = structuredClone(object);
  copy.id = uniqueObjectId(state.manifest, object.shape.type);
  delete copy.name;
  copy.transform ??= {};
  copy.transform.position = [...(copy.transform.position ?? [0, 0, 0])];
  copy.transform.position[0] = clampToBounds(copy.transform.position[0] + 0.35, 0);
  if (!commitMutation(manifest => manifest.objects.push(copy))) return;
  selectedIndex = state.manifest.objects.length - 1;
  render();
  updateChildHint(t(language, "duplicated"), "ok");
}

// 編集履歴の一つ前へ戻し、同じ工作台に復元します
function undoLast() {
  if (makerMode !== "edit" || !undoStack.length) return;
  const manifest = undoStack.pop();
  try {
    const next = parseKarakuriDocument(stringifyKarakuriDocument(manifest), state.sourceUrl);
    state.project.destroy();
    state = next;
    storeLocalScene();
    selectedIndex = -1;
    selectedEmitterId = null;
    emitterEditorOpen = false;
    pendingPart = null;
    placement = null;
    void rebuild3dPreview(false);
    render();
    updateChildHint(t(language, "undone"), "ok");
  } catch (error) {
    reportError(error);
  }
}

// 試運転用の物理sceneを作り、編集前のmanifestを保ったまま動きを確認します
async function tryMachine() {
  if (!state || makerMode !== "edit") return;
  await karakuriAudio.resume();
  if (!state || makerMode !== "edit") return;
  pendingPart = null;
  placement = null;
  previewPaused = false;
  makerMode = "running";
  void rebuild3dPreview(true);
  render();
}

// 試運転の再生と停止を切り替え、現在の姿勢を観察できるようにします
function toggleMachinePause() {
  if (!preview3dApp || !previewReady || makerMode === "edit") return;
  previewPaused = makerMode === "running";
  makerMode = previewPaused ? "paused" : "running";
  if (preview3dApp.physics) preview3dApp.setPaused(previewPaused);
  render();
}

// 試運転を初期配置からやり直し、同じ作品の動きをもう一度確認します
function restartMachine() {
  if (makerMode === "edit" || !previewReady) return;
  previewPaused = false;
  makerMode = "running";
  void rebuild3dPreview(true);
  render();
}

// 試運転用sceneを破棄し、最後に確定した編集状態へ戻ります
function returnToEdit() {
  if (makerMode === "edit") return;
  previewPaused = true;
  previewPhysics = false;
  previewReady = false;
  makerMode = "edit";
  resetPreviewRuntimeState();
  void rebuild3dPreview(false);
  render();
}

// 「しまう」で保存した初期SceneYAMLを読み直し、現在の編集状態を初期配置へ戻します
async function resetSceneToDefault() {
  if (!state || makerMode !== "edit" || !previewReady) return;
  if (!globalThis.confirm?.(t(language, "resetSceneConfirm"))) return;
  const token = ++loadToken;
  setEditingEnabled(false);
  setStatus(statusElement, t(language, "statusLoading"), "info");
  try {
    const initial = await readInitialScene();
    const next = parseKarakuriDocument(initial.text, initial.sourceUrl);
    if (token !== loadToken) { next.project.destroy(); return; }
    ++preview3dBuildToken;
    preview3dApp?.destroy();
    preview3dApp = null;
    previewReady = false;
    resetPreviewRuntimeState();
    state.project.destroy();
    state = next;
    selectedIndex = -1;
    selectedEmitterId = null;
    emitterEditorOpen = false;
    pendingPart = null;
    placement = null;
    detailsOpen = false;
    dragState = null;
    emitterDragState = null;
    undoStack = [];
    makerMode = "edit";
    previewPhysics = false;
    previewPaused = true;
    storeLocalScene();
    render();
    void rebuild3dPreview(false);
    updateChildHint(t(language, "resetSceneDone"), "ok");
  } catch (error) {
    setEditingEnabled(true);
    reportError(error);
    render();
  }
}

// 詳細設定の変更をmanifestへ戻し、必要なときだけ3D形状と材質を再構築します
function installEditorEvents() {
  const update = (event) => {
    const object = selectedObject();
    if (!object) return;
    commitMutation(manifest => {
      const item = manifest.objects[selectedIndex];
      const input = event.target;
      switch (input.id) {
        case "object-id": {
          const id = input.value.trim();
          if (!id) throw new Error("Object ID is required");
          if (id !== item.id && objectRelations(item.id).length) throw new Error(`ID is referenced: ${objectRelations(item.id).join(", ")}`);
          item.id = id;
          break;
        }
        case "object-shape":
          item.shape = makeObject(input.value, selectedIndex).shape;
          if (item.physics?.shape) item.physics.shape = structuredClone(item.shape);
          break;
        case "object-material": item.material = input.value; break;
        case "object-body":
          if (input.value === "display") delete item.physics;
          else {
            item.physics ??= {};
            item.physics.bodyType = input.value;
            if (input.value === "dynamic") item.physics.mass ??= 1;
            else delete item.physics.mass;
          }
          break;
        case "material-color": {
          const alpha = manifest.materials.find(m => m.id === item.material)?.color?.[3] ?? 1;
          editObjectMaterial(manifest, item, { color: [...colorToRgb(input.value), alpha] });
          break;
        }
        case "material-roughness": editObjectMaterial(manifest, item, { roughness: readEditorNumber(input) }); break;
        case "body-mass":
          if (item.physics?.bodyType === "dynamic") item.physics.mass = readEditorNumber(input);
          break;
        default: {
          const axis = ["position-x", "position-y", "position-z"].indexOf(input.id);
          if (axis < 0) return;
          const value = readEditorNumber(input), bounds = state.world.editBounds;
          if (value < bounds.min[axis] || value > bounds.max[axis]) throw new Error(`${input.id}: range ${bounds.min[axis]} to ${bounds.max[axis]} m`);
          item.transform ??= {};
          item.transform.position ??= [0,0,0];
          item.transform.position[axis] = value;
        }
      }
    });
    render();
  };
  for (const id of ["object-id", "object-shape", "object-material", "object-body", "position-x", "position-y", "position-z", "material-color", "material-roughness", "body-mass"]) {
    document.getElementById(id).addEventListener("change", update);
  }
  const updateEmitterValue = (event) => {
    const input = event.target;
    const emitterId = selectedEmitterId ?? state?.manifest.emitters?.[0]?.id;
    if (!emitterId) return;
    try {
      const value = readEditorNumber(input);
      const axis = ["emitter-position-x", "emitter-position-y", "emitter-position-z"].indexOf(input.id);
      if (axis >= 0) {
        const bounds = state.world.editBounds;
        if (value < bounds.min[axis] || value > bounds.max[axis]) {
          throw new Error(`${input.id}: range ${bounds.min[axis]} to ${bounds.max[axis]} m`);
        }
      }
      if (!commitMutation((manifest) => {
        const emitter = manifest.emitters?.find((entry) => entry.id === emitterId);
        if (!emitter) return;
        if (axis >= 0) {
          emitter.spawnPosition ??= [0.0, 0.0, 0.0];
          emitter.spawnPosition[axis] = value;
        } else if (input.id === "emitter-interval") {
          emitter.intervalSec = value;
        } else if (input.id === "emitter-max") {
          emitter.maxActive = value;
        }
      }, false)) return;
      syncKarakuriEmitterVisual(previewEmitterVisuals.find((entry) => entry.emitterId === emitterId), selectedEmitter());
      render();
    } catch (error) {
      reportError(error);
      render();
    }
  };
  for (const id of ["emitter-position-x", "emitter-position-y", "emitter-position-z", "emitter-interval", "emitter-max"]) {
    document.getElementById(id).addEventListener("change", updateEmitterValue);
  }
}

// 2Dと3Dの表示切替を行い、3Dを選んだ最初の時点でpreviewを作ります
function installViewEvents() {
  document.getElementById("view-2d")?.addEventListener("click", () => {
    cancelCameraInteraction();
    viewMode = "2d";
    document.getElementById("view-2d").classList.add("selected");
    document.getElementById("view-3d").classList.remove("selected");
    document.getElementById("mini-preview").hidden = false;
    document.getElementById("preview-3d-host").hidden = true;
    ++preview3dBuildToken;
    preview3dApp?.stop();
    renderPlacementMarker();
  });
  document.getElementById("view-3d")?.addEventListener("click", () => {
    viewMode = "3d";
    document.getElementById("view-2d").classList.remove("selected");
    document.getElementById("view-3d").classList.add("selected");
    document.getElementById("mini-preview").hidden = true;
    document.getElementById("preview-3d-host").hidden = false;
    renderPlacementMarker();
    void rebuild3dPreview();
  });
  document.getElementById("mini-preview")?.addEventListener("click", setPlacementFromSideEvent);
  document.getElementById("canvas").addEventListener("pointerdown", beginCameraGesture);
  document.getElementById("canvas").addEventListener("pointermove", trackCameraGesture);
  document.getElementById("canvas").addEventListener("pointerdown", selectMesh);
  document.getElementById("canvas").addEventListener("pointerup", finishCameraGesture);
  document.getElementById("canvas").addEventListener("pointercancel", finishCameraGesture);
  document.getElementById("canvas").addEventListener("pointerleave", finishCameraGesture);
  document.addEventListener("pointermove", moveDraggedObject);
  document.addEventListener("pointerup", finishObjectDrag);
  document.addEventListener("pointercancel", finishObjectDrag);
  document.addEventListener("pointerup", finishEmitterDrag);
  document.addEventListener("pointercancel", finishEmitterDrag);
  window.addEventListener("blur", handleCameraBlur);
  document.getElementById("toggle-details")?.addEventListener("click", () => {
    if (!selectedObject()) return;
    detailsOpen = !detailsOpen;
    render();
  });
  document.getElementById("delete-selected").addEventListener("click", deleteSelected);
  
  document.getElementById("duplicate-selected")?.addEventListener("click", duplicateSelected);
  document.getElementById("undo")?.addEventListener("click", undoLast);
  document.getElementById("try")?.addEventListener("click", tryMachine);
  document.getElementById("pause")?.addEventListener("click", toggleMachinePause);
  document.getElementById("restart")?.addEventListener("click", restartMachine);
  document.getElementById("back-edit")?.addEventListener("click", returnToEdit);
  for (const [id, axis, amount] of [["move-left", 0, -0.15], ["move-right", 0, 0.15], ["move-up", 1, 0.15], ["move-down", 1, -0.15]]) {
    document.getElementById(id)?.addEventListener("click", () => moveSelected(axis, amount));
  }
  document.getElementById("turn-left")?.addEventListener("click", () => turnSelected(8));
  document.getElementById("turn-right")?.addEventListener("click", () => turnSelected(-8));
  document.getElementById("close-emitter-details")?.addEventListener("click", () => {
    emitterEditorOpen = false;
    render();
  });
}

// primitive追加ボタンをmanifestのobjectsへ接続し、マーク位置へ新しいobjectを置きます
function installAddButtons() {
  for (const [id, type] of [["add-box", "box"], ["add-sphere", "sphere"], ["add-ramp", "ramp"], ["add-domino", "domino"], ["add-goal", "goal"]]) {
    document.getElementById(id).addEventListener("click", () => {
      if (!state || makerMode !== "edit") return;
      pendingPart = type;
      placement = null;
      render();
      updateChildHint(t(language, "placedHint"));
    });
  }
  document.getElementById("add-emitter").addEventListener("click", () => {
    if (!state || makerMode !== "edit") return;
    pendingPart = "emitter";
    placement = null;
    render();
    updateChildHint(t(language, "placedHint"));
  });
}

// SceneYAMLの保存ボタンへplain textとgzipの二つの保存形式を接続します
function installFileEvents() {
  const validatedText = () => {
    const text = stringifyKarakuriDocument(state.manifest, state);
    const checked = parseKarakuriDocument(text, state.sourceUrl);
    checked.project.destroy();
    return text;
  };
  document.getElementById("download").addEventListener("click", () => {
    try {
    const text = validatedText();
    downloadBlob(new Blob([text], { type: "text/yaml" }), "karakuri_scene.yaml");
    const saved = rememberSavedInitialScene(text);
    const message = saved === "set" ? "initialSceneSaved" : saved === "kept" ? "sceneSaved" : "localSceneStorageError";
    setStatus(statusElement, t(language, message), saved ? "ok" : "error");
    } catch (error) { reportError(error); }
  });
  document.getElementById("download-gzip").addEventListener("click", async () => {
    try {
    const text = validatedText();
    const blob = await compressSceneYAML(text);
    downloadBlob(blob, "karakuri_scene.yaml.gz");
    const saved = rememberSavedInitialScene(text);
    const message = saved === "set" ? "initialSceneSaved" : saved === "kept" ? "sceneSaved" : "localSceneStorageError";
    setStatus(statusElement, t(language, message), saved ? "ok" : "error");
    } catch (error) { reportError(error); }
  });
  document.getElementById("reset-scene").addEventListener("click", () => { void resetSceneToDefault(); });
  document.getElementById("scene-file").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const token = ++loadToken;
    try {
      setStatus(statusElement, t(language, "statusLoading"));
      const next = parseKarakuriDocument(await readKarakuriText(file, file.name), file.name);
      if (token !== loadToken) { next.project.destroy(); return; }
      preview3dApp?.destroy();
      preview3dApp = null;
      previewEmitterVisuals = [];
      destroyPreviewProceduralMaterials();
      makerMode = "edit";
      previewPhysics = false;
      previewPaused = true;
      undoStack = [];
      pendingPart = null;
      placement = null;
      state?.project.destroy();
      state = next;
      storeLocalScene();
      selectedIndex = -1;
      selectedEmitterId = null;
      emitterEditorOpen = false;
      placement = null;
      detailsOpen = false;
      emitterDragState = null;
      render();
      void rebuild3dPreview();
      setStatus(statusElement, `${t(language, "statusReady")}  ${file.name}`, "ok");
    } catch (error) {
      console.error("Karakuri Maker SceneYAML load failed:", error);
      setStatus(statusElement, `${t(language, "statusError")}\n${error?.message ?? String(error)}`, "error");
    } finally { event.target.value = ""; }
  });
}

// Makerの言語切替を共有辞書へ接続します
function installLanguage() {
  applyLanguage(document, language);
  document.getElementById("language").addEventListener("click", () => {
    language = setLanguage(language === "ja" ? "en" : "ja");
    applyLanguage(document, language);
    render();
  });
}

// 初期SceneYAMLを読み、クリック編集画面へ展開します
async function start() {
  statusElement = document.getElementById("status");
  setEditingEnabled(false);
  installLanguage();
  installViewEvents();
  installEditorEvents();
  installAddButtons();
  installFileEvents();
  const token = ++loadToken;
  // 通常起動では保存済みSceneYAMLを使わず、リポジトリの標準SceneYAMLを読み込みます
  const response = await fetch(DEFAULT_SCENE_URL);
  if (!response.ok) throw new Error(`Karakuri SceneYAML request failed: ${response.status}`);
  const text = await response.text();
  const next = parseKarakuriDocument(text, DEFAULT_SCENE_URL);
  if (token !== loadToken) { next.project.destroy(); return; }
  state = next;
  render();
  void rebuild3dPreview(false);
  setStatus(statusElement, `${t(language, "statusReady")}  karakuri_scene.yaml`, "ok");
}

document.addEventListener("DOMContentLoaded", () => {
  start().catch((error) => {
    console.error("Karakuri Maker failed:", error);
    setStatus(statusElement, `${t(language, "statusError")}\n${error?.message ?? String(error)}`, "error");
  });
});

window.addEventListener("pagehide", () => {
  ++preview3dBuildToken;
  cancelCameraInteraction();
  preview3dApp?.destroy();
  preview3dApp = null;
  destroyPreviewProceduralMaterials();
});
