# Application Structure with WebgApp

This chapter uses `WebgApp` to bring initialization, input, scene updates, camera setup, 3D rendering, HUD display, and shutdown into one frame lifecycle.
Most applications can use the standard processing order. Change callbacks and automatic processing settings only when custom rendering or compute processing is needed.
By the end, you should be able to decide where each application-specific operation belongs.

## How to read this chapter

### Prerequisites

The chapter is easier to follow if you know the minimal rendering setup from Chapter 04 and JavaScript classes, functions, and event handling.

### What to read first

Read about creating `WebgApp`, `init`, `start`, `onUpdate`, the frame context `ctx`, and standard rendering, in that order.

### What to read when you need it

When adding input, cameras, HUDs (heads-up displays), physics, or post-processing, refer to the relevant chapters in Parts II and IV.

### What you will learn

You will be able to build the basic `WebgApp` structure that combines initialization, updates, input, rendering, and on-screen information.

## WebgApp brings together common application processing

`WebgApp` combines WebGPU initialization, scenes, cameras, input, updates, rendering, and HUD display into one application.
Configure the elements needed at startup, then update changing state in `onUpdate` on each frame to build a standard 3D application.

This chapter starts with a minimal setup and explains initialization, the lifecycle, frame context, input, cameras, lights, and HUDs in sequence.
When using the standard features, `WebgApp` manages the internal draw order and camera state as a single frame process.

> **How to read this chapter:** Start with “A minimal WebgApp application” and “Basic lifecycle” to get a standard application running. Refer to the frame context, physics timing, and detailed draw order when you need input, physics, or a custom render pass.

## What does WebgApp simplify?

Chapter 04 displayed a cube with `WebgApp` and introduced a low-level alternative. In that alternative, you prepare `Screen`, `SmoothShader`, `Space`, `Shape`, and `eye`, then render by calling `clear -> draw -> present`.

This sequence is important for understanding the foundation of `webg`.
In a real application, however, the screen, standard shader, scene, camera, input, HUD, diagnostics, resize handling, and frame loop also need to be assembled.

`WebgApp` is a high-level entry point that brings this common setup together.
It lets developers focus on what to place in the scene and how it should move each frame.
`WebgApp` is a convenient API (application programming interface) that combines initialization, input, camera, updates, rendering, and on-screen information in one processing flow.
Its main role is to provide the application foundation.
Build help, error displays, tutorials, game rules, and menu structures with `OverlayPanel` and application-side controllers or supporting features.

## The high-level SceneApp in webg 3.0

webg 3.0 also provides `WebgSceneApp`, built on `WebgApp`. It combines SceneYAML or equivalent JSON validation, a PBR renderer, compute-shader physics, Node synchronization, and scene reset in one entry point. Chapter 09, “Scene Structure and SceneYAML,” explains how to define these applications.

`WebgApp` is a foundation for assembling Shapes, Nodes, and frame processing yourself. `WebgSceneApp` is an entry point for defining PBR and physics around application data. Choose the layer that suits the task to work with low-level control and high-level scene authoring in the same webg project.

## A minimal WebgApp application

A minimal application using `WebgApp` has four steps:

1. Pass settings to `new WebgApp(...)`.
2. Call `await app.init()` to prepare the GPU (graphics processing unit), scene, camera, input, and HUD.
3. Place objects in `app.space`.
4. Start the frame loop with `app.start({ onUpdate })`.

```js
import WebgApp from "../../webg/WebgApp.js";
import Shape from "../../webg/Shape.js";
import Primitive from "../../webg/Primitive.js";

const app = new WebgApp({
  document,
  messageFontTexture: "../../webg/font512.png",
  clearColor: [0.1, 0.15, 0.1, 1.0],
  camera: {
    target: [0.0, 0.0, 0.0],
    distance: 8.0,
    yaw: 24.0,
    pitch: -12.0
  }
});

await app.init();

const shape = new Shape(app.getGPU());
shape.applyPrimitiveAsset(Primitive.cube(2.0, shape.getPrimitiveOptions()));
shape.endShape();
shape.setMaterial("smooth-shader", {
  has_bone: 0,
  use_texture: 0,
  color: [1.0, 0.5, 0.3, 1.0]
});

const box = app.space.addNode(null, "box");
box.addShape(shape);

app.start({
  onUpdate({ deltaSec }) {
    box.rotateY(0.8 * deltaSec);
    box.rotateX(0.3 * deltaSec);
  }
});
```

The application code directly creates the cube, places it in the scene, and rotates it each frame.
`WebgApp` handles the `Screen`, standard shader, `Space`, camera, input management, HUD, diagnostics, and scheduling `requestAnimationFrame`.

## Basic lifecycle

Remember the following order when using `WebgApp`:

```js
const app = new WebgApp(options);
await app.init();

// app.getGPU(), app.space, app.eye, app.input, and app.message are available
// Create Shapes and Nodes and assemble the scene

app.start({
  onUpdate(ctx) {
    // Update once per frame
  }
});
```

### The constructor stores settings

`new WebgApp(options)` prepares settings and internal state. The GPU device, `Screen`, `Space`, standard shader, and `eye` become available after `app.init()` completes.
The constructor prepares the settings and internal state used by the later `init()` call.

Common options include:

* **`document`**: the document used for DOM operations (the DOM represents HTML elements as a document structure)
* **`messageFontTexture`**: the font texture for HUD text
* **`clearColor`**: background color
* **`camera`**: initial state of the standard camera
* **`viewAngle`**: field of view for the projection matrix
* **`light`**: standard light settings
* **`fog`**: standard fog settings
* **`attachInputOnInit`**: whether `init()` connects input
* **`autoDrawScene`**: whether `space.draw(cameraFrame)` runs automatically with the `cameraFrame` finalized for that frame
* **`autoDrawBones`**: whether skeleton bones are drawn automatically
* **`layoutMode`**: `"viewport"` or `"embedded"`
* **`renderMode`**: `"ondemand"` or `"continuous"`
* **`uiTheme`**: theme for DebugDock or OverlayPanel

### The application foundation is ready after init

`await app.init()` is a major transition in the `WebgApp` lifecycle.
It waits for `Screen` setup and creates the shader, `Space`, standard camera rig, input, HUD, diagnostics, and other shared features.

Commonly used properties and methods after `init()` include:

| Property / method | Purpose |
| :--- | :--- |
| `app.getGPU()` | GPU context for creating `Shape` objects and low-level resources |
| `app.space` | Scene that contains Nodes, Shapes, and models |
| `app.eye` | Current view node |
| `app.input` | Input state |
| `app.message` | HUD and message display |
| `app.shader` | Standard shader |
| `app.screen` | `Screen` used as the render target |

Use `app.getGPU()`, `app.space`, `app.eye`, and other initialized objects after `await app.init()`. They are created during initialization.

## app.start and onUpdate

`app.start()` starts the `WebgApp` frame loop.
It receives timestamps from `requestAnimationFrame`, calculates elapsed time since the previous frame, and then runs updates, rendering, HUD drawing, and presentation in order.

`onUpdate` is where you advance the scene state by one frame before drawing.
Write code that produces the state for the next frame, rather than code that draws directly to the screen.

```js
app.start({
  onUpdate(ctx) {
    box.rotateY(0.8 * ctx.deltaSec);
  }
});
```

Typical operations in `onUpdate` include:

* Moving a player based on input
* Updating Node positions and rotations
* Advancing timers and cooldowns
* Selecting processing based on the application phase
* Updating values and state displayed in the HUD

Other processing is easier to organize in its corresponding callback:

* **Initialization, Shape creation, and model loading:** after `await app.init()` and before `app.start()`
* **Per-frame state updates:** in `onUpdate`
* **Special drawing before the 3D scene:** in `onBeforeDraw`
* **Post-processing after 3D scene drawing:** in `onAfterDraw3d`
* **Additional display after the HUD:** in `onAfterHud`

Returning `true` from `onUpdate()` stops the frame loop.

```js
app.start({
  onUpdate() {
    if (gameOver) {
      return true;
    }
    return false;
  }
});
```

## Frame context ctx

The `ctx` passed to `onUpdate(ctx)` is a frame context that groups useful information for the current frame.
`WebgApp` creates it every frame and passes it to `onUpdate`, `onBeforeDraw`, `onAfterDraw3d`, and `onAfterHud`.

| Property | Meaning and use |
| :--- | :--- |
| `app` | The current `WebgApp`; use for HUD, phase, screenshots, and more |
| `scenePhase` | Broad application phase such as `"title"`, `"gameplay"`, or `"result"` |
| `timeMs` | Timestamp from `requestAnimationFrame`, in milliseconds |
| `timeSec` | `timeMs` in seconds; useful for periodic effects |
| `deltaSec` | Seconds since the previous frame; use for movement, rotation, and timers |
| `screen` | Render-target `Screen` |
| `shader` | Standard shader |
| `space` | `Space` managing Nodes and Shapes in the scene |
| `eye` | Current camera view |
| `cameraRig` | Camera foundation |
| `cameraRod` | Arm that represents the camera distance |
| `cameraTarget` | Copy of the current camera target array |
| `cameraFollow` | Camera follow state |
| `input` | Keyboard, pointer, and action input state |
| `projection` | Current projection matrix |

To start, it is usually enough to focus on `deltaSec`, `timeSec`, `input`, `space`, and `app`.

```js
app.start({
  onUpdate(ctx) {
    if (ctx.input.has("arrowright")) {
      player.move(3.0 * ctx.deltaSec, 0.0, 0.0);
    }

    box.rotateY(1.2 * ctx.deltaSec);

    ctx.app.message.setLines("status", [
      `phase: ${ctx.scenePhase}`,
      `time: ${ctx.timeSec.toFixed(1)}`
    ]);
  }
});
```

### The onUpdate({ deltaSec }) form

Samples often use this form as well:

```js
app.start({
  onUpdate({ deltaSec }) {
    box.rotateY(0.8 * deltaSec);
  }
});
```

This is JavaScript destructuring, not syntax specific to `webg`. It means the same thing as:

```js
app.start({
  onUpdate(ctx) {
    const deltaSec = ctx.deltaSec;
    box.rotateY(0.8 * deltaSec);
  }
});
```

You can extract several values at once:

```js
app.start({
  onUpdate({ deltaSec, timeSec, input, app }) {
    if (input.has("space")) {
      app.setScenePhase("jump");
    }

    box.setPosition(0.0, Math.sin(timeSec * 2.0) * 0.5, 0.0);
    box.rotateY(1.0 * deltaSec);
  }
});
```

Use `onUpdate(ctx)` when you refer to the full context several times. When you need only a few values, `onUpdate({ deltaSec, input })` can be clearer.

### Why use deltaSec

`deltaSec` is the number of seconds that elapsed between the previous frame and the current one.

Rotating by a fixed amount each frame makes the speed depend on the frame rate.

```js
// Rotate by 0.02 each frame.
// The rotation per second differs at 30 fps and 144 fps.
box.rotateY(0.02);
```

Multiplying by `deltaSec` specifies how far to advance per second.

```js
// Rotate by 1.2 per second.
box.rotateY(1.2 * deltaSec);
```

Use the same approach for movement and timers:

```js
app.start({
  onUpdate({ deltaSec, input }) {
    if (input.has("arrowright")) {
      player.move(3.0 * deltaSec, 0.0, 0.0);
    }

    cooldown -= deltaSec;
  }
});
```

`timeSec` is the `requestAnimationFrame` timestamp converted to seconds. It is useful for periodic effects, but its clock does not start when `app.start()` is called.

```js
app.start({
  onUpdate({ timeSec }) {
    box.setPosition(0.0, Math.sin(timeSec * 2.0) * 0.5, 0.0);
  }
});
```

Use `deltaSec` to advance state by the duration of the current frame and `timeSec` as a timestamp for periodic calculations. For a timer that starts with your game or scene, accumulate `deltaSec` in your own elapsed-time variable.

### Time passed to the physics engine

`PhysicsSpace.step(deltaMs)` takes elapsed time in milliseconds. When starting a SceneYAML application with `WebgSceneApp`, its internal update processing passes elapsed time to physics.
By contrast, `ctx.deltaSec` in `WebgApp` is measured in seconds.

To advance physics from `onUpdate`, multiply `deltaSec` by 1000.

```js
import PhysicsSpace from "../../webg/PhysicsSpace.js";

const physics = new PhysicsSpace({
  fixedTimeStepMs: 1000.0 / 60.0,
  maxSubSteps: 5
});

app.start({
  onUpdate({ deltaSec }) {
    const deltaMs = deltaSec * 1000.0;
    physics.step(deltaMs);
  }
});
```

`PhysicsSpace.step(deltaMs)` accumulates the variable `deltaMs` internally and calls `stepFixed(dtSec)` as many times as needed at intervals of `fixedTimeStepMs`.
The `onUpdate` callback passes the elapsed milliseconds; the physics space distributes them into fixed steps for stable simulation.

The return value of `step()` is the number of fixed steps that actually ran.
`maxSubSteps` limits the number of steps advanced at once, for example when resuming after a long pause.

```js
app.start({
  onUpdate({ deltaSec }) {
    const deltaMs = Math.min(deltaSec * 1000.0, 80.0);
    const stepCount = physics.step(deltaMs);

    app.message.setLine("physics", `physics steps: ${stepCount}`);
  }
});
```

Keep the units straight: regular movement and rotation use `deltaSec`; `PhysicsSpace.step()` uses `deltaMs`; and the internal `stepFixed(dtSec)` uses seconds. Chapters 27–28 cover physics in detail.

## Handle input

`WebgApp` holds an `InputController` internally.
If `attachInputOnInit` is `true` (the default), `app.attachInput()` is called automatically during `init()`.

Use `ctx.input` to check pressed keys each frame:

```js
app.start({
  onUpdate({ deltaSec, input }) {
    if (input.has("arrowleft")) {
      player.move(-3.0 * deltaSec, 0.0, 0.0);
    }
    if (input.has("arrowright")) {
      player.move(3.0 * deltaSec, 0.0, 0.0);
    }
  }
});
```

Use `registerActionMap()` when you want to work with abstract action names rather than checking key names directly.

```js
app.registerActionMap({
  jump: ["space", "enter"],
  reset: ["r"]
});

app.start({
  onUpdate() {
    if (app.wasActionPressed("jump")) {
      player.jump();
    }
    if (app.wasActionPressed("reset")) {
      resetStage();
    }
  }
});
```

`wasActionPressed()` is useful for detecting the moment a key is pressed. For movement that continues while a key is held, use continuous input such as `input.has()`.

`app.attachInput()` also handles debug keys prefixed by `F9`, in addition to connecting input. The default sequence shortcuts are:

| Input | Meaning |
| :--- | :--- |
| `F9` then `M` | Toggle debug / release mode |
| `F9` then `C` | Copy diagnostics summary |
| `F9` then `V` | Copy diagnostics JSON |

Use `app.attachInput()` when adding a custom key handler and keeping the debug shortcuts available.

```js
app.attachInput({
  onKeyDown: (key, ev) => {
    if (ev.repeat) return;
    if (key === "s") {
      app.takeScreenshot({
        prefix: "sample",
        width: 720,
        height: 540
      });
    }
  }
});
```

When both `width` and `height` are supplied, webg renders one frame at those exact pixel dimensions and saves it as a PNG.
These values describe output pixels and are independent of device pixel ratio. After the browser starts capturing the image, the canvas and projection return to their regular layout.
Canvas HUD content appears in the image, so review any messages shown during capture.
When dimensions are omitted, the current canvas size is used.

## Camera basics

The standard `WebgApp` camera has three levels: `cameraRig -> cameraRod -> eye`.

* `cameraRig`: the base that holds the target and overall rotation
* `cameraRod`: the arm that represents the distance to the camera
* `eye`: the actual view node

Set the initial state with the constructor's `camera` option:

```js
const app = new WebgApp({
  document,
  camera: {
    target: [0.0, 0.0, 0.0],
    distance: 8.0,
    yaw: 24.0,
    pitch: -12.0,
    roll: 0.0
  }
});
```

`init()` creates this hierarchy and registers `app.eye` as the view for `app.space`.

For an orbit camera controlled by mouse or touch, call `createOrbitEyeRig()` after `await app.init()`:

```js
app.createOrbitEyeRig({
  target: [0.0, 0.0, 0.0],
  distance: 8.0,
  yaw: 24.0,
  pitch: -12.0,
  minDistance: 4.0,
  maxDistance: 18.0
});
```

This builds an `EyeRig` on the standard rig and connects pointer controls. `WebgApp` updates the `EyeRig` each frame, so sample code can focus on camera settings and input.

Orbit mode provides these camera controls by default:

| Input | Action |
| :--- | :--- |
| Drag | Orbit around the target |
| `Shift` + drag | Pan along the screen plane |
| `Alt` / `Option` + horizontal drag | Roll around the view's forward axis |
| Wheel | Change the camera distance |
| `ArrowLeft` / `ArrowRight` / `ArrowUp` / `ArrowDown` | Rotate the view |
| `Alt` / `Option` + `ArrowLeft` / `ArrowRight` | Change the camera roll |
| `[` / `]` | Change the camera distance |

During roll control with Alt / Option, only roll changes; the yaw and pitch from regular dragging stay the same.
Horizontal drag distance and the time the left or right arrow is held affect roll, making it possible to adjust a tilted horizon or screen.
This control is common to every orbit `EyeRig` created by `WebgApp.createOrbitEyeRig()`.

The following helpers support position following, immediate alignment, and camera shake.
Here, `followNode()` moves the `cameraRig` base toward a target. It differs from the `EyeRig` follow feature, which points the view toward a target from an independent camera position.

* `followNode()`: smoothly move `cameraRig` toward a target Node
* `lockOn()`: align `cameraRig` with a target immediately
* `clearCameraTarget()`: clear follow or lock-on behavior
* `shakeCamera()`: create a brief impact effect

Chapter 06 covers camera controls in detail.

## Lights and fog

The standard light mode in `WebgApp` defaults to `eye-fixed`, which makes objects easy to inspect in learning samples and viewers.

```js
const app = new WebgApp({
  document,
  light: {
    mode: "eye-fixed",
    position: [120.0, 180.0, 140.0, 1.0],
    type: 1.0
  }
});
```

Use `world-node` to bind a light to a particular Node in the scene.

```js
const app = new WebgApp({
  document,
  light: {
    mode: "world-node",
    nodeName: "sunLight",
    position: [80.0, 120.0, 60.0, 1.0],
    type: 1.0
  }
});
```

After `init()`, switch light settings with `setEyeLight()` or `setWorldLight()`. Specify fog in the constructor options or with `setFog()`.

## HUDs and overlays

`WebgApp` provides `app.message` and `app.hudMessage` for drawing a HUD on the canvas.

For short status displays, use `app.message.setLine()` or `setLines()`:

```js
app.start({
  onUpdate({ app, deltaSec }) {
    app.message.setLines("status", [
      "WebgApp sample",
      `delta: ${deltaSec.toFixed(3)} sec`
    ], {
      anchor: "top-left",
      x: 0,
      y: 0
    });
  }
});
```

Use `setHudRows()` or `setControlRows()` to arrange labels and values. Use `pushToast()` or `flashMessage()` for brief notifications.

Use the DOM-based `OverlayPanel` for longer explanations, help, errors, and choice panels.

```js
app.showOverlayPanel({
  id: "help",
  title: "Help",
  lines: [
    "Drag: orbit",
    "R: reset"
  ],
  anchor: "top-left",
  collapsible: true
});
```

Calling `showOverlayPanel()` again with the same `id` updates the existing panel. Use `hideOverlayPanel()` to hide it and `removeOverlayPanel()` to remove it.

For standard help or error panel options, use helpers from `OverlayPanelPresets.js`.

```js
import { buildHelpPanelOptions } from "../../webg/OverlayPanelPresets.js";

app.showOverlayPanel(buildHelpPanelOptions({
  id: "help",
  lines: ["Drag: orbit", "R: reset"]
}));
```

`WebgApp` combines help, errors, and conversation displays under shared overlay and UI management, with a panel layout for each purpose.
Use `OverlayPanel` for the display frame and an application-side controller for text queues and branching.

## Features to add when needed

`WebgApp` also integrates features for applications beyond the minimal setup. Learn the basic structure first, then add features as the application needs them.

* **`layoutMode: "viewport"`**: position the canvas and overlays relative to the full screen
* **`layoutMode: "embedded"`**: embed the canvas in a book or learning page
* **`Diagnostics`**: record environment checks and runtime warnings
* **`DebugDock`**: show diagnostics in a development UI (the user-facing interaction and display surface)
* **`loadModel()`**: load glTF, Collada, and Model JSON; construct ModelYAML through `ModelAsset.load()` as described in Chapter 08
* **`createWebgSceneApp()`**: launch placement, PBR, physics, and animation together from SceneYAML
* **`SceneAsset.load()` and `assertValid()`**: retain SceneYAML values, source text, and comments, and validate references and settings
* **`createTween()`**: interpolate a value over time
* **`createParticleEmitter()`**: create lightweight particle effects
* **`scenePhase`**: track a phase such as `"title"` or `"gameplay"`
* **`saveProgress()` and `loadProgress()`**: save or load progress
* **`takeScreenshot()`**: save the rendered canvas as a PNG, with optional output pixel dimensions

Example of `loadModel()`:

```js
const runtime = await app.loadModel("./assets/robot.glb", {
  format: "gltf"
});
```

`format` accepts `"gltf"`, `"collada"`, or `"json"`.
To launch a complete scene from SceneYAML, use `createWebgSceneApp({ project: "./scene.yaml" })` as described in Chapter 09.

## Detailed frame processing order

For a basic application, writing updates in `onUpdate` and leaving `autoDrawScene: true` is sufficient.
The following details become relevant when adding post-processing or custom render passes.

`WebgApp.frame()` generally proceeds in this order:

1. In `ondemand` mode, pause while the page is hidden or unfocused.
2. Calculate `deltaSec` since the previous frame.
3. Update managed `EyeRig` instances.
4. Create the frame context `ctx`.
5. Call `onUpdate(ctx)`.
6. Update tweens.
7. Update `Space` animations.
8. Update particle emitters.
9. Apply camera following, lock-on, and shake.
10. Finalize that frame's `cameraFrame` and `renderFrameToken`, and set them on `ctx`.
11. Call `screen.clear()`.
12. Call `onBeforeDraw(ctx)`.
13. If `autoDrawScene` is true, call `space.draw(cameraFrame)`.
14. If `autoDrawBones` is true, draw the bones.
15. Call `onAfterDraw3d(ctx)`.
16. Draw particles.
17. Draw the HUD, messages, and toasts.
18. Call `onAfterHud(ctx)`.
19. Call `screen.present()`.
20. Advance one-shot input state to the next frame.
21. Schedule the next frame if the loop is still running.

These 21 steps describe the regular frame when `computeFrame: false`.
With `computeFrame: true`, regular 3D and HUD rendering are not performed automatically in this sequence; frame processing is delegated to `onComputeFrame`.
In `onComputeFrame`, record the required Compute Passes and Render Passes into the same `GPUCommandEncoder`, then submit the commands.
Thus, `computeFrame` switches how the entire frame is processed; it does not add compute processing after the regular frame.

For post-processing or offscreen render targets, set `autoDrawScene: false` and manage the draw order yourself.

```js
import DofPass from "../../webg/DofPass.js";

const app = new WebgApp({
  document,
  autoDrawScene: false
});

await app.init();

const dof = new DofPass(app.getGPU(), {
  width: app.screen.getWidth(),
  height: app.screen.getHeight()
});
await dof.ready;

app.start({
  onBeforeDraw({ renderFrameToken }) {
    dof.beginScene(app.screen, app.clearColor, { renderFrameToken });
    app.space.draw(renderFrameToken);
  },
  onAfterDraw3d({ renderFrameToken }) {
    dof.render(app.screen, { renderFrameToken });
  }
});
```

Effects that read color alone do not need a token.
For a manual connection that reads scene depth in a later stage, use `renderFrameToken`. With `ComputeEffectPipeline`, pass the `cameraFrame` from the same callback to `renderScene()` and `encode()`.

## A typical application structure

Combining the elements in this chapter gives a standard sample structure like this:

```js
import WebgApp from "../../webg/WebgApp.js";
import Shape from "../../webg/Shape.js";
import Primitive from "../../webg/Primitive.js";
import { buildHelpPanelOptions } from "../../webg/OverlayPanelPresets.js";

const app = new WebgApp({
  document,
  messageFontTexture: "../../webg/font512.png",
  clearColor: [0.06, 0.08, 0.12, 1.0],
  debugTools: {
    mode: "release",
    system: "sample",
    source: "samples/high_level/main.js"
  },
  camera: {
    target: [0.0, 0.0, 0.0],
    distance: 8.0,
    yaw: 24.0,
    pitch: -12.0
  }
});

await app.init();

app.createOrbitEyeRig({
  target: [0.0, 0.0, 0.0],
  distance: 8.0,
  yaw: 24.0,
  pitch: -12.0
});

const shape = new Shape(app.getGPU());
shape.applyPrimitiveAsset(Primitive.cube(2.0, shape.getPrimitiveOptions()));
shape.endShape();
shape.setMaterial("smooth-shader", {
  has_bone: 0,
  use_texture: 0,
  color: [1.0, 0.5, 0.3, 1.0]
});

const node = app.space.addNode(null, "box");
node.addShape(shape);

app.showOverlayPanel(buildHelpPanelOptions({
  id: "help",
  lines: [
    "Drag: orbit",
    "R: reset",
    "F9 then M: debug mode"
  ]
}));

app.registerActionMap({
  reset: ["r"]
});

app.start({
  onUpdate({ deltaSec, app }) {
    if (app.wasActionPressed("reset")) {
      node.setAttitude(0.0, 0.0, 0.0);
    }

    node.rotateY(0.8 * deltaSec);
    node.rotateX(0.3 * deltaSec);

    app.message.setLines("status", [
      "WebgApp sample",
      `debug=${app.getDebugMode()}`
    ], {
      anchor: "top-left",
      x: 0,
      y: 0
    });
  }
});
```

## Implementation checklist

When an application using `WebgApp` displays nothing, stops moving, or ignores input, check the following:

* Are `app.getGPU()`, `app.space`, and `app.eye` used after `await app.init()` completes?
* After adding vertices or a primitive to a `Shape`, is `shape.endShape()` called?
* Is the created `Shape` attached to a `Node`, and is that `Node` in `app.space`?
* Does per-frame movement or rotation use `deltaSec`?
* Does `PhysicsSpace.step()` receive `deltaMs` (`deltaSec * 1000.0`) rather than `deltaSec`?
* Are one-time “pressed” actions distinguished from continuous “held” input?
* If an orbit camera is needed, is `app.createOrbitEyeRig()` called?
* Are longer explanations and help shown through `OverlayPanel` instead of the HUD?
* For a custom render pass, is `autoDrawScene: false` needed?
* If custom input should retain debug shortcuts, is it connected through `app.attachInput()`?

## Summary

`WebgApp` is the standard foundation for applications built with `webg`.
It combines `Screen`, shaders, `Space`, cameras, input, HUDs, diagnostics, and the frame loop so developers can focus on building scenes and updating application state.

Start with four steps: `new WebgApp()`, `await app.init()`, place objects in `app.space`, and call `app.start({ onUpdate })`.

In `onUpdate`, advance scene state by one frame before rendering. Use `ctx.deltaSec` for movement and rotation, and destructure values as in `onUpdate({ deltaSec, input, app })` when convenient. For physics, convert `deltaSec` to milliseconds with `physics.step(deltaSec * 1000.0)`.

Chapter 06 builds on the `cameraRig -> cameraRod -> eye` hierarchy created by `WebgApp` and explains orbit, follow, first-person, and other camera controls through `EyeRig`.
