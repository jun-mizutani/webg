// ---------------------------------------------
// PingPongTexture.js  2026/06/14
//   Ping-pong GPUTexture manager
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import util from "./util.js";

// 2枚のraw GPUTextureをsampled sourceとstorage destinationとして交互に使うindexを管理します
// Texture View、Bind Group、resize、破棄はTextureの利用条件を知る呼び出し側が管理します
export default class PingPongTexture {
  // 生成済みの異なる2枚のGPUTextureと、最初に読み取り元とするindexを保存します
  // resource不足や不正indexを開始前に検出し、同じTextureを同時に読み書きする誤りを防ぎます
  constructor(textures, options = {}) {
    this.label = util.readOptionalString(
      options.label,
      "PingPongTexture label",
      "PingPongTexture",
      { trim: true, allowEmpty: false }
    );
    this.textures = this.validateResources(textures);
    this.currentIndex = this.validateIndex(options.currentIndex ?? 0);
  }

  // 呼び出し側が生成した異なる2枚のresourceだけを受け付けます
  // 配列を複製して保持し、外部の配列操作でTextureの対応順が変わらないようにします
  validateResources(textures) {
    if (!Array.isArray(textures) || textures.length !== 2 || !textures[0] || !textures[1]) {
      throw new Error(`${this.label} requires exactly two GPUTexture resources`);
    }
    if (textures[0] === textures[1]) {
      throw new Error(`${this.label} requires two distinct GPUTexture resources`);
    }
    return [...textures];
  }

  // sampled sourceまたはstorage destinationを示すindexが0か1であることを確認します
  // Texture更新履歴を壊す値を自動補正せず、呼び出し側の処理フローの誤りとして例外にします
  validateIndex(index) {
    if (index !== 0 && index !== 1) {
      throw new Error(`${this.label} index must be 0 or 1: ${index}`);
    }
    return index;
  }

  // 現在sampled sourceとして読むGPUTextureのindexを返します
  getCurrentIndex() {
    return this.currentIndex;
  }

  // 指定indexの反対側にあるGPUTextureのindexを返します
  // 引数を省略した場合は現在indexから次のstorage destinationを求めます
  getNextIndex(index = this.currentIndex) {
    return 1 - this.validateIndex(index);
  }

  // 次のCompute Passがsampled sourceとして読む現在のGPUTextureを返します
  getCurrent() {
    return this.textures[this.currentIndex];
  }

  // 次のCompute Passがstorage destinationとして書く反対側のGPUTextureを返します
  getNext() {
    return this.textures[this.getNextIndex()];
  }

  // 管理中の2枚を生成時のindex順で複製して返します
  // 内部配列を直接公開せず、TextureとViewの対応を外部から変更できないようにします
  getResources() {
    return [...this.textures];
  }

  // 最新画像を持つGPUTextureのindexを明示的に保存し、保存後のindexを返します
  setCurrentIndex(index) {
    this.currentIndex = this.validateIndex(index);
    return this.currentIndex;
  }

  // 現在indexを反対側へ切り替え、直前の出力Textureを新しい入力Textureにします
  // pixel内容やTexture Viewを交換せず、役割を示すindexだけを変更します
  swap() {
    this.currentIndex = 1 - this.currentIndex;
    return this.currentIndex;
  }

  // 再初期化後にsampled sourceとするindexを明示し、そのindexを返します
  // Textureのpixelは消去しないため、必要なclearや初期画像転送は呼び出し側が先に行います
  reset(index = 0) {
    return this.setCurrentIndex(index);
  }
}
