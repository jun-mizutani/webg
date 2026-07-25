// ---------------------------------------------------------
// headless_tests/core/ping_pong_resources/headless_probe.js  2026/06/14
//   headless contracts for the three ping-pong resource types
// ---------------------------------------------------------
import assert from "node:assert/strict";
import PingPongBuffer from "../../../webg/PingPongBuffer.js";
import PingPongTarget from "../../../webg/PingPongTarget.js";
import PingPongTexture from "../../../webg/PingPongTexture.js";

// Buffer版は現在側と次側を0/1で明示し、swap後もresourceの対応を保ちます
// reset(index)はBuffer内容を変更せず、次に読む側だけを明示したindexへ戻します
{
  const buffer0 = { label: "buffer-0" };
  const buffer1 = { label: "buffer-1" };
  const pair = new PingPongBuffer([buffer0, buffer1], { label: "probe buffers" });
  assert.equal(pair.getCurrent(), buffer0);
  assert.equal(pair.getNext(), buffer1);
  assert.equal(pair.swap(), 1);
  assert.equal(pair.getCurrent(), buffer1);
  assert.equal(pair.reset(0), 0);
  assert.equal(pair.getCurrent(), buffer0);
  assert.equal(pair.reset(1), 1);
  assert.equal(pair.getCurrent(), buffer1);
  assert.deepEqual(pair.getResources(), [buffer0, buffer1]);
}

// Texture版も同じindex契約を持ちますが、Viewやresizeを所有しない別クラスとして検証します
{
  const texture0 = { label: "texture-0" };
  const texture1 = { label: "texture-1" };
  const pair = new PingPongTexture([texture0, texture1], {
    label: "probe textures",
    currentIndex: 1
  });
  assert.equal(pair.getCurrent(), texture1);
  assert.equal(pair.getNextIndex(), 0);
  assert.equal(pair.setCurrentIndex(0), 0);
  assert.equal(pair.getNext(), texture1);
  assert.equal(pair.reset(1), 1);
}

// RenderTarget版は交換に加えて、2個のtargetを同じ寸法へまとめてresizeします
{
  const makeTarget = (label, width, height) => ({
    label,
    width,
    height,
    ready: Promise.resolve(),
    getWidth() {
      return this.width;
    },
    getHeight() {
      return this.height;
    },
    getView() {
      return `${this.label}:view`;
    },
    resize(nextWidth, nextHeight) {
      this.width = nextWidth;
      this.height = nextHeight;
    },
    destroy() {
      this.destroyed = true;
    }
  });
  const target0 = makeTarget("target-0", 16, 8);
  const target1 = makeTarget("target-1", 16, 8);
  const pair = new PingPongTarget([target0, target1], { label: "probe targets" });
  await pair.ready;
  assert.equal(pair.getCurrent(), target0);
  assert.equal(pair.getNext(), target1);
  assert.equal(pair.resize(16, 8), false);
  assert.equal(pair.resize(32, 24), true);
  assert.equal(target0.getWidth(), 32);
  assert.equal(target1.getHeight(), 24);
  assert.equal(pair.swap(), 1);
  assert.equal(pair.getCurrent(), target1);
  assert.equal(pair.reset(0), 0);
  assert.equal(pair.ownsResources, false);
  assert.equal(pair.destroy(), true);
  assert.equal(target0.destroyed, undefined);
  assert.equal(pair.destroy(), false);
  assert.throws(() => pair.getCurrent(), /is destroyed/);
  assert.throws(() => pair.reset(), /is destroyed/);
}

// ownershipを明示したPingPongTargetだけが内部targetを破棄します
{
  const makeTarget = () => ({
    ready: Promise.resolve(),
    getWidth: () => 1,
    getHeight: () => 1,
    getView: () => ({}),
    resize() {},
    destroy() {
      this.destroyed = true;
    }
  });
  const target0 = makeTarget();
  const target1 = makeTarget();
  const pair = new PingPongTarget([target0, target1], {
    label: "owned targets",
    ownsResources: true
  });
  pair.destroy();
  assert.equal(target0.destroyed, true);
  assert.equal(target1.destroyed, true);
}

// resource数、同一resource、index、label、Target互換性の異常を補正せず例外にします
{
  const resource = {};
  assert.throws(() => new PingPongBuffer([resource]), /exactly two/);
  assert.throws(() => new PingPongBuffer([resource, resource]), /distinct/);
  assert.throws(
    () => new PingPongBuffer([{}, {}], { label: " " }),
    /must not be empty/
  );
  assert.throws(
    () => new PingPongTexture([{}, {}], { currentIndex: 2 }),
    /index must be 0 or 1/
  );
  assert.throws(
    () => new PingPongTarget([{}, {}]),
    /RenderTarget-compatible/
  );
  assert.throws(
    () => new PingPongTarget([
      {
        ready: Promise.resolve(),
        getWidth: () => 1,
        getHeight: () => 1,
        getView: () => ({}),
        resize() {}
      },
      {
        ready: Promise.resolve(),
        getWidth: () => 1,
        getHeight: () => 1,
        getView: () => ({}),
        resize() {}
      }
    ]),
    /RenderTarget-compatible/
  );
}

console.log("PASS ping-pong resource contracts");
