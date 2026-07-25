// ---------------------------------------------
// ColorSpace.js   2026/07/14
//   Shared sRGB and linear-color conversions
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import util from "./util.js";

// gamma optionの既定値を、標準sRGB出力に対する表示調整の基準として共有します
// sRGB自体は単純な2.2乗ではなく、暗部に線形区間を持つ伝達関数です
export const SRGB_REFERENCE_GAMMA = 2.2;

// G-buffer入力と最終表示出力が同じ伝達関数を使うよう、WGSL実装を一箇所に定義します
// 入力範囲は呼び出し側の材質契約またはtone mappingで0から1に確定させます
export const COLOR_SPACE_WGSL = `
fn srgbToLinearChannel(value : f32) -> f32 {
  if (value <= 0.04045) {
    return value / 12.92;
  }
  return pow((value + 0.055) / 1.055, 2.4);
}

fn srgbToLinear(value : vec3f) -> vec3f {
  return vec3f(
    srgbToLinearChannel(value.r),
    srgbToLinearChannel(value.g),
    srgbToLinearChannel(value.b)
  );
}

fn linearToSrgbChannel(value : f32) -> f32 {
  if (value <= 0.0031308) {
    return value * 12.92;
  }
  return 1.055 * pow(value, 1.0 / 2.4) - 0.055;
}

fn linearToSrgb(value : vec3f) -> vec3f {
  return vec3f(
    linearToSrgbChannel(value.r),
    linearToSrgbChannel(value.g),
    linearToSrgbChannel(value.b)
  );
}
`;

// CPU側で指定されたsRGB channelを、WGSLと同じ規則で線形値へ変換します
export function srgbChannelToLinear(value, label = "sRGB channel") {
  const checked = util.readFiniteNumber(value, label, { min: 0.0, max: 1.0 });
  if (checked <= 0.04045) {
    return checked / 12.92;
  }
  return ((checked + 0.055) / 1.055) ** 2.4;
}

// 数値テストとCPU処理向けに、線形channelからsRGBへの逆変換も同じ境界値で提供します
export function linearChannelToSrgb(value, label = "linear channel") {
  const checked = util.readFiniteNumber(value, label, { min: 0.0, max: 1.0 });
  if (checked <= 0.0031308) {
    return checked * 12.92;
  }
  return 1.055 * (checked ** (1.0 / 2.4)) - 0.055;
}

// WebgAppのclearColorは表示用sRGBで指定されるため、G-bufferの線形背景値へ変換します
// alphaは色伝達関数の対象外なので、有限範囲を検証した値をそのまま維持します
export function srgbColorToLinear(value, label = "sRGB color") {
  const checked = util.readColor(value, label, undefined, 4);
  const alpha = util.readFiniteNumber(checked[3], `${label}[3]`, { min: 0.0, max: 1.0 });
  return [
    srgbChannelToLinear(checked[0], `${label}[0]`),
    srgbChannelToLinear(checked[1], `${label}[1]`),
    srgbChannelToLinear(checked[2], `${label}[2]`),
    alpha
  ];
}
