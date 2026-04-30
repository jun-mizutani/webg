// ---------------------------------------------
// unittest/game_api/main.js  2026/04/30
//   game_api unittest
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import WebgApp from "../../webg/WebgApp.js";
import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";
import GameStateManager from "../../samples/GameStateManager.js";

// webgクラスの役割:
// WebgApp          : screen / camera / input / message をまとめて初期化する
// GameStateManager : title / play / pause / result の場面遷移を扱う
// Shape            : 描画メッシュと collision shape を同時に保持する
// Primitive         : デモ用 cube mesh を簡単に生成する

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const randRange = (min, max) => min + Math.random() * (max - min);

const createCubeShape = (gpu, size, color, collisionShape) => {
  const shape = new Shape(gpu);
  shape.applyPrimitiveAsset(Primitive.cube(size, shape.getPrimitiveOptions()));
  shape.endShape();
  shape.setMaterial("smooth-shader", {
    has_bone: 0,
    use_texture: 0,
    color: [...color],
    ambient: 0.22,
    specular: 0.88,
    power: 42.0
  });
  shape.setCollisionShape(collisionShape);
  return shape;
};

const createFloorShape = (gpu, color) => {
  const shape = new Shape(gpu);
  shape.addVertex(-12.0, 0.0, -8.0);
  shape.addVertex(12.0, 0.0, -8.0);
  shape.addVertex(12.0, 0.0, 8.0);
  shape.addVertex(-12.0, 0.0, 8.0);
  shape.addPlane([0, 1, 2, 3]);
  shape.endShape();
  shape.setMaterial("smooth-shader", {
    has_bone: 0,
    use_texture: 0,
    color: [...color],
    ambient: 0.18,
    specular: 0.08,
    power: 8.0
  });
  shape.setCollisionShape({
    type: "aabb",
    box: {
      minx: -12.0,
      maxx: 12.0,
      miny: -0.1,
      maxy: 0.1,
      minz: -8.0,
      maxz: 8.0
    }
  });
  return shape;
};

const start = async () => {
  const app = new WebgApp({
    document,
    clearColor: [0.06, 0.08, 0.12, 1.0],
    debugTools: {
      mode: "release",
      system: "game_api",
      source: "unittest/game_api/main.js"
    },
    camera: {
      target: [0.0, 0.0, 0.0],
      distance: 22.0,
      yaw: 0.0,
      pitch: -28.0,
      roll: 0.0
    },
    light: {
      mode: "eye-fixed",
      position: [120.0, 170.0, 150.0, 1.0]
    }
  });
  await app.init();

  const gpu = app.screen.getGL();
  const space = app.space;
  const statusEl = document.getElementById("status");
  const writeStatus = (lines) => {
    if (statusEl) {
      statusEl.textContent = lines.join("\n");
    }
  };

  const state = {
    playerX: -8.0,
    targetX: 8.0,
    timeLeft: 30.0,
    score: 0,
    combo: 0,
    lastHitMs: -1,
    phaseHint: "play"
  };
  const gsm = new GameStateManager({
    initialState: "play"
  });

  const syncScenePhase = (phase = gsm.currentStateId ?? gsm.initialState ?? state.phaseHint) => {
    app.setScenePhase(phase, {
      force: true
    });
    return phase;
  };

  const setGamePhase = (phase, options = {}) => {
    const result = gsm.setState(phase, options);
    syncScenePhase();
    return result;
  };

  const playerNode = space.addNode(null, "player");
  const playerShape = createCubeShape(gpu, 3.2, [0.30, 0.72, 1.0, 1.0], {
    type: "sphere",
    radius: 1.55,
    center: [0.0, 0.0, 0.0]
  });
  playerNode.addShape(playerShape);
  space.addCollisionBody(playerNode, {
    id: "player"
  });

  const targetNode = space.addNode(null, "target");
  const targetShape = createCubeShape(gpu, 2.8, [1.0, 0.62, 0.30, 1.0], {
    type: "sphere",
    radius: 1.35,
    center: [0.0, 0.0, 0.0]
  });
  targetNode.addShape(targetShape);
  space.addCollisionBody(targetNode, {
    id: "target"
  });

  const floorNode = space.addNode(null, "floor");
  const floorShape = createFloorShape(gpu, [0.13, 0.16, 0.22, 1.0]);
  floorNode.addShape(floorShape);
  floorNode.setPosition(0.0, -2.8, 0.0);
  space.addCollisionBody(floorNode, {
    id: "floor",
    enabled: false
  });

  const placeTarget = (avoidX = 0.0) => {
    let nextX = randRange(-9.0, 9.0);
    while (Math.abs(nextX - avoidX) < 4.0) {
      nextX = randRange(-9.0, 9.0);
    }
    state.targetX = nextX;
    targetNode.setPosition(state.targetX, 0.0, 0.0);
  };

  const resetRound = () => {
    state.playerX = -8.0;
    state.timeLeft = 30.0;
    state.score = 0;
    state.combo = 0;
    state.lastHitMs = -1;
    state.phaseHint = "play";
    placeTarget(state.playerX);
    playerNode.setPosition(state.playerX, 0.0, 0.0);
    renderHudNumbers();
  };

  app.registerActionMap({
    left: ["arrowleft", "a", "left"],
    right: ["arrowright", "d", "right"],
    start: ["enter", "space"],
    pause: ["p", "escape"],
    reset: ["r"]
  });

  const touchRoot = app.input.installTouchControls({
    touchDeviceOnly: false,
    className: "webg-touch-root",
    groups: [
      {
        id: "move",
        buttons: [
          { key: "left", label: "←", kind: "hold", ariaLabel: "move left" },
          { key: "right", label: "→", kind: "hold", ariaLabel: "move right" }
        ]
      },
    {
      id: "system",
      buttons: [
        { key: "start", label: "Start", kind: "action", ariaLabel: "start play" },
        { key: "pause", label: "Pause", kind: "action", ariaLabel: "pause play" },
        { key: "reset", label: "Reset", kind: "action", ariaLabel: "reset round" }
      ]
    }
    ]
  });
  if (touchRoot) {
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

  app.message.setLines("guide", [
    "game_api unittest",
    "Enter / Start: resume from pause/result",
    "P / Pause: toggle pause",
    "R / Reset: return to title"
  ], {
    x: 0,
    y: 0,
    color: [0.90, 0.95, 1.0]
  });

  app.setControlRows([
    {
      label: "input",
      value: "action map",
      keys: [
        { key: "ArrowLeft / A", action: "move player left" },
        { key: "ArrowRight / D", action: "move player right" }
      ],
      note: "touch hold buttons mirror the same keys"
    },
    {
      label: "scene",
      value: "GameStateManager",
      keys: [
        { key: "Enter", action: "start" },
        { key: "P / Esc", action: "pause" },
        { key: "R", action: "reset" }
      ],
      note: "title / play / pause / result"
    },
    {
      label: "collision",
      value: "Space helper",
      keys: [
        { key: "sphere", action: "player body" },
        { key: "sphere", action: "target body" }
      ],
      note: "Shape.setCollisionShape() feeds Space.addCollisionBody()"
    }
  ], {
    anchor: "bottom-left",
    x: 0,
    y: -2,
    color: [0.88, 0.96, 1.0],
    gap: 1,
    width: 68,
    minScale: 0.76
  });

  const renderHudNumbers = () => {
    app.message.setLines("gamehud-left", [
      `score: ${state.score}`,
      `combo: ${state.combo}`
    ], {
      anchor: "top-left",
      x: 0,
      y: 5,
      color: [1.0, 0.95, 0.72]
    });
    app.message.setLines("gamehud-right", [
      `time: ${Math.max(0.0, state.timeLeft).toFixed(1)}`
    ], {
      anchor: "top-right",
      x: -1,
      y: 0,
      color: [0.92, 0.97, 1.0]
    });
  };

  gsm.addState({
    id: "play",
    onEnter: () => {
      state.phaseHint = "play";
      resetRound();
      renderHudNumbers();
      app.pushToast("Use arrows or touch to move");
    },
    onUpdate: ({ context }) => {
      const nowMs = Number.isFinite(context?.nowMs) ? context.nowMs : performance.now();
      targetNode.rotateY(18.0 * Math.max(0.0, Number(context?.deltaSec ?? 0)));
      targetNode.setPosition(state.targetX, 0.0, Math.sin(nowMs * 0.0024) * 0.25);
    },
    transitions: [
      {
        to: "pause",
        priority: 10,
        test: (ctx) => ctx.pausePressed === true
      },
      {
        to: "play",
        test: (ctx) => ctx.startPressed === true
      },
      {
        to: "result",
        test: (ctx) => ctx.timeLeft <= 0.0 || ctx.score >= 300
      }
    ]
  });

  gsm.addState({
    id: "pause",
    onEnter: () => {
      state.phaseHint = "pause";
      app.pushToast("Paused");
    },
    transitions: [
      {
        to: "play",
        test: (ctx) => ctx.startPressed === true
      },
      {
        to: "play",
        test: (ctx) => ctx.pausePressed === true
      },
      {
        to: "play",
        test: (ctx) => ctx.resetPressed === true
      }
    ]
  });

  gsm.addState({
    id: "result",
    onEnter: () => {
      state.phaseHint = "result";
      renderHudNumbers();
      app.pushToast(`Result ${state.score} pts`);
    },
    transitions: [
      {
        to: "play",
        test: (ctx) => ctx.resetPressed === true
      }
    ]
  });

  setGamePhase("play", { force: true });
  app.message.setLines("status", [
    `phase: ${state.phaseHint}`,
    "goal: score 300 or survive until time out",
    "collision: player sphere vs target sphere"
  ], {
    x: 0,
    y: 5,
    color: [1.0, 0.88, 0.72]
  });

  const updateStatus = () => {
    const phase = gsm.currentStateId ?? state.phaseHint;
    writeStatus([
      "unittest/game_api",
      `phase: ${phase}`,
      `score: ${state.score}`,
      `combo: ${state.combo}`,
      `timeLeft: ${state.timeLeft.toFixed(1)}`,
      `playerX: ${state.playerX.toFixed(2)} targetX: ${state.targetX.toFixed(2)}`
    ]);
  };

  const phaseKey = (name) => app.wasActionPressed(name) === true;
  const isMoveLeft = () => app.input?.has?.("left") || app.input?.has?.("arrowleft") || app.input?.has?.("a");
  const isMoveRight = () => app.input?.has?.("right") || app.input?.has?.("arrowright") || app.input?.has?.("d");

  app.start({
    onUpdate: () => {
      const nowMs = performance.now();
      const deltaSec = clamp(app.elapsedSec, 0.0, 0.033);
      const currentPhase = gsm.currentStateId ?? "title";

      const context = {
        nowMs,
        deltaSec,
        startPressed: phaseKey("start"),
        pausePressed: phaseKey("pause"),
        resetPressed: phaseKey("reset"),
        score: state.score,
        timeLeft: state.timeLeft
      };
      gsm.update(context);
      syncScenePhase();

      const phase = gsm.currentStateId ?? currentPhase;
      if (phase !== "play" && phaseKey("start")) {
        setGamePhase("play", { force: true });
      }
      if (phaseKey("reset")) {
        setGamePhase("play", { force: true });
      }
      const livePhase = gsm.currentStateId ?? currentPhase;
      if (livePhase === "play") {
        if (isMoveLeft()) {
          state.playerX -= 18.0 * deltaSec;
        }
        if (isMoveRight()) {
          state.playerX += 18.0 * deltaSec;
        }
        state.playerX = clamp(state.playerX, -9.0, 9.0);
        state.timeLeft = Math.max(0.0, state.timeLeft - deltaSec);

        if (state.combo > 0 && state.lastHitMs > 0 && (nowMs - state.lastHitMs) > 1400) {
          state.combo = 0;
        }

        playerNode.setPosition(state.playerX, 0.0, 0.0);
        playerNode.setAttitude(0.0, 0.0, 0.0);
        targetNode.rotateY(20.0 * deltaSec);
        targetNode.setPosition(state.targetX, 0.0, Math.sin(nowMs * 0.0024) * 0.35);

        const collisions = space.stepCollisions(deltaSec * 1000.0, {
          filter: (entry) => entry.idA === "player" || entry.idB === "player"
        });
        for (let i = 0; i < collisions.enter.length; i++) {
          const collision = collisions.enter[i];
          const ids = [collision.idA, collision.idB];
          if (ids.includes("player") && ids.includes("target")) {
            state.score += 100;
            state.combo += 1;
            state.lastHitMs = nowMs;
            state.timeLeft = Math.min(30.0, state.timeLeft + 1.5);
            renderHudNumbers();
            app.pushToast(`hit +100  combo ${state.combo}`);
            placeTarget(state.playerX);
          }
        }

        renderHudNumbers();
      } else if (livePhase === "pause") {
        renderHudNumbers();
      } else if (livePhase === "result") {
        renderHudNumbers();
      }

      app.message.setLines("status", [
        `phase: ${livePhase}`,
        `score: ${state.score}  combo: ${state.combo}  time: ${state.timeLeft.toFixed(1)}`,
        `left=${isMoveLeft() ? 1 : 0} right=${isMoveRight() ? 1 : 0} a=${app.input?.has?.("a") ? 1 : 0} d=${app.input?.has?.("d") ? 1 : 0} start=${phaseKey("start") ? 1 : 0} pause=${phaseKey("pause") ? 1 : 0} reset=${phaseKey("reset") ? 1 : 0}`
      ], {
        x: 0,
        y: 5,
        color: [1.0, 0.88, 0.72]
      });
      updateStatus();
      return false;
    }
  });
};

document.addEventListener("DOMContentLoaded", () => {
  start().catch((err) => {
    console.error(err);
    const statusEl = document.getElementById("status");
    if (statusEl) {
      statusEl.textContent = `start failed:\n${err?.message ?? err}`;
    }
  });
});
