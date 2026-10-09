// ---------------------------------------------
// samples/procedural_texture/procedural_texture_test.mjs  2026/08/09
//   CPU contracts for procedural material presets and directional wood grain
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import assert from "node:assert/strict";
import {
  ProceduralTextureFieldCache,
  ProceduralTiledSurface
} from "./ProceduralTiledSurface.js";
import ProceduralMaterials from "../../webg/ProceduralMaterials.js";

const EXPECTED_PRESET_IDS = Object.freeze([
  "wood.oak.plank",
  "wood.walnut.plank",
  "wood.cedar.deck",
  "concrete.slab.light",
  "concrete.block.gray",
  "brick.running.red",
  "vinyl.tile.marble"
]);

const EXPECTED_CORE_PRESET_IDS = Object.freeze([
  "wood.oak.plank",
  "wood.oak.flat-sawn",
  "wood.oak.mixed-sawn",
  "wood.walnut.plank",
  "wood.walnut.flat-sawn",
  "wood.walnut.mixed-sawn",
  "wood.cedar.deck",
  "wood.cedar.flat-sawn",
  "wood.cedar.mixed-sawn",
  "concrete.slab.light",
  "concrete.block.gray",
  "fiber.cement.white",
  "fiber.cement.gray",
  "brick.running.red",
  "vinyl.tile.marble",
  "ceramic.white.square",
  "resin.mosaic.voronoi",
  "vinyl.cloudy.blue",
  "vinyl.linen.beige",
  "stone.terrazzo.gray",
  "stone.pebbles.gray",
  "stone.pebbles-gravel.gray",
  "stone.gravel.gray"
]);

const EXPECTED_PATTERN_MODES = Object.freeze([
  "longitudinal-grain",
  "quarter-sawn-grain",
  "flat-sawn-grain",
  "mixed-sawn-grain",
  "mottle",
  "speckle",
  "veined",
  "voronoi",
  "cloudy",
  "linen",
  "terrazzo",
  "pebbles",
  "none"
]);

const EXPECTED_VARIATION_CELLS = Object.freeze({
  "wood.oak.plank": Object.freeze({ longUnitCount: 2, rowCount: 4, width: 722, height: 124 }),
  "wood.walnut.plank": Object.freeze({ longUnitCount: 2, rowCount: 4, width: 722, height: 124 }),
  "wood.cedar.deck": Object.freeze({ longUnitCount: 2, rowCount: 4, width: 722, height: 124 }),
  "concrete.slab.light": Object.freeze({ longUnitCount: 1, rowCount: 1, width: 362, height: 182 }),
  "concrete.block.gray": Object.freeze({ longUnitCount: 2, rowCount: 4, width: 160, height: 160 }),
  "brick.running.red": Object.freeze({ longUnitCount: 4, rowCount: 8, width: 176, height: 176 }),
  "vinyl.tile.marble": Object.freeze({ longUnitCount: 4, rowCount: 4, width: 244, height: 244 })
});

// 3m面で色模様とNormalの粒度が粗く戻らないよう、材質ごとの実寸scaleと高さ振幅を固定する
const EXPECTED_FINE_MATERIAL_SCALES = Object.freeze({
  "wood.oak.plank": Object.freeze({ pattern: 0.018, patternHeight: 0.00025, detail: 0.015, detailHeight: 0.00010 }),
  "wood.walnut.plank": Object.freeze({ pattern: 0.014, patternHeight: 0.00018, detail: 0.0125, detailHeight: 0.00008 }),
  "wood.cedar.deck": Object.freeze({ pattern: 0.015, patternHeight: 0.00028, detail: 0.0125, detailHeight: 0.00012 }),
  "concrete.slab.light": Object.freeze({ pattern: 0.075, patternHeight: 0.00030, detail: 0.0125, detailHeight: 0.00025 }),
  "concrete.block.gray": Object.freeze({ pattern: 0.060, patternHeight: 0.00045, detail: 0.010, detailHeight: 0.00030 }),
  "brick.running.red": Object.freeze({ pattern: 0.015, patternHeight: 0.00035, detail: 0.010, detailHeight: 0.00055 })
});

function generate(presetId, ...overrides) {
  const specification = ProceduralMaterials.resolve(presetId, ...overrides);
  return new ProceduralTiledSurface(specification).generate();
}

function createSurface(presetId, ...overrides) {
  const specification = ProceduralMaterials.resolve(presetId, ...overrides);
  return new ProceduralTiledSurface(specification);
}

function assertBytesEqual(actual, expected, label) {
  assert.equal(actual.length, expected.length, `${label} byte length`);
  assert.deepEqual(actual, expected, label);
}

function averageNeighborDifference(generated, axis) {
  const { width, height, colorPixels } = generated;
  let total = 0;
  let count = 0;
  // Oak presetの先頭行にある一枚の板面だけを使い、目地の段差を統計から除外する
  for (let y = 3; y < 27; y += 1) {
    for (let x = 3; x < 237; x += 1) {
      const nextX = axis === "x" ? x + 1 : x;
      const nextY = axis === "y" ? y + 1 : y;
      if (nextX >= width || nextY >= height) continue;
      const offset = (y * width + x) * 4;
      const nextOffset = (nextY * width + nextX) * 4;
      const luminance = (
        colorPixels[offset] * 0.2126
        + colorPixels[offset + 1] * 0.7152
        + colorPixels[offset + 2] * 0.0722
      );
      const nextLuminance = (
        colorPixels[nextOffset] * 0.2126
        + colorPixels[nextOffset + 1] * 0.7152
        + colorPixels[nextOffset + 2] * 0.0722
      );
      total += Math.abs(nextLuminance - luminance);
      count += 1;
    }
  }
  return total / count;
}

assert.deepEqual(ProceduralMaterials.listPresetIds(), EXPECTED_CORE_PRESET_IDS);

for (const presetId of EXPECTED_PRESET_IDS) {
  for (const mode of EXPECTED_PATTERN_MODES) {
    assert.equal(
      createSurface(presetId, { pattern: { mode } }).specification.pattern.mode,
      mode,
      `${presetId} accepts ${mode}`
    );
  }
}

for (const presetId of EXPECTED_PRESET_IDS) {
  const surface = createSurface(presetId);
  const dimensions = surface.buildDimensions();
  const expected = EXPECTED_VARIATION_CELLS[presetId];
  const first = surface.generate();
  const second = generate(presetId);
  assert.equal(first.width, expected.width, `${presetId} width`);
  assert.equal(first.height, expected.height, `${presetId} height`);
  assert.deepEqual(first.variationCell, {
    longUnitCount: expected.longUnitCount,
    rowCount: expected.rowCount
  });
  assert.equal(first.colorPixels.length, first.width * first.height * 4);
  assert.equal(first.heightPixels.length, first.width * first.height * 4);
  assertBytesEqual(first.colorPixels, second.colorPixels, `${presetId} deterministic Color`);
  assertBytesEqual(first.heightPixels, second.heightPixels, `${presetId} deterministic Height`);

  const variationIds = new Set();
  for (let rowIndex = 0; rowIndex < dimensions.rowCount; rowIndex += 1) {
    const y = rowIndex * dimensions.shortPitchPixels + 1;
    for (let x = 0; x < dimensions.width; x += 1) {
      const placement = surface.resolveUnitPlacement(x, y, dimensions);
      if (!placement.inLongJoint && !placement.inShortJoint) {
        variationIds.add(`${placement.variationLongIndex}:${placement.variationRowIndex}`);
      }
    }
  }
  assert.equal(
    variationIds.size,
    expected.longUnitCount * expected.rowCount,
    `${presetId} variation ID count`
  );

  if (surface.specification.layout.mode === "running-bond") {
    const oddRowY = dimensions.shortPitchPixels + 1;
    const left = surface.resolveUnitPlacement(0, oddRowY, dimensions);
    const right = surface.resolveUnitPlacement(dimensions.width - 1, oddRowY, dimensions);
    assert.equal(left.inLongJoint, false, `${presetId} left seam fragment`);
    assert.equal(right.inLongJoint, false, `${presetId} right seam fragment`);
    assert.equal(
      left.variationLongIndex,
      right.variationLongIndex,
      `${presetId} seam fragments share variation ID`
    );
    assert.equal(left.variationRowIndex, right.variationRowIndex);
    assert.equal(
      (right.longLocal + 1) % dimensions.longPitchPixels,
      left.longLocal,
      `${presetId} long-local coordinate is continuous at seam`
    );
  }
}

// surface detail fieldの初回生成、cache hit、色変更時再利用、noise条件変更時missを検証する
const detailFieldCache = new ProceduralTextureFieldCache(2);
const cachedOakSurface = createSurface("wood.oak.plank");
const cachedOakDimensions = cachedOakSurface.buildDimensions();
const firstDetailContext = cachedOakSurface.buildSurfaceDetailContext(
  cachedOakDimensions,
  detailFieldCache
);
const secondDetailContext = cachedOakSurface.buildSurfaceDetailContext(
  cachedOakDimensions,
  detailFieldCache
);
assert.equal(firstDetailContext.cacheHit, false);
assert.equal(secondDetailContext.cacheHit, true);
assert.equal(firstDetailContext.field, secondDetailContext.field);
assert.equal(firstDetailContext.field.length, cachedOakDimensions.width * cachedOakDimensions.height);
assert.equal(firstDetailContext.byteLength, firstDetailContext.field.length * Float32Array.BYTES_PER_ELEMENT);
let detailSum = 0;
let detailSquareSum = 0;
let detailMinimum = Infinity;
let detailMaximum = -Infinity;
for (const value of firstDetailContext.field) {
  detailSum += value;
  detailSquareSum += value * value;
  detailMinimum = Math.min(detailMinimum, value);
  detailMaximum = Math.max(detailMaximum, value);
}
const detailMean = detailSum / firstDetailContext.field.length;
const detailStandardDeviation = Math.sqrt(
  detailSquareSum / firstDetailContext.field.length - detailMean * detailMean
);
assert.ok(Math.abs(detailMean) < 0.02, `surface detail mean remains centered: ${detailMean}`);
assert.ok(
  detailStandardDeviation > 0.25 && detailStandardDeviation < 0.36,
  `surface detail contrast remains comparable to the previous value noise: ${detailStandardDeviation}`
);
assert.ok(detailMinimum < -0.75 && detailMaximum > 0.75);

const cachedOak = cachedOakSurface.generate({ fieldCache: detailFieldCache });
assert.equal(cachedOak.fieldDiagnostics.surfaceDetail.cacheHit, true);
const cachedRecoloredOak = createSurface("wood.oak.plank", {
  color: { base: [0.60, 0.38, 0.19] }
}).generate({ fieldCache: detailFieldCache });
assert.equal(cachedRecoloredOak.fieldDiagnostics.surfaceDetail.cacheHit, true);
assertBytesEqual(
  cachedRecoloredOak.heightPixels,
  cachedOak.heightPixels,
  "Color-only cached generation preserves Height"
);
const changedDetailScale = createSurface("wood.oak.plank", {
  surface: { detailScaleMeters: 0.020 }
}).generate({ fieldCache: detailFieldCache });
assert.equal(changedDetailScale.fieldDiagnostics.surfaceDetail.cacheHit, false);
const changedDetailSeed = createSurface("wood.oak.plank", {
  random: { seed: 2026080298 }
}).generate({ fieldCache: detailFieldCache });
assert.equal(changedDetailSeed.fieldDiagnostics.surfaceDetail.cacheHit, false);
assert.equal(detailFieldCache.size, 2, "surface detail cache enforces its LRU limit");
assert.throws(
  () => cachedOakSurface.generate({ fieldCache: {} }),
  /fieldCache must be ProceduralTextureFieldCache/
);
assert.throws(
  () => cachedOakSurface.generate({ unknown: true }),
  /unknown option/
);

const verticalOak = createSurface("wood.oak.plank", { unit: { longAxis: "v" } });
const verticalOakDimensions = verticalOak.buildDimensions();
assert.equal(verticalOakDimensions.width, 124);
assert.equal(verticalOakDimensions.height, 722);

const oak = generate("wood.oak.plank");
assert.equal(oak.specification.pattern.mode, "quarter-sawn-grain", "Oak base preset is quarter-sawn");
assert.throws(
  () => createSurface("wood.oak.plank", {
    variationCell: { longUnitCount: 1, rowCount: 1 },
    pattern: { mode: "mixed-sawn-grain" }
  }),
  /requires at least two variation units/
);
const oakLongDifference = averageNeighborDifference(oak, "x");
const oakShortDifference = averageNeighborDifference(oak, "y");
assert.ok(
  oakShortDifference > oakLongDifference * 1.8,
  `oak grain must run along the long axis: long=${oakLongDifference}, short=${oakShortDifference}`
);

const recoloredOak = generate("wood.oak.plank", {
  color: { base: [0.60, 0.38, 0.19] }
});
assert.notDeepEqual(recoloredOak.colorPixels, oak.colorPixels);
assertBytesEqual(recoloredOak.heightPixels, oak.heightPixels, "Color-only override preserves Height");

const reseededConcrete = generate("concrete.slab.light", {
  random: { seed: 2026080299 }
});
const concrete = generate("concrete.slab.light");
assert.notDeepEqual(reseededConcrete.colorPixels, concrete.colorPixels);
assert.notDeepEqual(reseededConcrete.heightPixels, concrete.heightPixels);

const vinyl = generate("vinyl.tile.marble");
assert.equal(vinyl.width, vinyl.height, "vinyl tile variation texture is square");
assert.equal(
  ProceduralMaterials.resolve("vinyl.tile.marble").pattern.mode,
  "veined",
  "vinyl preset uses the new Perlin marble"
);
assert.equal(
  ProceduralMaterials.resolve("vinyl.tile.marble").pattern.scaleMeters,
  0.017,
  "Perlin marble uses the finer physical scale"
);
const vinylSurface = createSurface("vinyl.tile.marble");
const vinylPatternContext = vinylSurface.buildMaterialPatternContext(
  vinylSurface.buildDimensions()
);
assert.deepEqual(
  [
    vinylPatternContext.mainCyclesX,
    vinylPatternContext.mainCyclesY,
    vinylPatternContext.secondaryCyclesX,
    vinylPatternContext.secondaryCyclesY
  ],
  [14, 10, 35, 25],
  "Perlin marble keeps the five-times-finer vein cycles"
);
assert.ok(
  vinyl.heightRangeMeters[1] - vinyl.heightRangeMeters[0] < 0.001,
  "vinyl tile remains nearly flat"
);

// 連続的な材質模様を持つ全modeが独立CPU版Perlin fBmの事前計算fieldを利用することを固定する
for (const [presetId, mode, secondaryRequired] of [
  ["wood.oak.plank", "longitudinal-grain", false],
  ["wood.oak.plank", "quarter-sawn-grain", false],
  ["wood.oak.plank", "flat-sawn-grain", false],
  ["wood.oak.plank", "mixed-sawn-grain", true],
  ["concrete.slab.light", "mottle", false],
  ["brick.running.red", "speckle", true],
  ["vinyl.tile.marble", "veined", false],
  ["vinyl.tile.marble", "voronoi", false],
  ["vinyl.tile.marble", "cloudy", true],
  ["vinyl.tile.marble", "linen", false]
]) {
  const surface = createSurface(presetId, { pattern: { mode } });
  const dimensions = surface.buildDimensions();
  const context = surface.buildMaterialPatternContext(dimensions);
  assert.equal(context.basis, "perlin-fbm", `${mode} uses Perlin fBm`);
  const primary = context.primary ?? context.warpX;
  assert.ok(primary instanceof Float32Array, `${mode} has a primary Perlin field`);
  assert.equal(primary.length, dimensions.width * dimensions.height, `${mode} field size`);
  if (secondaryRequired) {
    assert.ok(context.secondary instanceof Float32Array, `${mode} has a secondary Perlin field`);
  }
}
const vinylTerrazzoSurface = createSurface("vinyl.tile.marble", {
  pattern: { mode: "terrazzo" }
});
const vinylTerrazzoDimensions = vinylTerrazzoSurface.buildDimensions();
const vinylTerrazzoContext = vinylTerrazzoSurface.buildMaterialPatternContext(
  vinylTerrazzoDimensions
);
assert.equal(vinylTerrazzoContext.basis, "coordinate-hash-field");
assert.ok(vinylTerrazzoContext.primary instanceof Float32Array);
assert.equal(
  vinylTerrazzoContext.primary.length,
  vinylTerrazzoDimensions.width * vinylTerrazzoDimensions.height
);
const voronoiWithPerlinWarp = generate("vinyl.tile.marble", {
  pattern: { mode: "voronoi" }
});
assert.notDeepEqual(
  voronoiWithPerlinWarp.colorPixels,
  vinyl.colorPixels,
  "Voronoi with Perlin warp remains distinct from Perlin marble"
);
const vinylCloudy = generate("vinyl.tile.marble", { pattern: { mode: "cloudy" } });
const vinylLinen = generate("vinyl.tile.marble", { pattern: { mode: "linen" } });
const vinylTerrazzo = vinylTerrazzoSurface.generate();
for (const [label, generated] of [
  ["Cloudy", vinylCloudy],
  ["Linen", vinylLinen],
  ["Terrazzo", vinylTerrazzo]
]) {
  const repeated = generate("vinyl.tile.marble", {
    pattern: { mode: generated.specification.pattern.mode }
  });
  assertBytesEqual(generated.colorPixels, repeated.colorPixels, `${label} deterministic Color`);
  assertBytesEqual(generated.heightPixels, repeated.heightPixels, `${label} deterministic Height`);
  assert.notDeepEqual(generated.colorPixels, vinyl.colorPixels, `${label} differs from marble`);
  assert.ok(
    generated.heightRangeMeters[1] - generated.heightRangeMeters[0] < 0.001,
    `${label} remains nearly flat`
  );
}
assert.notDeepEqual(vinylCloudy.colorPixels, vinylLinen.colorPixels);
assert.notDeepEqual(vinylLinen.colorPixels, vinylTerrazzo.colorPixels);

// 目地幅0では目地pixel、目地深さ、縁の丸みをすべて無効にし、完全平面も有効なHeight mapにする
const jointlessVinylSurface = createSurface("vinyl.tile.marble", {
  joint: { widthMeters: 0.0 },
  pattern: { heightMeters: 0.0 },
  surface: { heightNoiseMeters: 0.0 }
});
const jointlessDimensions = jointlessVinylSurface.buildDimensions();
assert.equal(jointlessDimensions.jointPixels, 0);
assert.equal(jointlessDimensions.width, 240);
assert.equal(jointlessDimensions.height, 240);
for (let y = 0; y < jointlessDimensions.height; y += 1) {
  for (let x = 0; x < jointlessDimensions.width; x += 1) {
    const placement = jointlessVinylSurface.resolveUnitPlacement(x, y, jointlessDimensions);
    assert.equal(placement.inLongJoint, false);
    assert.equal(placement.inShortJoint, false);
  }
}
const jointlessVinyl = jointlessVinylSurface.generate();
assert.deepEqual(jointlessVinyl.heightRangeMeters, [0.0, 0.0]);
assert.equal(jointlessVinyl.normalBuildStrength, 0.0);
for (let offset = 0; offset < jointlessVinyl.heightPixels.length; offset += 4) {
  assert.equal(jointlessVinyl.heightPixels[offset], 128);
  assert.equal(jointlessVinyl.heightPixels[offset + 1], 128);
  assert.equal(jointlessVinyl.heightPixels[offset + 2], 128);
  assert.equal(jointlessVinyl.heightPixels[offset + 3], 255);
}
const concreteSpecification = ProceduralMaterials.resolve("concrete.slab.light");
const blockSpecification = ProceduralMaterials.resolve("concrete.block.gray");
const brickSpecification = ProceduralMaterials.resolve("brick.running.red");
for (const presetId of EXPECTED_PRESET_IDS.slice(0, 3)) {
  const flooring = ProceduralMaterials.resolve(presetId);
  assert.equal(flooring.unit.longSizeMeters, 1.80);
  assert.equal(flooring.unit.shortSizeMeters, 0.15);
  assert.equal(flooring.unit.thicknessMeters, null);
}
const vinylSpecification = ProceduralMaterials.resolve("vinyl.tile.marble");
assert.equal(vinylSpecification.unit.longSizeMeters, 0.30);
assert.equal(vinylSpecification.unit.shortSizeMeters, 0.30);
assert.equal(concreteSpecification.unit.longSizeMeters, 1.80);
assert.equal(concreteSpecification.unit.shortSizeMeters, 0.90);
assert.equal(concreteSpecification.unit.thicknessMeters, 0.012);
assert.equal(blockSpecification.unit.longSizeMeters, 0.39);
assert.equal(blockSpecification.unit.shortSizeMeters, 0.19);
assert.equal(blockSpecification.unit.thicknessMeters, 0.10);
assert.equal(brickSpecification.unit.longSizeMeters, 0.21);
assert.equal(brickSpecification.unit.shortSizeMeters, 0.10);
assert.equal(brickSpecification.unit.thicknessMeters, 0.06);
for (const presetId of EXPECTED_PRESET_IDS) {
  const jointColor = ProceduralMaterials.resolve(presetId).joint.color;
  assert.equal(jointColor[0], jointColor[1], `${presetId} joint is monochrome`);
  assert.equal(jointColor[1], jointColor[2], `${presetId} joint is monochrome`);
}
for (const [presetId, expected] of Object.entries(EXPECTED_FINE_MATERIAL_SCALES)) {
  const specification = ProceduralMaterials.resolve(presetId);
  assert.equal(specification.pattern.scaleMeters, expected.pattern, `${presetId} fine pattern scale`);
  assert.equal(specification.pattern.heightMeters, expected.patternHeight, `${presetId} pattern height`);
  assert.equal(specification.surface.detailScaleMeters, expected.detail, `${presetId} fine detail scale`);
  assert.equal(specification.surface.heightNoiseMeters, expected.detailHeight, `${presetId} detail height`);
  assert.ok(
    specification.pattern.scaleMeters * specification.resolution.pixelsPerMeter >= 2,
    `${presetId} pattern base scale remains sampleable`
  );
  assert.ok(
    specification.surface.detailScaleMeters * specification.resolution.pixelsPerMeter >= 2,
    `${presetId} detail base scale remains sampleable`
  );
}

assert.throws(
  () => generate("wood.oak.plank", { pattern: { mode: "unknown" } }),
  /pattern\.mode/
);
assert.throws(
  () => generate("wood.oak.plank", { unknown: true }),
  /unknown option/
);
assert.throws(
  () => generate("wood.oak.plank", { variationCell: { rowCount: 3 } }),
  /rowCount must be a multiple of 2/
);
assert.throws(
  () => generate("wood.oak.plank", { variationCell: { longUnitCount: 0 } }),
  /variationCell\.longUnitCount/
);
assert.throws(
  () => generate("vinyl.tile.marble", { pattern: { mode: "vinyl-marble" } }),
  /pattern\.mode/
);

// 1/3と1/4のRow Offsetが分母と同じ行周期で進み、次周期の先頭で0へ戻ることを検証する
for (const [ratio, denominator] of [[1 / 3, 3], [0.25, 4]]) {
  const surface = createSurface("brick.running.red", {
    layout: { rowOffsetRatio: ratio },
    variationCell: { rowCount: denominator }
  });
  const dimensions = surface.buildDimensions();
  assert.equal(dimensions.rowOffsetDenominator, denominator);
  for (let row = 0; row <= denominator; row += 1) {
    const placement = surface.resolveUnitPlacement(
      0,
      row * dimensions.shortPitchPixels,
      dimensions
    );
    const expectedPhase = row % denominator;
    assert.equal(
      placement.longLocal,
      expectedPhase * dimensions.longOffsetPixels,
      `row offset ${ratio} phase ${row}`
    );
  }
}

// 分母で閉じない行数とPaletteにない任意ratioを受理せず、周期が途中で切れる設定を防ぐ
assert.throws(
  () => generate("brick.running.red", {
    layout: { rowOffsetRatio: 1 / 3 },
    variationCell: { rowCount: 4 }
  }),
  /rowCount must be a multiple of 3/
);
assert.throws(
  () => generate("brick.running.red", {
    layout: { rowOffsetRatio: 0.2 },
    variationCell: { rowCount: 5 }
  }),
  /rowOffsetRatio must be 0, 1\/2, 1\/3, or 1\/4/
);

console.log(
  `procedural_texture CPU PASS: ${EXPECTED_PRESET_IDS.length} presets; `
  + `oak neighbor differences long=${oakLongDifference.toFixed(3)}, `
  + `short=${oakShortDifference.toFixed(3)}`
);
