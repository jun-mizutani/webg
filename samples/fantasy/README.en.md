# fantasy — Starfall Keep

English | [日本語](index.html)

![Starfall Keep](fantasy.jpg)

## Overview

A small turn-based battle on a 9×9 map with three elevation levels. Command a knight, mage, and ranger against three enemies. This sample adds moving Nodes, picking, DOM controls, GPU particles, victory, defeat, and restart to a PBR scene.

No external models or audio assets are required. Primitive geometry forms the characters; parent and child Nodes connect their limbs and equipment. Rules run independently of the GPU and DOM, making the boundary between a grid path and its animation visible.

The keep is submerged. Core caustics illuminate terrain, scenery, and moving units; blue-green light, distance fog, and drifting particles give the battlefield an underwater atmosphere. Toggle **水中のコースティクス** to compare the moving illumination. Underwater colors and fog remain when caustics are off.

## Run and controls

Open [fantasy.html](fantasy.html) in a WebGPU browser. Serve the repository over HTTP using localhost or HTTPS. Startup prepares PBR and GPU particles.

1. Select an ally in the 3D scene or party panel.
2. Click a cyan tile to move.
3. Click an enemy within range to attack.
4. Command the remaining allies and press **味方ターンを終了** (end turn).

Each unit moves once and attacks once per turn. An attack can be the unit's only action. Movement takes place before attacking; choose **待機** after an attack to finish the unit's actions. **待機** ends an individual unit's actions. Enemies approach attack positions, then attack the available ally with the lowest HP.

Movement uses four neighbors and permits one elevation step. Climbing costs 2 movement points; level and downhill movement cost 1. Living units and obstacles block movement. Attacking from higher ground adds 3 damage. Range uses Manhattan distance; ranged attacks pass over obstacles and always hit.

Defeat all enemies to win. Losing every ally ends the battle. **最初から** and **もう一度戦う** restart it. Expand **マスをボタンで操作** to use grid buttons with Tab and Enter; these invoke the same actions as 3D picking.

Drag to rotate and use the wheel to zoom. The initial view uses perspective projection. Canvas size is 960×720 on large screens; narrow screens reduce its width and place the controls below it.

## webg features

- `WebgSceneApp` starts PBR and GPU particles from a manifest object with the SceneDefinition structure. Game updates use `onUpdate({ deltaSec })`.
- `Shape`, `Primitive`, and `Node` form characters and equipment. Moving the parent moves its children; rotation differences animate the limbs.
- PBR materials, `blue-sky` environment lighting, a blue vertical directional light, shadows, Bloom, and Fog distinguish terrain, armor, and crystals.
- `WaterBody` and `PbrRenderer.setWater()` project wave-generated illumination onto terrain and moving unit diffuse lighting. Surface refraction is disabled to keep tactical tiles readable.
- `Space.raycast()` picks terrain and character AABBs from a Reverse-Z pointer ray.
- `ComputeParticleEmitter` handles footsteps, magic, sparks, and ambient light. The standard app handles simulation and PBR composition.

The app uses `physics:false`. Tile rules determine paths and elevation; no rigid-body simulation, external model skinning, or animation clips are used.

## Verification points

- Select Rio and move to column 4, row 5, elevation 1 on the grid. This uses 4 movement points, including the climb from elevation 0 to 1.
- Watch limb motion, vertical motion, and particles at each step. Input remains disabled until animation finishes and the logical tile position is committed.
- Finn has range 4 and Luna range 3. Clicking an out-of-range enemy shows a message without changing HP.
- Check attack trails, impact particles, hit motion, HP, and defeated units disappearing.
- Enemy attacks from higher ground show **高所 +3** in the log. Allies regain their actions next turn.
- Restart restores HP, positions, turn, log, and particles while reusing GPU resources.
- Rotate and resize the view; labels and picking should remain aligned with the 3D scene.
- Toggle caustics and check that moving units, attacks, and turn progression continue correctly.

## Read the code in this order

1. **`main.js`: `start()`** — initialize through one entry point, add moving Nodes and input, then start frames. Do not add a second render loop or particle step.
2. **`scene.js`: `createManifest()`** — read initial placement, materials, PBR, and emitters. Grid coordinates and display height come from `rules.mjs`.
3. **`visuals.js`: `part()` and `character()`** — examine RGBA/PBR material parameters, Node hierarchy, and ownership of manually created Shapes.
4. **`main.js`: `choose()` → `move()` → `updateMotion()`** — select a tile, await animation, and commit coordinates. `rules.mjs`: `paths()` includes uphill movement costs.
5. **`main.js`: `makePointerRay()`, `pickTile()`, `updateLabels()`** — use the same camera for picking and DOM projection.
6. **`FantasyApp.js` and cleanup** — synchronize CSS, Canvas, and PBR sizes, then release the observer, manual Shapes, and standard app separately.

The `reset()` function in `main.js` restarts this game. It is distinct from `WebgSceneApp.reset()`; HP and action flags belong to the game.

## Underwater lighting

`connectWater()` in `main.js` creates an 18m-wide, 18m-deep `WaterBody`, with its mean surface at 6m. Terrain and unit root Nodes are receivers; child Shapes inherit registration, including animated limbs and equipment. Movement markers and the selection ring are excluded. `update()` advances only the shared wave time through `setTime()`.

```js
await sceneApp.renderer.setWater(water, {
  causticsEnabled: true,
  surfaceEnabled: false,
  quality: "high"
});
```

Switching stops new frames, awaits `setWater()`, and resumes the app. OFF releases dedicated GPU resources. Re-enabling preserves combat state and registered Nodes; restart reuses the water body.

This sample creates an underwater scene through lighting. Absorption attenuates the projected caustic field; standard distance Fog approximates water haze toward the camera. Underwater camera refraction, total internal reflection, and the underside of the surface are not rendered. Caustics use horizontal-field projection onto opaque receivers; ordinary PBR handles shadows and specular reflections. See the [water sample](../water/index.html) for the API.

## Change one thing at a time

- Set `palette.steel.roughness` in `visuals.js` from 0.28 to 0.65, then rotate the camera to compare highlights. Shared terrain materials live in `scene.js`.
- Set Rio's `move` in `rules.mjs` from 4 to 3. Column 4, row 5 should no longer be reachable from the initial position. Paths and cyan markers share the same result.
- Increase the segment `duration` in `main.js`: `move()`. Keep combat values unchanged and check input locking and coordinate commitment.
- Change both RGB entries of `steps.appearance.colors` in `scene.js`. Keep emission positions and paths unchanged.

Use the verification points after each change so that its effect has a clear cause.

## Documents and rule checks

[fantasy_design.md](fantasy_design.md) describes the game and its scope in Japanese. `camera_reference.json` records the initial camera reference. The book's [**PBRシーンから小さなゲームへ**](../../book/examples/fantasy_guide.html) explains the boundaries between individual feature examples and this app.

Run from the repository root to check paths, occupancy, range, enemy planning, and outcomes without a GPU. Rendering and interaction require separate browser verification.

```sh
node --test samples/fantasy/rules.test.mjs
```
