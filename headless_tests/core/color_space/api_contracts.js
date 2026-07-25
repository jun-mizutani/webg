import assert from "node:assert/strict";
import {
  COLOR_SPACE_WGSL,
  SRGB_REFERENCE_GAMMA,
  linearChannelToSrgb,
  srgbChannelToLinear,
  srgbColorToLinear,
} from "../../../webg/ColorSpace.js";

const closeTo = (actual, expected, tolerance = 1.0e-12) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
};

assert.equal(SRGB_REFERENCE_GAMMA, 2.2);
closeTo(srgbChannelToLinear(0.04045), 0.04045 / 12.92);
closeTo(linearChannelToSrgb(0.0031308), 0.0031308 * 12.92);
for (const channel of [0.0, 0.02, 0.18, 0.5, 1.0]) {
  closeTo(linearChannelToSrgb(srgbChannelToLinear(channel)), channel, 1.0e-10);
}
const color = srgbColorToLinear([0.5, 0.25, 1.0, 0.4]);
closeTo(color[0], srgbChannelToLinear(0.5));
assert.equal(color[3], 0.4);
assert.throws(() => srgbChannelToLinear(-0.01), /must be >= 0/);
assert.throws(() => linearChannelToSrgb(1.01), /must be <= 1/);
assert.match(COLOR_SPACE_WGSL, /fn srgbToLinearChannel/);
assert.match(COLOR_SPACE_WGSL, /fn linearToSrgbChannel/);

console.log("PASS color_space_api_contracts");
