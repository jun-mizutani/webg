# Foundations of Advanced Screen Effects

This chapter explains how to share a G-buffer, depth, camera information, and HDR images among Compute passes to add screen effects. It covers effects that use 3D scene data—SSAO contact cues, SSR reflections, shadows, fog, DoF, and bloom—separately from edge detection and vignette, which operate on the image after lighting. It also covers large particle systems that update state on the GPU and render directly. The goal is to identify each effect's inputs, outputs, execution order, and main costs.

## How to read this chapter

### Prerequisites

This chapter is easier to follow if you know Compute connections from Chapter 21 and post-processing from Chapter 23.

### What to read first

Start with color-only passes, separable blur, image pyramids, the G-buffer—the screen-space surface data used by lighting—and SSAO (Screen Space Ambient Occlusion).

### What to read when you need it

Refer to camera frames, deferred lighting, shadows, SSR (Screen Space Reflections), fog, DoF (Depth of Field), and GPU particles when needed.

### What you will learn

You can distinguish effects by the meaning of their input data and estimate their intermediate-image and processing costs.

## Use Screen Effects to Re-evaluate Scene Relationships

Use this approach when screen effects need three-dimensional relationships that cannot be determined from final color alone. The color transforms and blur filters in Chapters 23–25 read color; their DoF example also reads depth. SSAO, screen-space reflections, DoF, and shadow evaluation also need to know which surface each pixel represents, its camera distance, its surface orientation, and how much light it reflects. Retaining this as shared intermediate data lets effects reuse the same geometry and position basis.

In webg, this information is grouped in a G-buffer. It is not a finished image; it is an intermediate representation that lets later processing refer to the same pixels with consistent meaning. Camera depth uses Reverse-Z, while shadow maps use conventional Z, so the G-buffer contract includes shared coordinate, depth, material, and color-space conventions.

This chapter explains the inputs and outputs of individual passes. Chapters 31–33 show how to connect multiple effects in a practical order with `ComputeEffectPipeline`.

## Set Four Conventions Before Tuning

Before adjusting appearance, align four meanings so multiple passes connect correctly: coordinates, camera depth, shadow depth, and color. Establishing them early prevents reversed shadows, reflections that shift only when the camera rotates, and bright light lost before it reaches bloom.

| Data | Convention | Symptom when inconsistent |
|---|---|---|
| Coordinates | G-buffer normals and reconstructed positions use view space | Shadows or reflections shift with camera rotation |
| Camera depth | `CAMERA_REVERSE_Z`, `depth32float`, near=1 and far=0 | Background treated as an object or distance reconstructed backwards |
| Shadow depth | `SHADOW_STANDARD_Z`, near=0 and far=1 | Shadow test is inverted |
| Color | Lighting and effects use `rgba16float`; display uses `rgba8unorm` just before presentation | Bright light clips early, removing bloom and reflections |

Even with the same `depth32float` format, camera and shadow depth values have opposite meanings. Check format and depth convention together before passing data to a stage. Core passes validate convention identity and report unknown input conventions as errors.

## Keep Color-Only Passes Lightweight

Effects that can be calculated from color alone—blur, bloom, toon, and vignette—can process an offscreen target from the ordinary forward path without creating a G-buffer. When a screen effect needs no normals, material values, or depth, omitting those attachments keeps memory and setup small. Bloom and toon read linear HDR color; vignette reads display color after tone mapping, so each effect also defines its input format and position in the sequence.

Fog and DoF also read camera depth. SSAO, SSR, and shape boundaries read depth and normals. Deferred lighting additionally needs material and visibility. Selecting a path according to the required information avoids unnecessary resources and mixed assumptions.

### Reduce Samples with Separable Blur

Use blur for DoF bokeh, bloom spread, or a soft background that blends neighboring pixels and reduces detail. `ComputeBlurPass` separates a 2D blur into horizontal and vertical passes, reducing samples for a wide blur. A square kernel of radius $r$ takes $(2r+1)^2$ samples per pixel; two separable directions need $2(2r+1)$, a greater saving at larger radii.

```js
import ComputeBlurPass from "./webg/ComputeBlurPass.js";

const blurPass = new ComputeBlurPass(app.getGPU(), {
  label: "main-blur",
  width: app.screen.getWidth(),
  height: app.screen.getHeight()
});
await blurPass.ready;

app.getGPU().endPass();
const blurredColor = blurPass.encode(
  app.getGPU().commandEncoder,
  hdrSceneTarget,
  {
    radius: 3,
    iterations: 2
  }
);
```

Input and output must both be `rgba16float` and have matching dimensions. `radius` is the sample range in one direction; `iterations` is the number of horizontal/vertical pairs. A larger radius increases sample count, and more iterations add dispatches, so check both appearance and GPU time.

### Create a Wide Blur with an Image Pyramid

`ComputePyramidBlurPass` successively downsamples a linear HDR image to 1/2, 1/4, 1/8, and 1/16, then progressively upsamples from 1/16 to the original resolution. Each downsample uses a 13-tap low-pass filter and each upsample a 9-tap tent filter. Processing consecutive levels reaches a wide area at low resolution without skipping directly between distant pixels.

```js
import ComputePyramidBlurPass from "./webg/ComputePyramidBlurPass.js";

const pyramidBlurPass = new ComputePyramidBlurPass(app.getGPU(), {
  label: "main-pyramid-blur",
  width: app.screen.getWidth(),
  height: app.screen.getHeight()
});
await pyramidBlurPass.ready;

app.getGPU().endPass();
const blurredColor = pyramidBlurPass.encode(
  app.getGPU().commandEncoder,
  hdrSceneTarget,
  {
    filterRadius: 1.0
  }
);
```

Input and output formats are `rgba16float`. The default levels are `[2, 4, 8, 16]`; only the 1/16 low-frequency image is successively upsampled through 1/8, 1/4, 1/2, and full resolution. This reconstructs blur without adding intermediate levels, preserving light energy. `filterRadius` sets sample spacing during downsampling and upsampling; its default is `1.0` and valid range is 0.25–3.0. It changes filter coverage without changing the number of levels or dispatches.

Use `ComputeBlurPass` to repeat horizontal and vertical blur at full resolution; use `ComputePyramidBlurPass` for a wide blur through lower-resolution levels.

### Build Bloom with an Image Pyramid

Bloom adds glow around emitters, reflected lights, or a very bright sky. It extracts bright pixels and adds them to the scene, preserving dark detail while making HDR light-energy differences visible as a spread.

`ComputeBloomPass` first applies a threshold to the full-resolution HDR scene. It successively downsamples the extracted light to 1/2, 1/4, 1/8, 1/16, and 1/32 with `ComputeImagePyramid`, then upsamples from the lowest level. Each level has its own weight, allowing near-source glow and a softer distant halo to form one continuous image.

```text
Linear HDR scene
  -> extract highlights with threshold and softKnee
  -> downsample successively to 1/2, 1/4, 1/8, 1/16, 1/32
  -> progressively upsample from 1/32 with per-level weights
  -> add strength × reconstructed bloom to the original linear HDR scene
```

```js
import ComputeBloomPass from "./webg/ComputeBloomPass.js";

const bloomPass = new ComputeBloomPass(app.getGPU(), {
  width: app.screen.getWidth(),
  height: app.screen.getHeight()
});
await bloomPass.ready;

const bloomedColor = bloomPass.encode(
  app.getGPU().commandEncoder,
  hdrSceneTarget,
  {
    threshold: 0.60,
    softKnee: 0.40,
    strength: 0.70,
    halfWeight: 0.45,
    quarterWeight: 0.28,
    eighthWeight: 0.17,
    sixteenthWeight: 0.10,
    thirtySecondWeight: 0.18,
    filterRadius: 1.00,
    enabled: true
  }
);
```

These values match `COMPUTE_BLOOM_DEFAULTS`:

- `threshold` (default `0.60`, range 0.0–4.0) is the linear HDR luminance at which bloom begins, including HDR values above 1.0.
- `softKnee` (default `0.40`, range 0.0–1.0) controls the smooth transition near the threshold; 0 makes the boundary sharp.
- `strength` (default `0.70`, range 0.0–4.0) scales reconstructed bloom before adding it to the scene.
- `halfWeight` (`0.45`) controls near-source light at 1/2 resolution.
- `quarterWeight` (`0.28`) controls the mid-range contribution at 1/4 resolution.
- `eighthWeight` (`0.17`) controls the broader 1/8-resolution contribution.
- `sixteenthWeight` (`0.10`) controls the broader 1/16-resolution contribution.
- `thirtySecondWeight` (`0.18`) controls the faint outer halo at 1/32 resolution.
- `filterRadius` (default `1.00`, range 0.25–3.0) sets tent-filter spacing in source-level pixels during progressive upsampling.
- `enabled` (default `true`) determines whether direct calls to `ComputeBloomPass.encode()` add reconstructed bloom to the output.

Each level weight is in the range 0.0–4.0 and is used as provided. Normalize the values in the application when a normalized total is needed. The defaults sum to 1.0 for the 1/2 through 1/16 levels, then add 0.18 for the outer 1/32 level. Increase high-resolution weights for near glow, lower-resolution weights for distant halos, and finally tune `strength` for total intensity.

`threshold` applies to linear HDR luminance before tone mapping, not display color normalized to 0–1. The implementation considers RGB luminance and the maximum channel, then retains the source RGB in proportion to its amount above threshold. This preserves hue and changes contribution smoothly near the threshold.

A clear tuning order is to select highlights with `threshold` and `softKnee`, set spread with level weights, smooth between levels with `filterRadius`, then set total contribution with `strength`. These values leave pyramid levels and dispatch count fixed. Set `bloomEnabled: false` in `ComputeEffectPipeline` to skip the effect entirely.

Bloom runs on the `rgba16float` HDR scene before tone mapping. Conversion to `rgba8unorm` compresses light above 1.0; keeping `rgba16float` distinguishes strong emission from a white material. Set display exposure once in the later tone-mapping stage rather than combining it with bloom settings.

## Record Surface Data Once in a G-buffer

Use a G-buffer to reuse the same surface data for SSAO, shadows, deferred lighting, SSR, and other effects. `GeometryBufferPass` draws opaque Shapes once and stores pre-lighting color, normal, material, and depth at the same pixel locations. Downstream effects can then refer to the same surfaces without redrawing geometry or reconstructing positions against different assumptions.

Here, “opaque” means a Shape whose surface is not blended with geometry behind it and whose foremost surface data can be stored per pixel. Glass and translucent particles that blend front and back colors use a separate path such as transparent forward rendering. A single G-buffer record describes an opaque surface. Such rendering is designed as a separate path, for example compositing forward-rendered transparent objects after deferred lighting of opaque surfaces.

| Attachment | Format | Contents |
|---|---|---|
| Albedo | `rgba8unorm-srgb` | Base color before lighting |
| Normal | `rgba8unorm` | View-space normal encoded into 0–1 |
| Material | `rgba8unorm` | `specular`, `roughness`, `metallic`, `occlusion` |
| Emission | `rgba16float` | Linear HDR emissive color |
| Depth | `depth32float` | Camera Reverse-Z depth |

Store albedo before lighting and keep lit color in deferred-lighting output. Deferred lighting evaluates albedo and surface material once, then passes HDR scene color to later effects. This lets SSAO visibility, shadow visibility, and SSR reflection remain independent contributions.

Create all four color attachments with the same dimensions, camera, and drawing moment. For example, carrying normals over from the previous frame would make a pixel's depth describe one surface and its normal another. Treat the G-buffer as one coherent record for a surface, rather than four unrelated images.

### Set Background Color in the Application

Pixels without geometry in the G-buffer also need a background color for the final image. `clearColor` passed to `GeometryBufferPass.renderSpace()` is interpreted as the same display-space sRGB color used by ordinary rendering. The pass converts it to linear and clears the `rgba8unorm-srgb` albedo attachment. Values are stored in sRGB encoding and decoded to linear when read later, so both geometry albedo and background reach deferred lighting in linear color.

`DeferredLightingPass` identifies an undrawn pixel by Reverse-Z depth 0. For the background, it skips view-position reconstruction, AO, shadows, and local lights, and passes the clear color to HDR output. It uses G-buffer albedo as linear HDR output. The application that supplies `clearColor` therefore controls the background rather than deferred lighting selecting a fixed blue-gray or gradient.

`clearColor` is interpreted as display-space sRGB and converted to linear color before lighting. The background passes through the same linear HDR path as geometry, then receives exposure, tone mapping, sRGB conversion, and saturation adjustment. With `mode: "reinhard"`, values below 1 are compressed too, so the displayed background can look darker than the specified color. Use `mode: "linear"` when comparing lighting or material colors close to their numeric values, then inspect the sRGB display after clamping to 0–1. Add a custom sky, environment map, or gradient through application background drawing or composition.

### Use View-Space Normals for Screen-Effect Alignment

View-space normals align the coordinate basis of a position reconstructed from screen depth with effects that use normals. Screen-space effects use the camera's forward, horizontal, and vertical axes; with G-buffer normals in view space, they can calculate dot products and reflection directions without extra coordinate conversion. Mixing world-space normals causes lighting, AO, and SSR directions to shift relative to the screen when the camera rotates.

Normal components in the range -1 to 1 are encoded into 0–1 for the `rgba8unorm` attachment. Diagnostic colors show normal XYZ as RGB rather than the material color. A flat surface changing smoothly as the camera rotates is a useful check that view-space normals are working.

### Use Complete Material Values to Predict Lighting

Material values provide gloss, roughness, metalness, and occlusion consistently to lighting. Emission has a separate `rgba16float` attachment rather than being packed into the 8-bit material attachment. Set `roughness` and `metallic` explicitly for G-buffer Shapes so lighting receives all surface inputs. Validating missing values at the point of use makes incomplete input visible instead of leaving a plausible-looking but unintended material.

```js
shape.setMaterial("smooth-shader", {
  has_bone: 0,
  use_texture: 0,
  color: [0.18, 0.62, 0.88, 1.0],
  ambient: 0.0,
  specular: 0.72,
  roughness: 0.20,
  metallic: 0.12,
  power: 48.0,
  emissive: 0.0
});
```

Use `color[3]` for texture mixing and `alpha` for opacity. Keep reflection properties in `specular`, `roughness`, and `metallic`. This keeps reflectance, transparency, and base color independently adjustable.

## Align Views with a Camera Frame

Use a camera frame to share the same view and projection at one instant between the G-buffer render pass and the Compute pass that reconstructs positions from its depth. Passing one frame object aligns normals, depth, AO, reflections, fog, and lighting pixel by pixel as the camera moves. It also avoids rebuilding `near`, `far`, view angle, and matrices independently for each pass.

Reconstructing distance from a Reverse-Z depth value requires the `near`, `far`, view angle, and aspect ratio that generated it. Re-reading camera position later makes it harder to verify projection consistency; share the original `cameraFrame` with downstream passes.

`WebgApp` finalizes a complete `cameraFrame` immediately before drawing and passes the same object to `onBeforeDraw` and `onAfterDraw3d`. For individual G-buffer passes, pass that object to both geometry and Compute processing:

```js
app.start({
  onBeforeDraw: ({ cameraFrame }) => {
    gbuffer.renderSpace(app.space, cameraFrame, app.clearColor);
  },

  onAfterDraw3d: ({ cameraFrame }) => {
    app.getGPU().endPass();
    const ao = ssaoPass.encode(
      app.getGPU().commandEncoder,
      gbuffer.getBindingResources(),
      { cameraFrame, enabled: true }
    );
  }
});
```

`SsaoPass` derives projection parameters from the supplied frame and validates that its depth convention is camera Reverse-Z. Reconstructing `near`, `far`, view angle, or the eye's world matrix independently could introduce a camera state different from the one used to create the G-buffer.

## Add Contact and Corner Depth with SSAO

SSAO adds reduced environment illumination around contacts between objects, floor/wall junctions, and complex corners. It approximates local occlusion that is difficult to represent with a shadow map using normals and depth already available in the G-buffer. This adds contact and depth cues without rendering geometry from another viewpoint.

SSAO returns environment-visibility values from 0 to 1 rather than completed scene colors. A value of 1 indicates no occlusion; a value approaching 0 indicates less environment light. Keeping it separate from color lets deferred lighting apply it to environment illumination without darkening material color or direct light.

```js
import { GeometryBufferPass } from "./webg/GeometryBufferPass.js";
import SsaoPass from "./webg/SsaoPass.js";

const gbuffer = new GeometryBufferPass(app.getGPU(), {
  width: app.screen.getWidth(),
  height: app.screen.getHeight(),
  colorMode: "material",
  normalSpace: "view"
});

const ssaoPass = new SsaoPass(app.getGPU(), {
  width: app.screen.getWidth(),
  height: app.screen.getHeight(),
  radius: 22,
  strength: 1.55,
  bias: 0.045,
  samples: 12,
  resolutionScale: 0.7
});

await Promise.all([gbuffer.ready, ssaoPass.ready]);
```

`radius` sets screen-space search radius, `strength` controls occlusion intensity, `bias` avoids counting the same surface as self-occlusion, `samples` sets the number of sample directions, and `resolutionScale` lowers the AO calculation's resolution. Bilateral filtering with normals and depth restores the final visibility to full resolution.

For each SSAO pixel, camera Reverse-Z depth is reconstructed using `near`, `far`, view angle, and aspect ratio from the camera frame to obtain a view-space surface position. The pass samples several directions around it and estimates occluding geometry from the center normal and sampled depths. Screen depth exposes only the foremost visible surface, so SSAO is a screen-space approximation that does not include the object's hidden side or off-screen occluders.

Simply linearly enlarging low-resolution AO would blur foreground darkness into the background. Bilateral filtering lowers weights when depth differs or normals diverge, even among nearby pixels. This restores low-resolution AO toward full resolution while limiting blur across silhouettes. Reducing resolution too far also removes input samples and cannot be repaired by upsampling; measure the quality/cost balance.

To display the standalone SSAO result, pass its visibility texture to `FullscreenPass`:

```js
onAfterDraw3d: ({ cameraFrame }) => {
  const gpu = app.getGPU();
  gpu.endPass();

  const aoVisibility = ssaoPass.encode(
    gpu.commandEncoder,
    gbuffer.getBindingResources(),
    {
      cameraFrame,
      enabled: true,
      radius: 22,
      strength: 1.55,
      bias: 0.045,
      samples: 12
    }
  );

  app.screen.beginPresentPass({
    clearColor: app.clearColor,
    colorLoadOp: "clear"
  });
  copyPass.draw(aoVisibility);
  app.screen.clearDepthBuffer();
}
```

SSAO itself does not combine visibility with color. Deferred lighting applies it to environment-light contributions. SSAO diagnostics inspect its calculation inputs and output; inspect the later composition to see completed scene color. To transfer a finished texture to the Canvas, use depth-free `beginPresentPass()`, then use `clearDepthBuffer()` to resume a Reverse-Z pass for `Font` or the HUD.

Run `book/examples/34_01.html` for a complete example. Its default view is the completed scene after applying G-buffer-derived AO to environment lighting and tone mapping, rather than the AO visibility alone. Press A to compare SSAO enabled and disabled, observing its effect in corners and contacts while material color and direct lighting remain intact.

Press V to switch to AO visibility diagnostics. White means unoccluded; dark areas receive less environment light. Keeping this an explicit diagnostic action avoids confusing SSAO visibility with the scene color after deferred lighting.

## Summary

Advanced screen effects read intermediate data such as the G-buffer, depth, normals, camera information, and HDR scene rather than only completed color. Making required inputs explicit and comparing standalone-pass output with the integrated result helps reveal coordinate and format mismatches early. Chapter 35 covers lighting, shadows, SSR, and fog; Chapter 36 covers DoF, visual styles, and GPU particles.
