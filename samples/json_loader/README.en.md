# json_loader

English | [日本語](README.md)

![json_loader](./json_loader.jpg)

## Overview
- This sample loads and displays the `ModelAsset` JSON file specified in `main.js` as-is
- JSON exported by `gltf_loader` or `collada_loader` with the `D` key can be shown again in this sample by matching the file name
- It calls the JSON facade from `WebgApp.loadModel()`, making it a sample that obtains `ModelAsset` data and runtime objects without caring about format differences
- The included `modelasset.json` contains two clips, `ArmatureAction_skeleton_0` and `ArmatureAction_skeleton_0_copy`, created by duplicating the same source clip

## How to Run
- Open [./json_loader.html](./json_loader.html)
- Use a browser with WebGPU support, and check the Help Panel and CommandPalette together with the sample when needed

## webg Features Used
- `WebgApp`: standard initialization, render loop, and Help Panel display
- `CommandPalette`: groups clip control, wireframe, screenshot, JSON export, and camera reset
- `WebgApp.loadModel`: high-level entry point for the JSON facade
- `ModelLoader`: bundles JSON load / validate / build / instantiate
- `ModelAsset.load`: loads the JSON file
- `ModelAsset.getClipNames`: inspects the clip list contained in the JSON
- `ModelAsset.build`: constructs shapes, skeletons, and animations from the JSON
- `ModelBuilder.animationMap`: accesses runtime animations from clip IDs
- `build()` result helpers: `instantiate() / createNodeTree() / bindAnimationBindings() / getAnimation() / getAnimationNames() / startAllAnimations() / playAllAnimations() / setAnimationsPaused()`
- `EyeRig(type="orbit")`: orbit viewpoint based on the bounding box

## Checkpoints
- Confirm that the JSON specified by `MODEL_ASSET_FILE` passes the validator and can be rendered directly
- Confirm that the Help Panel displays `file / model / orbit / target / anim / clip / wireframe` state so the information needed for a viewer can be followed on screen
- Confirm that inside the sample, the runtime returned by the facade is used to unify node restoration and animation binding, and that the connection can be checked through `getAnimation()` / `getAnimationNames()` instead of direct `animationMap` access
- Confirm that `4 / 5` switches the target clip and that `1 / 2 / 3` act on the currently selected clip
- Confirm that `4 / 5` can switch between `ArmatureAction_skeleton_0` and `ArmatureAction_skeleton_0_copy`
- Confirm that `1` can restart the selected clip by name with `restartAnimation(clipId)`
- Confirm that `2 / 3` can pause and resume the selected clip individually with `pauseAnimation(clipId)` / `resumeAnimation(clipId)`
- Confirm that the camera distance is set automatically from the bounding-box size so the whole model remains in view
- Confirm that `Shift + Arrow` and `Shift + Drag` move the camera target in parallel, making it easy to bring details to the center
- Confirm that `W` toggles wireframe, `S` saves a screenshot, and `R` restores the initial framing
- Confirm that the CommandPalette can run clip replay / pause / resume / selection, wireframe, screenshot, JSON export, and camera reset
- Confirm that the Help Panel is used for current values and operation hints, while the CommandPalette is used for changing settings and running commands

## Controls
- Drag / arrow keys: orbit camera rotation
- `Shift + Drag / arrow keys`: pan the camera target
- Mouse wheel / `[ / ]`: zoom
- `Space`: pause animation
- `1`: replay the selected clip
- `2`: pause the selected clip
- `3`: resume the selected clip
- `4`: select the previous clip
- `5`: select the next clip
- `W`: toggle wireframe
- `S`: save a screenshot
- `D`: download the current JSON again
- `R`: return the camera to the initial position based on the bounding box
- `/` or double tap the canvas: open the CommandPalette
