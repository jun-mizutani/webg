// ---------------------------------------------------------
// headless_tests/core/transparency_pass/frost_contracts.js  2026/08/11
//   Roughness-driven image-pyramid Frost integration contracts
// ---------------------------------------------------------
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  computeFrostPyramidMaxLevel
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
const shapeSource = readFileSync(
  new URL("../../../webg/Shape.js", import.meta.url),
  "utf8"
);
const pipelineSource = readFileSync(
  new URL("../../../webg/ComputeEffectPipeline.js", import.meta.url),
  "utf8"
);

// 最大roughnessをLevel境界へ変換し、既定sampleの0.28では1/2だけを要求します
assert.equal(computeFrostPyramidMaxLevel(0.04), 0);
assert.equal(computeFrostPyramidMaxLevel(0.28), 2);
assert.equal(computeFrostPyramidMaxLevel(0.36), 2);
assert.equal(computeFrostPyramidMaxLevel(0.360001), 4);
assert.equal(computeFrostPyramidMaxLevel(0.68), 4);
assert.equal(computeFrostPyramidMaxLevel(0.680001), 8);
assert.equal(computeFrostPyramidMaxLevel(1.0), 8);
assert.throws(() => computeFrostPyramidMaxLevel(1.01), /must be <= 1/);

// 透明合成前のHDR sceneから共通Pyramidを作り、roughness maskで隣接Levelを選びます
assert.match(
  transparencySource,
  /import ComputeImagePyramid from "\.\/ComputeImagePyramid\.js"/
);
assert.doesNotMatch(transparencySource, /import ComputeBlurPass/);
assert.match(transparencySource, /export const FROST_PYRAMID_LEVELS = Object\.freeze\(\[2, 4, 8\]\)/);
assert.match(transparencySource, /this\.frostPyramid = new ComputeImagePyramid/);
assert.match(transparencySource, /this\.roughnessMaskTarget = new RenderTarget/);
assert.match(transparencySource, /roughnessMask: true/);
assert.match(transparencySource, /this\.frostCompositePass = new ComputePass/);
assert.match(
  transparencySource,
  /this\.frostPyramid\.encode\(commandEncoder, backgroundSource, \{[\s\S]*maxLevel: frostPyramidMaxLevel/
);
assert.match(transparencySource, /const half = this\.frostPyramid\.getLevel\(2\)/);
assert.match(transparencySource, /const quarter = this\.frostPyramid\.getLevel\(4\)/);
assert.match(transparencySource, /const eighth = this\.frostPyramid\.getLevel\(8\)/);
assert.match(transparencySource, /textureSampleLevel\(halfTexture, frostSampler, uv, 0\.0\)/);
assert.match(transparencySource, /textureSampleLevel\(quarterTexture, frostSampler, uv, 0\.0\)/);
assert.match(transparencySource, /textureSampleLevel\(eighthTexture, frostSampler, uv, 0\.0\)/);
assert.match(transparencySource, /if \(roughness <= 0\.04\) \{[\s\S]*textureStore\(outputTexture, pixel, sceneColor\);[\s\S]*return;/);
assert.ok(
  transparencySource.indexOf("if (levelPosition <= 1.0)")
    < transparencySource.indexOf("let quarterColor = textureSampleLevel"),
  "quarter Level must be sampled only after the half-only branch"
);
assert.ok(
  transparencySource.indexOf("if (levelPosition <= 2.0)")
    < transparencySource.indexOf("let eighthColor = textureSampleLevel"),
  "eighth Level must be sampled only after the quarter branch"
);
assert.match(transparencySource, /roughnessAmount \* 3\.0/);
assert.match(transparencySource, /mix\(halfColor, quarterColor/);
assert.match(transparencySource, /mix\(quarterColor, eighthColor/);
assert.match(transparencySource, /roughnessMask: this\.roughnessMaskTarget/);
assert.match(transparencySource, /orderIndependentTranslucent: true/);
assert.match(transparencySource, /computeFrostPyramidMaxLevel\(maxFrostRoughness\)/);
assert.match(transparencySource, /maxLevel: frostPyramidMaxLevel/);
assert.match(pipelineSource, /translucentRenderQueue\.summarize\(/);
assert.match(pipelineSource, /maxFrostRoughness: translucentSummary\.maxFrostRoughness/);
assert.ok(
  transparencySource.indexOf("this.frostCompositePass.encode(commandEncoder")
    < transparencySource.indexOf("label: `${this.label}:transparent-pass`"),
  "Frost composite must be encoded before translucent surface color"
);

// resizeとdestroyでもmask、Pyramid、composite passを追跡します
assert.match(transparencySource, /this\.roughnessMaskTarget\.resize\(this\.width, this\.height\)/);
assert.match(transparencySource, /this\.frostPyramid\.resize\(this\.width, this\.height\)/);
assert.match(transparencySource, /this\.roughnessMaskShader\.destroy\(\)/);
assert.match(transparencySource, /this\.frostCompositePass\.destroy\(\)/);
assert.match(transparencySource, /this\.frostPyramid\.destroy\(\)/);
assert.match(transparencySource, /this\.roughnessMaskTarget\.destroy\(\)/);

// SmoothShaderはFrost用roughness maskだけをmax blendし、色描画は共有GGX shaderへ分離します
assert.match(smoothSource, /setRoughness\(value\)/);
assert.match(smoothSource, /value < 0\.04 \|\| value > 1\.0/);
assert.match(smoothSource, /this\.updateParam\(param, "roughness", this\.setRoughness\)/);
assert.match(smoothSource, /this\.roughnessMask = options\.roughnessMask === true/);
assert.match(smoothSource, /operation: "max"/);
assert.match(
  transparencySource,
  /import PbrForwardShader from "\.\/PbrForwardShader\.js(?:\?[^"\n]+)?"/
);
assert.match(transparencySource, /this\.shader = new PbrForwardShader/);
assert.match(pbrForwardSource, /PBR_BRDF_WGSL/);
assert.match(pbrForwardSource, /let rgb = directLinear \+ indirectLinear \+ emissiveLinear/);
assert.match(pbrForwardSource, /getAdditionalGroup1LayoutEntries\(\)/);
assert.match(
  pbrForwardSource,
  /setEnvironment\(environment, intensity, cameraFrame, rotationDegrees = 0\.0\)/
);
assert.match(pbrForwardSource, /pbrEnvironmentWorldToTextureDirection/);
assert.match(transparencySource, /resources\.environmentRotationDegrees \?\? 0\.0/);
assert.match(pbrForwardSource, /PbrForwardShader requires metallic_roughness_texture when enabled/);
assert.match(pbrForwardSource, /PbrForwardShader requires occlusion_texture when enabled/);
assert.match(pbrForwardSource, /PbrForwardShader requires emissive_texture when enabled/);
assert.doesNotMatch(pbrForwardSource, /pbrLinearToSrgb/);
assert.doesNotMatch(pbrForwardSource, /mappedLinear/);
assert.match(pipelineSource, /radiance: \(shadowType === "spot"/);
assert.match(pipelineSource, /environment: lighting\.environment/);
assert.match(pipelineSource, /environmentIntensity: lighting\.environmentIntensity/);
assert.match(transparencySource, /this\.shader\.setEnvironment\(/);

// Shapeの通常draw処理はshaderOverrideを使い、利用側へmask pass構築を要求しません
assert.match(shapeSource, /const baseShader = options\.shaderOverride \?\? this\.shader/);
assert.match(shapeSource, /if \(shd\.getBindGroup3\)/);
assert.match(shapeSource, /pass\.setBindGroup\(3, bindGroup3\)/);
assert.doesNotMatch(shapeSource, /pass\.setBindGroup\(4,/);
assert.match(pipelineSource, /getLocalLightBindingResources\(\)/);
assert.match(pipelineSource, /lightViewProjection: shadowType === "spot"/);
assert.match(transparencySource, /this\.shader\.setFrameLighting\(/);

// パス別Profilerは6区間へtimestampWritesを渡し、submit後readbackと診断snapshotを公開します
for (const name of [
  "transmissionMask",
  "transmissionComposite",
  "frostPyramid",
  "roughnessMask",
  "frostComposite",
  "forward"
]) {
  assert.match(transparencySource, new RegExp(`getTimestampWrites\\("${name}"\\)`));
}
assert.match(transparencySource, /afterGpuSubmit\(\)/);
assert.match(transparencySource, /getPerformanceSnapshot\(\)/);
assert.match(pipelineSource, /getTransparencyPerformanceSnapshot\(\)/);

// ComputeEffectPipelineは旧Frost blur parameterを持たず、Pyramid構成をコアへ固定します
assert.match(
  pipelineSource,
  /transparency:\s*\{[\s\S]*transmissionEnabled:\s*false/
);
assert.match(pipelineSource, /this\.transparencyOptions = mergeOptions/);
assert.match(pipelineSource, /\.\.\.this\.transparencyOptions/);

console.log("transparency_pass_frost_contracts: roughness-driven Frost contracts passed");
