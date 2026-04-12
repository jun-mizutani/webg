// -------------------------------------------------
// basic template
//   main.js       2026/04/10
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license
// -------------------------------------------------

import WebgApp from "../../webg/WebgApp.js";
import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";
import Diagnostics from "../../webg/Diagnostics.js";
import DebugConfig from "../../webg/DebugConfig.js";

// このテンプレートの役割:
// - `WebgApp` を使う最小 app を、現行 sample と同じ controls row / diagnostics 流儀で始める
// - 1 つの shape を回すだけの最小構成でも、
//   debug dock、probe、debug/release 切替を最初から使える形にする

const DIAG_TEXT_FILE = "basic_diagnostics.txt";
const DIAG_JSON_FILE = "basic_diagnostics.json";
const HUD_ROW_OPTIONS = {
  anchor: "top-left",
  x: 0,
  y: 0,
  color: [0.90, 0.95, 1.0],
  minScale: 0.82
};

let app = null;

document.addEventListener("DOMContentLoaded", () => {
  start().catch((err) => {
    app?.setDiagnosticsReport?.(Diagnostics.createErrorReport(err, {
      system: "template-basic",
      source: "templates/basic/main.js",
      stage: app?.getDiagnosticsReport?.()?.stage ?? "start"
    }));
    console.error("basic template failed:", err);
    app?.showErrorPanel?.(err, {
      title: "basic template failed",
      id: "start-error",
      background: "rgba(28, 18, 20, 0.92)"
    });
  });
});

const makeControlRows = (state, frameCount, envReport) => {
  const rows = [
    { line: "basic template" },
    {
      label: "Pause",
      value: state.paused ? "ON" : "OFF",
      toggleKey: "Space"
    },
    {
      label: "Rotation",
      value: `${state.rotXDeg.toFixed(0)} / ${state.rotYDeg.toFixed(0)}`,
      note: "[R] reset"
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
    clearColor: [0.08, 0.11, 0.16, 1.0],
    lightPosition: [140.0, 180.0, 240.0, 1.0],
    viewAngle: 53.0,
    messageFontTexture: "../../webg/font512.png",
    debugOverlay: {
      title: "basic",
      y: 14
    },
    debugTools: {
      mode: "debug",
      system: "template-basic",
      source: "templates/basic/main.js",
      probeDefaultAfterFrames: 1
    },
    camera: {
      target: [0.0, 0.0, 0.0],
      distance: 22.0,
      yaw: 0.0,
      pitch: 0.0
    }
  });
  await app.init();

  app.setDiagnosticsStage("build-shape");

  const state = {
    paused: false,
    rotXDeg: 0.0,
    rotYDeg: 0.0
  };

  const cubeShape = new Shape(app.getGL());
  cubeShape.applyPrimitiveAsset(Primitive.cube(8.0, cubeShape.getPrimitiveOptions()));
  cubeShape.endShape();
  cubeShape.setMaterial("smooth-shader", {
    has_bone: 0,
    use_texture: 0,
    color: [0.24, 0.66, 0.96, 1.0],
    ambient: 0.22,
    specular: 0.82,
    power: 42.0
  });

  const cubeNode = app.space.addNode(null, "cube");
  cubeNode.addShape(cubeShape);

  const refreshDiagnosticsStats = (frameCount) => {
    const envReport = app.checkEnvironment({
      stage: "runtime-check",
      shapes: [cubeShape]
    });
    app.mergeDiagnosticsStats({
      frameCount,
      paused: state.paused ? "yes" : "no",
      rotX: state.rotXDeg.toFixed(1),
      rotY: state.rotYDeg.toFixed(1),
      envOk: envReport.ok ? "yes" : "no",
      envWarning: envReport.warnings?.[0] ?? "-"
    });
    return envReport;
  };

  const makeProbeReport = (frameCount) => {
    const envReport = app.checkEnvironment({
      stage: "runtime-probe",
      shapes: [cubeShape]
    });
    const report = app.createProbeReport("runtime-probe");
    Diagnostics.addDetail(report, `paused=${state.paused ? "on" : "off"}`);
    Diagnostics.addDetail(report, `rotation=${state.rotXDeg.toFixed(1)}/${state.rotYDeg.toFixed(1)}`);
    if (envReport.warnings?.length) {
      Diagnostics.addDetail(report, `envWarning=${envReport.warnings[0]}`);
    }
    Diagnostics.mergeStats(report, {
      frameCount,
      paused: state.paused ? "yes" : "no",
      envOk: envReport.ok ? "yes" : "no"
    });
    return report;
  };

  const requestProbe = (format = "text", afterFrames = 1) => {
    app.requestProbe({
      label: `basic_${format}_probe`,
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
        return;
      }
      if (key === "r") {
        state.rotXDeg = 0.0;
        state.rotYDeg = 0.0;
        cubeNode.setAttitude(0.0, 0.0, 0.0);
      }
    }
  });

  app.setDiagnosticsStage("runtime");
  app.start({
    onUpdate: ({ deltaSec, screen }) => {
      if (!state.paused) {
        state.rotYDeg += 34.0 * deltaSec;
        state.rotXDeg += 18.0 * deltaSec;
        cubeNode.setAttitude(state.rotYDeg, state.rotXDeg, 0.0);
      }

      const envReport = refreshDiagnosticsStats(screen.getFrameCount());
      app.setControlRows(makeControlRows(state, screen.getFrameCount(), envReport), HUD_ROW_OPTIONS);
      app.updateDebugProbe();
    }
  });
};
