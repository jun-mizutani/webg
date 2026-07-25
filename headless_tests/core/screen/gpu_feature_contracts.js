// ---------------------------------------------------------
// headless_tests/core/screen/headless_probe.js  2026/06/13
//   headless contracts for Screen GPU feature options
// ---------------------------------------------------------
import assert from "node:assert/strict";
import Screen from "../../../webg/Screen.js";
import WebgApp from "../../../webg/WebgApp.js";

globalThis.GPUTextureUsage = {
  RENDER_ATTACHMENT: 1
};

// Screenが初期化時に必要とするcanvasとWebGPU contextの最小probeを作る
// 各testで新しいcanvasを返し、configureやdepth textureの状態を共有しない
function createDocumentProbe() {
  const canvasContext = {
    configure(descriptor) {
      this.descriptor = descriptor;
    }
  };
  const canvas = {
    width: 64,
    height: 48,
    clientWidth: 64,
    clientHeight: 48,
    style: {},
    getContext(name) {
      assert.equal(name, "webgpu");
      return canvasContext;
    }
  };
  return {
    document: {
      getElementById(id) {
        return id === "canvas" ? canvas : null;
      }
    },
    canvas,
    canvasContext
  };
}

// adapter featureとrequestDevice呼び出しを記録するnavigator.gpu probeを設定する
// device.featuresには実際にrequestされたfeatureだけを入れ、Screenの確認APIにも利用する
function installGpuProbe(adapterFeatures) {
  const requestDeviceCalls = [];
  const adapter = {
    features: new Set(adapterFeatures),
    async requestDevice(...args) {
      requestDeviceCalls.push(args);
      const requested = args[0]?.requiredFeatures ?? [];
      return {
        queue: {},
        features: new Set(requested),
        createTexture(descriptor) {
          return {
            descriptor,
            createView() {
              return { label: "depth-view" };
            },
            destroy() {
            }
          };
        }
      };
    }
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      gpu: {
        async requestAdapter() {
          return adapter;
        },
        getPreferredCanvasFormat() {
          return "bgra8unorm";
        }
      }
    }
  });
  return { adapter, requestDeviceCalls };
}

// feature未指定時は既存コードと同じくrequestDevice()を引数なしで呼ぶ
{
  const { document } = createDocumentProbe();
  const { requestDeviceCalls } = installGpuProbe(["timestamp-query"]);
  const screen = new Screen(document);
  await screen.ready;
  assert.equal(requestDeviceCalls.length, 1);
  assert.equal(requestDeviceCalls[0].length, 0);
  assert.deepEqual(screen.getRequestedGPUFeatures(), []);
  assert.deepEqual(screen.getUnavailableOptionalGPUFeatures(), []);
}

// requiredと対応済みoptionalだけを重複なしでrequestDeviceへ渡す
{
  const { document } = createDocumentProbe();
  const { requestDeviceCalls } = installGpuProbe([
    "required-feature",
    "timestamp-query"
  ]);
  const screen = new Screen(document, {
    gpu: {
      requiredFeatures: ["required-feature", "required-feature"],
      optionalFeatures: [
        "timestamp-query",
        "unsupported-feature",
        "timestamp-query"
      ]
    }
  });
  await screen.ready;
  assert.deepEqual(requestDeviceCalls, [[{
    requiredFeatures: ["required-feature", "timestamp-query"]
  }]]);
  assert.deepEqual(screen.getRequestedGPUFeatures(), [
    "required-feature",
    "timestamp-query"
  ]);
  assert.deepEqual(screen.getUnavailableOptionalGPUFeatures(), [
    "unsupported-feature"
  ]);
  assert.equal(screen.hasGPUFeature("timestamp-query"), true);
  assert.equal(screen.hasGPUFeature("unsupported-feature"), false);
}

// required feature未対応時は通常deviceへ切り替えず、requestDevice前に例外にする
{
  const { document } = createDocumentProbe();
  const { requestDeviceCalls } = installGpuProbe([]);
  const screen = new Screen(document, {
    gpu: {
      requiredFeatures: ["required-feature"]
    }
  });
  await assert.rejects(
    screen.ready,
    /Required GPU feature is not supported: required-feature/
  );
  assert.equal(requestDeviceCalls.length, 0);
}

// feature optionの型違いと空文字は有効値へ読み替えずconstructorで例外にする
{
  const { document } = createDocumentProbe();
  installGpuProbe([]);
  assert.throws(
    () => new Screen(document, {
      gpu: "timestamp-query"
    }),
    /gpu option must be an object/
  );
  assert.throws(
    () => new Screen(document, {
      gpu: {
        optionalFeatures: "timestamp-query"
      }
    }),
    /optionalFeatures must be an array/
  );
  assert.throws(
    () => new Screen(document, {
      gpu: {
        requiredFeatures: [""]
      }
    }),
    /requiredFeatures\[0\] must be a non-empty string/
  );
}

// computeFrameを有効にしたWebgAppは利用側featureを維持し、timestamp-queryをoptionalへ追加する
{
  const app = new WebgApp({
    document: {},
    computeFrame: true,
    gpu: {
      requiredFeatures: ["required-feature"],
      optionalFeatures: ["optional-feature"]
    }
  });
  assert.deepEqual(app.gpuOptions, {
    requiredFeatures: ["required-feature"],
    optionalFeatures: ["optional-feature", "timestamp-query"]
  });
}

console.log("PASS Screen GPU feature contracts");
