// ---------------------------------------------
//  ComputeJointBuffer.js  2026/08/25
//   Compute Physics Joint descriptor and runtime buffer packing
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import util from "./util.js";
import { rotateVec3ByQuat } from "./JointMath.js";

// Compute版JointのGPU recordは、body A側とbody B側を別recordへ展開します
// body invocationは自分のrecordだけを書き換えるため、XPBD lambda更新を相手bodyと独立して実行します
export const COMPUTE_PHYSICS_JOINT_TYPES = Object.freeze({
  DistanceJoint: 0,
  BallSocketJoint: 1,
  HingeJoint: 2,
  FixedJoint: 3
});

// Joint bufferの固定領域を公開し、JavaScriptのpackとWGSLのoffset計算を同じ定義へ揃えます
// float欄もUint32Arrayで保持し、descriptorとruntime lambdaを同じStorage Bufferへ配置します
export const COMPUTE_PHYSICS_JOINT_LAYOUT = Object.freeze({
  rangeStrideU32: 2,
  recordStrideU32: 48,
  recordStrideBytes: 48 * Uint32Array.BYTES_PER_ELEMENT,
  jointId: 0,
  bodyA: 1,
  bodyB: 2,
  side: 3,
  type: 4,
  flags: 5,
  rowCount: 6,
  reserved0: 7,
  compliance: 8,
  positionCorrectionSlop: 9,
  distance: 10,
  reserved1: 11,
  localAnchorA: 12,
  localAnchorB: 15,
  localAxisA: 18,
  localAxisB: 21,
  targetRelativeOrientation: 24,
  lambda: 28,
  error: 34,
  relativeVelocity: 40,
  runtimeFlags: 46,
  reserved2: 47,
  enabledFlag: 1 << 0,
  collideConnectedFlag: 1 << 1
});

const JOINT_EPSILON = 1.0e-8;
const MAX_JOINT_ROWS = 6;

const ROW_COUNTS = Object.freeze({
  DistanceJoint: 1,
  BallSocketJoint: 3,
  HingeJoint: 5,
  FixedJoint: 6
});

// Compute body descriptorからJointの初期anchor位置を計算し、Distanceのゼロ距離時だけ明示axisを要求します
// 現在姿勢から求められる初期軸は、CPU DistanceJointと同じく後続のゼロ距離時の参照軸として保存します
function getInitialAnchor(bodyRecord, localAnchor) {
  const descriptor = bodyRecord.descriptor;
  const rotated = rotateVec3ByQuat(localAnchor, {
    q: descriptor.orientation
  });
  return [
    descriptor.position[0] + rotated[0],
    descriptor.position[1] + rotated[1],
    descriptor.position[2] + rotated[2]
  ];
}

// vec3を有限値として読み、要素不足やゼロ軸を後段のshaderへ渡さないようにします
function readVec3(value, name, { nonZero = false } = {}) {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new Error(`${name} must be a 3 element array`);
  }
  const result = value.map((entry, index) => util.readFiniteNumber(entry, `${name}[${index}]`));
  if (nonZero && Math.hypot(...result) <= JOINT_EPSILON) {
    throw new Error(`${name} must not be a zero vector`);
  }
  return result;
}

// quaternionを[w,x,y,z]の単位配列へ変換し、Compute BodyStateと同じ成分順でGPUへ渡します
function readQuat(value, name) {
  const source = Array.isArray(value) ? value : value?.q;
  if (!Array.isArray(source) || source.length !== 4) {
    throw new Error(`${name} must be a 4 element array or Quat-like object`);
  }
  const result = source.map((entry, index) => util.readFiniteNumber(entry, `${name}[${index}]`));
  const length = Math.hypot(...result);
  if (length <= JOINT_EPSILON) throw new Error(`${name} must not be a zero quaternion`);
  if (Math.abs(length - 1.0) > 1.0e-5) {
    throw new Error(`${name} must be a unit quaternion`);
  }
  return result;
}

// Compute body IDを明示的な整数として読み、body slotへの変換をbodyRecordsだけで解決します
// body objectの暗黙比較や配列順への推測は行わず、CPU/Computeで同じbodyを結び付ける入力契約を固定します
function readBodyId(value, name) {
  return util.readFiniteNumber(value, name, { integer: true, minExclusive: 0 });
}

// descriptorのJoint objectまたはCompute専用plain descriptorから不変設定を取り出します
// Core Jointを渡す場合もbodyAId/bodyBIdはCompute space上のIDで明示し、GPU bufferには整数IDを渡します
function readDefinition(value, name) {
  const input = util.readPlainObject(value, name);
  if (input.joint !== undefined) {
    if (!input.joint || typeof input.joint.getDefinition !== "function") {
      throw new Error(`${name}.joint must provide getDefinition()`);
    }
    return {
      input,
      definition: input.joint.getDefinition()
    };
  }
  return { input, definition: input };
}

// Joint recordを1本のUint32/Float32共有配列へ書き込み、descriptor欄とruntime欄のoffsetを分離します
function writeRecord(uintData, floatData, recordOffset, record) {
  const layout = COMPUTE_PHYSICS_JOINT_LAYOUT;
  uintData.fill(0, recordOffset, recordOffset + layout.recordStrideU32);
  uintData[recordOffset + layout.jointId] = record.id;
  uintData[recordOffset + layout.bodyA] = record.bodyASlot;
  uintData[recordOffset + layout.bodyB] = record.bodyBSlot;
  uintData[recordOffset + layout.side] = record.side;
  uintData[recordOffset + layout.type] = record.type;
  uintData[recordOffset + layout.flags] = record.flags;
  uintData[recordOffset + layout.rowCount] = record.rowCount;
  floatData[recordOffset + layout.compliance] = record.compliance;
  floatData[recordOffset + layout.positionCorrectionSlop] = record.positionCorrectionSlop;
  floatData[recordOffset + layout.distance] = record.distance;
  floatData.set(record.localAnchorA, recordOffset + layout.localAnchorA);
  floatData.set(record.localAnchorB, recordOffset + layout.localAnchorB);
  floatData.set(record.localAxisA, recordOffset + layout.localAxisA);
  floatData.set(record.localAxisB, recordOffset + layout.localAxisB);
  floatData.set(record.targetRelativeOrientation, recordOffset + layout.targetRelativeOrientation);
}

// Compute版Jointのtopology、descriptor、XPBD runtime欄をGPUへ転送する管理クラスです
// GPU solverはこのbufferだけを参照し、CPU側へのlambda readbackを明示的な診断経路として扱います
export default class ComputeJointBuffer {
  // 最大Joint数とbodyごとの参照数を検証し、固定サイズbufferを一度だけ生成します
  constructor({ device, queue, label = "compute-physics-space", maxBodies, maxJoints = 256, maxJointsPerBody = 64 }) {
    if (!device?.createBuffer || !queue?.writeBuffer) {
      throw new Error("ComputeJointBuffer requires a WebGPU device and queue");
    }
    this.device = device;
    this.queue = queue;
    this.label = label;
    this.maxBodies = util.readOptionalInteger(maxBodies, `${label} maxBodies`, maxBodies, { min: 1, max: 4096 });
    this.maxJoints = util.readOptionalInteger(maxJoints, `${label} maxJoints`, 256, { min: 1, max: 8192 });
    this.maxJointsPerBody = util.readOptionalInteger(
      maxJointsPerBody,
      `${label} maxJointsPerBody`,
      64,
      { min: 1, max: this.maxJoints }
    );
    this.maxJointLinks = this.maxJoints * 2;
    this.rangeU32 = this.maxBodies * COMPUTE_PHYSICS_JOINT_LAYOUT.rangeStrideU32;
    this.adjacencyU32 = this.maxJointLinks;
    this.recordBaseU32 = this.rangeU32 + this.adjacencyU32;
    this.totalU32 = this.recordBaseU32 + this.maxJointLinks * COMPUTE_PHYSICS_JOINT_LAYOUT.recordStrideU32;
    this.data = new ArrayBuffer(this.totalU32 * Uint32Array.BYTES_PER_ELEMENT);
    this.uintData = new Uint32Array(this.data);
    this.floatData = new Float32Array(this.data);
    this.buffer = this.device.createBuffer({
      label: `${label}:joints`,
      size: this.data.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
    });
    this.entries = new Map();
    this.slots = new Array(this.maxJoints).fill(null);
    this.nextJointId = 1;
    this.activeCount = 0;
    this.queue.writeBuffer(this.buffer, 0, this.uintData);
  }

  // body slotのJoint参照範囲とpacked adjacencyを作り直し、record本体へ触れずにGPUへ転送します
  // record内のlambdaを topology変更だけで初期化しないため、既存JointのXPBD蓄積値を保持できます
  syncTopology() {
    const byBody = new Array(this.maxBodies).fill(null).map(() => []);
    for (let slot = 0; slot < this.slots.length; slot++) {
      const entry = this.slots[slot];
      if (!entry) continue;
      byBody[entry.bodyASlot].push(entry.recordIndex);
      byBody[entry.bodyBSlot].push(entry.recordIndex + 1);
    }
    const header = new Uint32Array(this.recordBaseU32);
    let adjacencyOffset = 0;
    for (let bodySlot = 0; bodySlot < this.maxBodies; bodySlot++) {
      const list = byBody[bodySlot];
      header[bodySlot * 2] = adjacencyOffset;
      header[bodySlot * 2 + 1] = list.length;
      header.set(list, this.rangeU32 + adjacencyOffset);
      adjacencyOffset += list.length;
    }
    if (adjacencyOffset > this.maxJointLinks) {
      throw new Error(`${this.label} Joint adjacency exceeds maxJointLinks`);
    }
    this.uintData.set(header, 0);
    this.queue.writeBuffer(this.buffer, 0, header);
  }

  // record本体の指定範囲だけをGPUへ書き、他Jointのruntime lambdaを上書きしないようにします
  writeEntryRecords(entry) {
    const layout = COMPUTE_PHYSICS_JOINT_LAYOUT;
    for (const record of entry.records) {
      writeRecord(this.uintData, this.floatData, record.recordOffset, record);
      const data = new Uint32Array(this.data, record.recordOffset * 4, layout.recordStrideU32);
      this.queue.writeBuffer(this.buffer, record.recordOffset * 4, data);
    }
  }

  // Joint定義を検証してA/B各側のrecordを空slotへ追加し、GPU IDを返します
  // Distance/BallSocket/Hinge/Fixedの共通recordを作り、WGSL側のtype switchへ明示的に渡します
  add(value, bodyRecords) {
    const { input, definition } = readDefinition(value, `${this.label} addJoint`);
    const type = input.type ?? definition.type;
    if (!Object.prototype.hasOwnProperty.call(COMPUTE_PHYSICS_JOINT_TYPES, type)) {
      throw new Error(`${this.label} addJoint type is unsupported: ${type}`);
    }
    const bodyAId = readBodyId(input.bodyAId ?? definition.bodyAId, `${this.label} addJoint bodyAId`);
    const bodyBId = readBodyId(input.bodyBId ?? definition.bodyBId, `${this.label} addJoint bodyBId`);
    if (bodyAId === bodyBId) throw new Error(`${this.label} addJoint bodyAId and bodyBId must differ`);
    const bodyA = bodyRecords.get(bodyAId);
    const bodyB = bodyRecords.get(bodyBId);
    if (!bodyA || !bodyB) {
      throw new Error(`${this.label} addJoint requires both body IDs to be registered first`);
    }
    const bodyASlot = bodyA.slot;
    const bodyBSlot = bodyB.slot;
    const bodyCounts = new Uint32Array(this.maxBodies);
    for (const entry of this.slots) {
      if (!entry) continue;
      bodyCounts[entry.bodyASlot] += 1;
      bodyCounts[entry.bodyBSlot] += 1;
    }
    if (bodyCounts[bodyASlot] >= this.maxJointsPerBody || bodyCounts[bodyBSlot] >= this.maxJointsPerBody) {
      throw new Error(`${this.label} addJoint exceeds maxJointsPerBody`);
    }
    const slot = this.slots.findIndex((entry) => entry === null);
    if (slot < 0) throw new Error(`${this.label} has no free Joint slot`);
    const id = input.id === undefined
      ? this.nextJointId
      : util.readFiniteNumber(input.id, `${this.label} addJoint id`, { integer: true, minExclusive: 0 });
    if (this.entries.has(id)) throw new Error(`${this.label} duplicate Joint id: ${id}`);
    const compliance = util.readOptionalFiniteNumber(
      input.compliance ?? definition.compliance,
      `${this.label} addJoint compliance`,
      0,
      { min: 0 }
    );
    const positionCorrectionSlop = util.readOptionalFiniteNumber(
      input.positionCorrectionSlop,
      `${this.label} addJoint positionCorrectionSlop`,
      0.0001,
      { min: 0 }
    );
    const enabled = util.readOptionalBoolean(
      input.enabled,
      `${this.label} addJoint enabled`,
      true
    );
    const collideConnected = util.readOptionalBoolean(
      input.collideConnected,
      `${this.label} addJoint collideConnected`,
      false
    );
    const localAnchorA = readVec3(
      input.localAnchorA ?? definition.localAnchorA ?? [0, 0, 0],
      `${this.label} addJoint localAnchorA`
    );
    const localAnchorB = readVec3(
      input.localAnchorB ?? definition.localAnchorB ?? [0, 0, 0],
      `${this.label} addJoint localAnchorB`
    );
    const localAxisA = readVec3(
      input.localAxisA ?? definition.localAxisA ?? definition.axis ?? [0, 1, 0],
      `${this.label} addJoint localAxisA`,
      { nonZero: type !== "BallSocketJoint" && type !== "FixedJoint" }
    );
    const localAxisB = readVec3(
      input.localAxisB ?? definition.localAxisB ?? [0, 1, 0],
      `${this.label} addJoint localAxisB`,
      { nonZero: type === "HingeJoint" }
    );
    const normalizedAxisA = type === "DistanceJoint" || type === "HingeJoint"
      ? localAxisA.map((entry) => entry / Math.hypot(...localAxisA))
      : localAxisA;
    const normalizedAxisB = type === "HingeJoint"
      ? localAxisB.map((entry) => entry / Math.hypot(...localAxisB))
      : localAxisB;
    const targetRelativeOrientation = type === "FixedJoint"
      ? readQuat(
        input.targetRelativeOrientation ?? definition.targetRelativeOrientation,
        `${this.label} addJoint targetRelativeOrientation`
      )
      : [1, 0, 0, 0];
    const initialAnchorA = getInitialAnchor(bodyA, localAnchorA);
    const initialAnchorB = getInitialAnchor(bodyB, localAnchorB);
    const initialDelta = initialAnchorB.map((entry, index) => entry - initialAnchorA[index]);
    const initialDistance = Math.hypot(...initialDelta);
    let distance = 0;
    if (type === "DistanceJoint") {
      distance = util.readOptionalFiniteNumber(
        input.distance ?? definition.distance,
        `${this.label} addJoint distance`,
        initialDistance,
        { min: 0 }
      );
      if (initialDistance <= JOINT_EPSILON && definition.axis === null && input.axis === undefined && input.localAxisA === undefined) {
        throw new Error(`${this.label} addJoint DistanceJoint axis is required for zero initial anchor distance`);
      }
      if (initialDistance > JOINT_EPSILON && input.axis === undefined && definition.axis === undefined) {
        normalizedAxisA.splice(0, normalizedAxisA.length, ...initialDelta.map((entry) => entry / initialDistance));
      }
    }
    const typeValue = COMPUTE_PHYSICS_JOINT_TYPES[type];
    const flags = (enabled ? COMPUTE_PHYSICS_JOINT_LAYOUT.enabledFlag : 0)
      | (collideConnected ? COMPUTE_PHYSICS_JOINT_LAYOUT.collideConnectedFlag : 0);
    const recordIndex = slot * 2;
    const makeRecord = (side) => ({
      id,
      bodyASlot,
      bodyBSlot,
      side,
      type: typeValue,
      flags,
      rowCount: ROW_COUNTS[type],
      compliance,
      positionCorrectionSlop,
      distance,
      localAnchorA: [...localAnchorA],
      localAnchorB: [...localAnchorB],
      localAxisA: [...normalizedAxisA],
      localAxisB: [...normalizedAxisB],
      targetRelativeOrientation: [...targetRelativeOrientation],
      recordOffset: this.recordBaseU32 + (recordIndex + side) * COMPUTE_PHYSICS_JOINT_LAYOUT.recordStrideU32
    });
    const entry = {
      id,
      slot,
      recordIndex,
      bodyAId,
      bodyBId,
      bodyASlot,
      bodyBSlot,
      type,
      enabled,
      collideConnected,
      records: [makeRecord(0), makeRecord(1)]
    };
    this.slots[slot] = entry;
    this.entries.set(id, entry);
    this.activeCount += 1;
    this.nextJointId = Math.max(this.nextJointId, id + 1);
    try {
      this.syncTopology();
      this.writeEntryRecords(entry);
    } catch (error) {
      this.slots[slot] = null;
      this.entries.delete(id);
      this.activeCount -= 1;
      throw error;
    }
    return id;
  }

  // Jointを削除し、参照範囲だけを再構築してslotを再利用可能にします
  // 削除済みrecordのlambdaを後続bodyへ見せず、GPUのadjacencyから明示的に外します
  remove(id) {
    const checkedId = util.readFiniteNumber(id, `${this.label} removeJoint id`, { integer: true, minExclusive: 0 });
    const entry = this.entries.get(checkedId);
    if (!entry) throw new Error(`${this.label} unknown Joint id: ${checkedId}`);
    this.entries.delete(checkedId);
    this.slots[entry.slot] = null;
    this.activeCount -= 1;
    this.syncTopology();
    for (const record of entry.records) {
      this.uintData.fill(0, record.recordOffset, record.recordOffset + COMPUTE_PHYSICS_JOINT_LAYOUT.recordStrideU32);
      this.queue.writeBuffer(
        this.buffer,
        record.recordOffset * 4,
        new Uint32Array(this.data, record.recordOffset * 4, COMPUTE_PHYSICS_JOINT_LAYOUT.recordStrideU32)
      );
    }
    return checkedId;
  }

  // enabledだけを変更し、lambda欄を保持したまま次fixed stepのsolverへ状態を渡します
  setEnabled(id, enabled) {
    const checkedId = util.readFiniteNumber(id, `${this.label} setJointEnabled id`, { integer: true, minExclusive: 0 });
    const entry = this.entries.get(checkedId);
    if (!entry) throw new Error(`${this.label} unknown Joint id: ${checkedId}`);
    entry.enabled = util.readOptionalBoolean(enabled, `${this.label} setJointEnabled enabled`, entry.enabled);
    for (const record of entry.records) {
      record.flags = entry.collideConnected
        ? COMPUTE_PHYSICS_JOINT_LAYOUT.collideConnectedFlag
        : 0;
      if (entry.enabled) record.flags |= COMPUTE_PHYSICS_JOINT_LAYOUT.enabledFlag;
      this.uintData[record.recordOffset + COMPUTE_PHYSICS_JOINT_LAYOUT.flags] = record.flags;
      this.queue.writeBuffer(
        this.buffer,
        (record.recordOffset + COMPUTE_PHYSICS_JOINT_LAYOUT.flags) * 4,
        new Uint32Array(this.data, (record.recordOffset + COMPUTE_PHYSICS_JOINT_LAYOUT.flags) * 4, 1)
      );
    }
    return this.getInfo(checkedId);
  }

  // body参照を含まないCompute Jointの公開情報を返し、GPU recordを保護します
  getInfo(id) {
    const checkedId = util.readFiniteNumber(id, `${this.label} getJointInfo id`, { integer: true, minExclusive: 0 });
    const entry = this.entries.get(checkedId);
    if (!entry) throw new Error(`${this.label} unknown Joint id: ${checkedId}`);
    return Object.freeze({
      id: entry.id,
      bodyAId: entry.bodyAId,
      bodyBId: entry.bodyBId,
      bodyASlot: entry.bodyASlot,
      bodyBSlot: entry.bodyBSlot,
      type: entry.type,
      enabled: entry.enabled,
      collideConnected: entry.collideConnected
    });
  }

  // 登録JointのIDを追加順ではなくrecord slot順で返し、GPU adjacencyの確認に使える一覧を作ります
  getIds() {
    return this.slots.filter(Boolean).map((entry) => entry.id);
  }

  // bodyがJointの端点として残っているかを返し、Compute body削除でGPU参照を孤立させないようにします
  hasBody(bodyId) {
    const checkedId = util.readFiniteNumber(bodyId, `${this.label} hasJointBody bodyId`, {
      integer: true,
      minExclusive: 0
    });
    return this.slots.some((entry) => entry && (entry.bodyAId === checkedId || entry.bodyBId === checkedId));
  }

  // 現在のJoint数を返し、不要なJoint passをencodeしない判定へ使います
  getCount() {
    return this.activeCount;
  }

  // 全Jointを削除し、headerとrecordをゼロ化して新しいbody配列とJointの対応を混同しないようにします
  clear() {
    this.entries.clear();
    this.slots.fill(null);
    this.activeCount = 0;
    this.uintData.fill(0);
    this.queue.writeBuffer(this.buffer, 0, this.uintData);
  }

  // Joint bufferをGPU側へ渡すための固定metadataを返します
  getLayoutInfo() {
    return Object.freeze({
      maxBodies: this.maxBodies,
      maxJoints: this.maxJoints,
      maxJointLinks: this.maxJointLinks,
      rangeU32: this.rangeU32,
      adjacencyU32: this.adjacencyU32,
      recordBaseU32: this.recordBaseU32,
      recordStrideU32: COMPUTE_PHYSICS_JOINT_LAYOUT.recordStrideU32,
      totalU32: this.totalU32
    });
  }

  // GPU bufferを返し、Compute描画や明示readbackのbind group生成へ利用できるようにします
  getBuffer() {
    return this.buffer;
  }

  // topologyを含むCompute Joint bufferを破棄します
  destroy() {
    this.buffer?.destroy();
    this.buffer = null;
  }
}
