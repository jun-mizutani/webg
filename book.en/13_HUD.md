# HUDs and Overlays

This chapter implements the selection criteria from Chapter 12: an always-visible HUD, a `CommandPalette` opened when needed, and an `OverlayPanel` for longer text. It explains how text is drawn after the 3D scene and post-processing, and how to keep input and pause state consistent as panels open and close. The examples separate display work from input-state updates so UI can be added safely.

## How to read this chapter

### Prerequisites

This chapter is easier to follow if you know the UI selection criteria in Chapter 12 and the frame processing of `WebgApp` in Chapter 5.

### What to read first

Start with the roles and connections among HUD (heads-up display), `CommandPalette`, `Text`, `Message`, and `OverlayPanel`.

### What to read when you need it

Refer to the combined UI sections for layout, themes, embedded views, modal behavior, and pausing a scene.

### What you will learn

You will be able to place always-visible, temporary, and long-form UI over a 3D scene and connect it to application state.

## Give HUDs and Overlays Separate Roles

A HUD puts a score or short status value on the canvas. A DOM overlay builds longer text, settings, and groups of controls from HTML elements. This chapter covers the structure and update flow of `Text`, `Message`, `CommandPalette`, and `OverlayPanel`, then shows how to combine them according to the displayed content.

Chapter 12 presented UI selection from the user's point of view: `Message` for concise status, `OverlayPanel` for text to read, `Diagnostics` / `DebugDock` for investigation records, and `Touch` for touch input. This chapter turns those guidelines into implementation. It focuses on the options, updates, placement, and modal behavior of `CommandPalette`, the GPU-rendered HUD (`Text` / `Message`), and the DOM (Document Object Model) `OverlayPanel`. Chapter 14 covers input gestures.

The following sections explain the technical distinction between the canvas HUD and DOM overlay, trace the drawing path from `Text` to `Message`, and show how to build and manage `CommandPalette`. They also cover the DOM structure of `OverlayPanel`, how options affect it, which overlay responsibilities belong to `WebgApp`, and how themes and embedded layouts are handled. The final sections offer implementation checks and relevant unit-test references.

## Display Surfaces and Design Rationale

The UI paths in `webg` are easiest to understand by looking at the surface on which each one is rendered.

**Canvas HUD (`Text`, `Message`)**

- **Implementation**: Text quads (rectangular polygons) rendered with WebGPU
- **Characteristics**: Lightweight updates and integrated rendering with the scene; suited to short Latin text, numbers, and symbols
- **Best suited to**: Short status information

**DOM overlays (`OverlayPanel`, `CommandPalette`, `DebugDock`, `Touch`)**

- **Implementation**: HTML elements (DOM)
- **Characteristics**: Unicode text, variable-width fonts, buttons, scrolling, and focus management
- **Design considerations**: Manage layout and stacking above the 3D scene, and keep DOM updates proportional to the need

A canvas HUD shares the 3D rendering pipeline and is suitable for values such as a score or status that change every frame. Its supported characters depend on the font atlas; the standard HUD focuses on short Latin text, numbers, and symbols. Choose a DOM overlay for multilingual and longer text because it can use the browser's typography.

A DOM overlay can use browser text layout directly, including multilingual typography, variable-width fonts, buttons, scrolling, and accessibility features. It is a separate layer over the canvas, rather than part of the 3D scene, so place it carefully to keep important scene content visible.

These technical differences explain why `Message` and `OverlayPanel` have distinct roles. `CommandPalette` is also a DOM overlay, but serves a different purpose: `OverlayPanel` lets users read help or an error report, while `CommandPalette` is a compact control surface for infrequent commands and settings that users open only when needed.

## Build and Manage a `CommandPalette`

In a full-canvas editor or viewer, a permanent menu bar can reduce the available working area. A palette that opens temporarily on a double-click or key press can be a better fit. `CommandPalette` creates its DOM and detects input; the application keeps the state of the scene and effects. The palette serves as an entry point that reads current values and reports user actions.

### Create and Attach It to a Canvas

For a minimal setup, pass `document`, the DOM `container`, the interaction `viewport`, and `commands` to the constructor. It prepares the DOM and default CSS. Call `attachToCanvas()` to register open and close events for double-click, double-tap, and a specified key.

```js
import CommandPalette, {
  getDefaultCommandPaletteCss
} from "../../webg/CommandPalette.js";

const canvas = document.getElementById("canvas");
const state = {
  shadow: true,
  radius: 18,
  brush: "Draw"
};

const palette = new CommandPalette({
  document,
  container: document.body,
  viewport: canvas,
  title: "Tools",
  className: "command-palette surface",
  closeOnCommand: false,
  onCommand: (id) => {
    if (id === "reset-camera") {
      resetCamera();
    }
  },
  onChange: (id, value) => {
    if (id === "shadow") state.shadow = value;
    if (id === "radius") state.radius = value;
    if (id === "brush") state.brush = value;
  },
  commands: [
    { id: "reset-camera", label: "Reset", detail: "camera" },
    { type: "toggle", id: "shadow", label: "Shadow", detail: "toggle",
      value: () => state.shadow },
    { type: "stepper", id: "radius", label: "Radius",
      value: () => state.radius, min: 8, max: 64, step: 2, input: true },
    {
      type: "select",
      id: "brush",
      label: "Brush",
      value: () => state.brush,
      options: [
        { value: "Draw", label: "Draw" },
        { value: "Blur", label: "Blur" },
        { value: "Grab", label: "Grab" }
      ]
    }
  ]
});

palette.attachToCanvas(canvas, {
  key: "/"
});
```

In this example, a double-click opens the palette near the pointer, while `/` opens it at the center of the viewport. The class name `command-palette surface` applies the default background, border, and shadow, keeping the panel readable over bright scenes. Drag the title bar to move the open palette. Since only the title bar is a drag handle, moving the panel is easy to distinguish from its buttons and controls. Set `draggable: false` in the constructor to keep its position fixed.

Restrict how the palette opens with `doubleClick: false`, `doubleTap: false`, or `key: null`. You can also control it directly with `open()`, `close()`, and `toggle()`.

### Choose Controls and Manage Their State

Give each item in `commands` an `id` that identifies the action. `label` is the main text shown in the row or button; `detail` is a short note below it. Select `type` according to the interaction:

- **Button (`button`)**: Runs a one-time action such as resetting a camera or saving a file. A click calls the palette-level `onCommand` and, when defined, the item's `onSelect`.
- **Toggle (`toggle`)**: Changes a boolean state such as grid visibility. Pass a function as `value` to return the current state; the new value is reported to `onChange` after interaction.
- **Stepper (`stepper`)**: Adjusts values such as brush radius or effect strength. Set the allowed range with `min` / `max` and the increment with `step`. Add `input: true` to show a field for direct keyboard entry.
- **Select (`select`)**: Chooses among known values, such as a brush or display mode. Pass a function returning the current `value`, and provide `{ value, label }` entries in `options`. Each click advances to the next option and reports the selected value to `onChange`.

For `toggle`, `stepper`, and `select`, `value` normally reads the current value held by the application. Update that state in a shared `onChange` or an item-specific handler.

To choose one mode from several buttons, combine `modeSwitch: true` with `getCommandState()`. Set `modeSwitch` on the buttons and use `getCommandState()` to determine which button is active.

```js
const state = { mode: "object" };

const palette = new CommandPalette({
  document,
  container: document.body,
  viewport: canvas,
  className: "command-palette surface",
  closeOnCommand: false,
  getCommandState: (id) => ({
    active: id === `mode-${state.mode}`
  }),
  onCommand: (id) => {
    if (id === "mode-object") state.mode = "object";
    if (id === "mode-edit") state.mode = "edit";
  },
  commands: [
    { id: "mode-object", label: "Obj", detail: "mode", modeSwitch: true },
    { id: "mode-edit", label: "Edit", detail: "mode", modeSwitch: true }
  ]
});
```

The default for `closeOnCommand` is `true`. Closing after a one-time command is usually appropriate; set it to `false` when users will change several settings in succession.

### Pages and Style Customization

Set `pageRows` to specify a page height in rows. Buttons and toggles use one cell; steppers and selects use a full row. `pageRowsByPage` overrides the row count for each page. Pages are created automatically to fit the commands, but the basic way to move between them is an explicit `id: "palette-next"` button defined by the application. Include `palette-next` on each page of a multi-page palette so users can move forward.

```js
const palette = new CommandPalette({
  document,
  container: document.body,
  viewport: canvas,
  className: "command-palette surface",
  pageRows: 2,
  pageRowsByPage: [2, 1],
  commands: [
    { id: "select", label: "Sel", detail: "tool" },
    { id: "move", label: "Move", detail: "tool" },
    { id: "rotate", label: "Rot", detail: "tool" },
    { id: "scale", label: "Scale", detail: "tool" },
    { id: "brush", label: "Brush", detail: "tool" },
    { id: "erase", label: "Erase", detail: "tool" },
    { id: "snap", label: "Snap", detail: "toggle" },
    { id: "palette-next", label: "Next", detail: "page", pageSwitch: true },

    { id: "view-front", label: "Front", detail: "view" },
    { id: "view-top", label: "Top", detail: "view" },
    { id: "view-side", label: "Side", detail: "view" },
    { id: "palette-next", label: "Next", detail: "page", pageSwitch: true }
  ]
});
```

`palette-next` is a special ID that calls `nextPage()` and wraps from the last page to the first. `pageSwitch: true` applies the page-switch button style.

`CommandPalette` also provides these supporting defaults. `titleTapCyclesPage` defaults to `true`, so tapping or clicking the title cycles pages. `resetPageOnOpen` also defaults to `true`, opening the palette on page one each time. If there are multiple pages and the current page lacks `palette-next` while space remains, the palette supplies a `Next` button internally. This fallback keeps page navigation available; defining `palette-next` on each page makes the layout and intended action clear to users.

The palette injects default styles. Replace the complete CSS with `setStyle()` or change colors with `setTheme()`. To preserve the default layout while changing a few rules, append custom CSS to `getDefaultCommandPaletteCss()`:

```js
const compactPaletteCss = `${getDefaultCommandPaletteCss()}
.command-palette {
  width: 300px;
}

.palette-button,
.palette-control-button,
.palette-select-button {
  border-radius: 6px;
}

.palette-button {
  height: 42px;
}
`;

palette.setStyle(compactPaletteCss);
```

Call `destroy()` when the palette is no longer needed; it removes event listeners and the DOM together.

```js
window.addEventListener("pagehide", () => {
  palette.destroy();
}, { once: true });
```

## `Text`, `Message`, and the Drawing Path

`Text` is a low-level class for drawing a character grid on the GPU. It manages character positions and codes, scale, color, and font texture, then renders each character as a quad (rectangular polygon).

`Message` wraps `Text` as a higher-level HUD manager. Register strings as blocks with an `id`, then place them with options such as `anchor` and `width`.

```js
app.message.setLines("status", [
  "mode=orbit",
  "debug=off"
], {
  anchor: "top-left",
  x: 0,
  y: 0
});
```

`Message` offers `setLine()` for one line, `setLines()` for several lines, and `setBlock()` for explicit block management. Its main advantage is that each block can be updated by `id`. Update only the score or guide block that changed instead of rebuilding every message each frame.

### HUD Drawing Timing

With `WebgApp`, the render loop started by `app.start()` normally handles both the scene and HUD. Register current text in `onUpdate` with `app.message.setLines()`:

```js
app.start({
  onUpdate: ({ deltaSec }) => {
    elapsedSec += deltaSec;

    app.message.setLines("status", [
      `time=${elapsedSec.toFixed(1)}`,
      `camera=${orbit.orbit.distance.toFixed(1)}`
    ], {
      anchor: "top-left",
      x: 0,
      y: 0
    });

    return false;
  }
});
```

This registers data for display. `WebgApp` draws it as a final overlay after the scene through its internal `drawMessages()` method. Understanding the HUD as a canvas drawing path clarifies how it differs from a DOM overlay.

## `OverlayPanel` Structure and Behavior

`OverlayPanel` consists of DOM elements with a structure similar to this:

```text
root (overlay coordinate system)
  backdrop (background scrim)
  shell (placement controlled by anchor)
    panel
      header (title, close and collapse buttons)
      body (text or lines)
      choices
      buttons
```

Applications usually operate on it through `WebgApp`. Calling `showOverlayPanel()` with an existing `id` updates that panel; use `updateOverlayPanel()` to apply a partial update.

### Content and Formatting

Specify content as a single `text` string or a `lines` array. Choose one form for each update so the code clearly expresses its intent and updates remain easy to reason about. Set the display format with `format`:

- `format: "plain"`: General explanatory text. Line breaks are preserved and text wraps naturally.
- `format: "pre"`: Logs and error messages whose spacing and line breaks should remain exact.

For longer text, combine `scrollY: true` with `maxHeight` to scroll the body while keeping the panel within the screen.

### Placement and Layout Modes

`OverlayPanel` uses an `anchor` reference point selected from nine positions. It also has a `positioningMode`. Full-screen applications normally use `fixed`. In `layoutMode: "embedded"`, used when a canvas is placed within an instructional page, the overlay container follows the canvas host and uses `absolute`. Calls through `WebgApp` select the appropriate mode for the current layout.

### Panel Controls and Interaction

Use `collapsible` when a help panel should retain a small button while its body is hidden. Use `closable` and `showCloseButton` when the user can close the panel completely.

The panel can also contain action buttons (`buttons`) and choices (`choices`). A click sends an `actionId` to `onAction`:

```js
app.showOverlayPanel({
  id: "choice",
  title: "Route",
  lines: ["Which way should we go?"],
  choices: [
    { id: "left", label: "Left" },
    { id: "right", label: "Right" }
  ],
  buttons: [
    { id: "cancel", label: "Cancel", kind: "secondary" }
  ],
  onAction: ({ panelId, actionId }) => {
    console.log(panelId, actionId);
  }
});
```

Use `buttons` for panel-level actions such as save or cancel, and `choices` for a decision about the body such as selecting a route. Both return an `actionId`, so the application can handle them through the same callback.

### Modal Behavior and Pausing the Scene

With `modal: true`, the panel receives DOM interaction while the UI behind it is covered. `pauseScene: true` reports that the scene should stop progressing while the panel is shown. The application checks that state in its update callback and skips gameplay updates as appropriate. Keep rendering and UI input active so the panel remains usable.

```js
app.showOverlayPanel({
  id: "pause-menu",
  title: "Paused",
  lines: ["Resume or restart?"],
  modal: true,
  pauseScene: true,
  anchor: "middle-center",
  buttons: [
    { id: "resume", label: "Resume", kind: "primary" },
    { id: "restart", label: "Restart", kind: "secondary" }
  ],
  onAction: ({ actionId }) => {
    if (actionId === "resume") {
      app.hideOverlayPanel("pause-menu");
    }
  }
});
```

The update loop can read the panel state and control updates accordingly:

```js
const pausePanel = app.getOverlayPanel("pause-menu");
const pauseState = pausePanel?.getState?.();
if (pauseState?.visible && pauseState.pauseScene) {
  return false; // Skip this update
}
```

This separation leaves the timing of the pause under application control.

## Centralized Management with `WebgApp`

`WebgApp` manages `OverlayPanel` instances and their placement:

```js
app.showOverlayPanel(options);
app.updateOverlayPanel(id, patch);
app.hideOverlayPanel(id);
app.removeOverlayPanel(id);
app.clearOverlayPanels();
app.getOverlayPanel(id);
app.hasOverlayPanel(id);
app.listOverlayPanels();
```

`WebgApp` focuses on general-purpose management instead of APIs dedicated to individual uses such as help. This allows an application to implement its own flow UI. Use `OverlayPanelPresets.js` when a standard set of options is useful.

### Themes and Avoiding the Debug Dock

`WebgUiTheme` manages the visual style of DOM overlays. Calling `WebgApp.setUiTheme()` applies the theme to `DebugDock` and all `OverlayPanel` instances.

Use `avoidDebugDock` to keep a panel from overlapping the `DebugDock` fixed to the right side. The option reads the current dock offset and moves right-aligned panels inward as needed.

```js
app.showOverlayPanel({
  id: "runtime-log",
  title: "Runtime Log",
  text: logText,
  format: "pre",
  anchor: "bottom-right",
  avoidDebugDock: true
});
```

`DebugDock` is a development inspection area. Use `OverlayPanel` for explanations intended for application users, and `DebugDock` for internal state during development.

### Embedded Layouts

`WebgApp` supports both full-screen applications and `layoutMode: "embedded"`, where a canvas is placed inside an instructional page. In embedded mode, scrolling the HTML page moves the canvas within the document. An overlay fixed to the browser viewport would then appear detached from the canvas.

To keep them together, `WebgApp` synchronizes the overlay container with the canvas host in embedded mode. `OverlayPanel` uses that container as its reference and is positioned absolutely, so it follows the canvas as the page scrolls.

`unittest/embedded` checks this behavior by comparing the screen rectangles of the host, canvas, panels, and touch controls during each frame.

## Example: Combining UI Components

The following example combines the components covered in this chapter:

```js
import WebgApp from "../../webg/WebgApp.js";
import { buildHelpPanelOptions } from "../../webg/OverlayPanelPresets.js";

const app = new WebgApp({
  document,
  messageFontTexture: "../../webg/font512.png"
});

await app.init();

// 1. Control guide using the preset
app.showOverlayPanel(buildHelpPanelOptions({
  id: "help",
  lines: [
    "Drag: orbit",
    "R: reset",
    "B: briefing"
  ],
  anchor: "top-left"
}));

// 2. Runtime report as formatted, scrollable text
app.showOverlayPanel({
  id: "runtime-report",
  title: "Runtime Report",
  text: "ready",
  format: "pre",
  scrollY: true,
  anchor: "bottom-right",
  maxHeight: "32vh"
});

// 3. Briefing with a button; a function controls its flow
function showBriefing() {
  app.showOverlayPanel({
    id: "briefing",
    title: "Briefing",
    lines: [
      "This panel presents text with a button",
      "The sample application controls its flow"
    ],
    anchor: "bottom-left",
    buttons: [
      { id: "close", label: "Close", kind: "primary" }
    ],
    onAction: ({ actionId }) => {
      if (actionId === "close") {
        app.hideOverlayPanel("briefing");
      }
    }
  });
}

app.attachInput({
  onKeyDown: (key, ev) => {
    if (ev.repeat) return;
    if (key === "b") {
      showBriefing();
    }
  }
});

app.start({
  onUpdate: ({ deltaSec }) => {
    // 4. Short status in the canvas HUD
    app.message.setLines("status", [
      "status: running",
      `dt=${deltaSec.toFixed(3)}`
    ], {
      anchor: "top-left",
      x: 0,
      y: 0
    });

    return false;
  }
});
```

The example uses `Message` for status, an `OverlayPanel` preset for help, `format: "pre"` for a report, and an application function for briefing flow. Keeping the display paths separate makes the UI easier to manage as the application grows.

## Verification and Implementation Checklist

When changing UI behavior, use the following unit tests and samples to check the result:

- **Basic `OverlayPanel` behavior**: `unittest/overlay_panel` covers anchors, `pre` formatting, buttons, and modal behavior.
- **Embedded layout**: `unittest/embedded` checks placement as an embedded canvas moves.
- **Theme application**: `unittest/theme` checks changes through `setUiTheme()`.
- **Basic `Message` behavior**: See `unittest/message`.
- **Touch input**: `unittest/touch` checks input replacement through `Touch`.
- **`CommandPalette` details**: `samples/com_palette` demonstrates paging by row count, active mode-switch states, direct numeric entry, and opening by double-click or double-tap.

`unittest/overlay_panel` covers key parts of the UI design in this chapter, including all nine anchors, modal behavior, and returned actions, in one view. It is a useful implementation reference.

Use this checklist when implementing a DOM overlay:

- **Unique IDs**: Are panel IDs and action IDs unique?
- **Content form**: Does each update specify either `text` or `lines`?
- **Display surface**: Does `Message` use only characters in the HUD font atlas, with long or multilingual text handled by DOM panels?
- **Readability**: Do long panels use suitable `scrollY` and `maxHeight` settings?
- **Scene visibility**: Does the `anchor` keep the center of the scene visible?
- **Dock spacing**: Does a right-aligned panel account for `avoidDebugDock`?
- **Unique action IDs**: Do buttons and choices have distinct IDs?
- **Pause behavior**: Does the application read `pauseScene` and pause updates when required?
- **Separated responsibilities**: Does the application control dialogue or briefing flow?
- **Diagnostic records**: Is state for developers or analysis tools stored as a `Diagnostics` report?
- **State access**: Does each `CommandPalette` `value` read the application's current state, and does its callback update that state?
- **Control type**: Are buttons, toggles, steppers, and selects assigned to one-time actions, on/off values, numeric changes, and choices respectively?
- **Page movement**: Does each multi-page layout include `palette-next`? If it uses title taps or the automatic `Next` fallback, is the page structure clear to users?
- **Cleanup**: Does the application call `CommandPalette.destroy()` when removing the view so canvas and document events are released?

## Summary

`Message` is a canvas HUD based on `Text`, suited to lightweight status in short Latin text, numbers, and symbols. `OverlayPanel` is a DOM overlay for multilingual or longer text, buttons, choices, and scrolling. `CommandPalette` is also a DOM overlay, but provides commands and simple settings on demand rather than information to read.

This division helps `WebgApp` remain general-purpose. Use `Message` for short HUD values, `OverlayPanel` for readable panels, `CommandPalette` for temporary operations, and `Diagnostics` or `DebugDock` for records.

Chapter 14 covers `Touch` and `InputController`, explaining how on-screen buttons connect to key input and control an application.
