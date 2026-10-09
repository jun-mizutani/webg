// ---------------------------------------------
// ComputePhysicsReadback.js  2026/09/14
//   Readback, Node synchronization, contacts, events, and queries for ComputePhysicsSpace
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import util from "./util.js";
import { COMPUTE_PHYSICS_BODY_STATE_LAYOUT } from "./ComputeBodyState.js";

// ComputePhysicsSpaceのGPU readbackをNode同期、contact event、shape queryへ変換する内部関数群
// GPU処理とsubmitはComputePhysicsSpace側に残し、ここでは明示的に渡されたreadback値だけを扱います
// 現在のBodyStateをCPUへコピーするためのMAP_READ bufferを生成します
// submitやmapAsyncは呼出側へ残し、通常描画では明示的なreadback経路を使います
export function createStateReadbackBuffer(space) {
  space.requireAlive();
  return space.device.createBuffer({
    label: `${space.label}:state-readback`,
    size: space.maxBodies * COMPUTE_PHYSICS_BODY_STATE_LAYOUT.strideBytes,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
  });
}

// 指定したreadback bufferへ最新BodyStateのslot全体をcopyする命令を記録します
// 実際のsubmitは呼出側が行い、GPU処理完了後に呼出側がmapAsyncを開始します
export function encodeStateReadback(space, commandEncoder, readbackBuffer) {
  space.requireEncoder(commandEncoder, "encodeStateReadback");
  space.requireAlive();
  if (!readbackBuffer) throw new Error(`${space.label} encodeStateReadback requires a readback buffer`);
  const copySize = space.bodySlotCount * COMPUTE_PHYSICS_BODY_STATE_LAYOUT.strideBytes;
  if (copySize > 0) {
    commandEncoder.copyBufferToBuffer(
      space.states.getCurrent(),
      0,
      readbackBuffer,
      0,
      copySize
    );
  }
  return copySize;
}

// submit完了後のreadback bufferをFloat32Arrayへ複製してunmapします
// 呼出側がbody IDとslotをgetBodyInfo()で対応付け、位置や速度の読み取りを明示的に行います
export async function readStateReadback(space, readbackBuffer, bodyCount = space.bodySlotCount) {
  space.requireAlive();
  if (!readbackBuffer?.mapAsync || !readbackBuffer?.getMappedRange) {
    throw new Error(`${space.label} readStateReadback requires a GPUBuffer with MAP_READ`);
  }
  const count = util.readOptionalInteger(bodyCount, `${space.label} readStateReadback bodyCount`, space.bodySlotCount, {
    min: 0,
    max: space.maxBodies
  });
  if (count === 0) return new Float32Array(0);
  // submit済みcommandがreadback copyを完了するまでmapAsyncで待ち、mapped rangeをCPU配列へ複製します
  await readbackBuffer.mapAsync(GPUMapMode.READ, 0, count * COMPUTE_PHYSICS_BODY_STATE_LAYOUT.strideBytes);
  const mapped = readbackBuffer.getMappedRange(0, count * COMPUTE_PHYSICS_BODY_STATE_LAYOUT.strideBytes);
  const result = new Float32Array(mapped.slice(0));
  readbackBuffer.unmap();
  return result;
}

// readStateReadback()のFloat32Arrayから一つのbody状態をIDで取り出します
// slotの空きやbody IDの再利用を推測せず、現在のIDと固定slotの対応を検証して読み取ります
export function readBodyStateFromReadback(space, bodyId, stateData) {
  space.requireAlive();
  const record = space.getBodyRecord(bodyId);
  if (!(stateData instanceof Float32Array)) {
    throw new Error(`${space.label} readBodyStateFromReadback stateData must be a Float32Array`);
  }
  const base = record.slot * COMPUTE_PHYSICS_BODY_STATE_LAYOUT.strideFloats;
  const requiredLength = base + COMPUTE_PHYSICS_BODY_STATE_LAYOUT.strideFloats;
  if (stateData.length < requiredLength) {
    throw new Error(`${space.label} readBodyStateFromReadback stateData does not include body slot ${record.slot}`);
  }
  const readFinite = (offset, name) => util.readFiniteNumber(stateData[base + offset], `${space.label} ${name}`);
  const position = [
    readFinite(COMPUTE_PHYSICS_BODY_STATE_LAYOUT.position, `body ${record.id} position.x`),
    readFinite(COMPUTE_PHYSICS_BODY_STATE_LAYOUT.position + 1, `body ${record.id} position.y`),
    readFinite(COMPUTE_PHYSICS_BODY_STATE_LAYOUT.position + 2, `body ${record.id} position.z`)
  ];
  const orientation = space.readQuat([
    readFinite(COMPUTE_PHYSICS_BODY_STATE_LAYOUT.orientation, `body ${record.id} orientation.w`),
    readFinite(COMPUTE_PHYSICS_BODY_STATE_LAYOUT.orientation + 1, `body ${record.id} orientation.x`),
    readFinite(COMPUTE_PHYSICS_BODY_STATE_LAYOUT.orientation + 2, `body ${record.id} orientation.y`),
    readFinite(COMPUTE_PHYSICS_BODY_STATE_LAYOUT.orientation + 3, `body ${record.id} orientation.z`)
  ], `${space.label} body ${record.id} orientation`);
  const linearVelocity = [
    readFinite(COMPUTE_PHYSICS_BODY_STATE_LAYOUT.linearVelocityInvMass, `body ${record.id} linearVelocity.x`),
    readFinite(COMPUTE_PHYSICS_BODY_STATE_LAYOUT.linearVelocityInvMass + 1, `body ${record.id} linearVelocity.y`),
    readFinite(COMPUTE_PHYSICS_BODY_STATE_LAYOUT.linearVelocityInvMass + 2, `body ${record.id} linearVelocity.z`)
  ];
  const inverseMass = readFinite(
    COMPUTE_PHYSICS_BODY_STATE_LAYOUT.linearVelocityInvMass + 3,
    `body ${record.id} inverseMass`
  );
  const angularVelocity = [
    readFinite(COMPUTE_PHYSICS_BODY_STATE_LAYOUT.angularVelocitySleep, `body ${record.id} angularVelocity.x`),
    readFinite(COMPUTE_PHYSICS_BODY_STATE_LAYOUT.angularVelocitySleep + 1, `body ${record.id} angularVelocity.y`),
    readFinite(COMPUTE_PHYSICS_BODY_STATE_LAYOUT.angularVelocitySleep + 2, `body ${record.id} angularVelocity.z`)
  ];
  const sleepFlag = readFinite(
    COMPUTE_PHYSICS_BODY_STATE_LAYOUT.angularVelocitySleep + 3,
    `body ${record.id} sleeping`
  );
  const sleepCounter = readFinite(
    COMPUTE_PHYSICS_BODY_STATE_LAYOUT.halfExtentsSleepCounter + 3,
    `body ${record.id} sleepCounter`
  );
  return Object.freeze({
    id: record.id,
    slot: record.slot,
    position,
    orientation,
    linearVelocity,
    angularVelocity,
    inverseMass,
    sleeping: sleepFlag > 0.5,
    sleepCounter,
    bodyType: record.descriptor.bodyType
  });
}

// GPU readback状態をNodeまたはPhysicsNodeへ反映します
// readbackの発行とsubmitは呼出側に残し、通常のGPU描画では非同期CPU同期を明示的に追加します
export function syncNodeFromPhysics(space, bodyId, node, stateData, options = {}) {
  space.requireAlive();
  const opts = util.readPlainObject(options, `${space.label} syncNodeFromPhysics options`, {});
  if (!node || typeof node !== "object") {
    throw new Error(`${space.label} syncNodeFromPhysics node must be an object`);
  }
  const state = space.readBodyStateFromReadback(bodyId, stateData);
  const physicsNodeLike = typeof node.syncNodeFromPhysics === "function";
  // Nodeの種類に応じてtransformだけ、または速度・sleepまで同期する範囲を確定します
  const syncVelocity = util.readOptionalBoolean(
    opts.syncVelocity,
    `${space.label} syncNodeFromPhysics syncVelocity`,
    physicsNodeLike
  );
  const syncSleep = util.readOptionalBoolean(
    opts.syncSleep,
    `${space.label} syncNodeFromPhysics syncSleep`,
    physicsNodeLike
  );
  if (typeof node.syncNodeFromPhysics !== "function"
    && (typeof node.setPosition !== "function" || typeof node.setQuat !== "function")) {
    throw new Error(`${space.label} syncNodeFromPhysics node requires syncNodeFromPhysics() or setPosition()/setQuat()`);
  }
  if (syncVelocity
    && (typeof node.setLinearVelocityVec !== "function" || typeof node.setAngularVelocityVec !== "function")) {
    throw new Error(`${space.label} syncNodeFromPhysics syncVelocity requires setLinearVelocityVec()/setAngularVelocityVec()`);
  }
  if (syncSleep
    && (typeof node.stopMotion !== "function" || typeof node.sleep !== "function" || typeof node.wakeUp !== "function")) {
    throw new Error(`${space.label} syncNodeFromPhysics syncSleep requires stopMotion()/sleep()/wakeUp()`);
  }
  if (syncSleep && state.sleeping && typeof node.getAllowSleep === "function" && node.getAllowSleep() !== true) {
    throw new Error(`${space.label} syncNodeFromPhysics cannot sleep a node with allowSleep=false`);
  }

  const quat = space.createQuat(state.orientation, `${space.label} body ${state.id} orientation`);
  // readbackしたGPU transformをNodeへ反映し、必要な場合だけCPU版PhysicsNodeの速度・sleepも更新します
  if (physicsNodeLike) {
    node.syncNodeFromPhysics(state.position, { quat });
  } else {
    node.setPosition(state.position[0], state.position[1], state.position[2]);
    node.setQuat(quat);
  }
  if (syncVelocity) {
    node.setLinearVelocityVec(state.linearVelocity);
    node.setAngularVelocityVec(state.angularVelocity);
  }
  if (syncSleep) {
    if (state.sleeping) {
      node.stopMotion();
      node.sleep();
    } else {
      node.wakeUp();
    }
  }
  return state;
}

// 複数のbodyとNodeの対応を一つのreadback配列から順に反映します
// Mapまたは{bodyId,node}配列を受け付け、対応するIDとNodeを一つずつ検証します
export function syncNodesFromPhysics(space, stateData, bindings, options = {}) {
  space.requireAlive();
  const entries = bindings instanceof Map
    ? [...bindings.entries()].map(([bodyId, node]) => ({ bodyId, node }))
    : Array.isArray(bindings)
      ? bindings.map((binding, index) => {
        const value = util.readPlainObject(binding, `${space.label} syncNodesFromPhysics bindings[${index}]`);
        if (value.bodyId === undefined) {
          throw new Error(`${space.label} syncNodesFromPhysics bindings[${index}].bodyId is required`);
        }
        if (value.node === undefined) {
          throw new Error(`${space.label} syncNodesFromPhysics bindings[${index}].node is required`);
        }
        return { bodyId: value.bodyId, node: value.node };
      })
      : null;
  if (!entries) {
    throw new Error(`${space.label} syncNodesFromPhysics bindings must be a Map or an array`);
  }
  return entries.map(({ bodyId, node }) => space.syncNodeFromPhysics(bodyId, node, stateData, options));
}

// NodeまたはPhysicsNodeの現在状態をGPU側bodyへ反映する命令を記録します
// position、姿勢、速度、bodyTypeの反映を一つの呼出しへまとめ、実際の適用は次のfixed stepへ残します
export function syncPhysicsFromNode(space, bodyId, node, options = {}) {
  space.requireAlive();
  const record = space.getBodyRecord(bodyId);
  const opts = util.readPlainObject(options, `${space.label} syncPhysicsFromNode options`, {});
  if (!node || typeof node !== "object") {
    throw new Error(`${space.label} syncPhysicsFromNode node must be an object`);
  }

  const source = typeof node.syncPhysicsFromNode === "function"
    ? node.syncPhysicsFromNode()
    : (() => {
      if (typeof node.getPosition !== "function" || typeof node.getQuat !== "function") {
        throw new Error(`${space.label} syncPhysicsFromNode node requires syncPhysicsFromNode() or getPosition()/getQuat()`);
      }
      return {
        position: node.getPosition(),
        quat: node.getQuat()
      };
    })();
  const sourceValue = util.readPlainObject(source, `${space.label} syncPhysicsFromNode source`);
  // NodeまたはPhysicsNodeから位置、姿勢、任意の速度を読み、GPU commandへ変換する入力を作ります
  const position = space.readVec3(sourceValue.position, `${space.label} syncPhysicsFromNode position`);
  const orientationInput = sourceValue.quat ?? sourceValue.orientation;
  if (orientationInput === undefined) {
    throw new Error(`${space.label} syncPhysicsFromNode source requires quat or orientation`);
  }
  const orientation = space.readQuatLike(orientationInput, `${space.label} syncPhysicsFromNode orientation`);
  const syncBodyType = util.readOptionalBoolean(
    opts.syncBodyType,
    `${space.label} syncPhysicsFromNode syncBodyType`,
    sourceValue.bodyType !== undefined
  );
  const syncVelocity = util.readOptionalBoolean(
    opts.syncVelocity,
    `${space.label} syncPhysicsFromNode syncVelocity`,
    sourceValue.velocity !== undefined
      || sourceValue.linearVelocity !== undefined
      || sourceValue.angularVelocity !== undefined
  );
  const wakeUp = util.readOptionalBoolean(opts.wakeUp, `${space.label} syncPhysicsFromNode wakeUp`, true);
  let nextBodyType = record.descriptor.bodyType;
  if (syncBodyType) {
    if (sourceValue.bodyType === undefined) {
      throw new Error(`${space.label} syncPhysicsFromNode syncBodyType requires source.bodyType`);
    }
    nextBodyType = space.readBodyType(sourceValue.bodyType, `${space.label} syncPhysicsFromNode bodyType`);
  }

  let linearVelocity = null;
  let angularVelocity = null;
  if (syncVelocity) {
    const linearInput = sourceValue.velocity ?? sourceValue.linearVelocity;
    const angularInput = sourceValue.angularVelocity;
    if (linearInput === undefined || angularInput === undefined) {
      throw new Error(`${space.label} syncPhysicsFromNode syncVelocity requires linear and angular velocity`);
    }
    linearVelocity = space.readVec3(linearInput, `${space.label} syncPhysicsFromNode linearVelocity`);
    angularVelocity = space.readVec3(angularInput, `${space.label} syncPhysicsFromNode angularVelocity`);
  }
  const surfaceVelocity = sourceValue.surfaceVelocity === undefined
    ? null
    : space.readVec3(sourceValue.surfaceVelocity, `${space.label} syncPhysicsFromNode surfaceVelocity`);
  if (surfaceVelocity && nextBodyType !== "kinematic"
      && surfaceVelocity.some((entry) => entry !== 0.0)) {
    throw new Error(`${space.label} syncPhysicsFromNode surfaceVelocity requires a kinematic body`);
  }

  // body type変更、teleport、姿勢、速度を順にcommandへ積み、次のfixed stepで一括適用します
  if (syncBodyType && nextBodyType !== record.descriptor.bodyType) {
    space.setBodyType(bodyId, nextBodyType, { clearVelocity: false });
  }
  space.teleport(bodyId, position, { keepVelocity: true, wakeUp });
  space.setBodyOrientation(bodyId, orientation, { wakeUp });
  if (syncVelocity) {
    space.setBodyLinearVelocity(bodyId, linearVelocity);
    space.setBodyAngularVelocity(bodyId, angularVelocity);
  }
  if (surfaceVelocity && nextBodyType === "kinematic") {
    space.setBodySurfaceVelocity(bodyId, surfaceVelocity);
  }
  return Object.freeze({
    id: record.id,
    slot: record.slot,
    position: [...position],
    orientation: [...orientation],
    linearVelocity: linearVelocity ? [...linearVelocity] : null,
    angularVelocity: angularVelocity ? [...angularVelocity] : null,
    surfaceVelocity: surfaceVelocity ? [...surfaceVelocity] : null,
    bodyType: nextBodyType
  });
}

/** @internal
 * Compute queryへ渡すtrigger、layer、filter、最大距離を検証します
 * filterへGPU上のbody objectを渡せないため、readback時のbodyInfoを引数にする規則を固定します
 */
export function readComputeQueryOptions(space, options, name, includeMaxDistance = false) {
  const opts = util.readPlainObject(options, `${space.label} ${name} options`, {});
  if (opts.filter !== undefined && typeof opts.filter !== "function") {
    throw new Error(`${space.label} ${name} filter must be a function`);
  }
  return {
    includeTriggers: util.readOptionalBoolean(
      opts.includeTriggers,
      `${space.label} ${name} includeTriggers`,
      true
    ),
    triggerOnly: util.readOptionalBoolean(
      opts.triggerOnly,
      `${space.label} ${name} triggerOnly`,
      false
    ),
    layerMask: space.readCollisionBits(
      opts.layerMask,
      `${space.label} ${name} layerMask`,
      0xffffffff
    ),
    filter: opts.filter,
    maxDistance: includeMaxDistance
      ? util.readOptionalFiniteNumber(
        opts.maxDistance,
        `${space.label} ${name} maxDistance`,
        Infinity,
        { min: 0 }
      )
      : null
  };
}

/** @internal
 * readback配列へ含まれるbodyをquery用entryへ変換します
 * slot hole、trigger、layer、filterをここで除外し、各queryが同じ対象集合を使うようにします
 */
export function collectReadbackQueryEntries(space, stateData, query, name) {
  space.requireAlive();
  if (!(stateData instanceof Float32Array)) {
    throw new Error(`${space.label} ${name} stateData must be a Float32Array`);
  }
  const requiredLength = space.bodySlotCount * COMPUTE_PHYSICS_BODY_STATE_LAYOUT.strideFloats;
  if (stateData.length < requiredLength) {
    throw new Error(`${space.label} ${name} stateData does not include all body slots`);
  }
  const entries = [];
  for (let slot = 0; slot < space.bodySlotCount; slot++) {
    const record = space.slotRecords[slot];
    if (record === null) continue;
    const info = space.getBodyInfo(record.id);
    const isTrigger = info.isTrigger === true;
    if (query.triggerOnly && !isTrigger) continue;
    if (!query.triggerOnly && !query.includeTriggers && isTrigger) continue;
    if ((info.collisionLayer & query.layerMask) === 0) continue;
    if (typeof query.filter === "function" && query.filter(info) !== true) continue;
    entries.push({
      record,
      info,
      state: space.readBodyStateFromReadback(record.id, stateData)
    });
  }
  return entries;
}

/** @internal
 * quaternionでvec3を回転し、inverse=trueなら逆回転を返します
 * readback状態の姿勢は[w,x,y,z]で正規化済みのため、行列生成なしでqueryの局所座標を求めます
 */
export function rotateReadbackVector(space, quat, vector, inverse = false) {
  const qx = inverse ? -quat[1] : quat[1];
  const qy = inverse ? -quat[2] : quat[2];
  const qz = inverse ? -quat[3] : quat[3];
  const tx = 2 * (qy * vector[2] - qz * vector[1]);
  const ty = 2 * (qz * vector[0] - qx * vector[2]);
  const tz = 2 * (qx * vector[1] - qy * vector[0]);
  return [
    vector[0] + quat[0] * tx + qy * tz - qz * ty,
    vector[1] + quat[0] * ty + qz * tx - qx * tz,
    vector[2] + quat[0] * tz + qx * ty - qy * tx
  ];
}

/** @internal
 * readback bodyのOBB三軸をworld座標へ変換します
 * BoxのAABB、raycast、Sphere overlapが同じ姿勢解釈を参照するための共通処理です
 */
export function getReadbackBodyAxes(space, state) {
  return [
    space.rotateReadbackVector(state.orientation, [1, 0, 0]),
    space.rotateReadbackVector(state.orientation, [0, 1, 0]),
    space.rotateReadbackVector(state.orientation, [0, 0, 1])
  ];
}

/** @internal
 * readback bodyのworld AABBをColliderへ問い合わせます
 * 姿勢、offset、形状ごとの外接処理をComputePhysicsSpace側で再実装せず、ColliderのCPU queryと同じ結果を返します
 */
export function getReadbackBodyAabb(space, state) {
  const collider = space.getBodyRecord(state.id).descriptor.collider;
  const aabb = collider.getAabb(state.position, state.orientation);
  if (aabb === null) {
    throw new Error(`${space.label} readback body ${state.id} collider does not provide an AABB`);
  }
  return {
    min: [...aabb.min],
    max: [...aabb.max]
  };
}

/** @internal
 * readback bodyのhalf extentsをdescriptorから取得し、query内で同じ値を再利用します
 * Capsuleではradius、halfSegment、radiusのshape dataを返し、形状固有の寸法として扱います
 */
export function getReadbackBodyHalfExtents(space, state) {
  const collider = space.getBodyRecord(state.id).descriptor.collider;
  return [...(collider.getBodyShapeData?.() ?? collider.getHalfExtents())];
}

/** @internal
 * readback bodyと軸平行AABBの重なりをColliderへ問い合わせます
 * BoxのSATやSphereの最近傍点計算をSpace側で複製せず、CPU版Colliderと同じ形状式を使います
 */
export function readbackBoxOverlapsAabb(space, state, queryMin, queryMax) {
  const collider = space.getBodyRecord(state.id).descriptor.collider;
  return collider.overlapsAabb(
    state.position,
    queryMin,
    queryMax,
    state.orientation
  );
}

/** @internal
 * readback bodyのray交差をColliderへ問い合わせ、一件のbody識別情報を付加して返します
 * ray directionの正規化とmaxDistanceの検証は公開query側で行い、形状ごとの交差式はColliderへ集約します
 */
export function intersectReadbackBodyRay(space, entry, origin, direction, maxDistance) {
  const collider = entry.record.descriptor.collider;
  const hit = collider.intersectRay(
    entry.state.position,
    origin,
    direction,
    maxDistance,
    entry.state.orientation
  );
  if (hit === null) return null;
  return {
    bodyId: entry.record.id,
    slot: entry.record.slot,
    distance: hit.distance,
    position: [...hit.position],
    normal: [...hit.normal]
  };
}

/** @internal
 * readback bodyとquery Sphereの重なりをColliderへ問い合わせます
 * Box内部のclosestPointやSphere同士の距離処理をSpace側で形状判別せず、CPU版Colliderの結果を使います
 */
export function overlapReadbackBodySphere(space, entry, center, radius) {
  const collider = entry.record.descriptor.collider;
  const overlap = collider.overlapSphere(
    entry.state.position,
    center,
    radius,
    entry.state.orientation
  );
  if (overlap === null) return null;
  return {
    closestPoint: [...overlap.closestPoint],
    distance: overlap.distance
  };
}

/** @internal
 * readback body同士のCollider manifoldから最も深いcontactを一件返します
 * 複数contactを必要とする呼出側はgetReadbackBodyManifold()またはgetContactsFromReadback()を使います
 */
export function getReadbackBodyContact(space, entryA, entryB) {
  const manifold = space.getReadbackBodyManifold(entryA, entryB);
  if (manifold === null || manifold.contacts.length <= 0) return null;
  const contact = manifold.contacts.reduce((deepest, candidate) => {
    if (deepest === null || candidate.penetration > deepest.penetration) return candidate;
    return deepest;
  }, null);
  return {
    bodyAId: manifold.bodyAId,
    bodyBId: manifold.bodyBId,
    bodyASlot: manifold.bodyASlot,
    bodyBSlot: manifold.bodyBSlot,
    normal: [...manifold.normal],
    featureKey: contact.featureKey,
    penetration: contact.penetration,
    point: contact.point === null ? null : [...contact.point]
  };
}

/** @internal
 * readback bodyとComputePlaneColliderの接触をPlane Colliderのmanifoldから取得します
 * Planeはbody IDを持たないためbody同士のcontact形式へ偽の相手bodyを追加せず、代表contactと支持点数だけを返します
 */
export function getReadbackBodyPlaneContact(space, entry, plane, planeIndex) {
  const bodyCollider = entry.record.descriptor.collider;
  const manifold = plane.buildManifoldWith(
    [0, 0, 0],
    bodyCollider,
    entry.state.position,
    null,
    entry.info,
    null,
    entry.state.orientation
  );
  if (manifold === null || !Array.isArray(manifold.contacts) || manifold.contacts.length <= 0) {
    return null;
  }
  const contact = manifold.contacts.reduce((deepest, candidate) => {
    if (deepest === null || candidate.penetration > deepest.penetration) return candidate;
    return deepest;
  }, null);
  return {
    bodyAId: entry.record.id,
    bodyASlot: entry.record.slot,
    bodyBId: null,
    bodyBSlot: null,
    planeIndex,
    normal: [...manifold.normal],
    penetration: util.readFiniteNumber(
      contact.penetration,
      `${space.label} readback plane contact penetration`,
      { min: 0 }
    ),
    point: Array.isArray(contact.point) ? [...contact.point] : null,
    supportPointCount: manifold.contacts.length
  };
}

/** @internal
 * readback body同士のCollider manifoldを取得し、GPU object参照をIDとslotへ変換します
 * Boxのface接触では複数contactを保持し、readbackが提供するimpulseだけを返します
 */
export function getReadbackBodyManifold(space, entryA, entryB) {
  const colliderA = entryA.record.descriptor.collider;
  const colliderB = entryB.record.descriptor.collider;
  const manifold = colliderA.buildManifoldWith(
    entryA.state.position,
    colliderB,
    entryB.state.position,
    entryA.info,
    entryB.info,
    entryA.state.orientation,
    entryB.state.orientation
  );
  if (manifold === null || !Array.isArray(manifold.contacts) || manifold.contacts.length <= 0) {
    return null;
  }
  return {
    bodyAId: entryA.record.id,
    bodyBId: entryB.record.id,
    bodyASlot: entryA.record.slot,
    bodyBSlot: entryB.record.slot,
    normal: [...manifold.normal],
    source: manifold.source ? { ...manifold.source } : null,
    contacts: manifold.contacts.map((contact) => ({
      featureKey: typeof contact.featureKey === "string" ? contact.featureKey : null,
      penetration: util.readFiniteNumber(
        contact.penetration,
        `${space.label} readback manifold penetration`,
        { min: 0 }
      ),
      point: Array.isArray(contact.point) ? [...contact.point] : null
    }))
  };
}

// readback状態のbody同士をBroad Phase後の形状接触まで絞り、現在のcontact一覧を返します
// queryと同じreadback、layer/mask、trigger、filterを使い、現在のGPU状態をそのまま問い合わせます
export function getContactsFromReadback(space, stateData, options = {}) {
  const query = space.readComputeQueryOptions(options, "getContactsFromReadback");
  const entries = space.collectReadbackQueryEntries(
    stateData,
    { ...query, includeTriggers: true, triggerOnly: false },
    "getContactsFromReadback"
  );
  const contacts = [];
  // Broad Phase相当のAABBとlayer/maskを先に確認し、形状manifoldを必要なbody pairだけへ限定します
  for (let firstIndex = 0; firstIndex < entries.length; firstIndex++) {
    const entryA = entries[firstIndex];
    for (let secondIndex = firstIndex + 1; secondIndex < entries.length; secondIndex++) {
      const entryB = entries[secondIndex];
      if ((entryA.info.collisionMask & entryB.info.collisionLayer) === 0
        || (entryB.info.collisionMask & entryA.info.collisionLayer) === 0) {
        continue;
      }
      if (query.triggerOnly === true && !entryA.info.isTrigger && !entryB.info.isTrigger) continue;
      if (query.includeTriggers !== true && (entryA.info.isTrigger || entryB.info.isTrigger)) continue;
      const aabbA = space.getReadbackBodyAabb(entryA.state);
      const aabbB = space.getReadbackBodyAabb(entryB.state);
      if (aabbA.max[0] < aabbB.min[0] || aabbB.max[0] < aabbA.min[0]
        || aabbA.max[1] < aabbB.min[1] || aabbB.max[1] < aabbA.min[1]
        || aabbA.max[2] < aabbB.min[2] || aabbB.max[2] < aabbA.min[2]) {
        continue;
      }
      const manifold = space.getReadbackBodyManifold(entryA, entryB);
      if (manifold === null) continue;
      for (const contact of manifold.contacts) {
        contacts.push({
          bodyAId: manifold.bodyAId,
          bodyBId: manifold.bodyBId,
          bodyASlot: manifold.bodyASlot,
          bodyBSlot: manifold.bodyBSlot,
          normal: [...manifold.normal],
          featureKey: contact.featureKey,
          penetration: contact.penetration,
          point: contact.point === null ? null : [...contact.point]
        });
      }
    }
  }
  space.lastReadbackContacts = contacts.map((contact) => space.cloneReadbackContact(contact));
  return contacts;
}

// readback状態の各bodyについて、境界を含むComputePlaneColliderとの接触一覧を返します
// trigger、layer、filterはbody側へ適用し、Planeは登録済みPlaneとして問い合わせます
export function getPlaneContactsFromReadback(space, stateData, options = {}) {
  const query = space.readComputeQueryOptions(options, "getPlaneContactsFromReadback");
  const entries = space.collectReadbackQueryEntries(
    stateData,
    { ...query, includeTriggers: true, triggerOnly: false },
    "getPlaneContactsFromReadback"
  );
  const contacts = [];
  // Planeはbody slotを持たないため、各bodyと登録Planeを順に照合して支持接触を返します
  for (const entry of entries) {
    if (query.triggerOnly === true && !entry.info.isTrigger) continue;
    if (query.includeTriggers !== true && entry.info.isTrigger) continue;
    for (let planeIndex = 0; planeIndex < space.planes.length; planeIndex++) {
      const contact = space.getReadbackBodyPlaneContact(entry, space.planes[planeIndex], planeIndex);
      if (contact !== null) contacts.push(contact);
    }
  }
  return contacts;
}

// readback contact一覧をColliderが生成したmanifold形式へまとめます
// 複数contactは保持し、readbackへ記録されたnormal/tangent impulseを診断値として返します
export function getManifoldsFromReadback(space, stateData, options = {}) {
  const contacts = space.getContactsFromReadback(stateData, options);
  const manifolds = new Map();
  for (const contact of contacts) {
    const key = `${contact.bodyAId}:${contact.bodyBId}`;
    let manifold = manifolds.get(key);
    if (!manifold) {
      manifold = {
        bodyAId: contact.bodyAId,
        bodyBId: contact.bodyBId,
        bodyASlot: contact.bodyASlot,
        bodyBSlot: contact.bodyBSlot,
        normal: [...contact.normal],
        source: { kind: "readback-collider-manifold" },
        contacts: []
      };
      manifolds.set(key, manifold);
    }
    manifold.contacts.push({
      featureKey: contact.featureKey,
      penetration: contact.penetration,
      point: contact.point === null ? null : [...contact.point]
    });
  }
  const result = [...manifolds.values()];
  space.lastReadbackManifolds = result.map((manifold) => space.cloneReadbackManifold(manifold));
  return result;
}

// 直前にこのAPIへ渡したreadback contactとの差分からbegin / stay / endを返します
// readback世代を呼出側が明示するため、毎回同じstateを渡した場合も差分更新は一回ずつです
export function getContactEventsFromReadback(space, stateData, options = {}) {
  const query = space.readComputeQueryOptions(options, "getContactEventsFromReadback");
  const contacts = space.getContactsFromReadback(stateData, query);
  const current = new Map();
  // 同一body pairの複数contactから最深contactだけをphase比較用の代表値にします
  for (const contact of contacts) {
    const key = `${contact.bodyAId}:${contact.bodyBId}`;
    const previous = current.get(key);
    if (!previous || contact.penetration > previous.penetration) {
      current.set(key, contact);
    }
  }
  const sameQuery = space.readbackContactEventOptions !== null
    && space.readbackContactEventOptions.includeTriggers === query.includeTriggers
    && space.readbackContactEventOptions.triggerOnly === query.triggerOnly
    && space.readbackContactEventOptions.layerMask === query.layerMask
    && space.readbackContactEventOptions.filter === query.filter;
  const previous = sameQuery ? space.readbackContactMap : new Map();
  const events = { begin: [], stay: [], end: [] };
  for (const [key, contact] of current) {
    events[previous.has(key) ? "stay" : "begin"].push(space.cloneReadbackContact(contact));
  }
  for (const [key, contact] of previous) {
    if (current.has(key)) continue;
    events.end.push(space.cloneReadbackContact(contact));
  }
  space.readbackContactMap = new Map([...current].map(([key, contact]) => [key, space.cloneReadbackContact(contact)]));
  space.readbackContactEventOptions = {
    includeTriggers: query.includeTriggers,
    triggerOnly: query.triggerOnly,
    layerMask: query.layerMask,
    filter: query.filter
  };
  space.lastReadbackContactEvents = space.cloneReadbackContactEvents(events);
  return events;
}

// 直前に明示的なcontact readbackから得たcontact一覧を返します
// GPU stateをCPUへ移していない場合は空配列を返し、未取得状態を表します
export function getLastContacts(space) {
  space.requireAlive();
  return space.lastReadbackContacts.map((contact) => space.cloneReadbackContact(contact));
}

// 直前に明示的なcontact readbackから得たmanifold一覧を返します
// 明示的なreadbackでCPUへ変換したCompute結果だけを返します
export function getLastManifolds(space) {
  space.requireAlive();
  return space.lastReadbackManifolds.map((manifold) => space.cloneReadbackManifold(manifold));
}

// 直前に明示的なcontact event readbackから得たbegin / stay / endを返します
// GPU内の接触変化を自動取得せず、呼出側がstate世代を渡した結果だけを返します
export function getLastContactEvents(space) {
  space.requireAlive();
  return space.cloneReadbackContactEvents(space.lastReadbackContactEvents);
}

// contact eventをreadbackの明示的なpoll時点でlistenerへ通知します
// getContactEventsFromReadback()は副作用を持たせず、listener通知はこのAPIへ分離します
export function dispatchContactEventsFromReadback(space, stateData, options = {}) {
  const events = space.getContactEventsFromReadback(stateData, options);
  space.emitReadbackContactEvents(events);
  return events;
}

// begin contact listenerを登録します
// GPUの自動callbackではなく、dispatchContactEventsFromReadback()を呼んだ時点で通知します
export function onBeginContact(space, listener) {
  return space.addContactListener(space.beginContactListeners, listener, "onBeginContact");
}

// stay contact listenerを登録します
// 同じreadbackを再度渡した場合も、明示的なpoll一回ごとにstayを通知します
export function onStayContact(space, listener) {
  return space.addContactListener(space.stayContactListeners, listener, "onStayContact");
}

// end contact listenerを登録します
// readbackで前回contactが消えた時にだけ通知します
export function onEndContact(space, listener) {
  return space.addContactListener(space.endContactListeners, listener, "onEndContact");
}

// begin contact listenerを解除します
export function offBeginContact(space, listener) {
  return space.removeContactListener(space.beginContactListeners, listener, "offBeginContact");
}

// stay contact listenerを解除します
export function offStayContact(space, listener) {
  return space.removeContactListener(space.stayContactListeners, listener, "offStayContact");
}

// end contact listenerを解除します
export function offEndContact(space, listener) {
  return space.removeContactListener(space.endContactListeners, listener, "offEndContact");
}

/** @internal
 * contact配列を利用者変更から分離して返します
 */
export function cloneReadbackContact(space, contact) {
  return {
    bodyAId: contact.bodyAId,
    bodyBId: contact.bodyBId,
    bodyASlot: contact.bodyASlot,
    bodyBSlot: contact.bodyBSlot,
    normal: [...contact.normal],
    featureKey: contact.featureKey,
    penetration: contact.penetration,
    point: contact.point === null ? null : [...contact.point]
  };
}

/** @internal
 * manifold配列を利用者変更から分離して返します
 */
export function cloneReadbackManifold(space, manifold) {
  return {
    bodyAId: manifold.bodyAId,
    bodyBId: manifold.bodyBId,
    bodyASlot: manifold.bodyASlot,
    bodyBSlot: manifold.bodyBSlot,
    normal: [...manifold.normal],
    source: manifold.source ? { ...manifold.source } : null,
    contacts: manifold.contacts.map((contact) => ({
      featureKey: contact.featureKey,
      penetration: contact.penetration,
      point: contact.point === null ? null : [...contact.point]
    }))
  };
}

/** @internal
 * contact event配列を利用者変更から分離して返します
 */
export function cloneReadbackContactEvents(space, events) {
  return {
    begin: events.begin.map((contact) => space.cloneReadbackContact(contact)),
    stay: events.stay.map((contact) => space.cloneReadbackContact(contact)),
    end: events.end.map((contact) => space.cloneReadbackContact(contact))
  };
}

// listener登録時の型と重複を検証します
export function addContactListener(space, listeners, listener, name) {
  if (typeof listener !== "function") throw new Error(`${space.label} ${name} listener must be a function`);
  if (!listeners.includes(listener)) listeners.push(listener);
  return space;
}

// listener解除時の型を検証し、登録済みlistenerだけを配列から削除します
export function removeContactListener(space, listeners, listener, name) {
  if (typeof listener !== "function") throw new Error(`${space.label} ${name} listener must be a function`);
  const index = listeners.indexOf(listener);
  if (index >= 0) listeners.splice(index, 1);
  return space;
}

/** @internal
 * readback contact eventをphaseごとのlistenerへ順に通知します
 */
export function emitReadbackContactEvents(space, events) {
  const listenerSets = [
    [events.begin, space.beginContactListeners, "begin"],
    [events.stay, space.stayContactListeners, "stay"],
    [events.end, space.endContactListeners, "end"]
  ];
  for (const [contacts, listeners, phase] of listenerSets) {
    for (const contact of contacts) {
      const cloned = space.cloneReadbackContact(contact);
      for (const listener of [...listeners]) listener(cloned, phase, space);
    }
  }
}

// readback bodyへraycastし、最も近いhitだけを返します
// GPU stateを取得した呼出しだけを受け付け、現在のreadback状態からquery結果を作ります
export function raycastFromReadback(space, stateData, origin, direction, options = {}) {
  const hits = space.raycastAllFromReadback(stateData, origin, direction, options);
  return hits.length > 0 ? hits[0] : null;
}

// readback bodyへraycastし、distance順の全hitを返します
// filter callbackにはbody objectではなく、固定IDと属性を持つgetBodyInfo()相当値を渡します
export function raycastAllFromReadback(space, stateData, origin, direction, options = {}) {
  const rayOrigin = space.readVec3(origin, `${space.label} raycastAllFromReadback origin`);
  const rayDirectionInput = space.readVec3(direction, `${space.label} raycastAllFromReadback direction`);
  const directionLength = Math.hypot(rayDirectionInput[0], rayDirectionInput[1], rayDirectionInput[2]);
  if (directionLength <= 0) {
    throw new Error(`${space.label} raycastAllFromReadback direction must not be zero`);
  }
  const rayDirection = rayDirectionInput.map((value) => value / directionLength);
  const query = space.readComputeQueryOptions(options, "raycastAllFromReadback", true);
  // 共通のreadback entryで対象を絞ってから、形状別ray式をColliderへ委譲します
  const entries = space.collectReadbackQueryEntries(stateData, query, "raycastAllFromReadback");
  const hits = [];
  for (let index = 0; index < entries.length; index++) {
    const hit = space.intersectReadbackBodyRay(
      entries[index],
      rayOrigin,
      rayDirection,
      query.maxDistance
    );
    if (hit !== null) hits.push(hit);
  }
  // 距離とslotで順序を固定し、最も近いhitをraycastFromReadbackから返せるようにします
  hits.sort((left, right) => left.distance - right.distance || left.slot - right.slot);
  return hits;
}
// readback bodyと軸平行AABBが重なるbody一覧を返します
// Plane配列はbody IDを持たないため、Plane専用queryで別に結果を返します
export function queryAabbFromReadback(space, stateData, min, max, options = {}) {
  const queryMin = space.readVec3(min, `${space.label} queryAabbFromReadback min`);
  const queryMax = space.readVec3(max, `${space.label} queryAabbFromReadback max`);
  if (queryMin[0] > queryMax[0] || queryMin[1] > queryMax[1] || queryMin[2] > queryMax[2]) {
    throw new Error(`${space.label} queryAabbFromReadback min must be <= max on every axis`);
  }
  const query = space.readComputeQueryOptions(options, "queryAabbFromReadback");
  const entries = space.collectReadbackQueryEntries(stateData, query, "queryAabbFromReadback");
  const hits = [];
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    const overlaps = space.readbackBoxOverlapsAabb(entry.state, queryMin, queryMax);
    if (!overlaps) continue;
    const aabb = space.getReadbackBodyAabb(entry.state);
    hits.push({
      bodyId: entry.record.id,
      slot: entry.record.slot,
      min: [...aabb.min],
      max: [...aabb.max]
    });
  }
  return hits;
}

// readback bodyとquery Sphereが重なるbody一覧を返します
// 各結果はCPU版overlapSphereと同じclosestPointとdistanceを持ち、body参照の代わりにbodyIdを返します
export function overlapSphereFromReadback(space, stateData, center, radius, options = {}) {
  const sphereCenter = space.readVec3(center, `${space.label} overlapSphereFromReadback center`);
  const sphereRadius = util.readFiniteNumber(
    radius,
    `${space.label} overlapSphereFromReadback radius`,
    { min: 0 }
  );
  const query = space.readComputeQueryOptions(options, "overlapSphereFromReadback");
  const entries = space.collectReadbackQueryEntries(stateData, query, "overlapSphereFromReadback");
  const hits = [];
  for (let index = 0; index < entries.length; index++) {
    const overlap = space.overlapReadbackBodySphere(entries[index], sphereCenter, sphereRadius);
    if (overlap === null) continue;
    hits.push({
      bodyId: entries[index].record.id,
      slot: entries[index].record.slot,
      closestPoint: [...overlap.closestPoint],
      distance: overlap.distance
    });
  }
  return hits;
}
