// ---------------------------------------------
// unittest/dialogue/main.js  2026/03/26
//   dialogue unittest
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import WebgApp from "../../webg/WebgApp.js";

// webgクラスの役割:
// WebgApp : Screen / camera / input / HUD / Dialogue overlay をまとめて初期化する
// Dialogue: 会話や tutorial の進行を queue と choice で DOM overlay に流す

const story = [
  {
    speaker: "案内",
    lines: [
      "DialogueOverlay は DOM overlay で会話を表示します。",
      "日本語の文章をそのまま出せるかを確認します。"
    ]
  },
  {
    speaker: "案内",
    lines: [
      "Enter か Space で 1 行ずつ進めます。",
      "この流れは tutorial の雛形として使えます。"
    ]
  },
  {
    speaker: "案内",
    lines: [
      "分岐を選んで、追加の文が差し込まれるかを試します。",
      "ボタンとキーボードの両方で選べるようにしています。"
    ],
    choices: [
      {
        label: "左の道",
        next: [
          {
            speaker: "案内",
            lines: [
              "左の道を選びました。",
              "DOM overlay のまま branch を追えることを確認します。"
            ]
          }
        ]
      },
      {
        label: "右の道",
        next: [
          {
            speaker: "案内",
            lines: [
              "右の道を選びました。",
              "同じ進行モデルを別の tutorial にも使えます。"
            ]
          }
        ]
      }
    ]
  },
  {
    speaker: "案内",
    lines: [
      "これで一巡です。",
      "R で最初からやり直せます。"
    ]
  }
];

const startStory = (app) => {
  // 会話を最初から組み直し、同じ story を何度でも再生できるようにする
  app.startDialogue(story, {
    title: "Dialogue overlay test",
    footer: "Enter: next  1/2: choose  R: restart"
  });
};

const writeStatus = (statusEl, app) => {
  const state = app.getDialogueState();
  const current = state?.current ?? null;
  statusEl.textContent = [
    "unittest/dialogue",
    `active: ${state?.active ? "yes" : "no"}`,
    `step: ${state ? `${Math.max(0, state.index + 1)}/${state.size}` : "0/0"}`,
    `choices: ${current?.choiceCount ?? 0}`,
    `choice: ${state?.lastChoiceLabel || "-"}`,
    `speaker: ${current?.speaker || "-"}`,
    `title: ${current?.title || "-"}`,
    "Enter: next",
    "1 / 2: choose branch",
    "R: restart"
  ].join("\n");
};

const start = async () => {
  const app = new WebgApp({
    document,
    clearColor: [0.05, 0.07, 0.12, 1.0],
    debugTools: {
      mode: "release",
      system: "dialogue",
      source: "unittest/dialogue"
    },
    camera: {
      target: [0.0, 0.0, 0.0],
      distance: 18.0,
      yaw: 0.0,
      pitch: -20.0,
      roll: 0.0
    },
    light: {
      mode: "eye-fixed",
      position: [100.0, 140.0, 130.0, 1.0]
    }
  });
  await app.init();

  const statusEl = document.getElementById("status");
  app.registerActionMap({
    next: ["enter", "space"],
    choice1: ["1", "numpad1"],
    choice2: ["2", "numpad2"],
    restart: ["r"]
  });

  app.setGuideLines([
    "dialogue unittest",
    "Enter / Space: advance",
    "1 / 2: choose a branch",
    "R: restart the story"
  ], {
    x: 0,
    y: 0,
    color: [0.90, 0.95, 1.0]
  });

  app.setControlRows([
    {
      label: "dialogue",
      value: "DOM overlay + choice",
      keys: [
        { key: "Enter / Space", action: "next line" },
        { key: "1 / 2", action: "pick branch" },
        { key: "R", action: "restart story" }
      ],
      note: "Dialogue.start() -> next() -> choose()"
    },
    {
      label: "render",
      value: "UIPanel",
      keys: [
        { key: "speaker", action: "speaker eyebrow" },
        { key: "body", action: "pre-wrap prose" },
        { key: "buttons", action: "choice and control rows" }
      ],
      note: "DialogueOverlay feeds DOM overlay nodes"
    }
  ], {
    anchor: "bottom-left",
    x: 0,
    y: -2,
    color: [0.88, 0.96, 1.0],
    gap: 1,
    width: 68,
    minScale: 0.76
  });

  startStory(app);

  app.start({
    onUpdate: () => {
      if (app.wasActionPressed("next")) {
        app.nextDialogue();
      }
      if (app.wasActionPressed("choice1")) {
        app.chooseDialogue(0);
      }
      if (app.wasActionPressed("choice2")) {
        app.chooseDialogue(1);
      }
      if (app.wasActionPressed("restart")) {
        startStory(app);
      }

      writeStatus(statusEl, app);
      app.setStatusLines([
        `active: ${app.getDialogueState()?.active ? "yes" : "no"}`,
        `choice: ${app.getDialogueState()?.lastChoiceLabel || "-"}`,
        "Dialogue.start / next / choose sample"
      ], {
        x: 0,
        y: 5,
        color: [1.0, 0.88, 0.72]
      });
      return false;
    }
  });
};

document.addEventListener("DOMContentLoaded", () => {
  start().catch((err) => {
    console.error(err);
    const statusEl = document.getElementById("status");
    if (statusEl) {
      statusEl.textContent = `start failed:\n${err?.message ?? err}`;
    }
  });
});
