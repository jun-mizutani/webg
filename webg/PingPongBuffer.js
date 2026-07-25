// ---------------------------------------------
// PingPongBuffer.js  2026/06/14
//   Ping-pong GPUBuffer manager
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import util from "./util.js";

// 2本のGPUBufferを読み取り元と書き込み先として交互に使うindexを管理します
// Bufferの生成、内容、Bind Group、dispatch、破棄は用途ごとに異なるため呼び出し側へ残します
export default class PingPongBuffer {
  // 生成済みの異なる2本のGPUBufferと、最初に読み取り元とするindexを保存します
  // 不足resourceや不正indexを初期化時に例外とし、simulation開始後の読み書き先ずれを防ぎます
  constructor(buffers, options = {}) {
    this.label = util.readOptionalString(
      options.label,
      "PingPongBuffer label",
      "PingPongBuffer",
      { trim: true, allowEmpty: false }
    );
    this.buffers = this.validateResources(buffers);
    this.currentIndex = this.validateIndex(options.currentIndex ?? 0);
  }

  // 呼び出し側が生成した異なる2本のresourceだけを受け付けます
  // 配列を複製して保持し、外部の配列操作でBufferの対応順が変わらないようにします
  validateResources(buffers) {
    if (!Array.isArray(buffers) || buffers.length !== 2 || !buffers[0] || !buffers[1]) {
      throw new Error(`${this.label} requires exactly two GPUBuffer resources`);
    }
    if (buffers[0] === buffers[1]) {
      throw new Error(`${this.label} requires two distinct GPUBuffer resources`);
    }
    return [...buffers];
  }

  // 読み取り元または書き込み先を示すindexが0か1であることを確認します
  // 小数、文字列、範囲外の値を丸めず、交換処理の誤りとして例外にします
  validateIndex(index) {
    if (index !== 0 && index !== 1) {
      throw new Error(`${this.label} index must be 0 or 1: ${index}`);
    }
    return index;
  }

  // 現在の読み取り元GPUBufferを示すindexを返します
  // indexごとに作成済みのBind Groupを選ぶ場合にresource取得なしで利用できます
  getCurrentIndex() {
    return this.currentIndex;
  }

  // 指定indexの反対側にあるGPUBufferのindexを返します
  // 引数を省略した場合は現在indexを基準として次の書き込み先を求めます
  getNextIndex(index = this.currentIndex) {
    return 1 - this.validateIndex(index);
  }

  // 次のCompute Passが読み取り元として使う現在のGPUBufferを返します
  getCurrent() {
    return this.buffers[this.currentIndex];
  }

  // 次のCompute Passが書き込み先として使う反対側のGPUBufferを返します
  getNext() {
    return this.buffers[this.getNextIndex()];
  }

  // 管理中の2本を生成時のindex順で複製して返します
  // 内部配列を直接公開せず、呼び出し側から要素順を変更できないようにします
  getResources() {
    return [...this.buffers];
  }

  // 最新状態を持つGPUBufferのindexを明示的に保存し、保存後のindexを返します
  // 複数substep後の最終indexを計算済みの場合でも0/1の検証を省略しません
  setCurrentIndex(index) {
    this.currentIndex = this.validateIndex(index);
    return this.currentIndex;
  }

  // 現在indexを反対側へ切り替え、直前の書き込み先を新しい読み取り元にします
  // GPUBufferの内容は移動せず、2本の役割を示すindexだけを一定時間で交換します
  swap() {
    this.currentIndex = 1 - this.currentIndex;
    return this.currentIndex;
  }

  // 再初期化後に読み取り元とするindexを明示し、そのindexを返します
  // GPUBufferの内容は変更しないため、必要なclearや初期データ転送は呼び出し側が先に行います
  reset(index = 0) {
    return this.setCurrentIndex(index);
  }
}
