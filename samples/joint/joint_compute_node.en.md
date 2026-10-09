# joint_compute_node

`joint_compute_node` is a comparison sample that uses the same `ComputePhysicsSpace` GPU Joint scenario as `joint_compute`, but synchronizes the computed state into ordinary CPU-side `Node` objects before drawing. It makes the boundary between GPU physics, readback, `syncNodesFromPhysics()`, and standard `Space.draw()` explicit. The shared initial scenario is defined in `jointScenario.js`.

## Run

```text
http://localhost:8765/samples/joint/joint_compute_node.html
```

## Difference from `joint_compute`

`joint_compute` reads the ping-pong `BodyState` directly from a vertex shader. This sample records `ComputePhysicsSpace.encodeStateReadback()`, submits the command buffer, reads the state with `readStateReadback()`, and updates ordinary `Node` transforms with `syncNodesFromPhysics()`. Rendering then uses `Space.draw()` and `SmoothShader`, without a Compute-specific renderer.

WebgApp owns the command encoder for the normal frame path. `onBeforeDraw` closes the default Render Pass, records the Compute work and readback copy into the same encoder, and reopens a Render Pass for Node drawing. WebgApp closes the pass, resolves the `FrameTimer` GPU queries, and calls `queue.submit()` at the end of the frame; the next frame's `onUpdate` starts the asynchronous readback. This keeps GPU timing queries and the physics readback in one command buffer.

The GPU-to-CPU transfer and Node updates cost more than GPU-direct rendering for a large number of bodies. The benefit is that the normal Shape, Node, and WebgApp rendering path remains available. Because readback is asynchronous, a completed state is shown on a subsequent frame, with a readback delay between GPU state and display.

## Scenario and colors

The sample registers six hanging ropes, a DistanceJoint pendulum, and a kinematic Capsule crossing the rope centers. No floor or boundary planes are registered. The palette is intentionally different from `joint_compute`: green/lime ropes, a red pendulum Sphere, a cyan driver Capsule, and a gold visual connector.

## Controls

- `A` / `D`: move the driver Capsule left/right
- `Q`: `quasiStatic`, prescribing position with zero contact velocity
- `I`: `impact`, passing the prescribed velocity to the contact solver
- `P`: pause/resume
- `R`: reset the bodies, Joints, and Node display
- `H`: show/hide the Help Panel
- Drag: camera orbit
- Wheel: camera zoom

The Help Panel starts visible with its body collapsed. Press `H` to show or hide it

## Flow

```text
ComputePhysicsSpace.encodeFixedStep()
  -> encodeStateReadback()
  -> queue.submit()
  -> readStateReadback()
  -> syncNodesFromPhysics()
  -> Space.draw()
```

The `ComputeSphereCollider` / `ComputeCapsuleCollider` physics bodies and the normal rendering `Shape` objects are separate. The visual `Node` objects live in `Space` but are not registered as bodies in `ComputePhysicsSpace`. This corresponds to the “synchronize Compute state into ordinary Nodes” path described in `book/26_物理エンジン.md`.

## Files

```text
joint/
  joint_compute_node.js
  joint_compute_node.html
  joint_compute_node.md / joint_compute_node.en.md
  jointScenario.js
  index.html / index.en.html
```
