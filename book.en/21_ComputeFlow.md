# Connecting Compute Work

This chapter turns the compute model from Chapter 20 into executable passes. You will create input and output resources, encode compute commands, and connect their results to rendering. Choose whether computation updates scene state before drawing or processes an image after drawing.

## How to read this chapter

### Prerequisites

This chapter is easier to follow if you know the role of compute shaders from Chapter 20 and the frame flow of `WebgApp` from Chapter 5.

### What to read first

Start with the four assumptions about resources, coordinates, depth, and color formats, then read the Render-first and Compute-first flows and `ComputePass`.

### What to read when you need it

Refer to the minimal image-processing example, storage textures, storage buffers, and handoff to rendering during implementation.

### What you will learn

You will be able to define compute inputs and outputs and integrate them into WebGPU command processing.

## Confirm Four Assumptions Before Connecting a Pass

Before connecting a compute shader to rendering, define four things in addition to the GPU (Graphics Processing Unit) calculation: which object creates, owns, and destroys resources; the coordinate space; the depth convention; and the color space. For example, whether particle positions in a storage buffer are world-space or camera-relative, and whether a storage texture contains linear HDR (High Dynamic Range) or display-oriented 8-bit color, can change whether a resource can be connected even when the WGSL types are the same.

Color-only processing that does not read camera depth, a vignette, and an independent buffer simulation can use color and dimensions as inputs. Pass `CameraFrame` or `renderFrameToken` to processing that shares camera depth and position reconstruction. SSAO (Screen Space Ambient Occlusion), SSR (Screen Space Reflections), fog, DoF (Depth of Field), contact shadows, and shape-edge extraction reconstruct positions from the G-buffer depth and need the projection from the same camera frame. Decide based on shared depth and projection, not on whether a compute shader is involved.

Choose formats according to the data's meaning: `rgba16float` for a high-dynamic-range intermediate target, or `rgba8unorm` for visibility and masks in the 0–1 range. Avoid applying gamma, exposure, or clipping to 0–1 more than once in intermediate passes. Apply the display transform once in final tone mapping.

## Compare Render and Compute Pipelines

The distinction between rendering and compute pipelines helps decide whether vertices and fragments naturally define the work or whether the application should dispatch an arbitrary number of elements. Choose the entry point that matches the goal and write directly to the resource that should hold the result. Both pipelines run on the GPU but start different units of work.

A vertex shader receives a vertex buffer, runs once per vertex, and outputs a clip-space vertex position. A fragment shader receives rasterized geometry, runs for each candidate pixel, and outputs to a color attachment. These stages run inside a render pipeline that includes triangle drawing and depth testing.

A compute shader receives arbitrary buffers or textures, runs in workgroups specified through `dispatchWorkgroups()`, and writes to storage buffers or storage textures. It executes as a separate compute pipeline. For full-screen processing, a `FullscreenPass` uses geometry that covers the screen instead of a triangle mesh defined by the scene. JavaScript explicitly dispatches the amount of data to process: the number of screen pixels for a screen effect or the number of particles for a simulation.

## Compute Execution Model

Three concepts control compute execution: **invocation**, **workgroup**, and **dispatch**.

- **Invocation**: One execution of the shader function. A screen pass often maps one invocation to one pixel; a particle pass maps one to one particle.
- **Workgroup**: A set of invocations managed together by the GPU.
- **Dispatch**: The operation that launches the required number of workgroups.

Here is a basic whole-image shader:

```wgsl
@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  let coord = vec2<i32>(id.xy);
  // coord is the pixel coordinate handled by this invocation.
}
```

`@workgroup_size(8, 8, 1)` gives each workgroup 8 × 8 × 1 = 64 invocations. For a 1280 × 720 image, compute each dispatch dimension in JavaScript and round up:

```js
pass.dispatchWorkgroups(
  Math.ceil(width / 8),
  Math.ceil(height / 8),
  1
);
```

Since image dimensions can have any value, the final workgroup may extend beyond the image. Include a WGSL bounds check before accessing the output:

```wgsl
let size = textureDimensions(outputTexture);
if (id.x >= size.x || id.y >= size.y) {
  return;
}
```

The guard prevents out-of-range storage-texture or storage-buffer access that could otherwise cause WebGPU validation errors or undefined results.

## Storage Textures and Storage Buffers

A compute shader writes results to either a storage texture or a storage buffer.

A storage texture is an image that a compute shader can write directly with `textureStore()`:

```wgsl
@group(0) @binding(1)
var outputTexture : texture_storage_2d<rgba8unorm, write>;

// Write one pixel.
textureStore(outputTexture, coord, vec4f(color, 1.0));
```

A storage buffer is a general-purpose resource for structures and arrays. Use it for particle or physics state that is organized as elements rather than as pixels:

```wgsl
struct Particle {
  positionLife : vec4f,
  velocitySize : vec4f,
};

@group(0) @binding(0)
var<storage, read_write> particles : array<Particle>;
```

Plan carefully when a dispatch uses one resource as both input and output. If one invocation changes a value before another invocation reads it, the result depends on GPU scheduling, creating a data race. For blur, cloth simulation, and other updates that read a previous state and write a next state, use two resources alternately in a ping-pong arrangement.

## Two GPU Processing Flows

Compute use in `webg` follows two broad flows: **Render-first** (process after drawing) and **Compute-first** (compute before drawing).

### Render-first

Draw the 3D scene to a render target first, then process its image or depth with compute. Bloom, fog, DoF, SSAO, deferred lighting, SSR, and vignette use this flow.

```text
3D scene render pass
  -> compute pass (apply effect)
  -> FullscreenPass (copy to screen)
  -> canvas
```

Keep the standard `WebgApp.frame()` flow and insert work with `onBeforeDraw` and `onAfterDraw3d`.

For Render-first processing, distinguish colors inside the GPU from the colors shown on the canvas. Lighting, shadows, SSAO, SSR, fog, and bloom normally operate on linear colors, where light can be added and multiplied correctly. Immediately before display, tone-map bright values into the display range and convert them to sRGB. Applying this transform once avoids a doubled conversion that lifts dark areas and a missed conversion that dulls colors.

`ComputeEffectToneMapPass` supports `reinhard` and `linear` tone mapping. `reinhard` smoothly compresses strong light and helps control clipping in reflective or bloom-heavy scenes. `linear` preserves values with minimal reshaping while bringing them into range; it is useful for inspecting vivid source color or scenes whose brightness is already controlled.

Key display-transform parameters are `exposure`, `saturation`, and `gamma`. `exposure` multiplies linear HDR color before tone mapping to adjust overall light. `saturation` controls interpolation with luminance in the display color after sRGB conversion.

`gamma` is an additional brightness adjustment after tone mapping rather than a simple power approximation of the sRGB conversion. `ComputeEffectToneMapPass` first applies the exact sRGB transfer function, including its linear dark range and 2.4-power bright range. It then applies `pow(srgbColor, 2.2 / gamma)` as an intentional display adjustment. With `gamma: 2.2`, the extra power is the identity, leaving standard sRGB values. Other values adjust the displayed brightness; they do not select a display-device encoding.

Tone mapping takes linear HDR input in `rgba16float` and produces display sRGB values in `rgba8unorm`. Choosing `rgba8unorm-srgb` for the output would let WebGPU apply the same sRGB conversion again. For edge extraction, use tone-mapped `rgba8unorm` or `bgra8unorm`, matching the standard drawing target so displayed luminance differences are available. Convert an `rgba16float` intermediate to display color first.

Fog and vignette both process the full screen but belong to different color stages. Fog mixes scene illumination with a distance-based fog color, so place it in the linear HDR stage before tone mapping and use `rgba16float` for input and output. Vignette adjusts the completed image near the edges, so place it in the display-color stage after tone mapping and any required edge extraction, using `rgba8unorm` for input and output.

This format boundary is independent of whether an effect uses a compute shader. Placing fog before tone mapping lets the fog color and scene illumination contribute together to the mapped result. Placing vignette in the HDR stage would let later exposure and tone mapping change the edge darkening, blurring its role as a final-screen adjustment. Preserve the same order and formats in both manual pass connections and an integrated pipeline.

You can reduce GPU cost by adjusting output resolution. For SSR, keep the G-buffer at full resolution and lower only the storage texture used for reflection computation. `ComputeSsrPass.resolutionScale` defaults to `0.7`. Since the reflection is a supplementary contribution mixed with the original scene color, the lower output resolution reduces work while full-resolution color and depth remain available as inputs.

Also skip pixels that contribute little. SSR uses `reflectivityThreshold`, defaulting to `0.05`, to skip pixels whose specular contribution from PBR materials is small. The specular weight comes from specular reflectance, metalness, and Fresnel reflection, rather than interpreting base-color alpha as reflectivity. Combining lower output resolution with early exits for pixels that contribute little helps reduce GPU work while preserving the visible result.

### Compute-first

Update GPU state such as particle positions or physics first, then draw using the result. GPU particles, cloth simulation, and GPU physics use this flow.

```text
compute pass (update state)
  -> render pass (draw latest state)
  -> submit
```

Set `computeFrame: true` on `WebgApp` and use `onComputeFrame` to control the complete sequence of GPU commands for one frame, through `queue.submit()`.

## Build a Processing Pass with `ComputePass`

Use `ComputePass` to package WGSL, bindings, uniforms, and dispatch into a reusable unit. It handles repeated WebGPU pipeline setup so each pass can focus on input and output resources, changing values, and execution dimensions.

The class makes required resources explicit on the JavaScript side by name, binding number, and type, so mismatches with WGSL can be caught early.

This example darkens an input image slightly and writes it to a storage texture:

```js
import ComputePass from "./webg/ComputePass.js";

const code = `
struct Params {
  values : vec4f,
};

@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var sourceTexture : texture_2d<f32>;
@group(0) @binding(2) var outputTexture : texture_storage_2d<rgba8unorm, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  let size = textureDimensions(outputTexture);
  if (id.x >= size.x || id.y >= size.y) {
    return;
  }
  let coord = vec2<i32>(id.xy);
  let color = textureLoad(sourceTexture, coord, 0);
  let gain = params.values.x;
  textureStore(outputTexture, coord, vec4f(color.rgb * gain, color.a));
}
`;

const darkenPass = new ComputePass(app.getGPU(), {
  label: "darken",
  code,
  workgroupSize: [8, 8, 1],
  uniformFloats: 4,
  bindings: [
    { binding: 0, name: "params", type: "uniform-buffer" },
    { binding: 1, name: "source", type: "sampled-texture" },
    {
      binding: 2,
      name: "output",
      type: "storage-texture",
      dispatchSize: true
    }
  ]
});

darkenPass.setUniforms(new Float32Array([0.82, 0.0, 0.0, 0.0]));
```

At runtime, end the active render pass before adding compute work to the same command encoder:

```js
app.getGPU().endPass();

darkenPass.encode(
  app.getGPU().commandEncoder,
  {
    source: sceneTarget,
    output: outputTarget
  },
  {
    timestampWrites: app.getGpuTimestampWrites(true, true)
  }
);
```

`ComputePass` encodes the effect and leaves command-encoder creation and `queue.submit()` to the application. This lets the application control the order of scene rendering, compute effect, and full-screen copy within one frame.

### Minimal Image-Compute Application

To integrate the pass, provide a scene render target, a storage-texture output, and a `FullscreenPass` to draw the result to the canvas. The following example connects `darkenPass` to a Render-first frame.

Assume scene shapes and nodes have already been added to `app.space` as in the earlier `Shape` chapters.

```js
import WebgApp from "./webg/WebgApp.js";
import ComputePass from "./webg/ComputePass.js";
import FullscreenPass from "./webg/FullscreenPass.js";
import StorageTargetFactory, {
  resizeTarget
} from "./webg/StorageTargetFactory.js";

const app = new WebgApp({
  document,
  autoDrawScene: false,
  clearColor: [0.04, 0.05, 0.07, 1.0]
});
await app.init();

// createScene() adds shapes and nodes to app.space.
createScene(app);

const sceneTarget = app.screen.createRenderTarget({
  label: "darken:scene",
  format: app.getGPU().format,
  hasDepth: true
});

const targetFactory = new StorageTargetFactory(app.getGPU(), {
  label: "darken:storage"
});
const outputTarget = targetFactory.create({
  label: "darken:output",
  width: app.screen.getWidth(),
  height: app.screen.getHeight()
});

const darkenPass = new ComputePass(app.getGPU(), {
  label: "darken",
  code,
  workgroupSize: [8, 8, 1],
  uniformFloats: 4,
  bindings: [
    { binding: 0, name: "params", type: "uniform-buffer" },
    { binding: 1, name: "source", type: "sampled-texture" },
    {
      binding: 2,
      name: "output",
      type: "storage-texture",
      format: "rgba8unorm",
      dispatchSize: true
    }
  ]
});

const copyPass = new FullscreenPass(app.getGPU(), {
  targetFormat: app.getGPU().format
});

await Promise.all([
  sceneTarget.ready,
  outputTarget.ready,
  copyPass.init()
]);

app.start({
  onUpdate: ({ screen }) => {
    // Keep input and output pixels aligned by resizing them together.
    resizeTarget(sceneTarget, screen.getWidth(), screen.getHeight());
    resizeTarget(outputTarget, screen.getWidth(), screen.getHeight());
  },

  onBeforeDraw: () => {
    // Stage 1: Draw the regular 3D scene to an off-screen target.
    app.screen.beginPass({
      target: sceneTarget,
      clearColor: app.clearColor,
      colorLoadOp: "clear",
      depthClear: true
    });
    app.space.draw(app.eye);
  },

  onAfterDraw3d: () => {
    // Stage 2: End scene rendering and encode compute work in the same encoder.
    darkenPass.setUniforms(
      new Float32Array([0.82, 0.0, 0.0, 0.0])
    );
    app.getGPU().endPass();
    darkenPass.encode(
      app.getGPU().commandEncoder,
      {
        source: sceneTarget,
        output: outputTarget
      }
    );

    // Stage 3: Copy the storage texture into a canvas render pass.
    app.screen.beginPresentPass({
      clearColor: app.clearColor,
      colorLoadOp: "clear"
    });
    copyPass.draw(outputTarget);
    app.screen.clearDepthBuffer();
  }
});
```

In this example, `WebgApp` manages the frame command encoder and final submit. A storage texture is not presented directly to the swap chain; `FullscreenPass` reads it and draws it to the canvas.

Call `destroy()` on resources when the application no longer needs them:

```js
darkenPass.destroy();
outputTarget.destroy();
sceneTarget.destroy();
```

## Summary

Before connecting compute work, define its inputs and outputs, coordinate space, depth convention, color meaning, and execution order. Review commands recorded in the `WebgApp` frame flow through the pass that displays their result.

Chapter 22 examines storage-resource exchange, synchronization, memory layout, and execution-time measurements.
