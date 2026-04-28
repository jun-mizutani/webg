// -------------------------------------------------
// collada_loader sample
//   main.js       2026/04/20
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// -------------------------------------------------

import WebgApp from "../../webg/WebgApp.js";
import SmoothShader from "../../webg/SmoothShader.js";
import Diagnostics from "../../webg/Diagnostics.js";

// Blender から Collada を書き出す場合も、loader 側の座標変換前提と
// ぶつからないよう export 時に追加変換を入れないファイルを前提とする
const COLLADA_FILE = "./hand.dae";
const DOWNLOAD_FILE = "collada_modelasset.json";
const DEBUG_MODE = "debug";
const DEFAULT_ORBIT = {
  yaw: 20.0,
  pitch: -10.0,
  distance: 10.0,
  target: [0.0, 0.0, 0.0]
};
const ORBIT_BUTTON_STEP = {
  yaw: 7.5,
  pitch: 6.0,
  zoomMultiplier: 1.15
};
const GUIDE_LINES = [
  "Drag: orbit  Shift+Drag: pan",
  "Arrow: orbit  Shift+Arrow: pan",
  "[ / ] or wheel: zoom",
  "[space]: pause  [1]: replay  [2]/[3]: pause/resume",
  "[w]: wireframe  [s]: screenshot  [d]: model JSON  [r]: reset"
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
let orbitLift = 0.0;
let orbitLiftStep = 0.5;
let viewerSize = {
  centerx: 0.0,
  centery: 0.0,
  centerz: 0.0,
  max: 10.0
};
let screenshotName = "";
let wireframe = false;

function refreshDiagnosticsStats() {
  app.mergeDiagnosticsStats({
    clipCount: clipNames.length,
    shapeCount: runtime?.shapes?.length ?? 0,
    nodeCount: runtime?.nodes?.length ?? 0,
    runtimeAnimations: runtime?.getAnimationNames?.().length ?? 0,
    triangleCount: totalTriangles,
    paused: paused ? "yes" : "no",
    primaryBound: clipBound ? "yes" : "no"
  });
}

function makeProbeReport(frameCount) {
  const selectedState = getSelectedClipState();
  const report = app.createProbeReport("runtime-probe");
  Diagnostics.addDetail(report, `primaryClipId=${getPrimaryClipId() ?? "-"}`);
  Diagnostics.addDetail(report, `primaryState=${selectedState.label}`);
  Diagnostics.mergeStats(report, {
    frameCount,
    clipCount: clipNames.length,
    shapeCount: runtime?.shapes?.length ?? 0,
    nodeCount: runtime?.nodes?.length ?? 0,
    runtimeAnimations: runtime?.getAnimationNames?.().length ?? 0,
    triangleCount: totalTriangles,
    paused: paused ? "yes" : "no",
    primaryBound: clipBound ? "yes" : "no"
  });
  return report;
}

function syncOrbitStateToAppCamera() {
  if (!app?.camera || !orbit?.orbit) {
    return;
  }
  app.camera.target[0] = orbit.orbit.target[0];
  app.camera.target[1] = orbit.orbit.target[1];
  app.camera.target[2] = orbit.orbit.target[2];
  app.camera.distance = orbit.orbit.distance;
  app.camera.yaw = orbit.orbit.yaw;
  app.camera.pitch = orbit.orbit.pitch;
}

function getPanUnit(size = viewerSize) {
  const maxSize = Math.max(1.0e-6, Number(size?.max) || 10.0);
  return maxSize * 0.05;
}

function normalizeVec3(vec) {
  const x = Number(vec?.[0] ?? 0.0);
  const y = Number(vec?.[1] ?? 0.0);
  const z = Number(vec?.[2] ?? 0.0);
  const length = Math.hypot(x, y, z) || 1.0;
  return [x / length, y / length, z / length];
}

function getOrbitScreenBasis() {
  const eyeMatrix = app.eye.getWorldMatrix();
  return {
    right: normalizeVec3(eyeMatrix.mul3x3Vector([1.0, 0.0, 0.0])),
    up: normalizeVec3(eyeMatrix.mul3x3Vector([0.0, 1.0, 0.0]))
  };
}

function panOrbitByScreenStep(stepX = 0.0, stepY = 0.0) {
  if (!orbit?.orbit) {
    return;
  }
  const unit = getPanUnit();
  const { right, up } = getOrbitScreenBasis();
  const delta = [
    right[0] * stepX * unit + up[0] * stepY * unit,
    right[1] * stepX * unit + up[1] * stepY * unit,
    right[2] * stepX * unit + up[2] * stepY * unit
  ];
  orbit.setTarget(
    orbit.orbit.target[0] + delta[0],
    orbit.orbit.target[1] + delta[1],
    orbit.orbit.target[2] + delta[2]
  );
  syncOrbitStateToAppCamera();
}

function stepOrbitByButtons({ yaw = 0.0, pitch = 0.0, zoom = 1.0 } = {}) {
  if (!orbit?.orbit) {
    return;
  }
  const nextPitch = orbit.clamp(
    orbit.orbit.pitch + pitch,
    orbit.orbit.pitchMin,
    orbit.orbit.pitchMax
  );
  const nextDistance = orbit.clamp(
    orbit.orbit.distance * zoom,
    orbit.orbit.minDistance,
    orbit.orbit.maxDistance
  );
  orbit.setAngles(orbit.orbit.yaw + yaw, nextPitch);
  orbit.setDistance(nextDistance);
  syncOrbitStateToAppCamera();
}

function takeViewerScreenshot() {
  const file = app.takeScreenshot({
    prefix: "collada_view"
  });
  screenshotName = file;
  app.pushToast(`saved ${file}`, {
    durationMs: 1400
  });
}

function applyWireframeState() {
  const shapes = runtime?.shapes ?? [];
  for (let i = 0; i < shapes.length; i++) {
    shapes[i]?.setWireframe?.(wireframe);
  }
}

function toggleWireframe() {
  wireframe = !wireframe;
  applyWireframeState();
  app.pushToast(wireframe ? "wireframe on" : "wireframe off", {
    durationMs: 900
  });
}

function configureOrbitFromShapes(shapeList) {
  // 読み込む DAE の大きさが変わっても、bbox の最大辺を基準に
  // 距離を決めれば最初から全体を確認しやすい
  const size = app.getShapeSize(shapeList);
  viewerSize = { ...size };
  orbitLift = Math.max(0.4, size.max * 0.08);
  orbitLiftStep = Math.max(0.2, size.max * 0.04);
  const target = [size.centerx, size.centery + orbitLift, size.centerz];
  const distance = Math.max(1.5, size.max * 1.8);

  orbit.orbit.minDistance = Math.max(0.5, size.max * 0.25);
  orbit.orbit.maxDistance = Math.max(8.0, size.max * 8.0);
  orbit.orbit.wheelZoomStep = Math.max(0.2, size.max * 0.04);
  orbit.setTarget(...target);
  orbit.setAngles(20.0, -10.0);
  orbit.setDistance(distance);
  syncOrbitStateToAppCamera();
}

function moveCameraLift(step) {
  orbitLift += step;
  orbit.setTarget(
    orbit.orbit.target[0],
    orbit.orbit.target[1] + step,
    orbit.orbit.target[2]
  );
  syncOrbitStateToAppCamera();
}

function countTriangles(shapeList) {
  let total = 0;
  for (let i = 0; i < shapeList.length; i++) {
    total += shapeList[i].getTriangleCount();
  }
  return total;
}

function formatClipNameList(names, maxCount = 3) {
  if (!Array.isArray(names) || names.length === 0) return "-";
  if (names.length <= maxCount) return names.join(", ");
  return `${names.slice(0, maxCount).join(", ")} ... +${names.length - maxCount}`;
}

function applyExplicitTextureFlagsToRuntimeShapes(runtime) {
  const shapes = runtime?.shapes ?? [];
  for (let i = 0; i < shapes.length; i++) {
    const shape = shapes[i];
    if (!shape?.updateMaterial) continue;
    const material = shape.getMaterial?.() ?? { params: shape.materialParams ?? {} };
    const params = material?.params ?? {};
    const hasTexture = !!(params.texture ?? shape.texture);
    // Collada 由来 mesh は material ごとに texture 有無が分かれることがあるため、
    // sample 側で use_texture を明示し、SmoothShader の draw 条件を mesh ごとに固定する
    shape.updateMaterial({
      use_texture: hasTexture ? 1 : 0
    });
  }
}

function buildPrimaryClipLines() {
  if (!clipInfo) {
    return ["clip0=-"];
  }
  return [
    `clip0=${clipInfo.id}`,
    `tracks=${clipInfo.trackCount} keys=${clipInfo.keyCount} duration=${clipInfo.durationMs}ms`,
    `skeleton=${clipInfo.targetSkeleton ?? "-"}`
  ];
}

function updateHudRows() {
  const selectedState = getSelectedClipState();
  app.setHudRows([
    { line: "collada loader" },
    {
      label: "File",
      value: COLLADA_FILE.replace(/^.*\//, ""),
      note: `tris=${totalTriangles} clips=${clipNames.length}`
    },
    {
      label: "Model",
      value: `nodes=${runtime?.nodes?.length ?? 0} shapes=${runtime?.shapes?.length ?? 0}`,
      note: `anim=${runtime?.getAnimationNames?.().length ?? 0}`
    },
    {
      label: "Orbit",
      value: `yaw=${orbit.orbit.yaw.toFixed(1)} pitch=${orbit.orbit.pitch.toFixed(1)}`,
      note: `dist=${orbit.orbit.distance.toFixed(1)}`
    },
    {
      label: "Target",
      value: `${orbit.orbit.target[0].toFixed(2)}, ${orbit.orbit.target[1].toFixed(2)}, ${orbit.orbit.target[2].toFixed(2)}`,
      note: `panStep=${getPanUnit().toFixed(3)}`
    },
    {
      label: "Anim",
      value: selectedState.label,
      note: paused ? "global pause=on" : "global pause=off"
    },
    {
      label: "Clip0",
      value: clipInfo?.id ?? "-",
      note: clipBound ? "bound=yes" : "bound=no"
    },
    {
      label: "Wire",
      value: wireframe ? "on" : "off",
      note: `shot=${screenshotName || "-"}`
    },
    {
      line: "Drag/Arrow orbit  Shift+Drag/Arrow pan  [/] zoom  Space pause  W wire  S shot  D json  R reset"
    }
  ], {
    anchor: "top-left",
    x: 0,
    y: 0,
    color: [0.92, 0.96, 1.0],
    minScale: 0.82
  });
}

function getPrimaryClipId() {
  return clipNames.length > 0 ? clipNames[0] : null;
}

function getPrimaryClipInfo() {
  const clipId = getPrimaryClipId();
  return clipId ? modelAsset.getClipInfo(clipId) : null;
}

function getSelectedClipState() {
  // 先頭 clip の runtime Animation 状態を HUD 用に整形する
  const clipId = getPrimaryClipId();
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

function replaySelectedClip() {
  // 先頭 clip を先頭姿勢から再始動する
  const clipId = getPrimaryClipId();
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
  // 先頭 clip だけを個別 pause helper で停止する
  const clipId = getPrimaryClipId();
  if (!runtime || !clipId) {
    return false;
  }
  const animation = runtime.pauseAnimation(clipId);
  return animation !== null;
}

function resumeSelectedClip() {
  // 先頭 clip だけを個別 resume helper で再開する
  const clipId = getPrimaryClipId();
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
    clearColor: [0.10, 0.15, 0.10, 1.0],
    lightPosition: [0.0, 100.0, 1000.0, 1.0],
    viewAngle: 53.0,
    messageFontTexture: "../../webg/font512.png",
    camera: {
      target: [...DEFAULT_ORBIT.target],
      distance: DEFAULT_ORBIT.distance,
      yaw: DEFAULT_ORBIT.yaw,
      pitch: DEFAULT_ORBIT.pitch
    },
    debugTools: {
      mode: DEBUG_MODE,
      system: "collada_loader",
      source: COLLADA_FILE,
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
  app.createHelpPanel({
    id: "colladaLoaderHelp",
    lines: [...GUIDE_LINES, ...app.getDebugKeyGuideLines()]
  });

  orbit = app.createOrbitEyeRig({
    target: [...DEFAULT_ORBIT.target],
    distance: DEFAULT_ORBIT.distance,
    yaw: DEFAULT_ORBIT.yaw,
    pitch: DEFAULT_ORBIT.pitch
  });

  // Collada も glTF / JSON と同じ facade から読み込み、parse 差分は
  // ModelLoader 側へ閉じ込める
  model = await app.loadModel(COLLADA_FILE, {
    format: "collada",
    instantiate: true,
    startAnimations: true,
    onStage: (stage) => app.setDiagnosticsStage(stage),
    collada: {
      boneEnable: true,
      texSelect: 0
    }
  });
  modelAsset = model.asset;
  runtime = model.runtime;
  applyExplicitTextureFlagsToRuntimeShapes(runtime);
  clipNames = model.getClipNames();
  clipInfo = getPrimaryClipInfo();
  app.mergeDiagnosticsStats({ clipCount: clipNames.length });
  clipBound = !!getPrimaryClipId() && runtime.getAnimation(getPrimaryClipId()) !== null;
  totalTriangles = countTriangles(runtime.shapes);
  configureOrbitFromShapes(runtime.shapes);
  applyWireframeState();
  refreshDiagnosticsStats();
  app.configureDiagnosticsCapture({
    labelPrefix: "collada_loader",
    collect: () => makeProbeReport(app.screen.getFrameCount())
  });
  app.configureDebugKeyInput();

  app.attachInput({
    onKeyDown: async (key, ev) => {
      if (ev.repeat) return;
      if (key === "space") {
        paused = !paused;
        runtime.setAnimationsPaused(paused);
      } else if (key === "1") {
        replaySelectedClip();
      } else if (key === "2") {
        pauseSelectedClip();
      } else if (key === "3") {
        resumeSelectedClip();
      } else if (key === "d") {
        model.downloadJSON(DOWNLOAD_FILE);
      } else if (key === "w") {
        toggleWireframe();
      } else if (key === "s") {
        takeViewerScreenshot();
      } else if (key === "r") {
        configureOrbitFromShapes(runtime.shapes);
      }
    }
  });

  app.start({
    onUpdate: ({ deltaSec }) => {
      orbit.update(deltaSec);
      syncOrbitStateToAppCamera();

      if (!paused) {
        runtime.playAllAnimations();
      }

      refreshDiagnosticsStats();
      app.updateDebugProbe();
      updateHudRows();
      app.setControlRows([]);
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  start().catch((err) => {
    app?.setDiagnosticsReport(Diagnostics.createErrorReport(err, {
      system: "collada_loader",
      source: COLLADA_FILE,
      stage: app?.getDiagnosticsReport?.()?.stage ?? "start"
    }));
    if (app?.isConsoleEnabled?.()) {
      console.error("collada_loader failed:", err);
    }
    app?.showErrorPanel?.(err, {
      title: "collada_loader failed",
      id: "start-error",
      background: "rgba(42, 52, 28, 0.92)"
    });
  });
});
