// ---------------------------------------------
// unittest/camera_follow/main.js  2026/04/10
//   camera_follow unittest
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
import WebgApp from "../../webg/WebgApp.js";
import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";

// この test は、WebgApp の camera follow / lock-on helper が
// - target node の world position を拾う
// - follow では滑らかに追う
// - lock-on では即時に合わせる
// という流れを、まず headless の自動テストで確認し、
// そのあと実際の canvas 上でも camera が追従する様子を見られるようにする
//
// camera は見た目の要なので、関数名だけでは処理意図を推測しにくい
// そのため、この test では自動テストの PASS / FAIL と visual phase の両方を使い、
// 何が camera に反映されるのかを画面でも追えるようにしている

const statusEl = document.getElementById("status");
const manualEl = document.getElementById("manual");

const lines = [];
let passCount = 0;
let failCount = 0;

// 結果を後でまとめて読みやすくするための蓄積先
const log = (line) => {
  lines.push(line);
};

// 1 件ずつ条件を確認し、PASS / FAIL を記録する
// 失敗時だけ detail を残し、どの値がずれたかを追いやすくする
const check = (label, condition, detail = "") => {
  if (condition) {
    passCount += 1;
    log(`PASS ${label}`);
  } else {
    failCount += 1;
    log(`FAIL ${label}${detail ? `: ${detail}` : ""}`);
  }
};

// float 比較での誤差を吸収するための helper
const approx = (value, expected, epsilon = 0.0001) => Math.abs(value - expected) <= epsilon;

// cameraRig の setPosition / setAttitude を記録するだけの stub
// ここでは WebGPU の描画は不要なので、座標更新の結果だけを見ている
const createCameraRigStub = () => ({
  position: [0.0, 0.0, 0.0],
  attitude: [0.0, 0.0, 0.0],
  setPosition(x, y, z) {
    this.position = [x, y, z];
  },
  setAttitude(yaw, pitch, roll) {
    this.attitude = [yaw, pitch, roll];
  }
});

// target node は world position と world attitude を返せばよい
// 実際の Node 実装に寄せて、getter が毎回同じ shape を返すようにしている
const createTargetNode = (position, attitude = [0.0, 0.0, 0.0]) => {
  const state = {
    position: [...position],
    attitude: [...attitude]
  };
  return {
    state,
    getWorldPosition() {
      return [...state.position];
    },
    getWorldAttitude() {
      return [...state.attitude];
    }
  };
};

// WebgApp の constructor を通さず、必要な field だけを持つ最小 stub を作る
// camera helper は init 前でも動かしたいので、prototype method を直接読む
const createAppStub = () => {
  const app = Object.create(WebgApp.prototype);
  app.camera = {
    target: [0.0, 0.0, 0.0]
  };
  app.cameraRig = createCameraRigStub();
  app.cameraFollow = {
    active: false,
    mode: "follow",
    targetNode: null,
    targetOffset: [0.0, 0.0, 0.0],
    currentTarget: [0.0, 0.0, 0.0],
    smooth: 0.15,
    inheritTargetYaw: false,
    targetYawOffset: 0.0
  };
  return app;
};

const app = createAppStub();
const followTarget = createTargetNode([10.0, 5.0, -2.0], [30.0, 8.0, 1.0]);
const followNode = WebgApp.prototype.followNode;
const lockOn = WebgApp.prototype.lockOn;
const clearCameraTarget = WebgApp.prototype.clearCameraTarget;
const updateCameraTarget = WebgApp.prototype.updateCameraTarget;

// followNode は target の world position を取り、offset を足した位置を camera へ反映する
followNode.call(app, followTarget, {
  offset: [1.0, 2.0, 3.0],
  smooth: 0.2,
  inheritTargetYaw: true,
  targetYawOffset: 10.0
});
check("followNode activates camera follow", app.cameraFollow.active === true);
check("followNode stores mode", app.cameraFollow.mode === "follow");
check("followNode snaps camera target", approx(app.camera.target[0], 11.0) && approx(app.camera.target[1], 7.0) && approx(app.camera.target[2], 1.0), JSON.stringify(app.camera.target));
check("followNode updates cameraRig position", approx(app.cameraRig.position[0], 11.0) && approx(app.cameraRig.position[1], 7.0) && approx(app.cameraRig.position[2], 1.0), JSON.stringify(app.cameraRig.position));
check("followNode can inherit target yaw", approx(app.cameraRig.attitude[0], 40.0) && approx(app.cameraRig.attitude[1], 8.0) && approx(app.cameraRig.attitude[2], 1.0), JSON.stringify(app.cameraRig.attitude));

// target が移動した後は、smooth に応じて少しずつ追従する
followTarget.state.position = [21.0, 9.0, 6.0];
followTarget.state.attitude = [45.0, 4.0, 2.0];
updateCameraTarget.call(app, 1.0 / 60.0);
check("followNode interpolates toward moved target", approx(app.camera.target[0], 13.2) && approx(app.camera.target[1], 7.8) && approx(app.camera.target[2], 2.6), JSON.stringify(app.camera.target));

// lockOn は follow の即時版として使い、camera をすぐ target に合わせる
const lockTarget = createTargetNode([3.0, 4.0, 5.0], [12.0, 34.0, 56.0]);
lockOn.call(app, lockTarget, {
  offset: [0.0, 0.0, 0.0],
  inheritTargetYaw: true,
  targetYawOffset: -2.0
});
check("lockOn stores mode", app.cameraFollow.mode === "lock");
check("lockOn snaps immediately", approx(app.camera.target[0], 3.0) && approx(app.camera.target[1], 4.0) && approx(app.camera.target[2], 5.0), JSON.stringify(app.camera.target));
check("lockOn inherits yaw immediately", approx(app.cameraRig.attitude[0], 10.0) && approx(app.cameraRig.attitude[1], 34.0) && approx(app.cameraRig.attitude[2], 56.0), JSON.stringify(app.cameraRig.attitude));

// 追従解除後は、target の移動を camera へ反映しない
clearCameraTarget.call(app);
lockTarget.state.position = [9.0, 9.0, 9.0];
const updated = updateCameraTarget.call(app, 1.0 / 60.0);
check("clearCameraTarget disables follow", app.cameraFollow.active === false);
check("updateCameraTarget returns idle value when disabled", updated === 0);
check("camera target stays after clear", approx(app.camera.target[0], 3.0) && approx(app.camera.target[1], 4.0) && approx(app.camera.target[2], 5.0), JSON.stringify(app.camera.target));

if (statusEl) {
  statusEl.textContent = [
    "camera_follow unittest",
    `pass=${passCount} fail=${failCount}`,
    ...lines
  ].join("\n");
}

const CAMERA_OFFSET = [0.0, 6.0, 20.0];
// camera は target を少し後ろと上から追う
// offset を固定すると follow と lock の差が読みやすい
// target の motion は角のあるループにして、follow と lock の差が見やすいようにする
// 直線と角を組み合わせると、follow の遅れが目に入りやすい
const TARGET_PATH = [
  [-9.0, 1.3, -7.0],
  [9.0, 1.3, -7.0],
  [9.0, 1.3, 7.0],
  [-9.0, 1.3, 7.0]
];
const TARGET_SEGMENT_SEC = 1.4;
const TARGET_HEIGHT = 1.3;
const FOLLOW_SMOOTH = 0.02;

const visualState = {
  mode: "follow",
  autoMove: true,
  pathTimeSec: 0.0,
  targetHeadingDeg: 0.0,
  lastInput: "none",
  lastEvent: "waiting",
  targetPos: [0.0, TARGET_HEIGHT, 0.0],
  suppressedEdges: new Set()
};

// visual phase で使う state は、操作の現在値と target motion のみに絞る
// 余計な情報を増やさず、camera helper の切り替えに集中できるようにする
const visualRuntime = {
  app: null,
  targetRoot: null,
  targetBodyShape: null,
  floorNode: null
};

// camera follow の見え方を分かりやすくするための薄い utility
// ここでは値の範囲を整えるだけにして、描画処理とは分けておく
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// shape 組み立ての共通手順を 1 箇所にまとめる
// primitive を貼って material を入れて end する流れを毎回書かなくてよくなる
const createPhongShape = (gpu, buildMesh, material) => {
  const shape = new Shape(gpu);
  buildMesh(shape);
  shape.endShape();
  shape.setMaterial("smooth-shader", {
    has_bone: 0,
    ...material
  });
  return shape;
};

// floor は単なる背景ではなく、target の位置変化を読むための基準面にする
// 床があると camera が動いたときの相対位置が分かりやすい
const createFloorShape = (gpu) => createPhongShape(gpu, (shape) => {
  shape.applyPrimitiveAsset(Primitive.cuboid(48.0, 1.0, 48.0, shape.getPrimitiveOptions()));
}, {
  use_texture: 0,
  color: [0.16, 0.20, 0.26, 1.0],
  ambient: 0.34,
  specular: 0.10,
  power: 14.0
});

// target は少し縦長の箱にして、camera が追っている物体を見分けやすくする
// 形を単純に保つことで、camera helper の差が見た目に出やすくなる
const createTargetBodyShape = (gpu) => createPhongShape(gpu, (shape) => {
  shape.applyPrimitiveAsset(Primitive.cuboid(2.2, 1.4, 3.0, shape.getPrimitiveOptions()));
}, {
  use_texture: 0,
  color: [0.95, 0.48, 0.18, 1.0],
  ambient: 0.34,
  specular: 0.90,
  power: 44.0
});

// manual panel は、canvas の外で状態を読むための説明欄として使う
// DOM 側にまとめることで、canvas を 3D scene だけに保てるようにする
const renderManualPanel = () => {
  if (!manualEl) return;
  const cameraYaw = visualRuntime.app?.cameraRig?.attitude?.[0] ?? 0.0;
  manualEl.textContent = [
    "camera_follow visual sample",
    `mode: ${visualState.mode}`,
    `target motion: ${visualState.autoMove ? "looping" : "paused"}`,
    `target heading: ${visualState.targetHeadingDeg.toFixed(1)}°`,
    `camera yaw: ${cameraYaw.toFixed(1)}°`,
    `last input: ${visualState.lastInput}`,
    `last event: ${visualState.lastEvent}`,
    "",
    "keyboard: 1 follow / 2 lock / 3 yaw-follow / 4 clear / R reset / Space pause",
    "touch: Follow / Lock / Yaw / Clear / Reset"
  ].join("\n");
};

// target を毎 frame 動かす処理をここへ集約する
// camera helper の切り替えと motion が同じ画面で読めるようにしている
const updateVisualFrame = (ctx) => {
  const app = visualRuntime.app;
  const targetRoot = visualRuntime.targetRoot;
  if (!app || !targetRoot) return;

  // deltaSec を使うと更新頻度が変わっても motion の見え方が安定する
  const dt = Math.max(0.0, Number(ctx?.deltaSec ?? 0.0));
  if (visualState.autoMove) {
    visualState.pathTimeSec = (visualState.pathTimeSec + dt) % (TARGET_PATH.length * TARGET_SEGMENT_SEC);
  }
  const pathPhase = TARGET_SEGMENT_SEC > 0
    ? visualState.pathTimeSec / TARGET_SEGMENT_SEC
    : 0.0;
  const segmentIndex = Math.floor(pathPhase) % TARGET_PATH.length;
  const nextIndex = (segmentIndex + 1) % TARGET_PATH.length;
  const t = pathPhase - Math.floor(pathPhase);
  const from = TARGET_PATH[segmentIndex];
  const to = TARGET_PATH[nextIndex];
  const x = from[0] + (to[0] - from[0]) * t;
  const y = TARGET_HEIGHT;
  const z = from[2] + (to[2] - from[2]) * t;
  const yaw = Math.atan2(to[2] - from[2], to[0] - from[0]) * 180.0 / Math.PI;

  visualState.targetPos[0] = x;
  visualState.targetPos[1] = y;
  visualState.targetPos[2] = z;
  visualState.targetHeadingDeg = yaw;

  // target の位置と向きを更新して、camera が追う基準を作る
  // setAttitude(yaw, pitch, roll) なので、heading は第1引数へ入れる
  targetRoot.setPosition(x, y, z);
  targetRoot.setAttitude(yaw, 0.0, 0.0);

  const runEdge = (name, callback) => {
    // action の押下は 1 frame だけ拾う
    // keyboard と touch を同じ flow で扱えるようにする
    if (!app.input?.wasActionPressed?.(name)) return;
    if (visualState.suppressedEdges.has(name)) {
      visualState.suppressedEdges.delete(name);
      return;
    }
    callback();
  };

  runEdge("follow", () => {
    // follow は smooth 追従として扱う
    // target が動き続けると camera が遅れて付いてくる
    app.followNode(targetRoot, {
      offset: CAMERA_OFFSET,
      smooth: FOLLOW_SMOOTH,
      inheritTargetYaw: false
    });
    visualState.mode = "follow";
    visualState.lastEvent = "followNode";
    app.flashMessage("followNode");
  });
  runEdge("lock", () => {
    // lock は即時反映として扱う
    // target に一気に合わせた見え方を確認する
    app.lockOn(targetRoot, {
      offset: CAMERA_OFFSET,
      inheritTargetYaw: false
    });
    visualState.mode = "lock";
    visualState.lastEvent = "lockOn";
    app.flashMessage("lockOn");
  });
  runEdge("yaw", () => {
    // yaw は向きの継承を見るための切り替え
    // 位置は同じでも向きだけ変わることを見たい
    app.followNode(targetRoot, {
      offset: CAMERA_OFFSET,
      smooth: 0.04,
      inheritTargetYaw: true,
      targetYawOffset: 180.0
    });
    visualState.mode = "yaw-follow";
    visualState.lastEvent = "yaw follow";
    app.flashMessage("followNode + yaw");
  });
  runEdge("clear", () => {
    // clear は camera の追従解除
    // helper が外れた後に target motion だけが見えるか確認する
    app.clearCameraTarget();
    visualState.mode = "clear";
    visualState.lastEvent = "clearCameraTarget";
    app.flashMessage("clearCameraTarget");
  });
  runEdge("reset", () => {
    // reset は motion と camera helper を最初の状態へ戻す
    // manual 確認の途中で状態が崩れても、すぐやり直せるようにする
    visualState.autoMove = true;
    visualState.pathTimeSec = 0.0;
    app.followNode(targetRoot, {
      offset: CAMERA_OFFSET,
      smooth: FOLLOW_SMOOTH,
      inheritTargetYaw: false
    });
    visualState.mode = "follow";
    visualState.lastEvent = "reset";
    app.flashMessage("reset");
  });
  runEdge("pause", () => {
    // pause は target motion だけを止める
    // camera helper を止めずに比較できるようにする
    visualState.autoMove = !visualState.autoMove;
    visualState.lastEvent = visualState.autoMove ? "motion on" : "motion paused";
    app.flashMessage(visualState.autoMove ? "motion on" : "motion paused");
  });

  renderManualPanel();
};

// WebgApp を使った visual phase は、camera helper を実際の 3D scene 上で確認するためのもの
// ここでは follow / lock / yaw-follow / clear / reset / pause を順番に切り替え、camera の反応をそのまま見せる
const startVisualPhase = async () => {
  // visual test 用に必要な設定だけで WebgApp を起動する
  // debugTools はこの unittest が何を見ているかを示すために残しておく
  visualRuntime.app = new WebgApp({
    document,
    clearColor: [0.05, 0.07, 0.11, 1.0],
    viewAngle: 54.0,
    projectionNear: 0.1,
    projectionFar: 600.0,
    messageFontTexture: "../../webg/font512.png",
    debugTools: {
      mode: "release",
      system: "camera_follow",
      source: "unittest/camera_follow/main.js",
      probeDefaultAfterFrames: 1
    },
    camera: {
      target: [0.0, 6.0, 0.0],
      distance: 28.0,
      yaw: 18.0,
      pitch: -22.0,
      roll: 0.0
    }
  });
  await visualRuntime.app.init();

  // 物理キーを action 名へまとめる
  // sample 側が event.key ごとに分岐を増やさなくてよいようにする
  visualRuntime.app.registerActionMap({
    follow: ["1", "f"],
    lock: ["2", "l"],
    yaw: ["3", "y"],
    clear: ["4", "c"],
    reset: ["r"],
    pause: ["space", "p"]
  });

  // 入力ログは helper の挙動確認とは分けて、現在の入力源だけを記録する
  visualRuntime.app.attachInput({
    onKeyDown: (key) => {
      visualState.lastInput = `keyboard ${key}`;
      visualState.lastEvent = `keydown ${key}`;
      renderManualPanel();
    },
    onKeyUp: (key) => {
      visualState.lastInput = `keyboard ${key}`;
      visualState.lastEvent = `keyup ${key}`;
      renderManualPanel();
    }
  });

  // scene は floor と target だけにして、camera follow の違いを読みやすくする
  const gpu = visualRuntime.app.getGL();
  visualRuntime.floorNode = visualRuntime.app.space.addNode(null, "camera-floor");
  visualRuntime.floorNode.addShape(createFloorShape(gpu));

  visualRuntime.targetRoot = visualRuntime.app.space.addNode(null, "camera-target");
  visualRuntime.targetBodyShape = createTargetBodyShape(gpu);
  visualRuntime.targetRoot.addShape(visualRuntime.targetBodyShape);

  // 開始時は camera の追従を解除して、target の motion を最初に見えるようにする
  // そのうえで follow / lock を押したときに helper の差が分かるようにする
  visualRuntime.app.clearCameraTarget();
  visualRuntime.app.flashMessage("camera free");
  visualState.mode = "clear";
  visualState.lastEvent = "camera free";

  // touch ボタンは PC でも表示して、keyboard と同じ action で camera helper を切り替えられるようにする
  // どちらの入力でも同じ結果になることを sample として見せたい
  const touchRoot = visualRuntime.app.input.installTouchControls({
    touchDeviceOnly: false,
    className: "webg-touch-root camera-follow-touch",
    groups: [
      {
        id: "camera-mode",
        buttons: [
          { key: "follow", label: "Follow", kind: "action", ariaLabel: "follow target", width: 88, height: 56 },
          { key: "lock", label: "Lock", kind: "action", ariaLabel: "lock on target", width: 72, height: 56 },
          { key: "yaw", label: "Yaw", kind: "action", ariaLabel: "follow with yaw", width: 68, height: 56 },
          { key: "clear", label: "Clear", kind: "action", ariaLabel: "clear camera target", width: 72, height: 56 },
          { key: "reset", label: "Reset", kind: "action", ariaLabel: "reset follow sample", width: 72, height: 56 }
        ]
      }
    ],
    onAnyPress: (info) => {
      // 押し始めだけを記録して、どのボタンを触ったかを見えるようにする
      visualState.lastInput = `touch ${info.key}`;
      visualState.lastEvent = `press ${info.key}`;
      renderManualPanel();
    },
    onAction: (info) => {
      // action が発火したら、その場で camera helper を切り替える
      // keyboard と同じ名前の action を使うことで入力経路を揃える
      const key = String(info?.key ?? "").toLowerCase();
      visualState.lastInput = `touch ${key}`;
      visualState.lastEvent = `action ${key}`;
      visualState.suppressedEdges.add(key);
      switch (key) {
        case "follow":
          // follow は smooth 追従として扱う
          visualRuntime.app.followNode(visualRuntime.targetRoot, {
            offset: CAMERA_OFFSET,
            smooth: FOLLOW_SMOOTH,
            inheritTargetYaw: false
          });
          visualState.mode = "follow";
          visualState.lastEvent = "followNode";
          break;
        case "lock":
          // lock は即時反映として扱う
          visualRuntime.app.lockOn(visualRuntime.targetRoot, {
            offset: CAMERA_OFFSET,
            inheritTargetYaw: false
          });
          visualState.mode = "lock";
          visualState.lastEvent = "lockOn";
          break;
        case "yaw":
          // yaw は向きの継承がある場合の差を見る
          visualRuntime.app.followNode(visualRuntime.targetRoot, {
            offset: CAMERA_OFFSET,
            smooth: 0.04,
            inheritTargetYaw: true,
            targetYawOffset: 180.0
          });
          visualState.mode = "yaw-follow";
          visualState.lastEvent = "yaw follow";
          break;
        case "clear":
          // clear で追従解除を確認する
          visualRuntime.app.clearCameraTarget();
          visualState.mode = "clear";
          visualState.lastEvent = "clearCameraTarget";
          break;
        case "reset":
          // reset は motion と追従状態を初期化する
          visualState.autoMove = true;
          visualState.pathTimeSec = 0.0;
          visualRuntime.app.clearCameraTarget();
          visualState.mode = "clear";
          visualState.lastEvent = "reset";
          break;
        default:
          break;
      }
      renderManualPanel();
    }
  });
  if (touchRoot) {
    // touch UI は下寄せにして、PC でも押しやすい位置に置く
    touchRoot.style.justifyContent = "center";
    touchRoot.style.alignItems = "flex-end";
    touchRoot.style.paddingLeft = "14px";
    touchRoot.style.paddingRight = "14px";
    touchRoot.style.paddingBottom = "16px";
    touchRoot.style.gap = "10px";
    touchRoot.style.maxWidth = "100vw";
  }

  // 起動直後の state を manual panel に反映する
  renderManualPanel();
  if (statusEl) {
    statusEl.textContent += "\n\nmanual phase: visual camera follow sample ready";
  }
  if (manualEl) {
    manualEl.textContent = manualEl.textContent.replace("loading visual sample...", "visual camera follow sample ready");
  }

  // onUpdate に target motion を集約して、visual phase の流れを単純に保つ
  visualRuntime.app.start({
    onUpdate: (ctx) => {
      updateVisualFrame(ctx);
    }
  });
};

void startVisualPhase().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  if (statusEl) {
    statusEl.textContent = [
      "camera_follow unittest",
      `pass=${passCount} fail=${failCount}`,
      ...lines,
      "",
      `manual phase failed: ${message}`
    ].join("\n");
  }
  if (manualEl) {
    manualEl.textContent = [
      "camera_follow visual phase failed",
      message
    ].join("\n");
  }
  console.error("camera_follow visual phase failed:", error);
});
