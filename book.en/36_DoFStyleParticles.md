# DoF, Visual Style, and GPU Particles

This chapter adds focus, color bands, outlines, vignette, and particles to the rendering flow from Chapters 34–35. It distinguishes effects that use depth, effects that read only color, and particle simulation that updates GPU state before drawing.

## How to read this chapter

### Prerequisites

This chapter is easier to follow if you know image processing from Chapter 34, lighting and fog from Chapter 35, and GPU data exchange from Chapter 22.

### What to read first

Start with DoF (Depth of Field), toon shading, edge detection, vignette, and HDR effect order.

### What to read when you need it

Refer to GPU particles, shared buffers, resizing, diagnostics, and intermediate images when working with large numbers of elements.

### What you will learn

You can integrate depth of field, visual style, screen-edge treatment, and GPU-side particle updates in one processing flow.

## Convey Focus and Depth with DoF

DoF keeps a selected distance in focus and blurs objects in front of and behind it, guiding attention and conveying scene depth. It uses the already rendered HDR scene and camera Reverse-Z depth, adding focus without rendering the scene separately for each distance. It also supports changing the focus distance each frame.

`ComputeDofPass` reconstructs camera distance from depth and converts the difference from the focus plane into Circle of Confusion (CoC) levels. It builds four groups of image pyramids—scene color, near field, far field, and CoC data—at 1/2, 1/4, 1/8, and 1/16. Out-of-focus shapes select neighboring low-frequency levels by distance and replace the sharp image.

Near and far blur separate premultiplied color from shape coverage. Far blur sits behind the focal plane and near blur; near blur composites over the focal plane, far blur, and background. CoC support data remains separate from coverage, allowing blur to extend beyond silhouettes while independently controlling level selection.

```js
import ComputeDofPass from "./webg/ComputeDofPass.js";

const dofPass = new ComputeDofPass(app.getGPU(), {
  width: app.screen.getWidth(),
  height: app.screen.getHeight()
});
await dofPass.ready;

const focusedColor = dofPass.encode(
  app.getGPU().commandEncoder,
  {
    scene: hdrScene,
    depth: gbufferResources.depth
  },
  {
    cameraFrame,
    focusDistance: 36.0,
    focusRange: 7.0,
    cocScale: 1.0,
    debugView: "composite",
    sharpnessWidth: 0.15,
    sharpnessPower: 1.0,
    blurRadius: 1.0,
    enabled: true
  }
);
```

These values match `COMPUTE_DOF_DEFAULTS`:

- `focusDistance` (default `36.0`) is the view-space distance from the camera to the focus plane; it must be greater than 0.
- `focusRange` (default `7.0`) sets the depth interval kept sharp and the distance scale for moving between pyramid levels; it must be greater than 0.
- `blurRadius` (default `1.0`, range 0.25–3.0) sets the sample spacing for the 13-tap low-pass filters that build pyramid levels. Higher values widen blur at a given level.
- `cocScale` (default `1.0`, range 0–2) scales CoC derived from focus distance. Higher values select lower-resolution levels sooner for the same distance difference.
- `sharpnessWidth` (default `0.15`, range 0–0.95) sets the transition width from the in-focus band to the first low-frequency level.
- `sharpnessPower` (default `1.0`, greater than 0) adjusts the interpolation curve between neighboring low-frequency levels.
- `debugView` (default `"composite"`) outputs reconstructed distance with `"depth"`, focus state with `"focus"`, or the completed image with `"composite"`.
- `enabled` (default `true`) enables DoF composition.

### Link EyeRig Focus to Compute DoF

The previous example calls `ComputeDofPass` at low level and sets `focusDistance` numerically. In a typical application, it is more natural for the focus plane to follow camera zoom/rotation or a moving target Node. Choose a focus target in `EyeRig` and set `focusSource: "camera"` in `ComputeEffectPipeline`:

```js
import ComputeEffectPipeline from "./webg/ComputeEffectPipeline.js";

const orbit = app.createOrbitEyeRig({
  target: [0.0, 1.5, 0.0],
  distance: 18.0,
  yaw: 28.0,
  pitch: -20.0,
  focus: {
    enabled: true,
    mode: "node",
    targetNode: ballNode,
    targetOffset: [0.0, 0.0, 0.0]
  }
});

const pipeline = new ComputeEffectPipeline(app.getGPU(), {
  dof: {
    enabled: true,
    focusSource: "camera",
    focusRange: 5.8,
    cocScale: 0.95,
    blurRadius: 1.15,
    focusTransitionWidth: 0.40,
    sharpnessWidth: 0.60
  }
});
```

After updating the EyeRig, `WebgApp` creates `CameraFrame` and stores the result of `EyeRig.getFocusDistance(cameraFrame)` in `cameraFrame.focusDistance`. On frames with DoF `focusSource: "camera"`, `ComputeEffectPipeline` passes this value to `ComputeDofPass`. If `ballNode` moves under physics or the Orbit camera zooms, focus distance is recomputed from the current display frame.

Focus distance and blur amount are separate settings. `EyeRig.focus` selects the target; `CameraFrame.focusDistance` stores its current view-space distance; `focusRange` and `cocScale` determine how that distance difference becomes blur. The default `focusSource` is `"explicit"`, preserving numeric `focusDistance` for direct use. With `"camera"`, a missing `CameraFrame.focusDistance` raises a configuration error instead of falling back to a fixed value.

In an FPS game without a moving Node target, use `camera-forward` and specify a distance such as 1.0 m in front of the camera. To focus on a fixed exhibit, use `world-point` and provide world coordinates. EyeRig selects the focus target; `ComputeDofPass` handles the image pyramid, CoC, and level blending.

First set `focusDistance` on the subject, then use `focusRange` to define the depth kept sharp. Adjust `cocScale` for how quickly blur increases with distance, and `blurRadius` for spatial blur width. Finally check the transitions controlled by `sharpnessWidth` and `sharpnessPower`.

If focus does not follow the camera, check before adjusting blur values that `scene` and `depth` come from the same frame and that the same `cameraFrame` used for G-buffer rendering reaches the pass. The undrawn background has no distance, so it is not uniformly blurred; only regions reached by filtered near/far coverage are updated.

## Tune Visual Style by Separating Toon Shading and Edges

Toon shading and edge detection replace smooth physical shading with illustration-like bands and lines. Separate passes let you adjust the number of color bands and line width independently. You can also add edges to regular lighting or use toon shading without lines.

`ComputeToonPass` converts the lit HDR scene into a small number of brightness bands. Rounding RGB channels separately can change hue, so the pass quantizes the maximum RGB channel as intensity and applies the same multiplier to the original RGB. This organizes lighting while preserving material color.

Clamping HDR to 0–1 before banding would place every value above 1.0 into the same white band. Instead, intensity is split into exposure ranges that double in scale, such as 0.5–1, 1–2, and 2–4, and each range is quantized into `levels`. This retains emission differences above 1.0 for later bloom and tone mapping. `floor` applies only to dark values below 1.0, leaving higher HDR brightness intact.

```js
import ComputeToonPass from "./webg/ComputeToonPass.js";

const toonPass = new ComputeToonPass(app.getGPU(), {
  width: app.screen.getWidth(),
  height: app.screen.getHeight()
});
await toonPass.ready;

const toonColor = toonPass.encode(
  app.getGPU().commandEncoder,
  hdrScene,
  {
    levels: 4,
    strength: 1.0,
    gamma: 1.0,
    floor: 0.28,
    enabled: true
  }
);
```

`levels` is the band count, `strength` mixes original and quantized color, `gamma` moves band boundaries toward dark or bright values, and `floor` sets the darkest band's brightness. Applying toon before tone mapping keeps the HDR light range available for the bands.

### Choose Color Edges or Geometry Edges by Purpose

Use color edges when the desired lines follow visible color or brightness changes. Use geometry edges when lines should follow object silhouettes or surface folds reliably. Selecting the appropriate data lets a style include texture boundaries or preserve outlines that are less affected by lighting.

`ComputeEdgePass` supports color-edge detection from scene luminance and geometry-edge detection from G-buffer normal and depth differences. Color edges readily pick up texture and lighting boundaries; geometry edges emphasize object outlines and surface folds.

```js
import ComputeEdgePass from "./webg/ComputeEdgePass.js";

const edgePass = new ComputeEdgePass(app.getGPU(), {
  width: app.screen.getWidth(),
  height: app.screen.getHeight()
});
await edgePass.ready;

const outlined = edgePass.encode(
  app.getGPU().commandEncoder,
  displayColor,
  {
    normal: gbufferResources.normal,
    depth: gbufferResources.depth,
    cameraFrame,
    strength: 1.0,
    threshold: 0.16,
    mix: 1.0,
    thickness: 2,
    blendMode: "black-multiply",
    colorEnabled: false,
    geometryEnabled: true,
    normalWeight: 1.0,
    depthWeight: 1.0,
    enabled: true
  }
);
```

For geometry edges, pass `normal`, `depth`, and `cameraFrame` together. Color-only edges do not need them. `thickness` expands detected lines; `threshold` sets the difference considered an edge. `black-multiply` preserves base color with black lines, `black-subtract` creates stronger black lines, and `white-add` suits emissive-looking white lines.

`displayColor` must be tone-mapped display color in `rgba8unorm` or `bgra8unorm`, matching the standard render target. `ComputeEdgePass` detects display-luminance changes, so convert linear HDR `rgba16float` to display color with tone mapping first. To outline deferred lighting, run `ComputeEffectToneMapPass` before edge detection. A forward `RenderTarget` can be supplied in `bgra8unorm` directly.

The pass accepts both input formats but internally generates its storage output texture in `rgba8unorm`. A standard render target may use `bgra8unorm` for the Canvas while storage output has a different format. Use the output target returned by the pass rather than assuming input and output formats match.

## Refine the Screen Edges with Vignette

Vignette preserves the central area and darkens or tints the edges to guide attention. It adjusts the completed display image rather than evaluating 3D positions or materials. `ComputeVignettePass` therefore reads `rgba8unorm` display color after tone mapping and optional edge detection, and returns a final texture in the same format.

```js
import ComputeVignettePass from "./webg/ComputeVignettePass.js";

const vignettePass = new ComputeVignettePass(app.getGPU(), {
  width: app.screen.getWidth(),
  height: app.screen.getHeight()
});
await vignettePass.ready;

const finalColor = vignettePass.encode(
  app.getGPU().commandEncoder,
  outlinedDisplayColor,
  {
    center: [0.5, 0.5],
    radius: 0.9,
    softness: 0.35,
    strength: 0.65,
    tint: [0.0, 0.0, 0.0],
    enabled: true
  }
);
```

`center` is a normalized screen coordinate. `[0.5, 0.5]` is the center; move it for off-center compositions. `radius` is the outer radius where the effect is complete; `softness` is the transition width. Since the inner radius is `radius - softness`, `softness` must be greater than 0 and no more than `radius`.

`strength` ranges from 0 to 1 and sets how strongly `tint` affects the edge. The pass multiplies input RGB by a factor between white and `tint` according to edge weight and strength. The default black tint darkens edges. A colored tint multiplies input color channels to shift the edge color rather than painting a flat overlay. Alpha is preserved.

| Setting | Default | Meaning |
|---|---:|---|
| `center` | `[0.5, 0.5]` | Effect center in normalized screen coordinates |
| `radius` | `0.9` | Outer radius where the effect completes |
| `softness` | `0.35` | Transition width from inner to outer region |
| `strength` | `0.65` | Amount of edge tint |
| `tint` | `[0, 0, 0]` | Edge color multiplied into the input |
| `enabled` | `false` | Whether to apply vignette |

For screens with different width and height, using normalized distance directly would stretch a circular vignette. `ComputeVignettePass` multiplies horizontal offset from center by screen aspect ratio before measuring distance. The correction keeps the screen-space distance stable during resize; resize the pass output target to the new Canvas dimensions as well.

Vignette reads completed color and screen size independently of depth, normals, material, and `cameraFrame`. It can therefore also be connected to display color from a forward path without a G-buffer. Convert linear HDR to display color first and apply vignette once after exposure and tone mapping.

To keep HUD text bright, present the vignette texture first and draw the HUD afterward. The integrated order in Chapters 31–33 is tone mapping, edge detection, vignette, final presentation, HUD. If an application already has a vignette just before presentation, centralize settings in one place rather than enabling both.

## Connect HDR Effects in Order

Effect order preserves HDR light above 1.0 until every effect that needs it has run, then performs display conversion once. With the correct order, bloom spreads only bright light, DoF blurs emission while preserving its brightness, and tone mapping finally compresses it to the display range. In the wrong order, individually valid passes can lose highlight differences, flattening bloom and reflections.

Bloom extracts bright parts from HDR. Running it after tone mapping removes its input range because bright light has already been compressed. DoF also blurs the HDR scene so out-of-focus emission keeps its brightness. Fog, toon, DoF, and bloom usually run before tone mapping; edge detection and vignette run after tone mapping on display color.

```text
G-buffer
  -> visibility (shadows / SSAO)
  -> deferred lighting
  -> SSR and effect composition
  -> TransparencyPass
  -> standard Compute particles added to HDR
  -> fog
  -> toon / DoF / bloom
  -> tone mapping
  -> edge detection
  -> vignette
  -> presentation
```

`TransparencyPass` adds semitransparent triangles omitted from the G-buffer to the composited HDR scene. It builds a 1/2, 1/4, and 1/8 pyramid from the opaque scene, interpolates adjacent levels using roughness for background blur, then alpha-composites transparent surfaces collected across Shapes and sorted back-to-front. Applications normally do not call it individually; `ComputeEffectPipeline` from Chapters 31–33 runs it only on frames containing transparent triangles.

`ComputeFogPass` processes the complete HDR scene after transparent composition, using only opaque G-buffer depth for distance. `ComputeVignettePass` processes display color after tone mapping and edge detection to produce the presentation texture. Fog and vignette both default to disabled and enter the integrated order only when enabled.

## Composite Standard Compute Particles into PBR

Chapter 26's `ComputeParticleEmitter` extends `GpuParticleEmitter` and combines validation of emission settings, initial data, update equations, and emissive billboard rendering. Register it with `WebgSceneApp.createComputeParticleEmitter()` in a PBR application; `ComputeParticlePass` adds it to the HDR image after transparency. The application specifies emission settings and leaves GPU resources and the individual render pass to the standard class.

PBR composition uses `rgba16float`. For direct display rendering, specify the display format, for example `targetFormat: screen.getGPU().format`. The same `ComputeParticleEmitter` handles emission and GPU updates for either target.

Each emission request uses 32 floats. Up to 32 requests are retained before an update and transferred together with 48 floats of camera/time data in a 4,288-byte uniform. GPU work items read the request corresponding to their particle slot and use its seed and emission index to generate initial velocity, lifetime, and radius. One particle uses 12 floats (48 bytes); the same buffer is referenced by rendering.

Batching requests suits frequent bursts such as collisions. CPU state retains reserved capacity based on maximum lifetime for overflow and diagnostics. Normal rendering does not require GPU readback. Estimate capacity from emission rate and lifetime because GPU update and draw instance count grow with capacity.

Composition adds emission into linear HDR RGB and preserves destination alpha. It reads opaque G-buffer depth without writing it, so particles behind floors and pillars are occluded. The result proceeds to the same bloom and tone mapping as the scene. Particle simulation and display continue with bloom disabled.

To connect directly to a low-level `ComputeEffectPipeline`, register an emitter during initialization with an existing `app` and `pipeline`:

```js
import ComputeParticleEmitter from "./webg/ComputeParticleEmitter.js";

const particles = new ComputeParticleEmitter(app.getGPU(), {
  preset: "light", capacity: 1024, seed: 42, overflow: "reject"
});
await pipeline.addParticleEmitter(particles);
particles.startEmission({ rate: 30, position: [0, 1, 0] });
```

Call `pipeline.encode(commandEncoder, { cameraFrame, deltaSec })` each frame with that frame's camera and time delta in seconds. The frame owner creates and submits the encoder. The pipeline releases registered particles and intermediate HDR images when destroyed.

SSR samples the scene before particle composition; fog and DoF use opaque depth. Depth sorting against transparent surfaces or effects that use particle depth require additional inputs and design. Standard Compute particles suit emissive circular particles; smoke transparency and particle-to-particle interaction use purpose-built rendering and update processing.

## Update GPU Particles with Custom WGSL

GPU particles update large groups of sparks, smoke, rain, or flocking agents without moving every particle state between CPU and GPU each frame. `GpuParticleEmitter` updates particle state in a storage buffer and lets the vertex shader read that buffer directly, increasing its advantage over CPU updates and uploads as particle count grows.

This flexibility means the application defines the particle layout and coordinate meaning in its own WebGPU Shading Language (WGSL). Unlike screen effects that reconstruct meaning from shared G-buffer attachments, the application must align position, velocity, lifetime, color, and other fields between its Compute and render WGSL.

For direct drawing through the standard camera, declare coordinates and depth when creating the emitter:

```js
import GpuParticleEmitter from "./webg/GpuParticleEmitter.js";
import { CAMERA_REVERSE_Z } from "./webg/DepthConvention.js";

const emitter = new GpuParticleEmitter(app.getGPU(), {
  particleCount: 32768,
  floatsPerParticle: 12,
  workgroupSize: 64,
  initialData,
  computeCode,
  renderCode,
  coordinateSpace: "camera-relative",
  depthConvention: CAMERA_REVERSE_Z,
  targetFormat: app.getGPU().format
});
```

This excerpt shows the creation contract. The application supplies `computeCode`, `renderCode`, and `initialData`. `initialData` is a `Float32Array` with exactly `particleCount * floatsPerParticle` elements. A different length raises an error; Core does not fill missing values.

| JavaScript configuration | WGSL contract |
|---|---|
| `floatsPerParticle: 12` | 12 `f32` values for one particle |
| `workgroupSize: 64` | `@workgroup_size(64)` in the Compute entry point |
| Compute group 0 / binding 0 | Read-write particle storage buffer |
| Compute group 0 / binding 1 | Read-only parameter uniform buffer |
| Render group 0 / binding 0 | Read-only particle storage buffer |
| Render group 0 / binding 1 | Read-only parameter uniform buffer |

A minimal layout with one particle represented by three `vec4f` values is:

```wgsl
struct Particle {
  state0 : vec4f,
  state1 : vec4f,
  state2 : vec4f,
};

struct SimParams {
  values : vec4f,
};

// Compute: one invocation updates one particle
@group(0) @binding(0) var<storage, read_write> particles : array<Particle>;
@group(0) @binding(1) var<uniform> params : SimParams;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id : vec3u) {
  if (id.x >= arrayLength(&particles)) {
    return;
  }
  var particle = particles[id.x];
  particle.state0.xy += particle.state1.xy * params.values.x;
  particles[id.x] = particle;
}
```

```wgsl
struct Particle {
  state0 : vec4f,
  state1 : vec4f,
  state2 : vec4f,
};

struct SimParams {
  values : vec4f,
};

struct VertexOutput {
  @builtin(position) position : vec4f,
  @location(0) color : vec4f,
};

// Render: read the same particle buffer after Compute
@group(0) @binding(0) var<storage, read> particles : array<Particle>;
@group(0) @binding(1) var<uniform> params : SimParams;

@vertex
fn vsMain(
  @location(0) corner : vec2f,
  @builtin(instance_index) instanceIndex : u32
) -> VertexOutput {
  let particle = particles[instanceIndex];
  var output : VertexOutput;
  output.position = vec4f(particle.state0.xy + corner * 0.01, 0.5, 1.0);
  output.color = particle.state2;
  return output;
}

@fragment
fn fsMain(input : VertexOutput) -> @location(0) vec4f {
  return input.color;
}
```

`GpuParticleEmitter` dispatches `ceil(particleCount / workgroupSize)` workgroups. It does not read `@workgroup_size` from WGSL and update the JavaScript setting; change both values together.

Align the declared depth convention with the WGSL output. A mismatch reverses depth testing. Check that clip positions from the vertex shader, pipeline depth comparison, and clear value all use the same convention. The application explicitly defines the particle position fields in WGSL; Core reads the declared layout.

### Share One GPU Buffer Between Update and Rendering

`GpuParticleEmitter` exposes one particle storage buffer to Compute as read-write and to rendering as read-only. Recording Compute before the Render Pass uses the updated state in the same frame without reading it back to the CPU.

```text
particle buffer --Compute update--> same particle buffer --Render read--> screen
```

The usual design lets one invocation update its own particle. For interactions that need another particle's previous state during an update, use separate input and output buffers in a ping-pong configuration. The application explicitly owns buffer switching.

`floatsPerParticle` must match the WGSL structure. The application defines the layout of position, velocity, lifetime, color, and other values. When output is incorrect, reduce particle count and compare the CPU definition with both WGSL structures in a diagnostic view.

## Prevent Resize Misalignment and Resource Leaks

Clearly assigning resize and release ownership preserves pixel correspondence after a window-size change and reliably releases GPU resources. Updating related passes together, and releasing resources only through their creator, avoids shifted images, stale textures, double release, and leaks.

When Canvas dimensions change, resize every pass whose input and output represent the same pixels. If only G-buffer is updated while SSAO and SSR keep old dimensions, texture coordinates no longer align.

```js
function resizeEffects(width, height) {
  gbuffer.resize(width, height);
  ssaoPass.resize(width, height);
  deferredPass.resize(width, height);
  ssrPass.resize(width, height);
  fogPass.resize(width, height);
  dofPass.resize(width, height);
  bloomPass.resize(width, height);
  toonPass.resize(width, height);
  edgePass.resize(width, height);
  vignettePass.resize(width, height);
}

app.start({
  onUpdate: ({ screen }) => {
    resizeEffects(screen.getWidth(), screen.getHeight());
  }
});
```

Each `resize()` retains resources at the same dimensions and rebuilds only when they change. Synchronize in `onUpdate`, then use the new targets from `onBeforeDraw`. Call `destroy()` on the pass that created a target. If several passes consume the same texture, keep it alive until all consumers have finished. When this management becomes complex, use `ComputeEffectPipeline` from Chapters 31–33 to centralize resource creation, update, and release.

## Inspect Intermediate Data by Meaning

Displaying G-buffer and visibility results separately distinguishes missing input, coordinate mismatch, and composition-order errors that may look similar in the final image. Locate the first stage where data becomes incorrect instead of adjusting many passes at once.

1. Check that albedo contains the pre-lighting color.
2. Display normals as color and confirm their view-space response to camera rotation.
3. Check that background depth is 0 and near surfaces are brighter.
4. Confirm the four material components are `specular`, `roughness`, `metallic`, and `occlusion`, with emission in its independent HDR attachment.
5. Confirm AO and shadow visibility use white for unoccluded areas.
6. Confirm deferred-lighting output remains HDR.
7. Confirm reflection alpha is 0 where there is no SSR hit.
8. Check that fog uses opaque depth and reads HDR color after transparency composition.
9. Check that tone mapping, sRGB display conversion, and extra gamma adjustment occur once before display.
10. Confirm vignette follows edge detection and runs once before final presentation, with the HUD drawn afterward.

For a black display, inspect pass connections as well as shader equations. For example, copying a full-screen image into a camera Reverse-Z depth pass can cause an attachment mismatch. Moving to a `Font` pipeline while a depth-free presentation pass is active can cause the same problem. Either mismatch can invalidate the command buffer.

Check WebGPU uncaptured errors and use `beginPresentPass()` followed by `clearDepthBuffer()` to switch from final presentation to HUD rendering.

## Reduce Cost in Order of Image-Quality Impact

Before disabling effects, review derived-target resolution, samples per pixel, and affected area. Lowering resolution for targets already designed for blur or bilateral upsampling can reduce computation without compromising the full-resolution G-buffer that preserves silhouette and material detail.

Screen-effect cost is approximately the product of processed pixels, samples per pixel, and pass count. Start by lowering `resolutionScale`, then adjust ray steps or sample count, then reduce the effect's enabled scope. Because resolution applies to both dimensions, reducing it from 1.0 to 0.7 gives about 49% of the original pixel count.

Keep G-buffer attachments at matching resolution because albedo, normal, material, and depth describe the same pixel. Apply lower resolution to derived targets generated and owned inside effects, such as raw SSAO or SSR reflection.

Fog and vignette currently process at input resolution to preserve correspondence with final pixels. Each adds a full-resolution dispatch and output texture when enabled, using a small number of texture reads and arithmetic operations per pixel. The integrated pipeline skips the pass's `encode()` call when disabled. Compare GPU time with enabled state rather than setting strength near zero.

## Summary

Before combining DoF, toon shading, edge detection, vignette, and GPU particles, check which images and depth data they use, the color interval they process, and what follows them. Tune derived-target resolution, sample counts, and pass count in order to estimate cost while preserving the required image quality. Chapter 41 explains rendering coordinates, depth, and formats from their internal conventions.
