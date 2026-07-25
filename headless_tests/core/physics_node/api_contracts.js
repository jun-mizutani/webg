// ---------------------------------------------
// headless_tests/core/physics_node/api_contracts.js  2026/07/17
//   PhysicsNode API contract checks for webg
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import Space from "../../../webg/Space.js";
import BoxCollider from "../../../webg/BoxCollider.js";

const lines = [];
let passCount = 0;
let failCount = 0;

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

const check = (label, condition, detail = "") => {
  if (condition) {
    passCount += 1;
    log(`PASS ${label}`);
  } else {
    failCount += 1;
    log(`FAIL ${label}${detail ? `: ${detail}` : ""}`);
  }
};

const checkThrows = (label, fn, messagePattern = null) => {
  try {
    fn();
    check(label, false, "did not throw");
  } catch (err) {
    const message = err?.message ?? String(err);
    const matches = messagePattern ? messagePattern.test(message) : true;
    check(label, matches, matches ? "" : message);
  }
};

const almostEqual = (a, b, eps = 1.0e-6) => Math.abs(a - b) <= eps;

const runPhysicsNodeContractChecks = () => {
  log("[PhysicsNode / bodyType / state]");

  const space = new Space();
  const body = space.addPhysicsNode(null, "contract-body", {
    mass: 2.0,
    gravityScale: 1.25,
    linearDamping: 0.3,
    angularDamping: 0.5
  });

  check("Space.addPhysicsNode returns registered node", space.findNode("contract-body") === body);
  check("PhysicsNode default bodyType is dynamic", body.getBodyType() === "dynamic");
  check("PhysicsNode default inverse mass reflects mass", almostEqual(body.getInverseMass(), 0.5), formatValue(body.getInverseMass()));
  check("PhysicsNode getter returns gravityScale", almostEqual(body.getGravityScale(), 1.25), formatValue(body.getGravityScale()));
  check("PhysicsNode getter returns linearDamping", almostEqual(body.getLinearDamping(), 0.3), formatValue(body.getLinearDamping()));
  check("PhysicsNode getter returns angularDamping", almostEqual(body.getAngularDamping(), 0.5), formatValue(body.getAngularDamping()));
  // collisionLayer は自分が属する層、collisionMask は自分が接触対象にしたい層を表す
  // 既定では layer 1 に属し、すべての層を接触対象に含める
  check("PhysicsNode default collisionLayer is 1", body.getCollisionLayer() === 1, formatValue(body.getCollisionLayer()));
  check("PhysicsNode default collisionMask includes all layers", body.getCollisionMask() === 0xffffffff, formatValue(body.getCollisionMask()));

  body.setBodyType("kinematic", {
    clearVelocity: true,
    restoreVelocity: false
  });
  check("kinematic body has zero inverse mass", almostEqual(body.getInverseMass(), 0.0), formatValue(body.getInverseMass()));
  body.setBodyType("static", {
    clearVelocity: true,
    restoreVelocity: false
  });
  check("static body has zero inverse mass", almostEqual(body.getInverseMass(), 0.0), formatValue(body.getInverseMass()));
  body.setBodyType("dynamic", {
    clearVelocity: false,
    restoreVelocity: false
  });
  check("dynamic body restores inverse mass after type switch", almostEqual(body.getInverseMass(), 0.5), formatValue(body.getInverseMass()));

  body.setLinearVelocity(3.0, 4.0, 5.0);
  body.setAngularVelocity(0.4, 0.5, 0.6);
  body.pauseDynamic();
  check("pauseDynamic switches to kinematic", body.isKinematic() === true);
  check("pauseDynamic clears current linear velocity by default", JSON.stringify(body.getLinearVelocity()) === JSON.stringify([0, 0, 0]), formatValue(body.getLinearVelocity()));
  body.resumeDynamic();
  check("resumeDynamic restores saved linear velocity", JSON.stringify(body.getLinearVelocity()) === JSON.stringify([3, 4, 5]), formatValue(body.getLinearVelocity()));
  check("resumeDynamic restores saved angular velocity", JSON.stringify(body.getAngularVelocity()) === JSON.stringify([0.4, 0.5, 0.6]), formatValue(body.getAngularVelocity()));

  body.pauseDynamic();
  body.setLinearVelocityVec([9.0, 8.0, 7.0]);
  body.setAngularVelocityVec([1.0, 2.0, 3.0]);
  body.resumeDynamic();
  check("resumeDynamic keeps explicit linear velocity set while paused", JSON.stringify(body.getLinearVelocity()) === JSON.stringify([9, 8, 7]), formatValue(body.getLinearVelocity()));
  check("resumeDynamic keeps explicit angular velocity set while paused", JSON.stringify(body.getAngularVelocity()) === JSON.stringify([1, 2, 3]), formatValue(body.getAngularVelocity()));

  body.teleport([10.0, 11.0, 12.0]);
  check("teleport updates position", JSON.stringify(body.getPosition()) === JSON.stringify([10, 11, 12]), formatValue(body.getPosition()));
  check("teleport clears velocity by default", JSON.stringify(body.getLinearVelocity()) === JSON.stringify([0, 0, 0]), formatValue(body.getLinearVelocity()));
  body.setLinearVelocity(2.0, 3.0, 4.0);
  body.teleport([20.0, 21.0, 22.0], { keepVelocity: true });
  check("teleport keepVelocity preserves velocity", JSON.stringify(body.getLinearVelocity()) === JSON.stringify([2, 3, 4]), formatValue(body.getLinearVelocity()));

  body.syncNodeFromPhysics([30.0, 31.0, 32.0], {
    attitude: [7.0, 8.0, 9.0]
  });
  const syncedState = body.syncPhysicsFromNode();
  check("syncNodeFromPhysics updates node position", JSON.stringify(syncedState.position) === JSON.stringify([30, 31, 32]), formatValue(syncedState.position));
  check("syncNodeFromPhysics updates node attitude", syncedState.attitude.map((v) => Number(v.toFixed(3))).join(",") === "7,8,9", formatValue(syncedState.attitude));
  check("syncPhysicsFromNode reports bodyType", syncedState.bodyType === "dynamic", syncedState.bodyType);

  checkThrows(
    "dynamic body rejects direct setPosition",
    () => body.setPosition(1.0, 2.0, 3.0),
    /teleport/
  );
  checkThrows(
    "dynamic body rejects animatePosition",
    () => body.animatePosition([1.0, 2.0, 3.0]),
    /teleport/
  );

  body.applyForce([1.0, 2.0, 3.0]);
  body.applyTorque([4.0, 5.0, 6.0]);
  check("applyForce accumulates force", JSON.stringify(body.getForce()) === JSON.stringify([1, 2, 3]), formatValue(body.getForce()));
  check("applyTorque accumulates torque", JSON.stringify(body.getTorque()) === JSON.stringify([4, 5, 6]), formatValue(body.getTorque()));
  body.clearAccumulators();
  check("clearAccumulators clears force", JSON.stringify(body.getForce()) === JSON.stringify([0, 0, 0]), formatValue(body.getForce()));
  check("clearAccumulators clears torque", JSON.stringify(body.getTorque()) === JSON.stringify([0, 0, 0]), formatValue(body.getTorque()));

  body.stopMotion();
  body.applyImpulse([2.0, 0.0, 0.0]);
  check("applyImpulse updates velocity using inverse mass", JSON.stringify(body.getLinearVelocity()) === JSON.stringify([1, 0, 0]), formatValue(body.getLinearVelocity()));
  body.setFixedRotation(true);
  check("setFixedRotation getter reflects true", body.getFixedRotation() === true);
  checkThrows(
    "applyAngularImpulse rejects fixedRotation body",
    () => body.applyAngularImpulse([1.0, 0.0, 0.0]),
    /fixedRotation=true/
  );
  body.setFixedRotation(false);
  body.applyAngularImpulse([2.0, 0.0, 0.0]);
  check("applyAngularImpulse updates angular velocity using inverse mass", JSON.stringify(body.getAngularVelocity()) === JSON.stringify([1, 0, 0]), formatValue(body.getAngularVelocity()));

  body.setTrigger(true);
  // trigger は接触イベント用の body であり、物理応答する通常 body と区別される
  // ここでは getter が設定値をそのまま返す最小契約を確認する
  check("setTrigger getter reflects true", body.getTrigger() === true);
  const layerPeer = space.addPhysicsNode(null, "layer-peer", {
    bodyType: "static",
    collisionLayer: 0x04,
    collisionMask: 0x01
  });
  body.setCollisionLayer(0x01);
  body.setCollisionMask(0x04);
  // layer と mask は両方の body で相互に許可されている場合だけ接触可能になる
  // 片側だけが相手を許可していても、もう片側が拒否していれば接触候補にしない
  check("setCollisionLayer getter reflects value", body.getCollisionLayer() === 0x01, formatValue(body.getCollisionLayer()));
  check("setCollisionMask getter reflects value", body.getCollisionMask() === 0x04, formatValue(body.getCollisionMask()));
  check("canCollideWith returns true when both masks include each other", body.canCollideWith(layerPeer) === true);
  body.setCollisionMask(0x02);
  check("canCollideWith returns false when local mask excludes peer layer", body.canCollideWith(layerPeer) === false);
  body.setCollisionMask(0x04);
  layerPeer.setCollisionMask(0x02);
  check("canCollideWith returns false when peer mask excludes local layer", body.canCollideWith(layerPeer) === false);
  layerPeer.setCollisionMask(0x01);
  checkThrows(
    "setCollisionLayer rejects non-integer",
    () => body.setCollisionLayer(1.5),
    /integer/
  );
  body.setAllowSleep(false);
  check("setAllowSleep getter reflects false", body.getAllowSleep() === false);
  checkThrows(
    "sleep rejects when allowSleep is false",
    () => body.sleep(),
    /allowSleep=true/
  );
  body.setAllowSleep(true);
  body.sleep();
  check("sleep marks body sleeping", body.getSleeping() === true);
  body.wakeUp();
  check("wakeUp clears sleeping state", body.getSleeping() === false);

  const collider = new BoxCollider([1, 1, 1]);
  const physicsMaterial = { restitution: 0.2 };
  const physicsSpace = { name: "test-world" };
  body.setCollider(collider);
  body.setPhysicsMaterial(physicsMaterial);
  body.setPhysicsSpace(physicsSpace);
  // collider は形状判定、physicsMaterial は反発や摩擦、physicsSpace は所属 world を表す
  // PhysicsNode はこれらの参照を作り替えず、そのまま保持する契約にしている
  check("setCollider preserves reference", body.getCollider() === collider);
  check("setPhysicsMaterial preserves reference", body.getPhysicsMaterial() === physicsMaterial);
  check("setPhysicsSpace preserves reference", body.getPhysicsSpace() === physicsSpace);
  // inertia は回転の質量に相当し、contact solver が角速度をどれだけ変えるかに使う
  // BoxCollider を設定した場合は、質量と箱サイズから local diagonal inertia を自動計算する
  const autoInertia = body.getInertia();
  check("BoxCollider auto inertia uses mass and size", autoInertia.every((value) => almostEqual(value, body.getMass() / 6.0)), formatValue(autoInertia));
  body.setInertia([2.0, 4.0, 8.0]);
  check("setInertia stores manual inertia", JSON.stringify(body.getInertia()) === JSON.stringify([2, 4, 8]), formatValue(body.getInertia()));
  check("getInverseInertia reflects manual inertia", JSON.stringify(body.getInverseInertia()) === JSON.stringify([0.5, 0.25, 0.125]), formatValue(body.getInverseInertia()));
  body.resetInertia();
  check("resetInertia restores auto inertia", body.getInertia().every((value) => almostEqual(value, body.getMass() / 6.0)), formatValue(body.getInertia()));

  body.setBodyType("kinematic", {
    clearVelocity: true,
    restoreVelocity: false
  });
  checkThrows(
    "applyImpulse rejects non-dynamic body",
    () => body.applyImpulse([1.0, 0.0, 0.0]),
    /requires a dynamic body/
  );
};

runPhysicsNodeContractChecks();

const summary = failCount === 0
  ? `PASS physics_node_api_contracts (${passCount} checks)`
  : `FAIL physics_node_api_contracts (${failCount} failed / ${passCount} passed)`;
if (failCount === 0) {
  console.log(summary);
} else {
  console.error(`${summary}\n\n${lines.join("\n")}`);
  process.exitCode = 1;
}
