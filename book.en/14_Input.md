# Touch Controls and Input

This chapter organizes input from keyboards, mice, touchscreens, and pens into two forms: states that remain active while held, and actions that occur once. `InputController` gathers device events and maps them to shared application actions so desktop and mobile devices can use the same game logic. With this structure, key bindings and gestures can change while application behavior remains stable.

## How to read this chapter

### Prerequisites

This chapter is easier to follow if you know `WebgApp` from Chapter 5 and the differences among browser keyboard, mouse, and touch events.

### What to read first

Start with `InputController`, keyboard normalization, `Touch`, and the distinction between hold input and action input.

### What to read when you need it

Refer to `attachSurface()`, gestures, direct use of `Touch`, and mobile layouts when implementing specialized controls.

### What you will learn

You will be able to map desktop and mobile input to the same actions and organize scene controls separately from UI controls.

## Map Different Inputs to Shared Actions

Keyboards, mice, pens, and touchscreens produce different events. Instead of wiring each event directly to game logic, convert them to shared key states or actions. This allows the same movement or command to work across devices. This chapter selects among three input approaches: virtual buttons, gestures on a canvas, and temporary commands.

Choose among these three patterns for input UI (the interface for interaction and display):

- **Virtual buttons held down**
  - API (Application Programming Interface): `InputController.installTouchControls()`
  - Use for movement, turning, and continuous operations
- **Gestures on a canvas surface**
  - API: `Touch.attachSurface()` and pointer handlers
  - Use for orbiting, panning, pinching, and direct editing
- **Temporary commands or settings**
  - API: `CommandPalette`, `OverlayPanel`
  - Use for infrequent toggles and confirmation actions

Normalize keyboard, mouse, pen, and touch input to common key or action states wherever possible instead of connecting each device to separate game logic.

## Touch Input Design

Touch input in `webg` is about designing the path from a physical gesture to a key state or action, as well as positioning buttons on screen. This chapter focuses on `webg/Touch.js` and `webg/InputController.js` and shows how to build responsive controls that feel natural.

On mobile devices and other coarse-pointer environments, users interact with a fingertip rather than a precisely positioned pointer. Ease of pressing a control and prompt feedback directly affect the experience. Design the path by which input reaches the application along with the visual appearance of the UI.

Chapter 12, “UI Display Design,” discusses how to choose display components. Chapter 15, “Collision and Queries,” explains how to determine which point in 3D space an input reaches.

## Responsibilities of the Input Components

Understand the separate roles of `Touch`, `OverlayPanel`, `CommandPalette`, and `InputController` before combining them.

### `Touch`: Low-Level Input Interface

`Touch` creates virtual buttons in the DOM (Document Object Model) outside the canvas. Its central role is to relay physical touch input through callbacks such as `onPress`, `onRelease`, and `onAction` to the application's key states or actions. Virtual buttons therefore act as an alternative to keyboard input.

### `OverlayPanel`: UI for Scene Tasks

`OverlayPanel` can also contain buttons and choices, but it is intended for interactive UI attached to the scene, such as explanations, menus, and dialogue. `Touch` provides virtual buttons that replace keys such as `ArrowLeft` or `R`. Use `OverlayPanel` for readable panels and contextual actions, and `Touch` for virtual-key input.

### `CommandPalette`: Temporary Controls

`CommandPalette` provides a compact command UI for canvas-centered applications. It is distinct from the readable content in `OverlayPanel` and the always-visible virtual keys in `Touch`. Users open it only when needed by double-clicking, double-tapping, or pressing a key, then change a setting quickly.

`CommandPalette.attachToCanvas()` registers open and close behavior for desktop double-clicks, touch double-taps, and a specified key. This launch path is independent of `Touch` and `InputController.installTouchControls()`. Add a `CommandPalette` alongside fixed touch buttons when desktop and mobile users should share the same temporary UI.

```js
import CommandPalette from "../../webg/CommandPalette.js";

const canvas = document.getElementById("canvas");
const state = {
  grid: true
};

const palette = new CommandPalette({
  document,
  container: document.body,
  viewport: canvas,
  commands: [
    { id: "reset", label: "Reset", detail: "camera" },
    { type: "toggle", id: "grid", label: "Grid", detail: "toggle", value: () => state.grid }
  ],
  onCommand: (id) => {
    if (id === "reset") resetCamera();
  },
  onChange: (id, value) => {
    if (id === "grid") state.grid = value;
  }
});

palette.attachToCanvas(canvas, {
  key: "/"
});
```

### `InputController`: High-Level Input Management

`InputController` integrates input from sources such as the keyboard, touch buttons, and gestures.

In a standard setup, `InputController.installTouchControls()` manages touch input. Continuous input updates `keyState`; one-shot input goes through `pulseAction()`. This normalization lets the application use shared conditions without checking which device produced the input. Control `Touch` directly only when a specialized input representation is needed.

`pulseAction()` is a temporary action state for operations such as reset, confirm, or mode change that should respond once per press. Use it for commands that should not repeat while a button remains held.

## Core Input Design Principles

### 1. Separate Hold Input and Action Input

Separate hold input, which remains active during movement, rotation, or view control, from action input, which responds once to a reset, confirmation, or pause command. This keeps the processing flow simple as controls are added.

### 2. Normalize Key Names

Keyboard handling uses key names normalized by `InputController.normalizeKey()` rather than raw `event.key` values. Ordinary letter keys are lowercased; special keys such as `Space` and `Escape` become `space` and `escape`. Using the same normalized names for touch buttons allows both input sources to use the same conditions.

### 3. Abstract the Input Path

Design application logic to react to an action rather than a physical key. This makes the application easier to adapt when devices or key bindings change.

## Standard Integration Steps

In a standard setup, normalize keyboard input first, then connect `Touch` buttons and gestures to the same actions. Connecting one input source at a time makes it easier to distinguish device events from application state updates and to diagnose an action that works on only desktop or mobile.

### Attach and Normalize Keyboard Input

Use `InputController.attach()` to enable keyboard input. Key names pass through `normalizeKey()` internally. Compare the normalized name rather than the raw `event.key`.

For example, `Space` is reported as `space` rather than a literal space, and `Esc` becomes `escape`. Use these names when keyboard and touch input share a condition.

#### Special Key Names

This table maps browser `KeyboardEvent.key` values to names used by `InputController`. Application code compares against the right column.

| `KeyboardEvent.key` | Name used by webg |
|---|---|
| `" "` / `Spacebar` | `space` |
| `Escape` / `Esc` | `escape` |
| `Enter` | `enter` |
| `Tab` | `tab` |
| `Backspace` | `backspace` |
| `Delete` | `delete` |
| `Shift` | `shift` |
| `Control` | `control` |
| `Alt` | `alt` |
| `Meta` | `meta` |
| `Home` / `End` | `home` / `end` |
| `PageUp` / `PageDown` | `pageup` / `pagedown` |
| `ArrowLeft` | `arrowleft` |
| `ArrowRight` | `arrowright` |
| `ArrowUp` | `arrowup` |
| `ArrowDown` | `arrowdown` |
| `F1`–`F12` | `f1`–`f12` |

`InputController` uses `KeyboardEvent.key` and handles the entered digit value. To distinguish a physical numpad key such as `Numpad0`, read `KeyboardEvent.code` in the application.

These modifier names can be checked with `InputController.has()`. `EyeRig.panModifierKey` accepts both `control` and `ctrl` for the Control key; the name stored from browser events by `InputController` is `control`.

### Install Touch Controls

Next, call `installTouchControls()` to add `Touch`. Hold buttons update state through `press()` / `release()`. Action buttons update a temporary action state through `pulseAction()`.

```js
import InputController from "./webg/InputController.js";

const input = new InputController(document);

input.attach({
  onKeyDown: (key) => {
    if (key === "escape") {
      pauseGame();
    }
  }
});

input.registerActionMap({
  reset: "r"
});

input.installTouchControls({
  touchDeviceOnly: false,
  autoSpread: true,
  groups: [
    {
      id: "move",
      buttons: [
        { key: "arrowleft", label: "←", kind: "hold", ariaLabel: "move left" },
        { key: "arrowright", label: "→", kind: "hold", ariaLabel: "move right" }
      ]
    },
    {
      id: "turn",
      buttons: [
        { key: "a", label: "A", kind: "hold", ariaLabel: "turn left" },
        { key: "d", label: "D", kind: "hold", ariaLabel: "turn right" }
      ]
    },
    {
      id: "action",
      buttons: [
        { key: "r", label: "R", kind: "action", ariaLabel: "reset" }
      ]
    }
  ]
});

function update() {
  if (input.has("arrowleft")) moveLeft();
  if (input.has("arrowright")) moveRight();
  if (input.has("a")) rotateLeft();
  if (input.has("d")) rotateRight();

  if (input.wasActionPressed("reset")) {
    resetPlayer();
  }
}
```

The application reads the same state and actions whichever input source the user chooses. Use `input.has()` for continuous operations and `wasActionPressed()` for a one-shot command.

`InputController.registerActionMap()` also connects key names to action names, allowing the application to use one action vocabulary across devices.

## Gestures for Spatial Input on the Canvas

For mobile scene interaction, use pointer events on the canvas as gestures in addition to virtual buttons.

Virtual buttons replace a specific command or key; canvas gestures represent spatial operations such as rotation, zoom, and pan. Since they serve different roles, manage them separately.

### Steps for Implementing Spatial Gestures

Build canvas gestures in this order: disable conflicting browser defaults, track pointers, interpret movement, then apply it to a camera or object. Separating these steps allows page-scroll behavior and 3D calculations to be tuned independently while the same gesture recognition works for mice and touch.

1. Set `canvas.style.touchAction = "none"` so browser scrolling and pinch behavior do not interfere with canvas interaction.
2. Track pointers with `pointerdown`, `pointermove`, `pointerup`, and `pointercancel`, distinguishing one-finger from multi-finger input.
3. Convert one-finger drag deltas (`dx` / `dy`) to camera yaw and pitch.
4. For two-finger drags, convert the center movement to camera-target panning and the change in finger distance to zoom.
5. To distinguish a tap from a drag, set a movement threshold and treat `pointerup` as a tap only when the threshold was not exceeded.

Continuous spatial operations depend strongly on each application's camera controls, so implement them as needed. Discrete gestures such as taps and flicks can share `Touch.attachSurface()`.

### Coordinate Touch Gestures and Mouse Input

`Touch` treats touch, mouse, and pen as shared input. Its key benefit is that browser Pointer Events provide one entry point for these devices and deliver common gesture data to the application.

DOM code often handles `touchstart` and `mousedown` separately, which can lead to inconsistent conditions and timing across devices. `Touch.attachSurface()` handles them through pointer events so tap, double-tap, long-press, and flick recognition can share one implementation.

A short smartphone tap can then use the same logic as a desktop click, a double-tap the same logic as a double-click, and a long-press the same logic as holding a mouse button. Development can focus on the gesture rather than the device type.

### Efficient Gesture Debugging

Adjusting mobile interaction only on a physical device slows the development loop. Sending PC browser input through the same gesture path lets developers use browser tools and breakpoints to tune the behavior quickly.

`Touch` separates device capability detection from pointer-type filtering:

- `touchDeviceOnly` determines whether to enable the feature only on a device with a coarse pointer.
- `touchOnly` determines whether to ignore events whose `pointerType` is not `"touch"` after registration.

To test mobile-style gestures with a mouse in a PC browser, set `touchDeviceOnly: false` on both the `Touch` instance and `attachSurface()`, and set `touchOnly: false` on `attachSurface()`:

```js
const touch = new Touch(document, {
  touchDeviceOnly: false
});

touch.attachSurface(canvas, {
  touchDeviceOnly: false,
  touchOnly: false,
  onGesture: (gesture) => {
    console.log(
      gesture.type,
      gesture.pointerType,
      gesture.dx,
      gesture.dy
    );
  }
});
```

This lets a PC mouse trigger `tap`, `doubletap`, `longpress`, and `flick`, making it easier to reproduce and fix issues before testing on a device.

## Advanced Gestures with `attachSurface()`

On a small phone screen, many virtual buttons leave little room for the scene. Canvas gestures are particularly useful in applications with many modes, such as modelers and editing tools.

`Touch.attachSurface()` detects taps, double-taps, long-presses, and flicks from Pointer Events on a chosen element. It registers listeners on that element rather than the entire `window`, limiting interaction with page scrolling and other UI.

```js
import Touch from "./webg/Touch.js";

const touch = new Touch(document, {
  touchDeviceOnly: false
});

touch.attachSurface(canvas, {
  touchDeviceOnly: false,
  touchOnly: false,
  minDistance: 50,
  longPressTime: 500,
  longPressMoveTolerance: 10,
  doubleTapTime: 320,
  onGesture: (gesture) => {
    if (gesture.type === "flick") {
      console.log(`flick ${gesture.direction}`);
    }
    if (gesture.type === "longpress") {
      console.log("open command palette");
    }
    if (gesture.type === "doubletap") {
      console.log("toggle mode");
    }
  }
});
```

### Implementation Notes

Gesture options and callback names can be misspelled while remaining valid JavaScript. Check that the intended threshold and event path are active, rather than checking only whether an event occurred. The following points help avoid misleading default behavior and duplicate input handling.

- **Use exact option names**: Use API names such as `longPressTime` and `doubleTapTime` exactly. A misspelled option may leave the default in effect, making the intended threshold appear to work when it has not been applied.
- **Register gesture listeners first**: If normal `pointerdown` / `pointerup` handling also selects items on the canvas, register surface-gesture listeners first. Otherwise selection changes may occur while waiting to determine whether the input is a double-tap.
- **Manage browser defaults**: `setTouchActionNone` defaults to `true`, suppressing scrolling and pinch gestures on the target. Limit the gesture area appropriately when the rest of the page should still scroll.

#### Gesture Data

`onGesture` receives these main fields:

| Property | Meaning |
|---|---|
| `type` | `tap` / `doubletap` / `longpress` / `flick` |
| `direction` | For a `flick`: `left` / `right` / `up` / `down` |
| `x`, `y` | Client coordinates at `pointerup` or recognition time |
| `startX`, `startY` | Client coordinates at `pointerdown` |
| `dx`, `dy` | Movement from the start position |
| `distance` | Movement distance |
| `elapsedMs` | Time elapsed since input began |
| `pointerType` | Pointer kind such as `touch`, `mouse`, or `pen` |

### Example: Input Design in `mmodeler`

`samples/mmodeler` is an example of a mobile-oriented interaction model that can also be tested in a PC browser. It uses a single canvas for multiple stateful interactions:

- Select objects, vertices, and faces
- Open the command palette with a double-tap
- Switch between Object and Edit modes with a long-press
- Preview transforms with `G` / `R` / `S` / `E`
- Begin a box selection by dragging immediately after a double-tap

Small timing differences can significantly change these interactions. For example, if the first tap immediately finalizes a selection, the selection may change before the double-tap is recognized.

Testing such timing only on a device is difficult, so `mmodeler` also sends PC mouse input through the shared `Touch.attachSurface()` flow. Developers can inspect `gesture.pointerType` and `elapsedMs` in browser tools while tuning the mobile interaction conditions.

### Input Layers in a Mobile Editor

For applications with many features, organize input into four layers:

1. **Always-visible buttons**: Keep these to the most important and frequently used actions, and place them where they are easy to press.
2. **Supporting UI**: Collect infrequent operations in an `OverlayPanel` or `CommandPalette`.
3. **Gesture shortcuts**: Offer flicks and double-taps as efficient shortcuts for experienced users.
4. **Context menus**: Use a long-press as an entry point for extra actions or settings at that location.

Keep a button or menu path for every important action so gestures are not the only way to use it. For example, `unittest/flick` checks vertex selection by tap, mode change by double-tap, opening a command palette by long-press, tool changes by horizontal flick, and duplication or deletion by vertical flick.

## Direct Use and Detailed Options of `Touch`

For isolated feature checks or a minimal example, use `Touch` directly without `InputController`.

```js
import Touch from "./webg/Touch.js";

const keyState = new Set();

const press = (key) => {
  keyState.add(String(key).toLowerCase());
};

const release = (key) => {
  keyState.delete(String(key).toLowerCase());
};

const touch = new Touch(document, {
  touchDeviceOnly: false
});

touch.create({
  autoSpread: true,
  groups: [
    {
      id: "move",
      buttons: [
        { key: "arrowleft", label: "←", kind: "hold" },
        { key: "arrowright", label: "→", kind: "hold" }
      ]
    },
    {
      id: "action",
      buttons: [
        { key: "r", label: "R", kind: "action" }
      ]
    }
  ],
  onPress: ({ key }) => press(key),
  onRelease: ({ key }) => release(key),
  onAction: ({ key }) => {
    if (key === "r") {
      resetPlayer();
    }
  }
});
```

This direct form does not use `InputController.normalizeKey()` or its action map, so the application must normalize key names itself. `InputController.installTouchControls()` is the safer option for a typical application.

Use `createActionButtons()` to create a group containing only action buttons. It creates every button with `kind: "action"`, which is convenient for a menu of one-shot commands.

### Layout and Display

The root element for `Touch` is fixed to the bottom of the screen. The standard CSS uses `left: 0`, `right: 0`, and `bottom: 0` and accounts for the device's `safe-area-inset`.

- **Button density**: `applyDensitySize()` adjusts button dimensions according to the total count while preserving readability and ease of pressing.
- **Layout mode**: The layout switches among one row, multiple rows, and a spread arrangement based on the screen width and button count. With `autoSpread: true`, groups spread left and right according to available space.

### Main Options

Use options to fit recognition time and distance to the device and interaction. Start with the gestures the application needs—tap, long-press, double-tap, or drag—then adjust their thresholds.

#### `Touch` Instance Options

These options control display and appearance of the virtual buttons as a group:

- `touchDeviceOnly`: Defaults to `true`. Use this to show the controls only on coarse-pointer devices. Set it to `false` for PC testing.
- `force`: Set to `true` to show the UI regardless of device detection.
- `className`: Adds a custom class to the root for CSS adjustments. For a command palette that uses the default background, border, and shadow, the corresponding class is `command-palette surface`.
- `onAnyPress`: Runs when any button is first pressed, for example to detect the first user input.

#### `attachSurface()` Options

These options control how taps, long-presses, and flicks are recognized on a canvas or other surface. Adjust gesture thresholds separately from button display settings.

- `touchDeviceOnly`: Enables surface gestures only on coarse-pointer devices.
- `touchOnly`: When `true`, accepts touch pointers and ignores mouse and pen.
- `minDistance`: Minimum distance recognized as a flick.
- `longPressTime`: Duration recognized as a long-press.
- `longPressMoveTolerance`: Movement allowed during a long-press.
- `tapMoveTolerance`: Movement allowed for a tap.
- `doubleTapTime`: Maximum interval between taps recognized as a double-tap.
- `doubleTapDistance`: Maximum distance between the two taps.
- `preventDefault`: Calls `preventDefault()` for pointer events on the target.
- `setTouchActionNone`: Sets the target's `touch-action` to `none`.
- `onGesture`: Receives all gestures.
- `onFlick` / `onLongPress` / `onDoubleTap` / `onTap`: Type-specific callbacks.

`preventDefault` and `setTouchActionNone` affect browser behavior. Apply them to the `canvas` or a dedicated interaction surface. Applying them to normal form controls or scroll areas can interfere with browser interactions.

Call `detachSurface()` or `destroy()` to remove surface listeners and long-press timers.

## Implementation Guidelines

Choose the component according to its role:

- **Share input logic across sources** → use `InputController`.
- **Check the basic behavior of buttons in isolation** → use `Touch` directly.
- **Build an interactive panel or menu on the scene** → use `OverlayPanel`.
- **Offer temporary commands or simple settings on the canvas** → use `CommandPalette`.
- **Present dialogue or a tutorial** → combine `OverlayPanel` with an application-side controller.
- **Explain the meaning of touch buttons** → pair them with `Message` or a `WebgApp` help helper.

### Common Issues and Their Remedies

Input problems can come from mismatched names, unreleased held states, or duplicate handling of one pointer as well as from missing events. Check these common issues before changing unrelated sensitivity settings:

- **Key comparison**: Compare normalized names from `InputController` rather than raw `event.key`. Some keys, such as `Space`, need more than lowercasing.
- **Input categories**: Classify continuous movement as hold input and one-time reset or confirmation as action input.
- **Direct action handling**: Completing a command only in a touch button's `onAction` can disconnect it from keyboard input. For shared actions, use `registerActionMap()`, `pulseAction()`, and `wasActionPressed()`.
- **Gesture-only controls**: Provide a button or menu path for important actions alongside flicks and long-presses.
- **Input scope**: Attach gesture listeners to an explicit element such as `canvas` or a dedicated surface rather than all of `window`.
- **Component purpose**: Use `Touch` for input replacement, `OverlayPanel` for readable panels, and `CommandPalette` for temporary commands and simple settings.
- **User guidance**: Explain touch-button functions with `Message` or another guide so users understand their purpose.

## Summary

Deliver input to the application as continuous states and one-shot actions rather than physical-device names. Centralizing normalization in `InputController` lets keyboards, mice, touchscreens, and pens share the same controls.

Use `Touch` for virtual buttons and `attachSurface()` for canvas gestures. Put explanatory text and menus in `OverlayPanel` or `CommandPalette`. Separating input generation from text and command presentation makes behavior easier to predict as devices are added.
