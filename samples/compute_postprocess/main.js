// ---------------------------------------------
// samples/compute_postprocess/main.js  2026/07/25
//   Compute Shader postprocess sample
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

const OUTPUT_FORMAT = "rgba8unorm";
const WORKGROUP_SIZE = 8;
const PARAM_FLOATS = 16;

const DEFAULTS = {
  enabled: true,
  mode: 0,
  edgeStrength: 0.78,
  sharpness: 0.58,
  vignette: 0.42,
  chromaticOffset: 3.0
};

const GUIDE_LINES = [
  "CommandPalette: double tap canvas or press /",
  "Drag or Arrow keys: orbit camera",
  "[ / ] or wheel: zoom",
  "Use palette controls to compare film, edge and heat modes"
];

let app = null;
let palette = null;
let lastHelpText = "";

// ヘルプの行を生成し、後続処理で利用できる状態にする
function buildHelpLines() {
  const pass = app?.computePostprocessPass;
  const state = app?.computePostprocessState;
  return [
    ...GUIDE_LINES,
    "",
    `Compute: ${pass?.enabled ? "ON" : "OFF"} / view: ${state?.view ?? "--"} / mode: ${pass ? modeLabel(pass.mode) : "--"}`,
    `Edge: ${pass?.edgeStrength?.toFixed?.(2) ?? "--"} / sharp: ${pass?.sharpness?.toFixed?.(2) ?? "--"}`,
    `Vignette: ${pass?.vignette?.toFixed?.(2) ?? "--"} / chromatic: ${pass?.chromaticOffset?.toFixed?.(1) ?? "--"}`,
    `Pause: ${state?.paused ? "ON" : "OFF"}`,
    ...(app?.getFrameTimingLines?.() ?? [])
  ];
}

// ヘルプのパネルを現在の入力と実行状態に合わせて更新する
function updateHelpPanel() {
  const panel = app?.getOverlayPanel?.("computePostprocessHelp");
  if (!panel) return;
  const lines = buildHelpLines();
  const nextText = lines.join("\n");
  if (nextText === lastHelpText) return;
  app.updateOverlayPanel("computePostprocessHelp", { lines });
  lastHelpText = nextText;
}

// ComputePostprocessPass は webg core の Postprocess pass クラスを増やさず、
// sample 内だけで完結する compute shader 版の後処理をまとめる小さな wrapper です
// 入力は sceneTarget の color texture、出力は storage texture として作った RenderTarget で、
// 最終的な canvas へのコピーだけは既存の FullscreenPass に任せます
class ComputePostprocessPass {
  constructor(gpu, options = {}) {
    // WebgApp.getGPU() から得た WebGPUContext を保持します
    // device / queue は core を経由せず、WebGPU の低レイヤ API を直接使うために取り出します
    this.gpu = gpu;
    this.device = gpu.device;
    this.queue = gpu.queue;
    // storage texture は canvas と同じピクセル数で dispatch するため、
    // 幅と高さは常に正の整数へ丸めて保持します
    this.width = Math.max(1, Math.floor(options.width ?? 1));
    this.height = Math.max(1, Math.floor(options.height ?? 1));
    // storage texture の format は WGSL の texture_storage_2d<format, write> と一致している必要があります
    // swapchain の bgra8unorm は storage texture として扱いにくい環境があるため、出力用は rgba8unorm に固定します
    this.format = options.format ?? OUTPUT_FORMAT;
    // 操作キーから直接変更される postprocess parameter 群です
    // 毎 frame writeParams() で uniform buffer へ転送され、WGSL 側の Params に対応します
    this.enabled = options.enabled ?? DEFAULTS.enabled;
    this.mode = options.mode ?? DEFAULTS.mode;
    this.edgeStrength = options.edgeStrength ?? DEFAULTS.edgeStrength;
    this.sharpness = options.sharpness ?? DEFAULTS.sharpness;
    this.vignette = options.vignette ?? DEFAULTS.vignette;
    this.chromaticOffset = options.chromaticOffset ?? DEFAULTS.chromaticOffset;
    this.timeSec = 0.0;
    this.paramData = new Float32Array(PARAM_FLOATS);
    this.outputTarget = null;
    this.paramBuffer = null;
    this.bindGroupLayout = null;
    this.pipeline = null;
    this.bindGroupCache = new WeakMap();
    this.createResources();
  }

  // compute shader に必要な uniform buffer、bind group layout、pipeline、出力 texture を作ります
  // この sample では shader module も pass wrapper の中で生成し、webg/*.js には新しいクラスを追加しません
  createResources() {
    // Params は vec4f x 4 の 16 float として WGSL に渡します
    // 余裕を持った固定長にしておくと、後から effect parameter を増やすときも layout を崩しにくくなります
    this.paramBuffer = this.device.createBuffer({
      label: "compute_postprocess params",
      size: PARAM_FLOATS * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    this.bindGroupLayout = this.device.createBindGroupLayout({
      label: "compute_postprocess bind group layout",
      entries: [
        // binding 0: offscreen に描いた scene color。compute shader から textureLoad() で読みます
        { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "float" } },
        // binding 1: compute shader の書き込み先。storage texture は sampler ではなく textureStore() で更新します
        { binding: 1, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: "write-only", format: this.format } },
        // binding 2: キー操作で変わる effect parameter をまとめた uniform buffer です
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } }
      ]
    });

    const shaderModule = this.device.createShaderModule({
      label: "compute_postprocess shader",
      code: this.createWGSL()
    });

    this.pipeline = this.device.createComputePipeline({
      label: "compute_postprocess pipeline",
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.bindGroupLayout] }),
      compute: {
        module: shaderModule,
        entryPoint: "main"
      }
    });

    this.outputTarget = this.createOutputTarget(this.width, this.height);
  }

  // 出力の対象を生成し、後続処理で利用できる状態にする
  createOutputTarget(width, height) {
    // 出力 target は compute shader から書き込むため STORAGE_BINDING が必須です
    // その後 FullscreenPass で読むため TEXTURE_BINDING も付け、debug / capture 用に COPY_SRC も残します
    // RENDER_ATTACHMENT は直接描画には使っていませんが、RenderTarget としての汎用性を保つため付与しています
    const target = app.screen.createRenderTarget({
      label: "compute-postprocess-output",
      width,
      height,
      format: this.format,
      hasDepth: false,
      usage: GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.COPY_SRC
    });
    return target;
  }

  // `wgsl`を生成し、後続処理で利用できる状態にする
  createWGSL() {
    return `
// JavaScript 側の Float32Array(16) と対応する uniform です
// control.x = enabled, control.y = mode, control.zw = texture size
// effect.x = edge, effect.y = sharpness, effect.z = vignette, effect.w = chromatic offset
struct Params {
  control : vec4f,
  effect : vec4f,
  color : vec4f,
  spare : vec4f,
};

@group(0) @binding(0) var sceneTexture : texture_2d<f32>;
@group(0) @binding(1) var outputTexture : texture_storage_2d<${this.format}, write>;
@group(0) @binding(2) var<uniform> params : Params;

// coord が画面端の外へ出た場合も一番近い pixel を読む helper です
// edge / blur / chromatic shift は近傍 pixel を読むため、端で範囲外参照しないよう clamp します
fn readPixel(coord : vec2<i32>, size : vec2<i32>) -> vec3f {
  let clamped = clamp(coord, vec2<i32>(0, 0), size - vec2<i32>(1, 1));
  return textureLoad(sceneTexture, clamped, 0).rgb;
}

// 輝度を求める helper です。Sobel edge と debug heat view の両方で使います
fn luma(color : vec3f) -> f32 {
  return dot(color, vec3f(0.2126, 0.7152, 0.0722));
}

// film mode の最後で使う簡易 tone mapping です
// sharpness や edge 加算で 1.0 を超えた色を、白飛びしすぎない範囲へ押し戻します
fn acesApprox(color : vec3f) -> vec3f {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((color * (a * color + b)) / (color * (c * color + d) + e), vec3f(0.0), vec3f(1.0));
}

@compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE}, 1)
fn main(@builtin(global_invocation_id) globalId : vec3<u32>) {
  // invocation 1つが output texture の pixel 1つを担当します
  // 端数 workgroup が発生するため、textureDimensions() を越えた invocation は何もせず戻ります
  let sizeU = textureDimensions(sceneTexture);
  if (globalId.x >= sizeU.x || globalId.y >= sizeU.y) {
    return;
  }

  let coord = vec2<i32>(globalId.xy);
  let size = vec2<i32>(sizeU);
  let uv = (vec2f(globalId.xy) + vec2f(0.5)) / vec2f(sizeU);
  let edgeStrength = params.effect.x;
  let sharpness = params.effect.y;
  let vignetteStrength = params.effect.z;
  let chromaticOffset = i32(round(params.effect.w));
  let mode = i32(round(params.control.y));

  // 中心 pixel と 8近傍を読みます
  // blur、sharpness、Sobel edge は同じ 3x3 近傍を使うため、先にまとめて取得します
  let center = readPixel(coord, size);
  let left = readPixel(coord + vec2<i32>(-1, 0), size);
  let right = readPixel(coord + vec2<i32>(1, 0), size);
  let up = readPixel(coord + vec2<i32>(0, -1), size);
  let down = readPixel(coord + vec2<i32>(0, 1), size);
  let upLeft = readPixel(coord + vec2<i32>(-1, -1), size);
  let upRight = readPixel(coord + vec2<i32>(1, -1), size);
  let downLeft = readPixel(coord + vec2<i32>(-1, 1), size);
  let downRight = readPixel(coord + vec2<i32>(1, 1), size);
  // 3x3 の軽い blur を作り、center との差分を足し戻すことで局所コントラストを上げます
  // sharpness が大きいほど、輪郭・ハイライト・暗い境界が硬く見えるようになります
  let blur = (center * 4.0 + (left + right + up + down) * 2.0 + upLeft + upRight + downLeft + downRight) / 16.0;
  let sharp = clamp(center + (center - blur) * sharpness * 8.0, vec3f(0.0), vec3f(3.0));

  // Sobel filter で横方向 gx と縦方向 gy の明暗変化を求めます
  // edge mode ではこの値を直接表示し、film mode では黒線 + 暖色ハイライトとして混ぜます
  let gx = -luma(upLeft) - 2.0 * luma(left) - luma(downLeft)
    + luma(upRight) + 2.0 * luma(right) + luma(downRight);
  let gy = -luma(upLeft) - 2.0 * luma(up) - luma(upRight)
    + luma(downLeft) + 2.0 * luma(down) + luma(downRight);
  let edge = clamp(sqrt(gx * gx + gy * gy) * 2.2, 0.0, 1.0);
  let edgeMask = smoothstep(0.06, 0.32, edge) * edgeStrength;

  // chromatic offset は R と B だけを左右にずらして読み、色収差のようなズレを作ります
  // G は sharpness 後の値を使い、赤青のズレだけが目に入るようにしています
  let red = readPixel(coord + vec2<i32>(chromaticOffset, 0), size).r;
  let blue = readPixel(coord + vec2<i32>(-chromaticOffset, 0), size).b;
  var color = vec3f(red, sharp.g, blue);

  // film mode の基本色調整です。画面上側を少し冷たく、下側を少し暖かく寄せます
  // その後 edgeMask で輪郭に黒い線と暖色の光を足し、変化を確認しやすくしています
  let filmTint = mix(vec3f(1.02, 0.98, 0.90), vec3f(0.88, 0.96, 1.05), uv.y);
  color *= filmTint;
  color = mix(color, vec3f(0.0, 0.0, 0.0), clamp(edgeMask * 0.82, 0.0, 1.0));
  color += vec3f(1.0, 0.72, 0.24) * edgeMask * 0.42;

  // 白い vignette です。中心から離れるほど vignetteMask が増え、周辺が白に近づきます
  // 通常の暗い vignette より差が見えやすいので、compute pass の確認用として使っています
  let centered = uv * 2.0 - vec2f(1.0);
  let radius = dot(centered, centered);
  let vignetteMask = smoothstep(0.34, 1.38, radius) * vignetteStrength;
  let vignette = 1.0 - vignetteMask;
  color = mix(color, vec3f(1.0), vignetteMask);

  // mode で最終表示を切り替えます
  // film: 複合後処理、edge: Sobel の確認、heat: edge / sharpness / vignette をRGB別に可視化します
  if (mode == 1) {
    color = mix(vec3f(edge), vec3f(0.10, 0.88, 1.0), edge * 0.65);
  } else if (mode == 2) {
    color = vec3f(edge, luma(sharp), 1.0 - vignette);
  } else {
    color = acesApprox(color);
  }

  // C key で disabled のときは、compute pass 自体は通しつつ scene color をそのままコピーします
  // dispatch の有無を変えないため、ON/OFF 比較で command 構成の差を減らせます
  if (params.control.x < 0.5) {
    color = center;
  }

  // storage texture へ最終 pixel を書き込みます
  // compute pass は render pass ではないため、ここで直接 canvas へは書かず、後段の FullscreenPass で表示します
  textureStore(outputTexture, vec2<i32>(globalId.xy), vec4f(color, 1.0));
}`;
  }

  getOutputTarget() {
    return this.outputTarget;
  }

  // canvas サイズが変わったら output storage texture も同じサイズへ追従させます
  // texture view が作り直されるため、古い view を握る bind group cache は破棄します
  resizeToScreen(screen) {
    const width = screen.getWidth();
    const height = screen.getHeight();
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.outputTarget.resize(width, height);
    this.bindGroupCache = new WeakMap();
  }

  // JavaScript 側の状態を WGSL の Params へ詰めて uniform buffer に転送します
  // 配列 index は createWGSL() の struct コメントと対応しているため、増減時は両方を確認します
  writeParams() {
    this.paramData.fill(0.0);
    this.paramData[0] = this.enabled ? 1.0 : 0.0;
    this.paramData[1] = this.mode;
    this.paramData[2] = this.width;
    this.paramData[3] = this.height;
    this.paramData[4] = this.edgeStrength;
    this.paramData[5] = this.sharpness;
    this.paramData[6] = this.vignette;
    this.paramData[7] = this.chromaticOffset;
    this.paramData[8] = this.timeSec;
    this.queue.writeBuffer(this.paramBuffer, 0, this.paramData);
  }

  // sourceTarget と outputTarget の view を束ねた bind group を返します
  // source texture が同じ間は使い回し、resize 後だけ cache を捨てて再生成します
  getBindGroup(sourceTarget) {
    const key = sourceTarget.getTexture();
    let bindGroup = this.bindGroupCache.get(key);
    if (bindGroup) return bindGroup;
    bindGroup = this.device.createBindGroup({
      label: "compute_postprocess bind group",
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: sourceTarget.getView() },
        { binding: 1, resource: this.outputTarget.getView() },
        { binding: 2, resource: { buffer: this.paramBuffer } }
      ]
    });
    this.bindGroupCache.set(key, bindGroup);
    return bindGroup;
  }

  // 既存 render pass を閉じ、同じ command encoder に compute pass を積みます
  // WebgApp.frame() の流れは screen.clear() で render pass を開くため、
  // compute pass を始める前に passEncoder を end しておく必要があります
  render(sourceTarget, timeSec, options = {}) {
    const gpu = this.gpu;
    gpu.endPass?.();
    if (gpu.passEncoder) {
      gpu.passEncoder.end();
      gpu.passEncoder = null;
    }
    if (!gpu.commandEncoder) {
      gpu.commandEncoder = this.device.createCommandEncoder();
    }
    this.timeSec = timeSec;
    this.writeParams();
    // 8x8 pixel を1 workgroup とし、画面全体を覆う数だけ dispatch します
    // 端数分の invocation は WGSL 冒頭の範囲 check で捨てます
    const descriptor = { label: "compute_postprocess pass" };
    if (options.timestampWrites) descriptor.timestampWrites = options.timestampWrites;
    const pass = gpu.commandEncoder.beginComputePass(descriptor);
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.getBindGroup(sourceTarget));
    pass.dispatchWorkgroups(
      Math.ceil(this.width / WORKGROUP_SIZE),
      Math.ceil(this.height / WORKGROUP_SIZE)
    );
    pass.end();
  }
}

// DOM の canvas が生成されてから WebgApp と GPU resource を初期化します
// 失敗時は console だけでなく OverlayPanel にも出し、黒画面で原因が見えない状態を避けます
document.addEventListener("DOMContentLoaded", () => {
  start().catch((err) => {
    app?.setDiagnosticsReport?.(Diagnostics.createErrorReport(err, {
      system: "compute_postprocess",
      source: "samples/compute_postprocess/main.js",
      stage: app?.getDiagnosticsReport?.()?.stage ?? "start"
    }));
    if (app?.isConsoleEnabled?.()) {
      console.error("compute_postprocess sample failed:", err);
    }
    app?.showOverlayPanel?.(buildErrorPanelOptions(err, {
      title: "compute_postprocess failed",
      id: "start-error",
      background: "rgba(24, 28, 34, 0.94)"
    }));
  });
});

// smooth-shader に渡す material parameter を sample 内で統一する helper です
// postprocess の効果が見やすいよう、texture は使わず色・specular・emissive を明示します
function makeMaterial(color, ambient, specular, power, emissive = 0.0) {
  return {
    has_bone: 0,
    use_texture: 0,
    color,
    ambient,
    specular,
    power,
    emissive
  };
}

// CommandPalette と diagnostics 用に mode 番号を短い表示名へ変換します
function modeLabel(mode) {
  return ["film", "edge", "heat"][mode] ?? "film";
}

// postprocess の違いが見えやすい確認用 scene を作ります
// 大きな球、色付き小球、縦長 pillar を混ぜて、edge / sharp / chromatic の材料を増やしています
function createScene(app) {
  // 暗い floor は白 vignette や chromatic shift の見え方を確認する背景になります
  const floorShape = new Shape(app.getGPU());
  floorShape.applyPrimitiveAsset(Primitive.cuboid(42.0, 1.0, 42.0, floorShape.getPrimitiveOptions()));
  floorShape.endShape();
  floorShape.setMaterial("smooth-shader", makeMaterial([0.15, 0.17, 0.20, 1.0], 0.20, 0.20, 14.0));
  const floor = app.space.addNode(null, "floor");
  floor.setPosition(0.0, -4.5, 0.0);
  floor.addShape(floorShape);

  // 中央球は specular highlight と滑らかな輪郭を持つため、sharpness と edge の確認に使います
  const centerShape = new Shape(app.getGPU());
  centerShape.applyPrimitiveAsset(Primitive.sphere(3.5, 36, 24, centerShape.getPrimitiveOptions()));
  centerShape.endShape();
  centerShape.setMaterial("smooth-shader", makeMaterial([0.92, 0.88, 0.78, 1.0], 0.45, 1.00, 54.0));
  const center = app.space.addNode(null, "center");
  center.setPosition(0.0, 0.0, 0.0);
  center.addShape(centerShape);

  // 色付き小球を orbit rig にぶら下げ、赤青の chromatic offset と film tint を見やすくします
  const rig = app.space.addNode(null, "probeRig");
  const colors = [
    [1.0, 0.42, 0.22, 1.0],
    [0.28, 0.80, 1.0, 1.0],
    [0.92, 0.34, 0.90, 1.0],
    [0.60, 1.0, 0.38, 1.0],
    [1.0, 0.88, 0.36, 1.0]
  ];
  const nodes = [];
  for (let i = 0; i < colors.length; i += 1) {
    const angle = i / colors.length * Math.PI * 2.0;
    const shape = new Shape(app.getGPU());
    shape.applyPrimitiveAsset(Primitive.sphere(0.95, 24, 18, shape.getPrimitiveOptions()));
    shape.endShape();
    shape.setMaterial("smooth-shader", makeMaterial(colors[i], 0.30, 0.55, 28.0, 0.55));
    const node = app.space.addNode(null, `colorProbe${i}`);
    node.setPosition(Math.cos(angle) * 10.0, 1.2 + Math.sin(i * 1.7) * 1.1, Math.sin(angle) * 10.0);
    node.addShape(shape);
    node.attach(rig);
    nodes.push(node);
  }

  // 背景側の柱は縦線・横線が多く、edge mode と sharpness の変化を読み取りやすくします
  const pillars = [];
  for (let i = -3; i <= 3; i += 1) {
    const shape = new Shape(app.getGPU());
    shape.applyPrimitiveAsset(Primitive.cuboid(1.0, 5.0 + (i + 3) * 0.35, 1.0, shape.getPrimitiveOptions()));
    shape.endShape();
    shape.setMaterial("smooth-shader", makeMaterial([0.30, 0.42 + i * 0.025, 0.52, 1.0], 0.25, 0.45, 22.0));
    const node = app.space.addNode(null, `pillar${i}`);
    node.setPosition(i * 3.0, -1.8, -9.0);
    node.addShape(shape);
    pillars.push(node);
  }

  return { center, rig, nodes, pillars };
}

// sample 全体の entry point です
// WebgApp の起動、offscreen target、compute pass、copy pass、scene、入力、loop を順に組み立てます
async function start() {
  // autoDrawScene: false にし、WebgApp 標準の直接 canvas 描画を止めます
  // これにより onBeforeDraw で sceneTarget へ描き、onAfterDraw3d で compute pass を挟めます
  app = new WebgApp({
    document,
    autoDrawScene: false,
    frameTiming: true,
    clearColor: [0.045, 0.055, 0.070, 1.0],
    viewAngle: 54.0,
    messageFontTexture: "../../webg/font512.png",
    camera: {
      target: [0.0, 0.0, 0.0],
      distance: 34.0,
      yaw: 30.0,
      pitch: -13.0
    },
    light: {
      mode: "world-node",
      nodeName: "worldLight",
      position: [80.0, 120.0, 100.0],
      attitude: [0.0, 0.0, 0.0],
      type: 1.0
    },
    debugTools: {
      mode: "release",
      system: "compute_postprocess",
      source: "samples/compute_postprocess/main.js",
      probeDefaultAfterFrames: 1
    }
  });
  await app.init();

  // 操作説明は OverlayPanel へ表示し、現在値は後段の CommandPalette へ出します
  const helpLines = buildHelpLines();
  app.showOverlayPanel(buildHelpPanelOptions({
    id: "computePostprocessHelp",
    collapsed: true,
    lines: helpLines
  }));
  lastHelpText = helpLines.join("\n");

  // カメラは WebgApp の OrbitEyeRig を使い、postprocess sample 本体は描画順序だけに集中させます
  const orbit = app.createOrbitEyeRig({
    target: [0.0, 0.0, 0.0],
    distance: 34.0,
    yaw: 30.0,
    pitch: -13.0,
    minDistance: 14.0,
    maxDistance: 78.0,
    wheelZoomStep: 1.3
  });

  // 3D scene の描画先です。ここは通常の render attachment なので、depth も持たせます
  // compute shader はこの color texture を textureLoad() で読みます
  const sceneTarget = app.screen.createRenderTarget({
    label: "compute-postprocess-scene",
    format: app.getGPU().format,
    hasDepth: true
  });
  await sceneTarget.ready;

  // compute shader 版の postprocess pass です
  // outputTarget は storage texture として作られ、後段の FullscreenPass から texture として読まれます
  const computePass = new ComputePostprocessPass(app.getGPU(), {
    width: app.screen.getWidth(),
    height: app.screen.getHeight()
  });
  await computePass.getOutputTarget().ready;

  // compute 出力や scene debug view を canvas へ表示するための最終 copy pass です
  // compute shader は canvas に直接書けないため、この fullscreen render pass が最後に必要です
  const copyPass = new FullscreenPass(app.getGPU(), {
    targetFormat: app.getGPU().format
  });
  await copyPass.init();

  const scene = createScene(app);
  const state = {
    paused: false,
    view: "composite"
  };
  app.computePostprocessPass = computePass;
  app.computePostprocessState = state;

  // R key で effect parameter と debug view を初期値へ戻します
  // scene の姿勢までは戻さず、postprocess の比較だけを素早くやり直せるようにします
  const resetParams = () => {
    computePass.enabled = DEFAULTS.enabled;
    computePass.mode = DEFAULTS.mode;
    computePass.edgeStrength = DEFAULTS.edgeStrength;
    computePass.sharpness = DEFAULTS.sharpness;
    computePass.vignette = DEFAULTS.vignette;
    computePass.chromaticOffset = DEFAULTS.chromaticOffset;
    state.view = "composite";
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
      title: "Compute Postprocess",
      pageRows: 5,
      pageRowsByPage: [5, 5],
      closeOnCommand: false,
      onChange: (id, value) => {
        if (id === "enabled") computePass.enabled = value;
        else if (id === "paused") state.paused = value;
        else if (id === "view") state.view = value;
        else if (id === "mode") computePass.mode = value;
        else if (id === "edge") computePass.edgeStrength = value;
        else if (id === "sharpness") computePass.sharpness = value;
        else if (id === "vignette") computePass.vignette = value;
        else if (id === "chromatic") computePass.chromaticOffset = value;
        refreshAfterControlChange();
      },
      onCommand: (id) => {
        if (id === "reset") resetParams();
        refreshAfterControlChange();
      },
      commands: [
        // 1ページ目
        { type: "toggle", id: "enabled", label: "Compute", detail: "on/off", value: () => computePass.enabled },
        { type: "toggle", id: "paused", label: "Pause", detail: "anim", value: () => state.paused },
        null,
        { id: "palette-next", label: "Next", detail: "page", pageSwitch: true },
        { type: "select", id: "view", label: "View", value: () => state.view, options: [
          { value: "composite", label: "composite" },
          { value: "scene", label: "scene" },
          { value: "output", label: "output" }
        ] },
        { type: "select", id: "mode", label: "Mode", value: () => computePass.mode, options: [
          { value: 0, label: "film" },
          { value: 1, label: "edge" },
          { value: 2, label: "heat" }
        ] },
        { id: "reset", label: "Reset", detail: "params" },
        null,
        null,
        null,
        { type: "stepper", id: "edge", label: "Edge", value: () => computePass.edgeStrength, min: 0.0, max: 2.0, step: 0.12, decimals: 2, input: true },
        // 2ページ目
        null,
        null,
        null,
        { id: "palette-next", label: "Next", detail: "page", pageSwitch: true },
        { type: "stepper", id: "sharpness", label: "Sharp", value: () => computePass.sharpness, min: 0.0, max: 2.0, step: 0.12, decimals: 2, input: true },
        { type: "stepper", id: "vignette", label: "Vignette", value: () => computePass.vignette, min: 0.0, max: 1.0, step: 0.08, decimals: 2, input: true },
        { type: "stepper", id: "chromatic", label: "Chromatic", value: () => computePass.chromaticOffset, min: 0.0, max: 14.0, step: 1.0, decimals: 1, input: true },
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

  // キー入力は WebgApp の InputController に乗せます
  // 各キーは CPU 側の状態だけを更新し、GPU buffer への転送は次 frame の writeParams() に集約します
  app.attachInput({
    onKeyDown: async (key, ev) => {
      if (ev.repeat) return;
      if (key === "c") {
        computePass.enabled = !computePass.enabled;
      } else if (key === "v") {
        const order = ["composite", "scene", "output"];
        state.view = order[(order.indexOf(state.view) + 1) % order.length];
      } else if (key === "m") {
        computePass.mode = (computePass.mode + 1) % 3;
      } else if (key === "1") {
        computePass.edgeStrength = Math.max(0.0, computePass.edgeStrength - 0.12);
      } else if (key === "2") {
        computePass.edgeStrength = Math.min(2.0, computePass.edgeStrength + 0.12);
      } else if (key === "3") {
        computePass.sharpness = Math.max(0.0, computePass.sharpness - 0.12);
      } else if (key === "4") {
        computePass.sharpness = Math.min(2.0, computePass.sharpness + 0.12);
      } else if (key === "5") {
        computePass.vignette = Math.max(0.0, computePass.vignette - 0.08);
      } else if (key === "6") {
        computePass.vignette = Math.min(1.0, computePass.vignette + 0.08);
      } else if (key === "7") {
        computePass.chromaticOffset = Math.max(0.0, computePass.chromaticOffset - 1.0);
      } else if (key === "8") {
        computePass.chromaticOffset = Math.min(14.0, computePass.chromaticOffset + 1.0);
      } else if (key === " ") {
        state.paused = !state.paused;
      } else if (key === "r") {
        resetParams();
      }
    }
  });
  // F9 / diagnostics capture で、現在の postprocess parameter と target size を確認できるようにします
  app.setDiagnosticsStage("runtime");
  app.configureDiagnosticsCapture({
    labelPrefix: "compute_postprocess",
    collect: () => {
      const report = app.createProbeReport("runtime-probe");
      Diagnostics.mergeStats(report, {
        view: state.view,
        enabled: computePass.enabled ? "yes" : "no",
        mode: modeLabel(computePass.mode),
        edgeStrength: computePass.edgeStrength.toFixed(2),
        sharpness: computePass.sharpness.toFixed(2),
        vignette: computePass.vignette.toFixed(2),
        chromaticOffset: computePass.chromaticOffset.toFixed(1),
        outputWidth: computePass.getOutputTarget().getWidth(),
        outputHeight: computePass.getOutputTarget().getHeight()
      });
      return report;
    }
  });
  app.configureDebugKeyInput();

  app.start({
    // update phase:
    // camera、target resize、scene animation、Help Panel、diagnostics を更新します
    // GPU の描画 command はここでは発行せず、onBeforeDraw / onAfterDraw3d に分けます
    onUpdate: ({ deltaSec, screen, elapsedSec }) => {
      app.afterGpuSubmit();
      updateHelpPanel();
      // RenderTarget側で寸法変化を判定し、同じサイズではGPU textureを維持します
      sceneTarget.resizeToScreen(screen);
      computePass.resizeToScreen(screen);

      if (!state.paused) {
        scene.rig.rotateY(18.0 * deltaSec);
        scene.center.rotateY(11.0 * deltaSec);
        scene.center.rotateX(7.0 * deltaSec);
        for (let i = 0; i < scene.nodes.length; i += 1) {
          scene.nodes[i].rotateY((14.0 + i * 3.0) * deltaSec);
        }
        for (let i = 0; i < scene.pillars.length; i += 1) {
          scene.pillars[i].rotateY((6.0 + i) * deltaSec);
        }
      }

      app.mergeDiagnosticsStats({
        view: state.view,
        enabled: computePass.enabled ? "yes" : "no",
        mode: modeLabel(computePass.mode),
        sceneTargetWidth: sceneTarget.getWidth(),
        sceneTargetHeight: sceneTarget.getHeight(),
        outputWidth: computePass.getOutputTarget().getWidth(),
        outputHeight: computePass.getOutputTarget().getHeight()
      });
      computePass.timeSec = elapsedSec;
      app.updateDebugProbe();
    },
    // draw phase 1:
    // sceneTarget を color/depth 付き render target として開き、通常の 3D scene を描画します
    // WebgApp.frame() 冒頭の screen.clear() で開いた canvas pass は、beginPass() が内部で閉じます
    onBeforeDraw: () => {
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
    // draw phase 2:
    // sceneTarget を compute shader で加工し、その output または debug source を canvas へ表示します
    // 最後に clearDepthBuffer() でoverlay表示用のdepth付きcanvas passを開き直します
    onAfterDraw3d: ({ elapsedSec }) => {
      computePass.render(sceneTarget, elapsedSec, {
        timestampWrites: app.getGpuTimestampWrites(true, true)
      });
      app.endGpuTiming(app.getGPU().commandEncoder);

      const source = state.view === "scene"
        ? sceneTarget
        : computePass.getOutputTarget();
      app.screen.beginPresentPass({
        clearColor: app.clearColor,
        colorLoadOp: "clear"
      });
      copyPass.draw(source);
      app.screen.clearDepthBuffer();
    }
  });
}
