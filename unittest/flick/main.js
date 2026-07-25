// ---------------------------------------------
// unittest/flick/main.js  2026/05/15
//   flick / long press / double tap gesture POC
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import Touch from "../../webg/Touch.js";

const canvas = document.getElementById("surface");
const ctx = canvas.getContext("2d");
const palette = document.getElementById("palette");
const logEl = document.getElementById("log");
const modeEl = document.querySelector('[data-role="mode"]');
const toolEl = document.querySelector('[data-role="tool"]');
const selectionEl = document.querySelector('[data-role="selection"]');

const state = {
  mode: "edit",
  tool: "select",
  selected: 0,
  message: "ready",
  points: [
    { x: 0.36, y: 0.33 },
    { x: 0.62, y: 0.33 },
    { x: 0.67, y: 0.58 },
    { x: 0.42, y: 0.66 }
  ],
  faces: [[0, 1, 2, 3]],
  undo: []
};

const tools = ["select", "add", "face", "move"];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const setMessage = (message) => {
  state.message = message;
  logEl.textContent = message;
};

const resize = () => {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
};

const getCanvasPoint = (clientX, clientY) => {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (clientX - rect.left) / Math.max(1, rect.width),
    y: (clientY - rect.top) / Math.max(1, rect.height)
  };
};

const toScreen = (point) => {
  const rect = canvas.getBoundingClientRect();
  return {
    x: point.x * rect.width,
    y: point.y * rect.height
  };
};

const pushUndo = () => {
  state.undo.push({
    points: state.points.map((p) => ({ ...p })),
    faces: state.faces.map((face) => [...face]),
    selected: state.selected
  });
  if (state.undo.length > 20) state.undo.shift();
};

const restoreUndo = () => {
  const prev = state.undo.pop();
  if (!prev) {
    setMessage("undo stack is empty");
    return;
  }
  state.points = prev.points.map((p) => ({ ...p }));
  state.faces = prev.faces.map((face) => [...face]);
  state.selected = prev.selected;
  setMessage("undo");
  updateUi();
  draw();
};

const findNearestPoint = (x, y, maxPx = 34) => {
  const rect = canvas.getBoundingClientRect();
  let best = -1;
  let bestDistance = maxPx;
  for (let i = 0; i < state.points.length; i++) {
    const p = state.points[i];
    const dx = p.x * rect.width - x;
    const dy = p.y * rect.height - y;
    const distance = Math.hypot(dx, dy);
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  }
  return best;
};

const cycleTool = (step) => {
  const index = Math.max(0, tools.indexOf(state.tool));
  state.tool = tools[(index + step + tools.length) % tools.length];
  setMessage(`tool: ${state.tool}`);
  updateUi();
};

const selectPoint = (index) => {
  if (index < 0 || index >= state.points.length) {
    setMessage("no vertex at tap");
    return;
  }
  state.selected = index;
  setMessage(`selected vertex ${index}`);
  updateUi();
};

const addPoint = (x, y) => {
  pushUndo();
  state.points.push({ x: clamp(x, 0.04, 0.96), y: clamp(y, 0.04, 0.96) });
  state.selected = state.points.length - 1;
  setMessage(`add vertex ${state.selected}`);
  updateUi();
};

const nudgeSelected = (dx, dy) => {
  if (state.selected < 0 || state.selected >= state.points.length) return;
  pushUndo();
  const p = state.points[state.selected];
  p.x = clamp(p.x + dx, 0.04, 0.96);
  p.y = clamp(p.y + dy, 0.04, 0.96);
  setMessage(`nudge vertex ${state.selected}`);
  draw();
};

const deleteSelected = () => {
  if (state.points.length <= 1) {
    setMessage("last vertex cannot be deleted");
    return;
  }
  pushUndo();
  const removed = state.selected;
  state.points.splice(removed, 1);
  state.faces = state.faces
    .map((face) => face.filter((index) => index !== removed).map((index) => index > removed ? index - 1 : index))
    .filter((face) => face.length >= 3);
  state.selected = clamp(removed, 0, state.points.length - 1);
  setMessage(`delete vertex ${removed}`);
  updateUi();
  draw();
};

const duplicateSelected = () => {
  const p = state.points[state.selected];
  if (!p) return;
  addPoint(p.x + 0.06, p.y - 0.06);
  setMessage(`duplicate vertex ${state.selected}`);
};

const toggleMode = () => {
  state.mode = state.mode === "edit" ? "object" : "edit";
  setMessage(`double tap: ${state.mode} mode`);
  updateUi();
};

const openPalette = (x, y) => {
  const rect = canvas.getBoundingClientRect();
  palette.style.left = `${clamp(x - rect.left, 12, rect.width - 210)}px`;
  palette.style.top = `${clamp(y - rect.top, 12, rect.height - 210)}px`;
  palette.classList.add("open");
  setMessage("long press: command palette");
};

const closePalette = () => {
  palette.classList.remove("open");
};

const updateUi = () => {
  modeEl.textContent = state.mode === "edit" ? "Edit" : "Object";
  toolEl.textContent = state.tool[0].toUpperCase() + state.tool.slice(1);
  selectionEl.textContent = `selected: ${state.selected}`;
};

const draw = () => {
  const rect = canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);

  ctx.save();
  ctx.lineWidth = 2;
  for (const face of state.faces) {
    if (face.length < 3) continue;
    ctx.beginPath();
    for (let i = 0; i < face.length; i++) {
      const p = toScreen(state.points[face[i]]);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.fillStyle = "rgba(70, 184, 255, 0.16)";
    ctx.strokeStyle = "rgba(142, 218, 255, 0.72)";
    ctx.fill();
    ctx.stroke();
  }

  for (let i = 0; i < state.points.length; i++) {
    const p = toScreen(state.points[i]);
    const selected = i === state.selected;
    ctx.beginPath();
    ctx.arc(p.x, p.y, selected ? 13 : 10, 0, Math.PI * 2);
    ctx.fillStyle = selected ? "#ffd36b" : "#46b8ff";
    ctx.strokeStyle = selected ? "#fff3bf" : "#d6f3ff";
    ctx.lineWidth = selected ? 3 : 2;
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#091018";
    ctx.font = "700 12px system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(i), p.x, p.y + 0.5);
  }

  ctx.fillStyle = "rgba(238, 248, 255, 0.78)";
  ctx.font = "13px system-ui";
  ctx.textAlign = "left";
  ctx.fillText("tap: select/add, double tap: mode, long press: palette", 14, 24);
  ctx.fillText("flick L/R: tool, flick U: duplicate, flick D: delete", 14, 44);
  ctx.restore();
};

const handleGesture = (gesture) => {
  closePalette();
  if (gesture.type === "tap") {
    const local = getCanvasPoint(gesture.x, gesture.y);
    const rect = canvas.getBoundingClientRect();
    const nearest = findNearestPoint(gesture.x - rect.left, gesture.y - rect.top);
    if (state.tool === "add" || nearest < 0) {
      addPoint(local.x, local.y);
    } else {
      selectPoint(nearest);
    }
  } else if (gesture.type === "doubletap") {
    toggleMode();
  } else if (gesture.type === "longpress") {
    const rect = canvas.getBoundingClientRect();
    const nearest = findNearestPoint(gesture.x - rect.left, gesture.y - rect.top, 42);
    if (nearest >= 0) state.selected = nearest;
    openPalette(gesture.x, gesture.y);
    updateUi();
  } else if (gesture.type === "flick") {
    if (gesture.direction === "left") cycleTool(-1);
    if (gesture.direction === "right") cycleTool(1);
    if (gesture.direction === "up") duplicateSelected();
    if (gesture.direction === "down") deleteSelected();
  }
  draw();
};

const touch = new Touch(document, { touchDeviceOnly: false });
touch.attachSurface(canvas, {
  touchDeviceOnly: false,
  touchOnly: false,
  minDistance: 46,
  longPressTime: 520,
  longPressMoveTolerance: 14,
  tapMoveTolerance: 16,
  doubleTapTime: 320,
  doubleTapDistance: 30,
  onGesture: handleGesture
});

document.querySelectorAll("[data-command]").forEach((button) => {
  button.addEventListener("click", () => {
    const command = button.dataset.command;
    if (command === "select" || command === "add" || command === "face") {
      state.tool = command;
      setMessage(`tool: ${command}`);
    } else if (command === "undo") {
      restoreUndo();
    } else if (command === "delete") {
      deleteSelected();
    } else if (command === "move") {
      state.tool = "move";
      setMessage("move tool");
    } else if (command === "extrude") {
      duplicateSelected();
      nudgeSelected(0.04, -0.08);
      setMessage("extrude POC");
    } else if (command === "close") {
      closePalette();
      setMessage("palette closed");
    }
    updateUi();
    draw();
  });
});

window.addEventListener("resize", resize);
window.addEventListener("orientationchange", resize);
resize();
updateUi();
setMessage("tap a vertex or flick on the canvas");
