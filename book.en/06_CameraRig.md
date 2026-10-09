# Camera Controls and EyeRig

This chapter builds the view position and orientation from a target, camera distance, yaw, and pitch, then connects them to mouse, touch, and keyboard controls.
`EyeRig` groups these values so you can combine orbiting, following, and zooming without editing matrices directly.
The chapter also explains how to update the camera so input and rendering use the same state.

## How to read this chapter

### Prerequisites

The chapter is easier to follow if you understand the coordinate transforms in Chapter 03 and the `WebgApp` update process in Chapter 05.

### What to read first

Start with projection matrices, the basic `EyeRig` structure, orbit views, roll correction, and panning.

### What to read when you need it

Refer to the first-person, follow, mode-switching, pose-interpolation, and helper-method sections after you have chosen a camera style.

### What you will learn

You will be able to choose an orbit, first-person, or follow view and implement position, look direction, up direction, and input as separate concerns.

## Choose camera behavior for the application

`EyeRig` handles orbit views around a target, first-person views from within the scene, and follow views that track a moving object through a shared structure.
This chapter explains how to set a view's position, orientation, distance, and target, then connect them to controls suited to the application.

> **How to read this chapter:** Choose an application type in the table below, then read its mode section. Field of view, parent Nodes, the up direction, and interpolation are useful checks when composition or following needs adjustment.

| Mode | `base` | `rod` and `eye` | Local forward |
| --- | --- | --- | --- |
| Orbit | Center of interest | Distance and view direction | Camera looks along `-Z` |
| First person | Body or mounting position | Eye height and independent look direction | Movement and look use `-Z` as reference |
| Follow | Camera-side reference position | Automatic orientation and distance | Camera looks along `-Z` |

One of the first decisions in a 3D application is how to show the world to the user.
Even in the same 3D space, a product viewer, a building walkthrough, and a character or vehicle game call for very different camera motion.

An orbit camera works well for inspecting an object. A first-person camera feels natural for moving through a building. A follow camera keeps a moving character or vehicle in view.

Field of view matters along with camera behavior.
Including peripheral vision, people perceive a wide horizontal range of around 180 degrees, while the central field used to inspect a specific object is much narrower.
A model viewer can feel natural with a field of view around 30–40 degrees.

For a first-person walkthrough, a field of view that is too narrow makes navigation difficult.
For example, a door 0.8–0.9 m wide, viewed from 1 m away, needs a horizontal field of view wider than 40 degrees to fit in the frame.
A narrow view makes it harder to understand the relationship between walls, entrances, and corners.

Choose the camera mode and field of view for the application's purpose: a narrower view for inspecting an object and a somewhat wider view for a walkthrough or follow camera.

Camera behavior is closely tied to the purpose of the application.
`EyeRig` organizes the different needs into the three-level structure `cameraRig`, `cameraRod`, and `eye`.

![Selfie stick](../book/img/selfiestick.jpg)

This chapter uses `webg/EyeRig.js` and `webg/WebgApp.js` to explain each Node's role, why the three-level structure is useful, and what the application controls.
It builds on the standard `WebgApp` rig from Chapter 05.

The view itself is not the `EyeRig` instance; it is the `eye` Node selected by `Space.setEye(node)`.
`EyeRig` does not render the camera. It assigns positions and rotations to the three Nodes—`cameraRig`, `cameraRod`, and `eye`—according to a set of rules.
The `eye` Node determines what appears on screen.

The `base -> rod -> eye` hierarchy separates rotation from distance.
An orbit view often needs to control its target, a follow view its tracking target, and a first-person view the body direction and look direction independently.
`setAngles()` changes the orientation of `base` or `rod` and moves the foundation of the view.
`setLookAngles()` controls an independent look direction on the `eye`, useful when it should differ from the direction of travel.

When creating an `EyeRig` directly with `new EyeRig(...)`, connect input once with `attachPointer()`, then advance the camera with `update(deltaSec)` every frame.
`attachPointer()` accepts mouse, touch, and pen input; per-frame `update(deltaSec)` handles mode changes, target following, and keyboard controls.
With the standard orbit setup from `WebgApp.createOrbitEyeRig()`, `WebgApp` manages pointer input and the per-frame update.
In this setup, let `WebgApp` own the update entry point; adding a second manual `update()` would update the rig twice.

## Design of the three-level camera rig

The `base`, `rod`, and `eye` levels separately control the target position, orbit rotation, camera distance, and independent look direction.
Assigning each role to a `Node` lets the application switch between orbit, first-person, and follow modes while reusing input processing.

![EyeRig base, rod, and eye hierarchy](../book/img/fig06_01_eyerig_base_rod_eye.jpg)

The three levels make it easier to control horizontal rotation, elevation, and the final view independently.

A 3D application may need to switch between deciding what to look at, what point to orbit, what object to track, and whether body direction differs from look direction.
Managing the view with one coordinate alone mixes these control concepts when orbit and first-person views coexist.
The `base -> rod -> eye` structure keeps their roles clear.

`base` holds the camera's reference position, `rod` holds rotation and composition relative to it, and `eye` holds the final position and independent look direction.
`WebgApp.createCameraRig()` creates the standard camera Nodes using the same design.

```js
createCameraRig() {
  this.cameraRig = this.space.addNode(null, this.camera.rigName);
  this.cameraRig.setPosition(...this.camera.target);
  this.cameraRig.setAttitude(this.camera.yaw, this.camera.pitch, this.camera.roll);
  this.cameraRod = this.space.addNode(this.cameraRig, this.camera.rodName);
  this.cameraRod.setPosition(0.0, 0.0, 0.0);
  this.cameraRod.setAttitude(0.0, 0.0, 0.0);
  this.eye = this.space.addNode(this.cameraRod, this.camera.eyeName);
  this.eye.setPosition(0.0, 0.0, this.camera.distance);
  this.eye.setAttitude(0.0, 0.0, 0.0);
  this.space.setEye(this.eye);
}
```

An `EyeRig` is not required to create a view.
It is a helper that gives orbit, first-person, and follow meaning to the existing three-level structure, and it can also hold focus settings when needed.
`WebgApp.init()` creates `cameraRig`, `cameraRod`, and `eye`, and calls `space.setEye(this.eye)`. The application can then use that structure with an `EyeRig`.

The three modes assign roles as follows:

* **Orbit:** `base` is the target, `rod` supplies yaw and pitch, and `eye` supplies distance.
* **First person:** `base` supplies body position and yaw, `rod` supplies eye height, and `eye` supplies an independent look direction.
* **Follow:** `base` is the camera-side reference position, `rod` holds a relatively stable composition, and `eye` supplies distance and the dynamic orientation toward the target.

This shared structure handles wide scene overviews, walking from the protagonist's point of view, and following an object from behind through the same general model.

The parent of `base` is chosen by the application, not by `EyeRig`.
Make `base` a child of a moving and rotating vehicle or mount when the camera should inherit its motion.
If the camera should inherit position but not the vehicle's rotation or roll, use a separate non-rotating Node and update only its position in the application.

Positions and orientations assigned to these Nodes are local transforms relative to their parents.
The final world position and orientation result from composing the application's parent hierarchy with the local transforms set by `EyeRig`.
`EyeRig` updates the camera-side local transforms; the application manages target-object movement and camera parent relationships.

The responsibilities are:

* **Application:** choose the parent of `base`, decide which movement and rotation to inherit, move target objects, switch modes, and assign inputs
* **`EyeRig`:** hold per-mode state, set local transforms on `base`, `rod`, and `eye`, convert input values, interpolate the follow pose, and resolve focus distance for DoF

`EyeRig`'s focus setting tells the camera which Node or distance to focus on. `WebgApp` records the result in the current `CameraFrame`, which is passed to the later DoF processing stage.
The DoF pass or `ComputeEffectPipeline` manages whether DoF is enabled, `focusRange`, blur radius, and related effect settings.

## Manage field of view and the projection matrix

`EyeRig` controls position, orientation, and the focus target. Field of view and blur amount are separate concerns.
`WebgApp` stores `viewAngle`, `projectionNear`, and `projectionFar`, and sends the projection matrix to the current shader through `updateProjection()`.

```js
updateProjection(viewAngle = this.viewAngle) {
  const proj = new Matrix();
  const vfov = this.screen.getRecommendedFov(viewAngle);
  proj.makeProjectionMatrix(
    this.projectionNear,
    this.projectionFar,
    vfov,
    this.screen.getAspect()
  );
  this.projectionMatrix = proj;
  if (this.shader?.setProjectionMatrix) {
    this.shader.setProjectionMatrix(proj);
  }
  return proj;
}
```

`viewAngle` is the reference field of view along the shorter screen dimension.
The projection matrix takes a vertical FOV (`vfov`), but modern desktop and smartphone screens have very different aspect ratios.
To keep perceived zoom similar for the same `viewAngle`, `webg` adjusts the vertical FOV using the shorter screen dimension. A fixed vertical FOV would show different ranges on landscape and portrait displays.

The four-argument `makeProjectionMatrix()` creates a Reverse-Z projection for a regular camera. The near plane maps to depth 1; the far plane and undrawn background map to depth 0.
Shadow-map orthographic projections use a separate path that explicitly selects `SHADOW_STANDARD_Z`. The camera therefore retains Reverse-Z while shadow projections use Standard-Z.

`Screen.getRecommendedFov(base)` interprets `base` as the FOV along the shorter screen dimension and calculates the vertical FOV for the current aspect ratio.
The aspect ratio is:

```text
aspect = width / height
```

On a landscape or square display with `aspect >= 1.0`, the shorter dimension is vertical, so the shorter-side FOV and vertical FOV are the same:

```text
vfov = base
```

On a portrait display with `aspect < 1.0`, the shorter dimension is horizontal. Calculate the vertical FOV so that the horizontal FOV (`hfov`) remains equal to `base`.
In perspective projection, the half-width or half-height visible at distance `d` is `d * tan(fov / 2)`. The horizontal and vertical FOVs are related by:

```text
tan(hfov / 2) = aspect * tan(vfov / 2)
```

To keep `hfov = base` in portrait orientation, use:

```text
vfov = 2 * atan(tan(base / 2) / aspect)
```

For example, with `base = 50°`, a landscape desktop display with `aspect = 1.8` uses `vfov = 50°`. A portrait phone with `aspect = 0.5` uses a vertical FOV of about `86°`.
That may look wide when considered by itself, but the horizontal FOV remains `50°`.
The portrait view expands vertically to preserve the visible range along the shorter screen dimension.

This design keeps the shorter-side view within a range that can be handled with roughly one zoom step.
The long dimension varies among devices, while a stable short dimension helps objects avoid appearing cramped or too small.
This is especially useful when the same sample runs on portrait phones and landscape PCs.

For camera operation, separate “where the camera is and which way it faces,” controlled by `EyeRig` or `Node`, from “how wide the view is and how perspective looks,” controlled by `viewAngle` and the projection matrix.
The basic setup specifies `viewAngle`, `projectionNear`, and `projectionFar` when creating `WebgApp`:

```js
const app = new WebgApp({
  document,
  messageFontTexture: "./webg/font512.png",
  viewAngle: 54.0,
  projectionNear: 0.1,
  projectionFar: 160.0,
  camera: {
    target: [0.0, 6.0, 0.0],
    distance: 46.0,
    yaw: 28.0,
    pitch: -18.0
  }
});
await app.init();
```

Here, `camera.distance` sets the camera's physical position, while `viewAngle` corresponds to the lens width along the shorter screen dimension.
At the same distance, a smaller `viewAngle` looks more telephoto and a larger one looks wider.
For a zoom effect, change `viewAngle` at runtime and call `updateProjection()`:

```js
app.viewAngle = 40.0;
app.updateProjection();
```

`updateProjection()` rebuilds the projection matrix from the current `viewAngle`. Update `app.viewAngle` first to retain the same FOV after a later resize or layout update.

```js
app.updateProjection(40.0);
```

Passing an argument to `updateProjection(40.0)` supplies the reference FOV for that call. It rebuilds only the projection matrix; persistent zoom state remains in `app.viewAngle`. Keeping the state and a one-time recalculation separate makes both easier to manage.

This changes the telephoto or wide-angle appearance while keeping the camera position fixed.
To create the feeling of physically moving closer to the target, change `distance` or `position` on the `EyeRig` instead.
`projectionNear` and `projectionFar` set the visible depth range.
Camera Reverse-Z improves floating-point depth precision at long distances. Set `near` and `far` to the range the scene actually needs, balancing visibility and precision.
Account for frustum culling, shadow-map tracking range, and the search distance for DoF (depth of field) and SSR (screen-space reflections).
Use `projectionFar: Infinity` only with a camera Reverse-Z path that explicitly supports an infinite far plane.

The shorter-side FOV can also be displayed as a full-frame-equivalent focal length.
For a full-frame sensor with a 24 mm short side, convert `fovShort` with:

```text
focalLengthMm = 24 / (2 * tan(fovShort / 2))
```

This conversion is useful in viewers and modeling tools, where a short label helps users understand the change in appearance.
Lens equivalents such as `26mm`, `56mm`, and `114mm` communicate wide, normal, and telephoto views more intuitively than angles such as `50°` or `24°`.
This is a way to express the appearance created by `viewAngle` using familiar photographic terms, rather than a simulation of the optical properties of a real lens.

## Implement an orbit view and panning

Start with the simplest camera mode, an orbit view.
Define a target and distance, then rotate the view with drag and wheel input to inspect spatial relationships throughout the scene.
`samples/high_level` uses this as its minimal camera setup.

```js
import WebgApp from "./webg/WebgApp.js";

const app = new WebgApp({
  document,
  messageFontTexture: "./webg/font512.png",
  clearColor: [0.1, 0.15, 0.1, 1.0],
  camera: {
    target: [0.0, 0.0, 0.0],
    distance: 8.0,
    yaw: 0.0,
    pitch: 0.0,
    roll: 0.0
  }
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

app.start();
```

This creates an orbit `EyeRig` on the `cameraRig`, `cameraRod`, and `eye` Nodes created by `WebgApp`.
`createOrbitEyeRig()` handles pointer input, the per-frame `update(deltaSec)`, and synchronization between the orbit state and `WebgApp`'s camera state.
The sample does not need to call `orbit.update(deltaSec)` or manually copy values into `app.camera.target`; this also keeps panning from being overwritten by `app.camera.target`.

The returned `orbit` is a regular `EyeRig`, so methods such as `setTarget()`, `setAngles()`, and `setDistance()` remain available.
`target` maps to the `base` position, `yaw` and `pitch` to the `rod` orientation, and `distance` to the Z position of `eye`.

### Correct the view roll

An orbit view supports roll around the camera's forward axis, in addition to yaw around the target and pitch up or down.
Roll adjusts the tilt of horizontal or vertical lines in the image without changing the target or the distance to the camera.
It is useful for viewing a building or exhibit straight on, or leveling the image after orbiting or panning.

`WebgApp.createOrbitEyeRig()` uses Alt / Option as the standard roll modifier.
Dragging the camera while holding Alt / Option converts horizontal movement into roll. Only horizontal movement contributes, so pitch remains independent during a roll.
On the keyboard, hold `ArrowLeft` or `ArrowRight` with Alt / Option to roll at a constant speed.
Alt / Option with up and down arrows remains available for other movement; use the modifier with the left and right arrows for roll.

```js
const orbit = app.createOrbitEyeRig({
  target: [0.0, 0.0, 0.0],
  distance: 8.0,
  yaw: 24.0,
  pitch: -12.0,
  orbit: {
    keyRollSpeed: 45.0,
    dragRollSpeed: 0.18
  }
});
```

`keyRollSpeed` sets the angular speed in degrees per second for Alt / Option plus the left or right arrow. `dragRollSpeed` converts horizontal pointer movement to a roll angle.
When omitted, they use the regular orbit rates of `72.0` degrees per second and `0.28` degrees per pixel.
Roll is applied as a quaternion rotation around the current view's forward axis, so it remains visually consistent after yaw or pitch changes.

An orbit camera is more than a rotation and zoom control.
In model viewers and editing tools, it is often useful to bring the part of interest back to the center of the screen—for example, zooming in on a character's hand after checking the whole figure.
Rotation alone can make it difficult to center a window after viewing a building's exterior.
The orbit mode in `EyeRig` provides panning for these cases.

Panning moves `orbit.target` along the screen plane perpendicular to the view; it does not teleport the camera to a separate position.
It shifts the center of interest horizontally or vertically while retaining the current yaw, pitch, and distance.

The implementation derives screen-right and screen-up directions from the `eye` world matrix, then converts drag distance to movement in world space.
However, `orbit.target` is in local coordinates relative to the parent of `base`.
If `base` has a rotated parent, the world-space movement is inverse-transformed into the parent's local coordinates before it is added to `target`.

Adding a world-space direction directly to a local coordinate would apply the parent's rotation again, misaligning the movement with the screen.
The explicit conversion between world directions and local state keeps panning aligned with screen horizontal and vertical directions, even when the camera is a child of a vehicle or planet.

In orbit mode, hold `Shift` while dragging to pan.
For touch, move the center of a two-finger gesture; for the keyboard, use `Shift + Arrow`.
`createOrbitEyeRig()` connects this input and synchronizes the camera state with `WebgApp`, so samples can share the orbit camera behavior.

Panning also helps with composition.
When the target is away from the center of an object, a small rotation can move the area of interest outside the screen.
Pan the point of interest to the center before continuing to rotate or zoom; this makes viewers, asset checks, and lighting inspection more efficient.
Loader samples such as `gltf_loader`, `collada_loader`, and `json_loader` enable `Shift + Arrow` and `Shift + Drag` for this reason.

`createOrbitEyeRig()` also manages key bindings as well as initial camera state.
`WebgApp` provides the default key map, so specify only differences from the defaults instead of rewriting every key.

For example, change only the rotation keys to `W / A / S / D` and keep the default zoom keys:

```js
const orbit = app.createOrbitEyeRig({
  target: [0.0, 0.0, 0.0],
  distance: 8.0,
  yaw: 24.0,
  pitch: -12.0,
  orbitKeyMap: {
    left: "a",
    right: "d",
    up: "w",
    down: "s"
  }
});
```

In this example, `zoomIn` and `zoomOut` retain their default `[` and `]` bindings.
Change the modifier for panning with `panModifierKey`.
Because Alt / Option is assigned to roll by default, the following example assigns another modifier to panning. It uses `Control + Drag` and `Control + W / A / S / D`:

```js
const orbit = app.createOrbitEyeRig({
  target: [0.0, 0.0, 0.0],
  distance: 8.0,
  yaw: 24.0,
  pitch: -12.0,
  orbitKeyMap: {
    left: "a",
    right: "d",
    up: "w",
    down: "s"
  },
  panModifierKey: "control",
  rollModifierKey: "alt"
});
```

Changing `panModifierKey` updates both keyboard-pan and pointer-drag-pan checks.
`rollModifierKey` specifies the modifier used with Alt / Option-style roll controls.
Assign different keys to `rollModifierKey`, `panModifierKey`, and `dragZoomModifierKey`; assigning one modifier to multiple roles makes the input ambiguous and is reported as an `EyeRig` configuration error.
The supported modifier names are:

| Key | Accepted names |
| :--- | :--- |
| Shift | `shift` |
| Control | `control`, `ctrl` |
| Alt / Option | `alt`, `option` |
| Meta / Command | `meta`, `command`, `cmd` |

Chapter 14 explains how these modifier names are used for input handling.

### Configure drag buttons and alternate input

For a viewer, left drag can orbit the camera.
In a modeler or editor, left drag is often used for rectangle selection or vertex movement, so camera control needs another button.
`EyeRig` provides `dragButton` to select the pointer-event button that starts camera dragging.

`dragButton` uses the pointer event's `button` value: left `0`, middle `1`, right `2`.
Changing it to the middle button in an editor leaves the left button free for editing.

```js
const orbit = app.createOrbitEyeRig({
  target: [0.0, 0.0, 0.0],
  distance: 8.0,
  yaw: 24.0,
  pitch: -12.0,
  dragButton: 1
});
```

For controls like Blender's, specify `dragZoomModifierKey` to zoom by dragging separately from the wheel:

```js
const orbit = app.createOrbitEyeRig({
  target: [0.0, 0.0, 0.0],
  distance: 8.0,
  yaw: 24.0,
  pitch: -12.0,
  dragButton: 1,
  panModifierKey: "shift",
  dragZoomModifierKey: "control",
  dragZoomSpeed: 0.04
});
```

This setup uses middle-button drag to orbit, `Shift + middle-button drag` to pan, and `Ctrl + middle-button drag` to zoom.

On some macOS trackpads, middle-button dragging may not reach the browser.
For that case, `EyeRig` offers `alternateDragButton` and `alternateDragModifierKey` to start a drag with a modifier key:

```js
const orbit = app.createOrbitEyeRig({
  target: [0.0, 0.0, 0.0],
  distance: 8.0,
  yaw: 24.0,
  pitch: -12.0,
  dragButton: 1,
  panModifierKey: "shift",
  rollModifierKey: "meta",
  dragZoomModifierKey: "control",
  dragZoomSpeed: 0.04,
  alternateDragButton: 0,
  alternateDragModifierKey: "alt"
});
```

Along with middle-button drag, this recognizes `Option + left drag` as a camera drag.
The alternate input is active only while `alternateDragModifierKey` is pressed, so it can coexist with selection on left drag alone.
Here `rollModifierKey` is `meta`, so Option + left drag rotates the camera rather than rolling it.
This is suited to an editor that uses left drag for selection and Option + left drag as a middle-button orbit control on macOS.
If `rollModifierKey` stays at its default, Option + left drag converts horizontal movement into roll instead.

Use `getDefaultOrbitEyeRigBindings()` to inspect the current defaults:

```js
const defaults = app.getDefaultOrbitEyeRigBindings();

console.log(defaults.keyMap.left);         // "arrowleft"
console.log(defaults.panModifierKey);      // "shift"
console.log(defaults.rollModifierKey);     // "alt"
console.log(defaults.alternateDragButton); // null
```

You can also change an `EyeRig` instance after creating it.
When changing modifiers dynamically, keep `rollModifierKey`, `panModifierKey`, and `dragZoomModifierKey` assigned to different keys.

```js
orbit.orbit.keyMap.left = "j";
orbit.orbit.keyMap.right = "l";
orbit.orbit.keyMap.up = "i";
orbit.orbit.keyMap.down = "k";
orbit.orbit.panModifierKey = "control";
```

Thus, `createOrbitEyeRig()` is more than a convenience helper: it is an entry point that manages input settings with useful defaults.

Use `setTarget()` to change the target explicitly in code.
For example, after setting the initial view from a model's bounding box, move a particular part toward the center:

```js
orbit.setTarget(
  orbit.orbit.target[0] + 0.4,
  orbit.orbit.target[1] + 0.8,
  orbit.orbit.target[2]
);
```

`createOrbitEyeRig()` provides screen-plane panning as a standard interaction.
With the standard setup, `WebgApp` manages pointer connection, per-frame updates, and camera-state synchronization.
When constructing an `EyeRig` directly, call `attachPointer()` and `update(deltaSec)` to get consistent panning through pointer, touch, and keyboard input.

## First-person view: separate body direction from look direction

First-person mode combines a movable `base` with a final look direction that can differ from the direction of travel.
Despite its name, the camera can sit at a character's eyes or slightly behind, above, or to one side for an over-the-shoulder view. The character can keep moving forward while looking around.

The key design idea is to treat the body's or parent object's direction of travel separately from the direction the user is looking.
In `EyeRig`, `base` holds the body's position and orientation, `rod` holds eye height, and `eye` holds an independent look direction.

```text
base.position    = firstPerson.position
base.attitude    = body yaw / pitch / roll
rod.position     = [0, eyeHeight, 0]
rod.attitude     = identity
eye.position     = [0, 0, 0]
eye.attitude     = look yaw / pitch / roll
```

### What bodyYaw represents

`bodyYaw` is not the direction the camera currently looks. It is the rotation around the local Y axis of the body reference held by `base`.
The `EyeRig` camera faces local `-Z` and its right direction is local `+X`.
Thus, `bodyYaw` determines the horizontal direction of the body's local `-Z` axis.

```text
body forward = rotateY(bodyYaw) * [0, 0, -1]
body right   = rotateY(bodyYaw) * [1, 0, 0]
```

The reference directions are:

| bodyYaw | Body forward | Body right |
|---:|---|---|
| `0°` | `-Z` | `+X` |
| `90°` | `-X` | `-Z` |
| `180°` | `+Z` | `-X` |
| `-90°` | `+X` | `+Z` |

These are local directions relative to the parent of `base`. If the parent Node is rotated, its orientation is composed into the final world direction.

This also clarifies `bodyYaw: 180.0`.
If a character or vehicle model uses local `+Z` as forward, it initially faces opposite the camera body's local `-Z` forward direction.
Setting `bodyYaw` to 180 degrees aligns the camera body's forward direction with the model's `+Z` forward axis.
If the model also uses local `-Z` as forward, `bodyYaw: 0.0` is the matching starting value.

Choose the initial `bodyYaw` to match the parent model's forward axis. Check which local axis the model uses, then align it with the camera body's local `-Z`. During play, change `bodyYaw` relative to this initial alignment to turn the body left or right.

```js
const eyeRig = new EyeRig(app.cameraRig, app.cameraRod, app.eye, {
  document,
  element: app.screen.canvas,
  input: app.input,
  type: "first-person",
  firstPerson: {
    position: [1.0, 2.2, -4.0],
    bodyYaw: 180.0,
    bodyPitch: 0.0,
    bodyRoll: 0.0,
    lookYaw: 0.0,
    lookPitch: -8.0,
    lookRoll: 0.0,
    eyeHeight: 0.0,
    moveSpeed: 12.0,
    runMultiplier: 2.2
  }
});
eyeRig.attachPointer();

app.start({
  onUpdate: ({ deltaSec }) => {
    eyeRig.update(deltaSec);
  }
});
```

`firstPerson.position` is in local coordinates relative to the parent of `base`.
When `base` is a child of a character or vehicle, this value is the camera's mounting offset.
The example assumes the parent model faces local `+Z`: `[1.0, 2.2, -4.0]` offsets the mount right, up, and backward, while `bodyYaw: 180.0` aligns the camera body's local `-Z` forward with the parent's `+Z` forward.

`bodyYaw / bodyPitch / bodyRoll` apply to `base` and represent the reference direction of the body or mount.
`lookYaw / lookPitch / lookRoll` apply to `eye` and represent the final look direction independently of the body.

By default, horizontal pointer drag changes `lookYaw`, and vertical drag changes `lookPitch`.
`lookYaw` is an additional look angle relative to the body direction defined by `bodyYaw`. Movement follows `bodyYaw`, allowing the character to move forward while looking up or look sideways while continuing along the same heading.

When the application controls the character's movement and turns, move and rotate the parent object in the application. Let `EyeRig` handle the local camera mount and looking around.

For a free-moving camera, `W / A / S / D / Q / E` can update `firstPerson.position`.
`W` moves along the body's local `-Z` after `bodyYaw` rotation; `S` moves the opposite way. `D` moves along the body's local `+X`, and `A` in the opposite direction. `Q / E` move vertically.
Default WASD movement is calculated on the horizontal plane and separated from `bodyPitch / bodyRoll` and the independent look angles `lookYaw / lookPitch / lookRoll`.
The run input assigned to `Shift` increases movement speed according to `runMultiplier`.

Change the pose directly with `setPosition()`, `setAngles()`, and `setLookAngles()`:

```js
eyeRig.setType("first-person");
eyeRig.setPosition(0.0, 0.0, 12.0);
eyeRig.setAngles(180.0, 0.0, 0.0);
eyeRig.setLookAngles(0.0, -10.0, 0.0);
```

Here `setAngles()` controls the body direction and `setLookAngles()` controls the view (`eye`) direction.
Update them separately when character turns and user look controls use different input.

In `samples/eye_rig`, `base` sits behind, above, and to the right of a blue camera vehicle. The HUD (heads-up display) shows `bodyYaw` and `lookYaw` before and after a horizontal drag.
After dragging, `bodyYaw` remains fixed while `lookYaw` changes, demonstrating the separation between body direction and independent look direction.

## Follow view: separate the target from camera behavior

Follow mode smoothly keeps an independently moving target in view from a camera reference position controlled by the application.

A typical example is a camera mounted on a roller-coaster vehicle that tracks another vehicle ahead.
Even when both vehicles turn sharply, climb, descend, or jump, the camera keeps the target in view without suddenly switching to an unnatural angle.

The essential point is that Follow mode does not move the camera to the target's position.
The application sets the camera reference position through the parent hierarchy of `base`, `basePosition`, and `baseAttitude`.
The main value that Follow mode changes dynamically each frame is the local orientation of `eye`, so it looks at the target.

The Nodes have these roles:

```text
base.position    = reference position set by the application
base.attitude    = reference pose set by the application
rod.position     = [0, 0, 0]
rod.attitude     = reference composition set by the application
eye.position     = [0, 0, distance]
eye.attitude     = target-tracking pose * manual look correction
```

As in Orbit mode, the reference position of `eye` is offset by `distance` along the local `+Z` direction of `rod`.
The camera looks along the local `-Z` direction of `eye`.
`rod` holds a relatively stable composition chosen by the application: forward, diagonally forward, from the side, or from above.

```js
const followRig = new EyeRig(app.cameraRig, app.cameraRod, app.eye, {
  document,
  element: app.screen.canvas,
  input: app.input,
  type: "follow",
  follow: {
    targetNode: targetVehicle,
    targetOffset: [0.0, 2.3, 0.0],
    basePosition: [0.0, 2.2, -2.0],
    baseAttitude: [0.0, 0.0, 0.0],
    distance: 16.0,
    yaw: 0.0,
    pitch: -12.0,
    roll: 0.0,
    minDistance: 6.0,
    maxDistance: 40.0,
    response: 6.0,
    maxAngularSpeed: 240.0,
    upReference: "base"
  }
});
followRig.attachPointer();

app.start({
  onUpdate: ({ deltaSec }) => {
    followRig.update(deltaSec);
  }
});
```

### Target position and `targetOffset`

Specify the target with `targetNode`.
The target point is `targetOffset` in the target Node's local coordinates, transformed by its world matrix. An offset above or to one side of the origin follows the target's orientation as well as its position.

Use this when looking at a driver's seat instead of the center of a vehicle, or at a character's chest or head instead of its feet.
When the target Node rotates, the local offset follows it, so the camera tracks the same point on the object.

```js
followRig.setTargetOffset(0.0, 1.8, 0.0);
followRig.setTargetNode(nextTarget);
```

Calling `setTargetNode()` or `setTargetOffset()` resets tracking state.
The next `update(deltaSec)` calculates an initial pose from the new target direction, then continues following smoothly on later frames.

Follow mode reads the target's actual world position each frame and calculates the desired look direction. `base` remains the camera-side reference position.

### Calculate the tracking pose

Follow mode calculates its target pose in this order:

1. Transform `targetOffset` with `targetNode`'s world matrix to find the target point in world space.
2. Inverse-transform the `rod` world matrix to express the target point in `rod` local coordinates.
3. Calculate `forward` from the local position of `eye` toward the target point.
4. Transform the selected up direction into the same `rod` local coordinates.
5. Construct the orthogonal basis vectors `right`, `cameraUp`, and `back` from `forward` and up.
6. Convert the basis to the local quaternion for `eye`.
7. Spherically interpolate from the current tracking quaternion toward the target quaternion.

If the target and `eye` have the same position, the look direction has zero length and cannot be defined. `EyeRig` reports this as an exception.
Using an arbitrary unit vector would hide a configuration error, so `EyeRig` detects a zero-length tracking direction explicitly.

### Up direction and roll

Roll around the look direction also needs a reference `up` direction.
For vehicles with steep climbs, descents, or banking, specify which direction should count as camera-up with `upReference`.

```text
upReference = "base"   use base's world up direction
upReference = "rod"    use rod's world up direction
upReference = "world"  use world +Y
```

`"base"` uses the tilt of the vehicle carrying the camera. If it banks, the camera tracks the target with that banking included.
Use `"rod"` when the application's reference composition should define up.
Use `"world"` to follow the world's horizon independently of vehicle roll.

Given tracking direction `forward` and reference up `up`, the camera's `right` axis is conceptually calculated with a cross product:

```text
right = normalize(cross(forward, up))
cameraUp = cross(-forward, right)
```

If `forward` and `up` are parallel, their cross product is zero; if they are nearly parallel, it is too small to define a stable right axis. Choose another reference up direction to establish the initial roll.
This differs from Euler-angle gimbal lock: it is a singularity where the look-at basis is not uniquely defined before the target quaternion is created.

If this occurs in the initial pose, `EyeRig` raises an exception.
There is no previous orientation from which to inherit roll, so the application needs to provide another up direction or an initial placement.

If `forward` and `up` become nearly parallel temporarily after tracking starts, the right axis from the previous tracking pose is projected onto the new view plane.
This preserves the previous roll continuously and avoids a sudden switch of the auxiliary up direction that could rotate the camera by 90 degrees.
During continuous tracking, the previous pose is the reference state for roll continuity; a singular initial pose is reported explicitly.

### Frame-rate-independent pose interpolation

Smooth tracking comes from interpolating the look orientation rather than delaying the target position.
By default, the current target position is used directly as the look point. The orientation converges toward that point at the configured response rate, so it can briefly lag behind during sharp turns or jumps. Applications that need a smoothed virtual target can add one separately.

Spherical linear interpolation of quaternions blends the current pose toward the target pose.
The interpolation coefficient is:

```text
t = 1 - exp(-response * deltaSec)
```

A larger `response` turns toward the target faster; a smaller value converges more slowly.
Because the formula includes `deltaSec`, the perceived tracking speed remains relatively consistent as the frame rate changes.

`maxAngularSpeed` limits the maximum rotation per second so the view does not turn excessively fast when the target changes direction sharply.
`response` controls convergence toward the target; `maxAngularSpeed` sets an instantaneous rotation limit.

The first `update()` immediately looks at the target and establishes a valid initial pose; subsequent frames track it smoothly.
Call `resetFollowTracking()` to repeat the initial tracking setup after changing the target or mode.

### Reference composition and manual look correction

The relatively stable composition selected by the application is stored as yaw, pitch, and roll on `rod`.
The dynamic tracking orientation from Follow mode is stored as a tracking quaternion on `eye`.

This lets the application use `rod` to choose a composition such as forward, slightly right, or slightly downward. Follow mode then calculates the local `eye` pose needed to look at the target from that composition.

Look angles passed to `setLookAngles()` are retained as a correction separate from the automatic tracking quaternion and composed into the final `eye` orientation.
Keeping automatic tracking and manual input as separate corrections prevents the next frame's tracking calculation from competing with manual control.

### Follow-mode input and features handled elsewhere

By default, drag and arrow keys change the reference yaw and pitch of `rod`; the wheel, pinch, `[` and `]` change the reference distance of `eye`.
This is the mounting distance from `rod` to `eye`. World distance to the target is calculated separately from the target and camera positions.

Follow mode keeps the target near the center of the screen; panning is assigned to Orbit mode.
Using pan to move `targetOffset` or `base` would mix target-orientation tracking with camera-position following.
To move the camera itself behind the target, move the parent of `base` or its mount Node in the application.

For the same reason, Follow mode tracks the target's position without copying its yaw to `base`. Orbit mode handles orbiting around the target's position.
Combine Follow with an application hierarchy or position-following process when these additional behaviors are needed.

### Difference from WebgApp position following

`WebgApp.followNode()`, `lockOn()`, and `clearCameraTarget()` are also related to following.
They make the camera target and the reference position of `cameraRig` follow an object.

The Follow feature in `EyeRig` tracks orientation so the camera can keep looking at a target from an independent camera position.
`WebgApp.followNode()` updates position; `EyeRig` follow updates orientation.
When combining them, keep clear which process determines position and which determines look direction.

In `samples/eye_rig`, `base` is attached to a blue camera vehicle and tracks a separately moving orange target vehicle.
The HUD's `follow dot` is the dot product of the `eye` world-forward direction and the direction to the target; a value near 1 means the camera is looking accurately at it.
Press `U` to switch the up reference among `base`, `rod`, and `world`, and compare roll while banking.

## Connect focus targets to DoF

In a physical camera, view position, orientation, and the distance at which the lens focuses are part of the same shot.
In a 3D application, continuing to use a fixed `focusDistance` after zooming can move the focus plane away from the visible subject.
`EyeRig` therefore provides a `focus` setting to specify the target used by DoF.

`focus` has two responsibilities:

* `EyeRig.focus` selects a focus target and calculates its current distance in view space.
* `DofPass` or `ComputeEffectPipeline` uses that distance to calculate blur.

This separation lets Orbit, Follow, and FPS share the same camera-to-DoF connection without mixing camera input and the DoF algorithm into one class.
`EyeRig` does not enable DoF automatically; `focus.enabled` controls whether it supplies a focus distance.

### Focus on the Orbit target

For an exhibit or model viewer, it is natural to focus on the center of the Orbit view.
Set `mode: "camera-target"` to use the current Orbit target as the focus target.

```js
const orbit = app.createOrbitEyeRig({
  target: [0.0, 1.5, 0.0],
  distance: 10.0,
  yaw: 24.0,
  pitch: -12.0,
  focus: {
    enabled: true,
    mode: "camera-target"
  }
});
```

When Orbit panning changes `target`, `WebgApp` converts it to the current world position before calculating focus distance.
As zoom or rotation changes the distance between camera and target, the next `CameraFrame` receives the updated value.

### Focus on a moving Node

Use `mode: "node"` to focus on a moving ball or character separately from the camera's target.
`targetOffset` is in the Node's local coordinates, so it continues to identify the same point on the object as it moves and rotates.

```js
const orbit = app.createOrbitEyeRig({
  target: [0.0, 1.5, 0.0],
  distance: 18.0,
  focus: {
    enabled: true,
    mode: "node",
    targetNode: ballNode,
    targetOffset: [0.0, 0.0, 0.0]
  }
});
```

This keeps the Orbit center on the display stand while the focus plane follows the moving `ballNode`.
If the Node has not been created or `targetNode` does not provide `getWorldMatrix()`, `EyeRig` reports a configuration error during construction.

### Set focus distance for Follow and first-person views

In Follow mode, choose `camera-target` to focus on the current target point of `follow.targetNode`.
In FPS, it is useful to specify a distance straight ahead from the center of the screen; use `camera-forward`.
For example, place focus 1 m in front of the camera like this:

```js
const firstPerson = new EyeRig(app.cameraRig, app.cameraRod, app.eye, {
  document,
  element: app.screen.canvas,
  input: app.input,
  type: "first-person",
  focus: {
    enabled: true,
    mode: "camera-forward",
    distance: 1.0
  }
});
```

Use `world-point` with a world-space position in `targetPoint` to focus on a fixed exhibit or sign independently of the camera target or a Node.
`view-distance` focuses on a plane at a specified distance from the current camera without using an object's world position.

### Values passed from CameraFrame to DoF

After updating `EyeRig`, `WebgApp` creates a `CameraFrame` and calls `EyeRig.getFocusDistance(cameraFrame)` using that frame's camera pose.
The returned value is a view-space distance measured forward from the camera.
It is stored in `cameraFrame.focusDistance` and is also available as `context.cameraFocusDistance` in the same frame.
When camera focus is disabled, the result is `null`: the camera supplies no focus distance. DoF is configured separately, and the application can provide a fixed distance through its DoF settings instead.

To use camera-linked focus in the compute integration path, set DoF's `focusSource` to `"camera"`.
The default is `"explicit"`, which continues to use the numeric `focusDistance` from the DoF settings.
If `"camera"` is selected and `CameraFrame.focusDistance` is missing, an exception reports the incomplete configuration.

```js
import ComputeEffectPipeline from "./webg/ComputeEffectPipeline.js";

const pipeline = new ComputeEffectPipeline(app.getGPU(), {
  dof: {
    enabled: true,
    focusSource: "camera",
    focusRange: 5.8
  }
});
```

Manage `focusRange` and `blurRadius` as DoF settings. The camera determines the focus plane, and DoF determines how much of the surrounding area stays sharp.

## Switching modes and managing state

Orbit, first-person, and Follow modes each retain separate state.
`setType()` switches the active mode and applies that mode's state to `base`, `rod`, and `eye`.
Each mode keeps values according to its own meaning; switching applies the state explicitly associated with that mode to the three Nodes.

```js
eyeRig.setType("orbit");
eyeRig.setType("first-person");
eyeRig.setType("follow");
```

Because the roles of the three Nodes differ by mode, preserving world position and orientation during a transition requires the application to read the previous world transform and convert it into the local state of the new mode.
For example, Orbit's `target` and first-person `position` both map to `base.position`, but the first means a point of interest and the second means a body or mount position.

When continuous appearance matters, explicitly convert the previous world transform into the next mode's local state.
Automatically copying values with different meanings can hide issues, especially when the parent hierarchy differs or the Follow mode includes an automatic pose.

Immediately after switching to Follow, `EyeRig` looks at the target and establishes a valid initial orientation, then follows it smoothly on subsequent frames.
Changing the target performs the same initialization.

## Check the samples and tests

`samples/eye_rig` compares Orbit, first-person, and Follow modes along the same 3D course.
In addition to switching modes, it shows how the application's parent hierarchy and `EyeRig`'s local state combine into the final world view.

* In Orbit mode, press `H` to switch between a hierarchy that inherits camera-vehicle rotation and an independent camera anchor that shares position only.
* In first-person mode, check the HUD to see that `bodyYaw` stays the same while horizontal dragging changes `lookYaw`.
* In Follow mode, confirm that the `base` attached to the camera vehicle does not move to the target and that `follow dot` approaches 1.
* Press `U` to switch `upReference` among `base`, `rod`, and `world`, then compare roll behavior while banking.

Numerical conditions that do not require rendering can be checked in `headless_tests/core/eye_rig/headless_probe.js`.
It verifies that the Follow-mode `base` remains independent and that `targetOffset` is transformed locally.
It also checks separation of body direction and look direction in first-person mode, W/D movement for multiple `bodyYaw` values, Orbit panning beneath a rotating parent, and errors for a singular initial Follow pose.

## EyeRig helper methods

In addition to switching modes, `EyeRig` provides helpers for common operations:

* `setType(type)`: switch among `"orbit"`, `"first-person"`, and `"follow"`.
* `setDistance(distance)` / `setRodLength(length)`: change the `eye` mount distance in Orbit or Follow mode. Values outside the allowed range raise a configuration error.
* `setTarget(x, y, z)`: set the local position of `base`, the center of Orbit mode.
* `setTargetNode(node)` / `setTargetOffset(x, y, z)`: set the Follow target and a local look position within that target Node.
* `setAngles(...)`: change the orientation of `base` or `rod` to control the view foundation.
* `setLookAngles(...)`: change the independent look direction of `eye`, or the look correction composed with automatic tracking in Follow mode.
* `resetFollowTracking()`: reset the Follow quaternion and diagnostics so the next update recalculates the initial pose.
* `getFollowTargetWorldPosition()`: return the current world-space look point from `targetNode` and its local `targetOffset`.
* `getFocusReference()`: return the current world-space focus point or forward distance from the `focus` setting; return `null` when disabled.
* `getFocusDistance(cameraFrame)`: convert the focus target to a view-space distance for the current `CameraFrame`; return a positive distance or `null` when disabled.

Orbit's `setTarget()` and Follow's `setTargetOffset()` have similar names but different meanings.
`setTarget()` changes the `base` position in Orbit mode.
`setTargetOffset()` changes which part of a Follow target is viewed, while keeping the camera `base` as its own anchor.
Orbit panning changes the target through input, so use each method for the purpose of its mode.

## Implementation notes

Keep these points in mind when using `EyeRig`:

1. When constructing `new EyeRig(...)` directly, call `attachPointer()` once to connect input, then call `update(deltaSec)` each frame. `WebgApp.createOrbitEyeRig()` manages both input connection and updates for the standard Orbit mode.
2. Use `EyeRig` for position, orientation, and—when needed—the focus target; use `WebgApp` for the projection matrix and a DoF pass for blur processing.
3. For the standard Orbit setup, use `WebgApp.createOrbitEyeRig()` and let `WebgApp` synchronize input and camera state.
4. In first-person mode, check the relationship between the model's forward axis and local `-Z` to choose the initial `bodyYaw`.
5. Use `setAngles()` for the reference composition and `setLookAngles()` for an independent look correction.
6. To inspect a detail, combine target adjustment through panning with rotation rather than relying on rotation alone.
7. If an editor uses left drag for selection, move camera dragging to another button with `dragButton: 1`, and provide an alternate gesture for macOS with `alternateDragButton` and `alternateDragModifierKey`. Alt / Option is used for roll by default; assign another `rollModifierKey` if the alternate gesture should orbit instead.
8. Change field of view or `near / far` through `WebgApp.viewAngle` and `updateProjection()`.
9. If `base` has a rotating parent, keep Orbit targets and pan offsets in local coordinates and let the parent-child matrices convert them to world coordinates.
10. Keep the Follow camera base and target independent. If camera position following is needed, assign it to an application-side mount Node or to `WebgApp.followNode()`.
11. Check that the initial Follow direction is not parallel to `upReference`.

`EyeRig` controls where the view is placed and which direction it faces. Projection and display layers control how the view is rendered.
Keeping these responsibilities separate makes camera issues easier to trace.

`WebgApp.init()` creates the standard `cameraRig`, `cameraRod`, and `eye` Nodes automatically.
The root-level standard Orbit mode can use this hierarchy directly.
For a camera that inherits a vehicle's rotation, or shares its position without inheriting rotation, the application chooses a suitable parent for `base`.
Decide whether a custom hierarchy is needed by identifying which movement and rotations the camera should inherit.

## Summary

The main idea is to treat `EyeRig` as a camera-control helper rather than as the camera itself.
The view is the `eye` Node set by `Space.setEye(node)`. `EyeRig` assigns the `cameraRig`, `cameraRod`, and `eye` hierarchy a semantic control model.
This shared structure supports orbiting around a target, first-person views with separate body and look directions, and following a target.

`EyeRig` manages position, orientation, and the focus target passed to DoF.
`WebgApp` manages field of view and projection through `viewAngle`, `projectionNear`, `projectionFar`, and `updateProjection()`. The DoF pass performs blur.
“Where to place the camera,” “what to focus on,” and “how to render the view” are separate responsibilities.
Understanding this separation helps isolate camera issues in complex scenes.

Chapter 07 introduces shaders and materials, the visual layer built on top of camera controls.
