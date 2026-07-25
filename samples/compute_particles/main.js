// ---------------------------------------------
// samples/compute_particles/main.js  2026/07/21
//   Compute Shader particle simulation sample
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import WebgApp from "../../webg/WebgApp.js?v=20260614_compute_frame1";
import GpuParticleEmitter from "../../webg/GpuParticleEmitter.js";
import { CAMERA_REVERSE_Z } from "../../webg/DepthConvention.js";
import { buildErrorPanelOptions, buildHelpPanelOptions } from "../../webg/OverlayPanelPresets.js";

// このサンプルの目的:
// - webg core の GpuParticleEmitter を使い、GPU resource構築とpass encodeを共通化する
// - Particle の位置・速度・寿命を storage buffer に置き、CPU が毎フレーム個別粒子を更新しない構成を確認する
// - render pass でも同じ storage buffer を読み、compute 結果を readback せずそのまま描画へ渡す

const PARTICLE_COUNT = 49152;
const WORKGROUP_SIZE = 128;
const FLOATS_PER_PARTICLE = 12;
const PARAM_FLOATS = 20;
const CLEAR_COLOR = [0.006, 0.012, 0.020, 1.0];

let app = null;
let screen = null;
let device = null;
let queue = null;
let emitter = null;
let frameNumber = 0;
let paused = false;
let emitterMode = 0;
let burstBias = 0.0;
let cameraYaw = 0.0;
let cameraPitch = -0.24;
let cameraDistance = 6.50;
let cameraPanX = 0.0;
let cameraPanY = 0.0;
let cameraTargetY = 0.34;
let pointerDragging = false;
let lastPointerX = 0.0;
let lastPointerY = 0.0;
let lastHelpText = "";

// OverlayPanel に渡す表示行を、その時点の simulation と camera の状態から組み立てる
// 戻り値は 1 行ずつ分けた文字列配列で、showHelpPanel() と updateHelpPanel() が共通して利用する
// 関数名を読まなくても、ここが「画面へ読ませる情報を作る段階」だと分かるよう表示内容を一か所に集約する
const buildHelpLines = () => [
  "compute_particles",
  `particles: ${PARTICLE_COUNT.toLocaleString()}  workgroup: ${WORKGROUP_SIZE}`,
  `compute: position / velocity / lifetime on GPU`,
  `render: instanced billboard quads from the same storage buffer`,
  `mode: ${emitterMode === 0 ? "fountain" : "ring"}  paused: ${paused ? "yes" : "no"}`,
  `camera: yaw=${(cameraYaw * 180.0 / Math.PI).toFixed(0)} pitch=${(cameraPitch * 180.0 / Math.PI).toFixed(0)} dist=${cameraDistance.toFixed(2)}`,
  `pan: x=${cameraPanX.toFixed(2)} y=${cameraPanY.toFixed(2)}  targetY=${cameraTargetY.toFixed(2)}`,
  ...(app?.getFrameTimingLines?.() ?? []),
  "drag: orbit  Shift+drag: pan  wheel: zoom  Space burst  1 fountain  2 ring  P pause  H hide help"
];

// WebgApp の初期化後に一度呼び、book 14.5 の方針に沿った help panel を作成する
// app がまだ存在しない段階では表示先がないため何もせず、初期化済みなら同じ id の OverlayPanel を登録する
// lastHelpText には初回表示した内容を保存し、次 frame 以降の不要な DOM 更新を判定できるようにする
const showHelpPanel = () => {
  if (!app) return;
  lastHelpText = "";
  app.showOverlayPanel(buildHelpPanelOptions({
    id: "gpuParticlesHelp",
    collapsed: true,
    title: "Help",
    anchor: "top-left",
    maxWidth: "460px",
    collapseLabelExpanded: "Hide Help",
    collapseLabelCollapsed: "Show Help",
    lines: buildHelpLines()
  }));
  lastHelpText = buildHelpLines().join("\n");
};

// camera、pause、emitter mode など、実行中に変わった情報だけを既存 help panel へ反映する
// panel が未作成なら処理せず、前回と同じ文字列なら DOM を変更しない
// panel.update() は header button も再生成するため、連続更新中に pointerdown された button が
// click 前に切断されないよう、ここでは本文要素だけを書き換えて操作要素を保持する
const updateHelpPanel = () => {
  if (!app) return;
  const panel = app.getOverlayPanel?.("gpuParticlesHelp");
  if (!panel) return;
  const lines = buildHelpLines();
  const nextHelpText = lines.join("\n");
  if (nextHelpText === lastHelpText) return;
  panel.options.lines = lines;
  panel.options.text = nextHelpText;
  panel.bodyEl.textContent = nextHelpText;
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

// GPU storage buffer へ最初に書き込む Particle 配列を CPU 側で一度だけ作る
// 戻り値は Particle 1 件を 12 個の float で並べた Float32Array で、createPipelines() が GPU buffer へ転送する
// posLife.w を負にしておくことで、最初の compute pass が全粒子を期限切れと判断し、shader 側の spawn 処理を通す
const createInitialParticleData = () => {
  const data = new Float32Array(PARTICLE_COUNT * FLOATS_PER_PARTICLE);
  for (let i = 0; i < PARTICLE_COUNT; i += 1) {
    const offset = i * FLOATS_PER_PARTICLE;
    data[offset + 0] = 0.0;
    data[offset + 1] = 0.0;
    data[offset + 2] = 0.0;
    data[offset + 3] = -1.0;
    data[offset + 4] = 0.0;
    data[offset + 5] = 0.0;
    data[offset + 6] = 0.0;
    data[offset + 7] = 1.0;
    data[offset + 8] = 0.0;
    data[offset + 9] = 0.0;
    data[offset + 10] = 0.0;
    data[offset + 11] = 0.018;
  }
  return data;
};

// particle simulation 用の WGSL source 全体を文字列として生成する
// JavaScript 側の WORKGROUP_SIZE を shader 宣言へ埋め込み、Particle 構造体、乱数、spawn、毎 frame 更新を一つにまとめる
// 戻り値は createPipelines() が createShaderModule() へ渡し、1 invocation = 1 particle で実行する
const createComputeWGSL = () => `
struct Particle {
  posLife: vec4<f32>,
  velMaxLife: vec4<f32>,
  colorSize: vec4<f32>,
};

struct SimParams {
  deltaTime: f32,
  time: f32,
  frame: f32,
  count: f32,
  gravity: vec4<f32>,
  emitter: vec4<f32>,
  screenInfo: vec4<f32>,
  control: vec4<f32>,
};

@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<uniform> params: SimParams;

// 1 個の数値から 0.0 以上 1.0 未満の疑似乱数を作る
// particle index と時刻から再現可能なばらつきを得るために使い、storage buffer や共有状態は変更しない
fn hash11(n: f32) -> f32 {
  return fract(sin(n) * 43758.5453123);
}

// seed から XYZ 方向の候補を作り、長さ 1 の方向 vector に正規化して返す
// 長さが極端に小さい場合も inverseSqrt() が破綻しないよう、二乗長には明示的な下限を設ける
fn randomUnit(seed: f32) -> vec3<f32> {
  let x = hash11(seed * 17.17 + 1.0) * 2.0 - 1.0;
  let y = hash11(seed * 23.31 + 2.0) * 2.0 - 1.0;
  let z = hash11(seed * 31.73 + 3.0) * 2.0 - 1.0;
  let v = vec3<f32>(x, y, z);
  let lenSq = max(dot(v, v), 0.0001);
  return v * inverseSqrt(lenSq);
}

// 寿命切れまたは burst 対象になった 1 粒子の位置、速度、色、サイズ、寿命をまとめて作り直す
// index は粒子ごとの固定差、seed は時刻ごとの変化に使い、fountain / ring mode に応じて初期条件を分ける
// 完成した Particle を返すだけで、storage buffer への書き込みは呼び出し元の main() が担当する
fn spawnParticle(index: u32, seed: f32) -> Particle {
  let id = f32(index);
  let dir = randomUnit(seed + id * 0.37);
  let ring = randomUnit(seed * 1.91 + id * 0.11);
  let mode = params.control.x;
  var base = vec3<f32>(params.emitter.x, params.emitter.y, 0.0);
  var speed = 0.42 + hash11(seed + id * 0.53) * 0.82;
  var velocity = vec3<f32>(dir.x * 0.54 + ring.y * 0.28, abs(dir.y) * 1.95 + 0.58, dir.z * 0.36) * speed;

  if (mode > 0.5) {
    let angle = seed * 2.7 + id * 0.047;
    let radius = 0.18 + hash11(seed + id * 0.77) * 0.46;
    base = vec3<f32>(cos(angle) * radius, -0.52 + sin(params.time * 0.9) * 0.05, sin(angle) * radius);
    velocity = vec3<f32>(cos(angle) * 0.48, 1.64 + hash11(seed + id * 0.91) * 1.30, sin(angle) * 0.42);
  }

  let warm = vec3<f32>(1.0, 0.28 + hash11(seed + id * 0.29) * 0.18, 0.04);
  let cool = vec3<f32>(0.04, 0.46 + hash11(seed + id * 0.43) * 0.20, 1.0);
  let mint = vec3<f32>(0.08, 1.0, 0.48 + hash11(seed + id * 0.67) * 0.18);
  let rose = vec3<f32>(1.0, 0.10 + hash11(seed + id * 0.71) * 0.18, 0.38);
  let gold = vec3<f32>(1.0, 0.78 + hash11(seed + id * 0.57) * 0.18, 0.05);
  let paletteA = mix(warm, cool, hash11(seed + id * 0.61));
  let paletteB = mix(mint, rose, hash11(seed + id * 0.79));
  let paletteC = mix(gold, warm, hash11(seed + id * 0.93) * 0.32);
  let colorSeed = hash11(seed + id * 0.89);
  let baseColor = mix(paletteA, paletteB, smoothstep(0.30, 0.78, colorSeed));
  let color = mix(baseColor, paletteC, smoothstep(0.42, 0.92, hash11(seed + id * 1.07))) * 1.26;
  let life = 3.2 + hash11(seed + id * 0.83) * 4.6;
  let size = 0.006 + hash11(seed + id * 0.97) * 0.012;

  var p: Particle;
  p.posLife = vec4<f32>(base + dir * 0.085 + ring * 0.045, life);
  p.velMaxLife = vec4<f32>(velocity, life);
  p.colorSize = vec4<f32>(color, size);
  return p;
}

// compute pipeline の入口で、globalId.x が担当する 1 粒子だけを更新する
// 範囲外 invocation は直ちに終了し、respawn が必要なら spawnParticle() の結果を書いて通常の積分処理を行わない
// 継続粒子は重力、渦、中心方向の力、波、床反発を順に適用し、最後に同じ index へ次状態を書き戻す
@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let index = globalId.x;
  if (index >= u32(params.count)) {
    return;
  }

  var p = particles[index];
  var life = p.posLife.w - params.deltaTime;
  let burst = params.control.y;
  let shouldRespawn = life <= 0.0 || (burst > 0.5 && hash11(f32(index) * 0.17 + params.frame) < 0.025);
  if (shouldRespawn) {
    particles[index] = spawnParticle(index, params.time * 31.0 + params.frame * 0.73);
    return;
  }

  var pos = p.posLife.xyz;
  var vel = p.velMaxLife.xyz;
  let swirl = vec3<f32>(-pos.z, 0.0, pos.x) * 0.42;
  let centerPull = -pos * vec3<f32>(0.07, 0.02, 0.07);
  let wave = vec3<f32>(
    sin(params.time * 1.3 + f32(index) * 0.013) * 0.12,
    0.0,
    cos(params.time * 1.1 + f32(index) * 0.017) * 0.10
  );
  vel = vel + (params.gravity.xyz + swirl + centerPull + wave) * params.deltaTime;
  pos = pos + vel * params.deltaTime;

  if (pos.y < -0.84) {
    pos.y = -0.84;
    vel.y = abs(vel.y) * 0.46;
    vel = vec3<f32>(vel.x * 0.74, vel.y, vel.z * 0.74);
  }

  p.posLife = vec4<f32>(pos, life);
  p.velMaxLife = vec4<f32>(vel, p.velMaxLife.w);
  particles[index] = p;
}
`;

// particle storage buffer を直接読んで billboard 描画する WGSL source 全体を生成する
// vertex stage は 1 instance = 1 particle として 6 頂点の quad を作り、fragment stage は円形の輪郭と発光感を作る
// compute 結果を CPU readback せず同じ buffer から読むことが、この sample の主要な描画フローになる
const createRenderWGSL = () => `
struct Particle {
  posLife: vec4<f32>,
  velMaxLife: vec4<f32>,
  colorSize: vec4<f32>,
};

struct SimParams {
  deltaTime: f32,
  time: f32,
  frame: f32,
  count: f32,
  gravity: vec4<f32>,
  emitter: vec4<f32>,
  screenInfo: vec4<f32>,
  control: vec4<f32>,
};

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) uv: vec2<f32>,
};

@group(0) @binding(0) var<storage, read> particles: array<Particle>;
@group(0) @binding(1) var<uniform> params: SimParams;

// world 座標の粒子位置を、yaw、pitch、distance、targetY を使った簡易 view 座標へ変換する
// p 自体や storage buffer は変更せず、後段の perspective 投影が使う camera 相対座標を返す
fn toViewPosition(p: vec3<f32>) -> vec3<f32> {
  let yaw = params.screenInfo.z;
  let pitch = params.screenInfo.w;
  let distance = params.control.z;
  let targetY = params.control.w;
  let sy = sin(yaw);
  let cy = cos(yaw);
  let sx = sin(pitch);
  let cx = cos(pitch);
  let centered = vec3<f32>(p.x, p.y - targetY, p.z);

  var r = vec3<f32>(
    cy * centered.x + sy * centered.z,
    centered.y,
    -sy * centered.x + cy * centered.z
  );
  r = vec3<f32>(
    r.x,
    cx * r.y - sx * r.z,
    sx * r.y + cx * r.z - distance
  );
  return r;
}

// 1 粒子につき 6 回呼ばれ、共有 quad の corner と instanceIndex から billboard 頂点を作る
// 粒子の寿命比から表示サイズと alpha を決め、camera pan は clip 空間の offset として加える
// fragment shader へは粒子色、透明度、円形マスク用 UV を渡す
@vertex
fn vsMain(
  @location(0) corner: vec2<f32>,
  @builtin(instance_index) instanceIndex: u32
) -> VertexOut {
  let p = particles[instanceIndex];
  let lifeRatio = clamp(p.posLife.w / max(p.velMaxLife.w, 0.0001), 0.0, 1.0);
  let viewPos = toViewPosition(p.posLife.xyz);
  let viewW = max(-viewPos.z, 0.001);
  let projectionScale = 1.0 / tan(0.5 * 0.82);
  let aspect = max(params.screenInfo.x / max(params.screenInfo.y, 1.0), 0.0001);
  let size = p.colorSize.w * mix(0.72, 1.12, lifeRatio) * projectionScale / viewW * 1.08;
  // Screenの通常カメラdepthはReverse-Zなので、近い粒子を1、遠い粒子を0へ写します
  // Emitter pipelineのgreater比較とdepth clear 0に一致させ、通常Zの粒子だけが前後反転しないようにします
  let reverseDepth = 1.0 - clamp((viewW - 0.1) / 18.0, 0.0, 1.0);
  let clipCenter = vec2<f32>(
    viewPos.x * projectionScale / aspect,
    viewPos.y * projectionScale
  );
  let panOffset = vec2<f32>(params.emitter.z, params.emitter.w);

  var out: VertexOut;
  out.position = vec4<f32>(clipCenter + panOffset * viewW + corner * size * viewW, reverseDepth * viewW, viewW);
  out.color = vec4<f32>(p.colorSize.rgb, smoothstep(0.0, 0.18, lifeRatio) * 0.88);
  out.uv = corner;
  return out;
}

// billboard quad の四隅を円形に切り抜き、中心、胴体、外周の強さを合成して最終色を返す
// 半径 1 より外側は discard し、残った pixel は粒子自身の色を保ったまま core と rim を強調する
@fragment
fn fsMain(in: VertexOut) -> @location(0) vec4<f32> {
  let radius = length(in.uv);
  if (radius > 1.0) {
    discard;
  }
  let body = smoothstep(1.0, 0.72, radius);
  let core = smoothstep(0.52, 0.0, radius);
  let rim = smoothstep(0.95, 0.82, radius) * (1.0 - smoothstep(0.82, 0.68, radius));
  let alpha = (body * 0.72 + core * 0.28) * in.color.a;
  let color = in.color.rgb * (0.74 + core * 0.66) + rim * in.color.rgb * 0.34;
  return vec4<f32>(color, alpha);
}
`;

// app.init() 完了後に一度だけ呼び、particle状態と更新・描画pipelineをEmitterへまとめる
// 粒子固有のWGSLと初期値はこのサンプルに残し、GPU resource構築とencodeだけを共通クラスへ委譲する
const createPipelines = () => {
  emitter = new GpuParticleEmitter(screen.getGPU(), {
    label: "compute_particles",
    particleCount: PARTICLE_COUNT,
    floatsPerParticle: FLOATS_PER_PARTICLE,
    workgroupSize: WORKGROUP_SIZE,
    paramFloats: PARAM_FLOATS,
    targetFormat: screen.getGPU().format,
    // canvasの通常カメラdepthへ直接描くため、Emitterのformat、clear、compareをScreenと一致させます
    depthConvention: CAMERA_REVERSE_Z,
    // WGSLのtoViewPosition()がcamera移動を反映した相対座標を生成する契約を明示します
    coordinateSpace: "camera-relative",
    initialData: createInitialParticleData(),
    computeCode: createComputeWGSL(),
    renderCode: createRenderWGSL()
  });
};

// 1 frame の simulation と camera 表示に必要な値を 20 float の uniform buffer へ並べて転送する
// deltaSec と timeSec は時刻、frameNumber と burstBias は再生成判定、後半は canvas と camera の状態を表す
// 配列 index と WGSL の SimParams 配置は対応しているため、順序を変える場合は shader 側も同時に直す必要がある
const writeParams = (deltaSec, timeSec) => {
  const params = new Float32Array(PARAM_FLOATS);
  params[0] = deltaSec;
  params[1] = timeSec;
  params[2] = frameNumber;
  params[3] = PARTICLE_COUNT;
  params[4] = 0.0;
  params[5] = -0.70;
  params[6] = 0.0;
  params[7] = 0.0;
  params[8] = Math.sin(timeSec * 0.72) * 0.18;
  params[9] = -0.50 + Math.cos(timeSec * 0.47) * 0.06;
  params[10] = cameraPanX;
  params[11] = cameraPanY;
  params[12] = screen.getWidth();
  params[13] = screen.getHeight();
  params[14] = cameraYaw;
  params[15] = cameraPitch;
  params[16] = emitterMode;
  params[17] = burstBias;
  params[18] = cameraDistance;
  params[19] = cameraTargetY;
  emitter.writeParams(params);
};

// WebgAppのonComputeFrame handlerから毎frame呼ばれ、Compute PassとRender Passを一つのcommand encoderへ順番に積む
// timeMs は絶対時刻、elapsedSec は前 frame からの経過秒で、pause 中は deltaSec を 0 にして位置更新だけを止める
// compute 結果は CPU へ戻さずEmitter内の同じparticle Bufferを描画し、submit後にburst指示を解除する
const renderGpuParticlesFrame = (timeMs, elapsedSec) => {
  const deltaSec = paused ? 0.0 : Math.min(elapsedSec, 1.0 / 30.0);
  const timeSec = timeMs / 1000.0;
  frameNumber += 1;
  writeParams(deltaSec, timeSec);

  const commandEncoder = device.createCommandEncoder({ label: "compute_particles frame encoder" });
  app.beginGpuTiming();
  emitter.encodeCompute(commandEncoder, {
    timestampWrites: app.getGpuTimestampWrites(true, true)
  });

  const colorView = screen.getGPU().context.getCurrentTexture().createView();
  emitter.encodeRender(commandEncoder, {
    timestampWrites: app.getGpuRenderTimestampWrites(),
    colorView,
    depthView: screen.getGPU().depthView,
    clearColor: CLEAR_COLOR
  });

  app.endGpuTiming(commandEncoder);
  queue.submit([commandEncoder.finish()]);
  app.afterGpuSubmit();
  burstBias = 0.0;
  updateHelpPanel();
};

// window の keydown を受け、次 frame から shader や help panel に反映する sample 状態を切り替える
// Space は 1 frame 限定の burst、1/2 は emitter mode、P は simulation pause、H は help panel の折り畳みを担当する
// 粒子配列そのものには触れず、uniform と OverlayPanel の状態だけを変更して GPU simulation の構成を保つ
const applyActionKey = (key) => {
  const lower = String(key).toLowerCase();
  if (key === " ") {
    burstBias = 1.0;
    return true;
  }
  if (lower === "1") {
    emitterMode = 0;
    return true;
  }
  if (lower === "2") {
    emitterMode = 1;
    return true;
  }
  if (lower === "p") {
    paused = !paused;
    return true;
  }
  if (lower === "h") {
    const panel = app?.getOverlayPanel?.("gpuParticlesHelp");
    panel?.setCollapsed?.(!panel.collapsed);
    return true;
  }
  return false;
};

// window の keydown を受け、次 frame から shader や help panel に反映する sample 状態を切り替える
// Space は 1 frame 限定の burst、1/2 は emitter mode、P は simulation pause、H は help panel の折り畳みを担当する
// 粒子配列そのものには触れず、uniform と OverlayPanel の状態だけを変更して GPU simulation の構成を保つ
const handleKeyDown = (event) => {
  if (applyActionKey(event.key)) {
    event.preventDefault();
  }
};

// canvas 上で drag が始まった時点の pointer 座標を保存し、後続 move の差分計算を開始する
// pointer capture を設定するため、drag 中に pointer が canvas 外へ出ても pointerup まで同じ操作として扱える
// この段階では camera 値を変更せず、handlePointerMove() が使う開始状態だけを記録する
const handlePointerDown = (event) => {
  pointerDragging = true;
  lastPointerX = event.clientX;
  lastPointerY = event.clientY;
  event.currentTarget.setPointerCapture(event.pointerId);
};

// drag 中の pointer 移動量を camera 操作へ変換する
// 通常 drag は yaw / pitch を更新し、Shift + drag は投影後の pan offset を更新する
// 前回座標は各 event 後に必ず更新し、pitch だけは上下反転を避ける範囲へ制限する
const handlePointerMove = (event) => {
  if (!pointerDragging) return;
  const dx = event.clientX - lastPointerX;
  const dy = event.clientY - lastPointerY;
  lastPointerX = event.clientX;
  lastPointerY = event.clientY;
  if (event.shiftKey) {
    const panScale = 0.0022;
    cameraPanX += dx * panScale;
    cameraPanY -= dy * panScale;
    event.preventDefault();
    return;
  }
  cameraYaw += dx * 0.006;
  cameraPitch = Math.max(-1.18, Math.min(0.72, cameraPitch + dy * 0.004));
};

// drag 終了時に移動処理を止め、pointer capture を解放する
// pointerup と pointercancel の両方から呼ばれるため、通常終了と browser 都合の中断を同じ後始末で扱う
const handlePointerUp = (event) => {
  pointerDragging = false;
  event.currentTarget.releasePointerCapture(event.pointerId);
};

// wheel の縦方向量を camera distance に加え、粒子群への zoom として扱う
// 極端な接近や遠離を避けるため距離を明示範囲へ制限し、page scroll は preventDefault() で止める
const handleWheel = (event) => {
  cameraDistance = Math.max(1.85, Math.min(12.0, cameraDistance + event.deltaY * 0.0025));
  event.preventDefault();
};

// DOMContentLoaded 後に一度呼ばれ、WebgApp から連続描画を開始するまでの初期化を順番に行う
// WebgApp.init() 完了後に Screen / device / queue を取得し、resize、入力 listener、GPU pipeline、help panel を準備する
// computeFrameを有効にし、WebgAppの正式handlerから粒子更新と描画をCompute-first順で実行する
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
      system: "compute_particles",
      source: "samples/compute_particles/main.js"
    }
  });
  await app.init();
  screen = app.screen;
  device = app.getGPU().device;
  queue = app.getGPU().queue;
  resizeToWindow();
  window.addEventListener("resize", resizeToWindow);
  window.addEventListener("orientationchange", resizeToWindow);
  window.addEventListener("keydown", handleKeyDown);
  app.input.installTouchControls({
    touchDeviceOnly: false,
    groups: [
      {
        id: "mode",
        buttons: [
          { key: "1", label: "1", kind: "action", ariaLabel: "fountain emitter" },
          { key: "2", label: "2", kind: "action", ariaLabel: "ring emitter" },
          { key: " ", label: "B", kind: "action", ariaLabel: "burst" },
          { key: "p", label: "P", kind: "action", ariaLabel: "pause or resume" }
        ]
      },
      {
        id: "help",
        buttons: [
          { key: "h", label: "H", kind: "action", ariaLabel: "toggle help" }
        ]
      }
    ],
    onAction: ({ key }) => {
      applyActionKey(String(key));
    }
  });
  screen.canvas.addEventListener("pointerdown", handlePointerDown);
  screen.canvas.addEventListener("pointermove", handlePointerMove);
  screen.canvas.addEventListener("pointerup", handlePointerUp);
  screen.canvas.addEventListener("pointercancel", handlePointerUp);
  screen.canvas.addEventListener("wheel", handleWheel, { passive: false });
  createPipelines();
  showHelpPanel();
  app.start({
    onComputeFrame: (ctx) => {
      renderGpuParticlesFrame(ctx.timeMs, ctx.deltaSec);
    }
  });
};

// HTML の解析完了を待って start() を呼ぶ entry point
// 非同期初期化に失敗した場合は console と OverlayPanel の両方へ同じ error を出し、黒画面だけで失敗を隠さない
document.addEventListener("DOMContentLoaded", () => {
  // Promise rejection を受け取り、WebGPU validation や初期化失敗を利用者が読める形へ変換する
  start().catch((error) => {
    console.error("compute_particles failed:", error);
    app?.showOverlayPanel?.(buildErrorPanelOptions(error, {
      title: "compute_particles failed",
      id: "start-error",
      background: "rgba(26, 22, 32, 0.92)"
    }));
  });
});
