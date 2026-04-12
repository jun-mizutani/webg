// -------------------------------------------------
// json_loader sample
//   main.js       2026/04/12
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// -------------------------------------------------

import WebgApp from "../../webg/WebgApp.js";
import SmoothShader from "../../webg/SmoothShader.js";
import EyeRig from "../../webg/EyeRig.js";
import Diagnostics from "../../webg/Diagnostics.js";

const MODEL_ASSET_FILE = "./modelasset.json";
const DOWNLOAD_FILE = "modelasset_copy.json";
const DEBUG_MODE = "debug";
const GUIDE_LINES = [
  "Drag or Arrow: orbit",
  "[ / ] or wheel: zoom",
  "[q]/[e]: camera up/down",
  "[space]: pause all  [1]: replay  [2]/[3]: pause/resume",
  "[4]/[5]: prev/next clip",
  "[d]: model JSON  [r]: reset camera"
];

let app = null;
let orbit = null;
let model = null;
let modelAsset = null;
let runtime = null;
let paused = false;
let totalTriangles = 0;
let clipNames = [];
let clipInfo = null;
let clipBound = false;
let selectedClipIndex = 0;
let orbitLift = 0.0;
let orbitLiftStep = 0.5;

function refreshDiagnosticsStats() {
  app.mergeDiagnosticsStats({
    clipCount: clipNames.length,
    selectedClipIndex,
    shapeCount: runtime?.shapes?.length ?? 0,
    nodeCount: runtime?.nodes?.length ?? 0,
    runtimeAnimations: runtime?.getAnimationNames?.().length ?? 0,
    triangleCount: totalTriangles,
    boundClip: clipBound ? "yes" : "no"
  });
}

function makeProbeReport(frameCount) {
  const selectedState = getSelectedClipState();
  const report = app.createProbeReport("runtime-probe");
  Diagnostics.addDetail(report, `selectedClipId=${getSelectedClipId() ?? "-"}`);
  Diagnostics.addDetail(report, `selectedState=${selectedState.label}`);
  Diagnostics.mergeStats(report, {
    frameCount,
    clipCount: clipNames.length,
    selectedClipIndex,
    shapeCount: runtime?.shapes?.length ?? 0,
    nodeCount: runtime?.nodes?.length ?? 0,
    runtimeAnimations: runtime?.getAnimationNames?.().length ?? 0,
    triangleCount: totalTriangles,
    paused: paused ? "yes" : "no",
    selectedBound: clipBound ? "yes" : "no"
  });
  return report;
}

function configureOrbitFromShapes(shapeList) {
  // 読み込んだ JSON の shape bbox から、モデル確認向けの距離を決める
  const size = app.getShapeSize(shapeList);
  orbitLift = Math.max(0.4, size.max * 0.08);
  orbitLiftStep = Math.max(0.2, size.max * 0.04);
  const target = [size.centerx, size.centery + orbitLift, size.centerz];
  const distance = Math.max(1.5, size.max * 1.8);

  orbit.orbit.minDistance = Math.max(0.5, size.max * 0.25);
  orbit.orbit.maxDistance = Math.max(8.0, size.max * 8.0);
  orbit.orbit.wheelZoomStep = Math.max(0.2, size.max * 0.04);
  orbit.setTarget(...target);
  orbit.setAngles(20.0, -14.0);
  orbit.setDistance(distance);
}

function moveCameraLift(step) {
  orbitLift += step;
  orbit.setTarget(
    orbit.orbit.target[0],
    orbit.orbit.target[1] + step,
    orbit.orbit.target[2]
  );
}

function countTriangles(shapeList) {
  let total = 0;
  for (let i = 0; i < shapeList.length; i++) {
    total += shapeList[i].getTriangleCount();
  }
  return total;
}

function applyExplicitTextureFlagsToRuntimeShapes(runtime) {
  const shapes = runtime?.shapes ?? [];
  for (let i = 0; i < shapes.length; i++) {
    const shape = shapes[i];
    if (!shape?.updateMaterial) continue;
    const material = shape.getMaterial?.() ?? { params: shape.materialParams ?? {} };
    const params = material?.params ?? {};
    const hasTexture = !!(params.texture ?? shape.texture);
    // JSON から復元した runtime でも textured / untextured mesh が混在しうるため、
    // SmoothShader を使う sample 側で use_texture を完成形へそろえる
    shape.updateMaterial({
      use_texture: hasTexture ? 1 : 0
    });
  }
}

function formatClipNameList(names, maxCount = 3) {
  if (!Array.isArray(names) || names.length === 0) return "-";
  if (names.length <= maxCount) return names.join(", ");
  return `${names.slice(0, maxCount).join(", ")} ... +${names.length - maxCount}`;
}

function buildSelectedClipLines() {
  if (!clipInfo) {
    return [`selectedClip=${selectedClipIndex + 1}/${clipNames.length || 0} -`];
  }
  return [
    `selectedClip=${selectedClipIndex + 1}/${clipNames.length || 0} ${clipInfo.id}`,
    `tracks=${clipInfo.trackCount} keys=${clipInfo.keyCount} duration=${clipInfo.durationMs}ms`,
    `skeleton=${clipInfo.targetSkeleton ?? "-"}`
  ];
}

function getSelectedClipId() {
  if (clipNames.length === 0) {
    return null;
  }
  return clipNames[selectedClipIndex] ?? null;
}

function getSelectedClipInfo() {
  const clipId = getSelectedClipId();
  return clipId ? modelAsset.getClipInfo(clipId) : null;
}

function getSelectedClipState() {
  // 選択中 clip の runtime Animation 状態を HUD 用に整形する
  const clipId = getSelectedClipId();
  const animation = clipId ? runtime?.getAnimation(clipId) : null;
  if (!animation) {
    return {
      label: "MISSING",
      paused: false,
      stopped: true
    };
  }

  const pausedState = animation.schedule.pause === true;
  const stoppedState = animation.schedule.stopped === true;
  let label = "PLAYING";
  if (stoppedState) {
    label = "STOPPED";
  } else if (pausedState) {
    label = "PAUSED";
  }

  return {
    label,
    paused: pausedState,
    stopped: stoppedState
  };
}

function selectClip(step) {
  // 複数 clip を持つ asset でも、選択対象をずらしながら
  // restart/pause/resume の対象 clip を切り替えられるようにする
  if (clipNames.length === 0) {
    return false;
  }
  selectedClipIndex = (selectedClipIndex + step + clipNames.length) % clipNames.length;
  clipInfo = getSelectedClipInfo();
  clipBound = runtime.getAnimation(getSelectedClipId()) !== null;
  return true;
}

function replaySelectedClip() {
  // 選択中 clip を先頭姿勢から再始動する
  const clipId = getSelectedClipId();
  if (!runtime || !clipId) {
    return false;
  }
  const animation = runtime.restartAnimation(clipId);
  if (!animation) {
    return false;
  }
  paused = false;
  runtime.setAnimationsPaused(false);
  return true;
}

function pauseSelectedClip() {
  // 選択中 clip だけを個別 pause helper で停止する
  const clipId = getSelectedClipId();
  if (!runtime || !clipId) {
    return false;
  }
  const animation = runtime.pauseAnimation(clipId);
  return animation !== null;
}

function resumeSelectedClip() {
  // 選択中 clip だけを個別 resume helper で再開する
  const clipId = getSelectedClipId();
  if (!runtime || !clipId) {
    return false;
  }
  const animation = runtime.resumeAnimation(clipId);
  return animation !== null;
}

async function start() {
  app = new WebgApp({
    document,
    shaderClass: SmoothShader,
    clearColor: [0.14, 0.16, 0.20, 1.0],
    lightPosition: [0.0, 100.0, 1000.0, 1.0],
    viewAngle: 53.0,
    messageFontTexture: "../../webg/font512.png",
    camera: {
      target: [0.0, 0.0, 0.0],
      distance: 10.0,
      yaw: 20.0,
      pitch: -14.0
    },
    debugTools: {
      mode: DEBUG_MODE,
      system: "json_loader",
      source: MODEL_ASSET_FILE,
      guideLines: GUIDE_LINES,
      guideOptions: {
        anchor: "top-left",
        x: 0,
        y: 0,
        width: 44,
        wrap: true
      },
      probeDefaultAfterFrames: 1
    }
  });
  await app.init();

  orbit = new EyeRig(app.cameraRig, app.cameraRod, app.eye, {
    document,
    element: app.screen.canvas,
    input: app.input,
    type: "orbit",
    orbit: {
      target: [0.0, 0.0, 0.0],
      distance: 10.0,
      yaw: 20.0,
      pitch: -14.0
    }
  });
  orbit.attachPointer();

  // JSON も同じ facade へ寄せることで、sample 側では形式差をほぼ意識せず
  // ModelAsset と runtime を扱える
  model = await app.loadModel(MODEL_ASSET_FILE, {
    format: "json",
    instantiate: true,
    startAnimations: true,
    onStage: (stage) => app.setDiagnosticsStage(stage)
  });
  modelAsset = model.asset;
  runtime = model.runtime;
  applyExplicitTextureFlagsToRuntimeShapes(runtime);
  clipNames = model.getClipNames();
  selectedClipIndex = 0;
  clipInfo = getSelectedClipInfo();
  app.mergeDiagnosticsStats({ clipCount: clipNames.length });
  clipBound = !!getSelectedClipId() && runtime.getAnimation(getSelectedClipId()) !== null;
  totalTriangles = countTriangles(runtime.shapes);
  configureOrbitFromShapes(runtime.shapes);
  refreshDiagnosticsStats();
  app.configureDiagnosticsCapture({
    labelPrefix: "json_loader",
    collect: () => makeProbeReport(app.screen.getFrameCount())
  });
  app.configureDebugKeyInput();

  app.attachInput({
    onKeyDown: async (key, ev) => {
      if (ev.repeat) return;
      if (key === " ") {
        paused = !paused;
        runtime.setAnimationsPaused(paused);
      } else if (key === "1") {
        replaySelectedClip();
      } else if (key === "2") {
        pauseSelectedClip();
      } else if (key === "3") {
        resumeSelectedClip();
      } else if (key === "4") {
        selectClip(-1);
      } else if (key === "5") {
        selectClip(1);
        refreshDiagnosticsStats();
      } else if (key === "d") {
        model.downloadJSON(DOWNLOAD_FILE);
      } else if (key === "q") {
        moveCameraLift(orbitLiftStep);
      } else if (key === "e") {
        moveCameraLift(-orbitLiftStep);
      } else if (key === "r") {
        configureOrbitFromShapes(runtime.shapes);
      }
    }
  });

  app.start({
    onUpdate: ({ deltaSec }) => {
      orbit.update(deltaSec);

      if (!paused) {
        runtime.playAllAnimations();
      }

      const selectedState = getSelectedClipState();
      refreshDiagnosticsStats();
      app.updateDebugProbe();

      const statusLines = [
        `file=${MODEL_ASSET_FILE}`,
        `shapes=${runtime.shapes.length} triangles=${totalTriangles}`,
        `animations=${runtime.getAnimationNames().length} clips=${clipNames.length}`,
        `clipNames=${formatClipNameList(clipNames)}`,
        ...buildSelectedClipLines(),
        `selectedState=${selectedState.label} pause=${selectedState.paused ? "ON" : "OFF"} stopped=${selectedState.stopped ? "ON" : "OFF"}`,
        `selectedBound=${clipBound ? "ON" : "OFF"} runtimeAnimations=${runtime.getAnimationNames().length}`,
        app.getDiagnosticsStatusLine(),
        `paused=${paused ? "ON" : "OFF"} download=${DOWNLOAD_FILE}`
      ];
      if (app.isDebugUiEnabled()) {
        statusLines.splice(8, 0, app.getProbeStatusLine());
      }
      const controlLines = [...GUIDE_LINES, ...app.getDebugKeyGuideLines(), ...statusLines.filter(Boolean)];
      app.setControlRows(app.isDebugUiEnabled() ? app.makeTextControlRows(controlLines) : []);
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  start().catch((err) => {
    app?.setDiagnosticsReport(Diagnostics.createErrorReport(err, {
      system: "json_loader",
      source: MODEL_ASSET_FILE,
      stage: app?.getDiagnosticsReport?.()?.stage ?? "start"
    }));
    if (app?.isConsoleEnabled?.()) {
      console.error("json_loader failed:", err);
    }
    app?.showErrorPanel?.(err, {
      title: "json_loader failed",
      id: "start-error",
      background: "rgba(34, 46, 28, 0.92)"
    });
  });
});
