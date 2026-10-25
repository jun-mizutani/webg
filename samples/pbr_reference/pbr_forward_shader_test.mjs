// ---------------------------------------------------------
// pbr_forward_shader_test.mjs  2026/10/25
//   Source transformation contracts for PbrForwardShader
// ---------------------------------------------------------
import assert from "node:assert/strict";
import PbrForwardShader from "./PbrForwardShader.js";

// GPU 初期化前の constructor から生成 WGSL を取得し、PBR の照明項を検査する
{
  const shader = new PbrForwardShader({ format: "bgra8unorm" });
  assert.match(shader.wgslSrc, /fn pbrEvaluateDirectBrdf/);
  assert.match(shader.wgslSrc, /var directLinear = pbrEvaluateDirectBrdf\(/);
  assert.match(shader.wgslSrc, /fn pbrEvaluateIblResponse\(/);
  assert.match(shader.wgslSrc, /return pbrEvaluateIblResponse\(/);
  assert.match(shader.wgslSrc, /pbrClampBrdfLutUv\(/);
  assert.match(shader.wgslSrc, /let distribution = alphaSquared/);
  assert.match(shader.wgslSrc, /let specularBrdf = distribution \* geometry \* fresnel/);
  assert.match(shader.wgslSrc, /let mappedLinear = outputRgb \/ \(vec3f\(1\.0\) \+ outputRgb\)/);
  assert.match(shader.wgslSrc, /linearToSrgb\(mappedLinear\)/);
  assert.doesNotMatch(shader.wgslSrc, /pow\(max\(dot\(refVec, eyeVec\)/);
  assert.doesNotMatch(shader.wgslSrc, /let rgb = finalColor\.rgb \* \(uAmb \+ diff\)/);
}

console.log("pbr_forward_shader_test: transformed WGSL contains GGX and no Phong lighting");
