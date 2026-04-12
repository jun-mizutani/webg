// ---------------------------------------------
// UIPanel.js 2026/04/09
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import { DEFAULT_UI_THEME } from "./WebgUiTheme.js";

// UIPanel:
// - canvas 外の DOM を使って scene の上に重ねる UI の共通 CSS を JS から注入する
// - theme 定数と panel DOM の対応を 1 か所へ集約し、sample ごとの CSS 重複を減らす
// - layout は app ごとに変えられるよう option で受けつつ、色・blur・radius は theme から一貫して引く
export default class UIPanel {

  static STYLE_ID = "webg-overlay-panel-style";

  constructor(options = {}) {
    this.doc = options.document ?? document;
    this.theme = {
      ...DEFAULT_UI_THEME.uiPanel,
      ...(options.theme ?? {})
    };
    this.layouts = [];
    this._onResize = () => this.syncAllResponsiveLayouts();
    this.ensureStyle();
    if (typeof window !== "undefined") {
      window.addEventListener("resize", this._onResize);
      window.addEventListener("orientationchange", this._onResize);
    }
  }

  ensureStyle() {
    if (this.doc.getElementById(UIPanel.STYLE_ID)) {
      return;
    }
    const style = this.doc.createElement("style");
    style.id = UIPanel.STYLE_ID;
    style.textContent = `
.webg-overlay-root {
  --webg-overlay-dock-offset: 0px;
  --webg-overlay-gap: 14px;
  --webg-overlay-left-width: minmax(320px, 470px);
  --webg-overlay-right-width: minmax(280px, 420px);
  --webg-overlay-viewport-width: 100vw;
  --webg-overlay-viewport-height: 100vh;
  --webg-overlay-column-max-height: calc(var(--webg-overlay-viewport-height) - 32px);
  position: fixed;
  inset: 16px calc(16px + var(--webg-overlay-dock-offset)) auto 16px;
  display: grid;
  grid-template-columns: var(--webg-overlay-left-width) var(--webg-overlay-right-width);
  gap: var(--webg-overlay-gap);
  align-items: start;
  pointer-events: none;
  box-sizing: border-box;
  z-index: 840;
}

.webg-overlay-root[hidden] {
  display: none !important;
}

.webg-overlay-root.is-stacked {
  grid-template-columns: minmax(0, 1fr);
  inset: 12px calc(12px + var(--webg-overlay-dock-offset)) auto 12px;
  --webg-overlay-column-max-height: calc(var(--webg-overlay-viewport-height) - 24px);
}

.webg-overlay-root.is-spread-columns {
  inset: 12px calc(12px + var(--webg-overlay-dock-offset)) auto 12px;
  grid-template-columns: var(--webg-overlay-left-width) minmax(0, 1fr) var(--webg-overlay-right-width);
}

.webg-overlay-root.is-spread-columns > .webg-overlay-column-wrap:first-child {
  grid-column: 1;
}

.webg-overlay-root.is-spread-columns > .webg-overlay-column-wrap:last-child {
  grid-column: 3;
}

.webg-overlay-root.is-main-right > .webg-overlay-column-wrap:first-child {
  grid-column: 2;
}

.webg-overlay-root.is-main-right > .webg-overlay-column-wrap:last-child {
  grid-column: 1;
}

.webg-overlay-root.is-spread-columns.is-main-right > .webg-overlay-column-wrap:first-child {
  grid-column: 3;
}

.webg-overlay-root.is-spread-columns.is-main-right > .webg-overlay-column-wrap:last-child {
  grid-column: 1;
}

.webg-overlay-root.is-stacked > .webg-overlay-column-wrap:first-child,
.webg-overlay-root.is-stacked > .webg-overlay-column-wrap:last-child {
  grid-column: auto;
}

.webg-overlay-column-wrap {
  min-height: 0;
  pointer-events: none;
}

.webg-overlay-root.has-scroll-columns .webg-overlay-column-wrap {
  max-height: var(--webg-overlay-column-max-height);
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  pointer-events: auto;
}

.webg-overlay-column {
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: stretch;
  pointer-events: none;
}

.webg-overlay-root.is-stacked .webg-overlay-column {
  pointer-events: auto;
}

.webg-overlay-root.has-scroll-columns .webg-overlay-column {
  min-height: max-content;
}

.webg-overlay-panel {
  pointer-events: auto;
  box-sizing: border-box;
}

.webg-overlay-stack {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.webg-overlay-inline-stack {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.webg-overlay-eyebrow {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 10px;
  margin-bottom: 6px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.webg-overlay-title,
.webg-overlay-heading,
.webg-overlay-copy {
  margin: 0;
}

.webg-overlay-copy {
  margin-top: 6px;
}

.webg-overlay-button-grid {
  display: grid;
  grid-template-columns: repeat(var(--webg-overlay-button-columns, 2), minmax(0, 1fr));
  gap: 8px;
  margin-top: 10px;
}

.webg-overlay-root.is-compact .webg-overlay-button-grid {
  grid-template-columns: 1fr;
}

.webg-overlay-button-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}

.webg-overlay-button {
  cursor: pointer;
  text-align: left;
  transition: background-color 120ms ease, border-color 120ms ease, transform 120ms ease;
}

.webg-overlay-button:hover,
.webg-overlay-button:focus-visible {
  transform: translateY(-1px);
  outline: none;
}

.webg-overlay-button:disabled {
  cursor: not-allowed;
  opacity: 0.52;
  transform: none;
}

.webg-overlay-button-label,
.webg-overlay-button-note {
  display: block;
}

.webg-overlay-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  width: fit-content;
  max-width: 100%;
}

.webg-overlay-text,
.webg-overlay-code {
  margin-top: 10px;
  white-space: pre-wrap;
  word-break: break-word;
}

.webg-overlay-hint {
  margin-top: 8px;
}

.webg-overlay-status {
  position: fixed;
  left: 16px;
  bottom: 14px;
  max-width: min(560px, calc(var(--webg-overlay-viewport-width) - 32px - var(--webg-overlay-dock-offset)));
  box-sizing: border-box;
  pointer-events: none;
  white-space: pre-wrap;
  z-index: 840;
}

.webg-overlay-status.is-compact {
  left: 12px;
  right: 12px;
  bottom: 10px;
  max-width: none;
}

.webg-overlay-button.is-active {
  transform: none;
}
`;
    this.doc.head.appendChild(style);
  }

  setTheme(theme = {}) {
    this.theme = {
      ...DEFAULT_UI_THEME.uiPanel,
      ...(theme ?? {})
    };
    for (let i = 0; i < this.layouts.length; i++) {
      this.applyThemeToLayout(this.layouts[i]);
    }
  }

  createLayout(options = {}) {
    const root = this.doc.createElement("div");
    root.className = "webg-overlay-root";
    if (options.id) root.id = options.id;
    if (options.leftWidth) root.style.setProperty("--webg-overlay-left-width", options.leftWidth);
    if (options.rightWidth) root.style.setProperty("--webg-overlay-right-width", options.rightWidth);
    if (Number.isFinite(options.gap)) root.style.setProperty("--webg-overlay-gap", `${options.gap}px`);
    if (Number.isFinite(options.columnMaxHeight)) {
      root.style.setProperty("--webg-overlay-column-max-height", `${Math.max(120, Math.floor(options.columnMaxHeight))}px`);
    }
    if (Number.isFinite(options.top)) root.style.top = `${options.top}px`;
    if (Number.isFinite(options.left)) root.style.left = `${options.left}px`;
    if (Number.isFinite(options.right)) root.style.right = `${options.right}px`;

    const leftWrap = this.doc.createElement("div");
    leftWrap.className = "webg-overlay-column-wrap";
    const rightWrap = this.doc.createElement("div");
    rightWrap.className = "webg-overlay-column-wrap";
    const left = this.doc.createElement("div");
    left.className = "webg-overlay-column";
    const right = this.doc.createElement("div");
    right.className = "webg-overlay-column";
    leftWrap.appendChild(left);
    rightWrap.appendChild(right);
    root.appendChild(leftWrap);
    root.appendChild(rightWrap);
    root.classList.toggle("has-scroll-columns", options.scrollColumns === true);
    root.classList.toggle("is-spread-columns", options.spreadColumns === true);
    const containerElement = options.containerElement ?? this.doc.body;
    const positioningMode = options.positioningMode === "absolute" ? "absolute" : "fixed";
    const viewportElement = options.viewportElement ?? null;
    root.style.position = positioningMode;
    if (positioningMode === "absolute" && containerElement?.style) {
      const currentPosition = containerElement.style.position || window.getComputedStyle(containerElement).position;
      if (currentPosition === "static" || !currentPosition) {
        containerElement.style.position = "relative";
      }
    }

    const layout = {
      root,
      leftWrap,
      rightWrap,
      left,
      right,
      containerElement,
      positioningMode,
      viewportElement,
      collapseWidth: Number.isFinite(options.collapseWidth) ? Math.floor(options.collapseWidth) : 980,
      compactWidth: Number.isFinite(options.compactWidth) ? Math.floor(options.compactWidth) : 720,
      scrollColumns: options.scrollColumns === true,
      spreadColumns: options.spreadColumns === true,
      statusBlocks: []
    };
    this.layouts.push(layout);
    this.applyThemeToLayout(layout);
    this.syncResponsiveLayout(layout);
    containerElement.appendChild(root);
    return layout;
  }

  createPanel(parent, options = {}) {
    const panel = this.doc.createElement(options.tagName ?? "section");
    panel.className = "webg-overlay-panel";
    if (options.stack === true) {
      panel.classList.add("webg-overlay-stack");
    }
    if (options.id) panel.id = options.id;
    parent.appendChild(panel);
    return panel;
  }

  createGroup(parent) {
    const group = this.doc.createElement("div");
    group.className = "webg-overlay-inline-stack";
    parent.appendChild(group);
    return group;
  }

  createEyebrow(parent, text = "") {
    const node = this.doc.createElement("div");
    node.className = "webg-overlay-eyebrow";
    node.textContent = text;
    parent.appendChild(node);
    return node;
  }

  createTitle(parent, text = "", level = 1) {
    const tagName = level === 2 ? "h2" : "h1";
    const node = this.doc.createElement(tagName);
    node.className = level === 2 ? "webg-overlay-heading" : "webg-overlay-title";
    node.textContent = text;
    parent.appendChild(node);
    return node;
  }

  createCopy(parent, text = "") {
    const node = this.doc.createElement("p");
    node.className = "webg-overlay-copy";
    node.textContent = text;
    parent.appendChild(node);
    return node;
  }

  createHint(parent, text = "") {
    const node = this.doc.createElement("div");
    node.className = "webg-overlay-hint";
    node.textContent = text;
    parent.appendChild(node);
    return node;
  }

  createButtonGrid(parent, options = {}) {
    const node = this.doc.createElement("div");
    node.className = "webg-overlay-button-grid";
    node.style.setProperty("--webg-overlay-button-columns", String(Math.max(1, options.columns ?? 2)));
    parent.appendChild(node);
    return node;
  }

  createButtonRow(parent) {
    const node = this.doc.createElement("div");
    node.className = "webg-overlay-button-row";
    parent.appendChild(node);
    return node;
  }

  createButton(parent, options = {}) {
    const button = this.doc.createElement("button");
    button.type = "button";
    button.className = "webg-overlay-button";
    if (options.id) button.id = options.id;
    if (options.disabled === true) button.disabled = true;
    if (options.html) button.innerHTML = options.html;
    else button.textContent = options.text ?? "";
    parent.appendChild(button);
    return button;
  }

  createTextBlock(parent, options = {}) {
    const node = this.doc.createElement(options.tagName ?? "div");
    node.className = options.code === true ? "webg-overlay-code" : "webg-overlay-text";
    if (options.id) node.id = options.id;
    node.textContent = options.text ?? "";
    parent.appendChild(node);
    return node;
  }

  createPill(parent, options = {}) {
    const node = this.doc.createElement("div");
    node.className = "webg-overlay-pill";
    if (options.id) node.id = options.id;
    node.textContent = options.text ?? "";
    parent.appendChild(node);
    return node;
  }

  createStatusBlock(layout, options = {}) {
    const node = this.doc.createElement("div");
    node.className = "webg-overlay-status";
    if (options.id) node.id = options.id;
    node.textContent = options.text ?? "";
    node.style.setProperty("--webg-overlay-dock-offset", `${Number.isFinite(options.dockOffset) ? options.dockOffset : 0}px`);
    node.style.position = layout.positioningMode === "absolute" ? "absolute" : "fixed";
    (layout.containerElement ?? this.doc.body).appendChild(node);
    layout.statusBlocks.push(node);
    this.applyThemeToStatus(node);
    this.syncResponsiveLayout(layout);
    return node;
  }

  setDockOffset(layout, dockOffset = 0) {
    const px = `${Math.max(0, Math.floor(dockOffset))}px`;
    layout.root.style.setProperty("--webg-overlay-dock-offset", px);
    for (let i = 0; i < layout.statusBlocks.length; i++) {
      layout.statusBlocks[i].style.setProperty("--webg-overlay-dock-offset", px);
    }
  }

  setButtonActive(button, active = false) {
    if (!button) return;
    if (active) {
      button.style.background = this.theme.accentBackground;
      button.style.borderColor = this.theme.hintText;
      button.style.color = this.theme.textMain;
    } else {
      button.style.background = this.theme.buttonBackground;
      button.style.borderColor = this.theme.buttonBorder;
      button.style.color = this.theme.buttonText;
    }
  }

  syncAllResponsiveLayouts() {
    for (let i = 0; i < this.layouts.length; i++) {
      this.syncResponsiveLayout(this.layouts[i]);
    }
  }

  syncResponsiveLayout(layout) {
    if (typeof window === "undefined") return;
    // debug dock 表示中は viewport 全幅ではなく、dock を除いた表示領域で段組みを判断する
    // これにより右側の STATE panel が dock 領域へはみ出しにくくなる
    const rootStyle = window.getComputedStyle(layout.root);
    const dockOffset = Number.parseFloat(rootStyle.getPropertyValue("--webg-overlay-dock-offset")) || 0;
    const baseWidth = layout.viewportElement?.clientWidth
      || layout.containerElement?.clientWidth
      || window.innerWidth;
    const baseHeight = layout.viewportElement?.clientHeight
      || layout.containerElement?.clientHeight
      || window.innerHeight;
    const availableWidth = Math.max(0, baseWidth - dockOffset);
    layout.root.classList.toggle("is-stacked", availableWidth <= layout.collapseWidth);
    const compact = availableWidth <= layout.compactWidth;
    layout.root.classList.toggle("is-compact", compact);
    layout.root.style.setProperty("--webg-overlay-viewport-width", `${Math.max(0, Math.floor(baseWidth))}px`);
    layout.root.style.setProperty("--webg-overlay-viewport-height", `${Math.max(0, Math.floor(baseHeight))}px`);
    for (let i = 0; i < layout.statusBlocks.length; i++) {
      layout.statusBlocks[i].style.setProperty("--webg-overlay-viewport-width", `${Math.max(0, Math.floor(baseWidth))}px`);
      layout.statusBlocks[i].classList.toggle("is-compact", compact);
    }
    this.applyThemeToLayout(layout);
  }

  applyThemeToLayout(layout) {
    const root = layout.root;
    root.style.color = this.theme.textMain;
    root.style.font = this.theme.rootFont ?? `12px/1.45 "Avenir Next", "Hiragino Sans", "Yu Gothic", sans-serif`;
    this.applyThemeBySelector(root, ".webg-overlay-panel", (node) => {
      node.style.padding = this.theme.panelPadding;
      node.style.borderRadius = this.theme.panelRadius;
      node.style.border = `1px solid ${this.theme.panelBorder}`;
      node.style.background = this.theme.panelBackground;
      node.style.boxShadow = this.theme.panelShadow;
      node.style.backdropFilter = `blur(${this.theme.backdropBlur})`;
    });
    this.applyThemeBySelector(root, ".webg-overlay-eyebrow", (node) => {
      node.style.borderRadius = this.theme.pillRadius;
      node.style.background = this.theme.accentBackground;
      node.style.color = this.theme.accentText;
      node.style.font = this.theme.eyebrowFont ?? `600 9px/1.1 "Avenir Next", "Hiragino Sans", "Yu Gothic", sans-serif`;
    });
    this.applyThemeBySelector(root, ".webg-overlay-title", (node) => {
      node.style.color = this.theme.textMain;
      node.style.font = this.theme.titleFont ?? `600 18px/1.25 "Avenir Next", "Hiragino Sans", "Yu Gothic", sans-serif`;
      if (root.classList.contains("is-compact")) {
        node.style.font = this.theme.titleCompactFont ?? `600 16px/1.25 "Avenir Next", "Hiragino Sans", "Yu Gothic", sans-serif`;
      }
    });
    this.applyThemeBySelector(root, ".webg-overlay-heading", (node) => {
      node.style.color = this.theme.accentText;
      node.style.font = this.theme.headingFont ?? `600 11px/1.35 "Avenir Next", "Hiragino Sans", "Yu Gothic", sans-serif`;
      node.style.letterSpacing = "0.06em";
      node.style.textTransform = "uppercase";
    });
    this.applyThemeBySelector(root, ".webg-overlay-copy", (node) => {
      node.style.color = this.theme.textSub;
      node.style.font = this.theme.copyFont ?? `12px/1.6 "Avenir Next", "Hiragino Sans", "Yu Gothic", sans-serif`;
    });
    this.applyThemeBySelector(root, ".webg-overlay-hint", (node) => {
      node.style.color = this.theme.hintText;
      node.style.font = this.theme.hintFont ?? `10px/1.5 "Avenir Next", "Hiragino Sans", "Yu Gothic", sans-serif`;
    });
    this.applyThemeBySelector(root, ".webg-overlay-button", (node) => {
      node.style.padding = "8px 10px";
      node.style.border = `1px solid ${this.theme.buttonBorder}`;
      node.style.background = this.theme.buttonBackground;
      node.style.color = this.theme.buttonText;
      node.style.borderRadius = this.theme.buttonRadius;
      node.style.font = this.theme.buttonFont ?? `600 12px/1.35 "Avenir Next", "Hiragino Sans", "Yu Gothic", sans-serif`;
      node.onmouseenter = () => {
        if (node.disabled) return;
        node.style.background = this.theme.buttonHoverBackground;
        node.style.borderColor = this.theme.buttonHoverBorder;
      };
      node.onmouseleave = () => {
        this.setButtonActive(node, node.classList.contains("is-active"));
      };
    });
    this.applyThemeBySelector(root, ".webg-overlay-button-label", (node) => {
      node.style.color = this.theme.textMain;
      node.style.fontSize = this.theme.buttonLabelSize ?? "13px";
    });
    this.applyThemeBySelector(root, ".webg-overlay-button-note", (node) => {
      node.style.marginTop = "3px";
      node.style.color = this.theme.textSub;
      node.style.font = this.theme.buttonNoteFont ?? `500 11px/1.35 "Avenir Next", "Hiragino Sans", "Yu Gothic", sans-serif`;
    });
    this.applyThemeBySelector(root, ".webg-overlay-pill", (node) => {
      node.style.padding = "0 10px";
      node.style.borderRadius = this.theme.pillRadius;
      node.style.border = `1px solid ${this.theme.buttonBorder}`;
      node.style.background = this.theme.accentBackground;
      node.style.color = this.theme.accentText;
      node.style.font = this.theme.pillFont ?? `600 11px/1.2 "Avenir Next", "Hiragino Sans", "Yu Gothic", sans-serif`;
      node.style.letterSpacing = "0.06em";
      node.style.textTransform = "uppercase";
    });
    this.applyThemeBySelector(root, ".webg-overlay-text, .webg-overlay-code", (node) => {
      node.style.padding = "10px 12px";
      node.style.borderRadius = this.theme.fieldRadius;
      node.style.background = this.theme.textBlockBackground;
      node.style.border = `1px solid ${this.theme.panelBorder}`;
      node.style.color = this.theme.textSub;
      node.style.font = this.theme.textBlockFont ?? `12px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    });
    for (let i = 0; i < layout.statusBlocks.length; i++) {
      this.applyThemeToStatus(layout.statusBlocks[i]);
    }
  }

  applyThemeToStatus(node) {
    node.style.padding = this.theme.statusPadding;
    node.style.borderRadius = this.theme.fieldRadius;
    node.style.background = this.theme.statusBackground ?? this.theme.panelBackground;
    node.style.border = `1px solid ${this.theme.panelBorder}`;
    node.style.color = this.theme.textSub;
    node.style.font = this.theme.statusFont ?? "12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    node.style.boxShadow = this.theme.panelShadow;
    node.style.backdropFilter = `blur(${this.theme.statusBackdropBlur ?? this.theme.backdropBlur})`;
  }

  applyThemeBySelector(root, selector, callback) {
    const nodes = root.querySelectorAll(selector);
    for (let i = 0; i < nodes.length; i++) {
      callback(nodes[i]);
    }
  }
}
