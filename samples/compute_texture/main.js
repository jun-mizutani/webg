// ---------------------------------------------
// samples/compute_texture/main.js  2026/07/21
//   Compute Shader dynamic texture sample
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import WebgApp from "../../webg/WebgApp.js?v=20260614_compute_frame1";
import PingPongTexture from "../../webg/PingPongTexture.js";
import { buildErrorPanelOptions, buildHelpPanelOptions } from "../../webg/OverlayPanelPresets.js";
import Primitive from "../../webg/Primitive.js";
import { CAMERA_REVERSE_Z } from "../../webg/DepthConvention.js";

// このサンプルの目的:
// - WebgAppとコアのPingPongTextureを使い、WebGPU device上のstorage textureを更新する
// - sampled texture を読みながら別の storage texture へ書く ping-pong 構成を確認する
// - CPU 側で画像を作らず、Compute Shader が毎 frame 生成した texture をそのまま render pass へ渡す

const TEXTURE_SIZE = 512;
const WORKGROUP_SIZE = 8;
const TEXTURE_FORMAT = "rgba8unorm";
const PARAM_FLOATS = 20;
const CLEAR_COLOR = [0.015, 0.020, 0.030, 1.0];
const POINTER_INK_MAX = 1.35;
const POINTER_INK_DECAY_PER_SEC = 0.38;
const POINTER_PULSE_PROGRESS_PER_SEC = 0.92;
const MODE_NAMES = ["Aurora", "Ink", "Cells"];
const BRUSH_COLORS = [
  [1.00, 0.52, 0.16, 1.0],
  [0.18, 0.88, 0.96, 1.0],
  [0.96, 0.90, 0.22, 1.0]
];
const ZERO_TEXTURE_DATA = new Uint8Array(TEXTURE_SIZE * TEXTURE_SIZE * 4);

let app = null;
let screen = null;
let device = null;
let queue = null;
let textureSampler = null;
let stateTextures = [];
let statePair = null;
let computeBindGroups = [];
let renderBindGroups = [];
let paramBuffer = null;
let computePipeline = null;
let sphereRenderPipeline = null;
let previewRenderPipeline = null;
let sphereVertexBuffer = null;
let sphereIndexBuffer = null;
let previewVertexBuffer = null;
let sphereIndexCount = 0;
let paused = false;
let modeIndex = 0;
let brushRadius = 0.055;
let burstEnergy = 0.0;
let pointerDown = false;
let pointerInkEnergy = 0.0;
let pointerUvX = 0.5;
let pointerUvY = 0.5;
let pointerPulseProgress = 1.0;
let pointerPulseUvX = 0.5;
let pointerPulseUvY = 0.5;
let lastHelpText = "";

// OverlayPanel に表示する行を現在の mode、brush、入力状態から組み立てる
// 戻り値は 1 行ずつ分けた文字列配列で、初回表示と更新が同じ関数を使う
// 画面から直接「この sample は何を操作して、どこを見ればよいか」が読めるよう情報をまとめる
const buildHelpLines = () => [
  "compute_texture",
  `texture: ${TEXTURE_SIZE} x ${TEXTURE_SIZE}  workgroup: ${WORKGROUP_SIZE} x ${WORKGROUP_SIZE}`,
  "compute: sampled texture -> storage texture write on GPU",
  "render: Primitive.sphere mesh + flat preview from the same computed texture",
  `mode: ${MODE_NAMES[modeIndex]}  paused: ${paused ? "yes" : "no"}`,
  `brush radius: ${(brushRadius * 100.0).toFixed(1)}%  pointer: ${pointerDown ? "painting" : "idle"}  trail: ${pointerInkEnergy.toFixed(2)}  pulse: ${Math.max(0.0, 1.0 - pointerPulseProgress).toFixed(2)}`,
  ...(app?.getFrameTimingLines?.() ?? []),
  "drag / 1 finger drag: paint into the texture preview  wheel: brush size",
  "keys: 1 Aurora / 2 Ink / 3 Cells / B burst / C clear / P pause / H help"
];

// WebgApp 初期化後に一度呼び、book 14.5 の方針に沿った help panel を作成する
// app が未初期化なら表示先がないため何もせず、初期化済みなら同じ id の OverlayPanel を登録する
// lastHelpText は次 frame 以降の不要な DOM 更新を避ける比較用として保存する
const showHelpPanel = () => {
  if (!app) return;
  lastHelpText = "";
  app.showOverlayPanel(buildHelpPanelOptions({
    id: "computeTextureHelp",
    collapsed: true,
    title: "Help",
    anchor: "top-left",
    maxWidth: "500px",
    maxHeight: "48vh",
    collapseLabelExpanded: "Hide Help",
    collapseLabelCollapsed: "Show Help",
    lines: buildHelpLines()
  }));
  lastHelpText = buildHelpLines().join("\n");
};

// mode、pause、brush 半径、pointer 状態などが変わった時だけ help panel の本文を更新する
// 前回と同じ文字列なら updateOverlayPanel() を呼ばず、連続描画中の DOM 更新を抑える
// panel が存在しない段階では表示先がないため何もしない
const updateHelpPanel = () => {
  const panel = app?.getOverlayPanel?.("computeTextureHelp");
  if (!panel) return;
  const lines = buildHelpLines();
  const nextHelpText = lines.join("\n");
  if (nextHelpText === lastHelpText) return;
  app.updateOverlayPanel("computeTextureHelp", { lines });
  lastHelpText = nextHelpText;
};

// browser window の CSS pixel サイズを Screen の canvas 実ピクセルへ同期する
// screen が未初期化なら何もせず、初期化後は最低 1 pixel を保証した整数サイズを Screen.resize() に渡す
// Screen.resize() は depth texture も作り直すため、後段の raw render pass が古いサイズを参照しない
const resizeToWindow = () => {
  if (!screen) return;
  screen.resize(
    Math.max(1, Math.floor(window.innerWidth)),
    Math.max(1, Math.floor(window.innerHeight))
  );
};

// storage texture と sampled texture を兼ねる 2 枚の texture を作る
// usage は compute write、sample read、clear 用の CPU upload をすべて許可する
// ping-pong で前 frame と次 frame の役割を交換するため、同じ format と size の texture を 2 枚そろえる
const createStateTextures = () => [0, 1].map((i) => device.createTexture({
  label: `compute_texture state ${i}`,
  size: { width: TEXTURE_SIZE, height: TEXTURE_SIZE, depthOrArrayLayers: 1 },
  format: TEXTURE_FORMAT,
  usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_DST
}));

// Primitive.sphere() が返す seam 対応済み geometry から、raw render pipeline 用の頂点配列を作る
// position、normal、uv を 1 頂点 8 float へ並べ、index は geometry.indices をそのまま使う
// sphere は中心原点、半径 1 の mesh とし、vertex shader 側で回転と平行移動を与える
const createSphereMeshData = () => {
  const asset = Primitive.sphere(1.0, 40, 32).getData();
  const geometry = asset?.meshes?.[0]?.geometry;
  if (!geometry?.positions || !geometry?.uvs || !geometry?.indices) {
    throw new Error("compute_texture requires Primitive.sphere geometry with positions, uvs, and indices");
  }
  const positions = geometry.positions;
  const uvs = geometry.uvs;
  const indices = geometry.indices;
  const vertexCount = positions.length / 3;
  const vertices = new Float32Array(vertexCount * 8);
  for (let i = 0; i < vertexCount; i += 1) {
    const p = i * 3;
    const t = i * 2;
    const d = i * 8;
    const x = positions[p + 0];
    const y = positions[p + 1];
    const z = positions[p + 2];
    const len = Math.hypot(x, y, z);
    if (!(len > 0.0)) {
      throw new Error(`compute_texture sphere vertex ${i} has zero-length position`);
    }
    vertices[d + 0] = x;
    vertices[d + 1] = y;
    vertices[d + 2] = z;
    vertices[d + 3] = x / len;
    vertices[d + 4] = y / len;
    vertices[d + 5] = z / len;
    vertices[d + 6] = uvs[t + 0];
    vertices[d + 7] = uvs[t + 1];
  }
  return {
    vertices,
    indices: new Uint32Array(indices)
  };
};

// 左下 preview 用の quad を NDC と UV の組で作る
// preview は screen 空間で固定し、pointer 入力との対応を常に同じ位置で確認できるようにする
// 境界は fragment shader 側で border を描くため、ここでは位置と UV だけを持てばよい
const createPreviewQuadData = () => new Float32Array([
  -0.92, -0.82, 0.0, 0.0,
  -0.36, -0.82, 1.0, 0.0,
  -0.92, -0.28, 0.0, 1.0,
  -0.92, -0.28, 0.0, 1.0,
  -0.36, -0.82, 1.0, 0.0,
  -0.36, -0.28, 1.0, 1.0
]);

// compute と render に必要な sampler、texture、uniform、bind group、pipeline をまとめて構築する
// compute 側は source texture read + destination texture write、render 側は preview quad と sphere mesh の 2 種類を描く
// 完了後は renderComputeTextureFrame() が global 変数へ保存された resource を前提として command を発行する
const createPipelines = () => {
  textureSampler = device.createSampler({
    label: "compute_texture linear sampler",
    magFilter: "linear",
    minFilter: "linear",
    mipmapFilter: "linear",
    addressModeU: "repeat",
    addressModeV: "repeat"
  });
  stateTextures = createStateTextures();
  statePair = new PingPongTexture(stateTextures, { label: "compute_texture state" });

  paramBuffer = device.createBuffer({
    label: "compute_texture params",
    size: PARAM_FLOATS * Float32Array.BYTES_PER_ELEMENT,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });

  const computeBindGroupLayout = device.createBindGroupLayout({
    label: "compute_texture compute bind group layout",
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "float", viewDimension: "2d" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: "write-only", format: TEXTURE_FORMAT, viewDimension: "2d" } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, sampler: { type: "filtering" } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } }
    ]
  });
  const renderBindGroupLayout = device.createBindGroupLayout({
    label: "compute_texture render bind group layout",
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, texture: { sampleType: "float", viewDimension: "2d" } },
      { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
      { binding: 2, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } }
    ]
  });

  computePipeline = device.createComputePipeline({
    label: "compute_texture compute pipeline",
    layout: device.createPipelineLayout({ bindGroupLayouts: [computeBindGroupLayout] }),
    compute: {
      module: device.createShaderModule({ code: createComputeWGSL() }),
      entryPoint: "main"
    }
  });

  const sphereMesh = createSphereMeshData();
  sphereIndexCount = sphereMesh.indices.length;
  sphereVertexBuffer = device.createBuffer({
    label: "compute_texture sphere vertex buffer",
    size: sphereMesh.vertices.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
  });
  queue.writeBuffer(sphereVertexBuffer, 0, sphereMesh.vertices);
  sphereIndexBuffer = device.createBuffer({
    label: "compute_texture sphere index buffer",
    size: sphereMesh.indices.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST
  });
  queue.writeBuffer(sphereIndexBuffer, 0, sphereMesh.indices);

  const previewQuad = createPreviewQuadData();
  previewVertexBuffer = device.createBuffer({
    label: "compute_texture preview quad",
    size: previewQuad.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
  });
  queue.writeBuffer(previewVertexBuffer, 0, previewQuad);

  const renderModule = device.createShaderModule({ code: createRenderWGSL() });
  sphereRenderPipeline = device.createRenderPipeline({
    label: "compute_texture sphere render pipeline",
    layout: device.createPipelineLayout({ bindGroupLayouts: [renderBindGroupLayout] }),
    vertex: {
      module: renderModule,
      entryPoint: "vsSphere",
      buffers: [{
        arrayStride: 8 * Float32Array.BYTES_PER_ELEMENT,
        attributes: [
          { shaderLocation: 0, offset: 0, format: "float32x3" },
          { shaderLocation: 1, offset: 3 * Float32Array.BYTES_PER_ELEMENT, format: "float32x3" },
          { shaderLocation: 2, offset: 6 * Float32Array.BYTES_PER_ELEMENT, format: "float32x2" }
        ]
      }]
    },
    fragment: {
      module: renderModule,
      entryPoint: "fsSphere",
      targets: [{
        format: screen.getGPU().format
      }]
    },
    primitive: {
      topology: "triangle-list",
      cullMode: "back"
    },
    depthStencil: {
      format: CAMERA_REVERSE_Z.format,
      depthWriteEnabled: true,
      depthCompare: CAMERA_REVERSE_Z.compare
    }
  });

  previewRenderPipeline = device.createRenderPipeline({
    label: "compute_texture preview render pipeline",
    layout: device.createPipelineLayout({ bindGroupLayouts: [renderBindGroupLayout] }),
    vertex: {
      module: renderModule,
      entryPoint: "vsPreview",
      buffers: [{
        arrayStride: 4 * Float32Array.BYTES_PER_ELEMENT,
        attributes: [
          { shaderLocation: 0, offset: 0, format: "float32x2" },
          { shaderLocation: 1, offset: 2 * Float32Array.BYTES_PER_ELEMENT, format: "float32x2" }
        ]
      }]
    },
    fragment: {
      module: renderModule,
      entryPoint: "fsPreview",
      targets: [{
        format: screen.getGPU().format
      }]
    },
    primitive: { topology: "triangle-list" },
    depthStencil: {
      format: CAMERA_REVERSE_Z.format,
      depthWriteEnabled: false,
      depthCompare: "always"
    }
  });

  computeBindGroups = [0, 1].map((sourceIndex) => {
    const destinationIndex = 1 - sourceIndex;
    return device.createBindGroup({
      label: `compute_texture compute bind group ${sourceIndex}`,
      layout: computeBindGroupLayout,
      entries: [
        { binding: 0, resource: stateTextures[sourceIndex].createView() },
        { binding: 1, resource: stateTextures[destinationIndex].createView() },
        { binding: 2, resource: textureSampler },
        { binding: 3, resource: { buffer: paramBuffer } }
      ]
    });
  });

  renderBindGroups = [0, 1].map((textureIndex) => device.createBindGroup({
    label: `compute_texture render bind group ${textureIndex}`,
    layout: renderBindGroupLayout,
    entries: [
      { binding: 0, resource: stateTextures[textureIndex].createView() },
      { binding: 1, resource: textureSampler },
      { binding: 2, resource: { buffer: paramBuffer } }
    ]
  }));
};

// 2 枚の ping-pong texture をゼロ初期化し、次 frame の source index も初期状態へ戻す
// clear は CPU upload だが、毎 frame の模様生成自体は Compute Shader が担当する
// 古い履歴色が次の mode や burst へ残らないよう、両方の texture を同じ内容へそろえる
const resetTextures = () => {
  for (const texture of stateTextures) {
    queue.writeTexture(
      { texture },
      ZERO_TEXTURE_DATA,
      { bytesPerRow: TEXTURE_SIZE * 4 },
      { width: TEXTURE_SIZE, height: TEXTURE_SIZE, depthOrArrayLayers: 1 }
    );
  }
  statePair.reset();
};

// CPU 側で保持している mode ごとの brush color を uniform 配列へ詰める
// index は 0..2 のみ有効で、画面表示と shader 注入色を同じ mode 切替で統一する
const getBrushColor = () => BRUSH_COLORS[modeIndex];

// 1 frame 分の time、pointer、mode、brush 半径を uniform buffer へ並べて転送する
// 配列 index と WGSL の TextureParams 配置は対応しているため、順序変更時は shader 側も同時に直す必要がある
// pointerDown と pointerInkEnergy は役割を分け、押下中かどうかとは別に「注入の残り」を shader へ渡す
// brushColor.w と screen.zw は click pulse の進行度と中心座標に使い、通常の brush 注入とは別の演出経路を持たせる
const writeParams = (deltaSec, timeSec) => {
  const params = new Float32Array(PARAM_FLOATS);
  const brushColor = getBrushColor();
  params[0] = TEXTURE_SIZE;
  params[1] = TEXTURE_SIZE;
  params[2] = 1.0 / TEXTURE_SIZE;
  params[3] = 1.0 / TEXTURE_SIZE;
  params[4] = timeSec;
  params[5] = deltaSec;
  params[6] = brushRadius;
  params[7] = pointerInkEnergy;
  params[8] = pointerUvX;
  params[9] = pointerUvY;
  params[10] = modeIndex;
  params[11] = burstEnergy;
  params[12] = brushColor[0];
  params[13] = brushColor[1];
  params[14] = brushColor[2];
  params[15] = pointerPulseProgress;
  params[16] = screen.getWidth();
  params[17] = screen.getHeight();
  params[18] = pointerPulseUvX;
  params[19] = pointerPulseUvY;
  queue.writeBuffer(paramBuffer, 0, params);
};

// Compute Shader 用の WGSL source を文字列として生成する
// sampled texture を読み、近傍拡散、流れ場、mode ごとの背景波形、pointer 注入、click pulse、burst を合成して次 texture へ書く
// 1 invocation = 1 pixel で動き、CPU 側は座標や色を与えるだけで模様生成自体には関与しない
const createComputeWGSL = () => `
struct TextureParams {
  resolution: vec4<f32>,
  timing: vec4<f32>,
  pointer: vec4<f32>,
  brushColor: vec4<f32>,
  screen: vec4<f32>,
};

@group(0) @binding(0) var previousTexture: texture_2d<f32>;
@group(0) @binding(1) var nextTexture: texture_storage_2d<${TEXTURE_FORMAT}, write>;
@group(0) @binding(2) var linearSampler: sampler;
@group(0) @binding(3) var<uniform> params: TextureParams;

fn sampleWrapped(uv: vec2<f32>) -> vec3<f32> {
  return textureSampleLevel(previousTexture, linearSampler, fract(uv), 0.0).rgb;
}

fn hash21(p: vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453123);
}

fn modePalette(uv: vec2<f32>, time: f32, mode: f32) -> vec3<f32> {
  let waveA = 0.5 + 0.5 * sin(time * 0.42 + uv.x * 9.0 + uv.y * 5.5);
  let waveB = 0.5 + 0.5 * cos(time * 0.31 + uv.x * 6.0 - uv.y * 10.0);
  let waveC = 0.5 + 0.5 * sin(time * 0.57 + length(uv - vec2<f32>(0.5, 0.5)) * 18.0);
  if (mode < 0.5) {
    let warm = vec3<f32>(1.0, 0.48, 0.10);
    let cool = vec3<f32>(0.12, 0.82, 1.0);
    let glow = vec3<f32>(0.96, 0.90, 0.28);
    return mix(mix(cool, warm, waveA), glow, waveC * 0.28);
  }
  if (mode < 1.5) {
    let cyan = vec3<f32>(0.10, 0.92, 0.95);
    let coral = vec3<f32>(1.0, 0.34, 0.16);
    let mist = vec3<f32>(0.94, 0.97, 1.0);
    return mix(mix(cyan, coral, waveB), mist, waveA * 0.18);
  }
  let lime = vec3<f32>(0.78, 0.96, 0.20);
  let amber = vec3<f32>(1.0, 0.76, 0.08);
  let deep = vec3<f32>(0.08, 0.14, 0.06);
  return mix(deep, mix(lime, amber, waveA), max(waveB, waveC));
}

@compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE}, 1)
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let size = vec2<u32>(u32(params.resolution.x), u32(params.resolution.y));
  if (globalId.x >= size.x || globalId.y >= size.y) {
    return;
  }

  let coord = vec2<i32>(i32(globalId.x), i32(globalId.y));
  let uv = (vec2<f32>(f32(globalId.x), f32(globalId.y)) + vec2<f32>(0.5, 0.5)) * params.resolution.zw;
  let texel = params.resolution.zw;
  let time = params.timing.x;
  let radius = params.timing.z;
  let pointerStrength = params.timing.w;
  let mode = params.pointer.z;
  let pulseProgress = params.brushColor.a;

  let left = sampleWrapped(uv + vec2<f32>(-texel.x, 0.0));
  let right = sampleWrapped(uv + vec2<f32>(texel.x, 0.0));
  let up = sampleWrapped(uv + vec2<f32>(0.0, texel.y));
  let down = sampleWrapped(uv + vec2<f32>(0.0, -texel.y));
  let diagA = sampleWrapped(uv + vec2<f32>(texel.x, texel.y));
  let diagB = sampleWrapped(uv + vec2<f32>(-texel.x, texel.y));
  let diagC = sampleWrapped(uv + vec2<f32>(texel.x, -texel.y));
  let diagD = sampleWrapped(uv + vec2<f32>(-texel.x, -texel.y));

  let flowSeed = sin(time * 0.43 + uv.y * (8.0 + mode * 2.0)) + cos(time * 0.37 + uv.x * (10.0 + mode * 1.7));
  let flowAngle = flowSeed + hash21(uv * (32.0 + mode * 11.0)) * 6.2831853;
  let flowStrength = (4.0 + mode * 2.2) * (0.7 + 0.3 * sin(time * 0.28 + uv.x * 5.0));
  let flow = vec2<f32>(cos(flowAngle), sin(flowAngle)) * texel * flowStrength;

  let advected = sampleWrapped(uv - flow);
  let average4 = (left + right + up + down) * 0.25;
  let average8 = (average4 + (diagA + diagB + diagC + diagD) * 0.125) * 0.5;
  let background = modePalette(uv, time, mode);
  let accent = modePalette(
    uv + vec2<f32>(
      sin(time * 0.19 + uv.y * 7.0) * 0.035,
      cos(time * 0.23 + uv.x * 8.0) * 0.035
    ),
    time * 1.18 + 0.6,
    mode
  );

  var color = mix(advected, average8, 0.12 + mode * 0.025);
  color = color * 0.9985 + background * (0.018 + mode * 0.005) + accent * (0.010 + mode * 0.004);
  color = max(color - vec3<f32>(0.00003, 0.00003, 0.00003), background * (0.012 + mode * 0.004));

  if (pointerStrength > 0.0) {
    let pointerUv = params.pointer.xy;
    let pointerDistance = distance(uv, pointerUv);
    if (pointerDistance < radius) {
      let brush = smoothstep(radius, 0.0, pointerDistance);
      let swirl = vec3<f32>(brush * 0.26, brush * 0.15, brush * 0.34);
      let halo = smoothstep(radius * 1.7, 0.0, pointerDistance) * 0.28;
      color = color + params.brushColor.rgb * brush * (0.92 * pointerStrength) + swirl + params.brushColor.rgb * halo;
    }
  }

  if (pulseProgress < 1.0) {
    let pulseUv = params.screen.zw;
    let pulseDistance = distance(uv, pulseUv);
    let pulseFade = pow(1.0 - clamp(pulseProgress, 0.0, 1.0), 1.35);
    let pulseRadius = mix(radius * 0.28, radius * 4.6, pulseProgress);
    let pulseWidth = mix(radius * 0.40, radius * 1.30, pulseProgress);
    let ring = exp(-pow((pulseDistance - pulseRadius) / max(pulseWidth, 0.0008), 2.0) * 4.6);
    let core = smoothstep(radius * 0.78, 0.0, pulseDistance) * pulseFade;
    let pulseColor = modePalette(
      pulseUv + vec2<f32>(pulseProgress * 0.23, -pulseProgress * 0.17),
      time + pulseProgress * 2.4,
      mode
    );
    let inverted = (vec3<f32>(1.0, 1.0, 1.0) - color) * 0.82 + pulseColor * 0.58;
    color = mix(color, inverted, ring * pulseFade * 0.78);
    color = color + pulseColor * ring * pulseFade * 0.24 + pulseColor * core * 0.18;
  }

  let burst = params.pointer.w;
  if (burst > 0.0) {
    let centerDistance = distance(uv, vec2<f32>(0.5, 0.5));
    let ringRadius = 0.08 + burst * 0.18;
    let ring = exp(-abs(centerDistance - ringRadius) * 58.0);
    color = color + modePalette(uv + vec2<f32>(time * 0.02, -time * 0.015), time, mode) * ring * 0.54;
  }

  if (mode > 1.5) {
    let energy = dot(color, vec3<f32>(0.2126, 0.7152, 0.0722));
    let cell = smoothstep(0.34, 0.66, fract(energy * 4.5 + sin(uv.x * 20.0 + time) * 0.16));
    color = mix(color * 0.82, background, cell * 0.30);
  }

  textureStore(nextTexture, coord, vec4<f32>(clamp(color, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0));
}
`;

// render 用の WGSL source を文字列として生成する
// Primitive.sphere() の seam 対応済み UV を使う球 mesh と、screen 固定の preview quad を同じ texture で描く
// 球体は directional light、specular、rim light を使い、preview では pointer と texture 更新位置の対応を確認できる
const createRenderWGSL = () => `
struct TextureParams {
  resolution: vec4<f32>,
  timing: vec4<f32>,
  pointer: vec4<f32>,
  brushColor: vec4<f32>,
  screen: vec4<f32>,
};

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) viewDir: vec3<f32>,
};

@group(0) @binding(0) var colorTexture: texture_2d<f32>;
@group(0) @binding(1) var linearSampler: sampler;
@group(0) @binding(2) var<uniform> params: TextureParams;

fn rotateY(v: vec3<f32>, angle: f32) -> vec3<f32> {
  let s = sin(angle);
  let c = cos(angle);
  return vec3<f32>(
    c * v.x + s * v.z,
    v.y,
    -s * v.x + c * v.z
  );
}

@vertex
fn vsSphere(
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) uv: vec2<f32>
) -> VertexOut {
  let angle = params.timing.x * 0.34;
  let rotatedPos = rotateY(position * 1.28, angle) + vec3<f32>(0.55, 0.20, 0.0);
  let rotatedNormal = normalize(rotateY(normal, angle));
  let cameraPos = vec3<f32>(0.0, 0.0, 5.6);
  let viewPos = rotatedPos - cameraPos;
  let aspect = max(params.screen.x / max(params.screen.y, 1.0), 0.0001);
  let f = 1.0 / tan(0.5 * 0.88);
  let w = max(-viewPos.z, 0.001);
  var out: VertexOut;
  out.position = vec4<f32>(
    viewPos.x * f / (aspect * w),
    viewPos.y * f / w,
    clamp((w - 0.1) / 12.0, 0.0, 1.0),
    1.0
  );
  out.uv = uv;
  out.normal = rotatedNormal;
  out.viewDir = normalize(cameraPos - rotatedPos);
  return out;
}

@fragment
fn fsSphere(in: VertexOut) -> @location(0) vec4<f32> {
  var n = normalize(in.normal);
  let v = normalize(in.viewDir);
  if (dot(n, v) < 0.0) {
    n = -n;
  }
  let tex = textureSampleLevel(colorTexture, linearSampler, fract(in.uv), 0.0).rgb;
  let lightDir = normalize(vec3<f32>(-0.42, 0.76, 0.48));
  let halfDir = normalize(lightDir + v);
  let diffuse = max(dot(n, lightDir), 0.0);
  let specular = pow(max(dot(n, halfDir), 0.0), 46.0) * 0.42;
  let fresnel = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  let shade = 0.10 + diffuse * 0.94;
  let rim = vec3<f32>(0.76, 0.90, 1.0) * fresnel * 0.18;
  let color = tex * shade + vec3<f32>(1.0, 0.98, 0.92) * specular + rim;
  return vec4<f32>(pow(color, vec3<f32>(0.92, 0.92, 0.92)), 1.0);
}

@vertex
fn vsPreview(
  @location(0) position: vec2<f32>,
  @location(1) uv: vec2<f32>
) -> VertexOut {
  var out: VertexOut;
  out.position = vec4<f32>(position, 0.0, 1.0);
  out.uv = uv;
  out.normal = vec3<f32>(0.0, 0.0, 1.0);
  out.viewDir = vec3<f32>(0.0, 0.0, 1.0);
  return out;
}

@fragment
fn fsPreview(in: VertexOut) -> @location(0) vec4<f32> {
  let tex = textureSampleLevel(colorTexture, linearSampler, in.uv, 0.0).rgb;
  let edgeX = min(in.uv.x, 1.0 - in.uv.x);
  let edgeY = min(in.uv.y, 1.0 - in.uv.y);
  let edge = smoothstep(0.0, 0.024, min(edgeX, edgeY));
  let border = vec3<f32>(0.94, 0.97, 1.0) * (1.0 - edge);
  let color = mix(border, tex, edge);
  return vec4<f32>(pow(color, vec3<f32>(0.92, 0.92, 0.92)), 1.0);
}
`;

// key と touch button の両方から呼び、sample 状態の切替を一か所で行う
// mode 切替、burst、clear、pause、help、brush 半径変更を担当し、実際の texture 更新は次 frame の compute に任せる
// 想定外の key は false を返し、呼び出し側が「この key はこの sample では使わない」と判断できるようにする
const applyActionKey = (key) => {
  const lower = String(key).toLowerCase();
  if (lower === "1") {
    modeIndex = 0;
    return true;
  }
  if (lower === "2") {
    modeIndex = 1;
    return true;
  }
  if (lower === "3") {
    modeIndex = 2;
    return true;
  }
  if (lower === "b" || lower === " ") {
    burstEnergy = 1.0;
    return true;
  }
  if (lower === "c") {
    resetTextures();
    pointerInkEnergy = 0.0;
    pointerPulseProgress = 1.0;
    return true;
  }
  if (lower === "p") {
    paused = !paused;
    return true;
  }
  if (lower === "h") {
    const panel = app?.getOverlayPanel?.("computeTextureHelp");
    panel?.setCollapsed?.(!panel.collapsed);
    return true;
  }
  if (lower === "-") {
    brushRadius = Math.max(0.015, brushRadius - 0.008);
    return true;
  }
  if (lower === "+" || lower === "=") {
    brushRadius = Math.min(0.180, brushRadius + 0.008);
    return true;
  }
  return false;
};

// canvas 上の client 座標を texture 更新に使う UV へ変換して保存する
// screen が未初期化なら変換できないため false を返し、呼び出し側は pointer 状態更新だけに留める
// clamp した 0..1 の UV を使うことで、canvas 外の少しのはみ出しでも shader 側の距離計算を破綻させない
// texture 座標系は上が 0、下が 1 なので、screen の Y も反転せずそのまま正規化する
const updatePointerUvFromClient = (clientX, clientY) => {
  if (!screen?.canvas) return false;
  const rect = screen.canvas.getBoundingClientRect();
  if (rect.width <= 0.0 || rect.height <= 0.0) return false;
  pointerUvX = Math.max(0.0, Math.min(1.0, (clientX - rect.left) / rect.width));
  pointerUvY = Math.max(0.0, Math.min(1.0, (clientY - rect.top) / rect.height));
  return true;
};

// paint を開始した pointer の座標を保存し、以後の move でも同じ pointer を追跡できるよう capture を設定する
// この sample では drag 自体が texture への注入操作なので、down と同時に pointerDown を true にし、残像用エネルギーも最大へ戻す
// click pulse は down 時点の座標を中心に固定し、後続の drag があっても「最初に押した位置から輪が広がる」演出に使う
const handlePointerDown = (event) => {
  if (event.button !== undefined && event.button !== 0) return;
  if (!updatePointerUvFromClient(event.clientX, event.clientY)) return;
  pointerDown = true;
  pointerInkEnergy = POINTER_INK_MAX;
  pointerPulseProgress = 0.0;
  pointerPulseUvX = pointerUvX;
  pointerPulseUvY = pointerUvY;
  event.currentTarget.setPointerCapture(event.pointerId);
  event.preventDefault();
};

// drag 中の pointer を texture への描画座標として更新する
// pointer が押されていない move は paint と見なさず、hover だけで色が出ないようにする
// drag 継続中は残像用エネルギーも再充填し、長押しや連続ドラッグで注入が弱まらないようにする
const handlePointerMove = (event) => {
  if (!pointerDown) return;
  updatePointerUvFromClient(event.clientX, event.clientY);
  pointerInkEnergy = POINTER_INK_MAX;
  event.preventDefault();
};

// pointer 終了時に注入を止め、pointer capture を解放する
// pointerup と pointercancel の両方から呼ばれるため、通常終了と browser 都合の中断を同じ後始末で扱う
// ここでは pointerDown だけを落とし、残像用エネルギーは render loop 側の減衰で徐々に消す
const handlePointerUp = (event) => {
  pointerDown = false;
  if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
    event.currentTarget.releasePointerCapture(event.pointerId);
  }
  event.preventDefault();
};

// wheel の上下量を brush 半径の増減へ変換する
// 極端に細い / 太い値は明示範囲へ制限し、page scroll は preventDefault() で止める
const handleWheel = (event) => {
  brushRadius = Math.max(0.015, Math.min(0.180, brushRadius + event.deltaY * 0.00008));
  event.preventDefault();
};

// 1 frame の compute と render に必要な command を順番に発行する
// source texture を読み、destination texture へ compute で書き、その直後に destination を sphere mesh と preview quad へ描く
// submit 後に statePair の現在indexを進め、burst は 1 frame 限定で消費し、pointer の残像エネルギーと click pulse は毎 frame 少しずつ減衰・進行させる
const renderComputeTextureFrame = (timeMs, elapsedSec) => {
  const deltaSec = paused ? 0.0 : Math.min(elapsedSec, 1.0 / 30.0);
  const timeSec = timeMs * 0.001;
  const sourceIndex = statePair.getCurrentIndex();
  const destinationIndex = statePair.getNextIndex();
  writeParams(deltaSec, timeSec);

  const commandEncoder = device.createCommandEncoder({ label: "compute_texture frame encoder" });
  app.beginGpuTiming();
  let renderTextureIndex = sourceIndex;
  if (!paused) {
    const computePass = commandEncoder.beginComputePass({
      label: "compute_texture compute pass",
      timestampWrites: app.getGpuTimestampWrites(true, true)
    });
    computePass.setPipeline(computePipeline);
    computePass.setBindGroup(0, computeBindGroups[sourceIndex]);
    computePass.dispatchWorkgroups(
      Math.ceil(TEXTURE_SIZE / WORKGROUP_SIZE),
      Math.ceil(TEXTURE_SIZE / WORKGROUP_SIZE)
    );
    computePass.end();
    renderTextureIndex = destinationIndex;
  }

  const colorView = screen.getGPU().context.getCurrentTexture().createView();
  const renderPass = commandEncoder.beginRenderPass({
    label: "compute_texture render pass",
    timestampWrites: app.getGpuRenderTimestampWrites(),
    colorAttachments: [{
      view: colorView,
      loadOp: "clear",
      storeOp: "store",
      clearValue: { r: CLEAR_COLOR[0], g: CLEAR_COLOR[1], b: CLEAR_COLOR[2], a: CLEAR_COLOR[3] }
    }],
    depthStencilAttachment: {
      view: screen.getGPU().depthView,
      depthLoadOp: "clear",
      depthStoreOp: "store",
      depthClearValue: CAMERA_REVERSE_Z.clearValue
    }
  });
  renderPass.setPipeline(sphereRenderPipeline);
  renderPass.setBindGroup(0, renderBindGroups[renderTextureIndex]);
  renderPass.setVertexBuffer(0, sphereVertexBuffer);
  renderPass.setIndexBuffer(sphereIndexBuffer, "uint32");
  renderPass.drawIndexed(sphereIndexCount, 1, 0, 0, 0);
  renderPass.setPipeline(previewRenderPipeline);
  renderPass.setBindGroup(0, renderBindGroups[renderTextureIndex]);
  renderPass.setVertexBuffer(0, previewVertexBuffer);
  renderPass.draw(6, 1, 0, 0);
  renderPass.end();

  app.endGpuTiming(commandEncoder);
  queue.submit([commandEncoder.finish()]);
  app.afterGpuSubmit();
  if (!paused) {
    statePair.setCurrentIndex(destinationIndex);
    burstEnergy = 0.0;
    pointerInkEnergy = Math.max(0.0, pointerInkEnergy - deltaSec * POINTER_INK_DECAY_PER_SEC);
    pointerPulseProgress = Math.min(1.0, pointerPulseProgress + deltaSec * POINTER_PULSE_PROGRESS_PER_SEC);
  }
  updateHelpPanel();
};

// keyboard と touch button の両方を同じ action 処理へつなぐ
// attachInput() は repeat を抑止し、touch controls は同じ key 名で onAction を呼ぶ
// PC とスマートフォンのどちらでも mode 切替や clear を同じ意味で使えるようにする
const installInput = () => {
  app.attachInput({
    onKeyDown: (key, ev) => {
      if (ev.repeat) return;
      applyActionKey(key);
    }
  });
  app.input.installTouchControls({
    touchDeviceOnly: false,
    groups: [
      {
        id: "mode",
        buttons: [
          { key: "1", label: "1", kind: "action", ariaLabel: "Aurora mode" },
          { key: "2", label: "2", kind: "action", ariaLabel: "Ink mode" },
          { key: "3", label: "3", kind: "action", ariaLabel: "Cells mode" }
        ]
      },
      {
        id: "action",
        buttons: [
          { key: "b", label: "B", kind: "action", ariaLabel: "center burst" },
          { key: "c", label: "C", kind: "action", ariaLabel: "clear texture" },
          { key: "p", label: "P", kind: "action", ariaLabel: "pause or resume" },
          { key: "h", label: "H", kind: "action", ariaLabel: "toggle help" }
        ]
      },
      {
        id: "brush",
        buttons: [
          { key: "-", label: "-", kind: "action", ariaLabel: "decrease brush radius" },
          { key: "+", label: "+", kind: "action", ariaLabel: "increase brush radius" }
        ]
      }
    ],
    onAction: ({ key }) => applyActionKey(String(key).toLowerCase())
  });
};

// DOMContentLoaded 後に一度呼ばれ、WebgApp から連続描画を開始するまでの初期化を順番に行う
// WebgApp.init() 完了後に Screen / device / queue を取得し、resize、入力 listener、GPU pipeline、help panel を準備する
// computeFrameを有効にし、WebgAppの正式handlerからtexture更新と描画をCompute-first順で実行する
const start = async () => {
  app = new WebgApp({
    document,
    computeFrame: true,
    clearColor: CLEAR_COLOR,
    renderMode: "ondemand",
    useMessage: false,
    setDefaultShapeShader: false,
    debugTools: {
      mode: "release",
      system: "compute_texture",
      source: "samples/compute_texture/main.js"
    }
  });
  await app.init();
  screen = app.screen;
  device = app.getGPU().device;
  queue = app.getGPU().queue;
  screen.canvas.style.touchAction = "none";
  resizeToWindow();
  window.addEventListener("resize", resizeToWindow);
  window.addEventListener("orientationchange", resizeToWindow);
  screen.canvas.addEventListener("pointerdown", handlePointerDown);
  screen.canvas.addEventListener("pointermove", handlePointerMove);
  screen.canvas.addEventListener("pointerup", handlePointerUp);
  screen.canvas.addEventListener("pointercancel", handlePointerUp);
  screen.canvas.addEventListener("wheel", handleWheel, { passive: false });
  screen.canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  createPipelines();
  resetTextures();
  installInput();
  showHelpPanel();
  app.start({
    onComputeFrame: (ctx) => {
      renderComputeTextureFrame(ctx.timeMs, ctx.deltaSec);
    }
  });
};

// HTML の解析完了を待って start() を呼ぶ entry point
// 非同期初期化に失敗した場合は console と OverlayPanel の両方へ同じ error を出し、黒画面だけで失敗を隠さない
document.addEventListener("DOMContentLoaded", () => {
  start().catch((error) => {
    console.error("compute_texture failed:", error);
    app?.showOverlayPanel?.(buildErrorPanelOptions(error, {
      title: "compute_texture failed",
      id: "start-error",
      background: "rgba(26, 22, 32, 0.92)"
    }));
  });
});
