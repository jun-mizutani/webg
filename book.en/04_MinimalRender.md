# Minimal Rendering

This chapter uses `WebgApp` to display a cube. First create a scene that shows a shape, rotates it, and lets you control the view. Then follow the connections between initialization, shape preparation, placement, and updates.

`WebgApp` prepares the render target, camera, and frame updates together. You can begin by focusing on the shape you want to display and how it should move. To study the underlying mechanisms in more detail, Chapter 37 compares this approach with a low-level setup.

## How to read this chapter

### Prerequisites

Review the runtime environment in Chapter 02 and the coordinate fundamentals in Chapter 03. The code assumes that you save the example as `user/minimum/minimum.html` in the repository.

### What to read first

Run the cube example and follow initialization, shape finalization, placement on a Node, and an update based on elapsed time.

### What to read when you need it

For direct control of rendering, see the comparison with the low-level setup and Chapter 37. To add application features, continue to Chapter 05; to adjust the camera, continue to Chapter 06.

### What you will learn

You will be able to display a cube with `WebgApp`, rotate it over time, and control the view with the mouse.

## Display a cube

Start the HTTP server from Chapter 02 at the repository root. Save the following content as `user/minimum/minimum.html` and open `http://localhost:8000/user/minimum/minimum.html`. The file is two folders below the repository root, so the imports use `../../webg/`.

This runnable example combines the canvas and JavaScript in one HTML file. `WebgApp` uses the canvas as its render target, then prepares the shape and camera after initialization completes.

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>webg minimum</title>
</head>
<body style="margin:0; overflow:hidden">
  <canvas id="canvas"></canvas>
  <script type="module">
import WebgApp from "../../webg/WebgApp.js";
import Shape from "../../webg/Shape.js";
import Primitive from "../../webg/Primitive.js";

const app = new WebgApp({
  messageFontTexture: "../../webg/font512.png",
  clearColor: [0.1, 0.15, 0.1, 1.0],
});
await app.init();

const orbit = app.createOrbitEyeRig({
    target: [0.0, 0.0, 0.0],
    distance: 8.0,
    yaw: 24.0,
    pitch: -12.0,
    minDistance: 4.0,
    maxDistance: 18.0,
    wheelZoomStep: 1.0
});

const shape = new Shape(app.getGPU());
shape.applyPrimitiveAsset(Primitive.cube(2.0, shape.getPrimitiveOptions()));
shape.endShape();

shape.setMaterial("smooth-shader", {
  has_bone: 0,
  use_texture: 0,
  color: [1.0, 0.5, 0.3, 1.0]
});

const obj = app.space.addNode(null, "obj");
obj.addShape(shape);

app.start({
  onUpdate: ({ deltaSec }) => {
    obj.rotateY(0.8 * deltaSec);
    obj.rotateX(0.4 * deltaSec);
  }
});
  </script>
</body>
</html>
```

An orange cube appears against a green-tinted background and rotates slowly. Drag to orbit the view and use the wheel to change the distance. After confirming the shape and motion, change `color`, `distance`, or the rotation speed one at a time to see how each value affects the display.

The existing book example is available at [the runnable WebgApp example](../book/examples/04_02.html). The book page adds a fixed-size canvas and interaction instructions. The HTML here shows the basic setup with a full-window display.

## Run This Example with the Bundle

For the HTML at `user/minimum/minimum.html`, replace the three imports with:

```js
import { WebgApp, Shape, Primitive }
  from "../../lib/webg.core.min.js";
```

Keep the initialization, geometry, and update code. Keep the example's
`messageFontTexture: "../../webg/font512.png"` as well: the bundle combines
JavaScript, while assets use their own URLs. Open the same HTTP page and check
rotation, dragging, and wheel zoom. Chapter 2 explains placement;
[Appendix C](Appendix_C_Bundle.md) explains automatic conversion of samples.

## Follow initialization and placement

`new WebgApp()` sets options such as the background color and font image path. `await app.init()` waits for the rendering setup to complete. `app.getGPU()` then provides the GPU context needed to create the shape's buffers. This order ensures that the GPU is ready before you prepare geometry for rendering.

`Primitive.cube(2.0, ...)` generates the data for a cube with side length 2. After importing it into `Shape`, `endShape()` finalizes the vertex and face data in GPU buffers for rendering. `setMaterial()` then specifies the surface color for this example. Chapter 07 explains materials in detail.

The `Node` represents where a shape is placed. `app.space.addNode(null, "obj")` adds it to the scene, and `addShape(shape)` attaches its appearance. Separating shape from placement lets you manage different positions and orientations while reusing the same shape. Chapter 08 covers placing multiple models.

## Use the camera and elapsed time

For an orbit camera, `target` is the point to look at and `distance` is the distance from that point. The cube is at the origin, so its target is `[0, 0, 0]` as well. `yaw` and `pitch` set the initial view direction, while `minDistance` and `maxDistance` define the zoom range.

Calling `app.start()` begins frame updates and rendering. `onUpdate` runs before a frame is drawn, and `deltaSec` is the number of seconds since the previous frame. `rotateY(0.8 * deltaSec)` rotates at 0.8 degrees per second. Multiplying by elapsed time keeps the angle advanced over a given interval approximately the same even when the frame rate changes.

## Check the rendered result

It is easier to tune settings when you check the shape, color, position, and motion separately. These correspond to `Primitive`, the material, `Node`, and the camera.

The display setup follows this order: wait for `app.init()`, finalize the shape with `endShape()`, place it with `addShape()`, and begin updates with `app.start()`. If rendering stops, inspect the browser developer console for exceptions and file-loading results, then trace which of these steps completed.

## Inspect the foundation with the low-level setup

Internally, `Screen` handles the render target, `Space` the scene, `Node` placement, and `Shape` geometry and materials. The standard setup brings these pieces together with per-frame drawing in `WebgApp`.

To control the render target and processing order yourself, initialize `Screen` and the shader, set up the view and `Shape`, then call the screen initialization, scene drawing, and presentation steps in sequence. The [low-level runnable example](../book/examples/04_01.html) demonstrates this order.

Chapter 37 explains how GPUDevice, buffers, pipelines, and draw commands correspond to these operations. Seeing the standard result first makes it easier to understand which stage of the display each low-level operation controls.

## Summary

Initialize `WebgApp`, finalize a shape, attach it to a `Node`, and move it from `onUpdate` to create your first 3D scene. Chapter 05 adds input, display, and update processing to this structure.
