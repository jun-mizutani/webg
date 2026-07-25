import assert from "node:assert/strict";
import Screen from "../../../webg/Screen.js";

const screen = Object.create(Screen.prototype);
screen.canvas = {
  width: 640,
  height: 360,
  clientWidth: 640,
  clientHeight: 360,
  style: {},
};
screen.fitToViewport = true;
screen.useDevicePixelRatio = false;
screen.viewportPadding = 0;
screen.gpu = { device: null };

screen.resize(320, 240);
assert.equal(screen.displayWidth, 320);
assert.equal(screen.displayHeight, 240);
assert.equal(screen.width, 320);
assert.equal(screen.height, 240);
assert.equal(screen.getAspect(), 4 / 3);
assert.equal(screen.getGPU(), screen.gpu);

assert.throws(
  () => screen.resize(0, 240),
  /width must be a positive finite number/,
);
assert.throws(
  () => screen.resize(320, Number.NaN),
  /height must be a positive finite number/,
);
assert.equal(Number.isFinite(screen.getRecommendedFov(55)), true);
assert.throws(
  () => screen.getRecommendedFov(0),
  /base must be in the range/,
);

console.log("PASS screen_resize_contracts");
