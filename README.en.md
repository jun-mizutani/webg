# webg

[English](README.en.md) | [日本語](README.md)

`webg` is a library for building 3D applications using JavaScript and WebGPU.  
It implements a unified system encompassing **rendering, scene management, models, animation, UI, input, diagnostics, TileMap, and post-processing**—all without depending on external libraries.

Rather than simply providing a set of APIs, `webg` is designed as a continuous path from low-level mathematical implementation to high-level application structure, emphasizing the ability to develop and learn while tracing the internal architecture.

## Technical Features

### 1. Self-contained Architecture
From the rendering engine to the UI, sound, and TileMap, all necessary functions are implemented within `webg`. This allows for development based on a consistent design philosophy without being bound by the specifications of external frameworks.

### 2. Hierarchical API Design
Depending on the use case, developers can choose from APIs of different abstraction levels:
- **High-level API (`WebgApp`)**: Quickly build a standard application structure and manage the application lifecycle.
- **Mid-level API (`ModelAsset`, `SceneAsset`)**: Resource management based on the separation of data (blueprints) and runtime (instances).
- **Low-level API (`Shape`, `Shader`, `Matrix`, `Quat`)**: Directly manipulate WebGPU primitives to implement custom rendering logic.

### 3. Alignment between Implementation and Documentation
To ensure a seamless development experience, this repository includes the following resources alongside the library:
- **`book/`**: Technical documentation providing a systematic explanation from 3D mathematical foundations to the principles of skinning.
- **`samples/`**: Implementation examples demonstrating the use of each feature.
- **`unittest/`**: Minimal environments for isolated functional verification and debugging.

This structure enables a verification workflow where the developer can "Confirm specifications in the documentation $\rightarrow$ Trace implementation in the samples $\rightarrow$ Verify details in the core code."

## Capabilities

- **WebGPU Rendering**: Implementation of custom WGSL shaders and Bind Group optimization.
- **Asset Pipeline**: Importing glTF (glb) / Collada and resource sharing via `ModelAsset`.
- **Animation Control**: State transition management using a 4-layer structure: `clip` $\rightarrow$ `pattern` $\rightarrow$ `action` $\rightarrow$ `state`.
- **User Interface**: Integration of Canvas HUD, DOM overlays, and diagnostic panels.
- **Interaction**: Touch input, virtual buttons, and object picking via Raycasting.
- **Spatial Management**: Logical grid representation via TileMap and character movement control.
- **Post-processing**: Implementation of render passes such as Bloom and Depth of Field (DOF).
- **Audio**: Sound implementation using Web Audio API with bus design and synthesized audio.

## Repository Structure

```text
webg/
  book/         Technical documentation
  samples/      Feature-specific sample applications
  unittest/     Unit tests for functional verification
  webg/         Core library implementation
```

## Setup and Execution Environment

### 1. File Placement
`webg` is intended to be used by placing the repository directly in your project rather than installing it as a package. Please maintain the root directory of the repository to ensure that relative paths for module imports remain intact.

```bash
git clone https://github.com/jun-mizutani/webg.git
cd webg
```

### 2. Running a Local Server
To support ES Modules `import`, asset loading via `fetch()`, and WebGPU initialization (`navigator.gpu`), **you must access the application via a local server.** (Directly opening files via the `file://` protocol will result in resource loading failures due to the Same-Origin Policy (SOP)).

**Example startup commands:**
```bash
# Using Python 3
python3 -m http.server 8000

# Using Node.js (npx)
npx http-server . -p 8000
```

After starting the server, access the following URL in your browser:
`http://localhost:8000/samples/index.html`

### 3. Recommended Verification Sequence
After setup, we recommend verifying the environment in the following order. This makes it easier to isolate whether a problem is caused by the server configuration, WebGPU browser support, or asset paths.

1. `samples/index.html` : Verify that the server is running and files are being served.
2. `samples/low_level` : Verify WebGPU rendering with a minimal configuration.
3. `samples/high_level` : Verify the standard application structure via `WebgApp`.
4. `samples/scene` : Verify external asset loading and scene configuration.
5. Proceed to detailed samples based on your specific objectives.

## Recommended Reference Order

The following route is recommended for understanding the design philosophy of `webg`.

1. **Foundations**: Ch 2 (Environment) $\rightarrow$ Ch 3 (Math) $\rightarrow$ Ch 4 (Min Render) $\rightarrow$ Ch 5 (`WebgApp`)
2. **Feature Implementation**: 
   - Camera $\rightarrow$ Ch 6 / Shaders $\rightarrow$ Ch 7–9 / Models $\rightarrow$ Ch 10
   - Scene Configuration $\rightarrow$ Ch 11 / Animation $\rightarrow$ Ch 12–13
   - UI, Input, and Sound $\rightarrow$ Ch 14–18
3. **Internal Structure**: 
   - TileMap $\rightarrow$ Ch 22 onwards / Low-level API and Skinning Principles $\rightarrow$ Ch 25–28

## Development with AI Assistance

Due to its consistent terminology and clear separation of layers, `webg` is highly suitable for implementation assistance using LLMs (Large Language Models). 

**Note on Language:** While the documentation and internal code comments are predominantly written in Japanese, the source code itself is written in English. Since modern LLMs are proficient in both languages, non-Japanese speakers can seamlessly use AI to bridge the language gap and obtain accurate technical guidance by providing the relevant chapters from `book/` or implementation examples from `samples/` as context.

## License
MIT License

## Author
Author: Jun Mizutani
Website: https://www.mztn.org/
