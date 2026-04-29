// ---------------------------------------------
// unittest/particle_emitter/main.js  2026/04/10
//   particle_emitter unittest
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import WebgApp from "../../webg/WebgApp.js";
import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";
import ParticleEmitter from "../../webg/ParticleEmitter.js";

// この test は、ParticleEmitter を「単体テスト」と「使用例」の両方として読めるようにする
// まず headless の自動テストでロジックを確認し、そのあと WebgApp の実画面で
// particle が飛ぶ様子を確認できるようにしている
// コードの読み手が関数名だけで推測しなくて済むよう、各段階の意図をコメントで残す

const AUTO_PARTICLE_MAX = 4;
const PARTICLE_MAX = 320;
const FLOOR_Y = -8.0;
const FLOOR_HEIGHT = 1.0;
const SOURCE_X_LIMIT = 12.0;
const SOURCE_Y = -3.0;
const SOURCE_Z = 0.0;
const SOURCE_SPEED = 8.5;
const START_BURST_COUNT = 24;
const PRESET_ORDER = ["spark", "smoke", "debris", "pickup"];

const statusEl = document.getElementById("status");
const manualEl = document.getElementById("manual");

const lines = [];
let passCount = 0;
let failCount = 0;

// 1 件分の結果を文字列として蓄積する
// DOM へ逐次書き込まず、最後にまとめて表示することで PASS / FAIL の流れを追いやすくする
const log = (line) => {
  lines.push(line);
};

// 条件を 1 つ評価し、結果に応じて PASS / FAIL を記録する
// 失敗時だけ detail を付けて、何がずれたかを後から読みやすくする
const check = (label, condition, detail = "") => {
  if (condition) {
    passCount += 1;
    log(`PASS ${label}`);
  } else {
    failCount += 1;
    log(`FAIL ${label}${detail ? `: ${detail}` : ""}`);
  }
};

// 近い値同士を比較するための小さな helper
// particle の位置や life は float で動くので、完全一致ではなく誤差込みで確認する
const approx = (value, expected, epsilon = 0.0001) => Math.abs(value - expected) <= epsilon;

const drawLog = {
  main: [],
  shadow: [],
  texture: []
};

const fakeTexture = {
  // procedural billboard texture が作られたかを記録する
  buildProceduralBillboardTexture(options) {
    drawLog.texture.push({ type: "build", options });
  },
  // clamp 設定まで辿れたかを記録する
  setClamp() {
    drawLog.texture.push({ type: "clamp" });
  }
};

const fakeBillboard = {
  // draw 前に clear されるかを記録する
  clear() {
    drawLog.main.push({ type: "clear" });
  },
  // particle 1 個分の instance data が流れてきたかを記録する
  addBillboard(x, y, z, sx, sy, color) {
    drawLog.main.push({
      type: "add",
      x,
      y,
      z,
      sx,
      sy,
      color: [...color]
    });
  },
  // 最後に draw が呼ばれたかを記録する
  draw() {
    drawLog.main.push({ type: "draw" });
  }
};

const fakeShadowBillboard = {
  // 影用 billboard も同じ順番で描画されるかを記録する
  clear() {
    drawLog.shadow.push({ type: "clear" });
  },
  addBillboard(x, y, z, sx, sy, color) {
    drawLog.shadow.push({
      type: "add",
      x,
      y,
      z,
      sx,
      sy,
      color: [...color]
    });
  },
  // 地面向きの描画経路を通ったかを記録する
  drawGround() {
    drawLog.shadow.push({ type: "drawGround" });
  }
};

// まずは renderer を fake に差し替えて、ParticleEmitter の内部ロジックだけを確認する
// ここでは WebGPU を使わず、preset / emit / update / draw / clear の流れを安定して検証する
const autoEmitter = new ParticleEmitter({
  maxParticles: AUTO_PARTICLE_MAX,
  useShadow: true,
  preset: "spark",
  seed: 7
});
autoEmitter.setRenderer({
  billboard: fakeBillboard,
  shadowBillboard: fakeShadowBillboard,
  texture: fakeTexture
});

check("preset name is stored", autoEmitter.getPreset().name === "spark");
check("renderer is registered", autoEmitter.initialized === true);
check("texture rebuild runs through fake texture", drawLog.texture.length >= 1);

// setPreset() が texture の再生成まで含めて働くかを確認する
// ここでは smoke へ切り替えたあと、再び spark に戻して使用例としても読めるようにする
const textureCountBeforePresetChange = drawLog.texture.length;
autoEmitter.setPreset("smoke");
check("setPreset switches preset name", autoEmitter.getPreset().name === "smoke");
check("setPreset rebuilds procedural texture", drawLog.texture.length > textureCountBeforePresetChange);
autoEmitter.setPreset("spark");

const spawned = autoEmitter.emit(2, {
  position: [1.0, 2.0, 3.0],
  positionSpread: [0.0, 0.0, 0.0],
  velocity: [2.0, 4.0, 0.0],
  velocitySpread: [0.0, 0.0, 0.0],
  gravity: [0.0, 0.0, 0.0],
  drag: 0.0,
  life: 1.0,
  lifeSpread: 0.0,
  size: 0.5,
  sizeSpread: 0.0,
  color: [1.0, 0.5, 0.25, 1.0],
  colorSpread: [0.0, 0.0, 0.0, 0.0],
  shadowAlpha: 0.4,
  shadowScale: 2.0,
  shadowY: -1.0
});

check("emit spawns requested count", spawned === 2);
check("alive count reflects spawned particles", autoEmitter.getAliveCount() === 2);

// update() は秒換算で進むので、500ms で position と life の変化を確認する
autoEmitter.update(500);
check("particle x advances with velocity", approx(autoEmitter.particles[0].x, 2.0));
check("particle y advances with velocity", approx(autoEmitter.particles[0].y, 4.0));
check("particle life counts down in seconds", approx(autoEmitter.particles[0].life, 0.5));

// draw() は billboard と shadow billboard の両方へ流れる
const drawn = autoEmitter.draw(null, null);
check("draw returns alive count", drawn === 2);
check("main renderer received clear/add/draw", drawLog.main.some((item) => item.type === "draw"));
check("shadow renderer received clear/add/drawGround", drawLog.shadow.some((item) => item.type === "drawGround"));
check("main renderer received 2 particles", drawLog.main.filter((item) => item.type === "add").length === 2);
check("shadow renderer received 2 particles", drawLog.shadow.filter((item) => item.type === "add").length === 2);
check("draw alpha fades with life", approx(drawLog.main.find((item) => item.type === "add").color[3], 0.5));

autoEmitter.clear();
check("clear removes active particles", autoEmitter.getAliveCount() === 0);

if (statusEl) {
  statusEl.textContent = [
    "particle_emitter unittest",
    `auto pass=${passCount} fail=${failCount}`,
    ...lines,
    "",
    "manual phase: loading WebgApp visual sample..."
  ].join("\n");
}

if (manualEl) {
  manualEl.textContent = "manual phase: loading WebgApp visual sample...";
}

const manualRuntime = {
  app: null,
  emitter: null,
  floorNode: null,
  beaconNode: null,
  state: {
    sourceX: 0.0,
    sourceY: SOURCE_Y,
    sourceZ: SOURCE_Z,
    burstCount: START_BURST_COUNT,
    presetIndex: 0,
    lastInput: "none",
    lastEvent: "waiting",
    alive: 0,
    flashSec: 0.0,
    suppressedEdges: new Set()
  }
};

// 浮動小数の位置を画面上の移動範囲へ収める
// 左右移動の見え方を分かりやすくするため、source は横軸だけで動かす
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// いまの preset 名を state から取り出す
// 画面表示と emitter 側の preset を同じ名前でそろえるための薄い helper
const getCurrentPresetName = () => PRESET_ORDER[manualRuntime.state.presetIndex] ?? PRESET_ORDER[0];

// manual panel と canvas HUD の両方へ同じ情報を流す
// ここでの説明は、コードを読まずに画面だけ見ても操作の意味が伝わる粒度にしている
const makeHudRows = () => {
  const state = manualRuntime.state;
  const preset = getCurrentPresetName();
  return [
    { line: "particle_emitter unittest / visual sample" },
    {
      label: "Burst",
      value: `${state.burstCount} particles`,
      keys: [
        { key: "Space", action: "burst" },
        { key: "Enter", action: "burst" },
        { key: "Burst", action: "touch" }
      ],
      note: `alive ${state.alive}/${PARTICLE_MAX}`
    },
    {
      label: "Preset",
      value: preset,
      keys: [
        { key: "1", action: "spark" },
        { key: "2", action: "smoke" },
        { key: "3", action: "debris" },
        { key: "4", action: "pickup" }
      ],
      note: "touch buttons do the same thing"
    },
    {
      label: "Move",
      value: `x=${state.sourceX.toFixed(1)}`,
      keys: [
        { key: "ArrowLeft", action: "left" },
        { key: "ArrowRight", action: "right" },
        { key: "A/D", action: "hold" }
      ],
      note: "move the emission point left and right"
    },
    {
      label: "Utility",
      value: "clear / reset / count",
      keys: [
        { key: "C", action: "clear" },
        { key: "R", action: "reset" },
        { key: "[", action: "less" },
        { key: "]", action: "more" }
      ]
    }
  ];
};

// 手動確認用の HTML パネルへ、いまの状態を見やすく書き出す
// emitter の preset / alive / source 位置 / 最後の入力を 1 画面で読めるようにする
const renderManualPanel = () => {
  if (!manualEl) return;
  const state = manualRuntime.state;
  manualEl.textContent = [
    "ParticleEmitter visual sample",
    `preset: ${getCurrentPresetName()}`,
    `burst count: ${state.burstCount}`,
    `alive: ${state.alive}/${PARTICLE_MAX}`,
    `source: x=${state.sourceX.toFixed(1)} y=${state.sourceY.toFixed(1)} z=${state.sourceZ.toFixed(1)}`,
    `last input: ${state.lastInput}`,
    `last event: ${state.lastEvent}`,
    `recent burst flash: ${state.flashSec > 0.0 ? "on" : "off"}`,
    "",
    "keyboard: Space/Enter burst, 1-4 preset, C clear, R reset, [/] burst count, ArrowLeft/ArrowRight or A/D move",
    "touch: Burst / Spark / Smoke / Debris / Pickup / Clear / Reset / - / +"
  ].join("\n");
};

// touch ボタンを PC 画面でも読みやすい幅へ調整する
// ボタン数が多いので、ラベルの長さに応じて少しだけ横幅を広げる
const configureTouchRoot = (root) => {
  if (!root) return;
  root.style.justifyContent = "center";
  root.style.alignItems = "flex-end";
  root.style.paddingLeft = "14px";
  root.style.paddingRight = "14px";
  root.style.paddingBottom = "16px";
  root.style.gap = "10px";
  root.style.maxWidth = "100vw";
  const buttons = root.querySelectorAll(".webg-touch-btn");
  for (let i = 0; i < buttons.length; i++) {
    const button = buttons[i];
    const key = String(button.dataset.key ?? "").toLowerCase();
    if (key === "left" || key === "right") {
      button.style.width = "68px";
      button.style.height = "68px";
    } else if (key === "burst") {
      button.style.width = "92px";
      button.style.height = "68px";
    } else if (key === "spark" || key === "smoke" || key === "debris" || key === "pickup") {
      button.style.width = "88px";
      button.style.height = "56px";
    } else {
      button.style.width = "72px";
      button.style.height = "56px";
    }
  }
};

// touch の action ボタンで即時処理した入力を、次 frame の edge 判定で
// もう一度拾わないようにする
const suppressNextActionEdge = (action) => {
  const key = String(action ?? "").toLowerCase();
  if (!key) return;
  manualRuntime.state.suppressedEdges.add(key);
};

// floor は粒子の落下先を見せるための背景であり、ParticleEmitter の主題ではない
// ただし地面があると shadow billboard の役割が分かりやすくなるので、薄い床を置いている
const createFloorShape = (gpu) => {
  const shape = new Shape(gpu);
  shape.applyPrimitiveAsset(Primitive.cuboid(40.0, FLOOR_HEIGHT, 40.0, shape.getPrimitiveOptions()));
  shape.endShape();
  shape.setMaterial("smooth-shader", {
    has_bone: 0,
    color: [0.30, 0.34, 0.42, 1.0],
    ambient: 0.34,
    specular: 0.42,
    power: 28.0,
    emissive: 0.0
  });
  return shape;
};

// source 位置を示す小さな marker は、particle がどこから出ているかを読みやすくする
// emitter の emit() 例を示すとき、発射点が見えると仕様がすぐ理解できる
const createBeaconShape = (gpu) => {
  const shape = new Shape(gpu);
  shape.applyPrimitiveAsset(Primitive.sphere(0.50, 20, 20, shape.getPrimitiveOptions()));
  shape.endShape();
  shape.setMaterial("smooth-shader", {
    has_bone: 0,
    color: [0.90, 0.56, 0.18, 1.0],
    ambient: 0.10,
    specular: 1.20,
    power: 88.0,
    emissive: 0.0
  });
  return shape;
};

// emitter の preset を切り替え、必要なら短い preview burst を出す
// sample 側からは setPreset() をどう使うかが分かるよう、切り替えと発射を分けずに並べて見せる
const applyPreset = (name, { previewBurst = true } = {}) => {
  const normalized = String(name ?? PRESET_ORDER[0]).toLowerCase();
  const nextIndex = PRESET_ORDER.indexOf(normalized);
  if (nextIndex >= 0) {
    manualRuntime.state.presetIndex = nextIndex;
  }
  if (!manualRuntime.emitter) {
    return;
  }
  manualRuntime.emitter.setPreset(normalized);
  manualRuntime.emitter.clear();
  manualRuntime.state.lastEvent = `preset ${normalized}`;
  manualRuntime.state.flashSec = 0.22;
  if (previewBurst) {
    emitBurst(`preset ${normalized}`, Math.max(12, Math.floor(manualRuntime.state.burstCount * 0.75)));
  }
  renderManualPanel();
};

// strict 化後の ParticleEmitter.emit() は、preset に依存した暗黙補完をしない
// そのため sample 側でも、現在の preset defaults を読み出して必要な配列と数値を
// すべて明示した emit options を組み立てる
const buildBurstEmitOptions = () => {
  const preset = manualRuntime.emitter.getPreset();
  const defaults = preset.defaults;
  return {
    position: [manualRuntime.state.sourceX, manualRuntime.state.sourceY, manualRuntime.state.sourceZ],
    positionSpread: [0.25, 0.18, 0.25],
    velocity: [...defaults.velocity],
    velocitySpread: [...defaults.velocitySpread],
    gravity: [...defaults.gravity],
    drag: defaults.drag,
    life: defaults.life,
    lifeSpread: defaults.lifeSpread,
    size: defaults.size,
    sizeSpread: defaults.sizeSpread,
    color: [...defaults.color],
    colorSpread: [...defaults.colorSpread],
    shadowAlpha: defaults.shadowAlpha,
    shadowScale: defaults.shadowScale,
    shadowY: FLOOR_Y + FLOOR_HEIGHT * 0.5 + 0.06
  };
};

// emit() は ParticleEmitter の主要 API なので、発射位置だけでなく
// 現在の preset が要求する配列と数値もまとめて明示して呼び出す例にしておく
const emitBurst = (reason = "burst", count = manualRuntime.state.burstCount) => {
  if (!manualRuntime.emitter) {
    return 0;
  }
  const spawned = manualRuntime.emitter.emit(count, buildBurstEmitOptions());
  manualRuntime.state.lastEvent = `${reason} x${spawned}`;
  manualRuntime.state.flashSec = 0.30;
  manualRuntime.state.alive = manualRuntime.emitter.getAliveCount();
  if (manualRuntime.app) {
    manualRuntime.app.flashMessage(`${getCurrentPresetName()} x${spawned}`);
  }
  renderManualPanel();
  return spawned;
};

// reset は source を中心に戻して、現在の preset だけを残す操作として扱う
// 画面を一度整理してから次の burst を観察しやすくする意図で、粒子自体は clear する
const resetEmitter = () => {
  manualRuntime.state.sourceX = 0.0;
  manualRuntime.state.lastEvent = "reset";
  manualRuntime.state.flashSec = 0.24;
  if (manualRuntime.emitter) {
    manualRuntime.emitter.clear();
    manualRuntime.state.alive = manualRuntime.emitter.getAliveCount();
  }
  if (manualRuntime.beaconNode) {
    manualRuntime.beaconNode.setPosition(manualRuntime.state.sourceX, manualRuntime.state.sourceY, manualRuntime.state.sourceZ);
  }
  if (manualRuntime.app) {
    manualRuntime.app.flashMessage("source reset");
  }
  renderManualPanel();
};

// 画面上の HUD は、manual panel の短い抜粋として毎 frame 再構成する
// canvas と HTML panel の両方が同じ状態を参照するので、説明がずれにくい
const updateHudRows = () => {
  if (!manualRuntime.app) return;
  manualRuntime.app.setHudRows(makeHudRows(), {
    anchor: "top-left",
    x: 0,
    y: 0,
    color: [0.90, 0.96, 1.0],
    minScale: 0.80
  });
};

// manual phase の 1 frame を更新する
// 入力を読んで source を動かし、burst / preset / clear / reset の各操作を particle emitter へ流す
const updateVisualFrame = (ctx) => {
  const app = manualRuntime.app;
  const emitter = manualRuntime.emitter;
  if (!app || !emitter) return;

  const dt = Math.max(0.0, Number(ctx?.deltaSec ?? 0.0));
  const state = manualRuntime.state;

  // hold 入力は source の左右移動へ使う
  const moveLeft = app.input?.getAction?.("left") ? 1.0 : 0.0;
  const moveRight = app.input?.getAction?.("right") ? 1.0 : 0.0;
  state.sourceX = clamp(state.sourceX + (moveRight - moveLeft) * SOURCE_SPEED * dt, -SOURCE_X_LIMIT, SOURCE_X_LIMIT);

  // source の位置は毎 frame で beacon node に反映する
  if (manualRuntime.beaconNode) {
    manualRuntime.beaconNode.setPosition(state.sourceX, state.sourceY, state.sourceZ);
  }

  // one-shot action は keyboard では edge、touch では即時処理を使う
  // touch 側で先に実行した action は 1 frame だけ抑制し、二重発火を避ける
  const runActionEdge = (name, callback) => {
    if (!app.input?.wasActionPressed?.(name)) return;
    if (state.suppressedEdges.has(name)) {
      state.suppressedEdges.delete(name);
      return;
    }
    callback();
  };
  runActionEdge("burst", () => emitBurst("burst"));
  runActionEdge("spark", () => applyPreset("spark"));
  runActionEdge("smoke", () => applyPreset("smoke"));
  runActionEdge("debris", () => applyPreset("debris"));
  runActionEdge("pickup", () => applyPreset("pickup"));
  runActionEdge("clear", () => {
    emitter.clear();
    state.alive = emitter.getAliveCount();
    state.lastEvent = "clear";
    state.flashSec = 0.20;
    app.flashMessage("particles cleared");
    renderManualPanel();
  });
  runActionEdge("reset", () => resetEmitter());
  runActionEdge("less", () => {
    state.burstCount = clamp(state.burstCount - 8, 8, 128);
    state.lastEvent = `burst count ${state.burstCount}`;
    state.flashSec = 0.18;
    app.flashMessage(`burst ${state.burstCount}`);
    renderManualPanel();
  });
  runActionEdge("more", () => {
    state.burstCount = clamp(state.burstCount + 8, 8, 128);
    state.lastEvent = `burst count ${state.burstCount}`;
    state.flashSec = 0.18;
    app.flashMessage(`burst ${state.burstCount}`);
    renderManualPanel();
  });

  // flashSec は短い視覚反応用の残り時間として使う
  state.flashSec = Math.max(0.0, state.flashSec - dt);

  // particle 数は毎 frame で表示に反映する
  state.alive = emitter.getAliveCount();

  // HUD row と HTML panel を更新して、現状が 1 目で分かるようにする
  updateHudRows();
  renderManualPanel();
};

// WebgApp を立ち上げて、実際に particle が canvas 上へ流れる様子を確認する
// この段階では ParticleEmitter の API 例としても読めるよう、source / preset / burst の流れを明示する
const startVisualPhase = async () => {
  manualRuntime.app = new WebgApp({
    document,
    clearColor: [0.06, 0.08, 0.12, 1.0],
    viewAngle: 54.0,
    projectionNear: 0.1,
    projectionFar: 1200.0,
    messageFontTexture: "../../webg/font512.png",
    debugTools: {
      mode: "release",
      system: "particle_emitter",
      source: "unittest/particle_emitter/main.js",
      probeDefaultAfterFrames: 1
    },
    light: {
      mode: "world-node",
      nodeName: "light",
      position: [40.0, 60.0, 30.0],
      type: 1.0
    },
    camera: {
      target: [0.0, -3.0, 0.0],
      distance: 34.0,
      yaw: 0.0,
      pitch: -14.0
    }
  });
  await manualRuntime.app.init();

  // Keyboard は action map、touch は仮想ボタンという 2 系統を同じ action 名へ流し込む
  // この sample では input 例としても使いたいので、hold と action を明確に分けて登録する
  manualRuntime.app.registerActionMap({
    left: ["ArrowLeft", "A"],
    right: ["ArrowRight", "D"],
    burst: ["Space", "Enter"],
    spark: ["1"],
    smoke: ["2"],
    debris: ["3"],
    pickup: ["4"],
    clear: ["C"],
    reset: ["R"],
    less: ["["],
    more: ["]"]
  });

  // 文字としての raw key も読みたいので、keyboard の押下/解放を手元の state に残す
  // これがあると、入力が action へ変換される前後の流れを追いやすい
  manualRuntime.app.attachInput({
    onKeyDown: (key) => {
      manualRuntime.state.lastInput = `keyboard ${key}`;
      manualRuntime.state.lastEvent = `keydown ${key}`;
      renderManualPanel();
    },
    onKeyUp: (key) => {
      manualRuntime.state.lastInput = `keyboard ${key}`;
      manualRuntime.state.lastEvent = `keyup ${key}`;
      renderManualPanel();
    }
  });

  // ParticleEmitter は WebgApp の helper から作ると、GPU 初期化と billboard 生成をまとめて任せられる
  manualRuntime.emitter = await manualRuntime.app.createParticleEmitter({
    name: "particleEmitterDemo",
    maxParticles: PARTICLE_MAX,
    useShadow: true,
    preset: "spark",
    seed: 19
  });

  // 実画面の地面と source beacon を置いて、粒子の発生元と落下先が見えるようにする
  const floorShape = createFloorShape(manualRuntime.app.getGL());
  const beaconShape = createBeaconShape(manualRuntime.app.getGL());

  manualRuntime.floorNode = manualRuntime.app.space.addNode(null, "particleFloor");
  manualRuntime.floorNode.setPosition(0.0, FLOOR_Y, 0.0);
  manualRuntime.floorNode.addShape(floorShape);

  manualRuntime.beaconNode = manualRuntime.app.space.addNode(null, "particleSource");
  manualRuntime.beaconNode.setPosition(manualRuntime.state.sourceX, manualRuntime.state.sourceY, manualRuntime.state.sourceZ);
  manualRuntime.beaconNode.addShape(beaconShape);

  // touch ボタンは PC でも visible にして、keyboard と同じ action を試せるようにする
  const touchRoot = manualRuntime.app.input.installTouchControls({
    touchDeviceOnly: false,
    className: "webg-touch-root particle-emitter-touch",
    groups: [
      {
        id: "move",
        buttons: [
          { key: "left", label: "←", kind: "hold", ariaLabel: "move left", width: 68, height: 68 },
          { key: "right", label: "→", kind: "hold", ariaLabel: "move right", width: 68, height: 68 }
        ]
      },
      {
        id: "burst",
        buttons: [
          { key: "burst", label: "Burst", kind: "action", ariaLabel: "emit particles", width: 92, height: 68 }
        ]
      },
      {
        id: "preset",
        buttons: [
          { key: "spark", label: "Spark", kind: "action", ariaLabel: "spark preset", width: 88, height: 56 },
          { key: "smoke", label: "Smoke", kind: "action", ariaLabel: "smoke preset", width: 88, height: 56 },
          { key: "debris", label: "Debris", kind: "action", ariaLabel: "debris preset", width: 88, height: 56 },
          { key: "pickup", label: "Pickup", kind: "action", ariaLabel: "pickup preset", width: 88, height: 56 }
        ]
      },
      {
        id: "utility",
        buttons: [
          { key: "clear", label: "Clear", kind: "action", ariaLabel: "clear particles", width: 72, height: 56 },
          { key: "reset", label: "Reset", kind: "action", ariaLabel: "reset source", width: 72, height: 56 },
          { key: "less", label: "-", kind: "action", ariaLabel: "decrease burst count", width: 52, height: 56 },
          { key: "more", label: "+", kind: "action", ariaLabel: "increase burst count", width: 52, height: 56 }
        ]
      }
    ],
    onAnyPress: (info) => {
      manualRuntime.state.lastInput = `touch ${info.key}`;
      manualRuntime.state.lastEvent = `press ${info.key}`;
      renderManualPanel();
    },
    onAction: (info) => {
      manualRuntime.state.lastInput = `touch ${info.key}`;
      manualRuntime.state.lastEvent = `action ${info.key}`;
      suppressNextActionEdge(info.key);
      switch (String(info.key ?? "").toLowerCase()) {
        case "burst":
          emitBurst("touch burst");
          break;
        case "spark":
          applyPreset("spark");
          break;
        case "smoke":
          applyPreset("smoke");
          break;
        case "debris":
          applyPreset("debris");
          break;
        case "pickup":
          applyPreset("pickup");
          break;
        case "clear":
          manualRuntime.emitter?.clear();
          manualRuntime.state.alive = manualRuntime.emitter?.getAliveCount?.() ?? 0;
          manualRuntime.state.flashSec = 0.20;
          manualRuntime.app?.flashMessage("particles cleared");
          renderManualPanel();
          break;
        case "reset":
          resetEmitter();
          break;
        case "less":
          manualRuntime.state.burstCount = clamp(manualRuntime.state.burstCount - 8, 8, 128);
          manualRuntime.state.lastEvent = `burst count ${manualRuntime.state.burstCount}`;
          manualRuntime.state.flashSec = 0.18;
          manualRuntime.app?.flashMessage(`burst ${manualRuntime.state.burstCount}`);
          renderManualPanel();
          break;
        case "more":
          manualRuntime.state.burstCount = clamp(manualRuntime.state.burstCount + 8, 8, 128);
          manualRuntime.state.lastEvent = `burst count ${manualRuntime.state.burstCount}`;
          manualRuntime.state.flashSec = 0.18;
          manualRuntime.app?.flashMessage(`burst ${manualRuntime.state.burstCount}`);
          renderManualPanel();
          break;
        default:
          break;
      }
      renderManualPanel();
    }
  });
  configureTouchRoot(touchRoot);

  // 起動直後に 1 回 burst して、画面が空のまま始まらないようにする
  // これで visual sample としても、すぐ particle の動きを見やすくなる
  manualRuntime.state.lastInput = "startup";
  emitBurst("startup", 18);

  manualRuntime.app.setLoopHandlers({
    onUpdate: (ctx) => {
      updateVisualFrame(ctx);
    }
  });

  renderManualPanel();
  updateHudRows();
  if (manualEl) {
    manualEl.textContent = manualEl.textContent.replace("loading WebgApp visual sample...", "WebgApp visual sample ready");
  }
  if (statusEl) {
    statusEl.textContent += "\n\nmanual phase: WebgApp visual sample ready";
  }

  manualRuntime.app.start();
};

// visual phase の失敗は、単に黙って止まるより、どこで止まったかを画面へ返したほうがよい
// そのため startVisualPhase の失敗は status と manual の両方へ出す
void startVisualPhase().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  if (statusEl) {
    statusEl.textContent = [
      "particle_emitter unittest",
      `auto pass=${passCount} fail=${failCount}`,
      ...lines,
      "",
      `manual phase failed: ${message}`
    ].join("\n");
  }
  if (manualEl) {
    manualEl.textContent = [
      "particle_emitter manual phase failed",
      message
    ].join("\n");
  }
  console.error("particle_emitter manual phase failed:", error);
});
