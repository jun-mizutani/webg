globalThis.GPUBufferUsage ??= Object.freeze({
  VERTEX: 1,
  INDEX: 2,
  COPY_DST: 4,
  UNIFORM: 8,
  STORAGE: 16,
});
globalThis.GPUTextureUsage ??= Object.freeze({
  TEXTURE_BINDING: 1,
  COPY_DST: 2,
  RENDER_ATTACHMENT: 4,
  STORAGE_BINDING: 8,
});
globalThis.GPUShaderStage ??= Object.freeze({
  VERTEX: 1,
  FRAGMENT: 2,
  COMPUTE: 4,
});

export function createMockGpu() {
  const buffers = [];
  const textures = [];
  const samplers = [];
  const bindGroupLayouts = [];
  const bindGroups = [];
  const shaderModules = [];
  const pipelineLayouts = [];
  const bufferWrites = [];
  const textureWrites = [];

  const device = {
    createBuffer(descriptor) {
      const buffer = {
        descriptor,
        destroyed: false,
        destroy() {
          this.destroyed = true;
        },
      };
      buffers.push(buffer);
      return buffer;
    },
    createTexture(descriptor) {
      const texture = {
        descriptor,
        destroyed: false,
        createView(viewDescriptor = {}) {
          return { texture, descriptor: viewDescriptor };
        },
        destroy() {
          this.destroyed = true;
        },
      };
      textures.push(texture);
      return texture;
    },
    createSampler(descriptor = {}) {
      const sampler = { descriptor };
      samplers.push(sampler);
      return sampler;
    },
    createBindGroupLayout(descriptor) {
      const layout = { descriptor };
      bindGroupLayouts.push(layout);
      return layout;
    },
    createBindGroup(descriptor) {
      const bindGroup = { descriptor };
      bindGroups.push(bindGroup);
      return bindGroup;
    },
    createShaderModule(descriptor) {
      const module = { descriptor };
      shaderModules.push(module);
      return module;
    },
    createPipelineLayout(descriptor) {
      const layout = { descriptor };
      pipelineLayouts.push(layout);
      return layout;
    },
  };
  const queue = {
    writeBuffer(...args) {
      bufferWrites.push(args);
    },
    writeTexture(...args) {
      textureWrites.push(args);
    },
    copyExternalImageToTexture() {},
  };
  const gpu = {
    device,
    queue,
    ready: Promise.resolve(),
    format: "bgra8unorm",
    uniformIndex: 1,
  };
  return {
    gpu,
    device,
    queue,
    buffers,
    textures,
    samplers,
    bindGroupLayouts,
    bindGroups,
    shaderModules,
    pipelineLayouts,
    bufferWrites,
    textureWrites,
  };
}
