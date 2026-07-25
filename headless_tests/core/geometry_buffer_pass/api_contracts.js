// ---------------------------------------------------------
// headless_tests/core/geometry_buffer_pass/headless_probe.js  2026/07/14
//   headless contracts for GeometryBufferPass
// ---------------------------------------------------------
import assert from "node:assert/strict";
import CameraFrame from "../../../webg/CameraFrame.js";
import { CAMERA_REVERSE_Z } from "../../../webg/DepthConvention.js";
import {
  GBUFFER_WGSL_COMMON,
  GeometryBufferPass,
  createGBufferProjectionParams
} from "../../../webg/GeometryBufferPass.js";
import Matrix from "../../../webg/Matrix.js";

function createCameraFrame() {
  return new CameraFrame({
    cameraWorldMatrix: new Matrix(),
    near: 0.1,
    far: 100.0,
    vfov: 90.0,
    aspect: 16.0 / 9.0,
    depthConvention: CAMERA_REVERSE_Z
  });
}

globalThis.GPUTextureUsage = {
  RENDER_ATTACHMENT: 1,
  TEXTURE_BINDING: 2,
  COPY_SRC: 4,
  COPY_DST: 8
};
globalThis.GPUShaderStage = {
  VERTEX: 1,
  FRAGMENT: 2
};
globalThis.GPUBufferUsage = {
  UNIFORM: 1,
  COPY_DST: 2
};

// GeometryBufferPassが生成するtexture、shader、pipelineを実GPUなしで記録します
// GPU objectは契約確認に必要なmethodだけを持ち、未定義動作をno-opで隠しません
function createGpuProbe() {
  const textureDescriptors = [];
  const shaderCodes = [];
  const pipelineDescriptors = [];
  const buffers = [];
  const writes = [];
  const device = {
    createSampler(descriptor) {
      return { descriptor };
    },
    createTexture(descriptor) {
      textureDescriptors.push(descriptor);
      return {
        descriptor,
        destroyed: false,
        createView() {
          return { label: `${descriptor.label}:view` };
        },
        destroy() {
          this.destroyed = true;
        }
      };
    },
    createBindGroupLayout(descriptor) {
      return { descriptor };
    },
    createShaderModule(descriptor) {
      shaderCodes.push(descriptor.code);
      return { descriptor };
    },
    createPipelineLayout(descriptor) {
      return { descriptor };
    },
    createRenderPipeline(descriptor) {
      pipelineDescriptors.push(descriptor);
      return { descriptor };
    },
    createBuffer(descriptor) {
      const buffer = {
        descriptor,
        destroyed: false,
        destroy() {
          this.destroyed = true;
        }
      };
      buffers.push(buffer);
      return buffer;
    },
    createBindGroup(descriptor) {
      return { descriptor };
    }
  };
  return {
    gpu: {
      device,
      queue: {
        writeTexture(...args) {
          writes.push(["texture", ...args]);
        },
        writeBuffer(...args) {
          writes.push(["buffer", ...args]);
        }
      }
    },
    textureDescriptors,
    shaderCodes,
    pipelineDescriptors,
    buffers,
    writes
  };
}

// JavaScript側のprojection配列は同じReverse-Z CameraFrameから生成します
{
  const values = createGBufferProjectionParams(createCameraFrame());
  assert.equal(values.length, 4);
  assert.ok(Math.abs(values[0] - 0.1) < 1e-6);
  assert.equal(values[1], 100);
  assert.ok(Math.abs(values[2] - 1) < 1e-6);
  assert.ok(Math.abs(values[3] - 16 / 9) < 1e-6);
  assert.throws(
    () => createGBufferProjectionParams({}),
    /requires a Reverse-Z CameraFrame/
  );
}

// material modeはcolor、normal、sample可能depthを作り、albedo名も公開します
{
  const probe = createGpuProbe();
  const pass = new GeometryBufferPass(probe.gpu, {
    label: "gbuffer-material-probe",
    width: 32,
    height: 24,
    colorMode: "material",
    normalSpace: "view"
  });
  await pass.ready;
  assert.equal(probe.textureDescriptors.length, 6);
  assert.deepEqual(
    probe.textureDescriptors.slice(0, 4).map((descriptor) => descriptor.format),
    ["rgba8unorm-srgb", "depth32float", "rgba8unorm", "rgba8unorm"]
  );
  assert.equal(
    probe.textureDescriptors[1].usage,
    GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
  );
  const resources = pass.getBindingResources();
  assert.equal(resources.color, resources.albedo);
  assert.equal(resources.depth, resources.color);
  assert.notEqual(resources.normal, resources.color);
  assert.notEqual(resources.material, resources.color);
  assert.equal(probe.pipelineDescriptors[0].fragment.targets.length, 3);
  assert.equal(probe.pipelineDescriptors[0].vertex.buffers.length, 2);
  assert.match(probe.shaderCodes[0], /var linearAlbedo = srgbToLinear\(uniforms\.albedo\.rgb\)/);
  assert.match(probe.shaderCodes[0], /output\.material = uniforms\.surface/);
  assert.match(probe.shaderCodes[0], /textureSample\(colorTexture/);
  assert.match(probe.shaderCodes[0], /linearAlbedo \*= srgbToLinear\(textureSrgb\)/);
  assert.match(probe.shaderCodes[0], /skin\.bones/);
  pass.destroy();
}

// v2 G-bufferは材質情報だけを出力し、照明済みcolor modeを受け入れません
{
  const probe = createGpuProbe();
  assert.throws(
    () => new GeometryBufferPass(probe.gpu, {
      label: "gbuffer-lit-probe",
      colorMode: "lit"
    }),
    /lit mode was removed from the v2 G-buffer/
  );
}

// Render Passへ渡されたtimestampWritesを変更せずdescriptorへ設定します
{
  const probe = createGpuProbe();
  const pass = new GeometryBufferPass(probe.gpu, {
    label: "gbuffer-timestamp-probe"
  });
  await pass.ready;
  const matrix = new Matrix();
  const shape = {
    vertexBuffer: {},
    vertexCount: 3,
    indexBuffer: {},
    indexFormat: "uint16",
    indexCount: 3
  };
  const entry = pass.addShape(
    { name: "timestamp-node", getWorldMatrix: () => matrix },
    shape,
    { albedo: [1, 1, 1], specular: 0.5, roughness: 0.4, metallic: 0.0, emissive: 0.0 }
  );
  const timestampWrites = { querySet: {}, endOfPassWriteIndex: 3 };
  let renderDescriptor = null;
  const renderPass = {
    setPipeline() {},
    setBindGroup() {},
    setVertexBuffer() {},
    setIndexBuffer() {},
    drawIndexed() {},
    end() {}
  };
  probe.gpu.endPass = () => {};
  probe.gpu.commandEncoder = {
    beginRenderPass(descriptor) {
      renderDescriptor = descriptor;
      return renderPass;
    }
  };
  pass.renderEntries(
    [entry],
    createCameraFrame(),
    [0, 0, 0, 1],
    { timestampWrites }
  );
  assert.equal(renderDescriptor.timestampWrites, timestampWrites);
  pass.destroy();
}

// material object、entry更新、visibility、removeは曖昧なvec4配列を受け入れません
{
  const probe = createGpuProbe();
  const pass = new GeometryBufferPass(probe.gpu, { label: "gbuffer-entry-probe" });
  await pass.ready;
  const node = { name: "node" };
  const shape = { vertexBuffer: {}, indexBuffer: {}, indexFormat: "uint16", indexCount: 3 };
  const entry = pass.addShape(node, shape, {
    albedo: [0.2, 0.4, 0.6],
    specular: 0.75,
    roughness: 0.5,
    metallic: 0.25,
    emissive: 0.1
  });
  assert.ok(Math.abs(entry.material[0] - 0.2) < 1e-6);
  assert.ok(Math.abs(entry.material[1] - 0.4) < 1e-6);
  assert.ok(Math.abs(entry.material[2] - 0.6) < 1e-6);
  assert.equal(entry.material[3], 1.0);
  assert.equal(entry.material[4], 0.75);
  assert.equal(entry.material[5], 0.5);
  assert.equal(entry.material[6], 0.25);
  assert.ok(Math.abs(entry.material[7] - 0.1) < 1e-6);
  pass.setMaterial(entry, {
    albedo: [0.8, 0.3, 0.1],
    specular: 0.25,
    roughness: 0.7,
    metallic: 0.0,
    emissive: 0.0
  });
  assert.ok(Math.abs(entry.material[0] - 0.8) < 1e-6);
  assert.ok(Math.abs(entry.material[4] - 0.25) < 1e-6);
  pass.setVisible(entry, false);
  assert.equal(entry.visible, false);
  assert.throws(
    () => pass.packMaterial([1, 0, 0, 1]),
    /material must be an object/
  );
  assert.throws(
    () => pass.packMaterial({ albedo: [1, 0, 0] }),
    /material\.specular must be finite/
  );
  const entryBuffer = entry.uniformBuffer;
  pass.remove(entry);
  assert.equal(pass.entries.length, 0);
  assert.equal(entryBuffer.destroyed, true);
  assert.throws(() => pass.setVisible(entry, true), /entry is not registered/);
  pass.destroy();
}

// renderSpace用の同期処理は標準Shape colorを読み、同じShapeのGPU resourceを再利用します
{
  const probe = createGpuProbe();
  const pass = new GeometryBufferPass(probe.gpu, { label: "gbuffer-space-probe" });
  await pass.ready;
  const shape = {
    shaderParam: {
      color: [0.3, 0.5, 0.7, 0.9],
      specular: 0.85,
      roughness: 0.35,
      metallic: 0.2,
      emissive: 0.1
    },
    vertexBuffer: {},
    indexBuffer: {},
    indexCount: 6,
    indexFormat: "uint16",
    vertexCount: 4,
    hasSkeleton: false,
    isHidden: false
  };
  const node = {
    name: "space-node",
    type: 0,
    NODE_T: 0,
    shapes: [shape]
  };
  const space = { nodes: [node] };
  const first = pass.syncSpaceEntries(space);
  const second = pass.syncSpaceEntries(space);
  assert.equal(first.length, 1);
  assert.equal(second[0], first[0]);
  assert.ok(Math.abs(first[0].material[0] - 0.3) < 1e-6);
  assert.equal(first[0].material[3], 1.0);
  const surfaceMaterial = Array.from(first[0].surface.material);
  const expectedSurfaceMaterial = [0.3, 0.5, 0.7, 1.0, 0.85, 0.35, 0.2, 0.1];
  for (let index = 0; index < expectedSurfaceMaterial.length; index++) {
    assert.ok(Math.abs(surfaceMaterial[index] - expectedSurfaceMaterial[index]) < 1e-6);
  }

  const cachedBuffer = first[0].uniformBuffer;
  space.nodes = [];
  assert.equal(pass.syncSpaceEntries(space).length, 0);
  assert.equal(cachedBuffer.destroyed, true);
  pass.destroy();
}

// 標準Shapeのtexture、normal map、Skeletonを同じsurface契約として解決します
{
  const pass = new GeometryBufferPass(createGpuProbe().gpu, {
    label: "gbuffer-space-errors"
  });
  await pass.ready;
  const baseShape = {
    shaderParam: {},
    vertexBuffer: {},
    indexBuffer: {},
    indexCount: 3,
    indexFormat: "uint16",
    vertexCount: 3,
    hasSkeleton: false,
    isHidden: false
  };
  const node = { name: "error-node", type: 0, NODE_T: 0, shapes: [baseShape] };
  assert.throws(
    () => pass.syncSpaceEntries({ nodes: [node] }),
    /Shape color/
  );
  baseShape.shaderParam.color = [1, 1, 1, 1];
  baseShape.shaderParam.specular = 1.1;
  assert.throws(
    () => pass.syncSpaceEntries({ nodes: [node] }),
    /material\.specular must be <= 1/
  );
  baseShape.shaderParam.specular = 0.6;
  baseShape.shaderParam.roughness = 0.0;
  assert.throws(
    () => pass.syncSpaceEntries({ nodes: [node] }),
    /material\.roughness must be >=/
  );
  baseShape.shaderParam.roughness = 0.4;
  baseShape.shaderParam.metallic = -1;
  assert.throws(
    () => pass.syncSpaceEntries({ nodes: [node] }),
    /material\.metallic must be >= 0/
  );
  baseShape.shaderParam.metallic = 0.2;
  baseShape.shaderParam.emissive = 0.0;
  baseShape.shaderParam.use_texture = 1;
  assert.throws(
    () => pass.syncSpaceEntries({ nodes: [node] }),
    /requires texture/
  );
  const texture = {
    getView() {
      return {};
    },
    getSampler() {
      return {};
    }
  };
  baseShape.shaderParam.texture = texture;
  baseShape.shaderParam.use_normal_map = 1;
  assert.throws(
    () => pass.syncSpaceEntries({ nodes: [node] }),
    /requires normal_texture/
  );
  baseShape.shaderParam.normal_texture = texture;
  baseShape.shaderParam.normal_strength = 0.75;
  const textured = pass.syncSpaceEntries({ nodes: [node] });
  assert.equal(textured[0].surface.useTexture, true);
  assert.equal(textured[0].surface.useNormalMap, true);
  assert.equal(textured[0].surface.normalStrength, 0.75);
  const texturedMaterial = Array.from(textured[0].surface.material);
  const expectedTexturedMaterial = [1, 1, 1, 1, 0.6, 0.4, 0.2, 0];
  for (let index = 0; index < expectedTexturedMaterial.length; index++) {
    assert.ok(Math.abs(texturedMaterial[index] - expectedTexturedMaterial[index]) < 1e-6);
  }

  baseShape.hasSkeleton = true;
  baseShape.vertexBuffer0 = {};
  baseShape.vertexBuffer1 = {};
  assert.throws(
    () => pass.syncSpaceEntries({ nodes: [node] }),
    /requires a Skeleton/
  );
  const palette = new Float32Array(24);
  const skeleton = {
    updateMatrixPalette() {
      return palette;
    }
  };
  baseShape.skeleton = skeleton;
  baseShape.getSkeleton = () => skeleton;
  const skinned = pass.syncSpaceEntries({ nodes: [node] });
  assert.equal(skinned[0].surface.skeleton, skeleton);

  const duplicateNode = {
    name: "duplicate-node",
    type: 0,
    NODE_T: 0,
    shapes: [baseShape]
  };
  assert.throws(
    () => pass.syncSpaceEntries({ nodes: [node, duplicateNode] }),
    /attached to multiple Nodes/
  );
  pass.destroy();
}

// 未対応layoutは自動的にview-spaceやmaterial modeへ戻さず、constructorで例外にします
assert.throws(
  () => new GeometryBufferPass(createGpuProbe().gpu, { colorMode: "unknown" }),
  /colorMode must be material/
);
assert.throws(
  () => new GeometryBufferPass(createGpuProbe().gpu, { normalSpace: "world" }),
  /normalSpace must be one of: view/
);

// 共通WGSLにはG-buffer writerとreaderが共有する3種類の変換関数が含まれます
assert.match(GBUFFER_WGSL_COMMON, /fn decodeGBufferNormal/);
assert.match(GBUFFER_WGSL_COMMON, /fn linearizeGBufferDepth/);
assert.match(GBUFFER_WGSL_COMMON, /fn reconstructGBufferViewPosition/);

console.log("PASS GeometryBufferPass headless contracts");
