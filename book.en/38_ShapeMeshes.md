# Building Meshes with `Shape`

This chapter explains how to register vertices, faces, normals, UVs, and indices as JavaScript arrays on `Shape`, then finalize them into GPU buffers for rendering. Learn vertex-sharing rules, face winding, normals, and when GPU resources are finalized so you can build meshes beyond the supplied primitives. Diagnose missing faces, reversed surfaces, and unexpected shading from the mesh structure.

## How to read this chapter

### Prerequisites

This chapter is easier to follow if you know coordinates, normals, and UVs from Chapter 3 and low-level APIs from Chapter 37.

### What to read first

Start with vertices, faces, Shape, `endShape()`, and cube construction.

### What to read when you need it

Refer to normals, UV seams, multiple materials, GPU buffers, and `destroy()` when building a custom mesh.

### What you will learn

You can construct a Shape by combining vertex data and faces.

## Build a Mesh with `Shape`

`Shape` collects vertices, faces, normals, texture coordinates (UVs), and indices, then converts them into a mesh the GPU can draw. This chapter compares using supplied primitives with registering vertices and faces individually, then follows how `endShape()` finalizes editable data into render buffers.

`Shape` bridges CPU-side mesh construction and GPU-side rendering. There are two main routes: a high-level route that loads a predefined form such as `Primitive.cube()`, and a low-level route that registers vertices and faces one at a time. Both finish through `endShape()`, converting CPU arrays to GPU-ready mesh data. The key is understanding how to assemble the mesh and when to move into the drawing phase.

Vertex sharing is also a core mesh-design decision. Share vertices to create smooth curved surfaces; duplicate and separate vertices at corners to create sharp edges. With automatic normals, contributions from the faces meeting at a vertex are accumulated and normalized by `endShape()`, so vertex sharing directly affects shading. With manual normals, provide the completed normal for each vertex. Mesh construction designs both shape and how the surface is shaded.

## Role and Basic Structure of `Shape`

`Shape` groups vertices, indices, normals, UVs, material slots, and a shader. From WebGPU's perspective, it is the data set used to create vertex and index buffers. Each triangle stores a material-slot index, allowing opaque and transparent surfaces to coexist in one Shape.

`Shape` also connects geometry with materials and shaders. The focus here is mesh construction; Chapters 7 and later cover material and rendering details.

The following example assumes `app` is an initialized `WebgApp` from Chapter 5. It loads a Primitive into a Shape and finalizes its GPU buffers:

```js
import Shape from "./webg/Shape.js";
import Primitive from "./webg/Primitive.js";

// Create Shape with a GPU reference
const shape = new Shape(app.getGPU());

// Load cube data from Primitive
shape.applyPrimitiveAsset(
  Primitive.cube(2.0, shape.getPrimitiveOptions())
);

// Finalize GPU buffers
shape.endShape();

// Set the material
shape.setMaterial("smooth-shader", {
  use_texture: 0,
  color: [1.0, 0.5, 0.3, 1.0]
});
```

Here `Primitive` supplies vertices and faces, so the application does not describe them. `endShape()` is still required because both high- and low-level construction use the same step to finalize GPU buffers.

## Two Approaches to Mesh Construction

Choose between loading completed geometry and registering vertices and faces in sequence. Use the concise high-level route for existing assets and the low-level route only for geometry generated from formulas, avoiding reimplementation of buffer processing.

### High-Level Construction

This route suits geometry that is already assembled, such as a supplied primitive or model asset:

```js
const shape = new Shape(screen.getGPU());
shape.applyPrimitiveAsset(
  Primitive.cube(2.0, shape.getPrimitiveOptions())
);
shape.endShape();
```

`Primitive` owns the vertex and face structure. The application chooses an appropriate prepared mesh rather than editing its topology.

### Low-Level Construction

Use this route for procedural geometry or specialized shapes, assembling the mesh directly:

```js
const shape = new Shape(screen.getGPU());

const p0 = shape.addVertexUV(-1.0, -1.0, 0.0, 0.0, 0.0) - 1;
const p1 = shape.addVertexUV( 1.0, -1.0, 0.0, 1.0, 0.0) - 1;
const p2 = shape.addVertexUV( 1.0,  1.0, 0.0, 1.0, 1.0) - 1;
const p3 = shape.addVertexUV(-1.0,  1.0, 0.0, 0.0, 1.0) - 1;

shape.addTriangle(p0, p1, p2);
shape.addTriangle(p0, p2, p3);

shape.endShape();
```

The application registers position, UVs, triangles, and material indices. `Shape` retains them, accumulates face normals when automatic normals are enabled, and transfers the completed buffers to the GPU in `endShape()`. In this route, `Shape` acts as the mesh definition itself.

## Detailed Mesh Construction with Low-Level APIs

Low-level construction registers vertices first, then connects them into faces.

### Register Vertices

`Shape` stores position, normal, and UV per vertex in arrays such as `positionArray`, `normalArray`, and `texCoordsArray`. Vertex registration and normal completion are separate steps. The `autoCalcNormals` setting determines which process is used. With automatic normals, each face contributes as it is added, and `endShape()` normalizes the sum to a unit vector. With manual normals, `setVertNormal()` sets the completed value and `endShape()` preserves it.

Vertex-registration methods include:

- `setVertex(x, y, z)`: registers position and initializes a normal to `[0, 0, 0]`. The return value is the vertex count after adding it, so subtract 1 to use it as a zero-based index.
- `addVertex(x, y, z)`: also derives UVs from the current texture-mapping settings.
- `addVertexUV(x, y, z, u, v)`: explicitly specifies position and UVs; it is a clear choice for simple planes and teaching examples.
- `addVertexPosUV([x, y, z], [u, v])`: accepts arrays and improves readability in loops that generate many procedural vertices.

### Register Faces

Register positions as vertices, then define which three form each triangular face:

- `addTriangle(p0, p1, p2, materialIndex = 0)`: appends indices and stores a material-slot index. With `autoCalcNormals`, calculates the face normal using a cross product and accumulates its contribution on all three vertices. It leaves normalization until `endShape()` so contributions from multiple faces can combine.
- `addPolygon(indices, materialIndex = 0)`: triangulates from the first vertex as a fan, assigning one material slot to all resulting triangles. Use it for convex polygons; triangulate concave polygons explicitly before adding their triangles.
- `addPlane(indices, materialIndex = 0)`: an alias for `addPolygon()` retained under the established API name.

### Example: Construct a Quadrilateral

This minimal example creates a plane from four vertices and two triangles without a supplied primitive:

```js
const shape = new Shape(screen.getGPU());
shape.setShader(shader);

const p0 = shape.addVertexUV(-1.0, -1.0, 0.0, 0.0, 0.0) - 1;
const p1 = shape.addVertexUV( 1.0, -1.0, 0.0, 1.0, 0.0) - 1;
const p2 = shape.addVertexUV( 1.0,  1.0, 0.0, 1.0, 1.0) - 1;
const p3 = shape.addVertexUV(-1.0,  1.0, 0.0, 0.0, 1.0) - 1;

// Register the surface as two triangles
shape.addTriangle(p0, p1, p2);
shape.addTriangle(p0, p2, p3);

shape.endShape();
shape.setMaterial("smooth-shader", {
  use_texture: 0,
  color: [0.90, 0.72, 0.32, 1.0]
});
```

This controls the coordinates, UVs, triangulation, and point at which `endShape()` runs.

### Assign Material Slots per Triangle

Set material slot 0 with the established `setMaterial()`. Register additional slots, with consecutive indices starting at 0, using `setMaterialAt()`. A triangle defaults to material index 0, preserving existing mesh-building code.

```js
shape.setMaterial("smooth-shader", {
  color: [0.90, 0.40, 0.12, 1.0],
  alpha: 1.0
});
shape.setMaterialAt(1, "smooth-shader", {
  color: [0.12, 0.70, 1.0, 1.0],
  alpha: 0.38,
  specular: 1.0,
  roughness: 0.16,
  power: 128
});

shape.addTriangle(p0, p1, p2, 0);
shape.addTriangle(p0, p2, p3, 1);
```

Material index is a per-triangle attribute. These two triangles share `p0` and `p2` but use different materials. Before `endShape()`, change an existing triangle's slot with `setTriangleMaterial(triangleIndex, materialIndex)`.

`endShape()` finalizes per-material index buffers and triangle centroids. Rendering first draws `alpha_mode` `OPAQUE` or `MASK` triangles with depth writes, then sorts all `BLEND` triangles across Shapes from back to front. It uses the CPU-side material indices and centroids for this processing. If `alpha_mode` is omitted, alpha 1.0 is `OPAQUE`, and alpha below 1.0 is `BLEND`.

Use `getMaterialCount()` for the number of registered slots and `getMaterialAt(index)` for a slot's material ID and parameters. `getMaterialAt()` returns shallow copies of the material object and `params`. Update a material with `updateMaterialAt(index, params)`. Chapter 7, “Use Multiple Materials in One Shape,” explains slots, lookup, partial updates, and per-instance independence.

### Apply These Ideas to a Cube

Build a cube one face at a time—front, back, left/right, top/bottom—to understand its structure.

To keep sharp corners and a separate normal for each face, duplicate vertices at face boundaries. To shade a sphere or tube smoothly, share vertices and combine normal contributions across neighboring faces. Mesh construction defines both geometry and shading through vertex sharing.

## Align Face Orientation, Normals, and UVs

Custom meshes require positions plus consistent face sides, lighting normals, and UVs. Configure them during construction to identify reversed surfaces and shading shifts in the data itself. The snippets here add content to a `shape` while it is being built.

### Face Side and Vertex Order

3D faces are defined by their vertex topology and winding order, which identifies the front side. In webg, list vertices counterclockwise when viewed from the front. This winding-order convention directly affects face normals, back-face culling, and normal-map appearance.

For a quadrilateral in the XY plane with its front toward `+Z`, list its vertices counterclockwise when viewed from `+Z`: lower-left, lower-right, upper-right, upper-left.

```js
const v0 = shape.addVertexUV(-1.0, -1.0, 0.0, 0.0, 0.0) - 1; // lower left
const v1 = shape.addVertexUV( 1.0, -1.0, 0.0, 1.0, 0.0) - 1; // lower right
const v2 = shape.addVertexUV( 1.0,  1.0, 0.0, 1.0, 1.0) - 1; // upper right
const v3 = shape.addVertexUV(-1.0,  1.0, 0.0, 0.0, 1.0) - 1; // upper left

shape.addPlane([v0, v1, v2, v3]);
```

When `addPlane()` splits this into `(v0, v1, v2)` and `(v0, v2, v3)`, the cross product `(v1 - v0) × (v2 - v0)` points toward `+Z`, so `+Z` is the front. Reversing the order, for example `[v3, v2, v1, v0]`, makes the normal point toward `-Z`; the same-position surface is now reversed.

The same rule applies when using `Shape.addTriangle()`, `Shape.addPlane()`, and `Shape.addPolygon()`, and when building ModelAsset `indices` or `polygonLoops`. Retain a quadrilateral loop with `addPolygon([a, b, c, d])` or `addPlane([a, b, c, d])`, keeping the front-facing counterclockwise order. Reversed order can make `SmoothShader` treat a surface as a back face or show its back-face color in `backfaceDebug`.

Face side and UVs are distinct, though they affect appearance together. Vertex winding determines the front side; UVs and image-loading settings determine image orientation. Keeping them separate aligns normals, normal maps, wireframe inspection, and GLB/ModelAsset import and export.

### Face Normals and Vertex Normals

A normal is a direction that describes which way a face or surface points. Lighting compares it with light direction, so a reversed normal can darken the front or brighten the back.

A face normal follows vertex order. For triangle `a, b, c`, it is conceptually `(b - a) × (c - a)`. With the counterclockwise front-face convention, the normal points toward the front, making it a useful first check for polygon orientation.

A vertex normal is assigned per vertex to smooth shading across adjacent faces. For a box with sharp corners, use a distinct normal per face. For a smooth sphere or cylinder, use vertex normals that average contributions from neighboring faces to hide polygon boundaries.

Shaders such as `SmoothShader` interpolate vertex normals to calculate brightness per fragment. Correct face winding with reversed vertex normals still produces unexpected lighting. Correct vertex normals with reversed face winding can still behave unexpectedly under back-face culling or diagnostics. Treat face orientation and vertex normals as related but distinct data when diagnosing model loading or shader issues.

### Back-Face Culling and Two-Sided Rendering

Rendering may cull faces oriented away from the camera. For closed solids, drawing only exterior-facing surfaces avoids work and also helps identify reversed faces.

Culling uses vertex order to decide which side faces the camera. If the counterclockwise front-face convention is inconsistent, visible surfaces may disappear or appear only from the opposite side. Missing textured surfaces or parts of a skinned mesh facing inward can be caused by winding or normal direction.

Planes, cloth, leaves, selection surfaces, and diagnostics may need drawing from both sides. Two-sided drawing makes the back visible but can also hide incorrect face orientation. Preserve the winding convention in mesh data, then deliberately enable two-sided rendering where required.

### UV Coordinate Convention

webg conceptually uses bottom-left-origin texture coordinates, aligned with major 3D tools such as Blender. `U` increases to the right and `V` increases upward, so the lower-left is `(0, 0)` and upper-right is `(1, 1)`. This convention applies when manually setting Shape UVs or placing UVs on procedural geometry.

For example, a single image on a quadrilateral uses:

```js
[
  { pos: [-1, -1, 0], uv: [0, 0] },
  { pos: [ 1, -1, 0], uv: [1, 0] },
  { pos: [ 1,  1, 0], uv: [1, 1] },
  { pos: [-1,  1, 0], uv: [0, 1] }
]
```

The image's vertical orientation after GPU upload can differ from the conceptual UV convention. Adjust image input with `flipV` rather than changing UV coordinates. Changing geometry to a top-left convention would mix geometry and image definitions and confuse normal-map processing. UV defines how the image maps to geometry; `flipV` defines how the image is loaded.

To determine whether `flipV` is needed, place a marker at the top or bottom of an image and see where it appears on the `v=0` side. Enable `flipV` only when the loaded image appears on the opposite side. It flips the image during loading; the UV values stored on the Shape remain unchanged.

### Normal-Map Direction

A normal map stores a direction vector describing how fine surface relief tilts the normal. The sample `book/examples/NormPhong.js` decodes it like this:

```wgsl
let ntex = textureSampleLevel(uNormalTexture, uSampler, input.vTexCoord, 0.0).xyz
         * 2.0
         - vec3f(1.0, 1.0, 1.0);
```

`R → X`, `G → Y`, and `B → Z`. Converting color channels from 0–1 into -1–1 makes them a tangent-space direction vector. A pixel with `R = 0.5`, `G = 0.5`, and `B = 1.0` becomes `(0, 0, 1)`, pointing straight out from the surface.

`NormPhong.js` reconstructs the tangent in the fragment shader using `dpdx` and `dpdy`, then builds a right-handed TBN (Tangent, Bitangent, Normal) matrix with `bitangent = cross(nnormal, tangent)`. Thus normal-map X/Y/Z correspond to tangent-space T/B/N and are transformed into a view-space normal for lighting.

## Transfer Geometry to the GPU with `endShape()`

`endShape()` transfers CPU geometry to the GPU and finalizes the content at that moment in renderable form. JavaScript arrays can still be edited; rebuild GPU buffers to apply later changes to geometry. Usually call `endShape()` once after construction, then change material values, transforms, and instance state. Triangle material indices also determine GPU buffers and CPU sorting data, so set them before `endShape()`.

### Normalization and Seam Handling

Automatic normals smooth shading at vertices shared by multiple triangles. `addTriangle()` accumulates each triangle's cross-product normal on its vertices; `endShape()` normalizes the accumulated result. Shared face contributions produce smooth shading across a sphere or curved surface. To keep crisp cube edges, separate vertices per face.

Manual normals suit geometry with analytically known normals or custom shading directions. Call `setAutoCalcNormals(false)`, then assign a finite unit vector to every vertex using `setVertNormal()`. These values are authoritative: `addTriangle()` does not add face normals, and `endShape()` transfers the specified normals. Normalize manually supplied vectors first; a zero-length or non-unit normal changes lighting direction and intensity.

At a UV seam, two vertices with identical position and normal but different UVs are needed. When a triangle spans the 0-to-1 transition on a spherical UV map, `Shape` duplicates a needed vertex and stores the relationship to the source in `altVertices`. This keeps position continuous while UVs are discontinuous.

Seam-normal handling differs between automatic and manual modes. For automatic normals, `syncAltVertexNormals()` shares face-normal contributions from each side of the seam before normalization. For manual normals, the duplicate copies the source vertex normal at creation. Re-adding copied values would add the same normal repeatedly and increase its length according to triangle count. Manual mode therefore preserves matching source and duplicate normals without accumulation.

If only the seam appears black or some faces look missing, inspect duplicated-vertex normals as well as triangle orientation. With automatic normals, check that both seam sides share face contributions. With manual normals, verify the source and duplicate contain the same finite unit normal. Choose one normal-generation method rather than mixing automatic and manual inputs.

### Create a Packed Vertex Buffer

To make GPU reads efficient, `endShape()` packs the separate arrays into one interleaved vertex sequence (`vObj`). A standard mesh stores eight floats per vertex:

```text
[pos.x, pos.y, pos.z, normal.x, normal.y, normal.z, u, v]
```

The stride is `8 * Float32Array.BYTES_PER_ELEMENT`. A `GPUBufferUsage.VERTEX` buffer is created from the packed array and transferred to the GPU with `queue.writeBuffer()`. A skinned mesh (`hasSkeleton` enabled) uses a dedicated layout with bone indices and weights in separate slots.

### Build Index and Wireframe Buffers

For memory efficiency and compatibility, index type switches automatically between `uint16` and `uint32` according to index values. When every index is 65535 or less, it uses `uint16`; larger indices or four-byte alignment requirements use `uint32`.

`endShape()` also calls `_buildWireIndexBuffer()`, removing duplicate edges from triangle indices to build a separate wireframe index buffer. `setWireframe(true)` can then switch between surface and line drawing with the same mesh.

## What Remains After `endShape()` and `destroy()`

After `endShape()`, `Shape` becomes a runtime resource with GPU buffers rather than just editable arrays. Distinguish the displayed shape from its shared resources. A `Shape` can hold per-instance appearance and display state while sharing geometry and GPU buffers through `ShapeResource`.

This model also clarifies release behavior. Removing one `Shape` instance should leave a shared resource alive while another instance still references it. When no instances reference a shared resource, its GPU buffers can be released.

```js
const sourceShape = new Shape(app.getGPU());
sourceShape.applyPrimitiveAsset(
  Primitive.cube(2.0, sourceShape.getPrimitiveOptions())
);
sourceShape.endShape();

const shape = sourceShape.createInstance();
const node = app.space.addNode(null, "box");
node.addShape(shape);

// Dispose of the instance when it is no longer needed
shape.destroy();

// Dispose of the source when its shared resource is no longer needed either
sourceShape.destroy();
```

`shape.destroy()` tells webg that this Shape instance has reached the end of its lifetime. It detaches the instance from Nodes and releases its material, animation, and texture references. If no other instance uses the shared resource, its GPU buffers also become eligible for release. `destroy()` ends a Shape's lifetime; it is not merely a visibility toggle.

Hiding an object and releasing its resources are distinct operations. For example, `hide(true)` stops rendering while retaining the Shape and GPU buffers. Changing a Node hierarchy also leaves mesh resources alive. Use `destroy()` when GPU resources should be released as part of cleanup.

Retain shapes intended for reuse and call `destroy()` when their use is complete. Shared terrain, repeatedly spawned projectiles, obstacles, and base meshes used by multiple Nodes are natural shared resources. `destroy()` marks a resource no longer needed rather than serving as a routine call after every display operation.

When JavaScript references disappear, objects may eventually become garbage-collection candidates. Use `destroy()` to make GPU resource lifetime explicit. In long-running applications and tools that create and destroy many shapes, this makes memory use more predictable. `endShape()` marks construction completion; `destroy()` marks the end of resource lifetime.

## Learning Exercises

To understand the low-level construction flow, try these small tasks in order:

1. Build one triangle.
2. Build a quadrilateral from two triangles.
3. Build the six faces of a cube individually.
4. Place vertices on a circle and build a disk.
5. Build a shape with a seam, such as a cylinder or torus.

These steps introduce vertex indices, normal behavior, the need for UV seams, and the role of `endShape()`.

## Summary

`Shape` moves mesh data from an editing phase into a rendering phase. Whether geometry comes from a high-level Primitive or a low-level list of vertices, `endShape()` converts CPU data into GPU buffers.

In low-level construction, vertex sharing determines shading. For a material boundary alone, retain shared vertices and change the triangle material index. For automatic normals, accumulate contributions through `addTriangle()` and normalize in `endShape()`. For manual normals, the application's unit vectors are final values. Understand this difference and seam-duplication rules before using packed buffers and GPU transfer to build more advanced procedural geometry.

For shapes generated from equations or recursive rules, continue to Chapter 39, “Creating Procedural Shapes.”
