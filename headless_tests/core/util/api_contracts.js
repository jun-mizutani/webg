import assert from "node:assert/strict";
import util from "../../../webg/util.js";

assert.equal(util.strDup("ab", 3), "ababab");
assert.equal(util.sprintf("%04d", 12), "0012");
assert.equal(util.sprintf("%-5s", "x"), "x    ");
assert.equal(util.readFiniteNumber(2.5, "value", { min: 0, max: 3 }), 2.5);
assert.throws(() => util.readFiniteNumber(Number.NaN, "value"), /must be finite/);
assert.throws(() => util.readFiniteNumber(-1, "value", { min: 0 }), /must be >= 0/);
assert.equal(util.readOptionalBoolean(undefined, "flag", true), true);
assert.equal(util.readOptionalEnum("B", "mode", "a", ["a", "b"], { lowerCase: true }), "b");
assert.deepEqual(util.readVec3([1, 2, 3], "position"), [1, 2, 3]);
assert.throws(() => util.readVec3([1, 2], "position"), /vec3 array/);
const source = [0.1, 0.2, 0.3, 0.4];
const color = util.readColor(source, "color");
assert.deepEqual(color, source);
assert.notEqual(color, source);

console.log("PASS util_api_contracts");
