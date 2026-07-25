// ---------------------------------------------------------
// headless_tests/core/render_target/headless_probe.js  2026/07/16
//   GPU descriptor contracts for v2 depth resources
// ---------------------------------------------------------
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CAMERA_REVERSE_Z, SHADOW_STANDARD_Z } from "../../../webg/DepthConvention.js";
import RenderTarget from "../../../webg/RenderTarget.js";
import Screen from "../../../webg/Screen.js";

function read(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

globalThis.GPUTextureUsage = {
  RENDER_ATTACHMENT: 1,
  TEXTURE_BINDING: 2,
  COPY_SRC: 4
};

function createGpuProbe() {
  const textures = [];
  const device = {
    createSampler: (descriptor) => ({ descriptor }),
    createTexture(descriptor) {
      textures.push(descriptor);
      return { descriptor, createView: () => ({ descriptor }), destroy() {} };
    }
  };
  return { gpu: { device, queue: {} }, textures };
}

// 通常カメラtargetはDepth Conventionからdepth32floatを作り、sample用途を明示時だけ追加します
{
  const probe = createGpuProbe();
  const target = new RenderTarget(probe.gpu, { width: 32, height: 24,
    sampleDepth: true, depthConvention: CAMERA_REVERSE_Z });
  await target.ready;
  assert.equal(target.depthConvention, CAMERA_REVERSE_Z);
  assert.equal(target.depthFormat, "depth32float");
  assert.equal(probe.textures[1].format, "depth32float");
  assert.equal(probe.textures[1].usage,
    GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING);
}

// Shadow用targetも同じformatだが、異なるconvention identityを保持します
{
  const probe = createGpuProbe();
  const target = new RenderTarget(probe.gpu, { depthConvention: SHADOW_STANDARD_Z });
  await target.ready;
  assert.equal(target.depthConvention, SHADOW_STANDARD_Z);
  assert.equal(target.depthFormat, "depth32float");
}

// depthを持つtargetはconvention必須で、旧depth24plus既定値へ戻りません
{
  const probe = createGpuProbe();
  assert.throws(() => new RenderTarget(probe.gpu),
    /must be CAMERA_REVERSE_Z or SHADOW_STANDARD_Z/);
}

// BloomPassのscene targetも通常カメラで描くため、深度ありtargetへCamera Reverse-Zを明示します
// RenderTargetの検証を迂回せず、BloomPass初期化時に規約不明で停止する回帰を防ぎます
{
  const source = read("../../../webg/BloomPass.js");
  assert.match(source, /import \{ CAMERA_REVERSE_Z \} from "\.\/DepthConvention\.js";/);
  assert.match(
    source,
    /label: "BloomPass:scene",[\s\S]*?hasDepth: true,[\s\S]*?depthConvention: CAMERA_REVERSE_Z/
  );
}

// color-only targetはdepth規則を要求せず、depth textureを生成しません
{
  const probe = createGpuProbe();
  const target = new RenderTarget(probe.gpu, { hasDepth: false });
  await target.ready;
  assert.equal(target.depthConvention, null);
  assert.equal(target.depthTexture, null);
  assert.equal(probe.textures.length, 1);
}

// Screenのcanvas depthも同じ通常カメラconventionを使い、render passを0でclearします
{
  const textures = [];
  const renderPasses = [];
  const canvasContext = {
    configure() {},
    getCurrentTexture() { return { createView: () => ({ label: "canvas-view" }) }; }
  };
  const canvas = { width: 64, height: 48, clientWidth: 64, clientHeight: 48, style: {},
    getContext: () => canvasContext };
  const device = {
    queue: {}, features: new Set(),
    createTexture(descriptor) {
      textures.push(descriptor);
      return { descriptor, createView: () => ({ label: "depth-view" }), destroy() {} };
    },
    createCommandEncoder() {
      return {
        beginRenderPass(descriptor) {
          renderPasses.push(descriptor);
          return { end() {} };
        }
      };
    }
  };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { gpu: {
    requestAdapter: async () => ({ features: new Set(), requestDevice: async () => device }),
    getPreferredCanvasFormat: () => "bgra8unorm"
  }}});
  const screen = new Screen({ getElementById: () => canvas });
  await screen.ready;
  assert.equal(textures[0].format, "depth32float");
  screen.clear();
  assert.equal(renderPasses[0].depthStencilAttachment.depthClearValue, 0.0);
}

console.log("render_target_depth_contracts: all resource contracts passed");
