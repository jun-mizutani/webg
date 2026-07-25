// ---------------------------------------------
// CommandPalette.js  2026/07/25
//   Self-contained command palette UI for canvas-first applications
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import util from "./util.js";

const DEFAULT_STYLE_ID = "webg-command-palette-style";
const DEFAULT_PAGE_ROWS = 4;
const PALETTE_COLUMN_COUNT = 4;

const DEFAULT_COMMAND_PALETTE_CSS = `
:root {
  --command-palette-line: rgba(138, 202, 255, 0.18);
  --command-palette-ink: #eff8ff;
  --command-palette-sub: #a2bdd3;
  --command-palette-panel: rgba(8, 18, 28, 0.84);
  --command-palette-button: rgba(12, 26, 38, 0.54);
  --command-palette-button-active: rgba(75, 167, 10, 0.489);
  --command-palette-accent: #ffd36b;
}

.command-palette {
  position: absolute;
  box-sizing: border-box;
  width: 264px;
  max-width: calc(100vw - 16px);
  max-height: calc(100vh - 16px);
  transform: translate(-50%, -50%);
  display: none;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  z-index: 20;
  padding: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  pointer-events: none;
}

.command-palette.open {
  display: grid;
  pointer-events: auto;
}

.command-palette.surface {
  padding: 10px;
  border: 1px solid var(--command-palette-line);
  border-radius: 14px;
  background: var(--command-palette-panel);
  box-shadow: 0 18px 34px rgba(0, 0, 0, 0.28);
  backdrop-filter: blur(12px);
}

.command-palette-title {
  grid-column: 1 / -1;
  position: sticky;
  top: 0;
  z-index: 1;
  min-width: 0;
  padding: 2px 0 4px;
  background: var(--command-palette-panel);
  color: var(--command-palette-sub);
  font: 800 11px/1.3 ui-sans-serif, system-ui, "Yu Gothic", sans-serif;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  user-select: none;
  cursor: move;
  touch-action: none;
}

.palette-button,
.palette-control-button,
.palette-select-button {
  width: 100%;
  min-width: 0;
  height: 48px;
  border: 1px solid var(--command-palette-line);
  border-radius: 10px;
  background: var(--command-palette-button);
  color: var(--command-palette-ink);
  font: 800 13px/1.2 ui-sans-serif, system-ui, "Yu Gothic", sans-serif;
  box-shadow: 0 8px 16px rgba(0, 0, 0, 0.18);
  backdrop-filter: blur(10px);
  touch-action: manipulation;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  -webkit-tap-highlight-color: transparent;
}

.palette-button small,
.palette-select-button small {
  display: block;
  margin-top: 2px;
  color: var(--command-palette-sub);
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.03em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.palette-button.active,
.palette-select-button.active {
  border-color: rgb(255, 255, 255);
  background: var(--command-palette-button-active);
  color: #fff5cf;
  box-shadow:
    0 0 0 1px rgba(255, 232, 160, 0.10) inset,
    0 8px 16px rgba(120, 88, 26, 0.14);
}

.palette-button.page-switch {
  border-color: rgba(255, 132, 116, 0.66);
  background: rgba(255, 1, 1, 0.59);
  color: #fff3f0;
}

.palette-button.page-switch small {
  color: rgba(255, 211, 204, 0.86);
}

.palette-button.mode-switch {
  border-color: rgba(255, 184, 104, 0.38);
  background: rgba(215, 116, 28, 0.22);
  color: rgba(255, 245, 232, 0.76);
  box-shadow:
    0 0 0 1px rgba(255, 224, 182, 0.06) inset,
    0 6px 12px rgba(120, 63, 12, 0.10);
}

.palette-button.mode-switch small {
  color: rgba(255, 227, 195, 0.64);
}

.palette-button.mode-switch.active {
  border-color: rgba(255, 242, 221, 0.96);
  background: rgba(215, 116, 28, 0.78);
  color: #fff8ed;
  box-shadow:
    0 0 0 1px rgba(255, 232, 203, 0.22) inset,
    0 8px 18px rgba(120, 63, 12, 0.28);
}

.palette-button.mode-switch.active small {
  color: rgba(255, 239, 219, 0.96);
}

.palette-button.axis-x,
.palette-button.axis-x small {
  color: #ff1010;
  background: rgba(100, 100, 100, 0.40);
}

.palette-button.axis-y,
.palette-button.axis-y small {
  color: #5050ff;
  background: rgba(100, 100, 100, 0.40);
}

.palette-button.axis-z,
.palette-button.axis-z small {
  color: #19ff10;
  background: rgba(100, 100, 100, 0.40);
}

.palette-button.axis-n,
.palette-button.axis-n small {
  color: #fff0a8;
  background: rgba(100, 100, 100, 0.40);
}

.palette-row {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: minmax(72px, 1fr) 42px minmax(54px, 74px) 42px;
  gap: 8px;
  align-items: center;
  min-width: 0;
}

.palette-row-label {
  min-width: 0;
  color: var(--command-palette-ink);
  font: 800 12px/1.2 ui-sans-serif, system-ui, "Yu Gothic", sans-serif;
  overflow-wrap: anywhere;
  white-space: normal;
}

.palette-row-value {
  min-width: 0;
  color: var(--command-palette-accent);
  font: 800 13px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.palette-row-input {
  width: 100%;
  min-width: 0;
  height: 38px;
  border: 1px solid var(--command-palette-line);
  border-radius: 10px;
  background: rgba(4, 11, 18, 0.54);
  color: var(--command-palette-accent);
  font: 800 13px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  text-align: center;
  outline: none;
  box-shadow: 0 8px 16px rgba(0, 0, 0, 0.18);
}

.palette-row-input:focus {
  border-color: rgba(255, 232, 160, 0.82);
  box-shadow:
    0 0 0 1px rgba(255, 232, 160, 0.10) inset,
    0 8px 16px rgba(120, 88, 26, 0.14);
}

.palette-control-button {
  height: 38px;
  font-size: 18px;
}

.palette-select-row {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: minmax(72px, 1fr) 42px minmax(54px, 74px) 42px;
  gap: 8px;
  align-items: center;
  min-width: 0;
}

.palette-select-button {
  grid-column: 2 / -1;
  height: 38px;
  text-align: left;
  padding: 0 10px;
}

.palette-empty {
  visibility: hidden;
}
`;

// 数値を指定範囲へ収め、page番号、stepper値、palette位置の共通検証に使う
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// 文字列、省略枠、object形式のcommandを描画処理が扱える共通objectへ正規化する
// nullはpage内の空き枠、文字列は同じidとlabelを持つbuttonとして解釈する
function normalizeCommand(command) {
  if (command === null || command === undefined) {
    return { type: "empty" };
  }
  if (typeof command === "string") {
    return { type: "button", id: command, label: command, detail: "" };
  }
  return {
    type: command.type ?? "button",
    ...command
  };
}

// page切替buttonを明示commandとして持つかどうかを判定し、暗黙buttonの重複挿入を防ぐ
function isPageSwitchCommand(command) {
  return command?.pageSwitch === true || command?.id === "palette-next";
}

// commandがCSS grid上で消費する列数を返す
// stepperとselectは1行全体、それ以外のcommandは1cellとして扱う
function getCommandColumnSpan(command) {
  return command.type === "stepper" || command.type === "select"
    ? PALETTE_COLUMN_COUNT
    : 1;
}

// 固定値と状態取得関数のどちらからでも現在値を読み出せるようにする
function valueOf(value, fallback = "") {
  return typeof value === "function" ? value() : (value ?? fallback);
}

// palette内で使うbuttonのtypeとclassを統一して生成する
// form内へ組み込まれた場合もsubmitを起こさないようtype="button"を明示する
function makeButton(documentRef, className, text = "") {
  const button = documentRef.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = text;
  return button;
}

// stepの小数桁数を調べ、stepper表示が0.1や0.05の精度を失わないようにする
function getStepDecimals(step) {
  const text = String(step ?? 1);
  const dot = text.indexOf(".");
  return dot >= 0 ? Math.max(0, text.length - dot - 1) : 0;
}

// stepperの現在値を指定桁数へ整形し、有限値でない場合は空文字を返す
function formatNumber(value, decimals = 0) {
  if (!Number.isFinite(value)) {
    return "";
  }
  return decimals > 0 ? value.toFixed(decimals) : String(Math.round(value));
}

// アプリ側がdefault CSSへ追加規則を連結できるよう、元のCSS文字列を公開する
export function getDefaultCommandPaletteCss() {
  return DEFAULT_COMMAND_PALETTE_CSS;
}

export default class CommandPalette {
  static defaultStyleId = DEFAULT_STYLE_ID;
  static defaultCss = DEFAULT_COMMAND_PALETTE_CSS;

  // palette専用style要素をdocumentへ一度だけ挿入する
  // replace=trueの場合は既存styleを置き換え、setStyle()からの差し替えにも対応する
  static installStyles(documentRef = document, {
    css = CommandPalette.defaultCss,
    styleId = CommandPalette.defaultStyleId,
    replace = false
  } = {}) {
    if (!documentRef?.head) {
      return null;
    }
    let style = documentRef.getElementById(styleId);
    if (!style) {
      style = documentRef.createElement("style");
      style.id = styleId;
      documentRef.head.appendChild(style);
    } else if (!replace && style.textContent) {
      return style;
    }
    style.textContent = css;
    return style;
  }

  // これ以降に生成するinstanceが使うdefault CSSをclass単位で差し替える
  static setDefaultStyle(css) {
    CommandPalette.defaultCss = String(css ?? DEFAULT_COMMAND_PALETTE_CSS);
    return CommandPalette.defaultCss;
  }

  // command定義、描画先、callbackを受け取り、DOM生成と初回描画まで完了させる
  // canvasへのgesture登録はattachToCanvas()で明示的に行い、生成だけでは入力を奪わない
  constructor({
    document: documentRef = document,
    container = documentRef?.body,
    viewport = null,
    commands = [],
    pageRows = DEFAULT_PAGE_ROWS,
    pageRowsByPage = [],
    pageSize = undefined,
    title = "Command Palette",
    className = "command-palette",
    styleId = CommandPalette.defaultStyleId,
    autoInstallStyle = true,
    onCommand = null,
    onChange = null,
    getCommandState = null,
    closeOnCommand = true,
    draggable = true,
    titleTapCyclesPage = true,
    resetPageOnOpen = true
  } = {}) {
    if (!documentRef) {
      throw new Error("CommandPalette requires a document");
    }
    if (pageSize !== undefined) {
      throw new Error("CommandPalette pageSize was replaced by pageRows");
    }
    this.document = documentRef;
    this.container = container ?? documentRef.body;
    this.viewport = viewport;
    this.commands = Array.isArray(commands) ? commands.map(normalizeCommand) : [];
    this.pageRows = util.readOptionalInteger(
      pageRows,
      "CommandPalette pageRows",
      DEFAULT_PAGE_ROWS,
      { min: 1 }
    );
    if (!Array.isArray(pageRowsByPage)) {
      throw new Error("CommandPalette pageRowsByPage must be an array");
    }
    this.pageRowsByPage = Array.from(pageRowsByPage, (rows, pageIndex) => (
      rows === undefined
        ? undefined
        : util.readFiniteNumber(
          rows,
          `CommandPalette pageRowsByPage[${pageIndex}]`,
          { integer: true, min: 1 }
        )
    ));
    this.title = String(title ?? "");
    this.className = className;
    this.styleId = styleId;
    this.onCommand = onCommand;
    this.onChange = onChange;
    this.getCommandState = getCommandState;
    this.closeOnCommand = closeOnCommand !== false;
    this.draggable = draggable !== false;
    this.titleTapCyclesPage = titleTapCyclesPage === true;
    this.resetPageOnOpen = resetPageOnOpen === true;
    this.page = 0;
    this.opened = false;
    this.root = null;
    this.styleElement = null;
    this._hasCustomPosition = false;
    this._centerClientX = null;
    this._centerClientY = null;
    this._dragState = null;
    this._dragCleanup = null;
    this._attachedCanvas = null;
    this._listeners = [];
    if (autoInstallStyle) {
      this.styleElement = CommandPalette.installStyles(documentRef, { styleId });
    }
    this.createDom();
    this.render();
  }

  // 外部コードがDOM classを直接調べずに現在の開閉状態を取得できるようにする
  get isOpen() {
    return this.opened;
  }

  // commandの列占有数とpageRowsから総page数を求める
  get pageCount() {
    return this.buildCommandPages().length;
  }

  // 0始まりのpage indexに対応する行数を返す
  // page別指定がない位置では全体設定のpageRowsを既定行数として使う
  getPageRowCount(pageIndex) {
    return this.pageRowsByPage[pageIndex] ?? this.pageRows;
  }

  // 実行中にcommand一覧を交換し、現在pageを有効範囲へ戻して再描画する
  setCommands(commands = []) {
    this.commands = Array.isArray(commands) ? commands.map(normalizeCommand) : [];
    this.page = clamp(this.page, 0, this.pageCount - 1);
    this.render();
  }

  // このinstanceが参照するstyle要素のCSS全体を置き換える
  setStyle(css) {
    this.styleElement = CommandPalette.installStyles(this.document, {
      css: String(css ?? CommandPalette.defaultCss),
      styleId: this.styleId,
      replace: true
    });
    return this.styleElement;
  }

  // theme objectをCSS custom propertyへ変換し、paletteを含むcontainerへ設定する
  // `--`で始まらないcamelCase名も`--command-palette-*`形式へ変換して受け付ける
  setTheme(theme = {}) {
    const target = this.container ?? this.root;
    if (!target?.style) {
      return;
    }
    const entries = Object.entries(theme ?? {});
    for (const [key, value] of entries) {
      const cssName = key.startsWith("--")
        ? key
        : `--command-palette-${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`;
      target.style.setProperty(cssName, String(value));
    }
  }

  // paletteのroot DOMを一度だけ生成し、canvas側へclickが伝播しない境界を作る
  createDom() {
    if (this.root) {
      return this.root;
    }
    const root = this.document.createElement("div");
    root.className = this.className;
    root.setAttribute("role", "menu");
    root.setAttribute("aria-label", this.title || "Command palette");
    root.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    root.addEventListener("click", (ev) => ev.stopPropagation());
    this.container.appendChild(root);
    this.root = root;
    return root;
  }

  // 状態更新前の子要素をすべて除去し、古いevent listenerを持つ部品を残さない
  clearDom() {
    while (this.root?.firstChild) {
      this.root.removeChild(this.root.firstChild);
    }
  }

  // commandを列占有数に従って行へ詰め、固定行数のpage配列を構築する
  // 全幅部品が行途中に来た場合は残りcellをemptyで埋め、必ず次行の先頭へ配置する
  buildCommandPages() {
    const pages = [];
    let page = [];
    let usedRows = 0;
    let usedColumns = 0;

    // 現在行の残りcellをemptyで埋め、次行の先頭へ進める
    const finishRow = () => {
      while (usedColumns > 0 && usedColumns < PALETTE_COLUMN_COUNT) {
        page.push({ type: "empty" });
        usedColumns += 1;
      }
      if (usedColumns > 0) {
        usedRows += 1;
        usedColumns = 0;
      }
    };

    // pageごとの指定行数まで空行を補ってpageを確定し、次page用の状態へ戻す
    const finishPage = () => {
      const pageRows = this.getPageRowCount(pages.length);
      finishRow();
      while (usedRows < pageRows) {
        for (let column = 0; column < PALETTE_COLUMN_COUNT; column++) {
          page.push({ type: "empty" });
        }
        usedRows += 1;
      }
      pages.push(page);
      page = [];
      usedRows = 0;
      usedColumns = 0;
    };

    for (const command of this.commands) {
      const span = getCommandColumnSpan(command);
      if (span === PALETTE_COLUMN_COUNT) {
        finishRow();
        if (usedRows >= this.getPageRowCount(pages.length)) {
          finishPage();
        }
        page.push(command);
        usedRows += 1;
        continue;
      }
      if (usedRows >= this.getPageRowCount(pages.length)) {
        finishPage();
      }
      page.push(command);
      usedColumns += 1;
      if (usedColumns === PALETTE_COLUMN_COUNT) {
        usedRows += 1;
        usedColumns = 0;
      }
    }
    finishPage();
    return pages;
  }

  // 現在pageに属するcommandを返し、page範囲は構築済みpage数に合わせる
  getPageCommands() {
    const pages = this.buildCommandPages();
    this.page = clamp(this.page, 0, pages.length - 1);
    const currentPage = pages[this.page];
    if (pages.length <= 1 || currentPage.some(isPageSwitchCommand)) {
      return currentPage;
    }

    // 複数pageなのに現在pageへ移動buttonが無い場合だけ、最後の空き枠をNextへ差し替える
    // 空き枠が無いpageはレイアウトを崩さず、その代わりtitle tapの循環操作を使う
    const filled = currentPage.slice();
    for (let index = filled.length - 1; index >= 0; index -= 1) {
      if (filled[index]?.type === "empty") {
        filled[index] = {
          type: "button",
          id: "palette-next",
          label: "Next",
          detail: "page",
          pageSwitch: true
        };
        return filled;
      }
    }
    return currentPage;
  }

  // titleと現在pageのcommandを状態関数から読み直し、palette全体を再構築する
  // toggleやMode Switchのactive表示はこの再描画で最新状態へ同期する
  render() {
    if (!this.root) {
      return;
    }
    this.clearDom();
    if (this.title) {
      const title = this.document.createElement("div");
      title.className = "command-palette-title";
      title.textContent = `${this.title} ${this.pageCount > 1 ? `${this.page + 1}/${this.pageCount}` : ""}`.trim();
      this.attachTitleDragHandle(title);
      this.root.appendChild(title);
    }
    for (const command of this.getPageCommands()) {
      this.renderCommand(command);
    }
    // 開いているpageを再構築すると高さが変わる場合があるため、現在の中心を基準に
    // 新しい実寸をviewport内へ収め直し、titleや最終行が画面外へ固定されるのを防ぐ
    if (this.opened && this.root.classList.contains("open")) {
      const current = this.getCurrentCenterClientPosition();
      this.setCenterClientPosition(current.x, current.y, { remember: false });
    }
  }

  // command.typeを判定し、button、toggle、stepper、selectの専用描画へ振り分ける
  renderCommand(command) {
    if (command.type === "empty") {
      const empty = this.document.createElement("div");
      empty.className = "palette-empty";
      this.root.appendChild(empty);
      return;
    }
    if (command.type === "stepper") {
      this.renderStepper(command);
      return;
    }
    if (command.type === "select") {
      this.renderSelect(command);
      return;
    }
    if (command.type === "toggle") {
      this.renderToggle(command);
      return;
    }
    this.renderButton(command);
  }

  // 単発commandとMode Switch用buttonを生成し、共通callbackとcommand固有callbackを実行する
  renderButton(command) {
    const button = makeButton(this.document, "palette-button");
    const state = this.readCommandState(command);
    button.dataset.commandId = command.id ?? "";
    button.disabled = state.disabled === true;
    button.classList.toggle("active", state.active === true);
    button.classList.toggle("page-switch", command.pageSwitch === true || command.id === "palette-next");
    button.classList.toggle("mode-switch", command.modeSwitch === true);
    if (command.axis) {
      button.classList.add(`axis-${command.axis}`);
    }
    button.innerHTML = `${command.label ?? command.id ?? ""}<small>${command.detail ?? ""}</small>`;
    button.addEventListener("click", () => {
      if (command.id === "palette-next") {
        this.nextPage();
        return;
      }
      this.onCommand?.(command.id, command);
      command.onSelect?.(command);
      if (this.closeOnCommand && command.closeOnCommand !== false) {
        this.close();
      } else {
        this.render();
      }
    });
    this.root.appendChild(button);
  }

  // 現在のboolean値をactive表示へ反映し、clickごとに反転値をcallbackへ渡す
  renderToggle(command) {
    const button = makeButton(this.document, "palette-button");
    const current = Boolean(valueOf(command.value, false));
    const state = this.readCommandState({ ...command, active: current });
    button.dataset.commandId = command.id ?? "";
    button.disabled = state.disabled === true;
    button.classList.toggle("active", state.active === true);
    button.classList.toggle("mode-switch", command.modeSwitch === true);
    if (command.axis) {
      button.classList.add(`axis-${command.axis}`);
    }
    button.innerHTML = `${command.label ?? command.id ?? ""}<small>${command.detail ?? ""}</small>`;
    button.addEventListener("click", () => {
      const next = !Boolean(valueOf(command.value, false));
      command.onChange?.(next, command);
      this.onChange?.(command.id, next, command);
      command.onSelect?.(command);
      if (this.closeOnCommand && command.closeOnCommand !== false) {
        this.close();
      } else {
        this.render();
      }
    });
    this.root.appendChild(button);
  }

  // label、減算、現在値、加算を1行へ配置し、範囲付きの数値変更UIを生成する
  // input=trueでは直接入力も許可するが、確定時は同じwrite処理で範囲検証する
  renderStepper(command) {
    const row = this.document.createElement("div");
    row.className = "palette-row";
    const label = this.document.createElement("div");
    label.className = "palette-row-label";
    label.textContent = command.label ?? command.id ?? "";
    const minus = makeButton(this.document, "palette-control-button", "-");
    const plus = makeButton(this.document, "palette-control-button", "+");

    // app側が保持する現在値を操作のたびに読み直し、古いclosure値を使わない
    const read = () => Number(valueOf(command.value, command.min ?? 0));
    // button操作と直接入力を同じ経路へ集約し、min/max適用後の値だけを通知する
    const write = (next) => {
      const min = Number.isFinite(command.min) ? command.min : -Infinity;
      const max = Number.isFinite(command.max) ? command.max : Infinity;
      const resolved = clamp(next, min, max);
      command.onChange?.(resolved, command);
      this.onChange?.(command.id, resolved, command);
      this.render();
    };
    const decimals = Number.isFinite(command.decimals)
      ? Math.max(0, Math.trunc(command.decimals))
      : getStepDecimals(command.step);
    const value = command.input === true
      ? this.document.createElement("input")
      : this.document.createElement("div");
    if (command.input === true) {
      value.className = "palette-row-input";
      value.type = "text";
      value.inputMode = command.inputMode ?? (decimals > 0 ? "decimal" : "numeric");
      value.autocomplete = "off";
      value.spellcheck = false;
      value.value = formatNumber(read(), decimals);
      value.addEventListener("pointerdown", (ev) => ev.stopPropagation());
      value.addEventListener("click", (ev) => ev.stopPropagation());
      value.addEventListener("keydown", (ev) => {
        ev.stopPropagation();
        if (ev.key === "Enter") {
          value.blur();
        } else if (ev.key === "Escape") {
          value.value = formatNumber(read(), decimals);
          value.blur();
        }
      });
      value.addEventListener("blur", () => {
        const parsed = Number.parseFloat(String(value.value).trim());
        if (Number.isFinite(parsed)) {
          write(parsed);
        } else {
          this.render();
        }
      });
    } else {
      value.className = "palette-row-value";
      value.textContent = formatNumber(read(), decimals);
    }
    minus.addEventListener("click", () => write(read() - (command.step ?? 1)));
    plus.addEventListener("click", () => write(read() + (command.step ?? 1)));

    row.appendChild(label);
    row.appendChild(minus);
    row.appendChild(value);
    row.appendChild(plus);
    this.root.appendChild(row);
  }

  // 現在値に対応する候補を表示し、clickごとにoptionsを循環して次の値を通知する
  renderSelect(command) {
    const row = this.document.createElement("div");
    row.className = "palette-select-row";
    const label = this.document.createElement("div");
    label.className = "palette-row-label";
    label.textContent = command.label ?? command.id ?? "";
    const button = makeButton(this.document, "palette-select-button");
    const options = Array.isArray(command.options) ? command.options : [];
    const current = valueOf(command.value, options[0]?.value ?? "");
    const currentOption = options.find((item) => item.value === current) ?? options[0] ?? { value: "", label: "" };
    button.innerHTML = `${currentOption.label ?? currentOption.value}<small>${command.detail ?? "select"}</small>`;
    button.addEventListener("click", () => {
      if (options.length === 0) {
        return;
      }
      const index = Math.max(0, options.findIndex((item) => item.value === current));
      const next = options[(index + 1) % options.length];
      command.onChange?.(next.value, command);
      this.onChange?.(command.id, next.value, command);
      this.render();
    });
    row.appendChild(label);
    row.appendChild(button);
    this.root.appendChild(row);
  }

  // command自身の固定状態とapp側getCommandState()の動的状態を統合する
  // どちらか一方でもactiveまたはdisabledなら、その状態を描画へ反映する
  readCommandState(command) {
    const state = this.getCommandState?.(command.id, command) ?? {};
    return {
      active: command.active === true || state.active === true,
      disabled: command.disabled === true || state.disabled === true
    };
  }

  // 最終pageの次は先頭へ戻る循環方式でpageを進める
  nextPage() {
    this.page = (this.page + 1) % this.pageCount;
    this.render();
    // 前pageを縦scrollしていた場合でも、新pageではtitleから操作を再開できるようにする
    this.root.scrollTop = 0;
  }

  // 指定座標の近くへpaletteを配置し、表示後の実寸でviewport内へ収める
  // 非表示中のDOMは高さ0になるため、open classを付けてからplace()を呼ぶ順序を守る
  open(clientX = null, clientY = null) {
    if (!this.root) {
      return;
    }
    this.opened = true;
    this.page = this.resetPageOnOpen === true
      ? 0
      : clamp(this.page, 0, this.pageCount - 1);
    this.render();
    this.root.classList.add("open");
    this.root.scrollTop = 0;
    this.place(clientX, clientY);
  }

  // 内部状態と表示classを同時に閉じ、次のgestureが新規openとして扱われるようにする
  close() {
    this.opened = false;
    this.root?.classList?.remove("open");
  }

  // keyboardとdouble clickの共通入口として、現在状態に応じてopen/closeを切り替える
  toggle(clientX = null, clientY = null) {
    if (this.opened) {
      this.close();
    } else {
      this.open(clientX, clientY);
    }
  }

  // title行だけをdrag handleとして使い、buttonやinput操作とpalette移動が衝突しないようにする
  attachTitleDragHandle(title) {
    if (!this.draggable || !title?.addEventListener) {
      if (this.titleTapCyclesPage === true) {
        title.addEventListener("click", (ev) => {
          ev.stopPropagation();
          this.nextPage();
        });
      }
      return;
    }
    let moved = false;
    // `drag`の初期化段階で、必要な状態と資源を準備して処理を開始する
    const startDrag = (ev, pointerId = null) => {
      if (this._dragState || !this.root || ev.button !== undefined && ev.button !== 0) {
        return;
      }
      ev.stopPropagation();
      ev.preventDefault();
      moved = false;
      const current = this.getCurrentCenterClientPosition();
      this._dragState = {
        pointerId,
        startClientX: ev.clientX,
        startClientY: ev.clientY,
        startCenterX: current.x,
        startCenterY: current.y
      };
      this.document.addEventListener("pointermove", pointerMove);
      this.document.addEventListener("pointerup", pointerEnd);
      this.document.addEventListener("pointercancel", pointerEnd);
      this.document.addEventListener("mousemove", mouseMove);
      this.document.addEventListener("mouseup", mouseEnd);
      this._dragCleanup = () => {
        this.document.removeEventListener("pointermove", pointerMove);
        this.document.removeEventListener("pointerup", pointerEnd);
        this.document.removeEventListener("pointercancel", pointerEnd);
        this.document.removeEventListener("mousemove", mouseMove);
        this.document.removeEventListener("mouseup", mouseEnd);
      };
    };
    // `drag`を入力値に従って変更し、関連する状態を同期する
    const moveDrag = (ev) => {
      const drag = this._dragState;
      if (!drag) {
        return;
      }
      ev.stopPropagation();
      ev.preventDefault();
      moved = moved || Math.abs(ev.clientX - drag.startClientX) > 3 || Math.abs(ev.clientY - drag.startClientY) > 3;
      this.setCenterClientPosition(
        drag.startCenterX + ev.clientX - drag.startClientX,
        drag.startCenterY + ev.clientY - drag.startClientY
      );
    };
    // `finishDrag`は処理周期の開始または終了に必要な状態を更新する
    const finishDrag = (ev) => {
      const drag = this._dragState;
      if (!drag) {
        return;
      }
      this._dragState = null;
      this._dragCleanup?.();
      this._dragCleanup = null;
      ev.stopPropagation();
    };
    // `pointerMove`は入力またはイベントを受け取り、対応する処理へ振り分ける
    const pointerMove = (ev) => {
      if (this._dragState?.pointerId !== ev.pointerId) return;
      moveDrag(ev);
    };
    // `pointerEnd`は入力またはイベントを受け取り、対応する処理へ振り分ける
    const pointerEnd = (ev) => {
      if (this._dragState?.pointerId !== ev.pointerId) return;
      finishDrag(ev);
    };
    // `mouseMove`は入力またはイベントを受け取り、対応する処理へ振り分ける
    const mouseMove = (ev) => {
      if (this._dragState?.pointerId !== "mouse") return;
      moveDrag(ev);
    };
    // `mouseEnd`は入力またはイベントを受け取り、対応する処理へ振り分ける
    const mouseEnd = (ev) => {
      if (this._dragState?.pointerId !== "mouse") return;
      finishDrag(ev);
    };
    title.addEventListener("pointerdown", (ev) => startDrag(ev, ev.pointerId));
    title.addEventListener("mousedown", (ev) => startDrag(ev, "mouse"));
    if (this.titleTapCyclesPage === true) {
      title.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (moved) {
          moved = false;
          return;
        }
        this.nextPage();
      });
    }
  }

  // viewport上の入力座標をcontainer座標へ変換し、palette rootのleft/topへ設定する
  // 座標を受け取らないkeyboard起動では画面中央へ配置する
  place(clientX = null, clientY = null) {
    if (!this.root) {
      return;
    }
    const rect = this.viewport?.getBoundingClientRect?.();
    this.applyViewportSizeLimits(rect);
    if (this._hasCustomPosition) {
      this.setCenterClientPosition(this._centerClientX, this._centerClientY);
      return;
    }
    if (!rect || !Number.isFinite(clientX) || !Number.isFinite(clientY)) {
      const fallbackRect = rect
        ?? this.container?.getBoundingClientRect?.()
        ?? { left: 0, top: 0, width: 0, height: 0 };
      const centerX = fallbackRect.left + fallbackRect.width * 0.5;
      const centerY = fallbackRect.top + fallbackRect.height * 0.5;
      this.setCenterClientPosition(centerX, centerY, { remember: false });
      return;
    }
    const hostRect = this.container?.getBoundingClientRect?.() ?? { left: 0, top: 0 };
    // open後に確定した現在pageの幅と高さを使う
    // pageRowsが多い場合も固定高さを仮定せず、実際のtitleと全commandを含む矩形で判定する
    const rootRect = this.root.getBoundingClientRect();
    const center = this.chooseCenter(
      rect,
      clientX - rect.left,
      clientY - rect.top,
      rootRect.width * 0.5,
      rootRect.height * 0.5
    );
    this.setCenterClientPosition(
      rect.left + center.x,
      rect.top + center.y,
      { remember: false, hostRect }
    );
  }

  // Paletteのscroll領域をcanvasまたは指定viewportの内側へ制限する
  // 内容が表示領域より高い場合はroot自体を拡大し続けず、sticky titleを残して内部をscrollする
  applyViewportSizeLimits(viewportRect = null) {
    if (!this.root) {
      return;
    }
    const rect = viewportRect
      ?? this.viewport?.getBoundingClientRect?.()
      ?? this.container?.getBoundingClientRect?.();
    if (!rect || !Number.isFinite(rect.width) || !Number.isFinite(rect.height)
        || rect.width <= 0 || rect.height <= 0) {
      return;
    }
    const margin = 8.0;
    this.root.style.maxWidth = `${Math.max(1, rect.width - margin * 2)}px`;
    this.root.style.maxHeight = `${Math.max(1, rect.height - margin * 2)}px`;
  }

  // 現在のroot中心をclient座標で返し、未配置時はviewportまたはcontainer中央を使う
  getCurrentCenterClientPosition() {
    const rootRect = this.root?.getBoundingClientRect?.();
    if (rootRect && Number.isFinite(rootRect.left) && rootRect.width > 0) {
      return {
        x: rootRect.left + rootRect.width * 0.5,
        y: rootRect.top + rootRect.height * 0.5
      };
    }
    const rect = this.viewport?.getBoundingClientRect?.()
      ?? this.container?.getBoundingClientRect?.()
      ?? { left: 0, top: 0, width: 0, height: 0 };
    return {
      x: rect.left + rect.width * 0.5,
      y: rect.top + rect.height * 0.5
    };
  }

  // client座標の中心位置をcontainer内のleft/topへ変換し、viewport外へ出ないようにclampする
  setCenterClientPosition(clientX, clientY, options = {}) {
    if (!this.root) {
      return;
    }
    const remember = options.remember !== false;
    const hostRect = options.hostRect ?? this.container?.getBoundingClientRect?.() ?? { left: 0, top: 0 };
    const viewportRect = this.viewport?.getBoundingClientRect?.()
      ?? this.container?.getBoundingClientRect?.()
      ?? { left: 0, top: 0, width: 0, height: 0 };
    this.applyViewportSizeLimits(viewportRect);
    const rootRect = this.root.getBoundingClientRect?.();
    const halfWidth = Math.max(1, (rootRect?.width ?? 264) * 0.5);
    const halfHeight = Math.max(1, (rootRect?.height ?? 276) * 0.5);
    const margin = 8.0;
    const minX = viewportRect.left + halfWidth + margin;
    const maxX = viewportRect.left + Math.max(halfWidth + margin, viewportRect.width - halfWidth - margin);
    const minY = viewportRect.top + halfHeight + margin;
    const maxY = viewportRect.top + Math.max(halfHeight + margin, viewportRect.height - halfHeight - margin);
    const resolvedX = clamp(clientX, minX, maxX);
    const resolvedY = clamp(clientY, minY, maxY);
    this.root.style.left = `${resolvedX - hostRect.left}px`;
    this.root.style.top = `${resolvedY - hostRect.top}px`;
    if (remember) {
      this._centerClientX = resolvedX;
      this._centerClientY = resolvedY;
      this._hasCustomPosition = true;
    }
  }

  // 入力位置を隠しにくい4方向から、palette全体がviewport内に収まる中心を選ぶ
  // すべて収まらない狭い画面ではclampして表示領域からのはみ出しを抑える
  chooseCenter(rect, localX, localY, halfWidth, halfHeight) {
    const margin = 12.0;
    const gap = 18.0;
    const minCenterX = halfWidth + margin;
    const maxCenterX = rect.width - halfWidth - margin;
    const minCenterY = halfHeight + margin;
    const maxCenterY = rect.height - halfHeight - margin;
    const directionX = localX >= rect.width * 0.5 ? 1.0 : -1.0;
    const directionY = localY >= rect.height * 0.5 ? 1.0 : -1.0;
    const candidates = [
      [directionX, directionY],
      [-directionX, -directionY],
      [directionX, -directionY],
      [-directionX, directionY]
    ];
    for (const [sx, sy] of candidates) {
      const centerX = localX + sx * (halfWidth + gap);
      const centerY = localY + sy * (halfHeight + gap);
      if (centerX >= minCenterX && centerX <= maxCenterX
          && centerY >= minCenterY && centerY <= maxCenterY) {
        return { x: centerX, y: centerY };
      }
    }
    return {
      x: clamp(localX + directionX * (halfWidth + gap), minCenterX, maxCenterX),
      y: clamp(localY + directionY * (halfHeight + gap), minCenterY, maxCenterY)
    };
  }

  // canvasへpointer、double click、keyboardの起動gestureをまとめて登録する
  // 既存登録を先に解除し、同じinstanceへの再attachでlistenerが重複しないようにする
  attachToCanvas(canvas = this.viewport, {
    doubleClick = true,
    doubleTap = true,
    key = "/",
    tapMoveTolerance = 12,
    doubleTapTime = 320,
    doubleTapDistance = 24
  } = {}) {
    if (!canvas?.addEventListener) {
      throw new Error("CommandPalette.attachToCanvas requires a canvas or event target");
    }
    this.detach();
    this.viewport = canvas;
    const state = {
      active: false,
      pointerId: null,
      startX: 0,
      startY: 0,
      lastTapTime: 0,
      lastTapX: 0,
      lastTapY: 0,
      lastPointerType: "",
      lastPointerDoubleTime: 0
    };
    // pointer開始位置を保存し、pointerup時にtapかdragかを判定できるようにする
    const pointerdown = (ev) => {
      state.active = true;
      state.pointerId = ev.pointerId;
      state.startX = ev.clientX;
      state.startY = ev.clientY;
      canvas.setPointerCapture?.(ev.pointerId);
    };
    // 移動量が許容範囲内のpointer操作だけをtapとして扱い、2回目ならpaletteを開く
    const pointerup = (ev) => {
      if (!state.active || ev.pointerId !== state.pointerId) return;
      state.active = false;
      if (canvas.hasPointerCapture?.(ev.pointerId)) {
        canvas.releasePointerCapture(ev.pointerId);
      }
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      const distance = Math.hypot(ev.clientX - state.startX, ev.clientY - state.startY);
      if (distance > tapMoveTolerance) return;
      if (this.opened) {
        this.close();
        return;
      }
      if (!doubleTap) {
        return;
      }
      const pointerType = String(ev.pointerType ?? "");
      const samePointer = !state.lastPointerType || state.lastPointerType === pointerType;
      // 時間、位置、pointer種別の3条件が揃った場合だけdouble tapと判定する
      const isDouble = samePointer
        && state.lastTapTime > 0
        && now - state.lastTapTime <= doubleTapTime
        && Math.hypot(ev.clientX - state.lastTapX, ev.clientY - state.lastTapY) <= doubleTapDistance;
      if (isDouble) {
        state.lastTapTime = 0;
        state.lastPointerDoubleTime = now;
        this.open(ev.clientX, ev.clientY);
        ev.preventDefault?.();
      } else {
        state.lastTapTime = now;
        state.lastTapX = ev.clientX;
        state.lastTapY = ev.clientY;
        state.lastPointerType = pointerType;
      }
    };
    // browserがpointer系列を中断した場合はtap候補を破棄する
    const pointercancel = (ev) => {
      if (state.active && ev.pointerId === state.pointerId) {
        state.active = false;
      }
    };
    // PCのnative dblclickを入口にし、直前のpointer double判定との二重実行を避ける
    const dblclick = (ev) => {
      if (!doubleClick) return;
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      if (now - state.lastPointerDoubleTime <= 80) return;
      state.lastPointerDoubleTime = now;
      this.toggle(ev.clientX, ev.clientY);
      ev.preventDefault?.();
    };
    // 指定keyからは座標なしでtoggleし、paletteをviewport中央へ表示する
    const keydown = (ev) => {
      if (!key || ev.key !== key) return;
      this.toggle();
      ev.preventDefault?.();
    };
    canvas.addEventListener("pointerdown", pointerdown);
    canvas.addEventListener("pointerup", pointerup);
    canvas.addEventListener("pointercancel", pointercancel);
    canvas.addEventListener("dblclick", dblclick);
    this.document.addEventListener("keydown", keydown);
    this._attachedCanvas = canvas;
    this._listeners = [
      [canvas, "pointerdown", pointerdown],
      [canvas, "pointerup", pointerup],
      [canvas, "pointercancel", pointercancel],
      [canvas, "dblclick", dblclick],
      [this.document, "keydown", keydown]
    ];
  }

  // attachToCanvas()で登録したlistenerを記録から逆引きしてすべて解除する
  detach() {
    this._dragState = null;
    this._dragCleanup?.();
    this._dragCleanup = null;
    for (const [target, type, listener] of this._listeners) {
      target.removeEventListener(type, listener);
    }
    this._listeners = [];
    this._attachedCanvas = null;
  }

  // gestureとDOMを破棄し、このinstanceが保持する画面資源を解放する
  destroy() {
    this.detach();
    this.root?.remove?.();
    this.root = null;
  }
}
