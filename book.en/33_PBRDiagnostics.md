# Operating and Diagnosing PBR Integration

This chapter uses the display from Chapter 32 as a reference while checking alignment, brightness, resizing, and GPU-resource cleanup. Choose an image to observe first, then investigate each processing stage to narrow down which setting needs adjustment.

## How to read this chapter

### Prerequisites

This chapter is easier to follow if you know the integration in Chapter 32 and camera and depth basics from Chapter 3.

### What to read first

Begin with “Inspecting the Display by Stage” and compare the Chapter 32 example with its intermediate results. Then use the symptom-specific sections.

### What to read when you need it

Refer to camera-relative rendering, shadows, resizing, resource release, intermediate images, and symptom diagnosis as the scene becomes more complex.

### What you will learn

You can diagnose PBR integration issues with depth alignment, black screens, saturated colors, and increased cost by processing stage.

## Inspect the Display by Stage

Once the Chapter 32 scene appears, check model positions, surface color, lighting, reflections, and post-processing in order. Use the completed image as a reference and change one effect at a time to see what it adds.

For a dark image, check in order whether surface information reaches the G-buffer, whether the lit image contains light, and whether the correct texture reaches presentation. If shadows or reflections move out of alignment, verify that the same `cameraFrame` reaches rendering and effects. After changing screen size, verify that render targets and effect sizes update together.

The diagnostic views and symptom sections later in this chapter map these checks to concrete images and settings. Camera-relative rendering later in the chapter preserves coordinate precision for scenes far from the origin. For ordinary scenes, start with presentation, resize, release, and diagnostic topics.

## Present with `beginPresentPass()`

`beginPresentPass()` separates the depth-free transfer of the completed texture to the screen from depth-tested rendering of geometry and a heads-up display (HUD). Matching the pipeline to the render-pass attachment layout prevents a display-switch error from invalidating the entire command buffer, including later HUD rendering, even when the final copy itself is correct.

The tone-mapped `finalColor` is already a completed display texture. Use `FullscreenPass` to transfer it to the swap chain in a color-only render pass started with `Screen.beginPresentPass()`, without geometry depth testing.

A regular 3D pass has a camera Reverse-Z `depth32float` attachment. The full-screen pipeline has a color attachment only. Pass the finished texture to this display pass; switch back to a depth-enabled pass for `Font`, HUD, or other content that requires the regular 3D depth attachment.

Pair final presentation and HUD rendering like this:

```js
app.screen.beginPresentPass({
  clearColor: app.clearColor,
  colorLoadOp: "clear"
});
copyPass.draw(finalColor);

// Close the final presentation pass and retain its color while
// starting a render pass with camera Reverse-Z depth for the HUD
app.screen.clearDepthBuffer();
```

Here, `clearDepthBuffer()` switches from the depth-free final display pass back to a depth-enabled pass. Standard single-pass rendering lets `WebgApp` manage the depth-pass and HUD-pass transitions.

## Centralize Resource Creation and Release

Centralizing resize, creation, and release in the pipeline keeps related texture dimensions aligned in the same frame and lets one pipeline release the resources it created. The application does not need a separate list of targets, so new effects do not add resize omissions or double releases.

When Canvas dimensions change, the pixel mapping changes for the G-buffer, visibility, lighting, reflections, fog, vignette, and downstream targets. Resizing them individually can leave some stale. Notify the integrated pipeline once:

```js
onUpdate: ({ screen }) => {
  pipeline.resize(
    screen.getWidth(),
    screen.getHeight()
  );
}
```

Resources remain intact when the dimensions are unchanged. Targets independent of Canvas size, such as a shadow map, also remain the same after a regular Canvas resize. Resizing individual targets partway through a frame could make the G-buffer and later passes refer to different texture identities, so synchronize the whole pipeline from `onUpdate`.

Release resources through `destroy()` on the pass or pipeline that created them:

```js
window.addEventListener("pagehide", () => {
  app.stop();
  copyPass.destroy?.();
  pipeline.destroy();
}, { once: true });
```

## Tune Cost Through Derived-Target Resolution

Reducing derived-target resolution can greatly reduce effect pixel counts while preserving geometric edges and material data. Keep the G-buffer and final display at the original resolution, since they directly affect appearance, and consider lower resolution first for effects designed around blur or reconstruction, such as occlusion and reflections.

Screen-space effect cost is approximately proportional to processed pixels, samples per pixel, and number of passes.

SSAO `resolutionScale` applies to its computed result, which bilateral filtering with normals and depth reconstructs to full-resolution visibility. SSR `resolutionScale` applies to the reflection-ray output, roughness image pyramid, and final reflection; SSR continues to read the full-resolution G-buffer.

Image-pyramid blur, DoF, bloom, frosted glass, and SSR roughness use `ComputeImagePyramid`, with different levels and input images per effect. Their current level counts are fixed to align each pass's input and output:

- `ComputePyramidBlurPass` downsamples linear HDR to 1/16, then progressively enlarges the lowest-frequency level to the original resolution.
- DoF builds four groups to 1/16: scene, near field, far field, and Circle of Confusion (CoC) data.
- Bloom downsamples the bright extraction to 1/32 and reconstructs it progressively to full resolution.
- Frosted-glass blur and SSR roughness use levels down to 1/8.

| Effect | Main cost | First setting to review | Quality symptoms when reduced too far |
|---|---|---|---|
| SSAO | `resolutionScale`, `samples`, `radius` | `resolutionScale` | Missing contact darkening, blurred object edges |
| SSR | `resolutionScale`, `steps`, `distance` | `resolutionScale` | Rough reflection edges, missed thin objects |
| DoF | Four image-pyramid groups from 1/2 to 1/16, CoC extraction, final composition | Disable `dofEnabled` when unneeded | Adjust `focusRange`, `cocScale`, `blurRadius`; pyramid levels and base dispatch count stay fixed |
| Pyramid blur | Pyramid from 1/2 to 1/16 and progressive full-size reconstruction | `filterRadius` tunes image quality | Pyramid levels and base dispatch count stay fixed |
| Bloom | Pyramid from 1/2 to 1/32, reconstruction, HDR composition | Disable `bloomEnabled` when unneeded | Adjust level weights, `filterRadius`, `strength`; pyramid levels and dispatch count stay fixed |
| Transparent frosted glass | Pyramid from 1/2 to 1/8, roughness mask, transparent surface draws | Check whether transparent triangles are needed | All processing is skipped on frames with zero transparent triangles |
| Fog | One dispatch at full resolution | Disable `fogEnabled` when unneeded | Changing `density` or distance range does not change pixel count |
| Vignette | One dispatch at full resolution | Disable `vignetteEnabled` when unneeded | `strength: 0` still runs the pass; disabling skips it |
| Shadows | Shadow-map size, `pcfRadius` | Balance projection bounds and map size | Stepped shadows or displaced contact areas |

Resolution scale affects both width and height: reducing it from 1.0 to 0.7 yields about 49% of the pixels. Thresholds and blend strengths mostly change appearance and have little effect on computation. Fog and vignette have no reduced-resolution target and run at full resolution to preserve the correspondence with final pixels. Use timing measurements and diagnostic displays to keep performance tuning separate from appearance tuning.

When comparing settings, hold these conditions fixed and measure one change at a time:

1. Use the same GPU, browser, Canvas resolution, scene, camera position, and animation start state.
2. Warm up the configuration with the target effect disabled, then record GPU and frame time for the same interval or frame count.
3. Enable the target effect or change one setting, and measure the same interval.
4. Record both timing differences and visual changes, such as flicker, missing edges, or missed reflections.
5. Repeat measurements and verify that pipeline creation or temporary load from the first run does not affect steady-state results.

Some settings, including `filterRadius`, `density`, and blend strength, change appearance but leave fixed levels and dispatch counts unchanged. Confirm their performance effect with measurements rather than inferring it from a smaller value.

## Show Intermediate Results to Find the First Anomaly

Diagnostic views locate the first stage where an input becomes incorrect. Instead of guessing by disabling effects, inspect albedo, normals, depth, visibility, and material components directly to distinguish missing input from a later composition error. Use `lightingView` to inspect the components read by deferred lighting through the final display.

```js
const finalColor = pipeline.encode(gpu.commandEncoder, {
  cameraFrame,
  shadowEnabled: true,
  ssaoEnabled: true,
  ssrEnabled: false,
  lightingView: "roughness"
});
```

`lightingView` selects a lighting result or a G-buffer component: `"lighting"`, `"albedo"`, `"normal"`, `"depth"`, `"shadow"`, `"spotShadow"`, `"ao"`, `"specular"`, `"roughness"`, `"metallic"`, or `"emissive"`.

Values other than `"lighting"` are diagnostic views. Use them to inspect components; use `"lighting"` for the final appearance. While diagnosing, disable SSR, fog, DoF, bloom, vignette, and other downstream effects so the component under inspection remains unmodified.

SSR also supports `ssrView: "reflection"`, `"normal"`, and `"depth"`. Where a reflection is missing, check whether the source normal and depth are continuous, whether material reflectivity exceeds `reflectivityThreshold`, and whether the ray leaves the screen. For DoF, use `debugView: "depth"` and `"focus"` as described in Chapters 34–36 to distinguish distance reconstruction from blur issues.

Diagnose fog and vignette by comparing each effect enabled and disabled while keeping other effects fixed. For fog, first inspect background depth value 0 and opaque-surface distances with `lightingView: "depth"`. For vignette, hold tone mapping and edge detection constant, then check center, inner transition, and outer color. Adjust one at a time to distinguish HDR issues from display-color issues.

## Map Symptoms to Pipeline Stages

Mapping a symptom to input, geometry, position reconstruction, HDR, or final display helps reach the cause without changing unrelated parameters. When the result differs from the intention, inspect pipeline stages in order rather than tuning from the final image alone.

### Exception on Startup

An exception on startup means incomplete input was caught before GPU commands ran. Use the Shape, property, or projection bounds in the message to repair the missing configuration. An error such as `material.roughness must be finite` indicates an incomplete Shape G-buffer material; add `roughness`, `metallic`, and `emissive` to its `setMaterial()` with values appropriate for the surface.

`directional shadow projection far must be > ...` means the light-view orthographic bounds need to include the shadow receiver or caster. Review scene scale, light target, distance, depth padding, and `fitFar`. Increasing `far` excessively reduces shadow depth precision.

### Geometry Is Invisible

For invisible geometry, check depth conventions before materials or lighting. Keep the format, comparison, and clear value consistent: ordinary camera depth uses `depth32float`, `greater`, and clear value 0. Mixing `depth24plus` or `less` can mismatch the Screen attachment or let geometry fail behind the background.

### AO or Reflections Shift When the Camera Moves

This usually means G-buffer generation and position reconstruction use different views. Pass the same callback `cameraFrame` to `renderScene()` and `encode()`. Get `near`, `far`, projection arrays, and `cameraWorld` from that shared frame and pass its values to each stage. Also verify that G-buffer normals use view space.

### Check Fog Distance for Backgrounds and Transparent Surfaces

Fog leaves background depth 0 unchanged so missing distance data is not interpreted as infinite distance. To bring a sky or gradient toward the fog color, give the background its own distance representation or add a dedicated background-composition step. Increasing `far` still leaves background depth 0 classified as background.

If the fog boundary through a transparent surface does not follow the surface itself, the effect may be visible from using opaque depth as an approximation. Transparent surfaces do not write depth to the G-buffer, so fog uses the opaque surface behind them. For layered transparency or per-transparent-surface fog distance, add a design that evaluates fog during transparent rendering; the standard `ComputeFogPass` is a full-screen approximation using opaque depth. Keep this separate from any full-screen fog to avoid applying fog twice.

If the whole screen looks denser than expected, check whether `WebgApp.setFog()` and pipeline fog are both enabled. Then inspect `mode`, `near`, `far`, `density`, and fog color in order. In exponential mode, `density` is the primary distance-falloff value; changing `near` and `far` does not alter the result.

### Only the Final Screen Is Black

When intermediate textures are correct but the final screen is black, inspect final presentation first. Verify that `beginPresentPass()` is used and `clearDepthBuffer()` follows it. Check WebGPU uncaptured errors for attachment-format or depth-state mismatches. Even with correct Compute output, an invalid final copy or subsequent HUD can invalidate the entire command buffer.

### Colors Are White and Saturated

White clipping can result from excessive lighting, early conversion to display color, or repeated sRGB conversion. Verify that lighting, reflection, fog, DoF, and bloom stay in the `rgba16float` HDR interval and that `ComputeEffectToneMapPass` performs tone mapping and sRGB display conversion once. Storing the HDR scene in intermediate `rgba8unorm`, or applying a power conversion in each effect, loses light energy needed downstream.

### Vignette Looks Elliptical or Also Darkens the HUD

`ComputeVignettePass` compensates for screen aspect ratio internally. Calling `resize()` on the complete pipeline with Canvas dimensions aligns the vignette target with the display and preserves its intended center and radius. Update all full-screen targets together with `pipeline.resize(width, height)` rather than resizing an individual pass.

If vignette also darkens the HUD, check whether HUD was composited into the final texture before vignette or whether a custom vignette runs after presentation. The standard order is tone mapping, edge detection, vignette, final presentation, then HUD. Present the texture returned by the integrated pipeline and call `clearDepthBuffer()` before HUD rendering to keep it separate from vignette.

## Choose an API That Matches the Scope You Want to Manage

Use high- and low-level APIs according to how much resource and ordering responsibility the application wants to manage. For several effects in their standard order, let `ComputeEffectPipeline` handle creation, retention, resizing, connection, and release. The application supplies a scene and settings; the pipeline aligns camera frames, G-buffer layout, HDR formats, and execution through final presentation.

With low-level APIs such as `GeometryBufferPass`, `SsaoPass`, and `ComputeSsrPass`, the application creates each input and output, chooses order, handles resize, and releases resources. This suits research into a new algorithm, inspection of a particular intermediate result, or development of a pass outside the standard order. Continue to use the same camera frame, depth convention, G-buffer layout, and color-space rules.

### What the Integrated Pipeline Manages

`ComputeEffectPipeline` creates and connects the individual passes described in Chapters 34–36, so changes to low-level depth conventions or output formats are shared with the integrated path.

```text
ComputeEffectPipeline
  +-- GeometryBufferPass
  +-- ShadowMapPass / SpotShadowMapPass
  +-- ComputeShadowPass / ComputeSpotShadowPass
  +-- SsaoPass
  +-- DeferredLightingPass
  +-- ComputeSsrPass + ComputeEffectComposer
  +-- TransparencyPass
  +-- ComputeFogPass
  +-- ComputeToonPass
  +-- ComputeDofPass
  +-- ComputeBloomPass
  +-- ComputeEffectToneMapPass
  +-- ComputeEdgePass
  +-- ComputeVignettePass
```

The pipeline manages targets for G-buffer, visibility, HDR color, reflections, fog, blur, display color, and vignette. The main result returned to the application is the final color from `encode()`. Let the pipeline create and release intermediate targets instead of creating duplicates outside it.

### Why It Has Two Stages

Separating `renderScene()` and `encode()` places the integrated pipeline naturally across the geometry portion of `WebgApp`'s render pass and the following Compute work that reads textures. The roles make the point where the render pass closes explicit, while validating a shared camera frame prevents the stages from being used as different frames.

`renderScene()` is the geometry stage that uses a render pass. It creates shadow maps and the G-buffer, and records the frame's camera, shadow type, and enabled state. `encode()` is the Compute stage that reads those textures and records processing from visibility through final display into the command encoder.

The split aligns with `WebgApp`'s `onBeforeDraw` and `onAfterDraw3d` render-pass transition. Those callbacks make up the first and second parts of one frame. Pass the same `cameraFrame`, `shadowEnabled`, and shadow type to both. A mismatch raises an error instead of proceeding with an arbitrary intermediate texture.

### When to Use the Low-Level API

Choose low-level APIs when an input, order, or G-buffer arrangement is required that the standard pipeline cannot express. To add one effect to the standard order, add an individual pass to the pipeline's HDR or display interval so it can reuse existing input/output contracts and resource management. Fog and vignette follow this approach: use an individual pass for isolated inspection, and the integrated pipeline for a regular application.

Build from individual passes when changing G-buffer layout, storing fog distance per transparent surface, replacing the lighting model, or compositing multiple camera results. Retain the shared assumptions: view-space normals, camera Reverse-Z, shadow Standard-Z, `rgba16float` for lighting/fog/HDR effects, `rgba8unorm` for tone mapping/edges/vignette, and one tone-map stage before display. With low-level APIs, the application describes target creation, `encode()` order, resize, and `destroy()`.

## Preserve Precision with Camera-Relative Rendering

Camera-relative rendering retains small positional differences among objects near the camera when their world coordinates are far from the origin. It supports large terrain and long-distance travel without frequently moving the scene to the origin, while keeping ordinary rendering and G-buffer effects in the same coordinate basis.

The JavaScript scene graph and physics simulation can hold world coordinates as `Number`, but GPU uniforms use float32. Subtracting the camera position from a very large world coordinate in a shader matrix calculation can round away differences between nearby objects.

`cameraFrame` calculates `objectWorld - cameraWorld` on the CPU before creating the float32 model-view transform. The integrated pipeline uses this for the G-buffer, so world-space scene positions remain stable. Shadow maps use a separate light-view coordinate system; directional shadows fitted to the camera frustum use the frustum stored in `cameraFrame` to select the needed bounds.

Sharing the frame created by `WebgApp` aligns G-buffer generation, position reconstruction, shadow reception, and SSR rays to one coordinate basis. Pass that `cameraFrame` to `encode()`.

## Choose Directional-Shadow Bounds

Directional-shadow bounds allocate finite shadow-map pixels to the useful region, balancing shadow detail with camera movement. Two approaches are available: fixed bounds and camera-frustum fitting.

For fixed bounds, specify `target`, `distance`, `halfWidth`, `halfHeight`, `near`, and `far`. This keeps shadow density easy to reason about in scenes that stay inside that region.

For frustum fitting, configure:

```js
const pipeline = new ComputeEffectPipeline(gpu, {
  width,
  height,
  shadow: {
    type: "directional",
    directional: {
      fitMode: "frustum-fit",
      fitFar: 80,
      xyPadding: 0.8,
      depthPadding: 4.0,
      minHalfExtent: 1.0,
      minNear: 0.2,
      texelSnap: true
    }
  }
});
```

Set `fitFar` at or below the camera's finite far plane. An inconsistent value raises an error rather than being silently clamped to camera far, which could hide a configuration mistake. `texelSnap` aligns the light-space projection center with shadow-map texels and reduces shadow shimmer during camera motion.

### Define Local Light and Shadow Together with Spot Shadows

Spot shadows suit stage lights, flashlights, and indoor downlights: they illuminate a limited direction and range and cast shadows inside the cone. By limiting the shadow map to the lit region, they concentrate resolution where it is needed. A spotlight is a perspective projection with position, orientation, field of view, and effective distance.

```js
const pipeline = new ComputeEffectPipeline(gpu, {
  width,
  height,
  shadow: {
    type: "spot",
    bias: 0.0015,
    normalBias: 0.003,
    pcfRadius: 1,
    spot: {
      position: [0.0, 7.5, 4.0],
      direction: [0.0, -0.72, -1.0],
      fov: 70,
      innerAngle: 40,
      outerAngle: 50,
      near: 0.05,
      far: 42,
      aspect: 1.0
    }
  },
  lighting: {
    ambient: 0.06,
    spotColor: [1.0, 0.86, 0.68],
    spotIntensity: 2.2
  }
});
```

`fov` describes the cone covered by the shadow map. `innerAngle` and `outerAngle` describe the cone where light intensity remains steady and where it finishes falling to zero. Designing `innerAngle < outerAngle < fov` leaves room between the lighting edge and the shadow-map edge. `near` must be positive and `far` must be greater than `near`. An unnecessarily large `far` spreads conventional-Z shadow-depth precision over a wider range.

Keep shadow type consistent between `renderScene()` and `encode()`. A Directional shadow map generated in the first stage cannot be interpreted as Spot-light visibility in the second. Build both calls from the same per-frame state when switching types at runtime.

## Separate Water and Caustics Cost Checks

When adding water and caustics from Chapter 35, compare normal PBR, caustics only, water only, and both enabled, in that order. `samples/water/water.html` demonstrates configuration and checks; `connectWater()` in `samples/fantasy/main.js` shows a connection in a moving game.

`setWater()` is asynchronous. Do not record a new frame during a transition; wait for setup to finish before resuming. When both water and caustics are disabled, dedicated buffers, textures, QuerySets, and the additional lighting path are released. The regular PBR resources and processing are still required.

In `getWaterStats()`, `causticDispatches` counts illumination generation and `receiverPasses` counts receiver rendering. `surfaceDispatches`, `geometryDispatches`, and `depthPasses` report water-surface work. With fixed wave time and settings, illumination can be reused, while receiver rendering continues to reflect movement of affected Nodes. With both effects off, dedicated processing counts are zero and `timing` is null. GPU timing does not represent total frame time including receiver rendering and added lighting.

Compare the disabled image with normal PBR under the same conditions. Use the sample's diagnostics controls to verify dedicated resources. Keep measurement and image-readback work separate from ordinary rendering so diagnostic work is not mistaken for rendering cost. In a game, also test movement, attacks, and restart after switching to validate both display and state management.

## Summary

Operating PBR integration means tracking camera frame, depth, formats, resource lifetime, and enabled effects in one flow. Use intermediate diagnostic images and enable effects one at a time from a reference scene to isolate black screens, depth shifts, saturated colors, and increased cost. For shared rendering rules and Reverse-Z details, see Chapter 41.
