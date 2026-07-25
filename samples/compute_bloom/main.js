// ---------------------------------------------
// samples/compute_bloom/main.js  2026/07/25
//   Pyramid Compute Shader Bloom sample
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
  COMPUTE_BLOOM_DEFAULTS
} from "../../webg/ComputeBloomPass.js?v=20260723_image_pyramid";
import ComputeEffectPipeline from "../../webg/ComputeEffectPipeline.js?v=20260723_dof_coverage";
import BloomDebugViewPass, {
  getBloomDebugSource,
  isBloomDebugView
} from "./BloomDebugViewPass.js";

// coreのPyramid Bloom既定値と最終Tone Map用Exposureをsampleの初期状態にまとめます
const DEFAULTS = {
  ...COMPUTE_BLOOM_DEFAULTS,
  // Bloomの形状を維持したまま、外側の弱い光芒まで読み取りやすい表示強度にします
  strength: 2.00,
  // exposureはBloom固有値ではなく、最終Tone Mapへ一度だけ適用する表示設定です
  exposure: 1.0
};

const CENTER_EMISSIVE_MIN = 0.60;
const CENTER_EMISSIVE_MAX = 0.95;
const CENTER_EMISSIVE_PERIOD_SEC = 3.0;
const BLOOM_THRESHOLD_MAX = 4.0;
const OVERLAY_PANEL_BACKGROUND = "rgba(8, 18, 30, 0.52)";
const OVERLAY_BODY_BACKGROUND = "rgba(8, 18, 30, 0.24)";
const PROBE_LEVELS = Object.freeze(
  Array.from({ length: 11 }, (_, i) => Number((0.50 + i * 0.05).toFixed(2)))
);

let app = null;
let palette = null;
let lastHelpText = "";

// ヘルプの行を生成し、後続処理で利用できる状態にする
function buildHelpLines() {
  const p = app?.computeBloomState?.params;
  return [
    "Compute version of samples/bloom",
    "CommandPalette: double tap canvas or press /",
    "Drag or Arrow keys: orbit camera",
    "Use palette controls to compare compute bloom stages",
    "",
    `Bloom: ${app?.computeBloomState?.enabled ? "ON" : "OFF"} / view: ${app?.computeBloomState?.view ?? "--"}`,
    `Extract: threshold ${p ? p.threshold.toFixed(2) : "--"} / soft knee ${p ? p.softKnee.toFixed(2) : "--"}`,
    `Level Weight 1/2..1/32: ${p ? `${p.halfWeight.toFixed(2)}:${p.quarterWeight.toFixed(2)}:${p.eighthWeight.toFixed(2)}:${p.sixteenthWeight.toFixed(2)}:${p.thirtySecondWeight.toFixed(2)}` : "--"}`,
    `Upsample Filter Radius: ${p ? p.filterRadius.toFixed(2) : "--"}`,
    `Center Emissive: ${app?.computeBloomScene ? app.computeBloomScene.centerEmissive.toFixed(3) : "--"}`,
    `Fixed Probes: ${PROBE_LEVELS[0].toFixed(2)} .. ${PROBE_LEVELS[PROBE_LEVELS.length - 1].toFixed(2)} by 0.05`,
    `Global Strength: ${p ? p.strength.toFixed(2) : "--"}`,
    `Exposure: ${p ? p.exposure.toFixed(2) : "--"} / pause: ${app?.computeBloomState?.paused ? "ON" : "OFF"}`,
    ...(app?.getFrameTimingLines?.() ?? [])
  ];
}

// ヘルプのパネルを現在の入力と実行状態に合わせて更新する
function updateHelpPanel() {
  const panel = app?.getOverlayPanel?.("computeBloomHelp");
  if (!panel) return;
  const lines = buildHelpLines();
  const nextText = lines.join("\n");
  if (nextText === lastHelpText) return;
  app.updateOverlayPanel("computeBloomHelp", { lines });
  lastHelpText = nextText;
}

// bloom確認用sceneで使うmaterial parameterを統一します
function makeMaterial(color, ambient, specular, power, emissive = 0.0, addColor = [0.0, 0.0, 0.0, 0.0]) {
  return {
    has_bone: 0,
    use_texture: 0,
    color,
    ambient,
    specular,
    power,
    roughness: 0.28,
    metallic: 0.0,
    emissive,
    addColor
  };
}

// 中心球のBloom抽出用発光レベルを0.60から0.95まで滑らかに往復させます
// 単一thresholdとsoft kneeを通過するとき、Bloomが連続して立ち上がるかを見るprobeです
function computeCenterEmissive(timeSec) {
  const phase = (1.0 - Math.cos((timeSec / CENTER_EMISSIVE_PERIOD_SEC) * Math.PI * 2.0)) * 0.5;
  return CENTER_EMISSIVE_MIN + (CENTER_EMISSIVE_MAX - CENTER_EMISSIVE_MIN) * phase;
}

// 固定probeは照明の影響を受けない白色発光体として扱います
// 中心球のアニメーションで急な変化が見えたとき、同じframe内で近い輝度の固定球と比較できます
function makeEmissionProbeMaterial(level) {
  return makeMaterial([level, level, level, 1.0], 0.0, 0.0, 1.0, 1.0);
}

// 球のgeometry、material、node追加を1か所にまとめるscene helperです
function addSphere(name, position, radius, material) {
  const shape = new Shape(app.getGPU());
  shape.applyPrimitiveAsset(Primitive.sphere(radius, 28, 20, shape.getPrimitiveOptions()));
  shape.endShape();
  shape.setMaterial("smooth-shader", material);
  const node = app.space.addNode(null, name);
  node.setPosition(...position);
  node.addShape(shape);
  // 後段のanimationでmaterialだけを更新できるよう、生成したShapeをnode側へ保持します
  node.sampleShape = shape;
  return node;
}

// 0.50 から 1.00 まで 0.05 刻みの固定発光probeを中心球の下に並べます
// 中心球のアニメーション中に不連続が見えた場合、固定列のどの輝度で段階が変わるかを同時に読めます
function addEmissionProbeRow() {
  const spacing = 1.05;
  const startX = -spacing * (PROBE_LEVELS.length - 1) * 0.5;
  return PROBE_LEVELS.map((level, i) => addSphere(
    `probe${String(level.toFixed(2)).replace(".", "_")}`,
    [startX + i * spacing, -3.4, 0.0],
    0.34,
    makeEmissionProbeMaterial(level)
  ));
}

// extract対象となる中心球と、発光強度ごとのBloom差を比較する固定probe列を配置します
// 周辺の固定色付き球は調査対象を増やすため外し、中心球と固定輝度列へ観察対象を絞ります
function createScene() {
  const center = addSphere("center", [0.0, 0.2, 0.0], 0.9,
    makeEmissionProbeMaterial(CENTER_EMISSIVE_MIN));
  const probes = addEmissionProbeRow();

  // 周回する4球はbloomが移動objectへ追従することを確認するprobeです
  const rig = app.space.addNode(null, "orbRoot");
  const colors = [
    [1.0, 0.64, 0.28, 1.0],
    [0.96, 0.42, 0.78, 1.0],
    [0.36, 0.76, 1.0, 1.0],
    [0.72, 1.0, 0.44, 1.0]
  ];
  const orbs = colors.map((color, i) => {
    const angle = i * Math.PI * 0.5;
    const node = addSphere(`orb${i}`, [
      Math.cos(angle) * 3.2,
      1.6 + i * 0.12,
      Math.sin(angle) * 3.2
    ], 0.3375, makeMaterial(color, 0.72, 1.0, 42.0));
    node.attach(rig);
    return node;
  });
  return {
    center,
    centerShape: center.sampleShape,
    centerEmissiveTime: 0.0,
    centerEmissive: CENTER_EMISSIVE_MIN,
    probes,
    probeLevels: PROBE_LEVELS,
    rig,
    orbs
  };
}

document.addEventListener("DOMContentLoaded", () => {
  start().catch((err) => {
    app?.setDiagnosticsReport?.(Diagnostics.createErrorReport(err, {
      system: "compute_bloom",
      source: "samples/compute_bloom/main.js"
    }));
    // 起動失敗時のerror panelもsceneを完全には隠さず、背景を半透明で重ねます
    app?.showOverlayPanel?.({
      ...buildErrorPanelOptions(err, {
        title: "compute_bloom failed",
        id: "start-error",
        background: OVERLAY_PANEL_BACKGROUND
      }),
      bodyBackground: OVERLAY_BODY_BACKGROUND
    });
    console.error("compute_bloom failed:", err);
  });
});

// WebgApp、scene target、compute pass群、入力、frame loopを順に構築します
async function start() {
  // autoDrawSceneを止め、scene -> extract -> blur -> composite -> canvasの順を
  // sample側で明示的に制御します
  app = new WebgApp({
    document,
    autoDrawScene: false,
    frameTiming: true,
    clearColor: [0.03, 0.05, 0.09, 1.0],
    viewAngle: 54.0,
    messageFontTexture: "../../webg/font512.png",
    camera: { target: [0.0, 0.0, 0.0], distance: 14.0, yaw: 28.0, pitch: -12.0 },
    light: {
      mode: "world-node",
      nodeName: "worldLight",
      position: [80.0, 140.0, 120.0],
      attitude: [0.0, 0.0, 0.0],
      type: 1.0
    },
    debugTools: {
      mode: "release",
      system: "compute_bloom",
      source: "samples/compute_bloom/main.js",
      probeDefaultAfterFrames: 1
    }
  });
  await app.init();

  // 操作説明は標準Help panel、現在値はCommandPaletteへ表示します
  const helpLines = buildHelpLines();
  app.showOverlayPanel(buildHelpPanelOptions({
    id: "computeBloomHelp",
    collapsed: true,
    lines: helpLines,
    background: OVERLAY_PANEL_BACKGROUND,
    bodyBackground: OVERLAY_BODY_BACKGROUND
  }));
  lastHelpText = helpLines.join("\n");
  const orbit = app.createOrbitEyeRig({
    target: [0.0, 0.0, 0.0],
    distance: 14.0,
    yaw: 28.0,
    pitch: -12.0,
    minDistance: 6.0,
    maxDistance: 82.0,
    wheelZoomStep: 1.3
  });

  // v2統合pipelineでHDR lightingからBloomとTone Mapまでを接続し、
  // rgba8unorm forward sceneをHDR Bloomへ渡す旧経路を作りません
  const pipeline = new ComputeEffectPipeline(app.getGPU(), {
    label: "compute-bloom",
    width: app.screen.getWidth(),
    height: app.screen.getHeight(),
    lighting: {
      ambient: 0.10,
      directionalIntensity: 1.0
    }
  });
  const bloomDebugViewPass = new BloomDebugViewPass(app.getGPU(), {
    label: "compute-bloom:debug-view",
    width: app.screen.getWidth(),
    height: app.screen.getHeight()
  });
  await Promise.all([pipeline.ready, bloomDebugViewPass.ready]);

  // 最後にcompute outputまたはdebug targetをcanvasへコピーします
  const copyPass = new FullscreenPass(app.getGPU(), { targetFormat: app.getGPU().format });
  await copyPass.init();
  const scene = createScene();
  app.computeBloomScene = scene;
  const state = {
    enabled: true,
    paused: false,
    view: "composite",
    params: { ...DEFAULTS }
  };
  app.computeBloomState = state;

  // effect parameterとdebug viewを初期状態へ戻します
  const reset = () => {
    state.enabled = true;
    state.view = "composite";
    Object.assign(state.params, DEFAULTS);
  };

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
      title: "Compute Bloom",
      pageRows: 5,
      pageRowsByPage: [5, 5, 5],
      closeOnCommand: false,
      titleTapCyclesPage: true,
      resetPageOnOpen: true,
      onChange: (id, value) => {
        const p = state.params;
        if (id === "enabled") state.enabled = value;
        else if (id === "paused") state.paused = value;
        else if (id === "view") state.view = value;
        else if (id === "threshold") p.threshold = value;
        else if (id === "strength") p.strength = value;
        else if (id === "soft-knee") p.softKnee = value;
        else if (id === "exposure") p.exposure = value;
        else if (id === "filter-radius") p.filterRadius = value;
        else if (id === "half-weight") p.halfWeight = value;
        else if (id === "quarter-weight") p.quarterWeight = value;
        else if (id === "eighth-weight") p.eighthWeight = value;
        else if (id === "sixteenth-weight") p.sixteenthWeight = value;
        else if (id === "thirty-second-weight") p.thirtySecondWeight = value;
        refreshAfterControlChange();
      },
      onCommand: (id) => {
        if (id === "reset") reset();
        refreshAfterControlChange();
      },
      commands: [
        // 1ページ目
        { type: "toggle", id: "enabled", label: "Bloom", detail: "on/off", value: () => state.enabled },
        { type: "toggle", id: "paused", label: "Pause", detail: "anim", value: () => state.paused },
        null,
        { id: "palette-next", label: "Next", detail: "page", pageSwitch: true },
        { type: "select", id: "view", label: "View", value: () => state.view, options: [
          { value: "composite", label: "composite" },
          { value: "scene", label: "scene" },
          { value: "extract", label: "extract" },
          { value: "half", label: "half" },
          { value: "quarter", label: "quarter" },
          { value: "eighth", label: "eighth" },
          { value: "sixteenth", label: "sixteenth" },
          { value: "thirty-second", label: "thirty-second" },
          { value: "blur", label: "blur" }
        ] },
        { type: "stepper", id: "threshold", label: "Threshold", value: () => state.params.threshold, min: 0.0, max: BLOOM_THRESHOLD_MAX, step: 0.05, decimals: 2, input: true },
        { type: "stepper", id: "soft-knee", label: "Soft Knee", value: () => state.params.softKnee, min: 0.0, max: 0.95, step: 0.05, decimals: 2, input: true },
        { type: "stepper", id: "strength", label: "Strength", value: () => state.params.strength, min: 0.0, max: 4.0, step: 0.30, decimals: 2, input: true },
        // 2ページ目
        null,
        null,
        null,
        { id: "palette-next", label: "Next", detail: "page", pageSwitch: true },
        { type: "stepper", id: "exposure", label: "Exposure", value: () => state.params.exposure, min: 0.25, max: 3.0, step: 0.10, decimals: 2, input: true },
        { type: "stepper", id: "filter-radius", label: "Filter Radius", value: () => state.params.filterRadius, min: 0.25, max: 3.0, step: 0.25, decimals: 2, input: true },
        { id: "reset", label: "Reset", detail: "params" },
        null,
        null,
        null,
        { type: "stepper", id: "half-weight", label: "1/2 Weight", value: () => state.params.halfWeight, min: 0.0, max: 2.0, step: 0.05, decimals: 2, input: true },
        // 3ページ目
        null,
        null,
        null,
        { id: "palette-next", label: "Next", detail: "page", pageSwitch: true },
        { type: "stepper", id: "quarter-weight", label: "1/4 Weight", value: () => state.params.quarterWeight, min: 0.0, max: 2.0, step: 0.05, decimals: 2, input: true },
        { type: "stepper", id: "eighth-weight", label: "1/8 Weight", value: () => state.params.eighthWeight, min: 0.0, max: 2.0, step: 0.05, decimals: 2, input: true },
        { type: "stepper", id: "sixteenth-weight", label: "1/16 Weight", value: () => state.params.sixteenthWeight, min: 0.0, max: 2.0, step: 0.05, decimals: 2, input: true },
        { type: "stepper", id: "thirty-second-weight", label: "1/32 Weight", value: () => state.params.thirtySecondWeight, min: 0.0, max: 2.0, step: 0.05, decimals: 2, input: true },
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
        const views = ["composite", "scene", "extract", "half", "quarter", "eighth", "sixteenth", "thirty-second", "blur"];
        state.view = views[(views.indexOf(state.view) + 1) % views.length];
      } else if (key === "1") p.threshold = Math.max(0.0, Number((p.threshold - 0.05).toFixed(2)));
      else if (key === "2") p.threshold = Math.min(BLOOM_THRESHOLD_MAX, Number((p.threshold + 0.05).toFixed(2)));
      else if (key === "3") p.strength = Math.max(0.0, p.strength - 0.30);
      else if (key === "4") p.strength = Math.min(4.0, p.strength + 0.30);
      else if (key === "7") p.filterRadius = Math.max(0.25, p.filterRadius - 0.25);
      else if (key === "8") p.filterRadius = Math.min(3.0, p.filterRadius + 0.25);
      else if (key === "q") p.softKnee = Math.max(0.0, p.softKnee - 0.05);
      else if (key === "w") p.softKnee = Math.min(0.95, p.softKnee + 0.05);
      else if (key === "t") p.exposure = Math.max(0.25, p.exposure - 0.10);
      else if (key === "y") p.exposure = Math.min(3.0, p.exposure + 0.10);
      else if (key === " ") state.paused = !state.paused;
      else if (key === "r") reset();
    }
  });
  app.setDiagnosticsStage("runtime");
  app.configureDiagnosticsCapture({
    labelPrefix: "compute_bloom",
    collect: () => {
      const report = app.createProbeReport("runtime-probe");
      Diagnostics.mergeStats(report, {
        view: state.view,
        enabled: state.enabled,
        centerEmissive: scene.centerEmissive.toFixed(3),
        probeLevels: scene.probeLevels.join(","),
        ...state.params
      });
      return report;
    }
  });
  app.configureDebugKeyInput();
  app.start({
    // update phase: target resize、camera、scene animation、Help Panelを更新します
    onUpdate: ({ deltaSec, screen }) => {
      app.afterGpuSubmit();
      updateHelpPanel();
      const width = screen.getWidth();
      const height = screen.getHeight();
      pipeline.resize(width, height);
      bloomDebugViewPass.resize(width, height);
      if (!state.paused) {
        scene.centerEmissiveTime += deltaSec;
        scene.centerEmissive = computeCenterEmissive(scene.centerEmissiveTime);
        scene.centerShape.updateMaterial({
          color: [scene.centerEmissive, scene.centerEmissive, scene.centerEmissive, 1.0]
        });
        scene.rig.rotateY(18.0 * deltaSec);
        scene.center.rotateY(10.0 * deltaSec);
      }
      app.mergeDiagnosticsStats({
        view: state.view,
        enabled: state.enabled,
        centerEmissive: scene.centerEmissive.toFixed(3),
        probeLevels: scene.probeLevels.join(","),
        ...state.params
      });
      app.updateDebugProbe();
    },
    // draw phase 1: 通常の3D sceneをoffscreen targetへ描きます
    onBeforeDraw: ({ cameraFrame }) => {
      app.beginGpuTiming();
      pipeline.renderScene(app.space, cameraFrame, app.clearColor, {
        shadowEnabled: false,
        timestampWrites: app.getGpuRenderTimestampWrites(true, true)
      });
    },
    // draw phase 2:
    // 1. full-resolution bright extract
    // 2. 1/2から1/32まで連続low-pass downsample
    // 3. 最小Levelからtent filterでprogressive upsample
    // 4. 元sceneとのcomposite後、選択中のdebug sourceをcanvasへコピー
    onAfterDraw3d: ({ cameraFrame }) => {
      const p = state.params;
      const debugViewSelected = isBloomDebugView(state.view);

      // scene用Render Passを閉じ、Bloomの全Compute Passを同じcommand encoderへ追加します
      app.getGPU().endPass();
      const finalColor = pipeline.encode(app.getGPU().commandEncoder, {
        cameraFrame,
        shadowEnabled: false,
        ssaoEnabled: false,
        ssrEnabled: false,
        toonEnabled: false,
        dofEnabled: false,
        // 段階別ViewではBloomがOFFでも中間targetを現在frameの内容へ更新します
        // compositeではBloom toggleを尊重し、sceneではBloomを必ず通しません
        bloomEnabled: state.view !== "scene" && (state.enabled || debugViewSelected),
        edgeEnabled: false,
        bloom: {
          threshold: p.threshold,
          softKnee: p.softKnee,
          strength: p.strength,
          halfWeight: p.halfWeight,
          quarterWeight: p.quarterWeight,
          eighthWeight: p.eighthWeight,
          sixteenthWeight: p.sixteenthWeight,
          thirtySecondWeight: p.thirtySecondWeight,
          filterRadius: p.filterRadius
        },
        toneMap: {
          exposure: p.exposure,
          mode: "reinhard",
          saturation: 1.0,
          gamma: 2.2,
          blackBackground: false
        },
        timestampWrites: app.getGpuTimestampWrites(true, true)
      });

      // 統合pipelineの最終出力は表示用rgba8unormですが、段階別targetは線形HDRのrgba16floatです
      // 低解像度の各段階を直接FullscreenPassへ渡さず、画面解像度への拡大と表示変換を明示します
      const presentColor = debugViewSelected
        ? bloomDebugViewPass.encode(
          app.getGPU().commandEncoder,
          getBloomDebugSource(state.view, pipeline.bloomPass),
          { exposure: p.exposure }
        )
        : finalColor;
      app.endGpuTiming(app.getGPU().commandEncoder);

      // V keyで各中間targetを直接表示し、dispatchごとの結果を確認できます
      // Compute Shaderはcanvasへ直接書かず、FullscreenPassで最終表示します
      app.screen.beginPresentPass({ clearColor: app.clearColor, colorLoadOp: "clear" });
      copyPass.draw(presentColor);
      app.screen.clearDepthBuffer();
    }
  });
}
