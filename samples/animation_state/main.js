// ---------------------------------------------
// samples/animation_state/main.js  2026/04/12
//   AnimationState sample based on hand sample
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import WebgApp from "../../webg/WebgApp.js";
import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";
import SmoothShader from "../../webg/SmoothShader.js";
import Action from "../../webg/Action.js";
import AnimationState from "../../webg/AnimationState.js";
import Texture from "../../webg/Texture.js";
import util from "../../webg/util.js";
import Diagnostics from "../../webg/Diagnostics.js";

const TEXTUTE_FILE = "";
const GLTF_FILE = new URL("../gltf_loader/hand.glb", import.meta.url).href;
const CAMERA_DISTANCE_SCALE = 1.25;
const CAMERA_PITCH_DEG = 10.0;

let g_totalVertices = 0;
let g_totalTriangles = 0;
let DRAW_FLAG = true;
let DELAY_FLAG = false;
let skeletons = [];
let bones = [];
let BONE = 0;
let MESH = 0;
let MAXBONE = 0;
let MAXMESH = 0;
let shapes = [];
let clipNames = [];
let node = null;
let fig = null;
let model = null;
let runtime = null;
let action = null;
let animationState = null;
let tex = null;
let boneShader = null;
let app = null;
let helpPanel = null;
let lastKey = "";
let meshHiddenFlags = [];
let desiredPoseId = "pose0";
let autoCycleEnabled = false;
let nextAutoCycleTimeMs = 0;

const FINGER_PATTERNS = [
  { id: "N1", fromKey: 2, toKey: 3, entryDurationMs: 250 },
  { id: "N2", fromKey: 4, toKey: 5, entryDurationMs: 250 },
  { id: "N3", fromKey: 6, toKey: 7, entryDurationMs: 250 },
  { id: "N4", fromKey: 8, toKey: 9, entryDurationMs: 250 },
  { id: "N5", fromKey: 10, toKey: 11, entryDurationMs: 250 },
  // hand.glb の keyCount は 14 なので、末尾の保持区間は 12-13 が有効範囲になる
  { id: "N0", fromKey: 12, toKey: 13, entryDurationMs: 250 }
];

const STATE_DEFS = [
  { id: "pose1", action: "N1" },
  { id: "pose2", action: "N2" },
  { id: "pose3", action: "N3" },
  { id: "pose4", action: "N4" },
  { id: "pose5", action: "N5" },
  { id: "pose0", action: "N0" }
];

document.addEventListener("DOMContentLoaded", () => {
  start().catch((err) => {
    app?.setDiagnosticsReport?.(Diagnostics.createErrorReport(err, {
      system: "animation_state",
      source: "samples/animation_state/main.js",
      stage: app?.getDiagnosticsReport?.()?.stage ?? "start"
    }));
    if (app?.isConsoleEnabled?.()) {
      console.error("animation_state failed:", err);
    }
    app?.showErrorPanel?.(err, {
      title: "animation_state sample failed",
      id: "start-error",
      background: "rgba(26, 38, 26, 0.92)"
    });
  });
}, false);

function getPoseIndex(stateId) {
  return Math.max(0, STATE_DEFS.findIndex((item) => item.id === stateId));
}

function getNextPoseId() {
  const currentIndex = getPoseIndex(desiredPoseId);
  return STATE_DEFS[(currentIndex + 1) % STATE_DEFS.length].id;
}

function buildHelpLines() {
  return [
    "[w]/[s] rotate model X",
    "[a]/[d] rotate model Y",
    "[z]/[x] rotate model Z",
    "[e]/[r] bone X",
    "[y]/[u] bone Y",
    "[c]/[v] bone Z",
    "[n]/[m] select mesh",
    "[o]/[i] hide/show mesh",
    "[9]/[0] show/hide bones",
    "[1]-[5] request pose1-pose5",
    "[6] request pose0",
    "[/] next state",
    "[@] replay current",
    "[p] auto cycle on/off",
    "[7]/[8] draw on/off",
    "[j] list bones",
    "[k] delay on",
    "[q] quit",
    ...app.getDebugKeyGuideLines()
  ];
}

function refreshDiagnosticsStats() {
  const shapeList = fig?.shapes ?? [];
  const envReport = app.checkEnvironment({
    stage: "runtime-check",
    shapes: shapeList
  });
  const stateInfo = animationState?.getDebugInfo?.() ?? null;
  app.mergeDiagnosticsStats({
    clipCount: clipNames.length,
    vertexCount: g_totalVertices,
    triangleCount: g_totalTriangles,
    meshCount: MAXMESH,
    selectedMesh: MESH,
    selectedBone: BONE,
    selectedBoneName: bones?.[BONE]?.name ?? "-",
    desiredState: desiredPoseId,
    currentState: stateInfo?.stateId ?? "-",
    currentAction: stateInfo?.actionId ?? "-",
    autoCycle: autoCycleEnabled ? "on" : "off",
    drawEnabled: DRAW_FLAG ? "yes" : "no",
    delayEnabled: DELAY_FLAG ? "yes" : "no",
    helpVisible: helpPanel?.visible ? "yes" : "no",
    envOk: envReport.ok ? "yes" : "no",
    envWarning: envReport.warnings?.[0] ?? "-"
  });
  return envReport;
}

function makeProbeReport(frameCount) {
  const shapeList = fig?.shapes ?? [];
  const envReport = app.checkEnvironment({
    stage: "runtime-probe",
    shapes: shapeList
  });
  const report = app.createProbeReport("runtime-probe");
  const clipInfo = fig?.shapes?.[0]?.anim?.getClipInfo?.() ?? null;
  const currentPattern = action?.getPatternInfo?.() ?? null;
  const stateInfo = animationState?.getDebugInfo?.() ?? null;
  const transition = animationState?.getCurrentTransition?.() ?? null;
  Diagnostics.addDetail(report, `gltfFile=${GLTF_FILE}`);
  Diagnostics.addDetail(report, `clip=${clipInfo?.name ?? "-"}`);
  Diagnostics.addDetail(report, `desiredState=${desiredPoseId}`);
  Diagnostics.addDetail(report, `currentState=${stateInfo?.stateId ?? "-"}`);
  Diagnostics.addDetail(report, `currentAction=${stateInfo?.actionId ?? "-"}`);
  Diagnostics.addDetail(report, `pattern=${currentPattern?.id ?? "-"}`);
  Diagnostics.addDetail(report, `transition=${transition?.label ?? "-"}`);
  Diagnostics.addDetail(report, `autoCycle=${autoCycleEnabled ? "on" : "off"}`);
  if (envReport.warnings?.length) {
    Diagnostics.addDetail(report, `envWarning=${envReport.warnings[0]}`);
  }
  Diagnostics.mergeStats(report, {
    frameCount,
    vertexCount: g_totalVertices,
    triangleCount: g_totalTriangles,
    meshCount: MAXMESH,
    selectedMesh: MESH,
    selectedBone: BONE,
    selectedBoneName: bones?.[BONE]?.name ?? "-",
    desiredState: desiredPoseId,
    currentState: stateInfo?.stateId ?? "-",
    currentAction: stateInfo?.actionId ?? "-",
    envOk: envReport.ok ? "yes" : "no",
    autoCycle: autoCycleEnabled ? "on" : "off",
    drawEnabled: DRAW_FLAG ? "yes" : "no",
    delayEnabled: DELAY_FLAG ? "yes" : "no"
  });
  return report;
}

function setBoneParams() {
  bones = skeletons[MESH];
  if (bones) {
    MAXBONE = bones.length;
  }
}

function applyMeshVisibility() {
  if (!fig || !fig.shapes) return;
  for (let i = 0; i < fig.shapes.length; i++) {
    const shouldHide = !DRAW_FLAG || meshHiddenFlags[i] === true;
    fig.shapes[i].hide(shouldHide);
  }
}

function showBones(true_or_false) {
  if (!fig || !fig.shapes) return;
  for (let i = 0; i < fig.shapes.length; i++) {
    const shape = fig.shapes[i];
    const skeleton = shape?.getSkeleton?.();
    if (!skeleton) continue;
    skeleton.showBone(true_or_false);
  }
  app.space.scanSkeletons();
}

function createBoneShape(size, r, g, b, shader) {
  const shape = new Shape(app.getGL());
  shape.applyPrimitiveAsset(Primitive.debugBone(size, shape.getPrimitiveOptions()));
  shape.endShape();
  if (shader) {
    shape.setShader(shader);
  }
  shape.setMaterial("smooth-shader", {
    has_bone: 0,
    use_texture: 0,
    use_normal_map: 0,
    color: [r, g, b, 1.0],
    ambient: 0.25,
    specular: 0.45,
    power: 24.0,
    emissive: 0.0
  });
  return shape;
}

function buildStateTransitions(stateId) {
  return STATE_DEFS
    .filter((item) => item.id !== stateId)
    .map((item) => ({
      to: item.id,
      test: (context) => context.desiredPoseId === item.id
    }));
}

function buildAnimationState() {
  animationState = new AnimationState(action, {
    initialState: "pose0"
  });
  for (let i = 0; i < STATE_DEFS.length; i++) {
    const state = STATE_DEFS[i];
    animationState.addState({
      id: state.id,
      action: state.action,
      transitions: buildStateTransitions(state.id)
    });
  }
  animationState.setVariable("desiredPoseId", desiredPoseId);
}

function setDesiredPose(nextStateId) {
  desiredPoseId = nextStateId;
  animationState?.setVariable("desiredPoseId", desiredPoseId);
}

function updateAutoCycle(nowMs) {
  if (!autoCycleEnabled) {
    return;
  }
  if (nextAutoCycleTimeMs === 0) {
    nextAutoCycleTimeMs = nowMs + 1200;
    return;
  }
  if (nowMs >= nextAutoCycleTimeMs) {
    setDesiredPose(getNextPoseId());
    nextAutoCycleTimeMs = nowMs + 1200;
  }
}

function replayCurrentState() {
  const stateId = animationState?.getCurrentState?.()?.id ?? desiredPoseId;
  animationState?.setState(stateId, {
    context: {
      desiredPoseId,
      nowMs: app.space.now()
    },
    force: true
  });
}

function handleKey(key) {
  const ROT = 1.0;
  lastKey = key;

  switch (key) {
    case "w":
      node.rotateX(ROT);
      break;
    case "s":
      node.rotateX(-ROT);
      break;
    case "a":
      node.rotateY(ROT);
      break;
    case "d":
      node.rotateY(-ROT);
      break;
    case "z":
      node.rotateZ(ROT);
      break;
    case "x":
      node.rotateZ(-ROT);
      break;
    case "j":
      fig.shapes[0].getSkeleton().listBones();
      break;
    case "k":
      DELAY_FLAG = true;
      break;
    case "o":
      meshHiddenFlags[MESH] = true;
      break;
    case "i":
      meshHiddenFlags[MESH] = false;
      break;
    case "m":
      MESH = Math.min(MAXMESH - 1, MESH + 1);
      setBoneParams();
      if (BONE >= MAXBONE) BONE = MAXBONE - 1;
      break;
    case "n":
      MESH = Math.max(0, MESH - 1);
      setBoneParams();
      if (BONE >= MAXBONE) BONE = MAXBONE - 1;
      break;
    case "1":
      setDesiredPose("pose1");
      break;
    case "2":
      setDesiredPose("pose2");
      break;
    case "3":
      setDesiredPose("pose3");
      break;
    case "4":
      setDesiredPose("pose4");
      break;
    case "5":
      setDesiredPose("pose5");
      break;
    case "6":
      setDesiredPose("pose0");
      break;
    case "7":
      DRAW_FLAG = true;
      break;
    case "8":
      DRAW_FLAG = false;
      break;
    case "9":
      showBones(true);
      break;
    case "0":
      showBones(false);
      break;
    case "@":
      replayCurrentState();
      break;
    case "/":
      setDesiredPose(getNextPoseId());
      break;
    case "p":
      autoCycleEnabled = !autoCycleEnabled;
      nextAutoCycleTimeMs = 0;
      break;
    case "e":
      if (bones !== undefined) bones[BONE]?.rotateX(ROT);
      break;
    case "r":
      if (bones !== undefined) bones[BONE]?.rotateX(-ROT);
      break;
    case "c":
      if (bones !== undefined) bones[BONE]?.rotateZ(ROT);
      break;
    case "v":
      if (bones !== undefined) bones[BONE]?.rotateZ(-ROT);
      break;
    case "y":
      if (bones !== undefined) bones[BONE]?.rotateY(ROT);
      break;
    case "u":
      if (bones !== undefined) bones[BONE]?.rotateY(-ROT);
      break;
    case "q":
      app.stop();
      break;
    default:
      break;
  }
}

function updateHud() {
  const envReport = refreshDiagnosticsStats();
  const actionInfo = action?.getActionInfo?.() ?? null;
  const currentPattern = action?.getPatternInfo?.() ?? null;
  const stateInfo = animationState?.getDebugInfo?.() ?? null;
  const currentState = animationState?.getCurrentState?.() ?? null;
  const transition = animationState?.getCurrentTransition?.() ?? null;
  const currentPatternLabel = currentPattern
    ? `${currentPattern.id} ${currentPattern.fromKey}->${currentPattern.toKey}`
    : "-";
  const clipInfo = fig?.shapes?.[0]?.anim?.getClipInfo?.() ?? null;
  const clipLabel = clipInfo
    ? `${clipInfo.name} keys=${clipInfo.keyCount} duration=${clipInfo.durationMs}ms`
    : "-";
  const actionLabel = actionInfo?.actionId
    ? `${actionInfo.actionId} idx=${actionInfo.patternIndex} pause=${actionInfo.paused ? "ON" : "OFF"}`
    : "-";
  const stateLabel = currentState
    ? `${currentState.id} target=${desiredPoseId} auto=${autoCycleEnabled ? "ON" : "OFF"}`
    : `target=${desiredPoseId}`;
  const transitionLabel = transition?.label ?? "-";
  const actionStateLabel = stateInfo
    ? `playing=${stateInfo.playing ? "ON" : "OFF"} paused=${stateInfo.paused ? "ON" : "OFF"}`
    : "-";

  if ((bones !== undefined) && (bones[BONE] !== null)) {
    const statusLines = [
      `key=[${lastKey || " "}]`,
      `clip=${clipLabel}`,
      `vertices=${g_totalVertices} triangles=${g_totalTriangles}`,
      `mesh=${MESH}/${MAXMESH} bone=${BONE}/${MAXBONE} name=${bones[BONE].name}`,
      `state=${stateLabel}`,
      `action=${actionLabel}`,
      `pattern=${currentPatternLabel}`,
      `transition=${transitionLabel} ${actionStateLabel}`,
      `env=${envReport.ok ? "OK" : "WARN"}`,
      app.getDiagnosticsStatusLine(),
      app.isDebugUiEnabled() ? app.getProbeStatusLine() : ""
    ];
    app.setControlRows(app.isDebugUiEnabled() ? app.makeTextControlRows(statusLines.filter(Boolean)) : []);
  } else {
    const statusLines = [
      `key=[${lastKey || " "}]`,
      `clip=${clipLabel}`,
      `vertices=${g_totalVertices} triangles=${g_totalTriangles}`,
      `mesh=${MESH}/${MAXMESH} bone=${BONE}/${MAXBONE}`,
      `state=${stateLabel}`,
      `action=${actionLabel}`,
      `pattern=${currentPatternLabel}`,
      `transition=${transitionLabel} ${actionStateLabel}`,
      `env=${envReport.ok ? "OK" : "WARN"}`,
      app.getDiagnosticsStatusLine(),
      app.isDebugUiEnabled() ? app.getProbeStatusLine() : ""
    ];
    app.setControlRows(app.isDebugUiEnabled() ? app.makeTextControlRows(statusLines.filter(Boolean)) : []);
  }
}

async function start() {
  const output = document.getElementById("output_area") ?? "";

  app = new WebgApp({
    document,
    shaderClass: SmoothShader,
    clearColor: [0.2, 0.2, 0.4, 1.0],
    lightPosition: [0.0, 100.0, 1000.0, 1.0],
    viewAngle: 53.0,
    messageFontTexture: "../../webg/font512.png",
    autoDrawBones: false,
    debugTools: {
      mode: "release",
      system: "animation_state",
      source: "samples/animation_state/main.js",
      probeDefaultAfterFrames: 1
    },
    camera: {
      target: [0.0, 0.0, 0.0],
      distance: 11.5,
      yaw: 0.0,
      pitch: CAMERA_PITCH_DEG
    }
  });
  await app.init();
  // 通常 sample の操作説明は bloom と同じ help panel 形式へ寄せ、
  // current state 表示とは分離して読む構成にする
  helpPanel = app.createHelpPanel({
    id: "animationStateHelpOverlay",
    lines: buildHelpLines()
  });
  app.setDiagnosticsStage("loading");
  app.configureDiagnosticsCapture({
    labelPrefix: "animation_state",
    collect: () => makeProbeReport(app.screen.getFrameCount())
  });
  app.configureDebugKeyInput();
  app.attachInput({
    onKeyDown: (key) => handleKey(key)
  });

  boneShader = new SmoothShader(app.getGL());
  await boneShader.init();
  boneShader.setLightPosition([0, 100, 1000, 1]);

  if (TEXTUTE_FILE !== "") {
    tex = new Texture(app.getGL());
    await tex.readImageFromFile(TEXTUTE_FILE);
  }

  const startTime = app.space.now();
  const boneFlag = true;
  const verboseFlag = false;
  if (output === "") {
    util.printDevice = null;
  } else if (output === "console") {
    util.printDevice = "console";
  } else if (typeof output === "object") {
    util.printDevice = "string";
    util.printStr = "";
  }

  model = await app.loadModel(GLTF_FILE, {
    format: "gltf",
    instantiate: true,
    startAnimations: false,
    gltf: {
      includeSkins: true
    }
  });
  runtime = model.runtime;
  shapes = runtime.shapes;
  clipNames = model.getClipNames();
  if (shapes[0]?.anim !== null) {
    shapes[0].anim.list();
  }

  MAXMESH = shapes.length;
  meshHiddenFlags = new Array(MAXMESH).fill(false);
  const time = app.space.now() - startTime;
  util.printf("loading time = %6.2f sec \n", time / 1000);

  if (typeof output === "object") {
    output.textContent = util.printStr;
  }

  fig = { shapes };
  const rootNodeInfo = runtime.nodes.find((item) => item.parent === null) ?? runtime.nodes[0] ?? null;
  node = rootNodeInfo ? (model.instantiated?.nodeMap?.get(rootNodeInfo.id) ?? null) : null;
  if (!node) {
    throw new Error("Failed to resolve glTF root node for animation_state");
  }

  const size = app.getShapeSize(shapes);
  const boneShape = createBoneShape(size.max / 70, 1, 1, 1, boneShader);
  app.cameraRig.setPosition(size.centerx, size.centery, size.centerz);
  // hand 全体が上側で見切れにくいよう、少し引いた距離と軽い上向き角を与える
  app.eye.setPosition(0.0, 0.0, Math.max(1.0, size.max * CAMERA_DISTANCE_SCALE));
  app.eye.setAttitude(0.0, CAMERA_PITCH_DEG, 0.0);

  for (let i = 0; i < shapes.length; i++) {
    const shape = shapes[i];
    const skeleton = shape.getSkeleton();
    if ((skeleton !== null) && (skeleton.getBoneCount() > 0)) {
      skeleton.setBoneShape(boneShape);
      skeletons.push(skeleton.getBoneOrder());
    } else {
      util.printf("No skeleton");
    }

    if (TEXTUTE_FILE !== "") {
      shape.setMaterial("smooth-shader", {
        ambient: 0.4,
        specular: 0.2,
        power: 20,
        use_texture: 1,
        use_normal_map: 0,
        texture: tex,
        color: [1.0, 1.0, 1.0, 1.0]
      });
    } else {
      shape.setMaterial("smooth-shader", {
        ambient: 0.4,
        specular: 0.2,
        power: 20,
        use_texture: 0,
        use_normal_map: 0,
        color: [0.9, 0.75, 0.75, 1.0]
      });
    }
    util.printf("object vertex#=%d  triangle#=%d\n", shape.getVertexCount(), shape.getTriangleCount());
    g_totalVertices += shape.getVertexCount();
    g_totalTriangles += shape.getTriangleCount();
  }

  setBoneParams();

  // hand sample と同じ pattern / action を組み立てる
  // sample 側は desiredPoseId だけを変更し、
  // どの action を開始するかは AnimationState へ委譲する
  // action は 1 回の遷移を再生し、state が変わるまで最後の pose を残す
  action = new Action(fig.shapes[0].anim);
  for (let i = 0; i < FINGER_PATTERNS.length; i++) {
    const pattern = FINGER_PATTERNS[i];
    action.addPattern(pattern);
    action.addAction(pattern.id, [pattern.id]);
  }
  action.setVerbose(false);

  buildAnimationState();
  animationState.setState("pose0", {
    context: {
      desiredPoseId,
      nowMs: app.space.now()
    },
    force: true
  });

  showBones(true);
  app.setDiagnosticsStage("runtime");
  updateHud();

  app.start({
    onUpdate: () => {
      const nowMs = app.space.now();
      boneShader.setProjectionMatrix(app.projectionMatrix);
      applyMeshVisibility();
      updateAutoCycle(nowMs);
      animationState.update({
        desiredPoseId,
        nowMs
      });
      if (DELAY_FLAG) {
        util.sleep(0.1);
      }
      updateHud();
    },
    onAfterDraw3d: () => {
      // WebgApp の自動 bone 描画を使わず、
      // sample 側で明示的に bone を重ねて state machine 導入前後の違いを追いやすくする
      app.screen.clearDepthBuffer();
      boneShader.setProjectionMatrix(app.projectionMatrix);
      app.space.scanSkeletons();
      app.space.drawBones();
    }
  });
}
