// ---------------------------------------------
// samples/compute_physics/main.js  2026/09/23
//   ComputePhysicsSpace mixed-shape comparison sample
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import WebgApp from "../../webg/WebgApp.js";
import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";
import Matrix from "../../webg/Matrix.js";
// PhysicsMaterialPairsを含む現行のCompute物理依存関係を同じmodule版で読み込みます
import ComputePhysicsSpace from "../../webg/ComputePhysicsSpace.js";
import ComputeBoxCollider from "../../webg/ComputeBoxCollider.js";
import ComputeSphereCollider from "../../webg/ComputeSphereCollider.js";
import ComputeCapsuleCollider from "../../webg/ComputeCapsuleCollider.js";
import ComputePlaneCollider from "../../webg/ComputePlaneCollider.js";
import { CAMERA_REVERSE_Z } from "../../webg/DepthConvention.js";
import { buildErrorPanelOptions, buildHelpPanelOptions } from "../../webg/OverlayPanelPresets.js";
import {
  COMPUTE_PHYSICS_BOUNDS,
  COMPUTE_PHYSICS_BODY_COUNT,
  COMPUTE_PHYSICS_SCALE,
  COMPUTE_PHYSICS_WORLD,
  createComputePhysicsScenario
} from "./computePhysicsScenario.js";


// このサンプルの目的:
// - coreのComputePhysicsSpaceへBox、Sphere、Capsuleを同じbody配列で登録する
// - GPU上のping-pong BodyStateをCompute後のvertex shaderから直接参照する
// - 3形状間の接触、Plane接触、反発、persistent sleepを画面で確認する

const SCENARIO = createComputePhysicsScenario();
const BODY_COUNT = COMPUTE_PHYSICS_BODY_COUNT;
const BOUNDS = COMPUTE_PHYSICS_BOUNDS;

// 起動時のdebug指定をURLから読み取り、release起動で不要なdebug UIを表示しないために使います
// 値を省略した場合だけfalseとし、0/1以外の指定は入力ミスとしてstart()のエラー表示へ渡します
function readStartupFlag(name) {
  const value = new URLSearchParams(window.location.search).get(name);
  if (value === null || value === "0") return false;
  if (value === "1") return true;
  throw new Error(`compute_physics ${name} query must be 0 or 1: ${value}`);
}

// Capsuleは半径に対する芯線の半長を固定比率にし、半径1の共有meshをuniform scaleします
// 物理colliderのsegmentLengthも同じ比率で作るため、球の赤道部分をY方向へ伸ばした見た目になります
const CAPSULE_RADIUS_RATIO = 0.22;
const CAPSULE_SEGMENT_RATIO = 0.70;
const CAPSULE_UNIT_SEGMENT_LENGTH = CAPSULE_SEGMENT_RATIO / CAPSULE_RADIUS_RATIO;
const CAPSULE_HEMISPHERE_SEGMENTS = 12;
const CAPSULE_LONGITUDE_SEGMENTS = 24;
const CLEAR_COLOR = Object.freeze([0.018, 0.035, 0.052, 1]);
const RENDER_PARAM_FLOATS = 36;

let app = null;
let screen = null;
let physics = null;
let renderer = null;
let sphereShape = null;
let boxShape = null;
let capsuleShape = null;
let bodyStats = null;
let paused = false;
let lastHelpText = "";
let statisticsFrameNumber = 0;
let frameHandlers = null;
let idleRenderListeners = [];
let simulationIdle = false;
let helpPanelDirty = true;
let lastBodyStatsKey = "";

// BodyStateの8個のvec4をcoreと同じ順に宣言し、形状種別をinverseInertiaLocal.wから読みます
// 同じshader moduleのBox/Sphere/Capsule entry pointを別pipelineへ接続し、全形状が同じstate bufferを共有します
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
  @location(3) specularStrength : f32,
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
fn buildVertex(input : VertexInput, instanceIndex : u32, expectedType : f32) -> VertexOutput {
  let state = states[instanceIndex];
  var output : VertexOutput;
  if (abs(state.inverseInertiaLocal.w - expectedType) > 0.25) {
    output.position = vec4f(2.0, 2.0, 2.0, 1.0);
    output.viewPosition = vec3f(0.0);
    output.viewNormal = vec3f(0.0, 1.0, 0.0);
    output.color = vec3f(0.0);
    output.specularStrength = 1.0;
    return output;
  }
  let localScale = select(
    state.halfExtentsSleepCounter.xyz,
    vec3f(state.halfExtentsSleepCounter.x),
    expectedType > 0.5
  );
  let worldNormal = normalize(quatRotate(state.orientation, input.normal));
  let worldPosition = state.position.xyz + quatRotate(state.orientation, input.position * localScale);
  let viewPosition = params.view * vec4f(worldPosition, 1.0);
  output.position = params.projection * viewPosition;
  output.viewPosition = viewPosition.xyz;
  output.viewNormal = normalize((params.view * vec4f(worldNormal, 0.0)).xyz);
  output.color = mix(state.color.rgb, vec3f(0.32, 0.52, 0.72), state.angularVelocitySleep.w * 0.28);
  output.specularStrength = select(1.0, 1.75, expectedType > 1.5);
  return output;
}
@vertex fn boxVertex(input : VertexInput, @builtin(instance_index) index : u32) -> VertexOutput {
  return buildVertex(input, index, 0.0);
}
@vertex fn sphereVertex(input : VertexInput, @builtin(instance_index) index : u32) -> VertexOutput {
  return buildVertex(input, index, 1.0);
}
@vertex fn capsuleVertex(input : VertexInput, @builtin(instance_index) index : u32) -> VertexOutput {
  return buildVertex(input, index, 2.0);
}
@fragment fn fragmentMain(input : VertexOutput) -> @location(0) vec4f {
  let normal = normalize(input.viewNormal);
  let lightDirection = normalize(params.light.xyz);
  let viewDirection = normalize(-input.viewPosition);
  let diffuse = max(dot(normal, lightDirection), 0.0);
  let halfVector = normalize(lightDirection + viewDirection);
  let specular = pow(max(dot(normal, halfVector), 0.0), 80.0) * params.light.w * input.specularStrength;
  return vec4f(input.color * (0.20 + diffuse * 0.80) + vec3f(specular), 1.0);
}`;

// 箱型simulation範囲をline-listで描くためのshaderです
// 物理Planeと同じ座標を使い、接触境界が見た目とずれていないかを確認できます
const BOUNDS_SHADER = `
struct RenderParams { projection : mat4x4f, view : mat4x4f, light : vec4f };
@group(0) @binding(0) var<uniform> params : RenderParams;
@vertex fn vertexMain(@location(0) position : vec3f) -> @builtin(position) vec4f {
  return params.projection * params.view * vec4f(position, 1.0);
}
@fragment fn fragmentMain() -> @location(0) vec4f { return vec4f(0.32, 0.76, 0.96, 1.0); }`;

// 共通scenarioの形状記述をCompute Collider付きbodyへ変換します
// CPU比較ページと同じ位置、姿勢、速度、材質を使い、Compute側だけがGPU Colliderを生成します
function createBodies() {
  return SCENARIO.bodies.map((body) => ({
    ...body,
    collider: body.shape.type === "sphere"
      ? new ComputeSphereCollider(body.shape.radius)
      : body.shape.type === "capsule"
        ? new ComputeCapsuleCollider(body.shape.radius, body.shape.segmentLength)
        : new ComputeBoxCollider(body.shape.size)
  }));
}

// 共通scenarioのPlane descriptorをCompute版の固定Planeへ変換します
// boundsから暗黙に再生成せず、CPU版と同じ5枚の境界入力を明示的に使用します
function createPlanes() {
  return SCENARIO.world.planes.map((plane) => new ComputePlaneCollider(plane.normal, {
    planeDistance: plane.planeDistance
  }));
}

// Primitiveから単位meshを作り、vertex/index bufferをraw render pipelineから使える状態にします
// Sphereは半径1、Boxは辺長2なので、BodyStateの半径またはhalf extentsをそのままscaleに使えます
function createUnitShape(asset) {
  const shape = new Shape(app.getGPU());
  shape.applyPrimitiveAsset(asset(shape.getPrimitiveOptions()));
  shape.endShape();
  return shape;
}

// コアPrimitiveのCapsule meshを半径1へ正規化して共有し、描画時は実半径でuniform scaleします
// 物理colliderと同じsegmentLengthを渡すため、芯線と球面を含めた見た目の高さも一致します
function createUnitCapsuleShape() {
  return createUnitShape((options) => Primitive.capsule(
    1.0,
    CAPSULE_UNIT_SEGMENT_LENGTH,
    CAPSULE_HEMISPHERE_SEGMENTS,
    CAPSULE_LONGITUDE_SEGMENTS,
    options
  ));
}

// 物理boundsの床から表示上限までの8頂点と12辺をline-list順へ展開します
// ceiling Planeは持たないため、上辺は空間サイズを読む目安としてだけ表示します
function buildBoundsVertices(maxY = 6.2) {
  const min = [BOUNDS.minX, BOUNDS.floorY, BOUNDS.minZ];
  const max = [BOUNDS.maxX, maxY, BOUNDS.maxZ];
  const corners = [
    [min[0], min[1], min[2]], [max[0], min[1], min[2]], [max[0], min[1], max[2]], [min[0], min[1], max[2]],
    [min[0], max[1], min[2]], [max[0], max[1], min[2]], [max[0], max[1], max[2]], [min[0], max[1], max[2]]
  ];
  const edges = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
  return new Float32Array(edges.flatMap(([a, b]) => [...corners[a], ...corners[b]]));
}

// ComputePhysicsSpaceの2本のstate bufferを直接読むBox/Sphere/Capsule描画を管理します
// command submitは行わず、WebgAppのcomputeFrameがComputeとRenderを一つのencoderへ順に記録します
class ComputePhysicsRenderer {
  // mesh、state buffer、canvas formatを受け取り、frame中に再生成しないGPU resourceを準備します
  constructor(gpu, options) {
    this.gpu = gpu;
    this.device = gpu.device;
    this.queue = gpu.queue;
    this.boxShape = options.boxShape;
    this.sphereShape = options.sphereShape;
    this.capsuleShape = options.capsuleShape;
    this.createResources(options.stateBuffers, options.format);
  }

  // camera uniform、形状pipeline、境界lineと2本分のbind groupを一度だけ生成します
  // BodyState layoutはcoreが公開する32 float構成とshader宣言を一致させています
  createResources(stateBuffers, format) {
    this.paramBuffer = this.device.createBuffer({
      label: "compute-physics-renderer:params",
      size: RENDER_PARAM_FLOATS * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    const layout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
        { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } }
      ]
    });
    const module = this.device.createShaderModule({ label: "compute-physics-renderer:shapes", code: RENDER_SHADER });
    const makePipeline = (label, entryPoint) => this.device.createRenderPipeline({
      label, layout: this.device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      vertex: {
        module, entryPoint,
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
    this.boxPipeline = makePipeline("compute-physics-renderer:box", "boxVertex");
    this.spherePipeline = makePipeline("compute-physics-renderer:sphere", "sphereVertex");
    this.capsulePipeline = makePipeline("compute-physics-renderer:capsule", "capsuleVertex");
    this.bindGroups = stateBuffers.map((buffer) => this.device.createBindGroup({
      layout,
      entries: [{ binding: 0, resource: { buffer } }, { binding: 1, resource: { buffer: this.paramBuffer } }]
    }));
    const boundsData = buildBoundsVertices();
    this.boundsVertexCount = boundsData.length / 3;
    this.boundsBuffer = this.device.createBuffer({
      size: boundsData.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    });
    this.queue.writeBuffer(this.boundsBuffer, 0, boundsData);
    const boundsLayout = this.device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } }]
    });
    const boundsModule = this.device.createShaderModule({ code: BOUNDS_SHADER });
    this.boundsPipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [boundsLayout] }),
      vertex: { module: boundsModule, entryPoint: "vertexMain", buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }] }] },
      fragment: { module: boundsModule, entryPoint: "fragmentMain", targets: [{ format }] },
      primitive: { topology: "line-list" },
      depthStencil: { format: CAMERA_REVERSE_Z.format, depthWriteEnabled: true, depthCompare: CAMERA_REVERSE_Z.compareEqual }
    });
    this.boundsBindGroup = this.device.createBindGroup({
      layout: boundsLayout, entries: [{ binding: 0, resource: { buffer: this.paramBuffer } }]
    });
  }

  // WebgAppのprojectionとcamera world matrixから作ったviewをuniformへ転送します
  // 物体ごとの姿勢や位置は転送せず、最新BodyStateはStorage Bufferからvertex shaderが読みます
  writeCamera(projection, view) {
    const data = new Float32Array(RENDER_PARAM_FLOATS);
    data.set(projection.mat, 0);
    data.set(view.mat, 16);
    data.set([0.42, 0.78, 0.56, 0.55], 32);
    this.queue.writeBuffer(this.paramBuffer, 0, data);
  }

  // 境界、Box instance、Sphere instance、Capsule instanceを一つのRender Passへ順に記録します
  // 形状違いのinstanceはvertex shaderでclip外へ出し、CPUのbody index一覧を初期化時から再利用します
  encode(encoder, state, colorView, depthView, options = {}) {
    const pass = encoder.beginRenderPass({
      label: "compute-physics:render",
      colorAttachments: [{
        view: colorView, loadOp: "clear", storeOp: "store",
        clearValue: { r: CLEAR_COLOR[0], g: CLEAR_COLOR[1], b: CLEAR_COLOR[2], a: CLEAR_COLOR[3] }
      }],
      depthStencilAttachment: {
        view: depthView, depthLoadOp: "clear", depthStoreOp: "store", depthClearValue: CAMERA_REVERSE_Z.clearValue
      },
      ...(options.timestampWrites === undefined ? {} : { timestampWrites: options.timestampWrites })
    });
    pass.setPipeline(this.boundsPipeline);
    pass.setBindGroup(0, this.boundsBindGroup);
    pass.setVertexBuffer(0, this.boundsBuffer);
    pass.draw(this.boundsVertexCount);
    this.drawShape(pass, this.boxPipeline, this.boxShape, state);
    this.drawShape(pass, this.spherePipeline, this.sphereShape, state);
    this.drawShape(pass, this.capsulePipeline, this.capsuleShape, state);
    pass.end();
  }

  // 指定meshを全body分instance描画し、形状選択は対応するvertex entry pointへ任せます
  // index形式はShapeが確定した値を使い、指定されたindex型をそのまま保持します
  drawShape(pass, pipeline, shape, state) {
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, this.bindGroups[state.bufferIndex]);
    pass.setVertexBuffer(0, shape.vertexBuffer);
    pass.setIndexBuffer(shape.indexBuffer, shape.indexFormat);
    pass.drawIndexed(shape.indexCount, state.bodyCount);
  }

  // renderer自身が生成したbufferを破棄し、coreのstate bufferやShapeは呼出側へ残します
  destroy() {
    this.paramBuffer.destroy();
    this.boundsBuffer.destroy();
  }
}

// 最新BodyStateのsleep flagと形状種別をGPU上で集計し、5整数だけを非同期readbackします
// body位置や姿勢はCPUへ戻さず、panel表示に必要なactive/sleeping/Box/Sphere/Capsule件数だけを取得します
class ComputePhysicsBodyStats {
  // 2本のping-pong state bufferへ対応するbind groupと、集計・readback bufferを準備します
  // body最大数ではなく実際のbodyCountだけをdispatch対象とし、使用中stateだけを統計へ含めます
  constructor(gpu, stateBuffers, bodyCount) {
    this.device = gpu.device;
    this.bodyCount = bodyCount;
    this.values = Object.freeze({ active: bodyCount, sleeping: 0, boxes: 0, spheres: 0, capsules: 0 });
    this.readbackPending = false;
    this.readbackMapStarted = false;
    this.readbackError = null;
    this.generation = 0;
    this.resolvedGeneration = -1;
    this.pendingGeneration = null;
    this.createResources(stateBuffers);
  }

  // active、sleeping、Box、Sphere、Capsuleの5 counterと、clear/count用Compute Pipelineを生成します
  // counterはatomic加算し、1 invocationが1 bodyのstateだけを読みます
  createResources(stateBuffers) {
    this.counterBuffer = this.device.createBuffer({
      label: "compute-physics-stats:counters",
      size: 5 * Uint32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
    });
    this.readbackBuffer = this.device.createBuffer({
      label: "compute-physics-stats:readback",
      size: 5 * Uint32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
    const layout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }
      ]
    });
    const module = this.device.createShaderModule({
      label: "compute-physics-stats:shader",
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
@group(0) @binding(1) var<storage, read_write> counters : array<atomic<u32>, 5>;
@compute @workgroup_size(8)
fn clearMain(@builtin(global_invocation_id) id : vec3u) {
  if (id.x < 5u) { atomicStore(&counters[id.x], 0u); }
}
@compute @workgroup_size(64)
fn countMain(@builtin(global_invocation_id) id : vec3u) {
  if (id.x >= ${this.bodyCount}u) { return; }
  let body = bodies[id.x];
  let sleeping = body.angularVelocitySleep.w > 0.5;
  if (body.linearVelocityInvMass.w > 0.0) {
    atomicAdd(&counters[select(0u, 1u, sleeping)], 1u);
  }
  var shapeCounter = 2u;
  if (body.inverseInertiaLocal.w > 1.5) {
    shapeCounter = 4u;
  } else if (body.inverseInertiaLocal.w > 0.5) {
    shapeCounter = 3u;
  }
  atomicAdd(&counters[shapeCounter], 1u);
}`
    });
    const pipelineLayout = this.device.createPipelineLayout({ bindGroupLayouts: [layout] });
    this.clearPipeline = this.device.createComputePipeline({
      label: "compute-physics-stats:clear", layout: pipelineLayout,
      compute: { module, entryPoint: "clearMain" }
    });
    this.countPipeline = this.device.createComputePipeline({
      label: "compute-physics-stats:count", layout: pipelineLayout,
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

  // 前回readbackが完了しているframeだけ、counter clear、body集計、20 byte copyを記録します
  // readback待ちのbufferへ再度copyせず、map中resourceの競合を避けます
  encode(encoder, state) {
    if (this.readbackPending) return false;
    const bindGroup = this.bindGroups[state.bufferIndex];
    const clearPass = encoder.beginComputePass({ label: "compute-physics-stats:clear" });
    clearPass.setPipeline(this.clearPipeline);
    clearPass.setBindGroup(0, bindGroup);
    clearPass.dispatchWorkgroups(1);
    clearPass.end();
    const countPass = encoder.beginComputePass({ label: "compute-physics-stats:count" });
    countPass.setPipeline(this.countPipeline);
    countPass.setBindGroup(0, bindGroup);
    countPass.dispatchWorkgroups(Math.ceil(this.bodyCount / 64));
    countPass.end();
    encoder.copyBufferToBuffer(this.counterBuffer, 0, this.readbackBuffer, 0, 20);
    this.readbackPending = true;
    this.pendingGeneration = this.generation;
    return true;
  }

  // reset後に古い統計readbackを新しいbody配置へ適用しないため世代を進めます
  // 進行中のmapAsyncは完了まで待ち、完了時に世代が一致しない結果だけを破棄します
  reset() {
    this.generation += 1;
    this.resolvedGeneration = -1;
    this.pendingGeneration = null;
    this.values = Object.freeze({ active: this.bodyCount, sleeping: 0, boxes: 0, spheres: 0, capsules: 0 });
    this.readbackError = null;
  }

  // submit済みの20 byte readback完了を待ち、panel用のimmutableな件数へ更新します
  // map失敗は0件へ置き換えずreadbackErrorへ保存し、panelとconsoleで明示します
  resolveAfterSubmit() {
    if (!this.readbackPending || this.readbackMapStarted) return;
    this.readbackMapStarted = true;
    const generation = this.pendingGeneration;
    this.readbackBuffer.mapAsync(GPUMapMode.READ).then(() => {
      const data = new Uint32Array(this.readbackBuffer.getMappedRange());
      if (generation === this.generation) {
        this.values = Object.freeze({
          active: data[0], sleeping: data[1], boxes: data[2], spheres: data[3], capsules: data[4]
        });
        this.resolvedGeneration = generation;
      }
      this.readbackBuffer.unmap();
      this.readbackPending = false;
      this.readbackMapStarted = false;
      this.pendingGeneration = null;
    }).catch((error) => {
      if (generation === this.generation) this.readbackError = error;
      this.readbackPending = false;
      this.readbackMapStarted = false;
      this.pendingGeneration = null;
      console.error("compute_physics statistics readback failed:", error);
    });
  }

  // 最新の完了済み集計値を返し、進行中readbackの途中値を分けて管理します
  // readback errorも同時に返し、panel側が統計を利用可能と誤表示しないようにします
  getValues() {
    return {
      ...this.values,
      error: this.readbackError,
      fresh: this.resolvedGeneration === this.generation
    };
  }

  // 集計用とreadback用bufferを破棄し、coreのBodyState bufferは継続利用します
  destroy() {
    this.counterBuffer.destroy();
    this.readbackBuffer.destroy();
  }
}

// 現在のsimulation状態と操作を折りたたみ可能なhelp panel用の行へ変換します
// panelを閉じた状態を既定にし、bodyの動きを起動直後から隠さないようにします
function buildHelpLines() {
  const stats = bodyStats?.getValues();
  return [
    "ComputePhysicsSpace mixed-shape comparison (Compute)",
    ...(simulationIdle
      ? ["Frame loop: idle", "GPU timing: idle", "JS timing: idle"]
      : app.getFrameTimingLines()),
    stats?.error
      ? `body statistics: ERROR ${stats.error.message}`
      : `bodies: ${BODY_COUNT}  active: ${stats?.active ?? "-"}  sleeping: ${stats?.sleeping ?? "-"}`,
    `shapes: Box ${stats?.boxes ?? 24} / Sphere ${stats?.spheres ?? 24} / Capsule ${stats?.capsules ?? 24}`,
    `fixed steps: ${physics?.getFixedStepCount() ?? 0}  simulation: ${simulationIdle ? "idle" : paused ? "paused" : "running"}`,
    "GPU: predicted AABB -> XZ Grid -> candidate bitset -> combined solver",
    "contacts: Box/Sphere/Capsule pairs, Plane/Box/Sphere/Capsule",
    "physics: GPU Compute timestamp; render: current BodyState, no position readback",
    "Drag: orbit  Wheel: zoom  P: pause  R: reset  H: show/hide panel"
  ];
}

// help panel本文が変わったときだけ既存DOMへ反映し、buttonを初期化時のまま再利用します
// 初回だけcollapsed=trueで生成し、以後は利用者が選んだ開閉状態を保ちます
function updateHelpPanel(initial = false) {
  const lines = buildHelpLines();
  const text = lines.join("\n");
  if (initial === true) {
    app.showOverlayPanel(buildHelpPanelOptions({
      id: "computePhysicsHelp", title: "Help", collapsed: true, anchor: "top-left",
      collapseLabelExpanded: "Hide Panel", collapseLabelCollapsed: "Show Panel", lines
    }));
    lastHelpText = text;
    return;
  }
  if (text === lastHelpText) return;
  const panel = app.getOverlayPanel("computePhysicsHelp");
  panel.options.lines = lines;
  panel.options.text = text;
  panel.bodyEl.textContent = text;
  lastHelpText = text;
}

// 完了済み統計の数値だけを比較し、body状態が変わったときだけHUD更新を要求します
// frame時間やfixed step数を毎frameで文字列化せず、readback結果や操作を表示更新の契機にします
function refreshHelpPanelIfNeeded() {
  const stats = bodyStats?.getValues();
  if (stats) {
    const errorKey = stats.error ? `${stats.error.name}:${stats.error.message}` : "";
    const statsKey = [
      stats.active, stats.sleeping, stats.boxes, stats.spheres, stats.capsules,
      stats.fresh === true ? 1 : 0, errorKey
    ].join("|");
    if (statsKey !== lastBodyStatsKey) {
      lastBodyStatsKey = statsKey;
      helpPanelDirty = true;
    }
    if (stats.fresh === true && stats.active === 0) {
      simulationIdle = true;
      helpPanelDirty = true;
    }
  }
  if (!helpPanelDirty) return;
  updateHelpPanel();
  helpPanelDirty = false;
}

// keyboardとtouch buttonから共通利用するpause、reset、panel操作を処理します
// 未定義keyは何も変更せず、WebgApp側のcamera操作へ渡せる状態を保ちます
function applyAction(key) {
  const normalized = key === " " ? key : String(key).toLowerCase();
  if (normalized === "p" || normalized === " ") paused = !paused;
  else if (normalized === "r") {
    physics.setBodies(createBodies());
    bodyStats.reset();
    simulationIdle = false;
    statisticsFrameNumber = 0;
    lastBodyStatsKey = "";
  }
  else if (normalized === "h") {
    const panel = app.getOverlayPanel("computePhysicsHelp");
    if (panel) panel.setCollapsed(!panel.collapsed);
  }
  else return;
  helpPanelDirty = true;
  updateHelpPanel();
  helpPanelDirty = false;
  requestComputeRender();
}

// 停止中のComputeサンプルを入力やpanel操作の一回描画だけで再開します
// app.requestRender()は停止後には機能しないため、停止中だけ同じframe handlerでstartします
function requestComputeRender() {
  if (!app) return false;
  if (app.running) return app.requestRender();
  if (!frameHandlers) {
    throw new Error("compute_physics frame handlers are not ready");
  }
  app.start(frameHandlers);
  return true;
}

// sleep後に停止したcanvasをcamera入力で一回だけ再描画できるようにします
// pointer eventへ統一し、mouseとtouchの両方で同じ再描画要求を発生させます
function attachIdleRenderListeners() {
  const canvas = screen?.canvas;
  if (!canvas) {
    throw new Error("compute_physics canvas is unavailable for idle rendering");
  }
  const listener = () => requestComputeRender();
  for (const type of ["pointerdown", "pointermove", "wheel"]) {
    const options = { passive: true };
    canvas.addEventListener(type, listener, options);
    idleRenderListeners.push({ type, listener, options });
  }
}

// pagehide時にsleep後の再描画listenerを解除し、破棄後のcanvasへ処理を送らないようにします
function detachIdleRenderListeners() {
  const canvas = screen?.canvas;
  if (canvas) {
    for (const { type, listener, options } of idleRenderListeners) {
      canvas.removeEventListener(type, listener, options);
    }
  }
  idleRenderListeners = [];
}

// Compute版の一回分の更新を監視し、統計readbackで全bodyのsleepを確認したframeでloopを停止します
// 停止後のframeではphysics.encodeを呼ばず、cameraやpanel操作時だけrequestComputeRender()で描画します
function updateComputeFrame() {
  refreshHelpPanelIfNeeded();
  if (simulationIdle) app.stop();
}

// viewportのCSS pixel寸法をScreenへ渡し、canvasとdepth textureを同じ大きさに更新します
// 0 pixelになる瞬間は最低1 pixelとして扱い、WebGPU texture生成へ有効な寸法を渡します
function resizeViewport() {
  screen.resize(Math.max(1, window.innerWidth), Math.max(1, window.innerHeight));
}

// WebgApp、core physics、単位mesh、直接描画rendererを順に初期化してframe処理を開始します
// ComputeとRenderを同じcommand encoderへ記録し、queue submit後のCPU readbackは診断時に分離します
async function start() {
  // debug=1はDebugDockを含むdebug起動を選びます。GPU validation scopeはrelease/debugを問わず開始しません
  const startupDebugMode = readStartupFlag("debug");
  app = new WebgApp({
    document, computeFrame: true, autoDrawScene: false, clearColor: CLEAR_COLOR,
    viewAngle: 48, projectionNear: 0.05, projectionFar: 80,
    messageFontTexture: "../../webg/font512.png",
    camera: { target: [0, 2.8, 0], distance: 10.5, yaw: 22, pitch: -17 },
    debugTools: {
      mode: startupDebugMode ? "debug" : "release",
      system: "compute_physics",
      source: "samples/compute_physics/main.js"
    }
  });
  await app.init();
  screen = app.screen;
  resizeViewport();
  window.addEventListener("resize", resizeViewport);
  window.addEventListener("orientationchange", resizeViewport);
  app.createOrbitEyeRig({ target: [0, 2.8, 0], distance: 10.5, yaw: 22, pitch: -17, minDistance: 5, maxDistance: 22 });
  sphereShape = createUnitShape((options) => Primitive.sphere(1, 18, 24, options));
  boxShape = createUnitShape((options) => Primitive.cube(2, options));
  capsuleShape = createUnitCapsuleShape();
  physics = new ComputePhysicsSpace(app.getGPU(), {
    label: "compute-physics-sample", maxBodies: BODY_COUNT, bodies: createBodies(), bounds: BOUNDS,
    planes: createPlanes(),
    gravity: COMPUTE_PHYSICS_WORLD.gravity,
    fixedTimeStepMs: COMPUTE_PHYSICS_WORLD.fixedTimeStepMs,
    maxSubSteps: COMPUTE_PHYSICS_WORLD.maxSubSteps,
    solverIterations: COMPUTE_PHYSICS_WORLD.solverIterations,
    defaultRestitution: COMPUTE_PHYSICS_WORLD.defaultRestitution,
    defaultFriction: COMPUTE_PHYSICS_WORLD.defaultFriction,
    persistentSleep: COMPUTE_PHYSICS_WORLD.persistentSleep,
    scale: {
      referenceLength: COMPUTE_PHYSICS_WORLD.referenceLength,
      ...COMPUTE_PHYSICS_SCALE
    }
  });
  renderer = new ComputePhysicsRenderer(app.getGPU(), {
    format: app.getGPU().format, sphereShape, boxShape, capsuleShape,
    stateBuffers: physics.getStateBuffers()
  });
  bodyStats = new ComputePhysicsBodyStats(
    app.getGPU(), physics.getStateBuffers(), physics.getBodyCount()
  );
  updateHelpPanel(true);
  helpPanelDirty = false;
  app.attachInput({ onKeyDown: (key, event) => { if (!event.repeat) applyAction(key); } });
  app.input.installTouchControls({
    touchDeviceOnly: false,
    groups: [{ id: "simulation", buttons: [
      { key: "p", label: "P", kind: "action", ariaLabel: "pause or resume" },
      { key: "r", label: "R", kind: "action", ariaLabel: "reset bodies" },
      { key: "h", label: "H", kind: "action", ariaLabel: "show or hide panel" }
    ] }],
    onAction: ({ key }) => applyAction(String(key))
  });
  frameHandlers = {
    onUpdate: updateComputeFrame,
    onComputeFrame: ({ deltaSec }) => {
      const encoder = app.getGPU().device.createCommandEncoder({ label: "compute-physics:frame" });
      app.beginGpuTiming();
      if (!paused && !simulationIdle) {
        physics.encode(encoder, deltaSec * 1000, {
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
        encoder, physics.getRenderState(),
        app.getGPU().context.getCurrentTexture().createView(), screen.getGPU().depthView,
        { timestampWrites: app.getGpuRenderTimestampWrites() }
      );
      statisticsFrameNumber += 1;
      if (!simulationIdle && statisticsFrameNumber % 12 === 1) {
        bodyStats.encode(encoder, physics.getRenderState());
      }
      app.endGpuTiming(encoder);
      app.getGPU().queue.submit([encoder.finish()]);
      app.afterGpuSubmit();
      bodyStats.resolveAfterSubmit();
    }
  };
  app.start(frameHandlers);
  attachIdleRenderListeners();
  window.addEventListener("pagehide", () => {
    app.stop();
    detachIdleRenderListeners();
    bodyStats?.destroy(); renderer?.destroy(); physics?.destroy();
    sphereShape?.destroy(); boxShape?.destroy(); capsuleShape?.destroy();
  }, { once: true });
}

// HTML解析完了後に非同期初期化を開始し、失敗時はconsoleとerror panelの両方へ表示します
// 黒画面のまま続行するfallbackは設けず、GPU validation errorも同じ経路で利用者へ通知します
document.addEventListener("DOMContentLoaded", () => {
  start().catch((error) => {
    console.error("compute_physics failed:", error);
    app?.showOverlayPanel?.(buildErrorPanelOptions(error, { title: "compute_physics failed", id: "start-error" }));
  });
});
