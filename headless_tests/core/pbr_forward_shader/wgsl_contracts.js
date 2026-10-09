// ---------------------------------------------------------
// headless_tests/core/pbr_forward_shader/wgsl_contracts.js  2026/08/10
//   Shared BRDF and linear-HDR output contracts
// ---------------------------------------------------------
import assert from "node:assert/strict";
import SmoothShader from "../../../webg/SmoothShader.js";
import PbrForwardShader, {
  buildPbrForwardHdrWgsl
} from "../../../webg/PbrForwardShader.js";

const smooth = new SmoothShader({});
const wgsl = buildPbrForwardHdrWgsl(smooth.wgslSrc);
assert.match(wgsl, /fn pbrEvaluateDirectBrdf\(/);
assert.match(wgsl, /var directLinear = pbrEvaluateDirectBrdf\(/);
assert.match(wgsl, /pbrMaterial\s*:\s*vec4<f32>/);
assert.match(wgsl, /pbrEmissive\s*:\s*vec4<f32>/);
assert.match(wgsl, /pbrRadiance\s*:\s*vec4<f32>/);
assert.match(wgsl, /var metallic = clamp\(u\.pbrMaterial\.x, 0\.0, 1\.0\)/);
assert.match(wgsl, /var roughness = clamp\(u\.normalMapParams\.z, 0\.04, 1\.0\)/);
assert.match(wgsl, /max\(u\.pbrRadiance\.rgb, vec3f\(0\.0\)\)/);
assert.match(wgsl, /metallicRoughnessSample\.g/);
assert.match(wgsl, /metallicRoughnessSample\.b/);
assert.match(wgsl, /materialOcclusion \*= textureSample/);
assert.match(wgsl, /srgbToLinear\(emissiveSrgb\) \* u\.pbrEmissive\.rgb/);
assert.match(wgsl, /let pbrDebugBackface = u\.debugFlags\.x != 0\.0 && !input\.frontFacing/);
assert.match(wgsl, /return select\(pbrOutput, vec4f\(u\.debugColor\.rgb, 1\.0\), pbrDebugBackface\)/);
assert.doesNotMatch(wgsl, /if \(u\.debugFlags\.x != 0\.0 && !input\.frontFacing\) \{\s*return/);
assert.match(wgsl, /fn pbrEvaluateForwardIbl\(/);
assert.match(wgsl, /fn pbrEvaluateIblResponse\(/);
assert.match(wgsl, /return pbrEvaluateIblResponse\(/);
assert.match(wgsl, /pbrClampBrdfLutUv\(/);
assert.match(wgsl, /pbrEnvironmentViewToWorld/);
assert.match(wgsl, /fn pbrEnvironmentWorldToTextureDirection\(/);
assert.match(wgsl, /cos\(pbrEnvironment\.control\.w\)/);
assert.match(wgsl, /roughness \* maxLod/);
assert.match(wgsl, /let rgb = directLinear \+ indirectLinear \+ emissiveLinear/);
assert.match(wgsl, /u\.normalMapParams\.y \* finalColor\.a/);
assert.match(wgsl, /u\.transmissionParams\.x \* u\.transmissionParams\.w/);
assert.match(wgsl, /let physicalSurfaceAlpha = 1\.0/);
assert.match(wgsl, /effectiveTransmission \* \(1\.0 - materialSurfaceAlpha\)/);
assert.match(wgsl, /finalColor = vec4f\(u\.color\.rgb \* texColor\.rgb, texColor\.a\)/);
assert.match(wgsl, /let pbrNormal = select\(-nnormal, nnormal, input\.frontFacing\)/);
assert.match(wgsl, /@group\(3\) @binding\(6\) var pbrShadowDepthTexture : texture_depth_2d/);
assert.match(wgsl, /fn pbrEvaluateForwardShadow\(/);
assert.match(wgsl, /directLinear \*= pbrEvaluateForwardShadow\(/);
assert.match(wgsl, /var lightIndex = 0u; lightIndex < 128u/);
assert.match(wgsl, /pbrLocalLights\[lightIndex\]/);
assert.match(wgsl, /pbrEvaluateLocalLightAngularAttenuation\(/);
assert.match(wgsl, /pbrEvaluateForwardMainLightAttenuation\(/);
assert.match(wgsl, /pbrEvaluateDistanceAttenuation\(/);
assert.match(wgsl, /localLight\.outerCosAndType\.z/);
assert.match(wgsl, /directLinear \+= pbrEvaluateDirectBrdf\(/);
assert.doesNotMatch(wgsl, /roughnessDerivedExponent/);
assert.doesNotMatch(wgsl, /mappedLinear/);
assert.doesNotMatch(wgsl, /linearToSrgb\(.*directLinear/);
assert.throws(() => buildPbrForwardHdrWgsl("broken"), /vertex shader marker/);

// PBR材質値は親のPhong／Fog／debug値と別領域に置き、未指定drawでは既定値へ戻します
{
  const shader = new PbrForwardShader({});
  assert.equal(shader.UNIFORM_FLOAT_COUNT, 112);
  assert.equal(shader.UNIFORM_SIZE, 112 * Float32Array.BYTES_PER_ELEMENT);
  assert.equal(shader.uniformData.length, 112);
  assert.deepEqual(
    Array.from(shader.uniformData.slice(shader.OFF_PBR_MATERIAL, shader.OFF_PBR_MATERIAL + 4)),
    [0.0, 1.0, 0.0, 0.0]
  );
  assert.deepEqual(
    Array.from(shader.uniformData.slice(shader.OFF_PBR_EMISSIVE, shader.OFF_PBR_EMISSIVE + 4)),
    [0.0, 0.0, 0.0, 0.0]
  );
  assert.deepEqual(
    Array.from(shader.uniformData.slice(shader.OFF_PBR_RADIANCE, shader.OFF_PBR_RADIANCE + 4)),
    [1.0, 1.0, 1.0, 0.0]
  );
  assert.equal(shader.uniformData[shader.OFF_TRANSMISSION + 3], 0.0);
  shader.setTransmissionPassScale(0.75);
  assert.equal(shader.uniformData[shader.OFF_TRANSMISSION + 3], 0.75);
  assert.throws(
    () => shader.setTransmissionPassScale(-0.01),
    /transmission pass scale must be a finite number between 0\.0 and 1\.0/
  );

  shader.doParameter({
    power: 64.0,
    fog_color: [0.2, 0.3, 0.4, 1.0],
    fog_near: 6.0,
    fog_far: 18.0,
    fog_density: 0.08,
    fog_mode: 1.0,
    backface_color: [0.9, 0.1, 0.2, 1.0]
  });
  assert.equal(shader.uniformData[shader.OFF_PARAMS + 2], 64.0);
  assert.deepEqual(
    Array.from(shader.uniformData.slice(shader.OFF_FOG_PARAMS, shader.OFF_FOG_PARAMS + 4)),
    [6.0, 18.0, Math.fround(0.08), 1.0]
  );
  assert.deepEqual(
    Array.from(shader.uniformData.slice(shader.OFF_PBR_MATERIAL, shader.OFF_PBR_MATERIAL + 4)),
    [0.0, 1.0, 0.0, 0.0]
  );
  assert.deepEqual(
    Array.from(shader.uniformData.slice(shader.OFF_PBR_RADIANCE, shader.OFF_PBR_RADIANCE + 3)),
    [1.0, 1.0, 1.0]
  );

  shader.doParameter({
    metallic: 0.65,
    occlusion: 0.4,
    emissive_factor: [2.0, 1.0, 0.5],
    radiance: [4.0, 3.0, 2.0],
    use_metallic_roughness_texture: 1,
    use_occlusion_texture: 1,
    use_emissive_texture: 1
  });
  assert.deepEqual(
    Array.from(shader.uniformData.slice(shader.OFF_PBR_MATERIAL, shader.OFF_PBR_MATERIAL + 4)),
    [Math.fround(0.65), Math.fround(0.4), 1.0, 1.0]
  );
  assert.deepEqual(
    Array.from(shader.uniformData.slice(shader.OFF_PBR_EMISSIVE, shader.OFF_PBR_EMISSIVE + 4)),
    [2.0, 1.0, 0.5, 1.0]
  );

  shader.doParameter({ power: 32.0, fog_near: 9.0 });
  assert.deepEqual(
    Array.from(shader.uniformData.slice(shader.OFF_PBR_MATERIAL, shader.OFF_PBR_MATERIAL + 4)),
    [0.0, 1.0, 0.0, 0.0]
  );
  assert.deepEqual(
    Array.from(shader.uniformData.slice(shader.OFF_PBR_EMISSIVE, shader.OFF_PBR_EMISSIVE + 4)),
    [0.0, 0.0, 0.0, 0.0]
  );
}

console.log("pbr_forward_shader_wgsl_contracts: shared GGX HDR output passed");
