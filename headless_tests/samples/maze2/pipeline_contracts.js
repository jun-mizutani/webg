// ---------------------------------------------------------
// headless_tests/samples/maze2/headless_probe.js  2026/08/01
//   v2 integrated CameraFrame and effect contracts for maze2
// ---------------------------------------------------------
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// このtestはGPUを持たないNode.jsでも、sampleが旧APIへ戻っていないことを確認できるよう
// sourceと日英文書を文字列として読み、統合Pipelineの接続契約を検査する
function read(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const main = read("../../../samples/maze2/main.js");
const html = read("../../../samples/maze2/maze2.html");
const readmeJa = read("../../../samples/maze2/README.md");
const readmeEn = read("../../../samples/maze2/README.en.md");
const indexJa = read("../../../samples/maze2/index.html");
const indexEn = read("../../../samples/maze2/index.en.html");

// 指定された実行時の視点を開始位置とreset先の共通状態にする
{
  assert.match(main, /const INITIAL_POSITION_X = -4\.0959586292702035/);
  assert.match(main, /const INITIAL_POSITION_Z = 9\.691514516173461/);
  assert.match(main, /const INITIAL_BODY_YAW_DEG = -29\.91426226806605/);
  assert.match(
    main,
    /function buildInitialViewState\(\)[\s\S]+position:\s*\[INITIAL_POSITION_X,\s*0\.0,\s*INITIAL_POSITION_Z\],[\s\S]+bodyYaw:\s*INITIAL_BODY_YAW_DEG/
  );
  assert.match(
    main,
    /function resetView\(\)[\s\S]+eyeRig\.setPosition\(\.\.\.initialViewState\.position\);[\s\S]+initialViewState\.bodyYaw/
  );
}

// Camera Frame導入前のprojection再構築とeye由来view matrix生成をsampleへ残さない
{
  assert.doesNotMatch(main, /createViewMatrix|createGBufferProjectionParams/);
  assert.doesNotMatch(main, /GeometryBufferPass|DeferredLightingPass|ComputeSsrPass/);
  assert.match(main, /import ComputeEffectPipeline from "\.\.\/\.\.\/webg\/ComputeEffectPipeline\.js"/);
}

// WebgAppが確定した同一snapshotをG-buffer描画と後段Computeへ直接渡す
{
  assert.match(main, /pageRowsByPage:\s*\[4,\s*4,\s*4\]/);
  assert.match(
    main,
    /onBeforeDraw:\s*\(\{ cameraFrame \}\)[\s\S]+pipeline\.renderScene\(app\.space, cameraFrame, app\.clearColor/
  );
  assert.match(
    main,
    /onAfterDraw3d:\s*\(\{ cameraFrame \}\)[\s\S]+pipeline\.encode\(gpu\.commandEncoder,\s*\{\s*cameraFrame,/
  );
}

// sample所有のfirst-person位置をWebgAppのcamera effect入力へ同期してからframeを確定する
{
  assert.match(
    main,
    /function syncFirstPersonCameraTarget\(\)[\s\S]+app\.camera\.target\[0\] = position\[0\];[\s\S]+app\.camera\.target\[2\] = position\[2\];/
  );
  assert.match(
    main,
    /updateWalkMovement\(deltaSec\);[\s\S]{0,180}eyeRig\.update\(deltaSec\);[\s\S]{0,180}syncFirstPersonCameraTarget\(\);/
  );
}

// maze2は各天井灯直下のpoint Local Lightを主役とし、Directional Light、Shadow Map、SSAOを有効にしない
{
  assert.match(main, /maxLights:\s*MAX_ACTIVE_LIGHTS/);
  assert.doesNotMatch(main, /type:\s*"cone"/);
  assert.match(main, /type:\s*"point"/);
  assert.match(main, /const position = \[cellCenterX\(col\),\s*3\.70,\s*cellCenterZ\(row\)\]/);
  assert.match(main, /radius:\s*7\.2/);
  assert.match(main, /intensity:\s*5\.2/);
  assert.doesNotMatch(main, /FIXTURE_REFLECTION_LIGHT|LIGHTS_PER_FIXTURE|logicalLightPairs/);
  assert.match(main, /\.slice\(0,\s*MAX_ACTIVE_LIGHTS\)[\s\S]{0,100}\.map\(\(entry\) => entry\.light\)/);
  assert.match(main, /lights:\s*activeLights,\s*lightCount:\s*activeLights\.length/);
  assert.match(main, /shadowEnabled:\s*false/);
  assert.match(main, /ssaoEnabled:\s*false/);
  assert.match(main, /directionalIntensity:\s*0\.0/);
}

// 白系の壁と天井はglobal ambientと低めのmetallicで基礎輝度を確保する
{
  assert.match(main, /const DEFERRED_AMBIENT = 0\.11/);
  assert.match(main, /ceiling:[^\n]+material\(CEILING_COLOR, 0\.55, 0\.28\)/);
  assert.match(main, /walls:[^\n]+material\(WALL_COLOR, 0\.42, 0\.28\)/);
  assert.match(main, /lowerRails:[^\n]+material\(RAIL_COLOR, 0\.20, 0\.32\)/);
  assert.match(main, /upperRails:[^\n]+material\(UPPER_RAIL_COLOR, 0\.16, 0\.36\)/);
  assert.match(main, /lighting:\s*\{\s*ambient:\s*DEFERRED_AMBIENT,/);
}

// 床は白系と鮮やかなarea accentを使い、低metallic・低SSR reflectivityの塗装面にする
{
  assert.match(main, /corridor:\s*\[0\.68,\s*0\.73,\s*0\.80,\s*0\.28\]/);
  assert.match(main, /room:\s*\[0\.82,\s*0\.76,\s*0\.66,\s*0\.28\]/);
  assert.match(main, /start:\s*\[0\.04,\s*0\.72,\s*0\.48,\s*0\.22\]/);
  assert.match(main, /goal:\s*\[0\.96,\s*0\.24,\s*0\.04,\s*0\.22\]/);
  assert.match(main, /junction:\s*\[0\.04,\s*0\.48,\s*0\.88,\s*0\.24\]/);
  assert.match(main, /const floorMaterial[\s\S]{0,260}specular:\s*0\.48,[\s\S]{0,120}metallic:\s*0\.08/);
  assert.match(main, /corridorFloor:[^\n]+floorMaterial\(FLOOR_COLORS\.corridor, 0\.62\)/);
  assert.match(main, /junctionFloor:[^\n]+floorMaterial\(FLOOR_COLORS\.junction, 0\.54\)/);
}

// SSR既定値とgeometry edgeの視覚仕様をPipeline optionへ保持する
{
  assert.match(main, /ssrSteps:\s*48/);
  assert.match(main, /ssrScale:\s*0\.70/);
  assert.match(main, /reflectivityThreshold:\s*0\.05/);
  assert.match(main, /edgeGeometryEnabled:\s*true/);
  assert.match(main, /blendMode:\s*"black-multiply"/);
}

// G-bufferへ渡る全共通材質はsurface値を明示し、未定義値の自動補完へ依存しない
{
  assert.match(main, /emissive:\s*options\.emissive \?\? 0\.0/);
  assert.match(
    main,
    /const fixtureMaterial[\s\S]{0,260}specular:\s*0\.80,[\s\S]{0,120}roughness:\s*0\.10,[\s\S]{0,120}emissive:\s*0\.10/
  );
  assert.match(main, /specular:\s*0\.12,[\s\S]{0,120}emissive:\s*0\.0/);
}

// 天井灯の直方体を表示し、対応するLocal Lightの生成も維持する
{
  assert.match(main, /const FIXTURE_GEOMETRY_VISIBLE = true/);
  assert.match(
    main,
    /if \(FIXTURE_GEOMETRY_VISIBLE\) \{[\s\S]{0,240}fixtureBuilder\.addBox/
  );
  assert.match(main, /type:\s*"point"[\s\S]{0,160}radius:\s*7\.2[\s\S]{0,80}intensity:\s*5\.2/);
}

// 色付き照明panelも抽出できるPyramid Bloomを有効にする
{
  assert.match(main, /import\s*\{\s*COMPUTE_BLOOM_DEFAULTS\s*\}\s*from\s*"\.\.\/\.\.\/webg\/ComputeBloomPass\.js\?v=20260723_image_pyramid"/);
  assert.match(main, /bloomEnabled:\s*true/);
  assert.match(main, /bloomStrength:\s*1\.10/);
  assert.match(main, /bloomThreshold:\s*0\.60/);
  assert.match(main, /bloomSoftKnee:\s*0\.40/);
  assert.match(main, /bloomHalfWeight:\s*COMPUTE_BLOOM_DEFAULTS\.halfWeight/);
  assert.match(main, /bloomThirtySecondWeight:\s*0\.80/);
  assert.match(main, /bloomFilterRadius:\s*COMPUTE_BLOOM_DEFAULTS\.filterRadius/);
  assert.match(main, /bloomEnabled:\s*EFFECT_STATE\.bloomEnabled/);
  assert.match(main, /threshold:\s*EFFECT_STATE\.bloomThreshold/);
  assert.match(main, /halfWeight:\s*EFFECT_STATE\.bloomHalfWeight/);
  assert.match(main, /thirtySecondWeight:\s*EFFECT_STATE\.bloomThirtySecondWeight/);
  assert.match(main, /filterRadius:\s*EFFECT_STATE\.bloomFilterRadius/);
  assert.doesNotMatch(main, /smallThreshold|mediumThreshold|largeThreshold/);
  assert.doesNotMatch(main, /smallStrength|mediumStrength|largeStrength/);
  assert.doesNotMatch(main, /blurIterations/);
}

// CommandPaletteの3ページ目は効果の切替を1行目へまとめ、その下でBloomの数値を調整する
{
  assert.match(
    main,
    /type:\s*"toggle",\s*id:\s*"ssr"[\s\S]{0,180}type:\s*"toggle",\s*id:\s*"edge"[\s\S]{0,180}type:\s*"toggle",\s*id:\s*"bloom"[\s\S]{0,180}id:\s*"palette-next"[\s\S]{0,220}id:\s*"bloom-strength"[\s\S]{0,260}id:\s*"bloom-threshold"[\s\S]{0,260}id:\s*"bloom-soft-knee"/
  );
  assert.match(main, /id === "bloom"\) EFFECT_STATE\.bloomEnabled = value/);
  assert.match(main, /id === "bloom-strength"\) EFFECT_STATE\.bloomStrength = value/);
  assert.match(main, /id === "bloom-threshold"\) EFFECT_STATE\.bloomThreshold = value/);
  assert.match(main, /id === "bloom-soft-knee"\) EFFECT_STATE\.bloomSoftKnee = value/);
}

// depthなし最終copyの後に、WebgAppのHUD用Camera Reverse-Z depth passを開き直す
{
  assert.match(
    main,
    /screen\.beginPresentPass\([\s\S]+copyPass\.draw\(finalColor\);[\s\S]+screen\.clearDepthBuffer\(\);/
  );
  assert.doesNotMatch(main, /screen\.beginPass\(\{[\s\S]{0,180}depthView:\s*null/);
  assert.match(html, /main\.js\?v=20260801_mt19937_initial_view/);
}

// READMEとHTML版は日英で同じPipeline、Camera Frame、無効化効果を説明する
{
  for (const document of [readmeJa, indexJa]) {
    assert.match(document, /ComputeEffectPipeline/);
    assert.match(document, /CameraFrame/);
    assert.match(document, /point Local Light/);
    assert.match(document, /Shadow MapとSSAOの効果は無効/);
  }
  for (const document of [readmeEn, indexEn]) {
    assert.match(document, /ComputeEffectPipeline/);
    assert.match(document, /CameraFrame/);
    assert.match(document, /point Local Light/);
    assert.match(document, /Shadow Map and SSAO effects remain disabled/);
  }
}

console.log("sample_maze2_pipeline_contracts: all integrated sample contracts passed");
