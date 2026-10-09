// ---------------------------------------------
// samples/compute_physics/cpu_main.js  2026/09/23
//   PhysicsSpace mixed-shape comparison sample
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import WebgApp from "../../webg/WebgApp.js";
import BoxCollider from "../../webg/BoxCollider.js";
import CapsuleCollider from "../../webg/CapsuleCollider.js";
import PhysicsSpace from "../../webg/PhysicsSpace.js";
import PlaneCollider from "../../webg/PlaneCollider.js";
import Primitive from "../../webg/Primitive.js";
import Quat from "../../webg/Quat.js";
import Shape from "../../webg/Shape.js";
import SphereCollider from "../../webg/SphereCollider.js";
import { buildErrorPanelOptions, buildHelpPanelOptions } from "../../webg/OverlayPanelPresets.js";
import {
  COMPUTE_PHYSICS_BOUNDS,
  COMPUTE_PHYSICS_SCALE,
  COMPUTE_PHYSICS_WORLD,
  createComputePhysicsScenario
} from "./computePhysicsScenario.js";

// 同じscenarioをCPU PhysicsSpaceへ渡し、Compute版と動作・速度を画面上で比較します
// CPU版はPhysicsNodeとscene graphを使い、Box・Sphere・Capsuleを同一反復で解くmixed Spaceを確認します
const SCENARIO = createComputePhysicsScenario();
const CLEAR_COLOR = Object.freeze([0.018, 0.035, 0.052, 1.0]);
const CAMERA = Object.freeze({
  target: [0.0, 2.8, 0.0],
  distance: 10.5,
  yaw: 22.0,
  pitch: -17.0,
  minDistance: 5.0,
  maxDistance: 22.0
});
const RAD_TO_DEG = 180.0 / Math.PI;
const CAPSULE_HEMISPHERE_SEGMENTS = 12;
const CAPSULE_LONGITUDE_SEGMENTS = 24;
const FLOOR_THICKNESS = 0.035;

let app = null;
let runtime = null;
let paused = false;
let lastHelpText = "";
let lastHelpStateKey = "";
let frameHandlers = null;
let idleRenderListeners = [];

// Compute版のreferenceLengthと比率からCPU PhysicsSpaceの数値条件を組み立てます
// coupled contact反復が使う値を同じscenarioから受け取り、backend別の調整を避けます
function createCpuPhysicsSpace() {
  const world = COMPUTE_PHYSICS_WORLD;
  const scale = COMPUTE_PHYSICS_SCALE;
  const referenceLength = world.referenceLength;
  return new PhysicsSpace({
    gravity: world.gravity,
    fixedTimeStepMs: world.fixedTimeStepMs,
    maxSubSteps: world.maxSubSteps,
    solverIterations: world.solverIterations,
    broadphaseMode: "sweepAabb",
    defaultRestitution: world.defaultRestitution,
    defaultFriction: world.defaultFriction,
    persistentSleep: world.persistentSleep,
    positionCorrectionBeta: 1.0,
    positionCorrectionSlop: referenceLength * scale.positionSlopRatio,
    computeBoxBroadphasePadding: referenceLength * scale.broadphasePaddingRatio,
    computeBoxSupportFeatureTolerance: referenceLength * scale.supportFeatureToleranceRatio,
    restingRestitutionSpeed: referenceLength * scale.restingRestitutionSpeedRatio,
    sleepLinearThreshold: referenceLength * scale.sleepLinearSpeedRatio,
    sleepAngularThreshold: scale.sleepAngularSpeed * RAD_TO_DEG,
    sleepContactSpeed: referenceLength * scale.sleepContactSpeedRatio,
    sleepNormalSpeed: referenceLength * scale.sleepNormalSpeedRatio,
    sleepStepsThreshold: scale.sleepSteps,
    minimumFloorSupportPoints: scale.minimumFloorSupportPoints,
    wakeLinearSpeed: referenceLength * scale.wakeLinearSpeedRatio,
    wakeAngularSpeed: scale.wakeAngularSpeed * RAD_TO_DEG,
    revisitBodyContactImpulses: true
  });
}

// 共通shape descriptorをCPU Colliderへ変換します
// shape.typeを寸法から推測せず、Compute版と同じ明示的な形状種別をPhysicsNodeへ渡します
function createCpuCollider(shape) {
  if (shape.type === "box") return new BoxCollider(shape.size);
  if (shape.type === "sphere") return new SphereCollider(shape.radius);
  if (shape.type === "capsule") return new CapsuleCollider(shape.radius, shape.segmentLength);
  throw new Error(`compute_physics CPU shape type is unsupported: ${shape.type}`);
}

// 共通quaternion配列をPhysicsNodeが受け取れるQuatへ変換します
// CPUの姿勢入力だけをdegree系へ変換し、Compute側の共通配列は共有します
function createCpuQuat(values) {
  if (!Array.isArray(values) || values.length !== 4) {
    throw new Error("compute_physics CPU orientation must contain four values");
  }
  const quat = new Quat();
  quat.q[0] = values[0];
  quat.q[1] = values[1];
  quat.q[2] = values[2];
  quat.q[3] = values[3];
  quat.normalize();
  return quat;
}

// body descriptorからCPU用のPhysicsNodeと描画Shapeを作ります
// PhysicsSpaceへ登録するNodeと描画Shapeを同じbody番号で保持し、統計と表示の対象を一致させます
function createCpuBody(physics, body, index) {
  const node = app.space.addPhysicsNode(null, `compute-physics-cpu-${body.id}`, {
    bodyType: body.bodyType,
    mass: body.mass,
    gravityScale: body.gravityScale,
    linearDamping: body.material.linearDamping,
    angularDamping: body.material.angularDamping,
    allowSleep: body.allowSleep,
    isSleeping: body.isSleeping,
    isTrigger: body.isTrigger,
    fixedRotation: body.fixedRotation,
    collisionLayer: body.collisionLayer,
    collisionMask: body.collisionMask,
    material: body.material,
    collider: createCpuCollider(body.shape)
  });
  node.syncNodeFromPhysics(body.position, { quat: createCpuQuat(body.orientation) });
  node.setLinearVelocityVec(body.linearVelocity);
  node.setAngularVelocityVec(body.angularVelocity.map((value) => value * RAD_TO_DEG));
  const shape = createCpuShape(app.getGPU(), body);
  node.addShape(shape);
  physics.addBody(node, body.id);
  return Object.freeze({ body, index, node, shape });
}

// 共通body descriptorの形状を通常のShapeへ変換し、CPU版のscene graph描画へ接続します
// Shapeの寸法とColliderの寸法を同じdescriptorから作るため、表示と接触の形状をそろえます
function createCpuShape(gpu, body) {
  const shape = new Shape(gpu);
  if (body.shape.type === "box") {
    shape.applyPrimitiveAsset(Primitive.cuboid(
      body.shape.size[0], body.shape.size[1], body.shape.size[2], shape.getPrimitiveOptions()
    ));
  } else if (body.shape.type === "sphere") {
    shape.applyPrimitiveAsset(Primitive.sphere(body.shape.radius, 18, 24, shape.getPrimitiveOptions()));
  } else if (body.shape.type === "capsule") {
    shape.applyPrimitiveAsset(Primitive.capsule(
      body.shape.radius,
      body.shape.segmentLength,
      CAPSULE_HEMISPHERE_SEGMENTS,
      CAPSULE_LONGITUDE_SEGMENTS,
      shape.getPrimitiveOptions()
    ));
  } else {
    throw new Error(`compute_physics CPU shape rendering is unsupported: ${body.shape.type}`);
  }
  shape.endShape();
  shape.setMaterial("smooth-shader", {
    has_bone: 0,
    use_texture: 0,
    color: [...body.color],
    ambient: 0.20,
    specular: body.shape.type === "capsule" ? 0.92 : 0.72,
    power: body.shape.type === "capsule" ? 70.0 : 42.0
  });
  return shape;
}

// Compute版のPlane記述をCPUのstatic PhysicsNodeへ変換してPhysicsSpaceへ登録します
// Planeは無限境界として計算し、表示用の薄いBoxとは別に保持して二重計算を避けます
function createCpuPlaneNodes(physics) {
  return SCENARIO.world.planes.map((plane, index) => {
    const offset = plane.normal.map((value) => value * plane.planeDistance);
    const node = app.space.addPhysicsNode(null, `compute-physics-cpu-plane-${index}`, {
      bodyType: "static",
      collider: new PlaneCollider(plane.normal, { offset })
    });
    physics.addBody(node, 1000 + index);
    return node;
  });
}

// Compute版の床境界に対応する薄い床板を表示用の通常Nodeとして作ります
// 物理Planeは無限面なので、四壁を厚いShapeで描いてbodyを遮らないよう床だけを表示します
function createBoundaryVisuals() {
  const { minX, maxX, minZ, maxZ, floorY } = COMPUTE_PHYSICS_BOUNDS;
  const width = maxX - minX;
  const depth = maxZ - minZ;
  const entries = [
    { name: "floor", size: [width, FLOOR_THICKNESS, depth], position: [0, floorY - FLOOR_THICKNESS * 0.5, 0] }
  ];
  return entries.map((entry) => {
    const node = app.space.addNode(null, `compute-physics-cpu-${entry.name}`);
    node.setPosition(...entry.position);
    const shape = new Shape(app.getGPU());
    shape.applyPrimitiveAsset(Primitive.cuboid(...entry.size, shape.getPrimitiveOptions()));
    shape.endShape();
    shape.setMaterial("smooth-shader", {
      has_bone: 0,
      use_texture: 0,
      color: [0.32, 0.76, 0.96, 1.0],
      ambient: 0.36,
      specular: 0.18,
      power: 12.0
    });
    node.addShape(shape);
    return Object.freeze({ node, shape });
  });
}

// CPU runtimeを生成し、Planeと72体のmixed shape bodyを共通scenarioと同じ順序で登録します
// PhysicsSpaceのcoupled contact反復へBox・Sphere・Capsuleの接触を同じstateMapで渡します
function createRuntime() {
  const physics = createCpuPhysicsSpace();
  const planes = createCpuPlaneNodes(physics);
  const entries = SCENARIO.bodies.map((body, index) => createCpuBody(physics, body, index));
  const boundaryVisuals = createBoundaryVisuals();
  return {
    physics,
    planes,
    entries,
    boundaryVisuals,
    stepCount: 0,
    timing: [],
    stats: null,
    idle: false,
    renderedSleepingStates: new Map()
  };
}

// CPU PhysicsNodeのsleep flagをShapeの明るさへ反映し、停止状態をCompute版と同じ画面で見分けます
// 速度や位置を描画用に補正せず、物理Nodeが返すsleep状態だけを使います
function updateBodyColors() {
  let changed = false;
  for (const entry of runtime.entries) {
    const brightness = entry.node.getSleeping() ? 0.62 : 1.0;
    const sleeping = entry.node.getSleeping() === true;
    if (runtime.renderedSleepingStates.get(entry.node) === sleeping) continue;
    const color = entry.body.color;
    entry.shape.updateMaterial({
      color: [color[0] * brightness, color[1] * brightness, color[2] * brightness, color[3]]
    });
    runtime.renderedSleepingStates.set(entry.node, sleeping);
    changed = true;
  }
  return changed;
}

// CPU Node列からactive・sleeping・速度・contact件数を集計します
// Compute版のbody数・形状数と対応する値をpanelへ表示し、動作差を数値でも確認します
function readStatistics() {
  let active = 0;
  let sleeping = 0;
  let maxLinearSpeed = 0.0;
  let maxAngularSpeed = 0.0;
  for (const entry of runtime.entries) {
    const node = entry.node;
    if (node.getSleeping()) sleeping += 1;
    else active += 1;
    maxLinearSpeed = Math.max(maxLinearSpeed, Math.hypot(...node.getLinearVelocity()));
    maxAngularSpeed = Math.max(
      maxAngularSpeed,
      Math.hypot(...node.getAngularVelocity()) / RAD_TO_DEG
    );
  }
  return {
    active,
    sleeping,
    maxLinearSpeed,
    maxAngularSpeed,
    contacts: runtime.physics.getLastContacts().length,
    manifolds: runtime.physics.getLastManifolds().length,
    sleepIslands: runtime.physics.getLastSleepIslands().length
  };
}

// CPU物理stepの実測値を直近30件へ保存し、fixed step単位の中央値を計算します
// frame描画時間とは別に物理計算の速度を表示し、CPU Node描画の負荷と分けて確認します
function recordPhysicsTiming(elapsedMs, stepCount) {
  if (stepCount <= 0) return;
  runtime.timing.push(elapsedMs / stepCount);
  if (runtime.timing.length > 30) runtime.timing.shift();
}

// 直近のCPU physics計測値から中央値を返します
// 一時的なGCやwindow resizeの影響を平均値だけで判断しないため、中央値を速度比較へ使います
function getMedianPhysicsMs() {
  if (runtime.timing.length === 0) return null;
  const sorted = [...runtime.timing].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length * 0.5);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) * 0.5
    : sorted[middle];
}

// 現在のCPU状態、物理件数、frame/GPU計測を比較用Help Panelの行へ変換します
// Computeページの同じscenario表示と並べて、動作と速度の差を同じ単位で確認できます
function buildHelpLines(stats = runtime.stats ?? readStatistics()) {
  const medianPhysicsMs = getMedianPhysicsMs();
  return [
    "ComputePhysicsSpace mixed-shape comparison (CPU PhysicsSpace)",
    ...(runtime.idle
      ? ["Frame loop: idle", "GPU timing: idle", "JS timing: idle"]
      : app.getFrameTimingLines()),
    `CPU physics: ${medianPhysicsMs === null ? "--" : medianPhysicsMs.toFixed(3)} ms/fixed step (median, ${runtime.timing.length} samples)`,
    `bodies: ${SCENARIO.bodyCount}  active: ${stats.active}  sleeping: ${stats.sleeping}`,
    `shapes: Box 24 / Sphere 24 / Capsule 24  contacts: ${stats.contacts}  manifolds: ${stats.manifolds}`,
    `fixed steps: ${runtime.stepCount}  sleep islands: ${stats.sleepIslands}  simulation: ${runtime.idle ? "idle" : paused ? "paused" : "running"}`,
    "CPU: PhysicsSpace -> coupled Box/Plane + mixed-shape contact iterations",
    "render: PhysicsNode scene graph; visual boundary is separate from infinite Plane",
    "comparison: same 72 bodies, deterministic placement, gravity, fixed step, and solver iterations",
    "Drag: orbit  Wheel: zoom  P: pause  R: reset  H: show/hide panel"
  ];
}

// HUDに表示する物理状態だけから比較キーを作り、時間計測値の変化ではDOM更新を起こさないようにします
// active数や接触数が同じfixed stepで維持される間は、物理計算を続けてもHUD本文を再利用します
function getHelpStateKey(stats) {
  return [
    stats.active,
    stats.sleeping,
    stats.contacts,
    stats.manifolds,
    stats.sleepIslands,
    paused ? "paused" : "running",
    runtime.idle ? "idle" : "active"
  ].join("|");
}

// Help Panel本文が変わったときだけ既存DOMへ反映し、毎frameのDOM再構築を避けます
// 初回は畳んだ状態で表示し、利用者が選んだ開閉状態を物理処理から独立して保持します
function updateHelpPanel(initial = false, stats = runtime.stats ?? readStatistics()) {
  const lines = buildHelpLines(stats);
  const text = lines.join("\n");
  if (initial) {
    app.showOverlayPanel(buildHelpPanelOptions({
      id: "computePhysicsCpuHelp",
      title: "Help",
      collapsed: true,
      anchor: "top-left",
      collapseLabelExpanded: "Hide Panel",
      collapseLabelCollapsed: "Show Panel",
      maxWidth: "760px",
      lines
    }));
    lastHelpText = text;
    return;
  }
  if (text === lastHelpText) return;
  app.updateOverlayPanel("computePhysicsCpuHelp", { lines });
  lastHelpText = text;
}

// pause、reset、Helpの操作をkeyboardとtouch buttonから共通処理します
// resetではNode、Shape、PhysicsSpaceの状態を同じ初期条件から再生成するためページを再読み込みします
function applyAction(key) {
  const normalized = String(key).toLowerCase();
  if (normalized === "p" || normalized === "space" || key === " ") {
    paused = !paused;
  } else if (normalized === "r") {
    window.location.reload();
    return;
  } else if (normalized === "h") {
    const panel = app.getOverlayPanel("computePhysicsCpuHelp");
    if (panel) panel.setCollapsed(!panel.collapsed);
    return;
  } else {
    return;
  }
  updateHelpPanel(false, runtime.stats);
  requestCpuRender();
}

// 停止中のCPUサンプルを入力やpanel操作の一回描画だけで再開します
// app.requestRender()は停止後には機能しないため、停止中だけ同じframe handlerでstartします
function requestCpuRender() {
  if (!app) return false;
  if (app.running) return app.requestRender();
  if (!frameHandlers) {
    throw new Error("compute_physics CPU frame handlers are not ready");
  }
  app.start(frameHandlers);
  return true;
}

// sleep後に停止したcanvasをcamera入力で一回だけ再描画できるようにします
// pointer eventへ統一し、mouseとtouchの両方で同じ再描画要求を発生させます
function attachIdleRenderListeners() {
  const canvas = app.screen?.canvas;
  if (!canvas) {
    throw new Error("compute_physics CPU canvas is unavailable for idle rendering");
  }
  const listener = () => requestCpuRender();
  for (const type of ["pointerdown", "pointermove", "wheel"]) {
    const options = { passive: true };
    canvas.addEventListener(type, listener, options);
    idleRenderListeners.push({ type, listener, options });
  }
}

// pagehide時にsleep後の再描画listenerを解除し、破棄後のcanvasへ処理を送らないようにします
function detachIdleRenderListeners() {
  const canvas = app?.screen?.canvas;
  if (canvas) {
    for (const { type, listener, options } of idleRenderListeners) {
      canvas.removeEventListener(type, listener, options);
    }
  }
  idleRenderListeners = [];
}

// CPU PhysicsSpaceの一回分の更新を実行し、全bodyがsleepしたframeでloopを停止します
// sleep後も同じ処理を毎frame繰り返さず、入力があったときだけrequestCpuRender()で一回描画します
function updateCpuFrame({ deltaSec }) {
  if (runtime.idle) {
    app.stop();
    return;
  }
  if (paused) return;

  const startedAt = performance.now();
  const stepCount = runtime.physics.step(deltaSec * 1000.0);
  const elapsedMs = performance.now() - startedAt;
  runtime.stepCount += stepCount;
  recordPhysicsTiming(elapsedMs, stepCount);
  if (stepCount <= 0) return;

  runtime.stats = readStatistics();
  updateBodyColors();
  if (runtime.stats.active === 0) runtime.idle = true;
  const helpStateKey = getHelpStateKey(runtime.stats);
  if (helpStateKey !== lastHelpStateKey) {
    updateHelpPanel(false, runtime.stats);
    lastHelpStateKey = helpStateKey;
  }
  if (runtime.idle) app.stop();
}

// WebgApp、PhysicsSpace、Node shape、境界表示を初期化し、CPU frame loopを開始します
// frameTimingを有効にして、CPU physics、JavaScript、GPU renderを別々に読める状態を作ります
async function start() {
  app = new WebgApp({
    document,
    frameTiming: true,
    computeFrame: false,
    autoDrawScene: true,
    clearColor: CLEAR_COLOR,
    viewAngle: 48.0,
    projectionNear: 0.05,
    projectionFar: 80.0,
    messageFontTexture: "../../webg/font512.png",
    light: { mode: "eye-fixed", position: [3.0, 5.0, 4.0, 1.0] },
    camera: CAMERA,
    debugTools: { mode: "release", system: "compute-physics-cpu", source: "samples/compute_physics/cpu_main.js" }
  });
  await app.init();
  app.createOrbitEyeRig({ ...CAMERA, wheelZoomStep: 0.45 });
  runtime = createRuntime();
  runtime.stats = readStatistics();
  updateBodyColors();
  updateHelpPanel(true, runtime.stats);
  lastHelpStateKey = getHelpStateKey(runtime.stats);
  app.attachInput({ onKeyDown: (key, event) => { if (!event.repeat) applyAction(key); } });
  app.input.installTouchControls({
    touchDeviceOnly: false,
    groups: [{ id: "simulation", buttons: [
      { key: "p", label: "P", kind: "action", ariaLabel: "pause or resume" },
      { key: "r", label: "R", kind: "action", ariaLabel: "reset bodies" },
      { key: "h", label: "H", kind: "action", ariaLabel: "show or hide panel" }
    ] }],
    onAction: ({ key }) => applyAction(String(key))
  });
  frameHandlers = { onUpdate: updateCpuFrame };
  app.start(frameHandlers);
  attachIdleRenderListeners();
  window.addEventListener("pagehide", () => {
    app.stop();
    detachIdleRenderListeners();
    for (const entry of runtime.entries) entry.shape.destroy();
    for (const entry of runtime.boundaryVisuals) entry.shape.destroy();
  }, { once: true });
}

// HTML解析完了後に初期化を開始し、失敗理由をconsoleとerror panelへ表示します
// CPU処理を空の状態へ切り替えて続行せず、同じ条件で比較できない場合は明示的に停止します
document.addEventListener("DOMContentLoaded", () => {
  start().catch((error) => {
    console.error("compute_physics CPU failed:", error);
    app?.showOverlayPanel?.(buildErrorPanelOptions(error, {
      title: "compute_physics CPU failed",
      id: "computePhysicsCpuError"
    }));
  });
});
