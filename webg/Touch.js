// ---------------------------------------------
// Touch.js       2026/04/12
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// 汎用タッチ入力UI:
// - coarse pointer 端末向けの仮想ボタンを生成する
// - hold/action の2種を統一的に扱う
// - onPress/onRelease/onAction コールバックでアプリ側へ橋渡しする
export default class Touch {
  constructor(doc, options = {}) {
    this.doc = doc ?? document;
    this.options = {
      touchDeviceOnly: true,
      force: false,
      styleId: "webg-touch-style",
      positioningMode: "fixed",
      containerElement: null,
      viewportElement: null,
      ...options
    };
    this.root = null;
    this.groups = [];
    this.pointerToButton = new Map();
    this.onPress = null;
    this.onRelease = null;
    this.onAction = null;
    this.onAnyPress = null;
    this.autoSpread = true;
    this._boundReleaseAll = () => this.releaseAll();
    window.addEventListener("blur", this._boundReleaseAll);
    this._boundApplyLayoutMode = () => {
      this.applyDensitySize();
      this.applyLayoutMode();
    };
    window.addEventListener("resize", this._boundApplyLayoutMode);
    window.addEventListener("orientationchange", this._boundApplyLayoutMode);
  }

  isCoarsePointer() {
    if (this.options.force) return true;
    if (!window.matchMedia) return false;
    return window.matchMedia("(pointer: coarse)").matches;
  }

  isEnabled() {
    if (!this.options.touchDeviceOnly) return true;
    return this.isCoarsePointer();
  }

  injectDefaultStyle() {
    if (this.doc.getElementById(this.options.styleId)) return;
    const style = this.doc.createElement("style");
    style.id = this.options.styleId;
    style.textContent = `
      .webg-touch-root {
        --webg-touch-btn-size: 52px;
        --webg-touch-action-size: 52px;
        --webg-touch-btn-font-size: 22px;
        position: fixed;
        left: 0;
        right: var(--webg-canvas-right-inset, 0px);
        bottom: 0;
        padding: 10px 12px calc(10px + env(safe-area-inset-bottom));
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        align-items: flex-end;
        row-gap: 8px;
        column-gap: 10px;
        z-index: 30;
        pointer-events: none;
        user-select: none;
        -webkit-user-select: none;
      }
      .webg-touch-root.webg-touch-multiline {
        justify-content: center;
      }
      .webg-touch-root.webg-touch-spread {
        justify-content: space-between;
      }
      .webg-touch-group {
        display: flex;
        flex-wrap: nowrap;
        gap: 8px;
        pointer-events: auto;
        flex: 0 0 auto;
      }
      .webg-touch-btn {
        width: var(--webg-touch-btn-size);
        height: var(--webg-touch-btn-size);
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.58);
        background: rgba(16, 24, 16, 0.52);
        color: #f4f7ff;
        font: 700 var(--webg-touch-btn-font-size)/1 sans-serif;
        touch-action: none;
        -webkit-tap-highlight-color: transparent;
      }
      .webg-touch-btn.webg-touch-action {
        width: var(--webg-touch-action-size);
        height: var(--webg-touch-action-size);
        border-radius: 36px;
        font-size: var(--webg-touch-btn-font-size);
        background: rgba(28, 78, 42, 0.58);
      }
      .webg-touch-btn.webg-touch-active {
        background: rgba(66, 152, 255, 0.78);
        border-color: rgba(218, 235, 255, 0.92);
      }
    `;
    this.doc.head.appendChild(style);
  }

  create({
    groups = [],
    autoSpread = true,
    onPress = null,
    onRelease = null,
    onAction = null,
    onAnyPress = null,
    className = "webg-touch-root",
    positioningMode = this.options.positioningMode,
    containerElement = this.options.containerElement,
    viewportElement = this.options.viewportElement
  } = {}) {
    if (!this.isEnabled()) return null;
    this.destroy();
    this.injectDefaultStyle();

    this.onPress = onPress;
    this.onRelease = onRelease;
    this.onAction = onAction;
    this.onAnyPress = onAnyPress;

    const root = this.doc.createElement("div");
    root.className = className;
    this.root = root;
    this.groups = groups;
    this.autoSpread = autoSpread;
    this.options.positioningMode = positioningMode === "absolute" ? "absolute" : "fixed";
    this.options.containerElement = containerElement ?? this.doc.body;
    this.options.viewportElement = viewportElement ?? null;
    if (this.options.positioningMode === "absolute") {
      root.style.position = "absolute";
      root.style.left = "0px";
      root.style.right = "0px";
      root.style.bottom = "0px";
      root.style.top = "auto";
      const host = this.options.containerElement;
      if (host?.style) {
        const currentPosition = host.style.position || window.getComputedStyle(host).position;
        if (currentPosition === "static" || !currentPosition) {
          host.style.position = "relative";
        }
      }
    } else {
      root.style.position = "fixed";
      root.style.left = "0px";
      root.style.right = "var(--webg-canvas-right-inset, 0px)";
      root.style.bottom = "0px";
      root.style.top = "auto";
    }

    for (let gi = 0; gi < groups.length; gi++) {
      const g = groups[gi] ?? {};
      const wrap = this.doc.createElement("div");
      wrap.className = `webg-touch-group ${g.className ?? ""}`.trim();
      wrap.dataset.group = g.id ?? `group_${gi}`;

      const buttons = Array.isArray(g.buttons) ? g.buttons : [];
      for (let bi = 0; bi < buttons.length; bi++) {
        const b = buttons[bi] ?? {};
        const key = String(b.key ?? "");
        if (!key) continue;
        const kind = b.kind === "action" ? "action" : "hold";
        const el = this.doc.createElement("button");
        el.type = "button";
        el.className = `webg-touch-btn ${kind === "action" ? "webg-touch-action" : ""} ${b.className ?? ""}`.trim();
        el.textContent = String(b.label ?? key);
        el.dataset.key = key;
        el.dataset.kind = kind;
        if (b.ariaLabel) el.setAttribute("aria-label", b.ariaLabel);
        if (b.width) el.style.width = `${b.width}px`;
        if (b.height) el.style.height = `${b.height}px`;
        if (b.width || b.height) el.dataset.touchFixedSize = "1";

        const infoFromEvent = (ev) => ({ key, kind, button: b, element: el, event: ev, touch: this });

        const onDown = (ev) => {
          ev.preventDefault();
          if (this.onAnyPress) this.onAnyPress(infoFromEvent(ev));
          if (kind === "action") {
            el.classList.add("webg-touch-active");
            if (this.onAction) this.onAction(infoFromEvent(ev));
            return;
          }
          this.pointerToButton.set(ev.pointerId, { key, button: b, element: el });
          el.classList.add("webg-touch-active");
          if (this.onPress) this.onPress(infoFromEvent(ev));
        };

        const onUp = (ev) => {
          ev.preventDefault();
          if (kind === "action") {
            el.classList.remove("webg-touch-active");
            return;
          }
          const mapped = this.pointerToButton.get(ev.pointerId);
          if (!mapped || mapped.element !== el) return;
          this.pointerToButton.delete(ev.pointerId);
          el.classList.remove("webg-touch-active");
          if (this.onRelease) this.onRelease(infoFromEvent(ev));
        };

        el.addEventListener("pointerdown", onDown);
        el.addEventListener("pointerup", onUp);
        el.addEventListener("pointercancel", onUp);
        el.addEventListener("pointerleave", onUp);
        wrap.appendChild(el);
      }
      root.appendChild(wrap);
    }

    (this.options.containerElement ?? this.doc.body).appendChild(root);
    this.applyDensitySize();
    this.applyLayoutMode();
    return root;
  }

  // action ボタンだけをまとめて作る簡易入口
  // sample 側では hold ボタンと分けずに、ワンショット操作群だけを
  // ひとまとめに見せたいときに使う
  createActionButtons(groups = [], options = {}) {
    const normalizedGroups = (groups ?? []).map((group) => {
      const buttons = Array.isArray(group?.buttons) ? group.buttons : [];
      return {
        ...group,
        buttons: buttons.map((button) => ({
          ...button,
          kind: "action"
        }))
      };
    });
    return this.create({
      ...options,
      groups: normalizedGroups
    });
  }

  applyDensitySize() {
    if (!this.root) return;
    const btns = this.root.querySelectorAll(".webg-touch-btn");
    const count = btns.length;
    let size = 52;
    let density = "normal";
    if (count >= 9) {
      size = 44;
      density = "compact";
    } else if (count >= 6) {
      size = 48;
      density = "dense";
    }

    this.root.dataset.touchCount = String(count);
    this.root.dataset.touchDensity = density;
    this.root.style.setProperty("--webg-touch-btn-size", `${size}px`);
    this.root.style.setProperty("--webg-touch-action-size", `${size}px`);
  }

  applyLayoutMode() {
    if (!this.root) return;
    const viewportWidth = Math.floor(
      this.options.viewportElement?.clientWidth
      || this.root.parentElement?.clientWidth
      || window.innerWidth
      || 0
    );
    const groups = this.root.querySelectorAll(".webg-touch-group");
    const rootStyle = window.getComputedStyle(this.root);
    const padLeft = Number.parseFloat(rootStyle.paddingLeft);
    const padRight = Number.parseFloat(rootStyle.paddingRight);
    const groupGap = Number.parseFloat(rootStyle.columnGap);
    let estimatedWidth = padLeft + padRight;
    const groupItems = [];

    for (let gi = 0; gi < groups.length; gi++) {
      const btns = groups[gi].querySelectorAll(".webg-touch-btn");
      if (btns.length === 0) continue;
      let groupWidth = 0;
      for (let bi = 0; bi < btns.length; bi++) {
        const style = window.getComputedStyle(btns[bi]);
        groupWidth += Number.parseFloat(style.width);
      }
      const groupStyle = window.getComputedStyle(groups[gi]);
      const btnGap = Number.parseFloat(groupStyle.columnGap || groupStyle.gap);
      groupWidth += btnGap * Math.max(0, btns.length - 1);
      groupItems.push({ element: groups[gi], width: groupWidth, buttonCount: btns.length });
      estimatedWidth += groupWidth;
    }
    estimatedWidth += groupGap * Math.max(0, groupItems.length - 1);

    // サイズを確定した後の実幅で、単一行か複数行かを判断する
    const useMultiline = estimatedWidth > viewportWidth * 0.95;
    const spreadEligibleGroupCount = groupItems.length >= 3;
    let useSpread = false;
    if (this.autoSpread && spreadEligibleGroupCount) {
      if (!useMultiline) {
        // 1行で余白が十分あるときは左右へ展開し、中央グループを作りやすくする
        const freeWidth = viewportWidth - estimatedWidth;
        useSpread = freeWidth > viewportWidth * 0.08;
      } else {
        // 複数行時は行単位で左右展開可否を判定するため、ここでは有効化して後段へ委譲する
        useSpread = true;
      }
    }

    this.root.dataset.touchLayout = useMultiline ? "multiline" : "singleline";
    this.root.dataset.touchSpread = useSpread ? "spread" : "center";
    this.root.classList.toggle("webg-touch-multiline", useMultiline);
    this.root.classList.toggle("webg-touch-spread", useSpread);

    if (useMultiline && useSpread) {
      const availableWidth = viewportWidth * 0.95 - padLeft - padRight;
      this.applyMultilineSpreadByRows(groupItems, groupGap, availableWidth);
    } else {
      this.resetGroupInlineLayout(groupItems);
    }
  }

  resetGroupInlineLayout(groupItems = null) {
    const items = groupItems ?? Array.from(this.root?.querySelectorAll(".webg-touch-group") ?? []).map((el) => ({ element: el }));
    for (let i = 0; i < items.length; i++) {
      const el = items[i].element;
      if (!el) continue;
      el.style.removeProperty("flex");
      el.style.removeProperty("width");
      el.style.removeProperty("flex-wrap");
      el.style.removeProperty("row-gap");
      el.style.removeProperty("justify-content");
    }
  }

  applyMultilineSpreadByRows(groupItems, groupGap, availableWidth) {
    this.resetGroupInlineLayout(groupItems);
    const rows = [];
    let current = [];
    let usedWidth = 0;

    for (let i = 0; i < groupItems.length; i++) {
      const item = groupItems[i];
      const need = current.length === 0 ? item.width : item.width + groupGap;
      if (current.length > 0 && usedWidth + need > availableWidth) {
        rows.push(current);
        current = [item];
        usedWidth = item.width;
      } else {
        current.push(item);
        usedWidth += need;
      }
    }
    if (current.length > 0) rows.push(current);

    // 1行に1グループだけ載るケースでは、グループ内ボタン自体を左右へ展開する
    for (let ri = 0; ri < rows.length; ri++) {
      const row = rows[ri];
      if (row.length !== 1) continue;
      const item = row[0];
      const el = item.element;
      if (!el) continue;
      el.style.flex = "1 1 100%";
      if (item.buttonCount <= 1) {
        el.style.justifyContent = "center";
        continue;
      }
      if (item.width > availableWidth) {
        // 単独行でも横幅超過する場合はグループ内で折り返してはみ出しを防ぐ
        el.style.width = "100%";
        el.style.flexWrap = "wrap";
        el.style.rowGap = "8px";
        el.style.justifyContent = "space-between";
      } else {
        el.style.justifyContent = "space-between";
      }
    }
  }

  releaseAll() {
    const entries = Array.from(this.pointerToButton.entries());
    this.pointerToButton.clear();
    for (let i = 0; i < entries.length; i++) {
      const [, mapped] = entries[i];
      if (mapped?.element) mapped.element.classList.remove("webg-touch-active");
      if (this.onRelease) {
        this.onRelease({
          key: mapped?.key ?? "",
          kind: "hold",
          button: mapped?.button ?? null,
          element: mapped?.element ?? null,
          event: null,
          touch: this
        });
      }
    }
  }

  destroy() {
    this.releaseAll();
    if (this.root?.parentNode) {
      this.root.parentNode.removeChild(this.root);
    }
    this.root = null;
    this.groups = [];
  }
}
