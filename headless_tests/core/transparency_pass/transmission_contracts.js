// ---------------------------------------------------------
// transmission_contracts.js  2026/08/13
//   Two-surface screen-space transmission ray contracts
// ---------------------------------------------------------
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import TransparencyPass, {
  TRANSMISSION_DEFAULTS
} from "../../../webg/TransparencyPass.js";

const transparencySource = readFileSync(
  new URL("../../../webg/TransparencyPass.js", import.meta.url),
  "utf8"
);
const smoothSource = readFileSync(
  new URL("../../../webg/SmoothShader.js", import.meta.url),
  "utf8"
);
const pbrForwardSource = readFileSync(
  new URL("../../../webg/PbrForwardShader.js", import.meta.url),
  "utf8"
);
const pipelineSource = readFileSync(
  new URL("../../../webg/ComputeEffectPipeline.js", import.meta.url),
  "utf8"
);
const translucentQueueSource = readFileSync(
  new URL("../../../webg/TranslucentRenderQueue.js", import.meta.url),
  "utf8"
);
const profilerSource = readFileSync(
  new URL("../../../webg/GpuPassProfiler.js", import.meta.url),
  "utf8"
);

// GPU生成なしで公開fallback入力を検証し、modeと固定色の組合せを暗黙補正しない
const transmissionValidator = Object.create(TransparencyPass.prototype);
transmissionValidator.label = "transmission-test";
assert.equal(
  transmissionValidator.validateTransmissionOptions({}).rayMissFallback,
  TRANSMISSION_DEFAULTS.rayMissFallback
);
assert.equal(
  transmissionValidator.validateTransmissionOptions({
    rayMissFallback: "environment"
  }).rayMissFallback,
  "environment"
);
const constantFallback = transmissionValidator.validateTransmissionOptions({
  rayMissFallback: "constant",
  rayMissColor: [0.04045, 0.5, 1.0, 1.0]
});
assert.equal(constantFallback.rayMissFallback, "constant");
assert.ok(Math.abs(constantFallback.rayMissColor[0] - 0.0031308) < 1.0e-7);
assert.ok(Math.abs(constantFallback.rayMissColor[1] - 0.21404114) < 1.0e-7);
assert.deepEqual(constantFallback.rayMissColor.slice(2), [1.0, 1.0]);
assert.throws(
  () => transmissionValidator.validateTransmissionOptions({
    rayMissFallback: "constant"
  }),
  /requires rayMissColor/
);
assert.throws(
  () => transmissionValidator.validateTransmissionOptions({
    rayMissFallback: "clear",
    rayMissColor: [0.0, 0.0, 0.0, 1.0]
  }),
  /rayMissColor requires rayMissFallback "constant"/
);

// Entry／exit法線をoctahedral encodeし、二つのtargetから完全なview-space法線を復元できる
assert.match(smoothSource, /this\.transmissionMask = options\.transmissionMask === true/);
assert.match(smoothSource, /this\.transmissionExit = options\.transmissionExit === true/);
assert.match(smoothSource, /this\.transmissionVolumeMask = options\.transmissionVolumeMask === true/);
assert.match(smoothSource, /special output variants cannot be enabled together/);
assert.match(smoothSource, /fn encodeOctNormal\(value : vec3<f32>\) -> vec2<f32>/);
assert.match(smoothSource, /return p \* 0\.5 \+ vec2<f32>\(0\.5\)/);
assert.match(smoothSource, /encodeOctNormal\(transmissionNormal\)/);
assert.match(smoothSource, /let exitNormal = normalize\(input\.vNormal\)/);
assert.match(smoothSource, /encodeOctNormal\(exitNormal\)/);
assert.match(smoothSource, /transmissionParams : vec4<f32>/);
assert.match(smoothSource, /let transmissionStrength = clamp\(u\.transmissionParams\.x/);
assert.match(smoothSource, /max\(-input\.vPosition\.z, 0\.0\)/);
assert.match(smoothSource, /max\(u\.transmissionParams\.y, 1\.0\)/);
assert.match(smoothSource, /this\.transmissionMask \|\| this\.transmissionExit/);
assert.match(smoothSource, /textureSampleLevel\(myNormalTexture/);
assert.match(smoothSource, /volumeParams : vec4<f32>/);
assert.match(smoothSource, /旧screen-space近似とのAPI互換用/);

// Compositeはentry屈折、front／back境界探索、最大1回の内部reflection、背景rayの順に追跡する
assert.match(transparencySource, /export const TRANSMISSION_DEFAULTS/);
assert.match(transparencySource, /distance: 42\.0/);
assert.match(transparencySource, /hitThickness: 0\.1/);
assert.match(transparencySource, /steps: 48/);
assert.match(transparencySource, /rayMissFallback: "auto"/);
assert.match(transparencySource, /export const TRANSMISSION_COMPOSITE_WGSL/);
assert.match(transparencySource, /debug : vec4f/);
assert.match(transparencySource, /RAY_DEBUG_EXIT_MISS/);
assert.match(transparencySource, /RAY_DEBUG_TOTAL_INTERNAL_REFLECTION/);
assert.match(transparencySource, /RAY_DEBUG_OUTSIDE_DISTANCE/);
assert.match(transparencySource, /RAY_DEBUG_BACKGROUND_MISS/);
assert.match(transparencySource, /fn rayFailureColor/);
assert.match(transparencySource, /fn rayFailureColorForDirection/);
assert.match(transparencySource, /fn sampleEnvironmentRadiance/);
assert.match(transparencySource, /params\.fallbackColor/);
assert.match(transparencySource, /sampleType: "unfilterable-float"/);
assert.match(transparencySource, /GBUFFER_WGSL_COMMON/);
assert.match(transparencySource, /fn reconstructLinearViewPosition/);
assert.match(transparencySource, /fn projectToUv/);
assert.match(transparencySource, /fn decodeOctNormal/);
assert.match(transparencySource, /let materialStrength = clamp\(mask\.b \* params\.effect\.x/);
assert.match(transparencySource, /let entryPosition = reconstructLinearViewPosition\(uv, entryDepth\)/);
assert.match(transparencySource, /let entryNormal = decodeOctNormal\(mask\.rg\)/);
assert.match(transparencySource, /refract\(incidentDirection, entryNormal, 1\.0 \/ materialIor\)/);
assert.match(transparencySource, /const RAY_MIN_BASE_STEP_COUNT : i32 = 12/);
assert.match(transparencySource, /const RAY_MAX_BASE_STEP_COUNT : i32 = 64/);
assert.match(transparencySource, /const RAY_MAX_COARSE_STEP_COUNT : i32 = 128/);
assert.match(transparencySource, /const RAY_BINARY_REFINEMENT_COUNT : i32 = 5/);
assert.match(transparencySource, /const INTERNAL_RAY_COARSE_PIXEL_STRIDE : f32 = 8\.0/);
assert.match(transparencySource, /const OUTSIDE_RAY_COARSE_PIXEL_STRIDE : f32 = 8\.0/);
assert.match(transparencySource, /const INTERNAL_SURFACE_FRONT : i32 = 0/);
assert.match(transparencySource, /const INTERNAL_SURFACE_BACK : i32 = 1/);
assert.match(transparencySource, /fn findNextInternalSurface/);
assert.match(transparencySource, /textureLoad\(transmissionMaskTexture, coord, 0\)/);
assert.match(transparencySource, /textureLoad\(transmissionExitTexture, coord, 0\)/);
assert.match(transparencySource, /previousFrontDelta > 0\.0 && currentFrontDelta <= 0\.0/);
assert.match(transparencySource, /previousBackDelta < 0\.0 && currentBackDelta >= 0\.0/);
assert.match(transparencySource, /majorLength \/ INTERNAL_RAY_COARSE_PIXEL_STRIDE/);
assert.match(transparencySource, /outsideMajorLength \/ OUTSIDE_RAY_COARSE_PIXEL_STRIDE/);
assert.match(transparencySource, /for \(var i = 0; i < RAY_MAX_COARSE_STEP_COUNT; i \+= 1\)/);
assert.match(transparencySource, /for \(var refine = 0; refine < RAY_BINARY_REFINEMENT_COUNT; refine \+= 1\)/);
assert.match(transparencySource, /candidateDelta >= 0\.0 && candidateDelta <= hitThickness/);
assert.match(transparencySource, /let firstBoundary = findNextInternalSurface/);
assert.match(transparencySource, /reflect\(boundaryIncidentDirection, exitNormal\)/);
assert.match(transparencySource, /let reflectedBoundary = findNextInternalSurface/);
assert.match(transparencySource, /opticalDistance \+= length\(reflectedBoundary\.position - exitPosition\)/);
assert.match(transparencySource, /outsideDirectionRaw = refract\(/);
assert.match(transparencySource, /textureLoad\(depthTexture, currentCoord, 0\)/);
assert.match(transparencySource, /linearizeGBufferDepth/);
assert.match(transparencySource, /var opticalDistance = length\(firstBoundary\.position - entryPosition\)/);
assert.match(transparencySource, /let transmittance = pow\(safeAttenuationColor/);
assert.match(transparencySource, /refracted\.rgb \* transmittance/);
assert.match(transparencySource, /textureStore\(outputTexture, pixel, absorbedRefraction\)/);
assert.doesNotMatch(
  transparencySource,
  /mix\(sceneColor, absorbedRefraction, materialStrength\)/
);
assert.match(transparencySource, /this\.shader\.setTransmissionPassScale/);
assert.match(transparencySource, /uniformFloats: 36/);
assert.match(transparencySource, /checked\.debugRayStatus/);
assert.match(transparencySource, /transmission\.debugRayStatus \? 1\.0 : 0\.0/);
assert.match(transparencySource, /\["auto", "environment", "clear", "constant"\]/);
assert.match(transparencySource, /rayMissFallback "constant" requires rayMissColor/);
assert.match(transparencySource, /rayMissColor requires rayMissFallback "constant"/);
assert.match(transparencySource, /srgbColorToLinear\(/);
assert.match(transparencySource, /rayMissFallback "environment"[\s\S]*requires environment\.radiance/);
assert.match(transparencySource, /checkedEnvironment !== null[\s\S]*checkedEnvironment\.radiance !== null/);
assert.match(transparencySource, /this\.emptyRadianceTexture\.destroy\(\)/);
assert.match(pbrForwardSource, /setTransmissionPassScale\(value\)/);
assert.match(
  pbrForwardSource,
  /u\.transmissionParams\.x \* u\.transmissionParams\.w/
);
assert.match(
  pbrForwardSource,
  /1\.0[\s\S]*- effectiveTransmission \* \(1\.0 - materialSurfaceAlpha\)/
);
assert.match(transparencySource, /checked\.distance \?\? TRANSMISSION_DEFAULTS\.distance/);
assert.match(transparencySource, /checked\.hitThickness \?\? TRANSMISSION_DEFAULTS\.hitThickness/);
assert.match(transparencySource, /checked\.steps \?\? TRANSMISSION_DEFAULTS\.steps/);
assert.match(transparencySource, /transmission\.distance,[\s\S]*transmission\.hitThickness,[\s\S]*transmission\.steps/);
assert.match(transparencySource, /this\.transmissionMaskTarget = new RenderTarget/);
assert.match(transparencySource, /this\.transmissionVolumeTarget = new RenderTarget/);
assert.match(transparencySource, /this\.transmissionExitTarget = new RenderTarget/);
assert.match(transparencySource, /this\.transmissionTarget = new RenderTarget/);
assert.match(transparencySource, /this\.transmissionCompositePass = new ComputePass/);
assert.match(transparencySource, /transmissionMask: true/);
assert.match(transparencySource, /transmissionVolumeMask: true/);
assert.match(transparencySource, /transmissionExit: true/);
assert.match(transparencySource, /space\.draw\(cameraFrame, \{[\s\S]*shaderOverride: this\.transmissionMaskShader/);
assert.match(
  transparencySource,
  /preparedTranslucentQueue\.owner\.drawPrepared\(preparedTranslucentQueue,[\s\S]*shaderOverride: this\.transmissionExitShader[\s\S]*translucent: false/
);
assert.match(
  transparencySource,
  /this\.frostPyramid\.encode\(commandEncoder, backgroundSource, \{[\s\S]*maxLevel: frostPyramidMaxLevel/
);

// 公開値はPipelineからTransparencyPass.encodeのresourceへ渡し、Deferred Lightingへ誤配線しない
assert.match(pipelineSource, /transmissionEnabled:\s*false/);
assert.match(pipelineSource, /transmissionRayMissFallback:\s*TRANSMISSION_DEFAULTS\.rayMissFallback/);
assert.match(pipelineSource, /transmissionRayMissColor:\s*null/);
assert.match(pipelineSource, /this\.currentClearColor = util\.readColor/);
assert.match(pipelineSource, /const transparency = mergeOptions\(this\.transparencyOptions, options\.transparency\)/);
assert.match(
  pipelineSource,
  /this\.transparencyPass\.encode\(commandEncoder, \{[\s\S]*clearColor: this\.currentClearColor[\s\S]*transmission: \{[\s\S]*enabled: transparency\.transmissionEnabled[\s\S]*strength: transparency\.transmissionStrength[\s\S]*distance: transparency\.transmissionDistance[\s\S]*hitThickness: transparency\.transmissionHitThickness[\s\S]*steps: transparency\.transmissionSteps[\s\S]*debugRayStatus: transparency\.transmissionRayDebugEnabled[\s\S]*rayMissFallback: transparency\.transmissionRayMissFallback[\s\S]*rayMissColor: transparency\.transmissionRayMissColor/
);
assert.doesNotMatch(pipelineSource, /transmissionMaxUvOffset/);

// Transmission maskでprepareした透明queueを最終PBR Forwardへ渡し、二回目の収集と転送を省く
assert.match(
  transparencySource,
  /preparedTranslucentQueue = space\.draw\(cameraFrame,[\s\S]*shaderOverride: this\.transmissionMaskShader/
);
assert.match(
  transparencySource,
  /shaderOverride: this\.shader,[\s\S]*preparedTranslucentQueue/
);
assert.match(translucentQueueSource, /prepareSortedQueue\(translucentQueue, options = \{\}\)/);
assert.match(translucentQueueSource, /drawPrepared\(preparedQueue, options/);

// 異常frameだけ、透明instanceの姿勢・分断・干渉pairと最新pass時間を詳細化できる
assert.match(translucentQueueSource, /getDebugSnapshot\(preparedQueue\)/);
assert.match(translucentQueueSource, /TRANSLUCENT_SMALL_OVERLAP_PIXEL_LIMIT = 8\.0/);
assert.match(translucentQueueSource, /computeTightProjectedInstanceBounds\(group, cameraFrame\)/);
assert.match(translucentQueueSource, /group\.shape\?\.positionArray/);
assert.match(translucentQueueSource, /group\.tightBounds = this\.computeTightProjectedInstanceBounds/);
assert.match(translucentQueueSource, /relation\.minimumOverlapPixels <= smallOverlapPixelLimit/);
assert.match(translucentQueueSource, /ignoredSmallOverlapPairCount/);
assert.match(translucentQueueSource, /maximumIgnoredOverlapPixels/);
assert.match(translucentQueueSource, /localAttitudeDegreesYawPitchRoll/);
assert.match(translucentQueueSource, /worldAttitudeDegreesYawPitchRoll/);
assert.match(translucentQueueSource, /batchRunCount/);
assert.match(translucentQueueSource, /ambiguousPairs/);
assert.match(transparencySource, /getQueueFrameSummary\(\)/);
assert.match(transparencySource, /getQueueDebugSnapshot\(\)/);
assert.match(transparencySource, /requires current TranslucentRenderQueue module/);
assert.match(transparencySource, /this\.lastQueueStats\.frameSequence = this\.queueFrameSequence/);
assert.match(transparencySource, /smallOverlapPixelLimit: TRANSLUCENT_SMALL_OVERLAP_PIXEL_LIMIT/);
assert.match(profilerSource, /getLatestSnapshot\(\)/);
assert.match(profilerSource, /gpuFrameAligned: false/);
assert.match(pipelineSource, /getTransparencyQueueFrameSummary\(\)/);
assert.match(pipelineSource, /getTransparencyQueueDebugSnapshot\(\)/);
const deferredCallSource = pipelineSource.slice(
  pipelineSource.indexOf("this.deferredLightingPass.encode("),
  pipelineSource.indexOf("if (ssrEnabled)")
);
assert.doesNotMatch(deferredCallSource, /transmission:/);
assert.doesNotMatch(pipelineSource, /transmissionIor/);
assert.doesNotMatch(pipelineSource, /transmissionThickness/);

// 画面サイズ依存targetとshader／Compute resourceをresize、destroyで追跡する
assert.match(transparencySource, /this\.transmissionMaskTarget\.resize\(this\.width, this\.height\)/);
assert.match(transparencySource, /this\.transmissionVolumeTarget\.resize\(this\.width, this\.height\)/);
assert.match(transparencySource, /this\.transmissionExitTarget\.resize\(this\.width, this\.height\)/);
assert.match(transparencySource, /this\.transmissionTarget\.resize\(this\.width, this\.height\)/);
assert.match(transparencySource, /this\.transmissionMaskShader\.destroy\(\)/);
assert.match(transparencySource, /this\.transmissionVolumeShader\.destroy\(\)/);
assert.match(transparencySource, /this\.transmissionExitShader\.destroy\(\)/);
assert.match(transparencySource, /this\.transmissionCompositePass\.destroy\(\)/);
assert.match(transparencySource, /this\.transmissionMaskTarget\.destroy\(\)/);
assert.match(transparencySource, /this\.transmissionVolumeTarget\.destroy\(\)/);
assert.match(transparencySource, /this\.transmissionExitTarget\.destroy\(\)/);
assert.match(transparencySource, /this\.transmissionTarget\.destroy\(\)/);

console.log("transparency_pass_transmission_contracts: two-surface refraction ray contracts passed");
