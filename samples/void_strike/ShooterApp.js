// ShooterApp.js 2026/09/25
// WebgSceneAppのPBR描画へアリーナ照明と全画面Canvasのサイズ更新を加える
import WebgSceneApp from "../../webg/app/WebgSceneApp.js";

export default class ShooterApp extends WebgSceneApp {
  // 初期化途中に例外が出た場合も同じSceneAppの解放処理へ渡す
  static async create(options) {
    const instance = new ShooterApp(options);
    try {
      await instance.initialize();
      return instance;
    } catch (error) {
      instance.destroy();
      throw error;
    }
  }

  // Window領域を監視し、CanvasとPBRの各描画先を同じ寸法へ合わせる
  async initialize() {
    await super.initialize();
    const stage = this.document.querySelector(".stage");
    if (!stage) throw new Error("ShooterApp requires .stage");
    const resize = () => {
      const width = stage.clientWidth;
      const height = stage.clientHeight;
      if (width === 0 || height === 0) return;
      this.app.fixedCanvasSize = { width, height, useDevicePixelRatio: false };
      this.app.applyViewportLayout();
      this.renderer.resize(this.app.screen.getWidth(), this.app.screen.getHeight());
    };
    this.resizeObserver = new ResizeObserver(resize);
    this.resizeObserver.observe(stage);
    resize();
  }

  // 固定視点を作り、Orbitのpointer更新を止めてWASDを機体操作へ割り当てる
  installCamera() {
    super.installCamera();
    this.app.eyeRig.detachPointer();
    this.app.eyeRigOptions = { update: false, syncCamera: false };
  }

  // シアン、紫、琥珀、赤の光源を遅延照明へ登録し、一灯をプレイヤーへ追従させる
  createFrameCallbacks() {
    const base = super.createFrameCallbacks();
    this.lights = [
      { type: "point", position: [-9, 8, -28], color: [0.04, 0.52, 1], radius: 48, intensity: 5.5 },
      { type: "point", position: [10, -1, -54], color: [0.85, 0.04, 0.62], radius: 54, intensity: 6 },
      { type: "point", position: [0, 9, -90], color: [1, 0.22, 0.035], radius: 55, intensity: 6.5 },
      { type: "point", position: [0, 2, 6], color: [0.02, 0.52, 1], radius: 22, intensity: 7 },
      { type: "point", position: [0, 0, -18], color: [1, 0.06, 0.24], radius: 24, intensity: 3.5 }
    ];
    const lit = this.renderer.createFrameCallbacks(this.app, {
      renderScene: { shadowEnabled: this.effectOptions.shadow },
      encode: {
        lights: this.lights,
        lightCount: this.lights.length,
        shadowEnabled: this.effectOptions.shadow,
        ssaoEnabled: this.effectOptions.ssao,
        ssrEnabled: this.effectOptions.ssr,
        dofEnabled: this.effectOptions.dof
      },
      onPresented: payload => this.options.onPresented?.({ ...payload, sceneApp: this })
    });
    return Object.freeze({ ...base, onAfterDraw3d: lit.onAfterDraw3d });
  }

  // プレイヤー照明を機体とHUDで使う現在位置へ移す
  updatePlayerLight(position) {
    this.lights[3].position = [position[0], position[1] + 1.2, position[2] - 1.5];
  }

  // サイズ監視を先に解除し、親クラスのCanvasとGPU資源を安全に解放する
  destroy() {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    return super.destroy();
  }
}
