// ---------------------------------------------------------
// headless_tests/core/compute_effect_tone_map_pass/headless_probe.js  2026/07/14
//   Final High Dynamic Range to display conversion contract
// ---------------------------------------------------------
import assert from "node:assert/strict";
import ComputeEffectToneMapPass, {
  COMPUTE_EFFECT_TONEMAP_INPUT_FORMAT,
  COMPUTE_EFFECT_TONEMAP_OUTPUT_FORMAT,
  COMPUTE_EFFECT_TONEMAP_WGSL
} from "../../../webg/ComputeEffectToneMapPass.js";
import {
  linearChannelToSrgb,
  srgbChannelToLinear
} from "../../../webg/ColorSpace.js";
import { CAMERA_REVERSE_Z } from "../../../webg/DepthConvention.js";

globalThis.GPUTextureUsage = {
  STORAGE_BINDING: 1,
  TEXTURE_BINDING: 2,
  COPY_SRC: 4
};
globalThis.GPUShaderStage = { COMPUTE: 1 };
globalThis.GPUBufferUsage = { UNIFORM: 1, COPY_DST: 2 };

// Tone Map passが作るtextureとuniform writeを記録し、実GPUなしで境界契約を検査します
function createGpuProbe() {
  const textures = [];
  const writes = [];
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
    createBuffer: (descriptor) => ({ descriptor, destroy() {} }),
    createBindGroupLayout: (descriptor) => ({ descriptor }),
    createShaderModule: (descriptor) => ({ descriptor }),
    createPipelineLayout: (descriptor) => ({ descriptor }),
    createComputePipeline: (descriptor) => ({ descriptor }),
    createBindGroup: (descriptor) => ({ descriptor })
  };
  const queue = {
    writeTexture() {},
    writeBuffer(buffer, offset, data) {
      writes.push({ buffer, offset, data: Array.from(data) });
    }
  };
  const commandEncoder = {
    beginComputePass() {
      return {
        setPipeline() {},
        setBindGroup() {},
        dispatchWorkgroups() {},
        end() {}
      };
    }
  };
  return { gpu: { device, queue }, commandEncoder, textures, writes };
}

// 色形式を自己申告するHigh Dynamic Range targetとCamera Reverse-Z depthを作ります
function makeResources(width = 16, height = 8, sceneFormat = "rgba16float") {
  return {
    scene: {
      getView: () => ({}),
      getFormat: () => sceneFormat,
      getWidth: () => width,
      getHeight: () => height
    },
    depth: {
      depthConvention: CAMERA_REVERSE_Z,
      getDepthSampleView: () => ({}),
      getWidth: () => width,
      getHeight: () => height
    }
  };
}

// shaderはReverse-Z背景0を共通helperで判定し、最終passでだけ正確なsRGB表示変換を行います
{
  assert.equal(COMPUTE_EFFECT_TONEMAP_INPUT_FORMAT, "rgba16float");
  assert.equal(COMPUTE_EFFECT_TONEMAP_OUTPUT_FORMAT, "rgba8unorm");
  assert.match(COMPUTE_EFFECT_TONEMAP_WGSL, /texture_storage_2d<rgba8unorm, write>/);
  assert.match(COMPUTE_EFFECT_TONEMAP_WGSL, /isGBufferBackgroundDepth\(depth\)/);
  assert.doesNotMatch(COMPUTE_EFFECT_TONEMAP_WGSL, /depth\s*>=\s*0\.999999/);
  assert.match(COMPUTE_EFFECT_TONEMAP_WGSL, /scene \/ \(scene \+ vec3f\(1\.0\)\)/);
  assert.match(COMPUTE_EFFECT_TONEMAP_WGSL, /linearToSrgb\(mapped\)/);
  assert.match(COMPUTE_EFFECT_TONEMAP_WGSL, /2\.2 \/ params\.gamma/);
  assert.match(COMPUTE_EFFECT_TONEMAP_WGSL, /value <= 0\.0031308/);
  assert.doesNotMatch(COMPUTE_EFFECT_TONEMAP_WGSL, /max\(params\.gamma/);
}

// CPUとWGSLで共有するsRGB境界値を数値確認し、暗部を単純な1/2.2乗で持ち上げないことを固定します
{
  assert.ok(Math.abs(srgbChannelToLinear(0.04045) - 0.0031308049535603713) < 1.0e-12);
  assert.ok(Math.abs(linearChannelToSrgb(0.0031308) - 0.040449936) < 1.0e-12);
  for (const srgb of [0.0, 0.012, 0.018, 0.028, 0.10, 0.50, 1.0]) {
    const roundTrip = linearChannelToSrgb(srgbChannelToLinear(srgb));
    assert.ok(Math.abs(roundTrip - srgb) < 2.0e-7, `${srgb} sRGB round-trip`);
  }
  assert.throws(() => srgbChannelToLinear(-0.01), /must be >= 0/);
  assert.throws(() => linearChannelToSrgb(Number.NaN), /must be finite/);
}

// 出力は表示用rgba8unormに固定し、入力sceneはrgba16floatだけを受け付けます
{
  const probe = createGpuProbe();
  const pass = new ComputeEffectToneMapPass(probe.gpu, { width: 16, height: 8 });
  await pass.ready;
  assert.equal(pass.format, COMPUTE_EFFECT_TONEMAP_OUTPUT_FORMAT);
  assert.equal(pass.getOutputTarget().getFormat(), COMPUTE_EFFECT_TONEMAP_OUTPUT_FORMAT);
  assert.equal(probe.textures[0].format, COMPUTE_EFFECT_TONEMAP_OUTPUT_FORMAT);
  assert.equal(
    pass.computePass.bindings.find(({ name }) => name === "output").format,
    COMPUTE_EFFECT_TONEMAP_OUTPUT_FORMAT
  );

  const result = pass.encode(probe.commandEncoder, makeResources(), {
    exposure: 1.25,
    saturation: 1.1,
    gamma: 2.4,
    mode: "reinhard",
    blackBackground: true
  });
  assert.equal(result, pass.getOutputTarget());
  assert.deepEqual(probe.writes.at(-1).data.slice(0, 5), [1.25, 1.1, 2.4, 0, 1]
    .map((value) => Math.fround(value)));

  assert.throws(
    () => pass.encode(probe.commandEncoder, makeResources(16, 8, "rgba8unorm")),
    /scene format must be rgba16float/
  );
  assert.throws(
    () => pass.encode(probe.commandEncoder, {
      ...makeResources(),
      scene: { ...makeResources().scene, getFormat: undefined }
    }),
    /scene target requires getFormat\(\)/
  );
  assert.throws(
    () => pass.encode(probe.commandEncoder, {
      ...makeResources(),
      depth: { ...makeResources().depth, depthConvention: {} }
    }),
    /CAMERA_REVERSE_Z depth target/
  );
  assert.throws(
    () => pass.encode(probe.commandEncoder, makeResources(8, 8)),
    /scene size 8x8 does not match output size 16x8/
  );
  assert.throws(
    () => pass.encode(probe.commandEncoder, makeResources(), { blackBackground: 1 }),
    /blackBackground must be boolean/
  );
  pass.destroy();

  assert.throws(
    () => new ComputeEffectToneMapPass(probe.gpu, { format: "rgba16float" }),
    /format must be rgba8unorm/
  );
}

// resizeは不正値を自動的に1へ補正せず、呼び出し側の誤りとして報告します
{
  const probe = createGpuProbe();
  const pass = new ComputeEffectToneMapPass(probe.gpu);
  await pass.ready;
  assert.throws(() => pass.resize(0, 8), /width must be >= 1/);
  assert.throws(() => pass.resize(8.5, 8), /width must be an integer/);
  pass.destroy();
}

console.log("compute_effect_tone_map_pass_hdr_boundary_contracts: all final display conversion contracts passed");
