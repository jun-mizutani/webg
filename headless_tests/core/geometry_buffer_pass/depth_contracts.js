// ---------------------------------------------------------
// headless_tests/core/geometry_buffer_pass/headless_probe.js  2026/07/12
//   Reverse-Z and Camera Frame contracts for GeometryBufferPass
// ---------------------------------------------------------
import assert from "node:assert/strict";
import CameraFrame from "../../../webg/CameraFrame.js";
import { CAMERA_REVERSE_Z } from "../../../webg/DepthConvention.js";
import { GBUFFER_WGSL_COMMON, GeometryBufferPass,
  createGBufferProjectionParams } from "../../../webg/GeometryBufferPass.js";
import Matrix from "../../../webg/Matrix.js";

globalThis.GPUTextureUsage = { RENDER_ATTACHMENT: 1, TEXTURE_BINDING: 2, COPY_SRC: 4, COPY_DST: 8 };
globalThis.GPUShaderStage = { VERTEX: 1, FRAGMENT: 2 };
globalThis.GPUBufferUsage = { UNIFORM: 1, COPY_DST: 2 };

function createGpuProbe() {
  const textures = [];
  const pipelines = [];
  const writes = [];
  const device = {
    createSampler: (descriptor) => ({ descriptor }),
    createTexture(descriptor) {
      textures.push(descriptor);
      return { descriptor, createView: () => ({ descriptor }), destroy() {} };
    },
    createBindGroupLayout: (descriptor) => ({ descriptor }),
    createShaderModule: (descriptor) => ({ descriptor }),
    createPipelineLayout: (descriptor) => ({ descriptor }),
    createRenderPipeline(descriptor) { pipelines.push(descriptor); return { descriptor }; },
    createBuffer: (descriptor) => ({ descriptor, destroy() {} }),
    createBindGroup: (descriptor) => ({ descriptor })
  };
  return { gpu: { device, queue: { writeTexture() {}, writeBuffer(...args) { writes.push(args); } } },
    textures, pipelines, writes };
}

function makeFrame(position, far = 10000.0) {
  const camera = new Matrix();
  camera.setByEuler(17.0, -6.0, 2.0);
  camera.position(position);
  return new CameraFrame({ cameraWorldMatrix: camera, near: 0.125, far,
    vfov: 60.0, aspect: 16.0 / 9.0, depthConvention: CAMERA_REVERSE_Z });
}

// Compute consumerへ渡すvec4はfinite farを実値、infinite farを明示sentinel 0として区別します
{
  const finite = createGBufferProjectionParams(makeFrame([0.0, 0.0, 0.0], 10000.0));
  assert.equal(finite[0], 0.125);
  assert.equal(finite[1], 10000.0);
  assert.ok(Math.abs(finite[2] - Math.tan(Math.PI / 6.0)) < 1.0e-6);
  assert.ok(Math.abs(finite[3] - 16.0 / 9.0) < 1.0e-6);
  const infinite = createGBufferProjectionParams(makeFrame([0.0, 0.0, 0.0], Infinity));
  assert.equal(infinite[1], 0.0);
  assert.throws(() => createGBufferProjectionParams({}), /requires a Reverse-Z CameraFrame/);
}

// 共通WGSLは背景0、finite Reverse-Z、infinite farを明示し、epsilon補正を含みません
{
  assert.match(GBUFFER_WGSL_COMMON, /depth == 0\.0/);
  assert.match(GBUFFER_WGSL_COMMON, /if \(far == 0\.0\)/);
  assert.match(GBUFFER_WGSL_COMMON, /near \/ depth/);
  assert.match(GBUFFER_WGSL_COMMON, /near \+ depth \* \(far - near\)/);
  assert.doesNotMatch(GBUFFER_WGSL_COMMON, /max\(far/);
}

// G-buffer resourceとpipelineは通常カメラのdepth32float・greaterを使用します
{
  const probe = createGpuProbe();
  const pass = new GeometryBufferPass(probe.gpu, { width: 32, height: 24 });
  await pass.ready;
  assert.equal(pass.depthConvention, CAMERA_REVERSE_Z);
  assert.equal(pass.depthFormat, "depth32float");
  assert.equal(probe.textures[1].format, "depth32float");
  assert.equal(probe.pipelines[0].depthStencil.format, "depth32float");
  assert.equal(probe.pipelines[0].depthStencil.depthCompare, "greater");
  pass.destroy();
}

// render時はCamera Frameで巨大World平行移動を相対化し、depthを0でclearします
{
  const probe = createGpuProbe();
  const pass = new GeometryBufferPass(probe.gpu, { label: "v2-gbuffer-render" });
  await pass.ready;
  const base = [1.0e10, -2.0e10, 3.0e10];
  const world = new Matrix();
  world.position([base[0] + 4.0, base[1] - 2.0, base[2] - 15.0]);
  const entry = pass.addShape({ getWorldMatrix: () => world },
    { vertexBuffer: {}, vertexCount: 3, indexBuffer: {}, indexFormat: "uint16", indexCount: 3 },
    {
      albedo: [1.0, 1.0, 1.0],
      specular: 0.5,
      roughness: 0.4,
      metallic: 0.2,
      emissive: 0.0
    });
  let descriptor = null;
  const renderPass = { setPipeline() {}, setBindGroup() {}, setVertexBuffer() {},
    setIndexBuffer() {}, drawIndexed() {}, end() {} };
  probe.gpu.commandEncoder = { beginRenderPass(value) { descriptor = value; return renderPass; } };
  const frame = makeFrame(base);
  pass.renderEntries([entry], frame, [0.0, 0.0, 0.0, 1.0]);
  assert.equal(descriptor.depthStencilAttachment.depthClearValue, 0.0);
  const uniformWrite = probe.writes.at(-1)[2];
  const expected = frame.createModelViewMatrix(world).mat;
  for (let index = 0; index < 16; index += 1) {
    assert.ok(Math.abs(uniformWrite[16 + index] - expected[index]) < 1.0e-5,
      `modelView[${index}] actual=${uniformWrite[16 + index]} expected=${expected[index]}`);
  }
  assert.throws(() => pass.renderEntries([entry], new Matrix(), [0, 0, 0, 1]),
    /requires a Reverse-Z CameraFrame/);
  pass.destroy();
}

console.log("geometry_buffer_pass_depth_contracts: all G-buffer contracts passed");
