// samples/circular_breaker2/ArenaSceneApp.js 2026/09/20
// 円形アリーナの複数色照明を、既存のDeferred Lightingへ接続する
import WebgSceneApp from "../../webg/app/WebgSceneApp.js";

// アリーナを囲む6灯をworld座標で固定配置する
// 半径36、高さ22から照らし、カメラやパドルが動いても照明位置を維持する
export function createArenaLights() {
  const colors = [[.08,.65,1], [1,.32,.06], [.55,.12,1],
    [.08,1,.55], [1,.08,.28], [.28,.45,1]];
  return colors.map((color, index) => {
    const angle = index * Math.PI / 3;
    return { type: "point", position: [Math.cos(angle) * 36, 22, Math.sin(angle) * 36],
      color, radius: 72, intensity: 4.0 };
  });
}

// 公開コアを変更せず、サンプルの描画後段にだけ複数光源を追加する
export default class ArenaSceneApp extends WebgSceneApp {
  // 初期化後、見出しを除く表示領域にCanvasの実描画サイズを合わせる
  // CSS拡大だけで済ませず、Screenと投影行列を既存の更新処理で同期する
  async initialize() {
    await super.initialize();
    const stage = this.document.querySelector(".stage");
    if (!stage) throw new Error("ArenaSceneApp requires .stage");
    // 非表示などで領域が0の間は描画サイズを更新せず、再表示の通知を待つ
    const resize = () => {
      const width = stage.clientWidth, height = stage.clientHeight;
      if (width === 0 || height === 0) return;
      this.app.fixedCanvasSize = { width, height, useDevicePixelRatio: false };
      this.app.applyViewportLayout();
      // G-buffer、SSR、BloomもCanvasと同じサイズへ更新する
      this.renderer.resize(this.app.screen.getWidth(), this.app.screen.getHeight());
    };
    this.stageResizeObserver = new ResizeObserver(resize);
    this.stageResizeObserver.observe(stage);
    resize();
  }

  // 終了後にサイズ通知が破棄済みGPUリソースへ触れないよう監視を先に解除する
  destroy() {
    this.stageResizeObserver?.disconnect();
    this.stageResizeObserver = null;
    return super.destroy();
  }

  // 親と同じ初期化・失敗時の解放を、派生クラスのインスタンスへ適用する
  static async create(options) {
    const instance = new ArenaSceneApp(options);
    try {
      await instance.initialize();
      return instance;
    } catch (error) {
      instance.destroy();
      throw error;
    }
  }

  // 更新、カメラ、G-buffer描画は親の処理を保つ
  // 照明を計算するonAfterDraw3dだけ、6灯を渡す描画コールバックへ置き換える
  createFrameCallbacks() {
    if (this.runtime) throw new Error("ArenaSceneApp requires physics: false");
    const base = super.createFrameCallbacks();
    const lights = createArenaLights();
    const lit = this.renderer.createFrameCallbacks(this.app, {
      encode: {
        lights, lightCount: lights.length,
        shadowEnabled: this.effectOptions.shadow,
        ssaoEnabled: this.effectOptions.ssao,
        ssrEnabled: this.effectOptions.ssr,
        dofEnabled: this.effectOptions.dof
      },
      // 表示完了の通知も元の高水準アプリと同じ引数で維持する
      onPresented: payload => this.options.onPresented?.({ ...payload, sceneApp: this })
    });
    return Object.freeze({ ...base, onAfterDraw3d: lit.onAfterDraw3d });
  }
}
