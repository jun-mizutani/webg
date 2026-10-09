# From a PBR Scene to a Small Game

After learning PBR, `Node`, selection, and particles from small feature examples, this chapter crosses the boundary where they become one game. “Emerald Fort” in `samples/fantasy/` is a single battle on a map with elevation. It keeps the initial scene, rules, visuals, input, and disposal understandable without a large game framework. The battlefield is a flooded fort, with caustics, teal lighting, and fog. It also shows how to add rendering features to the same game.

## Choose a Runnable Page and Reading Order

Serve the repository over HTTP and open `samples/fantasy/fantasy.html`, for example `http://localhost:8000/samples/fantasy/fantasy.html`. Controls and checkpoints are in `samples/fantasy/README.md`; the browser introduction is `samples/fantasy/index.html`.

Select Rio and move to a blue tile, then select another ally. Confirm that input pauses during movement and that attack choices appear after arrival. Next try the enemy turn, HP changes, and restart. This is also the order in which the corresponding behavior appears in the code. Toggle “Underwater Caustics” in the right panel: the game state remains available while caustics are off, and moving light patterns return on terrain when enabled.

For the underlying ideas, return to the parent-child `Node` example in 03_01, screen-coordinate raycasts in Chapter 15, PBR materials in 30_01, and emission and clearing in `samples/compute_particle_emitter/`. This integrated sample complements those focused examples.

## Keep One Application Entry Point

Start at `start()` in `samples/fantasy/main.js`. `FantasyApp` extends `WebgSceneApp` and adds viewport resizing. Standard callbacks handle PBR drawing and the update and composition of registered GPU particles. Follow this single frame path when reading the sample.

`createManifest()` in `scene.js` provides initial data with the same structure as SceneYAML. It contains placements, shared materials, renderer settings, and particles. The `project` option accepts a manifest object as well as a URL, so a JavaScript-generated terrain can use the same high-level entry point. Move to SceneYAML when the scene needs a document that can be saved and edited.

This game sets `physics: false`. The movement rules need grid-entry checks, so rigid-body simulation is unnecessary even though the map has different elevations. `rules.mjs` defines the rules, and visuals derive their positions from the same tile elevations. Keeping one source of elevation for both avoids disagreement between units and terrain.

## Assign PBR Materials to Shapes Directly

Distinguish materials declared in the scene's `materials` from parameters passed directly to `Shape.setMaterial()`. The direct route uses a four-component `color` with `specular`, `roughness`, and `metallic`:

```js
shape.setMaterial("armor", {
  color: [0.48, 0.59, 0.62, 1.0],
  specular: 1.0,
  roughness: 0.28,
  metallic: 0.88,
  emissive_factor: [0.0, 0.0, 0.0]
});
```

The `part()` helper in `visuals.js` combines shape finalization, material assignment, and attachment to a `Node`. It adds a fourth component to palette RGB values for the texture mix. Set opacity separately with `alpha`. Emission is named `emissiveFactor` in a scene declaration and `emissive_factor` for a directly configured shape; follow the relevant usage path.

When the `WebgSceneApp` PBR configuration uses environment lighting, `renderer.pipeline.lighting.ambient` is zero. This entry point rejects a nonzero value during validation. For a roughness experiment, keep lighting and exposure fixed.

## Connect Tile Movement to Node Updates

Read `choose()` → `move()` → `updateMotion()`. `paths()` returns legal routes, and `move()` waits for each displayed step to finish. `updateMotion()` is called from `onUpdate({ deltaSec })` and interpolates position and limbs in seconds. Because `rotateX()` adds a rotation, pass the difference from the previous angle.

The logical unit position is committed after each step is displayed. `busy` blocks input during an action and prevents repeated input against an old movement range. `refresh()` rebuilds choices after movement.

For a small experiment, reduce Rio's movement allowance from four tiles to three. The climb from the starting tile to “column 4, row 5” is no longer reachable. Then increase only the step `duration` and walk the same route more slowly. This separates route rules from visual speed.

## Use the Same Camera for Picking and Labels

`makePointerRay()` and `pickTile()` use the unprojection described in Chapter 15. Combine the perspective terms with `Matrix.mul_()` and get the depth convention from `CAMERA_REVERSE_Z`. Update the camera matrices before picking.

`Space.raycast()` queries visual bounds for selection. Attack range and movement legality come from the hit unit's grid coordinates and `rules.mjs`; combat rules do not depend on mesh bounds. A drag is excluded from click handling by measuring pointer movement. Auxiliary board controls also call `choose()` so each input method shares one rule path.

`updateLabels()` projects each current `Node` position with the same projection and view matrices, then places name and HP DOM elements at the Canvas display dimensions. Rotate the camera and confirm that labels and click targets remain aligned.

## Resize the Canvas and PBR Target Together

Stretching a Canvas only with CSS separates its rendered size from its display size. `FantasyApp.js` observes `.stage` with `ResizeObserver`, updates the Canvas using `fixedCanvasSize` and `applyViewportLayout()`, then calls `renderer.resize(width, height)` to match the PBR render targets. The sample uses CSS pixels and `useDevicePixelRatio: false`.

Change the window width and check the Canvas, particles, labels, and picking. Resizing verifies that rendering, DOM overlays, and input use the same dimensions.

## Assign Ownership for Particles, Restart, and Disposal

Declare the emitter in `scene.js` and call `emit()` from gameplay events. `appearance.colors` takes two RGB arrays; use the same value twice for a single-color emitter. To test a different footstep color, leave the emission position and route unchanged.

`reset()` in `main.js` restarts gameplay: it restores HP, action availability, turn, existing nodes, and log, and calls the emitter's `clear()`. Application-specific HP or DOM state is not part of `WebgSceneApp.reset()`.

On shutdown, stop the frame loop first. `Visuals.destroy()` releases Shapes generated manually by `Visuals`; `WebgSceneApp.destroy()` releases registered particles, PBR resources, and the declared scene. `FantasyApp.destroy()` removes the observer registered by the sample. Clear ownership lets ordinary restarts reuse GPU resources.

## Add Caustics to Moving Units

First compare water and caustics separately in Chapter 35 and `samples/water/water.html`. Then read `connectWater()` in `samples/fantasy/main.js`. It creates a `WaterBody` and connects it with `sceneApp.renderer.setWater()` before the frame loop starts. No additional render loop or WGSL is needed in the sample.

`origin: [0, -2, 0]` is the irradiance reference plane; `surfaceHeight: 6` is the average water-surface Y coordinate. Register the terrain, units, and decoration roots in an 18 m by 18 m water volume. Receiver registration also reaches child limbs and equipment, so walking does not require re-registering each moving part. Selection rings and movement-range overlays are left out. Specular metal and emission remain in the PBR path; caustics affect the direct diffuse component.

```js
water.addReceiver(unitRoot); // Child parts receive caustics as well
await sceneApp.renderer.setWater(water, {
  causticsEnabled: true,
  surfaceEnabled: false,
  quality: "high"
});
```

This caustics setup uses vertical directional light. `connectWater()` sets `renderer.pipeline.lightOptions.direction` to `[0, -1, 0]`, while `scene.js` sets the shadow up vector to `[0, 0, 1]`. The `WaterBody` owns configuration and registrations without owning the GPU; the renderer owns the additional GPU resources.

Gameplay `update()` advances `waterTime` in seconds and passes it to `water.setTime()`. Units update in the same callback, so caustics follow their current positions and normals. Adjust waves with `amplitude`, `wavelength`, `speed`, and `waveMix`. Calling `water.setOptions()` applies changes without reconnecting `setWater()`.

The sample turns off refractive surface display and uses teal lighting and distance fog to create an underwater atmosphere while keeping the battle grid readable. It does not model refraction, total internal reflection, or the underside of the water surface from an underwater camera. Caustic absorption uses an average RGB coefficient, and view-side turbidity is approximated with standard fog. Compare RGB transmission through the surface in `samples/water/`.

The checkbox pauses the scene with `sceneApp.stop()`, awaits `setWater()`, and resumes with `sceneApp.start()`. This keeps HP, action state, and existing nodes intact while resources are configured. When both caustics and the surface are disabled, dedicated GPU resources are released; enabling them again reuses the same `WaterBody`. `reset()` resets units, particles, and combat state without recreating water. `WebgSceneApp.destroy()` releases renderer resources on shutdown.

Verify in this order: move with caustics off, move up a height step with caustics on, use a ranged attack, run the enemy turn, then restart. Confirm the original gameplay after toggling the rendering feature.

## Adapt the Sample in Small Steps

1. Run it in place and verify movement, attacks, enemy turn, and restart.
2. Change one material in `scene.js` or `visuals.js` and compare under the same lighting.
3. Change one unit's movement allowance in `rules.mjs` and check legal paths and displayed ranges.
4. Change the display duration in `move()` and check tile commitment and input lockout.
5. Change the two particle colors and confirm old particles clear on restart.
6. Change the camera and viewport width, then check picking, labels, and render dimensions.
7. Toggle caustics and change only wave height, then recheck movement, attacks, and restart.

`node --test samples/fantasy/rules.test.mjs` checks path and combat calculations. PBR appearance, animation, particles, and clicks require browser checks. For each added feature, map “what state changes, who owns it, when it updates, and when it is released” to the sample's functions. People and AI agents can follow the same process.
