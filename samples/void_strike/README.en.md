# VOID STRIKE — Rift Defense

VOID STRIKE is a 3D shooter about intercepting enemy formations emerging from an interstellar rift. The player flies through enemy craft, red tracking shots, and luminous ring gates while firing twin blue-white lasers. Chain kills to increase the score multiplier and use a boost to break through incoming fire. PBR metal ships, colored lighting, emissive gates, Bloom, and Compute sparks combine to make every action fill the screen with feedback.

## Running and controls

Open [void_strike.html](void_strike.html) in a WebGPU-capable browser and select `START RUN`. Enemy speed and durability increase as waves progress, and red enemy shots cross the flight path. The battle continues until the ship runs out of hull; the result screen shows the score and highest wave reached.

- `W` / `A` / `S` / `D` or arrow keys: move the ship in four directions
- `Space`: continuously fire both laser cannons
- `Shift`: spend energy for faster movement and protection from enemy shots
- `P` / `Esc`: pause and resume
- On-screen directions, FIRE, and BOOST: touch or pointer controls
- `SOUND`: start or stop the 175 BPM BGM and synthesized effects

The Canvas fills the window. The top HUD shows score, wave, hull, and kill chain; the lower-left meter shows available boost energy.

## webg features used

`ShooterApp` extends `WebgSceneApp` and connects cyan, violet, amber, and red point lights to PBR rendering. The camera stays at a fixed distant view over the battle, and Canvas dimensions follow window resizing. A directional shadow map, SSR, and Bloom render metallic ships and emissive details; SSAO and depth of field are disabled.

SceneYAML defines the dark environment, tone mapping, SSR, and two `ComputeParticleEmitter` systems. Hits and damage emit cyan, red, and amber sparks at their world positions, updated on the GPU. Ships, enemies, and lasers are prepared as pooled instances of shared Shapes; gameplay updates their transforms and visibility. The starfield combines 300 small octahedra into one mesh, with moving ring gates and a flight grid to convey speed and depth.

Collision, scoring, and wave progression use a compact sample-local game update. Player bolts are checked against enemies, enemy shots against the player, and hits reduce enemy hull points. `GameAudioSynth` plays its 175 BPM `run_neon` score and synthesized effects. Audio starts after the SOUND control is used; master volume is 42% and BGM volume is 28%.

## What to check

After starting, the blue player craft and red enemies move in opposing directions, and Space fires two laser bolts at once. Hits produce sparks; destroying an enemy increases score and kill chain. Later waves add larger enemies that require multiple hits.

Enemy fire reduces hull on contact. A brief shield blink prevents repeated damage during the same impact window. Holding Shift drains the boost meter and protects the ship from shots; the meter recovers gradually after boosting. PAUSE freezes combat and can resume it. The on-screen direction keys, FIRE, and BOOST provide the same controls on touch devices.

## Reading the implementation

`scene.yaml` defines PBR, SSR, and particle settings. `space_scene.js` builds the starfield, gates, ships, and reusable projectile pools. `ShooterApp.js` installs lighting, camera, and Canvas resizing. `main.js` handles controls, collisions, waves, scoring, HUD, and audio. Sample-specific code stays in this folder and uses the published webg core files directly.
