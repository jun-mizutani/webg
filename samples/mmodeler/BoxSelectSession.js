// ---------------------------------------------
// samples/mmodeler/BoxSelectSession.js  2026/10/25
//   mobile box selection preview session for mmodeler
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

function requireFunction(value, name) {
  if (typeof value !== "function") {
    throw new Error(`BoxSelectSession requires ${name}`);
  }
  return value;
}

// mobile profile の矩形選択 preview を管理する
// drag 中の矩形 DOM 表示、pointerup 後の確定待ち、tap confirm、cancel の寿命をまとめる
// 実際の object / vertex / face selection は main.js 側の selectByClientRect callback に委譲する
export default class BoxSelectSession {
  constructor({
    getCanvas,
    getEditorMode,
    getEditorTool,
    setMobileOrbitEnabled,
    setMessage,
    selectByClientRect,
    defaultMode
  }) {
    this.getCanvas = requireFunction(getCanvas, "getCanvas");
    this.getEditorMode = requireFunction(getEditorMode, "getEditorMode");
    this.getEditorTool = requireFunction(getEditorTool, "getEditorTool");
    this.setMobileOrbitEnabled = requireFunction(setMobileOrbitEnabled, "setMobileOrbitEnabled");
    this.setMessage = requireFunction(setMessage, "setMessage");
    this.selectByClientRect = requireFunction(selectByClientRect, "selectByClientRect");
    this.defaultMode = defaultMode ?? "object";
    this.selectionRectEl = null;
    this.active = false;
    this.awaitingConfirm = false;
    this.rect = null;
    this.additive = false;
    this.targetMode = this.defaultMode;
    this.targetTool = null;
  }

  // diagnostics や pointer handler から、tap confirm 待ちかどうかを短く読めるようにする
  get isAwaitingConfirm() {
    return this.awaitingConfirm;
  }

  // 矩形選択表示用 DOM 要素を必要に応じて作成する
  // canvas の親要素へ DOM を重ね、矩形の表示を管理する
  ensureElement() {
    if (this.selectionRectEl?.isConnected) {
      return this.selectionRectEl;
    }
    const canvas = this.getCanvas();
    const parent = canvas?.parentElement ?? null;
    if (!canvas || !parent) {
      return null;
    }
    this.selectionRectEl = document.createElement("div");
    this.selectionRectEl.className = "selection-rect";
    parent.appendChild(this.selectionRectEl);
    return this.selectionRectEl;
  }

  // client 座標の矩形を canvas 親要素内の selection preview として表示する
  // 座標を canvas 内へ clamp し、preview を表示領域に収める
  showRect(rect) {
    const el = this.ensureElement();
    const canvas = this.getCanvas();
    if (!el || !canvas) {
      return;
    }
    const canvasRect = canvas.getBoundingClientRect();
    const left = Math.max(canvasRect.left, rect.left) - canvasRect.left;
    const top = Math.max(canvasRect.top, rect.top) - canvasRect.top;
    const right = Math.min(canvasRect.right, rect.right) - canvasRect.left;
    const bottom = Math.min(canvasRect.bottom, rect.bottom) - canvasRect.top;
    el.style.display = "block";
    el.style.left = `${Math.max(0, left)}px`;
    el.style.top = `${Math.max(0, top)}px`;
    el.style.width = `${Math.max(0, right - left)}px`;
    el.style.height = `${Math.max(0, bottom - top)}px`;
  }

  // 矩形 preview を非表示にする
  // session state を消すかどうかは呼び出し側で決めるため、DOM 表示だけを担当する
  hideRect() {
    if (this.selectionRectEl) {
      this.selectionRectEl.style.display = "none";
    }
  }

  // 矩形選択 preview 状態を破棄する
  // hidePreview を false にすると、直後に新しい preview を描き直す処理から一時的に呼びやすい
  clear({ hidePreview = true } = {}) {
    this.active = false;
    this.awaitingConfirm = false;
    this.rect = null;
    this.additive = false;
    this.targetMode = this.defaultMode;
    this.targetTool = null;
    if (hidePreview) {
      this.hideRect();
    }
  }

  // drag終了時は矩形をpreviewとして保持し、次の確定操作を待つ
  // pointerup は「指で隠れていた終点を確認できる状態」に留め、次の tap で確定する
  holdPreview(rect, additive = false) {
    this.active = true;
    this.awaitingConfirm = true;
    this.rect = rect;
    this.additive = additive === true;
    this.targetMode = this.getEditorMode();
    this.targetTool = this.getEditorTool();
    this.setMobileOrbitEnabled(false);
    this.showRect(rect);
    this.setMessage("box select preview: tap to confirm, drag again to adjust");
  }

  // preview 待ちの矩形を tap で確定する
  // 確定時に selectByClientRect を呼び、それまでは現在の selection を維持する
  confirm() {
    if (!this.awaitingConfirm || !this.rect) {
      return false;
    }
    const rect = this.rect;
    const additive = this.additive;
    this.clear();
    this.setMobileOrbitEnabled(true);
    this.selectByClientRect(rect, additive);
    return true;
  }

  // long press や別 command で preview を取り消す
  // cancelは現在の選択を保持し、矩形表示とsession stateを終了する
  cancel(message = "box select canceled") {
    this.clear();
    this.setMobileOrbitEnabled(true);
    if (message) {
      this.setMessage(message);
    }
  }
}
