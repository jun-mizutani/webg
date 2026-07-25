// ---------------------------------------------
// Screen.js       2026/07/25
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import RenderTarget from "./RenderTarget.js";
import { CAMERA_REVERSE_Z } from "./DepthConvention.js";

// キャンバスサイズの正の有限数値を読み取るユーティリティ関数
// 優先的に width(属性値)を見て、なければ clientWidth (CSS) を見る 
// それでもダメなら "canvas width" というラベルと共にエラーを出す
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

// GPU feature名の配列を検証し、入力順を維持した重複なしの配列へ正規化する
// undefinedだけを未指定として空配列へ変換し、文字列や空文字などの誤指定は例外にする
const normalizeGpuFeatureList = (features, name) => {
  if (features === undefined) {
    return [];
  }
  if (!Array.isArray(features)) {
    throw new Error(`${name} must be an array`);
  }
  const normalized = [];
  const seen = new Set();
  for (let i = 0; i < features.length; i += 1) {
    const feature = features[i];
    if (typeof feature !== "string" || feature.length === 0) {
      throw new Error(`${name}[${i}] must be a non-empty string`);
    }
    if (!seen.has(feature)) {
      seen.add(feature);
      normalized.push(feature);
    }
  }
  return normalized;
};

class WebGPUContext {
  // `#canvas` を取得し、WebGPUコンテキスト準備を開始する
  constructor(canvas, options = {}) {
    // WebGPUの生コンテキスト層:
    // device/queue/context/passEncoder など、GPU実行に必要な実体を保持する
    this.canvas = canvas;
    this.requiredFeatures = normalizeGpuFeatureList(
      options.requiredFeatures,
      "Screen gpu.requiredFeatures"
    );
    this.optionalFeatures = normalizeGpuFeatureList(
      options.optionalFeatures,
      "Screen gpu.optionalFeatures"
    );
    this.requestedFeatures = [];
    this.unavailableOptionalFeatures = [];
    this.adapter = null;
    this.device = null;
    this.queue = null;
    this.context = null;
    this.format = null;
    this.depthTexture = null;
    this.depthView = null;
    this.depthConvention = CAMERA_REVERSE_Z;
    this.commandEncoder = null;
    this.passEncoder = null;
    this.currentView = null;
    this.passTargetsSwapChain = false;
    this.passHasDepth = false;
    this.ready = this.init();
  }

  // このインスタンスの初期化段階で、必要な状態と資源を準備して処理を開始する
  async init() {
    // ブラウザのWebGPU実装から adapter/device を取得し、canvasへ接続する
    if (!navigator.gpu) {
      throw new Error("WebGPU is not supported in this browser.");
    }
    this.adapter = await navigator.gpu.requestAdapter();
    if (!this.adapter) {
      throw new Error("Failed to get GPU adapter.");
    }

    // required featureは未対応環境で通常deviceへ切り替えず、要求を満たせない理由を明示する
    for (const feature of this.requiredFeatures) {
      if (this.adapter.features?.has?.(feature) !== true) {
        throw new Error(`Required GPU feature is not supported: ${feature}`);
      }
    }

    // optional featureはadapter対応時だけdevice descriptorへ加える
    // 未対応featureは記録して、device作成失敗や対応済み扱いにせず利用側から確認可能にする
    const requested = new Set(this.requiredFeatures);
    this.unavailableOptionalFeatures = [];
    for (const feature of this.optionalFeatures) {
      if (this.adapter.features?.has?.(feature) === true) {
        requested.add(feature);
      } else {
        this.unavailableOptionalFeatures.push(feature);
      }
    }
    this.requestedFeatures = [...requested];

    // feature未指定時は従来と同じrequestDevice()呼び出しを維持する
    this.device = this.requestedFeatures.length > 0
      ? await this.adapter.requestDevice({
        requiredFeatures: this.requestedFeatures
      })
      : await this.adapter.requestDevice();
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
      format: this.depthConvention.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT
    });
    this.depthView = this.depthTexture.createView();
  }

  // `beginPass`は処理周期の開始または終了に必要な状態を更新する
  beginPass({
    clearColor,
    colorLoadOp = "clear",
    depthClear = true,
    target = null,
    colorView = null,
    depthView = undefined,
    timestampWrites = undefined
  } = {}) {
    // 1フレーム(または再開パス)のRenderPassを開始する
    if (this.passEncoder) {
      this.passEncoder.end();
      this.passEncoder = null;
    }
    // dynamic offset の slot 0 は Font の scale / color / texStep など
    // 即時設定の書き込み先として使っている
    // 文字描画で slot 0 を再利用すると、フレーム中の後続設定更新で
    // 最初の1文字だけ内容が上書きされるため、描画用 slot は 1 から始める
    this.uniformIndex = 1;
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
    this.passTargetsSwapChain = useSwapChain;
    this.passHasDepth = Boolean(resolvedDepthView);
    // GPUCommandEncoder.beginRenderPass で描画パスを開始する
    const descriptor = {
      colorAttachments: [colorAttachment]
    };
    if (timestampWrites) {
      descriptor.timestampWrites = timestampWrites;
    }
    if (resolvedDepthView) {
      descriptor.depthStencilAttachment = {
        view: resolvedDepthView,
        depthLoadOp: depthClear ? "clear" : "load",
        depthStoreOp: "store",
        depthClearValue: (target?.depthConvention ?? this.depthConvention).clearValue
      };
    }
    this.passEncoder = this.commandEncoder.beginRenderPass(descriptor);
    return this.passEncoder;
  }

  // `endPass`は処理周期の開始または終了に必要な状態を更新する
  endPass() {
    if (this.passEncoder) {
      this.passEncoder.end();
      this.passEncoder = null;
    }
    this.passTargetsSwapChain = false;
    this.passHasDepth = false;
  }

  // `submit`は処理周期の開始または終了に必要な状態を更新する
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
    this.passTargetsSwapChain = false;
    this.passHasDepth = false;
  }
}

export default class Screen {
  // `#canvas` を取得し、WebGPUコンテキスト準備を開始する
  constructor(document, options = {}) {
    // アプリ層が直接使う高レベル画面API
    // clear()/present() と frameカウンタ管理を担当する
    const canvas = document.getElementById("canvas");
    if (!canvas) {
      throw new Error("Screen requires a canvas element with id 'canvas'");
    }
    this.canvas = canvas;
    // 優先的に width(属性値)を見て、なければ clientWidth (CSS) を見る 
    this.width = readPositiveCanvasDimension(canvas, "width", "clientWidth", "canvas width");
    // 優先的に height(属性値)を見て、なければ clientHeight (CSS) を見る 
    this.height = readPositiveCanvasDimension(canvas, "height", "clientHeight", "canvas height");
    // 優先的に clientWidth (CSS) を見て、なければwidth(属性値)を見る 
    this.displayWidth = readPositiveCanvasDimension(canvas, "clientWidth", "width", "display width");
    // 優先的に clientHeight (CSS) を見て、なければheight(属性値)を見る 
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
    const gpuOptions = options.gpu === undefined ? {} : options.gpu;
    if (!gpuOptions || typeof gpuOptions !== "object" || Array.isArray(gpuOptions)) {
      throw new Error("Screen gpu option must be an object");
    }
    this.gpu = new WebGPUContext(canvas, gpuOptions);
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

  // `_applyResize`は表示領域に合わせて関連する寸法と描画先を更新する
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
  // `base` は短辺方向のFOVとして扱う
  // 横長画面では縦方向が短辺なので `base` をそのまま縦FOVにする
  // 縦長画面では横方向が短辺なので、横FOVが `base` になる縦FOVを逆算する
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
  getGPU() {
    return this.gpu;
  }

  // device作成時に実際に要求したGPU feature名を配列で返す
  // 内部配列を直接変更されないよう複製し、未指定時は空配列を返す
  getRequestedGPUFeatures() {
    return [...this.gpu.requestedFeatures];
  }

  // adapterが対応せずdeviceへ要求しなかったoptional feature名を返す
  // optional featureの利用可否を0やfalseの代替機能へ置き換えず、名前で確認できるようにする
  getUnavailableOptionalGPUFeatures() {
    return [...this.gpu.unavailableOptionalFeatures];
  }

  // 初期化済みdeviceが指定featureを実際に持つか確認する
  // device準備前は未対応と断定せずfalseを返し、利用側は通常await screen.ready後に呼ぶ
  hasGPUFeature(feature) {
    if (typeof feature !== "string" || feature.length === 0) {
      throw new Error("Screen.hasGPUFeature feature must be a non-empty string");
    }
    return this.gpu.device?.features?.has?.(feature) === true;
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
      depthConvention: options.depthConvention ?? this.gpu.depthConvention,
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
      depthView,
      timestampWrites: options.timestampWrites
    });
  }

  // Tone MapまたはEdgeの表示色をswapchainへcopyするdepthなしrender passを開始する
  // 通常3D描画用clear()と分離し、最終copyがReverse-Z depth attachmentへ依存しないようにする
  beginPresentPass(options = {}) {
    const color = options.clearColor ?? this.clearColor;
    const [r, g, b, a] = color;
    return this.gpu.beginPass({
      clearColor: { r, g, b, a },
      colorLoadOp: options.colorLoadOp ?? "clear",
      depthClear: false,
      target: null,
      colorView: null,
      depthView: null,
      timestampWrites: options.timestampWrites
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

  // `_saveCanvasImage`は現在のキャンバス画像を取得し、指定形式で保存する
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
