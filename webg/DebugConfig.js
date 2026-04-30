// ---------------------------------------------
//  DebugConfig.js 2026/04/30
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

export default class DebugConfig {

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

  // WebgApp を何も指定せずに起動したときは、利用者向けの画面を優先する
  // DebugDock や probe は開発時に明示的に debug mode へ切り替えた場合だけ有効にする
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

  static isDebug() {
    return this.mode === "debug";
  }

  static isRelease() {
    return this.mode === "release";
  }

  static isEnabled(key) {
    return this.flags?.[key] === true;
  }
}
