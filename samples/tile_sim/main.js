// -------------------------------------------------
// tile_sim sample
//   main.js       2026/04/24
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// -------------------------------------------------

import WebgApp from "../../webg/WebgApp.js";
import SceneAsset from "../../webg/SceneAsset.js";
import Matrix from "../../webg/Matrix.js";
import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";
import SmoothShader from "../../webg/SmoothShader.js";
import { resolveCameraRelativeGridMove } from "../../webg/TileMap.js";
import {
  FONT_FILE,
  MAP_WIDTH,
  MAP_HEIGHT,
  CELL_SIZE,
  BALL_RADIUS,
  BALL_LIFT,
  BALL_MOVE_DURATION_MS,
  ORBIT_PRESETS
} from "./constants.js";
import {
  createTerrainTexturePair,
  TILE_SIM_TERRAIN_TEXTURE_OPTIONS,
  buildTerrainMaterials,
  createSceneDefinition
} from "./terrain.js";
import { makeRayFromMouse } from "./camera.js";
import { createTileMapController } from "./controller.js";
import {
  createTileMapMissionRuntime,
  findStartCell
} from "./mission.js";
import { createTileSimAiAdvisor } from "./ai.js";
import { createTileSimSupportSquad } from "./support_units.js";
import { createTileSimEnemyScout } from "./enemy_units.js";
import { createTileSimDialogueDirector } from "./dialogue_flow.js";
import { createTileSimMinimapOverlay } from "./minimap_overlay.js";
import { createTileSimAlphaActor } from "./alpha_actor.js";

const HUMAN_CELL_FORMATION_RATIO = 0.10;
const HUMAN_GROUP_BACK_RATIO = 0.04;

// tile_sim sample の役割:
// - tile_game を複製した出発点として、TileMap の基礎構成を保ったまま strategy / simulation 系 sample を育てる
// - 現段階では beacon mission の土台を残しつつ、複数部隊、resource、敵監視の差分を重ねる
// - `title / play / result` は sample 側 helper で素直に切り替え、将来 phase や戦闘解決を増やす前の最小構成を追える形に保つ

// Alpha の移動土台として使う proxy ball を作る
// - 現在は human.glb を別 node で表示しているため、この ball は論理位置と tween の土台だけを担当する
// - geometry の詳細はここへ閉じ込め、main の起動手順は読み順を保つ
const createBallRig = (app) => {
  const ballShape = new Shape(app.getGL());
  ballShape.applyPrimitiveAsset(
    Primitive.sphere(BALL_RADIUS, 18, 18, ballShape.getPrimitiveOptions())
  );
  ballShape.endShape();
  ballShape.setMaterial("smooth-shader", {
    has_bone: 0,
    use_texture: 0,
    color: [1.0, 0.84, 0.82, 1.0],
    ambient: 0.34,
    specular: 0.92,
    power: 58.0
  });
  const ballNode = app.space.addNode(null, "ball");
  ballNode.addShape(ballShape);

  return {
    ballNode,
    ballShape
  };
};

// Alpha の現在状態を sample 側で保持する
// - まだ player 側 unit も軽量な object として扱い、AI advisor が actual unit 状態を読めるようにする
const createAlphaUnitState = (startCell) => {
  return {
    id: "alpha",
    label: "ALPHA",
    role: "frontline",
    control: "player",
    hp: 5,
    food: 4,
    arms: 3,
    cell: startCell,
    lastDecision: "PLAYER MOVE"
  };
};

// Alpha を mission start 時の初期値へ戻す
const resetAlphaUnitState = (alphaUnit, startCell) => {
  alphaUnit.food = 4;
  alphaUnit.arms = 3;
  alphaUnit.hp = 5;
  alphaUnit.cell = startCell;
  alphaUnit.lastDecision = "PLAYER READY";
};

// Alpha の現在 cell に応じて 1 turn 分の資源更新を行う
// - 高地は food / arms の維持が重く、低地は補給しやすいという tile_sim の基本方針を player 側にも反映する
const applyAlphaTurnStep = (alphaUnit) => {
  const height = Number.isFinite(alphaUnit?.cell?.height) ? Number(alphaUnit.cell.height) : 0;
  const band = height <= 1 ? "low" : height >= 4 ? "high" : "mid";
  let foodGain = band === "low" ? 2 : band === "mid" ? 1 : 0;
  let armsGain = band === "low" ? 1 : band === "mid" ? 1 : 0;
  let foodUpkeep = band === "high" ? 2 : 1;
  let armsUpkeep = band === "high" ? 1 : 0;
  alphaUnit.food = Math.max(0, alphaUnit.food - foodUpkeep + foodGain);
  alphaUnit.arms = Math.max(0, alphaUnit.arms - armsUpkeep + armsGain);
  alphaUnit.lastDecision = `PLAYER ${band.toUpperCase()} TURN`;
};

// sample 用の touch ボタン群を作る
// - PC でも表示して、keyboard が無い環境でも同じ action 名で試せるようにする
const installTouchControls = (app, handleKey) => {
  const touchRoot = app.input.installTouchControls({
    touchDeviceOnly: false,
    className: "webg-touch-root tile-map-touch-root",
    groups: [
      {
        id: "move",
        buttons: [
          { key: "arrowleft", label: "←", kind: "action", ariaLabel: "move alpha left" },
          { key: "arrowup", label: "↑", kind: "action", ariaLabel: "move alpha forward" },
          { key: "arrowdown", label: "↓", kind: "action", ariaLabel: "move alpha backward" },
          { key: "arrowright", label: "→", kind: "action", ariaLabel: "move alpha right" }
        ]
      },
      {
        id: "camera",
        buttons: [
          { key: "enter", label: "GO", kind: "action", ariaLabel: "start or retry mission" },
          { key: "1", label: "1", kind: "action", ariaLabel: "orbit preset 1" },
          { key: "2", label: "2", kind: "action", ariaLabel: "orbit preset 2" },
          { key: "3", label: "3", kind: "action", ariaLabel: "orbit preset 3" },
          { key: "r", label: "R", kind: "action", ariaLabel: "reset camera" }
        ]
      }
    ],
    onAction: ({ key }) => handleKey(key)
  });
  if (!touchRoot) {
    return;
  }
  touchRoot.style.justifyContent = "flex-start";
  touchRoot.style.alignItems = "flex-end";
  touchRoot.style.paddingLeft = "16px";
  touchRoot.style.paddingRight = "16px";
  touchRoot.style.paddingBottom = "18px";
  touchRoot.style.gap = "14px";
  touchRoot.style.setProperty("--webg-touch-btn-font-size", "24px");
  const moveGroup = touchRoot.querySelector('[data-group="move"]');
  const cameraGroup = touchRoot.querySelector('[data-group="camera"]');
  if (cameraGroup) {
    cameraGroup.style.order = "1";
  }
  if (moveGroup) {
    moveGroup.style.order = "2";
    moveGroup.style.marginLeft = "auto";
  }
  const buttons = touchRoot.querySelectorAll(".webg-touch-btn");
  for (let i = 0; i < buttons.length; i++) {
    const btn = buttons[i];
    btn.style.width = "64px";
    btn.style.height = "64px";
  }
};

// mission 開始前の初期化と、scenePhase の切り替えを sample 側 helper にまとめる
// - tile_sim は今の段階では title / play / result の 3 状態だけを持ち、state machine よりも
//   「いつ reset して、いつ phase 文字列を変えるか」がその場で読める形を優先する
const createScenePhaseController = (app, missionRuntime, controller, supportSquad, enemyScout, alphaUnit, dialogueDirector) => {
  // title 表示や retry 開始のたびに、mission と ball を同じ初期位置へ戻す
  // - result panel の clear、move count の reset、start cell 復帰を必ず同じ順序で行う
  const resetMissionFlow = () => {
    missionRuntime.resetMission();
    controller.setBallCell(missionRuntime.mission.plan.startCell, false);
    resetAlphaUnitState(alphaUnit, missionRuntime.mission.plan.startCell);
    supportSquad.reset(missionRuntime.mission.plan.startCell);
    enemyScout.reset(
      missionRuntime.mission.plan.startCell,
      missionRuntime.mission.plan.goalCell,
      missionRuntime.mission.plan.beaconCells
    );
  };

  // phase 名の設定を 1 か所へまとめ、sample の分岐を読みやすくする
  const setPhase = (phase) => {
    app.setScenePhase(phase, {
      force: true
    });
    return phase;
  };

  // title へ入るときは mission を初期状態へ戻したうえで待機表示にする
  const enterTitle = () => {
    resetMissionFlow();
    const phase = setPhase("title");
    dialogueDirector.startTitleIntro(missionRuntime.mission);
    return phase;
  };

  // play 開始時は retry でも title からでも同じ初期化順を通す
  const beginPlay = () => {
    resetMissionFlow();
    const phase = setPhase("play");
    dialogueDirector.startPlayBriefing(missionRuntime.mission);
    return phase;
  };

  // result では missionRuntime が保持している result 文言をそのまま見せる
  const enterResult = (resultKind, resultMessage) => {
    missionRuntime.mission.resultKind = resultKind ?? missionRuntime.mission.resultKind;
    missionRuntime.mission.resultMessage = resultMessage ?? missionRuntime.mission.resultMessage;
    const phase = setPhase("result");
    dialogueDirector.startResultDebrief(missionRuntime.mission);
    return phase;
  };

  return {
    resetMissionFlow,
    enterTitle,
    beginPlay,
    enterResult
  };
};

// keyboard / touch の action を phase ごとの振る舞いへ変換する handler を作る
// - Enter / Space は開始と retry、Arrow は移動、数字は camera preset、R は reset に割り当てる
// - orbit の head を見て camera-relative movement へ変換する入口もここへ集める
const createActionHandler = (app, controller, orbitRig, resetOrbit, setOrbitPreset, phaseController, isActionLocked) => {
  return (key, ev = null) => {
    const raw = String(key ?? "").toLowerCase();
    const normalized = raw === " " ? "space" : raw;
    const phase = app.getScenePhase() ?? "title";
    const dialogueState = app.getDialogueState();
    const dialogueActive = dialogueState?.active === true;
    const relativeMove = resolveCameraRelativeGridMove(orbitRig.orbit.head, normalized);

    if (dialogueActive) {
      if (relativeMove && (dialogueState?.current?.choiceCount ?? 0) > 0) {
        return;
      }
      if (normalized === "enter" || normalized === "space") {
        app.nextDialogue();
        if (app.getDialogueState()?.active === true) {
          return;
        }
      }
      if (relativeMove && (dialogueState?.current?.choiceCount ?? 0) <= 0) {
        app.nextDialogue();
      }
      if (normalized === "1" || normalized === "numpad1") {
        if (ev?.repeat) {
          return;
        }
        app.chooseDialogue(0);
        return;
      }
      if (normalized === "2" || normalized === "numpad2") {
        if (ev?.repeat) {
          return;
        }
        app.chooseDialogue(1);
        return;
      }
    }

    if (normalized === "enter" || normalized === "space") {
      if (ev?.repeat) {
        return;
      }
      if (phase === "title" || phase === "result") {
        phaseController.beginPlay();
      }
      return;
    }

    if (relativeMove) {
      if (phase !== "play") {
        return;
      }
      if (typeof isActionLocked === "function" && isActionLocked()) {
        return;
      }
      if (dialogueActive) {
        return;
      }
      controller.moveBall(relativeMove.dx, relativeMove.dy);
      return;
    }
    if (normalized === "r") {
      if (ev?.repeat) {
        return;
      }
      resetOrbit();
      return;
    }
    if (normalized === "1") {
      if (ev?.repeat) {
        return;
      }
      setOrbitPreset(0);
      return;
    }
    if (normalized === "2") {
      if (ev?.repeat) {
        return;
      }
      setOrbitPreset(1);
      return;
    }
    if (normalized === "3") {
      if (ev?.repeat) {
        return;
      }
      setOrbitPreset(2);
    }
  };
};

// click / tap selection を canvas 上で扱う pointer 操作を登録する
// - camera の orbit / PAN / wheel / pinch は WebgApp.createOrbitEyeRig() が標準入力として処理する
// - sample 側では短い click / tap だけを TileMap.pickCell() へ流し、camera 実装を重複させない
const registerPointerControls = (app, tileMap, controller, onInspect = null) => {
  const canvas = app.screen.canvas;
  const pointerState = {
    active: false,
    moved: false,
    lastX: 0,
    lastY: 0,
    pointerId: null,
    touchPointers: new Map(),
    touchPointerId: null,
    touchMoved: false,
    touchStartX: 0,
    touchStartY: 0
  };

  const TOUCH_DRAG_THRESHOLD_PX = 6;
  const MOUSE_DRAG_THRESHOLD_PX = 2;

  // click / tap selection は mouse / touch の両方で同じ raycast 経路を使う
  const pickCellAt = (clientX, clientY) => {
    app.eye.setWorldMatrix();
    const view = new Matrix();
    view.makeView(app.eye.worldMatrix);
    const ray = makeRayFromMouse(canvas, clientX, clientY, app.eye, app.projectionMatrix, view);
    const hit = tileMap.pickCell(ray.origin, ray.dir);
    controller.applySelection(hit);
    if ((app.getScenePhase() ?? "title") === "play" && typeof onInspect === "function") {
      onInspect(hit);
    }
  };

  // touch pointer の最新位置を保持し、tap と drag を区別できるようにする
  const storeTouchPointer = (ev) => {
    pointerState.touchPointers.set(ev.pointerId, {
      pointerId: ev.pointerId,
      clientX: ev.clientX,
      clientY: ev.clientY
    });
  };

  const releaseTouchPointer = (pointerId) => {
    pointerState.touchPointers.delete(pointerId);
  };

  // multitouch は camera 側の gesture として扱い、sample 側では tap selection から除外する
  const getTouchPointers = () => {
    return Array.from(pointerState.touchPointers.values()).slice(0, 2);
  };

  const releasePointerCaptureSafe = (pointerId) => {
    try {
      canvas.releasePointerCapture(pointerId);
    } catch (_) {
      // capture が残っていない場合は無視する
    }
  };

  canvas.addEventListener("pointerdown", (ev) => {
    if (ev.pointerType === "touch") {
      storeTouchPointer(ev);
      canvas.setPointerCapture(ev.pointerId);
      const touches = getTouchPointers();
      if (touches.length >= 2) {
        pointerState.touchMoved = true;
        pointerState.touchPointerId = null;
      } else {
        pointerState.touchPointerId = ev.pointerId;
        pointerState.touchMoved = false;
        pointerState.touchStartX = ev.clientX;
        pointerState.touchStartY = ev.clientY;
      }
      ev.preventDefault();
      return;
    }
    if (ev.button !== 0) {
      return;
    }
    pointerState.active = true;
    pointerState.moved = false;
    pointerState.lastX = ev.clientX;
    pointerState.lastY = ev.clientY;
    pointerState.pointerId = ev.pointerId;
    canvas.setPointerCapture(ev.pointerId);
  });

  canvas.addEventListener("pointermove", (ev) => {
    if (ev.pointerType === "touch") {
      if (!pointerState.touchPointers.has(ev.pointerId)) {
        return;
      }
      storeTouchPointer(ev);
      const touches = getTouchPointers();
      if (touches.length >= 2) {
        pointerState.touchMoved = true;
        ev.preventDefault();
        return;
      }
      if (pointerState.touchPointerId !== ev.pointerId) {
        return;
      }
      if (!pointerState.touchMoved) {
        const totalDx = ev.clientX - pointerState.touchStartX;
        const totalDy = ev.clientY - pointerState.touchStartY;
        if (Math.abs(totalDx) + Math.abs(totalDy) <= TOUCH_DRAG_THRESHOLD_PX) {
          return;
        }
        pointerState.touchMoved = true;
      }
      ev.preventDefault();
      return;
    }
    if (!pointerState.active) {
      return;
    }
    const dx = ev.clientX - pointerState.lastX;
    const dy = ev.clientY - pointerState.lastY;
    if (Math.abs(dx) + Math.abs(dy) > MOUSE_DRAG_THRESHOLD_PX) {
      pointerState.moved = true;
    }
    pointerState.lastX = ev.clientX;
    pointerState.lastY = ev.clientY;
  });

  canvas.addEventListener("pointerup", (ev) => {
    if (ev.pointerType === "touch") {
      const wasPrimaryTouch = pointerState.touchPointerId === ev.pointerId;
      const tapEligible = wasPrimaryTouch && !pointerState.touchMoved && getTouchPointers().length <= 1;
      releaseTouchPointer(ev.pointerId);
      releasePointerCaptureSafe(ev.pointerId);
      const touches = getTouchPointers();
      if (touches.length >= 2) {
        pointerState.touchPointerId = null;
        pointerState.touchMoved = true;
      } else if (touches.length === 1) {
        const remaining = touches[0];
        pointerState.touchPointerId = remaining.pointerId;
      } else {
        pointerState.touchPointerId = null;
      }
      if (tapEligible) {
        pickCellAt(ev.clientX, ev.clientY);
      }
      ev.preventDefault();
      return;
    }
    if (!pointerState.active) {
      return;
    }
    if (!pointerState.moved) {
      pickCellAt(ev.clientX, ev.clientY);
    }
    pointerState.active = false;
    pointerState.pointerId = null;
  });

  canvas.addEventListener("pointercancel", (ev) => {
    if (ev.pointerType === "touch") {
      releaseTouchPointer(ev.pointerId);
      releasePointerCaptureSafe(ev.pointerId);
      const touches = getTouchPointers();
      if (touches.length === 1) {
        const remaining = touches[0];
        pointerState.touchPointerId = remaining.pointerId;
      } else {
        pointerState.touchPointerId = null;
        pointerState.touchMoved = false;
      }
      return;
    }
    pointerState.active = false;
    pointerState.pointerId = null;
    pointerState.moved = false;
  });
};

// sample 全体を起動する
// - WebgApp 初期化、Scene build、ball と marker の生成、input 登録、frame loop 開始を順番に行う
const start = async () => {
  const app = new WebgApp({
    document,
    shaderClass: SmoothShader,
    messageFontTexture: FONT_FILE,
    attachInputOnInit: false,
    clearColor: [0.08, 0.10, 0.15, 1.0],
    viewAngle: 42.0,
    projectionNear: 0.1,
    projectionFar: 1000.0,
    debugTools: {
      // tile_sim は現在 core fallback 削減後の挙動確認にも使っているため、
      // sample 起動直後から debug dock と diagnostics を見られる debug mode を既定にする
      mode: "debug",
      keyInput: {
        enabled: false
      },
      system: "tile_sim",
      source: "samples/tile_sim/main.js",
      probeDefaultAfterFrames: 1
    },
    light: {
      mode: "eye-fixed",
      position: [10.0, 24.0, 18.0, 1.0],
      type: 1.0
    },
    camera: {
      target: [MAP_WIDTH * CELL_SIZE * 0.5, 0.0, MAP_HEIGHT * CELL_SIZE * 0.5],
      distance: 18.7,
      head: 28.0,
      pitch: -30.0,
      bank: 0.0,
      viewAngle: 42.0,
      near: 0.1,
      far: 1000.0
    }
  });
  await app.init();

  const terrainTextures = await createTerrainTexturePair(app.getGL(), TILE_SIM_TERRAIN_TEXTURE_OPTIONS);
  const sceneAsset = SceneAsset.fromData(
    createSceneDefinition(buildTerrainMaterials(terrainTextures))
  );
  const sceneRuntime = await sceneAsset.build(app);
  const tileMap = sceneRuntime.tileMap;
  if (!tileMap) {
    throw new Error("tileMap runtime was not created");
  }

  const { ballNode, ballShape } = createBallRig(app);
  const orbitRig = app.createOrbitEyeRig({
    target: [...app.camera.target],
    distance: ORBIT_PRESETS[0].distance,
    head: ORBIT_PRESETS[0].head,
    pitch: ORBIT_PRESETS[0].pitch,
    bank: 0.0,
    orbit: {
      minDistance: 8.0,
      maxDistance: 34.0,
      pitchMin: -84.0,
      pitchMax: -8.0,
      dragRotateSpeed: 0.28,
      dragPanSpeed: 2.0,
      pinchZoomSpeed: 2.2,
      wheelZoomStep: 1.8
    },
    orbitKeyMap: {
      left: "a",
      right: "d",
      up: "w",
      down: "s",
      zoomIn: "q",
      zoomOut: "e"
    },
    panModifierKey: "shift"
  });

  // orbit camera を基準 preset へ戻す
  // - 視点が崩れても 1 操作で sample 既定角度へ戻せるようにする
  const resetOrbit = () => {
    const preset = ORBIT_PRESETS[0];
    orbitRig.orbit.label = preset.label;
    orbitRig.setAngles(preset.head, preset.pitch, 0.0);
    orbitRig.setDistance(preset.distance);
    app.syncCameraFromEyeRig(orbitRig);
  };

  // preset 番号に応じて orbit camera を切り替える
  // - 同じ盤面を斜め / 横 / 俯瞰で見比べ、TileMap の見え方差を確認しやすくする
  const setOrbitPreset = (index) => {
    const preset = ORBIT_PRESETS[(index + ORBIT_PRESETS.length) % ORBIT_PRESETS.length];
    orbitRig.orbit.label = preset.label;
    orbitRig.setAngles(preset.head, preset.pitch, 0.0);
    orbitRig.setDistance(preset.distance);
    app.syncCameraFromEyeRig(orbitRig);
  };

  const missionRuntime = createTileMapMissionRuntime(app, tileMap);
  const startCell = findStartCell(tileMap);
  const alphaUnit = createAlphaUnitState(startCell);
  const alphaActor = await createTileSimAlphaActor(app, ballNode, {
    ballRadius: BALL_RADIUS,
    ballLift: BALL_LIFT,
    footClearance: -0.06,
    scale: 2.0,
    yaw: 180.0,
    formationBackRatio: HUMAN_GROUP_BACK_RATIO - HUMAN_CELL_FORMATION_RATIO
  });
  alphaActor.hideProxyShapes([ballShape]);
  const supportSquad = await createTileSimSupportSquad(app, tileMap, startCell, {
    getFormationYaw: () => alphaActor.getFacingYaw?.() ?? 0.0
  });
  const enemyScout = await createTileSimEnemyScout(app, tileMap, () => missionRuntime.mission);
  const dialogueDirector = createTileSimDialogueDirector(app, {
    getMission: () => missionRuntime.mission,
    getAlphaUnit: () => alphaUnit,
    getScenePhase: () => app.getScenePhase() ?? "title"
  });
  const controller = createTileMapController(tileMap, app, ballNode, null, startCell, {
    onMoveStart: ({ fromCell, toCell }) => {
      alphaActor.faceTowardCells(fromCell, toCell, {
        durationMs: BALL_MOVE_DURATION_MS
      });
      missionRuntime.handleMoveStart();
    },
    onMoveComplete: (info) => {
      missionRuntime.handleMoveComplete(info);
      alphaUnit.cell = info?.toCell ?? alphaUnit.cell;
      alphaUnit.lastDecision = "PLAYER MOVE";
      if ((app.getScenePhase() ?? "title") === "play") {
        supportSquad.advanceWithAdvisorAndWait(aiAdvisor.getSnapshot(), () => {
          const supportUnits = supportSquad.getUnits();
          enemyScout.advanceTurnAndWait({
            alphaUnit,
            supportUnits
          }, () => {
            applyAlphaTurnStep(alphaUnit);
            const supportSummary = supportSquad.applyTurnStep();
            const enemySummary = enemyScout.applyTurnStep(alphaUnit);
            missionRuntime.advanceTurn({
              alphaUnit,
              supportUnits: supportSummary,
              enemyUnits: enemySummary
            });
            dialogueDirector.startTurnReport({
              mission: missionRuntime.mission,
              alphaUnit
            });
          });
        });
      }
    }
  });
  const aiAdvisor = createTileSimAiAdvisor(
    tileMap,
    () => missionRuntime.mission,
    () => controller.ballCell,
    () => [alphaUnit, ...supportSquad.getUnits()]
  );
  const minimapOverlay = createTileSimMinimapOverlay({
    document,
    tileMap,
    getMission: () => missionRuntime.mission,
    getAlphaUnit: () => alphaUnit,
    getSupportUnits: () => supportSquad.getUnits(),
    getEnemyUnits: () => enemyScout.getUnits(),
    getSelectedCell: () => controller.selected?.cell ?? null,
    getScenePhase: () => app.getScenePhase() ?? "title",
    getDialogueState: () => app.getDialogueState()
  });
  const phaseController = createScenePhaseController(
    app,
    missionRuntime,
    controller,
    supportSquad,
    enemyScout,
    alphaUnit,
    dialogueDirector
  );
  missionRuntime.setResultHandler((resultKind, resultMessage) => {
    phaseController.enterResult(resultKind, resultMessage);
  });
  phaseController.enterTitle();

  const handleAction = createActionHandler(
    app,
    controller,
    orbitRig,
    resetOrbit,
    setOrbitPreset,
    phaseController,
    () => controller.isBallMoving() || supportSquad.isBusy() || enemyScout.isBusy()
  );
  app.attachInput({
    onKeyDown: (key, ev) => handleAction(key, ev)
  });
  installTouchControls(app, handleAction);
  registerPointerControls(app, tileMap, controller, (hit) => {
    dialogueDirector.startCellInspect(hit, missionRuntime.mission, aiAdvisor.getSnapshot());
  });
  resetOrbit();

  app.start({
    onUpdate: ({ deltaSec }) => {
      alphaActor.update(deltaSec * 1000.0);
      supportSquad.updateActors(deltaSec * 1000.0);
      enemyScout.updateActor(deltaSec * 1000.0);
      missionRuntime.updateMarkers(deltaSec);
      minimapOverlay.update();
      app.setGuideLines([], {
        anchor: "bottom-left",
        x: 0,
        y: -2,
        color: [0.90, 0.95, 1.0]
      });
      app.setStatusLines([], {
        anchor: "top-left",
        x: 0,
        y: 0,
        color: [1.0, 0.88, 0.72]
      });
    }
  });
};

// DOM 準備完了後に sample を起動し、失敗時は console へ理由を残す
document.addEventListener("DOMContentLoaded", () => {
  start().catch((err) => {
    console.error("tile_sim failed:", err);
  });
});
