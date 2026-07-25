// ---------------------------------------------
// samples/compute_json/main.js  2026/07/25
//   JSON animation viewer with ComputeEffectPipeline
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import WebgApp from "../../webg/WebgApp.js";
import { buildErrorPanelOptions, buildHelpPanelOptions } from "../../webg/OverlayPanelPresets.js";
import SmoothShader from "../../webg/SmoothShader.js";
import Diagnostics from "../../webg/Diagnostics.js";
import FullscreenPass from "../../webg/FullscreenPass.js";
import ComputeEffectPipeline from "../../webg/ComputeEffectPipeline.js";
import {
  COMPUTE_EDGE_BLEND_MODES
} from "../../webg/ComputeEdgePass.js";

//const MODEL_ASSET_FILE = "./AAOP42_0003_webg.json.gz";
const MODEL_ASSET_FILE = "./modelasset.json";
const DOWNLOAD_FILE = "compute_json_modelasset_copy.json";
const DEBUG_MODE = "release";
const DEFAULT_ORBIT = {
  yaw: 20.0,
  pitch: -14.0,
  distance: 10.0,
  target: [0.0, 0.0, 0.0]
};
const ORBIT_ROLL_BUTTON_STEP = 7.5;
const UNRESTRICTED_ORBIT_PITCH_DEGREES = 1000000.0;
const GUIDE_LINES = [
  "compute_json: JSON animation + ComputeEffectPipeline",
  "Drag: orbit  Shift+Drag: pan",
  "Arrow: orbit  Shift+Arrow: pan",
  "[ / ] or wheel: zoom",
  "Touch double tap: open command palette",
  "[A] SSAO  [S] Shadow  [R] SSR  [T] Toon",
  "[D] DoF  [B] Bloom  [E] Edge  [L] Lighting",
  "Two-finger twist: inverted view roll",
  "[O]/[P] Roll  [Y] Roll Reset",
  "[5]/[6] Toon Levels  [7]/[8] Edge Thickness  [M] Edge Blend",
  "[space] pause  [1] replay  [2]/[3] pause/resume clip",
  "[4]/[9] prev/next clip  [W] wire  [K] shot  [J] JSON  [0] reset"
];
const COMMAND_PALETTE_ID = "compute-json-command-palette";
const COMMAND_PALETTE_PAGE_SIZE = 12;
const COMMAND_PALETTE_BUTTONS = [
  { key: "a", label: "A", detail: "SSAO" },
  { key: "s", label: "S", detail: "Shadow" },
  { key: "r", label: "R", detail: "SSR" },
  { key: "t", label: "T", detail: "Toon" },
  { key: "d", label: "D", detail: "DoF" },
  { key: "b", label: "B", detail: "Bloom" },
  { key: "e", label: "E", detail: "Edge" },
  { key: "l", label: "L", detail: "Light" },
  { key: "o", label: "O", detail: "Roll -" },
  { key: "p", label: "P", detail: "Roll +" },
  { key: "y", label: "Y", detail: "Roll 0" },
  { key: "5", label: "5", detail: "Toon -" },
  { key: "6", label: "6", detail: "Toon +" },
  { key: "7", label: "7", detail: "Edge -" },
  { key: "8", label: "8", detail: "Edge +" },
  { key: "m", label: "M", detail: "Blend" },
  { key: "space", label: "P", detail: "Pause" },
  { key: "1", label: "1", detail: "Replay" },
  { key: "2", label: "2", detail: "Clip Pa" },
  { key: "3", label: "3", detail: "Clip Re" },
  { key: "4", label: "4", detail: "Prev" },
  { key: "9", label: "9", detail: "Next" },
  { key: "w", label: "W", detail: "Wire" },
  { key: "j", label: "J", detail: "JSON" },
  { key: "k", label: "K", detail: "Shot" },
  { key: "0", label: "0", detail: "Reset" }
];

let app = null;
let orbit = null;
let model = null;
let modelAsset = null;
let runtime = null;
let pipeline = null;
let copyPass = null;
let lastHelpText = "";
let lastHelpUpdateMs = 0;
let totalTriangles = 0;
let clipNames = [];
let clipInfo = null;
let clipBound = false;
let selectedClipIndex = 0;
let orbitLift = 0.0;
let orbitLiftStep = 0.5;
let viewerSize = {
  centerx: 0.0,
  centery: 0.0,
  centerz: 0.0,
  max: 10.0
};
let screenshotName = "";
let wireframe = false;
let commandPalette = null;
let orbitRollGesture = null;

const effectState = {
  ssaoEnabled: false,
  shadowEnabled: false,
  ssrEnabled: false,
  toonEnabled: true,
  toonLevels: 4,
  dofEnabled: false,
  bloomEnabled: false,
  edgeEnabled: true,
  edgeThickness: 2,
  edgeBlendMode: "black-multiply",
  ambientOnly: false,
  paused: false
};
// `nextEdgeBlendMode`は現在状態から対象を選択し、結果を返すまたは選択を切り替える
function nextEdgeBlendMode(current) {
  const index = COMPUTE_EDGE_BLEND_MODES.indexOf(current);
  return COMPUTE_EDGE_BLEND_MODES[(index + 1) % COMPUTE_EDGE_BLEND_MODES.length];
}

// command palette の総ページ数を返す
// button 数が増減しても page 数をここで一元計算し、render 側の分岐を単純に保つ
function getCommandPalettePageCount() {
  return Math.max(1, Math.ceil(COMMAND_PALETTE_BUTTONS.length / COMMAND_PALETTE_PAGE_SIZE));
}

// 現在 page に表示する command 定義を返す
// 固定長 grid の空 slot は null を返し、DOM 側で非表示 button として扱う
function getCommandPalettePageButtons(pageIndex = 0) {
  const safePage = Math.max(0, Math.min(getCommandPalettePageCount() - 1, pageIndex));
  const start = safePage * COMMAND_PALETTE_PAGE_SIZE;
  const items = COMMAND_PALETTE_BUTTONS.slice(start, start + COMMAND_PALETTE_PAGE_SIZE);
  while (items.length < COMMAND_PALETTE_PAGE_SIZE) {
    items.push(null);
  }
  return items;
}

// command palette button の active 表示可否を返す
// toggle 状態や現在値を UI に反映し、double tap 後に今どの effect が有効かを追いやすくする
function isCommandPaletteButtonActive(key) {
  if (key === "a") return effectState.ssaoEnabled;
  if (key === "s") return effectState.shadowEnabled;
  if (key === "r") return effectState.ssrEnabled;
  if (key === "t") return effectState.toonEnabled;
  if (key === "d") return effectState.dofEnabled;
  if (key === "b") return effectState.bloomEnabled;
  if (key === "e") return effectState.edgeEnabled;
  if (key === "l") return effectState.ambientOnly;
  if (key === "w") return wireframe;
  if (key === "space") return effectState.paused;
  return false;
}

// command palette の表示中心を、double tap 位置を覆いすぎない場所へずらして決める
// mmodeler と同じ考え方で tap 位置の斜め外側を優先し、収まらないときだけ画面内へ clamp する
function chooseCommandPaletteCenter(rect, localX, localY, halfWidth, halfHeight) {
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

  for (let i = 0; i < candidates.length; i++) {
    const [sx, sy] = candidates[i];
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

// command palette を閉じる
// button 実行後や canvas tap 後に共通で呼べるよう、DOM class と opened 状態を 1 箇所で同期する
function closeCommandPalette() {
  if (!commandPalette?.root) {
    return;
  }
  commandPalette.opened = false;
  commandPalette.root.classList.remove("open");
}

// command palette の button 表示内容を更新する
// page 切替、active 表示、空 slot の非表示をまとめて反映し、状態変更直後でも表示が古くならないようにする
function renderCommandPalette() {
  if (!commandPalette?.root || !Array.isArray(commandPalette.buttons)) {
    return;
  }
  const pageButtons = getCommandPalettePageButtons(commandPalette.page);
  for (let i = 0; i < commandPalette.buttons.length; i++) {
    const element = commandPalette.buttons[i];
    const command = pageButtons[i];
    const label = command?.label ?? "";
    const detail = command?.detail ?? "";
    const key = command?.key ?? "";
    element.dataset.key = key;
    element.disabled = !key;
    element.style.visibility = key ? "visible" : "hidden";
    element.classList.toggle("active", key ? isCommandPaletteButtonActive(key) : false);
    element.innerHTML = key ? `${label}<small>${detail}</small>` : "";
  }
  if (commandPalette.pageButton) {
    const pageCount = getCommandPalettePageCount();
    commandPalette.pageButton.textContent = pageCount > 1
      ? `Next ${commandPalette.page + 1}/${pageCount}`
      : "Close";
  }
}

// command palette を次の page へ進める
// 最後の page の次は 1 枚目へ戻し、少ない操作で全 command に辿れるようにする
function nextCommandPalettePage() {
  const pageCount = getCommandPalettePageCount();
  commandPalette.page = (commandPalette.page + 1) % pageCount;
  renderCommandPalette();
}

// command palette を指定位置に開く
// double tap 座標から panel 位置を決め、開いた直後に最新の toggle 状態を反映する
function openCommandPalette(clientX, clientY) {
  if (!commandPalette?.root) {
    return;
  }
  const canvas = app?.screen?.canvas ?? document.getElementById("canvas");
  const rect = canvas?.getBoundingClientRect?.();
  if (rect) {
    const hostRect = commandPalette.root.parentElement?.getBoundingClientRect?.() ?? {
      left: 0.0,
      top: 0.0
    };
    const halfWidth = 138.0;
    const halfHeight = 118.0;
    const localX = Number(clientX) - rect.left;
    const localY = Number(clientY) - rect.top;
    const center = chooseCommandPaletteCenter(rect, localX, localY, halfWidth, halfHeight);
    commandPalette.root.style.left = `${rect.left - hostRect.left + center.x}px`;
    commandPalette.root.style.top = `${rect.top - hostRect.top + center.y}px`;
  }
  commandPalette.page = 0;
  commandPalette.opened = true;
  renderCommandPalette();
  commandPalette.root.classList.add("open");
}

// compute_json 用の command palette DOM を組み立てる
// sample 内だけで完結する軽量 UI とし、mmodeler と同じく double tap で開く操作感を持たせる
function createCommandPalette() {
  const canvasHost = app.getCanvasHost?.() ?? document.body;
  const root = document.createElement("div");
  root.id = COMMAND_PALETTE_ID;
  root.className = "compute-json-command-palette";
  root.setAttribute("aria-label", "compute_json command palette");

  const title = document.createElement("div");
  title.className = "compute-json-command-palette-title";
  title.textContent = "Double Tap Commands";
  root.appendChild(title);

  const grid = document.createElement("div");
  grid.className = "compute-json-command-palette-grid";
  root.appendChild(grid);

  const buttons = [];
  for (let i = 0; i < COMMAND_PALETTE_PAGE_SIZE; i++) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "compute-json-command-button";
    button.addEventListener("click", () => {
      const key = button.dataset.key ?? "";
      if (!key) {
        return;
      }
      applyAction(key);
      renderCommandPalette();
      closeCommandPalette();
    });
    grid.appendChild(button);
    buttons.push(button);
  }

  const footer = document.createElement("div");
  footer.className = "compute-json-command-palette-footer";

  const pageButton = document.createElement("button");
  pageButton.type = "button";
  pageButton.className = "compute-json-command-footer-button";
  pageButton.addEventListener("click", () => {
    if (getCommandPalettePageCount() <= 1) {
      closeCommandPalette();
      return;
    }
    nextCommandPalettePage();
  });
  footer.appendChild(pageButton);

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "compute-json-command-footer-button";
  closeButton.textContent = "Close";
  closeButton.addEventListener("click", () => {
    closeCommandPalette();
  });
  footer.appendChild(closeButton);

  root.appendChild(footer);
  root.addEventListener("pointerdown", (ev) => {
    ev.stopPropagation();
  });
  canvasHost.appendChild(root);
  commandPalette = {
    root,
    buttons,
    pageButton,
    page: 0,
    opened: false
  };
  renderCommandPalette();
}

// scene 上の double tap で command palette を開閉できるようにする
// palette が開いている間に canvas を単 tap した場合は palette を閉じ、視点操作へ戻りやすくする
function installCommandPaletteGesture() {
  const canvas = app?.screen?.canvas ?? document.getElementById("canvas");
  if (!canvas) {
    return;
  }

  const state = {
    active: false,
    pointerId: null,
    startX: 0.0,
    startY: 0.0,
    lastTapTime: 0.0,
    lastTapX: 0.0,
    lastTapY: 0.0,
    lastTapPointerType: "",
    lastPointerDoubleTime: 0.0
  };
  const tapMoveTolerance = 12.0;
  const doubleTapTime = 320.0;
  const doubleTapDistance = 24.0;

  // コマンドの操作パレットの有効状態を切り替え、表示と処理へ反映する
  const toggleCommandPalette = (x, y) => {
    if (commandPalette?.opened) {
      closeCommandPalette();
    } else {
      openCommandPalette(x, y);
    }
  };

  canvas.addEventListener("pointerdown", (ev) => {
    state.active = true;
    state.pointerId = ev.pointerId;
    state.startX = ev.clientX;
    state.startY = ev.clientY;
    canvas.setPointerCapture?.(ev.pointerId);
  });

  canvas.addEventListener("pointerup", (ev) => {
    if (!state.active || ev.pointerId !== state.pointerId) {
      return;
    }
    state.active = false;
    if (canvas.hasPointerCapture?.(ev.pointerId)) {
      canvas.releasePointerCapture(ev.pointerId);
    }
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const x = Number(ev.clientX);
    const y = Number(ev.clientY);
    const pointerType = String(ev.pointerType ?? "");
    const distance = Math.hypot(x - state.startX, y - state.startY);
    if (distance > tapMoveTolerance) {
      return;
    }

    const isSamePointer = !state.lastTapPointerType || state.lastTapPointerType === pointerType;
    const isDoubleTap = isSamePointer
      && state.lastTapTime > 0.0
      && now - state.lastTapTime <= doubleTapTime
      && Math.hypot(x - state.lastTapX, y - state.lastTapY) <= doubleTapDistance;
    if (isDoubleTap) {
      state.lastTapTime = 0.0;
      state.lastPointerDoubleTime = now;
      toggleCommandPalette(x, y);
      ev.preventDefault?.();
      return;
    }

    state.lastTapTime = now;
    state.lastTapX = x;
    state.lastTapY = y;
    state.lastTapPointerType = pointerType;
    if (commandPalette?.opened) {
      closeCommandPalette();
    }
  });

  canvas.addEventListener("pointercancel", (ev) => {
    if (state.active && ev.pointerId === state.pointerId) {
      state.active = false;
    }
  });

  canvas.addEventListener("dblclick", (ev) => {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (now - state.lastPointerDoubleTime <= 80.0) {
      return;
    }
    state.lastPointerDoubleTime = now;
    toggleCommandPalette(ev.clientX, ev.clientY);
    ev.preventDefault?.();
  });
}

// mmodeler と同じく2本のpointerを登録順に取り出し、画面上の線分角度をroll入力として読む
// pointer座標はcanvas localへ変換せず、両点の差だけを使うためclient座標のまま扱える
function getOrbitRollGesturePointers(state) {
  return Array.from(state.pointers.values()).slice(0, 2);
}

// 2本指を結ぶ線分の画面角度と距離を返し、重なったpointerをroll開始条件から除外できるようにする
// atan2の正方向はmmodelerの検出規則をそのまま維持し、符号反転は適用直前の1箇所だけで行う
function getOrbitRollGestureMetrics(pointers) {
  if (!Array.isArray(pointers) || pointers.length < 2) {
    return null;
  }
  const a = pointers[0];
  const b = pointers[1];
  return {
    angle: Math.atan2(b.y - a.y, b.x - a.x) * 180.0 / Math.PI,
    distance: Math.hypot(b.x - a.x, b.y - a.y)
  };
}

// atan2が+180度と-180度をまたいでも1frameの入力差が急反転しないよう符号付き角度へ正規化する
// 不正値を0へ置き換えるとgesture破損を隠すため、呼び出し側で有限値を確認してから使用する
function normalizeOrbitRollDelta(delta) {
  let value = Number(delta);
  if (!Number.isFinite(value)) {
    throw new Error("compute_json orbit roll delta must be finite");
  }
  while (value > 180.0) value -= 360.0;
  while (value < -180.0) value += 360.0;
  return value;
}

// UIが検出した角度差だけを反転し、mmodelerと同じview forward軸回りの回転APIへ渡す
// yaw/pitch/target/distanceの処理は変更せず、入力deltaから適用deltaへの変換をこの関数へ限定する
function applyInvertedOrbitRollInput(detectedDelta = 0.0) {
  if (!orbit?.orbit) {
    return false;
  }
  const normalizedDelta = normalizeOrbitRollDelta(detectedDelta);
  if (Math.abs(normalizedDelta) <= 1.0e-9) {
    return false;
  }
  orbit.rotateOrbitByViewRoll(-normalizedDelta);
  orbit.apply(true);
  app.syncCameraFromEyeRig(orbit);
  return true;
}

// 2本目のtouch開始時点を基準角として保存し、mmodelerと同じ差分更新を開始する
// EyeRigのpinch/panも同じpointerを読むためeventは奪わず、roll角度だけを並行して蓄積する
function beginOrbitRollGesture(state) {
  const pointers = getOrbitRollGesturePointers(state);
  const metrics = getOrbitRollGestureMetrics(pointers);
  if (pointers.length < 2 || !orbit?.orbit || !metrics || metrics.distance <= 0.0) {
    return false;
  }
  state.active = true;
  state.startAngle = metrics.angle;
  return true;
}

// 直前の2本指角度から現在角度までをUI検出量とし、その符号だけを反転してview rollへ適用する
// 毎回startAngleを更新することで長時間操作でも±180度境界を1frame差分として正しく処理する
function updateOrbitRollGesture(state) {
  if (!state.active || !orbit?.orbit) {
    return;
  }
  const metrics = getOrbitRollGestureMetrics(getOrbitRollGesturePointers(state));
  if (!metrics) {
    return;
  }
  const detectedDelta = normalizeOrbitRollDelta(metrics.angle - state.startAngle);
  applyInvertedOrbitRollInput(detectedDelta);
  state.startAngle = metrics.angle;
}

// touch pointerの追加・移動・終了を追跡し、2本ある期間だけroll gestureを有効にする
// pointerTypeをtouchへ限定するため、PCのmouse dragによる通常orbit操作には干渉しない
function installInvertedOrbitRollGesture() {
  const canvas = app?.screen?.canvas;
  if (!canvas) {
    throw new Error("compute_json orbit roll gesture requires a canvas");
  }
  const state = {
    pointers: new Map(),
    active: false,
    startAngle: 0.0
  };
  orbitRollGesture = state;

  canvas.addEventListener("pointerdown", (ev) => {
    if (String(ev.pointerType ?? "") !== "touch") return;
    state.pointers.set(ev.pointerId, {
      x: Number(ev.clientX),
      y: Number(ev.clientY)
    });
    if (state.pointers.size === 2) beginOrbitRollGesture(state);
  }, true);

  canvas.addEventListener("pointermove", (ev) => {
    if (String(ev.pointerType ?? "") !== "touch" || !state.pointers.has(ev.pointerId)) return;
    state.pointers.set(ev.pointerId, {
      x: Number(ev.clientX),
      y: Number(ev.clientY)
    });
    if (state.active) {
      updateOrbitRollGesture(state);
    } else if (state.pointers.size >= 2) {
      beginOrbitRollGesture(state);
    }
  }, true);

  // `finishPointer`は処理周期の開始または終了に必要な状態を更新する
  const finishPointer = (ev) => {
    if (String(ev.pointerType ?? "") !== "touch" || !state.pointers.has(ev.pointerId)) return;
    state.pointers.delete(ev.pointerId);
    if (state.pointers.size < 2) state.active = false;
  };
  canvas.addEventListener("pointerup", finishPointer, true);
  canvas.addEventListener("pointercancel", finishPointer, true);
}

// 周回視点の状態をアプリケーションのカメラへ同期する
function syncOrbitStateToAppCamera() {
  if (!app || !orbit?.orbit) {
    return;
  }
  app.syncCameraFromEyeRig(orbit);
}

// `pan`の`unit`を現在の入力と状態から求め、呼び出し元へ返す
function getPanUnit(size = viewerSize) {
  const maxSize = Math.max(1.0e-6, Number(size?.max) || 10.0);
  return maxSize * 0.05;
}

// `vec3`を検証し、後続処理が扱える共通形式へ整える
function normalizeVec3(vec) {
  const x = Number(vec?.[0] ?? 0.0);
  const y = Number(vec?.[1] ?? 0.0);
  const z = Number(vec?.[2] ?? 0.0);
  const length = Math.hypot(x, y, z) || 1.0;
  return [x / length, y / length, z / length];
}

// 周回視点の画面の`basis`を現在の入力と状態から求め、呼び出し元へ返す
function getOrbitScreenBasis() {
  const eyeMatrix = app.eye.getWorldMatrix();
  return {
    right: normalizeVec3(eyeMatrix.mul3x3Vector([1.0, 0.0, 0.0])),
    up: normalizeVec3(eyeMatrix.mul3x3Vector([0.0, 1.0, 0.0]))
  };
}

// `panOrbitByScreenStep`は入力に従って位置または姿勢を更新し、表示状態へ反映する
function panOrbitByScreenStep(stepX = 0.0, stepY = 0.0) {
  if (!orbit?.orbit) {
    return;
  }
  const unit = getPanUnit();
  const { right, up } = getOrbitScreenBasis();
  const delta = [
    right[0] * stepX * unit + up[0] * stepY * unit,
    right[1] * stepX * unit + up[1] * stepY * unit,
    right[2] * stepX * unit + up[2] * stepY * unit
  ];
  orbit.setTarget(
    orbit.orbit.target[0] + delta[0],
    orbit.orbit.target[1] + delta[1],
    orbit.orbit.target[2] + delta[2]
  );
  syncOrbitStateToAppCamera();
}

// 現在の yaw / pitch / distance / target を保ったまま roll だけ 0 に戻す
// 長時間の回転操作で傾きが残ったときに、scene を崩さず水平だけを回復できるようにする
function resetOrbitRoll() {
  if (!orbit?.orbit) {
    return;
  }
  orbit.setAngles(orbit.orbit.yaw, orbit.orbit.pitch, 0.0);
  syncOrbitStateToAppCamera();
}

// 読み込んだ形状の範囲から周回視点を初期化する
function configureOrbitFromShapes(shapeList) {
  const size = app.getShapeSize(shapeList);
  viewerSize = { ...size };
  orbitLift = Math.max(0.4, size.max * 0.08);
  orbitLiftStep = Math.max(0.2, size.max * 0.04);
  const target = [size.centerx, size.centery + orbitLift, size.centerz];
  // この sample の model asset は全体寸法が大きく、
  // 初期 camera を遠めに置くと projection far に対して余裕が減り、
  // 起動直後に一部が消えて見えやすい
  // 既定距離をさらに短くし、最初の表示で model 全体が安定して見える位置へ寄せる
  const distance = Math.max(1.5, size.max * 1.2);

  orbit.orbit.minDistance = Math.max(0.5, size.max * 0.25);
  orbit.orbit.maxDistance = Math.max(8.0, size.max * 8.0);
  orbit.orbit.wheelZoomStep = Math.max(0.2, size.max * 0.04);
  orbit.setTarget(...target);
  orbit.setAngles(DEFAULT_ORBIT.yaw, DEFAULT_ORBIT.pitch);
  orbit.setDistance(distance);
  syncOrbitStateToAppCamera();
}

// カメラの`lift`を入力値に従って変更し、関連する状態を同期する
function moveCameraLift(step) {
  if (!orbit?.orbit) return;
  orbitLift += step;
  orbit.setTarget(
    orbit.orbit.target[0],
    orbit.orbit.target[1] + step,
    orbit.orbit.target[2]
  );
  syncOrbitStateToAppCamera();
}

// `triangles`を現在の入力と状態から求め、呼び出し元へ返す
function countTriangles(shapeList) {
  let total = 0;
  for (let i = 0; i < shapeList.length; i++) {
    total += shapeList[i].getTriangleCount();
  }
  return total;
}

// 明示的なテクスチャ設定を実行時の形状へ反映する
function applyExplicitTextureFlagsToRuntimeShapes(modelRuntime) {
  const shapes = modelRuntime?.shapes ?? [];
  for (let i = 0; i < shapes.length; i++) {
    const shape = shapes[i];
    if (!shape?.updateMaterial) continue;
    const material = shape.getMaterial?.() ?? { params: shape.materialParams ?? {} };
    const params = material?.params ?? {};
    const hasTexture = !!(params.texture ?? shape.texture);
    const color = Array.isArray(params.color)
      ? params.color
      : (Array.isArray(shape.shaderParam?.color)
        ? shape.shaderParam.color
        : (Array.isArray(shape.shader?.default?.color)
          ? shape.shader.default.color
          : [0.8, 0.8, 1.0, 1.0]));
    shape.updateMaterial({
      color,
      use_texture: hasTexture ? 1 : 0,
      // 旧ModelAssetにDeferred Shading用surface値はないため、このviewerの表示材質として明示する
      specular: 0.35,
      roughness: 0.55,
      metallic: 0.0,
      emissive: 0.0
    });
  }
}

// ワイヤーフレームの状態を対象の状態または描画設定へ反映する
function applyWireframeState() {
  const shapes = runtime?.shapes ?? [];
  for (let i = 0; i < shapes.length; i++) {
    shapes[i]?.setWireframe?.(wireframe);
  }
}

// ワイヤーフレームの有効状態を切り替え、表示と処理へ反映する
function toggleWireframe() {
  wireframe = !wireframe;
  applyWireframeState();
  app.pushToast(wireframe ? "wireframe on" : "wireframe off", {
    durationMs: 900
  });
}

// `takeViewerScreenshot`は現在のキャンバス画像を取得し、指定形式で保存する
function takeViewerScreenshot() {
  const file = app.takeScreenshot({
    prefix: "compute_json"
  });
  screenshotName = file;
  app.pushToast(`saved ${file}`, {
    durationMs: 1400
  });
}

// 選択中のクリップの識別子を現在の入力と状態から求め、呼び出し元へ返す
function getSelectedClipId() {
  if (clipNames.length === 0) {
    return null;
  }
  return clipNames[selectedClipIndex] ?? null;
}

// 選択中のクリップの`info`を現在の入力と状態から求め、呼び出し元へ返す
function getSelectedClipInfo() {
  const clipId = getSelectedClipId();
  return clipId ? modelAsset.getClipInfo(clipId) : null;
}

// 選択中のクリップの状態を現在の入力と状態から求め、呼び出し元へ返す
function getSelectedClipState() {
  const clipId = getSelectedClipId();
  const animation = clipId ? runtime?.getAnimation(clipId) : null;
  if (!animation) {
    return {
      label: "MISSING",
      paused: false,
      stopped: true
    };
  }

  const pausedState = animation.schedule.pause === true;
  const stoppedState = animation.schedule.stopped === true;
  let label = "PLAYING";
  if (stoppedState) {
    label = "STOPPED";
  } else if (pausedState) {
    label = "PAUSED";
  }

  return {
    label,
    paused: pausedState,
    stopped: stoppedState
  };
}

// クリップを現在の入力と状態から求め、呼び出し元へ返す
function selectClip(step) {
  if (clipNames.length === 0) {
    return false;
  }
  selectedClipIndex = (selectedClipIndex + step + clipNames.length) % clipNames.length;
  clipInfo = getSelectedClipInfo();
  clipBound = runtime.getAnimation(getSelectedClipId()) !== null;
  return true;
}

// `replaySelectedClip`は選択中の音声またはアニメーションの再生状態を更新する
function replaySelectedClip() {
  const clipId = getSelectedClipId();
  if (!runtime || !clipId) {
    return false;
  }
  const animation = runtime.restartAnimation(clipId);
  if (!animation) {
    return false;
  }
  effectState.paused = false;
  runtime.setAnimationsPaused(false);
  return true;
}

// `pauseSelectedClip`は選択中の音声またはアニメーションの再生状態を更新する
function pauseSelectedClip() {
  const clipId = getSelectedClipId();
  if (!runtime || !clipId) {
    return false;
  }
  const animation = runtime.pauseAnimation(clipId);
  return animation !== null;
}

// `resumeSelectedClip`は選択中の音声またはアニメーションの再生状態を更新する
function resumeSelectedClip() {
  const clipId = getSelectedClipId();
  if (!runtime || !clipId) {
    return false;
  }
  const animation = runtime.resumeAnimation(clipId);
  return animation !== null;
}

// 診断情報の統計情報を現在の入力と実行状態に合わせて更新する
function refreshDiagnosticsStats() {
  app.mergeDiagnosticsStats({
    clipCount: clipNames.length,
    selectedClipIndex,
    shapeCount: runtime?.shapes?.length ?? 0,
    nodeCount: runtime?.nodes?.length ?? 0,
    runtimeAnimations: runtime?.getAnimationNames?.().length ?? 0,
    triangleCount: totalTriangles,
    boundClip: clipBound ? "yes" : "no",
    ssao: effectState.ssaoEnabled ? "on" : "off",
    shadow: effectState.shadowEnabled ? "on" : "off",
    ssr: effectState.ssrEnabled ? "on" : "off",
    toon: effectState.toonEnabled ? "on" : "off",
    toonLevels: String(effectState.toonLevels),
    dof: effectState.dofEnabled ? "on" : "off",
    bloom: effectState.bloomEnabled ? "on" : "off",
    edge: effectState.edgeEnabled ? "on" : "off",
    edgeThickness: String(effectState.edgeThickness),
    edgeBlend: effectState.edgeBlendMode,
    lighting: effectState.ambientOnly ? "ambient" : "full"
  });
}

// 検査情報のレポートを生成し、後続処理で利用できる状態にする
function makeProbeReport(frameCount) {
  const selectedState = getSelectedClipState();
  const report = app.createProbeReport("compute-json-runtime-probe");
  Diagnostics.addDetail(report, `selectedClipId=${getSelectedClipId() ?? "-"}`);
  Diagnostics.addDetail(report, `selectedState=${selectedState.label}`);
  Diagnostics.mergeStats(report, {
    frameCount,
    clipCount: clipNames.length,
    selectedClipIndex,
    shapeCount: runtime?.shapes?.length ?? 0,
    nodeCount: runtime?.nodes?.length ?? 0,
    runtimeAnimations: runtime?.getAnimationNames?.().length ?? 0,
    triangleCount: totalTriangles,
    paused: effectState.paused ? "yes" : "no",
    selectedBound: clipBound ? "yes" : "no",
    ssao: effectState.ssaoEnabled ? "on" : "off",
    shadow: effectState.shadowEnabled ? "on" : "off",
    ssr: effectState.ssrEnabled ? "on" : "off",
    toon: effectState.toonEnabled ? "on" : "off",
    dof: effectState.dofEnabled ? "on" : "off",
    bloom: effectState.bloomEnabled ? "on" : "off",
    edge: effectState.edgeEnabled ? "on" : "off"
  });
  return report;
}

// フレームの`load`の`rows`を現在の入力と状態から求め、呼び出し元へ返す
function getFrameLoadRows() {
  const timer = app?.frameTimer;
  const gpuAvailable = timer?.timestampSupported === true;
  const computeMs = Number.isFinite(timer?.gpuComputeMs)
    ? `${timer.gpuComputeMs.toFixed(3)} ms`
    : "--";
  const renderMs = Number.isFinite(timer?.gpuRenderMs)
    ? `${timer.gpuRenderMs.toFixed(3)} ms`
    : "--";
  const computeLoad = Number.isFinite(timer?.gpuComputeMs) &&
    timer.frameIntervalMs > 0
    ? `${(timer.gpuComputeMs / timer.frameIntervalMs * 100).toFixed(1)}%`
    : (gpuAvailable ? "--" : "unavailable");
  const renderLoad = Number.isFinite(timer?.gpuRenderMs) &&
    timer.frameIntervalMs > 0
    ? `${(timer.gpuRenderMs / timer.frameIntervalMs * 100).toFixed(1)}%`
    : (gpuAvailable ? "--" : "unavailable");
  const jsLoad = Number.isFinite(timer?.jsLoadPercent)
    ? `${timer.jsLoadPercent.toFixed(1)}%`
    : "--";
  return {
    compute: `${computeMs} / ${computeLoad}`,
    render: `${renderMs} / ${renderLoad}`,
    js: jsLoad
  };
}

// HUDの`rows`を現在の入力と実行状態に合わせて更新する
function updateHudRows() {
  const selectedState = getSelectedClipState();
  const load = getFrameLoadRows();
  app.setHudRows(app.isDebugUiEnabled() ? [
    { line: "compute_json" },
    {
      label: "File",
      value: MODEL_ASSET_FILE.replace(/^.*\//, ""),
      note: `tris=${totalTriangles} clips=${clipNames.length}`
    },
    {
      label: "Model",
      value: `nodes=${runtime?.nodes?.length ?? 0} shapes=${runtime?.shapes?.length ?? 0}`,
      note: `anim=${runtime?.getAnimationNames?.().length ?? 0}`
    },
    {
      label: "Orbit",
      value: `yaw=${orbit.orbit.yaw.toFixed(1)} pitch=${orbit.orbit.pitch.toFixed(1)}`,
      note: `dist=${orbit.orbit.distance.toFixed(1)} roll=${orbit.orbit.roll.toFixed(1)}`
    },
    {
      label: "Anim",
      value: selectedState.label,
      note: effectState.paused ? "global pause=on" : "global pause=off"
    },
    {
      label: "Clip",
      value: clipInfo?.id ?? "-",
      note: `${selectedClipIndex + 1}/${clipNames.length || 0}`
    },
    { label: "SSAO", toggleKey: "A", value: effectState.ssaoEnabled ? "ON" : "OFF" },
    { label: "Shadow Map", toggleKey: "S", value: effectState.shadowEnabled ? "ON" : "OFF" },
    { label: "SSR", toggleKey: "R", value: effectState.ssrEnabled ? "ON" : "OFF" },
    { label: "Toon", toggleKey: "T", value: effectState.toonEnabled ? `ON ${effectState.toonLevels}` : "OFF" },
    { label: "DoF", toggleKey: "D", value: effectState.dofEnabled ? "ON" : "OFF" },
    { label: "Bloom", toggleKey: "B", value: effectState.bloomEnabled ? "ON" : "OFF" },
    { label: "Edge", toggleKey: "E", value: effectState.edgeEnabled ? `ON ${effectState.edgeThickness}` : "OFF" },
    { label: "Edge Blend", key: "M", action: "cycle", value: effectState.edgeBlendMode },
    { label: "Lighting", toggleKey: "L", value: effectState.ambientOnly ? "AMBIENT" : "FULL" },
    { label: "Wire", value: wireframe ? "on" : "off", note: `shot=${screenshotName || "-"}` },
    { label: "GPU Compute", value: load.compute },
    { label: "GPU Render", value: load.render },
    { label: "JS Load", value: load.js },
    { line: "Drag/Arrow orbit  Shift+Drag/Arrow pan  [/] zoom  O/P/Y roll  Space pause  A/S/R/T/D/B/E effects" }
  ] : [], {
    anchor: "top-left",
    x: 0,
    y: 0,
    color: [0.92, 0.96, 1.0],
    minScale: 0.78
  });
}

// ヘルプの行を生成し、後続処理で利用できる状態にする
function buildHelpLines() {
  return [
    ...GUIDE_LINES,
    `SSAO=${effectState.ssaoEnabled ? "ON" : "OFF"} Shadow=${effectState.shadowEnabled ? "ON" : "OFF"} SSR=${effectState.ssrEnabled ? "ON" : "OFF"}`,
    `Toon=${effectState.toonEnabled ? "ON" : "OFF"} levels=${effectState.toonLevels} DoF=${effectState.dofEnabled ? "ON" : "OFF"} Bloom=${effectState.bloomEnabled ? "ON" : "OFF"}`,
    `Edge=${effectState.edgeEnabled ? "ON" : "OFF"} thickness=${effectState.edgeThickness} blend=${effectState.edgeBlendMode}`,
    `Roll=${orbit?.orbit?.roll?.toFixed?.(1) ?? "--"}`,
    `Clip=${selectedClipIndex + 1}/${clipNames.length || 0} ${clipInfo?.id ?? "-"}`,
    `Animation=${effectState.paused ? "PAUSED" : "RUNNING"} Wire=${wireframe ? "ON" : "OFF"} Triangles=${totalTriangles}`,
    ...(app?.getFrameTimingLines?.() ?? [])
  ];
}

// ヘルプのパネルを現在の入力と実行状態に合わせて更新する
function updateHelpPanel() {
  const panel = app?.getOverlayPanel?.("computeJsonHelp");
  if (!panel) return;
  const lines = buildHelpLines();
  const nextText = lines.join("\n");
  if (nextText === lastHelpText) return;
  app.updateOverlayPanel("computeJsonHelp", { lines });
  lastHelpText = nextText;
}

// `effect`の操作を対象の状態または描画設定へ反映する
function applyEffectAction(key) {
  if (key === "a") effectState.ssaoEnabled = !effectState.ssaoEnabled;
  else if (key === "s") effectState.shadowEnabled = !effectState.shadowEnabled;
  else if (key === "r") effectState.ssrEnabled = !effectState.ssrEnabled;
  else if (key === "t") effectState.toonEnabled = !effectState.toonEnabled;
  else if (key === "5") effectState.toonLevels = Math.max(2, effectState.toonLevels - 1);
  else if (key === "6") effectState.toonLevels = Math.min(8, effectState.toonLevels + 1);
  else if (key === "d") effectState.dofEnabled = !effectState.dofEnabled;
  else if (key === "b") effectState.bloomEnabled = !effectState.bloomEnabled;
  else if (key === "e") effectState.edgeEnabled = !effectState.edgeEnabled;
  else if (key === "7") effectState.edgeThickness = Math.max(1, effectState.edgeThickness - 1);
  else if (key === "8") effectState.edgeThickness = Math.min(4, effectState.edgeThickness + 1);
  else if (key === "m") effectState.edgeBlendMode = nextEdgeBlendMode(effectState.edgeBlendMode);
  else if (key === "l") effectState.ambientOnly = !effectState.ambientOnly;
}

// モデルの操作を対象の状態または描画設定へ反映する
function applyModelAction(key) {
  if (key === "space") {
    effectState.paused = !effectState.paused;
    runtime?.setAnimationsPaused?.(effectState.paused);
  } else if (key === "1") {
    replaySelectedClip();
  } else if (key === "2") {
    pauseSelectedClip();
  } else if (key === "3") {
    resumeSelectedClip();
  } else if (key === "4") {
    selectClip(-1);
  } else if (key === "9") {
    selectClip(1);
  } else if (key === "w") {
    toggleWireframe();
  } else if (key === "o") {
    applyInvertedOrbitRollInput(-ORBIT_ROLL_BUTTON_STEP);
  } else if (key === "p") {
    applyInvertedOrbitRollInput(ORBIT_ROLL_BUTTON_STEP);
  } else if (key === "y") {
    resetOrbitRoll();
  } else if (key === "k") {
    takeViewerScreenshot();
  } else if (key === "j") {
    model?.downloadJSON?.(DOWNLOAD_FILE);
  } else if (key === "0") {
    configureOrbitFromShapes(runtime.shapes);
  }
}

// 表示の操作を対象の状態または描画設定へ反映する
function applyViewAction(key) {
  if (key === "u") {
    moveCameraLift(orbitLiftStep);
  } else if (key === "i") {
    moveCameraLift(-orbitLiftStep);
  } else if (key === "h") {
    panOrbitByScreenStep(-1.0, 0.0);
  } else if (key === "f") {
    panOrbitByScreenStep(1.0, 0.0);
  } else if (key === "g") {
    panOrbitByScreenStep(0.0, 1.0);
  } else if (key === "v") {
    panOrbitByScreenStep(0.0, -1.0);
  }
}

// 操作を対象の状態または描画設定へ反映する
function applyAction(key) {
  applyEffectAction(key);
  applyModelAction(key);
  applyViewAction(key);
  if (commandPalette?.opened) {
    renderCommandPalette();
  }
  refreshDiagnosticsStats();
}

// 画面を占有する固定buttonは置かず、double tapで開くcommand paletteへ操作を集約する
// orbitとrollのgestureはpaletteと独立して登録し、mouseとtouchで同じviewer機能を利用できるようにする
function installViewerControls() {
  createCommandPalette();
  installCommandPaletteGesture();
  installInvertedOrbitRollGesture();
}

document.addEventListener("DOMContentLoaded", () => {
  start().catch((err) => {
    app?.setDiagnosticsReport?.(Diagnostics.createErrorReport(err, {
      system: "compute_json",
      source: MODEL_ASSET_FILE,
      stage: app?.getDiagnosticsReport?.()?.stage ?? "start"
    }));
    app?.showOverlayPanel?.(buildErrorPanelOptions(err, {
      title: "compute_json failed",
      id: "start-error",
      background: "rgba(22, 28, 36, 0.92)"
    }));
    if (app?.isConsoleEnabled?.()) {
      console.error("compute_json failed:", err);
    }
  });
});

// このインスタンスの初期化段階で、必要な状態と資源を準備して処理を開始する
async function start() {
  app = new WebgApp({
    document,
    shaderClass: SmoothShader,
    autoDrawScene: false,
    renderMode: "ondemand",
    frameTiming: true,
    clearColor: [0.055, 0.075, 0.10, 1.0],
    lightPosition: [0.0, 100.0, 1000.0, 1.0],
    viewAngle: 53.0,
    projectionFar: 120.0,
    messageFontTexture: "../../webg/font512.png",
    camera: {
      target: [...DEFAULT_ORBIT.target],
      distance: DEFAULT_ORBIT.distance,
      yaw: DEFAULT_ORBIT.yaw,
      pitch: DEFAULT_ORBIT.pitch
    },
    debugTools: {
      mode: DEBUG_MODE,
      system: "compute_json",
      source: MODEL_ASSET_FILE,
      guideLines: GUIDE_LINES,
      guideOptions: {
        anchor: "top-left",
        x: 0,
        y: 0,
        width: 48,
        wrap: true
      },
      probeDefaultAfterFrames: 1
    }
  });
  await app.init();

  const helpLines = buildHelpLines();
  app.showOverlayPanel(buildHelpPanelOptions({
    id: "computeJsonHelp",
    collapsed: true,
    lines: helpLines
  }));
  lastHelpText = helpLines.join("\n");

  orbit = app.createOrbitEyeRig({
    target: [...DEFAULT_ORBIT.target],
    distance: DEFAULT_ORBIT.distance,
    yaw: DEFAULT_ORBIT.yaw,
    pitch: DEFAULT_ORBIT.pitch,
    rotationInputMode: "camera-view",
    keyZoomSpeed: 2.0,
    dragZoomModifierKey: "control",
    dragZoomSpeed: 0.04,
    dragRotateSpeed: 0.28,
    dragPanSpeed: 2.0,
    pitchMin: -UNRESTRICTED_ORBIT_PITCH_DEGREES,
    pitchMax: UNRESTRICTED_ORBIT_PITCH_DEGREES,
    dragButton: 0,
    alternateDragButton: 1,
    alternateDragModifierKey: null
  });

  model = await app.loadModel(MODEL_ASSET_FILE, {
    format: "json",
    instantiate: true,
    startAnimations: true,
    onStage: (stage) => app.setDiagnosticsStage(stage)
  });
  modelAsset = model.asset;
  runtime = model.runtime;
  applyExplicitTextureFlagsToRuntimeShapes(runtime);
  clipNames = model.getClipNames();
  selectedClipIndex = 0;
  clipInfo = getSelectedClipInfo();
  clipBound = !!getSelectedClipId() && runtime.getAnimation(getSelectedClipId()) !== null;
  totalTriangles = countTriangles(runtime.shapes);
  configureOrbitFromShapes(runtime.shapes);
  applyWireframeState();

  const gpu = app.getGPU();
  pipeline = new ComputeEffectPipeline(gpu, {
    label: "compute-json",
    width: app.screen.getWidth(),
    height: app.screen.getHeight(),
    lightTarget: [viewerSize.centerx, viewerSize.centery, viewerSize.centerz],
    lightDistance: Math.max(24.0, viewerSize.max * 5.0),
    lightHalfWidth: Math.max(10.0, viewerSize.max * 2.4),
    lightHalfHeight: Math.max(10.0, viewerSize.max * 2.4),
    lightFar: Math.max(50.0, viewerSize.max * 10.0),
    lighting: {
      ambient: 0.14
    },
    toon: {
      floor: 0.14
    },
    bloom: {
      strength: 0.45
    },
    edge: {
      mix: 0.40
    }
  });
  copyPass = new FullscreenPass(gpu, {
    targetFormat: gpu.format
  });
  await Promise.all([pipeline.ready, copyPass.init()]);

  refreshDiagnosticsStats();
  app.configureDiagnosticsCapture({
    labelPrefix: "compute_json",
    collect: () => makeProbeReport(app.screen.getFrameCount())
  });
  app.configureDebugKeyInput();

  app.attachInput({
    onKeyDown: (key, ev) => {
      if (ev.repeat) return;
      // Arrow / Shift+Arrow / [ / ] はWebgApp管理のEyeRigがkey stateから連続処理する
      // ここで固定stepを重ねず、effect・model・rollなど単発commandだけを処理する
      applyAction(key);
    }
  });
  installViewerControls();

  app.setDiagnosticsStage("runtime");
  app.start({
    onUpdate: ({ screen, timeMs }) => {
      app.afterGpuSubmit();
      if (timeMs - lastHelpUpdateMs >= 500) {
        updateHelpPanel();
        lastHelpUpdateMs = timeMs;
      }

      syncOrbitStateToAppCamera();
      if (!effectState.paused) {
        runtime.playAllAnimations();
      }

      // Pipeline側で寸法変化を判定し、同じサイズではGPU resourceを維持します
      pipeline.resize(screen.getWidth(), screen.getHeight());
      refreshDiagnosticsStats();
      app.updateDebugProbe();
      updateHudRows();
      app.setControlRows([]);
    },
    onBeforeDraw: ({ cameraFrame }) => {
      app.beginGpuTiming();
      pipeline.renderScene(
        app.space,
        cameraFrame,
        app.clearColor,
        {
          shadowEnabled: effectState.shadowEnabled && !effectState.ambientOnly,
          ssaoEnabled: effectState.ssaoEnabled,
          ssrEnabled: effectState.ssrEnabled,
          toonEnabled: effectState.toonEnabled,
          edgeEnabled: effectState.edgeEnabled,
          edgeGeometryEnabled: true,
          timestampWrites: app.getGpuRenderTimestampWrites(true, true)
        }
      );
    },
    onAfterDraw3d: ({ cameraFrame }) => {
      const gpu = app.getGPU();
      gpu.endPass();

      const finalColor = pipeline.encode(gpu.commandEncoder, {
        cameraFrame,
        ssaoEnabled: effectState.ssaoEnabled,
        shadowEnabled: effectState.shadowEnabled && !effectState.ambientOnly,
        ssrEnabled: effectState.ssrEnabled,
        toonEnabled: effectState.toonEnabled,
        dofEnabled: effectState.dofEnabled,
        bloomEnabled: effectState.bloomEnabled,
        edgeEnabled: effectState.edgeEnabled,
        toon: {
          levels: effectState.toonLevels
        },
        edgeGeometryEnabled: true,
        edge: {
          colorEnabled: false,
          blendMode: effectState.edgeBlendMode,
          thickness: effectState.edgeThickness
        },
        lighting: {
          ambient: effectState.ambientOnly ? 1.0 : 0.14,
          directionalIntensity: effectState.ambientOnly ? 0.0 : 1.0
        },
        timestampWrites: app.getGpuTimestampWrites(true, true)
      });

      app.endGpuTiming(gpu.commandEncoder);
      app.screen.beginPresentPass({
        clearColor: app.clearColor,
        colorLoadOp: "clear"
      });
      copyPass.draw(finalColor);
      app.screen.clearDepthBuffer();
    }
  });

  window.addEventListener("pagehide", () => {
    app.stop();
    copyPass?.destroy?.();
    pipeline?.destroy?.();
  }, { once: true });
}
