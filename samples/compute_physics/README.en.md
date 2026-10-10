# compute_physics

English | [日本語](README.md)

## Overview

This sample uses `ComputePhysicsSpace` to update and render Box, Sphere, and Capsule rigid bodies on the GPU. It registers 72 bodies (24 of each shape) in one physics space and processes all shape-pair and fixed Plane contacts in one combined solver.

Capsules use a mesh made from two spherical halves connected by a cylinder at the equator along local Y. The mesh uses the same radius/center-line ratio as `ComputeCapsuleCollider`, and Capsule-Capsule, Capsule-Sphere, Capsule-Box, and Capsule-Plane contacts run in the same Space.

Body positions, orientations, velocities, and sleep state remain in two `BodyState` storage buffers. The buffers ping-pong at each fixed step, and the vertex shader directly reads the current buffer returned by `getRenderState()`. The sample does not read every position back to the CPU or copy it into a `Node`.

## How to Run

Open [./compute_physics.html](./compute_physics.html) in a WebGPU-capable browser. Colored Boxes, Spheres, and Capsules fall from the upper part of the boundary frame, collide, and settle on the floor. The panel at the upper left starts collapsed so that it does not cover the moving bodies.

Both the normal release launch and the `?debug=1` debug launch create resources without starting an application-side GPU validation scope. `?debug=1` enables the DebugDock so you can inspect startup state and runtime results. WebGPU still performs its own validation, but this sample does not wait on a startup scope or collect its result.

Use [./compute_physics_cpu.html](./compute_physics_cpu.html) for the CPU comparison. This page registers the same 72 bodies as `PhysicsNode` instances in the regular `PhysicsSpace` and uses CPU physics with scene-graph rendering. Both pages read the same initial positions, orientations, velocities, shape dimensions, materials, and five boundary Planes from [./computePhysicsScenario.js](./computePhysicsScenario.js).

## Comparing CPU and Compute

Because both pages start from the same body arrangement, you can compare falling, shape-to-shape contacts, floor and wall support, friction, restitution, and settling. Press `R` to reload either page and return it to the same initial arrangement. GPU and CPU processing use different evaluation orders and rounding, so the useful checks are that bodies remain inside the boundaries, stay finite after contacts, and eventually enter sleep when they settle, with emphasis on physical behavior.

The timing lines follow the work performed by each backend. The Compute page shows `GPU compute`, `GPU render`, `GPU total`, and `JS time`. The CPU page shows `CPU physics` as the median of the most recent 30 fixed-step measurements, together with `JS time` and `GPU render`. The first few seconds include pipeline creation and browser warm-up, so compare several readings after both pages have stabilized, using the same browser and display size. Values from different GPUs or browsers are useful as relative measurements within each environment.

The CPU page uses the regular `PhysicsSpace` as its entry point. `CpuMixedPhysicsPipeline` integrates every dynamic body once per fixed step, then applies the CPU Box contact equations for Box/Box and Plane/Box in each solver iteration. Cross-shape contacts involving Sphere or Capsule update the same `stateMap`. When a Sphere impulse changes a Box stack, the next iteration reevaluates the Box/Box and Plane/Box contacts. The Compute page processes Box, Sphere, Capsule, and Plane contacts in one GPU combined solver across the same solver iterations. CPU and Compute use different geometry implementations and arithmetic order, so the comparison checks coupled contact processing through the normal public entry points as a physical-behavior comparison. The caller-facing entry remains the regular `PhysicsSpace` for CPU and `ComputePhysicsSpace` for Compute.

## webg Features Used

- `WebgApp`: initializes WebGPU, canvas, depth texture, camera, input, and panel display
- `PhysicsSpace`: registers `PhysicsNode` instances as the CPU public entry point and manages fixed steps and contact events
- `ComputePhysicsSpace`: manages fixed steps, GPU BodyState ping-pong, predicted AABBs, the XZ Grid, candidate bitsets, the combined solver, and persistent sleep
- `CpuMixedPhysicsPipeline`: connects CPU mixed shapes through one shared state map and the same solver iterations
- `ComputeBoxCollider`: provides Box dimensions, inverse inertia, CPU-level shape queries, and Box/Sphere/Plane contact manifolds
- `ComputeSphereCollider`: provides Sphere radius, inverse inertia, CPU-level shape queries, and Sphere/Box/Plane contacts
- `ComputeCapsuleCollider`: provides CPU-compatible local-Y Capsule dimensions, quaternion orientation, shape queries, and Capsule-Capsule/Sphere/Box/Plane contacts
- `ComputePlaneCollider`: provides the floor and four XZ walls as fixed Planes, together with CPU-level ray and contact APIs
- `Primitive` and `Shape`: create unit Box, Sphere, and Capsule meshes instanced from GPU state
- `buildHelpPanelOptions()` and `showOverlayPanel()`: show status in a collapsible panel

## Checkpoints

- Confirm that 24 each of Boxes, Spheres, and Capsules appear at startup and fall toward the floor
- Confirm that shape-pair and Plane contacts do not pass through each other and stay inside the walls
- After several seconds, confirm that bodies settle and persistent-sleep bodies take on a slightly bluer tint
- Confirm that the panel shows average FPS, average frame time, active/sleeping body counts, and Box/Sphere/Capsule counts
- Press `P` and confirm that Compute updates stop while the current GPU state continues to render
- Press `R` and confirm that the same initial arrangement returns
- Move the camera and confirm that rendering does not require CPU readback of body positions
- Press `H` or `Show Panel` to open and close the status panel

## Controls

- Drag: orbit camera
- Mouse wheel: zoom
- `P`: pause / resume
- `R`: reset
- `H`: show / hide panel

## Implementation Flow

`computePhysicsScenario.js` exports `createComputePhysicsScenario()`, which creates the body descriptors shared by both pages. `main.js` explicitly connects each descriptor to a `ComputeBoxCollider`, `ComputeSphereCollider`, or `ComputeCapsuleCollider` and passes the array to `ComputePhysicsSpace`. `cpu_main.js` connects the same descriptors to CPU Colliders and `PhysicsNode` instances. Shape type is never inferred from dimensions.

On the CPU page, `PhysicsSpace.stepFixed()` enters `CpuMixedPhysicsPipeline` through `PhysicsStepPipeline`. The pipeline applies gravity, forces, damping, and pose integration once to every dynamic body, then regenerates all shape-pair manifolds from the current state for each solver iteration. Box/Box and Plane/Box use the CPU Box contact equations through `PhysicsContactImpulseSolver`; general pairs involving Sphere or Capsule apply both-body impulses and position corrections to the same `stateMap`. The final state is synchronized back to the original `PhysicsNode` instances, so callers use only the regular `PhysicsSpace` API.

`createBodies()` creates the Compute Colliders for the rendered bodies. The Capsule mesh is generated with the core `Primitive.capsule()` API from spherical halves and a cylinder along local Y; `capsuleVertex` applies the BodyState radius as a uniform scale.

On each frame, `physics.encode()` divides elapsed time into fixed steps. Every fixed step builds predicted AABBs, registers bodies in the XZ Grid, and records candidates whose swept Y ranges overlap into one per-body candidate bitset. The combined solver reuses that bitset across solver iterations and dispatches the contact calculation selected by the explicit collider type.

The Render Pass uses the `bufferIndex` from `ComputePhysicsSpace.getRenderState()` to select a bind group created during initialization. The Box, Sphere, and Capsule pipelines read the same 32-float BodyState and apply position, quaternion, shape dimensions, color, and sleep flag per instance.

Every 12 rendered frames, a small Compute Pass counts sleep flags and collider types in the latest BodyState for the panel. Only five integers—`active / sleeping / Box / Sphere / Capsule`—are returned to the CPU. Positions and orientations are not read back, and no new statistics copy is issued until the previous asynchronous readback completes.

## CPU and Compute API Correspondence

### Collider queries and contacts

In addition to GPU dimensions, inverse inertia, and WGSL libraries, `ComputeBoxCollider`, `ComputeSphereCollider`, and `ComputeCapsuleCollider` expose the same shape-query surface as the CPU Colliders. `getWorldInfo(position, quat)` returns world-space shape information, while `getAabb()`, `intersectRay()`, `overlapsAabb()`, and `overlapSphere()` query an explicit pose. `buildContactWith()` and `buildManifoldWith()` validate and process Compute Box, Sphere, Capsule, and Plane combinations, preserving multiple contacts for Box face contacts. Capsules rotate the CPU-compatible local Y axis with the body quaternion and store `[radius, halfSegment, radius]` in BodyState. The Broad Phase uses an axis-aligned AABB formed by expanding the rotated center-line endpoints by the radius. These methods record no GPU commands and can be used with readback BodyState or for Collider-only validation.

`ComputePlaneCollider` also provides `getWorldInfo()`, `getPlaneDistance()`, `intersectRay()`, `buildContactWith()`, and `buildManifoldWith()`. Its `planeDistance` is the distance compared with `dot(position, normal)`, not the position-offset vector used by the CPU `PlaneCollider`. Because the `ComputePhysicsSpace` BodyState has no collider-offset field, a Box, Sphere, or Capsule registered in the Space must have a zero collider offset; a nonzero value throws during initialization. The `offset` option is rejected with an explicit rename error; use `planeDistance` instead. Capsules use the same local-Y pose convention for the collider and sample mesh; arbitrary-axis conversion is not implicit.

`ComputePhysicsSpace` provides individual body operations alongside whole-array replacement. Use `addBody()`, `removeBody()`, and `getBodies()` for body management. Use `setBodyType()`, `setBodyMass()`, `setBodyGravityScale()`, `setBodyMaterial()`, `setBodyAllowSleep()`, `setBodyTrigger()`, `setBodyCollisionLayer()`, `setBodyCollisionMask()`, and `setBodyFixedRotation()` to change registered body attributes. Body removal preserves the other slot assignments, keeping each ID associated with its original slot.

Use `setBodyLinearVelocity()`, `setBodyAngularVelocity()`, `applyForce()`, `applyTorque()`, `applyImpulse()`, `applyAngularImpulse()`, `teleport()`, `stopBodyMotion()`, `wakeBody()`, and `sleepBody()` for external motion commands. These commands are applied to the GPU `BodyControl` buffer at the next fixed step; forces and impulses are consumed once at that step. Issue commands before recording `encode()` or `encodeFixedStep()` into the command encoder.

Space-wide gravity, fixed timestep, maximum substeps, solver iterations, default friction, default restitution, and sleep thresholds can also be changed through setters and getters. If CPU state is required, use `createStateReadbackBuffer()`, `encodeStateReadback()`, and `readStateReadback()` explicitly. Normal rendering continues to read the GPU buffer directly through `getRenderState()`.

Node synchronization is also available as an explicit operation after readback. Record `encodeStateReadback()` after `encode()`, submit the command buffer, and pass the array returned by `readStateReadback()` to `syncNodeFromPhysics()` or `syncNodesFromPhysics()`. A `PhysicsNode` receives position, quaternion, linear velocity, angular velocity, and the sleep state. A regular `Node` receives position and quaternion. To copy velocity or sleep state into a regular `Node`, provide the corresponding methods and explicitly set `syncVelocity: true` or `syncSleep: true`. In the opposite direction, `syncPhysicsFromNode()` converts a Node pose, or a `PhysicsNode` pose, velocities, and `bodyType` into GPU commands for the next fixed step.

```js
const readback = physics.createStateReadbackBuffer();
const encoder = device.createCommandEncoder();
physics.encode(encoder, elapsedMs);
physics.encodeStateReadback(encoder, readback);
device.queue.submit([encoder.finish()]);

const stateData = await physics.readStateReadback(readback);
physics.syncNodesFromPhysics(stateData, [{ bodyId, node }], {
  syncVelocity: true,
  syncSleep: true
});
```

This synchronization does not issue a GPU copy or asynchronous map by itself. Call it only on frames that need Node synchronization so the direct GPU rendering flow does not wait for readback.

Readback-state queries are also available through `raycastFromReadback()`, `raycastAllFromReadback()`, `queryAabbFromReadback()`, and `overlapSphereFromReadback()`. Each method requires the `Float32Array` returned by `readStateReadback()` as its first argument, so it never falls back to the initial placement or another CPU shadow. Results do not create fake GPU objects; they return `bodyId` and `slot` together with hit position, normal, distance, or AABB min/max. A `filter` callback receives the body information equivalent to `getBodyInfo()`. `ComputePlaneCollider` boundary planes have no body ID and are therefore excluded from these body query results.

```js
const hit = physics.raycastFromReadback(stateData, [0, 1, -2], [0, 0, 1]);
const bodies = physics.queryAabbFromReadback(
  stateData,
  [-0.5, 0, -0.5],
  [0.5, 1, 0.5],
  { includeTriggers: false }
);
```

Body-to-body contacts can be obtained from the same readback state with `getContactsFromReadback()`. Each result contains `bodyAId`, `bodyBId`, slots, a normal, penetration, and a contact point. Face contacts preserve multiple contacts produced by the Collider, and `getManifoldsFromReadback()` returns that manifold form. It does not reconstruct contact impulses that are not present in the readback state, and boundary `ComputePlaneCollider` instances are excluded because they do not have body IDs.

Contacts with Planes such as the floor and walls are returned separately by `getPlaneContactsFromReadback()`. Each result contains `bodyAId`, `bodyASlot`, `planeIndex`, the Plane normal, penetration, contact point, and support-point count. `planeIndex` follows the registration order in `physics.planes`; it is not a virtual body ID for the Plane.

When retaining the previous contact list for this purpose is acceptable, `getContactEventsFromReadback()` returns begin / stay / end differences. The comparison is between readback generations passed to this API, so the caller still explicitly performs the GPU copy, submit, and map.

```js
const contacts = physics.getContactsFromReadback(stateData, { includeTriggers: false });
const planeContacts = physics.getPlaneContactsFromReadback(stateData, { includeTriggers: false });
const manifolds = physics.getManifoldsFromReadback(stateData);
const events = physics.getContactEventsFromReadback(stateData);
```

`getLastContacts()`, `getLastManifolds()`, and `getLastContactEvents()` return the results most recently generated from an explicit readback. Listeners registered with `onBeginContact()`, `onStayContact()`, and `onEndContact()` are notified only when `dispatchContactEventsFromReadback()` is called. GPU contact events are not transferred to the CPU automatically.

To inspect sleep decisions, explicitly read back `BodyState` together with `getContactsFromReadback()` and `getPlaneContactsFromReadback()`, then assemble audit values in application code. The Compute solver has no diagnostic buffer, diagnostic binding, or diagnostic-only branch. When timing is needed, a small explicit timestamp query may still be attached to the physics pass.

Compute entry points corresponding to the CPU `step()` and `stepFixed()` are also available. `step(commandEncoder, elapsedMs)` and `stepFixed(commandEncoder)` record commands just like `encode()` and `encodeFixedStep()`; the caller still submits them. The Broad Phase is fixed to the `xzGrid` returned by `getBroadphaseMode()`, so CPU `bruteForce` and `sweepAabb` modes cannot be selected.

## Sample Scope

This sample renders dynamic, static, and kinematic Boxes, Spheres, and Capsules with fixed Planes. It covers restitution, friction, rotation, persistent sleep, triggers, layer/mask filtering, force commands, shape queries, body contacts, and Plane contacts. Applications explicitly read back a BodyState snapshot before querying GPU results; contact records include geometry and penetration data, while solver impulse values are not part of that snapshot. Capsule Broad Phase uses an axis-aligned AABB around the rotated center line, and the sample renders the local-Y Capsule mesh from spherical halves and an equatorial cylinder.
