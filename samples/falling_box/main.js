// ---------------------------------------------
// samples/falling_box/main.js  2026/08/28
//   CPU and Compute falling-box comparison sample
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import WebgApp from "../../webg/WebgApp.js";
import BoxCollider from "../../webg/BoxCollider.js";
import ComputePhysicsSpace from "../../webg/ComputePhysicsSpace.js";
import Matrix from "../../webg/Matrix.js";
import PlaneCollider from "../../webg/PlaneCollider.js";
import PhysicsSpace from "../../webg/PhysicsSpace.js";
import Primitive from "../../webg/Primitive.js";
import Quat from "../../webg/Quat.js";
import Shape from "../../webg/Shape.js";
import { CAMERA_REVERSE_Z } from "../../webg/DepthConvention.js";
import {
  buildErrorPanelOptions,
  buildHelpPanelOptions
} from "../../webg/OverlayPanelPresets.js";
import {
  FALLING_BOX_DEFAULT_ANGULAR_SPEED_SCALE,
  FALLING_BOX_SOLVER,
  FALLING_BOX_WORLD,
  createFallingBoxScenario
} from "./fallingBoxScenario.js";

// HTMLから選択したbackendだけを受け取り、指定されたbackendを明示的に初期化します
// CPUとComputeは同じmain.jsを使い、scenario・camera・操作・Helpの処理を共有します
const BACKEND = window.__WEBG_FALLING_BOX_BACKEND__;
if (BACKEND !== "cpu" && BACKEND !== "compute") {
  throw new Error(`falling_box backend must be cpu or compute: ${BACKEND}`);
}

const FONT_FILE = "../../webg/font512.png";
const CLEAR_COLOR = Object.freeze([0.018, 0.035, 0.052, 1.0]);
const CAMERA = Object.freeze({
  target: [0.0, 0.35, 0.0],
  distance: 2.35,
  yaw: 0.0,
  pitch: -24.0,
  minDistance: 1.2,
  maxDistance: 4.5
});
const BOUNDARY_VISUAL_COLOR = Object.freeze([0.08, 0.24, 0.34, 1.0]);
const RENDER_PARAM_FLOATS = 36;
const RAD_TO_DEG = 180.0 / Math.PI;
const CPU_FLOOR_THICKNESS = 0.006;
const COMPARISON_OPTIONS = Object.freeze({
  count: 200,
  seed: 20260822,
  initialAngularSpeedScale: FALLING_BOX_DEFAULT_ANGULAR_SPEED_SCALE
});

let app = null;
let runtime = null;
let renderer = null;
let bodyStats = null;
let paused = false;
let lastHelpText = "";
let lastHelpUpdateMs = -Infinity;
let statisticsFrameNumber = 0;

// descriptorのquaternion配列をPhysicsNode用のQuatへ変換します
// Nodeの内部配列を直接書き換えず、PhysicsNodeの物理同期入口へ値を渡します
function createQuat(values) {
  const quat = new Quat();
  quat.q[0] = values[0];
  quat.q[1] = values[1];
  quat.q[2] = values[2];
  quat.q[3] = values[3];
  quat.normalize();
  return quat;
}

// 通常のPhysicsSpaceへscenarioの共通world・solver条件を渡します
// Box/PlaneだけのSpaceではPhysicsSpaceが登録Nodeから速度改善済みsolverを内部生成します
function createCpuPhysicsSpace(scenario) {
  const solver = FALLING_BOX_SOLVER;
  const referenceLength = solver.referenceLength;
  return new PhysicsSpace({
    gravity: FALLING_BOX_WORLD.gravity,
    fixedTimeStepMs: FALLING_BOX_WORLD.fixedTimeStepMs,
    maxSubSteps: FALLING_BOX_WORLD.maxSubSteps,
    solverIterations: FALLING_BOX_WORLD.solverIterations,
    defaultRestitution: FALLING_BOX_WORLD.defaultRestitution,
    defaultFriction: FALLING_BOX_WORLD.defaultFriction,
    persistentSleep: solver.persistentSleep,
    positionCorrectionBeta: solver.positionCorrectionBeta,
    positionSlop: referenceLength * solver.positionSlopRatio,
    computeBoxBroadphasePadding: referenceLength * solver.broadphasePaddingRatio,
    computeBoxSupportFeatureTolerance: referenceLength * solver.supportFeatureToleranceRatio,
    restingRestitutionSpeed: referenceLength * solver.restingRestitutionSpeedRatio,
    sleepLinearThreshold: referenceLength * solver.sleepLinearSpeedRatio,
    sleepAngularThreshold: solver.sleepAngularSpeed * RAD_TO_DEG,
    sleepContactSpeed: referenceLength * solver.sleepContactSpeedRatio,
    sleepNormalSpeed: referenceLength * solver.sleepNormalSpeedRatio,
    sleepStepsThreshold: solver.sleepSteps,
    minimumFloorSupportPoints: solver.minimumFloorSupportPoints,
    wakeLinearSpeed: referenceLength * solver.wakeLinearSpeedRatio,
    wakeAngularSpeed: solver.wakeAngularSpeed * RAD_TO_DEG,
    revisitBodyContactImpulses: true
  });
}

// 共通PlaneをCPUのstatic PhysicsNodeへ変換し、無限床と四壁をphysicsへ登録します
// Planeの位置はnormal * planeDistanceで作り、Compute版のbounds Planeと同じ平面を表します
function createCpuPlaneNodes(physics, scenario) {
  return scenario.world.planes.map((plane, index) => {
    const offset = plane.normal.map((value) => value * plane.planeDistance);
    const node = app.space.addPhysicsNode(null, `falling-box-cpu-plane-${index}`, {
      bodyType: "static",
      collider: new PlaneCollider(plane.normal, { offset })
    });
    physics.addBody(node);
    return node;
  });
}

// 一つの共通body descriptorからCPU PhysicsNodeとBox描画Shapeを生成します
// CPU PhysicsNodeの角速度だけはdegree/secへ変換し、他の物理値は同じdescriptorから渡します
function createCpuBody(physics, scenario, body, index) {
  const node = app.space.addPhysicsNode(null, `falling-box-cpu-${body.id}`, {
    bodyType: body.bodyType,
    mass: body.mass,
    gravityScale: body.gravityScale,
    linearDamping: body.linearDamping,
    angularDamping: body.angularDamping,
    allowSleep: body.allowSleep,
    isSleeping: body.isSleeping,
    isTrigger: body.isTrigger,
    fixedRotation: body.fixedRotation,
    collisionLayer: body.collisionLayer,
    collisionMask: body.collisionMask,
    material: body.material,
    collider: new BoxCollider(body.shape.size)
  });
  node.syncNodeFromPhysics(body.position, { quat: createQuat(body.orientation) });
  node.setLinearVelocityVec(body.linearVelocity);
  node.setAngularVelocityVec(body.angularVelocity.map((value) => value * RAD_TO_DEG));
  const shape = createBoxShape(app.getGPU(), body.shape.size, scenario.rawBodySpecs[index].color);
  node.addShape(shape);
  physics.addBody(node, body.id);
  return { node, shape };
}

// CPU runtimeを生成し、Planeと200体のBoxを共通scenarioと同じ順序で登録します
// scene graphへ登録したPhysicsNodeをPhysicsSpaceが更新し、通常のWebgApp描画へ渡します
// Planeは表示用Nodeとして保持し、衝突計算はsolver内の同じ無限境界Planeだけが担当します
function createCpuRuntime() {
  const scenario = createFallingBoxScenario(COMPARISON_OPTIONS);
  const physics = createCpuPhysicsSpace(scenario);
  const planeNodes = createCpuPlaneNodes(physics, scenario);
  const entries = scenario.bodies.map((body, index) => createCpuBody(physics, scenario, body, index));
  return {
    scenario,
    physics,
    planeNodes: Object.freeze(planeNodes),
    entries: Object.freeze(entries),
    stepCount: 0
  };
}

// CPU版だけへ表示する薄い床板を作ります
// 接触判定はPlaneが担当し、床板Boxは描画専用として一度だけ配置します
function createCpuBoundaryVisual(gpu, scenario) {
  const { minX, maxX, minZ, maxZ, floorY } = scenario.arena;
  const node = app.space.addNode(null, "falling-box-cpu-floor-visual");
  node.setPosition(
    (minX + maxX) * 0.5,
    floorY - CPU_FLOOR_THICKNESS * 0.5,
    (minZ + maxZ) * 0.5
  );
  node.addShape(createBoxShape(
    gpu,
    [maxX - minX, CPU_FLOOR_THICKNESS, maxZ - minZ],
    BOUNDARY_VISUAL_COLOR
  ));
}

// CPU bodyのsleep状態を色へ反映し、停止状態を画面で識別できるようにします
// 速度はsolverの値をそのまま扱い、PhysicsNodeのsleep flagを表示へ使います
function updateCpuBodyColors() {
  for (const [index, entry] of runtime.entries.entries()) {
    const color = runtime.scenario.rawBodySpecs[index].color;
    const scale = entry.node.getSleeping() ? 0.62 : 1.0;
    entry.shape.updateMaterial({
      color: [color[0] * scale, color[1] * scale, color[2] * scale, color[3]]
    });
  }
}

// CPU PhysicsNode列からactive・sleeping・最大速度を集計します
// 実際にsceneへ同期されたNodeを読み、物理状態と描画状態のずれを確認します
function readCpuStatistics() {
  let active = 0;
  let sleeping = 0;
  let maxLinearSpeed = 0.0;
  let maxAngularSpeed = 0.0;
  for (const entry of runtime.entries) {
    const node = entry.node;
    if (node.getSleeping()) sleeping += 1;
    else active += 1;
    maxLinearSpeed = Math.max(maxLinearSpeed, Math.hypot(...node.getLinearVelocity()));
    maxAngularSpeed = Math.max(
      maxAngularSpeed,
      Math.hypot(...node.getAngularVelocity()) / RAD_TO_DEG
    );
  }
  return { active, sleeping, maxLinearSpeed, maxAngularSpeed };
}

// CPU版のShapeを生成し、物理寸法と表示寸法を同じ配列から設定します
// Compute版の単位cube描画とは異なり、CPU版は各PhysicsNodeへ実寸Shapeを追加します
function createBoxShape(gpu, size, color) {
  const shape = new Shape(gpu);
  shape.applyPrimitiveAsset(Primitive.cuboid(
    size[0], size[1], size[2], shape.getPrimitiveOptions()
  ));
  shape.endShape();
  shape.setMaterial("smooth-shader", {
    has_bone: 0,
    use_texture: 0,
    color: [...color],
    ambient: 0.30,
    specular: 0.72,
    power: 42.0
  });
  return shape;
}

// Compute BodyStateをvertex shaderへ渡す描画用WGSLを定義します
// GPU stateをCPUへ戻さず、最新ping-pong bufferの位置・姿勢・寸法・色をinstance描画します
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
fn quatMultiply(a : vec4f, b : vec4f) -> vec4f {
  return vec4f(
    a.x*b.x-a.y*b.y-a.z*b.z-a.w*b.w,
    a.x*b.y+a.y*b.x+a.z*b.w-a.w*b.z,
    a.x*b.z-a.y*b.w+a.z*b.x+a.w*b.y,
    a.x*b.w+a.y*b.z-a.z*b.y+a.w*b.x
  );
}
fn quatRotate(q : vec4f, value : vec3f) -> vec3f {
  let conjugate = vec4f(q.x, -q.y, -q.z, -q.w);
  return quatMultiply(quatMultiply(q, vec4f(0.0, value)), conjugate).yzw;
}
@vertex fn vertexMain(input : VertexInput, @builtin(instance_index) index : u32) -> VertexOutput {
  let state = states[index];
  let localScale = state.halfExtentsSleepCounter.xyz;
  let worldNormal = normalize(quatRotate(state.orientation, input.normal));
  let worldPosition = state.position.xyz + quatRotate(state.orientation, input.position * localScale);
  let viewPosition = params.view * vec4f(worldPosition, 1.0);
  var output : VertexOutput;
  output.position = params.projection * viewPosition;
  output.viewPosition = viewPosition.xyz;
  output.viewNormal = normalize((params.view * vec4f(worldNormal, 0.0)).xyz);
  let sleepBrightness = select(1.0, 0.62, state.angularVelocitySleep.w > 0.5);
  output.color = state.color.rgb * sleepBrightness;
  return output;
}
@fragment fn fragmentMain(input : VertexOutput) -> @location(0) vec4f {
  let normal = normalize(input.viewNormal);
  let lightDirection = normalize(params.light.xyz);
  let viewDirection = normalize(-input.viewPosition);
  let diffuse = max(dot(normal, lightDirection), 0.0);
  let halfVector = normalize(lightDirection + viewDirection);
  let specular = pow(max(dot(normal, halfVector), 0.0), 64.0) * params.light.w;
  return vec4f(input.color * (0.20 + diffuse * 0.80) + vec3f(specular), 1.0);
}`;

// Computeの有限arenaをline-listで表示し、Plane境界と描画空間の一致を確認します
const BOUNDS_SHADER = `
struct RenderParams { projection : mat4x4f, view : mat4x4f, light : vec4f };
@group(0) @binding(0) var<uniform> params : RenderParams;
@vertex fn vertexMain(@location(0) position : vec3f) -> @builtin(position) vec4f {
  return params.projection * params.view * vec4f(position, 1.0);
}
@fragment fn fragmentMain() -> @location(0) vec4f {
  return vec4f(0.32, 0.76, 0.96, 1.0);
}`;

// scenarioのarenaを上下8頂点と12辺のline-listへ変換します
// Compute版のPlaneは無限ですが、200体が動く有限範囲を視覚的な目安として表示します
function buildBoundsVertices(scenario, maxY = 2.8) {
  const { minX, maxX, minZ, maxZ, floorY } = scenario.arena;
  const corners = [
    [minX, floorY, minZ], [maxX, floorY, minZ], [maxX, floorY, maxZ], [minX, floorY, maxZ],
    [minX, maxY, minZ], [maxX, maxY, minZ], [maxX, maxY, maxZ], [minX, maxY, maxZ]
  ];
  const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
  return new Float32Array(edges.flatMap(([a, b]) => [...corners[a], ...corners[b]]));
}

// Compute用の単位cube Shape、state buffer bind group、境界line pipelineを初期化します
// Compute passとRender passは同じcommand encoderへ記録しますが、submitはmain側へ残します
class FallingBoxComputeRenderer {
  // GPU context、共通scenario、unit cubeを受け取り、frame間で再利用するresourceを作ります
  constructor(gpu, scenario, boxShape, format) {
    this.device = gpu.device;
    this.queue = gpu.queue;
    this.scenario = scenario;
    this.boxShape = boxShape;
    this.createResources(format);
  }

  // shader、pipeline、camera uniform、arena bufferを一度だけ生成します
  // BodyStateのlayoutはComputePhysicsSpaceが公開する32 float構造と一致させます
  createResources(format) {
    this.paramBuffer = this.device.createBuffer({
      label: "falling-box:render-params",
      size: RENDER_PARAM_FLOATS * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    const shapeLayout = this.device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
      { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } }
    ] });
    this.shapeLayout = shapeLayout;
    const module = this.device.createShaderModule({ label: "falling-box:render-shader", code: RENDER_SHADER });
    this.shapePipeline = this.device.createRenderPipeline({
      label: "falling-box:render-box",
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [shapeLayout] }),
      vertex: {
        module,
        entryPoint: "vertexMain",
        buffers: [{ arrayStride: 32, attributes: [
          { shaderLocation: 0, offset: 0, format: "float32x3" },
          { shaderLocation: 1, offset: 12, format: "float32x3" }
        ] }]
      },
      fragment: { module, entryPoint: "fragmentMain", targets: [{ format }] },
      primitive: { topology: "triangle-list", cullMode: "back", frontFace: "ccw" },
      depthStencil: { format: CAMERA_REVERSE_Z.format, depthWriteEnabled: true, depthCompare: CAMERA_REVERSE_Z.compare }
    });
    const boundsData = buildBoundsVertices(this.scenario);
    this.boundsBuffer = this.device.createBuffer({
      label: "falling-box:bounds",
      size: boundsData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    });
    this.queue.writeBuffer(this.boundsBuffer, 0, boundsData);
    this.boundsVertexCount = boundsData.length / 3;
    const boundsModule = this.device.createShaderModule({ label: "falling-box:bounds-shader", code: BOUNDS_SHADER });
    const boundsLayout = this.device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } }
    ] });
    this.boundsPipeline = this.device.createRenderPipeline({
      label: "falling-box:render-bounds",
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [boundsLayout] }),
      vertex: { module: boundsModule, entryPoint: "vertexMain", buffers: [{
        arrayStride: 12,
        attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }]
      }] },
      fragment: { module: boundsModule, entryPoint: "fragmentMain", targets: [{ format }] },
      primitive: { topology: "line-list" },
      depthStencil: { format: CAMERA_REVERSE_Z.format, depthWriteEnabled: true, depthCompare: CAMERA_REVERSE_Z.compareEqual }
    });
    this.boundsBindGroup = this.device.createBindGroup({
      layout: boundsLayout,
      entries: [{ binding: 0, resource: { buffer: this.paramBuffer } }]
    });
  }

  // ping-pong state bufferごとのbind groupを作り、最新bufferのindexだけをframeごとに選びます
  setStateBuffers(stateBuffers) {
    this.bindGroups = stateBuffers.map((buffer) => this.device.createBindGroup({
      layout: this.shapeLayout,
      entries: [
        { binding: 0, resource: { buffer } },
        { binding: 1, resource: { buffer: this.paramBuffer } }
      ]
    }));
  }

  // WebgAppのprojectionとviewをuniformへ書き込みます
  writeCamera(projection, view) {
    const data = new Float32Array(RENDER_PARAM_FLOATS);
    data.set(projection.mat, 0);
    data.set(view.mat, 16);
    data.set([0.42, 0.78, 0.56, 0.55], 32);
    this.queue.writeBuffer(this.paramBuffer, 0, data);
  }

  // 境界lineと全Boxを一つのRenderPassへ記録します
  // stats ComputePassが先に終了しているため、RenderPass中はencoderの現在順序を維持します
  encode(encoder, state, colorView, depthView) {
    const pass = encoder.beginRenderPass({
      label: "falling-box:render",
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
    });
    pass.setPipeline(this.boundsPipeline);
    pass.setBindGroup(0, this.boundsBindGroup);
    pass.setVertexBuffer(0, this.boundsBuffer);
    pass.draw(this.boundsVertexCount);
    pass.setPipeline(this.shapePipeline);
    pass.setBindGroup(0, this.bindGroups[state.bufferIndex]);
    pass.setVertexBuffer(0, this.boxShape.vertexBuffer);
    pass.setIndexBuffer(this.boxShape.indexBuffer, this.boxShape.indexFormat);
    pass.drawIndexed(this.boxShape.indexCount, state.bodyCount);
    pass.end();
  }

  // rendererが生成したuniformと境界bufferだけを破棄します
  // ComputePhysicsSpaceのstate bufferとunit Shapeは呼出側の終了処理へ残します
  destroy() {
    this.paramBuffer.destroy();
    this.boundsBuffer.destroy();
  }
}

// Compute BodyStateからactive・sleepingをGPU上で数え、必要な4 counterだけをreadbackします
// 200体の座標や姿勢を毎frameCPUへ戻さず、Help Panelの統計処理を描画経路から分離します
class FallingBoxComputeStats {
  // state buffer、counter、readback buffer、集計pipelineを初期化します
  constructor(gpu, stateBuffers, bodyCount) {
    this.device = gpu.device;
    this.bodyCount = bodyCount;
    this.values = Object.freeze({ active: bodyCount, sleeping: 0, boxes: bodyCount, spheres: 0 });
    this.readbackPending = false;
    this.readbackMapStarted = false;
    this.error = null;
    this.createResources(stateBuffers);
  }

  // 4 counterをclear/countするCompute pipelineとstateごとのbind groupを作ります
  createResources(stateBuffers) {
    this.counterBuffer = this.device.createBuffer({
      label: "falling-box:stats-counters",
      size: 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
    });
    this.readbackBuffer = this.device.createBuffer({
      label: "falling-box:stats-readback",
      size: 16,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
    const layout = this.device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }
    ] });
    const module = this.device.createShaderModule({
      label: "falling-box:stats-shader",
      code: `
struct BodyState {
  position : vec4f, orientation : vec4f, linearVelocityInvMass : vec4f,
  angularVelocitySleep : vec4f, halfExtentsSleepCounter : vec4f,
  inverseInertiaLocal : vec4f, material : vec4f, color : vec4f,
};
@group(0) @binding(0) var<storage, read> bodies : array<BodyState>;
@group(0) @binding(1) var<storage, read_write> counters : array<atomic<u32>, 4>;
@compute @workgroup_size(4)
fn clearMain(@builtin(global_invocation_id) id : vec3u) {
  if (id.x < 4u) { atomicStore(&counters[id.x], 0u); }
}
@compute @workgroup_size(64)
fn countMain(@builtin(global_invocation_id) id : vec3u) {
  if (id.x >= ${this.bodyCount}u) { return; }
  let body = bodies[id.x];
  let sleeping = body.angularVelocitySleep.w > 0.5;
  if (body.linearVelocityInvMass.w > 0.0) {
    atomicAdd(&counters[select(0u, 1u, sleeping)], 1u);
  }
  atomicAdd(&counters[select(2u, 3u, body.inverseInertiaLocal.w > 0.5)], 1u);
}`
    });
    const pipelineLayout = this.device.createPipelineLayout({ bindGroupLayouts: [layout] });
    this.clearPipeline = this.device.createComputePipeline({
      label: "falling-box:stats-clear",
      layout: pipelineLayout,
      compute: { module, entryPoint: "clearMain" }
    });
    this.countPipeline = this.device.createComputePipeline({
      label: "falling-box:stats-count",
      layout: pipelineLayout,
      compute: { module, entryPoint: "countMain" }
    });
    this.bindGroups = stateBuffers.map((buffer) => this.device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: { buffer } },
        { binding: 1, resource: { buffer: this.counterBuffer } }
      ]
    }));
  }

  // 最新stateのcounter clear/count/copyをRenderPassの外側へ記録します
  // 前回readbackが終わるまで新しいmap対象を待機し、buffer mapを一件ずつ処理します
  encode(encoder, state) {
    if (this.readbackPending) return false;
    const bindGroup = this.bindGroups[state.bufferIndex];
    const clearPass = encoder.beginComputePass({ label: "falling-box:stats-clear" });
    clearPass.setPipeline(this.clearPipeline);
    clearPass.setBindGroup(0, bindGroup);
    clearPass.dispatchWorkgroups(1);
    clearPass.end();
    const countPass = encoder.beginComputePass({ label: "falling-box:stats-count" });
    countPass.setPipeline(this.countPipeline);
    countPass.setBindGroup(0, bindGroup);
    countPass.dispatchWorkgroups(Math.ceil(this.bodyCount / 64));
    countPass.end();
    encoder.copyBufferToBuffer(this.counterBuffer, 0, this.readbackBuffer, 0, 16);
    this.readbackPending = true;
    return true;
  }

  // submit後にmapを開始し、完了したcounterだけをHelp Panelへ公開します
  // map失敗を0へ置き換えず、明示的なERRORとして保持します
  resolveAfterSubmit() {
    if (!this.readbackPending || this.readbackMapStarted) return;
    this.readbackMapStarted = true;
    this.readbackBuffer.mapAsync(GPUMapMode.READ).then(() => {
      const data = new Uint32Array(this.readbackBuffer.getMappedRange());
      this.values = Object.freeze({ active: data[0], sleeping: data[1], boxes: data[2], spheres: data[3] });
      this.readbackBuffer.unmap();
      this.readbackPending = false;
      this.readbackMapStarted = false;
    }).catch((error) => {
      this.error = error;
      this.readbackPending = false;
      this.readbackMapStarted = false;
      console.error("falling_box statistics readback failed:", error);
    });
  }

  // 最後に完了したcounterだけを返し、進行中readbackの途中値を分けて管理します
  getValues() {
    return { ...this.values, error: this.error };
  }

  // counterとreadback bufferを破棄します
  destroy() {
    this.counterBuffer.destroy();
    this.readbackBuffer.destroy();
  }
}

// CPU/Compute共通のHelp本文を作り、backend固有の観測値だけを差し替えます
// 物理条件、body数、seed、Plane数、固定stepを両ページで同じ文言にします
function buildHelpLines() {
  const scenario = runtime.scenario;
  const stats = BACKEND === "compute" ? bodyStats.getValues() : readCpuStatistics();
  const backendLabel = BACKEND === "cpu"
    ? "CPU PhysicsSpace + PhysicsNode"
    : "Compute BodyState + ComputePhysicsSpace";
  const statsLine = stats.error
    ? `statistics: ERROR ${stats.error.message}`
    : `bodies: ${scenario.count}  active: ${stats.active}  sleeping: ${stats.sleeping}`;
  const fixedSteps = BACKEND === "compute"
    ? runtime.physics.getFixedStepCount()
    : runtime.stepCount;
  return [
    `falling_box common scenario (${BACKEND.toUpperCase()})`,
    ...(app?.getFrameTimingLines?.() ?? []),
    `state: ${paused ? "paused" : "running"}  ${statsLine}`,
    `fixed steps: ${fixedSteps}  planes: ${scenario.world.planes.length}`,
    `gravity: ${scenario.world.gravity[1].toFixed(2)} m/s^2  fixed: ${(scenario.world.fixedTimeStepMs / 1000).toFixed(6)} s  solver: ${scenario.world.solverIterations}`,
    `condition: seed=${scenario.seed}  initialAngularSpeedScale=${scenario.initialAngularSpeedScale.toFixed(3)}`,
    `backend: ${backendLabel}`,
    BACKEND === "compute"
      ? "render: current ping-pong BodyState -> instanced Box; position is not read back to CPU"
      : "render: scene graph Shape -> PhysicsNode transform; visual floor Box is not a physics body",
    BACKEND === "compute"
      ? `shapes: Box ${stats.boxes} / Sphere ${stats.spheres}`
      : `max speed: linear ${stats.maxLinearSpeed.toFixed(4)} m/s  angular ${stats.maxAngularSpeed.toFixed(4)} rad/s`,
    "comparison target: same body index, Box descriptor, five Plane boundaries, and fixed-step start state",
    "P or Space: pause/resume   R: reload/reset   H: show/hide Help Panel   Drag: orbit   Wheel: zoom"
  ];
}

// Help Panelを初期状態で畳み、backendと共通scenarioの条件を保存します
// 本文更新でpanel elementを作り直さず、利用者の開閉状態を保持します
function showHelpPanel() {
  const lines = buildHelpLines();
  app.showOverlayPanel(buildHelpPanelOptions({
    id: "fallingBoxHelp",
    title: "Help",
    collapsed: true,
    anchor: "top-left",
    collapseLabelExpanded: "Hide Panel",
    collapseLabelCollapsed: "Show Panel",
    maxWidth: "720px",
    lines
  }));
  lastHelpText = lines.join("\n");
}

// Help Panelの展開状態を切り替え、非表示だった場合だけ再表示します
// panelの状態変更で物理stepが止まらないよう、simulationとは独立して扱います
function toggleHelpPanel() {
  const panel = app.getOverlayPanel("fallingBoxHelp");
  if (!panel) return;
  if (panel.options.visible !== true) panel.show();
  panel.setCollapsed(!panel.collapsed);
}

// 250ms間隔でHelp本文を更新し、毎frameのDOM書き換えを避けます
// GPU統計は最後に完了したreadback値だけを表示し、pending中は未完了状態を表示します
function updateHelpPanel(timeMs) {
  if (timeMs - lastHelpUpdateMs < 250.0) return;
  const lines = buildHelpLines();
  const text = lines.join("\n");
  if (text !== lastHelpText) {
    app.updateOverlayPanel("fallingBoxHelp", { lines });
    lastHelpText = text;
  }
  lastHelpUpdateMs = timeMs;
}

// CPU版のpause、Compute版のpause、reset、Help操作を共通入力へ登録します
// resetは各backendのcacheとGPU/CPU stateを一緒に作り直すためページを再読み込みします
function attachInput() {
  app.attachInput({
    onKeyDown: (key, event) => {
      if (event.repeat) return;
      if (key === "p" || key === "space") {
        paused = !paused;
        event.preventDefault();
      } else if (key === "r") {
        window.location.reload();
        event.preventDefault();
      } else if (key === "h") {
        toggleHelpPanel();
        event.preventDefault();
      }
    }
  });
}

// Compute用の単位cube Shapeを作り、bodyごとのhalf extentsをshaderへ任せます
function createComputeBoxShape(gpu) {
  const shape = new Shape(gpu);
  shape.applyPrimitiveAsset(Primitive.cube(2, shape.getPrimitiveOptions()));
  shape.endShape();
  return shape;
}

// WebgAppへ共通cameraとbackend固有の描画方式を渡します
// CPUはscene draw、Computeはcommand encoderのCompute/Render統合を使います
async function createApp() {
  app = new WebgApp({
    document,
    frameTiming: true,
    computeFrame: BACKEND === "compute",
    autoDrawScene: BACKEND !== "compute",
    clearColor: CLEAR_COLOR,
    viewAngle: 48.0,
    projectionNear: 0.05,
    projectionFar: 80.0,
    messageFontTexture: FONT_FILE,
    light: { mode: "eye-fixed", position: [1.5, 2.5, 2.5, 1.0] },
    camera: CAMERA,
    debugTools: {
      mode: "release",
      system: `falling-box-${BACKEND}`,
      source: "samples/falling_box/main.js"
    }
  });
  await app.init();
  app.createOrbitEyeRig({
    target: CAMERA.target,
    distance: CAMERA.distance,
    yaw: CAMERA.yaw,
    pitch: CAMERA.pitch,
    minDistance: CAMERA.minDistance,
    maxDistance: CAMERA.maxDistance,
    wheelZoomStep: 0.12
  });
}

// 選択backendを初期化し、同じscenarioをCPU NodeまたはGPU BodyStateへ接続します
// CPUの旧Box接触実装やuser評価用solverを対象外とし、指定されたcoreだけを使います
async function initializeRuntime() {
  const gpu = app.getGPU();
  if (BACKEND === "cpu") {
    runtime = createCpuRuntime();
    createCpuBoundaryVisual(gpu, runtime.scenario);
    updateCpuBodyColors();
    return;
  }
  const scenario = createFallingBoxScenario(COMPARISON_OPTIONS);
  const solver = FALLING_BOX_SOLVER;
  const physics = new ComputePhysicsSpace({ device: gpu.device, queue: gpu.queue }, {
    label: "falling-box-compute",
    maxBodies: scenario.count,
    bounds: scenario.arena,
    gravity: scenario.world.gravity,
    fixedTimeStepMs: scenario.world.fixedTimeStepMs,
    maxSubSteps: scenario.world.maxSubSteps,
    solverIterations: scenario.world.solverIterations,
    defaultRestitution: scenario.world.defaultRestitution,
    defaultFriction: scenario.world.defaultFriction,
    persistentSleep: solver.persistentSleep,
    sleepSteps: solver.sleepSteps,
    minimumFloorSupportPoints: solver.minimumFloorSupportPoints,
    positionCorrectionBeta: solver.positionCorrectionBeta,
    sleepAngularSpeed: solver.sleepAngularSpeed,
    wakeAngularSpeed: solver.wakeAngularSpeed,
    scale: {
      referenceLength: solver.referenceLength,
      broadphasePaddingRatio: solver.broadphasePaddingRatio,
      positionSlopRatio: solver.positionSlopRatio,
      supportFeatureToleranceRatio: solver.supportFeatureToleranceRatio,
      restingRestitutionSpeedRatio: solver.restingRestitutionSpeedRatio,
      sleepLinearSpeedRatio: solver.sleepLinearSpeedRatio,
      wakeLinearSpeedRatio: solver.wakeLinearSpeedRatio,
      sleepContactSpeedRatio: solver.sleepContactSpeedRatio,
      sleepNormalSpeedRatio: solver.sleepNormalSpeedRatio
    },
    // 共通scenarioのshape.sizeをComputePhysicsSpaceの明示契約halfExtentsへ変換します
    // Compute coreはBoxの半サイズを3要素で明示的に受け取ります
    bodies: scenario.bodies.map((body, index) => ({
      id: body.id,
      position: [...body.position],
      orientation: [...body.orientation],
      linearVelocity: [...body.linearVelocity],
      angularVelocity: [...body.angularVelocity],
      bodyType: body.bodyType,
      motionMode: body.motionMode,
      mass: body.mass,
      gravityScale: body.gravityScale,
      allowSleep: body.allowSleep,
      isSleeping: body.isSleeping,
      isTrigger: body.isTrigger,
      fixedRotation: body.fixedRotation,
      collisionLayer: body.collisionLayer,
      collisionMask: body.collisionMask,
      material: {
        ...body.material,
        linearDamping: body.linearDamping,
        angularDamping: body.angularDamping
      },
      linearDamping: body.linearDamping,
      angularDamping: body.angularDamping,
      halfExtents: body.shape.size.map((entry) => entry * 0.5),
      color: [...scenario.rawBodySpecs[index].color]
    }))
  });
  runtime = {
    scenario,
    physics,
    readbackBuffer: physics.createStateReadbackBuffer(),
    stepCount: 0
  };
  const boxShape = createComputeBoxShape(gpu);
  renderer = new FallingBoxComputeRenderer(gpu, scenario, boxShape, gpu.format);
  renderer.setStateBuffers(physics.getStateBuffers());
  bodyStats = new FallingBoxComputeStats(gpu, physics.getStateBuffers(), scenario.count);
}

// CPU frameではPhysicsSpace.step()の後に通常のscene graphを描画します
// 可変frame時間をPhysicsSpaceがfixed stepへ分配し、登録solverから同期したNode状態を表示します
function startCpuLoop() {
  app.start({
    onUpdate: ({ deltaSec, timeMs }) => {
      if (!paused) {
        runtime.stepCount += runtime.physics.step(deltaSec * 1000.0);
        updateCpuBodyColors();
      }
      updateHelpPanel(timeMs);
    }
  });
}

// Compute frameではphysics、GPU統計、Renderを一つのencoderへ順に記録します
// RenderPassを終了してからfinishし、timestamp/readbackとencoderの状態を順序付けます
function startComputeLoop() {
  app.start({
    onUpdate: ({ timeMs }) => updateHelpPanel(timeMs),
    onComputeFrame: ({ deltaSec }) => {
      const encoder = app.getGPU().device.createCommandEncoder({ label: "falling-box:frame" });
      if (!paused) {
        runtime.stepCount += runtime.physics.encode(encoder, deltaSec * 1000.0);
      }
      app.eye.setWorldMatrix();
      const view = new Matrix();
      view.makeView(app.eye.worldMatrix);
      renderer.writeCamera(app.projectionMatrix, view);
      statisticsFrameNumber += 1;
      if (statisticsFrameNumber % 12 === 1) {
        bodyStats.encode(encoder, runtime.physics.getRenderState());
      }
      renderer.encode(
        encoder,
        runtime.physics.getRenderState(),
        app.getGPU().context.getCurrentTexture().createView(),
        app.screen.getGPU().depthView
      );
      app.getGPU().queue.submit([encoder.finish()]);
      bodyStats.resolveAfterSubmit();
    }
  });
}

// 初期化完了後にHelpを表示し、選択したbackendのframe loopを開始します
async function start() {
  await createApp();
  await initializeRuntime();
  showHelpPanel();
  attachInput();
  if (BACKEND === "compute") startComputeLoop();
  else startCpuLoop();
  window.addEventListener("pagehide", () => {
    app.stop();
    bodyStats?.destroy();
    renderer?.destroy();
    runtime?.readbackBuffer?.destroy();
  }, { once: true });
}

// 初期化失敗を黒画面のまま隠さず、consoleとerror panelへ同じ例外を表示します
document.addEventListener("DOMContentLoaded", () => {
  start().catch((error) => {
    console.error(`falling_box ${BACKEND} failed:`, error);
    app?.showOverlayPanel?.(buildErrorPanelOptions(error, {
      id: "fallingBoxError",
      title: `falling_box ${BACKEND} failed`
    }));
  });
});
