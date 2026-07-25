// ---------------------------------------------
// samples/eye_rig/main.js  2026/07/25
//   EyeRig specification verification sample
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import WebgApp from "../../webg/WebgApp.js";
import { buildErrorPanelOptions, buildHelpPanelOptions } from "../../webg/OverlayPanelPresets.js";
import CommandPalette, {
  getDefaultCommandPaletteCss
} from "../../webg/CommandPalette.js";
import Diagnostics from "../../webg/Diagnostics.js";
import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";
import EyeRig from "../../webg/EyeRig.js?v=20260612_02";

const MODE_ORBIT = "orbit";
const MODE_FIRST_PERSON = "first-person";
const MODE_FOLLOW = "follow";

// 各modeの初期値を1か所へ集約し、resetとconstructor optionが同じ値を参照する
// Followのrod yaw=180は、camera vehicleのlocal +Z前方をcameraの視線方向へ合わせる基準角度
const CAMERA_DEFAULTS = {
  orbit: {
    target: [0.0, 1.4, 0.0],
    distance: 20.0,
    yaw: 28.0,
    pitch: -18.0
  },
  firstPerson: {
    position: [1.2, 1.2, -4.2],
    bodyYaw: 180.0,
    eyeHeight: 1.2,
    lookYaw: 0.0,
    lookPitch: -4.0
  },
  follow: {
    basePosition: [3.4, 4.2, -2.0],
    baseAttitude: [0.0, 0.0, 0.0],
    distance: 10.0,
    yaw: 180.0,
    pitch: -4.0,
    roll: 0.0,
    response: 5.5,
    maxAngularSpeed: 220.0,
    targetOffset: [0.0, 1.0, 0.0]
  }
};

// sample全体で共有する状態
// orbitParentModeは、対象の回転を継承する階層と位置だけを共有する階層を切り替える
const state = {
  mode: MODE_ORBIT,
  paused: false,
  elapsedSec: 0.0,
  orbitParentMode: "vehicle",
  helpText: "",
  helpFrameBucket: -1,
  frameCount: 0
};

let app = null;
let eyeRig = null;
let cameraVehicle = null;
let targetVehicle = null;
let independentCameraAnchor = null;
let palette = null;

// DOM準備後にsampleを開始し、初期化失敗は標準error panelへ表示する
// console出力はWebgAppのrelease/debug設定を尊重する
document.addEventListener("DOMContentLoaded", () => {
  start().catch((error) => {
    app?.setDiagnosticsReport?.(Diagnostics.createErrorReport(error, {
      system: "eye_rig",
      source: "samples/eye_rig/main.js",
      stage: app?.getDiagnosticsReport?.()?.stage ?? "start"
    }));
    if (app?.isConsoleEnabled?.()) {
      console.error("eye_rig failed:", error);
    }
    app?.showOverlayPanel?.(buildErrorPanelOptions(error, {
      id: "eye-rig-error",
      title: "eye_rig failed"
    }));
  });
});

// SmoothShaderで描画するShapeを生成する
// buildGeometryはPrimitiveを追加し、materialはsample内の各役割を色で区別する
function createShape(buildGeometry, material) {
  const shape = new Shape(app.getGPU());
  buildGeometry(shape);
  shape.endShape();
  shape.setMaterial("smooth-shader", {
    has_bone: 0,
    use_texture: 0,
    ambient: 0.20,
    specular: 0.58,
    power: 30.0,
    ...material
  });
  return shape;
}

// 同じGPU meshを参照するShapeを作り、track markerや車両部品でbufferを重複生成しない
// material parameterは参照元からコピーし、見た目も同じ状態から開始する
function createShapeReference(sourceShape) {
  const shape = new Shape(app.getGPU());
  shape.referShape(sourceShape);
  shape.copyShaderParamsFromShape(sourceShape);
  return shape;
}

// 指定parentへShape付きNodeを追加し、local位置と姿勢を設定する
// scene構築の反復部分を短くしつつ、Node階層は呼び出し側から読み取れる形を保つ
function addShapeNode(parent, name, shape, position, attitude = [0.0, 0.0, 0.0]) {
  const node = app.space.addNode(parent, name);
  node.addShape(createShapeReference(shape));
  node.setPosition(...position);
  node.setAttitude(...attitude);
  return node;
}

// camera vehicleとtarget vehicleが走る3次元track上の位置を返す
// 複数周期の上下動を重ね、Followで急カーブ、上り下り、短いjumpに近い変化を確認できる軌道にする
function getTrackPosition(parameter) {
  return [
    Math.cos(parameter) * 18.0 + Math.cos(parameter * 2.0) * 3.0,
    5.0 + Math.sin(parameter * 1.5) * 3.2 + Math.sin(parameter * 3.0) * 1.1,
    Math.sin(parameter) * 18.0
  ];
}

// trackの接線から、local +Zが進行方向を向くyawとpitchを求める
// rollはカーブ量に応じたbankとして別に加え、FollowのupReference差を見やすくする
function getTrackAttitude(parameter) {
  const epsilon = 0.002;
  const before = getTrackPosition(parameter - epsilon);
  const after = getTrackPosition(parameter + epsilon);
  const dx = after[0] - before[0];
  const dy = after[1] - before[1];
  const dz = after[2] - before[2];
  const horizontal = Math.hypot(dx, dz);
  const yaw = Math.atan2(dx, dz) * 180.0 / Math.PI;
  const pitch = -Math.atan2(dy, horizontal) * 180.0 / Math.PI;
  const roll = Math.sin(parameter * 1.35) * 24.0;
  return [yaw, pitch, roll];
}

// 指定parameterの位置と姿勢をvehicle Nodeへ適用する
// camera vehicleとtarget vehicleへ同じtrack定義を使い、位相差だけで前後関係を作る
function placeVehicle(node, parameter) {
  node.setPosition(...getTrackPosition(parameter));
  node.setAttitude(...getTrackAttitude(parameter));
}

// 車両本体、進行方向marker、左右wingをNode階層として作る
// 非対称な形と色により、yaw、pitch、rollと前後方向を画面から判別しやすくする
function createVehicle(name, bodyColor, noseColor) {
  const root = app.space.addNode(null, `${name}-root`);
  const bodyShape = createShape((shape) => {
    shape.applyPrimitiveAsset(Primitive.cuboid(2.8, 1.6, 5.0, shape.getPrimitiveOptions()));
  }, {
    color: bodyColor,
    specular: 0.72,
    power: 42.0
  });
  const noseShape = createShape((shape) => {
    shape.applyPrimitiveAsset(Primitive.cone(2.4, 0.9, 20, shape.getPrimitiveOptions()));
  }, {
    color: noseColor,
    specular: 0.82,
    power: 54.0
  });
  const wingShape = createShape((shape) => {
    shape.applyPrimitiveAsset(Primitive.cuboid(6.2, 0.24, 1.5, shape.getPrimitiveOptions()));
  }, {
    color: [bodyColor[0] * 0.72, bodyColor[1] * 0.72, bodyColor[2] * 0.72, 1.0],
    specular: 0.46
  });

  addShapeNode(root, `${name}-body`, bodyShape, [0.0, 0.0, 0.0]);
  addShapeNode(root, `${name}-wing`, wingShape, [0.0, 0.0, -0.25]);
  // Primitive.coneの長軸はYなので、pitch=90でlocal +Z方向へ向ける
  addShapeNode(root, `${name}-nose`, noseShape, [0.0, 0.0, 3.2], [0.0, 90.0, 0.0]);
  return root;
}

// 床、track marker、2台のvehicle、回転を継承しないcamera anchorを作る
// independentCameraAnchorはcamera vehicleのworld位置だけを毎frameコピーし、姿勢はidentityを保つ
function buildScene() {
  const floorShape = createShape((shape) => {
    shape.applyPrimitiveAsset(Primitive.cuboid(64.0, 0.8, 64.0, shape.getPrimitiveOptions()));
  }, {
    color: [0.20, 0.25, 0.28, 1.0],
    ambient: 0.28,
    specular: 0.24,
    power: 18.0
  });
  addShapeNode(null, "floor", floorShape, [0.0, -0.4, 0.0]);

  const markerShape = createShape((shape) => {
    shape.applyPrimitiveAsset(Primitive.cuboid(0.55, 0.55, 0.55, shape.getPrimitiveOptions()));
  }, {
    color: [0.20, 0.64, 0.78, 1.0],
    ambient: 0.26,
    specular: 0.44
  });
  for (let index = 0; index < 72; index += 1) {
    const parameter = Math.PI * 2.0 * index / 72.0;
    addShapeNode(null, `track-marker-${index}`, markerShape, getTrackPosition(parameter));
  }

  cameraVehicle = createVehicle(
    "camera-vehicle",
    [0.18, 0.52, 0.92, 1.0],
    [0.72, 0.90, 1.0, 1.0]
  );
  targetVehicle = createVehicle(
    "target-vehicle",
    [0.96, 0.42, 0.12, 1.0],
    [1.0, 0.86, 0.34, 1.0]
  );
  independentCameraAnchor = app.space.addNode(null, "independent-camera-anchor");

  placeVehicle(cameraVehicle, 0.0);
  placeVehicle(targetVehicle, 0.72);
  independentCameraAnchor.setPosition(...cameraVehicle.getWorldPosition());
  independentCameraAnchor.setAttitude(0.0, 0.0, 0.0);
}

// cameraRigの親を付け替え、Orbitで対象姿勢を継承する場合としない場合を比較する
// attach/detachは見た目を維持するため、付け替え後にEyeRig stateをapplyして正規local値へ戻す
function attachRigTo(parent) {
  if (app.cameraRig.getParent() === parent) return;
  app.cameraRig.detach();
  app.cameraRig.attach(parent);
  eyeRig?.apply(true);
}

// 現在modeに必要なcamera階層を設定する
// First PersonとFollowはcamera vehicleへ固定し、OrbitだけH操作で親を切り替えられる
function applyModeParent() {
  if (state.mode === MODE_ORBIT && state.orbitParentMode === "independent") {
    attachRigTo(independentCameraAnchor);
  } else {
    attachRigTo(cameraVehicle);
  }
}

// Orbit stateを初期値へ戻し、親classが保持するquaternion mirrorもsetAngles経由で同期する
// targetはcameraRig親座標系のlocal位置なので、親切替後も同じ数値を使用する
function resetOrbit() {
  const defaults = CAMERA_DEFAULTS.orbit;
  eyeRig.setType(MODE_ORBIT);
  eyeRig.setTarget(...defaults.target);
  eyeRig.setAngles(defaults.yaw, defaults.pitch, 0.0);
  eyeRig.setLookAngles(0.0, 0.0, 0.0);
  eyeRig.setDistance(defaults.distance);
}

// First Personをcamera vehicle後方の標準取り付け位置へ戻す
// bodyYaw=180でcamera vehicleのlocal +Z進行方向を向き、lookYaw/Pitchは独立視線として初期化する
function resetFirstPerson() {
  const defaults = CAMERA_DEFAULTS.firstPerson;
  eyeRig.setType(MODE_FIRST_PERSON);
  eyeRig.setPosition(...defaults.position);
  eyeRig.setAngles(defaults.bodyYaw, 0.0, 0.0);
  eyeRig.setEyeHeight(defaults.eyeHeight);
  eyeRig.setLookAngles(defaults.lookYaw, defaults.lookPitch, 0.0);
}

// Followのbase取り付け位置、rod基準角度、eye距離、追跡状態を初期化する
// 次のupdateFollow()でtarget方向へ初回snapし、その後は滑らかな追跡へ移る
function resetFollow() {
  const defaults = CAMERA_DEFAULTS.follow;
  eyeRig.setType(MODE_FOLLOW);
  eyeRig.follow.basePosition = [...defaults.basePosition];
  eyeRig.follow.baseAttitude = [...defaults.baseAttitude];
  eyeRig.follow.response = defaults.response;
  eyeRig.follow.maxAngularSpeed = defaults.maxAngularSpeed;
  eyeRig.follow.distance = defaults.distance;
  eyeRig.follow.yaw = defaults.yaw;
  eyeRig.follow.pitch = defaults.pitch;
  eyeRig.follow.roll = defaults.roll;
  eyeRig.follow.targetOffset = [...defaults.targetOffset];
  eyeRig.resetFollowTracking();
  eyeRig.apply(true);
}

// 現在modeの初期値だけを戻す
// vehicleの時間位置やpause状態は保持し、camera stateの差だけを比較できるようにする
function resetActiveMode() {
  if (state.mode === MODE_ORBIT) {
    resetOrbit();
  } else if (state.mode === MODE_FIRST_PERSON) {
    resetFirstPerson();
  } else {
    resetFollow();
  }
  applyModeParent();
}

// modeを切り替え、必要な親子階層と各modeの初期値をまとめて設定する
// mode間でbase/rod/eyeの役割が変わるため、sampleでは切替時に明示的にresetする
function setMode(mode) {
  state.mode = mode;
  if (mode !== MODE_ORBIT) {
    state.orbitParentMode = "vehicle";
  }
  applyModeParent();
  resetActiveMode();
  refreshAfterCommand(true);
}

// Orbitでcamera vehicleの回転を継承するか、位置だけを共有するかを切り替える
// FollowとFirst Personでは階層の目的が異なるため、この操作はOrbit中だけ有効にする
function toggleOrbitParentMode() {
  if (state.mode !== MODE_ORBIT) return;
  state.orbitParentMode = state.orbitParentMode === "vehicle"
    ? "independent"
    : "vehicle";
  applyModeParent();
  resetOrbit();
  refreshAfterCommand(true);
}

// Followの上方向基準をbase、rod、worldの順に切り替える
// 切替直後は初期姿勢を再計算し、それぞれのrollの見え方を比較できるようにする
function cycleFollowUpReference() {
  if (state.mode !== MODE_FOLLOW) return;
  const choices = ["base", "rod", "world"];
  const current = choices.indexOf(eyeRig.follow.upReference);
  eyeRig.follow.upReference = choices[(current + 1) % choices.length];
  eyeRig.resetFollowTracking();
  refreshAfterCommand(true);
}

// keyboardとCommandPaletteから届く単発操作を共通処理する
// InputControllerのhold操作はEyeRig.update()へ任せ、ここではmode等のedge操作だけを扱う
function applyAction(key) {
  const normalized = String(key).toLowerCase();
  if (normalized === "1") {
    setMode(MODE_ORBIT);
  } else if (normalized === "2") {
    setMode(MODE_FIRST_PERSON);
  } else if (normalized === "3") {
    setMode(MODE_FOLLOW);
  } else if (normalized === "r") {
    resetActiveMode();
  } else if (normalized === "p") {
    state.paused = !state.paused;
  } else if (normalized === "h") {
    toggleOrbitParentMode();
  } else if (normalized === "u") {
    cycleFollowUpReference();
  }
}

// help panelへ表示する説明を現在modeとstateから組み立てる
// 操作説明だけでなく、base/rod/eyeの責務を画面上で確認できる短い仕様説明も含める
function buildHelpLines() {
  const common = [
    "1 Orbit / 2 First Person / 3 Follow",
    "R reset active mode / P pause vehicles",
    "Drag: rotate or look / Wheel: distance",
    "CommandPalette: double tap canvas or press /",
    "Touch drag: 1 finger rotate/look, 2 finger pan or pinch"
  ];
  const status = [
    "",
    ...buildStatusLines(),
    "",
    ...app.getDebugKeyGuideLines()
  ];
  if (state.mode === MODE_ORBIT) {
    return [
      "Orbit: base=local target, rod=orbit angle, eye=distance",
      `H hierarchy: ${state.orbitParentMode === "vehicle" ? "inherit vehicle rotation" : "position only, independent rotation"}`,
      "Shift+Drag / Shift+Arrow: PAN",
      ...common,
      ...status
    ];
  }
  if (state.mode === MODE_FIRST_PERSON) {
    return [
      "First Person: base=mount position/body, eye=independent look",
      "W/A/S/D move local base, Q/E down/up, Shift run",
      "Horizontal drag changes lookYaw, not bodyYaw",
      ...common,
      ...status
    ];
  }
  return [
    "Follow: base=camera vehicle mount, rod=stable composition",
    "eye=dynamic target tracking, base is never moved to target",
    `U upReference: ${eyeRig.follow.upReference}`,
    ...common,
    ...status
  ];
}

// help panelを初回作成または内容変更時だけ更新する
// 毎frame同じDOMを書き換えず、modeや設定が変化した場合だけ本文を差し替える
function updateHelpPanel(force = false) {
  if (!app || !eyeRig) return;
  const bucket = Math.floor(state.frameCount / 6);
  if (!force && bucket === state.helpFrameBucket) return;
  const lines = buildHelpLines();
  const text = lines.join("\n");
  if (!force && text === state.helpText) return;
  if (app.getOverlayPanel("eyeRigHelp")) {
    app.updateOverlayPanel("eyeRigHelp", { lines });
  } else {
    app.showOverlayPanel(buildHelpPanelOptions({
      id: "eyeRigHelp",
      collapsed: true,
      title: "EyeRig Specification",
      anchor: "top-left",
      maxWidth: "520px",
      maxHeight: "46vh",
      scrollY: true,
      lines
    }));
  }
  state.helpText = text;
  state.helpFrameBucket = bucket;
}

// base/rod/eyeと2台のvehicle位置を短い形式でHelp Panelへ表示する
// FollowではviewDotとangular errorを追加し、視線がtargetへ収束する様子を数値でも確認する
function buildStatusLines() {
  const baseLocal = app.cameraRig.getPosition();
  const baseWorld = app.cameraRig.getWorldPosition();
  const eyeWorld = app.eye.getWorldPosition();
  const cameraWorld = cameraVehicle.getWorldPosition();
  const targetWorld = targetVehicle.getWorldPosition();
  const lines = [
    `mode=${state.mode} paused=${state.paused ? "yes" : "no"} frame=${state.frameCount}`,
    `baseLocal=(${baseLocal.map((v) => v.toFixed(1)).join(", ")})`,
    `baseWorld=(${baseWorld.map((v) => v.toFixed(1)).join(", ")})`,
    `eyeWorld=(${eyeWorld.map((v) => v.toFixed(1)).join(", ")})`,
    `cameraVehicle=(${cameraWorld.map((v) => v.toFixed(1)).join(", ")})`,
    `targetVehicle=(${targetWorld.map((v) => v.toFixed(1)).join(", ")})`
  ];
  if (state.mode === MODE_FOLLOW) {
    lines.push(
      `follow dot=${eyeRig.follow.lastViewDot.toFixed(5)} error=${eyeRig.follow.lastAngularErrorDeg.toFixed(2)}deg`,
      `up=${eyeRig.follow.upReference} response=${eyeRig.follow.response.toFixed(1)} max=${eyeRig.follow.maxAngularSpeed.toFixed(0)}deg/s`
    );
  } else if (state.mode === MODE_FIRST_PERSON) {
    lines.push(
      `bodyYaw=${eyeRig.firstPerson.bodyYaw.toFixed(1)} lookYaw=${eyeRig.firstPerson.lookYaw.toFixed(1)} lookPitch=${eyeRig.firstPerson.lookPitch.toFixed(1)}`
    );
  } else {
    lines.push(
      `orbit parent=${state.orbitParentMode} yaw=${eyeRig.orbit.yaw.toFixed(1)} pitch=${eyeRig.orbit.pitch.toFixed(1)} dist=${eyeRig.orbit.distance.toFixed(1)}`
    );
  }
  return lines;
}

// vehicleを進め、回転を継承しないanchorへcamera vehicleの位置だけをコピーする
// pause中も現在姿勢を再適用し、mode切替直後のworld matrixを同じframeで確定させる
function updateVehicles(deltaSec) {
  if (!state.paused) {
    state.elapsedSec += deltaSec;
  }
  const cameraParameter = state.elapsedSec * 0.34;
  const targetParameter = cameraParameter + 0.78 + Math.sin(state.elapsedSec * 0.42) * 0.16;
  placeVehicle(cameraVehicle, cameraParameter);
  placeVehicle(targetVehicle, targetParameter);
  independentCameraAnchor.setPosition(...cameraVehicle.getWorldPosition());
  independentCameraAnchor.setAttitude(0.0, 0.0, 0.0);
}

// diagnostics probeへ、mode、親階層、Follow注視精度を保存する
// ブラウザ上の見た目だけでなく、後からtext/jsonで追跡結果を共有できるようにする
function createProbeReport() {
  const report = app.createProbeReport("runtime-probe");
  Diagnostics.addDetail(report, `mode=${state.mode}`);
  Diagnostics.addDetail(report, `orbitParentMode=${state.orbitParentMode}`);
  Diagnostics.addDetail(report, `followUpReference=${eyeRig.follow.upReference}`);
  Diagnostics.addDetail(report, `followViewDot=${eyeRig.follow.lastViewDot.toFixed(6)}`);
  Diagnostics.addDetail(report, `followAngularErrorDeg=${eyeRig.follow.lastAngularErrorDeg.toFixed(4)}`);
  Diagnostics.mergeStats(report, {
    frameCount: state.frameCount,
    mode: state.mode,
    paused: state.paused ? "yes" : "no",
    followViewDot: eyeRig.follow.lastViewDot.toFixed(6),
    followAngularErrorDeg: eyeRig.follow.lastAngularErrorDeg.toFixed(4)
  });
  return report;
}

// `after`のコマンドを現在の入力と実行状態に合わせて更新する
function refreshAfterCommand(forceHelp = false) {
  palette?.render();
  updateHelpPanel(forceHelp);
  app?.requestRender?.();
}

// コマンドの状態を現在の入力と状態から求め、呼び出し元へ返す
function getCommandState(id) {
  return {
    active: (id === "mode-orbit" && state.mode === MODE_ORBIT)
      || (id === "mode-first-person" && state.mode === MODE_FIRST_PERSON)
      || (id === "mode-follow" && state.mode === MODE_FOLLOW)
      || (id === "hierarchy-vehicle" && state.mode === MODE_ORBIT && state.orbitParentMode === "vehicle")
      || (id === "hierarchy-independent" && state.mode === MODE_ORBIT && state.orbitParentMode === "independent"),
    disabled: (id === "hierarchy-vehicle" || id === "hierarchy-independent") && state.mode !== MODE_ORBIT
      || id === "up-reference" && state.mode !== MODE_FOLLOW
  };
}

// 低頻度のmode切替と設定操作は、常時表示buttonではなくCommandPaletteへ集約する
function installCommandPalette() {
  palette = new CommandPalette({
    document,
    container: document.body,
    viewport: app.screen.canvas,
    title: "EyeRig",
    pageRows: 5,
    closeOnCommand: false,
    getCommandState,
    onChange: (id, value) => {
      if (id === "pause") {
        state.paused = value;
      } else if (id === "up-reference") {
        eyeRig.follow.upReference = value;
        eyeRig.resetFollowTracking();
      }
      refreshAfterCommand(true);
    },
    onCommand: (id) => {
      if (id === "mode-orbit") setMode(MODE_ORBIT);
      else if (id === "mode-first-person") setMode(MODE_FIRST_PERSON);
      else if (id === "mode-follow") setMode(MODE_FOLLOW);
      else if (id === "reset") resetActiveMode();
      else if (id === "hierarchy-vehicle") {
        if (state.mode === MODE_ORBIT) {
          state.orbitParentMode = "vehicle";
          applyModeParent();
          resetOrbit();
        }
      } else if (id === "hierarchy-independent") {
        if (state.mode === MODE_ORBIT) {
          state.orbitParentMode = "independent";
          applyModeParent();
          resetOrbit();
        }
      }
      refreshAfterCommand(true);
    },
    commands: [
      // 1ページ目
      { id: "mode-orbit", label: "Orbit", detail: "1", modeSwitch: true },
      { id: "mode-first-person", label: "First", detail: "2", modeSwitch: true },
      { id: "mode-follow", label: "Follow", detail: "3", modeSwitch: true },
      { id: "palette-next", label: "Next", detail: "page", pageSwitch: true },
      { type: "toggle", id: "pause", label: "Pause", detail: "P", value: () => state.paused },
      { id: "reset", label: "Reset", detail: "R" },
      { id: "hierarchy-vehicle", label: "Rig", detail: "vehicle", modeSwitch: true },
      { id: "hierarchy-independent", label: "Rig", detail: "free", modeSwitch: true },
      { type: "select", id: "up-reference", label: "Follow Up", value: () => eyeRig.follow.upReference, options: [
        { value: "base", label: "base" },
        { value: "rod", label: "rod" },
        { value: "world", label: "world" }
      ] },
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ]
  });
  palette.attachToCanvas(app.screen.canvas, { key: "/" });
  palette.setStyle(getDefaultCommandPaletteCss());
}

// WebgApp、scene、EyeRig、input、diagnosticsを順番に初期化して描画loopを開始する
// コアEyeRigは変更せず、Follow仕様だけをsample-local派生classで検証する
async function start() {
  app = new WebgApp({
    document,
    renderMode: "ondemand",
    clearColor: [0.07, 0.11, 0.15, 1.0],
    lightPosition: [120.0, 180.0, 220.0, 1.0],
    viewAngle: 54.0,
    projectionNear: 0.1,
    projectionFar: 220.0,
    messageFontTexture: "../../webg/font512.png",
    debugTools: {
      mode: "release",
      system: "eye_rig",
      source: "samples/eye_rig/main.js",
      probeDefaultAfterFrames: 1
    },
    camera: {
      target: CAMERA_DEFAULTS.orbit.target,
      distance: CAMERA_DEFAULTS.orbit.distance,
      yaw: CAMERA_DEFAULTS.orbit.yaw,
      pitch: CAMERA_DEFAULTS.orbit.pitch
    }
  });
  await app.init();
  app.setDiagnosticsStage("runtime");
  buildScene();

  // WebgApp標準cameraRigをcamera vehicleの子へ接続し、親子行列による追従を初期構成とする
  app.cameraRig.attach(cameraVehicle);
  eyeRig = new EyeRig(app.cameraRig, app.cameraRod, app.eye, {
    document,
    element: app.screen.canvas,
    input: app.input,
    type: MODE_ORBIT,
    orbit: {
      ...CAMERA_DEFAULTS.orbit,
      minDistance: 5.0,
      maxDistance: 80.0,
      dragPanSpeed: 1.2
    },
    firstPerson: {
      ...CAMERA_DEFAULTS.firstPerson,
      moveSpeed: 8.0,
      runMultiplier: 2.0
    },
    follow: {
      targetNode: targetVehicle,
      targetOffset: CAMERA_DEFAULTS.follow.targetOffset,
      distance: CAMERA_DEFAULTS.follow.distance,
      yaw: CAMERA_DEFAULTS.follow.yaw,
      pitch: CAMERA_DEFAULTS.follow.pitch,
      roll: CAMERA_DEFAULTS.follow.roll,
      minDistance: 2.0,
      maxDistance: 18.0,
      basePosition: CAMERA_DEFAULTS.follow.basePosition,
      baseAttitude: CAMERA_DEFAULTS.follow.baseAttitude,
      response: CAMERA_DEFAULTS.follow.response,
      maxAngularSpeed: CAMERA_DEFAULTS.follow.maxAngularSpeed,
      upReference: "base"
    }
  });
  eyeRig.attachPointer();
  resetOrbit();
  applyModeParent();

  app.attachInput({
    onKeyDown: (key, event) => {
      if (event.repeat) return;
      applyAction(key);
      refreshAfterCommand(true);
    }
  });
  installCommandPalette();
  updateHelpPanel(true);

  app.configureDiagnosticsCapture({
    labelPrefix: "eye_rig",
    collect: createProbeReport
  });
  app.configureDebugKeyInput();

  // browser上の自動確認からframe進行、mode、追跡精度、主要world位置を読み取れるようにする
  // 参照専用関数だけを公開し、sample stateやNodeを外部コードから直接変更させない
  globalThis.eyeRigSample = {
    getState: () => ({
      mode: state.mode,
      paused: state.paused,
      frameCount: state.frameCount,
      orbitParentMode: state.orbitParentMode,
      followUpReference: eyeRig.follow.upReference,
      followViewDot: eyeRig.follow.lastViewDot,
      followAngularErrorDeg: eyeRig.follow.lastAngularErrorDeg,
      baseLocal: app.cameraRig.getPosition(),
      baseWorld: app.cameraRig.getWorldPosition(),
      eyeWorld: app.eye.getWorldPosition(),
      cameraVehicleWorld: cameraVehicle.getWorldPosition(),
      targetVehicleWorld: targetVehicle.getWorldPosition()
    })
  };

  app.start({
    onUpdate: ({ deltaSec }) => {
      state.frameCount += 1;
      updateVehicles(deltaSec);
      eyeRig.update(deltaSec);
      // DOMから読み取れるdatasetへ最小限の検証値を写し、browser自動確認でframe進行を判定する
      app.screen.canvas.dataset.eyeRigMode = state.mode;
      app.screen.canvas.dataset.eyeRigFrame = String(state.frameCount);
      app.screen.canvas.dataset.eyeRigFollowDot = eyeRig.follow.lastViewDot.toFixed(6);
      app.screen.canvas.dataset.eyeRigFollowError = eyeRig.follow.lastAngularErrorDeg.toFixed(4);
      app.screen.canvas.dataset.eyeRigFollowUp = eyeRig.follow.upReference;
      app.screen.canvas.dataset.eyeRigBodyYaw = eyeRig.firstPerson.bodyYaw.toFixed(4);
      app.screen.canvas.dataset.eyeRigLookYaw = eyeRig.firstPerson.lookYaw.toFixed(4);
      app.screen.canvas.dataset.eyeRigOrbitTarget = eyeRig.orbit.target
        .map((value) => value.toFixed(4))
        .join(",");
      updateHelpPanel();
      app.updateDebugProbe();
    },
    onBeforeDraw: () => {
      // WebgAppのcamera effect処理後にEyeRigのlocal stateを再適用し、親子階層を最終姿勢へ戻す
      eyeRig.apply(true);
    }
  });
}
