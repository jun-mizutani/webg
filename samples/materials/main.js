// ---------------------------------------------
// samples/materials/main.js  2026/07/25
//   SmoothShader / Deferred Lighting material comparison
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

'use strict';

import WebgApp from "../../webg/WebgApp.js";
import CommandPalette, {
  getDefaultCommandPaletteCss
} from "../../webg/CommandPalette.js";
import ComputeEffectPipeline from "../../webg/ComputeEffectPipeline.js";
import Diagnostics from "../../webg/Diagnostics.js";
import FullscreenPass from "../../webg/FullscreenPass.js";
import {
  buildErrorPanelOptions,
  buildHelpPanelOptions
} from "../../webg/OverlayPanelPresets.js";
import Shape from "../../webg/Shape.js";
import util from "../../webg/util.js";

const GRID_SIZE = 4;
const SPHERE_RADIUS = 1.25;
const GRID_SPACING = 3.05;
const LIGHT_POSITION = Object.freeze([4.5, 8.0, 13.0]);

// 行方向では、Deferred Lightingが読むroughnessとSmoothShaderが読むpowerを同時に変える。
// ここにある値を初期基準とし、Paletteの値を動かすと4行全体が同じ差を保って移動する。
const GRID_ROWS = Object.freeze([
  Object.freeze({ roughness: 0.08, power: 128.0 }),
  Object.freeze({ roughness: 0.28, power: 48.0 }),
  Object.freeze({ roughness: 0.58, power: 16.0 }),
  Object.freeze({ roughness: 0.90, power: 4.0 })
]);

// 列方向では両モデルが読むspecularと、Deferred Lightingだけが読むmetallicを組み合わせる。
// ここにある値を初期基準とし、Paletteの値を動かすと4列全体が同じ差を保って移動する。
const GRID_COLUMNS = Object.freeze([
  Object.freeze({ specular: 0.15, metallic: 0.00 }),
  Object.freeze({ specular: 0.40, metallic: 0.25 }),
  Object.freeze({ specular: 0.70, metallic: 0.50 }),
  Object.freeze({ specular: 1.00, metallic: 0.75 })
]);

const DEFAULT_STATE = Object.freeze({
  renderer: "smooth",
  layout: "grid",
  red: 0.72,
  green: 0.24,
  blue: 0.10,
  smoothAmbient: 0.18,
  deferredAmbient: 0.035,
  specular: 0.60,
  roughness: 0.42,
  metallic: 0.00,
  power: 40.0,
  emissive: 0.00
});

// GGX側のLambert項に含まれる1/PIを初期ambient条件で概ね補う固定光量。
// ambient操作と光量を連動させないため、二つの照明式がambientを扱う違いもそのまま観察できる。
const DEFERRED_LIGHT_INTENSITY = Math.PI * (1.0 - DEFAULT_STATE.deferredAmbient);

let app = null;
let palette = null;
let lastHelpText = "";
const state = { ...DEFAULT_STATE };

// イコサヘドロンの各辺の中点を球面へ正規化し、subdivisions回だけ4分割する。
// 隣接面は同じ頂点を共有し、位置を正規化した球面法線で滑らかに補間します。
export function buildIcosphere(shape, radius = 1.0, subdivisions = 2) {
  const checkedRadius = util.readFiniteNumber(radius, "materials icosphere radius", {
    minExclusive: 0.0
  });
  const checkedSubdivisions = util.readFiniteNumber(
    subdivisions,
    "materials icosphere subdivisions",
    { integer: true, min: 0, max: 6 }
  );

  // 球面法線を明示するため、Shape側の面法線加算は使用しません。
  shape.setAutoCalcNormals(false);

  const vertices = [];
  let faces = [];

  // `sphere`の頂点を対象へ追加し、後続処理から参照できるようにする
  const addSphereVertex = (x, y, z) => {
    const len = Math.hypot(x, y, z);
    if (len <= 1.0e-8) {
      throw new Error("materials icosphere vertex must not be at the origin");
    }
    const nx = x / len;
    const ny = y / len;
    const nz = z / len;
    vertices.push([
      nx * checkedRadius,
      ny * checkedRadius,
      nz * checkedRadius
    ]);
    return vertices.length - 1;
  };

  const goldenRatio = (1.0 + Math.sqrt(5.0)) * 0.5;
  [
    [-1, goldenRatio, 0], [1, goldenRatio, 0],
    [-1, -goldenRatio, 0], [1, -goldenRatio, 0],
    [0, -1, goldenRatio], [0, 1, goldenRatio],
    [0, -1, -goldenRatio], [0, 1, -goldenRatio],
    [goldenRatio, 0, -1], [goldenRatio, 0, 1],
    [-goldenRatio, 0, -1], [-goldenRatio, 0, 1]
  ].forEach((vertex) => addSphereVertex(...vertex));

  // 外向き法線に対して反時計回りになる20面のインデックス。
  faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]
  ];

  for (let level = 0; level < checkedSubdivisions; level += 1) {
    // 同じ辺を共有する二つの面が同じ中点頂点を参照するよう、levelごとにcacheする。
    const midpointCache = new Map();
    const midpoint = (a, b) => {
      const low = Math.min(a, b);
      const high = Math.max(a, b);
      const key = `${low}:${high}`;
      const cached = midpointCache.get(key);
      if (cached !== undefined) {
        return cached;
      }
      const va = vertices[a];
      const vb = vertices[b];
      const index = addSphereVertex(
        (va[0] + vb[0]) * 0.5,
        (va[1] + vb[1]) * 0.5,
        (va[2] + vb[2]) * 0.5
      );
      midpointCache.set(key, index);
      return index;
    };

    const subdivided = [];
    for (const [a, b, c] of faces) {
      const ab = midpoint(a, b);
      const bc = midpoint(b, c);
      const ca = midpoint(c, a);
      subdivided.push(
        [a, ab, ca],
        [b, bc, ab],
        [c, ca, bc],
        [ab, bc, ca]
      );
    }
    faces = subdivided;
  }

  // 分割中に共有した頂点を一度だけShapeへ追加し、位置から球面法線を求めます。
  // addTriangle()は共有indexを参照するため、fragment間で法線が滑らかに補間されます。
  const sharedVertexIndices = vertices.map((position, vertexIndex) => {
    const normalLength = Math.hypot(...position);
    if (normalLength <= 1.0e-8) {
      throw new Error(`materials icosphere vertex ${vertexIndex} must not be at the origin`);
    }
    const index = shape.addVertex(...position) - 1;
    if (index !== vertexIndex) {
      throw new Error(
        `materials icosphere vertex index ${index} does not match shared index ${vertexIndex}`
      );
    }
    shape.setVertNormal(
      index,
      position[0] / normalLength,
      position[1] / normalLength,
      position[2] / normalLength
    );
    return index;
  });

  for (const [aIndex, bIndex, cIndex] of faces) {
    shape.addTriangle(
      sharedVertexIndices[aIndex],
      sharedVertexIndices[bIndex],
      sharedVertexIndices[cIndex]
    );
  }
  return shape;
}

// 材質の状態を読み込み、検証済みのデータとして後続処理へ渡す
function readMaterialState() {
  return {
    renderer: util.readOptionalEnum(
      state.renderer,
      "materials renderer",
      DEFAULT_STATE.renderer,
      ["smooth", "deferred"]
    ),
    layout: util.readOptionalEnum(
      state.layout,
      "materials layout",
      DEFAULT_STATE.layout,
      ["grid", "uniform"]
    ),
    color: [
      util.readFiniteNumber(state.red, "materials color red", { min: 0.0, max: 1.0 }),
      util.readFiniteNumber(state.green, "materials color green", { min: 0.0, max: 1.0 }),
      util.readFiniteNumber(state.blue, "materials color blue", { min: 0.0, max: 1.0 }),
      1.0
    ],
    smoothAmbient: util.readFiniteNumber(
      state.smoothAmbient,
      "materials SmoothShader ambient",
      { min: 0.0, max: 1.0 }
    ),
    deferredAmbient: util.readFiniteNumber(
      state.deferredAmbient,
      "materials Deferred Lighting ambient",
      { min: 0.0, max: 1.0 }
    ),
    specular: util.readFiniteNumber(state.specular, "materials specular", { min: 0.0, max: 1.0 }),
    roughness: util.readFiniteNumber(state.roughness, "materials roughness", { min: 0.04, max: 1.0 }),
    metallic: util.readFiniteNumber(state.metallic, "materials metallic", { min: 0.0, max: 1.0 }),
    power: util.readFiniteNumber(state.power, "materials power", { min: 1.0, max: 256.0 }),
    emissive: util.readFiniteNumber(state.emissive, "materials emissive", { min: 0.0, max: 1.0 })
  };
}

// 比較格子では、Paletteの現在値を基準に初期4段階との差を加える。
// 0.0–1.0の境界では値を範囲内へ収めるが、入力値自体はreadMaterialState()で先に検証する。
function resolveGridRows(material) {
  return GRID_ROWS.map((preset) => ({
    roughness: Math.min(1.0, Math.max(
      0.04,
      material.roughness + preset.roughness - DEFAULT_STATE.roughness
    )),
    power: Math.min(256.0, Math.max(
      1.0,
      material.power * preset.power / DEFAULT_STATE.power
    ))
  }));
}

// `grid`の`columns`を現在の入力と状態から求め、呼び出し元へ返す
function resolveGridColumns(material) {
  return GRID_COLUMNS.map((preset) => ({
    specular: Math.min(1.0, Math.max(
      0.0,
      material.specular + preset.specular - DEFAULT_STATE.specular
    )),
    metallic: Math.min(1.0, Math.max(
      0.0,
      material.metallic + preset.metallic - DEFAULT_STATE.metallic
    ))
  }));
}

// 両描画経路へ同じShapeを渡すため、片方が読まない値も省略せず全て登録する。
// これにより、非対応パラメータを動かしても見え方が変わらないことを比較できる。
function applyMaterials(spheres) {
  const material = readMaterialState();
  const gridRows = resolveGridRows(material);
  const gridColumns = resolveGridColumns(material);
  for (const entry of spheres) {
    const rowValues = material.layout === "grid" ? gridRows[entry.row] : material;
    const columnValues = material.layout === "grid" ? gridColumns[entry.column] : material;
    entry.shape.shaderParameter("color", material.color.slice());
    entry.shape.shaderParameter("ambient", material.smoothAmbient);
    entry.shape.shaderParameter("specular", columnValues.specular);
    entry.shape.shaderParameter("roughness", rowValues.roughness);
    entry.shape.shaderParameter("metallic", columnValues.metallic);
    entry.shape.shaderParameter("power", rowValues.power);
    entry.shape.shaderParameter("emissive", material.emissive);
  }
}

// ヘルプの行を生成し、後続処理で利用できる状態にする
function buildHelpLines() {
  const material = readMaterialState();
  const renderer = material.renderer === "smooth"
    ? "SmoothShader (Phong型)"
    : "Deferred Lighting (GGX型)";
  const lines = [
    "Material lighting comparison",
    `Renderer: ${renderer}`,
    `Layout: ${material.layout === "grid" ? "4 x 4 parameter grid" : "uniform palette values"}`,
    "M: renderer / G: layout / R: reset",
    "Command Palette: double tap canvas or press /",
    "Drag or Arrow keys: orbit camera",
    ""
  ];

  if (material.layout === "grid") {
    const gridRows = resolveGridRows(material);
    const gridColumns = resolveGridColumns(material);
    lines.push(
      "Rows top to bottom: roughness / power",
      gridRows.map((value) => `${value.roughness.toFixed(2)} / ${value.power.toFixed(0)}`).join(" | "),
      "Columns left to right: specular / metallic",
      gridColumns.map((value) => `${value.specular.toFixed(2)} / ${value.metallic.toFixed(2)}`).join(" | ")
    );
  } else {
    lines.push(
      `specular ${material.specular.toFixed(2)} / roughness ${material.roughness.toFixed(2)}`,
      `metallic ${material.metallic.toFixed(2)} / power ${material.power.toFixed(0)}`
    );
  }

  lines.push(
    `Smooth ambient ${material.smoothAmbient.toFixed(2)} / Deferred ambient ${material.deferredAmbient.toFixed(3)}`,
    `emissive ${material.emissive.toFixed(2)}`,
    "SmoothShader ignores roughness and metallic.",
    "Deferred Lighting ignores power; final display uses linear clamp.",
    ...(app?.getFrameTimingLines?.() ?? [])
  );
  return lines;
}

// ヘルプのパネルを現在の入力と実行状態に合わせて更新する
function updateHelpPanel() {
  const panel = app?.getOverlayPanel?.("materialsHelp");
  if (!panel) return;
  const lines = buildHelpLines();
  const text = lines.join("\n");
  if (text === lastHelpText) return;
  app.updateOverlayPanel("materialsHelp", { lines });
  lastHelpText = text;
}

// 一つのGPU形状リソースから16個のShape instanceを作り、材質辞書だけを独立させる。
function createMaterialGrid() {
  const baseShape = new Shape(app.getGPU());
  buildIcosphere(baseShape, SPHERE_RADIUS, 2);
  // 共有頂点の球面法線を両経路で読み、同じ滑らかな法線補間による鏡面反射を比較します。
  // UV継ぎ目で必要になる頂点複製はShape.endShape()が法線を保ったまま処理します。
  baseShape.endShape();

  const spheres = [];
  for (let row = 0; row < GRID_SIZE; row += 1) {
    for (let column = 0; column < GRID_SIZE; column += 1) {
      const shape = baseShape.createInstance();
      const node = app.space.addNode(null, `material-${row}-${column}`);
      node.setPosition(
        (column - (GRID_SIZE - 1) * 0.5) * GRID_SPACING,
        ((GRID_SIZE - 1) * 0.5 - row) * GRID_SPACING,
        0.0
      );
      node.addShape(shape);
      spheres.push({ row, column, node, shape });
    }
  }
  applyMaterials(spheres);
  return spheres;
}

// SmoothShaderはSpaceのpoint lightを、Deferred Lightingは同じworld位置のLocal Lightを読む。
// Deferred側の半径を十分大きくし、距離減衰よりもBRDFの差が観察しやすい条件にする。
function createSharedLight() {
  const lightNode = app.space.addNode(null, "material-light");
  lightNode.setPosition(...LIGHT_POSITION);
  app.space.setLight(lightNode);
  app.space.setLightType(1.0);
  return {
    type: "point",
    position: Array.from(LIGHT_POSITION),
    color: [1.0, 1.0, 1.0],
    radius: 10000.0,
    intensity: DEFERRED_LIGHT_INTENSITY
  };
}

// 状態を初期状態へ戻し、前回の状態を残さない
function resetState(spheres) {
  Object.assign(state, DEFAULT_STATE);
  applyMaterials(spheres);
}

// コマンドの操作パレットを生成し、後続処理で利用できる状態にする
function createCommandPalette(spheres, refresh) {
  const next = { id: "palette-next", label: "Next", detail: "page", pageSwitch: true };
  palette = new CommandPalette({
    document,
    container: document.body,
    viewport: app.screen.canvas,
    title: "Material Compare",
    pageRows: 5,
    closeOnCommand: false,
    onCommand: (id) => {
      if (id !== "reset") {
        throw new Error(`materials Command Palette received unknown command: ${id}`);
      }
      resetState(spheres);
      refresh();
    },
    onChange: (id, value) => {
      const stateKeyById = {
        renderer: "renderer",
        layout: "layout",
        red: "red",
        green: "green",
        blue: "blue",
        specular: "specular",
        emissive: "emissive",
        roughness: "roughness",
        metallic: "metallic",
        power: "power"
      };
      const key = id === "ambient"
        ? state.renderer === "smooth" ? "smoothAmbient" : "deferredAmbient"
        : stateKeyById[id];
      if (key === undefined) {
        throw new Error(`materials Command Palette received unknown control: ${id}`);
      }
      state[key] = value;
      applyMaterials(spheres);
      refresh();
    },
    commands: [
      // 1ページ目
      null,
      null,
      null,
      next,
      { type: "select", id: "renderer", label: "Renderer", value: () => state.renderer, options: [
        { value: "smooth", label: "SmoothShader" },
        { value: "deferred", label: "Deferred Lighting" }
      ] },
      { type: "select", id: "layout", label: "Layout", value: () => state.layout, options: [
        { value: "grid", label: "4 x 4 grid" },
        { value: "uniform", label: "Uniform values" }
      ] },
      { id: "reset", label: "Reset", detail: "defaults" },
      null,
      null,
      null,
      { type: "stepper", id: "red", label: "Color Red", value: () => state.red, min: 0.0, max: 1.0, step: 0.05, decimals: 2, input: true },
      // 2ページ目
      null,
      null,
      null,
      next,
      { type: "stepper", id: "green", label: "Color Green", value: () => state.green, min: 0.0, max: 1.0, step: 0.05, decimals: 2, input: true },
      { type: "stepper", id: "blue", label: "Color Blue", value: () => state.blue, min: 0.0, max: 1.0, step: 0.05, decimals: 2, input: true },
      { type: "stepper", id: "ambient", label: "Current Ambient", value: () => state.renderer === "smooth" ? state.smoothAmbient : state.deferredAmbient, min: 0.0, max: 1.0, step: 0.005, decimals: 3, input: true },
      { type: "stepper", id: "specular", label: "Specular", value: () => state.specular, min: 0.0, max: 1.0, step: 0.05, decimals: 2, input: true },
      // 3ページ目
      null,
      null,
      null,
      next,
      { type: "stepper", id: "emissive", label: "Emissive", value: () => state.emissive, min: 0.0, max: 1.0, step: 0.05, decimals: 2, input: true },
      { type: "stepper", id: "roughness", label: "Roughness", value: () => state.roughness, min: 0.04, max: 1.0, step: 0.04, decimals: 2, input: true },
      { type: "stepper", id: "metallic", label: "Metallic", value: () => state.metallic, min: 0.0, max: 1.0, step: 0.05, decimals: 2, input: true },
      { type: "stepper", id: "power", label: "Smooth Power", value: () => state.power, min: 1.0, max: 256.0, step: 4.0, decimals: 0, input: true },
    ]
  });
  palette.attachToCanvas(app.screen.canvas, { key: "/" });
  palette.setStyle(getDefaultCommandPaletteCss());
}

document.addEventListener("DOMContentLoaded", () => {
  start().catch((error) => {
    app?.setDiagnosticsReport?.(Diagnostics.createErrorReport(error, {
      system: "materials",
      source: "samples/materials/main.js"
    }));
    app?.showOverlayPanel?.(buildErrorPanelOptions(error, {
      title: "materials failed",
      id: "start-error"
    }));
    console.error("materials failed:", error);
  });
});

// このインスタンスの初期化段階で、必要な状態と資源を準備して処理を開始する
async function start() {
  app = new WebgApp({
    document,
    autoDrawScene: false,
    frameTiming: true,
    clearColor: [0.012, 0.018, 0.028, 1.0],
    viewAngle: 48,
    projectionFar: 100,
    messageFontTexture: "../../webg/font512.png",
    camera: { target: [0, 0, 0], distance: 20.5, yaw: 0, pitch: 0 },
    debugTools: {
      mode: "release",
      system: "materials",
      source: "samples/materials/main.js",
      probeDefaultAfterFrames: 1
    }
  });
  await app.init();
  app.materialState = state;

  const initialHelpLines = buildHelpLines();
  app.showOverlayPanel(buildHelpPanelOptions({
    id: "materialsHelp",
    collapsed: true,
    title: "Material comparison",
    lines: initialHelpLines,
    maxWidth: "430px",
    maxHeight: "48vh"
  }));
  lastHelpText = initialHelpLines.join("\n");

  app.createOrbitEyeRig({
    target: [0, 0, 0],
    distance: 20.5,
    yaw: 0,
    pitch: 0,
    minDistance: 13,
    maxDistance: 40,
    wheelZoomStep: 0.8
  });

  const pipeline = new ComputeEffectPipeline(app.getGPU(), {
    label: "materials-deferred",
    width: app.screen.getWidth(),
    height: app.screen.getHeight(),
    maxLights: 1,
    lighting: {
      ambient: state.deferredAmbient,
      directionalIntensity: 0.0
    },
    toneMap: {
      // 照明モデル比較ではSmoothShaderと同じ飽和条件にそろえ、
      // Reinhardによる中間輝度とハイライトの追加圧縮を比較差へ混ぜません。
      mode: "linear",
      exposure: 1.0,
      saturation: 1.0,
      gamma: 2.2,
      blackBackground: false
    }
  });
  await pipeline.ready;

  const copyPass = new FullscreenPass(app.getGPU(), {
    targetFormat: app.getGPU().format
  });
  await copyPass.init();

  const spheres = createMaterialGrid();
  const deferredLight = createSharedLight();

  // このインスタンスを現在の入力と実行状態に合わせて更新する
  const refresh = () => {
    palette?.render();
    updateHelpPanel();
    app.requestRender();
  };
  createCommandPalette(spheres, refresh);
  refresh();

  app.attachInput({
    onKeyDown: async (key, event) => {
      if (event.repeat) return;
      if (key === "m") {
        state.renderer = state.renderer === "smooth" ? "deferred" : "smooth";
      } else if (key === "g") {
        state.layout = state.layout === "grid" ? "uniform" : "grid";
      } else if (key === "r") {
        resetState(spheres);
      } else {
        return;
      }
      applyMaterials(spheres);
      refresh();
    }
  });

  app.setDiagnosticsStage("runtime");
  app.configureDebugKeyInput();
  app.start({
    onUpdate: ({ screen }) => {
      app.afterGpuSubmit();
      updateHelpPanel();
      pipeline.resize(screen.getWidth(), screen.getHeight());
      app.mergeDiagnosticsStats({
        renderer: state.renderer,
        layout: state.layout,
        spheres: spheres.length
      });
      app.updateDebugProbe();
    },
    onBeforeDraw: ({ cameraFrame }) => {
      if (state.renderer === "smooth") {
        // WebgAppが確定した同じCameraFrameで標準のforward描画を明示的に実行する。
        app.space.draw(cameraFrame);
        return;
      }
      pipeline.renderScene(app.space, cameraFrame, app.clearColor, {
        shadowEnabled: false
      });
    },
    onAfterDraw3d: ({ cameraFrame }) => {
      if (state.renderer === "smooth") {
        return;
      }
      app.getGPU().endPass();
      const material = readMaterialState();
      const finalColor = pipeline.encode(app.getGPU().commandEncoder, {
        cameraFrame,
        shadowEnabled: false,
        ssaoEnabled: false,
        ssrEnabled: false,
        toonEnabled: false,
        dofEnabled: false,
        bloomEnabled: false,
        edgeEnabled: false,
        lights: [deferredLight],
        lightCount: 1,
        lightingView: "lighting",
        lighting: {
          ambient: material.deferredAmbient,
          directionalIntensity: 0.0
        }
      });
      app.screen.beginPresentPass({
        clearColor: app.clearColor,
        colorLoadOp: "clear"
      });
      copyPass.draw(finalColor);
      app.screen.clearDepthBuffer();
    }
  });
}
