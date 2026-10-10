# joint

`joint` is a sample family for comparing the same gravity-driven Joint scenario through CPU and GPU Compute paths. `joint_cpu_node` uses webg's CPU `PhysicsSpace` and ordinary `Node` drawing, `joint_compute` uses the `ComputePhysicsSpace` GPU Joint buffer and WGSL XPBD solver with direct GPU rendering, and `joint_compute_node` reads GPU physics state back to ordinary CPU-side `Node` objects before drawing

All three applications use the same pendulum, six hanging ropes, and kinematic Capsule crossing the rope centers. Initial positions, Joint distances, rope dimensions, Capsule orientation, and camera settings are defined in `jointScenario.js`, so the processing paths can be compared under the same conditions. The palettes differ to make the rendering paths easy to distinguish

## Run

Start an HTTP server from the repository root and open one of these URLs in a WebGPU-capable browser:

```text
http://localhost:8765/samples/joint/joint_cpu_node.html
http://localhost:8765/samples/joint/joint_compute.html
http://localhost:8765/samples/joint/joint_compute_node.html
```

Detailed English descriptions are available in [joint_cpu_node.en.md](./joint_cpu_node.en.md), [joint_compute.en.md](./joint_compute.en.md), and [joint_compute_node.en.md](./joint_compute_node.en.md). Japanese versions are available in [joint_cpu_node.md (Japanese)](./joint_cpu_node.md), [joint_compute.md (Japanese)](./joint_compute.md), and [joint_compute_node.md (Japanese)](./joint_compute_node.md)

## Three rendering paths

`joint_cpu_node` updates CPU rigid bodies and Joints with `PhysicsSpace.stepFixed()` and renders Nodes through the normal `Space.draw()` path. It is the reference combination of the CPU Joint solver, ordinary Colliders, Shapes, and Nodes

`joint_compute` updates bodies, contacts, and Joints on the GPU with `ComputePhysicsSpace.encodeFixedStep()` and reads the ping-pong `BodyState` directly from a vertex shader. It is the GPU-first path without per-frame physics-state transfer into CPU Nodes

`joint_compute_node` uses the same GPU physics as `joint_compute`, but reads back an explicit state copy, applies the result to ordinary Nodes with `syncNodesFromPhysics()`, and renders with `Space.draw()`. It is useful for comparing GPU-direct rendering with the path that connects Compute physics to an existing Node renderer. Readback is asynchronous, so it can display a later state and adds transfer and Node-update cost

## Shared scenario

The pendulum DistanceJoint length is calculated by rearranging the small-amplitude relation `T=2π√(L/g)` as `L=|g|(T/(2π))²`; gravity `9.80665 m/s²` and target period `3 s` determine the length. Six ropes each contain a static Sphere pivot and ten dynamic Capsule links connected by DistanceJoints. Each link has a `0.06 m` radius, a `0.18 m` centerline segment, a `0.30 m` total length, a `0.305 m` center spacing, an apparent gap of about `0.005 m`, and a mass of `0.50 kg`

The driver Capsule is a gravity-free kinematic body. Its local Y axis is rotated around X by a quaternion so that it points along world Z. Startup moves in the D direction; A/D changes direction and the Capsule stops at either edge. Q selects `quasiStatic`, which prescribes position at each fixed step and passes zero contact velocity. I selects `impact`, which passes a prescribed speed of `0.80 m/s` to the contact solver

## Controls

- `A`: move the driver Capsule left
- `D`: move it right; startup begins in the D direction
- `Q`: select `quasiStatic`
- `I`: select `impact`
- `P`: pause / resume
- `R`: reset to the initial state
- `H`: show or hide the Help Panel
- Drag: orbit the camera　Wheel: zoom the camera

Each application follows its own Help Panel startup state. When expanded, it reports physical conditions, body and Joint counts, pendulum target and measured periods, rope speeds, angular speeds, and Joint error. No HUD text is drawn over the scene

## File layout

```text
joint/
  joint_cpu_node.js       CPU PhysicsSpace + Node drawing
  joint_compute.js        GPU Compute physics + direct GPU drawing
  joint_compute_node.js   GPU Compute physics + readback + Node drawing
  joint_cpu_node.html
  joint_compute.html
  joint_compute_node.html
  jointScenario.js         shared initial conditions and quaternion helper
  README.md / README.en.md
  joint_cpu_node.md / joint_cpu_node.en.md
  joint_compute.md / joint_compute.en.md
  joint_compute_node.md / joint_compute_node.en.md
  index.html / index.en.html
```
