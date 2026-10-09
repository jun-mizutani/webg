// ---------------------------------------------
// samples/falling_dominoes_cpu/main.js  2026/09/23
//   CPU PhysicsSpace falling dominoes sample
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import WebgApp from "../../webg/WebgApp.js";
import BoxCollider from "../../webg/BoxCollider.js";
import PlaneCollider from "../../webg/PlaneCollider.js";
import PhysicsSpace from "../../webg/PhysicsSpace.js";
import Primitive from "../../webg/Primitive.js";
import Quat from "../../webg/Quat.js";
import Shape from "../../webg/Shape.js";
import {
  buildErrorPanelOptions,
  buildHelpPanelOptions
} from "../../webg/OverlayPanelPresets.js";

// このサンプルは、samples/falling_dominoesと同じ32体の配置・材質・初期条件を使います
// Compute版のGPU BodyStateを使わず、PhysicsSpaceの登録solver stateをPhysicsNodeへ同期します
const DOMINO_COUNT = 32;
const DOMINO_LONG_SIDE = 0.025;
const DOMINO_HEIGHT = 0.050;
const DOMINO_THICKNESS = 0.006;
const DOMINO_SPACING = 0.0225;
const DOMINO_START_X = -((DOMINO_COUNT - 1) * DOMINO_SPACING) * 0.5;
const DOMINO_DENSITY = 700.0;
const DOMINO_VOLUME = DOMINO_LONG_SIDE * DOMINO_HEIGHT * DOMINO_THICKNESS;
const DOMINO_MASS_MULTIPLIER = 6.18333333333333;
const DOMINO_MASS = DOMINO_DENSITY * DOMINO_VOLUME * DOMINO_MASS_MULTIPLIER;
const DOMINO_GRAVITY = 9.80665;
const DOMINO_INITIAL_ANGULAR_SPEED = 7.68333333333333;
const DOMINO_RESTITUTION = 0.11000000000000004;
const DOMINO_FRICTION = 0.3008333333333333;
const DOMINO_LINEAR_DAMPING = 0.09166666666666667;
const DOMINO_ANGULAR_DAMPING = 0.13333333333333328;
const DOMINO_SLEEP_ANGULAR_SPEED = 0.4691666666666668;
const DOMINO_WAKE_ANGULAR_SPEED = 0.7175000000000001;
const DOMINO_GAP = DOMINO_SPACING - DOMINO_THICKNESS;
const FLOOR_THICKNESS = 0.004;
const FLOOR_COLOR = [0.10, 0.22, 0.32, 1.0];
const ARENA_MARGIN_X = 0.15;
const BOUNDS = Object.freeze({
  minX: DOMINO_START_X - ARENA_MARGIN_X,
  maxX: -DOMINO_START_X + ARENA_MARGIN_X,
  minZ: -0.16,
  maxZ: 0.16,
  floorY: 0.0
});
const CLEAR_COLOR = [0.018, 0.031, 0.048, 1.0];
const FONT_FILE = "../../webg/font512.png";
const RAD_TO_DEG = 180.0 / Math.PI;
const SLEEP_STEPS = 5;
const POSITION_SLOP = DOMINO_HEIGHT * 0.00625;
const BROADPHASE_PADDING = DOMINO_HEIGHT * 0.0125;
const SUPPORT_FEATURE_TOLERANCE = DOMINO_HEIGHT * 0.125;
const RESTING_RESTITUTION_SPEED = DOMINO_HEIGHT * 6.25;
const SLEEP_LINEAR_SPEED = DOMINO_HEIGHT * 0.26633333333333336;
const WAKE_LINEAR_SPEED = DOMINO_HEIGHT * 0.533;
const SLEEP_CONTACT_SPEED = DOMINO_HEIGHT * 0.1415;
const SLEEP_NORMAL_SPEED = DOMINO_HEIGHT * 0.2335;

// Compute版と同じ保存視点を使い、投影やカメラ姿勢による比較差を小さくします
const CAMERA_CONFIG = Object.freeze({
  target: [-0.16, -0.13, -0.06],
  distance: 0.28,
  yaw: -67.19,
  pitch: -43.59,
  roll: -29.93
});
const CAMERA_ORBIT_CONFIG = Object.freeze({
  minDistance: 0.20,
  maxDistance: 5.0,
  orbit: {
    keyZoomSpeed: 0.9,
    pinchZoomSpeed: 0.11,
    wheelZoomStep: 0.09,
    dragZoomSpeed: 0.0005
  }
});
const PALETTE = Object.freeze([
  Object.freeze([0.94, 0.30, 0.24, 1.0]),
  Object.freeze([0.98, 0.60, 0.18, 1.0]),
  Object.freeze([0.30, 0.72, 0.94, 1.0]),
  Object.freeze([0.38, 0.84, 0.50, 1.0]),
  Object.freeze([0.72, 0.42, 0.94, 1.0]),
  Object.freeze([0.96, 0.40, 0.64, 1.0])
]);

let app = null;
let runtime = null;
let paused = false;
let elapsedMs = 0.0;
let lastHelpText = "";
let lastHelpUpdateMs = -Infinity;

// 同じ初期姿勢を各bodyへ渡すため、単位quaternionを毎回独立して生成します
// Nodeの姿勢配列を直接書き換えず、PhysicsNodeの物理同期入口だけを使います
function createIdentityQuat() {
  return new Quat();
}

// CPU PhysicsNodeが使うdegree/secへ、scenarioで統一したrad/secを変換します
// Compute版の角速度単位をCPU APIへ暗黙に渡すと、初期角速度が約57.3倍ずれるためここで明示します
function toCpuAngularVelocity(angularVelocity) {
  return angularVelocity.map((value) => value * RAD_TO_DEG);
}

// Compute版と同じ32体の共通body descriptorを作り、CPU Node生成とresetで再利用します
// 角速度は共通契約のrad/sec、形状はPhysicsSpaceのBox solverへ渡すBoxColliderと一致させます
function createInitialDescriptors() {
  return Array.from({ length: DOMINO_COUNT }, (_, index) => {
    const starter = index === 0;
    return Object.freeze({
      id: index + 1,
      bodyType: "dynamic",
      motionMode: "none",
      position: Object.freeze([
        DOMINO_START_X + index * DOMINO_SPACING,
        DOMINO_HEIGHT * 0.5 + (starter ? 0.001 : 0.0),
        0.0
      ]),
      orientation: Object.freeze([1.0, 0.0, 0.0, 0.0]),
      linearVelocity: Object.freeze([0.0, 0.0, 0.0]),
      angularVelocity: Object.freeze(starter
        ? [0.0, 0.0, -DOMINO_INITIAL_ANGULAR_SPEED]
        : [0.0, 0.0, 0.0]),
      mass: DOMINO_MASS,
      gravityScale: 1.0,
      linearDamping: DOMINO_LINEAR_DAMPING,
      angularDamping: DOMINO_ANGULAR_DAMPING,
      allowSleep: true,
      isSleeping: false,
      isTrigger: false,
      fixedRotation: false,
      collisionLayer: 1,
      collisionMask: 0xffffffff,
      material: Object.freeze({
        restitution: DOMINO_RESTITUTION,
        friction: DOMINO_FRICTION
      }),
      shape: Object.freeze({
        type: "box",
        size: Object.freeze([DOMINO_THICKNESS, DOMINO_HEIGHT, DOMINO_LONG_SIDE])
      }),
      color: PALETTE[index % PALETTE.length]
    });
  });
}

// 通常のPhysicsSpaceへCompute版と共通のfixed step・候補余白・位置補正・sleep条件を渡します
// Box/PlaneだけのSpaceではPhysicsSpaceが登録Nodeから速度改善済みsolverを内部生成します
function createPhysicsSpace() {
  return new PhysicsSpace({
    gravity: [0.0, -DOMINO_GRAVITY, 0.0],
    fixedTimeStepMs: 1000.0 / 120.0,
    maxSubSteps: 4,
    solverIterations: 10,
    defaultRestitution: DOMINO_RESTITUTION,
    defaultFriction: DOMINO_FRICTION,
    persistentSleep: true,
    positionCorrectionBeta: 1.0,
    positionSlop: POSITION_SLOP,
    computeBoxBroadphasePadding: BROADPHASE_PADDING,
    computeBoxSupportFeatureTolerance: SUPPORT_FEATURE_TOLERANCE,
    restingRestitutionSpeed: RESTING_RESTITUTION_SPEED,
    sleepLinearThreshold: SLEEP_LINEAR_SPEED,
    sleepAngularThreshold: DOMINO_SLEEP_ANGULAR_SPEED * RAD_TO_DEG,
    sleepContactSpeed: SLEEP_CONTACT_SPEED,
    sleepNormalSpeed: SLEEP_NORMAL_SPEED,
    sleepStepsThreshold: SLEEP_STEPS,
    minimumFloorSupportPoints: 2,
    wakeLinearSpeed: WAKE_LINEAR_SPEED,
    wakeAngularSpeed: DOMINO_WAKE_ANGULAR_SPEED * RAD_TO_DEG,
    revisitBodyContactImpulses: true
  });
}

// Box Shapeを生成し、物理Nodeへ追加できる描画resourceを返します
// 物理colliderの寸法とPrimitiveの寸法を同じ配列から作り、表示と接触形状のずれを防ぎます
function createBoxShape(gpu, size, color) {
  const shape = new Shape(gpu);
  shape.applyPrimitiveAsset(Primitive.cuboid(
    size[0],
    size[1],
    size[2],
    shape.getPrimitiveOptions()
  ));
  shape.endShape();
  shape.setMaterial("smooth-shader", {
    has_bone: 0,
    use_texture: 0,
    color: [...color],
    ambient: 0.32,
    specular: 0.72,
    power: 42.0
  });
  return shape;
}

// 接触判定を行う無限Planeを画面上で確認できるよう、同じ高さの有限床板を描画します
// 床板は描画専用Nodeであり、PlaneColliderは物理bodyへ一度だけ登録します
function createFloorVisual() {
  const width = BOUNDS.maxX - BOUNDS.minX;
  const depth = BOUNDS.maxZ - BOUNDS.minZ;
  const floor = app.space.addNode(null, "falling-dominoes-cpu-floor-visual");
  floor.setPosition(
    (BOUNDS.minX + BOUNDS.maxX) * 0.5,
    -FLOOR_THICKNESS * 0.5,
    (BOUNDS.minZ + BOUNDS.maxZ) * 0.5
  );
  floor.addShape(createBoxShape(app.getGPU(), [width, FLOOR_THICKNESS, depth], FLOOR_COLOR));
  return floor;
}

// Plane PhysicsNodeを生成し、通常のPhysicsSpaceへ明示的な接触入力として登録します
// PhysicsSpaceはPlane Nodeをsolver Planeへ変換し、登録Planeを接触対象として使います
function createFloorBody(physics) {
  const floor = app.space.addPhysicsNode(null, "falling-dominoes-cpu-floor", {
    bodyType: "static"
  });
  floor.setPosition(0.0, 0.0, 0.0);
  floor.setCollider(new PlaneCollider([0.0, 1.0, 0.0]));
  floor.setPhysicsMaterial({
    restitution: DOMINO_RESTITUTION,
    friction: DOMINO_FRICTION
  });
  physics.addBody(floor);
  return floor;
}

// 一つのdescriptorからPhysicsNode、BoxCollider、描画Shapeを生成します
// PhysicsSpaceへ共通body ID順で登録し、Compute版と同じbody順を保ちます
function createDominoBody(physics, descriptor) {
  const node = app.space.addPhysicsNode(null, `falling-dominoes-cpu-${descriptor.id}`, {
    bodyType: "dynamic",
    mass: DOMINO_MASS,
    linearDamping: DOMINO_LINEAR_DAMPING,
    angularDamping: DOMINO_ANGULAR_DAMPING,
    material: {
      restitution: DOMINO_RESTITUTION,
      friction: DOMINO_FRICTION
    },
    collider: new BoxCollider(descriptor.shape.size)
  });
  node.syncNodeFromPhysics(descriptor.position, { quat: createIdentityQuat() });
  node.setLinearVelocityVec(descriptor.linearVelocity);
  node.setAngularVelocityVec(toCpuAngularVelocity(descriptor.angularVelocity));
  const shape = createBoxShape(app.getGPU(), descriptor.shape.size, descriptor.color);
  node.addShape(shape);
  physics.addBody(node, descriptor.id);
  return { node, shape };
}

// Planeと32体のbodyを登録し、描画・物理・初期descriptorをまとめたruntimeを返します
// PhysicsSpaceがNode登録情報からBox/Plane solverを生成し、Nodeはscene graphへ一度だけ作ります
function createRuntime() {
  const descriptors = createInitialDescriptors();
  const physics = createPhysicsSpace();
  const floor = createFloorBody(physics);
  const entries = descriptors.map((descriptor) => createDominoBody(physics, descriptor));
  return {
    physics,
    floor,
    descriptors,
    entries,
    stepCount: 0
  };
}

// sleep中のbodyを暗くし、コアsolverが停止を確定した状態を画面でも確認できるようにします
// 速度を0へ補正する処理は行わず、Nodeが保持するsleep flagだけを表示へ反映します
function updateDominoColors() {
  for (let index = 0; index < runtime.entries.length; index += 1) {
    const entry = runtime.entries[index];
    const color = runtime.descriptors[index].color;
    const scale = entry.node.getSleeping() ? 0.75 : 1.0;
    entry.shape.updateMaterial({
      color: [color[0] * scale, color[1] * scale, color[2] * scale, color[3]]
    });
  }
}

// PhysicsNode列からactive・sleeping・最大速度を集計します
// Nodeへ同期された結果を読むことで、物理計算状態と実際の描画状態のずれを確認できます
function readStatistics() {
  let active = 0;
  let sleeping = 0;
  let maxLinearSpeed = 0.0;
  let maxAngularSpeed = 0.0;
  for (const entry of runtime.entries) {
    const node = entry.node;
    if (node.getSleeping()) {
      sleeping += 1;
    } else {
      active += 1;
    }
    maxLinearSpeed = Math.max(maxLinearSpeed, Math.hypot(...node.getLinearVelocity()));
    maxAngularSpeed = Math.max(
      maxAngularSpeed,
      Math.hypot(...node.getAngularVelocity()) / RAD_TO_DEG
    );
  }
  return { active, sleeping, maxLinearSpeed, maxAngularSpeed };
}

// CPU版の現在状態をHelp Panelで読める行へ変換します
// Compute時間は存在しないため、frame計測結果とCPU solver stepの累積値を分けて表示します
function buildHelpLines() {
  const stats = readStatistics();
  return [
    "CPU PhysicsSpace: falling dominoes",
    ...(app?.getFrameTimingLines?.() ?? []),
    `state: ${paused ? "paused" : "running"}  elapsed: ${(elapsedMs * 0.001).toFixed(2)} s`,
    `dominoes: ${DOMINO_COUNT}  active: ${stats.active}  sleeping: ${stats.sleeping}`,
    `fixed steps: ${runtime.stepCount}  max linear: ${stats.maxLinearSpeed.toFixed(4)} m/s`,
    `max angular: ${stats.maxAngularSpeed.toFixed(4)} rad/s  floor: Plane + visual Box`,
    `shape: Box ${runtime.descriptors[0].shape.size.map((value) => value.toFixed(4)).join(" x ")} m`,
    `setting: fixed 120Hz  iterations 10  maxSubSteps 4  restitution ${DOMINO_RESTITUTION.toFixed(3)}  friction ${DOMINO_FRICTION.toFixed(3)}`,
    "solver: predicted AABB -> candidate map -> local impulse -> position correction -> persistent sleep",
    "core: PhysicsSpace -> CPUによるBoxの新接触処理 -> PhysicsNode同期",
    "Space: kick starter   P: pause/resume   R: reset   H: expand/collapse Help Panel   Drag: orbit   Wheel: zoom"
  ];
}

// Help Panelを生成し、Compute版と同じく起動時は本文を畳んで見出しだけ表示します
// Hキーで本文を展開すれば、CPUのframe負荷とphysics状態を確認できます
function showHelpPanel() {
  const lines = buildHelpLines();
  app.showOverlayPanel(buildHelpPanelOptions({
    id: "fallingDominoesCpuHelp",
    title: "Help",
    collapsed: true,
    maxWidth: "620px",
    lines
  }));
  lastHelpText = lines.join("\n");
}

// Help Panelの表示状態を切り替え、外部操作で非表示になっていた場合だけ再表示します
// Panel操作と物理更新を分離し、表示状態を変えてもsimulationを継続します
function toggleHelpPanel() {
  const panel = app?.getOverlayPanel?.("fallingDominoesCpuHelp");
  if (!panel) return;
  if (panel.options.visible !== true) panel.show();
  panel.setCollapsed(!panel.collapsed);
}

// 最新の統計値を250ms間隔でpanelへ反映し、毎frameのDOM更新を避けます
// 物理stepの回数とHelp Panelの更新回数を分け、計測結果を物理処理へ対応付けます
function updateHelpPanel(timeMs) {
  const panel = app?.getOverlayPanel?.("fallingDominoesCpuHelp");
  if (!panel || timeMs - lastHelpUpdateMs < 250.0) return;
  const lines = buildHelpLines();
  const text = lines.join("\n");
  if (text !== lastHelpText) {
    app.updateOverlayPanel("fallingDominoesCpuHelp", { lines });
    lastHelpText = text;
  }
  lastHelpUpdateMs = timeMs;
}

// ページを再読み込みし、PhysicsSpace、Node、接触履歴、sleep状態を初期条件から作り直します
// 既存PhysicsSpaceの内部stateだけを部分的に戻さず、描画と物理の開始条件を同時に揃えます
function resetSimulation() {
  window.location.reload();
}

// キーボード入力をPhysicsNodeの操作へ接続します
// Spaceは先頭bodyへsolverと同じrad/sec相当のangular impulseを渡し、速度更新をsolverへ集約します
function attachInput() {
  app.attachInput({
    onKeyDown: (key, event) => {
      if (event.repeat) return;
      if (key === "space") {
        const inertiaZ = DOMINO_MASS
          * (DOMINO_THICKNESS * DOMINO_THICKNESS + DOMINO_HEIGHT * DOMINO_HEIGHT)
          / 12.0;
        runtime.entries[0].node.applyAngularImpulse(
          [0.0, 0.0, -1.2 * inertiaZ * RAD_TO_DEG]
        );
        paused = false;
        event.preventDefault();
        return;
      }
      if (key === "p") {
        paused = !paused;
        event.preventDefault();
        return;
      }
      if (key === "r") {
        resetSimulation();
        event.preventDefault();
        return;
      }
      if (key === "h") {
        toggleHelpPanel();
        event.preventDefault();
      }
    }
  });
}

// WebgApp、PhysicsSpace、Plane、Box Nodeを初期化し、通常のscene描画を開始します
// Compute版の固定step条件をPhysicsSpaceへ渡し、描画だけでなく連鎖・停止状態も同じ画面で確認します
async function start() {
  app = new WebgApp({
    document,
    frameTiming: true,
    messageFontTexture: FONT_FILE,
    clearColor: CLEAR_COLOR,
    viewAngle: 70.0,
    projectionNear: 0.001,
    projectionFar: 10.0,
    light: {
      mode: "eye-fixed",
      position: [1.5, 2.5, 2.5, 1.0]
    },
    camera: CAMERA_CONFIG,
    debugTools: {
      mode: "release",
      system: "falling-dominoes-cpu",
      source: "samples/falling_dominoes_cpu/main.js"
    }
  });
  await app.init();
  app.createOrbitEyeRig({ ...CAMERA_CONFIG, ...CAMERA_ORBIT_CONFIG });
  createFloorVisual();
  runtime = createRuntime();
  updateDominoColors();
  attachInput();
  showHelpPanel();

  app.start({
    onUpdate: ({ deltaSec, timeMs }) => {
      const deltaMs = deltaSec * 1000.0;
      if (!paused) {
        elapsedMs += deltaMs;
        runtime.stepCount += runtime.physics.step(deltaMs);
        updateDominoColors();
      }
      updateHelpPanel(timeMs);
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  start().catch((error) => {
    console.error("falling_dominoes_cpu failed:", error);
    app?.showOverlayPanel?.(buildErrorPanelOptions(error, {
      title: "falling_dominoes_cpu failed",
      id: "falling-dominoes-cpu-error"
    }));
  });
});
