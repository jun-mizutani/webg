// ---------------------------------------------
// unittest/tilt_input/main.js  2026/07/25
//   tilt input vector visualization unittest
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import Space from "../../webg/Space.js";
import Shape from "../../webg/Shape.js";
import Matrix from "../../webg/Matrix.js";
import SmoothShader from "../../webg/SmoothShader.js";
import { bootUnitTestApp } from "../shared/UnitTestApp.js";

// This unittest intentionally keeps TiltInput local to the test.
// After the device/emulation behavior is settled, the same API shape can move to webg/TiltInput.js.

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const lerp = (a, b, t) => a + (b - a) * t;

const options = {
  maxDegrees: 35.0,
  smoothing: 0.18,
  deadZone: 0.025,
  keySpeed: 1.8
};

// `box`の形状を生成し、後続処理で利用できる状態にする
const createBoxShape = (gpu, size, material) => {
  const [sx, sy, sz] = size.map((v) => Number(v) * 0.5);
  const vertices = [
    [-sx, -sy, -sz], [ sx, -sy, -sz], [ sx,  sy, -sz], [-sx,  sy, -sz],
    [-sx, -sy,  sz], [ sx, -sy,  sz], [ sx,  sy,  sz], [-sx,  sy,  sz]
  ];
  const faces = [
    [0, 1, 2, 3],
    [5, 4, 7, 6],
    [4, 0, 3, 7],
    [1, 5, 6, 2],
    [3, 2, 6, 7],
    [4, 5, 1, 0]
  ];
  const shape = new Shape(gpu);
  for (const v of vertices) {
    shape.addVertex(v[0], v[1], v[2]);
  }
  for (const face of faces) {
    shape.addPlane(face);
  }
  shape.endShape();
  shape.setMaterial("smooth-shader", material);
  return shape;
};

// 投影を受け取り、現在の設定と後続処理へ反映する
const setProjection = (screen, shader) => {
  const proj = new Matrix();
  const fov = screen.getRecommendedFov(45.0);
  proj.makeProjectionMatrix(0.1, 400.0, fov, screen.getAspect());
  shader.setProjectionMatrix(proj);
};

const makeTiltState = () => ({
  source: "emulate",
  permission: "n/a",
  available: typeof window.DeviceOrientationEvent !== "undefined",
  listening: false,
  calibrated: false,
  rawAlpha: 0.0,
  rawBeta: 0.0,
  rawGamma: 0.0,
  neutralBeta: 0.0,
  neutralGamma: 0.0,
  targetX: 0.0,
  targetY: 0.0,
  tiltX: 0.0,
  tiltY: 0.0,
  emuX: 0.0,
  emuY: 0.0,
  lastEventMs: 0.0
});

const applyDeadZone = (value) => Math.abs(value) < options.deadZone ? 0.0 : value;

// `device`の対象を現在の入力と実行状態に合わせて更新する
const updateDeviceTarget = (state) => {
  const x = (state.rawGamma - state.neutralGamma) / options.maxDegrees;
  const y = (state.rawBeta - state.neutralBeta) / options.maxDegrees;
  state.targetX = applyDeadZone(clamp(x, -1.0, 1.0));
  state.targetY = applyDeadZone(clamp(y, -1.0, 1.0));
};

// `emulation`を初期状態へ戻し、前回の状態を残さない
const resetEmulation = (state) => {
  state.source = "emulate";
  state.emuX = 0.0;
  state.emuY = 0.0;
  state.targetX = 0.0;
  state.targetY = 0.0;
};

// `calibrateDevice`は受け取った値を処理し、後続処理で利用する状態または結果を生成する
const calibrateDevice = (state) => {
  state.neutralBeta = state.rawBeta;
  state.neutralGamma = state.rawGamma;
  state.calibrated = true;
  if (state.source === "device") {
    updateDeviceTarget(state);
  }
};

// `emulated`の`tilt`を受け取り、現在の設定と後続処理へ反映する
const setEmulatedTilt = (state, x, y) => {
  state.source = "emulate";
  state.emuX = applyDeadZone(clamp(x, -1.0, 1.0));
  state.emuY = applyDeadZone(clamp(y, -1.0, 1.0));
  state.targetX = state.emuX;
  state.targetY = state.emuY;
};

// `pad`を対象へ追加し、後続処理から参照できるようにする
const attachPad = (state) => {
  const pad = document.getElementById("tiltPad");
  const dot = document.getElementById("tiltDot");
  const vector = document.getElementById("tiltVector");
  let pointerId = null;

  // `from`のイベントを現在の入力と実行状態に合わせて更新する
  const updateFromEvent = (ev) => {
    const rect = pad.getBoundingClientRect();
    const cx = rect.left + rect.width * 0.5;
    const cy = rect.top + rect.height * 0.5;
    const radius = Math.max(1.0, Math.min(rect.width, rect.height) * 0.5);
    setEmulatedTilt(
      state,
      (ev.clientX - cx) / radius,
      (ev.clientY - cy) / radius
    );
  };

  pad.addEventListener("pointerdown", (ev) => {
    pointerId = ev.pointerId;
    pad.setPointerCapture?.(ev.pointerId);
    updateFromEvent(ev);
    ev.preventDefault();
  });
  pad.addEventListener("pointermove", (ev) => {
    if (pointerId !== ev.pointerId) return;
    updateFromEvent(ev);
    ev.preventDefault();
  });
  // このインスタンスが保持する資源と参照を安全に解放する
  const release = (ev) => {
    if (pointerId === ev.pointerId) {
      pointerId = null;
    }
  };
  pad.addEventListener("pointerup", release);
  pad.addEventListener("pointercancel", release);

  return {
    update() {
      const rect = pad.getBoundingClientRect();
      const radius = Math.min(rect.width, rect.height) * 0.5;
      const x = state.tiltX * radius;
      const y = state.tiltY * radius;
      dot.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
      const len = Math.hypot(x, y);
      const angle = Math.atan2(y, x) * 180.0 / Math.PI;
      vector.style.width = `${Math.max(1.0, len)}px`;
      vector.style.transform = `rotate(${angle}deg)`;
      vector.style.opacity = len > 1.0 ? "1" : "0.35";
    }
  };
};

// `keyboard`を対象へ追加し、後続処理から参照できるようにする
const attachKeyboard = (state) => {
  const keys = new Set();
  document.addEventListener("keydown", (ev) => {
    const key = ev.key.toLowerCase();
    keys.add(key);
    if (key === "r") resetEmulation(state);
    if (key === "c") calibrateDevice(state);
    if (["arrowleft", "arrowright", "arrowup", "arrowdown", "w", "a", "s", "d", "r", "c"].includes(key)) {
      ev.preventDefault();
    }
  });
  document.addEventListener("keyup", (ev) => {
    keys.delete(ev.key.toLowerCase());
  });
  return {
    update(dt) {
      let dx = 0.0;
      let dy = 0.0;
      if (keys.has("arrowleft") || keys.has("a")) dx -= 1.0;
      if (keys.has("arrowright") || keys.has("d")) dx += 1.0;
      if (keys.has("arrowup") || keys.has("w")) dy -= 1.0;
      if (keys.has("arrowdown") || keys.has("s")) dy += 1.0;
      if (dx !== 0.0 || dy !== 0.0) {
        setEmulatedTilt(
          state,
          state.emuX + dx * options.keySpeed * dt,
          state.emuY + dy * options.keySpeed * dt
        );
      }
    }
  };
};

// `device`の`buttons`を対象へ追加し、後続処理から参照できるようにする
const attachDeviceButtons = (state) => {
  const deviceButton = document.getElementById("deviceButton");
  const calibrateButton = document.getElementById("calibrateButton");
  const resetButton = document.getElementById("resetButton");
  const emulateButton = document.getElementById("emulateButton");

  // `orientation`を受け取った段階で、対応する状態更新と処理を実行する
  const onOrientation = (ev) => {
    state.source = "device";
    state.rawAlpha = Number(ev.alpha ?? 0.0);
    state.rawBeta = Number(ev.beta ?? 0.0);
    state.rawGamma = Number(ev.gamma ?? 0.0);
    state.lastEventMs = performance.now();
    if (!state.calibrated) {
      calibrateDevice(state);
    }
    updateDeviceTarget(state);
  };

  // `device`の初期化段階で、必要な状態と資源を準備して処理を開始する
  const startDevice = async () => {
    if (!state.available) {
      state.permission = "unavailable";
      return;
    }
    try {
      const ctor = window.DeviceOrientationEvent;
      if (typeof ctor?.requestPermission === "function") {
        state.permission = await ctor.requestPermission();
        if (state.permission !== "granted") {
          return;
        }
      } else {
        state.permission = "granted";
      }
      if (!state.listening) {
        window.addEventListener("deviceorientation", onOrientation);
        state.listening = true;
      }
      state.source = "device";
    } catch (err) {
      state.permission = `error:${err?.message ?? err}`;
    }
  };

  deviceButton.addEventListener("click", startDevice);
  calibrateButton.addEventListener("click", () => calibrateDevice(state));
  resetButton.addEventListener("click", () => resetEmulation(state));
  emulateButton.addEventListener("click", () => {
    state.source = "emulate";
    state.targetX = state.emuX;
    state.targetY = state.emuY;
  });
};

// このインスタンスの初期化段階で、必要な状態と資源を準備して処理を開始する
const start = async ({ screen, gpu, setStatus, setViewportLayout, startLoop }) => {
  const shader = new SmoothShader(gpu);
  await shader.init();
  Shape.prototype.shader = shader;
  setViewportLayout(() => setProjection(screen, shader));
  shader.setLightPosition([80.0, 120.0, 80.0, 1.0]);

  const space = new Space();
  const eye = space.addNode(null, "eye");
  eye.setPosition(0.0, 30.0, 58.0);
  eye.setAttitude(0.0, -28.0, 0.0);

  const board = space.addNode(null, "tilt-board");
  board.addShape(createBoxShape(gpu, [42.0, 0.35, 42.0], {
    has_bone: 0,
    color: [0.14, 0.22, 0.27, 1.0],
    ambient: 0.42,
    specular: 0.22,
    power: 18.0,
    emissive: 0.0
  }));

  const marker = space.addNode(null, "tilt-marker");
  marker.addShape(createBoxShape(gpu, [2.2, 2.2, 2.2], {
    has_bone: 0,
    color: [1.0, 0.74, 0.18, 1.0],
    ambient: 0.35,
    specular: 0.7,
    power: 36.0,
    emissive: 0.05
  }));

  const cursor = space.addNode(null, "tilt-cursor");
  cursor.addShape(createBoxShape(gpu, [1.0, 0.8, 8.0], {
    has_bone: 0,
    color: [0.42, 0.92, 1.0, 1.0],
    ambient: 0.35,
    specular: 0.64,
    power: 32.0,
    emissive: 0.12
  }));

  const state = makeTiltState();
  const padUi = attachPad(state);
  const keyboard = attachKeyboard(state);
  attachDeviceButtons(state);

  let lastMs = performance.now();
  startLoop((timeMs) => {
    const dt = clamp((timeMs - lastMs) * 0.001, 0.0, 0.05);
    lastMs = timeMs;
    keyboard.update(dt);

    state.tiltX = lerp(state.tiltX, state.targetX, options.smoothing);
    state.tiltY = lerp(state.tiltY, state.targetY, options.smoothing);

    const px = state.tiltX * 18.0;
    const pz = state.tiltY * 18.0;
    const len = Math.hypot(state.tiltX, state.tiltY);
    const yaw = len > 0.001 ? Math.atan2(state.tiltX, state.tiltY) * 180.0 / Math.PI : 0.0;
    marker.setPosition(px, 1.5, pz);
    marker.setAttitude(timeMs * 0.08, 0.0, 0.0);
    cursor.setPosition(px * 0.5, 1.0, pz * 0.5);
    cursor.setAttitude(yaw, 0.0, 0.0);
    cursor.setScale(clamp(len, 0.08, 1.0));
    board.setAttitude(state.tiltX * 10.0, 0.0, -state.tiltY * 10.0);

    padUi.update();
    setStatus([
      "unittest/tilt_input",
      `source=${state.source} available=${state.available ? "yes" : "no"} permission=${state.permission}`,
      `tiltX=${state.tiltX.toFixed(3)} tiltY=${state.tiltY.toFixed(3)} target=(${state.targetX.toFixed(3)}, ${state.targetY.toFixed(3)})`,
      `raw alpha=${state.rawAlpha.toFixed(1)} beta=${state.rawBeta.toFixed(1)} gamma=${state.rawGamma.toFixed(1)}`,
      `neutral beta=${state.neutralBeta.toFixed(1)} gamma=${state.neutralGamma.toFixed(1)} calibrated=${state.calibrated ? "yes" : "no"}`,
      "PC: drag pad / Arrow / WASD / R reset / C calibrate"
    ].join("\n"));

    screen.clear();
    space.draw(eye);
    screen.present();
  });
};

bootUnitTestApp({
  statusElementId: "status",
  initialStatus: "creating tilt input unittest...",
  clearColor: [0.06, 0.09, 0.12, 1.0]
}, (app) => {
  return start(app);
});
