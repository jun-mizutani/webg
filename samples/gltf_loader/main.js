// -------------------------------------------------
// gltf_loader sample
//   main.js       2026/04/20
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// -------------------------------------------------

import WebgApp from "../../webg/WebgApp.js";
import SmoothShader from "../../webg/SmoothShader.js";
import Matrix from "../../webg/Matrix.js";
import Diagnostics from "../../webg/Diagnostics.js";
import util from "../../webg/util.js";

// Blender から glTF を書き出す場合は、Y-up で出力したファイルを前提とする
const GLTF_FILE = "./hand.glb";
const DOWNLOAD_FILE = "gltf_modelasset.json";
const DEBUG_MODE = "debug";
const INTERPOLATION_NOTICE_ID = "gltf-interpolation-notice";
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
let loadStartedAtMs = 0;
let orbitLift = 0.0;
let orbitLiftStep = 0.5;
let interpolationSummary = null;
let viewerSize = {
  centerx: 0.0,
  centery: 0.0,
  centerz: 0.0,
  max: 10.0
};
let screenshotName = "";
let wireframe = false;

function isBoneAnalysisStage(stage) {
  return stage.startsWith("rigify-bones ") || stage.startsWith("skin-bones ");
}

function updateLoadStage(stage) {
  const elapsedMs = Math.round(performance.now() - loadStartedAtMs);
  if (isBoneAnalysisStage(stage)) {
    app.mergeDiagnosticsStats({
      loadElapsedMs: elapsedMs,
      skinAnalysis: stage
    });
    if (app.isConsoleEnabled()) {
      console.log(`gltf_loader ${stage} elapsedMs=${elapsedMs} file=${GLTF_FILE}`);
    }
    return;
  }
  app.setDiagnosticsStage(stage);
  app.mergeDiagnosticsStats({
    loadStage: stage,
    loadElapsedMs: elapsedMs
  });
  app.showFixedFormatPanel([
    "gltf_loader loading",
    `file=${GLTF_FILE}`,
    `stage=${stage}`,
    `elapsedMs=${elapsedMs}`
  ].join("\n"), {
    id: "load-progress",
    left: 12,
    top: 12,
    maxHeight: "none",
    color: "#fff3d6",
    background: "rgba(24, 36, 22, 0.92)"
  });
}

function refreshDiagnosticsStats() {
  app.mergeDiagnosticsStats({
    clipCount: clipNames.length,
    shapeCount: runtime?.shapes?.length ?? 0,
    nodeCount: runtime?.nodes?.length ?? 0,
    runtimeAnimations: runtime?.getAnimationNames?.().length ?? 0,
    triangleCount: totalTriangles,
    paused: paused ? "yes" : "no",
    primaryBound: clipBound ? "yes" : "no",
    animationInterpolation: interpolationSummary?.runtimeLabel ?? "LINEAR",
    animationInterpolationRaw: interpolationSummary?.rawLabel ?? "LINEAR:0",
    animationInterpolationConversion: interpolationSummary?.conversionLabel ?? "none"
  });
}

function makeProbeReport(frameCount) {
  const selectedState = getPrimaryClipState();
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
    primaryBound: clipBound ? "yes" : "no",
    animationInterpolation: interpolationSummary?.runtimeLabel ?? "LINEAR",
    animationInterpolationRaw: interpolationSummary?.rawLabel ?? "LINEAR:0",
    animationInterpolationConversion: interpolationSummary?.conversionLabel ?? "none"
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

function makeScreenshotName() {
  const base = GLTF_FILE.replace(/^.*\//, "").replace(/\.[^.]+$/, "") || "gltf_loader";
  return `${base}_view`;
}

function takeViewerScreenshot() {
  const file = app.takeScreenshot({
    prefix: makeScreenshotName()
  });
  screenshotName = file;
  app.pushToast(`saved ${file}`, {
    durationMs: 1400
  });
}

function getViewerShapes() {
  return runtime?.shapes ?? [];
}

function applyWireframeState() {
  const shapes = getViewerShapes();
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

function getPrimaryClipId() {
  return clipNames.length > 0 ? clipNames[0] : null;
}

function getPrimaryClipInfo() {
  const clipId = getPrimaryClipId();
  return clipId ? modelAsset.getClipInfo(clipId) : null;
}

function applyExplicitTextureFlagsToRuntimeShapes(runtime) {
  const shapes = runtime?.shapes ?? [];
  for (let i = 0; i < shapes.length; i++) {
    const shape = shapes[i];
    if (!shape?.updateMaterial) continue;
    const material = shape.getMaterial?.() ?? { params: shape.materialParams ?? {} };
    const params = material?.params ?? {};
    const hasTexture = !!(params.texture ?? shape.texture);
    // SmoothShader を共通 shader として使う sample では、
    // texture を持たない mesh も use_texture を明示しておかないと
    // 直前の textured mesh の条件が残って bind 条件が shape 順序依存になりやすい
    shape.updateMaterial({
      use_texture: hasTexture ? 1 : 0
    });
  }
}

function summarizeAnimationInterpolation(importer) {
  // raw glTF の sampler interpolation を見て、
  // 現在の loader で LINEAR に変換した補間種別があるかを集約する
  const animations = importer?.data?.animations ?? [];
  const counts = new Map();
  const affectedClips = new Set();

  for (let animationIndex = 0; animationIndex < animations.length; animationIndex++) {
    const animation = animations[animationIndex] ?? {};
    const clipName = animation.name ?? `anim_${animationIndex}`;
    for (const sampler of animation.samplers ?? []) {
      const mode = String(sampler?.interpolation ?? "LINEAR").toUpperCase();
      counts.set(mode, (counts.get(mode) ?? 0) + 1);
      if (mode !== "LINEAR") {
        affectedClips.add(clipName);
      }
    }
  }

  const summaryLabel = [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([mode, count]) => `${mode}:${count}`)
    .join(" ");
  const cubicSplineCount = counts.get("CUBICSPLINE") ?? 0;

  return {
    counts,
    rawLabel: summaryLabel || "LINEAR:0",
    runtimeLabel: "LINEAR",
    conversionLabel: cubicSplineCount > 0 ? `CUBICSPLINE->LINEAR:${cubicSplineCount}` : "none",
    hasCubicSpline: cubicSplineCount > 0,
    cubicSplineCount,
    affectedClips: [...affectedClips].sort((a, b) => a.localeCompare(b))
  };
}

function formatInterpolationNoticeLines(summary) {
  if (!summary?.hasCubicSpline) {
    return [];
  }
  const clipList = summary.affectedClips.length > 0
    ? summary.affectedClips.join(", ")
    : "-";
  return [
    "animation interpolation = CUBICSPLINE -> LINEAR conversion",
    "middle values are extracted and used as LINEAR keys",
    `affected clips = ${clipList}`
  ];
}

function syncInterpolationNoticePanel() {
  if (!interpolationSummary?.hasCubicSpline) {
    app.clearFixedFormatPanel(INTERPOLATION_NOTICE_ID);
    return;
  }
  app.showFixedFormatPanel(formatInterpolationNoticeLines(interpolationSummary).join("\n"), {
    id: INTERPOLATION_NOTICE_ID,
    left: 12,
    top: 12,
    maxHeight: "none",
    color: "#fff0cc",
    background: "rgba(38, 56, 24, 0.92)"
  });
}

function getPrimaryClipState() {
  const clipId = getPrimaryClipId();
  const animation = clipId ? runtime?.getAnimation(clipId) : null;
  if (!animation) {
    return { label: "MISSING", paused: false, stopped: true };
  }
  const pausedState = animation.schedule.pause === true;
  const stoppedState = animation.schedule.stopped === true;
  let label = "PLAYING";
  if (stoppedState) {
    label = "STOPPED";
  } else if (pausedState) {
    label = "PAUSED";
  }
  return { label, paused: pausedState, stopped: stoppedState };
}

function replayPrimaryClip() {
  const clipId = getPrimaryClipId();
  if (!runtime || !clipId) return false;
  const animation = runtime.restartAnimation(clipId);
  if (!animation) return false;
  paused = false;
  runtime.setAnimationsPaused(false);
  return true;
}

function pausePrimaryClip() {
  const clipId = getPrimaryClipId();
  if (!runtime || !clipId) return false;
  return runtime.pauseAnimation(clipId) !== null;
}

function resumePrimaryClip() {
  const clipId = getPrimaryClipId();
  if (!runtime || !clipId) return false;
  return runtime.resumeAnimation(clipId) !== null;
}

function getWorldShapeSize(built) {
  // glTF は親ノード側の transform が mesh の見える位置に効くため、
  // node 階層を含んだ world bbox を使って framing を決める
  const size = {
    minx: 1.0e10, maxx: -1.0e10,
    miny: 1.0e10, maxy: -1.0e10,
    minz: 1.0e10, maxz: -1.0e10,
    centerx: 0.0, sizex: 0.0,
    centery: 0.0, sizey: 0.0,
    centerz: 0.0, sizez: 0.0,
    max: 0.0
  };
  const worldMap = new Map();

  const buildWorld = (nodeInfo) => {
    if (!nodeInfo) return new Matrix();
    if (worldMap.has(nodeInfo.id)) {
      return worldMap.get(nodeInfo.id);
    }
    const local = nodeInfo.localMatrix?.clone?.() ?? new Matrix();
    if (!nodeInfo.parent) {
      worldMap.set(nodeInfo.id, local);
      return local;
    }
    const parentInfo = built.nodeMap.get(nodeInfo.parent);
    const world = local.clone();
    world.lmul(buildWorld(parentInfo));
    worldMap.set(nodeInfo.id, world);
    return world;
  };

  for (let i = 0; i < built.nodes.length; i++) {
    const nodeInfo = built.nodes[i];
    const shape = nodeInfo.shape;
    const box = shape?.getBoundingBox?.();
    if (!shape || !box) continue;
    const world = buildWorld(nodeInfo);
    const corners = [
      [box.minx, box.miny, box.minz],
      [box.minx, box.miny, box.maxz],
      [box.minx, box.maxy, box.minz],
      [box.minx, box.maxy, box.maxz],
      [box.maxx, box.miny, box.minz],
      [box.maxx, box.miny, box.maxz],
      [box.maxx, box.maxy, box.minz],
      [box.maxx, box.maxy, box.maxz]
    ];

    for (let j = 0; j < corners.length; j++) {
      const p = world.mulVector(corners[j]);
      if (size.minx > p[0]) size.minx = p[0];
      if (size.maxx < p[0]) size.maxx = p[0];
      if (size.miny > p[1]) size.miny = p[1];
      if (size.maxy < p[1]) size.maxy = p[1];
      if (size.minz > p[2]) size.minz = p[2];
      if (size.maxz < p[2]) size.maxz = p[2];
    }
  }

  if (size.minx > size.maxx) {
    return app.getShapeSize(built.shapes);
  }

  size.centerx = (size.maxx + size.minx) * 0.5;
  size.sizex = size.maxx - size.minx;
  size.centery = (size.maxy + size.miny) * 0.5;
  size.sizey = size.maxy - size.miny;
  size.centerz = (size.maxz + size.minz) * 0.5;
  size.sizez = size.maxz - size.minz;
  size.max = Math.max(size.sizex, size.sizey, size.sizez);
  return size;
}

function configureOrbitFromBuilt(built) {
  // 親ノード込み world bbox から、glTF 確認向けの距離を決める
  const size = getWorldShapeSize(built);
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
  // 読み込んだモデルの bbox 中心から少しだけ target を上下させ、
  // 手や腕のように重心が下寄りなモデルでも見せたい部分へ寄せやすくする
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
  const selectedState = getPrimaryClipState();
  app.setHudRows([
    { line: "gltf loader" },
    {
      label: "File",
      value: GLTF_FILE.replace(/^.*\//, ""),
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
      label: "Interp",
      value: interpolationSummary?.runtimeLabel ?? "LINEAR",
      note: interpolationSummary?.conversionLabel ?? "none"
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
      system: "gltf_loader",
      source: GLTF_FILE,
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
    id: "gltfLoaderHelp",
    lines: [...GUIDE_LINES, ...app.getDebugKeyGuideLines()]
  });

  orbit = app.createOrbitEyeRig({
    target: [...DEFAULT_ORBIT.target],
    distance: DEFAULT_ORBIT.distance,
    head: DEFAULT_ORBIT.yaw,
    pitch: DEFAULT_ORBIT.pitch
  });
  loadStartedAtMs = performance.now();
  updateLoadStage("fetch");

  // glTF loader facade により、sample 側では importer 差分を意識せず
  // source path と build 方針だけを渡せば ModelAsset / runtime を得られる
  model = await app.loadModel(GLTF_FILE, {
    format: "gltf",
    instantiate: true,
    startAnimations: true,
    onStage: (stage) => updateLoadStage(stage),
    gltf: {
      includeSkins: true
    }
  });
  app.clearFixedFormatPanel("load-progress");
  modelAsset = model.asset;
  runtime = model.runtime;
  applyExplicitTextureFlagsToRuntimeShapes(runtime);
  interpolationSummary = summarizeAnimationInterpolation(model.importer);
  clipNames = model.getClipNames();
  clipInfo = getPrimaryClipInfo();
  app.mergeDiagnosticsStats({
    clipCount: clipNames.length,
    loadStage: "runtime",
    loadElapsedMs: Math.round(performance.now() - loadStartedAtMs)
  });
  clipBound = !!getPrimaryClipId() && runtime.getAnimation(getPrimaryClipId()) !== null;
  if (runtime.shapes.length === 0) {
    util.printf("No mesh in glTF.\n");
    app.addDiagnosticsWarning("No mesh in glTF");
    return;
  }

  if (interpolationSummary.hasCubicSpline) {
    const affectedClipText = interpolationSummary.affectedClips.length > 0
      ? interpolationSummary.affectedClips.join(", ")
      : "-";
    const noticeText = `CUBICSPLINE animation converted to LINEAR in ${affectedClipText}`;
    app.addDiagnosticsWarning(noticeText);
    app.mergeDiagnosticsStats({
      animationInterpolationNoticeText: noticeText
    });
    syncInterpolationNoticePanel();
  } else {
    syncInterpolationNoticePanel();
  }

  totalTriangles = countTriangles(runtime.shapes);
  configureOrbitFromBuilt(runtime);
  applyWireframeState();
  refreshDiagnosticsStats();
  app.configureDiagnosticsCapture({
    labelPrefix: "gltf_loader",
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
        replayPrimaryClip();
      } else if (key === "2") {
        pausePrimaryClip();
      } else if (key === "3") {
        resumePrimaryClip();
      } else if (key === "d") {
        model.downloadJSON(DOWNLOAD_FILE);
      } else if (key === "w") {
        toggleWireframe();
      } else if (key === "s") {
        takeViewerScreenshot();
      } else if (key === "r") {
        configureOrbitFromBuilt(runtime);
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
    app?.clearFixedFormatPanel?.("load-progress");
    app?.setDiagnosticsReport(Diagnostics.createErrorReport(err, {
      system: "gltf_loader",
      source: GLTF_FILE,
      stage: app?.getDiagnosticsReport?.()?.stage ?? "start"
    }));
    if (app?.isConsoleEnabled?.()) {
      console.error("gltf_loader failed:", err);
    }
    app?.showErrorPanel?.(err, {
      title: "gltf_loader failed",
      id: "start-error",
      background: "rgba(34, 50, 28, 0.92)"
    });
  });
});
