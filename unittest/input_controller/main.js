// ---------------------------------------------
// unittest/input_controller/main.js  2026/04/12
//   input_controller unittest
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import InputController from "../../webg/InputController.js";
import Touch from "../../webg/Touch.js";

// この test は、InputController が
// - physical key の継続状態
// - action map の束ね込み
// - touch / UI 由来の pulse action
// を同じ土台で扱えるかを確認する
//
// まず自動テストを走らせ、その後に keyboard と touch ボタンを
// 実際に操作して、同じ action 名で同じ動きになるかを手で確認する

const statusEl = document.getElementById("status");

// 自動テストの結果を後から 1 か所にまとめて表示するための入れ物
// 各 check の結果はここへ蓄積して、最後に status に流し込む
const lines = [];
let passCount = 0;
let failCount = 0;

// 1 件分のテスト結果を記録する
// DOM へ直接書き込まず、あとで見やすい順番に整えて出す
const log = (line) => {
  lines.push(line);
};

// 条件が通っているかを判定して、PASS / FAIL と件数を同時に更新する
// detail は失敗時の補足だけに使うので、成功時の表示は簡潔に保つ
const check = (label, condition, detail = "") => {
  if (condition) {
    passCount += 1;
    log(`PASS ${label}`);
  } else {
    failCount += 1;
    log(`FAIL ${label}${detail ? `: ${detail}` : ""}`);
  }
};

// 手動確認フェーズで marker を左右に動かすための安全な丸め処理
// 0 から 100 の範囲に収めることで、表示位置の計算を単純に保つ
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// 手動確認用の見た目をこの test 専用に追加する
// 既存のページに影響を広げすぎないよう、必要な CSS だけを足す
const injectManualStyle = () => {
  if (document.getElementById("input-controller-style")) return;
  const style = document.createElement("style");
  style.id = "input-controller-style";
  style.textContent = `
    body {
      padding-bottom: 180px;
    }
    .input-controller-manual {
      margin-top: 20px;
      display: grid;
      gap: 14px;
    }
    .input-controller-card {
      background: rgba(18, 28, 18, 0.86);
      border: 1px solid rgba(148, 186, 233, 0.22);
      border-radius: 16px;
      padding: 16px 18px;
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.18);
    }
    .input-controller-title {
      font-size: 18px;
      font-weight: 700;
      margin-bottom: 10px;
      color: #eaf3ff;
    }
    .input-controller-note {
      margin: 0 0 12px;
      color: #aebed0;
      line-height: 1.6;
      font-size: 14px;
    }
    .input-controller-track {
      position: relative;
      height: 88px;
      border-radius: 18px;
      border: 1px solid rgba(188, 210, 236, 0.22);
      background:
        linear-gradient(180deg, rgba(46, 60, 82, 0.9), rgba(18, 27, 42, 0.94)),
        radial-gradient(circle at 50% 50%, rgba(108, 176, 255, 0.16), transparent 55%);
      overflow: hidden;
    }
    .input-controller-track::before {
      content: "";
      position: absolute;
      left: 18px;
      right: 18px;
      top: 50%;
      height: 2px;
      background: linear-gradient(90deg, transparent, rgba(172, 209, 255, 0.7), transparent);
      transform: translateY(-50%);
    }
    .input-controller-marker {
      position: absolute;
      top: 50%;
      left: 50%;
      width: 48px;
      height: 48px;
      border-radius: 999px;
      transform: translate(-50%, -50%);
      background: radial-gradient(circle at 35% 30%, #c7f3ff, #4aa6ff 60%, #2256a8 100%);
      box-shadow: 0 0 0 1px rgba(236, 247, 255, 0.4), 0 10px 24px rgba(20, 58, 115, 0.48);
      transition: transform 120ms ease, background 120ms ease, box-shadow 120ms ease;
    }
    .input-controller-marker.flash {
      background: radial-gradient(circle at 35% 30%, #fff0c6, #ff9d2f 58%, #bc4d0c 100%);
      box-shadow: 0 0 0 1px rgba(255, 251, 236, 0.55), 0 12px 28px rgba(255, 153, 46, 0.46);
    }
    .input-controller-rows {
      display: grid;
      gap: 10px;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    }
    .input-controller-panel {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(188, 210, 236, 0.14);
      border-radius: 12px;
      padding: 12px 14px;
      line-height: 1.55;
      white-space: pre-wrap;
      min-height: 150px;
      color: #edf4ff;
    }
    .input-controller-mini {
      color: #c6d6ea;
      font-size: 13px;
      line-height: 1.5;
    }
  `;
  document.head.appendChild(style);
};

// 自動テストのあとに表示する手動確認 UI を作る
// keyboard と touch の操作結果が、同じ画面上で読める構成にしている
const createManualUi = () => {
  injectManualStyle();
  const root = document.createElement("section");
  root.className = "input-controller-manual";
  root.innerHTML = `
    <div class="input-controller-card">
      <div class="input-controller-title">manual input test</div>
      <p class="input-controller-note">
        自動テストの次に、ここで keyboard と touch ボタンを実際に操作する。
        ArrowLeft / A と touch の ← は同じ left action、ArrowRight / D と touch の → は同じ right action、
        Space / Enter と Fire ボタンは同じ fire action、R と Reset ボタンは同じ reset action になる。
      </p>
      <div class="input-controller-track">
        <div class="input-controller-marker" data-role="marker"></div>
      </div>
      <div class="input-controller-mini" data-role="summary"></div>
    </div>
    <div class="input-controller-rows">
      <pre class="input-controller-panel" data-role="live"></pre>
      <pre class="input-controller-panel" data-role="help"></pre>
    </div>
  `;
  document.body.appendChild(root);
  return {
    root,
    markerEl: root.querySelector('[data-role="marker"]'),
    summaryEl: root.querySelector('[data-role="summary"]'),
    liveEl: root.querySelector('[data-role="live"]'),
    helpEl: root.querySelector('[data-role="help"]')
  };
};

// まずは InputController の基礎動作を、自動でまとめて確認する
// ここでは実際のキー入力を synthetic event で再現して、状態遷移を検証する
const autoInput = new InputController(document);

check("normalize space key", autoInput.normalizeKey(" ") === "space");
check("normalize esc key", autoInput.normalizeKey("Esc") === "escape");
check("normalize trimmed key", autoInput.normalizeKey("  A  ") === "a");

autoInput.registerActionMap({
  launch: ["Enter", "Space"],
  move_left: ["ArrowLeft", "A"]
});

check(
  "registerActionMap keeps normalized bindings",
  JSON.stringify(autoInput.getActionMap().launch) === JSON.stringify(["enter", "space"]),
  JSON.stringify(autoInput.getActionMap().launch)
);

autoInput.attach();

// KeyboardEvent を document に投げて、実機の入力経路と同じ扱いになるかを見る
// keydown / keyup を直接発生させることで、action state の変化を確認しやすくする
const dispatchKey = (type, key) => {
  const event = new KeyboardEvent(type, {
    key,
    bubbles: true,
    cancelable: true
  });
  document.dispatchEvent(event);
  return event;
};

// pointerdown の既定抑止は、target element の有無で範囲が変わる
// KeyboardEvent と同様に synthetic event を投げて、
// text selection を妨げる範囲だけを狙って制御できるかを見る
const dispatchPointer = (target) => {
  const event = new Event("pointerdown", {
    bubbles: true,
    cancelable: true
  });
  target.dispatchEvent(event);
  return event;
};

const down = dispatchKey("keydown", "Space");
check("keydown default is prevented", down.defaultPrevented === true);
check("physical key reaches action state", autoInput.getAction("launch") === true);
check("physical key raises press edge", autoInput.wasActionPressed("launch") === true);

autoInput.beginFrame();
check("pressed edge clears on next frame", autoInput.wasActionPressed("launch") === false);
check("held action survives next frame", autoInput.getAction("launch") === true);

const up = dispatchKey("keyup", "Space");
check("keyup default is prevented", up.defaultPrevented === true);
check("physical key release clears action state", autoInput.getAction("launch") === false);
check("physical key raises release edge", autoInput.wasActionReleased("launch") === true);

autoInput.beginFrame();
check("release edge clears on next frame", autoInput.wasActionReleased("launch") === false);

// pulseAction は touch ボタンや menu の 1 回押しを表すための補助 API
// その frame だけ見えて、次の frame では消えることを確認する
autoInput.pulseAction("launch");
check("pulseAction is visible immediately", autoInput.getAction("launch") === true);
check("pulseAction raises press edge", autoInput.wasActionPressed("launch") === true);

// record / replay 用の snapshot は、raw key と action edge の両方を残しておく
// ここでは別 controller へ state を戻して、同じ frame を再現できるか確認する
autoInput.press("A");
const recordedFrame = autoInput.captureFrameState({
  frame: 12,
  timeMs: 3456,
  elapsedSec: 1.5,
  label: "input-controller-record",
  source: "unittest/input_controller"
});
check("captureFrameState stores frame number", recordedFrame.frame === 12, JSON.stringify(recordedFrame));
check("captureFrameState stores held keys", JSON.stringify(recordedFrame.keys) === JSON.stringify(["a"]), JSON.stringify(recordedFrame.keys));
check("captureFrameState stores action edges", recordedFrame.actions.launch?.pressed === true && recordedFrame.actions.launch?.pulse === true, JSON.stringify(recordedFrame.actions.launch));
check("captureFrameState stores held action", recordedFrame.actions.move_left?.active === true, JSON.stringify(recordedFrame.actions.move_left));
const replayInput = new InputController(document);
replayInput.registerActionMap({
  launch: ["Enter", "Space"],
  move_left: ["ArrowLeft", "A"]
});
const replayedFrame = replayInput.applyFrameState(recordedFrame);
check("applyFrameState restores held key", replayInput.has("a") === true, JSON.stringify([...replayInput.keyState]));
check("applyFrameState restores action state", replayInput.getAction("move_left") === true, JSON.stringify(replayedFrame?.actions?.move_left));
check("applyFrameState restores press edge", replayInput.wasActionPressed("launch") === true, JSON.stringify(replayedFrame?.actions?.launch));
check("applyFrameState restores pulse edge", replayInput.getAction("launch") === true, JSON.stringify(replayedFrame?.actions?.launch));
const freshReplay = new InputController(document);
const freshRestoredFrame = freshReplay.applyFrameState(recordedFrame);
check("applyFrameState restores action map on empty controller", freshReplay.getAction("move_left") === true, JSON.stringify(freshRestoredFrame?.actions?.move_left));

autoInput.beginFrame();
check("pulseAction clears on next frame", autoInput.getAction("launch") === false);
check("pulseAction press edge clears on next frame", autoInput.wasActionPressed("launch") === false);
autoInput.detach();

// pointerdown 既定抑止の適用範囲を確認する
// target 未指定では従来どおり全文書を抑止し、
// target 指定時はその element 内だけに範囲を絞れるようにする
const defaultPointerInput = new InputController(document);
let defaultPointerCount = 0;
defaultPointerInput.attach({
  onPointerDown: () => {
    defaultPointerCount += 1;
  }
});
const defaultPointerEvent = dispatchPointer(document.body);
check("pointerdown default is prevented without target", defaultPointerEvent.defaultPrevented === true);
check("pointerdown callback fires without target", defaultPointerCount === 1);
defaultPointerInput.detach();

const pointerTarget = document.createElement("div");
const pointerOutside = document.createElement("div");
document.body.appendChild(pointerTarget);
document.body.appendChild(pointerOutside);

const targetedPointerInput = new InputController(document);
targetedPointerInput.setPointerPreventDefaultElement(pointerTarget);
let targetedPointerCount = 0;
targetedPointerInput.attach({
  onPointerDown: () => {
    targetedPointerCount += 1;
  }
});
const outsidePointerEvent = dispatchPointer(pointerOutside);
const insidePointerEvent = dispatchPointer(pointerTarget);
check("pointerdown outside target is not prevented", outsidePointerEvent.defaultPrevented === false);
check("pointerdown inside target is prevented", insidePointerEvent.defaultPrevented === true);
check("pointerdown callback still fires for both targets", targetedPointerCount === 2);
targetedPointerInput.detach();
pointerTarget.remove();
pointerOutside.remove();

// touch の action button も keyboard と同じ normalizeKey 規約へそろえる
// callback には正規化済み key を渡し、必要なら rawKey で元の値も参照できるようにする
const touchInput = new InputController(document);
const originalTouchCreate = Touch.prototype.create;
const originalTouchDestroy = Touch.prototype.destroy;
let touchActionInfo = null;
try {
  Touch.prototype.create = function (options = {}) {
    options.onAction?.({ key: " ", label: "EX" });
    return document.createElement("div");
  };
  Touch.prototype.destroy = function () {};
  touchInput.installTouchControls({
    touchDeviceOnly: false,
    onAction: (info) => {
      touchActionInfo = info;
    }
  });
  check(
    "touch action key is normalized",
    touchActionInfo?.key === "space",
    JSON.stringify(touchActionInfo)
  );
  check(
    "touch action keeps raw key",
    touchActionInfo?.rawKey === " ",
    JSON.stringify(touchActionInfo)
  );
  check(
    "touch pulse uses normalized key name",
    touchInput.getAction("space") === true
  );
} finally {
  Touch.prototype.create = originalTouchCreate;
  Touch.prototype.destroy = originalTouchDestroy;
}

// 自動テストの結果を先に画面へ出して、合否の概要を最初に見えるようにする
if (statusEl) {
  statusEl.textContent = [
    "input_controller unittest",
    `auto pass=${passCount} fail=${failCount}`,
    ...lines
  ].join("\n");
}

// ここから先は、人が実際に keyboard と touch を触って確かめる手動フェーズ
// 1 つの InputController を使い回し、同じ action 名へ両方の入力を集約する
const manual = createManualUi();
manual.summaryEl.textContent = "waiting for keyboard or touch input";
const manualInput = autoInput;
manualInput.clear();
manualInput.registerActionMap({
  left: ["ArrowLeft", "A", "left"],
  right: ["ArrowRight", "D", "right"],
  fire: ["Space", "Enter"],
  reset: ["R"]
});
manualInput.attach({
  // 生の keyboard イベントが届いたことを、そのまま画面へ残す
  // ここでの表示は action state とは別に、入力経路そのものの確認に使う
  onKeyDown: (key) => {
    manualState.lastSource = "keyboard";
    manualState.lastEvent = `keydown ${key}`;
    manual.summaryEl.textContent = `keyboard keydown: ${key}`;
  },
  // keyup も同様に記録して、押しっぱなしと離した瞬間を区別しやすくする
  onKeyUp: (key) => {
    manualState.lastSource = "keyboard";
    manualState.lastEvent = `keyup ${key}`;
    manual.summaryEl.textContent = `keyboard keyup: ${key}`;
  }
});

// touch ボタンは action 名そのものを key に使う
// こうすると keyboard と touch が、同じ action map を共有できる
const touchRoot = manualInput.installTouchControls({
  touchDeviceOnly: false,
  className: "webg-touch-root input-controller-touch",
  groups: [
    {
      id: "move",
      buttons: [
        { key: "left", label: "←", kind: "hold", ariaLabel: "move left" },
        { key: "right", label: "→", kind: "hold", ariaLabel: "move right" }
      ]
    },
    {
      id: "action",
      buttons: [
        { key: "fire", label: "Fire", kind: "action", ariaLabel: "fire action" },
        { key: "reset", label: "Reset", kind: "action", ariaLabel: "reset position" }
      ]
    }
  ],
  // ボタンを押した瞬間の情報を、そのまま画面に出す
  // hold と action の違いが見えるので、入力種別の確認に向いている
  onAnyPress: (info) => {
    manualState.lastSource = "touch";
    manualState.lastEvent = `${info.kind} ${info.key}`;
    manual.summaryEl.textContent = `touch press: ${info.key} (${info.kind})`;
  },
  // action ボタンは 1 回だけの入力として扱うので、menu 系の確認に向いている
  onAction: (info) => {
    manualState.lastSource = "touch";
    manualState.lastEvent = `action ${info.key}`;
    manual.summaryEl.textContent = `touch action: ${info.key}`;
  }
});
if (touchRoot) {
  // PC 画面でも試しやすいように、touch UI を下側に寄せて見やすくする
  touchRoot.style.justifyContent = "flex-end";
  touchRoot.style.alignItems = "flex-end";
  touchRoot.style.paddingLeft = "16px";
  touchRoot.style.paddingRight = "16px";
  touchRoot.style.paddingBottom = "18px";
  touchRoot.style.setProperty("--webg-touch-btn-font-size", "24px");
  const touchButtons = touchRoot.querySelectorAll(".webg-touch-btn");
  for (let i = 0; i < touchButtons.length; i++) {
    const btn = touchButtons[i];
    btn.style.width = "64px";
    btn.style.height = "64px";
  }
}

// 手動フェーズで何を試すかを、短い文章で画面に残す
// 読み手がコード名を見なくても、何を押せばどう動くか分かるようにする
manual.helpEl.textContent = [
  "manual test",
  "use ArrowLeft / A or touch ← to move left",
  "use ArrowRight / D or touch → to move right",
  "use Space / Enter or touch Fire to flash",
  "use R or touch Reset to return to center",
  "touch buttons are visible at the bottom of the page"
].join("\n");

// 手動フェーズで使う状態は、このオブジェクトにまとめて保持する
// x は左右位置、fire/reset は回数、flashSec は短い視覚反応の残り時間
const manualState = {
  x: 50.0,
  fireCount: 0,
  resetCount: 0,
  flashSec: 0.0,
  lastSource: "none",
  lastEvent: "none"
};

// 画面更新と入力確認を毎 frame 進める
// action の hold と edge を分けて読み、結果を marker と文字列に反映する
let lastMs = performance.now();
const updateManual = () => {
  const now = performance.now();
  const dt = clamp((now - lastMs) / 1000.0, 0.0, 0.033);
  lastMs = now;

  // 左右の hold action を読んで、押している間だけ marker を動かす
  let motion = 0.0;
  if (manualInput.getAction("left")) motion -= 1.0;
  if (manualInput.getAction("right")) motion += 1.0;
  manualState.x = clamp(manualState.x + motion * 70.0 * dt, 0.0, 100.0);

  // fire と reset は、押した瞬間だけ反応する action として扱う
  if (manualInput.wasActionPressed("fire")) {
    manualState.fireCount += 1;
    manualState.flashSec = 0.25;
    manualState.lastEvent = "fire";
  }
  if (manualInput.wasActionPressed("reset")) {
    manualState.resetCount += 1;
    manualState.x = 50.0;
    manualState.flashSec = 0.35;
    manualState.lastEvent = "reset";
  }

  // 離した瞬間の edge も記録して、入力の切り替わりを読みやすくする
  if (manualInput.wasActionReleased("left")) {
    manualState.lastEvent = "left released";
  }
  if (manualInput.wasActionReleased("right")) {
    manualState.lastEvent = "right released";
  }

  // flashSec を減らして、入力に対する短い視覚反応だけを残す
  if (manualState.flashSec > 0.0) {
    manualState.flashSec = Math.max(0.0, manualState.flashSec - dt);
  }

  // marker の位置と色を更新して、入力が画面にどう出るかを即座に返す
  if (manual.markerEl) {
    manual.markerEl.style.left = `${manualState.x}%`;
    manual.markerEl.classList.toggle("flash", manualState.flashSec > 0.0);
    const scale = manualState.flashSec > 0.0 ? 1.08 : 1.0;
    manual.markerEl.style.transform = `translate(-50%, -50%) scale(${scale})`;
  }

  // action state と raw keyboard state を並べて表示し、
  // どの層で入力が止まっているかをすぐ切り分けられるようにする
  if (manual.liveEl) {
    manual.liveEl.textContent = [
      `state: x=${manualState.x.toFixed(1)}  fire=${manualState.fireCount}  reset=${manualState.resetCount}`,
      `action: left=${manualInput.getAction("left") ? 1 : 0}  right=${manualInput.getAction("right") ? 1 : 0}  fire=${manualInput.getAction("fire") ? 1 : 0}  reset=${manualInput.getAction("reset") ? 1 : 0}`,
      `edge: fire=${manualInput.wasActionPressed("fire") ? 1 : 0}  reset=${manualInput.wasActionPressed("reset") ? 1 : 0}`,
      `keyboard: arrowleft=${manualInput.has("arrowleft") ? 1 : 0}  a=${manualInput.has("a") ? 1 : 0}  arrowright=${manualInput.has("arrowright") ? 1 : 0}  d=${manualInput.has("d") ? 1 : 0}  space=${manualInput.has("space") ? 1 : 0}`,
      `last: ${manualState.lastSource} / ${manualState.lastEvent}`
    ].join("\n");
  }

  // この frame の入力を使い切ったあとに edge をクリアする
  // 次の frame では新しく起きた press / release だけが見える
  manualInput.beginFrame();
  requestAnimationFrame(updateManual);
};

// 手動フェーズの更新ループを開始する
// 自動テストが終わったあと、すぐに keyboard / touch を試せるようにする
requestAnimationFrame(updateManual);
