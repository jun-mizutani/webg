// samples/circular_breaker2/panelTexture.js 2026/09/20
// SF装置の外装を、色・浅い溝の高さ・発光位置の3画像として生成する

// 512角の画像を初期化時に一度生成する
// 面取り円柱の側面はPrimitive.revolutionのv=0.4〜0.6に対応するため、
// この範囲へパネルを配置し、上下面には落ち着いた金属面を残す
export function createPanelPixels() {
  const width = 512, height = 512;
  const color = new Uint8Array(width * height * 4);
  const relief = new Uint8Array(color.length);
  const emission = new Uint8Array(color.length);
  for (let y = 0; y < height; y++) {
    const v = (y + .5) / height;
    const side = v > .4 && v < .6;
    const panelY = (v - .4) / .2;
    for (let x = 0; x < width; x++) {
      // 円周を4枚のパネルに分ける。境界を暗くし、広い平滑面を残す
      const panelX = ((x + .5) / width * 4) % 1;
      const seam = side && (panelX < .025 || panelX > .975
        || panelY < .035 || panelY > .965);
      const inset = side && panelX > .18 && panelX < .82
        && panelY > .31 && panelY < .76;
      const insetEdge = inset && (panelX < .2 || panelX > .8
        || panelY < .34 || panelY > .73);
      // 下部の細い帯と上部寄りの3本のランプを配置する
      // 発光のマスクは高さ画像から分離し、ランプの輝度を凹凸へ混ぜない
      const band = side && panelY > .14 && panelY < .19
        && panelX > .09 && panelX < .91;
      const indicator = side && panelY > .81 && panelY < .87
        && panelX > .2 && panelX < .55 && (panelX * 24) % 1 < .55;
      // vの大きい側が上部。円周を囲む幅広の帯を最も強く発光させる
      const upperBand = side && panelY > .88 && panelY < .95;
      const value = seam ? 65 : insetEdge ? 100 : inset ? 183 : 224;
      const h = seam ? 100 : insetEdge ? 115 : 128;
      const e = upperBand ? 255 : (band || indicator) ? 160 : 0;
      const offset = (y * width + x) * 4;
      color.set([value, value, value, 255], offset);
      relief.set([h, h, h, 255], offset);
      emission.set([e, e, e, 255], offset);
    }
  }
  return { width, height, color, relief, emission };
}
