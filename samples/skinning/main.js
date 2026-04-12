// -------------------------------------------------
// skinning sample
//   main.js       2026/04/12
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// -------------------------------------------------

import WebgApp from "../../webg/WebgApp.js";
import Matrix from "../../webg/Matrix.js";
import Primitive from "../../webg/Primitive.js";
import Shape from "../../webg/Shape.js";
import Skeleton from "../../webg/Skeleton.js";
import Diagnostics from "../../webg/Diagnostics.js";
import DebugConfig from "../../webg/DebugConfig.js";
import SmoothShader from "../../webg/SmoothShader.js";

// webgクラスの役割:
// WebgApp    : Screen / Shader / Space / Message / debug dock 初期化をまとめる
// SmoothShader: static / skinned / weight_debug を同じ入口で扱う
// Shape      : 円柱メッシュと bone 形状の生成を受け持つ
// Skeleton   : bone 階層、rest pose、matrix palette、bone 表示を管理する
// Diagnostics: 現在の mode と状態を text / JSON report として固定する

const CYLINDER_RADIUS = 0.18;
const HUD_ROW_OPTIONS = {
  anchor: "top-left",
  x: 0,
  y: 0,
  color: [0.90, 0.95, 1.0],
  minScale: 0.78
};

let app = null;

const setProjection = (screen, shader, angle = 45) => {
  // bone 可視化用の副 shader も、main shader と同じ投影条件へそろえる
  const fov = screen.getRecommendedFov(angle);
  const projMat = new Matrix();
  projMat.makeProjectionMatrix(0.05, 200.0, fov, screen.getAspect());
  shader.setProjectionMatrix(projMat);
  return projMat;
};

const createSkinnedCylinder = (
  gpu,
  height = 3.0,
  radius = CYLINDER_RADIUS,
  rings = 12,
  segments = 12,
  useHardWeights = false
) => {
  // 3 bone で曲げる円柱メッシュを作り、
  // smooth / hard の 2 種類の weight 分布を同じ geometry 上で切り替えられるようにする
  const shape = new Shape(gpu);
  const skeleton = new Skeleton();
  shape.setSkeleton(skeleton);
  shape.setAutoCalcNormals(true);

  const b0 = skeleton.addBone(null, "b0");
  const b1 = skeleton.addBone(b0, "b1");
  const b2 = skeleton.addBone(b1, "b2");

  const boneLen = height / 3.0;
  const setRest = (bone, x, y, z) => {
    const m = new Matrix();
    m.makeUnit();
    m.position([x, y, z]);
    bone.setByMatrix(m);
    bone.setRestByMatrix(m);
  };
  setRest(b0, 0, 0, 0);
  setRest(b1, 0, boneLen, 0);
  setRest(b2, 0, boneLen, 0);

  skeleton.setBoneOrder(["b0", "b1", "b2"]);

  const addSmoothWeights = (vIndex, y) => {
    // 高さ方向に応じて weight を連続補間し、
    // 曲げ境界がなめらかにつながる典型例を作る
    const t = Math.min(Math.max(y / height, 0.0), 1.0);
    const w0 = Math.max(1.0 - t * 2.0, 0.0);
    const w1 = t <= 0.5 ? t * 2.0 : 2.0 * (1.0 - t);
    const w2 = Math.max(t * 2.0 - 1.0, 0.0);
    shape.addVertexWeight(vIndex, 0, w0);
    shape.addVertexWeight(vIndex, 1, w1);
    shape.addVertexWeight(vIndex, 2, w2);
  };

  const addHardWeights = (vIndex, i) => {
    // 境界を分かりやすくするため、1 本の ring 全体を 1 bone へ固定する
    const t = i / rings;
    if (t < 1.0 / 3.0) shape.addVertexWeight(vIndex, 0, 1.0);
    else if (t < 2.0 / 3.0) shape.addVertexWeight(vIndex, 1, 1.0);
    else shape.addVertexWeight(vIndex, 2, 1.0);
  };

  const vertsPerRing = segments;
  for (let i = 0; i <= rings; i++) {
    const v = i / rings;
    const y = height * v;
    for (let j = 0; j < segments; j++) {
      const u = j / segments;
      const a = u * Math.PI * 2.0;
      const x = Math.cos(a) * radius;
      const z = Math.sin(a) * radius;
      const vIndex = shape.addVertexUV(x, y, z, u, v) - 1;
      if (useHardWeights) addHardWeights(vIndex, i);
      else addSmoothWeights(vIndex, y);
    }
  }

  for (let i = 0; i < rings; i++) {
    const ring0 = i * vertsPerRing;
    const ring1 = (i + 1) * vertsPerRing;
    for (let j = 0; j < segments; j++) {
      const j1 = (j + 1) % segments;
      const a = ring0 + j;
      const b = ring0 + j1;
      const c = ring1 + j;
      const d = ring1 + j1;
      shape.addTriangle(a, c, b);
      shape.addTriangle(b, c, d);
    }
  }

  shape.endShape();
  return { shape, skeleton, bones: [b0, b1, b2] };
};

const createStaticCylinder = (
  gpu,
  height = 3.0,
  radius = CYLINDER_RADIUS,
  rings = 12,
  segments = 24
) => {
  // skinning を使わない静的 cylinder を同じ silhouette で作り、
  // static 比較 mode では「変形しない参照物」として使えるようにする
  const shape = new Shape(gpu);
  shape.setAutoCalcNormals(true);

  const vertsPerRing = segments;
  for (let i = 0; i <= rings; i++) {
    const v = i / rings;
    const y = height * v;
    for (let j = 0; j < segments; j++) {
      const u = j / segments;
      const a = u * Math.PI * 2.0;
      const x = Math.cos(a) * radius;
      const z = Math.sin(a) * radius;
      shape.addVertexUV(x, y, z, u, v);
    }
  }

  for (let i = 0; i < rings; i++) {
    const ring0 = i * vertsPerRing;
    const ring1 = (i + 1) * vertsPerRing;
    for (let j = 0; j < segments; j++) {
      const j1 = (j + 1) % segments;
      const a = ring0 + j;
      const b = ring0 + j1;
      const c = ring1 + j;
      const d = ring1 + j1;
      shape.addTriangle(a, c, b);
      shape.addTriangle(b, c, d);
    }
  }

  shape.endShape();
  return shape;
};

const createBoneShape = (gpu, shader, size = 0.1) => {
  // debugBone は mesh 側より明るい色で描き、
  // 教材 sample として bone の向きと曲がる位置を追いやすくする
  const boneShape = new Shape(gpu);
  boneShape.applyPrimitiveAsset(Primitive.debugBone(size, boneShape.getPrimitiveOptions()));
  boneShape.endShape();
  boneShape.setShader(shader);
  boneShape.setMaterial("smooth-shader", {
    color: [1.0, 0.35, 0.15, 1.0],
    use_texture: 0,
    use_normal_map: 0,
    has_bone: 0,
    ambient: 0.5,
    specular: 0.0,
    emissive: 0.0
  });
  return boneShape;
};

const makeControlRows = (state, envReport, frameCount) => {
  const rows = [
    { line: "skinning sample" },
    { label: "Mode", value: state.forceStatic ? "static" : "skinned", toggleKey: "S" },
    {
      label: "Weights",
      value: state.forceStatic ? "N/A" : (state.useHardWeights ? "hard" : "soft"),
      toggleKey: "W"
    },
    {
      label: "Weight View",
      value: state.forceStatic ? "N/A" : (state.weightVis ? "ON" : "OFF"),
      toggleKey: "V"
    },
    {
      label: "Axis",
      value: state.objAxis.toUpperCase(),
      keys: [
        { key: "X", action: "x" },
        { key: "Y", action: "y" },
        { key: "Z", action: "z" }
      ]
    },
    {
      label: "Rotate",
      value: `x=${state.objRotX} y=${state.objRotY} z=${state.objRotZ}`,
      keys: [
        { key: "J", action: "-" },
        { key: "L", action: "+" },
        { key: "R", action: "reset" }
      ]
    },
    { label: "Pause", value: state.paused ? "ON" : "OFF", toggleKey: "Space" },
    {
      label: "Bones",
      value: state.showBones ? "ON" : "OFF",
      note: state.forceStatic ? "static mode" : "debugBone"
    },
    {
      label: "Params",
      value: `restY=${state.restYawDeg.toFixed(1)} bend=${state.rot1Amp.toFixed(0)}/${state.rot2Amp.toFixed(0)}`,
      note: `boneSize=${state.boneSize.toFixed(2)}`
    },
    {
      label: "Env",
      value: envReport.ok ? "OK" : "WARN",
      note: envReport.warnings?.[0] ?? ""
    },
    { label: "Frame", value: String(frameCount) },
    { label: "Debug", value: DebugConfig.mode, keys: [{ key: "F9" }, { key: "M", action: "mode" }] },
    { line: app.getDiagnosticsStatusLine() }
  ];
  const probeLine = app.getProbeStatusLine();
  if (probeLine) rows.push({ line: probeLine });
  return rows;
};

document.addEventListener("DOMContentLoaded", () => {
  start().catch((err) => {
    app?.setDiagnosticsReport?.(Diagnostics.createErrorReport(err, {
      system: "skinning",
      source: "samples/skinning/main.js",
      stage: app?.getDiagnosticsReport?.()?.stage ?? "start"
    }));
    if (app?.isConsoleEnabled?.()) {
      console.error("skinning failed:", err);
    }
    app?.showErrorPanel?.(err, {
      title: "skinning failed",
      id: "start-error",
      background: "rgba(26, 38, 26, 0.92)"
    });
  });
});

const start = async () => {
  const params = new URLSearchParams(location.search);
  const boneSize = Number(params.get("bonesize") ?? 0.1);
  const restYawDeg = Number(params.get("resty") ?? 10.0);
  const rot1Amp = Number(params.get("rot1") ?? 32.0);
  const rot2Amp = Number(params.get("rot2") ?? 42.0);
  const objY = params.get("objy") !== null ? Number(params.get("objy")) : 0.35;

  app = new WebgApp({
    document,
    shaderClass: SmoothShader,
    clearColor: [0.1, 0.15, 0.1, 1.0],
    lightPosition: [0.0, 5.0, 8.0, 1.0],
    viewAngle: 45.0,
    projectionNear: 0.05,
    projectionFar: 200.0,
    messageFontTexture: "../../webg/font512.png",
    debugTools: {
      mode: "debug",
      system: "skinning",
      source: "samples/skinning/main.js",
      probeDefaultAfterFrames: 1
    },
    camera: {
      target: [0.0, 1.3, 0.0],
      distance: 5.0,
      yaw: 0.0,
      pitch: 0.0
    },
    autoDrawBones: false
  });
  await app.init();
  app.shader.debugBindLayout = params.get("bindlog") === "1";
  app.setDiagnosticsStage("build-shape");

  const boneShader = new SmoothShader(app.getGL());
  await boneShader.init();
  boneShader.setLightPosition([0.0, 5.0, 8.0, 1.0]);
  const syncBoneProjection = () => {
    setProjection(app.screen, boneShader, 45);
  };
  syncBoneProjection();
  window.addEventListener("resize", syncBoneProjection);
  window.addEventListener("orientationchange", syncBoneProjection);

  const state = {
    forceStatic: false,
    useHardWeights: false,
    weightVis: true,
    boneSize,
    restYawDeg,
    rot1Amp,
    rot2Amp,
    objRotX: 0,
    objRotY: 0,
    objRotZ: 0,
    objAxis: "y",
    paused: false,
    showBones: true
  };

  const staticShape = createStaticCylinder(app.getGL());
  staticShape.setShader(app.shader);
  staticShape.setMaterial("smooth-shader", {
    has_bone: 0,
    use_texture: 0,
    use_normal_map: 0,
    color: [0.9, 0.9, 1.0, 1.0],
    ambient: 0.35,
    specular: 0.8,
    power: 40.0,
    emissive: 0.0,
    weight_debug: 0
  });

  const softSkinned = createSkinnedCylinder(app.getGL(), 3.0, CYLINDER_RADIUS, 12, 24, false);
  const hardSkinned = createSkinnedCylinder(app.getGL(), 3.0, CYLINDER_RADIUS, 12, 24, true);
  const skinnedSets = [softSkinned, hardSkinned];
  for (let i = 0; i < skinnedSets.length; i++) {
    skinnedSets[i].shape.setShader(app.shader);
    skinnedSets[i].shape.skeleton.setBoneShape(createBoneShape(app.getGL(), boneShader, boneSize));
    skinnedSets[i].shape.skeleton.bindRestPose();
    skinnedSets[i].shape.skeleton.showBone(false);
    if (app.isConsoleEnabled()) {
      skinnedSets[i].shape.skeleton.listBones();
    }
  }

  const staticNode = app.space.addNode(null, "cylinder_static");
  const softNode = app.space.addNode(null, "cylinder_soft");
  const hardNode = app.space.addNode(null, "cylinder_hard");
  const modelNodes = [staticNode, softNode, hardNode];
  for (let i = 0; i < modelNodes.length; i++) {
    modelNodes[i].setPosition(0.0, objY, 0.0);
  }
  staticNode.addShape(staticShape);
  softNode.addShape(softSkinned.shape);
  hardNode.addShape(hardSkinned.shape);

  const applyModeState = () => {
    // reload を使わず、3 系統の shape / skeleton を最初から持っておき、
    // 現在 mode に応じて visible な node と material だけを切り替える
    const activeSkinned = state.useHardWeights ? hardSkinned : softSkinned;
    staticNode.hide(!state.forceStatic);
    softNode.hide(state.forceStatic || state.useHardWeights);
    hardNode.hide(state.forceStatic || !state.useHardWeights);

    softSkinned.shape.setMaterial("smooth-shader", {
      has_bone: 1,
      use_texture: 0,
      use_normal_map: 0,
      color: [0.9, 0.9, 1.0, 1.0],
      ambient: 0.35,
      specular: 0.8,
      power: 40.0,
      emissive: 0.0,
      weight_debug: !state.forceStatic && !state.useHardWeights && state.weightVis ? 1 : 0
    });
    hardSkinned.shape.setMaterial("smooth-shader", {
      has_bone: 1,
      use_texture: 0,
      use_normal_map: 0,
      color: [0.9, 0.9, 1.0, 1.0],
      ambient: 0.35,
      specular: 0.8,
      power: 40.0,
      emissive: 0.0,
      weight_debug: !state.forceStatic && state.useHardWeights && state.weightVis ? 1 : 0
    });
    staticShape.setMaterial("smooth-shader", {
      has_bone: 0,
      use_texture: 0,
      use_normal_map: 0,
      color: [0.9, 0.9, 1.0, 1.0],
      ambient: 0.35,
      specular: 0.8,
      power: 40.0,
      emissive: 0.0,
      weight_debug: 0
    });

    softSkinned.shape.skeleton.showBone(!state.forceStatic && !state.useHardWeights);
    hardSkinned.shape.skeleton.showBone(!state.forceStatic && state.useHardWeights);
    state.showBones = !state.forceStatic;
    app.space.scanSkeletons();
    return activeSkinned;
  };
  applyModeState();

  const refreshDiagnosticsStats = (frameCount) => {
    const activeShape = state.forceStatic
      ? staticShape
      : (state.useHardWeights ? hardSkinned.shape : softSkinned.shape);
    const envReport = app.checkEnvironment({
      stage: "runtime-check",
      shapes: [activeShape]
    });
    app.mergeDiagnosticsStats({
      frameCount,
      mode: state.forceStatic ? "static" : "skinned",
      weightMode: state.forceStatic ? "n/a" : (state.useHardWeights ? "hard" : "soft"),
      weightDebug: state.forceStatic ? "n/a" : (state.weightVis ? "on" : "off"),
      axis: state.objAxis,
      paused: state.paused ? "yes" : "no",
      showBones: state.showBones ? "yes" : "no",
      objRotation: `${state.objRotX}/${state.objRotY}/${state.objRotZ}`,
      envOk: envReport.ok ? "yes" : "no",
      envWarning: envReport.warnings?.[0] ?? "-"
    });
    return envReport;
  };

  const makeProbeReport = (frameCount) => {
    const activeShape = state.forceStatic
      ? staticShape
      : (state.useHardWeights ? hardSkinned.shape : softSkinned.shape);
    const envReport = app.checkEnvironment({
      stage: "runtime-probe",
      shapes: [activeShape]
    });
    const report = app.createProbeReport("runtime-probe");
    Diagnostics.addDetail(report, `mode=${state.forceStatic ? "static" : "skinned"}`);
    Diagnostics.addDetail(report, `weightMode=${state.forceStatic ? "n/a" : (state.useHardWeights ? "hard" : "soft")}`);
    Diagnostics.addDetail(report, `weightDebug=${state.forceStatic ? "n/a" : (state.weightVis ? "on" : "off")}`);
    Diagnostics.addDetail(report, `axis=${state.objAxis}`);
    Diagnostics.addDetail(report, `rotation=${state.objRotX}/${state.objRotY}/${state.objRotZ}`);
    if (envReport.warnings?.length) {
      Diagnostics.addDetail(report, `envWarning=${envReport.warnings[0]}`);
    }
    Diagnostics.mergeStats(report, {
      frameCount,
      paused: state.paused ? "yes" : "no",
      showBones: state.showBones ? "yes" : "no",
      envOk: envReport.ok ? "yes" : "no"
    });
    return report;
  };

  app.configureDiagnosticsCapture({
    labelPrefix: "skinning",
    collect: () => makeProbeReport(app.screen.getFrameCount())
  });
  app.configureDebugKeyInput();

  const applyKeyAction = (key) => {
    if (key === "s") {
      state.forceStatic = !state.forceStatic;
      applyModeState();
      return true;
    }
    if (key === "w") {
      state.useHardWeights = !state.useHardWeights;
      applyModeState();
      return true;
    }
    if (key === "v") {
      state.weightVis = !state.weightVis;
      applyModeState();
      return true;
    }
    if (key === "j") {
      if (state.objAxis === "x") state.objRotX -= 5;
      else if (state.objAxis === "z") state.objRotZ -= 5;
      else state.objRotY -= 5;
      return true;
    }
    if (key === "l") {
      if (state.objAxis === "x") state.objRotX += 5;
      else if (state.objAxis === "z") state.objRotZ += 5;
      else state.objRotY += 5;
      return true;
    }
    if (key === "r") {
      state.objRotX = 0;
      state.objRotY = 0;
      state.objRotZ = 0;
      return true;
    }
    if (key === " ") {
      state.paused = !state.paused;
      return true;
    }
    if (key === "x" || key === "y" || key === "z") {
      state.objAxis = key;
      return true;
    }
    return false;
  };

  app.attachInput({
    onKeyDown: (key, ev) => {
      if (ev.repeat) return;
      applyKeyAction(key);
    }
  });
  app.input.installTouchControls({
    touchDeviceOnly: true,
    groups: [
      {
        id: "mode",
        buttons: [
          { key: "s", label: "S", kind: "action", ariaLabel: "toggle static mode" },
          { key: "w", label: "W", kind: "action", ariaLabel: "toggle weight mode" },
          { key: "v", label: "V", kind: "action", ariaLabel: "toggle weight visualizer" }
        ]
      },
      {
        id: "axis",
        buttons: [
          { key: "x", label: "X", kind: "action", ariaLabel: "set axis x" },
          { key: "y", label: "Y", kind: "action", ariaLabel: "set axis y" },
          { key: "z", label: "Z", kind: "action", ariaLabel: "set axis z" },
          { key: "r", label: "R", kind: "action", ariaLabel: "reset object rotation" }
        ]
      },
      {
        id: "rotate",
        buttons: [
          { key: "j", label: "J", kind: "action", ariaLabel: "rotate minus" },
          { key: "l", label: "L", kind: "action", ariaLabel: "rotate plus" },
          { key: " ", label: "Pause", kind: "action", ariaLabel: "pause animation" }
        ]
      }
    ],
    onAction: ({ key }) => applyKeyAction(String(key).toLowerCase())
  });

  app.setDiagnosticsStage("runtime");
  let boneLogOnce = true;
  app.start({
    onUpdate: ({ timeSec, screen }) => {
      if (!state.paused) {
        const skinnedTargets = [softSkinned, hardSkinned];
        for (let i = 0; i < skinnedTargets.length; i++) {
          skinnedTargets[i].bones[1]?.setAttitude(0, 0, Math.sin(timeSec) * state.rot1Amp);
          skinnedTargets[i].bones[2]?.setAttitude(0, 0, Math.sin(timeSec + 0.8) * state.rot2Amp);
        }
      }

      for (let i = 0; i < modelNodes.length; i++) {
        modelNodes[i].setAttitude(state.restYawDeg + state.objRotY, state.objRotX, state.objRotZ);
      }
      const activeSkinned = state.useHardWeights ? hardSkinned : softSkinned;
      if (boneLogOnce && !state.forceStatic && activeSkinned.shape.skeleton) {
        activeSkinned.shape.skeleton.updateMatrixPalette();
        boneLogOnce = false;
        if (app.isConsoleEnabled()) {
          const b0p = activeSkinned.bones[0]?.getWorldPosition?.();
          const b1p = activeSkinned.bones[1]?.getWorldPosition?.();
          const b2p = activeSkinned.bones[2]?.getWorldPosition?.();
          console.log("skinning.boneWorldPos", {
            b0: b0p,
            b1: b1p,
            b2: b2p,
            boneSize: state.boneSize,
            restYawDeg: state.restYawDeg
          });
        }
      }

      const envReport = refreshDiagnosticsStats(screen.getFrameCount());
      app.setControlRows(makeControlRows(state, envReport, screen.getFrameCount()), HUD_ROW_OPTIONS);
      app.updateDebugProbe();
    },
    onAfterDraw3d: () => {
      // bone は mesh の手前へ重ねて見せたいため、depth をいったん消してから描く
      const activeSkinned = state.useHardWeights ? hardSkinned : softSkinned;
      if (!state.showBones || state.forceStatic || !activeSkinned.shape.skeleton) return;
      app.screen.clearDepthBuffer();
      app.space.scanSkeletons();
      app.space.drawBones();
    }
  });
};
