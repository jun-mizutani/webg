# Transparency and Screen Finishing

This chapter builds frosted glass by combining a rendered background, a blurred copy, and a mask identifying the glass region. It then explains how this manual setup relates to ordinary alpha blending and the automatic transparency path in integrated PBR rendering.

## How to read this chapter

### Prerequisites

This chapter is easier to follow if you know materials from Chapter 7 and post-processing from Chapter 23.

### What to read first

Start with transparent triangles, `FrostedGlassPass`, and the basic manual setup. Chapter 23 covers the basics of `VignettePass`.

### What to read when you need it

Refer to PBR transparency, transmission, transparent depth, and `ComputeEffectPipeline` when working on PBR rendering.

### What you will learn

You will be able to add transparent surfaces, PBR transparency, and frosted glass at the appropriate input format and processing stage.

## Implement and Use `FrostedGlassPass`

`FrostedGlassPass` is a low-level post-process for manually adding frosted glass to forward rendering. Chapter 23 covers `VignettePass` for darkening the screen edges; this chapter focuses on transparent surfaces.

In PBR rendering with `ComputeEffectPipeline`, the internal `TransparencyPass` handles transparent surfaces from material inputs such as `alpha_mode`, `alpha`, and `roughness`. A material with transmission also evaluates surface reflection, refraction, total internal reflection, and Beer–Lambert absorption based on thickness in the same transparency path. `FrostedGlassPass` is the separate path for forward rendering.

Lowering a material's alpha and drawing it with alpha blending is sufficient for some transparent effects. For frosted glass, however, the scene behind the surface must appear blurred. It is not enough to show the glass shape's color; first capture and blur the background scene as a texture, then composite the result only where the glass overlaps it.

`FrostedGlassPass` implements this as a post-process that combines three inputs: the opaque scene, its blurred version, and a mask for the glass region. Instead of regular shading, glass shapes draw with `GlassMaskShader` into the mask target. Mask alpha controls the amount of blur; RGB provides the tint added to the final color.

This structure handles opaque objects in front of the glass naturally. `FrostedGlassPass.beginMask()` preserves the opaque scene's depth buffer while drawing the mask. An object in front of the glass therefore occludes that part of the mask.

### Processing Flow

One frame with `FrostedGlassPass` has three stages:

1. `beginScene()`: Draw the opaque scene, excluding glass shapes.
2. `beginMask()`: Draw only glass shapes with `GlassMaskShader` into the mask target.
3. `render()`: Blur the scene and composite the original scene, blurred scene, and mask.

The same scene graph (`Space`) is used for each stage. Control the shapes included in each draw with `Space.draw(eye, { filter })`.

### Example

This implementation follows the structure of `unittest/translucent`:

```js
import WebgApp from "./webg/WebgApp.js";
import Shape from "./webg/Shape.js";
import Primitive from "./webg/Primitive.js";
import FrostedGlassPass from "./webg/FrostedGlassPass.js";
import GlassMaskShader from "./webg/GlassMaskShader.js";

const GLASS_MATERIAL_ID = "frosted-glass";

const app = new WebgApp({
  document,
  messageFontTexture: "./webg/font512.png",
  autoDrawScene: false
});
await app.init();

const glassMaskShader = new GlassMaskShader(app.getGPU(), {
  targetFormat: app.getGPU().format,
  cullMode: "none"
});
await glassMaskShader.init();
glassMaskShader.setProjectionMatrix(app.projectionMatrix);

const frosted = new FrostedGlassPass(app.getGPU(), {
  sceneFormat: app.getGPU().format,
  canvasFormat: app.getGPU().format,
  blurRadius: 2.8,
  blurScale: 0.5,
  blurIterations: 2,
  blurStrength: 0.9,
  tintStrength: 0.28,
  maskPower: 0.9
});
await frosted.ready;

const isGlassShape = (shape) => {
  return shape?.materialId === GLASS_MATERIAL_ID ||
    shape?.shaderParam?.frosted_glass === true ||
    shape?.shaderParam?.frosted_glass === 1;
};

const glassShape = new Shape(app.getGPU());
glassShape.applyPrimitiveAsset(Primitive.cuboid(60.0, 38.0, 0.8));
glassShape.endShape();
glassShape.setShader(glassMaskShader);
glassShape.setMaterial(GLASS_MATERIAL_ID, {
  frosted_glass: true,
  color: [0.78, 0.76, 0.68, 0.74]
});

const glassNode = app.space.addNode(null, "glass");
glassNode.setPosition(0.0, 2.0, -24.0);
glassNode.addShape(glassShape);

app.start({
  onUpdate: ({ screen }) => {
    glassMaskShader.setProjectionMatrix(app.projectionMatrix);
    frosted.resizeToScreen(screen);
  },
  onBeforeDraw: () => {
    // 1. Draw the opaque scene while filtering out glass.
    frosted.beginScene(app.screen, app.clearColor);
    app.space.draw(app.eye, {
      filter: ({ shape }) => !isGlassShape(shape)
    });

    // 2. Draw the mask for glass shapes only.
    frosted.beginMask(app.screen);
    app.space.draw(app.eye, {
      filter: ({ shape }) => isGlassShape(shape)
    });
  },
  onAfterDraw3d: () => {
    // 3. Composite and present the result.
    frosted.render(app.screen, {
      clearColor: app.clearColor
    });
    app.screen.clearDepthBuffer();
  }
});
```

Notice the call to `glassShape.setShader(glassMaskShader)`. The glass shape writes “glass is present here” to the mask target rather than drawing its usual material appearance. RGB from `color` is the tint, and alpha controls the blur mix.

### Adjust Parameters

The frosted-glass parameters control how strongly the background is blurred, how much of the glass color remains, and how the mask boundary looks. Compare the scene, mask, and blur outputs while changing one value at a time to distinguish weak blur from an incorrect mask.

- `blurRadius`: Controls the spacing between blur samples; larger values make the background less distinct.
- `blurIterations`: Number of blur passes; more iterations smooth the result and add drawing cost.
- `blurScale`: Resolution scale for blur targets. `0.5` uses half resolution, reducing work and sometimes producing a softer result.
- `blurStrength`: Mix amount between the original and blurred scene in the mask area.
- `tintStrength`: How strongly the mask RGB affects final output.
- `maskPower`: Exponent applied to the mask alpha.

### Debugging and Usage

Switch among intermediate targets (`scene`, `mask`, and `blur`) while tuning. This separates blur filtering issues from depth and mask issues.

`FrostedGlassPass` is a manual compositing pass for showing a blurred background. It is not a general system for drawing every transparent polygon in depth order. For ordinary transparency, set material `alpha_mode` to `BLEND`; `Space.draw()` gathers triangles from shapes and draws them back to front. If `alpha_mode` is omitted, an `alpha` below 1.0 is treated as `BLEND`. In `ComputeEffectPipeline`, `TransparencyPass` composites the same classification into the HDR scene.

## Transparency Moves to a Later Pass in Integrated PBR Rendering

In this chapter's manual `FrostedGlassPass` setup, the application prepares the opaque scene, blurred image, and glass-region mask before adding frosted glass after forward rendering. This is one example of creating a separate mask and using it as a later compositing condition. Deferred rendering similarly prepares images for later passes, though it stores base color, normals, and other G-buffer data instead.

Integrated PBR rendering classifies transparent surfaces through material `alpha_mode`. `OPAQUE` and `MASK` go to the opaque G-buffer; `BLEND` goes to later forward transparency rendering. The opaque G-buffer retains depth and surface data for the opaque surface behind the transparent one. When `alpha_mode` is omitted, `alpha === 1.0` is treated as `OPAQUE` and values below 1.0 as `BLEND`.

`ComputeEffectPipeline.encode()` runs its internal `TransparencyPass` after PBR deferred lighting and SSR only when transparent triangles are present. Opaque surfaces use deferred lighting from the G-buffer; transparent surfaces use forward rendering with the same PBR BRDF, `PbrBrdf.js`. The rendering method differs while the lighting model stays consistent.

```text
Opaque G-buffer
  -> PBR direct light and IBL
  -> SSR screen-space reflections
  -> blurred background for transparency
  -> back-to-front transparent PBR surfaces and transmission
  -> Fog / Toon / DoF / Bloom
  -> Tone Mapping / Edge / Vignette
```

For roughness-based background blur, the pass selects sharp, medium, or strong blur based on `roughness`. Direct lighting, IBL, and Fresnel reflection for transparent surfaces use `PbrForwardShader` and the same `PbrBrdf.js` as opaque lighting. With transmission enabled, the pass traces a refracted ray from the entry surface into the object and refracts again from the exit surface toward air to find the background. When thickness and an absorption coefficient are provided, it calculates Beer–Lambert absorption from the distance traveled inside the material.

```js
glassShape.setMaterial("smooth-shader", {
  color: [0.95, 0.78, 0.18, 1.0],
  alpha_mode: "BLEND",
  alpha: 0.42,
  specular: 1.0,
  roughness: 0.18,
  metallic: 0.0,
  occlusion: 1.0,
  emissive_factor: [0.0, 0.0, 0.0]
});
```

The application specifies the transparent material settings instead of inserting a transparency render pass or `FrostedGlassPass` into `ComputeEffectPipeline`. The integrated pipeline detects transparent surfaces and connects background blur, masks, and transparent-surface drawing in its defined order. This offers one entry point for the passes assembled manually in this chapter.

Transparent triangle ordering first compares projected instance bounds, then rechecks overlapping candidates with tight projected bounds derived from actual vertices. Small overlaps with a shorter side of 8 pixels or less are treated as independent draws, and batches are preserved for instances that do not interfere. Only ambiguous front-to-back relationships require global triangle-level sorting, balancing stable order with CPU work.

Screen-space transmission approximates refraction using background and opaque depth information available within the screen. It does not fully solve off-screen backgrounds, intersections behind opaque depth, cyclic ordering where transparent triangles cross, or complete multi-layer refraction through several transparent objects. Configure fallback behavior when the background is unavailable and the desired processing order. Chapters 31–33 and `samples/transmission` cover PBR transparency and transmission inputs. See `samples/opacity` for ordinary alpha blending.

## Shared Components Behind Post-Processing

These common components support the effects in this chapter:

- `RenderTarget`: The off-screen destination that provides a foundation for post-processing.
- `FullscreenPass`: A minimal helper for displaying one texture in the current pass; useful for debug views and comparisons with the unprocessed scene.
- `SeparableBlurPass`: Efficiently performs Gaussian-style blur by alternating horizontal and vertical passes (ping-pong processing). Used internally by `BloomPass`, `DofPass`, and `FrostedGlassPass`.

These components use render passes, but the ideas of separating input images, output images, and processing order also apply to compute passes. Chapters 20–22 explain writing the result to a storage texture with a compute shader operating in workgroups.

## Choose an Integration Pattern

To learn manual post-processing with fragment shaders, begin with `VignettePass` in Chapter 23 and continue with `BloomPass` in Chapter 24. Both make it easy to follow the “off-screen → full-screen → canvas” flow without the more complex depth reconstruction used by DoF.

`DofPass` depends on camera `near` / `far` and other camera settings. Pass the same callback's `renderFrameToken` to the scene and composition. Use the camera frame in the token as the basis for distance reconstruction instead of duplicating near and far as separate options.

With standalone `FrostedGlassPass`, the application chooses which shapes to draw into the mask. `ComputeEffectPipeline` automatically selects triangles whose material `alpha_mode` is `BLEND`; when it is omitted, triangles with `alpha < 1.0` are selected.

For a new PBR application, begin with materials and environment lighting in Chapter 30, then enable the needed effects through `ComputeEffectPipeline` in Chapters 31–33. Choose this chapter's manual setup for one custom image effect or a small forward-rendered application that does not use compute shaders.

## Troubleshooting

- **No visible change**: Check that `autoDrawScene: false` is set; otherwise the scene draws directly to the canvas and skips the post-process.
- **Resolution mismatch after resize**: Call `resizeToScreen(screen)` from `onUpdate()` so the off-screen target matches the canvas.
- **DoF looks incorrect**: Pass the same callback's `renderFrameToken` to `beginScene()`, `Space.draw()`, and `DofPass.render()`. Then view `depth` and `focusMask` to check that depth from the same camera frame is used and that the intended region is in focus.
- **HUD is missing**: Call `app.screen.clearDepthBuffer()` after the final pass. Otherwise, depth written during post-processing can reject the HUD.
- **Glass is missing in `FrostedGlassPass`**: Check that the `filter` conditions for the opaque scene and mask passes are opposite, and update `GlassMaskShader` with the same projection matrix as the regular shader.

## Related Samples and Tests

Samples show the complete controls and intermediate targets; tests help preserve API behavior and numeric conditions as the implementation changes.

- Fragment-shader bloom: `samples/bloom` shows parameter controls, the debug dock, and `extractHeat` for a manual forward-rendering connection.
- Fragment-shader DoF: `samples/dof` shows the focus guide, depth debugging, focus and stage masks, and the three blur levels.
- Minimal frosted-glass test: `unittest/translucent` compares the opaque scene, blur, mask, and composite for `FrostedGlassPass` and `GlassMaskShader`.
- Minimal vignette test: `unittest/vignette` shows the relationship among `RenderTarget`, `FullscreenPass`, and `VignettePass` from Chapter 23.
- Compute bloom uses image-pyramid stages to spread the glow; compute DoF separates coverage and CoC to select blur stages.
- PBR transparency and refraction: `samples/transmission` covers PBR transparency, refraction, total internal reflection, absorption, and missing-background behavior.
- Integrated PBR example: `book/examples/33_01.html` shows the sequence from G-buffer and IBL through transparent surfaces, fog, bloom, and tone mapping.

## Summary

Fragment-shader post-processing stores the completed color from forward rendering in an off-screen target instead of the canvas. Later full-screen render passes read color, depth, and masks to produce the final display.

The vignette in Chapter 23 and bloom in Chapter 24 show how to pass color textures between render passes. DoF connects the scene and depth-dependent pass through one `renderFrameToken`; frosted glass passes a separate mask to later composition. Preparing required information in an earlier stage and evaluating it later also helps explain G-buffer-based deferred rendering.

The compute shaders described in Chapters 20–22 process images through storage textures and workgroups rather than relying on a full-screen triangle. In PBR rendering, `ComputeEffectPipeline` manages G-buffers, PBR lighting, transparency, DoF, bloom, tone mapping, and vignette in the appropriate color space and order. This chapter's manual setup is both an implementation path without compute shaders and a foundation for understanding what the integrated pipeline manages.

When the HUD is drawn after the final pass, call `app.screen.clearDepthBuffer()` first to prepare the depth state.
