# Samples

English | [日本語](README.md)

For a first project, use the [Getting Started and Examples](../book.en/01_Introduction.md) chapter or the [browser guide](../book/examples/guide.en.html) to choose a starting point for the app you want to build. They show how to move from examples that explain individual concepts to feature samples and complete applications in this directory.

`samples` contains browser-based applications for people using webg to explore API usage, rendering, interaction, and performance. It includes both focused feature examples and application-scale examples that combine multiple features.

Small browser pages for checking individual features belong in `unittest/`. Automated contracts that do not require a browser belong in `headless_tests/`. Runnable examples that accompany the book belong in `book/examples/`.

During development, if a browser reuses an older ES module URL for webg, open [`cache_clear_webg/cache_clear_webg.html`](./cache_clear_webg/cache_clear_webg.html) through a web server and select “全coreを再import” (“Reimport all core modules”). The page loads every JavaScript module under `webg` with a unique `?v=...` URL. Core modules retain their original import statements.

## Scope and purpose

To add water and caustics to a PBR scene, start with [water](water/index.html). One example demonstrates independent on/off controls, receiver registration, shared waves, depth and transparency composition, and resource release when the effect is off.

For a compact integration example that combines caustics with a swimming GLB model, see [aquarium](aquarium/index.html). It connects dolphin bone animation, swimming paths on parent Nodes, a procedural seabed material, fog, and particles, and lets you toggle caustics on the dolphins alone.

### Feature and API samples

These examples present one or a few features in a readable structure. Examples include `axis`, `billboard`, `bloom`, `dof`, `falling_box`, `falling_dominoes_cpu`, `gltf_loader`, `json_loader`, `materials`, `pbr_reference`, `physics_bounce`, `procedural_texture`, `shapes`, and `transmission`.

`falling_box` compares CPU `PhysicsSpace` and Compute `ComputePhysicsSpace` using the same falling-box scenario with 200 bodies. The CPU version uses the CPU Box contact solver, which has been checked for chain reactions, settling, and waking. The Compute version demonstrates GPU `BodyState` and the WGSL solver.

`falling_dominoes_cpu` is a CPU `PhysicsSpace` comparison for the same 32-body Box and Plane scenario as the public Compute sample `falling_dominoes`. The CPU version uses CPU Box contact handling. Checks confirm equivalent chain order, floor support, and persistent sleep between the CPU and Compute versions.

### Application-scale samples

These examples combine multiple states, inputs, UI elements, models, and rendering features to show application-like structures. For a small integration example, start with `fantasy`. This game uses a stepped PBR map and connects materials, Node updates, picking, particles, resizing, and resource cleanup. Follow the reading order in [`fantasy/README.md`](fantasy/README.en.md) and the book's [companion guide](../book.en/PBRSceneToGame.md), changing one part at a time.

Larger examples include:

- `mmodeler`: a tool for model editing, hierarchies, materials, saving, and loading
- `cube4`: a 3D falling-block game
- `maze2`: a maze game with an integrated rendering pipeline
- `circular_breaker`: a circular breakout game
- `compute_json`: an animated ModelAsset viewer with integrated Compute effects
- `compute_cloth`: GPU cloth simulation with display, interaction, and measurement
- `compute_texture`: GPU texture feedback with pointer interaction
- `compute_benchmark`: GPU workload comparisons across multiple passes and result saving
- `pbr_reference`: integrated comparisons of Forward and Deferred PBR, IBL, HDR, SSR, and transparent materials
- `texture_catalog`: selection, editing, preview, and code generation for core Procedural Texture presets

Directories are not divided by application size. The catalog and documentation explain each sample's purpose while keeping public URLs and references between samples stable.

## Public Compute samples

The table lists nine public samples whose primary purpose is Compute processing. Other examples also use Compute for physics comparisons or SceneYAML-based applications. The integrated PBR effects are shown in [book example 32_01](../book/examples/32_01.html); example [33_01](../book/examples/33_01.html) covers overall settings and display. Refer to the relevant chapters for each pass's inputs and outputs.

| Sample | Main purpose | Status |
|---|---|---|
| `compute_benchmark` | GPU measurement of PBR and Compute processing | Retain |
| `compute_cloth` | Mass-spring GPU simulation | Retain |
| `compute_json` | Animated ModelAsset viewer | Retain |
| `compute_particles` | GPU particle update and rendering | Retain |
| `compute_particle_emitter` | Emit and stop standard Compute particles from SceneYAML and render them with PBR | Retain |
| `compute_physics` | Box and Sphere rigid-body simulation with core ComputePhysicsSpace | Retain |
| `falling_dominoes` | Box contact chains and persistent sleep with core ComputePhysicsSpace | Retain |
| `compute_physics_bounce` | GPU sphere simulation | Retain |
| `compute_texture` | Ping-pong texture feedback | Retain |

Each pass example shows how image quality, internal targets, GPU workload, and boundary conditions affect the result.

## How samples are organized

1. Keep CPU and Compute, low-level and high-level, or standalone and integrated examples when they serve a clear comparison.
2. When samples share only a scene or UI, consolidate the shared implementation in a helper or core module while retaining each sample's purpose.
3. Choose names that make the input, approach, and core API clear.
4. Consider combining or removing a sample only when its distinct purpose is gone and another sample covers its interaction, display, and explanation.
5. Large samples demonstrate feature integration and complement smaller focused samples.

## Running the samples

Serve the repository over HTTP, open `samples/index.en.html`, and choose a demo or README. The `README.md` and `README.en.md` in each directory are the source documentation; `index.html` and `index.en.html` are generated reading pages.
