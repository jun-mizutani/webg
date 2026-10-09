// ---------------------------------------------
// unittest/tilt_input/main.js  2026/10/04
//   tilt input vector visualization unittest
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import Space from "../../webg/Space.js";
import Shape from "../../webg/Shape.js";
import Matrix from "../../webg/Matrix.js";
import SmoothShader from "../../webg/SmoothShader.js";
import { bootUnitTestApp } from "../shared/UnitTestApp.js";

// 傾きの基準姿勢と補正値は、このページのローカル状態で管理する
// 実センサーと模擬入力をページ内の共通状態へ反映し、補正と可視化の対応を確認する

// 更新量を上下限へ収め、操作と物理表示を一定の範囲に保つ
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// 現在値から目標値へ指定の割合で近づけ、傾き表示を滑らかに更新する
const lerp = (a, b, t) => a + (b - a) * t;

const options = {
  maxDegrees: 35.0,
  smoothing: 0.18,
  deadZone: 0.025,
  keySpeed: 1.8
};

// boardと傾きの目印に使う直方体を頂点と面から構築する
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

// 現在の画面の縦横比と推奨視野角から透視投影を作り、比較用シェーダーへ設定する
const setProjection = (screen, shader) => {
  const proj = new Matrix();
  const fov = screen.getRecommendedFov(45.0);
  proj.makeProjectionMatrix(0.1, 400.0, fov, screen.getAspect());
  shader.setProjectionMatrix(proj);
};

// センサー値、基準姿勢、模擬入力、補正後の傾きを保持するローカル状態を準備する
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

// 中立付近の小さな傾きを0へ整え、操作の中心を安定させる
const applyDeadZone = (value) => Math.abs(value) < options.deadZone ? 0.0 : value;

// betaとgammaから基準姿勢を引き、最大角度で正規化した傾きベクトルを更新する
const updateDeviceTarget = (state) => {
  const x = (state.rawGamma - state.neutralGamma) / options.maxDegrees;
  const y = (state.rawBeta - state.neutralBeta) / options.maxDegrees;
  state.targetX = applyDeadZone(clamp(x, -1.0, 1.0));
  state.targetY = applyDeadZone(clamp(y, -1.0, 1.0));
};

// 入力源を模擬入力へ切り替え、仮想の傾きと目標値を0へ戻す
const resetEmulation = (state) => {
  state.source = "emulate";
  state.emuX = 0.0;
  state.emuY = 0.0;
  state.targetX = 0.0;
  state.targetY = 0.0;
};

// 現在のbetaとgammaを中立姿勢として保存し、以後の傾きをその差分で計算する
const calibrateDevice = (state) => {
  state.neutralBeta = state.rawBeta;
  state.neutralGamma = state.rawGamma;
  state.calibrated = true;
  if (state.source === "device") {
    updateDeviceTarget(state);
  }
};

// 模擬入力を範囲とdead zoneへ合わせ、センサーと共通の目標ベクトルへ反映する
const setEmulatedTilt = (state, x, y) => {
  state.source = "emulate";
  state.emuX = applyDeadZone(clamp(x, -1.0, 1.0));
  state.emuY = applyDeadZone(clamp(y, -1.0, 1.0));
  state.targetX = state.emuX;
  state.targetY = state.emuY;
};

// pad上のpointer操作を傾きベクトルへ変換するイベントを登録する
const attachPad = (state) => {
  const pad = document.getElementById("tiltPad");
  const dot = document.getElementById("tiltDot");
  const vector = document.getElementById("tiltVector");
  let pointerId = null;

  // pointer位置をpadの中心からの比率へ変換し、仮想の左右・前後の傾きを更新する
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
  // 操作中のpointerが離れたとき、padのドラッグ対象を解除する
  const release = (ev) => {
    if (pointerId === ev.pointerId) {
      pointerId = null;
    }
  };
  pad.addEventListener("pointerup", release);
  pad.addEventListener("pointercancel", release);

  return {
    // 補正後の傾きをpadのdotとvectorへ反映し、3D表示と同じ方向を示す
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

// 矢印とWASDを仮想の傾きへ接続し、リセットと基準姿勢の操作も登録する
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
    // 継続して押されているキーと経過秒数から、模擬入力の傾きを増減する
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

// センサー許可、基準姿勢、模擬入力への切替ボタンをローカル状態へ接続する
const attachDeviceButtons = (state) => {
  const deviceButton = document.getElementById("deviceButton");
  const calibrateButton = document.getElementById("calibrateButton");
  const resetButton = document.getElementById("resetButton");
  const emulateButton = document.getElementById("emulateButton");

  // 実センサーの角度をローカル状態へ保存し、基準姿勢からの傾きを更新する
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

  // 端末の利用許可を確認してdeviceorientationを接続し、実センサーを入力源にする
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

// 傾き入力のローカル状態と2D・3D表示を準備し、実機と模擬入力を比較する
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
