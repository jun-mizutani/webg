# falling_dominoes_cpu

English | [日本語](README.md)

## Overview

This sample simulates the same 32 dominoes as `samples/falling_dominoes`, but updates them with the CPU `PhysicsSpace`. Only the leftmost domino receives an initial angular velocity, and Box contacts propagate the fall through the remaining 31 bodies. The dimensions, mass, gravity, restitution, friction, fixed timestep, solver iteration count, sleep conditions, and camera match the Compute sample so the GPU BodyState path and the CPU `PhysicsNode` path can be compared as equivalent scenarios.

The CPU Box/Plane contact path uses the contact processing in `PhysicsSpace`. The sample builds its physical scenario through `BoxCollider`, `PlaneCollider`, `PhysicsNode`, and `PhysicsSpace`.

## How to Run

Open [`falling_dominoes_cpu.html`](./falling_dominoes_cpu.html) in a WebGPU-capable browser. A row of dominoes appears in the center and falls from left to right. WebGPU is used for normal scene rendering, while the CPU `PhysicsSpace` performs the physics update. The Help Panel starts collapsed; press `H` to expand it and inspect the frame interval, GPU Render time and load, JavaScript time and load, active bodies, sleeping bodies, and fixed-step count.

The initial camera matches the Compute sample: `target=(-0.16, -0.13, -0.06)`, `distance=0.28`, `yaw=-67.19`, `pitch=-43.59`, `roll=-29.93`, and `fovX=70.00`. Drag, wheel, keyboard, and pinch zoom use the same settings as the Compute sample.

## webg Features Used

- `WebgApp`: initializes WebGPU, the canvas, depth texture, camera, input, Help Panel, and frame timing
- `PhysicsSpace`: processes fixed steps, gravity, Box/Plane contacts, friction, restitution, position correction, and persistent sleep on the CPU
- `PhysicsNode`: stores CPU physics state and exposes solver-updated position, orientation, velocity, and sleep state to the scene
- `BoxCollider`: provides the finite Box contact shape and inertia for each domino
- `PlaneCollider`: provides the infinite floor contact shape
- `Primitive` and `Shape`: create the domino and floor-board render shapes attached to the PhysicsNodes
- `buildHelpPanelOptions()`: creates the collapsed startup Help Panel and displays frame timing and physics state

## Controls

- `Space`: add angular velocity to the starter domino and restart the chain
- `P`: pause / resume
- `R`: reset to the initial arrangement
- `H`: expand / collapse the Help Panel
- Drag: orbit the camera
- Mouse wheel: zoom

## What to Check

Confirm that the red starter domino falls immediately and transfers contact to the later dominoes. Confirm that the dominoes do not pass through the floor Plane, that fallen bodies remain supported by the floor, and that the sleeping count in the Help Panel increases after the chain settles. The comparison checks equivalent behavior in chain order, floor support, and final settling.

## Implementation Flow

`createInitialDescriptors()` creates the same body positions, Box dimensions, mass, initial angular velocity, and material values as the Compute sample. CPU `PhysicsNode` stores angular velocity in degrees per second, so the descriptor’s radians-per-second value is converted at the boundary into the PhysicsNode. Help Panel speed values are converted back to radians per second so the displayed unit matches the Compute sample.

`createPhysicsSpace()` configures a 120 Hz fixed step, 10 solver iterations, a maximum of 4 substeps, and the Compute sample’s Box candidate padding, support-feature tolerance, position-correction slop, and sleep/wake thresholds. The floor is registered as a static `PhysicsNode` with a `PlaneCollider`; the visible thin floor board is a separate normal Node used only for rendering. The same floor is not registered as both a Box and a Plane, so the infinite Plane alone handles floor contacts.

Each frame, `PhysicsSpace.step(deltaMs)` distributes elapsed time into fixed steps. Each fixed step performs gravity integration, damping, orientation integration, Box candidate generation, Box/Plane contacts, the local impulse solver, position correction, and sleep evaluation. The solver-updated `PhysicsNode` objects are drawn through the normal `WebgApp` scene path, unlike the Compute sample, whose vertex shader reads GPU BodyState directly.

When `R` is pressed, the page reloads and creates a new `PhysicsSpace`, `PhysicsNode`, contact history, and sleep state from the initial conditions. Each trial starts with reset contact history and time accumulator.
