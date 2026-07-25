// ---------------------------------------------
// main.js  2026/07/25
//   Coverage-separated Compute Shader depth of field sample
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
import ComputeEffectPipeline from "../../webg/ComputeEffectPipeline.js?v=20260723_dof_coverage";
import {
  COMPUTE_DOF_DEFAULTS
} from "../../webg/ComputeDofPass.js?v=20260723_dof_coverage";
import DofDebugViewPass from "./DofDebugViewPass.js";

// 焦点距離と焦点幅はfragment shader版と比較しやすい値に揃えます
// ぼかし画像の解像度はコア側で1/2、1/4、1/8、1/16に固定し、
// サンプル側が旧方式のtap数や任意scaleを渡す経路は設けません
const DEFAULTS = {
  focusDistance: COMPUTE_DOF_DEFAULTS.focusDistance,
  focusRange: COMPUTE_DOF_DEFAULTS.focusRange,
  blurRadius: COMPUTE_DOF_DEFAULTS.blurRadius,
  cocScale: COMPUTE_DOF_DEFAULTS.cocScale
};

let app = null;
let palette = null;
let lastHelpText = "";
let lastHelpUpdatedAt = 0.0;
const HELP_TIMING_REFRESH_INTERVAL_MS = 500.0;

// ヘルプの行を生成し、後続処理で利用できる状態にする
function buildHelpLines() {
  const p = app?.computeDofState?.params;
  return [
    "Compute DoF: geometry coverage and CoC are stored separately",
    "Defocused geometry uses the same scene blur Level on both sides of its original silhouette",
    "CommandPalette: double tap canvas or press /",
    "Drag or Arrow keys: orbit camera",
    "Use palette controls to compare focus, pyramid Levels and debug views",
    "",
    `DOF: ${app?.computeDofState?.enabled ? "ON" : "OFF"} / view: ${app?.computeDofState?.view ?? "--"}`,
    `Focus: ${p ? p.focusDistance.toFixed(1) : "--"} / range: ${p ? p.focusRange.toFixed(1) : "--"}`,
    `Blur radius: ${p ? p.blurRadius.toFixed(2) : "--"} / CoC scale: ${p ? p.cocScale.toFixed(2) : "--"}`,
    "Pyramids: scene + near coverage + far coverage + CoC metadata",
    "Signed near/far geometry CoC controls blur spreading across silhouettes",
    "Focus view colors show signed stages: near -4..-1, focus 0, far 1..4",
    "Coverage views: white geometry interior, black focus/background",
    "CoC metadata view: near red, far blue; CoC Scale changes intensity only",
    "Use half / quarter / eighth / sixteenth views to inspect each Level",
    ...(app?.getFrameTimingLines?.() ?? [])
  ];
}

// Help Panelの負荷表示はFrameTimerの移動平均値を使います
// ただし毎frame文字列を書き換えると数値が忙しく見えるため、通常更新は0.5秒ごとに抑えます
// palette操作など設定値をすぐ見せたい場面ではforce=trueで即時反映します
function updateHelpPanel({ force = false } = {}) {
  const panel = app?.getOverlayPanel?.("computeDofHelp");
  if (!panel) return;
  const nowMs = performance.now();
  if (!force && nowMs - lastHelpUpdatedAt < HELP_TIMING_REFRESH_INTERVAL_MS) return;
  const lines = buildHelpLines();
  const nextText = lines.join("\n");
  if (nextText === lastHelpText) {
    lastHelpUpdatedAt = nowMs;
    return;
  }
  app.updateOverlayPanel("computeDofHelp", { lines });
  lastHelpText = nextText;
  lastHelpUpdatedAt = nowMs;
}

// depth比較用objectへ共通のsmooth-shader materialを設定します
function makeMaterial(color, ambient = 0.70, specular = 1.0, power = 58.0) {
  return {
    has_bone: 0,
    use_texture: 0,
    color,
    ambient,
    specular,
    power,
    roughness: 0.42,
    metallic: 0.0,
    emissive: 0.0
  };
}

// 近景・中景・遠景を区別する縦長markerを作ります
function addCuboid(name, position, size, color) {
  const shape = new Shape(app.getGPU());
  shape.applyPrimitiveAsset(Primitive.cuboid(size[0], size[1], size[2], shape.getPrimitiveOptions()));
  shape.endShape();
  shape.setMaterial("smooth-shader", makeMaterial(color, 0.30, 0.35, 18.0));
  const node = app.space.addNode(null, name);
  node.setPosition(...position);
  node.addShape(shape);
  return node;
}

// cameraから異なる距離に球を並べ、focusDistance変更時のsharp/blur領域を見せます
// unit sphere geometryをinstance化し、mesh resourceの重複を避けます
function createScene() {
  const source = new Shape(app.getGPU());
  source.applyPrimitiveAsset(Primitive.sphere(1.0, 28, 20, source.getPrimitiveOptions()));
  source.endShape();

  // x, y, z, radius, colorの順で近景から遠景まで配置します
  const entries = [
    [-14.5, -1.2, 19.0, 1.55, [1.0, 0.40, 0.32, 1.0]],
    [-8.2, 2.3, 16.5, 1.25, [1.0, 0.58, 0.34, 1.0]],
    [-2.0, -0.7, 13.5, 1.45, [1.0, 0.72, 0.38, 1.0]],
    [5.8, 1.7, 11.0, 1.20, [0.96, 0.82, 0.42, 1.0]],
    [12.8, -2.0, 8.5, 1.60, [0.98, 0.66, 0.46, 1.0]],
    [-12.0, 1.2, 4.0, 1.35, [0.96, 0.92, 0.74, 1.0]],
    [-5.0, -2.2, 1.0, 1.70, [0.92, 1.0, 0.72, 1.0]],
    [1.0, 0.8, -1.5, 1.50, [0.78, 1.0, 0.70, 1.0]],
    [7.2, 2.0, -4.8, 1.25, [0.56, 1.0, 0.78, 1.0]],
    [13.0, -1.0, -7.5, 1.55, [0.42, 0.96, 0.82, 1.0]],
    [-13.5, -0.8, -12.0, 1.35, [0.38, 0.84, 1.0, 1.0]],
    [-7.0, 2.4, -15.5, 1.15, [0.40, 0.72, 1.0, 1.0]],
    [-1.0, -1.8, -19.0, 1.55, [0.52, 0.62, 1.0, 1.0]],
    [6.5, 1.2, -22.5, 1.30, [0.70, 0.54, 1.0, 1.0]],
    [14.0, -2.4, -26.0, 1.60, [0.86, 0.48, 1.0, 1.0]]
  ];
  const spheres = entries.map((entry, i) => {
    // geometryは共有し、materialとuniform scaleだけをinstanceごとに変えます
    const shape = source.createInstance();
    shape.setMaterial("smooth-shader", makeMaterial(entry[4]));
    const node = app.space.addNode(null, `depthSphere${i}`);
    node.setPosition(entry[0], entry[1], entry[2]);
    node.setScale(entry[3]);
    node.addShape(shape);
    return node;
  });

  // scene内のdepth帯を目視しやすくするnear/mid/far markerです
  addCuboid("markerNear", [-13.0, 0.0, 16.0], [0.9, 22.5, 0.9], [0.90, 0.36, 0.28, 1.0]);
  addCuboid("markerMid", [0.0, 0.0, 0.0], [0.9, 25.5, 0.9], [0.92, 0.84, 0.36, 1.0]);
  addCuboid("markerFar", [13.0, 0.0, -16.0], [0.9, 28.5, 0.9], [0.36, 0.82, 1.0, 1.0]);
  return spheres;
}

document.addEventListener("DOMContentLoaded", () => {
  start().catch((err) => {
    app?.setDiagnosticsReport?.(Diagnostics.createErrorReport(err, {
      system: "compute_dof",
      source: "samples/compute_dof/main.js"
    }));
    app?.showOverlayPanel?.(buildErrorPanelOptions(err, {
      title: "compute_dof failed",
      id: "start-error"
    }));
    console.error("compute_dof failed:", err);
  });
});

// scene target、image pyramid、depth composite、debug表示を組み立てます
async function start() {
  // autoDrawSceneを止め、scene -> blur -> depth composite -> canvasの順を
  // sample側で明示的に制御します
  app = new WebgApp({
    document,
    autoDrawScene: false,
    frameTiming: true,
    clearColor: [0.025, 0.035, 0.055, 1.0],
    viewAngle: 52.0,
    projectionFar: 160.0,
    messageFontTexture: "../../webg/font512.png",
    camera: { target: [0.0, 0.0, 0.0], distance: 36.0, yaw: 18.0, pitch: -10.0 },
    light: {
      mode: "world-node",
      nodeName: "worldLight",
      position: [90.0, 140.0, 120.0],
      attitude: [0.0, 0.0, 0.0],
      type: 1.0
    },
    debugTools: {
      mode: "release",
      system: "compute_dof",
      source: "samples/compute_dof/main.js",
      probeDefaultAfterFrames: 1
    }
  });
  await app.init();

  // 操作説明はHelp panel、現在値はCommandPaletteへ表示します
  const helpLines = buildHelpLines();
  app.showOverlayPanel(buildHelpPanelOptions({
    id: "computeDofHelp",
    collapsed: true,
    lines: helpLines
  }));
  lastHelpText = helpLines.join("\n");
  lastHelpUpdatedAt = performance.now();
  const orbit = app.createOrbitEyeRig({
    target: [0.0, 0.0, 0.0],
    distance: 36.0,
    yaw: 18.0,
    pitch: -10.0,
    minDistance: 16.0,
    maxDistance: 88.0,
    wheelZoomStep: 1.3
  });

  // v2統合pipelineでG-bufferからHDR lighting、DoF、Tone Mapまでを一続きにし、
  // 8bit forward sceneをHDR DoFへ渡す旧resource経路を残しません
  const pipeline = new ComputeEffectPipeline(app.getGPU(), {
    label: "compute-dof",
    width: app.screen.getWidth(),
    height: app.screen.getHeight(),
    lighting: {
      ambient: 0.18,
      directionalIntensity: 1.0
    }
  });
  await pipeline.ready;

  // compute outputやdebug targetをcanvasへ表示する最終copy passです
  const copyPass = new FullscreenPass(app.getGPU(), { targetFormat: app.getGPU().format });
  await copyPass.init();
  const debugViewPass = new DofDebugViewPass(app.getGPU(), {
    width: app.screen.getWidth(),
    height: app.screen.getHeight()
  });
  await debugViewPass.ready;
  const spheres = createScene();
  const state = {
    enabled: true,
    view: "composite",
    params: { ...DEFAULTS }
  };
  app.computeDofState = state;

  // effect parameterとdebug viewだけを初期値へ戻します
  const reset = () => {
    state.enabled = true;
    state.view = "composite";
    Object.assign(state.params, DEFAULTS);
  };

  // 操作変更後の表示と状態を現在の入力と実行状態に合わせて更新する
  const refreshAfterControlChange = () => {
    palette?.render();
    updateHelpPanel({ force: true });
    app.requestRender();
  };

  // 操作パレットを生成し、後続処理で利用できる状態にする
  const createPalette = () => {
    palette = new CommandPalette({
      document,
      container: document.body,
      viewport: app.screen.canvas,
      title: "Compute DOF",
      pageRows: 5,
      pageRowsByPage: [5, 5],
      closeOnCommand: false,
      onChange: (id, value) => {
        const p = state.params;
        if (id === "enabled") state.enabled = value;
        else if (id === "view") state.view = value;
        else if (id === "focus-distance") p.focusDistance = value;
        else if (id === "focus-range") p.focusRange = value;
        else if (id === "blur-radius") p.blurRadius = value;
        else if (id === "coc-scale") p.cocScale = value;
        refreshAfterControlChange();
      },
      onCommand: (id) => {
        if (id === "reset") reset();
        refreshAfterControlChange();
      },
      commands: [
        // 1ページ目
        { type: "toggle", id: "enabled", label: "DOF", detail: "on/off", value: () => state.enabled },
        { id: "reset", label: "Reset", detail: "params" },
        null,
        { id: "palette-next", label: "Next", detail: "page", pageSwitch: true },
        { type: "select", id: "view", label: "View", value: () => state.view, options: [
          { value: "composite", label: "composite" },
          { value: "scene", label: "scene" },
          { value: "depth", label: "depth" },
          { value: "focus", label: "focus" },
          { value: "far-coverage", label: "far coverage" },
          { value: "near-coverage", label: "near coverage" },
          { value: "coc", label: "CoC metadata" },
          { value: "half", label: "half (1/2)" },
          { value: "quarter", label: "quarter (1/4)" },
          { value: "eighth", label: "eighth (1/8)" },
          { value: "sixteenth", label: "sixteenth (1/16)" }
        ] },
        { type: "stepper", id: "focus-distance", label: "Focus Dist", value: () => state.params.focusDistance, min: 4.0, max: 90.0, step: 1.5, decimals: 1, input: true },
        { type: "stepper", id: "focus-range", label: "Focus Range", value: () => state.params.focusRange, min: 1.0, max: 30.0, step: 0.8, decimals: 1, input: true },
        { type: "stepper", id: "blur-radius", label: "Blur Radius", value: () => state.params.blurRadius, min: 0.25, max: 3.0, step: 0.25, decimals: 2, input: true },
        // 2ページ目
        null,
        null,
        null,
        { id: "palette-next", label: "Next", detail: "page", pageSwitch: true },
        { type: "stepper", id: "coc-scale", label: "CoC Scale", value: () => state.params.cocScale, min: 0.0, max: 2.0, step: 0.1, decimals: 2, input: true },
        null,
        null,
        null,
        null,
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
  };

  createPalette();
  refreshAfterControlChange();

  app.attachInput({
    onKeyDown: async (key, ev) => {
      if (ev.repeat) return;
      const p = state.params;
      if (key === "b") state.enabled = !state.enabled;
      else if (key === "v") {
        const views = [
          "composite", "scene", "depth", "focus",
          "far-coverage", "near-coverage", "coc",
          "half", "quarter", "eighth", "sixteenth"
        ];
        state.view = views[(views.indexOf(state.view) + 1) % views.length];
      } else if (key === "1") p.focusDistance = Math.max(4.0, p.focusDistance - 1.5);
      else if (key === "2") p.focusDistance = Math.min(90.0, p.focusDistance + 1.5);
      else if (key === "3") p.focusRange = Math.max(1.0, p.focusRange - 0.8);
      else if (key === "4") p.focusRange = Math.min(30.0, p.focusRange + 0.8);
      else if (key === "r") reset();
    }
  });
  app.setDiagnosticsStage("runtime");
  app.configureDiagnosticsCapture({
    labelPrefix: "compute_dof",
    collect: () => {
      const report = app.createProbeReport("runtime-probe");
      Diagnostics.mergeStats(report, { view: state.view, enabled: state.enabled, ...state.params });
      return report;
    }
  });
  app.configureDebugKeyInput();
  app.start({
    // update phase: camera、統合pipelineのtarget resize、object animation、Help Panelを更新します
    onUpdate: ({ deltaSec, screen }) => {
      app.afterGpuSubmit();
      updateHelpPanel();
      const width = screen.getWidth();
      const height = screen.getHeight();
      // v2統合pipelineがG-bufferと全effect targetを所有するため、
      // sample側に旧forward sceneTargetを作成・resizeする経路はありません
      pipeline.resize(width, height);
      debugViewPass.resize(width, height);
      for (let i = 0; i < spheres.length; i += 1) {
        spheres[i].rotateY((5.0 + i) * deltaSec);
      }
      app.mergeDiagnosticsStats({ view: state.view, enabled: state.enabled, ...state.params });
      app.updateDebugProbe();
    },
    // draw phase 1: sampleable depth付きsceneTargetへ3D sceneを描きます
    onBeforeDraw: ({ cameraFrame }) => {
      app.beginGpuTiming();
      pipeline.renderScene(app.space, cameraFrame, app.clearColor, {
        shadowEnabled: false,
        timestampWrites: app.getGpuRenderTimestampWrites(true, true)
      });
    },
    // draw phase 2:
    // 1. geometry coverageとCoC metadataを別targetへ抽出する
    // 2. scene、near、far、CoCの4 Pyramidを生成する
    // 3. geometry内部はscene blurへ置換し、輪郭外はcoverageで同じ色へ連続させる
    // 4. 選択中の中間結果をcanvasへコピーする
    onAfterDraw3d: ({ cameraFrame }) => {
      const p = state.params;

      // scene用Render Passを閉じ、DoFの全Compute Passを同じcommand encoderへ追加します
      app.getGPU().endPass();
      let finalColor = pipeline.encode(app.getGPU().commandEncoder, {
        cameraFrame,
        shadowEnabled: false,
        ssaoEnabled: false,
        ssrEnabled: false,
        toonEnabled: false,
        dofEnabled: state.enabled && state.view !== "scene",
        bloomEnabled: false,
        edgeEnabled: false,
        dof: {
          focusDistance: p.focusDistance,
          focusRange: p.focusRange,
          blurRadius: p.blurRadius,
          cocScale: p.cocScale,
          debugView: state.view === "depth" || state.view === "focus"
            ? state.view
            : "composite",
          sharpnessWidth: 0.2,
          sharpnessPower: 8.0
        },
        timestampWrites: app.getGpuTimestampWrites(true, true)
      });
      app.endGpuTiming(app.getGPU().commandEncoder);

      // Pyramid LevelはDoF合成前のtargetを直接表示し、
      // depth/focus/compositeはDoFまたは統合pipelineの出力を表示します
      const dofDebugViews = [
        "far-coverage", "near-coverage", "coc",
        "half", "quarter", "eighth", "sixteenth"
      ];
      if (state.enabled && dofDebugViews.includes(state.view)) {
        let hdrDebugTarget;
        let viewMode = "color";
        if (state.view === "far-coverage") {
          hdrDebugTarget = pipeline.dofPass.getFarFieldTarget();
          viewMode = "coverage";
        } else if (state.view === "near-coverage") {
          hdrDebugTarget = pipeline.dofPass.getNearFieldTarget();
          viewMode = "coverage";
        } else if (state.view === "coc") {
          hdrDebugTarget = pipeline.dofPass.getCocFieldTarget();
          viewMode = "coc";
        } else {
          hdrDebugTarget = state.view === "half"
            ? pipeline.dofPass.getHalfTarget()
            : state.view === "quarter"
              ? pipeline.dofPass.getQuarterTarget()
              : state.view === "eighth"
                ? pipeline.dofPass.getEighthTarget()
                : pipeline.dofPass.getSixteenthTarget();
        }
        // FullscreenPassはTone Map後のrgba8unormだけを表示sourceとして受け付けます
        // 低解像度Levelを直接渡さず、専用passでfull解像度へ拡大して表示色へ変換します
        finalColor = debugViewPass.encode(
          app.getGPU().commandEncoder,
          hdrDebugTarget,
          { exposure: 1.0, viewMode }
        );
      }
      // Compute Shaderの結果はFullscreenPassでcanvasへコピーします
      app.screen.beginPresentPass({ clearColor: app.clearColor, colorLoadOp: "clear" });
      copyPass.draw(finalColor);
      app.screen.clearDepthBuffer();
    }
  });
}
