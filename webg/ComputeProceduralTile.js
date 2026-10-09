// ---------------------------------------------
// ComputeProceduralTile.js  2026/10/04
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// Independent WebGPU compute implementation of tiled Color/Height/Normal textures

import Texture from "./Texture.js";
// 共通moduleからPerlin hash、gradient、fade、fBmのWGSL sourceを利用する
// 単体Perlin Computeと共通のnoise関数を利用し、数値契約を統一する
import { createPerlinWgslLibrary } from "./ComputePerlinNoise2D.js";
import ProceduralTileSpec from "./ProceduralTileSpec.js";
import { createPebblePatternWgsl, getPebbleGrid } from "./ProceduralPebblePattern.js";

// CPU版と独立したclassにpattern番号を固定し、parameter bufferへ数値識別子を渡す
// JavaScriptのmode名をshader内switch用u32へ変換し、未知modeはparameter作成時に拒否する
const PATTERN_MODE_IDS = {
  "none": 0,
  "longitudinal-grain": 1,
  "mottle": 2,
  "speckle": 3,
  "veined": 4,
  "voronoi": 5,
  "cloudy": 6,
  "linen": 7,
  "terrazzo": 8,
  "quarter-sawn-grain": 9,
  "flat-sawn-grain": 10,
  "mixed-sawn-grain": 11,
  "pebbles": 12
};

// storage parameter bufferのword位置を固定し、JavaScriptと二つのWGSL entry pointで共有する
// u32 wordと同じArrayBuffer上のf32 viewを使い、構造体alignmentやpadding差を避ける
const PARAM = {
  WIDTH: 0,
  HEIGHT: 1,
  SEED: 2,
  PATTERN_MODE: 3,
  PIXELS_PER_METER: 4,
  LONG_PIXELS: 5,
  SHORT_PIXELS: 6,
  JOINT_PIXELS: 7,
  LONG_PITCH: 8,
  SHORT_PITCH: 9,
  ROW_COUNT: 10,
  LONG_UNIT_COUNT: 11,
  ROW_OFFSET_DENOMINATOR: 12,
  LONG_AXIS: 13,
  EDGE_ROUND_PIXELS: 14,
  RESERVED_15: 15,
  LONG_OFFSET_PIXELS: 16,
  EFFECTIVE_JOINT_DEPTH: 17,
  PATTERN_SCALE: 18,
  PATTERN_COLOR_AMOUNT: 19,
  PATTERN_HEIGHT: 20,
  SURFACE_SCALE: 21,
  SURFACE_HEIGHT: 22,
  DIRT_AMOUNT: 23,
  BASE_R: 24,
  BASE_G: 25,
  BASE_B: 26,
  UNIT_VARIATION: 27,
  DIRT_R: 28,
  DIRT_G: 29,
  DIRT_B: 30,
  HEIGHT_MIN: 31,
  JOINT_R: 32,
  JOINT_G: 33,
  JOINT_B: 34,
  HEIGHT_SPAN: 35,
  TILE_WIDTH_METERS: 36,
  TILE_HEIGHT_METERS: 37,
  LONG_SIZE_METERS: 38,
  SHORT_SIZE_METERS: 39,
  MARBLE_MAIN_X: 40,
  MARBLE_MAIN_Y: 41,
  MARBLE_SECONDARY_X: 42,
  MARBLE_SECONDARY_Y: 43,
  PEBBLE_DENSITY: 44,
  PEBBLE_ROUNDNESS: 45,
  GRAVEL_AMOUNT: 46,
  PEBBLE_PACKING: 47,
  GRAVEL_HEIGHT: 48,
  GRAVEL_COLOR: 49,
  PEBBLE_GRID_X: 50,
  PEBBLE_GRID_Y: 51,
  GRAVEL_GRID_X: 52,
  GRAVEL_GRID_Y: 53,
  PEBBLE_IRREGULARITY: 54,
  WORD_COUNT: 56
};

// 公開済み関数名を維持しつつ、CPU版と同じ共通specification契約へ寸法計算を集約する
// validationとRepeat texture寸法の丸め規則をProceduralTileSpecへ集約する
function buildDimensions(specification) {
  return ProceduralTileSpec.buildDimensions(specification);
}

// Texture wrapperをstorage書込み、通常sampling、明示的な外部copyに使えるusageで初期化する
// readbackはsampleやdiagnosticsがCOPY_SRC capabilityで実行し、コアはGPU内の生成を担当する
// samplerはShape上の反復UVとtexture端の周期接続を確認できるRepeat modeへ設定する
async function createStorageTexture(gpu, width, height, label) {
  const texture = new Texture(gpu);
  await texture.initPromise;
  texture.createTexture(
    width,
    height,
    4,
    GPUTextureUsage.STORAGE_BINDING
      | GPUTextureUsage.TEXTURE_BINDING
      | GPUTextureUsage.COPY_SRC
      | GPUTextureUsage.COPY_DST
      | GPUTextureUsage.RENDER_ATTACHMENT
  );
  texture.setRepeat();
  texture.filename = label;
  return texture;
}

// CPU版とは独立したCompute generatorとしてpipelineを一度だけ作り、preset変更で再利用する
class ComputeProceduralTile {
  // WebGPU contextを検査して保持し、Tile合成passとNormal生成passのpipelineを作成する
  // pipelineはgeneratorの生存期間を通して共有し、preset変更にも再利用する
  // textureやparameter bufferはgenerate()ごとのresultへ属し、constructorでは永続pipelineだけを所有する
  constructor(gpu) {
    if (!gpu?.device || !gpu?.queue) {
      throw new Error("ComputeProceduralTile requires a ready WebGPU context");
    }
    this.gpu = gpu;
    this.device = gpu.device;
    this.queue = gpu.queue;
    this.destroyed = false;
    this.createPipelines();
  }

  // Tile生成用とNormal生成用のbinding layout、shader module、pipelineを順に作る
  // Tile passの物理Height bufferをNormal passが読むため、二つのlayoutは役割別に分ける
  // shader module生成とpipeline生成をconstructorから分離し、初期化段階のresource構成を一か所で追跡する
  createPipelines() {
    this.tileBindGroupLayout = this.device.createBindGroupLayout({
      label: "compute-tiled-surface layout",
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: "write-only", format: "rgba8unorm" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: "write-only", format: "rgba8unorm" } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }
      ]
    });
    this.normalBindGroupLayout = this.device.createBindGroupLayout({
      label: "compute-height-normal layout",
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: "write-only", format: "rgba8unorm" } }
      ]
    });
    this.tileShaderModule = this.device.createShaderModule({
      label: "compute-tiled-surface shader",
      code: this.createTileWGSL()
    });
    this.normalShaderModule = this.device.createShaderModule({
      label: "compute-height-normal shader",
      code: this.createNormalWGSL()
    });
    this.tilePipeline = this.device.createComputePipeline({
      label: "compute-tiled-surface pipeline",
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.tileBindGroupLayout] }),
      compute: { module: this.tileShaderModule, entryPoint: "main" }
    });
    this.normalPipeline = this.device.createComputePipeline({
      label: "compute-height-normal pipeline",
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.normalBindGroupLayout] }),
      compute: { module: this.normalShaderModule, entryPoint: "main" }
    });
  }

  // Tile配置、全pattern、Color、物理Height、8bit Heightを一dispatchで生成するWGSLを返す
  // JavaScript側のPARAM番号を文字列へ埋め込み、CPUから渡すword配列との対応を固定する
  // 冒頭へ共有Perlin WGSL libraryを挿入し、このfileではTile座標と材質patternの加工だけを定義する
  createTileWGSL() {
    return `
${createPerlinWgslLibrary()}

@group(0) @binding(0) var<storage, read> params : array<u32>;
@group(0) @binding(1) var colorTexture : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var heightTexture : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(3) var<storage, read_write> physicalHeight : array<f32>;

struct Placement {
  longLocal : f32,
  shortLocal : f32,
  variationLong : u32,
  variationRow : u32,
  inJoint : u32,
};

// u32配列としてbindingしたparameter wordを同じbit列のf32として読み直す
// JavaScript側のFloat32Array viewで格納した実数値を変換誤差なしで復元する
fn readF(index : u32) -> f32 {
  return bitcast<f32>(params[index]);
}

// 負数を含むf32座標を0以上divisor未満へ折り返し、周期模様の局所座標を得る
// pixel境界付近の丸め誤差を補正し、texture端で周期を連続につなぐ
fn positiveModuloF(value : f32, divisor : f32) -> f32 {
  let remainder = value - floor(value / divisor) * divisor;
  // 整数pixel境界の除算がGPU丸めで1未満になった場合も、divisorに極めて近い余りを0へ戻す
  return select(remainder, 0.0, remainder >= divisor - 0.0001);
}

// WGSLの負の剰余を補正し、必ず0以上divisor未満の整数indexを返す
// running-bondの負方向行やvariation cellの折り返しに使用する
fn positiveModuloI(value : i32, divisor : i32) -> i32 {
  let remainder = value % divisor;
  return select(remainder, remainder + divisor, remainder < 0);
}

// 入力を0から1へ制限し、端で傾きが0になる三次補間値へ変換する
// 目地端とterrazzo粒の輪郭を滑らかにつなぎ、境界を丸く整える
fn smoothstep01(value : f32) -> f32 {
  let checked = clamp(value, 0.0, 1.0);
  return checked * checked * (3.0 - 2.0 * checked);
}

// texture上のpixelから部材内局所座標、variation番号、目地判定をまとめて求める
// 長軸のU/V切替とrunning-bondの行offsetをここで解決し、後段の材質計算を共通化する
fn resolvePlacement(pixel : vec2u) -> Placement {
  // 長軸Uでは(x,y)、長軸Vでは(y,x)を整数のまま選び、行番号と短軸余りを正確に求める
  let directional = select(
    vec2u(pixel.y, pixel.x),
    pixel,
    params[${PARAM.LONG_AXIS}] == 0u
  );
  let shortPitch = params[${PARAM.SHORT_PITCH}];
  let longPitch = f32(params[${PARAM.LONG_PITCH}]);
  let rowIndex = i32(directional.y / shortPitch);
  let shortLocal = f32(directional.y % shortPitch);
  let denominator = i32(params[${PARAM.ROW_OFFSET_DENOMINATOR}]);
  let rowPhase = positiveModuloI(rowIndex, denominator);
  let shiftedLong = f32(directional.x) + f32(rowPhase) * readF(${PARAM.LONG_OFFSET_PIXELS}u);
  // offset後の座標はf32だがpixel境界にあるため、商の直前丸めを小さいepsilonで補正する
  let unitLongIndex = i32(floor((shiftedLong + 0.0001) / longPitch));
  let longLocal = shiftedLong - f32(unitLongIndex) * longPitch;
  let variationLong = u32(positiveModuloI(unitLongIndex, i32(params[${PARAM.LONG_UNIT_COUNT}])));
  let variationRow = u32(positiveModuloI(rowIndex, i32(params[${PARAM.ROW_COUNT}])));
  let inShortJoint = shortLocal >= f32(params[${PARAM.SHORT_PIXELS}]);
  let inLongJoint = longLocal < f32(params[${PARAM.JOINT_PIXELS}]);
  return Placement(
    longLocal,
    shortLocal,
    variationLong,
    variationRow,
    select(0u, 1u, inShortJoint || inLongJoint)
  );
}

// 実寸scaleをtexture全体で整数個のPerlin cellへ変換し、周期的なfBm fieldを採取する
// texture端で値と傾きを周期的につなぎ、繰り返し表示を連続にする
fn periodicField(pixel : vec2u, scaleX : f32, scaleY : f32, salt : u32, octaves : u32) -> f32 {
  let tileMeters = vec2f(readF(${PARAM.TILE_WIDTH_METERS}u), readF(${PARAM.TILE_HEIGHT_METERS}u));
  let cells = vec2i(
    max(1, i32(round(tileMeters.x / scaleX))),
    max(1, i32(round(tileMeters.y / scaleY)))
  );
  let position = vec2f(pixel) / vec2f(f32(params[${PARAM.WIDTH}]), f32(params[${PARAM.HEIGHT}])) * vec2f(cells);
  return perlinFbm(position, cells, true, params[${PARAM.SEED}], salt, octaves, 2.0, 0.5);
}

// 周囲3×3 cellのfeature pointを調べ、最短距離と第2距離との差を返す
// xは領域内の濃淡、yは領域境界までの近さとしてVinylの石目模様に使用する
fn sampleVoronoi(pixel : vec2u) -> vec2f {
  let scale = readF(${PARAM.PATTERN_SCALE}u);
  let cells = vec2i(
    max(1, i32(round(readF(${PARAM.TILE_WIDTH_METERS}u) / scale))),
    max(1, i32(round(readF(${PARAM.TILE_HEIGHT_METERS}u) / scale)))
  );
  let grid = vec2f(pixel) / vec2f(f32(params[${PARAM.WIDTH}]), f32(params[${PARAM.HEIGHT}])) * vec2f(cells);
  let base = vec2i(floor(grid));
  var nearest = 1.0e30;
  var second = 1.0e30;
  for (var offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (var offsetX = -1; offsetX <= 1; offsetX += 1) {
      let cell = base + vec2i(offsetX, offsetY);
      let wrapped = vec2i(wrapI32(cell.x, cells.x), wrapI32(cell.y, cells.y));
      let feature = vec2f(cell) + vec2f(
        0.15 + uint32ToUnitFloat(hashSequence4(bitcast<u32>(wrapped.x), bitcast<u32>(wrapped.y), 0x564f524fu, 0u, params[${PARAM.SEED}])) * 0.70,
        0.15 + uint32ToUnitFloat(hashSequence4(bitcast<u32>(wrapped.x), bitcast<u32>(wrapped.y), 0x564f524fu, 1u, params[${PARAM.SEED}])) * 0.70
      );
      let distance = length(grid - feature);
      if distance < nearest {
        second = nearest;
        nearest = distance;
      } else if distance < second {
        second = distance;
      }
    }
  }
  return vec2f(min(1.0, nearest), clamp(second - nearest, 0.0, 1.0));
}

// 一枚のVinyl Tile内へseedで固定される楕円状の骨材片を散布する
// 近傍bucketだけを調べ、選ばれた骨材の色調と輪郭coverageから模様値を返す
fn terrazzoPattern(placement : Placement) -> f32 {
  let bucketSize = max(2.0, readF(${PARAM.PATTERN_SCALE}u) * f32(params[${PARAM.PIXELS_PER_METER}]));
  let bucketCount = vec2i(
    max(1, i32(round(f32(params[${PARAM.LONG_PIXELS}]) / bucketSize))),
    max(1, i32(round(f32(params[${PARAM.SHORT_PIXELS}]) / bucketSize)))
  );
  let local = vec2f(
    placement.longLocal - f32(params[${PARAM.JOINT_PIXELS}]),
    placement.shortLocal
  );
  let grid = local / vec2f(f32(params[${PARAM.LONG_PIXELS}]), f32(params[${PARAM.SHORT_PIXELS}])) * vec2f(bucketCount);
  let base = vec2i(floor(grid));
  var selectedDistance = 1.0e30;
  var selectedTone = -0.10;
  // 現在bucketの近傍だけを探索し、候補の数を一定範囲に収める
  for (var offsetShort = -1; offsetShort <= 1; offsetShort += 1) {
    for (var offsetLong = -1; offsetLong <= 1; offsetLong += 1) {
      let bucket = base + vec2i(offsetLong, offsetShort);
      let wrapped = vec2i(
        wrapI32(bucket.x, bucketCount.x),
        wrapI32(bucket.y, bucketCount.y)
      );
      // Tile variation番号とbucket座標をhashへ含め、隣のTileでは骨材配置を変化させる
      let baseWord = hashSequence5(
        placement.variationLong,
        placement.variationRow,
        bitcast<u32>(wrapped.x),
        bitcast<u32>(wrapped.y),
        0x54455252u,
        params[${PARAM.SEED}]
      );
      if uint32ToUnitFloat(baseWord) > 0.64 {
        continue;
      }
      // 一つのhashから中心、半径、縦横比、回転角を派生させて楕円形状を決める
      let center = vec2f(bucket) + vec2f(
        0.18 + uint32ToUnitFloat(mixLowbias32(baseWord ^ 0x43484c58u)) * 0.64,
        0.18 + uint32ToUnitFloat(mixLowbias32(baseWord ^ 0x43485359u)) * 0.64
      );
      let radius = 0.18 + uint32ToUnitFloat(mixLowbias32(baseWord ^ 0x52414449u)) * 0.24;
      let aspect = 0.58 + uint32ToUnitFloat(mixLowbias32(baseWord ^ 0x41535043u)) * 0.42;
      let angle = uint32ToUnitFloat(mixLowbias32(baseWord ^ 0x414e474cu)) * 3.141592653589793;
      let cosine = cos(angle);
      let sine = sin(angle);
      let delta = grid - center;
      let rotated = vec2f(
        delta.x * cosine + delta.y * sine,
        -delta.x * sine + delta.y * cosine
      );
      let normalizedDistance = rotated.x * rotated.x / (radius * radius)
        + rotated.y * rotated.y / (radius * radius * aspect * aspect);
      if normalizedDistance < 1.0 && normalizedDistance < selectedDistance {
        let toneWord = mixLowbias32(baseWord ^ 0x544f4e45u);
        let magnitude = 0.58 + uint32ToUnitFloat(toneWord) * 0.42;
        selectedTone = select(magnitude, -magnitude, (toneWord & 1u) == 0u);
        selectedDistance = normalizedDistance;
      }
    }
  }
  // 楕円の外周だけをsmoothstepでぼかし、内部の色調は保ったまま母材へ接続する
  if selectedDistance < 1.0 {
    let coverage = 1.0 - smoothstep01((selectedDistance - 0.72) / 0.28);
    return -0.10 + (selectedTone + 0.10) * coverage;
  }
  return -0.10;
}

${createPebblePatternWgsl(PARAM)}

// pattern modeごとの材質模様を共通の-1から1付近の濃淡値として返す
// 色への寄与量とHeightへの寄与量は呼出元で別parameterを掛け、独立して調整する
fn materialPattern(pixel : vec2u, placement : Placement, unitRandom : f32) -> f32 {
  let mode = params[${PARAM.PATTERN_MODE}];
  let scale = readF(${PARAM.PATTERN_SCALE}u);
  let mixedFlatSawn = ((placement.variationLong + placement.variationRow + params[${PARAM.SEED}]) & 1u) == 0u;
  if mode == 0u || mode == 12u { return 0.0; }
  // 汎用木理と柾目は長軸へ平行な木理を共有し、柾目だけ短い放射組織の斑を重ねる
  if mode == 1u || mode == 9u || (mode == 11u && !mixedFlatSawn) {
    let longScale = scale * 18.0;
    let shortScale = scale * 4.0;
    var salt = 0x574f4f44u;
    if mode == 9u { salt = 0x51534157u; }
    if mode == 11u { salt = 0x4d534157u; }
    var warp = 0.0;
    if params[${PARAM.LONG_AXIS}] == 0u {
      warp = periodicField(pixel, longScale, shortScale, salt, 4u);
    } else {
      warp = periodicField(pixel, shortScale, longScale, salt, 4u);
    }
    let longPosition = positiveModuloF(
      placement.longLocal - f32(params[${PARAM.JOINT_PIXELS}]),
      f32(params[${PARAM.LONG_PIXELS}])
    ) / f32(params[${PARAM.LONG_PIXELS}]);
    let unitPhase = unitRandom * 3.141592653589793;
    let longitudinalWarp = warp * 0.62 + sin(longPosition * 3.141592653589793 * 4.0 + unitPhase) * 0.055;
    let grainPhase = (placement.shortLocal / f32(params[${PARAM.PIXELS_PER_METER}]) / scale + longitudinalWarp) * 6.283185307179586;
    let straightGrain = sin(grainPhase + unitPhase * 0.15) * 0.62
      + sin(grainPhase * 1.91 - unitPhase * 0.31) * 0.25
      + sin(grainPhase * 0.47 + unitPhase * 0.53) * 0.13;
    if mode == 1u { return straightGrain; }
    let rayCycles = max(4, i32(round(readF(${PARAM.LONG_SIZE_METERS}u) / (scale * 7.0))));
    let rayLine = pow(max(0.0, sin((longPosition * f32(rayCycles) + warp * 0.035 + unitPhase * 0.08) * 6.283185307179586)), 7.0);
    let rayBand = pow(max(0.0, sin((placement.shortLocal / f32(params[${PARAM.PIXELS_PER_METER}]) / (scale * 5.0) + unitPhase * 0.11) * 6.283185307179586)), 5.0);
    return clamp(straightGrain * 0.86 + (rayLine * rayBand - 0.04) * 0.34, -1.0, 1.0);
  }
  // 板目は年輪断面の楕円距離を使い、板の長軸方向へ開くアーチ状木理を作る
  if mode == 10u || (mode == 11u && mixedFlatSawn) {
    let longPosition = positiveModuloF(
      placement.longLocal - f32(params[${PARAM.JOINT_PIXELS}]),
      f32(params[${PARAM.LONG_PIXELS}])
    ) / f32(params[${PARAM.LONG_PIXELS}]);
    let shortPosition = positiveModuloF(placement.shortLocal, f32(params[${PARAM.SHORT_PIXELS}])) / f32(params[${PARAM.SHORT_PIXELS}]);
    var warp = 0.0;
    if params[${PARAM.LONG_AXIS}] == 0u {
      warp = periodicField(pixel, scale * 10.0, scale * 6.0, select(0x46534157u, 0x4d534157u, mode == 11u), 4u);
    } else {
      warp = periodicField(pixel, scale * 6.0, scale * 10.0, select(0x46534157u, 0x4d534157u, mode == 11u), 4u);
    }
    let unitPhase = unitRandom * 3.141592653589793;
    let centeredShort = (shortPosition - 0.5) * 2.0;
    // 仮想年輪中心を板外へ置き、部材ごとに開く方向を反転して鋭い三角形の反復を抑える
    let outsideLong = select(1.32 - longPosition, longPosition + 0.32, unitRandom < 0.0);
    let centeredLong = outsideLong + warp * 0.035;
    let ringDistance = sqrt(centeredShort * centeredShort * 0.82 + centeredLong * centeredLong * 0.22);
    let ringPhase = (ringDistance * readF(${PARAM.SHORT_SIZE_METERS}u) / scale * 0.52 + warp * 0.10 + unitPhase * 0.06) * 6.283185307179586;
    let straightPhase = (placement.shortLocal / f32(params[${PARAM.PIXELS_PER_METER}]) / scale + warp * 0.22) * 6.283185307179586;
    let cathedral = sin(ringPhase) * 0.62 + sin(ringPhase * 1.89 - unitPhase * 0.27) * 0.14;
    let straight = sin(straightPhase + unitPhase * 0.12) * 0.68 + sin(straightPhase * 1.93 - unitPhase * 0.19) * 0.18;
    return clamp(cathedral * 0.72 + straight * 0.28 + warp * 0.06, -1.0, 1.0);
  }
  // Concreteは等方的な3 octaveのfBmで粗い色むらを作る
  if mode == 2u {
    return periodicField(pixel, scale, scale, 0x434f4e43u, 3u);
  }
  // Brickは大きな斑点と細かな斑点を混ぜ、焼成材らしい粒度差を作る
  if mode == 3u {
    return periodicField(pixel, scale, scale, 0x42524943u, 2u) * 0.72
      + periodicField(pixel, scale * 0.35, scale * 0.35, 0x53504543u, 2u) * 0.28;
  }
  // Marbleは二つのfBmで位相を歪めた主脈と副脈を重ねる
  if mode == 4u {
    let warpScale = scale * 1.75;
    let warpX = periodicField(pixel, warpScale, warpScale, 0x4d415258u, 5u);
    let warpY = periodicField(pixel, warpScale, warpScale, 0x4d415259u, 5u);
    let normalized = vec2f(pixel) / vec2f(f32(params[${PARAM.WIDTH}]), f32(params[${PARAM.HEIGHT}]));
    let mainPhase = (normalized.x * f32(params[${PARAM.MARBLE_MAIN_X}])
      + normalized.y * f32(params[${PARAM.MARBLE_MAIN_Y}])
      + warpX * 0.88 + warpY * 0.52) * 6.283185307179586;
    let secondaryPhase = (normalized.x * f32(params[${PARAM.MARBLE_SECONDARY_X}])
      - normalized.y * f32(params[${PARAM.MARBLE_SECONDARY_Y}])
      + warpX * 0.37 - warpY * 0.83) * 6.283185307179586;
    let mainVein = pow(1.0 - abs(sin(mainPhase)), 3.4);
    let secondaryVein = pow(1.0 - abs(sin(secondaryPhase)), 6.0);
    return clamp((warpX * 0.66 + warpY * 0.34) * 0.42 - mainVein * 0.72 - secondaryVein * 0.24, -1.0, 1.0);
  }
  // Vinyl Voronoiはcell境界の細い脈、cell中心距離、低周波warpを合成する
  if mode == 5u {
    let voronoi = sampleVoronoi(pixel);
    let warp = periodicField(pixel, scale * 1.75, scale * 1.75, 0x4d415242u, 4u);
    let vein = exp(-voronoi.y * 24.0);
    let cellTone = (0.50 - voronoi.x) * 0.22;
    return clamp(cellTone * 2.4 - vein * 0.72 + warp * 0.14, -1.0, 1.0);
  }
  // Vinyl Cloudyは尺度の異なる二つのfBmを合成し、雲状の濃淡を作る
  if mode == 6u {
    return clamp(
      periodicField(pixel, scale * 4.0, scale * 4.0, 0x434c4f55u, 3u) * 0.72
        + periodicField(pixel, scale * 1.35, scale * 1.35, 0x434c4446u, 2u) * 0.28,
      -1.0,
      1.0
    );
  }
  // Vinyl Linenは長軸と短軸の細線を交差させ、Tileごとに優勢方向を替える
  if mode == 7u {
    let warp = periodicField(pixel, scale * 5.0, scale * 5.0, 0x4c494e45u, 3u);
    let longPosition = positiveModuloF(
      placement.longLocal - f32(params[${PARAM.JOINT_PIXELS}]),
      f32(params[${PARAM.LONG_PIXELS}])
    ) / f32(params[${PARAM.LONG_PIXELS}]);
    let shortPosition = positiveModuloF(placement.shortLocal, f32(params[${PARAM.SHORT_PIXELS}])) / f32(params[${PARAM.SHORT_PIXELS}]);
    let longCycles = max(2, i32(round(readF(${PARAM.LONG_SIZE_METERS}u) / scale)));
    let shortCycles = max(2, i32(round(readF(${PARAM.SHORT_SIZE_METERS}u) / scale)));
    let longThread = pow(1.0 - abs(sin((longPosition * f32(longCycles) + warp * 0.055) * 6.283185307179586)), 5.0);
    let shortThread = pow(1.0 - abs(sin((shortPosition * f32(shortCycles) - warp * 0.045) * 6.283185307179586)), 5.0);
    let dominant = select(shortThread, longThread, unitRandom < 0.0);
    let crossing = select(longThread, shortThread, unitRandom < 0.0);
    return clamp(dominant * 0.72 + crossing * 0.28 - 0.19 + warp * 0.08, -1.0, 1.0);
  }
  // 残るmode 8は独立した骨材配置計算へ渡す
  return terrazzoPattern(placement);
}

// 各pixelの配置、材質模様、色、物理Heightを計算して三つの出力へ保存する
// 8×8 workgroupの余剰invocationを除外してから、目地と部材面を同じ経路で処理する
@compute @workgroup_size(8, 8, 1)
// 出力pixelの周期座標を求め、該当する材質の生成結果をtextureへ書く
fn main(@builtin(global_invocation_id) invocation : vec3u) {
  if invocation.x >= params[${PARAM.WIDTH}] || invocation.y >= params[${PARAM.HEIGHT}] {
    return;
  }
  // 第1段階でTile内位置とvariation番号を確定し、部材単位の乱数を一度だけ作る
  let pixel = invocation.xy;
  let index = pixel.y * params[${PARAM.WIDTH}] + pixel.x;
  let placement = resolvePlacement(pixel);
  let unitHash = hashSequence2(placement.variationLong, placement.variationRow, params[${PARAM.SEED}]);
  let unitRandom = uint32ToUnitFloat(unitHash) * 2.0 - 1.0;
  // 第2段階で表面の細かなfieldと材質固有patternを別々に求める
  let detail = clamp(
    periodicField(pixel, readF(${PARAM.SURFACE_SCALE}u), readF(${PARAM.SURFACE_SCALE}u), 0x53555246u, 3u) * 2.1,
    -1.0,
    1.0
  );
  let pattern = materialPattern(pixel, placement, unitRandom);
  var patternColor = pattern * readF(${PARAM.PATTERN_COLOR_AMOUNT}u);
  var patternHeight = pattern * readF(${PARAM.PATTERN_HEIGHT}u);
  if (params[${PARAM.PATTERN_MODE}] == 12u) {
    // 石粒では色の濃淡と曲面の高さを別々に取得する
    let pebbles = pebblePattern(pixel);
    patternColor = pebbles.x;
    patternHeight = pebbles.y;
  }
  // 第3段階では目地を初期値とし、部材面だけ色、汚れ、端部丸み、Heightを上書きする
  let coordinate = vec2i(pixel);
  let jointColor = vec3f(readF(${PARAM.JOINT_R}u), readF(${PARAM.JOINT_G}u), readF(${PARAM.JOINT_B}u));
  var color = jointColor;
  var heightMeters = -readF(${PARAM.EFFECTIVE_JOINT_DEPTH}u);
  if placement.inJoint == 0u {
    let base = vec3f(readF(${PARAM.BASE_R}u), readF(${PARAM.BASE_G}u), readF(${PARAM.BASE_B}u))
      + vec3f(unitRandom * readF(${PARAM.UNIT_VARIATION}u) + patternColor);
    let dirtMask = (detail * 0.5 + 0.5) * readF(${PARAM.DIRT_AMOUNT}u);
    color = mix(base, vec3f(readF(${PARAM.DIRT_R}u), readF(${PARAM.DIRT_G}u), readF(${PARAM.DIRT_B}u)), dirtMask);
    let edgeDistance = min(
      min(placement.longLocal - f32(params[${PARAM.JOINT_PIXELS}]), f32(params[${PARAM.LONG_PITCH}]) - placement.longLocal),
      min(placement.shortLocal, f32(params[${PARAM.SHORT_PIXELS}]) - placement.shortLocal)
    );
    var edgeBlend = 1.0;
    if params[${PARAM.JOINT_PIXELS}] != 0u && params[${PARAM.EDGE_ROUND_PIXELS}] != 0u {
      edgeBlend = smoothstep01(edgeDistance / f32(params[${PARAM.EDGE_ROUND_PIXELS}]));
    }
    let surfaceHeight = detail * readF(${PARAM.SURFACE_HEIGHT}u) + patternHeight;
    let jointDepth = readF(${PARAM.EFFECTIVE_JOINT_DEPTH}u);
    heightMeters = -jointDepth + edgeBlend * (jointDepth + surfaceHeight);
  }
  // 第4段階でmeter単位HeightをNormal生成用bufferへ保存し、表示用8bit値にも正規化する
  physicalHeight[index] = heightMeters;
  var encodedHeight = 0.5;
  if readF(${PARAM.HEIGHT_SPAN}u) > 0.0 {
    encodedHeight = (heightMeters - readF(${PARAM.HEIGHT_MIN}u)) / readF(${PARAM.HEIGHT_SPAN}u);
  }
  // Heightと同じplacement.inJointをtextureStore直前にも適用し、目地branchで初期値を
  // 保持する代わりに、正方形tileの内部縦目地でもjointColorを明示的に書き込む
  let outputColor = select(color, jointColor, placement.inJoint != 0u);
  textureStore(colorTexture, coordinate, vec4f(outputColor, 1.0));
  textureStore(heightTexture, coordinate, vec4f(encodedHeight, encodedHeight, encodedHeight, 1.0));
}
`;
  }

  // 物理meter単位Heightをwrap中央差分し、既存SmoothShader用Normal textureへ書くWGSLを返す
  // Color/Height生成後の同じcommand encoder内で実行し、CPU readbackを挟まずGPU内で完結させる
  // Tile shaderと同じparameter bufferとphysicalHeight bufferを読み、Normal専用の小さいentry pointを構築する
  createNormalWGSL() {
    return `
@group(0) @binding(0) var<storage, read> params : array<u32>;
@group(0) @binding(1) var<storage, read> physicalHeight : array<f32>;
@group(0) @binding(2) var normalTexture : texture_storage_2d<rgba8unorm, write>;

// texture端を反対側へ折り返し、中央差分が周期境界をまたいでも有効なindexを返す
// 負方向の剰余も二段階で補正し、左端と下端の隣接pixelを正しく参照する
fn wrappedIndex(x : i32, y : i32, width : i32, height : i32) -> u32 {
  let wrappedX = ((x % width) + width) % width;
  let wrappedY = ((y % height) + height) % height;
  return u32(wrappedY * width + wrappedX);
}

// 周囲4点の物理Heightを中央差分し、接線空間のNormalをrgba8unormへ保存する
// pixelsPerMeterを掛けてpixel間隔をmeter尺度へ戻し、実寸Heightの勾配として評価する
@compute @workgroup_size(8, 8, 1)
// 出力pixelの周期座標を求め、該当する材質の生成結果をtextureへ書く
fn main(@builtin(global_invocation_id) invocation : vec3u) {
  let width = i32(params[${PARAM.WIDTH}]);
  let height = i32(params[${PARAM.HEIGHT}]);
  if invocation.x >= u32(width) || invocation.y >= u32(height) {
    return;
  }
  // 折り返した左右上下のHeightを読み、texture端でも周期的な法線を生成する
  let x = i32(invocation.x);
  let y = i32(invocation.y);
  let hL = physicalHeight[wrappedIndex(x - 1, y, width, height)];
  let hR = physicalHeight[wrappedIndex(x + 1, y, width, height)];
  let hD = physicalHeight[wrappedIndex(x, y - 1, width, height)];
  let hU = physicalHeight[wrappedIndex(x, y + 1, width, height)];
  // 第2段階で2 pixel幅の差を実寸勾配へ変換し、表示用の0から1へencodeする
  let scale = f32(params[${PARAM.PIXELS_PER_METER}]) * 0.5;
  let normal = normalize(vec3f(-(hR - hL) * scale, -(hU - hD) * scale, 1.0));
  textureStore(normalTexture, vec2i(x, y), vec4f(normal * 0.5 + 0.5, 1.0));
}
`;
  }

  // TileとNormalのshader compilation messageを検査し、有効なpipelineでtextureを生成する
  // warningを含む全messageは診断用に返し、errorが一つでもあれば生成開始前に例外とする
  // 利用可能なcompilation info APIでmoduleを検査し、messageをshader名付きで保持する
  async validateShaderCompilation() {
    const modules = [
      ["Tile", this.tileShaderModule],
      ["Normal", this.normalShaderModule]
    ];
    const collected = [];
    for (const [label, module] of modules) {
      if (!module?.getCompilationInfo) continue;
      const info = await module.getCompilationInfo();
      for (const message of info.messages) {
        collected.push({
          shader: label,
          type: message.type,
          message: message.message,
          lineNum: message.lineNum,
          linePos: message.linePos
        });
      }
    }
    const errors = collected.filter((message) => message.type === "error");
    if (errors.length > 0) {
      throw new Error(
        `ComputeProceduralTile WGSL compilation failed: ${errors.map((entry) => (
          `${entry.shader} ${entry.lineNum}:${entry.linePos} ${entry.message}`
        )).join(" | ")}`
      );
    }
    return collected;
  }

  // specificationとpixel寸法をtyped parameter wordsへ格納し、u32とf32のbitを保持する
  // Heightの物理範囲と大理石の周期数もここで確定し、WGSL内の分岐と計算量を減らす
  // 戻り値にはGPU転送wordだけでなく、利用側がNormal強度を判断できる物理Height範囲も含める
  createParameterWords(specification, dimensions) {
    const buffer = new ArrayBuffer(PARAM.WORD_COUNT * Uint32Array.BYTES_PER_ELEMENT);
    const words = new Uint32Array(buffer);
    const floats = new Float32Array(buffer);
    // 第1段階でsurfaceとpatternの最大振幅、目地有無からencode対象の物理Height範囲を確定する
    const patternMode = PATTERN_MODE_IDS[specification.pattern.mode];
    if (patternMode === undefined) {
      throw new Error(`unsupported Compute pattern mode: ${specification.pattern.mode}`);
    }
    specification = ProceduralTileSpec.validate(specification);
    const effectiveJointDepth = dimensions.jointPixels === 0 ? 0 : specification.joint.depthMeters;
    const [heightMinimum, heightMaximum] = ProceduralTileSpec.getHeightRangeMeters(specification, dimensions);
    const heightSpan = heightMaximum - heightMinimum;
    // 第2段階で整数parameterをu32 view、実数parameterをf32 viewの固定word位置へ書き込む
    words[PARAM.WIDTH] = dimensions.width;
    words[PARAM.HEIGHT] = dimensions.height;
    words[PARAM.SEED] = specification.random.seed >>> 0;
    words[PARAM.PATTERN_MODE] = patternMode;
    words[PARAM.PIXELS_PER_METER] = dimensions.pixelsPerMeter;
    words[PARAM.LONG_PIXELS] = dimensions.longPixels;
    words[PARAM.SHORT_PIXELS] = dimensions.shortPixels;
    words[PARAM.JOINT_PIXELS] = dimensions.jointPixels;
    words[PARAM.LONG_PITCH] = dimensions.longPitchPixels;
    words[PARAM.SHORT_PITCH] = dimensions.shortPitchPixels;
    words[PARAM.ROW_COUNT] = specification.variationCell.rowCount;
    words[PARAM.LONG_UNIT_COUNT] = specification.variationCell.longUnitCount;
    words[PARAM.ROW_OFFSET_DENOMINATOR] = dimensions.rowOffsetDenominator;
    words[PARAM.LONG_AXIS] = specification.unit.longAxis === "u" ? 0 : 1;
    words[PARAM.EDGE_ROUND_PIXELS] = dimensions.edgeRoundPixels;
    floats[PARAM.LONG_OFFSET_PIXELS] = dimensions.longOffsetPixels;
    floats[PARAM.EFFECTIVE_JOINT_DEPTH] = effectiveJointDepth;
    floats[PARAM.PATTERN_SCALE] = specification.pattern.scaleMeters;
    floats[PARAM.PATTERN_COLOR_AMOUNT] = specification.pattern.colorAmount;
    floats[PARAM.PATTERN_HEIGHT] = specification.pattern.heightMeters;
    floats[PARAM.SURFACE_SCALE] = specification.surface.detailScaleMeters;
    floats[PARAM.SURFACE_HEIGHT] = specification.surface.heightNoiseMeters;
    floats[PARAM.DIRT_AMOUNT] = specification.color.dirtAmount;
    floats.set(specification.color.base, PARAM.BASE_R);
    floats[PARAM.UNIT_VARIATION] = specification.color.unitVariation;
    floats.set(specification.color.dirtColor, PARAM.DIRT_R);
    floats[PARAM.HEIGHT_MIN] = heightMinimum;
    floats.set(specification.joint.color, PARAM.JOINT_R);
    floats[PARAM.HEIGHT_SPAN] = heightSpan;
    // 既存patternには石粒設定が無いので、専用wordだけ0で埋めて旧計算を維持する
    const pebbles = specification.pattern.pebbles;
    floats[PARAM.PEBBLE_DENSITY] = pebbles?.density ?? 0;
    floats[PARAM.PEBBLE_PACKING] = pebbles?.packing ?? 0;
    floats[PARAM.PEBBLE_IRREGULARITY] = pebbles?.irregularity ?? 0;
    floats[PARAM.PEBBLE_ROUNDNESS] = pebbles?.roundness ?? 0;
    floats[PARAM.GRAVEL_AMOUNT] = pebbles?.gravelAmount ?? 0;
    floats[PARAM.GRAVEL_HEIGHT] = pebbles?.gravelHeightMeters ?? 0;
    floats[PARAM.GRAVEL_COLOR] = pebbles?.gravelColorAmount ?? 0;
    if (pebbles) {
      words.set(getPebbleGrid(dimensions, specification.pattern.scaleMeters), PARAM.PEBBLE_GRID_X);
      words.set(getPebbleGrid(dimensions, pebbles.gravelScaleMeters), PARAM.GRAVEL_GRID_X);
    }

    floats[PARAM.TILE_WIDTH_METERS] = dimensions.tileSizeMeters[0];
    floats[PARAM.TILE_HEIGHT_METERS] = dimensions.tileSizeMeters[1];
    floats[PARAM.LONG_SIZE_METERS] = specification.unit.longSizeMeters;
    floats[PARAM.SHORT_SIZE_METERS] = specification.unit.shortSizeMeters;
    // 第3段階でtexture四辺へ整数周期で閉じるMarble主脈と副脈のcycle数を事前計算する
    words[PARAM.MARBLE_MAIN_X] = Math.max(1, Math.round(
      dimensions.tileSizeMeters[0] / (specification.pattern.scaleMeters * 5.0)
    ));
    words[PARAM.MARBLE_MAIN_Y] = Math.max(1, Math.round(
      dimensions.tileSizeMeters[1] / (specification.pattern.scaleMeters * 7.5)
    ));
    words[PARAM.MARBLE_SECONDARY_X] = Math.max(1, Math.round(
      dimensions.tileSizeMeters[0] / (specification.pattern.scaleMeters * 2.05)
    ));
    words[PARAM.MARBLE_SECONDARY_Y] = Math.max(1, Math.round(
      dimensions.tileSizeMeters[1] / (specification.pattern.scaleMeters * 2.87)
    ));
    return {
      words,
      heightRangeMeters: [heightMinimum, heightMaximum],
      normalBuildStrength: heightSpan * dimensions.pixelsPerMeter * 0.5
    };
  }

  // 一つのspecificationからColor、Height、NormalをGPU内で連続生成する
  // resource作成と二つのCompute passをsubmitし、通常利用ではGPU完了を待たずhandleを返す
  // resultをdestroyResult()へ返す単位とし、途中bufferも同じresultで一括所有する
  async generate(specification) {
    if (this.destroyed) throw new Error("ComputeProceduralTile is destroyed");
    if (!specification || typeof specification !== "object") {
      throw new Error("ComputeProceduralTile.generate requires a specification");
    }
    // 第1段階で共通schemaとpixel寸法を確定し、shaderへ渡すparameter wordを組み立てる
    const checkedSpecification = ProceduralTileSpec.validate(specification);
    const dimensions = buildDimensions(checkedSpecification);
    const parameterData = this.createParameterWords(checkedSpecification, dimensions);
    // 第2段階でparameter、物理Height、Color、Height、Normalの生成result resourceを確保する
    const parameterBuffer = this.device.createBuffer({
      label: "compute-tiled-surface parameters",
      size: parameterData.words.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    const physicalHeightBuffer = this.device.createBuffer({
      label: "compute-tiled-surface physical height",
      size: dimensions.width * dimensions.height * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
    });
    this.queue.writeBuffer(parameterBuffer, 0, parameterData.words);
    const colorTexture = await createStorageTexture(
      this.gpu,
      dimensions.width,
      dimensions.height,
      "compute Color map"
    );
    const heightTexture = await createStorageTexture(
      this.gpu,
      dimensions.width,
      dimensions.height,
      "compute Height map"
    );
    const normalTexture = await createStorageTexture(
      this.gpu,
      dimensions.width,
      dimensions.height,
      "compute Normal map"
    );
    // 第3段階でTile passの出力をNormal passが読むbinding関係を二つのbind groupへ固定する
    const tileBindGroup = this.device.createBindGroup({
      label: "compute-tiled-surface bind group",
      layout: this.tileBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: parameterBuffer } },
        { binding: 1, resource: colorTexture.getView() },
        { binding: 2, resource: heightTexture.getView() },
        { binding: 3, resource: { buffer: physicalHeightBuffer } }
      ]
    });
    const normalBindGroup = this.device.createBindGroup({
      label: "compute-height-normal bind group",
      layout: this.normalBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: parameterBuffer } },
        { binding: 1, resource: { buffer: physicalHeightBuffer } },
        { binding: 2, resource: normalTexture.getView() }
      ]
    });
    // 第4段階でColor／Height生成を先、Normal生成を後に同じencoderへ記録してGPU実行順を保証する
    const encoder = this.device.createCommandEncoder({ label: "compute-tiled-texture encoder" });
    const tilePass = encoder.beginComputePass({ label: "compute tiled Color and Height" });
    tilePass.setPipeline(this.tilePipeline);
    tilePass.setBindGroup(0, tileBindGroup);
    tilePass.dispatchWorkgroups(Math.ceil(dimensions.width / 8), Math.ceil(dimensions.height / 8), 1);
    tilePass.end();
    const normalPass = encoder.beginComputePass({ label: "compute tiled Normal" });
    normalPass.setPipeline(this.normalPipeline);
    normalPass.setBindGroup(0, normalBindGroup);
    normalPass.dispatchWorkgroups(Math.ceil(dimensions.width / 8), Math.ceil(dimensions.height / 8), 1);
    normalPass.end();
    // 第5段階で一回だけsubmitし、作成resourceと導出metadataを一つのresultとして返す
    this.queue.submit([encoder.finish()]);
    return {
      presetId: checkedSpecification.presetId,
      specification: checkedSpecification,
      width: dimensions.width,
      height: dimensions.height,
      pixelsPerMeter: dimensions.pixelsPerMeter,
      tileSizeMeters: dimensions.tileSizeMeters,
      heightRangeMeters: parameterData.heightRangeMeters,
      normalBuildStrength: parameterData.normalBuildStrength,
      colorTexture,
      heightTexture,
      normalTexture,
      parameterBuffer,
      physicalHeightBuffer,
      destroyed: false
    };
  }

  // 表示を終えた一組のtextureとbufferを明示的に破棄する
  // 二重破棄を避けるためresultへ状態を記録し、保持参照もnullへ戻す
  // Texture wrapper自体は残るため内部GPUTextureとviewをnullにし、破棄後の誤利用を観測可能にする
  destroyResult(result) {
    if (!result || result.destroyed) return false;
    for (const texture of [result.colorTexture, result.heightTexture, result.normalTexture]) {
      texture?.texture?.destroy();
      if (texture) {
        texture.texture = null;
        texture.view = null;
      }
    }
    result.parameterBuffer?.destroy();
    result.physicalHeightBuffer?.destroy();
    result.parameterBuffer = null;
    result.physicalHeightBuffer = null;
    result.destroyed = true;
    return true;
  }

  // generatorのpipeline参照を解放し、破棄後の再生成を禁止する
  // 個別resultのGPU resourceは所有者がdestroyResultで先に破棄する前提とする
  // WebGPU pipeline類はJavaScript参照を外して解放対象にし、状態flagで以後のgenerateをエラーにする
  destroy() {
    if (this.destroyed) return false;
    this.tileBindGroupLayout = null;
    this.normalBindGroupLayout = null;
    this.tileShaderModule = null;
    this.normalShaderModule = null;
    this.tilePipeline = null;
    this.normalPipeline = null;
    this.destroyed = true;
    return true;
  }
}

export default ComputeProceduralTile;
export { ComputeProceduralTile, PATTERN_MODE_IDS, buildDimensions };
