# Using the Physics Engine

This chapter explains webg's physics engine for gravity, collisions, restitution, friction, rotation, and sleeping. The CPU (`Central Processing Unit`) `PhysicsSpace` and GPU-compute `ComputePhysicsSpace` use the same concepts to configure body position, orientation, velocity, mass, material, and Box, Sphere, Capsule, and Plane colliders.

Start with the basic arrangement of `Node` and physics bodies in the CPU version. Then learn how to synchronize GPU-computed state with ordinary `Node` objects, and how to pass GPU state directly to rendering to reduce CPU–GPU transfers.

## How to read this chapter

### Prerequisites

This chapter is easier to follow if you know the positions, orientations, and rotations in Chapter 3 and the `WebgApp` update loop in Chapter 5. The API explanations introduce the physics concepts needed here.

### What to read first

Begin with `PhysicsSpace`, `PhysicsNode`, the colliders, and the basic floor-and-box example.

### What to read when you need it

Refer to Chapter 28 for joints, physics materials, contact events, and Compute-version rendering.

### What you will learn

You can register bodies with a `PhysicsSpace` and connect the results from either the CPU or Compute version to the displayed `Node` objects.

## Understanding Motion in the Physics Engine

The physics engine updates positions and velocities over time and determines motion through gravity, collision, restitution, and friction. This chapter explains `PhysicsSpace`, `PhysicsNode`, and `Collider`, starting with the smallest floor-and-box example and continuing to contact events, queries, collision layers, and SceneYAML configuration.

> **Reading path:** To use physics in an application, read “Overall Structure,” “Implementation Example: Dropping a Box onto a Floor,” “PhysicsNode,” “Collider,” “Contact Events and Query APIs,” and “Update Pipeline.” The sections on the Separating Axis Theorem (SAT), contact manifolds, inertia, the solver, and support propagation explain internals for investigating or extending the engine.

Earlier chapters introduced `Node`, `Space`, `Shape`, `SceneYAML`, and scene fundamentals such as ray casting and collision queries. Combining these pieces supports basic rendering, input-driven movement, and overlap checks using bounding boxes.

Games and interactive scenes often need motion such as falling under gravity, bouncing off a floor, stopping through friction, and pushing other objects. Implementing these behaviors separately in each application spreads gravity and collision-response logic across projects. A physics engine makes them reusable as shared update rules.

The webg physics engine is a lightweight foundation for these behaviors. It provides rigid-body physics that integrates with webg's scene graph and coordinate management, with an API designed for learning and extension.

The goal of this chapter is to understand how the positions and velocities updated by the physics engine connect to the transforms used by the rendering scene. First learn the roles and basic operations of `PhysicsNode`, `PhysicsSpace`, and `Collider`. Chapter 28 explains declaring physics objects with SceneYAML. For broad-phase detection, narrow-phase detection, and solver internals, continue to Chapter 42.

## What the Physics Engine Provides

Physics is useful when visual motion and collision results need to remain consistent over time.

A falling box can be animated by calling `Node.move()` or `setPosition()` every frame. As soon as the application must stop it on contact, bounce it according to restitution, reduce sideways velocity through friction, or push several touching boxes apart, coordinate updates alone become difficult to manage.

Collision detection and ray casting are query APIs: they report whether objects touch or intersect. `Space.raycast()` and `Space.checkCollisions()` from Chapter 15 return results for object selection and overlap checks. The physics update handles the response: how to move an object out of penetration and how to change its velocity.

The engine coordinates the following work:

1. Integrating positions from gravity and velocity.
2. Finding candidate pairs in the broad phase.
3. Calculating contact normals and penetration depths in the narrow phase.
4. Correcting positions to resolve penetration.
5. Changing velocities through restitution and friction impulses.
6. Putting resting bodies to sleep and waking them when needed.
7. Notifying the application through contact events and query APIs.

In webg, `PhysicsSpace` and `PhysicsNode` form the center of these features.

## Overall Structure

The physics system separates body state, collision shapes, and simulation progression so they can be configured and exchanged independently. Instead of placing every responsibility on the visual `Node`, it manages static and dynamic bodies, collider types, and simulation time separately.

- `PhysicsNode`: an individual object participating in the simulation.
- `PhysicsSpace`: manages multiple `PhysicsNode` objects and advances the simulation.
- `Collider`: defines shapes for contact detection and queries.

`PhysicsNode` extends `Node`. Physics objects can therefore be placed in a `Space` and given a `Shape` like other nodes. Visual and physical positions live on the same object, so the application does not need a separate synchronization layer for the CPU version.

During simulation, the physics engine controls the transform of a dynamic body. Calling `setPosition()` freely from application code would compete with the physics result. Use `teleport()` for an immediate move, or `pauseDynamic()` / `resumeDynamic()` or `setBodyType()` when temporarily placing a body by hand.

`PhysicsSpace` has a different role from the rendering `Space`. `Space` manages the scene graph and rendering; `PhysicsSpace` manages fixed time steps, gravity, contact resolution, sleeping, and physics queries. `PhysicsNode` connects them by extending `Node`.

A `Collider` is configured independently of the visual `Shape`. A sphere can be rendered with a box collider, for example. A floor that looks like a thin box can use an infinite plane collider for stable contact calculations.

The four collider types are:

- `BoxCollider`: an oriented bounding box (OBB) that follows the body's quaternion orientation.
- `PlaneCollider`: an infinite plane suited to floors and walls.
- `SphereCollider`: a sphere suited to bouncing balls and simple range checks.
- `CapsuleCollider`: a capsule along local Y, with its world-space segment direction rotated by the body's quaternion.

For a `BoxCollider`, the broad phase uses a world-axis-aligned bounding box (AABB) around the OBB to keep the candidate search efficient. The narrow phase, queries, and ray casts test the oriented box itself.

## Implementation Example: Dropping a Box onto a Floor

This minimal example isolates the required pieces—static and dynamic bodies, colliders, gravity, and a per-frame `step()`—from a larger scene. Add the initialization code below and the update code that follows to a module script as in Chapter 4. Saving it as `user/physics_intro/physics_intro.html`, for example, makes the shown relative imports valid.

The box falls from Y=12 onto the plane at Y=0, then settles according to its restitution and friction. Because the box is 2 units tall, its center is near Y=1 when it rests horizontally on the floor. Confirm this setup first to make it easier to isolate the effects of rotation and contact events added later.

```js
import WebgApp from "../../webg/WebgApp.js";
import Shape from "../../webg/Shape.js";
import Primitive from "../../webg/Primitive.js";
import PhysicsSpace from "../../webg/PhysicsSpace.js";
import BoxCollider from "../../webg/BoxCollider.js";
import PlaneCollider from "../../webg/PlaneCollider.js";

const app = new WebgApp({ document, useMessage: false });
await app.init();
app.createOrbitEyeRig({
  target: [0, 3, 0], distance: 24, yaw: 20, pitch: -15,
  minDistance: 8, maxDistance: 40, wheelZoomStep: 1
});
const space = app.space;

const physics = new PhysicsSpace({
  gravity: [0.0, -9.8, 0.0],
  fixedTimeStepMs: 1000.0 / 120.0,
  solverIterations: 4
});

const floor = space.addPhysicsNode(null, "floor", {
  bodyType: "static"
});
floor.setPosition(0.0, 0.0, 0.0);
floor.setCollider(new PlaneCollider([0.0, 1.0, 0.0]));
floor.setPhysicsMaterial({
  restitution: 0.0,
  friction: 0.7
});
physics.addBody(floor);

// Align the top of the visual floor with Y=0, the infinite collision plane
const floorShape = new Shape(app.getGPU());
floorShape.applyPrimitiveAsset(Primitive.cuboid(16, 0.1, 16, floorShape.getPrimitiveOptions()));
floorShape.endShape();
floorShape.setMaterial("smooth-shader", { color: [0.2, 0.6, 0.5, 1] });
const floorVisual = space.addNode(null, "floor_visual");
floorVisual.setPosition(0, -0.05, 0);
floorVisual.addShape(floorShape);

const box = space.addPhysicsNode(null, "box", {
  bodyType: "kinematic",
  mass: 1.0,
  linearDamping: 0.2
});
box.setPosition(0.0, 12.0, 0.0);
box.setCollider(new BoxCollider([2.0, 2.0, 2.0]));
box.setPhysicsMaterial({
  restitution: 0.1,
  friction: 0.5
});
physics.addBody(box);

// Attach a visual Shape with the collider's dimensions to the physics Node
const boxShape = new Shape(app.getGPU());
boxShape.applyPrimitiveAsset(Primitive.cube(2, boxShape.getPrimitiveOptions()));
boxShape.endShape();
boxShape.setMaterial("smooth-shader", { color: [1, 0.5, 0.3, 1] });
box.addShape(boxShape);

box.setBodyType("dynamic", {
  clearVelocity: false,
  restoreVelocity: false
});
```

The box is switched to `dynamic` only after its position and collider are configured. A dynamic body is controlled by the physics engine. Setting it up as `kinematic` first allows the initial `setPosition()` call to place it safely.

Advance the simulation before rendering each frame:

```js
app.start({
  // Convert WebgApp's elapsed seconds to milliseconds and advance physics before drawing
  onUpdate: ({ deltaSec }) => {
    physics.step(deltaSec * 1000.0);
  }
});
```

`PhysicsSpace.step(deltaMs)` divides elapsed time into fixed steps and calls `stepFixed(dtSec)` internally. Fixed steps keep the simulation stable as the browser frame rate varies.

## Compute Physics Engine

The CPU and Compute versions apply the same physics model in different execution environments. Both simulate rigid bodies with body state, colliders, materials, gravity, fixed time steps, contacts, friction, restitution, and sleeping. Their main differences are where state lives, where calculations run, and how results reach rendering.

| Shared item | CPU version | Compute version |
| --- | --- | --- |
| Body state | Position, orientation, velocity, mass, material | Same concepts |
| Body types | `dynamic`, `kinematic`, `static` | Same |
| Colliders | `Box`, `Sphere`, `Capsule`, `Plane` | Corresponding `ComputeCollider` types |
| Physics settings | Gravity, fixed step, restitution, friction, damping | Same meaning |
| Body operations | Set velocity, apply impulse or torque, sleep/wake | Same meaning |
| Simulation | Fixed steps, contacts, friction, sleeping | Fixed steps, contacts, friction, sleeping |

The Compute version stores state in a fixed-size GPU `BodyState` layout, with data structures and contact-candidate generation suited to GPU execution. CPU and Compute may use different operation orders and rounding, while the body types, materials, velocity operations, and sleep/wake concepts remain shared.

In the CPU version, `PhysicsNode` combines physics state and the rendering `Node`, and `PhysicsSpace.step(deltaMs)` updates JavaScript-side state. In the Compute version, register bodies with `ComputePhysicsSpace` and record fixed steps as GPU commands through `encode(commandEncoder, deltaMs)`. This keeps physics and rendering in the same command encoder.

To display Compute results with ordinary `Shape` and `Node` objects, read the state back and call `syncNodeFromPhysics()` or `syncNodesFromPhysics()`. This keeps application rendering close to the CPU workflow. For fewer CPU/GPU transfers, a rendering WGSL shader can read the GPU `BodyState` directly. That path requires application code for the rendering shader, storage-buffer layout, and ordering between Compute and drawing.

Start by configuring the same physics properties as in the CPU version and synchronizing Compute results to `Node` objects. Consider direct GPU-state rendering when body count makes readback or Node synchronization a measured cost.

> **Chapters 20–22:** This section covers the Compute physics APIs, processing stages, and rendering choices. The WGSL syntax, storage buffers, ping-pong buffers, Compute Passes, `WebgApp({ computeFrame: true })`, and recording GPU work and drawing in one command encoder are explained in Chapters 20–22. Refer to those chapters when extending the examples with custom rendering.

### Work Performed by Compute Physics

Compute physics reorganizes state and candidate generation so many bodies can use the same GPU processing flow. It alternates between two `BodyState` storage buffers: one is the fixed step's input and the other its output. Swapping them after each step lets the solver read the previous state while writing the next without competing accesses.

Each fixed step records GPU work in this order:

1. Build predicted AABBs from current positions and velocities.
2. Register predicted bounds in an XZ grid and use swept Y ranges to narrow candidates.
3. Generate each body's candidate bitset once, before solver iterations.
4. Reuse those bitsets in a combined local solver for shape contacts, normals, friction, and position correction.
5. Write linear velocity, angular velocity, contact support, and sleep counters to the next `BodyState`.

Candidate generation is separate from iterative contact response, allowing the solver to reuse candidate bitsets instead of rebuilding them on every iteration. This reduces candidate pairs for dense arrangements while retaining them across local solver passes. Sleeping state persists across fixed steps in `BodyState`, keeping resting bodies inexpensive to update. A sleeping body returns to active simulation when an explicit wake condition is met, such as contact from an active body, normal velocity, or a configured wake threshold.

### Compute Initialization

The Compute version gets the GPU from `WebgApp` and passes it to `ComputePhysicsSpace`. The `bodies` array specifies `position`, `orientation`, velocity, `bodyType`, mass, and a collider such as `ComputeBoxCollider`. Use a positive integer for `id` so a body can be matched to its `Node` after readback.

```js
import WebgApp from "./webg/WebgApp.js";
import ComputePhysicsSpace from "./webg/ComputePhysicsSpace.js";
import ComputeBoxCollider from "./webg/ComputeBoxCollider.js";
import ComputePlaneCollider from "./webg/ComputePlaneCollider.js";

const app = new WebgApp({
  computeFrame: true,
  autoDrawScene: false
});
await app.init();
const gpu = app.getGPU();

const physics = new ComputePhysicsSpace(gpu, {
  maxBodies: 200,
  maxPlanes: 1,
  bodies: [{
    id: 1,
    bodyType: "dynamic",
    position: [0.0, 12.0, 0.0],
    orientation: [1.0, 0.0, 0.0, 0.0],
    collider: new ComputeBoxCollider([2.0, 2.0, 2.0]),
    mass: 1.0,
    material: {
      restitution: 0.3,
      friction: 0.5,
      linearDamping: 0.2,
      angularDamping: 0.2
    }
  }],
  planes: [
    new ComputePlaneCollider([0.0, 1.0, 0.0], {
      planeDistance: 0.0
    })
  ],
  bounds: {
    minX: -8.0,
    maxX: 8.0,
    minZ: -8.0,
    maxZ: 8.0,
    floorY: 0.0
  },
  gravity: [0.0, -9.8, 0.0],
  fixedTimeStepMs: 1000.0 / 120.0,
  solverIterations: 8,
  persistentSleep: true
});
```

`ComputePhysicsSpace` transfers the initial state to the GPU here. The application records and submits GPU work on each frame. It creates a `GPUCommandEncoder`, records the required fixed steps with `physics.encode(encoder, elapsedMs)`, then submits that encoder together with the rendering work. This lets the application control the order when Compute results feed rendering in the same frame.

```js
app.start({
  onComputeFrame({ deltaSec }) {
    const encoder = gpu.device.createCommandEncoder();
    physics.encode(encoder, deltaSec * 1000.0);

    // Record ordinary rendering or custom WGSL that reads BodyState here
    gpu.queue.submit([encoder.finish()]);
  }
});
```

For adding ordinary rendering in the comment's place, see the `computeFrame` and Compute-first explanations in Chapters 20–22. Runnable floor-and-box examples are `book/examples/27_01.html` for CPU physics, `book/examples/27_02.html` for Compute physics synchronized to ordinary `Node` objects, and `book/examples/27_03.html` for a GPU rendering path that reduces CPU/GPU transfers.

### Two Ways to Render Compute State

Compute state can be synchronized to ordinary `Node` objects or read directly by rendering on the GPU. Both use the same `ComputePhysicsSpace` result, but differ in CPU transfers and the rendering code the application supplies.

`book/examples/27_02.html` works without application-written WGSL. Create a readback target with `createStateReadbackBuffer()`, record `encodeStateReadback()` into the same command encoder, and call `readStateReadback()` after submission completes. Then apply positions and orientations to ordinary nodes with `syncNodeFromPhysics()` or `syncNodesFromPhysics()`. This path works naturally with regular `Shape`, `Node`, and `WebgApp` drawing. It also incurs GPU-to-CPU readback, Node updates, and CPU transform work. Because readback is asynchronous, rendering can continue while it completes, with displayed state potentially trailing the latest fixed step.

`book/examples/27_03.html` uses application-written rendering WGSL. `getRenderState()` returns the current state buffer, its index, the body count, and `BodyState` layout information. Use `getStateBuffers()` to prepare bind groups for both state buffers, then select the bind group matching the current `bufferIndex` each frame. A vertex shader can then read state directly without copying positions and orientations to the CPU. This keeps physics and rendering on the GPU and can avoid readback and Node synchronization when there are many bodies. For a small body count, the difference can be small, and the application must describe the rendering WGSL, `BodyState` layout, and ordering of Compute and rendering correctly. Measure the actual workload with body count, rendering method, and update work held constant.

### Diagnostics and Sample-Specific Tracing

To inspect Compute internals, set `diagnostics: true` when creating the space. `getDiagnosticBuffer()` returns the generic GPU diagnostic buffer. Use `createDiagnosticReadbackBuffer()`, `encodeDiagnosticReadback()`, `readDiagnosticReadback()`, and `getDiagnosticsFromReadback()` in order to explicitly read per-body sleep flags, linear and angular velocities, sleep counters, support contacts, wake decisions, and contact-impulse summaries. Normal rendering and simulation do not initiate implicit CPU readback; the application chooses when to copy, submit, and map diagnostic data.

These general diagnostics expose shared Core body state, contact summaries, and solver information without depending on a particular sample. For example, `samples/falling_dominoes/FallingDominoSleepDiagnostic.js` combines a CPU-emulator trace with Core diagnostics to follow impulses on B29–B32 or stage changes on B31. This keeps public Core diagnostics separate from sample-specific data for investigating a fixed scenario.

Input validation, `BodyState` packing, GPU resource creation, WGSL generation, and helpers for querying shapes after readback are grouped as `@internal` implementation details. Applications use the public `encode()`, `getRenderState()`, explicit readback, body commands, and contact queries. Core manages internal buffer layout.

### Compute Colliders and Their Limits

Finite shapes passed to Compute bodies are `ComputeBoxCollider`, `ComputeSphereCollider`, and `ComputeCapsuleCollider`. Infinite floors and walls use `ComputePlaneCollider` entries in the `planes` array. Box, Sphere, and Capsule support combinations with each other and contacts with Plane.

- `ComputeBoxCollider([width, height, depth])`: the full size along each local axis; the body orientation rotates the box into world space.
- `ComputeSphereCollider(radius)`: a radius in world units.
- `ComputeCapsuleCollider(radius, segmentLength)`: a capsule along local Y, rotated into world space by the body's quaternion.
- `ComputePlaneCollider(normal, { planeDistance })`: a plane normal and signed distance from the origin. The distance option is named `planeDistance`.

Compute `BodyState` places the collider center at the body's `position`. Additional translation corresponding to the CPU collider's `colliderOffset.xyz` is outside the current GPU layout. Size-dependent thresholds and tolerances are grouped under `scale.referenceLength` and its ratios.

### Choosing the Compute Version

Compute physics suits workloads that update many bodies by shared rules on the GPU and pass results to subsequent GPU work. CPU `PhysicsSpace` is simpler when JavaScript needs immediate contact events, CPU-side ray casts or query results, or mostly ordinary scene-graph operations.

The Compute version can also provide contacts, manifolds, Plane contacts, and contact events after readback. The application records this readback explicitly at the required time. Rendering can reference GPU state directly, while CPU inspection uses explicit readback; choose according to how and when the application needs contact information.

## Constraints with Joints

Contacts are temporary constraints that act when objects overlap. A Joint maintains a specified relationship between two bodies through anchors or axes, even when the bodies are separated. Ropes, pendulums, doors, wheels, and mechanical assemblies use joints to model these physical connections. Register a Joint with `PhysicsSpace` so it is solved during fixed-step updates alongside gravity and contacts.

The CPU Joint API consists of the shared `Joint`, `JointConstraintRow` for constraint rows, `JointSolver` for XPBD, and four joint definitions. `DistanceJoint` constrains one degree of freedom between anchors; `BallSocketJoint` constrains the three anchor-position degrees of freedom; `HingeJoint` constrains three anchor-position and two axis-orientation degrees of freedom; and `FixedJoint` constrains three position and three relative-orientation degrees of freedom. Each type converts its equations into constraint rows, and `PhysicsSpace` applies the same row solver iteratively to every Joint.

```js
import DistanceJoint from "./webg/DistanceJoint.js";

const ropeJoint = new DistanceJoint({
  bodyA: pivot,
  bodyB: bob,
  localAnchorA: [0.0, -0.5, 0.0],
  localAnchorB: [0.0, 0.5, 0.0],
  distance: 2.0,
  compliance: 0.0,
  collideConnected: false
});

physics.addJoint(ropeJoint);
```

`compliance: 0.0` represents a rigid constraint; a positive value adds softness. The solver derives `alpha = compliance / dt²` from the fixed-step `dt`, preserves a lambda for each constraint row, and computes correction with `deltaLambda = (-C - alpha * lambda) / (effectiveMass + alpha)`. After solving, it reconstructs physical velocity for participating dynamic bodies from their transforms at the start and end of the fixed step. This connects the solver-corrected state to the next step while preserving motion predicted by gravity and contacts. Increasing `jointSolverIterations` and `jointPositionCorrectionIterations` can propagate corrections through chains of connected joints more effectively, with additional computation.

A Joint with `collideConnected: false` suppresses ordinary contacts between its connected bodies while preserving the joint constraint. Call `physics.removeJoint(joint)` before removing a body connected to that Joint. Currently, dynamic bodies participating in an enabled Joint are woken at the beginning of a fixed step so the Joint error is evaluated even when the body was sleeping.

Compute Joints refer to body IDs in the Compute space rather than passing CPU `PhysicsNode` references to the GPU. The Joint buffer combines per-body adjacency, oriented records for sides A and B, XPBD lambda, and recent error fields in one storage buffer. After the contact solver, an independent WGSL XPBD pass runs; each invocation writes only its own oriented record, allowing A and B updates without write conflicts. With `collideConnected: false`, candidate generation excludes ordinary contact between the pair while the separate Joint pass continues to enforce the constraint.

```js
const computeJointId = computePhysics.addJoint({
  type: "DistanceJoint",
  bodyAId: 1,
  bodyBId: 2,
  localAnchorA: [0.0, -0.5, 0.0],
  localAnchorB: [0.0, 0.5, 0.0],
  distance: 2.0,
  compliance: 0.0,
  collideConnected: false
});

computePhysics.encode(commandEncoder, elapsedMs);
```

The Compute version packs the basic constraint rows for `DistanceJoint`, `BallSocketJoint`, `HingeJoint`, and `FixedJoint` into a shared buffer. `maxJoints`, `maxJointsPerBody`, and `jointSolverIterations` set capacities and iteration counts at initialization. Capacity overflow and unregistered body IDs raise errors. `getJointBuffer()` returns the GPU buffer and layout information. Use the explicit diagnostic readback API to inspect lambda values or errors on the CPU.

Joint motors, limits, and break conditions are outside the current implementation.

## `PhysicsNode` Details

`bodyType` selects whether gravity and collision response move an object, application code moves it, or it forms part of the stationary environment. Making the owner of position updates explicit lets static floors remain in place and animated platforms keep their application-controlled motion.

- `static`: a stationary object such as a floor, wall, or terrain.
- `kinematic`: an object moved by a script or Tween. It participates in contact detection but does not receive physical position correction.
- `dynamic`: an object moved by gravity, collisions, restitution, and friction in the physics simulation.

The solver uses each type to choose how it updates position and velocity. To pause physics during an animation and adjust an object's position, use:

```js
box.pauseDynamic({
  clearVelocity: true
});

box.setPosition(0.0, 16.0, 0.0);
box.setLinearVelocity(0.0, 0.0, 0.0);

box.resumeDynamic({
  clearVelocity: false,
  restoreVelocity: false
});
```

For an immediate reposition, use `teleport()`:

```js
box.teleport([0.0, 20.0, 0.0], {
  keepVelocity: false,
  wakeUp: true
});
```

Forces and impulses can also be applied to a body:

```js
box.applyForce([0.0, 30.0, 0.0]);
box.applyImpulse([4.0, 10.0, 0.0]);
box.applyTorque([0.0, 0.0, 120.0]);
```

`applyForce()` affects velocity during the next fixed-step integration. `applyImpulse()` changes velocity immediately, and `applyTorque()` changes angular velocity. Contact resolution uses the contact point and the diagonal inertia in local coordinates, allowing an impulse away from the center to produce rotation.

### Angular Velocity Units and Internal Processing

The public angular-velocity units are degrees per second for `PhysicsNode.setAngularVelocity(x, y, z)`, `getAngularVelocity()`, and the SceneYAML `angularVelocity` property. For example, `[0.0, 90.0, 0.0]` means a 90-degree rotation around Y per second.

This matches the degree-based orientation values used by `Node` and earlier sample code, making rotation speed easier to relate to the visible result.

Low-level physics calculations use angular velocity in radians per second for expressions such as `omega x r` and inertia tensors. `PhysicsSpace` explicitly converts between the public degrees-per-second values and internal radians-per-second values.

- `PhysicsNode.angularVelocity` is stored in degrees per second.
- Orientation integration in `_buildComputeStepQuat()` converts degrees per second to radians per second, constructs a finite-rotation `Δq`, and applies it as `Δq ⊗ q` to the current orientation.
- Contact-point velocity `v + omega x r` uses `omega` converted to radians per second.
- Angular-velocity changes from contact impulses are converted from the radians per second produced by inertia calculations back to degrees per second before storage.
- Torque integration converts angular acceleration from radians per second squared back to degrees per second squared before storage.

Orientation integration derives the rotation angle from angular speed and the fixed step, then builds a finite axis-angle rotation `Δq`. The CPU version uses `PhysicsMath.buildDeltaQuaternionStep()`; the Compute version uses WGSL `integrateOrientation()`. Both calculate `Δq ⊗ q` and apply the same update rule to all CPU collider shapes.

Mixing these units can make visible rotation extremely fast or make the sleep threshold too strict. For example, `sleepAngularThreshold: 0.5` means 0.5 degrees per second; convert the value to radians where calculations use radians.

## Colliders and Physics Materials

Colliders and physics materials communicate collision shape, restitution, and friction to the simulation independently of a visual mesh. Simple collision shapes make contact calculations less expensive while preserving the appearance. Changing the physics material adjusts the behavior of floors, walls, and bouncing objects.

Configure a `Collider` separately from the visual `Shape`:

```js
body.setCollider(new SphereCollider(2.0));
```

The collider constructors are:

```js
new BoxCollider([width, height, depth]);
new PlaneCollider([0.0, 1.0, 0.0]);
new SphereCollider(radius);
new CapsuleCollider(radius, segmentLength);
```

`BoxCollider`, `SphereCollider`, and `CapsuleCollider` have finite bounds and can return an AABB. `PlaneCollider` is infinite and therefore has no AABB; the broad phase handles it as a special shape.

Set a physics material separately from the visual material:

```js
body.setPhysicsMaterial({
  restitution: 0.7,
  friction: 0.05
});
```

- `restitution`: values near `0.0` produce little bounce; values near `1.0` produce a stronger bounce.
- `friction`: affects how much velocity along the contact surface is reduced.

The solver combines the materials of the two contacting bodies. In general, it uses the larger restitution value and combines friction using a geometric mean. If a body has no material configured, `PhysicsSpace` uses `defaultRestitution` and `defaultFriction`.

### Special Handling for `PlaneCollider` and `BoxCollider`

The combination of a static `PlaneCollider` and `BoxCollider` has special handling. When the static plane has `restitution: 0.0`, the plane acts as a non-bouncing floor and its value takes precedence in the floor contact response.

This supports stable beams and long boxes. When the end of a box hits the floor, an upward restitution impulse acts far from its center. The resulting torque can make the beam rise and continue moving, even though the floor material specifies no bounce. For a `plane-box` contact with an explicit floor-side `restitution: 0.0`, webg follows the floor's no-bounce setting.

For `plane-box` contacts, multiple box vertices close to the floor are grouped as a set representing the support face. While a long box or thin plate is tipping onto the floor, a single corner may briefly appear to penetrate. The grouped vertices let the solver treat this as the transition toward face contact. When it can form a vertex group, it builds multiple contact points from the extreme points, reducing the tendency to pivot upright around one point.

## Summary

Registering a `PhysicsNode` with `PhysicsSpace` connects its position, orientation, velocity, mass, and collider to physics simulation. Start with the CPU version to understand Node synchronization and contact, then use Compute when the workload calls for it. Box, Sphere, Capsule, and Plane use the same configuration concepts; Chapter 28 covers post-update workflows such as joints and contact events.
