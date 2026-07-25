// ---------------------------------------------------------
// headless_tests/core/storage_target_factory/headless_probe.js  2026/06/14
//   headless contracts for StorageTargetFactory
// ---------------------------------------------------------
import assert from "node:assert/strict";
import StorageTargetFactory, {
  resizeTarget
} from "../../../webg/StorageTargetFactory.js";

globalThis.GPUTextureUsage = {
  STORAGE_BINDING: 1,
  TEXTURE_BINDING: 2,
  COPY_SRC: 4
};

// RenderTargetが要求する最小限のGPUDeviceを用意し、生成descriptorを記録する
// 実GPUを使わず、Factoryがformat、usage、寸法を正しく固定することを確認する
function createGpuProbe() {
  const descriptors = [];
  const device = {
    createSampler(descriptor) {
      return { descriptor };
    },
    createTexture(descriptor) {
      descriptors.push(descriptor);
      return {
        descriptor,
        createView() {
          return { label: `${descriptor.label}:view` };
        },
        destroy() {
          this.destroyed = true;
        }
      };
    }
  };
  return {
    gpu: {
      device,
      queue: {}
    },
    descriptors
  };
}

// 単一targetはStorage書き込み、後段sample、copy sourceに必要なusageを持つ
{
  const { gpu, descriptors } = createGpuProbe();
  const factory = new StorageTargetFactory(gpu, { label: "probe-storage" });
  const target = factory.create({
    label: "probe-output",
    width: 32,
    height: 24
  });
  await target.ready;
  assert.equal(target.getWidth(), 32);
  assert.equal(target.getHeight(), 24);
  assert.equal(target.getFormat(), "rgba8unorm");
  assert.equal(descriptors.length, 1);
  assert.equal(descriptors[0].label, "probe-output:color");
  assert.equal(
    descriptors[0].usage,
    GPUTextureUsage.STORAGE_BINDING |
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_SRC
  );
}

// Ping-pong生成は異なる2個のtargetを同じ条件で作り、共通readyを公開する
{
  const { gpu, descriptors } = createGpuProbe();
  const factory = new StorageTargetFactory(gpu, {
    label: "probe-pair",
    format: "rgba16float"
  });
  const pair = factory.createPingPong({
    label: "probe-history",
    width: 20,
    height: 12
  });
  await pair.ready;
  const [targetA, targetB] = pair.getResources();
  assert.notEqual(targetA, targetB);
  assert.equal(targetA.getFormat(), "rgba16float");
  assert.equal(targetB.getFormat(), "rgba16float");
  assert.deepEqual(
    descriptors.map((descriptor) => descriptor.label),
    ["probe-history:a:color", "probe-history:b:color"]
  );
  assert.equal(pair.ownsResources, true);
  const [ownedA, ownedB] = pair.getResources();
  assert.equal(pair.destroy(), true);
  assert.equal(ownedA.colorTexture, null);
  assert.equal(ownedB.colorTexture, null);
}

// resize helperは同一寸法で再生成せず、不正targetや小数寸法を例外にする
{
  const { gpu } = createGpuProbe();
  const factory = new StorageTargetFactory(gpu);
  const target = factory.create({ width: 8, height: 6 });
  await target.ready;
  assert.equal(resizeTarget(target, 8, 6), false);
  assert.equal(resizeTarget(target, 16, 12), true);
  assert.throws(() => resizeTarget({}, 1, 1), /RenderTarget-compatible/);
  assert.throws(() => resizeTarget(target, 1.5, 1), /width must be an integer/);
}

// WebGPU context不足はRenderTarget生成まで遅延させず、Factory生成時に例外にする
assert.throws(
  () => new StorageTargetFactory(null),
  /requires a WebGPU context/
);

console.log("PASS StorageTargetFactory headless contracts");
