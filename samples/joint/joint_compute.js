// ---------------------------------------------
//  samples/joint/joint_compute.js  2026/08/27
//   GPU Compute Joint dynamics verification sample
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import WebgApp from "../../webg/WebgApp.js";
import {
  CAMERA,
  CROSSING_CAPSULE_DEFAULT_MODE,
  CROSSING_CAPSULE_END_X,
  CROSSING_CAPSULE_ID,
  CROSSING_CAPSULE_ORIENTATION,
  CROSSING_CAPSULE_RADIUS,
  CROSSING_CAPSULE_SEGMENT_LENGTH,
  CROSSING_CAPSULE_SPEED,
  CROSSING_CAPSULE_START_X,
  CROSSING_CAPSULE_Y,
  CROSSING_CAPSULE_Z,
  FIXED_TIME_STEP_MS,
  FIXED_TIME_STEP_SEC,
  GRAVITY,
  MAX_SUB_STEPS,
  PENDULUM_CONNECTOR_RADIUS,
  PENDULUM_DISTANCE,
  PENDULUM_ANGULAR_DAMPING,
  PENDULUM_LINEAR_DAMPING,
  PENDULUM_PIVOT_ID,
  PENDULUM_PIVOT_POSITION,
  PENDULUM_TARGET_PERIOD_SEC,
  PENDULUM_WEIGHT_ID,
  PENDULUM_WEIGHT_POSITION,
  PENDULUM_WEIGHT_RADIUS,
  ROPE_ANCHOR_GAP,
  ROPE_COLUMN_X_POSITIONS,
  ROPE_COLUMN_Z_POSITIONS,
  ROPE_LINK_ANCHOR,
  ROPE_LINK_COUNT,
  ROPE_LINK_ID_BASE,
  ROPE_LINK_LINEAR_DAMPING,
  ROPE_LINK_ANGULAR_DAMPING,
  ROPE_LINK_MASS,
  ROPE_LINK_RADIUS,
  ROPE_LINK_SEGMENT_LENGTH,
  ROPE_PIVOT_ID_BASE,
  ROPE_TOP_ANCHOR_OFFSET,
  ROPE_TOP_PIVOT_RADIUS,
  ROPE_TOP_PIVOT_Y
} from "./jointScenario.js";
import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";
import Matrix from "../../webg/Matrix.js";
import ComputePhysicsSpace, {
  COMPUTE_PHYSICS_BODY_STATE_LAYOUT
} from "../../webg/ComputePhysicsSpace.js";
import ComputeSphereCollider from "../../webg/ComputeSphereCollider.js";
import ComputeCapsuleCollider from "../../webg/ComputeCapsuleCollider.js";
import { rotateVec3ByQuat } from "../../webg/JointMath.js";
import { CAMERA_REVERSE_Z } from "../../webg/DepthConvention.js";
import {
  buildErrorPanelOptions,
  buildHelpPanelOptions
} from "../../webg/OverlayPanelPresets.js";

const FONT_FILE = "../../webg/font512.png";
const CLEAR_COLOR = [0.010, 0.018, 0.040, 1.0];

// Compute版はGPU stateを直接描画するため、bodyの表示情報をGPU bufferへ集約します
let app = null;
let screen = null;
let physics = null;
let renderer = null;
let readback = null;
let bodyDescriptors = null;
let ropeBodyIds = [];
let jointRecords = [];
let crossingController = null;
let paused = false;
let simulationTimeSec = 0.0;
let simulationAccumulatorMs = 0.0;
let frameNumber = 0;
let lastHelpText = "";
let lastHelpUpdateMs = -Infinity;

// GPU readbackで取得した診断値を、通常のGPU描画から分離して保持します
let diagnosticState = null;
let pendulumLastAngleRadians = null;
let pendulumLastAngleTimeSec = null;
let pendulumPreviousDownwardCrossingTimeSec = null;
let pendulumMeasuredPeriodSec = null;
let peakRopeLinearSpeed = 0.0;
let peakRopeAngularSpeed = 0.0;
let maximumJointError = 0.0;

const RENDER_PARAM_FLOATS = 44;
const RENDER_SHADER = `
// BodyStateはComputePhysicsSpaceがping-pongする物理状態です
// vertex shaderはCPU側のNodeを経由せず、Compute終了後のcurrent state bufferを直接読みます
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
struct RenderParams {
  projection : mat4x4f,
  view : mat4x4f,
  light : vec4f,
  connector : vec4f,
  connectorColor : vec4f,
};
@group(0) @binding(0) var<storage, read> states : array<BodyState>;
@group(0) @binding(1) var<uniform> params : RenderParams;

struct VertexInput {
  @location(0) position : vec3f,
  @location(1) normal : vec3f,
};
struct VertexOutput {
  @builtin(position) position : vec4f,
  @location(0) viewPosition : vec3f,
  @location(1) viewNormal : vec3f,
  @location(2) color : vec3f,
  @location(3) specularStrength : f32,
};

// 二つのquaternionを掛け合わせ、姿勢合成とベクトル回転の中間値を作ります
// vec4のxを実数部、yzwを虚数部として扱い、Quat.jsと同じ[w, x, y, z]の並びを保ちます
fn quatMultiply(a : vec4f, b : vec4f) -> vec4f {
  return vec4f(
    a.x*b.x-a.y*b.y-a.z*b.z-a.w*b.w,
    a.x*b.y+a.y*b.x+a.z*b.w-a.w*b.z,
    a.x*b.z-a.y*b.w+a.z*b.x+a.w*b.y,
    a.x*b.w+a.y*b.z-a.z*b.y+a.w*b.x
  );
}

// BodyStateの姿勢quaternionでlocal座標をworld座標へ回転します
// q * [0, value] * conjugate(q)の虚数部を取り出すことで、拡大縮小を加えずに方向だけを回転します
fn quatRotate(q : vec4f, value : vec3f) -> vec3f {
  let conjugate = vec4f(q.x, -q.y, -q.z, -q.w);
  return quatMultiply(quatMultiply(q, vec4f(0.0, value)), conjugate).yzw;
}

// radius=1、芯線長=1の基準Capsule頂点を任意の半径と芯線長へ正確に再構成します
// capを単純なY拡大で楕円化せず、sphere capの中心を移動して表示形状とColliderを一致させます
// y>0.5とy<-0.5は上下の半球、中央は円筒として扱い、基準meshの法線方向を保ったまま寸法だけを変えます
fn capsulePosition(inputPosition : vec3f, radius : f32, halfSegment : f32) -> vec3f {
  if (inputPosition.y > 0.5) {
    let direction = normalize(vec3f(inputPosition.x, inputPosition.y - 0.5, inputPosition.z));
    return vec3f(direction.x * radius, halfSegment + direction.y * radius, direction.z * radius);
  }
  if (inputPosition.y < -0.5) {
    let direction = normalize(vec3f(inputPosition.x, inputPosition.y + 0.5, inputPosition.z));
    return vec3f(direction.x * radius, -halfSegment + direction.y * radius, direction.z * radius);
  }
  return vec3f(inputPosition.x * radius, inputPosition.y * halfSegment * 2.0, inputPosition.z * radius);
}

// 基準Capsuleの法線をsphere capまたは円筒側から復元します
// surface normalを同じ変換で作るため、異なる寸法のlinkでもsmooth shadingを維持できます
fn capsuleNormal(inputPosition : vec3f, inputNormal : vec3f) -> vec3f {
  if (inputPosition.y > 0.5) {
    return normalize(vec3f(inputPosition.x, inputPosition.y - 0.5, inputPosition.z));
  }
  if (inputPosition.y < -0.5) {
    return normalize(vec3f(inputPosition.x, inputPosition.y + 0.5, inputPosition.z));
  }
  return normalize(vec3f(inputNormal.x, 0.0, inputNormal.z));
}

// BodyStateの形状寸法・姿勢・色をmesh頂点へ適用し、対象Collider type以外のslotを画面外へ送ります
// Sphere pipelineとCapsule pipelineは同じbody slot数をinstance描画するため、inverseInertiaLocal.wへ
// 記録されたCollider種別を見て、対象でないinstanceだけをclip相当の位置へ送ります
fn buildBodyVertex(input : VertexInput, instanceIndex : u32, expectedType : f32) -> VertexOutput {
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
  var localPosition = input.position;
  var localNormal = input.normal;
  if (expectedType > 1.5) {
    let radius = state.halfExtentsSleepCounter.x;
    let halfSegment = state.halfExtentsSleepCounter.y;
    localPosition = capsulePosition(input.position, radius, halfSegment);
    localNormal = capsuleNormal(input.position, input.normal);
  } else {
    let radius = state.halfExtentsSleepCounter.x;
    localPosition = input.position * vec3f(radius);
  }
  let worldNormal = normalize(quatRotate(state.orientation, localNormal));
  let worldPosition = state.position.xyz + quatRotate(state.orientation, localPosition);
  let viewPosition = params.view * vec4f(worldPosition, 1.0);
  output.position = params.projection * viewPosition;
  output.viewPosition = viewPosition.xyz;
  output.viewNormal = normalize((params.view * vec4f(worldNormal, 0.0)).xyz);
  output.color = state.color.rgb;
  output.specularStrength = select(1.0, 1.55, expectedType > 1.5);
  return output;
}

// Sphere meshをGPU stateのSphere slotへinstance描画します
@vertex fn sphereVertex(input : VertexInput, @builtin(instance_index) index : u32) -> VertexOutput {
  return buildBodyVertex(input, index, 1.0);
}

// Capsule meshをGPU stateのCapsule slotへinstance描画します
@vertex fn capsuleVertex(input : VertexInput, @builtin(instance_index) index : u32) -> VertexOutput {
  return buildBodyVertex(input, index, 2.0);
}

// 支点と振り子Sphereの現在GPU位置から、質量を持たない白い表示用connectorを作ります
// connector自体はPhysicsSpaceへ登録せず、DistanceJointのanchor間だけを表示します
// pivotとweightの差から毎vertexの基底ベクトルを作るため、振り子が三次元へ揺れても棒の向きが追従します
// GPU上の現在位置を使うので、connector描画もGPU stateから即時に作成します
@vertex fn connectorVertex(input : VertexInput, @builtin(instance_index) index : u32) -> VertexOutput {
  let pivot = states[u32(params.connector.x)].position.xyz;
  let weight = states[u32(params.connector.y)].position.xyz;
  let delta = weight - pivot;
  let connectorLength = length(delta);
  let direction = normalize(delta);
  let radius = params.connector.z;
  let halfSegment = connectorLength * 0.5 - radius;
  let localPosition = capsulePosition(input.position, radius, halfSegment);
  let localNormal = capsuleNormal(input.position, input.normal);
  var side = cross(vec3f(0.0, 0.0, 1.0), direction);
  if (length(side) < 0.00001) {
    side = cross(vec3f(1.0, 0.0, 0.0), direction);
  }
  side = normalize(side);
  let forward = normalize(cross(direction, side));
  let worldPosition = (pivot + weight) * 0.5
    + side * localPosition.x
    + direction * localPosition.y
    + forward * localPosition.z;
  let worldNormal = normalize(
    side * localNormal.x + direction * localNormal.y + forward * localNormal.z
  );
  var output : VertexOutput;
  let viewPosition = params.view * vec4f(worldPosition, 1.0);
  output.position = params.projection * viewPosition;
  output.viewPosition = viewPosition.xyz;
  output.viewNormal = normalize((params.view * vec4f(worldNormal, 0.0)).xyz);
  output.color = params.connectorColor.rgb;
  output.specularStrength = 1.25;
  return output;
}

// view空間の法線と光源から、全body共通の単色smooth shadingを計算します
@fragment fn fragmentMain(input : VertexOutput) -> @location(0) vec4f {
  let normal = normalize(input.viewNormal);
  let lightDirection = normalize(params.light.xyz);
  let viewDirection = normalize(-input.viewPosition);
  let diffuse = max(dot(normal, lightDirection), 0.0);
  let halfVector = normalize(lightDirection + viewDirection);
  let specular = pow(max(dot(normal, halfVector), 0.0), 80.0)
    * params.light.w * input.specularStrength;
  return vec4f(input.color * (0.18 + diffuse * 0.82) + vec3f(specular), 1.0);
}`;

// WebgAppのprojection/viewとGPU BodyStateを一つのRender Passへ接続します
// CPU側でbody位置を毎frame書き戻さず、Compute終了後のcurrent ping-pong bufferをそのまま参照します
class ComputeJointRenderer {
  // 形状meshとComputeのstate bufferを受け取り、frame間で再利用するGPU resourceを作ります
  constructor(gpu, options) {
    this.gpu = gpu;
    this.device = gpu.device;
    this.queue = gpu.queue;
    this.sphereShape = options.sphereShape;
    this.capsuleShape = options.capsuleShape;
    this.connectorShape = options.connectorShape;
    this.createResources(options.stateBuffers, options.format);
  }

  // 2本のstate buffer用bind groupとSphere/Capsule/connector pipelineを生成します
  // RenderParamsはWGSLのvec4境界に合わせ、projection、view、light、connector情報を固定順で格納します
  // state bufferはPhysicsSpaceが書き換えるため、rendererは参照用bind groupだけを保持します
  // stateの交換が起きてもbind group配列のindexを切り替えれば同じpipelineを再利用できます
  createResources(stateBuffers, format) {
    this.paramBuffer = this.device.createBuffer({
      label: "compute-joint-renderer:params",
      size: RENDER_PARAM_FLOATS * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    const layout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
        { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } }
      ]
    });
    const module = this.device.createShaderModule({
      label: "compute-joint-renderer:shader",
      code: RENDER_SHADER
    });
    // entry pointごとに深度設定と頂点レイアウトを共有するRenderPipelineを作ります
    const makePipeline = (label, entryPoint) => this.device.createRenderPipeline({
      label,
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      vertex: {
        module,
        entryPoint,
        buffers: [{
          arrayStride: 32,
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x3" },
            { shaderLocation: 1, offset: 12, format: "float32x3" }
          ]
        }]
      },
      fragment: {
        module,
        entryPoint: "fragmentMain",
        targets: [{ format }]
      },
      primitive: {
        topology: "triangle-list",
        cullMode: "back",
        frontFace: "ccw"
      },
      depthStencil: {
        format: CAMERA_REVERSE_Z.format,
        depthWriteEnabled: true,
        depthCompare: CAMERA_REVERSE_Z.compare
      }
    });
    this.spherePipeline = makePipeline("compute-joint-renderer:sphere", "sphereVertex");
    this.capsulePipeline = makePipeline("compute-joint-renderer:capsule", "capsuleVertex");
    this.connectorPipeline = makePipeline("compute-joint-renderer:connector", "connectorVertex");
    this.bindGroups = stateBuffers.map((buffer) => this.device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: { buffer } },
        { binding: 1, resource: { buffer: this.paramBuffer } }
      ]
    }));
  }

  // camera行列とconnectorのbody slotをuniformへ転送します
  // 物理bodyの位置、姿勢、色はGPU state bufferから読み、通常frameではGPU内で描画します
  // connector slotはbody IDではなくGPU配列のslotです。body IDとslotを混同すると別bodyを棒で結ぶため、
  // 呼出側でgetBodyInfo(...).slotを明示的に渡します
  writeCamera(projection, view, connectorSlots) {
    const data = new Float32Array(RENDER_PARAM_FLOATS);
    data.set(projection.mat, 0);
    data.set(view.mat, 16);
    data.set([0.46, 0.78, 0.66, 0.60], 32);
    data.set([connectorSlots.pivot, connectorSlots.weight, PENDULUM_CONNECTOR_RADIUS, 0.0], 36);
    data.set([1.0, 1.0, 1.0, 1.0], 40);
    this.queue.writeBuffer(this.paramBuffer, 0, data);
  }

  // Sphere、Capsule、massless connectorを同一Render Passへ記録します
  // Computeのstate buffer indexだけを切り替え、CPU側のbody一覧を初期化時のまま再利用します
  // この関数はcommandを記録し、Compute pass、readback copy、Render passを
  // 呼出側が同じcommand encoderへ順番に記録し、最後に一度だけsubmitします
  encode(encoder, state, colorView, depthView) {
    const pass = encoder.beginRenderPass({
      label: "compute-joint:render",
      colorAttachments: [{
        view: colorView,
        loadOp: "clear",
        storeOp: "store",
        clearValue: {
          r: CLEAR_COLOR[0],
          g: CLEAR_COLOR[1],
          b: CLEAR_COLOR[2],
          a: CLEAR_COLOR[3]
        }
      }],
      depthStencilAttachment: {
        view: depthView,
        depthLoadOp: "clear",
        depthStoreOp: "store",
        depthClearValue: CAMERA_REVERSE_Z.clearValue
      }
    });
    const bindGroup = this.bindGroups[state.bufferIndex];
    pass.setBindGroup(0, bindGroup);
    this.drawShape(pass, this.spherePipeline, this.sphereShape, state.bodySlotCount);
    this.drawShape(pass, this.capsulePipeline, this.capsuleShape, state.bodySlotCount);
    pass.setPipeline(this.connectorPipeline);
    pass.setVertexBuffer(0, this.connectorShape.vertexBuffer);
    pass.setIndexBuffer(this.connectorShape.indexBuffer, this.connectorShape.indexFormat);
    pass.drawIndexed(this.connectorShape.indexCount, 1);
    pass.end();
  }

  // 指定したmeshを全slot分instance描画し、shader側でCollider typeの異なるslotをclipします
  // body削除時もslot順を変えずに済むため、GPU stateと描画instanceの対応が固定されます
  drawShape(pass, pipeline, shape, instanceCount) {
    pass.setPipeline(pipeline);
    pass.setVertexBuffer(0, shape.vertexBuffer);
    pass.setIndexBuffer(shape.indexBuffer, shape.indexFormat);
    pass.drawIndexed(shape.indexCount, instanceCount);
  }

  // renderer専用uniform bufferを破棄し、PhysicsSpaceのstate bufferは呼出側へ残します
  destroy() {
    this.paramBuffer.destroy();
  }
}

// kinematic driverの移動をCompute fixed stepへ適用します
// quasiStaticではteleportと速度0、impactでは同じ位置処方と処方速度をGPUへ渡します
class ComputeKinematicController {
  // body IDと直線経路を検証し、GPU commandへ変換する状態を初期化します
  // GPU版でも移動量は経路上のスカラーで保持し、各fixed stepの始点・終点位置を同じ式から作ります
  // 物理bodyの位置積分を使わないため、端点での停止判定もこのcontroller内で完結させます
  constructor({ physicsSpace, bodyId, startPosition, endPosition, speed }) {
    this.physicsSpace = physicsSpace;
    this.bodyId = bodyId;
    this.startPosition = [...startPosition];
    this.endPosition = [...endPosition];
    this.speed = speed;
    this.travelDistance = 0.0;
    this.direction = 1;
    this.mode = CROSSING_CAPSULE_DEFAULT_MODE;
    this.pathLength = Math.hypot(
      endPosition[0] - startPosition[0],
      endPosition[1] - startPosition[1],
      endPosition[2] - startPosition[2]
    );
    if (this.pathLength <= 1.0e-8) {
      throw new Error("ComputeKinematicController path must have non-zero length");
    }
    this.pathDirection = [
      (endPosition[0] - startPosition[0]) / this.pathLength,
      (endPosition[1] - startPosition[1]) / this.pathLength,
      (endPosition[2] - startPosition[2]) / this.pathLength
    ];
  }

  // quasiStaticまたはimpactを明示的に選び、速度の閾値による切替を呼出側で管理します
  // modeはteleportした位置を接触solverがどう解釈するかを決める値で、Capsuleの形状や質量を保持します
  setMode(mode) {
    if (mode !== "quasiStatic" && mode !== "impact") {
      throw new Error(`ComputeKinematicController unsupported mode: ${mode}`);
    }
    this.mode = mode;
    return this;
  }

  // A/D入力から左、停止、右の方向を設定します
  // direction=0は停止を表し、速度は指定された方向と値で計算します
  setDirection(direction) {
    if (!Number.isInteger(direction) || direction < -1 || direction > 1) {
      throw new Error("ComputeKinematicController direction must be -1, 0, or 1");
    }
    this.direction = direction;
    return this;
  }

  // 現在のdriver移動速度を返し、Help Panelの処方速度表示へ使います
  // 返す値はpathDirection * speed * directionであり、controllerが決めた移動速度として使います
  getPrescribedVelocity() {
    if (this.direction === 0) return [0.0, 0.0, 0.0];
    return this.pathDirection.map((value) => value * this.speed * this.direction);
  }

  // 現在の進行方向とmodeを返し、入力状態の表示を同じcontrollerから作ります
  getState() {
    return {
      mode: this.mode,
      direction: this.direction,
      travelDistance: this.travelDistance,
      position: this.getPosition(),
      prescribedVelocity: this.getPrescribedVelocity()
    };
  }

  // travelDistanceからdriverの処方位置を再構成します
  // positionは毎回startPositionから再計算するため、前frameの丸め誤差を蓄積せず端点内へ収めます
  getPosition() {
    return this.startPosition.map(
      (value, index) => value + this.pathDirection[index] * this.travelDistance
    );
  }

  // reset用の初期位置へ戻し、次のfixed stepから停止状態をGPUへ渡します
  // GPUのbody stateを初期positionへ戻すだけでなく、残っているlinear velocityも明示的に0へします
  reset() {
    this.travelDistance = 0.0;
    this.direction = 0;
    this.physicsSpace.teleport(this.bodyId, this.startPosition, {
      keepVelocity: false,
      wakeUp: true
    });
    this.physicsSpace.setBodyLinearVelocity(this.bodyId, [0.0, 0.0, 0.0]);
  }

  // 一fixed step分だけ経路を進め、kinematic bodyへpositionと接触速度の方針を記録します
  // fixed stepを複数回実行するframeでも、各stepに異なるposition commandを渡します
  // quasiStaticではteleport後に速度0を設定し、impactでは処方速度を設定します
  // keepVelocityはimpactでだけ有効にして、teleport前の速度をimpact時の入力として扱います
  updateFixedStep() {
    let moving = this.direction !== 0;
    if (moving) {
      this.travelDistance += this.direction * this.speed * FIXED_TIME_STEP_SEC;
      if (this.travelDistance <= 0.0) {
        this.travelDistance = 0.0;
        this.direction = 0;
        moving = false;
      } else if (this.travelDistance >= this.pathLength) {
        this.travelDistance = this.pathLength;
        this.direction = 0;
        moving = false;
      }
    }
    const position = this.getPosition();
    const prescribedVelocity = moving ? this.getPrescribedVelocity() : [0.0, 0.0, 0.0];
    const contactVelocity = this.mode === "impact" ? prescribedVelocity : [0.0, 0.0, 0.0];
    this.physicsSpace.teleport(this.bodyId, position, {
      keepVelocity: moving && this.mode === "impact",
      wakeUp: true
    });
    this.physicsSpace.setBodyLinearVelocity(this.bodyId, contactVelocity);
  }
}

// Compute版BodyStateへ渡すbody記述を固定順で作り、rendererのinstance slotを安定させます
// body IDはJoint descriptorの参照用、配列位置はGPU BodyStateのslot用として別々に扱います
function createBodyDescriptors() {
  // ComputePhysicsSpaceへ渡す配列はGPU BodyStateのslot順を決めるため、追加順を固定します
  // body.idはJoint descriptorの参照、配列位置はvertex shaderのinstance indexであり、別の値です
  const bodies = [];
  // SphereのColliderとGPU BodyStateへ渡す共通body descriptorを作ります
  const addSphere = (body) => bodies.push({
    collider: new ComputeSphereCollider(body.radius),
    position: [...body.position],
    orientation: body.orientation ?? [1.0, 0.0, 0.0, 0.0],
    bodyType: body.bodyType,
    id: body.id,
    mass: body.mass ?? 1.0,
    gravityScale: body.gravityScale ?? 1.0,
    allowSleep: body.allowSleep ?? true,
    collisionLayer: body.collisionLayer,
    collisionMask: body.collisionMask,
    fixedRotation: body.fixedRotation ?? false,
    material: body.material,
    color: body.color
  });
  // CapsuleのColliderとGPU BodyStateへ渡す共通body descriptorを作ります
  const addCapsule = (body) => bodies.push({
    collider: new ComputeCapsuleCollider(body.radius, body.segmentLength),
    position: [...body.position],
    orientation: body.orientation ?? [1.0, 0.0, 0.0, 0.0],
    bodyType: body.bodyType,
    id: body.id,
    mass: body.mass ?? 1.0,
    gravityScale: body.gravityScale ?? 1.0,
    allowSleep: body.allowSleep ?? true,
    collisionLayer: body.collisionLayer,
    collisionMask: body.collisionMask,
    fixedRotation: body.fixedRotation ?? false,
    material: body.material,
    color: body.color
  });

  addSphere({
    id: PENDULUM_PIVOT_ID,
    position: PENDULUM_PIVOT_POSITION,
    radius: 0.025,
    bodyType: "static",
    collisionLayer: 8,
    collisionMask: 0,
    material: { restitution: 0.0, friction: 0.0, linearDamping: 0.0, angularDamping: 0.0 },
    color: [0.34, 0.82, 1.0, 1.0]
  });
  addSphere({
    id: PENDULUM_WEIGHT_ID,
    position: PENDULUM_WEIGHT_POSITION,
    radius: PENDULUM_WEIGHT_RADIUS,
    bodyType: "dynamic",
    mass: 1.0,
    gravityScale: 1.0,
    allowSleep: false,
    collisionLayer: 8,
    collisionMask: 0,
    material: {
      restitution: 0.0,
      friction: 0.0,
      linearDamping: PENDULUM_LINEAR_DAMPING,
      angularDamping: PENDULUM_ANGULAR_DAMPING
    },
    color: [1.0, 0.22, 0.68, 1.0]
  });

  ropeBodyIds = [];
  for (let columnIndex = 0; columnIndex < ROPE_COLUMN_X_POSITIONS.length; columnIndex++) {
    const x = ROPE_COLUMN_X_POSITIONS[columnIndex];
    const z = ROPE_COLUMN_Z_POSITIONS[columnIndex];
    addSphere({
      id: ROPE_PIVOT_ID_BASE + columnIndex,
      position: [x, ROPE_TOP_PIVOT_Y, z],
      radius: ROPE_TOP_PIVOT_RADIUS,
      bodyType: "static",
      collisionLayer: 2,
      collisionMask: 0,
      material: { restitution: 0.0, friction: 0.0, linearDamping: 0.0, angularDamping: 0.0 },
      color: [0.12, 0.92, 0.70, 1.0]
    });
    const columnLinks = [];
    // link中心は、pivot下端、link半径分のanchor、見かけのgap、前linkとの間隔から算出します
    // Joint側でも同じanchor間隔を使うため、初期配置から拘束誤差を小さく保ちます
    for (let index = 0; index < ROPE_LINK_COUNT; index++) {
      const centerY = ROPE_TOP_PIVOT_Y - ROPE_TOP_ANCHOR_OFFSET
        - ROPE_LINK_ANCHOR - ROPE_ANCHOR_GAP
        - index * (ROPE_LINK_ANCHOR * 2.0 + ROPE_ANCHOR_GAP);
      const id = ROPE_LINK_ID_BASE + columnIndex * ROPE_LINK_COUNT + index;
      addCapsule({
        id,
        position: [x, centerY, z],
        radius: ROPE_LINK_RADIUS,
        segmentLength: ROPE_LINK_SEGMENT_LENGTH,
        bodyType: "dynamic",
        mass: ROPE_LINK_MASS,
        gravityScale: 1.0,
        allowSleep: true,
        collisionLayer: 2,
        collisionMask: 4,
        fixedRotation: false,
        material: {
          restitution: 0.0,
          friction: 0.0,
          linearDamping: ROPE_LINK_LINEAR_DAMPING,
          angularDamping: ROPE_LINK_ANGULAR_DAMPING
        },
        color: columnIndex % 2 === 0
          ? [0.24, 0.52, 1.0, 1.0]
          : [0.62, 0.32, 0.98, 1.0]
      });
      columnLinks.push(id);
      ropeBodyIds.push(id);
    }
    // root pivotと各linkを後から作るJoint descriptorへ渡すため、列ごとのID配列を一時保存します
    // このrecordはJoint登録の補助情報として扱い、ComputePhysicsSpaceのbody descriptorと分けます
    bodies.push({ __ropeLinkColumn: columnIndex, __ropePivotId: ROPE_PIVOT_ID_BASE + columnIndex, __ropeLinks: columnLinks });
  }

  // 上で作ったJoint構築用の一時recordはCompute bodyへ渡さず、descriptor列から除去します
  // 先に作ったrecordを除去してからcrossing Capsuleを追加し、描画・readback対象のbodyだけを残します
  const ropeColumns = bodies.filter((body) => body.__ropeLinks);
  const actualBodies = bodies.filter((body) => !body.__ropeLinks);
  const crossingBody = {
    id: CROSSING_CAPSULE_ID,
    position: [CROSSING_CAPSULE_START_X, CROSSING_CAPSULE_Y, CROSSING_CAPSULE_Z],
    orientation: CROSSING_CAPSULE_ORIENTATION,
    radius: CROSSING_CAPSULE_RADIUS,
    segmentLength: CROSSING_CAPSULE_SEGMENT_LENGTH,
    bodyType: "kinematic",
    mass: 8.0,
    gravityScale: 0.0,
    allowSleep: false,
    collisionLayer: 4,
    collisionMask: 2,
    fixedRotation: true,
    material: { restitution: 0.0, friction: 0.0, linearDamping: 0.0, angularDamping: 0.0 },
    color: [1.0, 0.82, 0.20, 1.0]
  };
  addCapsule(crossingBody);
  // crossing Capsuleは一時record除去後に追加しているため、返却する実body配列へ明示的に含めます
  actualBodies.push(bodies[bodies.length - 1]);
  bodyDescriptors = actualBodies;
  bodyDescriptors.ropeColumns = ropeColumns;
  return actualBodies;
}

// body IDを使うDistanceJoint descriptorを登録し、GPU adjacencyとlambda recordを作ります
// body配列順やCPU PhysicsNode参照を渡さず、Compute専用の明示ID契約を使います
function registerJoints() {
  // body IDとlocal anchorをGPU bufferへ登録します。local anchorは各body中心からの値なので、
  // bodyが回転したときもsolverが現在orientationでworld anchorへ変換できます
  jointRecords = [];
  const addDistanceJoint = (bodyAId, bodyBId, localAnchorA, localAnchorB, distance) => {
    // compliance=0は硬い距離拘束、positionCorrectionSlopは極小誤差を許容する閾値です
    // collideConnected=falseにより、隣接linkやpivotとの接触反力ではなくJointだけでchainを接続します
    const descriptor = {
      type: "DistanceJoint",
      bodyAId,
      bodyBId,
      localAnchorA: [...localAnchorA],
      localAnchorB: [...localAnchorB],
      distance,
      compliance: 0.0,
      positionCorrectionSlop: 0.0001,
      collideConnected: false
    };
    const id = physics.addJoint(descriptor);
    jointRecords.push({ id, ...descriptor });
  };

  addDistanceJoint(
    PENDULUM_PIVOT_ID,
    PENDULUM_WEIGHT_ID,
    [0.0, 0.0, 0.0],
    [0.0, 0.0, 0.0],
    PENDULUM_DISTANCE
  );
  for (const column of bodyDescriptors.ropeColumns) {
    let previousBodyId = column.__ropePivotId;
    for (let index = 0; index < column.__ropeLinks.length; index++) {
      const bodyId = column.__ropeLinks[index];
      addDistanceJoint(
        previousBodyId,
        bodyId,
        index === 0
          ? [0.0, -ROPE_TOP_ANCHOR_OFFSET, 0.0]
          : [0.0, -ROPE_LINK_ANCHOR, 0.0],
        [0.0, ROPE_LINK_ANCHOR, 0.0],
        ROPE_ANCHOR_GAP
      );
      previousBodyId = bodyId;
    }
  }
}

// 初期bodyを作り、reset時も同じID・slot・Joint構成を再生成します
// setBodies()がJointを破棄するため、body初期化とJoint登録を一組で実行します
function resetPhysicsScene() {
  // setBodies()後はJoint登録もやり直す必要があるため、body配列とJoint配列を同じ関数で再構築します
  // IDとslotの対応はcreateBodyDescriptors()の追加順で再び同じになります
  const bodies = createBodyDescriptors();
  physics.setBodies(bodies);
  registerJoints();
  crossingController = new ComputeKinematicController({
    physicsSpace: physics,
    bodyId: CROSSING_CAPSULE_ID,
    startPosition: [CROSSING_CAPSULE_START_X, CROSSING_CAPSULE_Y, CROSSING_CAPSULE_Z],
    endPosition: [CROSSING_CAPSULE_END_X, CROSSING_CAPSULE_Y, CROSSING_CAPSULE_Z],
    speed: CROSSING_CAPSULE_SPEED
  });
  // 起動時と同じくDキーを押した状態にし、最初のfixed stepから右へ移動させます
  crossingController.setDirection(1);
  simulationTimeSec = 0.0;
  simulationAccumulatorMs = 0.0;
  diagnosticState = null;
  pendulumLastAngleRadians = null;
  pendulumLastAngleTimeSec = null;
  pendulumPreviousDownwardCrossingTimeSec = null;
  pendulumMeasuredPeriodSec = null;
  peakRopeLinearSpeed = 0.0;
  peakRopeAngularSpeed = 0.0;
  maximumJointError = 0.0;
}

// Compute固定stepを一回ずつ記録し、各stepの前にkinematic position commandを更新します
// ComputePhysicsSpace.encode()へframe時間を渡す代わりに、driverの位置処方とstep数を同じループへ置きます
function encodeSimulation(encoder, deltaMs) {
  // frameのdeltaをaccumulatorへ蓄積し、物理は常に120Hzのfixed stepで進めます
  // encodeFixedStep()はGPU commandを記録するだけなので、ここではsubmitせず、start()側でrenderとまとめます
  simulationAccumulatorMs += deltaMs;
  let steps = 0;
  while (simulationAccumulatorMs >= FIXED_TIME_STEP_MS && steps < MAX_SUB_STEPS) {
    // driver commandを先に記録し、その直後のCompute fixed stepが同じ位置を接触判定へ使います
    crossingController.updateFixedStep();
    physics.encodeFixedStep(encoder);
    simulationAccumulatorMs -= FIXED_TIME_STEP_MS;
    simulationTimeSec += FIXED_TIME_STEP_SEC;
    steps += 1;
  }
  return steps;
}

// state readbackのslotからBodyStateの位置・姿勢を読み、Joint anchorをworld座標へ変換します
// Compute描画はreadbackへ依存せず、ここは周期・速度・誤差の明示的な診断だけで使います
function readBodyState(stateData, bodyId) {
  // readback配列のoffset計算やlayout解釈はComputePhysicsSpaceへ任せ、sampleはbody IDだけを指定します
  return physics.readBodyStateFromReadback(bodyId, stateData);
}

// DistanceJoint一つのanchor間距離誤差を現在のGPU readbackから計算します
// solverのlambdaを推測せず、各bodyの姿勢でlocal anchorをworldへ回転して実測します
function getJointPositionError(stateData, joint) {
  // Joint bufferのlambdaを読むのではなく、readbackしたbody位置・姿勢から両anchorを再計算します
  // 返す値は目標距離との差の絶対値で、solverがどれだけ拘束を満たしたかを直接表します
  const bodyA = readBodyState(stateData, joint.bodyAId);
  const bodyB = readBodyState(stateData, joint.bodyBId);
  const anchorAOffset = rotateVec3ByQuat(joint.localAnchorA, { q: bodyA.orientation });
  const anchorBOffset = rotateVec3ByQuat(joint.localAnchorB, { q: bodyB.orientation });
  const anchorA = bodyA.position.map((value, index) => value + anchorAOffset[index]);
  const anchorB = bodyB.position.map((value, index) => value + anchorBOffset[index]);
  const distance = Math.hypot(
    anchorB[0] - anchorA[0],
    anchorB[1] - anchorA[1],
    anchorB[2] - anchorA[2]
  );
  return Math.abs(distance - joint.distance);
}

// GPU readback一回分から振り子周期、ロープ速度、Joint誤差を更新します
// 読み出したsimulation時刻を使い、画面frame時刻と固定step時刻を区別します
function analyzeReadback(stateData, stateTimeSec) {
  // readbackは描画経路ではなく診断経路です。ここで得た値をGPU bodyへ書き戻さないため、
  // 計測処理は物理結果を読み取り専用で扱います
  const pendulumPivot = readBodyState(stateData, PENDULUM_PIVOT_ID);
  const pendulumWeight = readBodyState(stateData, PENDULUM_WEIGHT_ID);
  const angle = Math.atan2(
    pendulumWeight.position[0] - pendulumPivot.position[0],
    -(pendulumWeight.position[1] - pendulumPivot.position[1])
  );
  if (
    pendulumLastAngleRadians !== null
    && pendulumLastAngleTimeSec !== null
    && pendulumLastAngleRadians > 0.0
    && angle <= 0.0
  ) {
    const angleSpan = pendulumLastAngleRadians - angle;
    const interpolation = pendulumLastAngleRadians / angleSpan;
    const crossingTimeSec = pendulumLastAngleTimeSec
      + (stateTimeSec - pendulumLastAngleTimeSec) * interpolation;
    if (pendulumPreviousDownwardCrossingTimeSec !== null) {
      pendulumMeasuredPeriodSec = crossingTimeSec - pendulumPreviousDownwardCrossingTimeSec;
    }
    pendulumPreviousDownwardCrossingTimeSec = crossingTimeSec;
  }
  pendulumLastAngleRadians = angle;
  pendulumLastAngleTimeSec = stateTimeSec;

  let currentLinearSpeed = 0.0;
  let currentAngularSpeed = 0.0;
  for (const bodyId of ropeBodyIds) {
    const state = readBodyState(stateData, bodyId);
    currentLinearSpeed = Math.max(currentLinearSpeed, Math.hypot(...state.linearVelocity));
    currentAngularSpeed = Math.max(currentAngularSpeed, Math.hypot(...state.angularVelocity));
  }
  peakRopeLinearSpeed = Math.max(peakRopeLinearSpeed, currentLinearSpeed);
  peakRopeAngularSpeed = Math.max(peakRopeAngularSpeed, currentAngularSpeed);
  maximumJointError = 0.0;
  for (const joint of jointRecords) {
    maximumJointError = Math.max(maximumJointError, getJointPositionError(stateData, joint));
  }
  diagnosticState = {
    stateTimeSec,
    currentLinearSpeed,
    currentAngularSpeed,
    pendulumWeight,
    driver: readBodyState(stateData, CROSSING_CAPSULE_ID)
  };
}

// GPU stateを定期的にreadbackして診断値へ変換します
// MAP_READ bufferが使用中の間は次のcopyを待機し、非同期readbackを通常描画と分けます
class ComputeJointReadback {
  // PhysicsSpaceが作る明示的なstate readback bufferを準備します
  constructor(physicsSpace) {
    this.physicsSpace = physicsSpace;
    this.buffer = physicsSpace.createStateReadbackBuffer();
    this.pending = false;
    this.mapStarted = false;
    this.pendingTimeSec = 0.0;
    this.error = null;
  }

  // 現在のRender frameでstate copyを記録し、submit後の時刻を保持します
  // MAP_READ bufferが前回のmapAsync中ならcopyを重ねず、GPU commandの記録とCPU readbackを分離します
  encode(encoder, stateTimeSec) {
    if (this.pending) return false;
    this.physicsSpace.encodeStateReadback(encoder, this.buffer);
    this.pending = true;
    this.pendingTimeSec = stateTimeSec;
    return true;
  }

  // submit後にmapAsyncを開始し、完了したFloat32Arrayだけを診断処理へ渡します
  // resolveAfterSubmit()はsubmit後に呼び、完了したbufferを次の計測へ再利用します
  resolveAfterSubmit() {
    if (!this.pending || this.mapStarted) return;
    this.mapStarted = true;
    this.physicsSpace.readStateReadback(this.buffer).then((data) => {
      analyzeReadback(data, this.pendingTimeSec);
      this.pending = false;
      this.mapStarted = false;
    }).catch((error) => {
      this.error = error;
      this.pending = false;
      this.mapStarted = false;
      console.error("joint_compute state readback failed:", error);
    });
  }

  // readback bufferを破棄し、GPU描画用のstate bufferはPhysicsSpace側へ残します
  destroy() {
    this.buffer.destroy();
  }
}

// Compute Jointの動作、GPU直接描画、選択的readbackの状態をHelp Panelの行へ変換します
// HUDへ文字を描かず、起動時はHelp Panelを表示したまま本文だけを折り畳みます
function buildHelpLines() {
  // GPU直接描画の見た目に加えて、Joint誤差とreadback遅延を診断値で確認します
  // そのため物理状態の診断値と、現在の描画経路がGPU直接参照であることを同時に表示します
  const controller = crossingController.getState();
  const prescribedVelocity = controller.prescribedVelocity;
  const measured = pendulumMeasuredPeriodSec === null
    ? "--"
    : `${pendulumMeasuredPeriodSec.toFixed(3)} s`;
  const readbackTime = diagnosticState === null
    ? "--"
    : `${diagnosticState.stateTimeSec.toFixed(2)} s`;
  const driverPosition = diagnosticState?.driver?.position;
  const driverText = driverPosition === undefined
    ? "--"
    : `${driverPosition[0].toFixed(2)}, ${driverPosition[1].toFixed(2)}, ${driverPosition[2].toFixed(2)}`;
  return [
    "joint_compute GPU Joint verification",
    ...(app?.getFrameTimingLines?.() ?? []),
    `state: ${paused ? "paused" : "running"}  simulation: ${simulationTimeSec.toFixed(2)} s  fixed steps: ${physics.getFixedStepCount()}`,
    `GPU bodies: ${physics.getBodyCount()}  GPU joints: ${physics.getJointBuffer().jointCount}  Compute solver: DistanceJoint XPBD`,
    `hanging ropes: ${ROPE_COLUMN_X_POSITIONS.length}  links per rope: ${ROPE_LINK_COUNT}  floor: none`,
    `pendulum length: ${PENDULUM_DISTANCE.toFixed(4)} m  target period: ${PENDULUM_TARGET_PERIOD_SEC.toFixed(3)} s  measured: ${measured}`,
    `crossing Capsule: mode=${controller.mode}  direction=${controller.direction}  prescribed=${Math.hypot(...prescribedVelocity).toFixed(2)} m/s  GPU position=${driverText}`,
    `rope speed current/peak: ${diagnosticState?.currentLinearSpeed?.toFixed(4) ?? "--"} / ${peakRopeLinearSpeed.toFixed(4)} m/s`,
    `rope angular current/peak: ${diagnosticState?.currentAngularSpeed?.toFixed(2) ?? "--"} / ${peakRopeAngularSpeed.toFixed(2)} rad/s`,
    `maximum DistanceJoint error: ${diagnosticState === null ? "--" : maximumJointError.toFixed(5)} m  readback: ${readbackTime}`,
    readback?.error ? `state readback: ERROR ${readback.error.message}` : "state readback: explicit diagnostics only; rendering has no CPU position sync",
    "GPU process: BodyState -> broad phase -> contact solver -> Joint XPBD solver -> direct vertex rendering",
    "colors: blue/purple ropes, pink pendulum Sphere, yellow crossing Capsule, white massless connector",
    "A / D: move the kinematic Capsule left/right through the rope centers",
    "Q: quasiStatic position push   I: impact prescribed velocity",
    "P: pause/resume   R: reset and restart from D direction   H: show/hide Help Panel",
    "Drag: orbit   Wheel: zoom"
  ];
}

// Help Panelを一度生成し、折り畳み状態を保ったまま本文だけを更新します
function updateHelpPanel(initial = false) {
  // 初回だけPanelを生成し、その後は本文が変化した時だけ既存DOMを更新します
  // Helpの更新頻度を抑えても、物理Compute passやRender passの記録順を維持します
  const lines = buildHelpLines();
  const text = lines.join("\n");
  if (initial) {
    app.showOverlayPanel(buildHelpPanelOptions({
      id: "computeJointHelp",
      title: "Help",
      collapsed: true,
      anchor: "top-left",
      collapseLabelExpanded: "Hide Panel",
      collapseLabelCollapsed: "Show Panel",
      maxWidth: "720px",
      lines
    }));
    lastHelpText = text;
    return;
  }
  if (text === lastHelpText) return;
  const panel = app.getOverlayPanel("computeJointHelp");
  if (!panel) return;
  panel.options.lines = lines;
  panel.options.text = text;
  panel.bodyEl.textContent = text;
  lastHelpText = text;
}

// Help Panel全体の表示状態をHキーで切り替え、表示時は説明本文も開く
// 起動時はパネルの見出しを表示し、本文は折り畳んだ状態から開始します
function toggleHelpPanel() {
  // Panelの表示切替はUIだけの処理です。非表示でもCompute fixed stepやreadbackの計測を継続します
  const panel = app?.getOverlayPanel?.("computeJointHelp");
  if (!panel) return;
  if (panel.options.visible === true) {
    panel.hide();
    return;
  }
  panel.setCollapsed(false);
  panel.show();
}

// canvasのCSS pixel寸法をScreenへ渡し、depth textureを同じ大きさへ更新します
function resizeViewport() {
  // CSS pixelの画面サイズをScreenへ渡し、GPU depth textureと描画先の寸法を一致させます
  screen.resize(Math.max(1, window.innerWidth), Math.max(1, window.innerHeight));
}

// keyboard actionをcontroller、pause、reset、Help Panelへ振り分けます
function applyAction(key, event) {
  // 入力イベントを物理controller、simulation pause/reset、Help表示へ振り分けます
  // A/Dはfixed step前のposition commandだけを変え、Q/Iは接触solverへ渡す速度の意味だけを変えます
  const normalized = String(key).toLowerCase();
  if (normalized === "a") {
    crossingController.setDirection(-1);
    event?.preventDefault();
  } else if (normalized === "d") {
    crossingController.setDirection(1);
    event?.preventDefault();
  } else if (normalized === "q") {
    crossingController.setMode("quasiStatic");
    event?.preventDefault();
  } else if (normalized === "i") {
    crossingController.setMode("impact");
    event?.preventDefault();
  } else if (normalized === "p" || key === " ") {
    paused = !paused;
    event?.preventDefault();
  } else if (normalized === "r") {
    resetPhysicsScene();
    paused = false;
    event?.preventDefault();
  } else if (normalized === "h") {
    toggleHelpPanel();
    event?.preventDefault();
  } else {
    return;
  }
  updateHelpPanel();
}

// WebgApp、ComputePhysicsSpace、GPU renderer、readbackを初期化してsimulationを開始します
// Compute commandのencodeとRender passのencodeを一つのcommand encoderへまとめ、submitはここで一度だけ行います
async function start() {
  // Compute版はWebgAppの通常drawを使わず、同じcommand encoderへ
  // Compute physics、必要な診断readback、GPU直接Render passの順に記録します
  // 最後のsubmitまでGPU stateをCPUへ戻さず、Node同期から独立して描画します
  app = new WebgApp({
    document,
    computeFrame: true,
    autoDrawScene: false,
    clearColor: CLEAR_COLOR,
    viewAngle: 40.0,
    projectionNear: 0.02,
    projectionFar: 30.0,
    messageFontTexture: FONT_FILE,
    camera: {
      target: CAMERA.target,
      distance: CAMERA.distance,
      yaw: CAMERA.yaw,
      pitch: CAMERA.pitch,
      roll: CAMERA.roll
    },
    debugTools: {
      mode: "release",
      system: "joint_compute",
      source: "samples/joint/joint_compute.js"
    }
  });
  await app.init();
  screen = app.screen;
  resizeViewport();
  window.addEventListener("resize", resizeViewport);
  window.addEventListener("orientationchange", resizeViewport);
  app.createOrbitEyeRig(CAMERA);

  const sphereShape = new Shape(app.getGPU());
  sphereShape.applyPrimitiveAsset(Primitive.sphere(1.0, 20, 16));
  sphereShape.endShape();
  const capsuleShape = new Shape(app.getGPU());
  capsuleShape.applyPrimitiveAsset(Primitive.capsule(1.0, 1.0, 12, 24));
  capsuleShape.endShape();
  const connectorShape = new Shape(app.getGPU());
  connectorShape.applyPrimitiveAsset(Primitive.capsule(1.0, 1.0, 10, 20));
  connectorShape.endShape();

  const initialBodies = createBodyDescriptors();
  physics = new ComputePhysicsSpace(app.getGPU(), {
    label: "compute-joint-space",
    maxBodies: 80,
    maxJoints: 80,
    maxJointsPerBody: 4,
    bodies: initialBodies,
    planes: [],
    bounds: { minX: -4.0, maxX: 4.0, minZ: -2.8, maxZ: 2.8 },
    gravity: GRAVITY,
    fixedTimeStepMs: FIXED_TIME_STEP_MS,
    maxSubSteps: MAX_SUB_STEPS,
    solverIterations: 10,
    // Joint slotの偶奇を分けたGPU passを16回ずつ実行し、CPU版の逐次Joint反復に近い収束を確保します
    jointSolverIterations: 16,
    persistentSleep: true,
    scale: { referenceLength: 0.08 }
  });
  registerJoints();

  renderer = new ComputeJointRenderer(app.getGPU(), {
    format: app.getGPU().format,
    sphereShape,
    capsuleShape,
    connectorShape,
    stateBuffers: physics.getStateBuffers()
  });
  readback = new ComputeJointReadback(physics);
  crossingController = new ComputeKinematicController({
    physicsSpace: physics,
    bodyId: CROSSING_CAPSULE_ID,
    startPosition: [CROSSING_CAPSULE_START_X, CROSSING_CAPSULE_Y, CROSSING_CAPSULE_Z],
    endPosition: [CROSSING_CAPSULE_END_X, CROSSING_CAPSULE_Y, CROSSING_CAPSULE_Z],
    speed: CROSSING_CAPSULE_SPEED
  });
  // 起動時はDキーを押した状態にし、最初のfixed stepからdriverを右へ移動させます
  crossingController.setDirection(1);
  updateHelpPanel(true);

  app.attachInput({
    onKeyDown: (key, event) => {
      if (event.repeat && !["a", "d"].includes(key)) return;
      applyAction(key, event);
    },
    onKeyUp: (key, event) => {
      if (key === "a" || key === "d") event.preventDefault();
    }
  });

  app.start({
    onUpdate: ({ timeMs }) => {
      if (timeMs - lastHelpUpdateMs >= 250.0) {
        updateHelpPanel();
        lastHelpUpdateMs = timeMs;
      }
    },
    onComputeFrame: ({ deltaSec }) => {
      // 1 frameの中で、fixed stepの物理command、カメラuniform、直接描画、
      // 8 frameに1回の診断copyを同じencoderへ積み、最後に一度だけsubmitします
      frameNumber += 1;
      const encoder = app.getGPU().device.createCommandEncoder({ label: "compute-joint:frame" });
      if (!paused) encodeSimulation(encoder, deltaSec * 1000.0);
      app.eye.setWorldMatrix();
      const view = new Matrix();
      view.makeView(app.eye.worldMatrix);
      const pivotSlot = physics.getBodyInfo(PENDULUM_PIVOT_ID).slot;
      const weightSlot = physics.getBodyInfo(PENDULUM_WEIGHT_ID).slot;
      renderer.writeCamera(app.projectionMatrix, view, { pivot: pivotSlot, weight: weightSlot });
      renderer.encode(
        encoder,
        physics.getRenderState(),
        app.getGPU().context.getCurrentTexture().createView(),
        screen.getGPU().depthView
      );
      if (frameNumber % 8 === 1) {
        readback.encode(encoder, simulationTimeSec);
      }
      app.getGPU().queue.submit([encoder.finish()]);
      readback.resolveAfterSubmit();
    }
  });

  window.addEventListener("pagehide", () => {
    app.stop();
    readback?.destroy();
    renderer?.destroy();
    physics?.destroy();
    sphereShape.destroy();
    capsuleShape.destroy();
    connectorShape.destroy();
  }, { once: true });
}

// DOM解析後に初期化を開始し、初期化例外を画面へ明示します
// 初期化失敗時に別の物理方式へ切り替えるfallbackは作らず、原因をconsoleとError Panelへ残します
document.addEventListener("DOMContentLoaded", () => {
  start().catch((error) => {
    console.error("joint_compute failed:", error);
    app?.showOverlayPanel?.(buildErrorPanelOptions(error, {
      title: "joint_compute failed",
      id: "compute-joint-error"
    }));
  });
});
