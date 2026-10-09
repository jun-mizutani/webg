# Reading WGSL

This chapter traces values from JavaScript through buffers and bind groups into WGSL, then through the vertex and fragment shaders to the final pixel color. It connects WGSL syntax to JavaScript configuration, resource bindings, coordinate spaces, depth conventions, and value ranges. This makes it easier to locate a display problem in data transfer, vertex processing, or fragment processing.

## How to read this chapter

### Prerequisites

This chapter is easier to follow if you know coordinates and normals from Chapter 3 and shaders and materials from Chapter 7. Chapter 41 explains matrix transforms inside shaders in more detail.

### What to read first

Start with the CPU-to-GPU flow, `@group`, `@binding`, `@location`, entry points, and uniforms.

### What to read when you need it

Refer to TBN (Tangent, Bitangent, Normal), normal maps, skinning, dynamic offsets, and alignment when those features appear in a shader you are reading.

### What you will learn

You will be able to trace how a JavaScript value reaches WGSL through GPU resources.

## Trace the Value from CPU to GPU First

When reading WGSL, follow more than the shader expressions. Trace which buffer or texture receives each JavaScript value and which WGSL variable reads it through `@group`, `@binding`, and `@location`. Understanding how the vertex shader calculates positions and the fragment shader calculates color makes it easier to relate syntax to actual data.

> **For a first reading:** Start with the CPU-to-GPU flow, `@group` / `@binding` / `@location`, entry points, and uniform buffers. TBN (Tangent, Bitangent, Normal), skinning, and dynamic offsets are advanced topics for shaders that use normal maps or bone animation. Buffer alignment and compute-specific synchronization are covered in Chapters 20–22.

This chapter uses `SmoothShader.js`, a standard shader in `webg`, to explain WGSL and the CPU-to-GPU data flow.

The key is not just to follow the syntax but to understand the data path: how a JavaScript value reaches a GPU variable. WebGPU manages this path with the `@group`, `@binding`, and `@location` annotations.

## CPU-to-GPU Data Flow

WebGPU data flow has three main stages:

### 1. Store Values on the CPU (JavaScript)

`shape.setMaterial()` stores material values on the shape. When drawing, `Shape` passes those values to the shader setters; shared settings such as `shader.setLightPosition()` can be set directly. Each setter writes to an offset, such as `OFF_LIGHT`, in the shader's `Float32Array` (`this.uniformData`). At this stage, the data is still in CPU memory.

### 2. Transfer Data to GPU Memory (`writeBuffer`)

`gpu.queue.writeBuffer()` copies CPU data into a GPU buffer (`GPUBuffer`) dedicated to the shader. The GPU can then access it from its memory.

### 3. Read Values in the Shader (WGSL)

Immediately before drawing, `passEncoder.setBindGroup()` connects GPU buffers to WGSL variables. When WGSL reads `u.lightPos`, for example, it obtains the value from the corresponding location in the transferred buffer.

## Connect Resources with Groups, Bindings, and Locations

WebGPU organizes resources in a hierarchy. Think of it as **group (folder) → binding (slot) → data**.

### `@group` and `@binding`: Connect External Resources

`@group` and `@binding` act like addresses that connect resources created on the CPU—buffers or textures—to shader variables.

- `@group(g)` is a group of resources. In `webg`, groups are divided according to how frequently their data changes.
- `@binding(b)` is an individual connection point within a group.

`SmoothShader` separates resources by role:

| Group | Role | Update frequency | Resources |
|---|---|---|---|
| `group(0)` | Per-draw settings | Very high | Matrices, light position, material coefficients, flags |
| `group(1)` | Textures | Medium | Sampler, base texture, normal map |
| `group(2)` | Skeleton settings | Low to medium | Bone palette array |

#### WGSL Declaration Example

The following partial example assigns draw settings, textures, and a bone palette to separate groups. It omits the `DrawUniforms` and `SkinUniforms` definitions, the sampler, and the JavaScript bind-group layouts. For an executable shader, match the `@group` and `@binding` numbers in WGSL and JavaScript.

```wgsl
// Connect DrawUniforms to slot 0 of group 0.
@group(0) @binding(0) var<uniform> u : DrawUniforms;

// Connect the base texture to slot 1 of group 1.
@group(1) @binding(1) var myTexture : texture_2d<f32>;

// Connect the bone palette to slot 0 of group 2.
@group(2) @binding(0) var<uniform> skin : SkinUniforms;
```

### `@location`: Pass Data Within the Pipeline

`@group` connects external CPU resources to the GPU. `@location` is wiring that carries data between GPU stages.

1. **Vertex buffer → vertex shader**: Receive vertex data such as coordinates and normals through `@location(n)`.
2. **Vertex shader → fragment shader**: Output calculated values through `@location(n)`. The GPU interpolates them per pixel and delivers them to the fragment shader.

#### Example Data Paths

The same `@location` number can occur at different pipeline connections. Distinguish these two paths when tracking a value:

- Vertex input: `@location(0) position : vec3f` reads the vertex attribute assigned `shaderLocation: 0`.
- Vertex output → fragment input: the vertex shader assigns `output.vNormal = ...`, which is received as `@location(1) vNormal : vec3f`.

## Why the Bone Palette Is Separate

An important `SmoothShader` design choice is storing the bone palette in `group(2)`, apart from other uniforms in `group(0)`.

### Data Size and Performance

A bone palette is relatively large. At the maximum of 320 bones, it occupies about 15 KB. By contrast, `DrawUniforms` for matrices and lights uses only a few hundred bytes.

If both were placed in `group(0)`, even a simple cube without skinning would carry or transfer the bone data during drawing, reducing efficiency.

### How the Separation Works

`SmoothShader` selects the resources for `group(2)` according to the object:

- For a skinned mesh, connect the buffer dedicated to its skeleton.
- For a static mesh, connect a shared empty bone buffer through `defaultBoneBindGroup`.

Static meshes then avoid updating and transferring a per-shape bone palette while the shader keeps the same `skin.bones` interface. The shared buffer and `defaultBoneBindGroup` still exist to satisfy the layout.

## WGSL Syntax and Operations

These are the core syntax elements used to follow shader logic.

### Variables and Their Lifetime

WGSL uses three declaration keywords:

- **`let` — immutable**: The value cannot be reassigned; commonly used for intermediate results.
- **`var` — mutable**: The value can change; used to hold changing state in a function.
- **`const` — constant**: The value is determined at compile time and remains fixed.

### Control Flow

Conditionals and loops use syntax similar to JavaScript and C:

```wgsl
if (condition) {
  // Work for the true branch.
} else {
  // Work for the false branch.
}
```

Shader code can use `select` to choose a value without an `if` branch:

```text
select(false_value, true_value, condition)
```

It returns `true_value` when the condition is true and `false_value` otherwise. Whether this form is appropriate depends on the operation and pipeline.

### Functions

Define a function with `fn` and specify its return type with `->`:

```wgsl
fn calculateLighting(normal: vec3f, lightDir: vec3f) -> f32 {
  return max(dot(normal, lightDir), 0.0);
}
```

### Common Mathematical Functions

WGSL includes built-in functions for 3D calculations:

- `dot(a, b)`: Dot product; used for angle and lighting intensity.
- `cross(a, b)`: Cross product; returns a vector perpendicular to both inputs, such as a face normal.
- `normalize(v)`: Scales a vector to unit length; useful for directions.
- `reflect(i, n)`: Reflects incident vector `i` around normal `n`.
- `mix(a, b, t)`: Linear interpolation from `a` to `b` for `t` in 0–1, often used for color blending.
- `clamp(v, min, max)`: Constrains a value to a range, for example to limit color values.

## Structure of the Shader Pipeline

WebGPU rendering is a pipeline in which data moves from the vertex shader to the fragment shader.

### Entry Points

The vertex shader (`@vertex`) processes each vertex and determines its position on screen. It receives positions, UVs (two-dimensional texture coordinates), normals, and other data through `@location`, then outputs clip-space coordinates through `@builtin(position)`.

The fragment shader (`@fragment`) determines the color of each covered pixel. It receives interpolated data from the vertex shader and outputs the final pixel color to `@location(0)`.

### Resource Connections and Data Flow

`SmoothShader` groups several parameters into `vec4f` values such as `params` and `flags`. For example, `u.flags.x` indicates whether skinning is active. When you see a flag such as `u.flags.w` for normal-map usage, trace it back to the JavaScript method `useNormalMap()` that updates it.

The `@location` numbers in WGSL must match the CPU-side `shaderLocation` settings. A mismatch can produce incorrect lighting results.

## Match Uniform Buffers to CPU Data

`SmoothShader` defines matrices, colors, parameters, and flags at specific offsets in the uniform structure:

```wgsl
struct DrawUniforms {
  projMatrix : mat4x4<f32>,    // OFF_PROJ (0)
  viewMatrix : mat4x4<f32>,    // OFF_VIEW (16)
  normalMatrix : mat4x4<f32>,  // OFF_NORM (32)
  lightPos : vec4<f32>,        // OFF_LIGHT (48)
  color : vec4<f32>,           // OFF_COLOR (52)
  // ...
};
```

Compare the JavaScript `OFF_` constants with the field order in the WGSL structure. When `setLightPosition()` runs, for example, it updates `OFF_LIGHT` (float index 48) in `this.uniformData`; WGSL reads it as `u.lightPos`.

## Read Texture Sampling

`SmoothShader` manages the base texture and normal map in `group(1)`.

### Basic Sampling

Read a texture color in WGSL with `textureSample()`:

```wgsl
let texColor = textureSample(myTexture, mySampler, input.vTexCoord);
```

Pass both `myTexture` (image data) and `mySampler` (the interpolation method for scaling) together.

### Choose `textureSampleLevel()` When Needed

The normal-map path in `SmoothShader` uses `textureSampleLevel(..., 0.0)` rather than `textureSample()`. This handles WebGPU's restrictions on non-uniform control flow.

`textureSample()` relies on implicit derivatives and requires suitable uniform control flow. Shader validation can reject it inside a branch whose control flow cannot be proven uniform. When sampling inside non-uniform branches without implicit derivatives, specify the level of detail (LOD) explicitly with `textureSampleLevel`. The `0.0` value always selects the highest-resolution mip level, so it changes normal mip selection and can affect quality and cost. Use regular `textureSample()` outside the branch when implicit LOD is available; reserve fixed LOD 0 for paths that cannot use implicit gradients.

### Bind-Group Caching

On the JavaScript side, `getBindGroup1()` caches texture combinations in a `WeakMap`. Creating texture bind groups is relatively expensive, so reusing a group for the same texture combination keeps CPU work in the draw loop low.

## Normal Maps and the TBN Basis

An important feature of `SmoothShader` is that it can apply normal maps and flat shading without requiring tangent data in the mesh. The relevant concept is the TBN basis.

### What TBN Represents

TBN is a coordinate basis made of three vectors: Tangent, Bitangent, and Normal.

RGB values in a normal-map pixel store the direction of the normal relative to the surface—in tangent space. The neutral decoded tangent-space normal is `[0, 0, 1]`, perpendicular to the surface; its usual RGB encoding is approximately `[0.5, 0.5, 1]`. That surface-relative direction changes in world space as the model rotates or bends.

Using the normal-map value directly in 3D would make lighting look wrong when the model rotates. A basis transform called the TBN matrix converts texture-space directions into directions aligned to the model.

### Roles of T, B, and N

TBN is a local coordinate system on a surface:

- **N (Normal)**: Perpendicular to the surface.
- **T (Tangent)**: Along the texture's U direction.
- **B (Bitangent)**: Along the texture's V direction and perpendicular to both N and T.

Putting these vectors into a `mat3x3` transforms between tangent space and view or world space.

### Reconstruct TBN from Derivatives

A conventional TBN basis requires tangent data in the model. `SmoothShader` can calculate it in the fragment shader with the derivative functions `dpdx` and `dpdy`:

```wgsl
let dp1 = dpdx(input.vPosition); // Change in position along screen X.
let dp2 = dpdy(input.vPosition); // Change in position along screen Y.
```

Comparing how UV coordinates and positions change between nearby pixels gives the tangent and bitangent, from which the shader builds TBN. This lets users apply a normal map to different meshes without preparing additional tangent attributes.

### Shader Processing Steps

In `SmoothShader.js`, the process is:

1. **Decode the vector**: Read the texture color and map it to `[-1, 1]` to get the tangent-space normal \(\vec{n}_{tangent}\).
2. **Build the TBN matrix**: Combine T, B, and N derived from screen-space derivatives.
3. **Transform the normal**: Calculate \(\vec{n}_{view} = \text{TBN} \times \vec{n}_{tangent}\) to convert the normal-map direction into a 3D-space normal.
4. **Calculate lighting**: Use the transformed normal and its angle to the light to determine shading.

### Flat Shading

The shader uses a related derivative method to calculate each triangle's face normal directly when `u.debugFlags.y` (`flat_shading`) is enabled, ignoring interpolated vertex normals:

```wgsl
nnormal = normalize(cross(dpdy(input.vPosition), dpdx(input.vPosition))) * facing;
```

The cross product of the two derivative vectors gives the face normal. A shader setting can therefore switch a low-polygon model to flat, faceted shading.

## Read Skinning in the Shader

Skinning uses the bone palette in `group(2)` to deform vertices in the vertex shader.

### Compressed Palette

`SmoothShader` stores each 4×4 bone matrix as three `vec4` values. The fixed fourth row `[0, 0, 0, 1]` is omitted to reduce transfer data.

### Vertex Deformation Flow

In the vertex shader (`vs_main`):

1. **Read bone indices**: Use the vertex attribute `index` to select up to four matrices from `skin.bones`.
2. **Blend by weights**: Multiply each matrix by its `weight` and combine them into a vertex-specific `skinMat`.
3. **Transform the position**: Multiply the vertex position by `skinMat`, then by `viewMatrix` to reach view space.

## Optimize Many Draws with Dynamic Offsets

Dynamic offsets are a core part of how `SmoothShader` draws many objects efficiently.

### Use One Large Buffer

A separate uniform buffer for every object also requires separate resource and bind-group management. `SmoothShader` instead allocates one large buffer with up to `maxUniforms` (2048) per-draw slots and reuses a shared bind group.

### Select the Data by Offset

At draw time, bind the offset that points to the start of that object's data:

- JavaScript: `passEncoder.setBindGroup(0, this.uniformBindGroup, [offset])`
- WGSL: Read a `DrawUniforms` value beginning at the specified offset.

Each draw still sets the bind group, but its dynamic offset selects another slot in the same buffer. This reduces resource allocation and bind-group creation, rather than eliminating draw calls. `SmoothShader` uses a `uniformStride` that is a multiple of 256 bytes to satisfy the uniform-buffer offset alignment used by this path.

## Summary

Read WGSL by following the meaning of data from the resource inputs to the final output. Use this map for `SmoothShader`:

1. **Data entry**: Setter → `uniformData` (JavaScript) → `writeBuffer` → `GPUBuffer`
2. **Resource connections**:
   - `group(0)`: Per-draw settings selected with a dynamic offset
   - `group(1)`: Cached combinations of textures
   - `group(2)`: Bone palette separated by skeleton
3. **Pipeline wiring**: `@location` carries vertex data through the vertex shader to the fragment shader.
4. **Special paths**: Check TBN reconstruction with `dpdx` / `dpdy` and safe sampling with `textureSampleLevel`.

With this structure in mind, you can add parameters and customize drawing logic. Chapter 19, “Implementing Shaders,” covers shader classes and lighting calculations.
