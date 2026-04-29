// ---------------------------------------------
// Screen.js       2026/04/29
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import RenderTarget from "./RenderTarget.js";

const readPositiveCanvasDimension = (canvas, primaryKey, secondaryKey, label) => {
  const primary = Number(canvas?.[primaryKey]);
  if (Number.isFinite(primary) && primary > 0) {
    return Math.floor(primary);
  }
  const secondary = Number(canvas?.[secondaryKey]);
  if (Number.isFinite(secondary) && secondary > 0) {
    return Math.floor(secondary);
  }
  throw new Error(`Screen ${label} must be a positive finite number`);
};

class WebGPUContext {
  // `#canvas` を取得し、WebGPUコンテキスト準備を開始する
  constructor(canvas) {
    // WebGPUの生コンテキスト層:
    // device/queue/context/passEncoder など、GPU実行に必要な実体を保持する
    this.canvas = canvas;
    this.device = null;
    this.queue = null;
    this.context = null;
    this.format = null;
    this.depthTexture = null;
    this.depthView = null;
    this.commandEncoder = null;
    this.passEncoder = null;
    this.currentView = null;
    this.ready = this.init();
  }

  async init() {
    // ブラウザのWebGPU実装から adapter/device を取得し、canvasへ接続する
    if (!navigator.gpu) {
      throw new Error("WebGPU is not supported in this browser.");
    }
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error("Failed to get GPU adapter.");
    }
    this.device = await adapter.requestDevice();
    this.queue = this.device.queue;
    this.context = this.canvas.getContext("webgpu");
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: "opaque"
      // スクリーンショットのために特別なUsageフラグは通常不要のはずだが、
      // 読み取りに問題がある場合は以下を追加することを検討する:
      // usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
    });
    this.resize();
  }

  // キャンバスサイズと深度テクスチャを更新する
  resize() {
    // 画面サイズ変更時は深度テクスチャを作り直し、深度バッファサイズを合わせる
    const width = readPositiveCanvasDimension(this.canvas, "width", "clientWidth", "canvas width");
    const height = readPositiveCanvasDimension(this.canvas, "height", "clientHeight", "canvas height");

    if (this.depthTexture) {
      this.depthTexture.destroy();
    }
    this.depthTexture = this.device.createTexture({
      size: [width, height, 1],
      format: "depth24plus",
      usage: GPUTextureUsage.RENDER_ATTACHMENT
    });
    this.depthView = this.depthTexture.createView();
  }

  beginPass({
    clearColor,
    colorLoadOp = "clear",
    depthClear = true,
    target = null,
    colorView = null,
    depthView = undefined
  } = {}) {
    // 1フレーム(または再開パス)のRenderPassを開始する
    if (this.passEncoder) {
      this.passEncoder.end();
      this.passEncoder = null;
    }
    this.uniformIndex = 0;
    if (!this.commandEncoder) {
      // Start one command encoder per frame (or per clearDepthBuffer restart).
      this.commandEncoder = this.device.createCommandEncoder();
    }
    const resolvedColorView = colorView;
    const useSwapChain = !resolvedColorView;

    if (useSwapChain && (!this.currentView || colorLoadOp === "clear")) {
      this.currentView = this.context.getCurrentTexture().createView();
    }
    const colorAttachment = {
      view: resolvedColorView ?? this.currentView,
      loadOp: colorLoadOp,
      storeOp: "store",
      clearValue: clearColor ?? { r: 0, g: 0, b: 0, a: 1 }
    };
    const resolvedDepthView = depthView;
    // GPUCommandEncoder.beginRenderPass で描画パスを開始する
    const descriptor = {
      colorAttachments: [colorAttachment]
    };
    if (resolvedDepthView) {
      descriptor.depthStencilAttachment = {
        view: resolvedDepthView,
        depthLoadOp: depthClear ? "clear" : "load",
        depthStoreOp: "store",
        depthClearValue: 1.0
      };
    }
    this.passEncoder = this.commandEncoder.beginRenderPass(descriptor);
    return this.passEncoder;
  }

  endPass() {
    if (this.passEncoder) {
      this.passEncoder.end();
      this.passEncoder = null;
    }
  }

  submit() {
    if (this.passEncoder) {
      this.passEncoder.end();
      this.passEncoder = null;
    }
    if (this.commandEncoder) {
      // GPUCommandEncoder.finish でコマンドバッファ化し、GPUQueue.submit で実行する
      const commandBuffer = this.commandEncoder.finish();
      this.queue.submit([commandBuffer]);
      this.commandEncoder = null;
    }
    this.currentView = null;
  }
}

export default class Screen {
  // `#canvas` を取得し、WebGPUコンテキスト準備を開始する
  constructor(document) {
    // アプリ層が直接使う高レベル画面API
    // clear()/present() と frameカウンタ管理を担当する
    const canvas = document.getElementById("canvas");
    if (!canvas) {
      throw new Error("Screen requires a canvas element with id 'canvas'");
    }
    this.canvas = canvas;
    this.width = readPositiveCanvasDimension(canvas, "width", "clientWidth", "canvas width");
    this.height = readPositiveCanvasDimension(canvas, "height", "clientHeight", "canvas height");
    // CSS表示サイズ（ピクセル）
    this.displayWidth = readPositiveCanvasDimension(canvas, "clientWidth", "width", "display width");
    this.displayHeight = readPositiveCanvasDimension(canvas, "clientHeight", "height", "display height");
    // リサイズ要求（論理解像度）を保持し、viewport変化時に再適用する
    this.requestedWidth = this.displayWidth;
    this.requestedHeight = this.displayHeight;
    // 既定ではPC/スマホ両対応のため、viewportへ自動フィット + DPR対応を有効化する
    this.fitToViewport = true;
    this.useDevicePixelRatio = true;
    this.maxDevicePixelRatio = 2.0;
    this.viewportPadding = 0;
    // 縦長端末での負荷緩和:
    // アスペクト比に応じて内部解像度を段階的に下げる
    this.enableAdaptiveRenderScale = true;
    this.clearColor = [0.0, 0.0, 0.0, 1.0];
    this.startTime = 0;
    this.frames = 0;
    this.captureRequested = false;
    this.captureFilename = "screen.png";
    // WebGPU初期化前に1度キャンバス実サイズを整える
    this._applyResize(this.requestedWidth, this.requestedHeight, false);
    this.gpu = new WebGPUContext(canvas);
    this.ready = this.gpu.ready;
    this._onWindowResize = () => {
      this._applyResize(this.requestedWidth, this.requestedHeight, true);
    };
    if (typeof window !== "undefined") {
      window.addEventListener("resize", this._onWindowResize);
      window.addEventListener("orientationchange", this._onWindowResize);
    }
  }

  // キャンバスサイズと深度テクスチャを更新する
  resize(w, h) {
    if (!Number.isFinite(w) || Number(w) <= 0) {
      throw new Error("Screen.resize width must be a positive finite number");
    }
    if (!Number.isFinite(h) || Number(h) <= 0) {
      throw new Error("Screen.resize height must be a positive finite number");
    }
    const reqW = Math.floor(Number(w));
    const reqH = Math.floor(Number(h));
    this._applyResize(reqW, reqH, true);
  }

  _applyResize(reqW, reqH, updateGpu) {
    if (!Number.isFinite(reqW) || Number(reqW) <= 0) {
      throw new Error("Screen resize request width must be a positive finite number");
    }
    if (!Number.isFinite(reqH) || Number(reqH) <= 0) {
      throw new Error("Screen resize request height must be a positive finite number");
    }
    this.requestedWidth = reqW;
    this.requestedHeight = reqH;

    const viewportW = typeof window !== "undefined"
      ? Math.floor(window.innerWidth - this.viewportPadding * 2)
      : reqW;
    const viewportH = typeof window !== "undefined"
      ? Math.floor(window.innerHeight - this.viewportPadding * 2)
      : reqH;

    let displayW = reqW;
    let displayH = reqH;
    if (this.fitToViewport && viewportW > 0 && viewportH > 0 && reqW > 0 && reqH > 0) {
      displayW = reqW;
      displayH = reqH;
    }

    const dprBase = (typeof window !== "undefined" && this.useDevicePixelRatio)
      ? (() => {
        const numericDpr = Number(window.devicePixelRatio);
        if (!Number.isFinite(numericDpr) || numericDpr <= 0) {
          throw new Error(`Screen devicePixelRatio must be a positive finite number: ${window.devicePixelRatio}`);
        }
        return numericDpr;
      })()
      : 1.0;
    const dpr = dprBase;
    const pixelW = Math.round(displayW * dpr);
    const pixelH = Math.round(displayH * dpr);

    this.displayWidth = displayW;
    this.displayHeight = displayH;
    this.width = pixelW;
    this.height = pixelH;
    this.canvas.style.width = `${displayW}px`;
    this.canvas.style.height = `${displayH}px`;
    this.canvas.width = pixelW;
    this.canvas.height = pixelH;

    if (updateGpu && this.gpu?.device) {
      this.gpu.resize();
    }
  }

  // 現在アスペクトに応じた推奨縦FOVを返す
  // `base` は短辺方向のFOVとして扱う。
  // 横長画面では縦方向が短辺なので `base` をそのまま縦FOVにする。
  // 縦長画面では横方向が短辺なので、横FOVが `base` になる縦FOVを逆算する。
  getRecommendedFov(base = 55.0) {
    if (!Number.isFinite(base) || base <= 0.0 || base >= 180.0) {
      throw new Error(`Screen.getRecommendedFov base must be in the range 0..180 degrees: ${base}`);
    }
    const aspect = this.getAspect();
    if (!Number.isFinite(aspect) || aspect <= 0.0) {
      throw new Error(`Screen.getRecommendedFov aspect must be a positive finite number: ${aspect}`);
    }
    if (aspect >= 1.0) {
      return base;
    }
    const shortHalfAngle = base * 0.5 * Math.PI / 180.0;
    const verticalHalfAngle = Math.atan(Math.tan(shortHalfAngle) / aspect);
    const vfov = verticalHalfAngle * 2.0 * 180.0 / Math.PI;
    if (!Number.isFinite(vfov) || vfov <= 0.0 || vfov >= 180.0) {
      throw new Error(`Screen.getRecommendedFov produced invalid vertical fov: ${vfov}`);
    }
    return vfov;
  }

  // クリア色 `[r,g,b,a]` を設定する
  setClearColor(color) {
    this.clearColor = color;
  }

  // 現状 no-op（WebGPUではパイプライン側設定）
  cullFace() {
    // WebGPU culling is set per pipeline; handled in shaders/pipelines.
  }

  // 内部 `WebGPUContext` を返す
  getGL() {
    return this.gpu;
  }

  // `clear()` 呼び出し回数を返す
  getFrameCount() {
    return this.frames;
  }

  // `width / height` を返す
  getAspect() {
    return this.width / this.height;
  }

  // 現在の幅を返す
  getWidth() {
    return this.width;
  }

  // 現在の高さを返す
  getHeight() {
    return this.height;
  }

  // offscreen 描画用 render target を screen と同じ GPU で作る
  createRenderTarget(options = {}) {
    return new RenderTarget(this.gpu, {
      width: options.width ?? this.width,
      height: options.height ?? this.height,
      ...options
    });
  }

  // フレームカウンタを0に戻す
  resetFrameCount() {
    this.frames = 0;
  }

  // 現状 no-op
  viewport() {
    // WebGPU viewport handled in render pass; no-op here.
  }

  // カラー/深度をクリアしてレンダーパスを開始する
  clear(target = null) {
    // カラーバッファと深度をクリアして新しいフレームを開始する
    const [r, g, b, a] = this.clearColor;
    const colorView = target?.getColorView?.() ?? target?.colorView ?? null;
    const depthView = target?.getDepthView?.() ?? target?.depthView ?? this.gpu.depthView;
    this.gpu.beginPass({
      clearColor: { r, g, b, a },
      colorLoadOp: "clear",
      depthClear: true,
      target,
      colorView,
      depthView
    });
    this.frames++;
  }

  // カラーは保持しつつ深度のみクリアする
  clearDepthBuffer(target = null) {
    // カラーは保持したまま深度だけ初期化し、別レイヤ描画を可能にする
    const [r, g, b, a] = this.clearColor;
    const colorView = target?.getColorView?.() ?? target?.colorView ?? null;
    const depthView = target?.getDepthView?.() ?? target?.depthView ?? this.gpu.depthView;
    this.gpu.beginPass({
      clearColor: { r, g, b, a },
      colorLoadOp: "load",
      depthClear: true,
      target,
      colorView,
      depthView
    });
  }

  // clear/load/depth を細かく指定して pass を開始する
  beginPass(options = {}) {
    const color = options.clearColor ?? this.clearColor;
    const [r, g, b, a] = color;
    const target = options.target ?? null;
    const colorView = options.colorView !== undefined
      ? options.colorView
      : (target?.getColorView?.() ?? target?.colorView ?? null);
    const depthView = options.depthView !== undefined
      ? options.depthView
      : (target?.getDepthView?.() ?? target?.depthView ?? this.gpu.depthView);
    return this.gpu.beginPass({
      clearColor: { r, g, b, a },
      colorLoadOp: options.colorLoadOp ?? "clear",
      depthClear: options.depthClear ?? true,
      target,
      colorView,
      depthView
    });
  }

  // コマンドを `submit` して描画を確定する
  present() {
    // コマンド送信後、必要なら予約済みスクリーンショットを保存する
    this.gpu.submit();
    if (this.captureRequested) {
      this.captureRequested = false;
      this._saveCanvasImage(this.captureFilename);
    }
  }

  // `requestAnimationFrame` で描画ループを開始する
  animation(loopFunc) {
    const renderLoop = (timestamp) => {
      const delta = timestamp - this.startTime;
      loopFunc(delta);
      requestAnimationFrame(renderLoop);
    };
    this.startTime = window.performance.now();
    requestAnimationFrame(renderLoop);
  }

  // 現状 no-op
  update() {}

  // 現状 no-op
  swapInterval(interval) {}

  // キャンバス内容を PNG として保存する
  screenShot(filename) {
    this.captureFilename = filename || "screen.png";
    this.captureRequested = true;
  }

  _saveCanvasImage(filename) {
    this.canvas.toBlob((blob) => {
      if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      }
    }, "image/png");
  }
}
