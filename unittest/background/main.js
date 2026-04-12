// -------------------------------------------------
// background sample
//   main.js       2026/03/14
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// -------------------------------------------------

import Background from "../../webg/Background.js";
import { bootUnitTestApp } from "../_shared/UnitTestApp.js";

// webgクラスの役割:
// UnitTestApp: Screen 初期化、viewport 追従、status / error 表示を共通化
// Background : 背景用の矩形描画テクスチャ/色/表示領域を担当

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;

const start = async ({ screen, gpu, setStatus, startLoop }) => {
  // 共通 helper 側で Screen 初期化と viewport 追従を終えたあと、Background の準備だけを行う
  setStatus("creating background shader...");

  // Backgroundは3Dオブジェクトを使わず、画面上の背景矩形を直接描く
  const bg = new Background(gpu);
  await bg.init();
  const rectX = 80;
  const rectY = 120;
  const rectW = 640;
  const rectH = 320;
  bg.setWindowPixels(rectX, rectY, rectW, rectH, CANVAS_WIDTH, CANVAS_HEIGHT);
  bg.setColor(1.0, 1.0, 1.0);
  const ok = await bg.setBackgroundImage("../../webg/num256.png");
  if (!ok) {
    setStatus("failed to load texture ../../webg/num256.png");
    return;
  }
  bg.setTextureAspect(256, 256, rectW, rectH);
  setStatus("running");

  let frame = 0;
  startLoop(() => {
    // 色を周期的に切り替えて、setColor の反映を確認する
    frame++;
    const blink = ((frame / 45) | 0) % 2 === 0;
    const r = blink ? 1.0 : 0.0;
    const g = blink ? 0.15 : 1.0;
    const b = blink ? 0.05 : 1.0;
    bg.setColor(r, g, b);
    if (frame % 30 === 0) {
      setStatus(`running\nframe=${frame}\nbg=(${r.toFixed(2)},${g.toFixed(2)},${b.toFixed(2)})\nrect=${rectW}x${rectH}`);
    }

    screen.clear();
    // Background.draw() で背景矩形を描き、最後に Screen.present() で表示反映する
    bg.draw();
    screen.present();
  });
};

bootUnitTestApp({
  statusElementId: "status",
  initialStatus: "creating screen...",
  clearColor: [0.0, 0.0, 0.0, 1.0]
}, (app) => {
  return start(app);
});
