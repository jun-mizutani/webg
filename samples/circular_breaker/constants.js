// ---------------------------------------------
// samples/circular_breaker/constants.js  2026/03/03
//   circular_breaker sample
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
// 角度変換用の定数（degree <-> radian）
export const DEG = Math.PI / 180.0;
export const RAD = 180.0 / Math.PI;

// アリーナやオブジェクト配置の基準寸法
export const ARENA_RADIUS = 62.0;
export const ARENA_WALL_RADIUS = ARENA_RADIUS + 4.0;
export const BLOCK_RING_RADIUS = 54.0;
export const BLOCK_COUNT = 28;
export const BLOCK_HIT_RADIUS = 4.0;
export const FLOOR_HEIGHT = 2.4;
export const FLOOR_Y = -2.8;
export const FLOOR_TOP_Y = FLOOR_Y + FLOOR_HEIGHT * 0.5;
export const FLOOR_PATTERN_Y = FLOOR_TOP_Y + 0.08;
export const FLOOR_RING_Y = FLOOR_TOP_Y + 0.16;
export const SHADOW_Y = FLOOR_TOP_Y + 0.06;

// パドル寸法・可動範囲
export const PADDLE_HALF_LEN = 6.2;
export const PADDLE_HALF_DEPTH = 1.5;
export const PADDLE_Y = 2.2;
export const PADDLE_MOVE_LIMIT = ARENA_RADIUS - 10.0;

// パック寸法
export const PUCK_RADIUS = 1.8;
export const PUCK_Y = 2.0;

// 粒子エフェクト設定
export const PARTICLE_POOL = 160;
export const PARTICLES_PER_HIT = 16;

// ステージ進行設定
export const STAGE_TIME_LIMIT_SEC = 60.0;
export const STAGE_BASE_TARGET_BREAKS = 5;
export const STAGE_INTRO_MAX_SEC = 10.0;
export const STAGE_CLEAR_BANNER_SEC = 3.0;
export const STAGE_LAUNCH_RANDOM_DEG = 20.0;

// 汎用ユーティリティ（2D平面XZでの計算を中心に使用）
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const len2 = (x, z) => Math.sqrt(x * x + z * z);
export const dot2 = (ax, az, bx, bz) => ax * bx + az * bz;

export const norm2 = (x, z) => {
  const d = Math.sqrt(x * x + z * z);
  if (d <= 1.0e-6) return [0.0, 0.0];
  return [x / d, z / d];
};

export const reflect2 = (vx, vz, nx, nz) => {
  const vv = dot2(vx, vz, nx, nz);
  return [vx - 2.0 * vv * nx, vz - 2.0 * vv * nz];
};
