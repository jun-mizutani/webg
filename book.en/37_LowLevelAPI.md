# Foundations of the Low-Level APIs

This chapter draws without `WebgApp` by combining `Screen`, `Shader`, `CoordinateSystem`, `Node`, `Matrix`, and `Quat` directly. Inspecting initialization, coordinate transforms, scene traversal, shader values, and presentation separately helps explain what `WebgApp` automates. You will learn to choose the low-level APIs needed for a custom rendering pipeline or tool.

## How to read this chapter

### Prerequisites

This chapter is easier to follow if you know coordinate transforms from Chapter 3 and the minimal render from Chapter 4.

### What to read first

Start with the relationships among `Screen`, `Shader`, `CoordinateSystem`, and `Node`, and the low-level rendering flow.

### What to read when you need it

Refer to `Matrix`, `Quat`, bindings, shared depth, and decisions about using the low-level application programming interfaces (APIs) when needed.

### What you will learn

You can combine the low-level classes used inside `WebgApp` into an application from initialization through rendering.

## Understand the Role of Low-Level APIs

`WebgApp` groups operations shared by 3D applications. Internally, `Screen`, `Shader`, `CoordinateSystem`, `Node`, `Matrix`, and `Quat` divide these responsibilities. This chapter organizes each role so you can select low-level APIs when building custom rendering or diagnosing a display issue.

> **Place in the book:** This chapter organizes concepts from Chapters 3–6 by the methods in the Core implementation. Chapters 4–5 are enough to make a minimal application. Use this chapter to trace responsibilities for custom shaders, scene graphs, and matrix processing.

The webg low-level APIs form an intermediate layer expressed in units suited to 3D applications, rather than exposing raw WebGPU directly. Their responsibilities fall into three groups: GPU entry points, scene transforms and placement, and mathematical foundations.

| Layer | Main classes | Information |
|---|---|---|
| GPU entry point | `Screen`, `Shader` | Render target and pipeline |
| Scene transform and placement | `CoordinateSystem`, `Node` | Parent/child relations and orientation |
| Mathematical foundation | `Matrix`, `Quat` | Coordinate transforms and rotation |

This table groups the low-level APIs into rendering, placement, and mathematics.

## GPU Entry Points: `Screen` and `Shader`

Use `Screen` and `Shader` to separate render-target setup from the definition of how to render. Separating Canvas and depth-texture management from material logic makes it possible to add different shaders to the same display and diagnose target issues separately from pipeline issues.

### `Screen`

`Screen` bridges an HTML Canvas and WebGPU. Internally it obtains an adapter and device from `navigator.gpu`, configures the Canvas `webgpu` context, and manages depth textures. It is the outermost GPU entry point that manages both the render window and its WebGPU context.

Its main responsibilities are finding the Canvas, acquiring the WebGPU device, configuring the context, rebuilding depth textures on resize, and providing `clear()` and `present()` interfaces. `Screen` holds no shader or geometry data; it specializes in where drawing occurs, while `Shader` controls how the content is rendered.

```js
import Screen from "./webg/Screen.js";

// Screen initializes the Canvas and WebGPU
const screen = new Screen(document);

// Wait until the device and context are ready
await screen.ready;

// Choose a background color
screen.setClearColor([0.1, 0.15, 0.1, 1.0]);

// Obtain the GPU wrapper from Screen
const gpu = screen.getGPU();
console.log(gpu.device, gpu.context);
```

The important step is waiting for `await screen.ready` before using the WebGPU device or context. Low-level code often encounters errors by creating shaders or buffers before device initialization completes. Treat `Screen` as an asynchronously initialized class.

`resize()` updates the Canvas dimensions and rebuilds its depth texture. After changing screen size, update the projection matrix as part of the same flow:

```js
screen.resize(
  Math.max(1, Math.floor(window.innerWidth)),
  Math.max(1, Math.floor(window.innerHeight))
);
```

### `Shader`

WebGPU rendering uses a render pipeline, shader modules, uniform buffers, and bind groups. `Shader` groups these behind a class. `Screen` creates the display window; `Shader` defines the rendering method.

Applications normally use a derived class such as `SmoothShader` instead of instantiating the `Shader` base class directly. Helper implementations such as `book/examples/Phong.js` can help with study or comparison, while `SmoothShader` is the current standard Core entry point. `Shader` creates uniform buffers, builds shader modules from WebGPU Shading Language (WGSL), constructs bind-group layouts, manages texture and sampler bindings, and sets the pipeline on a pass encoder.

`Shader` acts as a bridge that converts CPU-side drawing parameters, such as matrices and light values, into formats the GPU can interpret. Here is a minimal example using the derived `SmoothShader`:

```js
import Screen from "./webg/Screen.js";
import SmoothShader from "./webg/SmoothShader.js";
import Matrix from "./webg/Matrix.js";

const screen = new Screen(document);
await screen.ready;

// SmoothShader is derived from Shader
const shader = new SmoothShader(screen.getGPU());
await shader.init();

// Pass the projection matrix to the shader
const projection = new Matrix();
projection.makeProjectionMatrix(
  0.1,
  1000.0,
  screen.getRecommendedFov(55.0),
  screen.getAspect()
);
shader.setProjectionMatrix(projection);

// Pass a light position to the shader as well
shader.setLightPosition([120.0, 180.0, 140.0, 1.0]);
```

The CPU calculates the projection matrix and light position as a `Matrix` or array; `Shader` transfers them to the GPU. `Shader` applies calculated results to rendering settings rather than performing the mathematical calculations itself.

## Scene Transforms and Placement: `CoordinateSystem` and `Node`

Use `CoordinateSystem` and `Node` to separate a parent/child transform from an element that draws Shapes. The same hierarchy calculations work for invisible reference points and camera rigs, so scene placement is not limited to drawable objects.

### `CoordinateSystem`

`CoordinateSystem` is the foundation for transforms in the scene graph. It stores position, rotation, scale, and parent/child relationships, and rebuilds local and world matrices as needed. It does not draw. It provides a base for defining a pose in space.

It stores position, manages rotation with a quaternion, sets uniform scale, builds parent/child relationships, and calculates local/world matrices. It has no shader, Shape, or GPU data; it manages where an element is placed, how it is oriented, and which parent owns it.

```js
import CoordinateSystem from "./webg/CoordinateSystem.js";

const cs = new CoordinateSystem(null, "marker");

// Set position
cs.setPosition(2.0, 1.0, 0.0);

// Set rotation in yaw (Y), pitch (X), roll (Z) order
cs.setAttitude(45.0, 15.0, 0.0);

// Set uniform scale
cs.setScale(1.5);

// Update the matrix
cs.setWorldMatrix();

console.log(cs.getWorldPosition());
console.log(cs.getWorldAttitude());
```

The shared rotation order in webg is yaw (Y) → pitch (X) → roll (Z). The same convention is used by `Matrix` and `Quat` operations later in this chapter.

### `Node`

`Node` extends `CoordinateSystem` with Shape ownership and drawing. It is the concrete object placed in the scene: `CoordinateSystem` provides its transform, while `Node` also carries what to draw.

At low level, create a `Node` through `Space.addNode()` and attach a `Shape`. A camera is usually also placed as a `Node`. Thus `Node` is a general-purpose scene element for visible objects, camera rigs, pivots, offset parents, and other elements.

`Node` holds Shapes, uses the transform API from `CoordinateSystem`, builds parent/child hierarchies, and recursively draws itself and descendants.

```js
import Space from "./webg/Space.js";

const space = new Space();

// A viewpoint is also a Node
const eye = space.addNode(null, "eye");
eye.setPosition(0.0, 0.0, 10.0);
space.setEye(eye);

// A Node for the drawable object
const box = space.addNode(null, "box");
box.setPosition(0.0, 0.0, 0.0);
box.setAttitude(0.0, 20.0, 0.0);
box.addShape(shape);
```

`Shape` is a component containing geometry and material; `Node` places it in the scene and gives it position and parent/child relationships. A Shape gets a position in space when attached to a Node.

#### Default Viewpoint and `Space.draw()`

`Space.setEye(eye)` sets the default viewpoint used by `Space.draw()` with no arguments. This call order remains available in the current API for compatibility with low-level applications that do not use `WebgApp`.

```js
space.setEye(eye);

const drawFrame = () => {
  screen.clear();
  space.draw();
  screen.present();
  requestAnimationFrame(drawFrame);
};
drawFrame();
```

An explicit `space.draw(eye)` argument takes precedence over the default viewpoint from `setEye()`. The same precedence applies when passing a complete camera frame or a registered `renderFrameToken`. If `setEye()` has not been called and `draw()` receives no argument, the API raises an error because it cannot determine a viewpoint.

After `space.setEye(eye)`, both `space.draw()` and `space.draw(eye)` build the same camera-relative model-view transform from the viewpoint at draw time. Either form works for ordinary low-level single-pass rendering. For manual connections that share depth with later processing, use the `renderFrameToken` described in Chapters 23–25. To integrate from G-buffer through final display, use the same `cameraFrame` described in Chapters 31–33.

## Mathematical Foundations: `Matrix` and `Quat`

`Matrix` and `Quat` provide shared mathematical conventions for position, orientation, and projection. A common representation avoids rotation-order and array-format mismatches among Nodes, cameras, animation, and shaders. Use matrices for combining transforms and quaternions for robust orientation storage.

### `Matrix`

3D graphics use matrices for rotation, translation, projection, and view transforms. webg's `Matrix` is a column-major 4×4 matrix. `CoordinateSystem`, `Node`, `Shader`, and `Space` all use it internally, making it the common destination for transforms.

`Matrix` stores a 4×4 matrix, creates rotation from Euler angles or quaternions, applies translation, creates projection and view matrices, and applies transforms to vectors. The same class can represent a camera projection or an object transform; the receiving API, such as `Shader` or `Space`, determines its meaning.

```js
import Matrix from "./webg/Matrix.js";

const m = new Matrix();

// Create rotation from yaw, pitch, roll
m.setByEuler(30.0, 10.0, 0.0);

// Set translation in the final column
m.position([2.0, 1.0, 0.0]);

// Transform the point [0, 0, 1]
const moved = m.mulVector([0.0, 0.0, 1.0]);
console.log(moved);
```

Create a projection matrix like this:

```js
const projection = new Matrix();
projection.makeProjectionMatrix(
  0.1,
  1000.0,
  screen.getRecommendedFov(55.0),
  screen.getAspect()
);
```

Matrix construction is shared; passing the result to a `Shader`, `Space`, or other API determines whether it is interpreted as projection or model transform.

### `Quat`

`Quat` is a quaternion representation of rotation. webg stores values in `[w, x, y, z]` order. `CoordinateSystem` stores orientation internally as a quaternion and converts it to `Matrix` for rendering. Quaternions are useful for orientation storage and animation interpolation.

`Quat` creates axis rotations, converts from Euler angles, multiplies quaternions, performs spherical linear interpolation (`slerp`), and converts to/from matrices. It stores orientation; rendering applies it after conversion to a matrix.

```js
import Quat from "./webg/Quat.js";
import Matrix from "./webg/Matrix.js";

const q = new Quat();

// Create a quaternion from yaw (Y), pitch (X), roll (Z)
q.eulerToQuat(45.0, 10.0, 0.0);

// Convert it to a matrix
const m = new Matrix();
m.setByQuat(q);

console.log(q.q);            // [w, x, y, z]
console.log(m.mat.slice(0)); // 4×4 matrix
```

Creating a quaternion alone does not apply it to rendering; convert it to a matrix. This is important when implementing animation and orientation interpolation.

## A Minimal Example Connecting the Pieces

This example brings together `Screen`, `Shader`, `Shape`, `CoordinateSystem`, `Node`, `Matrix`, and `Quat`:

```js
import Screen from "./webg/Screen.js";
import Space from "./webg/Space.js";
import Shape from "./webg/Shape.js";
import Primitive from "./webg/Primitive.js";
import Matrix from "./webg/Matrix.js";
import Quat from "./webg/Quat.js";
import CoordinateSystem from "./webg/CoordinateSystem.js";
import SmoothShader from "./webg/SmoothShader.js";

const screen = new Screen(document);
await screen.ready;
screen.setClearColor([0.1, 0.15, 0.1, 1.0]);

// Shader groups the WebGPU pipeline and uniforms
const shader = new SmoothShader(screen.getGPU());
await shader.init();

// Build the projection with Matrix
const projection = new Matrix();
const updateProjection = () => {
  screen.resize(
    Math.max(1, Math.floor(window.innerWidth)),
    Math.max(1, Math.floor(window.innerHeight))
  );
  projection.makeProjectionMatrix(
    0.1,
    1000.0,
    screen.getRecommendedFov(55.0),
    screen.getAspect()
  );
  shader.setProjectionMatrix(projection);
};
updateProjection();

// Manage the full scene
const space = new Space();

// Place the viewpoint Node
const eye = space.addNode(null, "eye");
eye.setPosition(0.0, 0.0, 12.0);
space.setEye(eye);

// Use CoordinateSystem to define a pose
const pose = new CoordinateSystem(null, "cubePose");
pose.setPosition(0.0, 0.0, 0.0);
pose.setAttitude(20.0, 10.0, 0.0);

// Create a quaternion directly to inspect its rotation
const spin = new Quat();
spin.setRotateY(1.0);

// Shape holds geometry and material
const shape = new Shape(screen.getGPU());
shape.setShader(shader);
shape.applyPrimitiveAsset(Primitive.cube(3.0, shape.getPrimitiveOptions()));
shape.endShape();
shape.setMaterial("smooth-shader", {
  has_bone: 0,
  use_texture: 0,
  color: [1.0, 0.5, 0.3, 1.0]
});

// Node places the Shape in the scene
const cube = space.addNode(null, "cube");
cube.setPosition(...pose.getPosition());
cube.setAttitude(...pose.getLocalAttitude());
cube.addShape(shape);

// Keep the previous draw time and advance rotation by elapsed time
let previousTimeMs = null;

// Rotate the Node in elapsed seconds, draw, and schedule the next frame
const loop = (timeMs = performance.now()) => {
  const deltaSec = previousTimeMs === null ? 0 : (timeMs - previousTimeMs) / 1000;
  previousTimeMs = timeMs;
  cube.rotateY(0.8 * deltaSec);
  cube.rotateX(0.3 * deltaSec);

  screen.clear();
  space.draw(eye);
  screen.present();
  requestAnimationFrame(loop);
};
loop();
```

Build from the GPU entry point toward scene objects. `Screen` prepares the WebGPU context and `Shader` defines how to draw. `Matrix` provides projection and `Quat` provides rotation. `CoordinateSystem` calculates pose and position; `Shape` stores vertices and material; finally, `Node` places the Shape in the transform hierarchy.

## When to Use the Low-Level APIs

Low-level APIs are useful when you want to understand the rendering foundation, prepare a custom render pass or shader, or inspect the automation performed inside `WebgApp`. They are valuable for understanding which layer handles each operation, rather than as a requirement to write everything by hand.

For a quick sample application or integrated features such as HUD, user input, diagnostics, and camera rigs, use `WebgApp`. Low-level APIs are a foundation for learning and extension. For regular application work, use `WebgApp` automation and descend to low-level control only where needed.

## Key Details to Keep in Mind

1. Wait for asynchronous initialization with `await screen.ready` and `await shader.init()`.
2. Finalize the Shape with `shape.endShape()`.
3. Place a Shape in the scene by attaching it to a `Node`.
4. Call `Space.draw(eye)` to render the scene.
5. `Matrix` is column-major.
6. `Quat` stores components in `[w, x, y, z]` order.
7. Rotation order is yaw (Y) → pitch (X) → roll (Z).

Keeping these conventions in view makes implementation easier to reason about. With the structure of `Screen`, `Shader`, `CoordinateSystem`, `Node`, `Matrix`, and `Quat` in place, continue to Chapter 38 for `Shape` geometry and material details. Use this chapter as a map of low-level API connections.

## Summary

Low-level APIs expose building blocks for rendering targets, render methods, coordinate transforms, and scene placement. `Screen` and `Shader` handle the GPU side; `CoordinateSystem` and `Node` handle placement; `Matrix` and `Quat` supply shared mathematical conventions.

Use `WebgApp` for ordinary applications. Continue to low-level APIs when custom pipelines or internal diagnostics require them. Their value is understanding which layer manages each operation and resource, then taking responsibility for only the parts the application needs to customize.
