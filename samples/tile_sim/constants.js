// ---------------------------------------------
// samples/tile_sim/constants.js  2026/04/24
//   tile_sim sample
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
// この module は、tile_sim sample 全体で共有する定数をまとめる
// - 盤面サイズ、ball の見え方、marker 寸法、mission 制約を 1 か所で読めるようにする
// - terrain / camera / mission / controller の各 module が同じ値を参照し、値のずれを防ぐ

// tile_sim sample 全体で共有する定数をここへ集める
// - terrain 生成、TileMap 定義、ball の見え方、mission の制約を 1 か所で追えるようにする
// - main.js と helper module が同じ値を参照し、値のずれを防ぐ

export const FONT_FILE = "../../webg/font512.png";
export const MAP_WIDTH = 12;
export const MAP_HEIGHT = 12;
export const CELL_SIZE = 4.0;
export const CELL_GAP = 0.10;
export const FLOOR_Y = -0.30;
export const BASE_TOP_Y = 0.72;
export const HEIGHT_STEP_Y = 1.12;
export const BALL_RADIUS = 0.82;
export const BALL_LIFT = 0.04;
export const BALL_MOVE_DURATION_MS = 250;
export const DISPLAY_AREA_SCROLL_DURATION_MS = 350;
export const BALL_BOUNCE_HEIGHT = 0.58;
export const TERRAIN_TEXTURE_SIZE = 1024;
export const HEIGHT_RANDOM_SEED = 17;
export const MAX_TERRAIN_HEIGHT = 5;
export const BEACON_COUNT = 2;
export const MARKER_BASE_Y = 0.04;
export const MARKER_STEM_WIDTH = 0.22;
export const MARKER_STEM_HEIGHT = 0.92;
export const MARKER_HEAD_SIZE = 0.62;
export const MARKER_HEAD_OFFSET_Y = 1.02;
export const MARKER_SPIN_DEG_PER_SEC = 92.0;
export const MOVE_BUDGET_PADDING = 6;
export const MOVE_BUDGET_RATIO = 0.35;
export const HUMAN_CELL_FORMATION_RATIO = 0.20;

// 盤面を見回しやすい角度を、標準 sample の camera preset として持っておく
export const ORBIT_PRESETS = [
  {
    label: "diagonal",
    yaw: 28.0,
    pitch: -30.0,
    distance: 18.7
  },
  {
    label: "side",
    yaw: 90.0,
    pitch: -24.0,
    distance: 20.2
  },
  {
    label: "overhead",
    yaw: 0.0,
    pitch: -78.0,
    distance: 8.2
  }
];
