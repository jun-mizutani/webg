// ---------------------------------------------------------
// api_contracts.js  2026/08/09
//   ComputeProceduralTile core API contracts
// ---------------------------------------------------------
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ComputeProceduralTile, {
  PATTERN_MODE_IDS,
  buildDimensions
} from "../../../webg/ComputeProceduralTile.js";

const specification = {
  presetId: "vinyl.tile.contract",
  resolution: { pixelsPerMeter: 200 },
  unit: {
    longSizeMeters: 0.30,
    shortSizeMeters: 0.30,
    thicknessMeters: null,
    longAxis: "u"
  },
  layout: { mode: "stack", rowOffsetRatio: 0 },
  variationCell: { longUnitCount: 4, rowCount: 4 },
  joint: {
    widthMeters: 0.005,
    depthMeters: 0.0003,
    edgeRoundMeters: 0.005,
    color: [0.72, 0.72, 0.72]
  },
  color: {
    base: [0.62, 0.64, 0.66],
    unitVariation: 0.03,
    dirtColor: [0.30, 0.31, 0.32],
    dirtAmount: 0.05
  },
  pattern: {
    mode: "veined",
    scaleMeters: 0.017,
    colorAmount: 0.12,
    heightMeters: 0.000025
  },
  surface: {
    detailScaleMeters: 0.0125,
    heightNoiseMeters: 0.000025
  },
  random: { seed: 20260806 }
};

assert.equal(Object.keys(PATTERN_MODE_IDS).length, 13);
assert.equal(PATTERN_MODE_IDS["none"], 0);
assert.equal(PATTERN_MODE_IDS["terrazzo"], 8);
assert.equal(PATTERN_MODE_IDS["quarter-sawn-grain"], 9);
assert.equal(PATTERN_MODE_IDS["flat-sawn-grain"], 10);
assert.equal(PATTERN_MODE_IDS["mixed-sawn-grain"], 11);
assert.equal(PATTERN_MODE_IDS["pebbles"], 12);

const dimensions = buildDimensions(specification);
assert.equal(dimensions.longPixels, 60);
assert.equal(dimensions.shortPixels, 60);
assert.equal(dimensions.jointPixels, 1);
assert.equal(dimensions.width, 244);
assert.equal(dimensions.height, 244);
assert.deepEqual(dimensions.tileSizeMeters, [1.22, 1.22]);

assert.throws(
  () => buildDimensions({
    ...specification,
    unit: { ...specification.unit, longSizeMeters: 0.303 }
  }),
  /cannot be represented exactly/
);
assert.throws(
  () => buildDimensions({
    ...specification,
    layout: { mode: "running-bond", rowOffsetRatio: 1 / 3 },
    variationCell: { longUnitCount: 4, rowCount: 4 }
  }),
  /rowCount must be a multiple of 3/
);

const probe = Object.create(ComputeProceduralTile.prototype);
const parameterData = probe.createParameterWords(specification, dimensions);
assert.deepEqual(parameterData.heightRangeMeters, [-0.00035, 0.00005]);
assert.ok(parameterData.normalBuildStrength > 0);
assert.match(probe.createTileWGSL(), /fn resolvePlacement/);
assert.match(probe.createTileWGSL(), /fn materialPattern/);
assert.match(probe.createNormalWGSL(), /fn wrappedIndex/);

assert.throws(
  () => probe.createParameterWords({
    ...specification,
    pattern: { ...specification.pattern, mode: "unknown" }
  }, dimensions),
  /unsupported Compute pattern mode/
);

const sampleMainPath = fileURLToPath(new URL(
  "../../../samples/texture_catalog/main.js",
  import.meta.url
));
const sampleMain = readFileSync(sampleMainPath, "utf8");
assert.match(sampleMain, /\.\.\/\.\.\/webg\/ProceduralMaterials\.js/);
assert.match(sampleMain, /ProceduralMaterials\.listPresetDefinitions/);

const coreSource = readFileSync(fileURLToPath(new URL(
  "../../../webg/ComputeProceduralTile.js",
  import.meta.url
)), "utf8");
assert.match(coreSource, /ProceduralTileSpec\.validate\(specification\)/);
assert.doesNotMatch(coreSource, /MAP_READ|GPUMapMode|readTexturePixels/);

const perlinSource = readFileSync(fileURLToPath(new URL(
  "../../../webg/ComputePerlinNoise2D.js",
  import.meta.url
)), "utf8");
assert.doesNotMatch(perlinSource, /MAP_READ|GPUMapMode|readField\(/);

console.log("compute_procedural_tile_contracts: core API contracts passed");
