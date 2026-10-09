// ---------------------------------------------
//  karakuri_physics_defaults.js  2026/09/17
//   Shared physical defaults for Karakuri Maker parts
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// 球とドミノへ同じ密度を適用し、見た目の材質設定と物理の質量を分けて管理します
export const ALUMINUM_DENSITY_KG_PER_M3 = 2700.0;

// Makerで追加する標準球の形状と、密度から求めた質量を定義します
export const DEFAULT_BALL_RADIUS = 0.12;
export const DEFAULT_BALL_MASS = ALUMINUM_DENSITY_KG_PER_M3
  * (4.0 / 3.0)
  * Math.PI
  * DEFAULT_BALL_RADIUS ** 3;

// Makerで一括配置するドミノの寸法と、直方体の体積から求めた質量を定義します
export const DEFAULT_DOMINO_SIZE = Object.freeze([0.10, 0.6, 0.32]);
export const DEFAULT_DOMINO_MASS = ALUMINUM_DENSITY_KG_PER_M3
  * DEFAULT_DOMINO_SIZE[0]
  * DEFAULT_DOMINO_SIZE[1]
  * DEFAULT_DOMINO_SIZE[2];
