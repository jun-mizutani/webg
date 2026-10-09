// ---------------------------------------------------------
// headless_tests/core/pbr_environment_cache/cache_contracts.js  2026/08/04
//   Versioned cache, async load, reuse, and release contracts
// ---------------------------------------------------------
import assert from "node:assert/strict";
import {
  decodePbrEnvironmentCache,
  encodePbrEnvironmentCache,
  loadPbrEnvironmentCache,
  PBR_ENVIRONMENT_CACHE_FORMAT,
  PBR_ENVIRONMENT_CACHE_VERSION,
  PbrEnvironmentCacheRepository
} from "../../../webg/PbrEnvironmentCache.js";
import { LINEAR_SRGB_PRIMARIES } from "../../../webg/RadianceHdr.js";

globalThis.GPUTextureUsage = { TEXTURE_BINDING: 1, COPY_DST: 2 };

const settings = Object.freeze({
  irradianceWidth: 4,
  irradianceHeight: 2,
  specularWidth: 4,
  specularHeight: 2,
  specularMipCount: 3,
  brdfLutWidth: 4,
  brdfLutHeight: 4,
  diffuseSampleCount: 16,
  specularSampleCount: 16,
  brdfSampleCount: 16
});

// RGBへ方向差、alphaへ1を持つlinear sRGB変換済み2:1 Radiance結果を作ります
function makeSource() {
  const width = 4;
  const height = 2;
  const data = new Float32Array(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    data[pixel * 4] = 0.25 + pixel * 0.125;
    data[pixel * 4 + 1] = 1.0 + pixel * 0.25;
    data[pixel * 4 + 2] = 2.0 + pixel * 0.5;
    data[pixel * 4 + 3] = 1.0;
  }
  return {
    width,
    height,
    data,
    sourceFormat: "32-bit_rle_rgbe",
    colorSpace: "linear-srgb",
    orientation: "-Y +X",
    pixelAspect: 1.0,
    primaries: [...LINEAR_SRGB_PRIMARIES]
  };
}

function makeLevel(width, height, channels, offset) {
  const data = new Float32Array(width * height * channels);
  for (let index = 0; index < data.length; index += 1) {
    data[index] = offset + (index % channels) * 0.125;
  }
  return { width, height, data };
}

// Compute readbackと同じ構造で全生成条件を持つ前処理結果を作ります
function makePreprocessed() {
  return {
    irradiance: makeLevel(4, 2, 4, 1.0),
    prefilteredSpecular: [
      makeLevel(4, 2, 4, 2.0),
      makeLevel(2, 1, 4, 1.5),
      makeLevel(1, 1, 4, 1.0)
    ],
    brdfLut: makeLevel(4, 4, 2, 0.25),
    settings: { ...settings }
  };
}

// repositoryが生成したtextureと二重破棄を記録する最小WebGPU contextを作ります
function createGpuProbe() {
  const textures = [];
  const device = {
    createTexture(descriptor) {
      const texture = {
        descriptor,
        destroyed: false,
        createView: () => ({ descriptor }),
        destroy() { this.destroyed = true; }
      };
      textures.push(texture);
      return texture;
    },
    createSampler: (descriptor) => ({ descriptor })
  };
  const queue = { writeTexture() {} };
  return { gpu: { device, queue }, textures };
}

const source = makeSource();
const preprocessed = makePreprocessed();
const encoded = encodePbrEnvironmentCache({
  sourceId: "diagnostic-rgbe-v1",
  source,
  preprocessed
});

// 同じsourceと生成条件は同じbinaryとなり、metadataと全mipをhalf-float精度で復元します
{
  const second = encodePbrEnvironmentCache({
    sourceId: "diagnostic-rgbe-v1",
    source,
    preprocessed
  });
  assert.deepEqual(new Uint8Array(second), new Uint8Array(encoded));
  const decoded = decodePbrEnvironmentCache(encoded, {
    expectedSourceId: "diagnostic-rgbe-v1",
    expectedSettings: settings
  });
  assert.equal(decoded.metadata.format, PBR_ENVIRONMENT_CACHE_FORMAT);
  assert.equal(decoded.metadata.version, PBR_ENVIRONMENT_CACHE_VERSION);
  assert.equal(decoded.metadata.generator, "webg-split-sum-ggx-environment-mis-linear-srgb-v3");
  assert.equal(decoded.metadata.encoding, "float16-le");
  assert.deepEqual(decoded.metadata.preprocess, settings);
  assert.deepEqual(
    decoded.environment.prefilteredSpecular.map((level) => [level.width, level.height]),
    [[4, 2], [2, 1], [1, 1]]
  );
  assert.equal(decoded.environment.radiance.data[0], 0.25);
  assert.equal(decoded.environment.irradiance.data[0], 1.0);
  assert.equal(decoded.environment.brdfLut.data[0], 0.25);
}

// source ID、生成条件、magic、版、payload長の不一致をcache missとして黙って受理しません
{
  assert.throws(
    () => decodePbrEnvironmentCache(encoded, { expectedSourceId: "other-source" }),
    /source ID diagnostic-rgbe-v1 does not match other-source/
  );
  assert.throws(
    () => decodePbrEnvironmentCache(encoded, {
      expectedSettings: { ...settings, diffuseSampleCount: 32 }
    }),
    /preprocess\.diffuseSampleCount 16 does not match 32/
  );
  const badMagic = encoded.slice(0);
  new Uint8Array(badMagic)[0] = 0;
  assert.throws(() => decodePbrEnvironmentCache(badMagic), /magic does not match/);
  const badVersion = encoded.slice(0);
  new DataView(badVersion).setUint32(8, 2, true);
  assert.throws(() => decodePbrEnvironmentCache(badVersion), /version 2 is not supported/);
  assert.throws(
    () => decodePbrEnvironmentCache(encoded.slice(0, encoded.byteLength - 2)),
    /payload is truncated/
  );
  const trailing = new Uint8Array(encoded.byteLength + 1);
  trailing.set(new Uint8Array(encoded));
  assert.throws(() => decodePbrEnvironmentCache(trailing), /trailing payload bytes/);
}

// HTTP loaderはstatusを検査し、取得したArrayBufferへ期待sourceと生成条件を適用します
{
  const urls = [];
  const decoded = await loadPbrEnvironmentCache("/environment.cache", {
    fetch: async (url) => {
      urls.push(url);
      return { ok: true, status: 200, arrayBuffer: async () => encoded };
    },
    expectedSourceId: "diagnostic-rgbe-v1",
    expectedSettings: settings
  });
  assert.deepEqual(urls, ["/environment.cache"]);
  assert.equal(decoded.metadata.source.id, "diagnostic-rgbe-v1");
  await assert.rejects(
    () => loadPbrEnvironmentCache("/missing.cache", {
      fetch: async () => ({ ok: false, status: 404, arrayBuffer: async () => encoded })
    }),
    /status 404/
  );
}

// 同じkeyのacquireは一度だけloadし、最後のrelease後も明示evictまでは再利用します
{
  const probe = createGpuProbe();
  let loadCount = 0;
  const repository = new PbrEnvironmentCacheRepository(probe.gpu, {
    label: "cache-repository-probe",
    loader: async (_url, options) => {
      loadCount += 1;
      return decodePbrEnvironmentCache(encoded, options);
    }
  });
  const first = await repository.acquire("studio", "/studio.cache", {
    expectedSourceId: "diagnostic-rgbe-v1",
    expectedSettings: settings
  });
  const second = await repository.acquire("studio", "/studio.cache", {
    expectedSourceId: "diagnostic-rgbe-v1",
    expectedSettings: settings
  });
  assert.equal(loadCount, 1);
  assert.equal(first.environment, second.environment);
  assert.equal(first.getResources().specularMipCount, 3);
  await assert.rejects(() => repository.evict("studio"), /2 active reference/);
  await assert.rejects(
    () => repository.acquire("studio", "/different.cache", {
      expectedSourceId: "diagnostic-rgbe-v1",
      expectedSettings: settings
    }),
    /already bound to different input/
  );
  assert.equal(first.release(), true);
  assert.equal(first.release(), false);
  assert.equal(second.release(), true);
  const third = await repository.acquire("studio", "/studio.cache", {
    expectedSourceId: "diagnostic-rgbe-v1",
    expectedSettings: settings
  });
  assert.equal(loadCount, 1);
  assert.equal(third.environment, second.environment);
  assert.equal(third.release(), true);
  assert.equal(await repository.evict("studio"), true);
  assert.ok(probe.textures.every((texture) => texture.destroyed));
  assert.equal(await repository.evict("studio"), false);
  assert.equal(await repository.destroy(), true);
  assert.equal(await repository.destroy(), false);
  await assert.rejects(
    () => repository.acquire("studio", "/studio.cache"),
    /is not available/
  );
}

console.log("pbr_environment_cache_contracts: binary cache and reuse contracts passed");
