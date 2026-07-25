// ---------------------------------------------
// unittest/textdemo/main.js  2026/07/25
//   textdemo sample
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import Screen from "../../webg/Screen.js";
import Text from "../../webg/Text.js";

// AI向け注意:
// この unittest は、Text の 80x25 文字バッファを最小構成で確認するため、
// 意図的に WebgApp / Message を使わず Screen + Text だけで書いている。
// 通常の HUD や status 表示では Message または WebgApp の helper を優先する。

// webgクラスの役割:
// Screen : WebGPU初期化、フレーム clear/present を担当
// Text   : 80x25文字バッファをGPUへ描画する

const start = async () => {
  // ScreenとTextを初期化し、文字描画状態を準備する
  const screen = new Screen(document);
  await screen.ready;

  const gpu = screen.getGPU();
  // Textはフォントアトラスを参照してscreen配列を描画する
  const text = new Text(gpu);
  // 外部フォントを読み込み、1文字セルのUV刻みを設定する
  await text.init("../../webg/font512.png", { charOffset: 0 });
  text.shader.setTexStep(1.0 / 16.0, 1.0 / 8.0);
  text.shader.setScale(1.5);
  screen.setClearColor([0.05, 0.06, 0.07, 1.0]);

  // このインスタンスの描画段階で、必要な描画命令と表示内容を記録する
  const draw = () => {
    // 80x25領域へ連番ASCIIを埋め、毎フレーム再描画する
    screen.clear();
    text.clearScreen();
    for (let i = 0; i < 25; i++) {
      for (let j = 0; j < 80; j++) {
        text.screen[i * 80 + j] = 0x20 + ((i * 80 + j) % 96);
      }
    }
    text.drawScreen();
    screen.present();
    requestAnimationFrame(draw);
  };

  draw();
};

document.addEventListener("DOMContentLoaded", () => {
  start();
});
