// ---------------------------------------------
// samples/procedural_texture/ProceduralTiledSurface.js  2026/08/09
//   Reusable tiled Color/Height map generator and GPU texture uploader
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import Texture from "../../webg/Texture.js";
import ProceduralTileSpec from "../../webg/ProceduralTileSpec.js";
import { samplePebbleLayer } from "../../webg/ProceduralPebblePattern.js";
import util from "../../webg/util.js";
import PerlinNoise2D from "./PerlinNoise2D.js";

// surface detail fieldの数値契約を一か所へ固定し、cache keyと生成条件の食い違いを防ぐ
const SURFACE_DETAIL_FIELD_VERSION = 1;
const SURFACE_DETAIL_FIELD_SALT = 0x53555246;
const SURFACE_DETAIL_FIELD_OCTAVES = 3;
const SURFACE_DETAIL_FIELD_LACUNARITY = 2.0;
const SURFACE_DETAIL_FIELD_GAIN = 0.5;
const SURFACE_DETAIL_OUTPUT_GAIN = 2.1;

// 0から1の色channelを8bitへ変換し、範囲外値を自動補正せず生成側の誤りとして停止する
function colorChannelToByte(value, label) {
  const channel = util.readFiniteNumber(value, label, { min: 0.0, max: 1.0 });
  return Math.round(channel * 255.0);
}

// 部材IDやnoise格子から直接値を得るため、webg共通の座標hashだけを使用する
function coordinateUnitFloat(values, seed) {
  return util.uint32ToUnitFloat(util.hashUint32Sequence(values, seed));
}

// 格子indexを有限周期へ折り返し、textureの上下左右で同じnoise格子を共有する
function wrapIndex(value, period) {
  return ((value % period) + period) % period;
}

// 材質pattern用の周期Perlin fBmをpixel loopの前に一括生成する
// 実寸scaleをX/Yそれぞれの整数cell数へ変換し、texture四辺で同じgradient周期を閉じる
function fillPeriodicPerlinField(
  dimensions,
  scaleMetersX,
  scaleMetersY,
  seed,
  salt,
  octaves
) {
  const cellsX = Math.max(
    1,
    Math.round(dimensions.tileSizeMeters[0] / scaleMetersX)
  );
  const cellsY = Math.max(
    1,
    Math.round(dimensions.tileSizeMeters[1] / scaleMetersY)
  );
  const field = new PerlinNoise2D({
    seed,
    salt,
    periodCells: [cellsX, cellsY],
    numericMode: "f32-reference"
  }).fillFbm({
    width: dimensions.width,
    height: dimensions.height,
    domainOrigin: [0, 0],
    domainSize: [cellsX, cellsY],
    octaves,
    lacunarity: 2,
    gain: 0.5
  });
  return Object.freeze({ field, cellsX, cellsY });
}

// CPU生成とfield生成の内訳を同じ単位で記録するため、高精度時計があれば優先して読む
function nowMilliseconds() {
  return globalThis.performance?.now?.() ?? Date.now();
}

// cache keyへ使用する有限数をJSONで安定して表現し、NaNなどによる衝突を防ぐ
function readCacheKeyNumber(value, label) {
  return util.readFiniteNumber(value, label);
}

// 周期端の外側にあるcellも反対側と同じfeature pointへ対応させ、Voronoi境界をtile化する
function sampleTileableVoronoi(x, y, dimensions, scaleMeters, seed, salt) {
  const cellsX = Math.max(1, Math.round(dimensions.tileSizeMeters[0] / scaleMeters));
  const cellsY = Math.max(1, Math.round(dimensions.tileSizeMeters[1] / scaleMeters));
  const gridX = x / dimensions.width * cellsX;
  const gridY = y / dimensions.height * cellsY;
  const baseX = Math.floor(gridX);
  const baseY = Math.floor(gridY);
  let nearestDistance = Infinity;
  let secondDistance = Infinity;
  for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      const cellX = baseX + offsetX;
      const cellY = baseY + offsetY;
      const wrappedX = wrapIndex(cellX, cellsX);
      const wrappedY = wrapIndex(cellY, cellsY);
      const featureX = cellX + 0.15 + coordinateUnitFloat(
        [wrappedX, wrappedY, salt >>> 0, 0],
        seed
      ) * 0.70;
      const featureY = cellY + 0.15 + coordinateUnitFloat(
        [wrappedX, wrappedY, salt >>> 0, 1],
        seed
      ) * 0.70;
      const dx = gridX - featureX;
      const dy = gridY - featureY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance < nearestDistance) {
        secondDistance = nearestDistance;
        nearestDistance = distance;
      } else if (distance < secondDistance) {
        secondDistance = distance;
      }
    }
  }
  return {
    centerDistance: Math.min(1.0, nearestDistance),
    edgeDistance: Math.min(1.0, Math.max(0.0, secondDistance - nearestDistance))
  };
}

// 縁の丸みに使う0から1の補間値を返し、急な段差を滑らかな傾斜へ変換する
function smoothstep01(value) {
  const checked = util.readFiniteNumber(value, "smoothstep01 value");
  if (checked <= 0.0) return 0.0;
  if (checked >= 1.0) return 1.0;
  return checked * checked * (3.0 - 2.0 * checked);
}

// Palette操作をまたいで再利用できるCPU scalar fieldを、件数制限付きLRUとして保持する
// generator module全体のglobal cacheにせず、利用側がcacheの寿命と対象面を明示できるようにする
class ProceduralTextureFieldCache {
  // 保持件数を正の整数で確定し、Mapの挿入順をLRU順として利用する
  constructor(maxEntries = 2) {
    this.maxEntries = util.readFiniteNumber(
      maxEntries,
      "ProceduralTextureFieldCache maxEntries",
      { integer: true, min: 1, max: 64 }
    );
    this.entries = new Map();
  }

  // keyが存在すれば末尾へ移して最新利用とし、呼び出し側が変更しないfieldを返す
  get(key) {
    if (typeof key !== "string" || key.length === 0) {
      throw new Error("ProceduralTextureFieldCache key must be a non-empty string");
    }
    const field = this.entries.get(key);
    if (!field) return null;
    this.entries.delete(key);
    this.entries.set(key, field);
    return field;
  }

  // 検証済みfieldを最新項目として保存し、上限を超えた最古項目だけを破棄する
  set(key, field) {
    if (typeof key !== "string" || key.length === 0) {
      throw new Error("ProceduralTextureFieldCache key must be a non-empty string");
    }
    if (!(field instanceof Float32Array)) {
      throw new Error("ProceduralTextureFieldCache field must be Float32Array");
    }
    this.entries.delete(key);
    this.entries.set(key, field);
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      this.entries.delete(oldestKey);
    }
    return field;
  }

  // sample破棄や明示resetで保持中のCPU field参照をすべて解放する
  clear() {
    this.entries.clear();
  }

  // diagnosticsとtestが上限制御を確認できるよう、現在の保持件数だけを公開する
  get size() {
    return this.entries.size;
  }
}

// 長方形部材の配置を一度だけ計算し、同じ位置からColor mapとHeight mapを生成する
class ProceduralTiledSurface {
  // Palette側もgeneratorと同じRow Offset周期を使えるよう、検証済みの分母解決を公開する
  static getRowOffsetDenominator(rowOffsetRatio) {
    return ProceduralTileSpec.getRowOffsetDenominator(rowOffsetRatio);
  }

  // catalogまたはPaletteで完成した設定を受け取り、生成前に全項目を検証して保持する
  constructor(specification) {
    this.specification = ProceduralTileSpec.validate(specification);
  }

  // 一つのtileを構成するpixel寸法とmeter寸法を共通specification契約から求める
  buildDimensions() {
    return ProceduralTileSpec.buildDimensions(this.specification);
  }

  // textureのXYを部材のlong/short座標へ変換し、longAxis切替で全模様を一緒に回す
  resolveDirectionalCoordinates(x, y) {
    if (this.specification.unit.longAxis === "u") {
      return { longPixel: x, shortPixel: y };
    }
    return { longPixel: y, shortPixel: x };
  }

  // 継ぎ目をまたぐ断片も同じ部材IDへ折り返し、色・木目位相をtile両端で一致させる
  resolveUnitPlacement(x, y, dimensions = this.buildDimensions()) {
    const directional = this.resolveDirectionalCoordinates(x, y);
    const rowIndex = Math.floor(
      directional.shortPixel / dimensions.shortPitchPixels
    );
    const shortLocal = directional.shortPixel % dimensions.shortPitchPixels;
    const rowOffsetPhase = rowIndex % dimensions.rowOffsetDenominator;
    const rowOffset = rowOffsetPhase * dimensions.longOffsetPixels;
    const shiftedLong = directional.longPixel + rowOffset;
    const longLocal = shiftedLong % dimensions.longPitchPixels;
    const unitLongIndex = Math.floor(shiftedLong / dimensions.longPitchPixels);
    return {
      rowIndex,
      unitLongIndex,
      variationRowIndex: wrapIndex(rowIndex, dimensions.rowCount),
      variationLongIndex: wrapIndex(unitLongIndex, dimensions.longUnitCount),
      shortLocal,
      longLocal,
      inShortJoint: shortLocal >= dimensions.shortPixels,
      inLongJoint: longLocal < dimensions.jointPixels
    };
  }

  // surface detail fieldの出力を決める値だけを直列化し、色変更では同じkeyを維持する
  buildSurfaceDetailCacheKey(dimensions) {
    const spec = this.specification;
    return JSON.stringify([
      "surface-detail-perlin-fbm",
      SURFACE_DETAIL_FIELD_VERSION,
      dimensions.width,
      dimensions.height,
      readCacheKeyNumber(dimensions.tileSizeMeters[0], "surface detail tile width"),
      readCacheKeyNumber(dimensions.tileSizeMeters[1], "surface detail tile height"),
      readCacheKeyNumber(spec.surface.detailScaleMeters, "surface detail scale"),
      spec.random.seed,
      SURFACE_DETAIL_FIELD_OCTAVES,
      SURFACE_DETAIL_FIELD_LACUNARITY,
      SURFACE_DETAIL_FIELD_GAIN,
      SURFACE_DETAIL_FIELD_SALT,
      SURFACE_DETAIL_OUTPUT_GAIN,
      "f32-reference"
    ]);
  }

  // 汚れと微細凹凸へ共用する周期Perlin fieldを一括生成し、利用可能なら外部LRU cacheを使う
  // 標準偏差を揃えるgainを適用し、最終値だけを-1から1へ制限する
  buildSurfaceDetailContext(dimensions, fieldCache = null) {
    if (fieldCache !== null && !(fieldCache instanceof ProceduralTextureFieldCache)) {
      throw new Error("surface detail fieldCache must be ProceduralTextureFieldCache or null");
    }
    const started = nowMilliseconds();
    const cacheKey = this.buildSurfaceDetailCacheKey(dimensions);
    const cachedField = fieldCache?.get(cacheKey) ?? null;
    if (cachedField) {
      if (cachedField.length !== dimensions.width * dimensions.height) {
        throw new Error("cached surface detail field dimensions do not match texture dimensions");
      }
      return Object.freeze({
        basis: "perlin-fbm",
        field: cachedField,
        cacheKey,
        cacheHit: true,
        buildMs: nowMilliseconds() - started,
        byteLength: cachedField.byteLength
      });
    }

    const spec = this.specification;
    const result = fillPeriodicPerlinField(
      dimensions,
      spec.surface.detailScaleMeters,
      spec.surface.detailScaleMeters,
      spec.random.seed,
      SURFACE_DETAIL_FIELD_SALT,
      SURFACE_DETAIL_FIELD_OCTAVES
    );
    const field = result.field;
    for (let index = 0; index < field.length; index += 1) {
      field[index] = Math.max(
        -1.0,
        Math.min(1.0, field[index] * SURFACE_DETAIL_OUTPUT_GAIN)
      );
    }
    fieldCache?.set(cacheKey, field);
    return Object.freeze({
      basis: "perlin-fbm",
      field,
      cacheKey,
      cacheHit: false,
      buildMs: nowMilliseconds() - started,
      byteLength: field.byteLength
    });
  }

  // 各タイル面の周辺bucketだけを調べ、大小のモノトーンchipをscalar fieldへ事前生成する
  // bucketごの属性はutil.jsの座標hashから決め、タイルの反復位置と呼び出し順序に依存しない
  buildTerrazzoPatternField(dimensions) {
    const spec = this.specification;
    const field = new Float32Array(dimensions.width * dimensions.height);
    const bucketSizePixels = Math.max(
      2.0,
      spec.pattern.scaleMeters * dimensions.pixelsPerMeter
    );
    const bucketCountLong = Math.max(1, Math.round(dimensions.longPixels / bucketSizePixels));
    const bucketCountShort = Math.max(1, Math.round(dimensions.shortPixels / bucketSizePixels));
    const salt = 0x54455252;

    for (let y = 0; y < dimensions.height; y += 1) {
      for (let x = 0; x < dimensions.width; x += 1) {
        const pixelIndex = y * dimensions.width + x;
        const placement = this.resolveUnitPlacement(x, y, dimensions);
        if (placement.inShortJoint || placement.inLongJoint) {
          field[pixelIndex] = 0.0;
          continue;
        }

        // 目地を除いた部材内座標をbucket空間へ変換し、周期端で同じchip候補を参照する
        const localLong = placement.longLocal - dimensions.jointPixels;
        const localShort = placement.shortLocal;
        const gridLong = localLong / dimensions.longPixels * bucketCountLong;
        const gridShort = localShort / dimensions.shortPixels * bucketCountShort;
        const baseLong = Math.floor(gridLong);
        const baseShort = Math.floor(gridShort);
        let selectedDistance = Infinity;
        let selectedTone = -0.10;

        for (let offsetShort = -1; offsetShort <= 1; offsetShort += 1) {
          for (let offsetLong = -1; offsetLong <= 1; offsetLong += 1) {
            const bucketLong = baseLong + offsetLong;
            const bucketShort = baseShort + offsetShort;
            const wrappedLong = wrapIndex(bucketLong, bucketCountLong);
            const wrappedShort = wrapIndex(bucketShort, bucketCountShort);
            const baseWord = util.hashUint32Sequence([
              placement.variationLongIndex,
              placement.variationRowIndex,
              wrappedLong,
              wrappedShort,
              salt
            ], spec.random.seed);
            const occupancy = util.uint32ToUnitFloat(baseWord);
            if (occupancy > 0.64) continue;

            // 一つの32bit hashから用途別の固定値を再混合し、順番依存の乱数列を作らない
            const centerLong = bucketLong + 0.18 + util.uint32ToUnitFloat(
              util.hashUint32((baseWord ^ 0x43484c58) >>> 0)
            ) * 0.64;
            const centerShort = bucketShort + 0.18 + util.uint32ToUnitFloat(
              util.hashUint32((baseWord ^ 0x43485359) >>> 0)
            ) * 0.64;
            const radius = 0.18 + util.uint32ToUnitFloat(
              util.hashUint32((baseWord ^ 0x52414449) >>> 0)
            ) * 0.24;
            const aspect = 0.58 + util.uint32ToUnitFloat(
              util.hashUint32((baseWord ^ 0x41535043) >>> 0)
            ) * 0.42;
            const angle = util.uint32ToUnitFloat(
              util.hashUint32((baseWord ^ 0x414e474c) >>> 0)
            ) * Math.PI;
            const cosine = Math.cos(angle);
            const sine = Math.sin(angle);
            const deltaLong = gridLong - centerLong;
            const deltaShort = gridShort - centerShort;
            const rotatedLong = deltaLong * cosine + deltaShort * sine;
            const rotatedShort = -deltaLong * sine + deltaShort * cosine;
            const normalizedDistance = (
              rotatedLong * rotatedLong / (radius * radius)
              + rotatedShort * rotatedShort / (radius * radius * aspect * aspect)
            );
            if (normalizedDistance >= 1.0 || normalizedDistance >= selectedDistance) continue;

            const toneWord = util.hashUint32((baseWord ^ 0x544f4e45) >>> 0);
            const toneMagnitude = 0.58 + util.uint32ToUnitFloat(toneWord) * 0.42;
            selectedTone = (toneWord & 1) === 0 ? -toneMagnitude : toneMagnitude;
            selectedDistance = normalizedDistance;
          }
        }

        // chip輪郭の最後15%を滑らかにし、低解像度でも過度なジャギーを出さない
        if (selectedDistance < 1.0) {
          const coverage = 1.0 - smoothstep01((selectedDistance - 0.72) / 0.28);
          field[pixelIndex] = -0.10 + (selectedTone + 0.10) * coverage;
        } else {
          field[pixelIndex] = -0.10;
        }
      }
    }
    return field;
  }

  // 材質ごとに必要なPerlin fieldをpixel loopの前に生成し、同じfieldをColorとHeightで共有する
  // 木理の蛇行、コンクリートの色斑、レンガの焼きむら、Vinylの雲状・繊維模様にもCPU参照classを使う
  buildMaterialPatternContext(dimensions) {
    const spec = this.specification;
    if (spec.pattern.mode === "none" || spec.pattern.mode === "pebbles") return null;
    if (["longitudinal-grain", "quarter-sawn-grain", "flat-sawn-grain", "mixed-sawn-grain"].includes(spec.pattern.mode)) {
      // 木理の線間隔より長い実寸scaleでwarpを作り、細い木理自体を潰さず緩やかに蛇行させる
      if (spec.pattern.mode === "mixed-sawn-grain") {
        const quarterWarp = fillPeriodicPerlinField(
          dimensions,
          spec.unit.longAxis === "u" ? spec.pattern.scaleMeters * 18.0 : spec.pattern.scaleMeters * 4.0,
          spec.unit.longAxis === "u" ? spec.pattern.scaleMeters * 4.0 : spec.pattern.scaleMeters * 18.0,
          spec.random.seed,
          0x4d534157,
          4
        );
        const flatWarp = fillPeriodicPerlinField(
          dimensions,
          spec.unit.longAxis === "u" ? spec.pattern.scaleMeters * 10.0 : spec.pattern.scaleMeters * 6.0,
          spec.unit.longAxis === "u" ? spec.pattern.scaleMeters * 6.0 : spec.pattern.scaleMeters * 10.0,
          spec.random.seed,
          0x4d534157,
          4
        );
        return Object.freeze({
          basis: "perlin-fbm",
          primary: quarterWarp.field,
          secondary: flatWarp.field
        });
      }
      const isFlatSawn = spec.pattern.mode === "flat-sawn-grain";
      const longWarpScaleMeters = spec.pattern.scaleMeters * (isFlatSawn ? 10.0 : 18.0);
      const shortWarpScaleMeters = spec.pattern.scaleMeters * (isFlatSawn ? 6.0 : 4.0);
      const salt = spec.pattern.mode === "mixed-sawn-grain"
        ? 0x4d534157
        : (spec.pattern.mode === "quarter-sawn-grain"
          ? 0x51534157
          : (isFlatSawn ? 0x46534157 : 0x574f4f44));
      const warp = fillPeriodicPerlinField(
        dimensions,
        spec.unit.longAxis === "u" ? longWarpScaleMeters : shortWarpScaleMeters,
        spec.unit.longAxis === "u" ? shortWarpScaleMeters : longWarpScaleMeters,
        spec.random.seed,
        salt,
        4
      );
      return Object.freeze({ basis: "perlin-fbm", primary: warp.field });
    }
    if (spec.pattern.mode === "mottle") {
      const mottle = fillPeriodicPerlinField(
        dimensions,
        spec.pattern.scaleMeters,
        spec.pattern.scaleMeters,
        spec.random.seed,
        0x434f4e43,
        3
      );
      return Object.freeze({ basis: "perlin-fbm", primary: mottle.field });
    }
    if (spec.pattern.mode === "speckle") {
      // 焼きむらと細粒を独立saltへ分け、同じ場所へ常に同じ二つのfieldを再現する
      const coarse = fillPeriodicPerlinField(
        dimensions,
        spec.pattern.scaleMeters,
        spec.pattern.scaleMeters,
        spec.random.seed,
        0x42524943,
        2
      );
      const fine = fillPeriodicPerlinField(
        dimensions,
        spec.pattern.scaleMeters * 0.35,
        spec.pattern.scaleMeters * 0.35,
        spec.random.seed,
        0x53504543,
        2
      );
      return Object.freeze({
        basis: "perlin-fbm",
        primary: coarse.field,
        secondary: fine.field
      });
    }
    if (spec.pattern.mode === "voronoi") {
      const warp = fillPeriodicPerlinField(
        dimensions,
        spec.pattern.scaleMeters * 1.75,
        spec.pattern.scaleMeters * 1.75,
        spec.random.seed,
        0x4d415242,
        4
      );
      return Object.freeze({ basis: "perlin-fbm", primary: warp.field });
    }
    if (spec.pattern.mode === "cloudy") {
      // 大きな色斑と小さな揺らぎを別saltで作り、単一周波数の繰り返し感を抑える
      const coarse = fillPeriodicPerlinField(
        dimensions,
        spec.pattern.scaleMeters * 4.0,
        spec.pattern.scaleMeters * 4.0,
        spec.random.seed,
        0x434c4f55,
        3
      );
      const fine = fillPeriodicPerlinField(
        dimensions,
        spec.pattern.scaleMeters * 1.35,
        spec.pattern.scaleMeters * 1.35,
        spec.random.seed,
        0x434c4446,
        2
      );
      return Object.freeze({
        basis: "perlin-fbm",
        primary: coarse.field,
        secondary: fine.field
      });
    }
    if (spec.pattern.mode === "linen") {
      // 細線自体は整数cycleで作り、Perlin fieldは規則的すぎるcrosshatchの微小な歪みに限定する
      const warp = fillPeriodicPerlinField(
        dimensions,
        spec.pattern.scaleMeters * 5.0,
        spec.pattern.scaleMeters * 5.0,
        spec.random.seed,
        0x4c494e45,
        3
      );
      return Object.freeze({ basis: "perlin-fbm", primary: warp.field });
    }
    if (spec.pattern.mode === "terrazzo") {
      return Object.freeze({
        basis: "coordinate-hash-field",
        primary: this.buildTerrazzoPatternField(dimensions)
      });
    }
    const warpScaleMeters = spec.pattern.scaleMeters * 1.75;
    const warpXResult = fillPeriodicPerlinField(
      dimensions,
      warpScaleMeters,
      warpScaleMeters,
      spec.random.seed,
      0x4d415258,
      5
    );
    const warpYResult = fillPeriodicPerlinField(
      dimensions,
      warpScaleMeters,
      warpScaleMeters,
      spec.random.seed,
      0x4d415259,
      5
    );
    // cycle数をtexture寸法と物理scaleから整数で求め、模様の実寸をvariation枚数から分離する
    // 主脈はpattern scaleの5倍、副脈はさらに細い間隔にし、整数cycleで周期境界を閉じる
    const mainCyclesX = Math.max(
      1,
      Math.round(dimensions.tileSizeMeters[0] / (spec.pattern.scaleMeters * 5.0))
    );
    const mainCyclesY = Math.max(
      1,
      Math.round(dimensions.tileSizeMeters[1] / (spec.pattern.scaleMeters * 7.5))
    );
    const secondaryCyclesX = Math.max(
      1,
      Math.round(dimensions.tileSizeMeters[0] / (spec.pattern.scaleMeters * 2.05))
    );
    const secondaryCyclesY = Math.max(
      1,
      Math.round(dimensions.tileSizeMeters[1] / (spec.pattern.scaleMeters * 2.87))
    );
    return Object.freeze({
      basis: "perlin-fbm",
      warpX: warpXResult.field,
      warpY: warpYResult.field,
      mainCyclesX,
      mainCyclesY,
      secondaryCyclesX,
      secondaryCyclesY
    });
  }

  // 材質別の模様を作り、木目の方向性とコンクリート等の非方向性を分離する
  makeMaterialPattern(
    x,
    y,
    longLocal,
    shortLocal,
    dimensions,
    unitRandom,
    mixedFlatSawn,
    patternContext = null
  ) {
    const spec = this.specification;
    if (spec.pattern.mode === "none" || spec.pattern.mode === "pebbles") return 0.0;
    if (!patternContext || !(patternContext.primary instanceof Float32Array)
      && !(patternContext.warpX instanceof Float32Array)) {
      throw new Error(`${spec.pattern.mode} requires a precomputed pattern context`);
    }
    const index = y * dimensions.width + x;
    if (spec.pattern.mode === "veined") {
      const normalizedX = x / dimensions.width;
      const normalizedY = y / dimensions.height;
      const warpX = patternContext.warpX[index];
      const warpY = patternContext.warpY[index];
      // 整数cycleの基準phaseへ二成分warpを加え、texture端で周期を閉じる
      const mainPhase = (
        normalizedX * patternContext.mainCyclesX
        + normalizedY * patternContext.mainCyclesY
        + warpX * 0.88
        + warpY * 0.52
      ) * Math.PI * 2.0;
      const secondaryPhase = (
        normalizedX * patternContext.secondaryCyclesX
        - normalizedY * patternContext.secondaryCyclesY
        + warpX * 0.37
        - warpY * 0.83
      ) * Math.PI * 2.0;
      const mainVein = (1.0 - Math.abs(Math.sin(mainPhase))) ** 3.4;
      const secondaryVein = (1.0 - Math.abs(Math.sin(secondaryPhase))) ** 6.0;
      const cloud = warpX * 0.66 + warpY * 0.34;
      return Math.max(
        -1.0,
        Math.min(1.0, cloud * 0.42 - mainVein * 0.72 - secondaryVein * 0.24)
      );
    }
    if (spec.pattern.mode === "mottle") {
      return patternContext.primary[index];
    }
    if (spec.pattern.mode === "speckle") {
      const coarse = patternContext.primary[index];
      const fine = patternContext.secondary[index];
      return coarse * 0.72 + fine * 0.28;
    }
    if (spec.pattern.mode === "voronoi") {
      const voronoi = sampleTileableVoronoi(
        x,
        y,
        dimensions,
        spec.pattern.scaleMeters,
        spec.random.seed,
        0x564f524f
      );
      const warp = patternContext.primary[index];
      const voronoiVein = Math.exp(-voronoi.edgeDistance * 24.0);
      const cellTone = (0.50 - voronoi.centerDistance) * 0.22;
      return Math.max(
        -1.0,
        Math.min(1.0, cellTone * 2.4 - voronoiVein * 0.72 + warp * 0.14)
      );
    }
    if (spec.pattern.mode === "cloudy") {
      return Math.max(
        -1.0,
        Math.min(1.0, patternContext.primary[index] * 0.72 + patternContext.secondary[index] * 0.28)
      );
    }
    if (spec.pattern.mode === "linen") {
      const longPosition = wrapIndex(
        longLocal - dimensions.jointPixels,
        dimensions.longPixels
      ) / dimensions.longPixels;
      const shortPosition = wrapIndex(shortLocal, dimensions.shortPixels) / dimensions.shortPixels;
      const longCycles = Math.max(2, Math.round(spec.unit.longSizeMeters / spec.pattern.scaleMeters));
      const shortCycles = Math.max(2, Math.round(spec.unit.shortSizeMeters / spec.pattern.scaleMeters));
      const warp = patternContext.primary[index];
      const longThread = (1.0 - Math.abs(Math.sin(
        (longPosition * longCycles + warp * 0.055) * Math.PI * 2.0
      ))) ** 5.0;
      const shortThread = (1.0 - Math.abs(Math.sin(
        (shortPosition * shortCycles - warp * 0.045) * Math.PI * 2.0
      ))) ** 5.0;
      // 部材ごとに主繊維の向きを90度入れ替え、同じ方向のタイルが連続する規則感を弱める
      const dominantThread = unitRandom < 0.0 ? longThread : shortThread;
      const crossingThread = unitRandom < 0.0 ? shortThread : longThread;
      return Math.max(
        -1.0,
        Math.min(1.0, dominantThread * 0.72 + crossingThread * 0.28 - 0.19 + warp * 0.08)
      );
    }
    if (spec.pattern.mode === "terrazzo") {
      return patternContext.primary[index];
    }

    // 木目共通の部材内座標を求め、generic／柾目／板目の木取りを明示的に分ける
    // 長軸位置だけで波を作ると短軸平行の帯になるため、長軸と短軸を明示する
    const longSurfacePixels = Math.max(1, dimensions.longPixels);
    const longPosition = (
      wrapIndex(longLocal - dimensions.jointPixels, longSurfacePixels)
      / longSurfacePixels
    );
    const shortMeters = shortLocal / dimensions.pixelsPerMeter;
    const unitPhase = unitRandom * Math.PI;
    const useFlatSawn = spec.pattern.mode === "flat-sawn-grain"
      || (spec.pattern.mode === "mixed-sawn-grain" && mixedFlatSawn);
    const woodWarp = useFlatSawn && patternContext.secondary
      ? patternContext.secondary[index]
      : patternContext.primary[index];
    if (useFlatSawn) {
      const shortPosition = wrapIndex(shortLocal, dimensions.shortPixels) / dimensions.shortPixels;
      const centeredShort = (shortPosition - 0.5) * 2.0;
      // 年輪中心を板外へ置き、部材ごとに左右を反転して一点へ収束する三角形を避ける
      const outsideLong = unitRandom < 0.0 ? longPosition + 0.32 : 1.32 - longPosition;
      const centeredLong = outsideLong + woodWarp * 0.035;
      const ringDistance = Math.sqrt(
        centeredShort * centeredShort * 0.82 + centeredLong * centeredLong * 0.22
      );
      const ringPhase = (
        ringDistance * spec.unit.shortSizeMeters / spec.pattern.scaleMeters * 0.52
        + woodWarp * 0.10
        + unitPhase * 0.06
      ) * Math.PI * 2.0;
      const straightPhase = (
        shortMeters / spec.pattern.scaleMeters + woodWarp * 0.22
      ) * Math.PI * 2.0;
      const cathedral = (
        Math.sin(ringPhase) * 0.62
        + Math.sin(ringPhase * 1.89 - unitPhase * 0.27) * 0.14
      );
      const straight = (
        Math.sin(straightPhase + unitPhase * 0.12) * 0.68
        + Math.sin(straightPhase * 1.93 - unitPhase * 0.19) * 0.18
      );
      return Math.max(-1.0, Math.min(1.0,
        cathedral * 0.72 + straight * 0.28 + woodWarp * 0.06
      ));
    }
    const longitudinalWarp = (
      woodWarp * 0.62
      + Math.sin(longPosition * Math.PI * 4.0 + unitPhase) * 0.055
    );
    const grainPhase = (
      shortMeters / spec.pattern.scaleMeters + longitudinalWarp
    ) * Math.PI * 2.0;
    const straightGrain = (
      Math.sin(grainPhase + unitPhase * 0.15) * 0.62
      + Math.sin(grainPhase * 1.91 - unitPhase * 0.31) * 0.25
      + Math.sin(grainPhase * 0.47 + unitPhase * 0.53) * 0.13
    );
    if (spec.pattern.mode === "longitudinal-grain") return straightGrain;
    // 柾目では直線的な木理を主体にし、Oakで特徴となる短い放射組織の斑を控えめに重ねる
    const rayCycles = Math.max(4, Math.round(
      spec.unit.longSizeMeters / (spec.pattern.scaleMeters * 7.0)
    ));
    const rayLine = Math.max(0.0, Math.sin((
      longPosition * rayCycles + woodWarp * 0.035 + unitPhase * 0.08
    ) * Math.PI * 2.0)) ** 7.0;
    const rayBand = Math.max(0.0, Math.sin((
      shortMeters / (spec.pattern.scaleMeters * 5.0) + unitPhase * 0.11
    ) * Math.PI * 2.0)) ** 5.0;
    return Math.max(-1.0, Math.min(1.0,
      straightGrain * 0.86 + (rayLine * rayBand - 0.04) * 0.34
    ));
  }

  // 検証済み設定と任意の外部field cacheからColorとHeightのpixelを同じloopで生成する
  generate(options = {}) {
    if (!options || typeof options !== "object" || Array.isArray(options)) {
      throw new Error("ProceduralTiledSurface.generate options must be an object");
    }
    for (const key of Object.keys(options)) {
      if (key !== "fieldCache") {
        throw new Error(`ProceduralTiledSurface.generate has unknown option: ${key}`);
      }
    }
    const fieldCache = options.fieldCache ?? null;
    const spec = this.specification;
    const dimensions = this.buildDimensions();
    const colorPixels = new Uint8Array(dimensions.width * dimensions.height * 4);
    const heightPixels = new Uint8Array(dimensions.width * dimensions.height * 4);
    const effectiveJointDepthMeters = dimensions.jointPixels === 0 ? 0 : spec.joint.depthMeters;
    const heightRangeMeters = ProceduralTileSpec.getHeightRangeMeters(spec, dimensions);
    const heightSpanMeters = heightRangeMeters[1] - heightRangeMeters[0];
    const hasHeightVariation = heightSpanMeters > 0.0;
    const patternContext = this.buildMaterialPatternContext(dimensions);
    const surfaceDetailContext = this.buildSurfaceDetailContext(dimensions, fieldCache);

    for (let y = 0; y < dimensions.height; y += 1) {
      for (let x = 0; x < dimensions.width; x += 1) {
        const pixelOffset = (y * dimensions.width + x) * 4;
        const pixelIndex = y * dimensions.width + x;
        const placement = this.resolveUnitPlacement(x, y, dimensions);
        const { shortLocal, longLocal } = placement;
        const inJoint = placement.inShortJoint || placement.inLongJoint;
        const unitRandom = coordinateUnitFloat(
          [placement.variationLongIndex, placement.variationRowIndex],
          spec.random.seed
        ) * 2.0 - 1.0;
        // 小さなvariation cellでも両方の木取りが必ず現れるよう、座標とseedの偶奇で均等に分ける
        const mixedFlatSawn = (
          placement.variationLongIndex + placement.variationRowIndex + spec.random.seed
        ) % 2 === 0;
        const detail = surfaceDetailContext.field[pixelIndex];
        const patternValue = this.makeMaterialPattern(
          x,
          y,
          longLocal,
          shortLocal,
          dimensions,
          unitRandom,
          mixedFlatSawn,
          patternContext
        );

        // 石粒は色のfieldと非負Heightを分け、暗い石の色を負の高さへ流用しない。
        let patternColor = patternValue * spec.pattern.colorAmount;
        let patternHeight = patternValue * spec.pattern.heightMeters;
        if (spec.pattern.mode === "pebbles") {
          const settings = spec.pattern.pebbles;
          const sample = (scale, salt, packing = 0) => samplePebbleLayer(x, y, dimensions, spec.random.seed,
            scale, settings.density, settings.roundness, salt, packing, settings.irregularity);
          const stones = sample(spec.pattern.scaleMeters, 0x50454242, settings.packing);
          const gravel = settings.gravelAmount > 0 ? sample(settings.gravelScaleMeters, 0x47524156) : [0, 0, 0];
          const coverage = stones[2];
          patternColor = gravel[0] * settings.gravelColorAmount * settings.gravelAmount * (1-coverage)
            + stones[0] * spec.pattern.colorAmount * coverage;
          patternHeight = gravel[1] * settings.gravelHeightMeters * settings.gravelAmount * (1-coverage)
            + stones[1] * spec.pattern.heightMeters * coverage;
        }

        if (inJoint) {
          for (let channel = 0; channel < 3; channel += 1) {
            colorPixels[pixelOffset + channel] = colorChannelToByte(
              spec.joint.color[channel],
              `joint color channel ${channel}`
            );
          }
        } else {
          const dirtMask = (detail * 0.5 + 0.5) * spec.color.dirtAmount;
          for (let channel = 0; channel < 3; channel += 1) {
            const base = (
              spec.color.base[channel]
              + unitRandom * spec.color.unitVariation
              + patternColor
            );
            const colored = base + (spec.color.dirtColor[channel] - base) * dirtMask;
            colorPixels[pixelOffset + channel] = colorChannelToByte(
              colored,
              `generated color channel ${channel} at (${x}, ${y})`
            );
          }
        }
        colorPixels[pixelOffset + 3] = 255;

        let heightMeters = -effectiveJointDepthMeters;
        if (!inJoint) {
          const edgeDistancePixels = Math.min(
            longLocal - dimensions.jointPixels,
            dimensions.longPitchPixels - longLocal,
            shortLocal,
            dimensions.shortPixels - shortLocal
          );
          // 目地幅0では部材境界の丸みも無効にし、見えない境界にHeightの帯を作らない
          const edgeBlend = dimensions.jointPixels === 0 || dimensions.edgeRoundPixels === 0
            ? 1.0
            : smoothstep01(edgeDistancePixels / dimensions.edgeRoundPixels);
          const surfaceHeight = (
            detail * spec.surface.heightNoiseMeters
            + patternHeight
          );
          heightMeters = (
            -effectiveJointDepthMeters
            + edgeBlend * (effectiveJointDepthMeters + surfaceHeight)
          );
        }
        // 目地、pattern、surface高さがすべて0の完全平面は、中央値0.5の一様なHeight mapとして表す
        const encodedHeight = hasHeightVariation
          ? util.readFiniteNumber(
            (heightMeters - heightRangeMeters[0]) / heightSpanMeters,
            `encoded height at (${x}, ${y})`,
            { min: 0.0, max: 1.0 }
          )
          : 0.5;
        const heightByte = Math.round(encodedHeight * 255.0);
        heightPixels[pixelOffset] = heightByte;
        heightPixels[pixelOffset + 1] = heightByte;
        heightPixels[pixelOffset + 2] = heightByte;
        heightPixels[pixelOffset + 3] = 255;
      }
    }

    return Object.freeze({
      presetId: spec.presetId,
      specification: spec,
      width: dimensions.width,
      height: dimensions.height,
      pixelsPerMeter: dimensions.pixelsPerMeter,
      tileSizeMeters: Object.freeze([...dimensions.tileSizeMeters]),
      variationCell: spec.variationCell,
      heightRangeMeters: Object.freeze([...heightRangeMeters]),
      normalBuildStrength: heightSpanMeters * dimensions.pixelsPerMeter * 0.5,
      fieldDiagnostics: Object.freeze({
        surfaceDetail: Object.freeze({
          basis: surfaceDetailContext.basis,
          cacheHit: surfaceDetailContext.cacheHit,
          buildMs: surfaceDetailContext.buildMs,
          byteLength: surfaceDetailContext.byteLength
        })
      }),
      colorPixels,
      heightPixels
    });
  }
}

// CPU生成結果をwebg Textureへ転送し、Height mapからNormal mapを一度だけ作る
class ProceduralTextureSet {
  static async create(gpu, generated) {
    if (!gpu) {
      throw new Error("ProceduralTextureSet.create requires gpu");
    }
    const source = util.readPlainObject(generated, "ProceduralTextureSet generated result");
    const width = util.readFiniteNumber(source.width, "generated.width", {
      integer: true,
      min: 1
    });
    const height = util.readFiniteNumber(source.height, "generated.height", {
      integer: true,
      min: 1
    });
    const normalBuildStrength = util.readFiniteNumber(
      source.normalBuildStrength,
      "generated.normalBuildStrength",
      { min: 0.0 }
    );
    if (!(source.colorPixels instanceof Uint8Array)) {
      throw new Error("generated.colorPixels must be Uint8Array");
    }
    if (!(source.heightPixels instanceof Uint8Array)) {
      throw new Error("generated.heightPixels must be Uint8Array");
    }

    const colorTexture = new Texture(gpu);
    const heightTexture = new Texture(gpu);
    const normalTexture = new Texture(gpu);
    await Promise.all([
      colorTexture.initPromise,
      heightTexture.initPromise,
      normalTexture.initPromise
    ]);

    colorTexture.setImage(source.colorPixels, width, height, 4);
    colorTexture.setRepeat();
    heightTexture.setImage(source.heightPixels, width, height, 4);
    heightTexture.setRepeat();
    await normalTexture.buildNormalMapFromHeightMap({
      source: source.heightPixels,
      width,
      height,
      ncol: 4,
      channel: "r",
      strength: normalBuildStrength,
      wrap: true,
      invertY: false
    });
    normalTexture.setRepeat();

    return Object.freeze({
      generated: source,
      colorTexture,
      heightTexture,
      normalTexture
    });
  }
}

export {
  ProceduralTextureFieldCache,
  ProceduralTextureSet,
  ProceduralTiledSurface
};
