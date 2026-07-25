// ---------------------------------------------
// Stack.js       2026/03/07
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

export default class Stack {

  constructor () {
    // COLLADA解析などで入れ子構造を辿る際に使うLIFOスタック
    // push/pop/top/count だけを持つ最小APIとして保守する
    this.stack = [];
  }

  // スタック末尾へ要素を積む
  // 返り値は使わない前提なので Array#push の戻り値は返さない
  push(contents) {
    this.stack.push(contents);
  }

  // スタック先頭要素を取り出す
  // 空の場合は null を返して呼び出し側のnullチェックを簡単にする
  pop() {
    if (this.stack.length < 1) { return null; }
    return this.stack.pop();
  }

  // 先頭要素を参照する
  // 取り出しはしないため、探索状態の確認用途で使う
  top() {
    return this.stack[this.stack.length - 1];
  }

  // 現在の要素数を返す
  // while (stack.count() > 0) のようなループ条件で使う
  count() {
    return this.stack.length;
  }

};
