// ---------------------------------------------------------
// headless_tests/integration/rendering_depth_pipelines/pipeline_contracts.js  2026/07/28
//   GPU pipeline descriptor contracts for Reverse-Z drawing
// ---------------------------------------------------------
import assert from "node:assert/strict";
import Background from "../../../webg/Background.js";
import BillboardShader from "../../../webg/BillboardShader.js";
import Font from "../../../webg/Font.js";
import GlassMaskShader from "../../../webg/GlassMaskShader.js";
import SmoothShader from "../../../webg/SmoothShader.js";
import Wireframe from "../../../webg/Wireframe.js";

globalThis.GPUShaderStage = { VERTEX: 1, FRAGMENT: 2 };
globalThis.GPUBufferUsage = { UNIFORM: 1, COPY_DST: 2, VERTEX: 4, INDEX: 8 };
globalThis.GPUTextureUsage = { TEXTURE_BINDING: 1, COPY_DST: 2, RENDER_ATTACHMENT: 4 };

// 各shaderが必要とするGPU APIだけを記録し、pipeline descriptorを実GPUなしで検査します
// resource objectは呼び出されたmethodだけを持ち、pipeline作成失敗をno-opで隠しません
function createGpuProbe() {
  const pipelines = [];
  const device = {
    limits: { minUniformBufferOffsetAlignment: 256 },
    createShaderModule: (descriptor) => ({ descriptor }),
    createBindGroupLayout: (descriptor) => ({ descriptor }),
    createPipelineLayout: (descriptor) => ({ descriptor }),
    createRenderPipeline(descriptor) { pipelines.push(descriptor); return { descriptor }; },
    createBuffer: (descriptor) => ({ descriptor, destroy() {} }),
    createBindGroup: (descriptor) => ({ descriptor }),
    createSampler: (descriptor) => ({ descriptor }),
    createTexture(descriptor) {
      return { descriptor, createView: () => ({ descriptor }), destroy() {} };
    }
  };
  return {
    gpu: {
      device,
      queue: { writeBuffer() {}, writeTexture() {} },
      format: "bgra8unorm",
      ready: Promise.resolve()
    },
    pipelines
  };
}

async function readDepthStencil(ShaderClass, options = undefined) {
  const probe = createGpuProbe();
  const shader = options === undefined
    ? new ShaderClass(probe.gpu)
    : new ShaderClass(probe.gpu, options);
  assert.equal(await shader.init(), true, `${ShaderClass.name} init`);
  const expectedPipelineCount = ShaderClass === SmoothShader ? 2 : 1;
  assert.equal(probe.pipelines.length, expectedPipelineCount, `${ShaderClass.name} pipeline count`);
  if (ShaderClass === SmoothShader) {
    assert.equal(probe.pipelines[0].depthStencil.depthWriteEnabled, true);
    assert.equal(probe.pipelines[1].depthStencil.depthWriteEnabled, false);
    assert.equal(probe.pipelines[1].depthStencil.depthCompare, "greater");
  }
  return probe.pipelines[0].depthStencil;
}

// 通常の面、mask、billboardはclear後の0.0より手前にあるfragmentだけを描く
for (const ShaderClass of [SmoothShader, GlassMaskShader, BillboardShader]) {
  const depth = await readDepthStencil(ShaderClass);
  assert.equal(depth.format, "depth32float", `${ShaderClass.name} format`);
  assert.equal(depth.depthCompare, "greater", `${ShaderClass.name} compare`);
}

// Backgroundの頂点はclearValueと同じ最奥の0.0なので、背景だけ同値比較を許可する
// depth writeを無効のまま維持し、背景が手前の3D形状のdepthを変更しないことも確認する
{
  const depth = await readDepthStencil(Background);
  assert.equal(depth.format, "depth32float");
  assert.equal(depth.depthCompare, "greater-equal");
  assert.equal(depth.depthWriteEnabled, false);
}

// 利用側が旧lessを指定してもSmooth/Glassの規則を上書きできず、後方互換分岐を残しません
{
  const smooth = await readDepthStencil(SmoothShader, { depthCompare: "less" });
  const glass = await readDepthStencil(GlassMaskShader, { depthCompare: "less" });
  assert.equal(smooth.depthCompare, "greater");
  assert.equal(glass.depthCompare, "greater");
}

// Wireframeは同一面上の線を許すためReverse-Zのgreater-equalを使用します
{
  const depth = await readDepthStencil(Wireframe);
  assert.equal(depth.format, "depth32float");
  assert.equal(depth.depthCompare, "greater-equal");
  assert.equal(depth.depthWriteEnabled, true);
}

// Fontはoverlayとしてalwaysを維持するが、attachment formatはcanvas depthと一致させます
{
  const depth = await readDepthStencil(Font);
  assert.equal(depth.format, "depth32float");
  assert.equal(depth.depthCompare, "always");
  assert.equal(depth.depthWriteEnabled, false);
}

console.log("rendering_depth_pipelines_contracts: all pipeline contracts passed");
