import assert from "node:assert/strict";
import {
  DEFAULT_MAX_SKIN_BONES,
  SKIN_MATRIX_FLOATS_PER_BONE,
  SKIN_MATRIX_VECTORS_PER_BONE,
  alignTo,
} from "../../../webg/SkinningConfig.js";

assert.equal(DEFAULT_MAX_SKIN_BONES, 320);
assert.equal(SKIN_MATRIX_VECTORS_PER_BONE, 3);
assert.equal(SKIN_MATRIX_FLOATS_PER_BONE, 12);
assert.equal(alignTo(0), 0);
assert.equal(alignTo(1), 256);
assert.equal(alignTo(256), 256);
assert.equal(alignTo(257), 512);
assert.equal(alignTo(17, 16), 32);

console.log("PASS skinning_config_api_contracts");
