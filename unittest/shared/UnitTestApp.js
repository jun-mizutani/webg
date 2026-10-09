// ---------------------------------------------
// unittest/shared/UnitTestApp.js  2026/10/04
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import Screen from "../../webg/Screen.js";

// UnitTestApp:
// - unittest 向けに Screen 初期化、viewport 追従、status 表示、例外表示を薄く共通化する
// - Scene / Camera / Input は各ページで準備し、低レベルAPIを直接確認できる構成を保つ
// - 各 unittest は「何を描くか」に集中し、起動 boilerplate の重複を減らす

const getViewportSize = (win) => {
  return {
    width: Math.max(1, Math.floor(win.innerWidth)),
    height: Math.max(1, Math.floor(win.innerHeight))
  };
};

// 結果表示のDOM要素と、その本文を更新する関数をまとめて用意する
const createStatusWriter = (doc, elementId) => {
  const statusEl = elementId ? doc.getElementById(elementId) : null;
  // 現在の検証状態を結果表示のDOM要素へ書き込む
  const setStatus = (message) => {
    if (statusEl) statusEl.textContent = message;
  };
  return { statusEl, setStatus };
};

// 通常の例外・イベント・Promise rejectionから表示用のエラーメッセージを取り出す
const formatErrorMessage = (value) => {
  if (value?.error?.message) return value.error.message;
  if (value?.reason?.message) return value.reason.message;
  if (value?.message) return value.message;
  return String(value);
};

// ScreenとGPUを初期化し、viewport追従・状態表示・描画ループの共通窓口を返す
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

  // viewportの寸法をScreenへ反映し、その縦横比で投影と画面配置を更新する
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

  // フレームごとの描画関数をrequestAnimationFrameへ接続し、連続表示を開始する
  const startLoop = (drawFrame) => {
    // 時刻を描画関数へ渡し、そのフレームの処理後に次の描画を予約する
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
    // ページ固有の投影・配置処理を登録し、現在のviewportにも直ちに適用する
    setViewportLayout: (callback) => {
      viewportCallback = typeof callback === "function" ? callback : null;
      applyViewportLayout();
    },
    startLoop
  };
};

// DOMの準備後に共通初期化とページ固有処理を実行し、例外を結果欄へ表示する
export const bootUnitTestApp = (options, start) => {
  const doc = options?.document ?? document;
  const win = options?.window ?? window;

  doc.addEventListener("DOMContentLoaded", () => {
    const { setStatus } = createStatusWriter(doc, options?.statusElementId ?? "status");

    // ブラウザの例外とPromise rejectionを受け取り、検証画面に原因を表示する
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
