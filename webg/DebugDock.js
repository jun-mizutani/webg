// ---------------------------------------------
// DebugDock.js    2026/04/08
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import { DEFAULT_UI_THEME } from "./WebgUiTheme.js";

export default class DebugDock {

  constructor(options = {}) {
    this.doc = options.document ?? document;
    this.enabled = options.enabled !== false;
    // 右側 dock は desktop 前提だが、1180px 固定だと通常の browser 幅でも出にくいので
    // 既定では 960px 以上あれば表示対象にし、必要なら sample 側 option でさらに引き上げる
    this.minViewportWidth = Number.isFinite(options.minViewportWidth)
      ? Math.max(640, Math.floor(options.minViewportWidth))
      : 960;
    this.requireFinePointer = options.requireFinePointer !== false;
    this.reserveWidth = Number.isFinite(options.reserveWidth)
      ? Math.max(240, Math.floor(options.reserveWidth))
      : 360;
    this.gap = Number.isFinite(options.gap)
      ? Math.max(0, Math.floor(options.gap))
      : 16;
    this.font = options.font ?? "13px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    this.title = options.title ?? null;
    this.showCanvasHudWhenDockActive = options.showCanvasHudWhenDockActive === true;
    this.rows = [];
    this.refs = null;
    this.theme = {
      ...DEFAULT_UI_THEME.debugDock,
      ...(options.theme ?? {})
    };
    this.actions = {
      copySummary: typeof options.actions?.copySummary === "function" ? options.actions.copySummary : null,
      copyJson: typeof options.actions?.copyJson === "function" ? options.actions.copyJson : null
    };
  }

  setRows(rows = []) {
    this.rows = Array.isArray(rows)
      ? rows.map((row) => ({ ...(row ?? {}) }))
      : [];
  }

  clearRows() {
    this.rows = [];
  }

  // theme を差し替える時は dock DOM を作り直し、
  // inline style に埋め込んでいる色をまとめて更新する
  setTheme(theme = {}) {
    this.theme = {
      ...DEFAULT_UI_THEME.debugDock,
      ...(theme ?? {})
    };
    const wasVisible = this.refs?.root?.isConnected
      ? this.refs.root.style.display !== "none"
      : false;
    if (this.refs?.root?.isConnected) {
      this.refs.root.remove();
    }
    this.refs = null;
    const refs = this.ensure();
    if (refs?.root) {
      refs.root.style.display = wasVisible ? "block" : "none";
    }
  }

  isActive(debugUiEnabled = true) {
    if (!this.enabled) return false;
    if (!debugUiEnabled) return false;
    if (typeof window === "undefined") return false;
    if (window.innerWidth < this.minViewportWidth) return false;
    if (!this.requireFinePointer) return true;
    if (typeof window.matchMedia !== "function") return true;
    return window.matchMedia("(pointer: fine)").matches;
  }

  ensure() {
    if (!this.enabled) return null;
    if (this.refs?.root?.isConnected) {
      return this.refs;
    }
    const root = this.doc.createElement("aside");
    root.dataset.webgDebugDock = "root";
    root.style.position = "fixed";
    root.style.top = "0";
    root.style.right = "0";
    root.style.bottom = "0";
    root.style.width = `${this.reserveWidth}px`;
    root.style.boxSizing = "border-box";
    root.style.padding = "14px 14px 18px 14px";
    root.style.background = this.theme.rootBackground;
    root.style.borderLeft = this.theme.rootBorder;
    root.style.color = this.theme.rootText;
    root.style.font = this.font;
    root.style.zIndex = "920";
    root.style.overflowY = "auto";
    root.style.display = "none";
    root.style.backdropFilter = "blur(8px)";
    root.style.userSelect = "none";
    root.style.pointerEvents = "auto";

    const buttonArea = this.doc.createElement("div");
    buttonArea.style.display = "grid";
    buttonArea.style.gap = "8px";
    buttonArea.style.marginBottom = "14px";

    const makeButton = (label, onClick, options = {}) => {
      const btn = this.doc.createElement("button");
      btn.type = "button";
      btn.textContent = label;
      btn.style.padding = "8px 10px";
      btn.style.border = options.border ?? this.theme.buttonBorder;
      btn.style.background = options.background ?? this.theme.buttonBackground;
      btn.style.color = options.color ?? this.theme.buttonText;
      btn.style.font = "12px/1.2 ui-sans-serif, system-ui, sans-serif";
      btn.style.cursor = "pointer";
      btn.style.borderRadius = "8px";
      btn.addEventListener("click", () => {
        onClick?.();
        btn.blur();
      });
      return btn;
    };

    const sections = {};
    const makeSection = (name, label) => {
      const wrap = this.doc.createElement("section");
      wrap.style.marginBottom = "14px";
      const heading = this.doc.createElement("div");
      heading.textContent = label;
      heading.style.font = "600 12px/1.4 ui-sans-serif, system-ui, sans-serif";
      heading.style.color = this.theme.sectionHeadingText;
      heading.style.textTransform = "uppercase";
      heading.style.letterSpacing = "0.05em";
      heading.style.marginBottom = "6px";
      const body = this.doc.createElement("div");
      body.style.margin = "0";
      body.style.padding = "10px 12px";
      body.style.whiteSpace = "pre-wrap";
      body.style.wordBreak = "break-word";
      body.style.borderRadius = "10px";
      body.style.background = this.theme.sectionBackground;
      body.style.border = this.theme.sectionBorder;
      body.style.color = this.theme.sectionText;
      body.style.font = this.font;
      body.style.userSelect = "none";
      body.style.cursor = "default";
      wrap.appendChild(heading);
      wrap.appendChild(body);
      sections[name] = body;
      return wrap;
    };

    const buttonGrid = this.doc.createElement("div");
    buttonGrid.style.display = "grid";
    buttonGrid.style.gridTemplateColumns = "repeat(2, minmax(0, 1fr))";
    buttonGrid.style.gap = "8px";
    buttonGrid.appendChild(makeButton("Copy Summary", this.actions.copySummary));
    buttonGrid.appendChild(makeButton("Copy JSON", this.actions.copyJson));
    buttonArea.appendChild(buttonGrid);

    root.appendChild(buttonArea);
    root.appendChild(makeSection("diag", "Current State"));
    this.doc.body.appendChild(root);

    this.refs = { root, sections };
    return this.refs;
  }

  syncVisibility(active = false) {
    if (!this.enabled) return;
    const refs = this.ensure();
    if (!refs?.root) return;
    refs.root.style.display = active ? "block" : "none";
  }

  update({ active = false, diagText = "" } = {}) {
    if (!this.enabled) return;
    const refs = this.ensure();
    if (!refs?.root) return;
    refs.root.style.display = active ? "block" : "none";
    if (!active) return;
    this.setTextContentIfChanged(refs.sections.diag, diagText);
  }

  formatText({ diagText = "" } = {}) {
    return [
      "[Current State]",
      diagText
    ].join("\n");
  }

  setTextContentIfChanged(node, text) {
    if (!node) return;
    const next = String(text ?? "");
    if (node.textContent !== next) {
      node.textContent = next;
    }
  }
}
