// ---------------------------------------------------------
// headless_tests/core/shadow_map_pass/headless_probe.js  2026/06/15
//   headless contracts for core ShadowMapPass
// ---------------------------------------------------------
import assert from "node:assert/strict";
import ShadowMapPass, {
  createDirectionalLightMatrices,
  SHADOW_MAP_DEPTH_FORMAT
} from "../../../webg/ShadowMapPass.js";

globalThis.GPUTextureUsage = { RENDER_ATTACHMENT: 1, TEXTURE_BINDING: 2 };
globalThis.GPUShaderStage = { VERTEX: 1 };
globalThis.GPUBufferUsage = { UNIFORM: 1, COPY_DST: 2, VERTEX: 4 };

// ShadowMapPassが生成するdepth texture、uniform、draw callを記録する最小GPU probeを作る
function createProbe() {
  const textures = [];
  const buffers = [];
  const writes = [];
  const draws = [];
  const vertexBindings = [];
  const bindGroups = [];
  const renderPassDescriptors = [];
  const device = {
    createBindGroupLayout: (descriptor) => ({ descriptor }),
    createShaderModule: (descriptor) => ({ descriptor }),
    createPipelineLayout: (descriptor) => ({ descriptor }),
    createRenderPipeline: (descriptor) => ({ descriptor }),
    createBindGroup: (descriptor) => ({ descriptor }),
    createBuffer(descriptor) {
      const buffer = {
        descriptor,
        destroyed: false,
        destroy() { this.destroyed = true; }
      };
      buffers.push(buffer);
      return buffer;
    },
    createTexture(descriptor) {
      const texture = {
        descriptor,
        destroyed: false,
        createView: () => ({ descriptor }),
        destroy() { this.destroyed = true; }
      };
      textures.push(texture);
      return texture;
    },
    createCommandEncoder() {
      return commandEncoder;
    }
  };
  const queue = {
    writeBuffer(buffer, offset, data, dataOffset = 0, size = data.byteLength) {
      writes.push({
        buffer,
        offset,
        data,
        dataOffset,
        size,
        values: ArrayBuffer.isView(data) ? Array.from(data) : null
      });
    }
  };
  const pass = {
    setPipeline() {},
    setBindGroup(index, bindGroup) { bindGroups.push({ index, bindGroup }); },
    setVertexBuffer(index, buffer) { vertexBindings.push({ index, buffer }); },
    setIndexBuffer() {},
    drawIndexed(count) { draws.push(count); },
    end() {}
  };
  const commandEncoder = {
    beginRenderPass(descriptor) {
      renderPassDescriptors.push(descriptor);
      assert.equal(descriptor.colorAttachments.length, 0);
      assert.equal(descriptor.depthStencilAttachment.depthClearValue, 1);
      return pass;
    }
  };
  return {
    gpu: { device, queue, commandEncoder, endPass() {} },
    textures,
    buffers,
    writes,
    draws,
    vertexBindings,
    bindGroups,
    renderPassDescriptors
  };
}

assert.equal(SHADOW_MAP_DEPTH_FORMAT, "depth32float");

// directional matrix helperは有限な正射影行列と正規化済み方向を返す
{
  const light = createDirectionalLightMatrices({
    direction: [0.5, -1, 0.25],
    target: [0, 0, 0],
    distance: 20,
    halfWidth: 10,
    halfHeight: 8,
    near: 1,
    far: 50
  });
  assert.ok(Math.abs(Math.hypot(...light.direction) - 1) < 1e-6);
  assert.equal(light.viewProjection.mat.length, 16);
  assert.ok(light.viewProjection.mat.every(Number.isFinite));
  assert.throws(
    () => createDirectionalLightMatrices({
      direction: [0, 1, 0],
      target: [0, 0, 0],
      distance: 20,
      halfWidth: 10,
      halfHeight: 8,
      near: 1,
      far: 50
    }),
    /must not be parallel to up/
  );
}

// static Shapeを1個描き、32 floatの行列uniformとdepth-only drawを記録する
{
  const probe = createProbe();
  const shadow = new ShadowMapPass(probe.gpu, {
    label: "shadow-probe",
    width: 64,
    height: 32
  });
  const model = createDirectionalLightMatrices({
    direction: [1, -1, 1],
    target: [0, 0, 0],
    distance: 10,
    halfWidth: 5,
    halfHeight: 5,
    near: 1,
    far: 30
  });
  const shape = {
    isHidden: false,
    hasSkeleton: false,
    vertexBuffer: {},
    vertexCount: 8,
    indexBuffer: {},
    indexCount: 12,
    indexFormat: "uint16"
  };
  const node = {
    NODE_T: 0,
    type: 0,
    name: "caster",
    shapes: [shape],
    getWorldMatrix: () => model.world
  };
  const timestampWrites = { querySet: {}, beginningOfPassWriteIndex: 2 };
  const count = shadow.renderSpace({ nodes: [node] }, model.viewProjection, {
    timestampWrites
  });
  assert.equal(count, 1);
  assert.deepEqual(probe.draws, [12]);
  assert.equal(probe.writes[0].values.length, 36);
  assert.equal(probe.writes[0].values[32], 0);
  assert.equal(probe.vertexBindings[0].buffer, shape.vertexBuffer);
  assert.equal(probe.vertexBindings[1].index, 1);
  assert.equal(probe.renderPassDescriptors[0].timestampWrites, timestampWrites);
  assert.equal(shadow.getWidth(), 64);
  assert.equal(shadow.getHeight(), 32);
  assert.equal(shadow.resize(64, 32), false);
  assert.equal(shadow.resize(128, 96), true);
  const lastTexture = probe.textures.at(-1);
  assert.equal(shadow.destroy(), true);
  assert.equal(lastTexture.destroyed, true);
  assert.equal(shadow.destroy(), false);
  assert.throws(() => shadow.getBindingResources(), /is destroyed/);
}

// skinned Shapeは2本のvertex bufferと現在のbone paletteを使ってdepth drawする
{
  const probe = createProbe();
  const shadow = new ShadowMapPass(probe.gpu);
  const palette = new Float32Array(24);
  palette[0] = 1;
  palette[5] = 1;
  palette[10] = 1;
  const skeleton = {
    updateCount: 0,
    updateMatrixPalette() {
      this.updateCount += 1;
      return palette;
    }
  };
  const shape = {
    isHidden: false,
    hasSkeleton: true,
    vertexBuffer0: {},
    vertexBuffer1: {},
    indexBuffer: {},
    indexCount: 3,
    indexFormat: "uint16",
    getSkeleton: () => skeleton
  };
  const matrix = createDirectionalLightMatrices({
    direction: [1, -1, 1],
    target: [0, 0, 0],
    distance: 10,
    halfWidth: 5,
    halfHeight: 5,
    near: 1,
    far: 30
  });
  const node = {
    NODE_T: 0,
    type: 0,
    name: "skin",
    shapes: [shape],
    getWorldMatrix: () => matrix.world
  };
  assert.equal(shadow.renderSpace({ nodes: [node] }, matrix.viewProjection), 1);
  assert.equal(skeleton.updateCount, 1);
  assert.equal(probe.writes.length, 2);
  assert.equal(probe.writes[0].values[32], 1);
  assert.equal(probe.writes[1].size, palette.byteLength);
  assert.equal(probe.vertexBindings[0].buffer, shape.vertexBuffer0);
  assert.equal(probe.vertexBindings[1].buffer, shape.vertexBuffer1);
  assert.deepEqual(probe.bindGroups.map((entry) => entry.index), [0, 1]);
  shadow.destroy();
}

console.log("PASS ShadowMapPass headless contracts");
