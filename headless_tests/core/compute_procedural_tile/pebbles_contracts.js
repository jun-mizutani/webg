// 石粒の公開schema、周期、色と形状の独立性をCPU参照生成でも確認する。
import assert from "node:assert/strict";
import ProceduralMaterials from "../../../webg/ProceduralMaterials.js";
import ProceduralTileSpec from "../../../webg/ProceduralTileSpec.js";
import ComputeProceduralTile from "../../../webg/ComputeProceduralTile.js";
import { samplePebbleLayer } from "../../../webg/ProceduralPebblePattern.js";
import { ProceduralTiledSurface } from "../../../samples/procedural_texture/ProceduralTiledSurface.js";

const ids = ["stone.pebbles.gray", "stone.pebbles-gravel.gray", "stone.gravel.gray"];
for (const id of ids) {
  const definition = ProceduralMaterials.getPresetDefinition(id);
  assert.equal(definition.tile.pattern.mode, "pebbles");
  assert.equal(definition.category, "stone");
  assert.equal(definition.tile.joint.widthMeters, 0);
  assert.equal(definition.tile.pattern.pebbles.roundness, 1);
}

const spec = ProceduralMaterials.resolve(ids[0], { resolution: { pixelsPerMeter: 50 } });
const dimensions = ProceduralTileSpec.buildDimensions(spec);
const generate = (pattern) => new ProceduralTiledSurface({
  ...spec, pattern: { ...spec.pattern, ...pattern }
}).generate();
// 追加sectionを省略したraw specでもGPU parameterは公開省略値を使う。
const rawDefault = { ...spec, pattern: { ...spec.pattern } };
delete rawDefault.pattern.pebbles;
assert.deepEqual(
  ComputeProceduralTile.prototype.createParameterWords(rawDefault, dimensions).words,
  ComputeProceduralTile.prototype.createParameterWords(ProceduralTileSpec.validate(rawDefault), dimensions).words
);

const original = generate({});
const uniformColor = generate({ colorAmount: 0 });
assert.deepEqual(original.heightPixels, uniformColor.heightPixels, "color contrast must not alter Height");
assert.notDeepEqual(original.colorPixels, uniformColor.colorPixels, "color contrast changes Color");
const flatTops = generate({ pebbles: { ...spec.pattern.pebbles, roundness: 0 } });
assert.deepEqual(original.colorPixels, flatTops.colorPixels, "roundness must not alter Color");
assert.notDeepEqual(original.heightPixels, flatTops.heightPixels, "roundness changes Height");
const flat = generate({ heightMeters: 0 });
assert.ok(flat.heightPixels.every((byte, i) => byte === (i % 4 === 3 ? 255 : 128)));
assert.deepEqual(original.colorPixels, flat.colorPixels, "height amplitude must not alter Color");

// 任意の連続座標で一周期ずらし、端で別の粒へ切り替わらないことを確認する。
for (const [x, y] of [[0.17, 23.4], [-0.2, 51.1], [98.7, 0.4]]) {
  const sample = (u, v) => samplePebbleLayer(u, v, dimensions, spec.random.seed,
    spec.pattern.scaleMeters, 1, 1, 0x50454242, 1, 1);
  const a = sample(x, y);
  const b = sample(x+dimensions.width, y-dimensions.height);
  a.forEach((value, i) => assert.ok(Math.abs(value-b[i]) < 1e-12));
}

// 粒の縁のblendを除いた内部にも中間色があり、明暗の二群だけにならない。
let middleTones = 0;
let darkTones = 0;
let lightTones = 0;
for (let y = 0; y < dimensions.height; y++) {
  for (let x = 0; x < dimensions.width; x++) {
    const [tone, , coverage] = samplePebbleLayer(x, y, dimensions, spec.random.seed,
      spec.pattern.scaleMeters, 1, 1, 0x50454242, 1, 1);
    if (coverage !== 1) continue;
    if (Math.abs(tone) < 0.25) middleTones++;
    if (tone < -0.6) darkTones++;
    if (tone > 0.6) lightTones++;
  }
}
assert.ok(middleTones > 100, "grain interiors must include middle tones");
assert.ok(darkTones > 100 && lightTones > 100, "grain interiors retain dark and light tones");

for (const invalid of [{ density: -1 }, { packing: 2 }, { irregularity: 2 }, { roundness: 2 }, { gravelAmount: NaN },
  { gravelScaleMeters: 0 }, { gravelHeightMeters: -1 }, { gravelColorAmount: 0.3 },
  { roundnes: 1 }, { roundness: null }]) {
  assert.throws(() => ProceduralTileSpec.validate({
    ...spec, pattern: { ...spec.pattern, pebbles: invalid }
  }));
}
assert.throws(() => ProceduralTileSpec.validate({ ...spec, pattern: { ...spec.pattern, pebbles: null } }));
assert.throws(() => ProceduralTileSpec.validate({ ...spec, pattern: { ...spec.pattern, mode: "terrazzo" } }), /requires/);

// 二層の最大値でHeight範囲を決め、砂利を石より高くした設定もclipしない。
const tallGravel = { ...spec, pattern: { ...spec.pattern, pebbles: {
  ...spec.pattern.pebbles, gravelAmount: 1, gravelHeightMeters: 0.08
} } };
assert.deepEqual(ProceduralTileSpec.getHeightRangeMeters(tallGravel), [0, 0.08]);
const parameter = ComputeProceduralTile.prototype.createParameterWords(tallGravel, dimensions);
assert.deepEqual(parameter.heightRangeMeters, [0, 0.08]);
assert.equal(parameter.words.length, 56);
console.log("pebbles_contracts: schema, independent Color/Height, periodicity and bounds PASS");
