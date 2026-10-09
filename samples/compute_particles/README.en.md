# compute_particles

English | [日本語](README.md)

## Overview

This sample uses `ComputeParticleEmitter` to generate, update, and render 49,152 particles on the GPU. Application code supplies emission position, direction, speed, and lifetime without defining custom WGSL or a particle-buffer layout. Position, velocity, and lifetime are updated in a GPU storage buffer, and the same buffer is read for billboard rendering.

The fountain mode uses one emission request for an upward particle group. The ring mode uses 24 requests placed around a circle. Both modes use the same `ComputeParticleEmitter` API. HDR particle colors use additive blending.

## How to Run

Open [compute_particles.html](./compute_particles.html) through an HTTP server in a WebGPU-capable browser.

## webg Features Used

- `WebgApp`: initializes and manages the Screen, camera, input, compute frame, and GPU submission
- `ComputeParticleEmitter`: groups emission requests, particle storage, uniforms, Compute/Render pipelines, billboard rendering, and lifetime updates
- `GpuParticleEmitter`: the low-level GPU resource base class inherited by the standard emitter
- `OverlayPanel`: displays controls, estimated alive count, pending requests, and rejection count
- `Screen`: provides color/depth views and records particle Compute and Render passes in the same command encoder

## Controls

- `Space`: emit an additional burst of 2,048 sparks
- `1`: switch to fountain mode
- `2`: switch to ring mode
- `P`: pause/resume particle motion and lifetime updates
- `H`: collapse/show the Help panel
- Drag: orbit the camera
- `Shift` + Drag: pan the camera
- Mouse wheel: zoom

## Implementation Details

`main.js` creates `ComputeParticleEmitter` with the following settings.

```js
const emitter = new ComputeParticleEmitter(screen.getGPU(), {
  capacity: 49152,
  preset: "spark",
  targetFormat: screen.getGPU().format,
  overflow: "replace-oldest",
  simulation: { gravity: [0, -0.70, 0], drag: 0.05 },
  appearance: {
    colors: [[1.0, 0.28, 0.04], [0.04, 0.46, 1.0]],
    intensity: 1.26,
    size: [0.006, 0.018]
  }
});
```

Fountain uses one request, while ring uses 24 requests. Each request specifies `position`, `direction`, `spreadAngle`, `speed`, and `lifetime`. Emission requests, camera data, and time are packed into uniforms; the Compute Shader generates initial particle state and updates motion.

`targetFormat` selects the swapchain format for direct Canvas rendering in this sample. For PBR scenes, `WebgSceneApp.createComputeParticleEmitter()` creates the HDR intermediate target and `ComputeParticlePass`.

The displayed `estimated` count is a CPU reservation estimate based on maximum lifetime. Particle positions remain on the GPU during normal rendering, so capacity and emission diagnostics can be displayed without interrupting the GPU-first flow.

## Checkpoints

- 49,152 particles appear in a fountain pattern at startup
- `2` switches to a 24-direction ring pattern
- `Space` emits an additional burst, and `replace-oldest` replaces older particles at capacity
- `P` freezes particle pose and lifetime, and resume advances the simulation
- The Help panel estimated count, request count, and rejection count respond to controls
- The Compute Shader updates particle positions every frame
