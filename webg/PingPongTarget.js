// ---------------------------------------------
// PingPongTarget.js  2026/06/14
//   Ping-pong RenderTarget manager
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import util from "./util.js";

// 2個のRenderTargetをsampled sourceとstorage destinationとして交互に使います
// raw Textureとは異なる非同期初期化、同時resize、resource ownershipを二つ一組で管理します
export default class PingPongTarget {
  // 生成済みの異なる2個のRenderTargetと初期index、resource所有権を保存します
  // 所有権はresourceの型やlabelから推測せず、生成責任を持つ呼び出し側が明示します
  constructor(targets, options = {}) {
    this.label = util.readOptionalString(
      options.label,
      "PingPongTarget label",
      "PingPongTarget",
      { trim: true, allowEmpty: false }
    );
    this.targets = this.validateTargets(targets);
    this.currentIndex = this.validateIndex(options.currentIndex ?? 0);
    this.ownsResources = util.readOptionalBoolean(
      options.ownsResources,
      `${this.label} ownsResources`,
      false
    );
    this.destroyed = false;
    // 両RenderTargetの非同期初期化完了を一つのPromiseとして呼び出し側へ公開します
    this.ready = Promise.all(this.targets.map((target) => target.ready));
  }

  // View、寸法、resize、destroyを持つ異なる2個のRenderTargetだけを受け付けます
  // raw GPUTextureを誤って渡す処理や、同じtargetをread/writeへ兼用する処理を拒否します
  validateTargets(targets) {
    if (!Array.isArray(targets) || targets.length !== 2 || !targets[0] || !targets[1]) {
      throw new Error(`${this.label} requires exactly two RenderTarget resources`);
    }
    if (targets[0] === targets[1]) {
      throw new Error(`${this.label} requires two distinct RenderTarget resources`);
    }
    for (const target of targets) {
      if (
        typeof target.getWidth !== "function" ||
        typeof target.getHeight !== "function" ||
        typeof target.getView !== "function" ||
        typeof target.resize !== "function" ||
        typeof target.destroy !== "function"
      ) {
        throw new Error(`${this.label} requires RenderTarget-compatible resources`);
      }
    }
    return [...targets];
  }

  // sampled sourceまたはstorage destinationを示すindexが0か1であることを確認します
  // 不正値を丸めず例外にし、Viewと書き込み先の対応ずれを開始前に検出します
  validateIndex(index) {
    if (index !== 0 && index !== 1) {
      throw new Error(`${this.label} index must be 0 or 1: ${index}`);
    }
    return index;
  }

  // 破棄済みの組を再利用せず、resource lifecycleの誤りを操作時点で例外にします
  requireAlive() {
    if (this.destroyed) {
      throw new Error(`${this.label} is destroyed`);
    }
  }

  // 現在sampled sourceとして読むRenderTargetのindexを返します
  getCurrentIndex() {
    this.requireAlive();
    return this.currentIndex;
  }

  // 指定indexの反対側にあるRenderTargetのindexを返します
  // 引数を省略した場合は現在indexから次のstorage destinationを求めます
  getNextIndex(index = this.currentIndex) {
    this.requireAlive();
    return 1 - this.validateIndex(index);
  }

  // 次のCompute Passがsampled sourceとして読む現在のRenderTargetを返します
  getCurrent() {
    this.requireAlive();
    return this.targets[this.currentIndex];
  }

  // 次のCompute Passがstorage destinationとして書く反対側のRenderTargetを返します
  getNext() {
    this.requireAlive();
    return this.targets[this.getNextIndex()];
  }

  // 管理中の2個を生成時のindex順で複製して返します
  // 内部配列を直接公開せず、TargetとViewの対応を外部から変更できないようにします
  getResources() {
    this.requireAlive();
    return [...this.targets];
  }

  // 最新画像を持つRenderTargetのindexを明示的に保存し、保存後のindexを返します
  setCurrentIndex(index) {
    this.requireAlive();
    this.currentIndex = this.validateIndex(index);
    return this.currentIndex;
  }

  // 現在indexを反対側へ切り替え、直前の出力Targetを新しい入力Targetにします
  // GPU TextureやViewを移動せず、役割を示すindexだけを変更します
  swap() {
    this.requireAlive();
    this.currentIndex = 1 - this.currentIndex;
    return this.currentIndex;
  }

  // 再初期化後にsampled sourceとするindexを明示し、そのindexを返します
  // Targetのpixel内容は変更しないため、必要なclearは呼び出し側が先に行います
  reset(index = 0) {
    return this.setCurrentIndex(index);
  }

  // 両RenderTargetを同じpixel寸法へ変更し、どちらかを再生成した場合だけtrueを返します
  // 一方だけが古い寸法の状態も検出し、read/write範囲を常に二つ一組で一致させます
  resize(width, height) {
    this.requireAlive();
    const checkedWidth = util.readFiniteNumber(width, `${this.label} width`, {
      integer: true,
      min: 1
    });
    const checkedHeight = util.readFiniteNumber(height, `${this.label} height`, {
      integer: true,
      min: 1
    });
    let resized = false;
    for (const target of this.targets) {
      if (target.getWidth() !== checkedWidth || target.getHeight() !== checkedHeight) {
        target.resize(checkedWidth, checkedHeight);
        resized = true;
      }
    }
    return resized;
  }

  // ownsResourcesがtrueの場合だけ管理中の2個を破棄し、保持している参照を解放します
  // 外部resourceを包む非所有の組では、所有者を推測してTargetを破棄しません
  destroy() {
    if (this.destroyed) {
      return false;
    }
    if (this.ownsResources) {
      for (const target of this.targets) {
        target.destroy();
      }
    }
    this.targets = [];
    this.destroyed = true;
    return true;
  }
}
