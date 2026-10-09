# Bloom and Depth of Field

Bloom adds a glow around bright regions, while depth of field (DoF) keeps a chosen distance sharp and blurs other depths. This chapter connects both effects to manually rendered scene textures. Bloom reads color; DoF also requires depth and a token identifying the same render frame.

## How to read this chapter

### Prerequisites

This chapter is easier to follow if you know post-processing from Chapter 23 and camera views from Chapter 3. Chapter 41 explains the conventions used to reconstruct distance from depth.

### What to read first

Start with the roles of `BloomPass` and `DofPass`, their minimal implementations, and their main parameters.

### What to read when you need it

Refer to depth debugging, focus masks, image pyramids, and HDR (High Dynamic Range) processing when tuning the result.

### What you will learn

You will be able to configure light bloom and focus-distance blur and distinguish color issues from depth issues.

## Implement and Use `BloomPass`

Use `BloomPass` to add a glow around emitters and strong reflections, emphasizing brightness differences in the image. It uses color only, which makes it a useful way to learn off-screen rendering and full-screen composition without depth reconstruction or additional masks.

### Role and Processing

`BloomPass` extracts bright regions, blurs them, then adds them back to the original scene to create a glow. Since it uses color information alone, it is a straightforward component for learning post-processing.

Internally, it manages the original `sceneTarget`, an `extractTarget` for luminance extraction, an `extractHeatTarget` for thresholded extraction, and the blur targets managed by `SeparableBlurPass`. Create it with `new BloomPass(gpu, options)`, wait for `await bloom.ready`, then use the frame cycle introduced in Chapter 23.

### Minimal Connection

This example draws the scene to bloom targets, performs extraction and blur, then composes the result on the canvas. Read the resource setup separately from the per-frame passes to distinguish initialization problems from pass-order problems.

```js
import BloomPass from "./webg/BloomPass.js";

const bloom = new BloomPass(app.getGPU(), {
  width: app.screen.getWidth(),
  height: app.screen.getHeight(),
  threshold: 0.68,
  extractIntensity: 1.0,
  softKnee: 0.35,
  bloomStrength: 1.15,
  exposure: 1.0,
  toneMapMode: 0,
  blurScale: 1.0,
  blurIterations: 2,
  blurRadius: 1.0
});
await bloom.ready;

app.start({
  onUpdate: ({ screen }) => {
    bloom.resizeToScreen(screen);
  },
  onBeforeDraw: () => {
    bloom.beginScene(app.screen, app.clearColor);
    app.space.draw(app.eye);
  },
  onAfterDraw3d: () => {
    bloom.render(app.screen, {
      source: bloom.getSceneTarget(),
      clearColor: app.clearColor
    });
    app.screen.clearDepthBuffer();
  }
});
```

### Tune with Debug Views

Visualizing intermediate results is essential when tuning a post-process. `BloomPass` provides getters for its internal targets, which you can display with `FullscreenPass`.

```js
import FullscreenPass from "./webg/FullscreenPass.js";

const debugPass = new FullscreenPass(app.getGPU(), {
  targetFormat: app.getGPU().format
});
await debugPass.init();

let bloomView = "composite";

app.start({
  onUpdate: ({ screen }) => {
    bloom.resizeToScreen(screen);
  },
  onBeforeDraw: () => {
    bloom.beginScene(app.screen, app.clearColor);
    app.space.draw(app.eye);
  },
  onAfterDraw3d: () => {
    bloom.render(app.screen, {
      source: bloom.getSceneTarget(),
      clearColor: app.clearColor
    });

    if (bloomView !== "composite") {
      const debugSource = bloomView === "scene"
        ? bloom.getSceneTarget()
        : bloomView === "extract"
          ? bloom.getExtractTarget()
          : bloomView === "extractHeat"
            ? bloom.getExtractHeatTarget()
            : bloomView === "blurA"
              ? bloom.getBlurTargetA()
              : bloom.getBlurTargetB();

      app.screen.beginPresentPass({
        clearColor: app.clearColor,
        colorLoadOp: "clear"
      });
      debugPass.draw(debugSource);
    }

    app.screen.clearDepthBuffer();
  }
});
```

Compare `extract` and `extractHeat` to see how `threshold` and `softKnee` affect selection, then adjust the parameters.

The `BloomPass` here applies a render pass to display-color scene output from standard forward rendering. Integrated PBR rendering extracts bright regions from linear HDR radiance before tone mapping, rather than from post-tone-mapping brightness. Use `ComputeBloomPass` from Chapters 34–36 or `ComputeEffectPipeline` from Chapters 31–33 for that path.

## Implement and Use `DofPass`

Use `DofPass` to keep a chosen focal distance sharp and blur foreground or background to guide attention and express depth. Since it needs scene color, depth from that scene, and a token identifying the frame that produced them, it also demonstrates the requirements of depth-dependent post-processing.

### Role and Processing

`DofPass` reads scene color and depth to preserve the focus plane while blurring other distances. This is the main difference from bloom.

The current `DofPass` uses three blur levels: `small`, `medium`, and `large`. It blends in order from `scene` to `small`, `medium`, and `large` according to the depth difference, avoiding an abrupt switch from the sharp image to the strongest blur.

Internally it holds `sceneTarget`, `depthDebugTarget`, `focusDebugTarget`, and `stageDebugTarget`, as well as three blur targets. The internal camera frame used for near/far distance reconstruction comes from the same `renderFrameToken` as the rendered scene.

Choose between passing a fixed distance to the DoF pass and using the current camera distance resolved by `EyeRig`. To keep the subject in focus as the camera moves, set the focus target through `EyeRig.focus` and use `focusSource: "camera"` to read `CameraFrame.focusDistance` from the same frame. `EyeRig` chooses the focus target; `DofPass` determines the blur around it.

`focusRange` is the distance width for one blur stage, rather than the full distance to maximum blur. A depth difference of one `focusRange` blends `scene → small`, two ranges blends `small → medium`, and three ranges blends `medium → large`. This makes it possible to inspect the transition out of the focus plane and the `stageMask`. In the compute version, keeping coverage and circle of confusion (CoC) separate avoids sharp scene color appearing inside out-of-focus geometry.

### Example: Share a Frame with the Scene

This example passes the same off-screen scene, depth, and `renderFrameToken` to rendering and DoF. Sharing the token keeps focus distance and scene depth associated with the same camera frame while the camera moves.

```js
import DofPass from "./webg/DofPass.js";

const orbit = app.createOrbitEyeRig({
  target: [0.0, 1.5, 0.0],
  distance: 18.0,
  focus: {
    enabled: true,
    mode: "camera-target"
  }
});

const dof = new DofPass(app.getGPU(), {
  width: app.screen.getWidth(),
  height: app.screen.getHeight(),
  // Use the focusDistance from WebgApp's CameraFrame each frame.
  focusSource: "camera",
  focusRange: 6.0,
  maxBlurMix: 1.0,
  blurScale: 0.5,
  stageBlurIterations: {
    small: 1,
    medium: 2,
    large: 4
  },
  stagedStageCount: 3,
  blurRadius: 2.4
});
await dof.ready;

app.start({
  onUpdate: ({ screen }) => {
    dof.resizeToScreen(screen);
  },
  onBeforeDraw: ({ renderFrameToken }) => {
    dof.beginScene(app.screen, app.clearColor, { renderFrameToken });
    app.space.draw(renderFrameToken);
  },
  onAfterDraw3d: ({ renderFrameToken }) => {
    dof.render(app.screen, {
      renderFrameToken,
      clearColor: app.clearColor
    });
    app.screen.clearDepthBuffer();
  }
});
```

With `focusSource: "camera"`, `beginScene()` and `render()` resolve `CameraFrame` from the same `renderFrameToken` and apply its `focusDistance` to the uniforms. Orbit zoom changes the camera-to-target distance, so the focus plane follows the same target in the next frame. The default `focusSource` is `"explicit"`, which preserves the lower-level use of passing `focusDistance` directly to `DofPass`.

To focus on a moving node, configure the target through `EyeRig`:

```js
app.createOrbitEyeRig({
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

After updating `EyeRig`, `WebgApp` transforms the node's current world position into view space and stores its positive `-Z` distance in `CameraFrame.focusDistance`. The application provides the focus node; `WebgApp` updates the distance each frame. Keep `focusRange`, `blurRadius`, and `stageBlurIterations` in `DofPass`, where they control the appearance.

When using `DofPass` independently of `WebgApp`, use `focusSource: "explicit"` and set the distance directly. To connect a custom `EyeRig`, call `eyeRig.getFocusDistance(cameraFrame)` with the `CameraFrame` for the current draw and pass the result to `dof.setFocusDistance(...)` before `beginScene()`. The pass does not search for a global camera or node; explicit inputs help reveal when focus distance and depth belong to different frames.

The `sceneTarget` must preserve camera Reverse-Z depth that can be sampled, as well as color. Pass the same `renderFrameToken` to scene initialization, `Space.draw()`, and composition. `DofPass` checks the identity of the token to verify that the depth came from the same camera frame. Tokens from an earlier frame or another `WebgApp` are rejected.

`focusRange` is one stage's distance width. `blurIterations` applies the same iteration count to all three stages; `stageBlurIterations` sets each stage independently. Small blur targets are close to screen resolution, so assigning iterations only where needed, such as `small: 1`, `medium: 2`, and `large: 4`, is easy to tune.

### Debug Depth and Focus Masks

DoF is difficult to tune when depth and focus ranges are invisible. Use its helpers to output depth, focus range (`focusMask`), and stage selection (`stageMask`) to color targets. `stageMask` shows whether a pixel is composed from `scene`, `small`, `medium`, or `large`.

```js
import FullscreenPass from "./webg/FullscreenPass.js";

const debugPass = new FullscreenPass(app.getGPU(), {
  targetFormat: app.getGPU().format
});
await debugPass.init();

let dofView = "composite";

app.start({
  onUpdate: ({ screen }) => {
    dof.resizeToScreen(screen);
  },
  onBeforeDraw: ({ renderFrameToken }) => {
    dof.beginScene(app.screen, app.clearColor, { renderFrameToken });
    app.space.draw(renderFrameToken);
  },
  onAfterDraw3d: ({ renderFrameToken }) => {
    dof.render(app.screen, {
      renderFrameToken,
      clearColor: app.clearColor
    });

    if (dofView !== "composite") {
      const debugSource = dofView === "scene"
        ? dof.getSceneTarget()
        : dofView === "depth"
          ? dof.getDepthDebugTarget()
          : dofView === "focusMask"
            ? dof.getFocusDebugTarget()
            : dofView === "stageMask"
              ? dof.getStageDebugTarget()
              : dofView === "blurSmall"
                ? dof.getSmallBlurTarget()
                : dofView === "blurMedium"
                  ? dof.getMediumBlurTarget()
                  : dofView === "blurLarge"
                    ? dof.getLargeBlurTarget()
                    : dof.getSceneTarget();

      app.screen.beginPresentPass({
        clearColor: app.clearColor,
        colorLoadOp: "clear"
      });
      debugPass.draw(debugSource);
    }

    app.screen.clearDepthBuffer();
  }
});
```

Switch between `depth` and `focusMask` to check that `focusDistance` matches the camera projection from the same `renderFrameToken` and identify the region that stays sharp. Compare `stageMask`, `blurSmall`, `blurMedium`, and `blurLarge` to determine whether a blur image itself is broken or depth-based stage selection differs from the intended result.

Fragment-shader DoF carries depth and camera information into a later pass, extending the color-only post-process flow. This also helps explain deferred rendering, where positions are reconstructed from G-buffer depth. Integrated PBR rendering uses `ComputeDofPass` with the same `cameraFrame` as the linear HDR scene and processes DoF before tone mapping.

## Summary

Bloom selects and spreads bright parts of an image. Depth of field uses depth and camera information to select blur according to focus distance. Separating color-only effects from those that need depth or a camera frame helps diagnose missing-input problems.

Chapter 25 covers transparent surfaces, frosted glass, vignettes, and other finishing effects.
