// ---------------------------------------------------------
// headless_tests/core/geometry_buffer_pass/headless_probe.js  2026/07/20
//   Explicit specular, roughness, metallic, emissive G-buffer contracts
// ---------------------------------------------------------
import assert from "node:assert/strict";
import CameraFrame from "../../../webg/CameraFrame.js";
import { srgbColorToLinear } from "../../../webg/ColorSpace.js";
import { CAMERA_REVERSE_Z } from "../../../webg/DepthConvention.js";
import GeometryBufferPass, {
  GBUFFER_COLOR_FORMAT,
  GBUFFER_MATERIAL_FORMAT
} from "../../../webg/GeometryBufferPass.js";
import Matrix from "../../../webg/Matrix.js";

globalThis.GPUTextureUsage = {
  RENDER_ATTACHMENT: 1,
  TEXTURE_BINDING: 2,
  COPY_SRC: 4,
  COPY_DST: 8
};
globalThis.GPUShaderStage = { VERTEX: 1, FRAGMENT: 2 };
globalThis.GPUBufferUsage = { UNIFORM: 1, COPY_DST: 2, VERTEX: 4 };

// GeometryBufferPassが作るMRT descriptor、WGSL、uniform write、clear値を記録します
function createGpuProbe() {
  const textures = [];
  const pipelines = [];
  const shaderCodes = [];
  const writes = [];
  const renderPasses = [];
  const renderPass = {
    setPipeline() {},
    setBindGroup() {},
    setVertexBuffer() {},
    setIndexBuffer() {},
    drawIndexed() {},
    end() {}
  };
  const commandEncoder = {
    beginRenderPass(descriptor) {
      renderPasses.push(descriptor);
      return renderPass;
    }
  };
  const device = {
    createSampler: (descriptor) => ({ descriptor }),
    createTexture(descriptor) {
      textures.push(descriptor);
      return {
        descriptor,
        createView: () => ({ descriptor }),
        destroy() {}
      };
    },
    createBindGroupLayout: (descriptor) => ({ descriptor }),
    createShaderModule(descriptor) {
      shaderCodes.push(descriptor.code);
      return { descriptor };
    },
    createPipelineLayout: (descriptor) => ({ descriptor }),
    createRenderPipeline(descriptor) {
      pipelines.push(descriptor);
      return { descriptor };
    },
    createBuffer: (descriptor) => ({ descriptor, destroy() {} }),
    createBindGroup: (descriptor) => ({ descriptor }),
    createCommandEncoder: () => commandEncoder
  };
  const queue = {
    writeTexture() {},
    writeBuffer(buffer, offset, data) {
      writes.push({ buffer, offset, data: Array.from(data) });
    }
  };
  return {
    gpu: { device, queue, commandEncoder, endPass() {} },
    textures,
    pipelines,
    shaderCodes,
    writes,
    renderPasses
  };
}

function makeFrame() {
  const cameraWorldMatrix = new Matrix();
  cameraWorldMatrix.position([1.0e10, -2.0e10, 3.0e10]);
  return new CameraFrame({
    cameraWorldMatrix,
    near: 0.2,
    far: 5000.0,
    vfov: 60.0,
    aspect: 2.0,
    depthConvention: CAMERA_REVERSE_Z
  });
}

const material = {
  albedo: [0.25, 0.5, 0.75],
  specular: 0.6,
  roughness: 0.35,
  metallic: 0.8,
  emissive: 0.1
};

// v2 G-bufferはalbedo、normal、materialの3 MRTを持ち、lit colorを生成しません
{
  const probe = createGpuProbe();
  const pass = new GeometryBufferPass(probe.gpu, {
    label: "v2-material-gbuffer",
    width: 32,
    height: 16,
    colorMode: "material"
  });
  await pass.ready;
  assert.equal(GBUFFER_COLOR_FORMAT, "rgba8unorm-srgb");
  assert.equal(GBUFFER_MATERIAL_FORMAT, "rgba8unorm");
  assert.equal(pass.materialFormat, "rgba8unorm");
  assert.equal(probe.pipelines[0].fragment.targets.length, 3);
  assert.deepEqual(
    probe.pipelines[0].fragment.targets.map(({ format }) => format),
    ["rgba8unorm-srgb", "rgba8unorm", "rgba8unorm"]
  );
  assert.match(probe.shaderCodes[0], /@location\(2\) material : vec4f/);
  assert.match(probe.shaderCodes[0], /output\.material = uniforms\.surface/);
  assert.match(probe.shaderCodes[0], /srgbToLinear\(uniforms\.albedo\.rgb\)/);
  assert.match(probe.shaderCodes[0], /linearAlbedo \*= srgbToLinear\(textureSrgb\)/);
  assert.match(probe.shaderCodes[0], /output\.albedo = vec4f\(linearAlbedo, 1\.0\)/);
  assert.doesNotMatch(
    probe.shaderCodes[0],
    /srgbToLinear\(uniforms\.albedo\.rgb\s*\*\s*textureSample/
  );
  assert.doesNotMatch(probe.shaderCodes[0], /let specular = pow/);
  assert.doesNotMatch(probe.shaderCodes[0], /litColor/);
  const resources = pass.getBindingResources();
  assert.equal(resources.material, pass.materialTarget);
  assert.equal(resources.albedo, pass.colorTarget);
  pass.destroy();
}

// materialはalbedo RGB + 1、specular、roughness、metallic、emissiveの8 floatへ詰めます
{
  const probe = createGpuProbe();
  const pass = new GeometryBufferPass(probe.gpu);
  await pass.ready;
  assert.deepEqual(Array.from(pass.packMaterial(material)), [
    0.25,
    0.5,
    0.75,
    1.0,
    Math.fround(0.6),
    Math.fround(0.35),
    Math.fround(0.8),
    Math.fround(0.1)
  ]);
  assert.throws(() => pass.packMaterial({
    albedo: [1.0, 1.0, 1.0],
    materialValue: 0.5
  }), /material\.specular must be finite/);
  assert.throws(() => pass.packMaterial({ ...material, roughness: 1.1 }), /roughness must be <= 1/);
  assert.throws(() => pass.packMaterial({ ...material, metallic: -0.1 }), /metallic must be >= 0/);
  pass.destroy();
}

// render時は材質8 floatとflags 4 floatを重ならないoffsetへ書き、第三attachmentをclearします
{
  const probe = createGpuProbe();
  const pass = new GeometryBufferPass(probe.gpu, { width: 8, height: 4 });
  await pass.ready;
  const world = new Matrix();
  world.position([1.0e10 + 2.0, -2.0e10 + 1.0, 3.0e10 - 8.0]);
  const entry = pass.addShape(
    { name: "material-caster", getWorldMatrix: () => world },
    {
      vertexBuffer: {},
      vertexCount: 3,
      indexBuffer: {},
      indexFormat: "uint16",
      indexCount: 3
    },
    material
  );
  const clearColor = [0.04045, 0.5, 1.0, 1.0];
  pass.renderEntries([entry], makeFrame(), clearColor);
  const uniform = probe.writes.at(-1).data;
  assert.equal(uniform.length, 60);
  assert.deepEqual(uniform.slice(48, 56), Array.from(pass.packMaterial(material)));
  assert.deepEqual(uniform.slice(56, 60), [0.0, 0.0, 1.0, 0.0]);
  assert.equal(probe.renderPasses[0].colorAttachments.length, 3);
  assert.deepEqual(
    probe.renderPasses[0].colorAttachments[0].clearValue,
    srgbColorToLinear(clearColor)
  );
  assert.deepEqual(probe.renderPasses[0].colorAttachments[2].clearValue, {
    r: 0.0,
    g: 1.0,
    b: 0.0,
    a: 0.0
  });
  pass.destroy();
}

// 同一Shapeの複数opaque slotは別Uniform Bufferを使い、後slotの値で先drawを上書きしません
{
  const probe = createGpuProbe();
  const pass = new GeometryBufferPass(probe.gpu, { width: 8, height: 4 });
  await pass.ready;
  const materials = [
    { color: [1, 0.2, 0.1, 1], specular: 0.2, roughness: 0.3, metallic: 0.0, emissive: 0.0 },
    { color: [0.1, 0.7, 1, 1], specular: 0.5, roughness: 0.4, metallic: 0.1, emissive: 0.2 }
  ];
  const shape = {
    vertexBuffer: {},
    vertexCount: 4,
    indexBuffer: {},
    indexFormat: "uint16",
    indexCount: 6,
    getMaterialCount: () => 2,
    getMaterialAlpha: () => 1.0,
    getShaderParametersForMaterial: (index) => materials[index],
    getMaterialDrawInfo: () => ({ buffer: {}, count: 3, format: "uint16" })
  };
  const node = { name: "two-materials", getWorldMatrix: () => new Matrix() };
  const slot0Surface = pass.resolveShapeSurface(shape, null, 0);
  const entry = pass.createDrawEntry(node, shape, slot0Surface.material, slot0Surface);
  pass.renderEntries([entry], makeFrame(), [0, 0, 0, 1]);
  const materialWrites = probe.writes.filter(({ data }) => data.length === 60);
  assert.equal(materialWrites.length, 2);
  assert.notEqual(materialWrites[0].buffer, materialWrites[1].buffer);
  assert.deepEqual(materialWrites[0].data.slice(48, 51), [1, Math.fround(0.2), Math.fround(0.1)]);
  assert.deepEqual(materialWrites[1].data.slice(48, 51), [Math.fround(0.1), Math.fround(0.7), 1]);
  pass.destroyDrawEntry(entry);
  pass.destroy();
}

// v2では照明済みcolorをalbedoへ焼き込むlit modeを明示的に拒否します
{
  const probe = createGpuProbe();
  assert.throws(() => new GeometryBufferPass(probe.gpu, {
    colorMode: "lit"
  }), /lit mode was removed from the v2 G-buffer/);
  assert.throws(() => new GeometryBufferPass(probe.gpu, {
    colorFormat: "rgba8unorm"
  }), /colorFormat must be rgba8unorm-srgb/);
}

console.log("geometry_buffer_pass_material_contracts: all explicit material contracts passed");
