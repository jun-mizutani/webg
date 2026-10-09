# Post-Processing Basics

This chapter saves an image produced by standard forward rendering to an off-screen texture, then manually connects a fragment-shader post-process. It applies a vignette to a completed 3D image and displays the result on the canvas. The goal is to understand the basic pass order and connections without compute shaders or the integrated pipeline in Chapters 31–33.

This approach remains useful when adding one effect to standard forward rendering or learning the relationship between render passes and textures in a small setup. Passing color or depth from one render stage to another is also a foundation for deferred rendering, where G-buffers store surface data for later lighting and screen-space effects.

Image processing can also use compute shaders, as covered in Chapters 20–22. For PBR applications, `ComputeEffectPipeline` in Chapters 31–33 manages lighting on linear HDR, transparent surfaces, screen-space effects, and final presentation in one sequence. This chapter explains the separated rendering and manual connections that lead to those approaches.

## How to read this chapter

### Prerequisites

This chapter is easier to follow if you know render targets from Chapter 4 and frame processing from Chapter 5.

### What to read first

Start with rendered images, separating post-processing from forward rendering, `autoDrawScene`, and the basic frame cycle.

### What to read when you need it

Refer to HUD composition, depth reinitialization, individual passes, and `ComputeEffectPipeline` while implementing an effect.

### What you will learn

You will be able to separate scene rendering from full-screen post-processing and connect passes with attention to image inputs, outputs, and order.

## Apply an Effect to a Rendered Image

Post-processing takes the scene image as a texture and changes its appearance across the screen. This chapter uses a vignette, which darkens the screen edges to draw attention toward the center, to introduce off-screen rendering and a full-screen pass. Bloom, depth of field, and frosted glass need their own intermediate images or depth data, so Chapters 24–25 extend this flow for those effects.

Effects such as bloom, depth of field, and frosted glass draw the full scene into an off-screen buffer, process it through a full-screen pass, and output it to the canvas. This separates effects on individual objects from those that take the entire image as input.

The implementation here centers on `RenderTarget` and `VignettePass`. Chapter 24 applies the same connection approach to bloom and DoF; Chapter 25 expands it to transparency.

## Separate Post-Processing from Forward Rendering

In ordinary forward rendering, each `Shape` vertex is transformed to clip space, rasterization creates pixel candidates, and the fragment shader computes the lit color. Writing that color directly to the canvas completes the frame in one drawing pass.

To add post-processing, change the fragment output destination from the canvas to a `RenderTarget`. A later render pass samples the saved image as a texture and draws a full-screen triangle to create a new image.

```text
Shape vertices
  -> vertex shader
  -> rasterization
  -> fragment shader
  -> off-screen color and depth textures
  -> full-screen vertex and fragment shaders
  -> canvas
```

The first fragment shader completes each shape's color; the later fragment shader processes the completed image. Rather than inspecting individual triangles or materials, the later pass reads screen data such as the color texture, depth texture, and any masks it needs.

Deferred rendering also stores the initial result in textures for later use. The difference is that post-processing modifies the completed lit color, while deferred rendering stores pre-lighting data—base color, normals, roughness, metalness, depth, and other attributes—in G-buffers, then calculates PBR lighting in a later pass. This chapter first teaches the general idea of passing textures between render passes and specifying order and inputs.

### Choose Among Three `webg` Setups

Choose a setup that matches the task:

**Standard forward rendering with manual fragment-shader composition**

Use it to add an individual effect to a simple screen or learn off-screen rendering. See this chapter.

**Individual compute passes**

Use them to implement image processing with compute shaders and connect several GPU operations. See Chapters 20–22 and 34–36.

**Integrated PBR rendering**

Use it to share G-buffers, PBR lighting, IBL, transparent surfaces, and multiple screen-space effects. See Chapter 30 and Chapters 31–33.

The `VignettePass` in this chapter uses a render shader. Integrated PBR rendering applies `ComputeVignettePass` to display color after tone mapping. Even when two passes have the same effect name, their inputs and management differ between manual and integrated setups. Chapter 24 discusses the input stages for bloom and DoF.

## Post-Processing Concepts and Render Flow

Post-processing acts on the complete screen after drawing, rather than changing each object's shader. First draw the 3D scene to an off-screen target. Then use a full-screen pass to read and process its color or depth texture.

If this flow is unclear, problems such as “bloom has no visible effect” or “DoF cannot read depth” are difficult to diagnose. Establish the common render flow first.

![Post-processing render flow](../book/img/fig20_01_postprocess_flow.jpg)

*Post-processing first renders the scene off screen, processes the result, and then draws the HUD over it.*

### Control Scene Drawing with `autoDrawScene: false`

By default, `WebgApp` draws the scene directly to the canvas. Post-processing needs a point in the frame before that output, so set `autoDrawScene: false` to take control of drawing timing.

### Basic Frame Cycle

Complete these three steps within each frame:

1. `beginScene()`: Select an off-screen render target and prepare to draw the scene.
2. `app.space.draw(app.eye)`: Draw the scene normally for a color-only pass. For DoF, which shares depth with later passes, pass the same callback's `renderFrameToken`.
3. `render()`: Process the rendered texture and output the final result to the canvas.

Here is a complete connection:

```js
import WebgApp from "./webg/WebgApp.js";
import Shape from "./webg/Shape.js";
import SmoothShader from "./webg/SmoothShader.js";
import { FULLSCREEN_SOURCE_FORMAT } from "./webg/FullscreenPass.js";
import VignettePass from "./webg/VignettePass.js";

const app = new WebgApp({
  document,
  messageFontTexture: "./webg/font512.png",
  autoDrawScene: false
});
await app.init();

// Match the 3D color format to the input format required by VignettePass.
const sceneShader = new SmoothShader(app.getGPU(), {
  colorFormat: FULLSCREEN_SOURCE_FORMAT
});
await sceneShader.init();
app.shader = sceneShader;
Shape.prototype.shader = sceneShader;
sceneShader.setLightPosition(app.lightPosition);
sceneShader.setProjectionMatrix(app.projectionMatrix);

// The VignettePass input is display color in rgba8unorm.
const sceneTarget = app.screen.createRenderTarget({
  label: "my-scene",
  format: FULLSCREEN_SOURCE_FORMAT,
  hasDepth: true
});
await sceneTarget.ready;

const vignette = new VignettePass(app.getGPU(), {
  centerX: 0.5,
  centerY: 0.5,
  radius: 0.60,
  softness: 0.30,
  strength: 0.70,
  tint: [0.0, 0.0, 0.0, 1.0]
});
await vignette.init();

app.start({
  onUpdate: ({ screen }) => {
    sceneTarget.resizeToScreen(screen);
  },
  onBeforeDraw: () => {
    // Stage 1: Draw the 3D scene into a color and depth RenderTarget.
    app.screen.clear(sceneTarget);
    // Stage 2: Draw the space into the off-screen RenderTarget.
    app.space.draw(app.eye);
  },
  onAfterDraw3d: () => {
    // Stage 3: Apply the vignette to the scene image and present it.
    vignette.render(app.screen, {
      source: sceneTarget,
      clearColor: app.clearColor
    });

    // Clear scene depth before composing the HUD.
    app.screen.clearDepthBuffer();
  }
});
```

The 3D draw calls still come from `app.space.draw(app.eye)`. A later pass such as `VignettePass` receives the rendered texture and applies the effect.

### Compose the HUD

To keep `Message` or a debug overlay visible after post-processing, call `app.screen.clearDepthBuffer()` after the final pass. Otherwise, depth written during post-processing can cause a later HUD to fail the depth test. This is part of controlling the render flow.

## Implement and Use `VignettePass`

Use `VignettePass` to darken the edges and draw attention toward the screen center. It reads one display-color texture and blends `tint` into the edge according to distance from the center. Unlike bloom or DoF, it needs only one input image.

### Role and Parameters

`VignettePass` takes a color texture and adjusts the screen edges. The application draws the scene into a `RenderTarget` and passes its color texture to `render({ source })`. The scene depth is used by the preceding 3D draw; the vignette reads color only.

`radius` is the outer distance where edge falloff begins; `softness` is the width of the transition from the center; `strength` controls how much `tint` is blended. Large values can darken the center as well as the edges, so keep the main content visible.

### Color Format

`VignettePass` expects display color in `rgba8unorm`. The canvas format can differ, so set `sceneTarget.format` to `FULLSCREEN_SOURCE_FORMAT`. Configure the `SmoothShader` drawing into that target with the same format. A mismatch between the 3D shader, `RenderTarget`, and later pass can stop pipeline creation or drawing validation. Specify matching formats at connection time.

### Relationship to the Next Chapters

The flow from this chapter—draw into a `RenderTarget`, process through a full-screen pass, then output to the canvas—is also used in Chapter 24. Bloom adds targets for bright-region extraction and blur. DoF also needs Reverse-Z depth and a shared `renderFrameToken`. Chapter 25 adds transparency masks and background images.

## Summary

Post-processing saves the completed 3D scene to a texture, applies effects in order, and presents the result. Check each pass's input and output formats, transfer the final image to the canvas, and reset depth before drawing the HUD when needed.

After confirming the basic flow with color-only `VignettePass`, continue to bloom and DoF in Chapter 24 and transparency and finishing effects in Chapter 25.
