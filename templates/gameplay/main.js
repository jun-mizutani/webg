// -------------------------------------------------
// gameplay template
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
// - gameplay 系 app の最小状態更新を、現行 sample と同じ diagnostics / controls row 付きで始める
// - 左右移動、的の往復、最小距離判定、score 更新という骨格だけを残し、
//   ここから collision、HUD、audio、effect を追加しやすいようにする

const DIAG_TEXT_FILE = "gameplay_diagnostics.txt";
const DIAG_JSON_FILE = "gameplay_diagnostics.json";
const HUD_ROW_OPTIONS = {
  anchor: "top-left",
  x: 0,
  y: 0,
  color: [0.90, 0.95, 1.0],
  minScale: 0.80
};

let app = null;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

document.addEventListener("DOMContentLoaded", () => {
  start().catch((err) => {
    app?.setDiagnosticsReport?.(Diagnostics.createErrorReport(err, {
      system: "template-gameplay",
      source: "templates/gameplay/main.js",
      stage: app?.getDiagnosticsReport?.()?.stage ?? "start"
    }));
    console.error("gameplay template failed:", err);
    app?.showErrorPanel?.(err, {
      title: "gameplay template failed",
      id: "start-error",
      background: "rgba(28, 18, 20, 0.92)"
    });
  });
});

const makeControlRows = (state, envReport, frameCount) => {
  const rows = [
    { line: "gameplay template" },
    {
      label: "Move",
      value: `playerX=${state.playerX.toFixed(2)}`,
      note: "ArrowLeft / ArrowRight"
    },
    {
      label: "Score",
      value: String(state.score),
      note: `hits=${state.hitCount}`
    },
    {
      label: "Pause",
      value: state.paused ? "ON" : "OFF",
      toggleKey: "Space"
    },
    {
      label: "Target",
      value: `${state.targetY.toFixed(2)} dir=${state.targetDir > 0.0 ? "up" : "down"}`,
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
    clearColor: [0.07, 0.10, 0.15, 1.0],
    lightPosition: [160.0, 240.0, 220.0, 1.0],
    viewAngle: 53.0,
    messageFontTexture: "../../webg/font512.png",
    debugOverlay: {
      title: "gameplay",
      y: 14
    },
    debugTools: {
      mode: "debug",
      system: "template-gameplay",
      source: "templates/gameplay/main.js",
      probeDefaultAfterFrames: 1
    },
    camera: {
      target: [0.0, 0.0, 0.0],
      distance: 40.0,
      yaw: 0.0,
      pitch: -18.0
    }
  });
  await app.init();

  app.setDiagnosticsStage("build-scene");

  const state = {
    score: 0,
    hitCount: 0,
    paused: false,
    playerX: 0.0,
    targetY: 8.0,
    targetDir: 1.0
  };

  const floorShape = new Shape(app.getGL());
  floorShape.applyPrimitiveAsset(Primitive.cuboid(40.0, 1.0, 20.0, floorShape.getPrimitiveOptions()));
  floorShape.endShape();
  floorShape.setMaterial("smooth-shader", {
    has_bone: 0,
    use_texture: 0,
    color: [0.20, 0.28, 0.36, 1.0],
    ambient: 0.30,
    specular: 0.30,
    power: 12.0
  });
  const floorNode = app.space.addNode(null, "floor");
  floorNode.setPosition(0.0, -12.0, 0.0);
  floorNode.addShape(floorShape);

  const playerShape = new Shape(app.getGL());
  playerShape.applyPrimitiveAsset(Primitive.cube(4.0, playerShape.getPrimitiveOptions()));
  playerShape.endShape();
  playerShape.setMaterial("smooth-shader", {
    has_bone: 0,
    use_texture: 0,
    color: [0.22, 0.70, 0.98, 1.0],
    ambient: 0.22,
    specular: 0.80,
    power: 40.0
  });
  const playerNode = app.space.addNode(null, "player");
  playerNode.setPosition(0.0, -8.0, 0.0);
  playerNode.addShape(playerShape);

  const targetShape = new Shape(app.getGL());
  targetShape.applyPrimitiveAsset(Primitive.sphere(2.5, 18, 18, targetShape.getPrimitiveOptions()));
  targetShape.endShape();
  targetShape.setMaterial("smooth-shader", {
    has_bone: 0,
    use_texture: 0,
    color: [1.0, 0.72, 0.22, 1.0],
    ambient: 0.24,
    specular: 0.86,
    power: 44.0
  });
  const targetNode = app.space.addNode(null, "target");
  targetNode.setPosition(-12.0, state.targetY, -6.0);
  targetNode.addShape(targetShape);

  const resetState = () => {
    state.score = 0;
    state.hitCount = 0;
    state.playerX = 0.0;
    state.targetY = 8.0;
    state.targetDir = 1.0;
    playerNode.setPosition(0.0, -8.0, 0.0);
    targetNode.setPosition(-12.0, 8.0, -6.0);
  };

  const refreshDiagnosticsStats = (frameCount) => {
    const envReport = app.checkEnvironment({
      stage: "runtime-check",
      shapes: [floorShape, playerShape, targetShape]
    });
    app.mergeDiagnosticsStats({
      frameCount,
      score: state.score,
      hitCount: state.hitCount,
      paused: state.paused ? "yes" : "no",
      playerX: state.playerX.toFixed(2),
      targetY: state.targetY.toFixed(2),
      envOk: envReport.ok ? "yes" : "no",
      envWarning: envReport.warnings?.[0] ?? "-"
    });
    return envReport;
  };

  const makeProbeReport = (frameCount) => {
    const envReport = app.checkEnvironment({
      stage: "runtime-probe",
      shapes: [floorShape, playerShape, targetShape]
    });
    const report = app.createProbeReport("runtime-probe");
    Diagnostics.addDetail(report, `score=${state.score}`);
    Diagnostics.addDetail(report, `hitCount=${state.hitCount}`);
    Diagnostics.addDetail(report, `playerX=${state.playerX.toFixed(2)}`);
    Diagnostics.addDetail(report, `targetY=${state.targetY.toFixed(2)} dir=${state.targetDir > 0.0 ? "up" : "down"}`);
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
      label: `gameplay_${format}_probe`,
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
        resetState();
      }
    }
  });

  app.input.installTouchControls({
    touchDeviceOnly: true,
    groups: [
      {
        id: "move",
        buttons: [
          { key: "arrowleft", label: "\u2190", kind: "hold", ariaLabel: "move left" },
          { key: "arrowright", label: "\u2192", kind: "hold", ariaLabel: "move right" }
        ]
      },
      {
        id: "actions",
        buttons: [
          { key: " ", label: "Pause", kind: "action", ariaLabel: "toggle pause" },
          { key: "r", label: "Reset", kind: "action", ariaLabel: "reset state" }
        ]
      }
    ],
    onAction: ({ key }) => {
      if (key === " ") state.paused = !state.paused;
      else if (key === "r") resetState();
    }
  });

  app.setDiagnosticsStage("runtime");
  app.start({
    onUpdate: ({ deltaSec, input, screen }) => {
      if (!state.paused) {
        if (input.has("arrowleft")) {
          state.playerX = clamp(state.playerX - 20.0 * deltaSec, -14.0, 14.0);
        }
        if (input.has("arrowright")) {
          state.playerX = clamp(state.playerX + 20.0 * deltaSec, -14.0, 14.0);
        }
        playerNode.setPosition(state.playerX, -8.0, 0.0);

        state.targetY += state.targetDir * 9.0 * deltaSec;
        if (state.targetY > 9.0) {
          state.targetY = 9.0;
          state.targetDir = -1.0;
        } else if (state.targetY < -1.0) {
          state.targetY = -1.0;
          state.targetDir = 1.0;
        }
        targetNode.setPosition(-12.0, state.targetY, -6.0);

        const dx = state.playerX + 12.0;
        const dy = -8.0 - state.targetY;
        const dz = 6.0;
        const distSq = dx * dx + dy * dy + dz * dz;
        if (distSq < 28.0) {
          state.score += 1;
          state.hitCount += 1;
          state.targetY = 8.0;
          state.targetDir = -1.0;
          targetNode.setPosition(-12.0, 8.0, -6.0);
        }
      }

      const envReport = refreshDiagnosticsStats(screen.getFrameCount());
      app.setControlRows(makeControlRows(state, envReport, screen.getFrameCount()), HUD_ROW_OPTIONS);
      app.updateDebugProbe();
    }
  });
};
