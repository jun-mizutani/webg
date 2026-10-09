// CoasterApp.js 2026/09/26
// WebgSceneAppへFollow EyeRig、色付きDeferred Lighting、画面追従を接続する
import EyeRig from "../../webg/EyeRig.js";
import WebgSceneApp from "../../webg/app/WebgSceneApp.js";

// 短辺基準の視野角を70度にし、追従中に周囲のコースを広く映す
const COASTER_VIEW_ANGLE = 70.0;

export default class CoasterApp extends WebgSceneApp {
  // 初期化途中の失敗も共通destroyへ渡し、生成済みGPU資源を回収する
  static async create(options) {
    const instance = new CoasterApp(options);
    try {
      await instance.initialize();
      return instance;
    } catch (error) {
      instance.destroy();
      throw error;
    }
  }

  // PBR初期化後にCanvasを画面領域へ合わせ、途中のサイズ変更も同じ倍率で反映する
  async initialize() {
    await super.initialize();
    this.app.viewAngle = COASTER_VIEW_ANGLE;
    this.app.updateCameraFrame();
    const stage = this.document.querySelector(".stage");
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

  // cameraRigを先頭車両へ取り付け、車体前方を注視するFollow EyeRigを作る
  // upReference=baseにより、コースのbank姿勢をカメラの上方向へ穏やかに伝える
  installCamera() {
    const targetNode = this.scene.getNode("lead-car");
    this.app.cameraRig.detach();
    this.app.cameraRig.attach(targetNode);
    const eyeRig = new EyeRig(this.app.cameraRig, this.app.cameraRod, this.app.eye, {
      document: this.document,
      element: this.app.screen.canvas,
      input: this.app.input,
      type: "follow",
      follow: {
        targetNode,
        targetOffset: [0, 0.35, 3.5],
        basePosition: [0, 2.6, 0],
        baseAttitude: [0, 0, 0],
        distance: 12,
        minDistance: 6,
        maxDistance: 33,
        yaw: 180,
        pitch: -8,
        roll: 0,
        lookPitch: -10,
        response: 18,
        maxAngularSpeed: 720,
        upReference: "base"
      }
    });
    eyeRig.attachPointer(this.app.screen.canvas);
    eyeRig.update(0);
    this.app.eyeRig = eyeRig;
    this.app.eyeRigOptions = { update: true, syncCamera: false };
  }

  // 固定都市照明と車両追従照明を同じDeferred Lighting passへ渡す
  createFrameCallbacks() {
    this.lights = [
      { type: "point", position: [0, 12, 18], color: [0.08, 0.75, 1], radius: 30, intensity: 6 },
      { type: "point", position: [18, 16, -5], color: [1, 0.08, 0.32], radius: 30, intensity: 6 },
      { type: "point", position: [-18, 11, -10], color: [0.45, 0.18, 1], radius: 28, intensity: 5 },
      { type: "point", position: [-12, 19, 15], color: [1, 0.45, 0.05], radius: 26, intensity: 5 },
      { type: "point", position: [0, 8, 0], color: [0.06, 0.65, 1], radius: 22, intensity: 3 },
      { type: "point", position: [0, 7, 18], color: [1, 0.12, 0.04], radius: 15, intensity: 8 }
    ];
    return this.renderer.createFrameCallbacks(this.app, {
      renderScene: { shadowEnabled: true },
      encode: {
        lights: this.lights,
        lightCount: this.lights.length,
        shadowEnabled: true,
        ssaoEnabled: false,
        ssrEnabled: true,
        dofEnabled: false
      },
      onUpdate: frame => {
        this.options.onUpdate?.({ ...frame, sceneApp: this });
        for (const emitter of this.particleEmitters.values()) {
          if (!emitter.destroyed) emitter.setTimeScale(this.timeScale);
        }
      }
    });
  }

  // 先頭車両の赤い補助光を毎frameのコース位置へ移す
  updateLeadLight(position) {
    if (!this.lights) return;
    this.lights[5].position = [position[0], position[1] + 0.8, position[2]];
  }

  // 画面監視を解除してから、高水準アプリの粒子・描画・scene資源を解放する
  destroy() {
    this.resizeObserver?.disconnect();
    return super.destroy();
  }
}
