import assert from "node:assert/strict";
import Shader from "../../../webg/Shader.js";
import { createMockGpu } from "../../shared/mock_gpu.js";

const mock = createMockGpu();
const shader = new Shader(mock.gpu);
assert.equal(await shader.init(), true);
assert.equal(shader.device, mock.device);

shader.createUniformBuffer(64);
assert.equal(shader.uniformBuffer.descriptor.size, 64);
assert.equal(shader.uniformBuffer.descriptor.usage, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);

const module = shader.createShaderModule("@vertex fn main() {}");
assert.match(module.descriptor.code, /@vertex/);
const uniformLayout = shader.createUniformBindGroupLayout({ hasDynamicOffset: true });
assert.equal(uniformLayout.descriptor.entries[0].buffer.hasDynamicOffset, true);
const textureLayout = shader.createTextureBindGroupLayout();
assert.equal(textureLayout.descriptor.entries.length, 2);

const defaultTexture = shader.createDefaultTexture({ color: [1, 2, 3, 4] });
assert.ok(defaultTexture.view);
assert.ok(defaultTexture.sampler);
assert.equal(mock.textureWrites.length, 1);

shader.bindGroupLayout = shader.createUniformTextureBindGroupLayout();
shader.bindGroupCache = new Map();
const bindA = shader.getOrCreateTexturedBindGroup({
  texture: {
    texture: defaultTexture.texture,
    getView: () => defaultTexture.view,
    getSampler: () => defaultTexture.sampler,
  },
});
const bindB = shader.getOrCreateTexturedBindGroup({
  texture: {
    texture: defaultTexture.texture,
    getView: () => defaultTexture.view,
    getSampler: () => defaultTexture.sampler,
  },
});
assert.equal(bindA, bindB);
assert.equal(shader.allocUniformIndex(), 1);
assert.equal(shader.allocUniformIndex(), 2);

console.log("PASS shader_resource_contracts");
