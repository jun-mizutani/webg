// ---------------------------------------------
// ProceduralTileSpec.js  2026/10/04
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// Shared validation and dimensions contract for procedural tile generators

import util from "./util.js";

// CPU参照版とCompute版が受理するpattern名を一か所へ固定し、実装ごとの綴り差を防ぐ
// UIやcatalogは公開配列を列挙し、validationは一覧外の文字列をエラーとして報告する
const PATTERN_MODES = Object.freeze([
  "none",
  "longitudinal-grain",
  "quarter-sawn-grain",
  "flat-sawn-grain",
  "mixed-sawn-grain",
  "mottle",
  "speckle",
  "voronoi",
  "veined",
  "cloudy",
  "linen",
  "terrazzo",
  "pebbles"
]);

// 石粒専用の省略値。色の濃淡と曲面Heightを独立したfieldとして設定する
// gravelAmount=0なら一種類の粒だけ、1なら隙間へ小粒を敷く
const PEBBLE_DEFAULTS = Object.freeze({
  density: 0.95,
  packing: 0,
  irregularity: 0.8,
  roundness: 1,
  gravelAmount: 0,
  gravelScaleMeters: 0.065,
  gravelHeightMeters: 0.006,
  gravelColorAmount: 0.10
});

// Row Offsetの選択値をtextureの上下で配置が閉じる行周期へ変換する
// 利用側が提供する四種類の分数を明示的に検証する
// 戻り値はvariation row数の倍数条件とrunning-bondのrow phase計算へ共用する
function getRowOffsetDenominator(rowOffsetRatio) {
  if (rowOffsetRatio === 0.0) return 1;
  if (rowOffsetRatio === 0.5) return 2;
  if (rowOffsetRatio === 1 / 3) return 3;
  if (rowOffsetRatio === 0.25) return 4;
  throw new Error("layout.rowOffsetRatio must be 0, 1/2, 1/3, or 1/4");
}

// meter指定をpixelへ変換し、解像度で正確に表せる寸法を検証する
// allowZeroはpixelへ変換する目地幅とedge roundに使用し、目地深さは別の有限値検証で0以上を受理する
function metersToExactPixels(meters, pixelsPerMeter, label, { allowZero = false } = {}) {
  const checkedMeters = util.readFiniteNumber(meters, label, {
    min: allowZero ? 0.0 : null,
    minExclusive: allowZero ? null : 0.0
  });
  const exactPixels = checkedMeters * pixelsPerMeter;
  const pixels = Math.round(exactPixels);
  if (Math.abs(exactPixels - pixels) > 1.0e-9) {
    throw new Error(
      `${label}=${checkedMeters}m cannot be represented exactly at ${pixelsPerMeter}px/m`
    );
  }
  if (!allowZero && pixels < 1) {
    throw new Error(`${label} must occupy at least one pixel`);
  }
  return pixels;
}

// 完成specificationのkeyも検証し、綴り間違いをエラーとして報告する
// object自身のkeyを検査し、schemaに合う値だけをgeneratorへ渡す
function assertKnownKeys(source, label, keys) {
  const knownKeys = new Set(keys);
  for (const key of Object.keys(source)) {
    if (!knownKeys.has(key)) throw new Error(`${label} has unknown option: ${key}`);
  }
}

class ProceduralTileSpec {
  // Catalogまたは利用側が完成させた設定を正規化し、未知値や不整合を生成開始前に拒否する
  // 第1段階で全sectionのobject型とkey集合を確認し、第2段階で個々の型と範囲を確定する
  // 第3段階でsectionをまたぐ寸法・配置契約を検査し、生成側から独立したsnapshotを返す
  static validate(specification) {
    // sectionをplain objectとして検証してから、後続のfieldを参照する
    const spec = util.readPlainObject(specification, "ProceduralTileSpec specification");
    const resolution = util.readPlainObject(spec.resolution, "specification.resolution");
    const unit = util.readPlainObject(spec.unit, "specification.unit");
    const layout = util.readPlainObject(spec.layout, "specification.layout");
    const variationCell = util.readPlainObject(spec.variationCell, "specification.variationCell");
    const joint = util.readPlainObject(spec.joint, "specification.joint");
    const color = util.readPlainObject(spec.color, "specification.color");
    const pattern = util.readPlainObject(spec.pattern, "specification.pattern");
    const surface = util.readPlainObject(spec.surface, "specification.surface");
    const random = util.readPlainObject(spec.random, "specification.random");

    // 全階層でschemaのkeyを検査し、綴り間違いを入力エラーとして報告する
    assertKnownKeys(spec, "ProceduralTileSpec specification", [
      "presetId", "resolution", "unit", "layout", "variationCell", "joint",
      "color", "pattern", "surface", "random"
    ]);
    assertKnownKeys(resolution, "specification.resolution", ["pixelsPerMeter"]);
    assertKnownKeys(unit, "specification.unit", ["shortSizeMeters", "longSizeMeters", "thicknessMeters", "longAxis"]);
    assertKnownKeys(layout, "specification.layout", ["mode", "rowOffsetRatio"]);
    assertKnownKeys(variationCell, "specification.variationCell", ["longUnitCount", "rowCount"]);
    assertKnownKeys(joint, "specification.joint", ["widthMeters", "color", "depthMeters", "edgeRoundMeters"]);
    assertKnownKeys(color, "specification.color", ["base", "unitVariation", "dirtColor", "dirtAmount"]);
    assertKnownKeys(pattern, "specification.pattern", ["mode", "scaleMeters", "colorAmount", "heightMeters", "pebbles"]);
    assertKnownKeys(surface, "specification.surface", ["detailScaleMeters", "heightNoiseMeters"]);
    assertKnownKeys(random, "specification.random", ["seed"]);
    if (spec.presetId !== undefined && (typeof spec.presetId !== "string" || spec.presetId.length === 0)) {
      throw new Error("specification.presetId must be a non-empty string");
    }

    // 全scalar、enum、colorを用途別の範囲へ正規化し、生成側へ検証済みの値を渡す
    const checked = {
      presetId: spec.presetId ?? "custom",
      resolution: {
        pixelsPerMeter: util.readFiniteNumber(
          resolution.pixelsPerMeter,
          "resolution.pixelsPerMeter",
          { integer: true, min: 1, max: 2048 }
        )
      },
      unit: {
        shortSizeMeters: util.readFiniteNumber(
          unit.shortSizeMeters,
          "unit.shortSizeMeters",
          { minExclusive: 0.0 }
        ),
        longSizeMeters: util.readFiniteNumber(
          unit.longSizeMeters,
          "unit.longSizeMeters",
          { minExclusive: 0.0 }
        ),
        thicknessMeters: unit.thicknessMeters === null
          ? null
          : util.readFiniteNumber(
              unit.thicknessMeters,
              "unit.thicknessMeters",
              { minExclusive: 0.0 }
            ),
        longAxis: util.readOptionalEnum(unit.longAxis, "unit.longAxis", undefined, ["u", "v"])
      },
      layout: {
        mode: util.readOptionalEnum(
          layout.mode,
          "layout.mode",
          undefined,
          ["stack", "running-bond"]
        ),
        rowOffsetRatio: util.readFiniteNumber(
          layout.rowOffsetRatio,
          "layout.rowOffsetRatio",
          { min: 0.0, maxExclusive: 1.0 }
        )
      },
      variationCell: {
        longUnitCount: util.readFiniteNumber(
          variationCell.longUnitCount,
          "variationCell.longUnitCount",
          { integer: true, min: 1, max: 64 }
        ),
        rowCount: util.readFiniteNumber(
          variationCell.rowCount,
          "variationCell.rowCount",
          { integer: true, min: 1, max: 64 }
        )
      },
      joint: {
        widthMeters: util.readFiniteNumber(joint.widthMeters, "joint.widthMeters", { min: 0.0 }),
        color: util.readColor(joint.color, "joint.color", undefined, 3),
        depthMeters: util.readFiniteNumber(
          joint.depthMeters,
          "joint.depthMeters",
          { min: 0.0 }
        ),
        edgeRoundMeters: util.readFiniteNumber(
          joint.edgeRoundMeters,
          "joint.edgeRoundMeters",
          { min: 0.0 }
        )
      },
      color: {
        base: util.readColor(color.base, "color.base", undefined, 3),
        unitVariation: util.readFiniteNumber(
          color.unitVariation,
          "color.unitVariation",
          { min: 0.0, max: 0.25 }
        ),
        dirtColor: util.readColor(color.dirtColor, "color.dirtColor", undefined, 3),
        dirtAmount: util.readFiniteNumber(
          color.dirtAmount,
          "color.dirtAmount",
          { min: 0.0, max: 1.0 }
        )
      },
      pattern: {
        mode: util.readOptionalEnum(pattern.mode, "pattern.mode", undefined, PATTERN_MODES),
        scaleMeters: util.readFiniteNumber(
          pattern.scaleMeters,
          "pattern.scaleMeters",
          { minExclusive: 0.0 }
        ),
        colorAmount: util.readFiniteNumber(
          pattern.colorAmount,
          "pattern.colorAmount",
          { min: 0.0, max: 0.25 }
        ),
        heightMeters: util.readFiniteNumber(
          pattern.heightMeters,
          "pattern.heightMeters",
          { min: 0.0 }
        )
      },
      surface: {
        detailScaleMeters: util.readFiniteNumber(
          surface.detailScaleMeters,
          "surface.detailScaleMeters",
          { minExclusive: 0.0 }
        ),
        heightNoiseMeters: util.readFiniteNumber(
          surface.heightNoiseMeters,
          "surface.heightNoiseMeters",
          { min: 0.0 }
        )
      },
      random: {
        seed: util.readFiniteNumber(
          random.seed,
          "random.seed",
          { integer: true, min: 0, max: 0x7fffffff }
        )
      }
    };

    // 石粒patternに追加設定をまとめ、既存patternの完成specを維持する
    if (pattern.pebbles !== undefined && checked.pattern.mode !== "pebbles") {
      throw new Error("pattern.pebbles requires pattern.mode=pebbles");
    }
    if (checked.pattern.mode === "pebbles") {
      const source = util.readPlainObject(pattern.pebbles === undefined ? {} : pattern.pebbles, "pattern.pebbles");
      assertKnownKeys(source, "pattern.pebbles", Object.keys(PEBBLE_DEFAULTS));
      const values = {};
      for (const [name, fallback] of Object.entries(PEBBLE_DEFAULTS)) {
        const limits = name === "gravelScaleMeters" ? { minExclusive: 0 }
          : name === "gravelHeightMeters" ? { min: 0 }
          : { min: 0, max: name === "gravelColorAmount" ? 0.25 : 1 };
        values[name] = util.readFiniteNumber(source[name] === undefined ? fallback : source[name], `pattern.pebbles.${name}`, limits);
      }
      checked.pattern.pebbles = values;
    }

    // sectionをまたぐ周期条件を検査し、閉じた周期のtextureだけを生成する
    if (checked.unit.longSizeMeters < checked.unit.shortSizeMeters) {
      throw new Error("unit.longSizeMeters must be >= unit.shortSizeMeters");
    }
    if (checked.layout.mode === "stack" && checked.layout.rowOffsetRatio !== 0.0) {
      throw new Error("layout.rowOffsetRatio must be 0 for stack layout");
    }
    if (
      checked.pattern.mode === "mixed-sawn-grain"
      && checked.variationCell.longUnitCount * checked.variationCell.rowCount < 2
    ) {
      throw new Error("mixed-sawn-grain requires at least two variation units");
    }
    const denominator = getRowOffsetDenominator(checked.layout.rowOffsetRatio);
    if (
      checked.layout.mode === "running-bond"
      && checked.variationCell.rowCount % denominator !== 0
    ) {
      throw new Error(
        `variationCell.rowCount must be a multiple of ${denominator} `
        + `for row offset ${checked.layout.rowOffsetRatio}`
      );
    }
    return checked;
  }

  // 検証済み設定からCPU版とCompute版が共通利用するtile寸法を計算する
  // meter値を完全に表せる整数pixelへ変換し、部材pitch、variation範囲、texture全体寸法を順に求める
  static buildDimensions(specification) {
    // 寸法計算の入口でも入力を検証し、生成処理と共通の契約を適用する
    const spec = ProceduralTileSpec.validate(specification);
    const pixelsPerMeter = spec.resolution.pixelsPerMeter;
    const shortPixels = metersToExactPixels(
      spec.unit.shortSizeMeters,
      pixelsPerMeter,
      "unit.shortSizeMeters"
    );
    const longPixels = metersToExactPixels(
      spec.unit.longSizeMeters,
      pixelsPerMeter,
      "unit.longSizeMeters"
    );
    const jointPixels = metersToExactPixels(
      spec.joint.widthMeters,
      pixelsPerMeter,
      "joint.widthMeters",
      { allowZero: true }
    );
    const edgeRoundPixels = metersToExactPixels(
      spec.joint.edgeRoundMeters,
      pixelsPerMeter,
      "joint.edgeRoundMeters",
      { allowZero: true }
    );
    // 一部材と隣接目地をpitchとして、variation cell全体がRepeat可能な整数pixel範囲を構成する
    const longPitchPixels = longPixels + jointPixels;
    const shortPitchPixels = shortPixels + jointPixels;
    const rowOffsetDenominator = getRowOffsetDenominator(spec.layout.rowOffsetRatio);
    const longOffsetPixels = spec.layout.mode === "running-bond"
      ? spec.layout.rowOffsetRatio * longPixels
      : 0;
    const longExtentPixels = longPitchPixels * spec.variationCell.longUnitCount;
    const shortExtentPixels = shortPitchPixels * spec.variationCell.rowCount;
    const width = spec.unit.longAxis === "u" ? longExtentPixels : shortExtentPixels;
    const height = spec.unit.longAxis === "u" ? shortExtentPixels : longExtentPixels;
    // generator間で同じ導出値を使えるよう、pixel寸法と実寸texture sizeを一つの独立objectで返す
    return {
      pixelsPerMeter,
      shortPixels,
      longPixels,
      jointPixels,
      edgeRoundPixels,
      shortPitchPixels,
      longPitchPixels,
      longOffsetPixels,
      rowOffsetDenominator,
      rowCount: spec.variationCell.rowCount,
      longUnitCount: spec.variationCell.longUnitCount,
      width,
      height,
      tileSizeMeters: [width / pixelsPerMeter, height / pixelsPerMeter]
    };
  }

  // CPU参照版とCompute版が同じ物理Height範囲を使う
  // pebblesの粒は非負の高さとして扱い、基準面から上の範囲を返す
  static getHeightRangeMeters(specification, dimensions = null) {
    const spec = ProceduralTileSpec.validate(specification);
    const size = dimensions ?? ProceduralTileSpec.buildDimensions(spec);
    const jointDepth = size.jointPixels === 0 ? 0 : spec.joint.depthMeters;
    const noise = spec.surface.heightNoiseMeters;
    if (spec.pattern.mode === "pebbles") {
      const gravel = spec.pattern.pebbles;
      return [
        Math.max(jointDepth, noise) === 0 ? 0 : -Math.max(jointDepth, noise),
        noise + Math.max(spec.pattern.heightMeters, gravel.gravelAmount * gravel.gravelHeightMeters)
      ];
    }
    const offset = noise + spec.pattern.heightMeters;
    return [jointDepth === 0 && offset === 0 ? 0 : -jointDepth - offset, offset];
  }

  // UIやgeneratorが内部と同じrow offset周期判定を再利用するための公開入口を提供する
  // 公開methodも四種類の分数入力を検証し、module内関数と同じerror契約を保つ
  static getRowOffsetDenominator(rowOffsetRatio) {
    return getRowOffsetDenominator(rowOffsetRatio);
  }
}

export default ProceduralTileSpec;
export { PATTERN_MODES, PEBBLE_DEFAULTS, ProceduralTileSpec };
