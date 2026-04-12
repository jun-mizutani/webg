// -------------------------------------------------
// model_viewer template
//   main.js       2026/04/10
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license
// -------------------------------------------------

import WebgApp from "../../webg/WebgApp.js";
import EyeRig from "../../webg/EyeRig.js";
import SmoothShader from "../../webg/SmoothShader.js";
import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";
import Diagnostics from "../../webg/Diagnostics.js";
import DebugConfig from "../../webg/DebugConfig.js";

// このテンプレートの役割:
// - orbit viewer を現行 sample と同じ UI / diagnostics 付きで始める
// - `MODEL_SOURCE` を設定すれば `app.loadModel()` の loader 経路へ入り、
//   空文字のままなら placeholder shape で即起動できるようにする

const MODEL_SOURCE = "";
const MODEL_FORMAT = "gltf";
const DOWNLOAD_FILE = "model_viewer_modelasset.json";
const DIAG_TEXT_FILE = "model_viewer_diagnostics.txt";
const DIAG_JSON_FILE = "model_viewer_diagnostics.json";
const HUD_ROW_OPTIONS = {
  anchor: "top-left",
  x: 0,
  y: 0,
  color: [0.90, 0.95, 1.0],
  minScale: 0.80
};
const DEFAULT_ORBIT = {
  yaw: 28.0,
  pitch: -12.0,
  distance: 26.0,
  target: [0.0, 0.0, 0.0]
};

let app = null;
let orbit = null;

document.addEventListener("DOMContentLoaded", () => {
  start().catch((err) => {
    app?.setDiagnosticsReport?.(Diagnostics.createErrorReport(err, {
      system: "template-model-viewer",
      source: "templates/model_viewer/main.js",
      stage: app?.getDiagnosticsReport?.()?.stage ?? "start"
    }));
    console.error("model_viewer template failed:", err);
    app?.showErrorPanel?.(err, {
      title: "model_viewer template failed",
      id: "start-error",
      background: "rgba(28, 18, 20, 0.92)"
    });
  });
});

const configureOrbit = (size) => {
  // shape 群の bbox から target / distance を決める
  // loader sample ほど厳密でなくても、template として十分使える framing を返す
  const target = [size.centerx, size.centery, size.centerz];
  const distance = Math.max(8.0, size.max * 2.1);
  orbit.orbit.minDistance = Math.max(2.0, size.max * 0.25);
  orbit.orbit.maxDistance = Math.max(12.0, size.max * 10.0);
  orbit.orbit.wheelZoomStep = Math.max(0.3, size.max * 0.05);
  orbit.setTarget(...target);
  orbit.setAngles(DEFAULT_ORBIT.yaw, DEFAULT_ORBIT.pitch);
  orbit.setDistance(distance);
};

const createPlaceholder = (gpu, shader) => {
  // asset が未指定でも template 自体はすぐ起動できるように、
  // skinning 対応 shader でも static mesh をそのまま描ける placeholder を用意する
  const shape = new Shape(gpu);
  shape.applyPrimitiveAsset(Primitive.mapCube(10.0));
  shape.endShape();
  shape.setShader(shader);
  shape.setMaterial("smooth-shader", {
    has_bone: 0,
    color: [0.90, 0.82, 0.70, 1.0],
    ambient: 0.26,
    specular: 0.92,
    power: 48.0,
    emissive: 0.0,
    weight_debug: 0
  });
  const node = app.space.addNode(null, "previewModel");
  node.addShape(shape);
  return { node, shape, shapes: [shape], runtime: null, modelResult: null };
};

const makeControlRows = (state, envReport, frameCount) => {
  const rows = [
    { line: "model_viewer template" },
    {
      label: "Source",
      value: state.modelSourceLabel,
      note: MODEL_SOURCE ? MODEL_FORMAT : "placeholder fallback"
    },
    {
      label: "Orbit",
      value: `yaw=${orbit.orbit.yaw.toFixed(1)} pitch=${orbit.orbit.pitch.toFixed(1)} dist=${orbit.orbit.distance.toFixed(1)}`,
      note: "drag / Arrow / wheel"
    },
    {
      label: "Pause",
      value: state.paused ? "ON" : "OFF",
      toggleKey: "Space"
    },
    {
      label: "Triangles",
      value: String(state.triangleCount),
      note: `clips=${state.clipCount}`
    },
    {
      label: "Download",
      value: state.canDownload ? DOWNLOAD_FILE : "disabled",
      note: "[D] export ModelAsset JSON"
    },
    {
      label: "Env",
      value: envReport.ok ? "OK" : "WARN",
      note: envReport.warnings?.[0] ?? ""
    },
    { label: "Frame", value: String(frameCount) },
    {
      label: "Debug",
      value: DebugConfig.mode,
      keys: [{ key: "F9" }, { key: "M", action: "mode" }]
    },
    {
      label: "Overlay",
      value: app.debugOverlay?.enabled ? "ON" : "OFF",
      keys: [{ key: "F9" }, { key: "H", action: "overlay" }]
    },
    { line: app.getDiagnosticsStatusLine() }
  ];
  const probeLine = app.getProbeStatusLine();
  if (probeLine) rows.push({ line: probeLine });
  return rows;
};

const start = async () => {
  app = new WebgApp({
    document,
    shaderClass: SmoothShader,
    clearColor: [0.06, 0.08, 0.11, 1.0],
    lightPosition: [180.0, 220.0, 260.0, 1.0],
    viewAngle: 50.0,
    messageFontTexture: "../../webg/font512.png",
    debugOverlay: {
      title: "model viewer",
      y: 12
    },
    debugTools: {
      mode: "debug",
      system: "template-model-viewer",
      source: "templates/model_viewer/main.js",
      probeDefaultAfterFrames: 1
    },
    camera: {
      target: [...DEFAULT_ORBIT.target],
      distance: DEFAULT_ORBIT.distance,
      yaw: DEFAULT_ORBIT.yaw,
      pitch: DEFAULT_ORBIT.pitch
    }
  });
  await app.init();

  orbit = new EyeRig(app.cameraRig, app.cameraRod, app.eye, {
    document,
    element: app.screen.canvas,
    input: app.input,
    type: "orbit",
    orbit: {
      target: [...DEFAULT_ORBIT.target],
      distance: DEFAULT_ORBIT.distance,
      yaw: DEFAULT_ORBIT.yaw,
      pitch: DEFAULT_ORBIT.pitch,
      minDistance: 10.0,
      maxDistance: 80.0,
      wheelZoomStep: 1.5
    }
  });
  orbit.attachPointer();

  const state = {
    paused: false,
    usingPlaceholder: !MODEL_SOURCE,
    modelSourceLabel: MODEL_SOURCE || "(placeholder)",
    triangleCount: 0,
    clipCount: 0,
    canDownload: false
  };

  let display = null;

  app.setDiagnosticsStage("build-model");
  if (MODEL_SOURCE) {
    const modelResult = await app.loadModel(MODEL_SOURCE, {
      format: MODEL_FORMAT,
      instantiate: true,
      startAnimations: true
    });
    display = {
      node: null,
      shape: null,
      shapes: modelResult.runtime.shapes,
      runtime: modelResult.runtime,
      modelResult
    };
    state.clipCount = modelResult.getClipNames().length;
    state.canDownload = true;
  } else {
    display = createPlaceholder(app.getGL(), app.shader);
  }

  const viewerShapes = display.shapes;
  state.triangleCount = viewerShapes.reduce((sum, shape) => sum + shape.getTriangleCount(), 0);
  const size = app.getShapeSize(viewerShapes);
  configureOrbit(size);

  const refreshDiagnosticsStats = (frameCount) => {
    const envReport = app.checkEnvironment({
      stage: "runtime-check",
      shapes: viewerShapes
    });
    app.mergeDiagnosticsStats({
      frameCount,
      source: MODEL_SOURCE || "placeholder",
      triangleCount: state.triangleCount,
      clipCount: state.clipCount,
      paused: state.paused ? "yes" : "no",
      usingPlaceholder: state.usingPlaceholder ? "yes" : "no",
      envOk: envReport.ok ? "yes" : "no",
      envWarning: envReport.warnings?.[0] ?? "-"
    });
    return envReport;
  };

  const makeProbeReport = (frameCount) => {
    const envReport = app.checkEnvironment({
      stage: "runtime-probe",
      shapes: viewerShapes
    });
    const report = app.createProbeReport("runtime-probe");
    Diagnostics.addDetail(report, `source=${MODEL_SOURCE || "placeholder"}`);
    Diagnostics.addDetail(report, `triangles=${state.triangleCount}`);
    Diagnostics.addDetail(report, `clips=${state.clipCount}`);
    Diagnostics.addDetail(report, `paused=${state.paused ? "on" : "off"}`);
    if (envReport.warnings?.length) {
      Diagnostics.addDetail(report, `envWarning=${envReport.warnings[0]}`);
    }
    Diagnostics.mergeStats(report, {
      frameCount,
      triangleCount: state.triangleCount,
      clipCount: state.clipCount,
      usingPlaceholder: state.usingPlaceholder ? "yes" : "no",
      envOk: envReport.ok ? "yes" : "no"
    });
    return report;
  };

  const requestProbe = (format = "text", afterFrames = 1) => {
    app.requestProbe({
      label: `model_viewer_${format}_probe`,
      format,
      afterFrames,
      collect: () => makeProbeReport(app.screen.getFrameCount()),
      onReady: async (result) => {
        if (format === "json") {
          const copied = await Diagnostics.copyJSON(result.payload);
          app.diagnosticsCopyState = copied ? "PROBE JSON COPIED" : "PROBE JSON READY";
        } else {
          const copied = await Diagnostics.copyText(result.payload);
          app.diagnosticsCopyState = copied ? "PROBE TEXT COPIED" : "PROBE TEXT READY";
        }
      }
    });
  };

  app.configureDebugKeyInput({
    files: { text: DIAG_TEXT_FILE, json: DIAG_JSON_FILE },
    onProbeText: () => requestProbe("text", 1),
    onProbeJson: () => requestProbe("json", 1)
  });

  app.attachInput({
    onKeyDown: (key, ev) => {
      if (ev.repeat) return;
      if (key === " ") {
        state.paused = !state.paused;
        if (display.runtime) {
          display.runtime.setAnimationsPaused(state.paused);
        }
        return;
      }
      if (key === "r") {
        orbit.setTarget(...DEFAULT_ORBIT.target);
        orbit.setAngles(DEFAULT_ORBIT.yaw, DEFAULT_ORBIT.pitch);
        orbit.setDistance(DEFAULT_ORBIT.distance);
        configureOrbit(size);
        return;
      }
      if (key === "d" && display.modelResult) {
        display.modelResult.downloadJSON(DOWNLOAD_FILE);
      }
    }
  });

  app.setDiagnosticsStage("runtime");
  app.start({
    onUpdate: ({ deltaSec, screen }) => {
      orbit.update(deltaSec);

      if (display.runtime) {
        if (!state.paused) {
          display.runtime.playAllAnimations();
        }
      } else if (!state.paused && display.node) {
        display.node.rotateY(12.0 * deltaSec);
      }

      const envReport = refreshDiagnosticsStats(screen.getFrameCount());
      app.setControlRows(makeControlRows(state, envReport, screen.getFrameCount()), HUD_ROW_OPTIONS);
      app.updateDebugProbe();
    }
  });
};
