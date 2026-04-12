// ---------------------------------------------
//  DebugConfig.js 2026/04/08
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

  static mode = "debug";
  static flags = DebugConfig.createFlags("debug");

  // debug / release をまとめて切り替える
  static setMode(mode = "debug") {
    this.mode = mode === "release" ? "release" : "debug";
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
