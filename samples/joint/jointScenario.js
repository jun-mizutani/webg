// ---------------------------------------------
//  samples/joint/jointScenario.js  2026/08/26
//   Common scenario definitions for CPU and Compute Joint samples
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import Quat from "../../webg/Quat.js";

// CPU版、GPU Compute版、GPU readback Node版で同じ物理シナリオを再現するための重力とfixed stepです
// 描画frameの間隔はブラウザーの状態で変動するため、物理計算へ直接渡さず、各sampleがこの固定値へ分配します
export const GRAVITY = [0.0, -9.80665, 0.0];
export const FIXED_TIME_STEP_MS = 1000.0 / 120.0;
export const FIXED_TIME_STEP_SEC = FIXED_TIME_STEP_MS * 0.001;
export const MAX_SUB_STEPS = 8;

// 六本のロープを画面の左右と前後へ少しずつずらし、一本ずつの揺れを見分けられる配置にします
// X列は操作Capsuleの通過順、Z列は奥行きの違いを表し、三方式で同じbody配置を使う基準になります
export const ROPE_COLUMN_X_POSITIONS = [-1.80, -1.08, -0.36, 0.36, 1.08, 1.80];
export const ROPE_COLUMN_Z_POSITIONS = [-0.18, -0.10, -0.02, 0.06, 0.14, 0.22];
export const ROPE_TOP_PIVOT_Y = 5.55;
export const ROPE_TOP_PIVOT_RADIUS = 0.10;
export const ROPE_TOP_ANCHOR_OFFSET = 0.14;
export const ROPE_LINK_COUNT = 10;
export const ROPE_LINK_RADIUS = 0.06;
export const ROPE_LINK_SEGMENT_LENGTH = 0.18;
export const ROPE_LINK_ANCHOR = 0.14;
export const ROPE_ANCHOR_GAP = 0.025;
export const ROPE_LINK_MASS = 0.50;
export const ROPE_LINK_LINEAR_DAMPING = 0.30;
export const ROPE_LINK_ANGULAR_DAMPING = 0.82;

// 振り子の目標周期から小振幅理論式でDistanceJointの距離を定めます
// T=2π√(L/g)をL=|g|(T/(2π))²へ変形し、各solverへ同じ距離を渡します
// 実際の振幅、減衰、solver誤差を含むため、Help Panelには実測周期を表示します
export const PENDULUM_TARGET_PERIOD_SEC = 3.0;
export const PENDULUM_DISTANCE = Math.abs(GRAVITY[1])
  * (PENDULUM_TARGET_PERIOD_SEC / (2.0 * Math.PI)) ** 2;
export const PENDULUM_INITIAL_ANGLE_RADIANS = 20.0 * Math.PI / 180.0;
export const PENDULUM_PIVOT_ROPE_INDEX = 0;
export const PENDULUM_PIVOT_OFFSET_X = -1.0;
export const PENDULUM_LINEAR_DAMPING = 0.00875;
export const PENDULUM_ANGULAR_DAMPING = 0.02;

// 振り子の支点を左端ロープの根元からworld X方向へ1m左へ移し、初期角度20度で振幅を約2倍にします
export const PENDULUM_PIVOT_POSITION = [
  ROPE_COLUMN_X_POSITIONS[PENDULUM_PIVOT_ROPE_INDEX] + PENDULUM_PIVOT_OFFSET_X,
  ROPE_TOP_PIVOT_Y,
  ROPE_COLUMN_Z_POSITIONS[PENDULUM_PIVOT_ROPE_INDEX]
];
export const PENDULUM_WEIGHT_POSITION = [
  PENDULUM_PIVOT_POSITION[0] + Math.sin(PENDULUM_INITIAL_ANGLE_RADIANS) * PENDULUM_DISTANCE,
  PENDULUM_PIVOT_POSITION[1] - Math.cos(PENDULUM_INITIAL_ANGLE_RADIANS) * PENDULUM_DISTANCE,
  PENDULUM_PIVOT_POSITION[2]
];
export const PENDULUM_WEIGHT_RADIUS = 0.18;

// 支点と球を画面上でつなぐ質量なしの表示用Capsuleの寸法です
// 物理bodyへ登録せず、各sampleのDistanceJoint anchorから姿勢だけを更新します
// そのためconnectorは重力、接触、Joint solverへ影響を与えず、振り子の状態を説明する描画要素だけになります
export const PENDULUM_CONNECTOR_RADIUS = 0.0175;
export const PENDULUM_CONNECTOR_SEGMENT_LENGTH = PENDULUM_DISTANCE
  - 2.0 * PENDULUM_CONNECTOR_RADIUS;

// Compute body IDはslot番号と分けて固定し、reset後もJoint descriptorから同じbodyを参照します
// IDは物理bodyを識別する外部値、slotはGPU配列上の位置として、resetや描画方式が変わっても役割を保ちます
export const PENDULUM_PIVOT_ID = 1;
export const PENDULUM_WEIGHT_ID = 2;
export const ROPE_PIVOT_ID_BASE = 10;
export const ROPE_LINK_ID_BASE = 100;
export const CROSSING_CAPSULE_ID = 1000;

// 画面の前後方向を長軸にしたCapsuleを、ロープの中央付近で左右へ移動させます
export const CROSSING_CAPSULE_START_X = -3.30;
export const CROSSING_CAPSULE_END_X = 3.30;
export const CROSSING_CAPSULE_Y = 4.00;
export const CROSSING_CAPSULE_Z = 0.0;
export const CROSSING_CAPSULE_RADIUS = 0.33;
export const CROSSING_CAPSULE_SEGMENT_LENGTH = 1.20;
export const CROSSING_CAPSULE_SPEED = 0.80;
export const CROSSING_CAPSULE_DEFAULT_MODE = "quasiStatic";
export const CROSSING_CAPSULE_ORIENTATION = [
  Math.cos(Math.PI * 0.25),
  Math.sin(Math.PI * 0.25),
  0.0,
  0.0
];

// 三つのsampleで同じ起動時の視点を使い、物理結果と描画経路の違いを比較しやすくします
export const CAMERA = {
  target: [-0.18, 3.55, -0.28],
  distance: 6.90,
  yaw: -46.37,
  pitch: -32.61,
  roll: -23.80,
  minDistance: 6.0,
  maxDistance: 15.0
};

// local Y軸を指定した方向へ向けるNode用quaternionを作ります
// Primitive.capsuleの長軸とJoint anchor間方向を同じ回転で一致させます
// webgのQuatは[w, x, y, z]の順なので、Y軸から指定方向への最短回転を半角公式で直接構成します
// 反平行のときだけ通常の外積公式が特異になるため、X軸180度回転を明示的に選びます
export function createQuaternionFromUpDirection(direction) {
  const length = Math.hypot(direction[0], direction[1], direction[2]);
  if (!Number.isFinite(length) || length <= 1.0e-8) {
    throw new Error("createQuaternionFromUpDirection requires a non-zero finite direction");
  }
  const x = direction[0] / length;
  const y = direction[1] / length;
  const z = direction[2] / length;
  const quaternion = new Quat();
  if (y <= -1.0 + 1.0e-8) {
    quaternion.setRotateX(180.0);
    return quaternion;
  }
  const scale = Math.sqrt(2.0 * (1.0 + y));
  quaternion.q[0] = 0.5 * scale;
  quaternion.q[1] = z / scale;
  quaternion.q[2] = 0.0;
  quaternion.q[3] = -x / scale;
  quaternion.normalize();
  return quaternion;
}

// 初期状態の四元数配列をNode APIで使うQuatへ変換し、入力値を正規化して返します
// Compute body descriptorとNodeの初期姿勢を同じ配列から作るため、方式間で初期回転をそろえます
export function createQuatFromArray(value) {
  const quaternion = new Quat();
  quaternion.q[0] = value[0];
  quaternion.q[1] = value[1];
  quaternion.q[2] = value[2];
  quaternion.q[3] = value[3];
  quaternion.normalize();
  return quaternion;
}
