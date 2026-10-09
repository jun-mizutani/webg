// ---------------------------------------------
// PhysicsContactDispatcher.js  2026/08/29
//   Shape-pair narrowphase dispatch for PhysicsSpace
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import util from "./util.js";
import { buildBoxContact } from "./BoxContact.js";
import { buildPlaneBoxSupportContact } from "./PlaneBoxContact.js";

// PhysicsSpaceが扱うshape pairを明示名へ変換し、接触式とsolver入口の選択条件を一箇所へ集めます
// box-boxとplane-boxは検証済みBox接触処理へ渡し、それ以外はcollider別の一般処理へ渡します
export const PHYSICS_CONTACT_PAIR_KIND = Object.freeze({
  BOX_BOX: "box-box",
  PLANE_BOX: "plane-box",
  GENERAL: "general"
});

// collider typeの組み合わせを固定されたshape pair種別へ分類します
// plane-boxの順序だけは入力順に依存させず、PlaneとBoxの組み合わせを同じ種類へまとめます
export function getPhysicsContactPairKind(typeA, typeB) {
  if (typeA === "box" && typeB === "box") {
    return PHYSICS_CONTACT_PAIR_KIND.BOX_BOX;
  }
  if ((typeA === "plane" && typeB === "box")
      || (typeA === "box" && typeB === "plane")) {
    return PHYSICS_CONTACT_PAIR_KIND.PLANE_BOX;
  }
  return PHYSICS_CONTACT_PAIR_KIND.GENERAL;
}

// broadphase候補をshape pairごとのnarrowphaseへ渡し、PhysicsSpaceのmanifold形式へ整える
// Box/BoxとPlane/Boxは実績済みのBox接触式をここから一度だけ選び、他のshape pairはcolliderへ渡します
export function buildPhysicsManifold(space, entryA, entryB) {
  const typeA = entryA.collider?.type;
  const typeB = entryB.collider?.type;
  const pairKind = getPhysicsContactPairKind(typeA, typeB);
  if (pairKind === PHYSICS_CONTACT_PAIR_KIND.BOX_BOX) {
    const boxA = entryA.collider.getWorldInfo(entryA.position, entryA.quat);
    const boxB = entryB.collider.getWorldInfo(entryB.position, entryB.quat);
    const defaultTolerance = Math.max(...boxA.half, ...boxB.half) * 0.25;
    const contact = buildBoxContact(
      boxA,
      boxB,
      space.computeBoxSupportFeatureTolerance ?? defaultTolerance
    );
    if (contact === null) {
      return null;
    }
    return {
      bodyA: entryA.body,
      bodyB: entryB.body,
      normal: [...contact.normal],
      source: { kind: "computeBox" },
      contacts: [{
        featureKey: "compute-box-primary",
        penetration: contact.penetration,
        point: [...contact.point]
      }]
    };
  }
  const planeEntry = typeA === "plane"
    ? entryA
    : typeB === "plane"
      ? entryB
      : null;
  const boxEntry = typeA === "box"
    ? entryA
    : typeB === "box"
      ? entryB
      : null;
  if (pairKind === PHYSICS_CONTACT_PAIR_KIND.PLANE_BOX) {
    const plane = planeEntry.collider.getWorldInfo(planeEntry.position);
    const box = boxEntry.collider.getWorldInfo(boxEntry.position, boxEntry.quat);
    const vertices = boxEntry.collider.getVertices(boxEntry.position, boxEntry.quat);
    // Planeのactive support点は実績solverと同じくposition slop幅で選びます
    // Box-Boxのsupport feature許容値を流用すると、側面頂点まで床支持へ入り角運動量が変わります
    const defaultTolerance = Math.max(...box.half) * 0.0125;
    const contact = buildPlaneBoxSupportContact(
      plane,
      box.center,
      vertices,
      space.positionCorrectionSlop ?? defaultTolerance
    );
    if (contact === null) {
      return null;
    }
    return {
      bodyA: planeEntry.body,
      bodyB: boxEntry.body,
      normal: [...plane.normal],
      source: {
        kind: "computePlaneBox",
        supportCount: contact.activePoints.length,
        balanced: contact.balanced
      },
      contacts: [{
        featureKey: "compute-plane-box-support",
        penetration: contact.penetration,
        point: [...contact.point]
      }]
    };
  }
  return entryA.collider.buildManifoldWith(
    entryA.position,
    entryB.collider,
    entryB.position,
    entryA.body,
    entryB.body,
    entryA.quat,
    entryB.quat
  );
}

// Box-BoxまたはPlane-Boxの候補かを、narrow phaseを実行する前に判定する
// これらのpairはfixed step内で再利用するBox候補から一度だけ処理するため、
// 専用manifoldの接触を一度だけ生成し、一般manifold側の二重計算を省きます
export function isComputeBoxCandidatePair(entryA, entryB) {
  const typeA = entryA?.collider?.type;
  const typeB = entryB?.collider?.type;
  return getPhysicsContactPairKind(typeA, typeB)
    !== PHYSICS_CONTACT_PAIR_KIND.GENERAL;
}

// manifoldをflat contact一覧へ展開する
export function flattenPhysicsManifoldContacts(manifold) {
  const contacts = [];
  if (!manifold || !Array.isArray(manifold.contacts)) {
    return contacts;
  }
  for (let i = 0; i < manifold.contacts.length; i++) {
    contacts.push({
      bodyA: manifold.bodyA,
      bodyB: manifold.bodyB,
      normal: [...manifold.normal],
      penetration: manifold.contacts[i].penetration,
      point: Array.isArray(manifold.contacts[i].point) ? [...manifold.contacts[i].point] : null
    });
  }
  return contacts;
}

// broadphase候補からnarrowphaseを実行し、実際のmanifold一覧を作る
export function collectPhysicsManifolds(space, stateMap, options = {}) {
  const opts = util.readPlainObject(options, "PhysicsSpace manifold collection options", {});
  const includeComputeBoxContacts = util.readOptionalBoolean(
    opts.includeComputeBoxContacts,
    "PhysicsSpace manifold collection includeComputeBoxContacts",
    true
  );
  // BoxとPlaneだけのworldでは一般manifoldへ渡す形状ペアを空にします
  // entry配列、AABB、sweep-and-pruneをsolver反復ごとに作る前に終了し、
  // 速度改善済みreferenceと同じくfixed step内のBox候補だけを再利用します
  if (includeComputeBoxContacts !== true
      && space.bodies.every((body) => {
        const collider = body?.getCollider?.();
        return !collider || collider.type === "box" || collider.type === "plane";
      })) {
    return [];
  }
  const manifolds = [];
  const entries = space._collectStepColliderEntries(stateMap);
  const candidatePairs = space._collectBroadphasePairs(entries);
  for (let i = 0; i < candidatePairs.length; i++) {
    const pair = candidatePairs[i];
    const pairKind = getPhysicsContactPairKind(
      pair.entryA.collider?.type,
      pair.entryB.collider?.type
    );
    if (includeComputeBoxContacts !== true
        && pairKind !== PHYSICS_CONTACT_PAIR_KIND.GENERAL) {
      continue;
    }
    const manifold = buildPhysicsManifold(space, pair.entryA, pair.entryB);
    if (manifold !== null && Array.isArray(manifold.contacts) && manifold.contacts.length > 0) {
      manifolds.push(manifold);
    }
  }
  return manifolds;
}
