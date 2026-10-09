# Building Procedural Shapes

This chapter generates meshes such as terrain and curved surfaces from equations, height fields, subdivision, and recursion. Instead of memorizing a finished implementation for each shape, learn the shared process: derive vertices from parameters, connect faces while managing shared vertices, then handle normals and seams. These techniques let you build shapes that are not available as ready-made assets.

## How to read this chapter

### Prerequisites

Knowledge of vertices, faces, and `Shape` from Chapter 38, and the coordinate system from Chapter 3, makes this chapter easier to follow. Chapter 41 covers matrix and vector operations used to transform shapes.

### What to read first

Start with the icosphere and Möbius strip to see how equations produce vertices and faces.

### What to read when you need it

Refer to the sections on recursion, height fields, fractals, shared topology, and seam handling when building more complex shapes.

### What you will learn

You will be able to generate reproducible meshes from parameters and recursive rules.

## Build Shapes from Equations

A procedural shape is built by generating vertices, faces, normals, and UV coordinates from equations or iterative rules rather than loading an external model. Build the shape in local coordinates, then use a `Node` to set its position and orientation in the scene.

Choose a topic that matches the problem: an icosphere demonstrates a smooth closed surface and shared vertices; a Möbius strip demonstrates parameterized surfaces and seams; a Sierpinski tetrahedron demonstrates recursion and sharp faces; fractal terrain demonstrates a grid and a height field.

The low-level `Shape` API is useful when a structure is difficult to create by adjusting built-in primitives. The goal is not to practice typing vertex coordinates by hand. It is to understand how to design topology that makes a less conventional shape possible. Each topic emphasizes a different concern, while sharing the same overall process of constructing a mesh.

Work back and forth between the explanation and its runnable examples: read the code, inspect the result, then return to the code and connect the visible structure to the algorithm.

## Learning Steps: Icosphere and Möbius Strip

After learning the structure of cylinders and spheres with UV seams, move to shapes that are difficult to make by deforming built-in primitives. Useful topics include an icosphere, a Möbius strip, a Sierpinski tetrahedron, a tube along a path, a noise-based height-field terrain, and an extruded star polygon.

The icosphere and Möbius strip make good first exercises because they separate two fundamental ideas: shared vertices and topology, then parameterized surfaces and seams.

### Icosphere: Subdivision and Shared Topology

An icosphere starts from an icosahedron. Each triangle is divided into four, and the new vertices are projected onto a sphere. Its triangles are distributed more evenly than those of a latitude-longitude sphere, making it useful for planets and smooth rock-like shapes.

The key steps are to share vertices, create only one midpoint for each shared edge, and derive each normal directly from the vertex position. The example in [`39_01.html`](../book/examples/39_01.html) demonstrates the complete implementation.

The `addSphereVertex()` helper normalizes a candidate point and scales it by the desired radius. The normalized direction is also the sphere normal. A midpoint cache, keyed by the two endpoint indices in sorted order, ensures that adjacent triangles reuse one vertex rather than creating duplicates. Each subdivision level replaces every triangle with four triangles.

With `setAutoCalcNormals(false)`, the normal passed to `setVertNormal()` is the final normal. `endShape()` does not normalize a manually assigned normal, so the generator registers unit-length normals. Normalize only after ensuring the candidate midpoint has nonzero length.

The sphere UV mapping has a seam where the longitudinal coordinates wrap from 1 back to 0. `addTriangle()` duplicates vertices internally when a triangle crosses that seam, keeping the position while assigning different UV coordinates. A manually assigned normal is copied to the duplicate. Thus the seam does not change the intended lighting. Vertex sharing and normal style are separate decisions: shared radial normals create a smooth sphere, while independent face vertices with face normals emphasize the icosahedral facets.

### Möbius Strip: Parametric Surface and Seam

A Möbius strip is a band whose ends join after one half-twist. It is a useful example of a parameterized surface. Use `u` around the strip and `v` across its width, generate a vertex grid, and connect neighboring grid cells. The final ring is duplicated to close the seam while reversing the width direction.

The implementation in [`39_02.html`](../book/examples/39_02.html) enables the standard face-normal accumulation path with `setAutoCalcNormals(true)`. Its `MobiusSmoothShader` makes a local adjustment for displaying both sides; the example keeps that adjustment near the shape instead of changing the shared shader for every application. The parameterization, seam, and shader behavior can each be inspected independently in the page.

## Apply the Method to Recursion and Height Fields

### Recursive Sierpinski Tetrahedron

The Sierpinski tetrahedron is formed by repeatedly splitting a tetrahedron into smaller tetrahedra and retaining the corner pieces. A recursive function receives four corner positions and a depth. At each level it computes the six edge midpoints and calls itself for the four retained tetrahedra. At depth zero it emits four triangular faces.

The example in [`39_03.html`](../book/examples/39_03.html) creates separate face vertices where sharp face normals are desired. Sharing vertices would cause normal accumulation across faces and soften the edges. The choice to share or duplicate vertices therefore expresses the intended shading as well as the topology.

### Fractal Terrain: Build a Height Field

Fractal terrain maps a two-dimensional grid to three-dimensional space: grid coordinates provide `x` and `z`, while a deterministic height function provides `y`. A hash-based value-noise function can be combined across scales with fractional Brownian motion (fBm). A fixed seed makes the generated terrain repeatable.

The example in [`39_04.html`](../book/examples/39_04.html) builds one shared grid, evaluates heights at grid points, and connects neighboring cells into triangles. Shared vertices produce a continuous surface and allow smooth normals. A discrete board made from separate tiles is a better representation when gameplay requires individual cells, explicit elevation levels, or per-cell selection; a height field is suited to continuous terrain.

## How to Continue

Change one parameter at a time and compare the result: subdivision depth, strip segment counts, recursion depth, noise frequency, or height amplitude. Inspect the vertex and face counts as well as the rendered image. When a seam or shading artifact appears, determine whether it comes from topology, UV duplication, or normal generation before changing the shader.

## Summary

Procedural mesh construction combines a shape rule with consistent topology and suitable normals and UVs. The icosphere teaches shared edge midpoints, the Möbius strip teaches parameterization and seam closure, the Sierpinski tetrahedron teaches recursion and hard edges, and fractal terrain teaches a deterministic height field. The matching pages are `book/examples/39_01.html` through `39_04.html`.
