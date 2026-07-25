// ---------------------------------------------
//  Collider.js  2026/05/06
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import util from "./util.js";

export default class Collider {

  // collider 共通設定を保持する
  constructor(type, options = {}) {
    this.type = String(type);
    const opts = util.readPlainObject(options, "Collider options", {});
    this.offset = this._readOptionalVec3(
      opts.offset,
      "Collider offset",
      [0.0, 0.0, 0.0]
    );
  }

  // 任意 vec3 を読み、未指定なら fallback を返す
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

  // 必須 vec3 を読む
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

  // vec3 の長さを返す
  _lengthVec3(vec) {
    return Math.hypot(vec[0], vec[1], vec[2]);
  }

  // vec3 を正規化して返す
  _normalizeVec3(vec, name) {
    const length = this._lengthVec3(vec);
    if (length <= 1.0e-8) {
      throw new Error(`${name} must not be a zero vector`);
    }
    return [vec[0] / length, vec[1] / length, vec[2] / length];
  }

  // vec3 の差を返す
  _subVec3(a, b) {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  }

  // vec3 の和を返す
  _addVec3(a, b) {
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  }

  // vec3 の内積を返す
  _dotVec3(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  }

  // vec3 を指定倍率で掛ける
  _scaleVec3(vec, scale) {
    return [vec[0] * scale, vec[1] * scale, vec[2] * scale];
  }

  // quat を [w,x,y,z] 配列として読む。未指定なら単位回転として扱う
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

  // quat から world-space の local xyz 軸を返す
  _getOrientationAxes(quat) {
    return [
      this._rotateVec3ByQuat([1.0, 0.0, 0.0], quat),
      this._rotateVec3ByQuat([0.0, 1.0, 0.0], quat),
      this._rotateVec3ByQuat([0.0, 0.0, 1.0], quat)
    ];
  }

  // 有限数を読み、必要なら範囲も検証する
  _readFiniteNumber(value, name, options = {}) {
    return util.readFiniteNumber(value, name, options);
  }

  // 基準位置と offset から collider の physics space 位置を返す
  getWorldPosition(position, quat = null) {
    const base = this._readVec3(position, `${this.constructor.name} position`);
    const offset = this._rotateVec3ByQuat(this.offset, quat);
    return [
      base[0] + offset[0],
      base[1] + offset[1],
      base[2] + offset[2]
    ];
  }

  // broadphase で使う collider 種別名を返す
  // PhysicsSpace はこの値を見て候補組を作ることで、
  // `instanceof` への依存を少しずつ減らしていく
  getBroadphaseKind() {
    return this.type;
  }

  // broadphase 候補として組み合わせ可能かを返す
  // 既定ではどの collider とも候補を作らない
  canBroadphasePairWith(_otherCollider) {
    return false;
  }

  // raycast の既定実装
  // 未対応 collider は null を返し、PhysicsSpace 側では hit なしとして扱う
  intersectRay(_position, _origin, _dir, _maxDistance = Infinity) {
    return null;
  }

  // AABB overlap の既定実装
  overlapsAabb(_position, _queryMin, _queryMax) {
    return false;
  }

  // queryAabb の返却値に使う AABB を返す
  // AABB を持たない collider は null を返す
  getAabb(_position) {
    return null;
  }

  // sphere overlap の既定実装
  overlapSphere(_position, _center, _radius) {
    return null;
  }

  // 相手 collider との接触生成を dispatch する
  // collider の組み合わせごとの数式は PhysicsSpace ではなく各 collider class に寄せる
  buildContactWith(position, otherCollider, otherPosition, bodyA, bodyB, quat = null, otherQuat = null) {
    const worldPosition = this._readVec3(
      position,
      `${this.constructor.name} contact position`
    );
    const otherWorldPosition = this._readVec3(
      otherPosition,
      `${this.constructor.name} other contact position`
    );
    if (!otherCollider || typeof otherCollider !== "object" || Array.isArray(otherCollider)) {
      throw new Error(`${this.constructor.name} otherCollider must be an object`);
    }
    const methodName = `_buildContactWith${otherCollider.constructor.name}`;
    if (typeof this[methodName] !== "function") {
      return null;
    }
    return this[methodName](worldPosition, otherCollider, otherWorldPosition, bodyA, bodyB, quat, otherQuat);
  }

  // 接触結果を manifold へ正規化して返す
  // collider 側は当面 single contact / contact array / manifold のどれを返してもよく、
  // PhysicsSpace 側は最終的に contacts[] を持つ manifold として扱う
  buildManifoldWith(position, otherCollider, otherPosition, bodyA, bodyB, quat = null, otherQuat = null) {
    const result = this.buildContactWith(
      position,
      otherCollider,
      otherPosition,
      bodyA,
      bodyB,
      quat,
      otherQuat
    );
    if (result === null) {
      return null;
    }
    if (Array.isArray(result.contacts)) {
      return {
        bodyA: result.bodyA,
        bodyB: result.bodyB,
        normal: [...result.normal],
        contacts: result.contacts.map((contact) => ({
          penetration: contact.penetration,
          point: Array.isArray(contact.point) ? [...contact.point] : null
        }))
      };
    }
    if (Array.isArray(result)) {
      if (result.length <= 0) {
        return null;
      }
      return {
        bodyA: result[0].bodyA,
        bodyB: result[0].bodyB,
        normal: [...result[0].normal],
        contacts: result.map((contact) => ({
          penetration: contact.penetration,
          point: Array.isArray(contact.point) ? [...contact.point] : null
        }))
      };
    }
    return {
      bodyA: result.bodyA,
      bodyB: result.bodyB,
      normal: [...result.normal],
      contacts: [{
        penetration: result.penetration,
        point: Array.isArray(result.point) ? [...result.point] : null
      }]
    };
  }

};  // class Collider
