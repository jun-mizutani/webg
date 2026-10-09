// ---------------------------------------------
//  PhysicsSpace.js  2026/09/13
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import util from "./util.js";
import CpuBoxPhysicsAdapter from "./CpuBoxPhysicsAdapter.js";
import * as physicsMath from "./PhysicsMath.js";
import { stepPhysicsSpace } from "./PhysicsStepPipeline.js";
import * as physicsContactDispatcher from "./PhysicsContactDispatcher.js";
import * as physicsQueries from "./PhysicsQueries.js";
import * as physicsEvents from "./PhysicsEvents.js";
import * as physicsBodyRegistry from "./PhysicsBodyRegistry.js";
import * as cpuPhysicsSolver from "./CpuPhysicsSolver.js";
import * as physicsJointPipeline from "./PhysicsJointPipeline.js";
import { initializePhysicsSpaceSettings } from "./PhysicsSettings.js";

export default class PhysicsSpace {

  static DEG_TO_RAD = Math.PI / 180.0;
  static RAD_TO_DEG = 180.0 / Math.PI;

  // 固定 timestep と body 一覧を持つ物理空間を生成する
  constructor(options = {}) {
    // PhysicsSpaceは複数のPhysicsNodeをまとめて進める公開入口です
    // 重力、固定step、接触、sleep、Jointの設定値は専用初期化関数で検証します
    initializePhysicsSpaceSettings(this, options);
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
    // 初回の接触探索を終えるまで、全bodyが初期sleep指定でも通常の接触確認を行います
    // body登録やJoint変更で保存済みcontactが古くなった場合も次のfixed stepで再評価します
    this.sleepFastPathReady = false;
    this.bodyIdMap = new WeakMap();
    this.sleepStepMap = new WeakMap();
    this.sleepIslandStepMap = new Map();
    this.nextBodyId = 1;
    this.joints = [];
    this.lastJointDiagnostics = [];
    // Compute方式のBox wake判定が、次stepで接触する相手bodyを保持します
    // step開始時にsleep bodyをwakeしても、相手snapshotへawake後の速度を混ぜないために使います
    this.predictedWakeOtherMap = new Map();
    this.lastPredictedWakeBodyIds = [];
    // PhysicsSpace公開APIと検証済みCPU Box solverのNode同期をadapterへ分けます
    // body追加・削除時のsolver再生成もadapterへ集め、Space本体は公開stepの順序を保持します
    this.cpuBoxPhysicsAdapter = new CpuBoxPhysicsAdapter(this);
  }

  // vec3 optionを読み、未指定時は呼出側の既定値を返す
  _readOptionalVec3(value, name, fallback) {
    return physicsMath.readOptionalVec3(value, name, fallback);
  }

  // 必須の vec3 値を読む
  _readVec3(value, name) {
    return physicsMath.readVec3(value, name);
  }

  // vec3 を複製する
  _cloneVec3(vec) {
    return physicsMath.cloneVec3(vec);
  }

  // CPUのdegree/sec角速度から有限回転を作り、Δqを現在姿勢へ左から掛ける
  // Box、Sphere、Capsuleの通常CPU経路で同じΔq ⊗ qの更新規則を共有する
  _buildComputeStepQuat(orientation, angularVelocity, dtSec) {
    return physicsMath.buildComputeStepQuat(orientation, angularVelocity, dtSec);
  }

  // contact 情報を public getter 用に複製する
  _cloneContact(contact) {
    return physicsMath.cloneContact(contact);
  }

  // manifold をキャッシュ用に複製する
  _cloneManifold(manifold) {
    return physicsMath.cloneManifold(manifold);
  }

  // vec3 の長さを返す
  _lengthVec3(vec) {
    return physicsMath.lengthVec3(vec);
  }

  // vec3 の内積を返す
  _dotVec3(a, b) {
    return physicsMath.dotVec3(a, b);
  }

  // vec3 を指定倍率で掛ける
  _scaleVec3(vec, scale) {
    return physicsMath.scaleVec3(vec, scale);
  }

  // sleep 判定や支持判定では、world Y 固定ではなく重力の逆向きを基準にする
  // 積み上がった box 同士は接触面が斜めになりやすく、
  // normal.y >= 0.5 だけだと「実際には支えられている contact」を support と見なせない
  _getUpAxisFromGravity() {
    return physicsMath.getUpAxisFromGravity(this.gravity);
  }

  // `_isSupportNormal`は入力条件や交差状態を比較し、判定結果を返す
  _isSupportNormal(normal, threshold = 0.25) {
    return physicsMath.isSupportNormal(this.gravity, normal, threshold);
  }

  // degree/sec ベースの角速度を rad/sec へ変換する
  _degVec3ToRad(vec) {
    return physicsMath.degVec3ToRad(vec);
  }

  // rad/sec 系の量を degree/sec へ戻す
  _radVec3ToDeg(vec) {
    return physicsMath.radVec3ToDeg(vec);
  }

  // vec3 の差を返す
  _subVec3(a, b) {
    return physicsMath.subVec3(a, b);
  }

  // vec3 の和を返す
  _addVec3(a, b) {
    return physicsMath.addVec3(a, b);
  }

  // vec3 の外積を返す
  _crossVec3(a, b) {
    return physicsMath.crossVec3(a, b);
  }

  // quaternion を [w,x,y,z] 配列として読む
  _getQuatArray(quat) {
    return physicsMath.getQuatArray(quat);
  }

  // quat で vec3 を回転する
  _rotateVec3ByQuat(vec, quat) {
    return physicsMath.rotateVec3ByQuat(vec, quat);
  }

  // 単位軸と回転角から quaternion を組み立てる
  _buildAxisAngleQuat(axis, degree) {
    return physicsMath.buildAxisAngleQuat(axis, degree);
  }

  // from を to へ向ける最小回転 quaternion を返す
  _buildQuatFromUnitVectors(fromVec, toVec) {
    return physicsMath.buildQuatFromUnitVectors(fromVec, toVec);
  }

  // world-space vector へ local inverse inertia を適用する
  _applyWorldInverseInertia(body, quat, vec) {
    return physicsMath.applyWorldInverseInertia(body, quat, vec);
  }

  // vec3 を正規化して返す
  _normalizeVec3(vec, name) {
    return physicsMath.normalizeVec3(vec, name);
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
    return physicsEvents.getPhysicsContactPairKey(this, bodyA, bodyB);
  }

  // manifold pair の key を返す
  _getManifoldPairKey(bodyA, bodyB) {
    return physicsEvents.getPhysicsManifoldPairKey(this, bodyA, bodyB);
  }

  // collideConnected=false の有効Jointが接続するbody pairを接触候補から除外する
  // Jointの有効化状態と衝突抑止を同じ判定へ揃え、無効化したJointが接触まで隠さないようにする
  _isJointCollisionSuppressed(bodyA, bodyB) {
    for (let i = 0; i < this.joints.length; i++) {
      const joint = this.joints[i];
      if (joint.isEnabled?.() !== true || joint.getCollideConnected?.() === true) {
        continue;
      }
      const jointBodyA = joint.getBodyA();
      const jointBodyB = joint.getBodyB();
      if ((jointBodyA === bodyA && jointBodyB === bodyB)
          || (jointBodyA === bodyB && jointBodyB === bodyA)) {
        return true;
      }
    }
    return false;
  }

  // 2 点間距離の二乗を返す
  _distanceSqVec3(a, b) {
    return physicsMath.distanceSqVec3(a, b);
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
      // Compute方式の接触はfixed step内でlambdaを0から積み上げる
      // 前stepのimpulseをwarm startすると、GPUにない力積を再注入して比較条件を変えるため持ち込まない
      if (this._isComputeBoxContact(manifold)
          || this._isComputePlaneShapeContact(manifold)
          || this._isComputeBodyContact(manifold)) {
        continue;
      }
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
    return physicsEvents.buildPhysicsContactMap(this, contacts);
  }

  // 直前 step と今回 step の contact pair 差分から begin / stay / end を作る
  _buildContactEvents(currentContactMap) {
    return physicsEvents.buildPhysicsContactEvents(this, currentContactMap);
  }

  // trigger を含む contact かどうかを返す
  _isTriggerContact(contact) {
    return physicsEvents.isPhysicsTriggerContact(contact);
  }

  // listener 引数を検証して返す
  _readContactListener(listener, name) {
    return physicsEvents.readPhysicsContactListener(listener, name);
  }

  // listener 配列へ重複なく登録する
  _addContactListener(listeners, listener, name) {
    return physicsEvents.addPhysicsContactListener(this, listeners, listener, name);
  }

  // listener 配列から削除する
  _removeContactListener(listeners, listener, name) {
    return physicsEvents.removePhysicsContactListener(this, listeners, listener, name);
  }

  // 直近 step の contact event を listener へ通知する
  _emitContactEvents(events) {
    return physicsEvents.emitPhysicsContactEvents(this, events);
  }

  // event 種別ごとの listener を順に呼ぶ
  _emitContactList(contacts, listeners, phase) {
    return physicsEvents.emitPhysicsContactList(this, contacts, listeners, phase);
  }

  // bodyの衝突解決に使う質量寄与を返す
  // sleeping中、static、kinematicは押し戻しで動かさないため0とする
  _getSolverInverseMass(body) {
    return cpuPhysicsSolver.getSolverInverseMass(this, body);
  }

  // bodyの衝突解決に使う逆慣性を返す
  _getSolverInverseInertia(body) {
    return cpuPhysicsSolver.getSolverInverseInertia(this, body);
  }

  // 接触点での速度 v + omega x r を返す
  _getContactPointVelocity(state, r) {
    return cpuPhysicsSolver.getContactPointVelocity(this, state, r);
  }

  // impulseが接触点へ働くときの有効質量分母を返す
  _getImpulseDenominator(bodyA, stateA, rA, bodyB, stateB, rB, direction, invMassA, invMassB) {
    return cpuPhysicsSolver.getImpulseDenominator(
      this,
      bodyA,
      stateA,
      rA,
      bodyB,
      stateB,
      rB,
      direction,
      invMassA,
      invMassB
    );
  }

  // impulseを線形速度と角速度へ反映する
  _applyContactImpulse(body, state, r, impulse, sign, invMass) {
    return cpuPhysicsSolver.applyContactImpulse(this, body, state, r, impulse, sign, invMass);
  }

  // manifold内の最大penetrationを返す
  _getManifoldMaxPenetration(manifold) {
    return cpuPhysicsSolver.getManifoldMaxPenetration(this, manifold);
  }

  // manifold内のcontact point平均を返す
  _getManifoldCenterPoint(manifold) {
    return cpuPhysicsSolver.getManifoldCenterPoint(this, manifold);
  }

  // sleeping dynamic bodyがactive bodyと接触した場合に起こす
  _wakeSleepingBodyForContact(sleepingBody, otherBody, stateMap = null, manifold = null) {
    return cpuPhysicsSolver.wakeSleepingBodyForContact(
      this,
      sleepingBody,
      otherBody,
      stateMap,
      manifold
    );
  }

  // Compute方式のBox候補について、step開始姿勢と積分後姿勢を包含するAABBを返す
  _getComputeBoxSweptAabb(body, collider, state) {
    return cpuPhysicsSolver.getComputeBoxSweptAabb(this, body, collider, state);
  }

  // broadphaseの前段として、step中のstateMapからcollider entry一覧を作る
  _collectStepColliderEntries(stateMap) {
    return cpuPhysicsSolver.collectStepColliderEntries(this, stateMap);
  }

  // AABBを持つcollider同士が重なる可能性を返す
  _canAabbBroadphaseOverlap(entryA, entryB) {
    return cpuPhysicsSolver.canAabbBroadphaseOverlap(this, entryA, entryB);
  }

  // Compute方式のBox broadphase候補がpadding込みで重なる可能性を返す
  _canComputeBoxBroadphaseOverlap(entryA, entryB) {
    return cpuPhysicsSolver.canComputeBoxBroadphaseOverlap(this, entryA, entryB);
  }

  // Boxの外部積分後stateを作り、sleep bodyの次step接触を先に調べる
  _buildComputeBoxPredictedState(body, dtSec) {
    return cpuPhysicsSolver.buildComputeBoxPredictedState(this, body, dtSec);
  }

  // active Boxとsleep Boxについて、次stepで接触するかを調べる
  _buildComputeBoxPredictedWakeContact(activeBody, sleepingBody, predictedState) {
    return cpuPhysicsSolver.buildComputeBoxPredictedWakeContact(
      this,
      activeBody,
      sleepingBody,
      predictedState
    );
  }

  // active Boxの予測接触を調べ、対象sleep Boxをfixed step前にwakeする
  _wakePredictedComputeBoxBodies(dtSec) {
    return cpuPhysicsSolver.wakePredictedComputeBoxBodies(this, dtSec);
  }

  // fixed stepの外部積分後AABBから、Compute方式のBox候補を一度だけ作る
  _buildComputeBoxCandidateMap(entries) {
    return cpuPhysicsSolver.buildComputeBoxCandidateMap(this, entries);
  }

  // broadphase pairをlayer、AABB、collider dispatchの順に確認して追加する
  _pushBroadphasePairIfAllowed(pairs, entryA, entryB) {
    return cpuPhysicsSolver.pushBroadphasePairIfAllowed(this, pairs, entryA, entryB);
  }

  // 全組み合わせを確認するbroadphase
  _collectBruteForceBroadphasePairs(entries) {
    return cpuPhysicsSolver.collectBruteForceBroadphasePairs(this, entries);
  }

  // AABBを持つcollider同士をx軸sweep-and-pruneで候補化する
  _collectSweepAabbBroadphasePairs(entries) {
    return cpuPhysicsSolver.collectSweepAabbBroadphasePairs(this, entries);
  }

  // broadphase候補を列挙する
  _collectBroadphasePairs(entries) {
    return cpuPhysicsSolver.collectBroadphasePairs(this, entries);
  }

  // material.restitutionを読み、未指定ならPhysicsSpace既定値を使う
  _getRestitution(body) {
    return cpuPhysicsSolver.getRestitution(this, body);
  }

  // material.frictionを読み、未指定ならPhysicsSpace既定値を使う
  _getFriction(body) {
    return cpuPhysicsSolver.getFriction(this, body);
  }

  // manifold全体の押し戻しを最深penetrationを基準に1回だけ行う
  _resolveManifoldPosition(manifold, stateMap) {
    return cpuPhysicsSolver.resolveManifoldPosition(this, manifold, stateMap);
  }

  // 前フレームのcached impulseを現在stateへ先に与える
  _applyWarmStartToContactPoint(manifold, contactPoint, stateMap) {
    return cpuPhysicsSolver.applyWarmStartToContactPoint(this, manifold, contactPoint, stateMap);
  }

  // manifoldに保存されたshared tangent impulseを先に適用する
  _applyWarmStartToSharedManifold(manifold, stateMap) {
    return cpuPhysicsSolver.applyWarmStartToSharedManifold(this, manifold, stateMap);
  }

  // manifold群へwarm startを適用する
  _applyWarmStartToManifolds(manifolds, stateMap) {
    return cpuPhysicsSolver.applyWarmStartToManifolds(this, manifolds, stateMap);
  }

  // 接触法線に直交する2本の接線基底を返す
  _buildContactTangents(normal, relativeVelocity) {
    return cpuPhysicsSolver.buildContactTangents(this, normal, relativeVelocity);
  }

  // Compute版Box接触で使う法線だけから決まる2本の接線基底を返す
  _buildComputeContactTangents(normal) {
    return cpuPhysicsSolver.buildComputeContactTangents(this, normal);
  }

  // Box/BoxまたはPlane/BoxをCompute方式の局所力積式で解く対象か判定する
  _isComputeBoxContact(manifold) {
    return cpuPhysicsSolver.isComputeBoxContact(this, manifold);
  }

  // 静止PlaneとSphereまたはCapsuleをCompute版Plane接触処理へ渡す対象か判定する
  _isComputePlaneShapeContact(manifold) {
    return cpuPhysicsSolver.isComputePlaneShapeContact(this, manifold);
  }

  // Planeを含まない一般shape pairをCompute版body contact式へ渡す対象か判定する
  _isComputeBodyContact(manifold) {
    return cpuPhysicsSolver.isComputeBodyContact(this, manifold);
  }

  // shared PhysicsContactImpulseSolverへbody stateと単位変換を渡す
  _resolveComputeBoxContactPoint(
    manifold,
    contactPoint,
    stateMap,
    iteration,
    localBody,
    options = {}
  ) {
    return cpuPhysicsSolver.resolveComputeBoxContactPoint(
      this,
      manifold,
      contactPoint,
      stateMap,
      iteration,
      localBody,
      options
    );
  }

  // Compute版Plane接触のshape側へ共有impulse式を適用する
  _resolveComputePlaneContactPoint(
    manifold,
    contactPoint,
    stateMap,
    iteration,
    accumulator
  ) {
    return cpuPhysicsSolver.resolveComputePlaneContactPoint(
      this,
      manifold,
      contactPoint,
      stateMap,
      iteration,
      accumulator
    );
  }

  // 一般body pairへCompute版の累積lambdaとcoupled反作用を適用する
  _resolveComputeBodyContactPoint(
    manifold,
    contactPoint,
    stateMap,
    iteration
  ) {
    return cpuPhysicsSolver.resolveComputeBodyContactPoint(
      this,
      manifold,
      contactPoint,
      stateMap,
      iteration
    );
  }

  // local bodyと相手bodyの向きで一つの累積lambda領域を取得する
  _getComputeBoxImpulseAccumulator(localBody, otherBody) {
    return cpuPhysicsSolver.getComputeBoxImpulseAccumulator(this, localBody, otherBody);
  }

  // Compute版の一body一invocationに合わせ、local Boxの候補を登録順に解く
  _resolveComputeBoxBody(
    localBody,
    localIndex,
    stateMap,
    sourceStateMap,
    candidateMap,
    iteration,
    contactManifolds
  ) {
    return cpuPhysicsSolver.resolveComputeBoxBody(
      this,
      localBody,
      localIndex,
      stateMap,
      sourceStateMap,
      candidateMap,
      iteration,
      contactManifolds
    );
  }

  // manifold内のpenetrating contact数を返す
  _countPenetratingContacts(manifold, threshold = 1.0e-4) {
    return cpuPhysicsSolver.countPenetratingContacts(this, manifold, threshold);
  }

  // 一般shapeのcontact pointをimpulseとposition correctionで解く
  _resolveContactPoint(manifold, contactPoint, stateMap, options = {}) {
    return cpuPhysicsSolver.resolveContactPoint(this, manifold, contactPoint, stateMap, options);
  }

  // manifoldの代表点でimpact impulseを解く
  _resolveImpactCenter(manifold, stateMap) {
    return cpuPhysicsSolver.resolveImpactCenter(this, manifold, stateMap);
  }

  // manifold共有impulseをbody stateへ反映する
  _applySharedManifoldImpulse(manifold, stateMap, impulse) {
    return cpuPhysicsSolver.applySharedManifoldImpulse(this, manifold, stateMap, impulse);
  }

  // manifold全体の摩擦impulseを解く
  _resolveSharedManifoldFriction(manifold, stateMap) {
    return cpuPhysicsSolver.resolveSharedManifoldFriction(this, manifold, stateMap);
  }

  // manifold一つの一般接触解決を行う
  _resolveManifold(manifold, stateMap, iteration = 0, options = {}) {
    return cpuPhysicsSolver.resolveManifold(this, manifold, stateMap, iteration, options);
  }

  // contactのsupport方向を調べ、sleep判定に使うstate flagを更新する
  _markSleepSupportFromContacts(stateMap, contacts) {
    return cpuPhysicsSolver.markSleepSupportFromContacts(this, stateMap, contacts);
  }

  // 現在のbody transformからquery用stateを作る
  _getQueryState(body) {
    return physicsQueries.getPhysicsQueryState(this, body);
  }

  // query option を検証する
  _readRaycastOptions(options) {
    return physicsQueries.readPhysicsRaycastOptions(this, options);
  }

  // AABB query option を検証する
  _readQueryAabbOptions(options) {
    return physicsQueries.readPhysicsQueryAabbOptions(options);
  }

  // overlapSphere option を検証する
  _readOverlapSphereOptions(options) {
    return physicsQueries.readPhysicsOverlapSphereOptions(options);
  }

  // collision layer / mask 用の 32bit bitmask を読む
  _readCollisionBits(value, name) {
    return physicsQueries.readPhysicsCollisionBits(value, name);
  }

  // query layerMask と body layer が一致するかを返す
  _matchesQueryLayer(body, layerMask) {
    return physicsQueries.matchesPhysicsQueryLayer(body, layerMask);
  }

  // includeTriggers / triggerOnly option に body が一致するかを返す
  _matchesQueryTriggerMode(body, query) {
    return physicsQueries.matchesPhysicsQueryTriggerMode(body, query);
  }

  // query filter を検証する
  _assertQueryFilter(filter, name) {
    return physicsQueries.assertPhysicsQueryFilter(filter, name);
  }

  // 2 つの AABB が重なるかどうかを返す
  _intersectAabb(minA, maxA, minB, maxB) {
    return physicsQueries.intersectPhysicsAabb(minA, maxA, minB, maxB);
  }

  // 現在の physics space から query 用 collider entry 一覧を収集する
  // ここでは collider 種別を固定せず、個々の query メソッドへ渡す材料だけを並べる
  _collectCurrentQueryEntries(query = {}) {
    return physicsQueries.collectPhysicsQueryEntries(this, query);
  }

  // raycast 用に 1 body 分の hit を収集する
  _raycastBody(body, rayOrigin, rayDir, query) {
    return physicsQueries.raycastPhysicsBody(this, body, rayOrigin, rayDir, query);
  }

  // raycast 全 hit を距離順に返す
  _collectRayHits(rayOrigin, rayDir, query) {
    return physicsQueries.collectPhysicsRayHits(this, rayOrigin, rayDir, query);
  }

  // Compute方式のBox候補について、step開始姿勢と積分後姿勢を包含するAABBを返す
  // narrowphaseへ渡す姿勢は現在stateのままにし、移動中のpairをbroad phaseで落とさないためだけに使う
  _buildManifold(entryA, entryB) {
    return physicsContactDispatcher.buildPhysicsManifold(this, entryA, entryB);
  }

  // Box-BoxまたはPlane-Boxの候補かを、narrow phaseを実行する前に判定する
  // これらのpairはfixed step内で再利用するBox候補から一度だけ処理するため、
  // Box/Plane manifoldは専用経路で一度だけ生成し、一般manifold側の二重計算を省きます
  _isComputeBoxCandidatePair(entryA, entryB) {
    return physicsContactDispatcher.isComputeBoxCandidatePair(entryA, entryB);
  }

  // manifold を flat contact 一覧へ展開する
  _flattenManifoldContacts(manifold) {
    return physicsContactDispatcher.flattenPhysicsManifoldContacts(manifold);
  }

  // broadphase 候補から narrowphase を実行し、実際の manifold 一覧を作る
  _collectManifolds(stateMap, options = {}) {
    return physicsContactDispatcher.collectPhysicsManifolds(this, stateMap, options);
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
    this.materialPairs.setDefaults({ restitution: this.defaultRestitution });
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
    this.materialPairs.setDefaults({ friction: this.defaultFriction });
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
    // step数を直接設定した場合は、Box solverへ渡す時間基準も同じ固定step数へ揃えます
    this.timeToSleep = this.sleepStepsThreshold * this.fixedTimeStepMs / 1000.0;
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

  // 全dynamic bodyがsleep中で、外部から動くbodyや有効Jointがないかを判定します
  // sleep bodyを個別に抜き出さず、Space全体を保存stateへ切り替える条件だけを共有します
  _canUseSpaceSleepingFastPath(dynamicBodies = this.bodies.filter((body) => (
    body?.isDynamic?.() === true
  ))) {
    if (this.sleepFastPathReady !== true || dynamicBodies.length === 0) {
      return false;
    }
    if (this.bodies.some((body) => body?.isKinematic?.() === true)) {
      return false;
    }
    if (this.joints.some((joint) => joint?.isEnabled?.() === true)) {
      return false;
    }
    return dynamicBodies.every((body) => body.getSleeping?.() === true);
  }

  // `_getSleepIslandKey`は受け取った値を処理し、後続処理で利用する状態または結果を生成する
  _getSleepIslandKey(island) {
    const ids = island.map((body) => this._getBodyId(body)).sort((a, b) => a - b);
    return ids.join(":");
  }

  // sleep islandの連続安定step数を読み、睡眠判定の閾値比較へ渡します
  _getSleepIslandStepCount(islandKey) {
    return this.sleepIslandStepMap.get(islandKey) ?? 0;
  }

  // `_incrementSleepIslandStepCount`は受け取った値を処理し、後続処理で利用する状態または結果を生成する
  _incrementSleepIslandStepCount(islandKey) {
    const nextCount = this._getSleepIslandStepCount(islandKey) + 1;
    this.sleepIslandStepMap.set(islandKey, nextCount);
    return nextCount;
  }

  // sleep islandが再び動いたとき、蓄積した安定step数を削除します
  _resetSleepIslandStepCount(islandKey) {
    this.sleepIslandStepMap.delete(islandKey);
  }

  // active なbody同士で、接触islandを集めて返します
  // requireSupportNormalがtrueの場合は支持面だけをsleep判定へ使い、falseの場合は全physical contactで接続します
  _collectDynamicSleepIslands(activeBodies, contacts, requireSupportNormal = true) {
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
      if (requireSupportNormal) {
        const normal = Array.isArray(contact.normal) ? contact.normal : null;
        if (!normal) {
          continue;
        }
        const supportsAFromB = this._isSupportNormal(normal);
        const supportsBFromA = this._isSupportNormal(this._scaleVec3(normal, -1.0));
        if (!supportsAFromB && !supportsBFromA) {
          continue;
        }
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
    if (body.getAllowSleep?.() !== true) {
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
    const eligibleSet = new Set(eligibleBodies);
    // 同じ接触islandの一部だけをeligibleとして切り出さず、全bodyの状態が揃ったislandだけをsleepへ進めます
    // side contactも含めて接続し、隣bodyのawake状態をsleep判定へ反映します
    const islands = this._collectDynamicSleepIslands(activeBodies, contacts, false)
      .filter((island) => island.every((body) => eligibleSet.has(body)));
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

    const supportIslands = this._collectDynamicSleepIslands(activeBodies, contacts, false);
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

  // Compute方式のBox接触で、実績済みsolverと同じbody単位のsleep判定を行う
  // 接触した全bodyを一つのislandへまとめず、各body自身の支持・接触速度・連続低速stepだけで停止を決める
  _applyComputeBoxSleepStates(activeBodies, stateMap) {
    const sleepingBodies = new Set();
    const debugIslands = [];
    for (let i = 0; i < activeBodies.length; i++) {
      const body = activeBodies[i];
      const state = stateMap.get(body);
      if (!state?.computeBoxContactObserved) {
        continue;
      }
      const linearSpeed = this._lengthVec3(state.velocity);
      const angularSpeed = this._lengthVec3(state.angularVelocity);
      const lowMotion = linearSpeed < this.sleepLinearThreshold
        && angularSpeed < this.sleepAngularThreshold;
      const quietContact = state.computeBoxMaxContactSpeed < this.sleepContactSpeed
        && state.computeBoxMaxNormalSpeed < this.sleepNormalSpeed;
      const floorSupportLoadSettled = state.computeBoxFloorContactObserved
        && state.computeBoxFloorSupportPoints >= this.minimumFloorSupportPoints
        && lowMotion;
      let sleepContactQuiet = quietContact || floorSupportLoadSettled;
      const sleepingContactsOnly = state.computeBoxBodyContactObserved
        && !state.computeBoxActiveDynamicBodyContactObserved;
      const lowMotionWithSleepingContacts = sleepingContactsOnly
        && linearSpeed < this.wakeLinearSpeed
        && angularSpeed < this.wakeAngularSpeed;
      const sleepMotionSettled = lowMotion || lowMotionWithSleepingContacts;
      sleepContactQuiet = sleepContactQuiet || lowMotionWithSleepingContacts;
      const hasSupport = state.touchedStatic
        || state.touchedDynamicSupport
        || state.computeBoxWallSupportObserved;
      const sleepCandidate = this.persistentSleep
        && body.getAllowSleep?.() === true
        && hasSupport
        && sleepMotionSettled
        && sleepContactQuiet;
      const sleepStepCount = sleepCandidate
        ? this._incrementSleepStepCount(body)
        : (this._resetSleepStepCount(body), 0);
      const shouldSleep = sleepCandidate && sleepStepCount >= this.sleepStepsThreshold;
      if (shouldSleep) {
        body.stopMotion();
        this._resetSleepStepCount(body);
        body.sleep();
        sleepingBodies.add(body);
      }
      debugIslands.push({
        islandId: i + 1,
        state: shouldSleep ? "sleeping" : sleepCandidate ? "candidate" : "awake",
        bodyIds: [this._getBodyId(body)],
        bodyNames: [body.getName?.() ?? `body_${this._getBodyId(body)}`],
        bodyCount: 1,
        minSleepStepCount: sleepStepCount,
        maxLinearSpeed: linearSpeed,
        maxAngularSpeed: angularSpeed,
        maxPenetration: 0.0,
        blockReason: shouldSleep || sleepCandidate ? "none" : (
          !hasSupport ? "no_support" : !sleepMotionSettled ? "motion" : "contact_speed"
        )
      });
    }
    this.lastSleepIslands = debugIslands;
    this.sleepIslandStepMap.clear();
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

  // 有効Jointへ接続されたdynamic bodyをfixed step開始前にwakeする
  _wakeEnabledJointBodies() {
    return physicsJointPipeline.wakeEnabledJointBodies(this);
  }

  // 有効Jointへ接続されたdynamic bodyのfixed step開始transformを保存する
  _createJointXpbdPreStepTransformMap() {
    return physicsJointPipeline.createJointXpbdPreStepTransformMap(this);
  }

  // XPBD position correction後のtransform差をJoint参加bodyのphysical velocityへ戻す
  _applyJointXpbdVelocityUpdate(transformMap, dtSec) {
    return physicsJointPipeline.applyJointXpbdVelocityUpdate(this, transformMap, dtSec);
  }

  // 登録Box solverのworld XYZ角速度表現へ、Joint補正後の姿勢差を戻す
  _applyRegisteredBoxJointVelocityUpdate(transformMap, dtSec) {
    return physicsJointPipeline.applyRegisteredBoxJointVelocityUpdate(this, transformMap, dtSec);
  }

  // bodyへ反映済みのJoint XPBD補正をstateMapへ戻す
  _syncStateMapAfterJointSolver(stateMap) {
    return physicsJointPipeline.syncStateMapAfterJointSolver(this, stateMap);
  }

  // 有効Jointを種類によらないXPBD position rowとして反復する
  _solveJointsXPBD(dtSec) {
    return physicsJointPipeline.solveJointsXPBD(this, dtSec);
  }

  // body を physics space へ登録する
  addBody(body) {
    return physicsBodyRegistry.addPhysicsBody(this, body);
  }

  // Jointをphysics spaceへ登録する
  // bodyを別spaceから暗黙に移さず、両bodyが先に登録済みであることを検証する
  addJoint(joint) {
    if (!joint
        || typeof joint.getBodyA !== "function"
        || typeof joint.getBodyB !== "function"
        || typeof joint.buildConstraintRows !== "function"
        || typeof joint.isEnabled !== "function"
        || typeof joint.getCompliance !== "function"
        || typeof joint.getPositionCorrectionError !== "function"
        || typeof joint.getPositionConstraintLambda !== "function"
        || typeof joint.setPositionConstraintLambda !== "function") {
      throw new Error("PhysicsSpace.addJoint() requires a Joint object");
    }
    if (this.joints.includes(joint)) {
      return joint;
    }
    const bodyA = joint.getBodyA();
    const bodyB = joint.getBodyB();
    if (!this.bodies.includes(bodyA) || !this.bodies.includes(bodyB)) {
      throw new Error("PhysicsSpace.addJoint() requires both bodies to be registered first");
    }
    if (bodyA === bodyB) {
      throw new Error("PhysicsSpace.addJoint() requires different bodies");
    }
    this.joints.push(joint);
    this.sleepFastPathReady = false;
    bodyA.wakeUp?.();
    bodyB.wakeUp?.();
    return joint;
  }

  // Jointを登録から外す
  // bodyの所属やtransformは変更せず、以後のsolverと衝突抑止だけを解除する
  removeJoint(joint) {
    const index = this.joints.indexOf(joint);
    if (index >= 0) {
      this.joints.splice(index, 1);
      this.sleepFastPathReady = false;
    }
    return joint;
  }

  // 登録済みJointの配列を複製して返す
  getJoints() {
    return [...this.joints];
  }

  // 直前fixed stepで解いたJointの診断値を返す
  // 配列要素を複製し、呼出側が内部診断状態を変更できないようにする
  getLastJointDiagnostics() {
    return this.lastJointDiagnostics.map((diagnostic) => ({ ...diagnostic }));
  }

  // body を physics space から外す
  removeBody(body) {
    return physicsBodyRegistry.removePhysicsBody(this, body);
  }

  // 登録 body 一覧を返す
  getBodies() {
    return physicsBodyRegistry.getPhysicsBodies(this);
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

  // 設定済みのfixed timestepと一致する1回分だけをPhysicsStepPipelineへ委譲します
  // 物理計算の時間幅を呼出側が変更すると、重力、減衰、接触反発、Joint補正の意味が変わるため、公開入口で一致を検証します
  stepFixed(dtSec) {
    const numericDtSec = util.readFiniteNumber(dtSec, "PhysicsSpace.stepFixed dtSec", {
      minExclusive: 0.0
    });
    const fixedDtSec = this.fixedTimeStepMs / 1000.0;
    if (Math.abs(numericDtSec - fixedDtSec) > 1.0e-12) {
      throw new Error(
        `PhysicsSpace.stepFixed dtSec must equal fixed timestep: ${numericDtSec} !== ${fixedDtSec}`
      );
    }
    return stepPhysicsSpace(this, numericDtSec);
  }

};  // class PhysicsSpace
