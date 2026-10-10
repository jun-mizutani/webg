# PBR Reference

`pbr_reference` is a public sample that compares webg's PBR forward and deferred paths with the same materials, lighting, and environment. Core code and `headless_tests` own the numerical PBR contracts; this sample owns visual, interactive, real-HDR, and diagnostic verification.

The procedural environment generator is provided by `webg/ProceduralEnvironment.js`. Call `listProceduralEnvironmentPresets()` to obtain the available names, then select one with `createProceduralEnvironmentData({ preset: "dark-studio" })`. `createProceduralEnvironmentPng({ preset: "dark-studio", intensity: 0.5, scale: 4 })` returns an RGBA8 PNG `Uint8Array` after Reinhard tone mapping and sRGB conversion. Pass the result to `new Blob([pngBytes], { type: "image/png" })` for browser display or saving.

The screen contains 15 spheres. The columns use roughness values 0.08, 0.20, 0.40, 0.65, and 0.90. The rows use metallic values 0.0, 0.5, and 1.0. Every sphere uses the same base color, dielectric F0 of 0.04, and white direct light.

Use the `Switch to Deferred` button or the Space key to switch between `PbrForwardShader` and `DeferredLightingPass` in `ComputeEffectPipeline`. Shapes, camera state, and material values remain unchanged. Both paths use Reinhard Tone Mapping and the standard sRGB transfer function. SSAO, Shadows, SSR, Fog, Toon, DoF, Bloom, Edge, and Vignette are disabled.

The `Enable IBL` button switches to Deferred and adds a minimal image-based-lighting evaluation. Startup uses a small procedural environment. `Switch to Diagnostic HDR IBL` selects an environment produced from Radiance HDR by Compute Shaders and accepted against the CPU reference. Both contain a linear-HDR equirectangular image, diffuse irradiance, roughness-prefiltered specular levels, and a BRDF integration LUT. Disable IBL to return to the direct-light-only forward/deferred comparison.

`Show HDR Background` displays the original equirectangular HDR—the input to lighting—in pixels not covered by geometry. The spheres are illuminated by the irradiance, roughness-prefiltered specular levels, and BRDF LUT derived from that same HDR. The background is the source image while the spheres show material-dependent integration results; each view uses the HDR according to its role. `Inspect IBL Only` disables directional, point, cone, and shadow contributions. `Rotate Environment by 45°` rotates the background and both opaque and transparent IBL together around the world-space Y axis, making it possible to compare motion of bright background regions with motion of sphere reflections.

The background and IBL remain in one linear-HDR flow and receive the same final Reinhard Tone Map and sRGB conversion. Requesting a background without original radiance, or requesting a nonzero rotation without an environment, throws an error. Reference captures are stored as `hdr_background_ibl_only_0deg.jpg` and `hdr_background_ibl_only_45deg.jpg`.

The `HDR Input` status reports the Radiance RGBE decoder check. At startup, the application decodes a deterministic 8×4, 2:1 equirectangular HDR byte stream and verifies standard `-Y +X` orientation, `EXPOSURE` correction, and preservation of values above 1. The diagnostic image uses blue at the top, warm color at the bottom, distinct colors around the four horizontal directions, and a small high-radiance source. These markers expose vertical or horizontal reversal, roughness-mip errors, and HDR clipping.

`PbrEnvironmentReference.js` and `PbrEnvironmentCompute.js` use the same Hammersley sequence, direction mapping, cosine-weighted diffuse integration, GGX importance sampling, and roughness rule to generate five specular levels and a 32×32 BRDF LUT. `HDR Prefilter` reports CPU time, Compute time including GPU completion, and the maximum absolute error after half-float readback. After cache validation, resources reconstructed from those Compute-generated values illuminate the 15 spheres. `Return to Procedural IBL` selects the procedural environment.

The application stores the CPU-accepted Compute output and original HDR in a versioned binary cache. Metadata records source ID, source dimensions, color space, orientation, all output dimensions, specular mip count, the three sample counts, and the generator version. Radiance, irradiance, specular levels, and the BRDF LUT use little-endian binary16 payloads. The application fetches an in-memory Blob URL asynchronously, acquires the same key twice, verifies reuse of one GPU environment, and then uses that reconstructed environment for actual lighting.

`HDR Cache = v1 / 6.9 KiB / reused` means the 7,054-byte diagnostic cache was decoded as version 1 and both acquisitions shared the same GPU resource. Source-ID, preprocessing-condition, version, mip-size, or payload-length mismatches throw errors. Network or corruption failures do not silently select the procedural environment. An active handle must be released before eviction; active GPU resources are never forcibly destroyed.

The `Environment View` button cycles through the final spheres, original HDR radiance, diffuse irradiance, GGX-prefiltered specular, and the BRDF LUT as fullscreen diagnostic views. Exposure controls change radiance, irradiance, and specular display by one EV without changing lighting intensity or cached values. `Next Specular Mip` advances the mip and corresponding roughness; `View Detail` reports resolution, mip, roughness, and diagnostic exposure. The BRDF LUT is displayed linearly with Fresnel scale in R and bias in G, not as an ordinary color image.

Clicking a diagnostic image moves a black-and-white crosshair and reports UV, texel coordinates, and binary16-restored cache values under `Selected Pixel`. The image is aspect-fitted, and clicks in its black bars are not treated as pixel selections. Reference captures are `environment_debug_radiance.jpg`, `environment_debug_irradiance.jpg`, `environment_debug_specular_mip.jpg`, and `environment_debug_brdf_lut.jpg`.

`White Furnace`, `GPU Interval`, and `Env Memory` provide diagnostics. The furnace evaluates 40 points across dielectric and metal materials, five roughness values, and four `NdotV` values under a uniform white environment. Its energy upper limit is 1.02. This test evaluates energy amplification in single-scattering GGX; evaluating multiple-scattering conservation requires separate conditions for that model.

On devices with `timestamp-query`, `GPU Interval` measures from the first Compute preprocessing dispatch through the last. `HDR Prefilter` GPU wall time measures CPU submit through completion and may include preparation or waiting. `Env Memory` reports logical texture data derived from formats and dimensions. Driver padding and internal allocation overhead require additional space.

Forward and Deferred use the same IBL composition, BRDF-LUT edge handling, and diagnostic HDR. For an IBL-only comparison, Forward sets the shader-default radiance to zero. Confirm that both views report no error, then compare reflections and lighting while allowing for raster edges and G-buffer quantization.

The CPU implementation provides a reference for Compute Shader output. The diagnostic application sets a maximum-error limit of 0.25 and rejects non-finite output, size or mip-count mismatches, and errors above that limit. The 8×4 diagnostic input is used for output validation. Use the same HDR image and generation settings in both paths to compare real-asset performance.

Press the environment-switch control again after diagnostic HDR to select the real-HDR environment. `Studio Small 01` is a CC0 asset from Poly Haven. The application includes its 1024×512 source HDR and an approximately 4.41 MiB `.webgpbr` cache generated by the offline CPU tool. `Real HDR Asset` reports fetch, decode, and GPU-upload time. The original HDR appears as the background while IBL from the same environment illuminates the 15 spheres.

The `standard` preset uses 64×32 irradiance, nine specular mips from 256×128, a 128×128 BRDF LUT, and 512 samples per integral. `webg-split-sum-ggx-environment-mis-linear-srgb-v3` converts Radiance standard primaries to linear sRGB and combines a linear-sRGB-luminance environment proposal with cosine diffuse and GGX specular proposals through MIS.

The diagnostic Compute implementation uses the same alias table and PDFs as the CPU path. The alias table uses eight bytes per source pixel during generation. Runtime lighting samples the cached IBL textures.

Core `RadianceHdr.js` accepts `FORMAT=32-bit_rle_rgbe`, standard `-Y height +X width` orientation, and linear `GAMMA=1`, and decodes flat, old-RLE, and new-RLE scanlines. Cumulative `EXPOSURE` and `COLORCORR` values are divided out because they have already been applied to file pixels. Unknown formats, other orientations, truncated RLE, trailing payload, and non-finite metadata throw errors. Decoded values remain `linear-radiance-rgb`; a separate function converts Radiance standard primaries from white point E to sRGB D65 with Bradford adaptation and returns `linear-srgb`. Callers must explicitly choose `reject` or `clip` for negative out-of-gamut components, and non-standard `PRIMARIES` remain unsupported at the IBL boundary.

The `Enable PBR Textures` button switches to Deferred and applies procedural metallic-roughness, occlusion, and emissive textures to all 15 spheres. Matching glTF, the metallic-roughness texture stores roughness in G and metallic in B; these samples multiply the uniform material factors. The occlusion texture uses R and attenuates only indirect ambient and IBL, never direct lighting. The emissive texture is decoded from sRGB and multiplied by an independent linear-HDR `emissive_factor`, so emitted radiance may exceed 1.0. Enable IBL as well when comparing the occlusion pattern.

The `Show Alpha Three-Plane Comparison` button loads `pbr_fixture.gltf`, which embeds five 2×2 textures as data URIs, through the normal `WebgApp.loadModel()` path. It applies the decoded base-color texture to three open planes: `OPAQUE`, `MASK`, and `BLEND` from left to right. All three use the same camera, lighting, material factors, and texture. The comparison enables Deferred and IBL automatically.

The four base-color texels contain alpha 1.0, about 0.19, about 0.86, and about 0.38. Explicit nearest sampling prevents interpolation between those alpha values. `OPAQUE` ignores all four alpha values, `MASK` omits the two regions below `alphaCutoff=0.5` from the G-buffer, and `BLEND` composites every region over the background using texture alpha even though the material alpha factor is 1.0. A high-contrast checker behind the planes makes MASK appear as hard holes and BLEND as varying checker visibility.

The planes are single-sided and have no back surfaces. A closed mesh therefore cannot fill MASK holes with its back face or accumulate front and back layers under BLEND. Double-sided pipeline selection and back-face normal reversal remain separate tests and are intentionally excluded from this alpha-only comparison.

The `Show Transparent PBR Fixture` button is separate from the alpha-only comparison. It displays the original glTF cube as a `BLEND` material and connects all five textures—base color, normal, metallic-roughness, occlusion, and independent HDR emissive—to the shared forward GGX shader. It also enables a directional shadow, a blue point light, and an orange cone light so that shadow reception and local-light evaluation can be checked at the transparent fragment position.

The `Switch to Photometric Lights` button switches to Deferred and uses photometric units with inverse-square attenuation instead of relative intensity with finite-radius attenuation. Directional-light intensity is illuminance in lux. Point- and cone-light intensity is luminous intensity in candela. Every local light must specify `minimumDistance`, which defines the finite near-source limit used instead of allowing the inverse-square expression to diverge at the light center. The radius applies a smooth cutoff only near the range boundary.

Photometric mode uses `exposureEv100=9.0`. The procedural environment uses an explicit comparison scale of 500. Comparing measured cd/m² requires a calibrated HDR image and its measurement conditions. This view checks that units, distance attenuation, and exposure switch together and that transparent objects use the same local-light attenuation.

In the core, `PbrBrdf.js` provides the shared direct-light BRDF, `PbrEnvironmentReference.js` generates CPU reference data, and `PbrEnvironmentCompute.js` generates GPU resources. Compute outputs use storage-writable and sampleable `rgba16float`; the BRDF LUT uses only R and G. Enabling IBL requires uniform ambient to be zero and requires the complete irradiance, prefiltered-specular, BRDF-LUT, sampler, and mip-count set; incomplete input throws an exception.

Run an HTTP server at the repository root and open `/samples/pbr_reference/pbr_reference.html` in a WebGPU-capable browser.

```sh
python3 -m http.server 8000
```

Run the sample-specific HDR-input, wiring, display-forward-shader, and core numerical contracts with:

```sh
node --experimental-default-type=module samples/pbr_reference/pbr_reference_test.mjs
node --experimental-default-type=module samples/pbr_reference/pbr_forward_shader_test.mjs
node headless_tests/core/radiance_hdr/headless_probe.js
node headless_tests/core/pbr_environment_reference/headless_probe.js
node headless_tests/core/pbr_environment_compute/headless_probe.js
node headless_tests/core/pbr_environment_cache/headless_probe.js
node headless_tests/core/pbr_environment_debug_pass/headless_probe.js
node headless_tests/core/pbr_environment_evaluation/headless_probe.js
```

The transparent forward shader covers GGX direct lighting, base color and normal mapping, metallic-roughness, occlusion, independent HDR emissive, texture alpha, IBL, directional and spot shadows, and point and cone lights. Local lights use the same relative or inverse-square attenuation as Deferred. Occlusion attenuates only indirect IBL, never direct lighting or emission. The forward path does not reuse screen-space visibility resolved at the opaque G-buffer depth; it performs the same PCF shadow-map test from each transparent fragment's view-space position. `SmoothShader` provides hooks through which a derived shader can extend material textures and additional bind groups, while the standard SmoothShader layout and output remain unchanged.
