// ---------------------------------------------------------
// headless_tests/core/compute_toon_pass/headless_probe.js  2026/07/12
//   Linear High Dynamic Range toon quantization contract
// ---------------------------------------------------------
import assert from "node:assert/strict";
import ComputeToonPass, {
  COMPUTE_TOON_FORMAT,
  COMPUTE_TOON_WGSL
} from "../../../webg/ComputeToonPass.js";

globalThis.GPUTextureUsage = { STORAGE_BINDING: 1, TEXTURE_BINDING: 2, COPY_SRC: 4 };
globalThis.GPUShaderStage = { COMPUTE: 1 };
globalThis.GPUBufferUsage = { UNIFORM: 1, COPY_DST: 2 };

// Toon passが作るtextureとuniform writeを記録します
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
        setPipeline() {}, setBindGroup() {}, dispatchWorkgroups() {}, end() {}
      };
    }
  };
  return { gpu: { device, queue }, commandEncoder, textures, writes };
}

function makeScene(width = 16, height = 8, format = COMPUTE_TOON_FORMAT) {
  return {
    getView: () => ({}),
    getFormat: () => format,
    getWidth: () => width,
    getHeight: () => height
  };
}

// WGSLと同じexposure interval量子化をJavaScript倍精度で再現します
function quantizeIntensity(intensity, levels, gamma) {
  if (intensity <= 0) return 0;
  const exposureBase = 2 ** Math.floor(Math.log2(intensity));
  const intervalPosition = intensity / exposureBase - 1;
  const encoded = intervalPosition ** gamma;
  const band = Math.floor(encoded * levels + 0.5) / levels;
  return exposureBase * (1 + band ** (1 / gamma));
}

// 2倍ごとのintervalを段階化するため、1.0を超える入力も0から1へ潰れません
{
  assert.equal(quantizeIntensity(0, 4, 1), 0);
  assert.equal(quantizeIntensity(0.75, 4, 1), 0.75);
  assert.equal(quantizeIntensity(3.0, 4, 1), 3.0);
  assert.equal(quantizeIntensity(5.1, 4, 1), 5.0);
  assert.equal(quantizeIntensity(7.8, 4, 1), 8.0);
}

// shaderはHDR targetへ書き、0から1 clampとshader内parameter fallbackを持ちません
{
  assert.equal(COMPUTE_TOON_FORMAT, "rgba16float");
  assert.match(COMPUTE_TOON_WGSL, /texture_storage_2d<rgba16float, write>/);
  assert.match(COMPUTE_TOON_WGSL, /exposureBase = exp2\(floor\(log2\(intensity\)\)\)/);
  assert.match(COMPUTE_TOON_WGSL, /return exposureBase \* \(1\.0 \+ decoded\)/);
  assert.doesNotMatch(COMPUTE_TOON_WGSL, /clamp\(intensity, 0\.0, 1\.0\)/);
  assert.doesNotMatch(COMPUTE_TOON_WGSL, /clamp\(source\.rgb/);
  assert.doesNotMatch(COMPUTE_TOON_WGSL, /safeGamma/);
  assert.doesNotMatch(COMPUTE_TOON_WGSL, /max\(round\(params\.values\.x\)/);
}

// sceneとoutputは同じHDR形式を共有し、検証済みparameterをuniformへそのまま渡します
{
  const probe = createGpuProbe();
  const pass = new ComputeToonPass(probe.gpu, { width: 16, height: 8 });
  await pass.ready;
  assert.equal(pass.format, COMPUTE_TOON_FORMAT);
  assert.equal(pass.getOutputTarget().getFormat(), COMPUTE_TOON_FORMAT);
  assert.equal(probe.textures[0].format, COMPUTE_TOON_FORMAT);
  const output = pass.encode(probe.commandEncoder, makeScene(), {
    levels: 6,
    strength: 0.75,
    gamma: 1.4,
    floor: 0.2,
    enabled: true
  });
  assert.equal(output.getFormat(), COMPUTE_TOON_FORMAT);
  assert.deepEqual(
    probe.writes.at(-1).data.slice(0, 5),
    [6, 0.75, 1.4, 1, 0.2].map((value) => Math.fround(value))
  );
  assert.throws(
    () => pass.encode(probe.commandEncoder, makeScene(16, 8, "rgba8unorm")),
    /scene format must be rgba16float/
  );
  assert.throws(
    () => pass.encode(probe.commandEncoder, makeScene(), { gamma: 0 }),
    /gamma must be > 0/
  );
  pass.destroy();

  assert.throws(
    () => new ComputeToonPass(probe.gpu, { format: "rgba8unorm" }),
    /format must be rgba16float/
  );
}

console.log("compute_toon_pass_hdr_quantization_contracts: all HDR band contracts passed");
