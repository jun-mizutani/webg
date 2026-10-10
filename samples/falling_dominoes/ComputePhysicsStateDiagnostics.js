// ---------------------------------------------
// ComputePhysicsStateDiagnostics.js  2026/10/10
//   Readback-based sleep and contact diagnostics for falling_dominoes
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// このモジュールはfalling_dominoesの画面に必要なsleep・接触指標を組み立てます
// ComputePhysicsSpaceが返すBodyStateとcontact queryを読み取り、readback時点の観測値をまとめます

export const COMPUTE_PHYSICS_DIAGNOSTIC_FLAGS = Object.freeze({
  inactiveOrStatic: 1 << 0,
  hasSupport: 1 << 1,
  lowMotion: 1 << 2,
  quietContact: 1 << 3,
  sleepEligible: 1 << 4,
  wasSleeping: 1 << 5,
  awakeContact: 1 << 6,
  sleepBlocked: 1 << 7,
  sleeping: 1 << 8,
  floorContactObserved: 1 << 12,
  bodyContactObserved: 1 << 18,
  nonFloorPlaneContactObserved: 1 << 19
});

function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

function subtract3(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function contactPointVelocity(state, point) {
  const arm = subtract3(point, state.position);
  const rotational = cross3(state.angularVelocity, arm);
  return [
    state.linearVelocity[0] + rotational[0],
    state.linearVelocity[1] + rotational[1],
    state.linearVelocity[2] + rotational[2]
  ];
}

function zeroVec4() {
  return [0, 0, 0, 0];
}

function bodyContactObservation(state, states, contacts) {
  let selected = null;
  for (const contact of contacts) {
    const isA = contact.bodyAId === state.id;
    const isB = contact.bodyBId === state.id;
    if (!isA && !isB) continue;
    const otherId = isA ? contact.bodyBId : contact.bodyAId;
    const other = states.get(otherId);
    if (!other || !Array.isArray(contact.point) || contact.point.length !== 3) continue;
    const normal = isA ? [...contact.normal] : contact.normal.map((value) => -value);
    const velocityA = contactPointVelocity(state, contact.point);
    const velocityB = contactPointVelocity(other, contact.point);
    const normalVelocity = dot3(subtract3(velocityB, velocityA), normal);
    const approachSpeed = Math.max(0, -normalVelocity);
    if (selected === null || approachSpeed > selected.approachSpeed) {
      selected = {
        otherId,
        otherSlot: other.slot,
        otherSleeping: other.sleeping,
        normal,
        point: [...contact.point],
        normalVelocity,
        approachSpeed,
        penetration: contact.penetration
      };
    }
  }
  return selected;
}

function planeContactObservation(state, planeContacts) {
  const contacts = planeContacts.filter((contact) => contact.bodyAId === state.id);
  if (contacts.length === 0) return null;
  return contacts.reduce((best, contact) => (
    best === null || contact.penetration > best.penetration ? contact : best
  ), null);
}

// 明示的なstate readbackの瞬間にbody別の観測値を集め、query由来の値をsolver内部値と区別します
export function buildComputePhysicsStateDiagnostics(physics, states, contacts = [], planeContacts = []) {
  if (!(states instanceof Map)) throw new Error("Compute physics diagnostic states must be a Map");
  const result = [];
  for (const state of states.values()) {
    const bodyContact = bodyContactObservation(state, states, contacts);
    const planeContact = planeContactObservation(state, planeContacts);
    const bodyContactObserved = bodyContact !== null;
    const floorContactObserved = planeContact !== null && planeContact.normal[1] > 0.5;
    const nonFloorPlaneContactObserved = planeContact !== null && !floorContactObserved;
    const supportCount = planeContacts.filter((contact) => (
      contact.bodyId === state.id && contact.normal[1] > 0.5
    )).length;
    const requiredSupportPoints = physics.minimumFloorSupportPoints ?? 1;
    const hasSupport = supportCount >= requiredSupportPoints
      || (bodyContactObserved && bodyContact.normal[1] < -0.5);
    const linearSpeed = Math.hypot(...state.linearVelocity);
    const angularSpeed = Math.hypot(...state.angularVelocity);
    const sleepLinear = physics.getSleepLinearThreshold();
    const sleepAngular = physics.getSleepAngularThreshold();
    const sleepContact = physics.scale?.sleepContactSpeed ?? 0;
    const sleepNormal = physics.scale?.sleepNormalSpeed ?? 0;
    const contactSpeed = bodyContact?.approachSpeed ?? 0;
    const normalSpeed = bodyContact === null ? 0 : Math.abs(bodyContact.normalVelocity);
    const lowMotion = linearSpeed < sleepLinear && angularSpeed < sleepAngular;
    const quietContact = contactSpeed < sleepContact && normalSpeed < sleepNormal;
    let flags = 0;
    if (state.bodyType !== "dynamic") flags |= COMPUTE_PHYSICS_DIAGNOSTIC_FLAGS.inactiveOrStatic;
    if (hasSupport) flags |= COMPUTE_PHYSICS_DIAGNOSTIC_FLAGS.hasSupport;
    if (lowMotion) flags |= COMPUTE_PHYSICS_DIAGNOSTIC_FLAGS.lowMotion;
    if (quietContact) flags |= COMPUTE_PHYSICS_DIAGNOSTIC_FLAGS.quietContact;
    if (state.sleeping) flags |= COMPUTE_PHYSICS_DIAGNOSTIC_FLAGS.sleeping;
    if (floorContactObserved) flags |= COMPUTE_PHYSICS_DIAGNOSTIC_FLAGS.floorContactObserved;
    if (bodyContactObserved) flags |= COMPUTE_PHYSICS_DIAGNOSTIC_FLAGS.bodyContactObserved;
    if (nonFloorPlaneContactObserved) flags |= COMPUTE_PHYSICS_DIAGNOSTIC_FLAGS.nonFloorPlaneContactObserved;
    if (hasSupport && lowMotion && quietContact) flags |= COMPUTE_PHYSICS_DIAGNOSTIC_FLAGS.sleepEligible;
    if (!(hasSupport && lowMotion && quietContact)) flags |= COMPUTE_PHYSICS_DIAGNOSTIC_FLAGS.sleepBlocked;
    result.push({
      bodyId: state.id,
      slot: state.slot,
      flags,
      floorSupportPoints: supportCount,
      requiredFloorSupportPoints: requiredSupportPoints,
      floorNormalImpulseApplied: false,
      flagState: Object.freeze(Object.fromEntries(
        Object.entries(COMPUTE_PHYSICS_DIAGNOSTIC_FLAGS).map(([name, bit]) => [name, (flags & bit) !== 0])
      )),
      speeds: [contactSpeed, normalSpeed, linearSpeed, angularSpeed],
      counters: zeroVec4(),
      supportContact: bodyContact === null
        ? [-1, 0, 0, 0]
        : [bodyContact.otherId, 0, bodyContact.penetration, 0],
      supportContactNormal: bodyContact?.normal ? [...bodyContact.normal, 0] : zeroVec4(),
      supportContactPoint: bodyContact?.point ? [...bodyContact.point, 0] : zeroVec4(),
      planeSupport: planeContact === null
        ? [-1, 0, 0, 0]
        : [planeContact.planeIndex ?? -1, 0, 0, 0],
      planeSupportNormal: planeContact?.normal ? [...planeContact.normal, 0] : zeroVec4(),
      contactVelocity: bodyContact === null
        ? [0, 0, 0, -1]
        : [bodyContact.normalVelocity, bodyContact.approachSpeed, 0, states.get(bodyContact.otherId)?.slot ?? -1],
      contactVelocityNormal: bodyContact?.normal ? [...bodyContact.normal, bodyContact.otherSleeping ? 1 : 0] : zeroVec4(),
      contactVelocityPoint: bodyContact?.point ? [...bodyContact.point, 1] : [0, 0, 0, 0],
      // solver内部のwake走査に代えて、接触queryから観測できた候補を記録します
      wakeVelocity: bodyContact === null
        ? [0, 0, 0, -1]
        : [bodyContact.normalVelocity, bodyContact.approachSpeed, 1, bodyContact.otherSlot],
      contactAngularDelta: {
        bodyPairNormal: zeroVec4(),
        bodyPairFriction: zeroVec4(),
        planeNormal: zeroVec4(),
        planeFriction: zeroVec4()
      },
      // 診断対象をreadback由来の値に限定し、counter resetとdecision maskは未観測値0で表します
      sleepDecision: zeroVec4(),
      bodyPairNormalImpulse: zeroVec4(),
      currentContactVelocity: bodyContact === null
        ? [0, 0, 0, -1]
        : [bodyContact.normalVelocity, bodyContact.approachSpeed, 0, bodyContact.otherId],
      currentContactNormal: bodyContact?.normal ? [...bodyContact.normal, 0] : zeroVec4()
    });
  }
  return result;
}
