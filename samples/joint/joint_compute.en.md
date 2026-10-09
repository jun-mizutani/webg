# joint_compute

`joint_compute` is a public sample for the `ComputePhysicsSpace` Joint buffer and WGSL XPBD solver. It reproduces the gravity scenario of `joint_cpu_node` with a pendulum, six hanging ropes, and a kinematic Capsule crossing the rope centers in one Compute simulation. The colors are intentionally different from the CPU sample: ropes are blue and purple, the pendulum Sphere is pink, the driver Capsule is yellow, and the massless visual connector is white. The shared initial scenario is defined in `jointScenario.js`

## Run

Start an HTTP server from the repository root and open this URL in a WebGPU-capable browser:

```text
http://localhost:8765/samples/joint/joint_compute.html
```

`samples/joint/index.html` is the comparison index for the three implementations, and `joint_compute.en.md` is this English document. The executable page is `joint_compute.html`

## Controls

- `A`: move the driver Capsule to the left and stop at the left edge
- `D`: move it to the right and stop at the right edge. Startup begins as if `D` were already pressed
- `Q`: `quasiStatic`; prescribe Capsule position and pass zero driver velocity to the contact solver so position correction pushes the ropes
- `I`: `impact`; pass the prescribed Capsule velocity to the contact solver to observe momentum transfer during contact
- `P`: pause / resume
- `R`: rebuild the initial bodies, Joints, and period measurement, then restart from the right-moving state
- `H`: show or hide the Help Panel
- Drag: orbit the camera
- Wheel: zoom the camera

The Help Panel starts visible with its body collapsed. Press `H` to show or hide it. No HUD text is drawn over the scene. When expanded, the panel shows the physical conditions, GPU body and Joint counts, the pendulum target and measured periods, rope linear and angular speeds, and the maximum DistanceJoint position error

## Scenario

Six ropes are built from a static Sphere pivot at the top and ten dynamic Capsule links. Each link has a `0.06 m` radius, a `0.18 m` centerline segment, a `0.30 m` total length, a `0.305 m` center spacing, an apparent gap of about `0.005 m`, and a mass of `0.50 kg`. Collision layer and mask settings disable neighboring-link contacts, so the ropes do not lock together through contacts in addition to their Joint constraints. Contacts between links and the driver Capsule remain enabled. No floor or boundary Plane is registered, so free-end gravity motion can be observed without floor restitution

The driver Capsule is a `bodyType="kinematic"` body with radius `0.33 m`, centerline segment `1.20 m`, and `Y=4.00 m`. Its local Y axis is rotated around X by a quaternion so that its long axis points along world Z, the screen-front/back direction. In `quasiStatic`, each fixed step teleports it to the next prescribed position and passes zero velocity to the contact solver. In `impact`, the same position prescription is accompanied by a prescribed speed of `0.80 m/s`. The mode is selected explicitly with `Q` or `I`, not inferred from speed

The pendulum connects a static Sphere pivot moved `1 m` left in world X from the root of the leftmost rope to a Sphere weight of radius `0.18 m`. Its DistanceJoint length is computed from `T=2π√(L/g)`, rearranged as `L=|g|(T/(2π))²`; gravity `9.80665 m/s²` and target period `3 s` produce approximately `2.2356 m`. The renderer reads the two BodyState positions and draws a white, massless connector between them. The connector is a visual line between the two BodyState positions. Physics uses the pivot, weight, and DistanceJoint

## Compute implementation

`joint_compute.js` passes `ComputeSphereCollider` and `ComputeCapsuleCollider` instances to `ComputePhysicsSpace` body descriptors, then registers `DistanceJoint` descriptors with explicit body IDs through `addJoint()`. `webg/ComputeJointBuffer.js` packs body slots, anchors, distance, compliance, and lambda into a fixed-stride GPU buffer. `webg/ComputeJointSolver.js` generates the independent WGSL XPBD position-correction pass that runs after the contact solver. Joint slots are split into two parity passes. Each dispatch updates every body from one common state, then the ping-pong state is exchanged. Repeating both parity passes for the configured iteration count prevents neighboring joints connected to one body from repeatedly using stale endpoint positions inside a single dispatch and reduces the residual DistanceJoint error near the rope roots. Joint lambda is not read back to the CPU every step

Rendering follows the direct GPU-state approach used by `samples/compute_physics`: the vertex shader reads the current ping-pong `BodyState` after Compute execution. There is no normal per-frame synchronization of body positions, orientations, or colors into CPU Nodes. Pendulum period, rope speed, angular speed, and Joint error are calculated from an explicit `MAP_READ` state readback every eight frames. That readback is used only for diagnostics and does not switch rendering or physics to a CPU-synchronized fallback

Before each Compute fixed step, the app records the kinematic Capsule position command and then calls `ComputePhysicsSpace.encodeFixedStep()`. If a rendered frame needs multiple fixed steps, this order is repeated for every step. `quasiStatic` position correction and `impact` prescribed velocity can therefore be compared through the same GPU physics process

## File layout

```text
joint/
  joint_compute.js
  joint_compute.html
  joint_compute.md / joint_compute.en.md
  jointScenario.js
  index.html / index.en.html
```

The app uses these public-core modules:

```text
webg/ComputePhysicsSpace.js
webg/ComputeJointBuffer.js
webg/ComputeJointSolver.js
webg/ComputeSphereCollider.js
webg/ComputeCapsuleCollider.js
```
