// -------------------------------------------------
// message sample
//   main.js       2026/03/14
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// Text.js and Message.js comparison sample.
// -------------------------------------------------

import Text from "../../webg/Text.js";
import Message from "../../webg/Message.js";
import { bootUnitTestApp } from "../_shared/UnitTestApp.js";

// webgクラスの役割:
// UnitTestApp: Screen 初期化、viewport 追従、status / error 表示を共通化
// Text        : 可変gridの文字バッファを一括描画
// Message     : line / block / anchor ベースでHUDを組み立てる

const params = new URLSearchParams(window.location.search);
const useExternal = params.get("font") !== "builtin";
const fontFile = "../../webg/font512.png";

const start = async ({ screen, gpu, setStatus, startLoop }) => {
  // Text/Message はどちらも内部でフォントテクスチャを使うが、更新方式が異なる
  const text = new Text(gpu, { cols: 80, rows: 25 });
  const msg = new Message(gpu, { cols: 80, rows: 25 });
  if (useExternal) {
    // 外部フォント（font512.png, code 0x00..0x7F）
    await text.init(fontFile);
    await msg.init(fontFile);
    text.charOffset = 0;
    msg.charOffset = 0;
  } else {
    // 内蔵フォント（既存96字）
    await text.init();
    await msg.init();
  }

  text.shader.setScale(1.0);
  msg.shader.setScale(1.0);
  setStatus(`unittest/message\nfont=${useExternal ? "external(../../webg/font512.png)" : "builtin"}\n?font=builtin で内蔵フォント`);

  startLoop(() => {
    const frame = screen.getFrameCount();
    const blink = (Math.floor(frame / 30) % 2) === 0 ? "ON " : "OFF";

    screen.clear();

    // Text.js: 画面バッファへ直接書き込み、drawScreen() で一括描画する
    // ---- Text.js 表示領域（上側） ----
    text.clearScreen();
    text.writeAt(0, 0, "Text.js test area");
    text.writeAt(0, 1, "line0 should always appear (tests first slot path)");
    text.writeAt(0, 2, `frame=${frame} blink=${blink} font=${useExternal ? "external" : "builtin"}`);
    text.writeAt(0, 4, "ASCII: !\"#$%&'()*+,-./0123456789:;<=>?@ABC");
    text.writeAt(0, 5, "ascii lower: abcdefghijklmnopqrstuvwxyz");
    text.drawScreen();

    // Message.js: setBlock / setLine で HUD を意図ベースで更新する
    // ---- Message.js 表示領域（下側） ----
    msg.replaceAll([
      {
        id: "message-title",
        text: "Message.js block / line API",
        x: 0,
        y: 12,
        color: [1.0, 0.8, 0.3]
      },
      {
        id: "message-lines",
        lines: [
          "setBlock(id, lines, options)",
          `frame=${frame} blink=${blink}`,
          "anchors: top-left / top-right / bottom-left / bottom-right / center"
        ],
        x: 0,
        y: 13,
        color: [0.2, 1.0, 0.4]
      },
      {
        id: "message-guide",
        lines: [
          "Text.setScale(scale) changes visible cols/rows",
          "Message anchor layout follows the scaled visible grid"
        ],
        anchor: "bottom-left",
        x: 0,
        y: -3,
        color: [1.0, 0.5, 0.6]
      },
      {
        id: "message-anchor",
        text: "top-right anchor sample",
        anchor: "top-right",
        x: -1,
        y: 12,
        color: [0.4, 0.8, 1.0]
      }
    ]);
    msg.drawScreen();

    screen.present();
  });
};

bootUnitTestApp({
  statusElementId: "hud",
  initialStatus: "creating screen...",
  clearColor: [0.06, 0.07, 0.10, 1.0]
}, (app) => {
  return start(app);
});
