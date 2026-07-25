// ---------------------------------------------
// samples/mmodeler/CommandPalette.js  2026/07/25
//   mobile command palette controller for mmodeler
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// mobile ribbon と command palette で共有する action 表示名
// 実行処理は main.js 側の command dispatch に残し、この module は UI 表示だけを担当する
const ACTION_LABELS = {
  "load": { label: "Load", detail: "file" },
  "save-json": { label: "Json", detail: "gz" },
  "save-glb": { label: "Glb", detail: "save" },
  "new-scene": { label: "New", detail: "new" },
  "toggle-projection": { label: "Pr", detail: "ortho" },
  "toggle-x-mirror": { label: "M", detail: "mirror" },
  "undo": { label: "Undo", detail: "undo" },
  "redo": { label: "Redo", detail: "redo" },
  "screenshot": { label: "Shot", detail: "screen" },
  "move": { label: "G", detail: "move" },
  "rotate": { label: "R", detail: "rotate" },
  "scale": { label: "S", detail: "scale" },
  "extrude": { label: "E", detail: "extrude" },
  "loop-cut": { label: "Cut", detail: "loopcut" },
  "axis-x": { label: "X", detail: "axis" },
  "axis-y": { label: "Y", detail: "axis" },
  "axis-z": { label: "Z", detail: "axis" },
  "axis-normal": { label: "N", detail: "normal" },
  "delete": { label: "Del", detail: "delete" },
  "origin-world": { label: "O", detail: "origin" },
  "mode-object": { label: "1", detail: "object" },
  "mode-edit": { label: "Edit", detail: "mode" },
  "mode-sculpt": { label: "Scpt", detail: "sculpt" },
  "sculpt-draw": { label: "Draw", detail: "normal" },
  "sculpt-blur": { label: "Blur", detail: "average" },
  "sculpt-grab": { label: "Grab", detail: "drag" },
  "sculpt-pinch": { label: "Pinch", detail: "center" },
  "sculpt-plus": { label: "Sclpt", detail: "normal +" },
  "sculpt-minus": { label: "Sclp-", detail: "normal -" },
  "sculpt-brush": { label: "Brsh", detail: "brush" },
  "tool-face": { label: "Face", detail: "face" },
  "tool-vertex": { label: "Vert", detail: "vertex" },
  "tool-add": { label: "Add", detail: "vertex" },
  "select-all": { label: "A", detail: "all" },
  "invert-selection": { label: "Inv", detail: "invert" },
  "select-x-negative": { label: "Half", detail: "X<0" },
  "chain-select": { label: "Chain", detail: "select" },
  "select-loop": { label: "Loop", detail: "select" },
  "subdivide": { label: "Subd", detail: "mesh" },
  "catmull-clark": { label: "Catm", detail: "smooth" },
  "view-vertex": { label: "Cood", detail: "edit" },
  "object-info": { label: "Info", detail: "object" },
  "object-wireframe": { label: "Wire", detail: "wire" },
  "object-smooth-shading": { label: "Smth", detail: "smooth" },
  "cycle-lens": { label: "Lens", detail: "mm" },
  "edge-slide": { label: "GG", detail: "slide" },
  "add-cube": { label: "Cube", detail: "add" },
  "add-torus": { label: "Torus", detail: "add" },
  "add-plane": { label: "Plane", detail: "add" },
  "add-sphere": { label: "Ball", detail: "add" },
  "add-cylinder": { label: "Cyl", detail: "add" },
  "add-cone": { label: "Cone", detail: "add" },
  "add-double-cone": { label: "DCone", detail: "add" },
  "join-objects": { label: "Join", detail: "object" },
  "primitive-segments-3": { label: "3", detail: "seg" },
  "primitive-segments-4": { label: "4", detail: "seg" },
  "primitive-segments-8": { label: "8", detail: "seg" },
  "primitive-segments-12": { label: "12", detail: "seg" },
  "primitive-segments-16": { label: "16", detail: "seg" },
  "primitive-segments-24": { label: "24", detail: "seg" },
  "primitive-segments-32": { label: "32", detail: "seg" },
  "undefined": { label: "-", detail: "" },
  "palette-next": { label: "Next", detail: "page" },
  "view-x": { label: "X", detail: "view" },
  "view-x-reverse": { label: "-X", detail: "view" },
  "view-y": { label: "Y", detail: "view" },
  "view-y-reverse": { label: "-Y", detail: "view" },
  "view-z": { label: "Z", detail: "view" },
  "view-z-reverse": { label: "-Z", detail: "view" }
};

// ユーザー指定の command palette は行ごとの表示順をそのまま配列化する
// CSS grid は row-major で button を配置するため、ここでは画面上の行順を直接保持する
function paletteRows(rows) {
  return rows.flatMap((row) => row);
}

const COMMAND_PAGES = [
  paletteRows([
    ["move", "extrude", "tool-vertex", "axis-x"],
    ["rotate", "edge-slide", "tool-face", "axis-y"],
    ["scale", "loop-cut", "undo", "axis-z"],
    ["palette-next", "chain-select", "redo", "axis-normal"]
  ]),
  paletteRows([
    ["catmull-clark", "select-all", "tool-add", "toggle-projection"],
    ["subdivide", "invert-selection", "delete", "object-wireframe"],
    ["toggle-x-mirror", "select-x-negative", "sculpt-plus", "object-smooth-shading"],
    ["palette-next", "select-loop", "undefined", "cycle-lens"]
  ]),
  paletteRows([
    ["load",     "origin-world",  "undefined", "view-vertex"],
    ["save-json", "screenshot",   "undefined",  "object-info"],
    ["save-glb",  "join-objects", "undefined", "undefined"],
    ["palette-next", "undefined", "undefined","new-scene"]
  ]),
  paletteRows([
    ["add-cube", "add-torus", "add-sphere", "add-double-cone"],
    ["add-cylinder", "add-cone", "add-plane", "undefined"],
    ["primitive-segments-3", "primitive-segments-4", "primitive-segments-8", "primitive-segments-12"],
    ["palette-next", "primitive-segments-16", "primitive-segments-24", "primitive-segments-32"]
  ])
];

const SCULPT_COMMAND_PAGES = [
  paletteRows([
    ["sculpt-draw", "undefined", "sculpt-brush", "toggle-projection"],
    ["sculpt-blur", "undefined", "toggle-x-mirror", "object-wireframe"],
    ["sculpt-grab", "sculpt-plus", "undo", "object-smooth-shading"],
    ["sculpt-pinch", "sculpt-minus", "redo", "mode-edit"]
  ])
];

// action id から表示 label と補助 detail を返す
// 未登録 action は開発中の command でも画面に出せるよう、action id をそのまま label にする
export function getCommandActionLabel(action, context = {}) {
  if (context?.sculptPalette === true) {
    if (action === "sculpt-plus") {
      return { label: "Sclp+", detail: "normal +" };
    }
    if (action === "sculpt-minus") {
      return { label: "Sclp-", detail: "normal -" };
    }
  }
  return ACTION_LABELS[action] ?? { label: action, detail: "" };
}

// `axis`の`class`を現在の入力と状態から求め、呼び出し元へ返す
function getAxisClass(action) {
  if (action === "axis-x") {
    return "axis-x";
  }
  if (action === "axis-y") {
    return "axis-y";
  }
  if (action === "axis-z") {
    return "axis-z";
  }
  if (action === "axis-normal") {
    return "axis-n";
  }
  return "";
}

// mobile command palette の表示状態と DOM 反映をまとめる
// コマンド実行や編集状態の判定は main.js 側の callback に委譲し、
// この class は「どの button に何を表示し、palette をどこへ出すか」だけを担当する
export default class CommandPalette {
  constructor({
    isMobileProfile,
    root,
    buttons,
    getCanvasRect,
    getActionLabel = getCommandActionLabel,
    isActionEnabled,
    isActionActive,
    cancelPendingTap,
    isSculptPalette = null
  }) {
    this.isMobileProfile = isMobileProfile === true;
    this.root = root ?? null;
    this.buttons = Array.isArray(buttons) ? buttons : [];
    this.getCanvasRect = getCanvasRect;
    this.getActionLabel = getActionLabel;
    this.isActionEnabled = isActionEnabled;
    this.isActionActive = isActionActive;
    this.cancelPendingTap = cancelPendingTap;
    this.isSculptPalette = isSculptPalette;
    this.opened = false;
    this.kind = "selection";
    this.page = 0;
  }

  // palette が現在開いているかを返す
  // main.js の入力処理はこの値を見て single tap 確定や camera 操作との競合を避ける
  get isOpen() {
    return this.opened;
  }

  // 現在の page 番号を 0-based で返す
  // status message では利用者向けに +1 した値を表示する
  get pageIndex() {
    return this.page;
  }

  // palette を閉じる
  // 状態と CSS class を同時に更新し、後続の pointer 入力が通常操作へ戻れるようにする
  close() {
    this.opened = false;
    this.root?.classList?.remove("open");
  }

  // 次の command page へ進め、button 表示を更新する
  // 最終 page の次は 1 枚目へ戻し、狭い mobile UI でも全 command を循環して使えるようにする
  nextPage() {
    const pages = this.getPageSet();
    this.page = (this.page + 1) % pages.length;
    this.render();
    return this.page;
  }

  getPageSet() {
    return this.isSculptPalette?.() === true ? SCULPT_COMMAND_PAGES : COMMAND_PAGES;
  }

  // 現在表示中の page に対応する action 配列を返す
  // page が不正値になった場合は 1 枚目を返し、空 palette を出さない
  getActions() {
    const pages = this.getPageSet();
    return pages[this.page] ?? pages[0];
  }

  // command palette を開く
  // double tap や空 scene の操作から呼ばれ、まず保留中の single tap 選択を破棄する
  // その後、tap 位置を隠さない中心点を計算して palette を配置し、1 枚目の command page を描画する
  open(kind, clientX, clientY) {
    if (!this.isMobileProfile || !this.root) {
      return;
    }
    this.cancelPendingTap?.();
    this.opened = true;
    this.kind = kind ?? "selection";
    this.page = 0;
    const rect = this.getCanvasRect?.();
    if (rect) {
      const paletteHalfWidth = 132;
      const paletteHalfHeight = 108;
      const localX = Number(clientX) - rect.left;
      const localY = Number(clientY) - rect.top;
      const center = this.chooseCenter(rect, localX, localY, paletteHalfWidth, paletteHalfHeight);
      this.root.style.left = `${center.x}px`;
      this.root.style.top = `${center.y}px`;
    }
    this.root.classList.add("open");
    this.render();
  }

  // command palette の button 表示を現在 page の action に合わせて更新する
  // 各 button には実行 action、表示 label、active 表示、page switch 表示、disabled 状態をまとめて反映する
  // 未割り当て slot は `undefined` action として表示し、空 action は button 自体を隠す
  render() {
    if (!this.isMobileProfile) {
      return;
    }
    const actions = this.getActions();
    const sculptPalette = this.isSculptPalette?.() === true;
    this.root?.classList?.toggle("sculpt-palette", sculptPalette);
    for (let i = 0; i < this.buttons.length; i++) {
      const button = this.buttons[i];
      const action = actions[i] ?? "";
      const label = this.getActionLabel(action, {
        sculptPalette,
        page: this.page
      });
      const active = this.isActionActive?.(action) === true;
      const enabled = this.isActionEnabled?.(action) === true;
      const pageSwitch = action === "palette-next";
      const modeSwitch = action === "mode-edit"
        || action === "mode-sculpt"
        || (action === "sculpt-plus" && sculptPalette !== true);
      const axisClass = getAxisClass(action);
      button.dataset.action = action;
      button.innerHTML = action ? `${label.label}<small>${label.detail}</small>` : "";
      button.disabled = !action || !enabled;
      button.classList.toggle("active", active);
      button.classList.toggle("page-switch", pageSwitch);
      button.classList.toggle("mode-switch", modeSwitch);
      button.classList.toggle("axis-x", axisClass === "axis-x");
      button.classList.toggle("axis-y", axisClass === "axis-y");
      button.classList.toggle("axis-z", axisClass === "axis-z");
      button.classList.toggle("axis-n", axisClass === "axis-n");
      button.setAttribute("aria-pressed", active ? "true" : "false");
      button.style.visibility = action ? "visible" : "hidden";
    }
  }

  // command palette の表示中心を決める
  // CSS の translate(-50%, -50%) により left/top は palette の中心点として解釈される
  // tap 位置をそのまま中心にすると、ユーザーが指定した geometry や empty 位置を palette が完全に覆ってしまう
  // そのため、tap 位置が canvas 中心から見て右上なら右上、左下なら左下というように、tap 位置から外側へずらした候補を作る
  // 最初の候補が画面外へはみ出す場合は対角側、その次に残りの斜め方向を試し、どれも入らない場合だけ画面内へ clamp する
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
      x: Math.max(minCenterX, Math.min(maxCenterX, localX + directionX * (halfWidth + gap))),
      y: Math.max(minCenterY, Math.min(maxCenterY, localY + directionY * (halfHeight + gap)))
    };
  }
}
