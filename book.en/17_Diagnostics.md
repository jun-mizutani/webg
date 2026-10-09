# Sharing Diagnostic Information

This chapter explains how to collect information about the screen, JavaScript runtime, and GPU pipeline in one diagnostic report. The same record can be exported as a human-readable summary or JSON for AI and tools. By saving the camera, scene size, shaders, warnings, and processing stage at the time of a problem, investigation can rely on observed facts in another environment.

## How to read this chapter

### Prerequisites

This chapter is easier to follow if you know `WebgApp` from Chapter 5 and JavaScript objects, arrays, and strings.

### What to read first

Start with the basic flow for collecting diagnostic information, displaying it, and preparing it to share.

### What to read when you need it

Refer to `DebugDock`, `Diagnostics`, runtime measurements, and reproduction details when investigating an issue.

### What you will learn

You will be able to show runtime state and share the information a developer needs to reproduce the same behavior.

## Record and Share Diagnostic Information

To share a display defect or interaction problem, record the settings and internal state from the reproduction along with what the screen looked like. This chapter covers inspecting state with `DebugDock`, generating a summary or JSON with `Diagnostics`, and sampling values at a specific moment with `DebugProbe`.

Text shown at the edge of the screen is difficult to preserve as a record or convey precisely to an AI coding assistant. A more useful approach is to create a report of the state at that moment, inspect it on screen, and share the same report when needed.

This chapter explains the design of `DebugDock`, `Diagnostics`, `DebugProbe`, and `WebgApp`: diagnostic information is both something to inspect and something to share. The diagnostic system in `webg` lets a user read the current application state on screen and copy it for sharing.

For example, when asking an AI coding assistant to analyze a rendered view, use **Copy Summary** or **Copy JSON** in `DebugDock`. The clipboard receives the camera position, field of view, scene size, warnings, and sample-specific state from that moment. The user can paste it into the conversation to provide precise values for the state under investigation. Diagnostic information is therefore a supported interface for exporting application state.

When sharing a report, include the steps that led to the problem, the expected result, and what actually happened. Add a screenshot for a visual defect. The report captures runtime state; these details explain how to reproduce that state.

The system combines components with separate responsibilities:

- `DebugConfig.js`: Manages debug and release modes and whether diagnostics are enabled.
- `DebugDock.js`: Displays current state and copies reports.
- `Diagnostics.js`: Creates report objects and formats summaries or JSON.
- `DebugProbe.js`: Captures selected runtime values at a specific moment.

The layer that creates the canonical diagnostic report is separate from the layer that displays or copies it. This chapter first follows the path through `DebugDock` and clipboard sharing, then examines the report structure.

## Design for Sharing Diagnostics

The `webg` diagnostic system provides **Copy Summary** and **Copy JSON** as standard sharing paths. The browser console is also available in developer tools. `navigator.clipboard.writeText()` writes a report directly to the clipboard, so users can paste it into a chat or bug report.

Clipboard access depends on a secure context, browser permissions, and user interaction. When the Clipboard API rejects a copy, use the report displayed by `DebugDock`, JSON output, or the developer console. The report contents remain available on screen and as JSON. Since the number of summary items and display limits can change with implementation updates, use the JSON report for strict machine processing.

This design provides reproducible information that otherwise might be known only to the person looking at the screen. `Diagnostics` is the report-generation layer rather than a display component. It creates the canonical report before information is passed to `DebugDock` or `OverlayPanel`, as introduced in Chapter 12. Both display and sharing use the same report.

## Inspect Runtime State with `DebugDock`

`DebugDock` is the main development dock for diagnostic information. It displays **Current State** and provides **Copy Summary** and **Copy JSON** buttons. Users can inspect the state and copy the same content, so the shared report matches what they reviewed.

The default `WebgApp` configuration uses prefixed key sequences for debug input. It starts in `release` mode, keeping the development `DebugDock` hidden from regular users. To enable diagnostics, set `debugTools.mode: "debug"` or attach input with `app.attachInput()` and press `F9` followed by `M` to switch to debug mode. `F9` followed by `C` copies a summary; `F9` followed by `V` copies JSON.

In release mode, `enableDiagnostics` and `enableProbe` are disabled and the debug dock and helper displays are hidden. Change the mode explicitly with `app.setDebugMode("debug")` or `app.setDebugMode("release")`. This method updates `DebugConfig`, the `DebugDock` visibility, and the canvas layout together.

## Report Structure and Automatic Collection

Diagnostic reports are provided in two forms: a **summary** for people and **JSON** for coding AI and tools.

### Summary Structure

`Copy Summary` is created by `Diagnostics.toSummaryText()` and contains five sections:

1. **Overview**: `source`, `system`, `stage`, `ok`, and `timestamp`.
2. **Latest Issue**: The latest error; when there is no error, the latest warning; otherwise `(none)`.
3. **Key Stats**: Camera position, pose, target, distance, field of view, shader classes, scene size, canvas and display dimensions, frame count, and uptime.
4. **Warnings**: Up to the last four entries in the warning array.
5. **Recent Details**: Up to the last eight entries in the details array.

### Detailed JSON

`Copy JSON` contains more structured information. In particular, `context.webgAuto` stores the exact eye position and attitude, shader classes used in the scene and their counts, and material ID counts. This is useful when examining rendering configuration.

### Automatic Statistics from `WebgApp`

`WebgApp` collects environment information at startup and current scene size without requiring explicit application code. In the final stage of `app.init()`, it calls `checkEnvironment({ stage: "ready" })` and records WebGPU support and basic consistency checks.

`collectCurrentSceneStats()` also collects these statistics automatically:

- **Scene size**: `nodeCount`, `shapeCount`, `meshCount`, `vertexCount`, `triangleCount`, `boneCount`, and related counts.
- **Render conditions**: `eyeX/Y/Z`, `eyeYaw/Pitch/Roll`, `cameraTargetX/Y/Z`, `fovX/Y`, and `canvasWidth/Height`.

This collection records the camera and scene size for each sample. Diagnostics are part of the standard `WebgApp` configuration.

## Add Application-Specific Diagnostics

Automatic collection records shared runtime state. Add application-specific context through these interfaces.

### Record the Runtime Stage

Record the application's current processing stage so a report reader can distinguish values collected during `fetch` from values collected during runtime:

```js
app.setDiagnosticsStage("fetch");
// ...load resources...
app.setDiagnosticsStage("runtime");
```

### Add Statistics and Details

Use `mergeDiagnosticsStats()` for important sample-specific values and `addDiagnosticsDetail()` for supplementary information:

```js
// Important values appear in Key Stats.
app.mergeDiagnosticsStats({
  score: currentScore,
  focusDistance: dof.focusDistance.toFixed(1)
});

// Supplementary information appears in Recent Details.
app.addDiagnosticsDetail(`selectedClip=${selectedClipName}`);
```

### Add Warnings

Add information that should receive attention with `addDiagnosticsWarning()`. Warnings appear in both **Latest Issue** and **Warnings**.

You can also combine the result of `checkEnvironment()` with diagnostic data so the summary immediately shows whether the scene meets basic requirements.

## One-Shot Probes and Error Reports

Use specialized capture methods to preserve a transient state or a startup failure that a continuously updated report might not retain. Naming the capture point helps preserve the abnormal value before a later healthy frame replaces it.

### One-Shot Probe

Use `configureDiagnosticsCapture()` and `createProbeReport()` to capture a state once—for example, immediately after changing a setting—instead of tracking continuously:

```js
app.configureDiagnosticsCapture({
  labelPrefix: "eye_rig",
  collect: () => {
    const report = app.createProbeReport("runtime-probe");
    Diagnostics.mergeStats(report, { frameCount: app.screen.getFrameCount() });
    return report;
  }
});

// Capture the state after the specified number of frames.
app.captureDiagnosticsSummary({ afterFrames: 1 });
```

### Reports for Startup Failures

When startup fails, replace the diagnostic report with an error report while showing an error panel. This preserves the sharing path for investigation:

```js
start().catch((error) => {
  app?.setDiagnosticsReport?.(Diagnostics.createErrorReport(error, {
    system: "eye_rig",
    source: "samples/eye_rig/main.js"
  }));
  app?.showOverlayPanel?.(buildErrorPanelOptions(error, { id: "start-error" }));
});
```

Keeping reports available after failure as well as after success is a useful part of the diagnostic design in `webg`.

## Use Diagnostics Independently

Most applications use `WebgApp`, but you can also use `Diagnostics.js` directly while building a custom UI, as `samples/sound` does. This is useful when UI settings matter more than statistics about a 3D scene.

```js
const report = Diagnostics.createSuccessReport({
  system: "sound",
  source: "samples/sound/main.js",
  stage: "runtime"
});

Diagnostics.mergeStats(report, { masterVol: ui.masterVol.value });
```

`Diagnostics` is a standalone report-generation layer, rather than an API limited to `WebgApp`.

## Summary

The key idea is to treat diagnostic information as a supported output for sharing current state, rather than as text that merely decorates the screen. The central object is the current report, which can be exported through **Copy Summary** and **Copy JSON**.

`WebgApp` gathers common information automatically. Add application-specific meaning with `stage`, `stats`, `details`, and `warnings` as appropriate.

In the display paths described in Chapters 12 and 13, diagnostics occupies a distinct role: it creates the report. `DebugDock` or `OverlayPanel` can then display or share that result to support an efficient development workflow.
