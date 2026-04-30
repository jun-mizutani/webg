// ---------------------------------------------
// unittest/embedded/main.js  2026/04/30
//   embedded unittest
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import WebgApp from "../../webg/WebgApp.js";
import Shape from "../../webg/Shape.js";
import Primitive from "../../webg/Primitive.js";

// この test は、`layoutMode: "embedded"` で本文へ埋め込んだ canvas と
// 各種 overlay が同じ host 要素を基準に動くかを一画面で確認する
//
// 右の status は host / canvas / help / dialogue / fixed panel / touch の
// 矩形を毎フレーム読み取り、スクロール中でも位置関係が維持されるかを示す

const statusEl = document.getElementById("status");

const dialogueEntries = [
  {
    speaker: "embedded test",
    title: "overlay follows canvas",
    lines: [
      "この dialogue は embedded host の左上へ absolute で重なります",
      "ページを上下へスクロールして、canvas と一緒に動くことを確認します"
    ]
  },
  {
    speaker: "embedded test",
    title: "help / fixed / touch",
    lines: [
      "HelpPanel、fixed panel、touch controls も同じ host を基準に配置されます",
      "status では host と各 overlay の矩形差分を数値でも追えます"
    ]
  }
];

const fixedPanelLines = [
  "embedded fixed-format panel",
  "",
  "この panel は showFixedFormatPanel() で表示しています",
  "page scroll 中も canvas host の左上基準で動くかを見ます",
  "",
  "keys",
  "  Enter/Space: next dialogue",
  "  H: help show / hide",
  "  D: dialogue show / hide",
  "  F: fixed panel show / hide",
  "  S: screenshot",
  "  R: camera reset",
  "  1/2/3: scroll top / canvas / bottom"
].join("\n");

// 長い本文の中から canvas へ戻る操作を作り、
// embedded の「文書フローの一部」という前提を手で確認しやすくする
const installScrollButtons = () => {
  const buttons = document.querySelectorAll("[data-scroll-target]");
  for (let i = 0; i < buttons.length; i++) {
    buttons[i].addEventListener("click", () => {
      const id = buttons[i].dataset.scrollTarget ?? "";
      const target = document.getElementById(id);
      target?.scrollIntoView?.({
        behavior: "smooth",
        block: "start"
      });
    });
  }
};

// 3D object は最小限の cube にとどめ、
// ここでは render 内容よりも embedded 配置の確認を優先する
const createCubeNode = (app) => {
  const shape = new Shape(app.getGL());
  shape.applyPrimitiveAsset(Primitive.cube(2.2, shape.getPrimitiveOptions()));
  shape.endShape();
  shape.setMaterial("smooth-shader", {
    has_bone: 0,
    use_texture: 0,
    color: [0.22, 0.68, 0.98, 1.0],
    ambient: 0.28,
    specular: 0.82,
    power: 54.0,
    emissive: 0.0
  });

  const node = app.space.addNode(null, "embeddedCube");
  node.setPosition(0.0, 0.0, 0.0);
  node.addShape(shape);
  return node;
};

// orbit camera は pointer drag と touch での見え方確認にも使う
// camera 初期値は user/WebApp01.html に寄せ、教材ページの試し方と近い状態にする
const createOrbitRig = (app) => {
  const orbit = app.createOrbitEyeRig({
    target: [0.0, 0.0, 0.0],
    distance: 8.0,
    yaw: 0.0,
    pitch: 0.0
  });
  return orbit;
};

// dialogue の表示開始は 1 か所へまとめ、再表示時も同じ entry 列を使う
// これにより toggle 時の見え方差分が overlay 配置だけに絞られる
const showDialogue = (app) => {
  app.startDialogue(dialogueEntries, {
    title: "embedded dialogue test",
    footer: "Enter / Space: next  D: close  2: jump to canvas",
    showRestartButton: false,
    showHideButton: true
  });
};

// fixed-format panel は表示中 node を state に保持し、
// status が geometry を直接読めるようにする
const showFixedPanel = (app, state) => {
  state.fixedPanelNode = app.showFixedFormatPanel(fixedPanelLines, {
    id: "embeddedInfo",
    top: 16,
    left: 16,
    right: 16,
    maxHeight: "calc(100% - 32px)"
  });
  state.fixedPanelVisible = true;
};

// fixed panel は `show` / `clear` を交互に使い、
// host 基準の absolute overlay が片付くかも合わせて確認する
const toggleFixedPanel = (app, state) => {
  if (app.hasFixedFormatPanel("embeddedInfo")) {
    app.clearFixedFormatPanel("embeddedInfo");
    state.fixedPanelVisible = false;
    return false;
  }
  showFixedPanel(app, state);
  return true;
};

// help panel は標準の show / hide button と keyboard toggle の両方を残し、
// 畳んだ状態で panel 幅が内容幅へ寄るかを確かめやすくする
const toggleHelpPanel = (app, helpPanel) => {
  return app.setHelpPanelVisible(helpPanel, !helpPanel.visible);
};

// camera reset は orbit state と回転位相の両方を初期値へ戻し、
// 同じ見え方から何度でも再確認できるようにする
const resetSceneState = (app, orbit, state) => {
  orbit.orbit.target[0] = 0.0;
  orbit.orbit.target[1] = 0.0;
  orbit.orbit.target[2] = 0.0;
  orbit.orbit.distance = 8.0;
  orbit.orbit.yaw = 0.0;
  orbit.orbit.pitch = 0.0;
  orbit.apply(true);
  state.spinPhase = 0.0;
  app.pushToast("camera reset", {
    duration: 1.0
  });
};

// scroll helper は keyboard / button の両方から使う
// canvas のある位置と末尾位置をすぐ切り替えられるようにする
const scrollToId = (id) => {
  const node = document.getElementById(id);
  node?.scrollIntoView?.({
    behavior: "smooth",
    block: "start"
  });
};

// host と overlay の整列状態を判定しやすいよう、
// 相対位置のずれを数値と PASS / FAIL へまとめる
const evaluateOverlayAlignment = (label, rect, hostRect, options = {}) => {
  if (!rect || rect.width <= 0 || rect.height <= 0) {
    return `${label}: WAIT hidden`;
  }
  const tolerance = Number.isFinite(options.tolerance) ? options.tolerance : 18;
  const bottomTolerance = Number.isFinite(options.bottomTolerance) ? options.bottomTolerance : tolerance;
  const leftDelta = Math.round(rect.left - hostRect.left);
  const rightDelta = Math.round(hostRect.right - rect.right);
  const topDelta = Math.round(rect.top - hostRect.top);
  const bottomDelta = Math.round(hostRect.bottom - rect.bottom);
  const pass =
    leftDelta >= -tolerance
    && rightDelta >= -tolerance
    && topDelta >= -tolerance
    && bottomDelta >= -bottomTolerance;
  return `${label}: ${pass ? "PASS" : "FAIL"} L=${leftDelta} T=${topDelta} R=${rightDelta} B=${bottomDelta}`;
};

// touch controls は host 下端へ張り付くことが重要なので、
// 上下左右を別判定にせず「下端が host 下端に近いか」を強めに見る
const evaluateTouchAlignment = (touchRect, hostRect) => {
  if (!touchRect || touchRect.width <= 0 || touchRect.height <= 0) {
    return "touch: WAIT hidden";
  }
  const leftDelta = Math.round(touchRect.left - hostRect.left);
  const rightDelta = Math.round(hostRect.right - touchRect.right);
  const bottomDelta = Math.round(hostRect.bottom - touchRect.bottom);
  const pass =
    leftDelta >= -18
    && rightDelta >= -18
    && Math.abs(bottomDelta) <= 18;
  return `touch: ${pass ? "PASS" : "FAIL"} L=${leftDelta} R=${rightDelta} B=${bottomDelta}`;
};

// canvas host と canvas 自体の display size が一致しているかを見て、
// embedded 用 host の幅高さ同期が崩れていないかを確認する
const evaluateCanvasHost = (canvasRect, hostRect) => {
  const widthDelta = Math.round(hostRect.width - canvasRect.width);
  const heightDelta = Math.round(hostRect.height - canvasRect.height);
  const pass = Math.abs(widthDelta) <= 1 && Math.abs(heightDelta) <= 1;
  return `canvas-host: ${pass ? "PASS" : "FAIL"} dW=${widthDelta} dH=${heightDelta}`;
};

// 外側の status は page 固定ではなく本文の aside に置き、
// 現在の scroll 量と overlay の相対位置をまとめて読む用途に使う
const updateExternalStatus = (app, helpPanel, state) => {
  const canvas = app.screen?.canvas ?? null;
  const host = canvas?.parentElement ?? null;
  if (!statusEl || !canvas || !host) {
    return;
  }

  const hostRect = host.getBoundingClientRect();
  const canvasRect = canvas.getBoundingClientRect();
  const helpRect = helpPanel?.panel?.getBoundingClientRect?.() ?? null;
  const dialogueRect = app.dialogue?.layout?.root?.hidden === true
    ? null
    : app.dialogue?.layout?.root?.getBoundingClientRect?.() ?? null;
  const fixedRect = state.fixedPanelNode?.isConnected
    ? state.fixedPanelNode.getBoundingClientRect()
    : null;
  const touchRect = app.input?.touch?.root?.getBoundingClientRect?.() ?? null;
  const dialogueState = app.getDialogueState();

  statusEl.textContent = [
    "unittest/embedded",
    `scrollY: ${Math.round(window.scrollY)}`,
    `canvasTop: ${Math.round(canvasRect.top)} canvasLeft: ${Math.round(canvasRect.left)}`,
    `hostTop: ${Math.round(hostRect.top)} hostHeight: ${Math.round(hostRect.height)}`,
    evaluateCanvasHost(canvasRect, hostRect),
    evaluateOverlayAlignment("help", helpRect, hostRect, {
      tolerance: 20
    }),
    evaluateOverlayAlignment("dialogue", dialogueRect, hostRect, {
      tolerance: 20
    }),
    evaluateOverlayAlignment("fixed", fixedRect, hostRect, {
      tolerance: 20
    }),
    evaluateTouchAlignment(touchRect, hostRect),
    `helpVisible: ${helpPanel?.visible ? "yes" : "no"}`,
    `dialogueActive: ${dialogueState?.active ? "yes" : "no"}`,
    `fixedVisible: ${state.fixedPanelVisible ? "yes" : "no"}`,
    `touchVisible: ${app.input?.touch?.root ? "yes" : "no"}`,
    `lastShot: ${state.lastScreenshot || "-"}`,
    "keys: H help  D dialogue  F fixed  S shot  R reset  1/2/3 scroll"
  ].join("\n");
};

// onUpdate から呼ぶ操作処理を 1 本へまとめる
// ここを分けることで、描画更新と入力 edge 処理を追いやすくする
const handleFrameActions = (app, helpPanel, orbit, state) => {
  if (app.wasActionPressed("next_dialogue") && app.getDialogueState()?.active) {
    app.nextDialogue();
  }
  if (app.wasActionPressed("toggle_help")) {
    toggleHelpPanel(app, helpPanel);
  }
  if (app.wasActionPressed("toggle_dialogue")) {
    if (app.getDialogueState()?.active) {
      app.clearDialogue();
    } else {
      showDialogue(app);
    }
  }
  if (app.wasActionPressed("toggle_fixed")) {
    toggleFixedPanel(app, state);
  }
  if (app.wasActionPressed("capture")) {
    state.lastScreenshot = app.takeScreenshot({
      prefix: "embedded_test"
    });
    app.pushToast(`saved ${state.lastScreenshot}`, {
      duration: 1.2
    });
  }
  if (app.wasActionPressed("reset")) {
    resetSceneState(app, orbit, state);
  }
  if (app.wasActionPressed("scroll_top")) {
    scrollToId("pageTop");
  }
  if (app.wasActionPressed("scroll_demo")) {
    scrollToId("demoArea");
  }
  if (app.wasActionPressed("scroll_bottom")) {
    scrollToId("pageBottom");
  }
};

// 入力と touch を同じ action 名へまとめることで、
// embedded でも keyboard / touch の両方で同じ操作確認を行える
const installActionBindings = (app) => {
  app.registerActionMap({
    next_dialogue: ["enter", "space"],
    toggle_help: ["h"],
    toggle_dialogue: ["d"],
    toggle_fixed: ["f"],
    capture: ["s"],
    reset: ["r"],
    scroll_top: ["1"],
    scroll_demo: ["2"],
    scroll_bottom: ["3"]
  });

  app.input.installTouchControls({
    touchDeviceOnly: false,
    groups: [
      {
        id: "orbit",
        buttons: [
          { key: "arrowleft", label: "\u2190", kind: "hold", ariaLabel: "rotate left" },
          { key: "arrowright", label: "\u2192", kind: "hold", ariaLabel: "rotate right" }
        ]
      },
      {
        id: "overlay",
        buttons: [
          { key: "enter", label: ">", kind: "action", ariaLabel: "next dialogue" },
          { key: "h", label: "H", kind: "action", ariaLabel: "toggle help" },
          { key: "d", label: "D", kind: "action", ariaLabel: "toggle dialogue" },
          { key: "f", label: "F", kind: "action", ariaLabel: "toggle fixed panel" }
        ]
      },
      {
        id: "capture",
        buttons: [
          { key: "s", label: "S", kind: "action", ariaLabel: "take screenshot" },
          { key: "r", label: "R", kind: "action", ariaLabel: "reset camera" }
        ]
      }
    ]
  });
};

// 外部 status と canvas 内 HUD の両方を更新し、
// page 側と canvas 側のどちらから見ても test 状態が分かるようにする
const updateHud = (app, helpPanel, state) => {
  app.setGuideLines([
    "embedded unittest",
    "mouse drag: orbit",
    "Enter/Space: next dialogue",
    "H: help  D: dialogue  F: fixed  S: screenshot",
    "R: reset  1/2/3: scroll top/canvas/bottom"
  ], {
    x: 0,
    y: 0,
    color: [0.90, 0.95, 1.0]
  });

  app.setStatusLines([
    `help=${helpPanel.visible ? "show" : "hide"}`,
    `dialogue=${app.getDialogueState()?.active ? "show" : "hide"}`,
    `fixed=${state.fixedPanelVisible ? "show" : "hide"}`,
    `scrollY=${Math.round(window.scrollY)}`
  ], {
    x: 0,
    y: 5,
    color: [1.0, 0.88, 0.72]
  });
};

const start = async () => {
  installScrollButtons();

  const app = new WebgApp({
    document,
    messageFontTexture: "../../webg/font512.png",
    clearColor: [0.1, 0.15, 0.1, 1.0],
    layoutMode: "embedded",
    fixedCanvasSize: {
      width: 720,
      height: 540,
      useDevicePixelRatio: false
    },
    debugTools: {
      mode: "release",
      system: "embedded",
      source: "unittest/embedded/main.js"
    },
    camera: {
      target: [0.0, 0.0, 0.0],
      distance: 8.0,
      yaw: 0.0,
      pitch: 0.0
    }
  });
  await app.init();

  const cubeNode = createCubeNode(app);
  const orbit = createOrbitRig(app);
  const helpPanel = app.createHelpPanel({
    id: "embeddedHelp",
    leftWidth: "minmax(0, 320px)",
    lines: [
      "mouse drag: orbit",
      "touch left / right: rotate phase",
      "H: help show / hide",
      "D: dialogue show / hide",
      "F: fixed panel show / hide",
      "S: screenshot",
      "R: camera reset",
      "1 / 2 / 3: scroll top / canvas / bottom"
    ]
  });

  installActionBindings(app);

  const state = {
    spinPhase: 0.0,
    fixedPanelVisible: false,
    fixedPanelNode: null,
    lastScreenshot: ""
  };

  showDialogue(app);
  showFixedPanel(app, state);

  app.start({
    onUpdate: ({ deltaSec }) => {
      orbit.update(deltaSec);
      handleFrameActions(app, helpPanel, orbit, state);

      // 左右 hold は orbit camera と別に cube の位相だけへ足し、
      // touch controls が embedded host 下端に残りつつ入力も通るかを見る
      if (app.input.has("arrowleft")) {
        state.spinPhase += deltaSec * 1.8;
      }
      if (app.input.has("arrowright")) {
        state.spinPhase -= deltaSec * 1.8;
      }

      cubeNode.rotateY(0.9 + state.spinPhase * 0.02);
      cubeNode.rotateX(0.35);
      updateHud(app, helpPanel, state);
      updateExternalStatus(app, helpPanel, state);
      return false;
    }
  });
};

document.addEventListener("DOMContentLoaded", () => {
  start().catch((err) => {
    console.error(err);
    if (statusEl) {
      statusEl.textContent = `start failed:\n${err?.message ?? err}`;
    }
  });
});
