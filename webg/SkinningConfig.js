// ---------------------------------------------
// SkinningConfig.js 2026/03/10
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// 既定の importer は Rigify helper を prune / collapse して
// mesh ごとの必要 bone 数をかなり圧縮できるため、
// 実運用上限は 320 bones を既定とする
// 1 bone あたり 3 vec4 = 12 floats = 48 bytes を使うため、
// BonePhong 系の palette 本体は 320 * 48 = 15360 bytes で収まる
// BonePhong のヘッダ 256 bytes を加えても 15616 bytes であり、
// uniform buffer として十分余裕がある
export const DEFAULT_MAX_SKIN_BONES = 320;

// 3x4 行列を vec4 x 3 で送る現行 BonePhong 系の palette 表現
export const SKIN_MATRIX_VECTORS_PER_BONE = 3;
export const SKIN_MATRIX_FLOATS_PER_BONE = SKIN_MATRIX_VECTORS_PER_BONE * 4;

// WebGPU dynamic uniform offset は 256 bytes 境界が必要なので、
// BonePhong / BoneNormPhong の 1 draw 分サイズを 256 bytes に切り上げる
export function alignTo(value, alignment = 256) {
  return Math.ceil(value / alignment) * alignment;
}
