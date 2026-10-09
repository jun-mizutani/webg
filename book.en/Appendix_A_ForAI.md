# For AI Coding Assistants

When developing an application for the first time, choose one starting point that fits the goal in [Development Entry Points and Runnable Examples](ExampleGuide.md). Use the same runnable pages, code, and checkpoints as a human reader. This appendix maps the references to use when investigating APIs and internal connections.

## Keep Core Imports Consistent

First determine whether the application uses individual `webg/` modules or
`lib/webg.core.min.js`. The bundle provides named imports such as `WebgApp` and
`Shape`; consult the book and original source for their API behavior.
When adapting a sample, use the same loading method in shared helpers,
re-exports, and dynamic imports. [Appendix C](Appendix_C_Bundle.md) gives the
conversion commands and checks.

## Guidelines for Assisting `webg` Users

This appendix helps AI coding assistants support developers building 3D applications with `webg`. Use the library's own design to decide what to read and in what order; do not directly transfer assumptions from another 3D engine or external library.

`WebgApp` coordinates initialization, the update loop, camera, input, UI, and drawing. `Space`, `Node`, `Shape`, and `ModelAsset` make up the 3D scene. These are shared by standard forward rendering and integrated physically based rendering (PBR).

webg 3.0 provides metallic-roughness PBR, image-based lighting (IBL), PBR G-buffers, transparent PBR, screen-space transmission, and general procedural textures. PBR connects material values, direct lights, high-dynamic-range (HDR) environments, pre-integrated IBL, camera state, shadows, screen-space effects, and tone mapping in a linear HDR pipeline.

The main rendering choice is how lighting and screen effects reach the final image, rather than how the geometry is constructed. Use standard forward rendering with `SmoothShader` for a small scene drawn directly. Use `ComputeEffectPipeline` when integrating a PBR G-buffer, IBL, multiple lights, SSAO, SSR, transparency and refraction, fog, bloom, and other effects into one HDR image. Both paths run within `WebgApp` and use the same `Space`, `Node`, `Shape`, camera, input, and UI.

```text
WebgApp
  ├─ initialization, update loop, camera, input, UI
  ├─ Space, Node, Shape, ModelAsset
  └─ choose lighting and final rendering path
       ├─ standard forward rendering
       │    └─ draw Shapes directly with SmoothShader
       └─ integrated PBR rendering
            └─ PBR G-buffer + ComputeEffectPipeline
                 ├─ direct light + IBL + shadows + SSAO
                 ├─ SSR + transparent PBR + transmission
                 └─ fog + bloom + tone mapping, and more
```

The top of the diagram is the application foundation. The lower branch chooses how the same scene and geometry are converted to the final image. Integrated PBR keeps the existing `WebgApp`, `Space`, and `Shape` foundation and connects `ComputeEffectPipeline` afterward. For a simple view, standard forward rendering keeps the setup compact even on a device that supports PBR and compute shaders.

`webg` is self-contained: rendering, scene management, models, animation, UI, input, physics, audio, diagnostics, and GPU computing live in the library. Prefer the book, `samples`, `headless_tests`, `unittest`, and current `webg` implementation over guesses such as “a typical WebGPU implementation probably…” or “Three.js works this way, so webg probably does too.”

General concepts can help explain an idea, but use webg documentation and implementation as the authority for public APIs, parameters, formats, lifecycle, and exception conditions. This appendix is a reading map for choosing chapters, samples, automated tests, browser proofs of concept, and core implementation according to the user's goal and the layer containing the issue. For PBR, determine how far the data is correct—from the G-buffer and lighting through IBL and transparency to final display—instead of guessing material values from the finished image alone.

## Start an Application from SceneYAML

For an application whose placement, PBR, and Compute physics are defined together, start with `createWebgSceneApp({ project: "./scene.yaml" })` from `webg/app/index.js`. `WebgSceneApp` builds on `WebgApp` and connects `SceneDefinition` validation, `PbrRenderer`, `ScenePhysics`, animation, and Node synchronization. Use `WebgApp` directly when constructing a custom rendering path.

SceneYAML describes a complete application: placement, inline meshes, materials, physics, and renderer settings. ModelYAML describes a reusable model: meshes, Node hierarchy, skeleton, and animation. They load as `SceneAsset` and `ModelAsset`, which inherit from `DocumentAsset` and share parsing, source-document, and comment preservation in `SceneYaml.js`.

Use `getSourceDocument()` to handle original YAML when editing or saving. If values have not changed, `toYAMLText()` returns the source. If values are changed while comments remain attached to the source, saving throws so that comments cannot silently become misaligned. Pass updated YAML source to `fromYAML()`. For conversion to JSON, set `allowCommentLoss: true` to make the comment-loss decision explicit.

For a physics-enabled inline mesh, define display geometry in `mesh` and its Box, Sphere, or Capsule collider in `physics.shape`. See Chapters 8–9 and `samples/model_yaml`, `samples/scene_model_yaml`, and `samples/edit_yaml`.

## Check PBR Materials and Lighting Together

PBR discussions often focus on material models for metals, plastic, ceramic, stone, and glass. The same material can look very different when light direction, distance, shape, size, environment highlights, or exposure changes. When gold appears gray, check metallic, roughness, Fresnel reflection, direct light, specular IBL, SSR, and tone mapping as well as base color.

webg uses the metallic-roughness workflow. A dielectric's base color primarily drives diffuse reflection; a metal's base color primarily supplies the color of specular F0. `specular` sets dielectric reflectance, `roughness` describes the distribution of microfacet normals, `metallic` blends dielectric and metal behavior, and `occlusion` describes environment visibility. Emission is a separate linear HDR color.

An environment map is both a background and input light from every direction. `PbrEnvironment` exposes the source radiance, diffuse irradiance, roughness-prefiltered specular environment, and BRDF LUT as GPU resources shared by deferred lighting, PBR SSR, and transparent PBR. With `environmentBackground: false`, IBL remains enabled while `clearColor` supplies the display background. Set fixed `ambient` to zero when environment light is active.

PBR calculations use linear HDR and apply tone mapping and sRGB conversion once immediately before display. Keep display sRGB values such as base color and clear color distinct from the linear HDR values after lighting. Place bloom, fog, SSR, and transmission before tone mapping; place edge and vignette effects after display conversion.

Use one light-unit system: `unitSystem: "relative"` for visual tuning within a scene, or `unitSystem: "photometric"` for photometric light output and EV100 exposure. When the image looks dark, inspect direct light, IBL, and exposure in that order.

`GltfShape` maps glTF 2.0 core inputs such as `baseColorFactor`, `metallicFactor`, `roughnessFactor`, Normal, Occlusion, Emissive textures, `emissiveFactor`, and `alphaMode`. Connecting `KHR_materials_transmission`, `KHR_materials_ior`, or `KHR_materials_volume` to screen-space transmission requires a separate mapping into webg's transparent and refraction settings. Distinguish glTF core support from webg-specific features.

## Keep `WebgApp` at the Center

### The Shared Application Foundation

`WebgApp` brings Canvas initialization, Screen, GPU context, scene, standard shaders, camera, input, Message, HUD, Overlay Panel, DebugDock, and frame processing into one application structure.

Both standard forward rendering and integrated PBR use the same foundation:

- Initialize GPU and application features with `await app.init()`.
- Manage the scene hierarchy and placement with `Space` and `Node`.
- Prepare 3D shapes with `Shape`, `Primitive`, and `ModelAsset`.
- Manage the view with `EyeRig` or the standard camera.
- Update application state in `onUpdate`.
- Handle keyboard, pointer, and touch with `InputController`.
- Present information and controls with HUD, Overlay Panel, and CommandPalette.

Switching rendering paths does not change the established workflow for model loading, Node movement, animation, camera control, or UI. When proposing a different lighting path, retain the shared application foundation and change the rendering path alone.

### Share Geometry and Placement Across Paths

`Space` manages the Node hierarchy. `Shape` holds vertices, normals, UVs, material slots, and per-triangle material indices. A model expanded from `ModelAsset` also enters the scene as Nodes and Shapes.

Standard forward rendering draws those Shapes with `SmoothShader`. Integrated PBR renders the same Space and Shapes to a PBR G-buffer with `GeometryBufferPass`, then evaluates lighting in later passes. The shader and output target change, while the model remains a `Node` and `Shape` in the same scene.

For integrated PBR, provide the surface material information expected by the G-buffer: base color, `specular`, `roughness`, `metallic`, `occlusion`, and emission. Missing values should surface as property-specific exceptions. Choose one emission input path: `emissive_factor` with optional `emissive_texture`, or the legacy scalar `emissive`.

## Choose Lighting and the Final Rendering Path

### Standard Forward Rendering

In standard forward rendering, `SmoothShader` evaluates lighting while drawing a shape and outputs directly to the Canvas. Its advantage is a short path and a compact setup.

Consider this path when:

- Displaying simple 3D shapes or models
- A small number of lights is sufficient
- The desired screen effects can be built without a G-buffer
- A small drawing setup and resource count are desirable
- `SmoothShader` material controls can produce the intended appearance

`WebgApp` manages camera state and the command encoder in the standard path. `ComputeEffectPipeline` connects the stages in integrated PBR. Keep simple `Space.draw(eye)` rendering on the standard forward path and group PBR G-buffers and frame state in the integrated pipeline path.

### Integrated PBR Rendering

Integrated PBR first stores opaque Shape surface data in a PBR G-buffer, then uses its textures for direct light, IBL, and screen effects. `ComputeEffectPipeline` connects G-buffer generation, shadows, SSAO, PBR deferred lighting, SSR, transparent PBR and transmission, fog, toon, DoF, bloom, tone mapping, edge, and vignette.

Material `alpha_mode` determines whether a surface is `OPAQUE`, `MASK`, or `BLEND`. If it is omitted, `alpha < 1.0` implies `BLEND`. The renderer treats `color[3]` as a texture-mixing value and uses `alpha` for transparency. Even when opaque and transparent triangles share one Shape, transparent triangles are gathered across Shapes and sorted back to front. Do not add a separate transparent render pass in application code. Let the internal `TransparencyPass` handle background blur controlled by `roughness`, GGX reflection on transparent surfaces, and transmission refraction and absorption.

Consider integrated PBR when:

- Several effects share a G-buffer.
- Metallic-roughness PBR and IBL belong in one pipeline.
- SSAO supplies contact shading.
- SSR adds screen-space reflections.
- Transparent surfaces share GGX with opaque surfaces and need refraction or volume absorption.
- Many lights or different light types are evaluated in later passes.
- Lighting, reflection, bloom, and DoF need a shared HDR range.
- The integrated API should own intermediate texture formats and pass ordering.

Integrated PBR also runs inside `WebgApp`. Call `pipeline.renderScene()` in `onBeforeDraw` and `pipeline.encode()` and final presentation in `onAfterDraw3d`. Pass the same `cameraFrame` to both:

```text
WebgApp state update
  -> onBeforeDraw: render shadow map and G-buffer
  -> onAfterDraw3d: record lighting and screen effects
                    present final texture to Canvas
                    return to depth-enabled HUD drawing
```

`ComputeEffectPipeline` is the integrated PBR entry point. Choose explicitly at the application entry point between standard forward and integrated PBR.

### Preserve the Integrated PBR Order

The order keeps the meaning of each input consistent:

```text
Shadow Map
  -> PBR G-buffer
  -> deferred lighting (direct light + IBL, linear HDR)
  -> SSR replaces visible specular IBL
  -> transparent PBR + transmission
  -> fog -> toon -> DoF -> bloom
  -> tone mapping + sRGB conversion
  -> edge -> vignette
  -> Canvas presentation -> HUD
```

In `composer.mode: "pbr-ssr"`, SSR replaces only the specular IBL where an on-screen intersection is found; original IBL remains where there is no hit. Transparent surfaces draw forward after the opaque G-buffer. `PbrForwardShader` shares `PbrBrdf.js` with opaque PBR and evaluates direct lights, shadows, and IBL with the same GGX model.

Transmission refracts from air into the medium at the entry, searches for the exit surface, refracts back into air, and samples the background. Apply Beer-Lambert absorption along the internal path. Choose `transmissionRayMissFallback` as `"auto"`, `"environment"`, `"clear"`, or `"constant"` for rays without a background hit. These modes define a visible fallback for data outside screen space.

`"environment"` requires environment radiance and reports a configuration error when it is missing. `"constant"` requires the display-sRGB `transmissionRayMissColor`. If no internal boundary is visible and an outward direction cannot be determined, use the clear color for modes other than `"constant"` rather than inferring an environment direction.

### GPU State Updates Are a Separate Application Pattern

GPU particles, cloth, physics, and procedural textures update GPU state before rendering. This is a separate concern from selecting a lighting path. Use `WebgApp` with `computeFrame: true` and `onComputeFrame`:

```text
WebgApp computeFrame
  -> compute passes update state
  -> render passes read the latest state
  -> submit command buffer
```

This path updates large amounts of state on the GPU and renders it without copying each result to the CPU. Choose the lighting path and GPU-simulation path independently.

## Understand the Self-Contained Design

`webg` connects rendering, scenes, models, animation, UI, input, diagnostics, and GPU computing with a consistent set of rules. The camera hierarchy is `cameraRig` → `cameraRod` → `eye`; scene geometry is `Space` → `Node` → `Shape`. `ModelAsset` → `build()` → `instantiate()` separates shared resources from instances, while `clip` → `pattern` → `action` → `state` separates animation stages.

First learn webg's own terms and the work assigned to each feature, then relate them to general 3D and WebGPU concepts. Applying general assumptions first can confuse the locations where depth rules, color spaces, camera state, and GPU resources are managed.

## Treat Procedural Textures as PBR Inputs

`ProceduralTileSpec` defines tile dimensions, pattern, grout, and surface appearance. `ComputeProceduralTile` generates Color, Height, and Normal on the GPU. `ProceduralMaterials` selects presets, retains generated data, configures PBR materials, applies them to Shapes, and disposes of resources.

```text
ProceduralTileSpec
  -> ComputeProceduralTile
       -> Color texture
       -> Height texture
       -> Normal texture
  -> ProceduralMaterial
       -> real-scale UV mapping and PBR material on a Shape
```

For real-scale tiles, stone, wood, or vinyl on a cuboid, use `Primitive.mapRealCuboid()` to create meter-based UVs on each face. `Primitive.mapCube()` is for image atlases. The `scale` in `createPreset()` scales the displayed texture period: `scale: 10` makes the pattern period ten times larger and reduces repetitions across a face to one tenth.

Call `ProceduralMaterial.applyTo(shape)` after `applyPrimitiveAsset()` and before `endShape()` uploads GPU data. Determine the meaning of the UVs first, then tune scale in real-scale mapping or the generated definition. Use CPU generation as a correctness reference, Compute generation for ordinary GPU use, and comparison/readback as verification operations.

## Technical Rules to Follow

### Use Consistent Graphics Terminology

Use “material” for the computer-graphics concept: `Shape` configuration, PBR surface properties, G-buffer inputs, glTF material, and material slot. Use “substance” or “physical material” only for real-world wall or floor composition when distinguishing it from a graphics material.

### 1. Initialization and Lifecycle

- Create GPU resources after `await screen.ready` or `await app.init()` completes.
- Access `app.space`, `app.eye`, and `app.getGPU()` after `app.init()` completes.
- Put per-frame application updates in `app.start({ onUpdate: ... })`.
- Register `onComputeFrame` together with `computeFrame: true`.

### 2. Finalize Shapes and Resources

- Call `shape.endShape()` after adding vertex data.
- `Primitive.cube()`, `Primitive.mapCube()`, and `Primitive.mapRealCuboid()` assign UVs with different meanings; choose the function for the intended mapping.
- For real-scale procedural material on a cuboid, use `Primitive.mapRealCuboid()` to assign meter-based UVs to every face.
- Call `ProceduralMaterial.applyTo(shape)` after `applyPrimitiveAsset()` and before `endShape()`.
- `ProceduralMaterials.createPreset().scale` sets the displayed size of one texture period.
- Call `ModelAsset.build()` to create runtime resources, then call `instantiate()` for as many placements as needed.
- Place one Shape multiple times by changing Node transforms rather than duplicating vertices.
- Assign one owner for resource creation, resizing, updates, and disposal.
- Treat resources created and managed internally by a Pipeline as Pipeline-owned.

### 3. Coordinates and Rotation

- Use the right-handed coordinate convention `+X = right`, `+Y = up`.
- Distinguish world `+Z` from a standard camera's local forward `-Z`.
- Check the asset or application convention for model forward direction.
- Follow `CoordinateSystem` for yaw, pitch, and roll.
- For large worlds, use a camera-relative model-view transform before converting coordinates to GPU float32.

### 4. Depth and Camera Frames

- Ordinary camera: `CAMERA_REVERSE_Z`, `depth32float`, clear 0, compare `greater`.
- Shadow Map: `SHADOW_STANDARD_Z`, clear 1, compare `less`.
- Keep ordinary camera depth and shadow depth distinct, including their Reverse-Z and Standard-Z conventions.
- `CameraFrame` freezes camera state for one render. Standard single-pass rendering uses `WebgApp` camera state; G-buffer and depth-dependent later passes share `CameraFrame` or `renderFrameToken`.
- Share a frame object or token only among later passes that read the same depth.
- Pass the same `CameraFrame` to `ComputeEffectPipeline.renderScene()` and `encode()`.
- Match shadow enablement and type between `renderScene()` and `encode()`.
- Prefer material `alpha_mode` for transparency classification; when omitted, classify from `alpha` and triangle material-slot indices.
- `TransparencyPass` composites transparent surfaces into HDR after SSR and before fog, toon, DoF, and bloom.
- Obtain near, far, FOV, and camera world matrix from `WebgApp` or the shared `CameraFrame`.

### 5. PBR Color and Light

- Determine whether base color, image textures, clear color, and `transmissionRayMissColor` use display sRGB or linear lighting values.
- Process PBR light, SSR, transparency, fog, DoF, and bloom in the linear HDR `rgba16float` range.
- Apply tone mapping and sRGB conversion once before final display.
- For a gray-looking metal, check `metallic`, IBL, direct light, and exposure as well as base color.
- With `lighting.environment`, set `ambient: 0.0` so there is one environment-light input.
- Apply `environmentRotationDegrees` consistently to radiance, irradiance, and prefiltered specular.
- `environmentBackground: false` keeps environment illumination while displaying `clearColor` as the background.
- In `composer.mode: "pbr-ssr"`, replace specular IBL where SSR finds a hit; do not add another copy of the same reflection.
- Treat emission as independent linear HDR color rather than base color receiving light.

### 6. Final Presentation Order

For standard single-pass drawing, use `clear` → `draw` → `present`. For an integrated path that presents a completed texture to Canvas:

```text
beginPresentPass()
  -> FullscreenPass.draw()
  -> clearDepthBuffer()
  -> draw HUD or subsequent Canvas content
```

`clearDepthBuffer()` returns to the depth-enabled Canvas pass used by the HUD after presenting the completed image.

### 7. Use Reproducible Randomness by Purpose

Use `util.MersenneTwister` for sequential particle values, audio noise, and probability decisions. It produces the same 32-bit output as `mt19937ar.c` from 2002. Use `util.hashUint32()`, based on lowbias32, for values derived from coordinates, part IDs, grid points, or arbitrary indices independently of call order.

Combine ordered integer values with `util.hashUint32Sequence()`. To map a hash to `[0, 1)` consistently in JavaScript and WGSL, use the same rule as `util.uint32ToUnitFloat()`, which takes the upper 24 bits. Since WGSL cannot call the JavaScript function, implement the same constants and 32-bit shifts in WGSL and verify known outputs.

Give separate uses independent MT19937 streams by hashing a use identifier from a base seed. For example, changing reverb generation should not change rests or modulations in the BGM. Use reproducible library randomness for simulations; use cryptographic randomness for secrets, tokens, or unpredictable identifiers.

- [Mersenne Twister](https://www.math.sci.hiroshima-u.ac.jp/m-mat/MT/MT2002/mt19937ar.html)
- [lowbias32](https://nullprogram.com/blog/2018/07/31/)

## References by Goal

Select the chapter, sample, and automated check that match the layer being investigated. Directory-only sample names below are under `samples/`.

- **First 3D object:** Chapters 4–5, `low_level`, `high_level`
- **Application foundation with WebgApp:** Chapters 5–6, `high_level`
- **Orbit, Follow, and first-person camera:** Chapters 5–6, `high_level`, `eye_rig`
- **Shapes and materials:** Chapters 7, 19, and 37–39, `shapes`, `materials`
- **Standard forward lighting:** Chapters 7 and 19, `SmoothShader`, `shapes`, `materials`
- **PBR, procedural materials, and screen effects:** Parts III–IV, `book/examples/33_01.html`, `pbr_reference`, `transmission`, `procedural_texture`, `texture_catalog`, `compute_json`
- **glTF, GLB, and Collada:** Chapter 8 and Chapters 10–11, `gltf_loader`, `collada_loader`
- **SceneYAML, ModelYAML, and application startup:** Chapters 5 and 8–9, `project_app`, `scene_model_yaml`, `model_yaml`, `edit_yaml`
- **Animation state transitions:** Chapters 10–11, `animation_state`, `janken`
- **HUD and UI panels:** Chapters 5 and 12–14, samples using `OverlayPanel` and `CommandPalette`
- **Input, raycasts, and collision:** Chapters 14–15, `unittest/raycast`, `headless_tests/core/physics_space`
- **Physics bodies, bounce, and friction:** Chapters 27–28, `physics_bounce`, `headless_tests/core/physics_space`
- **Compute physics:** body state on the GPU, fixed steps, ComputeCollider, Node synchronization, and direct GPU-state drawing; Chapters 27–28 and Part III, `samples/compute_physics`, `book/examples/27_02.html`, `book/examples/27_03.html`
- **Individual compute effects:** Chapters 20–22, 31–36; inspect image-pyramid bloom, DoF, shadow visibility, SSAO, and SSR as distinct stages
- **GPU particles, cloth, physics, and textures:** Chapters 20–22, `compute_particles`, `compute_cloth`, `compute_physics_bounce`, `compute_texture`
- **Low-level compute connection:** Chapters 20–22, `book/examples/20_01.html`, `webg/ComputePass.js`
- **Compute performance comparison:** Chapters 20–22 and 31–36, `compute_benchmark`

To understand integrated PBR, start with Chapter 30 for the meaning of materials, lights, IBL, and pre-integration, then use Chapters 31–33 and `book/examples/33_01.html` for the connection order. Chapter 29 covers procedural texture generation and real-world UV scale; Chapters 34–36 cover individual screen effects and performance. For transmission refraction, internal reflection, and ray-miss choices, see `samples/transmission`.

Samples with similar names can compare rendering paths or compute locations. `bloom` versus its Compute version, `dof` versus its Compute version, and `physics_bounce` versus `compute_physics_bounce` are separate examples for those comparisons. `samples/README.md` describes the purpose and maintenance rationale for public Compute samples.

## How to Find an API

When an API or usage pattern is unclear, search in this order rather than substituting an API from another library:

1. Find the class and feature in the [API catalog](Appendix_D_API.md).
2. Read the chapter for context, role, rationale, processing order, and constraints.
3. Check `samples/<name>/README.md` for the sample's purpose.
4. Inspect `main.js` and helper JavaScript for actual connections.
5. Check `headless_tests/core/<core_name>` for automatically tested behavior.
6. Find a browser proof of concept in `unittest`.
7. Inspect `webg/*.js` for the public API, errors, and resource management.

Useful searches include:

```sh
rg -n "ClassName|methodName|feature keyword" book.en book/*.md
rg -n "methodName|feature keyword" samples headless_tests unittest webg
rg -n "^export |export default|methodName" webg/*.js
```

To search API catalog headings, use `rg -n "^(##|###|####) " book.en/Appendix_D_API.md`. Class and file names often correspond as `webg/<ClassName>.js`. Exceptions include `formatJSON()` in `webg/JsonFormat.js`, UI themes in `webg/WebgUiTheme.js`, and Help/error option builders in `webg/OverlayPanelPresets.js`.

## Decide How to Add Compute Work

Compute shaders connect GPU work to the `WebgApp` frame. They can replace part of standard rendering or update GPU state. Choose the entry point according to the data and passes that the application needs to own.

### Use `ComputeEffectPipeline`

Use it when PBR G-buffer data feeds PBR deferred lighting and several screen effects in the standard order. The Pipeline creates intermediate textures and coordinates pass connections, resizing, and disposal.

### Use Individual Compute Passes

Use them to compare one effect, display intermediate output, or investigate a different order. The caller manages inputs, outputs, ordering, resizing, and disposal.

### Use `ComputePass` or `computeFrame`

Use these for custom WGSL, storage buffers, storage textures, and GPU simulation. `ComputePass.encode()` records work in a command encoder; the caller submits it with `queue.submit()`. The caller also creates the encoder and orders compute and rendering passes.

### Verify GPU Safety

- Keep WGSL `@workgroup_size` and JavaScript `workgroupSize` consistent.
- Add a bounds guard in WGSL when dispatch counts are rounded up.
- Consider ping-pong resources when reading previous state and writing next state.
- Specify binding indices, resource types, and texture formats.
- Keep HDR passes in `rgba16float` and apply display conversion once at the end.
- Resize resources that depend on display dimensions when the Canvas changes.
- Finish using a pass and its resources before calling `destroy()`.

Headless tests verify CPU-side behavior. Launch the example in a browser to verify WGSL compilation, Pipeline validation, and actual WebGPU output. People should assess image quality and interaction feel.

## Choose a UI Component

- Operation instructions or Help: `app.showOverlayPanel(buildHelpPanelOptions(...))`
- Dynamic values or status: `app.message.setLines("status", [...], options)` or HUD
- Dialogue or tutorials: `OverlayPanel` `buttons`/`choices` and application-side control
- Detailed error explanation: `buildErrorPanelOptions()` or an Overlay Panel with `format: "pre"`
- Infrequent configuration changes: `CommandPalette`
- Ongoing development diagnostics: `DebugDock`

Keep frequent controls in a HUD or fixed buttons and collect infrequent effect settings in `CommandPalette`.

## Prioritize Sources by Purpose

1. Use the API catalog for API names and owning classes.
2. Use the chapter for context, role, rationale, and constraints.
3. Use a sample README for purpose and application integration.
4. Use `headless_tests` for behavior that can be checked automatically.
5. Use `unittest` to inspect display, interaction, real GPU use, and browser APIs.
6. Use current `webg` source for final public API, error, and resource-management details.

Headless checks cover CPU-side behavior; browser checks cover WebGPU display and interaction. Combine them for boundary values, exceptions, and post-disposal state because each verifies different behavior.

## Keep API Layers Consistent

Choose one owner for resource creation, resizing, updates, and disposal. For an application driven by a scene definition, consider `WebgSceneApp`. For direct rendering control, consider `WebgApp`, `SmoothShader`, and `ComputeEffectPipeline`. Keep the frame processing of an existing `WebgApp`, and maintain the resource ownership convention when using raw WebGPU or individual passes. Report incomplete input through an exception that names the property and expected format.

`ModelAsset` is the shared representation of one model's meshes, skeleton, and animations. `SceneAsset` holds a SceneYAML or JSON application definition: placement, inline meshes, materials, physics, animation, renderer, and model references. Determine whether the task needs multiple placements of a model or save/restore of a full scene.

For animation issues, find whether the cause is in the clip, Action, AnimationState, or skeleton application. For rendering, inspect `SmoothShader` material settings in standard forward rendering; inspect G-buffer material, lights, environment, and Pipeline settings in integrated PBR. Change WGSL when existing configuration cannot express the required inputs or processing behavior.

## Diagnose in Order

Trace from the shared foundation toward final display:

1. Confirm `await app.init()` or `await screen.ready` completed.
2. Check JavaScript exceptions and WebGPU validation messages.
3. Confirm the `WebgApp` frame mode matches registered callbacks.
4. Inspect `Space`, `Node`, `Shape`, and camera state.
5. Identify standard forward or integrated PBR rendering.
6. In integrated PBR, inspect base color, normals, depth, `specular`, `roughness`, `metallic`, `occlusion`, and emission in the G-buffer.
7. Check `CameraFrame`, depth convention, and texture formats.
8. Compare direct light alone, IBL alone, and combined lighting to separate material and light issues.
9. For SSR, compare the original specular IBL with the replacement; for transmission, inspect entry, exit, background hit, and fallback separately.
10. After resizing, check that passes reference current resources.
11. If only the final image is black, inspect tone mapping, presentation, and fullscreen copy.
12. If the HUD disappears, check that `clearDepthBuffer()` returns to the Canvas pass.
13. For GPU state updates, check dispatch size, bindings, bounds guards, and submission order.
14. For performance, inspect GPU measurements in `compute_benchmark` and timings by PBR pass rather than relying on CPU time alone.

## Principles for AI-Assisted Work

1. Keep `WebgApp` at the center and preserve the shared scene, camera, input, and UI when adding advanced rendering or GPU work.
2. Start from the highest-level suitable API: consider `WebgSceneApp` and SceneYAML first, then use `WebgApp`, `ModelAsset`, or `ComputeEffectPipeline` when control requires it.
3. Learn design intent from this book and compare API behavior against current source, samples, browser proofs of concept, and tests.
4. Separate application, scene, shape, camera, lighting, UI, physics, compute, and final-display issues; include the active rendering path in the diagnosis.
5. Match checks to claims: automated tests, browser automation, and human visual inspection provide different evidence. Prefer application-side composition first; when a core defect or missing shared API is confirmed, update core, samples, tests, and documentation to one contract.

`webg` keeps design, implementation, samples, automated checks, and documentation in one system centered on `WebgApp`. Use this book as the primary map, select the rendering and GPU paths that fit the goal, and make evidence available to the developer.

## From a Single Feature to a Game

Start with [From a PBR Scene to a Small Game](PBRSceneToGame.md) and `samples/fantasy/README.md`. Run the existing game, then follow `start()` through scene setup, manually created Shapes, updates, selection, and disposal. Change material, movement allowance, walking time, and particle color one at a time to understand each function's responsibility. When connecting focused examples, keep the frame loop, particle update, and GPU-resource release under one owner.
