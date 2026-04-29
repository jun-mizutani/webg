// ---------------------------------------------
// samples/camera_controller/main.js  2026/04/22
//   camera_controller sample
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import WebgApp from "../../webg/WebgApp.js";
import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";
import CameraRig from "../../webg/CameraRig.js";
import Diagnostics from "../../webg/Diagnostics.js";

const MODE_ORBIT = "orbit";
const MODE_FIRST_PERSON = "first-person";

const ORBIT_DEFAULT = {
  target: [0.0, 6.0, 0.0],
  distance: 46.0,
  yaw: 28.0,
  pitch: -18.0,
  cameraYaw: 0.0,
  cameraPitch: 0.0,
  minDistance: 10.0,
  maxDistance: 90.0,
  wheelZoomStep: 1.6,
  keyRotateSpeed: 72.0,
  keyPanSpeed: 14.0,
  dragRotateSpeed: 0.28,
  dragPanSpeed: 0.050,
  pitchMin: -85.0,
  pitchMax: 85.0
};

const FIRST_PERSON_DEFAULT = {
  position: [0.0, 0.0, 28.0],
  bodyYaw: 180.0,
  lookPitch: -8.0,
  eyeHeight: 1.8,
  moveSpeed: 12.0,
  runMultiplier: 2.2,
  dragLookSpeed: 0.20,
  lookPitchMin: -85.0,
  lookPitchMax: 85.0
};

const pointerState = {
  active: false,
  pointerId: null,
  lastX: 0.0,
  lastY: 0.0
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
let cameraRig = null;
let targetRoot = null;
let targetHead = null;

// camera_controller sample の役割:
// - `CameraRig` の `base -> rod -> carriage -> mount -> camera` 構成を使い、
//   orbit と first-person を同じ scene で切り替えて責務の違いを見比べる
// - input は sample 側で最小実装し、CameraRig 本体が state holder であることを保つ
// - orbit では carriage / mount の役割、first-person では rod / mount / camera の役割が
//   どう切り替わるかを HUD で追えるようにする

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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

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
  const orbit = cameraRig?.getModeState?.(MODE_ORBIT) ?? ORBIT_DEFAULT;
  const firstPerson = cameraRig?.getModeState?.(MODE_FIRST_PERSON) ?? FIRST_PERSON_DEFAULT;
  const targetPos = targetRoot?.getPosition?.() ?? [0.0, 0.0, 0.0];
  app.mergeDiagnosticsStats({
    mode: state.mode,
    targetPaused: state.targetPaused ? "yes" : "no",
    targetAngleDeg: state.targetAngleDeg.toFixed(2),
    targetRadius: state.targetRadius.toFixed(2),
    orbitDistance: Number(orbit.distance ?? ORBIT_DEFAULT.distance).toFixed(2),
    orbitYaw: Number(orbit.rodAngles?.[0] ?? ORBIT_DEFAULT.yaw).toFixed(2),
    orbitPitch: Number(orbit.rodAngles?.[1] ?? ORBIT_DEFAULT.pitch).toFixed(2),
    orbitPanX: Number(orbit.pan?.[0] ?? 0.0).toFixed(2),
    orbitPanY: Number(orbit.pan?.[1] ?? 0.0).toFixed(2),
    fpYaw: Number(firstPerson.rodAngles?.[0] ?? FIRST_PERSON_DEFAULT.bodyYaw).toFixed(2),
    fpPitch: Number(firstPerson.cameraAngles?.[1] ?? FIRST_PERSON_DEFAULT.lookPitch).toFixed(2),
    fpEyeHeight: Number(firstPerson.eyeHeight ?? FIRST_PERSON_DEFAULT.eyeHeight).toFixed(2),
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

  // 床と塔を置き、orbit / first-person のどちらでも奥行きが読みやすい scene にする
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

  // moving target は body / head / nose を分け、視点 mode を切り替えても向きが読みやすいようにする
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
  cameraRig.setType(MODE_ORBIT);
  const orbit = cameraRig.getModeState(MODE_ORBIT);
  orbit.basePosition = [...ORBIT_DEFAULT.target];
  orbit.rodAngles = [ORBIT_DEFAULT.yaw, ORBIT_DEFAULT.pitch, 0.0];
  orbit.distance = ORBIT_DEFAULT.distance;
  orbit.pan = [0.0, 0.0];
  orbit.cameraPosition = [0.0, 0.0, 0.0];
  orbit.cameraAngles = [ORBIT_DEFAULT.cameraYaw, ORBIT_DEFAULT.cameraPitch, 0.0];
  cameraRig.apply();
}

function resetFirstPersonController() {
  cameraRig.setType(MODE_FIRST_PERSON);
  const firstPerson = cameraRig.getModeState(MODE_FIRST_PERSON);
  firstPerson.basePosition = [...FIRST_PERSON_DEFAULT.position];
  firstPerson.rodAngles = [FIRST_PERSON_DEFAULT.bodyYaw, 0.0, 0.0];
  firstPerson.eyeHeight = FIRST_PERSON_DEFAULT.eyeHeight;
  firstPerson.cameraPosition = [0.0, 0.0, 0.0];
  firstPerson.cameraAngles = [0.0, FIRST_PERSON_DEFAULT.lookPitch, 0.0];
  firstPerson.moveSpeed = FIRST_PERSON_DEFAULT.moveSpeed;
  firstPerson.runMultiplier = FIRST_PERSON_DEFAULT.runMultiplier;
  cameraRig.apply();
}

function updateGuideLines() {
  const lines = [
    "camera_controller sample",
    "[1] orbit  [2] first-person  [p] pause target  [r] reset active camera",
    ...app.getDebugKeyGuideLines()
  ];

  if (state.mode === MODE_ORBIT) {
    lines.push("Orbit: drag or Arrow keys to rotate rod");
    lines.push("Orbit: Shift+drag / Shift+Arrow to move mount on carriage");
    lines.push("Orbit: wheel or [ ] to change carriage distance");
  } else {
    lines.push("First-person: drag to look around");
    lines.push("First-person: W/A/S/D move  Q/E down/up  Shift run");
  }

  return lines;
}

function setActiveController(mode) {
  state.mode = mode;
  cameraRig.setType(mode);
  cameraRig.apply();
}

function resetActiveController() {
  if (state.mode === MODE_ORBIT) {
    resetOrbitController();
  } else {
    resetFirstPersonController();
  }
  setActiveController(state.mode);
}

function updateTarget(deltaSec) {
  if (!state.targetPaused) {
    state.targetAngleDeg = (state.targetAngleDeg + state.targetSpeedDeg * deltaSec) % 360.0;
    state.bobPhase += deltaSec * 2.4;
  }

  // 円軌道の接線方向を yaw に使い、歩行方向が見えやすい target を作る
  const angleRad = state.targetAngleDeg * Math.PI / 180.0;
  const x = Math.cos(angleRad) * state.targetRadius;
  const z = Math.sin(angleRad) * state.targetRadius;
  const y = 1.1 + Math.sin(state.bobPhase) * 0.18;
  const tangentYaw = state.targetAngleDeg + 90.0;
  targetRoot.setPosition(x, y, z);
  targetRoot.setAttitude(tangentYaw, 0.0, 0.0);
  targetHead.setAttitude(0.0, Math.sin(state.bobPhase * 0.5) * 8.0, 0.0);
}

function getRigNodePositions() {
  const nodes = cameraRig?.getNodes?.() ?? {};
  return {
    base: nodes.base?.getPosition?.() ?? [0.0, 0.0, 0.0],
    rod: nodes.rod?.getPosition?.() ?? [0.0, 0.0, 0.0],
    carriage: nodes.carriage?.getPosition?.() ?? [0.0, 0.0, 0.0],
    mount: nodes.mount?.getPosition?.() ?? [0.0, 0.0, 0.0],
    camera: nodes.camera?.getPosition?.() ?? [0.0, 0.0, 0.0]
  };
}

function buildStatusLines() {
  const envReport = refreshDiagnosticsStats();
  const nodePos = getRigNodePositions();
  const targetYaw = targetRoot.getLocalAttitude()[0];
  const lines = [
    `mode=${state.mode} targetPaused=${state.targetPaused ? "ON" : "OFF"}`,
    `targetPos=(${targetRoot.getPosition()[0].toFixed(1)}, ${targetRoot.getPosition()[1].toFixed(1)}, ${targetRoot.getPosition()[2].toFixed(1)}) yaw=${targetYaw.toFixed(1)}`,
    `base=(${nodePos.base[0].toFixed(1)}, ${nodePos.base[1].toFixed(1)}, ${nodePos.base[2].toFixed(1)}) rod=(${nodePos.rod[0].toFixed(1)}, ${nodePos.rod[1].toFixed(1)}, ${nodePos.rod[2].toFixed(1)})`,
    `carriage=(${nodePos.carriage[0].toFixed(1)}, ${nodePos.carriage[1].toFixed(1)}, ${nodePos.carriage[2].toFixed(1)}) mount=(${nodePos.mount[0].toFixed(1)}, ${nodePos.mount[1].toFixed(1)}, ${nodePos.mount[2].toFixed(1)}) camera=(${nodePos.camera[0].toFixed(1)}, ${nodePos.camera[1].toFixed(1)}, ${nodePos.camera[2].toFixed(1)})`
  ];

  if (state.mode === MODE_ORBIT) {
    const orbit = cameraRig.getModeState(MODE_ORBIT);
    lines.push(`orbit rodYaw=${orbit.rodAngles[0].toFixed(1)} rodPitch=${orbit.rodAngles[1].toFixed(1)} dist=${orbit.distance.toFixed(1)}`);
    lines.push(`orbit pan=(${orbit.pan[0].toFixed(2)}, ${orbit.pan[1].toFixed(2)}) cameraYawPitch=${orbit.cameraAngles[0].toFixed(1)}, ${orbit.cameraAngles[1].toFixed(1)}`);
  } else {
    const firstPerson = cameraRig.getModeState(MODE_FIRST_PERSON);
    lines.push(`fp pos=(${firstPerson.basePosition[0].toFixed(1)}, ${firstPerson.basePosition[1].toFixed(1)}, ${firstPerson.basePosition[2].toFixed(1)})`);
    lines.push(`fp bodyYaw=${firstPerson.rodAngles[0].toFixed(1)} lookPitch=${firstPerson.cameraAngles[1].toFixed(1)} eyeHeight=${firstPerson.eyeHeight.toFixed(1)}`);
  }

  lines.push(`env=${envReport.ok ? "OK" : "WARN"}`);
  lines.push(app.getDiagnosticsStatusLine());
  lines.push(app.isDebugUiEnabled() ? app.getProbeStatusLine() : "");
  return lines;
}

function applyOrbitDrag(dx, dy, shiftKey) {
  const orbit = cameraRig.getModeState(MODE_ORBIT);
  if (shiftKey === true) {
    orbit.pan[0] -= dx * ORBIT_DEFAULT.dragPanSpeed;
    orbit.pan[1] += dy * ORBIT_DEFAULT.dragPanSpeed;
  } else {
    orbit.rodAngles[0] += dx * ORBIT_DEFAULT.dragRotateSpeed;
    orbit.rodAngles[1] = clamp(
      orbit.rodAngles[1] + dy * ORBIT_DEFAULT.dragRotateSpeed,
      ORBIT_DEFAULT.pitchMin,
      ORBIT_DEFAULT.pitchMax
    );
  }
  cameraRig.apply();
}

function applyFirstPersonDrag(dx, dy) {
  const firstPerson = cameraRig.getModeState(MODE_FIRST_PERSON);
  firstPerson.rodAngles[0] += dx * FIRST_PERSON_DEFAULT.dragLookSpeed;
  firstPerson.cameraAngles[1] = clamp(
    firstPerson.cameraAngles[1] + dy * FIRST_PERSON_DEFAULT.dragLookSpeed,
    FIRST_PERSON_DEFAULT.lookPitchMin,
    FIRST_PERSON_DEFAULT.lookPitchMax
  );
  cameraRig.apply();
}

function attachPointerControls(canvas) {
  const releasePointer = (pointerId) => {
    if (!canvas.releasePointerCapture) return;
    try {
      canvas.releasePointerCapture(pointerId);
    } catch (_) {
      // browser 差で release に失敗しても drag 状態は local state で閉じる
    }
  };

  canvas.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    pointerState.active = true;
    pointerState.pointerId = ev.pointerId;
    pointerState.lastX = ev.clientX;
    pointerState.lastY = ev.clientY;
    if (canvas.setPointerCapture) {
      canvas.setPointerCapture(ev.pointerId);
    }
    ev.preventDefault();
  });

  canvas.addEventListener("pointermove", (ev) => {
    if (!pointerState.active) return;
    if (pointerState.pointerId !== null && ev.pointerId !== pointerState.pointerId) return;
    const dx = ev.clientX - pointerState.lastX;
    const dy = ev.clientY - pointerState.lastY;
    pointerState.lastX = ev.clientX;
    pointerState.lastY = ev.clientY;

    if (state.mode === MODE_ORBIT) {
      applyOrbitDrag(dx, dy, ev.shiftKey === true);
    } else {
      applyFirstPersonDrag(dx, dy);
    }
    ev.preventDefault();
  });

  canvas.addEventListener("pointerup", (ev) => {
    if (!pointerState.active) return;
    if (pointerState.pointerId !== null && ev.pointerId !== pointerState.pointerId) return;
    releasePointer(ev.pointerId);
    pointerState.active = false;
    pointerState.pointerId = null;
  });

  canvas.addEventListener("pointercancel", (ev) => {
    if (pointerState.pointerId !== null && ev.pointerId !== pointerState.pointerId) return;
    releasePointer(ev.pointerId);
    pointerState.active = false;
    pointerState.pointerId = null;
  });

  canvas.addEventListener("wheel", (ev) => {
    if (state.mode !== MODE_ORBIT) return;
    const orbit = cameraRig.getModeState(MODE_ORBIT);
    const direction = ev.deltaY > 0 ? 1.0 : -1.0;
    orbit.distance = clamp(
      orbit.distance + direction * ORBIT_DEFAULT.wheelZoomStep,
      ORBIT_DEFAULT.minDistance,
      ORBIT_DEFAULT.maxDistance
    );
    cameraRig.apply();
    ev.preventDefault();
  }, { passive: false });
}

function updateOrbitKeyboard(deltaSec) {
  const orbit = cameraRig.getModeState(MODE_ORBIT);
  const shiftPan = app.input.has("shift");
  let changed = false;

  if (shiftPan) {
    if (app.input.has("arrowleft")) {
      orbit.pan[0] -= ORBIT_DEFAULT.keyPanSpeed * deltaSec;
      changed = true;
    }
    if (app.input.has("arrowright")) {
      orbit.pan[0] += ORBIT_DEFAULT.keyPanSpeed * deltaSec;
      changed = true;
    }
    if (app.input.has("arrowup")) {
      orbit.pan[1] += ORBIT_DEFAULT.keyPanSpeed * deltaSec;
      changed = true;
    }
    if (app.input.has("arrowdown")) {
      orbit.pan[1] -= ORBIT_DEFAULT.keyPanSpeed * deltaSec;
      changed = true;
    }
  } else {
    if (app.input.has("arrowleft")) {
      orbit.rodAngles[0] -= ORBIT_DEFAULT.keyRotateSpeed * deltaSec;
      changed = true;
    }
    if (app.input.has("arrowright")) {
      orbit.rodAngles[0] += ORBIT_DEFAULT.keyRotateSpeed * deltaSec;
      changed = true;
    }
    if (app.input.has("arrowup")) {
      orbit.rodAngles[1] = clamp(
        orbit.rodAngles[1] + ORBIT_DEFAULT.keyRotateSpeed * deltaSec,
        ORBIT_DEFAULT.pitchMin,
        ORBIT_DEFAULT.pitchMax
      );
      changed = true;
    }
    if (app.input.has("arrowdown")) {
      orbit.rodAngles[1] = clamp(
        orbit.rodAngles[1] - ORBIT_DEFAULT.keyRotateSpeed * deltaSec,
        ORBIT_DEFAULT.pitchMin,
        ORBIT_DEFAULT.pitchMax
      );
      changed = true;
    }
  }

  if (app.input.has("[")) {
    orbit.distance = clamp(
      orbit.distance - ORBIT_DEFAULT.wheelZoomStep * deltaSec * 8.0,
      ORBIT_DEFAULT.minDistance,
      ORBIT_DEFAULT.maxDistance
    );
    changed = true;
  }
  if (app.input.has("]")) {
    orbit.distance = clamp(
      orbit.distance + ORBIT_DEFAULT.wheelZoomStep * deltaSec * 8.0,
      ORBIT_DEFAULT.minDistance,
      ORBIT_DEFAULT.maxDistance
    );
    changed = true;
  }

  if (changed) {
    cameraRig.apply();
  }
}

function updateFirstPersonKeyboard(deltaSec) {
  const firstPerson = cameraRig.getModeState(MODE_FIRST_PERSON);
  const speed = firstPerson.moveSpeed * (app.input.has("shift") ? firstPerson.runMultiplier : 1.0);
  const yawRad = firstPerson.rodAngles[0] * Math.PI / 180.0;
  const forwardX = -Math.sin(yawRad);
  const forwardZ = Math.cos(yawRad);
  const rightX = Math.cos(yawRad);
  const rightZ = Math.sin(yawRad);
  let moveX = 0.0;
  let moveY = 0.0;
  let moveZ = 0.0;

  if (app.input.has("w")) {
    moveX += forwardX;
    moveZ += forwardZ;
  }
  if (app.input.has("s")) {
    moveX -= forwardX;
    moveZ -= forwardZ;
  }
  if (app.input.has("a")) {
    moveX -= rightX;
    moveZ -= rightZ;
  }
  if (app.input.has("d")) {
    moveX += rightX;
    moveZ += rightZ;
  }
  if (app.input.has("q")) moveY -= 1.0;
  if (app.input.has("e")) moveY += 1.0;

  const len = Math.hypot(moveX, moveY, moveZ);
  if (len <= 0.0) return;
  const scale = speed * deltaSec / len;
  firstPerson.basePosition[0] += moveX * scale;
  firstPerson.basePosition[1] += moveY * scale;
  firstPerson.basePosition[2] += moveZ * scale;
  cameraRig.apply();
}

function updateActiveController(deltaSec) {
  if (state.mode === MODE_ORBIT) {
    updateOrbitKeyboard(deltaSec);
  } else {
    updateFirstPersonKeyboard(deltaSec);
  }
}

async function start() {
  // CameraRig の差し替えだけに集中できるよう、起動まわりは WebgApp に任せる
  app = new WebgApp({
    document,
    clearColor: [0.10, 0.14, 0.18, 1.0],
    lightPosition: [160.0, 220.0, 260.0, 1.0],
    viewAngle: 54.0,
    messageFontTexture: "../../webg/font512.png",
    debugTools: {
      mode: "release",
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

  cameraRig = new CameraRig({
    space: app.space,
    type: MODE_ORBIT,
    orbit: {
      basePosition: ORBIT_DEFAULT.target,
      yaw: ORBIT_DEFAULT.yaw,
      pitch: ORBIT_DEFAULT.pitch,
      distance: ORBIT_DEFAULT.distance
    },
    firstPerson: {
      position: FIRST_PERSON_DEFAULT.position,
      bodyYaw: FIRST_PERSON_DEFAULT.bodyYaw,
      lookPitch: FIRST_PERSON_DEFAULT.lookPitch,
      eyeHeight: FIRST_PERSON_DEFAULT.eyeHeight
    }
  });

  // WebgApp が標準で持つ camera node 名を、この sample では CameraRig の node へ差し替える
  // これにより diagnostics や app.space.draw() が新しい camera を基準に動く
  const rigNodes = cameraRig.getNodes();
  app.cameraRig = rigNodes.base;
  app.cameraRod = rigNodes.rod;
  app.eye = rigNodes.camera;
  app.space.setEye(app.eye);

  resetOrbitController();
  resetFirstPersonController();
  setActiveController(MODE_ORBIT);
  attachPointerControls(app.screen.canvas);

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
      updateActiveController(deltaSec);
      app.updateDebugProbe();
      const controlLines = [...updateGuideLines(), ...buildStatusLines().filter(Boolean)];
      app.setControlRows(app.isDebugUiEnabled() ? app.makeTextControlRows(controlLines) : []);
    }
  });
}
