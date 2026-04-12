// ---------------------------------------------
// main.js       2026/04/10
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
//
// breakout sample
// ---------------------------------------------

import WebgApp from "../../webg/WebgApp.js";
import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";
import GameStateManager from "../GameStateManager.js";

const BOARD = {
  left: -9.4,
  right: 9.4,
  top: 11.4,
  bottom: -11.2
};

const PADDLE = {
  width: 4.8,
  height: 0.7,
  depth: 1.0,
  y: -9.0,
  speed: 14.5
};

const BALL = {
  radius: 0.55,
  speed: 9.4
};

const BRICK = {
  width: 2.0,
  height: 0.9,
  depth: 1.0,
  rows: 5,
  cols: 7,
  gapX: 0.32,
  gapY: 0.28,
  originY: 5.3
};

const GAME_TIME_LIMIT = 90.0;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const makeBox = (centerX, centerY, width, height) => ({
  minx: centerX - width * 0.5,
  maxx: centerX + width * 0.5,
  miny: centerY - height * 0.5,
  maxy: centerY + height * 0.5
});

const circleIntersectsBox = (cx, cy, radius, box) => {
  const closestX = clamp(cx, box.minx, box.maxx);
  const closestY = clamp(cy, box.miny, box.maxy);
  const dx = cx - closestX;
  const dy = cy - closestY;
  return (dx * dx + dy * dy) <= radius * radius;
};

const createBoxShape = (gpu, width, height, depth, color, material = {}) => {
  // breakout の 2D 盤面に合わせて、任意寸法の箱を 1 つ作る
  // `Primitive.cube()` は正方体向けなので、パドルや壁のような長方形は
  // ここで直接メッシュを組んでおくと読みやすい
  const shape = new Shape(gpu);
  const hx = width * 0.5;
  const hy = height * 0.5;
  const hz = depth * 0.5;

  const addFace = (points) => {
    const [p0, p1, p2] = points;
    const ux = p1[0] - p0[0];
    const uy = p1[1] - p0[1];
    const uz = p1[2] - p0[2];
    const vx = p2[0] - p0[0];
    const vy = p2[1] - p0[1];
    const vz = p2[2] - p0[2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const cx = (points[0][0] + points[1][0] + points[2][0] + points[3][0]) * 0.25;
    const cy = (points[0][1] + points[1][1] + points[2][1] + points[3][1]) * 0.25;
    const cz = (points[0][2] + points[1][2] + points[2][2] + points[3][2]) * 0.25;
    const outward = nx * cx + ny * cy + nz * cz;
    const ordered = outward >= 0.0 ? points : [...points].reverse();
    const indices = [];
    for (let i = 0; i < ordered.length; i++) {
      const p = ordered[i];
      indices.push(shape.addVertex(p[0], p[1], p[2]) - 1);
    }
    shape.addPlane(indices);
  };

  addFace([
    [-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]
  ]);
  addFace([
    [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz], [hx, -hy, -hz]
  ]);
  addFace([
    [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz], [hx, -hy, hz]
  ]);
  addFace([
    [-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]
  ]);
  addFace([
    [-hx, hy, -hz], [-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz]
  ]);
  addFace([
    [-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]
  ]);

  shape.endShape();
  shape.setMaterial("smooth-shader", {
    has_bone: 0,
    use_texture: 0,
    color: [...color],
    ambient: material.ambient ?? 0.22,
    specular: material.specular ?? 0.62,
    power: material.power ?? 34.0,
    emissive: material.emissive ?? 0.0
  });
  return shape;
};

const createBallShape = (gpu) => {
  const shape = new Shape(gpu);
  shape.applyPrimitiveAsset(Primitive.sphere(BALL.radius, 18, 24, shape.getPrimitiveOptions()));
  shape.endShape();
  shape.setMaterial("smooth-shader", {
    has_bone: 0,
    use_texture: 0,
    color: [0.98, 0.99, 1.0, 1.0],
    ambient: 0.16,
    specular: 1.18,
    power: 92.0
  });
  shape.setCollisionShape({
    type: "sphere",
    radius: BALL.radius,
    center: [0.0, 0.0, 0.0]
  });
  return shape;
};

const createWallShape = (gpu, width, height, depth, color, collisionShape) => {
  const shape = createBoxShape(gpu, width, height, depth, color, {
    ambient: 0.18,
    specular: 0.34,
    power: 20.0
  });
  shape.setCollisionShape(collisionShape);
  return shape;
};

const createBrickShape = (gpu, color) => {
  const shape = createBoxShape(gpu, BRICK.width, BRICK.height, BRICK.depth, color, {
    ambient: 0.28,
    specular: 0.84,
    power: 48.0
  });
  shape.setCollisionShape({
    type: "aabb",
    box: {
      minx: -BRICK.width * 0.5,
      maxx: BRICK.width * 0.5,
      miny: -BRICK.height * 0.5,
      maxy: BRICK.height * 0.5,
      minz: -BRICK.depth * 0.5,
      maxz: BRICK.depth * 0.5
    }
  });
  return shape;
};

const createPaddleShape = (gpu) => {
  const shape = createBoxShape(gpu, PADDLE.width, PADDLE.height, PADDLE.depth, [1.0, 0.54, 0.18, 1.0], {
    ambient: 0.18,
    specular: 1.06,
    power: 78.0
  });
  shape.setCollisionShape({
    type: "aabb",
    box: {
      minx: -PADDLE.width * 0.5,
      maxx: PADDLE.width * 0.5,
      miny: -PADDLE.height * 0.5,
      maxy: PADDLE.height * 0.5,
      minz: -PADDLE.depth * 0.5,
      maxz: PADDLE.depth * 0.5
    }
  });
  return shape;
};

const createBackdropShape = (gpu) => {
  const shape = createBoxShape(gpu, 22.4, 25.0, 0.7, [0.11, 0.13, 0.17, 1.0], {
    ambient: 0.10,
    specular: 0.20,
    power: 10.0
  });
  return shape;
};

const colorPalette = [
  [0.98, 0.40, 0.34, 1.0],
  [0.98, 0.65, 0.28, 1.0],
  [0.98, 0.84, 0.30, 1.0],
  [0.38, 0.86, 0.40, 1.0],
  [0.30, 0.78, 0.98, 1.0]
];

const start = async () => {
  const app = new WebgApp({
    document,
    clearColor: [0.05, 0.07, 0.11, 1.0],
    debugTools: {
      mode: "release",
      system: "breakout",
      source: "samples/breakout/main.js"
    },
    camera: {
      target: [0.0, 0.0, 0.0],
      distance: 34.0,
      yaw: 0.0,
      pitch: 0.0,
      bank: 0.0
    },
    light: {
      mode: "eye-fixed",
      position: [120.0, 150.0, 180.0, 1.0]
    },
    messageScale: 0.92
  });
  await app.init();

  const gpu = app.screen.getGL();
  const space = app.space;

  const state = {
    paddleX: 0.0,
    ballX: 0.0,
    ballY: 0.0,
    ballVx: 0.0,
    ballVy: 0.0,
    ballAttached: true,
    score: 0,
    combo: 0,
    lives: 3,
    timeLeft: GAME_TIME_LIMIT,
    bricksRemaining: 0,
    resultKind: "title",
    resultMessage: "Press Enter or Space to start",
    collisionGraceSec: 0.0
  };

  const gsm = new GameStateManager({
    initialState: "title"
  });

  const syncScenePhase = (phase = gsm.currentStateId ?? gsm.initialState ?? "title") => {
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

  const backdropNode = space.addNode(null, "backdrop");
  const backdropShape = createBackdropShape(gpu);
  backdropNode.addShape(backdropShape);
  backdropNode.setPosition(0.0, 0.0, -0.9);

  const leftWallNode = space.addNode(null, "wall_left");
  const leftWallShape = createWallShape(
    gpu,
    0.45,
    24.0,
    1.0,
    [0.18, 0.23, 0.30, 1.0],
    {
      type: "aabb",
      box: {
        minx: -0.225,
        maxx: 0.225,
        miny: -12.0,
        maxy: 12.0,
        minz: -0.5,
        maxz: 0.5
      }
    }
  );
  leftWallNode.addShape(leftWallShape);
  leftWallNode.setPosition(BOARD.left - 0.4, 0.0, 0.0);

  const rightWallNode = space.addNode(null, "wall_right");
  const rightWallShape = createWallShape(
    gpu,
    0.45,
    24.0,
    1.0,
    [0.18, 0.23, 0.30, 1.0],
    {
      type: "aabb",
      box: {
        minx: -0.225,
        maxx: 0.225,
        miny: -12.0,
        maxy: 12.0,
        minz: -0.5,
        maxz: 0.5
      }
    }
  );
  rightWallNode.addShape(rightWallShape);
  rightWallNode.setPosition(BOARD.right + 0.4, 0.0, 0.0);

  const topWallNode = space.addNode(null, "wall_top");
  const topWallShape = createWallShape(
    gpu,
    19.6,
    0.45,
    1.0,
    [0.20, 0.25, 0.34, 1.0],
    {
      type: "aabb",
      box: {
        minx: -9.8,
        maxx: 9.8,
        miny: -0.225,
        maxy: 0.225,
        minz: -0.5,
        maxz: 0.5
      }
    }
  );
  topWallNode.addShape(topWallShape);
  topWallNode.setPosition(0.0, BOARD.top + 0.45, 0.0);

  const floorNode = space.addNode(null, "floor_sensor");
  const floorShape = createWallShape(
    gpu,
    19.6,
    0.45,
    1.0,
    [0.0, 0.0, 0.0, 0.0],
    {
      type: "aabb",
      box: {
        minx: -9.8,
        maxx: 9.8,
        miny: -0.225,
        maxy: 0.225,
        minz: -0.5,
        maxz: 0.5
      }
    }
  );
  floorNode.addShape(floorShape);
  floorNode.setPosition(0.0, BOARD.bottom - 1.0, 0.0);

  const paddleNode = space.addNode(null, "paddle");
  const paddleShape = createPaddleShape(gpu);
  paddleNode.addShape(paddleShape);
  paddleNode.setPosition(state.paddleX, PADDLE.y, 0.0);

  const ballNode = space.addNode(null, "ball");
  const ballShape = createBallShape(gpu);
  ballNode.addShape(ballShape);
  ballNode.setPosition(0.0, PADDLE.y + 1.0, 0.0);

  const brickRows = [];
  const totalBrickWidth = BRICK.cols * BRICK.width + (BRICK.cols - 1) * BRICK.gapX;
  const leftBrickX = -totalBrickWidth * 0.5 + BRICK.width * 0.5;

  for (let row = 0; row < BRICK.rows; row++) {
    for (let col = 0; col < BRICK.cols; col++) {
      const x = leftBrickX + col * (BRICK.width + BRICK.gapX);
      const y = BRICK.originY + row * (BRICK.height + BRICK.gapY);
      const node = space.addNode(null, `brick_${row}_${col}`);
      const shape = createBrickShape(gpu, colorPalette[row % colorPalette.length]);
      node.addShape(shape);
      node.setPosition(x, y, 0.0);
      space.addCollisionBody(node, {
        id: `brick_${row}_${col}`,
        tag: "brick"
      });
      brickRows.push({
        id: `brick_${row}_${col}`,
        node,
        row,
        col,
        x,
        y,
        alive: true
      });
    }
  }

  space.addCollisionBody(paddleNode, {
    id: "paddle",
    tag: "paddle"
  });
  space.addCollisionBody(ballNode, {
    id: "ball",
    tag: "ball"
  });
  space.addCollisionBody(leftWallNode, {
    id: "wall_left",
    tag: "wall-left"
  });
  space.addCollisionBody(rightWallNode, {
    id: "wall_right",
    tag: "wall-right"
  });
  space.addCollisionBody(topWallNode, {
    id: "wall_top",
    tag: "wall-top"
  });
  space.addCollisionBody(floorNode, {
    id: "floor_sensor",
    tag: "floor"
  });

  app.registerActionMap({
    left: ["arrowleft", "a"],
    right: ["arrowright", "d"],
    launch: ["enter", "space"],
    pause: ["p", "escape"],
    restart: ["r"]
  });

  const touchRoot = app.input.installTouchControls({
    touchDeviceOnly: false,
    className: "webg-touch-root breakout-touch-root",
    groups: [
      {
        id: "move",
        buttons: [
          { key: "arrowleft", label: "←", kind: "hold", ariaLabel: "move paddle left" },
          { key: "arrowright", label: "→", kind: "hold", ariaLabel: "move paddle right" }
        ]
      },
      {
        id: "action",
        buttons: [
          { key: "launch", label: "Start", kind: "action", ariaLabel: "launch ball" },
          { key: "pause", label: "Pause", kind: "action", ariaLabel: "pause game" },
          { key: "restart", label: "R", kind: "action", ariaLabel: "restart game" }
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
    const btns = touchRoot.querySelectorAll(".webg-touch-btn");
    for (let i = 0; i < btns.length; i++) {
      const btn = btns[i];
      btn.style.width = "68px";
      btn.style.height = "68px";
    }
  }

  app.setGuideLines([
    "breakout sample",
    "Enter / Space: launch or resume",
    "P / Esc: pause",
    "R: restart after clear or game over"
  ], {
    x: 0,
    y: 0,
    color: [0.90, 0.95, 1.0]
  });

  app.setControlRows([
    {
      label: "move",
      value: "paddle",
      keys: [
        { key: "ArrowLeft / A", action: "move left" },
        { key: "ArrowRight / D", action: "move right" }
      ],
      note: "touch buttons mirror the same hold input"
    },
    {
      label: "flow",
      value: "state machine",
      keys: [
        { key: "Enter / Space", action: "start / resume / launch" },
        { key: "P / Esc", action: "pause" },
        { key: "R", action: "return to title after result" }
      ],
      note: "title / play / pause / result"
    },
    {
      label: "collision",
      value: "Space helper",
      keys: [
        { key: "sphere", action: "ball" },
        { key: "aabb", action: "paddle / walls / bricks" }
      ],
      note: "enter collisions decide bounce, score, and life loss"
    }
  ], {
    anchor: "bottom-left",
    x: 0,
    y: -2,
    color: [0.88, 0.96, 1.0],
    gap: 1,
    width: 72,
    minScale: 0.76
  });

  const resetLevel = () => {
    state.paddleX = 0.0;
    state.ballX = 0.0;
    state.ballY = PADDLE.y + PADDLE.height * 0.5 + BALL.radius + 0.05;
    state.ballVx = 0.0;
    state.ballVy = 0.0;
    state.ballAttached = true;
    state.score = 0;
    state.combo = 0;
    state.lives = 3;
    state.timeLeft = GAME_TIME_LIMIT;
    state.bricksRemaining = brickRows.length;
    state.resultKind = "title";
    state.resultMessage = "Press Enter or Space to start";
    state.collisionGraceSec = 0.0;
    for (let i = 0; i < brickRows.length; i++) {
      const brick = brickRows[i];
      brick.alive = true;
      brick.node.hide(false);
      brick.node.setPosition(brick.x, brick.y, 0.0);
    }
    paddleNode.setPosition(0.0, PADDLE.y, 0.0);
    ballNode.setPosition(state.ballX, state.ballY, 0.0);
    app.clearGameHud();
    app.setScore(state.score);
    app.setCombo(state.combo);
    app.setTimer(state.timeLeft);
    app.pushToast("Breakout ready", {
      id: "breakout-ready",
      durationMs: 1200,
      anchor: "bottom-center"
    });
  };

  const serveBall = () => {
    const launchX = clamp(state.paddleX * 0.20, -1.2, 1.2);
    const launchY = 1.0;
    const len = Math.sqrt(launchX * launchX + launchY * launchY) || 1.0;
    const speed = BALL.speed;
    state.ballVx = (launchX / len) * speed;
    state.ballVy = (launchY / len) * speed;
    state.ballAttached = false;
    state.collisionGraceSec = 0.16;
    app.pushToast("Ball in play", {
      id: "breakout-serve",
      durationMs: 700,
      anchor: "bottom-center"
    });
  };

  const attachBallToPaddle = () => {
    state.ballAttached = true;
    state.ballVx = 0.0;
    state.ballVy = 0.0;
    state.ballX = state.paddleX;
    state.ballY = PADDLE.y + PADDLE.height * 0.5 + BALL.radius + 0.05;
    state.collisionGraceSec = 0.0;
    ballNode.setPosition(state.ballX, state.ballY, 0.0);
  };

  const setResult = (kind, message) => {
    state.resultKind = kind;
    state.resultMessage = message;
    setGamePhase("result", {
      force: true,
      context: {
        resultKind: kind,
        resultMessage: message
      }
    });
  };

  const resetAfterLifeLost = () => {
    state.combo = 0;
    app.setCombo(state.combo);
    attachBallToPaddle();
    app.pushToast(`Lives left: ${state.lives}`, {
      id: "breakout-life",
      durationMs: 900,
      anchor: "bottom-center"
    });
  };

  gsm.addState({
    id: "title",
    onEnter: () => {
      resetLevel();
    },
    transitions: [
      {
        to: "play",
        label: "launch",
        test: (context) => context.launchPressed === true
      }
    ]
  });

  gsm.addState({
    id: "play",
    onEnter: (info) => {
      if (info?.context?.scenePhase === "pause") {
        return;
      }
      if (info?.context?.scenePhase === "play") {
        return;
      }
      attachBallToPaddle();
      serveBall();
    },
    transitions: [
      {
        to: "pause",
        label: "pause",
        test: (context) => context.pausePressed === true
      },
      {
        to: "result",
        label: "clear",
        test: () => state.bricksRemaining <= 0 || state.timeLeft <= 0.0 || state.lives <= 0
      }
    ]
  });

  gsm.addState({
    id: "pause",
    onEnter: () => {
      app.pushToast("Paused", {
        id: "breakout-pause",
        durationMs: 900,
        anchor: "bottom-center"
      });
    },
    transitions: [
      {
        to: "play",
        label: "resume",
        test: (context) => context.launchPressed === true || context.pausePressed === true
      }
    ]
  });

  gsm.addState({
    id: "result",
    onEnter: (info) => {
      const kind = info?.context?.resultKind ?? state.resultKind;
      const message = info?.context?.resultMessage ?? state.resultMessage;
      state.resultKind = kind;
      state.resultMessage = message;
      state.ballAttached = true;
      state.ballVx = 0.0;
      state.ballVy = 0.0;
      app.pushToast(message, {
        id: "breakout-result",
        durationMs: 1800,
        anchor: "bottom-center"
      });
    },
    transitions: [
      {
        to: "title",
        label: "restart",
        test: (context) => context.restartPressed === true
      }
    ]
  });

  syncScenePhase("title");

  const movePaddle = (dt) => {
    const left = app.getAction("left");
    const right = app.getAction("right");
    let dir = 0.0;
    if (left) dir -= 1.0;
    if (right) dir += 1.0;
    const nextX = clamp(state.paddleX + dir * PADDLE.speed * dt, BOARD.left + PADDLE.width * 0.5, BOARD.right - PADDLE.width * 0.5);
    state.paddleX = nextX;
    paddleNode.setPosition(state.paddleX, PADDLE.y, 0.0);
    if (state.ballAttached) {
      attachBallToPaddle();
    }
  };

  const bounceBallOnWall = (wallId) => {
    if (wallId === "wall_left") {
      state.ballX = BOARD.left + BALL.radius + 0.36;
      state.ballVx = Math.abs(state.ballVx);
    } else if (wallId === "wall_right") {
      state.ballX = BOARD.right - BALL.radius - 0.36;
      state.ballVx = -Math.abs(state.ballVx);
    } else if (wallId === "wall_top") {
      state.ballY = BOARD.top - BALL.radius - 0.36;
      state.ballVy = -Math.abs(state.ballVy);
    }
  };

  const bounceBallOnPaddle = () => {
    const offset = clamp((state.ballX - state.paddleX) / (PADDLE.width * 0.5), -1.0, 1.0);
    const vx = offset * BALL.speed * 0.90;
    const vy = BALL.speed * 0.92;
    const len = Math.sqrt(vx * vx + vy * vy) || 1.0;
    state.ballVx = (vx / len) * BALL.speed;
    state.ballVy = (vy / len) * BALL.speed;
    state.ballY = PADDLE.y + PADDLE.height * 0.5 + BALL.radius + 0.04;
    state.combo = 0;
    app.setCombo(state.combo);
    app.pushToast(offset < -0.45
      ? "Left edge"
      : offset > 0.45
        ? "Right edge"
        : "Center bounce", {
      id: "breakout-paddle",
      durationMs: 650,
      anchor: "bottom-center"
    });
  };

  const hitBrick = (brick) => {
    if (!brick || brick.alive === false) return;
    brick.alive = false;
    brick.node.hide(true);
    state.bricksRemaining = Math.max(0, state.bricksRemaining - 1);
    state.combo += 1;
    state.score += 100 + Math.min(5, state.combo - 1) * 20;
    app.setScore(state.score);
    app.setCombo(state.combo);
    app.pushToast(`Brick +${100 + Math.min(5, state.combo - 1) * 20}`, {
      id: `brick-hit-${brick.id}`,
      durationMs: 700,
      anchor: "bottom-center"
    });
    const dx = state.ballX - brick.x;
    const dy = state.ballY - brick.y;
    if (Math.abs(dx) >= Math.abs(dy)) {
      state.ballVx = dx >= 0.0 ? Math.abs(state.ballVx) : -Math.abs(state.ballVx);
      state.ballX = brick.x + Math.sign(dx || 1.0) * (BRICK.width * 0.5 + BALL.radius + 0.04);
    } else {
      state.ballVy = dy >= 0.0 ? Math.abs(state.ballVy) : -Math.abs(state.ballVy);
      state.ballY = brick.y + Math.sign(dy || 1.0) * (BRICK.height * 0.5 + BALL.radius + 0.04);
    }
    if (state.bricksRemaining <= 0) {
      setResult("clear", "Stage clear");
    }
  };

  const handleCollisions = () => {
    const floorHit = (state.ballY - BALL.radius) <= BOARD.bottom;
    const paddleBox = makeBox(state.paddleX, PADDLE.y, PADDLE.width, PADDLE.height);
    const paddleHit = circleIntersectsBox(state.ballX, state.ballY, BALL.radius, paddleBox);
    const wallHits = [];
    if ((state.ballX - BALL.radius) <= BOARD.left) wallHits.push("wall_left");
    if ((state.ballX + BALL.radius) >= BOARD.right) wallHits.push("wall_right");
    if ((state.ballY + BALL.radius) >= BOARD.top) wallHits.push("wall_top");
    const brickHits = [];
    for (let i = 0; i < brickRows.length; i++) {
      const brick = brickRows[i];
      if (!brick.alive) continue;
      const brickBox = makeBox(brick.x, brick.y, BRICK.width, BRICK.height);
      if (circleIntersectsBox(state.ballX, state.ballY, BALL.radius, brickBox)) {
        brickHits.push(brick);
        break;
      }
    }

    if (floorHit) {
      state.lives -= 1;
      state.combo = 0;
      app.setCombo(state.combo);
      app.pushToast("Miss", {
        id: "breakout-miss",
        durationMs: 900,
        anchor: "bottom-center"
      });
      if (state.lives <= 0) {
        setResult("gameover", "Game over");
        return;
      }
      resetAfterLifeLost();
      return;
    }

    if (paddleHit) {
      bounceBallOnPaddle();
      return;
    }

    if (brickHits.length > 0) {
      hitBrick(brickHits[0]);
      return;
    }

    if (wallHits.length > 0) {
      bounceBallOnWall(wallHits[0]);
    }
  };

  const moveBallAndResolve = (dt) => {
    const totalDistance = Math.hypot(state.ballVx * dt, state.ballVy * dt);
    const steps = Math.max(1, Math.ceil(totalDistance / 0.12));
    const stepDt = dt / steps;
    for (let i = 0; i < steps; i++) {
      state.ballX += state.ballVx * stepDt;
      state.ballY += state.ballVy * stepDt;
      ballNode.setPosition(state.ballX, state.ballY, 0.0);
      if (state.collisionGraceSec <= 0.0) {
        handleCollisions();
        ballNode.setPosition(state.ballX, state.ballY, 0.0);
        if (state.ballAttached || gsm.currentStateId !== "play") {
          break;
        }
        if ((state.ballX - BALL.radius) <= BOARD.left) {
          state.ballX = BOARD.left + BALL.radius + 0.01;
          state.ballVx = Math.abs(state.ballVx);
          ballNode.setPosition(state.ballX, state.ballY, 0.0);
        }
        if ((state.ballX + BALL.radius) >= BOARD.right) {
          state.ballX = BOARD.right - BALL.radius - 0.01;
          state.ballVx = -Math.abs(state.ballVx);
          ballNode.setPosition(state.ballX, state.ballY, 0.0);
        }
        if ((state.ballY + BALL.radius) >= BOARD.top) {
          state.ballY = BOARD.top - BALL.radius - 0.01;
          state.ballVy = -Math.abs(state.ballVy);
          ballNode.setPosition(state.ballX, state.ballY, 0.0);
        }
      }
    }
  };

  const updateHud = () => {
    app.setScore(state.score);
    app.setCombo(state.combo);
    app.setTimer(Math.max(0.0, state.timeLeft));
    app.setStatusLines([
      `phase: ${gsm.currentStateId ?? "title"}`,
      `result: ${state.resultKind}`,
      `lives: ${state.lives}  bricks: ${state.bricksRemaining}`,
      `ball: ${state.ballAttached ? "attached" : "live"}  speed: ${Math.hypot(state.ballVx, state.ballVy).toFixed(2)}`
    ], {
      anchor: "top-left",
      x: 0,
      y: 4,
      color: [0.94, 0.97, 1.0]
    });

    const statusEl = document.getElementById("status");
    if (statusEl) {
      statusEl.textContent = [
        `phase: ${gsm.currentStateId ?? "title"}`,
        `result: ${state.resultKind}`,
        `score: ${state.score}  combo: ${state.combo}`,
        `lives: ${state.lives}  time: ${Math.ceil(state.timeLeft)}`,
        `ball: ${state.ballAttached ? "attached" : "live"}`
      ].join("\n");
    }
  };

  app.start({
    onUpdate: (ctx) => {
      const dt = clamp(ctx.deltaSec || 0.0, 0.0, 0.033);
      const launchRequested = app.wasActionPressed("launch");
      const pauseRequested = app.wasActionPressed("pause");
      const restartRequested = app.wasActionPressed("restart");

      gsm.setVariables({
        bricksRemaining: state.bricksRemaining,
        lives: state.lives,
        timeLeft: state.timeLeft,
        resultKind: state.resultKind,
        resultMessage: state.resultMessage
      });
      gsm.update({
        ...ctx,
        launchPressed: launchRequested,
        pausePressed: pauseRequested,
        restartPressed: restartRequested
      }, dt * 1000.0);
      syncScenePhase();

      if (gsm.currentStateId === "play") {
        if (state.timeLeft > 0.0) {
          state.timeLeft = Math.max(0.0, state.timeLeft - dt);
        }
        if (state.collisionGraceSec > 0.0) {
          state.collisionGraceSec = Math.max(0.0, state.collisionGraceSec - dt);
        }
        movePaddle(dt);

        if (state.ballAttached) {
          attachBallToPaddle();
          if (launchRequested) {
            serveBall();
          }
        } else {
          moveBallAndResolve(dt);
        }

        if (state.timeLeft <= 0.0 && gsm.currentStateId === "play") {
          setResult("gameover", "Time up");
        } else if (state.bricksRemaining <= 0 && gsm.currentStateId === "play") {
          setResult("clear", "Stage clear");
        }
      } else if (gsm.currentStateId === "pause") {
        movePaddle(dt);
      } else if (gsm.currentStateId === "title") {
        movePaddle(dt);
      } else if (gsm.currentStateId === "result") {
        state.ballAttached = true;
        ballNode.setPosition(state.paddleX, PADDLE.y + PADDLE.height * 0.5 + BALL.radius + 0.05, 0.0);
      }

      updateHud();
      return false;
    }
  });
};

document.addEventListener("DOMContentLoaded", () => {
  start().catch((err) => {
    console.error("breakout failed:", err);
    const hud = document.getElementById("status");
    if (hud) {
      hud.textContent = `breakout failed\n${err?.message ?? err}`;
    }
  });
}, false);
