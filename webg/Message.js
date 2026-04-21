// ---------------------------------------------
// Message.js     2026/04/21
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import Text from "./Text.js";
import util from "./util.js";

export default class Message extends Text {
  // 高レベルHUD API を持つメッセージ描画クラスを初期化する
  constructor(gpu, options = {}) {
    // 公開向けには
    // - setLine(id, text, options)
    // - setBlock(id, lines, options)
    // - replaceAll(entries)
    // を主APIにし、AI が x/y と index を毎回手管理しなくて済む形へ寄せる
    // 既存の setMessage() は sample 移行のための薄い wrapper として残す
    super(gpu, options);
    this.color = [1.0, 1.0, 1.0];
    this.entries = new Map();
    this.autoId = 0;
  }

  async init(fontTextureFile, options = {}) {
    await super.init(fontTextureFile, options);
    this.clear();
  }

  // 以後登録メッセージの既定色を設定する
  setColor(r, g, b) {
    if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
      throw new Error("Message.setColor requires finite r/g/b");
    }
    this.color = [r, g, b];
    return this.color;
  }

  // 既定色か明示色を 3 要素 RGB 配列へ正規化する
  normalizeColor(color = this.color) {
    const src = Array.isArray(color) ? color : this.color;
    if (!Array.isArray(src) || src.length < 3) {
      throw new Error("Message color must be an RGB array");
    }
    if (!Number.isFinite(src[0]) || !Number.isFinite(src[1]) || !Number.isFinite(src[2])) {
      throw new Error("Message color must contain finite RGB values");
    }
    return [
      Number(src[0]),
      Number(src[1]),
      Number(src[2])
    ];
  }

  // anchor 指定から block 左上座標を解決する
  // Text.setScale(scale) 済みなら visibleCols / visibleRows を基準に計算し、
  // 80x25固定ではなく「現在見えている文字グリッド」に追従させる
  resolvePosition(options = {}) {
    const layout = this.getLayoutInfo();
    const anchor = util.readOptionalAnchor(options.anchor, "top-left", "Message anchor");
    const width = util.readOptionalInteger(options.width, "Message width", 0, { min: 0 });
    const height = util.readOptionalInteger(options.height, "Message height", 1, { min: 0 });
    const x = util.readOptionalInteger(options.x, "Message x", 0);
    const y = util.readOptionalInteger(options.y, "Message y", 0);
    const offsetX = util.readOptionalInteger(options.offsetX, "Message offsetX", 0);
    const offsetY = util.readOptionalInteger(options.offsetY, "Message offsetY", 0);
    let resolvedX = x;
    let resolvedY = y;

    if (anchor === "top-right") {
      resolvedX = layout.visibleCols - width + x;
    } else if (anchor === "top-center") {
      resolvedX = Math.floor((layout.visibleCols - width) * 0.5) + x;
    } else if (anchor === "bottom-left") {
      resolvedY = layout.visibleRows - height + y;
    } else if (anchor === "bottom-right") {
      resolvedX = layout.visibleCols - width + x;
      resolvedY = layout.visibleRows - height + y;
    } else if (anchor === "bottom-center") {
      resolvedX = Math.floor((layout.visibleCols - width) * 0.5) + x;
      resolvedY = layout.visibleRows - height + y;
    } else if (anchor === "center") {
      resolvedX = Math.floor((layout.visibleCols - width) * 0.5) + x;
      resolvedY = Math.floor((layout.visibleRows - height) * 0.5) + y;
    }

    return {
      x: resolvedX + offsetX,
      y: resolvedY + offsetY
    };
  }

  // 固定幅 block 用に text を必要なら wrap / clip する
  formatLines(lines, options = {}) {
    const width = options.width === undefined
      ? undefined
      : util.readOptionalInteger(options.width, "Message width", undefined, { min: 1 });
    const wrap = util.readOptionalBoolean(options.wrap, "Message wrap", false) === true;
    const clip = util.readOptionalBoolean(options.clip, "Message clip", true) !== false;
    const source = (lines ?? []).map((line) => String(line ?? ""));
    const out = [];

    for (let i = 0; i < source.length; i++) {
      const line = source[i];
      if (!width) {
        out.push(line);
        continue;
      }
      if (wrap) {
        for (let start = 0; start < line.length || start === 0; start += width) {
          out.push(line.slice(start, start + width));
        }
      } else if (clip) {
        out.push(line.slice(0, width));
      } else {
        out.push(line);
      }
    }

    return out;
  }

  // line 群を block 幅へ合わせて left/center/right 揃えする
  alignLines(lines, options = {}) {
    const align = util.readOptionalAlign(options.align, "left", "Message align");
    const width = options.width !== undefined
      ? util.readOptionalInteger(options.width, "Message width", undefined, { min: 1 })
      : Math.max(0, ...lines.map((line) => line.length));
    return lines.map((line) => {
      if (align === "right") {
        return line.padStart(width, " ");
      }
      if (align === "center") {
        const pad = Math.max(0, width - line.length);
        const left = Math.floor(pad * 0.5);
        const right = pad - left;
        return `${" ".repeat(left)}${line}${" ".repeat(right)}`;
      }
      return line.padEnd(width, " ");
    });
  }

  // 1 行テキストを id 付きで登録または更新する
  setLine(id, text, options = {}) {
    const safeId = String(id ?? `line_${this.autoId++}`);
    this.entries.set(safeId, {
      type: "line",
      id: safeId,
      text: String(text ?? ""),
      color: this.normalizeColor(options.color),
      visible: util.readOptionalBoolean(options.visible, "Message visible", true) !== false,
      x: util.readOptionalInteger(options.x, "Message x", 0),
      y: util.readOptionalInteger(options.y, "Message y", 0),
      anchor: util.readOptionalAnchor(options.anchor, "top-left", "Message anchor"),
      offsetX: util.readOptionalInteger(options.offsetX, "Message offsetX", 0),
      offsetY: util.readOptionalInteger(options.offsetY, "Message offsetY", 0),
      clip: util.readOptionalBoolean(options.clip, "Message clip", true) !== false,
      expiresAtMs: options.expiresAtMs === undefined
        ? null
        : util.readOptionalInteger(options.expiresAtMs, "Message expiresAtMs", null)
    });
    return safeId;
  }

  // 複数行テキストを block として登録または更新する
  setBlock(id, lines, options = {}) {
    const safeId = String(id ?? `block_${this.autoId++}`);
    this.entries.set(safeId, {
      type: "block",
      id: safeId,
      lines: (lines ?? []).map((line) => String(line ?? "")),
      color: this.normalizeColor(options.color),
      visible: util.readOptionalBoolean(options.visible, "Message visible", true) !== false,
      x: util.readOptionalInteger(options.x, "Message x", 0),
      y: util.readOptionalInteger(options.y, "Message y", 0),
      anchor: util.readOptionalAnchor(options.anchor, "top-left", "Message anchor"),
      offsetX: util.readOptionalInteger(options.offsetX, "Message offsetX", 0),
      offsetY: util.readOptionalInteger(options.offsetY, "Message offsetY", 0),
      gap: util.readOptionalInteger(options.gap, "Message gap", 1, { min: 1 }),
      align: util.readOptionalAlign(options.align, "left", "Message align"),
      width: options.width === undefined
        ? undefined
        : util.readOptionalInteger(options.width, "Message width", undefined, { min: 1 }),
      wrap: util.readOptionalBoolean(options.wrap, "Message wrap", false) === true,
      clip: util.readOptionalBoolean(options.clip, "Message clip", true) !== false,
      expiresAtMs: options.expiresAtMs === undefined
        ? null
        : util.readOptionalInteger(options.expiresAtMs, "Message expiresAtMs", null)
    });
    return safeId;
  }

  // 一時表示向けの toast を追加する
  setToast(id, text, options = {}) {
    const durationMs = util.readOptionalInteger(options.durationMs, "Message durationMs", 1500, { min: 0 });
    return this.setLine(id, text, {
      ...options,
      anchor: util.readOptionalAnchor(options.anchor, "bottom-center", "Message anchor"),
      y: util.readOptionalInteger(options.y, "Message y", -2),
      expiresAtMs: Date.now() + durationMs
    });
  }

  // 自動IDの toast を追加する
  pushToast(text, options = {}) {
    const id = options.id ?? `toast_${this.autoId++}`;
    return this.setToast(id, text, options);
  }

  // HUD 全体を 1 回で差し替える
  replaceAll(entries = []) {
    this.clear();
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i] ?? {};
      if (Array.isArray(entry.lines)) {
        this.setBlock(entry.id ?? `block_${i}`, entry.lines, entry);
      } else {
        this.setLine(entry.id ?? `line_${i}`, entry.text ?? "", entry);
      }
    }
    return this;
  }

  // id 指定の message/block を削除する
  remove(id) {
    return this.entries.delete(String(id));
  }

  // 全メッセージを削除する
  clear() {
    this.entries = new Map();
    this.autoId = 0;
  }

  // 旧 API: n番スロットへ 1 行 text を置く
  setMessage(n, x, y, text) {
    return this.setLine(String(n), text, {
      x,
      y,
      color: this.color
    });
  }

  // 旧 API: auto id で 1 行 text を追加する
  writeMessage(x, y, text) {
    return this.setLine(`auto_${this.autoId++}`, text, {
      x,
      y,
      color: this.color
    });
  }

  // 旧 API: n番メッセージを削除する
  delMessage(n) {
    this.remove(String(n));
  }

  // 旧 API: 全メッセージを削除する
  clearMessages() {
    this.clear();
  }

  // 期限切れ toast を描画前に取り除く
  cleanupExpiredEntries(nowMs = Date.now()) {
    const expired = [];
    for (const [id, entry] of this.entries.entries()) {
      if (Number.isFinite(entry?.expiresAtMs) && entry.expiresAtMs <= nowMs) {
        expired.push(id);
      }
    }
    for (let i = 0; i < expired.length; i++) {
      this.entries.delete(expired[i]);
    }
  }

  // 現在登録済みメッセージの内容を出力する
  listMessages() {
    for (const [id, entry] of this.entries.entries()) {
      if (entry.type === "block") {
        util.printf("%s block x:%2d y:%2d lines:%2d\n", id, entry.x, entry.y, entry.lines.length);
      } else {
        util.printf("%s line  x:%2d y:%2d %s\n", id, entry.x, entry.y, entry.text);
      }
    }
  }

  // draw 用に block / line を 1 行単位へ展開する
  // block は wrap / align / gap をここで解決し、最終的に
  // 「x, y, text, color を持つ単純な line 配列」へ落としてから描画する
  getResolvedLines() {
    this.cleanupExpiredEntries();
    const layout = this.getLayoutInfo();
    const resolved = [];

    for (const entry of this.entries.values()) {
      if (entry.visible === false) continue;
      if (entry.type === "block") {
        const formatted = this.formatLines(entry.lines, entry);
        const aligned = this.alignLines(formatted, entry);
        const width = entry.width ?? Math.max(0, ...aligned.map((line) => line.length));
        const height = aligned.length + Math.max(0, aligned.length - 1) * (entry.gap - 1);
        const base = this.resolvePosition({
          anchor: entry.anchor,
          x: entry.x,
          y: entry.y,
          offsetX: entry.offsetX,
          offsetY: entry.offsetY,
          width,
          height
        });
        for (let i = 0; i < aligned.length; i++) {
          resolved.push({
            id: `${entry.id}:${i}`,
            x: base.x,
            y: base.y + i * entry.gap,
            text: aligned[i],
            color: entry.color,
            clip: entry.clip
          });
        }
      } else {
        const text = entry.clip ? String(entry.text).slice(0, layout.visibleCols) : String(entry.text);
        const base = this.resolvePosition({
          anchor: entry.anchor,
          x: entry.x,
          y: entry.y,
          offsetX: entry.offsetX,
          offsetY: entry.offsetY,
          width: text.length,
          height: 1
        });
        resolved.push({
          id: entry.id,
          x: base.x,
          y: base.y,
          text,
          color: entry.color,
          clip: entry.clip
        });
      }
    }

    return resolved;
  }

  // メッセージ配列を描画する
  // Message は Text の screen buffer を使わず、登録済み entry を毎フレーム評価して
  // dynamic uniform offset で必要な文字だけ直接 draw する
  drawScreen() {
    this.cleanupExpiredEntries();
    const pass = this.gpu.passEncoder;
    if (!pass) return;
    pass.setPipeline(this.shader.pipeline);
    pass.setVertexBuffer(0, this.vertexBuffer);
    const bindGroup = this.shader.getBindGroup(this.tex);
    const layout = this.getLayoutInfo();
    for (const line of this.getResolvedLines()) {
      if (line.y < 0 || line.y >= layout.visibleRows) continue;
      for (let j = 0; j < line.text.length; j++) {
        const x = line.x + j;
        if (x < 0 || x >= layout.visibleCols) continue;
        let c = line.text.charCodeAt(j) - this.charOffset;
        if (this.charMap) {
          c = this.charMap(c);
        }
        if (c !== 32 && c >= this.minCharCode) {
          // Message は HUD の都合で同一RenderPass中に複数回 drawScreen() が呼ばれる。
          // ここで slot を 1 から振り直すと、あとから描いた別行が先に積んだ
          // draw の uniform 内容を上書きして文字欠けや文字化けが起きるため、
          // per-pass の払い出し番号を使って一意な dynamic offset を確保する
          const drawUniformIndex = this.shader.allocUniformIndex();
          if (drawUniformIndex >= this.shader.maxUniforms) return;
          this.shader.setColor(...line.color);
          this.shader.setCharAt(drawUniformIndex, x, line.y, c);
          pass.setBindGroup(0, bindGroup, [drawUniformIndex * this.shader.uniformStride]);
          pass.draw(4, 1, 0, 0);
        }
      }
    }
  }
}
