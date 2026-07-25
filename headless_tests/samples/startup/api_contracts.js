// ---------------------------------------------------------
// headless_tests/samples/startup/headless_probe.js  2026/07/21
//   v2 sample module, frame, material, and presentation contracts
// ---------------------------------------------------------
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const pipelineSamples = [
  "compute_bloom",
  "compute_deferred_lighting",
  "compute_dof",
  "compute_json",
  "compute_shadow_map",
  "compute_ssao_gbuffer",
  "compute_ssr",
  "maze"
].map((name) => ({ name, source: read(`../../../samples/${name}/main.js`) }));

const benchmark = read("../../../samples/compute_benchmark/main.js");
const shadowMap = pipelineSamples.find(({ name }) => name === "compute_shadow_map").source;
const computeDof = pipelineSamples.find(({ name }) => name === "compute_dof").source;
const computeSsaoGbuffer = pipelineSamples.find(({ name }) => name === "compute_ssao_gbuffer").source;

for (const { name, source } of pipelineSamples) {
  assert.match(source, /ComputeEffectPipeline/, `${name} must use the integrated v2 pipeline`);
  assert.match(source, /onBeforeDraw:\s*\(\{ cameraFrame \}\)/, `${name} must receive CameraFrame before draw`);
  assert.match(source, /onAfterDraw3d:\s*\(\{ cameraFrame \}\)/, `${name} must reuse CameraFrame after draw`);
  assert.match(source, /cameraFrame,/, `${name} must pass CameraFrame explicitly`);
  assert.match(source, /beginPresentPass\(/, `${name} must open the v2 presentation pass`);
  assert.match(source, /clearDepthBuffer\(\)/, `${name} must restore the HUD depth pass`);
}

const allMigratedSources = [
  ...pipelineSamples.map((entry) => entry.source),
  benchmark,
  read("../../../samples/axis/main.js"),
  read("../../../samples/dof/main.js"),
  read("../../../samples/compute_ssao/main.js")
];
const combined = allMigratedSources.join("\n");

// benchmarkは照明入力を変えず、同じ露出をpreviewと全Tone Map測定経路へ適用します
assert.match(benchmark, /const BENCHMARK_TONE_MAP_EXPOSURE = 2\.0;/);
assert.equal(
  (benchmark.match(/exposure: BENCHMARK_TONE_MAP_EXPOSURE/g) ?? []).length,
  4
);
assert.match(benchmark, /toneMapExposure: BENCHMARK_TONE_MAP_EXPOSURE/);
assert.match(benchmark, /base: prepared\.shadowed/);
assert.doesNotMatch(benchmark, /base: prepared\.ssao/);

// 単独blurは全解像度の反復blurではなく、連続Pyramidの縮小と段階的拡大を測ります
assert.match(benchmark, /import ComputePyramidBlurPass/);
assert.match(benchmark, /new ComputePyramidBlurPass/);
assert.match(benchmark, /levels: COMPUTE_PYRAMID_BLUR_LEVELS/);
assert.match(benchmark, /filterRadius: options\.pyramidFilterRadius/);
assert.match(benchmark, /pyramidLevels: \[\.\.\.COMPUTE_PYRAMID_BLUR_LEVELS\]/);
assert.doesNotMatch(benchmark, /ComputeBlurPass|blurIterations|blurRadius/);

// 現行pipelineの透明合成、Fog、Vignetteを空入力にせず、個別と通しの両方で測ります
assert.match(benchmark, /alpha: options\.alpha \?\? 1\.0/);
for (const caseName of ["transparency", "fog", "vignette"]) {
  assert.match(benchmark, new RegExp(`name: "${caseName}"`));
}
assert.match(benchmark, /scene: prepared\.transparent/);
assert.match(benchmark, /scene: prepared\.fogged/);
assert.match(benchmark, /prepared\.edged/);
assert.match(benchmark, /fogEnabled: true/);
assert.match(benchmark, /vignetteEnabled: true/);
assert.match(benchmark, /fog: BENCHMARK_FOG_OPTIONS/);
assert.match(benchmark, /vignette: BENCHMARK_VIGNETTE_OPTIONS/);

// 削除済みAPI、旧完成色mode、通常カメラdepthの旧値をsampleへ戻した場合は停止します
for (const pattern of [
  /depth24plus/,
  /createViewMatrix/,
  /gbufferColorMode/,
  /setProjectionRange/,
  /pipeline\.sceneTarget/,
  /projectionNear:\s*app\.projectionNear/,
  /projectionFar:\s*app\.projectionFar/,
  /cameraWorld:\s*app\.eye/
]) {
  assert.doesNotMatch(combined, pattern);
}

// Compute DoFは統合pipeline自身が全targetをresizeし、削除済みsceneTargetを参照しません
assert.doesNotMatch(computeDof, /resizeTarget\s*\(\s*sceneTarget\b/);

// addObject()を通らないnormal-map cubeとskinned cylinderも完全なv2 surface materialを持ちます
assert.match(
  computeSsaoGbuffer,
  /texturedShape\.setMaterial\([^;]*roughness:[^;]*metallic:[^;]*emissive:/s
);
assert.match(
  computeSsaoGbuffer,
  /function createSkinnedCylinder.*?shape\.setMaterial\([^;]*roughness:[^;]*metallic:[^;]*emissive:/s
);

// render-pass版DoFはCameraFrameをsampleへ露出せず、同じrenderFrameTokenを明示します
for (const name of ["axis", "dof"]) {
  const source = read(`../../../samples/${name}/main.js`);
  assert.match(source, /onBeforeDraw:\s*\(\{ renderFrameToken \}\)/);
  assert.match(source, /onAfterDraw3d:\s*\(\{ renderFrameToken \}\)/);
  assert.match(source, /beginScene\([^;]*\brenderFrameToken[, }]/s);
  assert.match(source, /\.render\([^;]*\brenderFrameToken,/s);
  assert.match(source, /app\.space\.draw\(renderFrameToken\)/);
  assert.doesNotMatch(source, /\(\{ view \}\)|\{ view \}/);
  assert.doesNotMatch(source, /\bcameraFrame\b/);
}

// sample独自SSAOは共通Reverse-Z WGSLとCamera Frame projection parameterを使います
const ssao = read("../../../samples/compute_ssao/main.js");
assert.match(ssao, /GBUFFER_WGSL_COMMON/);
assert.match(ssao, /isGBufferBackgroundDepth\(centerDepth\)/);
assert.match(ssao, /createGBufferProjectionParams\(cameraFrame\)/);
assert.doesNotMatch(ssao, /0\.999999/);

// ondemand benchmarkはWebgApp callback外で測定するため、測定開始ごとにCamera Frameを明示生成します
assert.match(benchmark, /app\.updateCameraFrame\(\)/);
assert.match(benchmark, /pipeline\.renderScene\(app\.space, cameraFrame/);
assert.match(benchmark, /pipeline\.encode\([^;]*cameraFrame/s);
assert.match(benchmark, /beginPresentPass\(/);

// 初回Help Panelもpipelineが生成した実lightを参照し、削除済みの局所変数名を残しません
assert.match(shadowMap, /activeLight:\s*pipeline\.currentShadowLight/);
assert.doesNotMatch(shadowMap, /\bfixedLight\b/);

console.log("sample_startup_api_contracts: all migrated sample contracts passed");
