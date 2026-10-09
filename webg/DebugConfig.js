// ---------------------------------------------
//  DebugConfig.js 2026/09/09
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

export default class DebugConfig {

  // `flags`を生成し、後続処理で利用できる状態にする
  static createFlags(mode) {
    if (mode === "release") {
      return {
        enableConsole: false,
        enableDiagnostics: false,
        enableProbe: false
      };
    }
    return {
      enableConsole: true,
      enableDiagnostics: true,
      enableProbe: true
    };
  }

  // WebgApp の既定値では利用者向けの画面を優先し、debug mode の場合だけ DebugDock と probe を有効にする
  static mode = "release";
  static flags = DebugConfig.createFlags("release");

  // debug / release をまとめて切り替える
  static setMode(mode = "release") {
    if (mode !== "debug" && mode !== "release") {
      throw new Error(`DebugConfig.setMode requires "debug" or "release", got "${mode}"`);
    }
    this.mode = mode;
    this.flags = this.createFlags(this.mode);
    return this.flags;
  }

  // 個別フラグだけ上書きする
  static configure(flags = {}) {
    this.flags = {
      ...this.flags,
      ...flags
    };
    return this.flags;
  }

  // 現在のモードが診断表示を有効にするdebugであることを返します
  static isDebug() {
    return this.mode === "debug";
  }

  // 現在のモードが利用者向けのreleaseであることを返します
  static isRelease() {
    return this.mode === "release";
  }

  // 指定した診断機能のflagが有効かを返し、呼出側の条件分岐を一つにそろえます
  static isEnabled(key) {
    return this.flags?.[key] === true;
  }
}
