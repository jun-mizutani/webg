# falling_dominoes

English | [日本語](README.md)

## Overview

This sample uses `ComputePhysicsSpace` and `ComputeBoxCollider` to simulate 32 dominoes in a straight line on the GPU: one starter and 31 followers. Only the leftmost body receives an initial angular velocity; the later bodies start still and fall through Box contacts. Box-Box contacts, floor Plane contacts, rotation, friction, and persistent sleep are processed by one Compute Physics flow.

The renderer reads the latest `BodyState` storage buffer returned by `getRenderState()` directly from the vertex shader. It does not read every position and orientation back to the CPU or synchronize them into Nodes every frame. Sleeping bodies are rendered at 75% of their configured color brightness so the stopped state remains visible without making the color too dark, and the sleeping-body count is shown in the diagnostic panel.

## How to Run

Open [./falling_dominoes.html](./falling_dominoes.html) in a WebGPU-capable browser. A row of dominoes appears in the center and falls from left to right. Normal startup issues no additional readback; append `?diagnostics=1` to the URL when the detailed diagnostic panel is needed. The external `FallingDominoSleepDiagnostic.js` module assembles those diagnostics from explicit `BodyState` and contact readbacks. The Help Panel is visible but starts collapsed; press `H` to expand it and inspect the frame interval, GPU Compute time and load, GPU Render time and load, JavaScript time and load, and physics state. The initial camera is approximately `eye=(-0.35, 0.06, 0.02)`, `eyeYaw=-67.19`, `eyePitch=-43.59`, `eyeRoll=-29.93`, `cameraTarget=(-0.16, -0.13, -0.06)`, `eyeDistance=0.28`, and `fovX=70.00`. Wheel, drag, keyboard, and pinch zoom use a speed of 10%.

## webg Features Used

- `WebgApp`: initializes WebGPU, the canvas, depth texture, camera, input, and panel display
- `ComputePhysicsSpace`: manages fixed steps, GPU BodyState ping-pong, predicted AABBs, the XZ Grid, candidate bitsets, the combined solver, and persistent sleep
- `ComputeBoxCollider`: provides domino dimensions, inverse inertia, and Box-Box / Plane contact shapes
- `Primitive` and `Shape`: create a unit cube mesh and instance it from GPU body state
- `getRenderState()`: exposes the current GPU state buffer to the render bind group
- `buildHelpPanelOptions()`: displays frame interval, GPU Compute/Render time, JavaScript time, active bodies, sleeping bodies, and fixed-step count in the Help Panel
- `getWakeLinearThreshold()`, `createStateReadbackBuffer()`, `getContactsFromReadback()`, and `getPlaneContactsFromReadback()`: provide the wake threshold, explicit state readback, and contact reconstruction. Detailed diagnostics are enabled with `?diagnostics=1` by the external `FallingDominoSleepDiagnostic.js` module. B29-B32 pair impulses and B31 solver stages are assembled from the CPU-emulator trace

## Checkpoints

- Confirm that the red starter domino falls and transfers contact to its neighbor
- Confirm that dominoes do not pass through the floor and remain on it after falling
- Confirm that the chain reaches the later dominoes and that settled bodies are eventually counted as sleeping in the panel
- Confirm that the Help Panel is visible and collapsed at startup, then press `H` to inspect the frame interval, GPU Compute/Render time, JavaScript time, active bodies, sleeping bodies, and fixed-step count
- Press `space` to apply an angular impulse to the starter and restart the chain
- Press `P` to stop Compute updates while continuing to render the current GPU state
- Press `R` to restore the same initial pose and angular velocity

## Controls

- Drag: orbit the camera
- Mouse wheel: zoom (10% speed)
- `space`: kick the starter domino and start the chain
- `P`: pause / resume
- `R`: reset
- `H`: expand / collapse the Help Panel

## Implementation Flow

`createBodies()` creates 32 Box bodies with the same dimensions, keeps all of them upright, and gives only the leftmost body an initial z-axis angular velocity of `-7.683333 rad/s`. The later bodies start with identity orientation and zero velocity, and `ComputePhysicsSpace` updates their state after contacts. The Space creates floor and four wall `ComputePlaneCollider` instances from the bounds and records gravity in fixed time steps for the GPU.

This sample uses meters, kilograms, and seconds as its physical units. The domino dimensions are thickness `0.006 m` along the row direction x, height `0.050 m`, and the bottom long side `0.025 m` along z. When the domino falls along x, it rotates around the long bottom edge along z, matching the physical domino orientation. A wood-like density of `700 kg/m³` gives a base mass of about `0.00525 kg`; the mass multiplier is `6.183333`, so each body is about `0.0324625 kg` without changing its dimensions or gravity. The spacing is `0.0225 m`, gravity is `-9.80665 m/s²`, restitution is `0.11`, body `friction` is `0.300833`, `linearDamping` is `0.091667`, and `angularDamping` is `0.133333`. The sleep linear-speed threshold is `0.0133167 m/s`, the wake linear-speed threshold is `0.02665 m/s`, the sleep angular-speed threshold is `0.469167 rad/s`, the wake angular-speed threshold is `0.7175 rad/s`, the contact-speed threshold is `0.007075 m/s`, and the normal-speed threshold is `0.011675 m/s`. The fixed step is 120 Hz, the solver uses 10 iterations, and the maximum substep count is 4. Additional position-correction passes are disabled in the normal path and enabled only for explicit comparisons. `ComputePlaneCollider` does not have a per-Plane friction coefficient, so floor friction also uses the body-side value. Domino-to-domino friction is calculated from both body coefficients; separating floor friction from domino friction therefore requires a core Plane-material extension.

The sample also computes a simple theoretical target from the known size, mass, gravity, and 16.5 mm gap. It assumes that the starter pivots around its lower edge, that its upper corner reaches the vertical face of the next body, that the floor impact reduces the initial `7.683333 rad/s` angular speed to one quarter by angular-momentum conservation, and that friction is ignored. With the thickness set to 6 mm, the resulting contact angle is `19.695 deg`, the center-of-mass drop is `2.474 mm`, the gravitational energy is `0.787 mJ`, and the energy including the post-floor-pivot rotational energy is `0.838 mJ`. The estimated contact-point normal speed is about `0.3521 m/s`, and the estimated normal contact impulse including restitution `0.11` is about `2.013e-3 N s`. This is a theoretical comparison reference based on the dimensions, mass, and assumptions above. The panel shows the same values on its `theory` lines so the measured simulation values can be compared against them.

During each fixed step, the core builds predicted AABBs, filters candidates with the XZ Grid and swept Y ranges, and creates one per-body candidate bitset. The combined local solver then reuses those candidates while iterating normal and friction impulses for Box-Box and Plane contacts. Bodies with sufficiently quiet motion enter persistent sleep; the panel reports the count and the darker render color shows the sleeping state.

When a sleeping body meets the wake condition, the core first predicts the other body’s state at the next fixed step and tests the contact there. That predicted contact is also passed into the body-body solver for the body being woken, instead of stopping at the wake decision. This prevents a wake event from losing its contact impulse before the motion can reach the following domino. The panel can compare `solverInVn` and `solverJ` recorded for the moving side and for the body returning from sleep.

The Render Pass selects the bind group for the `bufferIndex` returned by `physics.getRenderState()`. The Box instance vertex shader reads position, quaternion, half extents, and color from BodyState, so the CPU does not update a Node array every frame. The active/sleeping counters use explicit asynchronous readback separate from rendering even during normal startup. When `?diagnostics=1` is present, the external `FallingDominoSleepDiagnostic.js` module assembles wake diagnostics from state and contact readbacks. Core does not embed fixed body numbers or pair names, so the B29-B32 pair solver inputs, impulses, and B31 stage values come from the CPU-emulator trace. `vN` is the post-solver speed, `wakePeakVn` is found by the sleeping body’s wake scan, and `preFrameVn` is measured at the start of the readback frame rather than at the exact collision instant. `closePeak` is the x-direction closing speed of the body centers, so it is a reference value rather than the theoretical contact-point normal speed. The core contact-wake condition is `vN <= -wakeLinearSpeed`.

## Sample Scope

This sample is intentionally limited to Box bodies and fixed Planes so the Compute Physics flow remains easy to inspect. It does not include Spheres, Capsules, Node synchronization, CPU contact-event access, or an editor for changing the domino row. It does not silently convert unsupported shapes or hide GPU-to-CPU readback behind a fallback.
