// ---------------------------------------------
// samples/compute_ssr/main.js  2026/07/25
//   Compute Shader screen-space reflection sample
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import WebgApp from "../../webg/WebgApp.js";
import { buildErrorPanelOptions, buildHelpPanelOptions } from "../../webg/OverlayPanelPresets.js";
import CommandPalette, {
  getDefaultCommandPaletteCss
} from "../../webg/CommandPalette.js";
import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";
import FullscreenPass from "../../webg/FullscreenPass.js";
import Diagnostics from "../../webg/Diagnostics.js";
import {
  COMPUTE_SSR_DEFAULTS
} from "../../webg/ComputeSsrPass.js";
import ComputeEffectPipeline from "../../webg/ComputeEffectPipeline.js";

let app = null;
let palette = null;
let lastHelpText = "";
let lastHelpUpdateMs = 0;

// 操作説明とFrameTimerの英語表示行を同じHelp panelへまとめる
// timestamp-query非対応時は0 msへ置き換えず、FrameTimerのunavailable表示をそのまま使う
function buildHelpLines() {
  const p = app?.computeSsrState?.params;
  return [
    "Compute screen-space reflections",
    "CommandPalette: double tap canvas or press /",
    "Drag or Arrow keys: orbit camera",
    "Use palette controls to inspect SSR ray marching",
    "",
    `SSR: ${app?.computeSsrState?.enabled ? "ON" : "OFF"} / view: ${app?.computeSsrState?.view ?? "--"}`,
    `Ray: intensity ${p ? p.intensity.toFixed(2) : "--"} / distance ${p ? p.distance.toFixed(0) : "--"}`,
    `Hit: thickness ${p ? p.thickness.toFixed(2) : "--"} / steps ${p ? p.steps : "--"}`,
    `Fast: scale ${p ? p.resolutionScale.toFixed(2) : "--"} / reflect min ${p ? p.reflectivityThreshold.toFixed(2) : "--"}`,
    `Pause: ${app?.computeSsrState?.paused ? "ON" : "OFF"}`,
    ...(app?.getFrameTimingLines?.() ?? [])
  ];
}

// GPU readbackの移動平均が変化したときだけHelp panelを更新し、毎frameのDOM再構築を避ける
function updateHelpPanel() {
  const panel = app?.getOverlayPanel?.("computeSsrHelp");
  if (!panel) return;
  const lines = buildHelpLines();
  const nextText = lines.join("\n");
  if (nextText === lastHelpText) return;
  app.updateOverlayPanel("computeSsrHelp", { lines });
  lastHelpText = nextText;
}

// Primitive生成関数からShapeを作り、GeometryBufferPassへ渡すGPU資産をここで確定する
// SSRの主題は反射ray marchingなので、shape生成は短い補助関数へ寄せて読み筋を保つ
function createPrimitiveShape(gpu, createPrimitive) {
  if (typeof createPrimitive !== "function") {
    throw new Error("createPrimitiveShape requires a primitive factory function");
  }
  const shape = new Shape(gpu);
  shape.applyPrimitiveAsset(createPrimitive(shape.getPrimitiveOptions()));
  shape.endShape();
  return shape;
}

// 旧color alpha反射率をv2 surface materialのspecularへ明示的に移し、
// G-bufferがalbedoと反射特性を別attachmentへ保持できるようにする
function addObject(name, shape, position, scale, material) {
  const node = app.space.addNode(null, name);
  node.setPosition(...position);
  node.setScale(scale);
  shape.shaderParameter("color", [material[0], material[1], material[2], 1.0]);
  shape.shaderParameter("specular", material[3]);
  shape.shaderParameter("roughness", 0.18);
  shape.shaderParameter("metallic", 0.0);
  shape.shaderParameter("emissive", 0.0);
  node.addShape(shape);
  return node;
}

// 反射率の違いを見比べやすい床、台座、球、箱、トーラスを配置する
// SSRの制約を観察しやすいよう、鏡面寄りの面と低反射の面を同じsceneへ混ぜている
function createScene() {
  const gpu = app.getGPU();
  const cuboid = (x, y, z) => createPrimitiveShape(gpu, (options) => Primitive.cuboid(x, y, z, options));
  const sphere = createPrimitiveShape(gpu, (options) => Primitive.sphere(1.0, 32, 24, options));
  const torus = createPrimitiveShape(gpu, (options) => Primitive.donut(1.0, 0.32, 32, 16, options));

  addObject("mirrorFloor", cuboid(40, 0.8, 34), [0, -5, 0], 1, [0.17, 0.22, 0.25, 0.96]);
  addObject("backWall", cuboid(40, 18, 1), [0, 3.5, -15], 1, [0.30, 0.36, 0.42, 0.20]);
  addObject("sideWall", cuboid(1, 18, 30), [-19.5, 3.5, 0], 1, [0.38, 0.24, 0.20, 0.22]);
  addObject("reflectivePlinth", cuboid(10, 0.8, 7), [7, -2.6, -5], 1, [0.22, 0.28, 0.31, 0.86]);

  return [
    addObject("redSphere", sphere, [-8, -1.2, -5], 3.2, [0.92, 0.12, 0.08, 0.58]),
    addObject("cyanSphere", sphere.createInstance(), [7, 0.1, -5], 2.5, [0.05, 0.72, 0.94, 0.68]),
    addObject("goldBox", cuboid(4.2, 6.5, 4.2), [0, -1.4, 2], 1, [0.96, 0.58, 0.08, 0.60]),
    addObject("violetBox", cuboid(4, 4, 4), [11, -2.6, 4], 1, [0.58, 0.18, 0.92, 0.56]),
    addObject("greenTorus", torus, [-2, 1.0, -8], 3.0, [0.08, 0.88, 0.42, 0.64])
  ];
}

document.addEventListener("DOMContentLoaded", () => {
  start().catch((err) => {
    app?.setDiagnosticsReport?.(Diagnostics.createErrorReport(err, {
      system: "compute_ssr",
      source: "samples/compute_ssr/main.js"
    }));
    app?.showOverlayPanel?.(buildErrorPanelOptions(err, {
      title: "compute_ssr failed",
      id: "start-error"
    }));
    console.error("compute_ssr failed:", err);
  });
});

// WebgApp、GeometryBufferPass、ComputeSsrPass、FullscreenPassを接続し、SSRの3段構成を組み立てる
// frame順序は G-buffer生成 -> SSR compute -> canvas copy とし、screen-space effectの前提を明示する
async function start() {
  app = new WebgApp({
    document,
    autoDrawScene: false,
    frameTiming: true,
    clearColor: [0.015, 0.03, 0.05, 1],
    viewAngle: 52,
    projectionFar: 120,
    messageFontTexture: "../../webg/font512.png",
    camera: { target: [0, -1.0, -3], distance: 37, yaw: 18, pitch: -15 },
    debugTools: {
      mode: "release",
      system: "compute_ssr",
      source: "samples/compute_ssr/main.js",
      probeDefaultAfterFrames: 1
    }
  });
  await app.init();
  const helpLines = buildHelpLines();
  app.showOverlayPanel(buildHelpPanelOptions({
    id: "computeSsrHelp",
    collapsed: true,
    lines: helpLines
  }));
  lastHelpText = helpLines.join("\n");
  const orbit = app.createOrbitEyeRig({
    target: [0, -1.0, -3],
    distance: 37,
    yaw: 18,
    pitch: -15,
    minDistance: 18,
    maxDistance: 65,
    wheelZoomStep: 1.2
  });
  const pipeline = new ComputeEffectPipeline(app.getGPU(), {
    label: "compute-ssr",
    width: app.screen.getWidth(),
    height: app.screen.getHeight(),
    lighting: {
      ambient: 0.10,
      directionalIntensity: 1.0
    }
  });
  await pipeline.ready;
  const copyPass = new FullscreenPass(app.getGPU(), { targetFormat: app.getGPU().format });
  await copyPass.init();
  const sceneNodes = createScene();
  const state = {
    enabled: true,
    paused: false,
    view: "composite",
    params: {
      intensity: COMPUTE_SSR_DEFAULTS.intensity,
      distance: COMPUTE_SSR_DEFAULTS.distance,
      thickness: COMPUTE_SSR_DEFAULTS.thickness,
      steps: COMPUTE_SSR_DEFAULTS.steps,
      resolutionScale: COMPUTE_SSR_DEFAULTS.resolutionScale,
      reflectivityThreshold: COMPUTE_SSR_DEFAULTS.reflectivityThreshold
    }
  };
  app.computeSsrState = state;

  // 操作変更後の表示と状態を現在の入力と実行状態に合わせて更新する
  const refreshAfterControlChange = () => {
    palette?.render();
    updateHelpPanel();
    app.requestRender();
  };

  // 操作パレットを生成し、後続処理で利用できる状態にする
  const createPalette = () => {
    palette = new CommandPalette({
      document,
      container: document.body,
      viewport: app.screen.canvas,
      title: "Compute SSR",
      pageRows: 5,
      pageRowsByPage: [5, 5],
      closeOnCommand: false,
      onChange: (id, value) => {
        const p = state.params;
        if (id === "enabled") state.enabled = value;
        else if (id === "paused") state.paused = value;
        else if (id === "view") state.view = value;
        else if (id === "intensity") p.intensity = value;
        else if (id === "distance") p.distance = value;
        else if (id === "thickness") p.thickness = value;
        else if (id === "steps") p.steps = value;
        else if (id === "resolution-scale") p.resolutionScale = value;
        else if (id === "reflect-min") p.reflectivityThreshold = value;
        refreshAfterControlChange();
      },
      commands: [
        // 1ページ目
        { type: "toggle", id: "enabled", label: "SSR", detail: "on/off", value: () => state.enabled },
        { type: "toggle", id: "paused", label: "Pause", detail: "anim", value: () => state.paused },
        null,
        { id: "palette-next", label: "Next", detail: "page", pageSwitch: true },
        { type: "select", id: "view", label: "View", value: () => state.view, options: [
          { value: "composite", label: "composite" },
          { value: "scene", label: "scene" },
          { value: "reflection", label: "reflection" },
          { value: "normal", label: "normal" },
          { value: "depth", label: "depth" }
        ] },
        { type: "stepper", id: "intensity", label: "Intensity", value: () => state.params.intensity, min: 0.0, max: 1.5, step: 0.08, decimals: 2, input: true },
        { type: "stepper", id: "distance", label: "Distance", value: () => state.params.distance, min: 8, max: 80, step: 4, decimals: 0, input: true },
        { type: "stepper", id: "thickness", label: "Thickness", value: () => state.params.thickness, min: 0.08, max: 1.5, step: 0.05, decimals: 2, input: true },
        // 2ページ目
        null,
        null,
        null,
        { id: "palette-next", label: "Next", detail: "page", pageSwitch: true },
        { type: "stepper", id: "steps", label: "Steps", value: () => state.params.steps, min: 12, max: 64, step: 4, decimals: 0, input: true },
        { type: "stepper", id: "resolution-scale", label: "SSR Scale", value: () => state.params.resolutionScale, min: 0.5, max: 1.0, step: 0.05, decimals: 2, input: true },
        { type: "stepper", id: "reflect-min", label: "Reflect Min", value: () => state.params.reflectivityThreshold, min: 0.0, max: 0.40, step: 0.02, decimals: 2, input: true },
        null,
        null,
        null,
        null,
      ]
    });
    palette.attachToCanvas(app.screen.canvas, { key: "/" });
    palette.setStyle(getDefaultCommandPaletteCss());
  };

  createPalette();
  refreshAfterControlChange();

  app.attachInput({
    onKeyDown: async (key, ev) => {
      if (ev.repeat) return;
      const p = state.params;
      if (key === "c") state.enabled = !state.enabled;
      else if (key === "v") {
        const views = ["composite", "scene", "reflection", "normal", "depth"];
        state.view = views[(views.indexOf(state.view) + 1) % views.length];
      } else if (key === "1") p.intensity = Math.max(0, p.intensity - 0.08);
      else if (key === "2") p.intensity = Math.min(1.5, p.intensity + 0.08);
      else if (key === "3") p.distance = Math.max(8, p.distance - 4);
      else if (key === "4") p.distance = Math.min(80, p.distance + 4);
      else if (key === "5") p.thickness = Math.max(0.08, p.thickness - 0.05);
      else if (key === "6") p.thickness = Math.min(1.5, p.thickness + 0.05);
      else if (key === "7") p.steps = Math.max(12, p.steps - 4);
      else if (key === "8") p.steps = Math.min(64, p.steps + 4);
      else if (key === "9") p.resolutionScale = Math.max(0.5, p.resolutionScale - 0.05);
      else if (key === "0") p.resolutionScale = Math.min(1.0, p.resolutionScale + 0.05);
      else if (key === " ") state.paused = !state.paused;
    }
  });
  app.setDiagnosticsStage("runtime");
  app.configureDebugKeyInput();
  app.start({
    onUpdate: ({ deltaSec, screen, timeMs }) => {
      // 前frameでsubmitしたtimestampを非同期readbackへ進め、最新平均を表示へ反映する
      app.afterGpuSubmit();
      if (timeMs - lastHelpUpdateMs >= 500) {
        updateHelpPanel();
        lastHelpUpdateMs = timeMs;
      }
      if (!state.paused) {
        sceneNodes[0].rotateY(9 * deltaSec);
        sceneNodes[1].rotateY(-11 * deltaSec);
        sceneNodes[2].rotateY(7 * deltaSec);
        sceneNodes[3].rotateY(-8 * deltaSec);
        sceneNodes[4].rotateY(14 * deltaSec);
        sceneNodes[4].rotateX(5 * deltaSec);
      }
      pipeline.resize(screen.getWidth(), screen.getHeight());
      app.mergeDiagnosticsStats({
        view: state.view,
        enabled: state.enabled ? "yes" : "no",
        steps: state.params.steps,
        distance: state.params.distance.toFixed(0),
        ssrScale: state.params.resolutionScale.toFixed(2),
        reflectMin: state.params.reflectivityThreshold.toFixed(2)
      });
      app.updateDebugProbe();
    },
    onBeforeDraw: ({ cameraFrame }) => {
      // 第1段階ではsceneをG-bufferへ描き、SSRが参照するalbedo、normal、depthを確定する
      // Render計測はG-buffer生成だけを囲み、後段SSR Compute時間と重複させない
      app.beginGpuTiming();
      pipeline.renderScene(app.space, cameraFrame, app.clearColor, {
          shadowEnabled: false,
          timestampWrites: app.getGpuRenderTimestampWrites(true, true)
      });
    },
    onAfterDraw3d: ({ cameraFrame }) => {
      // 第2段階ではComputeSsrPassへG-bufferとparameterを渡し、反射ray marchを記録する
      // 第3段階ではSSR結果をFullscreenPassでcanvasへcopyし、view modeを確認できるようにする
      const p = state.params;
      app.getGPU().endPass();
      const finalColor = pipeline.encode(app.getGPU().commandEncoder, {
        cameraFrame,
        shadowEnabled: false,
        ssaoEnabled: false,
        ssrEnabled: state.enabled && state.view !== "scene",
        toonEnabled: false,
        dofEnabled: false,
        bloomEnabled: false,
        edgeEnabled: false,
        lightingView: state.view === "normal" || state.view === "depth" ? state.view : "lighting",
        ssrView: "reflection",
        ssr: {
          intensity: p.intensity,
          distance: p.distance,
          thickness: p.thickness,
          steps: p.steps,
          resolutionScale: p.resolutionScale,
          reflectivityThreshold: p.reflectivityThreshold
        },
        timestampWrites: app.getGpuTimestampWrites(true, true)
      });
      // G-bufferとSSRのtimestampを同じcommand encoderで解決し、submit後のreadbackへ渡す
      app.endGpuTiming(app.getGPU().commandEncoder);
      app.screen.beginPresentPass({ clearColor: app.clearColor, colorLoadOp: "clear" });
      copyPass.draw(finalColor);
      app.screen.clearDepthBuffer();
    }
  });
}
