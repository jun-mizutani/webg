# Physics Events, Configuration, and Updates

This chapter connects the simulation from Chapter 27 to application logic. Use contact events for collisions and triggers, queries for spatial checks, and SceneYAML for declarative configuration. The later sections explain fixed-step processing, sleeping, and how to choose validation examples.

## How to read this chapter

### Prerequisites

This chapter is easier to follow if you know the basics of `PhysicsSpace`, `PhysicsNode`, and `Collider` from Chapter 27.

### What to read first

Start with `getLastContacts()`, contact events, queries, collision layers, and SceneYAML configuration.

### What to read when you need it

Refer to the fixed time step, detection stages, solver, sleeping, tests, and CPU/Compute comparison when tuning the simulation.

### What you will learn

You can connect physics updates to the application update flow and use events and configuration to handle contacts and sleeping.

## Contact Events and Query APIs

`PhysicsSpace` retains contact information from its most recent step so the application can use it.

```js
physics.step(deltaMs);

for (const contact of physics.getLastContacts()) {
  console.log(
    contact.bodyA.getName(),
    contact.bodyB.getName(),
    contact.normal,
    contact.penetration
  );
}
```

Listeners can report when a contact begins or ends:

```js
const offBegin = physics.onBeginContact((event) => {
  console.log("begin", event.bodyA.getName(), event.bodyB.getName());
});

const offEnd = physics.onEndContact((event) => {
  console.log("end", event.bodyA.getName(), event.bodyB.getName());
});

// Unsubscribe when the listeners are no longer needed
offBegin();
offEnd();
```

A trigger body (`isTrigger: true`) appears in contact events and acts as a sensor. It can detect a goal, an entered region, or another range condition while leaving physical pushback and restitution to the regular bodies.

```js
const sensor = space.addPhysicsNode(null, "sensor", {
  bodyType: "static",
  isTrigger: true
});
sensor.setCollider(new BoxCollider([6.0, 3.0, 6.0]));
physics.addBody(sensor);
```

### Querying the Physics Space

The query APIs inspect the space separately from contact resolution.

#### `raycast()` and `raycastAll()`

Ray casts test objects along a ray from an origin in a direction. They are useful for picking from the camera or checking for obstacles ahead.

```js
const hit = physics.raycast(
  [0.0, 10.0, 20.0],
  [0.0, -0.2, -1.0],
  {
    maxDistance: 100.0,
    includeTriggers: false,
    layerMask: 0xffffffff
  }
);

if (hit) {
  console.log(hit.body.getName(), hit.position, hit.normal, hit.distance);
}
```

`raycast()` returns the first hit. `raycastAll()` returns every matching hit, sorted by distance.

#### `queryAabb()`

`queryAabb()` collects bodies overlapping an axis-aligned bounding box. Use it to narrow a broad region to candidates before applying more detailed conditions.

```js
const bodies = physics.queryAabb(
  [-5.0, 0.0, -5.0],
  [ 5.0, 8.0,  5.0],
  {
    includeTriggers: true
  }
);
```

The result contains bodies overlapping the specified AABB.

#### `overlapSphere()`

`overlapSphere()` finds bodies overlapping a spherical region defined by a center and radius. It suits direction-independent queries such as explosion ranges, proximity checks, and spherical sensors.

```js
const overlaps = physics.overlapSphere(
  [0.0, 4.0, 0.0],
  6.0,
  {
    triggerOnly: true
  }
);
```

The result contains bodies overlapping the sphere, making it useful for area attacks and proximity checks.

Queries can combine options such as `includeTriggers`, `triggerOnly`, `layerMask`, and `filter` to select the desired bodies.

## Collision Layers and Masks

Use collision layers and masks to control which bodies participate in contacts and queries.

```js
const PLAYER = 1 << 0;
const ENEMY = 1 << 1;
const SENSOR = 1 << 2;

player.setCollisionLayer(PLAYER);
player.setCollisionMask(ENEMY | SENSOR);

enemy.setCollisionLayer(ENEMY);
enemy.setCollisionMask(PLAYER);
```

Two bodies become a contact candidate when each body's mask includes the other body's layer.

Use the query option `layerMask` to restrict results to selected layers:

```js
const enemyHits = physics.overlapSphere(player.getPosition(), 12.0, {
  layerMask: ENEMY
});
```

## Declaring Physics Settings in SceneYAML

In SceneYAML, configure scene-wide gravity and fixed time steps under `physics.space`, and each object's mass and initial velocity under `objects[].physics`. Visual materials and physics materials for restitution and friction are separate. Chapter 9's `WebgSceneApp` connects loading the definition to Compute physics updates, GPU state readback, and Node synchronization.

Save the following as `scene.yaml` to make a ball fall from a height of 8 m. The floor combines a visual Box with a physics Plane at height zero; the ball starts with horizontal velocity and angular velocity around Y.

```yaml
format: webg-scene
version: 1

physics:
  space:
    gravity: [0.0, -9.8, 0.0]
    fixedTimeStepMs: 8.3333333333
    maxSubSteps: 8
    maxBodies: 1
    solverIterations: 10
    defaultRestitution: 0.0
    defaultFriction: 0.4
    planes:
      - normal: [0.0, 1.0, 0.0]
        planeDistance: 0.0

objects:
  - id: floor
    shape: {type: box, size: [20.0, 0.2, 20.0]}
    transform: {position: [0.0, -0.1, 0.0]}
    material: {color: [0.25, 0.3, 0.4, 1.0], metallic: 0.0, roughness: 0.5}
  - id: ball
    shape: {type: sphere, radius: 1.0}
    transform: {position: [0.0, 8.0, 0.0]}
    material: {color: [0.9, 0.3, 0.1, 1.0], metallic: 0.0, roughness: 0.25}
    physics:
      bodyType: dynamic
      mass: 1.0
      linearVelocity: [2.0, 0.0, 0.0]
      angularVelocity: [0.0, 90.0, 0.0]
      material: {restitution: 0.7, friction: 0.05}

renderer:
  profile: studio
  environment:
    preset: dark-studio
    resolution: {width: 128, height: 64}
```

`linearVelocity` uses units per second; `angularVelocity` uses degrees per second. The ball begins rotating around Y at 90 degrees per second. An omitted initial velocity defaults to zero.

The visual dimensions and collision dimensions of the ball share the `shape` definition. To attach physics to an inline mesh or external model, explicitly set a Box, Sphere, or Capsule under `physics.shape`. Increase `maxBodies` as the number of physics bodies grows. Planes do not count toward this limit.

Create the scene in JavaScript and start its update loop. After initialization, the internal frame processing advances fixed steps and synchronizes the display:

```js
import { createWebgSceneApp } from "../../webg/app/index.js";

const sceneApp = await createWebgSceneApp({
  project: "./scene.yaml",
  physics: {enabled: true, paused: false},
  camera: {target: [0.0, 2.0, 0.0], distance: 18.0}
});
sceneApp.start();
```

This section shows Compute physics configured through SceneYAML. The next section explains the CPU `PhysicsSpace.step(deltaMs)` update order.

## Physics Update Pipeline

The update order advances state with consistent time steps even when frame rate changes, then applies candidate generation, contact detection, response, and sleeping coherently. Understanding the stages helps identify where to reduce cost or improve accuracy. This section follows the internal processing of `PhysicsSpace.step(deltaMs)`.

### Fixed-Time-Step Management

The browser's `requestAnimationFrame` interval varies. `PhysicsSpace` accumulates `deltaMs` and calls `stepFixed(dtSec)` for each `fixedTimeStepMs` interval, keeping simulation behavior stable as frame rate changes.

### Broad Phase

The broad phase coarsely identifies pairs that may collide.

The default `sweepAabb` mode sorts finite colliders along X and scans them to narrow the candidate set efficiently. A `bruteForce` mode checks every pair for validation. Infinite shapes such as `PlaneCollider` are handled specially and kept as candidates.

### Narrow Phase

For each pair selected by the broad phase, the narrow phase calculates actual contact normals and penetration depths.

In webg, general shape-pair contact calculations are delegated to each collider through `Collider.buildContactWith()`. Box/Box and Plane/Box use CPU Box-contact routines. In a mixed-shape `PhysicsSpace`, `PhysicsContactDispatcher` selects those pairs explicitly. In a space containing only Boxes and Planes, `CpuBoxPhysicsAdapter` connects the same contact routines to `CpuBoxPhysicsSolver`. `BoxContact.js` calculates Box/Box SAT and representative contact points; `PlaneBoxContact.js` calculates Plane/Box support points. This structure allows general shapes and CPU Box contacts to be extended through their distinct paths.

### Solver

The solver corrects positions and velocities using the contact data from the narrow phase:

1. Exclude trigger bodies from physical response.
2. Wake sleeping bodies when needed.
3. Correct positions according to penetration depth.
4. Apply normal restitution impulses using contact-point velocity `v + omega x r`.
5. Apply friction impulses to tangential velocity.
6. Update sleep candidates from linear velocity, angular velocity, support contacts, and contact-speed thresholds.

Increasing `solverIterations` improves stability in stacks of bodies and increases computation.

### Sleeping and Waking

A body enters sleep after it has support contacts and its linear velocity, angular velocity, and contact velocity have stayed below their thresholds for `sleepStepsThreshold` steps. `sleepAngularThreshold` is measured in degrees per second. Sleeping bodies are excluded from integration, substantially reducing computation. Contact with an active dynamic or kinematic body wakes them for simulation again.

CPU Box contacts include Plane support-point counts, Box-to-Box support contacts, and upward friction support from walls in their sleep conditions. The solver passes its calculated position, velocity, and angular velocity into the next check, preserving the body's current orientation. When every dynamic body sleeps, saved contacts and events let the whole space take a fast path. If any body remains active, normal contact discovery and solving continue.

## Current Feature Scope

The physics engine efficiently supports use cases such as:

- Boxes and spheres falling onto floors.
- Spheres bouncing inside a low-walled area.
- Tuning restitution and friction.
- Event detection through trigger regions.
- Spatial queries using ray casts, AABBs, and sphere overlaps.
- Declaring physics bodies and space settings in SceneYAML.

The following features define the limits of the current implementation:

- Exact OBB tests in the broad phase; it uses an enclosing AABB for candidate filtering and tests the OBB in the narrow phase.
- A solver that jointly solves multiple contact points for arbitrary shape pairs. Compute Box face contacts currently process up to four points in sequence.
- Full support for non-diagonal inertia tensors.
- Continuous collision detection (CCD).
- Joint motors, limits, break conditions, and ragdolls.

## Tests and Samples for Verification

Unit tests are organized by responsibility:

- `headless_tests/core/physics_node`: checks the standalone `PhysicsNode` API contract.
- `headless_tests/core/physics_space`: checks gravity, fixed time steps, contacts, queries, sleeping, layer masks, and related features.
- `user/joint/core_test.js`: independently checks four CPU XPBD Joint types, position correction, contact suppression, and body-removal rules.
- `unittest/physics_node_fall`: visually checks a box falling and settling on the floor.
- `unittest/physics_node_rotate`: visually checks angular velocity, torque, and fixed rotation (`fixedRotation`).
- `samples/physics_bounce`: a public sample with balls bouncing against floors, walls, and one another; use it to see restitution and interactions, or check load with `?count=1000`.
- `samples/compute_physics_bounce`: a comparison sample that updates ball movement and contacts in a Compute shader. It draws instances directly from ping-pong storage buffers and supports load checks up to `?count=512`.
- `book/examples/27_01.html`: the minimal CPU `PhysicsSpace` floor-and-box example.
- `book/examples/27_02.html`: a basic Compute `ComputePhysicsSpace` example that reads state back and synchronizes it to ordinary `Node` objects without user-written WGSL.
- `book/examples/27_03.html`: a Compute configuration that reduces CPU/GPU transfers by letting rendering WGSL read `BodyState` directly and continuing Compute and rendering on the GPU.
- `samples/project_app/project_app_sphere_plane_project.yaml`: an example of visual shapes, a physics Plane, and Compute body configuration in SceneYAML.
- `unittest/scene_mesh/check.mjs`: checks SceneYAML inline meshes and explicitly configured colliders.

In particular, `samples/physics_bounce` offers an intuitive overview of physics behavior and serves as a practical behavior check.

### Comparison with the Compute-Shader Sample

`samples/compute_physics_bounce` focuses on balls to illustrate GPU-side state updates. It has a different responsibility from the general-purpose `PhysicsSpace`, which includes rotation, sleeping, contact events, layers, and query APIs. The sample keeps ball-state updates and rendering on the GPU.

The current `ComputePhysicsSpace` separately provides a public API for combinations of Box, Sphere, Capsule rotated from local Y by a quaternion, and Plane. It uses predicted AABBs, an XZ grid, per-body candidate bitsets, a combined local solver, and persistent sleep state to retain concepts shared with the CPU version while supporting many bodies on the GPU. Refer to “Compute Physics Engine” in Chapter 27 and `book/examples/27_02.html` / `book/examples/27_03.html` for Compute usage and rendering. Chapters 20–22 explain WGSL and GPU processing in general.

In the Compute-shader sample, one invocation handles one sphere. All invocations read the same previous-state buffer and write only their own next state to a separate buffer. The ping-pong arrangement swaps read and write buffers to avoid concurrent writes to the same sphere's velocity.

Sphere pairs are checked by a straightforward all-pairs scan, with complexity $O(N^2)$ for $N$ spheres. This makes the sample an applied example for the following concepts:

- Rigid-body state in a storage buffer with a fixed capacity.
- Gravity, damping, and position integration.
- Sphere collisions with planes and walls.
- Restitution impulses and simple friction between equal-mass spheres.
- Conflict-free updates using ping-pong buffers.
- Instance rendering from Compute results without returning them to the CPU.

The CPU `physics_bounce` sample demonstrates application-oriented physics, including contact events and sleeping. The Compute-shader sample demonstrates the data flow for parallel GPU updates of many independent states.

## Summary

`PhysicsSpace` exposes step results to applications through contact events, queries, and sleep states. Reviewing fixed time steps, layers, joints, and the CPU/Compute comparison separately helps clarify the relationship between display updates and physics updates. For collision detection and contact-solver internals, see Chapter 42, “Physics Engine Design.”
