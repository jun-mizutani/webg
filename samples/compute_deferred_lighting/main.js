// ---------------------------------------------
// samples/compute_deferred_lighting/main.js  2026/07/25
//   Compute Shader deferred lighting sample
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
import ComputeEffectPipeline from "../../webg/ComputeEffectPipeline.js";

const MAX_LIGHTS = 128;
const LIGHT_COUNTS = [16, 32, 64, 96, 128];
let app = null;
let palette = null;
let lastHelpText = "";

// ヘルプの行を生成し、後続処理で利用できる状態にする
function buildHelpLines() {
  const state = app?.computeDeferredState;
  return [
    "Compute deferred lighting",
    "CommandPalette: double tap canvas or press /",
    "Drag or Arrow keys: orbit camera",
    "Use palette controls to inspect G-buffer and light count",
    "",
    `View: ${state?.view ?? "--"} / lights: ${state ? state.lightCount : "--"}`,
    `Pause: ${state?.paused ? "ON" : "OFF"}`,
    ...(app?.getFrameTimingLines?.() ?? [])
  ];
}

// ヘルプのパネルを現在の入力と実行状態に合わせて更新する
function updateHelpPanel() {
  const panel = app?.getOverlayPanel?.("computeDeferredHelp");
  if (!panel) return;
  const lines = buildHelpLines();
  const nextText = lines.join("\n");
  if (nextText === lastHelpText) return;
  app.updateOverlayPanel("computeDeferredHelp", { lines });
  lastHelpText = nextText;
}

// Primitive生成関数からShapeを作り、GPU buffer生成までをこのsample側で閉じる
// GeometryBufferPassへ渡す時点でShapeが完成している流れをmain.jsから追いやすくする
function createPrimitiveShape(gpu, createPrimitive) {
  if (typeof createPrimitive !== "function") {
    throw new Error("createPrimitiveShape requires a primitive factory function");
  }
  const shape = new Shape(gpu);
  shape.applyPrimitiveAsset(createPrimitive(shape.getPrimitiveOptions()));
  shape.endShape();
  return shape;
}

// Shapeの標準colorをmaterialとして登録し、scene graphとG-buffer入力を同じNodeへ揃える
// DeferredLightingPassはGeometryBufferPassの出力だけを読むため、ここでobject配置を明示する
function addObject(name, shape, position, scale, color) {
  const node = app.space.addNode(null, name);
  node.setPosition(...position);
  node.setScale(scale);
  shape.shaderParameter("color", color);
  shape.shaderParameter("specular", 0.35);
  shape.shaderParameter("roughness", 0.55);
  shape.shaderParameter("metallic", 0.0);
  shape.shaderParameter("emissive", 0.0);
  node.addShape(shape);
  return node;
}

// G-bufferへ送る床、壁、object群を作り、point lightが当たる比較用sceneを構成する
// lighting計算の見え方を追いやすくするため、形状と色の違うobjectを少数に絞って置く
function createScene() {
  const gpu = app.getGPU();
  const cuboid = (x, y, z) => createPrimitiveShape(gpu, (options) => Primitive.cuboid(x, y, z, options));
  const sphere = createPrimitiveShape(gpu, (options) => Primitive.sphere(1.0, 28, 20, options));
  addObject("floor", cuboid(38, 1, 34), [0, -5, 0], 1, [0.34, 0.38, 0.43, 1]);
  addObject("backWall", cuboid(38, 18, 1), [0, 3.5, -15], 1, [0.26, 0.30, 0.36, 1]);
  addObject("leftWall", cuboid(1, 18, 30), [-18.5, 3.5, 0], 1, [0.30, 0.24, 0.22, 1]);
  addObject("rightWall", cuboid(1, 18, 30), [18.5, 3.5, 0], 1, [0.20, 0.28, 0.32, 1]);
  const nodes = [];
  const colors = [
    [0.90, 0.28, 0.18, 1], [0.18, 0.62, 0.92, 1], [0.30, 0.86, 0.48, 1],
    [0.96, 0.68, 0.18, 1], [0.68, 0.34, 0.92, 1], [0.20, 0.82, 0.78, 1]
  ];
  for (let i = 0; i < 12; i += 1) {
    const x = (i % 4) * 8.0 - 12.0;
    const z = Math.floor(i / 4) * -8.0 + 5.0;
    const shape = i % 2 === 0 ? sphere.createInstance() : cuboid(2.8, 4.5 + (i % 3), 2.8);
    nodes.push(addObject(`object${i}`, shape, [x, -2.8, z], i % 2 === 0 ? 1.8 : 1, colors[i % colors.length]));
  }
  return nodes;
}

// sample全体で使うpoint light配列を用意し、毎frameは位置だけ更新する
// Local Lightはtypeが必須であり、この比較sampleでは全方向のpointを明示します
function createLights() {
  const palette = [
    [1.0, 0.18, 0.08], [0.08, 0.42, 1.0], [0.10, 1.0, 0.38],
    [1.0, 0.55, 0.08], [0.72, 0.12, 1.0], [0.08, 0.95, 1.0]
  ];
  return Array.from({ length: MAX_LIGHTS }, (_, i) => ({
    type: "point",
    position: [0, 0, 0],
    color: palette[i % palette.length],
    radius: 7.5 + (i % 5) * 0.8,
    intensity: 2.8 + (i % 4) * 0.35,
    phase: i * 2.39996,
    lane: i % 8
  }));
}

// CPU側でlightのworld-space位置を時間更新し、次のframeでDeferredLightingPassへ渡す
// sampleではanimation責務をここへ残し、core classはlighting計算だけに絞る
function updateLights(lights, time) {
  for (let i = 0; i < lights.length; i += 1) {
    const light = lights[i];
    const ring = 4.0 + (i % 6) * 2.5;
    const angle = light.phase + time * (0.18 + (i % 7) * 0.012);
    light.position[0] = Math.cos(angle) * ring;
    light.position[1] = -2.5 + light.lane * 1.25 + Math.sin(angle * 1.7) * 1.2;
    light.position[2] = -4.0 + Math.sin(angle) * (8.0 + (i % 5) * 1.8);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  start().catch((err) => {
    app?.setDiagnosticsReport?.(Diagnostics.createErrorReport(err, {
      system: "compute_deferred_lighting",
      source: "samples/compute_deferred_lighting/main.js"
    }));
    app?.showOverlayPanel?.(buildErrorPanelOptions(err, {
      title: "compute_deferred_lighting failed",
      id: "start-error"
    }));
    console.error("compute_deferred_lighting failed:", err);
  });
});

// WebgApp、統合ComputeEffectPipeline、FullscreenPassを接続し、G-bufferとvisibilityの
// resource契約を個別sample側で複製せずにpoint light数とlighting debug viewを比較する
async function start() {
  app = new WebgApp({
    document,
    autoDrawScene: false,
    frameTiming: true,
    clearColor: [0.01, 0.02, 0.035, 1],
    viewAngle: 54,
    projectionFar: 120,
    messageFontTexture: "../../webg/font512.png",
    camera: { target: [0, -0.5, -4], distance: 39, yaw: 22, pitch: -12 },
    debugTools: {
      mode: "release",
      system: "compute_deferred_lighting",
      source: "samples/compute_deferred_lighting/main.js",
      probeDefaultAfterFrames: 1
    }
  });
  await app.init();
  const helpLines = buildHelpLines();
  app.showOverlayPanel(buildHelpPanelOptions({
    id: "computeDeferredHelp",
    collapsed: true,
    lines: helpLines
  }));
  lastHelpText = helpLines.join("\n");
  const orbit = app.createOrbitEyeRig({
    target: [0, -0.5, -4],
    distance: 39,
    yaw: 22,
    pitch: -12,
    minDistance: 20,
    maxDistance: 72,
    wheelZoomStep: 1.2
  });
  const pipeline = new ComputeEffectPipeline(app.getGPU(), {
    label: "compute-deferred",
    width: app.screen.getWidth(),
    height: app.screen.getHeight(),
    maxLights: MAX_LIGHTS,
    lighting: {
      ambient: 0.08,
      directionalIntensity: 0.0
    }
  });
  await pipeline.ready;
  const copyPass = new FullscreenPass(app.getGPU(), { targetFormat: app.getGPU().format });
  await copyPass.init();
  const sceneNodes = createScene();
  const lights = createLights();
  const state = { view: "lighting", lightIndex: 2, lightCount: LIGHT_COUNTS[2], paused: false, time: 0 };
  app.computeDeferredState = state;

  // 操作変更後の表示と状態を現在の入力と実行状態に合わせて更新する
  const refreshAfterControlChange = () => {
    palette?.render();
    updateHelpPanel();
    app.requestRender();
  };

  // 光源の`count`を受け取り、現在の設定と後続処理へ反映する
  const setLightCount = (count) => {
    const index = LIGHT_COUNTS.indexOf(count);
    state.lightIndex = index >= 0 ? index : state.lightIndex;
    state.lightCount = LIGHT_COUNTS[state.lightIndex];
  };

  // 操作パレットを生成し、後続処理で利用できる状態にする
  const createPalette = () => {
    palette = new CommandPalette({
      document,
      container: document.body,
      viewport: app.screen.canvas,
      title: "Deferred Lighting",
      pageRows: 5,
      closeOnCommand: false,
      onChange: (id, value) => {
        if (id === "view") state.view = value;
        else if (id === "paused") state.paused = value;
        else if (id === "light-count") setLightCount(value);
        refreshAfterControlChange();
      },
      commands: [
        // 1ページ目
        null,
        null,
        null,
        { id: "palette-next", label: "Next", detail: "page", pageSwitch: true },
        { type: "select", id: "view", label: "View", value: () => state.view, options: [
          { value: "lighting", label: "lighting" },
          { value: "albedo", label: "albedo" },
          { value: "normal", label: "normal" },
          { value: "depth", label: "depth" }
        ] },
        { type: "select", id: "light-count", label: "Lights", value: () => state.lightCount, options: LIGHT_COUNTS.map((count) => ({
          value: count,
          label: String(count)
        })) },
        { type: "toggle", id: "paused", label: "Pause", detail: "lights", value: () => state.paused },
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
  };

  createPalette();
  refreshAfterControlChange();

  app.attachInput({
    onKeyDown: async (key, ev) => {
      if (ev.repeat) return;
      if (key === "v") {
        const views = ["lighting", "albedo", "normal", "depth"];
        state.view = views[(views.indexOf(state.view) + 1) % views.length];
      } else if (key === "1") {
        state.lightIndex = Math.max(0, state.lightIndex - 1);
      } else if (key === "2") {
        state.lightIndex = Math.min(LIGHT_COUNTS.length - 1, state.lightIndex + 1);
      } else if (key === " ") {
        state.paused = !state.paused;
      }
      state.lightCount = LIGHT_COUNTS[state.lightIndex];
    }
  });
  app.setDiagnosticsStage("runtime");
  app.configureDebugKeyInput();
  app.start({
    onUpdate: ({ deltaSec, screen }) => {
      app.afterGpuSubmit();
      updateHelpPanel();
      if (!state.paused) state.time += deltaSec;
      updateLights(lights, state.time);
      for (let i = 0; i < sceneNodes.length; i += 1) {
        sceneNodes[i].rotateY((i % 2 === 0 ? 7 : -5) * deltaSec);
      }
      pipeline.resize(screen.getWidth(), screen.getHeight());
      app.mergeDiagnosticsStats({ view: state.view, lights: state.lightCount });
      app.updateDebugProbe();
    },
    onBeforeDraw: ({ cameraFrame }) => {
      // 第1段階ではsceneをG-bufferへ描き、後段が必要とするview-space normalとdepthを確定する
      app.beginGpuTiming();
      pipeline.renderScene(app.space, cameraFrame, app.clearColor, {
        shadowEnabled: false,
        timestampWrites: app.getGpuRenderTimestampWrites(true, true)
      });
    },
    onAfterDraw3d: ({ cameraFrame }) => {
      // 第2段階ではG-bufferとlight配列をDeferredLightingPassへ渡し、lighting結果を書き出す
      // 第3段階ではそのStorageTargetをFullscreenPassでcanvasへcopyする
      app.getGPU().endPass();
      const finalColor = pipeline.encode(app.getGPU().commandEncoder, {
        cameraFrame,
        shadowEnabled: false,
        ssaoEnabled: false,
        ssrEnabled: false,
        toonEnabled: false,
        dofEnabled: false,
        bloomEnabled: false,
        edgeEnabled: false,
        lights,
        lightCount: state.lightCount,
        lightingView: state.view,
        lighting: {
          ambient: 0.08,
          directionalIntensity: 0.0
        },
        timestampWrites: app.getGpuTimestampWrites(true, true)
      });
      app.endGpuTiming(app.getGPU().commandEncoder);
      app.screen.beginPresentPass({ clearColor: app.clearColor, colorLoadOp: "clear" });
      copyPass.draw(finalColor);
      app.screen.clearDepthBuffer();
    }
  });
}
