// ---------------------------------------------
// PhysicsQueries.js  2026/08/28
//   Query option validation and collider query collection for PhysicsSpace
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import util from "./util.js";

// 現在のbody transformからquery用stateを作る
// PhysicsSpaceのbody保存形式をqueryの形状判定へ直接漏らさず、必要な値だけを渡します
export function getPhysicsQueryState(space, body) {
  return {
    position: space._cloneVec3(body.getPosition()),
    quat: body.getQuat()
  };
}

// raycast optionを検証し、ray hit収集で使う形へまとめる
export function readPhysicsRaycastOptions(space, options) {
  const opts = util.readPlainObject(options, "PhysicsSpace raycast options", {});
  return {
    maxDistance: util.readOptionalFiniteNumber(
      opts.maxDistance,
      "PhysicsSpace raycast maxDistance",
      Infinity,
      { min: 0.0 }
    ),
    includeTriggers: util.readOptionalBoolean(
      opts.includeTriggers,
      "PhysicsSpace raycast includeTriggers",
      true
    ),
    triggerOnly: util.readOptionalBoolean(
      opts.triggerOnly,
      "PhysicsSpace raycast triggerOnly",
      false
    ),
    layerMask: readPhysicsCollisionBits(
      opts.layerMask ?? 0xffffffff,
      "PhysicsSpace raycast layerMask"
    ),
    filter: opts.filter
  };
}

// AABB query optionを検証し、collider entry収集で使う形へまとめる
export function readPhysicsQueryAabbOptions(options) {
  const opts = util.readPlainObject(options, "PhysicsSpace queryAabb options", {});
  return {
    includeTriggers: util.readOptionalBoolean(
      opts.includeTriggers,
      "PhysicsSpace queryAabb includeTriggers",
      true
    ),
    triggerOnly: util.readOptionalBoolean(
      opts.triggerOnly,
      "PhysicsSpace queryAabb triggerOnly",
      false
    ),
    layerMask: readPhysicsCollisionBits(
      opts.layerMask ?? 0xffffffff,
      "PhysicsSpace queryAabb layerMask"
    ),
    filter: opts.filter
  };
}

// sphere overlap optionを検証し、collider entry収集で使う形へまとめる
export function readPhysicsOverlapSphereOptions(options) {
  const opts = util.readPlainObject(options, "PhysicsSpace overlapSphere options", {});
  return {
    includeTriggers: util.readOptionalBoolean(
      opts.includeTriggers,
      "PhysicsSpace overlapSphere includeTriggers",
      true
    ),
    triggerOnly: util.readOptionalBoolean(
      opts.triggerOnly,
      "PhysicsSpace overlapSphere triggerOnly",
      false
    ),
    layerMask: readPhysicsCollisionBits(
      opts.layerMask ?? 0xffffffff,
      "PhysicsSpace overlapSphere layerMask"
    ),
    filter: opts.filter
  };
}

// collision layer / mask用の32bit bitmaskを読む
export function readPhysicsCollisionBits(value, name) {
  return util.readFiniteNumber(value, name, {
    integer: true,
    min: 0,
    max: 0xffffffff
  });
}

// query layerMaskとbody layerが一致するかを返す
export function matchesPhysicsQueryLayer(body, layerMask) {
  if (!body?.getCollisionLayer) {
    return false;
  }
  return (body.getCollisionLayer() & layerMask) !== 0;
}

// includeTriggers / triggerOnly optionにbodyが一致するかを返す
export function matchesPhysicsQueryTriggerMode(body, query) {
  const isTrigger = body?.getTrigger?.() === true;
  if (query.triggerOnly === true) {
    return isTrigger;
  }
  if (query.includeTriggers === false && isTrigger) {
    return false;
  }
  return true;
}

// query filterを検証する
export function assertPhysicsQueryFilter(filter, name) {
  if (filter !== undefined && typeof filter !== "function") {
    throw new Error(`${name} filter must be a function`);
  }
}

// 2つのAABBが重なるかを返す
// broadphaseとqueryの両方から使うため、AABBの比較式をこの内部部品へ集めます
export function intersectPhysicsAabb(minA, maxA, minB, maxB) {
  if (maxA[0] < minB[0] || minA[0] > maxB[0]) return false;
  if (maxA[1] < minB[1] || minA[1] > maxB[1]) return false;
  if (maxA[2] < minB[2] || minA[2] > maxB[2]) return false;
  return true;
}

// 現在のPhysicsSpaceからquery用collider entry一覧を収集する
// collider種別を固定せず、各query methodへ渡すtransformとfilter済みbodyを並べます
export function collectPhysicsQueryEntries(space, query = {}) {
  const includeTriggers = query.includeTriggers ?? true;
  const triggerOnly = query.triggerOnly ?? false;
  const layerMask = query.layerMask ?? 0xffffffff;
  const filter = query.filter;
  const entries = [];
  for (let i = 0; i < space.bodies.length; i++) {
    const body = space.bodies[i];
    const collider = body?.getCollider?.();
    if (!collider) {
      continue;
    }
    if (!matchesPhysicsQueryTriggerMode(body, { includeTriggers, triggerOnly })) {
      continue;
    }
    if (!matchesPhysicsQueryLayer(body, layerMask)) {
      continue;
    }
    if (typeof filter === "function" && filter(body) !== true) {
      continue;
    }
    const state = getPhysicsQueryState(space, body);
    entries.push({
      body,
      collider,
      position: state.position,
      quat: state.quat
    });
  }
  return entries;
}

// raycast用に1 body分のhitを収集する
// colliderがhitを返さない場合は、そのbodyを結果へ追加せずnullとして扱います
export function raycastPhysicsBody(space, body, rayOrigin, rayDir, query) {
  if (!body?.getCollider?.()) {
    return null;
  }
  if (!matchesPhysicsQueryTriggerMode(body, query)) {
    return null;
  }
  if (!matchesPhysicsQueryLayer(body, query.layerMask)) {
    return null;
  }
  if (typeof query.filter === "function" && query.filter(body) !== true) {
    return null;
  }
  const state = getPhysicsQueryState(space, body);
  const collider = body.getCollider();
  const hit = collider.intersectRay?.(
    state.position,
    rayOrigin,
    rayDir,
    query.maxDistance,
    state.quat
  ) ?? null;
  if (hit === null) {
    return null;
  }
  return {
    body,
    distance: hit.distance,
    position: [...hit.position],
    normal: [...hit.normal]
  };
}

// raycastの全hitを距離順に返す
export function collectPhysicsRayHits(space, rayOrigin, rayDir, query) {
  const hits = [];
  for (let i = 0; i < space.bodies.length; i++) {
    const hit = raycastPhysicsBody(space, space.bodies[i], rayOrigin, rayDir, query);
    if (hit !== null) {
      hits.push(hit);
    }
  }
  hits.sort((leftHit, rightHit) => leftHit.distance - rightHit.distance);
  return hits;
}
