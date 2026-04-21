# webg

[English](README.en.md) | [日本語](README.md)

`webg` is a comprehensive library for building 3D applications using JavaScript and WebGPU. 
Beyond providing a basic rendering engine, it implements a unified system that encompasses scene management, model manipulation, animation, UI, input handling, diagnostic tools, TileMaps, and post-processing.

The core philosophy of `webg` is not merely to provide a convenient API, but to create a seamless bridge between low-level mathematical implementations and high-level application architecture. It is designed to allow developers to learn the inner workings of 3D graphics while simultaneously building their own applications.

## Technical Design Philosophy

To ensure a consistent design and eliminate dependency on external framework specifications, `webg` adopts a self-contained architecture. By integrating everything from the rendering engine to the UI, sound, and TileMap internally, development can begin immediately in any modern browser (such as Chrome, Firefox, or Safari) without external overhead.

The library features a layered API design, allowing developers to choose the level of abstraction that best suits their needs:

- **High-level (High-layer) API**: Represented by `WebgApp`, this layer facilitates rapid development by managing the application lifecycle and providing a standard configuration.
- **Mid-level (Mid-layer) API**: Represented by `ModelAsset` and `SceneAsset`, this layer separates resource blueprints (data) from their runtime instances for efficient management.
- **Low-level (Low-layer) API**: This layer provides the mathematical foundation—including `Shape`, `Shader`, `Matrix`, and `Quat`—allowing developers to directly manipulate WebGPU primitives and implement custom rendering logic.

Furthermore, `webg` maintains strict alignment between its implementation and its documentation. The following resources are bundled together, enabling a synergistic learning experience:

- **`book/`**: Comprehensive technical documentation covering everything from the fundamentals of 3D mathematics to the principles of skinning.
- **`samples/`**: Practical implementation examples demonstrating each feature.
- **`unittest/`**: A minimal environment for isolated functional verification and debugging.

This structure supports an efficient verification workflow: "Verify specifications in the documentation $\rightarrow$ Follow implementation examples in the samples $\rightarrow$ Confirm details in the core source code."

## Capabilities

`webg` enables the implementation of advanced 3D graphics features:

In terms of rendering, it allows for the implementation of custom WGSL shaders and the optimization of Bind Groups to maximize WebGPU performance. The asset pipeline supports the import of glTF (.glb) and Collada files, utilizing `ModelAsset` for efficient resource sharing.

Animation is managed through a sophisticated four-layer structure: `clip` $\rightarrow$ `pattern` $\rightarrow$ `action` $\rightarrow$ `state`, allowing for intuitive management of complex state transitions. The user interface integrates Canvas HUDs, DOM overlays, and diagnostic panels, supporting interactions such as touch input, virtual buttons, and object picking via Raycasting.

Additionally, the library provides spatial management through TileMaps for logical board representations, post-processing effects such as Bloom and Depth of Field (DOF), and a sound system based on the Web Audio API with a dedicated bus architecture.

## Repository Structure

The repository is organized as follows:

```text
webg/
  book/         Technical documentation
  samples/      Feature-specific sample applications
  unittest/     Unit tests for functional verification
  webg/         Core library
```

## Setup and Execution Environment

### 1. File Placement
`webg` is designed to be used by placing the repository directly into your project rather than installing it as a package. To maintain the module loading via relative paths, please preserve the root directory structure of the repository.

```bash
git clone https://github.com/jun-mizutani/webg.git
cd webg
```

### 2. Starting a Local Server
Because the library utilizes ES Modules (`import`), asset loading via `fetch()`, and WebGPU initialization (`navigator.gpu`), **you must access the project via a local server.** Accessing files via the `file://` protocol will result in resource loading restrictions due to the Same-Origin Policy (SOP).

**Example commands:**
```bash
# Using Python 3
python3 -m http.server 8000

# Using Node.js (npx)
npx http-server . -p 8000
```

Once the server is running, navigate to the following URL in your browser:
`http://localhost:8000/samples/index.html`

### 3. Verification Steps
After setup, we recommend verifying the environment step-by-step. This helps isolate whether a problem is related to server configuration, WebGPU support, or asset paths.

1. `samples/index.html`: Confirm the server is running correctly.
2. `samples/low_level`: Confirm basic WebGPU rendering in a minimal configuration.
3. `samples/high_level`: Confirm the standard configuration using `WebgApp` is operational.
4. `samples/scene`: Confirm that external assets are loading and the scene is composing correctly.
5. Proceed to more detailed samples based on your objectives.

## Recommended Learning Path

To deeply understand the design philosophy of `webg`, we recommend the following progression:

**Foundations**: Chapter 2 (Environment) $\rightarrow$ Chapter 3 (Mathematics) $\rightarrow$ Chapter 4 (Minimal Rendering) $\rightarrow$ Chapter 5 (`WebgApp`).

**Feature Implementation**: 
- Camera (Chapter 6) $\rightarrow$ Shaders (Chapters 7–9) $\rightarrow$ Models (Chapter 10).
- Scene Composition (Chapter 11) $\rightarrow$ Animation (Chapters 12–13).
- UI, Input, and Sound (Chapters 14–18).

**Internal Architecture**: 
- TileMap (Chapter 22 onwards) $\rightarrow$ Low-level APIs and Skinning Principles (Chapters 25–28).

## For AI Assistants

`webg` is engineered with strict consistency in terminology and a clear separation of layers, making it highly suitable for AI-assisted development. When using LLMs (Large Language Models) to generate code or solve problems, providing the relevant chapters from `book/` or implementation examples from `samples/` as context will result in highly accurate suggestions that align with the library's design philosophy.

**Note on Language:** While the documentation and internal code comments are predominantly written in Japanese, the source code itself is written in English. Since modern LLMs are proficient in both languages, non-Japanese speakers can seamlessly use AI to bridge the language gap and obtain accurate technical guidance by providing the relevant chapters from `book/` or implementation examples from `samples/` as context.

## License
MIT License

## Author
Author: Jun Mizutani
Website: https://www.mztn.org/
