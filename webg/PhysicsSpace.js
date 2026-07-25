// ---------------------------------------------
//  PhysicsSpace.js  2026/07/25
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import util from "./util.js";
import Quat from "./Quat.js";

export default class PhysicsSpace {

  static DEG_TO_RAD = Math.PI / 180.0;
  static RAD_TO_DEG = 180.0 / Math.PI;

  // 固定 timestep と body 一覧を持つ物理空間を生成する
  constructor(options = {}) {
    // PhysicsSpace は複数の PhysicsNode をまとめて進める
    // ここでは最初の版として、重力、固定 timestep、box collider の衝突解決、sleep 判定を扱う
    const opts = util.readPlainObject(options, "PhysicsSpace options", {});
    this.gravity = this._readOptionalVec3(
      opts.gravity,
      "PhysicsSpace gravity",
      [0.0, -9.8, 0.0]
    );
    this.fixedTimeStepMs = util.readOptionalFiniteNumber(
      opts.fixedTimeStepMs,
      "PhysicsSpace fixedTimeStepMs",
      1000.0 / 120.0,
      { minExclusive: 0.0 }
    );
    this.maxSubSteps = util.readOptionalInteger(
      opts.maxSubSteps,
      "PhysicsSpace maxSubSteps",
      6,
      { min: 1 }
    );
    this.solverIterations = util.readOptionalInteger(
      opts.solverIterations,
      "PhysicsSpace solverIterations",
      4,
      { min: 1 }
    );
    this.broadphaseMode = util.readOptionalEnum(
      opts.broadphaseMode,
      "PhysicsSpace broadphaseMode",
      "sweepAabb",
      ["bruteForce", "sweepAabb"]
    );
    this.defaultRestitution = util.readOptionalFiniteNumber(
      opts.defaultRestitution,
      "PhysicsSpace defaultRestitution",
      0.0,
      { min: 0.0, max: 1.0 }
    );
    this.defaultFriction = util.readOptionalFiniteNumber(
      opts.defaultFriction,
      "PhysicsSpace defaultFriction",
      0.4,
      { min: 0.0 }
    );
    this.sleepLinearThreshold = util.readOptionalFiniteNumber(
      opts.sleepLinearThreshold,
      "PhysicsSpace sleepLinearThreshold",
      0.12,
      { min: 0.0 }
    );
    this.sleepAngularThreshold = util.readOptionalFiniteNumber(
      opts.sleepAngularThreshold,
      "PhysicsSpace sleepAngularThreshold",
      0.12,
      { min: 0.0 }
    );
    this.sleepStepsThreshold = util.readOptionalInteger(
      opts.sleepStepsThreshold,
      "PhysicsSpace sleepStepsThreshold",
      3,
      { min: 1 }
    );
    this.positionCorrectionBeta = util.readOptionalFiniteNumber(
      opts.positionCorrectionBeta,
      "PhysicsSpace positionCorrectionBeta",
      0.35,
      { min: 0.0, max: 1.0 }
    );
    this.positionCorrectionSlop = util.readOptionalFiniteNumber(
      opts.positionCorrectionSlop,
      "PhysicsSpace positionCorrectionSlop",
      0.0015,
      { min: 0.0 }
    );
    this.accumulatorMs = 0.0;
    this.bodies = [];
    this.lastContacts = [];
    this.lastManifolds = [];
    this.lastSleepIslands = [];
    this.lastContactEvents = {
      begin: [],
      stay: [],
      end: []
    };
    this.beginContactListeners = [];
    this.stayContactListeners = [];
    this.endContactListeners = [];
    this.previousContactMap = new Map();
    this.previousManifoldMap = new Map();
    this.bodyIdMap = new WeakMap();
    this.sleepStepMap = new WeakMap();
    this.sleepIslandStepMap = new Map();
    this.nextBodyId = 1;
  }

  // vec3 option を読み、未指定なら fallback を返す
  _readOptionalVec3(value, name, fallback) {
    if (value === undefined) {
      return [...fallback];
    }
    if (!Array.isArray(value) || value.length < 3) {
      throw new Error(`${name} must be a vec3 array`);
    }
    return [
      util.readFiniteNumber(value[0], `${name}[0]`),
      util.readFiniteNumber(value[1], `${name}[1]`),
      util.readFiniteNumber(value[2], `${name}[2]`)
    ];
  }

  // 必須の vec3 値を読む
  _readVec3(value, name) {
    if (!Array.isArray(value) || value.length < 3) {
      throw new Error(`${name} must be a vec3 array`);
    }
    return [
      util.readFiniteNumber(value[0], `${name}[0]`),
      util.readFiniteNumber(value[1], `${name}[1]`),
      util.readFiniteNumber(value[2], `${name}[2]`)
    ];
  }

  // vec3 を複製する
  _cloneVec3(vec) {
    return [vec[0], vec[1], vec[2]];
  }

  // 角速度 [yaw, pitch, roll] を微小 quaternion へ変換する
  // webg の Euler 順序は Y/X/Z なので、微小回転も同じ順序で組み立てる
  // これにより pitch 90 度近傍でも、step ごとの姿勢保持自体は quaternion で安定させる
  _buildAngularStepQuat(angularVelocity, dtSec) {
    const deltaQuat = new Quat();
    deltaQuat.eulerToQuat(
      angularVelocity[0] * dtSec,
      angularVelocity[1] * dtSec,
      angularVelocity[2] * dtSec
    );
    deltaQuat.normalize();
    return deltaQuat;
  }

  // contact 情報を public getter 用に複製する
  _cloneContact(contact) {
    return {
      bodyA: contact.bodyA,
      bodyB: contact.bodyB,
      normal: [...contact.normal],
      penetration: contact.penetration,
      point: Array.isArray(contact.point) ? [...contact.point] : null
    };
  }

  // manifold をキャッシュ用に複製する
  _cloneManifold(manifold) {
    const bodyAPosition = manifold.bodyA?.getPosition?.() ?? [0.0, 0.0, 0.0];
    const bodyBPosition = manifold.bodyB?.getPosition?.() ?? [0.0, 0.0, 0.0];
    const bodyAQuat = manifold.bodyA?.getQuat?.() ?? null;
    const bodyBQuat = manifold.bodyB?.getQuat?.() ?? null;
    return {
      bodyA: manifold.bodyA,
      bodyB: manifold.bodyB,
      normal: [...manifold.normal],
      source: manifold.source ? { ...manifold.source } : null,
      sharedTangentImpulse: Array.isArray(manifold.sharedTangentImpulse)
        ? [...manifold.sharedTangentImpulse]
        : (Array.isArray(manifold.supportTangentImpulse)
          ? [...manifold.supportTangentImpulse]
          : [0.0, 0.0, 0.0]),
      supportTangentImpulse: Array.isArray(manifold.sharedTangentImpulse)
        ? [...manifold.sharedTangentImpulse]
        : (Array.isArray(manifold.supportTangentImpulse)
          ? [...manifold.supportTangentImpulse]
          : [0.0, 0.0, 0.0]),
      contacts: manifold.contacts.map((contact) => ({
        featureKey: typeof contact.featureKey === "string" ? contact.featureKey : null,
        penetration: contact.penetration,
        point: Array.isArray(contact.point) ? [...contact.point] : null,
        localPointA: Array.isArray(contact.point)
          ? this._inverseRotateVec3ByQuat(this._subVec3(contact.point, bodyAPosition), bodyAQuat)
          : null,
        localPointB: Array.isArray(contact.point)
          ? this._inverseRotateVec3ByQuat(this._subVec3(contact.point, bodyBPosition), bodyBQuat)
          : null,
        normalImpulse: contact.normalImpulse ?? 0.0,
        tangentImpulse: Array.isArray(contact.tangentImpulse)
          ? [...contact.tangentImpulse]
          : [0.0, 0.0, 0.0]
      }))
    };
  }

  // manifold contacts の centroid を返す
  _getManifoldContactCentroid(manifold) {
    if (!manifold || !Array.isArray(manifold.contacts) || manifold.contacts.length <= 0) {
      return null;
    }
    const center = [0.0, 0.0, 0.0];
    let count = 0;
    for (let i = 0; i < manifold.contacts.length; i++) {
      if (!Array.isArray(manifold.contacts[i].point)) {
        continue;
      }
      center[0] += manifold.contacts[i].point[0];
      center[1] += manifold.contacts[i].point[1];
      center[2] += manifold.contacts[i].point[2];
      count += 1;
    }
    if (count <= 0) {
      return null;
    }
    center[0] /= count;
    center[1] /= count;
    center[2] /= count;
    return center;
  }

  // vec3 の長さを返す
  _lengthVec3(vec) {
    return Math.hypot(vec[0], vec[1], vec[2]);
  }

  // vec3 の内積を返す
  _dotVec3(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  }

  // vec3 を指定倍率で掛ける
  _scaleVec3(vec, scale) {
    return [vec[0] * scale, vec[1] * scale, vec[2] * scale];
  }

  // sleep 判定や支持判定では、world Y 固定ではなく重力の逆向きを基準にする
  // 積み上がった box 同士は接触面が斜めになりやすく、
  // normal.y >= 0.5 だけだと「実際には支えられている contact」を support と見なせない
  _getUpAxisFromGravity() {
    const gravityLength = this._lengthVec3(this.gravity);
    if (gravityLength <= 1.0e-8) {
      return [0.0, 1.0, 0.0];
    }
    return [
      -this.gravity[0] / gravityLength,
      -this.gravity[1] / gravityLength,
      -this.gravity[2] / gravityLength
    ];
  }

  // `_isSupportNormal`は入力条件や交差状態を比較し、判定結果を返す
  _isSupportNormal(normal, threshold = 0.25) {
    if (!Array.isArray(normal)) {
      return false;
    }
    const upAxis = this._getUpAxisFromGravity();
    return this._dotVec3(normal, upAxis) >= threshold;
  }

  // degree/sec ベースの角速度を rad/sec へ変換する
  _degVec3ToRad(vec) {
    return [
      vec[0] * PhysicsSpace.DEG_TO_RAD,
      vec[1] * PhysicsSpace.DEG_TO_RAD,
      vec[2] * PhysicsSpace.DEG_TO_RAD
    ];
  }

  // rad/sec 系の量を degree/sec へ戻す
  _radVec3ToDeg(vec) {
    return [
      vec[0] * PhysicsSpace.RAD_TO_DEG,
      vec[1] * PhysicsSpace.RAD_TO_DEG,
      vec[2] * PhysicsSpace.RAD_TO_DEG
    ];
  }

  // vec3 の差を返す
  _subVec3(a, b) {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  }

  // vec3 の和を返す
  _addVec3(a, b) {
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  }

  // vec3 の外積を返す
  _crossVec3(a, b) {
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0]
    ];
  }

  // quaternion を [w,x,y,z] 配列として読む
  _getQuatArray(quat) {
    if (Array.isArray(quat) && quat.length >= 4) {
      return [quat[0], quat[1], quat[2], quat[3]];
    }
    if (!quat || !Array.isArray(quat.q) || quat.q.length < 4) {
      return [1.0, 0.0, 0.0, 0.0];
    }
    return [quat.q[0], quat.q[1], quat.q[2], quat.q[3]];
  }

  // quat で vec3 を回転する
  _rotateVec3ByQuat(vec, quat) {
    const q = this._getQuatArray(quat);
    const w = q[0];
    const x = q[1];
    const y = q[2];
    const z = q[3];
    const vx = vec[0];
    const vy = vec[1];
    const vz = vec[2];
    const tx = 2.0 * (y * vz - z * vy);
    const ty = 2.0 * (z * vx - x * vz);
    const tz = 2.0 * (x * vy - y * vx);
    return [
      vx + w * tx + (y * tz - z * ty),
      vy + w * ty + (z * tx - x * tz),
      vz + w * tz + (x * ty - y * tx)
    ];
  }

  // quat の逆回転で vec3 を回転する
  _inverseRotateVec3ByQuat(vec, quat) {
    const q = this._getQuatArray(quat);
    return this._rotateVec3ByQuat(vec, {
      q: [q[0], -q[1], -q[2], -q[3]]
    });
  }

  // 単位軸と回転角から quaternion を組み立てる
  _buildAxisAngleQuat(axis, degree) {
    const unitAxis = this._normalizeVec3(axis, "PhysicsSpace axis");
    const halfRad = degree * Math.PI / 360.0;
    const s = Math.sin(halfRad);
    const quat = new Quat();
    quat.q[0] = Math.cos(halfRad);
    quat.q[1] = unitAxis[0] * s;
    quat.q[2] = unitAxis[1] * s;
    quat.q[3] = unitAxis[2] * s;
    quat.normalize();
    return quat;
  }

  // from を to へ向ける最小回転 quaternion を返す
  _buildQuatFromUnitVectors(fromVec, toVec) {
    const from = this._normalizeVec3(fromVec, "PhysicsSpace fromVec");
    const to = this._normalizeVec3(toVec, "PhysicsSpace toVec");
    const dot = Math.max(-1.0, Math.min(1.0, this._dotVec3(from, to)));
    if (dot >= 1.0 - 1.0e-8) {
      return new Quat();
    }
    if (dot <= -1.0 + 1.0e-8) {
      const fallbackAxis = Math.abs(from[1]) < 0.9
        ? this._crossVec3(from, [0.0, 1.0, 0.0])
        : this._crossVec3(from, [1.0, 0.0, 0.0]);
      return this._buildAxisAngleQuat(fallbackAxis, 180.0);
    }
    const cross = this._crossVec3(from, to);
    const quat = new Quat();
    quat.q[0] = 1.0 + dot;
    quat.q[1] = cross[0];
    quat.q[2] = cross[1];
    quat.q[3] = cross[2];
    quat.normalize();
    return quat;
  }

  // world-space vector へ local inverse inertia を適用する
  _applyWorldInverseInertia(body, quat, vec) {
    if (body?.isDynamic?.() !== true || body?.getFixedRotation?.() === true) {
      return [0.0, 0.0, 0.0];
    }
    const inv = body.getInverseInertia?.() ?? [0.0, 0.0, 0.0];
    const axes = [
      this._rotateVec3ByQuat([1.0, 0.0, 0.0], quat),
      this._rotateVec3ByQuat([0.0, 1.0, 0.0], quat),
      this._rotateVec3ByQuat([0.0, 0.0, 1.0], quat)
    ];
    const result = [0.0, 0.0, 0.0];
    for (let i = 0; i < 3; i++) {
      const amount = this._dotVec3(vec, axes[i]) * inv[i];
      result[0] += axes[i][0] * amount;
      result[1] += axes[i][1] * amount;
      result[2] += axes[i][2] * amount;
    }
    return result;
  }

  // vec3 を正規化して返す
  _normalizeVec3(vec, name) {
    const length = this._lengthVec3(vec);
    if (length <= 1.0e-8) {
      throw new Error(`${name} must not be a zero vector`);
    }
    return [vec[0] / length, vec[1] / length, vec[2] / length];
  }

  // body ごとの安定した内部 ID を返す
  _getBodyId(body) {
    let bodyId = this.bodyIdMap.get(body);
    if (bodyId === undefined) {
      bodyId = this.nextBodyId;
      this.nextBodyId += 1;
      this.bodyIdMap.set(body, bodyId);
    }
    return bodyId;
  }

  // contact pair の順序に依存しない key を返す
  _getContactPairKey(bodyA, bodyB) {
    const idA = this._getBodyId(bodyA);
    const idB = this._getBodyId(bodyB);
    return idA < idB ? `${idA}:${idB}` : `${idB}:${idA}`;
  }

  // manifold pair の key を返す
  _getManifoldPairKey(bodyA, bodyB) {
    return this._getContactPairKey(bodyA, bodyB);
  }

  // 2 点間距離の二乗を返す
  _distanceSqVec3(a, b) {
    const dx = a[0] - b[0];
    const dy = a[1] - b[1];
    const dz = a[2] - b[2];
    return dx * dx + dy * dy + dz * dz;
  }

  // 現在 manifold 群から pair key -> manifold の cache を作る
  _buildManifoldCache(manifolds) {
    const cache = new Map();
    for (let i = 0; i < manifolds.length; i++) {
      const manifold = manifolds[i];
      cache.set(
        this._getManifoldPairKey(manifold.bodyA, manifold.bodyB),
        this._cloneManifold(manifold)
      );
    }
    return cache;
  }

  // 前フレームの manifold cache から、現在接触点へ impulse を引き継ぐ
  _hydrateManifoldsFromCache(manifolds) {
    for (let i = 0; i < manifolds.length; i++) {
      const manifold = manifolds[i];
      const cached = this.previousManifoldMap.get(this._getManifoldPairKey(manifold.bodyA, manifold.bodyB));
      if (!cached || !Array.isArray(cached.contacts) || cached.contacts.length <= 0) {
        continue;
      }
      if (this._dotVec3(manifold.normal, cached.normal) < 0.75) {
        continue;
      }
      manifold.sharedTangentImpulse = Array.isArray(cached.sharedTangentImpulse)
        ? [...cached.sharedTangentImpulse]
        : (Array.isArray(cached.supportTangentImpulse)
          ? [...cached.supportTangentImpulse]
          : [0.0, 0.0, 0.0]);
      manifold.supportTangentImpulse = Array.isArray(manifold.sharedTangentImpulse)
        ? [...manifold.sharedTangentImpulse]
        : [0.0, 0.0, 0.0];
      if (manifold.contacts.length === 1
          && cached.contacts.length >= 3
          && manifold.source?.kind === "edge"
          && (cached.source?.kind === "faceA" || cached.source?.kind === "faceB")) {
        const bodyAPosition = manifold.bodyA?.getPosition?.() ?? [0.0, 0.0, 0.0];
        const bodyBPosition = manifold.bodyB?.getPosition?.() ?? [0.0, 0.0, 0.0];
        const bodyAQuat = manifold.bodyA?.getQuat?.() ?? null;
        const bodyBQuat = manifold.bodyB?.getQuat?.() ?? null;
        if (bodyAPosition && bodyBPosition) {
          manifold.contacts = cached.contacts.map((contact, index) => ({
            featureKey: typeof contact.featureKey === "string" ? contact.featureKey : `cached-face:${index}`,
            penetration: manifold.contacts[0]?.penetration ?? contact.penetration,
            point: (Array.isArray(contact.localPointA) || Array.isArray(contact.localPointB))
              ? (() => {
                const worldA = Array.isArray(contact.localPointA)
                  ? this._addVec3(bodyAPosition, this._rotateVec3ByQuat(contact.localPointA, bodyAQuat))
                  : null;
                const worldB = Array.isArray(contact.localPointB)
                  ? this._addVec3(bodyBPosition, this._rotateVec3ByQuat(contact.localPointB, bodyBQuat))
                  : null;
                if (worldA && worldB) {
                  return [
                    (worldA[0] + worldB[0]) * 0.5,
                    (worldA[1] + worldB[1]) * 0.5,
                    (worldA[2] + worldB[2]) * 0.5
                  ];
                }
                return worldA ?? worldB ?? null;
              })()
              : (Array.isArray(contact.point) ? [...contact.point] : null),
            normalImpulse: contact.normalImpulse ?? 0.0,
            tangentImpulse: Array.isArray(contact.tangentImpulse)
              ? [...contact.tangentImpulse]
              : [0.0, 0.0, 0.0]
          }));
        }
      }
      const usedCached = new Set();
      const cachedFeatureMap = new Map();
      for (let k = 0; k < cached.contacts.length; k++) {
        const featureKey = cached.contacts[k].featureKey;
        if (typeof featureKey === "string" && !cachedFeatureMap.has(featureKey)) {
          cachedFeatureMap.set(featureKey, k);
        }
      }
      for (let j = 0; j < manifold.contacts.length; j++) {
        const currentFeatureKey = manifold.contacts[j].featureKey;
        if (typeof currentFeatureKey === "string" && cachedFeatureMap.has(currentFeatureKey)) {
          const cachedIndex = cachedFeatureMap.get(currentFeatureKey);
          if (!usedCached.has(cachedIndex)) {
            usedCached.add(cachedIndex);
            manifold.contacts[j].normalImpulse = cached.contacts[cachedIndex].normalImpulse ?? 0.0;
            manifold.contacts[j].tangentImpulse = Array.isArray(cached.contacts[cachedIndex].tangentImpulse)
              ? [...cached.contacts[cachedIndex].tangentImpulse]
              : [0.0, 0.0, 0.0];
            continue;
          }
        }
        let bestIndex = -1;
        let bestDistanceSq = Infinity;
        for (let k = 0; k < cached.contacts.length; k++) {
          if (usedCached.has(k) || !Array.isArray(cached.contacts[k].point) || !Array.isArray(manifold.contacts[j].point)) {
            continue;
          }
          const distanceSq = this._distanceSqVec3(manifold.contacts[j].point, cached.contacts[k].point);
          if (distanceSq < bestDistanceSq) {
            bestDistanceSq = distanceSq;
            bestIndex = k;
          }
        }
        if (bestIndex >= 0 && bestDistanceSq <= 4.0) {
          usedCached.add(bestIndex);
          manifold.contacts[j].normalImpulse = cached.contacts[bestIndex].normalImpulse ?? 0.0;
          manifold.contacts[j].tangentImpulse = Array.isArray(cached.contacts[bestIndex].tangentImpulse)
            ? [...cached.contacts[bestIndex].tangentImpulse]
            : [0.0, 0.0, 0.0];
        } else {
          manifold.contacts[j].normalImpulse = 0.0;
          manifold.contacts[j].tangentImpulse = [0.0, 0.0, 0.0];
        }
      }
    }
  }

  // solver 反復ぶん並ぶ contact から、pair ごとの代表 contact を 1 件に畳む
  _buildContactMap(contacts) {
    const contactMap = new Map();
    for (let i = 0; i < contacts.length; i++) {
      const contact = contacts[i];
      const key = this._getContactPairKey(contact.bodyA, contact.bodyB);
      const previous = contactMap.get(key);
      if (!previous || contact.penetration > previous.penetration) {
        contactMap.set(key, this._cloneContact(contact));
      }
    }
    return contactMap;
  }

  // 直前 step と今回 step の contact pair 差分から begin / stay / end を作る
  _buildContactEvents(currentContactMap) {
    const events = {
      begin: [],
      stay: [],
      end: []
    };

    for (const [key, contact] of currentContactMap.entries()) {
      if (this.previousContactMap.has(key)) {
        events.stay.push(this._cloneContact(contact));
      } else {
        events.begin.push(this._cloneContact(contact));
      }
    }
    for (const [key, contact] of this.previousContactMap.entries()) {
      if (!currentContactMap.has(key)) {
        events.end.push(this._cloneContact(contact));
      }
    }
    return events;
  }

  // trigger を含む contact かどうかを返す
  _isTriggerContact(contact) {
    return contact.bodyA?.getTrigger?.() === true || contact.bodyB?.getTrigger?.() === true;
  }

  // listener 引数を検証して返す
  _readContactListener(listener, name) {
    if (typeof listener !== "function") {
      throw new Error(`${name} must be a function`);
    }
    return listener;
  }

  // listener 配列へ重複なく登録する
  _addContactListener(listeners, listener, name) {
    const validatedListener = this._readContactListener(listener, name);
    if (!listeners.includes(validatedListener)) {
      listeners.push(validatedListener);
    }
    return this;
  }

  // listener 配列から削除する
  _removeContactListener(listeners, listener, name) {
    const validatedListener = this._readContactListener(listener, name);
    const index = listeners.indexOf(validatedListener);
    if (index >= 0) {
      listeners.splice(index, 1);
    }
    return this;
  }

  // 直近 step の contact event を listener へ通知する
  _emitContactEvents(events) {
    this._emitContactList(events.begin, this.beginContactListeners, "begin");
    this._emitContactList(events.stay, this.stayContactListeners, "stay");
    this._emitContactList(events.end, this.endContactListeners, "end");
  }

  // event 種別ごとの listener を順に呼ぶ
  _emitContactList(contacts, listeners, phase) {
    for (let i = 0; i < contacts.length; i++) {
      const clonedContact = this._cloneContact(contacts[i]);
      for (let j = 0; j < listeners.length; j++) {
        listeners[j](clonedContact, phase, this);
      }
    }
  }

  // body の衝突解決に使う質量寄与を返す
  // sleeping 中、static、kinematic は押し戻しで動かさないため 0 とする
  _getSolverInverseMass(body) {
    if (!body?.isDynamic?.()) {
      return 0.0;
    }
    if (body.getSleeping?.() === true) {
      return 0.0;
    }
    return body.getInverseMass();
  }

  // body の衝突解決に使う逆慣性を返す
  // sleeping 中、static、kinematic、fixedRotation は角速度を変えないため 0 とする
  _getSolverInverseInertia(body) {
    if (!body?.isDynamic?.() || body.getSleeping?.() === true || body.getFixedRotation?.() === true) {
      return [0.0, 0.0, 0.0];
    }
    return body.getInverseInertia?.() ?? [0.0, 0.0, 0.0];
  }

  // 接触点での速度 v + omega x r を返す
  _getContactPointVelocity(state, r) {
    return this._addVec3(
      state.velocity,
      this._crossVec3(this._degVec3ToRad(state.angularVelocity), r)
    );
  }

  // impulse が接触点へ働くときの有効質量分母を返す
  _getImpulseDenominator(bodyA, stateA, rA, bodyB, stateB, rB, direction, invMassA, invMassB) {
    const angularA = this._crossVec3(
      this._applyWorldInverseInertia(bodyA, stateA.quat, this._crossVec3(rA, direction)),
      rA
    );
    const angularB = this._crossVec3(
      this._applyWorldInverseInertia(bodyB, stateB.quat, this._crossVec3(rB, direction)),
      rB
    );
    return invMassA + invMassB
      + this._dotVec3(direction, angularA)
      + this._dotVec3(direction, angularB);
  }

  // impulse を線形速度と角速度へ反映する
  _applyContactImpulse(body, state, r, impulse, sign, invMass) {
    if (invMass <= 0.0) {
      return;
    }
    state.velocity[0] += impulse[0] * sign * invMass;
    state.velocity[1] += impulse[1] * sign * invMass;
    state.velocity[2] += impulse[2] * sign * invMass;
    if (body?.getFixedRotation?.() === true) {
      return;
    }
    const angularImpulse = this._crossVec3(r, impulse);
    const angularDeltaRad = this._applyWorldInverseInertia(body, state.quat, angularImpulse);
    const angularDeltaDeg = this._radVec3ToDeg(angularDeltaRad);
    state.angularVelocity[0] += angularDeltaDeg[0] * sign;
    state.angularVelocity[1] += angularDeltaDeg[1] * sign;
    state.angularVelocity[2] += angularDeltaDeg[2] * sign;
  }

  // sleeping dynamic body が active body と接触した場合に起こす
  _getManifoldMaxPenetration(manifold) {
    if (!manifold || !Array.isArray(manifold.contacts)) {
      return 0.0;
    }
    let maxPenetration = 0.0;
    for (let i = 0; i < manifold.contacts.length; i++) {
      maxPenetration = Math.max(
        maxPenetration,
        util.readOptionalFiniteNumber(
          manifold.contacts[i]?.penetration,
          "PhysicsSpace manifold contact penetration",
          0.0
        )
      );
    }
    return maxPenetration;
  }

  // `_getManifoldCenterPoint`は受け取った値を処理し、後続処理で利用する状態または結果を生成する
  _getManifoldCenterPoint(manifold) {
    if (!manifold || !Array.isArray(manifold.contacts) || manifold.contacts.length <= 0) {
      return null;
    }
    const center = [0.0, 0.0, 0.0];
    let count = 0;
    for (let i = 0; i < manifold.contacts.length; i++) {
      if (!Array.isArray(manifold.contacts[i]?.point)) {
        continue;
      }
      center[0] += manifold.contacts[i].point[0];
      center[1] += manifold.contacts[i].point[1];
      center[2] += manifold.contacts[i].point[2];
      count += 1;
    }
    if (count <= 0) {
      return null;
    }
    center[0] /= count;
    center[1] /= count;
    center[2] /= count;
    return center;
  }

  // `_wakeSleepingBodyForContact`は衝突状態を評価し、位置、速度、接触情報を更新する
  _wakeSleepingBodyForContact(sleepingBody, otherBody, stateMap = null, manifold = null) {
    if (!sleepingBody?.isDynamic?.() || sleepingBody.getSleeping?.() !== true) {
      return false;
    }
    if (otherBody?.isDynamic?.() === true && otherBody.getSleeping?.() !== true) {
      const sleepingState = stateMap?.get?.(sleepingBody) ?? null;
      const otherState = stateMap?.get?.(otherBody) ?? null;
      const centerPoint = this._getManifoldCenterPoint(manifold);
      if (sleepingState && otherState && Array.isArray(centerPoint)) {
        const sleepingVelocity = this._getContactPointVelocity(
          sleepingState,
          this._subVec3(centerPoint, sleepingState.position)
        );
        const otherVelocity = this._getContactPointVelocity(
          otherState,
          this._subVec3(centerPoint, otherState.position)
        );
        const relativeVelocity = this._subVec3(otherVelocity, sleepingVelocity);
        const wakeLinearThreshold = Math.max(this.sleepLinearThreshold * 1.25, 0.20);
        if (this._lengthVec3(relativeVelocity) <= wakeLinearThreshold) {
          return false;
        }
      } else if (otherState) {
        const linearSpeed = this._lengthVec3(otherState.velocity);
        const angularSpeed = this._lengthVec3(otherState.angularVelocity);
        const wakeLinearThreshold = Math.max(this.sleepLinearThreshold * 1.25, 0.20);
        const wakeAngularThreshold = Math.max(this.sleepAngularThreshold * 1.25, 4.0);
        if (linearSpeed <= wakeLinearThreshold
            && angularSpeed <= wakeAngularThreshold) {
          return false;
        }
      }
      sleepingBody.wakeUp?.();
      this._resetSleepStepCount(sleepingBody);
      return true;
    }
    if (otherBody?.isKinematic?.() === true) {
      sleepingBody.wakeUp?.();
      this._resetSleepStepCount(sleepingBody);
      return true;
    }
    return false;
  }

  // 現在の body transform から query 用 state を作る
  _getQueryState(body) {
    return {
      position: this._cloneVec3(body.getPosition()),
      quat: body.getQuat()
    };
  }

  // query option を検証する
  _readRaycastOptions(options) {
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
      layerMask: this._readCollisionBits(
        opts.layerMask ?? 0xffffffff,
        "PhysicsSpace raycast layerMask"
      ),
      filter: opts.filter
    };
  }

  // AABB query option を検証する
  _readQueryAabbOptions(options) {
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
      layerMask: this._readCollisionBits(
        opts.layerMask ?? 0xffffffff,
        "PhysicsSpace queryAabb layerMask"
      ),
      filter: opts.filter
    };
  }

  // overlapSphere option を検証する
  _readOverlapSphereOptions(options) {
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
      layerMask: this._readCollisionBits(
        opts.layerMask ?? 0xffffffff,
        "PhysicsSpace overlapSphere layerMask"
      ),
      filter: opts.filter
    };
  }

  // collision layer / mask 用の 32bit bitmask を読む
  _readCollisionBits(value, name) {
    return util.readFiniteNumber(value, name, {
      integer: true,
      min: 0,
      max: 0xffffffff
    });
  }

  // query layerMask と body layer が一致するかを返す
  _matchesQueryLayer(body, layerMask) {
    if (!body?.getCollisionLayer) {
      return false;
    }
    return (body.getCollisionLayer() & layerMask) !== 0;
  }

  // includeTriggers / triggerOnly option に body が一致するかを返す
  _matchesQueryTriggerMode(body, query) {
    const isTrigger = body?.getTrigger?.() === true;
    if (query.triggerOnly === true) {
      return isTrigger;
    }
    if (query.includeTriggers === false && isTrigger) {
      return false;
    }
    return true;
  }

  // query filter を検証する
  _assertQueryFilter(filter, name) {
    if (filter !== undefined && typeof filter !== "function") {
      throw new Error(`${name} filter must be a function`);
    }
  }

  // 2 つの AABB が重なるかどうかを返す
  _intersectAabb(minA, maxA, minB, maxB) {
    if (maxA[0] < minB[0] || minA[0] > maxB[0]) return false;
    if (maxA[1] < minB[1] || minA[1] > maxB[1]) return false;
    if (maxA[2] < minB[2] || minA[2] > maxB[2]) return false;
    return true;
  }

  // 現在の physics space から query 用 collider entry 一覧を収集する
  // ここでは collider 種別を固定せず、個々の query メソッドへ渡す材料だけを並べる
  _collectCurrentQueryEntries(query = {}) {
    const includeTriggers = query.includeTriggers ?? true;
    const triggerOnly = query.triggerOnly ?? false;
    const layerMask = query.layerMask ?? 0xffffffff;
    const filter = query.filter;
    const entries = [];
    for (let i = 0; i < this.bodies.length; i++) {
      const body = this.bodies[i];
      const collider = body?.getCollider?.();
      if (!collider) {
        continue;
      }
      if (!this._matchesQueryTriggerMode(body, { includeTriggers, triggerOnly })) {
        continue;
      }
      if (!this._matchesQueryLayer(body, layerMask)) {
        continue;
      }
      if (typeof filter === "function" && filter(body) !== true) {
        continue;
      }
      const state = this._getQueryState(body);
      entries.push({
        body,
        collider,
        position: state.position,
        quat: state.quat
      });
    }
    return entries;
  }

  // raycast 用に 1 body 分の hit を収集する
  _raycastBody(body, rayOrigin, rayDir, query) {
    if (!body?.getCollider?.()) {
      return null;
    }
    if (!this._matchesQueryTriggerMode(body, query)) {
      return null;
    }
    if (!this._matchesQueryLayer(body, query.layerMask)) {
      return null;
    }
    if (typeof query.filter === "function" && query.filter(body) !== true) {
      return null;
    }
    const state = this._getQueryState(body);
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

  // raycast 全 hit を距離順に返す
  _collectRayHits(rayOrigin, rayDir, query) {
    const hits = [];
    for (let i = 0; i < this.bodies.length; i++) {
      const hit = this._raycastBody(this.bodies[i], rayOrigin, rayDir, query);
      if (hit !== null) {
        hits.push(hit);
      }
    }
    hits.sort((leftHit, rightHit) => leftHit.distance - rightHit.distance);
    return hits;
  }

  // broadphase の前段として、step 中の stateMap から collider entry 一覧を作る
  // ここではまだ「接触しているか」は見ず、broadphase 候補の材料だけを並べる
  _collectStepColliderEntries(stateMap) {
    const entries = [];
    for (let i = 0; i < this.bodies.length; i++) {
      const body = this.bodies[i];
      const collider = body?.getCollider?.();
      if (!collider) {
        continue;
      }
      const state = stateMap.get(body);
      const kind = collider.getBroadphaseKind?.();
      if (typeof kind !== "string" || kind.length === 0) {
        continue;
      }
      entries.push({
        body,
        collider,
        position: [...state.position],
        quat: state.quat,
        aabb: collider.getAabb?.(state.position, state.quat) ?? null
      });
    }
    return entries;
  }

  // AABB を持つ collider 同士は broadphase 段階で粗く除外する
  // plane のように AABB を持たない collider は無限・特殊形状として候補を残す
  _canAabbBroadphaseOverlap(entryA, entryB) {
    if (entryA.aabb === null || entryB.aabb === null) {
      return true;
    }
    return this._intersectAabb(
      entryA.aabb.min,
      entryA.aabb.max,
      entryB.aabb.min,
      entryB.aabb.max
    );
  }

  // broadphase pair を、layer / AABB / collider dispatch の順に確認して追加する
  _pushBroadphasePairIfAllowed(pairs, entryA, entryB) {
    if (entryA.body?.canCollideWith?.(entryB.body) !== true) {
      return;
    }
    if (!this._canAabbBroadphaseOverlap(entryA, entryB)) {
      return;
    }
    if (entryA.collider.canBroadphasePairWith?.(entryB.collider) === true) {
      pairs.push({ entryA, entryB });
      return;
    }
    if (entryB.collider.canBroadphasePairWith?.(entryA.collider) === true) {
      pairs.push({
        entryA: entryB,
        entryB: entryA
      });
    }
  }

  // 全組み合わせを確認する broadphase
  _collectBruteForceBroadphasePairs(entries) {
    const pairs = [];
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        this._pushBroadphasePairIfAllowed(pairs, entries[i], entries[j]);
      }
    }
    return pairs;
  }

  // AABB を持つ finite collider 同士を x 軸 sweep-and-prune で候補化する
  _collectSweepAabbBroadphasePairs(entries) {
    const pairs = [];
    const finiteEntries = [];
    const specialEntries = [];
    for (let i = 0; i < entries.length; i++) {
      if (entries[i].aabb === null) {
        specialEntries.push(entries[i]);
      } else {
        finiteEntries.push(entries[i]);
      }
    }

    finiteEntries.sort((entryA, entryB) => entryA.aabb.min[0] - entryB.aabb.min[0]);
    const activeEntries = [];
    for (let i = 0; i < finiteEntries.length; i++) {
      const entryB = finiteEntries[i];
      for (let j = activeEntries.length - 1; j >= 0; j--) {
        if (activeEntries[j].aabb.max[0] < entryB.aabb.min[0]) {
          activeEntries.splice(j, 1);
        }
      }
      for (let j = 0; j < activeEntries.length; j++) {
        this._pushBroadphasePairIfAllowed(pairs, activeEntries[j], entryB);
      }
      activeEntries.push(entryB);
    }

    for (let i = 0; i < specialEntries.length; i++) {
      for (let j = i + 1; j < specialEntries.length; j++) {
        this._pushBroadphasePairIfAllowed(pairs, specialEntries[i], specialEntries[j]);
      }
      for (let j = 0; j < finiteEntries.length; j++) {
        this._pushBroadphasePairIfAllowed(pairs, specialEntries[i], finiteEntries[j]);
      }
    }
    return pairs;
  }

  // broadphase 候補を列挙する
  _collectBroadphasePairs(entries) {
    if (this.broadphaseMode === "bruteForce") {
      return this._collectBruteForceBroadphasePairs(entries);
    }
    return this._collectSweepAabbBroadphasePairs(entries);
  }

  // narrowphase の一部として、候補 pair を collider 側の dispatch へ渡す
  // PhysicsSpace は接触式を持たず、entryA の collider が相手型に応じた式を選ぶ
  // 返り値は contacts[] を持つ manifold へ正規化する
  _buildManifold(entryA, entryB) {
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

  // manifold を flat contact 一覧へ展開する
  _flattenManifoldContacts(manifold) {
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

  // broadphase 候補から narrowphase を実行し、実際の manifold 一覧を作る
  _collectManifolds(stateMap) {
    const manifolds = [];
    const entries = this._collectStepColliderEntries(stateMap);
    const candidatePairs = this._collectBroadphasePairs(entries);
    for (let i = 0; i < candidatePairs.length; i++) {
      const pair = candidatePairs[i];
      const manifold = this._buildManifold(pair.entryA, pair.entryB);
      if (manifold !== null && Array.isArray(manifold.contacts) && manifold.contacts.length > 0) {
        manifolds.push(manifold);
      }
    }
    return manifolds;
  }

  // material.restitution を読み、未指定なら physics space 既定値を使う
  _getRestitution(body) {
    const material = body?.getPhysicsMaterial?.();
    if (material?.restitution !== undefined) {
      return util.readFiniteNumber(material.restitution, "PhysicsSpace restitution", {
        min: 0.0,
        max: 1.0
      });
    }
    return this.defaultRestitution;
  }

  // material.friction を読み、未指定なら physics space 既定値を使う
  _getFriction(body) {
    const material = body?.getPhysicsMaterial?.();
    if (material?.friction !== undefined) {
      return util.readFiniteNumber(material.friction, "PhysicsSpace friction", {
        min: 0.0
      });
    }
    return this.defaultFriction;
  }

  // manifold 全体の押し戻しを、最深 penetration を基準に 1 回だけ行う
  _resolveManifoldPosition(manifold, stateMap) {
    const invMassA = this._getSolverInverseMass(manifold.bodyA);
    const invMassB = this._getSolverInverseMass(manifold.bodyB);
    const invMassSum = invMassA + invMassB;
    if (invMassSum <= 0.0) {
      return;
    }
    let maxPenetration = 0.0;
    for (let i = 0; i < manifold.contacts.length; i++) {
      if (manifold.contacts[i].penetration > maxPenetration) {
        maxPenetration = manifold.contacts[i].penetration;
      }
    }
    if (maxPenetration <= 0.0) {
      return;
    }
    const stateA = stateMap.get(manifold.bodyA);
    const stateB = stateMap.get(manifold.bodyB);
    let positionScale = 1.0;
    if (manifold?.bodyA?.getCollider?.()?.type === "box"
        && manifold?.bodyB?.getCollider?.()?.type === "box") {
      const contactCount = Array.isArray(manifold.contacts) ? manifold.contacts.length : 1;
      // 1 点の浅い box-box contact は manifold がまだ育っていないため、
      // full correction を掛けると edge direction の並進 kick を作りやすい
      // persistent face patch が立つ前の段階だけ、位置補正を弱める
      if (contactCount === 1 && maxPenetration <= 0.01) {
        positionScale = 0.18;
      } else if (contactCount <= 2 && maxPenetration <= 0.005) {
        positionScale = 0.32;
      }
    }
    // 1 frame で penetration を完全に解消しようとすると、stack では押し戻しが強すぎて
    // 微振動や wake を増やしやすい
    // ここでは slop を引いた残りに Baumgarte 係数を掛けて、数 frame に分散して戻す
    const correctionPenetration = Math.max(0.0, maxPenetration - this.positionCorrectionSlop);
    if (correctionPenetration <= 0.0) {
      return;
    }
    const correctionScale = correctionPenetration
      * this.positionCorrectionBeta
      * positionScale
      / invMassSum;
    if (invMassA > 0.0) {
      stateA.position[0] -= manifold.normal[0] * correctionScale * invMassA;
      stateA.position[1] -= manifold.normal[1] * correctionScale * invMassA;
      stateA.position[2] -= manifold.normal[2] * correctionScale * invMassA;
    }
    if (invMassB > 0.0) {
      stateB.position[0] += manifold.normal[0] * correctionScale * invMassB;
      stateB.position[1] += manifold.normal[1] * correctionScale * invMassB;
      stateB.position[2] += manifold.normal[2] * correctionScale * invMassB;
    }
  }

  // 前フレームの cached impulse を現在 state へ先に与える
  _applyWarmStartToContactPoint(manifold, contactPoint, stateMap) {
    const normalImpulse = contactPoint.normalImpulse ?? 0.0;
    const tangentImpulse = Array.isArray(contactPoint.tangentImpulse)
      ? contactPoint.tangentImpulse
      : [0.0, 0.0, 0.0];
    if (normalImpulse <= 0.0
        && Math.abs(tangentImpulse[0]) <= 1.0e-8
        && Math.abs(tangentImpulse[1]) <= 1.0e-8
        && Math.abs(tangentImpulse[2]) <= 1.0e-8) {
      return;
    }
    const stateA = stateMap.get(manifold.bodyA);
    const stateB = stateMap.get(manifold.bodyB);
    const invMassA = this._getSolverInverseMass(manifold.bodyA);
    const invMassB = this._getSolverInverseMass(manifold.bodyB);
    if (invMassA + invMassB <= 0.0) {
      return;
    }
    const point = Array.isArray(contactPoint.point)
      ? contactPoint.point
      : [
        (stateA.position[0] + stateB.position[0]) * 0.5,
        (stateA.position[1] + stateB.position[1]) * 0.5,
        (stateA.position[2] + stateB.position[2]) * 0.5
      ];
    const rA = this._subVec3(point, stateA.position);
    const rB = this._subVec3(point, stateB.position);
    const impulse = [
      manifold.normal[0] * normalImpulse + tangentImpulse[0],
      manifold.normal[1] * normalImpulse + tangentImpulse[1],
      manifold.normal[2] * normalImpulse + tangentImpulse[2]
    ];
    this._applyContactImpulse(manifold.bodyA, stateA, rA, impulse, -1.0, invMassA);
    this._applyContactImpulse(manifold.bodyB, stateB, rB, impulse, 1.0, invMassB);
  }

  // manifold に保存された shared tangent impulse を先に適用する
  _applyWarmStartToSharedManifold(manifold, stateMap) {
    const sharedTangentImpulse = Array.isArray(manifold?.sharedTangentImpulse)
      ? manifold.sharedTangentImpulse
      : manifold?.supportTangentImpulse;
    if (!Array.isArray(sharedTangentImpulse)) {
      return;
    }
    if (Math.abs(sharedTangentImpulse[0]) <= 1.0e-8
        && Math.abs(sharedTangentImpulse[1]) <= 1.0e-8
        && Math.abs(sharedTangentImpulse[2]) <= 1.0e-8) {
      return;
    }
    this._applySharedManifoldImpulse(manifold, stateMap, sharedTangentImpulse);
  }

  // manifold 群へ warm start を適用する
  _applyWarmStartToManifolds(manifolds, stateMap) {
    for (let i = 0; i < manifolds.length; i++) {
      this._applyWarmStartToSharedManifold(manifolds[i], stateMap);
      for (let j = 0; j < manifolds[i].contacts.length; j++) {
        this._applyWarmStartToContactPoint(manifolds[i], manifolds[i].contacts[j], stateMap);
      }
    }
  }

  // 接触法線に直交する 2 本の接線基底を返す
  _buildContactTangents(normal, relativeVelocity) {
    const normalVelocity = this._dotVec3(relativeVelocity, normal);
    const tangent = [
      relativeVelocity[0] - normal[0] * normalVelocity,
      relativeVelocity[1] - normal[1] * normalVelocity,
      relativeVelocity[2] - normal[2] * normalVelocity
    ];
    let tangentA = null;
    const tangentLength = this._lengthVec3(tangent);
    if (tangentLength > 1.0e-8) {
      tangentA = [
        tangent[0] / tangentLength,
        tangent[1] / tangentLength,
        tangent[2] / tangentLength
      ];
    } else {
      // 静止接触では relativeVelocity 由来の接線が消えることがあるため、
      // normal と十分に平行でない world axis から直交接線を必ず組み立てる
      const fallbackAxis = Math.abs(normal[1]) < 0.95
        ? [0.0, 1.0, 0.0]
        : [1.0, 0.0, 0.0];
      tangentA = this._crossVec3(fallbackAxis, normal);
      if (this._lengthVec3(tangentA) <= 1.0e-8) {
        tangentA = this._crossVec3([0.0, 0.0, 1.0], normal);
      }
      tangentA = this._normalizeVec3(tangentA, "PhysicsSpace tangentA");
    }
    const tangentB = this._normalizeVec3(
      this._crossVec3(normal, tangentA),
      "PhysicsSpace tangentB"
    );
    return { tangentA, tangentB };
  }

  // 実際に penetration を持っている接点数を返す
  _countPenetratingContacts(manifold, threshold = 1.0e-4) {
    if (!Array.isArray(manifold?.contacts)) {
      return 0;
    }
    let count = 0;
    for (let i = 0; i < manifold.contacts.length; i++) {
      if ((manifold.contacts[i]?.penetration ?? 0.0) > threshold) {
        count += 1;
      }
    }
    return count;
  }

  // 1 点の浅い box-box contact では、SAT の edge 軸が斜め法線になりやすく
  // 縦落下の接触が大きい横キックへ変換されやすい
  // persistent face patch が立つ前の underconstrained 条件だけ、
  // solver 用法線を dominant axis へ regularize する
  _getSolverManifold(manifold) {
    if (manifold?.bodyA?.getCollider?.()?.type !== "box"
        || manifold?.bodyB?.getCollider?.()?.type !== "box") {
      return manifold;
    }
    const contactCount = this._countPenetratingContacts(manifold);
    if (contactCount !== 1) {
      return manifold;
    }
    let penetration = 0.0;
    for (let i = 0; i < manifold.contacts.length; i++) {
      penetration = Math.max(penetration, Math.max(0.0, manifold.contacts[i]?.penetration ?? 0.0));
    }
    if (penetration > 0.01) {
      return manifold;
    }
    const normal = manifold.normal;
    const absNormal = [Math.abs(normal[0]), Math.abs(normal[1]), Math.abs(normal[2])];
    let axisIndex = 0;
    if (absNormal[1] > absNormal[axisIndex]) {
      axisIndex = 1;
    }
    if (absNormal[2] > absNormal[axisIndex]) {
      axisIndex = 2;
    }
    if (absNormal[axisIndex] < 0.7) {
      return manifold;
    }
    const regularizedNormal = [0.0, 0.0, 0.0];
    regularizedNormal[axisIndex] = normal[axisIndex] >= 0.0 ? 1.0 : -1.0;
    return {
      ...manifold,
      normal: regularizedNormal
    };
  }

  // 離散 step の浅い edge contact で、回転主導の閉じ込み速度まで
  // 強い並進 impulse に変換すると、box-box が横へ飛びすぎる
  // penetration は位置補正でも戻せるため、ここでは shallow / angular-dominated な
  // box-box contact だけ法線 impulse を弱める
  _getNormalImpulseScale(manifold, contactPoint, linearVelocityAlongNormal, velocityAlongNormal) {
    if (manifold?.bodyA?.getCollider?.()?.type !== "box"
        || manifold?.bodyB?.getCollider?.()?.type !== "box") {
      if (this._isStaticPlaneBoxContact(manifold) === true) {
        const contactCount = this._countPenetratingContacts(manifold);
        const penetration = Math.max(0.0, contactPoint?.penetration ?? 0.0);
        if (contactCount === 1 && penetration <= 0.02) {
          return 0.22;
        }
        if (contactCount <= 2 && penetration <= 0.01) {
          return 0.45;
        }
      }
      return 1.0;
    }
    const contactCount = this._countPenetratingContacts(manifold);
    const penetration = Math.max(0.0, contactPoint?.penetration ?? 0.0);
    if (contactCount === 1 && penetration <= 0.01) {
      return 0.25;
    }
    if (contactCount <= 2 && penetration <= 0.005) {
      return 0.55;
    }
    const angularDominated = Math.abs(linearVelocityAlongNormal)
      < Math.abs(velocityAlongNormal) * 0.35;
    if (!angularDominated) {
      return 1.0;
    }
    if (contactCount === 1
        && penetration <= 0.02
        && Math.abs(linearVelocityAlongNormal) <= 2.0) {
      return 0.35;
    }
    if (contactCount <= 2
        && penetration <= 0.01
        && Math.abs(linearVelocityAlongNormal) <= 1.0) {
      return 0.6;
    }
    return 1.0;
  }

  // 反発 0 の static collider に box が当たる場合は、box 側の restitution を静的面へ持ち込まない
  // 長い beam では上向きや横向きの反発が端接触の torque になり、支え無しでも立ち上がって暴れやすい
  _isZeroRestitutionStaticBoxSupport(manifold) {
    const colliderA = manifold?.bodyA?.getCollider?.();
    const colliderB = manifold?.bodyB?.getCollider?.();
    let boxBody = null;
    let staticBody = null;
    if (colliderA?.type !== "box" && colliderB?.type === "box") {
      staticBody = manifold.bodyA;
      boxBody = manifold.bodyB;
    } else if (colliderA?.type === "box" && colliderB?.type !== "box") {
      boxBody = manifold.bodyA;
      staticBody = manifold.bodyB;
    } else if (colliderA?.type === "box" && colliderB?.type === "box") {
      if (manifold.bodyA?.isStatic?.() === true && manifold.bodyB?.isDynamic?.() === true) {
        staticBody = manifold.bodyA;
        boxBody = manifold.bodyB;
      } else if (manifold.bodyA?.isDynamic?.() === true && manifold.bodyB?.isStatic?.() === true) {
        boxBody = manifold.bodyA;
        staticBody = manifold.bodyB;
      } else {
        return false;
      }
    } else {
      return false;
    }
    if (boxBody?.isDynamic?.() !== true || staticBody?.isStatic?.() !== true) {
      return false;
    }
    if (this._getRestitution(staticBody) > 1.0e-6) {
      return false;
    }
    return true;
  }

  // `_isZeroRestitutionPlaneBoxSupport`は入力条件や交差状態を比較し、判定結果を返す
  _isZeroRestitutionPlaneBoxSupport(manifold) {
    const colliderA = manifold?.bodyA?.getCollider?.();
    const colliderB = manifold?.bodyB?.getCollider?.();
    if (!((colliderA?.type === "plane" && colliderB?.type === "box")
        || (colliderA?.type === "box" && colliderB?.type === "plane"))) {
      return false;
    }
    return this._isZeroRestitutionStaticBoxSupport(manifold);
  }

  // `_isStaticPlaneBoxContact`は入力条件や交差状態を比較し、判定結果を返す
  _isStaticPlaneBoxContact(manifold) {
    const colliderA = manifold?.bodyA?.getCollider?.();
    const colliderB = manifold?.bodyB?.getCollider?.();
    if (colliderA?.type === "plane" && colliderB?.type === "box") {
      return manifold.bodyA?.isStatic?.() === true && manifold.bodyB?.isDynamic?.() === true;
    }
    if (colliderA?.type === "box" && colliderB?.type === "plane") {
      return manifold.bodyB?.isStatic?.() === true && manifold.bodyA?.isDynamic?.() === true;
    }
    return false;
  }

  _shouldSuppressPlaneBoxRestitution(manifold, stateA, stateB, rA, rB, velocityAlongNormal, linearVelocityAlongNormal) {
    return this._isZeroRestitutionStaticBoxSupport(manifold);
  }

  // manifold 1 点ぶんの impulse を解く
  _resolveContactPoint(manifold, contactPoint, stateMap, options = {}) {
    const contact = {
      bodyA: manifold.bodyA,
      bodyB: manifold.bodyB,
      normal: manifold.normal,
      penetration: contactPoint.penetration,
      point: contactPoint.point
    };
    if (this._isTriggerContact(contact)) {
      return;
    }
    const stateA = stateMap.get(contact.bodyA);
    const stateB = stateMap.get(contact.bodyB);
    const invMassA = this._getSolverInverseMass(contact.bodyA);
    const invMassB = this._getSolverInverseMass(contact.bodyB);
    const invMassSum = invMassA + invMassB;
    if (invMassSum <= 0.0) {
      return;
    }

    const point = Array.isArray(contact.point)
      ? contact.point
      : [
        (stateA.position[0] + stateB.position[0]) * 0.5,
        (stateA.position[1] + stateB.position[1]) * 0.5,
        (stateA.position[2] + stateB.position[2]) * 0.5
      ];
    const rA = this._subVec3(point, stateA.position);
    const rB = this._subVec3(point, stateB.position);
    const contactVelocityA = this._getContactPointVelocity(stateA, rA);
    const contactVelocityB = this._getContactPointVelocity(stateB, rB);
    const relativeVelocity = this._subVec3(contactVelocityB, contactVelocityA);
    const velocityAlongNormal = this._dotVec3(relativeVelocity, contact.normal);
    if (velocityAlongNormal > 0.0) {
      return;
    }

    const linearRelativeVelocity = this._subVec3(stateB.velocity, stateA.velocity);
    const linearVelocityAlongNormal = this._dotVec3(linearRelativeVelocity, contact.normal);
    let restitution = options.restitutionOverride ?? Math.max(
      this._getRestitution(contact.bodyA),
      this._getRestitution(contact.bodyB)
    );
    // 接触点の閉じ込み速度が主に角速度由来のときまで restitution を掛けると、
    // 回転接触が大きい横滑り・跳ね返りへ化けやすい
    // ここでは「並進として相手へ突っ込んだ衝突」と
    // 「回転で擦り込んだ接触」を分け、後者では反発を抑える
    if (Math.abs(linearVelocityAlongNormal) <= 0.5
        || Math.abs(linearVelocityAlongNormal) < Math.abs(velocityAlongNormal) * 0.35) {
      restitution = 0.0;
    }
    if (restitution > 0.0
        && options.restitutionOverride === undefined
        && this._shouldSuppressPlaneBoxRestitution(
          manifold,
          stateA,
          stateB,
          rA,
          rB,
          velocityAlongNormal,
          linearVelocityAlongNormal
        )) {
      restitution = 0.0;
    }
    const normalDenominator = this._getImpulseDenominator(
      contact.bodyA,
      stateA,
      rA,
      contact.bodyB,
      stateB,
      rB,
      contact.normal,
      invMassA,
      invMassB
    );
    if (normalDenominator <= 1.0e-12) {
      return;
    }
    const normalImpulseScale = this._getNormalImpulseScale(
      manifold,
      contactPoint,
      linearVelocityAlongNormal,
      velocityAlongNormal
    );
    const impulseMagnitude = (-(1.0 + restitution) * velocityAlongNormal / normalDenominator)
      * normalImpulseScale;
    const impulse = [
      contact.normal[0] * impulseMagnitude,
      contact.normal[1] * impulseMagnitude,
      contact.normal[2] * impulseMagnitude
    ];
    contactPoint.normalImpulse = (contactPoint.normalImpulse ?? 0.0) + impulseMagnitude;

    this._applyContactImpulse(contact.bodyA, stateA, rA, impulse, -1.0, invMassA);
    this._applyContactImpulse(contact.bodyB, stateB, rB, impulse, 1.0, invMassB);

    const friction = Math.sqrt(
      this._getFriction(contact.bodyA) * this._getFriction(contact.bodyB)
    );
    let maxFrictionImpulse = Math.max(0.0, (contactPoint.normalImpulse ?? 0.0) * friction);
    if (this._countPenetratingContacts(manifold) <= 1
        && manifold?.bodyA?.getCollider?.()?.type === "box"
        && manifold?.bodyB?.getCollider?.()?.type === "box") {
      maxFrictionImpulse *= 0.18;
    } else if (this._countPenetratingContacts(manifold) <= 1
        && this._isStaticPlaneBoxContact(manifold) === true) {
      // plane-box の単一点 support は edge を支点に stick しやすく、
      // 高摩擦をそのまま使うと beam が寝る前に立ち上がる torque を作りやすい
      // 面 support が育つ前だけ friction cone を絞り、まず滑って寝る方向を優先する
      maxFrictionImpulse *= 0.22;
    }
    let accumulatedTangentImpulse = Array.isArray(contactPoint.tangentImpulse)
      ? [...contactPoint.tangentImpulse]
      : [0.0, 0.0, 0.0];
    // `solveFrictionAxis`は衝突状態を評価し、位置、速度、接触情報を更新する
    const solveFrictionAxis = (axis) => {
      const currentVelocityA = this._getContactPointVelocity(stateA, rA);
      const currentVelocityB = this._getContactPointVelocity(stateB, rB);
      const currentRelativeVelocity = this._subVec3(currentVelocityB, currentVelocityA);
      const frictionDenominator = this._getImpulseDenominator(
        contact.bodyA,
        stateA,
        rA,
        contact.bodyB,
        stateB,
        rB,
        axis,
        invMassA,
        invMassB
      );
      if (frictionDenominator <= 1.0e-12) {
        return;
      }
      const jt = -this._dotVec3(currentRelativeVelocity, axis) / frictionDenominator;
      const candidateImpulse = [
        accumulatedTangentImpulse[0] + axis[0] * jt,
        accumulatedTangentImpulse[1] + axis[1] * jt,
        accumulatedTangentImpulse[2] + axis[2] * jt
      ];
      let nextImpulse = candidateImpulse;
      const impulseLength = this._lengthVec3(candidateImpulse);
      if (impulseLength > maxFrictionImpulse && impulseLength > 1.0e-8) {
        const scale = maxFrictionImpulse / impulseLength;
        nextImpulse = [
          candidateImpulse[0] * scale,
          candidateImpulse[1] * scale,
          candidateImpulse[2] * scale
        ];
      }
      const deltaImpulse = [
        nextImpulse[0] - accumulatedTangentImpulse[0],
        nextImpulse[1] - accumulatedTangentImpulse[1],
        nextImpulse[2] - accumulatedTangentImpulse[2]
      ];
      accumulatedTangentImpulse = nextImpulse;
      if (Math.abs(deltaImpulse[0]) <= 1.0e-8
          && Math.abs(deltaImpulse[1]) <= 1.0e-8
          && Math.abs(deltaImpulse[2]) <= 1.0e-8) {
        return;
      }
      this._applyContactImpulse(contact.bodyA, stateA, rA, deltaImpulse, -1.0, invMassA);
      this._applyContactImpulse(contact.bodyB, stateB, rB, deltaImpulse, 1.0, invMassB);
    };
    const postContactVelocityA = this._getContactPointVelocity(stateA, rA);
    const postContactVelocityB = this._getContactPointVelocity(stateB, rB);
    const postRelativeVelocity = this._subVec3(postContactVelocityB, postContactVelocityA);
    const { tangentA, tangentB } = this._buildContactTangents(contact.normal, postRelativeVelocity);
    solveFrictionAxis(tangentA);
    solveFrictionAxis(tangentB);
    contactPoint.tangentImpulse = accumulatedTangentImpulse;

    if (this._isSupportNormal(contact.normal)) {
      if (invMassA > 0.0 && invMassB === 0.0) {
        stateA.touchedStatic = true;
      }
      if (invMassB > 0.0 && invMassA === 0.0) {
        stateB.touchedStatic = true;
      }
      if (invMassA > 0.0 && invMassB > 0.0) {
        stateA.touchedDynamicSupport = true;
        stateB.touchedDynamicSupport = true;
      }
    }
  }

  // manifold 複数接点の高速衝突では、反発だけを代表点 1 個で先に解く
  // face-face の対称衝突で各接点が独立に restitution を解くと、
  // 線形反発が過小になりやすいため、まず中心点で法線反発を決める
  _resolveImpactCenter(manifold, stateMap) {
    if (!manifold || !Array.isArray(manifold.contacts) || manifold.contacts.length <= 1) {
      return false;
    }
    if (this._countPenetratingContacts(manifold) <= 1) {
      return false;
    }
    if (manifold.bodyA?.isDynamic?.() !== true || manifold.bodyB?.isDynamic?.() !== true) {
      return false;
    }
    const restitution = Math.max(
      this._getRestitution(manifold.bodyA),
      this._getRestitution(manifold.bodyB)
    );
    if (restitution <= 1.0e-6) {
      return false;
    }
    const stateA = stateMap.get(manifold.bodyA);
    const stateB = stateMap.get(manifold.bodyB);
    if (!stateA || !stateB) {
      return false;
    }
    const angularSpeedA = this._lengthVec3(stateA.angularVelocity);
    const angularSpeedB = this._lengthVec3(stateB.angularVelocity);
    // 代表 center impulse は、低角速度の linear face-face 衝突を
    // 1 点へ畳んで反発を与えるための補助
    // 回転を伴う接触までここで反発させると、多点 manifold 全体より
    // center impulse が支配して不自然な並進を作りやすい
    if (angularSpeedA > 8.0 || angularSpeedB > 8.0) {
      return false;
    }
    const centerPoint = [0.0, 0.0, 0.0];
    let penetrationSum = 0.0;
    for (let i = 0; i < manifold.contacts.length; i++) {
      const point = Array.isArray(manifold.contacts[i].point)
        ? manifold.contacts[i].point
        : stateA.position;
      centerPoint[0] += point[0];
      centerPoint[1] += point[1];
      centerPoint[2] += point[2];
      penetrationSum += manifold.contacts[i].penetration ?? 0.0;
    }
    centerPoint[0] /= manifold.contacts.length;
    centerPoint[1] /= manifold.contacts.length;
    centerPoint[2] /= manifold.contacts.length;
    const rA = this._subVec3(centerPoint, stateA.position);
    const rB = this._subVec3(centerPoint, stateB.position);
    const contactVelocityA = this._getContactPointVelocity(stateA, rA);
    const contactVelocityB = this._getContactPointVelocity(stateB, rB);
    const relativeVelocity = this._subVec3(contactVelocityB, contactVelocityA);
    const velocityAlongNormal = this._dotVec3(relativeVelocity, manifold.normal);
    if (velocityAlongNormal >= -0.5) {
      return false;
    }
    const linearRelativeVelocity = this._subVec3(stateB.velocity, stateA.velocity);
    const linearVelocityAlongNormal = this._dotVec3(linearRelativeVelocity, manifold.normal);
    // manifold 中心の代表反発は、並進としてぶつかった正面衝突のための補助
    // 回転接触までここで反発させると、接触点全体よりも center impulse が支配して
    // 不自然な横滑りを作りやすい
    if (Math.abs(linearVelocityAlongNormal) <= 0.5
        || Math.abs(linearVelocityAlongNormal) < Math.abs(velocityAlongNormal) * 0.5) {
      return false;
    }
    this._resolveContactPoint(
      manifold,
      {
        featureKey: "impact-center",
        penetration: penetrationSum / manifold.contacts.length,
        point: centerPoint
      },
      stateMap
    );
    return true;
  }

  // manifold 中心点へ shared impulse を適用する
  _applySharedManifoldImpulse(manifold, stateMap, impulse) {
    if (!manifold || !Array.isArray(manifold.contacts) || manifold.contacts.length <= 0) {
      return false;
    }
    const bodyA = manifold.bodyA;
    const bodyB = manifold.bodyB;
    const stateA = stateMap.get(bodyA);
    const stateB = stateMap.get(bodyB);
    if (!stateA || !stateB) {
      return false;
    }
    const invMassA = this._getSolverInverseMass(bodyA);
    const invMassB = this._getSolverInverseMass(bodyB);
    if (invMassA + invMassB <= 0.0) {
      return false;
    }
    const centerPoint = [0.0, 0.0, 0.0];
    for (let i = 0; i < manifold.contacts.length; i++) {
      const point = Array.isArray(manifold.contacts[i].point)
        ? manifold.contacts[i].point
        : stateA.position;
      centerPoint[0] += point[0];
      centerPoint[1] += point[1];
      centerPoint[2] += point[2];
    }
    centerPoint[0] /= manifold.contacts.length;
    centerPoint[1] /= manifold.contacts.length;
    centerPoint[2] /= manifold.contacts.length;
    const rA = this._subVec3(centerPoint, stateA.position);
    const rB = this._subVec3(centerPoint, stateB.position);
    this._applyContactImpulse(
      bodyA,
      stateA,
      rA,
      impulse,
      -1.0,
      invMassA
    );
    this._applyContactImpulse(
      bodyB,
      stateB,
      rB,
      impulse,
      1.0,
      invMassB
    );
    return true;
  }

  // 多点接触している manifold では、
  // 各接点の動摩擦だけでは横滑りが残りやすいため、
  // manifold 全体で共有する接線 impulse を追加して static friction を近似する
  _resolveSharedManifoldFriction(manifold, stateMap) {
    if (!manifold || !Array.isArray(manifold.contacts) || manifold.contacts.length <= 1) {
      return;
    }
    if (this._countPenetratingContacts(manifold) <= 1) {
      return;
    }
    const bodyA = manifold.bodyA;
    const bodyB = manifold.bodyB;
    const stateA = stateMap.get(bodyA);
    const stateB = stateMap.get(bodyB);
    if (!stateA || !stateB) {
      return;
    }
    const invMassA = this._getSolverInverseMass(bodyA);
    const invMassB = this._getSolverInverseMass(bodyB);
    if (invMassA + invMassB <= 0.0) {
      return;
    }

    let normalImpulseSum = 0.0;
    let tangentImpulseSum = this._lengthVec3(
      Array.isArray(manifold.sharedTangentImpulse)
        ? manifold.sharedTangentImpulse
        : (Array.isArray(manifold.supportTangentImpulse)
          ? manifold.supportTangentImpulse
          : [0.0, 0.0, 0.0])
    );
    const centerPoint = [0.0, 0.0, 0.0];
    for (let i = 0; i < manifold.contacts.length; i++) {
      const point = Array.isArray(manifold.contacts[i].point)
        ? manifold.contacts[i].point
        : stateA.position;
      centerPoint[0] += point[0];
      centerPoint[1] += point[1];
      centerPoint[2] += point[2];
      normalImpulseSum += Math.max(0.0, manifold.contacts[i].normalImpulse ?? 0.0);
      tangentImpulseSum += this._lengthVec3(
        Array.isArray(manifold.contacts[i].tangentImpulse)
          ? manifold.contacts[i].tangentImpulse
          : [0.0, 0.0, 0.0]
      );
    }
    centerPoint[0] /= manifold.contacts.length;
    centerPoint[1] /= manifold.contacts.length;
    centerPoint[2] /= manifold.contacts.length;
    const rA = this._subVec3(centerPoint, stateA.position);
    const rB = this._subVec3(centerPoint, stateB.position);
    const velocityA = this._getContactPointVelocity(stateA, rA);
    const velocityB = this._getContactPointVelocity(stateB, rB);
    const relativeVelocity = this._subVec3(velocityB, velocityA);
    const normalSpeed = this._dotVec3(relativeVelocity, manifold.normal);
    const tangentVelocity = this._subVec3(
      relativeVelocity,
      this._scaleVec3(manifold.normal, normalSpeed)
    );
    const tangentSpeed = this._lengthVec3(tangentVelocity);
    if (tangentSpeed <= 1.0e-4) {
      return;
    }
    const friction = Math.sqrt(
      this._getFriction(bodyA) * this._getFriction(bodyB)
    );
    const maxSupportImpulse = normalImpulseSum * friction * 1.35;
    const remainingImpulse = Math.max(0.0, maxSupportImpulse - tangentImpulseSum * 0.5);
    if (remainingImpulse <= 1.0e-6) {
      return;
    }
    const tangentDir = this._scaleVec3(tangentVelocity, 1.0 / tangentSpeed);
    const centerAxis = this._scaleVec3(tangentDir, -1.0);
    const denominator = this._getImpulseDenominator(
      bodyA,
      stateA,
      rA,
      bodyB,
      stateB,
      rB,
      centerAxis,
      invMassA,
      invMassB
    );
    if (denominator <= 1.0e-12) {
      return;
    }
    const desiredImpulse = tangentSpeed / denominator;
    const impulseMagnitude = Math.min(desiredImpulse, remainingImpulse);
    if (impulseMagnitude <= 1.0e-8) {
      return;
    }
    const impulse = this._scaleVec3(centerAxis, impulseMagnitude);
    const accumulated = Array.isArray(manifold.sharedTangentImpulse)
      ? manifold.sharedTangentImpulse
      : (Array.isArray(manifold.supportTangentImpulse)
        ? manifold.supportTangentImpulse
        : [0.0, 0.0, 0.0]);
    const nextImpulse = [
      accumulated[0] + impulse[0],
      accumulated[1] + impulse[1],
      accumulated[2] + impulse[2]
    ];
    const nextLength = this._lengthVec3(nextImpulse);
    let clampedImpulse = nextImpulse;
    if (nextLength > maxSupportImpulse && nextLength > 1.0e-8) {
      const scale = maxSupportImpulse / nextLength;
      clampedImpulse = [
        nextImpulse[0] * scale,
        nextImpulse[1] * scale,
        nextImpulse[2] * scale
      ];
    }
    const deltaImpulse = [
      clampedImpulse[0] - accumulated[0],
      clampedImpulse[1] - accumulated[1],
      clampedImpulse[2] - accumulated[2]
    ];
    if (!this._applySharedManifoldImpulse(manifold, stateMap, deltaImpulse)) {
      return;
    }
    manifold.sharedTangentImpulse = clampedImpulse;
    manifold.supportTangentImpulse = clampedImpulse;
  }

  // narrowphase が作った manifold を solver で解決する
  // manifold 単位で押し戻しを先に行い、その後で各接触点の impulse を解く
  _resolveManifold(manifold, stateMap) {
    if (!manifold || !Array.isArray(manifold.contacts) || manifold.contacts.length <= 0) {
      return;
    }
    if (this._isTriggerContact(manifold)) {
      return;
    }
    const solverManifold = this._getSolverManifold(manifold);
    this._wakeSleepingBodyForContact(solverManifold.bodyA, solverManifold.bodyB, stateMap, solverManifold);
    this._wakeSleepingBodyForContact(solverManifold.bodyB, solverManifold.bodyA, stateMap, solverManifold);
    this._resolveManifoldPosition(solverManifold, stateMap);
    const resolvedImpactCenter = this._resolveImpactCenter(solverManifold, stateMap);
    for (let i = 0; i < solverManifold.contacts.length; i++) {
      this._resolveContactPoint(
        solverManifold,
        solverManifold.contacts[i],
        stateMap,
        resolvedImpactCenter ? { restitutionOverride: 0.0 } : {}
      );
    }
    this._resolveSharedManifoldFriction(solverManifold, stateMap);

    // 静止 plane への zero-restitution 接触では、
    // manifold 解決後も残った下向き法線速度を打ち消して
    // 「跳ねずに支えられる」挙動を優先する
    if (Math.abs(solverManifold.normal[1]) >= 0.5
        && (Math.max(this._getRestitution(solverManifold.bodyA), this._getRestitution(solverManifold.bodyB)) <= 1.0e-6
          || this._isZeroRestitutionPlaneBoxSupport(solverManifold))) {
      let dynamicBody = null;
      let dynamicState = null;
      let supportNormal = null;
      if (solverManifold.bodyA?.isDynamic?.() === true && solverManifold.bodyB?.isStatic?.() === true) {
        dynamicBody = solverManifold.bodyA;
        dynamicState = stateMap.get(dynamicBody);
        supportNormal = this._scaleVec3(solverManifold.normal, -1.0);
      } else if (solverManifold.bodyB?.isDynamic?.() === true && solverManifold.bodyA?.isStatic?.() === true) {
        dynamicBody = solverManifold.bodyB;
        dynamicState = stateMap.get(dynamicBody);
        supportNormal = [...solverManifold.normal];
      }
      if (dynamicBody && dynamicState) {
        const normalSpeed = this._dotVec3(dynamicState.velocity, supportNormal);
        if (normalSpeed < 0.0) {
          dynamicState.velocity[0] -= supportNormal[0] * normalSpeed;
          dynamicState.velocity[1] -= supportNormal[1] * normalSpeed;
          dynamicState.velocity[2] -= supportNormal[2] * normalSpeed;
        }
      }
    }
  }

  // 床に支えられて落ち着きつつある box を、角 1 点のまま眠らせず
  // 面で寝る姿勢へ少しずつ寄せる
  // ここは軽量版 solver の不足を補う安定化であり、
  // 高速衝突ではなく「静止に向かう終盤」だけへ限定して効かせる
  _stabilizeRestingBoxes(stateMap, contacts) {
    const supportMap = new Map();
    const dynamicBoxSupportCandidates = [];
    // `pushSupportContact`は重複や入力条件を確認し、対象を管理配列へ追加する
    const pushSupportContact = (dynamicBody, supportBody, supportKind, supportNormal, contact) => {
      if (dynamicBody?.getCollider?.()?.type !== "box") {
        return;
      }
      if (supportKind === "plane" && supportBody?.getCollider?.()?.type !== "plane") {
        return;
      }
      if (supportKind === "box" && supportBody?.getCollider?.()?.type !== "box") {
        return;
      }
      let support = supportMap.get(dynamicBody);
      if (!support || (support.supportKind !== "plane" && supportKind === "plane")) {
        support = {
          normal: [...supportNormal],
          supportBody,
          supportKind,
          contacts: []
        };
        supportMap.set(dynamicBody, support);
      }
      if (support.supportBody !== supportBody || support.supportKind !== supportKind) {
        return;
      }
      const hasNearbySupportPoint = support.contacts.some((existingContact) => (
        existingContact.bodyA === contact.bodyA
        && existingContact.bodyB === contact.bodyB
        && Array.isArray(existingContact.point)
        && Array.isArray(contact.point)
        && this._distanceSqVec3(existingContact.point, contact.point) <= 1.0e-8
      ));
      if (!hasNearbySupportPoint) {
        support.contacts.push(contact);
      }
    };
    for (let i = 0; i < contacts.length; i++) {
      const contact = contacts[i];
      if (this._isTriggerContact(contact)) {
        continue;
      }
      let dynamicBody = null;
      let staticBody = null;
      let supportNormal = null;
      if (contact.bodyA?.isDynamic?.() === true && contact.bodyB?.isStatic?.() === true) {
        dynamicBody = contact.bodyA;
        staticBody = contact.bodyB;
        supportNormal = this._scaleVec3(contact.normal, -1.0);
      } else if (contact.bodyB?.isDynamic?.() === true && contact.bodyA?.isStatic?.() === true) {
        dynamicBody = contact.bodyB;
        staticBody = contact.bodyA;
        supportNormal = [...contact.normal];
      } else {
        continue;
      }
      if (Math.abs(supportNormal[1]) < 0.75) {
        continue;
      }
      pushSupportContact(dynamicBody, staticBody, "plane", supportNormal, contact);
      continue;
    }

    for (let i = 0; i < contacts.length; i++) {
      const contact = contacts[i];
      if (this._isTriggerContact(contact)) {
        continue;
      }
      if (contact.bodyA?.isDynamic?.() !== true
          || contact.bodyB?.isDynamic?.() !== true
          || contact.bodyA?.getCollider?.()?.type !== "box"
          || contact.bodyB?.getCollider?.()?.type !== "box") {
        continue;
      }
      const bodyAPosition = stateMap.get(contact.bodyA)?.position ?? contact.bodyA.getPosition?.();
      const bodyBPosition = stateMap.get(contact.bodyB)?.position ?? contact.bodyB.getPosition?.();
      if (!Array.isArray(bodyAPosition) || !Array.isArray(bodyBPosition)) {
        continue;
      }
      const supportNormalForA = this._scaleVec3(contact.normal, -1.0);
      if (this._isSupportNormal(supportNormalForA, 0.55)) {
        const separationAlongNormal = this._dotVec3(
          this._subVec3(bodyAPosition, bodyBPosition),
          supportNormalForA
        );
        if (separationAlongNormal >= -0.005) {
          dynamicBoxSupportCandidates.push({
            dynamicBody: contact.bodyA,
            supportBody: contact.bodyB,
            supportKind: "box",
            supportNormal: supportNormalForA,
            contact
          });
        }
      }
      const supportNormalForB = [...contact.normal];
      if (this._isSupportNormal(supportNormalForB, 0.55)) {
        const separationAlongNormal = this._dotVec3(
          this._subVec3(bodyBPosition, bodyAPosition),
          supportNormalForB
        );
        if (separationAlongNormal >= -0.005) {
          dynamicBoxSupportCandidates.push({
            dynamicBody: contact.bodyB,
            supportBody: contact.bodyA,
            supportKind: "box",
            supportNormal: supportNormalForB,
            contact
          });
        }
      }
    }

    let propagatedDynamicSupport = true;
    while (propagatedDynamicSupport === true) {
      propagatedDynamicSupport = false;
      for (let i = 0; i < dynamicBoxSupportCandidates.length; i++) {
        const candidate = dynamicBoxSupportCandidates[i];
        const dynamicBody = candidate.dynamicBody;
        const supportBody = candidate.supportBody;
        if (supportMap.get(dynamicBody)?.supportKind === "plane") {
          continue;
        }
        const dynamicState = stateMap.get(dynamicBody);
        const supportState = stateMap.get(supportBody);
        if (!dynamicState || !supportState) {
          continue;
        }
        const supportIsAnchored = supportBody.getSleeping?.() === true || supportMap.has(supportBody);
        if (supportIsAnchored !== true) {
          continue;
        }
        const supportLinearSpeed = this._lengthVec3(supportState.velocity);
        const supportAngularSpeed = this._lengthVec3(supportState.angularVelocity);
        if (supportLinearSpeed > 0.35 || supportAngularSpeed > 18.0) {
          continue;
        }
        const point = Array.isArray(candidate.contact.point)
          ? candidate.contact.point
          : [
            (dynamicState.position[0] + supportState.position[0]) * 0.5,
            (dynamicState.position[1] + supportState.position[1]) * 0.5,
            (dynamicState.position[2] + supportState.position[2]) * 0.5
          ];
        const dynamicVelocityAtPoint = this._getContactPointVelocity(
          dynamicState,
          this._subVec3(point, dynamicState.position)
        );
        const supportVelocityAtPoint = this._getContactPointVelocity(
          supportState,
          this._subVec3(point, supportState.position)
        );
        const relativeVelocity = this._subVec3(dynamicVelocityAtPoint, supportVelocityAtPoint);
        const relativeNormalSpeed = this._dotVec3(relativeVelocity, candidate.supportNormal);
        const relativeTangentVelocity = this._subVec3(
          relativeVelocity,
          this._scaleVec3(candidate.supportNormal, relativeNormalSpeed)
        );
        const relativeTangentSpeed = this._lengthVec3(relativeTangentVelocity);
        if (Math.abs(relativeNormalSpeed) > 0.22 || relativeTangentSpeed > 0.24) {
          continue;
        }
        const previousContactCount = supportMap.get(dynamicBody)?.contacts.length ?? 0;
        const hadSupportBefore = supportMap.has(dynamicBody);
        pushSupportContact(dynamicBody, supportBody, "box", candidate.supportNormal, candidate.contact);
        const currentSupport = supportMap.get(dynamicBody);
        if (hadSupportBefore !== true
            || (currentSupport?.contacts.length ?? 0) > previousContactCount) {
          propagatedDynamicSupport = true;
        }
      }
    }

    for (const [body, support] of supportMap.entries()) {
      const state = stateMap.get(body);
      if (!state) {
        continue;
      }
      const normal = this._normalizeVec3(support.normal, "PhysicsSpace support normal");
      const linearSpeed = this._lengthVec3(state.velocity);
      const angularSpeed = this._lengthVec3(state.angularVelocity);
      const normalVelocity = this._dotVec3(state.velocity, normal);
      const tangentVelocity = this._subVec3(
        state.velocity,
        this._scaleVec3(normal, normalVelocity)
      );
      const tangentSpeed = this._lengthVec3(tangentVelocity);
      const angularNormalSpeed = Math.abs(this._dotVec3(state.angularVelocity, normal));
      const angularTangentVelocity = this._subVec3(
        state.angularVelocity,
        this._scaleVec3(normal, this._dotVec3(state.angularVelocity, normal))
      );
      const angularTangentSpeed = this._lengthVec3(angularTangentVelocity);

      const axes = [
        this._rotateVec3ByQuat([1.0, 0.0, 0.0], state.quat),
        this._rotateVec3ByQuat([0.0, 1.0, 0.0], state.quat),
        this._rotateVec3ByQuat([0.0, 0.0, 1.0], state.quat)
      ];
      const collider = body.getCollider?.();
      const halfExtents = collider?.getHalfExtents?.() ?? [1.0, 1.0, 1.0];
      const minHalfExtent = Math.min(halfExtents[0], halfExtents[1], halfExtents[2]);
      const maxHalfExtent = Math.max(halfExtents[0], halfExtents[1], halfExtents[2]);
      const midHalfExtent = halfExtents[0] + halfExtents[1] + halfExtents[2] - minHalfExtent - maxHalfExtent;
      const aspectRatio = maxHalfExtent / Math.max(1.0e-6, minHalfExtent);
      const halfRange = maxHalfExtent / Math.max(0.05, minHalfExtent);
      let tallestAxisIndex = 0;
      if (halfExtents[1] > halfExtents[tallestAxisIndex]) {
        tallestAxisIndex = 1;
      }
      if (halfExtents[2] > halfExtents[tallestAxisIndex]) {
        tallestAxisIndex = 2;
      }
      const tallAxisAlignment = Math.abs(this._dotVec3(axes[tallestAxisIndex], normal));
      let preferredAxisIndex = -1;
      let preferredAlignment = -Infinity;
      for (let i = 0; i < 3; i++) {
        if (Math.abs(halfExtents[i] - minHalfExtent) > 1.0e-6) {
          continue;
        }
        const alignment = Math.abs(this._dotVec3(axes[i], normal));
        if (alignment > preferredAlignment) {
          preferredAlignment = alignment;
          preferredAxisIndex = i;
        }
      }
      if (preferredAxisIndex < 0) {
        preferredAxisIndex = 0;
      }
      // resting box は「現在たまたま vertical に近い軸」を維持するより、
      // 最小半寸法の軸を床法線へ向けたほうが重心が下がりやすく安定しやすい
      // cube のように半寸法が同じ軸は、現在もっとも床法線へ近い軸を選ぶ
      // beam や plate が直立姿勢を保つ問題を避けるため、
      // 静止安定化では低位置エネルギー側の軸を優先する
      const axis = axes[preferredAxisIndex];
      const targetAxis = this._dotVec3(axis, normal) >= 0.0
        ? [...normal]
        : this._scaleVec3(normal, -1.0);
      const alignDot = Math.max(-1.0, Math.min(1.0, this._dotVec3(axis, targetAxis)));
      const misalignDegree = Math.acos(alignDot) * 180.0 / Math.PI;
      const topHeavyResting = aspectRatio >= 1.6 && tallAxisAlignment >= 0.68;
      const plateLikeResting = (midHalfExtent / Math.max(1.0e-6, minHalfExtent)) >= 2.0
        && (maxHalfExtent / Math.max(1.0e-6, midHalfExtent)) <= 2.0;
      const compactResting = aspectRatio <= 1.25;
      const planeSupportPatch = support.supportKind === "plane"
        && support.contacts.length >= 3;
      const dynamicBoxSupportPatch = support.supportKind === "box"
        && support.contacts.length >= 2;
      const allowAggressiveTopHeavyResting = planeSupportPatch
        && topHeavyResting
        && tangentSpeed <= 0.30
        && Math.abs(normalVelocity) <= 0.30;
      const allowAnisotropicEdgeResting = support.supportKind === "plane"
        && aspectRatio >= 1.6
        && support.contacts.length === 2
        && misalignDegree >= 10.0
        && tangentSpeed <= 0.24
        && Math.abs(normalVelocity) <= 0.24;
      const allowCompactEdgeResting = support.supportKind === "plane"
        && compactResting
        && support.contacts.length <= 2
        && misalignDegree >= 12.0
        && tangentSpeed <= 0.24
        && Math.abs(normalVelocity) <= 0.24;
      const allowDynamicBoxPatchResting = dynamicBoxSupportPatch
        && misalignDegree >= 4.0
        && tangentSpeed <= 0.16
        && Math.abs(normalVelocity) <= 0.16
        && angularTangentSpeed <= 18.0;

      // resting stabilizer は「もう静止へ入ってよい終盤」だけに限定する
      // ただし床 plane 上で end face へ乗った細長い box は、
      // solver の都合で angular speed だけが残り、
      // 低位置エネルギー姿勢へ移る補正そのものが一度も走らない場合がある
      // そのケースだけは support patch が十分あり、速度も低いことを条件に
      // 角速度上限を緩めて姿勢安定化へ進ませる
      if (linearSpeed > 8.0) {
        continue;
      }
      if (angularSpeed > 18.0
          && allowAggressiveTopHeavyResting !== true
          && allowAnisotropicEdgeResting !== true
          && allowCompactEdgeResting !== true
          && allowDynamicBoxPatchResting !== true) {
        continue;
      }

      if (support.contacts.length >= 2) {
        let tangentScale = tangentSpeed <= 0.12 ? 0.0 : 0.55;
        if (allowAggressiveTopHeavyResting === true) {
          tangentScale = tangentSpeed <= 0.18 ? 0.0 : 0.22;
        } else if (allowAnisotropicEdgeResting === true) {
          tangentScale = tangentSpeed <= 0.16 ? 0.0 : 0.24;
        } else if (allowCompactEdgeResting === true) {
          tangentScale = tangentSpeed <= 0.16 ? 0.0 : 0.28;
        } else if (allowDynamicBoxPatchResting === true) {
          tangentScale = tangentSpeed <= 0.10 ? 0.0 : 0.32;
        }
        state.velocity[0] = normal[0] * normalVelocity + tangentVelocity[0] * tangentScale;
        state.velocity[1] = normal[1] * normalVelocity + tangentVelocity[1] * tangentScale;
        state.velocity[2] = normal[2] * normalVelocity + tangentVelocity[2] * tangentScale;
      } else if (tangentSpeed <= 0.8) {
        const tangentScale = tangentSpeed <= 0.12 ? 0.0 : 0.82;
        state.velocity[0] = normal[0] * normalVelocity + tangentVelocity[0] * tangentScale;
        state.velocity[1] = normal[1] * normalVelocity + tangentVelocity[1] * tangentScale;
        state.velocity[2] = normal[2] * normalVelocity + tangentVelocity[2] * tangentScale;
      }

      if (support.contacts.length >= 2 && normalVelocity < 0.0 && tangentSpeed <= 0.18) {
        state.velocity[0] -= normal[0] * normalVelocity;
        state.velocity[1] -= normal[1] * normalVelocity;
        state.velocity[2] -= normal[2] * normalVelocity;
      }

      if (support.contacts.length >= 2 && misalignDegree > 0.5) {
        const correctionQuat = this._buildQuatFromUnitVectors(axis, targetAxis);
        const limitedDegree = Math.min(misalignDegree, halfRange >= 1.5 ? 10.0 : 6.0);
        let blend = misalignDegree <= 8.0
          ? (halfRange >= 1.5 ? 0.34 : 0.28)
          : (halfRange >= 1.5 ? 0.18 : 0.14);
        if (topHeavyResting && tangentSpeed <= 0.18 && Math.abs(normalVelocity) <= 0.18) {
          blend = Math.max(blend, halfRange >= 1.5 ? 0.28 : 0.22);
        }
        if (allowAggressiveTopHeavyResting === true) {
          blend = Math.max(
            blend,
            misalignDegree <= 20.0
              ? (halfRange >= 1.5 ? 0.42 : 0.34)
              : (halfRange >= 1.5 ? 0.26 : 0.20)
          );
        } else if (allowAnisotropicEdgeResting === true) {
          blend = Math.max(
            blend,
            misalignDegree <= 24.0
              ? (halfRange >= 1.5 ? 0.34 : 0.28)
              : (halfRange >= 1.5 ? 0.22 : 0.18)
          );
        } else if (allowCompactEdgeResting === true) {
          blend = Math.max(
            blend,
            misalignDegree <= 24.0 ? 0.28 : 0.20
          );
        } else if (allowDynamicBoxPatchResting === true) {
          blend = Math.max(
            blend,
            misalignDegree <= 18.0 ? 0.22 : 0.14
          );
        }
        const targetQuat = state.quat.clone();
        if (limitedDegree < misalignDegree - 1.0e-6) {
          const correctionAxis = this._crossVec3(axis, targetAxis);
          const limitedQuat = this._buildAxisAngleQuat(correctionAxis, limitedDegree);
          targetQuat.lmulQuat(limitedQuat);
        } else {
          targetQuat.lmulQuat(correctionQuat);
        }
        const blendedQuat = new Quat();
        blendedQuat.slerp(state.quat, targetQuat, blend);
        state.quat = blendedQuat;
        if (topHeavyResting && tangentSpeed <= 0.18 && Math.abs(normalVelocity) <= 0.18) {
          // end face で多点 support を作った細長い box は、
          // 低位置エネルギー姿勢よりも直立姿勢を保持しやすい
          // 高重心条件だけは angular velocity も弱めて、横倒し側へ移りやすくする
          const angularScale = allowAggressiveTopHeavyResting === true ? 0.55 : 0.82;
          state.angularVelocity[0] *= angularScale;
          state.angularVelocity[1] *= angularScale;
          state.angularVelocity[2] *= angularScale;
        } else if (allowAnisotropicEdgeResting === true) {
          // plate や beam の 2 点 edge support は、
          // 床面で線接触したまま角速度が残ると中立平衡っぽく長く残りやすい
          // 多点 patch がなくても低速なら低位置エネルギー姿勢へ移したいので、
          // compact box より少し強めに角速度を減衰する
          state.angularVelocity[0] *= 0.56;
          state.angularVelocity[1] *= 0.56;
          state.angularVelocity[2] *= 0.56;
        } else if (allowCompactEdgeResting === true) {
          // cube の edge / corner balance は support 点数が少なくても
          // 本来は低い面支持へ崩れるため、低速時だけ角速度を強めに減衰する
          state.angularVelocity[0] *= 0.62;
          state.angularVelocity[1] *= 0.62;
          state.angularVelocity[2] *= 0.62;
        } else if (allowDynamicBoxPatchResting === true) {
          // 下側 box がすでに静止 support を持っている低速 stack では、
          // 上側 box も relative motion を早めに落として island 全体で rest へ寄せたい
          // plane ほど強くは固定せず、support patch を壊しにくい範囲でだけ減衰する
          state.angularVelocity[0] *= 0.72;
          state.angularVelocity[1] *= 0.72;
          state.angularVelocity[2] *= 0.72;
        }
      } else if (support.contacts.length === 1
          && misalignDegree > 2.0
          && tangentSpeed <= 0.08
          && Math.abs(normalVelocity) <= 0.10
          && angularTangentSpeed <= 12.0) {
        // 単一点 support のまま低速になった beam / plate は、
        // 離散 step では edge 上で中立平衡っぽく残りやすい
        // 実際には最小半寸法の軸を床法線へ向けたほうが低位置エネルギーなので、
        // 静止終盤だけ弱い姿勢バイアスを掛けて横倒し側へ寄せる
        const correctionQuat = this._buildQuatFromUnitVectors(axis, targetAxis);
        const targetQuat = state.quat.clone();
        targetQuat.lmulQuat(correctionQuat);
        const blendedQuat = new Quat();
        blendedQuat.slerp(state.quat, targetQuat, 0.08);
        state.quat = blendedQuat;
        const angularScale = misalignDegree <= 12.0 ? 0.82 : 0.90;
        const angularNormalVelocity = this._scaleVec3(normal, this._dotVec3(state.angularVelocity, normal));
        state.angularVelocity[0] = angularNormalVelocity[0] + angularTangentVelocity[0] * angularScale;
        state.angularVelocity[1] = angularNormalVelocity[1] + angularTangentVelocity[1] * angularScale;
        state.angularVelocity[2] = angularNormalVelocity[2] + angularTangentVelocity[2] * angularScale;
      }

      if (support.contacts.length >= 2) {
        let angularScale = misalignDegree <= 8.0 ? 0.68 : 0.8;
        if (allowAggressiveTopHeavyResting === true) {
          angularScale = misalignDegree <= 12.0 ? 0.38 : 0.55;
        } else if (allowAnisotropicEdgeResting === true) {
          angularScale = misalignDegree <= 20.0 ? 0.42 : 0.54;
        } else if (allowCompactEdgeResting === true) {
          angularScale = misalignDegree <= 20.0 ? 0.46 : 0.60;
        } else if (allowDynamicBoxPatchResting === true) {
          angularScale = misalignDegree <= 16.0 ? 0.58 : 0.70;
        }
        const angularNormalVelocity = this._scaleVec3(normal, this._dotVec3(state.angularVelocity, normal));
        state.angularVelocity[0] = angularNormalVelocity[0] + angularTangentVelocity[0] * angularScale;
        state.angularVelocity[1] = angularNormalVelocity[1] + angularTangentVelocity[1] * angularScale;
        state.angularVelocity[2] = angularNormalVelocity[2] + angularTangentVelocity[2] * angularScale;
      }

      let snappedToRest = false;
      if (plateLikeResting === true
          && support.contacts.length >= 2
          && misalignDegree <= 6.0
          && tangentSpeed <= 0.035
          && Math.abs(normalVelocity) <= 0.08
          && angularTangentSpeed <= 12.0
          && angularNormalSpeed <= 2.5) {
        // 面支持へほぼ落ち切っているのに、床法線まわり以外の残留角速度だけで
        // だらだら回り続けるケースをここで止める
        // rare case の plate / beam は高さがほぼ正しくても視覚的には「まだ踊る」ため、
        // face rest に十分近い条件では早めに休ませる
        const snappedQuat = state.quat.clone();
        snappedQuat.lmulQuat(this._buildQuatFromUnitVectors(axis, targetAxis));
        state.quat = snappedQuat;
        snappedToRest = true;
        state.velocity[0] = 0.0;
        state.velocity[1] = 0.0;
        state.velocity[2] = 0.0;
        state.angularVelocity[0] = 0.0;
        state.angularVelocity[1] = 0.0;
        state.angularVelocity[2] = 0.0;
      }
      if (support.contacts.length >= 2
          && misalignDegree <= 4.0
          && tangentSpeed <= 0.08
          && Math.abs(normalVelocity) <= 0.08
          && angularTangentSpeed <= 3.0
          && angularNormalSpeed <= this.sleepAngularThreshold) {
        const snappedQuat = state.quat.clone();
        snappedQuat.lmulQuat(this._buildQuatFromUnitVectors(axis, targetAxis));
        state.quat = snappedQuat;
        snappedToRest = true;
        state.velocity[0] = 0.0;
        state.velocity[1] = 0.0;
        state.velocity[2] = 0.0;
        state.angularVelocity[0] = 0.0;
        state.angularVelocity[1] = 0.0;
        state.angularVelocity[2] = 0.0;
      }
      if (misalignDegree <= 8.0
          && tangentSpeed <= 0.02
          && Math.abs(normalVelocity) <= 0.18
          && angularTangentSpeed <= 0.35
          && angularNormalSpeed <= this.sleepAngularThreshold) {
        const snappedQuat = state.quat.clone();
        snappedQuat.lmulQuat(this._buildQuatFromUnitVectors(axis, targetAxis));
        state.quat = snappedQuat;
        snappedToRest = true;
        state.velocity[0] = 0.0;
        state.velocity[1] = 0.0;
        state.velocity[2] = 0.0;
        state.angularVelocity[0] = 0.0;
        state.angularVelocity[1] = 0.0;
        state.angularVelocity[2] = 0.0;
      }

      const planeCollider = support.supportBody?.getCollider?.();
      if (planeCollider?.type === "plane") {
        const plane = planeCollider.getWorldInfo(
          support.supportBody.getPosition?.() ?? [0.0, 0.0, 0.0]
        );
        const vertices = body.getCollider()?.getVertices?.(state.position, state.quat) ?? [];
        let minDistance = Infinity;
        for (let i = 0; i < vertices.length; i++) {
          const vertexToPlane = this._subVec3(vertices[i], plane.point);
          const distance = this._dotVec3(vertexToPlane, plane.normal);
          if (distance < minDistance) {
            minDistance = distance;
          }
        }
        if (minDistance < 0.0
            || snappedToRest === true
            || (support.contacts.length >= 2
              && minDistance <= 0.05
              && tangentSpeed <= 0.08
              && Math.abs(normalVelocity) <= 0.18)) {
          state.position[0] -= plane.normal[0] * minDistance;
          state.position[1] -= plane.normal[1] * minDistance;
          state.position[2] -= plane.normal[2] * minDistance;
          if (normalVelocity < 0.0) {
            state.velocity[0] -= normal[0] * normalVelocity;
            state.velocity[1] -= normal[1] * normalVelocity;
            state.velocity[2] -= normal[2] * normalVelocity;
          }
        }
      }
    }
  }

  // sleep 判定は「この step で法線 impulse を打ったか」ではなく、
  // 最終的に support contact が存在するかで見る方が安定する
  // 静止終盤では relative velocity がほぼ 0 になり、
  // _resolveContactPoint 内の touched フラグ更新だけだと support を取りこぼしやすい
  _markSleepSupportFromContacts(stateMap, contacts) {
    if (!Array.isArray(contacts)) {
      return;
    }
    for (let i = 0; i < contacts.length; i++) {
      const contact = contacts[i];
      if (this._isTriggerContact(contact)) {
        continue;
      }
      if (!Array.isArray(contact.normal) || !this._isSupportNormal(contact.normal)) {
        continue;
      }
      const bodyA = contact.bodyA;
      const bodyB = contact.bodyB;
      const stateA = stateMap.get(bodyA);
      const stateB = stateMap.get(bodyB);
      const invMassA = this._getSolverInverseMass(bodyA);
      const invMassB = this._getSolverInverseMass(bodyB);
      if (invMassA > 0.0 && invMassB === 0.0 && stateA) {
        stateA.touchedStatic = true;
      }
      if (invMassB > 0.0 && invMassA === 0.0 && stateB) {
        stateB.touchedStatic = true;
      }
      if (invMassA > 0.0 && invMassB > 0.0) {
        if (stateA) {
          stateA.touchedDynamicSupport = true;
        }
        if (stateB) {
          stateB.touchedDynamicSupport = true;
        }
      }
    }
  }

  // gravity を設定する
  setGravity(gravity) {
    this.gravity = this._readOptionalVec3(gravity, "PhysicsSpace gravity", [0.0, -9.8, 0.0]);
    return this;
  }

  // gravity を返す
  getGravity() {
    return [...this.gravity];
  }

  // fixed timestep を設定する
  setFixedTimeStepMs(value) {
    this.fixedTimeStepMs = util.readFiniteNumber(value, "PhysicsSpace fixedTimeStepMs", {
      minExclusive: 0.0
    });
    this.accumulatorMs = Math.min(this.accumulatorMs, this.fixedTimeStepMs * this.maxSubSteps);
    return this;
  }

  // fixed timestep を返す
  getFixedTimeStepMs() {
    return this.fixedTimeStepMs;
  }

  // 1 frame で許す最大 sub step 数を設定する
  setMaxSubSteps(value) {
    this.maxSubSteps = util.readFiniteNumber(value, "PhysicsSpace maxSubSteps", {
      integer: true,
      min: 1
    });
    this.accumulatorMs = Math.min(this.accumulatorMs, this.fixedTimeStepMs * this.maxSubSteps);
    return this;
  }

  // 1 frame で許す最大 sub step 数を返す
  getMaxSubSteps() {
    return this.maxSubSteps;
  }

  // contact solver の反復回数を設定する
  setSolverIterations(value) {
    this.solverIterations = util.readFiniteNumber(value, "PhysicsSpace solverIterations", {
      integer: true,
      min: 1
    });
    return this;
  }

  // contact solver の反復回数を返す
  getSolverIterations() {
    return this.solverIterations;
  }

  // broadphase mode を設定する
  setBroadphaseMode(mode) {
    this.broadphaseMode = util.readOptionalEnum(
      mode,
      "PhysicsSpace broadphaseMode",
      this.broadphaseMode,
      ["bruteForce", "sweepAabb"]
    );
    return this;
  }

  // broadphase mode を返す
  getBroadphaseMode() {
    return this.broadphaseMode;
  }

  // 既定反発係数を設定する
  setDefaultRestitution(value) {
    this.defaultRestitution = util.readFiniteNumber(value, "PhysicsSpace defaultRestitution", {
      min: 0.0,
      max: 1.0
    });
    return this;
  }

  // 既定反発係数を返す
  getDefaultRestitution() {
    return this.defaultRestitution;
  }

  // 既定摩擦係数を設定する
  setDefaultFriction(value) {
    this.defaultFriction = util.readFiniteNumber(value, "PhysicsSpace defaultFriction", {
      min: 0.0
    });
    return this;
  }

  // 既定摩擦係数を返す
  getDefaultFriction() {
    return this.defaultFriction;
  }

  // sleep に入れる速度しきい値を設定する
  setSleepLinearThreshold(value) {
    this.sleepLinearThreshold = util.readFiniteNumber(value, "PhysicsSpace sleepLinearThreshold", {
      min: 0.0
    });
    return this;
  }

  // sleep に入れる速度しきい値を返す
  getSleepLinearThreshold() {
    return this.sleepLinearThreshold;
  }

  // sleep に入れる角速度しきい値を設定する
  setSleepAngularThreshold(value) {
    this.sleepAngularThreshold = util.readFiniteNumber(value, "PhysicsSpace sleepAngularThreshold", {
      min: 0.0
    });
    return this;
  }

  // sleep に入れる角速度しきい値を返す
  getSleepAngularThreshold() {
    return this.sleepAngularThreshold;
  }

  // sleep に入るまでに必要な連続低速 contact step 数を設定する
  setSleepStepsThreshold(value) {
    this.sleepStepsThreshold = util.readFiniteNumber(value, "PhysicsSpace sleepStepsThreshold", {
      integer: true,
      min: 1
    });
    return this;
  }

  // sleep に入るまでに必要な連続低速 contact step 数を返す
  getSleepStepsThreshold() {
    return this.sleepStepsThreshold;
  }

  // body の sleep 候補 step 数を返す
  _getSleepStepCount(body) {
    return this.sleepStepMap.get(body) ?? 0;
  }

  // body の sleep 候補 step 数を進める
  _incrementSleepStepCount(body) {
    const nextCount = this._getSleepStepCount(body) + 1;
    this.sleepStepMap.set(body, nextCount);
    return nextCount;
  }

  // body の sleep 候補 step 数をリセットする
  _resetSleepStepCount(body) {
    this.sleepStepMap.delete(body);
  }

  // `_getSleepIslandKey`は受け取った値を処理し、後続処理で利用する状態または結果を生成する
  _getSleepIslandKey(island) {
    const ids = island.map((body) => this._getBodyId(body)).sort((a, b) => a - b);
    return ids.join(":");
  }

  _getSleepIslandStepCount(islandKey) {
    return this.sleepIslandStepMap.get(islandKey) ?? 0;
  }

  // `_incrementSleepIslandStepCount`は受け取った値を処理し、後続処理で利用する状態または結果を生成する
  _incrementSleepIslandStepCount(islandKey) {
    const nextCount = this._getSleepIslandStepCount(islandKey) + 1;
    this.sleepIslandStepMap.set(islandKey, nextCount);
    return nextCount;
  }

  _resetSleepIslandStepCount(islandKey) {
    this.sleepIslandStepMap.delete(islandKey);
  }

  // active な body 同士で、sleep island を集めてisland を返す
  _collectDynamicSleepIslands(activeBodies, contacts) {
    const adjacency = new Map();
    const activeSet = new Set(activeBodies);
    for (let i = 0; i < activeBodies.length; i++) {
      adjacency.set(activeBodies[i], []);
    }
    for (let i = 0; i < contacts.length; i++) {
      const contact = contacts[i];
      if (this._isTriggerContact(contact)) {
        continue;
      }
      const bodyA = contact.bodyA;
      const bodyB = contact.bodyB;
      if (!activeSet.has(bodyA) || !activeSet.has(bodyB)) {
        continue;
      }
      const normal = Array.isArray(contact.normal) ? contact.normal : null;
      if (!normal) {
        continue;
      }
      const supportsAFromB = this._isSupportNormal(normal);
      const supportsBFromA = this._isSupportNormal(this._scaleVec3(normal, -1.0));
      if (!supportsAFromB && !supportsBFromA) {
        continue;
      }
      adjacency.get(bodyA)?.push(bodyB);
      adjacency.get(bodyB)?.push(bodyA);
    }

    // 幅優先探索で隣接する active body をたどり、sleep island を集める
    const islands = [];
    const visited = new Set();
    for (let i = 0; i < activeBodies.length; i++) {
      const start = activeBodies[i];
      if (visited.has(start)) {
        continue;
      }
      const stack = [start];
      visited.add(start);
      const island = [];
      while (stack.length > 0) {
        const body = stack.pop();
        island.push(body);
        const neighbors = adjacency.get(body) ?? [];
        for (let j = 0; j < neighbors.length; j++) {
          const next = neighbors[j];
          if (visited.has(next)) {
            continue;
          }
          visited.add(next);
          stack.push(next);
        }
      }
      islands.push(island);
    }
    return islands;
  }

  // body が sleep に入れるか
  _canBodyEnterSleep(body, state) {
    if (!state) {
      return false;
    }
    if (!(state.touchedStatic || state.touchedDynamicSupport)) {
      return false;
    }
    return this._lengthVec3(state.velocity) <= this.sleepLinearThreshold
      && this._lengthVec3(state.angularVelocity) <= this.sleepAngularThreshold;
  }

  // sleep island を集めて、sleep に入れる body を眠らせる
  _applySleepIslands(activeBodies, stateMap, contacts) {
    const eligibleBodies = [];
    for (let i = 0; i < activeBodies.length; i++) {
      const body = activeBodies[i];
      if (this._canBodyEnterSleep(body, stateMap.get(body))) {
        eligibleBodies.push(body);
      } else {
        this._resetSleepStepCount(body);
      }
    }
    const islands = this._collectDynamicSleepIslands(eligibleBodies, contacts);
    const sleepingBodies = new Set();
    const debugIslands = [];
    const activeIslandKeys = new Set();
    for (let i = 0; i < islands.length; i++) {
      const island = islands[i];
      const islandKey = this._getSleepIslandKey(island);
      activeIslandKeys.add(islandKey);
      let islandSleepStepCount = 0;
      let maxLinearSpeed = 0.0;
      let maxAngularSpeed = 0.0;
      let maxPenetration = 0.0;
      for (let j = 0; j < island.length; j++) {
        const state = stateMap.get(island[j]);
        if (state) {
          maxLinearSpeed = Math.max(maxLinearSpeed, this._lengthVec3(state.velocity));
          maxAngularSpeed = Math.max(maxAngularSpeed, this._lengthVec3(state.angularVelocity));
        }
      }
      for (let j = 0; j < contacts.length; j++) {
        const contact = contacts[j];
        if (!island.includes(contact.bodyA) && !island.includes(contact.bodyB)) {
          continue;
        }
        maxPenetration = Math.max(
          maxPenetration,
          util.readOptionalFiniteNumber(contact?.penetration, "PhysicsSpace contact penetration", 0.0)
        );
      }
      islandSleepStepCount = this._incrementSleepIslandStepCount(islandKey);
      const shouldSleep = islandSleepStepCount >= this.sleepStepsThreshold;
      if (islandSleepStepCount < this.sleepStepsThreshold) {
        debugIslands.push({
          islandId: i + 1,
          state: "candidate",
          bodyIds: island.map((body) => this._getBodyId(body)),
          bodyNames: island.map((body) => body.getName?.() ?? `body_${this._getBodyId(body)}`),
          bodyCount: island.length,
          minSleepStepCount: islandSleepStepCount,
          maxLinearSpeed,
          maxAngularSpeed,
          maxPenetration,
          blockReason: "sleep_steps"
        });
        continue;
      }
      for (let j = 0; j < island.length; j++) {
        const body = island[j];
        body.stopMotion();
        this._resetSleepStepCount(body);
        if (body.getAllowSleep()) {
          body.sleep();
          sleepingBodies.add(body);
        }
      }
      this._resetSleepIslandStepCount(islandKey);
      debugIslands.push({
        islandId: i + 1,
        state: shouldSleep ? "sleeping" : "candidate",
        bodyIds: island.map((body) => this._getBodyId(body)),
        bodyNames: island.map((body) => body.getName?.() ?? `body_${this._getBodyId(body)}`),
        bodyCount: island.length,
        minSleepStepCount: islandSleepStepCount,
        maxLinearSpeed,
        maxAngularSpeed,
        maxPenetration,
        blockReason: "none"
      });
    }
    for (const islandKey of [...this.sleepIslandStepMap.keys()]) {
      if (!activeIslandKeys.has(islandKey)) {
        this._resetSleepIslandStepCount(islandKey);
      }
    }

    const eligibleSet = new Set(eligibleBodies);
    const supportIslands = this._collectDynamicSleepIslands(activeBodies, contacts);
    for (let i = 0; i < supportIslands.length; i++) {
      const island = supportIslands[i];
      let hasIneligible = false;
      let maxLinearSpeed = 0.0;
      let maxAngularSpeed = 0.0;
      let maxPenetration = 0.0;
      let blockReason = "mixed_state";
      for (let j = 0; j < island.length; j++) {
        const body = island[j];
        const state = stateMap.get(body);
        if (state) {
          maxLinearSpeed = Math.max(maxLinearSpeed, this._lengthVec3(state.velocity));
          maxAngularSpeed = Math.max(maxAngularSpeed, this._lengthVec3(state.angularVelocity));
        }
        if (!eligibleSet.has(body)) {
          hasIneligible = true;
          if (!(state?.touchedStatic || state?.touchedDynamicSupport)) {
            blockReason = "no_support";
          } else if (state && this._lengthVec3(state.velocity) > this.sleepLinearThreshold) {
            blockReason = "linear_speed";
          } else if (state && this._lengthVec3(state.angularVelocity) > this.sleepAngularThreshold) {
            blockReason = "angular_speed";
          }
        }
      }
      for (let j = 0; j < contacts.length; j++) {
        const contact = contacts[j];
        if (!island.includes(contact.bodyA) && !island.includes(contact.bodyB)) {
          continue;
        }
        maxPenetration = Math.max(
          maxPenetration,
          util.readOptionalFiniteNumber(contact?.penetration, "PhysicsSpace contact penetration", 0.0)
        );
      }
      if (!hasIneligible) {
        continue;
      }
      debugIslands.push({
        islandId: debugIslands.length + 1,
        state: "awake",
        bodyIds: island.map((body) => this._getBodyId(body)),
        bodyNames: island.map((body) => body.getName?.() ?? `body_${this._getBodyId(body)}`),
        bodyCount: island.length,
        minSleepStepCount: 0,
        maxLinearSpeed,
        maxAngularSpeed,
        maxPenetration,
        blockReason
      });
    }
    this.lastSleepIslands = debugIslands;
    return sleepingBodies;
  }

  // accumulator を明示的にリセットする
  resetAccumulator() {
    this.accumulatorMs = 0.0;
    return this;
  }

  // 現在の accumulator を返す
  getAccumulatorMs() {
    return this.accumulatorMs;
  }

  // body を physics space へ登録する
  addBody(body) {
    if (!body || typeof body !== "object") {
      throw new Error("PhysicsSpace.addBody() requires a body object");
    }
    if (this.bodies.includes(body)) {
      return body;
    }
    if (body.getPhysicsSpace?.() !== null && body.getPhysicsSpace?.() !== undefined && body.getPhysicsSpace() !== this) {
      throw new Error("PhysicsSpace.addBody() body already belongs to another physics space");
    }
    this.bodies.push(body);
    body.setPhysicsSpace?.(this);
    return body;
  }

  // body を physics space から外す
  removeBody(body) {
    for (let i = this.bodies.length - 1; i >= 0; i--) {
      if (this.bodies[i] === body) {
        this.bodies.splice(i, 1);
      }
    }
    if (body?.getPhysicsSpace?.() === this) {
      body.setPhysicsSpace(null);
    }
    return body;
  }

  // 登録 body 一覧を返す
  getBodies() {
    return [...this.bodies];
  }

  // 直近 stepFixed で解決した contact 一覧を返す
  getLastContacts() {
    return this.lastContacts.map((contact) => this._cloneContact(contact));
  }

  // 直近 stepFixed で解決した manifold 一覧を返す
  getLastManifolds() {
    return this.lastManifolds.map((manifold) => this._cloneManifold(manifold));
  }

  // 直近 stepFixed の sleep island debug 情報を返す
  getLastSleepIslands() {
    return this.lastSleepIslands.map((island) => ({
      islandId: island.islandId,
      state: island.state,
      bodyIds: [...island.bodyIds],
      bodyNames: [...island.bodyNames],
      bodyCount: island.bodyCount,
      minSleepStepCount: island.minSleepStepCount,
      maxLinearSpeed: island.maxLinearSpeed,
      maxAngularSpeed: island.maxAngularSpeed,
      maxPenetration: island.maxPenetration,
      blockReason: island.blockReason
    }));
  }

  // 直近 stepFixed の begin / stay / end contact を返す
  getLastContactEvents() {
    return {
      begin: this.lastContactEvents.begin.map((contact) => this._cloneContact(contact)),
      stay: this.lastContactEvents.stay.map((contact) => this._cloneContact(contact)),
      end: this.lastContactEvents.end.map((contact) => this._cloneContact(contact))
    };
  }

  // 物理 collider に対して raycast を実行する
  raycast(origin, dir, options = {}) {
    const rayOrigin = this._readVec3(origin, "PhysicsSpace raycast origin");
    const rayDir = this._normalizeVec3(
      this._readVec3(dir, "PhysicsSpace raycast dir"),
      "PhysicsSpace raycast dir"
    );
    const query = this._readRaycastOptions(options);
    this._assertQueryFilter(query.filter, "PhysicsSpace raycast");
    const hits = this._collectRayHits(rayOrigin, rayDir, query);
    return hits.length > 0 ? hits[0] : null;
  }

  // 物理 collider に対して raycast の全 hit を距離順で返す
  raycastAll(origin, dir, options = {}) {
    const rayOrigin = this._readVec3(origin, "PhysicsSpace raycastAll origin");
    const rayDir = this._normalizeVec3(
      this._readVec3(dir, "PhysicsSpace raycastAll dir"),
      "PhysicsSpace raycastAll dir"
    );
    const query = this._readRaycastOptions(options);
    this._assertQueryFilter(query.filter, "PhysicsSpace raycastAll");
    return this._collectRayHits(rayOrigin, rayDir, query);
  }

  // physics space AABB と重なる collider 一覧を返す
  // 現在は AABB を返せる collider が結果へ参加し、plane のように AABB を持たない型は自然に除外される
  queryAabb(min, max, options = {}) {
    const queryMin = this._readVec3(min, "PhysicsSpace queryAabb min");
    const queryMax = this._readVec3(max, "PhysicsSpace queryAabb max");
    if (queryMin[0] > queryMax[0] || queryMin[1] > queryMax[1] || queryMin[2] > queryMax[2]) {
      throw new Error("PhysicsSpace queryAabb min must be <= max on every axis");
    }
    const query = this._readQueryAabbOptions(options);
    this._assertQueryFilter(query.filter, "PhysicsSpace queryAabb");

    const hits = [];
    const entries = this._collectCurrentQueryEntries(query);
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (!entry.collider.overlapsAabb(entry.position, queryMin, queryMax, entry.quat)) {
        continue;
      }
      const aabb = entry.collider.getAabb(entry.position, entry.quat);
      if (aabb === null) {
        continue;
      }
      hits.push({
        body: entry.body,
        min: [...aabb.min],
        max: [...aabb.max]
      });
    }
    return hits;
  }

  // sphere と重なる collider 一覧を返す
  overlapSphere(center, radius, options = {}) {
    const sphereCenter = this._readVec3(center, "PhysicsSpace overlapSphere center");
    const sphereRadius = util.readFiniteNumber(radius, "PhysicsSpace overlapSphere radius", {
      min: 0.0
    });
    const query = this._readOverlapSphereOptions(options);
    this._assertQueryFilter(query.filter, "PhysicsSpace overlapSphere");

    const hits = [];
    const entries = this._collectCurrentQueryEntries(query);
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const overlap = entry.collider.overlapSphere(entry.position, sphereCenter, sphereRadius, entry.quat);
      if (overlap === null) {
        continue;
      }
      hits.push({
        body: entry.body,
        closestPoint: [...overlap.closestPoint],
        distance: overlap.distance
      });
    }
    return hits;
  }

  // begin contact listener を登録する
  onBeginContact(listener) {
    return this._addContactListener(
      this.beginContactListeners,
      listener,
      "PhysicsSpace.onBeginContact() listener"
    );
  }

  // stay contact listener を登録する
  onStayContact(listener) {
    return this._addContactListener(
      this.stayContactListeners,
      listener,
      "PhysicsSpace.onStayContact() listener"
    );
  }

  // end contact listener を登録する
  onEndContact(listener) {
    return this._addContactListener(
      this.endContactListeners,
      listener,
      "PhysicsSpace.onEndContact() listener"
    );
  }

  // begin contact listener を解除する
  offBeginContact(listener) {
    return this._removeContactListener(
      this.beginContactListeners,
      listener,
      "PhysicsSpace.offBeginContact() listener"
    );
  }

  // stay contact listener を解除する
  offStayContact(listener) {
    return this._removeContactListener(
      this.stayContactListeners,
      listener,
      "PhysicsSpace.offStayContact() listener"
    );
  }

  // end contact listener を解除する
  offEndContact(listener) {
    return this._removeContactListener(
      this.endContactListeners,
      listener,
      "PhysicsSpace.offEndContact() listener"
    );
  }

  // 可変 delta を受け取り fixed timestep へ分配する
  // 戻り値は実際に進めた fixed step 数
  step(deltaMs) {
    const numericDeltaMs = util.readFiniteNumber(deltaMs, "PhysicsSpace deltaMs", {
      min: 0.0
    });
    this.accumulatorMs = Math.min(
      this.accumulatorMs + numericDeltaMs,
      this.fixedTimeStepMs * this.maxSubSteps
    );
    let stepCount = 0;
    while (this.accumulatorMs >= this.fixedTimeStepMs && stepCount < this.maxSubSteps) {
      this.stepFixed(this.fixedTimeStepMs / 1000.0);
      this.accumulatorMs -= this.fixedTimeStepMs;
      stepCount += 1;
    }
    return stepCount;
  }

  // 1 回分の fixed step を進める
  stepFixed(dtSec) {
    const numericDtSec = util.readFiniteNumber(dtSec, "PhysicsSpace dtSec", {
      minExclusive: 0.0
    });
    const stateMap = new Map();
    const solvedContacts = [];

    for (let i = 0; i < this.bodies.length; i++) {
      const body = this.bodies[i];
      const state = {
        position: this._cloneVec3(body.getPosition()),
        velocity: this._cloneVec3(body.getLinearVelocity()),
        quat: body.getQuat(),
        angularVelocity: this._cloneVec3(body.getAngularVelocity()),
        touchedStatic: false,
        touchedDynamicSupport: false
      };
      stateMap.set(body, state);

      if (!body.isDynamic() || body.getSleeping() === true) {
        continue;
      }

      const force = body.getForce();
      const torque = body.getTorque();
      state.velocity[0] += (this.gravity[0] * body.getGravityScale() + force[0] * body.getInverseMass()) * numericDtSec;
      state.velocity[1] += (this.gravity[1] * body.getGravityScale() + force[1] * body.getInverseMass()) * numericDtSec;
      state.velocity[2] += (this.gravity[2] * body.getGravityScale() + force[2] * body.getInverseMass()) * numericDtSec;

      if (body.getFixedRotation() !== true) {
        // torque は線形質量ではなく慣性で回りやすさが決まる
        // world-space torque を現在姿勢の inverse inertia へ通して、
        // 角加速度として angularVelocity へ積分する
        const angularAccelerationRad = this._applyWorldInverseInertia(body, state.quat, torque);
        const angularAccelerationDeg = this._radVec3ToDeg(angularAccelerationRad);
        state.angularVelocity[0] += angularAccelerationDeg[0] * numericDtSec;
        state.angularVelocity[1] += angularAccelerationDeg[1] * numericDtSec;
        state.angularVelocity[2] += angularAccelerationDeg[2] * numericDtSec;
      } else {
        state.angularVelocity[0] = 0.0;
        state.angularVelocity[1] = 0.0;
        state.angularVelocity[2] = 0.0;
      }

      const linearDampingScale = Math.max(0.0, 1.0 - body.getLinearDamping() * numericDtSec);
      state.velocity[0] *= linearDampingScale;
      state.velocity[1] *= linearDampingScale;
      state.velocity[2] *= linearDampingScale;

      const angularDampingScale = Math.max(0.0, 1.0 - body.getAngularDamping() * numericDtSec);
      state.angularVelocity[0] *= angularDampingScale;
      state.angularVelocity[1] *= angularDampingScale;
      state.angularVelocity[2] *= angularDampingScale;

      state.position[0] += state.velocity[0] * numericDtSec;
      state.position[1] += state.velocity[1] * numericDtSec;
      state.position[2] += state.velocity[2] * numericDtSec;
      // BoxCollider など quaternion 姿勢を読む collider のために、
      // 見た目と物理問い合わせの姿勢を同じ主状態として進める
      const deltaQuat = this._buildAngularStepQuat(state.angularVelocity, numericDtSec);
      state.quat.mulQuat(deltaQuat);
      state.quat.normalize();
    }

    let latestManifolds = [];
    for (let iter = 0; iter < this.solverIterations; iter++) {
      // 反復ごとに broadphase 候補を作り直し、その時点の state から narrowphase を再評価する
      const manifolds = this._collectManifolds(stateMap);
      latestManifolds = manifolds;
      if (iter === 0) {
        this._hydrateManifoldsFromCache(manifolds);
        this._applyWarmStartToManifolds(manifolds, stateMap);
      }
      for (let i = 0; i < manifolds.length; i++) {
        const flatContacts = this._flattenManifoldContacts(manifolds[i]);
        for (let j = 0; j < flatContacts.length; j++) {
          solvedContacts.push(flatContacts[j]);
        }
      }
      for (let i = 0; i < manifolds.length; i++) {
        this._resolveManifold(manifolds[i], stateMap);
      }
    }
    this._stabilizeRestingBoxes(stateMap, solvedContacts);
    this._markSleepSupportFromContacts(stateMap, solvedContacts);
    this.lastContacts = solvedContacts;
    this.lastManifolds = latestManifolds.map((manifold) => this._cloneManifold(manifold));
    const currentContactMap = this._buildContactMap(solvedContacts);
    this.lastContactEvents = this._buildContactEvents(currentContactMap);
    this._emitContactEvents(this.lastContactEvents);
    this.previousContactMap = currentContactMap;
    this.previousManifoldMap = this._buildManifoldCache(latestManifolds);

    const activeDynamicBodies = [];
    for (let i = 0; i < this.bodies.length; i++) {
      const body = this.bodies[i];
      const state = stateMap.get(body);
      body.clearAccumulators?.();

      if (!body.isDynamic()) {
        continue;
      }
      if (body.getSleeping() === true) {
        continue;
      }

      activeDynamicBodies.push(body);

      body.syncNodeFromPhysics(state.position, {
        quat: state.quat
      });
      body.setLinearVelocityVec(state.velocity);
      body.setAngularVelocityVec(state.angularVelocity);
    }
    const sleepingBodies = this._applySleepIslands(activeDynamicBodies, stateMap, solvedContacts);
    return stateMap;
  }

};  // class PhysicsSpace
