// ---------------------------------------------------------
// api_contracts.js  2026/08/04
//   Shared PBR BRDF source contracts
// ---------------------------------------------------------
import assert from "node:assert/strict";
import { buildDeferredLightingWgsl } from "../../../webg/DeferredLightingPass.js";
import { GBUFFER_MIN_ROUGHNESS } from "../../../webg/GeometryBufferPass.js";
import {
  PBR_BRDF_WGSL,
  PBR_DIELECTRIC_F0,
  PBR_IBL_WGSL,
  PBR_MIN_DIRECTIONAL_ALBEDO,
  PBR_MIN_ROUGHNESS
} from "../../../webg/PbrBrdf.js";

// CPU側の材質検証とWGSL側の計算が同じ定数を参照することを確認する
assert.equal(PBR_DIELECTRIC_F0, 0.04);
assert.equal(PBR_MIN_ROUGHNESS, 0.04);
assert.equal(PBR_MIN_DIRECTIONAL_ALBEDO, 1.0e-4);
assert.equal(GBUFFER_MIN_ROUGHNESS, PBR_MIN_ROUGHNESS);

// 共有断片がGGX、Smith-Schlick、Schlick Fresnel、Lambert拡散を一体で提供することを確認する
assert.match(PBR_BRDF_WGSL, /fn pbrSchlickWeight/);
assert.match(PBR_BRDF_WGSL, /fn pbrEvaluateF0/);
assert.match(PBR_BRDF_WGSL, /fn pbrEvaluateDirectBrdf/);
assert.match(PBR_BRDF_WGSL, /let distribution = alphaSquared/);
assert.match(PBR_BRDF_WGSL, /let geometry = geometryView \* geometryLight/);
assert.match(PBR_BRDF_WGSL, /let diffuseBrdf = \(vec3f\(1\.0\) - fresnel\)/);
assert.match(PBR_IBL_WGSL, /fn pbrClampBrdfLutUv/);
assert.match(PBR_IBL_WGSL, /texel \* 0\.5/);
assert.match(PBR_IBL_WGSL, /fn pbrEvaluateIblResponse/);
assert.match(PBR_IBL_WGSL, /fn pbrEvaluateIblComponents/);
assert.match(PBR_IBL_WGSL, /fn pbrEvaluateSpecularIblWeight/);
assert.match(PBR_IBL_WGSL, /let directionalAlbedo = max\(brdf\.x \+ brdf\.y/);
assert.match(PBR_IBL_WGSL, /let energyCompensation = vec3f\(1\.0\)/);
assert.match(PBR_IBL_WGSL, /\* energyCompensation/);

// 遅延照明が数式の複製ではなく共有関数を呼び出すことを確認する
const deferredWgsl = buildDeferredLightingWgsl(8);
assert.ok(deferredWgsl.includes(PBR_BRDF_WGSL));
assert.ok(deferredWgsl.includes(PBR_IBL_WGSL));
assert.match(deferredWgsl, /return pbrEvaluateDirectBrdf\(/);
assert.match(deferredWgsl, /return pbrEvaluateIblComponents\(/);
assert.match(deferredWgsl, /specularIblOutputTexture/);
assert.match(deferredWgsl, /pbrClampBrdfLutUv\(/);

console.log("pbr_brdf_api_contracts: shared direct-light BRDF contracts passed");
