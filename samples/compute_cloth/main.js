// ---------------------------------------------
// samples/compute_cloth/main.js  2026/07/21
//   Compute Shader cloth simulation sample
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import WebgApp from "../../webg/WebgApp.js?v=20260614_compute_frame1";
import PingPongBuffer from "../../webg/PingPongBuffer.js";
import { buildErrorPanelOptions, buildHelpPanelOptions } from "../../webg/OverlayPanelPresets.js";
import { CAMERA_REVERSE_Z } from "../../webg/DepthConvention.js";

// このサンプルの目的:
// - WebgAppとコアのPingPongBufferを使い、WebGPU device上へcompute passを構成する
// - 布の各頂点を storage buffer 上の粒子として扱い、mass-spring の力を GPU 側で計算する
// - src buffer と dst buffer を分ける ping-pong 構成にし、近傍頂点を読む処理と書く処理を分離する

const GRID_WIDTH = 64;
const GRID_HEIGHT = 96;
const VERTEX_COUNT = GRID_WIDTH * GRID_HEIGHT;
const WORKGROUP_SIZE = 128;
const SIMULATION_SUBSTEPS = 3;
const FLOATS_PER_VERTEX = 8;
const BYTES_PER_VERTEX = FLOATS_PER_VERTEX * Float32Array.BYTES_PER_ELEMENT;
const SPACING = 0.055;
const CLOTH_TOP_Y = 2.62;
const FLOOR_Y = -3.42;
const CLOTH_VERTEX_MASS = 0.02;
const SPRING_STIFFNESS = 180.0;
const BEND_STIFFNESS_RATIO = 0.35;
const STRUCTURAL_MAX_STRETCH = 1.06;
const STRAIN_LIMIT_BLEND = 0.72;
const WIND_FORCE = 0.018;
const VELOCITY_DRAG_FORCE = 0.0061;
const FRAME_VELOCITY_RETENTION = 0.992;
const PARAM_FLOATS = 16;
const RENDER_PARAM_FLOATS = 20;
const CLEAR_COLOR = [0.050, 0.064, 0.070, 1.0];
const RENDER_MODE_WIRE = 0;
const RENDER_MODE_FLAT = 1;
const RENDER_MODE_SMOOTH = 2;
const RENDER_MODE_NAMES = ["Wire", "Flat", "Smooth"];

let app = null;
let screen = null;
let device = null;
let queue = null;
let stateBuffers = [];
let statePair = null;
let computeBindGroups = [];
let renderBindGroups = [];
let lineVertexBuffer = null;
let triangleVertexBuffer = null;
let paramBuffer = null;
let renderParamBuffer = null;
let computePipeline = null;
let wireRenderPipeline = null;
let fillRenderPipeline = null;
let lineIndexCount = 0;
let triangleIndexCount = 0;
let frameNumber = 0;
let paused = false;
let windEnabled = true;
let renderMode = RENDER_MODE_WIRE;
let cameraYaw = 0.0;
let cameraPitch = 0.0;
let cameraDistance = 6.65;
let cameraPanX = 0.0;
let cameraPanY = 0.0;
let pointerDragging = false;
let pointerPanning = false;
let lastPointerX = 0.0;
let lastPointerY = 0.0;
let lastHelpText = "";
const activeTouchPointers = new Map();
let lastTouchCenterX = 0.0;
let lastTouchCenterY = 0.0;
let lastTouchDistance = 0.0;

// OverlayPanel に表示する simulation、描画 mode、camera、操作説明を現在状態から組み立てる
// 戻り値は文字列配列で、初回表示と状態更新の両方が同じ内容生成を使う
// PC とスマートフォンの操作を同じパネルに記載し、入力方法を画面から直接確認できるようにする
const buildHelpLines = () => [
  "compute_cloth",
  `grid: ${GRID_WIDTH} x ${GRID_HEIGHT} = ${VERTEX_COUNT.toLocaleString()} vertices`,
  `mode: ${RENDER_MODE_NAMES[renderMode]}  triangles: ${(triangleIndexCount / 3).toLocaleString()}`,
  `physics: mass=${CLOTH_VERTEX_MASS.toFixed(2)} spring=${SPRING_STIFFNESS.toFixed(0)} substeps=${SIMULATION_SUBSTEPS}`,
  `wind: ${windEnabled ? "on" : "off"}  paused: ${paused ? "yes" : "no"}`,
  `camera: yaw=${(cameraYaw * 180.0 / Math.PI).toFixed(0)} pitch=${(cameraPitch * 180.0 / Math.PI).toFixed(0)} dist=${cameraDistance.toFixed(2)}`,
  `pan: x=${cameraPanX.toFixed(2)} y=${cameraPanY.toFixed(2)}`,
  ...(app?.getFrameTimingLines?.() ?? []),
  "PC: drag orbit / Shift, right, middle drag pan / wheel zoom",
  "Touch: 1 finger orbit / 2 fingers pan and pinch zoom",
  "Keys: 1 Wire / 2 Flat / 3 Smooth / W wind / P pause / R reset / H help"
];

// WebgApp 初期化後に book 14.5 と compute_particles と同じ構成の help panel を表示する
// panel は折りたたみ可能とし、広い画面を確認したい場合も DOM を破棄せず Show Help で戻せるようにする
// lastHelpText は毎 frame の不要な DOM 更新を避ける比較用として保存する
const showHelpPanel = () => {
  if (!app) return;
  const lines = buildHelpLines();
  app.showOverlayPanel(buildHelpPanelOptions({
    id: "computeClothHelp",
    collapsed: true,
    title: "Help",
    anchor: "top-left",
    maxWidth: "500px",
    maxHeight: "48vh",
    collapseLabelExpanded: "Hide Help",
    collapseLabelCollapsed: "Show Help",
    lines
  }));
  lastHelpText = lines.join("\n");
};

// simulation や camera の状態が変わった場合だけ既存 help panel の本文を更新する
// 連続 GPU simulation 中に同じ文字列で DOM を毎 frame 再構築しないよう、前回文字列と比較する
// panel が未作成または app 初期化前なら、表示先がないため処理を行わない
const updateHelpPanel = () => {
  if (!app?.getOverlayPanel?.("computeClothHelp")) return;
  const lines = buildHelpLines();
  const nextHelpText = lines.join("\n");
  if (nextHelpText === lastHelpText) return;
  app.updateOverlayPanel("computeClothHelp", { lines });
  lastHelpText = nextHelpText;
};

// browser window の CSS pixel サイズを Screen の canvas 実ピクセルへ同期する
// screen が未初期化なら何もせず、初期化済みなら最低 1 pixel を保証した整数値を Screen.resize() へ渡す
// Screen が depth texture も同時に作り直すため、後段の raw render pass は常に canvas と同じサイズを使える
const resizeToWindow = () => {
  if (!screen) return;
  screen.resize(
    Math.max(1, Math.floor(window.innerWidth)),
    Math.max(1, Math.floor(window.innerHeight))
  );
};

// 布 grid の x / y 座標を、storage buffer 上の 0-based 1 次元 index へ変換する
// 戻り値は y 行分の頂点数に x を足した整数で、初期データと各 vertex stream が同じ頂点を指すために使う
// CPU 側の stream 作成専用であり、GPU 側では同じ規則を WGSL の indexOf() に記述する
const vertexIndex = (x, y) => y * GRID_WIDTH + x;

// ping-pong storage buffer の両方へ書く、布頂点の初期状態を Float32Array として作る
// 各頂点は position + pin flag と velocity + mass の 8 float で構成し、上端 y=0 だけを固定点にする
// 可動頂点には格子間隔に見合う軽い質量を設定し、縦96段の累積荷重に対してバネが十分に応答できるようにする
// 戻り値は createPipelines() の初回 upload と resetCloth() の再初期化で共通利用する
const createInitialClothData = () => {
  if (!Number.isFinite(CLOTH_VERTEX_MASS) || CLOTH_VERTEX_MASS <= 0.0) {
    throw new Error(`CLOTH_VERTEX_MASS must be a positive finite number: ${CLOTH_VERTEX_MASS}`);
  }
  const data = new Float32Array(VERTEX_COUNT * FLOATS_PER_VERTEX);
  const halfW = (GRID_WIDTH - 1) * SPACING * 0.5;
  for (let y = 0; y < GRID_HEIGHT; y += 1) {
    for (let x = 0; x < GRID_WIDTH; x += 1) {
      const index = vertexIndex(x, y);
      const offset = index * FLOATS_PER_VERTEX;
      data[offset + 0] = x * SPACING - halfW;
      data[offset + 1] = CLOTH_TOP_Y - y * SPACING;
      data[offset + 2] = Math.sin(x * 0.23) * 0.018;
      data[offset + 3] = y === 0 ? 1.0 : 0.0;
      data[offset + 4] = 0.0;
      data[offset + 5] = 0.0;
      data[offset + 6] = 0.0;
      data[offset + 7] = CLOTH_VERTEX_MASS;
    }
  }
  return data;
};

// Wire mode の line-list 描画へ渡す vertex stream を CPU 側で作る
// 横隣接と縦隣接を線分の両端として順番に並べ、各 entry には cloth index と未使用の面 index を入れる
// Wire も Fill と同じ vertex layout を使うため 4 float に揃えるが、面 index は Wire fragment では参照しない
// 戻り値は頂点座標そのものではなく index stream で、vertex shader が storage buffer から実座標を読む
const createLineVertexStream = () => {
  const indices = [];
  // line-list の片端となる cloth index を 1 頂点分追加する
  // 後ろの3要素は共通 vertex layout 用で、同じ index を入れて範囲外参照を避ける
  const pushVertex = (index) => {
    indices.push(index, index, index, index);
  };
  for (let y = 0; y < GRID_HEIGHT; y += 1) {
    for (let x = 0; x < GRID_WIDTH - 1; x += 1) {
      pushVertex(vertexIndex(x, y));
      pushVertex(vertexIndex(x + 1, y));
    }
  }
  for (let y = 0; y < GRID_HEIGHT - 1; y += 1) {
    for (let x = 0; x < GRID_WIDTH; x += 1) {
      pushVertex(vertexIndex(x, y));
      pushVertex(vertexIndex(x, y + 1));
    }
  }
  return new Float32Array(indices);
};

// Flat / Smooth mode が共用する、simulation grid と同じ細かさの triangle-list vertex stream を作る
// 各 grid cell を 2 triangle、合計 6 頂点へ展開し、描画頂点 index と面を構成する3 index を格納する
// 3頂点すべてへ同じ面 index を渡し、vertex shader が現在の変形位置から Flat 用面法線を計算する
// 戻り値の index は storage buffer を直接指すため、CPU が変形後の頂点座標を作り直す必要はない
const createTriangleVertexStream = () => {
  const indices = [];
  // triangle-list の1面を構成する3頂点を、描画頂点と共通の面 index を持つ3 entry へ展開する
  // face0 / face1 / face2 は同じ面の全 entry で一致するため、Flat 法線も三角形内で完全に一致する
  const pushTriangle = (face0, face1, face2) => {
    indices.push(face0, face0, face1, face2);
    indices.push(face1, face0, face1, face2);
    indices.push(face2, face0, face1, face2);
  };
  for (let y = 0; y < GRID_HEIGHT - 1; y += 1) {
    for (let x = 0; x < GRID_WIDTH - 1; x += 1) {
      const topLeft = vertexIndex(x, y);
      const topRight = vertexIndex(x + 1, y);
      const bottomLeft = vertexIndex(x, y + 1);
      const bottomRight = vertexIndex(x + 1, y + 1);
      pushTriangle(topLeft, bottomLeft, topRight);
      pushTriangle(topRight, bottomLeft, bottomRight);
    }
  }
  return new Float32Array(indices);
};

// cloth simulation 用の WGSL source 全体を文字列として生成する
// shader は read-only srcState から近傍頂点を読み、read-write dstState へ次 frame の位置と速度を書く
// 戻り値は createPipelines() が shader module にし、ping-pong により invocation 間の読み書き競合を避ける
const createComputeWGSL = () => `
struct ClothVertex {
  posPin: vec4<f32>,
  velMass: vec4<f32>,
};

struct ClothParams {
  grid: vec4<f32>,
  force: vec4<f32>,
  wind: vec4<f32>,
  control: vec4<f32>,
};

@group(0) @binding(0) var<storage, read> srcState: array<ClothVertex>;
@group(0) @binding(1) var<storage, read_write> dstState: array<ClothVertex>;
@group(0) @binding(2) var<uniform> params: ClothParams;

// 2 次元 grid 座標を srcState / dstState 共通の 0-based buffer index へ変換する
// JavaScript 側の vertexIndex() と同じ並び順を使い、近傍頂点が同じ storage entry を参照できるようにする
fn indexOf(x: u32, y: u32) -> u32 {
  return y * u32(params.grid.x) + x;
}

// grid 座標から、力が加わっていない初期状態の world position を計算する
// 固定された上端頂点を毎 frame 正しい位置へ戻すために使い、storage buffer の現在位置には依存しない
fn restPosition(x: u32, y: u32) -> vec3<f32> {
  let width = params.grid.x;
  let spacing = params.grid.z;
  let halfW = (width - 1.0) * spacing * 0.5;
  let normalizedX = f32(x) / max(width - 1.0, 1.0);
  let centerSag = sin(normalizedX * 3.14159265);
  return vec3<f32>(
    f32(x) * spacing - halfW,
    params.control.x - centerSag * 0.18 - f32(y) * spacing,
    0.0
  );
}

// 現在頂点 pos と 1 個の neighbor の距離から Hooke 型のばね力を計算する
// restLength より長ければ neighbor 側へ、短ければ反対側へ力を返し、二点が重なる場合はゼロ vector を返す
// この関数は位置を変更せず、main() が全近傍の戻り値を合計してから速度へ積分する
fn springForce(pos: vec3<f32>, neighbor: vec3<f32>, restLength: f32, stiffness: f32) -> vec3<f32> {
  let delta = neighbor - pos;
  let lenSq = dot(delta, delta);
  if (lenSq <= 0.0000001) {
    return vec3<f32>(0.0);
  }
  let len = sqrt(lenSq);
  return delta / len * ((len - restLength) * stiffness);
}

// force 積分後の pos が neighbor から許容長以上に離れた場合、許容距離上の候補位置を返す
// 許容範囲内なら pos をそのまま返し、重なって方向を求められない場合も数値を作らず pos を維持する
// main() は上下左右の候補を平均し、blend 量だけ混ぜることで布の過伸長を段階的に抑える
fn strainLimitContribution(pos: vec3<f32>, neighbor: vec3<f32>, restLength: f32, maxStretch: f32) -> vec3<f32> {
  let delta = pos - neighbor;
  let lenSq = dot(delta, delta);
  if (lenSq <= 0.0000001) {
    return pos;
  }
  let len = sqrt(lenSq);
  let limit = restLength * maxStretch;
  if (len <= limit) {
    return pos;
  }
  return neighbor + delta / len * limit;
}

// compute pipeline の入口で、globalId.x が指す布頂点 1 個の次状態を計算する
// 固定頂点はrestPosition()へ戻し、可動頂点は構造ばね、斜めばね、曲げばね、風、減衰、strain limit、床反発を順に適用する
// 重力は質量に依存しない加速度として扱い、バネ、風、速度抵抗は力から逆質量で加速度へ変換する
// strain limit と床補正後は確定位置の移動量から速度を再計算し、補正前の下向き速度を次 substep へ残さない
// 読み取りはすべて srcState、最終書き込みは同じ index の dstState だけに限定し、invocation 間の競合を避ける
@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let index = globalId.x;
  let count = u32(params.grid.x * params.grid.y);
  if (index >= count) {
    return;
  }

  let width = u32(params.grid.x);
  let height = u32(params.grid.y);
  let x = index % width;
  let y = index / width;
  let current = srcState[index];
  let pinned = current.posPin.w > 0.5;

  if (pinned) {
    let anchor = restPosition(x, y) + vec3<f32>(0.0, 0.0, sin(params.wind.x * 1.7 + f32(x) * 0.13) * 0.025);
    var fixedVertex = current;
    fixedVertex.posPin = vec4<f32>(anchor, 1.0);
    fixedVertex.velMass = vec4<f32>(0.0, 0.0, 0.0, 1.0);
    dstState[index] = fixedVertex;
    return;
  }

  let spacing = params.grid.z;
  let diagonal = spacing * 1.41421356;
  let bendLength = spacing * 2.0;
  let stiffness = params.force.w;
  let bendStiffness = stiffness * ${BEND_STIFFNESS_RATIO};
  var pos = current.posPin.xyz;
  var vel = current.velMass.xyz;
  let previousPos = pos;
  let inverseMass = 1.0 / current.velMass.w;
  var force = vec3<f32>(0.0);

  if (x > 0u) {
    force += springForce(pos, srcState[indexOf(x - 1u, y)].posPin.xyz, spacing, stiffness);
  }
  if (x + 1u < width) {
    force += springForce(pos, srcState[indexOf(x + 1u, y)].posPin.xyz, spacing, stiffness);
  }
  if (y > 0u) {
    force += springForce(pos, srcState[indexOf(x, y - 1u)].posPin.xyz, spacing, stiffness);
  }
  if (y + 1u < height) {
    force += springForce(pos, srcState[indexOf(x, y + 1u)].posPin.xyz, spacing, stiffness);
  }
  if (x > 0u && y > 0u) {
    force += springForce(pos, srcState[indexOf(x - 1u, y - 1u)].posPin.xyz, diagonal, stiffness * 0.38);
  }
  if (x + 1u < width && y > 0u) {
    force += springForce(pos, srcState[indexOf(x + 1u, y - 1u)].posPin.xyz, diagonal, stiffness * 0.38);
  }
  if (x > 0u && y + 1u < height) {
    force += springForce(pos, srcState[indexOf(x - 1u, y + 1u)].posPin.xyz, diagonal, stiffness * 0.38);
  }
  if (x + 1u < width && y + 1u < height) {
    force += springForce(pos, srcState[indexOf(x + 1u, y + 1u)].posPin.xyz, diagonal, stiffness * 0.38);
  }
  if (x > 1u) {
    force += springForce(pos, srcState[indexOf(x - 2u, y)].posPin.xyz, bendLength, bendStiffness);
  }
  if (x + 2u < width) {
    force += springForce(pos, srcState[indexOf(x + 2u, y)].posPin.xyz, bendLength, bendStiffness);
  }
  if (y > 1u) {
    force += springForce(pos, srcState[indexOf(x, y - 2u)].posPin.xyz, bendLength, bendStiffness);
  }
  if (y + 2u < height) {
    force += springForce(pos, srcState[indexOf(x, y + 2u)].posPin.xyz, bendLength, bendStiffness);
  }

  let normalizedY = f32(y) / max(f32(height - 1u), 1.0);
  let gustEnvelope = 0.68 + sin(pos.x * 1.8 + normalizedY * 1.4) * 0.32;
  let secondaryWave = sin(params.wind.x * 2.3 + pos.x * 1.3) * 0.22;
  let gust = sin(params.wind.x * 1.4) * gustEnvelope + secondaryWave;
  force += vec3<f32>(0.0, 0.0, params.wind.y * gust);
  force += -vel * params.wind.z;

  let acceleration = params.force.xyz + force * inverseMass;
  vel = (vel + acceleration * params.grid.w) * params.wind.w;
  pos = pos + vel * params.grid.w;

  var limitedSum = vec3<f32>(0.0);
  var limitedCount = 0.0;
  if (x > 0u) {
    limitedSum += strainLimitContribution(pos, srcState[indexOf(x - 1u, y)].posPin.xyz, spacing, params.control.y);
    limitedCount += 1.0;
  }
  if (x + 1u < width) {
    limitedSum += strainLimitContribution(pos, srcState[indexOf(x + 1u, y)].posPin.xyz, spacing, params.control.y);
    limitedCount += 1.0;
  }
  if (y > 0u) {
    limitedSum += strainLimitContribution(pos, srcState[indexOf(x, y - 1u)].posPin.xyz, spacing, params.control.y);
    limitedCount += 1.0;
  }
  if (y + 1u < height) {
    limitedSum += strainLimitContribution(pos, srcState[indexOf(x, y + 1u)].posPin.xyz, spacing, params.control.y);
    limitedCount += 1.0;
  }
  if (limitedCount > 0.0) {
    let limitedPos = limitedSum / limitedCount;
    pos = mix(pos, limitedPos, params.control.z);
  }

  var floorContact = false;
  if (pos.y < params.control.w) {
    pos.y = params.control.w;
    floorContact = true;
  }

  if (params.grid.w > 0.0) {
    vel = (pos - previousPos) / params.grid.w;
  }
  if (floorContact) {
    vel = vec3<f32>(vel.x * 0.84, max(0.0, vel.y) * 0.28, vel.z * 0.84);
  }

  var next = current;
  next.posPin = vec4<f32>(pos, current.posPin.w);
  next.velMass = vec4<f32>(vel, current.velMass.w);
  dstState[index] = next;
}
`;

// Wire / Flat / Smooth の全 mode で共用する render WGSL source を文字列として生成する
// vertex attribute には描画頂点 index と Flat 面を構成する3 index を渡し、変形後の位置は storage buffer から読む
// 戻り値は wireRenderPipeline と fillRenderPipeline が共有し、fragment shader 内の shadeMode で表現を切り替える
const createRenderWGSL = () => `
struct ClothVertex {
  posPin: vec4<f32>,
  velMass: vec4<f32>,
};

struct RenderParams {
  view: vec4<f32>,
  control: vec4<f32>,
  light: vec4<f32>,
  color: vec4<f32>,
  cameraOffset: vec4<f32>,
};

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) viewPos: vec3<f32>,
  @location(2) smoothNormal: vec3<f32>,
  @location(3) @interpolate(flat) flatNormal: vec3<f32>,
};

@group(0) @binding(0) var<storage, read> state: array<ClothVertex>;
@group(0) @binding(1) var<uniform> renderParams: RenderParams;

// render shader 内の 2 次元 grid 座標を state storage buffer の index へ変換する
// smoothNormalFor() が上下左右の位置を読むとき、compute shader と同じ頂点並びを使うための関数
fn indexOf(x: u32, y: u32) -> u32 {
  return y * u32(renderParams.control.y) + x;
}

// grid 外を指す可能性がある signed 座標を、0 から maxValue - 1 の有効範囲へ制限する
// 布端の法線計算で存在しない隣接頂点を読まず、端自身の位置を代用できるようにする
fn clampIndex(value: i32, maxValue: u32) -> u32 {
  return u32(clamp(value, 0, i32(maxValue) - 1));
}

// world position を camera yaw / pitch / distance に基づく簡易 view 座標へ変換する
// 入力 position は変更せず、vertex の perspective 投影と world normal の view 変換に使う座標を返す
fn toViewPosition(p: vec3<f32>) -> vec3<f32> {
  let yaw = renderParams.view.x;
  let pitch = renderParams.view.y;
  let distance = renderParams.view.w;
  let sy = sin(yaw);
  let cy = cos(yaw);
  let sx = sin(pitch);
  let cx = cos(pitch);

  var r = vec3<f32>(
    cy * p.x + sy * p.z,
    p.y,
    -sy * p.x + cy * p.z
  );
  r = vec3<f32>(
    r.x + renderParams.cameraOffset.x,
    cx * r.y - sx * r.z + renderParams.cameraOffset.y,
    sx * r.y + cx * r.z - distance
  );
  return r;
}

// world space の方向 vector へ camera yaw / pitch と同じ回転だけを適用する
// 位置用の toViewPosition() と異なり camera distance を加えず、法線を view space へ明示的に変換する
// view space 固定の light direction と同じ座標系で法線を比較するため、照明は camera の向きへ追従する
fn toViewDirection(direction: vec3<f32>) -> vec3<f32> {
  let yaw = renderParams.view.x;
  let pitch = renderParams.view.y;
  let sy = sin(yaw);
  let cy = cos(yaw);
  let sx = sin(pitch);
  let cx = cos(pitch);

  let yawRotated = vec3<f32>(
    cy * direction.x + sy * direction.z,
    direction.y,
    -sy * direction.x + cy * direction.z
  );
  return vec3<f32>(
    yawRotated.x,
    cx * yawRotated.y - sx * yawRotated.z,
    sx * yawRotated.y + cx * yawRotated.z
  );
}

// signed grid 座標を安全な範囲へ直してから、state buffer 内の現在位置を返す
// smoothNormalFor() だけが利用し、端の頂点では clampIndex() により最寄りの有効位置を読む
fn readPosition(x: i32, y: i32) -> vec3<f32> {
  let width = u32(renderParams.control.y);
  let height = u32(renderParams.control.z);
  let cx = clampIndex(x, width);
  let cy = clampIndex(y, height);
  return state[indexOf(cx, cy)].posPin.xyz;
}

// 1 頂点の左右差分と上下差分から接線を作り、Smooth mode 用の頂点法線を計算する
// cross product が極端に短い場合は既定の正面法線を返し、ゼロ長 vector の normalize を避ける
// 戻り値は vertex shader から fragment shader へ補間され、Smooth mode の diffuse 計算に使われる
fn smoothNormalFor(vertexIndex: u32) -> vec3<f32> {
  let width = u32(renderParams.control.y);
  let x = vertexIndex % width;
  let y = vertexIndex / width;
  let left = readPosition(i32(x) - 1, i32(y));
  let right = readPosition(i32(x) + 1, i32(y));
  let up = readPosition(i32(x), i32(y) - 1);
  let down = readPosition(i32(x), i32(y) + 1);
  let tangentX = right - left;
  let tangentY = down - up;
  let n = cross(tangentY, tangentX);
  let lenSq = dot(n, n);
  if (lenSq <= 0.0000001) {
    return vec3<f32>(0.0, 0.0, 1.0);
  }
  return n * inverseSqrt(lenSq);
}

// index stream の 1 entry を受け、cloth storage buffer から実際の位置を取得して clip 座標を作る
// clothIndexValue と face index は float attribute なので整数へ戻し、storage buffer の現在位置を参照する
// face index の3位置から面法線を計算し、@interpolate(flat) の出力として三角形全体へ一定値を渡す
// 固定色、view position、Smooth 法線も同時に fragment stage へ渡す
// Wire / Flat / Smooth の違いは同じ vertex shader を使い、pipeline topology と fragment shadeMode 側で切り替える
@vertex
fn vsMain(
  @location(0) clothIndexValue: f32,
  @location(1) face0Value: f32,
  @location(2) face1Value: f32,
  @location(3) face2Value: f32
) -> VertexOut {
  let clothIndex = u32(clothIndexValue + 0.5);
  let face0 = u32(face0Value + 0.5);
  let face1 = u32(face1Value + 0.5);
  let face2 = u32(face2Value + 0.5);
  let v = state[clothIndex];
  let r = toViewPosition(v.posPin.xyz);
  let normalView = normalize(toViewDirection(smoothNormalFor(clothIndex)));
  let faceEdge1 = state[face1].posPin.xyz - state[face0].posPin.xyz;
  let faceEdge2 = state[face2].posPin.xyz - state[face0].posPin.xyz;
  let faceNormalRaw = cross(faceEdge1, faceEdge2);
  let faceNormalLengthSq = dot(faceNormalRaw, faceNormalRaw);
  var faceNormalView = vec3<f32>(0.0, 0.0, 1.0);
  if (faceNormalLengthSq > 0.0000001) {
    faceNormalView = normalize(toViewDirection(faceNormalRaw * inverseSqrt(faceNormalLengthSq)));
  }

  let f = 1.0 / tan(0.5 * 0.82);
  let w = max(-r.z, 0.001);
  let depth = clamp((w - 0.1) / 40.0, 0.0, 1.0);
  let aspect = max(renderParams.view.z, 0.0001);

  var out: VertexOut;
  out.position = vec4<f32>(r.x * f / aspect, r.y * f, depth * w, w);
  out.color = renderParams.color;
  out.viewPos = r;
  out.smoothNormal = normalView;
  out.flatNormal = faceNormalView;
  return out;
}

// Wire は固定色をそのまま返し、Flat / Smooth は法線と視点右上の light direction から面の明暗を計算する
// Flat は vertex shader が三角形の3頂点から作った面法線を @interpolate(flat) で受け取る
// ambient は弱く、diffuse を主成分にし、view direction と half vector から布表面の highlight を加える
@fragment
fn fsMain(in: VertexOut) -> @location(0) vec4<f32> {
  let shadeMode = renderParams.control.x;
  if (shadeMode < 0.5) {
    return in.color;
  }
  var n = in.flatNormal;
  if (shadeMode > 1.5) {
    let smoothLenSq = dot(in.smoothNormal, in.smoothNormal);
    if (smoothLenSq > 0.0000001) {
      n = normalize(in.smoothNormal);
    }
  }
  let viewDir = normalize(-in.viewPos);
  if (dot(n, viewDir) < 0.0) {
    n = -n;
  }
  let lightDir = normalize(renderParams.light.xyz);
  let diffuse = max(dot(n, lightDir), 0.0);
  let halfDir = normalize(lightDir + viewDir);
  let highlight = pow(max(dot(n, halfDir), 0.0), 40.0) * renderParams.light.w;
  let shade = 0.07 + diffuse * 0.96;
  let color = in.color.rgb * shade + vec3<f32>(1.0, 0.96, 0.88) * highlight;
  return vec4<f32>(color, 1.0);
}
`;

// app.init() 完了後に一度だけ呼び、cloth simulation と 3 種類の表示に必要な GPU resource をすべて構築する
// ping-pong state buffer、各 mode の index stream、uniform、shader module、pipeline、bind group の順に準備する
// 完了後は renderComputeClothFrame() が global 変数へ保存された resource を前提として command を発行する
const createPipelines = () => {
  const initial = createInitialClothData();
  // index 0 / 1 の 2 buffer を同じ初期状態で作り、frame ごとに src と dst の役割を交換できるようにする
  // callback の i は buffer label の識別に使い、返した GPUBuffer を stateBuffers の同じ index へ格納する
  stateBuffers = [0, 1].map((i) => {
    const buffer = device.createBuffer({
      label: `compute_cloth state ${i}`,
      size: VERTEX_COUNT * BYTES_PER_VERTEX,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    queue.writeBuffer(buffer, 0, initial);
    return buffer;
  });
  statePair = new PingPongBuffer(stateBuffers, { label: "compute_cloth state" });

  const lineVertexStream = createLineVertexStream();
  lineIndexCount = lineVertexStream.length / 4;
  lineVertexBuffer = device.createBuffer({
    label: "compute_cloth line vertex index stream",
    size: lineVertexStream.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
  });
  queue.writeBuffer(lineVertexBuffer, 0, lineVertexStream);

  const triangleVertexStream = createTriangleVertexStream();
  triangleIndexCount = triangleVertexStream.length / 4;
  triangleVertexBuffer = device.createBuffer({
    label: "compute_cloth triangle vertex index stream",
    size: triangleVertexStream.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
  });
  queue.writeBuffer(triangleVertexBuffer, 0, triangleVertexStream);

  paramBuffer = device.createBuffer({
    label: "compute_cloth sim params",
    size: PARAM_FLOATS * Float32Array.BYTES_PER_ELEMENT,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });
  renderParamBuffer = device.createBuffer({
    label: "compute_cloth render params",
    size: RENDER_PARAM_FLOATS * Float32Array.BYTES_PER_ELEMENT,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });

  const computeBindGroupLayout = device.createBindGroupLayout({
    label: "compute_cloth compute bind group layout",
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } }
    ]
  });
  const renderBindGroupLayout = device.createBindGroupLayout({
    label: "compute_cloth render bind group layout",
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
      { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } }
    ]
  });

  computePipeline = device.createComputePipeline({
    label: "compute_cloth compute pipeline",
    layout: device.createPipelineLayout({ bindGroupLayouts: [computeBindGroupLayout] }),
    compute: {
      module: device.createShaderModule({ code: createComputeWGSL() }),
      entryPoint: "main"
    }
  });
  const renderModule = device.createShaderModule({ code: createRenderWGSL() });
  wireRenderPipeline = device.createRenderPipeline({
    label: "compute_cloth wire render pipeline",
    layout: device.createPipelineLayout({ bindGroupLayouts: [renderBindGroupLayout] }),
    vertex: {
      module: renderModule,
      entryPoint: "vsMain",
      buffers: [{
        arrayStride: 4 * Float32Array.BYTES_PER_ELEMENT,
        attributes: [
          { shaderLocation: 0, offset: 0, format: "float32" },
          { shaderLocation: 1, offset: 4, format: "float32" },
          { shaderLocation: 2, offset: 8, format: "float32" },
          { shaderLocation: 3, offset: 12, format: "float32" }
        ]
      }]
    },
    fragment: {
      module: renderModule,
      entryPoint: "fsMain",
      targets: [{
        format: screen.getGPU().format,
        blend: {
          color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
          alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" }
        }
      }]
    },
    primitive: { topology: "line-list" },
    depthStencil: {
      format: CAMERA_REVERSE_Z.format,
      depthWriteEnabled: false,
      depthCompare: CAMERA_REVERSE_Z.compare
    }
  });
  fillRenderPipeline = device.createRenderPipeline({
    label: "compute_cloth fill render pipeline",
    layout: device.createPipelineLayout({ bindGroupLayouts: [renderBindGroupLayout] }),
    vertex: {
      module: renderModule,
      entryPoint: "vsMain",
      buffers: [{
        arrayStride: 4 * Float32Array.BYTES_PER_ELEMENT,
        attributes: [
          { shaderLocation: 0, offset: 0, format: "float32" },
          { shaderLocation: 1, offset: 4, format: "float32" },
          { shaderLocation: 2, offset: 8, format: "float32" },
          { shaderLocation: 3, offset: 12, format: "float32" }
        ]
      }]
    },
    fragment: {
      module: renderModule,
      entryPoint: "fsMain",
      targets: [{ format: screen.getGPU().format }]
    },
    primitive: {
      topology: "triangle-list",
      cullMode: "none"
    },
    depthStencil: {
      format: CAMERA_REVERSE_Z.format,
      depthWriteEnabled: true,
      depthCompare: CAMERA_REVERSE_Z.compare
    }
  });

  computeBindGroups = [
    device.createBindGroup({
      label: "compute_cloth compute 0 to 1",
      layout: computeBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: stateBuffers[0] } },
        { binding: 1, resource: { buffer: stateBuffers[1] } },
        { binding: 2, resource: { buffer: paramBuffer } }
      ]
    }),
    device.createBindGroup({
      label: "compute_cloth compute 1 to 0",
      layout: computeBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: stateBuffers[1] } },
        { binding: 1, resource: { buffer: stateBuffers[0] } },
        { binding: 2, resource: { buffer: paramBuffer } }
      ]
    })
  ];
  // 各 state buffer を render shader から読める bind group に変換する
  // callback の buffer が binding 0、共通 renderParamBuffer が binding 1 となり、renderBufferIndex だけで表示元を選べる
  renderBindGroups = stateBuffers.map((buffer, i) => {
    return device.createBindGroup({
      label: `compute_cloth render ${i}`,
      layout: renderBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer } },
        { binding: 1, resource: { buffer: renderParamBuffer } }
      ]
    });
  });
};

// 1 compute substep が使う grid、重力、ばね、風、減衰、strain limit を16 floatのuniformへ並べて転送する
// deltaSec はframe時間をsubstep数で割った値で、風と抵抗の力は頂点質量0.02に合わせた値を渡す
// 配列 index と WGSL の ClothParams 配置は対応しているため、順序を変える場合は shader 側も同時に直す必要がある
const writeSimParams = (deltaSec, timeSec) => {
  const params = new Float32Array(PARAM_FLOATS);
  params[0] = GRID_WIDTH;
  params[1] = GRID_HEIGHT;
  params[2] = SPACING;
  params[3] = deltaSec;
  params[4] = 0.0;
  params[5] = -0.54;
  params[6] = 0.0;
  params[7] = SPRING_STIFFNESS;
  params[8] = timeSec;
  params[9] = windEnabled ? WIND_FORCE : 0.0;
  params[10] = VELOCITY_DRAG_FORCE;
  params[11] = Math.pow(FRAME_VELOCITY_RETENTION, 1.0 / SIMULATION_SUBSTEPS);
  params[12] = CLOTH_TOP_Y;
  params[13] = STRUCTURAL_MAX_STRETCH;
  params[14] = STRAIN_LIMIT_BLEND;
  params[15] = FLOOR_Y;
  queue.writeBuffer(paramBuffer, 0, params);
};

// 現在の camera、表示 mode、grid サイズ、視点右上の light direction、固定の布色、PAN量を render shader 用 uniform へ転送する
// canvas の aspect は height 0 を避けて計算し、Wire / Flat / Smooth の mode 値は fragment shader の分岐に使う
// この関数は布頂点を変更せず、同じ state buffer をどの視点と陰影で見せるかだけを更新する
const writeRenderParams = () => {
  const aspect = screen.getWidth() / Math.max(screen.getHeight(), 1);
  const params = new Float32Array(RENDER_PARAM_FLOATS);
  params[0] = cameraYaw;
  params[1] = cameraPitch;
  params[2] = aspect;
  params[3] = cameraDistance;
  params[4] = renderMode;
  params[5] = GRID_WIDTH;
  params[6] = GRID_HEIGHT;
  params[7] = SPACING;
  params[8] = 0.48;
  params[9] = 0.78;
  params[10] = 0.38;
  params[11] = 0.42;
  params[12] = 0.92;
  params[13] = 0.34;
  params[14] = 0.08;
  params[15] = 1.0;
  params[16] = cameraPanX;
  params[17] = cameraPanY;
  params[18] = 0.0;
  params[19] = 0.0;
  queue.writeBuffer(renderParamBuffer, 0, params);
};

// R key から呼ばれ、変形中の布を createInitialClothData() が作る初期配置へ戻す
// ping-pong の両方へ同じ配列を書き、次 frame がどちらを src として選んでも古い変形を読まないようにする
// statePair も 0 に戻し、computeBindGroups[0] の 0 -> 1 フローから再開する
const resetCloth = () => {
  const initial = createInitialClothData();
  queue.writeBuffer(stateBuffers[0], 0, initial);
  queue.writeBuffer(stateBuffers[1], 0, initial);
  statePair.reset();
};

// WebgAppのonComputeFrame handlerから毎frame呼ばれ、simulation更新と現在状態の描画を一つのcommand encoderへ積む
// timeMs は絶対時刻、elapsedSec は前frameからの経過秒で、最大1/60秒を複数substepへ分割する
// 各substepは直前の出力bufferを次の入力として使い、積分とstrain補正を細かく反復して長い布を安定させる
// pause中はcompute passを作らずcurrent bufferを描画し、通常時は最後のsubstep出力を描画する
const renderComputeClothFrame = (timeMs, elapsedSec) => {
  const frameDeltaSec = paused ? 0.0 : Math.min(elapsedSec, 1.0 / 60.0);
  const substepDeltaSec = paused ? 0.0 : frameDeltaSec / SIMULATION_SUBSTEPS;
  const timeSec = timeMs / 1000.0;
  frameNumber += 1;
  writeSimParams(substepDeltaSec, timeSec);
  writeRenderParams();

  const commandEncoder = device.createCommandEncoder({ label: "compute_cloth frame encoder" });
  app.beginGpuTiming();
  let renderBufferIndex = statePair.getCurrentIndex();
  if (!paused) {
    for (let substep = 0; substep < SIMULATION_SUBSTEPS; substep += 1) {
      const computePass = commandEncoder.beginComputePass({
        label: `compute_cloth compute substep ${substep + 1}`,
        timestampWrites: app.getGpuTimestampWrites(
          substep === 0,
          substep === SIMULATION_SUBSTEPS - 1
        )
      });
      computePass.setPipeline(computePipeline);
      computePass.setBindGroup(0, computeBindGroups[renderBufferIndex]);
      computePass.dispatchWorkgroups(Math.ceil(VERTEX_COUNT / WORKGROUP_SIZE));
      computePass.end();
      renderBufferIndex = statePair.getNextIndex(renderBufferIndex);
    }
  }

  const colorView = screen.getGPU().context.getCurrentTexture().createView();
  const renderPass = commandEncoder.beginRenderPass({
    label: "compute_cloth render pass",
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
  const isWireMode = renderMode === RENDER_MODE_WIRE;
  const vertexBuffer = isWireMode ? lineVertexBuffer : triangleVertexBuffer;
  const drawCount = isWireMode ? lineIndexCount : triangleIndexCount;
  renderPass.setPipeline(isWireMode ? wireRenderPipeline : fillRenderPipeline);
  renderPass.setBindGroup(0, renderBindGroups[renderBufferIndex]);
  renderPass.setVertexBuffer(0, vertexBuffer);
  renderPass.draw(drawCount, 1, 0, 0);
  renderPass.end();

  app.endGpuTiming(commandEncoder);
  queue.submit([commandEncoder.finish()]);
  app.afterGpuSubmit();
  statePair.setCurrentIndex(renderBufferIndex);
  updateHelpPanel();
};

// keyboard と Touch button から共通利用する単発 action を sample 状態へ反映する
// 入力元に依存せず同じ関数を通すことで、PC key とスマートフォン button の動作差を作らない
// 未知の action は false を返し、呼び出し側が処理済みか判定できるようにする
const applyAction = (action) => {
  if (action === "pause") {
    paused = !paused;
  } else if (action === "wind") {
    windEnabled = !windEnabled;
  } else if (action === "reset") {
    resetCloth();
  } else if (action === "wire") {
    renderMode = RENDER_MODE_WIRE;
  } else if (action === "flat") {
    renderMode = RENDER_MODE_FLAT;
  } else if (action === "smooth") {
    renderMode = RENDER_MODE_SMOOTH;
  } else {
    return false;
  }
  return true;
};

// 2本以上の touch pointer から重心と先頭2点間の距離を計算する
// 重心差は PAN、距離差は pinch zoom に使用し、毎 move 後に基準を更新して連続操作へ変換する
// pointer 数が2未満なら gesture を構成できないため null を返す
const readTouchGesture = () => {
  const points = [...activeTouchPointers.values()];
  if (points.length < 2) return null;
  let centerX = 0.0;
  let centerY = 0.0;
  for (const point of points) {
    centerX += point.x;
    centerY += point.y;
  }
  centerX /= points.length;
  centerY /= points.length;
  const dx = points[1].x - points[0].x;
  const dy = points[1].y - points[0].y;
  return {
    centerX,
    centerY,
    distance: Math.hypot(dx, dy)
  };
};

// 現在の touch pointer 配置を、次の pointermove が比較する gesture 基準として保存する
// 2本指なら重心と距離、1本指ならその座標を保存し、指の追加・離脱直後の大きな跳びを防ぐ
const resetTouchGestureBaseline = () => {
  const gesture = readTouchGesture();
  if (gesture) {
    lastTouchCenterX = gesture.centerX;
    lastTouchCenterY = gesture.centerY;
    lastTouchDistance = gesture.distance;
    return;
  }
  const point = activeTouchPointers.values().next().value;
  if (point) {
    lastPointerX = point.x;
    lastPointerY = point.y;
  }
  lastTouchDistance = 0.0;
};

// canvas 上で mouse camera 操作または touch gesture が始まった座標を保存する
// pointer capture を設定するため、drag 中に pointer が canvas 外へ出ても pointerup まで同じ操作として扱える
// Shift、右 button、中 button のいずれかなら PAN mode、それ以外なら orbit mode として drag 中は固定する
const handlePointerDown = (event) => {
  if (event.pointerType === "touch") {
    activeTouchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    resetTouchGestureBaseline();
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    return;
  }
  pointerDragging = true;
  pointerPanning = event.shiftKey || event.button === 1 || event.button === 2;
  lastPointerX = event.clientX;
  lastPointerY = event.clientY;
  event.currentTarget.setPointerCapture(event.pointerId);
  event.preventDefault();
};

// mouse drag または touch gesture の移動量を orbit、PAN、zoom の変化へ変換する
// pointerDragging が false なら何もせず、pitch は布を上下反転して見失わない範囲へ制限する
// touch は1本指を orbit、2本以上を重心 PAN と pinch zoom として同時に処理する
// storage buffer 内の布頂点には触れないため、camera を動かしても compute simulation は同じ状態で継続する
const handlePointerMove = (event) => {
  if (event.pointerType === "touch") {
    if (!activeTouchPointers.has(event.pointerId)) return;
    activeTouchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (activeTouchPointers.size >= 2) {
      const gesture = readTouchGesture();
      if (!gesture) return;
      cameraPanX += (gesture.centerX - lastTouchCenterX) * 0.0025;
      cameraPanY -= (gesture.centerY - lastTouchCenterY) * 0.0025;
      cameraDistance = Math.max(2.4, Math.min(
        7.2,
        cameraDistance - (gesture.distance - lastTouchDistance) * 0.008
      ));
      lastTouchCenterX = gesture.centerX;
      lastTouchCenterY = gesture.centerY;
      lastTouchDistance = gesture.distance;
    } else {
      const dx = event.clientX - lastPointerX;
      const dy = event.clientY - lastPointerY;
      lastPointerX = event.clientX;
      lastPointerY = event.clientY;
      cameraYaw += dx * 0.006;
      cameraPitch = Math.max(-1.25, Math.min(0.72, cameraPitch + dy * 0.004));
    }
    event.preventDefault();
    return;
  }
  if (!pointerDragging) return;
  const dx = event.clientX - lastPointerX;
  const dy = event.clientY - lastPointerY;
  lastPointerX = event.clientX;
  lastPointerY = event.clientY;
  if (pointerPanning) {
    cameraPanX += dx * 0.0025;
    cameraPanY -= dy * 0.0025;
    return;
  }
  cameraYaw += dx * 0.006;
  cameraPitch = Math.max(-1.25, Math.min(0.72, cameraPitch + dy * 0.004));
};

// pointerup または pointercancel で mouse drag / touch gesture を終了し、pointer capture を解放する
// touch は終了した指だけを削除し、残った指を新しい基準へ置き直して gesture の跳びを防ぐ
// mouse は従来どおり orbit / PAN mode を終了し、次の pointerdown を新しい操作として扱う
const handlePointerUp = (event) => {
  if (event.pointerType === "touch") {
    activeTouchPointers.delete(event.pointerId);
    resetTouchGestureBaseline();
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    event.preventDefault();
    return;
  }
  pointerDragging = false;
  pointerPanning = false;
  if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
    event.currentTarget.releasePointerCapture(event.pointerId);
  }
};

// canvas 上の右 drag を PAN に利用するため、browser 標準の context menu を表示しない
// pointerdown で右 button を PAN mode として記録し、その後の move を camera offset へ変換する
const handleContextMenu = (event) => {
  event.preventDefault();
};

// wheel の縦方向量を camera distance に加え、布への zoom として扱う
// 極端な接近や遠離を避けるため距離を明示範囲へ制限し、page scroll は preventDefault() で止める
const handleWheel = (event) => {
  cameraDistance = Math.max(2.4, Math.min(7.2, cameraDistance + event.deltaY * 0.0025));
  event.preventDefault();
};

// window の keydown を受け、共通 applyAction() を通して simulation と描画 mode を切り替える
// P は pause、W は風、R は reset、1/2/3 は Wire/Flat/Smooth、H は help panel の折りたたみを担当する
// 次 frame の writeSimParams() / writeRenderParams() が現在値を uniform へ反映するため、ここでは GPU command を直接発行しない
const handleKeyDown = (event) => {
  if (event.key.toLowerCase() === "p") {
    applyAction("pause");
  } else if (event.key.toLowerCase() === "w") {
    applyAction("wind");
  } else if (event.key.toLowerCase() === "r") {
    applyAction("reset");
  } else if (event.key === "1") {
    applyAction("wire");
  } else if (event.key === "2") {
    applyAction("flat");
  } else if (event.key === "3") {
    applyAction("smooth");
  } else if (event.key.toLowerCase() === "h") {
    const panel = app?.getOverlayPanel?.("computeClothHelp");
    panel?.setCollapsed?.(!panel.collapsed);
  }
};

// PC、スマートフォン、タブレットへ、低頻度の単発操作を共通の Touch button として配置する
// camera の連続操作は canvas gesture、mode / wind / pause / reset は button と役割を分ける
// onAction は keyboard と同じ applyAction() を呼び、入力経路ごとの状態差を作らない
const installMobileControls = () => {
  app.input.installTouchControls({
    touchDeviceOnly: false,
    autoSpread: true,
    groups: [
      {
        id: "shade",
        buttons: [
          { key: "wire", label: "1", kind: "action", ariaLabel: "Wire display" },
          { key: "flat", label: "2", kind: "action", ariaLabel: "Flat shading" },
          { key: "smooth", label: "3", kind: "action", ariaLabel: "Smooth shading" }
        ]
      },
      {
        id: "simulation",
        buttons: [
          { key: "reset", label: "R", kind: "action", ariaLabel: "Reset cloth" },
          { key: "pause", label: "P", kind: "action", ariaLabel: "Pause or resume" },
          { key: "wind", label: "W", kind: "action", ariaLabel: "Toggle wind" }
        ]
      }
    ],
    onAction: ({ key }) => {
      applyAction(key);
    }
  });
};

// DOMContentLoaded 後に一度呼ばれ、WebgApp から連続 cloth 描画を開始するまでの初期化を順番に行う
// WebgApp.init() 完了後に Screen / device / queue を取得し、resize、入力 listener、GPU pipeline を準備する
// computeFrameを有効にし、WebgAppの正式handlerから布計算と描画をCompute-first順で実行する
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
      system: "compute_cloth",
      source: "samples/compute_cloth/main.js"
    }
  });
  await app.init();
  screen = app.screen;
  device = app.getGPU().device;
  queue = app.getGPU().queue;
  resizeToWindow();
  screen.canvas.style.touchAction = "none";
  window.addEventListener("resize", resizeToWindow);
  window.addEventListener("orientationchange", resizeToWindow);
  window.addEventListener("keydown", handleKeyDown);
  screen.canvas.addEventListener("pointerdown", handlePointerDown);
  screen.canvas.addEventListener("pointermove", handlePointerMove);
  screen.canvas.addEventListener("pointerup", handlePointerUp);
  screen.canvas.addEventListener("pointercancel", handlePointerUp);
  screen.canvas.addEventListener("contextmenu", handleContextMenu);
  screen.canvas.addEventListener("wheel", handleWheel, { passive: false });
  createPipelines();
  showHelpPanel();
  installMobileControls();
  app.start({
    onComputeFrame: (ctx) => {
      renderComputeClothFrame(ctx.timeMs, ctx.deltaSec);
    }
  });
};

// HTML の解析完了を待って start() を呼ぶ entry point
// 非同期初期化に失敗した場合は console と OverlayPanel へ理由を出し、黒画面だけで失敗を隠さない
document.addEventListener("DOMContentLoaded", () => {
  // Promise rejection を受け取り、WebGPU validation や初期化失敗を利用者が読める表示へ変換する
  start().catch((error) => {
    console.error("compute_cloth failed:", error);
    app?.showOverlayPanel?.(buildErrorPanelOptions(error, {
      title: "compute_cloth failed",
      id: "start-error",
      background: "rgba(28, 22, 18, 0.92)"
    }));
  });
});
