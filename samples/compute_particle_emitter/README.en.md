# compute_particle_emitter

English | [日本語](README.md)

## Purpose

This sample displays standard Compute particles in a PBR scene. SceneYAML defines the continuous fountain on the left and burst sparks at the center. A JavaScript-created light emitter appears on the right. The GPU generates initial positions, velocities, and lifetimes, then updates motion. Application code supplies emission conditions.

## Running and controls

Open [compute_particle_emitter.html](compute_particle_emitter.html) through an HTTP server. Drag to orbit and use the wheel to zoom.

The spark and light buttons emit 64 particles. The continuous-emission button stops or resumes new fountain particles. Pause freezes movement and lifetime; bursts requested while paused remain queued until resume. Clear removes particles and queued requests while retaining emission settings, so continuous emission resumes on the next update.

Bloom OFF/ON compares the glow while simulation and particle drawing continue. Opaque depth from the central box and floor provides occlusion. Particle collision with geometry is a separate extension.

## Implementation and settings

`scene.yaml` defines `fountain` and `sparks` in `particleEmitters`. `WebgSceneApp` creates them during initialization, and `getComputeParticleEmitter(id)` retrieves them. `main.js` also uses `createComputeParticleEmitter({ preset: "light", capacity: 256 }, "light")`.

`emit(64, { position, direction, spreadAngle, speed, lifetime })` supplies burst settings. Angles use degrees, speeds use world units per second, and lifetimes use seconds. `startEmission({ rate, ... })` specifies particles per second. `simulation` configures gravity and drag; `appearance` controls two linear HDR colors, intensity, and radius range. All emitters are released with the application.

The displayed estimated count uses CPU reservations and maximum lifetime, including pending bursts. Capacity rejection is reported by `emit()` through `accepted`, `rejected`, and `reason`, and by the diagnostic rejection counter. This sample uses `overflow: "reject"`. Particle generation and motion remain on the GPU, with no per-frame GPU readback.

Particles are added to HDR after transparency composition, sharing Bloom and tone mapping. SSR reads the scene before particles are drawn. See [compute_particles](../compute_particles/index.en.html) for a custom-WGSL particle example.
