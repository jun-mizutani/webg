// ---------------------------------------------
// PhysicsBodyRegistry.js  2026/08/29
//   PhysicsNode registration for PhysicsSpace
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// bodyをPhysicsSpaceへ登録する
// 別Spaceに所属しているbodyを暗黙に移さず、登録時に既存のSpaceを検証します
export function addPhysicsBody(space, body) {
  if (!body || typeof body !== "object") {
    throw new Error("PhysicsSpace.addBody() requires a body object");
  }
  if (space.bodies.includes(body)) {
    return body;
  }
  if (body.getPhysicsSpace?.() !== null
      && body.getPhysicsSpace?.() !== undefined
      && body.getPhysicsSpace?.() !== space) {
    throw new Error("PhysicsSpace.addBody() body already belongs to another physics space");
  }
  space.cpuBoxPhysicsAdapter.reset();
  space.sleepFastPathReady = false;
  space.bodies.push(body);
  body.setPhysicsSpace?.(space);
  return body;
}

// bodyをPhysicsSpaceから外す
// 接続中のJointを先に外す順序を要求し、残ったJointが無効なbodyを参照しないようにします
export function removePhysicsBody(space, body) {
  const connectedJoint = space.joints.find((joint) => (
    joint.getBodyA() === body || joint.getBodyB() === body
  ));
  if (connectedJoint) {
    throw new Error("PhysicsSpace.removeBody() requires removing connected joints first");
  }
  for (let i = space.bodies.length - 1; i >= 0; i--) {
    if (space.bodies[i] === body) {
      space.bodies.splice(i, 1);
    }
  }
  if (body?.getPhysicsSpace?.() === space) {
    body.setPhysicsSpace(null);
  }
  space.cpuBoxPhysicsAdapter.reset();
  space.sleepFastPathReady = false;
  return body;
}

// 登録body一覧の複製を返す
// 呼出側が内部配列を並べ替えたり要素を追加したりできないようにします
export function getPhysicsBodies(space) {
  return [...space.bodies];
}
