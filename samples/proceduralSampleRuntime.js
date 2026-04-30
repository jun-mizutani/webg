// -------------------------------------------------
// proceduralSampleRuntime.js      2026/04/30
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// -------------------------------------------------

import WebgApp from "../webg/WebgApp.js";
import Shape from "../webg/Shape.js";

const FONT_FILE = "../../webg/font512.png";

// WebgApp 初期化前に失敗しても browser 上から原因を追えるよう、固定 panel を出す
export function showStartError(sampleId, error) {
  const existing = document.getElementById("start-error");
  if (existing) existing.remove();
  const panel = document.createElement("pre");
  panel.id = "start-error";
  panel.textContent = `${sampleId} failed\n${error?.message ?? String(error ?? "")}`;
  Object.assign(panel.style, {
    position: "fixed",
    left: "12px",
    top: "12px",
    margin: "0",
    padding: "12px 14px",
    background: "rgba(30, 45, 30, 0.92)",
    color: "#ffd7df",
    border: "1px solid rgba(255, 163, 186, 0.55)",
    borderRadius: "10px",
    whiteSpace: "pre-wrap",
    maxWidth: "min(560px, calc(100vw - 24px))",
    zIndex: "50"
  });
  document.body.appendChild(panel);
}

// orbit camera を sample の既定 view へ戻し、説明文と同じ見え方から再開できるようにする
export function resetOrbitView(orbit, camera) {
  orbit
    .setTarget(camera.target[0], camera.target[1], camera.target[2])
    .setDistance(camera.distance)
    .setAngles(camera.yaw, camera.pitch, camera.roll ?? 0.0)
    .setLookAngles(0.0, 0.0, 0.0);
}

// WebgApp、help panel、orbit camera、Shape 登録をまとめて行い、
// sample 側は「どういう mesh を作るか」と「毎 frame 何を更新するか」に集中できるようにする
export async function setupProceduralSampleApp(options = {}) {
  const sampleId = String(options.sampleId ?? "procedural_sample");
  const title = String(options.title ?? sampleId);
  const helpLines = [...(options.helpLines ?? [])];
  const statusOptions = {
    anchor: "top-right",
    x: 0,
    y: 0,
    color: [1.0, 0.90, 0.76],
    ...(options.statusOptions ?? {})
  };
  const camera = {
    target: [...(options.camera?.target ?? [0.0, 0.0, 0.0])],
    distance: Number(options.camera?.distance ?? 8.0),
    yaw: Number(options.camera?.yaw ?? 20.0),
    pitch: Number(options.camera?.pitch ?? -12.0),
    roll: Number(options.camera?.roll ?? 0.0),
    minDistance: Number(options.camera?.minDistance ?? 4.0),
    maxDistance: Number(options.camera?.maxDistance ?? 18.0),
    wheelZoomStep: Number(options.camera?.wheelZoomStep ?? 1.0)
  };

  // WebgApp 側へ渡す camera / clear / shader 条件をここでまとめ、
  // 各 sample は procedural shape の違いだけに集中できる状態を先に作る
  const app = new WebgApp({
    document: options.document ?? document,
    shaderClass: options.shaderClass,
    messageFontTexture: FONT_FILE,
    clearColor: options.clearColor ?? [0.05, 0.07, 0.10, 1.0],
    viewAngle: options.viewAngle ?? 54.0,
    projectionNear: options.projectionNear ?? 0.1,
    projectionFar: options.projectionFar ?? 240.0,
    lightPosition: options.lightPosition,
    camera: {
      target: camera.target,
      distance: camera.distance,
      yaw: camera.yaw,
      pitch: camera.pitch,
      roll: camera.roll
    },
    light: options.light,
    debugTools: {
      mode: "release",
      system: sampleId,
      source: options.source ?? `samples/${sampleId}/main.js`
    }
  });
  await app.init();

  if (options.fog) {
    app.setFog(options.fog);
  }

  app.createHelpPanel({
    id: `${sampleId}HelpOverlay`,
    lines: helpLines
  });

  const orbit = app.createOrbitEyeRig({
    target: camera.target,
    distance: camera.distance,
    yaw: camera.yaw,
    pitch: camera.pitch,
    roll: camera.roll,
    minDistance: camera.minDistance,
    maxDistance: camera.maxDistance,
    wheelZoomStep: camera.wheelZoomStep
  });

// sample ごとの材質設定を Shape へ適用し、
// procedural build 後に毎回同じ material path を通す
  const applyMaterial = (targetShape) => {
    targetShape.setMaterial(options.materialId ?? "phong", options.material ?? {
      use_texture: 0,
      color: [0.84, 0.84, 0.84, 1.0]
    });
  };

  // CPU 側配列で組み立てた shape を GPU へ確定し、
  // その直後に material もそろえて draw 可能な状態へ進める
  const finalizeShape = (targetShape) => {
    targetShape.endShape();
    applyMaterial(targetShape);
  };

  let shape = new Shape(app.getGL());
  let info = options.buildShape(shape, { app, orbit });
  finalizeShape(shape);

  const sampleNode = app.space.addNode(null, `${sampleId}Node`);
  sampleNode.addShape(shape);
  if (Array.isArray(options.nodePosition) && options.nodePosition.length >= 3) {
    sampleNode.setPosition(options.nodePosition[0], options.nodePosition[1], options.nodePosition[2]);
  }

  let runtime = null;

  // 現在の info と orbit 状態から status 文字列を再生成し、
  // parameter 変更や mesh 差し替えのあとでも右上表示を同期する
  const updateStatus = () => {
    if (typeof options.makeStatusLines !== "function") {
      return;
    }
    const lines = options.makeStatusLines({
      app,
      orbit,
      sampleNode,
      shape,
      info,
      title
    });
    app.setStatusLines(lines, statusOptions);
  };

  // camera を sample の初期 view へ戻し、
  // 必要なら sample 固有の reset hook も続けて実行する
  const resetView = () => {
    resetOrbitView(orbit, camera);
    if (typeof options.onReset === "function") {
      options.onReset({ app, orbit, sampleNode, shape, info });
    }
    updateStatus();
  };

  // terrain のように parameter 変更で procedural mesh を作り直す sample のため、
  // Node に載っている shape を安全に差し替える helper を持たせる
  const replaceShape = (nextShape, nextInfo, replaceOptions = {}) => {
    if (!nextShape) {
      return null;
    }
    if (replaceOptions.finalize !== false) {
      finalizeShape(nextShape);
    }
    shape = nextShape;
    if (nextInfo !== undefined) {
      info = nextInfo;
    }
    sampleNode.setShape(shape);
    if (runtime) {
      runtime.shape = shape;
      runtime.info = info;
    }
    updateStatus();
    return shape;
  };

  resetView();

  app.attachInput({
    onKeyDown: (key, ev) => {
      if (ev.repeat) return;
      if (key === "r") {
        resetView();
        return;
      }

      // sample 固有 input はここへ委譲し、
      // procedural parameter の変更と shape 差し替えを main.js 側で記述できるようにする
      if (typeof options.onKeyDown === "function") {
        options.onKeyDown({
          key,
          ev,
          app,
          orbit,
          sampleNode,
          shape,
          info,
          updateStatus,
          resetView,
          replaceShape,
          finalizeShape,
          applyMaterial
        });
      }
    }
  });

  runtime = {
    app,
    orbit,
    shape,
    sampleNode,
    info,
    updateStatus,
    resetView,
    replaceShape,
    finalizeShape,
    applyMaterial
  };

  return runtime;
}

// 秒単位の回転速度ベクトルを node へ適用し、frame rate に依存しない自動回転を行う
export function applySpin(sampleNode, deltaSec, spinDegPerSec = [0.0, 0.0, 0.0]) {
  if (!sampleNode) return;
  const spinX = Number(spinDegPerSec[0] ?? 0.0) * deltaSec;
  const spinY = Number(spinDegPerSec[1] ?? 0.0) * deltaSec;
  const spinZ = Number(spinDegPerSec[2] ?? 0.0) * deltaSec;
  if (spinX !== 0.0) sampleNode.rotateX(spinX);
  if (spinY !== 0.0) sampleNode.rotateY(spinY);
  if (spinZ !== 0.0) sampleNode.rotateZ(spinZ);
}
