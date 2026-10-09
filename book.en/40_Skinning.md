# How Skinning Works

Skinning applies transformations from several bones to one vertex and blends the results by weight so that joints move smoothly. This chapter first checks the calculation for one vertex on the CPU (Central Processing Unit), then extends the same calculation to an entire mesh on the GPU (Graphics Processing Unit). It explains the relationships among bone indices, weights, inverse bind matrices, and the matrix palette, and shows how to diagnose distorted deformations.

## How to read this chapter

### Prerequisites

This chapter is easier to follow with the hierarchy and coordinates from Chapter 3, models from Chapter 8, and WGSL from Chapter 18. Chapter 41 covers quaternion rotations and matrix storage conventions.

### What to read first

Read the one-vertex skinning calculation, bone weights, the two-bone cylinder, and the CPU verification example.

### What to read when you need it

Refer to the GPU deformation, compact palette, Blender/glTF, and real-model sections while diagnosing skinning.

### What you will learn

You will understand deformation by bone poses and weights, and can investigate coordinates, weights, and GPU inputs separately.

## Blend Transformations from Multiple Bones

Skinning applies transformations from one or more bones to a vertex, then combines the resulting positions according to their weights. The ordinary high-level workflow loads a skinned GLB (binary glTF) and plays its animation. The low-level two-bone cylinder in this chapter exposes how bone matrices, indices, and weights determine a vertex position.

In normal application code, an imported GLB is the natural starting point. A model file already contains its joint hierarchy, inverse bind matrices, per-vertex weights, and animation clips. The application controls playback with `Action` or `AnimationState`. When deformation looks wrong, however, understanding the underlying calculation helps isolate the source of the problem.

On the CPU, `Skeleton.updateMatrixPalette()` prepares the transformations for the current bone poses. In the vertex shader, `SmoothShader` uses each vertex's bone indices and weights to blend the corresponding transformations. The CPU prepares the current pose; the GPU applies the relevant palette entries to each vertex.

## Choose the High-Level or Low-Level Path

For ordinary application work, load the model and instantiate its runtime:

```js
const runtime = await app.loadModel("./character.glb");
runtime.instantiate(app.space);
```

Use the low-level explanation when you need to determine which bones affect a vertex, distinguish a weight problem from a bone-placement problem, inspect `SmoothShader` skinning, or verify the minimum principle independently of an importer. These paths serve different levels of understanding: the low-level construction explains what the imported model supplies.

## The Skinning Calculation for One Vertex

Let `p_rest` be a vertex in the rest pose. Let `L0` and `L1` be the current pose matrices for two bones in the skinned mesh's local coordinates, and `M0^-1` and `M1^-1` their inverse bind matrices. Each bone produces a candidate position:

```text
p0_local = L0 * M0^-1 * p_rest
p1_local = L1 * M1^-1 * p_rest
```

For weights `w0` and `w1` whose sum is 1, the blended position is:

```text
p_local = w0 * p0_local + w1 * p1_local
```

With one influence, its weight is 1 and the vertex follows that bone. Near a joint, multiple influences blend the positions. The inverse bind matrix maps a rest-pose vertex into the bone's bind coordinates; the current pose matrix moves it from those coordinates into the current pose.

The page [`40_01.html`](../book/examples/40_01.html) evaluates one vertex on the CPU and displays markers for each bone-only result and the blended result. `transformVertexByBone()` uses the bone's current world matrix and its inverse bind matrix; `blendVertex()` accumulates each transformed point multiplied by its influence weight. After the calculation, multiply by the object node's world matrix to place a marker in world space. This gives a direct comparison between the equation and the rendered locations.

The CPU helper is a teaching and verification implementation. The actual mesh is skinned on the GPU. `Skeleton.updateMatrixPalette()` updates the bone pose data, and `SmoothShader` blends it for each vertex.

## Build a Two-Bone Cylinder

The page [`40_02.html`](../book/examples/40_02.html) extends the same calculation to a cylinder side divided into rings. Lower vertices receive more influence from `rootBone`, while upper vertices receive more influence from `childBone`, making the weight transition visible.

The construction sequence is:

1. Define the cylinder-side vertices with `Shape`.
2. Create a root bone and child bone in a `Skeleton`.
3. Assign weights for both bones with `addVertexWeight()`.
4. Call `shape.endShape()` to prepare GPU buffers.
5. Enable bone rendering with `has_bone: 1` in `SmoothShader`.

The core setup follows this pattern:

```js
const shape = new Shape(gpu);
shape.setAutoCalcNormals(true);

const skeleton = new Skeleton();
shape.setSkeleton(skeleton);

const rootBone = skeleton.addBone(null, "rootBone");
const childBone = skeleton.addBone(rootBone, "childBone");
rootBone.setRestPosition(0.0, 0.0, 0.0);
childBone.setRestPosition(0.0, height * 0.5, 0.0);
skeleton.bindRestPose();
skeleton.setBoneOrder(["rootBone", "childBone"]);
```

For each ring and radial segment, generate a vertex around the cylinder, then assign the two weights according to its height. The complete example also builds the triangles, configures the shader, and animates the bones; use the runnable page to inspect those details.

## GPU Processing Flow

The CPU creates a compact matrix palette from the current skeleton pose. Each vertex carries bone indices and weights. The vertex shader reads up to four influences, applies their palette matrices, and sums the weighted positions. Each palette entry uses 12 floating-point values in the GPU representation. This keeps per-vertex data compact while supporting smooth transitions across joints.

## Verify with the Examples

### `40_01`: Verify the One-Vertex Principle

Use the first example to compare the rest position, each individual bone result, and the weighted result. Change the bone pose and weights, then compare the displayed markers with the CPU calculation.

### `40_02`: Verify a Complete Mesh

Use the second example to see how weights distributed across rings deform the cylinder. It helps distinguish a palette or shader issue from a weight distribution that produces an unexpected bend.

## Return to the Blender/glTF Workflow

Once the mechanism is clear, use the high-level asset path for application work: prepare the skeleton, weights, and animation in Blender, export glTF/GLB, load it with `loadModel()`, and control playback with the runtime animation API. The low-level examples are diagnostic tools for understanding the data consumed by that workflow.

## Common Problems

- **The mesh stretches toward the origin:** check that the rest pose was bound and that inverse bind matrices correspond to it.
- **A vertex follows the wrong bone:** inspect the vertex's bone indices and the order used by `setBoneOrder()`.
- **A joint collapses or bulges:** inspect weight sums and transitions across neighboring vertices.
- **CPU markers and mesh positions differ:** check whether the object node's world matrix has been applied to the markers, and compare values in the same coordinate space.
- **The GPU result differs from the expected palette:** check the current pose update, palette layout, and vertex attributes together.

## Summary

Skinning is a weighted blend of current bone transforms composed with inverse bind transforms. The one-vertex example makes the equation measurable; the two-bone cylinder extends it to a complete GPU-skinned mesh. For production assets, use Blender and glTF with the high-level runtime path, and return to these examples when diagnosing deformation.
