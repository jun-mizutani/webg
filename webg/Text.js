// ---------------------------------------------
// Text.js        2026/04/21
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import util from "./util.js";
import Font from "./Font.js";
import Texture from "./Texture.js";

export default class Text {
  // 可変 grid の画面バッファとフォント定義を初期化する
  constructor(gpu, options = {}) {
    // 既定では 80x25 だが、grid サイズを差し替えられるようにしておく
    // Message.js の anchor / block レイアウトもこの grid 情報を参照する
    // 80x25文字バッファを持つテキスト端末風クラス
    // Fontシェーダで1文字ずつ描画する
    this.gpu = gpu;
    this.vertexBuffer = null;
    this.charOffset = 32; // for default font
    this.minCharCode = 0;
    this.cols = util.readOptionalInteger(options.cols, "Text cols", 80, { min: 1 });
    this.rows = util.readOptionalInteger(options.rows, "Text rows", 25, { min: 1 });
    this.letters = [
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      [0,0,0,8,8,0,0,8,8,8,8,8,8,8,8,0],
      [0,0,0,0,0,0,0,0,0,0,10,10,20,20,20,0],
      [0,0,0,0,20,20,20,62,20,20,20,20,62,20,20,0],
      [0,0,0,8,8,28,42,42,40,28,10,10,42,28,8,0],
      [0,0,0,33,81,82,86,84,40,8,18,21,37,37,2,0],
      [0,0,0,44,50,18,18,18,42,36,6,10,10,10,4,0],
      [0,0,0,0,0,0,0,0,0,0,4,4,8,12,12,0],
      [0,0,0,16,16,8,8,4,4,4,4,4,8,8,16,0],
      [0,0,0,4,4,8,8,16,16,16,16,16,8,8,4,0],
      [0,0,0,0,0,8,73,42,28,28,42,73,8,0,0,0],
      [0,0,0,0,0,8,8,8,62,8,8,8,0,0,0,0],
      [0,0,4,8,12,12,0,0,0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0,0,30,0,0,0,0,0,0],
      [0,0,0,12,12,0,0,0,0,0,0,0,0,0,0,0],
      [0,0,0,2,2,4,4,8,8,16,16,32,32,0,0,0],
      [0,0,0,12,18,18,18,18,18,18,18,18,18,12,0,0],
      [0,0,0,28,8,8,8,8,8,8,8,8,12,8,0,0],
      [0,0,0,30,2,2,4,8,8,16,16,18,18,12,0,0],
      [0,0,0,12,18,18,18,16,12,16,16,18,18,12,0,0],
      [0,0,0,16,16,62,18,18,20,20,24,24,16,16,0,0],
      [0,0,0,12,18,18,18,16,16,14,2,2,2,30,0,0],
      [0,0,0,12,18,18,18,18,14,2,2,18,18,12,0,0],
      [0,0,0,4,4,4,4,8,8,8,16,16,16,30,0,0],
      [0,0,0,12,18,18,18,18,12,18,18,18,18,12,0,0],
      [0,0,0,12,18,18,18,16,28,18,18,18,18,12,0,0],
      [0,0,0,0,0,12,12,0,0,0,12,12,0,0,0,0],
      [0,0,0,0,4,8,12,0,0,0,12,12,0,0,0,0],
      [0,0,0,16,8,8,4,4,2,4,4,8,8,16,0,0],
      [0,0,0,0,0,0,0,62,0,0,62,0,0,0,0,0],
      [0,0,0,2,4,4,8,8,16,8,8,4,4,2,0,0],
      [0,0,0,8,8,0,8,8,16,34,34,34,34,28,0,0],
      [0,0,0,60,2,2,50,42,42,42,50,34,34,38,28,0],
      [0,0,0,34,34,34,34,34,62,34,34,34,34,20,8,0],
      [0,0,0,30,34,34,34,34,30,18,34,34,34,18,14,0],
      [0,0,0,28,34,34,34,34,2,2,2,34,34,18,12,0],
      [0,0,0,14,18,34,34,34,34,34,34,34,34,18,14,0],
      [0,0,0,62,2,2,2,2,2,30,2,2,2,2,62,0],
      [0,0,0,2,2,2,2,2,2,30,2,2,2,2,62,0],
      [0,0,0,44,50,34,34,34,58,2,2,2,34,18,12,0],
      [0,0,0,34,34,34,34,34,34,62,34,34,34,34,34,0],
      [0,0,0,28,8,8,8,8,8,8,8,8,8,8,28,0],
      [0,0,0,28,34,34,34,32,32,32,32,32,32,32,32,0],
      [0,0,0,34,34,18,18,10,6,6,10,10,18,18,34,0],
      [0,0,0,62,2,2,2,2,2,2,2,2,2,2,2,0],
      [0,0,0,34,34,34,42,42,42,54,54,54,34,34,34,0],
      [0,0,0,34,34,50,50,42,42,42,38,38,38,34,34,0],
      [0,0,0,28,34,34,34,34,34,34,34,34,34,18,12,0],
      [0,0,0,2,2,2,2,2,30,34,34,34,34,18,14,0],
      [0,0,0,44,50,18,42,42,34,34,34,34,34,18,12,0],
      [0,0,0,34,34,34,34,18,30,34,34,34,34,18,14,0],
      [0,0,0,28,34,34,32,32,16,12,2,2,34,18,12,0],
      [0,0,0,8,8,8,8,8,8,8,8,8,8,8,62,0],
      [0,0,0,28,52,34,34,34,34,34,34,34,34,34,34,0],
      [0,0,0,8,8,8,20,20,20,20,34,34,34,34,34,0],
      [0,0,0,20,20,20,42,42,42,42,42,42,42,42,42,0],
      [0,0,0,34,34,34,20,20,8,8,20,20,34,34,34,0],
      [0,0,0,8,8,8,8,8,8,20,20,34,34,34,34,0],
      [0,0,0,62,2,2,4,4,8,8,16,16,32,32,62,0],
      [0,0,0,56,8,8,8,8,8,8,8,8,8,8,56,0],
      [0,0,0,0,32,32,16,16,8,8,4,4,2,2,0,0],
      [0,0,0,14,8,8,8,8,8,8,8,8,8,8,14,0],
      [0,0,0,0,0,0,0,0,0,0,0,0,34,20,8,0],
      [0,0,0,62,0,0,0,0,0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0,0,0,0,16,8,24,24,0],
      [0,0,0,44,18,18,18,18,28,16,12,0,0,0,0,0],
      [0,0,0,30,34,34,34,34,34,30,2,2,2,2,2,0],
      [0,0,0,28,34,34,2,2,34,34,28,0,0,0,0,0],
      [0,0,0,60,34,34,34,34,34,60,32,32,32,32,32,0],
      [0,0,0,28,34,2,2,62,34,34,28,0,0,0,0,0],
      [0,0,0,8,8,8,8,8,8,62,8,8,8,48,0,0],
      [0,0,30,32,32,60,34,34,34,34,60,0,0,0,0,0],
      [0,0,0,34,34,34,34,34,34,30,2,2,2,2,0,0],
      [0,0,0,8,8,8,8,8,8,0,8,8,0,0,0,0],
      [0,0,6,8,8,8,8,8,8,8,0,8,8,0,0,0],
      [0,0,0,34,34,18,10,6,10,18,34,2,2,2,2,0],
      [0,0,0,16,8,8,8,8,8,8,8,8,8,8,8,0],
      [0,0,0,42,42,42,42,42,42,42,30,0,0,0,0,0],
      [0,0,0,34,34,34,34,34,34,34,30,0,0,0,0,0],
      [0,0,0,28,34,34,34,34,34,34,28,0,0,0,0,0],
      [0,0,2,2,2,30,34,34,34,34,30,0,0,0,0,0],
      [0,0,32,32,32,60,34,34,34,34,60,0,0,0,0,0],
      [0,0,0,2,2,2,2,2,6,10,50,0,0,0,0,0],
      [0,0,0,30,32,32,28,2,2,2,60,0,0,0,0,0],
      [0,0,0,48,8,8,8,8,8,8,62,8,8,0,0,0],
      [0,0,0,60,34,34,34,34,34,34,34,0,0,0,0,0],
      [0,0,0,8,8,8,20,20,34,34,34,0,0,0,0,0],
      [0,0,0,20,20,42,42,42,42,42,42,0,0,0,0,0],
      [0,0,0,34,34,20,20,8,20,34,34,0,0,0,0,0],
      [0,0,6,8,8,8,20,20,34,34,34,0,0,0,0,0],
      [0,0,0,62,2,4,8,8,16,32,62,0,0,0,0,0],
      [0,0,16,8,8,8,8,8,4,8,8,8,8,8,16,0],
      [0,0,8,8,8,8,8,8,8,8,8,8,8,8,8,0],
      [0,0,4,8,8,8,8,8,16,8,8,8,8,8,4,0],
      [0,0,0,0,0,0,0,0,0,0,0,0,34,84,8,0],
      [0,0,42,85,42,85,42,85,42,85,42,85,42,85,42,85]
    ];
  }

  // grid サイズを更新し、既存画面バッファ内容はできる範囲で保持する
  // 80x25 を既定値にしつつ、sample や debug UI では必要に応じて
  // より細かい列数/行数へ切り替えられるようにする
  setGridSize(cols, rows) {
    const nextCols = util.readOptionalInteger(cols, "Text cols", this.cols, { min: 1 });
    const nextRows = util.readOptionalInteger(rows, "Text rows", this.rows, { min: 1 });
    if (nextCols === this.cols && nextRows === this.rows) {
      return { cols: this.cols, rows: this.rows };
    }
    const previous = this.screen ?? null;
    const oldCols = this.cols;
    const oldRows = this.rows;
    this.cols = nextCols;
    this.rows = nextRows;
    if (previous) {
      const next = new Uint8Array(this.cols * this.rows);
      const copyCols = Math.min(oldCols, this.cols);
      const copyRows = Math.min(oldRows, this.rows);
      for (let y = 0; y < copyRows; y++) {
        for (let x = 0; x < copyCols; x++) {
          next[y * this.cols + x] = previous[y * oldCols + x];
        }
      }
      this.screen = next;
    }
    this.shader?.setCellStep?.(2.0 / this.cols, 2.0 / this.rows);
    this.makeShape();
    return { cols: this.cols, rows: this.rows };
  }

  // 現在の grid サイズを返す
  getGridSize() {
    return {
      cols: this.cols,
      rows: this.rows
    };
  }

  // 現在 scale で表示に使える列数 / 行数を返す
  // scale を 2.0 にすると各文字が 2 倍になり、見える列数/行数は半分になる
  getVisibleGridSize(scale = this.shader?.getScale?.() ?? 1.0) {
    const safeScale = util.readFiniteNumber(scale, "Text scale", { minExclusive: 0 });
    return {
      cols: Math.max(1, Math.floor(this.cols / safeScale)),
      rows: Math.max(1, Math.floor(this.rows / safeScale))
    };
  }

  // anchor や block レイアウトに使う grid 情報をまとめて返す
  // Message.js は absolute な cols/rows ではなく、ここで返す visibleCols/visibleRows を
  // 参照して right/bottom anchor や center を決める
  getLayoutInfo(scale = this.shader?.getScale?.() ?? 1.0) {
    const safeScale = util.readFiniteNumber(scale, "Text scale", { minExclusive: 0 });
    const visible = this.getVisibleGridSize(safeScale);
    return {
      cols: this.cols,
      rows: this.rows,
      visibleCols: visible.cols,
      visibleRows: visible.rows,
      scale: safeScale,
      cellWidth: 2.0 / this.cols,
      cellHeight: 2.0 / this.rows
    };
  }

  // カーソル位置を移動する
  goTo(x, y) {
    this.cursorX = util.readIntegerInRange(x, "Text x", 0, this.cols - 1);
    this.cursorY = util.readIntegerInRange(y, "Text y", 0, this.rows - 1);
  }

  // 現在カーソルを保存する
  saveCursor() {
    this.cursorX2 = this.cursorX;
    this.cursorY2 = this.cursorY;
  }

  // 保存カーソルへ戻す
  restoreCursor() {
    this.cursorX = this.cursorX2;
    this.cursorY = this.cursorY2;
  }

  // 1行スクロールする
  scrollUp() {
    for (let i = 0; i < this.rows - 1; i++) {
      for (let j = 0; j < this.cols; j++) {
        this.screen[i * this.cols + j] = this.screen[(i + 1) * this.cols + j];
      }
    }
    for (let j = 0; j < this.cols; j++) {
      this.screen[(this.rows - 1) * this.cols + j] = 0;
    }
  }

  // カーソルを次位置へ進める
  incCursorPosition() {
    if (this.cursorX < this.cols - 1) {
      this.cursorX++;
    } else if (this.cursorY < this.rows - 1) {
      this.cursorY++;
      this.cursorX = 0;
    } else {
      this.scrollUp();
      this.cursorY = this.rows - 1;
      this.cursorX = 0;
    }
  }

  // 現在カーソルから文字列を書き込む
  write(str) {
    // 現在カーソル位置へ文字コードを書き込み、カーソルを進める
    for (let i = 0; i < str.length; i++) {
      this.screen[this.cursorY * this.cols + this.cursorX] = str.charCodeAt(i) - this.charOffset;
      this.incCursorPosition();
    }
  }

  // `sprintf` 形式で書き込む
  writef(fmt, ...args) {
    this.write(util.sprintf(fmt, ...args));
  }

  // 指定座標へ文字列を書き込む
  writeAt(x, y, str) {
    this.goTo(x, y);
    this.write(str);
  }

  // 指定座標へフォーマット書き込みする
  writefAt(x, y, fmt, ...args) {
    this.goTo(x, y);
    this.writef(fmt, ...args);
  }

  // `writeAt` の別名
  drawText(str, x, y) {
    this.writeAt(x, y, str);
  }

  // 1行クリアする
  clearLine(lineNo) {
    if (lineNo < 0 || lineNo >= this.rows) return;
    for (let j = 0; j < this.cols; j++) {
      this.screen[lineNo * this.cols + j] = 0;
    }
  }

  // 全画面クリアする
  clearScreen() {
    for (let i = 0; i < this.rows; i++) {
      this.clearLine(i);
    }
    this.cursorX = 0;
    this.cursorY = 0;
  }

  // テストパターンを埋める
  fontTest() {
    for (let i = 0; i < this.rows; i++) {
      for (let j = 0; j < this.cols; j++) {
        this.screen[i * this.cols + j] = j + i;
      }
    }
  }

  // フォントスケールを設定する
  // 文字を大きくすると、見える列数/行数は getVisibleGridSize() の値に従って減る
  setScale(scale) {
    const safeScale = util.readFiniteNumber(scale, "Text scale", { minExclusive: 0 });
    if (this.shader !== null) {
      this.shader.setScale(safeScale);
    }
  }

  // 描画最小文字コード閾値を設定する
  setMinCharCode(code) {
    this.minCharCode = code;
  }

  // 1文字クワッド頂点バッファを作る
  makeShape() {
    // 1文字分の四角形(2三角形相当のstrip)頂点を準備する
    if (!this.gpu?.device) return;
    const cellWidth = 2.0 / this.cols;
    const cellHeight = 2.0 / this.rows;
    const vertices = new Float32Array([
      0.0,   0.0,   0.0,  0.0, 0.0,
      cellWidth, 0.0,        0.0,  1.0, 0.0,
      0.0,      cellHeight,  0.0,  0.0, 1.0,
      cellWidth, cellHeight, 0.0,  1.0, 1.0
    ]);

    this.vertexBuffer = this.gpu.device.createBuffer({
      size: vertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    });
    this.gpu.queue.writeBuffer(this.vertexBuffer, 0, vertices);
  }

  async init(texture_file, options = {}) {
    // テキスト描画の初期化:
    // 1) Fontシェーダ
    // 2) フォントテクスチャ(外部 or 内蔵)
    // 3) 1文字四角形頂点
    await this.gpu.ready;
    this.screen = new Uint8Array(this.cols * this.rows);
    this.bytes = new Uint8Array(128 * 128 * 4);
    this.shader = new Font(this.gpu);
    await this.shader.init();
    this.shader.setCellStep(2.0 / this.cols, 2.0 / this.rows);
    this.tex = new Texture(this.gpu);
    if (texture_file !== undefined) {
      await this.tex.readImageFromFile(texture_file);
      this.charOffset = 0;
      // 外部フォントは 16x8 配置(0x00..0x7F)として扱う
      const w = this.tex.width;
      const h = this.tex.height;
      // External font atlas is treated as 16 columns x 8 rows (0x00..0x7F).
      this.shader.setTexStep(1.0 / 16.0, 1.0 / 8.0);
      this.shader.setTexelSize(1.0 / w, 1.0 / h);
      this.shader.setFlipV(true);
    } else {
      // 内蔵フォント(96文字)をCPU生成してテクスチャ化する
      this.initFont();
      await this.tex.initPromise;
      this.tex.setImage(this.bytes, 128, 128, 4);
      this.charOffset = 32;
      this.shader.setTexStep(1.0 / 16.0, 1.0 / 8.0);
      this.shader.setTexelSize(1.0 / 128.0, 1.0 / 128.0);
      this.shader.setFlipV(false);
    }
    this.makeShape();
    this.clearScreen();
  }

  // 内蔵フォントテクスチャ画像を生成する
  initFont() {
    let j, k, i, b, c, n;
    const TEX_HEIGHT = 128;
    const TEX_WIDTH = 128;
    const letters = this.letters;

    for (let y = 0; y < TEX_HEIGHT; y++) {
      j = Math.floor(y / 16);
      k = y % 16;
      for (let x = 0; x < TEX_WIDTH; x++) {
        i = Math.floor(x / 8);
        b = x % 8;
        if ((i + j * 16) < 96) {
          c = letters[i + j * 16][k];
        } else {
          c = 0;
        }
        n = (y * 128 + x) * 4;
        if ((c & (0x01 << b)) !== 0) {
          this.bytes[n] = 255;
          this.bytes[n + 1] = 255;
          this.bytes[n + 2] = 255;
          this.bytes[n + 3] = 255;
        } else {
          this.bytes[n] = 255;
          this.bytes[n + 1] = 255;
          this.bytes[n + 2] = 255;
          this.bytes[n + 3] = 0;
        }
      }
    }
  }

  // 内蔵フォント画像バイト列を返す
  getDefaultFontImage() {
    return this.bytes;
  }

  // 画面バッファ内容を描画する
  drawScreen() {
    // 画面バッファを走査し、非空セルのみ draw(4) を発行する
    const pass = this.gpu.passEncoder;
    if (!pass) return;
    // 文字描画用のWebGPUパイプラインと頂点バッファを設定
    pass.setPipeline(this.shader.pipeline);
    pass.setVertexBuffer(0, this.vertexBuffer);
    const bindGroup = this.shader.getBindGroup(this.tex);

    let scale = this.shader.getScale();
    if (scale < 1.0) scale = 1.0;
    const maxRow = Math.min(this.rows, Math.floor(this.rows / scale));
    const maxColumn = Math.min(this.cols, Math.floor(this.cols / scale));
    for (let i = 0; i < maxRow; i++) {
      const k = i * this.cols;
      for (let j = 0; j < maxColumn; j++) {
        let c = this.screen[k + j];
          if (c !== 0) {
            // 同一RenderPass中に drawScreen() を複数回呼ぶ場合でも、
            // 既に積んだ draw の uniform slot を後段の文字描画で上書きしないよう、
            // per-pass の払い出し番号を使って一意な dynamic offset を確保する
            const drawUniformIndex = this.shader.allocUniformIndex();
            if (drawUniformIndex >= this.shader.maxUniforms) return;
            this.shader.setCharAt(drawUniformIndex, j, i, c);
            // dynamic uniform offset で1文字ごとに座標/コードを切替える
            pass.setBindGroup(0, bindGroup, [drawUniformIndex * this.shader.uniformStride]);
            // 1文字は 4頂点(三角形ストリップ)で描画する
            pass.draw(4, 1, 0, 0);
          }
      }
    }
  }
}
