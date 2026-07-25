// ---------------------------------------------------------
// headless_tests/integration/presentation/headless_probe.js  2026/07/13
//   Final display texture to swapchain presentation contract
// ---------------------------------------------------------
import assert from "node:assert/strict";
import FullscreenPass, {
  FULLSCREEN_SOURCE_FORMAT
} from "../../../webg/FullscreenPass.js";
import Screen from "../../../webg/Screen.js";
import VignettePass from "../../../webg/VignettePass.js";

globalThis.GPUTextureUsage = {
  TEXTURE_BINDING: 1,
  COPY_DST: 2,
  RENDER_ATTACHMENT: 4
};
globalThis.GPUShaderStage = { VERTEX: 1, FRAGMENT: 2 };
globalThis.GPUBufferUsage = { UNIFORM: 1, COPY_DST: 2, VERTEX: 4 };

// ScreenとFullscreenPassが共有するcanvas、device、render passを記録します
function createEnvironment(width = 16, height = 8) {
  const renderDescriptors = [];
  const draws = [];
  const pass = {
    setPipeline() {},
    setVertexBuffer() {},
    setBindGroup() {},
    draw(...args) { draws.push(args); },
    end() {}
  };
  const queue = {
    writeTexture() {},
    writeBuffer() {},
    submit() {}
  };
  const device = {
    queue,
    features: new Set(),
    createTexture: (descriptor) => ({
      descriptor,
      createView: () => ({ descriptor }),
      destroy() {}
    }),
    createBuffer: (descriptor) => ({ descriptor, destroy() {} }),
    createSampler: (descriptor) => ({ descriptor }),
    createShaderModule: (descriptor) => ({ descriptor }),
    createBindGroupLayout: (descriptor) => ({ descriptor }),
    createPipelineLayout: (descriptor) => ({ descriptor }),
    createRenderPipeline: (descriptor) => ({ descriptor }),
    createBindGroup: (descriptor) => ({ descriptor }),
    createCommandEncoder: () => ({
      beginRenderPass(descriptor) {
        renderDescriptors.push(descriptor);
        return pass;
      },
      finish: () => ({})
    })
  };
  const context = {
    configure() {},
    getCurrentTexture: () => ({ createView: () => ({ swapchain: true }) })
  };
  const canvas = {
    width,
    height,
    clientWidth: width,
    clientHeight: height,
    style: {},
    getContext: () => context,
    toBlob() {}
  };
  const adapter = {
    features: new Set(),
    requestDevice: async () => device
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      gpu: {
        requestAdapter: async () => adapter,
        getPreferredCanvasFormat: () => "bgra8unorm"
      }
    }
  });
  const document = { getElementById: (id) => id === "canvas" ? canvas : null };
  return { document, canvas, renderDescriptors, draws };
}

function makeSource(width = 16, height = 8, format = FULLSCREEN_SOURCE_FORMAT) {
  return {
    getView: () => ({}),
    getSampler: () => ({}),
    getFormat: () => format,
    getWidth: () => width,
    getHeight: () => height
  };
}

// Screen.beginPresentPassはswapchain colorだけをattachmentにし、depthを持ちません
{
  const environment = createEnvironment();
  const screen = new Screen(environment.document);
  await screen.ready;
  const gpu = screen.getGPU();
  const fullscreen = new FullscreenPass(gpu, { targetFormat: "bgra8unorm" });
  assert.equal(await fullscreen.init(), true);
  assert.equal(fullscreen.targetFormat, "bgra8unorm");
  const vignette = new VignettePass(gpu);
  assert.equal(await vignette.init(), true);
  assert.equal(vignette.targetFormat, "bgra8unorm");
  assert.throws(
    () => fullscreen.setColorScale(Number.NaN, 1, 1, 1),
    /colorScale\.r must be finite/
  );
  assert.throws(
    () => fullscreen.setUvScale(1, Infinity),
    /uvScale\.v must be finite/
  );

  assert.throws(
    () => fullscreen.draw(makeSource()),
    /requires an active presentation render pass/
  );

  screen.clear();
  assert.equal(gpu.passTargetsSwapChain, true);
  assert.equal(gpu.passHasDepth, true);
  assert.throws(
    () => fullscreen.draw(makeSource()),
    /requires Screen\.beginPresentPass\(\) with no depth attachment/
  );

  screen.beginPresentPass();
  assert.equal(gpu.passTargetsSwapChain, true);
  assert.equal(gpu.passHasDepth, false);
  const descriptor = environment.renderDescriptors.at(-1);
  assert.equal(Object.hasOwn(descriptor, "depthStencilAttachment"), false);
  fullscreen.draw(makeSource());
  assert.deepEqual(environment.draws.at(-1), [4, 1, 0, 0]);
  screen.present();
  assert.equal(gpu.passTargetsSwapChain, false);
  assert.equal(gpu.passHasDepth, false);

  assert.throws(
    () => fullscreen.validateSource(makeSource(16, 8, "rgba16float")),
    /source format must be rgba8unorm/
  );
  assert.throws(
    () => fullscreen.validateSource(makeSource(8, 8)),
    /source size 8x8 does not match canvas size 16x8/
  );
}

assert.throws(
  () => new FullscreenPass({ format: "bgra8unorm" }, { blendMode: "unknown" }),
  /blendMode must be one of:/
);

// canvas formatと異なるrender pipeline targetを要求しても暗黙変換しません
{
  const environment = createEnvironment();
  const screen = new Screen(environment.document);
  await screen.ready;
  const fullscreen = new FullscreenPass(screen.getGPU(), {
    targetFormat: "rgba8unorm"
  });
  await assert.rejects(
    () => fullscreen.init(),
    /targetFormat must match canvas format bgra8unorm/
  );
}

console.log("presentation_fullscreen_contracts: all final presentation contracts passed");
