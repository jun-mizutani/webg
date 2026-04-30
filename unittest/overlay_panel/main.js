// ---------------------------------------------
// unittest/overlay_panel/main.js  2026/04/30
//   overlay_panel unittest
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import WebgApp from "../../webg/WebgApp.js?v=20260430_overlaypanel";
import Primitive from "../../webg/Primitive.js?v=20260430_overlaypanel";
import Shape from "../../webg/Shape.js?v=20260430_overlaypanel";

// webg クラスの役割:
// WebgApp     : Screen / camera / input / HUD / OverlayPanel facade をまとめて初期化する
// OverlayPanel: DOM panel の配置、collapse、pre、buttons、choices を 1 つの基盤で扱う
// Shape       : panel が scene をどの程度隠すかを見るための回転 cube を描く

const statusEl = document.getElementById("status");
const ANCHOR_ORDER = [
  "top-left",
  "top-center",
  "top-right",
  "middle-left",
  "middle-center",
  "middle-right",
  "bottom-left",
  "bottom-center",
  "bottom-right"
];

let app = null;
let orbit = null;
let cubeNode = null;
let anchorIndex = 0;
let actionLog = [
  "overlay_panel unittest ready",
  "H: help collapse  L: log toggle  M: modal toggle",
  "1-9: move anchor panel  R: clear action log"
];
let autoCheckLines = [];

const wrapPanelError = (label, detail, fn) => {
  try {
    return fn();
  } catch (error) {
    throw new Error(`${label} failed (${detail}): ${error?.message ?? error}`);
  }
};

// unittest 開始時に API の前提が成立しているかを軽く確認し、
// 失敗した場合は visual phase へ進む前に status へ残す
const runAutoChecks = () => {
  const lines = [];
  const check = (label, condition, detail = "") => {
    lines.push(`${condition ? "PASS" : "FAIL"} ${label}${detail ? `: ${detail}` : ""}`);
  };
  check("showOverlayPanel exists", typeof app.showOverlayPanel === "function");
  check("updateOverlayPanel exists", typeof app.updateOverlayPanel === "function");
  check("hideOverlayPanel exists", typeof app.hideOverlayPanel === "function");
  check("buildHelpPanelOptions exists", typeof app.buildHelpPanelOptions === "function");
  try {
    app.showOverlayPanel({
      id: "invalid-both",
      text: "x",
      lines: ["y"]
    });
    check("text and lines conflict throws", false);
  } catch (error) {
    check("text and lines conflict throws", /both text and lines/.test(error.message), error.message);
  }
  try {
    app.showOverlayPanel({
      id: "invalid-anchor",
      text: "x",
      anchor: "left"
    });
    check("invalid anchor throws", false);
  } catch (error) {
    check("invalid anchor throws", /anchor/.test(error.message), error.message);
  }
  autoCheckLines = lines;
};

// status は auto check、現在の anchor、modal 状態、最後の action を 1 か所へまとめる
// DOM panel 自体が邪魔になる場面でも、最小の数値確認は左上から追えるようにする
const writeStatus = () => {
  const helpPanel = app.getOverlayPanel("overlay-help");
  const logPanel = app.getOverlayPanel("overlay-log");
  const modalPanel = app.getOverlayPanel("overlay-modal");
  const anchorPanel = app.getOverlayPanel("overlay-anchor");
  statusEl.textContent = [
    "unittest/overlay_panel",
    "",
    ...autoCheckLines,
    "",
    `anchor=${ANCHOR_ORDER[anchorIndex]}`,
    `help.collapsed=${helpPanel?.getState?.().collapsed === true ? "yes" : "no"}`,
    `log.visible=${logPanel?.getState?.().visible === true ? "yes" : "no"}`,
    `modal.visible=${modalPanel?.getState?.().visible === true ? "yes" : "no"}`,
    `modal.pauseScene=${modalPanel?.getState?.().pauseScene === true ? "yes" : "no"}`,
    `anchor.panel.visible=${anchorPanel?.getState?.().visible === true ? "yes" : "no"}`,
    "",
    "latest actions:",
    ...actionLog.slice(-7)
  ].join("\n");
};

// action log は panel button / choice / key command が同じ経路で届いたかを
// 時系列で見返すために 1 行ずつ積む
const pushActionLog = (line) => {
  actionLog.push(line);
  if (actionLog.length > 20) {
    actionLog = actionLog.slice(actionLog.length - 20);
  }
};

// 9 方向 anchor を同じ panel へ順番に適用し、
// 3D scene のどこが最も邪魔になりにくいかを見比べやすくする
const applyAnchorIndex = (index) => {
  anchorIndex = Math.max(0, Math.min(ANCHOR_ORDER.length - 1, index));
  const anchor = ANCHOR_ORDER[anchorIndex];
  app.updateOverlayPanel("overlay-anchor", {
    title: `Anchor: ${anchor}`,
    lines: [
      `anchor = ${anchor}`,
      "1-9 で 9 方向へ移動",
      "right anchor は debug dock を避ける"
    ],
    anchor
  });
};

// help panel は preset helper を通し、
// 折りたたみと再表示だけをシンプルに確認できる形へする
const createHelpPanel = () => {
  const options = app.buildHelpPanelOptions({
    id: "overlay-help",
    title: "Help",
    lines: [
      "Drag / Arrow: orbit camera",
      "[ / ] or wheel: zoom",
      "1-9: move anchor panel",
      "H: collapse help",
      "L: toggle pre log",
      "M: toggle modal panel",
      "F9 then M: debug mode"
    ],
    anchor: "top-left"
  });
  wrapPanelError("createHelpPanel", `anchor=${options.anchor}`, () => {
    app.showOverlayPanel(options);
  });
};

// pre panel は長文、scroll、close をまとめて確認する
// log 文字列を増やし、縦スクロールが必要な状態を最初から作っておく
const createLogPanel = () => {
  const bodyLines = [
    "OverlayPanel log preview",
    "",
    ...new Array(18).fill(0).map((_, index) => `line ${String(index + 1).padStart(2, "0")}  action flow / diagnostics preview`)
  ];
  const options = {
    id: "overlay-log",
    title: "pre + scroll log",
    lines: bodyLines,
    format: "pre",
    anchor: "bottom-right",
    scrollY: true,
    closable: true,
    showCloseButton: true,
    maxHeight: "32vh"
  };
  wrapPanelError("createLogPanel", `anchor=${options.anchor}`, () => {
    app.showOverlayPanel(options);
  });
};

// modal panel は pauseScene を持つが、自動停止はまだ入れず、
// test 側で state を見て回転を止める構成にする
const createModalPanel = () => {
  const options = {
    id: "overlay-modal",
    title: "Modal briefing",
    lines: [
      "この panel は modal=true / pauseScene=true の組み合わせです",
      "scene を自動停止するのではなく、test 側が state を読んで回転を止めています",
      "Enter で defaultAction の next が発火します"
    ],
    anchor: "middle-center",
    width: 420,
    modal: true,
    pauseScene: true,
    closable: true,
    showCloseButton: true,
    buttons: [
      { id: "next", label: "Next", kind: "primary" },
      { id: "dismiss", label: "Dismiss", kind: "secondary" }
    ],
    choices: [
      { id: "top-left", label: "Move Anchor Top Left" },
      { id: "bottom-right", label: "Move Anchor Bottom Right" }
    ],
    defaultAction: "next",
    onAction: ({ actionId }) => {
      pushActionLog(`modal action: ${actionId}`);
      if (actionId === "dismiss") {
        app.hideOverlayPanel("overlay-modal");
      } else if (actionId === "top-left") {
        applyAnchorIndex(0);
      } else if (actionId === "bottom-right") {
        applyAnchorIndex(8);
      }
    }
  };
  wrapPanelError("createModalPanel", `anchor=${options.anchor}`, () => {
    app.showOverlayPanel(options);
  });
};

// anchor panel は小さめの plain panel として出し、
// 配置確認だけに集中できるよう内容は最小にする
const createAnchorPanel = () => {
  const options = {
    id: "overlay-anchor",
    title: "Anchor",
    lines: [],
    format: "plain",
    anchor: "top-right",
    width: 260
  };
  wrapPanelError("createAnchorPanel", `anchor=${options.anchor}`, () => {
    app.showOverlayPanel(options);
  });
  applyAnchorIndex(anchorIndex);
};

// action key は panel button と同じくらい素早く試したいので、
// 新 API の panel 組み合わせに対する操作入口をここへまとめる
const handleActions = () => {
  for (let i = 0; i < ANCHOR_ORDER.length; i++) {
    if (app.wasActionPressed(`anchor${i + 1}`)) {
      applyAnchorIndex(i);
      pushActionLog(`anchor -> ${ANCHOR_ORDER[i]}`);
    }
  }
  if (app.wasActionPressed("toggleHelp")) {
    const helpPanel = app.getOverlayPanel("overlay-help");
    app.setHelpPanelVisible(helpPanel, helpPanel?.getState?.().collapsed === true);
    pushActionLog("help collapse toggled");
  }
  if (app.wasActionPressed("toggleLog")) {
    if (app.hasOverlayPanel("overlay-log")) {
      app.removeOverlayPanel("overlay-log");
      pushActionLog("log panel removed");
    } else {
      createLogPanel();
      pushActionLog("log panel created");
    }
  }
  if (app.wasActionPressed("toggleModal")) {
    const modalPanel = app.getOverlayPanel("overlay-modal");
    if (modalPanel?.getState?.().visible === true) {
      app.hideOverlayPanel("overlay-modal");
      pushActionLog("modal hidden");
    } else {
      if (!modalPanel) {
        createModalPanel();
      } else {
        modalPanel.show();
      }
      pushActionLog("modal shown");
    }
  }
  if (app.wasActionPressed("resetLog")) {
    actionLog = ["action log reset"];
  }
};

const start = async () => {
  app = new WebgApp({
    document,
    clearColor: [0.06, 0.08, 0.12, 1.0],
    messageFontTexture: "../../webg/font512.png",
    debugTools: {
      mode: "release",
      system: "overlay_panel",
      source: "unittest/overlay_panel/main.js"
    },
    camera: {
      target: [0.0, 0.8, 0.0],
      distance: 8.5,
      yaw: 24.0,
      pitch: -14.0
    }
  });
  await app.init();

  orbit = app.createOrbitEyeRig({
    target: [0.0, 0.8, 0.0],
    distance: 8.5,
    yaw: 24.0,
    pitch: -14.0,
    minDistance: 4.0,
    maxDistance: 18.0
  });

  const cubeShape = new Shape(app.getGL());
  cubeShape.applyPrimitiveAsset(Primitive.cube(2.0, cubeShape.getPrimitiveOptions()));
  cubeShape.endShape();
  cubeShape.setMaterial("smooth-shader", {
    has_bone: 0,
    use_texture: 0,
    color: [0.90, 0.56, 0.38, 1.0],
    ambient: 0.24,
    specular: 0.88,
    power: 48.0
  });
  cubeNode = app.space.addNode(null, "overlayPanelCube");
  cubeNode.addShape(cubeShape);

  app.registerActionMap({
    anchor1: ["1", "numpad1"],
    anchor2: ["2", "numpad2"],
    anchor3: ["3", "numpad3"],
    anchor4: ["4", "numpad4"],
    anchor5: ["5", "numpad5"],
    anchor6: ["6", "numpad6"],
    anchor7: ["7", "numpad7"],
    anchor8: ["8", "numpad8"],
    anchor9: ["9", "numpad9"],
    toggleHelp: ["h"],
    toggleLog: ["l"],
    toggleModal: ["m"],
    resetLog: ["r"]
  });

  runAutoChecks();
  createHelpPanel();
  createLogPanel();
  createAnchorPanel();
  createModalPanel();
  app.hideOverlayPanel("overlay-modal");

  app.message.setLines("guide", [
    "overlay_panel unittest",
    "1-9: move anchor panel",
    "H/L/M/R: panel operations",
    "F9 then M: debug dock check"
  ], {
    anchor: "bottom-left",
    x: 2,
    y: -2,
    width: 34,
    wrap: true
  });

  app.message.setLines("status", [
    "OverlayPanel facade ready",
    "plain / pre / modal / choices / collapse"
  ], {
    anchor: "top-left",
    x: 2,
    y: 8
  });

  app.start({
    onUpdate: ({ deltaSec }) => {
      orbit.update(deltaSec);
      handleActions();
      const modalState = app.getOverlayPanel("overlay-modal")?.getState?.();
      if (modalState?.visible === true && modalState.pauseScene === true) {
        cubeNode.rotateY(0.0);
      } else {
        cubeNode.rotateY(0.8 * deltaSec);
        cubeNode.rotateX(0.3 * deltaSec);
      }
      writeStatus();
      return false;
    }
  });
};

document.addEventListener("DOMContentLoaded", () => {
  start().catch((error) => {
    console.error(error);
    statusEl.textContent = `start failed:\n${error?.message ?? error}`;
  });
});
