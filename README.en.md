# webg

[English](README.en.md) | [Japanese](README.ja.md)

`webg` is a library for building 3D applications with WebGPU from JavaScript.  
Without relying on external libraries, it is designed as a unified system that covers **rendering, scenes, models, animation, UI, input, diagnostics, TileMap, and post-processing**.

This repository includes not only the library itself, but also a **collection of samples**, **unit tests**, and a detailed **book manuscript**.  
It is intended not just as a tool for using an API, but as a resource for **learning by following the structure of the implementation**.

## Features

- **No external library dependencies**
  - Rendering, scenes, assets, animation, UI, input, and TileMap are all handled entirely within `webg`
- **Both high-level and low-level APIs**
  - You can quickly launch an application with `WebgApp`
  - Or directly work with `Screen`, `Shape`, `Shader`, `Matrix`, and more
- **Easy to move back and forth between samples and implementation**
  - `samples/` is not just a demo collection, but also learning material
  - `unittest/` can be used for focused verification and debugging
- **Book included**
  - A detailed manuscript is bundled in `webg/book/`
  - It explains everything step by step, from the first rendering to models, scenes, animation, TileMap, and low-level APIs

## What You Can Build

With `webg`, you can build 3D applications such as:

- 3D rendering in the browser using WebGPU
- Camera control (orbit / follow / first-person)
- Loading glTF (glb) / Collada
- Skinning animation
- HUD, messages, panels, dialogue overlays
- Keyboard input, touch input, virtual buttons
- Sound effects and BGM playback
- Post-processing such as bloom and DOF
- Board-style representation and character animation with TileMap
- Development support including diagnostic information and debug displays

## Repository Structure

```text
webg/
  book/         Book manuscript
  samples/      Sample applications
  unittest/     Functional test applications
  webg/         Core library
````

### Main Directories

* `webg/`

  * The core library
  * Contains implementations such as `Screen`, `Shape`, `WebgApp`, `ModelAsset`, and `SceneLoader`

* `samples/`

  * A collection of samples that serve both as feature verification and learning material
  * Each sample has a `main.js` and a `*.txt`, where the `*.txt` explains the overview

* `unittest/`

  * A set of smaller applications for isolating and verifying behavior in finer units

* `book/`

  * A detailed manuscript explaining `webg`
  * Covers the initial rendering, application structure, models, scenes, animation, UI, TileMap, and low-level APIs

## Getting Started

### 1. Place the repository

`webg` is not primarily intended to be used as an npm package.
The basic workflow is to clone and place the repository as-is.

```bash
git clone https://github.com/jun-mizutani/webg.git
cd webg
```

### 2. Start a local server

For samples and unit tests, opening them through a local server is recommended instead of using `file://`.

```bash
python3 -m http.server 8000
```

Then open the following in your browser:

```text
http://127.0.0.1:8000/samples/index.html
```

or

```text
http://localhost:8000/samples/index.html
```

## Recommended First Samples

As an entry point, the following samples are especially easy to start with:

* `samples/low_level`

  * A sample for understanding the basic structure of minimal rendering

* `samples/high_level`

  * A minimal example of a standard application structure using `WebgApp`

* `samples/scene`

  * An introduction to scene initialization using Scene JSON

* `samples/gltf_loader`

  * For checking glTF / GLB loading

* `samples/animation_state`

  * An example of condition-based evaluation with `AnimationState`

* `samples/janken`

  * An example of input-driven control with `AnimationState`

* `samples/tile_sim`

  * A practical example combining TileMap and glb actors

---

## Recommended First Chapters

This repository includes a book manuscript under `book/`.
For a good starting path, the following order is recommended:

1. **Chapter 2** Installation and Execution Environment
2. **Chapter 3** Fundamentals of 3D Graphics
3. **Chapter 4** Minimal Rendering with WebGPU and webg
4. **Chapter 5** Application Structure with WebgApp

After that, it is easier to continue depending on your goals:

* Camera control → Chapter 6
* Shaders and materials → Chapters 7 to 9
* Model loading → Chapter 10
* Scene JSON → Chapter 11
* Animation → Chapters 12 to 13
* UI → Chapter 14 onward
* TileMap → Chapter 22 onward
* Low-level APIs → Chapter 25 onward

## Minimal Code Example

A minimal high-level setup using `WebgApp` looks like this:

```js
import WebgApp from "./webg/WebgApp.js";
import Shape from "./webg/Shape.js";
import Primitive from "./webg/Primitive.js";

const app = new WebgApp({
  document,
  messageFontTexture: "./webg/font512.png",
  camera: {
    target: [0, 0, 0],
    distance: 8,
    yaw: 0,
    pitch: 0
  }
});

await app.init();

const shape = new Shape(app.getGL());
shape.applyPrimitiveAsset(Primitive.cube(2.0, shape.getPrimitiveOptions()));
shape.endShape();
shape.setMaterial("smooth-shader", {
  has_bone: 0,
  use_texture: 0,
  color: [0.22, 0.64, 0.96, 1.0]
});

const box = app.space.addNode(null, "box");
box.addShape(shape);

app.start({
  onUpdate() {
    box.rotateY(0.8);
    box.rotateX(0.4);
  }
});
```

---

## The Design Philosophy of `webg`

In `webg`, concepts that may appear similar but have different roles are treated separately.

* `ModelAsset`

  * A shared representation for one model

* Scene JSON / `SceneAsset`

  * The initial state of an entire scene

* `build()`

  * Converts resources into a runtime form, including shared resources

* `instantiate()`

  * Generates a new scene instance from the runtime form

* `clip -> pattern -> action -> state`

  * A way of understanding animation by dividing it into layers

In this way, `webg` is not just a library where “things work somehow”; it emphasizes **making the structure easy to follow**.

Rather than being an **alternative to a large external engine**, `webg` is better understood as **a library for people who want to build WebGPU-based 3D applications while tracing and understanding the structure themselves**.

## Working Together with AI

`webg` does not depend heavily on external libraries, and it keeps its samples, unit tests, book manuscript, and core implementation in the same repository.
Because of this, it works especially well with generative AI assistance.

When using AI together with `webg`, the following order is a practical way to proceed:

1. First check the chapter closest to your goal
2. Look at the corresponding `samples/`
3. If needed, verify details locally with `unittest/`
4. Finally, go down into the core implementation in `webg/`

## License

```text
MIT License
```

## Author

```text
Author: Jun Mizutani
Website: https://www.mztn.org/
```

## Notes

This book and `webg` are not merely a collection of APIs or samples.
They are designed with an emphasis on **being able to follow each layer that makes up a 3D application, and to inspect the internals whenever necessary**.

You do not need to understand everything from the beginning.
A recommended approach is to first run the smallest sample, and then return to the relevant chapter of the book and the corresponding sample as needed.
