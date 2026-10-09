# joint_cpu_node

`joint_cpu_node` is a public sample using the webg CPU `PhysicsSpace` and `DistanceJoint`. It shows a gravity-driven pendulum and six hanging ropes. Press A or D to move a kinematic Capsule, whose long axis points toward the front/back of the screen, across the middle of the ropes and observe the contact influence propagate through the Capsule links connected by Joints. The shared initial scenario is defined in `jointScenario.js`

## Run

Start an HTTP server from the repository root and open the following URL in a WebGPU-capable browser:

```text
http://localhost:8765/samples/joint/joint_cpu_node.html
```

`samples/joint/index.html` is the comparison index for the three implementations, and `joint_cpu_node.en.md` is this English document. The runnable page is `joint_cpu_node.html`

## Scenario

The pendulum on the left connects a static Sphere pivot and a Sphere weight with one `DistanceJoint`. Its distance is calculated from the small-amplitude relation `T=2π√(L/g)`, rearranged as `L=|g|(T/(2π))²`; gravity `9.80665 m/s²` and the target period `3 s` produce about `2.2356 m`. The white Capsule between the pivot and weight is an ordinary visual Node. It is not registered in `PhysicsSpace` and has no mass, gravity, collision, or Joint. The Help Panel reports the target period and the measured period from successive downward crossings

The six ropes each contain a static Sphere top pivot and ten dynamic Capsule links connected by `DistanceJoint`s. Each link has a `0.06 m` radius, a `0.18 m` centerline segment, a `0.30 m` total length, a `0.305 m` center spacing, an apparent gap of about `0.005 m`, and a mass of `0.50 kg`. Collision layers and masks disable neighboring-link contacts while retaining contact between the rope links and the driver Capsule. No floor or boundary Plane is placed

The driver Capsule is a gravity-free kinematic body. Its local Y axis is rotated around X by a quaternion so that it points along world Z, making the object long in the screen-front/back direction. Startup begins as if the D key were pressed, so it moves right; A and D change direction, and the Capsule stops at either edge. In `quasiStatic` mode selected by Q, the sample prescribes its position at each fixed step and presents zero velocity to the contact solver. In `impact` mode selected by I, the same position prescription presents a prescribed velocity of `0.80 m/s`. The mode is not selected automatically from speed

## Relationship to webg core

`joint_cpu_node.js` directly imports `WebgApp`, `PhysicsSpace`, `CapsuleCollider`, `SphereCollider`, `Primitive`, `Shape`, `DistanceJoint`, and `JointMath` from `webg/`, then registers core PhysicsNode instances through `Scene.addPhysicsNode()`. The core XPBD solver handles Joint position constraints with `jointSolverIterations=16` and `jointPositionCorrectionIterations=16`. The sample-local `KinematicMotionController` only converts A/D input into a kinematic body position and contact velocity; it does not duplicate collision or Joint solving

The sample distributes frame time into fixed steps and updates the Capsule position command immediately before each `PhysicsSpace.stepFixed()` call. This makes the order between input-driven position prescription and physics explicit even when a frame requires multiple fixed steps. Visual and collision shapes use matching pairs: `Primitive.capsule()` with `CapsuleCollider`, and `Primitive.sphere()` with `SphereCollider`

## Controls

- `A`: move the driver Capsule left and stop at the edge
- `D`: move the driver Capsule right and stop at the edge; startup begins in the D direction
- `Q`: switch to `quasiStatic` and push the ropes with a zero-velocity position prescription
- `I`: switch to `impact` and present the prescribed velocity to the contact solver
- `P`: pause / resume
- `R`: reset initial positions, orientations, velocities, and period measurement
- `H`: show or hide the Help Panel
- Drag: orbit the camera
- Wheel: zoom the camera

The Help Panel starts hidden. Press `H` to show it and inspect gravity, body and Joint counts, rope count, pendulum target and measured periods, driver position and velocities, current and peak rope values, contact count, and maximum Joint position error. No HUD text is drawn over the scene

## File layout

```text
joint/
  joint_cpu_node.js
  joint_cpu_node.html
  joint_cpu_node.md / joint_cpu_node.en.md
  jointScenario.js
  index.html / index.en.html
```
