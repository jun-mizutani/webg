// ---------------------------------------------
// DialogueOverlay.js 2026/04/09
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import UIPanel from "./UIPanel.js";
import util from "./util.js";

const hasOwn = util.hasOwn;

const toTextLines = (value) => {
  if (Array.isArray(value)) {
    return value.flatMap((item) => toTextLines(item));
  }
  if (value === null || value === undefined) {
    return [];
  }
  return String(value).split(/\r?\n/);
};

const cloneOptionalColor = (value, path) => {
  if (value === undefined || value === null) {
    return null;
  }
  if (!Array.isArray(value)) {
    throw new Error(`${path} must be a color array`);
  }
  return [...value];
};

const normalizeChoice = (choice = {}) => {
  if (!choice || typeof choice !== "object" || Array.isArray(choice)) {
    throw new Error("Dialogue choice must be an object");
  }
  if (typeof choice.label !== "string" || choice.label.length === 0) {
    throw new Error("Dialogue choice requires a non-empty label");
  }
  if (choice.next === undefined) {
    throw new Error(`Dialogue choice '${choice.label}' requires next entries`);
  }
  return {
    label: choice.label,
    next: normalizeEntries(choice.next),
    color: cloneOptionalColor(choice.color, `Dialogue choice '${choice.label}'.color`)
  };
};

// entry ごとの表示レーンは left / right の明示値だけを受け付ける
// - 暗黙補完を行わず、side の typo をその場で検出する
const normalizeSide = (value, path = "Dialogue entry.side") => {
  const side = String(value ?? "left").toLowerCase();
  if (side !== "left" && side !== "right") {
    throw new Error(`${path} must be 'left' or 'right'`);
  }
  return side;
};

const normalizeEntry = (entry = {}, indexPath = "Dialogue entry") => {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error(`${indexPath} must be an object`);
  }
  const choices = Array.isArray(entry.choices) ? entry.choices.map((choice) => normalizeChoice(choice)) : [];
  return {
    speaker: entry.speaker === undefined ? "" : String(entry.speaker),
    title: entry.title === undefined ? "" : String(entry.title),
    side: normalizeSide(entry.side ?? "left", `${indexPath}.side`),
    lines: toTextLines(entry.lines ?? []),
    choices,
    autoAdvance: entry.autoAdvance === true,
    color: cloneOptionalColor(entry.color, `${indexPath}.color`),
    bodyColor: cloneOptionalColor(entry.bodyColor, `${indexPath}.bodyColor`),
    choiceColor: cloneOptionalColor(entry.choiceColor, `${indexPath}.choiceColor`),
    selectedChoiceColor: cloneOptionalColor(entry.selectedChoiceColor, `${indexPath}.selectedChoiceColor`)
  };
};

const normalizeEntries = (entries = []) => {
  if (!Array.isArray(entries)) {
    return [normalizeEntry(entries)];
  }
  const out = [];
  for (let i = 0; i < entries.length; i++) {
    out.push(normalizeEntry(entries[i], `Dialogue entry[${i}]`));
  }
  return out;
};

const cloneChoice = (choice = {}) => ({
  label: String(choice.label ?? ""),
  next: cloneEntries(choice.next ?? []),
  color: Array.isArray(choice.color) ? [...choice.color] : null
});

const cloneEntry = (entry = {}) => ({
  speaker: String(entry.speaker ?? ""),
  title: String(entry.title ?? ""),
  side: normalizeSide(entry.side ?? "left"),
  lines: Array.isArray(entry.lines) ? entry.lines.map((line) => String(line ?? "")) : [],
  choices: Array.isArray(entry.choices) ? entry.choices.map((choice) => cloneChoice(choice)) : [],
  autoAdvance: entry.autoAdvance === true,
  color: Array.isArray(entry.color) ? [...entry.color] : null,
  bodyColor: Array.isArray(entry.bodyColor) ? [...entry.bodyColor] : null,
  choiceColor: Array.isArray(entry.choiceColor) ? [...entry.choiceColor] : null,
  selectedChoiceColor: Array.isArray(entry.selectedChoiceColor) ? [...entry.selectedChoiceColor] : null
});

const cloneEntries = (entries = []) => {
  if (!Array.isArray(entries)) {
    return [cloneEntry(entries)];
  }
  const out = [];
  for (let i = 0; i < entries.length; i++) {
    out.push(cloneEntry(entries[i]));
  }
  return out;
};

export class MessageQueue {
  constructor(entries = []) {
    this.items = [];
    this.index = -1;
    this.enqueue(entries);
  }

  clear() {
    this.items = [];
    this.index = -1;
    return this;
  }

  reset(entries = []) {
    this.clear();
    this.enqueue(entries);
    return this;
  }

  enqueue(entries = []) {
    const normalized = normalizeEntries(entries);
    for (let i = 0; i < normalized.length; i++) {
      this.items.push(normalized[i]);
    }
    if (this.index < 0 && this.items.length > 0) {
      this.index = 0;
    }
    return this.items.length;
  }

  insert(afterIndex, entries = []) {
    const normalized = normalizeEntries(entries);
    if (normalized.length === 0) {
      return this.items.length;
    }
    if (!Number.isFinite(afterIndex) || !Number.isInteger(afterIndex)) {
      throw new Error("MessageQueue insert index must be an integer");
    }
    if (afterIndex < -1 || afterIndex >= this.items.length) {
      throw new Error(`MessageQueue insert index must be in range -1..${this.items.length - 1}`);
    }
    const insertAt = afterIndex + 1;
    this.items.splice(insertAt, 0, ...normalized);
    if (this.index >= insertAt) {
      this.index += normalized.length;
    }
    return this.items.length;
  }

  current() {
    if (this.index < 0 || this.index >= this.items.length) {
      return null;
    }
    return this.items[this.index] ?? null;
  }

  hasNext() {
    return this.index >= 0 && this.index < this.items.length - 1;
  }

  next() {
    if (this.items.length === 0) {
      this.index = -1;
      return null;
    }
    if (this.index < 0) {
      this.index = 0;
      return this.current();
    }
    if (this.index < this.items.length - 1) {
      this.index += 1;
      return this.current();
    }
    this.index = this.items.length;
    return null;
  }
}

export default class Dialogue {
  // DOM overlay を使って、会話 / tutorial を UTF-8 文字列で表示する
  constructor(options = {}) {
    const safeOptions = util.readPlainObject(options, "Dialogue options");
    this.doc = options.document ?? (typeof document !== "undefined" ? document : null);
    this.theme = { ...util.readPlainObject(safeOptions.theme, "Dialogue theme", {}) };
    this.layoutOptions = {
      id: util.readOptionalString(safeOptions.id, "Dialogue id", "webg-dialogue-overlay"),
      leftWidth: "minmax(320px, 540px)",
      rightWidth: "minmax(260px, 360px)",
      gap: 12,
      columnMaxHeight: undefined,
      scrollColumns: true,
      spreadColumns: false,
      collapseWidth: 980,
      compactWidth: 760,
      positioningMode: util.readOptionalPositioningMode(
        safeOptions.positioningMode,
        "Dialogue positioningMode",
        "fixed"
      ),
      containerElement: util.readOptionalElement(safeOptions.containerElement, "Dialogue containerElement", null),
      viewportElement: util.readOptionalElement(safeOptions.viewportElement, "Dialogue viewportElement", null),
      top: undefined,
      left: undefined,
      right: undefined
    };
    this.applyLayoutOptions(safeOptions);
    this.title = util.readOptionalString(safeOptions.title, "Dialogue title", "Dialogue");
    this.footerText = util.readOptionalString(
      safeOptions.footer,
      "Dialogue footer",
      "Enter: next  1 / 2: choose  R: restart"
    );
    this.stateTitle = util.readOptionalString(safeOptions.stateTitle, "Dialogue stateTitle", "STATE");
    this.choicePromptText = util.readOptionalString(
      safeOptions.choicePromptText,
      "Dialogue choicePromptText",
      "1 / 2 で分岐を選択"
    );
    this.advancePromptText = util.readOptionalString(
      safeOptions.advancePromptText,
      "Dialogue advancePromptText",
      "Enter / Space で次へ進む"
    );
    this.visibleHintText = util.readOptionalString(
      safeOptions.visibleHintText,
      "Dialogue visibleHintText",
      "左は本文、右は会話状態と選択状況"
    );
    this.hiddenHintText = util.readOptionalString(
      safeOptions.hiddenHintText,
      "Dialogue hiddenHintText",
      "DialogueOverlay は閉じています"
    );
    this.showNextButton = util.readOptionalBoolean(safeOptions.showNextButton, "Dialogue showNextButton", true);
    this.showRestartButton = util.readOptionalBoolean(safeOptions.showRestartButton, "Dialogue showRestartButton", true);
    this.showHideButton = util.readOptionalBoolean(safeOptions.showHideButton, "Dialogue showHideButton", true);
    this.appendHistory = util.readOptionalBoolean(safeOptions.appendHistory, "Dialogue appendHistory", false);
    this.flipMainPanelBySide = util.readOptionalBoolean(
      safeOptions.flipMainPanelBySide,
      "Dialogue flipMainPanelBySide",
      true
    );
    this.stateLinesProvider = util.readOptionalFunction(safeOptions.getStateLines, "Dialogue getStateLines", null);
    this.dockOffsetProvider = util.readOptionalFunction(safeOptions.getDockOffset, "Dialogue getDockOffset", null);
    this.queue = new MessageQueue();
    this.sourceEntries = [];
    this.historyEntries = [];
    this.visible = false;
    this.lastChoiceLabel = "";
    this.lastStatus = "idle";
    this.uiPanels = null;
    this.layout = null;
    this.nodes = null;
  }

  setTheme(theme = {}) {
    this.theme = { ...util.readPlainObject(theme, "Dialogue theme", {}) };
    if (this.uiPanels) {
      this.uiPanels.setTheme(this.theme);
    }
    return this;
  }

  setDockOffsetProvider(fn) {
    this.dockOffsetProvider = util.readOptionalFunction(fn, "Dialogue dockOffsetProvider", null);
    return this;
  }

  // overlay の幅、余白、折り返し幅、固定位置を必要に応じて更新する
  // sample ごとに「中央へ張り出しにくい配置」へ寄せたい場合もここから調整する
  applyLayoutOptions(options = {}, syncDom = false) {
    const safeOptions = util.readPlainObject(options, "Dialogue layout options");
    if (hasOwn(safeOptions, "id")) {
      const id = util.readOptionalString(safeOptions.id, "Dialogue id", undefined);
      if (!id) {
        throw new Error("Dialogue id must be a non-empty string");
      }
      this.layoutOptions.id = id;
    }
    if (hasOwn(safeOptions, "leftWidth")) {
      const leftWidth = util.readOptionalString(safeOptions.leftWidth, "Dialogue leftWidth", undefined);
      if (!leftWidth) {
        throw new Error("Dialogue leftWidth must be a non-empty string");
      }
      this.layoutOptions.leftWidth = leftWidth;
    }
    if (hasOwn(safeOptions, "rightWidth")) {
      const rightWidth = util.readOptionalString(safeOptions.rightWidth, "Dialogue rightWidth", undefined);
      if (!rightWidth) {
        throw new Error("Dialogue rightWidth must be a non-empty string");
      }
      this.layoutOptions.rightWidth = rightWidth;
    }
    if (hasOwn(safeOptions, "gap")) {
      const gap = util.readOptionalInteger(safeOptions.gap, "Dialogue gap", undefined, { min: 8 });
      this.layoutOptions.gap = gap;
    }
    if (hasOwn(safeOptions, "columnMaxHeight")) {
      const columnMaxHeight = util.readOptionalInteger(
        safeOptions.columnMaxHeight,
        "Dialogue columnMaxHeight",
        undefined,
        { min: 120 }
      );
      this.layoutOptions.columnMaxHeight = columnMaxHeight;
    }
    if (hasOwn(safeOptions, "scrollColumns")) {
      this.layoutOptions.scrollColumns = util.readOptionalBoolean(
        safeOptions.scrollColumns,
        "Dialogue scrollColumns",
        this.layoutOptions.scrollColumns
      );
    }
    if (hasOwn(safeOptions, "spreadColumns")) {
      this.layoutOptions.spreadColumns = util.readOptionalBoolean(
        safeOptions.spreadColumns,
        "Dialogue spreadColumns",
        this.layoutOptions.spreadColumns
      );
    }
    if (hasOwn(safeOptions, "collapseWidth")) {
      this.layoutOptions.collapseWidth = util.readOptionalInteger(
        safeOptions.collapseWidth,
        "Dialogue collapseWidth",
        undefined,
        { min: 0 }
      );
    }
    if (hasOwn(safeOptions, "compactWidth")) {
      this.layoutOptions.compactWidth = util.readOptionalInteger(
        safeOptions.compactWidth,
        "Dialogue compactWidth",
        undefined,
        { min: 0 }
      );
    }
    if (hasOwn(safeOptions, "positioningMode")) {
      this.layoutOptions.positioningMode = util.readOptionalPositioningMode(
        safeOptions.positioningMode,
        "Dialogue positioningMode",
        this.layoutOptions.positioningMode
      );
    }
    if (hasOwn(safeOptions, "containerElement")) {
      this.layoutOptions.containerElement = util.readOptionalElement(
        safeOptions.containerElement,
        "Dialogue containerElement",
        null
      );
    }
    if (hasOwn(safeOptions, "viewportElement")) {
      this.layoutOptions.viewportElement = util.readOptionalElement(
        safeOptions.viewportElement,
        "Dialogue viewportElement",
        null
      );
    }
    if (hasOwn(safeOptions, "top")) {
      this.layoutOptions.top = util.readOptionalInteger(safeOptions.top, "Dialogue top", undefined, { min: 0 });
    }
    if (hasOwn(safeOptions, "left")) {
      this.layoutOptions.left = util.readOptionalInteger(safeOptions.left, "Dialogue left", undefined, { min: 0 });
    }
    if (hasOwn(safeOptions, "right")) {
      this.layoutOptions.right = util.readOptionalInteger(safeOptions.right, "Dialogue right", undefined, { min: 0 });
    }
    if (syncDom && this.layout?.root) {
      const root = this.layout.root;
      root.style.setProperty("--webg-overlay-left-width", this.layoutOptions.leftWidth);
      root.style.setProperty("--webg-overlay-right-width", this.layoutOptions.rightWidth);
      root.style.setProperty("--webg-overlay-gap", `${this.layoutOptions.gap}px`);
      if (Number.isFinite(this.layoutOptions.columnMaxHeight)) {
        root.style.setProperty("--webg-overlay-column-max-height", `${this.layoutOptions.columnMaxHeight}px`);
      }
      if (Number.isFinite(this.layoutOptions.top)) {
        root.style.top = `${this.layoutOptions.top}px`;
      }
      if (Number.isFinite(this.layoutOptions.left)) {
        root.style.left = `${this.layoutOptions.left}px`;
      }
      if (Number.isFinite(this.layoutOptions.right)) {
        root.style.right = `${this.layoutOptions.right}px`;
      }
      root.style.position = this.layoutOptions.positioningMode;
      root.classList.toggle("has-scroll-columns", this.layoutOptions.scrollColumns === true);
      root.classList.toggle("is-spread-columns", this.layoutOptions.spreadColumns === true);
      this.layout.collapseWidth = this.layoutOptions.collapseWidth;
      this.layout.compactWidth = this.layoutOptions.compactWidth;
      this.layout.scrollColumns = this.layoutOptions.scrollColumns === true;
      this.layout.spreadColumns = this.layoutOptions.spreadColumns === true;
      this.layout.containerElement = this.layoutOptions.containerElement ?? this.layout.containerElement;
      this.layout.viewportElement = this.layoutOptions.viewportElement ?? this.layout.viewportElement;
      this.layout.positioningMode = this.layoutOptions.positioningMode;
      this.syncLayout();
    }
    return this;
  }

  setLayout(options = {}) {
    const safeOptions = util.readPlainObject(options, "Dialogue setLayout options");
    this.applyLayoutOptions(safeOptions, true);
    if (hasOwn(safeOptions, "title")) {
      this.title = util.readOptionalString(safeOptions.title, "Dialogue title", this.title);
    }
    if (hasOwn(safeOptions, "footer")) {
      this.footerText = util.readOptionalString(safeOptions.footer, "Dialogue footer", this.footerText);
    }
    if (hasOwn(safeOptions, "stateTitle")) {
      this.stateTitle = util.readOptionalString(safeOptions.stateTitle, "Dialogue stateTitle", this.stateTitle);
    }
    if (hasOwn(safeOptions, "choicePromptText")) {
      this.choicePromptText = util.readOptionalString(
        safeOptions.choicePromptText,
        "Dialogue choicePromptText",
        this.choicePromptText
      );
    }
    if (hasOwn(safeOptions, "advancePromptText")) {
      this.advancePromptText = util.readOptionalString(
        safeOptions.advancePromptText,
        "Dialogue advancePromptText",
        this.advancePromptText
      );
    }
    if (hasOwn(safeOptions, "visibleHintText")) {
      this.visibleHintText = util.readOptionalString(
        safeOptions.visibleHintText,
        "Dialogue visibleHintText",
        this.visibleHintText
      );
    }
    if (hasOwn(safeOptions, "hiddenHintText")) {
      this.hiddenHintText = util.readOptionalString(
        safeOptions.hiddenHintText,
        "Dialogue hiddenHintText",
        this.hiddenHintText
      );
    }
    if (hasOwn(safeOptions, "showNextButton")) {
      this.showNextButton = util.readOptionalBoolean(
        safeOptions.showNextButton,
        "Dialogue showNextButton",
        this.showNextButton
      );
    }
    if (hasOwn(safeOptions, "showRestartButton")) {
      this.showRestartButton = util.readOptionalBoolean(
        safeOptions.showRestartButton,
        "Dialogue showRestartButton",
        this.showRestartButton
      );
    }
    if (hasOwn(safeOptions, "showHideButton")) {
      this.showHideButton = util.readOptionalBoolean(
        safeOptions.showHideButton,
        "Dialogue showHideButton",
        this.showHideButton
      );
    }
    if (hasOwn(safeOptions, "appendHistory")) {
      this.appendHistory = util.readOptionalBoolean(
        safeOptions.appendHistory,
        "Dialogue appendHistory",
        this.appendHistory
      );
    }
    if (hasOwn(safeOptions, "flipMainPanelBySide")) {
      this.flipMainPanelBySide = util.readOptionalBoolean(
        safeOptions.flipMainPanelBySide,
        "Dialogue flipMainPanelBySide",
        this.flipMainPanelBySide
      );
    }
    if (hasOwn(safeOptions, "getStateLines")) {
      this.stateLinesProvider = util.readOptionalFunction(
        safeOptions.getStateLines,
        "Dialogue getStateLines",
        this.stateLinesProvider
      );
    }
    if (hasOwn(safeOptions, "getDockOffset")) {
      this.dockOffsetProvider = util.readOptionalFunction(
        safeOptions.getDockOffset,
        "Dialogue getDockOffset",
        this.dockOffsetProvider
      );
    }
    if (hasOwn(safeOptions, "theme")) {
      this.setTheme(safeOptions.theme);
    }
    return this;
  }

  // これまでに表示した entry を会話ログとして 1 本の本文へまとめる
  // - speaker が切り替わっても本文側の読み順を保ち、現在 entry だけでなく直前の文脈も追いやすくする
  // - STATE は右側固定の確認欄として残し、本文だけを下へ積み上げる構成に向ける
  buildHistoryText() {
    const out = [];
    const pushEntry = (entry) => {
      if (!entry) {
        return;
      }
      const headerParts = [];
      if (entry.speaker) {
        headerParts.push(`[${entry.speaker}]`);
      }
      if (entry.title) {
        headerParts.push(entry.title);
      }
      const block = [];
      if (headerParts.length > 0) {
        block.push(headerParts.join(" "));
      }
      if (Array.isArray(entry.lines) && entry.lines.length > 0) {
        block.push(entry.lines.join("\n"));
      }
      if (block.length > 0) {
        out.push(block.join("\n"));
      }
    };

    const lastIndex = this.current()
      ? Math.min(this.queue.index, this.queue.items.length - 1)
      : (this.queue.items.length - 1);
    for (let i = 0; i <= lastIndex; i++) {
      pushEntry(this.queue.items[i]);
    }

    // appendLog() で積んだ report / inspection は queue より後に起きた内容なので、
    // queue 本文のあとへ連結して、左側本文を上から下へ時系列順に読む形へそろえる
    for (let i = 0; i < this.historyEntries.length; i++) {
      pushEntry(this.historyEntries[i]);
    }
    return out.join("\n\n");
  }

  ensureOverlay() {
    if (this.uiPanels || !this.doc || !this.doc.body) {
      return this.uiPanels;
    }

    this.uiPanels = new UIPanel({
      document: this.doc,
      theme: this.theme
    });
    this.layout = this.uiPanels.createLayout(this.layoutOptions);
    this.layout.root.classList.add("webg-dialogue-root");
    this.layout.root.hidden = true;
    this.nodes = this.buildOverlay();
    this.syncLayout();
    return this.uiPanels;
  }

  buildOverlay() {
    const mainPanel = this.uiPanels.createPanel(this.layout.left, { stack: true });
    const metaPanel = this.uiPanels.createPanel(this.layout.right, { stack: true });

    const speaker = this.uiPanels.createEyebrow(mainPanel, this.title);
    speaker.classList.add("webg-dialogue-speaker");
    const title = this.uiPanels.createTitle(mainPanel, "", 1);
    const body = this.uiPanels.createCopy(mainPanel, "");
    body.classList.add("webg-dialogue-body");
    body.style.whiteSpace = "pre-wrap";
    body.style.fontSize = "14px";
    body.style.lineHeight = "1.7";
    body.style.marginTop = "8px";
    const choiceGrid = this.uiPanels.createButtonGrid(mainPanel, { columns: 1 });
    const controlRow = this.uiPanels.createButtonRow(mainPanel);
    const nextButton = this.uiPanels.createButton(controlRow, { text: "Next" });
    const restartButton = this.uiPanels.createButton(controlRow, { text: "Restart" });
    const clearButton = this.uiPanels.createButton(controlRow, { text: "Hide" });
    const footer = this.uiPanels.createHint(mainPanel, this.footerText);

    const stateGroup = this.uiPanels.createGroup(metaPanel);
    const stateTitleNode = this.uiPanels.createTitle(stateGroup, this.stateTitle, 2);
    const state = this.uiPanels.createTextBlock(stateGroup, { text: "", code: true });
    const progress = this.uiPanels.createPill(metaPanel, { text: "step 0/0" });
    const choiceInfo = this.uiPanels.createTextBlock(metaPanel, { text: "", code: true });
    const controlHint = this.uiPanels.createHint(
      metaPanel,
      this.visibleHintText
    );

    nextButton.addEventListener("click", () => {
      nextButton.blur();
      this.next();
    });
    restartButton.addEventListener("click", () => {
      restartButton.blur();
      this.restart();
    });
    clearButton.addEventListener("click", () => {
      clearButton.blur();
      this.clear();
    });

    return {
      mainPanel,
      metaPanel,
      speaker,
      title,
      body,
      choiceGrid,
      nextButton,
      restartButton,
      clearButton,
      footer,
      stateTitleNode,
      state,
      progress,
      choiceInfo,
      controlHint,
      choiceButtons: []
    };
  }

  syncLayout() {
    if (!this.uiPanels || !this.layout) {
      return;
    }
    const rawDockOffset = this.dockOffsetProvider ? this.dockOffsetProvider() : 0;
    const dockOffset = util.readOptionalInteger(rawDockOffset, "Dialogue dockOffset", 0, { min: 0 });
    this.uiPanels.setDockOffset(this.layout, dockOffset);
    this.uiPanels.syncResponsiveLayout(this.layout);
  }

  start(entries = [], options = {}) {
    // 進行を必ず先頭から組み直し、同じ tutorial を再表示できるようにする
    this.setLayout(options);
    this.sourceEntries = cloneEntries(normalizeEntries(entries));
    this.historyEntries = [];
    this.queue.reset(this.sourceEntries);
    this.visible = this.queue.items.length > 0;
    this.lastChoiceLabel = "";
    this.lastStatus = "started";
    this.ensureOverlay();
    this.render();
    return this.current();
  }

  restart() {
    return this.start(this.sourceEntries, { title: this.title, footer: this.footerText });
  }

  clear() {
    this.queue.clear();
    this.historyEntries = [];
    this.visible = false;
    this.lastChoiceLabel = "";
    this.lastStatus = "cleared";
    this.render();
    return this;
  }

  current() {
    return this.queue.current();
  }

  isActive() {
    return this.visible && this.current() !== null;
  }

  enqueue(entries = []) {
    const count = this.queue.enqueue(entries);
    if (this.visible) {
      this.render();
    }
    return count;
  }

  // 本文ログだけを増やし、入力待ちは発生させない
  // - turn report や inspection のような補助情報を gameplay と切り離して積み上げる
  appendLog(entries = [], options = {}) {
    this.setLayout(options);
    const normalized = normalizeEntries(entries);
    for (let i = 0; i < normalized.length; i++) {
      this.historyEntries.push(cloneEntry(normalized[i]));
    }
    if (normalized.length > 0) {
      this.visible = true;
      this.lastStatus = "log updated";
    }
    this.ensureOverlay();
    this.render();
    return normalized.length;
  }

  next() {
    // 選択肢がある場面は、選択されるまで自然に飛ばさない
    const current = this.current();
    if (!current) {
      this.visible = false;
      this.lastStatus = "finished";
      this.render();
      return null;
    }
    if (Array.isArray(current.choices) && current.choices.length > 0 && current.autoAdvance !== true) {
      this.lastStatus = "choose a branch";
      this.render();
      return current;
    }
    const next = this.queue.next();
    if (!next) {
      this.visible = false;
      this.lastStatus = "finished";
    } else {
      this.lastStatus = "advanced";
    }
    this.render();
    return next;
  }

  choose(index = 0) {
    const current = this.current();
    if (!current || !Array.isArray(current.choices) || current.choices.length === 0) {
      return current;
    }
    if (!Number.isFinite(index) || !Number.isInteger(index) || index < 0) {
      throw new Error("Dialogue choice index must be an integer >= 0");
    }
    const choiceIndex = index;
    const choice = current.choices[choiceIndex];
    if (!choice) {
      throw new Error(`Dialogue choice index must be in range 0..${current.choices.length - 1}`);
    }
    current.selectedChoiceIndex = choiceIndex;
    this.lastChoiceLabel = choice.label;
    this.lastStatus = `choice:${choice.label}`;
    if (Array.isArray(choice.next) && choice.next.length > 0) {
      this.queue.insert(this.queue.index, choice.next);
    }
    current.autoAdvance = true;
    return this.next();
  }

  getState() {
    const current = this.current();
    return {
      active: this.isActive(),
      visible: this.visible,
      title: this.title,
      index: this.queue.index,
      size: this.queue.items.length,
      hasNext: this.queue.hasNext(),
      lastChoiceLabel: this.lastChoiceLabel,
      lastStatus: this.lastStatus,
      mode: this.uiPanels ? "overlay" : "idle",
      current: current
        ? {
            speaker: current.speaker,
            title: current.title,
            side: current.side,
            lineCount: current.lines.length,
            choiceCount: current.choices.length,
            selectedChoiceIndex: Number.isInteger(current.selectedChoiceIndex) ? current.selectedChoiceIndex : -1,
            autoAdvance: current.autoAdvance === true
          }
        : null
    };
  }

  render() {
    if (!this.uiPanels || !this.layout || !this.nodes) {
      return;
    }
    this.syncLayout();
    const current = this.current();
    const hasHistory = this.historyEntries.length > 0;
    this.layout.root.hidden = !this.visible || (!current && !hasHistory);
    if (!this.visible || (!current && !hasHistory)) {
      this.layout.root.classList.remove("is-main-right");
      this.nodes.choiceGrid.replaceChildren();
      this.nodes.body.textContent = "";
      this.nodes.title.textContent = this.title;
      this.nodes.speaker.textContent = this.title;
      this.nodes.stateTitleNode.textContent = this.stateTitle;
      this.nodes.state.textContent = "待機中";
      this.nodes.progress.textContent = "step 0/0";
      this.nodes.choiceInfo.textContent = "";
      this.nodes.nextButton.disabled = true;
      this.nodes.restartButton.disabled = this.queue.items.length === 0;
      this.nodes.clearButton.disabled = true;
      this.nodes.nextButton.hidden = this.showNextButton !== true;
      this.nodes.restartButton.hidden = this.showRestartButton !== true;
      this.nodes.clearButton.hidden = this.showHideButton !== true;
      return;
    }

    const activeEntry = current ?? null;
    this.layout.root.classList.toggle(
      "is-main-right",
      this.flipMainPanelBySide === true && activeEntry?.side === "right"
    );
    this.nodes.speaker.textContent = activeEntry?.speaker || this.title;
    this.nodes.title.textContent = activeEntry?.title || this.title;
    this.nodes.stateTitleNode.textContent = this.stateTitle;
    this.nodes.body.textContent = this.appendHistory === true
      ? this.buildHistoryText()
      : (activeEntry?.lines ?? []).join("\n\n");
    this.nodes.footer.textContent = this.footerText;
    const stateLines = toTextLines(this.stateLinesProvider?.({
      active: this.isActive(),
      visible: this.visible,
      current: activeEntry,
      index: this.queue.index,
      size: this.queue.items.length,
      lastChoiceLabel: this.lastChoiceLabel,
      lastStatus: this.lastStatus,
      historyCount: this.historyEntries.length
    }));
    if (stateLines.length > 0) {
      stateLines.push("----");
    }
    stateLines.push(
      `発話者=${activeEntry?.speaker || "-"}`,
      `見出し=${activeEntry?.title || "-"}`,
      `選択肢=${activeEntry?.choices?.length ?? 0}`,
      `直近選択=${this.lastChoiceLabel || "-"}`,
      `状態=${this.lastStatus}`
    );
    this.nodes.state.textContent = stateLines.join("\n");
    this.nodes.progress.textContent = activeEntry
      ? `step ${Math.min(this.queue.index + 1, this.queue.items.length)}/${this.queue.items.length}`
      : `log ${this.historyEntries.length}`;
    this.nodes.choiceInfo.textContent = activeEntry && activeEntry.choices.length > 0
      ? this.choicePromptText
      : this.advancePromptText;
    this.nodes.nextButton.hidden = this.showNextButton !== true;
    this.nodes.restartButton.hidden = this.showRestartButton !== true;
    this.nodes.clearButton.hidden = this.showHideButton !== true;
    this.nodes.nextButton.disabled = !activeEntry || (Array.isArray(activeEntry.choices) && activeEntry.choices.length > 0 && activeEntry.autoAdvance !== true);
    this.nodes.restartButton.disabled = this.showRestartButton !== true || this.queue.items.length === 0;
    this.nodes.clearButton.disabled = this.showHideButton !== true ? true : false;

    this.nodes.choiceGrid.replaceChildren();
    this.nodes.choiceButtons = [];
    for (let i = 0; i < (activeEntry?.choices?.length ?? 0); i++) {
      const choice = activeEntry.choices[i];
      const button = this.uiPanels.createButton(this.nodes.choiceGrid, {
        text: `${i + 1}. ${choice.label}`
      });
      button.setAttribute("aria-label", choice.label);
      button.addEventListener("click", () => {
        button.blur();
        this.choose(i);
      });
      this.uiPanels.setButtonActive(button, i === activeEntry.selectedChoiceIndex);
      this.nodes.choiceButtons.push(button);
    }
    this.nodes.body.scrollTop = this.nodes.body.scrollHeight;
    this.nodes.mainPanel.scrollTop = this.nodes.mainPanel.scrollHeight;
    this.nodes.controlHint.textContent = this.visible
      ? this.visibleHintText
      : this.hiddenHintText;
  }
}
