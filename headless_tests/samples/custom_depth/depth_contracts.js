// ---------------------------------------------------------
// headless_tests/samples/custom_depth/headless_probe.js  2026/07/13
//   Independent sample render pipeline Reverse-Z contracts
// ---------------------------------------------------------
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const sampleSources = [
  read("../../../samples/compute_cloth/main.js"),
  read("../../../samples/compute_physics_bounce/main.js"),
  read("../../../samples/compute_texture/main.js")
];

// 独自RenderPipelineでも通常カメラdepthのformat、compare、clearを個別定数へ複製しません
for (const source of sampleSources) {
  assert.match(source, /import \{ CAMERA_REVERSE_Z \} from "\.\.\/\.\.\/webg\/DepthConvention\.js"/);
  assert.doesNotMatch(source, /depth24plus/);
  assert.doesNotMatch(source, /depthCompare:\s*["']less["']/);
  assert.doesNotMatch(source, /depthClearValue:\s*1(?:\.0)?\b/);
  assert.match(source, /format:\s*CAMERA_REVERSE_Z\.format/);
  assert.match(source, /depthClearValue:\s*CAMERA_REVERSE_Z\.clearValue/);
}

// preview overlayはdepthを無視する正式なalways比較であり、通常Zのlessを残したものではありません
assert.match(sampleSources[2], /depthCompare:\s*["']always["']/);

console.log("sample_custom_depth_contracts: all independent sample depth contracts passed");
