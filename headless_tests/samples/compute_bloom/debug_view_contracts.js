// ---------------------------------------------------------
// headless_tests/samples/compute_bloom/debug_view_contracts.js  2026/07/23
//   Compute Bloom Pyramid debug-view presentation contract
// ---------------------------------------------------------
import assert from "node:assert/strict";
import BloomDebugViewPass, {
  BLOOM_DEBUG_OUTPUT_FORMAT,
  BLOOM_DEBUG_VIEW_NAMES,
  BLOOM_DEBUG_VIEW_WGSL,
  getBloomDebugSource,
  isBloomDebugView
} from "../../../samples/compute_bloom/BloomDebugViewPass.js";

// Paletteの段階別Viewを、同名のComputeBloomPass中間targetへ一対一で接続します
{
  const calls = [];
  const bloomPass = {
    getExtractTarget() { calls.push("extract"); return "extract-target"; },
    getHalfTarget() { calls.push("half"); return "half-target"; },
    getQuarterTarget() { calls.push("quarter"); return "quarter-target"; },
    getEighthTarget() { calls.push("eighth"); return "eighth-target"; },
    getSixteenthTarget() { calls.push("sixteenth"); return "sixteenth-target"; },
    getThirtySecondTarget() {
      calls.push("thirty-second");
      return "thirty-second-target";
    },
    getBlurTarget() { calls.push("blur"); return "blur-target"; }
  };

  assert.deepEqual(BLOOM_DEBUG_VIEW_NAMES, [
    "extract",
    "half",
    "quarter",
    "eighth",
    "sixteenth",
    "thirty-second",
    "blur"
  ]);
  for (const viewName of BLOOM_DEBUG_VIEW_NAMES) {
    assert.equal(isBloomDebugView(viewName), true);
    assert.equal(getBloomDebugSource(viewName, bloomPass), `${viewName}-target`);
  }
  assert.deepEqual(calls, BLOOM_DEBUG_VIEW_NAMES);
  assert.equal(isBloomDebugView("scene"), false);
  assert.equal(isBloomDebugView("composite"), false);
  assert.throws(() => isBloomDebugView("unknown"), /unsupported Bloom view/);
  assert.throws(() => getBloomDebugSource("composite", bloomPass), /unsupported Bloom debug view/);
  assert.throws(() => getBloomDebugSource("half", null), /requires ComputeBloomPass/);
}

// HDR中間値は画面解像度へ線形補間し、ReinhardとsRGB変換後だけrgba8unormへ保存します
{
  assert.equal(BLOOM_DEBUG_OUTPUT_FORMAT, "rgba8unorm");
  assert.match(BLOOM_DEBUG_VIEW_WGSL, /textureSampleLevel\(sourceTexture, sourceSampler, uv, 0\.0\)/);
  assert.match(BLOOM_DEBUG_VIEW_WGSL, /mapped = hdr \/ \(hdr \+ vec3f\(1\.0\)\)/);
  assert.match(BLOOM_DEBUG_VIEW_WGSL, /linearToSrgb\(mapped\)/);
  assert.match(BLOOM_DEBUG_VIEW_WGSL, /texture_storage_2d<rgba8unorm, write>/);
  assert.doesNotMatch(BLOOM_DEBUG_VIEW_WGSL, /texture_storage_2d<rgba16float, write>/);
}

// 表示passはBloomのrgba16floatだけを受け付け、未準備ViewやSamplerを補完しません
{
  const pass = Object.create(BloomDebugViewPass.prototype);
  pass.label = "probe";
  const validSource = {
    getView: () => ({ label: "view" }),
    getFormat: () => "rgba16float",
    getSampler: () => ({ label: "sampler" })
  };
  assert.equal(pass.validateSource(validSource), validSource);
  assert.throws(
    () => pass.validateSource({ ...validSource, getFormat: () => "rgba8unorm" }),
    /source format must be rgba16float/
  );
  assert.throws(
    () => pass.validateSource({ ...validSource, getView: () => null }),
    /source view is not ready/
  );
  assert.throws(
    () => pass.validateSource({ ...validSource, getSampler: () => null }),
    /source sampler is not ready/
  );
}

console.log("sample_compute_bloom_debug_view_contracts: all Pyramid debug-view contracts passed");
