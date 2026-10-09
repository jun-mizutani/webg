// ---------------------------------------------
// unittest/game_api/main.js  2026/10/04
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
// GameStateManager : play / pause / result の場面遷移を扱う
// Shape            : 描画メッシュと collision shape を同時に保持する
// Primitive         : デモ用 cube mesh を簡単に生成する

// 更新量を上下限へ収め、操作と物理表示を一定の範囲に保つ
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// 指定した範囲から乱数を選び、targetの配置候補を作る
const randRange = (min, max) => min + Math.random() * (max - min);

// 立方体メッシュと単色材質を作り、移動や接触を追いやすい比較対象にする
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

// 比較用の床メッシュと単色材質を準備し、物体の位置を読む基準面にする
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

// 入力と衝突形状を持つ小さなゲームを準備し、停止・復帰・新規ラウンドの状態を確認する
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

  const gpu = app.screen.getGPU();
  const space = app.space;
  const statusEl = document.getElementById("status");
  // 数値と状態を行ごとにまとめ、検証用のDOM結果欄へ表示する
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

  // 状態機械の現在状態をWebgAppのscene phaseへ反映し、更新状態の表示を揃える
  const syncScenePhase = (phase = gsm.currentStateId ?? gsm.initialState ?? state.phaseHint) => {
    app.setScenePhase(phase, {
      force: true
    });
    return phase;
  };

  // 状態機械を指定の状態へ遷移させ、WebgAppのscene phaseも同期する
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

  // playerとの距離が4以上になる候補を選び、次の接触開始を確認するtarget位置にする
  const placeTarget = (avoidX = 0.0) => {
    let nextX = randRange(-9.0, 9.0);
    while (Math.abs(nextX - avoidX) < 4.0) {
      nextX = randRange(-9.0, 9.0);
    }
    state.targetX = nextX;
    targetNode.setPosition(state.targetX, 0.0, 0.0);
  };

  // 得点・combo・時間・位置を初期化し、新しいラウンドの開始条件を揃える
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
    "R / Reset: start a new round"
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
      note: "play / pause / result"
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

  // 現在の得点とcomboを左側、残り時間を右側のHUDへ反映する
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
      // play への復帰では、停止直前の得点・残り時間・配置を引き継ぐ
      state.phaseHint = "play";
      renderHudNumbers();
      app.pushToast("Use arrows or touch to move");
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

  // 初回の開始ではラウンドを準備し、その後に状態とHUDを同期する
  resetRound();
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

  // 現在のゲーム状態と数値を結果欄へ反映し、停止・復帰時の値を確認できるようにする
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

  // actionの押下開始を読み取り、状態遷移を1回の入力として扱う
  const phaseKey = (name) => app.wasActionPressed(name) === true;

  // keyboardとtouchの左方向のhold状態をまとめて取得する
  const isMoveLeft = () => app.input?.has?.("left") || app.input?.has?.("arrowleft") || app.input?.has?.("a");

  // keyboardとtouchの右方向のhold状態をまとめて取得する
  const isMoveRight = () => app.input?.has?.("right") || app.input?.has?.("arrowright") || app.input?.has?.("d");

  app.start({
    onUpdate: () => {
      const nowMs = performance.now();
      const deltaSec = clamp(app.elapsedSec, 0.0, 0.033);
      const currentPhase = gsm.currentStateId ?? "play";

      const context = {
        nowMs,
        deltaSec,
        startPressed: phaseKey("start"),
        pausePressed: phaseKey("pause"),
        resetPressed: phaseKey("reset"),
        score: state.score,
        timeLeft: state.timeLeft
      };
      // Resetと結果画面のStartは新しいラウンドを開始する
      // pauseからの復帰は状態機械の遷移だけで扱い、ゲーム状態を保持する
      if (context.resetPressed || (currentPhase === "result" && context.startPressed)) {
        resetRound();
        setGamePhase("play", { force: true });
      } else {
        gsm.update(context);
        syncScenePhase();
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

        // stepCollisions は描画用 Space に置いた collision shape 同士の重なりを調べる
        // playerを含むcollisionを抽出し、playerとtargetの接触開始を得点へ接続する
        const collisions = space.stepCollisions(deltaSec * 1000.0, {
          filter: (entry) => entry.idA === "player" || entry.idB === "player"
        });
        // enter は前 frame では重なっておらず、この frame で新しく重なった collision だけを表す
        // 接触中ずっと加点すると score が毎 frame 増えるため、開始時だけを使う
        for (let i = 0; i < collisions.enter.length; i++) {
          const collision = collisions.enter[i];
          const ids = [collision.idA, collision.idB];
          // idAとidBの両方を調べ、playerとtargetの組をhitとして扱う
          // collision pair の左右が入れ替わっても同じ判定になるようにする
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
