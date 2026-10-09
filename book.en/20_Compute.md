# Thinking About Compute Shaders

Particle positions, image brightness, and the velocities of many objects all involve applying the same calculation to a large number of elements. A compute shader runs this kind of calculation in parallel on the GPU (Graphics Processing Unit). Starting with small array and image examples, this chapter explains what to process, how many invocations to launch, and where to put the results.

This chapter focuses on structuring calculations. Chapter 21 connects `ComputePass` to rendering; Chapter 22 covers CPU data exchange, synchronization, and performance.

## How to read this chapter

### Prerequisites

Review JavaScript arrays and the WGSL (WebGPU Shading Language) basics in Chapter 18.

### What to read first

Read about per-element computation, dispatch and workgroups, storage buffers and storage textures, and the order for passing results to rendering.

### What to read when you need it

Chapter 21 covers resource creation and execution code; Chapter 22 covers memory layout, readback, and handling data conflicts. For related features, see screen effects in Chapters 34–36, built-in particles in Chapter 26, and physics in Chapters 27–28.

### What you will learn

You will be able to identify updates suited to parallel computation and explain how to choose an invocation count and result resource based on the number and type of elements.

## Assign One Calculation to Each Element

To move 1,000 particles, add “velocity × elapsed time” to each particle's current position. If all particles use positions and velocities from the same time step, each result can be calculated independently. Assign an array index to each invocation.

The following WGSL shows the calculation that doubles values in an array. It assumes `values` is connected to a storage buffer. Chapter 22 covers creating and connecting the JavaScript buffer.

```wgsl
@group(0) @binding(0)
var<storage, read_write> values: array<f32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  // Select this invocation's array element and check the actual element count.
  let index = id.x;
  if (index >= arrayLength(&values)) {
    return;
  }
  values[index] = values[index] * 2.0;
}
```

`global_invocation_id` is the index assigned to an invocation by the GPU. For a one-dimensional array, use its X component as the array index. With 1,000 elements, indices 0 through 999 are updated. Having each invocation write a separate element avoids simultaneous writes to one location.

For calculations that read other elements, such as particle collisions, separate input and output buffers so every element computes its next state from the same time step. Chapter 22 covers ping-pong buffers and synchronization.

## Dispatch and Invocation Count

Dispatch tells the GPU to run a compute workload. Invocations are grouped into workgroups. In the example, `@workgroup_size(64)` specifies 64 invocations per group.

For 1,000 elements, `Math.ceil(1000 / 64)` dispatches 16 groups. This launches 1,024 invocations, so the final 24 check the array bounds and return. Keep the bounds check in the shader so it remains correct when the element count changes to a value that is not a multiple of 64.

For an image, use two-dimensional workgroups with a width and height. For example, an 8 × 8 workgroup uses `ceil(width / 8)` groups horizontally and `ceil(height / 8)` groups vertically. Each invocation checks that its pixel coordinate is within the image before processing it.

## Choose a Destination for Arrays or Images

A storage buffer is a GPU resource for structured data such as positions, velocities, lifetimes, or numeric arrays. A storage texture stores an image that is read or written by coordinate. Decide whether the result is an array or an image first, then choose the matching resource.

For screen processing, read colors from an input image and write processed colors to an output image. For particles, calculate the next positions and velocities from the inputs and let rendering read those values. When the next GPU operation can use a result directly, CPU readback can be reduced.

## Update Before Rendering

`WebgApp` remains the center of the application. Connect particle or physics state updates before drawing, and connect image processing after drawing the scene:

```text
Particles/physics: update state → draw with the new state → display
Screen effects:    draw scene to an image → process the image → display
```

Chapter 21 shows how to record compute work from JavaScript, connect it to rendering, and work with image formats. Chapter 22 covers reading results back and synchronizing through shared memory. At this stage, focus on being able to state the input, update, and destination as one processing flow.

## Examples and Further Reading

The [image-processing example](../book/examples/20_01.html) creates an image with `ComputePass`. The [array-processing example](../book/examples/21_01.html) reads a storage-buffer result back to the CPU. Chapters 21 and 22 show how to connect these examples to an application.

For ready-to-use features, continue to particles in Chapter 26 or physics in Chapter 27. See Chapter 34 for screen-space ambient occlusion (SSAO), Chapter 35 for shadows, and Chapter 36 for custom particle updates.

## Summary

Compute processing assigns a calculation to many elements, dispatches workgroups to cover the element count, and stores results in a GPU resource. Chapter 21 connects this model to `ComputePass`, images, and rendering.
