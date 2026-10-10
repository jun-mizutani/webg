// ---------------------------------------------------------
// headless_tests/core/webg_app/screenshot_contracts.js  2026/10/10
//   headless contracts for WebgApp and Screen screenshots
// ---------------------------------------------------------
import assert from "node:assert/strict";
import WebgApp from "../../../webg/WebgApp.js";
import Screen from "../../../webg/Screen.js";

// WebgAppのGPU初期化を使わず、撮影APIと一時layoutの契約を検査するappを作る
function createScreenshotApp() {
  const app = new WebgApp({
    document: {},
    useMessage: false,
    attachInputOnInit: false
  });
  app.screen = {
    fitToViewport: true,
    useDevicePixelRatio: true,
    captureRequested: false,
    screenShot(filename, options) {
      this.captureRequested = true;
      this.filename = filename;
      this.options = options;
      this.argumentCount = arguments.length;
    },
    cancelScreenshot() {
      this.captureRequested = false;
      this.cancelCount = (this.cancelCount ?? 0) + 1;
    }
  };
  app.layouts = [];
  app.applyViewportLayout = () => {
    const size = app.screenshotCanvasSize ?? app.fixedCanvasSize;
    app.layouts.push(size ? { width: size.width, height: size.height } : null);
  };
  app.running = true;
  app.renderRequests = 0;
  app.requestRender = () => {
    app.renderRequests += 1;
    return true;
  };
  return app;
}

// 寸法指定は正の有限値をpixel単位で受け取り、片方だけの指定を検出する
{
  const app = createScreenshotApp();
  assert.throws(
    () => app.takeScreenshot({ prefix: "bad", width: 720 }),
    /width and height must be specified together/
  );
  assert.throws(
    () => app.takeScreenshot({ prefix: "bad", width: 0, height: 540 }),
    /width must be a positive finite number/
  );
  assert.throws(
    () => app.takeScreenshot({ prefix: "bad", width: 0.5, height: 540 }),
    /at least one pixel/
  );
  assert.deepEqual(app.layouts, []);
  assert.equal(app.screen.captureRequested, false);
}

// 指定pixel寸法で撮影を予約し、画像bitmapの取得後に元のcanvas layoutを戻す
{
  const app = createScreenshotApp();
  const filename = app.takeScreenshot({
    prefix: "sample",
    timestamp: false,
    width: 720,
    height: 540
  });
  assert.equal(filename, "sample.png");
  assert.deepEqual(app.layouts, [{ width: 720, height: 540 }]);
  assert.equal(app.screen.fitToViewport, false);
  assert.equal(app.screen.useDevicePixelRatio, false);
  assert.equal(app.screen.filename, filename);
  assert.equal(app.renderRequests, 1);
  assert.throws(
    () => app.takeScreenshot({ prefix: "second", width: 960, height: 720 }),
    /only one screenshot at a time/
  );

  app.screen.captureRequested = false;
  app.screen.options.onSnapshot();
  assert.deepEqual(app.layouts, [{ width: 720, height: 540 }, null]);
  assert.equal(app.screen.fitToViewport, true);
  assert.equal(app.screen.useDevicePixelRatio, true);
  assert.equal(app.screenshotCanvasSize, null);
  assert.equal(app.renderRequests, 2);
}

// 寸法省略時は既存のcanvas保存経路を使い、Screenへfilenameだけを渡す
{
  const app = createScreenshotApp();
  const filename = app.takeScreenshot({ prefix: "regular", timestamp: false });
  assert.equal(filename, "regular.png");
  assert.equal(app.screen.argumentCount, 1);
  assert.deepEqual(app.layouts, []);
  assert.equal(app.renderRequests, 0);
}

// stop()は撮影待ちを解除してから元のlayoutとpixel ratioへ戻す
{
  const app = createScreenshotApp();
  app.screen.fitToViewport = false;
  app.screen.useDevicePixelRatio = false;
  app.takeScreenshot({ prefix: "stopped", width: 960, height: 720 });
  app.stop();
  assert.equal(app.screen.captureRequested, false);
  assert.equal(app.screen.cancelCount, 1);
  assert.equal(app.screen.fitToViewport, false);
  assert.equal(app.screen.useDevicePixelRatio, false);
  assert.equal(app.screenshotCanvasRestoreState, null);
}

// Screenはcanvas画像取得の開始後に一度だけsnapshot callbackを呼び出す
{
  const events = [];
  let blobCallback = null;
  const previousDocument = globalThis.document;
  const previousURL = globalThis.URL;
  globalThis.document = {
    createElement(name) {
      assert.equal(name, "a");
      return {
        click() {
          events.push("download");
        }
      };
    }
  };
  globalThis.URL = {
    createObjectURL(blob) {
      assert.equal(blob, "image-blob");
      return "blob:sample";
    },
    revokeObjectURL(url) {
      assert.equal(url, "blob:sample");
      events.push("revoke");
    }
  };
  try {
    const screen = Object.create(Screen.prototype);
    screen.gpu = { submit: () => events.push("submit") };
    screen.canvas = {
      toBlob(callback, mimeType) {
        assert.equal(mimeType, "image/png");
        events.push("toBlob");
        blobCallback = callback;
      }
    };
    screen.captureRequested = true;
    screen.captureFilename = "sample.png";
    screen.captureOnSnapshot = () => events.push("snapshot");
    screen.present();
    assert.deepEqual(events, ["submit", "toBlob", "snapshot"]);
    assert.equal(screen.captureRequested, false);
    blobCallback("image-blob");
    assert.deepEqual(events, ["submit", "toBlob", "snapshot", "download", "revoke"]);
  } finally {
    globalThis.document = previousDocument;
    globalThis.URL = previousURL;
  }
}

console.log("PASS WebgApp screenshot headless contracts");
