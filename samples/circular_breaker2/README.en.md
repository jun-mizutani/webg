# circular_breaker2

Columns and blocks have a strong continuous upper light band, lower strips, and indicator marks. The upper emission mask uses 255 and the lower lamps use 160.

LEVEL, PACK, destroyed-block count, SCORE, phase, and objectives appear beside the title above the canvas. On narrow windows, the header wraps and the canvas fills the remaining height.

The canvas fills the window width and the height below the header. ArenaSceneApp uses ResizeObserver to update Screen, the camera aspect ratio, and PBR render targets. Rendering uses one pixel per CSS pixel.

The play page displays the game name, scores, stage objectives, control hints, and buttons. M toggles diagnostics. PBR shadows and reflections are enabled; SSAO is disabled.

This sample builds a circular Breakout game with SceneYAML, ModelYAML, and PBR.

[Run the sample](./circular_breaker2.html)　[日本語](./README.md)

## Overview

The arena contains a circular floor, seven concentric rings, 48 boundary columns, 28 blocks, and a beveled paddle and puck. The camera follows the paddle. A dark metallic floor and cyan/red emissive rings define the arena.

`scene.yaml` stores the model reference, base materials, and renderer settings. `model.yaml` stores full-size positions, normals, UVs, Node hierarchy, and initial placement. They load as SceneAsset and ModelAsset and connect to PBR through `ArenaSceneApp.create()`. Each Asset retains its YAML source and comments.

## Controls

ArrowLeft / ArrowRight move along the paddle's long axis; A / D rotate it. The following camera makes the surrounding arena rotate around the paddle on screen. Enter, Space, or a click starts play. R resets the puck; K pauses and resumes. On the result screen, R restarts the game. The bottom buttons also support movement and rotation.

P captures a screenshot and O ends the game. M toggles diagnostics including paddle angle and position. Q/W, C/V, J/L, and F/G collect, copy, log, and save diagnostics. Both held keys and short presses released between rendering frames are accepted.

## Implementation

`ArenaSceneApp.js` extends WebgSceneApp and supplies six fixed point lights to Deferred Lighting: cyan, amber, violet, green, red, and blue. They are placed on a radius-36 circle at height 22, each with radius 72 and relative intensity 4.0. Directional intensity is 0.12 and environment intensity is 0.65. Light positions stay fixed while the camera moves. Point lights provide local illumination; the directional shadow remains enabled and SSAO is disabled. Individual point-light shadows are outside this configuration. Edit point lights in `createArenaLights()` and fill lighting in `scene.yaml`.

`main.js` connects Asset loading, the paddle-following camera, input, and the score overlay. It disables the default Orbit camera's input updates and pointer controls, then reparents the eye to the paddle. The relative eye position is `[0, 34, 50]`, its downward pitch is 36 degrees, and the field of view is 52 degrees.

`blockField.js` retrieves placed ModelYAML Nodes and switches their visibility and materials by block type. Standard, tall, and damaged-short meshes are loaded from ModelYAML. The first hit reduces a hard block's height from 12.8 to 6.4. `panelTexture.js` procedurally generates a 512×512 science-fiction casing with four panels around the circumference, seams, shallow grooves, narrow light strips, and three indicator marks. Separate color, height, and emission-mask images produce three GPU textures shared by columns and all blocks. Broad metallic surfaces retain smooth reflections; only white regions of the emission mask glow. Supply blocks retain their casing while their lamps pulse green.

The floor uses metallic 0.72 and roughness 0.18, with SSR reflecting visible objects. SSR cannot capture off-screen or hidden surfaces; reflections combine SSR and IBL. Normal blocks use metallic 0.72 and roughness 0.22; columns use roughness 0.20. Specular remains 1; metallic, roughness, and environment lighting shape the highlights.

`main.js` enables the existing ComputeEffectPipeline Bloom with threshold 1.1 and strength 0.38. It extracts bright HDR regions and combines their glow before tone mapping. Colored ring and supply emissions produce colored halos. Bloom is a screen-space effect, separate from lighting neighboring objects. Base materials and SSR settings live in `scene.yaml`, Bloom settings in `main.js`, and animated supply emission in `gameRuntime.js`.

`gameRuntime.js` and `stageFlow.js` handle movement, collision, reflection, and stage progression. Collision sounds use `GameAudioSynth`. `particleEffects.js` registers the standard `ComputeParticleEmitter` with PBR and emits 32 cyan/warm sparks per collision. Lifetimes range from 0.858 to 1.32 seconds; a circular pool of 480 slots replaces older allocations. CPU code batches emission requests; the GPU generates and updates positions, velocities, and lifetimes. Particles are added to HDR after transparency composition, before Bloom and tone mapping. Simulation runs with Bloom either enabled or disabled. K pauses particles, and restarting clears them. The `estimated` diagnostic is an upper-bound estimate based on maximum lifetime. Opaque scene depth provides occlusion. SSR reads the scene before particle composition. Collision uses dedicated circular-arena calculations; changing model dimensions or placement requires corresponding changes to the collision dimensions in `constants.js`.

## Editing and rebuilding assets

Moving meshes contain their final dimensions in their vertex coordinates, with Node scale set to `[1, 1, 1]`. Updating position or rotation preserves the paddle's 12.4×1.8×3 dimensions and the puck's radius of 1.8.

`tools/buildAssets.mjs` generates both YAML files from the defined dimensions. Run `node samples/circular_breaker2/tools/buildAssets.mjs` from the repository root. It overwrites `model.yaml` and `scene.yaml`, so save any manual YAML edits beforehand. Browser startup reads the generated files directly.

## What to check

After starting, A/D should rotate the view and arrow keys should move the camera with the paddle. Hits increase the score, destroyed blocks disappear, and the first hit shortens hard blocks. K freezes paddle and puck movement; another K resumes play.

Move the camera to check changing floor reflections and column highlights, and check the colored glow surrounding rings and supply blocks.
