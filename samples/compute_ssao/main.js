// ---------------------------------------------
// samples/compute_ssao/main.js  2026/07/25
//   Compute Shader depth-only ambient occlusion sample
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
import ComputePass, {
  DEFAULT_STORAGE_TEXTURE_FORMAT as COMPUTE_OUTPUT_FORMAT
} from "../../webg/ComputePass.js";
import StorageTargetFactory, { resizeTarget } from "../../webg/StorageTargetFactory.js";
import {
  GBUFFER_WGSL_COMMON,
  createGBufferProjectionParams
} from "../../webg/GeometryBufferPass.js";

const DEFAULTS = {
  radius: 18.0,
  strength: 1.35,
  bias: 0.06,
  samples: 12
};

// depth-only SSAOはscene colorとdepthだけを入力にし、近傍depthからnormalも復元します
// G-buffer normalを持たない分resourceは少なくなりますが、depth不連続付近では近似誤差が出ます
const SSAO_SHADER = `
// ao.x = sample radius in pixels
// ao.y = occlusion strength
// ao.z = normal bias
// ao.w = sample count
// projection.x = near, projection.y = far
// projection.z = tan(verticalFov / 2), projection.w = aspect
// control.x = enabled, control.y = view mode
struct Params {
  ao : vec4f,
  projection : vec4f,
  control : vec4f,
};

@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var sceneTexture : texture_2d<f32>;
@group(0) @binding(2) var depthTexture : texture_depth_2d;
@group(0) @binding(3) var outputTexture : texture_storage_2d<rgba8unorm, write>;

${GBUFFER_WGSL_COMMON}

fn clampCoord(coord : vec2<i32>, dims : vec2<i32>) -> vec2<i32> {
  // 近傍sampleが画面外へ出た場合は最寄りpixelへclampします
  return clamp(coord, vec2<i32>(0), dims - vec2<i32>(1));
}

fn loadDepth(coord : vec2<i32>, dims : vec2<i32>) -> f32 {
  return textureLoad(depthTexture, clampCoord(coord, dims), 0);
}

// depthとpixel座標からview-space位置を復元します
// cameraは-z方向を見るため、復元した奥行きはnegative zへ置きます
fn reconstructPosition(coord : vec2<i32>, depth : f32, dims : vec2<i32>) -> vec3f {
  let uv = (vec2f(coord) + vec2f(0.5)) / vec2f(dims);
  let ndc = uv * 2.0 - vec2f(1.0);
  let viewDepth = linearizeGBufferDepth(depth, params.projection);
  let tanHalfFov = params.projection.z;
  let aspect = params.projection.w;
  return vec3f(
    ndc.x * viewDepth * tanHalfFov * aspect,
    -ndc.y * viewDepth * tanHalfFov,
    -viewDepth
  );
}

// G-bufferのnormal textureを使わず、depthから復元した近傍位置の差分で
// view-space normalを近似します
fn reconstructNormal(coord : vec2<i32>, dims : vec2<i32>) -> vec3f {
  let leftCoord = clampCoord(coord + vec2<i32>(-1, 0), dims);
  let rightCoord = clampCoord(coord + vec2<i32>(1, 0), dims);
  let upCoord = clampCoord(coord + vec2<i32>(0, -1), dims);
  let downCoord = clampCoord(coord + vec2<i32>(0, 1), dims);
  let left = reconstructPosition(leftCoord, loadDepth(leftCoord, dims), dims);
  let right = reconstructPosition(rightCoord, loadDepth(rightCoord, dims), dims);
  let up = reconstructPosition(upCoord, loadDepth(upCoord, dims), dims);
  let down = reconstructPosition(downCoord, loadDepth(downCoord, dims), dims);
  let dx = right - left;
  let dy = down - up;
  return normalize(cross(dy, dx));
}

fn hashAngle(coord : vec2<i32>) -> f32 {
  // pixel座標から決定的な回転角を作り、kernel方向を分散します
  let value = sin(dot(vec2f(coord), vec2f(12.9898, 78.233))) * 43758.5453;
  return fract(value) * 6.2831853;
}

fn rotate2(value : vec2f, angle : f32) -> vec2f {
  let c = cos(angle);
  let s = sin(angle);
  return vec2f(value.x * c - value.y * s, value.x * s + value.y * c);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  // invocation 1つがoutput pixel 1つを処理します
  let dimsU = textureDimensions(sceneTexture);
  if (id.x >= dimsU.x || id.y >= dimsU.y) {
    return;
  }

  let coord = vec2<i32>(id.xy);
  let dims = vec2<i32>(dimsU);
  let source = textureLoad(sceneTexture, coord, 0);
  let centerDepth = loadDepth(coord, dims);

  // 背景pixelまたはSSAO無効時は元sceneをそのまま出力します
  if (isGBufferBackgroundDepth(centerDepth) || params.control.x < 0.5) {
    textureStore(outputTexture, coord, source);
    return;
  }

  let centerPosition = reconstructPosition(coord, centerDepth, dims);
  let normal = reconstructNormal(coord, dims);
  let radiusPixels = max(params.ao.x, 1.0);
  let sampleCount = clamp(i32(round(params.ao.w)), 4, 16);
  let angle = hashAngle(coord);

  // 半径と方向を分散したscreen-space kernelです
  // pixelごとに回転し、固定方向由来の縞模様を目立ちにくくします
  let kernel = array<vec2f, 16>(
    vec2f(0.22, 0.00), vec2f(-0.18, 0.18),
    vec2f(0.00, -0.32), vec2f(0.31, 0.31),
    vec2f(-0.46, 0.00), vec2f(0.00, 0.52),
    vec2f(0.48, -0.48), vec2f(-0.58, -0.58),
    vec2f(0.72, 0.00), vec2f(-0.68, 0.28),
    vec2f(0.25, 0.76), vec2f(0.58, 0.58),
    vec2f(-0.86, 0.00), vec2f(0.00, -0.92),
    vec2f(0.72, -0.72), vec2f(-0.78, 0.78)
  );

  // pixel半径をcenter depthでview-space半径へ換算し、
  // 遠距離でも過度に広い範囲を遮蔽判定しないようにします
  let worldRadius = max(
    -centerPosition.z * (radiusPixels / f32(dims.y)) * 2.0 * params.projection.z,
    0.001
  );
  var occlusion = 0.0;
  var validSamples = 0.0;

  for (var i = 0; i < 16; i += 1) {
    if (i < sampleCount) {
      let offset = vec2<i32>(round(rotate2(kernel[i], angle) * radiusPixels));
      let sampleCoord = clampCoord(coord + offset, dims);
      let sampleDepth = loadDepth(sampleCoord, dims);
      if (!isGBufferBackgroundDepth(sampleDepth)) {
        let samplePosition = reconstructPosition(sampleCoord, sampleDepth, dims);
        let delta = samplePosition - centerPosition;
        let distance = length(delta);
        if (distance > 0.0001) {
          // tangent面よりnormal側へ出た近傍surfaceをoccluderとして数えます
          let facing = max(dot(normal, delta / distance) - params.ao.z, 0.0);
          let rangeWeight = 1.0 - smoothstep(worldRadius * 0.15, worldRadius * 1.8, distance);
          occlusion += facing * rangeWeight;
          validSamples += 1.0;
        }
      }
    }
  }

  let average = occlusion / max(validSamples, 1.0);
  let ao = clamp(1.0 - average * params.ao.y * 3.2, 0.0, 1.0);

  // mode=1はAO係数だけを白黒表示し、通常modeではscene colorへ乗算します
  if (params.control.y > 0.5) {
    textureStore(outputTexture, coord, vec4f(vec3f(ao), 1.0));
  } else {
    textureStore(outputTexture, coord, vec4f(source.rgb * ao, source.a));
  }
}`;

let app = null;
let palette = null;
let lastHelpText = "";

// ヘルプの行を生成し、後続処理で利用できる状態にする
function buildHelpLines() {
  const p = app?.computeSsaoState?.params;
  return [
    "Depth-only ambient occlusion",
    "CommandPalette: double tap canvas or press /",
    "Drag or Arrow keys: orbit camera",
    "Use palette controls to inspect AO parameters",
    "",
    `SSAO: ${app?.computeSsaoState?.enabled ? "ON" : "OFF"} / view: ${app?.computeSsaoState?.view ?? "--"}`,
    `Radius: ${p ? p.radius.toFixed(0) : "--"} / strength: ${p ? p.strength.toFixed(2) : "--"}`,
    `Bias: ${p ? p.bias.toFixed(2) : "--"} / samples: ${p ? p.samples : "--"}`,
    `Pause: ${app?.computeSsaoState?.paused ? "ON" : "OFF"}`,
    ...(app?.getFrameTimingLines?.() ?? [])
  ];
}

// ヘルプのパネルを現在の入力と実行状態に合わせて更新する
function updateHelpPanel() {
  const panel = app?.getOverlayPanel?.("computeSsaoHelp");
  if (!panel) return;
  const lines = buildHelpLines();
  const nextText = lines.join("\n");
  if (nextText === lastHelpText) return;
  app.updateOverlayPanel("computeSsaoHelp", { lines });
  lastHelpText = nextText;
}

// smooth-shaderへ渡すmaterial objectを作り、通常描画のscene colorを揃えます
// Compute Shader側はこの結果とdepthだけを読み、material構造そのものは扱いません
function makeMaterial(color, ambient = 0.72, specular = 0.45, power = 28.0) {
  // offscreen scene colorは既存smooth-shaderで描き、Compute Shaderはその結果へAOを乗算します
  return { has_bone: 0, use_texture: 0, color, ambient, specular, power };
}

// cuboid primitiveをShapeへ変換し、scene graphへNodeとして追加します
// 形状生成、material設定、配置を同じ段階で読み取れるようにまとめます
function addCuboid(name, position, size, color) {
  // scene graphへNode/Shapeを追加し、通常のwebg描画経路でscene targetへ描画します
  const shape = new Shape(app.getGPU());
  shape.applyPrimitiveAsset(Primitive.cuboid(size[0], size[1], size[2], shape.getPrimitiveOptions()));
  shape.endShape();
  shape.setMaterial("smooth-shader", makeMaterial(color));
  const node = app.space.addNode(null, name);
  node.setPosition(...position);
  node.addShape(shape);
  return node;
}

// sphere primitiveをShapeへ変換し、depth-only SSAOの確認用objectとして追加します
// cuboidと同じ流れにそろえ、形状の違いだけを比較しやすくします
function addSphere(name, position, radius, color) {
  // sphereもcuboidと同じmaterial形式で作り、depth-only SSAOの入力sceneを構成します
  const shape = new Shape(app.getGPU());
  shape.applyPrimitiveAsset(Primitive.sphere(radius, 30, 22, shape.getPrimitiveOptions()));
  shape.endShape();
  shape.setMaterial("smooth-shader", makeMaterial(color, 0.68, 0.65, 40.0));
  const node = app.space.addNode(null, name);
  node.setPosition(...position);
  node.addShape(shape);
  return node;
}

// 床との接触、壁の角、object同士の隙間を多く作り、
// SSAOが出やすいconcave areaを同じ画面で確認します
function createScene() {
  // 接地部、corner、大小物体の隙間など、screen-space occlusionが見えやすい配置です
  addCuboid("floor", [0.0, -4.5, 0.0], [34.0, 1.0, 30.0], [0.58, 0.62, 0.67, 1.0]);
  addCuboid("backWall", [0.0, 3.0, -13.5], [34.0, 16.0, 1.0], [0.48, 0.54, 0.61, 1.0]);
  addCuboid("sideWall", [-16.5, 3.0, 0.0], [1.0, 16.0, 28.0], [0.42, 0.49, 0.57, 1.0]);

  const nodes = [
    addCuboid("boxLarge", [-6.5, -1.5, -5.5], [5.0, 5.0, 5.0], [0.86, 0.56, 0.34, 1.0]),
    addCuboid("boxSmall", [-2.8, -2.5, -2.0], [3.0, 3.0, 3.0], [0.92, 0.76, 0.38, 1.0]),
    addCuboid("pillar", [7.5, 0.0, -7.5], [3.0, 8.0, 3.0], [0.38, 0.68, 0.88, 1.0]),
    addSphere("sphereFloor", [4.0, -2.2, 1.0], 2.0, [0.38, 0.88, 0.66, 1.0]),
    addSphere("sphereCorner", [-12.5, -1.8, -9.5], 2.4, [0.82, 0.42, 0.55, 1.0]),
    addSphere("sphereRaised", [10.0, 1.0, -2.5], 2.1, [0.72, 0.55, 0.94, 1.0])
  ];
  return nodes;
}

document.addEventListener("DOMContentLoaded", () => {
  start().catch((err) => {
    app?.setDiagnosticsReport?.(Diagnostics.createErrorReport(err, {
      system: "compute_ssao",
      source: "samples/compute_ssao/main.js"
    }));
    app?.showOverlayPanel?.(buildErrorPanelOptions(err, {
      title: "compute_ssao failed",
      id: "start-error"
    }));
    console.error("compute_ssao failed:", err);
  });
});

// WebgApp、sampleable depth付きscene target、ComputePass、入力、frame loopを構築します
// scene描画、AO dispatch、fullscreen copyの順序をこの関数内で固定します
async function start() {
  app = new WebgApp({
    document,
    autoDrawScene: false,
    frameTiming: true,
    clearColor: [0.12, 0.15, 0.19, 1.0],
    viewAngle: 52.0,
    projectionFar: 120.0,
    messageFontTexture: "../../webg/font512.png",
    camera: { target: [0.0, -0.5, -4.0], distance: 35.0, yaw: 24.0, pitch: -13.0 },
    light: {
      mode: "world-node",
      nodeName: "worldLight",
      position: [75.0, 120.0, 80.0],
      attitude: [0.0, 0.0, 0.0],
      type: 1.0
    },
    debugTools: {
      mode: "release",
      system: "compute_ssao",
      source: "samples/compute_ssao/main.js",
      probeDefaultAfterFrames: 1
    }
  });
  await app.init();
  const helpLines = buildHelpLines();
  app.showOverlayPanel(buildHelpPanelOptions({
    id: "computeSsaoHelp",
    collapsed: true,
    lines: helpLines
  }));
  lastHelpText = helpLines.join("\n");

  const orbit = app.createOrbitEyeRig({
    target: [0.0, -0.5, -4.0],
    distance: 35.0,
    yaw: 24.0,
    pitch: -13.0,
    minDistance: 18.0,
    maxDistance: 70.0,
    wheelZoomStep: 1.2
  });

  // colorに加え、Compute Shaderから読むdepth textureを持つscene targetです
  const sceneTarget = app.screen.createRenderTarget({
    label: "compute-ssao:scene",
    format: app.getGPU().format,
    hasDepth: true,
    sampleDepth: true
  });
  const targetFactory = new StorageTargetFactory(app.getGPU(), {
    label: "compute-ssao:storage"
  });
  const outputTarget = targetFactory.create({
    label: "compute-ssao:output",
    width: app.screen.getWidth(),
    height: app.screen.getHeight()
  });
  await Promise.all([sceneTarget.ready, outputTarget.ready]);

  const ssaoPass = new ComputePass(app.getGPU(), {
    // WGSLと同じbinding番号でscene color、sample可能なdepth、outputを明示します
    label: "compute-ssao",
    code: SSAO_SHADER,
    uniformFloats: 12,
    bindings: [
      { binding: 0, name: "params", type: "uniform-buffer" },
      { binding: 1, name: "scene", type: "sampled-texture" },
      { binding: 2, name: "depth", type: "depth-texture" },
      {
        binding: 3,
        name: "output",
        type: "storage-texture",
        format: COMPUTE_OUTPUT_FORMAT,
        dispatchSize: true
      }
    ]
  });
  const copyPass = new FullscreenPass(app.getGPU(), {
    targetFormat: app.getGPU().format
  });
  await copyPass.init();

  const sceneNodes = createScene();
  const state = {
    enabled: true,
    paused: false,
    view: "composite",
    params: { ...DEFAULTS }
  };
  app.computeSsaoState = state;
  // このインスタンスを初期状態へ戻し、前回の状態を残さない
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
      title: "Compute SSAO",
      pageRows: 5,
      pageRowsByPage: [5, 5],
      closeOnCommand: false,
      onChange: (id, value) => {
        const p = state.params;
        if (id === "enabled") state.enabled = value;
        else if (id === "paused") state.paused = value;
        else if (id === "view") state.view = value;
        else if (id === "radius") p.radius = value;
        else if (id === "strength") p.strength = value;
        else if (id === "bias") p.bias = value;
        else if (id === "samples") p.samples = value;
        refreshAfterControlChange();
      },
      onCommand: (id) => {
        if (id === "reset") reset();
        refreshAfterControlChange();
      },
      commands: [
        // 1ページ目
        { type: "toggle", id: "enabled", label: "SSAO", detail: "on/off", value: () => state.enabled },
        { type: "toggle", id: "paused", label: "Pause", detail: "anim", value: () => state.paused },
        null,
        { id: "palette-next", label: "Next", detail: "page", pageSwitch: true },
        { type: "select", id: "view", label: "View", value: () => state.view, options: [
          { value: "composite", label: "composite" },
          { value: "scene", label: "scene" },
          { value: "ao", label: "ao" }
        ] },
        { type: "stepper", id: "radius", label: "Radius", value: () => state.params.radius, min: 4.0, max: 48.0, step: 2.0, decimals: 0, input: true },
        { type: "stepper", id: "strength", label: "Strength", value: () => state.params.strength, min: 0.0, max: 4.0, step: 0.12, decimals: 2, input: true },
        { type: "stepper", id: "bias", label: "Bias", value: () => state.params.bias, min: 0.0, max: 0.35, step: 0.01, decimals: 2, input: true },
        // 2ページ目
        null,
        null,
        null,
        { id: "palette-next", label: "Next", detail: "page", pageSwitch: true },
        { type: "stepper", id: "samples", label: "Samples", value: () => state.params.samples, min: 4, max: 16, step: 2, decimals: 0, input: true },
        { id: "reset", label: "Reset", detail: "params" },
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
      if (key === "c") state.enabled = !state.enabled;
      else if (key === "v") {
        const views = ["composite", "scene", "ao"];
        state.view = views[(views.indexOf(state.view) + 1) % views.length];
      } else if (key === "1") p.radius = Math.max(4.0, p.radius - 2.0);
      else if (key === "2") p.radius = Math.min(48.0, p.radius + 2.0);
      else if (key === "3") p.strength = Math.max(0.0, p.strength - 0.12);
      else if (key === "4") p.strength = Math.min(4.0, p.strength + 0.12);
      else if (key === "5") p.bias = Math.max(0.0, p.bias - 0.01);
      else if (key === "6") p.bias = Math.min(0.35, p.bias + 0.01);
      else if (key === "7") p.samples = Math.max(4, p.samples - 2);
      else if (key === "8") p.samples = Math.min(16, p.samples + 2);
      else if (key === " ") state.paused = !state.paused;
      else if (key === "r") reset();
    }
  });
  app.setDiagnosticsStage("runtime");
  app.configureDiagnosticsCapture({
    labelPrefix: "compute_ssao",
    collect: () => {
      const report = app.createProbeReport("runtime-probe");
      Diagnostics.mergeStats(report, {
        view: state.view,
        enabled: state.enabled ? "yes" : "no",
        radius: state.params.radius.toFixed(0),
        strength: state.params.strength.toFixed(2),
        bias: state.params.bias.toFixed(2),
        samples: state.params.samples
      });
      return report;
    }
  });
  app.configureDebugKeyInput();

  app.start({
    onUpdate: ({ deltaSec, screen }) => {
      app.afterGpuSubmit();
      updateHelpPanel();
      // cameraとobject animationを更新し、中間targetをcanvas寸法へ追従させます
      const width = screen.getWidth();
      const height = screen.getHeight();
      resizeTarget(sceneTarget, width, height);
      resizeTarget(outputTarget, width, height);

      if (!state.paused) {
        for (let i = 0; i < sceneNodes.length; i += 1) {
          sceneNodes[i].rotateY((2.0 + i * 0.35) * deltaSec);
        }
      }

      app.mergeDiagnosticsStats({
        view: state.view,
        enabled: state.enabled ? "yes" : "no",
        radius: state.params.radius.toFixed(0),
        strength: state.params.strength.toFixed(2),
        bias: state.params.bias.toFixed(2),
        samples: state.params.samples
      });
      app.updateDebugProbe();
    },
    onBeforeDraw: () => {
      // 第1段: 通常のforward lighting sceneをcolor+depth targetへ描画します
      app.beginGpuTiming();
      app.screen.beginPass({
        target: sceneTarget,
        clearColor: app.clearColor,
        colorLoadOp: "clear",
        depthClear: true,
        timestampWrites: app.getGpuRenderTimestampWrites(true, true)
      });
      app.space.draw(app.eye);
    },
    onAfterDraw3d: ({ cameraFrame }) => {
      // 第2段: scene color/depthからAOを計算し、第3段で選択viewをcanvasへcopyします
      const p = state.params;
      const mode = state.view === "ao" ? 1.0 : 0.0;
      const projection = createGBufferProjectionParams(cameraFrame);
      ssaoPass.setUniforms([
        // WGSL Paramsのao/projection/control vec4 x 3と同じ順序で値を詰めます
        p.radius,
        p.strength,
        p.bias,
        p.samples,
        projection[0],
        projection[1],
        projection[2],
        projection[3],
        state.enabled ? 1.0 : 0.0,
        mode,
        outputTarget.getWidth(),
        outputTarget.getHeight()
      ]);
      // scene Render Passを閉じ、AO Compute Passを現在frameへ追加します
      app.getGPU().endPass();
      ssaoPass.encode(app.getGPU().commandEncoder, {
        scene: sceneTarget,
        depth: sceneTarget,
        output: outputTarget
      }, {
        timestampWrites: app.getGpuTimestampWrites(true, true)
      });
      app.endGpuTiming(app.getGPU().commandEncoder);

      // scene viewだけはCompute出力を使わず、元のoffscreen colorを直接表示します
      const source = state.view === "scene" ? sceneTarget : outputTarget;
      app.screen.beginPresentPass({
        clearColor: app.clearColor,
        colorLoadOp: "clear"
      });
      copyPass.draw(source);
      app.screen.clearDepthBuffer();
    }
  });
}
