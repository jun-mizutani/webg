// ---------------------------------------------
// samples/compute_physics_bounce/main.js  2026/07/25
//   Compute Shader sphere rigid-body simulation sample
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import WebgApp from "../../webg/WebgApp.js?v=20260614_compute_frame1";
import PingPongBuffer from "../../webg/PingPongBuffer.js";
import { buildErrorPanelOptions, buildHelpPanelOptions } from "../../webg/OverlayPanelPresets.js";
import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";
import Matrix from "../../webg/Matrix.js";
import Diagnostics from "../../webg/Diagnostics.js";
import { CAMERA_REVERSE_Z } from "../../webg/DepthConvention.js";

const DEFAULT_BALL_COUNT = 96;
const MAX_BALL_COUNT = 512;
const WORKGROUP_SIZE = 64;
const SUBSTEPS = 2;
const FPS_SAMPLE_FRAMES = 10;
const MIN_RESTITUTION = 0.78;
const MAX_RESTITUTION = 0.98;
const FLOOR_RESTITUTION_BOOST = 0.04;
const MIN_FRICTION = 0.04;
const MAX_FRICTION = 0.16;
const AIR_DAMPING = 0.02;
const WORLD_SCALE = 0.01;
const GRAVITY_ACCELERATION = 9.80665 / 6;
const TILT_X_RADIANS = 16 * Math.PI / 180;
const TILT_Z_RADIANS = 12 * Math.PI / 180;
const TILT_PIVOT_Y = 8.0 * WORLD_SCALE;
const FLOATS_PER_BALL = 12;
const BYTES_PER_BALL = FLOATS_PER_BALL * Float32Array.BYTES_PER_ELEMENT;
const SIM_PARAM_FLOATS = 16;
const RENDER_PARAM_FLOATS = 40;
const ARENA_CENTER_Z = -18.0 * WORLD_SCALE;
const ARENA_HALF_WIDTH = 38.0 * WORLD_SCALE;
const ARENA_HALF_DEPTH = 25.0 * WORLD_SCALE;
const FLOOR_Y = -12.0 * WORLD_SCALE;
const CEILING_Y = 52.0 * WORLD_SCALE;
const CLEAR_COLOR = [0.025, 0.042, 0.052, 1.0];

// 球体1個の状態は vec4f x 3 へまとめます
// xyz は位置・速度・色、w はそれぞれ半径・反発係数・摩擦係数として使います
// この配列を2本用意し、Compute Shaderがsrcから読みdstへ書くping-pong方式で更新します
const COMPUTE_SHADER = `
struct Ball {
  positionRadius : vec4f,
  velocityRestitution : vec4f,
  colorFriction : vec4f,
};

struct SimParams {
  // timing.x = substep秒, y = 球数, z = 球同士の衝突ON/OFF
  timing : vec4f,
  // gravity.xyz = 容器ローカル座標の重力, w = 空気抵抗
  gravity : vec4f,
  // arena = X/Z方向の衝突境界
  arena : vec4f,
  // vertical.xy = 床と天井のY座標
  vertical : vec4f,
};

// srcBallsはこのsubstep開始時のsnapshotです
// invocationごとに担当球だけをdstBallsへ書くため、GPU上の書き込み競合を避けられます
@group(0) @binding(0) var<storage, read> srcBalls : array<Ball>;
@group(0) @binding(1) var<storage, read_write> dstBalls : array<Ball>;
@group(0) @binding(2) var<uniform> params : SimParams;

// 箱型容器の6面に対する位置補正と反射をまとめたhelperです
// 衝突面の法線方向は反発係数で反転し、接線方向は摩擦係数で少し減衰させます
fn solveBoundary(
  position : ptr<function, vec3f>,
  velocity : ptr<function, vec3f>,
  radius : f32,
  restitution : f32,
  friction : f32
) {
  let minX = params.arena.x + radius;
  let maxX = params.arena.y - radius;
  let minZ = params.arena.z + radius;
  let maxZ = params.arena.w - radius;
  let floorLimit = params.vertical.x + radius;
  let ceilingLimit = params.vertical.y - radius;
  let wallFriction = 1.0 - friction * 0.08;

  // 左右の壁ではX速度を反転し、壁面に沿うY/Z速度へ摩擦を適用します
  if ((*position).x < minX) {
    (*position).x = minX;
    (*velocity).x = abs((*velocity).x) * restitution;
    (*velocity).y *= wallFriction;
    (*velocity).z *= wallFriction;
  } else if ((*position).x > maxX) {
    (*position).x = maxX;
    (*velocity).x = -abs((*velocity).x) * restitution;
    (*velocity).y *= wallFriction;
    (*velocity).z *= wallFriction;
  }

  // 前後の壁ではZ速度を反転し、壁面に沿うX/Y速度へ摩擦を適用します
  if ((*position).z < minZ) {
    (*position).z = minZ;
    (*velocity).z = abs((*velocity).z) * restitution;
    (*velocity).x *= wallFriction;
    (*velocity).y *= wallFriction;
  } else if ((*position).z > maxZ) {
    (*position).z = maxZ;
    (*velocity).z = -abs((*velocity).z) * restitution;
    (*velocity).x *= wallFriction;
    (*velocity).y *= wallFriction;
  }

  // 床は跳ね返りを見やすくするため、球の反発係数へ小さなboostを加えます
  // ごく小さな上下速度だけ0へ丸め、接触面で細かく振動し続ける状態を抑えます
  if ((*position).y < floorLimit) {
    (*position).y = floorLimit;
    if ((*velocity).y < 0.0) {
      let floorRestitution = min(0.995, restitution + ${FLOOR_RESTITUTION_BOOST});
      (*velocity).y = -(*velocity).y * floorRestitution;
    }
    let floorFriction = max(0.0, 1.0 - friction * 0.10);
    (*velocity).x *= floorFriction;
    (*velocity).z *= floorFriction;
    if (abs((*velocity).y) < 0.0005) {
      (*velocity).y = 0.0;
    }
  } else if ((*position).y > ceilingLimit) {
    (*position).y = ceilingLimit;
    (*velocity).y = -abs((*velocity).y) * restitution;
  }
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  // X方向のinvocation 1つが球体1個を担当します
  // workgroup末尾の余分なinvocationは、実際の球数を越えた時点で終了します
  let index = id.x;
  let count = u32(params.timing.y);
  if (index >= count) {
    return;
  }

  let source = srcBalls[index];
  let radius = source.positionRadius.w;
  let restitution = source.velocityRestitution.w;
  let friction = source.colorFriction.w;
  let dt = params.timing.x;
  var position = source.positionRadius.xyz;
  var velocity = source.velocityRestitution.xyz;

  // semi-implicit Euler法で、速度を先に更新してから位置へ積分します
  // exp()による減衰はframe rateに依存しにくい空気抵抗として使います
  velocity += params.gravity.xyz * dt;
  velocity *= exp(-params.gravity.w * dt);
  position += velocity * dt;

  // 全球体が同じsrc snapshotを読み、自分の速度と位置だけをdstへ書きます
  // この方式は書き込み競合を避けますが、全球走査なのでO(N^2)です
  if (params.timing.z > 0.5) {
    var correction = vec3f(0.0);
    for (var otherIndex = 0u; otherIndex < ${MAX_BALL_COUNT}u; otherIndex += 1u) {
      if (otherIndex < count && otherIndex != index) {
        let other = srcBalls[otherIndex];
        // 相手球も同じdtだけ予測した位置を使い、両者を同じ時刻で比較します
        var otherVelocity = other.velocityRestitution.xyz + params.gravity.xyz * dt;
        otherVelocity *= exp(-params.gravity.w * dt);
        let otherPosition = other.positionRadius.xyz + otherVelocity * dt;
        let delta = otherPosition - position;
        let minDistance = radius + other.positionRadius.w;
        let distanceSq = dot(delta, delta);
        if (distanceSq < minDistance * minDistance && distanceSq > 0.0000000001) {
          // 球中心間距離が半径の合計より短ければ重なっています
          // normalは自球から相手球へ向かう接触法線です
          let distance = sqrt(distanceSq);
          let normal = delta / distance;
          let relativeVelocity = velocity - otherVelocity;
          let closingSpeed = dot(relativeVelocity, normal);
          let combinedRestitution = min(restitution, other.velocityRestitution.w);
          let combinedFriction = sqrt(max(friction * other.colorFriction.w, 0.0));

          if (closingSpeed > 0.0) {
            // 等質量2球の法線インパルスを、自球へ作用する半分として適用します
            let impulse = (1.0 + combinedRestitution) * closingSpeed * 0.5;
            velocity -= normal * impulse;

            let tangentVelocity = relativeVelocity - normal * closingSpeed;
            let tangentLength = length(tangentVelocity);
            if (tangentLength > 0.000001) {
              // 法線と直交する相対速度を摩擦インパルスで減らします
              // Coulomb摩擦を簡略化し、法線インパルスに摩擦係数を掛けた値で上限を設けます
              let frictionImpulse = min(tangentLength * 0.5, impulse * combinedFriction);
              velocity -= tangentVelocity / tangentLength * frictionImpulse;
            }
          }

          let penetration = minDistance - distance;
          // 速度だけでは既に発生した重なりを解消できないため、位置補正も蓄積します
          correction -= normal * penetration * 0.52;
        }
      }
    }
    let correctionLength = length(correction);
    // 多数の球と同時接触した場合に、位置補正が一度に大きくなりすぎないよう制限します
    if (correctionLength > radius * 0.8) {
      correction *= radius * 0.8 / correctionLength;
    }
    position += correction;
  }

  // 球同士の応答後に容器境界を解決し、最終状態をdstへ書き込みます
  solveBoundary(&position, &velocity, radius, restitution, friction);

  var result = source;
  result.positionRadius = vec4f(position, radius);
  result.velocityRestitution = vec4f(velocity, restitution);
  dstBalls[index] = result;
}`;

const RENDER_SHADER = `
// Compute Shaderと同じBall layoutをVertex Shaderからread-only storageとして読みます
// CPUへ位置をreadbackせず、そのままinstance描画へ渡すのがこのsampleの要点です
struct Ball {
  positionRadius : vec4f,
  velocityRestitution : vec4f,
  colorFriction : vec4f,
};

struct RenderParams {
  projection : mat4x4f,
  view : mat4x4f,
  // light.xyz = view空間のライト方向, w = specular基準強度
  light : vec4f,
  // control.xy = 容器のX/Z傾斜角, zw = 回転中心のY/Z座標
  control : vec4f,
};

struct ArenaInstance {
  center : vec4f,
  halfColorIndex : vec4f,
};

@group(0) @binding(0) var<storage, read> balls : array<Ball>;
@group(0) @binding(1) var<uniform> params : RenderParams;
@group(0) @binding(2) var<storage, read> arenaInstances : array<ArenaInstance>;

struct VertexInput {
  @location(0) position : vec3f,
  @location(1) normal : vec3f,
  @location(2) texCoord : vec2f,
};

struct VertexOutput {
  @builtin(position) position : vec4f,
  @location(0) viewPosition : vec3f,
  @location(1) viewNormal : vec3f,
  @location(2) color : vec4f,
};

fn arenaColor(index : f32) -> vec4f {
  if (index < 0.5) {
    return vec4f(0.40, 0.76, 0.98, 1.0);
  }
  if (index < 1.5) {
    return vec4f(0.30, 0.66, 0.94, 1.0);
  }
  return vec4f(0.24, 0.58, 0.88, 1.0);
}

// 物理状態は容器ローカル座標で保持します
// 描画時だけX回転後にZ回転を適用し、球体と容器を一体として傾けます
fn rotateTiltVector(value : vec3f) -> vec3f {
  let sinX = sin(params.control.x);
  let cosX = cos(params.control.x);
  let sinZ = sin(params.control.y);
  let cosZ = cos(params.control.y);
  let rotatedX = vec3f(
    value.x,
    cosX * value.y - sinX * value.z,
    sinX * value.y + cosX * value.z
  );
  return vec3f(
    cosZ * rotatedX.x - sinZ * rotatedX.y,
    sinZ * rotatedX.x + cosZ * rotatedX.y,
    rotatedX.z
  );
}

// 位置には回転中心からの相対座標を使い、法線などの方向ベクトルには平行移動を適用しません
fn rotateTiltPoint(value : vec3f) -> vec3f {
  let pivot = vec3f(0.0, params.control.z, params.control.w);
  return pivot + rotateTiltVector(value - pivot);
}

@vertex
fn vsBall(input : VertexInput, @builtin(instance_index) instanceIndex : u32) -> VertexOutput {
  // instanceIndexをBall配列のindexとして使い、共通sphere meshを位置と半径で変換します
  let ball = balls[instanceIndex];
  let localPosition = ball.positionRadius.xyz + input.position * ball.positionRadius.w;
  let worldPosition = rotateTiltPoint(localPosition);
  let viewPosition = params.view * vec4f(worldPosition, 1.0);
  var output : VertexOutput;
  output.position = params.projection * viewPosition;
  output.viewPosition = viewPosition.xyz;
  output.viewNormal = normalize(
    (params.view * vec4f(rotateTiltVector(input.normal), 0.0)).xyz
  );
  output.color = vec4f(ball.colorFriction.rgb, 1.0);
  return output;
}

@vertex
fn vsArena(input : VertexInput, @builtin(instance_index) instanceIndex : u32) -> VertexOutput {
  // 床と4枚の壁は共通cube meshを5 instance描画します
  // centerとhalf extentsはarenaInstancesから読み、球と同じ傾斜変換を適用します
  let instance = arenaInstances[instanceIndex];
  let localPosition = instance.center.xyz + input.position * instance.halfColorIndex.xyz;
  let worldPosition = rotateTiltPoint(localPosition);
  let viewPosition = params.view * vec4f(worldPosition, 1.0);
  var output : VertexOutput;
  output.position = params.projection * viewPosition;
  output.viewPosition = viewPosition.xyz;
  output.viewNormal = normalize(
    (params.view * vec4f(rotateTiltVector(input.normal), 0.0)).xyz
  );
  output.color = arenaColor(instance.halfColorIndex.w);
  return output;
}

fn shadeSurface(input : VertexOutput, shininess : f32, specularStrength : f32) -> vec4f {
  // view空間でBlinn-Phong lightingを計算します
  // 球と容器でshininessを変えられるよう、共通処理をhelperへまとめています
  let normal = normalize(input.viewNormal);
  let lightDirection = normalize(params.light.xyz);
  let viewDirection = normalize(-input.viewPosition);
  let diffuse = max(dot(normal, lightDirection), 0.0);
  let halfVector = normalize(lightDirection + viewDirection);
  let specular =
    pow(max(dot(normal, halfVector), 0.0), shininess) *
    params.light.w * specularStrength;
  let color = input.color.rgb * (0.20 + diffuse * 0.82) + vec3f(specular);
  return vec4f(color, input.color.a);
}

@fragment
fn fsBall(input : VertexOutput) -> @location(0) vec4f {
  // 球は小さく鋭いhighlightにして、回転のない球体でも立体感が分かるようにします
  return shadeSurface(input, 128.0, 1.9);
}

@fragment
fn fsArena(input : VertexOutput) -> @location(0) vec4f {
  // cube4と同様にwire colorを直接出し、細い枠線の視認性を保ちます
  return input.color;
}`;

let app = null;
let screen = null;
let device = null;
let queue = null;
let stateBuffers = [];
let statePair = null;
let simParamBuffer = null;
let renderParamBuffer = null;
let arenaBuffer = null;
let computePipeline = null;
let ballPipeline = null;
let arenaPipeline = null;
let computeBindGroups = [];
let renderBindGroups = [];
let sphereShape = null;
let cubeShape = null;
let ballCount = DEFAULT_BALL_COUNT;
let paused = false;
let collisionsEnabled = true;
let tiltEnabled = true;
let tiltElapsedSec = 0;
let tiltX = 0;
let tiltZ = 0;
let orbit = null;
let lastHelpText = "";
let displayedFps = 0;
let fpsFrameCount = 0;
let fpsElapsedMs = 0;

// WebgAppが時間差分を検証した直後に呼ぶ正式handlerから、表示用の平均FPSを更新する
// simulation時間やGPU command発行はonComputeFrameへ分離し、計測処理と混在させない
const updateFrameTiming = (deltaMs) => {
  if (deltaMs <= 0.0) return;
  fpsElapsedMs += deltaMs;
  fpsFrameCount += 1;
  if (fpsFrameCount >= FPS_SAMPLE_FRAMES) {
    displayedFps = fpsFrameCount * 1000 / fpsElapsedMs;
    fpsFrameCount = 0;
    fpsElapsedMs = 0;
  }
};

// `ball`の`count`を読み込み、検証済みのデータとして後続処理へ渡す
function readBallCount() {
  // ?count=512 のようなURL parameterで負荷を変更できます
  // storage bufferとdispatch数を安全な範囲に保つため、1..MAX_BALL_COUNTへclampします
  const raw = new URL(window.location.href).searchParams.get("count");
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed)
    ? Math.max(1, Math.min(MAX_BALL_COUNT, parsed))
    : DEFAULT_BALL_COUNT;
}

// `hash01`の条件を判定し、結果を真偽値で返す
function hash01(value) {
  // 初期配置を毎回同じにするため、外部乱数を使わない簡易deterministic hashです
  const x = Math.sin(value * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

// `initial`の`ball`のデータを生成し、後続処理で利用できる状態にする
function createInitialBallData() {
  // JavaScript側もWGSLのBallと同じ12 float strideで初期状態を作ります
  // positionRadius / velocityRestitution / colorFriction の順に連続して格納します
  const data = new Float32Array(ballCount * FLOATS_PER_BALL);
  const columns = 12;
  const rows = 8;
  const layerSize = columns * rows;
  const palette = [
    [0.92, 0.28, 0.18], [0.18, 0.62, 0.94], [0.20, 0.84, 0.46],
    [0.96, 0.68, 0.16], [0.68, 0.30, 0.92], [0.12, 0.82, 0.82]
  ];
  for (let i = 0; i < ballCount; i += 1) {
    // 球を格子状に離して配置し、半径分のjitterを加えて完全な規則運動を避けます
    // 96個を越えた分は上方向のlayerへ積み上げます
    const layer = Math.floor(i / layerSize);
    const layerIndex = i % layerSize;
    const row = Math.floor(layerIndex / columns);
    const column = layerIndex % columns;
    const radius = (1.25 + hash01(i * 2.31 + 1.7) * 0.55) * WORLD_SCALE;
    const x = (-31.0 + column * 5.6 + (hash01(i * 3.17) - 0.5) * 0.7) * WORLD_SCALE;
    const z = ARENA_CENTER_Z +
      (-19.0 + row * 5.4 + (hash01(i * 5.91) - 0.5) * 0.7) * WORLD_SCALE;
    // 既定の1層目はwireframe枠の上端0.28 m付近から落下させます
    // 96球を越えた分は天井方向へ層を追加します
    const y = (22.0 + layer * 5.2 + hash01(i * 7.43) * 3.0) * WORLD_SCALE;
    const inwardX = x < 0 ? 1 : -1;
    const inwardZ = z < ARENA_CENTER_Z ? 1 : -1;
    const offset = i * FLOATS_PER_BALL;
    const color = palette[i % palette.length];
    // vec4 1: position.xyz + radius
    data.set([x, y, z, radius], offset);
    // vec4 2: velocity.xyz + restitution
    // 水平方向は容器中央へ向け、初期状態から球同士が衝突するようにします
    data.set([
      inwardX * (4.5 + hash01(i * 9.11) * 8.0) * WORLD_SCALE,
      (-2.0 - hash01(i * 4.33) * 7.0) * WORLD_SCALE,
      inwardZ * (1.0 + hash01(i * 8.27) * 3.5) * WORLD_SCALE,
      MIN_RESTITUTION + hash01(i * 6.73) * (MAX_RESTITUTION - MIN_RESTITUTION)
    ], offset + 4);
    // vec4 3: color.rgb + friction
    data.set([
      color[0], color[1], color[2],
      MIN_FRICTION + hash01(i * 11.7) * (MAX_FRICTION - MIN_FRICTION)
    ], offset + 8);
  }
  return data;
}

// 形状を生成し、後続処理で利用できる状態にする
function createShape(assetFactory) {
  // Primitiveが返すCPU側meshをShapeへ登録し、vertex/index bufferをGPUへ作ります
  const shape = new Shape(app.getGPU());
  shape.applyPrimitiveAsset(assetFactory(shape.getPrimitiveOptions()));
  shape.endShape();
  return shape;
}

// `arena`のデータを生成し、後続処理で利用できる状態にする
function createArenaData() {
  // ArenaInstanceはcenter.xyz + unused、half extents.xyz + color indexの8 floatです
  // 床1枚と左右・前後の壁4枚を、共通cube meshのinstanceとして描画します
  return new Float32Array([
    0, FLOOR_Y - 0.5 * WORLD_SCALE, ARENA_CENTER_Z, 0,
    ARENA_HALF_WIDTH + 2 * WORLD_SCALE, 0.5 * WORLD_SCALE,
    ARENA_HALF_DEPTH + 2 * WORLD_SCALE, 0,
    -ARENA_HALF_WIDTH - WORLD_SCALE, 8 * WORLD_SCALE, ARENA_CENTER_Z, 0,
    WORLD_SCALE, 20 * WORLD_SCALE, ARENA_HALF_DEPTH + 2 * WORLD_SCALE, 1,
    ARENA_HALF_WIDTH + WORLD_SCALE, 8 * WORLD_SCALE, ARENA_CENTER_Z, 0,
    WORLD_SCALE, 20 * WORLD_SCALE, ARENA_HALF_DEPTH + 2 * WORLD_SCALE, 1,
    0, 8 * WORLD_SCALE, ARENA_CENTER_Z - ARENA_HALF_DEPTH - WORLD_SCALE, 0,
    ARENA_HALF_WIDTH, 20 * WORLD_SCALE, WORLD_SCALE, 2,
    0, 8 * WORLD_SCALE, ARENA_CENTER_Z + ARENA_HALF_DEPTH + WORLD_SCALE, 0,
    ARENA_HALF_WIDTH, 20 * WORLD_SCALE, WORLD_SCALE, 2
  ]);
}

// `pipelines`を生成し、後続処理で利用できる状態にする
function createPipelines() {
  // 2本のstate bufferへ同じ初期状態を書きます
  // substepごとにread/writeの役割を交換し、同じbufferの同一要素を同時に読み書きしません
  const initial = createInitialBallData();
  stateBuffers = [0, 1].map((index) => {
    const buffer = device.createBuffer({
      label: `compute-physics-bounce:state-${index}`,
      size: initial.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    queue.writeBuffer(buffer, 0, initial);
    return buffer;
  });
  statePair = new PingPongBuffer(stateBuffers, { label: "compute_physics_bounce state" });
  // SimParamsはCompute Shader専用、RenderParamsはVertex/Fragment Shader専用のuniformです
  simParamBuffer = device.createBuffer({
    label: "compute-physics-bounce:sim-params",
    size: SIM_PARAM_FLOATS * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });
  renderParamBuffer = device.createBuffer({
    label: "compute-physics-bounce:render-params",
    size: RENDER_PARAM_FLOATS * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });
  const arenaData = createArenaData();
  // 容器instanceはsimulation中に変化しないため、1本のread-only storage bufferに固定します
  arenaBuffer = device.createBuffer({
    label: "compute-physics-bounce:arena",
    size: arenaData.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  });
  queue.writeBuffer(arenaBuffer, 0, arenaData);

  const computeLayout = device.createBindGroupLayout({
    entries: [
      // binding 0: substep開始時の全Ball snapshot
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      // binding 1: invocationごとの更新結果
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      // binding 2: dt、球数、重力、容器境界
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } }
    ]
  });
  const renderLayout = device.createBindGroupLayout({
    entries: [
      // binding 0: 最終substep後のBall state。Vertex Shaderがinstance情報として読みます
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
      // binding 1: camera、light、容器傾斜
      { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
      // binding 2: 床と壁のinstance情報
      { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } }
    ]
  });
  // Compute pipelineは球体の積分、球-球衝突、容器境界衝突を1つのentry pointで処理します
  computePipeline = device.createComputePipeline({
    label: "compute-physics-bounce:compute",
    layout: device.createPipelineLayout({ bindGroupLayouts: [computeLayout] }),
    compute: {
      module: device.createShaderModule({ code: COMPUTE_SHADER }),
      entryPoint: "main"
    }
  });
  // 球と容器は同じvertex layoutとshader moduleを共有し、entry pointとcull modeだけ切り替えます
  const renderModule = device.createShaderModule({ code: RENDER_SHADER });
  const vertex = (entryPoint) => ({
    module: renderModule,
    entryPoint,
    buffers: [{
      arrayStride: 8 * 4,
      attributes: [
        { shaderLocation: 0, offset: 0, format: "float32x3" },
        { shaderLocation: 1, offset: 12, format: "float32x3" },
        { shaderLocation: 2, offset: 24, format: "float32x2" }
      ]
    }]
  });
  const createRenderPipeline = (
    label,
    vertexEntryPoint,
    fragmentEntryPoint,
    topology,
    cullMode
  ) => device.createRenderPipeline({
    label,
    layout: device.createPipelineLayout({ bindGroupLayouts: [renderLayout] }),
    vertex: vertex(vertexEntryPoint),
    fragment: {
      module: renderModule,
      entryPoint: fragmentEntryPoint,
      targets: [{ format: screen.getGPU().format }]
    },
    primitive: { topology, cullMode, frontFace: "ccw" },
    depthStencil: {
      format: CAMERA_REVERSE_Z.format,
      depthWriteEnabled: true,
      depthCompare: CAMERA_REVERSE_Z.compare
    }
  });
  ballPipeline = createRenderPipeline(
    "compute-physics-bounce:balls", "vsBall", "fsBall", "triangle-list", "back"
  );
  arenaPipeline = createRenderPipeline(
    "compute-physics-bounce:arena", "vsArena", "fsArena", "line-list", "none"
  );

  // index 0はstate[0]を読んでstate[1]へ書き、index 1はその逆です
  // statePairが示す現在indexをsubstepごとに反転するだけでping-pongできます
  computeBindGroups = [
    device.createBindGroup({
      layout: computeLayout,
      entries: [
        { binding: 0, resource: { buffer: stateBuffers[0] } },
        { binding: 1, resource: { buffer: stateBuffers[1] } },
        { binding: 2, resource: { buffer: simParamBuffer } }
      ]
    }),
    device.createBindGroup({
      layout: computeLayout,
      entries: [
        { binding: 0, resource: { buffer: stateBuffers[1] } },
        { binding: 1, resource: { buffer: stateBuffers[0] } },
        { binding: 2, resource: { buffer: simParamBuffer } }
      ]
    })
  ];
  // Render Bind Groupもstate bufferごとに作り、最後に書き込まれた側を描画時に選びます
  renderBindGroups = stateBuffers.map((buffer) => device.createBindGroup({
    layout: renderLayout,
    entries: [
      { binding: 0, resource: { buffer } },
      { binding: 1, resource: { buffer: renderParamBuffer } },
      { binding: 2, resource: { buffer: arenaBuffer } }
    ]
  }));
}

// `sim`の`params`を指定された形式または保存先へ出力する
function writeSimParams(deltaSec) {
  // 世界の下向き重力を、傾いた容器のローカル座標へ逆回転します
  // 物理座標自体は軸平行の箱として保てるため、境界判定を単純なmin/max比較のまま扱えます
  const gravityX = -GRAVITY_ACCELERATION * Math.sin(tiltZ);
  const gravityY = -GRAVITY_ACCELERATION * Math.cos(tiltZ) * Math.cos(tiltX);
  const gravityZ = GRAVITY_ACCELERATION * Math.cos(tiltZ) * Math.sin(tiltX);
  const values = new Float32Array([
    deltaSec, ballCount, collisionsEnabled ? 1 : 0, 0,
    gravityX, gravityY, gravityZ, AIR_DAMPING,
    -ARENA_HALF_WIDTH, ARENA_HALF_WIDTH,
    ARENA_CENTER_Z - ARENA_HALF_DEPTH, ARENA_CENTER_Z + ARENA_HALF_DEPTH,
    FLOOR_Y, CEILING_Y, 0, 0
  ]);
  queue.writeBuffer(simParamBuffer, 0, values);
}

// `render`の`params`を指定された形式または保存先へ出力する
function writeRenderParams() {
  // Eye Nodeのworld matrixからview matrixを作り、projectionと連続したuniformへ詰めます
  // controlには物理側と同じ傾斜角を渡し、球と容器を同じ姿勢で描画します
  app.eye.setWorldMatrix();
  const view = new Matrix();
  view.makeView(app.eye.worldMatrix);
  const values = new Float32Array(RENDER_PARAM_FLOATS);
  values.set(app.projectionMatrix.mat, 0);
  values.set(view.mat, 16);
  values.set([0.42, 0.78, 0.56, 0.46], 32);
  values.set([tiltX, tiltZ, TILT_PIVOT_Y, ARENA_CENTER_Z], 36);
  queue.writeBuffer(renderParamBuffer, 0, values);
}

// `simulation`を初期状態へ戻し、前回の状態を残さない
function resetSimulation() {
  // GPUから状態をreadbackせず、決定的に再生成した初期データを両bufferへ書き戻します
  const initial = createInitialBallData();
  queue.writeBuffer(stateBuffers[0], 0, initial);
  queue.writeBuffer(stateBuffers[1], 0, initial);
  statePair.reset();
}

// keyboardとTouch buttonから共通利用する単発操作です
// 入力経路に関係なく、状態変更後は同じHelp panelを更新します
function applyControlAction(action) {
  if (action === "pause" || action === "p" || action === " ") {
    paused = !paused;
  } else if (action === "collisions" || action === "c") {
    collisionsEnabled = !collisionsEnabled;
  } else if (action === "tilt" || action === "t") {
    tiltEnabled = !tiltEnabled;
  } else if (action === "reset" || action === "r") {
    resetSimulation();
  } else {
    return;
  }
  updateHelpPanel();
}

// cameraのorbit/zoomはcanvas gestureへ任せ、低頻度のsimulation操作だけをbuttonにします
function installTouchControls() {
  app.input.installTouchControls({
    touchDeviceOnly: false,
    autoSpread: true,
    groups: [{
      id: "simulation",
      buttons: [
        { key: "tilt", label: "T", kind: "action", ariaLabel: "Toggle container tilt" },
        { key: "collisions", label: "C", kind: "action", ariaLabel: "Toggle sphere collisions" },
        { key: "pause", label: "P", kind: "action", ariaLabel: "Pause or resume simulation" },
        { key: "reset", label: "R", kind: "action", ariaLabel: "Reset simulation" }
      ]
    }],
    onAction: ({ key }) => applyControlAction(key)
  });
}

// ヘルプの行を生成し、後続処理で利用できる状態にする
function buildHelpLines() {
  // FPSと操作状態を同じoverlayへ表示し、球数を変えたときの負荷比較をしやすくします
  return [
    "Compute sphere rigid-body bounce",
    `balls: ${ballCount} / ${MAX_BALL_COUNT}  fps: ${displayedFps.toFixed(1)} (10-frame avg)`,
    `workgroup: ${WORKGROUP_SIZE}  restitution: ${MIN_RESTITUTION.toFixed(2)}-${MAX_RESTITUTION.toFixed(2)}`,
    `floor boost: +${FLOOR_RESTITUTION_BOOST.toFixed(2)}  friction: ${MIN_FRICTION.toFixed(2)}-${MAX_FRICTION.toFixed(2)}`,
    `scale: 1/100  gravity: ${GRAVITY_ACCELERATION.toFixed(3)} m/s^2`,
    `simulation: ${paused ? "paused" : "running"}  sphere collisions: ${collisionsEnabled ? "on" : "off"}`,
    `container tilt: ${tiltEnabled ? "on" : "off"}  max: X 16 deg / Z 12 deg`,
    `solver: brute force O(N^2), ${SUBSTEPS} substeps`,
    "GPU: integrate / floor-wall collision / sphere collision",
    "Render: storage-buffer spheres / wireframe container",
    ...(app?.getFrameTimingLines?.() ?? []),
    "Drag or Arrow keys: orbit  Wheel: zoom",
    "[t] container tilt on/off  [c] collisions  [p] pause  [r] reset",
    "Touch: T tilt / C collisions / P pause / R reset",
    `URL: ?count=1..${MAX_BALL_COUNT}`
  ];
}

// ヘルプのパネルを現在の入力と実行状態に合わせて更新する
function updateHelpPanel(force = false) {
  // 表示内容が変わらないframeはpanel更新を省略します
  const lines = buildHelpLines();
  const text = lines.join("\n");
  if (!force && text === lastHelpText) return;
  if (force) {
    app.showOverlayPanel(buildHelpPanelOptions({
      id: "computePhysicsBounceHelp",
      collapsed: true,
      lines
    }));
  } else {
    app.updateOverlayPanel("computePhysicsBounceHelp", { lines });
  }
  lastHelpText = text;
}

// フレームの描画段階で、必要な描画命令と表示内容を記録する
function renderFrame(elapsedSec) {
  // 長いframeの直後にsimulationが一気に進まないよう、物理へ渡すdtを1/30秒でclampします
  // さらに2 substepへ分割し、高速な球が床や他球を抜ける可能性を下げます
  const frameDelta = paused ? 0 : Math.min(elapsedSec, 1 / 30);
  if (tiltEnabled && !paused) {
    // X/Zで異なる周期のsin波を使い、容器が単純な一方向往復に見えないようにします
    tiltElapsedSec += frameDelta;
    tiltX = Math.sin(tiltElapsedSec * 0.275) * TILT_X_RADIANS;
    tiltZ = Math.sin(tiltElapsedSec * 0.205 + 1.2) * TILT_Z_RADIANS;
  } else if (!tiltEnabled) {
    tiltX = 0;
    tiltZ = 0;
  }
  const substepDelta = frameDelta / SUBSTEPS;
  writeSimParams(substepDelta);
  writeRenderParams();

  // ComputeとRenderを同じcommand encoderへ順番に記録します
  // Queueへsubmitした時点で、Computeの書き込み完了後にRenderが同じbufferを読む順序が保証されます
  const encoder = device.createCommandEncoder({ label: "compute-physics-bounce:frame" });
  app.beginGpuTiming();
  let renderBufferIndex = statePair.getCurrentIndex();
  if (!paused) {
    for (let i = 0; i < SUBSTEPS; i += 1) {
      const pass = encoder.beginComputePass({
        label: `compute-physics-bounce:substep-${i + 1}`,
        timestampWrites: app.getGpuTimestampWrites(i === 0, i === SUBSTEPS - 1)
      });
      pass.setPipeline(computePipeline);
      pass.setBindGroup(0, computeBindGroups[renderBufferIndex]);
      // 球1個につきinvocation 1つを起動し、端数はWGSL側のindex判定で除外します
      pass.dispatchWorkgroups(Math.ceil(ballCount / WORKGROUP_SIZE));
      pass.end();
      // 今回のdstを次substepのsrcにするため、buffer indexを反転します
      renderBufferIndex = statePair.getNextIndex(renderBufferIndex);
    }
  }

  // Compute後の最新stateを使い、wireframe容器5 instance、球ballCount instanceの順に描画します
  const renderPass = encoder.beginRenderPass({
    label: "compute-physics-bounce:render",
    timestampWrites: app.getGpuRenderTimestampWrites(),
    colorAttachments: [{
      view: screen.getGPU().context.getCurrentTexture().createView(),
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
  renderPass.setBindGroup(0, renderBindGroups[renderBufferIndex]);
  renderPass.setPipeline(arenaPipeline);
  renderPass.setVertexBuffer(0, cubeShape.vertexBuffer);
  renderPass.setIndexBuffer(cubeShape.wireIndexBuffer, cubeShape.wireIndexFormat);
  renderPass.drawIndexed(cubeShape.wireIndexCount, 5);
  renderPass.setPipeline(ballPipeline);
  renderPass.setVertexBuffer(0, sphereShape.vertexBuffer);
  renderPass.setIndexBuffer(sphereShape.indexBuffer, sphereShape.indexFormat);
  renderPass.drawIndexed(sphereShape.indexCount, ballCount);
  renderPass.end();
  app.endGpuTiming(encoder);
  queue.submit([encoder.finish()]);
  app.afterGpuSubmit();
  // 次frameは今回描画した最新bufferからsimulationを開始します
  statePair.setCurrentIndex(renderBufferIndex);
  updateHelpPanel();
}

document.addEventListener("DOMContentLoaded", () => {
  start().catch((err) => {
    app?.setDiagnosticsReport?.(Diagnostics.createErrorReport(err, {
      system: "compute_physics_bounce",
      source: "samples/compute_physics_bounce/main.js"
    }));
    app?.showOverlayPanel?.(buildErrorPanelOptions(err, {
      title: "compute_physics_bounce failed",
      id: "start-error"
    }));
    console.error("compute_physics_bounce failed:", err);
  });
});

// このインスタンスの初期化段階で、必要な状態と資源を準備して処理を開始する
async function start() {
  // 初期化前にURLから球数を決め、必要なstorage buffer容量を確定します
  ballCount = readBallCount();
  app = new WebgApp({
    document,
    computeFrame: true,
    autoDrawScene: false,
    clearColor: CLEAR_COLOR,
    viewAngle: 48,
    projectionNear: 0.001,
    projectionFar: 4,
    messageFontTexture: "../../webg/font512.png",
    camera: {
      target: [0, 12 * WORLD_SCALE, ARENA_CENTER_Z],
      distance: 88 * WORLD_SCALE,
      yaw: 0,
      pitch: -27
    },
    debugTools: {
      mode: "release",
      system: "compute_physics_bounce",
      source: "samples/compute_physics_bounce/main.js",
      probeDefaultAfterFrames: 1
    }
  });
  await app.init();
  // このsampleはWebgAppの高レベル描画APIではなく、device/queueへ直接commandを発行します
  screen = app.screen;
  device = app.getGPU().device;
  queue = app.getGPU().queue;
  const resize = () => app.applyViewportLayout();
  resize();
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", resize);
  // camera操作だけはcoreのOrbitEyeRigを利用し、物理・描画resourceはsample内で完結させます
  orbit = app.createOrbitEyeRig({
    target: [0, 12 * WORLD_SCALE, ARENA_CENTER_Z],
    distance: 88 * WORLD_SCALE,
    yaw: 0,
    pitch: -27,
    minDistance: 48 * WORLD_SCALE,
    maxDistance: 170 * WORLD_SCALE,
    wheelZoomStep: 5 * WORLD_SCALE
  });
  sphereShape = createShape((options) => Primitive.sphere(1, 20, 16, options));
  cubeShape = createShape((options) => Primitive.cuboid(2, 2, 2, options));
  // cube4のShape.setWireframe(true)と同じwire indexを、sample独自pipelineから直接描画します
  cubeShape.setWireframe(true);
  createPipelines();
  updateHelpPanel(true);

  // 操作キーはsimulation flagだけを変更し、次frameのuniformやdispatchへ反映します
  app.attachInput({
    onKeyDown: async (key, event) => {
      if (event.repeat) return;
      applyControlAction(key);
    }
  });
  installTouchControls();
  app.setDiagnosticsStage("runtime");
  app.configureDebugKeyInput();
  // orbit cameraはWebgAppが更新し、onUpdateではdiagnosticsだけを更新する
  // Compute/Render Pass本体はonComputeFrameから呼びます
  app.start({
    onFrameTiming: (deltaMs) => {
      updateFrameTiming(deltaMs);
    },
    onUpdate: () => {
      app.mergeDiagnosticsStats({
        balls: ballCount,
        paused: paused ? "yes" : "no",
        sphereCollisions: collisionsEnabled ? "yes" : "no",
        containerTilt: tiltEnabled ? "yes" : "no",
        solver: "brute-force",
        substeps: SUBSTEPS
      });
      app.updateDebugProbe();
    },
    onComputeFrame: ({ deltaSec }) => {
      renderFrame(deltaSec);
    }
  });
}
