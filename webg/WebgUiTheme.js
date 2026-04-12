// ---------------------------------------------
// WebgUiTheme.js 2026/04/12
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// Webg が出す HTML UI を大きく 3 種へ分けて既定テーマを持つ:
// - debugDock: desktop 向けの固定 dock
// - fixedFormatPanel: error / diagnostics の固定パネル
// - uiPanel: sample や app が canvas 外の DOM を使って scene 上へ重ねる軽量 panel
// まず dark preset を既定とし、light preset は別 export で並べて持つ
export const DEFAULT_UI_THEME = {
  debugDock: {
    rootBackground: "rgba(26, 26, 38, 0.96)",
    rootBorder: "1px solid rgba(180, 208, 255, 0.12)",
    rootText: "#d9e7ff",
    titleText: "#f4f7ff",
    hintText: "#9db2d8",
    buttonBorder: "1px solid rgba(182, 205, 255, 0.16)",
    buttonBackground: "rgba(42, 42, 60, 0.96)",
    buttonText: "#eef4ff",
    diagnosticsAccent: "#8ea7d8",
    dockAccent: "#d7b27f",
    sectionHeadingText: "#8ea7d8",
    sectionBackground: "rgba(32, 32, 48, 0.94)",
    sectionBorder: "1px solid rgba(167, 189, 233, 0.10)",
    sectionText: "#d9e7ff",
    dockButtonBackground: "rgba(66, 48, 24, 0.96)",
    dockButtonBorder: "1px solid rgba(228, 189, 130, 0.22)",
    dockButtonText: "#fff1d8"
  },
  fixedFormatPanel: {
    errorText: "#ffe7e7",
    errorBackground: "rgba(38, 26, 34, 0.92)"
  },
  uiPanel: {
    panelBackground: "rgba(26, 26, 38, 0.22)",
    panelBorder: "rgba(182, 208, 255, 0.10)",
    panelShadow: "0 12px 28px rgba(0, 0, 0, 0.14)",
    statusBackground: "rgba(26, 26, 38, 0.22)",
    textBlockBackground: "rgba(26, 26, 38, 0.16)",
    textMain: "#eef5ff",
    textSub: "#adc3e8",
    accentText: "#ffe3b4",
    accentBackground: "rgba(255, 210, 138, 0.08)",
    buttonBackground: "rgba(42, 42, 62, 0.32)",
    buttonHoverBackground: "rgba(58, 58, 86, 0.46)",
    buttonBorder: "rgba(160, 192, 245, 0.24)",
    buttonHoverBorder: "rgba(196, 219, 255, 0.36)",
    buttonText: "#eef5ff",
    hintText: "#ffda9b",
    backdropBlur: "4px",
    statusBackdropBlur: "3px",
    panelRadius: "14px",
    buttonRadius: "10px",
    fieldRadius: "10px",
    pillRadius: "999px",
    panelPadding: "14px 15px",
    statusPadding: "7px 10px"
  }
};

// 明るい editor / tool 画面でも使いやすい light preset:
// - section 構造や色役割は dark preset とそろえ、
// - 差し替え時に key 名を意識せず丸ごと入れ替えられる形にする
export const DEFAULT_UI_LIGHT_THEME = {
  debugDock: {
    rootBackground: "rgba(248, 250, 255, 0.96)",
    rootBorder: "1px solid rgba(116, 138, 176, 0.18)",
    rootText: "#24344f",
    titleText: "#18263e",
    hintText: "#5e7398",
    buttonBorder: "1px solid rgba(118, 144, 192, 0.24)",
    buttonBackground: "rgba(226, 235, 250, 0.98)",
    buttonText: "#203251",
    diagnosticsAccent: "#5472a8",
    dockAccent: "#9b6d2d",
    sectionHeadingText: "#5472a8",
    sectionBackground: "rgba(255, 255, 255, 0.94)",
    sectionBorder: "1px solid rgba(149, 171, 210, 0.18)",
    sectionText: "#24344f",
    dockButtonBackground: "rgba(246, 233, 211, 0.98)",
    dockButtonBorder: "1px solid rgba(206, 170, 112, 0.28)",
    dockButtonText: "#5e4318"
  },
  fixedFormatPanel: {
    errorText: "#7c1f2c",
    errorBackground: "rgba(255, 240, 243, 0.96)"
  },
  uiPanel: {
    panelBackground: "rgba(252, 253, 255, 0.52)",
    panelBorder: "rgba(126, 148, 186, 0.20)",
    panelShadow: "0 12px 28px rgba(44, 64, 98, 0.12)",
    statusBackground: "rgba(252, 253, 255, 0.46)",
    textBlockBackground: "rgba(255, 255, 255, 0.14)",
    textMain: "#203251",
    textSub: "#5d7297",
    accentText: "#8c5f1f",
    accentBackground: "rgba(241, 206, 151, 0.16)",
    buttonBackground: "rgba(229, 238, 252, 0.62)",
    buttonHoverBackground: "rgba(211, 225, 248, 0.76)",
    buttonBorder: "rgba(127, 151, 197, 0.26)",
    buttonHoverBorder: "rgba(92, 123, 182, 0.34)",
    buttonText: "#203251",
    hintText: "#9a6726",
    backdropBlur: "4px",
    statusBackdropBlur: "3px",
    panelRadius: "14px",
    buttonRadius: "10px",
    fieldRadius: "10px",
    pillRadius: "999px",
    panelPadding: "14px 15px",
    statusPadding: "7px 10px"
  }
};

// warm dark preset:
// - editor や tool で強い accent を付けたい時向け
// - default dark より copper / amber 寄りに振り、button 群の差を見分けやすくする
export const DEFAULT_UI_SUNSET_THEME = {
  debugDock: {
    rootBackground: "rgba(22, 13, 12, 0.96)",
    rootBorder: "1px solid rgba(255, 182, 136, 0.16)",
    rootText: "#ffe9d6",
    titleText: "#fff6ec",
    hintText: "#e3b895",
    buttonBorder: "1px solid rgba(243, 175, 126, 0.22)",
    buttonBackground: "rgba(74, 38, 25, 0.94)",
    buttonText: "#fff2e4",
    diagnosticsAccent: "#ffb47a",
    dockAccent: "#ffd98a",
    sectionHeadingText: "#ffb47a",
    sectionBackground: "rgba(44, 24, 20, 0.92)",
    sectionBorder: "1px solid rgba(239, 167, 114, 0.16)",
    sectionText: "#ffe9d6",
    dockButtonBackground: "rgba(96, 54, 22, 0.96)",
    dockButtonBorder: "1px solid rgba(255, 210, 120, 0.26)",
    dockButtonText: "#fff2d4"
  },
  fixedFormatPanel: {
    errorText: "#fff0e0",
    errorBackground: "rgba(74, 30, 20, 0.94)"
  },
  uiPanel: {
    panelBackground: "rgba(38, 19, 16, 0.24)",
    panelBorder: "rgba(255, 190, 138, 0.16)",
    panelShadow: "0 14px 30px rgba(0, 0, 0, 0.18)",
    statusBackground: "rgba(38, 19, 16, 0.24)",
    textBlockBackground: "rgba(0, 0, 0, 0.10)",
    textMain: "#fff4e8",
    textSub: "#f0c39f",
    accentText: "#ffe6a8",
    accentBackground: "rgba(255, 205, 120, 0.10)",
    buttonBackground: "rgba(106, 56, 32, 0.36)",
    buttonHoverBackground: "rgba(136, 74, 40, 0.52)",
    buttonBorder: "rgba(255, 196, 144, 0.26)",
    buttonHoverBorder: "rgba(255, 218, 180, 0.38)",
    buttonText: "#fff4e8",
    hintText: "#ffd38e",
    backdropBlur: "4px",
    statusBackdropBlur: "3px",
    panelRadius: "14px",
    buttonRadius: "10px",
    fieldRadius: "10px",
    pillRadius: "999px",
    panelPadding: "14px 15px",
    statusPadding: "7px 10px"
  }
};

// green / cyan 寄りの cool preset:
// - 既存 dark / light / sunset とかなり雰囲気を変え、theme 切替差が見えやすい preset とする
export const DEFAULT_UI_FOREST_THEME = {
  debugDock: {
    rootBackground: "rgba(8, 22, 20, 0.96)",
    rootBorder: "1px solid rgba(128, 220, 198, 0.16)",
    rootText: "#daf7f0",
    titleText: "#effff9",
    hintText: "#8dc8bc",
    buttonBorder: "1px solid rgba(122, 210, 191, 0.22)",
    buttonBackground: "rgba(20, 56, 52, 0.94)",
    buttonText: "#eafff9",
    diagnosticsAccent: "#72d3bf",
    dockAccent: "#c5e58f",
    sectionHeadingText: "#72d3bf",
    sectionBackground: "rgba(14, 36, 34, 0.92)",
    sectionBorder: "1px solid rgba(118, 204, 184, 0.16)",
    sectionText: "#daf7f0",
    dockButtonBackground: "rgba(42, 74, 36, 0.96)",
    dockButtonBorder: "1px solid rgba(184, 224, 136, 0.24)",
    dockButtonText: "#eefad6"
  },
  fixedFormatPanel: {
    errorText: "#eafff7",
    errorBackground: "rgba(16, 52, 44, 0.94)"
  },
  uiPanel: {
    panelBackground: "rgba(10, 28, 25, 0.24)",
    panelBorder: "rgba(133, 220, 196, 0.16)",
    panelShadow: "0 14px 30px rgba(0, 0, 0, 0.18)",
    statusBackground: "rgba(10, 28, 25, 0.24)",
    textBlockBackground: "rgba(0, 0, 0, 0.10)",
    textMain: "#ecfff9",
    textSub: "#9fd8cb",
    accentText: "#d7ef9a",
    accentBackground: "rgba(196, 232, 133, 0.10)",
    buttonBackground: "rgba(26, 72, 64, 0.34)",
    buttonHoverBackground: "rgba(40, 96, 86, 0.50)",
    buttonBorder: "rgba(132, 216, 194, 0.26)",
    buttonHoverBorder: "rgba(178, 240, 224, 0.38)",
    buttonText: "#ecfff9",
    hintText: "#d7ef9a",
    backdropBlur: "4px",
    statusBackdropBlur: "3px",
    panelRadius: "14px",
    buttonRadius: "10px",
    fieldRadius: "10px",
    pillRadius: "999px",
    panelPadding: "14px 15px",
    statusPadding: "7px 10px"
  }
};

// preset 一覧:
// - sample / unittest 側が select や button 群を組むときに 1 か所から列挙できるようにする
// - 値は UI group 一式を持つ object で、WebgApp.setUiTheme() へそのまま渡せる
export const UI_THEME_PRESETS = {
  dark: DEFAULT_UI_THEME,
  light: DEFAULT_UI_LIGHT_THEME,
  sunset: DEFAULT_UI_SUNSET_THEME,
  forest: DEFAULT_UI_FOREST_THEME
};

export function mergeUiTheme(overrides = {}) {
  // テーマは group 単位で浅く上書きできるようにし、
  // sample 側が 1 色だけ差し替えたい時でも全体を再定義しなくて済むようにする
  return {
    debugDock: {
      ...DEFAULT_UI_THEME.debugDock,
      ...(overrides.debugDock ?? {})
    },
    fixedFormatPanel: {
      ...DEFAULT_UI_THEME.fixedFormatPanel,
      ...(overrides.fixedFormatPanel ?? {})
    },
    uiPanel: {
      ...DEFAULT_UI_THEME.uiPanel,
      ...(overrides.uiPanel ?? {})
    }
  };
}
