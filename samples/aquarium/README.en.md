# aquarium — Light beneath the water

English | [日本語](README.md)

![Swimming dolphin and underwater caustics](aquarium.jpg)

## Overview

A compact underwater exhibit with five instances of the supplied dolphin GLB, its embedded texture and skeletal animation.
PBR environment lighting, caustics, fog, subtle floating particles and rising bubbles surround the swimming dolphins.
Caustics illuminate the dolphin, floor, rocks and sea grass. A rippling surface is visible overhead.

## Run and controls

Serve [aquarium.html](aquarium.html) over HTTP and open it in a WebGPU browser.

- Drag to orbit; use the wheel to zoom.
- Use the view button to compare above-water refraction with the thin surface seen from underwater.
- Pause freezes skeletal animation, the swimming path, waves and particles. Camera controls remain active.
- Caustics toggles the entire effect.
- The dolphin light checkbox independently selects the dolphin as a receiver.

The floor and surface measure 18m × 12m. Rocks, sea grass and lamps retain
their positions; surface height remains 6m. Floor UVs retain their physical scale.

## Reading order

1. `scene.js` creates the procedural gravel floor, flat-shaded icosphere rocks and sea grass. Rocks use dark gray with roughness 0.28 to reflect underwater lighting.
2. `start()` in `main.js` initializes `WebgApp`, `PbrRenderer` and the GLB model.
3. `model.instantiate()` creates four additional dolphins from the same asset. Each instance has its own skeleton, animation state and swimming parent Node, while sharing geometry and textures.
4. `updateSwimming()` and `swimmingPath.js` move each parent along its own 3D path at 0.8–0.95m/s. Centers, horizontal rotations, contour bends, vertical cycles and phases vary by dolphin; two swim in the opposite direction. A distance table maintains speed through turns, and the 3D tangent aligns the model's head (+Z) with its actual movement, including ascent and descent. The skeletal clip loops independently. Each dolphin moves vertically by ±0.45m; the parent Nodes span 2.55–3.45m, 2.7–3.6m, 2.4–3.3m, 3.0–3.9m and 2.1–3.0m, keeping clearance above the floor when tilted.
5. `WaterBody.addReceiver()` registers scenery with strength 0.65 and the dolphin with strength 1. Parent registration includes descendant Shapes.
6. `setCaustics()` stops rendering while asynchronous GPU resource changes complete, then resumes it.
7. `waterSurface.js` uses the core `WATER_WAVE_WGSL` to update mesh positions and normals on the GPU. Wavelength is 0.6 with amplitude 0.05.
8. The `pagehide` handler releases the renderer, model runtime, generated materials and manually created Shapes.

## webg features

`WebgApp.loadModel()`, `Node.attach()`, animation playback and pause helpers,
`PbrRenderer` with environment lighting, shadows and fog, `WaterBody`,
`ProceduralMaterials`, and `ComputeParticleEmitter`.

Bubbles are approximated by small blue-white particles emitted from three floor locations.
Their radii vary from 0.04 to 0.095m, with upward speeds of 0.65, 0.8 and 0.95m/s
and slight horizontal spread. Lifetime is calculated from the distance to the surface
and the constant vertical speed, so bubbles fade just before reaching it.
Additive intensity is reduced to 0.25 for faint bubbles that let the background show through.
Pause also freezes bubble emission and ascent.

Dolphins also roll around their forward axis. One large and one small dolphin roll
by up to ±90 degrees; the remaining three roll by up to ±10 degrees.
Each has a different phase and period, while its head remains aligned with movement.

Red and yellow lamps on the floor combine framed emissive bulbs, colored point lights illuminating nearby objects,
and subtle Bloom around the bulb.

## Checkpoints

Check that the eyes follow the body, the tail keeps animating, caustics follow moving receivers,
and pause/resume does not jump ahead after waiting. The dolphin receiver can be toggled independently.
When caustics are off, the ordinary PBR image and water surface remain. Surface resources stay allocated,
and caustic generation stops.

## Scope and assets

The core above-water composite uses `surfaceEnabled: true` for reflection, refraction and RGB absorption.
Above the highest wave point, the underwater mesh is hidden to prevent it from entering the refracted background.
From underwater, a thin PBR mesh at 6m with alpha 0.08 and subdued blue emission
has upward winding and normals, so its back face is visible from below. It is rendered using the same core waves and time as caustics. The underwater mesh color and reflection
are an approximation, without underwater total internal reflection or refractive compositing.
Lighting and fog create underwater color and haze. Linear fog starts 16m from the camera
and increases toward 40m, with density 0.005 limiting the blend to 25% for a faint blue-green haze;
camera-to-object underwater refraction and wavelength-dependent transmission are not simulated.
Caustics use a vertical directional light. Floor normal maps affect lighting but leave geometry flat.
Bubbles are represented by faint point particles.

The supplied `dolphin1_20260719.glb` is included unchanged.
The eye whites and pupils are separate meshes. After loading, their node receives the same
origin translation baked into the body geometry, aligning the eyes with the head.
Its original texture and clip are used;
the three larger dolphins have parent scales 1.25, 1.1 and 1.05.
The two smaller dolphins use 2/3 of the reference scale 1.25 (approximately 0.8333).
The red lamp is at `[-3.2, 0.85, 2.2]`, and the yellow lamp is diagonally opposite at `[3.2, 0.85, -2.2]`.
A `[0.52, 0.43, 0.48, 1]` body color factor darkens the textured skin and reduces its green tint while preserving eye materials.
A white fill light below the dolphins approximates reflected light from the floor,
and a lower initial camera angle makes their pale undersides visible.
Rocks use the shared `buildIcosphere()` helper with one subdivision and flat normals (80 faces each).

See [water](../water/index.html) for surface rendering and resource checks,
[gltf_loader](../gltf_loader/index.html) for model import contracts, and book chapter 35 for the water API.
