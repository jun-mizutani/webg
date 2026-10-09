// ---------------------------------------------
// samples/falling_dominoes/main.js  2026/09/23
//   ComputePhysicsSpace falling dominoes sample
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import WebgApp from "../../webg/WebgApp.js";
import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";
import Matrix from "../../webg/Matrix.js";
import ComputePhysicsSpace from "../../webg/ComputePhysicsSpace.js";
import ComputeBoxCollider from "../../webg/ComputeBoxCollider.js";
import ComputePhysicsCpuEmulator from "./ComputePhysicsCpuEmulator.js";
import FallingDominoSleepDiagnostic from "./FallingDominoSleepDiagnostic.js";
import { CAMERA_REVERSE_Z } from "../../webg/DepthConvention.js";
import { buildErrorPanelOptions, buildHelpPanelOptions } from "../../webg/OverlayPanelPresets.js";

// このサンプルの目的:
// - ComputePhysicsSpaceとComputeBoxColliderだけで、連続するドミノの接触を構成する
// - GPU上のping-pong BodyStateをvertex shaderから直接読み、bodyごとのNode同期を行わない
// - 左端のドミノだけへ初期角速度を与え、後続bodyは接触で倒れて最後にsleepする処理を目視で確認する
// - 共有pairの一回力積は長い連鎖の床接触で残留角速度を作るため、このサンプルは局所反復solverを使う

// 初版と同じ32体へ戻し、先頭1体から後続31体までの連鎖を確認します
const DOMINO_COUNT = 32;
// 短い接触をpeak値から取りこぼさないよう、診断readbackは毎frame試行します
const WAKE_DIAGNOSTIC_FRAME_INTERVAL = 1;
// 物理単位をm・kg・sへ揃え、一般的な木製ドミノに近い寸法を使います
const DOMINO_LONG_SIDE = 0.025;
const DOMINO_HEIGHT = 0.050;
const DOMINO_THICKNESS = 0.006;
const DOMINO_SPACING = 0.0225;
const DOMINO_START_X = -((DOMINO_COUNT - 1) * DOMINO_SPACING) * 0.5;
const DOMINO_DENSITY = 700;
const DOMINO_VOLUME = DOMINO_LONG_SIDE * DOMINO_HEIGHT * DOMINO_THICKNESS;
// domino32のNelder–Mead探索で得た候補を、実アプリの既定値として固定します
// 寸法・密度・重力は変えず、質量だけを基準値から分離した倍率で指定します
const DOMINO_MASS_MULTIPLIER = 6.18333333333333;
const DOMINO_MASS = DOMINO_DENSITY * DOMINO_VOLUME * DOMINO_MASS_MULTIPLIER;
const DOMINO_GRAVITY = 9.80665;
const DOMINO_INITIAL_ANGULAR_SPEED = 7.68333333333333;
const DOMINO_RESTITUTION = 0.11000000000000004;
const DOMINO_FRICTION = 0.3008333333333333;
const DOMINO_LINEAR_DAMPING = 0.09166666666666667;
const DOMINO_ANGULAR_DAMPING = 0.13333333333333328;
const DOMINO_SLEEP_ANGULAR_SPEED = 0.4691666666666668;
const DOMINO_WAKE_ANGULAR_SPEED = 0.7175000000000001;
const DOMINO_GAP = DOMINO_SPACING - DOMINO_THICKNESS;
const FLOOR_Y = 0;
const ARENA_MARGIN_X = 0.15;
const BOUNDS = Object.freeze({
  minX: DOMINO_START_X - ARENA_MARGIN_X,
  maxX: -DOMINO_START_X + ARENA_MARGIN_X,
  minZ: -0.16,
  maxZ: 0.16,
  floorY: FLOOR_Y
});
const CLEAR_COLOR = Object.freeze([0.018, 0.031, 0.048, 1]);
const RENDER_PARAM_FLOATS = 36;
const STARTER_BODY_ID = 1;
// 初期カメラは保存した視点値を使い、eyeが(-0.35, 0.06, 0.02)付近になるようにします
// eye位置はtarget、distance、yaw、pitch、rollからEyeRigが計算するため、eye座標をEyeRigへ集約します
const CAMERA_TARGET = Object.freeze([-0.16, -0.13, -0.06]);
const CAMERA_DISTANCE = 0.28;
const CAMERA_YAW = -67.19;
const CAMERA_PITCH = -43.59;
const CAMERA_ROLL = -29.93;
const CAMERA_VIEW_ANGLE = 70.00;
const CAMERA_MIN_DISTANCE = 0.20;

// ComputePhysicsSpaceとCPUエミュレータが同じ寸法比率から絶対しきい値を作るための設定です
// body寸法を変更するときも、位置補正・候補padding・sleep速度の関連設定を一つのconfigから更新します
const COMPUTE_PHYSICS_SCALE = Object.freeze({
  referenceLength: DOMINO_HEIGHT,
  broadphasePaddingRatio: 0.0125,
  positionSlopRatio: 0.00625,
  supportFeatureToleranceRatio: 0.125,
  restingRestitutionSpeedRatio: 6.25,
  // 候補の絶対値は、referenceLength=0.050mから次の比率で復元します
  sleepLinearSpeedRatio: 0.26633333333333336,
  wakeLinearSpeedRatio: 0.533,
  sleepContactSpeedRatio: 0.1415,
  sleepNormalSpeedRatio: 0.2335
});

// 先頭bodyの上端が後続bodyの左面へ届く回転角を、寸法と隙間から解きます
// pivotは底面の長辺、contactは先頭bodyの上側角とし、ドミノ列方向xだけを評価します
function solveDominoContactAngle(width, height, gap) {
  let angle = gap / height;
  for (let iteration = 0; iteration < 12; iteration++) {
    const value = width * Math.cos(angle) + height * Math.sin(angle) - width - gap;
    const derivative = -width * Math.sin(angle) + height * Math.cos(angle);
    angle -= value / derivative;
  }
  if (!Number.isFinite(angle) || angle <= 0 || angle >= Math.PI * 0.5) {
    throw new Error("falling_dominoes theoretical contact angle is invalid");
  }
  return angle;
}

// 寸法、質量、重力から最初の隣接bodyへ届くまでの理論目標をまとめます
// 床の底面pivot拘束で初期角速度を一度失う近似を採用し、回転慣性を含む接触有効質量を別計算します
function buildDominoTheory() {
  const angle = solveDominoContactAngle(DOMINO_THICKNESS, DOMINO_HEIGHT, DOMINO_GAP);
  const inertiaCenter = DOMINO_MASS * (
    DOMINO_THICKNESS ** 2 + DOMINO_HEIGHT ** 2
  ) / 12;
  const inertiaPivot = DOMINO_MASS * (
    DOMINO_THICKNESS ** 2 + DOMINO_HEIGHT ** 2
  ) / 3;
  const pivotAngularSpeed = (inertiaCenter / inertiaPivot) * DOMINO_INITIAL_ANGULAR_SPEED;
  const centerDrop = 0.5 * (
    DOMINO_HEIGHT * (1 - Math.cos(angle))
      + DOMINO_THICKNESS * Math.sin(angle)
  );
  const gravityEnergy = DOMINO_MASS * DOMINO_GRAVITY * centerDrop;
  const pivotStartEnergy = 0.5 * inertiaPivot * pivotAngularSpeed ** 2;
  const contactEnergy = pivotStartEnergy + gravityEnergy;
  const contactAngularSpeed = Math.sqrt(2 * contactEnergy / inertiaPivot);
  const contactY = DOMINO_HEIGHT * Math.cos(angle) - DOMINO_THICKNESS * Math.sin(angle);
  const contactNormalSpeed = contactAngularSpeed * contactY;
  const bodyAY = 0.5 * DOMINO_HEIGHT * Math.cos(angle)
    - 0.5 * DOMINO_THICKNESS * Math.sin(angle);
  const bodyBY = contactY - 0.5 * DOMINO_HEIGHT;
  const effectiveMass = 1 / (
    2 / DOMINO_MASS + (bodyAY ** 2 + bodyBY ** 2) / inertiaCenter
  );
  return Object.freeze({
    angle,
    angleDegrees: angle * 180 / Math.PI,
    centerDrop,
    gravityEnergy,
    pivotStartEnergy,
    contactEnergy,
    contactAngularSpeed,
    contactNormalSpeed,
    effectiveMass,
    collisionEnergy: 0.5 * effectiveMass * contactNormalSpeed ** 2,
    collisionImpulse: (1 + DOMINO_RESTITUTION) * effectiveMass * contactNormalSpeed
  });
}

const FALLING_DOMINO_THEORY = buildDominoTheory();

let app = null;
let screen = null;
let physics = null;
let renderer = null;
let bodyStats = null;
let wakeDiagnostics = null;
let cpuEmulator = null;
let paused = false;
let lastHelpText = "";
let timingFrameCount = 0;
let timingElapsedMs = 0;
let displayedFps = 0;
let displayedFrameMs = 0;
let statisticsFrameNumber = 0;

// BodyStateの8個のvec4をcoreの公開layoutと同じ順序で宣言します
// 位置、姿勢、寸法、色をGPU上で読み、CPU側のbody配列をGPU描画へ直接接続します
const RENDER_SHADER = `
struct BodyState {
  position : vec4f,
  orientation : vec4f,
  linearVelocityInvMass : vec4f,
  angularVelocitySleep : vec4f,
  halfExtentsSleepCounter : vec4f,
  inverseInertiaLocal : vec4f,
  material : vec4f,
  color : vec4f,
};
struct RenderParams { projection : mat4x4f, view : mat4x4f, light : vec4f };
@group(0) @binding(0) var<storage, read> states : array<BodyState>;
@group(0) @binding(1) var<uniform> params : RenderParams;
struct VertexInput { @location(0) position : vec3f, @location(1) normal : vec3f };
struct VertexOutput {
  @builtin(position) position : vec4f,
  @location(0) viewPosition : vec3f,
  @location(1) viewNormal : vec3f,
  @location(2) color : vec3f,
};

// webgのquaternionは[w,x,y,z]順なので、x成分をscalarとして積を計算します
fn quatMultiply(a : vec4f, b : vec4f) -> vec4f {
  return vec4f(
    a.x*b.x-a.y*b.y-a.z*b.z-a.w*b.w,
    a.x*b.y+a.y*b.x+a.z*b.w-a.w*b.z,
    a.x*b.z-a.y*b.w+a.z*b.x+a.w*b.y,
    a.x*b.w+a.y*b.z-a.z*b.y+a.w*b.x
  );
}

// local vertexをbody姿勢で回転し、物理solverと同じworld orientationを描画へ反映します
fn quatRotate(q : vec4f, value : vec3f) -> vec3f {
  let conjugate = vec4f(q.x, -q.y, -q.z, -q.w);
  return quatMultiply(quatMultiply(q, vec4f(0.0, value)), conjugate).yzw;
}

// 全slotをinstance描画し、Box以外のslotをclip外へ送る共通処理です
// 現在はBoxだけを登録するため、形状判定は未対応bodyの混入を検出する役割も持ちます
fn buildVertex(input : VertexInput, instanceIndex : u32) -> VertexOutput {
  let state = states[instanceIndex];
  var output : VertexOutput;
  if (abs(state.inverseInertiaLocal.w) > 0.25) {
    output.position = vec4f(2.0, 2.0, 2.0, 1.0);
    output.viewPosition = vec3f(0.0);
    output.viewNormal = vec3f(0.0, 1.0, 0.0);
    output.color = vec3f(0.0);
    return output;
  }
  let worldNormal = normalize(quatRotate(state.orientation, input.normal));
  let worldPosition = state.position.xyz
    + quatRotate(state.orientation, input.position * state.halfExtentsSleepCounter.xyz);
  let viewPosition = params.view * vec4f(worldPosition, 1.0);
  output.position = params.projection * viewPosition;
  output.viewPosition = viewPosition.xyz;
  output.viewNormal = normalize((params.view * vec4f(worldNormal, 0.0)).xyz);
  // sleep bodyは元の色の75%へ暗くし、停止状態を画面上でも識別できるようにします
  let sleepColorScale = select(1.0, 0.75, state.angularVelocitySleep.w > 0.5);
  output.color = state.color.rgb * sleepColorScale;
  return output;
}

@vertex fn boxVertex(input : VertexInput, @builtin(instance_index) index : u32) -> VertexOutput {
  return buildVertex(input, index);
}

// diffuseと小さなspecularを組み合わせ、姿勢と面の向きを読み取りやすくします
@fragment fn fragmentMain(input : VertexOutput) -> @location(0) vec4f {
  let normal = normalize(input.viewNormal);
  let lightDirection = normalize(params.light.xyz);
  let viewDirection = normalize(-input.viewPosition);
  let diffuse = max(dot(normal, lightDirection), 0.0);
  let halfVector = normalize(lightDirection + viewDirection);
  let specular = pow(max(dot(normal, halfVector), 0.0), 48.0) * params.light.w;
  return vec4f(input.color * (0.20 + diffuse * 0.80) + vec3f(specular), 1.0);
}`;

// 物理boundsの床と四壁をline-listで表示し、Planeと描画空間の一致を確認します
const BOUNDS_SHADER = `
struct RenderParams { projection : mat4x4f, view : mat4x4f, light : vec4f };
@group(0) @binding(0) var<uniform> params : RenderParams;
@vertex fn vertexMain(@location(0) position : vec3f) -> @builtin(position) vec4f {
  return params.projection * params.view * vec4f(position, 1.0);
}
@fragment fn fragmentMain() -> @location(0) vec4f {
  return vec4f(0.28, 0.72, 0.92, 1.0);
}`;

// 一列のBox bodyを作り、左端のbodyだけへ直立状態から初期角速度を与えます
// 後続bodyはidentity姿勢と静止速度から始め、接触後の位置・姿勢更新はcoreへ任せます
function createBodies() {
  const palette = [
    [0.94, 0.30, 0.24, 1], [0.98, 0.60, 0.18, 1], [0.30, 0.72, 0.94, 1],
    [0.38, 0.84, 0.50, 1], [0.72, 0.42, 0.94, 1], [0.96, 0.40, 0.64, 1]
  ];
  return Array.from({ length: DOMINO_COUNT }, (_, index) => {
    const starter = index === 0;
    return {
      id: index + 1,
      position: [
        DOMINO_START_X + index * DOMINO_SPACING,
        DOMINO_HEIGHT * 0.5 + (starter ? 0.001 : 0),
        0
      ],
      orientation: [1, 0, 0, 0],
      linearVelocity: [0, 0, 0],
      angularVelocity: starter ? [0, 0, -DOMINO_INITIAL_ANGULAR_SPEED] : [0, 0, 0],
      // 列方向xの底面幅を厚さにし、z方向の長辺を倒れる軸として配置します
      collider: new ComputeBoxCollider([DOMINO_THICKNESS, DOMINO_HEIGHT, DOMINO_LONG_SIDE]),
      mass: DOMINO_MASS,
      material: {
        restitution: DOMINO_RESTITUTION,
        friction: DOMINO_FRICTION,
        linearDamping: DOMINO_LINEAR_DAMPING,
        angularDamping: DOMINO_ANGULAR_DAMPING
      },
      color: palette[index % palette.length]
    };
  });
}

// 単位cube meshを作り、各instanceのhalf extentsをBodyStateから適用できるShapeへ変換します
function createUnitBoxShape(asset) {
  const shape = new Shape(app.getGPU());
  shape.applyPrimitiveAsset(asset(shape.getPrimitiveOptions()));
  shape.endShape();
  return shape;
}

// 物理boundsの床から表示上限までを12本の辺へ展開し、line-list用頂点配列を作ります
function buildBoundsVertices(maxY = 0.12) {
  const min = [BOUNDS.minX, BOUNDS.floorY, BOUNDS.minZ];
  const max = [BOUNDS.maxX, maxY, BOUNDS.maxZ];
  const corners = [
    [min[0], min[1], min[2]], [max[0], min[1], min[2]], [max[0], min[1], max[2]], [min[0], min[1], max[2]],
    [min[0], max[1], min[2]], [max[0], max[1], min[2]], [max[0], max[1], max[2]], [min[0], max[1], max[2]]
  ];
  const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
  return new Float32Array(edges.flatMap(([a, b]) => [...corners[a], ...corners[b]]));
}

// ComputePhysicsSpaceの最新state bufferを直接読むBox描画を管理します
// ComputeとRenderは同じcommand encoderへ記録し、GPU状態をGPU内で描画へ渡します
class FallingDominoRenderer {
  // mesh、state buffer、canvas formatを受け取り、frame間で再利用するGPU resourceを生成します
  constructor(gpu, options) {
    this.device = gpu.device;
    this.queue = gpu.queue;
    this.boxShape = options.boxShape;
    this.createResources(options.stateBuffers, options.format);
  }

  // uniform、Box pipeline、bounds pipeline、ping-pong state用bind groupを一度だけ生成します
  // BodyStateのstrideとattribute位置はComputePhysicsSpaceの公開layoutへ合わせます
  createResources(stateBuffers, format) {
    this.paramBuffer = this.device.createBuffer({
      label: "falling-dominoes:params",
      size: RENDER_PARAM_FLOATS * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    const layout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
        { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } }
      ]
    });
    const module = this.device.createShaderModule({ label: "falling-dominoes:shapes", code: RENDER_SHADER });
    this.boxPipeline = this.device.createRenderPipeline({
      label: "falling-dominoes:box",
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      vertex: {
        module, entryPoint: "boxVertex",
        buffers: [{
          arrayStride: 32,
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x3" },
            { shaderLocation: 1, offset: 12, format: "float32x3" }
          ]
        }]
      },
      fragment: { module, entryPoint: "fragmentMain", targets: [{ format }] },
      primitive: { topology: "triangle-list", cullMode: "back", frontFace: "ccw" },
      depthStencil: { format: CAMERA_REVERSE_Z.format, depthWriteEnabled: true, depthCompare: CAMERA_REVERSE_Z.compare }
    });
    this.bindGroups = stateBuffers.map((buffer) => this.device.createBindGroup({
      layout,
      entries: [{ binding: 0, resource: { buffer } }, { binding: 1, resource: { buffer: this.paramBuffer } }]
    }));

    // boundsを同じcamera uniformで描画し、Planeの範囲を薄い線で示します
    const boundsData = buildBoundsVertices();
    this.boundsVertexCount = boundsData.length / 3;
    this.boundsBuffer = this.device.createBuffer({
      label: "falling-dominoes:bounds",
      size: boundsData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    });
    this.queue.writeBuffer(this.boundsBuffer, 0, boundsData);
    const boundsLayout = this.device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } }]
    });
    const boundsModule = this.device.createShaderModule({ code: BOUNDS_SHADER });
    this.boundsPipeline = this.device.createRenderPipeline({
      label: "falling-dominoes:bounds-pipeline",
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [boundsLayout] }),
      vertex: { module: boundsModule, entryPoint: "vertexMain", buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }] }] },
      fragment: { module: boundsModule, entryPoint: "fragmentMain", targets: [{ format }] },
      primitive: { topology: "line-list" },
      depthStencil: { format: CAMERA_REVERSE_Z.format, depthWriteEnabled: true, depthCompare: CAMERA_REVERSE_Z.compareEqual }
    });
    this.boundsBindGroup = this.device.createBindGroup({
      layout: boundsLayout,
      entries: [{ binding: 0, resource: { buffer: this.paramBuffer } }]
    });
  }

  // projectionとviewをuniformへ転送し、bodyごとの変換はGPUのBodyStateへ任せます
  writeCamera(projection, view) {
    const data = new Float32Array(RENDER_PARAM_FLOATS);
    data.set(projection.mat, 0);
    data.set(view.mat, 16);
    data.set([0.42, 0.78, 0.56, 0.52], 32);
    this.queue.writeBuffer(this.paramBuffer, 0, data);
  }

  // boundsと全domino instanceを一つのRender Passへ記録します
  // timestampWritesを受け取った場合だけRender Pass全体のGPU開始・終了時刻を記録します
  encode(encoder, state, colorView, depthView, options = {}) {
    const descriptor = {
      label: "falling-dominoes:render",
      colorAttachments: [{
        view: colorView,
        loadOp: "clear",
        storeOp: "store",
        clearValue: { r: CLEAR_COLOR[0], g: CLEAR_COLOR[1], b: CLEAR_COLOR[2], a: CLEAR_COLOR[3] }
      }],
      depthStencilAttachment: {
        view: depthView,
        depthLoadOp: "clear",
        depthStoreOp: "store",
        depthClearValue: CAMERA_REVERSE_Z.clearValue
      }
    };
    if (options.timestampWrites !== undefined) descriptor.timestampWrites = options.timestampWrites;
    const pass = encoder.beginRenderPass(descriptor);
    pass.setPipeline(this.boundsPipeline);
    pass.setBindGroup(0, this.boundsBindGroup);
    pass.setVertexBuffer(0, this.boundsBuffer);
    pass.draw(this.boundsVertexCount);
    pass.setPipeline(this.boxPipeline);
    pass.setBindGroup(0, this.bindGroups[state.bufferIndex]);
    pass.setVertexBuffer(0, this.boxShape.vertexBuffer);
    pass.setIndexBuffer(this.boxShape.indexBuffer, this.boxShape.indexFormat);
    pass.drawIndexed(this.boxShape.indexCount, state.bodyCount);
    pass.end();
  }

  // rendererが生成したbufferだけを破棄し、coreのstate bufferとShapeは呼出側へ残します
  destroy() {
    this.paramBuffer.destroy();
    this.boundsBuffer.destroy();
  }
}

// 最新BodyStateからactiveとsleepingの2 counterだけを集計し、panelへ非同期で渡します
// body位置や姿勢をreadbackせず、描画のためのGPU状態直接参照を維持します
class FallingDominoStats {
  // 2本のstate buffer、counter、readback buffer、集計pipelineを初期化します
  constructor(gpu, stateBuffers, bodyCount) {
    this.device = gpu.device;
    this.bodyCount = bodyCount;
    this.values = Object.freeze({ active: bodyCount, sleeping: 0 });
    this.readbackPending = false;
    this.readbackMapStarted = false;
    this.readbackError = null;
    this.createResources(stateBuffers);
  }

  // counterをclearしてからbodyごとのsleep flagを数えるCompute pipelineを作ります
  createResources(stateBuffers) {
    this.counterBuffer = this.device.createBuffer({
      label: "falling-dominoes:stats-counters",
      size: 8,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
    });
    this.readbackBuffer = this.device.createBuffer({
      label: "falling-dominoes:stats-readback",
      size: 8,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
    const layout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }
      ]
    });
    const module = this.device.createShaderModule({
      label: "falling-dominoes:stats-shader",
      code: `
struct BodyState {
  position : vec4f,
  orientation : vec4f,
  linearVelocityInvMass : vec4f,
  angularVelocitySleep : vec4f,
  halfExtentsSleepCounter : vec4f,
  inverseInertiaLocal : vec4f,
  material : vec4f,
  color : vec4f,
};
@group(0) @binding(0) var<storage, read> bodies : array<BodyState>;
@group(0) @binding(1) var<storage, read_write> counters : array<atomic<u32>, 2>;

// 最初のinvocationだけが2 counterを初期化し、同じframeのcount passへ渡します
@compute @workgroup_size(2)
fn clearMain(@builtin(global_invocation_id) id : vec3u) {
  if (id.x < 2u) { atomicStore(&counters[id.x], 0u); }
}

// dynamic bodyをactiveまたはsleepingへ分類し、使用中slotだけを数えます
@compute @workgroup_size(64)
fn countMain(@builtin(global_invocation_id) id : vec3u) {
  if (id.x >= ${this.bodyCount}u) { return; }
  let body = bodies[id.x];
  let sleeping = body.angularVelocitySleep.w > 0.5;
  if (body.linearVelocityInvMass.w > 0.0) {
    atomicAdd(&counters[select(0u, 1u, sleeping)], 1u);
  }
}`
    });
    const pipelineLayout = this.device.createPipelineLayout({ bindGroupLayouts: [layout] });
    this.clearPipeline = this.device.createComputePipeline({
      label: "falling-dominoes:stats-clear",
      layout: pipelineLayout,
      compute: { module, entryPoint: "clearMain" }
    });
    this.countPipeline = this.device.createComputePipeline({
      label: "falling-dominoes:stats-count",
      layout: pipelineLayout,
      compute: { module, entryPoint: "countMain" }
    });
    this.bindGroups = stateBuffers.map((buffer) => this.device.createBindGroup({
      layout,
      entries: [{ binding: 0, resource: { buffer } }, { binding: 1, resource: { buffer: this.counterBuffer } }]
    }));
  }

  // 前回のmapが終わった場合だけclear、count、8 byte copyを新しいframeへ記録します
  encode(encoder, state) {
    if (this.readbackPending) return false;
    const bindGroup = this.bindGroups[state.bufferIndex];
    const clearPass = encoder.beginComputePass({ label: "falling-dominoes:stats-clear" });
    clearPass.setPipeline(this.clearPipeline);
    clearPass.setBindGroup(0, bindGroup);
    clearPass.dispatchWorkgroups(1);
    clearPass.end();
    const countPass = encoder.beginComputePass({ label: "falling-dominoes:stats-count" });
    countPass.setPipeline(this.countPipeline);
    countPass.setBindGroup(0, bindGroup);
    countPass.dispatchWorkgroups(Math.ceil(this.bodyCount / 64));
    countPass.end();
    encoder.copyBufferToBuffer(this.counterBuffer, 0, this.readbackBuffer, 0, 8);
    this.readbackPending = true;
    return true;
  }

  // submit後にmapを開始し、完了した2 counterだけをpanel表示値へ反映します
  // map失敗を0へ置き換えず、明示的なerrorとして表示できるよう保持します
  resolveAfterSubmit() {
    if (!this.readbackPending || this.readbackMapStarted) return;
    this.readbackMapStarted = true;
    this.readbackBuffer.mapAsync(GPUMapMode.READ).then(() => {
      const data = new Uint32Array(this.readbackBuffer.getMappedRange());
      this.values = Object.freeze({ active: data[0], sleeping: data[1] });
      this.readbackBuffer.unmap();
      this.readbackPending = false;
      this.readbackMapStarted = false;
    }).catch((error) => {
      this.readbackError = error;
      this.readbackPending = false;
      this.readbackMapStarted = false;
      console.error("falling_dominoes statistics readback failed:", error);
    });
  }

  // 最新の完了済み値を返し、進行中readbackの途中状態を分けて管理します
  getValues() {
    return { ...this.values, error: this.readbackError };
  }

  // 集計とreadback用のbufferを破棄します
  destroy() {
    this.counterBuffer.destroy();
    this.readbackBuffer.destroy();
  }
}


// 20 frameの平均からFPSとframe時間を計算し、安定した計測値をpanelへ表示します
function updateFrameTiming(deltaSec) {
  timingFrameCount += 1;
  timingElapsedMs += deltaSec * 1000;
  if (timingFrameCount < 20) return;
  displayedFrameMs = timingElapsedMs / timingFrameCount;
  displayedFps = displayedFrameMs > 0 ? 1000 / displayedFrameMs : 0;
  timingFrameCount = 0;
  timingElapsedMs = 0;
}

// wake診断の一行を作り、現在接触しているか、接触時の最大接近速度が閾値へ届いたかを示します
// Eは回転慣性を含まない法線方向の換算質量エネルギーで、wake速度の比較用として表示します
function formatWakePair(pair) {
  const target = `B${pair.bodyBId}:${pair.sleepingTarget ? "S" : "A"}`;
  const peak = pair.peakApproachSpeed.toFixed(4);
  if (!pair.contact) {
    const gap = pair.gapX === null ? "-" : `${(pair.gapX * 1000).toFixed(2)}mm`;
    const solverPeak = pair.solverPeakApproachSpeed > 0
      ? ` solverPeakVn=${pair.solverPeakApproachSpeed.toFixed(4)}m/s solverPeakJ=${pair.solverPeakNormalImpulse.toExponential(2)}Ns`
      : "";
    const wakePeak = pair.wakePeakContactValid
      ? ` wakePeakVn=${pair.wakePeakNormalVelocity.toFixed(4)}m/s`
      : "";
    return `${pair.bodyAId}->${pair.bodyBId} ${target} no-contact gapX=${gap}`
      + ` closePeak=${pair.peakClosingSpeed.toFixed(4)}m/s peak=${peak}m/s`
      + ` peakE=${(pair.peakEnergy * 1000).toExponential(2)}mJ`
      + solverPeak
      + wakePeak;
  }
  if (!pair.pointAvailable) {
    return `${pair.bodyAId}->${pair.bodyBId} ${target} contact point=n/a`;
  }
    const impact = pair.impactApproachSpeed === null
      ? ""
      : ` preFrameVn=${pair.impactNormalVelocity.toFixed(4)} preFrameE=${(pair.impactEnergy * 1000).toExponential(2)}mJ`;
  const solver = pair.solverApproachSpeed === null
    ? ` solverPeakVn=${pair.solverPeakApproachSpeed.toFixed(4)}m/s solverPeakJ=${pair.solverPeakNormalImpulse.toExponential(2)}Ns`
    : ` solverInVn=${pair.solverNormalVelocity.toFixed(4)}m/s solverJ=${pair.solverNormalImpulse.toExponential(2)}Ns`;
  const solverNormal = pair.solverContactNormal ?? pair.solverPeakContactNormal;
  const solverPoint = pair.solverContactPoint ?? pair.solverPeakContactPoint;
  const solverB = pair.solverBApproachSpeed === null
    ? ` solverBPeakVn=${pair.solverBPeakApproachSpeed.toFixed(4)}m/s solverBInVn=${pair.solverBPeakNormalVelocity === null ? "-" : pair.solverBPeakNormalVelocity.toFixed(4)}m/s solverBJ=${pair.solverBPeakNormalImpulse.toExponential(2)}Ns`
    : ` solverBVn=${pair.solverBNormalVelocity.toFixed(4)}m/s solverBJ=${pair.solverBNormalImpulse.toExponential(2)}Ns`
      + ` solverBn=(${pair.solverBContactNormal[0].toFixed(2)},${pair.solverBContactNormal[1].toFixed(2)},${pair.solverBContactNormal[2].toFixed(2)})`
      + ` solverBp=(${pair.solverBContactPoint[0].toFixed(3)},${pair.solverBContactPoint[1].toFixed(3)})`;
  const solverGeometry = solverNormal === null || solverPoint === null
    ? ""
    : ` n=(${solverNormal[0].toFixed(2)},${solverNormal[1].toFixed(2)},${solverNormal[2].toFixed(2)})`
      + ` p=(${solverPoint[0].toFixed(3)},${solverPoint[1].toFixed(3)})`;
  const wakeScan = pair.wakeCandidate === null
    ? ""
    : ` wakeScan=${pair.wakeCandidate ? "hit" : "miss"}`
      + ` wakeVn=${pair.wakeNormalVelocity.toFixed(4)}m/s`
      + ` wakeContact=${pair.wakeContactValid ? "yes" : "no"}`
      + ` wakeSlot=${pair.wakeCandidateSlot}`
      + ` wakePeakVn=${pair.wakePeakNormalVelocity === null ? "-" : pair.wakePeakNormalVelocity.toFixed(4)}m/s`
      + ` wakePeakContact=${pair.wakePeakContactValid ? "yes" : "no"}`;
  return `${pair.bodyAId}->${pair.bodyBId} ${target}`
    + ` vN=${pair.normalVelocity.toFixed(4)} deficit=${pair.deficit.toFixed(4)}m/s`
    + impact
    + solver
    + solverB
    + solverGeometry
    + wakeScan
    + ` closePeak=${pair.peakClosingSpeed.toFixed(4)}m/s`
    + ` E=${(pair.energy * 1000).toExponential(2)}/${(pair.wakeEnergy * 1000).toExponential(2)}mJ`
    + ` dE=${(pair.energyDeficit * 1000).toExponential(2)}mJ`
    + ` peak=${peak}m/s peakE=${(pair.peakEnergy * 1000).toExponential(2)}mJ`;
}

// B29/B30へ実際に適用した最大接近反復の法線・摩擦力積を同じ単位で表示します
// denominatorとunrestrictedを残し、力積の差を結果だけから推測しないようにします
function formatPairImpulseAudit(label, normal, friction, applied) {
  if (!Array.isArray(normal) || !Array.isArray(friction) || !Array.isArray(applied) || applied[1] < 0.5) {
    return [`${label}: no approaching impulse recorded`];
  }
  return [
    `${label}: vn=${normal[0].toFixed(4)}m/s approach=${normal[1].toFixed(4)}m/s denominator=${normal[2].toExponential(3)} Jn=${normal[3].toExponential(3)}Ns restitution=${friction[0].toFixed(3)}`,
    `${label} friction: tangent=${friction[1].toFixed(4)}m/s unrestricted=${friction[2].toExponential(3)}Ns limit=${friction[3].toExponential(3)}Ns Jt=${applied[0].toExponential(3)}Ns`
  ];
}

// 最新readbackのB29/B30力積診断をpanelへ展開し、pair間の計算条件を並べて比較します
function buildPairImpulseAuditLines(audit) {
  if (!audit) return ["B31 pair impulse audit: waiting"];
  return [
    `adjacent pair impulse audit: fixed step ${audit.fixedStep ?? "?"}, largest approach per pair`,
    ...formatPairImpulseAudit("B29 -> B30", audit.body29To30?.normal, audit.body29To30?.friction, audit.body29To30?.applied),
    ...formatPairImpulseAudit("B30 -> B31", audit.body30To31?.normal, audit.body30To31?.friction, audit.body30To31?.applied),
    ...formatPairImpulseAudit("B31 -> B32", audit.body31To32?.normal, audit.body31To32?.friction, audit.body31To32?.applied)
  ];
}

// B31の一つのfixed step内で接触処理後に変化した速度を表示し、最後の接触後の再加速を判定します
function buildStageVelocityLines(stage) {
  if (!stage) return ["B31 stage velocity audit: waiting"];
  const format = (label, value) => {
    if (!Array.isArray(value)) return `${label}: unavailable`;
    return `${label}=L(${value[0].toFixed(4)},${value[1].toFixed(4)},${value[2].toFixed(4)})m/s A=${value[3].toFixed(4)}rad/s`;
  };
  const events = Array.isArray(stage.events) ? stage.events : [0, 0, 0, 0];
  return [
    `B31 stage velocity: fixed step=${stage.fixedStep ?? "?"} B30 iteration=${events[0] || "-"} B32 iteration=${events[1] || "-"} Plane iteration=${events[2] || "-"} plane=${events[3] || "-"}`,
    format("step start", stage.start),
    format("after B30 impulse", stage.afterB30),
    format("after B32 impulse", stage.afterB32),
    format("after Plane impulse", stage.afterPlane),
    format("step end", stage.end),
    `B31 peak post-contact stage: code=${stage.peakEvents?.[3] || "-"} (1=B30 2=B32 3=Plane)`,
    format("peak step start", stage.peakStart),
    format("peak after B30 impulse", stage.peakAfterB30),
    format("peak after B32 impulse", stage.peakAfterB32),
    format("peak after Plane impulse", stage.peakAfterPlane),
    format("peak step end", stage.peakEnd)
  ];
}

// wake診断の全pairをpanel行へ変換し、衝突前の間隔と衝突後のpeak値を同時に見せます
// CPUエミュレータのfixed step数、readback前後の最大差分、sleep差分をpanelへ表示します
// GPU状態をCPUへ上書きせず独立計算の差分を保持するため、solver再現の崩れを診断できます
function buildCpuEmulatorLines(report) {
  if (!report) return ["CPU emulator: waiting for state readback"];
  const formatCompare = (label, value) => [
    `CPU ${label}: position=${value.maxPositionError.toExponential(3)}m(B${value.positionBodyId ?? "-"})`,
    `CPU ${label}: linear=${value.maxLinearError.toExponential(3)}m/s(B${value.linearBodyId ?? "-"}) angular=${value.maxAngularError.toExponential(3)}rad/s(B${value.angularBodyId ?? "-"}) orientation=${value.maxOrientationError.toExponential(3)}(B${value.orientationBodyId ?? "-"}) sleepMismatch=${value.sleepingMismatchCount}`
  ];
  const stage = report.stage;
  const peakStage = report.peakStage;
  const firstDivergence = report.firstDivergence;
  const stageLines = stage === null
    ? []
    : [
      `CPU B31 stage: B30=${stage.events[0] || "-"} B32=${stage.events[1] || "-"} Plane=${stage.events[2] || "-"}/${stage.events[3] || "-"}`,
      `CPU B31 A: start=${stage.start[3].toFixed(4)} afterB30=${stage.afterB30[3].toFixed(4)} afterB32=${stage.afterB32[3].toFixed(4)} afterPlane=${stage.afterPlane[3].toFixed(4)} end=${stage.end[3].toFixed(4)}rad/s`
    ];
  const peakStageLines = peakStage === null
    ? []
    : [
      `CPU B31 peak A: start=${peakStage.start[3].toFixed(4)} afterB30=${peakStage.afterB30[3].toFixed(4)} afterB32=${peakStage.afterB32[3].toFixed(4)} afterPlane=${peakStage.afterPlane[3].toFixed(4)} end=${peakStage.end[3].toFixed(4)}rad/s`
    ];
  return [
    `CPU emulator: fixed=${report.cpuFixedStep} catchup=${report.catchUpSteps} advanced=${report.advancedSteps}`,
    firstDivergence === null
      ? "CPU divergence: none beyond diagnostic limits"
      : `CPU divergence: first ${firstDivergence.phase} fixed=${firstDivergence.fixedStep} position=${firstDivergence.maxPositionError.toExponential(3)}m(B${firstDivergence.positionBodyId ?? "-"}) linear=${firstDivergence.maxLinearError.toExponential(3)}m/s angular=${firstDivergence.maxAngularError.toExponential(3)}rad/s orientation=${firstDivergence.maxOrientationError.toExponential(3)}(B${firstDivergence.orientationBodyId ?? "-"})`,
    ...formatCompare("before", report.before),
    ...formatCompare("after", report.after),
    ...stageLines,
    ...peakStageLines
  ];
}

function buildWakeDiagnosticLines() {
  const diagnostics = wakeDiagnostics?.getValues();
  if (!diagnostics) {
    return wakeDiagnostics === null
      ? ["wake diagnostic: disabled for fast startup (add ?diagnostics=1)"]
      : ["wake diagnostic: waiting for state readback"];
  }
  if (diagnostics.error) return [`wake diagnostic: ERROR ${diagnostics.error.message}`];
  const threshold = diagnostics.wakeLinearThreshold.toFixed(4);
  const wakeEnergy = (diagnostics.wakeEnergy * 1000).toExponential(2);
  const currentPlaneAngularPeak = diagnostics.planeAngularDeltaByBody.reduce((best, value) => (
    value.total > best.total ? value : best
  ), { bodyId: null, normal: 0, friction: 0, total: 0 });
  const currentPlaneLine = currentPlaneAngularPeak.bodyId === null
    ? "plane angular delta: none"
    : `plane angular delta: current B${currentPlaneAngularPeak.bodyId}`
      + ` total=${currentPlaneAngularPeak.total.toExponential(2)}rad/s`
      + ` normal=${currentPlaneAngularPeak.normal.toExponential(2)}`
      + ` friction=${currentPlaneAngularPeak.friction.toExponential(2)}`;
  const peakPlane = diagnostics.peakPlaneAngularDelta;
  const peakPlaneLine = peakPlane.bodyId === null
    ? "plane angular peak: none"
    : `plane angular peak: B${peakPlane.bodyId}`
      + ` total=${peakPlane.total.toExponential(2)}rad/s`
      + ` normal=${peakPlane.normal.toExponential(2)}`
      + ` friction=${peakPlane.friction.toExponential(2)}`;
  const currentBodyPairAngularPeak = diagnostics.bodyPairAngularDeltaByBody.reduce((best, value) => (
    value.total > best.total ? value : best
  ), { bodyId: null, normal: 0, friction: 0, total: 0 });
  const currentBodyPairLine = currentBodyPairAngularPeak.bodyId === null
    ? "box angular delta: none"
    : `box angular delta: current B${currentBodyPairAngularPeak.bodyId}`
      + ` total=${currentBodyPairAngularPeak.total.toExponential(2)}rad/s`
      + ` normal=${currentBodyPairAngularPeak.normal.toExponential(2)}`
      + ` friction=${currentBodyPairAngularPeak.friction.toExponential(2)}`;
  const peakBodyPair = diagnostics.peakBodyPairAngularDelta;
  const peakBodyPairLine = peakBodyPair.bodyId === null
    ? "box angular peak: none"
    : `box angular peak: B${peakBodyPair.bodyId}`
      + ` total=${peakBodyPair.total.toExponential(2)}rad/s`
      + ` normal=${peakBodyPair.normal.toExponential(2)}`
      + ` friction=${peakBodyPair.friction.toExponential(2)}`;
  const planeByBody = new Map(diagnostics.planeAngularDeltaByBody.map((value) => [value.bodyId, value]));
  const bodyPairByBody = new Map(diagnostics.bodyPairAngularDeltaByBody.map((value) => [value.bodyId, value]));
  const sourceBodies = diagnostics.peakMotionByBody
    .filter((motion) => motion.linearSpeed > 0 || motion.angularSpeed > 0)
    .slice(0, 6)
    .map((motion) => {
      const box = bodyPairByBody.get(motion.bodyId);
      const plane = planeByBody.get(motion.bodyId);
      return `B${motion.bodyId}:box=${box.total.toExponential(1)}(N${box.normal.toExponential(1)} F${box.friction.toExponential(1)})`
        + ` plane=${plane.total.toExponential(1)}(N${plane.normal.toExponential(1)} F${plane.friction.toExponential(1)})`;
    });
  const angularSourceLine = sourceBodies.length === 0
    ? "angular source by body: none"
    : `angular source by body (${sourceBodies.length}): ${sourceBodies.join(" ")}rad/s`;
  const firstAngularSourceLine = diagnostics.firstAngularSourceByBody
    .filter((value) => value.source !== "none")
    .slice(0, 8)
    .map((value) => `B${value.bodyId}=${value.source}@${value.fixedStep}`
      + ` balanced=${value.floorSupportBalanced ? "yes" : "no"}`
      + ` unbalanced=${value.floorSupportUnbalanced ? "yes" : "no"}`)
    .join(" ");
  return [
    `wake rule: vN <= -${threshold}m/s  En threshold=${wakeEnergy}mJ  samples=${diagnostics.sampleCount}`,
    `motion: currentLinear=${diagnostics.maxLinearSpeed.toFixed(4)}m/s currentAngular=${diagnostics.maxAngularSpeed.toFixed(4)}rad/s peakLinear=${diagnostics.peakLinearSpeed.toFixed(4)}m/s peakAngular=${diagnostics.peakAngularSpeed.toFixed(4)}rad/s`,
    `peak body angular: ${diagnostics.peakMotionByBody.map((motion) => `B${motion.bodyId}=${motion.angularSpeed.toFixed(3)}`).join(" ")}rad/s`,
    currentBodyPairLine,
    peakBodyPairLine,
    angularSourceLine,
    firstAngularSourceLine.length === 0
      ? "first angular source by body: none"
      : `first angular source by body: ${firstAngularSourceLine}`,
    currentPlaneLine,
    peakPlaneLine,
    `sleep checks: contact=${diagnostics.maxContactSpeed.toFixed(4)}m/s normal=${diagnostics.maxNormalSpeed.toFixed(4)}m/s eligible=${diagnostics.sleepEligibleCount}/${DOMINO_COUNT} quiet=${diagnostics.quietContactCount}/${DOMINO_COUNT} support=${diagnostics.supportCount}/${DOMINO_COUNT}`,
    ...buildCpuEmulatorLines(diagnostics.cpuEmulator),
    ...buildPairImpulseAuditLines(diagnostics.pairImpulseAudit),
    ...buildStageVelocityLines(diagnostics.stageVelocity),
    ...diagnostics.pairs.map((pair) => `wake ${formatWakePair(pair)}`)
  ];
}

// theoretical targetをpanelへ表示し、実測した接触速度・力積を同じ単位で比較できるようにします
// この値はfloor pivot、上端角接触、摩擦なしの簡易モデルとして、GPU solver結果と比較します
function buildTheoryLines() {
  const theory = FALLING_DOMINO_THEORY;
  const wakeSpeed = physics?.getWakeLinearThreshold() ?? 0;
  const wakeImpulse = theory.effectiveMass * wakeSpeed;
  const wakeEnergy = 0.5 * theory.effectiveMass * wakeSpeed ** 2;
  return [
    `theory: gap=${(DOMINO_GAP * 1000).toFixed(2)}mm angle=${theory.angleDegrees.toFixed(2)}deg drop=${(theory.centerDrop * 1000).toFixed(2)}mm`,
    `theory: Egravity=${(theory.gravityEnergy * 1000).toFixed(3)}mJ Econtact=${(theory.contactEnergy * 1000).toFixed(3)}mJ vn=${theory.contactNormalSpeed.toFixed(3)}m/s`,
    `theory: Jcontact=${theory.collisionImpulse.toExponential(2)}Ns Jwake=${wakeImpulse.toExponential(2)}Ns Ewake(contact)=${(wakeEnergy * 1000).toExponential(2)}mJ`
  ];
}

// 現在の連鎖状態と操作方法をhelp panel用の行へ変換します
// panelは初期状態で畳み、見出しと展開ボタンを表示したままGPU負荷を確認できるようにします
function buildHelpLines() {
  const stats = bodyStats?.getValues();
  return [
    "ComputePhysicsSpace: falling dominoes",
    // WebgAppがフレーム間隔とJavaScript処理時間を集計し、フレーム間隔に対する負荷率を表示します
    // Compute PhysicsとRender Passへtimestamp-queryを渡し、GPU時間とframe間隔に対する負荷率を表示します
    ...(app?.getFrameTimingLines?.() ?? []),
    `frame: ${displayedFps.toFixed(1)} fps  ${displayedFrameMs.toFixed(2)} ms`,
    stats?.error
      ? `body statistics: ERROR ${stats.error.message}`
      : `dominoes: ${DOMINO_COUNT}  active: ${stats?.active ?? "-"}  sleeping: ${stats?.sleeping ?? "-"}`,
    `fixed steps: ${physics?.getFixedStepCount() ?? 0}  simulation: ${paused ? "paused" : "running"}`,
    ...buildTheoryLines(),
    ...buildWakeDiagnosticLines(),
    "GPU: predicted AABB -> XZ Grid -> candidate bitset -> combined solver",
    "GPU timing: physics fixed-step Compute + Render; diagnostic readback Compute is outside the timed interval",
    "contact: Box/Box and Plane/Box with persistent sleep",
    "render: current ping-pong BodyState; generic GPU diagnostic + B29-B32 CPU trace are explicit readbacks",
    "Drag: orbit  Wheel: zoom  space: kick  P: pause  R: reset  H: expand/collapse panel"
  ];
}

// panel本文を更新し、初回だけcollapsed状態とbutton表記を設定します
function updateHelpPanel(initial = false) {
  const lines = buildHelpLines();
  const text = lines.join("\n");
  if (initial === true) {
    app.showOverlayPanel(buildHelpPanelOptions({
      id: "fallingDominoesHelp",
      title: "Help",
      collapsed: true,
      anchor: "top-left",
      collapseLabelExpanded: "Hide Panel",
      collapseLabelCollapsed: "Show Panel",
      lines
    }));
    lastHelpText = text;
    return;
  }
  if (text === lastHelpText) return;
  const panel = app.getOverlayPanel("fallingDominoesHelp");
  panel.options.lines = lines;
  panel.options.text = text;
  panel.bodyEl.textContent = text;
  lastHelpText = text;
}

// keyboardとtouch buttonから共通利用する操作を処理します
// spaceは最初のbodyへ角impulseを送り、P/R/Hはsimulation状態だけを変更します
function applyAction(key) {
  const normalized = String(key).toLowerCase();
  if (normalized === "p") {
    paused = !paused;
  } else if (normalized === "space") {
    physics.applyAngularImpulse(STARTER_BODY_ID, [0, 0, -1.2]);
    cpuEmulator?.applyAngularImpulse(STARTER_BODY_ID, [0, 0, -1.2]);
    paused = false;
  } else if (normalized === "r") {
    const bodies = createBodies();
    physics.setBodies(bodies);
    cpuEmulator?.reset(bodies);
    wakeDiagnostics?.reset();
    paused = false;
  } else if (normalized === "h") {
    const panel = app.getOverlayPanel("fallingDominoesHelp");
    if (panel) panel.setCollapsed(!panel.collapsed);
  } else {
    return;
  }
  updateHelpPanel();
}

// CSS pixel寸法をScreenへ渡し、canvasとdepth textureを同じ大きさへ更新します
function resizeViewport() {
  screen.resize(Math.max(1, window.innerWidth), Math.max(1, window.innerHeight));
}

// WebgApp、ComputePhysicsSpace、単位Box、GPU直接描画を初期化してsimulationを開始します
// Compute commandとRender commandを同じencoderへ記録し、submitはWebgAppのframe処理へ集約します
async function start() {
  const diagnosticReadbackEnabled = new URLSearchParams(window.location.search).get("diagnostics") === "1";
  app = new WebgApp({
    document,
    computeFrame: true,
    autoDrawScene: false,
    clearColor: CLEAR_COLOR,
    // 保存したカメラ視点のfovX=70.00度を使い、eye位置はtargetとorbit姿勢から再現します
    viewAngle: CAMERA_VIEW_ANGLE,
    projectionNear: 0.001,
    projectionFar: 10,
    messageFontTexture: "../../webg/font512.png",
    camera: {
      target: CAMERA_TARGET,
      distance: CAMERA_DISTANCE,
      yaw: CAMERA_YAW,
      pitch: CAMERA_PITCH,
      roll: CAMERA_ROLL
    },
    debugTools: { mode: "release", system: "falling_dominoes", source: "samples/falling_dominoes/main.js" }
  });
  await app.init();
  screen = app.screen;
  resizeViewport();
  window.addEventListener("resize", resizeViewport);
  window.addEventListener("orientationchange", resizeViewport);
  app.createOrbitEyeRig({
    target: CAMERA_TARGET,
    distance: CAMERA_DISTANCE,
    yaw: CAMERA_YAW,
    pitch: CAMERA_PITCH,
    roll: CAMERA_ROLL,
    minDistance: CAMERA_MIN_DISTANCE, maxDistance: 5,
    // 近距離のカメラ移動を細かくするため、すべてのzoom入力を基準速度の10%にします
    orbit: {
      keyZoomSpeed: 0.9,
      pinchZoomSpeed: 0.11,
      wheelZoomStep: 0.09,
      dragZoomSpeed: 0.0005
    }
  });
  const boxShape = createUnitBoxShape((options) => Primitive.cube(2, options));

  const initialBodies = createBodies();
  physics = new ComputePhysicsSpace(app.getGPU(), {
    label: "falling-dominoes",
    maxBodies: DOMINO_COUNT,
    bodies: initialBodies,
    bounds: BOUNDS,
    gravity: [0, -DOMINO_GRAVITY, 0],
    fixedTimeStepMs: 1000 / 120,
    maxSubSteps: 4,
    solverIterations: 10,
    // 接触はComputePhysicsSpaceの局所反復solverを通常経路として使います
    persistentSleep: true,
    // domino32のNelder–Mead候補から得た角速度しきい値を、探索時と同じ絶対値で適用します
    sleepAngularSpeed: DOMINO_SLEEP_ANGULAR_SPEED,
    wakeAngularSpeed: DOMINO_WAKE_ANGULAR_SPEED,
    // 通常起動は明示的なstate readbackを省略し、?diagnostics=1のときだけ外部診断moduleを有効にします
    scale: COMPUTE_PHYSICS_SCALE
  });
  // GPUへ渡した初期descriptorを同じ順序でCPUエミュレータへ渡し、readbackを補正入力にしない比較を開始します
  // ComputePhysicsSpaceのscaleから取得できる寸法依存値は、ここでも同じ比率から明示的に算出します
  cpuEmulator = new ComputePhysicsCpuEmulator({
    bodies: initialBodies,
    bounds: BOUNDS,
    gravity: physics.getGravity(),
    fixedTimeStepMs: physics.getFixedTimeStepMs(),
    solverIterations: physics.getSolverIterations(),
    persistentSleep: true,
    positionCorrectionBeta: 1,
    positionSlop: DOMINO_HEIGHT * COMPUTE_PHYSICS_SCALE.positionSlopRatio,
    broadphasePadding: DOMINO_HEIGHT * COMPUTE_PHYSICS_SCALE.broadphasePaddingRatio,
    supportFeatureTolerance: DOMINO_HEIGHT * COMPUTE_PHYSICS_SCALE.supportFeatureToleranceRatio,
    restingRestitutionSpeed: DOMINO_HEIGHT * COMPUTE_PHYSICS_SCALE.restingRestitutionSpeedRatio,
    sleepLinearSpeed: physics.getSleepLinearThreshold(),
    sleepAngularSpeed: physics.getSleepAngularThreshold(),
    sleepContactSpeed: DOMINO_HEIGHT * COMPUTE_PHYSICS_SCALE.sleepContactSpeedRatio,
    sleepNormalSpeed: DOMINO_HEIGHT * COMPUTE_PHYSICS_SCALE.sleepNormalSpeedRatio,
    sleepSteps: physics.getSleepStepsThreshold(),
    minimumFloorSupportPoints: 2,
    wakeLinearSpeed: physics.getWakeLinearThreshold(),
    // ComputePhysicsSpaceにはwake角速度getterがないため、同じ候補定数を明示的に渡します
    wakeAngularSpeed: DOMINO_WAKE_ANGULAR_SPEED,
    // CPU診断でもbody pairを局所反復し、残留速度を再評価します
    revisitBodyContactImpulses: true,
    // B29〜B32の追跡はこのsampleの固定配置だけに必要なため、CPUエミュレータへ限定します
    traceBodyIds: [29, 30, 31, 32]
  });

  renderer = new FallingDominoRenderer(app.getGPU(), {
    format: app.getGPU().format,
    boxShape,
    stateBuffers: physics.getStateBuffers()
  });
  bodyStats = new FallingDominoStats(app.getGPU(), physics.getStateBuffers(), physics.getBodyCount());
  wakeDiagnostics = diagnosticReadbackEnabled
    ? new FallingDominoSleepDiagnostic(physics, physics.getBodyCount(), cpuEmulator)
    : null;
  updateHelpPanel(true);
  app.attachInput({ onKeyDown: (key, event) => { if (!event.repeat) applyAction(key); } });
  app.input.installTouchControls({
    touchDeviceOnly: false,
    groups: [{ id: "simulation", buttons: [
      { key: "space", label: "Kick", kind: "action", ariaLabel: "kick the starter domino" },
      { key: "p", label: "P", kind: "action", ariaLabel: "pause or resume" },
      { key: "r", label: "R", kind: "action", ariaLabel: "reset dominoes" },
      { key: "h", label: "H", kind: "action", ariaLabel: "show or hide panel" }
    ] }],
    onAction: ({ key }) => applyAction(String(key))
  });
  app.start({
    onUpdate: () => updateHelpPanel(),
    onComputeFrame: ({ deltaSec }) => {
      updateFrameTiming(deltaSec);
      const encoder = app.getGPU().device.createCommandEncoder({ label: "falling-dominoes:frame" });
      app.beginGpuTiming();
      statisticsFrameNumber += 1;
      wakeDiagnostics?.encodeBeforePhysics(encoder, statisticsFrameNumber);
      if (!paused) {
        physics.encode(encoder, deltaSec * 1000, {
          // 実際に記録されたfixed stepの先頭clearと末尾solverへだけqueryを置きます
          // app.beginGpuTiming()が計測slotを確保できないframeではundefinedになり計測を省略します
          getTimestampWrites: (phase, stepIndex, stepCount) => app.getGpuTimestampWrites(
            phase === "begin" && stepIndex === 0,
            phase === "end" && stepIndex === stepCount - 1
          )
        });
      }
      app.eye.setWorldMatrix();
      const view = new Matrix();
      view.makeView(app.eye.worldMatrix);
      renderer.writeCamera(app.projectionMatrix, view);
      renderer.encode(
        encoder,
        physics.getRenderState(),
        app.getGPU().context.getCurrentTexture().createView(),
        screen.getGPU().depthView,
        { timestampWrites: app.getGpuRenderTimestampWrites() }
      );
      if (statisticsFrameNumber % 12 === 1) bodyStats.encode(encoder, physics.getRenderState());
      wakeDiagnostics?.encodeAfterPhysics(encoder);
      app.endGpuTiming(encoder);
      app.getGPU().queue.submit([encoder.finish()]);
      app.afterGpuSubmit();
      bodyStats.resolveAfterSubmit();
      wakeDiagnostics?.resolveAfterSubmit();
    }
  });
  window.addEventListener("pagehide", () => {
    app.stop();
    bodyStats?.destroy();
    wakeDiagnostics?.destroy();
    renderer?.destroy();
    physics?.destroy();
    boxShape.destroy();
  }, { once: true });
}

// HTML解析後に初期化を開始し、失敗時はconsoleとerror panelへ同じ原因を表示します
// GPU初期化に失敗した場合はエラーを表示し、scene描画を開始せず原因を示します
document.addEventListener("DOMContentLoaded", () => {
  start().catch((error) => {
    console.error("falling_dominoes failed:", error);
    app?.showOverlayPanel?.(buildErrorPanelOptions(error, { title: "falling_dominoes failed", id: "start-error" }));
  });
});
