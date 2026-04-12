// -------------------------------------------------
// circular_breaker sample
//   inputConfig.js 2026/03/26
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// -------------------------------------------------

import Diagnostics from "../../webg/Diagnostics.js";
import DebugConfig from "../../webg/DebugConfig.js";

// この file は main.js から action map、touch layout、debug handler 表を受け取るために使う
// gameplay 操作と debug 操作の binding を 1 箇所で定義し、
// main.js では「どの action を読むか」だけ見えるようにする

export const cbTouchStyleId = "cb-touch-layout-style";

export const CONTROL_ACTION_MAP = {
  // touch hold と keyboard を同じ action へ寄せるため、
  // action 名自身も binding に含めて仮想ボタンから直接発火できるようにする
  rotate_left: ["rotate_left", "a"],
  rotate_right: ["rotate_right", "d"],
  move_left: ["move_left", "arrowleft"],
  move_right: ["move_right", "arrowright"],
  start: ["start", "enter", "space"],
  pause: ["pause", "k"],
  reset: ["reset", "r"]
};

export const DEBUG_ACTION_MAP = {
  screenshot: ["p"],
  force_end: ["o"],
  probe_text: ["q"],
  probe_json: ["w"],
  copy_text: ["c"],
  copy_json: ["v"],
  log_text: ["j"],
  log_json: ["l"],
  save_text: ["f"],
  save_json: ["g"],
  toggle_debug: ["m"]
};

export const ACTION_MAP = {
  ...CONTROL_ACTION_MAP,
  ...DEBUG_ACTION_MAP
};

// circular_breaker 専用の touch button 配置 CSS を 1 回だけ注入する
// PC debug でも同じ並びを確認できるよう、sample 起動時に毎回この helper を通す
export const installTouchLayoutStyle = (doc) => {
  if (doc.getElementById(cbTouchStyleId)) return;
  const style = doc.createElement("style");
  style.id = cbTouchStyleId;
  style.textContent = `
    .webg-touch-root.cb-touch-root {
      justify-content: space-between;
    }
    .webg-touch-root.cb-touch-root.webg-touch-multiline {
      justify-content: center;
    }
  `;
  doc.head.appendChild(style);
};

// debug 系は keyboard の one-shot action として扱い、
// main loop から「押された action の handler 表」を読む形へ寄せる
// これにより raw key の長い switch を main.js から外しやすくする
export const createDebugActionHandlers = ({
  runtime,
  input,
  createDiagnosticsReport,
  requestProbe,
  setDiagnosticsCopyState,
  diagTextFile,
  diagJsonFile
}) => ({
  screenshot: () => {
    runtime.takeScreenshot();
  },
  force_end: () => {
    runtime.endGame("FORCED END");
    input.clear();
  },
  probe_text: () => {
    requestProbe("text", 1);
  },
  probe_json: () => {
    requestProbe("json", 1);
  },
  copy_text: async () => {
    const copied = await Diagnostics.copyText(createDiagnosticsReport("runtime"));
    setDiagnosticsCopyState(copied ? "TEXT COPIED" : "TEXT COPY FAILED");
  },
  copy_json: async () => {
    const copied = await Diagnostics.copyJSON(createDiagnosticsReport("runtime"));
    setDiagnosticsCopyState(copied ? "JSON COPIED" : "JSON COPY FAILED");
  },
  log_text: () => {
    const text = Diagnostics.toText(createDiagnosticsReport("runtime"));
    if (DebugConfig.isEnabled("enableConsole")) {
      console.log(text);
      setDiagnosticsCopyState("TEXT LOGGED");
    } else {
      setDiagnosticsCopyState("TEXT LOG DISABLED");
    }
  },
  log_json: () => {
    const text = Diagnostics.toJSON(createDiagnosticsReport("runtime"));
    if (DebugConfig.isEnabled("enableConsole")) {
      console.log(text);
      setDiagnosticsCopyState("JSON LOGGED");
    } else {
      setDiagnosticsCopyState("JSON LOG DISABLED");
    }
  },
  save_text: () => {
    Diagnostics.downloadText(createDiagnosticsReport("runtime"), diagTextFile);
    setDiagnosticsCopyState(`TEXT SAVED ${diagTextFile}`);
  },
  save_json: () => {
    Diagnostics.downloadJSON(createDiagnosticsReport("runtime"), diagJsonFile);
    setDiagnosticsCopyState(`JSON SAVED ${diagJsonFile}`);
  },
  toggle_debug: () => {
    DebugConfig.setMode(DebugConfig.isRelease() ? "debug" : "release");
    setDiagnosticsCopyState(DebugConfig.mode === "debug" ? "MODE DEBUG" : "MODE RELEASE");
  }
});

// action map に登録した handler 表を 1 frame 分だけ実行する
// async handler も受けられるよう Promise 化し、loop 本体は await せず進める
export const runPressedActionHandlers = (app, handlers, logLabel = "circular_breaker debug action") => {
  const actionNames = Object.keys(handlers ?? {});
  for (let i = 0; i < actionNames.length; i++) {
    const action = actionNames[i];
    if (!app.wasActionPressed(action)) continue;
    Promise.resolve(handlers[action]()).catch((error) => {
      console.error(`${logLabel} failed: ${action}`, error);
    });
  }
};

export default ACTION_MAP;
