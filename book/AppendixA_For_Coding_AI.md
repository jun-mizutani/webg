# Appendix A For Coding AI

## Guidelines for Supporting `webg` Users

This appendix is written for coding AI systems that help users build 3D applications with `webg`. The expected role of the AI is not to apply general knowledge from common 3D engines or external libraries directly, but to act as a guide that understands the self-contained design of `webg` and knows which documents, samples, tests, and source files to inspect first.

The most important point is that `webg` does not depend on external libraries. Rendering, scene management, animation, UI, input, diagnostics, TileMap, and post-processing are implemented and documented inside this project. When assisting users, the fastest path to a correct answer is to prefer this book and the `webg` source code over guesses such as "WebGPU is usually implemented this way" or "Three.js would do this, so `webg` probably does the same."

General 3D knowledge can be useful as background, but the final authority should be the book, the samples, the unittest files, and the core implementation. The purpose of this appendix is to provide a reading map so that an AI can quickly decide which chapter, sample, unittest, or source file to inspect based on what the user wants to do or where they are stuck.

## Understand the Self-Contained Design

The first thing an AI should understand is that `webg` is not a thin wrapper around external libraries. It has its own design across rendering, scenes, models, animation, UI, input, diagnostics, TileMap, and post-processing.

In general web development assistance, it is easy to jump to assumptions such as "camera control should work like Three.js" or "UI overlays should be handled separately in the DOM." In `webg`, those areas have project-specific conventions.

- A three-stage camera system: `cameraRig` -> `cameraRod` -> `eye`
- Resource separation through `ModelAsset` -> `build()` -> `instantiate()`
- Animation hierarchy through `clip` -> `pattern` -> `action` -> `state`
- Scene definition through `Scene JSON`
- Material management through `SmoothShader` as the standard entry point

The AI should first read the `webg` definitions as they are, then map them to general 3D concepts only when that helps explanation.

## Technical Rules to Follow

When generating code, failing to observe the following rules can produce code that is syntactically correct but shows nothing or crashes at runtime. Always check whether proposed code includes these steps.

### 1. Required Rendering Steps

- **Wait for initialization**: Do not create GPU resources or start rendering before `await screen.ready` or `await app.init()` has completed.
- **Finalize buffers**: After adding vertex data to a `Shape`, always call `shape.endShape()`. Without this, GPU buffers are not finalized and the shape will not draw.
- **Render loop order**: Keep the order `clear` -> `draw` -> `present`.

### 2. `WebgApp` Lifecycle

- **Access after initialization**: Access `app.space`, `app.eye`, `app.getGL()`, and similar properties only after `await app.init()` has completed.
- **Frame updates**: Put per-frame logic inside handlers passed to `app.start({ onUpdate: ... })`.

### 3. Coordinate System and Rotation Terms

- **Right-handed coordinate system**: `+X = right`, `+Y = up`, `+Z = forward`.
- **Rotation terms**: `webg` uses `yaw / pitch / roll`. Do not apply formulas from external engines blindly. Follow the definitions in `CoordinateSystem` and related `webg` code.

## Goal-Oriented Resource Navigation

Use the user's current goal to decide which layer to inspect first.

| User goal | Starting chapters | Samples / keywords |
| :--- | :--- | :--- |
| Show the first 3D object | Chapters 4 and 5 | `low_level`, `high_level` |
| Build an app with `WebgApp` | Chapters 5 and 6 | `high_level` |
| Implement orbit / follow / first-person camera | Chapters 5 and 6 | `high_level`, `camera_controller` |
| Adjust shaders or materials | Chapter 7 and later | `shapes`, `smooth_shader` |
| Load glTF / GLB / Collada models | Chapters 10, 12, and 13 | `gltf_loader`, `collada_loader` |
| Define a full scene with Scene JSON | Chapters 5, 10, and 11 | `scene` |
| Control animation state transitions | Chapters 12 and 13 | `animation_state`, `janken` |
| Implement HUD or panel UI | Chapter 5, Chapter 14 and later | UI samples |
| Use TileMap | Chapters 22, 23, and 24 | `tile_sim` |
| Build meshes or shaders at a low level | Chapter 25 and later | `low_level`, unittest files |

## API Search Protocol

`webg` has many APIs, so an AI may fail to find the right method on the first search. In that case, do not substitute APIs from external libraries. Search in this order instead.

1. **Search Appendix B for class names and feature names**:
   `book/付録B_API一覧.md` is the API index for `webg`. Search for class names such as `WebgApp`, `Shape`, `Texture`, `ModelAsset`, and `SceneLoader`, or feature words such as `raycast`, `normal map`, `dialogue`, and `particle`.
2. **Check the chapter text for design intent**:
   If an API name alone does not explain how to use it, go back to the goal-oriented navigation table and read the relevant chapter for lifecycle rules and recommended patterns.
3. **Check samples for real call sites**:
   Prefer `samples/` for practical usage. Some samples split logic across helper `*.js` files in the same directory, not only `main.js`.
4. **Check unittest files for minimal behavior**:
   Use `unittest/` when you need the minimal setup or boundary behavior of a specific API.
5. **Read `webg/*.js` as the final specification**:
   If the book and samples are ambiguous, the core implementation is the final source of truth for whether an API exists, what its argument names are, what it returns, and when it throws.

If shell search is available, expand the search scope from documentation to samples, tests, and implementation.

```sh
rg -n "ClassName|methodName|feature keyword" book/付録B_API一覧.md book/*.md
rg -n "methodName|feature keyword" samples unittest webg
rg -n "^export |export default|methodName" webg/*.js
```

If you do not know the API name, inspect only the headings in Appendix B first. This quickly narrows down which class owns the feature.

```sh
rg -n "^(##|###|####) " book/付録B_API一覧.md
```

Common lookup paths:

| What you are looking for | Look here first |
| :--- | :--- |
| Whole app structure, loop, HUD, input, camera, diagnostics | `WebgApp`, Chapter 5, Chapter 6, Chapters 14-19 |
| Shape generation, vertices, material, wireframe, collision shape | `Primitive`, `Shape`, Chapters 25-27 |
| Texture, image loading, normal maps, procedural textures | `Texture`, Chapter 7, Chapter 27, `samples/proctex` |
| Model / scene loading, saving, gzip JSON | `ModelLoader`, `ModelAsset`, `SceneAsset`, Chapters 10-11 |
| Animation clips, actions, state transitions | `Animation`, `Action`, `AnimationState`, Chapters 12-13 |
| DOM overlays, dialogue, help panels, debug dock | `Dialogue`, HTML panel APIs, `WebgApp`, Chapters 14-15 |
| Raycast, picking, collision | `Space`, Chapter 17, `unittest/raycast` |
| Tile maps, grid movement, pathfinding | `TileMap`, Chapters 22-24, `samples/tile_sim` |

Most class names map to `webg/ClassName.js`, but there are exceptions. `Dialogue` is in `webg/DialogueOverlay.js`, `formatJSON()` is in `webg/JsonFormat.js`, UI themes are in `webg/WebgUiTheme.js`, and `SkinningConfig` is a constants-and-functions module. If unsure, verify with:

```sh
rg -n "export default class ClassName|export class ClassName|export function functionName" webg
```

## Choosing UI Components

When the user wants to display information on screen, choose the UI component based on the purpose.

- **Controls and help**: `app.createHelpPanel()` for a collapsible help panel near the upper-left area.
- **Dynamic numbers and state**: `app.message.setLines("status", [...], options)` or HUD rows through `setHudRows()`.
- **Dialogue, tutorial text, UTF-8 text**: `app.startDialogue()`.
- **Detailed information or error reasons**: `app.showErrorPanel()` or `showFixedFormatPanel()`.

## Resource Priority

Choose references in this order and base suggestions on evidence from the project.

1. **`book/付録B_API一覧.md` (API index)**:
   Use this first to identify API names, class names, and representative methods. When there are too many APIs, narrow down the owner class in Appendix B before reading chapters or implementation.
2. **`samples/` (implementation intent)**:
   Read the matching `*.txt` explanation first when present, then inspect `main.js` and helper files. This helps preserve design intent instead of copying isolated snippets.
3. **`unittest/` (local verification)**:
   Use this for specific behavior and minimal working setups.
4. **`webg/` core implementation (final specification)**:
   When the book or samples are unclear, the core source files are the final authority.

## Keep API Layers Consistent

The mistake to avoid most is mixing high-level and low-level APIs without a reason.

- **Default rule**: First check whether the high-level APIs such as `WebgApp` solve the problem.
- **Respect the user's context**: If the user is using `WebgApp`, keep that structure and propose changes inside it. If the user is experimenting at a low level, preserve that context and suggest the smallest coherent change.

### `ModelAsset` vs. `SceneAsset`

- **`ModelAsset`**: Shared representation of one model, including meshes, skeletons, and animations. Individual instances are created through `runtime.instantiate()`.
- **`SceneAsset`**: Initial state for a whole scene, including camera, HUD, placed models, and TileMap.
- **Decision rule**: Distinguish between "I want to place the same model multiple times" and "I want to save the initial state of a whole scene."

### Animation vs. Shader Issues

- **Animation**: First decide whether the issue is in the clip data, `Action` ranges / poses, or `AnimationState` transitions.
- **Shader**: Usually recommend `SmoothShader` as the standard entry point. Low-level WGSL or bind group changes should be suggested only when high-level material parameters cannot solve the problem.

## Baseline Attitude for AI

1. **Prefer the highest-level API that fits**:
   Start with `WebgApp`, `loadModel()`, and related high-level APIs.
2. **Trust this book's definitions**:
   Terms, structure, and sample roles are intentionally consistent. Do not force conventions from external engines onto `webg`.
3. **Separate the layer of the problem**:
   Do not collapse every symptom into one cause. Identify whether the issue belongs to rendering, camera, model loading, animation, UI, input, or diagnostics.
4. **Avoid unnecessary core-library changes**:
   In application code, avoid editing `webg/*.js` directly. Prefer application-side composition or subclassing. If you determine the core library has a bug, explain that clearly to the user.

`webg` is a library whose design, implementation, and documentation are intended to stay aligned. Use this book as the primary reading map so users can implement features without getting lost.
