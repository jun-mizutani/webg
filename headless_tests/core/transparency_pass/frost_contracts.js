// ---------------------------------------------------------
// headless_tests/core/transparency_pass/frost_contracts.js  2026/07/23
//   Roughness-driven image-pyramid Frost integration contracts
// ---------------------------------------------------------
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const transparencySource = readFileSync(
  new URL("../../../webg/TransparencyPass.js", import.meta.url),
  "utf8"
);
const smoothSource = readFileSync(
  new URL("../../../webg/SmoothShader.js", import.meta.url),
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

// 透明合成前のHDR sceneから共通Pyramidを作り、roughness maskで隣接Levelを選びます
assert.match(
  transparencySource,
  /import ComputeImagePyramid from "\.\/ComputeImagePyramid\.js\?v=20260723_image_pyramid"/
);
assert.doesNotMatch(transparencySource, /import ComputeBlurPass/);
assert.match(transparencySource, /export const FROST_PYRAMID_LEVELS = Object\.freeze\(\[2, 4, 8\]\)/);
assert.match(transparencySource, /this\.frostPyramid = new ComputeImagePyramid/);
assert.match(transparencySource, /this\.roughnessMaskTarget = new RenderTarget/);
assert.match(transparencySource, /roughnessMask: true/);
assert.match(transparencySource, /this\.frostCompositePass = new ComputePass/);
assert.match(transparencySource, /this\.frostPyramid\.encode\(commandEncoder, scene\)/);
assert.match(transparencySource, /const half = this\.frostPyramid\.getLevel\(2\)/);
assert.match(transparencySource, /const quarter = this\.frostPyramid\.getLevel\(4\)/);
assert.match(transparencySource, /const eighth = this\.frostPyramid\.getLevel\(8\)/);
assert.match(transparencySource, /textureSampleLevel\(halfTexture, frostSampler, uv, 0\.0\)/);
assert.match(transparencySource, /textureSampleLevel\(quarterTexture, frostSampler, uv, 0\.0\)/);
assert.match(transparencySource, /textureSampleLevel\(eighthTexture, frostSampler, uv, 0\.0\)/);
assert.match(transparencySource, /roughnessAmount \* 3\.0/);
assert.match(transparencySource, /mix\(halfColor, quarterColor/);
assert.match(transparencySource, /mix\(quarterColor, eighthColor/);
assert.match(transparencySource, /roughnessMask: this\.roughnessMaskTarget/);
assert.match(transparencySource, /orderIndependentTranslucent: true/);
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

// SmoothShaderはroughness maskをmax blendし、透明Specularの鏡面指数とピークを同時に減衰します
assert.match(smoothSource, /setRoughness\(value\)/);
assert.match(smoothSource, /value < 0\.04 \|\| value > 1\.0/);
assert.match(smoothSource, /this\.updateParam\(param, "roughness", this\.setRoughness\)/);
assert.match(smoothSource, /this\.roughnessMask = options\.roughnessMask === true/);
assert.match(smoothSource, /operation: "max"/);
assert.match(smoothSource, /let roughnessDerivedExponent = clamp\(0\.5 \/ roughnessFourth - 0\.5, 1\.0, 512\.0\)/);
assert.match(smoothSource, /let materialExponent = mix\(max\(uSpecPower, 1\.0\), 1\.0, specularRoughness\)/);
assert.match(smoothSource, /let effectiveSpecularExponent = max\(roughnessDerivedExponent, materialExponent\)/);
assert.match(smoothSource, /let specularPeak = mix\(1\.0, 0\.12, specularRoughness\)/);

// Shapeの通常draw処理はshaderOverrideを使い、利用側へmask pass構築を要求しません
assert.match(shapeSource, /const baseShader = options\.shaderOverride \?\? this\.shader/);
assert.match(shapeSource, /if \(shd\.getBindGroup3\)/);
assert.match(shapeSource, /pass\.setBindGroup\(3, bindGroup3\)/);

// ComputeEffectPipelineは旧Frost blur parameterを持たず、Pyramid構成をコアへ固定します
assert.match(
  pipelineSource,
  /transparency:\s*\{\}/
);
assert.match(pipelineSource, /this\.transparencyOptions = mergeOptions/);
assert.match(pipelineSource, /\.\.\.this\.transparencyOptions/);

console.log("transparency_pass_frost_contracts: roughness-driven Frost contracts passed");
