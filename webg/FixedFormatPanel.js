// ---------------------------------------------
// FixedFormatPanel.js 2026/04/09
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import { DEFAULT_UI_THEME } from "./WebgUiTheme.js";

export default class FixedFormatPanel {

  constructor(options = {}) {
    this.doc = options.document ?? document;
    this.theme = {
      ...DEFAULT_UI_THEME.fixedFormatPanel,
      ...(options.theme ?? {})
    };
    this.getDockOffset = typeof options.getDockOffset === "function"
      ? options.getDockOffset
      : (() => 12);
    this.getContainerElement = typeof options.getContainerElement === "function"
      ? options.getContainerElement
      : (() => this.doc.body);
    this.getPositioningMode = typeof options.getPositioningMode === "function"
      ? options.getPositioningMode
      : (() => "fixed");
    this.panels = new Map();
  }

  // theme を差し替えたあとは、次に showText() した panel から新色を使う
  // 既存 panel は app 側が必要に応じて再表示し、内容更新と theme 更新を同時に行う
  setTheme(theme = {}) {
    this.theme = {
      ...DEFAULT_UI_THEME.fixedFormatPanel,
      ...(theme ?? {})
    };
  }

  applyPanelStyle(panel, options = {}, dockOffset = 12) {
    const positioningMode = options.positioningMode === "absolute"
      ? "absolute"
      : (options.positioningMode ?? this.getPositioningMode());
    panel.style.position = positioningMode;
    const anchorElement = options.viewportElement ?? null;
    const containerElement = options.containerElement ?? this.getContainerElement();
    const rect = anchorElement?.getBoundingClientRect?.() ?? null;
    const leftInset = Number.isFinite(options.left) ? Number(options.left) : 12;
    const topInset = Number.isFinite(options.top) ? Number(options.top) : 12;
    const rightInset = Number.isFinite(options.right) ? Number(options.right) : dockOffset;
    if (rect && positioningMode === "absolute" && containerElement?.getBoundingClientRect) {
      const containerRect = containerElement.getBoundingClientRect();
      const containerWidth = containerElement.clientWidth || Math.round(containerRect.width);
      panel.style.left = `${Math.round(rect.left - containerRect.left + leftInset)}px`;
      panel.style.top = `${Math.round(rect.top - containerRect.top + topInset)}px`;
      panel.style.right = `${Math.max(0, Math.round(containerWidth - (rect.right - containerRect.left) + rightInset))}px`;
    } else if (rect) {
      const viewportRight = typeof window !== "undefined" ? window.innerWidth : 0;
      panel.style.left = `${Math.round(rect.left + leftInset)}px`;
      panel.style.top = `${Math.round(rect.top + topInset)}px`;
      panel.style.right = `${Math.max(0, Math.round(viewportRight - rect.right + rightInset))}px`;
    } else {
      panel.style.left = `${leftInset}px`;
      panel.style.top = `${topInset}px`;
      panel.style.right = `${rightInset}px`;
    }
    panel.style.margin = "0";
    panel.style.padding = `${Number.isFinite(options.padding) ? options.padding : 12}px`;
    panel.style.whiteSpace = options.whiteSpace ?? "pre-wrap";
    panel.style.color = options.color ?? this.theme.errorText;
    panel.style.background = options.background ?? this.theme.errorBackground;
    panel.style.font = options.font ?? "14px/1.5 monospace";
    panel.style.zIndex = String(Number.isFinite(options.zIndex) ? options.zIndex : 1000);
    panel.style.borderRadius = options.borderRadius ?? "0";
    panel.style.border = options.border ?? "0";
    panel.style.maxHeight = options.maxHeight ?? "40vh";
    panel.style.overflow = options.overflow ?? "auto";
  }

  showText(text, options = {}) {
    const panelId = options.id ?? "default";
    const dockOffset = Number.isFinite(options.right)
      ? Number(options.right)
      : this.getDockOffset();
    const containerElement = options.containerElement ?? this.getContainerElement();
    let panel = this.panels.get(panelId);
    if (!panel) {
      panel = this.doc.createElement("pre");
      panel.dataset.webgPanelId = panelId;
      this.panels.set(panelId, panel);
    }
    this.applyPanelStyle(panel, options, dockOffset);
    panel.textContent = String(text ?? "");
    if (!panel.isConnected) {
      (containerElement ?? this.doc.body).appendChild(panel);
    }
    return panel;
  }

  has(panelId = "default") {
    const panel = this.panels.get(panelId);
    return !!panel && panel.isConnected;
  }

  clear(panelId = "default") {
    const panel = this.panels.get(panelId);
    if (!panel) return false;
    panel.remove();
    this.panels.delete(panelId);
    return true;
  }

  clearAll() {
    const ids = [...this.panels.keys()];
    for (let i = 0; i < ids.length; i++) {
      this.clear(ids[i]);
    }
  }
}
