// ---------------------------------------------
// ProceduralEnvironment.js  2026/09/04
//   Named procedural IBL environments and PNG export
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import util from "./util.js";
import { LINEAR_SRGB_PRIMARIES } from "./RadianceHdr.js";

const PI = Math.PI;
const TWO_PI = PI * 2.0;
const DEFAULT_PRESET = "dark-studio";
const DEFAULT_ENVIRONMENT_RESOLUTION = Object.freeze({ width: 64, height: 32 });
const MAX_PNG_OUTPUT_PIXELS = 8192 * 4096;

// 利用者が指定できる環境名を固定し、登録済みpreset名だけを受け付けます
export const PROCEDURAL_ENVIRONMENT_PRESETS = Object.freeze([
  "blue-sky",
  "dark-studio",
  "bright-forest",
  "sunset-ocean",
  "bright-summer-ocean",
  "woody-room-two-windows"
]);

// preset一覧を新しい配列で返し、呼び出し側が公開一覧を変更できないようにします
export function listProceduralEnvironmentPresets() {
  return [...PROCEDURAL_ENVIRONMENT_PRESETS];
}

// 緯度経度UVをshader samplingと同じworld-space単位方向へ戻します
function directionFromUv(u, v) {
  const longitude = (u - 0.5) * TWO_PI;
  const latitude = v * PI;
  const sinLatitude = Math.sin(latitude);
  return [
    Math.cos(longitude) * sinLatitude,
    Math.cos(latitude),
    Math.sin(longitude) * sinLatitude
  ];
}

// unit directionをPNG previewで使う緯度経度UVへ変換します
function directionToUv(direction) {
  const length = Math.hypot(...direction);
  if (!Number.isFinite(length) || length <= 0.0) {
    throw new Error("Procedural environment generated a non-normalizable direction");
  }
  const normalized = direction.map((value) => value / length);
  return [
    Math.atan2(normalized[2], normalized[0]) / TWO_PI + 0.5,
    Math.acos(Math.min(Math.max(normalized[1], -1.0), 1.0)) / PI
  ];
}

// 生成した3次元方向を正規化し、光源方向のdot計算を同じ基準へそろえます
function normalizeGenerated3(value, label) {
  const length = Math.hypot(...value);
  if (!Number.isFinite(length) || length <= 0.0) {
    throw new Error(`${label} generated a non-normalizable direction`);
  }
  return value.map((component) => component / length);
}

// 二つの3次元方向の内積を返し、環境内の光源との角度を評価します
function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

// 二つの3次元ベクトルの外積を返し、球面上の接線基底を作ります
function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

// 3 channelの線形色を加算し、各presetの光源を環境色へ重ねます
function addScaledColor(color, source, scale) {
  return [
    color[0] + source[0] * scale,
    color[1] + source[1] * scale,
    color[2] + source[2] * scale
  ];
}

// 二つの3 channel色を補間し、空と地面または空と海の境界を作ります
function mixColor(a, b, amount) {
  return [
    a[0] * (1.0 - amount) + b[0] * amount,
    a[1] * (1.0 - amount) + b[1] * amount,
    a[2] * (1.0 - amount) + b[2] * amount
  ];
}

// 0から1のsmoothstepを返し、環境内の帯や窓の境界を滑らかにします
function smoothStep(edge0, edge1, value) {
  const amount = Math.min(Math.max((value - edge0) / (edge1 - edge0), 0.0), 1.0);
  return amount * amount * (3.0 - 2.0 * amount);
}

// 光源の方向と色を一つの不変定義へまとめ、全roughness levelで同じ位置を使います
function createDirectionalSource(direction, color, intensity, exponent) {
  return Object.freeze({
    direction: Object.freeze(normalizeGenerated3(direction, "Procedural environment source")),
    color: Object.freeze([...color]),
    intensity,
    exponent
  });
}

// roughnessに応じて角度ローブを広げ、金属反射のmip levelへ対応する光源を作ります
function addDirectionalSource(color, direction, source, roughness) {
  const exponent = Math.max(source.exponent * (1.0 - roughness * 0.70), 1.0);
  const lobe = Math.pow(Math.max(dot3(direction, source.direction), 0.0), exponent);
  const intensity = source.intensity * (1.0 - roughness * 0.25);
  return addScaledColor(color, source.color, lobe * intensity);
}

// reflection directionの周囲をroughnessに応じた角度でずらし、球面上のぼかしsample方向を作ります
function offsetEnvironmentDirection(direction, tangent, bitangent, tangentOffset, bitangentOffset) {
  return normalizeGenerated3([
    direction[0] + tangent[0] * tangentOffset + bitangent[0] * bitangentOffset,
    direction[1] + tangent[1] * tangentOffset + bitangent[1] * bitangentOffset,
    direction[2] + tangent[2] * tangentOffset + bitangent[2] * bitangentOffset
  ], "Procedural environment blur");
}

// 法線方向に直交する二つの接線を作り、半球sampleをworld directionへ変換できるようにします
function createEnvironmentTangentBasis(direction) {
  const reference = Math.abs(direction[1]) < 0.9
    ? [0.0, 1.0, 0.0]
    : [1.0, 0.0, 0.0];
  const tangent = normalizeGenerated3(
    cross3(reference, direction),
    "Procedural environment tangent"
  );
  const bitangent = normalizeGenerated3(
    cross3(direction, tangent),
    "Procedural environment bitangent"
  );
  return { tangent, bitangent };
}

// Procedural samplerが作ったパネルや色付き光源を球面近傍で重み付き平均し、roughness別levelを事前ぼかしします
// 緯度経度画像のU/Vを直接ずらさず、方向ベクトルの接線基底を使うことで極付近でも歪みを抑えます
function samplePrefilteredEnvironment(direction, roughness, sampler) {
  if (roughness <= 0.0) {
    return sampler(direction, roughness);
  }

  const { tangent, bitangent } = createEnvironmentTangentBasis(direction);

  // roughnessが高いほどGGX反射の広がりが増えるため、基準半径を最大約56度まで広げます
  const blurAngle = 0.02 + 0.95 * roughness * roughness;
  // 粗い面では中心方向だけを強く残すと光源形状が再現されるため、中心の重みをroughnessで下げます
  const centerWeight = 4.0 - 3.0 * roughness;
  // 高roughnessほど外周方向の寄与を増やし、大きな環境パネルの形をさらに低周波化します
  const outerWeight = roughness;
  const samples = [
    [0.0, 0.0, centerWeight],
    [-1.0, -1.0, 1.0],
    [0.0, -1.0, 2.0],
    [1.0, -1.0, 1.0],
    [-1.0, 0.0, 2.0],
    [1.0, 0.0, 2.0],
    [-1.0, 1.0, 1.0],
    [0.0, 1.0, 2.0],
    [1.0, 1.0, 1.0],
    [-2.0, 0.0, outerWeight],
    [-1.41421356, -1.41421356, outerWeight],
    [0.0, -2.0, outerWeight],
    [1.41421356, -1.41421356, outerWeight],
    [2.0, 0.0, outerWeight],
    [1.41421356, 1.41421356, outerWeight],
    [0.0, 2.0, outerWeight],
    [-1.41421356, 1.41421356, outerWeight]
  ];
  let totalWeight = 0.0;
  let color = [0.0, 0.0, 0.0];
  for (const [tangentScale, bitangentScale, weight] of samples) {
    if (weight <= 0.0) {
      continue;
    }
    const sampleDirection = offsetEnvironmentDirection(
      direction,
      tangent,
      bitangent,
      tangentScale * blurAngle,
      bitangentScale * blurAngle
    );
    color = addScaledColor(
      color,
      sampler(sampleDirection, roughness),
      weight
    );
    totalWeight += weight;
  }
  return color.map((value) => value / totalWeight);
}

// cosine-weighted hemisphere sampleを作り、拡散IBLの半球積分へ使うlocal directionを返します
function cosineSampleHemisphere(index, sampleCount) {
  const radial = Math.sqrt((index + 0.5) / sampleCount);
  const angle = TWO_PI * ((index * 0.6180339887498949) % 1.0);
  return [
    radial * Math.cos(angle),
    radial * Math.sin(angle),
    Math.sqrt(Math.max(1.0 - radial * radial, 0.0))
  ];
}

// 法線を中心とする半球全体をcosine weightingで積分し、拡散用irradianceを生成します
// roughness別の単一方向sampleを拡散光へ流用せず、環境radianceの高周波形状を半球積分で除去します
function sampleDiffuseIrradiance(direction, sampler) {
  const { tangent, bitangent } = createEnvironmentTangentBasis(direction);
  const sampleCount = 128;
  let irradiance = [0.0, 0.0, 0.0];
  for (let index = 0; index < sampleCount; index += 1) {
    const local = cosineSampleHemisphere(index, sampleCount);
    const sampleDirection = normalizeGenerated3([
      tangent[0] * local[0] + bitangent[0] * local[1] + direction[0] * local[2],
      tangent[1] * local[0] + bitangent[1] * local[1] + direction[1] * local[2],
      tangent[2] * local[0] + bitangent[2] * local[1] + direction[2] * local[2]
    ], "Procedural environment irradiance");
    irradiance = addScaledColor(
      irradiance,
      sampler(sampleDirection, 0.0),
      1.0
    );
  }
  // cosine-weighted samplingの期待値へπを掛け、irradiance = ∫ L cos(theta) dωへ戻します
  return irradiance.map((value) => PI * value / sampleCount);
}

// 緯度経度Uの周期境界をまたぐ最短距離を返し、左右端の窓や雲を連続させます
function wrappedDistance(a, b) {
  const distance = Math.abs(a - b);
  return Math.min(distance, 1.0 - distance);
}

// 緯度経度画像上の矩形パネルをsoft edge付きで評価し、窓や雲を面光源として表します
function sampleRectangularPatch(direction, patch, roughness) {
  const [u, v] = directionToUv(direction);
  const uDistance = wrappedDistance(u, patch.centerU);
  const vDistance = Math.abs(v - patch.centerV);
  const softness = patch.softness + roughness * 0.08;
  const uMask = 1.0 - smoothStep(patch.width * 0.5, patch.width * 0.5 + softness, uDistance);
  const vMask = 1.0 - smoothStep(patch.height * 0.5, patch.height * 0.5 + softness, vDistance);
  return uMask * vMask;
}

// 矩形panelの中央へ縦横の仕切りを置き、4分割された窓の反射形状を返します
function sampleGridPanel(direction, patch, roughness) {
  const [u, v] = directionToUv(direction);
  const panelMask = sampleRectangularPatch(direction, patch, roughness);
  const lineSoftness = patch.lineWidth + roughness * 0.025;
  const verticalLine = 1.0 - smoothStep(
    patch.lineWidth,
    patch.lineWidth + lineSoftness,
    wrappedDistance(u, patch.centerU)
  );
  const horizontalLine = 1.0 - smoothStep(
    patch.lineWidth,
    patch.lineWidth + lineSoftness,
    Math.abs(v - patch.centerV)
  );
  return {
    panelMask,
    gridMask: panelMask * Math.max(verticalLine, horizontalLine)
  };
}

// blue-skyを明示した呼び出しで従来の青い空と白い主光源を再現します
function sampleBlueSky(direction, roughness) {
  const skyAmount = Math.max(direction[1] * 0.5 + 0.5, 0.0);
  const base = [
    0.045 + 0.32 * skyAmount,
    0.055 + 0.45 * skyAmount,
    0.075 + 0.72 * skyAmount
  ];
  const sunDirection = [0.45, 0.72, 0.53];
  const sunLength = Math.hypot(...sunDirection);
  const normalizedSun = sunDirection.map((value) => value / sunLength);
  const exponent = 2.0 + 510.0 * (1.0 - roughness) * (1.0 - roughness);
  const peak = 14.0 / (1.0 + roughness * 8.0);
  const sun = Math.pow(Math.max(dot3(direction, normalizedSun), 0.0), exponent) * peak;
  return [base[0] + sun, base[1] + sun * 0.82, base[2] + sun * 0.58];
}

// 黒いスタジオの-Z方向へ白色光を置き、小さな色付き光と4分割窓を反射させます
function sampleDarkStudio(direction, roughness) {
  let color = [0.002, 0.002, 0.003];
  color = addDirectionalSource(
    color,
    direction,
    DARK_STUDIO_KEY,
    roughness
  );
  color = addDirectionalSource(
    color,
    direction,
    DARK_STUDIO_FILL,
    roughness
  );
  color = addDirectionalSource(
    color,
    direction,
    DARK_STUDIO_RIM,
    roughness
  );
  color = addDirectionalSource(
    color,
    direction,
    DARK_STUDIO_ORANGE,
    roughness
  );

  // 光源のない床側にも弱い中立グレーを残し、PBRの間接光が完全な黒へ落ちる範囲を減らします
  // direction.yが負になるほど床側なので、-0.78以下で最大、-0.10以上で0になる滑らかなmaskを使います
  const floorAmount = 1.0 - smoothStep(-0.78, -0.10, direction[1]);
  color = addScaledColor(color, [0.045, 0.045, 0.045], floorAmount);

  // -Z方向の白色panelを主な反射形状にし、金属面へ大きすぎない縦長のハイライトを作ります
  const mainPanelMask = sampleRectangularPatch(direction, {
    centerU: 0.25,
    centerV: 0.43,
    width: 0.22,
    height: 0.24,
    softness: 0.018
  }, roughness);
  color = addScaledColor(color, [4.4, 4.35, 4.25], mainPanelMask);

  // 右側の暖色panelは白に近い色へ抑え、中央の縦線と横線で四つの窓に分けます
  const dividedWindow = sampleGridPanel(direction, {
    centerU: 0.80,
    centerV: 0.39,
    width: 0.22,
    height: 0.28,
    softness: 0.016,
    lineWidth: 0.010
  }, roughness);
  color = addScaledColor(
    color,
    [2.55, 2.40, 2.20],
    dividedWindow.panelMask
  );
  color = mixColor(color, [0.020, 0.018, 0.016], dividedWindow.gridMask);

  // オレンジと青は反射のアクセントとして小さく残し、白色panelの明るさを邪魔しないようにします
  const orangeAccentMask = sampleRectangularPatch(direction, {
    centerU: 0.16,
    centerV: 0.68,
    width: 0.085,
    height: 0.075,
    softness: 0.012
  }, roughness);
  color = addScaledColor(color, [0.80, 0.095, 0.018], orangeAccentMask);
  const blueAccentMask = sampleRectangularPatch(direction, {
    centerU: 0.91,
    centerV: 0.68,
    width: 0.075,
    height: 0.065,
    softness: 0.012
  }, roughness);
  return addScaledColor(color, [0.025, 0.12, 0.52], blueAccentMask);
}

// 緑の樹冠、暗い地面、木漏れ日の方向光を作り、森林内の反射色を構成します
function sampleBrightForest(direction, roughness) {
  const skyAmount = Math.max(direction[1] * 0.5 + 0.5, 0.0);
  const canopy = [0.055, 0.18, 0.085];
  const sky = [0.18, 0.38, 0.52];
  const ground = [0.012, 0.028, 0.010];
  let color = mixColor(ground, mixColor(canopy, sky, skyAmount), skyAmount * 0.72);
  color = addDirectionalSource(color, direction, BRIGHT_FOREST_SUN, roughness);
  color = addDirectionalSource(color, direction, BRIGHT_FOREST_SKY_GAP, roughness);
  const leafMask = sampleRectangularPatch(direction, {
    centerU: 0.66,
    centerV: 0.24,
    width: 0.28,
    height: 0.22,
    softness: 0.06
  }, roughness);
  return addScaledColor(color, [0.18, 0.52, 0.20], leafMask);
}

// 低い夕日、赤橙色の空、暗い海面を作り、金属へ暖色の水平反射を入れます
function sampleSunsetOcean(direction, roughness) {
  const skyAmount = Math.max(direction[1] * 0.5 + 0.5, 0.0);
  const sky = mixColor([0.18, 0.018, 0.008], [0.72, 0.18, 0.035], skyAmount);
  const ocean = [0.012, 0.020, 0.034];
  const oceanAmount = 1.0 - smoothStep(-0.12, 0.18, direction[1]);
  let color = mixColor(sky, ocean, oceanAmount);
  color = addDirectionalSource(color, direction, SUNSET_OCEAN_SUN, roughness);
  const horizonMask = 1.0 - smoothStep(0.0, 0.16, Math.abs(direction[1]));
  return addScaledColor(color, [0.72, 0.12, 0.025], horizonMask * (1.0 - roughness * 0.35));
}

// 青空、白い雲、高い太陽、青い海を作り、明るい夏の反射環境を構成します
function sampleBrightSummerOcean(direction, roughness) {
  const skyAmount = Math.max(direction[1] * 0.5 + 0.5, 0.0);
  const sky = mixColor([0.10, 0.30, 0.68], [0.34, 0.70, 1.20], skyAmount);
  const ocean = [0.015, 0.16, 0.28];
  const oceanAmount = 1.0 - smoothStep(-0.10, 0.22, direction[1]);
  let color = mixColor(sky, ocean, oceanAmount);
  color = addDirectionalSource(color, direction, SUMMER_OCEAN_SUN, roughness);
  for (const cloud of SUMMER_OCEAN_CLOUDS) {
    const cloudMask = sampleRectangularPatch(direction, cloud.patch, roughness);
    color = addScaledColor(color, cloud.color, cloudMask * cloud.intensity);
  }
  return color;
}

// 暗い木質室内に二つの大きな窓と暖色の木部を置き、長い窓反射を金属へ映します
function sampleWoodyRoomTwoWindows(direction, roughness) {
  const ceilingAmount = Math.max(direction[1], 0.0);
  let color = [
    0.018 + ceilingAmount * 0.018,
    0.008 + ceilingAmount * 0.010,
    0.004 + ceilingAmount * 0.004
  ];
  color = addDirectionalSource(color, direction, WOODY_ROOM_WARM_LIGHT, roughness);
  for (const window of WOODY_ROOM_WINDOWS) {
    const windowMask = sampleRectangularPatch(direction, window.patch, roughness);
    color = addScaledColor(color, window.color, windowMask * window.intensity);
  }
  const woodBeamMask = sampleRectangularPatch(direction, {
    centerU: 0.50,
    centerV: 0.78,
    width: 0.92,
    height: 0.10,
    softness: 0.035
  }, roughness);
  return addScaledColor(color, [0.20, 0.045, 0.012], woodBeamMask);
}

const DARK_STUDIO_KEY = createDirectionalSource(
  [0.00, 0.00, -1.00],
  [1.00, 0.98, 0.94],
  6.0,
  28.0
);
const DARK_STUDIO_FILL = createDirectionalSource(
  [-0.65, 0.28, 0.46],
  [0.025, 0.10, 0.24],
  1.0,
  30.0
);
const DARK_STUDIO_RIM = createDirectionalSource(
  [0.10, 0.88, -0.62],
  [0.72, 0.80, 0.95],
  1.2,
  38.0
);
const DARK_STUDIO_ORANGE = createDirectionalSource(
  [-0.48, 0.42, -0.76],
  [1.00, 0.14, 0.025],
  0.72,
  42.0
);
const BRIGHT_FOREST_SUN = createDirectionalSource(
  [0.42, 0.78, 0.46],
  [1.20, 0.72, 0.22],
  5.5,
  38.0
);
const BRIGHT_FOREST_SKY_GAP = createDirectionalSource(
  [-0.36, 0.62, 0.70],
  [0.20, 0.42, 0.18],
  2.8,
  12.0
);
const SUNSET_OCEAN_SUN = createDirectionalSource(
  [0.32, 0.12, 0.94],
  [1.35, 0.16, 0.025],
  8.0,
  70.0
);
const SUMMER_OCEAN_SUN = createDirectionalSource(
  [0.35, 0.78, 0.52],
  [1.20, 1.05, 0.72],
  5.5,
  45.0
);
const WOODY_ROOM_WARM_LIGHT = createDirectionalSource(
  [-0.18, 0.76, 0.63],
  [1.10, 0.38, 0.10],
  2.8,
  20.0
);

const SUMMER_OCEAN_CLOUDS = Object.freeze([
  Object.freeze({
    patch: Object.freeze({ centerU: 0.24, centerV: 0.28, width: 0.24, height: 0.12, softness: 0.055 }),
    color: Object.freeze([1.15, 1.20, 1.25]),
    intensity: 0.85
  }),
  Object.freeze({
    patch: Object.freeze({ centerU: 0.68, centerV: 0.22, width: 0.30, height: 0.14, softness: 0.065 }),
    color: Object.freeze([1.05, 1.14, 1.22]),
    intensity: 0.72
  })
]);

const WOODY_ROOM_WINDOWS = Object.freeze([
  Object.freeze({
    patch: Object.freeze({ centerU: 0.30, centerV: 0.40, width: 0.15, height: 0.42, softness: 0.018 }),
    color: Object.freeze([1.65, 1.82, 1.95]),
    intensity: 1.0
  }),
  Object.freeze({
    patch: Object.freeze({ centerU: 0.70, centerV: 0.40, width: 0.15, height: 0.42, softness: 0.018 }),
    color: Object.freeze([1.45, 1.65, 1.90]),
    intensity: 1.0
  })
]);

const PROCEDURAL_ENVIRONMENT_SAMPLERS = Object.freeze({
  "blue-sky": sampleBlueSky,
  "dark-studio": sampleDarkStudio,
  "bright-forest": sampleBrightForest,
  "sunset-ocean": sampleSunsetOcean,
  "bright-summer-ocean": sampleBrightSummerOcean,
  "woody-room-two-windows": sampleWoodyRoomTwoWindows
});

// 環境画像の基準サイズを検証し、緯度経度画像の2:1比を維持します
function readEnvironmentResolution(value) {
  if (value === undefined) return DEFAULT_ENVIRONMENT_RESOLUTION;
  const checked = util.readPlainObject(
    value,
    "Procedural environment options.resolution"
  );
  for (const key of Object.keys(checked)) {
    if (key !== "width" && key !== "height") {
      throw new Error(`Procedural environment options.resolution.${key} is not supported`);
    }
  }
  const width = util.readFiniteNumber(
    checked.width,
    "Procedural environment options.resolution.width",
    { integer: true, min: 2, max: 4096 }
  );
  const height = util.readFiniteNumber(
    checked.height,
    "Procedural environment options.resolution.height",
    { integer: true, min: 1, max: 2048 }
  );
  if (width !== height * 2) {
    throw new Error(
      "Procedural environment options.resolution must have a 2:1 width-to-height ratio"
    );
  }
  return { width, height };
}

// preset名と環境画像の基準サイズを検証し、内部samplerへ渡す値をまとめます
function readEnvironmentOptions(options) {
  const checked = util.readPlainObject(options, "Procedural environment options");
  for (const key of Object.keys(checked)) {
    if (key !== "preset" && key !== "resolution") {
      throw new Error(`Procedural environment options.${key} is not supported`);
    }
  }
  const preset = util.readOptionalEnum(
    checked.preset,
    "Procedural environment options.preset",
    DEFAULT_PRESET,
    PROCEDURAL_ENVIRONMENT_PRESETS
  );
  const resolution = readEnvironmentResolution(checked.resolution);
  if (typeof PROCEDURAL_ENVIRONMENT_SAMPLERS[preset] !== "function") {
    throw new Error(`Procedural environment preset ${preset} has no sampler`);
  }
  return { preset, resolution };
}

// 4 channel線形HDRの緯度経度levelを生成し、alphaはsamplingで未使用でも1へ固定します
function makeEnvironmentLevel(width, height, roughness, diffuseIrradiance, preset) {
  const data = new Float32Array(width * height * 4);
  const sampler = PROCEDURAL_ENVIRONMENT_SAMPLERS[preset];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const direction = directionFromUv((x + 0.5) / width, (y + 0.5) / height);
      const color = diffuseIrradiance
        ? sampleDiffuseIrradiance(direction, sampler)
        : samplePrefilteredEnvironment(direction, roughness, sampler);
      const offset = (y * width + x) * 4;
      data.set([color[0], color[1], color[2], 1.0], offset);
    }
  }
  return { width, height, data };
}

// 手続き環境のradianceだけを生成し、PbrEnvironmentComputeのlinear sRGB入力へ渡せる形式に整えます
// irradiance、specular、BRDF LUTはGPU Compute側で生成するため、PbrRendererのCPU初期化量を抑えます
export function createProceduralEnvironmentRadiance(options = {}) {
  const { preset, resolution } = readEnvironmentOptions(options);
  const level = makeEnvironmentLevel(
    resolution.width,
    resolution.height,
    0.0,
    false,
    preset
  );
  return {
    ...level,
    sourceFormat: "32-bit_rle_rgbe",
    dataFormat: "rgba32float",
    colorSpace: "linear-srgb",
    orientation: "-Y +X",
    pixelAspect: 1.0,
    primaries: [...LINEAR_SRGB_PRIMARIES]
  };
}

// Van der Corput列のbit反転値を0から1へ写し、BRDF LUTのsampleを決定的に分散させます
function radicalInverseVdc(value) {
  let bits = value >>> 0;
  bits = ((bits << 16) | (bits >>> 16)) >>> 0;
  bits = (((bits & 0x55555555) << 1) | ((bits & 0xaaaaaaaa) >>> 1)) >>> 0;
  bits = (((bits & 0x33333333) << 2) | ((bits & 0xcccccccc) >>> 2)) >>> 0;
  bits = (((bits & 0x0f0f0f0f) << 4) | ((bits & 0xf0f0f0f0) >>> 4)) >>> 0;
  bits = (((bits & 0x00ff00ff) << 8) | ((bits & 0xff00ff00) >>> 8)) >>> 0;
  return bits * 2.3283064365386963e-10;
}

// Hammersley点列を返し、BRDF LUTで同じ決定的sample数を使います
function hammersley(index, count) {
  return [index / count, radicalInverseVdc(index)];
}

// 接線spaceのGGX法線をimportance samplingし、BRDF積分の半ベクトルを作ります
function importanceSampleGgx(sample, roughness) {
  const alpha = roughness * roughness;
  const phi = TWO_PI * sample[0];
  const cosTheta = Math.sqrt((1.0 - sample[1]) / (1.0 + (alpha * alpha - 1.0) * sample[1]));
  const sinTheta = Math.sqrt(Math.max(1.0 - cosTheta * cosTheta, 0.0));
  return [Math.cos(phi) * sinTheta, Math.sin(phi) * sinTheta, cosTheta];
}

// IBL split-sum積分用のSchlick-GGX可視性項を評価します
function geometrySchlickGgx(nDotDirection, roughness) {
  const k = roughness * roughness * 0.5;
  return nDotDirection / (nDotDirection * (1.0 - k) + k);
}

// 一つのNdotVとroughnessについてF0係数Aとgrazing係数Bを数値積分します
function integrateBrdf(nDotV, roughness, sampleCount) {
  const view = [Math.sqrt(Math.max(1.0 - nDotV * nDotV, 0.0)), 0.0, nDotV];
  let scale = 0.0;
  let bias = 0.0;
  for (let index = 0; index < sampleCount; index += 1) {
    const halfVector = importanceSampleGgx(hammersley(index, sampleCount), roughness);
    const vDotH = Math.max(dot3(view, halfVector), 0.0);
    const light = [
      2.0 * vDotH * halfVector[0] - view[0],
      2.0 * vDotH * halfVector[1] - view[1],
      2.0 * vDotH * halfVector[2] - view[2]
    ];
    const nDotL = Math.max(light[2], 0.0);
    const nDotH = Math.max(halfVector[2], 0.0);
    if (nDotL > 0.0 && nDotH > 0.0) {
      const geometry = geometrySchlickGgx(nDotV, roughness)
        * geometrySchlickGgx(nDotL, roughness);
      const visibility = geometry * vDotH / Math.max(nDotH * nDotV, 1.0e-6);
      const fresnelWeight = Math.pow(1.0 - vDotH, 5.0);
      scale += (1.0 - fresnelWeight) * visibility;
      bias += fresnelWeight * visibility;
    }
  }
  return [scale / sampleCount, bias / sampleCount];
}

// split-sumの2 channel BRDF積分LUTをCPUで生成します
function makeBrdfLut(width, height, sampleCount) {
  const data = new Float32Array(width * height * 2);
  for (let y = 0; y < height; y += 1) {
    const roughness = Math.max((y + 0.5) / height, 0.04);
    for (let x = 0; x < width; x += 1) {
      const nDotV = (x + 0.5) / width;
      data.set(integrateBrdf(nDotV, roughness, sampleCount), (y * width + x) * 2);
    }
  }
  return { width, height, data };
}

// 指定されたpresetと基準resolutionからradiance、irradiance、roughness別specular、BRDF LUTを一組で生成します
// preset未指定時は既定のdark-studioを使い、未知のpresetは例外で停止します
export function createProceduralEnvironmentData(options = {}) {
  const { preset, resolution } = readEnvironmentOptions(options);
  const prefilteredSpecular = [];
  let width = resolution.width;
  let height = resolution.height;
  const mipCount = 6;
  for (let level = 0; level < mipCount; level += 1) {
    const roughness = level / (mipCount - 1);
    prefilteredSpecular.push(
      makeEnvironmentLevel(width, height, roughness, false, preset)
    );
    width = Math.max(1, Math.floor(width / 2));
    height = Math.max(1, Math.floor(height / 2));
  }
  return {
    radiance: makeEnvironmentLevel(
      resolution.width,
      resolution.height,
      0.0,
      false,
      preset
    ),
    irradiance: makeEnvironmentLevel(
      Math.max(1, Math.floor(resolution.width / 2)),
      Math.max(1, Math.floor(resolution.height / 2)),
      1.0,
      true,
      preset
    ),
    prefilteredSpecular,
    brdfLut: makeBrdfLut(64, 64, 64)
  };
}

// zlib stored block用のAdler-32を計算し、外部圧縮ライブラリなしでPNGを作れるようにします
function adler32(data) {
  let sumA = 1;
  let sumB = 0;
  for (const value of data) {
    sumA = (sumA + value) % 65521;
    sumB = (sumB + sumA) % 65521;
  }
  return ((sumB << 16) | sumA) >>> 0;
}

// 圧縮率よりブラウザとNode.jsの共通実行を優先し、zlib stored blockを作ります
function encodeZlibStored(data) {
  const bytes = [0x78, 0x01];
  if (data.length === 0) {
    bytes.push(0x01, 0x00, 0x00, 0xff, 0xff);
  } else {
    let offset = 0;
    while (offset < data.length) {
      const size = Math.min(65535, data.length - offset);
      const finalBlock = offset + size === data.length;
      bytes.push(finalBlock ? 0x01 : 0x00);
      bytes.push(size & 0xff, (size >>> 8) & 0xff);
      const inverse = (~size) & 0xffff;
      bytes.push(inverse & 0xff, (inverse >>> 8) & 0xff);
      for (let index = 0; index < size; index += 1) {
        bytes.push(data[offset + index]);
      }
      offset += size;
    }
  }
  const checksum = adler32(data);
  bytes.push(
    (checksum >>> 24) & 0xff,
    (checksum >>> 16) & 0xff,
    (checksum >>> 8) & 0xff,
    checksum & 0xff
  );
  return new Uint8Array(bytes);
}

// PNG chunkのCRC-32を計算し、IHDR、IDAT、IENDを同じ検証規則で作ります
function crc32(data) {
  let crc = 0xffffffff;
  for (const value of data) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// PNG chunkをbyte arrayへ追加し、標準PNG readerで開ける順序へまとめます
function appendPngChunk(bytes, type, data) {
  const typeBytes = new Uint8Array(4);
  for (let index = 0; index < 4; index += 1) {
    typeBytes[index] = type.charCodeAt(index);
  }
  const checksumInput = new Uint8Array(typeBytes.length + data.length);
  checksumInput.set(typeBytes, 0);
  checksumInput.set(data, typeBytes.length);
  bytes.push(
    (data.length >>> 24) & 0xff,
    (data.length >>> 16) & 0xff,
    (data.length >>> 8) & 0xff,
    data.length & 0xff
  );
  for (const value of typeBytes) bytes.push(value);
  for (const value of data) bytes.push(value);
  const checksum = crc32(checksumInput);
  bytes.push(
    (checksum >>> 24) & 0xff,
    (checksum >>> 16) & 0xff,
    (checksum >>> 8) & 0xff,
    checksum & 0xff
  );
}

// 線形HDRの一つのlevelを検証し、PNG変換で暗黙のサイズ補正を行わないようにします
function readEnvironmentImageLevel(level) {
  const checked = util.readPlainObject(level, "Procedural environment PNG level");
  const width = util.readFiniteNumber(
    checked.width,
    "Procedural environment PNG level.width",
    { integer: true, min: 1, max: 8192 }
  );
  const height = util.readFiniteNumber(
    checked.height,
    "Procedural environment PNG level.height",
    { integer: true, min: 1, max: 4096 }
  );
  if (!(checked.data instanceof Float32Array)) {
    throw new Error("Procedural environment PNG level.data must be a Float32Array");
  }
  const expectedLength = width * height * 4;
  if (checked.data.length !== expectedLength) {
    throw new Error(
      `Procedural environment PNG level.data length must be ${expectedLength}`
    );
  }
  for (let index = 0; index < checked.data.length; index += 1) {
    util.readFiniteNumber(
      checked.data[index],
      `Procedural environment PNG level.data[${index}]`,
      { min: 0.0 }
    );
  }
  return { width, height, data: checked.data };
}

// PNGへ変換する表示条件を検証し、tone mapping、露出、nearest拡大を明示値にします
function readPngOptions(options) {
  const checked = util.readPlainObject(options, "Procedural environment PNG options");
  const supported = new Set(["toneMap", "exposureEv", "intensity", "scale"]);
  for (const key of Object.keys(checked)) {
    if (!supported.has(key)) {
      throw new Error(`Procedural environment PNG options.${key} is not supported`);
    }
  }
  return {
    toneMap: util.readOptionalEnum(
      checked.toneMap,
      "Procedural environment PNG options.toneMap",
      "reinhard",
      ["reinhard"]
    ),
    exposureEv: util.readOptionalFiniteNumber(
      checked.exposureEv,
      "Procedural environment PNG options.exposureEv",
      0.0,
      { min: -24.0, max: 24.0 }
    ),
    intensity: util.readOptionalFiniteNumber(
      checked.intensity,
      "Procedural environment PNG options.intensity",
      1.0,
      { min: 0.0, max: 65504.0 }
    ),
    scale: util.readOptionalInteger(
      checked.scale,
      "Procedural environment PNG options.scale",
      1,
      { min: 1, max: 64 }
    )
  };
}

// 線形HDR値へReinhard tone mappingとsRGB transferを適用し、PNGの8bit channelへ変換します
function linearHdrToSrgb8(value, intensity, exposureScale) {
  const mappedInput = value * intensity * exposureScale;
  const mapped = mappedInput / (1.0 + mappedInput);
  const srgb = mapped <= 0.0031308
    ? 12.92 * mapped
    : 1.055 * Math.pow(mapped, 1.0 / 2.4) - 0.055;
  return Math.round(Math.min(Math.max(srgb, 0.0), 1.0) * 255.0);
}

// RGBA線形HDR levelをsRGB PNGへ変換し、Uint8ArrayをBlobやdownloadへ渡せる形で返します
// scaleはnearest拡大だけを行い、環境画像の色や形状を入力のまま保持します
export function encodeProceduralEnvironmentPng(level, options = {}) {
  const source = readEnvironmentImageLevel(level);
  const checked = readPngOptions(options);
  const outputWidth = source.width * checked.scale;
  const outputHeight = source.height * checked.scale;
  if (outputWidth * outputHeight > MAX_PNG_OUTPUT_PIXELS) {
    throw new Error(
      `Procedural environment PNG pixel count must be <= ${MAX_PNG_OUTPUT_PIXELS}`
    );
  }
  const exposureScale = 2 ** checked.exposureEv;
  const rowBytes = outputWidth * 4;
  const filteredRows = new Uint8Array((rowBytes + 1) * outputHeight);
  for (let y = 0; y < outputHeight; y += 1) {
    const sourceY = Math.floor(y / checked.scale);
    const rowOffset = y * (rowBytes + 1);
    filteredRows[rowOffset] = 0;
    for (let x = 0; x < outputWidth; x += 1) {
      const sourceX = Math.floor(x / checked.scale);
      const sourceOffset = (sourceY * source.width + sourceX) * 4;
      const targetOffset = rowOffset + 1 + x * 4;
      filteredRows[targetOffset] = linearHdrToSrgb8(
        source.data[sourceOffset],
        checked.intensity,
        exposureScale
      );
      filteredRows[targetOffset + 1] = linearHdrToSrgb8(
        source.data[sourceOffset + 1],
        checked.intensity,
        exposureScale
      );
      filteredRows[targetOffset + 2] = linearHdrToSrgb8(
        source.data[sourceOffset + 2],
        checked.intensity,
        exposureScale
      );
      filteredRows[targetOffset + 3] = 255;
    }
  }

  const bytes = [137, 80, 78, 71, 13, 10, 26, 10];
  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, outputWidth);
  headerView.setUint32(4, outputHeight);
  header[8] = 8;
  header[9] = 6;
  appendPngChunk(bytes, "IHDR", header);
  appendPngChunk(bytes, "IDAT", encodeZlibStored(filteredRows));
  appendPngChunk(bytes, "IEND", new Uint8Array());
  return new Uint8Array(bytes);
}

// 指定presetのradianceを生成してPNGへ変換し、利用者が一度の呼び出しでpreviewを作れるようにします
export function createProceduralEnvironmentPng(options = {}) {
  const checked = util.readPlainObject(
    options,
    "Procedural environment PNG creation options"
  );
  const supported = new Set([
    "preset",
    "resolution",
    "toneMap",
    "exposureEv",
    "intensity",
    "scale"
  ]);
  for (const key of Object.keys(checked)) {
    if (!supported.has(key)) {
      throw new Error(`Procedural environment PNG creation options.${key} is not supported`);
    }
  }
  const { preset, resolution } = readEnvironmentOptions({
    preset: checked.preset,
    resolution: checked.resolution
  });
  const pngOptions = {
    toneMap: checked.toneMap,
    exposureEv: checked.exposureEv,
    intensity: checked.intensity,
    scale: checked.scale
  };
  return encodeProceduralEnvironmentPng(
    createProceduralEnvironmentData({ preset, resolution }).radiance,
    pngOptions
  );
}
