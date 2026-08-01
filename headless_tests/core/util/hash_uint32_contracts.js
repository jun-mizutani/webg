// ---------------------------------------------------------
// hash_uint32_contracts.js  2026/08/01
//   lowbias32 based integer hash contracts
// ---------------------------------------------------------
import assert from "node:assert/strict";
import util from "../../../webg/util.js";

// Chris Wellonsのlowbias32と同じ既知出力を固定し、定数やshiftの変更を検出する
const knownOutputs = [
  [0, 0],
  [1, 1753845952],
  [2, 3507691905],
  [3, 1408362973]
];
for (const [input, expected] of knownOutputs) {
  assert.equal(util.hashUint32(input), expected);
}

// 順序付き結合は同じ入力を再現し、座標の順番と列の長さを区別する
const coordinateHash = util.hashUint32Sequence([12, 34], 56);
assert.equal(util.hashUint32Sequence([12, 34], 56), coordinateHash);
assert.notEqual(util.hashUint32Sequence([34, 12], 56), coordinateHash);
assert.notEqual(util.hashUint32Sequence([12, 34, 0], 56), coordinateHash);

// 上位24bit変換は両端を含む32bit入力でも必ず[0, 1)へ収める
assert.equal(util.uint32ToUnitFloat(0), 0);
assert.equal(util.uint32ToUnitFloat(0xffffffff), 16777215 / 16777216);
for (const value of knownOutputs.map(([, output]) => output)) {
  const unit = util.uint32ToUnitFloat(value);
  assert.ok(unit >= 0 && unit < 1);
}

// 不正値を32bitへ丸めず、その場で入力間違いとして通知する
assert.throws(() => util.hashUint32(-1), /hashUint32 value must be >= 0/);
assert.throws(() => util.hashUint32(1.5), /hashUint32 value must be an integer/);
assert.throws(() => util.hashUint32(0x100000000), /hashUint32 value must be <= 4294967295/);
assert.throws(() => util.hashUint32Sequence([], 0), /must not be empty/);
assert.throws(() => util.hashUint32Sequence([1, -1], 0), /values\[1\] must be >= 0/);
assert.throws(() => util.uint32ToUnitFloat(-1), /uint32ToUnitFloat value must be >= 0/);

console.log("PASS lowbias32 integer hash contracts");
