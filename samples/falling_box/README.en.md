# falling_box

English | [日本語](README.md)

## Overview

This sample compares a 200-box falling scenario in a CPU version and a Compute version. The CPU page uses the normal `PhysicsSpace` API and its CPU Box contact implementation; the Compute page uses the core `ComputePhysicsSpace`. Both start with the same seed, initial positions, orientations, angular velocities, gravity, five Plane boundaries, fixed timestep, solver iterations, and sleep settings.

## How to Run

 - [CPU falling_box_cpu.html](./falling_box_cpu.html): registers `PhysicsNode` and `PlaneCollider` objects with the normal `PhysicsSpace`
- [Compute falling_box_compute.html](./falling_box_compute.html): uses the GPU BodyState and WGSL solver of `ComputePhysicsSpace` and renders instanced Boxes

Open either page in a WebGPU-capable browser. The Help Panel starts collapsed. Press `H` to expand it and inspect frame interval, GPU Render time and load, JavaScript time and load, active bodies, sleeping bodies, and fixed-step count.

## webg Features Used

- `WebgApp`: initializes WebGPU, the canvas, depth texture, camera, input, Help Panel, and frame timing
 - `PhysicsSpace`: processes CPU fixed steps, Box/Plane contacts, friction, restitution, position correction, and persistent sleep, then synchronizes the result to `PhysicsNode`
- `ComputePhysicsSpace`: processes GPU BodyState, predicted AABBs, the XZ Grid, candidate bitsets, the combined solver, and persistent sleep
- `PhysicsNode`, `BoxCollider`, and `PlaneCollider`: build the CPU Box bodies and infinite Plane boundaries
- `Primitive` and `Shape`: create CPU-sized Boxes and the unit cube used for Compute instancing
- `getRenderState()`: exposes the latest Compute ping-pong BodyState to the renderer

## Shared Scenario

The initial conditions are defined in `fallingBoxScenario.js`. The 200 bodies are arranged in four columns by four rows per layer, with placement jitter reproduced from seed `20260822`. Each body is a Box, and the five Planes represent the floor and four walls. Gravity is `-4.9 m/s²`, the fixed timestep is `1/120 s`, and the solver uses 14 iterations.

The CPU page converts each descriptor into a `PhysicsNode` and `BoxCollider`, then registers the five Planes as static `PhysicsNode` objects in `PhysicsSpace`. `PhysicsSpace` converts those registered Planes into solver inputs and resolves the Box/Plane contacts in one CPU path. The visible floor board is a separate normal Node, so the floor is not solved twice. The Compute page converts the same descriptors into GPU BodyState records for `ComputePhysicsSpace`. CPU `PhysicsNode` stores angular velocity in degrees per second, so the common descriptor’s radians-per-second values are converted when solver state is synchronized to the Node.

## What to Check

Run the CPU and Compute pages with the same scenario and confirm that the 200 bodies fall, contact the boundary Planes, and move toward a settled state. The goal is to inspect the complete fall, contact, and sleep process from the same initial conditions in both backends. The pages also expose the state-transfer difference between CPU `PhysicsNode` scene rendering and Compute GPU BodyState instancing. The CPU page uses the normal `PhysicsSpace` API, whose Box/Plane contacts use the core CPU contact implementation.

## Controls

- `P` or `Space`: pause / resume
- `R`: reload the page and reset the initial conditions
- `H`: expand / collapse the Help Panel
- Drag: orbit the camera
- Mouse wheel: zoom
