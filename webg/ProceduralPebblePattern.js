// ---------------------------------------------
// ProceduralPebblePattern.js  2026/10/04
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// Rounded pebble fields for Compute and the CPU reference generator

import util from "./util.js";

// 0〜1へ制限した値を三次曲線で補間し、粒の輪郭を滑らかにする
const smooth = (x) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};

// 周期端で同じbucketへ戻る整数格子。最低2pixelを確保し、表示解像度に収まる粒径にする
// JS側で一度だけ丸め、WGSLのroundとのtie処理の差も避ける
export function getPebbleGrid(dimensions, scale) {
  const bucketPixels = Math.max(2, scale * dimensions.pixelsPerMeter);
  return [dimensions.width, dimensions.height].map((pixels) => Math.max(1, Math.round(pixels / bucketPixels)));
}

// CPU参照版用。一つの周期的な粒層を任意のpixel座標で採取する
// 色の濃淡、正規化Height、粒のcoverageを独立した値として返す
export function samplePebbleLayer(x, y, dimensions, seed, scale, density, roundness, salt, packing = 0, irregularity = 0.8) {
  const counts = getPebbleGrid(dimensions, scale);
  const grid = [x / dimensions.width * counts[0], y / dimensions.height * counts[1]];
  const base = grid.map(Math.floor);
  let nearest = Infinity;
  let tone = -0.10;
  let maximumHeight = 0;

  // 半径はbucket一辺の約1.03以下、中心のinsetは最大半径より安全側に残す。近傍3×3で周期端をまたぐ粒も採取できる
  // packingは粒を大きくして隙間を狭め、irregularityは中心と粒径のばらつきを増やす
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const bucket = [base[0] + dx, base[1] + dy];
      const wrapped = bucket.map((value, i) => ((value % counts[i]) + counts[i]) % counts[i]);
      const word = util.hashUint32Sequence([...wrapped, salt], seed);
      if (util.uint32ToUnitFloat(word) >= density) continue;
      // 粒のhashと用途別の識別子から、再現可能な0〜1の乱数を取り出す
      const random = (tag) => util.uint32ToUnitFloat(util.hashUint32((word ^ tag) >>> 0));
      const jitter = 0.64 - packing * 0.10 + irregularity * 0.28;
      const inset = (1 - jitter) * 0.5;
      const center = [
        bucket[0] + inset + random(0x43484c58) * jitter,
        bucket[1] + inset + random(0x43485359) * jitter
      ];
      const baseRadius = 0.32 + packing * 0.25 + random(0x52414449) * (0.23 - packing * 0.03);
      // 独立したhashで大小を混ぜ、密な配置にも粒径のばらつきを付ける
      const radius = baseRadius * (1 + irregularity * (random(0x53495a45) - 0.5) * 0.50)
        + packing * irregularity * 0.06;
      const aspectMinimum = 0.65 + packing * 0.10 - irregularity * 0.10;
      const aspect = aspectMinimum + random(0x41535043) * (1 - aspectMinimum);
      const angle = random(0x414e474c)*Math.PI;
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      const delta = [grid[0] - center[0], grid[1] - center[1]];
      const u = delta[0]*cosine + delta[1]*sine;
      const v = -delta[0]*sine + delta[1]*cosine;
      const distance = (u*u + v*v/(aspect*aspect)) / (radius*radius);
      if (distance >= 1) continue;

      const coverage = 1 - smooth((distance - 0.72)/0.28);
      // 中心の高さを保ったまま周囲を下げ、中央が高い丸い上面を作る
      // 半球のsqrtより中心付近の勾配が大きく、平頂に見えにくい曲線
      const cap = Math.pow(1 - distance, 1.35) * smooth((1 - distance)/0.18);
      const height = ((1-roundness)*coverage + roundness*cap) * (0.65 + random(0x48454947)*0.35);
      // 重なる粒の上面を最大値で合成し、粒の切替部分でも高さを連続に保つ
      maximumHeight = Math.max(maximumHeight, height);
      if (distance < nearest) {
        nearest = distance;
        const toneWord = util.hashUint32((word ^ 0x544f4e45) >>> 0);
        // 暗色から基準色付近、明色まで連続した濃淡を粒ごとに選ぶ
        // Color専用の値と曲面Heightの倍率を分けて保持する
        tone = util.uint32ToUnitFloat(toneWord) * 2 - 1;
      }
    }
  }
  const coverage = nearest < 1 ? 1 - smooth((nearest-0.72)/0.28) : 0;
  return [-0.10 + (tone+0.10)*coverage, maximumHeight, coverage];
}

// ComputeProceduralTileの共通hash・smoothstep01・readFへ接続するWGSL
// parameter番号を呼出側から受け取り、buffer位置の定義を一か所に集約する
export function createPebblePatternWgsl(PARAM) {
  return `
// x: 色の濃淡、y: 正規化した非負Height、z: coverage
fn pebbleLayer(pixel: vec2u, counts: vec2i, salt: u32, packing: f32, irregularity: f32) -> vec3f {
  let grid = vec2f(pixel) / vec2f(f32(params[${PARAM.WIDTH}]), f32(params[${PARAM.HEIGHT}])) * vec2f(counts);
  let base = vec2i(floor(grid));
  var nearest = 1.0e30;
  var tone = -0.10;
  var maximumHeight = 0.0;
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let bucket = base + vec2i(dx, dy);
      let wrapped = vec2i(wrapI32(bucket.x, counts.x), wrapI32(bucket.y, counts.y));
      let word = hashSequence3(u32(wrapped.x), u32(wrapped.y), salt, params[${PARAM.SEED}]);
      if (uint32ToUnitFloat(word) >= readF(${PARAM.PEBBLE_DENSITY}u)) { continue; }
      let jitter = 0.64 - packing*0.10 + irregularity*0.28;
      let inset = (1.0-jitter)*0.5;
      let center = vec2f(bucket) + vec2f(
        inset + uint32ToUnitFloat(mixLowbias32(word ^ 0x43484c58u))*jitter,
        inset + uint32ToUnitFloat(mixLowbias32(word ^ 0x43485359u))*jitter);
      let baseRadius = 0.32 + packing*0.25 + uint32ToUnitFloat(mixLowbias32(word ^ 0x52414449u))*(0.23-packing*0.03);
      let radius = baseRadius * (1.0 + irregularity*(uint32ToUnitFloat(mixLowbias32(word ^ 0x53495a45u))-0.5)*0.50)
        + packing*irregularity*0.06;
      let aspectMinimum = 0.65 + packing*0.10 - irregularity*0.10;
      let aspect = aspectMinimum + uint32ToUnitFloat(mixLowbias32(word ^ 0x41535043u))*(1.0-aspectMinimum);
      let angle = uint32ToUnitFloat(mixLowbias32(word ^ 0x414e474cu))*3.141592653589793;
      let delta = grid - center;
      let u = delta.x*cos(angle) + delta.y*sin(angle);
      let v = -delta.x*sin(angle) + delta.y*cos(angle);
      let distance = (u*u + v*v/(aspect*aspect))/(radius*radius);
      if (distance >= 1.0) { continue; }
      let coverage = 1.0 - smoothstep01((distance-0.72)/0.28);
      let cap = pow(1.0-distance, 1.35) * smoothstep01((1.0-distance)/0.18);
      let height = mix(coverage, cap, readF(${PARAM.PEBBLE_ROUNDNESS}u))
        * (0.65 + uint32ToUnitFloat(mixLowbias32(word ^ 0x48454947u))*0.35);
      maximumHeight = max(maximumHeight, height);
      if (distance < nearest) {
        nearest = distance;
        let toneWord = mixLowbias32(word ^ 0x544f4e45u);
        // 暗色から中間色、明色まで連続した濃淡を選ぶ
        tone = uint32ToUnitFloat(toneWord)*2.0 - 1.0;
      }
    }
  }
  let coverage = select(0.0, 1.0-smoothstep01((nearest-0.72)/0.28), nearest < 1.0);
  return vec3f(-0.10 + (tone+0.10)*coverage, maximumHeight, coverage);
}

// 色とHeightは別々のfieldとして返す。砂利は大きな石の隙間にだけ合成する
fn pebblePattern(pixel: vec2u) -> vec2f {
  let stones = pebbleLayer(pixel, vec2i(vec2u(params[${PARAM.PEBBLE_GRID_X}], params[${PARAM.PEBBLE_GRID_Y}])), 0x50454242u, readF(${PARAM.PEBBLE_PACKING}u), readF(${PARAM.PEBBLE_IRREGULARITY}u));
  let amount = readF(${PARAM.GRAVEL_AMOUNT}u);
  var gravel = vec3f(0.0);
  if (amount > 0.0) { gravel = pebbleLayer(pixel, vec2i(vec2u(params[${PARAM.GRAVEL_GRID_X}], params[${PARAM.GRAVEL_GRID_Y}])), 0x47524156u, 0.0, readF(${PARAM.PEBBLE_IRREGULARITY}u)); }
  return vec2f(
    mix(gravel.x * readF(${PARAM.GRAVEL_COLOR}u) * amount, stones.x * readF(${PARAM.PATTERN_COLOR_AMOUNT}u), stones.z),
    mix(gravel.y * readF(${PARAM.GRAVEL_HEIGHT}u) * amount, stones.y * readF(${PARAM.PATTERN_HEIGHT}u), stones.z));
}
`;
}
