# Appendix A For Coding AI

## Guidelines for Supporting `webg` Users

This appendix is written for coding AI systems that help users build 3D applications with `webg`. The expected role of the AI is not to apply general knowledge from common 3D engines or external libraries directly, but to act as a guide that understands the self-contained design of `webg` and can decide what to inspect and in what order.

This book targets `2.0.0 beta`. The public APIs and rendering sequence are feature-frozen as of July 20, 2026.

In an application built with `webg`, `WebgApp` first integrates initialization, the update loop, camera control, input, UI, and rendering timing. The 3D content is built from `Space`, `Node`, `Shape`, and `ModelAsset`. This part remains the same for both the forward rendering path and the deferred rendering path that uses compute processing.

The major decision is not how to build the shapes, but which rendering path should handle lighting and screen effects. Use the forward rendering path when the application draws the scene normally with vertex and fragment shaders through `SmoothShader`. Use the deferred rendering path with `ComputeEffectPipeline` when the application needs advanced lighting, SSAO, SSR, or multiple downstream effects. Both paths fit inside the `WebgApp` frame lifecycle.

```text
WebgApp
  ├─ Initialization, update loop, camera, input, UI
  ├─ Space, Node, Shape, ModelAsset
  └─ Lighting and final rendering path
       ├─ Forward rendering path
       │    └─ Direct lighting with SmoothShader
       └─ Deferred rendering path
            └─ G-buffer + ComputeEffectPipeline
```

The upper part of this diagram is the shared application foundation. The lower branch shows how the same scene and shapes are converted into the final image through different lighting paths. Choosing the deferred rendering path does not require discarding `WebgApp`, `Space`, or `Shape` and rebuilding the application as raw WebGPU code. Conversely, the availability of Compute Shaders does not mean that every simple screen should be moved to the deferred rendering path.

An important property of `webg` is that it does not depend on an external 3D library. Rendering, scene management, models, animation, UI, input, physics, audio, diagnostics, and GPU processing are implemented inside the project. When assisting users, prefer the current book, `samples`, `headless_tests`, `unittest`, and the `webg` implementation over guesses such as "WebGPU is usually implemented this way" or "Three.js does this, so `webg` probably does the same."

General knowledge can help explain concepts, but the final authority for public APIs, arguments, formats, lifecycle rules, and error conditions is the project documentation and implementation. The purpose of this appendix is to provide a reading map that helps an AI choose the relevant chapter, sample, automated test, browser POC, or core source file based on what the user wants to build and which layer contains the problem.

## Put `WebgApp` at the Center

### Shared Application Foundation

`WebgApp` is more than a helper that initializes a canvas. It combines Screen, the GPU context, scene management, standard shaders, the camera, input, Message, HUD, Overlay Panel, DebugDock, and the frame lifecycle into one application structure.

The following work is shared whether the user chooses the forward rendering path or the deferred rendering path.

- Initialize the GPU and application features with `await app.init()`.
- Manage the scene hierarchy and placement with `Space` and `Node`.
- Prepare 3D content with `Shape`, `Primitive`, and `ModelAsset`.
- Manage the view with `EyeRig` or the standard camera.
- Update application state in `onUpdate`.
- Handle keyboard, pointer, and touch input through `InputController`.
- Present information and controls through HUD, Overlay Panel, and CommandPalette.

Changing the rendering path does not require replacing model loading, Node movement, animation updates, camera control, or UI construction with another framework. An AI should not propose rebuilding an entire application merely because the lighting path changes.

### 3D Shapes and Placement Are Shared

`Space` manages the Node hierarchy, while `Shape` holds vertices, normals, UVs, multiple material slots, and the material-slot index used by each triangle. Models expanded from `ModelAsset` are also placed in the scene as Nodes and Shapes.

In the forward rendering path, `SmoothShader` draws these Shapes directly. In the deferred rendering path, `GeometryBufferPass` draws the same Space and Shapes into a G-buffer, and lighting is evaluated afterward. The internal shader and output target differ, but the user does not need to rebuild the same model in another representation.

The deferred rendering path does require complete surface material data for the G-buffer. Explicitly provide `specular`, `roughness`, `metallic`, and `emissive`. Do not hide missing values behind arbitrary fallbacks.

## Choose the Lighting and Final Rendering Path

### Forward Rendering Path

In the forward rendering path, `SmoothShader` evaluates lighting while each shape is drawn and writes the result to the canvas. Its advantage is a small configuration and a short path from the 3D scene to the final image.

Consider the forward rendering path first in the following situations.

- The application displays straightforward 3D shapes or models.
- A small number of lights is sufficient.
- The application does not need effects that share a G-buffer.
- The rendering structure and resource count should remain small.
- `SmoothShader` material parameters can produce the required appearance.

This path uses the normal `WebgApp` frame lifecycle. The user does not need to manage a Camera Frame or an individual command encoder. Do not add deferred-rendering resources or frame state to a simple `Space.draw(eye)` path.

### Deferred Rendering Path

The deferred rendering path first stores opaque surface information in a G-buffer, then uses those textures to calculate lighting and screen effects. `ComputeEffectPipeline` connects the G-buffer, Shadow, SSAO, Deferred Lighting, SSR, transparency, Toon, DoF, Bloom, Tone Mapping, and Edge processing in one defined order.

Material `alpha` controls rendering opacity independently of `color[3]`. Transparent triangles are collected across every Shape and sorted back-to-front. Applications do not insert a transparency Render Pass into the pipeline; the internal `TransparencyPass` applies roughness-driven background blur and then blends the sorted surfaces.

Consider the deferred rendering path in the following situations.

- Several effects share the G-buffer.
- The scene needs SSAO for contact and depth cues.
- The scene needs screen-space reflections through SSR.
- Many lights or different light types should be evaluated in the deferred lighting stage.
- Lighting, reflection, Bloom, and DoF should stay in an HDR interval.
- The integrated API should manage intermediate texture formats and processing order.

The deferred rendering path also runs inside `WebgApp`. Call `pipeline.renderScene()` from `onBeforeDraw`, then call `pipeline.encode()` and present the result from `onAfterDraw3d`. Pass the same `cameraFrame` to both calls.

```text
WebgApp state update
  -> onBeforeDraw
       -> Render the Shadow Map and G-buffer
  -> onAfterDraw3d
       -> Encode lighting and screen effects
       -> Present the completed texture on the canvas
       -> Return to the depth-enabled pass for HUD drawing
```

`ComputeEffectPipeline` does not automatically fall back to the forward rendering path when effects are disabled. The application explicitly chooses the forward rendering path or the deferred rendering path at its entry point.

### Updating GPU State First Is a Separate Pattern

GPU particles, cloth, physics, and procedural textures update state on the GPU before drawing the screen. This is a separate application pattern from the lighting-path branch. It can still use `WebgApp`, but it uses `computeFrame: true` and `onComputeFrame`.

```text
WebgApp computeFrame
  -> Compute Pass that updates state
  -> Render Pass that reads the latest state
  -> Submit the command buffer
```

The reason to choose this pattern is not to enable deferred lighting. It is to update a large amount of state on the GPU and pass the result directly to rendering without returning it to the CPU. Do not treat lighting-path selection and GPU simulation as the same decision.

## Understand the Self-Contained Design

`webg` is not a thin wrapper around external libraries. It connects rendering, scenes, models, animation, UI, input, diagnostics, and GPU processing through one set of design rules.

The camera follows `cameraRig` -> `cameraRod` -> `eye`, while scene content follows `Space` -> `Node` -> `Shape`. `ModelAsset` -> `build()` -> `instantiate()` separates shared resources from instances, and `clip` -> `pattern` -> `action` -> `state` organizes animation behavior.

First confirm the `webg` definitions and which code creates, updates, and destroys each resource. Then map them to general 3D or WebGPU concepts when that helps explanation. Applying external conventions first can lead to incorrect depth rules, color spaces, camera state, or resource management.

## Technical Rules to Follow

### 1. Initialization and Lifecycle

- Do not create GPU resources before `await screen.ready` or `await app.init()` has completed.
- Access `app.space`, `app.eye`, and `app.getGPU()` only after `await app.init()`.
- Put per-frame application-state updates in `app.start({ onUpdate: ... })`.
- When using `computeFrame: true`, always provide `onComputeFrame`.
- Do not register only `onComputeFrame` in an application that does not enable `computeFrame: true`.

### 2. Finalizing Shapes and Resources

- After adding vertex data to a `Shape`, always call `shape.endShape()`.
- Build a ModelAsset runtime, then instantiate it as many times as required.
- When placing the same Shape more than once, use Node transforms instead of duplicating vertices.
- Decide in one place where each resource is created, resized, updated, and destroyed.
- Do not duplicate or destroy resources that the Pipeline creates and manages internally.

### 3. Coordinate System and Rotation

- `webg` uses a right-handed coordinate system with `+X = right` and `+Y = up`.
- Distinguish world `+Z` from the standard camera's local forward direction, `-Z`.
- Check the asset or application convention for a model's forward direction.
- Follow the definitions of `yaw / pitch / roll` and `CoordinateSystem`.
- Do not cancel large World coordinates inside float32 GPU matrices. Use a camera-relative model-view.

### 4. Depth and Camera Frame

- The normal camera uses `CAMERA_REVERSE_Z`, `depth32float`, clear 0, and `greater`.
- Shadow Maps use `SHADOW_STANDARD_Z`, clear 1, and `less`.
- Do not treat normal-camera depth and Shadow Map depth as having the same meaning.
- A `CameraFrame` fixes the camera state shared by one rendered frame. Do not add an unnecessary `CameraFrame` or `renderFrameToken` to an ordinary single-pass path.
- Only a later pass that reads the same depth should share the `CameraFrame` or token.
- Pass the same `CameraFrame` to `ComputeEffectPipeline.renderScene()` and `encode()`.
- Classify transparency from material `alpha` and the material slot assigned to each triangle.
- Composite `TransparencyPass` after SSR and before Toon, DoF, and Bloom in the HDR scene.
- Do not let individual passes guess near, far, FOV, or the camera World matrix.

### 5. Final Presentation Order

A standard single pass uses `clear` -> `draw` -> `present`. An integrated path that displays a completed texture uses the following order.

```text
beginPresentPass()
  -> FullscreenPass.draw()
  -> clearDepthBuffer()
  -> Canvas HUD or later drawing
```

`clearDepthBuffer()` does not erase the completed texture. It reopens the depth-enabled canvas pass used by the HUD after the final texture has been presented.

## Goal-Oriented References

Identify which layer the user is working in, then choose the corresponding
chapters, samples, and automated tests.
Directory names without a prefix refer to samples under `samples/`.

- **First 3D object**: Chapters 4 and 5; `low_level`, `high_level`
- **Application foundation with `WebgApp`**:
  Chapters 5 and 6; `high_level`
- **Orbit, Follow, or First-person camera**:
  Chapters 5 and 6; `high_level`, `eye_rig`
- **Shapes and materials**:
  Chapters 7, 9, and 22-24; `shapes`, `materials`
- **Lighting in the forward rendering path**:
  Chapters 9 and 24; `SmoothShader`, `shapes`, `materials`
- **Deferred lighting and several screen effects**:
  Chapters 27-29; `compute_effect`, `compute_json`
- **glTF, GLB, or Collada models**:
  Chapters 10, 12, and 13; `gltf_loader`, `collada_loader`
- **Scene JSON**: Chapters 5, 10, and 11; `scene`
- **Animation state transitions**:
  Chapters 12 and 13; `animation_state`, `janken`
- **HUD or panel UI**:
  Chapters 5 and 14-16; samples using `OverlayPanel` and `CommandPalette`
- **Input, raycast, or collision**:
  Chapters 16 and 17; `unittest/raycast`, `headless_tests/core/physics_space`
- **Physics bodies, bounce, or friction**:
  Chapter 26; `physics_bounce`, `headless_tests/core/physics_space`
- **Individual compute effects**: Chapters 27-29. See
  `compute_bloom`, `compute_deferred_lighting`, `compute_dof`,
  `compute_edge`, `compute_shadow_map`, `compute_ssao`,
  `compute_ssao_gbuffer`, `compute_ssr`, and `compute_vignette`
- **GPU-updated particles, cloth, physics, or textures**: Chapter 27. See
  `compute_particles`, `compute_cloth`, `compute_physics_bounce`,
  and `compute_texture`
- **Low-level compute integration**:
  Chapter 27; `compute_postprocess`, `webg/ComputePass.js`
- **Compute-processing performance**:
  Chapters 27-29; `compute_benchmark`

Do not treat samples with similar names as duplicates. `bloom` and
`compute_bloom`, `dof` and `compute_dof`, and `physics_bounce` and
`compute_physics_bounce` compare different rendering methods or computation
locations. See `samples/README.md` for the purpose and retention reason of each
compute sample.

## API Search Protocol

If an API or usage pattern cannot be found, do not substitute an API from another library. Search in the following order.

1. Search `book/付録C_API一覧.md` for the class or feature name.
2. Read the chapter text for background, role, reason, processing order, and cautions.
3. Read `samples/<name>/README.md` to understand the sample's purpose.
4. Inspect `main.js` and helper `*.js` files for the actual integration pattern.
5. Inspect `headless_tests/core/<core_name>` for deterministic checks.
6. Look in `unittest` for a browser POC intended for human inspection.
7. Finally, read `webg/*.js` for public APIs, exceptions, and the code that creates, updates, and destroys resources.

If shell search is available, expand the search scope in the same order.

```sh
rg -n "ClassName|methodName|feature keyword" book/付録C_API一覧.md book/*.md
rg -n "methodName|feature keyword" samples headless_tests unittest webg
rg -n "^export |export default|methodName" webg/*.js
```

If the API name is unknown, inspect the headings in Appendix C to narrow down the relevant class.

```sh
rg -n "^(##|###|####) " book/付録C_API一覧.md
```

Most class names map to `webg/<ClassName>.js`. Exceptions include `formatJSON()` in `webg/JsonFormat.js`, UI themes in `webg/WebgUiTheme.js`, and the Help and error option builders in `webg/OverlayPanelPresets.js`.

## Decide How to Add Compute Processing

A Compute Shader is not a replacement for `WebgApp`. It either replaces one part of the standard rendering work or updates state on the GPU. Choose the entry point based on what the application needs to manage.

### Use `ComputeEffectPipeline`

Use it when deferred lighting and several screen effects share a G-buffer and should run in a standard order. The Pipeline creates intermediate textures and handles pass connections, resizing, and destruction.

### Use an Individual Compute Pass

Use an individual pass to compare one effect, display an intermediate result, or study a nonstandard order. Application code manages the inputs, outputs, processing order, resizing, and destruction.

### Use `ComputePass` or `computeFrame`

Use them for custom WGSL, storage buffers, storage textures, and GPU simulation. `ComputePass.encode()` records work into a command encoder but does not submit it. The caller creates the encoder, orders the Render Passes, and submits the command buffer.

### Safety Checks

- Keep WGSL `@workgroup_size` consistent with the JavaScript `workgroupSize`.
- When dispatch is rounded up, add an out-of-range guard in WGSL.
- Consider ping-pong resources when reading previous state and writing next state.
- Explicitly define binding numbers, resource types, and texture formats.
- Keep the HDR interval in `rgba16float` and perform display conversion only once at the end.
- Resize every screen-sized resource when the canvas size changes.
- Do not reuse a pass or resource after `destroy()`.

A passing headless test does not guarantee WGSL compilation, pipeline validation, or rendering results on a real WebGPU device. Run the sample in a browser to confirm real GPU execution, and use human judgment for visual quality and interaction.

## Choosing UI Components

When a user wants to display information on screen, select the component based on its purpose.

- Instructions and Help: `app.showOverlayPanel(buildHelpPanelOptions(...))`
- Dynamic values and state: `app.message.setLines("status", [...], options)` or HUD
- Dialogue and tutorials: `OverlayPanel` `buttons` / `choices` with an application controller
- Detailed error reasons: `buildErrorPanelOptions()` or an Overlay Panel with `format: "pre"`
- Low-frequency setting changes: `CommandPalette`
- Continuous development diagnostics: `DebugDock`

When adding controls for screen effects, keep only frequently used actions in the HUD or fixed buttons. Group low-frequency parameters in `CommandPalette`.

## Reference Priority

Keep the purposes of the following references distinct and choose the source that provides the required evidence.

1. Use `book/付録C_API一覧.md` to find API names and relevant classes.
2. Read chapter text for background, role, reason, use cases, and cautions.
3. Read sample READMEs for intent and application integration.
4. Use `headless_tests` for deterministic checks that need no human judgment.
5. Use `unittest` to inspect display, interaction, real GPU behavior, and browser APIs.
6. Read `webg` core for the final API, exception, and resource-management rules.

A passing headless test does not prove that browser rendering is correct. Conversely, seeing a result once in a browser does not prove boundary values, error conditions, or state after destruction. The two methods check different properties and do not replace one another.

## Keep API Layers Consistent

The main mistake to avoid is mixing high-level and low-level APIs without first deciding where each resource is created, updated, resized, and destroyed.

- Start with existing entry points such as `WebgApp`, `SmoothShader`, and `ComputeEffectPipeline`.
- If the user already uses `WebgApp`, preserve its frame lifecycle.
- Even when using raw WebGPU or individual passes, preserve the existing resource-management flow.
- Decide in one place where each resource is created, resized, updated, and destroyed.
- Do not hide incomplete input by silently substituting another format or a default camera.

`ModelAsset` is a shared representation of one model, including meshes, skeletons, and animation. `SceneAsset` is the initial state for a whole scene, including camera, HUD, placed primitives, and placed models. Distinguish between placing one model several times and saving or restoring a whole scene.

For animation problems, determine whether the cause is in the clip, `Action`, `AnimationState`, or skeleton application. For rendering problems, inspect `SmoothShader` material parameters in the forward rendering path, or G-buffer material values and Pipeline settings in deferred lighting. Change WGSL only when existing settings cannot solve the problem and the input, output, or processing method itself must change.

## Diagnostic Order

When display or behavior is incorrect, do not start by assuming that the shader formula is wrong. Inspect the shared foundation first and proceed toward final presentation.

1. Confirm that `await app.init()` or `await screen.ready` has completed.
2. Check JavaScript exceptions and WebGPU validation messages.
3. Confirm that the `WebgApp` frame mode matches the registered handlers.
4. Inspect the state of Space, Node, Shape, and camera.
5. Identify whether the application uses the forward or deferred rendering path.
6. In the deferred rendering path, inspect each G-buffer texture.
7. Check the `CameraFrame`, depth convention, and texture formats.
8. Confirm that no stale resource is used after resize.
9. If only final presentation is black, inspect Tone Mapping, present, and Fullscreen copy.
10. If the HUD disappears, confirm that `clearDepthBuffer()` returns to the canvas pass.
11. When GPU state is updated first, inspect dispatch, bindings, out-of-range guards, and submission order.
12. For performance issues, do not rely only on CPU time; follow the GPU measurement approach in `compute_benchmark`.

## Baseline Attitude for AI

1. Put `WebgApp` at the center of the application:
   Preserve the shared scene, camera, input, and UI when adding advanced rendering or GPU processing.
2. Prefer the highest-level API that fits:
   First check whether `WebgApp`, `loadModel()`, `SmoothShader`, or `ComputeEffectPipeline` solves the problem.
3. Use the book for design intent and verify against the current implementation:
   Confirm APIs and exceptions in samples, automated tests, browser POCs, and `webg/*.js`.
4. Separate the problem layer and rendering path:
   Do not collapse application, scene, shape, camera, lighting, UI, physics, compute, and presentation into one cause. Also identify the rendering path in use.
5. Choose the verification method and change scope:
   Distinguish what headless tests, automated browser captures, and human visual inspection each guarantee. Prefer application-side composition. When investigation confirms a core bug or missing shared API, update core code, samples, tests, and documentation to the same specification.

`webg` keeps design, implementation, samples, automated tests, and documentation in one system centered on `WebgApp`. Use this book as the primary reading map, preserve the shared 3D application structure, select the lighting path and GPU processing that match the goal, and help users verify the basis for each recommendation.
