// -------------------------------------------------
// camera_controller sample
//   main.js       2026/04/12
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// -------------------------------------------------

import WebgApp from "../../webg/WebgApp.js";
import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";
import EyeRig from "../../webg/EyeRig.js";
import Diagnostics from "../../webg/Diagnostics.js";

const MODE_ORBIT = "orbit";
const MODE_FIRST_PERSON = "first-person";
const MODE_FOLLOW = "follow";

const ORBIT_DEFAULT = {
  target: [0.0, 6.0, 0.0],
  distance: 46.0,
  yaw: 28.0,
  pitch: -18.0,
  minDistance: 10.0,
  maxDistance: 90.0,
  wheelZoomStep: 1.6
};

const FIRST_PERSON_DEFAULT = {
  position: [0.0, 0.0, 28.0],
  yaw: 180.0,
  pitch: -8.0,
  eyeHeight: 1.8,
  moveSpeed: 12.0,
  runMultiplier: 2.2
};

const FOLLOW_DEFAULT = {
  targetOffset: [0.0, 2.3, 0.0],
  distance: 16.0,
  yaw: 0.0,
  pitch: -12.0,
  minDistance: 6.0,
  maxDistance: 40.0,
  inheritTargetYaw: true,
  targetYawOffset: 180.0,
  followLerp: 6.0
};


const state = {
  mode: MODE_ORBIT,
  targetPaused: false,
  targetAngleDeg: 0.0,
  targetRadius: 18.0,
  targetSpeedDeg: 24.0,
  bobPhase: 0.0
};

let app = null;
let eyeRig = null;
let targetRoot = null;
let targetHead = null;

// camera_controller sample の役割:
// - 3種類の視点 helper を同じ scene で切り替え、EyeRig の各段がどう使われるかを見比べる
// - `WebgApp` から見た helper の共通インターフェイスを示し、sample 側コードを小さく保つ
// - 追従対象が動く scene を使い、follow helper の基準 target / yaw 継承も確認できるようにする

document.addEventListener("DOMContentLoaded", () => {
  start().catch((err) => {
    app?.setDiagnosticsReport?.(Diagnostics.createErrorReport(err, {
      system: "camera_controller",
      source: "samples/camera_controller/main.js",
      stage: app?.getDiagnosticsReport?.()?.stage ?? "start"
    }));
    if (app?.isConsoleEnabled?.()) {
      console.error("camera_controller failed:", err);
    }
    app?.showErrorPanel?.(err, {
      title: "camera_controller failed",
      id: "start-error",
      background: "rgba(26, 38, 26, 0.92)"
    });
  });
});

function getSceneShapes() {
  const shapes = [];
  const nodes = app?.space?.nodes ?? [];
  for (let i = 0; i < nodes.length; i++) {
    const list = nodes[i]?.shapes ?? [];
    for (let j = 0; j < list.length; j++) {
      shapes.push(list[j]);
    }
  }
  return shapes;
}

function refreshDiagnosticsStats() {
  const shapes = getSceneShapes();
  const envReport = app.checkEnvironment({
    stage: "runtime-check",
    shapes
  });
  const orbit = eyeRig?.getModeState?.(MODE_ORBIT) ?? ORBIT_DEFAULT;
  const firstPerson = eyeRig?.getModeState?.(MODE_FIRST_PERSON) ?? FIRST_PERSON_DEFAULT;
  const follow = eyeRig?.getModeState?.(MODE_FOLLOW) ?? FOLLOW_DEFAULT;
  const targetPos = targetRoot?.getPosition?.() ?? [0.0, 0.0, 0.0];
  app.mergeDiagnosticsStats({
    mode: state.mode,
    targetPaused: state.targetPaused ? "yes" : "no",
    targetAngleDeg: state.targetAngleDeg.toFixed(2),
    targetRadius: state.targetRadius.toFixed(2),
    orbitDistance: Number(orbit.distance ?? ORBIT_DEFAULT.distance).toFixed(2),
    orbitYaw: Number(orbit.yaw ?? ORBIT_DEFAULT.yaw).toFixed(2),
    orbitPitch: Number(orbit.pitch ?? ORBIT_DEFAULT.pitch).toFixed(2),
    fpYaw: Number(firstPerson.bodyYaw ?? FIRST_PERSON_DEFAULT.yaw).toFixed(2),
    fpPitch: Number(firstPerson.lookPitch ?? FIRST_PERSON_DEFAULT.pitch).toFixed(2),
    followDistance: Number(follow.distance ?? FOLLOW_DEFAULT.distance).toFixed(2),
    followYaw: Number(follow.yaw ?? FOLLOW_DEFAULT.yaw).toFixed(2),
    followPitch: Number(follow.pitch ?? FOLLOW_DEFAULT.pitch).toFixed(2),
    targetX: targetPos[0].toFixed(2),
    targetY: targetPos[1].toFixed(2),
    targetZ: targetPos[2].toFixed(2),
    envOk: envReport.ok ? "yes" : "no",
    envWarning: envReport.warnings?.[0] ?? "-"
  });
  return envReport;
}

function makeProbeReport(frameCount) {
  const shapes = getSceneShapes();
  const envReport = app.checkEnvironment({
    stage: "runtime-probe",
    shapes
  });
  const report = app.createProbeReport("runtime-probe");
  const targetPos = targetRoot?.getPosition?.() ?? [0.0, 0.0, 0.0];
  Diagnostics.addDetail(report, `mode=${state.mode}`);
  Diagnostics.addDetail(report, `targetPaused=${state.targetPaused ? "yes" : "no"}`);
  Diagnostics.addDetail(report, `targetPos=(${targetPos[0].toFixed(2)}, ${targetPos[1].toFixed(2)}, ${targetPos[2].toFixed(2)})`);
  if (envReport.warnings?.length) {
    Diagnostics.addDetail(report, `envWarning=${envReport.warnings[0]}`);
  }
  Diagnostics.mergeStats(report, {
    frameCount,
    mode: state.mode,
    targetPaused: state.targetPaused ? "yes" : "no",
    targetAngleDeg: state.targetAngleDeg.toFixed(2),
    envOk: envReport.ok ? "yes" : "no"
  });
  return report;
}

function createPhongShape(gl, buildShape, material) {
  const shape = new Shape(gl);
  buildShape(shape);
  shape.endShape();
  shape.setMaterial("smooth-shader", {
    has_bone: 0,
    ...material
  });
  return shape;
}

function addReferenceNode(parent, name, sourceShape, position, attitude = [0.0, 0.0, 0.0]) {
  const shape = new Shape(app.getGL());
  shape.referShape(sourceShape);
  shape.copyShaderParamsFromShape(sourceShape);
  const node = app.space.addNode(parent, name);
  node.addShape(shape);
  node.setPosition(position[0], position[1], position[2]);
  node.setAttitude(attitude[0], attitude[1], attitude[2]);
  return node;
}

function buildScene() {
  const gl = app.getGL();

  // 床と塔を置き、orbit / first-person / follow のどれでも奥行きが読みやすい scene にする
  const floorShape = createPhongShape(gl, (shape) => {
    shape.applyPrimitiveAsset(Primitive.cuboid(64.0, 1.0, 64.0, shape.getPrimitiveOptions()));
  }, {
    use_texture: 0,
    color: [0.24, 0.30, 0.36, 1.0],
    ambient: 0.28,
    specular: 0.34,
    power: 28.0
  });
  const floorNode = app.space.addNode(null, "floor");
  floorNode.addShape(floorShape);
  floorNode.setPosition(0.0, -0.5, 0.0);

  const towerShape = createPhongShape(gl, (shape) => {
    shape.applyPrimitiveAsset(Primitive.cuboid(3.5, 15.0, 3.5, shape.getPrimitiveOptions()));
  }, {
    use_texture: 0,
    color: [0.62, 0.56, 0.44, 1.0],
    ambient: 0.26,
    specular: 0.72,
    power: 42.0
  });
  const towerPositions = [
    [-20.0, 7.5, -20.0],
    [20.0, 7.5, -20.0],
    [-20.0, 7.5, 20.0],
    [20.0, 7.5, 20.0]
  ];
  for (let i = 0; i < towerPositions.length; i++) {
    addReferenceNode(null, `tower-${i}`, towerShape, towerPositions[i]);
  }

  const markerShape = createPhongShape(gl, (shape) => {
    shape.applyPrimitiveAsset(Primitive.cuboid(1.2, 0.6, 1.2, shape.getPrimitiveOptions()));
  }, {
    use_texture: 0,
    color: [0.32, 0.70, 0.92, 1.0],
    ambient: 0.22,
    specular: 0.54,
    power: 28.0
  });
  for (let i = 0; i < 16; i++) {
    const angle = (Math.PI * 2.0 * i) / 16.0;
    const x = Math.cos(angle) * state.targetRadius;
    const z = Math.sin(angle) * state.targetRadius;
    addReferenceNode(null, `marker-${i}`, markerShape, [x, 0.25, z]);
  }

  // moving target は body / head / nose を分け、follow view から見た向きが読みやすいようにする
  targetRoot = app.space.addNode(null, "target-root");

  const bodyShape = createPhongShape(gl, (shape) => {
    shape.applyPrimitiveAsset(Primitive.cuboid(2.0, 2.2, 3.0, shape.getPrimitiveOptions()));
  }, {
    use_texture: 0,
    color: [0.90, 0.46, 0.18, 1.0],
    ambient: 0.24,
    specular: 0.78,
    power: 36.0
  });
  targetRoot.addShape(bodyShape);
  targetRoot.setPosition(state.targetRadius, 1.1, 0.0);

  const headShape = createPhongShape(gl, (shape) => {
    shape.applyPrimitiveAsset(Primitive.sphere(0.75, 18, 18, shape.getPrimitiveOptions()));
  }, {
    use_texture: 0,
    color: [0.96, 0.82, 0.66, 1.0],
    ambient: 0.26,
    specular: 0.68,
    power: 30.0
  });
  targetHead = app.space.addNode(targetRoot, "target-head");
  targetHead.addShape(headShape);
  targetHead.setPosition(0.0, 1.8, 0.0);

  const noseShape = createPhongShape(gl, (shape) => {
    shape.applyPrimitiveAsset(Primitive.cuboid(0.35, 0.35, 1.1, shape.getPrimitiveOptions()));
  }, {
    use_texture: 0,
    color: [0.24, 0.18, 0.16, 1.0],
    ambient: 0.22,
    specular: 0.40,
    power: 18.0
  });
  const noseNode = app.space.addNode(targetHead, "target-nose");
  noseNode.addShape(noseShape);
  noseNode.setPosition(0.0, 0.0, 0.8);

  const centerShape = createPhongShape(gl, (shape) => {
    shape.applyPrimitiveAsset(Primitive.cuboid(5.0, 6.0, 5.0, shape.getPrimitiveOptions()));
  }, {
    use_texture: 0,
    color: [0.40, 0.88, 0.54, 1.0],
    ambient: 0.24,
    specular: 0.82,
    power: 40.0
  });
  const centerNode = app.space.addNode(null, "center-block");
  centerNode.addShape(centerShape);
  centerNode.setPosition(0.0, 3.0, 0.0);
}

function resetOrbitController() {
  eyeRig.setType(MODE_ORBIT);
  const orbit = eyeRig.getModeState(MODE_ORBIT);
  eyeRig.setTarget(...ORBIT_DEFAULT.target);
  orbit.minDistance = ORBIT_DEFAULT.minDistance;
  orbit.maxDistance = ORBIT_DEFAULT.maxDistance;
  orbit.wheelZoomStep = ORBIT_DEFAULT.wheelZoomStep;
  eyeRig.setAngles(ORBIT_DEFAULT.yaw, ORBIT_DEFAULT.pitch);
  eyeRig.setDistance(ORBIT_DEFAULT.distance);
}

function resetFirstPersonController() {
  eyeRig.setType(MODE_FIRST_PERSON);
  const firstPerson = eyeRig.getModeState(MODE_FIRST_PERSON);
  eyeRig.setPosition(...FIRST_PERSON_DEFAULT.position);
  eyeRig.setAngles(FIRST_PERSON_DEFAULT.yaw, 0.0, 0.0);
  eyeRig.setLookAngles(0.0, FIRST_PERSON_DEFAULT.pitch, 0.0);
  eyeRig.setEyeHeight(FIRST_PERSON_DEFAULT.eyeHeight);
  firstPerson.moveSpeed = FIRST_PERSON_DEFAULT.moveSpeed;
  firstPerson.runMultiplier = FIRST_PERSON_DEFAULT.runMultiplier;
}

function resetFollowController() {
  eyeRig.setType(MODE_FOLLOW);
  const follow = eyeRig.getModeState(MODE_FOLLOW);
  eyeRig.setTargetOffset(...FOLLOW_DEFAULT.targetOffset);
  follow.minDistance = FOLLOW_DEFAULT.minDistance;
  follow.maxDistance = FOLLOW_DEFAULT.maxDistance;
  follow.inheritTargetYaw = FOLLOW_DEFAULT.inheritTargetYaw;
  follow.targetYawOffset = FOLLOW_DEFAULT.targetYawOffset;
  follow.followLerp = FOLLOW_DEFAULT.followLerp;
  eyeRig.setAngles(FOLLOW_DEFAULT.yaw, FOLLOW_DEFAULT.pitch);
  eyeRig.setDistance(FOLLOW_DEFAULT.distance);
  eyeRig.syncTarget(true);
  eyeRig.apply();
}

function updateGuideLines() {
  const lines = [
    "camera_controller sample",
    "[1] orbit  [2] first-person  [3] follow  [p] pause target  [r] reset active camera",
    ...app.getDebugKeyGuideLines()
  ];

  if (state.mode === MODE_ORBIT) {
    lines.push("Orbit: drag or Arrow keys to orbit");
    lines.push("Orbit: 2-finger drag to pan  pinch / wheel / [ ] to zoom");
  } else if (state.mode === MODE_FIRST_PERSON) {
    lines.push("First-person: drag to look around");
    lines.push("First-person: W/A/S/D move  Q/E down/up  Shift run");
  } else {
    lines.push("Follow: drag or Arrow keys to rotate rod around target");
    lines.push("Follow: 2-finger drag to offset target  pinch / wheel / [ ] to change distance");
  }

  return lines;
}

function setActiveController(mode) {
  state.mode = mode;
  eyeRig.setType(mode);
}

function resetActiveController() {
  if (state.mode === MODE_ORBIT) {
    resetOrbitController();
  } else if (state.mode === MODE_FIRST_PERSON) {
    resetFirstPersonController();
  } else {
    resetFollowController();
  }
  setActiveController(state.mode);
}

function updateTarget(deltaSec) {
  if (!state.targetPaused) {
    state.targetAngleDeg = (state.targetAngleDeg + state.targetSpeedDeg * deltaSec) % 360.0;
    state.bobPhase += deltaSec * 2.4;
  }

  // 円軌道の接線方向を yaw に使うと、follow view が target の背後へ自然に回り込める
  const angleRad = state.targetAngleDeg * Math.PI / 180.0;
  const x = Math.cos(angleRad) * state.targetRadius;
  const z = Math.sin(angleRad) * state.targetRadius;
  const y = 1.1 + Math.sin(state.bobPhase) * 0.18;
  const tangentYaw = state.targetAngleDeg + 90.0;
  targetRoot.setPosition(x, y, z);
  targetRoot.setAttitude(tangentYaw, 0.0, 0.0);
  targetHead.setAttitude(0.0, Math.sin(state.bobPhase * 0.5) * 8.0, 0.0);
}

function buildStatusLines() {
  const envReport = refreshDiagnosticsStats();
  const basePos = eyeRig?.getBaseNode?.()?.getPosition?.() ?? [0.0, 0.0, 0.0];
  const rodPos = eyeRig?.getRodNode?.()?.getPosition?.() ?? [0.0, 0.0, 0.0];
  const eyePos = eyeRig?.getEyeNode?.()?.getPosition?.() ?? [0.0, 0.0, 0.0];
  const targetYaw = targetRoot.getLocalAttitude()[0];
  const lines = [
    `mode=${state.mode} targetPaused=${state.targetPaused ? "ON" : "OFF"}`,
    `targetPos=(${targetRoot.getPosition()[0].toFixed(1)}, ${targetRoot.getPosition()[1].toFixed(1)}, ${targetRoot.getPosition()[2].toFixed(1)}) yaw=${targetYaw.toFixed(1)}`,
    `eyeRig base=(${basePos[0].toFixed(1)}, ${basePos[1].toFixed(1)}, ${basePos[2].toFixed(1)}) rod=(${rodPos[0].toFixed(1)}, ${rodPos[1].toFixed(1)}, ${rodPos[2].toFixed(1)}) eye=(${eyePos[0].toFixed(1)}, ${eyePos[1].toFixed(1)}, ${eyePos[2].toFixed(1)})`
  ];

  if (state.mode === MODE_ORBIT) {
    const orbit = eyeRig.getModeState(MODE_ORBIT);
    lines.push(`orbit yaw=${orbit.yaw.toFixed(1)} pitch=${orbit.pitch.toFixed(1)} dist=${orbit.distance.toFixed(1)}`);
  } else if (state.mode === MODE_FIRST_PERSON) {
    const firstPerson = eyeRig.getModeState(MODE_FIRST_PERSON);
    lines.push(`fp pos=(${firstPerson.position[0].toFixed(1)}, ${firstPerson.position[1].toFixed(1)}, ${firstPerson.position[2].toFixed(1)})`);
    lines.push(`fp bodyYaw=${firstPerson.bodyYaw.toFixed(1)} lookPitch=${firstPerson.lookPitch.toFixed(1)} eyeHeight=${firstPerson.eyeHeight.toFixed(1)}`);
  } else {
    const follow = eyeRig.getModeState(MODE_FOLLOW);
    lines.push(`follow yaw=${follow.yaw.toFixed(1)} pitch=${follow.pitch.toFixed(1)} dist=${follow.distance.toFixed(1)}`);
    lines.push(`follow inheritYaw=${follow.inheritTargetYaw ? "ON" : "OFF"} currentTarget=(${follow.currentTarget[0].toFixed(1)}, ${follow.currentTarget[1].toFixed(1)}, ${follow.currentTarget[2].toFixed(1)})`);
  }

  lines.push(`env=${envReport.ok ? "OK" : "WARN"}`);
  lines.push(app.getDiagnosticsStatusLine());
  lines.push(app.isDebugUiEnabled() ? app.getProbeStatusLine() : "");

  return lines;
}

async function start() {
  // controller 差し替えだけに集中できるよう、起動まわりは WebgApp に任せる
  app = new WebgApp({
    document,
    clearColor: [0.10, 0.14, 0.18, 1.0],
    lightPosition: [160.0, 220.0, 260.0, 1.0],
    viewAngle: 54.0,
    messageFontTexture: "../../webg/font512.png",
    debugTools: {
      mode: "debug",
      system: "camera_controller",
      source: "samples/camera_controller/main.js",
      probeDefaultAfterFrames: 1
    },
    camera: {
      target: ORBIT_DEFAULT.target,
      distance: ORBIT_DEFAULT.distance,
      yaw: ORBIT_DEFAULT.yaw,
      pitch: ORBIT_DEFAULT.pitch
    }
  });
  await app.init();
  app.setDiagnosticsStage("runtime");

  buildScene();

  // EyeRig 1つだけを作り、type を切り替えて orbit / first-person / follow を使い分ける
  eyeRig = new EyeRig(app.cameraRig, app.cameraRod, app.eye, {
    document,
    element: app.screen.canvas,
    input: app.input,
    type: MODE_ORBIT,
    targetNode: targetRoot,
    orbit: ORBIT_DEFAULT,
    firstPerson: FIRST_PERSON_DEFAULT,
    follow: FOLLOW_DEFAULT
  });
  eyeRig.attachPointer(app.screen.canvas);

  resetOrbitController();
  resetFirstPersonController();
  resetFollowController();
  setActiveController(MODE_ORBIT);
  app.configureDiagnosticsCapture({
    labelPrefix: "camera_controller",
    collect: () => makeProbeReport(app.screen.getFrameCount())
  });
  app.configureDebugKeyInput();

  // lower-case キー規約は WebgApp.attachInput 側へ寄せ、sample 側では action の意味だけを書く
  app.attachInput({
    onKeyDown: (key, ev) => {
      if (ev.repeat) return;
      if (key === "1") {
        setActiveController(MODE_ORBIT);
      } else if (key === "2") {
        setActiveController(MODE_FIRST_PERSON);
      } else if (key === "3") {
        setActiveController(MODE_FOLLOW);
      } else if (key === "p") {
        state.targetPaused = !state.targetPaused;
      } else if (key === "r") {
        resetActiveController();
      }
    }
  });

  app.start({
    onUpdate: ({ deltaSec }) => {
      updateTarget(deltaSec);
      eyeRig.update(deltaSec);
      app.updateDebugProbe();
      const controlLines = [...updateGuideLines(), ...buildStatusLines().filter(Boolean)];
      app.setControlRows(app.isDebugUiEnabled() ? app.makeTextControlRows(controlLines) : []);
    }
  });
}
