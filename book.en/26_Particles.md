# Particles and Lightweight Effects

Sparks at an impact and points of light on pickup communicate the position and intensity of an event for a short time. They can be built from many small camera-facing planes called billboards, varying their origin, velocity, lifetime, and color. Compared with moving separate 3D models, billboards share a shape and make it practical to manage many short-lived effects.

To add emissive particles to a PBR scene, register `ComputeParticleEmitter` with `WebgSceneApp`. Describe emission conditions in JavaScript or SceneYAML; the GPU generates the initial values and updates movement. This chapter focuses on the standard compute particles and explains when to use the CPU-updated `ParticleEmitter` as well.

## How to read this chapter

Knowing the application setup in Chapter 5 and SceneYAML in Chapter 9 makes it easier to separate emitter configuration from runtime controls. First try one-shot emission, continuous emission, stopping, and clearing; then examine capacity and PBR composition order. For a custom WGSL update, continue to `GpuParticleEmitter` in Chapter 36.

## Choose an Emitter for the Rendering Path

`ComputeParticleEmitter` is the standard class for glowing circular particles composited into a PBR image. It generates initial positions, velocities, and lifetimes on the GPU, then reads that state directly for drawing. The application specifies where and how many particles to emit and their direction. It suits short calls from collision or game-progression logic.

`ParticleEmitter` updates particle state on the CPU for standard forward rendering. It supports sparks, smoke, debris, pickup effects built with procedural textures, and shadow billboards placed on the ground. Register it with `WebgApp.createParticleEmitter()` so normal frame processing updates and draws it.

`GpuParticleEmitter` provides a base for defining particle layout and Compute and Render WGSL on the application side. `ComputeParticleEmitter` itself extends this class and shares buffer and pipeline construction. Choose it for custom movement equations or rendering.

## Register Standard Compute Particles in a PBR Scene

Register an emitter with an initialized `sceneApp`. This example creates sparks for repeated use in the scene. Creation is asynchronous; emission calls are available after it completes.

```js
const sparks = await sceneApp.createComputeParticleEmitter({
  label: "collision-sparks",
  preset: "spark",
  capacity: 480,
  seed: 42,
  overflow: "replace-oldest",
  simulation: { gravity: [0, -15, 0], drag: 0.03 },
  appearance: {
    colors: [[8, 3.2, 0.45], [1.2, 5, 8]],
    intensity: 1,
    size: [0.22, 0.44]
  }
}, "collision-sparks");
```

`capacity` is the number of particle slots held at one time. `seed` selects the start of the random sequence and helps compare effects with the same settings, emission order, and time steps. `simulation` sets gravity and velocity decay; `appearance` sets two HDR colors, intensity, and radius range. Colors are linear HDR RGB and can contain components above 1. One particle in three receives the second color.

There are three presets: `spark`, `light`, and `fountain`, with velocity distributions, lifetimes, colors, radii, and gravity suited respectively to sparks, slowly moving points of light, and upward jets. Use a preset as a starting point and override the settings an effect needs. `fountain` describes a fountain-like particle distribution; rendering uses the same emissive billboard as the other presets.

## Emit Particles from an Impact Position

Pass the particle count and emission conditions to `emit()`. Position is in world coordinates, velocity is in world units per second, and lifetime is in seconds. This example uses settings for the sparks in `circular_breaker2`:

```js
// Create sparks that spread upward from the impact point.
function emitHitSparks(position) {
  return sparks.emit(32, {
    position,
    velocity: [0, 12, 0],
    velocitySpread: [22, 9, 22],
    lifetime: [0.858, 1.32]
  });
}
```

`velocitySpread` is the range applied around the base velocity on each axis. `lifetime` gives the minimum and maximum lifetime. The GPU generates an individual value in those ranges for each particle. The sample also changes the base horizontal velocity according to impact direction.

To specify a direction and cone angle, use `direction`, `spreadAngle`, and `speed`. The angle is the maximum number of degrees from the center direction; `direction` describes orientation and is normalized internally.

```js
sparks.emit(32, {
  position: [0, 1, 0],
  direction: [0, 1, 0],
  spreadAngle: 45,
  speed: [2, 5],
  lifetime: [0.5, 1]
});
```

Choose either the velocity-and-spread form or the direction-and-angle form for each emission. Reversed ranges, a zero direction vector, or unknown options are reported as configuration errors.

## Continuous Emission and Time Controls

For a fountain or ambient lights, a rate per second is often easier to tune than a count for each call. `startEmission()` carries fractional emission counts to the next update to preserve the specified rate.

```js
sparks.startEmission({
  rate: 120,
  position: [0, 0.2, 0],
  direction: [0, 1, 0],
  spreadAngle: 16,
  speed: [6, 8],
  lifetime: [1, 2]
});
```

`stopEmission()` stops new continuous emission while existing particles continue until their lifetimes end. `setPaused(true)` pauses movement and lifetime while keeping the camera-aligned display active. One-shot requests received while paused are held until `setPaused(false)` resumes the emitter.

`clear()` resets the current particles, queued requests, random-sequence index, and diagnostic counters. Continuous-emission and pause settings are preserved. Clearing during continuous emission therefore produces new particles starting from the next update.

`WebgSceneApp` passes the frame delta and scene time scale to the emitter. Pause physics and particles through their respective APIs. Use `renderMode: "continuous"` at application creation for ongoing effects. `sceneApp.reset()` clears registered particles; `sceneApp.destroy()` releases particles and drawing resources together.

## Tune Emission from Capacity and Diagnostics

Required particle capacity depends on both emission rate and lifetime. Doubling particles per impact and multiplying lifetime by 1.5 means approximately three times as many slots at a similar impact frequency. `circular_breaker2` uses 32 particles per collision, lifetimes of 0.858–1.32 seconds, and a capacity of 480. Increasing capacity also increases GPU update and instance-drawing work, so check density and cost together.

`overflow: "replace-oldest"` replaces slots according to circular allocation order. `overflow: "reject"` searches for a contiguous free circular region and accepts or rejects the whole request. It considers the size of a contiguous region when free slots are fragmented. Up to 32 emission requests are retained before one update.

The return value of `emit()` contains `accepted`, `rejected`, and `reason`. Capacity shortages use `particle-capacity`; the request-queue limit uses `command-capacity`. Continuous-emission overflow increments `rejectedCount` in `getDiagnostics()`.

`getEstimatedAliveCount()` and diagnostic `estimatedAliveCount` are CPU estimates based on maximum lifetime. They include queued requests, so they can exceed the number currently visible. This estimate lets the application show capacity information without waiting for GPU readback during regular drawing.

## Save Emitter Settings in SceneYAML

Store placement and emission conditions under the scene-level `particleEmitters` field. This is a fragment to add to the SceneYAML from Chapter 9:

```yaml
particleEmitters:
  - id: fountain
    preset: fountain
    capacity: 1024
    seed: 42
    overflow: reject
    emission:
      rate: 120
      position: [-2, 0.2, 0]
      direction: [0, 1, 0]
      spreadAngle: 16
      speed: [6, 8]
      lifetime: [1, 2]
```

Use a unique `id` within the scene. With `emission`, continuous emission starts during initialization. For one-shot effects, define the preset and capacity in the scene and trigger emission from JavaScript.

```js
const fountain = sceneApp.getComputeParticleEmitter("fountain");
fountain.stopEmission();
```

Manage the settings document through the existing SceneAsset save methods, which preserve the original YAML and its comments. Runtime particle state stays on the GPU and remains separate from saved initial settings.

## Connect Particles to PBR Color and Depth

Standard compute particles add light to the linear HDR image after transparency composition. Fog, DoF, bloom, and tone mapping then process that result, letting bright sparks share the scene's exposure. Bloom adds the glow around them; disabling bloom makes it easier to inspect the particle shape and brightness. Particle time updates continue in either state.

For occlusion, particles read the opaque G-buffer's Reverse-Z depth. A particle behind the floor or a box is hidden, while a particle in front remains visible. Design movement equations or collision processing separately when particles should collide with the floor.

SSR reads the scene before particles are added. Fog and DoF use opaque background depth. Choose the rendering setup with this scope in mind when an effect must account for transparent surfaces or particle depth.

## Use CPU-Updated Lightweight Effects

To add sparks or smoke to standard forward rendering, register a CPU-updated emitter with an initialized `app`. Normal `WebgApp.start()` frame processing updates and draws it.

```js
const cpuSparks = await app.createParticleEmitter({
  name: "cpu-sparks", maxParticles: 320,
  useShadow: true, groundY: -7.5, preset: "spark", seed: 31
});
cpuSparks.emit(24, {
  position: [0, 0, 0], positionSpread: [0.3, 0.3, 0.3],
  velocity: [0, 12, 0], velocitySpread: [8, 4, 8],
  gravity: [0, -18, 0], drag: 0.06,
  life: 0.9, lifeSpread: 0.2, size: 1.6, sizeSpread: 0.5,
  color: [1, 0.85, 0.4, 1], colorSpread: [0, 0.08, 0.1, 0],
  shadowAlpha: 0.55, shadowScale: 1.1, shadowY: -7.5
});
```

The CPU version uses `life` and `lifeSpread`; the compute version uses `lifetime: [min, max]`. CPU `preset` selects procedural appearances such as `spark`, `smoke`, `debris`, or `pickup`, and can be changed with `setPreset()`. Set the shadow billboard's `shadowY` to the floor height. The CPU emitter suits small effects whose emission conditions should be easy to inspect from JavaScript.

## Inspect Settings and Appearance in Samples

`samples/compute_particle_emitter/index.html` demonstrates continuous emission from SceneYAML, one-shot emission, stopping, clearing, bloom control, and capacity rejection. `samples/circular_breaker2/index.html` shows sparks emitted from collision positions and directions.

For CPU-updated particles, see `samples/circular_breaker/index.html`; for large-scale particles with custom WGSL, see `samples/compute_particles/index.html`. Choose the update and display path, then combine count, lifetime, and capacity to match the game's action.

## Emit Particles from Gameplay Events

`samples/fantasy/scene.js` declares emitters for footsteps, magic, and hit impacts. `appearance.colors` takes two HDR RGB arrays; repeat one RGB value twice for a single-color effect. Use RGB, not RGBA.

`move()` and `attack()` in `main.js` emit particles at the action's position. `reset()` clears earlier combat particles through each emitter's `clear()`. `WebgSceneApp` handles updates and PBR composition, so the sample does not add its own `step()`. See `PBRSceneToGame.md` and `samples/fantasy/README.md` for game integration, restart, and cleanup.
