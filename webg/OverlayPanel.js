// ---------------------------------------------
// OverlayPanel.js 2026/04/30
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import { DEFAULT_UI_THEME } from "./WebgUiTheme.js";
import util from "./util.js";

const PANEL_STYLE_ID = "webg-overlay-panel-style-v1";
const ANCHORS = [
  "top-left",
  "top-center",
  "top-right",
  "middle-left",
  "middle-center",
  "middle-right",
  "bottom-left",
  "bottom-center",
  "bottom-right"
];

const readSizeOption = (value, name, fallback = undefined) => {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value === "string") {
    if (value.length <= 0) {
      throw new Error(`${name} must not be empty`);
    }
    return value;
  }
  return `${util.readFiniteNumber(value, name)}px`;
};

const normalizeTextLines = (options = {}, path = "OverlayPanel options") => {
  if (options.text !== undefined && options.lines !== undefined) {
    throw new Error(`${path} must not specify both text and lines`);
  }
  if (options.lines !== undefined) {
    if (!Array.isArray(options.lines)) {
      throw new Error(`${path}.lines must be an array`);
    }
    return options.lines.map((line, index) => String(util.readOptionalString(
      typeof line === "string" ? line : String(line),
      `${path}.lines[${index}]`,
      ""
    ))).join("\n");
  }
  return util.readOptionalString(options.text, `${path}.text`, "", { allowEmpty: true });
};

const resolveTextInput = (safeOptions = {}, base = {}) => {
  // lines で更新する場合は、以前の text を持ち越すと
  // 「text と lines の同時指定」になってしまうため、明示的に切り替える
  if (safeOptions.lines !== undefined) {
    return {
      text: undefined,
      lines: safeOptions.lines
    };
  }
  if (safeOptions.text !== undefined) {
    return {
      text: safeOptions.text,
      lines: undefined
    };
  }
  return {
    text: base.text,
    lines: undefined
  };
};

const normalizeActionItems = (items = undefined, name = "OverlayPanel items") => {
  if (items === undefined) {
    return [];
  }
  if (!Array.isArray(items)) {
    throw new Error(`${name} must be an array`);
  }
  const ids = new Set();
  return items.map((item, index) => {
    const safeItem = util.readPlainObject(item, `${name}[${index}]`);
    const id = util.readOptionalString(safeItem.id, `${name}[${index}].id`, undefined, {
      trim: true,
      allowEmpty: false
    });
    if (ids.has(id)) {
      throw new Error(`${name}[${index}].id must be unique within the panel`);
    }
    ids.add(id);
    return {
      id,
      label: util.readOptionalString(safeItem.label, `${name}[${index}].label`, id, {
        trim: false,
        allowEmpty: false
      }),
      kind: util.readOptionalEnum(
        safeItem.kind,
        `${name}[${index}].kind`,
        "secondary",
        ["primary", "secondary", "ghost"]
      )
    };
  });
};

export default class OverlayPanel {
  // OverlayPanel:
  // - scene 上に重ねる DOM 文字表示を 1 つの基盤へ統合する
  // - help / report / error / log の違いは class 名ではなく option で表す
  // - button, choice, collapse, close, scroll, anchor 配置を同じ部品で扱う
  constructor(options = {}) {
    const safeOptions = util.readPlainObject(options, "OverlayPanel options");
    this.doc = options.document ?? (typeof document !== "undefined" ? document : null);
    this.theme = {
      ...DEFAULT_UI_THEME.uiPanel,
      ...util.readPlainObject(safeOptions.theme, "OverlayPanel theme", {})
    };
    this.getDockOffset = util.readOptionalFunction(safeOptions.getDockOffset, "OverlayPanel getDockOffset", () => 0, {
      allowNull: false
    });
    this.options = null;
    this.root = null;
    this.backdrop = null;
    this.shell = null;
    this.panel = null;
    this.header = null;
    this.titleEl = null;
    this.headerButtons = null;
    this.bodyEl = null;
    this.choiceWrap = null;
    this.buttonWrap = null;
    this.closeButton = null;
    this.collapseButton = null;
    this.actionButtonMap = new Map();
    this.ensureStyle();
    this.applyOptions(safeOptions);
  }

  ensureStyle() {
    if (!this.doc || this.doc.getElementById(PANEL_STYLE_ID)) {
      return;
    }
    const style = this.doc.createElement("style");
    style.id = PANEL_STYLE_ID;
    style.textContent = `
.webg-overlay-panel-root {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 840;
}
.webg-overlay-panel-root[hidden] {
  display: none !important;
}
.webg-overlay-panel-backdrop {
  position: absolute;
  inset: 0;
  background: transparent;
  pointer-events: none;
}
.webg-overlay-panel-root.is-modal {
  pointer-events: auto;
}
.webg-overlay-panel-root.is-modal > .webg-overlay-panel-backdrop {
  pointer-events: auto;
}
.webg-overlay-panel-shell {
  position: absolute;
  pointer-events: none;
}
.webg-overlay-panel {
  pointer-events: auto;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.webg-overlay-panel-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}
.webg-overlay-panel-title {
  margin: 0;
  white-space: pre-wrap;
}
.webg-overlay-panel-header-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}
.webg-overlay-panel-body {
  margin: 0;
  min-width: 0;
}
.webg-overlay-panel-body.is-hidden,
.webg-overlay-panel-choice-wrap.is-hidden,
.webg-overlay-panel-button-wrap.is-hidden {
  display: none !important;
}
.webg-overlay-panel-choice-wrap,
.webg-overlay-panel-button-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.webg-overlay-panel-button {
  cursor: pointer;
  transition: background-color 120ms ease, border-color 120ms ease, transform 120ms ease;
}
.webg-overlay-panel-button:hover,
.webg-overlay-panel-button:focus-visible {
  transform: translateY(-1px);
  outline: none;
}
`;
    this.doc.head.appendChild(style);
  }

  setTheme(theme = {}) {
    this.theme = {
      ...DEFAULT_UI_THEME.uiPanel,
      ...util.readPlainObject(theme, "OverlayPanel theme", {})
    };
    this.applyTheme();
    return this;
  }

  // theme 差し替え時は option を保ったまま見た目だけを更新する
  // render の中で button や panel style を作り直し、その後 layout も再同期する
  applyTheme() {
    if (!this.root || !this.options) {
      return this;
    }
    this.render();
    this.syncLayout();
    return this;
  }

  normalizeOptions(options = {}, previous = null) {
    const path = "OverlayPanel options";
    const safeOptions = util.readPlainObject(options, path);
    const base = previous ?? {};
    const textInput = resolveTextInput(safeOptions, base);
    const normalized = {
      id: util.readOptionalString(safeOptions.id, `${path}.id`, base.id, {
        trim: true,
        allowEmpty: false
      }),
      title: util.readOptionalString(safeOptions.title, `${path}.title`, base.title ?? "", {
        allowEmpty: true
      }),
      text: normalizeTextLines(textInput, path),
      format: util.readOptionalEnum(
        safeOptions.format,
        `${path}.format`,
        base.format ?? "plain",
        ["plain", "pre"]
      ),
      visible: util.readOptionalBoolean(safeOptions.visible, `${path}.visible`, base.visible ?? true),
      anchor: util.readOptionalEnum(
        safeOptions.anchor,
        `${path}.anchor`,
        base.anchor ?? "top-left",
        ANCHORS
      ),
      offsetX: util.readOptionalFiniteNumber(safeOptions.offsetX, `${path}.offsetX`, base.offsetX ?? 16),
      offsetY: util.readOptionalFiniteNumber(safeOptions.offsetY, `${path}.offsetY`, base.offsetY ?? 16),
      width: readSizeOption(safeOptions.width, `${path}.width`, base.width),
      minWidth: readSizeOption(safeOptions.minWidth, `${path}.minWidth`, base.minWidth),
      maxWidth: readSizeOption(safeOptions.maxWidth, `${path}.maxWidth`, base.maxWidth ?? "420px"),
      maxHeight: readSizeOption(safeOptions.maxHeight, `${path}.maxHeight`, base.maxHeight ?? "40vh"),
      zIndex: util.readOptionalInteger(safeOptions.zIndex, `${path}.zIndex`, base.zIndex ?? 840, { min: 0 }),
      font: util.readOptionalString(safeOptions.font, `${path}.font`, base.font ?? "", { allowEmpty: true }),
      color: util.readOptionalString(safeOptions.color, `${path}.color`, base.color ?? "", { allowEmpty: true }),
      background: util.readOptionalString(safeOptions.background, `${path}.background`, base.background ?? "", { allowEmpty: true }),
      border: util.readOptionalString(safeOptions.border, `${path}.border`, base.border ?? "", { allowEmpty: true }),
      borderRadius: util.readOptionalString(safeOptions.borderRadius, `${path}.borderRadius`, base.borderRadius ?? "", { allowEmpty: true }),
      boxShadow: util.readOptionalString(safeOptions.boxShadow, `${path}.boxShadow`, base.boxShadow ?? "", { allowEmpty: true }),
      padding: readSizeOption(safeOptions.padding, `${path}.padding`, base.padding),
      positioningMode: util.readOptionalPositioningMode(
        safeOptions.positioningMode,
        `${path}.positioningMode`,
        base.positioningMode ?? "fixed"
      ),
      containerElement: util.readOptionalElement(
        safeOptions.containerElement,
        `${path}.containerElement`,
        base.containerElement ?? this.doc?.body ?? null
      ),
      viewportElement: util.readOptionalElement(
        safeOptions.viewportElement,
        `${path}.viewportElement`,
        base.viewportElement ?? null
      ),
      avoidDebugDock: util.readOptionalBoolean(
        safeOptions.avoidDebugDock,
        `${path}.avoidDebugDock`,
        base.avoidDebugDock ?? true
      ),
      scrollY: util.readOptionalBoolean(safeOptions.scrollY, `${path}.scrollY`, base.scrollY ?? false),
      scrollX: util.readOptionalBoolean(safeOptions.scrollX, `${path}.scrollX`, base.scrollX ?? false),
      overflow: util.readOptionalString(safeOptions.overflow, `${path}.overflow`, base.overflow ?? "", {
        allowEmpty: true
      }),
      whiteSpace: util.readOptionalString(safeOptions.whiteSpace, `${path}.whiteSpace`, base.whiteSpace ?? "", {
        allowEmpty: true
      }),
      closable: util.readOptionalBoolean(safeOptions.closable, `${path}.closable`, base.closable ?? false),
      collapsible: util.readOptionalBoolean(safeOptions.collapsible, `${path}.collapsible`, base.collapsible ?? false),
      collapsed: util.readOptionalBoolean(safeOptions.collapsed, `${path}.collapsed`, base.collapsed ?? false),
      showCloseButton: util.readOptionalBoolean(
        safeOptions.showCloseButton,
        `${path}.showCloseButton`,
        base.showCloseButton ?? (base.closable ?? false)
      ),
      showCollapseButton: util.readOptionalBoolean(
        safeOptions.showCollapseButton,
        `${path}.showCollapseButton`,
        base.showCollapseButton ?? (base.collapsible ?? false)
      ),
      closeOnEsc: util.readOptionalBoolean(safeOptions.closeOnEsc, `${path}.closeOnEsc`, base.closeOnEsc ?? false),
      collapseLabelExpanded: util.readOptionalString(
        safeOptions.collapseLabelExpanded,
        `${path}.collapseLabelExpanded`,
        base.collapseLabelExpanded ?? "Hide"
      ),
      collapseLabelCollapsed: util.readOptionalString(
        safeOptions.collapseLabelCollapsed,
        `${path}.collapseLabelCollapsed`,
        base.collapseLabelCollapsed ?? "Show"
      ),
      closeLabel: util.readOptionalString(safeOptions.closeLabel, `${path}.closeLabel`, base.closeLabel ?? "Close"),
      modal: util.readOptionalBoolean(safeOptions.modal, `${path}.modal`, base.modal ?? false),
      pauseScene: util.readOptionalBoolean(safeOptions.pauseScene, `${path}.pauseScene`, base.pauseScene ?? false),
      buttons: normalizeActionItems(safeOptions.buttons ?? base.buttons, `${path}.buttons`),
      choices: normalizeActionItems(safeOptions.choices ?? base.choices, `${path}.choices`),
      defaultAction: util.readOptionalString(
        safeOptions.defaultAction,
        `${path}.defaultAction`,
        base.defaultAction ?? "",
        { allowEmpty: true }
      ),
      onAction: util.readOptionalFunction(safeOptions.onAction, `${path}.onAction`, base.onAction ?? null),
      onOpen: util.readOptionalFunction(safeOptions.onOpen, `${path}.onOpen`, base.onOpen ?? null),
      onClose: util.readOptionalFunction(safeOptions.onClose, `${path}.onClose`, base.onClose ?? null),
      onCollapse: util.readOptionalFunction(safeOptions.onCollapse, `${path}.onCollapse`, base.onCollapse ?? null),
      // 旧 API 互換で内部的にだけ使う直接 inset 指定
      top: util.readOptionalFiniteNumber(safeOptions.top, `${path}.top`, base.top),
      left: util.readOptionalFiniteNumber(safeOptions.left, `${path}.left`, base.left),
      right: util.readOptionalFiniteNumber(safeOptions.right, `${path}.right`, base.right),
      bottom: util.readOptionalFiniteNumber(safeOptions.bottom, `${path}.bottom`, base.bottom)
    };
    if (!normalized.id) {
      throw new Error("OverlayPanel options.id must be a non-empty string");
    }
    if (normalized.minWidth && normalized.maxWidth) {
      const minValue = Number.parseFloat(normalized.minWidth);
      const maxValue = Number.parseFloat(normalized.maxWidth);
      if (Number.isFinite(minValue) && Number.isFinite(maxValue) && minValue > maxValue) {
        throw new Error("OverlayPanel options.minWidth must be <= maxWidth");
      }
    }
    if (normalized.format === "plain" && normalized.whiteSpace === "") {
      normalized.whiteSpace = "pre-wrap";
    } else if (normalized.format === "pre" && normalized.whiteSpace === "") {
      normalized.whiteSpace = "pre";
    }
    if (normalized.modal === true && normalized.pauseScene === false) {
      throw new Error("OverlayPanel options.modal=true requires pauseScene=true");
    }
    return normalized;
  }

  ensureDom() {
    if (this.root) {
      return;
    }
    this.root = this.doc.createElement("div");
    this.root.className = "webg-overlay-panel-root";
    this.root.dataset.webgOverlayPanelId = this.options.id;
    this.root.tabIndex = -1;
    this.backdrop = this.doc.createElement("div");
    this.backdrop.className = "webg-overlay-panel-backdrop";
    this.shell = this.doc.createElement("div");
    this.shell.className = "webg-overlay-panel-shell";
    this.panel = this.doc.createElement("section");
    this.panel.className = "webg-overlay-panel";
    this.header = this.doc.createElement("div");
    this.header.className = "webg-overlay-panel-header";
    this.titleEl = this.doc.createElement("h2");
    this.titleEl.className = "webg-overlay-panel-title";
    this.headerButtons = this.doc.createElement("div");
    this.headerButtons.className = "webg-overlay-panel-header-buttons";
    this.bodyEl = this.doc.createElement("div");
    this.bodyEl.className = "webg-overlay-panel-body";
    this.choiceWrap = this.doc.createElement("div");
    this.choiceWrap.className = "webg-overlay-panel-choice-wrap";
    this.buttonWrap = this.doc.createElement("div");
    this.buttonWrap.className = "webg-overlay-panel-button-wrap";

    this.header.appendChild(this.titleEl);
    this.header.appendChild(this.headerButtons);
    this.panel.appendChild(this.header);
    this.panel.appendChild(this.bodyEl);
    this.panel.appendChild(this.choiceWrap);
    this.panel.appendChild(this.buttonWrap);
    this.shell.appendChild(this.panel);
    this.root.appendChild(this.backdrop);
    this.root.appendChild(this.shell);
    this.root.addEventListener("keydown", (event) => this.handleKeyDown(event));
  }

  applyOptions(options = {}) {
    const previousVisible = this.options?.visible ?? false;
    this.options = this.normalizeOptions(options, this.options);
    this.ensureDom();
    this.mount();
    this.render();
    if (this.options.visible && previousVisible === false) {
      this.options.onOpen?.({ panelId: this.options.id });
    }
    return this;
  }

  mount() {
    const container = this.options.containerElement ?? this.doc?.body ?? null;
    if (!container) {
      return;
    }
    if (!this.root.isConnected || this.root.parentNode !== container) {
      this.root.remove();
      container.appendChild(this.root);
    }
  }

  render() {
    this.root.hidden = this.options.visible !== true;
    this.root.classList.toggle("is-modal", this.options.modal === true);
    this.actionButtonMap.clear();
    this.root.style.position = this.options.positioningMode;
    this.root.style.zIndex = String(this.options.zIndex);
    this.backdrop.style.display = this.options.modal === true ? "" : "none";
    this.panel.style.width = this.options.width ?? "auto";
    this.panel.style.minWidth = this.options.minWidth ?? "0";
    this.panel.style.maxWidth = this.options.maxWidth ?? "420px";
    this.panel.style.maxHeight = this.options.maxHeight ?? "40vh";
    this.panel.style.overflowY = this.options.scrollY ? "auto" : "visible";
    this.panel.style.overflowX = this.options.scrollX ? "auto" : "visible";
    if (this.options.overflow) {
      this.panel.style.overflow = this.options.overflow;
    }
    this.panel.style.background = this.options.background || this.theme.panelBackground;
    this.panel.style.border = this.options.border || `1px solid ${this.theme.panelBorder}`;
    this.panel.style.boxShadow = this.options.boxShadow || this.theme.panelShadow;
    this.panel.style.borderRadius = this.options.borderRadius || this.theme.panelRadius;
    this.panel.style.padding = this.options.padding || this.theme.panelPadding;
    this.panel.style.backdropFilter = `blur(${this.theme.backdropBlur})`;
    this.panel.style.color = this.options.color || this.theme.textMain;
    this.bodyEl.style.whiteSpace = this.options.whiteSpace;
    this.bodyEl.style.font = this.options.font || (this.options.format === "pre" ? "14px/1.5 monospace" : "");
    this.bodyEl.style.background = this.theme.textBlockBackground;
    this.bodyEl.style.borderRadius = this.theme.fieldRadius;
    this.bodyEl.style.padding = "10px 12px";
    this.titleEl.textContent = this.options.title ?? "";
    this.titleEl.style.color = this.theme.accentText;
    this.titleEl.style.fontSize = "16px";
    this.titleEl.style.lineHeight = "1.4";
    this.titleEl.style.display = this.options.title ? "" : "none";
    this.bodyEl.textContent = this.options.text ?? "";
    this.bodyEl.classList.toggle("is-hidden", this.options.collapsed === true);

    this.renderHeaderButtons();
    this.renderActionButtons(this.choiceWrap, this.options.choices, "choice", this.options.collapsed === true);
    this.renderActionButtons(this.buttonWrap, this.options.buttons, "button", this.options.collapsed === true);
    this.syncLayout();
  }

  renderHeaderButtons() {
    this.headerButtons.textContent = "";
    this.closeButton = null;
    this.collapseButton = null;
    if (this.options.showCollapseButton && this.options.collapsible) {
      this.collapseButton = this.createButton(
        this.options.collapsed ? this.options.collapseLabelCollapsed : this.options.collapseLabelExpanded,
        this.options.collapsed ? "ghost" : "secondary",
        `${this.options.id}:collapse`,
        () => {
          this.setCollapsed(!this.options.collapsed);
        }
      );
      this.headerButtons.appendChild(this.collapseButton);
    }
    if (this.options.showCloseButton && this.options.closable) {
      this.closeButton = this.createButton(
        this.options.closeLabel,
        "secondary",
        `${this.options.id}:close`,
        () => {
          this.hide();
        }
      );
      this.headerButtons.appendChild(this.closeButton);
    }
    this.header.style.display = (this.options.title || this.headerButtons.childElementCount > 0) ? "" : "none";
  }

  renderActionButtons(container, items, prefix, hidden) {
    container.textContent = "";
    container.classList.toggle("is-hidden", hidden || items.length <= 0);
    items.forEach((item) => {
      const button = this.createButton(item.label, item.kind, `${prefix}:${item.id}`, () => {
        this.options.onAction?.({
          panelId: this.options.id,
          actionId: item.id
        });
      });
      container.appendChild(button);
      this.actionButtonMap.set(item.id, button);
    });
  }

  createButton(label, kind, key, onClick) {
    const button = this.doc.createElement("button");
    button.type = "button";
    button.className = "webg-overlay-panel-button";
    button.dataset.webgActionKey = key;
    button.textContent = label;
    button.style.padding = "7px 12px";
    button.style.borderRadius = this.theme.buttonRadius;
    button.style.border = `1px solid ${this.theme.buttonBorder}`;
    button.style.background = kind === "primary"
      ? this.theme.accentBackground
      : this.theme.buttonBackground;
    button.style.color = kind === "primary"
      ? this.theme.accentText
      : this.theme.buttonText;
    button.addEventListener("click", onClick);
    return button;
  }

  handleKeyDown(event) {
    if (this.options.closeOnEsc && event.key === "Escape" && this.options.visible === true) {
      event.preventDefault();
      this.hide();
      return;
    }
    if (event.key === "Enter" && this.options.defaultAction) {
      const button = this.actionButtonMap.get(this.options.defaultAction);
      if (button) {
        event.preventDefault();
        button.click();
      }
    }
  }

  syncLayout() {
    if (!this.root || !this.options) {
      return;
    }
    const dockOffset = this.options.avoidDebugDock ? this.getDockOffset() : 0;
    const directPosition = Number.isFinite(this.options.top)
      || Number.isFinite(this.options.left)
      || Number.isFinite(this.options.right)
      || Number.isFinite(this.options.bottom);
    this.shell.style.left = "";
    this.shell.style.top = "";
    this.shell.style.transform = "";
    this.shell.style.right = "";
    this.shell.style.bottom = "";
    if (directPosition) {
      if (Number.isFinite(this.options.left) && Number.isFinite(this.options.right)) {
        this.shell.style.left = `${this.options.left}px`;
        this.shell.style.right = `${this.options.right + dockOffset}px`;
      } else if (Number.isFinite(this.options.left)) {
        this.shell.style.left = `${this.options.left}px`;
      } else if (Number.isFinite(this.options.right)) {
        this.shell.style.left = `calc(100% - ${this.options.right + dockOffset}px)`;
        this.shell.style.transform = "translateX(-100%)";
      } else {
        this.shell.style.left = "16px";
      }
      if (Number.isFinite(this.options.top) && Number.isFinite(this.options.bottom)) {
        this.shell.style.top = `${this.options.top}px`;
        this.shell.style.bottom = `${this.options.bottom}px`;
      } else if (Number.isFinite(this.options.top)) {
        this.shell.style.top = `${this.options.top}px`;
      } else if (Number.isFinite(this.options.bottom)) {
        this.shell.style.top = `calc(100% - ${this.options.bottom}px)`;
        this.shell.style.transform = this.shell.style.transform
          ? `${this.shell.style.transform} translateY(-100%)`
          : "translateY(-100%)";
      } else {
        this.shell.style.top = "16px";
      }
      return;
    }
    const leftBase = "16px";
    const topBase = "16px";
    const rightBase = `${16 + dockOffset}px`;
    const bottomBase = "16px";
    switch (this.options.anchor) {
      case "top-left":
        this.shell.style.left = leftBase;
        this.shell.style.top = topBase;
        this.shell.style.transform = `translate(${this.options.offsetX}px, ${this.options.offsetY}px)`;
        break;
      case "top-center":
        this.shell.style.left = "50%";
        this.shell.style.top = topBase;
        this.shell.style.transform = `translate(calc(-50% + ${this.options.offsetX}px), ${this.options.offsetY}px)`;
        break;
      case "top-right":
        this.shell.style.left = `calc(100% - ${rightBase})`;
        this.shell.style.top = topBase;
        this.shell.style.transform = `translate(calc(-100% + ${this.options.offsetX}px), ${this.options.offsetY}px)`;
        break;
      case "middle-left":
        this.shell.style.left = leftBase;
        this.shell.style.top = "50%";
        this.shell.style.transform = `translate(${this.options.offsetX}px, calc(-50% + ${this.options.offsetY}px))`;
        break;
      case "middle-center":
        this.shell.style.left = "50%";
        this.shell.style.top = "50%";
        this.shell.style.transform = `translate(calc(-50% + ${this.options.offsetX}px), calc(-50% + ${this.options.offsetY}px))`;
        break;
      case "middle-right":
        this.shell.style.left = `calc(100% - ${rightBase})`;
        this.shell.style.top = "50%";
        this.shell.style.transform = `translate(calc(-100% + ${this.options.offsetX}px), calc(-50% + ${this.options.offsetY}px))`;
        break;
      case "bottom-left":
        this.shell.style.left = leftBase;
        this.shell.style.top = `calc(100% - ${bottomBase})`;
        this.shell.style.transform = `translate(${this.options.offsetX}px, calc(-100% + ${this.options.offsetY}px))`;
        break;
      case "bottom-center":
        this.shell.style.left = "50%";
        this.shell.style.top = `calc(100% - ${bottomBase})`;
        this.shell.style.transform = `translate(calc(-50% + ${this.options.offsetX}px), calc(-100% + ${this.options.offsetY}px))`;
        break;
      case "bottom-right":
        this.shell.style.left = `calc(100% - ${rightBase})`;
        this.shell.style.top = `calc(100% - ${bottomBase})`;
        this.shell.style.transform = `translate(calc(-100% + ${this.options.offsetX}px), calc(-100% + ${this.options.offsetY}px))`;
        break;
      default:
        throw new Error(`OverlayPanel anchor is not supported: ${this.options.anchor}`);
    }
  }

  setVisible(visible = true) {
    const nextVisible = visible === true;
    const previousVisible = this.options.visible === true;
    this.options.visible = nextVisible;
    this.root.hidden = !nextVisible;
    if (previousVisible !== nextVisible) {
      if (nextVisible) {
        this.options.onOpen?.({ panelId: this.options.id });
      } else {
        this.options.onClose?.({ panelId: this.options.id });
      }
    }
    return nextVisible;
  }

  show() {
    this.setVisible(true);
    this.root?.focus?.();
    return this;
  }

  hide() {
    this.setVisible(false);
    return this;
  }

  setCollapsed(collapsed = false) {
    if (!this.options.collapsible) {
      return false;
    }
    this.options.collapsed = collapsed === true;
    this.render();
    this.options.onCollapse?.({
      panelId: this.options.id,
      collapsed: this.options.collapsed
    });
    return this.options.collapsed;
  }

  update(patch = {}) {
    return this.applyOptions({
      ...this.options,
      ...patch
    });
  }

  remove() {
    this.root?.remove();
    return true;
  }

  get visible() {
    if (this.options?.collapsible === true) {
      return this.options?.collapsed !== true;
    }
    return this.options?.visible === true;
  }

  get collapsed() {
    return this.options?.collapsed === true;
  }

  getState() {
    return {
      id: this.options.id,
      visible: this.options.visible === true,
      collapsed: this.options.collapsed === true,
      modal: this.options.modal === true,
      pauseScene: this.options.pauseScene === true,
      anchor: this.options.anchor,
      buttonCount: this.options.buttons.length,
      choiceCount: this.options.choices.length
    };
  }
}
