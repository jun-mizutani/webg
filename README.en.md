# webg

English | [日本語](README.md)

`webg` is a self-contained library for building 3D applications with JavaScript and WebGPU.

It provides a unified framework for rendering, shaders, 3D mathematics, scene graphs, model assets, animation, UI, input handling, collision detection, a physics engine, sound, post-processing, and diagnostics. For input, touch, mouse, and pen events are collected through Pointer Events and exposed as the same gesture model, making smartphone-style direct manipulation easy to test in a desktop browser as well.

`webg` is not merely a thin wrapper around WebGPU. It is a library that implements the core features required to build WebGPU-based 3D applications using JavaScript and WebGPU, without depending on an external 3D engine.

[All sample apps can be executed from here.](https://jun-mizutani.github.io/webg/samples/index.html)

![samples](./samples/samples1.jpg)

## Design Principles

`webg` is designed around the following principles:

- Do not depend on an external 3D engine
- Do not hide the structure of WebGPU too much
- Provide both high-level and low-level APIs
- Make it easy to trace from samples to the library implementation
- Treat 3D mathematics, shaders, models, scenes, UI, input, and physics as one integrated system
- Treat touch, mouse, and pen input through the same gesture model so interaction design can span devices
- Provide a structure that is easy for both humans and AI tools to reference
- Support both learning and practical application development

`webg` is not intended to directly replace large general-purpose 3D engines such as Three.js or Babylon.js. Instead, it is intended to be a controllable and understandable WebGPU 3D engine for developers who want to understand the structure of WebGPU-based 3D applications while building them.

## Main Features

The main strength of `webg` is that it does not stop at 3D rendering. It also includes the surrounding pieces needed to finish an application, all within the same design. Detailed API names are summarized in the “API Layers” section below and explained throughout `book/`. This section focuses on what each area is useful for.

### WebGPU Rendering Foundation

`webg` performs 3D rendering directly with WebGPU. With `Screen`, `Shader`, `Shape`, `RenderTarget`, and related classes, you can work explicitly with Canvas rendering, vertex buffers, index buffers, textures, depth buffers, WGSL shaders, and other WebGPU structures.

At the same time, `WebgApp` can prepare GPU initialization, standard shaders, the render loop, camera, HUD, input, and diagnostics for you. You can start from the high-level API, then inspect or replace lower-level pieces only where needed.

### Models, Scenes, and Animation

`webg` handles primitive shapes, procedural geometry, glTF / GLB, Collada, textures, normal maps, and skinning. Model data is separated from rendering as `ModelAsset`, so generation, loading, validation, and placement in a scene can be handled step by step.

Scenes are built as hierarchies with `Space` and `Node`. They can be assembled directly in code or loaded through JSON-based `SceneAsset` / `SceneLoader`. Animation ranges from one-shot Tween interpolation to Clip / Pattern / Action / State transitions and bone animation.

### UI, Input, and Diagnostics

In 3D applications, rendering, input, UI, and diagnostic display are closely related. `webg` treats Canvas HUD, DOM overlays, `OverlayPanel`, `DebugDock`, keyboard, mouse, touch, virtual buttons, and camera controls as parts of the application structure.

`Touch.attachSurface()` uses Pointer Events as its common input path, so smartphone tap / double tap / long press / flick gestures can be verified with the same conditions using a mouse in a desktop browser. This makes it possible to tune mobile-style UI with desktop developer tools instead of relying only on physical mobile-device testing.

Diagnostics are designed for development workflows where internal state can be inspected, not just the final rendered result. `Diagnostics`, `DebugDock`, `DebugProbe`, and feature-specific unit tests make it easier to share what is happening during AI-assisted development as well.

### Physics, Sound, and Post-Processing

`webg` includes a lightweight physics engine that works with the scene structure. Static / kinematic / dynamic bodies, gravity, velocity, restitution, damping, fixed timesteps, and Box / Sphere / Capsule / Plane colliders can be used for falling objects, bouncing, floors, walls, object intersections, and camera or character interactions.

Sound is built on the Web Audio API and covers sound effect generation, playback, simple synthesizers, bus structures, and application-event integration. Post-processing is built around RenderTarget and FullscreenPass, with effects such as Bloom, DOF, and Vignette.

## API Layers

`webg` can be used at multiple layers depending on the purpose.

| Layer | Main Classes | Purpose |
|---|---|---|
| High-level API | `WebgApp` | Handles application initialization, rendering loop, camera, input, UI, and diagnostics |
| Scene API | `Space`, `Node`, `SceneAsset`, `SceneLoader` | Handles scene construction, hierarchy, and JSON-based scene loading |
| Model API | `Shape`, `Primitive`, `ModelAsset`, `ModelBuilder`, `ModelLoader` | Handles meshes, primitive shapes, external models, and model assets |
| Math API | `Matrix`, `Quat`, etc. | Handles 3D coordinate transformations, rotations, matrices, and quaternions |
| Rendering API | `Screen`, `Shader`, `RenderTarget`, `FullscreenPass` | Handles WebGPU rendering directly |
| Animation API | `Tween`, `Clip`, `Pattern`, `Action`, `State` | Handles interpolation, animation, and state transitions |
| Input API | Input control classes | Handles keyboard, mouse, touch, gestures, and virtual buttons |
| Physics API | `PhysicsSpace`, `PhysicsNode`, Collider classes | Handles gravity, collision detection, and physics behavior |
| Sound API | `AudioSynth`, `ToneSynth`, `GameAudioSynth` | Handles Web Audio API-based sound processing |
| Diagnostics API | `Diagnostics`, `DebugDock`, `DebugProbe` | Handles debug display, state inspection, and validation support |

For ordinary application development, it is recommended to start with `WebgApp` and then directly use `Space`, `Node`, `ModelAsset`, `PhysicsSpace`, and other APIs as needed.

## Version 1.0.0 Scope

`webg` 1.0.0 is intended to be the stable baseline for building WebGPU 3D applications by placing this repository directly in a project.

The scope considered stable API in 1.0.0 is the library’s core functionality, namely `webg/*.js`. It consists of the public classes and methods described or used in `README`, `book/`, `book/examples/`, `samples/`, and `unittest/`. In particular, `WebgApp`, `Space`, `Node`, `Shape`, `Primitive`, `ModelAsset`, `SceneAsset`, `SceneLoader`, `InputController`, `Touch`, `OverlayPanel`, `Diagnostics`, `AudioSynth`, `ToneSynth`, `GameAudioSynth`, `PhysicsSpace`, `PhysicsNode`, and the Collider classes will be maintained with compatibility in mind as user-facing APIs after 1.0.0.

If compatibility-affecting changes become necessary in the future, compatibility with the old API will be preserved where practical, or the migration path will be explained in README or `book/`. On the other hand, samples such as `samples/mmodeler` are not covered by the same level of compatibility guarantee as the library APIs themselves.

Because `webg` does not use external packages and therefore does not require resolving complex dependencies, it is intended to be distributed through the GitHub repository (https://github.com/jun-mizutani/webg) and the samples published on GitHub Pages (https://jun-mizutani.github.io/webg/samples/index.html), rather than as an npm package.

## Repository Structure

```text
webg/
  book/         Technical documentation
    examples/   Executable code examples used in the documentation
  samples/      Feature-specific sample applications
  tools/        Utility tools
  unittest/     Feature validation tests and minimal reproduction environments
  webg/         Library source code
```

## Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/jun-mizutani/webg.git
cd webg
```

At the moment, `webg` is intended to be used by placing the repository directly in your project, rather than as an npm package.

Because `webg` uses relative imports with ES Modules and asset loading through `fetch()`, keep the directory structure intact when using it.

### 2. Start a Local Server

To use WebGPU, ES Modules, and asset loading correctly, open the files through an HTTP server instead of `file://`.

Using Python 3:

```bash
python3 -m http.server 8000
```

Using Node.js:

```bash
npx http-server . -p 8000
```

### 3. Open the Sample Index

Open the following URL in your browser:

```text
http://localhost:8000/samples/index.html
```

## Recommended Order for Checking Samples

If you are trying `webg` for the first time, the following order is recommended.

1. [samples/index.html](https://jun-mizutani.github.io/webg/samples/index.html)
   Confirm that the sample index is displayed.

2. If you want a quick overview of the feature range, open the following representative samples and also read the `.txt` explanation file in each folder.
   `samples/mmodeler/index.html` is useful for checking the mobile-profile UI and the double-tap / long-press centered input model, `samples/cube4/index.html` for basic 3D display, `samples/circular_breaker/index.html` for a game-like application structure, and `samples/physics_collider/index.html` for physics-engine and collider behavior.

3. `samples/low_level`
   Check rendering that is close to a minimal WebGPU setup.

4. `samples/high_level`
   Check the standard application structure using `WebgApp`.

5. `samples/scene`
   Check scenes, nodes, and asset loading.

6. `samples/gltf_loader` or `samples/collada_loader`
   Check external 3D model loading.

7. `samples/skinning`
   Check bone structures and skinning.

8. `samples/physics_bounce` or `samples/physics_collider`
   Check the behavior of the physics engine and collision detection.

9. Continue with samples for post-processing, sound, UI, input, and other features as needed.

## Basic Usage

When using the high-level API, use `WebgApp` as the entry point for your application.

The basic structure is as follows:

```javascript
import WebgApp from "../../webg/WebgApp.js";

async function main() {
  const app = new WebgApp("webgpu-canvas");

  await app.init();

  // Configure models, nodes, scenes, UI, input, and other features here.

  app.start({
    onUpdate: (deltaTime) => {
      // Write per-frame update logic here.
    }
  });
}

main();
```

For actual rendering, adding models, camera control, and integration with the physics engine, see the samples under `samples/`.

## Documentation

The `book/` directory contains chapter-based technical documentation explaining the design and usage of `webg`. It covers installation, 3D graphics basics, minimal WebGPU rendering, application structure with `WebgApp`, cameras, shaders, model assets, scenes, animation, UI, input, collision detection, sound, diagnostics, post-processing, low-level APIs, skinning, and the physics engine.

If you are reading it for the first time, start with chapters 2 through 6 to understand the runtime environment, minimal rendering, `WebgApp`, and camera control. After that, jump to the chapters for the features you need.

## Samples

The [samples/](https://jun-mizutani.github.io/webg/samples/index.html) directory contains feature-specific sample applications. You can run examples for low-level rendering, the high-level API, external model loading, scene loading, skinning, animation, UI, input, Raycast, post-processing, sound, physics, collision detection, and model editing.

Each sample includes both implementation files and explanatory text. The samples are not only demos; they are reference implementations for understanding how each feature is used.

## Tests and Validation

The [unittest](https://jun-mizutani.github.io/webg/unittest/index.html) directory contains feature-specific validation pages. They cover small, focused checks for API contracts, input control, message display, OverlayPanel, physics, Raycast, Primitive, skinning, touch input, Tween, Vignette, and related behavior.

These pages are useful not only for regression checks when adding or modifying features, but also as specification references during AI-assisted development.

## AI-Assisted Development

`webg` includes design explanations, API lists, samples, and feature-specific documentation so that it can be referenced easily during AI-assisted development.

When asking an AI tool to generate or modify code using `webg`, it is recommended to provide the following files as references:

- `book/付録A_コーディングAIの皆さまへ.md`
- `book/AppendixA_For_Coding_AI.md`
- `book/付録B_API一覧.md`
- Relevant examples under `samples/`
- Relevant validation pages under `unittest/`

When making requests to an AI tool, it is usually more effective to specify the `webg` APIs to use, the target sample, the expected node structure, the input method, and the desired physics behavior, rather than simply asking it to “write WebGPU code.”

**Note on Language:** While the documentation and internal code comments are predominantly written in Japanese, the source code itself is written in English. Since modern LLMs are proficient in both languages, non-Japanese speakers can seamlessly use AI to bridge the language gap and obtain accurate technical guidance by providing the relevant chapters from `book/` or implementation examples from `samples/` as context.

## Supported Environment

`webg` is intended to run on modern browsers that support WebGPU. On smartphones, it has only been tested with the latest browser versions.

Recommended browsers:

- Google Chrome
- Microsoft Edge
- Firefox
- Safari

However, behavior may differ depending on the browser, operating system, GPU, and GPU driver because WebGPU implementations are still browser- and platform-dependent.

If a problem occurs, check the following:

- Whether you are using a browser that supports WebGPU
- Whether the files are opened through an HTTP server instead of `file://`
- Whether WebGPU is enabled in the browser
- Whether the GPU driver is up to date
- Whether the browser developer tools show WebGPU initialization errors
- Whether relative paths in the samples are still intact

## License

MIT License

## Author

- Author: Jun Mizutani
- Website: https://www.mztn.org/
