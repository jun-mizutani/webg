// ---------------------------------------------------------
// headless_tests/samples/mmodeler/headless_probe.js  2026/07/13
//   mmodeler overlay attachment and Reverse-Z bias contracts
// ---------------------------------------------------------
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import EdgeWireframeOverlayRenderer from "../../../samples/mmodeler/edgeWireframeOverlayRenderer.js";
import Overlay2DRenderer from "../../../samples/mmodeler/overlay2dRenderer.js";
import { CAMERA_REVERSE_Z } from "../../../webg/DepthConvention.js";

// WebGPU定数は実ブラウザだけが提供するため、headless resource生成に必要な値だけを定義する
globalThis.GPUBufferUsage = Object.freeze({
  UNIFORM: 1,
  COPY_DST: 2,
  VERTEX: 4
});
globalThis.GPUShaderStage = Object.freeze({ VERTEX: 1 });

function read(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

// sample専用rendererが作るpipeline descriptorとWGSLを記録し、実GPUなしで深度契約を検査する
function makeGpuProbe() {
  const pipelines = [];
  const device = {
    createBuffer: (descriptor) => ({ descriptor, destroy() {} }),
    createShaderModule: (descriptor) => ({ descriptor }),
    createBindGroupLayout: (descriptor) => ({ descriptor }),
    createBindGroup: (descriptor) => ({ descriptor }),
    createPipelineLayout: (descriptor) => ({ descriptor }),
    createRenderPipeline: (descriptor) => {
      pipelines.push(descriptor);
      return { descriptor };
    }
  };
  return {
    pipelines,
    gpu: {
      ready: Promise.resolve(),
      device,
      queue: { writeBuffer() {} },
      format: "bgra8unorm",
      passEncoder: null
    }
  };
}

// edge/guide line overlayはScreenと同じdepth32float・greater-equalを使い、biasをnear方向へ加算する
{
  const probe = makeGpuProbe();
  const renderer = new EdgeWireframeOverlayRenderer(probe.gpu);
  await renderer.init();
  assert.equal(probe.pipelines.length, 1);
  assert.equal(probe.pipelines[0].depthStencil.format, CAMERA_REVERSE_Z.format);
  assert.equal(probe.pipelines[0].depthStencil.depthCompare, CAMERA_REVERSE_Z.compareEqual);
  assert.equal(probe.pipelines[0].depthStencil.depthWriteEnabled, false);
  assert.match(
    probe.pipelines[0].vertex.module.descriptor.code,
    /clip\.z = min\(clip\.w, clip\.z \+ uniforms\.params\.x \* clip\.w\)/
  );
}

// vertex/face marker overlayも同じattachment stateを使い、既存depthを変更しない
{
  const probe = makeGpuProbe();
  const renderer = new Overlay2DRenderer(probe.gpu);
  await renderer.init();
  assert.equal(probe.pipelines.length, 1);
  assert.equal(probe.pipelines[0].depthStencil.format, CAMERA_REVERSE_Z.format);
  assert.equal(probe.pipelines[0].depthStencil.depthCompare, CAMERA_REVERSE_Z.compareEqual);
  assert.equal(probe.pipelines[0].depthStencil.depthWriteEnabled, false);
}

const main = read("../../../samples/mmodeler/main.js");
const edgeSource = read("../../../samples/mmodeler/edgeWireframeOverlayRenderer.js");
const markerSource = read("../../../samples/mmodeler/overlay2dRenderer.js");
const html = read("../../../samples/mmodeler/mmodeler.html");

// 選択面とCPU投影markerもReverse-Zの手前方向へbiasし、旧通常Z文字列を残さない
{
  assert.match(main, /depthCompare:\s*CAMERA_REVERSE_Z\.compareEqual/);
  assert.match(
    main,
    /output\.position\.z = min\(output\.position\.w, output\.position\.z \+ \$\{SELECTED_FACE_Z_BIAS_PERSPECTIVE\.toFixed\(8\)\} \* output\.position\.w\)/
  );
  assert.match(main, /Math\.min\(1\.0, z \+ zBias\)/);
  for (const source of [main, edgeSource, markerSource]) {
    assert.doesNotMatch(source, /depth24plus|less-equal/);
  }
  assert.match(html, /main\.js\?v=20260713_reverse_z_overlay1/);
}

console.log("sample_mmodeler_depth_overlay_contracts: all Reverse-Z overlay contracts passed");
