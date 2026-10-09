# Compute Data Exchange and Performance

This chapter explains how to pass data between the CPU and GPU, reuse results across compute passes, and keep parallel updates consistent. It covers memory layout, readback, synchronization, and measurements that help you distinguish correctness problems from performance bottlenecks.

## How to read this chapter

### Prerequisites

This chapter is easier to follow if you know `ComputePass` and storage resources from Chapter 21.

### What to read first

Start with ping-pong resources, one-dimensional processing, CPU and WGSL memory layout, and the basics of data races.

### What to read when you need it

Refer to atomics, workgroup memory, barriers, workgroup sizes, GPU features, and `FrameTimer` when tuning performance.

### What you will learn

You will be able to pass data safely between GPU operations, avoid data races, and measure execution time.

## Storage Textures and Ping-Pong Resources

A compute output texture needs appropriate usage flags. `StorageTargetFactory` creates a target with the required usages. A compute shader can write to it as `STORAGE_BINDING`, and a later pass can sample it as `TEXTURE_BINDING`.

```js
import StorageTargetFactory from "./webg/StorageTargetFactory.js";

const targetFactory = new StorageTargetFactory(app.getGPU(), {
  label: "main-storage",
  format: "rgba8unorm"
});

const outputTarget = targetFactory.create({
  label: "compute-output",
  width: app.screen.getWidth(),
  height: app.screen.getHeight()
});
await outputTarget.ready;
```

Repeated calculations and feedback loops need input and output resources to alternate in a **ping-pong** arrangement. `webg` provides three resource managers for different uses:

- **`PingPongBuffer`**: Manages two `GPUBuffer` resources for cloth simulation or physics state.
- **`PingPongTexture`**: Manages two `GPUTexture` resources for dynamic textures or cellular automata.
- **`PingPongTarget`**: Manages two render targets for repeated blur or multi-stage image processing.

Combine `PingPongTarget` with `StorageTargetFactory` to create and swap targets succinctly:

```js
const pingPong = targetFactory.createPingPong({
  label: "blur-pair",
  width: app.screen.getWidth(),
  height: app.screen.getHeight()
});
await pingPong.ready;

const source = pingPong.getCurrent();
const destination = pingPong.getNext();

// Encode a pass from the read target to the write target, then swap their roles.
pingPong.swap();
```

Avoid reading from and writing to the same texture at the same time. Otherwise, results can depend on the GPU's internal execution order and behave inconsistently between environments.

## One-Dimensional Compute

For images, one invocation corresponds to one pixel. For arrays of particles, vertices, or physics state, use `global_invocation_id.x` as the array index.

This example doubles each input value, adds one, and writes the result to a separate storage buffer:

```js
import ComputePass from "./webg/ComputePass.js";

const inputValues = new Float32Array([
  1.0, 2.0, 3.0, 4.0,
  5.0, 6.0, 7.0, 8.0
]);
const count = inputValues.length;

const inputBuffer = app.getGPU().device.createBuffer({
  label: "scale-bias:input",
  size: inputValues.byteLength,
  usage:
    GPUBufferUsage.STORAGE |
    GPUBufferUsage.COPY_DST
});
app.getGPU().queue.writeBuffer(inputBuffer, 0, inputValues);

const outputBuffer = app.getGPU().device.createBuffer({
  label: "scale-bias:output",
  size: inputValues.byteLength,
  usage:
    GPUBufferUsage.STORAGE |
    GPUBufferUsage.COPY_SRC
});

const readbackBuffer = app.getGPU().device.createBuffer({
  label: "scale-bias:readback",
  size: inputValues.byteLength,
  usage:
    GPUBufferUsage.COPY_DST |
    GPUBufferUsage.MAP_READ
});
```

In WGSL, declare the input as `read` and the output as `read_write`. `params.x` is the element count; `params.y` and `params.z` hold scale and bias.

```wgsl
const scaleBiasWgsl = `
struct Params {
  values : vec4f,
};

@group(0) @binding(0)
var<uniform> params : Params;

@group(0) @binding(1)
var<storage, read> source : array<f32>;

@group(0) @binding(2)
var<storage, read_write> destination : array<f32>;

@compute @workgroup_size(64, 1, 1)
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  let index = id.x;
  let count = u32(params.values.x);
  if (index >= count) {
    return;
  }

  destination[index] =
    source[index] * params.values.y + params.values.z;
}
`;
```

On the JavaScript side, declare the storage-buffer types in the bindings and pass the number of elements as `dispatchSize`:

```js
const scaleBiasPass = new ComputePass(app.getGPU(), {
  label: "scale-bias",
  code: scaleBiasWgsl,
  workgroupSize: [64, 1, 1],
  uniformFloats: 4,
  bindings: [
    { binding: 0, name: "params", type: "uniform-buffer" },
    {
      binding: 1,
      name: "source",
      type: "read-only-storage-buffer"
    },
    {
      binding: 2,
      name: "destination",
      type: "storage-buffer"
    }
  ]
});

scaleBiasPass.setUniforms(
  new Float32Array([count, 2.0, 1.0, 0.0])
);

const commandEncoder =
  app.getGPU().device.createCommandEncoder();

scaleBiasPass.encode(
  commandEncoder,
  {
    source: inputBuffer,
    destination: outputBuffer
  },
  {
    dispatchSize: [count, 1, 1]
  }
);

commandEncoder.copyBufferToBuffer(
  outputBuffer,
  0,
  readbackBuffer,
  0,
  inputValues.byteLength
);

app.getGPU().queue.submit([commandEncoder.finish()]);
```

To inspect the result in JavaScript, wait for the GPU operation to complete and map the readback buffer:

```js
await readbackBuffer.mapAsync(GPUMapMode.READ);

const result = new Float32Array(
  readbackBuffer.getMappedRange().slice(0)
);
readbackBuffer.unmap();

console.log(result);
// [3, 5, 7, 9, 11, 13, 15, 17]
```

Readback synchronizes the GPU and CPU. It is useful for debugging and retrieving a final result, but avoid it in a per-frame rendering loop. Particle drawing, for example, can read the compute-updated storage buffer directly in the vertex shader and keep processing on the GPU.

Call `destroy()` on the objects that own buffers and passes when they are no longer needed:

```js
scaleBiasPass.destroy();
readbackBuffer.destroy();
outputBuffer.destroy();
inputBuffer.destroy();
```

## Keep CPU and WGSL Memory Layouts Aligned

When sending structures to storage or uniform buffers, match WGSL alignment, size, and stride as well as JavaScript array order.

Representative basic layouts are:

- `f32` / `u32` / `i32`: 4-byte alignment / 4-byte size
- `vec2f`: 8-byte alignment / 8-byte size
- `vec3f`: 16-byte alignment / 12-byte size
- `vec4f`: 16-byte alignment / 16-byte size
- `mat4x4f`: 16-byte alignment / 64-byte size

A `vec3f` starts on a 16-byte boundary but occupies 12 bytes. The next member follows its own alignment requirement: an `f32` can occupy the remaining four bytes, while another `vec3f` starts at the next 16-byte boundary. An array of `vec3f` therefore has a 16-byte element stride. Calculate each member offset and the overall stride rather than assuming that every vector is tightly packed.

For arrays or structures frequently updated by the CPU, grouping related values in `vec4f` units makes the layout easier to follow:

```wgsl
struct Particle {
  positionLife : vec4f,
  velocityMass : vec4f,
  colorSize : vec4f,
};
```

This `Particle` contains three `vec4f` values and has a 48-byte stride. JavaScript can represent one element as 12 `f32` values:

```js
const FLOATS_PER_PARTICLE = 12;
const particleData = new Float32Array(
  particleCount * FLOATS_PER_PARTICLE
);

const offset = particleIndex * FLOATS_PER_PARTICLE;
particleData.set([
  px, py, pz, life,
  vx, vy, vz, mass,
  r, g, b, size
], offset);
```

`ComputePass.setUniforms()` requires an exact match with the specified float count so it can detect a layout mismatch before GPU execution. Whenever a structure changes, update all three together: WGSL member order and type, JavaScript offsets and element counts, and total buffer size and array stride.

## Data Races and Synchronization

Understand data-race and synchronization rules when several invocations access shared state so results do not depend on execution order. The GPU runs many invocations in parallel. The order of statements inside one shader is separate from the execution order among invocations. Choose independent updates, ping-pong resources, atomics, or barriers according to the operation and make required ordering explicit.

### Independent Updates by Index

If each invocation reads and writes only its own index, it can update the same storage buffer declared `read_write`:

```wgsl
let index = id.x;
particles[index].position +=
  particles[index].velocity * deltaTime;
```

This requires that another invocation does not write the same `particles[index]`. GPU particle updates that map one invocation to one particle are a typical example.

### Processing That Reads Neighbors

Cloth, blur, fluid, and cellular-automata calculations read neighboring elements as well as the current element:

```wgsl
let left = source[index - 1];
let center = source[index];
let right = source[index + 1];
destination[index] =
  (left + center + right) / 3.0;
```

If `source` and `destination` are the same buffer, one invocation could read a value after another invocation has changed it. Keep the complete previous state available by separating input and output and swapping their roles after the dispatch.

### Atomic Operations

If multiple invocations increment one counter, a regular read-modify-write can lose updates. Use an `atomic` type and an atomic function:

```wgsl
struct Counters {
  activeCount : atomic<u32>,
};

@group(0) @binding(0)
var<storage, read_write> counters : Counters;

if (particleIsActive) {
  atomicAdd(&counters.activeCount, 1u);
}
```

Atomic operations preserve the updates, but concentrating all invocations on one counter reduces parallelism. Reduce contention by accumulating per workgroup and combining the partial results in a later pass.

### Workgroup Memory and Barriers

`var<workgroup>` declares fast temporary memory shared by invocations in one workgroup. It suits blur and reduction operations that load input once and reuse it several times.

```wgsl
var<workgroup> tile : array<f32, 64>;

@compute @workgroup_size(64, 1, 1)
fn main(
  @builtin(local_invocation_id) localId : vec3<u32>,
  @builtin(global_invocation_id) globalId : vec3<u32>
) {
  tile[localId.x] = source[globalId.x];

  // Wait until every invocation has written to tile.
  workgroupBarrier();

  let value = tile[localId.x];
  destination[globalId.x] = value;
}
```

`workgroupBarrier()` synchronizes invocations in the same workgroup. Use `storageBarrier()` when those invocations need to synchronize storage-buffer writes.

Place a barrier where every invocation in the workgroup reaches it through the same control flow. A conditional `if` whose condition differs per invocation cannot guarantee this, so put the barrier outside such a branch.

If a calculation needs to wait for every workgroup in a dispatch and pass all results to a later calculation, split it into separate passes and make the order explicit:

```text
Compute pass A
  -> write an intermediate buffer
Compute pass B
  -> read the completed result from A
```

WebGPU manages resource dependencies between passes recorded in order in the same command encoder.

## Choose a Workgroup Size

Choose `@workgroup_size()` based on the number of invocations per group, register use, workgroup memory, branching, and GPU architecture. A larger group can increase parallelism and resource consumption, so tune it by measurement.

Start by comparing these candidates:

- **2D image processing**: `8 x 8` or `16 x 16`
- **1D array processing**: `64`, `128`, or `256`

Match the WGSL `@workgroup_size()` and the `workgroupSize` passed to `ComputePass`:

```wgsl
@compute @workgroup_size(16, 16, 1)
```

```js
const pass = new ComputePass(app.getGPU(), {
  // ...
  workgroupSize: [16, 16, 1]
});
```

Check the device's supported limits through `device.limits`. A limit describes the maximum executable range; it does not identify the fastest setting. Compare candidates with `FrameTimer`'s GPU compute time using the same scene, resolution, and element count.

Use a moving average over a steady set of frames to reduce the effect of initial pipeline creation and transient browser load. Since changing the workgroup size changes the pipeline, compare it as a separate pipeline rather than changing a number during the same pipeline execution.

For image processing, workgroup shape matters too. `8 x 8` and `4 x 16` both contain 64 invocations but have different neighborhood and memory-tile shapes. Start with a square or contiguous one-dimensional layout that matches the input and adjust from measurements.

## GPU Features and `FrameTimer`

Some advanced WebGPU features must be requested before device creation. For example, `timestamp-query`, which precisely measures GPU execution time, is an optional feature that is available only when requested and supported.

```js
import WebgApp from "./webg/WebgApp.js";

const app = new WebgApp({
  document,
  gpu: {
    requiredFeatures: [],
    optionalFeatures: ["timestamp-query"]
  },
  frameTiming: true
});

await app.init();

if (!app.screen.hasGPUFeature("timestamp-query")) {
  console.log("GPU timestamp query is unavailable");
}
```

- **`requiredFeatures`**: Initialization stops with an error if a requested feature is unsupported.
- **`optionalFeatures`**: Enables a feature when supported and continues when it is unavailable.

Setting `frameTiming: true` starts the internal `FrameTimer`, which measures frame interval, JavaScript processing time, GPU compute time, and GPU rendering time. These values help identify whether the bottleneck is on the CPU or in GPU work.

```js
app.start({
  onUpdate: () => {
    app.message.setLines("timing", app.getFrameTimingLines());
  }
});
```

## Summary

Separate read and write resources for compute and exchange their roles at the correct stage boundary. Align CPU and WGSL layouts, make synchronization explicit, and use `FrameTimer` or GPU timestamps to measure execution time. This helps distinguish data races from performance issues.

To apply these low-level mechanisms to visual effects, continue to the effects in Part IV and the integrated pipeline in Chapters 31–33.
