// ---------------------------------------------
//  samples/joint/joint_compute_node.js  2026/09/07
//   Compute Joint dynamics with CPU-side Node synchronization
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
  PENDULUM_ANGULAR_DAMPING,
  PENDULUM_CONNECTOR_RADIUS,
  PENDULUM_CONNECTOR_SEGMENT_LENGTH,
  PENDULUM_DISTANCE,
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
  ROPE_TOP_PIVOT_Y,
  createQuatFromArray,
  createQuaternionFromUpDirection
} from "./jointScenario.js";
import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";
import ComputePhysicsSpace from "../../webg/ComputePhysicsSpace.js";
import ComputeSphereCollider from "../../webg/ComputeSphereCollider.js";
import ComputeCapsuleCollider from "../../webg/ComputeCapsuleCollider.js";
import { rotateVec3ByQuat } from "../../webg/JointMath.js";
import {
  buildErrorPanelOptions,
  buildHelpPanelOptions
} from "../../webg/OverlayPanelPresets.js";

const FONT_FILE = "../../webg/font512.png";
const CLEAR_COLOR = [0.012, 0.026, 0.036, 1.0];

// joint_computeの青／紫、桃、黄、白と区別するNode描画用の配色です
const COLORS = Object.freeze({
  pendulumPivot: [1.0, 0.54, 0.08, 1.0],
  pendulumWeight: [0.98, 0.16, 0.14, 1.0],
  ropePivot: [0.98, 0.68, 0.12, 1.0],
  ropeEven: [0.10, 0.78, 0.42, 1.0],
  ropeOdd: [0.62, 0.90, 0.18, 1.0],
  crossing: [0.08, 0.82, 0.94, 1.0],
  connector: [0.96, 0.90, 0.58, 1.0]
});

// Compute physicsのGPU stateと、readback後に姿勢を反映するCPU Nodeを別々に保持します
let app = null;
let physics = null;
let readbackBuffer = null;
let sceneRecords = null;
let nodeBindings = [];
let nodesByBodyId = new Map();
let connectorNode = null;
let crossingController = null;
let jointRecords = [];
let ropeBodyIds = [];
let paused = false;
let simulationTimeSec = 0.0;
let simulationAccumulatorMs = 0.0;
let resetEpoch = 0;
let lastHelpText = "";
let lastHelpUpdateMs = -Infinity;

const readbackState = {
  copyRecorded: false,
  pending: null,
  timeSec: 0.0,
  error: null
};

let pendulumLastAngleRadians = null;
let pendulumLastAngleTimeSec = null;
let pendulumPreviousDownwardCrossingTimeSec = null;
let pendulumMeasuredPeriodSec = null;
let peakRopeLinearSpeed = 0.0;
let peakRopeAngularSpeed = 0.0;
let maximumJointError = 0.0;
let latestState = null;

// CPU側のShapeはCompute bodyのColliderとは独立して作り、通常のSpace.drawへ渡します
function createShape(kind, radius, segmentLength, color) {
  // このsampleの物理形状はComputePhysicsSpace内のCollider、画面形状は通常のShapeです
  // 両者を同じ寸法で作り、Shapeは描画NodeとしてGPU物理から分離します
  const shape = new Shape(app.getGPU());
  if (kind === "sphere") {
    shape.applyPrimitiveAsset(Primitive.sphere(radius, 20, 16));
  } else if (kind === "capsule") {
    shape.applyPrimitiveAsset(Primitive.capsule(radius, segmentLength, 10, 20));
  } else {
    throw new Error(`joint_compute_node unsupported visual shape: ${kind}`);
  }
  shape.endShape();
  shape.setShader(app.shader);
  shape.setMaterial("smooth-shader", {
    has_bone: 0,
    use_texture: 0,
    color: [...color],
    ambient: 0.38,
    specular: 0.78,
    power: 44.0
  });
  return shape;
}

// kinematic driverの移動をCompute fixed stepへ適用します
// quasiStaticではteleportと速度0、impactでは同じ位置処方と処方速度をGPUへ渡します
class ComputeKinematicController {
  // body IDと直線経路を検証し、GPU commandへ変換する状態を初期化します
  // Node版でも移動の正解値はCPU Nodeの位置ではなく、GPU bodyへ送るposition commandです
  // Nodeはreadback完了後に更新されるため、controllerとNodeはreadback世代で対応付けます
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
  // quasiStaticの接触速度0は「位置を動かさない」という意味ではなく、位置処方による押し退けだけを
  // contact solverへ渡す指定です。impactでは処方速度も渡すため、接触側へ運動量を与えます
  setMode(mode) {
    if (mode !== "quasiStatic" && mode !== "impact") {
      throw new Error(`ComputeKinematicController unsupported mode: ${mode}`);
    }
    this.mode = mode;
    return this;
  }

  // A/D入力から左、停止、右の方向を設定します
  // directionは次のfixed stepで参照される入力状態であり、位置更新は次のsolver stepで行います
  setDirection(direction) {
    if (!Number.isInteger(direction) || direction < -1 || direction > 1) {
      throw new Error("ComputeKinematicController direction must be -1, 0, or 1");
    }
    this.direction = direction;
    return this;
  }

  // 現在のdriver移動速度を返し、Help Panelの処方速度表示へ使います
  // GPUが計算した速度ではなく、経路方向と設定speedから作る外部入力値です
  getPrescribedVelocity() {
    if (this.direction === 0) return [0.0, 0.0, 0.0];
    return this.pathDirection.map((value) => value * this.speed * this.direction);
  }

  // 現在の進行方向とmodeを返し、入力状態の表示を同じcontrollerから作ります
  // Help PanelがNode readbackの遅延した位置と、最新入力のmode/directionを混同しないために使います
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
  // 位置を前回のNodeやreadbackから推定せず、controllerが保持する始点と距離から毎回再計算します
  getPosition() {
    return this.startPosition.map(
      (value, index) => value + this.pathDirection[index] * this.travelDistance
    );
  }

  // reset用の初期位置へ戻し、次のfixed stepから停止状態をGPUへ渡します
  // readback待ちのNodeはresetSimulation()側でも初期位置へ戻し、GPUとCPUの表示が一時的に別の実験を
  // 表さないようにします
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
  // 先に端点判定を行い、止まったstepではmoving=falseとして接触速度も0にします
  // encodeFixedStep()の前に呼ぶことで、このcommandが同じstepの接触判定へ使われます
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

// SphereのCompute body descriptorとCPU Node用の表示recordを同じ初期値から作ります
// 物理側のColliderと表示側のPrimitiveへ同じradiusを渡し、readback後も形状の寸法を一致させます
function makeSphereBody(records, options) {
  // GPU body descriptorとCPU Nodeのvisual recordを別々に持ちます
  // 同じ初期値を複製するだけで、readback前のNode描画とGPU物理の入力を同じシナリオから作れます
  const orientation = [...(options.orientation ?? [1.0, 0.0, 0.0, 0.0])];
  records.bodies.push({
    id: options.id,
    bodyType: options.bodyType,
    position: [...options.position],
    orientation,
    linearVelocity: [0.0, 0.0, 0.0],
    angularVelocity: [0.0, 0.0, 0.0],
    collider: new ComputeSphereCollider(options.radius),
    mass: options.mass ?? 1.0,
    gravityScale: options.gravityScale ?? 1.0,
    allowSleep: options.allowSleep ?? true,
    collisionLayer: options.collisionLayer,
    collisionMask: options.collisionMask,
    fixedRotation: options.fixedRotation ?? false,
    material: options.material,
    color: [...options.color]
  });
  records.visuals.push({
    bodyId: options.id,
    name: options.name,
    kind: "sphere",
    radius: options.radius,
    segmentLength: 0.0,
    position: [...options.position],
    orientation,
    color: [...options.color]
  });
}

// CapsuleのCompute body descriptorとCPU Node用の表示recordを同じ初期値から作ります
// segmentLengthを芯線長として物理Colliderと表示Primitiveへ渡し、見た目と接触形状を一致させます
function makeCapsuleBody(records, options) {
  // Capsuleの芯線長、半径、初期姿勢を物理Colliderとvisual recordの両方へ保存します
  // Compute bodyの姿勢はGPUが更新し、visual recordの姿勢はNode生成時の初期値としてだけ使います
  const orientation = [...(options.orientation ?? [1.0, 0.0, 0.0, 0.0])];
  records.bodies.push({
    id: options.id,
    bodyType: options.bodyType,
    position: [...options.position],
    orientation,
    linearVelocity: [0.0, 0.0, 0.0],
    angularVelocity: [0.0, 0.0, 0.0],
    collider: new ComputeCapsuleCollider(options.radius, options.segmentLength),
    mass: options.mass ?? 1.0,
    gravityScale: options.gravityScale ?? 1.0,
    allowSleep: options.allowSleep ?? true,
    collisionLayer: options.collisionLayer,
    collisionMask: options.collisionMask,
    fixedRotation: options.fixedRotation ?? false,
    material: options.material,
    color: [...options.color]
  });
  records.visuals.push({
    bodyId: options.id,
    name: options.name,
    kind: "capsule",
    radius: options.radius,
    segmentLength: options.segmentLength,
    position: [...options.position],
    orientation,
    color: [...options.color]
  });
}

// Compute版のbody ID・slot・Joint構成と、CPU Nodeへ割り当てる見た目を同じ初期記録から作ります
// body配列はGPUへ渡し、visuals配列はreadback後のNode同期に使うため、二つの配列を同時に構築します
function createSceneRecords() {
  // ここではまだGPUへ登録せず、body descriptor、Node表示情報、Joint接続用IDを一つの記録へまとめます
  // 実際のGPU登録はstart()またはresetSimulation()で行い、reset時にも同じ初期構成を再利用します
  const records = { bodies: [], visuals: [], ropeColumns: [], ropeBodyIds: [] };
  // CPU Node版とGPU Compute版で同じ質量・接触・減衰条件を記録します
  const material = (linearDamping, angularDamping) => ({
    restitution: 0.0,
    friction: 0.0,
    linearDamping,
    angularDamping
  });

  makeSphereBody(records, {
    id: PENDULUM_PIVOT_ID,
    name: "pendulum_pivot",
    position: PENDULUM_PIVOT_POSITION,
    radius: 0.025,
    bodyType: "static",
    collisionLayer: 8,
    collisionMask: 0,
    material: material(0.0, 0.0),
    color: COLORS.pendulumPivot
  });
  makeSphereBody(records, {
    id: PENDULUM_WEIGHT_ID,
    name: "pendulum_weight",
    position: PENDULUM_WEIGHT_POSITION,
    radius: PENDULUM_WEIGHT_RADIUS,
    bodyType: "dynamic",
    mass: 1.0,
    gravityScale: 1.0,
    allowSleep: false,
    collisionLayer: 8,
    collisionMask: 0,
    material: material(PENDULUM_LINEAR_DAMPING, PENDULUM_ANGULAR_DAMPING),
    color: COLORS.pendulumWeight
  });

  for (let columnIndex = 0; columnIndex < ROPE_COLUMN_X_POSITIONS.length; columnIndex++) {
    const x = ROPE_COLUMN_X_POSITIONS[columnIndex];
    const z = ROPE_COLUMN_Z_POSITIONS[columnIndex];
    const pivotId = ROPE_PIVOT_ID_BASE + columnIndex;
    const linkIds = [];
    makeSphereBody(records, {
      id: pivotId,
      name: `rope_${columnIndex}_pivot`,
      position: [x, ROPE_TOP_PIVOT_Y, z],
      radius: ROPE_TOP_PIVOT_RADIUS,
      bodyType: "static",
      collisionLayer: 2,
      collisionMask: 0,
      material: material(0.0, 0.0),
      color: COLORS.ropePivot
    });
    for (let index = 0; index < ROPE_LINK_COUNT; index++) {
      // 初期位置はJoint anchorが指定する見かけのgapと一致するように計算します
      // ここで物体の全長を間隔として使うと、初期状態からJoint誤差が生じてchain全体が動き始めます
      const centerY = ROPE_TOP_PIVOT_Y - ROPE_TOP_ANCHOR_OFFSET
        - ROPE_LINK_ANCHOR - ROPE_ANCHOR_GAP
        - index * (ROPE_LINK_ANCHOR * 2.0 + ROPE_ANCHOR_GAP);
      const id = ROPE_LINK_ID_BASE + columnIndex * ROPE_LINK_COUNT + index;
      makeCapsuleBody(records, {
        id,
        name: `rope_${columnIndex}_link_${index}`,
        position: [x, centerY, z],
        radius: ROPE_LINK_RADIUS,
        segmentLength: ROPE_LINK_SEGMENT_LENGTH,
        bodyType: "dynamic",
        mass: ROPE_LINK_MASS,
        gravityScale: 1.0,
        allowSleep: true,
        collisionLayer: 2,
        collisionMask: 4,
        material: material(ROPE_LINK_LINEAR_DAMPING, ROPE_LINK_ANGULAR_DAMPING),
        color: columnIndex % 2 === 0 ? COLORS.ropeEven : COLORS.ropeOdd
      });
      linkIds.push(id);
      records.ropeBodyIds.push(id);
    }
    records.ropeColumns.push({ pivotId, linkIds });
  }

  makeCapsuleBody(records, {
    id: CROSSING_CAPSULE_ID,
    name: "crossing_capsule",
    position: [CROSSING_CAPSULE_START_X, CROSSING_CAPSULE_Y, CROSSING_CAPSULE_Z],
    orientation: CROSSING_CAPSULE_ORIENTATION,
    radius: CROSSING_CAPSULE_RADIUS,
    segmentLength: CROSSING_CAPSULE_SEGMENT_LENGTH,
    bodyType: "kinematic",
    mass: 8.0,
    gravityScale: 0.0,
    allowSleep: false,
    fixedRotation: true,
    collisionLayer: 4,
    collisionMask: 2,
    material: material(0.0, 0.0),
    color: COLORS.crossing
  });
  return records;
}

// body ID参照のDistanceJointをComputePhysicsSpaceへ登録し、readback診断にも同じ記録を使います
// body配列順やCPU PhysicsNode参照を渡さず、Compute専用の明示ID契約を使います
function registerJoints(records) {
  // Compute版ではJointへPhysicsNode参照を渡さず、固定body IDとlocal anchorを渡します
  // GPU solverはbody IDからslotを解決し、各bodyの現在姿勢でlocal anchorをworld位置へ変換します
  jointRecords = [];
  // body IDとlocal anchorを明示したDistanceJoint descriptorをGPUへ登録します
  const addDistanceJoint = (bodyAId, bodyBId, localAnchorA, localAnchorB, distance) => {
    // compliance=0のDistanceJointを使い、anchor間の目標距離を硬い位置拘束として登録します
    // collideConnected=falseは、接続body間の接触を別に発生させず、Jointの拘束だけを残す指定です
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

  addDistanceJoint(PENDULUM_PIVOT_ID, PENDULUM_WEIGHT_ID,
    [0.0, 0.0, 0.0], [0.0, 0.0, 0.0], PENDULUM_DISTANCE);
  for (const column of records.ropeColumns) {
    let previousBodyId = column.pivotId;
    for (let index = 0; index < column.linkIds.length; index++) {
      addDistanceJoint(
        previousBodyId,
        column.linkIds[index],
        index === 0 ? [0.0, -ROPE_TOP_ANCHOR_OFFSET, 0.0] : [0.0, -ROPE_LINK_ANCHOR, 0.0],
        [0.0, ROPE_LINK_ANCHOR, 0.0],
        ROPE_ANCHOR_GAP
      );
      previousBodyId = column.linkIds[index];
    }
  }
}

// 通常のNodeへShapeを付け、Compute bodyとは別のCPU描画シーングラフを構築します
function createNodes(visuals) {
  // GPU物理のbody slotとは別に、通常のSpaceへ描画用Nodeを構築します
  // nodeBindingsがbody IDをキーにするため、readback配列のslot順やNode追加順が変わっても同期先を特定できます
  nodeBindings = [];
  nodesByBodyId = new Map();
  // Compute bodyのslot順とは独立に、通常のSpaceへ描画Nodeを一つずつ追加します
  for (const visual of visuals) {
    const node = app.space.addNode(null, visual.name);
    node.setPosition(...visual.position);
    node.setQuat(createQuatFromArray(visual.orientation));
    node.addShape(createShape(
      visual.kind,
      visual.radius,
      visual.segmentLength,
      visual.color
    ));
    nodeBindings.push({ bodyId: visual.bodyId, node });
    nodesByBodyId.set(visual.bodyId, node);
  }
  connectorNode = app.space.addNode(null, "pendulum_connector");
  connectorNode.addShape(createShape(
    "capsule",
    PENDULUM_CONNECTOR_RADIUS,
    PENDULUM_CONNECTOR_SEGMENT_LENGTH,
    COLORS.connector
  ));
  setConnectorPose(PENDULUM_PIVOT_POSITION, PENDULUM_WEIGHT_POSITION);
}

// 二つのJoint anchorの中点へconnector Nodeを置き、local Y軸をanchor間方向へ回転させます
function setConnectorPose(pivot, weight) {
  // readbackしたpivotとweightのworld位置から、質量なしconnectorの中点と姿勢を作ります
  // connectorはNodeとして描くだけで、ComputePhysicsSpaceのbody・Collider・Jointから分離します
  const direction = [
    weight[0] - pivot[0],
    weight[1] - pivot[1],
    weight[2] - pivot[2]
  ];
  connectorNode.setPosition(
    (pivot[0] + weight[0]) * 0.5,
    (pivot[1] + weight[1]) * 0.5,
    (pivot[2] + weight[2]) * 0.5
  );
  connectorNode.setQuat(createQuaternionFromUpDirection(direction));
}

// Compute bodyを初期recordへ戻し、Joint構成とNode表示を同じ初期状態へ復元します
// readback中の古い結果はresetEpochで破棄し、reset後のNodeへ遅れて反映しないようにします
function resetSimulation() {
  // GPU bodyと通常Nodeを同じ初期recordへ戻し、readback中の古い結果をresetEpochで無効にします
  // Joint descriptorも再登録するため、reset後のGPU adjacencyとlambda状態を新しい構成から開始します
  resetEpoch += 1;
  readbackState.copyRecorded = false;
  const nextRecords = createSceneRecords();
  physics.setBodies(nextRecords.bodies);
  registerJoints(nextRecords);
  sceneRecords = nextRecords;
  ropeBodyIds = [...nextRecords.ropeBodyIds];
  for (const visual of nextRecords.visuals) {
    const node = nodesByBodyId.get(visual.bodyId);
    node.setPosition(...visual.position);
    node.setQuat(createQuatFromArray(visual.orientation));
  }
  setConnectorPose(PENDULUM_PIVOT_POSITION, PENDULUM_WEIGHT_POSITION);
  crossingController.reset();
  crossingController.setDirection(1);
  simulationTimeSec = 0.0;
  simulationAccumulatorMs = 0.0;
  readbackState.error = null;
  resetDiagnostics();
}

// 周期、速度、Joint誤差、readback stateを初期化し、reset後の診断を新しい計測として開始します
function resetDiagnostics() {
  // readbackの非同期遅延を含め、reset前の周期・速度・誤差を次の実験へ持ち越さないようにします
  pendulumLastAngleRadians = null;
  pendulumLastAngleTimeSec = null;
  pendulumPreviousDownwardCrossingTimeSec = null;
  pendulumMeasuredPeriodSec = null;
  peakRopeLinearSpeed = 0.0;
  peakRopeAngularSpeed = 0.0;
  maximumJointError = 0.0;
  latestState = null;
}

// fixed step数を決め、各stepの直前にkinematic body commandを追加します
// ComputePhysicsSpace.encodeFixedStep()へframe時間を渡す代わりに、driverの位置処方とstep数を同じループへ置きます
function encodeSimulation(encoder, deltaMs) {
  // frame時間を固定stepへ分配します。CPU Nodeはまだ更新せず、GPU commandだけをここで記録します
  // このsampleのNode表示は後でreadbackが完了した時に更新されるため、物理と描画の時間差があります
  simulationAccumulatorMs += deltaMs;
  let steps = 0;
  while (simulationAccumulatorMs >= FIXED_TIME_STEP_MS && steps < MAX_SUB_STEPS) {
    // driver commandを先に記録し、次のencodeFixedStep()の接触solverがその位置を読む順番を守ります
    crossingController.updateFixedStep();
    physics.encodeFixedStep(encoder);
    simulationAccumulatorMs -= FIXED_TIME_STEP_MS;
    simulationTimeSec += FIXED_TIME_STEP_SEC;
    steps += 1;
  }
}

// state readbackのslotからBodyStateの位置・姿勢を読み、Joint anchorをworld座標へ変換できるrecordを返します
// Compute描画はreadbackへ依存せず、ここはNode同期と周期・速度・誤差の明示的な診断だけで使います
function readBodyState(stateData, bodyId) {
  // readback bufferのlayoutとbody IDからposition/orientation/velocityを解釈する処理はcoreへ任せます
  return physics.readBodyStateFromReadback(bodyId, stateData);
}

// DistanceJoint一つのanchor間距離誤差をreadbackした現在状態から実測します
// solverのlambdaを推測せず、各bodyの姿勢でlocal anchorをworld座標へ回転して比較します
function getJointPositionError(stateData, joint) {
  // GPU solverのlambdaではなく、readbackされた物理状態からanchor間の実距離を計算します
  // Nodeの表示位置ではなくGPU状態を使うため、readback遅延とは独立して誤差を評価します
  const bodyA = readBodyState(stateData, joint.bodyAId);
  const bodyB = readBodyState(stateData, joint.bodyBId);
  const anchorAOffset = rotateVec3ByQuat(joint.localAnchorA, { q: bodyA.orientation });
  const anchorBOffset = rotateVec3ByQuat(joint.localAnchorB, { q: bodyB.orientation });
  const anchorA = bodyA.position.map((value, index) => value + anchorAOffset[index]);
  const anchorB = bodyB.position.map((value, index) => value + anchorBOffset[index]);
  return Math.abs(joint.distance - Math.hypot(
    anchorB[0] - anchorA[0],
    anchorB[1] - anchorA[1],
    anchorB[2] - anchorA[2]
  ));
}

// readbackしたBodyStateを通常Nodeへ反映し、同じCPU値からconnectorと診断値を更新します
function syncNodesAndAnalyze(stateData, stateTimeSec) {
  // 一回のreadback結果を、通常Nodeの姿勢反映、connector更新、周期計測、速度計測へ分配します
  // ここからGPUへ値を書き戻さないため、診断と表示同期を読み取り処理として扱います
  physics.syncNodesFromPhysics(stateData, nodeBindings);
  const pivot = readBodyState(stateData, PENDULUM_PIVOT_ID);
  const weight = readBodyState(stateData, PENDULUM_WEIGHT_ID);
  setConnectorPose(pivot.position, weight.position);

  const angle = Math.atan2(
    weight.position[0] - pivot.position[0],
    -(weight.position[1] - pivot.position[1])
  );
  if (pendulumLastAngleRadians !== null && pendulumLastAngleTimeSec !== null
      && pendulumLastAngleRadians > 0.0 && angle <= 0.0) {
    const span = pendulumLastAngleRadians - angle;
    const crossingTime = pendulumLastAngleTimeSec
      + (stateTimeSec - pendulumLastAngleTimeSec) * (pendulumLastAngleRadians / span);
    if (pendulumPreviousDownwardCrossingTimeSec !== null) {
      pendulumMeasuredPeriodSec = crossingTime - pendulumPreviousDownwardCrossingTimeSec;
    }
    pendulumPreviousDownwardCrossingTimeSec = crossingTime;
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
  maximumJointError = jointRecords.reduce(
    (maximum, joint) => Math.max(maximum, getJointPositionError(stateData, joint)),
    0.0
  );
  latestState = {
    stateTimeSec,
    currentLinearSpeed,
    currentAngularSpeed,
    driver: readBodyState(stateData, CROSSING_CAPSULE_ID)
  };
}

// GPUからのreadbackは描画を止めず、完了した次のframeで通常Nodeへ反映します
function resolveNodeReadbackAfterSubmit() {
  // GPU submit後にだけreadbackを解決し、完了したstateを次のNode表示へ反映します
  // resetEpochが変わっていたら古いmap結果を破棄し、reset後のシーンを保持します
  if (!readbackState.copyRecorded || readbackState.pending) return;
  readbackState.copyRecorded = false;
  const epoch = resetEpoch;
  const stateTimeSec = readbackState.timeSec;
  readbackState.pending = physics.readStateReadback(readbackBuffer)
    .then((stateData) => {
      if (epoch !== resetEpoch) return;
      syncNodesAndAnalyze(stateData, stateTimeSec);
      readbackState.error = null;
    })
    .catch((error) => {
      readbackState.error = error;
      console.error("joint_compute_node state readback failed:", error);
    })
    .finally(() => {
      readbackState.pending = null;
    });
}

// 現在の物理状態、入力状態、readback状態をHelp Panelへ表示する行へ変換します
function buildHelpLines() {
  // GPUの現在値はreadback完了時だけ更新されるため、Node binding数とreadback状態も表示します
  // 「物理が止まった」のか「readbackがまだ届いていない」のかを画面上で区別できるようにします
  const controller = crossingController.getState();
  const speed = Math.hypot(...controller.prescribedVelocity).toFixed(2);
  const measured = pendulumMeasuredPeriodSec === null
    ? "--"
    : `${pendulumMeasuredPeriodSec.toFixed(3)} s`;
  const driverPosition = latestState?.driver?.position;
  const driverText = driverPosition === undefined
    ? "--"
    : `${driverPosition[0].toFixed(2)}, ${driverPosition[1].toFixed(2)}, ${driverPosition[2].toFixed(2)}`;
  return [
    "joint_compute_node CPU Node synchronization",
    ...(app?.getFrameTimingLines?.() ?? []),
    `state: ${paused ? "paused" : "running"}  simulation: ${simulationTimeSec.toFixed(2)} s  fixed steps: ${physics.getFixedStepCount()}`,
    `GPU bodies: ${physics.getBodyCount()}  GPU joints: ${physics.getJointBuffer().jointCount}  solver: DistanceJoint XPBD`,
    `Node bindings: ${nodeBindings.length}  readback: ${readbackState.pending ? "waiting" : "ready"}`,
    `pendulum length: ${PENDULUM_DISTANCE.toFixed(4)} m  target period: ${PENDULUM_TARGET_PERIOD_SEC.toFixed(3)} s  measured: ${measured}`,
    `crossing Capsule: mode=${controller.mode}  direction=${controller.direction}  prescribed=${speed} m/s  Node position=${driverText}`,
    `rope speed current/peak: ${latestState?.currentLinearSpeed?.toFixed(4) ?? "--"} / ${peakRopeLinearSpeed.toFixed(4)} m/s`,
    `rope angular current/peak: ${latestState?.currentAngularSpeed?.toFixed(2) ?? "--"} / ${peakRopeAngularSpeed.toFixed(2)} rad/s`,
    `maximum DistanceJoint error: ${latestState === null ? "--" : maximumJointError.toFixed(5)} m`,
    readbackState.error ? `state readback: ERROR ${readbackState.error.message}` : "GPU BodyState -> readback -> syncNodesFromPhysics -> Space.draw",
    "colors: green/lime ropes, red pendulum Sphere, cyan crossing Capsule, gold connector",
    "A / D: move the kinematic Capsule left/right through the rope centers",
    "Q: quasiStatic position push   I: impact prescribed velocity",
    "P: pause/resume   R: reset and restart from D direction   H: show/hide Help Panel",
    "Drag: orbit   Wheel: zoom"
  ];
}

// Help Panelを生成し、起動時は本文を折り畳んだ状態で表示します
function updateHelpPanel(initial = false) {
  // 起動時はHelpの本文を生成して折り畳み、その後は表示内容が変わった時だけ更新します
  const lines = buildHelpLines();
  const text = lines.join("\n");
  if (initial) {
    // 起動時はタイトルバーを表示し、本文はcollapsed:trueのまま折り畳みます
    app.showOverlayPanel(buildHelpPanelOptions({
      id: "computeJointNodeHelp",
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
  app.updateOverlayPanel("computeJointNodeHelp", { lines });
  lastHelpText = text;
}

// Help Panelの表示状態をHキーで切り替え、表示するときは本文を開きます
function toggleHelpPanel() {
  // Helpの表示状態だけを変更し、GPU物理、readback、Node描画の処理フローを維持します
  const panel = app?.getOverlayPanel?.("computeJointNodeHelp");
  if (!panel) return;
  if (panel.options.visible === true) {
    panel.hide();
  } else {
    panel.setCollapsed(false);
    panel.show();
  }
}

// キー入力をCapsule移動、接触mode、pause、reset、Help Panelへ振り分けます
function applyAction(key, event) {
  const normalized = String(key).toLowerCase();
  if (normalized === "a") {
    crossingController.setDirection(-1);
  } else if (normalized === "d") {
    crossingController.setDirection(1);
  } else if (normalized === "q") {
    crossingController.setMode("quasiStatic");
  } else if (normalized === "i") {
    crossingController.setMode("impact");
  } else if (normalized === "p" || key === " ") {
    paused = !paused;
  } else if (normalized === "r") {
    resetSimulation();
    paused = false;
  } else if (normalized === "h") {
    toggleHelpPanel();
  } else {
    return;
  }
  event?.preventDefault();
  updateHelpPanel();
}

// ComputeをonBeforeDrawへ記録し、標準Space.drawがCPU Nodeを描画する経路を作ります
async function start() {
  // GPU物理の初期化、readback bufferの作成、通常Nodeの構築を順番に行います
  // onBeforeDrawでComputeとreadback copyを記録し、WebgAppのframe末尾submit後に次のonUpdateでNode同期を開始します
  app = new WebgApp({
    document,
    frameTiming: true,
    useMessage: false,
    clearColor: CLEAR_COLOR,
    viewAngle: 40.0,
    projectionNear: 0.02,
    projectionFar: 30.0,
    messageFontTexture: FONT_FILE,
    light: {
      mode: "eye-fixed",
      position: [2.0, 7.0, 6.0, 1.0]
    },
    camera: {
      target: CAMERA.target,
      distance: CAMERA.distance,
      yaw: CAMERA.yaw,
      pitch: CAMERA.pitch,
      roll: CAMERA.roll
    },
    debugTools: {
      mode: "release",
      system: "joint_compute_node",
      source: "samples/joint/joint_compute_node.js"
    }
  });
  await app.init();
  app.createOrbitEyeRig(CAMERA);

  sceneRecords = createSceneRecords();
  ropeBodyIds = [...sceneRecords.ropeBodyIds];
  physics = new ComputePhysicsSpace(app.getGPU(), {
    label: "compute-joint-node-space",
    maxBodies: 80,
    maxJoints: 80,
    maxJointsPerBody: 4,
    bodies: sceneRecords.bodies,
    planes: [],
    bounds: { minX: -4.0, maxX: 4.0, minZ: -2.8, maxZ: 2.8 },
    gravity: GRAVITY,
    fixedTimeStepMs: FIXED_TIME_STEP_MS,
    maxSubSteps: MAX_SUB_STEPS,
    solverIterations: 10,
    jointSolverIterations: 16,
    persistentSleep: true,
    scale: { referenceLength: 0.08 }
  });
  registerJoints(sceneRecords);
  readbackBuffer = physics.createStateReadbackBuffer();
  createNodes(sceneRecords.visuals);

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
      // 前frameのWebgApp.present()がcommandをsubmitした後で、非同期readbackを開始します
      // 同じframeのcommand encoderを再利用せず、FrameTimerのquery resolveとsubmit順序を保ちます
      resolveNodeReadbackAfterSubmit();
      if (timeMs - lastHelpUpdateMs >= 250.0) {
        updateHelpPanel();
        lastHelpUpdateMs = timeMs;
      }
    },
    onBeforeDraw: (context) => {
      // WebgAppが開始した既定Render passを閉じ、同じencoderへCompute fixed stepとreadback copyを記録します
      // 最後にcolorLoadOp:loadでRender passを再開し、通常のSpace.drawを続けられるようにします
      const frameGpu = context.screen.getGPU();
      frameGpu.endPass();
      if (!paused) {
        encodeSimulation(frameGpu.commandEncoder, context.deltaSec * 1000.0);
      }
      if (!readbackState.pending && !readbackState.copyRecorded) {
        physics.encodeStateReadback(frameGpu.commandEncoder, readbackBuffer);
        readbackState.timeSec = simulationTimeSec;
        readbackState.copyRecorded = true;
      }
      context.screen.beginPass({ colorLoadOp: "load", depthClear: false });
    },
    // Node描画後のRender Pass終了、GPU query resolve、queue.submitはWebgAppがframe末尾で実行します
    // sample側はcommand encoderを保持し、FrameTimerとreadback copyを同じcommand bufferへまとめます
  });

  window.addEventListener("pagehide", () => {
    app.stop();
    readbackBuffer?.destroy();
    physics?.destroy();
  }, { once: true });
}

document.addEventListener("DOMContentLoaded", () => {
  start().catch((error) => {
    console.error("joint_compute_node failed:", error);
    app?.showOverlayPanel?.(buildErrorPanelOptions(error, {
      title: "joint_compute_node failed",
      id: "compute-joint-node-error"
    }));
  });
});
