// ---------------------------------------------
//  karakuri_player.js  2026/09/23
//   SceneYAML-driven Karakuri Player with PBR, Compute physics, and emitters
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";
import { createWebgSceneApp } from "../../webg/app/index.js";
import { EmitterClock } from "./emitter_clock.js";
import { createKarakuriEmitterVisual } from "./emitter_visual.js";
import { createGoalBodyReferences, findReachedGoals, goalContactMatches, contactIncludesGoalTarget } from "./goal_runtime.js";
import { KarakuriAudio, collectBallBodyIds, contactIncludesBody } from "./karakuri_audio.js";
import { readPrimitiveMaterialManifest } from "../../webg/app/PrimitiveScene.js";
import {
  getLanguage,
  applyLanguage,
  setLanguage,
  setStatus,
  formatTimeScale,
  t
} from "./karakuri_shared.js";
import {
  parseKarakuriDocument,
  migrateKarakuriStandardStartupTimeScale,
  destroyKarakuriProceduralMaterialCache,
  prepareKarakuriProceduralMaterials,
  reportKarakuriTiming,
  readKarakuriText
} from "./scene_document.js";

const DEFAULT_SCENE_URL = "./karakuri_scene.yaml?v=20260917r2";
const LOCAL_SCENE_KEY = "karakuri-maker-scene-yaml-v2";
const CAMERA_OPTIONS = {
  target: [0.0, 1.15, 0.0],
  distance: 8.0,
  yaw: 0.0,
  pitch: -13.0,
  minDistance: 3.5,
  maxDistance: 13.0,
  wheelZoomStep: 0.45,
  focusTarget: "ramp"
};

let language = getLanguage();
let sceneApp = null;
let documentState = null;
let proceduralMaterials = new Map();
const proceduralCache = { manager: null, device: undefined, materialsByKey: new Map() };
let emitterVisuals = [];
let runtimeBodies = [];
let spawnedCount = 0;
const emitterClock = new EmitterClock();
let paused = true;
let statusElement = null;
let controlsInstalled = false;
let loading = false;
let statusError = null;
let loadSerial = 0;
let loadQueue = Promise.resolve();
let fileRequest = 0;
let goalState = null;
const karakuriAudio = new KarakuriAudio();

function showError(error) {
  statusError = error?.message ?? String(error);
  setStatus(statusElement, `${t(language, "statusError")}\n${statusError}`, "error");
}

// ゴール表示と試運転の到達状態を一つの状態へまとめます
function resetGoalState() {
  goalState = {
    reached: new Set(),
    bodyReferences: new Map()
  };
  karakuriAudio.resetContactTracking();
  const element = document.getElementById("goal-message");
  if (element) {
    element.hidden = true;
    element.textContent = "";
  }
}

// readbackで確定した接触からゴールを判定し、到達後も動きを続けながら結果を見せます
function handleGoalContacts(contacts) {
  if (!goalState || !documentState?.goals?.length || !contacts?.length) return [];
  goalState.bodyReferences = createGoalBodyReferences(sceneApp, runtimeBodies);
  const reached = findReachedGoals(documentState.goals, goalState.bodyReferences, contacts, goalState.reached);
  if (!reached.length) return reached;
  const element = document.getElementById("goal-message");
  if (element) {
    element.textContent = reached.at(-1).message;
    element.hidden = false;
  }
  return reached;
}

// 球の部品接触と床・壁Plane接触をまとめ、ゴール板への反発音と到達音を分けて鳴らします
function handleContactSounds(payload) {
  const contacts = payload?.contacts?.begin ?? [];
  const reached = handleGoalContacts(contacts);
  if (reached.length > 0) karakuriAudio.playGoal();

  const ballBodyIds = collectBallBodyIds(sceneApp, documentState?.manifest, runtimeBodies);
  const ballContacts = contacts.filter((contact) => contactIncludesBody(contact, ballBodyIds));
  const ballGoalContact = ballContacts.some((contact) => contactIncludesGoalTarget(
    contact,
    goalState?.bodyReferences ?? new Map(),
    documentState?.goals ?? []
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

function renderSpeedControls() {
  const container = document.getElementById("speed-controls");
  if (!container) return;
  container.setAttribute("aria-label", t(language, "speed"));
  const options = documentState?.playback?.timeScaleOptions ?? [];
  const optionKey = options.join(",");
  if (container.dataset.optionsKey !== optionKey) {
    container.querySelectorAll(".speed-button").forEach((button) => button.remove());
    for (const value of options) {
      const button = document.createElement("button");
      button.className = "button speed-button";
      button.type = "button";
      button.dataset.scale = String(value);
      button.textContent = formatTimeScale(value);
      button.title = `${t(language, "speed")}: ${button.textContent}`;
      button.addEventListener("click", () => {
        if (!sceneApp || loading) return;
        sceneApp.setTimeScale(Number(value));
        renderSpeedControls();
        updateStatus();
      });
      container.append(button);
    }
    container.dataset.optionsKey = optionKey;
  }
  const current = sceneApp?.getTimeScale();
  for (const button of container.querySelectorAll(".speed-button")) {
    const active = Number(button.dataset.scale) === current;
    button.disabled = !sceneApp || loading;
    button.classList.toggle("selected", active);
    button.setAttribute("aria-pressed", String(active));
  }
}

function setControlsEnabled(enabled) {
  for (const id of ["start", "stop", "reset"]) document.getElementById(id).disabled = !enabled;
  renderSpeedControls();
}

// SceneYAMLのPBR値をShapeが受け取るmaterial parameterへ変換します
// Procedural Textureが生成されるまでの表示と、エミッター球の初期材質を同じ値から作ります
function toShapeMaterial(materialId) {
  const definition = readPrimitiveMaterialManifest(documentState.projectManifest.materials).get(materialId);
  if (!definition) throw new Error(`Karakuri material is unavailable: ${materialId}`);
  return structuredClone(definition.params);
}

// primitive形状からShapeを作成し、物理と描画で共有する同じ寸法を設定します
function createRuntimeShape(prototype) {
  const shape = new Shape(sceneApp.app.getGPU());
  try {
  const primitiveOptions = shape.getPrimitiveOptions();
  const geometry = prototype.shape;
  const procedural = proceduralMaterials.get(prototype.material);
  if (procedural && geometry.type !== "box") {
    throw new Error(`${prototype.material} procedural texture requires a box shape for mapRealCuboid`);
  }
  if (geometry.type === "sphere") {
    shape.applyPrimitiveAsset(Primitive.sphere(geometry.radius, 32, 24, primitiveOptions));
  } else if (geometry.type === "box") {
    shape.applyPrimitiveAsset(procedural
      ? Primitive.mapRealCuboid(...geometry.size)
      : Primitive.cuboid(...geometry.size, primitiveOptions));
  } else if (geometry.type === "capsule") {
    shape.applyPrimitiveAsset(Primitive.capsule(geometry.radius, geometry.segmentLength, 12, 24, primitiveOptions));
  } else {
    throw new Error(`Karakuri emitter shape is unsupported: ${geometry.type}`);
  }
  if (procedural) procedural.applyTo(shape);
  shape.endShape();
  if (!procedural) shape.setMaterial(prototype.material, toShapeMaterial(prototype.material));
  return shape;
  } catch (error) { shape.destroy(); throw error; }
}

// エミッターのprototypeから新しい表示NodeとCompute bodyを同時に作ります
// persistent:falseを指定し、Reset時にMakerで定義した初期物体へ戻せるようにします
function spawnEmitterBall(emitter, ordinal) {
  const activeCount = runtimeBodies.filter((entry) => entry.emitterId === emitter.id).length;
  if (activeCount >= emitter.maxActive) return false;
  let nodeId = `${emitter.id}-${String(ordinal + 1).padStart(4, "0")}`;
  const ids = new Set(sceneApp.app.space.nodes.map(node => node.name));
  while (ids.has(nodeId)) nodeId += "-spawn";
  const node = sceneApp.app.space.addNode(null, nodeId);
  node.setPosition(...emitter.spawnPosition);
  let bodyId;
  try {
  node.addShape(createRuntimeShape(emitter.prototype));
  const physics = emitter.prototype.physics;
  bodyId = sceneApp.physics.addBody(node, {
    ...physics,
    shape: physics.shape ?? emitter.prototype.shape,
    linearVelocity: emitter.initialVelocity,
    persistent: false
  });
  } catch (error) { sceneApp.app.space.removeNode(node, { destroyShapes: true }); throw error; }
  runtimeBodies.push({ bodyId, node, emitterId: emitter.id, ageSec: 0.0, lifetimeSec: emitter.lifetimeSec });
  spawnedCount += 1;
  return true;
}

// 寿命を終えた一時bodyをCompute space、binding、scene graphから同じ順序で解放します
function retireRuntimeBody(entry) {
  sceneApp.physics.removeBody(entry.bodyId);
  sceneApp.app.space.removeNode(entry.node, { destroyShapes: true });
  const index = runtimeBodies.indexOf(entry);
  if (index >= 0) runtimeBodies.splice(index, 1);
}

// 物理時間倍率に合わせてエミッターの発射間隔を進め、球の数と寿命を整えます
function updateEmitter(simulationDeltaSec) {
  if (paused || documentState.emitters.length === 0) return;
  for (const entry of [...runtimeBodies]) {
    entry.ageSec += simulationDeltaSec;
    if (entry.ageSec >= entry.lifetimeSec) retireRuntimeBody(entry);
  }
  for (const emitter of documentState.emitters) emitterClock.advance(emitter, simulationDeltaSec, ordinal => spawnEmitterBall(emitter, ordinal));
}

// 物理、エミッター、速度倍率の状態を画面へ表示し、動作確認の観測点を一つにします
function updateStatus() {
  if (!sceneApp || !statusElement || loading || statusError) return;
  renderSpeedControls();
  const diagnostics = sceneApp.getDiagnostics();
  const physics = diagnostics.physics;
  const renderer = diagnostics.renderer;
  setStatus(statusElement, [
    `${t(language, "statusReady")}  ${paused ? t(language, "stop") : t(language, "start")}`,
    `objects: ${diagnostics.project.objectCount ?? 0}  bodies: ${physics?.bodyCount ?? 0}`,
    `emitted: ${spawnedCount}  active: ${runtimeBodies.length}`,
    ...(documentState.goals.length > 0 ? [`goals: ${goalState?.reached.size ?? 0}/${documentState.goals.length}`] : []),
    ...[...emitterClock.states].map(([id, s]) => `${id}: ${s.count}${s.waiting ? " (waiting for a free slot)" : ""}`),
    `time scale: ${sceneApp.getTimeScale().toFixed(2)}`,
    `PBR: ${renderer.profile}  SSAO: on  SSR: on  DoF: weak`,
    "Drag: orbit   Wheel: zoom"
  ].join("\n"), "ok");
}

// Start／Stop／Resetと速度変更をPlayerの共通操作へ接続します
function installControls() {
  if (controlsInstalled) return;
  controlsInstalled = true;
  document.getElementById("start").addEventListener("click", async () => {
    if (!sceneApp || loading || !paused) return;
    try {
      await karakuriAudio.resume();
      for (const id of sceneApp.getAnimationIds()) {
        const status = sceneApp.getAnimationState(id).status;
        if (status === "paused") sceneApp.resumeAnimation(id);
        else if (status !== "playing") sceneApp.playAnimation(id);
      }
      if (sceneApp.physics) sceneApp.setPaused(false);
      paused = false;
      statusError = null;
      sceneApp.start();
      updateStatus();
    } catch (error) {
      for (const id of sceneApp.getAnimationIds()) sceneApp.pauseAnimation(id);
      showError(error);
    }
  });
  document.getElementById("stop").addEventListener("click", () => {
    paused = true;
    if (sceneApp.physics) sceneApp.setPaused(true);
    for (const id of sceneApp.getAnimationIds()) sceneApp.pauseAnimation(id);
    updateStatus();
  });
  document.getElementById("reset").addEventListener("click", () => {
    paused = true;
    for (const entry of [...runtimeBodies]) retireRuntimeBody(entry);
    if (sceneApp.physics) sceneApp.setPaused(true);
    sceneApp.reset();
    spawnedCount = 0;
    emitterClock.reset();
    resetGoalState();
    statusError = null;
    sceneApp.setTimeScale(documentState.playback.defaultTimeScale);
    updateStatus();
  });
}

// 選択したSceneYAMLを読み、現在のPlayerをそのデータで再構築します
async function loadSceneText(text, sourceUrl) {
  // Validate before touching the current scene. Prepare GPU resources on a separate canvas.
  const startedAt = globalThis.performance?.now?.();
  const nextState = parseKarakuriDocument(text, sourceUrl);
  const serial = ++loadSerial;
  const work = loadQueue.then(async () => {
  if (serial !== loadSerial) { nextState.project.destroy(); return; }
  loading = true;
  setControlsEnabled(false);
  const previous = sceneApp;
  previous?.stop();
  let candidate = null, procedural = null;
  const canvas = document.createElement("canvas");
  canvas.id = "canvas";
  const scopedDocument = new Proxy(document, {
    get(target, key) {
      if (key === "getElementById") return id => id === "canvas" ? canvas : document.getElementById(id);
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  try {
  const bounds = nextState.world.editBounds;
  const center = bounds.min.map((v, i) => (v + bounds.max[i])/2);
  const camera = { ...CAMERA_OPTIONS, target: center, focusTarget: nextState.manifest.objects[0]?.id };
  candidate = await createWebgSceneApp({
    project: nextState.project,
    document: scopedDocument,
    camera,
    physics: nextState.manifest.physics?.space ? { enabled: true, spatialMatch: "report", paused: true } : false,
    effects: { shadow: true, ssao: true, ssr: true, dof: true },
    timeScale: nextState.playback.defaultTimeScale,
    onUpdate: (frame) => {
      if (sceneApp !== candidate || loading || statusError) return;
      try { updateEmitter(frame.deltaSec * candidate.getTimeScale()); }
      catch (error) {
        paused = true;
        if (candidate.physics) candidate.setPaused(true);
        for (const id of candidate.getAnimationIds()) candidate.pauseAnimation(id);
        showError(error);
      }
    },
    onReadback: (payload) => {
      handleContactSounds(payload);
      updateStatus();
    },
    onPresented: updateStatus,
    onError: (error) => {
      console.error("Karakuri Player runtime failed:", error);
      paused = true;
      if (candidate?.physics) candidate.setPaused(true);
      candidate?.stop();
      showError(error);
    }
  });
  if (proceduralCache.device !== undefined && proceduralCache.device !== candidate.app.getGPU().device) {
    // WebGPUDeviceをまたいだTexture再利用は許可せず、切替時に旧cacheを明示的に解放します
    destroyKarakuriProceduralMaterialCache(proceduralCache);
  }
  procedural = await prepareKarakuriProceduralMaterials(candidate, nextState.manifest, proceduralCache);
  if (serial !== loadSerial) {
    candidate.destroy(); return;
  }
  emitterVisuals = nextState.emitters.map((emitter) => (
    createKarakuriEmitterVisual(candidate, nextState.manifest, emitter)
  ));
  for (const entry of [...runtimeBodies]) retireRuntimeBody(entry);
  sceneApp?.destroy();
  document.getElementById("canvas").replaceWith(canvas);
  sceneApp = candidate;
  documentState = nextState;
  renderSpeedControls();
  proceduralMaterials = procedural.materials;
  runtimeBodies = [];
  spawnedCount = 0;
  emitterClock.reset();
  resetGoalState();
  paused = true;
  statusError = null;
  installControls();
  sceneApp.start();
  reportKarakuriTiming(
    "Player scene load",
    startedAt,
    `${nextState.manifest.objects?.length ?? 0} objects, ${nextState.manifest.physics?.space ? "physics" : "display-only"}`
  );
  } catch (error) {
    candidate?.destroy();
    nextState.project.destroy();
    throw error;
  } finally {
    loading = false;
    if (previous && sceneApp === previous) previous.start();
    setControlsEnabled(!!sceneApp);
    updateStatus();
  }
  });
  loadQueue = work.catch(() => {});
  return work;
}

// 言語ボタンとSceneYAMLファイル選択をPlayerへ接続します
function installPageControls() {
  applyLanguage(document, language);
  document.getElementById("language").addEventListener("click", () => {
    language = setLanguage(language === "ja" ? "en" : "ja");
    applyLanguage(document, language);
    renderSpeedControls();
    updateStatus();
  });
  document.getElementById("scene-file").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const request = ++fileRequest;
    try {
      setStatus(statusElement, t(language, "statusLoading"));
      const text = await readKarakuriText(file, file.name);
      if (request !== fileRequest) return;
      await loadSceneText(text, file.name);
    } catch (error) {
      console.error("Karakuri SceneYAML load failed:", error);
      showError(error);
    } finally { event.target.value = ""; }
  });
}

// Playerを初期化し、SceneYAML、PBR、Compute physicsの接続結果を画面へ表示します
async function start() {
  statusElement = document.getElementById("status");
  setControlsEnabled(false);
  installPageControls();
  const source = new URLSearchParams(globalThis.location.search).get("source");
  // 通常起動では保存済みSceneYAMLを使わず、リポジトリの標準SceneYAMLを読み込みます
  if (source === "maker") {
    let localText;
    try { localText = globalThis.localStorage?.getItem(LOCAL_SCENE_KEY); }
    catch (error) { throw error; }
    if (!localText) {
      throw new Error("Karakuri Maker has no saved SceneYAML. Return to Maker and create a scene first.");
    }
    const migrated = migrateKarakuriStandardStartupTimeScale(localText);
    if (migrated !== localText) {
      localText = migrated;
      try { globalThis.localStorage?.setItem(LOCAL_SCENE_KEY, migrated); }
      catch (error) { console.warn("Karakuri Player startup speed migration could not be saved", error); }
    }
    await loadSceneText(localText, "local:karakuri-maker-scene.yaml");
    return;
  }
  const response = await fetch(DEFAULT_SCENE_URL);
  if (!response.ok) throw new Error(`Karakuri SceneYAML request failed: ${response.status}`);
  await loadSceneText(await response.text(), DEFAULT_SCENE_URL);
}

document.addEventListener("DOMContentLoaded", () => {
  start().catch((error) => {
    console.error("Karakuri Player failed:", error);
    showError(error);
  });
});

// ページ終了時にNode、Compute body、Procedural TextureのGPU資源を順に解放します
window.addEventListener("pagehide", () => {
  ++loadSerial;
  for (const entry of [...runtimeBodies]) {
    try { retireRuntimeBody(entry); } catch (error) { console.warn(error); }
  }
  destroyKarakuriProceduralMaterialCache(proceduralCache);
  emitterVisuals = [];
  sceneApp?.destroy();
  sceneApp = null;
});
