// ---------------------------------------------
// ProceduralMaterials.js  2026/10/04
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// Core procedural material presets and high-level Shape material API

import ComputeProceduralTile from "./ComputeProceduralTile.js";
import ProceduralTileSpec, { PEBBLE_DEFAULTS } from "./ProceduralTileSpec.js";
import util from "./util.js";

// Oak系presetが共有する部材寸法、配置、色、surfaceの基準値を内部定義として保持する
// 板目とmixはこの完成specificationを展開し、patternとseedだけを明示的に差し替える
const OAK_TILE_PRESET = {
  resolution: { pixelsPerMeter: 200 },
  unit: { shortSizeMeters: 0.15, longSizeMeters: 1.80, thicknessMeters: null, longAxis: "u" },
  layout: { mode: "running-bond", rowOffsetRatio: 0.50 },
  variationCell: { longUnitCount: 2, rowCount: 4 },
  joint: {
    widthMeters: 0.005,
    color: [0.08, 0.08, 0.08],
    depthMeters: 0.001,
    edgeRoundMeters: 0.005
  },
  color: {
    base: [0.57, 0.35, 0.16],
    unitVariation: 0.035,
    dirtColor: [0.24, 0.15, 0.075],
    dirtAmount: 0.025
  },
  pattern: {
    mode: "quarter-sawn-grain",
    scaleMeters: 0.010,
    colorAmount: 0.075,
    heightMeters: 0.00020
  },
  surface: { detailScaleMeters: 0.015, heightNoiseMeters: 0.00010 },
  random: { seed: 2026080201 }
};

// generatorが扱う設定を完成形で保持し、sampleへ確定した省略値を渡す
// IIFE内では基準presetを先に作り、同一樹種の派生presetを既存値から組み立てる
const MATERIAL_PRESETS = (() => {
  const presets = {
  "wood.oak.plank": OAK_TILE_PRESET,
  "wood.oak.flat-sawn": {
    ...OAK_TILE_PRESET,
    pattern: {
      mode: "flat-sawn-grain",
      scaleMeters: 0.010,
      colorAmount: 0.090,
      heightMeters: 0.00024
    },
    random: { seed: 2026080907 }
  },
  "wood.walnut.plank": {
    resolution: { pixelsPerMeter: 200 },
    unit: { shortSizeMeters: 0.15, longSizeMeters: 1.80, thicknessMeters: null, longAxis: "u" },
    layout: { mode: "running-bond", rowOffsetRatio: 1 / 3 },
    variationCell: { longUnitCount: 2, rowCount: 6 },
    joint: {
      widthMeters: 0.005,
      color: [0.05, 0.05, 0.05],
      depthMeters: 0.001,
      edgeRoundMeters: 0.005
    },
    color: {
      base: [0.255, 0.12, 0.065],
      unitVariation: 0.018,
      dirtColor: [0.07, 0.035, 0.025],
      dirtAmount: 0.02
    },
    pattern: {
      mode: "longitudinal-grain",
      scaleMeters: 0.010,
      colorAmount: 0.038,
      heightMeters: 0.00018
    },
    surface: { detailScaleMeters: 0.0125, heightNoiseMeters: 0.00008 },
    random: { seed: 2026080202 }
  },
  "wood.cedar.deck": {
    resolution: { pixelsPerMeter: 200 },
    unit: { shortSizeMeters: 0.15, longSizeMeters: 1.80, thicknessMeters: null, longAxis: "u" },
    layout: { mode: "running-bond", rowOffsetRatio: 0.25 },
    variationCell: { longUnitCount: 2, rowCount: 4 },
    joint: {
      widthMeters: 0.005,
      color: [0.07, 0.07, 0.07],
      depthMeters: 0.001,
      edgeRoundMeters: 0.005
    },
    color: {
      base: [0.58, 0.255, 0.12],
      unitVariation: 0.035,
      dirtColor: [0.16, 0.065, 0.035],
      dirtAmount: 0.03
    },
    pattern: {
      mode: "longitudinal-grain",
      scaleMeters: 0.010,
      colorAmount: 0.055,
      heightMeters: 0.00028
    },
    surface: { detailScaleMeters: 0.0125, heightNoiseMeters: 0.00012 },
    random: { seed: 2026080203 }
  },
  "concrete.slab.light": {
    resolution: { pixelsPerMeter: 200 },
    unit: { shortSizeMeters: 0.90, longSizeMeters: 1.80, thicknessMeters: 0.01, longAxis: "u" },
    layout: { mode: "stack", rowOffsetRatio: 0.0 },
    variationCell: { longUnitCount: 1, rowCount: 1 },
    joint: {
      widthMeters: 0.01,
      color: [0.6392156862745098, 0.6392156862745098, 0.6392156862745098],
      depthMeters: 0.002,
      edgeRoundMeters: 0
    },
    color: {
      base: [0.5725490196078431, 0.5803921568627451, 0.5607843137254902],
      unitVariation: 0.02,
      dirtColor: [0.2901960784313726, 0.30196078431372547, 0.28627450980392155],
      dirtAmount: 0.075
    },
    pattern: {
      mode: "mottle",
      scaleMeters: 0.075,
      colorAmount: 0.075,
      heightMeters: 0.00030
    },
    surface: { detailScaleMeters: 0.0125, heightNoiseMeters: 0.00025 },
    random: { seed: 2026080204 }
  },
  "concrete.block.gray": {
    resolution: { pixelsPerMeter: 200 },
    unit: { shortSizeMeters: 0.19, longSizeMeters: 0.39, thicknessMeters: 0.10, longAxis: "u" },
    layout: { mode: "running-bond", rowOffsetRatio: 0.50 },
    variationCell: { longUnitCount: 2, rowCount: 4 },
    joint: {
      widthMeters: 0.01,
      color: [0.6235294117647059, 0.615686274509804, 0.615686274509804],
      depthMeters: 0.01,
      edgeRoundMeters: 0.01
    },
    color: {
      base: [0.4, 0.4117647058823529, 0.4],
      unitVariation: 0.035,
      dirtColor: [0.18823529411764706, 0.2, 0.18823529411764706],
      dirtAmount: 0.10
    },
    pattern: {
      mode: "mottle",
      scaleMeters: 0.060,
      colorAmount: 0.07,
      heightMeters: 0.00045
    },
    surface: { detailScaleMeters: 0.010, heightNoiseMeters: 0.00030 },
    random: { seed: 2026080205 }
  },
  "fiber.cement.white": {
    resolution: { pixelsPerMeter: 200 },
    unit: { shortSizeMeters: 0.05, longSizeMeters: 0.25, thicknessMeters: null, longAxis: "u" },
    layout: { mode: "running-bond", rowOffsetRatio: 0.25 },
    variationCell: { longUnitCount: 4, rowCount: 8 },
    joint: {
      widthMeters: 0.01,
      color: [0.6980392156862745, 0.6823529411764706, 0.6],
      depthMeters: 0.005,
      edgeRoundMeters: 0.005
    },
    color: {
      base: [0.8156862745098039, 0.8, 0.7843137254901961],
      unitVariation: 0.035,
      dirtColor: [0.37254901960784315, 0.36470588235294116, 0.36470588235294116],
      dirtAmount: 0.02
    },
    pattern: {
      mode: "speckle",
      scaleMeters: 0.01,
      colorAmount: 0,
      heightMeters: 0.0002
    },
    surface: { detailScaleMeters: 0.015, heightNoiseMeters: 0.0001 },
    random: { seed: 2026080201 }
  },
  "fiber.cement.gray": {
    resolution: { pixelsPerMeter: 200 },
    unit: { shortSizeMeters: 0.05, longSizeMeters: 1, thicknessMeters: null, longAxis: "u" },
    layout: { mode: "stack", rowOffsetRatio: 0 },
    variationCell: { longUnitCount: 1, rowCount: 5 },
    joint: {
      widthMeters: 0.01,
      color: [0.34509803921568627, 0.34509803921568627, 0.35294117647058826],
      depthMeters: 0.005,
      edgeRoundMeters: 0.005
    },
    color: {
      base: [0.28627450980392155, 0.28627450980392155, 0.3137254901960784],
      unitVariation: 0.035,
      dirtColor: [0.6392156862745098, 0.6235294117647059, 0.6235294117647059],
      dirtAmount: 0.02
    },
    pattern: {
      mode: "speckle",
      scaleMeters: 0.01,
      colorAmount: 0,
      heightMeters: 0.0002
    },
    surface: { detailScaleMeters: 0.015, heightNoiseMeters: 0.0001 },
    random: { seed: 2026080201 }
  },
  "brick.running.red": {
    resolution: { pixelsPerMeter: 200 },
    unit: { shortSizeMeters: 0.10, longSizeMeters: 0.21, thicknessMeters: 0.06, longAxis: "u" },
    layout: { mode: "running-bond", rowOffsetRatio: 0.50 },
    variationCell: { longUnitCount: 4, rowCount: 8 },
    joint: {
      widthMeters: 0.01,
      color: [0.4196078431372549, 0.4196078431372549, 0.4196078431372549],
      depthMeters: 0.008,
      edgeRoundMeters: 0.005
    },
    color: {
      base: [0.47843137254901963, 0.16862745098039217, 0.10196078431372549],
      unitVariation: 0.05,
      dirtColor: [0.18823529411764706, 0.07450980392156863, 0.043137254901960784],
      dirtAmount: 0.08
    },
    pattern: {
      mode: "speckle",
      scaleMeters: 0.015,
      colorAmount: 0.05,
      heightMeters: 0.00035
    },
    surface: { detailScaleMeters: 0.005, heightNoiseMeters: 0.001 },
    random: { seed: 2026080206 }
  },
  "vinyl.tile.marble": {
    resolution: { pixelsPerMeter: 200 },
    unit: { shortSizeMeters: 0.30, longSizeMeters: 0.30, thicknessMeters: null, longAxis: "u" },
    layout: { mode: "stack", rowOffsetRatio: 0.0 },
    variationCell: { longUnitCount: 4, rowCount: 4 },
    joint: {
      widthMeters: 0.005,
      color: [0.1607843137254902, 0.1607843137254902, 0.1607843137254902],
      depthMeters: 0.0003,
      edgeRoundMeters: 0.005
    },
    color: {
      base: [0.6901960784313725, 0.6509803921568628, 0.5725490196078431],
      unitVariation: 0.02,
      dirtColor: [0.30196078431372547, 0.30980392156862746, 0.30196078431372547],
      dirtAmount: 0.02
    },
    pattern: {
      mode: "veined",
      scaleMeters: 0.0375,
      colorAmount: 0.1,
      heightMeters: 0.00003
    },
    surface: { detailScaleMeters: 0.0175, heightNoiseMeters: 0.00003 },
    random: { seed: 2026080207 }
  },
  "ceramic.white.square": {
    resolution: { pixelsPerMeter: 200 },
    unit: { shortSizeMeters: 0.20, longSizeMeters: 0.20, thicknessMeters: 0.008, longAxis: "u" },
    layout: { mode: "stack", rowOffsetRatio: 0.0 },
    variationCell: { longUnitCount: 4, rowCount: 4 },
    joint: {
      widthMeters: 0.005,
      color: [0.62, 0.62, 0.60],
      depthMeters: 0.0015,
      edgeRoundMeters: 0.005
    },
    color: {
      base: [0.91, 0.90, 0.86],
      unitVariation: 0.012,
      dirtColor: [0.52, 0.50, 0.46],
      dirtAmount: 0.012
    },
    pattern: { mode: "none", scaleMeters: 0.025, colorAmount: 0.0, heightMeters: 0.0 },
    surface: { detailScaleMeters: 0.020, heightNoiseMeters: 0.000015 },
    random: { seed: 2026080901 }
  },
  "resin.mosaic.voronoi": {
    resolution: { pixelsPerMeter: 200 },
    unit: { shortSizeMeters: 0.30, longSizeMeters: 0.30, thicknessMeters: null, longAxis: "u" },
    layout: { mode: "stack", rowOffsetRatio: 0.0 },
    variationCell: { longUnitCount: 4, rowCount: 4 },
    joint: {
      widthMeters: 0.005,
      color: [0.10196078431372549, 0.12156862745098039, 0.1411764705882353],
      depthMeters: 0.0005,
      edgeRoundMeters: 0.005
    },
    color: {
      base: [0.2, 0.47843137254901963, 0.5803921568627451],
      unitVariation: 0.025,
      dirtColor: [0.0784313725490196, 0.2, 0.25882352941176473],
      dirtAmount: 0.020
    },
    pattern: { mode: "voronoi", scaleMeters: 0.05, colorAmount: 0.14, heightMeters: 0.0001 },
    surface: { detailScaleMeters: 0.020, heightNoiseMeters: 0.00003 },
    random: { seed: 2026080902 }
  },
  "vinyl.cloudy.blue": {
    resolution: { pixelsPerMeter: 200 },
    unit: { shortSizeMeters: 0.45, longSizeMeters: 0.45, thicknessMeters: null, longAxis: "u" },
    layout: { mode: "stack", rowOffsetRatio: 0.0 },
    variationCell: { longUnitCount: 2, rowCount: 2 },
    joint: {
      widthMeters: 0.005,
      color: [0.12, 0.15, 0.18],
      depthMeters: 0.0004,
      edgeRoundMeters: 0.005
    },
    color: {
      base: [0.31, 0.48, 0.62],
      unitVariation: 0.015,
      dirtColor: [0.13, 0.22, 0.31],
      dirtAmount: 0.016
    },
    pattern: { mode: "cloudy", scaleMeters: 0.055, colorAmount: 0.095, heightMeters: 0.000025 },
    surface: { detailScaleMeters: 0.025, heightNoiseMeters: 0.000025 },
    random: { seed: 2026080903 }
  },
  "vinyl.linen.beige": {
    resolution: { pixelsPerMeter: 200 },
    unit: { shortSizeMeters: 0.30, longSizeMeters: 0.60, thicknessMeters: null, longAxis: "u" },
    layout: { mode: "running-bond", rowOffsetRatio: 0.5 },
    variationCell: { longUnitCount: 2, rowCount: 4 },
    joint: {
      widthMeters: 0.005,
      color: [0.5098039215686274, 0.47058823529411764, 0.39215686274509803],
      depthMeters: 0.0005,
      edgeRoundMeters: 0.005
    },
    color: {
      base: [0.6705882352941176, 0.5803921568627451, 0.45098039215686275],
      unitVariation: 0.02,
      dirtColor: [0.3215686274509804, 0.27058823529411763, 0.2],
      dirtAmount: 0.02
    },
    pattern: { mode: "linen", scaleMeters: 0.015, colorAmount: 0.085, heightMeters: 0.0001 },
    surface: { detailScaleMeters: 0.0025, heightNoiseMeters: 0.001 },
    random: { seed: 2026080904 }
  },
  "stone.terrazzo.gray": {
    resolution: { pixelsPerMeter: 200 },
    unit: { shortSizeMeters: 0.40, longSizeMeters: 0.40, thicknessMeters: 0.012, longAxis: "u" },
    layout: { mode: "stack", rowOffsetRatio: 0.0 },
    variationCell: { longUnitCount: 3, rowCount: 3 },
    joint: {
      widthMeters: 0.005,
      color: [0.30, 0.30, 0.29],
      depthMeters: 0.002,
      edgeRoundMeters: 0.005
    },
    color: {
      base: [0.55, 0.56, 0.55],
      unitVariation: 0.012,
      dirtColor: [0.25, 0.26, 0.25],
      dirtAmount: 0.020
    },
    pattern: { mode: "terrazzo", scaleMeters: 0.028, colorAmount: 0.16, heightMeters: 0.00030 },
    surface: { detailScaleMeters: 0.018, heightNoiseMeters: 0.00018 },
    random: { seed: 2026080905 }
  }
  };
  // 樹種ごとの既存色、寸法、surface値を共有し、板目recipeとseedだけを明示的に替える
  presets["wood.walnut.flat-sawn"] = {
    ...presets["wood.walnut.plank"],
    pattern: {
      mode: "flat-sawn-grain",
      scaleMeters: 0.010,
      colorAmount: 0.060,
      heightMeters: 0.00016
    },
    random: { seed: 2026080908 }
  };
  presets["wood.cedar.flat-sawn"] = {
    ...presets["wood.cedar.deck"],
    pattern: {
      mode: "flat-sawn-grain",
      scaleMeters: 0.010,
      colorAmount: 0.080,
      heightMeters: 0.00024
    },
    random: { seed: 2026080909 }
  };
  presets["wood.oak.mixed-sawn"] = {
    ...presets["wood.oak.plank"],
    pattern: {
      mode: "mixed-sawn-grain",
      scaleMeters: 0.010,
      colorAmount: 0.085,
      heightMeters: 0.00022
    },
    random: { seed: 2026080910 }
  };
  presets["wood.walnut.mixed-sawn"] = {
    ...presets["wood.walnut.plank"],
    pattern: {
      mode: "mixed-sawn-grain",
      scaleMeters: 0.010,
      colorAmount: 0.055,
      heightMeters: 0.00016
    },
    random: { seed: 2026080911 }
  };
  presets["wood.cedar.mixed-sawn"] = {
    ...presets["wood.cedar.deck"],
    pattern: {
      mode: "mixed-sawn-grain",
      scaleMeters: 0.010,
      colorAmount: 0.072,
      heightMeters: 0.00024
    },
    random: { seed: 2026080912 }
  };

  // 自然石は目地無しの周期面。色の明暗と曲面Heightを独立に生成する
  const pebbles = {
    resolution: { pixelsPerMeter: 200 },
    unit: { shortSizeMeters: 2, longSizeMeters: 2, thicknessMeters: null, longAxis: "u" },
    layout: { mode: "stack", rowOffsetRatio: 0 },
    variationCell: { longUnitCount: 1, rowCount: 1 },
    joint: { widthMeters: 0, color: [0.25, 0.25, 0.23], depthMeters: 0, edgeRoundMeters: 0 },
    color: { base: [0.48, 0.47, 0.44], unitVariation: 0, dirtColor: [0.23, 0.22, 0.20], dirtAmount: 0.015 },
    pattern: {
      mode: "pebbles", scaleMeters: 0.12, colorAmount: 0.16, heightMeters: 0.040,
      pebbles: { ...PEBBLE_DEFAULTS }
    },
    surface: { detailScaleMeters: 0.0125, heightNoiseMeters: 0 },
    random: { seed: 2026100301 }
  };

  // 石だけの場合は全bucketに粒を置き、広めの粒を狭い隙間で敷き詰める
  presets["stone.pebbles.gray"] = {
    ...pebbles,
    pattern: { ...pebbles.pattern, pebbles: { ...PEBBLE_DEFAULTS, density: 1, packing: 1, irregularity: 1 } }
  };
  presets["stone.pebbles-gravel.gray"] = {
    ...pebbles,
    pattern: { ...pebbles.pattern, pebbles: { ...PEBBLE_DEFAULTS, gravelAmount: 1 } }
  };
  presets["stone.gravel.gray"] = {
    ...pebbles,
    pattern: { ...pebbles.pattern, scaleMeters: 0.065, colorAmount: 0.12, heightMeters: 0.006 },
    random: { seed: 2026100302 }
  };
  return Object.freeze(presets);
})();

// 表示名、分類、PBR既定値をtexture生成specificationと分離して保持する
// presetからShapeへ材質を設定し、Compute側には生成に使う値だけを渡す
const PRESET_PROFILES = Object.freeze({
  "wood.oak.plank": { category: "wood", label: { ja: "オーク柾目", en: "Quarter-sawn Oak" }, appearance: { roughness: 0.56, specular: 0.50, metallic: 0.0, normalStrength: 1.12 } },
  "wood.oak.flat-sawn": { category: "wood", label: { ja: "オーク板目", en: "Flat-sawn Oak" }, appearance: { roughness: 0.58, specular: 0.48, metallic: 0.0, normalStrength: 1.18 } },
  "wood.walnut.plank": { category: "wood", label: { ja: "ウォールナット", en: "Walnut" }, appearance: { roughness: 0.54, specular: 0.50, metallic: 0.0, normalStrength: 1.16 } },
  "wood.cedar.deck": { category: "wood", label: { ja: "シダー", en: "Cedar" }, appearance: { roughness: 0.66, specular: 0.42, metallic: 0.0, normalStrength: 1.28 } },
  "wood.walnut.flat-sawn": { category: "wood", label: { ja: "ウォールナット板目", en: "Flat-sawn Walnut" }, appearance: { roughness: 0.54, specular: 0.50, metallic: 0.0, normalStrength: 1.12 } },
  "wood.cedar.flat-sawn": { category: "wood", label: { ja: "シダー板目", en: "Flat-sawn Cedar" }, appearance: { roughness: 0.64, specular: 0.44, metallic: 0.0, normalStrength: 1.20 } },
  "wood.oak.mixed-sawn": { category: "wood", label: { ja: "オーク柾目・板目mix", en: "Mixed-sawn Oak" }, appearance: { roughness: 0.57, specular: 0.49, metallic: 0.0, normalStrength: 1.15 } },
  "wood.walnut.mixed-sawn": { category: "wood", label: { ja: "ウォールナット柾目・板目mix", en: "Mixed-sawn Walnut" }, appearance: { roughness: 0.54, specular: 0.50, metallic: 0.0, normalStrength: 1.14 } },
  "wood.cedar.mixed-sawn": { category: "wood", label: { ja: "シダー柾目・板目mix", en: "Mixed-sawn Cedar" }, appearance: { roughness: 0.65, specular: 0.43, metallic: 0.0, normalStrength: 1.24 } },
  "concrete.slab.light": { category: "concrete", label: { ja: "ライトコンクリート", en: "Light Concrete" }, appearance: { roughness: 0.90, specular: 0.22, metallic: 0.0, normalStrength: 1.35 } },
  "concrete.block.gray": { category: "concrete", label: { ja: "コンクリートブロック", en: "Concrete Block" }, appearance: { roughness: 0.94, specular: 0.18, metallic: 0.0, normalStrength: 1.5 } },
  "fiber.cement.white": { category: "cement", label: { ja: "窯業系 白", en: "Fiber-Cement white" }, appearance: { roughness: 0.56, specular: 0.50, metallic: 0.0, normalStrength: 1.10 } },
  "fiber.cement.gray": { category: "cement", label: { ja: "窯業系 グレー", en: "Fiber-Cement gray" }, appearance: { roughness: 0.56, specular: 0.50, metallic: 0.0, normalStrength: 1.10 } },
  "brick.running.red": { category: "brick", label: { ja: "赤レンガ", en: "Red Brick" }, appearance: { roughness: 0.9, specular: 0.2, metallic: 0.0, normalStrength: 1.35 } },
  "vinyl.tile.marble": { category: "vinyl", label: { ja: "マーブルビニール", en: "Marble Vinyl" }, appearance: { roughness: 0.28, specular: 0.68, metallic: 0.0, normalStrength: 1.00 } },
  "ceramic.white.square": { category: "ceramic", label: { ja: "白タイル", en: "White Ceramic" }, appearance: { roughness: 0.16, specular: 0.76, metallic: 0.0, normalStrength: 0.82 } },
  "resin.mosaic.voronoi": { category: "resin", label: { ja: "樹脂モザイク", en: "Resin Mosaic" }, appearance: { roughness: 0.8, specular: 0.7, metallic: 0.0, normalStrength: 1.00 } },
  "vinyl.cloudy.blue": { category: "vinyl", label: { ja: "クラウディブルー", en: "Cloudy Blue" }, appearance: { roughness: 0.34, specular: 0.60, metallic: 0.0, normalStrength: 0.90 } },
  "vinyl.linen.beige": { category: "vinyl", label: { ja: "リネンベージュ", en: "Linen Beige" }, appearance: { roughness: 0.42, specular: 0.52, metallic: 0.0, normalStrength: 1.05 } },
  "stone.terrazzo.gray": { category: "stone", label: { ja: "グレーテラゾー", en: "Gray Terrazzo" }, appearance: { roughness: 0.62, specular: 0.42, metallic: 0.0, normalStrength: 1.30 } },
  "stone.pebbles.gray": { category: "stone", label: { ja: "石だけ（丸い石粒）", en: "Rounded Pebbles" }, appearance: { roughness: 0.85, specular: 0.28, metallic: 0, normalStrength: 1 } },
  "stone.pebbles-gravel.gray": { category: "stone", label: { ja: "石と砂利", en: "Pebbles and Gravel" }, appearance: { roughness: 0.90, specular: 0.24, metallic: 0, normalStrength: 1 } },
  "stone.gravel.gray": { category: "stone", label: { ja: "砂利だけ", en: "Gravel" }, appearance: { roughness: 0.93, specular: 0.20, metallic: 0, normalStrength: 1 } }
});

// 同じ樹種の柾目／板目を明示的な公開順で隣接表示する
// 公開順を専用配列で保持し、UIと文書へ安定した並びを返す
const PRESET_ORDER = Object.freeze([
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
// 配列を含む設定を再帰的に複製し、catalogの内部定義を変更可能な作業値へ分離する
// primitiveはそのまま返し、配列とplain objectだけを新しい参照へ再構築する
function cloneValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => cloneValue(item));
  }
  if (value && typeof value === "object") {
    const result = {};
    for (const key of Object.keys(value)) {
      result[key] = cloneValue(value[key]);
    }
    return result;
  }
  return value;
}

// 上書き側のkeyを検査し、綴り間違いを入力エラーとして報告する
// object階層は再帰的にmergeし、配列やscalarは後ろのoverride値で全体を置き換える
function mergeKnownKeys(target, overrides, path) {
  const source = util.readPlainObject(overrides, `${path} overrides`);
  for (const key of Object.keys(source)) {
    if (!Object.prototype.hasOwnProperty.call(target, key)) {
      throw new Error(`${path} has unknown option: ${key}`);
    }
    const nextPath = `${path}.${key}`;
    const targetValue = target[key];
    const overrideValue = source[key];
    if (targetValue && typeof targetValue === "object" && !Array.isArray(targetValue)) {
      mergeKnownKeys(targetValue, overrideValue, nextPath);
    } else {
      target[key] = cloneValue(overrideValue);
    }
  }
  return target;
}

// PBR外観値をtexture生成parameterから独立して検証し、Shape登録時の既定値を確定する
// roughness等は0〜1、Normal strengthは0〜8へ制限し、描画設定としてfreezeする
function validateAppearance(appearance, label = "procedural material appearance") {
  const source = util.readPlainObject(appearance, label);
  const knownKeys = new Set(["roughness", "specular", "metallic", "normalStrength"]);
  for (const key of Object.keys(source)) {
    if (!knownKeys.has(key)) throw new Error(`${label} has unknown option: ${key}`);
  }
  return Object.freeze({
    roughness: util.readFiniteNumber(source.roughness, `${label}.roughness`, { min: 0.0, max: 1.0 }),
    specular: util.readFiniteNumber(source.specular, `${label}.specular`, { min: 0.0, max: 1.0 }),
    metallic: util.readFiniteNumber(source.metallic, `${label}.metallic`, { min: 0.0, max: 1.0 }),
    normalStrength: util.readFiniteNumber(source.normalStrength, `${label}.normalStrength`, { min: 0.0, max: 8.0 })
  });
}

// Download済みdefinitionの識別情報を元の型で検証する
// schema対象のkey、ID、category、日英labelを確認し、tileやappearanceの検証は専用処理へ分離する
function validateDefinitionMetadata(source) {
  const knownKeys = new Set([
    "id", "schemaVersion", "category", "label", "tile", "appearance"
  ]);
  for (const key of Object.keys(source)) {
    if (!knownKeys.has(key)) throw new Error(`ProceduralMaterials definition has unknown option: ${key}`);
  }
  if (typeof source.id !== "string" || source.id.length === 0) {
    throw new Error("ProceduralMaterials definition.id must be a non-empty string");
  }
  const category = source.category ?? "custom";
  if (typeof category !== "string" || category.length === 0) {
    throw new Error("ProceduralMaterials definition.category must be a non-empty string");
  }
  const label = util.readPlainObject(source.label ?? { ja: source.id, en: source.id }, "ProceduralMaterials definition.label");
  for (const key of Object.keys(label)) {
    if (key !== "ja" && key !== "en") {
      throw new Error(`ProceduralMaterials definition.label has unknown option: ${key}`);
    }
  }
  if (typeof label.ja !== "string" || label.ja.length === 0 || typeof label.en !== "string" || label.en.length === 0) {
    throw new Error("ProceduralMaterials definition.label.ja and label.en must be non-empty strings");
  }
  return Object.freeze({
    id: source.id,
    category,
    label: Object.freeze({ ja: label.ja, en: label.en })
  });
}

// preset registryとdownload出力で共用する完成definitionを複製し、呼出側による変更を分離する
// tileへpresetIdを付与して共通schemaで検証し、metadata、tile、appearanceを一つの不変definitionへまとめる
function buildDefinition(presetId, tile, profile) {
  const completeTile = cloneValue(tile);
  completeTile.presetId = presetId;
  return Object.freeze({
    id: presetId,
    schemaVersion: 1,
    category: profile.category,
    label: Object.freeze(cloneValue(profile.label)),
    tile: ProceduralTileSpec.validate(completeTile),
    appearance: validateAppearance(profile.appearance, `${presetId}.appearance`)
  });
}

class ProceduralMaterial {
  // managerが所有する生成resultと検証済みdefinitionを、一つの利用者向けhandleとして保持する
  // GPU resourceの所有権はownerへ残し、このhandle自身はdestroy時にownerへ解放を依頼する
  constructor(owner, definition, result, scale = null) {
    this.owner = owner;
    this.definition = definition;
    this.result = result;
    // scale指定時はpresetが持つ実寸textureを何倍の大きさで表示するかを保持する
    // 未指定時は既存利用側が作成済みのRepeat UVをそのまま使用する
    this.scale = scale;
    this.scaledShapes = new WeakSet();
    this.destroyed = false;
  }

  // 検証済みdefinitionからmaterial IDを返し、metadataの階層をこの入口へ集約する
  get id() { return this.definition.id; }

  // 生成resultからRepeat texture一周期の実寸幅と高さを返し、Shape側のUV計算に利用できるようにする
  get tileSizeMeters() { return this.result.tileSizeMeters; }

  // 生成resultのColor map Texture wrapperを読取専用handleとして公開する
  get colorTexture() { return this.result.colorTexture; }

  // Normal生成前のencode済みHeight mapをpreviewやdiagnosticsから参照できるようにする
  get heightTexture() { return this.result.heightTexture; }

  // Shapeのnormal_textureへそのまま登録できるNormal map Texture wrapperを公開する
  get normalTexture() { return this.result.normalTexture; }

  // scale指定時だけ、入力UVを拡大後のpreset texture実寸周期へ変換する
  // GPU buffer確定後の書換えはCPU配列と描画内容を不一致にするため明示的に拒否する
  applyScaleToShape(shape) {
    if (this.scale === null) return;
    if (shape.vertexBuffer || shape.vertexBuffer0 || shape.vertexBuffer1) {
      throw new Error(
        `ProceduralMaterial ${this.id} with scale must be applied before Shape.endShape()`
      );
    }
    if (this.scaledShapes.has(shape)) {
      throw new Error(`ProceduralMaterial ${this.id} scale was already applied to this Shape`);
    }
    const tileWidth = util.readFiniteNumber(
      this.tileSizeMeters?.[0],
      `ProceduralMaterial ${this.id} tile width`,
      { minExclusive: 0.0 }
    );
    const tileHeight = util.readFiniteNumber(
      this.tileSizeMeters?.[1],
      `ProceduralMaterial ${this.id} tile height`,
      { minExclusive: 0.0 }
    );
    // scaleが大きいほど一周期の実寸を大きくし、UV上の反復回数を少なくする
    // scale 0.1なら一周期は1/10、反復回数は10倍になる
    const scaleU = 1.0 / (tileWidth * this.scale);
    const scaleV = 1.0 / (tileHeight * this.scale);
    for (let index = 0; index < shape.texCoordsArray.length; index += 2) {
      shape.texCoordsArray[index] *= scaleU;
      shape.texCoordsArray[index + 1] *= scaleV;
    }
    this.scaledShapes.add(shape);
  }

  // 既存UVを持つShapeへColor、Normal、PBR外観を一括登録する
  // scale指定時はendShape前、未指定時は従来どおり完成後にも適用できる
  // geometryは呼出側が準備し、材質適用時にUV不足を具体的な契約違反として報告する
  // optionsをpreset appearanceの複製へ上書きし、保存済みdefinitionは原本として保つ
  applyTo(shape, options = {}) {
    if (this.destroyed) throw new Error(`ProceduralMaterial ${this.id} is destroyed`);
    if (!shape?.setMaterialAt || !shape?.setMaterial) {
      throw new Error("ProceduralMaterial.applyTo requires a Shape");
    }
    if (!(shape.vertexCount > 0) || shape.texCoordsArray?.length !== shape.vertexCount * 2) {
      throw new Error("ProceduralMaterial.applyTo requires a Shape with UV coordinates");
    }
    this.applyScaleToShape(shape);
    const source = util.readPlainObject(options, "ProceduralMaterial.applyTo options");
    const knownKeys = new Set([
      "slot", "materialId", "roughness", "specular", "metallic", "normalStrength",
      "alpha", "ambient", "power", "emissive", "flatShading"
    ]);
    for (const key of Object.keys(source)) {
      if (!knownKeys.has(key)) throw new Error(`ProceduralMaterial.applyTo has unknown option: ${key}`);
    }
    const appearance = this.definition.appearance;
    const slot = util.readFiniteNumber(source.slot ?? 0, "ProceduralMaterial.applyTo slot", {
      integer: true,
      min: 0
    });
    const materialId = source.materialId ?? "smooth-shader";
    if (typeof materialId !== "string" || materialId.length === 0) {
      throw new Error("ProceduralMaterial.applyTo materialId must be a non-empty string");
    }
    shape.setMaterialAt(slot, materialId, {
      has_bone: 0,
      use_texture: 1,
      texture: this.result.colorTexture,
      use_normal_map: 1,
      normal_texture: this.result.normalTexture,
      normal_strength: util.readFiniteNumber(
        source.normalStrength ?? appearance.normalStrength,
        "ProceduralMaterial.applyTo normalStrength",
        { min: 0.0, max: 8.0 }
      ),
      color: [1, 1, 1, 1],
      alpha: util.readFiniteNumber(source.alpha ?? 1.0, "ProceduralMaterial.applyTo alpha", { min: 0.0, max: 1.0 }),
      ambient: util.readFiniteNumber(source.ambient ?? 0.25, "ProceduralMaterial.applyTo ambient", { min: 0.0, max: 1.0 }),
      roughness: util.readFiniteNumber(source.roughness ?? appearance.roughness, "ProceduralMaterial.applyTo roughness", { min: 0.0, max: 1.0 }),
      specular: util.readFiniteNumber(source.specular ?? appearance.specular, "ProceduralMaterial.applyTo specular", { min: 0.0, max: 1.0 }),
      metallic: util.readFiniteNumber(source.metallic ?? appearance.metallic, "ProceduralMaterial.applyTo metallic", { min: 0.0, max: 1.0 }),
      power: util.readFiniteNumber(source.power ?? 34, "ProceduralMaterial.applyTo power", { min: 0.0 }),
      emissive: util.readFiniteNumber(source.emissive ?? 0.0, "ProceduralMaterial.applyTo emissive", { min: 0.0 }),
      flat_shading: source.flatShading === undefined ? 1 : (source.flatShading ? 1 : 0)
    });
    return shape;
  }

  // このhandleに対応するtextureとbufferをowner経由で解放し、以後のapplyToを禁止する
  // 二重解放判定と所有者検査はProceduralMaterials.destroyMaterialへ集約する
  destroy() {
    return this.owner.destroyMaterial(this);
  }
}

// preset catalogから完成設定を作り、面ごとの差だけを上書きする
class ProceduralMaterials {
  // readyなWebGPU contextからCompute generatorを一つ作り、生成handleの所有集合を初期化する
  // shader validation結果はmanager単位でcacheし、preset生成ごとの再検査を避ける
  constructor(gpu) {
    if (!gpu?.device || !gpu?.queue) {
      throw new Error("ProceduralMaterials requires a ready WebGPU context");
    }
    this.generator = new ComputeProceduralTile(gpu);
    this.materials = new Set();
    this.shaderValidated = false;
    this.destroyed = false;
  }

  // core presetを変更可能な作業値へ複製し、複数overrideを引数順に重ねてtile specificationを返す
  // 未知preset、未知key、範囲外値を各段階で検証し、指定に合うpresetだけを選ぶ
  static resolve(presetId, ...overrideLayers) {
    if (!Object.prototype.hasOwnProperty.call(MATERIAL_PRESETS, presetId)) {
      throw new Error(`ProceduralMaterials has unknown preset: ${presetId}`);
    }
    const resolved = cloneValue(MATERIAL_PRESETS[presetId]);
    // paletteで変更する基準値と面ごとの比較値を順番に重ねられるよう、複数の差分を受け取る
    // 後ろの層を優先するため、sample固有の比較差分は利用者が変更した基準値の上へ適用できる
    for (const overrides of overrideLayers) {
      mergeKnownKeys(resolved, overrides, presetId);
    }
    resolved.presetId = presetId;
    return ProceduralTileSpec.validate(resolved);
  }

  // UIや文書がcatalog内容を列挙できるよう、登録済みIDだけを新しい配列で返す
  // 凍結配列の複製を返し、内部のregistry順を保つ
  static listPresetIds() {
    return Array.from(PRESET_ORDER);
  }

  // UIがcategory、表示名、完成設定を同じregistryから取得できるようにする
  // 毎回独立した完成definitionを構築し、core preset objectを原本として保つ
  static getPresetDefinition(presetId) {
    if (!Object.prototype.hasOwnProperty.call(MATERIAL_PRESETS, presetId)) {
      throw new Error(`ProceduralMaterials has unknown preset: ${presetId}`);
    }
    return buildDefinition(presetId, MATERIAL_PRESETS[presetId], PRESET_PROFILES[presetId]);
  }

  // 公開順の全preset IDを完成definitionへ変換し、catalog描画にそのまま使える配列を返す
  // ID配列とdefinition配列の順序を同じlistPresetIds()へ集約する
  static listPresetDefinitions() {
    return ProceduralMaterials.listPresetIds().map((presetId) => (
      ProceduralMaterials.getPresetDefinition(presetId)
    ));
  }

  // Tile／Normal shaderのcompilation messageを最初の生成前に一度だけ検査する
  // errorがあればtexture確保へ進まず例外にし、成功後だけshaderValidatedをtrueへ変更する
  async ensureShaderValidation() {
    if (this.destroyed) throw new Error("ProceduralMaterials is destroyed");
    if (this.shaderValidated) return;
    await this.generator.validateShaderCompilation();
    this.shaderValidated = true;
  }

  // コアpresetへtile／appearance差分とtexture大きさ倍率を指定し、再利用可能なhandleを返す
  // tileとappearanceを別々にmergeし、scaleを検証してから完成definition経路のcreate()へ集約する
  async createPreset(presetId, options = {}) {
    const source = util.readPlainObject(options, "ProceduralMaterials.createPreset options");
    for (const key of Object.keys(source)) {
      if (key !== "tile" && key !== "appearance" && key !== "scale") {
        throw new Error(`ProceduralMaterials.createPreset has unknown option: ${key}`);
      }
    }
    const scale = source.scale === undefined
      ? null
      : util.readFiniteNumber(
          source.scale,
          "ProceduralMaterials.createPreset scale",
          { minExclusive: 0.0 }
        );
    const preset = ProceduralMaterials.getPresetDefinition(presetId);
    const tile = ProceduralMaterials.resolve(presetId, source.tile ?? {});
    const appearance = cloneValue(preset.appearance);
    if (source.appearance !== undefined) {
      mergeKnownKeys(appearance, source.appearance, `${presetId}.appearance`);
    }
    return this.create({
      id: presetId,
      schemaVersion: 1,
      category: preset.category,
      label: preset.label,
      tile,
      appearance
    }, { scale });
  }

  // texture_catalogが出力した完成definitionを検証し、その設定から直接生成する
  // metadata、schema version、tile、appearanceを確定してからComputeを実行し、成功resultだけを所有集合へ登録する
  async create(definition, options = {}) {
    if (this.destroyed) throw new Error("ProceduralMaterials is destroyed");
    const source = util.readPlainObject(definition, "ProceduralMaterials definition");
    const createOptions = util.readPlainObject(options, "ProceduralMaterials.create options");
    for (const key of Object.keys(createOptions)) {
      if (key !== "scale") {
        throw new Error(`ProceduralMaterials.create has unknown option: ${key}`);
      }
    }
    const scale = createOptions.scale === undefined || createOptions.scale === null
      ? null
      : util.readFiniteNumber(
          createOptions.scale,
          "ProceduralMaterials.create scale",
          { minExclusive: 0.0 }
        );
    const metadata = validateDefinitionMetadata(source);
    const schemaVersion = util.readFiniteNumber(
      source.schemaVersion ?? 1,
      "ProceduralMaterials definition.schemaVersion",
      { integer: true, min: 1, max: 1 }
    );
    const tile = ProceduralTileSpec.validate(source.tile);
    const appearance = validateAppearance(source.appearance, `${metadata.id}.appearance`);
    await this.ensureShaderValidation();
    const result = await this.generator.generate(tile);
    const material = new ProceduralMaterial(this, Object.freeze({
      id: metadata.id,
      schemaVersion,
      category: metadata.category,
      label: metadata.label,
      tile,
      appearance
    }), result, scale);
    this.materials.add(material);
    return material;
  }

  // このmanagerが所有する一つのhandleについて、生成resultを破棄しhandleを無効状態へ遷移させる
  // 別managerのhandleはresource誤解放を防ぐため拒否し、二重destroyはfalseで通知する
  destroyMaterial(material) {
    if (!(material instanceof ProceduralMaterial) || material.owner !== this) {
      throw new Error("ProceduralMaterials.destroyMaterial requires an owned material");
    }
    if (material.destroyed) return false;
    this.generator.destroyResult(material.result);
    material.result = null;
    material.destroyed = true;
    this.materials.delete(material);
    return true;
  }

  // 所有中の全materialを個別解放してからgenerator参照を破棄し、manager全体を終了状態にする
  // Setを配列へ写してから反復し、destroyMaterialによる削除中も全要素を走査する
  destroy() {
    if (this.destroyed) return false;
    for (const material of Array.from(this.materials)) this.destroyMaterial(material);
    this.generator.destroy();
    this.generator = null;
    this.destroyed = true;
    return true;
  }
}

export default ProceduralMaterials;
export { ProceduralMaterial, ProceduralMaterials };
