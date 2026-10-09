// ---------------------------------------------
//  Joint.js  2026/08/25
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import util from "./util.js";

// CPU/Computeのどちらからも参照しやすいJoint共通定義を保持する
// このクラスはbodyの状態を直接積分せず、Joint別モジュールが制約行を作るための共通部分だけを担当する
export default class Joint {
  // body、制約補正係数、実行状態を検証してJointを生成する
  constructor(options = {}) {
    const opts = util.readPlainObject(options, "Joint options", {});
    this.bodyA = this._readBody(opts.bodyA, "Joint bodyA");
    this.bodyB = this._readBody(opts.bodyB, "Joint bodyB");
    if (this.bodyA === this.bodyB) {
      throw new Error("Joint bodyA and bodyB must be different bodies");
    }
    this.enabled = util.readOptionalBoolean(
      opts.enabled,
      "Joint enabled",
      true
    );
    this.collideConnected = util.readOptionalBoolean(
      opts.collideConnected,
      "Joint collideConnected",
      false
    );
    this.positionCorrectionBeta = util.readOptionalFiniteNumber(
      opts.positionCorrectionBeta,
      "Joint positionCorrectionBeta",
      0.2,
      { min: 0.0, max: 1.0 }
    );
    this.compliance = util.readOptionalFiniteNumber(
      opts.compliance,
      "Joint compliance",
      0.0,
      { min: 0.0 }
    );
    this.velocityCorrectionBeta = util.readOptionalFiniteNumber(
      opts.velocityCorrectionBeta,
      "Joint velocityCorrectionBeta",
      this.positionCorrectionBeta,
      { min: 0.0, max: 1.0 }
    );
    this.positionCorrectionSlop = util.readOptionalFiniteNumber(
      opts.positionCorrectionSlop,
      "Joint positionCorrectionSlop",
      0.0001,
      { min: 0.0 }
    );
    this.positionCorrectionIterations = opts.positionCorrectionIterations === undefined
      ? null
      : util.readOptionalInteger(
        opts.positionCorrectionIterations,
        "Joint positionCorrectionIterations",
        4,
        { min: 0, max: 64 }
      );
    // XPBDのlambdaはfixed stepをまたいで保持し、同じ拘束行の過去の補正量を次stepへ渡す
    // row nameをkeyにすることで、Joint種類ごとの行数や順番が変わっても別行の値を混ぜない
    this.positionConstraintLambdas = new Map();
  }

  // body参照を検証する
  // JointはPhysicsNode互換のsolver APIを要求し、未定義のオブジェクトを後段へ流さない
  _readBody(value, name) {
    if (!value || typeof value !== "object") {
      throw new Error(`${name} must be a body object`);
    }
    const requiredMethods = [
      "getPosition",
      "getQuat",
      "getLinearVelocity",
      "getAngularVelocity",
      "getInverseMass",
      "getInverseInertia",
      "isDynamic"
    ];
    for (let i = 0; i < requiredMethods.length; i++) {
      if (typeof value[requiredMethods[i]] !== "function") {
        throw new Error(`${name} must provide ${requiredMethods[i]}()`);
      }
    }
    return value;
  }

  // Jointの種別名を返す
  // Joint別クラスが上書きし、診断表示と将来のGPU pack形式へ渡す
  getType() {
    return "Joint";
  }

  // body Aを返す
  getBodyA() {
    return this.bodyA;
  }

  // body Bを返す
  getBodyB() {
    return this.bodyB;
  }

  // 接続body間の通常接触を許可するか返す
  // falseではJoint拘束だけを残し、PhysicsSpaceが同じbody pairの接触を候補から除外する
  getCollideConnected() {
    return this.collideConnected;
  }

  // XPBDのcomplianceを返す
  // 0は硬い拘束、正の値は単位系に応じた有限の柔らかさを表し、未指定値を勝手に補正しない
  getCompliance() {
    return this.compliance;
  }

  // 指定したconstraint rowの累積lambdaを返す
  // 初回や新しいrow名では0から開始し、過去stepの値がないことを明示する
  getPositionConstraintLambda(rowName) {
    if (typeof rowName !== "string" || rowName.length === 0) {
      throw new Error("Joint position constraint rowName must be a non-empty string");
    }
    return this.positionConstraintLambdas.get(rowName) ?? 0.0;
  }

  // 指定したconstraint rowの累積lambdaを保存する
  // solverで求めたdeltaではなく、次stepに使う合計lambdaだけを保持する
  setPositionConstraintLambda(rowName, value) {
    if (typeof rowName !== "string" || rowName.length === 0) {
      throw new Error("Joint position constraint rowName must be a non-empty string");
    }
    this.positionConstraintLambdas.set(
      rowName,
      util.readFiniteNumber(value, `Joint ${rowName} position constraint lambda`)
    );
  }

  // XPBDの累積lambdaを明示的に消去する
  // Jointを再利用してtargetやbodyを差し替える場合に、過去の拘束力を持ち越さないために使う
  resetPositionConstraintLambdas() {
    this.positionConstraintLambdas.clear();
    return this;
  }

  // Jointの有効状態を変更する
  setEnabled(enabled) {
    this.enabled = util.readOptionalBoolean(enabled, "Joint enabled", this.enabled);
    return this;
  }

  // Jointの有効状態を返す
  isEnabled() {
    return this.enabled;
  }

  // 現在の誤差から補正対象の誤差を求める
  // slopは小さな数値振動だけを抑える明示設定であり、距離や角度を別の値へ自動補正しない
  getPositionCorrectionError(error) {
    const magnitude = Math.max(0.0, Math.abs(error) - this.positionCorrectionSlop);
    return Math.sign(error) * magnitude;
  }

  // Joint別の現在制約行を返す
  // 共通solverはこの配列だけを扱い、Distance/Hingeの式をPhysicsSpaceへ混在させない
  buildConstraintRows() {
    throw new Error(`${this.getType()} must implement buildConstraintRows()`);
  }
}
