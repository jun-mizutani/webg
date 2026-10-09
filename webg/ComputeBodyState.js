// ---------------------------------------------
// ComputeBodyState.js  2026/09/13
//   Shared GPU body-state layouts and Compute physics defaults
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// BodyStateは8個のvec4を固定順に並べ、Computeと描画が同じStorage Bufferを共有します
// offsetはfloat単位で公開し、描画shaderがJavaScript側の暗黙の並びへ依存しないようにします
export const COMPUTE_PHYSICS_BODY_STATE_LAYOUT = Object.freeze({
  strideFloats: 32,
  strideBytes: 32 * Float32Array.BYTES_PER_ELEMENT,
  position: 0,
  orientation: 4,
  linearVelocityInvMass: 8,
  angularVelocitySleep: 12,
  halfExtentsSleepCounter: 16,
  inverseInertiaLocal: 20,
  colliderType: 23,
  material: 24,
  color: 28
});

// BodyControlのvec4配置を公開し、外部命令とbody属性のGPU側解釈を固定します
// BodyStateを変更せず、描画用bufferとsimulation用の可変設定を分離します
// surfaceVelocityはkinematic bodyの接触点へだけ加える搬送用速度で、通常のlinearVelocityとは別に保持します
export const COMPUTE_PHYSICS_BODY_CONTROL_LAYOUT = Object.freeze({
  strideFloats: 52,
  strideBytes: 52 * Float32Array.BYTES_PER_ELEMENT,
  config: 0,
  collision: 4,
  properties: 8,
  force: 12,
  torque: 16,
  linearImpulse: 20,
  angularImpulse: 24,
  linearVelocity: 28,
  angularVelocity: 32,
  position: 36,
  orientation: 40,
  commandFlags: 44,
  surfaceVelocity: 48
});

// Compute版body種別をGPUへ渡す値として公開します
// staticは固定、kinematicは指定速度で移動、dynamicは重力と接触応答を受けます
export const COMPUTE_PHYSICS_BODY_TYPES = Object.freeze({
  static: 0,
  kinematic: 1,
  dynamic: 2
});

// BodyControl.commandFlagsへ設定する一回限りの命令bitを公開します
// 命令は次のfixed stepで適用した後、GPU側で自動的に消費されます
export const COMPUTE_PHYSICS_BODY_COMMAND_FLAGS = Object.freeze({
  setLinearVelocity: 1 << 0,
  setAngularVelocity: 1 << 1,
  teleportPosition: 1 << 2,
  teleportOrientation: 1 << 3,
  wake: 1 << 4,
  sleep: 1 << 5,
  stopMotion: 1 << 6
});

// Compute版はXZ Gridを固定使用し、CPU版のbruteForceやsweepAabbとは分けて管理します
export const COMPUTE_PHYSICS_BROADPHASE_MODE = "xzGrid";

// 基準寸法に比例させる値を比率としてまとめ、任意サイズの直方体へ同じ規則を適用します
// 速度比率はreferenceLength毎秒、長さ比率はreferenceLengthに対する倍率として解釈します
export const DEFAULT_COMPUTE_PHYSICS_SCALE = Object.freeze({
  referenceLength: 0.08,
  broadphasePaddingRatio: 0.0125,
  positionSlopRatio: 0.00625,
  supportFeatureToleranceRatio: 0.125,
  restingRestitutionSpeedRatio: 6.25,
  sleepLinearSpeedRatio: 0.25,
  wakeLinearSpeedRatio: 0.375,
  sleepContactSpeedRatio: 0.125,
  sleepNormalSpeedRatio: 0.25
});

// Compute bodyのmaterial既定値を一箇所へ集め、packBodyと外部制御で同じ値を使います
export const DEFAULT_BODY_MATERIAL = Object.freeze({
  restitution: 0.02,
  friction: 0.8,
  linearDamping: 0.08,
  angularDamping: 0.12
});

// BodyControlへ書き込む属性の既定値をまとめ、未指定値だけへ明示的に適用します
export const DEFAULT_BODY_CONTROL = Object.freeze({
  bodyType: "dynamic",
  gravityScale: 1,
  allowSleep: true,
  isTrigger: false,
  fixedRotation: false,
  collisionLayer: 1,
  collisionMask: 0xffffffff
});

// WGSLの固定dispatchとUniform配列の容量を共通化します
export const PARAM_FLOATS = 32;
export const WORKGROUP_SIZE = 64;
export const MAX_SOLVER_ITERATIONS = 32;
