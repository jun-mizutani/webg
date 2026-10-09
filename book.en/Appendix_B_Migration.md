# Migrating from webg 1.0 or 2.0 to 3.0

This appendix guides applications built with webg 1.0 or 2.0 toward the webg 3.0 architecture using SceneYAML, ModelYAML, PBR, and Compute Shader physics. If you are starting with 3.0, read the main chapters in order. If you are migrating an existing application, use this appendix to identify the scope, then continue to the relevant chapters.

The amount of work depends on the application. First identify whether it creates `Node` and `Shape` procedurally or defines the whole application in SceneYAML, and identify its use of PBR and compute shaders. Migrate only the layers the application needs.

Use the main chapters and [API catalog](Appendix_D_API.md) for current API details and settings, and the implementation and tests for exact validation rules. This appendix focuses on migration decisions, file boundaries, and verification.


For a switch from individual 3.0 modules to the bundled library, see
[Appendix C](Appendix_C_Bundle.md). That change adjusts imports and file placement;
it is separate from the version migration described here.

## 1. Migration Scope in webg 3.0

webg 3.0 retains the low-level approach based on `WebgApp`, `Space`, `Node`, and `Shape`, and adds a high-level entry point for application definitions. The new entry point connects scene definition, PBR rendering, Compute Shader physics, and synchronization of physics state to Nodes.

- **Application entry**
  - webg 3.0 approach: `WebgSceneApp`, `createWebgSceneApp()`
  - Migration question: Should initialization, updates, and disposal be consolidated under the high-level app?
- **Scene definition**
  - webg 3.0 approach: `SceneYAML`, `SceneAsset`, `SceneDefinition`
  - Migration question: Which object, material, physics, and renderer settings should move into a document?
- **Model assets**
  - webg 3.0 approach: `ModelYAML`, `ModelAsset`
  - Migration question: Which reusable meshes and Node hierarchies belong in a model document?
- **Rendering**
  - webg 3.0 approach: metallic-roughness PBR, HDR, IBL, G-buffer
  - Migration question: How should legacy material values map to PBR meanings?
- **Screen effects**
  - webg 3.0 approach: shadows, SSAO, SSR, DoF, fog, bloom, and more
  - Migration question: At which stage of linear HDR should each effect run?
- **Physics**
  - webg 3.0 approach: `PhysicsSpace`, `ScenePhysics`, `ComputePhysicsSpace`
  - Migration question: Which body counts, synchronization needs, and fixed steps justify moving from CPU to Compute?
- **GPU computing**
  - webg 3.0 approach: Compute passes, particles, cloth, texture generation
  - Migration question: How should GPU-state update and rendering be ordered?
- **Audio**
  - webg 3.0 approach: `GameAudioSynth`, `GameMusicPresets`, `AudioSynth`
  - Migration question: How should BGM, sound effects, and user-gesture playback start?

First choose which of these paths fits the existing application:

```text
existing application
  ├─ WebgApp + Node + Shape
  │    ├─ keep the low-level structure and connect PBR
  │    └─ move placement data to SceneYAML as needed
  ├─ define the complete application in SceneYAML
  │    └─ WebgSceneApp + SceneAsset + SceneDefinition
  ├─ update GPU state before drawing
  │    └─ Compute pass / compute-first
  └─ use CPU physics
       ├─ continue with PhysicsSpace
       └─ move to the Compute backend through ScenePhysics
```

## 2. Choose an Application Entry Point

### 2.1 Keep Using `WebgApp` Directly

`WebgApp` provides explicit control of GPU, Canvas, camera, input, and the update loop. If the existing code records render passes in detail or manages many custom GPU buffers, keep this entry point first and migrate PBR and depth conventions while preserving its structure.

The application code then:

1. Prepares GPU and Canvas with `WebgApp.init()`.
2. Creates and places `Space`, `Node`, and `Shape` objects.
3. Updates the camera frame.
4. Records physics, Compute passes, and render passes in the command encoder.
5. Updates resources on resize and calls `destroy()` at shutdown.

This path suits applications that directly control render passes and lets each layer move while the existing behavior is checked.

### 2.2 Move to `WebgSceneApp`

Use `WebgSceneApp` when SceneYAML should store the complete application and PBR and Compute physics should follow the standard pipeline. The high-level runtime handles SceneYAML loading and reference validation, Node and Shape construction, PBR setup, physics registration, fixed steps, GPU readback, Node synchronization, and reset.

```js
import { createWebgSceneApp } from "../../webg/app/index.js";

const sceneApp = await createWebgSceneApp({
  project: "./scene.yaml",
  camera: {
    target: [0.0, 1.0, 0.0],
    distance: 10.0
  },
  physics: {
    enabled: true,
    paused: true
  },
  effects: {
    shadow: true,
    ssr: true
  }
});

sceneApp.start();
```

`WebgSceneApp.create(options)` provides the same initialization in class form. Put application-specific input and UI in JavaScript alongside the generated `sceneApp`. Core controls include `start()`, `stop()`, `setPaused()`, `reset()`, `setTimeScale()`, `getDiagnostics()`, and `destroy()`.

### 2.3 Migration Decision

Moving to `WebgSceneApp` has the most benefit when the application needs editable files for objects, materials, and physics; SceneYAML import/export from a browser editor or external tool; shared initialization for PBR and Compute physics; or shared physics-body to Node synchronization.

For an application centered on custom GPU work, continue using `WebgApp` and adopt only the needed SceneYAML or PBR components.

## 3. Move Placement into SceneYAML and ModelYAML

### 3.1 Separate the Scene and Model Asset

In 3.0, SceneYAML and ModelYAML use the same YAML parser and load as `SceneAsset` and `ModelAsset`:

```text
SceneYAML / Scene JSON -> SceneAsset -> SceneDefinition / scene runtime
ModelYAML / Model JSON -> ModelAsset  -> model runtime
```

SceneYAML describes a complete application: `objects`, `objectSets`, inline meshes, materials, physics, joints, animations, renderer settings, and `ModelAsset` references. ModelYAML describes one reusable model: its meshes, Node hierarchy, materials, skeleton, and animations.

`SceneAsset` and `ModelAsset` name the data structures used after loading. Their shared `DocumentAsset` handles JSON/YAML parsing, original text, comments, source URL, and serialization. Each Asset and its validation and build classes handle references, values, and runtime construction.

### 3.2 Move Application Data to SceneYAML

Keep initial application state and project-wide settings in the scene document:

```yaml
format: webg-scene
version: 1

materials:
  - id: ball-material
    color: [0.94, 0.30, 0.08, 1.0]
    metallic: 0.15
    roughness: 0.20
    specular: 1.0

objects:
  - id: ball
    shape: {type: sphere, radius: 0.5}
    transform: {position: [0.0, 3.2, 0.0]}
    material: ball-material
    physics:
      bodyType: dynamic
      mass: 1.0

physics:
  space:
    gravity: [0.0, -9.8, 0.0]
    planes:
      - normal: [0.0, 1.0, 0.0]
        planeDistance: 0.0

renderer:
  profile: studio
  environment:
    preset: dark-studio
    resolution: {width: 128, height: 64}
```

`objects[]` places objects in the application. `objectSets[]` generates placements from prototypes and variants. `materials[]` defines PBR values or procedural textures. `physics` configures the physics space and bodies. `renderer` holds the PBR profile, environment, output size, and screen effects.

### 3.3 Inline Meshes and Physics Shapes

For geometry defined directly in SceneYAML, place vertices and faces under `meshes`, then reference the mesh from an object:

```yaml
meshes:
  - id: panel-mesh
    vertices:
      - [-0.5, -0.5, 0.0]
      - [ 0.5, -0.5, 0.0]
      - [ 0.5,  0.5, 0.0]
      - [-0.5,  0.5, 0.0]
    faces: [[0, 1, 2, 3]]

objects:
  - id: panel
    mesh: panel-mesh
    transform: {position: [0.0, 1.0, 0.0]}
    physics:
      bodyType: dynamic
      mass: 1.0
      shape: {type: box, size: [1.0, 1.0, 0.1]}
      colliderRelation: proxy
```

`mesh` describes display geometry and `physics.shape` describes geometry used by the physics solver. Current SceneYAML physics shapes are explicit Box, Sphere, and Capsule definitions. Separate definitions let display detail and physics cost be tuned independently.

### 3.4 Move Reusable Structure to ModelYAML

When the same model is placed in several SceneYAML files, move its mesh, Node hierarchy, materials, skeleton, and animation to ModelYAML. Keep application placement, project object IDs, physics shape, and project-specific settings in SceneYAML.

```yaml
modelAssetUrl: ./robot.yaml

objects:
  - id: robot-body
    node: body
    transform: {position: [0.0, 1.0, 0.0]}
    physics:
      bodyType: dynamic
      mass: 5.0
      shape: {type: box, size: [1.0, 2.0, 1.0]}
```

`body` is a Node ID inside the ModelAsset; `robot-body` is the SceneYAML object ID. Project physics, joints, contact events, and UI refer to the scene-side object ID. Separating model internals from application placement lets one ModelAsset serve multiple projects.

### 3.5 Preserve YAML Comments as Authoring Information

SceneYAML and ModelYAML comments explain physics conditions, coordinates, material intent, and editing constraints. `DocumentAsset` retains parsed values together with original YAML, comments, and source URL. `SceneAsset` and `ModelAsset` share these serialization rules.

```js
import SceneAsset from "../../webg/SceneAsset.js";
import ModelAsset from "../../webg/ModelAsset.js";

const sceneAsset = await SceneAsset.load("./scene.yaml");
const modelAsset = await ModelAsset.load("./robot.yaml");

sceneAsset.assertValid();
modelAsset.assertValid();

const sceneSource = sceneAsset.getSourceDocument();
const modelSource = modelAsset.getSourceDocument();
console.log(sceneSource.comments.length, modelSource.comments.length);
```

If an Asset is unmodified, `toYAMLText()` returns the original source. If a value is edited directly while comments remain attached, saving throws so the source and comments remain reliable. An editor should pass its updated YAML source to `fromYAML()`. JSON has no comment representation, so specify `allowCommentLoss: true` when converting.

## 4. Move Materials to PBR

### 4.1 Map Material Values by Meaning

Phong-style `ambient`, `specular`, and `power` values from 1.0/2.0 should be reconsidered as base color, metallic, roughness, specular, occlusion, and emission in 3.0. Choose values based on whether the object is a metal, how smooth its surface is, and whether it emits light rather than applying a bulk numeric conversion.

```js
const gold = {
  color: [1.0, 0.766, 0.336, 1.0],
  alpha: 1.0,
  metallic: 1.0,
  roughness: 0.24,
  specular: 1.0,
  occlusion: 1.0,
  emissive_factor: [0.0, 0.0, 0.0],
  transmission: 0.0
};
```

For a metal, base color appears in specular reflection. For a dielectric, base color primarily drives diffuse response and `specular` adjusts normal-incidence reflection. `roughness` controls highlight width and specular IBL mip selection. `emissive_factor` is linear HDR emission kept separate from lighting.

### 4.2 G-buffer and Forward-rendering Flow

Opaque objects write surface data to the G-buffer; deferred lighting computes direct light, diffuse IBL, specular IBL, and emission. Transparent objects use PBR forward rendering and can use Transmission for background refraction and absorption.

```text
opaque Shapes -> PBR G-buffer -> deferred lighting
                              -> SSR replaces visible specular IBL
transparent Shapes -> transparent PBR -> transmission refraction/absorption
linear HDR -> fog / DoF / bloom / toon -> tone mapping / edge / vignette
           -> Canvas
```

When migrating from deferred rendering in 2.0, keep the G-buffer structure and move the stored surface values and lighting model to PBR. When migrating from standard forward rendering, align Shape material inputs with PBR and connect `PbrRenderer` or `ComputeEffectPipeline` to the lighting path.

### 4.3 Environment, Direct Light, and Reflection

PBR environment lighting uses HDR maps, diffuse irradiance, roughness-prefiltered specular mips, and a BRDF LUT. Set `renderer.environment` with a preset or environment configuration, and choose resolution for the scene size and surface roughness.

Specify direct-light type—directional, point, or spot—and configure position, direction, intensity, color, and attenuation. Since light color and intensity directly affect base color, metallic, and roughness response, replace a global legacy `ambient` brightening scheme with distinct environment and direct-light inputs.

SSR replaces a portion of specular IBL with reflections visible in the current screen. Areas without a screen-space hit retain environment specular IBL. Lower roughness makes reflections on a floor or metal easier to read; higher roughness broadens the highlight.

### 4.4 Transparency, Transmission, and Procedural Textures

For objects with alpha, transparency classification and ordering affect the result. Specify alpha, transmission, thickness, and absorption color, and check draw order for the intended use. On glass or thin plastic, tune reflection, background refraction, and absorption through the same PBR inputs.

For procedural materials, connect Color and Normal maps generated by `ProceduralTileSpec`, `ComputeProceduralTile`, and `ProceduralMaterials`. For real-world repetition spacing, first align mesh dimensions and UV scale, then tune pattern scale.

## 5. Align Camera, Depth, and Frame State

### 5.1 Reverse-Z and Shadow Depth Rules

The 3.0 main camera uses `CAMERA_REVERSE_Z`: near maps to 1, far to 0, clear value is 0, and comparison is `greater`. Shadow maps use `SHADOW_STANDARD_Z`: near maps to 0, far to 1, clear value is 1, and comparison is `less`.

```js
import {
  CAMERA_REVERSE_Z,
  SHADOW_STANDARD_Z
} from "../../webg/DepthConvention.js";
```

Keep projection matrix, clear value, and sampler comparison aligned for each camera. Even with the same `depth32float` format, the two conventions are distinct. Mixing them can remove ground geometry or invert shadows.

### 5.2 Camera Frame and Camera-relative Coordinates

Update camera position and orientation once at the start of a frame, then pass the same `cameraFrame` to the G-buffer, transparency, screen effects, and UI drawing. Updating the camera separately in each pass can make projections disagree within one image.

For large worlds or distant objects, render in camera-relative coordinates. Align the CPU Node position, GPU object buffer, and world positions used by shadow passes, while keeping them distinct from world coordinates used by physics.

When manually connecting several passes, share the same `renderFrameToken`. A token change identifies a different frame, so pass order and resource contents should represent that same frame.

### 5.3 EyeRig and Canvas Size

When migrating a camera, check EyeRig position, focus target, up direction, and parent Node transform order. For an orbit camera, set target distance, yaw, and pitch consistently.

Update Canvas display size and render-target size together in the resize path. Changing only CSS size separates displayed dimensions from PBR, shadow, SSR, and DoF targets.

## 6. Move from CPU Physics to Compute Physics

### 6.1 Choose a Physics Path

`PhysicsSpace` is the low-level CPU physics entry point and remains suitable for a small body count or applications that need fine CPU-side control of contacts.

`ScenePhysics` is the high-level route to Compute physics. SceneApp uses Compute as its standard backend, and `ScenePhysics` coordinates `ComputePhysicsSpace`, bodies, joints, readback, and Node bindings. Select `backend: "cpu"` explicitly for comparison and verification.

```js
import ScenePhysics from "../../webg/app/ScenePhysics.js";

const scenePhysics = new ScenePhysics({
  gpu,
  backend: "compute",
  gravity: [0.0, -9.8, 0.0]
});
```

When moving body definitions, check `bodyType`, mass, inertia, friction, restitution, linear and angular damping, sleep settings, and collider shape. Use Box, Sphere, Capsule, or Plane explicitly. Do not infer a physics collider from the display mesh vertex count.

### 6.2 Fixed Steps and GPU Readback

Compute physics updates GPU `BodyState`. `encode(commandEncoder, elapsedMs)` divides elapsed time into fixed steps; `encodeFixedStep(commandEncoder)` records one. When physics and drawing share a command encoder, make the physics, readback, and rendering order explicit.

For synchronization to ordinary Nodes:

```text
ComputePhysicsSpace.encode()
  -> update GPU BodyState
  -> record state readback
  -> submit
  -> await readback
  -> syncNodeFromPhysics() / syncNodesFromPhysics()
  -> draw Nodes
```

For many bodies where CPU transfers should be reduced, use `getStateBuffers()` and `getRenderState().bufferIndex` so the drawing shader reads GPU state directly. Match body-buffer layout with WGSL offsets, and keep this path distinct from readback-based Node synchronization.

### 6.3 Physics in SceneYAML

In SceneYAML, put gravity, fixed step, solver capacity, and planes under `physics.space`; put body type, mass, material, and collider under each object's `physics`. `joints` define application constraints between object IDs.

Align a body's initial position with its display Node and collider dimensions. A Plane floor and a Box floor create different contact pairs and stability, so hold settings constant in acceptance checks.

## 7. Move to Compute-first Processing

### 7.1 Applications That Update GPU State First

Use a compute-first flow for particles, cloth, GPU physics, and procedural textures that render the updated state in the same frame:

```text
update input and time
  -> record Compute passes
  -> send updated GPU buffers to render passes
  -> record screen effects
  -> submit / present
```

The caller of `ComputePass` creates the command encoder, orders passes, and submits. Keep all accesses to resources in the same-frame update in one processing flow.

### 7.2 Combine GPU Work with SceneApp

Use `WebgSceneApp.onUpdate` for application state. When custom Compute encoders and render order need direct control, use `WebgApp` with `computeFrame: true` and `onComputeFrame`, then connect the scene assets and drawing code as needed. Check buffers, bind-group layouts, and resource lifetime for each pass.

Design particle count, storage-buffer size, workgroup count, and readback frequency explicitly. Validation errors for unsupported values expose GPU mismatches early.

## 8. Move Audio to the 3.0 Structure

Use `GameAudioSynth` to coordinate music and sound-effect playback, with musical presets from `GameMusicPresets`. BGM presets use eight bars of 64 eighth notes and provide mood and BPM choices. Sound-effect presets target events such as collisions, firing, and confirmation.

Call `resume()` from the first user gesture to satisfy browser autoplay requirements. Configure master volume separately from BGM and SFX levels. See `16_Audio.md` for audio presets and design.

## 9. Organize Resource Lifetimes

Separate resources created at initialization from resources rebuilt after resize or scene changes:

- **GPU device and queue**
  - Created: App initialization
  - Updated or released: Release with WebgApp at shutdown
- **SceneAsset and ModelAsset**
  - Created: Document loading
  - Updated or released: Preserve source; call runtime `destroy()` when built runtime ends
- **Shape, Node, material**
  - Created: Scene construction
  - Updated or released: Release scene through `Space` at shutdown
- **PBR environment, IBL, BRDF LUT**
  - Created: PBR initialization
  - Updated or released: Rebuild on environment change; release at shutdown
- **Shadow, SSR, and DoF targets**
  - Created: Renderer initialization and resize
  - Updated or released: Recreate when size changes
- **Compute physics buffers**
  - Created: Physics initialization
  - Updated or released: Recreate on body-capacity change; release at shutdown
- **Audio context and buffers**
  - Created: First audio use
  - Updated or released: Stop and release when the app ends

Keep serialized SceneAsset data separate from runtime GPU resources. When placing a ModelAsset several times, build shared geometry once and manage each placement's Node pose independently.

## 10. Migration Procedure

### Step 1: Record the Application Scope

List the application entry, scene construction, materials, camera, screen effects, physics, Compute passes, audio, resize, and disposal. Classify each as keep, move to SceneYAML, move to PBR, or move to Compute.

### Step 2: Reproduce the Image in 3.0

Initially disable physics and screen effects. Match camera, lights, Shapes, Nodes, and materials. Check positions, orientation, dimensions, face winding, normals, UVs, and transparency classification. Then tune PBR roughness, metallic, and environment.

### Step 3: Save Data to SceneYAML or ModelYAML

Move project placement and configuration to SceneYAML; move reusable model internals to ModelYAML. Call `assertValid()` after loading to detect invalid references, meshes, materials, physics, or animation during initialization.

### Step 4: Verify Depth and PBR Order

Confirm Reverse-Z for the main camera and Standard-Z for shadows. Check HDR intermediate values, IBL, direct light, SSR, transparency, and tone mapping order. Convert to sRGB only for final Canvas output.

### Step 5: Connect Physics

Begin with one body and check fixed step, gravity, collider dimensions, mass, friction, and restitution. Then add bodies and check sleep, wake, contact events, readback, and Node synchronization. Use identical initial conditions and fixed steps when comparing CPU and Compute.

### Step 6: Add Compute Passes and Audio

After physics and display are stable, add particles, cloth, or texture-generation passes. Finally add audio `resume()`, master volume, BGM, and sound effects; verify playback begins from a user gesture.

## 11. Verification

Verify the migration at the data, runtime, and real-device levels.

### 11.1 Data Checks

- Parse SceneYAML and ModelYAML.
- Confirm `SceneAsset.load()` and `ModelAsset.load()` return the expected Assets.
- Confirm `getSourceDocument()` exposes source, comments, and source URL.
- Confirm `assertValid()` identifies invalid references and numeric values.
- Confirm unmodified comment-bearing YAML returns its source through `toYAMLText()`.
- Specify `allowCommentLoss: true` when converting comment-bearing YAML to JSON.

Use `samples/edit_yaml/check_document.mjs` for SceneYAML editing documents and `unittest/scene_mesh/check.mjs` for inline mesh and scene construction.

### 11.2 Runtime Checks

- Confirm Node, Shape, and ModelAsset references resolve to the expected counts.
- Confirm each object's PBR metallic, roughness, and emissive settings.
- Confirm physics body type, mass, collider, and fixed step.
- After Compute readback, confirm Node pose matches GPU state.
- Confirm `reset()` restores initial scene and physics state.
- After `resize()`, confirm Canvas, shadow, SSR, and DoF target sizes agree.
- Confirm shutdown releases renderer, physics, and scene resources and stops audio.

### 11.3 Browser and Real-GPU Checks

Use an actual WebGPU browser to verify:

1. Canvas follows the window dimensions.
2. Main-camera Reverse-Z depth is stable.
3. Shadow Standard-Z comparisons are correct.
4. HDR highlights, metal reflections, and roughness changes are visible.
5. Transparent and Transmission compositing are stable.
6. Compute physics contacts, sleep, wake, and readback agree with the display.
7. Compute particles or cloth appear in the same frame as their updated state.
8. Audio starts after user interaction.

`headless_tests/` checks APIs and data structures, including parsers, Assets, SceneDefinition, PBR, physics, and sample structure. Verify real-GPU drawing, audio, input, and WebGPU resource ordering by launching the corresponding sample in a browser.

## 12. Quick Map to a Migration Destination

- **Define a complete application in SceneYAML**
  - Start with: `09_Scenes.md`, `samples/project_app/index.html`
- **Import/export SceneAsset and ModelAsset**
  - Start with: `08_Models.md`, `09_Scenes.md`, `samples/scene_model_yaml/index.html`
- **Edit meshes in SceneYAML**
  - Start with: `samples/edit_yaml/index.html`
- **Reuse ModelYAML**
  - Start with: `samples/model_yaml/index.html`
- **Tune PBR, IBL, SSR, and transparency**
  - Start with: `32_PBRSetup.md`, `33_PBRDiagnostics.md`, `samples/materials/index.html`, `samples/transmission/index.html`
- **Use procedural textures**
  - Start with: `samples/procedural_texture/index.html`
- **Move from CPU to Compute physics**
  - Start with: `27_Physics.md`, `28_PhysicsEvents.md`, `samples/compute_physics/index.html`
- **Verify Compute-physics rendering sync**
  - Start with: `samples/falling_box/index.html`, `samples/falling_dominoes/index.html`
- **Add Compute particles or cloth**
  - Start with: `samples/compute_particles/index.html`, `samples/compute_cloth/index.html`
- **Generate textures with Compute**
  - Start with: `samples/compute_texture/index.html`
- **Migrate BGM and sound effects**
  - Start with: `16_Audio.md`, `samples/sound/index.html`

A migration to 3.0 does not require changing the application entry, data documents, rendering, physics, Compute, and audio at the same time. Match the display first, separate data with SceneYAML and ModelYAML, then add PBR, physics, Compute, and audio one step at a time so the result at each stage remains observable.
