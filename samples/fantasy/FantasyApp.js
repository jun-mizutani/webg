// ---------------------------------------------
// FantasyApp.js  2026/10/04
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// 埋込みCanvasのサイズをPBR rendererへ同期する

import WebgSceneApp from "../../webg/app/WebgSceneApp.js";

// 描画・粒子の標準callbackは継承し、ページ固有のサイズ追従だけを追加する
export default class FantasyApp extends WebgSceneApp {
  // コアと同じ初期化順と、途中で失敗した場合の解放を保つ
  static async create(options) {
    const instance = new FantasyApp(options);

    try {
      await instance.initialize();
      return instance;
    } catch (error) {
      instance.destroy();
      throw error;
    }
  }

  // CSS上の表示領域とCanvas・PBRの描画先を同じ寸法にそろえる
  async initialize() {
    await super.initialize();
    const stage = this.document.querySelector(".stage");

    // stageのCSS寸法を読み、Canvasの固定サイズとPBRの描画先へ同じ寸法を渡す
    const resize = () => {
      const width = Math.max(1, Math.round(stage.clientWidth));
      const height = Math.max(1, Math.round(stage.clientHeight));

      this.app.fixedCanvasSize = { width, height, useDevicePixelRatio: false };
      this.app.applyViewportLayout();
      this.renderer.resize(width, height);
    };

    this.observer = new ResizeObserver(resize);
    this.observer.observe(stage);
    resize();
  }

  // 作品が登録したObserverを先に外し、GPU資源は標準入口へ返す
  destroy() {
    this.observer?.disconnect();
    return super.destroy();
  }
}
