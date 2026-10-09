# Basic PBR Integration

This chapter connects the order from Chapter 31 to `WebgApp` initialization and frame updates. First run the example to see the finished image. Then follow the minimal execution order, initialization, and frame update that passes camera information. Finally, adjust materials and individual effects.

## How to read this chapter

### Prerequisites

This chapter is easier to follow if you know the integration approach in Chapter 31 and the `WebgApp` callbacks in Chapter 5.

### What to read first

Start with the reference scene, minimal execution order, initialization, and frame processing with the same `cameraFrame`. The code listings are staged excerpts; `book/examples/32_01.html` contains the complete runnable example in one HTML file.

### What to read when you need it

Refer to the G-buffer, transparency, fog, toon shading, DoF, bloom, and tone mapping sections when adding effects.

### What you will learn

You can connect PBR integration to `WebgApp` and execute multiple screen effects in a defined order.

## Compare with a Reference Scene to Identify Each Effect

Open the [standard-rendering example](../book/examples/31_01.html) and the [PBR integration example](../book/examples/32_01.html), then compare the floor, walls, and spheres at the same positions.

Comparing the same geometry through forward and deferred rendering isolates the information added by SSAO, shadows, SSR, and deferred lighting from differences in models or camera placement. `book/examples/31_01.html` draws the floor, walls, cubes, spheres, and pillars with only the standard `WebgApp` and `SmoothShader` forward path. `WebgApp` internally manages camera Reverse-Z, camera-relative model-view transforms, and frame state; the application leaves `CameraFrame`, `renderFrameToken`, and depth conventions to `WebgApp`.

`book/examples/32_01.html` renders the same geometry arrangement with `ComputeEffectPipeline`. By limiting the comparison to rendering technique, you can inspect SSAO contact cues, direct-light occlusion from shadows, SSR reflections, and deferred-lighting material differences.

### Choose a Rendering Path at the Application Entry Point

Choose the rendering path at the application entry point to match the required effects. Keeping a simple screen on the forward path keeps its configuration and resources small; move only screens that need effects sharing the G-buffer to the deferred integrated pipeline.

`ComputeEffectPipeline` is the deferred path for combining selected effects. To use forward rendering, choose the standard `WebgApp` drawing path at the application entry point. `renderScene()` always generates the G-buffer, and `encode()` connects shadow and AO visibility, deferred lighting, and selected downstream effects using the same processing order and input/output contract. Enabling or disabling an effect does not change the rendering technique, so a material stays in the same lighting path from frame to frame.

For a color-only screen, start with standard `WebgApp` and `SmoothShader` forward rendering. For a custom bloom or color edge effect, use the offscreen targets and individual passes in Chapters 23–25 and 34–36. Choose the deferred integrated pipeline for a screen sharing SSAO, shadows, SSR, and deferred lighting. The application makes this choice during initialization as part of its rendering design.

## Check the Minimal Execution Order First

The minimal integrated-pipeline flow is:

```text
await app.init()
  -> create ComputeEffectPipeline and the final presentation pass
  -> wait for pipeline.ready and presentation-pass initialization
  -> app.start()
       onBeforeDraw:
         pipeline.renderScene() generates the G-buffer
       onAfterDraw3d:
         gpu.endPass()
         pipeline.encode() records lighting and screen effects
         beginPresentPass() begins the final presentation pass
         draw the final texture to the Canvas
         clearDepthBuffer() prepares for the next frame
```

Pass the same frame's `cameraFrame` to `renderScene()` and `encode()`. Draw the final texture returned by `encode()` to the Canvas to display the pipeline result.

## Choose One Scene-Rendering Owner During Initialization

Initialization selects whether standard automatic forward rendering or the deferred integrated pipeline draws the scene, preventing both from drawing it. When the integrated pipeline owns rendering, set `autoDrawScene: false`. This keeps an independent forward draw from being inserted around G-buffer generation, and centralizes resource lifetime and frame order in the pipeline. Configure view angle, `near`, and `far` on `WebgApp` as usual so projection information is shared with each pass.

```js
import WebgApp from "./webg/WebgApp.js";
import ComputeEffectPipeline from "./webg/ComputeEffectPipeline.js";
import FullscreenPass from "./webg/FullscreenPass.js";

const app = new WebgApp({
  document,
  autoDrawScene: false,
  clearColor: [0.045, 0.065, 0.09, 1.0],
  viewAngle: 52,
  projectionNear: 0.1,
  projectionFar: 120,
  camera: {
    target: [0, -0.7, -4.0],
    distance: 27,
    yaw: 24,
    pitch: -13
  }
});
await app.init();

const gpu = app.getGPU();
const pipeline = new ComputeEffectPipeline(gpu, {
  width: app.screen.getWidth(),
  height: app.screen.getHeight(),
  lighting: {
    ambient: 0.10,
    directionalIntensity: 1.0
  },
  composer: {
    mode: "mix"
  },
  fog: {
    enabled: false,
    mode: "linear",
    color: [0.10, 0.15, 0.20],
    near: 20,
    far: 80,
    density: 0.03
  },
  toneMap: {
    mode: "reinhard",
    exposure: 1.0,
    saturation: 1.0,
    gamma: 2.2
  },
  vignette: {
    enabled: false,
    center: [0.5, 0.5],
    radius: 0.9,
    softness: 0.35,
    strength: 0.65,
    tint: [0.0, 0.0, 0.0]
  }
});

const copyPass = new FullscreenPass(gpu);
await Promise.all([pipeline.ready, copyPass.init()]);
```

`ComputeEffectPipeline` creates and manages each pass and its render targets: G-buffer, shadow maps, visibility, deferred lighting, HDR effects including fog, and display-color effects including tone mapping and vignette. The same pipeline manages resize and release.

Fog and vignette default to disabled so existing applications retain their display. The initialization above uses fixed ambient light rather than an environment map to keep the connection minimal. For the standard configuration with IBL and PBR SSR, use the environment settings in Chapter 31 and `book/examples/33_01.html`. That example runs from one HTML file without an external HDR image by using small procedural environment data for radiance, irradiance, prefiltered specular, and the BRDF LUT. The connection through `PbrEnvironment` is the same when using a photographed HDR image.

Constructor options `fog.enabled` and `vignette.enabled` set the pipeline's initial state and can be overridden by per-frame `encode()` options. The pipeline retains the render targets for `ComputeFogPass` and `ComputeVignettePass` while the effects are disabled. Disabled frames skip each pass's `encode()` call and its full-screen dispatch without recreating targets.

## Keep Rendering and Position Reconstruction on the Same Camera Frame

Sharing one camera frame aligns the view that drew the G-buffer with the view used to reconstruct positions from its depth. This keeps AO, shadows, and reflections aligned with geometry during camera motion; each pass receives `near`, `far`, and projection data from the shared `cameraFrame`.

The key integration rule is to pass the same `cameraFrame` object to `renderScene()` and `encode()`:

```js
app.start({
  onUpdate: ({ screen }) => {
    pipeline.resize(screen.getWidth(), screen.getHeight());
  },

  onBeforeDraw: ({ cameraFrame }) => {
    pipeline.renderScene(
      app.space,
      cameraFrame,
      app.clearColor,
      {
        shadowEnabled: true
      }
    );
  },

  onAfterDraw3d: ({ cameraFrame }) => {
    gpu.endPass();

    const finalColor = pipeline.encode(gpu.commandEncoder, {
      cameraFrame,
      ssaoEnabled: true,
      shadowEnabled: true,
      ssrEnabled: true,
      fogEnabled: false,
      toonEnabled: false,
      dofEnabled: false,
      bloomEnabled: false,
      edgeEnabled: false,
      vignetteEnabled: false
    });

    app.screen.beginPresentPass({
      clearColor: app.clearColor,
      colorLoadOp: "clear"
    });
    copyPass.draw(finalColor);
    app.screen.clearDepthBuffer();
  }
});
```

`cameraFrame` preserves a snapshot containing the camera world position for double-precision differences, camera-relative model-view support, Reverse-Z projection, `near`, `far`, view angle, and aspect ratio. `renderScene()` uses it to create the G-buffer; `encode()` uses the same frame to reconstruct positions from depth. Passing another object or a frame from another moment raises an error instead of mixing stale camera state.

When fog is enabled, `encode()` reconstructs distance from this camera frame and opaque G-buffer depth. Vignette does not read depth and does not use the camera frame directly; it runs later in the same `encode()` call and returns the completed display color. Each effect takes camera data from the shared frame where needed, while vignette operates only on the finished image.

### Choose Between a Frame Token and a Camera Frame

Use `renderFrameToken` or `cameraFrame` according to the shared rendering information required by the application. A deferred path receives the camera data needed for position reconstruction; a simple forward path remains lightweight.

The `renderFrameToken` exposed to ordinary samples is an identity token for manually connecting an offscreen scene, `Space.draw()`, and a depth-dependent pass such as shader-based DoF. The opaque token proves frame identity, while `cameraFrame` holds projection and camera orientation.

`ComputeEffectPipeline` manages G-buffer generation through downstream effects and validates camera consistency, so use the callback's `cameraFrame`. Choose the camera frame or token based on which object owns the depth- and projection-sharing sequence.

| Rendering configuration | Information supplied by the application |
|---|---|
| Standard single pass | Nothing additional |
| Low-level forward rendering | `Space.draw(eye)` |
| Manually connected shader-based DoF | The same `renderFrameToken` |
| `ComputeEffectPipeline` | The same `cameraFrame` |

Pass the token or frame from `onUpdate` to the drawing callbacks and share it only during those callbacks. Acquire a new frame before carrying work into another frame or asynchronous processing.

## Use a Complete G-buffer Material for Stable Lighting

G-buffer materials store base color and reflection properties before lighting, so deferred lighting and SSR can evaluate each Shape's surface consistently. Specify all required values explicitly: missing input then raises an error containing the property name, instead of silently changing material meaning between rendering paths.

The integrated pipeline uses base color and surface material before lighting. Set `specular`, `roughness`, `metallic`, and `occlusion` on each Shape. Set emission as an independent HDR color using `emissive_factor` and optional `emissive_texture`. When using the legacy scalar `emissive`, use one emission entry point consistently.

```js
function createPrimitiveShape(gpu, primitiveFactory, material) {
  const shape = new Shape(gpu);
  shape.applyPrimitiveAsset(
    primitiveFactory(shape.getPrimitiveOptions())
  );
  shape.endShape();
  shape.setMaterial("smooth-shader", {
    has_bone: 0,
    use_texture: 0,
    ambient: 0.0,
    occlusion: 1.0,
    emissive_factor: [0.0, 0.0, 0.0],
    ...material
  });
  return shape;
}

const sphere = createPrimitiveShape(
  app.getGPU(),
  (options) => Primitive.sphere(2.2, 32, 22, options),
  {
    color: [0.12, 0.62, 0.88, 1.0],
    specular: 0.72,
    roughness: 0.20,
    metallic: 0.12,
    power: 58.0
  }
);
```

If a required value is omitted, `GeometryBufferPass` stops during validation through `util.readFiniteNumber()`. This makes it possible to find missing input by Shape and property name. Do not use `color` alpha as a substitute for SSR reflectance; set reflection properties on the surface material.

## Automatically Integrate Transparency from Materials

With `ComputeEffectPipeline`, the pipeline connects the transparent rendering pass. It classifies triangles across all Shapes, including multiple material slots on one Shape, according to each slot's `alpha_mode`: opaque triangles, Alpha Mask triangles, and transparent triangles.

`OPAQUE` and `MASK` write to the G-buffer and opaque depth; `MASK` discards fragments below `alpha_cutoff`. `BLEND` is excluded from the G-buffer. If `alpha_mode` is omitted, `alpha === 1.0` is treated as `OPAQUE`, and alpha below 1.0 as `BLEND`.

Transparent triangles are collected across Shapes. The renderer first checks projected instance bounds to preserve batches where possible, then uses triangle-level back-to-front sorting for ambiguous overlaps. Drawing tests against opaque depth without writing transparent depth and uses source-over alpha blending. Chapter 25 describes the ordering strategy and its limits.

For frosted glass, the pipeline builds a 1/2, 1/4, and 1/8 image pyramid from the opaque HDR scene before transparency. Each level downsamples the previous one with a continuous low-pass filter. A mask containing the transparent material's `roughness` blends the sharp original scene with neighboring pyramid levels. Low roughness preserves a sharp background, and increasing roughness smoothly selects lower-resolution levels to increase blur.

This background blend uses background color and `roughness`, separate from the later application of `alpha` to the surface color and specular reflection. As a result, even lightly tinted glass can retain roughness-driven background blur.

```js
glassShape.setMaterial("smooth-shader", {
  color: [0.95, 0.78, 0.18, 1.0],
  alpha: 0.42,
  specular: 1.0,
  roughness: 0.18,
  metallic: 0.0,
  occlusion: 1.0,
  emissive_factor: [0.0, 0.0, 0.0],
  power: 128
});
```

At low `roughness`, the transmitted background is sharp and GGX reflection is narrow. At higher roughness, background blur and reflection spread increase. Transparent forward rendering uses the same `PbrBrdf.js` as opaque deferred rendering, evaluating direct light, local lights, shadows, and IBL from the same material values. Setting `alpha_mode` to `OPAQUE` moves the material to opaque PBR deferred rendering on the next frame. When `alpha_mode` is omitted, setting `alpha` to 1.0 has the same effect; both paths share the surface's bidirectional reflectance distribution function (BRDF).

Frames without transparent triangles skip the `TransparencyPass` blur, mask, and surface draw. When transparency is present, its additional work consists of a three-level image pyramid, roughness-mask rendering, background composition, and draw calls per transparent triangle. Overlapping triangles and cyclic ordering use back-to-front alpha composition. Weighted Blended Order-Independent Transparency (OIT) is a separate extension. Repeatedly blurring for multilayer transparent surfaces is outside this path.

See `samples/opacity` for alpha blending, `samples/transmission` for background refraction and volume absorption, and `book/examples/33_01.html` for the full PBR path.

## Keep Effect State in One Place for Safe Switching

Keeping effect state in one object lets a UI action or preset change feed consistent values to `renderScene()` and `encode()` in the same frame. It also prevents the shadow type or enabled state from changing between the start and end of a frame and makes current render conditions easier to save and compare. Pass state explicitly to `encode()` when switching effects at runtime.

```js
const state = {
  ssaoEnabled: true,
  shadowEnabled: true,
  ssrEnabled: true,
  fogEnabled: false,
  toonEnabled: false,
  dofEnabled: false,
  bloomEnabled: false,
  edgeEnabled: false,
  vignetteEnabled: false,
  fogMode: "linear",
  fogColor: [0.10, 0.15, 0.20],
  fogNear: 20.0,
  fogFar: 80.0,
  fogDensity: 0.03,
  vignetteCenter: [0.5, 0.5],
  vignetteRadius: 0.9,
  vignetteSoftness: 0.35,
  vignetteStrength: 0.65,
  vignetteTint: [0.0, 0.0, 0.0],
  composerMode: "mix",
  toneMode: "reinhard",
  exposure: 1.0,
  saturation: 1.0,
  gamma: 2.2
};

const finalColor = pipeline.encode(gpu.commandEncoder, {
  cameraFrame,
  ssaoEnabled: state.ssaoEnabled,
  shadowEnabled: state.shadowEnabled,
  ssrEnabled: state.ssrEnabled,
  fogEnabled: state.fogEnabled,
  toonEnabled: state.toonEnabled,
  dofEnabled: state.dofEnabled,
  bloomEnabled: state.bloomEnabled,
  edgeEnabled: state.edgeEnabled,
  vignetteEnabled: state.vignetteEnabled,
  fog: {
    mode: state.fogMode,
    color: state.fogColor,
    near: state.fogNear,
    far: state.fogFar,
    density: state.fogDensity
  },
  vignette: {
    center: state.vignetteCenter,
    radius: state.vignetteRadius,
    softness: state.vignetteSoftness,
    strength: state.vignetteStrength,
    tint: state.vignetteTint
  },
  composer: {
    mode: state.composerMode
  },
  toneMap: {
    mode: state.toneMode,
    exposure: state.exposure,
    saturation: state.saturation,
    gamma: state.gamma
  }
});
```

Shadows also control shadow-map generation before the G-buffer, so keep `shadowEnabled` consistent between `renderScene()` and `encode()`. Keep the directional or spot-light type consistent in both stages too. The integrated pipeline detects mismatches and raises an error.

The pipeline retains generated GPU resources while effects such as SSAO, SSR, fog, DoF, bloom, and vignette are disabled. It skips each effect's frame path, so switching an effect on or off does not require recreating its target.

Enable fog with `fogEnabled` or `fog.enabled`, and vignette with `vignetteEnabled` or `vignette.enabled`. If both forms are supplied, the top-level `fogEnabled` and `vignetteEnabled` values define the state for that frame. Group detailed effect settings under `fog` and `vignette`. Building both enable states and numeric values from the same state object keeps UI changes consistent.

### Keep Fog in One Pass After Transparency

Integrated fog runs after deferred lighting and SSR are combined and after `TransparencyPass` composites transparent triangles. Both input and output use `rgba16float`. Toon, DoF, bloom, and tone mapping can then process one HDR scene containing opaque surfaces, reflections, transparency, and fog.

Fog distance uses only opaque G-buffer depth. Transparent surfaces are absent from the G-buffer and do not replace depth during transparent rendering, so pixels through glass use the distance to the opaque surface behind it. If no opaque surface exists behind the transparent object and Reverse-Z depth is the background value 0, the pipeline preserves the already composited transparent color rather than estimating a distance. This is a full-screen approximation based on one opaque depth value; check its appearance for scenes with multiple transparent layers.

With `mode: "linear"`, fog increases across the distance range from `near` to `far`. With `mode: "exp"`, visibility decreases exponentially according to `density` and distance. `far` must be greater than `near`. The `ComputeFogPass` in Chapters 34–36 explains these settings and defaults; the integrated pipeline uses the same pass implementation and validation.

When migrating from forward rendering to deferred rendering, move fog settings under `fog` and let `ComputeEffectPipeline` own fog for the integrated scene. Applying both forward fog and full-screen fog would apply distance falloff twice and split responsibility between opaque and transparent surfaces.

### Apply Vignette Immediately Before Presentation

Integrated vignette runs on `rgba8unorm` display color after tone mapping and optional edge detection. It becomes the final texture returned by `encode()`. The application transfers it to the Canvas with `beginPresentPass()` and then calls `clearDepthBuffer()` before a depth-tested HUD pass.

This placement adjusts the whole 3D scene and edge-detection result, while `Font` and HUD elements drawn afterward retain readable brightness. An artistic effect that darkens the HUD too needs an offscreen design that composites the HUD with the scene. The standard `ComputeEffectPipeline` keeps HUD outside vignette and draws it last for readability.

Vignette uses the finished color and screen dimensions, independently of depth and camera-frame effects. Its options are `center`, `radius`, `softness`, `strength`, and `tint`; the pass compensates for aspect ratio internally. If an application already applies its own vignette before presentation, move its settings into the pipeline and remove the extra pass, or disable pipeline vignette so it is applied once.

### Tune Effects in Order of Responsibility

Keeping a fixed tuning order makes it clear whether lighting, visibility, reflection, or display conversion changed the image. Changing one value at a time helps distinguish a lighting problem from a reflection or tone-mapping problem. First establish base color and brightness with deferred lighting alone, then add visibility, reflections, focus, glow, and display conversion.

1. Set a reference image with SSAO and shadows disabled, adjusting `lighting.ambient` and light intensity.
2. Enable shadows and tune light direction, projection bounds, `bias`, and `normalBias`.
3. Enable SSAO and set `radius` and `strength` so it supports contact and gaps.
4. Enable SSR; check material `specular` and `roughness`, then tune `intensity`, `distance`, and `thickness`.
5. Enable fog in a scene with transparent surfaces; adjust `mode`, `color`, distance range, or `density`, and assess the single opaque-depth approximation.
6. Add toon shading, DoF, or bloom only where needed. Inspect them while their results remain in HDR.
7. Set tone-map `exposure`, `saturation`, and `gamma`, then add edge detection if needed.
8. Finish with vignette center, radius, transition width, strength, and edge color; verify HUD readability.

This order avoids hiding weak lighting with tone-map `exposure` or compensating for a shadow projection range with SSAO `strength`. The reference scene should remain intact when effects are disabled.

## Summary

`ComputeEffectPipeline` connects PBR lighting and screen effects through the same `cameraFrame`, depth conventions, and color formats. Start with the reference scene, add effects one at a time, and inspect each stage's inputs and outputs to distinguish configuration issues from ordering issues. Chapter 33 covers camera-relative coordinates, resources, diagnostics, and performance tuning for ongoing use.
