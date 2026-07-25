// ---------------------------------------------
// headless_tests/core/physics_space/api_contracts.js  2026/07/17
//   PhysicsSpace API contract checks for webg
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import Space from "../../../webg/Space.js";
import BoxCollider from "../../../webg/BoxCollider.js";
import CapsuleCollider from "../../../webg/CapsuleCollider.js";
import PlaneCollider from "../../../webg/PlaneCollider.js";
import SphereCollider from "../../../webg/SphereCollider.js";
import PhysicsSpace from "../../../webg/PhysicsSpace.js";

// このファイルは PhysicsSpace の自動仕様書として扱う
// 英語の関数名だけでは仕様意図が伝わらないため、日本語コメントで何を守る確認かを明記する
// constructor は作成処理、setter は値の変更処理、getter は値の取得処理を指す
// broadphase は粗い候補選別、narrowphase は実際の接触判定を指す
// raycast は始点と方向を持つ線で最初に当たる物体を調べる問い合わせを指す
// queryAabb は軸に平行な箱範囲と重なる物体を集める問い合わせを指す
// overlapSphere は球範囲と重なる物体を集める問い合わせを指す
// trigger は接触イベントだけを出し、押し戻しや速度反発を行わない物体を指す
const lines = [];
let passCount = 0;
let failCount = 0;
let knownIssueCount = 0;

const log = (line) => {
  lines.push(line);
};

const formatValue = (value) => {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const summarizeContactEvents = (events) => {
  const summarizeList = (contacts) => contacts.map((contact) => ({
    pair: `${contact.bodyA?.name ?? "unknown"} / ${contact.bodyB?.name ?? "unknown"}`,
    normal: Array.isArray(contact.normal) ? [...contact.normal] : null,
    penetration: contact.penetration
  }));
  return {
    begin: summarizeList(events.begin),
    stay: summarizeList(events.stay),
    end: summarizeList(events.end)
  };
};

const summarizeListenerCalls = (calls) => calls.map((call) => ({
  phase: call.phase,
  pair: `${call.bodyA?.name ?? "unknown"} / ${call.bodyB?.name ?? "unknown"}`
}));

const check = (label, condition, detail = "") => {
  if (condition) {
    passCount += 1;
    log(`PASS ${label}`);
  } else {
    failCount += 1;
    log(`FAIL ${label}${detail ? `: ${detail}` : ""}`);
  }
};

// 現行実装との既知不一致を可視化しつつ、テスト整理とコア修正を分離する。
// 条件が通るようになった場合は XPASS として失敗させ、指定の除去を促す。
const checkKnownIssue = (label, condition, detail = "") => {
  if (condition) {
    failCount += 1;
    log(`XPASS ${label}: remove the known-issue marker`);
  } else {
    knownIssueCount += 1;
    log(`XFAIL ${label}${detail ? `: ${detail}` : ""}`);
  }
};

const almostEqual = (a, b, eps = 1.0e-5) => Math.abs(a - b) <= eps;

const createWorld = () => {
  return new PhysicsSpace({
    gravity: [0.0, -42.0, 0.0],
    fixedTimeStepMs: 1000.0 / 120.0,
    maxSubSteps: 6,
    solverIterations: 5,
    defaultRestitution: 0.25,
    defaultFriction: 0.4,
    sleepLinearThreshold: 0.2
  });
};

const createBoxBody = (space, name, {
  bodyType = "dynamic",
  position = [0.0, 0.0, 0.0],
  attitude = [0.0, 0.0, 0.0],
  size = [4.0, 4.0, 4.0],
  mass = 1.0,
  velocity = [0.0, 0.0, 0.0],
  angularVelocity = [0.0, 0.0, 0.0],
  restitution = 0.0,
  linearDamping = 0.0,
  angularDamping = 0.0
} = {}) => {
  const body = space.addPhysicsNode(null, name, {
    bodyType: "kinematic",
    mass,
    linearDamping,
    angularDamping
  });
  body.setPosition(position[0], position[1], position[2]);
  body.setAttitude(attitude[0], attitude[1], attitude[2]);
  body.setCollider(new BoxCollider(size));
  body.setPhysicsMaterial({
    restitution
  });
  body.setLinearVelocityVec(velocity);
  body.setAngularVelocityVec(angularVelocity);
  body.setBodyType(bodyType, {
    clearVelocity: false,
    restoreVelocity: false
  });
  return body;
};

const createPlaneBody = (space, name, {
  bodyType = "static",
  position = [0.0, 0.0, 0.0],
  normal = [0.0, 1.0, 0.0],
  restitution = 0.0,
  friction = 0.4
} = {}) => {
  const body = space.addPhysicsNode(null, name, {
    bodyType: "kinematic",
    mass: 1.0
  });
  body.setPosition(position[0], position[1], position[2]);
  body.setCollider(new PlaneCollider(normal));
  body.setPhysicsMaterial({
    restitution,
    friction
  });
  body.setBodyType(bodyType, {
    clearVelocity: true,
    restoreVelocity: false
  });
  return body;
};

const createSphereBody = (space, name, {
  bodyType = "dynamic",
  position = [0.0, 0.0, 0.0],
  radius = 2.0,
  mass = 1.0,
  velocity = [0.0, 0.0, 0.0],
  restitution = 0.0,
  linearDamping = 0.0
} = {}) => {
  const body = space.addPhysicsNode(null, name, {
    bodyType: "kinematic",
    mass,
    linearDamping
  });
  body.setPosition(position[0], position[1], position[2]);
  body.setCollider(new SphereCollider(radius));
  body.setPhysicsMaterial({
    restitution
  });
  body.setLinearVelocityVec(velocity);
  body.setBodyType(bodyType, {
    clearVelocity: false,
    restoreVelocity: false
  });
  return body;
};

const createCapsuleBody = (space, name, {
  bodyType = "dynamic",
  position = [0.0, 0.0, 0.0],
  radius = 1.0,
  segmentLength = 4.0,
  mass = 1.0,
  velocity = [0.0, 0.0, 0.0],
  restitution = 0.0,
  linearDamping = 0.0
} = {}) => {
  const body = space.addPhysicsNode(null, name, {
    bodyType: "kinematic",
    mass,
    linearDamping
  });
  body.setPosition(position[0], position[1], position[2]);
  body.setCollider(new CapsuleCollider(radius, segmentLength));
  body.setPhysicsMaterial({
    restitution
  });
  body.setLinearVelocityVec(velocity);
  body.setBodyType(bodyType, {
    clearVelocity: false,
    restoreVelocity: false
  });
  return body;
};

const runWorldSettingChecks = () => {
  log("[PhysicsSpace / settings / registration]");
  const world = createWorld();
  // 作成時に渡した設定値が内部状態として欠けずに保存されることを確認する
  // ここが崩れると、以降の重力や sleep の確認がすべて別条件で走ってしまう
  check("constructor stores gravity", JSON.stringify(world.getGravity()) === JSON.stringify([0, -42, 0]), formatValue(world.getGravity()));
  check("constructor stores fixedTimeStepMs", almostEqual(world.getFixedTimeStepMs(), 1000.0 / 120.0), formatValue(world.getFixedTimeStepMs()));
  check("constructor stores maxSubSteps", world.getMaxSubSteps() === 6, formatValue(world.getMaxSubSteps()));
  check("constructor stores solverIterations", world.getSolverIterations() === 5, formatValue(world.getSolverIterations()));
  check("constructor stores default broadphaseMode", world.getBroadphaseMode() === "sweepAabb", formatValue(world.getBroadphaseMode()));
  check("constructor stores defaultRestitution", almostEqual(world.getDefaultRestitution(), 0.25), formatValue(world.getDefaultRestitution()));
  check("constructor stores defaultFriction", almostEqual(world.getDefaultFriction(), 0.4), formatValue(world.getDefaultFriction()));
  check("constructor stores sleepLinearThreshold", almostEqual(world.getSleepLinearThreshold(), 0.2), formatValue(world.getSleepLinearThreshold()));
  check("constructor stores default sleepAngularThreshold", almostEqual(world.getSleepAngularThreshold(), 0.12), formatValue(world.getSleepAngularThreshold()));
  check("constructor stores default sleepStepsThreshold", world.getSleepStepsThreshold() === 3, formatValue(world.getSleepStepsThreshold()));

  world.setGravity([1.0, -9.0, 3.0]);
  world.setFixedTimeStepMs(20.0);
  world.setMaxSubSteps(3);
  world.setSolverIterations(7);
  world.setBroadphaseMode("bruteForce");
  world.setDefaultRestitution(0.6);
  world.setDefaultFriction(0.3);
  world.setSleepLinearThreshold(0.05);
  world.setSleepAngularThreshold(0.07);
  world.setSleepStepsThreshold(4);
  // 作成後に変更した設定値が getter から同じ値として読めることを確認する
  // UI や Scene JSON から物理設定を変更するときの土台になる
  check("setGravity updates gravity", JSON.stringify(world.getGravity()) === JSON.stringify([1, -9, 3]), formatValue(world.getGravity()));
  check("setFixedTimeStepMs updates value", almostEqual(world.getFixedTimeStepMs(), 20.0), formatValue(world.getFixedTimeStepMs()));
  check("setMaxSubSteps updates value", world.getMaxSubSteps() === 3, formatValue(world.getMaxSubSteps()));
  check("setSolverIterations updates value", world.getSolverIterations() === 7, formatValue(world.getSolverIterations()));
  check("setBroadphaseMode updates value", world.getBroadphaseMode() === "bruteForce", formatValue(world.getBroadphaseMode()));
  check("setDefaultRestitution updates value", almostEqual(world.getDefaultRestitution(), 0.6), formatValue(world.getDefaultRestitution()));
  check("setDefaultFriction updates value", almostEqual(world.getDefaultFriction(), 0.3), formatValue(world.getDefaultFriction()));
  check("setSleepLinearThreshold updates value", almostEqual(world.getSleepLinearThreshold(), 0.05), formatValue(world.getSleepLinearThreshold()));
  check("setSleepAngularThreshold updates value", almostEqual(world.getSleepAngularThreshold(), 0.07), formatValue(world.getSleepAngularThreshold()));
  check("setSleepStepsThreshold updates value", world.getSleepStepsThreshold() === 4, formatValue(world.getSleepStepsThreshold()));

  const space = new Space();
  const body = createBoxBody(space, "registered-body", {
    bodyType: "dynamic"
  });
  // world への登録と解除で、body 一覧と body 側の所属参照が同時に整合することを確認する
  // 二重登録は同じ body が二度計算される原因になるため、無視される必要がある
  world.addBody(body);
  check("addBody registers body", world.getBodies().length === 1);
  check("addBody sets body physicsSpace reference", body.getPhysicsSpace() === world);
  world.addBody(body);
  check("addBody ignores duplicate body", world.getBodies().length === 1);
  world.removeBody(body);
  check("removeBody removes body", world.getBodies().length === 0);
  check("removeBody clears body physicsSpace reference", body.getPhysicsSpace() === null);
};

const runFloorSleepChecks = () => {
  log("");
  log("[PhysicsSpace / floor sleep]");
  const world = createWorld();
  world.setDefaultRestitution(0.0);
  const space = new Space();

  const floor = createPlaneBody(space, "floor", {
    bodyType: "static",
    position: [0.0, -16.0, 0.0],
    normal: [0.0, 1.0, 0.0],
    restitution: 0.0,
    friction: 0.6
  });
  const box = createBoxBody(space, "box", {
    bodyType: "dynamic",
    position: [0.0, 34.0, 0.0],
    size: [8.0, 8.0, 8.0],
    mass: 3.2,
    restitution: 0.0,
    linearDamping: 1.8
  });
  world.addBody(floor);
  world.addBody(box);

  for (let i = 0; i < 400; i++) {
    world.stepFixed((1000.0 / 120.0) / 1000.0);
  }

  const pos = box.getPosition();
  // 重力で落ちた箱が床の上面付近で止まり、十分に落ち着いたら sleep へ入ることを確認する
  // sleep は静止物を毎 frame 解き続けないための省力化だが、早すぎると物体が空中で止まる
  check("dynamic box comes to rest on floor top", pos[1] > -12.1 && pos[1] < -9.9, formatValue(pos));
  check("dynamic box enters sleeping state after settling", box.getSleeping() === true);
};

const runSleepStabilityChecks = () => {
  log("");
  log("[PhysicsSpace / sleep stability]");
  const world = createWorld();
  world.setGravity([0.0, -0.1, 0.0]);
  world.setDefaultRestitution(0.0);
  world.setSleepLinearThreshold(1.0);
  world.setSleepAngularThreshold(0.5);
  world.setSleepStepsThreshold(3);
  const space = new Space();

  const floor = createPlaneBody(space, "sleep-stability-floor", {
    bodyType: "static",
    position: [0.0, 0.0, 0.0],
    normal: [0.0, 1.0, 0.0]
  });
  const box = createBoxBody(space, "sleep-stability-box", {
    bodyType: "dynamic",
    position: [0.0, 1.9, 0.0],
    size: [4.0, 4.0, 4.0],
    mass: 1.0,
    velocity: [0.0, 0.0, 0.0],
    restitution: 0.0
  });
  world.addBody(floor);
  world.addBody(box);

  world.stepFixed(0.1);
  // 低速接触が 1 回起きただけでは sleep しないことを確認する
  // 1 step だけの偶然の低速状態で眠ると、まだ動くべき物体が止まってしまう
  check("sleep stability does not sleep on first low-speed contact step", box.getSleeping() === false);
  world.stepFixed(0.1);
  // sleepStepsThreshold に達する前は sleep しないことを確認する
  // threshold は連続して静かだった step 数の条件であり、単なる速度条件ではない
  check("sleep stability does not sleep before threshold count", box.getSleeping() === false);
  world.stepFixed(0.1);
  // 連続して低速接触が続いたときだけ sleep に入ることを確認する
  // 床に落ち着いた body を安定して止めるための仕様
  check("sleep stability sleeps after consecutive low-speed contact steps", box.getSleeping() === true);

  const angularWorld = createWorld();
  angularWorld.setGravity([0.0, -0.1, 0.0]);
  angularWorld.setDefaultRestitution(0.0);
  angularWorld.setSleepLinearThreshold(1.0);
  angularWorld.setSleepAngularThreshold(0.5);
  angularWorld.setSleepStepsThreshold(2);
  const angularSpace = new Space();
  const angularFloor = createPlaneBody(angularSpace, "sleep-angular-floor", {
    bodyType: "static",
    position: [0.0, 0.0, 0.0],
    normal: [0.0, 1.0, 0.0]
  });
  const angularBox = createBoxBody(angularSpace, "sleep-angular-box", {
    bodyType: "dynamic",
    position: [0.0, 1.9, 0.0],
    size: [4.0, 4.0, 4.0],
    mass: 1.0,
    velocity: [0.0, 0.0, 0.0],
    restitution: 0.0
  });
  angularBox.setAngularVelocity(0.0, 2.0, 0.0);
  angularWorld.addBody(angularFloor);
  angularWorld.addBody(angularBox);
  angularWorld.stepFixed(0.1);
  angularWorld.stepFixed(0.1);
  angularWorld.stepFixed(0.1);
  // 線形速度が小さくても角速度が残っている body は sleep しないことを確認する
  // 回転している物体を sleep させると、見た目と物理状態が不自然に止まる
  check("sleep stability keeps rotating body awake", angularBox.getSleeping() === false);
  angularBox.setAngularVelocity(0.0, 0.0, 0.0);
  angularWorld.stepFixed(0.1);
  angularWorld.stepFixed(0.1);
  // 角速度も threshold 以下になった後なら sleep できることを確認する
  check("sleep stability sleeps after angular velocity drops below threshold", angularBox.getSleeping() === true);
};

const runWakeOnContactChecks = () => {
  log("");
  log("[PhysicsSpace / wake on contact]");
  const world = createWorld();
  world.setGravity([0.0, 0.0, 0.0]);
  world.setDefaultRestitution(0.0);
  const space = new Space();

  const sleepingBox = createBoxBody(space, "wake-sleeping-box", {
    bodyType: "dynamic",
    position: [0.0, 0.0, 0.0],
    size: [4.0, 4.0, 4.0],
    mass: 1.0,
    velocity: [0.0, 0.0, 0.0]
  });
  sleepingBox.sleep();
  const activeBox = createBoxBody(space, "wake-active-box", {
    bodyType: "dynamic",
    position: [3.5, 0.0, 0.0],
    size: [4.0, 4.0, 4.0],
    mass: 1.0,
    velocity: [-1.0, 0.0, 0.0]
  });
  world.addBody(sleepingBox);
  world.addBody(activeBox);

  world.stepFixed(0.1);
  // sleep 中の dynamic body が、動いている dynamic body と接触したら起きることを確認する
  // 起きないと、眠った物体が押されても反応しない
  check("sleeping dynamic body wakes when active dynamic body contacts it", sleepingBox.getSleeping() === false);
  // wake の有無に関係なく接触 record は残る必要がある
  // listener や debug 表示が接触を追えるようにするため
  check("wake contact still produces contact record", world.getLastContacts().length >= 1, formatValue(world.getLastContacts().length));

  const bothSleepWorld = createWorld();
  bothSleepWorld.setGravity([0.0, 0.0, 0.0]);
  const bothSleepSpace = new Space();
  const sleepingA = createBoxBody(bothSleepSpace, "wake-both-sleep-a", {
    bodyType: "dynamic",
    position: [0.0, 0.0, 0.0],
    size: [4.0, 4.0, 4.0]
  });
  const sleepingB = createBoxBody(bothSleepSpace, "wake-both-sleep-b", {
    bodyType: "dynamic",
    position: [3.5, 0.0, 0.0],
    size: [4.0, 4.0, 4.0]
  });
  sleepingA.sleep();
  sleepingB.sleep();
  bothSleepWorld.addBody(sleepingA);
  bothSleepWorld.addBody(sleepingB);
  bothSleepWorld.stepFixed(0.1);
  // sleep 中の body 同士だけでは勝手に wake しないことを確認する
  // 静止した山が毎 step 起き直すと sleep の意味がなくなる
  check("two sleeping dynamic bodies do not wake each other by themselves", sleepingA.getSleeping() === true && sleepingB.getSleeping() === true);
};

const runBounceChecks = () => {
  log("");
  log("[PhysicsSpace / body-body bounce / contacts]");
  const world = createWorld();
  world.setGravity([0.0, 0.0, 0.0]);
  world.setDefaultRestitution(0.5);
  world.setSleepLinearThreshold(0.01);

  const space = new Space();
  const bodyA = createBoxBody(space, "body-a", {
    bodyType: "dynamic",
    position: [-2.0, 0.0, 0.0],
    size: [4.0, 4.0, 4.0],
    mass: 1.0,
    velocity: [10.0, 0.0, 0.0],
    restitution: 0.5
  });
  const bodyB = createBoxBody(space, "body-b", {
    bodyType: "dynamic",
    position: [2.0, 0.0, 0.0],
    size: [4.0, 4.0, 4.0],
    mass: 1.0,
    velocity: [-10.0, 0.0, 0.0],
    restitution: 0.5
  });
  world.addBody(bodyA);
  world.addBody(bodyB);

  world.stepFixed(0.1);
  const velocityA = bodyA.getLinearVelocity();
  const velocityB = bodyB.getLinearVelocity();
  // 同じ質量の箱が正面衝突したとき、反発係数に応じて速度が反転することを確認する
  // ここは solver の最も基本的な跳ね返り仕様を守る確認
  check("head-on collision reverses bodyA x velocity", velocityA[0] < 0.0, formatValue(velocityA));
  check("head-on collision reverses bodyB x velocity", velocityB[0] > 0.0, formatValue(velocityB));
  check("restitution 0.5 halves post-collision speed", almostEqual(Math.abs(velocityA[0]), 5.0) && almostEqual(Math.abs(velocityB[0]), 5.0), `${velocityA[0]}, ${velocityB[0]}`);

  const contacts = world.getLastContacts();
  // 直近 step の接触一覧に、接触した body と normal と penetration が残ることを確認する
  // これは event、debug 表示、上位ロジックが接触情報を読むための契約
  check("getLastContacts returns at least one contact", contacts.length >= 1, formatValue(contacts.length));
  if (contacts.length >= 1) {
    check("contact stores body references", contacts[0].bodyA === bodyA || contacts[0].bodyB === bodyA);
    check("contact stores penetration", contacts[0].penetration > 0.0, formatValue(contacts[0].penetration));
    check("contact stores collision normal", Array.isArray(contacts[0].normal) && contacts[0].normal.length === 3, formatValue(contacts[0].normal));
  }
};

const runBoxFaceManifoldChecks = () => {
  log("");
  log("[PhysicsSpace / box face manifold persistence]");
  const world = createWorld();
  world.setGravity([0.0, 0.0, 0.0]);
  world.setDefaultRestitution(0.0);
  const space = new Space();

  const staticBox = createBoxBody(space, "face-static-box", {
    bodyType: "static",
    position: [2.0, 0.0, 0.0],
    size: [4.0, 4.0, 4.0],
    restitution: 0.0
  });
  const slidingBox = createBoxBody(space, "face-sliding-box", {
    bodyType: "kinematic",
    position: [-1.9, 0.0, -0.6],
    size: [4.0, 4.0, 4.0],
    restitution: 0.0
  });
  world.addBody(staticBox);
  world.addBody(slidingBox);

  const manifoldPointCounts = [];
  for (let i = 0; i < 4; i++) {
    slidingBox.setPosition(-1.9, 0.0, -0.6 + i * 0.4);
    world.stepFixed(1.0 / 120.0);
    const manifolds = world.getLastManifolds();
    const pair = manifolds.find((manifold) => (
      (manifold.bodyA === staticBox && manifold.bodyB === slidingBox)
      || (manifold.bodyA === slidingBox && manifold.bodyB === staticBox)
    ));
    manifoldPointCounts.push(pair?.contacts?.length ?? 0);
  }
  // face-face の箱接触では、接触面を 4 点前後の patch として維持できることを確認する
  // ここが 1 点へ崩れると、回転より横滑りが目立ちやすくなる
  check(
    "box face-face contact keeps 4-point manifold while sliding tangentially",
    manifoldPointCounts.every((count) => count >= 4),
    formatValue(manifoldPointCounts)
  );

  const edgeWorld = createWorld();
  edgeWorld.setGravity([0.0, 0.0, 0.0]);
  edgeWorld.setDefaultRestitution(0.0);
  const edgeSpace = new Space();
  const edgeStaticBox = createBoxBody(edgeSpace, "edge-static-box", {
    bodyType: "static",
    position: [2.0, 0.0, 0.0],
    size: [6.0, 6.0, 6.0],
    restitution: 0.0
  });
  const edgeBeam = createBoxBody(edgeSpace, "edge-beam-box", {
    bodyType: "kinematic",
    position: [-1.9, 0.0, -1.2],
    size: [2.0, 12.0, 2.0],
    attitude: [0.0, 0.0, 16.0],
    restitution: 0.0
  });
  edgeWorld.addBody(edgeStaticBox);
  edgeWorld.addBody(edgeBeam);

  const edgePointCounts = [];
  for (let i = 0; i < 8; i++) {
    edgeBeam.setPosition(-1.9 + i * 0.05, 0.0, -1.2 + i * 0.18);
    edgeWorld.stepFixed(1.0 / 120.0);
    const manifolds = edgeWorld.getLastManifolds();
    const pair = manifolds.find((manifold) => (
      (manifold.bodyA === edgeStaticBox && manifold.bodyB === edgeBeam)
      || (manifold.bodyA === edgeBeam && manifold.bodyB === edgeStaticBox)
    ));
    edgePointCounts.push(pair?.contacts?.length ?? 0);
  }
  // beam に近い細長い box でも、少しずれた接触で face patch が 1 点へ崩れないことを確認する
  // ここが維持できないと、visual では回転より横滑りが目立ちやすい
  check(
    "box edge-like contact keeps 4-point manifold while sliding tangentially",
    edgePointCounts.every((count) => count >= 4),
    formatValue(edgePointCounts)
  );
};

const runAngularRotationChecks = () => {
  log("");
  log("[PhysicsSpace / angular rotation]");

  const spinWorld = createWorld();
  spinWorld.setGravity([0.0, 0.0, 0.0]);
  spinWorld.setSleepLinearThreshold(0.001);
  spinWorld.setSleepAngularThreshold(0.001);
  const spinSpace = new Space();

  const spinBody = createBoxBody(spinSpace, "spin-body", {
    bodyType: "dynamic",
    position: [0.0, 0.0, 0.0],
    angularVelocity: [90.0, 0.0, 0.0],
    angularDamping: 0.5
  });
  spinWorld.addBody(spinBody);
  spinWorld.stepFixed(0.5);
  const spinAttitude = spinBody.getLocalAttitude();
  const spinAngularVelocity = spinBody.getAngularVelocity();
  // 角速度が姿勢へ積分され、角減衰で角速度が下がることを確認する
  // 回転の見た目と body の内部状態が同じ時間進行を使っているかを見る
  check("angular velocity advances body attitude", spinAttitude[0] > 30.0 && spinAttitude[0] < 40.0, formatValue(spinAttitude));
  check("angular damping reduces angular velocity", spinAngularVelocity[0] > 60.0 && spinAngularVelocity[0] < 70.0, formatValue(spinAngularVelocity));

  const pitchWorld = createWorld();
  pitchWorld.setGravity([0.0, 0.0, 0.0]);
  pitchWorld.setSleepLinearThreshold(0.001);
  pitchWorld.setSleepAngularThreshold(0.001);
  const pitchSpace = new Space();
  const pitchBody = createBoxBody(pitchSpace, "pitch-body", {
    bodyType: "dynamic",
    position: [0.0, 0.0, 0.0],
    angularVelocity: [0.0, 120.0, 0.0],
    angularDamping: 0.0
  });
  pitchWorld.addBody(pitchBody);
  for (let i = 0; i < 240; i++) {
    pitchWorld.stepFixed(1.0 / 120.0);
  }
  const pitchAttitude = pitchBody.getLocalAttitude();
  // pitch 軸まわりの回転を長く進めても姿勢値が非有限にならないことを確認する
  // quaternion を主状態にする理由は、Euler 角だけで進めると特定角度付近で壊れやすいため
  check(
    "pitch-axis angular velocity keeps finite attitude",
    Number.isFinite(pitchAttitude[0]) && Number.isFinite(pitchAttitude[1]) && Number.isFinite(pitchAttitude[2]),
    formatValue(pitchAttitude)
  );

  const torqueWorld = createWorld();
  torqueWorld.setGravity([0.0, 0.0, 0.0]);
  torqueWorld.setSleepLinearThreshold(0.001);
  torqueWorld.setSleepAngularThreshold(0.001);
  const torqueSpace = new Space();
  const torqueBody = createBoxBody(torqueSpace, "torque-body", {
    bodyType: "dynamic",
    position: [0.0, 0.0, 0.0],
    angularDamping: 0.0
  });
  torqueBody.applyTorque([20.0, 0.0, 0.0]);
  torqueWorld.addBody(torqueBody);
  torqueWorld.stepFixed(0.5);
  const torqueAttitude = torqueBody.getLocalAttitude();
  const torqueAngularVelocity = torqueBody.getAngularVelocity();
  // torque は角速度へ変換され、その角速度がさらに姿勢へ反映されることを確認する
  // applyTorque は直接姿勢を変える命令ではなく、次の物理 step で角速度を変える入力
  // 既定 box は 4x4x4 / mass=1 なので、local inertia は 32/12 = 2.666...
  // inverse inertia は 0.375 で、torque=20 は角加速度 7.5 rad/s^2 を作る
  // PhysicsSpace は公開 API の angularVelocity を degree/sec として保持するため、
  // 0.5 秒後の角速度は 3.75 rad/s = 214.859... degree/sec になる
  // その角速度を同じ step 内で姿勢へ積分するため、yaw は約 107.429 度進む
  check("torque updates angular velocity", almostEqual(torqueAngularVelocity[0], 214.8591731740587), formatValue(torqueAngularVelocity));
  check("torque-driven angular velocity updates attitude", almostEqual(torqueAttitude[0], 107.42958658702936), formatValue(torqueAttitude));

  const fixedWorld = createWorld();
  fixedWorld.setGravity([0.0, 0.0, 0.0]);
  fixedWorld.setSleepLinearThreshold(0.001);
  fixedWorld.setSleepAngularThreshold(0.001);
  const fixedSpace = new Space();
  const fixedBody = createBoxBody(fixedSpace, "fixed-rotation-body", {
    bodyType: "dynamic",
    position: [0.0, 0.0, 0.0],
    angularVelocity: [90.0, 0.0, 0.0]
  });
  fixedBody.setFixedRotation(true);
  fixedWorld.addBody(fixedBody);
  fixedWorld.stepFixed(0.5);
  const fixedAttitude = fixedBody.getLocalAttitude();
  const fixedAngularVelocity = fixedBody.getAngularVelocity();
  // fixedRotation は回転禁止の指定なので、姿勢更新を止め、角速度も消すことを確認する
  // キャラクターや倒したくない物体を扱うときの基本仕様
  check("fixedRotation prevents attitude updates", almostEqual(fixedAttitude[0], 0.0), formatValue(fixedAttitude));
  check("fixedRotation clears angular velocity during step", almostEqual(fixedAngularVelocity[0], 0.0), formatValue(fixedAngularVelocity));
};

const runAngularContactSolverChecks = () => {
  log("");
  log("[PhysicsSpace / angular contact solver]");

  const createOffCenterHit = ({ fixedRotation = false } = {}) => {
    const world = createWorld();
    world.setGravity([0.0, 0.0, 0.0]);
    world.setDefaultRestitution(0.0);
    world.setDefaultFriction(0.0);
    world.setSolverIterations(1);
    const space = new Space();
    const box = createBoxBody(space, "angular-hit-box", {
      bodyType: "dynamic",
      position: [0.0, 0.0, 0.0],
      size: [4.0, 4.0, 4.0],
      mass: 2.0
    });
    box.setFixedRotation(fixedRotation);
    const sphere = createSphereBody(space, "angular-hit-sphere", {
      bodyType: "dynamic",
      position: [-3.1, 1.5, 0.0],
      radius: 1.0,
      mass: 1.0,
      velocity: [10.0, 0.0, 0.0]
    });
    world.addBody(box);
    world.addBody(sphere);
    world.stepFixed(0.02);
    return {
      box,
      sphere,
      contacts: world.getLastContacts()
    };
  };

  const spinningHit = createOffCenterHit();
  const spinningAngularVelocity = spinningHit.box.getAngularVelocity();
  // 中心から外れた位置に impulse が入ると、線形速度だけでなく角速度も発生することを確認する
  // 慣性テンソル込み solver では、接触点の r x impulse が angular velocity へ反映される
  check(
    "off-center contact creates angular velocity on box",
    Math.abs(spinningAngularVelocity[2]) > 0.1,
    formatValue(spinningAngularVelocity)
  );
  // contact point が保存されることを確認する
  // 回転 contact solver は body 中心ではなく接触点からの腕 r を使うため、point が必要になる
  check(
    "contact stores point for angular impulse",
    Array.isArray(spinningHit.contacts[0]?.point) && spinningHit.contacts[0].point.length === 3,
    formatValue(spinningHit.contacts.map((contact) => contact.point))
  );

  const fixedHit = createOffCenterHit({ fixedRotation: true });
  const fixedAngularVelocity = fixedHit.box.getAngularVelocity();
  // fixedRotation の body は off-center contact でも回転しないことを確認する
  // キャラクターなど倒したくない body では inverse inertia を 0 扱いにする
  check(
    "fixedRotation blocks angular contact impulse",
    almostEqual(fixedAngularVelocity[0], 0.0) && almostEqual(fixedAngularVelocity[1], 0.0) && almostEqual(fixedAngularVelocity[2], 0.0),
    formatValue(fixedAngularVelocity)
  );
};

const runBroadphaseAabbCullingChecks = () => {
  log("");
  log("[PhysicsSpace / broadphase AABB culling]");

  class CountingBoxCollider extends BoxCollider {
    constructor(size, counter) {
      super(size);
      this.counter = counter;
    }

    buildContactWith(position, otherCollider, otherPosition, bodyA, bodyB) {
      this.counter.count += 1;
      return super.buildContactWith(position, otherCollider, otherPosition, bodyA, bodyB);
    }
  }

  const farWorld = createWorld();
  farWorld.setGravity([0.0, 0.0, 0.0]);
  const farSpace = new Space();
  const farCounter = { count: 0 };
  const farA = farSpace.addPhysicsNode(null, "broadphase-far-a", {
    bodyType: "static"
  });
  farA.setPosition(0.0, 0.0, 0.0);
  farA.setCollider(new CountingBoxCollider([2.0, 2.0, 2.0], farCounter));
  const farB = createBoxBody(farSpace, "broadphase-far-b", {
    bodyType: "static",
    position: [20.0, 0.0, 0.0],
    size: [2.0, 2.0, 2.0]
  });
  farWorld.addBody(farA);
  farWorld.addBody(farB);
  farWorld.stepFixed(0.1);
  // 離れた有限 collider は broadphase の AABB で除外され、重い narrowphase に進まないことを確認する
  // CountingBoxCollider は narrowphase 入口が呼ばれた回数を数える監視用 collider
  check("broadphase AABB culls separated finite colliders before narrowphase", farCounter.count === 0, formatValue(farCounter));

  const nearWorld = createWorld();
  nearWorld.setGravity([0.0, 0.0, 0.0]);
  const nearSpace = new Space();
  const nearCounter = { count: 0 };
  const nearA = nearSpace.addPhysicsNode(null, "broadphase-near-a", {
    bodyType: "static"
  });
  nearA.setPosition(0.0, 0.0, 0.0);
  nearA.setCollider(new CountingBoxCollider([2.0, 2.0, 2.0], nearCounter));
  const nearB = createBoxBody(nearSpace, "broadphase-near-b", {
    bodyType: "static",
    position: [1.0, 0.0, 0.0],
    size: [2.0, 2.0, 2.0]
  });
  nearWorld.addBody(nearA);
  nearWorld.addBody(nearB);
  nearWorld.stepFixed(0.1);
  // AABB が重なる有限 collider は broadphase で残り、narrowphase に渡されることを確認する
  // 粗い判定で本当に当たる可能性がある組を落とさないための仕様
  check("broadphase AABB keeps overlapping finite colliders for narrowphase", nearCounter.count >= 1, formatValue(nearCounter));

  const collectPairsForMode = (mode) => {
    const compareWorld = createWorld();
    compareWorld.setGravity([0.0, 0.0, 0.0]);
    compareWorld.setBroadphaseMode(mode);
    const compareSpace = new Space();
    const specs = [
      ["compare-a", [0.0, 0.0, 0.0]],
      ["compare-b", [1.0, 0.0, 0.0]],
      ["compare-c", [8.0, 0.0, 0.0]],
      ["compare-d", [9.0, 0.0, 0.0]]
    ];
    for (let i = 0; i < specs.length; i++) {
      const body = createBoxBody(compareSpace, specs[i][0], {
        bodyType: "static",
        position: specs[i][1],
        size: [4.0, 4.0, 4.0]
      });
      compareWorld.addBody(body);
    }
    compareWorld.stepFixed(0.1);
    return compareWorld.getLastContacts()
      .map((contact) => [contact.bodyA.name, contact.bodyB.name].sort().join("/"))
      .sort();
  };
  const bruteForcePairs = collectPairsForMode("bruteForce");
  const sweepPairs = collectPairsForMode("sweepAabb");
  // 全組み合わせを見る方式と、x 軸 sweep で候補を絞る方式が同じ接触結果になることを確認する
  // 高速化しても結果の意味を変えないための回帰確認
  check("sweepAabb broadphase returns same finite contact pairs as bruteForce", JSON.stringify(sweepPairs) === JSON.stringify(bruteForcePairs), formatValue({ bruteForcePairs, sweepPairs }));
};

const runOrientedBoxColliderChecks = () => {
  log("");
  log("[PhysicsSpace / oriented BoxCollider]");
  const space = new Space();
  const world = new PhysicsSpace({
    gravity: [0.0, 0.0, 0.0],
    fixedTimeStepMs: 1000.0 / 120.0,
    solverIterations: 1
  });
  const rotatedBox = createBoxBody(space, "rotated-box", {
    bodyType: "static",
    position: [0.0, 0.0, 0.0],
    attitude: [45.0, 0.0, 0.0],
    size: [8.0, 2.0, 2.0]
  });
  world.addBody(rotatedBox);

  const aabb = rotatedBox.getCollider().getAabb(rotatedBox.getPosition(), rotatedBox.getQuat());
  // 回転した box の broadphase 用 AABB が、local half extents そのままではなく外接 AABB になることを確認する
  // OBB は向き付き箱、AABB は軸に平行な外側の箱
  check("rotated box AABB changes x extent from local half", aabb.max[0] < 4.0 && aabb.max[0] > 3.4, formatValue(aabb));
  check("rotated box AABB expands z extent from local half", aabb.max[2] > 3.4, formatValue(aabb));

  const rayHit = world.raycast([0.0, 0.0, 8.0], [0.0, 0.0, -1.0]);
  // raycast が回転した box に当たり、hit normal も回転後の面方向を返すことを確認する
  // normal が world 軸だけを向いているなら、まだ AABB として判定している疑いがある
  check("raycast hits rotated oriented box", rayHit?.body === rotatedBox, formatValue(rayHit));
  check(
    "raycast normal follows box orientation",
    rayHit !== null && Math.abs(rayHit.normal[0]) > 0.25 && Math.abs(rayHit.normal[2]) > 0.25,
    formatValue(rayHit?.normal)
  );

  const aabbHits = world.queryAabb([-2.8, -0.5, 2.2], [-2.2, 0.5, 2.8]);
  // queryAabb が回転後にだけ存在する斜め角を拾えることを確認する
  // 外接 AABB だけで返すのではなく、query と OBB の重なり判定まで進んでいるかを見る
  check("queryAabb sees rotated oriented box corner", aabbHits.some((hit) => hit.body === rotatedBox), formatValue(aabbHits));

  const sphereHits = world.overlapSphere([-2.5, 0.0, 2.5], 0.45);
  // overlapSphere が OBB 上の最近傍点を使い、回転した box の斜め角を拾えることを確認する
  check("overlapSphere sees rotated oriented box corner", sphereHits.some((hit) => hit.body === rotatedBox), formatValue(sphereHits));

  const sphere = createSphereBody(space, "obb-sphere", {
    bodyType: "dynamic",
    position: [-2.5, 0.0, 2.5],
    radius: 0.6,
    mass: 1.0,
    velocity: [0.0, 0.0, 0.0]
  });
  world.addBody(sphere);
  world.stepFixed(1.0 / 120.0);
  const pairs = world.getLastContacts().map((contact) => `${contact.bodyA.name}/${contact.bodyB.name}`);
  // sphere と回転 box の組み合わせが broadphase から narrowphase の dispatch に乗ることを確認する
  // dispatch は collider 型の組み合わせから正しい接触式を選ぶ処理
  check("sphere contact reaches rotated oriented box narrowphase", pairs.some((pair) => pair.includes("rotated-box") && pair.includes("obb-sphere")), formatValue(pairs));

  const boxWorld = new PhysicsSpace({
    gravity: [0.0, 0.0, 0.0],
    fixedTimeStepMs: 1000.0 / 120.0,
    solverIterations: 1
  });
  const boxSpace = new Space();
  const staticObb = createBoxBody(boxSpace, "static-obb-box", {
    bodyType: "static",
    position: [0.0, 0.0, 0.0],
    attitude: [45.0, 0.0, 0.0],
    size: [8.0, 2.0, 2.0]
  });
  const dynamicBox = createBoxBody(boxSpace, "dynamic-obb-box", {
    bodyType: "dynamic",
    position: [-2.5, 0.0, 2.5],
    size: [0.8, 0.8, 0.8]
  });
  boxWorld.addBody(staticObb);
  boxWorld.addBody(dynamicBox);
  boxWorld.stepFixed(1.0 / 120.0);
  const boxPairs = boxWorld.getLastContacts().map((contact) => `${contact.bodyA.name}/${contact.bodyB.name}`);
  // box 同士の接触が AABB ではなく OBB の 15 軸 SAT 判定へ届くことを確認する
  // SAT は分離軸定理で、どこかに分離できる軸があれば非接触と判断する方法
  check("box-box contact reaches rotated oriented box narrowphase", boxPairs.some((pair) => pair.includes("static-obb-box") && pair.includes("dynamic-obb-box")), formatValue(boxPairs));

  const capsuleWorld = new PhysicsSpace({
    gravity: [0.0, 0.0, 0.0],
    fixedTimeStepMs: 1000.0 / 120.0,
    solverIterations: 1
  });
  const capsuleSpace = new Space();
  const capsuleObb = createBoxBody(capsuleSpace, "capsule-obb-box", {
    bodyType: "static",
    position: [0.0, 0.0, 0.0],
    attitude: [45.0, 0.0, 0.0],
    size: [8.0, 2.0, 2.0]
  });
  const capsule = createCapsuleBody(capsuleSpace, "obb-capsule", {
    bodyType: "dynamic",
    position: [-2.5, 0.0, 2.5],
    radius: 0.45,
    segmentLength: 1.0
  });
  capsuleWorld.addBody(capsuleObb);
  capsuleWorld.addBody(capsule);
  capsuleWorld.stepFixed(1.0 / 120.0);
  const capsulePairs = capsuleWorld.getLastContacts().map((contact) => `${contact.bodyA.name}/${contact.bodyB.name}`);
  // capsule と回転 box の接触が、box の向きを読んだ capsule-box 判定へ届くことを確認する
  // capsule 自体はまだ y 軸方向だが、相手 box は OBB として扱う
  check("capsule contact reaches rotated oriented box narrowphase", capsulePairs.some((pair) => pair.includes("capsule-obb-box") && pair.includes("obb-capsule")), formatValue(capsulePairs));
};

const runCollisionLayerChecks = () => {
  log("");
  log("[PhysicsSpace / collision layers]");

  const maskedWorld = createWorld();
  maskedWorld.setGravity([0.0, 0.0, 0.0]);
  const maskedSpace = new Space();
  const maskedA = createBoxBody(maskedSpace, "layer-masked-a", {
    bodyType: "static",
    position: [0.0, 0.0, 0.0],
    size: [4.0, 4.0, 4.0]
  });
  const maskedB = createBoxBody(maskedSpace, "layer-masked-b", {
    bodyType: "static",
    position: [1.0, 0.0, 0.0],
    size: [4.0, 4.0, 4.0]
  });
  maskedA.setCollisionLayer(0x01);
  maskedA.setCollisionMask(0x02);
  maskedB.setCollisionLayer(0x04);
  maskedB.setCollisionMask(0x01);
  maskedWorld.addBody(maskedA);
  maskedWorld.addBody(maskedB);
  maskedWorld.stepFixed(0.1);
  // collision mask が互いに許可していない pair は、接触候補から除外されることを確認する
  // layer は自分の所属、mask は自分が当たりたい相手の所属を表す
  check("collision mask prevents contact pair before narrowphase", maskedWorld.getLastContacts().length === 0, formatValue(maskedWorld.getLastContacts().length));

  maskedB.setCollisionLayer(0x02);
  maskedWorld.stepFixed(0.1);
  // layer と mask が噛み合ったときは、同じ配置でも接触が有効になることを確認する
  check("collision mask allows contact when both sides include each other", maskedWorld.getLastContacts().length >= 1, formatValue(maskedWorld.getLastContacts().length));

  const queryWorld = createWorld();
  queryWorld.setGravity([0.0, 0.0, 0.0]);
  const querySpace = new Space();
  const layerOne = createBoxBody(querySpace, "query-layer-one", {
    bodyType: "static",
    position: [0.0, 0.0, -6.0],
    size: [2.0, 2.0, 2.0]
  });
  const layerTwo = createBoxBody(querySpace, "query-layer-two", {
    bodyType: "static",
    position: [0.0, 0.0, 0.0],
    size: [2.0, 2.0, 2.0]
  });
  layerOne.setCollisionLayer(0x01);
  layerTwo.setCollisionLayer(0x02);
  queryWorld.addBody(layerOne);
  queryWorld.addBody(layerTwo);

  const rayHit = queryWorld.raycast([0.0, 0.0, -10.0], [0.0, 0.0, 1.0], {
    layerMask: 0x02
  });
  // raycast の layerMask が、指定 layer の body だけを対象にすることを確認する
  check("raycast layerMask selects matching layer", rayHit?.body === layerTwo, formatValue(rayHit ? { body: rayHit.body.name } : null));

  const aabbHits = queryWorld.queryAabb([-2.0, -2.0, -8.0], [2.0, 2.0, 2.0], {
    layerMask: 0x01
  });
  // queryAabb の layerMask が、範囲内に複数 body がいても指定 layer だけを返すことを確認する
  check("queryAabb layerMask selects matching layer", aabbHits.length === 1 && aabbHits[0].body === layerOne, formatValue(aabbHits.map((hit) => hit.body.name)));

  const sphereHits = queryWorld.overlapSphere([0.0, 0.0, 0.0], 2.0, {
    layerMask: 0x02
  });
  // overlapSphere の layerMask が、球範囲内の対象を layer で絞れることを確認する
  check("overlapSphere layerMask selects matching layer", sphereHits.length === 1 && sphereHits[0].body === layerTwo, formatValue(sphereHits.map((hit) => hit.body.name)));
};

const runContactEventChecks = () => {
  log("");
  log("[PhysicsSpace / contact begin-stay-end / listeners]");
  const world = createWorld();
  world.setGravity([0.0, 0.0, 0.0]);
  world.setDefaultRestitution(0.0);
  const listenerCalls = [];
  const beginListener = (contact, phase, sourceWorld) => {
    listenerCalls.push({
      phase,
      bodyA: contact.bodyA,
      bodyB: contact.bodyB,
      sourceWorld
    });
  };
  const stayListener = (contact, phase, sourceWorld) => {
    listenerCalls.push({
      phase,
      bodyA: contact.bodyA,
      bodyB: contact.bodyB,
      sourceWorld
    });
  };
  const endListener = (contact, phase, sourceWorld) => {
    listenerCalls.push({
      phase,
      bodyA: contact.bodyA,
      bodyB: contact.bodyB,
      sourceWorld
    });
  };
  world.onBeginContact(beginListener);
  world.onBeginContact(beginListener);
  world.onStayContact(stayListener);
  world.onEndContact(endListener);

  const space = new Space();
  const floor = createPlaneBody(space, "event-floor", {
    bodyType: "static",
    position: [0.0, 0.0, 0.0],
    normal: [0.0, 1.0, 0.0],
    restitution: 0.0,
    friction: 0.5
  });
  const box = createBoxBody(space, "event-box", {
    bodyType: "kinematic",
    position: [0.0, 1.5, 0.0],
    size: [4.0, 4.0, 4.0],
    mass: 1.0,
    restitution: 0.0,
    linearDamping: 0.0
  });
  world.addBody(floor);
  world.addBody(box);

  world.stepFixed(0.1);
  const beginEvents = world.getLastContactEvents();
  const beginSummary = summarizeContactEvents(beginEvents);
  // 最初に接触した step は begin だけを出し、stay や end を混ぜないことを確認する
  // begin は接触開始、stay は接触継続、end は接触終了を意味する
  check("begin listener fires once for first contact", listenerCalls.length === 1, formatValue(summarizeListenerCalls(listenerCalls)));
  check("begin listener receives begin phase", listenerCalls[0]?.phase === "begin", formatValue(summarizeListenerCalls(listenerCalls)));
  check("begin listener receives source world", listenerCalls[0]?.sourceWorld === world);
  check("first touching step reports begin contact", beginEvents.begin.length >= 1, formatValue(beginSummary));
  check("first touching step does not report stay contact", beginEvents.stay.length === 0, formatValue(beginSummary));
  check("first touching step does not report end contact", beginEvents.end.length === 0, formatValue(beginSummary));

  world.stepFixed(0.1);
  const stayEvents = world.getLastContactEvents();
  const staySummary = summarizeContactEvents(stayEvents);
  // 接触が続く次の step は stay を出し、begin を繰り返さないことを確認する
  // begin が毎 step 出ると、一度だけ実行したい効果音や処理が暴発する
  check("stay listener fires on continued contact", listenerCalls.length === 2, formatValue(summarizeListenerCalls(listenerCalls)));
  check("stay listener receives stay phase", listenerCalls[1]?.phase === "stay", formatValue(summarizeListenerCalls(listenerCalls)));
  check("continued touching step reports stay contact", stayEvents.stay.length >= 1, formatValue(staySummary));
  check("continued touching step does not repeat begin contact", stayEvents.begin.length === 0, formatValue(staySummary));

  world.offEndContact(endListener);
  box.setPosition(0.0, 8.0, 0.0);
  world.stepFixed(0.1);
  const endEvents = world.getLastContactEvents();
  const endSummary = summarizeContactEvents(endEvents);
  // 離れた step では end を出し、begin と stay は空になることを確認する
  // offEndContact 後は終了 listener が呼ばれないことも同時に見る
  check("offEndContact prevents further listener calls", listenerCalls.length === 2, formatValue(summarizeListenerCalls(listenerCalls)));
  check("separating step reports end contact", endEvents.end.length >= 1, formatValue(endSummary));
  check("separating step clears begin contact", endEvents.begin.length === 0, formatValue(endSummary));
  check("separating step clears stay contact", endEvents.stay.length === 0, formatValue(endSummary));
};

const runPlaneAndFrictionChecks = () => {
  log("");
  log("[PhysicsSpace / plane / friction]");
  const world = createWorld();
  world.setGravity([0.0, 0.0, 0.0]);
  world.setDefaultRestitution(0.0);
  world.setDefaultFriction(0.6);

  const space = new Space();
  const plane = createPlaneBody(space, "ground-plane", {
    bodyType: "static",
    position: [0.0, 0.0, 0.0],
    normal: [0.0, 1.0, 0.0],
    restitution: 0.0,
    friction: 0.8
  });
  const box = createBoxBody(space, "sliding-box", {
    bodyType: "dynamic",
    position: [0.0, 1.8, 0.0],
    size: [4.0, 4.0, 4.0],
    mass: 1.0,
    velocity: [4.0, -1.0, 0.0],
    restitution: 0.0,
    linearDamping: 0.0
  });
  world.addBody(plane);
  world.addBody(box);

  world.stepFixed(0.1);
  const velocity = box.getLinearVelocity();
  const contacts = world.getLastContacts();
  // plane と box の接触が作られ、normal が plane の表側を向くことを確認する
  // この normal の向きが逆だと押し戻しや反発が床の下向きに働く
  check("plane collider produces a contact", contacts.length >= 1, formatValue(contacts.length));
  if (contacts.length >= 1) {
    check("plane contact normal points upward from plane", contacts[0].normal[1] > 0.9, formatValue(contacts[0].normal));
  }
  // 摩擦で接線方向速度が減り、反発係数 0 では上向きに跳ねないことを確認する
  // 床の上で滑る body の基本挙動を守る確認
  check("friction reduces tangential x velocity on plane contact", velocity[0] < 4.0, formatValue(velocity));
  checkKnownIssue("friction contact does not bounce upward when restitution is zero", Math.abs(velocity[1]) < 0.001, formatValue(velocity));

  const beamWorld = createWorld();
  const beamSpace = new Space();
  const zeroRestitutionFloor = createPlaneBody(beamSpace, "zero-restitution-floor", {
    bodyType: "static",
    position: [0.0, 0.0, 0.0],
    normal: [0.0, 1.0, 0.0],
    restitution: 0.0,
    friction: 0.9
  });
  const rotatingBeam = createBoxBody(beamSpace, "rotating-beam", {
    bodyType: "dynamic",
    position: [0.0, 30.0, 0.0],
    attitude: [8.0, 0.0, 14.0],
    size: [13.2, 2.5, 2.5],
    velocity: [2.0, -6.0, 0.0],
    angularVelocity: [72.0, 0.0, 54.0],
    restitution: 0.6,
    linearDamping: 0.28,
    angularDamping: 0.1
  });
  beamWorld.addBody(zeroRestitutionFloor);
  beamWorld.addBody(rotatingBeam);
  let maxBeamAngularSpeed = 0.0;
  let maxBeamUpwardVelocity = 0.0;
  for (let i = 0; i < 900; i++) {
    beamWorld.stepFixed(1.0 / 120.0);
    const beamAngularVelocity = rotatingBeam.getAngularVelocity();
    const beamVelocity = rotatingBeam.getLinearVelocity();
    maxBeamAngularSpeed = Math.max(
      maxBeamAngularSpeed,
      Math.hypot(beamAngularVelocity[0], beamAngularVelocity[1], beamAngularVelocity[2])
    );
    maxBeamUpwardVelocity = Math.max(maxBeamUpwardVelocity, beamVelocity[1]);
  }
  // 反発 0 の床に box が当たる場合、box 側の restitution を床反発として使わないことを確認する
  // これを許すと、長い beam の端接触で上向き impulse が torque へ化け、支え無しでも立ち上がって暴れる
  checkKnownIssue("zero-restitution plane suppresses rotating box bounce", maxBeamAngularSpeed < 180.0 && maxBeamUpwardVelocity < 2.0, formatValue({
    maxBeamAngularSpeed,
    maxBeamUpwardVelocity
  }));
};

const runSphereColliderDispatchChecks = () => {
  log("");
  log("[PhysicsSpace / sphere collider dispatch]");

  const bounceWorld = createWorld();
  bounceWorld.setGravity([0.0, 0.0, 0.0]);
  bounceWorld.setDefaultRestitution(0.5);
  bounceWorld.setSleepLinearThreshold(0.01);
  const bounceSpace = new Space();
  const sphereA = createSphereBody(bounceSpace, "sphere-a", {
    bodyType: "dynamic",
    position: [-2.0, 0.0, 0.0],
    radius: 2.0,
    mass: 1.0,
    velocity: [10.0, 0.0, 0.0],
    restitution: 0.5
  });
  const sphereB = createSphereBody(bounceSpace, "sphere-b", {
    bodyType: "dynamic",
    position: [2.0, 0.0, 0.0],
    radius: 2.0,
    mass: 1.0,
    velocity: [-10.0, 0.0, 0.0],
    restitution: 0.5
  });
  bounceWorld.addBody(sphereA);
  bounceWorld.addBody(sphereB);

  bounceWorld.stepFixed(0.1);
  const velocityA = sphereA.getLinearVelocity();
  const velocityB = sphereB.getLinearVelocity();
  const sphereContacts = bounceWorld.getLastContacts();
  // SphereCollider 同士が broadphase と narrowphase を通って接触し、反発で速度が反転することを確認する
  // 新しい collider 型を足したとき、箱専用の経路だけに閉じていないかを見る
  check("sphere-sphere broadphase/narrowphase produces contact", sphereContacts.length >= 1, formatValue(sphereContacts.length));
  check("sphere-sphere contact reverses sphereA x velocity", velocityA[0] < 0.0, formatValue(velocityA));
  check("sphere-sphere contact reverses sphereB x velocity", velocityB[0] > 0.0, formatValue(velocityB));

  const mixedWorld = createWorld();
  mixedWorld.setGravity([0.0, 0.0, 0.0]);
  mixedWorld.setDefaultRestitution(0.0);
  const mixedSpace = new Space();
  const plane = createPlaneBody(mixedSpace, "sphere-plane", {
    bodyType: "static",
    position: [0.0, 0.0, 0.0],
    normal: [0.0, 1.0, 0.0]
  });
  const box = createBoxBody(mixedSpace, "sphere-box", {
    bodyType: "static",
    position: [6.0, 0.0, 0.0],
    size: [4.0, 4.0, 4.0]
  });
  const sphere = createSphereBody(mixedSpace, "dispatch-sphere", {
    bodyType: "dynamic",
    position: [3.0, 1.0, 0.0],
    radius: 2.0,
    mass: 1.0,
    velocity: [0.0, -1.0, 0.0]
  });
  mixedWorld.addBody(plane);
  mixedWorld.addBody(box);
  mixedWorld.addBody(sphere);

  mixedWorld.stepFixed(0.1);
  const mixedContacts = mixedWorld.getLastContacts();
  const mixedPairs = mixedContacts.map((contact) => `${contact.bodyA.name}/${contact.bodyB.name}`);
  // sphere が plane と box の両方へ正しい接触式で dispatch されることを確認する
  // 物理空間側が collider 型ごとの式を直接抱え込まず、collider 側へ渡せているかを見る
  check("sphere-plane pair reaches narrowphase through dispatch", mixedPairs.some((pair) => pair.includes("sphere-plane") && pair.includes("dispatch-sphere")), formatValue(mixedPairs));
  check("sphere-box pair reaches narrowphase through dispatch", mixedPairs.some((pair) => pair.includes("sphere-box") && pair.includes("dispatch-sphere")), formatValue(mixedPairs));

  const queryWorld = createWorld();
  queryWorld.setGravity([0.0, 0.0, 0.0]);
  const querySpace = new Space();
  const querySphere = createSphereBody(querySpace, "query-sphere", {
    bodyType: "static",
    position: [0.0, 0.0, 0.0],
    radius: 3.0
  });
  const farSphere = createSphereBody(querySpace, "query-far-sphere", {
    bodyType: "static",
    position: [20.0, 0.0, 0.0],
    radius: 2.0
  });
  queryWorld.addBody(querySphere);
  queryWorld.addBody(farSphere);

  const rayHit = queryWorld.raycast([-10.0, 0.0, 0.0], [1.0, 0.0, 0.0]);
  // raycast が sphere の表面を hit し、中心ではなく手前の表面までの距離を返すことを確認する
  check("raycast dispatch hits sphere collider", rayHit?.body === querySphere, formatValue(rayHit ? { body: rayHit.body.name, distance: rayHit.distance } : null));
  check("sphere raycast distance matches front surface", almostEqual(rayHit?.distance ?? -1.0, 7.0), formatValue(rayHit ? { distance: rayHit.distance } : null));

  const aabbHits = queryWorld.queryAabb([-4.0, -1.0, -1.0], [-2.0, 1.0, 1.0]);
  const aabbNames = aabbHits.map((hit) => hit.body.name);
  // queryAabb が sphere の外接 AABB を使って近い sphere を含め、遠い sphere を除外することを確認する
  check("queryAabb dispatch includes sphere collider", aabbNames.includes("query-sphere"), formatValue(aabbNames));
  check("queryAabb dispatch excludes far sphere", !aabbNames.includes("query-far-sphere"), formatValue(aabbNames));

  const sphereHits = queryWorld.overlapSphere([4.0, 0.0, 0.0], 1.25);
  const sphereHitNames = sphereHits.map((hit) => hit.body.name);
  // overlapSphere が sphere と sphere の距離判定を使って近い対象だけを返すことを確認する
  check("overlapSphere dispatch includes sphere collider", sphereHitNames.includes("query-sphere"), formatValue(sphereHitNames));
  check("overlapSphere dispatch excludes far sphere", !sphereHitNames.includes("query-far-sphere"), formatValue(sphereHitNames));
};

const runCapsuleColliderDispatchChecks = () => {
  log("");
  log("[PhysicsSpace / capsule collider dispatch]");

  const bounceWorld = createWorld();
  bounceWorld.setGravity([0.0, 0.0, 0.0]);
  bounceWorld.setDefaultRestitution(0.5);
  bounceWorld.setSleepLinearThreshold(0.01);
  const bounceSpace = new Space();
  const capsuleA = createCapsuleBody(bounceSpace, "capsule-a", {
    bodyType: "dynamic",
    position: [-1.0, 0.0, 0.0],
    radius: 1.0,
    segmentLength: 4.0,
    mass: 1.0,
    velocity: [10.0, 0.0, 0.0],
    restitution: 0.5
  });
  const capsuleB = createCapsuleBody(bounceSpace, "capsule-b", {
    bodyType: "dynamic",
    position: [1.0, 0.0, 0.0],
    radius: 1.0,
    segmentLength: 4.0,
    mass: 1.0,
    velocity: [-10.0, 0.0, 0.0],
    restitution: 0.5
  });
  bounceWorld.addBody(capsuleA);
  bounceWorld.addBody(capsuleB);

  bounceWorld.stepFixed(0.1);
  const velocityA = capsuleA.getLinearVelocity();
  const velocityB = capsuleB.getLinearVelocity();
  const capsuleContacts = bounceWorld.getLastContacts();
  // CapsuleCollider 同士が broadphase と narrowphase を通って接触し、反発で速度が反転することを確認する
  // capsule は y 軸方向の線分と半径で構成される collider
  check("capsule-capsule broadphase/narrowphase produces contact", capsuleContacts.length >= 1, formatValue(capsuleContacts.length));
  check("capsule-capsule contact reverses capsuleA x velocity", velocityA[0] < 0.0, formatValue(velocityA));
  check("capsule-capsule contact reverses capsuleB x velocity", velocityB[0] > 0.0, formatValue(velocityB));

  const collectCapsulePairNames = (otherBodyFactory, capsuleOptions = {}) => {
    const pairWorld = createWorld();
    pairWorld.setGravity([0.0, 0.0, 0.0]);
    pairWorld.setDefaultRestitution(0.0);
    const pairSpace = new Space();
    const otherBody = otherBodyFactory(pairSpace);
    const capsuleBody = createCapsuleBody(pairSpace, "dispatch-capsule", {
      bodyType: "kinematic",
      position: [1.0, 4.0, 0.0],
      radius: 1.0,
      segmentLength: 4.0,
      ...capsuleOptions
    });
    pairWorld.addBody(otherBody);
    pairWorld.addBody(capsuleBody);
    pairWorld.stepFixed(0.1);
    return pairWorld.getLastContacts().map((contact) => `${contact.bodyA.name}/${contact.bodyB.name}`);
  };

  const planePairs = collectCapsulePairNames((pairSpace) => createPlaneBody(pairSpace, "capsule-plane", {
    bodyType: "static",
    position: [0.0, 0.0, 0.0],
    normal: [0.0, 1.0, 0.0]
  }), {
    position: [1.0, 0.5, 0.0],
    velocity: [0.0, -1.0, 0.0]
  });
  const boxPairs = collectCapsulePairNames((pairSpace) => createBoxBody(pairSpace, "capsule-box", {
    bodyType: "static",
    position: [4.0, 4.0, 0.0],
    size: [4.0, 4.0, 4.0]
  }), {
    position: [1.5, 4.0, 0.0]
  });
  const spherePairs = collectCapsulePairNames((pairSpace) => createSphereBody(pairSpace, "capsule-sphere", {
    bodyType: "static",
    position: [-0.5, 4.0, 0.0],
    radius: 1.5
  }));
  // capsule が plane、box、sphere の各相手へ正しい接触式で dispatch されることを確認する
  // ここで落ちる場合は、新 collider が broadphase だけでなく narrowphase の型分岐へ乗っていない
  check("capsule-plane pair reaches narrowphase through dispatch", planePairs.some((pair) => pair.includes("capsule-plane") && pair.includes("dispatch-capsule")), formatValue(planePairs));
  check("capsule-box pair reaches narrowphase through dispatch", boxPairs.some((pair) => pair.includes("capsule-box") && pair.includes("dispatch-capsule")), formatValue(boxPairs));
  check("capsule-sphere pair reaches narrowphase through dispatch", spherePairs.some((pair) => pair.includes("capsule-sphere") && pair.includes("dispatch-capsule")), formatValue(spherePairs));

  const queryWorld = createWorld();
  queryWorld.setGravity([0.0, 0.0, 0.0]);
  const querySpace = new Space();
  const queryCapsule = createCapsuleBody(querySpace, "query-capsule", {
    bodyType: "static",
    position: [0.0, 0.0, 0.0],
    radius: 2.0,
    segmentLength: 4.0
  });
  const farCapsule = createCapsuleBody(querySpace, "query-far-capsule", {
    bodyType: "static",
    position: [20.0, 0.0, 0.0],
    radius: 1.0,
    segmentLength: 4.0
  });
  queryWorld.addBody(queryCapsule);
  queryWorld.addBody(farCapsule);

  const rayHit = queryWorld.raycast([-10.0, 0.0, 0.0], [1.0, 0.0, 0.0]);
  // raycast が capsule の円筒部または端球に当たり、手前表面までの距離を返すことを確認する
  check("raycast dispatch hits capsule collider", rayHit?.body === queryCapsule, formatValue(rayHit ? { body: rayHit.body.name, distance: rayHit.distance } : null));
  check("capsule raycast distance matches front surface", almostEqual(rayHit?.distance ?? -1.0, 8.0), formatValue(rayHit ? { distance: rayHit.distance } : null));

  const aabbHits = queryWorld.queryAabb([-3.0, -1.0, -1.0], [-1.0, 1.0, 1.0]);
  const aabbNames = aabbHits.map((hit) => hit.body.name);
  // queryAabb が capsule の外接 AABB を使って近い capsule を含め、遠い capsule を除外することを確認する
  check("queryAabb dispatch includes capsule collider", aabbNames.includes("query-capsule"), formatValue(aabbNames));
  check("queryAabb dispatch excludes far capsule", !aabbNames.includes("query-far-capsule"), formatValue(aabbNames));

  const sphereHits = queryWorld.overlapSphere([3.0, 0.0, 0.0], 1.25);
  const sphereHitNames = sphereHits.map((hit) => hit.body.name);
  // overlapSphere が capsule の芯線と半径を使って近い対象だけを返すことを確認する
  check("overlapSphere dispatch includes capsule collider", sphereHitNames.includes("query-capsule"), formatValue(sphereHitNames));
  check("overlapSphere dispatch excludes far capsule", !sphereHitNames.includes("query-far-capsule"), formatValue(sphereHitNames));
};

const runRaycastChecks = () => {
  log("");
  log("[PhysicsSpace / raycast]");
  const world = createWorld();
  world.setGravity([0.0, 0.0, 0.0]);

  const space = new Space();
  const plane = createPlaneBody(space, "ray-plane", {
    bodyType: "static",
    position: [0.0, -10.0, 0.0],
    normal: [0.0, 1.0, 0.0]
  });
  const triggerBox = createBoxBody(space, "ray-trigger-box", {
    bodyType: "static",
    position: [0.0, 0.0, -8.0],
    size: [4.0, 4.0, 4.0]
  });
  triggerBox.setTrigger(true);
  const solidBox = createBoxBody(space, "ray-solid-box", {
    bodyType: "static",
    position: [0.0, 0.0, 0.0],
    size: [4.0, 4.0, 4.0]
  });
  world.addBody(plane);
  world.addBody(triggerBox);
  world.addBody(solidBox);

  const forwardHit = world.raycast([0.0, 0.0, -20.0], [0.0, 0.0, 1.0]);
  // raycast は既定で trigger も含め、最も近い hit を返すことを確認する
  // trigger もセンサー用途では hit してほしいため既定では除外しない
  check("raycast returns nearest trigger hit by default", forwardHit?.body === triggerBox, formatValue(forwardHit ? { body: forwardHit.body.name, distance: forwardHit.distance } : null));
  check("raycast returns expected trigger hit distance", almostEqual(forwardHit?.distance ?? -1.0, 10.0), formatValue(forwardHit ? { distance: forwardHit.distance } : null));

  const solidOnlyHit = world.raycast([0.0, 0.0, -20.0], [0.0, 0.0, 1.0], {
    includeTriggers: false
  });
  // includeTriggers=false は trigger を飛ばし、奥の solid body を返すことを確認する
  // solid は物理応答する通常 body を指す
  check("includeTriggers=false skips trigger body", solidOnlyHit?.body === solidBox, formatValue(solidOnlyHit ? { body: solidOnlyHit.body.name, distance: solidOnlyHit.distance } : null));
  check("solid hit distance matches front face", almostEqual(solidOnlyHit?.distance ?? -1.0, 18.0), formatValue(solidOnlyHit ? { distance: solidOnlyHit.distance } : null));

  const filteredHit = world.raycast([0.0, 0.0, -20.0], [0.0, 0.0, 1.0], {
    filter: (body) => body.name === "ray-solid-box"
  });
  // filter は任意条件で候補 body を絞るための関数で、ここでは名前一致だけを許可する
  check("raycast filter selects the requested body", filteredHit?.body === solidBox, formatValue(filteredHit ? { body: filteredHit.body.name, distance: filteredHit.distance } : null));

  const planeHit = world.raycast([0.0, 10.0, 0.0], [0.0, -1.0, 0.0], {
    includeTriggers: false,
    filter: (body) => body.name === "ray-plane"
  });
  // 無限平面 collider に raycast でき、normal と距離が平面の式どおりになることを確認する
  check("raycast hits plane collider", planeHit?.body === plane, formatValue(planeHit ? { body: planeHit.body.name, distance: planeHit.distance } : null));
  check("plane hit normal points upward", planeHit?.normal?.[1] > 0.9, formatValue(planeHit ? { normal: planeHit.normal } : null));
  check("plane hit distance matches expected value", almostEqual(planeHit?.distance ?? -1.0, 20.0), formatValue(planeHit ? { distance: planeHit.distance } : null));

  const limitedHit = world.raycast([0.0, 0.0, -20.0], [0.0, 0.0, 1.0], {
    maxDistance: 9.0
  });
  // maxDistance は指定距離より遠い hit を無視することを確認する
  // 視線や近距離センサーで遠方を拾わないための仕様
  check("raycast maxDistance rejects farther hits", limitedHit === null, formatValue(limitedHit));

  const allHits = world.raycastAll([0.0, 0.0, -20.0], [0.0, 0.0, 1.0]);
  // raycastAll は全 hit を距離順に返すことを確認する
  // raycast は最短 1 件、raycastAll は複数件を返す問い合わせ
  check("raycastAll returns every hit in distance order", allHits.length === 2 && allHits[0].body === triggerBox && allHits[1].body === solidBox, formatValue(allHits.map((hit) => ({ body: hit.body.name, distance: hit.distance }))));

  const allSolidHits = world.raycastAll([0.0, 0.0, -20.0], [0.0, 0.0, 1.0], {
    includeTriggers: false
  });
  // raycastAll でも includeTriggers=false が trigger を除外することを確認する
  check("raycastAll includeTriggers=false excludes trigger hits", allSolidHits.length === 1 && allSolidHits[0].body === solidBox, formatValue(allSolidHits.map((hit) => ({ body: hit.body.name, distance: hit.distance }))));

  const allFilteredHits = world.raycastAll([0.0, 10.0, 0.0], [0.0, -1.0, 0.0], {
    filter: (body) => body.name === "ray-plane"
  });
  // raycastAll でも filter が全候補へ適用され、指定 body だけを返すことを確認する
  check("raycastAll filter selects plane hit only", allFilteredHits.length === 1 && allFilteredHits[0].body === plane, formatValue(allFilteredHits.map((hit) => ({ body: hit.body.name, distance: hit.distance }))));

  const triggerOnlyHit = world.raycast([0.0, 0.0, -20.0], [0.0, 0.0, 1.0], {
    triggerOnly: true
  });
  // triggerOnly は trigger body だけを対象にすることを確認する
  // センサーだけを拾いたい問い合わせのための option
  check("raycast triggerOnly returns trigger body only", triggerOnlyHit?.body === triggerBox, formatValue(triggerOnlyHit ? { body: triggerOnlyHit.body.name } : null));

  const noTriggerOnlyHit = world.raycast([0.0, 10.0, 0.0], [0.0, -1.0, 0.0], {
    triggerOnly: true
  });
  // triggerOnly で trigger が存在しない方向を調べた場合は null を返すことを確認する
  check("raycast triggerOnly returns null when no trigger is hit", noTriggerOnlyHit === null, formatValue(noTriggerOnlyHit));
};

const runQueryAabbChecks = () => {
  log("");
  log("[PhysicsSpace / queryAabb]");
  const world = createWorld();
  world.setGravity([0.0, 0.0, 0.0]);

  const space = new Space();
  const plane = createPlaneBody(space, "query-plane", {
    bodyType: "static",
    position: [0.0, 0.0, 0.0],
    normal: [0.0, 1.0, 0.0]
  });
  const triggerBox = createBoxBody(space, "query-trigger-box", {
    bodyType: "static",
    position: [-1.0, 0.0, 0.0],
    size: [4.0, 4.0, 4.0]
  });
  triggerBox.setTrigger(true);
  const solidBox = createBoxBody(space, "query-solid-box", {
    bodyType: "static",
    position: [4.0, 0.0, 0.0],
    size: [4.0, 4.0, 4.0]
  });
  const farBox = createBoxBody(space, "query-far-box", {
    bodyType: "static",
    position: [20.0, 0.0, 0.0],
    size: [4.0, 4.0, 4.0]
  });
  world.addBody(plane);
  world.addBody(triggerBox);
  world.addBody(solidBox);
  world.addBody(farBox);

  const hits = world.queryAabb([-4.0, -3.0, -3.0], [6.0, 3.0, 3.0]);
  const hitNames = hits.map((hit) => hit.body.name);
  // queryAabb は指定した軸平行 box と重なる finite collider を返すことを確認する
  // PlaneCollider は無限平面で AABB を持たないため、queryAabb の一覧には入れない
  check("queryAabb returns overlapping trigger box", hitNames.includes("query-trigger-box"), formatValue(hitNames));
  check("queryAabb returns overlapping solid box", hitNames.includes("query-solid-box"), formatValue(hitNames));
  check("queryAabb excludes non-overlapping far box", !hitNames.includes("query-far-box"), formatValue(hitNames));
  check("queryAabb ignores plane collider", !hitNames.includes("query-plane"), formatValue(hitNames));

  const nonTriggerHits = world.queryAabb([-4.0, -3.0, -3.0], [6.0, 3.0, 3.0], {
    includeTriggers: false
  });
  const nonTriggerNames = nonTriggerHits.map((hit) => hit.body.name);
  // includeTriggers=false は範囲内の trigger を除外し、通常 body は残すことを確認する
  check("queryAabb includeTriggers=false excludes trigger body", !nonTriggerNames.includes("query-trigger-box"), formatValue(nonTriggerNames));
  check("queryAabb includeTriggers=false still returns solid body", nonTriggerNames.includes("query-solid-box"), formatValue(nonTriggerNames));

  const filteredHits = world.queryAabb([-4.0, -3.0, -3.0], [6.0, 3.0, 3.0], {
    filter: (body) => body.name === "query-solid-box"
  });
  // filter は範囲で拾った候補から、利用者が指定した body だけを残すことを確認する
  check("queryAabb filter selects requested body only", filteredHits.length === 1 && filteredHits[0].body === solidBox, formatValue(filteredHits.map((hit) => hit.body.name)));

  const edgeHits = world.queryAabb([6.0, -3.0, -3.0], [8.0, 3.0, 3.0], {
    includeTriggers: false
  });
  // queryAabb の仕様では、境界がぴったり接するだけでも overlap として扱う
  // この条件は OBB 化で SAT を使う場合も守る必要がある
  check("queryAabb treats touching AABB edge as overlap", edgeHits.length === 1 && edgeHits[0].body === solidBox, formatValue(edgeHits.map((hit) => hit.body.name)));

  const triggerOnlyHits = world.queryAabb([-4.0, -3.0, -3.0], [6.0, 3.0, 3.0], {
    triggerOnly: true
  });
  // triggerOnly は trigger body だけを返し、同じ範囲内の通常 body を除外することを確認する
  check("queryAabb triggerOnly returns trigger body only", triggerOnlyHits.length === 1 && triggerOnlyHits[0].body === triggerBox, formatValue(triggerOnlyHits.map((hit) => hit.body.name)));
};

const runOverlapSphereChecks = () => {
  log("");
  log("[PhysicsSpace / overlapSphere]");
  const world = createWorld();
  world.setGravity([0.0, 0.0, 0.0]);

  const space = new Space();
  const triggerBox = createBoxBody(space, "sphere-trigger-box", {
    bodyType: "static",
    position: [-1.0, 0.0, 0.0],
    size: [4.0, 4.0, 4.0]
  });
  triggerBox.setTrigger(true);
  const solidBox = createBoxBody(space, "sphere-solid-box", {
    bodyType: "static",
    position: [4.0, 0.0, 0.0],
    size: [4.0, 4.0, 4.0]
  });
  const farBox = createBoxBody(space, "sphere-far-box", {
    bodyType: "static",
    position: [20.0, 0.0, 0.0],
    size: [4.0, 4.0, 4.0]
  });
  world.addBody(triggerBox);
  world.addBody(solidBox);
  world.addBody(farBox);

  const hits = world.overlapSphere([0.0, 0.0, 0.0], 4.5);
  const hitNames = hits.map((hit) => hit.body.name);
  // overlapSphere は指定した球範囲と重なる collider を返し、遠い body を除外することを確認する
  // queryAabb と違い、範囲形状は球である
  check("overlapSphere returns trigger box in range", hitNames.includes("sphere-trigger-box"), formatValue(hitNames));
  check("overlapSphere returns solid box in range", hitNames.includes("sphere-solid-box"), formatValue(hitNames));
  check("overlapSphere excludes far box", !hitNames.includes("sphere-far-box"), formatValue(hitNames));

  const nonTriggerHits = world.overlapSphere([0.0, 0.0, 0.0], 4.5, {
    includeTriggers: false
  });
  const nonTriggerNames = nonTriggerHits.map((hit) => hit.body.name);
  // overlapSphere でも includeTriggers=false が trigger を除外し、通常 body は残すことを確認する
  check("overlapSphere includeTriggers=false excludes trigger body", !nonTriggerNames.includes("sphere-trigger-box"), formatValue(nonTriggerNames));
  check("overlapSphere includeTriggers=false still returns solid body", nonTriggerNames.includes("sphere-solid-box"), formatValue(nonTriggerNames));

  const filteredHits = world.overlapSphere([0.0, 0.0, 0.0], 4.5, {
    filter: (body) => body.name === "sphere-solid-box"
  });
  // overlapSphere の filter が球範囲内の候補から指定 body だけを残すことを確認する
  check("overlapSphere filter selects requested body only", filteredHits.length === 1 && filteredHits[0].body === solidBox, formatValue(filteredHits.map((hit) => hit.body.name)));

  const insideHits = world.overlapSphere([4.0, 0.0, 0.0], 0.5, {
    includeTriggers: false
  });
  // 球中心が box 内部にある場合、最近傍距離は 0 として返すことを確認する
  // 内部 hit を非接触や負距離にしないための仕様
  check("overlapSphere reports zero distance when center is inside box", insideHits.length === 1 && insideHits[0].body === solidBox && almostEqual(insideHits[0].distance, 0.0), formatValue(insideHits.map((hit) => ({ body: hit.body.name, distance: hit.distance }))));

  const triggerOnlyHits = world.overlapSphere([0.0, 0.0, 0.0], 4.5, {
    triggerOnly: true
  });
  // overlapSphere の triggerOnly が trigger body だけを返すことを確認する
  check("overlapSphere triggerOnly returns trigger body only", triggerOnlyHits.length === 1 && triggerOnlyHits[0].body === triggerBox, formatValue(triggerOnlyHits.map((hit) => hit.body.name)));
};

const runTriggerChecks = () => {
  log("");
  log("[PhysicsSpace / trigger contact]");
  const world = createWorld();
  world.setGravity([0.0, 0.0, 0.0]);
  world.setDefaultRestitution(0.0);
  const triggerCalls = [];
  world.onBeginContact((contact, phase) => {
    triggerCalls.push({
      phase,
      pair: `${contact.bodyA?.name ?? "unknown"} / ${contact.bodyB?.name ?? "unknown"}`
    });
  });
  world.onStayContact((contact, phase) => {
    triggerCalls.push({
      phase,
      pair: `${contact.bodyA?.name ?? "unknown"} / ${contact.bodyB?.name ?? "unknown"}`
    });
  });

  const space = new Space();
  const plane = createPlaneBody(space, "trigger-plane", {
    bodyType: "static",
    position: [0.0, 0.0, 0.0],
    normal: [0.0, 1.0, 0.0],
    restitution: 0.0,
    friction: 0.0
  });
  const triggerBox = createBoxBody(space, "trigger-box", {
    bodyType: "dynamic",
    position: [0.0, 1.5, 0.0],
    size: [4.0, 4.0, 4.0],
    mass: 1.0,
    restitution: 0.0,
    linearDamping: 0.0
  });
  triggerBox.setTrigger(true);
  world.addBody(plane);
  world.addBody(triggerBox);

  world.stepFixed(0.1);
  const firstY = triggerBox.getPosition()[1];
  const firstEvents = world.getLastContactEvents();
  // trigger は接触イベントを出すが、押し戻しによる位置補正は行わないことを確認する
  // センサー領域に入ったことだけを知りたい場合、物体を押し返してはいけない
  check("trigger contact still reports begin event", firstEvents.begin.length >= 1, formatValue(summarizeContactEvents(firstEvents)));
  check("trigger contact notifies begin listener", triggerCalls.length >= 1 && triggerCalls[0].phase === "begin", formatValue(triggerCalls));
  check("trigger contact does not apply position correction", almostEqual(firstY, 1.5), formatValue(triggerBox.getPosition()));

  world.stepFixed(0.1);
  const secondY = triggerBox.getPosition()[1];
  const secondEvents = world.getLastContactEvents();
  // trigger 接触が続く step では stay event を出し、引き続き物理応答は行わないことを確認する
  check("trigger contact still reports stay event", secondEvents.stay.length >= 1, formatValue(summarizeContactEvents(secondEvents)));
  check("trigger contact notifies stay listener", triggerCalls.length >= 2 && triggerCalls[1].phase === "stay", formatValue(triggerCalls));
  check("trigger contact keeps body position unchanged on later step", almostEqual(secondY, 1.5), formatValue(triggerBox.getPosition()));
};

runWorldSettingChecks();
runFloorSleepChecks();
runSleepStabilityChecks();
runWakeOnContactChecks();
runBounceChecks();
runBoxFaceManifoldChecks();
runAngularRotationChecks();
runAngularContactSolverChecks();
runBroadphaseAabbCullingChecks();
runOrientedBoxColliderChecks();
runCollisionLayerChecks();
runContactEventChecks();
runPlaneAndFrictionChecks();
runSphereColliderDispatchChecks();
runCapsuleColliderDispatchChecks();
runRaycastChecks();
runQueryAabbChecks();
runOverlapSphereChecks();
runTriggerChecks();

const summary = failCount === 0
  ? `PASS physics_space_api_contracts (${passCount} checks, ${knownIssueCount} known issues)`
  : `FAIL physics_space_api_contracts (${failCount} failed / ${passCount} passed)`;
if (failCount === 0) {
  console.log(summary);
  for (const line of lines.filter((entry) => entry.startsWith("XFAIL "))) {
    console.warn(line);
  }
} else {
  console.error(`${summary}\n\n${lines.join("\n")}`);
  process.exitCode = 1;
}
