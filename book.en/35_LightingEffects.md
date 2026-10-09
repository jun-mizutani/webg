# Lighting, Reflections, and Fog

This chapter connects G-buffer surface data to direct lighting, shadows, reflections, and fog. It also shows how water and caustics share a wave model and join the PBR pipeline. For each feature, follow its inputs, output, and integration point before tuning appearance.

## How to read this chapter

### Prerequisites

This chapter is easier to follow if you know PBR from Chapter 30 and the G-buffer—the screen-space surface data used by lighting—and SSAO from Chapter 34. Chapter 41 documents camera and shadow depth conventions.

### What to read first

Start with the inputs and outputs of deferred lighting, shadow maps, SSR, and fog.

### What to read when you need it

Refer to many-light scenes, local lights, reflection intersections, backgrounds, and distance calculations when combining these features. To add water reflection/refraction or underwater caustics, continue to “Add Water and Caustics.”

### What you will learn

You can connect lighting, shadows, reflections, and atmospheric distance as separate screen-processing stages. You can also connect water and caustics to PBR independently and manage waves, absorption, receivers, and GPU-resource lifetime.

## Evaluate Many Lights with Deferred Lighting

Deferred lighting suits scenes where many dynamic lights illuminate complex geometry. It avoids redrawing every Shape for each light: first, draw opaque Shapes once into a G-buffer without lighting. Then, for each screen pixel, read albedo, normal, material, and depth, evaluate the contributing lights, and create an illuminated HDR scene color. Even as the number of lights grows, vertex transforms, rasterization, and material attachments are produced once. This separates geometry complexity from lighting complexity.

Each additional light increases lighting calculations and GPU cost. The current `DeferredLightingPass` evaluates enabled local lights sequentially per pixel, so lighting work grows with pixel count and light count. This still avoids repeating geometry processing for each light. Measure `lightCount` and render resolution; for larger scenes, tile-based or clustered light selection is a separate optimization.

`DeferredLightingPass` reads albedo, surface material, view-space normal, camera depth, AO visibility, shadow visibility, and lights. It distinguishes where each visibility value applies inside the lighting equation rather than multiplying visibility into color first. AO therefore reduces environment light, shadows block direct light, and emission stays bright.

The bidirectional reflectance distribution function (BRDF) uses the light direction, view direction, normal, and material to determine the amount of light reflected toward the camera. `DeferredLightingPass` uses GGX for specular reflection and a diffuse contribution weighted by Fresnel reflectance and metalness.

Conceptually, the result is:

```text
F0 = mix(0.04 × specular, albedo, metallic)
Environment diffuse = albedo × environment light × AO visibility × diffuse share
Direct light = GGX BRDF(albedo, normal, view, light, material) × shadow visibility
Emission = albedo × emissive
HDR scene = environment diffuse + direct light + emission
```

Environment lighting also uses Fresnel reflection and reduces diffuse contribution according to metalness. A fully metallic surface is primarily evaluated through specular environment reflection.

### Interpret Standard-Shader Values for Deferred Lighting

When moving from the standard `SmoothShader` path to deferred lighting, the same material property name and numeric value do not guarantee the same appearance. Both paths can draw the same Shape, but `SmoothShader` uses a compact Phong-style lighting equation while `DeferredLightingPass` uses GGX. Reinterpret the properties according to their role to distinguish material-model differences from defects.

| Property | `SmoothShader` | Deferred lighting |
|---|---|---|
| `color` | Base color used by the Phong-style lighting equation | sRGB base color converted to linear albedo and stored in G-buffer |
| `ambient` | Per-Shape minimum illumination and share of direct diffuse light | Scene-wide environment-light strength passed to `encode()`; not stored in G-buffer |
| `specular` | Strength of an added white highlight | Nonmetal normal-incidence reflectance `F0 = 0.04 × specular` |
| `power` | Sharpness of the Phong highlight | Unused |
| `roughness` | Unused | Roughness of GGX reflection |
| `metallic` | Unused | Splits albedo between diffuse color and metallic specular color |
| `emissive` | Moves the surface toward its base color independently of light and weakens specular | Adds `albedo × emissive` to normal lighting in the legacy scalar path |

From the user's perspective, `color` is the object's base color in both paths, but the calculations differ. `SmoothShader` uses the input in its lighting equation. The G-buffer path receives `color` and the color texture as sRGB, converts both to linear, and multiplies them. Deferred lighting, SSR, and bloom process linear HDR values; final tone mapping returns display-space sRGB. Both the lighting model and color-space/display conversion can affect the result.

`ambient` is particularly easy to confuse. Conceptually, `SmoothShader` preserves minimum illumination while assigning the remaining diffuse contribution to direct light:

```text
diffuse factor = ambient + max(dot(normal, light), 0) × (1 - ambient)
```

For a nonemissive surface facing the light, environment plus direct diffuse is about 1. Deferred-lighting `ambient` is a linear environment-light strength independent of direct light. It is combined after AO visibility, Fresnel, and the metalness-based reduction of diffuse contribution. Thus `ambient: 0.18` in each path is a coefficient in a different lighting equation.

`specular` also uses a different scale. `SmoothShader` uses `specular: 0.6` as a coefficient for adding a white highlight up to 0.6. Deferred lighting derives nonmetal F0 as:

```text
F0 = 0.04 × 0.6 = 0.024
```

This 0.024 is the proportion assigned to specular reflection when light strikes the surface head-on. Increasing `metallic` moves F0 from `0.04 × specular` toward albedo while reducing diffuse reflection. Tune deferred highlights using `specular`, GGX `roughness`, and lighting conditions together.

Use `power` in the standard path and `roughness` in deferred lighting to tune highlight width. A higher `power` and lower `roughness` both create narrower highlights, but Phong and GGX differ in their center, falloff, and grazing-angle behavior. During migration, retune `roughness` and `specular` to match the material intent rather than matching numeric values. Compare highlight widths to find a useful starting point.

One Shape can carry a complete material for both paths, including values one path does not read:

```js
shape.setMaterial("smooth-shader", {
  has_bone: 0,
  use_texture: 0,
  color: [0.72, 0.24, 0.10, 1.0],
  ambient: 0.18,   // Per-Shape value read by SmoothShader
  specular: 0.60,  // Read by both paths, with different roles
  power: 40.0,     // Phong-style highlight in SmoothShader
  roughness: 0.42, // GGX reflection in deferred lighting
  metallic: 0.0,   // Metalness in deferred lighting
  emissive: 0.0
});
```

For fixed environment light, pass deferred ambient strength through `lighting.ambient` to `DeferredLightingPass.encode()` or `ComputeEffectPipeline.encode()`, rather than through Shape `ambient`. With a photographed HDR `environment`, irradiance and prefiltered specular provide environment illumination, so set `ambient` to 0.

The following `0.035` is one example for a deferred-lighting reference image, not a mechanical conversion from `0.18`. Tune it with material, lighting, background, exposure, and tone mapping together.

```js
const comparisonHdrScene = deferredPass.encode(
  app.getGPU().commandEncoder,
  {
    ...gbuffer.getBindingResources(),
    shadowVisibility,
    spotShadowVisibility,
    ambientOcclusion: aoVisibility
  },
  {
    cameraFrame,
    directionalLight: null,
    spotLight: null,
    ambient: 0.035,
    lights,
    lightCount: lights.length,
    view: "lighting"
  }
);
```

Legacy scalar `emissive` remains useful when comparing with forward rendering. PBR textures and glTF materials use colored `emissive_factor` and optional `emissive_texture` to create an independent HDR emissive color. In `SmoothShader`, values closer to 1 weaken ordinary lighting and move toward a base-color-only appearance. In the legacy deferred scalar path, `albedo × emissive` is added to normal lighting, so direct light remains at `emissive: 1.0`. PBR inputs multiply the linearized emissive texture and factor, then store them in a separate `rgba16float` attachment. Before sharing emission values between paths, decide which composition is intended.

See `samples/materials` for the actual difference. It displays a 4×4 set of spheres, varying `roughness` and `power` by row and `specular` and `metallic` by column. The command palette switches rendering paths and values, showing that the standard path does not read `roughness` or `metallic`, and deferred lighting does not read `power`. The sample uses linear clipping for deferred display so Reinhard compression does not mix with the lighting-model comparison.

Local lights use one array for omnidirectional `point` lights and directional-cone `cone` lights:

```js
import DeferredLightingPass from "./webg/DeferredLightingPass.js";

const deferredPass = new DeferredLightingPass(app.getGPU(), {
  width: app.screen.getWidth(),
  height: app.screen.getHeight(),
  maxLights: 128
});
await deferredPass.ready;

const lights = [{
  type: "point",
  position: [0.0, 2.5, -4.0],
  color: [1.0, 0.55, 0.18],
  radius: 9.0,
  intensity: 3.2
}, {
  type: "cone",
  position: [4.0, 6.0, -2.0],
  direction: [0.0, -1.0, 0.0],
  color: [0.45, 0.72, 1.0],
  radius: 12.0,
  intensity: 2.4,
  innerAngle: 32.0,
  outerAngle: 48.0
}];

const hdrScene = deferredPass.encode(
  app.getGPU().commandEncoder,
  {
    ...gbuffer.getBindingResources(),
    shadowVisibility,
    spotShadowVisibility,
    ambientOcclusion: aoVisibility
  },
  {
    cameraFrame,
    directionalLight: {
      direction: [0.35, -1.0, -0.25],
      color: [1.0, 0.96, 0.88],
      intensity: 1.0
    },
    spotLight: null,
    ambient: 0.10,
    lights,
    lightCount: lights.length,
    view: "lighting"
  }
);
```

Pass `directionalLight` and `spotLight` explicitly as `null` when unused. This distinguishes an intentionally unused source from an omitted configuration. Each local light requires `type`, `position`, `color`, `radius`, and `intensity`. Supply `position` in world space; the pass uses `cameraFrame` to convert it to camera-relative view space. A `cone` also needs a world-space `direction`, `innerAngle`, and `outerAngle` in degrees. Valid angles satisfy `0 < innerAngle < outerAngle <= 90`; intensity stays at 1 inside `innerAngle`, falls smoothly to 0 between angles, and is 0 outside `outerAngle`. A valid cone setting selects cone-light behavior rather than point-light behavior.

### Tune Local Lights

When lighting is dark, distinguish light energy, reach, cone angle, and environment light before adjusting the whole screen. They can create similar impressions but affect different regions and costs.

| Setting | Effect | Notes |
|---|---|---|
| `intensity` | Increases direct light on pixels within the current `radius` and cone | Leaves reach and cone angle unchanged |
| `radius` | Extends the cutoff and reduces attenuation at a given distance | Can increase the number of affected pixels; cone angle is unchanged |
| `outerAngle` | Widens the cone edge and the directions reached by light | Keeps intensity inside `innerAngle`; retain `innerAngle < outerAngle <= 90` |
| `lighting.ambient` | Increases environment diffuse light across the scene, including areas with weak local light | Direct-light reach is unchanged; AO, Fresnel, and metalness-based diffuse reduction still apply |

For distance $d$ and radius $r$, local-light attenuation is conceptually:

```text
attenuation = max(1 - d / r, 0)²
direct radiance = light color × intensity × attenuation × angular attenuation
```

Increasing `radius` both extends light reach and brightens surfaces at the same distance. Use `intensity` when changing brightness alone; use `radius` to widen dark gaps between lights.

For a cone, angular attenuation is 1 inside `innerAngle`, falls smoothly to 0 between the inner and outer angles, and stays 0 outside `outerAngle`. Increase `innerAngle` to widen the bright center; increase `outerAngle` to widen the lit edge. A wider cone can make more pixels evaluate direct light, so check GPU time as well as appearance.

Deferred environment light is passed through `lighting.ambient` in `DeferredLightingPass.encode()` or `ComputeEffectPipeline.encode()`, not through Shape `ambient`. An application constant such as `DEFERRED_AMBIENT` is application-specific; the API value means `lighting.ambient`. Environment light differs from emission and direct light. On fully metallic surfaces, albedo-based diffuse environment light is zero while energy is assigned to specular reflection.

Tune in this order:

1. Increase `intensity` when a lit surface itself is too dark.
2. Increase `radius` when lighting ends abruptly between sources.
3. Increase `outerAngle` when only the sides of a cone are too dark.
4. Increase `lighting.ambient` when the base illumination is low throughout, including areas outside direct lights.
5. Tune exposure and tone mapping last, checking that display conversion is not hiding a lighting-value issue.

The cone defines the light's emission shape; shadow evaluation handles geometric occlusion. A wall blocks the cone only when shadow visibility is also present. Switch `view` to values such as `"albedo"`, `"normal"`, `"depth"`, `"shadow"`, `"ao"`, or `"roughness"` to inspect inputs that are difficult to distinguish after lighting.

## Represent Direct-Light Occlusion with Shadow Maps

Use a shadow map to block direct light from surfaces hidden from the light and show shadows cast onto floors and walls. SSAO approximates environment-light occlusion from nearby screen-visible surfaces; shadow maps render the scene from the light view and can include occluders outside the camera view. Resolving to a visibility value separate from color lets deferred lighting apply shadows to direct light only.

Directional and spot shadow maps store the nearest depth from the light view. Camera depth uses Reverse-Z, while `ShadowMapPass` and `SpotShadowMapPass` intentionally use `SHADOW_STANDARD_Z`:

```text
Camera depth: depth32float / clear 0 / greater / near 1 / far 0
Shadow depth: depth32float / clear 1 / less / near 0 / far 1
```

Shadow resolve reconstructs the receiver's view-space position from camera Reverse-Z depth, transforms it to light space, and compares it with conventional-Z shadow depth. Each depth texture follows its own convention; the shadow map uses Standard-Z `less`.

For fixed directional-light bounds, use `createDirectionalLightMatrices()`. To follow the camera frustum, configure `shadow.directional.fitMode: "frustum-fit"` in the integrated pipeline. It transforms the camera's eight corners into light space, builds an axis-aligned bounding box (AABB) for projection, and stabilizes bounds in texel increments. `fitFar` must not exceed camera `far`; an out-of-range value raises an error instead of being silently reduced.

At low level, `ShadowMapPass` first generates light-view shadow depth. `ComputeShadowPass` then compares it with the receiver surfaces in the G-buffer and produces visibility. It outputs visibility rather than color, so deferred lighting can apply it to direct light only.

```js
const shadowVisibility = shadowPass.encode(
  app.getGPU().commandEncoder,
  {
    normal: gbufferResources.normal,
    depth: gbufferResources.depth,
    ...shadowMap.getBindingResources()
  },
  {
    cameraFrame,
    lightViewProjection: lightMatrices.viewProjection,
    lightDirection: [0.35, -1.0, -0.25],
    bias: 0.0015,
    normalBias: 0.003,
    pcfRadius: 1,
    enabled: true
  }
);
```

`bias` absorbs numeric precision errors in the shadow-depth comparison. `normalBias` offsets the receiver along its normal to reduce self-shadowing acne. Excessive bias makes shadows appear detached, so tune it against resolution and scene scale. `pcfRadius` ranges from 0 to 2; higher values soften edges and increase samples.

## Add Screen-Space Reflections at Low Cost

SSR adds reflections of objects and lights currently visible in the image to floors, metal, water, and other surfaces. It reuses the G-buffer and lit HDR scene instead of rendering a second view, reflecting moving objects and lights with a relatively small additional setup.

SSR creates a reflection ray from view-space position and normal, then searches the screen for an intersection with camera Reverse-Z depth. In PBR integration mode, output RGB is linear HDR radiance at the hit and alpha is hit confidence. The compositor gets Fresnel and specular weight from the shared BRDF. Rather than simply adding SSR on top of specular IBL already present in deferred lighting, it replaces IBL only where SSR hits. `mix` and `add` remain useful for legacy paths without IBL or for artistic composition.

The reflection ray is generated by reflecting the incoming view direction around the G-buffer normal. Points along the ray are projected to screen coordinates and compared with surfaces reconstructed from depth. On a hit, the pass samples the lit HDR scene color.

```text
View-space position and normal
  -> reflection ray
  -> project to screen UV
  -> intersect camera Reverse-Z depth
  -> sample HDR scene color at the hit
  -> calculate hit confidence from distance and screen edges
  -> replace specular IBL with SSR using the PBR reflection weight
```

The depth texture has no geometric thickness, so `thickness` sets the tolerated intersection range. Too little can let the ray pass between steps; too much can classify separated surfaces as a hit. Tune `distance`, `steps`, and `thickness` together relative to scene scale.

SSR uses the screen-visible opaque surfaces as reflection data. Off-screen and fully hidden surfaces are absent, so environment reflection such as IBL fills those areas. This is a screen-space limit; use environment data for complementary reflection instead of adding an arbitrary strong color to hide missing information.

Reflection blur and intensity follow material `roughness`. `ComputeSsrPass` builds a 1/2, 1/4, and 1/8 image pyramid and interpolates between neighboring levels using G-buffer roughness. Smooth surfaces retain sharp reflections; rougher surfaces use lower-resolution reflection color. Reflection-weight alpha retains the current pixel value, preventing neighboring surface reflectivity from bleeding into it.

```js
import ComputeSsrPass from "./webg/ComputeSsrPass.js";

const ssrPass = new ComputeSsrPass(app.getGPU(), {
  width: app.screen.getWidth(),
  height: app.screen.getHeight(),
  resolutionScale: 0.7,
  reflectivityThreshold: 0.05
});
await ssrPass.ready;

const reflection = ssrPass.encode(
  app.getGPU().commandEncoder,
  {
    scene: hdrScene,
    normal: gbufferResources.normal,
    depth: gbufferResources.depth,
    material: gbufferResources.material
  },
  {
    cameraFrame,
    intensity: 0.82,
    distance: 42.0,
    thickness: 0.42,
    steps: 48,
    resolutionScale: 0.7,
    reflectivityThreshold: 0.05,
    view: "reflection",
    enabled: true
  }
);
```

`distance` sets maximum ray length, `steps` is the base coarse-search count, and `thickness` is the tolerance for a depth hit. More distance or steps does not automatically improve results; too few steps for the search distance can skip thin objects. `reflectivityThreshold` is an early-out for pixels with little reflectivity. `resolutionScale` applies to ray output, roughness pyramid, and final reflection target; the G-buffer remains at full resolution.

Reflections use `rgba16float`. In the standard PBR configuration, `ComputeEffectComposer` uses `pbr-ssr` to calculate `base + (SSR specular - specular IBL) × confidence` in linear HDR. At ray misses and screen edges, confidence is 0 and the same HDR environment specular remains. Preserve HDR after composition until tone mapping.

## Represent Atmospheric Depth with Fog

Fog moves surfaces toward a fog color with camera distance, adding atmospheric thickness, depth, and weather to the whole image. Instead of repeating a fog calculation in each Shape shader, `ComputeFogPass` processes the linear HDR scene once after lighting and transparent composition. In deferred rendering, keep full-screen fog in this pass rather than layering it with forward fog.

Fog reads an `rgba16float` scene color and camera Reverse-Z depth from the G-buffer. It reconstructs view-space position with the same `cameraFrame` used to create depth, then uses the position length as distance from the camera. Output remains `rgba16float`, so toon shading, DoF, and bloom can follow before tone mapping.

```js
import ComputeFogPass from "./webg/ComputeFogPass.js";

const fogPass = new ComputeFogPass(app.getGPU(), {
  width: app.screen.getWidth(),
  height: app.screen.getHeight()
});
await fogPass.ready;

const foggedColor = fogPass.encode(
  app.getGPU().commandEncoder,
  {
    scene: transparentComposite,
    depth: gbufferResources.depth
  },
  {
    cameraFrame,
    mode: "linear",
    color: [0.10, 0.15, 0.20],
    near: 20.0,
    far: 80.0,
    density: 0.03,
    enabled: true
  }
);
```

`mode` is `"linear"` or `"exp"`. Linear mode preserves scene color up to `near` and increases fog toward `far`. In the current implementation, `density` also scales linear fog amount with `clamp(density * 50, 0, 1)`. The default `density: 0.03` gives a factor of 1, applying the full near-to-far transition; values below 0.02 weaken fog across the same distance range.

Here, `near` and `far` are fog distances, not camera projection planes. `projectionNear` and `projectionFar` from `cameraFrame` reconstruct depth; set fog start and end distances separately for the scene scale and desired atmosphere.

Exponential mode calculates visibility as $e^{-density \times distance}$. Higher `density` makes fog thicker over a shorter distance. `near` and `far` do not affect this mode's appearance, but its shared input contract requires `near >= 0` and `far > near`. `color` is a three-component linear fog color with nonnegative channels.

| Setting | Default | Meaning |
|---|---:|---|
| `mode` | `"linear"` | Method for deriving visibility from distance |
| `color` | `[0.1, 0.15, 0.1]` | Fog color blended in linear HDR |
| `near` | `20.0` | Distance where linear fog begins |
| `far` | `80.0` | Distance where linear fog reaches fog color |
| `density` | `0.03` | Exponential density or linear-fog amount |
| `enabled` | `false` | Whether to apply fog |

Fog runs after transparent composition. This applies it to the composited scene in one full-screen pass rather than separately redrawing glass or translucent particles with forward fog. In the ordinary path without a rendered water surface, its depth reference is opaque G-buffer depth: transparent surfaces do not replace that depth, so their pixels use the distance to opaque surfaces behind them as an approximation.

Pixels with background depth 0 and no opaque surface skip distance calculation and preserve the transparent-composited color. Fog therefore applies through the distance to opaque surfaces, while background stays a clear or environment color. To fog a sky or custom background, define its distance or another composition rule in the application. Per-layer fog distances for multiple transparent surfaces are outside this pass.

When switching between standard forward rendering with `WebgApp.setFog()` and PBR integration, move settings to `ComputeFogPass` or `ComputeEffectPipeline` from Chapters 31–33. Enabling both would apply fog twice to forward-rendered and full-screen results; assign one path to own fog for a given scene.

## Add Water and Caustics

### Choose an Example and Compare the Display

Caustics are patterns of light and shadow formed when waves refract and concentrate light. To compare water-surface reflection/refraction and caustics settings individually, follow the guide in `samples/water/index.html` to `samples/water/water.html`. First inspect normal PBR with both features off, then compare caustics only, water only, and both on.

For moving units, use `samples/fantasy/fantasy.html`. It disables surface rendering and represents a submerged fortress with caustics, blue-green directional light, distance fog, and drifting particles. The controls on the right toggle caustics. This is an underwater lighting treatment that preserves readable grid cells, rather than refractive rendering from an underwater camera. The connection is in `connectWater()` in `samples/fantasy/main.js`.

### Shared Wave and Lighting Model

`WaterBody` stores a water region, waves, absorption coefficients, and receiving Shapes/Nodes. Connecting it with `setWater()` on `ComputeEffectPipeline` or `PbrRenderer` lets surface and caustics share wave height, gradient, and time. There is no need to replace shader strings or patch internal drawing functions.

Caustics refract light from the water surface on the GPU and accumulate flux on a horizontal reference plane to produce relative illumination. It maps that illumination to registered objects using their positions and normals, replacing only direct diffuse reflection. Specular, environment light, local lights, and emissive continue through the existing PBR path. This changes material response differently from applying a pattern as an emissive texture; a highly metallic armor surface may show less caustics than rough stone.

Projection onto 3D objects is approximated from the horizontal reference plane. It does not depend on object UVs and follows movement or orientation through receiver rendering each frame. It does not retrace light against each object's geometry. Projection applies to upward-facing normals, so top-down light does not create caustics on vertical surfaces. The same wave height determines underwater state, blended smoothly at the waterline using `waterlineFade`.

### Connect to an Initialized Scene

The following example connects water after `WebgSceneApp` initialization and before `sceneApp.start()`. Pass scene objects already created as `floorShape` and `objectNode`. `WaterBody` is also available through `webg/app/index.js`.

```js
import WaterBody from "../../webg/WaterBody.js";

const renderer = sceneApp.renderer;
const pipeline = renderer.pipeline;

// This caustics version supports a directional light from directly above
pipeline.lightOptions.direction = [0, -1, 0];
pipeline.shadowOptions.directional.up = [0, 0, 1];

const water = new WaterBody({
  origin: [0, 0, 0], width: 8, depth: 8, surfaceHeight: 2,
  amplitude: 0.15, wavelength: 0.75, speed: 1.3,
  waveMix: [1, 0.4, 0.2], absorption: [0.12, 0.05, 0.025]
});
water.addReceiver(floorShape);
water.addReceiver(objectNode, { strength: 0.7 });

// setWater() prepares GPU resources; wait for it before starting frames
await renderer.setWater(water, {
  surfaceEnabled: true, causticsEnabled: true, quality: "low"
});

// Add this to the existing onUpdate({ deltaSec }); do not create another loop
function updateWater({ deltaSec }) {
  water.setTime(water.time + deltaSec);
}
```

When creating `ComputeEffectPipeline` directly, pass `lightDirection: [0, -1, 0]` and `shadow: { directional: { up: [0, 0, 1] } }` to its constructor. A high-level renderer manifest does not accept `lightDirection`; set `renderer.pipeline.lightOptions.direction` after initialization as above. Connect water with `setWater()` rather than declaring it as a manifest key. Surface display alone can use a diagonal directional light.

`addReceiver(shape)` registers that Shape; `addReceiver(node)` includes children by default. Register a unit's parent Node to inherit registration for animated feet, limbs, and equipment. `children: false` selects only the registered Node. Shape registration takes precedence; for Nodes, the nearest registered ancestor is used. `strength` ranges from 0 to 1. Omit a selection marker, or override it with `strength: 0` when an ancestor is registered. Use `removeReceiver(target)` to remove one target and `clearReceivers()` to remove all.

### Change Wave Height, Scale, and Color

Change waves or absorption with `water.setOptions()`; reconnecting with `setWater()` is unnecessary. `setTime()` uses seconds. The same time produces the same wave and caustics pattern.

- `amplitude`: upper bound of the combined wave displacement in meters, not the crest-to-trough difference.
- `wavelength`: wavelength multiplier; smaller values make finer waves and larger values make wider waves.
- `speed`: time multiplier; 0 pauses waves and 1.3 advances them 1.3 times as fast.
- `waveMix`: relative strengths of crossing waves, swell, and ripples; nonnegative values are normalized to sum to 1.
- `variation`: continuous phase and amplitude modulation, 0–1; it is not frame-by-frame randomness.
- `absorption`: RGB absorption coefficients in 1/m; larger channels absorb that color more strongly.
- `roughness`: roughness for water-surface specular and environment reflection; it has no effect on caustics alone.

For example, `samples/water/main.js` uses:

```js
water.setOptions({
  amplitude: 0.15, wavelength: 0.75, speed: 1.3,
  absorption: [0.12, 0.05, 0.025]
});
```

Red is absorbed more strongly than blue, giving objects viewed through the surface a subtle blue tint. For greenish water, use `absorption: [0.07, 0.015, 0.07]`. Surface rendering attenuates RGB channels separately according to underwater view distance. The caustics image is scalar illumination and uses average RGB attenuation for incident light. Changing absorption for caustics alone does not paint an RGB water color.

`origin` is the center of the horizontal illumination reference plane; `width` and `depth` define its XZ bounds. `surfaceHeight` is the mean world-space water Y; mean water depth is `surfaceHeight - origin[1]` and should exceed `amplitude`. `extent` is the side length used for illumination and should exceed both width and depth to leave room for light near the boundary. Invalid values raise an error and preserve the previous valid settings when `setOptions()` is called.

### Render Order for Water and Screen Effects

The water surface reflects the current PBR environment and directional light, and composites screen-space refraction and RGB absorption in HDR.

Transparent underwater surfaces and Compute particles are included in the refracted background; surfaces and particles in front of the water are drawn after the water surface. Particle state updates once per frame. Fog, DoF, bloom, tone mapping, and edge effects follow composition. Effects using depth and normals receive values that include the water surface. The opaque G-buffer remains unchanged.

### Check Toggle Behavior and GPU Cost

`surfaceEnabled` and `causticsEnabled` both default to `false`. Enable either independently or turn both on. `quality` sets caustics resolution: default `high` uses 1024×1024 rays and a 512×512 illumination image; `low` uses 512×512 rays and a 256×256 illumination image. This setting is separate from water-surface display resolution.

When switching during a run, stop creating frames, await `setWater()`, then resume. Game rules, Nodes, and `WaterBody` time/receivers do not need rebuilding.

```js
sceneApp.stop();
try {
  await sceneApp.renderer.setWater(water, {
    surfaceEnabled: false, causticsEnabled: false
  });
} finally {
  sceneApp.start();
}
```

Turning off both the surface and caustics, or calling `await renderer.setWater(null)`, releases dedicated GPU resources and the additional lighting variant and returns to regular PBR. Receiver registrations remain on `WaterBody` for reuse. Surface-off skips surface composition and its dedicated depth processing; caustics-off skips illumination generation and receiver masks. Illumination can be reused while wave settings and time are unchanged, while receiver masks update as objects move. If there are no receivers, caustics illumination generation and receiver rendering are also skipped.

Use `renderer.getWaterStats()` or `pipeline.getWaterStats()` to inspect enabled states, caustics and surface dispatch counts, receiver and depth pass counts, and `timing`. With both off, dedicated counts are zero and `timing` is null. GPU timestamps are available only on supported environments and do not represent total frame time, including receiver masks and added lighting. In manually submitted configurations, call `afterGpuSubmit()` after submit; standard callbacks handle this automatically. The validation controls in `samples/water/` check receiver selection, screen effects, and images/resources when disabled. Keep validation readback separate from normal frame drawing.

### Scope for an Underwater Game

Water-surface rendering supports viewing one finite horizontal water area from above. It does not model an underwater camera, water sides, off-screen refraction, mirror images of surrounding objects, or physically combined refraction with underwater Frost, Transmission, and Volume effects.

`samples/fantasy/` sets `surfaceEnabled: false` and registers terrain and units in an 18 m wide and deep water region, with reference plane at Y=-2 m and mean water at Y=6 m. Wave amplitude is 0.15 m, wavelength multiplier 0.9, speed 1.3, and `waveMix: [1, 0.2, 0.12]`. Selection rings and movement ranges are omitted from receivers. Blue-green background and directional lighting combine with exponential fog in `pipeline.fogOptions`. This fog approximates turbidity by view distance rather than RGB view-path absorption per object.

Read `connectWater()` for initial setup, `update()` for time updates, and the checkbox's stop → configure → resume sequence. After toggling caustics, try movement over steps, shooting, enemy turns, and restarting to check that added lighting preserves game state and rendering ownership. `PBRSceneToGame.md` describes the overall reading order.

## Summary

Deferred lighting reads G-buffer surface information and evaluates lights per pixel. Shadows and SSAO produce visibility, SSR adds screen-visible reflection, and fog adds distance-dependent atmosphere after composition. Water and caustics share `WaterBody` and can be added independently to ordinary PBR. Choose surface refraction or underwater lighting according to the scene, then verify receiver registration, update, and release.

Chapter 36 covers focus, visual style, screen edges, and GPU particle updates.
