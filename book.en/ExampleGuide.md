# Development Entry Points and Runnable Examples

This guide connects application goals to runnable pages, code, and book chapters. Use it with the [browser guide](../book/examples/guide.html), which provides the same entry points and checkpoints in a browsable form.

`book/examples/` contains compact runnable code for understanding a chapter. `samples/` contains comparisons, model loading, editing tools, games, and applications that combine multiple features. Use book examples to learn one feature, and samples to see how features work together in an application.


To use `lib/webg.core.min.js`, start with “Load the Bundled Library” in
Chapter 2. Chapter 4 shows the import replacement for the same minimal example.
[Appendix C](Appendix_C_Bundle.md) covers sample conversion. The class and method
descriptions in this book apply to both loading methods.

## 1. Run One Example First

Serve the repository root over HTTP:

```sh
python3 -m http.server 8000
```

Open `http://localhost:8000/book/examples/04_02.html`. Check the cube, its rotation, orbiting by dragging, and zooming with the wheel. Chapter 2 explains serving requirements; Chapter 4 explains the full HTML and where it lives.

## 2. Choose an Entry Point for Your Application

- **Place shapes and move them with input**
  - Runnable starting points: [`04_02`](../book/examples/04_02.html) → [`high_level`](../samples/high_level/high_level.html)
  - Main entry point and first chapters: `WebgApp`; Chapters 4–6; place updates in `onUpdate`
- **Display a GLB model**
  - Runnable starting points: [`gltf_loader`](../samples/gltf_loader/gltf_loader.html) → [`embedded_glb_viewer`](../samples/embedded_glb_viewer/embedded_glb_viewer.html)
  - Main entry point and first chapters: `WebgApp.loadModel()`; Chapter 8; the second example supports file selection, model replacement, and embedding
- **Define placement, PBR, and physics as documents**
  - Runnable starting points: [Sphere and Plane](../samples/project_app/project_app_sphere_plane.html) → [`scene_model_yaml`](../samples/scene_model_yaml/scene_model_yaml.html)
  - Main entry point and first chapters: SceneYAML and `createWebgSceneApp()`; Chapter 9, then Chapter 8 for external models
- **Make a game with input, score, start, pause, and restart**
  - Runnable starting points: [`breakout`](../samples/breakout/breakout.html)
  - Main entry point and first chapters: `WebgApp` with application-side game state; Chapters 5 and 12–16
- **Combine PBR, physics, particles, and sound in a showcase**
  - Runnable starting points: Sphere and Plane → [`compute_particle_emitter`](../samples/compute_particle_emitter/compute_particle_emitter.html) → [`lumen`](../samples/lumen/lumen.html)
  - Main entry point and first chapters: `WebgSceneApp`; Chapters 9 and 26–30; repeated showcase motion is JavaScript-driven
- **Edit placement or models in a UI and save them**
  - Runnable starting points: [`model_yaml`](../samples/model_yaml/model_yaml.html) → [`edit_yaml`](../samples/edit_yaml/edit_yaml.html)
  - Main entry point and first chapters: `ModelAsset`, `SceneAsset`, and `WebgSceneApp`; Chapters 8–9; Chapter 15 for selection and editing
- **Write custom shaders, rendering, or GPU computation**
  - Runnable starting points: Choose from [`19_01`](../book/examples/19_01.html), [`20_01`](../book/examples/20_01.html), and [`21_01`](../book/examples/21_01.html)
  - Main entry point and first chapters: `WebgApp` and individual APIs; Chapters 18–22; Chapter 37 for rendering internals

For a PBR game that moves and attacks on a map with elevation, begin at `samples/fantasy/fantasy.html`. The reading sequence is in [From a PBR Scene to a Small Game](PBRSceneToGame.md) and the sample guide.

Choose between defining scene placement, materials, physics, and rendering in SceneYAML or building them directly in JavaScript. Use `WebgApp` for a simple screen and `WebgSceneApp` to start a PBR application from SceneYAML. Adding a feature does not require changing the application entry point.

For PBR alone, start with SceneYAML `renderer` and `materials`. Read Chapters 31–33 when you need to control rendering order or individual passes with `ComputeEffectPipeline`.

To add water and caustics to PBR, use `samples/water/index.html` to reach `samples/water/water.html`, then read Chapter 35. It demonstrates receiver registration, shared waves, independent toggles, and GPU-resource release. Chapter 35 also covers wave height, wavelength, speed, RGB absorption, and draw order for transparent surfaces, particles, and post-processing. To apply the feature to gameplay, open `samples/fantasy/fantasy.html` and `connectWater()` in `samples/fantasy/main.js`.

## 3. Read the Starting Code

### Build Directly with `WebgApp`

[`04_02`](../book/examples/04_02.html) keeps initialization, shape creation, `Node`, and updates together in the page's `example-source`. The [`high_level` source](../samples/high_level/main.js) adds usage instructions and screenshots to startup and updates.

Begin by changing one value such as color, `Node` position, or rotation speed. Keep the working setup while adding cameras, input, and UI. Await `init()`, finish each shape with `endShape()`, attach it to a `Node`, and then start frame updates.

### Start an Application from SceneYAML

Read the [Sphere and Plane JavaScript](../samples/project_app/project_app_sphere_plane_demo.js) alongside its [SceneYAML](../samples/project_app/project_app_sphere_plane_project.yaml).

- YAML `objects` describe objects and initial placement, `materials` describe surfaces, `physics` sets simulation conditions, and `renderer` configures PBR.
- JavaScript uses `createWebgSceneApp()` and handles camera, buttons, and status display.
- The example's Start/Stop buttons use `setPaused()` for physics. This differs from the frame loop's `start()` and `stop()`.
- Physics starts paused. Check that Start drops the sphere, Stop pauses it, and Reset restores its initial placement.

First change one value such as sphere color or starting position. If you change the displayed floor and collision plane, keep them aligned. Check `physics.space.maxBodies` when adding spheres. `onUpdate` receives `deltaSec` in seconds, as in `WebgApp`; high-level physics updates internally, so application code does not add another physics `step()`.

For an external model hierarchy, continue to [`scene_model_yaml`'s code](../samples/scene_model_yaml/main.js), [`scene.yaml`](../samples/scene_model_yaml/scene.yaml), and [`model.yaml`](../samples/scene_model_yaml/model.yaml). ModelYAML describes internal shapes and `Node` hierarchy; SceneYAML describes application physics and rendering. The example also covers saving, resetting to a paused state, error reporting, and `destroy()` on shutdown.

### Build Game Progression

Read the [`breakout` guide](../samples/breakout/README.md) for controls and states, then inspect [`main.js`](../samples/breakout/main.js) for state transitions, `registerActionMap()`, `onUpdate`, the HUD, and restart. It is a complete game with title, play, pause, and result states, and demonstrates combining 3D rendering with game rules.

`GameStateManager` is [application-side shared sample code](../samples/GameStateManager.js), not a core `webg` API. Narrow the states and controls needed by your application before adapting a larger sample.

### Go from a PBR Scene to a Small Game

Use `samples/fantasy/` for a game that moves and attacks on a map with elevation. Run `samples/fantasy/fantasy.html`; find controls and reading order in `samples/fantasy/README.md`; use `samples/fantasy/index.html` for the browser overview.

[From a PBR Scene to a Small Game](PBRSceneToGame.md) maps direct Shape materials, updates to added Nodes, screen-space picking, resizing, and the lifetime of particles and resources to functions in the sample. Start at `main.js`'s `start()`, then read `scene.js`, `visuals.js`, `move()` and `updateMotion()`, `pickTile()`, and `FantasyApp.js`.

First change only armor roughness, then one unit's movement allowance, step duration, and footstep particle color. This shows when each API updates application state. The sample keeps the rules and visuals separate and uses no rigid-body physics.

## 4. Add Only the Features You Need

Each entry connects a focused example to an application sample and gives a concrete checkpoint for understanding.

- **Parent-child transforms**
  - Small example → application example: [`03_01`](../book/examples/03_01.html) → [`detouch`](../samples/detouch/detouch.html)
  - Chapters and checkpoint: Ch. 3: child inherits parent transform; reparent while preserving world placement
- **Orbit, follow, and first-person cameras**
  - Small example → application example: [`06_01`](../book/examples/06_01.html), [`06_02`](../book/examples/06_02.html) → [`eye_rig`](../samples/eye_rig/eye_rig.html)
  - Chapters and checkpoint: Ch. 6: distinguish position following from looking toward a target
- **Embed in a web page**
  - Small example → application example: [`05_03`](../book/examples/05_03.html) → [`embedded_glb_viewer`](../samples/embedded_glb_viewer/embedded_glb_viewer.html)
  - Chapters and checkpoint: Ch. 5: page scrolling, Canvas input, and display after model replacement
- **Materials, textures, and normal maps**
  - Small example → application example: [`07_01`](../book/examples/07_01.html), [`07_02`](../book/examples/07_02.html) → [`shapes`](../samples/shapes/shapes.html)
  - Chapters and checkpoint: Ch. 7: compare color, texture, normal map, and wireframe on the same shape
- **Share a `ModelAsset` across placements**
  - Small example → application example: [`08_01`](../book/examples/08_01.html) → [`model_yaml`](../samples/model_yaml/model_yaml.html)
  - Chapters and checkpoint: Ch. 8: build once and place in separate Nodes; distinguish the source document from runtime instances
- **Load model formats**
  - Small example → application example: [`gltf_loader`](../samples/gltf_loader/gltf_loader.html), [`collada_loader`](../samples/collada_loader/collada_loader.html), [`json_loader`](../samples/json_loader/json_loader.html)
  - Chapters and checkpoint: Ch. 8: read the needed format; check origin, scale, clips, and relative asset references
- **Select animation states**
  - Small example → application example: [`10_01`](../book/examples/10_01.html) → [`animation_state`](../samples/animation_state/animation_state.html) → [`janken`](../samples/janken/janken.html)
  - Chapters and checkpoint: Chs. 10–11: separate Action playback from state selection; check independent playback per placement
- **Animate objects in SceneYAML**
  - Small example → application example: [`scene_animation`](../samples/project_app/scene_animation.html)
  - Chapters and checkpoint: Chs. 9–11: distinguish Play, Pause, Seek, Reset, and stopping the frame loop
- **HUD, help panel, and theme**
  - Small example → application example: [`12_01`](../book/examples/12_01.html), [`12_02`](../book/examples/12_02.html), [`13_01`](../book/examples/13_01.html) → [`com_palette`](../samples/com_palette/com_palette.html)
  - Chapters and checkpoint: Chs. 12–13: separate short status from DOM interaction and long text; connect UI to app state
- **Touch input**
  - Small example → application example: [`14_01`](../book/examples/14_01.html) → [`breakout`](../samples/breakout/breakout.html)
  - Chapters and checkpoint: Ch. 14: connect keyboard and touch gestures to the same action
- **Selection and collision queries**
  - Small example → application example: [`15_01`](../book/examples/15_01.html) → [`collisions`](../samples/collisions/collisions.html)
  - Chapters and checkpoint: Ch. 15: distinguish raycast, broad-phase candidates, and detailed tests; queries are separate from collision response
- **Sound effects, BGM, and audio files**
  - Small example → application example: [`16_02`](../book/examples/16_02.html)–[`16_05`](../book/examples/16_05.html) → [`sound`](../samples/sound/sound.html)
  - Chapters and checkpoint: Ch. 16: start audio after user input; single-tone design is in [`16_01`](../book/examples/16_01.html) and [`tone`](../samples/tone/tone.html)
- **Diagnostics and issue reports**
  - Small example → application example: [`17_01`](../book/examples/17_01.html)
  - Chapters and checkpoint: Ch. 17: preserve environment, failed stage, and application state in diagnostics
- **Add bloom and DoF to standard rendering**
  - Small example → application example: [`23_01`](../book/examples/23_01.html) → [`bloom`](../samples/bloom/bloom.html), [`dof`](../samples/dof/dof.html)
  - Chapters and checkpoint: Chs. 23–25: compare before and after; check focus position for depth-based effects
- **Lightweight CPU particles**
  - Small example → application example: [`26_01`](../book/examples/26_01.html) → [`billboard`](../samples/billboard/billboard.html)
  - Chapters and checkpoint: Ch. 26: check emission conditions and display; GPU particles use a different update path
- **Add standard Compute particles to PBR**
  - Small example → application example: [`compute_particle_emitter`](../samples/compute_particle_emitter/compute_particle_emitter.html) → [`compute_particles`](../samples/compute_particles/compute_particles.html)
  - Chapters and checkpoint: Chs. 26 and 36: continuous/burst emission, stop, clear, and capacity; the second example connects directly in a Compute frame
- **CPU physics**
  - Small example → application example: [`27_01`](../book/examples/27_01.html) → [`physics_bounce`](../samples/physics_bounce/physics_bounce.html), [`physics_collider`](../samples/physics_collider/physics_collider.html)
  - Chapters and checkpoint: Chs. 27–28: physics runs on CPU and rendering on WebGPU; `PhysicsSpace.step()` uses milliseconds
- **Render GPU physics with ordinary Nodes**
  - Small example → application example: Sphere and Plane → [`27_02`](../book/examples/27_02.html)
  - Chapters and checkpoint: Chs. 9 and 27–28: use the high-level path first; use 27_02 to inspect readback and Node synchronization
- **Direct GPU physics rendering and comparison**
  - Small example → application example: [`27_03`](../book/examples/27_03.html) → [`compute_physics`](../samples/compute_physics/compute_physics.html), [`falling_box`](../samples/falling_box/README.md), [`joint`](../samples/joint/README.md)
  - Chapters and checkpoint: Chs. 27–28 and 42: distinguish direct GPU state rendering from CPU readback; choose the Joint page by method
- **Procedural materials and real-world UV scale**
  - Small example → application example: [`29_01`](../book/examples/29_01.html) → [`texture_catalog`](../samples/texture_catalog/texture_catalog.html)
  - Chapters and checkpoint: Ch. 29: compare object dimensions and pattern period, then export settings or images
- **Generate height and normal maps**
  - Small example → application example: [`proctex`](../samples/proctex/proctex.html) → [`procedural_texture`](../samples/procedural_texture/procedural_texture.html)
  - Chapters and checkpoint: Chs. 7 and 29: distinguish height from normal; start real-world materials at 29_01
- **PBR materials and environment lighting**
  - Small example → application example: [`30_01`](../book/examples/30_01.html), [`30_02`](../book/examples/30_02.html) → [`pbr_reference`](../samples/pbr_reference/pbr_reference.html)
  - Chapters and checkpoint: Ch. 30: compare metallic/roughness, direct light, IBL, and exposure independently
- **Connect a PBR pipeline**
  - Small example → application example: [`31_01`](../book/examples/31_01.html) → [`32_01`](../book/examples/32_01.html) → [`33_01`](../book/examples/33_01.html)
  - Chapters and checkpoint: Chs. 31–33: use the same reference scene and pass one frame's camera data to each stage
- **Transparency, refraction, and AO**
  - Small example → application example: [`opacity`](../samples/opacity/opacity.html), [`transmission`](../samples/transmission/transmission.html), or [`34_01`](../book/examples/34_01.html)
  - Chapters and checkpoint: Chs. 25 and 33–35: inspect opacity, material slots, refraction, and AO debug views separately
- **Measure GPU performance**
  - Small example → application example: [`compute_benchmark`](../samples/compute_benchmark/compute_benchmark.html)
  - Chapters and checkpoint: Chs. 22 and 33: check timing support and which processing stage is measured
- **Custom meshes and terrain**
  - Small example → application example: [`38_01`](../book/examples/38_01.html) → [`38_02`](../book/examples/38_02.html), [`38_03`](../book/examples/38_03.html) → [`39_04`](../book/examples/39_04.html), [`lowlevel_terrain`](../samples/lowlevel_terrain/lowlevel_terrain.html)
  - Chapters and checkpoint: Chs. 38–39: relate vertices, UVs, faces, and normals; use `WebgApp` for the application framework
- **Skinning internals**
  - Small example → application example: [`40_01`](../book/examples/40_01.html), [`40_02`](../book/examples/40_02.html) → [`skinning`](../samples/skinning/skinning.html), [`bone_creature`](../samples/bone_creature/bone_creature.html)
  - Chapters and checkpoint: Ch. 40: for existing-model playback, start with Chapters 8 and 10–11

## 5. Study Examples That Combine Features

Read a larger example after finding the minimal API for each feature. Choose one close to your application and inspect how scene configuration, application updates, input, and UI work together.

For water, use `samples/water/index.html` to compare settings and toggles, and `samples/fantasy/index.html` to see water added to an existing game. First understand receivers and waves in the water sample; then follow their connection to movement, particles, input locking, and restart in Fantasy.

- **[`breakout`](../samples/breakout/README.md), [`cube4`](../samples/cube4/README.md)**
  - What to study: Game states, input, score, HUD, restart; cube4 adds a 3D board and camera-relative controls
- **[`janken`](../samples/janken/README.md)**
  - What to study: Two placements share a model but have independent animation, connected to input and match results
- **[`circular_breaker`](../samples/circular_breaker/README.md), [`circular_breaker2`](../samples/circular_breaker2/README.md)**
  - What to study: Directly assembled game versus SceneYAML/ModelYAML with PBR
- **[`maze`](../samples/maze/README.md), [`maze2`](../samples/maze2/README.md)**
  - What to study: First-person movement, generated walls and collision, radar, lighting and screen effects; inspect game-side wall collision
- **[`lumen`](../samples/lumen/README.md), [`neon_coaster`](../samples/neon_coaster/README.md), [`void_strike`](../samples/void_strike/README.md)**
  - What to study: High-level application use, repeated showcase motion, follow camera, shooting, and particles
- **[`project_app`](../samples/project_app/README.md)**
  - What to study: Extend Sphere and Plane through joints, object sets, variants, and authoring scenes
- **[`edit_yaml`](../samples/edit_yaml/README.md), [`mmodeler`](../samples/mmodeler/README.md), [`karakuri`](../samples/karakuri/README.md)**
  - What to study: Editing state, selection, undo/redo, save/load, and division between authoring and runtime
- **[`compute_json`](../samples/compute_json/README.md)**
  - What to study: Display an animated `ModelAsset` JSON and connect screen effects manually
- **[`compute_cloth`](../samples/compute_cloth/README.md), [`compute_texture`](../samples/compute_texture/README.md)**
  - What to study: Update buffers and textures with custom WGSL; distinguish these from standard rigid-body physics and particles

## 6. Adapt an Example to Your Application

1. Run the example in place and compare its controls and checkpoints with what appears on screen.
2. Inspect the HTML, JavaScript imports, YAML/JSON, images, and model files it reads. Include shared helpers and assets from other samples in the dependency list.
3. Choose one application entry point. Before adding another frame loop, physics step, or final display pass, identify the processing already performed by the high-level application.
4. Change one feature or setting and describe the expected display or interaction. Add the next feature while keeping the working state.
5. Adapt relative paths and DOM IDs for your HTML and hosting location. When replacing a model, check clip names, Node IDs, origin, and dimensions.
6. Decide what to release on shutdown or replacement. Distinguish shared models from their instances, and follow the sample's `destroy()` usage for high-level applications.

Sample-only classes and helpers are application code, not core API. Read their actual imports instead of inferring ownership from their names. Samples such as `compute_cloth`, `compute_texture`, and `compute_physics_bounce` include custom GPU processing even when the result resembles a standard feature. For ordinary physics, start with Sphere and Plane or `physics_bounce`.

## 7. When an AI Agent Helps with Development

Start from the user's goal and choose one entry point in this guide. Briefly identify the runnable page and source to use, the feature to add, and how to check the result. People and AI agents can use the same examples and checkpoints.

Find a class in the [API catalog](Appendix_D_API.md), then read its chapter and runnable example. Do not map a familiar API name from another 3D library directly onto webg; check the actual import, call, and return value. If a unit, default, or automatic update scope is unclear, inspect the current implementation and tests.

Use `headless_tests/` for API contracts and calculations, and `unittest/` for small browser checks. Static link/import presence, absence of runtime exceptions, and the intended visible result are separate checks. Report only the checks that were actually completed.

The overall indexes are [book examples](../book/examples/index.html) and [samples](../samples/index.html).
