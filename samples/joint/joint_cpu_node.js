// ---------------------------------------------
//  samples/joint/joint_cpu_node.js  2026/08/27
//   CPU Physics Joint dynamics verification sample
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import WebgApp from "../../webg/WebgApp.js";
import {
  CAMERA,
  CROSSING_CAPSULE_DEFAULT_MODE,
  CROSSING_CAPSULE_END_X,
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
  ROPE_LINK_ANGULAR_DAMPING,
  ROPE_LINK_COUNT,
  ROPE_LINK_LINEAR_DAMPING,
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
import CapsuleCollider from "../../webg/CapsuleCollider.js";
import DistanceJoint from "../../webg/DistanceJoint.js";
import PhysicsSpace from "../../webg/PhysicsSpace.js";
import Primitive from "../../webg/Primitive.js";
import Quat from "../../webg/Quat.js";
import Shape from "../../webg/Shape.js";
import SphereCollider from "../../webg/SphereCollider.js";
import util from "../../webg/util.js";
import {
  getWorldAnchor
} from "../../webg/JointMath.js";
import {
  buildErrorPanelOptions,
  buildHelpPanelOptions
} from "../../webg/OverlayPanelPresets.js";

const FONT_FILE = "../../webg/font512.png";
const CLEAR_COLOR = [0.018, 0.030, 0.050, 1.0];
const CAPSULE_HEMISPHERE_SEGMENTS = 10;
const CAPSULE_LONGITUDE_SEGMENTS = 20;

// CPU PhysicsSpaceではJoint descriptorへ渡すlocal anchorを明示的に保持します
const PENDULUM_LOCAL_ANCHOR_A = [0.0, 0.0, 0.0];
const PENDULUM_LOCAL_ANCHOR_B = [0.0, 0.0, 0.0];
let app = null;
let physicsSpace = null;
let dynamicRecords = [];
let ropeRecords = [];
let joints = [];
let crossingBody = null;
let crossingController = null;
let paused = false;
let elapsedMs = 0.0;
let physicsAccumulatorMs = 0.0;
let lastHelpText = "";
let lastHelpUpdateMs = -Infinity;
let pendulumPivot = null;
let pendulumWeight = null;
let pendulumConnectorNode = null;
let pendulumLastAngleRadians = null;
let pendulumLastAngleTimeSec = null;
let pendulumPreviousDownwardCrossingTimeSec = null;
let pendulumMeasuredPeriodSec = null;
let peakRopeLinearSpeed = 0.0;
let peakRopeAngularSpeed = 0.0;
let peakRopeContactPairs = 0;

const MOTION_MODES = ["quasiStatic", "impact"];

// kinematic driverの経路と入力状態を保持し、PhysicsSpaceのfixed stepごとに位置を処方する
// 物理solverはwebgコアへ任せ、このclassはサンプル固有のA/D操作とquasiStatic / impactの速度選択だけを担当する
class KinematicMotionController {
  // kinematic body、始点・終点、速度、接触速度の初期モードを検証して初期化する
  // 移動量はworld座標そのものではなく、経路上の距離travelDistanceで保持します
  // そのためfixed stepの刻みが変わっても、始点から終点までの位置を同じ一次元値から再構成できます
  constructor(options = {}) {
    const opts = util.readPlainObject(options, "KinematicMotionController options", {});
    if (!opts.body || typeof opts.body.isKinematic !== "function") {
      throw new Error("KinematicMotionController body must be a PhysicsNode-like object");
    }
    if (opts.body.isKinematic() !== true) {
      throw new Error("KinematicMotionController body must be kinematic");
    }
    if (typeof opts.body.teleport !== "function"
        || typeof opts.body.setLinearVelocityVec !== "function") {
      throw new Error("KinematicMotionController body must support teleport() and setLinearVelocityVec()");
    }
    this.body = opts.body;
    this.startPosition = util.readVec3(
      opts.startPosition,
      "KinematicMotionController startPosition"
    );
    this.endPosition = util.readVec3(
      opts.endPosition,
      "KinematicMotionController endPosition"
    );
    this.speed = util.readFiniteNumber(
      opts.speed,
      "KinematicMotionController speed",
      { minExclusive: 0.0 }
    );
    this.mode = util.readOptionalEnum(
      opts.mode,
      "KinematicMotionController mode",
      "quasiStatic",
      MOTION_MODES
    );
    this.pathVector = [
      this.endPosition[0] - this.startPosition[0],
      this.endPosition[1] - this.startPosition[1],
      this.endPosition[2] - this.startPosition[2]
    ];
    this.pathLength = Math.hypot(...this.pathVector);
    if (this.pathLength <= 1.0e-8) {
      throw new Error("KinematicMotionController path must have non-zero length");
    }
    this.pathDirection = this.pathVector.map((value) => value / this.pathLength);
    this.travelDistance = 0.0;
    this.direction = 0;
  }

  // quasiStaticまたはimpactを明示的に選び、速度の大きさによる自動切り替えをしない
  // quasiStaticは「位置を指定するが接触速度は渡さない」モード、impactは
  // 「位置の指定に加えて処方速度もcontact solverへ渡す」モードです
  setMode(mode) {
    this.mode = util.readOptionalEnum(
      mode,
      "KinematicMotionController mode",
      this.mode,
      MOTION_MODES
    );
    if (this.mode === "quasiStatic") {
      this.body.setLinearVelocityVec([0.0, 0.0, 0.0]);
    }
    return this;
  }

  // 現在の接触エネルギーモードを返す
  getMode() {
    return this.mode;
  }

  // A/D入力に対応する移動方向を設定し、0以外へ丸めず不正値を例外にする
  setDirection(direction) {
    const numericDirection = util.readFiniteNumber(
      direction,
      "KinematicMotionController direction",
      { integer: true, min: -1, max: 1 }
    );
    this.direction = numericDirection;
    if (this.direction === 0) {
      this.body.setLinearVelocityVec([0.0, 0.0, 0.0]);
    }
    return this;
  }

  // 現在の移動方向を返す
  getDirection() {
    return this.direction;
  }

  // 経路方向へ進む処方速度を返す
  // この速度はbodyを積分して得た速度ではなく、sampleがkinematic bodyへ与える目標速度です
  // quasiStaticでもHelp Panelには表示しますが、実際に接触solverへ渡す値はgetContactVelocity()で0になります
  getPrescribedVelocity() {
    if (this.direction === 0) {
      return [0.0, 0.0, 0.0];
    }
    return this.pathDirection.map((value) => value * this.direction * this.speed);
  }

  // 現在のmodeでcoreのcontact solverへ渡す速度を返す
  // quasiStaticでは位置だけを押し進めて接触速度を0にし、impactでは処方速度を渡す
  // 位置のteleportと接触速度の指定を分けることで、同じCapsule移動でも
  // ゆっくり押し退ける操作と衝突エネルギーを与える操作を比較できます
  getContactVelocity() {
    return this.mode === "impact"
      ? this.getPrescribedVelocity()
      : [0.0, 0.0, 0.0];
  }

  // 始点へbodyを戻し、次のfixed stepから停止した状態にする
  // keepVelocity:falseで直前の衝突速度を消し、wakeUp:trueでreset直後の物理bodyを
  // solverが再び評価できる状態へ戻します
  reset() {
    this.travelDistance = 0.0;
    this.direction = 0;
    this.body.teleport([...this.startPosition], { keepVelocity: false, wakeUp: true });
    this.body.setLinearVelocityVec([0.0, 0.0, 0.0]);
    return this;
  }

  // 一つのfixed stepだけ経路を進め、位置とcontact solver用速度を同じstepへ渡す
  // PhysicsSpace.step()の内部callbackへ依存せず、sample側がstepFixed()の直前に呼ぶ
  // 先にtravelDistanceを端点へclampしてからpositionを作るため、端で停止したstepに
  // 端点を越えた速度を端点速度へそろえます。最後にteleportと速度設定を連続して行い、同じfixed stepの
  // broad phase、接触solver、Joint solverが同じdriver位置を参照するようにします
  updateFixedStep(dtSec) {
    const numericDtSec = util.readFiniteNumber(
      dtSec,
      "KinematicMotionController dtSec",
      { minExclusive: 0.0 }
    );
    if (this.direction !== 0) {
      this.travelDistance += this.direction * this.speed * numericDtSec;
      if (this.travelDistance <= 0.0) {
        this.travelDistance = 0.0;
        this.direction = 0;
      } else if (this.travelDistance >= this.pathLength) {
        this.travelDistance = this.pathLength;
        this.direction = 0;
      }
    }
    const position = this.startPosition.map(
      (value, index) => value + this.pathDirection[index] * this.travelDistance
    );
    this.body.teleport(position, { keepVelocity: false, wakeUp: true });
    this.body.setLinearVelocityVec(this.getContactVelocity());
    return this;
  }
}

// capsule meshへ単色smooth materialを設定し、PhysicsNodeへ追加できるShapeを返す
// Primitive.capsuleとCapsuleColliderへ同じ半径・芯線長を渡し、表示形状と接触形状を一致させる
function createCapsuleShape(gpu, radius, segmentLength, color) {
  const shape = new Shape(gpu);
  shape.applyPrimitiveAsset(Primitive.capsule(
    radius,
    segmentLength,
    CAPSULE_HEMISPHERE_SEGMENTS,
    CAPSULE_LONGITUDE_SEGMENTS
  ));
  shape.endShape();
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

// sphere meshへ単色smooth materialを設定し、振り子のweightへ追加できるShapeを返す
// SphereColliderと同じradiusを使い、短周期で動く振り子の先端を丸いbodyとして表示する
function createSphereShape(gpu, radius, color) {
  const shape = new Shape(gpu);
  shape.applyPrimitiveAsset(Primitive.sphere(radius, 20, 16));
  shape.endShape();
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

// CapsuleのPhysicsNodeを作り、表示Shape・接触Collider・solver登録を一つの初期化処理へまとめる
// dynamic bodyだけをreset用の初期状態へ記録し、kinematic bodyは呼出側のcontrollerで戻す
function createCapsuleBody(scene, name, {
  position,
  radius,
  segmentLength,
  color,
  bodyType = "dynamic",
  mass = 1.0,
  orientation = new Quat(),
  linearVelocity = [0.0, 0.0, 0.0],
  angularVelocity = [0.0, 0.0, 0.0],
  allowSleep = false,
  gravityScale = 1.0,
  fixedRotation = false,
  linearDamping = 0.035,
  angularDamping = 0.08,
  collisionLayer = 1,
  collisionMask = 1,
  restitution = 0.08,
  friction = 0.72
}) {
  // PhysicsNodeを先にPhysicsSpaceへ登録し、その後にColliderと描画Shapeを関連付けます
  // Colliderは接触面と質量特性を決め、Shapeは見た目だけを決めるため、両方へ同じ寸法を渡します
  const body = scene.addPhysicsNode(null, name, {
    bodyType,
    mass,
    collisionLayer,
    collisionMask,
    allowSleep,
    gravityScale,
    fixedRotation,
    linearDamping,
    angularDamping
  });
  body.setCollider(new CapsuleCollider(radius, segmentLength));
  body.setPhysicsMaterial({ restitution, friction });
  if (bodyType === "dynamic") {
    body.teleport(position, { keepVelocity: false, wakeUp: true });
    body.syncNodeFromPhysics(position, { quat: orientation.clone() });
  } else {
    body.setPosition(position[0], position[1], position[2]);
    body.syncNodeFromPhysics(position, { quat: orientation.clone() });
  }
  body.setLinearVelocityVec(linearVelocity);
  body.setAngularVelocityVec(angularVelocity);
  body.addShape(createCapsuleShape(app.getGPU(), radius, segmentLength, color));
  physicsSpace.addBody(body);
  if (bodyType === "dynamic") {
    dynamicRecords.push({
      body,
      shapeType: "capsule",
      position: [...position],
      orientation: orientation.clone(),
      linearVelocity: [...linearVelocity],
      angularVelocity: [...angularVelocity]
    });
  }
  return body;
}

// sphereのPhysicsNodeを作り、振り子のweightやロープrootへ登録できる状態にする
// 球の表示半径とSphereColliderの半径を共通化し、見た目だけが接触面からずれないようにする
function createSphereBody(scene, name, {
  position,
  radius,
  color,
  bodyType = "dynamic",
  orientation = new Quat(),
  linearVelocity = [0.0, 0.0, 0.0],
  angularVelocity = [0.0, 0.0, 0.0],
  allowSleep = false,
  linearDamping = 0.035,
  angularDamping = 0.08,
  collisionLayer = 1,
  collisionMask = 1,
  restitution = 0.08,
  friction = 0.72
}) {
  // SphereもCapsuleと同じ順番で、物理body、Collider、material、初期状態、描画Shapeを準備します
  // static bodyは位置を保持し、dynamic bodyだけをdynamicRecordsへ記録してreset対象にします
  const body = scene.addPhysicsNode(null, name, {
    bodyType,
    mass: 1.0,
    collisionLayer,
    collisionMask,
    allowSleep,
    gravityScale: 1.0,
    linearDamping,
    angularDamping
  });
  body.setCollider(new SphereCollider(radius));
  body.setPhysicsMaterial({ restitution, friction });
  if (bodyType === "dynamic") {
    body.teleport(position, { keepVelocity: false, wakeUp: true });
    body.syncNodeFromPhysics(position, { quat: orientation.clone() });
  } else {
    body.setPosition(position[0], position[1], position[2]);
    body.syncNodeFromPhysics(position, { quat: orientation.clone() });
  }
  body.setLinearVelocityVec(linearVelocity);
  body.setAngularVelocityVec(angularVelocity);
  body.addShape(createSphereShape(app.getGPU(), radius, color));
  physicsSpace.addBody(body);
  if (bodyType === "dynamic") {
    dynamicRecords.push({
      body,
      shapeType: "sphere",
      position: [...position],
      orientation: orientation.clone(),
      linearVelocity: [...linearVelocity],
      angularVelocity: [...angularVelocity]
    });
  }
  return body;
}

// 一つのJointを登録し、Help PanelのJoint数と診断対象を同じ一覧から参照できるようにする
function addJoint(joint) {
  // PhysicsSpaceのsolver対象とHelp Panelの診断対象を同じ配列に登録します
  // Jointを追加する順序はropeの上端から下端へ固定し、最大誤差の走査結果を方式間で比較しやすくします
  physicsSpace.addJoint(joint);
  joints.push(joint);
  return joint;
}

// 振り子のstatic pivotとsphere weightをDistanceJointで接続する
// 支点をロープ根元へ重ねるため振り子自身の接触は無効にし、重力と距離拘束だけで周期を測定する
function createPendulum(scene) {
  // pivotはstatic、weightはdynamicとして、重力を受けるweightだけが動きます
  // DistanceJointの両anchorをbody中心へ置くことで、拘束距離をpivot中心とweight中心の距離に一致させます
  // connectorは物理bodyではないため、ここで作るJointが振り子を動かす唯一の接続になります
  pendulumPivot = createSphereBody(scene, "pendulum_pivot", {
    position: PENDULUM_PIVOT_POSITION,
    radius: 0.025,
    color: [0.25, 0.58, 0.94, 1.0],
    bodyType: "static",
    collisionMask: 0
  });
  pendulumWeight = createSphereBody(scene, "pendulum_weight", {
    position: PENDULUM_WEIGHT_POSITION,
    radius: PENDULUM_WEIGHT_RADIUS,
    color: [0.98, 0.42, 0.18, 1.0],
    linearDamping: PENDULUM_LINEAR_DAMPING,
    angularDamping: PENDULUM_ANGULAR_DAMPING,
    collisionLayer: 8,
    collisionMask: 0
  });
  addJoint(new DistanceJoint({
    bodyA: pendulumPivot,
    bodyB: pendulumWeight,
    localAnchorA: PENDULUM_LOCAL_ANCHOR_A,
    localAnchorB: PENDULUM_LOCAL_ANCHOR_B,
    distance: PENDULUM_DISTANCE,
    compliance: 0.0,
    positionCorrectionBeta: 0.28,
    positionCorrectionSlop: 0.0001,
    positionCorrectionIterations: 16,
    collideConnected: false
  }));
  createPendulumConnector(scene);
}

// 振り子のpivot anchorとweight anchorを現在のworld座標で返す
// body中心ではなくJointが拘束しているanchorを使い、表示棒と距離計測の基準を一致させる
function getPendulumAnchors() {
  if (!pendulumPivot || !pendulumWeight) {
    throw new Error("getPendulumAnchors requires an initialized pendulum");
  }
  return {
    // getWorldAnchor()はlocal anchorをbodyの現在姿勢でworldへ変換するため、
    // body中心ではなく実際にDistanceJointが拘束している点を返します
    pivot: getWorldAnchor(pendulumPivot, PENDULUM_LOCAL_ANCHOR_A),
    weight: getWorldAnchor(pendulumWeight, PENDULUM_LOCAL_ANCHOR_B)
  };
}

// 質量を持たない表示用Capsuleを作り、支点と球の間へ配置する
// 物理的な接続はDistanceJointが担当し、表示用Nodeは衝突・重力・solverへ参加しない
function createPendulumConnector(scene) {
  // connectorは表示専用Nodeです。物理bodyへ登録せず、質量・重力・接触・solver反復を持たない表示要素として扱います
  // Shapeの長さだけは共有シナリオのDistanceJoint距離から決め、初期表示と拘束距離を一致させます
  pendulumConnectorNode = scene.addNode(null, "pendulum_connector");
  pendulumConnectorNode.addShape(createCapsuleShape(
    app.getGPU(),
    PENDULUM_CONNECTOR_RADIUS,
    PENDULUM_CONNECTOR_SEGMENT_LENGTH,
    [1.0, 1.0, 1.0, 1.0]
  ));
  updatePendulumConnector();
}

// 現在のJoint anchor間の中点と向きを表示用Capsuleへ反映する
// solver後に呼び出すことで、球の揺れに対して棒の表示が遅れず、長さの基準もJointと一致する
function updatePendulumConnector() {
  if (!pendulumConnectorNode) {
    throw new Error("updatePendulumConnector requires a created connector");
  }
  const anchors = getPendulumAnchors();
  const direction = [
    anchors.weight[0] - anchors.pivot[0],
    anchors.weight[1] - anchors.pivot[1],
    anchors.weight[2] - anchors.pivot[2]
  ];
  const length = Math.hypot(direction[0], direction[1], direction[2]);
  if (!Number.isFinite(length) || length <= 1.0e-8) {
    throw new Error("updatePendulumConnector requires distinct finite anchors");
  }
  // 中点をNode位置へ設定し、local Y軸をanchor間方向へ回転します
  // Shapeの端はSphereの中心まで伸びるため、画面上ではpivotとweightを一本の棒で結んで見せられます
  pendulumConnectorNode.setPosition(
    (anchors.pivot[0] + anchors.weight[0]) * 0.5,
    (anchors.pivot[1] + anchors.weight[1]) * 0.5,
    (anchors.pivot[2] + anchors.weight[2]) * 0.5
  );
  pendulumConnectorNode.setQuat(createQuaternionFromUpDirection(direction));
}

// 一本の吊りロープをstatic top pivotと10本のdynamic Capsuleで構成する
// 下端は自由端にし、隣接linkのJoint間へ小さなgapを残して重力による揺れを見える状態にする
// rope linkはlayer 2、操作Capsuleはlayer 4とし、rope同士は接触させず操作Capsuleだけを受ける
// 操作用Capsuleとの接触は法線方向の押し出しだけを残し、摩擦トルクと反発による角速度増幅を使わない
function createRopeColumn(scene, columnIndex, x, z) {
  // 各ロープは「動かないSphere pivot + 10本のdynamic Capsule link + 10個のDistanceJoint」です
  // link同士は接触させず、Jointの距離拘束だけで列を作ります。これにより、接触solverが
  // 隣接linkを押し戻す効果と、Joint solverがlink間隔を保つ効果を別の診断値として扱います
  const topPivot = createSphereBody(scene, `rope_${columnIndex}_top_pivot`, {
    position: [x, ROPE_TOP_PIVOT_Y, z],
    radius: ROPE_TOP_PIVOT_RADIUS,
    color: [0.20, 0.70, 0.50, 1.0],
    bodyType: "static",
    collisionMask: 0
  });
  const topAnchor = [x, ROPE_TOP_PIVOT_Y - ROPE_TOP_ANCHOR_OFFSET, z];
  const linkColor = columnIndex % 2 === 0
    ? [0.95, 0.72, 0.18, 1.0]
    : [0.96, 0.44, 0.20, 1.0];
  let previousBody = topPivot;
  for (let index = 0; index < ROPE_LINK_COUNT; index++) {
    // Capsuleの全長は2*radius+segmentLength、隣接linkの中心間隔は
    // 2*ROPE_LINK_ANCHOR+ROPE_ANCHOR_GAPです。Jointのdistanceには
    // link中心間隔ではなく、対向するlocal anchor間に残す見かけのgapだけを指定します
    const centerY = topAnchor[1]
      - ROPE_LINK_ANCHOR
      - ROPE_ANCHOR_GAP
      - index * (ROPE_LINK_ANCHOR * 2.0 + ROPE_ANCHOR_GAP);
    const link = createCapsuleBody(scene, `rope_${columnIndex}_link_${index}`, {
      position: [x, centerY, z],
      radius: ROPE_LINK_RADIUS,
      segmentLength: ROPE_LINK_SEGMENT_LENGTH,
      color: linkColor,
      mass: ROPE_LINK_MASS,
      allowSleep: true,
      linearDamping: ROPE_LINK_LINEAR_DAMPING,
      angularDamping: ROPE_LINK_ANGULAR_DAMPING,
      collisionLayer: 2,
      collisionMask: 1 | 4,
      restitution: 0.0,
      friction: 0.0
    });
    addJoint(new DistanceJoint({
      bodyA: previousBody,
      bodyB: link,
      localAnchorA: index === 0
        ? [0.0, -ROPE_TOP_ANCHOR_OFFSET, 0.0]
        : [0.0, -ROPE_LINK_ANCHOR, 0.0],
      localAnchorB: [0.0, ROPE_LINK_ANCHOR, 0.0],
      distance: ROPE_ANCHOR_GAP,
      compliance: 0.0,
      positionCorrectionBeta: 0.35,
      velocityCorrectionBeta: 0.08,
      positionCorrectionSlop: 0.0001,
      positionCorrectionIterations: 16,
      collideConnected: false
    }));
    // 次のJointでは今回のlinkを上側bodyとして使い、rootから自由端へchainを延長します
    ropeRecords.push(link);
    previousBody = link;
  }
}

// 横移動するkinematic driver Capsuleを作り、画面の前後方向へ長い姿勢を設定する
// Capsuleのlocal Y軸をX軸回転でworld Z軸へ向け、移動方法と接触エネルギーをcontrollerで切り替える
function createCrossingCapsule(scene) {
  // 操作用Capsuleはkinematic bodyなので、位置は入力値で更新し重力・接触反力から独立して扱います
  // controllerが毎fixed stepに位置を処方し、modeに応じてcontact solverへ速度を渡します
  const orientation = createQuatFromArray(CROSSING_CAPSULE_ORIENTATION);
  return createCapsuleBody(scene, "crossing_capsule", {
    position: [CROSSING_CAPSULE_START_X, CROSSING_CAPSULE_Y, CROSSING_CAPSULE_Z],
    radius: CROSSING_CAPSULE_RADIUS,
    segmentLength: CROSSING_CAPSULE_SEGMENT_LENGTH,
    color: [0.34, 0.84, 0.96, 1.0],
    bodyType: "kinematic",
    mass: 8.0,
    orientation,
    collisionLayer: 4,
    collisionMask: 2,
    gravityScale: 0.0,
    fixedRotation: true,
    allowSleep: false,
    linearDamping: 0.0,
    angularDamping: 0.0,
    restitution: 0.0,
    friction: 0.0
  });
}

// すべての吊りロープと操作対象を同じPhysicsSpaceへ配置する
// バックホーや動かない表示用アームは作らず、重力とキー入力による二種類の動きを比較できる構成にする
function createScene() {
  // シーン再構築時に診断配列と参照を先に空にし、新しいbodyやJointだけを計測します
  // 物理bodyの生成順をpivot、pendulum、rope、crossing Capsuleに固定します
  dynamicRecords = [];
  ropeRecords = [];
  joints = [];
  crossingBody = null;
  crossingController = null;
  peakRopeLinearSpeed = 0.0;
  peakRopeAngularSpeed = 0.0;
  peakRopeContactPairs = 0;
  createPendulum(app.space);
  for (let index = 0; index < ROPE_COLUMN_X_POSITIONS.length; index++) {
    createRopeColumn(
      app.space,
      index,
      ROPE_COLUMN_X_POSITIONS[index],
      ROPE_COLUMN_Z_POSITIONS[index]
    );
  }
  crossingBody = createCrossingCapsule(app.space);
  crossingController = new KinematicMotionController({
    body: crossingBody,
    startPosition: [CROSSING_CAPSULE_START_X, CROSSING_CAPSULE_Y, CROSSING_CAPSULE_Z],
    endPosition: [CROSSING_CAPSULE_END_X, CROSSING_CAPSULE_Y, CROSSING_CAPSULE_Z],
    speed: CROSSING_CAPSULE_SPEED,
    mode: CROSSING_CAPSULE_DEFAULT_MODE
  });
  // 起動直後からDキーを押した状態にし、右方向のCapsule移動を開始する
  crossingController.setDirection(1);
  resetPendulumPeriodMeasurement();
}

// 振り子の二つのJoint anchorから、鉛直下向きを0とした左右角度を計算する
// body中心ではなくanchorを使うため、pivotとweightの表示半径を変えても周期計測の基準が変わらない
function getPendulumAngleRadians() {
  const anchors = getPendulumAnchors();
  return Math.atan2(
    anchors.weight[0] - anchors.pivot[0],
    -(anchors.weight[1] - anchors.pivot[1])
  );
}

// 下向き通過時刻を補間し、同じ向きの通過間隔から振り子の実測周期を更新する
// frame間隔そのものを周期にせず、angle=0の交点を線形補間してHelp Panelの値を安定させる
function updatePendulumPeriodMeasurement() {
  const angle = getPendulumAngleRadians();
  if (angle === null) {
    return;
  }
  const timeSec = elapsedMs * 0.001;
  if (
    pendulumLastAngleRadians !== null
    && pendulumLastAngleTimeSec !== null
    && pendulumLastAngleRadians > 0.0
    && angle <= 0.0
  ) {
    // 前回angleが正で今回angleが0以下なら、下向きの同じ通過方向を検出します
    // readbackやframeのサンプル間隔に依存しないよう、前後のangleから交差時刻を線形補間します
    const angleSpan = pendulumLastAngleRadians - angle;
    const interpolation = pendulumLastAngleRadians / angleSpan;
    const crossingTimeSec = pendulumLastAngleTimeSec
      + (timeSec - pendulumLastAngleTimeSec) * interpolation;
    if (pendulumPreviousDownwardCrossingTimeSec !== null) {
      pendulumMeasuredPeriodSec = crossingTimeSec - pendulumPreviousDownwardCrossingTimeSec;
    }
    pendulumPreviousDownwardCrossingTimeSec = crossingTimeSec;
  }
  pendulumLastAngleRadians = angle;
  pendulumLastAngleTimeSec = timeSec;
}

// 振り子の実測状態を初期化し、reset直後の初期角度を周期の開始通過と誤認しないようにする
function resetPendulumPeriodMeasurement() {
  pendulumLastAngleRadians = null;
  pendulumLastAngleTimeSec = null;
  pendulumPreviousDownwardCrossingTimeSec = null;
  pendulumMeasuredPeriodSec = null;
}

// dynamic bodyを初期位置、初期姿勢、初期速度へ戻し、操作Capsuleと周期計測も初期状態へ戻す
// Jointを再生成せず、現在のJoint定義を保ったまま重力シナリオを最初から再実行する
function resetSimulation() {
  // Joint定義は作り直さず、dynamic bodyの初期transformと速度だけを復元します
  // Joint lambdaを含むsolver内部状態を再初期化するAPIではないため、ここでは現在の構成を保ちます
  for (let i = 0; i < dynamicRecords.length; i++) {
    const record = dynamicRecords[i];
    record.body.teleport(record.position, { keepVelocity: false, wakeUp: true });
    record.body.syncNodeFromPhysics(record.position, {
      quat: record.orientation.clone()
    });
    record.body.setLinearVelocityVec(record.linearVelocity);
    record.body.setAngularVelocityVec(record.angularVelocity);
  }
  crossingController?.reset();
  physicsAccumulatorMs = 0.0;
  updatePendulumConnector();
  peakRopeLinearSpeed = 0.0;
  peakRopeAngularSpeed = 0.0;
  peakRopeContactPairs = 0;
  elapsedMs = 0.0;
  paused = false;
  resetPendulumPeriodMeasurement();
}

// frame時間をfixed stepへ分配し、各stepの直前に操作Capsuleの位置を更新する
// PhysicsSpace.step()内部へcallbackを持ち込まず、public core APIのstepFixed()だけで処理順を明示する
function stepPhysics(deltaMs) {
  const numericDeltaMs = util.readFiniteNumber(deltaMs, "joint sample deltaMs", { min: 0.0 });
  const maxSubSteps = MAX_SUB_STEPS;
  physicsAccumulatorMs = Math.min(
    physicsAccumulatorMs + numericDeltaMs,
    FIXED_TIME_STEP_MS * maxSubSteps
  );
  let stepCount = 0;
  while (physicsAccumulatorMs >= FIXED_TIME_STEP_MS && stepCount < maxSubSteps) {
    // 1 fixed stepの処理順は、driver位置の処方 -> 接触とJointを含むPhysicsSpace更新 ->
    // 表示用connector更新 -> 診断値更新です。connectorと診断はsolver後のbody状態を読みます
    crossingController.updateFixedStep(FIXED_TIME_STEP_SEC);
    physicsSpace.stepFixed(FIXED_TIME_STEP_SEC);
    physicsAccumulatorMs -= FIXED_TIME_STEP_MS;
    elapsedMs += FIXED_TIME_STEP_MS;
    updatePendulumConnector();
    updateRopeDiagnostics();
    updatePendulumPeriodMeasurement();
    stepCount += 1;
  }
  return stepCount;
}

// Jointの現在最大誤差を計算し、重力下で拘束が維持されているかHelp Panelへ表示する
function getMaximumJointError() {
  // 各Jointが生成するconstraint rowのposition errorを絶対値で比較します
  // これは速度誤差やlambdaではなく、現在のanchor配置が目標拘束から何mずれているかを表します
  let maximum = 0.0;
  for (let i = 0; i < joints.length; i++) {
    const rows = joints[i].buildConstraintRows();
    for (let j = 0; j < rows.length; j++) {
      maximum = Math.max(maximum, Math.abs(rows[j].getPositionError()));
    }
  }
  return maximum;
}

// 吊りロープlinkの現在最大線速度を計算する
// driver Capsuleから受けた接触インパルスがlink列へどれだけ伝わったかを位置誤差と分けて確認する
function getMaximumRopeLinearSpeed() {
  // 各linkの速度ベクトルの長さを比較し、chain全体で最も速いlinkだけを表示値にします
  // 最大値を使うことで、先端の小さな揺れが残っている状態をそのまま表示します
  let maximum = 0.0;
  for (let i = 0; i < ropeRecords.length; i++) {
    const velocity = ropeRecords[i].getLinearVelocity();
    maximum = Math.max(maximum, Math.hypot(velocity[0], velocity[1], velocity[2]));
  }
  return maximum;
}

// 吊りロープlinkの現在最大角速度を計算する
// PhysicsNodeの角速度はdegrees/secなので、Help Panelでも同じ単位を明記する
function getMaximumRopeAngularSpeed() {
  // PhysicsNodeが返す角速度は各軸のdegrees/secなので、3軸ベクトルの長さをその単位のまま集計します
  // linear speedと同じく最大値を使い、先端linkだけの回転し続ける状態を検出します
  let maximum = 0.0;
  for (let i = 0; i < ropeRecords.length; i++) {
    const angularVelocity = ropeRecords[i].getAngularVelocity();
    maximum = Math.max(
      maximum,
      Math.hypot(angularVelocity[0], angularVelocity[1], angularVelocity[2])
    );
  }
  return maximum;
}

// 直前fixed stepで操作Capsuleと接触していたrope link数を数える
// getLastContacts()はsolver反復ごとの重複を含むため、pair化済みのcontact eventだけを診断に使う
function getCurrentRopeContactPairCount() {
  // Contact eventはsolver反復ごとの内部接触ではなく、fixed step後にまとめられたbegin/stayを使います
  // crossingBodyとrope linkの組だけをbody参照で選び、Setで同じpairを一度だけ数えます
  const events = physicsSpace.getLastContactEvents();
  const ropeIndices = new Set();
  const contacts = [...events.begin, ...events.stay];
  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i];
    let ropeBody = null;
    if (contact.bodyA === crossingBody && ropeRecords.includes(contact.bodyB)) {
      ropeBody = contact.bodyB;
    } else if (contact.bodyB === crossingBody && ropeRecords.includes(contact.bodyA)) {
      ropeBody = contact.bodyA;
    }
    if (ropeBody !== null) {
      ropeIndices.add(ropeRecords.indexOf(ropeBody));
    }
  }
  return ropeIndices.size;
}

// 毎回のfixed stepのロープ診断値を更新し、往復中に発生した最大値を保持する
// 現在値が接触終了後に下がっても、暴れ始めたときのピーク速度をHelp Panelで確認できるようにする
function updateRopeDiagnostics() {
  // currentは直前stepの状態、peakはreset後に観測した最大値です
  // 接触が終わった後もpeakを残すことで、Capsule通過中に発生した速度増幅を後から確認できます
  const linearSpeed = getMaximumRopeLinearSpeed();
  const angularSpeed = getMaximumRopeAngularSpeed();
  const contactPairs = getCurrentRopeContactPairCount();
  peakRopeLinearSpeed = Math.max(peakRopeLinearSpeed, linearSpeed);
  peakRopeAngularSpeed = Math.max(peakRopeAngularSpeed, angularSpeed);
  peakRopeContactPairs = Math.max(peakRopeContactPairs, contactPairs);
}

// Help Panelへ、吊りロープ、操作Capsule、振り子の目標値と実測値を表示する
// HUDへ直接描画せず、実験条件と現在のsolver状態を同じ説明パネルへまとめる
function buildHelpLines() {
  // 表示値はPhysicsSpaceの内部変数を直接参照せず、公開APIから取得した現在状態を組み合わせます
  // solver設定、拘束誤差、速度、接触数を同じパネルへ出し、見た目の揺れと数値を対応付けます
  const diagnostics = physicsSpace.getLastJointDiagnostics();
  const capsuleCount = dynamicRecords.filter((record) => record.shapeType === "capsule").length;
  const sphereCount = dynamicRecords.filter((record) => record.shapeType === "sphere").length;
  const singularRows = diagnostics.reduce(
    (sum, diagnostic) => sum + diagnostic.singularRows,
    0
  );
  const measuredPeriod = pendulumMeasuredPeriodSec === null
    ? "--"
    : `${pendulumMeasuredPeriodSec.toFixed(3)} s`;
  const crossingPosition = crossingBody.getPosition();
  const motionMode = crossingController.getMode();
  const prescribedVelocity = crossingController.getPrescribedVelocity();
  const contactVelocity = crossingController.getContactVelocity();
  return [
    "joint CPU sample",
    ...(app?.getFrameTimingLines?.() ?? []),
    `state: ${paused ? "paused" : "running"}  elapsed: ${(elapsedMs * 0.001).toFixed(2)} s`,
    `gravity: [${GRAVITY.map((value) => value.toFixed(3)).join(", ")}] m/s²`,
    `dynamic bodies: ${dynamicRecords.length}  kinematic bodies: 1  capsules: ${capsuleCount}  spheres: ${sphereCount}  joints: ${joints.length}`,
    `hanging ropes: ${ROPE_COLUMN_X_POSITIONS.length}  links per rope: ${ROPE_LINK_COUNT}`,
    `pendulum length: ${PENDULUM_DISTANCE.toFixed(4)} m  target period: ${PENDULUM_TARGET_PERIOD_SEC.toFixed(3)} s  measured: ${measuredPeriod}`,
    `crossing capsule: mode=${motionMode}  x=${crossingPosition[0].toFixed(2)} m  y=${crossingPosition[1].toFixed(2)} m  prescribed=${Math.hypot(...prescribedVelocity).toFixed(2)} m/s  contact=${Math.hypot(...contactVelocity).toFixed(2)} m/s  kinematic mass=${crossingBody.getMass().toFixed(2)} kg`,
    `rope speed current/peak: ${getMaximumRopeLinearSpeed().toFixed(4)} / ${peakRopeLinearSpeed.toFixed(4)} m/s  angular current/peak: ${getMaximumRopeAngularSpeed().toFixed(2)} / ${peakRopeAngularSpeed.toFixed(2)} deg/s`,
    `capsule-rope contacts current/peak: ${getCurrentRopeContactPairCount()} / ${peakRopeContactPairs}`,
    `joint max position error: ${getMaximumJointError().toFixed(5)}  singular rows: ${singularRows}`,
    `core solver: PhysicsSpace XPBD DistanceJoint  joint iterations=${physicsSpace.jointSolverIterations}  position iterations=${physicsSpace.jointPositionCorrectionIterations}`,
    "quasiStatic: kinematic position moves the rope; contact velocity is zero",
    "impact: prescribed velocity enters contact solver and can inject energy",
    "pendulum: a massless visual connector links the pivot and Sphere weight; DistanceJoint enforces the length",
    "ropes: six vertical DistanceJoint chains have free lower ends",
    "A / D: press to start a slow crossing of the front-back Capsule through the rope centers",
    "Q: quasiStatic   I: impact",
    "P: pause/resume   R: reset   H: show/hide Help Panel   Drag: orbit   Wheel: zoom"
  ];
}

// 初期化済みの重力JointシナリオをHelp Panelへ登録し、起動時はhide状態にしてHUDの文字表示を使わない
function showHelpPanel() {
  // 起動時は本文を生成しておきますが、パネル本体をhideして描画領域を空けます
  // Hキーで表示したときだけ本文を展開するため、初期画面は物理シーンを広く表示します
  const lines = buildHelpLines();
  const panel = app.showOverlayPanel(buildHelpPanelOptions({
    id: "jointDynamicsHelp",
    title: "Help",
    collapsed: true,
    maxWidth: "640px",
    lines
  }));
  panel.hide();
  lastHelpText = lines.join("\n");
}

// Help Panel全体の表示状態をHキーで切り替え、表示時は説明本文も開く
// 起動時はパネル自体をhiddenにして、物体の表示領域へHelpの見出しも残さない
function toggleHelpPanel() {
  // Panelのvisible状態だけを切り替え、物理更新や描画は継続します
  // 非表示中もHelp用の計測値は更新され、再表示した時点の状態を確認できます
  const panel = app?.getOverlayPanel?.("jointDynamicsHelp");
  if (!panel) return;
  if (panel.options.visible === true) {
    panel.hide();
    return;
  }
  panel.setCollapsed(false);
  panel.show();
}

// 状態の変化がある場合だけ既存Help Panelの本文を更新する
// updateOverlayPanel()を使い、毎frameのDOM再構築とHUDへの再描画を避ける
function updateHelpPanel() {
  // 文字列全体を比較して、値が変わったframeだけDOMのoverlay内容を更新します
  // この処理は物理fixed stepの代わりではなく、表示の更新頻度を抑えるためのものです
  const panel = app?.getOverlayPanel?.("jointDynamicsHelp");
  if (!panel) return;
  const lines = buildHelpLines();
  const nextText = lines.join("\n");
  if (nextText === lastHelpText) return;
  app.updateOverlayPanel("jointDynamicsHelp", { lines });
  lastHelpText = nextText;
}

// WebgApp、重力付きPhysicsSpace、吊りロープ、振り子、入力を初期化する
async function start() {
  // WebgAppとPhysicsSpaceを作った後、同じsceneへbodyとJointを登録します
  // app.start()のonUpdateでは経過時間を受け取り、stepPhysics()が必要なfixed step数を決めます
  app = new WebgApp({
    document,
    frameTiming: true,
    messageFontTexture: FONT_FILE,
    clearColor: CLEAR_COLOR,
    viewAngle: 40.0,
    projectionNear: 0.02,
    projectionFar: 30.0,
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
      system: "joint",
      source: "samples/joint/joint_cpu_node.js"
    }
  });
  await app.init();
  app.createOrbitEyeRig(CAMERA);

  physicsSpace = new PhysicsSpace({
    gravity: GRAVITY,
    fixedTimeStepMs: FIXED_TIME_STEP_MS,
    maxSubSteps: 8,
    solverIterations: 6,
    jointSolverIterations: 16,
    jointPositionCorrectionIterations: 16,
    defaultRestitution: 0.12,
    defaultFriction: 0.78,
    sleepStepsThreshold: 120
  });
  // createScene()はpivot、weight、rope link、crossing Capsuleを作り、各Jointを同じspaceへ登録します
  createScene();
  showHelpPanel();

  app.attachInput({
    onKeyDown: (key, event) => {
      if (key === "a") {
        crossingController.setDirection(-1);
        event.preventDefault();
        return;
      }
      if (key === "d") {
        crossingController.setDirection(1);
        event.preventDefault();
        return;
      }
      if (event.repeat) return;
      if (key === "q") {
        crossingController.setMode("quasiStatic");
        updateHelpPanel();
        event.preventDefault();
      } else if (key === "i") {
        crossingController.setMode("impact");
        updateHelpPanel();
        event.preventDefault();
      } else if (key === "p") {
        paused = !paused;
        updateHelpPanel();
        event.preventDefault();
      } else if (key === "r") {
        resetSimulation();
        updateHelpPanel();
        event.preventDefault();
      } else if (key === "h") {
        toggleHelpPanel();
        event.preventDefault();
      }
    },
    onKeyUp: (key, event) => {
      if (key === "a" || key === "d") {
        event.preventDefault();
      }
    }
  });

  app.start({
    onUpdate: ({ deltaSec, timeMs }) => {
      const deltaMs = deltaSec * 1000.0;
      if (!paused) {
        stepPhysics(deltaMs);
      }
      if (timeMs - lastHelpUpdateMs >= 250.0) {
        updateHelpPanel();
        lastHelpUpdateMs = timeMs;
      }
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  start().catch((error) => {
    console.error("joint_cpu_node failed:", error);
    app?.showOverlayPanel?.(buildErrorPanelOptions(error, {
      title: "joint_cpu_node failed",
      id: "joint-dynamics-error"
    }));
  });
});
