# Karakuri Maker / Karakuri Player

Maker lets users place parts, try the machine, and return to editing in the same scene view. Child-friendly controls make it easy to arrange parts and explore their motion.

`karakuri_maker.html` edits a SceneYAML document and `karakuri_player.html` plays the same document. The sample groups blocks, balls, ramps, six colorful dominoes, goals, PBR materials, and static / kinematic / dynamic physics values in one project file.

## How to try it

1. Open `http://localhost:8000/samples/karakuri/`
2. Open `Make` and choose a ball, ramp, block, domino, or goal from the Parts shelf
3. Click a place in the scene to put the selected part there
4. Click a 3D part to highlight it orange, drag it up/down or left/right, and use the turn buttons to tilt the part
5. Use `Another one` to duplicate a part and `Put away` to remove it
6. Use `Undo` to return to the previous making step
7. Press `Try it` to watch the machine in the same scene view. During the trial, choose a speed multiplier from `1.0`, `0.5`, or `0.25` at the top of the 3D view
8. Use `Pause`, `Start again`, and `Edit` to observe and improve the machine
9. Use `Grown-up settings` to save SceneYAML as plain text or gzip. The layout at the time of `Save` is kept for `Use starting layout` in this browser
10. Use `Use starting layout` in `Grown-up settings` to return to the saved starting layout

Maker's `Try it` runs the current editing state in the same view. When Player is opened with its normal URL, it loads the repository's standard SceneYAML instead of preferring a saved SceneYAML. To try another SceneYAML, load it explicitly with Player's `Open` button.

The Player uses the SceneYAML PBR settings with SSAO, SSR, and weak DoF. Emitter balls are added to Compute physics while the scene is running and are collected after their active lifetime. The speed multiplier buttons at the top of the 3D view display `playback.timeScaleOptions` and change only the physics and animation time scale while preserving gravity, mass, friction, and restitution. Clicking Start or Maker's Try it enables audio: a short contact sound plays when a ball rebounds from a floor, wall, part, or goal board, and a different rising sound plays when the goal is reached. The trial continues after the goal message appears.

## SceneYAML exchange

Maker places and moves parts on an XY plane. Drag an empty area with the mouse to orbit the view; after release, it smoothly returns to the front view in about 0.35 seconds. Starting another drag during the return continues from the current view. A drag that starts on a part moves that part on the XY plane. Choose `6 dominoes` and click the scene to place six slightly thinner dominoes in six colors. The standard SceneYAML already places a ramp, a goal, and six colorful dominoes. The ball and launcher are displayed in a bright aluminum color. The default launcher uses balls with a `0.12 m` radius, keeps up to five active balls, and creates up to 24 balls at two-second intervals during a trial. The default scene has a broad, flat visible floor aligned with the horizontal physics plane. The back and side walls cover the floor area with matching width and depth, remain as a visual background for reflections, shadows, and contact shading, and the floor and walls cannot be selected as parts. A layout saved with `Save` is kept in the current browser for `Use starting layout`, while normal Maker and Player startup loads the repository's standard SceneYAML. To move the work to another browser or device, open the saved SceneYAML file.

The physics data for balls and dominoes does not define density; it uses mass and shape size. The default ball has a `0.12 m` radius and a mass of about `19.54 kg`, which gives it an implied density close to aluminum at `2,700 kg/m³`. A domino with size `[0.10, 0.6, 0.32] m` has a mass of `51.84 kg`, giving it the same density as the ball. PBR `metallic: 1.0` controls the visual metal appearance and does not change the physical density. A normal Player startup loads the repository's standard SceneYAML and does not use a saved SceneYAML as its startup input.

`karakuri_scene.yaml` is the exchange data between Maker and Player. Procedural Texture settings share preset names and appearance values; generated image files remain runtime resources. The floor uses `wood.oak.mixed-sawn` with `tile.joint.widthMeters: 0`, and the walls use `ceramic.white.square`; both use `scale: 2` so one pattern period is twice the preset base size and the repetition is reduced. `Primitive.mapRealCuboid()` creates meter-based UVs, and the scale is converted before the Shape is finalized so static floors and walls and dynamically created Boxes use the same pattern size. Use `Open scene` in Maker to validate an edited document before playing it.

## Sample scope

The sample implements mesh selection, XY placement and dragging, turning, duplication, removal, Undo, same-screen physics trials, emitters, contact sounds, a distinct goal sound, contact-based goal messages, and file save/load. The trial continues after the goal message appears. During a trial, check the goal message and domino chain reactions. See [`docs/karakuri.md`](../../docs/karakuri.md) for the detailed design.
