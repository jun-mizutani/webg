// ---------------------------------------------
// samples/com_palette/main.js  2026/07/25
//   CommandPalette self-contained style sample
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import CommandPalette, {
  getDefaultCommandPaletteCss
} from "../../webg/CommandPalette.js";

const canvas = document.getElementById("stage");
const hud = document.getElementById("hud");
const ctx = canvas.getContext("2d");

// palette操作で変化する値を1か所へ集め、描画とHUDが同じ状態を参照する
const state = {
  paused: false,
  grid: true,
  glow: true,
  wire: false,
  mode: "Object",
  brush: "Draw",
  radius: 18,
  strength: 48,
  theme: "mmodeler",
  angle: 0,
  message: "Double click / double tap or press /"
};

// setTheme()の確認用に、同じcustom property群を持つ2種類のthemeを用意する
const themes = {
  mmodeler: {
    line: "rgba(138, 202, 255, 0.18)",
    ink: "#eff8ff",
    sub: "#a2bdd3",
    panel: "rgba(8, 18, 28, 0.84)",
    button: "rgba(12, 26, 38, 0.54)",
    buttonActive: "rgba(75, 167, 10, 0.489)",
    accent: "#ffd36b"
  },
  graphite: {
    line: "rgba(220, 230, 236, 0.24)",
    ink: "rgba(248, 250, 252, 0.96)",
    sub: "rgba(194, 204, 214, 0.88)",
    panel: "rgba(22, 25, 29, 0.82)",
    button: "rgba(42, 48, 55, 0.72)",
    buttonActive: "rgba(178, 130, 40, 0.72)",
    accent: "rgba(255, 214, 128, 0.92)"
  }
};

// 最後に実行した操作をstateへ保存し、HUD全体を最新状態へ更新する
function setMessage(text) {
  state.message = text;
  updateHud();
}

// mode、設定値、toggle状態を1つの文字列へまとめ、palette操作の結果を画面へ表示する
function updateHud() {
  hud.textContent = [
    "samples/com_palette",
    "Double click / double tap: command palette",
    "/: open or close palette",
    "",
    `mode=${state.mode} brush=${state.brush}`,
    `radius=${state.radius} strength=${state.strength}`,
    `grid=${state.grid ? "on" : "off"} glow=${state.glow ? "on" : "off"} wire=${state.wire ? "on" : "off"}`,
    `theme=${state.theme}`,
    state.message
  ].join("\n");
}

// CSS pixelとdevice pixel ratioから描画bufferを作り直し、高DPIでも線を鮮明に保つ
function resizeCanvas() {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.floor(window.innerWidth * dpr));
  const height = Math.max(1, Math.floor(window.innerHeight * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// Grid toggleが有効な場合だけ、canvas全体へ一定間隔の基準線を描く
function drawGrid(width, height) {
  if (!state.grid) return;
  ctx.strokeStyle = "rgba(128, 178, 220, 0.13)";
  ctx.lineWidth = 1;
  const step = 42;
  for (let x = 0; x <= width; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y <= height; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
}

// mode switchの選択結果を、HUDだけでなく中央の図形にも反映する
// Objectは通常表示、Editは頂点編集、Sculptはbrush範囲という違いを単純な2D記号で示す
function drawModePreview(cx, cy) {
  const halfWidth = state.radius * 2.2;
  const halfHeight = state.radius * 1.2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(state.angle);

  if (state.mode === "Object") {
    ctx.fillStyle = "rgba(43, 113, 158, 0.28)";
    ctx.strokeStyle = "rgba(255, 232, 160, 0.90)";
    ctx.lineWidth = 3;
    ctx.fillRect(-halfWidth, -halfHeight, halfWidth * 2, halfHeight * 2);
    ctx.strokeRect(-halfWidth, -halfHeight, halfWidth * 2, halfHeight * 2);
  } else if (state.mode === "Edit") {
    const corners = [
      [-halfWidth, -halfHeight],
      [halfWidth, -halfHeight],
      [halfWidth, halfHeight],
      [-halfWidth, halfHeight]
    ];
    ctx.strokeStyle = "rgba(255, 157, 75, 0.94)";
    ctx.lineWidth = 2;
    ctx.strokeRect(-halfWidth, -halfHeight, halfWidth * 2, halfHeight * 2);
    ctx.fillStyle = "rgba(255, 232, 160, 0.98)";
    for (const [x, y] of corners) {
      ctx.fillRect(x - 4, y - 4, 8, 8);
    }
  } else if (state.mode === "Sculpt") {
    ctx.beginPath();
    ctx.arc(0, 0, halfWidth, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(80, 185, 121, 0.24)";
    ctx.fill();
    ctx.strokeStyle = "rgba(126, 247, 174, 0.94)";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-halfWidth, 0);
    ctx.lineTo(halfWidth, 0);
    ctx.moveTo(0, -halfWidth);
    ctx.lineTo(0, halfWidth);
    ctx.strokeStyle = "rgba(126, 247, 174, 0.48)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.restore();
}

// animation状態と全palette設定を読み、背景、粒子、mode previewの順に1frameを描画する
function drawScene(timeMs) {
  resizeCanvas();
  const width = window.innerWidth;
  const height = window.innerHeight;
  if (!state.paused) {
    state.angle = timeMs * 0.00035;
  }
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#061018";
  ctx.fillRect(0, 0, width, height);
  drawGrid(width, height);

  const cx = width * 0.5;
  const cy = height * 0.53;
  const radius = Math.min(width, height) * 0.22;
  const count = 9;
  for (let i = 0; i < count; i++) {
    const t = state.angle + i * Math.PI * 2 / count;
    const x = cx + Math.cos(t) * radius;
    const y = cy + Math.sin(t * 1.2) * radius * 0.55;
    const size = 22 + Math.sin(t * 2.0) * 8;
    ctx.beginPath();
    ctx.fillStyle = state.glow
      ? `rgba(${90 + i * 14}, ${156 + i * 6}, 230, 0.72)`
      : "rgba(145, 164, 178, 0.58)";
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
    if (state.wire) {
      ctx.strokeStyle = "rgba(255, 240, 168, 0.78)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  drawModePreview(cx, cy);

  requestAnimationFrame(drawScene);
}

// Mode Switchの3buttonから現在選択中の1つだけをactiveとして返す
// CommandPaletteはこの結果をrender()ごとに読み、buttonのclassへ反映する
function commandState(id) {
  return {
    active: (id === "mode-object" && state.mode === "Object")
      || (id === "mode-edit" && state.mode === "Edit")
      || (id === "mode-sculpt" && state.mode === "Sculpt")
  };
}

let palette = null;

// theme名をstateへ保存し、対応するCSS custom propertiesをpaletteへ適用する
function applyTheme(name) {
  state.theme = name;
  palette.setTheme(themes[name] ?? themes.mmodeler);
  setMessage(`theme ${name}`);
}

// button系commandのidをapp状態の更新へ変換し、変更後にHUDとpaletteを再描画する
// toggle、stepper、selectの値変更はconstructorのonChangeへ分離する
function handleCommand(id) {
  if (id === "mode-object" || id === "mode-edit" || id === "mode-sculpt") {
    state.mode = id === "mode-object" ? "Object" : id === "mode-edit" ? "Edit" : "Sculpt";
    setMessage(`mode switch = ${state.mode}`);
    palette.render();
    return;
  }
  if (id === "reset") {
    state.radius = 18;
    state.strength = 48;
    state.mode = "Object";
    state.brush = "Draw";
    state.grid = true;
    state.glow = true;
    state.wire = false;
  } else if (id === "custom-style") {
    palette.setStyle(`${getDefaultCommandPaletteCss()}
.command-palette.surface {
  border-color: rgba(255, 214, 128, 0.55);
  background: rgba(25, 18, 13, 0.84);
}
.palette-button {
  border-radius: 6px;
}
`);
    setMessage("setStyle(): compact amber override");
    return;
  } else if (id === "default-style") {
    palette.setStyle(getDefaultCommandPaletteCss());
    applyTheme("mmodeler");
    setMessage("default style restored");
    return;
  }
  setMessage(`command ${id}`);
  palette.render();
}

palette = new CommandPalette({
  document,
  container: document.body,
  viewport: canvas,
  title: "Com Palette",
  pageRows: 5,
  pageRowsByPage: [5, 5],
  closeOnCommand: false,
  getCommandState: commandState,
  onCommand: handleCommand,
  // 値を持つUI部品からの通知をstateへ反映し、次のrenderとframe描画へ渡す
  onChange: (id, value) => {
    if (id === "pause") state.paused = value;
    if (id === "grid") state.grid = value;
    if (id === "glow") state.glow = value;
    if (id === "wire") state.wire = value;
    if (id === "radius") state.radius = value;
    if (id === "strength") state.strength = value;
    if (id === "brush") state.brush = value;
    if (id === "theme") applyTheme(value);
    setMessage(`${id} = ${value}`);
  },
  commands: [
    // 1ページ目
    // boolean状態をbuttonのactive表示と直接対応させるtoggle群
    { type: "toggle", id: "pause", label: "P", detail: "pause", value: () => state.paused },
    { type: "toggle", id: "grid", label: "Grid", detail: "toggle", value: () => state.grid },
    { type: "toggle", id: "glow", label: "Glow", detail: "toggle", value: () => state.glow },
    { id: "palette-next", label: "Next", detail: "page", pageSwitch: true },
    { type: "toggle", id: "wire", label: "Wire", detail: "toggle", value: () => state.wire },
    // 3つのうち1つだけがactiveになる排他的なMode Switch群
    { id: "mode-object", label: "Obj", detail: "mode", modeSwitch: true },
    { id: "mode-edit", label: "Edit", detail: "mode", modeSwitch: true },
    { id: "mode-sculpt", label: "Scpt", detail: "mode", modeSwitch: true },
    // 数値の増減と直接入力を同じonChange経路で確認するstepper群
    { type: "stepper", id: "radius", label: "Radius", value: () => state.radius, min: 8, max: 56, step: 2, input: true },
    { type: "stepper", id: "strength", label: "Brush Pressure Strength", value: () => state.strength, min: 0, max: 100, step: 4, input: true },
    { id: "custom-style", label: "CSS", detail: "set" },
    { id: "default-style", label: "Def", detail: "style" },
    { id: "reset", label: "Reset", detail: "state" },
    null,
    // 2ページ目
    null,
    null,
    null,
    { id: "palette-next", label: "Next", detail: "page", pageSwitch: true },
    // buttonを押すたびに候補を順番に選ぶselect群
    { type: "select", id: "brush", label: "Brush", value: () => state.brush, options: [
      { value: "Draw", label: "Draw" },
      { value: "Blur", label: "Blur" },
      { value: "Grab", label: "Grab" },
      { value: "Pinch", label: "Pinch" }
    ] },
    { type: "select", id: "theme", label: "Theme", value: () => state.theme, options: [
      { value: "mmodeler", label: "mmodeler" },
      { value: "graphite", label: "graphite" }
    ] },
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
  ]
});

// canvas gestureとkeyboardをpaletteへ接続し、生成済みDOMを開ける状態にする
palette.attachToCanvas(canvas, {
  key: "/"
});
applyTheme("mmodeler");
updateHud();
window.addEventListener("resize", resizeCanvas);
requestAnimationFrame(drawScene);
