# Appendix D: webg 3.0 API Catalog

This catalog helps locate public APIs in webg 3.0 by feature. The catalog covers webg 3.0. Check settings, defaults, and exception conditions against the current implementation, samples, and headless tests.

For a first application, begin with `05_AppStructure.md`. For renaming and architectural changes from earlier versions, see [Appendix B: Migration to webg 3.0](Appendix_B_Migration.md).

## 1. API Entry Points

webg 3.0 builds on the existing `WebgApp` and adds the application-oriented `WebgSceneApp` above it:

```text
application code
  ├─ webg/app/index.js
  │    └─ WebgSceneApp / SceneDefinition / ScenePhysics / PbrRenderer
  └─ when direct control is needed
       └─ WebgApp.js, Shape.js, ComputePhysicsSpace.js, and other core modules
```

- **Build an application with PBR and Compute physics**
  - Recommended entry point: `webg/app/index.js`
  - Main API: `createWebgSceneApp()`, `WebgSceneApp`
- **Validate or load a SceneYAML project**
  - Recommended entry point: `webg/app/index.js`
  - Main API: `SceneDefinition`, `parseSceneYAML()`
- **Control physics from a scene app**
  - Recommended entry point: `webg/app/index.js`
  - Main API: `ScenePhysics`
- **Control PBR settings directly**
  - Recommended entry point: `webg/app/index.js`
  - Main API: `PbrRenderer`
- **Control WebgApp frames, input, and UI**
  - Recommended entry point: `webg/WebgApp.js`
  - Main API: `WebgApp`
- **Control Compute commands and GPU buffers directly**
  - Recommended entry point: `webg/ComputePhysicsSpace.js`, `webg/ComputeEffectPipeline.js`
  - Main API: Low-level Compute APIs

### 1.1 Import from SceneApp

Most applications import from the aggregate entry point:

```js
import {
  WebgSceneApp,
  createWebgSceneApp,
  SceneDefinition,
  parseSceneYAML,
  ScenePhysics,
  PbrRenderer,
  WaterBody
} from "../../webg/app/index.js";
```

- **`WebgSceneApp`**
  - Description: High-level app connecting scene definitions, WebgApp, PBR, and Compute physics
- **`createWebgSceneApp()`**
  - Description: Functional form of `WebgSceneApp.create()`
- **`SceneDefinition`**
  - Description: Validates a project manifest, resolves URLs, and builds scenes
- **`parseSceneYAML()`**
  - Description: Parses SceneYAML/ModelYAML text into values
- **`parseSceneYAMLDocument()`**
  - Description: Returns parsed values, original source, and comments
- **`stringifySceneYAML()`**
  - Description: Serializes JavaScript values as YAML
- **`DocumentAsset`**
  - Description: Shared document I/O base class for SceneAsset and ModelAsset
- **`SceneAsset`**
  - Description: Stores complete application settings, source, and comments
- **`ModelAsset`**
  - Description: Stores reusable model structure, source, and comments
- **`compressSceneYAML(text)`**
  - Description: Returns a gzip-compressed UTF-8 source document as `Promise<Blob>`
- **`ScenePhysics`**
  - Description: Scene-oriented physics facade for CPU and Compute backends
- **`PbrRenderer`**
  - Description: PBR environment, deferred lighting, screen effects, and final display
- **`WaterBody`**
  - Description: Water region, waves, absorption, and receiver registrations
- **`PBR_RENDERER_PROFILES`**
  - Description: Available PBR profiles; currently `studio`
- **`resolvePbrRendererProfile()`**
  - Description: Combines a profile with individual pipeline settings
- **`resolvePbrDofOptions()`**
  - Description: Validates public DoF settings and maps them to internal settings
- **`validatePbrEnvironmentOptions()`**
  - Description: Validates environment presets and resolution
- **`validatePbrPipelineOptions()`**
  - Description: Validates shadows, SSAO, SSR, lighting, and tone mapping
- **`validatePbrRendererOptions()`**
  - Description: Validates the complete renderer configuration

`SceneFrame`, backend, binding, and helper modules are internal to `WebgSceneApp`. For internal processing, see Chapter 9 and current `webg/app/*.js`.

## 2. WebgSceneApp

### 2.1 Create an App

```js
const sceneApp = await createWebgSceneApp({
  project: "./scene.webg.yaml",
  camera: { target: [0.0, 1.0, 0.0], distance: 10.5 },
  physics: { enabled: true, paused: true }
});

sceneApp.start();
```

- **`new WebgSceneApp(options)`**
  - Return: `WebgSceneApp`
  - Purpose: Creates an uninitialized app
- **`WebgSceneApp.create(options)`**
  - Return: `Promise<WebgSceneApp>`
  - Purpose: Initializes project, GPU, scene, PBR, and physics
- **`createWebgSceneApp(options)`**
  - Return: `Promise<WebgSceneApp>`
  - Purpose: Functional form of `WebgSceneApp.create()`

After `create()` completes, renderer and Compute-physics resources are available.

### 2.2 Options

- **`project`**
  - Type: URL, `SceneAsset`, `SceneDefinition`, or manifest object
  - Purpose: Required scene/project source
- **`document`**
  - Type: `Document`
  - Purpose: Document used to find Canvas and UI in embedded contexts
- **`renderMode`**
  - Type: `"ondemand"` or `"continuous"`
  - Purpose: Defaults to `"ondemand"`; use continuous mode to keep requesting frames when the page is inactive; browser scheduling still applies
- **`camera`**
  - Type: object
  - Purpose: EyeRig pose, distance, and focus target
- **`physics`**
  - Type: `false`, `true`, or object
  - Purpose: Physics enablement, spatial matching, and initial pause
- **`effects`**
  - Type: object
  - Purpose: Enable `shadow`, `ssao`, `ssr`, and `dof`
- **`paused`**
  - Type: boolean
  - Purpose: Overrides initial `physics.paused`
- **`timeScale`**
  - Type: number
  - Purpose: Initial physics and animation rate; defaults to 1, range `0 < value <= 4`
- **`label`**
  - Type: string
  - Purpose: Name in diagnostics/errors; defaults to `scene-app`
- **`createScene`**
  - Type: function
  - Purpose: Create a scene if the project has no scene source
- **`onUpdate`**
  - Type: function
  - Purpose: Called when WebgApp updates a frame
- **`onReadback`**
  - Type: function
  - Purpose: Called when Compute-physics GPU readback completes
- **`onPresented`**
  - Type: function
  - Purpose: Called after final presentation is recorded
- **`onError`**
  - Type: function
  - Purpose: Receives frame or readback errors

Physics option fields:

- **`enabled`**
  - Values: boolean
  - Description: Enable Compute physics
- **`spatialMatch`**
  - Values: `report` or `require-match`
  - Description: Report or require spatial correspondence between display geometry and collider
- **`paused`**
  - Values: boolean
  - Description: Initial paused state

Camera fields include `target`, `distance`, `yaw`, `pitch`, `roll`, `minDistance`, `maxDistance`, `focusTarget`, and `focusTargetOffset`. When DoF is active, `focusTarget` accepts a Node ID or Node.

### 2.3 Lifecycle and Diagnostics

- **`sceneApp.start()`**
  - Description: Starts the frame loop and returns `sceneApp`
- **`sceneApp.stop()`**
  - Description: Stops the frame loop while retaining GPU resources
- **`sceneApp.setPaused(value)`**
  - Description: Toggles Compute-physics progress and returns `sceneApp`
- **`sceneApp.reset()`**
  - Description: Restores animation rest poses and initial physics state; clears registered particles and pending emission requests
- **`sceneApp.setTimeScale(value)` / `getTimeScale()`**
  - Description: Set/get physics, animation, and standard Compute-particle time scale; range `0 < value <= 4`
- **`sceneApp.getAnimationIds()` / `getAnimationState(id)`**
  - Description: Get animation IDs and playback state
- **`sceneApp.playAnimation(id, options)`**
  - Description: Start from the beginning; `{ loop: true }` repeats
- **`sceneApp.pauseAnimation(id)` / `resumeAnimation(id)`**
  - Description: Pause/resume playback
- **`sceneApp.stopAnimation(id)`**
  - Description: Stop while preserving current pose
- **`sceneApp.seekAnimation(id, seconds)`**
  - Description: Seek to a time in seconds
- **`sceneApp.resetAnimations()`**
  - Description: Stop animations and restore their registered initial poses
- **`sceneApp.onBeginContact(listener)`**
  - Description: Register a contact-start listener
- **`sceneApp.getDiagnostics()`**
  - Description: Return project, renderer, body, binding, readback, and error details
- **`sceneApp.destroy()`**
  - Description: Release app-owned frame, renderer, physics, and scene resources

The `onReadback` payload contains `frameIndex`, `stateData`, `contacts`, `fixedSteps`, and `physics`. `contacts` groups events into `begin`, `stay`, and `end`.

### 2.4 Standard Compute Particles

PBR-scene emissive particles use `ComputeParticleEmitter`. GPU computation handles initial values, movement, gravity, drag, and lifetime, and composites particles additively into the HDR image after transparency. Use `rgba16float` when registering with PBR. Set a display-format `targetFormat` when drawing directly to Canvas.

- **`await sceneApp.createComputeParticleEmitter(options, id)`**
  - Description: Creates and registers an emitter with PBR; ID is optional
- **`sceneApp.getComputeParticleEmitter(id)`**
  - Description: Gets an emitter registered from JavaScript or SceneYAML
- **`emitter.emit(count, options)`**
  - Description: Emits a burst; returns accepted, rejected, and reason data
- **`emitter.startEmission({ rate, ...options })`**
  - Description: Starts continuous emission at a rate per second
- **`emitter.stopEmission()`**
  - Description: Stops new continuous emission
- **`emitter.setPaused(boolean)`**
  - Description: Pauses or resumes motion and lifetime
- **`emitter.clear()`**
  - Description: Clears particles, pending requests, RNG sequence, and diagnostics while retaining emission settings
- **`emitter.getEstimatedAliveCount()`**
  - Description: Estimates reserved particles from lifetime, including pending requests
- **`emitter.getDiagnostics()`**
  - Description: Reports capacity, estimate, requests, rejections, and pause state
- **`emitter.setTimeScale(value)`**
  - Description: Sets a non-negative time scale; SceneApp registration applies scene scale
- **`emitter.destroy()`**
  - Description: Releases particle GPU resources; also called at app shutdown

Generation options include `preset: "spark" | "light" | "fountain"`, `capacity` (default 1024), `seed` (default 1), `overflow: "reject" | "replace-oldest"` (default `reject`), `simulation: { gravity, drag }`, and `appearance: { colors, intensity, size }`. `colors` contains two linear HDR RGB values; `size` is a radius range `[min, max]`.

Emission settings combine `position`, `lifetime: [min, max]`, and either `velocity` with `velocitySpread`, or `direction`, `spreadAngle`, and `speed: [min, max]`. Units are seconds, world units per second, and degrees. Burst count is an integer from 1 through capacity; up to 32 requests can be pending. `reject` reserves a contiguous free ring region per request. Capacity failure reasons include `particle-capacity` and `command-capacity`.

## 3. SceneDefinition and Project Manifests

`WebgSceneApp` uses the same data structure for SceneYAML and JSON project definitions. `SceneDefinition.load()` chooses YAML for `.yaml` and `.yml`, and JSON for `.json`. `materialsUrl` and `physicsUrl` follow the same extension rule. Original text and comments are preserved in source documents.

`.yaml.gz`, `.yml.gz`, and `.json.gz` are decompressed and passed to the same readers. `compressSceneYAML(text)`, available from `webg/app/index.js`, is a serialization API that gzip-compresses UTF-8 source including comments.

### 3.1 SceneDefinition API

- **`SceneDefinition.fromData(manifest, options)`**
  - Return: `SceneDefinition`
  - Description: Stores an object-form manifest
- **`SceneDefinition.load(url, options)`**
  - Return: `Promise<SceneDefinition>`
  - Description: Loads SceneYAML or JSON and records its base URL
- **`SceneDefinition.fromYAML(text, options)`**
  - Return: `SceneDefinition`
  - Description: Parses SceneYAML into a project definition
- **`definition.getSourceDocument()`**
  - Return: object or null
  - Description: Gets original format, text, comments, and URL
- **`definition.getSourceDocuments()`**
  - Return: Array
  - Description: Gets loaded source documents, including external documents
- **`definition.validate()`**
  - Return: `true`
  - Description: Validates manifest keys, types, and source combinations
- **`definition.loadMaterials()`**
  - Return: `Promise<Array>`
  - Description: Loads inline or external materials from YAML/JSON
- **`definition.loadPhysics()`**
  - Return: `Promise<object>`
  - Description: Loads inline or external physics settings from YAML/JSON
- **`definition.getRendererOptions()`**
  - Return: object
  - Description: Returns a copy of renderer settings
- **`definition.getPhysicsOptions()`**
  - Return: object
  - Description: Returns a copy of physics settings
- **`definition.getBindings()`**
  - Return: Array
  - Description: Returns Node-to-physics bindings
- **`definition.resolveUrl(value, fieldName)`**
  - Return: string
  - Description: Resolves a relative URL from the project base URL
- **`definition.build(target)`**
  - Return: `Promise<object>`
  - Description: Builds a scene runtime from `scene` or `sceneUrl`
- **`definition.buildPrimitiveScene(target)`**
  - Return: `Promise<object>`
  - Description: Builds a primitive scene from `objects` and `objectSets`
- **`definition.buildModelRuntime(target)`**
  - Return: `Promise<object>`
  - Description: Expands ModelAsset Nodes, meshes, and materials into runtime
- **`definition.createLoader(target)`**
  - Return: `SceneLoader`
  - Description: Creates a SceneLoader
- **`definition.destroy()`**
  - Return: boolean
  - Description: Releases the manifest and associated resources

### 3.2 Top-Level Manifest Keys

- **`name`**
  - Type: string
  - Description: Project name
- **`version`**
  - Type: integer
  - Description: Manifest format version; defaults to `1`
- **`renderer`**
  - Type: object
  - Description: PBR profile, environment, screen effects, output dimensions
- **`physics`**
  - Type: object
  - Description: Compute-physics space, bodies, and joints
- **`physicsUrl`**
  - Type: URL
  - Description: External physics manifest; extension selects YAML/JSON
- **`materials`**
  - Type: Array
  - Description: Inline material manifest
- **`materialsUrl`**
  - Type: URL
  - Description: External material manifest; extension selects YAML/JSON
- **`objects`**
  - Type: Array
  - Description: Primitive or inline-mesh placement, or settings for ModelAsset Nodes
- **`meshes`**
  - Type: Array
  - Description: Display meshes made from vertices and triangle/quad faces
- **`format`**
  - Type: string
  - Description: Use `webg-scene` for projects with inline meshes or animation
- **`animations`**
  - Type: Array
  - Description: Keyframe animations targeting object IDs
- **`objectSets`**
  - Type: Array
  - Description: Prototypes/variants and placement rules
- **`scene` / `sceneUrl`**
  - Type: object / URL
  - Description: Inline or external SceneAsset
- **`modelAsset` / `modelAssetUrl`**
  - Type: object / URL
  - Description: Direct ModelAsset or ModelYAML/JSON reference
- **`bindings`**
  - Type: Array
  - Description: Connects asset Nodes to physics bodies

Choose a scene source from `scene`/`sceneUrl`, `modelAsset`/`modelAssetUrl`, `objects`/`objectSets`, or `createScene`. When a ModelAsset is the source, `objects` connects its Nodes to project IDs and physics settings. A primitive scene combines `materials` or `materialsUrl` with inline `physics.space`.

`particleEmitters` is an array of standard Compute-particle settings with unique IDs. Provide optional `emission` with `rate` and emission conditions for continuous emission. See Chapters 9 and 26 for examples.

### 3.3 Primitive Objects

```yaml
id: ball
shape: {type: sphere, radius: 0.5}
transform: {position: [0.0, 3.2, 0.0]}
material: ball-material
physics:
  bodyType: dynamic
  mass: 1.0
  material: {restitution: 0.18, friction: 0.36}
```

- **`id`**
  - Description: Unique ID shared by scene, physics, joints, and diagnostics
- **`shape.type`**
  - Description: `box`, `sphere`, or `capsule`
- **`shape.size`**
  - Description: Full Box width, height, and depth
- **`shape.radius`**
  - Description: Sphere or Capsule radius
- **`shape.segmentLength`**
  - Description: Capsule center-line length; 0 becomes spherical
- **`shape.offset`**
  - Description: Local offset between display and body shapes
- **`transform.position`**
  - Description: Initial position; defaults to `[0, 0, 0]`
- **`transform.orientation`**
  - Description: `{yaw, pitch, roll}` or three degree values in `[X, Y, Z]` order; defaults to no rotation
- **`material`**
  - Description: String reference to `materials[].id`
- **`physics`**
  - Description: `static`, `kinematic`, or `dynamic` body settings

If `physics.shape` is omitted, the display `shape` is shared as the body shape. For a proxy collider, specify `physics.shape` and `colliderRelation: "proxy"` explicitly.

### 3.4 Object Sets

`objectSets[]` combines a `prototype` or `variants` with a `placement`:

| Field | Description |
| --- | --- |
| `prototype` | Shared shape, transform, material, and physics |
| `variants` | Multiple shape definitions keyed by `id` |
| `variantPattern` | Choose variants per instance using `cycle` or `range` |
| `placement.type` | Currently `grid3d` |
| `placement.count` | Counts along X, Y, and Z |
| `placement.origin` | Placement origin |
| `placement.spacing` | Spacing between instances |
| `placement.seed` | Reproducible seed for jitter |
| `placement.jitter` | Per-axis placement variation |
| `instancePattern` | `cycle` or `range` for `transform` and `physics` |
| `overrides` | Overrides for the set or individual instances |

## 4. PBR and Screen Effects

### 4.1 PbrRenderer API

- **`new PbrRenderer(gpu, options)`**
  - Return: `PbrRenderer`
  - Description: Begins PBR environment, pipeline, and copy-pass creation
- **`renderer.waitUntilReady()`**
  - Return: `Promise<PbrRenderer>`
  - Description: Waits for asynchronous GPU resources
- **`renderer.renderScene(space, cameraFrame, clearColor, options)`**
  - Return: `PbrRenderer`
  - Description: Renders scene into G-buffer
- **`renderer.encode(commandEncoder, options)`**
  - Return: output target
  - Description: Records deferred lighting through tone mapping
- **`renderer.present(screen, options)`**
  - Return: `PbrRenderer`
  - Description: Presents the encoded result to Canvas
- **`renderer.createFrameCallbacks(app, options)`**
  - Return: callback object
  - Description: Connects to WebgApp frame processing
- **`renderer.resize(width, height)`**
  - Return: boolean
  - Description: Resizes intermediate targets
- **`renderer.getDiagnostics()`**
  - Return: object
  - Description: Returns profile, size, environment, and DoF information
- **`renderer.setWater(body, options)`**
  - Return: `Promise<void>`
  - Description: Connects WaterBody surface and caustics; `null` releases dedicated GPU resources
- **`renderer.getWaterStats()`**
  - Return: object
  - Description: Returns water/surface state, dispatch/pass counts, and GPU timing
- **`renderer.afterGpuSubmit()`**
  - Return: void
  - Description: Collects timing after manual submit; standard callbacks do this automatically
- **`renderer.destroy()`**
  - Return: boolean
  - Description: Releases PBR resources

For `setWater()`, `surfaceEnabled` and `causticsEnabled` default to false; `quality` is `"low"` or `"high"`, defaulting to `"high"`. Pause new frames while switching and resume after completion. `ComputeEffectPipeline.setWater()` has the same contract. With both features off, dedicated processing counts are zero and timing is `null`. `ComputeEffectPipeline.getWaterStats()` has the same contract.

For direct construction, pass an initialized WebGPU context with `device` and `queue`, and positive integer `width` and `height`. Ordinary applications let `WebgSceneApp` perform this setup.

The `PbrRenderer` used by `WebgSceneApp` runs `PbrEnvironmentCompute` on environment radiance to generate irradiance, specular mips, and a BRDF LUT on the GPU. A lower-level CPU-precomputed route combines `PbrEnvironment` with `createProceduralEnvironmentData()`.

### 4.2 Renderer Manifest

```yaml
profile: studio
width: 960
height: 640
environment:
  preset: dark-studio
  resolution: {width: 128, height: 64}
dof: {enabled: false}
pipeline:
  lighting: {ambient: 0.0, environmentIntensity: 0.42}
  ssao: {radius: 12.0, strength: 1.15, samples: 8}
  ssr: {intensity: 0.65, distance: 24.0, steps: 28}
  toneMap: {exposure: 1.0}
```

- **`profile`**
  - Main fields: `studio`
  - Description: PBR, shadows, SSAO, SSR, and tone-map profile
- **`environment`**
  - Main fields: `preset`, `resolution`
  - Description: Procedural environment or lat-long image resolution; width:height is 2:1
- **`pipeline.shadow`**
  - Main fields: `type`, `bias`, `normalBias`, `pcfRadius`
  - Description: Directional or spot shadow
- **`pipeline.ssao`**
  - Main fields: `radius`, `strength`, `bias`, `samples`, `resolutionScale`
  - Description: Screen-space ambient occlusion
- **`pipeline.ssr`**
  - Main fields: `intensity`, `distance`, `thickness`, `steps`, `resolutionScale`, `reflectivityThreshold`
  - Description: Screen-space reflection
- **`pipeline.lighting`**
  - Main fields: `unitSystem`, `ambient`, directional/spot, environment
  - Description: Direct light and IBL; `relative` or `photometric`
- **`pipeline.composer`**
  - Main fields: `mode`
  - Description: `add`, `mix`, or `pbr-ssr`
- **`pipeline.toneMap`**
  - Main fields: `mode`, `exposure`, `exposureEv100`, `saturation`, `gamma`
  - Description: Converts linear HDR to Canvas display
- **`dof`**
  - Main fields: `enabled`, `focus`, `blurRadius`
  - Description: Depth of field with `rangeMeters` and `transitionMeters`

When environment lighting is enabled, set `pipeline.lighting.ambient` to `0.0`. Photometric units require `toneMap.exposureEv100`. Choose either `exposure` or `exposureEv100`.

### 4.3 PBR Materials

Primitive `materials[]` can specify `color`, `metallic`, `roughness`, `specular`, `occlusion`, `emissive`, `emissiveFactor`, and `alphaMode`. External materials for authoring scenes combine `assetMaterialId` with `pbr` or `preset`.

| Material value | Meaning |
| --- | --- |
| `color` | RGBA base color in the 0–1 range |
| `metallic` | Metal contribution, 0–1 |
| `roughness` | Specular roughness, 0–1 |
| `specular` | Dielectric specular amount |
| `occlusion` | Environment occlusion |
| `emissive`, `emissiveFactor` | Linear HDR emission separate from lighting |
| `alphaMode` | `OPAQUE`, `MASK`, or `BLEND` |
| `flatShading`, `doubleSided` | Normal and back-face rendering settings |

External-material `preset` can combine `tile`, `appearance`, `scale`, and `uvMapping`. `uvMapping` selects `real-cuboid`, `real-sphere`, or `real-capsule`.

### 4.4 WaterBody

Import from `webg/WaterBody.js` or `webg/app/index.js`. Connect water separately from the manifest using `setWater()`. See Chapter 35, `samples/water/index.html`, and `samples/fantasy/main.js`.

`new WaterBody(options)` stores the water region, waves, absorption, and receivers without creating GPU resources. Coordinates and distances use meters, time uses seconds, and absorption coefficients use inverse meters.

- **`origin`**
  - Meaning and default: Center of the horizontal irradiance reference plane; `[0, 0, 0]`
- **`width`, `depth`**
  - Meaning and default: Water-region XZ dimensions; 8 m each
- **`extent`**
  - Meaning and default: Irradiance square size; 2.5× the larger width/depth
- **`surfaceHeight`**
  - Meaning and default: Average world-space water Y; 2 m
- **`amplitude`**
  - Meaning and default: Upper bound on wave displacement; 0.15 m
- **`wavelength`, `speed`**
  - Meaning and default: Wave-length and time multipliers; 1 each, speed 0 stops motion
- **`waveMix`**
  - Meaning and default: Non-negative weights for cross waves, swells, and ripples; `[1, 0, 0]`
- **`variation`**
  - Meaning and default: Continuous wave modulation, 0–1; 0.65
- **`ior`**
  - Meaning and default: Index of refraction, 1–3; 1.333
- **`absorption`**
  - Meaning and default: RGB absorption coefficient; `[0.09, 0.035, 0.025]`
- **`roughness`**
  - Meaning and default: Water-surface roughness, 0.045–1; 0.06
- **`waterlineFade`**
  - Meaning and default: Caustics blend width at waterline; 0.08 m

`extent` must cover width and depth; average water depth `surfaceHeight - origin[1]` must exceed `amplitude`. See Chapter 35 and current source for valid ranges.

- **`water.setOptions(patch)`**
  - Description: Changes part of the configuration; invalid values throw and preserve the last valid settings. Wave and absorption changes do not require reconnecting `setWater()`.
- **`water.setTime(seconds)`**
  - Description: Sets non-negative time in seconds, usually from application update.
- **`water.addReceiver(target, options)`**
  - Description: Registers a Shape or Node; `strength` is 0–1, default 1; `children` defaults true. Shape registration takes precedence; a Node uses its nearest registered ancestor. Receivers are opaque surfaces.
- **`water.removeReceiver(target)`**
  - Description: Removes a registration and returns whether it existed.
- **`water.clearReceivers()`**
  - Description: Clears receiver registrations and returns `WaterBody`; renderer owns GPU connection and release.

Caustics approximate projection of a horizontal irradiance image under vertical incoming light. Surface display is for a finite horizontal region viewed from above; underwater-camera rendering is outside this path.

## 5. ScenePhysics and Physics APIs

### 5.1 ScenePhysics

```js
const physics = new ScenePhysics({
  gpu: app.getGPU(),
  gravity: [0.0, -9.8, 0.0],
  fixedTimeStepMs: 8.3333333333,
  maxSubSteps: 8,
  solverIterations: 10,
  planes: [{ normal: [0.0, 1.0, 0.0], planeDistance: 0.0 }]
});
```

The default backend is `compute`; specify `backend: "cpu"` for comparison and verification.

- **`new ScenePhysics(options)`**
  - Description: Creates CPU or Compute backend and bindings
- **`physics.addBody(node, options)` / `addRawBody(body)`**
  - Description: Adds a bound body or a body without Node binding
- **`physics.addPlane(node, options)`**
  - Description: Adds a plane
- **`physics.addJoint(joint)` / `removeJoint(joint)`**
  - Description: Adds or removes a joint
- **`physics.step(deltaMs, options)`**
  - Description: CPU steps immediately; Compute records into the supplied command encoder
- **`physics.createStateReadbackBuffer()`**
  - Description: Creates Compute-state readback buffer
- **`physics.encodeStateReadback(...)`**
  - Description: Records a Compute-state copy
- **`physics.readStateReadback(...)`**
  - Description: Reads GPU state asynchronously
- **`physics.sync()`**
  - Description: Synchronizes CPU body transforms to Nodes
- **`physics.syncReadback(stateData)`**
  - Description: Synchronizes Compute readback to Nodes
- **`physics.syncFromNodes()`**
  - Description: Writes CPU kinematic/static Node poses to bodies
- **`physics.syncComputeFromNode(bodyId, node, options)`**
  - Description: Records a Compute Node pose for the next GPU step
- **`physics.reset()` / `resetBody(bodyId, options)`**
  - Description: Resets all Compute bodies or one body
- **`physics.getBindings()` / `getBodies()`**
  - Description: Gets bindings or body list
- **`physics.getLastContacts()` and related methods**
  - Description: Gets contacts, manifolds, and contact events
- **`physics.raycast()` / `raycastAll()`**
  - Description: Finds ray/body intersections
- **`physics.queryAabb()`**
  - Description: Finds bodies overlapping an AABB
- **`physics.overlapSphere()`**
  - Description: Finds bodies overlapping a sphere
- **`physics.onBeginContact()` and related methods**
  - Description: Registers begin/stay/end listeners
- **`physics.destroy()`**
  - Description: Releases backend and bindings

Compute `step()` accepts `options.commandEncoder` and records GPU commands. CPU `step()` takes milliseconds and simulates on the CPU. `WebgSceneApp` abstracts the backend difference for application use.

### 5.2 ComputePhysicsSpace

Use `ComputePhysicsSpace` for advanced code that accesses GPU state directly.

- **`new ComputePhysicsSpace(gpu, options)`**
  - Description: Initializes GPU buffers, fixed steps, broad phase, and solver
- **`setBodies(bodies)`**
  - Description: Validates bodies and initializes state
- **`addBody(body)` / `removeBody(bodyId)`**
  - Description: Adds or removes a body
- **`addJoint(joint)` / `removeJoint(jointId)`**
  - Description: Adds or removes a Compute joint
- **`encode(commandEncoder, elapsedMs)`**
  - Description: Records elapsed time as fixed steps
- **`step(commandEncoder, elapsedMs)`**
  - Description: Alternate Compute recording entry matching `encode()`
- **`encodeFixedStep(commandEncoder)`**
  - Description: Records one clear, broad-phase, and solver step
- **`getRenderState()`**
  - Description: Gets GPU state-buffer information for rendering
- **`getCurrentStateBuffer()` / `getStateBuffers()`**
  - Description: Gets GPU state buffer(s)
- **`createStateReadbackBuffer()`**
  - Description: Creates a state readback buffer
- **`encodeStateReadback()`**
  - Description: Records the GPU-state copy
- **`readBodyStateFromReadback()`**
  - Description: Gets position, velocity, and sleep state for one body
- **`syncNodeFromPhysics()` / `syncNodesFromPhysics()`**
  - Description: Applies readback state to Nodes
- **`syncPhysicsFromNode()`**
  - Description: Records kinematic/static pose as control data
- **`applyForce()` / `applyImpulse()`**
  - Description: Records force or impulse on a body
- **`applyTorque()` / `applyAngularImpulse()`**
  - Description: Records rotational force or impulse
- **`teleport()` / `setBodyOrientation()`**
  - Description: Changes body position or orientation
- **`wakeBody()` / `sleepBody()` / `stopBodyMotion()`**
  - Description: Changes body motion state
- **`setBodyType()` / `setBodyMass()`**
  - Description: Changes body properties
- **`getContactsFromReadback()` and related methods**
  - Description: Gets contacts, manifolds, and events from readback
- **`raycastFromReadback()` and related methods**
  - Description: Queries readback state
- **`getBodyInfo()` / `getJointInfo()`**
  - Description: Gets IDs, slots, shapes, and joint settings
- **`destroy()`**
  - Description: Releases GPU resources

Compute colliders are `ComputeBoxCollider`, `ComputeSphereCollider`, and `ComputeCapsuleCollider`. Set planes in `ComputePhysicsSpace.planes` with `normal` and `planeDistance`. The standard broad phase uses an XZ grid.

### 5.3 CPU PhysicsSpace

For direct access to existing CPU physics, import `webg/PhysicsSpace.js`.

- **`new PhysicsSpace(options)`**
  - Description: Initializes gravity, fixed step, sleep behavior, and body capacity
- **`addBody(body)` / `removeBody(body)`**
  - Description: Registers/removes a CPU `PhysicsNode`
- **`addJoint(joint)` / `removeJoint(joint)`**
  - Description: Registers/removes a CPU joint
- **`step(deltaMs)`**
  - Description: Advances fixed steps through an accumulator
- **`raycast()` / `raycastAll()`**
  - Description: Queries CPU bodies with rays
- **`queryAabb()` / `overlapSphere()`**
  - Description: Spatial queries against CPU bodies
- **`onBeginContact()` and related methods**
  - Description: Registers contact-event listeners
- **`getLastContacts()` and related methods**
  - Description: Gets contacts and sleep-island results
- **`setGravity()`, `setFixedTimeStepMs()`**
  - Description: Updates space settings

## 6. WebgApp and Low-Level 3D APIs

### 6.1 WebgApp

`WebgApp` is the application foundation for GPU, Canvas, `Screen`, `Space`, camera, input, Message, and the update loop.

- **`new WebgApp(options)`**
  - Description: Initializes app settings and runtime state
- **`app.init()`**
  - Description: Initializes Screen, GPU, Space, camera, and UI
- **`app.start(handlers)` / `app.stop()`**
  - Description: Starts/stops frame loop
- **`app.getGPU()`**
  - Description: Returns initialized GPU wrapper
- **`app.createCameraRig()`**
  - Description: Creates base/rod/eye Node hierarchy
- **`app.createOrbitEyeRig(options)`**
  - Description: Connects an Orbit EyeRig and pointer input
- **`app.attachInput(handlers)`**
  - Description: Connects keyboard, pointer, and touch input
- **`app.loadScene(scene)`**
  - Description: Expands scene data into WebgApp Space
- **`app.loadModel(source, options)`**
  - Description: Loads a ModelAsset
- **`app.showOverlayPanel(options)`**
  - Description: Creates and displays an OverlayPanel
- **`app.setHudRows(rows, options)`**
  - Description: Updates HUD rows
- **`app.setControlRows(rows, options)`**
  - Description: Updates operation instructions
- **`app.createTween(target, to, options)`**
  - Description: Registers value interpolation over time
- **`app.createParticleEmitter(options)`**
  - Description: Creates and registers CPU ParticleEmitter
- **`app.registerActionMap(map)` / `getAction(name)`**
  - Description: Registers/gets an input action
- **`app.setFog(options)`**
  - Description: Updates standard-rendering fog
- **`app.getCurrentDiagnosticsReport()`**
  - Description: Gets current diagnostics report
- **`app.setDebugMode(mode)`**
  - Description: Switches `debug`/`release` mode
- **`app.saveProgress()` / `loadProgress()`**
  - Description: Saves/loads progress storage

For compute-first frames, combine `new WebgApp({ computeFrame: true })` with `start({ onComputeFrame })`. `onComputeFrame` records one frame containing Compute passes, Render passes, and queue submission. `WebgSceneApp` manages its own PBR and physics processing order.

### 6.2 Space, Node, and Shape

- **`Space`**
  - Main APIs: `addNode()`, `findNode()`, `draw()`, `update()`, `raycast()`, `checkCollisions()`
  - Role: Node hierarchy, drawing, animation, and low-level queries
- **`Node`**
  - Main APIs: `setParent()`, `setPosition()`, `setAttitude()`, `setScale()`, `addShape()`, `getWorldMatrix()`
  - Role: Parent hierarchy and world pose
- **`Shape`**
  - Main APIs: `setMaterial()`, `setMaterialAt()`, `setTexture()`, `applyPrimitiveAsset()`, `endShape()`, `draw()`, `destroy()`
  - Role: Geometry, materials, textures, and drawing resources
- **`Primitive`**
  - Main APIs: `sphere()`, `capsule()`, `cuboid()`, `cone()`, `revolution()`, `mapRealCuboid()`
  - Role: Geometry generation and real-scale UVs
- **`Screen`**
  - Main APIs: `beginPass()`, `endPass()`, `submit()`, `resize()`, `beginPresentPass()`
  - Role: Canvas, render targets, and command submission

To create a Shape, generate geometry with `Primitive`, pass it to `Shape.applyPrimitiveAsset()`, then finalize GPU resources with `Shape.endShape()`. Use `setMaterial()` for one material or `setMaterialAt()` and triangle material indices for multiple materials.

### 6.3 Camera and Coordinates

- **`EyeRig`**
  - Description: Manages Orbit, First Person, and Follow pose, pointer/touch control, and focus
- **`WebgApp.createOrbitEyeRig()`**
  - Description: Connects standard Orbit hierarchy and input updates
- **`CameraFrame`**
  - Description: Creates camera-relative coordinates and view matrix from camera world matrix
- **`createCameraFrameFromEye()`**
  - Description: Creates CameraFrame from an Eye Node
- **`createRenderFrameToken()`**
  - Description: Creates a token indicating one shared camera frame
- **`CAMERA_REVERSE_Z`**
  - Description: Ordinary camera Reverse-Z rule
- **`SHADOW_STANDARD_Z`**
  - Description: Shadow-map Standard-Z rule

The ordinary camera uses Reverse-Z; shadow maps use Standard-Z. Match depth format, clear value, compare function, and projection matrix to each convention.

## 7. Low-Level PBR, Compute Passes, and Data Assets

- **`PbrEnvironment`**
  - Main APIs: `getResources()`, `destroy()`
  - Role: Provides irradiance, prefiltered specular, and BRDF LUT
- **`ComputeEffectPipeline`**
  - Main APIs: `renderScene()`, `encode()`, `resize()`, `getBindingResources()`, `destroy()`
  - Role: G-buffer, PBR lighting, SSAO, SSR, and screen effects
- **`ComputePass`**
  - Main APIs: `setUniforms()`, `encode()`, `destroy()`
  - Role: Connects custom WGSL and storage resources
- **`DeferredLightingPass`**
  - Main APIs: `encode()`, `destroy()`
  - Role: Computes direct light and IBL from the G-buffer
- **`FullscreenPass`**
  - Main APIs: `draw()`, `destroy()`
  - Role: Draws a texture fullscreen
- **`ModelAsset`**
  - Main APIs: `load()`, `fromData()`, `validate()`, `build()`, `getClip()`
  - Role: Model mesh, Nodes, materials, and animation
- **`SceneAsset`**
  - Main APIs: `load()`, `fromData()`, `assertValid()`, `toSceneDefinition()`, `build()`
  - Role: Scene placement, meshes, physics, and renderer
- **`DocumentAsset`**
  - Main APIs: `fromYAML()`, `fromJSON()`, `getSourceDocument()`, `toYAMLText()`
  - Role: Shared SceneAsset/ModelAsset I/O
- **`MaterialParameters`**
  - Main APIs: `resolveShapeMaterial()`, `validateTransparency()`, `applyTransmissionParameters()`
  - Role: Resolves Shape material and transparent PBR values

### 7.1 ComputePass Frame Rules

`ComputePass.encode(commandEncoder, resources, options)` records GPU commands. The caller submits them. Manage resources in this order:

1. Create storage buffers, storage textures, and uniforms.
2. Pass bindings to `ComputePass`.
3. Record Compute commands with `encode()` into the same encoder.
4. Record required Render passes.
5. Submit once with `queue.submit()`.
6. Release resources with `destroy()` when the page ends.

Use `rgba16float` for HDR intermediates and a display format for the final Canvas target. Apply tone mapping once for final display.

### 7.2 Choose an Asset API

- **Build placement, PBR, and physics from SceneYAML/JSON**
  - API: `SceneAsset`, `SceneDefinition`, `WebgSceneApp`
- **Use mesh, animation, and skeleton**
  - API: `ModelAsset`
- **Create primitives from code or SceneYAML/project JSON**
  - API: `Primitive`, `Shape`, `SceneDefinition`
- **Apply external PBR materials to Nodes**
  - API: `SceneDefinition.applyMaterials()`
- **Generate textures and use real-scale mapping**
  - API: `ProceduralMaterials`, `ProceduralTileSpec`, `Primitive.mapRealCuboid()`

### 7.3 SceneAsset and ModelAsset I/O

Both inherit from `DocumentAsset`. They load a shared YAML/JSON data structure, then validate their respective asset contents.

- **`SceneAsset.load(url)` / `ModelAsset.load(url)`**
  - Description: Loads `.yaml`, `.yml`, `.json`, and gzip variants
- **`fromYAML(text, options)` / `fromJSON(text, options)`**
  - Description: Creates an asset from text
- **`getData()` / `setData(data)`**
  - Description: Gets/sets parsed values
- **`getSourceDocument()` / `getSourceUrl()`**
  - Description: Gets source, comments, and origin URL
- **`toYAMLText()`**
  - Description: Returns YAML; returns original source if unchanged
- **`toJSONText(indent, options)`**
  - Description: Returns JSON text
- **`downloadYAML(filename)` / `downloadYAMLGz(filename)`**
  - Description: Saves YAML or compressed YAML
- **`assertValid()`**
  - Description: Validates asset references and values

To save an edited document with comments, pass updated YAML source to `fromYAML()`. `toYAMLText()` throws when parsed values change without a corresponding source update. To convert comment-bearing YAML to JSON, make the choice explicit with `toJSONText(2, { allowCommentLoss: true })`.

## 8. Joints, Colliders, and Physics Events

### 8.1 Joints

- **`Joint`**
  - Description: Shared body A/B, compliance, enabled, and collision-suppression settings
- **`DistanceJoint`**
  - Description: Linear constraint maintaining distance between two anchors
- **`FixedJoint`**
  - Description: Fixes relative pose of two bodies
- **`BallSocketJoint`**
  - Description: Keeps two anchors at the same position
- **`HingeJoint`**
  - Description: Allows rotation around a specified axis
- **`JointDefinition`**
  - Description: Validates SceneYAML Distance Joint and converts it to Compute definition

Distance Joint settings include `bodyA`, `bodyB`, `localAnchorA`, `localAnchorB`, `distance`, `compliance`, and `collideConnected`. Identify bodies by scene binding ID or Compute body ID; keep GPU slot indices internal.

### 8.2 Colliders

- **`BoxCollider`**
  - Compute: `ComputeBoxCollider`
  - Shape: Rotatable Box
- **`SphereCollider`**
  - Compute: `ComputeSphereCollider`
  - Shape: Sphere
- **`CapsuleCollider`**
  - Compute: `ComputeCapsuleCollider`
  - Shape: Capsule aligned to local Y
- **`PlaneCollider`**
  - Compute: `ComputePlaneCollider`
  - Shape: Infinite plane from normal and distance

CPU colliders provide `getAabb()`, `intersectRay()`, `overlapsAabb()`, and `overlapSphere()`; infinite planes return no finite AABB. The Compute GPU solver supports Box, Sphere, Capsule, and Plane; a Capsule's center line is local Y.

### 8.3 Contact Events

- **`onBeginContact(listener)`**
  - Description: Event for the frame contact starts
- **`onStayContact(listener)`**
  - Description: Event while contact continues
- **`onEndContact(listener)`**
  - Description: Event when contact ends
- **`offBeginContact(listener)` and related methods**
  - Description: Removes listeners
- **`getContactsFromReadback()`**
  - Description: Gets contacts from readback state
- **`getManifoldsFromReadback()`**
  - Description: Gets contact manifolds
- **`getContactEventsFromReadback()`**
  - Description: Gets begin/stay/end events
- **`raycastFromReadback()` and related methods**
  - Description: Queries GPU state after readback

## 9. Common Usage Rules

### 9.1 Asynchronous Operations

`WebgSceneApp.create()`, `createWebgSceneApp()`, `SceneDefinition.load()`, `PbrRenderer.waitUntilReady()`, and asset `load()` methods return Promises. Start later drawing, physics, and material assignment after each Promise resolves.

### 9.2 Command Encoder and Submission

Compute physics, `ComputePass`, and `PbrRenderer.encode()` record work into a command encoder. Choose one owner for encoder creation and queue submission per frame. Keep Compute, readback, draw, and presentation ordered for that frame. In `WebgSceneApp`, `SceneFrame` owns this order.

### 9.3 Input Validation and Exceptions

Public APIs validate unknown keys, array lengths, numeric ranges, unsupported enums, and GPU-resource state at call time. Errors identify their input path, such as `renderer.pipeline.ssao.samples` or `physics.bodies[2].shape`, so the setting can be corrected directly.

### 9.4 Resource Lifecycle

The class that creates a GPU resource owns its `resize()` and `destroy()`. On shutdown, release frame, renderer, physics, scene, Shape, and additional-pass resources according to their ownership. If ownership is shared, specify the boundary in options.

## 10. Order for Finding an API

1. Find the class and main methods in this catalog.
2. Read the corresponding chapter for role, ordering, and input requirements.
3. Inspect a `WebgSceneApp` example in `samples/project_app/`.
4. Check sample README and SceneYAML/JSON for configuration format.
5. Check `headless_tests/` for boundaries and exception conditions.
6. Use `unittest/` or a browser to inspect GPU output and interaction.
7. Confirm public methods and resource ownership in current `webg/*.js`.

- **WebgApp, Canvas, input, and UI**
  - Documentation and sample: `05_AppStructure.md`, `12_UI.md`
- **SceneYAML, ModelYAML, and assets**
  - Documentation and sample: `09_Scenes.md`, `08_Models.md`
- **CPU/Compute physics**
  - Documentation and sample: `27_Physics.md`, `28_PhysicsEvents.md`
- **Procedural materials and real-scale UVs**
  - Documentation and sample: `29_ProceduralTextures.md`
- **PBR, IBL, and environment lighting**
  - Documentation and sample: `30_PBR.md`, `31_PBRDesign.md`
- **Low-level Shape and rendering**
  - Documentation and sample: `37_LowLevelAPI.md`
- **Physics solver internals**
  - Documentation and sample: `42_PhysicsInternals.md`, `27_Physics.md`

This catalog identifies current 3.0 entry points and major low-level APIs. For exact profile values, schemas, and implementation limits, consult current source in `webg/app/` and `webg/`, sample SceneYAML/JSON, and the corresponding tests.
