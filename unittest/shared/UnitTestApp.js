// ---------------------------------------------
// unittest/shared/UnitTestApp.js  2026/07/25
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import Screen from "../../webg/Screen.js";

// UnitTestApp:
// - unittest 向けに Screen 初期化、viewport 追従、status 表示、例外表示を薄く共通化する
// - WebgApp のように Scene / Camera / Input まで抱え込まず、低レベル API の確認が見えたまま残る薄さを保つ
// - 各 unittest は「何を描くか」に集中し、起動 boilerplate の重複を減らす

const getViewportSize = (win) => {
  return {
    width: Math.max(1, Math.floor(win.innerWidth)),
    height: Math.max(1, Math.floor(win.innerHeight))
  };
};

// 状態表示の`writer`を生成し、後続処理で利用できる状態にする
const createStatusWriter = (doc, elementId) => {
  const statusEl = elementId ? doc.getElementById(elementId) : null;
  const setStatus = (message) => {
    if (statusEl) statusEl.textContent = message;
  };
  return { statusEl, setStatus };
};

// エラーのメッセージを現在の入力と状態から求め、呼び出し元へ返す
const formatErrorMessage = (value) => {
  if (value?.error?.message) return value.error.message;
  if (value?.reason?.message) return value.reason.message;
  if (value?.message) return value.message;
  return String(value);
};

// `unit`の`test`のアプリケーションを生成し、後続処理で利用できる状態にする
export const createUnitTestApp = async (options = {}) => {
  const doc = options.document ?? document;
  const win = options.window ?? window;
  const { statusEl, setStatus } = createStatusWriter(doc, options.statusElementId ?? "status");

  if (typeof options.initialStatus === "string") {
    setStatus(options.initialStatus);
  }

  const screen = new Screen(doc);
  await screen.ready;
  const gpu = screen.getGPU();

  if (Array.isArray(options.clearColor)) {
    screen.setClearColor(options.clearColor);
  }

  let viewportCallback = typeof options.onResize === "function" ? options.onResize : null;

  // `viewport`の配置を対象の状態または描画設定へ反映する
  const applyViewportLayout = () => {
    const size = getViewportSize(win);
    screen.resize(size.width, size.height);
    if (viewportCallback) {
      viewportCallback({ screen, gpu, width: size.width, height: size.height });
    }
  };

  applyViewportLayout();

  if (options.attachViewportHandlers !== false) {
    win.addEventListener("resize", applyViewportLayout);
    win.addEventListener("orientationchange", applyViewportLayout);
  }

  if (options.captureGpuErrors !== false && gpu?.device) {
    gpu.device.addEventListener("uncapturederror", (event) => {
      const msg = event?.error?.message ?? "unknown GPU error";
      setStatus(`gpu error:\n${msg}`);
      console.error("uncaptured GPU error:", event.error);
    });
  }

  // `loop`の初期化段階で、必要な状態と資源を準備して処理を開始する
  const startLoop = (drawFrame) => {
    // `frame`は処理周期の開始または終了に必要な状態を更新する
    const frame = (timeMs) => {
      drawFrame(timeMs);
      win.requestAnimationFrame(frame);
    };
    win.requestAnimationFrame(frame);
  };

  return {
    document: doc,
    window: win,
    screen,
    gpu,
    statusEl,
    setStatus,
    applyViewportLayout,
    setViewportLayout: (callback) => {
      viewportCallback = typeof callback === "function" ? callback : null;
      applyViewportLayout();
    },
    startLoop
  };
};

// `unit`の`test`のアプリケーションの初期化段階で、必要な状態と資源を準備して処理を開始する
export const bootUnitTestApp = (options, start) => {
  const doc = options?.document ?? document;
  const win = options?.window ?? window;

  doc.addEventListener("DOMContentLoaded", () => {
    const { setStatus } = createStatusWriter(doc, options?.statusElementId ?? "status");

    // エラーを受け取った段階で、対応する状態更新と処理を実行する
    const onError = (event) => {
      const msg = formatErrorMessage(event);
      setStatus(`error:\n${msg}`);
    };

    win.addEventListener("error", onError);
    win.addEventListener("unhandledrejection", onError);

    createUnitTestApp(options)
      .then((app) => start(app))
      .catch((err) => {
        setStatus(`start failed:\n${err?.message ?? err}`);
        console.error(err);
      });
  });
};
