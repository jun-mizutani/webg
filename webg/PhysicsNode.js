// ---------------------------------------------
//  PhysicsNode.js  2026/05/06
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import Node from "./Node.js";
import Quat from "./Quat.js";
import util from "./util.js";

export default class PhysicsNode extends Node {

  // bodyType を持つ物理ノードを生成する
  constructor(parent_node, name, options = {}) {
    // PhysicsNode は Node の描画・階層機能を継承しつつ、
    // 物理更新側が参照する速度、質量、停止状態をまとめて保持する
    super(parent_node, name);
    const opts = util.readPlainObject(options, "PhysicsNode options", {});
    this.bodyType = util.readOptionalEnum(
      opts.bodyType,
      "PhysicsNode bodyType",
      "dynamic",
      ["static", "kinematic", "dynamic"]
    );
    this.mass = util.readOptionalFiniteNumber(
      opts.mass,
      "PhysicsNode mass",
      1.0,
      { minExclusive: 0.0 }
    );
    this.inertiaMode = opts.inertia !== undefined ? "manual" : "auto";
    this.inertia = opts.inertia !== undefined
      ? this._readInertiaVec3(opts.inertia, "PhysicsNode inertia")
      : [this.mass, this.mass, this.mass];
    this.invMass = 0.0;
    this.invInertia = [0.0, 0.0, 0.0];
    this.velocity = [0.0, 0.0, 0.0];
    this.angularVelocity = [0.0, 0.0, 0.0];
    this.force = [0.0, 0.0, 0.0];
    this.torque = [0.0, 0.0, 0.0];
    this.gravityScale = util.readOptionalFiniteNumber(
      opts.gravityScale,
      "PhysicsNode gravityScale",
      1.0
    );
    this.linearDamping = util.readOptionalFiniteNumber(
      opts.linearDamping,
      "PhysicsNode linearDamping",
      0.0,
      { min: 0.0 }
    );
    this.angularDamping = util.readOptionalFiniteNumber(
      opts.angularDamping,
      "PhysicsNode angularDamping",
      0.0,
      { min: 0.0 }
    );
    this.allowSleep = util.readOptionalBoolean(
      opts.allowSleep,
      "PhysicsNode allowSleep",
      true
    );
    this.isSleeping = util.readOptionalBoolean(
      opts.isSleeping,
      "PhysicsNode isSleeping",
      false
    );
    this.isTrigger = util.readOptionalBoolean(
      opts.isTrigger,
      "PhysicsNode isTrigger",
      false
    );
    this.fixedRotation = util.readOptionalBoolean(
      opts.fixedRotation,
      "PhysicsNode fixedRotation",
      false
    );
    this.collisionLayer = this._readCollisionBits(
      opts.collisionLayer === undefined ? 1 : opts.collisionLayer,
      "PhysicsNode collisionLayer"
    );
    this.collisionMask = this._readCollisionBits(
      opts.collisionMask === undefined ? 0xffffffff : opts.collisionMask,
      "PhysicsNode collisionMask"
    );
    this.material = opts.material ?? null;
    this.collider = opts.collider ?? null;
    this.physicsSpace = null;
    this._savedLinearVelocity = null;
    this._savedAngularVelocity = null;
    this._syncingFromPhysics = false;
    this._updateInverseMass();
    this._updateAutoInertia();
    this._updateInverseInertia();
  }

  // 現在の bodyType を返す
  getBodyType() {
    return this.bodyType;
  }

  // static 判定を返す
  isStatic() {
    return this.bodyType === "static";
  }

  // kinematic 判定を返す
  isKinematic() {
    return this.bodyType === "kinematic";
  }

  // dynamic 判定を返す
  isDynamic() {
    return this.bodyType === "dynamic";
  }

  // 質量から逆質量を再計算する
  _updateInverseMass() {
    // static と kinematic は物理積分で速度変化させないため、
    // 質量値を保持していても逆質量は 0 として扱う
    if (this.bodyType === "dynamic") {
      this.invMass = 1.0 / this.mass;
    } else {
      this.invMass = 0.0;
    }
  }

  // dynamic 中の transform 直接変更を禁止する
  _assertTransformWriteAllowed(methodName) {
    // 物理更新フロー自身が Node の transform を反映するときは、
    // 例外を投げずに通過できるよう同期中フラグを使う
    if (this._syncingFromPhysics === true) {
      return;
    }
    if (this.bodyType === "dynamic") {
      throw new Error(`PhysicsNode.${methodName}() is not allowed for dynamic bodies; use setBodyType(\"kinematic\") or teleport()`);
    }
  }

  // 3 要素の有限数ベクトルを検証してコピーする
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

  // 参照型 option を検証して返す
  // collider や physicsSpace は将来 class instance を渡す想定があるため、
  // plain object に限定せず object 参照として受け付ける
  _readObjectReference(value, name, { allowNull = true } = {}) {
    if (value === null) {
      if (!allowNull) {
        throw new Error(`${name} must be an object`);
      }
      return null;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`${name} must be an object${allowNull ? " or null" : ""}`);
    }
    return value;
  }

  // collision layer / mask 用の 32bit bitmask を読む
  _readCollisionBits(value, name) {
    return util.readFiniteNumber(value, name, {
      integer: true,
      min: 0,
      max: 0xffffffff
    });
  }

  // Euler 角 3 要素を検証してコピーする
  // PhysicsSpace 側が姿勢を degree で扱う間は、この helper を使って Node へ戻す
  _readEuler3(value, name) {
    if (!Array.isArray(value) || value.length < 3) {
      throw new Error(`${name} must be an Euler array`);
    }
    return [
      util.readFiniteNumber(value[0], `${name}[0]`),
      util.readFiniteNumber(value[1], `${name}[1]`),
      util.readFiniteNumber(value[2], `${name}[2]`)
    ];
  }

  // 慣性テンソルの diagonal 成分を検証してコピーする
  // 現段階では local xyz 軸に沿う diagonal inertia として扱う
  _readInertiaVec3(value, name) {
    if (!Array.isArray(value) || value.length < 3) {
      throw new Error(`${name} must be a vec3 array`);
    }
    return [
      util.readFiniteNumber(value[0], `${name}[0]`, { minExclusive: 0.0 }),
      util.readFiniteNumber(value[1], `${name}[1]`, { minExclusive: 0.0 }),
      util.readFiniteNumber(value[2], `${name}[2]`, { minExclusive: 0.0 })
    ];
  }

  // collider と質量から local inertia の diagonal 成分を推定する
  _computeAutoInertia() {
    const collider = this.collider;
    if (collider?.type === "box" && Array.isArray(collider.size)) {
      const sx = collider.size[0];
      const sy = collider.size[1];
      const sz = collider.size[2];
      return [
        this.mass * (sy * sy + sz * sz) / 12.0,
        this.mass * (sx * sx + sz * sz) / 12.0,
        this.mass * (sx * sx + sy * sy) / 12.0
      ];
    }
    if (collider?.type === "sphere" && Number.isFinite(collider.radius)) {
      const value = 0.4 * this.mass * collider.radius * collider.radius;
      return [value, value, value];
    }
    if (collider?.type === "capsule" && Number.isFinite(collider.radius) && Number.isFinite(collider.segmentLength)) {
      const r = collider.radius;
      const h = collider.segmentLength + r * 2.0;
      return [
        this.mass * (3.0 * r * r + h * h) / 12.0,
        0.5 * this.mass * r * r,
        this.mass * (3.0 * r * r + h * h) / 12.0
      ];
    }
    return [this.mass, this.mass, this.mass];
  }

  // auto inertia の場合だけ collider / mass から慣性を更新する
  _updateAutoInertia() {
    if (this.inertiaMode === "auto") {
      this.inertia = this._computeAutoInertia();
    }
  }

  // bodyType と fixedRotation から solver 用の逆慣性を更新する
  _updateInverseInertia() {
    if (this.bodyType === "dynamic" && this.fixedRotation !== true) {
      this.invInertia = [
        1.0 / this.inertia[0],
        1.0 / this.inertia[1],
        1.0 / this.inertia[2]
      ];
    } else {
      this.invInertia = [0.0, 0.0, 0.0];
    }
  }

  // Quat 互換オブジェクトを検証して複製する
  // 物理更新側は quaternion を主状態として持つため、
  // syncNodeFromPhysics() では Euler ではなく Quat を直接受け取れるようにする
  _readQuat(value, name) {
    if (!value || typeof value !== "object" || !Array.isArray(value.q) || value.q.length < 4) {
      throw new Error(`${name} must be a Quat-like object`);
    }
    const quat = new Quat();
    quat.q[0] = util.readFiniteNumber(value.q[0], `${name}.q[0]`);
    quat.q[1] = util.readFiniteNumber(value.q[1], `${name}.q[1]`);
    quat.q[2] = util.readFiniteNumber(value.q[2], `${name}.q[2]`);
    quat.q[3] = util.readFiniteNumber(value.q[3], `${name}.q[3]`);
    quat.normalize();
    return quat;
  }

  // vec3 がほぼゼロかどうかを返す
  _isZeroVec3(vec) {
    return Math.abs(vec[0]) <= 1.0e-8
      && Math.abs(vec[1]) <= 1.0e-8
      && Math.abs(vec[2]) <= 1.0e-8;
  }

  // bodyType を切り替える
  setBodyType(type, options = {}) {
    const nextType = util.readOptionalEnum(
      type,
      "PhysicsNode bodyType",
      this.bodyType,
      ["static", "kinematic", "dynamic"]
    );
    const opts = util.readPlainObject(options, "PhysicsNode setBodyType options", {});
    const clearVelocity = util.readOptionalBoolean(
      opts.clearVelocity,
      "PhysicsNode setBodyType clearVelocity",
      true
    );
    const restoreVelocity = util.readOptionalBoolean(
      opts.restoreVelocity,
      "PhysicsNode setBodyType restoreVelocity",
      true
    );
    if (nextType === this.bodyType) {
      return this;
    }

    if (this.bodyType === "dynamic" && nextType !== "dynamic") {
      this._savedLinearVelocity = [...this.velocity];
      this._savedAngularVelocity = [...this.angularVelocity];
      if (clearVelocity) {
        this.stopMotion();
      }
    }

    this.bodyType = nextType;

    if (nextType === "dynamic") {
      if (restoreVelocity
          && this._savedLinearVelocity !== null
          && this._isZeroVec3(this.velocity)) {
        this.velocity = [...this._savedLinearVelocity];
      }
      if (restoreVelocity
          && this._savedAngularVelocity !== null
          && this._isZeroVec3(this.angularVelocity)) {
        this.angularVelocity = [...this._savedAngularVelocity];
      }
    } else if (clearVelocity) {
      this.stopMotion();
    }

    this._updateInverseMass();
    this._updateInverseInertia();
    this.wakeUp();
    return this;
  }

  // dynamic を一時停止して kinematic 化する
  pauseDynamic(options = {}) {
    if (this.bodyType !== "dynamic") {
      return this;
    }
    return this.setBodyType("kinematic", options);
  }

  // 一時停止した dynamic を復帰させる
  resumeDynamic(options = {}) {
    if (this.bodyType !== "kinematic") {
      return this;
    }
    return this.setBodyType("dynamic", options);
  }

  // 質量を設定する
  setMass(mass) {
    this.mass = util.readFiniteNumber(mass, "PhysicsNode mass", {
      minExclusive: 0.0
    });
    this._updateAutoInertia();
    this._updateInverseMass();
    this._updateInverseInertia();
    return this;
  }

  // 現在の質量を返す
  getMass() {
    return this.mass;
  }

  // 現在の逆質量を返す
  getInverseMass() {
    return this.invMass;
  }

  // local diagonal inertia を設定する
  setInertia(inertia) {
    this.inertiaMode = "manual";
    this.inertia = this._readInertiaVec3(inertia, "PhysicsNode inertia");
    this._updateInverseInertia();
    this.wakeUp();
    return this;
  }

  // collider と質量から自動慣性へ戻す
  resetInertia() {
    this.inertiaMode = "auto";
    this._updateAutoInertia();
    this._updateInverseInertia();
    this.wakeUp();
    return this;
  }

  // local diagonal inertia を返す
  getInertia() {
    return [...this.inertia];
  }

  // local diagonal inverse inertia を返す
  getInverseInertia() {
    return [...this.invInertia];
  }

  // 重力係数を設定する
  setGravityScale(scale) {
    this.gravityScale = util.readFiniteNumber(scale, "PhysicsNode gravityScale");
    return this;
  }

  // 現在の重力係数を返す
  getGravityScale() {
    return this.gravityScale;
  }

  // 線形減衰を設定する
  setLinearDamping(damping) {
    this.linearDamping = util.readFiniteNumber(damping, "PhysicsNode linearDamping", {
      min: 0.0
    });
    return this;
  }

  // 現在の線形減衰を返す
  getLinearDamping() {
    return this.linearDamping;
  }

  // 角減衰を設定する
  setAngularDamping(damping) {
    this.angularDamping = util.readFiniteNumber(damping, "PhysicsNode angularDamping", {
      min: 0.0
    });
    return this;
  }

  // 現在の角減衰を返す
  getAngularDamping() {
    return this.angularDamping;
  }

  // sleeping 許可フラグを設定する
  setAllowSleep(enabled) {
    this.allowSleep = util.readOptionalBoolean(enabled, "PhysicsNode allowSleep", this.allowSleep);
    return this;
  }

  // sleeping 許可フラグを返す
  getAllowSleep() {
    return this.allowSleep;
  }

  // trigger フラグを設定する
  setTrigger(enabled) {
    this.isTrigger = util.readOptionalBoolean(enabled, "PhysicsNode isTrigger", this.isTrigger);
    return this;
  }

  // trigger フラグを返す
  getTrigger() {
    return this.isTrigger;
  }

  // 回転固定フラグを設定する
  setFixedRotation(enabled) {
    this.fixedRotation = util.readOptionalBoolean(enabled, "PhysicsNode fixedRotation", this.fixedRotation);
    this._updateInverseInertia();
    return this;
  }

  // 回転固定フラグを返す
  getFixedRotation() {
    return this.fixedRotation;
  }

  // collision layer を設定する
  setCollisionLayer(layer) {
    this.collisionLayer = this._readCollisionBits(layer, "PhysicsNode collisionLayer");
    return this;
  }

  // collision layer を返す
  getCollisionLayer() {
    return this.collisionLayer;
  }

  // collision mask を設定する
  setCollisionMask(mask) {
    this.collisionMask = this._readCollisionBits(mask, "PhysicsNode collisionMask");
    return this;
  }

  // collision mask を返す
  getCollisionMask() {
    return this.collisionMask;
  }

  // 相手 body と接触候補にしてよいかを返す
  canCollideWith(otherBody) {
    if (!otherBody?.getCollisionLayer || !otherBody?.getCollisionMask) {
      return false;
    }
    return (this.collisionLayer & otherBody.getCollisionMask()) !== 0
      && (otherBody.getCollisionLayer() & this.collisionMask) !== 0;
  }

  // collider 参照を保持する
  setCollider(collider) {
    this.collider = this._readObjectReference(collider, "PhysicsNode collider");
    this._updateAutoInertia();
    this._updateInverseInertia();
    return this;
  }

  // 現在の collider 参照を返す
  getCollider() {
    return this.collider;
  }

  // 物理材質参照を保持する
  // Shape の material と混同しないよう、PhysicsNode 側に独立して置く
  setPhysicsMaterial(material) {
    this.material = this._readObjectReference(material, "PhysicsNode material");
    return this;
  }

  // 現在の物理材質参照を返す
  getPhysicsMaterial() {
    return this.material;
  }

  // この body を管理する PhysicsSpace 参照を設定する
  setPhysicsSpace(physicsSpace) {
    this.physicsSpace = this._readObjectReference(physicsSpace, "PhysicsNode physicsSpace");
    return this;
  }

  // 現在ひも付いている PhysicsSpace 参照を返す
  getPhysicsSpace() {
    return this.physicsSpace;
  }

  // 線形速度を設定する
  setLinearVelocity(x, y, z) {
    this.velocity[0] = util.readFiniteNumber(x, "PhysicsNode velocity x");
    this.velocity[1] = util.readFiniteNumber(y, "PhysicsNode velocity y");
    this.velocity[2] = util.readFiniteNumber(z, "PhysicsNode velocity z");
    this.wakeUp();
    return this;
  }

  // 線形速度を返す
  getLinearVelocity() {
    return [...this.velocity];
  }

  // vec3 で線形速度を設定する
  setLinearVelocityVec(velocity) {
    const vec = this._readVec3(velocity, "PhysicsNode velocity");
    return this.setLinearVelocity(vec[0], vec[1], vec[2]);
  }

  // 角速度を設定する
  setAngularVelocity(x, y, z) {
    this.angularVelocity[0] = util.readFiniteNumber(x, "PhysicsNode angularVelocity x");
    this.angularVelocity[1] = util.readFiniteNumber(y, "PhysicsNode angularVelocity y");
    this.angularVelocity[2] = util.readFiniteNumber(z, "PhysicsNode angularVelocity z");
    this.wakeUp();
    return this;
  }

  // 角速度を返す
  getAngularVelocity() {
    return [...this.angularVelocity];
  }

  // vec3 で角速度を設定する
  setAngularVelocityVec(angularVelocity) {
    const vec = this._readVec3(angularVelocity, "PhysicsNode angularVelocity");
    return this.setAngularVelocity(vec[0], vec[1], vec[2]);
  }

  // force を加算する
  applyForce(force) {
    const vec = this._readVec3(force, "PhysicsNode force");
    this.force[0] += vec[0];
    this.force[1] += vec[1];
    this.force[2] += vec[2];
    this.wakeUp();
    return this;
  }

  // impulse を加算する
  applyImpulse(impulse) {
    if (this.bodyType !== "dynamic") {
      throw new Error("PhysicsNode.applyImpulse() requires a dynamic body");
    }
    const vec = this._readVec3(impulse, "PhysicsNode impulse");
    this.velocity[0] += vec[0] * this.invMass;
    this.velocity[1] += vec[1] * this.invMass;
    this.velocity[2] += vec[2] * this.invMass;
    this.wakeUp();
    return this;
  }

  // 蓄積中の force を返す
  getForce() {
    return [...this.force];
  }

  // torque を加算する
  applyTorque(torque) {
    const vec = this._readVec3(torque, "PhysicsNode torque");
    this.torque[0] += vec[0];
    this.torque[1] += vec[1];
    this.torque[2] += vec[2];
    this.wakeUp();
    return this;
  }

  // 角 impulse を加算する
  // diagonal inverse inertia を使い、軸ごとの回りやすさを反映する
  applyAngularImpulse(impulse) {
    if (this.bodyType !== "dynamic") {
      throw new Error("PhysicsNode.applyAngularImpulse() requires a dynamic body");
    }
    if (this.fixedRotation) {
      throw new Error("PhysicsNode.applyAngularImpulse() is not allowed when fixedRotation=true");
    }
    const vec = this._readVec3(impulse, "PhysicsNode angularImpulse");
    this.angularVelocity[0] += vec[0] * this.invInertia[0];
    this.angularVelocity[1] += vec[1] * this.invInertia[1];
    this.angularVelocity[2] += vec[2] * this.invInertia[2];
    this.wakeUp();
    return this;
  }

  // 蓄積中の torque を返す
  getTorque() {
    return [...this.torque];
  }

  // force だけをクリアする
  clearForce() {
    this.force[0] = 0.0;
    this.force[1] = 0.0;
    this.force[2] = 0.0;
    return this;
  }

  // torque だけをクリアする
  clearTorque() {
    this.torque[0] = 0.0;
    this.torque[1] = 0.0;
    this.torque[2] = 0.0;
    return this;
  }

  // 1 step で積み上げた force / torque をまとめてクリアする
  clearAccumulators() {
    this.clearForce();
    this.clearTorque();
    return this;
  }

  // 速度を完全停止する
  stopMotion() {
    this.velocity[0] = 0.0;
    this.velocity[1] = 0.0;
    this.velocity[2] = 0.0;
    this.angularVelocity[0] = 0.0;
    this.angularVelocity[1] = 0.0;
    this.angularVelocity[2] = 0.0;
    this.force[0] = 0.0;
    this.force[1] = 0.0;
    this.force[2] = 0.0;
    this.torque[0] = 0.0;
    this.torque[1] = 0.0;
    this.torque[2] = 0.0;
    return this;
  }

  // sleeping を解除する
  wakeUp() {
    this.isSleeping = false;
    return this;
  }

  // sleeping に入れる
  sleep() {
    if (!this.allowSleep) {
      throw new Error("PhysicsNode.sleep() requires allowSleep=true");
    }
    this.isSleeping = true;
    return this;
  }

  // sleeping 状態を返す
  getSleeping() {
    return this.isSleeping;
  }

  // 物理状態を保ったまま別位置へ移動する
  teleport(position, options = {}) {
    const vec = this._readVec3(position, "PhysicsNode teleport position");
    const opts = util.readPlainObject(options, "PhysicsNode teleport options", {});
    const keepVelocity = util.readOptionalBoolean(
      opts.keepVelocity,
      "PhysicsNode teleport keepVelocity",
      false
    );
    const wakeUp = util.readOptionalBoolean(
      opts.wakeUp,
      "PhysicsNode teleport wakeUp",
      true
    );
    super.setPosition(vec[0], vec[1], vec[2]);
    if (!keepVelocity) {
      this.stopMotion();
    }
    if (wakeUp) {
      this.wakeUp();
    }
    return this;
  }

  // 物理更新結果を Node transform へ反映する
  syncNodeFromPhysics(position, options = {}) {
    const vec = this._readVec3(position, "PhysicsNode syncNodeFromPhysics position");
    const opts = util.readPlainObject(options, "PhysicsNode syncNodeFromPhysics options", {});
    const attitude = opts.attitude === undefined
      ? null
      : this._readEuler3(opts.attitude, "PhysicsNode syncNodeFromPhysics attitude");
    const quat = opts.quat === undefined
      ? null
      : this._readQuat(opts.quat, "PhysicsNode syncNodeFromPhysics quat");
    if (attitude !== null && quat !== null) {
      throw new Error("PhysicsNode syncNodeFromPhysics accepts either attitude or quat");
    }
    this._syncingFromPhysics = true;
    try {
      super.setPosition(vec[0], vec[1], vec[2]);
      if (quat !== null) {
        super.setQuat(quat);
      } else if (attitude !== null) {
        super.setAttitude(attitude[0], attitude[1], attitude[2]);
      }
    } finally {
      this._syncingFromPhysics = false;
    }
    return this;
  }

  // Node 側の位置を物理状態へコピーする
  syncPhysicsFromNode() {
    return {
      position: this.getPosition(),
      attitude: this.getLocalAttitude(),
      quat: this.getQuat(),
      velocity: this.getLinearVelocity(),
      angularVelocity: this.getAngularVelocity(),
      bodyType: this.bodyType
    };
  }

  // dynamic body では直接 setPosition を許さない
  setPosition(x, y, z) {
    this._assertTransformWriteAllowed("setPosition");
    return super.setPosition(x, y, z);
  }

  // dynamic body では X だけの直接変更を許さない
  setPositionX(x) {
    this._assertTransformWriteAllowed("setPositionX");
    return super.setPositionX(x);
  }

  // dynamic body では Y だけの直接変更を許さない
  setPositionY(y) {
    this._assertTransformWriteAllowed("setPositionY");
    return super.setPositionY(y);
  }

  // dynamic body では Z だけの直接変更を許さない
  setPositionZ(z) {
    this._assertTransformWriteAllowed("setPositionZ");
    return super.setPositionZ(z);
  }

  // dynamic body では直接姿勢変更を許さない
  setAttitude(yaw, pitch, roll) {
    this._assertTransformWriteAllowed("setAttitude");
    return super.setAttitude(yaw, pitch, roll);
  }

  // dynamic body ではローカル移動を許さない
  move(x, y, z) {
    this._assertTransformWriteAllowed("move");
    return super.move(x, y, z);
  }

  // dynamic body では X 回転加算を許さない
  rotateX(degree) {
    this._assertTransformWriteAllowed("rotateX");
    return super.rotateX(degree);
  }

  // dynamic body では Y 回転加算を許さない
  rotateY(degree) {
    this._assertTransformWriteAllowed("rotateY");
    return super.rotateY(degree);
  }

  // dynamic body では Z 回転加算を許さない
  rotateZ(degree) {
    this._assertTransformWriteAllowed("rotateZ");
    return super.rotateZ(degree);
  }

  // dynamic body では Euler 回転加算を許さない
  rotate(yaw, pitch, roll) {
    this._assertTransformWriteAllowed("rotate");
    return super.rotate(yaw, pitch, roll);
  }

  // dynamic body では位置 tween を禁止する
  animatePosition(to, options = {}) {
    this._assertTransformWriteAllowed("animatePosition");
    return super.animatePosition(to, options);
  }

  // dynamic body では回転 tween を禁止する
  animateRotation(to, options = {}) {
    this._assertTransformWriteAllowed("animateRotation");
    return super.animateRotation(to, options);
  }

};  // class PhysicsNode
