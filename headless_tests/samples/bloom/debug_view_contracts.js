// ---------------------------------------------------------
// headless_tests/samples/bloom/headless_probe.js  2026/07/16
//   Legacy BloomPass intermediate preview contracts
// ---------------------------------------------------------
import assert from "node:assert/strict";
import BloomDebugFullscreenPass, {
  BLOOM_PREVIEW_VIEWS,
  resolveBloomDebugPreview
} from "../../../samples/bloom/BloomDebugFullscreenPass.js";

function makeTarget(name, { format = "bgra8unorm", width = 32, height = 16 } = {}) {
  return {
    name,
    getFormat: () => format,
    getWidth: () => width,
    getHeight: () => height,
    getView: () => ({ name: `${name}-view` }),
    getSampler: () => ({ name: `${name}-sampler` })
  };
}

// Paletteの各Viewを同名のBloomPass中間targetへ対応させ、表示倍率も段階ごとに固定します
{
  const targets = Object.fromEntries(BLOOM_PREVIEW_VIEWS.map((name) => [name, makeTarget(name)]));
  const bloom = {
    getSceneTarget: () => targets.scene,
    getExtractTarget: () => targets.extract,
    getExtractHeatTarget: () => targets.extractHeat,
    getBlurTargetA: () => targets.blurA,
    getBlurTargetB: () => targets.blurB
  };
  for (const view of BLOOM_PREVIEW_VIEWS) {
    assert.equal(resolveBloomDebugPreview(view, bloom).source, targets[view]);
  }
  assert.deepEqual(resolveBloomDebugPreview("scene", bloom).colorScale, [1, 1, 1, 1]);
  assert.deepEqual(resolveBloomDebugPreview("extract", bloom).colorScale, [6, 6, 6, 1]);
  assert.deepEqual(resolveBloomDebugPreview("blurB", bloom).colorScale, [8, 8, 8, 1]);
  assert.throws(() => resolveBloomDebugPreview("unknown", bloom), /unsupported Bloom preview view/);
  assert.throws(() => resolveBloomDebugPreview("scene", null), /requires BloomPass/);
}

// 派生passは既知のBloom色形式を維持しながら、canvasより小さいblur targetを受け入れます
{
  const pass = Object.create(BloomDebugFullscreenPass.prototype);
  pass.sourceFormat = "bgra8unorm";
  const halfResolution = makeTarget("blur", { width: 16, height: 8 });
  assert.equal(pass.validateSource(halfResolution), halfResolution);
  assert.throws(
    () => pass.validateSource(makeTarget("wrong", { format: "rgba16float" })),
    /source format must be bgra8unorm; received rgba16float/
  );
  assert.throws(
    () => pass.validateSource(makeTarget("empty", { width: 0 })),
    /source width must be >= 1/
  );
  assert.throws(
    () => pass.validateSource({}),
    /RenderTarget-compatible Bloom texture/
  );
}

console.log("sample_bloom_debug_view_contracts: all legacy Bloom preview contracts passed");
