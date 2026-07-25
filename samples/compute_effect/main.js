// ---------------------------------------------
// samples/compute_effect/main.js  2026/07/25
//   Integrated v2 deferred compute effect pipeline sample
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import WebgApp from "../../webg/WebgApp.js";
import { buildErrorPanelOptions, buildHelpPanelOptions } from "../../webg/OverlayPanelPresets.js";
import Diagnostics from "../../webg/Diagnostics.js";
import CommandPalette, {
  getDefaultCommandPaletteCss
} from "../../webg/CommandPalette.js?v=20260723_viewport_fit";
import FullscreenPass from "../../webg/FullscreenPass.js";
import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";
import ComputeEffectPipeline from "../../webg/ComputeEffectPipeline.js?v=20260723_dof_coverage";
import {
  COMPUTE_BLOOM_DEFAULTS
} from "../../webg/ComputeBloomPass.js?v=20260723_image_pyramid";
import {
  COMPUTE_EDGE_BLEND_MODES
} from "../../webg/ComputeEdgePass.js";

let app = null;
let palette = null;
let pipeline = null;
let copyPass = null;
let lastHelpText = "";
let lastHelpUpdateMs = 0;
let materialShapes = [];
let transparentShapes = [];

const backgroundColors = {
  slate: [0.045, 0.065, 0.09, 1],
  black: [0.0, 0.0, 0.0, 1],
  gray: [0.20, 0.22, 0.25, 1]
};

const directionalColors = {
  white: [1.0, 1.0, 1.0],
  warm: [1.0, 0.78, 0.58],
  cool: [0.58, 0.78, 1.0]
};

const fogColors = {
  blue: [0.08, 0.14, 0.24],
  gray: [0.32, 0.35, 0.38],
  green: [0.08, 0.18, 0.12],
  warm: [0.34, 0.22, 0.14]
};

const vignetteTints = {
  black: [0.0, 0.0, 0.0],
  sepia: [0.34, 0.22, 0.10],
  blue: [0.08, 0.14, 0.28]
};

const DEFAULT_STATE = Object.freeze({
  ssaoEnabled: true,
  shadowEnabled: true,
  ssrEnabled: true,
  fogEnabled: false,
  toonEnabled: false,
  dofEnabled: false,
  bloomEnabled: false,
  edgeEnabled: false,
  vignetteEnabled: false,
  localLightsEnabled: true,
  transparentEnabled: true,
  edgeColorEnabled: false,
  ambientOnly: false,
  paused: false,
  shadowType: "directional",
  composerMode: "mix",
  toneMode: "reinhard",
  directionalColor: "white",
  fogMode: "linear",
  fogColor: "blue",
  vignetteTint: "black",
  background: "slate",
  shadowAmbient: 0.10,
  directIntensity: 1.0,
  objectReflectivity: 0.46,
  exposure: 1.0,
  saturation: 1.0,
  gamma: 2.2,
  toonLevels: 4,
  toonStrength: 1.0,
  toonGamma: 1.0,
  toonFloor: 0.14,
  dofFocusDistance: 26.0,
  dofFocusRange: 7.0,
  dofBlurRadius: 1.0,
  dofCocScale: 1.0,
  bloomThreshold: COMPUTE_BLOOM_DEFAULTS.threshold,
  bloomSoftKnee: COMPUTE_BLOOM_DEFAULTS.softKnee,
  bloomStrength: COMPUTE_BLOOM_DEFAULTS.strength,
  bloomHalfWeight: COMPUTE_BLOOM_DEFAULTS.halfWeight,
  bloomQuarterWeight: COMPUTE_BLOOM_DEFAULTS.quarterWeight,
  bloomEighthWeight: COMPUTE_BLOOM_DEFAULTS.eighthWeight,
  bloomSixteenthWeight: COMPUTE_BLOOM_DEFAULTS.sixteenthWeight,
  bloomThirtySecondWeight: COMPUTE_BLOOM_DEFAULTS.thirtySecondWeight,
  bloomFilterRadius: COMPUTE_BLOOM_DEFAULTS.filterRadius,
  ssaoRadius: 22.0,
  ssaoStrength: 1.55,
  ssaoBias: 0.045,
  ssaoSamples: 12,
  shadowBias: 0.0015,
  shadowNormalBias: 0.003,
  shadowPcfRadius: 1,
  localLightIntensity: 2.2,
  localLightRadius: 9.0,
  ssrIntensity: 0.72,
  ssrDistance: 38.0,
  ssrThickness: 0.42,
  ssrSteps: 48,
  ssrThreshold: 0.05,
  fogNear: 16.0,
  fogFar: 70.0,
  fogDensity: 0.03,
  edgeStrength: 1.0,
  edgeThreshold: 0.16,
  edgeMix: 0.35,
  edgeThickness: 2,
  edgeBlendMode: "black-multiply",
  vignetteRadius: 0.90,
  vignetteSoftness: 0.35,
  vignetteStrength: 0.65,
  vignetteCenterX: 0.50,
  vignetteCenterY: 0.50,
  glassAlpha: 0.38,
  glassRoughness: 0.28
});

const state = { ...DEFAULT_STATE };

const loadAverages = {
  sampleStartedAt: 0,
  samples: [],
  frameMs: null,
  cpuMs: null,
  cpuLoad: null,
  gpuComputeMs: null,
  gpuRenderMs: null,
  gpuTotalMs: null,
  gpuLoad: null
};

// Build the visible control/state lines for the help panel.
function buildHelpLines() {
  const gpuAvailable = app?.frameTimer?.timestampSupported === true;
  const formatMs = (value, digits = 2) => Number.isFinite(value) ? `${value.toFixed(digits)} ms` : "--";
  const formatLoad = (value) => Number.isFinite(value) ? `${value.toFixed(1)}%` : (gpuAvailable ? "--" : "unavailable");
  return [
    "ComputeEffectPipeline experiment",
    "CommandPalette: double tap canvas or press /",
    "Drag: orbit camera",
    `Shadow ${state.shadowEnabled ? state.shadowType : "OFF"} / SSAO ${state.ssaoEnabled ? "ON" : "OFF"} / SSR ${state.ssrEnabled ? "ON" : "OFF"}`,
    `Fog ${state.fogEnabled ? state.fogMode : "OFF"} / Toon ${state.toonEnabled ? state.toonLevels : "OFF"} / DoF ${state.dofEnabled ? "ON" : "OFF"}`,
    `Bloom ${state.bloomEnabled ? "ON" : "OFF"} / Edge ${state.edgeEnabled ? `${state.edgeThickness}px` : "OFF"} / Vignette ${state.vignetteEnabled ? "ON" : "OFF"}`,
    `Local lights ${state.localLightsEnabled ? "ON" : "OFF"} / Glass ${state.transparentEnabled ? state.glassAlpha.toFixed(2) : "OFF"}`,
    `Tone ${state.toneMode} / Exposure ${state.exposure.toFixed(2)} / Background ${state.background}`,
    `Ambient ${state.shadowAmbient.toFixed(2)} / Direct ${state.directIntensity.toFixed(2)} / Reflect ${state.objectReflectivity.toFixed(2)}`,
    `CPU avg ${formatMs(loadAverages.cpuMs)} / ${formatLoad(loadAverages.cpuLoad)}`,
    `GPU compute avg ${formatMs(loadAverages.gpuComputeMs, 3)}`,
    `GPU render avg ${formatMs(loadAverages.gpuRenderMs, 3)}`,
    `GPU total avg ${formatMs(loadAverages.gpuTotalMs, 3)} / ${formatLoad(loadAverages.gpuLoad)}`
  ];
}

// Refresh the help panel only when its text changes.
function updateHelpPanel() {
  const panel = app?.getOverlayPanel?.("computeEffectHelp");
  if (!panel) return;
  const lines = buildHelpLines();
  const nextText = lines.join("\n");
  if (nextText === lastHelpText) return;
  app.updateOverlayPanel("computeEffectHelp", { lines });
  lastHelpText = nextText;
}

// v2 G-bufferはalbedoとsurface materialを別attachmentへ保存します
// SSR反射率とDeferred Lightingの鏡面強度はspecularへ明示し、color alphaへ詰めません
function setMaterial(shape, color, options = {}) {
  const reflectivity = options.reflectivity ?? color[3] ?? 0.0;
  shape.setMaterial("smooth-shader", {
    has_bone: 0,
    use_texture: 0,
    color: [color[0], color[1], color[2], 1.0],
    alpha: options.alpha ?? 1.0,
    ambient: options.ambient ?? 0.0,
    specular: reflectivity,
    roughness: options.roughness,
    metallic: options.metallic,
    power: options.power ?? 32.0,
    emissive: options.emissive ?? 0.0,
    flat_shading: options.flat_shading ?? 0
  });
}

// Create a Shape from a Primitive factory and assign a material that the G-buffer can read.
function createPrimitiveShape(gpu, primitiveFactory, color, options = {}) {
  const shape = new Shape(gpu);
  shape.applyPrimitiveAsset(primitiveFactory(shape.getPrimitiveOptions()));
  shape.endShape();
  setMaterial(shape, color, options);
  if (options.dynamicReflectivity === true) {
    materialShapes.push({ shape, color, options });
  }
  if (options.dynamicTransparency === true) {
    transparentShapes.push({ shape, color, options });
  }
  return shape;
}

// Add a Shape as a scene node with initial transform.
function addShapeNode(name, shape, position, attitude = [0, 0, 0]) {
  const node = app.space.addNode(null, name);
  node.setPosition(...position);
  node.setAttitude(...attitude);
  node.addShape(shape);
  return node;
}

// Build the floor, walls, and reflective objects used by the sample.
function createScene() {
  const gpu = app.getGPU();
  const floor = createPrimitiveShape(
    gpu,
    (options) => Primitive.cuboid(30, 0.8, 26, options),
    [0.28, 0.34, 0.40, 0.78],
    {
      ambient: 0.05,
      power: 64.0,
      reflectivity: 0.68,
      roughness: 0.22,
      metallic: 0.18
    }
  );
  const backWall = createPrimitiveShape(
    gpu,
    (options) => Primitive.cuboid(30, 12, 0.8, options),
    [0.46, 0.50, 0.56, 0.18],
    {
      ambient: 0.04,
      power: 12.0,
      reflectivity: 0.12,
      roughness: 0.72,
      metallic: 0.0
    }
  );
  const sideWall = createPrimitiveShape(
    gpu,
    (options) => Primitive.cuboid(0.8, 12, 24, options),
    [0.38, 0.28, 0.24, 0.18],
    {
      ambient: 0.02,
      power: 10.0,
      reflectivity: 0.08,
      roughness: 0.78,
      metallic: 0.0
    }
  );
  const cube = createPrimitiveShape(
    gpu,
    (options) => Primitive.cube(4.0, options),
    [0.94, 0.34, 0.12, 0.34],
    {
      ambient: 0.0,
      power: 34.0,
      reflectivity: state.objectReflectivity,
      roughness: 0.34,
      metallic: 0.06,
      dynamicReflectivity: true
    }
  );
  const sphere = createPrimitiveShape(
    gpu,
    (options) => Primitive.sphere(2.2, 32, 22, options),
    [0.12, 0.62, 0.88, 0.76],
    {
      ambient: 0.0,
      power: 42.0,
      reflectivity: state.objectReflectivity,
      roughness: 0.20,
      metallic: 0.12,
      dynamicReflectivity: true
    }
  );
  const pillar = createPrimitiveShape(
    gpu,
    (options) => Primitive.cuboid(3.2, 6.0, 3.2, options),
    [0.22, 0.76, 0.40, 0.32],
    {
      ambient: 0.0,
      power: 28.0,
      reflectivity: state.objectReflectivity,
      roughness: 0.42,
      metallic: 0.0,
      dynamicReflectivity: true
    }
  );
  const smallCube = createPrimitiveShape(
    gpu,
    (options) => Primitive.cube(2.5, options),
    [0.96, 0.78, 0.20, 0.46],
    {
      ambient: 0.0,
      power: 36.0,
      reflectivity: state.objectReflectivity,
      roughness: 0.30,
      metallic: 0.08,
      dynamicReflectivity: true
    }
  );
  const torus = createPrimitiveShape(
    gpu,
    (options) => Primitive.donut(1.4, 0.38, 32, 16, options),
    [0.70, 0.22, 0.92, 0.58],
    {
      ambient: 0.0,
      power: 48.0,
      reflectivity: state.objectReflectivity,
      roughness: 0.25,
      metallic: 0.32,
      dynamicReflectivity: true
    }
  );
  const glassSphere = createPrimitiveShape(
    gpu,
    (options) => Primitive.sphere(2.8, 32, 22, options),
    [0.42, 0.78, 0.96, 1.0],
    {
      ambient: 0.1,
      reflectivity: 0.72,
      roughness: state.glassRoughness,
      metallic: 0.2,
      roughness: 0.01,
      alpha: state.glassAlpha,
      dynamicTransparency: true
    }
  );

  addShapeNode("floor", floor, [0, -3.4, -2]);
  addShapeNode("back-wall", backWall, [0, 1.7, -14.6]);
  addShapeNode("side-wall", sideWall, [-14.6, 1.7, -2.2]);
  const movingCube = addShapeNode("orange-cube", cube, [-4.4, -1.0, -4.8], [0, 24, 0]);
  const movingSphere = addShapeNode("blue-sphere", sphere, [0.4, -0.8, -3.6]);
  const movingPillar = addShapeNode("green-pillar", pillar, [5.0, 0.0, -7.0], [0, -18, 0]);
  const movingSmallCube = addShapeNode("yellow-cube", smallCube, [4.4, -2.15, 1.7], [0, 30, 0]);
  const movingTorus = addShapeNode("violet-torus", torus, [-6.8, 0.4, 0.0], [90, 0, 0]);
  const movingGlass = addShapeNode("glass-sphere", glassSphere, [7.4, 0.2, -0.8]);
  return [movingCube, movingSphere, movingPillar, movingSmallCube, movingTorus, movingGlass];
}

// Deferred Lightingのpoint / cone Local Lightを、Paletteの共通強度と半径から作る。
function buildLocalLights() {
  if (!state.localLightsEnabled || state.ambientOnly) return [];
  return [
    {
      type: "point",
      position: [-4.2, 3.2, 1.0],
      color: [1.0, 0.24, 0.10],
      radius: state.localLightRadius,
      intensity: state.localLightIntensity
    },
    {
      type: "cone",
      position: [6.5, 5.8, 3.5],
      direction: [-0.35, -0.55, -1.0],
      color: [0.16, 0.48, 1.0],
      radius: state.localLightRadius * 1.25,
      intensity: state.localLightIntensity * 1.15,
      innerAngle: 34,
      outerAngle: 58
    }
  ];
}

// Pass設定の階層をF9+MのCurrent Stateで1行ずつ読めるkeyへ変換する
// 配列は方向・色・座標のまとまりを壊さないようJSON表記の1値として残す
function flattenPassSettings(target, prefix, value) {
  if (Array.isArray(value)) {
    target[prefix] = JSON.stringify(value);
    return;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    for (const key of keys) {
      flattenPassSettings(target, `${prefix}.${key}`, value[key]);
    }
    return;
  }
  target[prefix] = value === null ? "null" : value;
}

// ComputeEffectPipelineへこのframeで渡す実効値と、指定を省略している既定値をPass別に集約する
// 無効なPassも設定値を残し、ONへ切り替えた時にどの値で動くかをF9+Mだけで判断できるようにする
function buildPassDiagnosticsStats() {
  if (!pipeline) return {};
  const shadow = {
    ...pipeline.shadowOptions,
    type: state.shadowType,
    bias: state.shadowBias,
    normalBias: state.shadowNormalBias,
    pcfRadius: state.shadowPcfRadius
  };
  const ssao = {
    ...pipeline.ssaoOptions,
    enabled: state.ssaoEnabled,
    radius: state.ssaoRadius,
    strength: state.ssaoStrength,
    bias: state.ssaoBias,
    samples: state.ssaoSamples
  };
  const ssr = {
    ...pipeline.ssrOptions,
    enabled: state.ssrEnabled,
    intensity: state.ssrIntensity,
    distance: state.ssrDistance,
    thickness: state.ssrThickness,
    steps: state.ssrSteps,
    reflectivityThreshold: state.ssrThreshold,
    view: "reflection"
  };
  const lighting = {
    ...pipeline.lightingOptions,
    ambient: state.ambientOnly ? 1.0 : state.shadowAmbient,
    directionalColor: directionalColors[state.directionalColor],
    directionalIntensity: state.ambientOnly ? 0.0 : state.directIntensity,
    spotColor: directionalColors[state.directionalColor],
    spotIntensity: state.ambientOnly ? 0.0 : state.directIntensity
  };
  const fog = {
    ...pipeline.fogOptions,
    enabled: state.fogEnabled,
    mode: state.fogMode,
    color: fogColors[state.fogColor],
    near: state.fogNear,
    far: state.fogFar,
    density: state.fogDensity
  };
  const toon = {
    ...pipeline.toonOptions,
    enabled: state.toonEnabled,
    levels: state.toonLevels,
    strength: state.toonStrength,
    gamma: state.toonGamma,
    floor: state.toonFloor
  };
  const dof = {
    ...pipeline.dofOptions,
    enabled: state.dofEnabled,
    focusDistance: state.dofFocusDistance,
    focusRange: state.dofFocusRange,
    blurRadius: state.dofBlurRadius,
    cocScale: state.dofCocScale,
    halfWidth: pipeline.dofPass.getHalfTarget().getWidth(),
    halfHeight: pipeline.dofPass.getHalfTarget().getHeight(),
    quarterWidth: pipeline.dofPass.getQuarterTarget().getWidth(),
    quarterHeight: pipeline.dofPass.getQuarterTarget().getHeight(),
    eighthWidth: pipeline.dofPass.getEighthTarget().getWidth(),
    eighthHeight: pipeline.dofPass.getEighthTarget().getHeight(),
    sixteenthWidth: pipeline.dofPass.getSixteenthTarget().getWidth(),
    sixteenthHeight: pipeline.dofPass.getSixteenthTarget().getHeight()
  };
  const bloom = {
    ...pipeline.bloomOptions,
    enabled: state.bloomEnabled,
    threshold: state.bloomThreshold,
    strength: state.bloomStrength,
    softKnee: state.bloomSoftKnee,
    halfWeight: state.bloomHalfWeight,
    quarterWeight: state.bloomQuarterWeight,
    eighthWeight: state.bloomEighthWeight,
    sixteenthWeight: state.bloomSixteenthWeight,
    thirtySecondWeight: state.bloomThirtySecondWeight,
    filterRadius: state.bloomFilterRadius
  };
  const toneMap = {
    ...pipeline.toneMapOptions,
    enabled: true,
    mode: state.toneMode,
    exposure: state.exposure,
    saturation: state.saturation,
    gamma: state.gamma,
    blackBackground: state.background === "black"
  };
  const edge = {
    ...pipeline.edgeOptions,
    enabled: state.edgeEnabled,
    geometryEnabled: true,
    colorEnabled: state.edgeColorEnabled,
    strength: state.edgeStrength,
    threshold: state.edgeThreshold,
    mix: state.edgeMix,
    blendMode: state.edgeBlendMode,
    thickness: state.edgeThickness
  };
  const vignette = {
    ...pipeline.vignetteOptions,
    enabled: state.vignetteEnabled,
    center: [state.vignetteCenterX, state.vignetteCenterY],
    radius: state.vignetteRadius,
    softness: state.vignetteSoftness,
    strength: state.vignetteStrength,
    tint: vignetteTints[state.vignetteTint]
  };
  const localLights = buildLocalLights();
  const transparency = {
    ...pipeline.transparencyOptions,
    enabled: state.transparentEnabled,
    width: pipeline.transparencyPass.width,
    height: pipeline.transparencyPass.height,
    frostHalfWidth: pipeline.transparencyPass.frostPyramid.getLevel(2).getWidth(),
    frostHalfHeight: pipeline.transparencyPass.frostPyramid.getLevel(2).getHeight(),
    frostQuarterWidth: pipeline.transparencyPass.frostPyramid.getLevel(4).getWidth(),
    frostQuarterHeight: pipeline.transparencyPass.frostPyramid.getLevel(4).getHeight(),
    frostEighthWidth: pipeline.transparencyPass.frostPyramid.getLevel(8).getWidth(),
    frostEighthHeight: pipeline.transparencyPass.frostPyramid.getLevel(8).getHeight(),
    materialAlpha: state.glassAlpha,
    materialRoughness: state.glassRoughness
  };
  const passSettings = {
    geometryBufferPass: {
      enabled: true,
      width: pipeline.gbuffer.width,
      height: pipeline.gbuffer.height,
      colorMode: pipeline.gbuffer.colorMode,
      normalSpace: pipeline.gbuffer.normalSpace
    },
    directionalShadowMapPass: {
      enabled: state.shadowEnabled && !state.ambientOnly && state.shadowType === "directional",
      width: pipeline.directionalShadowMap.width,
      height: pipeline.directionalShadowMap.height,
      light: pipeline.lightOptions,
      directional: shadow.directional
    },
    spotShadowMapPass: {
      enabled: state.shadowEnabled && !state.ambientOnly && state.shadowType === "spot",
      width: pipeline.spotShadowMap.width,
      height: pipeline.spotShadowMap.height,
      spot: shadow.spot
    },
    directionalShadowPass: {
      enabled: state.shadowEnabled && !state.ambientOnly && state.shadowType === "directional",
      bias: shadow.bias,
      normalBias: shadow.normalBias,
      pcfRadius: shadow.pcfRadius
    },
    spotShadowPass: {
      enabled: state.shadowEnabled && !state.ambientOnly && state.shadowType === "spot",
      bias: shadow.bias,
      normalBias: shadow.normalBias,
      pcfRadius: shadow.pcfRadius,
      innerAngle: shadow.spot.innerAngle,
      outerAngle: shadow.spot.outerAngle
    },
    ssaoPass: ssao,
    deferredLightingPass: {
      enabled: true,
      ...lighting,
      maxLights: pipeline.deferredLightingPass.maxLights,
      localLightsEnabled: state.localLightsEnabled && !state.ambientOnly,
      localLightCount: localLights.length,
      localLights,
      view: "lighting"
    },
    ssrPass: ssr,
    composerPass: {
      enabled: state.ssrEnabled,
      ...pipeline.composerOptions,
      mode: state.composerMode
    },
    transparencyPass: transparency,
    fogPass: fog,
    toonPass: toon,
    dofPass: dof,
    bloomPass: bloom,
    toneMapPass: toneMap,
    edgePass: edge,
    vignettePass: vignette
  };
  const stats = {};
  for (const [passName, settings] of Object.entries(passSettings)) {
    flattenPassSettings(stats, `pass.${passName}`, settings);
  }
  return stats;
}

// 0.5秒分のFrameTimer値を蓄積し、Help Panelに出す平均値だけを一定間隔で更新する。
// 瞬間値を毎フレーム表示すると読み取りにくいため、表示更新と平均期間をここで明示的にそろえる。
function updateLoadAverages(timeMs) {
  const timer = app?.frameTimer;
  if (!timer) return;
  if (loadAverages.sampleStartedAt === 0) {
    loadAverages.sampleStartedAt = timeMs;
  }
  loadAverages.samples.push({
    frameMs: timer.frameIntervalMs,
    cpuMs: timer.jsTimeMs,
    cpuLoad: timer.jsLoadPercent,
    gpuComputeMs: timer.gpuComputeMs,
    gpuRenderMs: timer.gpuRenderMs
  });
  if (timeMs - loadAverages.sampleStartedAt < 500) return;

  // `finiteAverage`は座標または数値を計算し、後続処理で使う結果を返す
  const finiteAverage = (name) => {
    const values = loadAverages.samples
      .map((sample) => sample[name])
      .filter((value) => Number.isFinite(value));
    if (values.length === 0) return null;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  };

  loadAverages.frameMs = finiteAverage("frameMs");
  loadAverages.cpuMs = finiteAverage("cpuMs");
  loadAverages.cpuLoad = finiteAverage("cpuLoad");
  loadAverages.gpuComputeMs = finiteAverage("gpuComputeMs");
  loadAverages.gpuRenderMs = finiteAverage("gpuRenderMs");
  const gpuCompute = loadAverages.gpuComputeMs ?? 0;
  const gpuRender = loadAverages.gpuRenderMs ?? 0;
  loadAverages.gpuTotalMs = Number.isFinite(loadAverages.gpuComputeMs) ||
    Number.isFinite(loadAverages.gpuRenderMs)
    ? gpuCompute + gpuRender
    : null;
  loadAverages.gpuLoad = Number.isFinite(loadAverages.gpuTotalMs) &&
    Number.isFinite(loadAverages.frameMs) &&
    loadAverages.frameMs > 0
    ? loadAverages.gpuTotalMs / loadAverages.frameMs * 100
    : null;
  loadAverages.samples = [];
  loadAverages.sampleStartedAt = timeMs;
}

// Palette操作後に、反射率を変えるShape、Help Panel、描画予約をまとめて同期する。
function refreshAfterControlChange() {
  for (const item of materialShapes) {
    setMaterial(item.shape, item.color, {
      ...item.options,
      reflectivity: state.objectReflectivity
    });
  }
  for (const item of transparentShapes) {
    item.shape.hide(!state.transparentEnabled);
    setMaterial(item.shape, item.color, {
      ...item.options,
      alpha: state.glassAlpha,
      roughness: state.glassRoughness
    });
  }
  palette?.render();
  updateHelpPanel();
  app?.requestRender();
}

// 単発button系commandを状態変更へ変換する。
// stepper/select/toggleはonChange側で処理し、ここではmode switchとresetだけを担当する。
function handleCommand(id) {
  if (id === "reset") Object.assign(state, DEFAULT_STATE);
  refreshAfterControlChange();
}

// compute effect全体をCommandPaletteで操作するためのUIを作る。
// スマホではダブルタップ、PCでは`/`でも開けるため、旧touch button群を置き換えられる。
function createPalette() {
  const toggle = (id, label, detail) => ({
    type: "toggle", id, label, detail, value: () => state[id]
  });
  const stepper = (id, label, min, max, step, decimals = undefined) => ({
    type: "stepper",
    id,
    label,
    value: () => state[id],
    min,
    max,
    step,
    input: true,
    ...(Number.isFinite(decimals) ? { decimals } : {})
  });
  const select = (id, label, values) => ({
    type: "select",
    id,
    label,
    value: () => state[id],
    options: values.map((value) => ({ value, label: value }))
  });
  const next = () => ({
    id: "palette-next", label: "Next", detail: "page", pageSwitch: true
  });
  // 各pageは、1行目に3つのbutton枠と右端Nextを置き、その下へ全幅controlを並べる
  // pageRowsByPageへ実際の行数を明示し、設定数が異なるpage同士を確実に分離する
  const commandPages = [
    [
      toggle("shadowEnabled", "Shadow", "map"),
      toggle("ssaoEnabled", "SSAO", "AO"),
      toggle("ssrEnabled", "SSR", "reflect"),
      next(),
      select("shadowType", "Shadow Type", ["directional", "spot"]),
      stepper("shadowAmbient", "Ambient", 0.0, 0.50, 0.01),
      stepper("directIntensity", "Direct Intensity", 0.0, 3.0, 0.05),
      select("directionalColor", "Light Color", Object.keys(directionalColors)),
      stepper("objectReflectivity", "Reflectivity", 0.0, 1.0, 0.05),
      select("composerMode", "SSR Composer", ["mix", "add"]),
      select("toneMode", "Tone Map", ["reinhard", "linear"]),
      stepper("exposure", "Exposure", 0.1, 4.0, 0.05),
      select("background", "Background", Object.keys(backgroundColors))
    ],
    [
      toggle("toonEnabled", "Toon", "bands"),
      toggle("dofEnabled", "DoF", "focus"),
      null,
      next(),
      stepper("toonLevels", "Toon Levels", 2, 16, 1),
      stepper("toonStrength", "Toon Strength", 0.0, 1.0, 0.05),
      stepper("toonGamma", "Toon Gamma", 0.1, 4.0, 0.05),
      stepper("toonFloor", "Toon Floor", 0.0, 1.0, 0.02),
      stepper("dofFocusDistance", "DoF Focus", 1.0, 80.0, 1.0),
      stepper("dofFocusRange", "DoF Range", 0.5, 30.0, 0.5),
      stepper("dofBlurRadius", "DoF Blur Radius", 0.25, 3.0, 0.25, 2),
      stepper("dofCocScale", "DoF CoC Scale", 0.0, 2.0, 0.10)
    ],
    [
      toggle("ambientOnly", "Ambient Only", "light"),
      toggle("localLightsEnabled", "Local Lights", "point"),
      toggle("transparentEnabled", "Glass", "alpha"),
      next(),
      stepper("ssaoRadius", "SSAO Radius", 1.0, 60.0, 1.0),
      stepper("ssaoStrength", "SSAO Strength", 0.0, 4.0, 0.05),
      stepper("ssaoBias", "SSAO Bias", 0.0, 0.25, 0.005),
      stepper("ssaoSamples", "SSAO Samples", 4, 16, 1),
      stepper("shadowBias", "Shadow Bias", 0.0, 0.02, 0.0005),
      stepper("shadowNormalBias", "Shadow Normal Bias", 0.0, 0.03, 0.0005),
      stepper("shadowPcfRadius", "Shadow PCF", 0, 3, 1),
      stepper("localLightIntensity", "Local Intensity", 0.0, 8.0, 0.1),
      stepper("localLightRadius", "Local Radius", 1.0, 24.0, 0.5)
    ],
    [
      toggle("fogEnabled", "Fog", "depth"),
      toggle("edgeEnabled", "Edge", "outline"),
      toggle("vignetteEnabled", "Vignette", "final"),
      next(),
      stepper("ssrIntensity", "SSR Intensity", 0.0, 1.5, 0.05),
      stepper("ssrDistance", "SSR Distance", 1.0, 80.0, 1.0),
      stepper("ssrThickness", "SSR Thickness", 0.05, 2.0, 0.05),
      stepper("ssrSteps", "SSR Steps", 12, 64, 4),
      stepper("ssrThreshold", "SSR Threshold", 0.0, 1.0, 0.01),
      select("fogMode", "Fog Mode", ["linear", "exp"]),
      select("fogColor", "Fog Color", Object.keys(fogColors)),
      stepper("fogNear", "Fog Near", 0.0, 100.0, 1.0),
      stepper("fogFar", "Fog Far", 1.0, 160.0, 1.0)
    ],
    [
      toggle("edgeColorEnabled", "Color Edge", "Sobel"),
      toggle("paused", "Pause", "motion"),
      { id: "reset", label: "Reset", detail: "all" },
      next(),
      stepper("fogDensity", "Fog Density", 0.0, 0.20, 0.005),
      stepper("edgeStrength", "Edge Strength", 0.0, 4.0, 0.05),
      stepper("edgeThreshold", "Edge Threshold", 0.0, 1.0, 0.01),
      stepper("edgeMix", "Edge Mix", 0.0, 1.0, 0.05),
      stepper("edgeThickness", "Edge Thickness", 1, 4, 1),
      select("edgeBlendMode", "Edge Blend", COMPUTE_EDGE_BLEND_MODES),
      stepper("vignetteRadius", "Vignette Radius", 0.1, 1.5, 0.05),
      stepper("vignetteSoftness", "Vignette Softness", 0.05, 1.5, 0.05),
      stepper("vignetteStrength", "Vignette Strength", 0.0, 1.0, 0.05)
    ],
    [
      { id: "reset", label: "Reset", detail: "all" },
      null,
      null,
      next(),
      select("vignetteTint", "Vignette Tint", Object.keys(vignetteTints)),
      stepper("vignetteCenterX", "Vignette Center X", 0.0, 1.0, 0.05),
      stepper("vignetteCenterY", "Vignette Center Y", 0.0, 1.0, 0.05),
      stepper("saturation", "Saturation", 0.0, 3.0, 0.05),
      stepper("gamma", "Gamma", 0.5, 4.0, 0.05),
      stepper("glassAlpha", "Glass Alpha", 0.05, 0.95, 0.05),
      stepper("glassRoughness", "Glass Roughness", 0.04, 1.0, 0.04)
    ],
    [
      toggle("bloomEnabled", "Bloom", "glow"),
      null,
      null,
      next(),
      stepper("bloomThreshold", "Bloom Threshold", 0.0, 4.0, 0.05, 2),
      stepper("bloomStrength", "Bloom Strength", 0.0, 4.0, 0.30, 2),
      stepper("bloomSoftKnee", "Bloom Soft Knee", 0.0, 0.95, 0.05, 2),
      stepper("bloomFilterRadius", "Filter Radius", 0.25, 3.0, 0.25, 2)
    ],
    [
      toggle("bloomEnabled", "Bloom", "glow"),
      null,
      null,
      next(),
      stepper("bloomHalfWeight", "1/2 Weight", 0.0, 2.0, 0.05, 2),
      stepper("bloomQuarterWeight", "1/4 Weight", 0.0, 2.0, 0.05, 2),
      stepper("bloomEighthWeight", "1/8 Weight", 0.0, 2.0, 0.05, 2),
      stepper("bloomSixteenthWeight", "1/16 Weight", 0.0, 2.0, 0.05, 2),
      stepper("bloomThirtySecondWeight", "1/32 Weight", 0.0, 2.0, 0.05, 2)
    ]
  ];
  palette = new CommandPalette({
    document,
    container: document.body,
    viewport: app.screen.canvas,
    title: "Compute Effects",
    pageRows: 10,
    pageRowsByPage: [10, 9, 10, 10, 10, 8, 5, 6],
    closeOnCommand: false,
    onCommand: handleCommand,
    onChange: (id, value) => {
      if (Object.prototype.hasOwnProperty.call(state, id)) {
        state[id] = value;
      }
      if (id === "fogNear" && state.fogNear >= state.fogFar) {
        state.fogFar = state.fogNear + 1.0;
      } else if (id === "fogFar" && state.fogFar <= state.fogNear) {
        state.fogNear = Math.max(0.0, state.fogFar - 1.0);
      } else if (id === "vignetteRadius" && state.vignetteSoftness > state.vignetteRadius) {
        state.vignetteSoftness = state.vignetteRadius;
      } else if (id === "vignetteSoftness" && state.vignetteSoftness > state.vignetteRadius) {
        state.vignetteRadius = state.vignetteSoftness;
      }
      refreshAfterControlChange();
    },
    commands: commandPages.flat()
  });
  palette.attachToCanvas(app.screen.canvas, { key: "/" });
  palette.setStyle(getDefaultCommandPaletteCss());
}

// Start after the document is ready and surface startup errors in the overlay.
document.addEventListener("DOMContentLoaded", () => {
  start().catch((err) => {
    app?.setDiagnosticsReport?.(Diagnostics.createErrorReport(err, {
      system: "compute_effect",
      source: "samples/compute_effect/main.js"
    }));
    app?.showOverlayPanel?.(buildErrorPanelOptions(err, {
      title: "compute_effect failed",
      id: "start-error"
    }));
    console.error("compute_effect failed:", err);
  });
});

// Initialize WebGPU, the scene, and the experimental high-level effect pipeline.
async function start() {
  app = new WebgApp({
    document,
    autoDrawScene: false,
    renderMode: "ondemand",
    frameTiming: true,
    clearColor: backgroundColors[state.background],
    viewAngle: 52,
    projectionFar: 120,
    messageFontTexture: "../../webg/font512.png",
    camera: {
      target: [0, -0.7, -4.0],
      distance: 27,
      yaw: 24,
      pitch: -13
    },
    debugTools: {
      mode: "release",
      system: "compute_effect",
      source: "samples/compute_effect/main.js",
      probeDefaultAfterFrames: 1
    }
  });
  await app.init();

  const helpLines = buildHelpLines();
  app.showOverlayPanel(buildHelpPanelOptions({
    id: "computeEffectHelp",
    collapsed: true,
    lines: helpLines
  }));
  lastHelpText = helpLines.join("\n");

  const orbit = app.createOrbitEyeRig({
    target: [0, -0.7, -4.0],
    distance: 27,
    yaw: 24,
    pitch: -13,
    minDistance: 15,
    maxDistance: 48,
    wheelZoomStep: 1
  });
  const movingNodes = createScene();
  // 全Compute Passのshader初期化には時間がかかるため、Paletteは先に表示可能にする。
  // 準備中に変更したstateも、app.start()後の最初のframeからそのまま反映される。
  app.computeEffectState = state;
  createPalette();
  refreshAfterControlChange();
  const gpu = app.getGPU();
  gpu.device.addEventListener("uncapturederror", (event) => {
    console.error("compute_effect WebGPU validation:", event.error?.message ?? event.error);
  });
  pipeline = new ComputeEffectPipeline(gpu, {
    width: app.screen.getWidth(),
    height: app.screen.getHeight(),
    // G-bufferは未照明albedo・view-space normal・surface materialを保存し、
    // directional lightとambientはDeferredLightingPassで一度だけ評価します
    lighting: {
      ambient: state.shadowAmbient,
      directionalIntensity: state.directIntensity
    },
    composer: {
      mode: state.composerMode
    },
    toneMap: {
      mode: state.toneMode,
      exposure: state.exposure,
      saturation: state.saturation,
      gamma: state.gamma,
      blackBackground: state.background === "black"
    },
    toon: {
      // 真っ黒は避けつつ、暗部の帯が2段階に潰れないようfloorも控えめにする
      floor: 0.14
    }
  });
  copyPass = new FullscreenPass(gpu);
  await Promise.all([pipeline.ready, copyPass.init()]);

  app.setDiagnosticsStage("runtime");
  app.configureDebugKeyInput();
  app.start({
    // Update input, animation, Help Panel, and diagnostics once per frame.
    onUpdate: ({ deltaSec, screen, timeMs }) => {
      app.afterGpuSubmit();
      updateLoadAverages(timeMs);
      if (timeMs - lastHelpUpdateMs >= 500) {
        updateHelpPanel();
        lastHelpUpdateMs = timeMs;
      }
      if (!state.paused) {
        movingNodes[0].rotateY(18 * deltaSec);
        movingNodes[1].rotateY(-12 * deltaSec);
        movingNodes[2].rotateY(10 * deltaSec);
        movingNodes[3].rotateX(15 * deltaSec);
        movingNodes[3].rotateY(22 * deltaSec);
        movingNodes[4].rotateZ(20 * deltaSec);
        movingNodes[5].rotateY(-16 * deltaSec);
      }
      // Pipeline側で寸法変化を判定し、同じサイズではGPU resourceを維持します
      pipeline.resize(screen.getWidth(), screen.getHeight());
      app.clearColor = backgroundColors[state.background];
      app.mergeDiagnosticsStats({
        ssao: state.ssaoEnabled ? "on" : "off",
        shadow: state.shadowEnabled ? "on" : "off",
        ssr: state.ssrEnabled ? "on" : "off",
        fog: state.fogEnabled ? state.fogMode : "off",
        toon: state.toonEnabled ? "on" : "off",
        toonLevels: String(state.toonLevels),
        dof: state.dofEnabled ? "on" : "off",
        bloom: state.bloomEnabled ? "on" : "off",
        edge: state.edgeEnabled ? "on" : "off",
        edgeThickness: String(state.edgeThickness),
        edgeBlend: state.edgeBlendMode,
        vignette: state.vignetteEnabled ? "on" : "off",
        glass: state.transparentEnabled ? state.glassAlpha.toFixed(2) : "off",
        localLights: state.localLightsEnabled ? "on" : "off",
        lighting: state.ambientOnly ? "ambient" : "full",
        composer: state.composerMode,
        tone: state.toneMode,
        exposure: state.exposure.toFixed(2),
        saturation: state.saturation.toFixed(2),
        gamma: state.gamma.toFixed(2),
        background: state.background,
        // F9+Mでdebug dockを開いた時だけ全Pass設定を展開し、通常描画時の文字列生成を避ける
        ...(app.getDebugMode() === "debug" ? buildPassDiagnosticsStats() : {})
      });
      app.updateDebugProbe();
    },
    // Prepare Shadow Map and G-buffer before the screen copy pass.
    onBeforeDraw: ({ cameraFrame }) => {
      app.beginGpuTiming();
      pipeline.renderScene(
        app.space,
        cameraFrame,
        app.clearColor,
        {
          shadowEnabled: state.shadowEnabled && !state.ambientOnly,
          shadow: {
            type: state.shadowType,
            bias: state.shadowBias,
            normalBias: state.shadowNormalBias,
            pcfRadius: state.shadowPcfRadius
          },
          timestampWrites: app.getGpuRenderTimestampWrites(true, true)
        }
      );
    },
    // Run compute effects after 3D rendering and copy the composed result.
    onAfterDraw3d: ({ cameraFrame }) => {
      gpu.endPass();

      const finalColor = pipeline.encode(gpu.commandEncoder, {
        cameraFrame,
        ssaoEnabled: state.ssaoEnabled,
        shadowEnabled: state.shadowEnabled && !state.ambientOnly,
        ssrEnabled: state.ssrEnabled,
        toonEnabled: state.toonEnabled,
        dofEnabled: state.dofEnabled,
        bloomEnabled: state.bloomEnabled,
        edgeEnabled: state.edgeEnabled,
        fogEnabled: state.fogEnabled,
        vignetteEnabled: state.vignetteEnabled,
        shadow: {
          type: state.shadowType,
          bias: state.shadowBias,
          normalBias: state.shadowNormalBias,
          pcfRadius: state.shadowPcfRadius
        },
        ssao: {
          radius: state.ssaoRadius,
          strength: state.ssaoStrength,
          bias: state.ssaoBias,
          samples: state.ssaoSamples
        },
        ssr: {
          intensity: state.ssrIntensity,
          distance: state.ssrDistance,
          thickness: state.ssrThickness,
          steps: state.ssrSteps,
          reflectivityThreshold: state.ssrThreshold
        },
        toon: {
          levels: state.toonLevels,
          strength: state.toonStrength,
          gamma: state.toonGamma,
          floor: state.toonFloor
        },
        dof: {
          focusDistance: state.dofFocusDistance,
          focusRange: state.dofFocusRange,
          blurRadius: state.dofBlurRadius,
          cocScale: state.dofCocScale
        },
        bloom: {
          threshold: state.bloomThreshold,
          strength: state.bloomStrength,
          softKnee: state.bloomSoftKnee,
          halfWeight: state.bloomHalfWeight,
          quarterWeight: state.bloomQuarterWeight,
          eighthWeight: state.bloomEighthWeight,
          sixteenthWeight: state.bloomSixteenthWeight,
          thirtySecondWeight: state.bloomThirtySecondWeight,
          filterRadius: state.bloomFilterRadius
        },
        fog: {
          mode: state.fogMode,
          color: fogColors[state.fogColor],
          near: state.fogNear,
          far: state.fogFar,
          density: state.fogDensity
        },
        edgeGeometryEnabled: true,
        edge: {
          colorEnabled: state.edgeColorEnabled,
          strength: state.edgeStrength,
          threshold: state.edgeThreshold,
          mix: state.edgeMix,
          blendMode: state.edgeBlendMode,
          thickness: state.edgeThickness
        },
        vignette: {
          center: [state.vignetteCenterX, state.vignetteCenterY],
          radius: state.vignetteRadius,
          softness: state.vignetteSoftness,
          strength: state.vignetteStrength,
          tint: vignetteTints[state.vignetteTint]
        },
        lighting: {
          ambient: state.ambientOnly ? 1.0 : state.shadowAmbient,
          directionalColor: directionalColors[state.directionalColor],
          spotColor: directionalColors[state.directionalColor],
          directionalIntensity: state.ambientOnly ? 0.0 : state.directIntensity,
          spotIntensity: state.ambientOnly ? 0.0 : state.directIntensity
        },
        lights: buildLocalLights(),
        composer: {
          mode: state.composerMode
        },
        toneMap: {
          mode: state.toneMode,
          exposure: state.exposure,
          saturation: state.saturation,
          gamma: state.gamma,
          blackBackground: state.background === "black"
        },
        timestampWrites: app.getGpuTimestampWrites(true, true)
      });

      app.endGpuTiming(gpu.commandEncoder);
      app.screen.beginPresentPass({
        clearColor: app.clearColor,
        colorLoadOp: "clear"
      });
      copyPass.draw(finalColor);
      // FullscreenPassはdepthなしpresentation passだけを許可します
      // WebgAppがこの後に描くFont/HUDはdepth32float pipelineなので、colorを保持したまま
      // Camera Reverse-Z depth付きpassを開き直し、attachment不一致でframe全体が無効になるのを防ぎます
      app.screen.clearDepthBuffer();
    }
  });

  // Stop drawing and release GPU resources when the page goes away.
  window.addEventListener("pagehide", () => {
    app.stop();
    copyPass.destroy?.();
    pipeline.destroy();
  }, { once: true });
}
