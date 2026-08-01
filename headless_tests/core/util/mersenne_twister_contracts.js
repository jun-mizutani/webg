import assert from "node:assert/strict";
import util from "../../../webg/util.js";

// mt19937ar.outと同じ標準seed 5489の先頭10個を照合し、
// JavaScript移植で32bit unsigned演算が変化していないことを固定する
const singleSeedExpected = [
  3499211612, 581869302, 3890346734, 3586334585, 545404204,
  4161255391, 3922919429, 949333985, 2715962298, 1323567403
];
const singleSeedGenerator = new util.MersenneTwister(5489);
assert.deepEqual(
  singleSeedExpected.map(() => singleSeedGenerator.genrandInt32()),
  singleSeedExpected
);

// mt19937ar.cのmain()が使う4語seed配列の先頭10個を照合し、
// init_by_array()に対応する初期化loopとwrap位置を検証する
const arraySeedExpected = [
  1067595299, 955945823, 477289528, 4107218783, 4228976476,
  3344332714, 3355579695, 227628506, 810200273, 2591290167
];
const arraySeedGenerator = new util.MersenneTwister([
  0x123, 0x234, 0x345, 0x456
]);
assert.deepEqual(
  arraySeedExpected.map(() => arraySeedGenerator.genrandInt32()),
  arraySeedExpected
);

// nextUint32()はC互換名と同じ列を返し、用途ごとに別の乱数列を作らない
const cNameGenerator = new util.MersenneTwister(20260801);
const jsNameGenerator = new util.MersenneTwister(20260801);
for (let index = 0; index < 700; index += 1) {
  assert.equal(jsNameGenerator.nextUint32(), cNameGenerator.genrandInt32());
}

// random()はgenrand_real2()と同じ[0,1)規約にし、random functionを受ける既存APIへ渡せる
const randomGenerator = new util.MersenneTwister(73);
const real2Generator = new util.MersenneTwister(73);
for (let index = 0; index < 1000; index += 1) {
  const randomValue = randomGenerator.random();
  assert.equal(randomValue, real2Generator.genrandReal2());
  assert.ok(randomValue >= 0.0 && randomValue < 1.0);
}

// 53bit版も半開区間を維持し、2回のuint32出力を使った値が範囲外へ出ない
const real53Generator = new util.MersenneTwister(91);
for (let index = 0; index < 1000; index += 1) {
  const value = real53Generator.genrandRes53();
  assert.ok(value >= 0.0 && value < 1.0);
}

// C版が許すseed 0を受け入れる一方、32bit外、小数、空配列は暗黙変換せず停止する
assert.equal(new util.MersenneTwister(0).genrandInt32(), 2357136044);
assert.throws(
  () => new util.MersenneTwister(-1),
  /MersenneTwister seed must be >= 0/
);
assert.throws(
  () => new util.MersenneTwister(0x100000000),
  /MersenneTwister seed must be <= 4294967295/
);
assert.throws(
  () => new util.MersenneTwister(1.5),
  /MersenneTwister seed must be an integer/
);
assert.throws(
  () => new util.MersenneTwister([]),
  /seed array must not be empty/
);
assert.throws(
  () => new util.MersenneTwister([1, -2]),
  /seed array\[1\] must be >= 0/
);

console.log("PASS util_mersenne_twister_contracts");
