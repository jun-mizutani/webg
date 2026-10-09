// ObservatoryApp.js 2026/09/25
// 展示の色付き照明と画面サイズを高水準アプリの描画処理へ接続する
import WebgSceneApp from "../../webg/app/WebgSceneApp.js";

export default class ObservatoryApp extends WebgSceneApp {
  // 初期化時の失敗も同じ解放処理へ渡し、途中で生成したGPU資源を回収する
  static async create(options) {
    const instance = new ObservatoryApp(options);
    try { await instance.initialize(); return instance; }
    catch (error) { instance.destroy(); throw error; }
  }

  // 画面領域をScreenとPBRへ反映し、ウィンドウを変更した後も投影比をそろえる
  async initialize() {
    await super.initialize();
    const stage = this.document.querySelector(".stage");
    const resize = () => {
      const width = stage.clientWidth, height = stage.clientHeight;
      if (width === 0 || height === 0) return;
      this.app.fixedCanvasSize = { width, height, useDevicePixelRatio: false };
      this.app.applyViewportLayout();
      this.renderer.resize(this.app.screen.getWidth(), this.app.screen.getHeight());
    };
    this.resizeObserver = new ResizeObserver(resize);
    this.resizeObserver.observe(stage);
    resize();
  }

  // 各展示を異なる色で照らす。Compute物理の更新とreadbackもSceneFrameへ接続する
  // 複数光源は同じDeferred Lightingへ一度に渡し、金属・透明物の照明で共有する
  createFrameCallbacks() {
    this.lights = [
      { type: "point", position: [-5, 5, 2], color: [0.12, 0.8, 1], radius: 20, intensity: 4 },
      { type: "point", position: [5, 5, 1], color: [1, 0.42, 0.12], radius: 20, intensity: 4 },
      { type: "point", position: [0, 6, -5], color: [0.42, 0.3, 1], radius: 20, intensity: 3 },
      { type: "point", position: [0, 4.76, -0.5], color: [0.18, 0.9, 1], radius: 12, intensity: 2 }
    ];
    return this.runtime.createFrameCallbacks({
      renderScene: { shadowEnabled: true },
      encode: { lights: this.lights, lightCount: this.lights.length,
        shadowEnabled: true, ssaoEnabled: false, ssrEnabled: true, dofEnabled: false },
      onUpdate: frame => this.options.onUpdate?.({ ...frame, sceneApp: this }),
      onError: error => this.handleRuntimeError(error)
    });
  }

  // サイズ監視を解除してから、親が物理・粒子・描画の資源を解放する
  destroy() { this.resizeObserver?.disconnect(); return super.destroy(); }
}
